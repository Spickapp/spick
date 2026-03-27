# SPICK.SE — AUTONOMT DRIFTSYSTEM
## Från manuell drift till AI-driven, självgående marknadsplats

---

## 1. FULLSTÄNDIG KUNDRESA — NULÄGE VS MÅL

```
STEG                  NULÄGE           MÅL              LÖSNING
─────────────────────────────────────────────────────────────────
1. Upptäckt           AUTO ✅          AUTO ✅           SEO + Social media + Content Engine
2. Landning           AUTO ✅          AUTO ✅           spick.se (GitHub Pages)
3. Bläddra städare    AUTO ✅          AUTO ✅           stadare.html → Supabase
4. Bokning            AUTO ✅          AUTO ✅           boka.html 4-stegs wizard
5. Betalning          SEMI ⚠️          AUTO ✅           Stripe live-läge
6. Matchning          MANUELL ❌       AUTO ✅           AI-matchning (ny)
7. Bekräftelse        AUTO ✅          AUTO ✅           notify Edge Function
8. Påminnelser        AUTO ✅          AUTO ✅           auto-remind (24h + 2h)
9. Leveranskoord.     MANUELL ❌       AUTO ✅           Realtids-uppdateringar (ny)
10. Kvalitetskontroll MANUELL ❌       AUTO ✅           Auto-checkin + fotoverifiering (ny)
11. Betygsförfrågan   MANUELL ❌       AUTO ✅           Post-service email-sekvens (ny)
12. Retentionloop     MANUELL ❌       AUTO ✅           Rebook-kampanj + prenumeration (ny)
13. Support           MANUELL ❌       SEMI ⚠️           AI-chatbot + eskalering (ny)
14. Städar-onboarding MANUELL ❌       AUTO ✅           Auto-approval pipeline (ny)
```

**Nuläge: 5 av 14 steg automatiserade (36%)**
**Mål: 13 av 14 steg automatiserade (93%)**
**Enda manuella steg: Faktisk städning (steg 9 — fysiskt arbete)**

---

## 2. SYSTEMARKITEKTUR

```
┌────────────────────────────────────────────────────────────────┐
│                    SPICK AUTONOMOUS OPS                         │
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │ CONTENT │  │ BOOKING │  │MATCHING │  │ SERVICE │          │
│  │ ENGINE  │  │  FLOW   │  │  ENGINE │  │ COORD.  │          │
│  │ (leads) │  │ (conv.) │  │  (AI)   │  │ (ops)   │          │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘          │
│       │            │            │             │                │
│  ┌────▼────────────▼────────────▼─────────────▼────┐          │
│  │              SUPABASE (PostgreSQL)               │          │
│  │  bookings · cleaners · customers · reviews       │          │
│  │  content_queue · automation_log · messages        │          │
│  └──────────────────┬──────────────────────────┘    │          │
│                     │                                │          │
│  ┌────────────┐  ┌──▼───────┐  ┌──────────┐        │          │
│  │ POST-SVC   │  │ EDGE     │  │ RETENTION│        │          │
│  │ FOLLOW-UP  │  │FUNCTIONS │  │  ENGINE  │        │          │
│  │ (reviews)  │  │ (14 st)  │  │ (rebook) │        │          │
│  └────────────┘  └──────────┘  └──────────┘        │          │
│                                                      │          │
│  AI AGENTS:                                          │          │
│  🤖 Chat Support (claude Edge Function)             │          │
│  🤖 Content Generator (Anthropic API via GH Action) │          │
│  🤖 Smart Matcher (cleaner ↔ booking)               │          │
│  🤖 Review Analyzer (sentiment → improvement)       │          │
│                                                      │          │
│  EXTERNAL:                                           │          │
│  💳 Stripe (betalning) · 📧 Resend (email)         │          │
│  📱 Buffer (social) · 🔒 BankID (verifiering)      │          │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. DETALJERADE AUTOMATIONSFLÖDEN

### FLÖDE A: Lead → Kund (kundanskaffning)

```
Besökare hittar spick.se
     │
     ├─ Via SEO (40+ keywords, 20 stadssidor, 6 bloggartiklar)
     ├─ Via Social (Content Engine: 7 inlägg/vecka på 3 plattformar)
     ├─ Via Referral (tipsa-en-van.html, rabattkod)
     └─ Via Retargeting (exit-intent popup → email-sekvens)
     │
     ▼
[INDEX.HTML] Hero: "175 kr/h med RUT"
     │ CRO: urgency badge, trust bar, social proof toast
     ▼
[STADARE.HTML] Bläddra städare
     │ Filter: stad, tjänst, betyg, pris, tillgänglighet
     ▼
