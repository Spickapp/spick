## Sammanfattning
<!-- 1-3 meningar om vad PR:en gör -->

## Reglerna #26-#32 — checklist
- [ ] **#26** Grep-före-edit: läst exakt text + surrounding kod för varje str_replace
- [ ] **#27** Scope-respekt: bara det som efterfrågades, inga sido-städningar
- [ ] **#28** SSOT: inga nya hardcodes (commission/hourly_rate/RUT_SERVICES/öppna RLS) — business-data centraliserad i `platform_settings` + `_shared/`
- [ ] **#29** Audit-först: läst hela primärkällan (audit/sanning/progress) innan agerade
- [ ] **#30** Ingen regulator-gissning: inga antaganden om Skatteverket/GDPR/BokfL/Stripe/EU PWD
- [ ] **#31** Primärkälla över memory: schema/RPC/EF curl-verifierat mot prod (information_schema), INTE bara migration-filen i repo

## Business-content-claims (om HTML-fil ändrad)
- [ ] Inga nya `\d+ dagars betalvillkor`-claims utan källa i `docs/sanning/`
- [ ] Inga nya `\d+ kr/h`-priser utanför `services-loader.js`
- [ ] Inga nya `\d+%`-provisioner (måste matcha `platform_settings.commission_standard=12`)
- [ ] Inga nya superlativ ("Sveriges största/bästa", "alltid svenska", "100% garanti") utan datasubstans
- [ ] Telefon-, e-post-, org.nr-claims matchar CLAUDE.md (Haghighi Consulting AB · 559402-4522 · hello@spick.se · 076-050 51 53)

## Tester
- [ ] `deno task lint:hardcoded` är grön
- [ ] Playwright e2e-tester körda lokalt om HTML/UX ändrats
- [ ] Curl-verifiering mot prod om EF/migration

## Manuella deploy-steg (om relevant)
<!-- Migrations att köra, EFs att deploya, secrets att sätta -->

## Källor / Referenser
<!-- Audit-fil, GitHub issue, sanning-dokument, etc. -->
