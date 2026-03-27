# SPICK.SE — RYKTESSYSTEM
## Maximera positiva omdömen, fånga missnöjda kunder tidigt, bygg förtroende

---

## 1. SYSTEMÖVERSIKT

```
KUNDRESA          TRIGGER                ÅTGÄRD                    MÅL
───────────────────────────────────────────────────────────────────────
Bokning skapad    T+0                    Bekräftelse-email          Trygghet
Påminnelse        T-24h                  "Imorgon kl 10:00"         Förväntning
Leverans          T+0h (start)           Städare checkar in         Transparens
Leverans klar     T+0h (slut)            "Din städning är klar!"    Nöjdhet
─── REVIEW-SEKVENS STARTAR HÄR ──────────────────────────────────────
Känslocheck       T+2h                   "Hur gick det? 😊/😐/😞"  Tidig signal
Review-förfrågan  T+3h (om positivt)     "Lämna betyg → 30 sek"    5-stjärnigt
Intervention      T+3h (om negativt)     "Vi löser det — kontakta"  Rädda kunden
Google Review     T+48h (om 4-5★)        "Hjälp oss på Google →"   SEO + trust
Påminnelse        T+72h (om inget svar)  "Din åsikt spelar roll"   Öka svarsfrekvens
Tack + referral   T+7d (om lämnat 5★)    "Tipsa en vän, båda 15%"  Retention + viral
```

---

## 2. DEN TVÅSTEGSMODELLEN — FÅNGA MISSNÖJE FÖRE REVIEW

### Steg 1: Känslocheck (T+2h efter leverans)
**Skicka INNAN review-förfrågan. 3 knappar: 😊 😐 😞**

```
Ämne: "Hur gick din städning? (1 klick)"

Hej [förnamn]!

Din [tjänst] med [städarnamn] är klar.

Hur gick det?

  [😊 Fantastiskt!]   [😐 Okej]   [😞 Inte nöjd]

(Klicka den som passar bäst — tar 1 sekund)
```

**Routing baserad på svar:**

| Svar | Åtgärd | Timing |
|------|--------|--------|
| 😊 Fantastiskt | → Review-förfrågan med 5-stjärnig pre-fill | T+3h |
| 😐 Okej | → "Vad kan vi förbättra?" (intern feedback) | Direkt |
| 😞 Inte nöjd | → Omedelbar intervention (garanti-erbjudande) | Direkt |
| Inget svar | → Standard review-förfrågan | T+3h |

### Steg 2a: Positiv routing (😊)
```
Ämne: "Tack! Kan du lämna ett betyg? ⭐ (30 sek)"

Fantastiskt att höra, [förnamn]! 🎉

Ditt betyg hjälper [städarnamn] enormt och gör det lättare
för andra att hitta bra städare.

[⭐⭐⭐⭐⭐ Lämna betyg → spick.se/betyg.html]

Tar bara 30 sekunder. Tack!
```

### Steg 2b: Negativ routing (😞)
```
Ämne: "Vi vill göra det rätt 💚"

Hej [förnamn],

Vi beklagar att du inte var nöjd. Det är inte okej,
och vi vill lösa det.

Du har tre alternativ:
1. 🧹 Gratis omstädning inom 48h
2. 💰 100% pengarna tillbaka
3. 📞 Prata med oss: hello@spick.se

Svara på detta mejl eller ring oss direkt.

// Spick — Nöjdhetsgaranti
```

**Admin-alert vid 😞:**
- Omedelbar notis till hello@spick.se
- Flagga städare i systemet
- Logga i customer_feedback-tabell

### Steg 2c: Neutral routing (😐)
```
Ämne: "Tack för din feedback — vad kan vi göra bättre?"

Hej [förnamn],

Tack för att du berättade. Vi vill bli bättre!

Vad hade gjort skillnad?
□ Bättre kommunikation
□ Mer noggrann städning
□ Punktlighet
□ Annat: [fritetext]

[Skicka feedback →]

Din åsikt hjälper oss förbättra tjänsten för alla.
```

---

## 3. GOOGLE REVIEWS-ROUTING

### Timing: T+48h efter att kund lämnat 4-5★ på spick.se

```
Ämne: "En sista sak — hjälp oss på Google? 🙏"

Hej [förnamn]!

Tack igen för ditt fantastiska betyg! 🌟

Om du har 30 sekunder till — ditt omdöme på Google hjälper
andra hitta oss och ger oss kraft att fortsätta.

[Lämna Google-omdöme →]

(Bara om du vill — vi uppskattar det oavsett!)
```

