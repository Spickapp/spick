# Sanning: Personnummer + GDPR

**Senaste verifiering:** 2026-04-25 (Alt B AES-256-GCM-encryption-helper deployad)
**Status:** STABILISERAT + krypterings-infrastruktur live. Ackumulation stoppad. Befintliga 36 rader kvar att migrera till Alt B-format via scripts/migrate-pnr-encrypt.ts (Farhad-action när TIC-flow ska aktiveras).

## Nuläge (verifierat i PROD 2026-04-24)

`bookings.customer_pnr` innehåller 36 rader:
- 27 rader × 56 tecken (troligen AES-krypterad, nyckel okänd) — alla farrehagge@gmail.com testdata + ev. nyligen konverterade
- 8 rader × 12 tecken (**KLARTEXT** YYYYMMDDNNNN) — 3 riktiga kunder
- 1 rad × 48 tecken (annan kryptering/hash) — zivar.majid, riktig person

**Förändring sedan 23 apr kväll:** 3 rader har konverterats från 12-tecken (klartext) till 56-tecken (krypterat). Orsak okänd — kan vara auto-process eller manuell UPDATE. Behöver utredas i Fas 7.5 Åtgärd 2.

**Verifierat Sprint 1 Dag 1-fix håller:** 0 nya customer_pnr-rader sedan 2026-04-24 (query: `COUNT(*) FILTER (WHERE created_at >= '2026-04-24')`).

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
| GDPR-överträdelse befintlig data | 🟡 | IMY-art. 33-bedömning pending Farhad. 3 personer. Kvarstår tills åtgärd 2. |
| Ekonomisk | 🟢 | 0 kr (testmode) |
| Förtroende | 🟡 | Kunder lämnade PNR i god tro på kryptering. Åtgärdas via Åtgärd 2 (Farhads bedömning). |

**MVP-kontext (2026-04-28-verifiering):** 0 jobb utförda totalt över hela cleaner-flottan (18 cleaners, alla `total_jobs=0`). Ingen RUT-ansökan skickad (SKV_API_KEY tom). Ingen verklig ekonomisk exposure. Risken är **förebyggande** inför Rafa-pilot-skalning + Fas 7.5-aktivering, inte retroaktiv.

## derin Bahram — dubbelroll (kund + cleaner)

**Fynd 2026-04-28:** Samma person (`derin.bahram@ivory.se` / `Derin.bahram@ivory.se` — case-insensitive email) existerar i prod som:

1. **Kund** — 1 bokning (avbokad 6 apr 2026), 12-tecken klartext-PNR i `bookings.customer_pnr`
2. **Cleaner** — avstängd, `status='avstängd'`, `company_role='member'`, `fskatt_needs_help=true`, 0 jobb utförda

**Korsroller-konsekvens:** Åtgärd på kund-PNR-raden (radering/anonymisering) påverkar inte cleaner-raden. Åtgärd på cleaner-raden (dataminimering) påverkar inte kund-raden. Separat hantering krävs per roll.

**Datapunkter för Farhads bedömning:**
- GDPR Art 17 (rätt till radering) för kund-rollen — möjlig om ej behövs för rättslig förpliktelse
- BokfL 7 kap 2 § — 7 års retention kan gälla **om** bokningen ledde till ekonomisk transaktion (vilken den inte gjorde — avbokad)
- Information till person: en eller två gånger? Informationen kan täcka båda rollerna i samma kommunikation.

**Operativ status:**
- Cleaner-rad: dataminimering pending (Fix 3 — SQL levererad 2026-04-28)
- Kund-rad + PNR: orörd tills Farhads separata beslut (åtgärd 2 i planen)

## Hårda låsningar

- PNR-fältet i boka.html får EJ återaktiveras (`PNR_FIELD_DISABLED = false`) utan att §7.5.1 Skatteverket-API-research är klar + kryptering implementerad + ärlig text skriven
- 36 befintliga rader får EJ raderas utan GDPR-bedömning (audit-spår behövs för bokföringslag)
- Ingen ny klartext-PNR får läggas till i DB (skyddat via Sprint 1 Dag 1-fix ovan)

## Planerad åtgärd

Full plan i `docs/planning/todo-pnr-infrastructure-2026-04-23.md` — 4 steg:
1. ✅ **KLART 2026-04-24** — Dölja PNR-fält i boka.html (snabb, stoppar ackumulation). Implementerat via PNR_FIELD_DISABLED kill-switch.
2. GDPR-hantering av 3 riktiga kunders data — Farhads bedömning (jurist intern)
3. Fixa `rut_amount`-bugg — ⊘ SUPERSEDED 2026-04-24: verifierat att `rut_amount` är korrekt idag (se rut.md)
4. Integrera i Fas 7.5

## Alt B — AES-256-GCM-kryptering (2026-04-25)

Infrastruktur klar för krypterad PNR-lagring (Hemfrid-modell men säkrare):

- ✅ `_shared/encryption.ts` — encryptPnr/decryptPnr/isEncrypted-helpers (8/8 tester passerar)
- ✅ `rut-bankid-status` EF — skriver krypterad PNR till `bookings.customer_pnr` efter SPAR-enrichment
- ✅ `PNR_ENCRYPTION_KEY` Supabase secret satt 2026-04-25 (44-tecken base64, 32 bytes)
- ✅ `scripts/migrate-pnr-encrypt.ts` — engångs-migration av 11 befintliga klartext-rader
- ✅ **Migration KÖRD 2026-04-25:** 8 klartext-PNR krypterade till Alt B. 27 legacy 56-tecken + 1 legacy 48-tecken kvar (okänd ursprungsnyckel — kan inte dekrypteras).
- ⏳ `tic_enabled = false` i prod (vänta tills Farhad är OK med PNR-lagrings-policy)

### Legacy 28 rader — Farhad-beslut 2026-04-25 (val b)

De 27+1 legacy-rader (56/48 tecken) som inte kunde migreras är **alla Stripe testmode-bokningar** (per §1 ovan: "Alla bokningar är Stripe testmode. 0 kr verkliga pengar. Inga RUT-ansökningar skickade"). Konsekvens:
- Kan inte användas för RUT-ansökan eftersom klartext inte är återvinningsbart
- **Ingen verklig RUT-förlust** (testdata)
- Accepterat som-är. Ingen åtgärd planerad.

Vid framtida real-mode-bokningar börjar Alt B-flowen direkt → inga nya legacy-rader.

**Format:** `bookings.customer_pnr = "AES-GCM:v1:" + base64(IV || ciphertext+authTag)`

**Vid framtida RUT-batch-export:** EF importerar `decryptPnr()` från `_shared/encryption.ts` och dekrypterar för SKV-XML.

**Säkerhet:**
- AES-256-GCM med slumpmässig IV per kryptering (NIST SP 800-38D)
- Nyckeln endast i Supabase secrets (aldrig i git, logs eller DB)
- Auth-tag verifierar mot tampering
- Version-prefix tillåter framtida key-rotation (v2 → v3)

## Ändringar av denna fil

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-23 | Fil skapad. Fynd dokumenterat efter commit 4400245. | Farhad + Claude session |
| 2026-04-24 | Sprint 1 Dag 1 — PNR-fält avstängt i boka.html via PNR_FIELD_DISABLED. Ackumulation stoppad. | Farhad + Claude session |
| 2026-04-28 | MVP-kontext tillagd (0 jobb utförda). derin-dubbelroll dokumenterad. Paternalistiska "kräver jurist"-formuleringar ersatta med "Farhads bedömning" efter omkalibrering. | Farhad + Claude session |
