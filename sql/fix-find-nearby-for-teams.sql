-- Fix: find_nearby_cleaners för teammedlemmar
-- Problem 1: is_active kan vara NULL/false för teammedlemmar
-- Problem 2: home_coords finns inte — cleaners har home_lat/home_lng som NUMERIC
-- Lösning: använd home_lat/home_lng direkt, acceptera company_id IS NOT NULL

-- Säkerställ att kolumnerna finns (idempotent)
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0;

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
    c.home_lat,
    c.home_lng,
    c.pet_pref,
    c.elevator_pref,
    ROUND((ST_Distance(
      ST_MakePoint(c.home_lng, c.home_lat)::geography,
      ST_MakePoint(customer_lng, customer_lat)::geography
    ) / 1000)::numeric, 1) AS distance_km
  FROM cleaners c
  WHERE c.is_approved = true
    AND (c.is_active = true OR c.company_id IS NOT NULL)
    AND c.status = 'aktiv'
    AND c.home_lat IS NOT NULL
    AND c.home_lng IS NOT NULL
    AND ST_DWithin(
      ST_MakePoint(c.home_lng, c.home_lat)::geography,
      ST_MakePoint(customer_lng, customer_lat)::geography,
      COALESCE(c.service_radius_km, 10) * 1000
    )
  ORDER BY distance_km ASC, c.avg_rating DESC NULLS LAST;
$$;
