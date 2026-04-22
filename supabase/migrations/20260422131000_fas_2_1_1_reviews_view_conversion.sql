-- =========================================================
-- Fas 2.X iteration 4 — reviews: TABLE → VIEW konvertering
-- =========================================================
-- Primärkälla: prod-schema.sql rad 2566-2575 (CREATE VIEW reviews).
--
-- BAKGRUND:
-- I prod är reviews en VIEW på ratings-tabellen. I migrations skapas
-- den som TABLE (003_subs.sql + 20260325000001_production_ready.sql
-- + 20260327100001_fix_missing_tables.sql). Konverteringen har gjorts
-- i prod via manuell Studio-operation och aldrig migrerats.
--
-- Denna migration dokumenterar konverteringen retroaktivt:
-- 1. Städar alla policies/triggers/index på reviews (som tabell)
-- 2. DROP TABLE reviews CASCADE
-- 3. CREATE VIEW reviews AS SELECT ... FROM ratings
--
-- ORDNING: kör efter 20260422130000_fas_2_1_1_all_policies.sql som
-- skapat/uppdaterat alla reviews-policies (vilka vi nu drop:ar).
--
-- VIKTIGT: Denna migration är INTE idempotent i vanlig mening.
-- DROP TABLE IF EXISTS + CREATE VIEW är deterministisk men
-- andra miljöer måste ha ratings-tabellen skapad först
-- (20260422082000_fas_2_1_ratings.sql).
-- =========================================================

-- ── Städa alla beroenden på reviews som TABLE ─────────────

-- Triggers
DROP TRIGGER IF EXISTS "on_review_inserted" ON "public"."reviews";
DROP TRIGGER IF EXISTS "after_review_insert" ON "public"."reviews";

-- Index (om CREATE INDEX har körts)
DROP INDEX IF EXISTS "public"."idx_reviews_cleaner";

-- Policies (alla varianter från olika migrations)
DROP POLICY IF EXISTS "Public can insert reviews" ON "public"."reviews";
DROP POLICY IF EXISTS "Public can read reviews" ON "public"."reviews";
DROP POLICY IF EXISTS "Public insert reviews" ON "public"."reviews";
DROP POLICY IF EXISTS "Public read reviews" ON "public"."reviews";
DROP POLICY IF EXISTS "Rate limited insert reviews" ON "public"."reviews";
DROP POLICY IF EXISTS "Anon insert reviews" ON "public"."reviews";
DROP POLICY IF EXISTS "Insert review for completed booking" ON "public"."reviews";

-- ── Konvertera reviews från TABLE till VIEW ────────────────

-- DROP TABLE CASCADE städar även RLS, constraints, andra policies
-- som kan finnas från migrations jag missade ovan.
DROP TABLE IF EXISTS "public"."reviews" CASCADE;

-- ── CREATE VIEW reviews (matchar prod rad 2566-2575) ──────

CREATE OR REPLACE VIEW "public"."reviews" AS
    SELECT "id",
        "cleaner_id",
        "customer_id",
        "job_id",
        "rating" AS "cleaner_rating",
        "comment",
        "created_at",
        "service_type"
    FROM "public"."ratings" "r";

ALTER VIEW "public"."reviews" OWNER TO "postgres";

-- =========================================================
-- Slut reviews VIEW-konvertering
-- =========================================================
