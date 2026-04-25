-- ═══════════════════════════════════════════════════════════════
-- SPICK – §4.8 "Eget städmaterial"-addon (icke-RUT-tillägg)
-- ═══════════════════════════════════════════════════════════════
--
-- Adds "Eget städmaterial inkluderat"-addon på alla RUT-services så
-- kund kan välja att städaren tar med material. Pris justera per
-- preference. Per Farhad-direktiv 2026-04-25.
--
-- VIKTIGT (rule #30 Skatteverket):
--   Addons är default ej-RUT-berättigade i booking-create (rad 344-347).
--   Material räknas INTE som arbetskostnad, så RUT-avdrag (50%) gäller
--   bara på base-pris (arbete), inte på addon-pris (material).
--   Detta är hårdkodat i booking-create + visas tydligt i UI som
--   "ej RUT"-badge per Sprint C-4 2026-04-25.
--
-- KÖRS i Supabase Studio SQL-editor.
--
-- REGLER: #26 service_addons-schema verifierat (key/label_sv/price_sek/
-- active/service_id), #27 scope (bara INSERT, ingen kolumn-ändring),
-- #28 SSOT (services.rut_eligible primärkälla, addons är derivative),
-- #29 booking-create rad 343-377 reviewat — addons är default ej-RUT,
-- #30 SKV: material räknas INTE som arbetskostnad (väletablerat),
-- #31 prod-state: services-list EF returnerar 5 RUT-services live, alla
-- får denna addon.
-- ═══════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- BLOCK 1: Visa befintliga RUT-services + addons för dem
-- ──────────────────────────────────────────────────────────────
SELECT
  s.key AS service_key,
  s.label_sv AS service_label,
  s.rut_eligible,
  COALESCE(json_agg(json_build_object('key', a.key, 'label', a.label_sv, 'price', a.price_sek)) FILTER (WHERE a.id IS NOT NULL), '[]'::json) AS addons
FROM services s
LEFT JOIN service_addons a ON a.service_id = s.id AND a.active = true
WHERE s.rut_eligible = true AND s.active = true
GROUP BY s.id, s.key, s.label_sv, s.rut_eligible
ORDER BY s.display_order;


-- ──────────────────────────────────────────────────────────────
-- BLOCK 2: INSERT "eget_stadmaterial"-addon på alla RUT-services
-- ──────────────────────────────────────────────────────────────
-- VIKTIGT: justera price_sek innan körning. Default 150 kr är gissning.
-- Farhads beslut. Säg till så uppdaterar jag.

INSERT INTO service_addons (service_id, key, label_sv, label_en, price_sek, active, display_order)
SELECT
  s.id AS service_id,
  'eget_stadmaterial' AS key,
  'Städmaterial inkluderat' AS label_sv,
  'Cleaning supplies included' AS label_en,
  150 AS price_sek,    -- ⚠️ Justera detta värde innan körning
  true AS active,
  900 AS display_order  -- långt bak i listan
FROM services s
WHERE s.rut_eligible = true AND s.active = true
ON CONFLICT (service_id, key) DO NOTHING;


-- ──────────────────────────────────────────────────────────────
-- BLOCK 3: Verifiera INSERT
-- ──────────────────────────────────────────────────────────────
SELECT
  s.label_sv AS service,
  a.label_sv AS addon,
  a.price_sek,
  a.active,
  a.display_order,
  a.created_at
FROM service_addons a
JOIN services s ON s.id = a.service_id
WHERE a.key = 'eget_stadmaterial'
ORDER BY s.display_order;


-- ──────────────────────────────────────────────────────────────
-- BLOCK 4: ROLLBACK (om behov)
-- ──────────────────────────────────────────────────────────────
-- DELETE FROM service_addons WHERE key = 'eget_stadmaterial';


-- ──────────────────────────────────────────────────────────────
-- ANTECKNINGAR FÖR FARHAD:
-- ──────────────────────────────────────────────────────────────
-- 1. Pris 150 kr är gissning. Kanske ska vara baserat på:
--    - Hemstädning ~ 100 kr (basic-paket)
--    - Storstädning ~ 200 kr (mer förbrukning)
--    - Flyttstädning ~ 250 kr (intensiv städ)
--    Per-service-pris kräver olika INSERT-rader.
--
-- 2. Alternativ namngivning:
--    - "Städmaterial inkluderat" (vad jag valde)
--    - "Vi tar med städmaterial"
--    - "Inkl. rengöringsmedel + utrustning"
--    Säg till om annat namn ska användas.
--
-- 3. Detta är ej-RUT-berättigat per Skatteverkets riktlinjer
--    (material räknas inte som arbetskostnad). Backend exkluderar
--    automatiskt från rut_amount-beräkning. UI visar "ej RUT"-badge.
--
-- 4. Cleaner-perspektiv: när bokning kommer in med detta addon
--    bör cleaner se "kund har valt material" + få extra 150 kr.
--    Verifiera att stadare-dashboard.html visar addon i bookings.
