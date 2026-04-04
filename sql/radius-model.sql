-- Radius-modell: find_nearby_cleaners RPC
-- Använder befintlig service_radius_km-kolumn på cleaners (default 10)
-- OBS: service_radius_km finns redan — ingen ALTER TABLE behövs

-- 1. Säkerställ att alla städare har ett värde
UPDATE cleaners SET service_radius_km = 10 WHERE service_radius_km IS NULL;

-- 2. RPC-funktion: hitta städare inom radie
CREATE OR REPLACE FUNCTION find_nearby_cleaners(
  customer_lat double precision,
  customer_lng double precision
)
RETURNS TABLE (
  id uuid,
  full_name text,
  first_name text,
  last_name text,
  bio text,
  hourly_rate integer,
  profile_image_url text,
  avatar_url text,
  avg_rating numeric,
  total_reviews integer,
  review_count integer,
  services text[],
  city text,
  identity_verified boolean,
  home_lat double precision,
  home_lng double precision,
  pet_pref text,
  elevator_pref text,
  distance_km double precision
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT
    c.id,
    COALESCE(c.first_name || ' ' || c.last_name, c.first_name, 'Städare') AS full_name,
    c.first_name,
    c.last_name,
    c.bio,
    c.hourly_rate,
    c.profile_image_url,
    c.avatar_url,
    c.avg_rating,
    c.total_reviews,
    c.review_count,
    c.services,
    c.city,
    c.identity_verified,
    ST_Y(c.home_coords::geometry) AS home_lat,
    ST_X(c.home_coords::geometry) AS home_lng,
    c.pet_pref,
    c.elevator_pref,
    ROUND((ST_Distance(
      c.home_coords::geography,
      ST_MakePoint(customer_lng, customer_lat)::geography
    ) / 1000)::numeric, 1) AS distance_km
  FROM cleaners c
  WHERE c.is_active = true
    AND c.is_approved = true
    AND c.home_coords IS NOT NULL
    AND ST_DWithin(
      c.home_coords::geography,
      ST_MakePoint(customer_lng, customer_lat)::geography,
      COALESCE(c.service_radius_km, 10) * 1000
    )
  ORDER BY distance_km ASC, c.avg_rating DESC NULLS LAST;
$$;

-- 3. Verifiera
SELECT id, first_name, home_coords, service_radius_km FROM cleaners LIMIT 5;
