# Sanning: Personnummer + GDPR

**Senaste verifiering:** 2026-04-24 (Sprint 1 Dag 1 — PNR-fält avstängt i boka.html)
**Status:** STABILISERAT — ackumulation stoppad. Befintliga 36 rader kvarstår för GDPR-beslut.

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

## Falsk utfästelse i prod (åtgärdad 2026-04-24)

~~`boka.html:584-586` visar PNR-fält för kunder som bokar RUT-berättigade tjänster med texten:~~

~~> 🔒 Ditt personnummer krypteras och används endast för RUT-ansökan till Skatteverket.~~

**Åtgärdad Sprint 1 Dag 1 (2026-04-24):** PNR-fältet är avstängt via kill-switch `PNR_FIELD_DISABLED = true` i boka.html. Åtgärdspunkter:

- **HTML:** `pnr-wrap`-div har `style="display:none !important" data-fas-7-5-disabled="true"`. Input har `disabled`-attribut.
- **Text:** Vilseledande text ("krypteras...Skatteverket") ersatt med ärlig text ("Personnummer-fält tillfälligt avstängt. RUT-rabatten tillämpas ändå").
- **JS-guards:** 7 JS-ställen som tidigare visade/läste PNR är nu skyddade av `!PNR_FIELD_DISABLED`: DOMContentLoaded-show, toggleRut-show, privat-type-show (rad 1213), goStep4-show, validering, state-save, rawPnr-prep.
- **Submit:** `rawPnr` alltid `''` → `customer_pnr: undefined` → ingen PNR skickas till booking-create EF.
- **RUT-rabatt oförändrad:** 50%-rabatten visas och tillämpas som förut. Endast PNR-insamlingen är stoppad.

Återaktiveras i Fas 7.5 efter §7.5.1 Skatteverket-API-research + korrekt kryptering (AES-GCM eller pgcrypto på server) + ärlig kund-text.

## Risker (efter Sprint 1 Dag 1 2026-04-24)

| Risk | Nivå | Anledning |
|---|---|---|
| Aktiv insamling fortsätter | 🟢 | Stoppad 2026-04-24 via PNR_FIELD_DISABLED + disabled-attribut |
| GDPR-överträdelse befintlig data | 🟡 | Art. 9 särskild kategori. 3 personer. Ej incident-rapporterbar ännu. Kvarstår tills Fas 7.5. |
| Ekonomisk | 🟢 | 0 kr (testmode) |
| Förtroende | 🟡 | Kunder lämnade PNR i god tro på kryptering. Åtgärdas via Åtgärd 2 (jurist). |

## Hårda låsningar

- PNR-fältet i boka.html får EJ återaktiveras (`PNR_FIELD_DISABLED = false`) utan att §7.5.1 Skatteverket-API-research är klar + kryptering implementerad + ärlig text skriven
- 36 befintliga rader får EJ raderas utan GDPR-bedömning (audit-spår behövs för bokföringslag)
- Ingen ny klartext-PNR får läggas till i DB (skyddat via Sprint 1 Dag 1-fix ovan)

## Planerad åtgärd

Full plan i `docs/planning/todo-pnr-infrastructure-2026-04-23.md` — 4 steg:
1. ✅ **KLART 2026-04-24** — Dölja PNR-fält i boka.html (snabb, stoppar ackumulation). Implementerat via PNR_FIELD_DISABLED kill-switch.
2. GDPR-hantering av 3 riktiga kunders data (kräver jurist)
3. Fixa `rut_amount`-bugg (50%-beräkning)
4. Integrera i Fas 7.5

## Ändringar av denna fil

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-23 | Fil skapad. Fynd dokumenterat efter commit 4400245. | Farhad + Claude session |
| 2026-04-24 | Sprint 1 Dag 1 — PNR-fält avstängt i boka.html via PNR_FIELD_DISABLED. Ackumulation stoppad. | Farhad + Claude session |
