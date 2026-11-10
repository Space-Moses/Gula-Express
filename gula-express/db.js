'use strict';
const bcrypt = require('bcryptjs');
let pool;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false } });
} else {
  console.log('[db] Sin DATABASE_URL: usando PostgreSQL en memoria (solo desarrollo).');
  pool = new (require('pg-mem').newDb().adapters.createPg().Pool)();
}
const q = (s, p) => pool.query(s, p).then(r => r.rows);

const SCHEMA = [
`create table if not exists users(id serial primary key, name text not null, email text unique not null, phone text, pass_hash text not null, role text not null, active boolean default true)`,
`create table if not exists categories(id serial primary key, name text not null, kind text not null, sort int default 0, active boolean default true)`,
`create table if not exists products(id serial primary key, cat_id int not null, name text not null, descr text, price double precision not null, emoji text, available boolean default true)`,
`create table if not exists modifiers(id serial primary key, name text not null, price double precision default 0, grp text not null, single boolean default false, active boolean default true)`,
`create table if not exists zones(id serial primary key, name text not null, fee double precision not null, eta_min int not null, active boolean default true)`,
`create table if not exists promos(id serial primary key, name text not null, min_total double precision default 0, pct double precision not null, starts text, ends text, active boolean default true)`,
`create table if not exists settings(k text primary key, v text)`,
`create table if not exists addresses(id serial primary key, user_id int not null, label text, address text not null, zone_id int)`,
`create table if not exists orders(id serial primary key, code text unique not null, idem text unique, channel text not null, mode text not null, status text not null, user_id int, customer text, phone text, address text, ref text, zone_id int, zone_name text, notes text, payment text, voucher text, items text not null, subtotal double precision, discount double precision, promo text, fee double precision, total double precision, eta_min int, courier_id int, created_at timestamptz default now())`,
`create table if not exists order_events(id serial primary key, order_id int not null, status text not null, user_id int, user_name text, at timestamptz default now())`
];

async function init() {
  for (const s of SCHEMA) await q(s);
  if ((await q('select id from users limit 1')).length) return;
  const h = p => bcrypt.hashSync(p, 10);
  for (const [n, e, p, r] of [['Administrador Gula', 'admin@gula.bo', 'admin123', 'admin'], ['Vendedor Mostrador', 'vendedor@gula.bo', 'vendedor123', 'vendedor'], ['Cocinero Principal', 'cocina@gula.bo', 'cocina123', 'cocinero'], ['Repartidor Uno', 'reparto@gula.bo', 'reparto123', 'repartidor'], ['Cliente Demo', 'cliente@gula.bo', 'cliente123', 'cliente']])
    await q('insert into users(name,email,pass_hash,role) values($1,$2,$3,$4)', [n, e, h(p), r]);
  const cats = [['Hamburguesas', 'main'], ['Combos', 'combo'], ['Acompañamientos', 'side'], ['Bebidas', 'drink']];
  for (let i = 0; i < cats.length; i++) await q('insert into categories(name,kind,sort) values($1,$2,$3)', [cats[i][0], cats[i][1], i]);
  const P = [
    [1, 'Gula Clásica', 'Carne 150 g, queso cheddar, lechuga, tomate y salsa de la casa.', 32, '🍔'],
    [1, 'Doble Gula', 'Doble carne, doble queso, cebolla caramelizada y pepinillos.', 45, '🍔'],
    [1, 'BBQ Bacon', 'Carne, tocino crocante, aros de cebolla y salsa BBQ ahumada.', 42, '🥓'],
    [1, 'Pollo Crispy', 'Pechuga crocante, mayonesa de ají y repollo fresco.', 36, '🍗'],
    [1, 'Veggie', 'Medallón de lentejas y quinua, palta y brotes.', 34, '🥬'],
    [2, 'Combo Clásico', 'Gula Clásica + acompañamiento y bebida a elección.', 48, '🍟'],
    [2, 'Combo Doble', 'Doble Gula + acompañamiento y bebida a elección.', 62, '🍟'],
    [3, 'Papas fritas', 'Porción mediana, sal marina.', 14, '🍟'],
    [3, 'Aros de cebolla', 'Rebozados y crocantes.', 16, '🧅'],
    [3, 'Nuggets x6', 'Con salsa a elección.', 18, '🍗'],
    [4, 'Coca-Cola 500 ml', 'Bien fría.', 10, '🥤'],
    [4, 'Limonada de la casa', 'Con hierbabuena.', 12, '🍋'],
    [4, 'Agua mineral', 'Sin gas, 500 ml.', 7, '💧']
  ];
  for (const p of P) await q('insert into products(cat_id,name,descr,price,emoji) values($1,$2,$3,$4,$5)', p);
  const M = [['Término medio', 0, 'coccion', true], ['Tres cuartos', 0, 'coccion', true], ['Bien cocida', 0, 'coccion', true], ['Extra tocino', 6, 'extra', false], ['Extra carne', 15, 'extra', false], ['Extra queso', 4, 'queso', true], ['Sin queso', 0, 'queso', true], ['Sin cebolla', 0, 'quitar', false], ['Sin tomate', 0, 'quitar', false], ['Sin salsa', 0, 'quitar', false]];
  for (const m of M) await q('insert into modifiers(name,price,grp,single) values($1,$2,$3,$4)', m);
  for (const z of [['Centro', 8, 30], ['Sur / Av. del Maestro', 10, 40], ['Norte / Parque Bolívar', 10, 40], ['Alrededores', 15, 55]]) await q('insert into zones(name,fee,eta_min) values($1,$2,$3)', z);
  await q('insert into promos(name,min_total,pct) values($1,$2,$3)', ['10% en pedidos desde Bs 80', 80, 10]);
  for (const [k, v] of [['open', '10:00'], ['close', '23:59'], ['force_open', '0'], ['payments', 'efectivo,qr,tarjeta'], ['threshold', '15'], ['prep_base', '12'], ['phone', '+591 4 000 0000']])
    await q('insert into settings(k,v) values($1,$2)', [k, v]);
}
module.exports = { q, init };
