# Session handoff — Spick, 23 april 2026 (kväll)

**Föregående session:** Morgon/eftermiddag 23 apr (SESSION-HANDOFF_md.pdf).
**Denna session:** Kväll 23 apr.
**Status vid avslut:** Två commits pushade (`5613acc`, `edabde0`). Inga öppna DB-ingrepp. Två öppna manuella steg.

---

## Vad som hände idag kväll (i ordning)

1. **Verifierade att RUT.1 INTE är i prod-DB**. Migrationsfilen `20260423000001_rut_sprint_1_datamodell.sql` finns i repo (commit `0b82f2d`) men är inte körd. `schema_migrations` innehåller inte raden. 21 kolumner + 3 tabeller existerar alltså bara i repo, inte i databasen.

2. **Läste audit-filen `docs/audits/2026-04-23-rut-infrastructure-decision.md`** och bekräftade att RUT.1 sannolikt är Regel #29-brott: audit:n sa "scope-gränser respekterade: customer_pnr/customer_pnr_hash-kolumner rört EJ (Fas 7.5)" — men RUT.1 byggde exakt dessa kolumner utan att §7.5.1 Skatteverket-API-spec-research var gjord.

3. **Beslut: RUT pausas helt tills vidare.** Inte rollback av commit `0b82f2d` än — den ligger kvar i repo men orörd. Ska antingen absorberas i Fas 7.5 efter §7.5.1-research, eller reverteras som egen commit senare.

4. **Påbörjade commission-synk 17→12.** Verifierade i PROD DB att:
   - `platform_settings.commission_standard = 12` (sedan 17 apr, redan korrekt)
   - `platform_settings.commission_top = 12` (sedan 17 apr, redan korrekt)
   - 18 bokningar efter 20 apr har `commission_pct = 12` (fungerar redan)
   - 28 bokningar före 20 apr har `commission_pct = 17` (testdata, 27 avbokade + 4 completed av samma testkund)
   - `cleaners.commission_rate` inkonsistent: 9 × 17, 6 × 12, 1 × 0.17, 1 × 0 (legacy-kolumn, droppas Fas 1.10)

5. **Två commits synkade HTML 17% → 12%:**
   - `5613acc` — 11 ställen (ai-support, dashboard ×3, admin.html:670, faq, om-oss ×2, stadare-test, utbildning rad 299, rekrytera ×2)
   - `edabde0` — 3 ställen (dashboard:1088 83→88, pages/rekrytera månadssiffror, utbildning:588)

6. **Beslut: pausa provision-synk här.** Totalt 14 ställen fixade, 25 × "17%" + ca 20 × "83%" kvar. Fortsatt arbete blir egen sprint (se nedan).

---

## Bekräftade affärsbeslut idag (Farhad 23 apr)

1. **12% FLAT för alla städare, trappsystem avskaffat** (tidigare trappmodell new 17% → elite 12% är borta).
2. **Strategi: 12% under uppbyggnad, kan höjas framtida när marknadsposition är stark.** VIKTIGT: framtida höjning får ALDRIG kommuniceras i städarfacing-text.
3. **Ingen per-städare-override** — `cleaners.commission_rate` och `companies.commission_rate` ska droppas (Fas 1.10).
4. **Historiska testbokningar med `commission_pct=17` lämnas orörda** — "låt allt vara bakåt, framåt är 12%".
5. **RUT pausas helt** — fortsätter när Fas 7.5.1 research är gjord (Skatteverkets API-spec 2026 verifierad).

---

## Öppna manuella steg (görs i ny session eller innan nästa commit)

### 1. Städa PROD vault — `RUT_PNR_ENCRYPTION_KEY` (5 min)

Skapades i PROD vault av misstag när RUT.1 byggdes i fel Studio.
UUID: `86767fda-4dcf-44c6-8869-7e5b9a0145f1`

