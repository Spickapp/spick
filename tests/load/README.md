# Load-tester (Fas 12 §12.4)

k6-baserade load-tester för Spicks read-path. Scenariot simulerar 50 samtidiga användare som browsar booking-flödet.

## Varför bara read-path?

Write-operationer (booking-create, stripe-webhook) är medvetet EJ inkluderade i load-test:

- **Rule #30 (regulator-gissning förbjuden):** Stripe-integration får inte trycktestas mot prod utan separat test-environment-beslut.
- **Rule #27 (scope-respekt):** §12.4 bevisar skalning, inte att write-path är kvar-stabilt. Write-path valideras via Fas 12 §12.1-§12.3 E2E-tester.
- **Prod-säkerhet:** Load-test mot `booking-create` skulle skapa fake-data i prod-DB. Read-path har inga sidoeffekter.

För write-path load-test: kräver separat test-Supabase-projekt + Stripe test-mode-isolering. Skjuts till Fas 13 §13.1 (1000 samtidiga + skalnings-test).

## Kör lokalt

Installera k6: https://k6.io/docs/getting-started/installation/

```bash
# Windows (via winget)
winget install k6

# Kör test mot prod (read-only, safe)
k6 run tests/load/read-endpoints.k6.js

# Med anpassad URL (t.ex. staging om det finns)
SUPA_URL=https://stage.example.com k6 run tests/load/read-endpoints.k6.js
```

## Kör i CI

Manuell trigger via workflow:
```
Actions → "Load Test (read-endpoints)" → Run workflow
```

CI är INTE schemalagd. Anledning: onödig Supabase-kvot-belastning om vi inte verifierar skalning aktivt.

## Förväntade resultat

| Mätvärde | Threshold | Orsak |
|---|---|---|
| p95 http_req_duration | < 1500ms | Acceptabel latens under 50 samtidiga users |
| http_req_failed rate | < 2% | Tolerans för cold-start + enstaka nät-flakiness |
| p95 latency_health | < 800ms | Health är lätt — bör svara snabbt |
| p95 latency_services | < 1200ms | Services-list är DB-query + mindre payload |
| p95 latency_geo | < 1500ms | Geo gör nearest-cleaner-sökning — kan vara tyngre |

## Resultat-fil

Efter körning sparas `tests/load/latest-result.json` med full k6-summary. Inkluderas INTE i git (se `.gitignore`).

## Nästa steg

- **Fas 13 §13.1:** 1000 samtidiga användare (behöver separat test-projekt)
- **§13.2:** DB-index-audit för queries som kör > 100ms vid 100k bookings
- **§13.3:** Stripe rate-limit-verifiering (kräver Stripe test-mode + controlled scenario)