**Viktigt:** Skickas BARA till kunder som gett 4-5★ på spick.se.
Aldrig till missnöjda kunder (undviker negativa Google-reviews).

### Google Business Profile-länk
```
https://search.google.com/local/writereview?placeid=PLACE_ID
```
Kräver: Skapa Google Business Profile per stad → hämta Place ID.

---

## 4. REVIEW-PÅMINNELSE (om inget svar)

### T+72h: Sista påminnelse
```
Ämne: "Vi vill gärna höra från dig 🙏"

Hej [förnamn],

Vi frågade för några dagar sedan hur din städning gick.
Din åsikt spelar roll — den hjälper [städarnamn] att bli ännu bättre.

[Lämna betyg → 30 sekunder]

Tack för att du använder Spick! 💚
```

**Regel:** Max 2 review-förfrågningar per bokning. Aldrig mer.

---

## 5. NEGATIV-INTERVENTION SYSTEM

### Tidig varning: 3 signaler

| Signal | Källa | Åtgärd |
|--------|-------|--------|
| 😞 i känslocheck | Email-klick | Omedelbar intervention + admin-alert |
| Betyg ≤ 2★ | betyg.html | Auto-email garanti + admin-alert |
| Klagomål-email | email-inbound | AI-kategorisering + prioriterad kö |

### Eskaleringsmodell

```
Rating 1-2★ → KRITISK
  T+0: Admin-alert (push + email)
  T+0: Auto-email till kund: Garanti-erbjudande
  T+1h: Personlig uppföljning (manuellt)
  T+24h: Erbjud omstädning eller återbetalning
  T+48h: Be kund uppdatera review om löst

Rating 3★ → MEDIUM  
  T+0: Intern feedback-logg
  T+24h: Email: "Tack för din feedback — vi jobbar på det"
  T+7d: Erbjud rabatt på nästa bokning

Rating 4-5★ → POSITIV
  T+0: Tack-email
  T+48h: Google Review-förfrågan
  T+7d: Referral-erbjudande
```

### Städare-konsekvenser

| Mönster | Åtgärd |
|---------|--------|
| 1 dålig review | Intern feedback + coaching-tips |
| 2 dåliga reviews (30d) | Varning + obligatorisk checklista |
| 3 dåliga reviews (90d) | Profil pausad + samtal |
| Snittbetyg < 3.5 | Auto-avaktivera profil |

---

## 6. REVIEW-DISPLAY — MAXIMERA TRUST-EFFEKTEN

### På spick.se

**Index.html:**
- ✅ 3 testimonials finns (Anna S., Marcus L., Sofia K.)
- ⚠️ Saknas: Dynamiska betyg från Supabase (istället för hårdkodade)
- ⚠️ Saknas: Totalt antal betyg ("Baserat på 127 kundbetyg")
- ⚠️ Saknas: Schema.org Review-markup per testimonial

**Stadare.html:**
- ✅ Städarkort med avg_rating
- ⚠️ Saknas: Kundcitat per städare
- ⚠️ Saknas: "Senaste omdömet" per städare

**Boka.html:**
- ✅ Trust-element i sidebar
- ⚠️ Saknas: Realtidsbetyg ("4.9★ baserat på X betyg")

### Schema.org-optimering

```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Spick",
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.9",
    "reviewCount": "127",
    "bestRating": "5"
  },
  "review": [
    {
      "@type": "Review",
      "author": { "@type": "Person", "name": "Anna S." },
      "reviewRating": { "@type": "Rating", "ratingValue": "5" },
      "reviewBody": "Fantastisk städning! Extremt nöjd.",
      "datePublished": "2026-03-15"
    }
  ]
}
```

---

## 7. AUTOMATISERINGSFLÖDEN

### Flöde implementerat i auto-remind/index.ts

```
// Befintligt:
T+3h:  Review-förfrågan (review_requested_at)     ✅ FINNS
T+7d:  Rebook-kampanj (rebook_7d)                  ✅ FINNS
T+14d: Win-back (winback_14d)                       ✅ FINNS

// Nytt att bygga:
T+2h:  Känslocheck (sentiment_check)               ❌ BYGGA
T+48h: Google Review-routing (google_review)        ❌ BYGGA
T+72h: Review-påminnelse (review_reminder)          ❌ BYGGA
T+7d:  Referral-erbjudande efter 5★ (referral_5star) ❌ BYGGA
```

### Databas: customer_feedback-tabell

