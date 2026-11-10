'use strict';
const express = require('express'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), path = require('path');
const { q, init } = require('./db');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TZ = 'America/La_Paz';
const app = express();
app.disable('x-powered-by');
app.use((req, res, n) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' }); n(); });
app.use(express.json({ limit: '100kb' }));

const bad = (m, s = 400) => { const e = new Error(m); e.status = s; return e; };
const H = f => (req, res) => Promise.resolve(f(req, res)).catch(e => { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Error interno del servidor' }); });
const sign = u => jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '12h' });
const auth = roles => (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').slice(7) || req.query.t, SECRET); } catch { return res.status(401).json({ error: 'Sesión requerida' }); }
  if (roles && !roles.includes(req.user.role)) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  next();
};
const optAuth = (req, res, next) => { try { req.user = jwt.verify((req.headers.authorization || '').slice(7), SECRET); } catch { } next(); };
const hits = new Map();
const limit = (req, res, next) => { const k = req.ip, n = (hits.get(k) || 0) + 1; hits.set(k, n); setTimeout(() => hits.set(k, Math.max(0, (hits.get(k) || 1) - 1)), 60000).unref(); n > 20 ? res.status(429).json({ error: 'Demasiados intentos. Espera un minuto.' }) : next(); };

const settings = async () => Object.fromEntries((await q('select k,v from settings')).map(r => [r.k, r.v]));
const hhmm = () => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const isOpen = s => { if (s.force_open === '1') return true; const n = hhmm(); return s.open <= s.close ? (n >= s.open && n < s.close) : (n >= s.open || n < s.close); };
const activePromos = async () => { const d = today(); return (await q('select * from promos where active=true')).filter(p => (!p.starts || p.starts <= d) && (!p.ends || p.ends >= d)); };

/* ---------- Tiempo real (SSE) ---------- */
const clients = new Set();
const broadcast = o => clients.forEach(c => c.write(`event: order\ndata: ${JSON.stringify({ id: o.id, status: o.status })}\n\n`));
app.get('/api/stream', auth(), (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
  res.write('retry: 3000\n\n'); clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

/* ---------- Públicos ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/menu', H(async (req, res) => {
  const s = await settings();
  res.json({
    categories: await q('select * from categories where active=true order by sort,id'), products: await q('select * from products order by id'),
    modifiers: await q('select * from modifiers where active=true order by id'), zones: await q('select * from zones where active=true order by id'),
    promos: await activePromos(), open: isOpen(s), settings: { open: s.open, close: s.close, payments: s.payments.split(','), phone: s.phone, threshold: +s.threshold }
  });
}));

/* ---------- Autenticación (RF-18, RNF-10/11) ---------- */
app.post('/api/auth/register', limit, H(async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 6) throw bad('Completa nombre, correo válido y una contraseña de al menos 6 caracteres');
  if ((await q('select id from users where email=$1', [email.toLowerCase()])).length) throw bad('Ese correo ya está registrado');
  const [u] = await q('insert into users(name,email,phone,pass_hash,role) values($1,$2,$3,$4,$5) returning *', [name.trim(), email.toLowerCase(), phone || null, bcrypt.hashSync(password, 10), 'cliente']);
  res.json({ token: sign(u), user: { id: u.id, name: u.name, role: u.role, phone: u.phone } });
}));
app.post('/api/auth/login', limit, H(async (req, res) => {
  const { email, password } = req.body || {};
  const [u] = await q('select * from users where email=$1', [(email || '').toLowerCase()]);
  if (!u || !u.active || !bcrypt.compareSync(password || '', u.pass_hash)) throw bad('Correo o contraseña incorrectos', 401);
  res.json({ token: sign(u), user: { id: u.id, name: u.name, role: u.role, phone: u.phone } });
}));

/* ---------- Pedidos ---------- */
const parse = o => ({ ...o, items: JSON.parse(o.items) });
const pub = o => ({ code: o.code, status: o.status, mode: o.mode, items: JSON.parse(o.items), subtotal: o.subtotal, discount: o.discount, promo: o.promo, fee: o.fee, total: o.total, eta_min: o.eta_min, created_at: o.created_at, customer: o.customer, zone_name: o.zone_name });
async function addEvent(o, status, user) {
  await q('insert into order_events(order_id,status,user_id,user_name) values($1,$2,$3,$4)', [o.id, status, user ? user.id : null, user ? user.name : 'Sistema']); // RNF-02
}
const code = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

app.post('/api/orders', optAuth, H(async (req, res) => {
  const b = req.body || {}, staff = req.user && ['vendedor', 'admin'].includes(req.user.role);
  const channel = b.channel === 'mostrador' && staff ? 'mostrador' : 'en_linea';
  const s = await settings();
  if (channel === 'en_linea' && !isOpen(s)) throw bad(`El local está cerrado. Atendemos de ${s.open} a ${s.close}.`); // RF-14
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 40) throw bad('El carrito está vacío');
  if (!['delivery', 'recojo', 'mesa'].includes(b.mode)) throw bad('Elige una modalidad de entrega');
  if (!s.payments.split(',').includes(b.payment)) throw bad('Elige un medio de pago habilitado');
  if (b.key) { const [x] = await q('select * from orders where idem=$1', [b.key]); if (x) return res.json({ ...pub(x), id: x.id }); } // RNF-01: sin duplicados
  const customer = (b.customer || '').trim().slice(0, 80), phone = (b.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
  if (channel === 'en_linea' && (customer.length < 2 || phone.length < 6)) throw bad('Indica tu nombre y un teléfono de contacto');
  const prods = Object.fromEntries((await q('select p.*,c.kind from products p join categories c on c.id=p.cat_id')).map(p => [p.id, p]));
  const mods = Object.fromEntries((await q('select * from modifiers where active=true')).map(m => [m.id, m]));
  let subtotal = 0; const items = [];
  for (const it of b.items) {
    const p = prods[it.pid], qty = Math.min(20, Math.max(1, parseInt(it.qty) || 1));
    if (!p) throw bad('Producto inexistente');
    if (!p.available) throw bad(`"${p.name}" no está disponible por ahora`); // RF-02
    let unit = p.price; const names = [], seen = {}; let side = null, drink = null;
    for (const id of it.mods || []) {
      const m = mods[id]; if (!m) throw bad('Modificador inválido');
      if (m.single && seen[m.grp]) throw bad(`Combinación incompatible: ${seen[m.grp]} y ${m.name}`); // RF-05
      seen[m.grp] = m.name; unit += m.price; names.push(m.name);
    }
    if (p.kind === 'combo') {
      side = prods[it.side]; drink = prods[it.drink];
      if (!side || side.kind !== 'side' || !side.available || !drink || drink.kind !== 'drink' || !drink.available) throw bad(`Elige acompañamiento y bebida disponibles para ${p.name}`); // RF-04
    }
    subtotal += unit * qty;
    items.push({ pid: p.id, name: p.name, qty, unit, mods: it.mods || [], modNames: names, side: side && side.id, sideName: side && side.name, drink: drink && drink.id, drinkName: drink && drink.name });
  }
  let fee = 0, zone = null;
  if (b.mode === 'delivery') {
    [zone] = await q('select * from zones where id=$1 and active=true', [parseInt(b.zone_id) || 0]);
    if (!zone) throw bad('Tu dirección está fuera de nuestras zonas de cobertura'); // RF-10
    if ((b.address || '').trim().length < 5) throw bad('Indica la dirección de entrega');
    fee = zone.fee;
  }
  let promo = null, discount = 0;
  for (const p of await activePromos()) if (subtotal >= p.min_total && subtotal * p.pct / 100 > discount) { discount = Math.round(subtotal * p.pct) / 100; promo = p.name; } // RF-13
  const total = subtotal - discount + fee;
  const queue = (await q("select id from orders where status in ('Confirmado','En preparación')")).length;
  const eta = parseInt(s.prep_base) + queue * 3 + (zone ? zone.eta_min : 0); // RF-15
  let o;
  for (let i = 0; i < 5 && !o; i++) {
    try {
      [o] = await q('insert into orders(code,idem,channel,mode,status,user_id,customer,phone,address,ref,zone_id,zone_name,notes,payment,voucher,items,subtotal,discount,promo,fee,total,eta_min) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning *',
        [code(), b.key || null, channel, b.mode, 'Recibido', req.user && req.user.role === 'cliente' ? req.user.id : null, customer || 'Mostrador', phone || null, b.mode === 'delivery' ? b.address.trim().slice(0, 200) : null, (b.ref || '').slice(0, 150), zone && zone.id, zone && zone.name, (b.notes || '').slice(0, 300), b.payment, (b.voucher || '').slice(0, 60), JSON.stringify(items), subtotal, discount, promo, fee, total, eta]);
    } catch (e) { if (i === 4) throw e; }
  }
  await addEvent(o, 'Recibido', req.user);
  await q("update orders set status='Confirmado' where id=$1", [o.id]); await addEvent(o, 'Confirmado', null); o.status = 'Confirmado';
  broadcast(o);
  res.json({ ...pub(o), id: o.id });
}));

app.get('/api/track/:code', H(async (req, res) => {
  const [o] = await q('select * from orders where code=$1', [req.params.code.toUpperCase()]);
  if (!o) throw bad('No encontramos ese pedido', 404);
  res.json({ ...pub(o), events: await q('select status,at from order_events where order_id=$1 order by id', [o.id]) }); // RF-16
}));
app.post('/api/track/:code/cancel', H(async (req, res) => {
  const [o] = await q('select * from orders where code=$1', [req.params.code.toUpperCase()]);
  if (!o) throw bad('No encontramos ese pedido', 404);
  if (!['Recibido', 'Confirmado'].includes(o.status)) throw bad('El pedido ya está en preparación y no puede cancelarse'); // RF-17
  await q("update orders set status='Cancelado' where id=$1", [o.id]); await addEvent(o, 'Cancelado', null); broadcast(o);
  res.json({ ok: true });
}));

const FLOW = { Recibido: { Confirmado: ['admin', 'vendedor'], Rechazado: ['admin', 'vendedor'] }, Confirmado: { 'En preparación': ['cocinero', 'admin'], Rechazado: ['admin', 'vendedor'] }, 'En preparación': { Listo: ['cocinero', 'admin'] }, 'En camino': { Entregado: ['repartidor', 'admin'] } };
async function withEvents(rows, role) {
  const ids = rows.map(r => parseInt(r.id)).filter(Boolean);
  const ev = ids.length ? await q(`select * from order_events where order_id in (${ids.join(',')}) order by id`) : [];
  return rows.map(o => {
    const x = parse(o); x.events = ev.filter(e => e.order_id === o.id);
    if (role === 'cocinero') { delete x.phone; delete x.address; delete x.ref; delete x.customer; } // RNF-12
    return x;
  });
}
app.get('/api/orders', auth(['admin', 'vendedor', 'cocinero', 'repartidor']), H(async (req, res) => {
  const r = req.user.role; let rows;
  if (r === 'cocinero') rows = await q("select * from orders where status in ('Confirmado','En preparación') order by created_at,id");
  else if (r === 'repartidor') rows = await q("select * from orders where courier_id=$1 and status in ('Listo','En camino') order by created_at,id", [req.user.id]);
  else rows = await q('select * from orders order by id desc limit 300');
  res.json(await withEvents(rows, r));
}));
app.patch('/api/orders/:id/status', auth(['admin', 'vendedor', 'cocinero', 'repartidor']), H(async (req, res) => {
  const [o] = await q('select * from orders where id=$1', [parseInt(req.params.id) || 0]); if (!o) throw bad('Pedido inexistente', 404);
  const to = req.body.status; let roles = (FLOW[o.status] || {})[to];
  if (o.status === 'Listo') roles = o.mode === 'delivery' ? (to === 'En camino' ? ['repartidor', 'admin'] : null) : (to === 'Entregado' ? ['vendedor', 'admin'] : null);
  if (!roles) throw bad(`No se puede pasar de "${o.status}" a "${to}"`);
  if (!roles.includes(req.user.role)) throw bad('Tu rol no puede ejecutar esta transición', 403);
  if (req.user.role === 'repartidor' && o.courier_id !== req.user.id) throw bad('Este pedido no está asignado a ti', 403);
  if (to === 'En camino' && !o.courier_id) throw bad('Asigna un repartidor primero');
  const [n] = await q('update orders set status=$1 where id=$2 returning *', [to, o.id]); await addEvent(n, to, req.user); broadcast(n);
  res.json({ ok: true });
}));
app.patch('/api/orders/:id/assign', auth(['admin', 'vendedor']), H(async (req, res) => { // RF-28
  const [c] = await q("select id from users where id=$1 and role='repartidor' and active=true", [parseInt(req.body.courier_id) || 0]);
  if (!c) throw bad('Repartidor inválido');
  const [o] = await q("update orders set courier_id=$1 where id=$2 and mode='delivery' and status in ('Listo','En preparación','Confirmado') returning *", [c.id, parseInt(req.params.id) || 0]);
  if (!o) throw bad('No se puede asignar este pedido'); broadcast(o); res.json({ ok: true });
}));
app.get('/api/couriers', auth(['admin', 'vendedor']), H(async (req, res) => res.json(await q("select id,name from users where role='repartidor' and active=true"))));

/* ---------- Cuenta de cliente (RF-20/21) ---------- */
app.get('/api/me/orders', auth(['cliente']), H(async (req, res) => res.json((await q('select * from orders where user_id=$1 order by id desc limit 50', [req.user.id])).map(o => ({ ...pub(o), id: o.id })))));
app.get('/api/me/addresses', auth(['cliente']), H(async (req, res) => res.json(await q('select * from addresses where user_id=$1 order by id', [req.user.id]))));
app.post('/api/me/addresses', auth(['cliente']), H(async (req, res) => {
  const { label, address, zone_id } = req.body || {}; if ((address || '').trim().length < 5) throw bad('Indica la dirección');
  res.json((await q('insert into addresses(user_id,label,address,zone_id) values($1,$2,$3,$4) returning *', [req.user.id, (label || 'Casa').slice(0, 30), address.trim().slice(0, 200), parseInt(zone_id) || null]))[0]);
}));
app.delete('/api/me/addresses/:id', auth(['cliente']), H(async (req, res) => { await q('delete from addresses where id=$1 and user_id=$2', [parseInt(req.params.id) || 0, req.user.id]); res.json({ ok: true }); }));

/* ---------- Administración (RF-34..38) ---------- */
const ENT = { categories: ['name', 'kind', 'sort', 'active'], products: ['cat_id', 'name', 'descr', 'price', 'emoji', 'available'], modifiers: ['name', 'price', 'grp', 'single', 'active'], zones: ['name', 'fee', 'eta_min', 'active'], promos: ['name', 'min_total', 'pct', 'starts', 'ends', 'active'] };
const NUM = new Set(['cat_id', 'price', 'sort', 'fee', 'eta_min', 'min_total', 'pct']), BOOL = new Set(['active', 'available', 'single']);
const clean = (t, b) => Object.fromEntries(ENT[t].filter(c => c in b).map(c => [c, NUM.has(c) ? Number(b[c]) || 0 : BOOL.has(c) ? !!b[c] : (b[c] === '' ? null : String(b[c]))]));
const A = auth(['admin']);
app.get('/api/admin/users', A, H(async (req, res) => res.json(await q('select id,name,email,role,active from users order by id'))));
app.post('/api/admin/users', A, H(async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!['admin', 'vendedor', 'cocinero', 'repartidor'].includes(role) || !name || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 6) throw bad('Datos de usuario incompletos');
  if ((await q('select id from users where email=$1', [email.toLowerCase()])).length) throw bad('Ese correo ya existe');
  res.json((await q('insert into users(name,email,pass_hash,role) values($1,$2,$3,$4) returning id', [name, email.toLowerCase(), bcrypt.hashSync(password, 10), role]))[0]);
}));
app.put('/api/admin/users/:id', A, H(async (req, res) => {
  const id = parseInt(req.params.id); if (id === req.user.id) throw bad('No puedes modificar tu propio usuario');
  const b = req.body || {}; if (b.role && !['admin', 'vendedor', 'cocinero', 'repartidor', 'cliente'].includes(b.role)) throw bad('Rol inválido');
  await q('update users set role=coalesce($1,role), active=coalesce($2,active) where id=$3', [b.role || null, typeof b.active === 'boolean' ? b.active : null, id]); res.json({ ok: true });
}));
app.get('/api/admin/settings', A, H(async (req, res) => res.json(await settings())));
app.put('/api/admin/settings', A, H(async (req, res) => {
  for (const k of ['open', 'close', 'force_open', 'payments', 'threshold', 'prep_base', 'phone']) if (k in req.body) {
    const v = String(req.body[k]); if (!(await q('update settings set v=$1 where k=$2 returning k', [v, k])).length) await q('insert into settings(k,v) values($1,$2)', [k, v]);
  }
  res.json({ ok: true });
}));
app.get('/api/admin/:t', A, H(async (req, res) => { if (!ENT[req.params.t]) throw bad('No existe', 404); res.json(await q(`select * from ${req.params.t} order by id`)); }));
app.post('/api/admin/:t', A, H(async (req, res) => {
  const t = req.params.t; if (!ENT[t]) throw bad('No existe', 404); const d = clean(t, req.body || {}), k = Object.keys(d);
  if (!k.length) throw bad('Sin datos');
  res.json((await q(`insert into ${t}(${k.join(',')}) values(${k.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, k.map(c => d[c])))[0]);
}));
app.put('/api/admin/:t/:id', A, H(async (req, res) => {
  const t = req.params.t; if (!ENT[t]) throw bad('No existe', 404); const d = clean(t, req.body || {}), k = Object.keys(d);
  if (!k.length) throw bad('Sin datos');
  res.json((await q(`update ${t} set ${k.map((c, i) => c + '=$' + (i + 1)).join(',')} where id=$${k.length + 1} returning *`, [...k.map(c => d[c]), parseInt(req.params.id) || 0]))[0]);
}));

/* ---------- Reportes (RF-39..42) ---------- */
const day = d => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
async function report(from, to) {
  const rows = (await withEvents(await q('select * from orders order by id desc limit 3000'), 'admin')).filter(o => { const d = day(o.created_at); return (!from || d >= from) && (!to || d <= to); });
  const valid = rows.filter(o => !['Cancelado', 'Rechazado'].includes(o.status)), sum = a => a.reduce((s, o) => s + o.total, 0);
  const grp = (a, f) => { const m = {}; a.forEach(o => { const k = f(o); m[k] = m[k] || { key: k, orders: 0, total: 0 }; m[k].orders++; m[k].total += o.total; }); return Object.values(m).sort((x, y) => x.key < y.key ? -1 : 1); };
  const prod = {}; valid.forEach(o => o.items.forEach(i => { prod[i.name] = (prod[i.name] || 0) + i.qty; }));
  const at = (o, s) => { const e = o.events.find(e => e.status === s); return e && new Date(e.at).getTime(); };
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length / 600) / 10 : null;
  const prep = [], del = [];
  valid.forEach(o => { const a = at(o, 'En preparación'), l = at(o, 'Listo'), d = at(o, 'Entregado'); if (a && l) prep.push(l - a); if (l && d && o.mode === 'delivery') del.push(d - l); });
  return {
    totals: { orders: valid.length, sales: sum(valid), ticket: valid.length ? sum(valid) / valid.length : 0, cancelled: rows.length - valid.length },
    byDay: grp(valid, o => day(o.created_at)), byChannel: grp(valid, o => o.channel), byMode: grp(valid, o => o.mode),
    top: Object.entries(prod).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 10), avgPrepMin: avg(prep), avgDeliveryMin: avg(del)
  };
}
app.get('/api/admin/reports/summary', A, H(async (req, res) => {
  const r = await report(req.query.from, req.query.to);
  if (req.query.format === 'csv') {
    const L = [['Seccion', 'Clave', 'Pedidos/Cantidad', 'Total Bs']];
    r.byDay.forEach(x => L.push(['Dia', x.key, x.orders, x.total])); r.byChannel.forEach(x => L.push(['Canal', x.key, x.orders, x.total])); r.byMode.forEach(x => L.push(['Modalidad', x.key, x.orders, x.total])); r.top.forEach(x => L.push(['Producto', x.name, x.qty, '']));
    L.push(['Tiempo prom. preparacion (min)', '', r.avgPrepMin ?? '', '']); L.push(['Tiempo prom. entrega (min)', '', r.avgDeliveryMin ?? '', '']);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="reporte-gula.csv"' }); return res.send('\ufeff' + L.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));
  }
  res.json(r);
}));

/* ---------- Estáticos ---------- */
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta inexistente' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
if (require.main === module) init().then(() => app.listen(PORT, () => console.log(`Gula Express en http://localhost:${PORT}`))).catch(e => { console.error(e); process.exit(1); });
module.exports = { app, init };
