// POST /api/checkout {items, customer, accept_terms, accept_no_return} – maakt bestelling + Mollie-betaling.
import { db, send, fail, body, baseUrl, getSettings, priceCart, mollie, euro, token, orderNumber } from './_lib.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Niet toegestaan');
  try {
    const b = body(req);
    const settings = await getSettings();
    if (settings.shop_open === false) return fail(res, 403, 'De shop is tijdelijk gesloten.');

    const c = b.customer || {};
    const customer = {
      first_name: clean(c.first_name, 60), last_name: clean(c.last_name, 60),
      email: clean(c.email, 160).toLowerCase(), phone: clean(c.phone, 30),
      street: clean(c.street), house: clean(c.house, 20), zip: clean(c.zip, 12).toUpperCase(),
      city: clean(c.city, 80), country: clean(c.country, 2).toUpperCase(), note: clean(c.note, 500),
    };
    customer.name = `${customer.first_name} ${customer.last_name}`.trim();
    for (const [k, label] of [['first_name', 'voornaam'], ['last_name', 'achternaam'], ['street', 'straat'],
      ['house', 'huisnummer'], ['zip', 'postcode'], ['city', 'plaats']]) {
      if (!customer[k]) return fail(res, 400, `Vul je ${label} in.`);
    }
    if (!EMAIL.test(customer.email)) return fail(res, 400, 'Vul een geldig e-mailadres in.');
    if (customer.country === 'NL' && !/^\d{4}\s?[A-Z]{2}$/.test(customer.zip)) return fail(res, 400, 'Vul een geldige Nederlandse postcode in (bijv. 6212 XE).');
    if (customer.country === 'BE' && !/^\d{4}$/.test(customer.zip)) return fail(res, 400, 'Vul een geldige Belgische postcode in (4 cijfers).');
    if (b.accept_terms !== true) return fail(res, 400, 'Ga akkoord met de algemene voorwaarden.');

    const slugs = [...new Set((b.items || []).map((i) => String(i.slug || '')))];
    const { data: products, error: pe } = await db().from('products').select('*').in('slug', slugs);
    if (pe) throw pe;
    const priced = priceCart(b.items, products || [], settings, customer.country);
    if (priced.items.some((i) => i.no_return) && b.accept_no_return !== true) {
      return fail(res, 400, 'Bevestig dat gepersonaliseerde producten niet geretourneerd kunnen worden.');
    }

    const { data: order, error } = await db().from('orders').insert({
      number: orderNumber(), token: token(18), customer, items: priced.items, country: customer.country,
      subtotal_cents: priced.subtotal, shipping_cents: priced.shipping, total_cents: priced.total, vat_cents: priced.vat,
    }).select('id,number,token').single();
    if (error) throw error;

    const base = baseUrl(req);
    let payment;
    try {
      payment = await mollie('payments', {
        method: 'POST',
        body: JSON.stringify({
          amount: { currency: 'EUR', value: euro(priced.total) },
          description: `Crafted By The Light ${order.number}`,
          redirectUrl: `${base}/bestelling?o=${order.id}&t=${order.token}`,
          webhookUrl: `${base}/api/mollie-webhook`,
          method: ['ideal', 'bancontact', 'creditcard'],
          locale: customer.country === 'BE' ? 'nl_BE' : 'nl_NL',
          metadata: { orderId: order.id, number: order.number },
        }),
      });
    } catch (e) {
      await db().from('orders').update({ status: 'failed' }).eq('id', order.id);
      throw e;
    }
    await db().from('orders').update({ mollie_id: payment.id, status: payment.status }).eq('id', order.id);
    send(res, 200, { checkoutUrl: payment._links.checkout.href });
  } catch (e) {
    if (e.status) return fail(res, e.status, e.message);
    console.error(e);
    fail(res, 500, 'De betaling kon niet worden gestart. Probeer het opnieuw.');
  }
}
