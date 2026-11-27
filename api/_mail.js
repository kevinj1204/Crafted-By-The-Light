// E-mail via Resend. Zonder RESEND_API_KEY wordt er stil niets verstuurd.
import { euroNl } from './_lib.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendMail({ to, subject, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: true };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Crafted By The Light <noreply@thelightportraits.nl>',
      to: Array.isArray(to) ? to : [to],
      subject, html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}

function layout(accent, title, bodyHtml, button, business) {
  return `<div style="background:#06060A;padding:32px 16px;font-family:Arial,sans-serif">
  <div style="max-width:580px;margin:0 auto;background:#101018;border:1px solid #262633;border-radius:20px;padding:32px;color:#F4F1EA">
    <p style="font-size:12px;letter-spacing:3px;color:${esc(accent)};margin:0 0 20px;font-weight:bold">CRAFTED ● BY THE LIGHT</p>
    <h1 style="font-size:26px;line-height:1.2;margin:0 0 16px;color:#F4F1EA">${esc(title)}</h1>
    <div style="font-size:15px;line-height:1.6;color:#D6D3E0">${bodyHtml}</div>
    ${button ? `<p style="margin:28px 0 0"><a href="${esc(button.href)}" style="display:inline-block;background:${esc(accent)};color:#06060A;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:999px">${esc(button.label)}</a></p>` : ''}
    <p style="font-size:12px;color:#8B889A;margin:28px 0 0">${esc(business.name)} · ${esc(business.address)}${business.kvk ? ` · KvK ${esc(business.kvk)}` : ''}${business.vat_id ? ` · btw ${esc(business.vat_id)}` : ''}<br>Vragen? Beantwoord deze mail of mail naar ${esc(business.email)}.</p>
  </div></div>`;
}

export function itemsTable(order) {
  const rows = order.items.map((i) => {
    const extra = [i.variant, i.color, ...Object.entries(i.personal || {}).map(([k, v]) => `${k}: “${v}”`)].filter(Boolean).join(' · ');
    return `<tr><td style="padding:8px 12px 8px 0;vertical-align:top">${i.qty}×</td>
      <td style="padding:8px 12px 8px 0"><strong style="color:#F4F1EA">${esc(i.name)}</strong><br><span style="color:#A9A6B8;font-size:13px">${esc(extra)}</span></td>
      <td style="padding:8px 0;text-align:right;white-space:nowrap">${euroNl(i.unit_cents * i.qty)}</td></tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;color:#D6D3E0">${rows}
    <tr><td></td><td style="padding:8px 12px 2px 0;border-top:1px solid #262633">Verzending (${order.country === 'NL' ? 'Nederland' : 'België'})</td><td style="padding:8px 0 2px;text-align:right;border-top:1px solid #262633">${euroNl(order.shipping_cents)}</td></tr>
    <tr><td></td><td style="padding:6px 12px 2px 0"><strong style="color:#F4F1EA">Totaal incl. btw</strong></td><td style="padding:6px 0 2px;text-align:right"><strong style="color:#F4F1EA">${euroNl(order.total_cents)}</strong></td></tr>
    <tr><td></td><td style="padding:2px 12px 0 0;color:#8B889A;font-size:12px">Hierin zit btw</td><td style="padding:2px 0 0;text-align:right;color:#8B889A;font-size:12px">${euroNl(order.vat_cents)}</td></tr>
  </table>`;
}

const addressHtml = (c) => [c.name, `${c.street} ${c.house}`, `${c.zip} ${c.city}`, c.country === 'NL' ? 'Nederland' : 'België'].map(esc).join('<br>');

export function confirmationMail(order, { settings, base }) {
  const c = order.customer;
  const anyNoReturn = order.items.some((i) => i.no_return);
  return {
    subject: `Bedankt voor je bestelling ${order.number}`,
    html: layout(settings.accent, `Bedankt ${c.first_name || c.name}! Je bestelling is binnen.`,
      `<p style="margin:0 0 16px">We hebben je betaling ontvangen. We gaan voor je aan de slag; zodra je pakket onderweg is krijg je een mail met de track &amp; trace.</p>
       <p style="margin:0 0 8px;color:#A9A6B8;font-size:13px">Bestelnummer <strong style="color:#F4F1EA">${esc(order.number)}</strong></p>
       ${itemsTable(order)}
       <p style="margin:20px 0 0;color:#A9A6B8;font-size:13px">Verzendadres:<br><span style="color:#D6D3E0">${addressHtml(c)}</span></p>
       ${anyNoReturn ? '<p style="margin:16px 0 0;color:#A9A6B8;font-size:13px">Gepersonaliseerde producten worden speciaal voor jou gemaakt en kun je niet retourneren. Voor de overige producten heb je 14 dagen bedenktijd.</p>' : '<p style="margin:16px 0 0;color:#A9A6B8;font-size:13px">Je hebt 14 dagen bedenktijd na ontvangst.</p>'}`,
      { href: `${base}/bestelling?o=${order.id}&t=${order.token}`, label: 'Bekijk je bestelling' }, settings.business),
  };
}

export function ownerMail(order, { settings, base }) {
  const c = order.customer;
  return {
    subject: `Nieuwe bestelling ${order.number} · ${euroNl(order.total_cents)}`,
    html: layout(settings.accent, `Nieuwe bestelling van ${c.name}`,
      `${itemsTable(order)}
       <p style="margin:20px 0 0;font-size:14px">${addressHtml(c)}<br>${esc(c.email)}${c.phone ? ' · ' + esc(c.phone) : ''}</p>
       ${c.note ? `<p style="margin:12px 0 0;white-space:pre-line"><em>${esc(c.note)}</em></p>` : ''}`,
      { href: `${base}/beheer`, label: 'Open de backoffice' }, settings.business),
  };
}

export function shippedMail(order, { settings, base }) {
  const c = order.customer;
  const t = order.tracking || '';
  const isUrl = /^https?:\/\//i.test(t);
  return {
    subject: `Je bestelling ${order.number} is onderweg`,
    html: layout(settings.accent, `Hij komt eraan, ${c.first_name || c.name}!`,
      `<p style="margin:0 0 16px">Je bestelling is ingepakt en verzonden.</p>
       ${t ? `<p style="margin:0 0 16px">Track &amp; trace: ${isUrl ? `<a href="${esc(t)}" style="color:${esc(settings.accent)}">${esc(t)}</a>` : `<strong style="color:#F4F1EA">${esc(t)}</strong>`}</p>` : ''}
       ${itemsTable(order)}`,
      { href: isUrl ? t : `${base}/bestelling?o=${order.id}&t=${order.token}`, label: isUrl ? 'Volg je pakket' : 'Bekijk je bestelling' }, settings.business),
  };
}
