# SPICK Security Sprint — Deploy Guide
**Datum:** 2026-03-30  
**Sprint:** Fullständig säkerhetsaudit + XSS-härdning + backend-fixes

---

## Sammanfattning av ändringar

### 🔒 XSS-härdning (9 filer)
Alla `innerHTML`-tilldelningar som renderar databasdata har nu `escHtml()` och/eller
`encodeURIComponent()` för att förhindra XSS-attacker.

**Filer ändrade:**
- `stadare.html` — städarkort
- `profil.html` — profilsida + recensioner
- `stadare-dashboard.html` — jobbkort, recensioner, inkomstöversikt
- `min-bokning.html` — bokningsdetaljer + städarinfo
- `mitt-konto.html` — bokningskort + städarkontakt
- `tack.html` — betygsätt-länk
- `admin.html` — ALLA modaler, tabeller, listor (bokningar, städare, ansökningar, kunder, recensioner, e-post)

### 🛡️ Backend-säkerhet

1. **SQL-migration** (`20260330000001_security_hardening.sql`):
   - `booking_confirmation` VIEW — `address` borttagen (PII-exponering)
   - Cleaner claim RLS skärpt (kräver `is_approved = true` + `status = 'godkänd'`)
   - `cleanup_stale_bookings()` — PostgreSQL-funktion för att rensa pending >30min
   - `rate_limits`-tabell + `check_rate_limit()` RPC-funktion
   - `bookings_price_range` + `bookings_hours_range` CHECK constraints
   - Performance-index för cleanup + rate limiting

2. **Edge Function** (`supabase/functions/cleanup-stale/index.ts`):
   - Rensar stale pending-bokningar var 15:e minut
   - Autentiserad med CRON_SECRET
   - Notifierar admin vid ≥3 stale bokningar

3. **Edge Function** (`supabase/functions/stripe-checkout/index.ts`):
   - **Booking verification** — verifierar att booking_id existerar och är pending
   - **Idempotency key** — förhindrar duplicate Stripe sessions

4. **GitHub Actions** (`.github/workflows/cleanup-stale.yml`):
   - Cron var 15:e minut → anropar cleanup Edge Function

---

## Deploy-ordning (FÖLJ EXAKT)

### Steg 1: Sätt CRON_SECRET i Supabase
```bash
# Generera en secret
openssl rand -hex 32

# Sätt i Supabase
supabase secrets set CRON_SECRET=<den genererade nyckeln>
```

### Steg 2: Sätt CRON_SECRET i GitHub Actions
Gå till: https://github.com/Spickapp/spick/settings/secrets/actions
→ Lägg till: `CRON_SECRET` med samma värde
→ Lägg till: `SUPABASE_URL` = `https://urjeijcncsyuletprydy.supabase.co`

### Steg 3: Kör SQL-migrationen
```sql
-- Kör i Supabase SQL Editor (Dashboard → SQL Editor)
-- Kopiera hela innehållet i:
-- supabase/migrations/20260330000001_security_hardening.sql
-- Kör block för block och verifiera outputen
```

### Steg 4: Deploya Edge Functions
```bash
# cleanup-stale
supabase functions deploy cleanup-stale --no-verify-jwt

# stripe-checkout (uppdaterad med booking verification + idempotency)
supabase functions deploy stripe-checkout --no-verify-jwt
```

### Steg 5: Pusha frontend-ändringar
```bash
git add -A
git commit -m "🔒 Security sprint: XSS hardening, RLS fix, stale cleanup, booking verification"
git push origin main
```

### Steg 6: Verifiera
1. **XSS:** Gå till stadare.html, profil.html — kontrollera att städarnamn renderas korrekt
2. **Admin:** Logga in på admin.html → verifiera att all data visas korrekt
3. **Booking:** Gör en testbokning → verifiera att Stripe checkout fungerar
4. **Stale cleanup:** Vänta 15 min → kontrollera i Supabase att `cleanup-stale` cron körs (GitHub Actions → Actions tab)
5. **RLS:** Kör i SQL Editor:
   ```sql
   SELECT policyname, cmd, roles::text FROM pg_policies 
   WHERE tablename = 'bookings' AND policyname LIKE '%claim%';
   -- Ska visa "Approved cleaner claims open bookings"
   ```

---

## Kvarvarande uppgifter (nästa sprint)

### Hög prioritet
- [ ] Kör Innovation Sprint migrationer 200001-500001 i produktion
- [ ] Deploya `referral-register` Edge Function
- [ ] Google Business Profile setup
- [ ] PostHog analytics (gratis tier)

### Medel prioritet
- [ ] SMS-integration (46elks) för bokningsbekräftelser
- [ ] Frontend → Astro migration (kodduplicering)
- [ ] Sentry/error monitoring
- [ ] A/B-test Spark lojalitetsprogram

### Låg prioritet
- [ ] AI-chatbot förbättring (ai-support.html)
- [ ] Dynamic pricing engine
- [ ] Fullständig TypeScript-migration av Edge Functions
