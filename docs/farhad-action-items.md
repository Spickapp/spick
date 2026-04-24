# Farhad Action Items (levande dokument)

**Syfte:** Allt som kräver Farhads manuella hand — tester, deploys, möten, externa bekräftelser. Claude uppdaterar när nya items upptäcks. Farhad kryssar av när klara.

**Senast uppdaterad:** 2026-04-24 em

**Status-symboler:** ⏳ pending · 🔴 blocker för GA · 🟡 bör göras · 🟢 quick-win · ✓ klart

---

## 🔴 GA-blockers (måste göras före lansering)

### Regulator-känsliga (kräver jurist/expert)
- [ ] 🔴 **Jurist-möte:** GDPR retention-policy + sub-processor-DPAs + delete-flow-design (§13.4 B1-B4). Också EU PWD-text-review (§13.8, deadline 2 dec 2026). Också RUT-infrastruktur-plan (Fas 7.5). Samla ihop i ett 2-3h möte.
- [ ] 🔴 **Skatteverket-kontakt:** API-spec 2026 verify för Fas 7.5 RUT-automation (se `docs/sanning/rut.md`).
- [ ] 🔴 **Revisor-möte:** SIE-format-krav + moms-rapport-automation (§13.6). Ska det automatiseras eller manuellt?
- [ ] 🔴 **Pentester-upphandling:** Identifiera 2-3 OWASP-certifierade. Boka 1-2v före GA (§13.7). Offert-inhämtning nu.

### Tekniska GA-blockers (Farhads dashboard-ägarskap)
- [x] ✓ **Supabase Dashboard — storage-bucket `dispute-evidence`** skapad 2026-04-24. Unlocks Fas 8 §8.13.
- [x] ✓ **Stripe rate-limits verifierade 2026-04-24** via Stripe Support. 100 ops/sec live, 15/sec payouts, 30/sec Connect. Räcker för 1000+ bokningar/månad. Vid 10k+ kontakta Stripe 6v innan.

- [x] ✓ **Beslut: fixa Stripe idempotency pre-GA** — Farhad gav mandat 2026-04-24. R2 + R3 KLART. 9 fetch-calls i 8 EFs har idempotency-keys. Dubbel-refund/debitering-risken eliminerad.

---

## 🟡 Bör göras för ordning/trygghet

### Post-deploy-verifieringar (från senaste session)

- [ ] 🟡 **§13.4 A1 — Manuell deploy av `export-customer-data`:** Nästa push triggar auto-deploy (workflow uppdaterad i commit 7389377). Alternativt manuellt: `supabase functions deploy export-customer-data --project-ref urjeijcncsyuletprydy --no-verify-jwt`. Sen smoke-test via mitt-konto.html inloggad.
- [ ] 🟡 **Smoke-test `backup-verify-monthly.yml`:** Actions → "Backup Verify (Monthly)" → Run workflow. Bekräfta att den verifierar 5 kritiska tabeller utan fel.
- [x] ✓ **Smoke-test `load-test.yml`** — Run #6 GRÖN 2026-04-24. 1569 requests, 0% custom_errors, latens-thresholds passerade. Fynd under load: health-EF returnerade 503 pga externa API-deps → fixat via critical/degraded-split. Thresholds justerade till GA-realistiska (50 VUs = spike, 5-10 = riktig trafik).
- [ ] 🟡 **Smoke-test `customer-nudge-recurring.yml`** + **`preference-learn-favorite.yml`** + **`playwright-smoke.yml`** (från föregående session): Kör manuellt för att bekräfta fungerar.

- [ ] 🟡 **A04 investigation — analyze-booking-pattern returnerar 500** (smoke-test 2026-04-24). Testet postar `never-exists@spick-test.se` och förväntar 200 med `has_pattern:false`. Troliga orsaker: (a) bookings-query failar pga oväntad status-enum, (b) EF inte fullt deployad, (c) ny bug. **Kolla Supabase EF-logs:** Dashboard → Edge Functions → analyze-booking-pattern → Logs. Dela output med Claude för fix.

- [x] ✓ **Load-test rerun efter health-fix** — #6 GRÖN 2026-04-24. Hela §12.4 STÄNGD.

### §13.2 DB-index follow-up (kräver prod-access)
- [x] ✓ **§13.2 EXPLAIN verifierad 2026-04-24** — Prod har 0-84 rader per tabell. Seq Scan är optimalt val. Ingen migration behövs nu. Re-audit trigger när bookings >1000 rader.

