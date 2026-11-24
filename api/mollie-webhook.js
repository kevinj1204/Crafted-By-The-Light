// POST /api/mollie-webhook – Mollie meldt een statuswijziging (id=tr_...).
// We vertrouwen de melding zelf niet, maar halen de status altijd zelf bij Mollie op.
import { db, send, fail, body, syncOrder } from './_lib.js';
import { afterPaid } from './_paid.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Niet toegestaan');
  const id = String(body(req).id || '');
  if (!/^tr_[A-Za-z0-9]+$/.test(id)) return send(res, 200, { ok: true });
  try {
    const { data: order } = await db().from('orders').select('*').eq('mollie_id', id).maybeSingle();
    if (!order) return send(res, 200, { ok: true });
    const { order: fresh, justPaid } = await syncOrder(order);
    if (justPaid) await afterPaid(req, fresh);
    send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    fail(res, 500, 'retry');
  }
}
