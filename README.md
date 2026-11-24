# Crafted By The Light

Webshop voor de 3D-prints van The Light Portraits: producten met uitvoeringen, kleuren en personalisatie, afrekenen via Mollie (iDEAL, Bancontact, creditcard), verzending naar Nederland en België en een eigen backoffice.

## Pagina's

| Adres | Wat |
|---|---|
| `/` | Homepage met uitgelichte producten |
| `/shop` | Alle producten, met filters (`/shop?f=naam` = personaliseerbaar) |
| `/p/<naam>` | Productpagina: uitvoering, kleur, naam/tekst, live voorbeeld |
| `/mand` | Winkelmand en afrekenen |
| `/bestelling` | Status van een bestelling (link in de bevestigingsmail) |
| `/over`, `/voorwaarden`, `/privacy` | Informatie |
| `/beheer` | Backoffice: bestellingen, producten, instellingen |

## Installeren (eenmalig)

### 1. Supabase (database en foto's)
1. Maak een gratis project op [supabase.com](https://supabase.com) (regio Frankfurt of Parijs), of voeg het toe via **Vercel → Storage**, net als bij de missen kalender.
2. Ga naar **SQL Editor**, plak de inhoud van `supabase/schema.sql` en klik **Run**.
3. Noteer bij **Project Settings → API** de **Project URL** en de **service_role**-sleutel (geheim houden).

### 2. Mollie
Zet in je Mollie-dashboard iDEAL, Bancontact en creditcard aan. Gebruik eerst de **test**-sleutel (`test_…`), bij de lancering de **live**-sleutel (`live_…`).

### 3. Vercel
1. Importeer deze GitHub-repo in Vercel (framework: **Other**).
2. Zet bij **Settings → Environment Variables**:

| Naam | Waarde |
|---|---|
| `SUPABASE_URL` | Project URL uit Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role-sleutel |
| `MOLLIE_API_KEY` | `test_…` en later `live_…` |
| `ADMIN_PASSWORD` | Sterk wachtwoord voor `/beheer` |
| `PUBLIC_BASE_URL` | `https://crafted.thelightportraits.nl` (zonder `/` aan het eind) |
| `RESEND_API_KEY` | Je Resend-sleutel (domein thelightportraits.nl is al geverifieerd) |
| `MAIL_FROM` | Optioneel, standaard `Crafted By The Light <noreply@thelightportraits.nl>` |

3. Deploy en koppel het subdomein: CNAME `crafted` → `cname.vercel-dns.com` bij goedkopewebhoster.nl, en voeg `crafted.thelightportraits.nl` toe in het Vercel-project.

## Gebruik
- **Producten**: per product één of meer uitvoeringen (bijv. maten) met eigen prijs incl. btw. Per uitvoering kies je **Op voorraad** (met aantal, wordt automatisch afgeboekt bij betaling) of **Op bestelling** (met levertijd). Voeg kleuren en personalisatievelden toe. Een **verplicht** personalisatieveld maakt het product gepersonaliseerd: geen retourrecht, en de klant moet dat bij het afrekenen bevestigen.
- **Bestellingen**: alleen betaalde bestellingen staan bij "Te doen". Zet een bestelling op **Verzonden** met track & trace en de klant krijgt automatisch een mail.
- **Instellingen**: shop open/dicht, verzendkosten NL/BE, btw, accentkleur, tekst in de band, meldings-e-mail en bedrijfsgegevens (KvK en btw-id zijn verplicht op een webshop).
- Terugbetalingen doe je in het Mollie-dashboard; de status in de backoffice wordt bijgewerkt.

## Lokaal testen
```
npm install
npm test        # test de hele flow met nep-database, nep-Mollie en nep-mail
npm run dev     # preview met voorbeeldproducten op http://localhost:3000 (beheer-wachtwoord: test)
```
