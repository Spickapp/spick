# Medvetet publika RLS-policies

Detta dokument listar varje RLS-policy där anon-åtkomst är **medveten design**, inte säkerhetsläcka. Varje post har:

1. **Flöde** — vilket publikt flöde kräver åtkomst
2. **Exponeras** — vad som faktiskt blir läsbart för anon
3. **Mitigation** — hur risken dämpas
4. **Omprövas** — när policy ska omvärderas

Namngivningskonvention: policies som listas här ska ha suffix `— intentional` i sin `policyname` i `pg_policies`. Framtida auditörer kan filtrera på `policyname LIKE '%— intentional%'` för att se alla medvetna anon-läsare på en gång.

---

## `booking_status_log` — Public read — intentional

**Flöde:** [admin.html:3046](../../admin.html:3046) (admin-översikt per booking), [stadare-uppdrag.html:653](../../stadare-uppdrag.html:653) (SMS-länkad städare-sida utan OTP).

**Exponeras:** `booking_id`, status-ändringar (pending → confirmed → completed → klar), tidsstämplar. Inga namn, adresser, priser.

**Ingen PII:** bara status-flow-metadata.

**Mitigation:** `booking_id` är uuid (slumpmässigt, ej-gissningsbart). Utan korrekt id får anon ingen meningsfull data.

**Omprövas:** Fas 1 när SMS-token-auth byggs för publika flöden.

---

## `messages` — Public read — intentional + public INSERT

**Flöde:** [min-bokning.html:398, 431](../../min-bokning.html:398) (kund-chatt via SMS-länk), [stadare-uppdrag.html:544](../../stadare-uppdrag.html:544) (städare-chatt via SMS-länk).

**Exponeras:** Chat-innehåll mellan kund och städare för en given `booking_id`.

**Risk:** Personlig info i chatt (portkoder, husdjur, frånvaro-info).

**Mitigation:**
- `booking_id` är uuid — utan korrekt id får anon ingen meningsfull data
- INSERT-policy tillåter kund att skriva utan auth (SMS-länk-flödet); bevaras separat under namnet `"Anyone can insert messages"`

**Omprövas:** **HIGH priority i Fas 1.** Chatt-system bör autentiseras via SMS-token, inte vara publikt. Chat-innehåll är höst-risk PII.

---

## `subscriptions` — Public read — intentional

**Flöde:** [js/cro.js:133](../../js/cro.js:133) (anon INSERT vid registrering), [prenumeration-tack.html:67](../../prenumeration-tack.html:67) (SELECT per id efter Stripe-checkout).

**Exponeras:** Prenumerations-metadata: service_type, booking_hours, frequency, next_booking_date, hourly_rate, rut-flagga. **Inga kortuppgifter** (dessa lever i Stripe).

**Mitigation:** Subscription-IDs är uuids. Stripe kort-data är inte i tabellen.

**Omprövas:** Fas 1 — tack-sidan kan flyttas till Edge Function som verifierar Stripe `session_id` istället för direkt REST-anrop.

---

## `calendar_events` — "Anon can read calendar_events"

**Flöde:** [boka.html:1408](../../boka.html:1408) läser 90-dagars fönster av alla cleaners tillgänglighet.

**Exponeras:** Cleaner-IDs, tider, event-typer (booking/blocked/travel/external/break), titlar. Ingen PII.

**Mitigation:** Nödvändig för att kunder ska kunna se vem som är ledig vid bokning.

**Omprövas:** Fas 1 — kan övervägas om endast tillgängliga tider ska exponeras utan cleaner-id. Försämrar dock matchning och CRO.

---

## `cleaner_availability` / `cleaner_availability_v2` — "Public read"

**Flöde:** [boka.html](../../boka.html), [foretag.html](../../foretag.html), [stadare-profil.html](../../stadare-profil.html).

**Exponeras:** Dag-booleans / ISO day_of_week per cleaner. Ingen PII.

**Mitigation:** Publik data — schema är inte konfidentiellt.

**Omprövas:** Fas 1 v1-drop. v2 fortsätter vara publik.

---

## `service_checklists` — "Public read service_checklists"

**Flöde:** [stadare-dashboard.html:8736](../../stadare-dashboard.html:8736) läser mallar via anon-headers (historisk implementation).

