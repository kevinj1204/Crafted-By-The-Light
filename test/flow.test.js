// End-to-end test van de API met een nagebootste Supabase, Mollie en Resend (geen echte accounts nodig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fakeDb } from './fake-db.js';

const payments = {};
const mails = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://api.resend.com/emails') { mails.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ id: 'm' }) }; }
  if (u === 'https://api.mollie.com/v2/payments' && opts.method === 'POST') {
    const b = JSON.parse(opts.body);
    const id = 'tr_' + crypto.randomBytes(5).toString('hex');
    payments[id] = { id, status: 'open', amount: b.amount, metadata: b.metadata, method: b.method, redirectUrl: b.redirectUrl,
      _links: { checkout: { href: `https://mollie.test/checkout/${id}` } } };
    return { ok: true, status: 201, json: async () => payments[id] };
  }
  const m = u.match(/payments\/(tr_\w+)$/);
  if (m && payments[m[1]]) return { ok: true, status: 200, json: async () => payments[m[1]] };
  return { ok: false, status: 404, json: async () => ({ detail: 'not found' }) };
};

const db = fakeDb();
globalThis.__cbtlDb = db;
process.env.ADMIN_PASSWORD = 'geheim';
process.env.MOLLIE_API_KEY = 'test_x';
process.env.PUBLIC_BASE_URL = 'https://crafted.test';
process.env.RESEND_API_KEY = 're_test';

async function call(mod, { method = 'GET', query = {}, body, headers = {} } = {}) {
  const handler = (await import(`../api/${mod}.js`)).default;
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = s; } };
  await handler({ method, query, body, headers }, res);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}
const admin = (action, extra = {}) => call('admin', { method: 'POST', headers: { 'x-admin-password': 'geheim' }, body: { action, ...extra } });

const customer = { first_name: 'Kim', last_name: 'Peeters', email: 'Kim@Test.be', street: 'Kerkstraat', house: '1',
  zip: '3500', city: 'Hasselt', country: 'BE' };

let vaasId, lampId, vaas, lamp;

test('backoffice: wachtwoord is verplicht', async () => {
  const r = await call('admin', { method: 'POST', headers: { 'x-admin-password': 'fout' }, body: { action: 'overview' } });
  assert.equal(r.status, 401);
});

test('backoffice: producten aanmaken met varianten, kleuren en personalisatie', async () => {
  let r = await admin('saveProduct', { product: { name: 'Naamlamp', active: true, featured: true,
    variants: [{ name: 'Klein', price: '24,95', stock_mode: 'order', lead_time: '3-5 werkdagen' }, { name: 'Groot', price: '34,95', stock_mode: 'order' }],
    colors: [{ name: 'Wit', hex: '#FFFFFF' }, { name: 'Zwart', hex: '#111111' }],
    fields: [{ label: 'Naam', max: 12, required: true }] } });
  assert.equal(r.status, 200); lampId = r.data.id; assert.equal(r.data.slug, 'naamlamp');

  r = await admin('saveProduct', { product: { name: 'Spiraalvaas', active: true,
    variants: [{ name: 'Standaard', price: '19.50', stock_mode: 'stock', stock: 2 }] } });
  vaasId = r.data.id;

  r = await admin('saveProduct', { product: { name: 'Naamlamp', variants: [{ name: 'x', price: '5' }] } });
  assert.equal(r.data.slug, 'naamlamp-2', 'dubbele slug krijgt een nummer');
  await admin('deleteProduct', { id: r.data.id });

  r = await admin('saveProduct', { product: { name: 'Zonder prijs', variants: [{ name: 'x', price: '' }] } });
  assert.equal(r.status, 400);

  const pub = await call('public');
  assert.equal(pub.data.products.length, 2);
  lamp = pub.data.products.find((p) => p.slug === 'naamlamp');
  vaas = pub.data.products.find((p) => p.slug === 'spiraalvaas');
  assert.equal(lamp.from_cents, 2495);
  assert.equal(lamp.no_return, true);
  assert.equal(vaas.no_return, false);
  assert.equal(vaas.variants[0].stock, 2);
});

