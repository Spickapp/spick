# 📘 Spick – Operations Manual
> Skriven av Claude AI. Uppdateras automatiskt. Version 3.0

---

## 🚀 Systemöversikt

Spick är en fullt automatiserad städplattform. Nedan är varje scenario, vem som gör vad, och hur systemet hanterar det.

---

## 📅 SCENARIO 1: Kund bokar städning

### Automatiskt:
1. Kund fyller i boka.html → sparas i Supabase `bookings`-tabell
2. **Bekräftelsemail skickas automatiskt** till kunden (Resend)
3. **Admin-notis skickas** till hello@spick.se med all bokningsinfo
4. Bokningen visas i admin-panelen under "Bokningar"

### Manuellt (du):
- Kontakta städaren om de inte redan fått notis (behöver deras email i systemet)
- Ändra status till "bekräftad" i admin

### Fail-safes:
- Om Resend-API:et är nere → bokningen sparas ändå i Supabase
- Om kunden inte fått mail → de ser tack.html med info

---

## ⭐ SCENARIO 2: Betygsättning efter städning

### Automatiskt:
1. **Klicka "Skicka betygsmail"** i admin → alla städningar som är klara och ej betygsatta
2. Kunden klickar länken → betyg.html
3. Betyget sparas i Supabase `ratings`-tabell
4. **Städarens snittbetyg uppdateras automatiskt** via databas-trigger

### Vid betyg ≤ 2★:
1. **Automatisk notis** till hello@spick.se
2. Ärendet sparas i `guarantee_requests`-tabellen
3. Syns som "Öppet garantiärende" i admin-dashboarden

---

## 🛡️ SCENARIO 3: Nöjdhetsgarantin

### Vem betalar?
Städaren utför returbesöket **gratis** – det ingår i partnersavtalet (avtal.html).
Spick betalar ingen extra provision. Triggas > 2 gånger/månad = varning.

### Kalkyl:
- Garantifrekvens target: < 3% av bokningar
- Vid 100 bokningar/mån = max 3 garantifall
- Kostnad för Spick: 0 kr (städaren utför)
- Kostnad för städaren: ~2h × 350 kr = 700 kr eget "riskkapital"
- Garderar med tydlig info i onboarding

### Flöde:
1. Admin ser röd varning i dashboarden
2. Klicka "Kontakta" → förifylt mail öppnas
3. Kunden erbjuds ny tid inom 48h
4. Markera som "Löst" i admin

---

## 💰 SCENARIO 4: Provisionshantering

### Automatiskt (månadsvis, 1:a varje månad):
1. GitHub Action körs 08:00
2. Beräknar alla bokningar föregående månad
3. 17% provision per städare
4. Fakturan sparas i `invoices`-tabellen

### Skicka faktura:
1. Gå till Fakturor i admin
2. Klicka "Skicka" på varje faktura → mail med Swish-instruktion skickas
3. Städaren Swishar till 0760505153 (Spick AB)

### Kalkyl break-even:
| Bokningar/mån | Intäkt Spick | Kostnad | Netto |
|---------------|-------------|---------|-------|
| 10 | 1 785 kr | ~0 kr | 1 785 kr |
| 50 | 8 925 kr | ~50 kr | 8 875 kr |
| 200 | 35 700 kr | ~200 kr | 35 500 kr |
| 500 | 89 250 kr | ~500 kr | 88 750 kr |

*Provision: 350 kr/h × 3h × 17% = 178,50 kr per bokning*

---

## 💾 SCENARIO 5: Backup & Säkerhet

### Automatisk backup:
- **02:00 varje natt**: GitHub Action kör backup av bookings, cleaners, ratings
- Sparas som JSON-filer i `/backups/` mappen i GitHub-repot
- 7 dagars Point-in-Time-Recovery på Supabase (Free-plan)

### Vid hack/intrång:
1. **Rotera API-nycklar omedelbart:**
   - GitHub token: github.com/settings/tokens
   - Resend: dashboard.resend.com
   - Supabase: dashboard.supabase.com/project/urjeijcncsyuletprydy/settings/api
2. Sätt ny token i GitHub Secrets: Settings → Secrets → Actions
3. Kontakta Supabase support om databasen är komprometterad
4. Alla gamla tokens slutar fungera direkt

### Vid kodfel/deploy-problem:
1. Gå till github.com/Spickapp/spick/commits
2. Hitta fungerande commit
3. Klicka "Revert" → ny commit som rullar tillbaka
4. GitHub Pages deployas automatiskt inom 60 sekunder

---

## 👤 SCENARIO 6: Ny städare onboardas

### Flöde:
1. Ansökan via bli-stadare.html → sparas i `cleaner_applications`
2. Admin ser varning i dashboard
3. Klicka "Godkänn" → **välkomstmail skickas automatiskt**
4. Städaren visas direkt på stadare.html
5. **VIKTIG MANUELL ÅTGÄRD**: Lägg in email under Städare-fliken

### Välkomstmailen innehåller:
- Bekräftelse på godkännande
- Prissättning och provisionsinfo (83% / 17%)
- Info om hur bokningar fungerar
- Swish-betalningsinstruktioner

---

## 📊 SCENARIO 7: Månadsrapport

Kör dessa steg första veckan varje månad:
1. Gå till Fakturor → "Generera fakturor"
2. Klicka "Skicka" på varje faktura
3. Kolla E-postlogg att allt skickats
4. Säkerhetskopiera eventuellt extra via Supabase dashboard

---

## 🆘 NÖDPROCEDURER

### Sajten är nere:
1. Kolla github.com/Spickapp/spick/actions – misslyckad deploy?
2. Kolla Supabase dashboard – databas nere?
3. Force-push senaste fungerande version

### Kund får inte bokningsbekräftelse:
1. Kolla E-postloggen i admin
2. Kolla Resend dashboard: dashboard.resend.com
3. Verifiera att spick.se-domänen är verifierad i Resend

### Städare visas inte på sajten:
1. Kolla att status = 'godkänd' i Supabase
2. Kolla att RLS-policyn är aktiv (SELECT USING true)
3. Hårdreferens: supabase.com/dashboard/project/urjeijcncsyuletprydy/auth/policies

---

## 🔑 CREDENTIALS (FÖRVARA SÄKERT)

| System | URL | Nyckel/Login |
|--------|-----|-------------|
| Admin | spick.se/admin.html | Spick2026! |
| Supabase | supabase.com/dashboard | Googla-login |
| GitHub | github.com/Spickapp | GitHub-login |
| Resend | resend.com | Google-login |

**OBS:** Byt admin-lösenord till något starkare och unikt!

---

## 📞 Vid tekniska problem

Öppna ett GitHub Issue på github.com/Spickapp/spick/issues
Tagga det med "claude" så hanterar Claude Code automatiskt.
