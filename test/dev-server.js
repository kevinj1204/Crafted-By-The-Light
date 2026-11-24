// Lokale preview met testdata: npm run dev  →  http://localhost:3000  (beheer-wachtwoord: test)
// Gebruikt een nep-database en nep-Mollie (betalingen slagen meteen). Niet voor productie.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeDb } from './fake-db.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const db = fakeDb();
globalThis.__cbtlDb = db;
process.env.ADMIN_PASSWORD ||= 'test';
process.env.MOLLIE_API_KEY ||= 'test_dev';
process.env.PUBLIC_BASE_URL = `http://localhost:${PORT}`;

const pays = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.mollie.com/')) return realFetch(url, opts);
  if (opts.method === 'POST') {
    const b = JSON.parse(opts.body);
    const id = 'tr_dev' + Object.keys(pays).length;
    pays[id] = { id, status: 'paid', amount: b.amount, metadata: b.metadata, _links: { checkout: { href: b.redirectUrl } } };
    return { ok: true, status: 201, json: async () => pays[id] };
  }
  const id = u.split('/').pop();
  return { ok: true, status: 200, json: async () => pays[id] };
};

// Voorbeeldproducten (alleen voor de preview; de echte shop begint leeg).
const v = (id, name, price_cents, stock_mode = 'order', stock = null, lead_time = '3-5 werkdagen') => ({ id, name, price_cents, stock_mode, stock, lead_time });
const filament = [{ name: 'Zwart', hex: '#1A1A1A' }, { name: 'Wit', hex: '#F2F0EA' }, { name: 'Amber', hex: '#FFB000' }, { name: 'Cyaan', hex: '#00E5FF' }, { name: 'Magenta', hex: '#FF3DCB' }];
const demo = [
  { slug: 'naamlamp', name: 'Naamlamp', category: 'Verlichting', glow: '#FFB000', featured: true,
    description: 'Een lamp met jouw naam erin, die zacht oplicht in het donker.\nInclusief LED-voet met USB-kabel.',
    variants: [v('s', 'Klein · 15 cm', 2995), v('m', 'Groot · 22 cm', 3995)], colors: filament.slice(0, 3),
    fields: [{ id: 'naam', label: 'Naam', max: 12, required: true }] },
  { slug: 'spiraalvaas', name: 'Spiraalvaas', category: 'Woonaccessoires', glow: '#00E5FF', featured: true,
    description: 'Vaas met een gedraaid patroon dat het licht vangt. Waterdicht met een glazen inzet.',
    variants: [v('std', 'Standaard', 2450, 'stock', 4, '1-2 werkdagen')], colors: filament },
  { slug: 'sleutelhanger', name: 'Sleutelhanger met naam', category: 'Cadeaus', glow: '#FF3DCB', featured: true,
    description: 'Stevige sleutelhanger met jouw naam of korte tekst.',
    variants: [v('std', 'Standaard', 795, 'order', null, '2-4 werkdagen')], colors: filament,
    fields: [{ id: 't', label: 'Tekst', max: 10, required: true }] },
  { slug: 'telefoonstandaard', name: 'Telefoonstandaard', category: 'Woonaccessoires', glow: '#B6FF3B',
    description: 'Minimalistische standaard voor je telefoon op je bureau of nachtkastje.',
    variants: [v('std', 'Standaard', 1495, 'stock', 0, '1-2 werkdagen')], colors: filament.slice(0, 2) },
];
demo.forEach((p, i) => db.tables.products.push({ id: `p${i}`, photos: [], fields: [], colors: [], active: true, position: i,
  created_at: new Date().toISOString(), featured: false, ...p }));

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z-]/g, '');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { body = Object.fromEntries(new URLSearchParams(raw)); } }
    try {
      const mod = await import(path.join(root, 'api', name + '.js'));
      req.query = Object.fromEntries(url.searchParams);
      req.body = body;
      return await mod.default(req, res);
    } catch (e) {
      console.error(e);
      res.statusCode = 404; return res.end('{"error":"niet gevonden"}');
    }
  }
  let p = url.pathname;
  if (p.startsWith('/p/')) p = '/product';                     // zelfde rewrite als vercel.json
  if (p === '/') p = '/index';
  let file = path.join(root, 'public', p);
  if (!path.extname(file)) file += '.html';
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Preview op http://localhost:${PORT}  (beheer-wachtwoord: ${process.env.ADMIN_PASSWORD})`));