test('checkout: prijzen worden op de server berekend en validatie werkt', async () => {
  const items = [
    { slug: 'naamlamp', variant_id: lamp.variants[1].id, color: 'Zwart', personal: { [lamp.fields[0].id]: 'Hunter' }, qty: 1 },
    { slug: 'spiraalvaas', variant_id: vaas.variants[0].id, qty: 2, unit_cents: 1 },
  ];
  let r = await call('checkout', { method: 'POST', body: { items, customer, accept_terms: true } });
  assert.equal(r.status, 400, 'zonder akkoord geen-retour mag het niet');
  assert.match(r.data.error, /gepersonaliseerde/);

  r = await call('checkout', { method: 'POST', body: { items: [{ ...items[0], personal: {} }], customer, accept_terms: true, accept_no_return: true } });
  assert.equal(r.status, 400); assert.match(r.data.error, /Naam/);

  r = await call('checkout', { method: 'POST', body: { items: [{ ...items[1], qty: 3 }], customer, accept_terms: true } });
  assert.equal(r.status, 400); assert.match(r.data.error, /nog 2 op voorraad/);

  r = await call('checkout', { method: 'POST', body: { items, customer: { ...customer, zip: '6212XE' }, accept_terms: true, accept_no_return: true } });
  assert.equal(r.status, 400, 'Belgische postcode check');

  r = await call('checkout', { method: 'POST', body: { items, customer, accept_terms: true, accept_no_return: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const pay = Object.values(payments).at(-1);
  assert.equal(pay.amount.value, '83.90', '34,95 + 2×19,50 + 9,95 verzending BE');
  assert.deepEqual(pay.method, ['ideal', 'bancontact', 'creditcard']);
  const order = db.tables.orders.at(-1);
  assert.equal(order.vat_cents, Math.round(8390 * 21 / 121));
  assert.equal(order.items[0].personal.Naam, 'Hunter');
  assert.equal(order.customer.email, 'kim@test.be');
});

test('betaling: webhook verwerkt precies één keer, boekt voorraad af en mailt', async () => {
  const order = db.tables.orders.at(-1);
  payments[order.mollie_id].status = 'paid';
  await call('mollie-webhook', { method: 'POST', body: { id: order.mollie_id } });
  await call('mollie-webhook', { method: 'POST', body: { id: order.mollie_id } });
  assert.equal(order.status, 'paid');
  assert.equal(db.tables.products.find((p) => p.id === vaasId).variants[0].stock, 0);
  assert.equal(mails.length, 2, 'één bevestiging + één melding, niet dubbel');
  assert.deepEqual(mails[0].to, ['kim@test.be']);
  assert.match(mails[0].html, /Hunter/);
  assert.deepEqual(mails[1].to, ['info@thelightportraits.nl']);

  const pub = await call('public', { query: { slug: 'spiraalvaas' } });
  assert.equal(pub.data.product.variants[0].available, false, 'uitverkocht na verkoop');
});

test('klant ziet bestelling alleen met juiste token', async () => {
  const order = db.tables.orders.at(-1);
  let r = await call('order', { query: { o: order.id, t: 'fout' } });
  assert.equal(r.status, 404);
  r = await call('order', { query: { o: order.id, t: order.token } });
  assert.equal(r.data.status, 'paid');
  assert.equal(r.data.items.length, 2);
  assert.equal(r.data.customer, undefined, 'geen adresgegevens naar buiten');
});

test('backoffice: verzenden met track & trace stuurt mail', async () => {
  const order = db.tables.orders.at(-1);
  const r = await admin('setFulfilment', { id: order.id, fulfilment: 'verzonden', tracking: 'https://postnl.test/3SABC' });
  assert.equal(r.data.mailed, true);
  assert.match(mails.at(-1).subject, /onderweg/);
  const o = await admin('overview');
  assert.equal(o.data.stats.revenue_total_cents, 8390);
});

test('backoffice: instellingen opslaan en foto uploaden', async () => {
  let r = await admin('saveSettings', { settings: { shop_open: true, shipping_nl: '5,95', shipping_be: '8,95', vat_rate: 21,
    accent: '#00E5FF', business: { name: 'CBTL', kvk: '12345678' } } });
  assert.equal(r.status, 200);
  const pub = await call('public');
  assert.equal(pub.data.settings.shipping.NL, 595);
  assert.equal(pub.data.settings.accent, '#00E5FF');
  r = await admin('upload', { data: 'data:image/png;base64,' + Buffer.from('x').toString('base64') });
  assert.match(r.data.url, /^https:\/\/cdn\.test\/.+\.png$/);
});

test('gesloten shop neemt geen bestellingen aan', async () => {
  await admin('saveSettings', { settings: { shop_open: false } });
  const r = await call('checkout', { method: 'POST', body: { items: [], customer, accept_terms: true } });
  assert.equal(r.status, 403);
  await admin('saveSettings', { settings: { shop_open: true, shipping_nl: '6,95', shipping_be: '9,95', vat_rate: 21 } });
});
