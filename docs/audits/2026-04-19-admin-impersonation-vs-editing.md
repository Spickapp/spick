# Admin-kapacitet audit — 2026-04-19

**Syfte:** Verifiera vad admin kan göra i admin.html vs vad VD/cleaner kan göra i stadare-dashboard.html. Flagga fragmentering (Regel #28), saknade funktioner, RLS-problem, audit-trail-status.
**Metod:** Regel #26 + #27 — alla påståenden citerar fil:rad + verifierat mot primärkälla (SQL-migrationer, ej memory).

---

## 🚨 TL;DR — Kritiska fynd

1. **🔴 INGEN impersonate-funktion finns.** Grep efter `impersonate|masquerade|assume_role|login_as|switch_user|become_user|actAs` → **0 träffar** i hela kodbasen (exkl. `.claude/worktrees/`). Admin kan inte "logga in som VD" för felsökning.

2. **🔴 Audit-trail är trasigt.** [20260402000001_fix_rls_security.sql:154-156](supabase/migrations/20260402000001_fix_rls_security.sql:154) låser `admin_audit_log` till **service_role only**. Admin.html använder authenticated JWT ([admin.html:1237](admin.html:1237)) → alla `auditLog()`-anrop misslyckas. [admin.html:4466](admin.html:4466) sväljer felet tyst (`try/catch` + `console.warn`). **33+ audit-anrop i admin.html = 33+ tysta misslyckanden.**

3. **🔴 Admin schedule-editor skriver till FEL TABELL.** [admin.html:3968-3969](admin.html:3968) läser + skriver `cleaner_availability` (gammal tabell). Wizard + boka.html + stadare-dashboard använder `cleaner_availability_v2`. Admin-editeringen har **ingen effekt på bokningar**. **Regel #28-brott.**

4. **🟡 cleaners UPDATE-RLS kan blockera admin.** [20260402100001_slug_languages.sql:70-73](supabase/migrations/20260402100001_slug_languages.sql:70) — "Cleaners can update own profile columns" `USING (auth.uid() = id)`. Admin har en annan `auth.uid()` än cleaner.id → RLS ger 204 Success men 0 rader ändrade. AR.update ([admin.html:1244-1250](admin.html:1244)) kollar bara `r.ok` → falsk "✅ Sparat!"-toast. **Ej bekräftat — kräver prod-test.**

5. **🟢 Admin KAN:** cleaner-profil (namn/telefon/stad/adress/radius/priser/provision/F-skatt/services/språk), cleaner_service_prices, pausa/aktivera cleaner, ändra bokningar, hantera companies indirekt via wizard.

6. **🔴 Admin KAN INTE:** `company_service_prices`, `cleaner_availability_v2`, direkt `companies`-redigering, trigga Stripe Connect-onboarding, generera inlogg-länk/magic-link för VD.

---

## Uppgift 1 — Impersonate-funktion

**Resultat: FINNS INTE.**

Grep-kommando:
```
rg -i "impersonate|masquerade|assume_role|login_as|switch_user|become_user|actAs|act_as" --glob='!.claude/**'
```
**Träffar: 0.**

Relaterat som FINNS:
- [admin.html:3302 `openCleanerDashboard(id)`](admin.html:3302) — öppnar cleanerns dashboard men använder admin's egen token (ej impersonation). Hur det faktiskt beter sig oklart, kräver test.

---

## Uppgift 2 — Admin-editing i admin.html

### Cleaner-profil (full)
[admin.html:3917-3965 `saveCleanerFromAdmin()`](admin.html:3917)

Redigerbara fält ([admin.html:3921-3954](admin.html:3921)):
| Fält | Var hämtas |
|------|-----------|
| full_name | `admin-edit-name` |
| phone | `admin-edit-phone` |
| city | `admin-edit-city` |
| hourly_rate | `admin-edit-rate` |
| services | `admin-edit-services` (split by komma) |
| bio | `admin-edit-bio` |
| admin_notes | `admin-note` |
| home_address | `admin-edit-home-address` |
| service_radius_km | `admin-edit-radius` |
| has_fskatt + fskatt_needs_help | `cd-fskatt` |
| commission_rate | `cd-commission` |
| identity_verified | `cd-identity-verified` |
| pet_pref | `cd-pet-pref` |
| elevator_pref | `cd-elevator-pref` |
| languages | `cd-languages` |
| owner_only | `cd-owner-only` |
| experience | `cd-experience` |

**⚠️ Saknas:** `home_lat`, `home_lng`, `stripe_account_id`, `status`, `auth_user_id`. Geokodning uppdateras ALDRIG när adress ändras (se [audit 2026-04-19-google-places-audit.md](docs/audits/2026-04-19-google-places-audit.md)).

### Cleaner-pricing (per tjänst)
[admin.html:3273-3300 `saveAdminPrices(cleanerId)`](admin.html:3273) → upsert `cleaner_service_prices` ([admin.html:3285](admin.html:3285)).

**Fungerar idag:** Ja, förutsatt RLS tillåter (ej verifierat).

### Cleaner availability ⚠️ BROKEN
[admin.html:3968-3969 `adminEditSchedule` / `adminSaveSchedule`](admin.html:3968)
- Läser `cleaner_availability` (gammal, singular)
- Skriver `cleaner_availability` (gammal, singular)

Wizard + boka.html + stadare-dashboard använder `cleaner_availability_v2`:
- [admin-create-company/index.ts:142](supabase/functions/admin-create-company/index.ts:142) — `cleaner_availability_v2` INSERT
- [boka.html:1402](boka.html:1402) — `cleaner_availability_v2` SELECT
- [stadare-dashboard.html:7054, 4354, 4361](stadare-dashboard.html:7054)

**Effekt:** Admin-editering av schema har 0 påverkan på bokningsflödet.

### Status-ändringar
| Funktion | fil:rad | Uppdatering |
|----------|---------|-------------|
| Pausa cleaner | [admin.html:3864](admin.html:3864) | `status: 'pausad'` |
| Aktivera | [admin.html:3873](admin.html:3873) | `status: 'aktiv', is_approved: true` |
| Återaktivera | [admin.html:3888](admin.html:3888) | samma |
| Stäng av | [admin.html:3842](admin.html:3842) | `is_approved: false, status: 'avstängd'` |
| Auto-pausa (låg rating) | [admin.html:3907](admin.html:3907) | `status: 'pausad'` |
| Bulk godkänn/pausa/stäng | [admin.html:4326, 4347, 4369](admin.html:4326) | – |
| Admin flag (visa/dölj) | [admin.html:3805](admin.html:3805) | `admin_flag` |
| Avatar-upload | [admin.html:4045](admin.html:4045) | `avatar_url` |

### company_service_prices ❌ EJ I ADMIN
Grep efter `company_service_prices` i admin.html → **0 UPDATE/UPSERT**, bara läsning av `companies`-rader ([admin.html:5691](admin.html:5691)) i wizard-samband.
**Admin kan inte ändra företagspriser.** Endast VD kan via stadare-dashboard.

### companies-tabell ❌ EJ I ADMIN
Grep efter `.update('companies'` eller `.from('companies').update` → **0 träffar** i admin.html. Wizard skapar (via EF) men admin har ingen UI för ändring av `name`, `commission_rate`, `employment_model` etc.

### Stripe Connect-trigger ❌ EJ I ADMIN
Bara status-visning ([admin.html:3538, 3628, 4492](admin.html:3538)). Knapp "Skicka Stripe-länk" ([admin.html:1993](admin.html:1993)) gör bara `showPage('onboarding')`.

---

## Uppgift 3 — Self-service i stadare-dashboard.html

### VD/cleaner egen profil
[stadare-dashboard.html:5571-5597 `saveProfile()`](stadare-dashboard.html:5571)

Redigerbara fält ([stadare-dashboard.html:5597](stadare-dashboard.html:5597)):
- `full_name`, `phone`, `city`, `hourly_rate`, `bio`, `slug`, `services`, `business_name`, `org_number`, `business_address`, `vat_registered`

**Saknas:** `home_address` + geokodning, `home_lat`, `home_lng`, `service_radius_km`.
→ Finns separat handler [stadare-dashboard.html:2745](stadare-dashboard.html:2745): `update cleaners SET home_address, service_radius_km`.

### Team-medlem-hantering (VD)
| Funktion | fil:rad |
|----------|---------|
| Lägg till team-medlem | [stadare-dashboard.html:6385-6386](stadare-dashboard.html:6385) med home_lat/home_lng |
| Uppdatera team-medlem | [stadare-dashboard.html:8561](stadare-dashboard.html:8561) |
| Byta status (aktiv/pausad) team | [stadare-dashboard.html:8628](stadare-dashboard.html:8628) |
| Upload avatar team | [stadare-dashboard.html:8470](stadare-dashboard.html:8470) |
| Team-medlemsbehörighet (dashboard_permissions) | [stadare-dashboard.html:9567, 9579](stadare-dashboard.html:9567) |
| Auth-user-länkning | [stadare-dashboard.html:2822](stadare-dashboard.html:2822) |

### Pricing (VD)
| Vad | fil:rad | Tabell |
|-----|---------|--------|
| Egna per-tjänst-priser | [stadare-dashboard.html:5984](stadare-dashboard.html:5984) | `cleaner_service_prices` |
| Radera egen pris | [stadare-dashboard.html:5979](stadare-dashboard.html:5979) | – |
| Team-medlems pris | [stadare-dashboard.html:8597](stadare-dashboard.html:8597) | `cleaner_service_prices` |
| Radera team-pris | [stadare-dashboard.html:8585](stadare-dashboard.html:8585) | – |
| Företagspris | [stadare-dashboard.html:8976](stadare-dashboard.html:8976) | `company_service_prices` |
| Radera företagspris | [stadare-dashboard.html:8969](stadare-dashboard.html:8969) | – |

### Availability (VD/cleaner)
Läser `cleaner_availability_v2` ([stadare-dashboard.html:4354, 4361, 7054](stadare-dashboard.html:4354)).
**Skriv-path:** kräver mer läsning men baserat på att wizard skapar v2 och VD redigerar från dashboard är trolig väg `cleaner_availability_v2`.

### Stripe Connect (VD)
[stadare-dashboard.html:5749, 5776](stadare-dashboard.html:5749) — POST till `stripe-connect` EF, action=onboard_cleaner. **Fungerar idag.**

---

## Uppgift 4 — Jämförelse-matris

**Legend:** ✅ finns & fungerar · ⚠️ finns men trasig/begränsad · ❌ saknas · 🔄 fragmentering mellan filerna

| Funktion | admin.html (admin) | stadare-dashboard.html (VD) | Fragmentering? |
|----------|-------------------|---------------------------|----------------|
| Ändra namn/tel/stad/bio | ✅ [3922-3927](admin.html:3922) | ✅ [5597](stadare-dashboard.html:5597) | 🔄 två code-paths, olika fält-set |
| Ändra hemadress + geokodning | ⚠️ [3929](admin.html:3929) — adress utan autocomplete → home_lat/lng stale | ⚠️ [2745](stadare-dashboard.html:2745) — har autocomplete men separat handler | 🔄 |
| Ändra hourly_rate | ✅ [3925](admin.html:3925) | ✅ [5597](stadare-dashboard.html:5597) | 🔄 |
| Ändra services | ✅ [3926](admin.html:3926) | ✅ [5597](stadare-dashboard.html:5597) | 🔄 |
| Ändra service_radius_km | ✅ [3930](admin.html:3930) | ✅ [2745](stadare-dashboard.html:2745) | 🔄 |
| Ändra languages | ✅ [3952](admin.html:3952) | ❌ | — |
| Ändra pet_pref/elevator_pref | ✅ [3947-3948](admin.html:3947) | ❌ | — |
| Ändra commission_rate | ✅ [3941](admin.html:3941) | ❌ | — |
| Ändra has_fskatt | ✅ [3935-3937](admin.html:3935) | ❌ | — |
| Ändra owner_only | ✅ [3953](admin.html:3953) | ❌ | — |
| cleaner_service_prices | ✅ [3285](admin.html:3285) | ✅ [5984](stadare-dashboard.html:5984) | 🔄 |
| company_service_prices | ❌ | ✅ [8976](stadare-dashboard.html:8976) | — |
| cleaner_availability_v2 | ❌ (skriver v1 ≠ v2) | ✅ [7054](stadare-dashboard.html:7054) + skriv | ⚠️🔄 |
| Pausa/aktivera cleaner | ✅ [3864, 3873](admin.html:3864) | ✅ [8628](stadare-dashboard.html:8628) (team-medlem) | 🔄 |
| Stäng av cleaner (suspend) | ✅ [3842](admin.html:3842) | ❌ | — |
| Avatar-upload | ✅ [4045](admin.html:4045) | ✅ [8470](stadare-dashboard.html:8470) | 🔄 |
| Identity verified | ✅ [3944](admin.html:3944) | ❌ | — |
| Lägg till team-medlem | ✅ via wizard [5499](admin.html:5499) | ✅ [6385](stadare-dashboard.html:6385) | 🔄 två vägar |
| Stripe Connect init | ❌ bara status | ✅ [5749](stadare-dashboard.html:5749) | — |
| Impersonate | ❌ | n/a | — |
| Edit companies-rad | ❌ | ⚠️ bara via wizard-skapande, inte re-edit | — |

### Fragmenterings-sammanfattning (Regel #28)

**14 fragmenterade funktioner** mellan admin.html och stadare-dashboard.html — samma logik dubblerad, ofta med olika fält och olika buggar (adress utan geokodning i admin, saknad language-edit i dashboard).

**1 kritisk divergens:** `cleaner_availability` (admin v1) vs `cleaner_availability_v2` (alla andra). Admin-schema-editor är död kod.

---

## Uppgift 5 — Säkerhetsanalys (RLS + audit)

### Auth-modell i admin.html
[admin.html:1226-1238 `_adminHeaders()`](admin.html:1226):
- `apikey` = `SPICK.SUPA_KEY` (anon key)
- `Authorization: Bearer` = admin-användarens JWT (ej service_role)

→ Admin går mot PostgREST som **authenticated role**, inte service_role.

### RLS på cleaners-tabellen

| Policy | Migration | USING | Påverkar admin? |
|--------|-----------|-------|-----------------|
| "Service role full access cleaners" | [007_rls.sql:19-21](supabase/migrations/007_rls.sql:19) | `auth.role() = 'service_role'` | Nej (admin ej service_role) |
| "Cleaners can update own profile columns" | [20260402100001:70-73](supabase/migrations/20260402100001_slug_languages.sql:70) | `auth.uid() = id` | ⚠️ admin.auth.uid ≠ cleaner.id → deny |
| "Company owner can read team members" | [companies-and-teams.sql:55-61](sql/companies-and-teams.sql:55) | via company_id | Nej (admin är ej company_owner) |
| "Anyone can read cleaner slug" | [20260402100001:63-66](supabase/migrations/20260402100001_slug_languages.sql:63) | `true` | Ja, bara SELECT |
| "Anon read active cleaners" | [20260401000001:9-10](supabase/migrations/20260401000001_create_missing_views.sql:9) | – | Ja, bara SELECT |

**Problem:** Det finns **ingen explicit UPDATE-policy för admin-rollen** på cleaners-tabellen i SQL-filerna. Om det funkar idag är det antingen:
1. En odokumenterad policy skapad direkt i Supabase Dashboard (kör SQL `SELECT policyname FROM pg_policies WHERE tablename='cleaners'` för att bekräfta)
2. AR.update returnerar 200/204 men RLS filtrerar bort rader → 0 rader ändrade → **silent failure**

### RLS på cleaner_availability_v2

**Grep efter "cleaner_availability_v2.*POLICY" → 0 träffar i SQL-filer.** Troligen saknar v2 uttrycklig RLS (eller är permissiv default). **Behöver verifieras i prod.**

### RLS på company_service_prices

Ingen träff i grep över SQL-filer för `company_service_prices.*POLICY`. Troligen saknas RLS eller är service_role-default.

### RLS på cleaner_service_prices

[add-team-pricing-rls.sql:5-24](supabase/add-team-pricing-rls.sql:5) — `company_owner_manage_team_prices` — VD får hantera team. **Ingen admin-policy finns för denna tabell.**

### Audit-trail (admin_audit_log)

**Status: TRASIGT.**

Tidslinje:
1. [20260331000001:249-252](supabase/migrations/20260331000001_admin_portal.sql:249) skapade INSERT/SELECT för authenticated.
2. [20260402000001:152-156](supabase/migrations/20260402000001_fix_rls_security.sql:152) **DROPPADE** dessa och ersatte med service_role only.
3. Ingen senare migration öppnar upp igen.

**Konsekvens:**
- Admin logins (authenticated) → `auditLog()` calls ([admin.html:4456-4467](admin.html:4456)) → PostgREST returnerar 201/204 kanske, men RLS blockar → data aldrig sparad.
- auditLog:s try/catch fångar ingenting eftersom AR.insert returnerar `{error}` istället för att throwa. Felet loggas ALDRIG.
- **Alla 33+ audit-punkter i admin.html är tyst trasiga.**

**Verifierbar via:**
```sql
SELECT COUNT(*) FROM admin_audit_log WHERE created_at > '2026-04-02';
-- Förväntat: 0 rader från admin-panel efter 2026-04-02
```

---

## 🔧 Åtgärder (prio)

| # | Åtgärd | Effort | Blocker |
|---|--------|--------|---------|
| 1 | **Kolla prod-RLS:** kör `SELECT * FROM pg_policies WHERE tablename IN ('cleaners','cleaner_availability_v2','company_service_prices','cleaner_service_prices','admin_audit_log')`. Bekräfta vad som faktiskt finns. | 5 min | Svarar på allt nedan |
| 2 | Återställ `admin_audit_log` INSERT för authenticated (eller skapa `admin-audit` EF med service_role) | 15 min | Ingen audit-trail idag |
| 3 | Fixa `adminSaveSchedule` → skriv till `cleaner_availability_v2` | 30 min | Admin-schema gör inget |
| 4 | Lägg till "Simulera VD"-funktion (impersonate via EF som ger admin temp-token) | 3-4h | Felsökning för demon imorgon |
| 5 | Lägg till admin-UI för `company_service_prices` + `companies`-redigering | 1-2h | Admin blind för dessa |
| 6 | Lägg till admin-trigger för Stripe Connect-onboarding | 2h | Demon-blockerare (redan flaggad) |
| 7 | Lägg till `home_lat/home_lng` geokod-update i saveCleanerFromAdmin | 1h | Rafas team har NULL-koord (redan flaggad) |

---

## Referenser

- [docs/audits/2026-04-19-google-places-audit.md](docs/audits/2026-04-19-google-places-audit.md) — geokod-bugg vid adress-redigering
- [docs/audits/2026-04-19-boka-cleaner-filter-bugg.md](docs/audits/2026-04-19-boka-cleaner-filter-bugg.md) — filter-bugg i bokningsflöde
- [docs/prep/2026-04-19-solid-service-demo-funktioner.md](docs/prep/2026-04-19-solid-service-demo-funktioner.md) — demo-checklista
- Regel #26, #27, #28 — [docs/regler/](docs/regler/)