Innan radering, verifiera i PROD SQL Editor:
```sql
SELECT count(*) FROM bookings WHERE customer_pnr_encrypted IS NOT NULL;
SELECT count(*) FROM bookings WHERE customer_pnr_hash IS NOT NULL;
```

Båda ska vara 0. Om ja: PROD Studio → Settings → Vault → sök UUID → Delete.
Lokala vault-nyckeln (annat UUID) behålls intakt.

### 2. Droppa backup-tabell (5 sek)

Skapades under verifiering men användes aldrig (UPDATE kördes inte):
```sql
DROP TABLE bookings_backup_commission_17_before_sync;
```

---

## 🔴 KRITISK: PNR-infrastruktur-fynd (upptäckt efter commit a7bb559)

**Status:** Dokumenterad men ej åtgärdad. Se [docs/planning/todo-pnr-infrastructure-2026-04-23.md](../planning/todo-pnr-infrastructure-2026-04-23.md) för full kontext.

**Kort sammanfattning:**
- Verifiering i prod-DB visade 36 rader med customer_pnr (audit 21 apr sa 0)
- 11 rader är klartext PNR (12 tecken YYYYMMDDNNNN format)
- 3 riktiga kunder berörda: claraml@hotmail.se, derin.bahram@ivory.se, zivar.majid@outlook.com
- boka.html:586 utlovar kryptering + Skatteverket-användning. Ingetdera stämmer.
- boka.html-PNR-fältet är AKTIVT i prod — varje ny RUT-bokning genererar mer klartext-PNR

**Ekonomisk exponering:** 0 kr (allt Stripe-testmode). GDPR-exponering finns.

**Beslutat 23 apr kväll:** Ingen kod-ändring ikväll. Planera ordentligt tillsammans med Fas 7.5-start. Se TODO-fil för åtgärdsplan i 4 steg.

**FÖRSTA STEG i nästa session:** Bestäm om Åtgärd 1 (dölja PNR-fält) ska köras innan planering av Åtgärd 2-4.

## Öppen sprint: "Provision-centralisering"

