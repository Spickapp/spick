-- Fas 1.2 Dag 2 Migration: Backfill customer_profiles (v2)
-- Förberedd 19 april 2026 09:10. KÖRS INTE IDAG.
--
-- Uppdaterad efter V11-V14 verifiering:
-- 
-- State (verifierat 19 april 09:05):
-- - customer_profiles: 1 rad (Farhad/farrehagge@gmail.com, auth_user_id=null)
-- - auth.users (kunder): 3 (Clara, Farre, Derin)
-- - bookings: 26 stycken × 3 unika customer_email
--
-- Åtgärd:
-- 1. UPDATE befintlig Farre-profile med auth_user_id
-- 2. INSERT Clara-profile
-- 3. INSERT Derin-profile
--
-- Efter migration: 3 customer_profiles, alla med auth_user_id-länk.

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- PRE-CHECK
-- ══════════════════════════════════════════════════════════════
SELECT 
  (SELECT COUNT(*) FROM customer_profiles) AS profiles_fore,
  (SELECT COUNT(*) FROM customer_profiles WHERE auth_user_id IS NOT NULL) AS linkade_fore,
  (SELECT COUNT(DISTINCT email) FROM customer_profiles) AS unika_emails_fore;
-- Förväntat: 1, 0, 1

-- Visa befintlig rad för transparens
SELECT id, auth_user_id, email, name, created_at FROM customer_profiles;

-- ══════════════════════════════════════════════════════════════
-- STEG 1: UPDATE befintlig Farre-profile med auth_user_id
-- ══════════════════════════════════════════════════════════════
UPDATE customer_profiles cp
   SET auth_user_id = u.id
  FROM auth.users u
 WHERE cp.email = u.email
   AND cp.email = 'farrehagge@gmail.com'
   AND cp.auth_user_id IS NULL;

-- Verifiera
SELECT id, auth_user_id, email FROM customer_profiles WHERE email = 'farrehagge@gmail.com';
-- Förväntat: 1 rad, auth_user_id = e567e62d-7812-4b84-98da-72a92293710f

-- ══════════════════════════════════════════════════════════════
-- STEG 2: INSERT customer_profiles för Clara och Derin
-- ══════════════════════════════════════════════════════════════
WITH latest_booking_per_customer AS (
  SELECT DISTINCT ON (customer_email)
    customer_email,
    customer_name,
    customer_phone,
    customer_address,
    created_at
  FROM bookings
  WHERE customer_email IS NOT NULL
  ORDER BY customer_email, created_at DESC
)
INSERT INTO customer_profiles (
  id, 
  auth_user_id, 
  email, 
  name, 
  phone, 
  address,
  total_bookings,
  created_at
)
SELECT
  gen_random_uuid(),
  u.id,
  u.email,
  COALESCE(lbpc.customer_name, ''),
  lbpc.customer_phone,
  lbpc.customer_address,
  (SELECT COUNT(*) FROM bookings b WHERE b.customer_email = u.email),
  NOW()
FROM auth.users u
LEFT JOIN latest_booking_per_customer lbpc ON lbpc.customer_email = u.email
WHERE u.email IN (
  SELECT DISTINCT customer_email 
    FROM bookings 
   WHERE customer_email IS NOT NULL
)
  AND NOT EXISTS (
    SELECT 1 FROM customer_profiles cp 
    WHERE cp.email = u.email
  );

-- ══════════════════════════════════════════════════════════════
-- STEG 3: Uppdatera total_bookings för befintlig Farre-profile
-- ══════════════════════════════════════════════════════════════
UPDATE customer_profiles cp
   SET total_bookings = (
     SELECT COUNT(*) FROM bookings b WHERE b.customer_email = cp.email
   )
 WHERE cp.email = 'farrehagge@gmail.com';

-- ══════════════════════════════════════════════════════════════
-- POST-CHECK
-- ══════════════════════════════════════════════════════════════
SELECT 
  (SELECT COUNT(*) FROM customer_profiles) AS profiles_efter,
  (SELECT COUNT(*) FROM customer_profiles WHERE auth_user_id IS NOT NULL) AS linkade_efter;
-- Förväntat: 3, 3

-- Visa alla 3 profiles
SELECT 
  cp.email,
  cp.auth_user_id IS NOT NULL AS har_auth_link,
  cp.name,
  cp.total_bookings AS profile_bookings,
  (SELECT COUNT(*) FROM bookings b WHERE b.customer_email = cp.email) AS actual_bookings
FROM customer_profiles cp
ORDER BY cp.email;
-- Förväntat:
-- claraml@hotmail.se   | true | ... | 10 | 10
-- derin.bahram@ivory.se| true | ... | 1  | 1
-- farrehagge@gmail.com | true | ... | 15 | 15

COMMIT;
