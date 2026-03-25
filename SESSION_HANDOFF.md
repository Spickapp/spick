# Spick – Session Handoff
Uppdaterad: 2026-03-24 (kväll)

## SYSTEMSTATUS – ALLT LIVE

### Klart idag
- DNS: GitHub Pages A-poster fixade via Loopia API
- Resend: Domän VERIFIERAD, mail fungerar
- Supabase webhooks: notify_on_booking + notify_on_application
- Edge Function notify: deployad med RESEND_API_KEY
- GitHub Secrets: ANTHROPIC_API_KEY, SUPABASE_ANON_KEY, LOOPIA_API_USER, LOOPIA_API_PASS
- Google Workspace MX-poster: inlagda i Loopia (ASPMX.L.GOOGLE.COM etc)
- Städarnas email: uppdaterade med platshåll (byt till riktiga)

### GitHub Actions (alla aktiva)
- Deploy to GitHub Pages
- Nightly Backup & Health Check
- Monthly Invoice Generator
- Claude Code via Issues
- Fix DNS via Loopia API (actions: fix-github-pages, add-google-mx, verify-dns, list-records)
- Inject GA4 + Meta Pixel (kör när du har ID:na)

## TODOS KVAR

### PRIO 1 – Google Workspace
1. workspace.google.com → Business Starter → domän: spick.se
2. TXT-verifiering finns redan i Loopia
3. Aktiverar hello@spick.se

### PRIO 2 – GA4 + Meta Pixel
1. Skapa GA4 under hello@spick.se → kopiera G-XXXXXXXXXX
2. business.facebook.com → Pixel → kopiera ID
3. Kör workflow "Inject GA4 + Meta Pixel" med båda ID:na
   Injicerar i alla 36 HTML-filer automatiskt

### PRIO 3 – Städarnas riktiga email
SQL: UPDATE cleaners SET email = 'riktig@email.se' WHERE full_name = 'Namn';

### PRIO 4 – Testbokning
spick.se/stadare.html → boka → verifiera mail + admin

### PRIO 5 – Byt admin-lösenord
Hårdkodat i admin.html → ändra till starkt lösenord

## PUSH-METODIK
Se ADMIN_GUIDE.md för push-script utan credentials.

## AFFÄRSMODELL
350 kr/h x 3h = 1050 kr | Spick 17% = 178 kr/bokning
50 bok/man = 8 900 kr | 200 = 35 600 kr | 500 = 89 000 kr

## CREDENTIALS (förvara separat)
- Admin lösenord: Spick2026! (BYTA!)
- Supabase projekt: urjeijcncsyuletprydy
- Resend domain ID: db7d6b85-c927-4dfa-8de7-5ec2221da7be
- Loopia API user: spickdns@loopiaapi
