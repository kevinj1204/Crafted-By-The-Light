// Gedeelde helpers voor de publieke pagina's van Crafted By The Light.
window.CB = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (cents) => '€ ' + (cents / 100).toFixed(2).replace('.', ',');

  async function api(path, options = {}) {
    const r = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Er ging iets mis.'), { status: r.status });
    return data;
  }

  // ---- Winkelmand (in de browser) -------------------------------------------
  const KEY = 'cbtl-cart-v1';
  const cart = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } },
    set(items) { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} cart.badge(); },
    add(item) {
      const items = cart.get();
      const sig = (i) => JSON.stringify([i.slug, i.variant_id, i.color || '', i.personal || {}]);
      const hit = items.find((i) => sig(i) === sig(item));
      if (hit) hit.qty = Math.min(20, hit.qty + item.qty); else items.push(item);
      cart.set(items);
    },
    count() { return cart.get().reduce((s, i) => s + i.qty, 0); },
    badge() { document.querySelectorAll('[data-cart-count]').forEach((el) => { el.textContent = cart.count(); }); },
  };

  // ---- Laagjes-silhouet: het "geprint" placeholder-object ---------------------
  function layers(n, base, amp, f, { small = false, build = false, glow } = {}) {
    let html = '';
    for (let i = n - 1; i >= 0; i--) {
      const t = i / (n - 1);
      const w = Math.max(24, Math.round(base + amp * Math.sin(Math.PI * t * f) + (small ? 12 : 30) * Math.sin(Math.PI * t * 3.2)));
      html += `<i style="width:${w}px${build ? `;animation-delay:${(i * 0.04).toFixed(2)}s` : ''}"></i>`;
    }
    return `<div class="layers${small ? ' sm' : ''}${build ? ' build' : ''}" aria-hidden="true"${glow ? ` style="--g:${esc(glow)}"` : ''}>${html}</div>`;
  }
  // Elk product een eigen, vaste vorm op basis van de naam.
  function shapeFor(slug, small = true) {
    let h = 0; for (const ch of String(slug)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const base = small ? 50 + (h % 60) : 120 + (h % 60);
    const amp = small ? 30 + ((h >> 4) % 60) : 80 + ((h >> 4) % 60);
    const f = 0.8 + ((h >> 8) % 12) / 10;
    return { n: small ? 22 : 40, base, amp, f };
  }

  function productCard(p) {
    const s = shapeFor(p.slug);
    const soldOut = p.variants.length && p.variants.every((v) => !v.available);
    const badge = soldOut ? 'Uitverkocht' : p.fields.length ? 'Met jouw naam' : p.featured ? 'Uitgelicht' : '';
    return `<a class="pcard" href="/p/${encodeURIComponent(p.slug)}" style="--g:${esc(p.glow)}">
      <div class="ph">${badge ? `<span class="badge">${esc(badge)}</span>` : ''}
        ${p.photos[0] ? `<img src="${esc(p.photos[0])}" alt="" loading="lazy">` : layers(s.n, s.base, s.amp, s.f, { small: true, glow: p.glow })}</div>
      <div class="meta"><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="name">${esc(p.name)}</span>
        <span class="muted small">${esc(cardMeta(p))}</span></div>
        ${p.from_cents != null ? `<span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none"><span class="price-pill">${p.variants.length > 1 && new Set(p.variants.map((v) => v.price_cents)).size > 1 ? 'v.a. ' : ''}${euro(p.from_cents)}</span><span class="muted" style="font-size:11px">incl. btw</span></span>` : ''}</div>
    </a>`;
  }
  function cardMeta(p) {
    const bits = [];
    if (p.colors.length > 1) bits.push(`${p.colors.length} kleuren`);
    if (p.variants.length > 1) bits.push(`${p.variants.length} uitvoeringen`);
    if (p.fields.length) bits.push('personaliseerbaar');
    return bits.join(' · ') || p.category || '';
  }

  // ---- Kop, band en voet ------------------------------------------------------
  let settings = null;
  function applySettings(s) {
    settings = s;
    if (s?.accent) document.documentElement.style.setProperty('--c', s.accent);
    const band = document.querySelector('[data-band]');
    if (band && s?.announcement) band.innerHTML = `<div><span>${esc(s.announcement)}&nbsp;</span><span aria-hidden="true">${esc(s.announcement)}&nbsp;</span></div>`;
    document.querySelectorAll('[data-biz]').forEach((el) => { el.textContent = s?.business?.[el.dataset.biz] || el.dataset.fallback || ''; });
  }

  function chrome(active) {
    const top = document.createElement('header');
    top.className = 'top';
    const nav = [['/', 'Home'], ['/shop', 'Shop'], ['/shop?f=naam', 'Met jouw naam'], ['/over', 'Over']];
    top.innerHTML = `<div class="wrap">
      <a class="logo" href="/">CRAFTED<span>●</span>BY THE LIGHT</a>
      <nav class="pillnav" aria-label="Hoofdmenu">${nav.map(([h, l]) => `<a href="${h}"${active === h ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <a class="cartbtn" href="/mand" aria-label="Winkelmand">Mand <b data-cart-count>0</b></a></div>`;
    document.body.prepend(top);
    const foot = document.createElement('footer');
    foot.className = 'site-foot';
    foot.innerHTML = `<div class="wrap">
      <span class="big" aria-hidden="true">By the light</span>
      <div class="row"><span>© ${new Date().getFullYear()} Crafted By The Light · onderdeel van The Light Portraits · Maastricht</span>
      <span><a href="/voorwaarden">Voorwaarden</a> · <a href="/voorwaarden#retour">Retourneren</a> · <a href="/privacy">Privacy</a> · <a href="mailto:info@thelightportraits.nl">Contact</a></span></div></div>`;
    document.body.append(foot);
    cart.badge();
  }

  return { esc, euro, api, cart, layers, shapeFor, productCard, chrome, applySettings, get settings() { return settings; } };
})();
