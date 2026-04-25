-- ═══════════════════════════════════════════════════════════════
-- SPICK – Fas 4 §4.7: Aktivera F1_USE_DB_SERVICES (DB-driven services)
-- ═══════════════════════════════════════════════════════════════
--
-- Efter §4.1-§4.6 retrofit (5 HTML-sidor uppdaterade till SPICK_RUT_SERVICES
-- + SPICK_ALL_SERVICES med fallback) kan flag aktiveras.
--
-- VAD AKTIVERAS:
--   - services-loader.js fetchar services-list EF (ger 7 services i prod)
--   - window.SPICK_RUT_SERVICES + window.SPICK_ALL_SERVICES populeras
--   - Element med [data-services-render] får DB-driven rendering
--   - boka.html, stadare-dashboard.html, foretag.html, stadare-profil.html,
--     admin.html använder DB istället för hardcoded fallback
--
-- ROLLBACK: UPDATE platform_settings SET value='false' WHERE key='F1_USE_DB_SERVICES';
--
-- KÖRS i Supabase Studio SQL-editor.
--
-- REGLER: #26 platform_settings-tabell verifierad, #27 scope (bara flag-flip),
-- #28 SSOT (services.label_sv är primärkällan), #29 services-loader.js
-- pattern-läst, #30 Skatteverket-relevant flag (rut_eligible-data),
-- #31 services-list EF curl-verifierat 2026-04-25 (returnerar 7 services).
-- ═══════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- BLOCK 1: Verifiera nuläge
-- ──────────────────────────────────────────────────────────────
SELECT key, value, updated_at
FROM platform_settings
WHERE key = 'F1_USE_DB_SERVICES';


-- ──────────────────────────────────────────────────────────────
-- BLOCK 2: Verifiera services-tabell innehåll
-- ──────────────────────────────────────────────────────────────
SELECT
  key,
  label_sv,
  rut_eligible,
  is_b2b,
  is_b2c,
  display_order,
  default_hourly_price
FROM services
ORDER BY display_order;


-- ──────────────────────────────────────────────────────────────
-- BLOCK 3: Aktivera flag (kör efter granskning av BLOCK 1+2)
-- ──────────────────────────────────────────────────────────────
INSERT INTO platform_settings (key, value, updated_at)
VALUES ('F1_USE_DB_SERVICES', 'true', NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = NOW();


-- ──────────────────────────────────────────────────────────────
-- BLOCK 4: Verifiera aktivering
-- ──────────────────────────────────────────────────────────────
SELECT key, value, updated_at
FROM platform_settings
WHERE key = 'F1_USE_DB_SERVICES';
-- Förväntat: value='true', updated_at=NOW()


-- ──────────────────────────────────────────────────────────────
-- BLOCK 5: ROLLBACK om problem (bara om behov)
-- ──────────────────────────────────────────────────────────────
-- UPDATE platform_settings SET value='false', updated_at=NOW() WHERE key='F1_USE_DB_SERVICES';