Kvällens arbete avslöjade att provisionssiffran är fragmenterad över hela kodbasen
(Regel #28-brott som ackumulerats över tid). Sprint behöver planeras separat.

### Prio 1: Städarfacing HTML (aktiv skada — städare ser fel siffra)

- `registrera-stadare.html` — 5 ställen, **JS-priskalkylator visas LIVE vid registrering**. Inkl arabiska översättning.
- `utbildning-stadare.html:341` — quiz-svar "872 kr (83%)"
- `utbildning-stadare.html:589, 593, 594-596` — "Din andel (83%)" + tabellrubrik + hela nettotabellen felberäknad
- `om-oss.html:153` + `pages/om-oss.html:108` — hjälte-statistik "83%"
- `priser.html:299` — synlig stat
- `rekrytera.html:67` + `pages/rekrytera.html:51` — synliga stats
- `index.html:601` — synligt
- `pages/tack.html:92` — bekräftelsesida
- `pages/ai-support.html:185` — AI/chatbot-svar

### Prio 2: Kräver separata beslut

- `bli-stadare.html` (trappsystem-narrativ + schema.org FAQ + stat) — **nytt marknadsbudskap behöver skrivas** eftersom trappan var säljargumentet
- `utbildning-stadare.html:320, 327, 333` — **översättning till somaliska, polska, engelska** (17 → 12)
- `villkor-stadare.html:126` — **kräver jurist**. Juridiskt bindande avtalstext. Ändring kräver:
  - Jurist-granskning att unilateral ändring är giltig
  - Email till befintliga städare om villkorsändring
  - Versionshistorik + re-accept-flöde
- `schema.org JSON-LD` i `bli-stadare.html:34` — påverkar Googles FAQ-rika resultat

### Prio 3: Intern/bakomkulisserna

- `skatt-utbetalningar.html` (4 ställen, momsmatematik behöver omberäknas från 17% till 12%)
- `blogg/jobba-som-stadare-stockholm.html` (3 ställen, SEO-artikel)
- `marknadsanalys.html` (intern strategi)
- `docs/spick_masterplan.html` (intern dokumentation)
- `admin.html:3750, 3763, 3878` — **trappmappen** (`{new:'17%',established:'15%',professional:'13%',elite:'12%'}`) — kräver beslut om hur admin ska visa provision när trappan inte längre existerar

### Rätt långsiktig lösning (Regel #28)

Ikvällens 14 fixar är `12%` hardkodat på 14 nya ställen. Det är rätt siffra men fel arkitektur.

**Föreslagen infrastruktur:**
- Skapa `js/platform-settings.js` som exponerar värden från `platform_settings`-tabellen via publik API
- HTML använder `data-commission-display` attribut som JS fyller vid page load
- Alla framtida ändringar = UPDATE i `platform_settings`-tabellen, klart
- Görs **innan nästa provisionsändring**, annars upprepas ikvällens arbete

Estimat: 3-5h för infrastruktur, sen 1-2h per gång för att konvertera HTML-sidor batch-vis.

---

## Kritiska regler bekräftade/utvidgade idag

### Regel #29 i praktiken
Tidigare session (morgon 23 apr) skrev över memory 12↔17 felaktigt baserat på DB-drift som inte fanns. Kvällens session verifierade DB direkt (`platform_settings` redan på 12) istället för att lita på memory. Detta räddade en onödig UPDATE-operation.

### Regel #31 i praktiken
Första SQL-queryn misslyckades för att `platform_settings` saknar `created_at`-kolumn (bara `updated_at`). Schema-verifieringen fångade det direkt. Kod-grep hade inte visat detta.

### Regel #28 i praktiken
14 HTML-fixar som borde varit 1 centraliseringsjobb. Anteckning för framtiden: "2h hygien" som visar sig vara systemiskt problem = pausa och planera, inte plöj vidare.

---

## Miljö och checkpoints

- **Senaste commits (main):** `5613acc`, `edabde0`
- **Repo status:** Clean, pushad till origin/main
- **PROD DB:** Healthy, 46 bokningar, 17 städare, inga pågående transaktioner
- **PROD vault:** 1 nyckel att städa (`RUT_PNR_ENCRYPTION_KEY`)
- **Stripe:** LIVE mode, oförändrat
- **RUT:** AVSTÄNGD i prod (stripe-webhook rad 518-521), rut-claim EF undeployad. Kvarstår: SKV_API_KEY tom (skall förbli tom). Migrationsfil för RUT.1 ligger i repo men inte körd.

---

## Nästa session — föreslagen startpunkt

1. **Kolla att backup-tabell och RUT_PNR_ENCRYPTION_KEY är städade** (från "Öppna manuella steg" ovan). Om inte, gör det.
2. **Bestäm riktning för provision-centralisering:**
   - A) Fortsätt patch-fixar Prio 1 listan (~3-4h, ingen arkitekturförbättring)
   - B) Bygg `platform-settings.js` infrastruktur först, konvertera sen
   - C) Lämna orörd, fokusera på annat (villkor/jurist, P1-buggar, RUNBOOK, etc.)
3. **RUT förblir pausat** tills du explicit väljer att öppna Fas 7.5. Första steg då: §7.5.1 Skatteverket-API-spec-research.

---

## Vad som INTE bör göras i nästa session utan explicit beslut

- Rör inte `cleaners.commission_rate` värden — kolumnen droppas Fas 1.10 ändå
- Rör inte historiska bokningar med `commission_pct = 17` — låt audit-spår vara
- Sätt INTE `SKV_API_KEY` i prod vault
- Kör INTE migrationsfil `20260423000001_rut_sprint_1_datamodell.sql`
- Ändra INTE villkor-stadare.html utan jurist
