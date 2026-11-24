// Na de eerste bevestigde betaling: mail naar klant en naar de shop.
import { getSettings, baseUrl } from './_lib.js';
import { sendMail, confirmationMail, ownerMail } from './_mail.js';

export async function afterPaid(req, order) {
  const settings = await getSettings();
  const base = baseUrl(req);
  try {
    const m = confirmationMail(order, { settings, base });
    await sendMail({ to: order.customer.email, subject: m.subject, html: m.html, replyTo: settings.business.email || settings.notify_email });
  } catch (e) { console.error('Bevestigingsmail niet verstuurd:', e); }
  try {
    if (settings.notify_email) {
      const m = ownerMail(order, { settings, base });
      await sendMail({ to: settings.notify_email, subject: m.subject, html: m.html, replyTo: order.customer.email });
    }
  } catch (e) { console.error('Melding aan shop niet verstuurd:', e); }
}
