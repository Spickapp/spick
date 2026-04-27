# CSP-uppdatering för PostHog (EU Cloud)

> **Datum:** 2026-04-26
> **Region:** EU Cloud (Frankfurt) — `eu.i.posthog.com`
> **Verifierad EU-host:** Officiell PostHog-dokumentation (`https://posthog.com/docs/libraries/js`)
> **Datasäkerhet:** Data lagras i EU. Inga EU→US-transfers (till skillnad från US Cloud).

## Setup-flöde för Farhad

1. **Signup på posthog.com**
   - Välj **EU region (Frankfurt)** vid signup — *kritiskt för GDPR*. Om du redan signat US-konto, skapa nytt EU-konto (kan inte migrera region).
   - Skapa projekt: `Spick web`
   - Kopiera **Project API Key** (formatet `phc_xxxxxxxx...`)

2. **Lägg in nyckeln i Spick**
   - Editera `js/config.js` rad ~20: `POSTHOG_KEY: 'phc_dinNyckelHar',`
   - Commit + push → GitHub Pages auto-deploy.
   - Loadern (`js/posthog-loader.js`) skippar silent om key är tom — säkert att deploya utan nyckel.

3. **Uppdatera CSP i Cloudflare** (steg nedan).

4. **Verifiera i PostHog dashboard**
   - Öppna `https://spick.se` i incognito → events ska dyka upp i PostHog inom 30 sek
   - Session replay: kolla "Session Recordings"-fliken efter ett klickflöde
   - Verifiera att INPUT-fält är **maskade** i replay (PNR/email/tel ska visas som `***`)

## CSP-tillägg

Spicks CSP är satt i Cloudflare (Transform Rules → HTTP Response Headers). Lägg till följande domäner i befintliga direktiv:

### `script-src`
Lägg till:
```
https://eu-assets.i.posthog.com
```

### `connect-src`
Lägg till:
```
https://eu.i.posthog.com https://eu-assets.i.posthog.com
```

### `worker-src` (om explicit satt)
PostHog session replay använder en Web Worker för komprimering. Om `worker-src` är explicit satt i CSP, lägg till:
```
'self' blob:
```
(`blob:` är ofta redan tillåtet via `script-src` fallback — verifiera först.)

### `img-src` (valfritt — för Toolbar/UI-bilder)
Om PostHog Toolbar (in-app debug-bar) ska användas av admin:
```
https://eu-assets.i.posthog.com
```

## Komplett exempel (efter tillägg)

Om Spicks nuvarande CSP ser ut såhär (förenklat):
```
script-src 'self' https://js.stripe.com https://browser.sentry-cdn.com;
connect-src 'self' https://*.supabase.co https://api.stripe.com;
```

Den nya versionen ska bli:
```
script-src 'self' https://js.stripe.com https://browser.sentry-cdn.com https://eu-assets.i.posthog.com;
connect-src 'self' https://*.supabase.co https://api.stripe.com https://eu.i.posthog.com https://eu-assets.i.posthog.com;
```

## PII-masking-strategi

`js/posthog-loader.js` är konfigurerad enligt:

| Datatyp | Behandling | Konfig |
|---------|-----------|--------|
| Input-fält (alla `<input>`) | **MASKAS** i replay | `maskAllInputs: true` |
| Lösenord (`type=password`) | **BLOCKERAS** helt | `blockSelector` |
| Kortnummer (`autocomplete=cc-number`) | **BLOCKERAS** helt | `blockSelector` |
| PNR (`name*="pnr"`, `name*="personnummer"`) | **BLOCKERAS** helt | `blockSelector` |
| Email (`type=email`) | **MASKAS** | `maskInputOptions.email: true` |
| Telefon (`type=tel`) | **MASKAS** | `maskInputOptions.tel: true` |
| Sifferfält (`type=number`) | **MASKAS** | `maskInputOptions.number: true` |
| Renderad text (DOM) | Synlig (för debug) | `mask_all_text: false` |
| Element med `data-ph-block` | **BLOCKERAS** helt | opt-in masking-attribut |
| Element med `data-ph-mask` | **MASKAS** | opt-in masking-attribut |

### Per-page disable
Autocapture är **avstängd** på följande pages (för att undvika logga sensitive admin/cleaner-data):
- `/admin*` (alla admin-sidor)
- `admin.html`, `admin-*.html`
- `stadare-dashboard.html`
- `foretag-dashboard.html`
- `mitt-konto.html`

Replay (utan input-data tack vare masking) är fortfarande PÅ — men event-volym för klick/scroll skippas på dessa sidor.

### Lägg till manuell masking på nya känsliga element
Vid behov, markera element med:
```html
<div data-ph-mask>Detta DOM-content kommer maskeras i replay</div>
<div data-ph-block>Detta element kommer blockeras helt (ersätts med svart ruta)</div>
```

## Cookie-policy / GDPR-checklista

- [x] EU Cloud (data i Frankfurt) → ingen EU→US-transfer
- [x] `respect_dnt: true` → honor browser Do-Not-Track
- [x] `cross_subdomain_cookie: false` → cookien stannar på `spick.se`
- [x] `person_profiles: 'identified_only'` → ingen profile innan explicit identify (sparar event-volym + PII)
- [ ] **TODO Farhad:** Uppdatera `integritetspolicy.html` med PostHog-mention (analytics + replay)
- [ ] **TODO Farhad:** Lägga till PostHog i cookie-banner om consent-flöde införs

## Free tier

PostHog free-tier (per 2026-04-26):
- 1M events/månad
- 5k session recordings/månad
- 1M feature flag requests/månad
- Unlimited team members

Spicks nuvarande volym (~några hundra bokningar/mån) → vi kommer inte nära taket på lång tid.

## Rollback

Om PostHog ska disablas snabbt:
1. Sätt `POSTHOG_KEY: ''` i `js/config.js` → loadern blir no-op.
2. Push → deploy. Tar ~30 sek på GitHub Pages.
3. Inga script-tag-ändringar i HTML behövs (loadern är defensiv).
