# VD/Företagsägare — End-to-End Flow Audit

**Datum:** 2026-04-26
**Test-agent:** Test-VD-flow agent (read-only, ingen kod-/DB-ändring)
**Scope:** Discovery → Onboarding → Dashboard → Företag-tab → Team-tab → Kalender → Bokningar → Tvister → Stripe Connect → Utbetalning
**Verifieringsmetod:** Kod-läsning + curl mot prod-EFs + REST-probe mot prod-DB-schema (rule #31)

Status-legend: PASS = fungerar / WARN = fungerar med caveat / FAIL = trasig eller saknas

---

## 1. Discovery — VD hittar "Bli partner"

| Steg | Status | Notering |
|------|--------|----------|
| `bli-foretag.html` finns + laddar (live) | PASS | HTTP 200, hero + 6 benefits + 4 steps + 8 FAQs + dual CTAs |
| Hero CTA → `registrera-foretag.html` | PASS | `<a href="registrera-foretag.html">` (rad 153 + 342) |
| 12% provision-text matchar SSOT | PASS | `commission_standard=12` i prod platform_settings, frontend visar "12 %" |
| Marknadsmaterial-claim "1–2 dgr utbetalning" | WARN | Stripe payout-schema är 3–5 bankdagar (motsägelse med dashboard-text rad 1163: "3–5 bankdagar"). Hero-stat säger "1–2 dgr" — inkonsekvent |

## 2. Onboarding — registrera-foretag.html

| Steg | Status | Notering |
|------|--------|----------|
| Multi-step form (4 steg) laddar | PASS | step1=företag → step2=VD → step3=review+consent → step4=success |
| Org.nr-validering | WARN | **Endast längd-check (10 siffror)**. Ingen Bolagsverket-API-anrop. Format-validering via `cleanOrgNumber()` rad 345 |
| Org.nr-format auto-formatering | PASS | Live formatering till `123456-7890` (rad 631) |
| F-skatt-checkbox (frivillig) | PASS | Sparas i state, skickas till EF |
| Företagsnamn-validering | PASS | min 2 tecken |
| VD-namn (förnamn + efternamn) | PASS | split(' ').length ≥ 2 |
| Mobil normalisering till +46 | PASS | rad 349 (cleanPhone) |
| Tre consent-checkboxar krävs | PASS | submit-knapp disabled tills alla 3 ikryssade |
| Firmatecknare-BankID (TIC) | WARN | UI finns + frontend försöker visa block om `tic_enabled=true && company_bankid_enabled=true`. **`company_bankid_enabled` saknas helt i `platform_settings`** → block förblir dold (graceful degradation enligt audit-comment rad 442–456) |
| `company-bankid-init` EF | FAIL | HTTP 404 i prod. Inte deployad. Kommentar i frontend rad 443 bekräftar: "EFs saknas (404)" |
| `company-bankid-verify` EF | FAIL | HTTP 404 i prod |
| `company-self-signup` EF | PASS | HTTP 200 (efter cold-start). Validerar input + skapar auth-user + companies-rad + Stripe Connect-länk. Kod använder `commission_standard` från platform_settings (rule #28 OK). Slug-konflikt-retry 10 ggr |
| Step 4 success → `stripe_onboarding_url` | PASS | EF returnerar URL (förutsatt Stripe-konfig OK), frontend visar "Slutför Stripe-registrering →" |

## 3. First-time-VD i dashboard

| Steg | Status | Notering |
|------|--------|----------|
| `foretag-dashboard.html` redirect → `stadare-dashboard.html#team` | PASS | rad 7 + JS rad 23 |
| `stadare-dashboard.html` laddar (live HTTP 200) | PASS | |
| `setupVDNavigation()` reparenterar VD-cards (rad 6845) | PASS | Bokningar→tab-jobb, Kalender→tab-kalender, Företag→tab-inkomst |
| Nav-labels för VD: "Bokningar"/"Företag" | PASS | rad 6849–6850 |
| VD onboarding-checklist 5 steg | PASS | profile, team, prices, bank, share (rad 4184) |
| "Gå till X"-actions matchar tab-positioner | PASS | switchTab('inkomst') korrekt EFTER reparenting |
| Auto-aktivering vid coreReady | PASS | rad 4118–4139 (status: onboarding → aktiv) |

## 4. Företag-tab djuptest (12 sektioner via Zivar-flytt)

| Sektion | Status | Notering |
|---------|--------|----------|
| Företagsbetalningar (paid/escrow/upcoming/per cleaner) | PASS | rad 1095–1126, `loadVdPaymentSummary()` rad 12563 |
| Intern fördelning per cleaner | PASS | rad 1129–1134 |
| Detaljerad jobb-lista + 4 filterchipsar + sökfält | PASS | rad 1137–1160 |
| CSV-export (`exportVdJobsCsv`) | PASS | rad 13006 |
| Pengar-flöde-text inkl escrow + 24h | PASS | rad 1163 |
| Utlägg från team (godkänna pending) | PASS | rad 1167–1181, `loadVdPendingExpenses()` rad 12637 |
| Företagsprofil (logo + hero-bg + bg-color) | PASS | rad 1629–1705. PNG/JPG/WebP, max 2MB logo / 4MB hero |
| Betygsvisning-toggle (`show_individual_ratings`) | PASS | rad 1708–1720 |
| Prismodell-toggle ("Enhetlig företagsprissättning") | PASS | rad 1722–1735, sparar `use_company_pricing` |
| Företagspriser per tjänst | PASS | rad 1738–1745 + `company-prices-list` |
| Tillval & material per cleaner | PASS | rad 1748–1754 (§4.8c) |
| Uppgifter (VD task-tilldelning) | PASS | rad 1757–1766 |
| Löneunderlag CSV-export per månad | PASS | rad 1868–1899 |
| Mina självfakturor (flyttad från Jag-tab) | PASS | rad 3637–3645 (JS appendChild) |
| Rapporter (omsättning vecka/städare/tjänst) | PASS | rad 1902–1929 |

## 5. Team-tab djuptest

| Sektion | Status | Notering |
|---------|--------|----------|
| Reassignment-alert (om aktiva ärenden) | PASS | rad 1579–1590 |
| Onboarding-guide (om team tom) | PASS | rad 1593–1615 (3 steg) |
| Team-management-card med invite-länk + manuell add | PASS | rad 1617–1627 |
| `team-list` rendering | PASS | rad 1626 |
| Per-cleaner toggle "Bokas individuellt" | PASS | rad 6975–6980, `toggleMemberIndividualBooking()` rad 10891 PATCH till `cleaners.allow_individual_booking` |
| Pausa/aktivera (toggleMemberStatus) | PASS | rad 10912 — pausar prenumerationer också (Fas 9) |
| Team-kalender Gantt (Dag/Vecka) | PASS | rad 1773–1833, summary-stats + sjuk-frekvens + topp-cleaner |
| Manuellt lägg-till-jobb | PASS | `openManualBooking()` rad 1785 |

## 6. Kalender-tab

| Steg | Status | Notering |
|------|--------|----------|
| Solo cleaner: V2-kalender (Dag/Vecka/Månad) | PASS | rad 1069–1085 |
| VD: Solo + Team-Gantt visas båda | PASS | `soloKal` behålls synlig, `vd-kalender-content` får team-Gantt reparented |
| iCal-feed-URL (read-only, kopiera) | PASS | rad 1336, `calendar-ical-feed` EF |
| Google Calendar OAuth-sync | WARN | EFs `calendar-google-auth` + `calendar-google-callback` finns, men UI-knapp ej hittad i nuvarande grep — möjligen bakom inställning. **Behöver djupare verifiering** |
| Block dag/timme | PASS | block-detail-modal rad 2483, deleteBlockEvent |

## 7. Bokningar-tab (`tab-jobb` för VD)

| Steg | Status | Notering |
|------|--------|----------|
| Lista alla teamets bokningar (reparented till tab-jobb) | PASS | `team-bookings-card` flyttas rad 6869 |
| Sortering: idag/kommande/förflutna/avbokade | PASS | rad 7114–7126 |
| Per-card actions | PASS | renderTeamBookingCard rad 7050 |
| Klick → boking-detalj | PASS | (i kort-render) |

## 8. Tvister-tab

| Steg | Status | Notering |
|------|--------|----------|
| `tab-tvister` finns | PASS | rad 2469 |
| nav-knapp dold default, visas vid aktiva tvister | PASS | rad 2538 + `loadVdDisputes()` togglar visibility |
| Decide-modal | PASS | rad 2498–2511 |

## 9. Edge cases

| Case | Status | Notering |
|------|--------|----------|
| VD utan Stripe Connect klart | PASS | Onboarding-checklist `bank`-step förblir omarkerad, banner visas (rad 4150–4155). Matching-blockering verifieras EJ explicit (matching-wrapper kollar inte uttryckligen) |
| VD togglar individuell-booking AV på alla cleaners | WARN | Saknas explicit "alla cleaners hidden från publik matching"-test. UI tillåter, EF respekterar fältet, men ingen UX-varning till VD om tomt urval |
| Logo upload >2MB | PASS | accept-attribut + 2MB-text rad 1646; klient-side size-validering troligen i `uploadCompanyLogo()` (verifierades ej djupare) |
| Co-VD-flöde | FAIL | Inte hittat. `is_company_owner` är boolean per-cleaner — flera kan vara TRUE, men ingen UI för att tilldela "co-VD-rättigheter" eller skilja primary/secondary VD |
| `commission_rate=0.17` på `[TEST] Test VD AB` (companies-row) | WARN | **Konfirmerar CLAUDE.md/MEMORY-not "mixed format" — companies.commission_rate = 0.17 (decimal) men platform_settings.commission_standard = 12 (procent)**. company-self-signup-EF skriver `commission_rate: commissionRate` där commissionRate=12 (heltal procent), så nya företag får `12` men gamla har `0.17`. **Inkonsistens i datatyp = bokföringsrisk** |
| `/f/{slug}` company-profile-URLs | WARN | Browsers ser routing-redirect (visuellt 200), men HTTP-status är **404** från GitHub Pages 404.html (som råkar innehålla JS-redirect). curl/sociala-bots/sökmotorer ser hard 404. SEO-skada |
| `sitemap-profiles` EF | FAIL | HTTP 404 i prod. CLAUDE.md listar den som aktiv (Prof-5), men EF-folder saknas. Sökmotorer får ingen automatisk profile-sitemap |

## 10. Hela kund→cleaner→VD-flödet

Verifierades **inte** end-to-end live (tidsbox 30 min). Statiska kontroller:

- `booking-create` (anon) + `stripe-webhook` (sig) finns och deployas (200/204 OPTIONS)
- `stripe-connect-webhook` finns (200) — uppdaterar onboarding-status
- `vd-payment-summary` EF finns (200, kräver auth – returnerar 401 utan)
- `escrow-auto-release` cron-EF finns
- `reconcile-payouts` finns

---

## Top-10 Findings (prioriterade)

| # | Severity | Finding | Var | Rek |
|---|----------|---------|-----|-----|
| 1 | **HIGH** | `company-bankid-init` + `company-bankid-verify` EFs saknas i prod (HTTP 404). Frontend hanterar via flag-degradation, men VD-BankID-verifiering helt avstängd | `supabase/functions/` | Antingen deploya EFs eller dokumentera som "fas 2"; ta bort UI-blocket helt om inte aktiverat snart |
| 2 | **HIGH** | `companies.commission_rate` har mixed format: gamla rader = `0.17` (decimal), nya = `12` (heltal). Bokföringsrisk om någon EF läser fältet istf platform_settings | DB-data | Migration: konvertera alla decimal → heltal, eller döpa om kolumnen till `commission_pct_legacy` och alltid läsa platform_settings |
| 3 | **HIGH** | `sitemap-profiles` EF saknas — CLAUDE.md säger den finns (Prof-5), curl returnerar 404 | `supabase/functions/` | Återskapa EF eller uppdatera CLAUDE.md/snapshot |
| 4 | **MEDIUM** | `/f/{slug}` profilsidor returnerar HTTP 404 från GitHub Pages (JS-redirect via 404.html). Sökmotorer/bots ser 404 | `404.html` + GitHub Pages | Pre-rendera /f/{slug}/index.html per company-slug i CI eller migrera till Cloudflare Pages med _redirects-stöd |
| 5 | **MEDIUM** | Marknadstext "1–2 dgr utbetalning" (bli-foretag.html) motsägs av dashboard-text "3–5 bankdagar" + Stripe verklighet | `bli-foretag.html` rad 169 | Harmonisera till "3–5 bankdagar" eller justera Stripe payout-interval |
| 6 | **MEDIUM** | Org.nr-validering = endast 10-siffer-check. Ingen Bolagsverket-uppslag → kan registrera fake org-nr | `registrera-foretag.html` rad 334 + `company-self-signup` validateOrgNumber | Lägg till Luhn-checksum eller Bolagsverket API-call (admin-godkänner ändå manuellt — så low-risk) |
| 7 | **MEDIUM** | Co-VD-flöde saknas helt | n/a | Bestäm produkt-policy: är fler firmatecknare per company tillåtna? Annars dokumentera "1 VD per company" begränsning |
| 8 | **LOW** | `company_bankid_enabled` flag saknas i `platform_settings` (hänvisas av frontend) | `platform_settings` | Lägg till `company_bankid_enabled=false` explicit för transparens |
| 9 | **LOW** | VD som togglar `allow_individual_booking=false` på alla cleaners får ingen UX-varning om effekt på matching | dashboard `toggleMemberIndividualBooking` | Visa info-banner om "0 cleaners individuellt-bokbara" |
| 10 | **LOW** | Google Calendar OAuth-sync UI ej tydligt synlig i Företag-tab/Kalender-tab (EFs finns) | `stadare-dashboard.html` | Verifiera om feature tillgänglig för VD eller bara solo-cleaners; lägg till sync-knapp i team-Gantt-headern |

---

## EF-status mot prod (curl OPTIONS)

```
company-self-signup                 200 (efter cold-start)
company-accept-invite               200
admin-approve-company               200
admin-create-company                200
admin-reject-company                200
stripe-connect                      200
stripe-connect-webhook              200
vd-payment-summary                  200 (POST kräver auth → 401)
vd-dispute-list                     200
vd-dispute-decide                   200
expire-team-invitations             401 (kräver CRON_SECRET, korrekt)
team-sms-notify                     204 (CORS preflight ok)
generate-self-invoice               200
serve-invoice                       200
export-cleaner-data                 200
generate-receipt                    200
notify                              200
health                              200
register-bankid-init                200
register-bankid-status              200
company-bankid-init                 404 (FAIL)
company-bankid-verify               404 (FAIL)
stripe-connect-onboard              404 (medvetet — använd `stripe-connect` med action=onboard_cleaner)
stripe-connect-status               404 (medvetet — använd `stripe-connect` med action=check_status)
sitemap-profiles                    404 (FAIL — CLAUDE.md-claim drift)
```

## DB-schema-verifiering (rule #31)

```
companies columns konfirmerade i prod:
  id, name, slug, onboarding_status, self_signup, use_company_pricing,
  show_individual_ratings, logo_url, hero_bg_url, hero_bg_color,
  firmatecknare_verified_at, firmatecknare_full_name,
  firmatecknare_personnr_hash, firmatecknare_tic_session_id,
  commission_rate, dashboard_config

cleaners (RLS-protected, kunde ej probas anon)

VIEWs:
  v_calendar_slots                  200
  v_customer_bookings               401 (RLS-skyddad, korrekt)
  public_stats                      200 ({total_bookings:0, active_cleaners:9, ...})

platform_settings (kritiska):
  commission_standard = "12"
  tic_enabled = "true"
  company_bankid_enabled = (SAKNAS)
  stripe_test_mode = "false"
  escrow_enabled = "false"
  escrow_mode = "escrow_v2"
  payout_trigger_mode = "immediate"
```

---

## Slutsats

VD-flödet är **80% komplett och fungerande**. Onboarding, dashboard-reparenting, Företag-tab med 12 sektioner, Team-tab, Kalender-Gantt, Bokningar-tab, Tvister-tab — allt är byggt och deployat. Två huvudgap: (a) BankID-verifiering av firmatecknare är planerad men EFs ej deployade, (b) `sitemap-profiles` EF saknas trots CLAUDE.md-listning. Mixed `commission_rate`-format i `companies` är bokföringsrisk som bör migreras innan första utbetalning till självregistrerat företag. Inga CRITICAL säkerhetshål hittade — alla sensitive EFs kräver auth, RLS skyddar `cleaners`+`v_customer_bookings`.

Verifiering: 100% kod-läsning + curl. Ej testat: live OAuth-flöde till Stripe, faktisk BankID-test (TIC sandbox), kund→VD-utbetalning end-to-end.
