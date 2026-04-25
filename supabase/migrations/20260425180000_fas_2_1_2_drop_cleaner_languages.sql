-- Fas 2-utökning §2.1.2 — DROP cleaner_languages (LEGACY, SUPERSEDED)
-- ════════════════════════════════════════════════════════════════════
-- Bakgrund:
--   §7.1 + §7.2 i v3-arkitekturplan föreslog separat `languages`-tabell +
--   `cleaner_languages` m2m-länktabell. Farhad-beslut 2026-04-23
--   (docs/v3-phase1-progress.md rad 86): SUPERSEDED. Embedded
--   `cleaners.languages TEXT[]` används istället (rule #28 SSOT).
--
-- Verifiering (rule #31, 2026-04-25 audit):
--   - cleaner_languages.count = 0 (curl Content-Range */0)
--   - cleaners.languages-kolumnen finns i prod (curl 42501 RLS)
--   - 1 kod-reference: export-cleaner-data EF rad 109 (raderas i samma commit)
--   - 0 references i andra EFs, HTML, JS, frontend
--   - 2 RLS-policies på tabellen (cascadeas implicit av DROP TABLE)
--   - FK till cleaners(id) ON DELETE CASCADE — påverkar inte DROP-riktning
--
-- Idempotens: DROP TABLE IF EXISTS. Re-run safe.
-- ════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.cleaner_languages;
