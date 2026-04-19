# ID-1.1 Funktionsmigration (2026-04-19)

## Sammanfattning
ID-1 (commit 723d8a4, 2026-04-18) implementerade PII-lockdown pa 
cleaners-tabellen via REVOKE SELECT FROM anon + v_cleaners_public-vy. 
Migrationen stangde PII-lackan korrekt men bröt funktionsmassigt 8 publika 
sidor som lasade direkt fran cleaners istallet for vyn.

## Verifierad produktionsbugg
- Anon SELECT pa cleaners: 42501 permission denied (verifierat via 
  `SET LOCAL ROLE anon; SELECT * FROM cleaners;`)
- Paverkade sidor: profil.html, boka.html (findFirstAvailable), 
  huddinge.html, nacka.html, solna.html, stockholm.html, 
  sundbyberg.html, taby.html
- Duration: 2026-04-18 21:00 — 2026-04-19 ~21:00 (cirka 24h)

## Rotorsak
ID-1 pre-check fokuserade pa sakerhet (RLS-verifiering) utan att greppa 
alla `.from('cleaners')`-anrop i frontend-filerna. Policy-level access 
"Anon can read approved active cleaners" fanns men maskerades av 
table-level REVOKE (Postgres kraver bade GRANT + policy-match).

## Fix
1. Ny migration 20260419_id_1_1_extend_v_cleaners_public.sql:
   CREATE OR REPLACE VIEW med has_fskatt tillagd (26 kolumner)
2. 8 frontend-filer migrerade fran .from('cleaners') till 
   .from('v_cleaners_public')
3. Stadpages: bonus_level borttaget fran SELECT (kolumnen fanns aldrig 
   i prod — c.bonus_level || 'Brons' fortsatter visa "Brons" for alla)

## Oppna tradar flaggade for F13 (skalningstest/cleanup)
- bonus_level migration-konflikt: 004_alias.sql (TEXT) och 
  20260326000001_e2e_fix.sql (INTEGER) — bada aldrig korda i prod
- tier (text) kolumn finns i prod men anvandning oklar — 
  bonus_check.py cron uppdaterar nagot
- public_cleaner_profiles-vy finns parallellt med v_cleaners_public — 
  harmoniseras i F6 eller F12
- team-jobb.html:304 — laser VD:s phone direkt fran cleaners. Degraderad 
  i prod sedan ID-1 (returnerar null). Fix kraver security-definer RPC 
  get_company_owner_phone(company_id). Ej blocker — phone-fallet visar 
  bara "Kontakta admin" istallet for VD-telefon.
- stockholm.html har duplicerad .ilike('city', city) — P1 backlog-item

## Migration-vs-prod-drift (3:e gangen upptackt)
1. 004_alias.sql bonus_level ADD COLUMN — aldrig kord
2. 20260326000001_e2e_fix.sql bonus_level ADD COLUMN — aldrig kord
3. ID-1:s anon policy fanns i DB men REVOKE blockerade — inkonsekvens 
   mellan policy och GRANT
F13 MASTE inkludera systematisk audit migrationsfiler vs prod-state.

## Lardom
Pre-check for RLS-migrationer MASTE inkludera:
(A) grep alla .from('[tabell]')-anrop
(B) lista kolumner varje anrop lasser
(C) verifiera kolumnlista mot nya vyn
(D) dry-run anon-SELECT mot staging forst
Dokumenterat i Regel #26/#27.