[BOKA.HTML] 4-stegs bokningsflöde
     │ Steg 1: Tjänst + kvm + datum
     │ Steg 2: Välj städare (med betyg + bio)
     │ Steg 3: Dina uppgifter + personnummer (RUT)
     │ Steg 4: Betala (Stripe)
     ▼
[STRIPE CHECKOUT] Betalning (kort/Klarna)
     │
     ▼
[STRIPE WEBHOOK] → booking.status = 'betald'
     │
     ▼
[NOTIFY] Bekräftelse-email till kund + städare
     │
     ▼
[AUTO-REMIND] 24h + 2h påminnelser
     │
     ▼
[LEVERANS] Städaren utför tjänsten
     │
     ▼
[POST-SERVICE] Review-förfrågan → betyg → retention
```

### FLÖDE B: Post-service automation (NY — behöver byggas)

```
Städning slutförd (städare markerar "Klar" i dashboard)
     │
     ├─ T+0h: Statusuppdatering till kund ("Din städning är klar! ✅")
     │
     ├─ T+2h: Review-förfrågan email
     │   "Hur var din städning? Ge [städare] ett betyg ⭐"
     │   → Direkt länk till betygssida
     │
     ├─ T+24h: Om inget betyg → påminnelse
     │   "Vi vill gärna höra hur det gick! 🙏"
     │
     ├─ T+7d: Rebook-kampanj
     │   "Dags att boka igen? Din städare [namn] har lediga tider."
     │   → Direktlänk till samma städare
     │
     ├─ T+14d: Om ej rebookat → erbjudande
     │   "10% rabatt på din nästa bokning med kod KOMTILLBAKA"
     │
     └─ T+30d: Win-back
         "Vi saknar dig! Boka nu och få 15% rabatt."
```

### FLÖDE C: Städar-onboarding (NY — behöver byggas)

```
Ansökan inkommer (bli-stadare.html)
     │
     ├─ T+0: Auto-bekräftelse email
     │   "Tack för din ansökan! Vi granskar den inom 24h."
     │
     ├─ T+1h: Auto-screening
     │   - Finns e-post redan i systemet? → Flagga
     │   - Stad matchar aktiv efterfrågan? → Prioritera
     │   - F-skatt-checkbox markerad? → Score +1
     │
     ├─ T+24h: Om auto-screen OK → Auto-godkänn
     │   - Skicka välkomstpaket (email + guide)
     │   - Skapa cleaner-profil (status: 'pending_bankid')
     │   - Bjud in till BankID-verifiering
     │
     ├─ T+48h: Om BankID OK → Aktivera profil
     │   - Status: 'godkänd'
     │   - Synlig i stadare.html
     │   - Välkomst-email med första-uppdrag-tips
     │
     └─ T+72h: Om BankID EJ gjort → Påminnelse
         "Slutför din BankID-verifiering för att börja ta uppdrag"
```

### FLÖDE D: Intelligent matchning (NY — behöver byggas)

```
Ny bokning inkommer
     │
     ├─ 1. Hämta bokningsdetaljer (tjänst, datum, tid, stad, kvm)
     │
     ├─ 2. Filtrera tillgängliga städare
     │   - Stad matchar
     │   - Datum/tid matchar cleaner_availability
     │   - Inte blockerad (cleaner_blocked_dates)
     │   - Rätt tjänst i services[]
     │
     ├─ 3. Ranka matchade städare
     │   - Betyg (40% vikt)
     │   - Antal genomförda städningar (20%)
     │   - Geografisk närhet (20%)
     │   - Kundens preferens (om rebook → samma städare, 20%)
     │
     ├─ 4. Tilldela bästa match
     │   - Uppdatera booking.cleaner_id
     │   - Skicka notis till städare
     │   - Skicka bekräftelse till kund med städarens namn
     │
     └─ 5. Fallback
         - Om ingen match → alert till admin
         - Om städare avböjer → auto-tilldela #2
         - Om ingen tillgänglig → erbjud kund alternativt datum
