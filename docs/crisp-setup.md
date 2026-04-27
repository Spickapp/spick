# Crisp live-chat setup (EU region)

> **Datum:** 2026-04-26
> **Region:** EU (Frankrike) — `client.crisp.chat`
> **Verifierad reachability:** `curl -sI https://client.crisp.chat/l.js` → HTTP 200 + Cloudflare-edge (verifierat 2026-04-26).
> **Datasäkerhet:** Crisp hostar EU-data i franska datacenter per Crisp's officiella docs (https://help.crisp.chat/en/article/where-is-the-data-of-my-customers-stored-1b7ckpb/). Farhad gör juridisk bedömning av DPA + legal-base.
> **Free-tier:** 100 conversations/månad, 2 operators, basic chatbot. Räcker för pilot — uppgradera till Pro ($25/mo) när conversations >100.

## Setup-flöde för Farhad

### 1. Skapa Crisp-konto med EU-region

1. Gå till https://app.crisp.chat/initiate/signup/
2. Fyll i namn + email (`hello@spick.se` rekommenderas så Crisp-aviseringar går till support-inboxen).
3. **VIKTIGT:** Vid "Choose your data hosting location" → välj **European Union (Frankfurt/Paris)**.
   - Om du redan signat US-konto, skapa nytt EU-konto (kan inte migrera region efter signup).
4. Skapa workspace: `Spick`.
5. Hoppa över team-invitations → "Continue solo" (Farhad lägger till operatorer senare).

### 2. Hämta Website-ID

