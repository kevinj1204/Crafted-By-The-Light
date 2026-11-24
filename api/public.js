// GET /api/public            → instellingen + alle actieve producten
// GET /api/public?slug=...   → instellingen + één product
import { db, send, fail, getSettings, publicSettings, publicProduct } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'Niet toegestaan');
  try {
    const settings = publicSettings(await getSettings());
    const slug = String(req.query?.slug || '');
    if (slug) {
      const { data } = await db().from('products').select('*').eq('slug', slug).eq('active', true).maybeSingle();
      if (!data) return fail(res, 404, 'Dit product bestaat niet (meer).');
      return send(res, 200, { settings, product: publicProduct(data) });
    }
    const { data, error } = await db().from('products').select('*').eq('active', true).order('position', { ascending: true });
    if (error) throw error;
    send(res, 200, { settings, products: (data || []).map(publicProduct) });
  } catch (e) {
    console.error(e);
    fail(res, 500, 'De shop kon niet worden geladen.');
  }
}
