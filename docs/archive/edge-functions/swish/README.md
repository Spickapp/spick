# swish/ — ARKIVERAD 2026-04-25

**Anledning:** Spick använder Stripe (kort + Klarna) som betalningsmetod sedan 13 april 2026 (LIVE i prod). Swish-EF + swish-return.html var legacy från en tidigare betal-integration som aldrig blev fullt funktionell.

**Audit-resultat (2026-04-25):**
- EF returnerade `500 Internal Server Error` vid POST utan params
- 0 frontend-anrop till `/functions/v1/swish` (grep-verifierat)
- Bara `swish-return.html` hade canonical-länk men ingen JS-funktion anropade EF:n
- Inga aktiva bokningar med `payment_method='swish'` i prod (rule #31, curl-verifierat)

**Vad som arkiverades:**
- `supabase/functions/swish/index.ts` → `docs/archive/edge-functions/swish/index.ts`
- `swish-return.html` → `docs/archive/legacy-html/swish-return.html`
- Sitemap-skript-rad för swish-return.html togs bort (dead reference)

**Återaktivering:** Om Swish-betalning vore relevant igen i framtiden:
1. Move tillbaka filerna till sin ursprungliga plats
2. Verifiera mot aktuell Swish-API-spec (kan ha ändrats sedan 2026-04)
3. Implementera signature-verification mot ny Swish-secret
4. E2E-test innan prod-deploy

**Prod-cleanup pending (Farhad-action):**
```bash
supabase functions delete swish --project-ref urjeijcncsyuletprydy
```
EF:n kvarstår i prod tills detta körs. Kostar Supabase EF-quota-slot tills dess.