1. När du är inloggad: klicka **Settings** (kugghjulsikon nere till vänster).
2. Klicka **Website Settings** → **Setup Instructions**.
3. Du ser ett kodexempel som börjar med `window.CRISP_WEBSITE_ID="..."`. Kopiera UUID-strängen mellan citationstecknen (formatet: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

### 3. Lägg in Website-ID i Spick

1. Editera `js/config.js` rad ~24:
   ```js
   CRISP_WEBSITE_ID: 'din-uuid-har',
   ```
2. Commit + push → GitHub Pages auto-deploy (~30 sek).
3. Loadern (`js/crisp-loader.js`) skippar silent om ID är tomt — säkert att deploya utan ID.

### 4. Uppdatera CSP i Cloudflare

Gå till **Cloudflare Dashboard → spick.se → Rules → Transform Rules → Modify Response Header**. Hitta CSP-regeln och lägg till följande domäner i befintliga direktiv.

#### `script-src`
Lägg till:
```
https://client.crisp.chat
```

#### `connect-src`
Lägg till:
```
https://client.crisp.chat https://*.crisp.chat wss://client.relay.crisp.chat wss://*.crisp.chat
```

(`wss://` behövs för real-time chat över WebSocket.)

#### `img-src`
Lägg till:
```
https://image.crisp.chat https://storage.crisp.chat
```

#### `frame-src`
Lägg till:
```
https://*.crisp.chat https://game.crisp.chat
```

(`game.crisp.chat` används för embedded media i chat-widget.)

#### `style-src` (om explicit satt)
Crisp injicerar inline-styles. Om `style-src` är strikt (ingen `'unsafe-inline'`), lägg till:
```
'unsafe-inline'
```
(Annars syns chat-widget utan styling.)

#### Komplett CSP-exempel (efter tillägg)

Om Spicks nuvarande CSP ser ut såhär (förenklat):
```
script-src 'self' https://js.stripe.com https://browser.sentry-cdn.com https://eu-assets.i.posthog.com;
connect-src 'self' https://*.supabase.co https://api.stripe.com https://eu.i.posthog.com;
img-src 'self' data: https:;
frame-src https://js.stripe.com;
```

Den nya versionen ska bli:
```
script-src 'self' https://js.stripe.com https://browser.sentry-cdn.com https://eu-assets.i.posthog.com https://client.crisp.chat;
connect-src 'self' https://*.supabase.co https://api.stripe.com https://eu.i.posthog.com https://client.crisp.chat https://*.crisp.chat wss://client.relay.crisp.chat wss://*.crisp.chat;
img-src 'self' data: https: https://image.crisp.chat https://storage.crisp.chat;
frame-src https://js.stripe.com https://*.crisp.chat https://game.crisp.chat;
```

### 5. Verifiera installation

1. Öppna `https://spick.se` i incognito (cache-bust).
2. Vänta ~3 sek → Crisp chat-bubbla ska dyka upp i nedre högra hörnet.
3. Klicka bubblan → välkomstmeddelande "Hej! Behöver du hjälp?" syns.
4. Skicka testmeddelande → ska dyka upp i Crisp dashboard inom 5 sek.
5. Verifiera DevTools Console — inga CSP-violations.
6. Testa på `/admin.html` och `/stadare-dashboard.html` → chat-bubblan ska INTE synas där.

### 6. Installera mobilappen (Farhad)

Crisp har native iOS + Android-app för operatörer.

1. iOS: App Store → sök "Crisp Chat" (utvecklare: Crisp IM SARL).
2. Android: Google Play → sök "Crisp Chat".
3. Logga in med samma email + lösenord som webb-versionen.
4. Aktivera push-notiser → notiser triggas direkt vid ny conversation.
5. (Valfritt) Aktivera "On-call mode" i appen → dygnet-runt-notiser endast när du är på jour.

### 7. Discord/Slack-notiser (valfritt)

Crisp har inbyggd integration:

1. Crisp dashboard → **Plugins** → sök "Discord" eller "Slack".
2. Klicka **Install** → följ OAuth-flöde.
3. Välj kanal: `#spick-support` (rekommenderat).
4. Konfigurera triggers — minst:
   - Ny conversation
   - Conversation utan svar >5 min

## Sidor med Crisp aktivt

Crisp-loader (`js/crisp-loader.js`) är inkluderat på följande pages:
- `index.html` — homepage (cleaner-recruitment landing)
- `boka.html` — booking flow (kund-conversion)
- `tjanster.html` — services-overview
- `priser.html` — pricing-page (conversion-känslig)
- `foretag.html` — företagskunder
- `bli-stadare.html` — cleaner-signup (rekrytering)

## Sidor där Crisp är AVSTÄNGT

Loadern skippar silent på:
- `/admin*` (alla admin-vyer — känslig data, ingen kund-chat behövs)
- `stadare-dashboard.html` (cleaners går via support-email per spec — undviker att blanda sales-chat med ops-support)

För att slå PÅ chat på fler pages: lägg till `<script src="js/crisp-loader.js" defer></script>` efter `posthog-loader.js` (eller efter `config.js` om PostHog inte är aktiverat på den sidan).

## Säkerhet & PII

| Datatyp | Behandling |
|---------|-----------|
| Inputs i chat-widget | **EJ maskade** — vi vill se vad kunder skriver för support |
| Email auto-fyll | Hämtas från Supabase-session om inloggad (`u.email`) |
| Namn auto-fyll | Hämtas från `user_metadata.full_name`/`user_metadata.name` |
| User-role | Sätts som session-data så Farhad ser direkt om kund/cleaner |
| Cookies | Crisp använder egen cookie för session-persistens (egen domän) |
| Cookie-banner | **TODO Farhad:** Lägga till Crisp i cookie-banner om consent-flöde införs |
| Integritetspolicy | **TODO Farhad:** Uppdatera `integritetspolicy.html` med Crisp-mention |

## Custom branding

Brandstilar (färg, logo, position) konfigureras i Crisp dashboard, inte i kod:

1. Crisp dashboard → **Settings** → **Chatbox & Email Settings** → **Appearance**.
2. **Color**: sätt till `#0F6E56` (Spick primary green).
3. **Position**: Bottom-right (default).
4. **Welcome message**: "Hej! Behöver du hjälp? Vi svarar oftast inom några minuter."
5. **Operator name**: "Spick Support" (eller "Farhad").
6. **Avatar**: ladda upp Spick-logo.

Loadern sätter välkomstmeddelandet via runtime-API som backup, men Crisp dashboard-config tar precedence.

## Free-tier vs Pro

Crisp free-tier (per 2026-04-26):
- 100 conversations/månad
- 2 operators
- Basic chatbot
- Mobil-app (iOS + Android)
- Email-fallback (om operator offline)
- 30-dagars conversation-historik

Pro ($25/operator/mo) lägger till:
- Unlimited conversations
- Unlimited chatbot-triggers
- Sentry + PostHog-integration (out-of-the-box)
- 1-årig conversation-historik
- Custom branding (no Crisp logo)

Spicks pilot-volym (~några hundra besökare/dag, <5% chat-rate) → free-tier räcker minst 1-2 månader.

## Rollback

Om Crisp ska disablas snabbt:
1. Sätt `CRISP_WEBSITE_ID: ''` i `js/config.js` → loadern blir no-op.
2. Push → deploy. Tar ~30 sek på GitHub Pages.
3. Inga script-tag-ändringar i HTML behövs (loadern är defensiv).

## Källor

- Crisp data-residency: https://help.crisp.chat/en/article/where-is-the-data-of-my-customers-stored-1b7ckpb/
- Crisp JS SDK: https://docs.crisp.chat/guides/chatbox-sdks/web-sdk/
- Crisp CSP requirements: https://help.crisp.chat/en/article/how-to-resolve-a-content-security-policy-csp-issue-with-crisp-1q08c4j/