```

---

## 4. AI-AGENTER — ROLLER & ANSVAR

### Agent 1: 🤖 Chat Support (claude Edge Function — finns)
**Trigger:** Kund klickar chat-widget på spick.se
**Ansvar:**
- Svara på vanliga frågor (priser, RUT, hur det funkar)
- Guida till bokning ("Vill du boka? Klicka här →")
- Hantera avbokningar och ändringar
- Eskalera komplexa ärenden till hello@spick.se

**Prompt-kärna:**
```
Du är Spick-assistenten. Svara på svenska, vänligt och koncist.
Fakta: Hemstädning från 175 kr/h med RUT. BankID-verifierade städare.
Gratis avbokning 24h. Nöjdhetsgaranti.
Om kunden vill boka → hänvisa till spick.se/stadare.html
Om du inte kan svara → "Jag skickar din fråga till teamet!"
```

### Agent 2: 🤖 Content Generator (scripts/content-engine.js — finns)
**Trigger:** GitHub Action varje söndag 18:00
**Ansvar:**
- Generera 7 inlägg/vecka (5 pelare, 3 plattformar)
- Anpassa efter säsong och feedback-data
- Pusha till Buffer Drafts

### Agent 3: 🤖 Smart Matcher (NY — bygga som Edge Function)
**Trigger:** Ny bokning med status 'betald'
**Ansvar:**
- Filtrera och ranka tillgängliga städare
- Auto-tilldela bästa match
- Skicka notiser till kund + städare
- Hantera avböjanden och omtilldelning

### Agent 4: 🤖 Review Analyzer (NY — bygga som cron)
**Trigger:** Nytt betyg inkommet
**Ansvar:**
- Analysera sentiment (positivt/negativt)
- Flagga negativa betyg (<3 stjärnor) till admin
- Generera förbättringsförslag till städare
- Uppdatera städarens avg_rating

### Agent 5: 🤖 Retention Engine (NY — utöka auto-remind)
**Trigger:** T+2h, T+24h, T+7d, T+14d, T+30d efter leverans
**Ansvar:**
- Review-förfrågan (T+2h)
- Rebook-påminnelse (T+7d)
- Win-back-erbjudande (T+14d, T+30d)
- Prenumeration-pitch (efter 3:e bokningen)

---

## 5. VERKTYG & INTEGRATIONER

```
┌─────────────────────────────────────────────────┐
│  KÄRNSYSTEM                                      │
│  Supabase (PostgreSQL + Edge Functions + Auth)   │
│  GitHub Pages (frontend hosting)                 │
│  GitHub Actions (automation, CI/CD, cron)         │
└────────────────────┬────────────────────────────┘
                     │
     ┌───────────────┼───────────────┐
     │               │               │
┌────▼────┐    ┌─────▼────┐    ┌─────▼────┐
│ BETALN. │    │  KOMM.   │    │  MARKET. │
│ Stripe  │    │  Resend  │    │  Buffer  │
│ Klarna  │    │  (email) │    │  (social)│
│ Swish   │    │  Push    │    │  Anthropic│
└─────────┘    │  (notis) │    │  (AI)    │
               └──────────┘    └──────────┘
```

| Verktyg | Funktion | Status | Kostnad |
|---------|----------|--------|---------|
| Supabase | DB + Auth + Edge Functions | ✅ Live | Gratis (Free) |
| GitHub Pages | Frontend hosting | ✅ Live | Gratis |
| GitHub Actions | CI/CD + Automation | ✅ Live (26 workflows) | Gratis |
| Stripe | Betalning (kort + Klarna) | ⚠️ Test-läge | 1.4% + 1.8 kr/tx |
| Resend | Transaktionella email | ✅ Live | Gratis (100/dag) |
| Buffer | Social media scheduling | ⚠️ 1/3 kanaler | Gratis (Free) |
| Anthropic API | AI content + chat | ✅ Nyckel finns | ~200 kr/mån |
| BankID/GrandID | Verifiering | ⚠️ Demo-läge | ~500 kr/mån |
| Loopia | DNS + domän | ✅ Live | ~200 kr/år |
| **Total driftskostnad** | | | **~1 000 kr/mån** |

---

## 6. RISKHANTERING & FAIL-SAFES

### Fail-safe 1: Betalning misslyckas
```
Trigger: Stripe webhook error / timeout
Åtgärd: 
  1. Bokning sparas med status 'pending'
  2. Kund-email: "Din betalning hanteras — vi återkommer inom 1h"
  3. Admin-alert: "Betalning misslyckad för bokning X"
  4. Retry: Stripe webhook har inbyggd retry (3 försök)
  5. Fallback: Manuell hantering via admin.html
```

### Fail-safe 2: Ingen städare tillgänglig
```
Trigger: Smart Matcher hittar 0 matchande städare
Åtgärd:
  1. Erbjud kund 3 alternativa datum/tider
  2. Lägg bokning i "väntelista"
  3. Notifiera alla städare i området
  4. Admin-alert efter 2h utan match
  5. Kund-email: "Vi letar efter en städare — du får bekräftelse inom 2h"
```

### Fail-safe 3: Städare uteblir (no-show)
```
Trigger: Ingen "checked in" inom 30 min efter starttid
Åtgärd:
  1. SMS till städare: "Är du på väg?"
  2. T+15min: Ring städare (manuell eskalering)
  3. T+30min: Kund-email: "Din städare är försenad — vi löser det"
  4. T+60min: Auto-omtilldela till backup-städare
  5. Kompensation: Gratis nästa städning
