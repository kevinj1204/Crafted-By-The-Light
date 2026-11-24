// GET /api/order?o=<id>&t=<token> – status van een bestelling voor de klant.
import crypto from 'node:crypto';
import { db, send, fail, syncOrder } from './_lib.js';
import { afterPaid } from './_paid.js';

const same = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'Niet toegestaan');
  try {
    const { o, t } = req.query || {};
    if (!o || !t) return fail(res, 404, 'Bestelling niet gevonden.');
    let { data: order } = await db().from('orders').select('*').eq('id', String(o)).maybeSingle();
    if (!order || !same(order.token, t)) return fail(res, 404, 'Bestelling niet gevonden.');
    // Komt de klant terug vóór de webhook: status zelf ophalen (de webhook blijft leidend en idempotent).
    if (!order.counted && order.mollie_id) {
      try {
        const r = await syncOrder(order);
        order = r.order;
        if (r.justPaid) await afterPaid(req, order);
      } catch (e) { console.error(e); }
    }
    send(res, 200, {
      number: order.number, status: order.status, fulfilment: order.fulfilment, tracking: order.tracking,
      items: order.items.map(({ name, variant, color, personal, qty, unit_cents, no_return }) => ({ name, variant, color, personal, qty, unit_cents, no_return })),
      subtotal_cents: order.subtotal_cents, shipping_cents: order.shipping_cents, total_cents: order.total_cents,
      vat_cents: order.vat_cents, country: order.country, first_name: order.customer.first_name,
    });
  } catch (e) {
    console.error(e);
    fail(res, 500, 'De bestelling kon niet worden geladen.');
  }
}
