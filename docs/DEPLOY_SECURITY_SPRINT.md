# SPICK Deploy Guide — Fullständig Audit Sprint
**Datum:** 2026-03-30 | **Commits:** 8 | **Filer:** 20+

---

## ⚡ SNABBGUIDE (5 steg, ~30 min)

### 1. Pusha koden
```bash
cd ~/spick
git push origin main
```

### 2. Kör SQL (Supabase Dashboard → SQL Editor)
Öppna `supabase/PREFLIGHT_RUN_THIS.sql` och kör block för block.
Detta enda skript gör allt:
- Stänger öppna UPDATE-policies (säkerhetsincident)
- Rensar "PENTEST_HACKED" + inaktiverar 9 demo-städare
- Skapar säkra VIEWs (booking_slots, booking_confirmation, public_stats)
- Skärper cleaner-claim RLS
- Lägger till booking validation trigger
- Rate limiting, webhook idempotency, CHECK constraints

### 3. Deploya Edge Functions
```bash
supabase functions deploy cleanup-stale --no-verify-jwt
supabase functions deploy stripe-checkout --no-verify-jwt
```

### 4. Sätt secrets
```bash
# Generera CRON_SECRET
openssl rand -hex 32
# Sätt i Supabase
supabase secrets set CRON_SECRET=<värdet>
# Sätt i GitHub Actions
# → github.com/Spickapp/spick/settings/secrets/actions
# → Lägg till: CRON_SECRET, SUPABASE_URL
```

### 5. Verifiera
- [ ] https://spick.se — städarkort laddar (inte evig spinner)
- [ ] https://spick.se/boka.html — wizard fungerar
- [ ] https://spick.se/stadare.html — städarlista visas
- [ ] Admin → alla tabeller renderar korrekt
- [ ] Testboka → Stripe → tack.html → betyg.html

---

## Detaljerad ändringslogg

### Säkerhetsincident
- `PENTEST_HACKED` injicerat i cleaners.bio (Olena Kovalenko)
- **Root cause:** `Cleaner update booking status` policy hade `USING(true)`
- **Fix:** Policy borttagen, demo-städare inaktiverade

### Kritisk live-bugg
- Startsidans städarkort laddade ALDRIG (evig spinner)
- **Root cause:** `supabase.min.js` med `defer` + inline script
- **Fix:** DOMContentLoaded-wrapper

### XSS-härdning (10 filer)
escHtml() + encodeURIComponent() på ALL innerHTML med DB-data

### RLS-härdning
- booking_confirmation VIEW: address borttagen (GDPR)
- public_stats VIEW: säker aggregate data
- Cleaner claim: kräver is_approved = true
- 5 sidor migrerade till säkra VIEWs

### Backend
- validate_booking_insert trigger (dubbelbokningsskydd)
- cleanup_stale_bookings() (rensar pending >30 min)
- check_rate_limit() RPC
- Stripe: booking-verifiering + idempotency key

### CRO/UX
- Nav CTA → boka.html
- Real social proof från reviews-tabellen
- Stats via public_stats VIEW
- SW cache bust