```sql
CREATE TABLE customer_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  booking_id UUID REFERENCES bookings(id),
  customer_email TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  source TEXT DEFAULT 'email_check',
  feedback_text TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolution TEXT
);
```

---

## 8. RYKTESTILLVÄXT-STRATEGI

### Fas 1: Grundning (Mån 1-3)
**Mål: 50 betyg, 4.8+ snitt**
- Aktivera känslocheck + review-sekvens
- Be tidiga kunder personligt om Google-omdöme
- Svara på alla betyg (positivt → tack, negativt → lösning)
- Visa betyg dynamiskt på sajten

### Fas 2: Tillväxt (Mån 4-6)
**Mål: 150 betyg, 4.7+ snitt, 20 Google-omdömen**
- Aktivera Google Review-routing
- Skapa Google Business Profile per stad
- Implementera betyg per städare på stadare.html
- A/B-testa review-förfrågan timing (2h vs 4h vs 24h)

### Fas 3: Skalning (Mån 7-12)
**Mål: 500 betyg, 4.7+ snitt, 50 Google-omdömen per stad**
- Trustpilot-integration
- Video-testimonials (be 5★-kunder om 30s video)
- "Årets städare"-kampanj (uppmuntra betyg)
- Automatisk betygs-widget på alla sidor

### KPI:er

| KPI | Mån 3 | Mån 6 | Mån 12 |
|-----|-------|-------|--------|
| Totala betyg | 50 | 150 | 500 |
| Snittbetyg | 4.8★ | 4.7★ | 4.7★ |
| Review-svarsfrekvens | 30% | 45% | 55% |
| Google-omdömen per stad | 5 | 20 | 50 |
| Negativ-interception rate | 50% | 75% | 90% |
| Negativa publika reviews | <5% | <3% | <2% |

---

## 9. PSYKOLOGISKA TRIGGERS FÖR 5-STJÄRNIGA BETYG

### I review-förfrågan

1. **Timing:** Skicka när kunden är som nöjdast (2-3h efter leverans)
2. **Personalisering:** Använd städarens namn ("Hjälp Sara att nå 50 betyg!")
3. **Reciprocitet:** "Din städare gjorde sitt bästa — ett betyg tar 30 sek"
4. **Social norm:** "87% av våra kunder lämnar betyg"
5. **Specifik fråga:** "Var [städarnamn] noggrann och punktlig?" (leder till positiva svar)
6. **Enkel process:** Max 2 klick (öppna email → klicka stjärnor → skicka)
7. **Pre-fill:** Länka direkt till betyg.html med ?rating=5 pre-valt
8. **Tack-loop:** Tacka omedelbart efter betyg ("Tack! [Städarnamn] kommer bli glad")

### I betyg.html UX

1. **Stjärnor stora och klickbara** (44px touch target)
2. **5 stjärnor pre-hovrade** (anchoring mot 5)
3. **Kommentar valfri** (minska friktion)
4. **"Tar bara 30 sekunder"** (minska perceived effort)
5. **Visa städarens namn och foto** (emotional connection)
6. **Confirmation:** "🎉 Tack! Ditt betyg har sparats"

---

## 10. IMPLEMENTATION PRIORITY

### Sprint 1 (Vecka 1-2): Känslocheck + förbättrad review
- [ ] Bygg sentiment_check i auto-remind (T+2h, 3 knappar)
- [ ] Routing: 😊→review, 😐→feedback, 😞→intervention
- [ ] Admin-alert vid 😞 + betyg ≤2★
- [ ] customer_feedback-tabell i Supabase

### Sprint 2 (Vecka 3-4): Google Reviews + påminnelser
- [ ] Google Review-routing (T+48h, bara 4-5★)
- [ ] Review-påminnelse (T+72h, max 2 per bokning)
- [ ] Google Business Profile per stad
- [ ] Skapa Place ID-hantering

### Sprint 3 (Vecka 5-6): Display + Social proof
- [ ] Dynamiska betyg på index.html (från Supabase)
- [ ] Betyg per städare på stadare.html
- [ ] Schema.org Review-markup med riktiga data
- [ ] "Baserat på X kundbetyg" dynamisk räknare

### Sprint 4 (Vecka 7-8): Analys + Optimering
- [ ] Dashboard: Review-trender, snittbetyg, svarsfrekvens
- [ ] A/B-test: Timing av review-förfrågan
- [ ] Negativ-trend-analys per städare
- [ ] Automatisk städar-feedback vid < 4★

---

*System designat för Spick.se · Mars 2026*
*Mål: 55% review-svarsfrekvens, <2% negativa publika reviews*
