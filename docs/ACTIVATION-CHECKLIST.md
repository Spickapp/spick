# SPICK — AKTIVERINGSCHECKLISTA
## Allt som behöver göras manuellt för att sätta igång systemen

---

## ✅ REDAN LIVE (ingen åtgärd krävs)

- [x] RLS-härdning (48 policies → 4 minimala) — körd i SQL Editor
- [x] Health endpoint (/functions/v1/health) — deployad
- [x] CRO Sprint 1 (hero, trust bar, urgency, toasts) — live på spick.se
- [x] CRO Sprint 2 (prisankare, exit-intent) — live
- [x] SEO Sprint 1 (title tags, footer linking, sitemap) — live
- [x] SEO Sprint 2 (meta desc, breadcrumbs, blog CTAs) — live
- [x] Shared components (nav/footer) — live på 49 sidor
- [x] Service Worker v3 — live
- [x] Cache headers — live
- [x] Global error handlers — live
- [x] 14 Edge Functions deployade
- [x] 26 GitHub Actions workflows aktiva

## ⚠️ KRÄVER MANUELL ÅTGÄRD (Supabase SQL Editor)

### 1. Content Engine-tabeller
Kör denna migration i Supabase SQL Editor:
```
Fil: supabase/migrations/20260327600001_content_engine_tables.sql
```
Skapar: `content_queue` + `content_performance` tabeller

### 2. Stripe Live-läge
- Gå till Stripe Dashboard → Settings → Activate account
- Uppdatera STRIPE_SECRET_KEY i Supabase Secrets med live-nyckel
- Registrera webhook-URL: `https://urjeijcncsyuletprydy.supabase.co/functions/v1/stripe-webhook`

### 3. Resend domänverifiering
- Gå till Resend Dashboard → Domains
- Verifiera spick.se med DKIM/SPF-poster via Loopia:
  - Lägg till TXT-post: `resend._domainkey.spick.se` med DKIM-värde
  - Lägg till SPF i befintlig TXT: `include:amazonses.com`

## ⚠️ KRÄVER MANUELL ÅTGÄRD (Content Engine)

### 4. Koppla sociala medier i Buffer
- Buffer → Connect channels → Koppla Instagram Business-konto
- Buffer → Connect channels → Koppla Facebook-sida
- Buffer → Connect channels → Koppla TikTok (Business)

### 5. Buffer API-token
- Buffer → Settings → Developers → Personal Access Token
- Lägg till som GitHub Secret: `BUFFER_ACCESS_TOKEN`

### 6. Testa Content Engine manuellt
- GitHub → Actions → Weekly Content Engine → Run workflow
- Verifiera att 7 inlägg genereras och sparas i content_queue

## 📊 DOKUMENT ATT LÄSA

| Dokument | Innehåll |
|----------|----------|
| docs/CRO-RAPPORT-2026-03.md | Funnel-analys, 10 problem, 10 A/B-tester, 3 sprints |
| docs/SEO-STRATEGI-2026.md | 40+ keywords, sidstruktur, content-plan, 6 mån |
| docs/CONTENT-ENGINE-2026.md | Content-pelare, automation, exempel, tillväxt |
| docs/OPERATIONS_MANUAL.md | Daglig drift, felsökning, kontaktinfo |

## 🔮 NÄSTA STEG (prioritetsordning)

1. **Aktivera Stripe live-läge** → faktiska betalningar
2. **Kör content_engine_tables.sql** → aktivera content engine
3. **Koppla Instagram + TikTok till Buffer** → börja posta
4. **Skapa Google Business Profile** → lokal SEO
5. **Utöka RUT-avdrag-guiden till 2500+ ord** → SEO-trafik
6. **Skapa hemstadning.html tjänste-hub** → SEO-arkitektur
7. **Reverse bokningsflöde** (städare först) → CRO Sprint 3
8. **Flytta BankID till sista steget** → städar-registrering
9. **Programmatisk SEO** (500 stad×tjänst-sidor) → skalbar trafik
10. **Micro-influencer samarbeten** → social proof
