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
- [ ] 🔴 **Supabase Dashboard — skapa storage-bucket `dispute-evidence`:** Privat bucket, 5MB limit, MIME `image/jpeg, image/png, image/heic, application/pdf`. Unlocks Fas 8 §8.13 dispute-evidence-upload.
- [ ] 🔴 **Stripe Dashboard — verifiera rate-limits:** Kolla prod-mode limits (standard 100 read + 100 write req/s per account). Dokumentera i §13.3. Kritisk för 1000+ bokningar/månad-skalan.

---

## 🟡 Bör göras för ordning/trygghet

### Post-deploy-verifieringar (från senaste session)

- [ ] 🟡 **§13.4 A1 — Manuell deploy av `export-customer-data`:** Nästa push triggar auto-deploy (workflow uppdaterad i commit 7389377). Alternativt manuellt: `supabase functions deploy export-customer-data --project-ref urjeijcncsyuletprydy --no-verify-jwt`. Sen smoke-test via mitt-konto.html inloggad.
- [ ] 🟡 **Smoke-test `backup-verify-monthly.yml`:** Actions → "Backup Verify (Monthly)" → Run workflow. Bekräfta att den verifierar 5 kritiska tabeller utan fel.
- [ ] 🟡 **Smoke-test `load-test.yml`:** Actions → "Load Test (read-endpoints)" → Run workflow. 50 VUs × 60s. Mäta p95-latens + error-rate.
- [ ] 🟡 **Smoke-test `customer-nudge-recurring.yml`** + **`preference-learn-favorite.yml`** + **`playwright-smoke.yml`** (från föregående session): Kör manuellt för att bekräfta fungerar.

### §13.2 DB-index follow-up (kräver prod-access)
- [ ] 🟡 **Kör EXPLAIN ANALYZE i Studio** för topp-10 gap-queries från `docs/audits/2026-04-24-db-indexes-static.md`:
  - `SELECT * FROM platform_settings WHERE key = 'commission_standard';`
  - `SELECT * FROM bookings WHERE booking_date >= '2026-04-24' ORDER BY booking_date;`
  - `SELECT * FROM customer_profiles WHERE email = '...';`
  - `SELECT * FROM cleaners WHERE auth_user_id = '...';`
  - `SELECT * FROM admin_users WHERE email = '...';`
  - Kopiera QUERY PLAN-output. Om Seq Scan → migration för index behövs.
- [ ] 🟡 **Efter EXPLAIN-resultat:** Claude bygger migration för saknade indexes om Seq Scan visas vid relevant data-volym.

### Från föregående handoffs (fortfarande öppna)
- [ ] 🟡 **Sätt `ADMIN_ALERT_WEBHOOK_URL`** (Slack eller Discord webhook) i Supabase Secrets. Utan detta: alerts använder console-fallback (fungerar men ingen aktiv notifiering).
- [ ] 🟡 **Beslut: escrow_mode=escrow_v2 för alla kunder?** Nu aktivt (live-verifierat). Ska vi behålla som default eller flippa tillbaka till `legacy` som säkerhet? Farhads beslut.

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

**Total pending:** ~17 items, varav **6 är hårda GA-blockers**.

---

## Hur denna fil underhålls

- **Claude** lägger till items när de upptäcks under sessions. Lägger sha + kommentar när EF:er deploys osv.
- **Farhad** kryssar av items med `[x]` eller tar bort + flyttar till "Avklarade" när klara.
- **Regel:** item flyttas inte till "Avklarade" förrän det är **bekräftat** klart — inte bara "gjort".
