// Gedeelde hulpfuncties voor alle /api-functies.
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

export const BUCKET = 'producten';
export const MAX_QTY = 20;

let _db = globalThis.__cbtlDb || null;
export function db() {
  if (_db) return _db;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt');
  _db = createClient(url, key, { auth: { persistSession: false } });
  return _db;
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
export const fail = (res, status, message) => send(res, status, { error: message });
export const httpError = (status, message) => Object.assign(new Error(message), { status });

export function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}`;
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return Object.fromEntries(new URLSearchParams(req.body)); }
  }
  return {};
}

export const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
export const euro = (cents) => (cents / 100).toFixed(2);
export const euroNl = (cents) => '€ ' + (cents / 100).toFixed(2).replace('.', ',');

export function slugify(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'product';
}

const DEFAULT_SETTINGS = {
  shop_open: true, shipping_nl: 695, shipping_be: 995, vat_rate: 21, accent: '#FFB000',
  notify_email: 'info@thelightportraits.nl', announcement: '',
  business: { name: 'Crafted By The Light', address: '', email: '', phone: '', kvk: '', vat_id: '' },
};
export async function getSettings() {
  const { data, error } = await db().from('settings').select('key,value');
  if (error) throw error;
  const s = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return { ...DEFAULT_SETTINGS, ...s, business: { ...DEFAULT_SETTINGS.business, ...(s.business || {}) } };
}
export function publicSettings(s) {
  return { shop_open: s.shop_open !== false, shipping: { NL: s.shipping_nl, BE: s.shipping_be }, vat_rate: s.vat_rate,
    accent: s.accent, announcement: s.announcement, business: s.business };
}

// ---- Producten ----------------------------------------------------------------
// Een product zonder varianten krijgt één standaardvariant, zodat de rest van de code één vorm kent.
export function normalizeProduct(p) {
  const variants = Array.isArray(p.variants) && p.variants.length ? p.variants : [];
  return { ...p, variants, colors: p.colors || [], fields: p.fields || [] };
}
export const variantAvailable = (v) => v.stock_mode !== 'stock' || Number(v.stock) > 0;
export const noReturn = (p) => (p.fields || []).some((f) => f.required);

export function publicProduct(raw) {
  const p = normalizeProduct(raw);
  const prices = p.variants.map((v) => v.price_cents).filter((n) => Number.isFinite(n));
  return {
    slug: p.slug, name: p.name, category: p.category || '', description: p.description || '',
    photos: p.photos || [], glow: p.glow || '#FFB000', featured: !!p.featured,
    from_cents: prices.length ? Math.min(...prices) : null,
    variants: p.variants.map((v) => ({ id: v.id, name: v.name, price_cents: v.price_cents,
      available: variantAvailable(v), stock_mode: v.stock_mode || 'order',
      stock: v.stock_mode === 'stock' ? Math.max(0, Number(v.stock) || 0) : null,
      lead_time: v.stock_mode === 'stock' ? (v.lead_time || '1-2 werkdagen') : (v.lead_time || '') })),
    colors: p.colors, fields: p.fields.map((f) => ({ id: f.id, label: f.label, max: f.max || 20, required: !!f.required })),
    no_return: noReturn(p),
  };
}

// Prijs en regels altijd op de server opnieuw bepalen: de browser bepaalt nooit de prijs.
export function priceCart(cartItems, products, settings, country) {
  if (!Array.isArray(cartItems) || !cartItems.length) throw httpError(400, 'Je mandje is leeg.');
  if (cartItems.length > 30) throw httpError(400, 'Te veel regels in je mandje.');
  if (!['NL', 'BE'].includes(country)) throw httpError(400, 'We verzenden naar Nederland en België.');
  const bySlug = new Map(products.map((p) => [p.slug, normalizeProduct(p)]));
  const items = cartItems.map((ci) => {
    const p = bySlug.get(String(ci.slug || ''));
    if (!p || !p.active) throw httpError(400, 'Een product in je mandje is niet meer beschikbaar.');
    const v = p.variants.find((x) => x.id === ci.variant_id);
    if (!v) throw httpError(400, `Kies een uitvoering voor ${p.name}.`);
    const qty = Number(ci.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw httpError(400, 'Ongeldig aantal.');
    if (!variantAvailable(v)) throw httpError(400, `${p.name} (${v.name}) is uitverkocht.`);
    if (v.stock_mode === 'stock' && qty > Number(v.stock)) throw httpError(400, `Van ${p.name} (${v.name}) zijn er nog ${v.stock} op voorraad.`);
    let color = null;
    if (p.colors.length) {
      color = p.colors.find((c) => c.name === ci.color);
      if (!color) throw httpError(400, `Kies een kleur voor ${p.name}.`);
    }
    const personal = {};
    for (const f of p.fields) {
      const val = String((ci.personal || {})[f.id] ?? '').trim().slice(0, f.max || 20);
      if (f.required && !val) throw httpError(400, `Vul "${f.label}" in voor ${p.name}.`);
      if (val) personal[f.label] = val;
    }
    return { product_id: p.id, variant_id: v.id, slug: p.slug, name: p.name, variant: v.name, color: color?.name || null,
      personal, qty, unit_cents: v.price_cents, no_return: noReturn(p),
      lead_time: v.stock_mode === 'stock' ? (v.lead_time || '1-2 werkdagen') : (v.lead_time || '') };
  });
  const subtotal = items.reduce((s, i) => s + i.unit_cents * i.qty, 0);
  const shipping = Number(country === 'NL' ? settings.shipping_nl : settings.shipping_be) || 0;
  const total = subtotal + shipping;
  const rate = Number(settings.vat_rate) || 0;
  const vat = Math.round(total * rate / (100 + rate));
  return { items, subtotal, shipping, total, vat };
}

export function orderNumber() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `CBTL-${ymd}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

// ---- Mollie -------------------------------------------------------------------
export async function mollie(path, options = {}) {
  const key = process.env.MOLLIE_API_KEY;
  if (!key) throw new Error('MOLLIE_API_KEY ontbreekt');
  const r = await fetch(`https://api.mollie.com/v2/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mollie ${r.status}: ${data.detail || data.title || 'onbekende fout'}`);
  return data;
}

// Haal de actuele status bij Mollie op en verwerk die. Veilig om vaker aan te roepen.
// Geeft { order, justPaid } terug; justPaid is alleen true bij de allereerste verwerking.
export async function syncOrder(order) {
  if (!order.mollie_id) return { order, justPaid: false };
  const p = await mollie(`payments/${encodeURIComponent(order.mollie_id)}`);
  if (p.metadata?.orderId && p.metadata.orderId !== order.id) throw new Error('Betaling hoort niet bij deze bestelling');
  let justPaid = false;
  if (p.status === 'paid') {
    const { data } = await db().rpc('apply_paid_order', { p_order: order.id });
    justPaid = data === true;
    if (Number(p.amountChargedBack?.value || 0) > 0) {
      await db().from('orders').update({ status: 'charged_back' }).eq('id', order.id);
    } else if (Number(p.amountRefunded?.value || 0) > 0) {
      await db().from('orders').update({ status: 'refunded' }).eq('id', order.id);
    }
  } else if (!order.counted && p.status !== order.status) {
    await db().from('orders').update({ status: p.status }).eq('id', order.id);
  }
  const { data } = await db().from('orders').select('*').eq('id', order.id).single();
  return { order: data || order, justPaid };
}

// ---- Beheer -------------------------------------------------------------------
export function isAdmin(req) {
  const expected = process.env.ADMIN_PASSWORD;
  const given = req.headers['x-admin-password'];
  if (!expected || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