```

### Fail-safe 4: Negativ review (<3 stjärnor)
```
Trigger: Nytt betyg med rating < 3
Åtgärd:
  1. Admin-alert omedelbart
  2. Auto-email till kund: "Vi ber om ursäkt — hur kan vi göra det bättre?"
  3. Erbjud gratis omstädning (garanti)
  4. Flagga städare för uppföljning
  5. Om 3+ negativa: Pausa städarens profil
```

### Fail-safe 5: System-nere
```
Trigger: Health endpoint returnerar 503 / Frontend 5xx
Åtgärd:
  1. Uptime monitor (var 30 min) detekterar
  2. Auto-alert till admin
  3. Service Worker serverar cachad version (SWR)
  4. Bokningar i pipeline fortsätter (Stripe + Supabase oberoende)
  5. Disaster recovery: Nattlig backup (GitHub Actions)
```

### Fail-safe 6: Edge Function krasch
```
Trigger: Edge Function returnerar 500
Åtgärd:
  1. Email retry-kö (email_queue-tabell, 3 försök)
  2. Exponential backoff (30s → 60s → 120s)
  3. Dead letter → admin-alert
  4. Auto-redeploy vid push (GitHub Actions)
```

---

## 7. SKALBARHET

### Fas 1: 0-100 bokningar/mån (nu)
- **Infra:** Supabase Free, GitHub Free, Resend Free
- **Flaskhalsar:** Stripe inte live, BankID i demo
- **Manuellt:** Städar-godkännande, support
- **Kostnad:** ~500 kr/mån

### Fas 2: 100-500 bokningar/mån
- **Infra:** Supabase Pro (299 kr), Resend Growth (200 kr)
- **Nya behov:** Smart Matcher live, retention-engine
- **Manuellt:** Kvalitetskontroll, komplexa supportärenden
- **Kostnad:** ~2 000 kr/mån

### Fas 3: 500-2000 bokningar/mån
- **Infra:** Supabase Pro + read replicas, dedikerad support-person
- **Nya behov:** Städar-app (React Native), realtidsspårning
- **Manuellt:** Strategiska beslut, partnersamarbeten
- **Kostnad:** ~5 000 kr/mån

### Fas 4: 2000+ bokningar/mån
- **Infra:** Multi-region, CDN, dedicated DB
- **Nya behov:** AI-driven prissättning, automatisk marknadsexpansion
- **Manuellt:** Affärsutveckling
- **Kostnad:** ~15 000 kr/mån

---

## 8. IMPLEMENTERINGSPRIORITET

### Sprint 1: Aktivera betalning (Vecka 1)
- [x] RLS-härdning ✅
- [x] Health endpoint ✅
- [ ] Stripe live-läge (byt STRIPE_SECRET_KEY)
- [ ] Resend domänverifiering (DKIM/SPF)
- [ ] Testa fullständigt bokningsflöde E2E

### Sprint 2: Post-service automation (Vecka 2-3)
- [ ] Review-förfrågan email (T+2h efter leverans)
- [ ] Review-påminnelse (T+24h)
- [ ] Rebook-kampanj (T+7d)
- [ ] Win-back email (T+14d, T+30d)
- [ ] Utöka auto-remind med post-service-sekvens

### Sprint 3: Smart Matcher (Vecka 4-5)
- [ ] Bygg match-engine (Edge Function)
- [ ] Auto-tilldela städare vid betalning
- [ ] Avböjande-hantering
- [ ] Fallback: admin-alert om ingen match

### Sprint 4: Städar-pipeline (Vecka 6-7)
- [ ] Auto-screening av ansökningar
- [ ] Välkomstpaket (email-sekvens)
- [ ] BankID-påminnelse (T+48h, T+72h)
- [ ] Auto-aktivering efter BankID

### Sprint 5: AI Support (Vecka 8)
- [ ] Förbättra claude Edge Function med kontext
- [ ] Träna på FAQ-data
- [ ] Eskaleringsflöde till email

---

## 9. MÄTNING — KPI:er FÖR AUTONOM DRIFT

| KPI | Mål Mån 3 | Mål Mån 6 | Mål Mån 12 |
|-----|-----------|-----------|------------|
| Bokningar/mån | 50 | 200 | 500 |
| Konverteringsgrad (besök → bokning) | 3% | 5% | 7% |
| Automatiserade steg | 65% | 85% | 93% |
| Kundnöjdhet (betyg) | 4.5★ | 4.7★ | 4.8★ |
| Review-svar-rate | 30% | 50% | 65% |
| Retention (rebook inom 30d) | 15% | 25% | 40% |
| Städare aktiva | 15 | 40 | 100 |
| Manuell tid/vecka | 5h | 2h | 30min |
| Intäkter/mån | 8 500 kr | 34 000 kr | 85 000 kr |

---

*System designat för Spick.se · Mars 2026*
*Mål: 93% autonom drift med 30 min mänsklig input per vecka*
