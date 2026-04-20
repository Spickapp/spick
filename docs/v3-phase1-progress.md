# Fas 1 Money Layer – Progress

**Primärkälla:** [docs/planning/spick-arkitekturplan-v3.md](planning/spick-arkitekturplan-v3.md) (v3.1)

**Syfte:** Status-overlay som mappar v3-sub-fas → commit + status. Denna fil är INTE en plan – alla scope-beslut refererar v3.md.

**Senast uppdaterad:** 2026-04-20

## Status per sub-fas

| Sub-fas | v3.md rad | Beskrivning | Status | Commits | Kommentar |
|---------|----------:|-------------|:------:|---------|-----------|
| §1.1 | 141 | `_shared/money.ts` skelett + helpers | ✓ | c21517d, 7236bee, 2cb48b8, 9813030, 8c1abe6, 7f04d69, f37b11e, 7827eeb, 51fd4e9 | Alla helpers klara (getCommission, calculatePayout, calculateRutSplit, triggerStripeTransfer) |
| §1.2 | 142 | stripe-checkout:88 hardcoded → money.getCommission() | ⊘ SUPERSEDED | – | stripe-checkout EF är död kod (0 invocations 20 dgr Dashboard 20 apr + 0 callers grep). Aktiv betalningsväg är `booking-create` som redan läser commission från platform_settings (rad 184-201). §1.2 i praktiken avklarad via booking-create. |
| §1.3 | 143 | stripe-connect:172 hardcoded 0.83 → money.calculatePayout() | ✓ | d05321a | Raderade `payout_cleaner`-action (rad 140-230, 91 rader) istället för att migrera. 0 callers + bruten mot DB-schema (3 kolumner saknas: `stripe_transfer_id`, `payout_amount`, `paid_out_at`). Transfer-logiken finns i `money.ts::triggerStripeTransfer`. EF:n behålls aktiv för 6 onboarding-callers. |
| §1.4 | 144 | admin.html:markPaid → EF, idempotency + transfer-verifiering | ✓ | adc50c7, 3d97029, eb898fe | swishPay borttaget samtidigt (eb898fe) |
| §1.5 | 145 | Reconciliation-cron | ✓ | f403ec2, 945b9f8, 5bffaf1 | Auto-activation + auto-rollback i kod men ej i v3.md – hygien-task |
| §1.6 | 146 | Stripe integration-test i CI (full booking → checkout → transfer → payout) | ◯ Ej påbörjad | – | Strukturellt viktigt för skalning |
| §1.7 | 147 | `js/commission.js` arkivering eller integrering | ✓ | 5cce033, 641226e | Arkiverad (display-only). Läckage-fix 641226e fångade stadare-dashboard.html:9182. Nya helpers getKeepRate() + getCommissionRate() på plats. |
| §1.8 | 148 | Hardcoded hourly-priser (349/350/399) → platform_settings | ◯ Ej påbörjad | – | v3 listar 3 filer (admin/bli-stadare/join-team). boka.html (17 träffar) utanför planen – **plan-beslut #1 väntar**. |
| §1.9 | 149 | faktura.html commission_pct‖17-fallback → money.getCommission() | ◯ Ej påbörjad | – | Scope-verifiering 20 apr: 15 hardcoded commission-ställen i 7 frontend-filer (utvidgning utöver faktura.html). |
| §1.10 | 150 | Dokumentera money-layer i docs/architecture/money-layer.md | ◑ Delvis | – | Fil existerar, refererar till code-snippets som ändrats i §1.4/§1.7. Behöver uppdateras. |

**Status-symboler:** ✓ klar · ◯ ej påbörjad · ◑ delvis · ⊘ superseded

## Sammanfattning

- **Klart:** §1.1, §1.3, §1.4, §1.5, §1.7 (5 av 10)
- **Superseded:** §1.2 (1 av 10) – verifierad mot produktionsdata 20 apr
- **Delvis:** §1.10 (1 av 10)
- **Ej påbörjad:** §1.6, §1.8, §1.9 (3 av 10)

## Öppna plan-beslut

### 1. boka.html in i §1.8 eller undantag?
**Kontext:** v3 §1.8 listar 3 filer (admin.html, bli-stadare.html, join-team.html) för migrering av hardcoded hourly-priser. `boka.html` är huvudbokningsflödet med 17 hardcoded pricing-träffar, inte listat i §1.8.

**Beslut behövs:** utöka §1.8-scope till att inkludera boka.html, eller dokumentera boka.html som medvetet undantag (client-side Stripe-filter-mönster).

**Väntar:** Farhad.

### 2. Fix-skript utanför §2.7 – utöka eller separat hantering?
**Kontext:** v3 §2.7 (rad 181) listar 8 fix-skript för arkivering. §4.10 (rad 252) listar 2. Totalt **18 fix-skript** i repo-rot. 10 saknas i planen: fix-b2b-trust.js, fix-calcvar.js, fix-company-heading.js, fix-company-prices.js, fix-div.js, fix-multi2.js, fix-multi5.js, fix-notes.js, fix-pricing-model.js, fix-rating-toggle.js, fix-team-prices.js.

**Beslut behövs:** utöka §2.7-lista eller separat cleanup-fas.

**Väntar:** Farhad.

### 3. stripe-checkout radering – nu eller efter v3.md-uppdatering?
**Kontext:** 0 invocations senaste 20 dgr + 0 callers. Verifierat dött 20 apr. v3 §1.2 säger migrera – progress-filen markerar SUPERSEDED.

**Beslut behövs:** radera `supabase/functions/stripe-checkout/` + undeploy från Supabase nu, eller vänta tills v3.md §1.2 formellt uppdateras.

**Väntar:** Farhad.

## Hygien-tasks (ej blockerare)

- Kod avviker från v3.md i reconcile-payouts (auto-activation + auto-rollback). Plan-sync behövs.
- `money-layer.md` refererar code-snippets som ändrats i §1.4/§1.7 – uppdatera vid §1.10-färdigställande.
- Commit-meddelandens "Fas X.Y"-numrering matchar inte v3 §-numrering konsekvent. Ny konvention: använd v3 §-referens i framtida commit-meddelanden.

## Session-notes-konvention

Alla framtida prompts ska referera v3-sub-fas (§X.Y) INTE session-numrering ("1.10.3"). Gamla session-numrering är **deprecated per 2026-04-20**.

## Startpunkt för ny session

1. Läs denna fil
2. Verifiera HEAD + senaste commits mot tabellen
3. Kontrollera öppna plan-beslut – är någon avklarad?
4. Välj nästa §-fas från "Ej påbörjad"
