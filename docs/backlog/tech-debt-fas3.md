# Teknisk skuld — Fas 3

Samling av schema-skulder och refactors som planeras för Fas 3 i [Arkitekturplan v2](../planning/spick-arkitekturplan-v2.md).

---

## bookings.cleaner_email/cleaner_phone denormaliserade

- **Källa:** [2026-04-18-cleaner-email-phone-missing-columns.md](../incidents/2026-04-18-cleaner-email-phone-missing-columns.md)
- **Problem:** Dessa fält är en snapshot — stale om cleaner ändrar kontakt.
- **Fix:** Ersätt alla läsningar med JOIN via `cleaner_id`, droppa kolumnerna.
- **Påverkade filer:**
  - [admin.html](../../admin.html) (3 ställen)
  - [mitt-konto.html](../../mitt-konto.html)
  - [stadare-dashboard.html](../../stadare-dashboard.html) (5 ställen)
  - [stadare-uppdrag.html](../../stadare-uppdrag.html)
  - [auto-remind/index.ts](../../supabase/functions/auto-remind/index.ts) (7 ställen)
  - [notify/index.ts](../../supabase/functions/notify/index.ts) (2 ställen)
  - [booking-reassign/index.ts](../../supabase/functions/booking-reassign/index.ts) (2 ställen)
  - [cleaner-booking-response/index.ts](../../supabase/functions/cleaner-booking-response/index.ts)
  - [stripe-webhook/index.ts](../../supabase/functions/stripe-webhook/index.ts)
- **Estimat:** 3-5h inkl tester.
