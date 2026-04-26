# Säkerhets-headers Deployment (HÖG 4 från security-audit 2026-04-26)

**Status:** Dokumenterad — kräver extern deployment-arch-ändring
**Tid:** 5-15 min Farhad-action via Cloudflare-konto
**Audit-finding:** Inga säkerhets-headers i prod (CSP/HSTS/X-Frame-Options/X-Content-Type-Options saknas)

---

## Problem

`_headers`-filen i repo-roten är **Cloudflare Pages / Netlify-syntax**. GitHub Pages
**ignorerar den helt**. Verifierat via `curl -I https://spick.se/`:
```
HTTP/2 200
content-type: text/html; charset=utf-8
last-modified: ...
etag: "..."
(INGEN content-security-policy, INGEN strict-transport-security)
```

GitHub Pages tillåter **inga custom HTTP headers** över huvud taget för publika repon.
Detta är en hård platforms-begränsning.

---

## 3 alternativ (rekommenderar #1)

### Alternativ 1: Cloudflare DNS-proxy (REKOMMENDERAS — 10 min, 0 kod-ändring)

Cloudflare som DNS-proxy framför GitHub Pages = möjligt att sätta headers via Cloudflare Transform Rules.

**Steg:**
1. Skapa Cloudflare-konto (free tier räcker)
2. Lägg till `spick.se` som site
3. Cloudflare ger 2 nameservers — uppdatera hos nuvarande DNS-provider (Loopia)
4. Aktivera "Proxied" (orange moln) på `spick.se` + `www.spick.se` A-records
5. **Rules → Transform Rules → Modify Response Header → Create rule:**
   - **Hostname** equals `spick.se`
   - **Add headers:**
     - `Strict-Transport-Security`: `max-age=31536000; includeSubDomains; preload`
     - `X-Frame-Options`: `DENY`
     - `X-Content-Type-Options`: `nosniff`
     - `Referrer-Policy`: `strict-origin-when-cross-origin`
     - `Permissions-Policy`: `geolocation=(self), camera=(), microphone=(), payment=(self "https://js.stripe.com")`
     - `Content-Security-Policy`: `default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com https://browser.sentry-cdn.com https://cdn.jsdelivr.net https://maps.googleapis.com https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://www.clarity.ms; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://urjeijcncsyuletprydy.supabase.co https://api.stripe.com https://*.ingest.sentry.io https://www.google-analytics.com https://maps.googleapis.com; frame-src https://js.stripe.com; object-src 'none'; base-uri 'self'`

**Bonus:** Cloudflare ger även gratis SSL, DDoS-skydd, edge-caching.

### Alternativ 2: Migrera till Cloudflare Pages helt (1-2h)

- Skapa Cloudflare Pages-projekt
- Connect GitHub repo
- `_headers`-filen i repo respekteras automatiskt
- Mer arbete men engångskostnad — sedan all framtida deploy fungerar

### Alternativ 3: Meta-tags i HTML (begränsad mitigation, inte fullständig)

Bara CSP fungerar via `<meta http-equiv="Content-Security-Policy" content="...">`.
HSTS, X-Frame-Options, X-Content-Type-Options måste vara HTTP-headers — kan
INTE sättas via meta-tag.

Om du vill köra detta som tillfällig mitigation tills Cloudflare är på plats:
lägg en gemensam meta-CSP i components.js eller direkt i `<head>` på alla
HTML-filer.

---

## Rekommenderat tillvägagångssätt

**Alt 1 (Cloudflare DNS-proxy)**. Tar 10 min, ingen kod-ändring, levererar **alla**
4 headers + bonus (SSL, DDoS, caching).

Efter att DNS-proxy är aktiv:
```bash
curl -I https://spick.se/ | grep -iE "content-security-policy|strict-transport-security|x-frame-options"
# Förväntad output: alla 3 headers visas
```

---

## Pentest-relevans

Extern pentestare kommer flagga avsaknad av säkerhets-headers som **HIGH**-finding
oavsett. Genom att ha Cloudflare-config klar INNAN pentesten startar:
- Sparar pentest-tid (de hoppar över denna kategori)
- Pentestaren fokuserar på real-meaty findings (auth, business-logic)
- Du undviker pinsam "lågt-hängande frukt" i pentest-rapport

---

## Tidsstämpel

2026-04-26 — Skapad efter intern security-audit (Fas 13). Väntar på
Farhads Cloudflare-konto-skapande för aktivering.
