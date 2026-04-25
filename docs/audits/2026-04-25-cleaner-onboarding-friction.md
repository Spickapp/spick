# Cleaner-onboarding friction-audit

**Datum:** 2026-04-25
**Audit av:** Claude (preview-eval + statisk analys)
**Scope:** `bli-stadare.html` (rekrytering) + `registrera-stadare.html` (registrering)
**Mål:** Identifiera friction-points som hindrar "varje städare vill ansluta"-vision

---

## Sammanfattning

| Severity | Antal fynd | Åtgärdade |
|---|---|---|
| 🔴 Hög | 2 | 2 ✅ |
| 🟡 Medel | 2 | 0 |
| 🟢 Nice-to-have | 2 | 0 |

---

## Fynd

### 🔴 #1 — Primary CTA below the fold (FIXAT)

**Sida:** bli-stadare.html
**Status:** ✅ Fixat 2026-04-25, commit `6ac225b`

**Problem:** "Ansök gratis — tar 3 minuter →" var vid pixel 845 i hero, mobile-viewport 812 → 33px below the fold. Användare måste scrolla för att hitta CTA.

**Effekt:** Möjlig 30-50% bounce-rate-förbättring (industri-benchmark för above-fold-CTA).

**Fix:** Flyttat hero-cta-block UP före hero-stats. Verifierat: CTA nu vid 619px = above fold.

---

### 🔴 #2 — Felaktig provision-stat 83% (FIXAT)

**Sida:** bli-stadare.html rad 233
**Status:** ✅ Fixat 2026-04-25, commit `6ac225b`

**Problem:** Hero-stat "behåller du 83%" = gammal data från trappsystem-eran. SSOT är 12% commission = 88% keep-rate.

**Fix:** Hardkodat 88%. Per memory provision.md kvarstår ~25 HTML-ställen med gamla 17%-värden.

---

### 🟡 #3 — 0 testimonials/social proof

**Sida:** bli-stadare.html
**Status:** ⏳ Pending — kräver Farhads input

**Problem:** Inga riktiga städar-citat eller social proof. För "varje städare vill ansluta"-vision behövs trovärdighet.

**Fix-skiss:** Lägg testimonial-sektion mellan "Hur det funkar" och "FAQ":
- 3 cleaner-citat med foto + namn + intäkter
- Ev. video-citat

**Blocker:** Behöver riktiga städare som vill medverka (citat + foto + samtycke).

**Workaround:** Bygg STRUKTUR med placeholder-data så det är klart att lägga till riktiga citat senare. Farhad kan senare uppdatera HTML med data.

---

### 🟡 #4 — registrera-stadare.html: 25 input-fält trots "3 min"-löfte

**Sida:** registrera-stadare.html
**Status:** ⏳ Pending — refactor-scope

**Problem:** 1 form med 25 input-fält fördelat över 17 step-element. "3 minuter" är optimistiskt.

**Fix-skiss:**
- **Snabb-onboarding:** först bara namn + email + telefon + område → ansökan inskickad
- **Detaljer senare:** efter admin-godkännande får städaren slutföra (priser, tjänster, schema, F-skatt-info)
- Spread out kognitiv belastning

**Tidsestimat:** 1-2h refactor + UX-testing

---

### 🟡 #5 — 24 FAQ-items

**Sida:** bli-stadare.html
**Status:** ⏳ Pending — UX-trim-scope

**Problem:** 24 FAQ kan vara overwhelming. Användare scannar inte allt.

**Fix-skiss:**
- Trim till 7-10 viktigaste på bli-stadare.html
- Resten på dedikerad `faq.html` med "Se alla FAQ →"-länk

**Tidsestimat:** 30 min audit + trim

---

### 🟢 #6 — Inga videos / video-introduktion

**Sida:** bli-stadare.html
**Status:** ⏳ Pending — extern (Farhad spelar in)

**Problem:** Video-content kan höja konvertering 80% per industri-data.

**Fix-skiss:** 1-2 min introduktions-video från Farhad eller riktig städare.

**Blocker:** Inspelning + redigering (extern action).

---

## Vad funkar bra (positiv kontext)

- Stark H1: "Tjäna pengar som städare — på dina egna villkor"
- Tydlig tidsestimering: "3 minuter"
- Earnings-calculator (input[type="range"]) — visar tjänstpotential
- 6 numbered steps förklarar processen
- 10 bilder för visuell variation
- Dual-target på sidan: även företag-rekrytering (sektion #foretag-section)
- Trust-elements: ID-verifiering, Stripe, F-skatt-hjälp

---

## Rekommenderad nästa-prio

1. **#3 testimonials-struktur** — bygg med placeholder, Farhad fyller i (30 min)
2. **#5 FAQ-trim** — välj 7-10 viktigaste (30 min)
3. **#4 snabb-onboarding-refactor** — separat sprint (1-2h)
4. **#6 video** — Farhads action (extern)

---

## Memory-konvention följd

- #26 grep-före-edit: alla rader verifierade via Read + Grep
- #27 scope-respekt: bara hög-impact + enkla fixes implementerade. Medel-svåra
  flaggade för separat scope
- #28 SSOT: 88% matchar platform_settings.commission_standard
- #29 audit-först: preview-eval verifierade exakt fold-position
- #30 inga regulator-antaganden
- #31 primärkälla: docs/sanning/provision.md för keep-rate-värde

## Ändringslogg

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-25 | Audit skapad. 2 fixes implementerade (CTA above-fold, 88% korrekt). 4 pending. | Claude |
