# SPICK Drifthandbok
**Version:** 1.0 | **Datum:** 2026-03-30

---

## Daglig checklista (5 min)

### Automatiskt (cron)
Dessa körs automatiskt via GitHub Actions:
- **07:00** — Daglig automation (påminnelser, recensionsbegäran, win-back)
- **07:00** — Social media auto-post (Buffer)
- **Var 15:e min** — Stale booking cleanup
- **Var 30:e min** — Auto-remind (bokningspåminnelser)

### Manuell kontroll
1. **Admin-panel** → https://spick.se/admin.html
   - Kolla "Väntande bokningar" — ska vara 0 efter cleanup
   - Kolla "Nya ansökningar" — godkänn/avslå inom 24h
   - Kolla "Otilldelade bokningar" — tilldela städare manuellt om auto-match misslyckades

2. **Health check** → Kör i browserkonsol eller curl:
   ```
   curl -s https://urjeijcncsyuletprydy.supabase.co/functions/v1/health \
     -H "apikey: <ANON_KEY>" | jq .status
   ```
   Ska visa `"healthy"`. Om `"degraded"` → kolla vilken check som felar.

---

## Veckovis checklista (15 min, måndagar)

1. **GitHub Actions** → github.com/Spickapp/spick/actions
   - Kolla att cron-jobb (cleanup, auto-remind, backup) är gröna
   - Röda jobb → klicka "Re-run" eller debugga

2. **Supabase Dashboard** → app.supabase.com
   - Database → Table Editor → `bookings` → verifiera att `expired` bookings rensas
   - Edge Functions → Invocations → kontrollera att alla funktioner anropas

3. **Stripe Dashboard** → dashboard.stripe.com
   - Kontrollera balans och utbetalningar
   - Verifiera att webhooks levereras (Developers → Webhooks)

4. **Resend Dashboard** → resend.com/emails
   - Kontrollera email delivery rate (ska vara >95%)
   - Kolla om några e-poster studsat (bounced)

---

## Månadsvis

1. **Rotera CRON_SECRET** (rekommenderat):
   ```bash
   NEW_SECRET=$(openssl rand -hex 32)
   supabase secrets set CRON_SECRET=$NEW_SECRET
   # Uppdatera i GitHub Actions Secrets också
   ```

2. **Backup-verifiering**: Ladda ner senaste backup från GitHub Actions artifacts, kontrollera att den innehåller data.

3. **RLS-audit**: Kör i Supabase SQL Editor:
   ```sql
   SELECT tablename, policyname, cmd,
     CASE WHEN qual::text = 'true' THEN '⚠️' ELSE '✅' END
   FROM pg_policies WHERE schemaname = 'public'
   ORDER BY tablename, cmd;
   ```
   Inga `⚠️` ska finnas för UPDATE/DELETE med anon-roll.

---

## Incidenthantering

### Kund kan inte boka
1. Kolla health endpoint (stripe/database nere?)
2. Kolla Stripe Dashboard → Developers → Logs
3. Testa själv: spick.se/boka.html → välj tjänst → välj tid → välj städare
4. Browser console → leta efter röda felmeddelanden

### Webhook misslyckas
1. Stripe Dashboard → Developers → Webhooks → senaste leveranser
2. Kolla att webhook-URL är korrekt: `https://urjeijcncsyuletprydy.supabase.co/functions/v1/stripe-webhook`
3. Kolla Supabase → Edge Functions → stripe-webhook → Logs

### Städare ser inga uppdrag
1. Kolla att bokningens `cleaner_id` är satt (admin → bokningsdetaljer)
2. Kolla att städaren är `is_approved = true` i cleaners-tabellen
3. Kolla stadare-dashboard.html → Console → fel?

### E-post levereras inte
1. Resend → Emails → filtrera på "bounced" eller "failed"
2. Kolla att Resend API-nyckeln är giltig: `supabase secrets list`
3. Kolla att DNS-records för spick.se har korrekt SPF/DKIM

---

## Nyckelresurser

| Resurs | URL |
|--------|-----|
| Live-sajt | https://spick.se |
| Admin | https://spick.se/admin.html |
| GitHub | https://github.com/Spickapp/spick |
| Supabase | https://app.supabase.com (projekt: urjeijcncsyuletprydy) |
| Stripe | https://dashboard.stripe.com |
| Resend | https://resend.com |
| GitHub Actions | https://github.com/Spickapp/spick/actions |
| Health check | /functions/v1/health |

---

## Teknisk referens

### Edge Functions (15 st)
| Funktion | Trigger | Auth |
|----------|---------|------|
| stripe-checkout | Frontend (boka.html) | Anon key |
| stripe-webhook | Stripe webhook | Stripe signature |
| cleanup-stale | Cron (15 min) | CRON_SECRET |
| auto-remind | Cron (30 min) | CRON_SECRET |
| notify | Frontend/webhook | Anon key |
| admin-data | Admin panel | Supabase Auth (magic link) |
| health | Monitoring | Anon key |
| geo | Frontend (boka.html) | Anon key |
| email-inbound | Resend inbound | Resend signature |
| rut-claim | Webhook (after payment) | Service role |
| push | Auto-remind | Service role |
| bankid | Frontend (registrering) | Anon key |
| social-media | Cron (daglig) | Service role |
| stripe-connect | Admin (payout setup) | Service role |
| swish | Frontend (betalning) | Anon key |

### Databasvy:er (3 st, säkra)
| View | Åtkomst | Syfte |
|------|---------|-------|
| booking_slots | anon | Kalender (inga PII) |
| booking_confirmation | anon | Tack/betyg-sidor (minimal PII) |
| public_stats | anon | Homepage-statistik (aggregat) |

### GitHub Secrets som behövs
```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
SUPABASE_ACCESS_TOKEN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
RESEND_API_KEY, CRON_SECRET, BUFFER_ACCESS_TOKEN, ANTHROPIC_API_KEY
```
