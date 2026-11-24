// POST /api/admin {action, ...} – backoffice. Vereist header x-admin-password.
import crypto from 'node:crypto';
import { db, send, fail, body, isAdmin, getSettings, baseUrl, slugify, httpError, BUCKET, normalizeProduct } from './_lib.js';
import { sendMail, shippedMail } from './_mail.js';

const FULFILMENT = ['nieuw', 'in_productie', 'verzonden', 'afgerond', 'geannuleerd'];
const HEX = /^#[0-9A-Fa-f]{6}$/;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const rid = () => crypto.randomBytes(4).toString('hex');

function cleanProduct(p) {
  const name = str(p.name, 120);
  if (!name) throw httpError(400, 'Geef het product een naam.');
  const variants = (Array.isArray(p.variants) ? p.variants : []).slice(0, 30).map((v) => {
    const price = Math.round(Number(String(v.price ?? '').replace(',', '.')) * 100);
    if (!Number.isFinite(price) || price < 50) throw httpError(400, `Vul een geldige prijs in bij "${str(v.name) || 'uitvoering'}".`);
    const mode = v.stock_mode === 'stock' ? 'stock' : 'order';
    return { id: str(v.id, 20) || rid(), name: str(v.name, 60) || 'Standaard', price_cents: price, stock_mode: mode,
      stock: mode === 'stock' ? Math.max(0, Math.floor(Number(v.stock) || 0)) : null, lead_time: str(v.lead_time, 60) };
  });
  if (!variants.length) throw httpError(400, 'Voeg minstens één uitvoering met prijs toe.');
  const colors = (Array.isArray(p.colors) ? p.colors : []).slice(0, 24)
    .map((c) => ({ name: str(c.name, 30), hex: HEX.test(c.hex) ? c.hex : '#888888' })).filter((c) => c.name);
  const fields = (Array.isArray(p.fields) ? p.fields : []).slice(0, 5)
    .map((f) => ({ id: str(f.id, 20) || rid(), label: str(f.label, 60), max: Math.min(200, Math.max(1, Math.floor(Number(f.max) || 20))), required: !!f.required }))
    .filter((f) => f.label);
  return {
    name, slug: slugify(p.slug || name), category: str(p.category, 40) || null, description: str(p.description, 4000) || null,
    photos: (Array.isArray(p.photos) ? p.photos : []).filter((u) => /^https?:\/\//.test(u)).slice(0, 10),
    glow: HEX.test(p.glow) ? p.glow : '#FFB000', variants, colors, fields,
    active: !!p.active, featured: !!p.featured, position: Math.floor(Number(p.position) || 0),
  };
}

const actions = {
  async overview() {
    const { data: orders, error } = await db().from('orders').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    const paid = orders.filter((o) => o.counted && o.status === 'paid');
    const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
    return {
      stats: {
        open: paid.filter((o) => ['nieuw', 'in_productie'].includes(o.fulfilment)).length,
        orders_month: paid.filter((o) => new Date(o.paid_at) >= month).length,
        revenue_month_cents: paid.filter((o) => new Date(o.paid_at) >= month).reduce((s, o) => s + o.total_cents, 0),
        revenue_total_cents: paid.reduce((s, o) => s + o.total_cents, 0),
      },
      orders,
    };
  },

  async products() {
    const { data, error } = await db().from('products').select('*').order('position', { ascending: true });
    if (error) throw error;
    return { products: (data || []).map(normalizeProduct) };
  },

  async saveProduct(req, b) {
    const clean = cleanProduct(b.product || {});
    // Unieke slug: bij een botsing met een ander product een nummer erachter.
    let slug = clean.slug; let n = 2;
    for (;;) {
      const { data: hit } = await db().from('products').select('id').eq('slug', slug).maybeSingle();
      if (!hit || hit.id === b.product.id) break;
      slug = `${clean.slug}-${n++}`;
    }
    clean.slug = slug;
    if (b.product.id) {
      const { error } = await db().from('products').update(clean).eq('id', b.product.id);
      if (error) throw error;
      return { ok: true, id: b.product.id, slug };
    }
    const { data, error } = await db().from('products').insert(clean).select('id').single();
    if (error) throw error;
    return { ok: true, id: data.id, slug };
  },

  async deleteProduct(req, b) {
    const { error } = await db().from('products').delete().eq('id', b.id);
    if (error) throw error;
    return { ok: true };
  },

  // Foto (al verkleind in de browser) als base64 → Supabase Storage.
  async upload(req, b) {
    const m = String(b.data || '').match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
    if (!m) throw httpError(400, 'Alleen JPG, PNG of WebP.');
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 3.5 * 1024 * 1024) throw httpError(400, 'Foto is te groot (max 3,5 MB).');
    const path = `${new Date().toISOString().slice(0, 7)}/${rid()}${rid()}.${m[2] === 'jpeg' ? 'jpg' : m[2]}`;
    const store = db().storage.from(BUCKET);
    const { error } = await store.upload(path, buf, { contentType: m[1], upsert: false });
    if (error) throw error;
    return { url: store.getPublicUrl(path).data.publicUrl };
  },

  async setFulfilment(req, b) {
    if (!FULFILMENT.includes(b.fulfilment)) throw httpError(400, 'Ongeldige status');
    const { data: prev } = await db().from('orders').select('*').eq('id', b.id).maybeSingle();
    if (!prev) throw httpError(404, 'Bestelling niet gevonden');
    const patch = { fulfilment: b.fulfilment };
    if ('tracking' in b) patch.tracking = str(b.tracking, 300) || null;
    if ('note' in b) patch.note = str(b.note, 1000) || null;
    if (b.fulfilment === 'verzonden' && prev.fulfilment !== 'verzonden') patch.shipped_at = new Date().toISOString();
    const { error } = await db().from('orders').update(patch).eq('id', b.id);
    if (error) throw error;
    let mailed = false;
    if (b.fulfilment === 'verzonden' && prev.fulfilment !== 'verzonden' && b.notify !== false) {
      try {
        const settings = await getSettings();
        const m = shippedMail({ ...prev, ...patch }, { settings, base: baseUrl(req) });
        await sendMail({ to: prev.customer.email, subject: m.subject, html: m.html, replyTo: settings.business.email });
        mailed = true;
      } catch (e) { console.error('Verzendmail niet verstuurd:', e); }
    }
    return { ok: true, mailed };
  },

  async settings() { return { settings: await getSettings() }; },

  async saveSettings(req, b) {
    const s = b.settings || {};
    const cents = (v) => Math.max(0, Math.round(Number(String(v ?? '').replace(',', '.')) * 100) || 0);
    const rows = [
      { key: 'shop_open', value: !!s.shop_open },
      { key: 'shipping_nl', value: cents(s.shipping_nl) },
      { key: 'shipping_be', value: cents(s.shipping_be) },
      { key: 'vat_rate', value: Math.min(30, Math.max(0, Number(s.vat_rate) || 0)) },
      { key: 'accent', value: HEX.test(s.accent) ? s.accent : '#FFB000' },
      { key: 'notify_email', value: str(s.notify_email, 160) },
      { key: 'announcement', value: str(s.announcement, 300) },
      { key: 'business', value: Object.fromEntries(['name', 'address', 'email', 'phone', 'kvk', 'vat_id'].map((k) => [k, str((s.business || {})[k], 160)])) },
    ];
    const { error } = await db().from('settings').upsert(rows);
    if (error) throw error;
    return { ok: true };
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Niet toegestaan');
  if (!isAdmin(req)) return fail(res, 401, 'Wachtwoord klopt niet.');
  const b = body(req);
  const fn = actions[b.action];
  if (!fn) return fail(res, 400, 'Onbekende actie');
  try {
    send(res, 200, await fn(req, b));
  } catch (e) {
    if (e.status) return fail(res, e.status, e.message);
    console.error(e);
    fail(res, 500, 'Er ging iets mis. Probeer het opnieuw.');
  }
}
