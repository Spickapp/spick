# Spick Admin Guide

## Live URL
**https://spickapp.github.io/spick/** (GitHub Pages)
**https://spick.se** (när DNS är fixat)

## DNS-inställningar hos Loopia
Ta bort gamla A-poster och lägg till:
```
A    @    185.199.108.153
A    @    185.199.109.153
A    @    185.199.110.153
A    @    185.199.111.153
CNAME www  spickapp.github.io
```

## Daglig rutin
1. Gå till https://spickapp.github.io/spick/admin.html
2. Lösenord: Spick2026!
3. Godkänn städaransökningar under "Städaransökningar"
4. Städaren visas automatiskt på stadare.html

## Deploy ny kod
1. Ändra fil
2. Pusha till GitHub → live inom 2 min automatiskt

## Supabase
- Dashboard: https://supabase.com/dashboard/project/urjeijcncsyuletprydy
- Tabeller: bookings, cleaners, cleaner_applications

## E-post (Resend)
- Kund får bekräftelse automatiskt vid bokning
- Admin (hello@spick.se) får notis vid varje bokning
- Resend dashboard: https://resend.com

## Viktiga kontakter
- Loopia support: loopia.se/kontakt
- Supabase: supabase.com/support
- Resend: resend.com/help
