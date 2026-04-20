# Fas 1 Money Layer – Progress

**Primärkälla:** [docs/planning/spick-arkitekturplan-v3.md](planning/spick-arkitekturplan-v3.md) (v3.1)

**Syfte:** Status-overlay som mappar v3-sub-fas → commit + status. Denna fil är INTE en plan – alla scope-beslut refererar v3.md.

**Senast uppdaterad:** 2026-04-20

## Status per sub-fas

| Sub-fas | v3.md rad | Beskrivning | Status | Ändring | Kommentar |
|---------|----------:|-------------|:------:|---------|-----------|
| §1.1 | 141 | `_shared/money.ts` skelett + helpers | ✓ | Alla helpers implementerade | getCommission, calculatePayout, calculateRutSplit, triggerStripeTransfer |
| §1.2 | 142 | stripe-checkout:88 hardcoded → money.getCommission() | ⊘ SUPERSEDED | stripe-checkout raderad 2026-04-21 + v3.md-not tillagd | stripe-checkout EF var död kod (0 invocations 20 dgr + 0 callers). Katalog raderad. CI-workflows och docs-Tier1 uppdaterade. booking-create:604 bär betalningen och läser commission från platform_settings. Tier2-docs (historiska snapshots) orörda. EF undeploy kvar som manuell åtgärd. |
| §1.3 | 143 | stripe-connect:172 hardcoded 0.83 → money.calculatePayout() | ✓ | payout_cleaner-action raderad (91 rader) | 0 callers + bruten mot DB-schema (3 kolumner saknas). Transfer-logiken finns i `money.ts::triggerStripeTransfer`. EF:n behålls aktiv för 6 onboarding-callers. |
| §1.4 | 144 | admin.html:markPaid → EF, idempotency + transfer-verifiering | ✓ | markPaid → EF, swishPay borttagen | Idempotency + Stripe transfer-verifiering via `money.ts` |
| §1.5 | 145 | Reconciliation-cron | ✓ | Reconciliation-cron aktiverad | Auto-activation + auto-rollback i kod men ej i v3.md – hygien-task |
| §1.6 | 146 | Stripe integration-test i CI (full booking → checkout → transfer → payout) | ◯ Ej påbörjad | – | Strukturellt viktigt för skalning |
| §1.7 | 147 | `js/commission.js` arkivering eller integrering | ✓ | commission.js arkiverad, helpers getKeepRate + getCommissionRate | Display-only Smart Trappstege (INAKTIV i prod). Läckage-fix fångade stadare-dashboard.html:9182. |
| §1.8 | 148 | Hardcoded hourly-priser (349/350/399) → platform_settings | ◯ Ej påbörjad | – | v3 listar 3 filer (admin/bli-stadare/join-team). boka.html (17 träffar) utanför planen – **plan-beslut #1 väntar**. |
| §1.9 | 149 | faktura.html commission_pct‖17-fallback → money.getCommission() | ✓ | commission-helpers.js + 17 ställen centraliserade i 7 filer | §1.9a infrastruktur + §1.9b applicering. Helpers: getKeepRate, getCommissionRate, getCommissionPct. Konsumenter: admin.html, faktura.html, stadare-dashboard.html, stadare-uppdrag.html, team-jobb.html, marknadsanalys.html, registrera-stadare.html, rekrytera.html. |
| §1.10 | 150 | Dokumentera money-layer i docs/architecture/money-layer.md | ◑ Delvis | Delvis dokumenterad | Fil existerar, refererar till code-snippets som ändrats i §1.4/§1.7. Behöver uppdateras. |

**Status-symboler:** ✓ klar · ◯ ej påbörjad · ◑ delvis · ⊘ superseded

## Git-historik

Commits per sub-fas hittas via:
```bash
git log --grep="§1.X" --oneline
```

Konvention från 2026-04-20: commit-meddelanden använder §-referens i format `§X.Y (v3.md:rad): beskrivning`.

## Sammanfattning

- **Klart:** §1.1, §1.3, §1.4, §1.5, §1.7, §1.9 (6 av 10)
- **Superseded:** §1.2 (1 av 10) – verifierad mot produktionsdata 20 apr
- **Delvis:** §1.10 (1 av 10)
- **Ej påbörjad:** §1.6, §1.8 (2 av 10)

## Öppna plan-beslut

### 2. Fix-skript utanför §2.7 – utöka eller separat hantering?
**Kontext:** v3 §2.7 (rad 181) listar 8 fix-skript för arkivering. §4.10 (rad 252) listar 2. Totalt **18 fix-skript** i repo-rot. 10 saknas i planen: fix-b2b-trust.js, fix-calcvar.js, fix-company-heading.js, fix-company-prices.js, fix-div.js, fix-multi2.js, fix-multi5.js, fix-notes.js, fix-pricing-model.js, fix-rating-toggle.js, fix-team-prices.js.

**Beslut behövs:** utöka §2.7-lista eller separat cleanup-fas.

**Väntar:** Farhad.

## Hygien-tasks (ej blockerare)

- Kod avviker från v3.md i reconcile-payouts (auto-activation + auto-rollback). Plan-sync behövs.
- `money-layer.md` refererar code-snippets som ändrats i §1.4/§1.7 – uppdatera vid §1.10-färdigställande.
- Commit-meddelandens "Fas X.Y"-numrering matchar inte v3 §-numrering konsekvent. Ny konvention: använd v3 §-referens i framtida commit-meddelanden.

## Stängda plan-beslut

### #1 boka.html scope (stängt 2026-04-21)
Beslut: alt D – SAFETY_FALLBACK_RATE-konstant för 15 defensive fallbacks (14 listade i scope-rapport 20 apr + 1 missad pga grep-truncering, alla samma K1-pattern). boka.html förblir utanför §1.8-scope (som behåller admin.html + bli-stadare.html + join-team.html). De 15 fallback-ställena var defensive programming vid DB-kedjebrott, inte hardcoded pricing. Primärväg oförändrad: `service_price (DB) > cleaner.hourly_rate (DB) > SAFETY_FALLBACK_RATE`.

### #3 stripe-checkout radering (stängt 2026-04-21)
Beslut: alt 1 – radera kod + CI + docs. EF undeploy:ad som separat manuell åtgärd av Farhad.

## Session-notes-konvention

Alla framtida prompts ska referera v3-sub-fas (§X.Y) INTE session-numrering ("1.10.3"). Gamla session-numrering är **deprecated per 2026-04-20**.

## Startpunkt för ny session

1. Läs denna fil
2. Verifiera HEAD + senaste commits mot tabellen
3. Kontrollera öppna plan-beslut – är någon avklarad?
4. Välj nästa §-fas från "Ej påbörjad"
