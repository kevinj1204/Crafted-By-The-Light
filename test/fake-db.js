// Nagebootste Supabase voor tests en lokale preview.
import crypto from 'node:crypto';

export function fakeDb() {
  const t = {
    products: [], orders: [],
    settings: [
      { key: 'shop_open', value: true }, { key: 'shipping_nl', value: 695 }, { key: 'shipping_be', value: 995 },
      { key: 'vat_rate', value: 21 }, { key: 'accent', value: '#FFB000' }, { key: 'notify_email', value: 'info@thelightportraits.nl' },
      { key: 'announcement', value: 'Jouw naam erop ✦ Jouw kleur ✦ Verzending NL & BE ✦ iDEAL & Bancontact ✦ Gemaakt in Maastricht ✦' },
      { key: 'business', value: { name: 'Crafted By The Light (The Light Portraits)', address: 'Mergelweg 221, 6212 XE Maastricht',
        email: 'info@thelightportraits.nl', phone: '06 39 85 52 53', kvk: '', vat_id: '' } },
    ],
  };
  const files = {};
  const defaults = {
    products: () => ({ id: crypto.randomUUID(), photos: [], variants: [], colors: [], fields: [], active: false, featured: false,
      position: 0, glow: '#FFB000', created_at: new Date().toISOString() }),
    orders: () => ({ id: crypto.randomUUID(), status: 'open', fulfilment: 'nieuw', counted: false, mollie_id: null, tracking: null,
      note: null, paid_at: null, shipped_at: null, created_at: new Date().toISOString() }),
    settings: () => ({}),
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function q(table) {
    const filters = []; let op = 'select', payload = null, one = null, lim = null, ord = null;
    const run = () => {
      const rows = t[table];
      const match = (r) => filters.every((f) => f(r));
      let out;
      if (op === 'insert') {
        const items = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ ...defaults[table](), ...clone(p) }));
        for (const it of items) {
          if (it.slug && rows.some((r) => r.slug === it.slug)) return { data: null, error: new Error('dup') };
        }
        rows.push(...items); out = items;
      } else if (op === 'upsert') {
        for (const p of payload) { const r = rows.find((x) => x.key === p.key); r ? Object.assign(r, clone(p)) : rows.push(clone(p)); }
        out = payload;
      } else if (op === 'update') {
        out = rows.filter(match); out.forEach((r) => Object.assign(r, clone(payload)));
      } else if (op === 'delete') {
        out = rows.filter(match); t[table] = rows.filter((r) => !match(r));
      } else {
        out = rows.filter(match);
        if (ord) out = [...out].sort((a, b) => (a[ord.col] < b[ord.col] ? -1 : a[ord.col] > b[ord.col] ? 1 : 0) * (ord.asc ? 1 : -1));
        if (lim) out = out.slice(0, lim);
      }
      out = out.map(clone);
      if (one === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: new Error('not single') };
      if (one === 'maybe') return { data: out[0] || null, error: null };
      return { data: out, error: null };
    };
    const b = {
      select() { return b; },
      insert(p) { op = 'insert'; payload = p; return b; },
      upsert(p) { op = 'upsert'; payload = p; return b; },
      update(p) { op = 'update'; payload = p; return b; },
      delete() { op = 'delete'; return b; },
      eq(c, v) { filters.push((r) => r[c] === v); return b; },
      in(c, v) { filters.push((r) => v.includes(r[c])); return b; },
      order(c, o = {}) { ord = { col: c, asc: o.ascending !== false }; return b; },
      limit(n) { lim = n; return b; },
      single() { one = 'single'; return b; },
      maybeSingle() { one = 'maybe'; return b; },
      then(res, rej) { try { res(run()); } catch (e) { rej(e); } },
    };
    return b;
  }
  return {
    tables: t, files,
    from: q,
    async rpc(name, { p_order }) {
      if (name !== 'apply_paid_order') return { data: null };
      const o = t.orders.find((x) => x.id === p_order);
      if (!o || o.counted) return { data: false };
      Object.assign(o, { counted: true, status: 'paid', paid_at: new Date().toISOString() });
      for (const it of o.items) {
        const p = t.products.find((x) => x.id === it.product_id);
        const v = p?.variants.find((x) => x.id === it.variant_id);
        if (v && v.stock_mode === 'stock') v.stock = Math.max(0, (v.stock || 0) - it.qty);
      }
      return { data: true };
    },
    storage: { from: () => ({
      async upload(path, buf) { files[path] = buf; return { error: null }; },
      getPublicUrl(path) { return { data: { publicUrl: `https://cdn.test/${path}` } }; },
    }) },
  };
}
