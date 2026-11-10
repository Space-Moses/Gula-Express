'use strict';
/* Gula Express · SPA sin dependencias. Zonas: cliente (#/), personal (#/staff, #/cocina, #/mostrador, #/despacho, #/reparto, #/admin) */
const $ = s => document.querySelector(s), app = $('#app');
const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
const S = { token: ls.get('gx_t', null), user: ls.get('gx_u', null), menu: null, cart: ls.get('gx_c', []), refresh: null, timers: [], es: null };
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bs = n => 'Bs ' + (Number(n) || 0).toFixed(2);
const hm = d => new Date(d).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
const toast = (m, err) => { const t = $('#toast'); t.textContent = m; t.className = 'show' + (err ? ' err' : ''); clearTimeout(t._t); t._t = setTimeout(() => t.className = '', 3200); };
async function api(u, o = {}) {
  const r = await fetch('/api' + u, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  if (o.raw) return r;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && S.token) logout(true); throw new Error(d.error || 'Ocurrió un error'); }
  return d;
}
const go = h => { location.hash = h; };
const setUser = (t, u) => { S.token = t; S.user = u; ls.set('gx_t', t); ls.set('gx_u', u); };
function logout(expired) { setUser(null, null); if (S.es) S.es.close(); S.es = null; if (expired) toast('Tu sesión venció. Ingresa de nuevo.', 1); go('#/'); route(); }
const STAFF = ['admin', 'vendedor', 'cocinero', 'repartidor'];
const HOME = { admin: '#/admin', vendedor: '#/mostrador', cocinero: '#/cocina', repartidor: '#/reparto', cliente: '#/' };
const NAV = {
  anon: [['#/', 'Carta'], ['#/seguir', 'Seguir pedido'], ['#/cuenta', 'Ingresar']],
  cliente: [['#/', 'Carta'], ['#/seguir', 'Seguir pedido'], ['#/cuenta', 'Mi cuenta']],
  admin: [['#/admin', 'Administración'], ['#/mostrador', 'Mostrador'], ['#/cocina', 'Cocina'], ['#/despacho', 'Despacho']],
  vendedor: [['#/mostrador', 'Mostrador'], ['#/despacho', 'Despacho']], cocinero: [['#/cocina', 'Cocina']], repartidor: [['#/reparto', 'Mis entregas']]
};
function header() {
  const role = S.user ? S.user.role : 'anon', h = location.hash || '#/';
  $('#top').innerHTML = `<a class="brand" href="${S.user && STAFF.includes(role) ? HOME[role] : '#/'}">Gula<b>Express</b></a><nav aria-label="Principal">${NAV[role].map(([l, t]) => `<a href="${l}" class="${h.startsWith(l) && (l !== '#/' || h === '#/') ? 'on' : ''}">${t}</a>`).join('')}${S.user ? '<a href="#/salir" id="out">Salir</a>' : '<a href="#/staff">Personal</a>'}</nav>`;
  const o = $('#out'); if (o) o.onclick = ev => { ev.preventDefault(); logout(); };
}
function connect() { // tiempo real para el personal (RNF-03, RF-26)
  if (S.es || !S.token || !STAFF.includes(S.user.role)) return;
  S.es = new EventSource('/api/stream?t=' + encodeURIComponent(S.token));
  S.es.addEventListener('order', () => S.refresh && S.refresh());
}
function every(ms, f) { S.timers.push(setInterval(f, ms)); }
function modal(html, cls = '') { const o = document.createElement('div'); o.className = 'ov'; o.innerHTML = `<div class="sheet ${cls}" role="dialog" aria-modal="true">${html}</div>`; o.onclick = ev => { if (ev.target === o) o.remove(); }; document.body.append(o); o.close = () => o.remove(); return o; }
const need = roles => { if (!S.user || !roles.includes(S.user.role)) { go(S.user ? HOME[S.user.role] : '#/staff'); return false; } return true; };