**Exponeras:** Checklist-items per tjänstetyp (global + företags-specifika).

**Mitigation:** Mallar är design-publika. Ingen PII.

**Omprövas:** Aldrig — mallar är per design publika, mot bekräftelse.

---

## `company_service_prices` — Public read — intentional

**Flöde:** [boka.html:790](../../boka.html:790) (kund ser företagspriser vid val), [foretag.html:371](../../foretag.html:371) (publik företagssida visar priser).

**Exponeras:** `service_type`, `price`, `price_type` per företag.

**Ingen PII:** bara prissättning.

**Mitigation:** Company-IDs är uuids. Anon kan lista men utan `company_id`-filter får de ett aggregat som inte är känsligt. Skrivningar är REVOKE:ade från anon (Paket 7) — endast VD/Admin/Service kan modifiera.

**Omprövas:** Fas 1 — kan skärpas om företag vill privatisera priser (ex. enterprise-kunder). Idag är prissättning publik by design för kund-transparens.

---

## `spatial_ref_sys` — Ingen RLS (by design)

**Typ:** PostGIS-systemtabell med koordinatreferens-system.

**Innehåll:** Read-only konstanter (WGS84, SWEREF99 TM, etc).

**Varför ingen RLS:** Inga känsliga data, systemtabell, read-only (`rowsecurity=false` är korrekt). Matchar PostGIS default setup — att tvinga RLS på denna skulle potentiellt bryta spatial queries.

**Omprövas:** Aldrig — systemtabell.

---

## `ratings` — "Public read"

**Flöde:** [stadare-profil.html:414](../../stadare-profil.html:414) (publik profil-visning), [admin.html:4833](../../admin.html:4833) (statistik).

**Exponeras:** Betyg (rating, quality, punctuality, friendliness), cleaner_id.

**Mitigation:** Betyg är publik data på städar-profiler (som på Uber/Lime/etc). Ingen kund-info.

**Omprövas:** Aldrig — betyg är design-publika för konsumentförtroende.

---

## Rekommenderad Fas 1-uppgift: Publik auth via SMS-token

### Problem

3+ flöden i Spick är publika (SMS-länkar, tack-sidor) som fortfarande behöver anropa känsliga resurser (`messages`, `booking_status_log`, `subscriptions`). Varje löser det idag med `ANON_KEY` + `qual=true`-policy. Den högst prioriterade risken är `messages`-chatten som exponerar personlig info.

### Lösning: Unified SMS-token-auth-flöde

1. **När SMS skickas** (bekräftelse, status-update, chatt-notis) embeddas en signerad token i länken (JWT signerad av service-role).
2. **Kund klickar länken** → token valideras av EF `sms-token-exchange` → returnerar kortlivad authenticated JWT (24h TTL) bunden till specifik `booking_id`.
3. **Alla publika flöden** (`min-bokning`, `stadare-uppdrag`, `prenumeration-tack`) använder denna JWT istället för ANON_KEY.
4. **RLS på `messages`, `booking_status_log`, `subscriptions`** skärps från `qual=true` till authenticated + scope via JWT-claim (`auth.jwt() ->> 'booking_id' = booking_id::text`).

### Vinst

- 3 `— intentional`-policies kan droppas och ersättas med auth-scoped policies
- Chatt-PII exponeras inte längre via gissningsbara booking-ids
- SMS-länkar kan revokeras (token-lista i DB)
- CSRF-skydd: token binder session till specifik booking

### Tidsuppskattning Fas 1

~6-8h (ny EF + 3-4 publika sidor uppgraderade + RLS-refaktor + tester).

**Scope-blockerare:** Resend SMS-integration måste redan hantera query-parametrar i länkar (verifiera).

### Omprövnings-checklista efter Fas 1-implementation

- [ ] Alla tre "— intentional"-policies droppade
- [ ] Publik INSERT på messages flyttad till auth-scoped via booking-token
- [ ] `INTENTIONAL_ANON_POLICIES.md` uppdaterat: 3 sektioner borttagna (booking_status_log, messages, subscriptions)
- [ ] `calendar_events`, `cleaner_availability*`, `service_checklists`, `ratings` kvar som medvetet publika (designval, inte SMS-relaterat)
