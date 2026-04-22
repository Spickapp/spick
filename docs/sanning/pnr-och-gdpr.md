# Sanning: Personnummer + GDPR

**Senaste verifiering:** 2026-04-23 kväll (commit 4400245)
**Status:** AKTIVT PROBLEM — dokumenterat, ej åtgärdat. Ingen ekonomisk exponering.

## Nuläge (verifierat i PROD)

`bookings.customer_pnr` innehåller 36 rader:
- 24 rader × 56 tecken (troligen AES-krypterad, nyckel okänd) — alla farrehagge@gmail.com testdata
- 11 rader × 12 tecken (**KLARTEXT** YYYYMMDDNNNN) — 3 riktiga kunder
- 1 rad × 48 tecken (annan kryptering/hash) — zivar.majid, riktig person

`bookings.customer_pnr_hash` innehåller 0 rader.

## Berörda riktiga personer (GDPR)

- `claraml@hotmail.se` — 10 rader (blandat 12/56-tecken format)
- `derin.bahram@ivory.se` — 1 rad (12-tecken klartext)
- `zivar.majid@outlook.com` — 1 rad (48-tecken format)

Alla bokningar är Stripe testmode. 0 kr verkliga pengar. Inga RUT-ansökningar skickade (SKV_API_KEY tom).

## Falsk utfästelse i prod (aktiv risk)

`boka.html:584-586` visar PNR-fält för kunder som bokar RUT-berättigade tjänster med texten:

> 🔒 Ditt personnummer krypteras och används endast för RUT-ansökan till Skatteverket.

**Båda påståendena är osanna.** Kryptering sker inte konsekvent (11 rader klartext bevisar det). Skatteverket-användning sker inte alls (SKV_API_KEY tom, EF undeployd).

`boka.html:2975` skickar `customer_pnr: rawPnr` utan kryptering klient- eller serversidan.

## Risker

| Risk | Nivå | Anledning |
|---|---|---|
| Aktiv insamling fortsätter | 🔴 | Varje ny RUT-bokning genererar ny klartext-PNR |
| GDPR-överträdelse | 🟡 | Art. 9 särskild kategori. 3 personer. Ej incident-rapporterbar ännu. |
| Ekonomisk | 🟢 | 0 kr (testmode) |
| Förtroende | 🟡 | Kunder lämnade PNR i god tro på kryptering |

## Hårda låsningar

- PNR-fältet i boka.html får EJ ändras UI-mässigt utan beslut i `docs/planning/todo-pnr-infrastructure-2026-04-23.md`
- 36 befintliga rader får EJ raderas utan GDPR-bedömning (audit-spår behövs för bokföringslag)
- Ingen ny klartext-PNR får läggas till i DB (kräver att PNR-fältet döljs eller krypteras ordentligt)

## Planerad åtgärd

Full plan i `docs/planning/todo-pnr-infrastructure-2026-04-23.md` — 4 steg:
1. Dölja PNR-fält i boka.html (snabb, stoppar ackumulation)
2. GDPR-hantering av 3 riktiga kunders data (kräver jurist)
3. Fixa `rut_amount`-bugg (50%-beräkning)
4. Integrera i Fas 7.5

## Ändringar av denna fil

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-23 | Fil skapad. Fynd dokumenterat efter commit 4400245. | Farhad + Claude session |