/* ================= CLIENTE: carta, personalización, carrito ================= */
const cartTotal = () => S.cart.reduce((s, i) => s + i.unit * i.qty, 0), cartCount = () => S.cart.reduce((s, i) => s + i.qty, 0);
const saveCart = () => ls.set('gx_c', S.cart);
async function viewMenu(counter) {
  S.menu = await api('/menu'); const m = S.menu, open = m.open || counter;
  app.innerHTML = `${counter ? '<h1>Pedido de mostrador</h1>' : `<section class="hero"><div><h1>Tu hamburguesa, tal como la armas.</h1><p>Pide desde tu celular, sin comisiones y sabe cuándo llega.</p></div><div class="big" aria-hidden="true">🍔</div></section>`}
  ${!open ? `<div class="banner red">El local está cerrado. Atendemos de ${e(m.settings.open)} a ${e(m.settings.close)}. Puedes ver la carta, pero no confirmar pedidos.</div>` : ''}
  ${m.promos.map(p => `<div class="banner">🎉 ${e(p.name)}</div>`).join('')}
  <div class="tabs">${m.categories.map(c => `<button class="chip" data-c="${c.id}">${e(c.name)}</button>`).join('')}</div>
  ${m.categories.map(c => `<h2 id="cat${c.id}">${e(c.name)}</h2><div class="grid">${m.products.filter(p => p.cat_id === c.id).map(p => `<button class="prod" data-p="${p.id}" ${p.available ? '' : 'disabled'}><span class="em">${e(p.emoji)}</span><span><h3>${e(p.name)} ${p.available ? '' : '<span class="tag r">No disponible</span>'}</h3><p>${e(p.descr)}</p><span class="price">${bs(p.price)}</span></span></button>`).join('')}</div>`).join('')}
  <div id="bar"></div>`;
  app.querySelectorAll('.chip').forEach(b => b.onclick = () => $('#cat' + b.dataset.c).scrollIntoView({ block: 'start' }));
  app.querySelectorAll('.prod').forEach(b => b.onclick = () => openProd(+b.dataset.p, counter));
  const bar = () => { $('#bar').innerHTML = cartCount() ? `<div class="cartbar"><span><b>${cartCount()}</b> en tu pedido · <b>${bs(cartTotal())}</b></span><button class="btn" id="go">Ver pedido</button></div>` : ''; const g = $('#go'); if (g) g.onclick = () => openCart(counter, bar); };
  S.bar = bar; bar();
}
function openProd(id, counter) {
  const m = S.menu, p = m.products.find(x => x.id === id), cat = m.categories.find(c => c.id === p.cat_id), combo = cat.kind === 'combo';
  const pick = k => m.products.filter(x => x.available && m.categories.find(c => c.id === x.cat_id).kind === k);
  const groups = {}; m.modifiers.forEach(x => (groups[x.grp] = groups[x.grp] || []).push(x));
  const GN = { coccion: 'Término de cocción', extra: 'Agregados', queso: 'Queso', quitar: 'Quitar ingredientes' };
  const o = modal(`<div class="row"><h2>${e(p.emoji)} ${e(p.name)}</h2><button class="btn ghost sm" data-x>Cerrar</button></div><p>${e(p.descr)}</p><form class="stack" id="pf">
  ${combo ? ['side', 'drink'].map((k, i) => `<fieldset class="card"><legend><b>${i ? 'Bebida' : 'Acompañamiento'}</b></legend>${pick(k).map((x, j) => `<label class="opt"><input type="radio" name="${k}" value="${x.id}" ${j ? '' : 'checked'}><span>${e(x.name)}</span></label>`).join('')}</fieldset>`).join('') : ''}
  ${Object.entries(groups).map(([g, a]) => `<fieldset class="card"><legend><b>${GN[g] || e(g)}</b>${a[0].single ? ' <small>(elige una)</small>' : ''}</legend>${a.map(x => `<label class="opt"><input type="${x.single ? 'radio' : 'checkbox'}" name="g_${e(g)}" value="${x.id}" data-pr="${x.price}"><span>${e(x.name)}</span><span>${x.price ? '+' + bs(x.price) : ''}</span></label>`).join('')}${a[0].single ? `<button type="button" class="btn ghost sm" data-clear="g_${e(g)}">Quitar selección</button>` : ''}</fieldset>`).join('')}
  <div class="row"><span class="qty"><button type="button" data-d="-1" aria-label="Menos">−</button><b id="q">1</b><button type="button" data-d="1" aria-label="Más">+</button></span><button class="btn" id="add">Agregar · <span id="pt"></span></button></div></form>`);
  const f = o.querySelector('#pf'); let qty = 1;
  const calc = () => { let u = p.price; f.querySelectorAll('[data-pr]:checked').forEach(i => u += +i.dataset.pr); o.querySelector('#pt').textContent = bs(u * qty); return u; };
  f.onchange = calc; calc();
  o.querySelector('[data-x]').onclick = o.close;
  f.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { qty = Math.min(20, Math.max(1, qty + +b.dataset.d)); o.querySelector('#q').textContent = qty; calc(); });
  f.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => { f.querySelectorAll(`[name="${b.dataset.clear}"]`).forEach(i => i.checked = false); calc(); });
  f.onsubmit = ev => {
    ev.preventDefault(); const mods = [...f.querySelectorAll('[data-pr]:checked')].map(i => +i.value), nm = mods.map(i => m.modifiers.find(x => x.id === i).name);
    const side = combo ? +f.side.value : null, drink = combo ? +f.drink.value : null, nameOf = i => m.products.find(x => x.id === i).name;
    S.cart.push({ pid: p.id, name: p.name, emoji: p.emoji, qty, unit: calc(), mods, modNames: nm, side, drink, sideName: side && nameOf(side), drinkName: drink && nameOf(drink) });
    saveCart(); o.close(); S.bar(); toast('Agregado al pedido');
  };
}
function totals(mode, zoneId) {
  const m = S.menu, sub = cartTotal(), z = m.zones.find(x => x.id === +zoneId), fee = mode === 'delivery' && z ? z.fee : 0;
  let disc = 0, promo = ''; m.promos.forEach(p => { if (sub >= p.min_total && sub * p.pct / 100 > disc) { disc = Math.round(sub * p.pct) / 100; promo = p.name; } });
  return { sub, disc, promo, fee, total: sub - disc + fee };
}
async function openCart(counter, onChange) {
  const m = S.menu, me = S.user && S.user.role === 'cliente'; let addrs = []; if (me) try { addrs = await api('/me/addresses'); } catch { }
  const o = modal(''), draw = () => {
    if (!S.cart.length) { o.close(); onChange(); return; }
    const mode = (o.querySelector('[name=mode]:checked') || {}).value || (counter ? 'mesa' : 'recojo'), zone = (o.querySelector('[name=zone]') || {}).value, t = totals(mode, zone);
    const keep = Object.fromEntries([...o.querySelectorAll('input:not([type=radio]),select,textarea')].map(i => [i.name, i.value]));
    o.firstChild.innerHTML = `<div class="row"><h2>Tu pedido</h2><button class="btn ghost sm" data-x>Cerrar</button></div>
    <div class="stack">${S.cart.map((i, n) => `<div class="card row"><div><b>${e(i.emoji)} ${e(i.name)}</b><small style="display:block;color:var(--mute)">${[i.sideName, i.drinkName, ...i.modNames].filter(Boolean).map(e).join(', ')}</small><span class="price">${bs(i.unit * i.qty)}</span></div><span class="qty"><button data-q="${n}:-1" aria-label="Menos">−</button><b>${i.qty}</b><button data-q="${n}:1" aria-label="Más">+</button></span></div>`).join('')}</div>
    <form class="stack" id="cf" style="margin-top:1rem">
    <fieldset class="card"><legend><b>¿Cómo lo recibes?</b></legend>${[['delivery', '🛵 Delivery'], ['recojo', '🛍️ Recojo en local'], ['mesa', '🍽️ Consumo en mesa']].map(([v, l]) => `<label class="opt"><input type="radio" name="mode" value="${v}" ${v === mode ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>
    <label class="f">Nombre${counter ? ' (opcional)' : ''}<input name="customer" autocomplete="name" value="${e(keep.customer ?? (me ? S.user.name : ''))}"></label>
    ${counter ? '' : `<label class="f">Teléfono de contacto<input name="phone" inputmode="tel" autocomplete="tel" value="${e(keep.phone ?? (me ? S.user.phone || '' : ''))}"></label>`}
    ${mode === 'delivery' ? `${addrs.length ? `<label class="f">Direcciones guardadas<select id="sa"><option value="">Elegir…</option>${addrs.map(a => `<option value="${a.id}">${e(a.label)}: ${e(a.address)}</option>`).join('')}</select></label>` : ''}
    <label class="f">Zona de entrega<select name="zone" required><option value="">Selecciona tu zona</option>${m.zones.map(z => `<option value="${z.id}" ${+(keep.zone || zone) === z.id ? 'selected' : ''}>${e(z.name)} · envío ${bs(z.fee)} · ~${z.eta_min} min</option>`).join('')}</select></label>
    <label class="f">Dirección<input name="address" value="${e(keep.address || '')}" required minlength="5" placeholder="Calle, número, edificio"></label>
    <label class="f">Referencia<input name="ref" value="${e(keep.ref || '')}" placeholder="Casa verde, frente a la plaza"></label>` : ''}
    <label class="f">Notas para la cocina<textarea name="notes" rows="2" maxlength="300">${e(keep.notes || '')}</textarea></label>
    <label class="f">Medio de pago<select name="payment">${m.settings.payments.map(p => `<option value="${p}" ${keep.payment === p ? 'selected' : ''}>${{ efectivo: 'Efectivo', qr: 'QR / transferencia (comprobante)', tarjeta: 'Tarjeta' }[p] || e(p)}</option>`).join('')}</select></label>
    ${(keep.payment === 'qr') ? `<label class="f">N.º de comprobante<input name="voucher" value="${e(keep.voucher || '')}"></label>` : ''}
    <div class="card sum"><div><span>Subtotal</span><span>${bs(t.sub)}</span></div>${t.disc ? `<div style="color:var(--pickle)"><span>${e(t.promo)}</span><span>− ${bs(t.disc)}</span></div>` : ''}${mode === 'delivery' ? `<div><span>Envío</span><span>${zone ? bs(t.fee) : 'elige zona'}</span></div>` : ''}<div class="t"><span>Total</span><span>${bs(t.total)}</span></div></div>
    <button class="btn" style="width:100%" id="conf" ${(!m.open && !counter) ? 'disabled' : ''}>Confirmar pedido</button><div id="err" class="banner red" hidden></div></form>`;
    o.querySelector('[data-x]').onclick = () => { o.close(); onChange(); };
    o.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const [n, d] = b.dataset.q.split(':'); S.cart[n].qty += +d; if (S.cart[n].qty < 1) S.cart.splice(n, 1); saveCart(); draw(); });
    o.querySelectorAll('[name=mode],[name=payment],[name=zone]').forEach(i => i.onchange = draw);
    const sa = o.querySelector('#sa'); if (sa) sa.onchange = () => { const a = addrs.find(x => x.id === +sa.value); if (a) { keep.address = a.address; keep.zone = a.zone_id; draw(); o.querySelector('[name=address]').value = a.address; if (a.zone_id) o.querySelector('[name=zone]').value = a.zone_id; } };
    o.querySelector('#cf').onsubmit = async ev => {
      ev.preventDefault(); const f = ev.target, btn = o.querySelector('#conf'); btn.disabled = true; btn.textContent = 'Enviando…';
      S.key = S.key || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); // idempotencia (RNF-01)
      try {
        const r = await api('/orders', { method: 'POST', body: { key: S.key, channel: counter ? 'mostrador' : 'en_linea', mode: f.mode.value, customer: f.customer.value, phone: f.phone && f.phone.value, zone_id: f.zone && f.zone.value, address: f.address && f.address.value, ref: f.ref && f.ref.value, notes: f.notes.value, payment: f.payment.value, voucher: f.voucher && f.voucher.value, items: S.cart.map(({ pid, qty, mods, side, drink }) => ({ pid, qty, mods, side, drink })) } });
        S.cart = []; S.key = null; saveCart(); o.close();
        if (counter) { toast('Pedido ' + r.code + ' enviado a cocina'); viewMenu(true); } else { const h = ls.get('gx_h', []); h.unshift(r.code); ls.set('gx_h', h.slice(0, 10)); go('#/seguir/' + r.code); }
      } catch (er) { const x = o.querySelector('#err'); x.hidden = false; x.textContent = er.message; btn.disabled = false; btn.textContent = 'Confirmar pedido'; }
    };
  };
  draw();
}

/* ================= CLIENTE: seguimiento y cuenta ================= */
const STEPS = { delivery: ['Confirmado', 'En preparación', 'Listo', 'En camino', 'Entregado'], recojo: ['Confirmado', 'En preparación', 'Listo', 'Entregado'], mesa: ['Confirmado', 'En preparación', 'Listo', 'Entregado'] };
async function viewTrack(code) {
  if (!code) { const h = ls.get('gx_h', []); app.innerHTML = `<h1>Seguir mi pedido</h1><form class="card stack" id="tf"><label class="f">Código del pedido<input name="c" maxlength="6" required style="text-transform:uppercase" placeholder="Ej. K7M2QX"></label><button class="btn">Ver estado</button></form>${h.length ? `<h2 style="margin-top:1rem">Recientes</h2>${h.map(c => `<a class="chip" href="#/seguir/${e(c)}">${e(c)}</a> `).join('')}` : ''}`; $('#tf').onsubmit = ev => { ev.preventDefault(); go('#/seguir/' + ev.target.c.value.trim().toUpperCase()); }; return; }
  const draw = async () => {
    try {
      const o = await api('/track/' + encodeURIComponent(code)), st = STEPS[o.mode], idx = st.indexOf(o.status), dead = ['Cancelado', 'Rechazado'].includes(o.status);
      app.innerHTML = `<div class="card stack"><div class="row wrap"><div><small>Código de seguimiento</small><div class="code">${e(o.code)}</div></div><span class="tag ${dead ? 'r' : o.status === 'Entregado' ? 'g' : 'y'}" style="font-size:1rem">${e(o.status)}</span></div>
      ${dead ? `<div class="banner red">Este pedido fue ${o.status.toLowerCase()}.</div>` : `<div class="steps">${st.map((s, i) => `<div class="step ${i < idx || o.status === 'Entregado' ? 'done' : i === idx ? 'cur done' : ''}"><i></i>${s}</div>`).join('')}</div>${o.status !== 'Entregado' ? `<p>Tiempo estimado: <b>~${o.eta_min} min</b> desde la confirmación (${hm(o.created_at)}).</p>` : '<p><b>¡Buen provecho!</b></p>'}`}
      <div>${o.items.map(i => `<div class="row"><span>${i.qty}× ${e(i.name)}<small style="display:block;color:var(--mute)">${[i.sideName, i.drinkName, ...i.modNames].filter(Boolean).map(e).join(', ')}</small></span><span>${bs(i.unit * i.qty)}</span></div>`).join('')}</div>
      <div class="sum card"><div class="t"><span>Total</span><span>${bs(o.total)}</span></div></div>
      ${['Recibido', 'Confirmado'].includes(o.status) ? '<button class="btn bad" id="cx">Cancelar pedido</button>' : ''}</div>`;
      const cx = $('#cx'); if (cx) cx.onclick = async () => { if (confirm('¿Cancelar este pedido?')) try { await api(`/track/${code}/cancel`, { method: 'POST' }); draw(); } catch (er) { toast(er.message, 1); } };
    } catch (er) { app.innerHTML = `<div class="empty"><h2>${e(er.message)}</h2><a class="btn" href="#/seguir">Probar otro código</a></div>`; }
  };
  await draw(); every(5000, draw);
}
async function viewAccount() {
  if (S.user && STAFF.includes(S.user.role)) return go(HOME[S.user.role]);
  if (!S.user) {
    app.innerHTML = `<div class="grid"><form class="card stack" id="lf"><h2>Ingresar</h2><label class="f">Correo<input name="email" type="email" required autocomplete="email"></label><label class="f">Contraseña<input name="password" type="password" required autocomplete="current-password"></label><button class="btn">Ingresar</button></form>
    <form class="card stack" id="rf"><h2>Crear cuenta</h2><label class="f">Nombre<input name="name" required></label><label class="f">Teléfono<input name="phone" inputmode="tel"></label><label class="f">Correo<input name="email" type="email" required></label><label class="f">Contraseña (mín. 6)<input name="password" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn dark">Registrarme</button></form></div><p>Tampoco necesitas cuenta: puedes <a href="#/">pedir como invitado</a>.</p>`;
    const sub = (id, path) => $(id).onsubmit = async ev => { ev.preventDefault(); try { const r = await api(path, { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); setUser(r.token, r.user); go(HOME[r.user.role]); route(); } catch (er) { toast(er.message, 1); } };
    sub('#lf', '/auth/login'); sub('#rf', '/auth/register'); return;
  }
  const [orders, addrs, menu] = await Promise.all([api('/me/orders'), api('/me/addresses'), api('/menu')]);
  app.innerHTML = `<h1>Hola, ${e(S.user.name)}</h1><h2>Mis pedidos</h2>${orders.length ? `<div class="stack">${orders.map(o => `<div class="card row wrap"><div><b>${e(o.code)}</b> <span class="tag">${e(o.status)}</span><small style="display:block;color:var(--mute)">${new Date(o.created_at).toLocaleDateString('es-BO')} · ${o.items.map(i => i.qty + '× ' + e(i.name)).join(', ')}</small></div><div><b>${bs(o.total)}</b> <a class="btn ghost sm" href="#/seguir/${e(o.code)}">Ver</a> <button class="btn sm" data-r="${o.code}">Repetir</button></div></div>`).join('')}</div>` : '<div class="empty">Aún no tienes pedidos. <a href="#/">Mira la carta</a>.</div>'}
  <h2 style="margin-top:1.2rem">Mis direcciones</h2><div class="stack">${addrs.map(a => `<div class="card row"><span><b>${e(a.label)}</b> · ${e(a.address)}</span><button class="btn ghost sm" data-d="${a.id}">Eliminar</button></div>`).join('')}</div>
  <form class="card row wrap" id="af" style="margin-top:.7rem"><input class="in" name="label" placeholder="Etiqueta (Casa)" style="flex:1;min-width:110px"><input class="in" name="address" placeholder="Dirección" required minlength="5" style="flex:3;min-width:180px"><select class="in" name="zone_id" style="flex:2;min-width:140px">${menu.zones.map(z => `<option value="${z.id}">${e(z.name)}</option>`).join('')}</select><button class="btn dark">Guardar</button></form>`;
  app.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => { const o = orders.find(x => x.code === b.dataset.r); S.menu = menu; o.items.forEach(i => { const p = menu.products.find(x => x.id === i.pid); if (p && p.available) S.cart.push({ pid: i.pid, name: i.name, emoji: p.emoji, qty: i.qty, unit: i.unit, mods: i.mods, modNames: i.modNames, side: i.side, drink: i.drink, sideName: i.sideName, drinkName: i.drinkName }); }); saveCart(); toast('Productos agregados al carrito'); go('#/'); });
  app.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { await api('/me/addresses/' + b.dataset.d, { method: 'DELETE' }); viewAccount(); });
  $('#af').onsubmit = async ev => { ev.preventDefault(); try { await api('/me/addresses', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); viewAccount(); } catch (er) { toast(er.message, 1); } };
}
function viewStaffLogin() {
  app.innerHTML = `<form class="card stack" id="sf" style="max-width:420px;margin:2rem auto"><h1>Acceso del personal</h1><label class="f">Correo<input name="email" type="email" required></label><label class="f">Contraseña<input name="password" type="password" required></label><button class="btn dark">Ingresar</button><small>Demo: admin@gula.bo / admin123 · vendedor@gula.bo / vendedor123 · cocina@gula.bo / cocina123 · reparto@gula.bo / reparto123</small></form>`;
  $('#sf').onsubmit = async ev => { ev.preventDefault(); try { const r = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); setUser(r.token, r.user); go(HOME[r.user.role]); route(); } catch (er) { toast(er.message, 1); } };
}