### Från föregående handoffs (fortfarande öppna)
- [ ] 🟡 **Stripe-saldo -895 kr → positivt** (igång 2026-04-24, bank-transfer 1-2 dagar). Efter clearing: bekräfta i Dashboard att saldo är positivt igen. Tills dess: refund-calls kan fail:a med `insufficient_funds`.
- [x] ✓ **`ADMIN_ALERT_WEBHOOK_URL` satt 2026-04-24** — Discord-server `Spick Ops`, kanal `#alerts`, webhook i Supabase Secrets. Prod-alerts pingar Discord-mobilen.
- [x] ✓ **Beslut: behåll `escrow_mode=escrow_v2`** — 2026-04-24. Motivering: EU PWD-deadline 2 dec 2026, dispute-flow kräver escrow, live-verifierat utan incidenter. Mitigation för saldo-svängningar: håll 5-10k buffer på Stripe-kontot.

---

## 🟢 Quick-wins (kan göras när som helst)

- [ ] 🟢 **Trigga manuellt `schema-drift-check.yml`** för att bekräfta att prod-schema.sql är i synk med prod.
- [ ] 🟢 **Review `docs/audits/2026-04-24-gdpr-static-audit.md`** — 10 min läsning. Beslut om nästa steg.
- [ ] 🟢 **Review `docs/ga-readiness-checklist.md`** — vad är dina tankar om hård/mjuk GA-blocker-matris?

---

## ✓ Avklarade items (arkiverade)

- ✓ Farhad flippat `stripe_test_mode=false` 2026-04-24 05:57
- ✓ Farhad raderat smoke-test-booking `420f49e2`
- ✓ Farhad satt `INTERNAL_EF_SECRET` i Supabase Secrets (Fas 8)
- ✓ Test VD AB skapad för VD-flow-tester
- ✓ Stripe idempotency-fix (R2 + R3) — Farhads mandat 2026-04-24, byggt + testat samma dag. Pre-GA-risken eliminerad.
- ✓ §13.2 DB-index audit — prod-verifierad 2026-04-24. Seq Scan optimalt vid 0-84 rader. Re-audit vid >1000 bookings.
- ✓ Storage-bucket `dispute-evidence` skapad 2026-04-24 (Farhad manuellt i Dashboard).
- ✓ Stripe rate-limits verifierade 2026-04-24 via Stripe Support — 100/15/30 ops/sec. Räcker för 1000+ bokningar/månad.
- ✓ Discord alerts aktiverat 2026-04-24 — `Spick Ops`-server, `#alerts`-kanal, webhook i Supabase Secrets.
- ✓ escrow_mode=escrow_v2 beslutat behållas 2026-04-24 — EU PWD-compliance + dispute-flow-support.
- ✓ §12.4 k6 load-test STÄNGD 2026-04-24 — 50 VUs × 60s, 0% custom_errors. Health critical/degraded-split fixade 503-rate. Thresholds GA-realistiska (custom_errors = hård gate).

---

## Sammanfattning per kategori

| Kategori | Antal | Orsak |
|---|---|---|
| 🔴 Regulator-möten | 4 | Jurist, Skatteverket, revisor, pentester |
| 🔴 Dashboard-setup | 2 | Storage-bucket, Stripe rate-limit-verify |
| 🟡 Post-deploy-verifieringar | 4 | Backup-verify, load-test, customer-nudge, preference-learn |
| 🟡 Prod-DB-access | 2 | EXPLAIN + ev. migration |
| 🟡 Legacy-handoff | 2 | ADMIN_ALERT_WEBHOOK_URL, escrow_mode-beslut |
| 🟢 Quick-wins | 3 | Schema-drift, review-docs |

**Total pending:** ~12 items, varav **4 är hårda GA-blockers** (alla externa möten: jurist, Skatteverket, revisor, pentester).

---

## Hur denna fil underhålls

- **Claude** lägger till items när de upptäcks under sessions. Lägger sha + kommentar när EF:er deploys osv.
- **Farhad** kryssar av items med `[x]` eller tar bort + flyttar till "Avklarade" när klara.
- **Regel:** item flyttas inte till "Avklarade" förrän det är **bekräftat** klart — inte bara "gjort".
