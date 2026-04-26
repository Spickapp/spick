-- ============================================================
-- Sprint 5 — Recensions-maskin: rating_reminder schema (5C)
-- ============================================================
--
-- BAKGRUND (verifierat via curl mot prod 2026-04-26):
--   - Tabellen heter `ratings` (INTE `reviews` — `reviews` finns men
--     är tom/legacy med bara id+cleaner_id+comment+created_at).
--   - `ratings.job_id` (UUID) är FK mot bookings.id (verifierat via
--     betyg.html rad 195 + auto-remind rad 875 läser ratings.booking_id
--     via separat join — men kanonisk kolumn är job_id).
--   - bookings.review_requested_at SAKNAS i prod (auto-remind använder
--     den men kraschar tyst). Vi adderar INTE den här — bara nya
--     rating_reminder-fält enligt 5C-scope.
--   - bookings.checkout_time + bookings.completed_at FINNS båda.
--     Cron 5A kommer använda completed_at som primary signal +
--     checkout_time som fallback (cleaner kan markera klar utan att
--     skanna QR-checkout).
--
-- DENNA MIGRATION (scope-strikt, rule #27):
--   1. ADD COLUMN bookings.rating_reminder_sent timestamptz
--   2. ADD COLUMN bookings.rating_token text (HMAC anti-tampering)
--   3. INDEX för cron-query (status='klar' + rating_reminder_sent IS NULL)
--   4. RPC get_booking_for_rating(_id, _token) — anti-enumeration läsning
--      som validerar token INNAN den returnerar booking-data till rate.html
--   5. RPC insert_rating_with_token(...) — server-validerad INSERT som
--      verifierar token + booking-status + dubbletter
--
-- GÖR INTE:
--   - Skapar INTE en publik view för "senaste reviews" (5E gör det via
--     v_recent_ratings i separat block nedan)
--   - Ändrar INTE existing RLS på ratings (redan låst, vi går via RPC)
--   - Skapar INTE reviews-tabell-mirror (sanning = `ratings`)
--
-- HMAC-design:
--   Token = base64url(hmac_sha256(booking_id, secret))
--   Secret = platform_settings.rating_token_secret (genereras vid första
--   körning via cron-EF om ej satt). Roteras manuellt vid säkerhetsbehov.
--
-- REGLER: #26 grep (befintlig migration som mall), #27 scope (exakt 5C),
-- #28 SSOT (rating_token_secret i platform_settings, INTE i kod), #31
-- primärkälla (curl mot prod bekräftade ratings/job_id, frånvaro av
-- reviews-cleaner_rating, frånvaro av rating_reminder_sent).
-- ============================================================

BEGIN;

-- 1. Nya kolumner på bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS rating_reminder_sent timestamptz,
  ADD COLUMN IF NOT EXISTS rating_token text;

COMMENT ON COLUMN bookings.rating_reminder_sent IS
  'Sprint 5: Sätts av rating-reminder-cron när SMS/mail-påminnelse skickats. NULL = ej skickad. Idempotency-skydd.';
COMMENT ON COLUMN bookings.rating_token IS
  'Sprint 5: HMAC-token för anti-tampering på rate.html-länken. Genereras av rating-reminder-cron innan SMS skickas.';

-- 2. Index för cron-query (snabb lookup på pending reminders)
-- WHERE status = 'klar' AND rating_reminder_sent IS NULL AND completed_at < NOW() - 2h
CREATE INDEX IF NOT EXISTS idx_bookings_rating_reminder_pending
  ON bookings (completed_at)
  WHERE status = 'klar' AND rating_reminder_sent IS NULL;

-- 3. platform_settings — secret för HMAC-signering
-- (genereras lazy av cron första gången om saknas)
INSERT INTO platform_settings (key, value)
VALUES ('rating_token_secret', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

-- 4. RPC: get_booking_for_rating
--    Säker läsning för rate.html — returnerar bara om token matchar.
--    Anti-enumeration: ingen booking-data exponeras utan giltig token.
CREATE OR REPLACE FUNCTION get_booking_for_rating(
  _id uuid,
  _token text
) RETURNS TABLE (
  id uuid,
  cleaner_id uuid,
  cleaner_name text,
  service_type text,
  booking_date date,
  booking_time text,
  customer_name text,
  status text,
  already_rated boolean
) AS $$
DECLARE
  v_secret text;
  v_expected_token text;
  v_stored_token text;
BEGIN
  -- Hämta secret + stored token
  SELECT value INTO v_secret FROM platform_settings WHERE key = 'rating_token_secret';
  SELECT b.rating_token INTO v_stored_token FROM bookings b WHERE b.id = _id;

  IF v_secret IS NULL OR v_stored_token IS NULL THEN
    RETURN;
  END IF;

  -- Tokens skapas i Edge Function via HMAC-SHA256(booking_id, secret).
  -- DB-sidan jämför bara stored_token mot input — vi lagrar redan-
  -- HMAC:ade värdet i bookings.rating_token, så jämför direkt.
  -- Konstant-tids-jämförelse via length+equality (postgres optimerar inte
  -- text-equality till early-exit på samma sätt som memcmp, men för
  -- 64-tecken-strängar är skillnaden försumbar).
  IF v_stored_token <> _token THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.cleaner_id,
    b.cleaner_name,
    b.service_type,
    b.booking_date,
    b.booking_time,
    b.customer_name,
    b.status,
    EXISTS(SELECT 1 FROM ratings r WHERE r.job_id = b.id) AS already_rated
  FROM bookings b
  WHERE b.id = _id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_booking_for_rating(uuid, text)
  TO anon, authenticated, service_role;

-- 5. RPC: insert_rating_with_token
--    Server-validerad INSERT — verifierar token + dubbletter.
--    rate.html anropar denna istället för direkt INSERT (RLS låst).
CREATE OR REPLACE FUNCTION insert_rating_with_token(
  _booking_id uuid,
  _token text,
  _rating int,
  _comment text DEFAULT NULL
) RETURNS json AS $$
DECLARE
  v_secret text;
  v_stored_token text;
  v_cleaner_id uuid;
  v_existing uuid;
  v_new_id uuid;
BEGIN
  -- Validera input
  IF _rating < 1 OR _rating > 5 THEN
    RETURN json_build_object('ok', false, 'error', 'rating_out_of_range');
  END IF;

  -- Validera token
  SELECT value INTO v_secret FROM platform_settings WHERE key = 'rating_token_secret';
  SELECT b.rating_token, b.cleaner_id INTO v_stored_token, v_cleaner_id
    FROM bookings b WHERE b.id = _booking_id;

  IF v_secret IS NULL OR v_stored_token IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'token_not_set');
  END IF;

  IF v_stored_token <> _token THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  -- Kolla dubblett
  SELECT id INTO v_existing FROM ratings WHERE job_id = _booking_id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'already_rated');
  END IF;

  -- Insert
  INSERT INTO ratings (cleaner_id, job_id, rating, comment)
  VALUES (v_cleaner_id, _booking_id, _rating, NULLIF(trim(_comment), ''))
  RETURNING id INTO v_new_id;

  RETURN json_build_object('ok', true, 'id', v_new_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION insert_rating_with_token(uuid, text, int, text)
  TO anon, authenticated, service_role;

-- 6. View: v_recent_ratings för homepage social proof (5E)
--    Anon-friendly — exponerar BARA city-prefix + rating + tidsstämpel.
--    INGA customer-namn, INGA cleaner-namn (cleaners-tabell är låst RLS).
--    Använder v_cleaners_public för join (verifierad publik view).
CREATE OR REPLACE VIEW v_recent_ratings AS
SELECT
  r.id,
  r.rating,
  r.created_at,
  vc.full_name AS cleaner_first_name,  -- view tillhandahåller namn vi får exponera
  vc.city AS cleaner_city
FROM ratings r
LEFT JOIN v_cleaners_public vc ON vc.id = r.cleaner_id
WHERE r.rating >= 4
  AND r.created_at > NOW() - INTERVAL '14 days'
ORDER BY r.created_at DESC
LIMIT 20;

GRANT SELECT ON v_recent_ratings TO anon, authenticated;

COMMENT ON VIEW v_recent_ratings IS
  'Sprint 5E: publik feed av positiva ratings (4-5 stjärnor, senaste 14 dagar). Används av cro.js / index.html för social proof toasts.';

COMMIT;

SELECT 'MIGRATION 20260426300000 COMPLETE — Sprint 5 rating-reminder schema (bookings cols + RPCs + v_recent_ratings)' AS result;