/* ================= PERSONAL ================= */
const lines = o => `<ul style="padding-left:1.1rem;margin:.4rem 0">${o.items.map(i => `<li>${i.qty}× ${e(i.name)}<small>${[i.sideName && 'Acomp.: ' + i.sideName, i.drinkName && 'Bebida: ' + i.drinkName, ...i.modNames].filter(Boolean).map(e).join(' · ')}</small></li>`).join('')}</ul>`;
const mark = async (id, status, after) => { try { await api(`/orders/${id}/status`, { method: 'PATCH', body: { status } }); after && after(); } catch (er) { toast(er.message, 1); } };
async function viewKitchen() {
  if (!need(['cocinero', 'admin'])) return; document.body.classList.add('kitchen');
  const th = +((await api('/menu').catch(() => ({ settings: {} }))).settings.threshold || 15); let orders = [];
  const draw = () => {
    app.innerHTML = orders.length ? `<div class="kgrid">${orders.map(o => { const min = Math.floor((Date.now() - new Date(o.created_at)) / 60000), late = min >= th; return `<article class="ticket ${o.status === 'En preparación' ? 'prep' : ''} ${late ? 'late' : ''}"><div class="row"><b>#${e(o.code)}</b><span class="tm">${min} min</span></div><div><span class="tag ${o.mode === 'delivery' ? 'y' : 'g'}">${{ delivery: 'Delivery', recojo: 'Recojo', mesa: 'Mesa' }[o.mode]}</span> ${late ? '<span class="tag r">Demorado</span>' : ''}</div>${lines(o)}${o.notes ? `<div class="note">📝 ${e(o.notes)}</div>` : ''}<button class="btn ${o.status === 'Confirmado' ? '' : 'ok'}" data-id="${o.id}" data-to="${o.status === 'Confirmado' ? 'En preparación' : 'Listo'}">${o.status === 'Confirmado' ? 'Empezar a preparar' : 'Marcar listo'}</button></article>`; }).join('')}</div>` : '<div class="empty" style="color:#cfd2dc"><h1>Sin pedidos pendientes</h1><p>Los nuevos aparecerán aquí solos.</p></div>';
    app.querySelectorAll('[data-id]').forEach(b => b.onclick = () => mark(b.dataset.id, b.dataset.to, load));
  };
  const load = async () => { try { orders = await api('/orders'); draw(); } catch { } };
  S.refresh = load; await load(); every(10000, load); every(30000, draw);
}
async function viewCounter() { if (!need(['vendedor', 'admin'])) return; await viewMenu(true); }
async function viewDispatch() {
  if (!need(['vendedor', 'admin'])) return; const couriers = await api('/couriers');
  const load = async () => {
    const all = await api('/orders'), ready = all.filter(o => o.mode === 'delivery' && ['Listo', 'En preparación', 'Confirmado'].includes(o.status)), shift = all.filter(o => o.status === 'Listo' && o.mode !== 'delivery'), zones = {};
    ready.forEach(o => (zones[o.zone_name || '—'] = zones[o.zone_name || '—'] || []).push(o));
    app.innerHTML = `<h1>Despacho</h1>${Object.keys(zones).length ? Object.entries(zones).map(([z, a]) => `<h2>${e(z)}</h2><div class="grid">${a.map(o => `<div class="card stack"><div class="row"><b>#${e(o.code)}</b><span class="tag ${o.status === 'Listo' ? 'g' : ''}">${e(o.status)}</span></div><div>${e(o.customer)} · ${e(o.phone)}<br><small>${e(o.address)} ${e(o.ref)}</small></div><div class="row"><select class="in" data-c="${o.id}"><option value="">Repartidor…</option>${couriers.map(c => `<option value="${c.id}" ${c.id === o.courier_id ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select></div></div>`).join('')}</div>`).join('') : '<div class="empty">No hay pedidos de delivery en curso.</div>'}
    <h2>Listos para entregar en local</h2>${shift.length ? `<div class="grid">${shift.map(o => `<div class="card row"><span><b>#${e(o.code)}</b> ${e(o.customer)}</span><button class="btn ok sm" data-ok="${o.id}">Entregado</button></div>`).join('')}</div>` : '<div class="empty">Nada pendiente.</div>'}`;
    app.querySelectorAll('[data-c]').forEach(s => s.onchange = async () => { try { await api(`/orders/${s.dataset.c}/assign`, { method: 'PATCH', body: { courier_id: s.value } }); toast('Repartidor asignado'); } catch (er) { toast(er.message, 1); } });
    app.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => mark(b.dataset.ok, 'Entregado', load));
  };
  S.refresh = load; await load(); every(15000, load);
}
async function viewCourier() {
  if (!need(['repartidor', 'admin'])) return;
  const load = async () => {
    const os = await api('/orders').catch(() => []);
    app.innerHTML = `<h1>Mis entregas</h1>${os.length ? `<div class="stack">${os.map(o => `<div class="card stack"><div class="row"><b>#${e(o.code)}</b><span class="tag y">${e(o.status)}</span></div><div><b>${e(o.customer)}</b> · <a href="tel:${e(o.phone)}">${e(o.phone)}</a><br>${e(o.address)}<br><small>${e(o.ref)}</small></div>${lines(o)}<div class="row wrap"><a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent(o.address + ' Sucre')}">Abrir en mapa</a><button class="btn ok" data-id="${o.id}" data-to="${o.status === 'Listo' ? 'En camino' : 'Entregado'}">${o.status === 'Listo' ? 'Salí con el pedido' : 'Entregado'}</button></div><small>Cobrar: ${bs(o.total)} (${e(o.payment)})</small></div>`).join('')}</div>` : '<div class="empty">No tienes entregas asignadas.</div>'}`;
    app.querySelectorAll('[data-id]').forEach(b => b.onclick = () => mark(b.dataset.id, b.dataset.to, load));
  };
  S.refresh = load; await load(); every(10000, load);
}

/* ================= ADMINISTRACIÓN ================= */
const ENTITIES = {
  products: ['Carta', [['emoji', 'Ícono', 'text'], ['name', 'Nombre', 'text'], ['cat_id', 'Categoría', 'cat'], ['price', 'Precio', 'number'], ['descr', 'Descripción', 'text'], ['available', 'Disponible', 'bool']]],
  categories: ['Categorías', [['name', 'Nombre', 'text'], ['kind', 'Tipo', ['main', 'combo', 'side', 'drink']], ['sort', 'Orden', 'number'], ['active', 'Activa', 'bool']]],
  modifiers: ['Modificadores', [['name', 'Nombre', 'text'], ['price', 'Precio extra', 'number'], ['grp', 'Grupo', 'text'], ['single', 'Excluyente', 'bool'], ['active', 'Activo', 'bool']]],
  promos: ['Promociones', [['name', 'Nombre', 'text'], ['min_total', 'Mínimo Bs', 'number'], ['pct', '% descuento', 'number'], ['starts', 'Desde (AAAA-MM-DD)', 'text'], ['ends', 'Hasta', 'text'], ['active', 'Activa', 'bool']]],
  zones: ['Zonas', [['name', 'Zona', 'text'], ['fee', 'Envío Bs', 'number'], ['eta_min', 'Min. estimados', 'number'], ['active', 'Activa', 'bool']]]
};
async function viewAdmin(tab = 'reportes') {
  if (!need(['admin'])) return;
  const tabs = [['reportes', 'Reportes'], ...Object.entries(ENTITIES).map(([k, v]) => [k, v[0]]), ['usuarios', 'Usuarios'], ['ajustes', 'Horarios y pagos']];
  app.innerHTML = `<h1>Administración</h1><div class="sub">${tabs.map(([k, l]) => `<a class="chip ${k === tab ? 'on' : ''}" href="#/admin/${k}">${l}</a>`).join('')}</div><div id="ad"></div>`;
  const box = $('#ad');
  if (tab === 'reportes') return adminReports(box);
  if (tab === 'usuarios') return adminUsers(box);
  if (tab === 'ajustes') return adminSettings(box);
  const [title, cols] = ENTITIES[tab], rows = await api('/admin/' + tab), cats = tab === 'products' ? await api('/admin/categories') : [];
  const cell = (c, v, id) => { const [k, , t] = c, nm = `${k}`; if (t === 'bool') return `<input type="checkbox" data-k="${nm}" ${v ? 'checked' : ''}>`; if (t === 'cat') return `<select data-k="${nm}">${cats.map(x => `<option value="${x.id}" ${x.id === v ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select>`; if (Array.isArray(t)) return `<select data-k="${nm}">${t.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('')}</select>`; return `<input data-k="${nm}" type="${t}" step="any" value="${e(v ?? '')}">`; };
  box.innerHTML = `<div class="scroll"><table><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead><tbody>${[...rows, { id: 0 }].map(r => `<tr data-id="${r.id}">${cols.map(c => `<td>${cell(c, r[c[0]] ?? (c[2] === 'bool' ? true : ''), r.id)}</td>`).join('')}<td><button class="btn sm ${r.id ? '' : 'ok'}">${r.id ? 'Guardar' : 'Agregar'}</button></td></tr>`).join('')}</tbody></table></div>`;
  box.querySelectorAll('tr[data-id]').forEach(tr => tr.querySelector('button').onclick = async () => {
    const body = {}; tr.querySelectorAll('[data-k]').forEach(i => body[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value);
    try { await api('/admin/' + tab + (+tr.dataset.id ? '/' + tr.dataset.id : ''), { method: +tr.dataset.id ? 'PUT' : 'POST', body }); toast('Guardado'); if (!+tr.dataset.id) viewAdmin(tab); } catch (er) { toast(er.message, 1); }
  });
}
async function adminReports(box) {
  const d = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }), first = d.slice(0, 8) + '01';
  box.innerHTML = `<form class="row wrap" id="rf"><label class="f">Desde<input type="date" name="from" value="${first}"></label><label class="f">Hasta<input type="date" name="to" value="${d}"></label><button class="btn dark">Generar</button><button type="button" class="btn ghost" id="csv">Exportar CSV</button></form><div id="rp" style="margin-top:1rem"></div>`;
  const qs = () => { const f = new FormData($('#rf')); return `from=${f.get('from')}&to=${f.get('to')}`; };
  const run = async () => {
    const r = await api('/admin/reports/summary?' + qs()), max = a => Math.max(1, ...a.map(x => x.total || x.qty));
    const bars = (a, l) => a.length ? a.map(x => `<div class="row" style="margin:.3rem 0"><span style="width:110px">${e(l(x))}</span><div style="flex:1"><div class="bar" style="width:${(x.total ?? x.qty) / max(a) * 100}%"></div></div><b>${x.total !== undefined ? bs(x.total) + ' (' + x.orders + ')' : x.qty}</b></div>`).join('') : '<small>Sin datos en el período.</small>';
    $('#rp').innerHTML = `<div class="kpis"><div class="card kpi"><b>${bs(r.totals.sales)}</b><span>Ventas</span></div><div class="card kpi"><b>${r.totals.orders}</b><span>Pedidos</span></div><div class="card kpi"><b>${bs(r.totals.ticket)}</b><span>Ticket promedio</span></div><div class="card kpi"><b>${r.avgPrepMin ?? '–'} min</b><span>Preparación promedio</span></div><div class="card kpi"><b>${r.avgDeliveryMin ?? '–'} min</b><span>Entrega promedio</span></div><div class="card kpi"><b>${r.totals.cancelled}</b><span>Cancelados / rechazados</span></div></div>
    <div class="grid"><div class="card"><h3>Ventas por canal</h3>${bars(r.byChannel, x => ({ en_linea: 'En línea', mostrador: 'Mostrador' }[x.key]))}</div><div class="card"><h3>Por modalidad</h3>${bars(r.byMode, x => ({ delivery: 'Delivery', recojo: 'Recojo', mesa: 'Mesa' }[x.key]))}</div><div class="card"><h3>Productos más vendidos</h3>${bars(r.top, x => x.name)}</div><div class="card"><h3>Ventas por día</h3>${bars(r.byDay, x => x.key)}</div></div>`;
  };
  $('#rf').onsubmit = ev => { ev.preventDefault(); run(); };
  $('#csv').onclick = async () => { const r = await api('/admin/reports/summary?format=csv&' + qs(), { raw: true }), a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'reporte-gula.csv'; a.click(); };
  run();
}
async function adminUsers(box) {
  const us = await api('/admin/users');
  box.innerHTML = `<div class="scroll"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Activo</th></tr></thead><tbody>${us.map(u => `<tr><td>${e(u.name)}</td><td>${e(u.email)}</td><td><select data-u="${u.id}" data-f="role">${['admin', 'vendedor', 'cocinero', 'repartidor', 'cliente'].map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td><input type="checkbox" data-u="${u.id}" data-f="active" ${u.active ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>
  <form class="card row wrap" id="nu" style="margin-top:1rem"><input class="in" name="name" placeholder="Nombre" required style="flex:2;min-width:140px"><input class="in" name="email" type="email" placeholder="Correo" required style="flex:2;min-width:160px"><input class="in" name="password" type="password" minlength="6" placeholder="Contraseña" required style="flex:1;min-width:120px"><select class="in" name="role" style="flex:1;min-width:120px"><option>vendedor</option><option>cocinero</option><option>repartidor</option><option>admin</option></select><button class="btn ok">Crear usuario</button></form>`;
  box.querySelectorAll('[data-u]').forEach(i => i.onchange = async () => { try { await api('/admin/users/' + i.dataset.u, { method: 'PUT', body: { [i.dataset.f]: i.type === 'checkbox' ? i.checked : i.value } }); toast('Actualizado'); } catch (er) { toast(er.message, 1); viewAdmin('usuarios'); } });
  $('#nu').onsubmit = async ev => { ev.preventDefault(); try { await api('/admin/users', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); viewAdmin('usuarios'); } catch (er) { toast(er.message, 1); } };
}
async function adminSettings(box) {
  const s = await api('/admin/settings'), pays = (s.payments || '').split(',');
  box.innerHTML = `<form class="card stack" id="sf" style="max-width:520px"><div class="row"><label class="f" style="flex:1">Apertura<input type="time" name="open" value="${e(s.open)}"></label><label class="f" style="flex:1">Cierre<input type="time" name="close" value="${e(s.close)}"></label></div>
  <label class="opt"><input type="checkbox" name="force_open" ${s.force_open === '1' ? 'checked' : ''}><span>Forzar local abierto (ignora el horario)</span></label>
  <fieldset class="card"><legend><b>Medios de pago habilitados</b></legend>${[['efectivo', 'Efectivo'], ['qr', 'QR / transferencia'], ['tarjeta', 'Tarjeta']].map(([k, l]) => `<label class="opt"><input type="checkbox" data-p="${k}" ${pays.includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>
  <div class="row"><label class="f" style="flex:1">Umbral de demora en cocina (min)<input type="number" name="threshold" value="${e(s.threshold)}"></label><label class="f" style="flex:1">Preparación base (min)<input type="number" name="prep_base" value="${e(s.prep_base)}"></label></div>
  <label class="f">Teléfono del local<input name="phone" value="${e(s.phone)}"></label><button class="btn">Guardar ajustes</button></form>`;
  $('#sf').onsubmit = async ev => { ev.preventDefault(); const f = ev.target; try { await api('/admin/settings', { method: 'PUT', body: { open: f.open.value, close: f.close.value, force_open: f.force_open.checked ? '1' : '0', threshold: f.threshold.value, prep_base: f.prep_base.value, phone: f.phone.value, payments: [...f.querySelectorAll('[data-p]:checked')].map(i => i.dataset.p).join(',') || 'efectivo' } }); toast('Ajustes guardados'); } catch (er) { toast(er.message, 1); } };
}

/* ================= Enrutador ================= */
async function route() {
  S.timers.forEach(clearInterval); S.timers = []; S.refresh = null; document.body.classList.remove('kitchen'); header();
  const h = (location.hash || '#/').split('/'), p = h[1] || '', arg = h.slice(2).join('/');
  if (S.user) connect();
  app.innerHTML = '<div class="empty">Cargando…</div>';
  try {
    if (p === '') { if (S.user && STAFF.includes(S.user.role)) return go(HOME[S.user.role]); await viewMenu(false); }
    else if (p === 'seguir') await viewTrack(arg); else if (p === 'cuenta') await viewAccount(); else if (p === 'staff') S.user && STAFF.includes(S.user.role) ? go(HOME[S.user.role]) : viewStaffLogin();
    else if (p === 'cocina') await viewKitchen(); else if (p === 'mostrador') await viewCounter(); else if (p === 'despacho') await viewDispatch(); else if (p === 'reparto') await viewCourier(); else if (p === 'admin') await viewAdmin(arg || 'reportes');
    else if (p === 'salir') logout(); else app.innerHTML = '<div class="empty"><h2>Página no encontrada</h2><a class="btn" href="#/">Ir a la carta</a></div>';
  } catch (er) { app.innerHTML = `<div class="empty"><h2>${e(er.message)}</h2><button class="btn" onclick="route()">Reintentar</button></div>`; }
}
addEventListener('hashchange', route); route();
