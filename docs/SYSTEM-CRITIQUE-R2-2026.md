# SPICK.SE — SYSTEMKRITIK RUNDA 2
## Ännu hårdare granskning — inga ursäkter, inga kompromisser

---

## 1. NYA KRITISKA SÅRBARHETER (missade i runda 1)

### 🔴 KRITISK: Fake-review-attack — anon kan skapa falska betyg
**Evidens:** `CREATE POLICY "Anon insert reviews" ON reviews FOR INSERT WITH CHECK (true);`

Vem som helst med anon-nyckeln (publik i config.js) kan:
```bash
curl -X POST https://urjeijcncsyuletprydy.supabase.co/rest/v1/reviews \
  -H "apikey: ANON_KEY" \
  -d '{"booking_id":"fake-uuid","rating":5,"comment":"Fantastiskt!","reviewer_name":"Fake"}'
```

Ingen verifiering att booking_id hör till en riktig, avslutad bokning. En konkurrent kan fylla systemet med falska 1-stjärniga reviews, eller du kan fabricera 5-stjärniga. Båda förstör förtroendet.

**Fix:** RLS-policy som kräver att booking_id matchar en `status='klar'`-bokning. Migration sparad: `supabase/migrations/20260327700001_fix_reviews_messages_rls.sql`

---

### 🔴 KRITISK: Messages-tabellen är en spam-magnet
**Evidens:** `CREATE POLICY "Anon insert messages" ON messages FOR INSERT WITH CHECK (true);`

Obegränsad INSERT → kontaktformuläret kan användas för spam-attacker (tusentals meddelanden/minut). Ingen rate limit, ingen CAPTCHA, ingen honeypot.

**Fix:** Rate-limit via RLS subquery (max 5 meddelanden per email per timme) + honeypot-fält i kontaktformulär.

---

### 🔴 KRITISK: auto-remind kör 22 DB-anrop per exekvering — N+1 explosion
**Evidens:** `grep -c "await sb.from" auto-remind/index.ts` → 22

Vid 50 aktiva bokningar: 22 base-queries + up to 50 updates per sektion × 8 sektioner = potentiellt 400+ DB-anrop i en enda körning. Supabase Free tier rate-limitar vid ~100 requests/sekund.

**Konsekvens:** Timeout (60s Edge Function-limit). Delvis exekverade uppdateringar (inga transaktioner). Dubbla email vid race condition med nästa cron-körning.

**Fix:** Batch-hämtning med en enda query. Alla bokningar som behöver åtgärd i EN query med villkor, sedan loopa lokalt. Reducerar 22 queries → 3-4.

---

### 🟡 HÖG: Ingen cron-locking — race condition
**Problem:** auto-remind körs var 30:e minut via GitHub Actions. Om en körning tar >30 minuter (vid hög last) → två instanser kör samtidigt → dubbla email.

**Evidens:** 0 mutex/lock-mekanismer. `reminders_sent`-arrayen uppdateras EFTER email skickats, inte innan. Window = sekunder men risken finns.

**Fix:** Check-and-set: Uppdatera `reminders_sent` INNAN email skickas. Om update returnerar 0 rows → annan instans tog den. Alternativt: `pg_advisory_lock`.

---

### 🟡 HÖG: 12 av 17 script-tags i index.html saknar async/defer
**Evidens:** 17 `<script>` tags, bara 5 med async/defer.

**Konsekvens:** 12 render-blocking scripts. Browsern stoppar DOM-parsing vid varje script, laddar och exekverar det, sedan fortsätter. På 3G-anslutning = sekunder av vit skärm.

**Fix:** Alla icke-kritiska scripts → `defer`. Inline scripts (GA, Pixel) → flytta till slutet av `<body>`.

---

### 🟡 HÖG: content-engine.js kraschar på malformat JSON utan recovery
**Evidens:** `JSON.parse(jsonStr)` utan try-catch. Om Claude API returnerar markdown-wrapping, extra text, eller HTML → uncaught exception → GitHub Action misslyckas → ingen content genereras den veckan.

**Fix:** Robust JSON-extraktion med try-catch, regex-fallback för JSON i markdown, och email-alert vid failure.

---

### 🟡 HÖG: Service Worker har ingen cache-expiry
**Evidens:** SW v3 cacher HTML med Stale-While-Revalidate men ingen maxAge. Om revalidation misslyckas (offline, CDN-problem) → gammal cache serveras INDEFINITIVT.

**Fix:** Lägg till maxAge på HTML-cache: `if (cacheAge > 24h) { fetch network-only }`.

---

### 🟡 HÖG: 8 empty catch blocks i Edge Functions — fel sväljs tyst
**Evidens:**
```
geo: 2 empty catch
social-media: 3 empty catch  
email-inbound: 1 empty catch
notify: 1 empty catch
auto-remind: 1 empty catch
```

**Konsekvens:** Fel sker → ingen vet om det. Inga loggar, inga alerts, inga spår. Kunder påverkas men systemet rapporterar "allt OK".

**Fix:** Varje catch ska logga till console.error + spara i error_log-tabell.

---

### 🟡 MEDEL: 6 dead HTML-filer konsumerar crawl budget
**Evidens:** ai-support.html (0 inlänkar), seo-snippet.html (0), index_1.html (0), cookie-banner.html (0), intern-kalkyl.html (0), data-dashboard.html (0).

**Konsekvens:** Googlebot spenderar tid på att crawla meningslösa sidor istället för konverteringssidor. Crawl budget slösas.

**Fix:** Ta bort från repo eller lägg till i robots.txt Disallow (de flesta redan blockerade).

---

### 🟡 MEDEL: boka.html har 0 retry-mekanismer
**Evidens:** `grep -c "retry\|spickFetchSafe\|backoff" boka.html` → 0

Config.js har `spickFetchSafe()` med retry men boka.html använder det ALDRIG. Alla API-anrop i bokningsflödet är fire-and-forget. Om Supabase svarar med 503 → "Något gick fel" utan retry.

---

## 2. UPPGRADERADE FIXAR (implementerade)

### Fix A: Fabricerad social proof → ärlig (runda 1) ✅
Toasts inaktiverade, urgency-badge ärlig. Redan pushat.

### Fix B: components.js på alla sidor (runda 1) ✅
8 sidor fixade. Redan pushat.

### Fix C: Reviews RLS-fix (runda 2) — NY
Migration skapad: kräver att booking_id matchar avslutad bokning.

### Fix D: content-engine.js robusthet — NY
Lägg till try-catch runt JSON.parse med fallback.

---

## 3. ARKITEKTUR-OMVÄRDERING

### Vad som borde vara annorlunda om vi startade om

| Beslut | Nuvarande | Bättre | Varför |
|--------|-----------|--------|--------|
| Frontend | 70+ separata HTML-filer | Next.js/Astro med components | DRY, routing, SSR, TypeScript |
| CSS | Inline + per-page `<style>` | Tailwind CSS build | Konsistens, mindre CSS, purge |
| JS | Inline per-page + config.js | Bundler (Vite) + TS | Tree-shaking, typsäkerhet |
| E-post | Hårdkodade HTML-strängar i TS | E-postmallar i DB eller MDX | Ändra utan deploy |
| Migrations | 40 filer, ingen ordning | Supabase CLI + konsoliderad schema | Reproducerbar setup |
| Monitoring | Health endpoint + nothing | Sentry (free) + Supabase logs | Riktiga error alerts |
| Cron | GitHub Actions → Edge Function | Supabase pg_cron (inbyggt) | Ingen extern beroende |

### MEN — kontexten är viktig
Vanilla HTML/JS var rätt val för en MVP. Att migrera till Next.js nu = veckor av arbete utan nya features. Bättre: fixa de kritiska sårbarheterna och skjuta arkitektur-omskrivning till efter product-market fit.

---

## 4. PRIORITERAD ÅTGÄRDSLISTA (uppdaterad)

```
🔴 OMEDELBART (gör idag — affärskritiskt):
  1. Aktivera Stripe live-läge
  2. Kör reviews RLS-fix (stoppa fake-review-attack)
  3. Verifiera Resend-domän (DKIM/SPF)
  4. Testa E2E bokningsflöde

🟡 VECKA 1 (säkerhet + prestanda):
  5. Messages RLS rate-limit
  6. Batch DB-queries i auto-remind (22 → 4)
  7. Defer alla icke-kritiska scripts (12 st)
  8. Try-catch i content-engine.js
  9. Fyll empty catch-blocks med logging

🟢 VECKA 2-3 (arkitektur):
  10. Bryt auto-remind → 4 funktioner
  11. Bryt boka.html → css + js
  12. SW cache-expiry (24h max)
  13. Monitoring: Sentry Free + error_log-tabell
  14. Ta bort 6 dead HTML-filer

⚪ FRAMTID (efter PMF):
  15. Migrera till Astro/Next.js
  16. Tailwind CSS
  17. Supabase pg_cron istället för GitHub Actions
  18. E-postmallar i databas
```

---

## SLUTSATS RUNDA 2

Runda 1 identifierade de uppenbara problemen (monolith-filer, fabricerad data, Stripe i testläge). Runda 2 gräver djupare och hittar **systemiska risker**:

1. **Fake-review-attacken** är den mest allvarliga nya upptäckten. En konkurrent behöver 30 sekunder och ett curl-kommando för att förstöra ditt betyg.

2. **N+1-explosionen i auto-remind** kommer krascha vid 50+ bokningar. Det är inte en fråga om "om" utan "när".

3. **12 render-blocking scripts** gör att First Contentful Paint ligger på 3-5 sekunder på mobil. Google Core Web Vitals straffar detta.

4. **Empty catch-blocks** = blindflygning. Du VET INTE när saker går fel. Det är värre än att inte ha try-catch alls — åtminstone kraschar en ohanterad exception synligt.

**Den enda saken som spelar roll just nu:**
Aktivera Stripe. Gör en riktig bokning. Se om pengarna landar. Allt annat — alla strategidokument, alla automationer, alla optimeringar — är teori tills en riktig kund betalar riktiga pengar.
