-- ============================================
-- SPICK – Geografisk matchning
-- Kör i Supabase SQL Editor (i ordning)
-- ============================================

-- 1. Aktivera PostGIS (geografiska beräkningar)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- 2. Lägg till geo-kolumner på städare
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS lat DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS lng DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS home_address TEXT,
  ADD COLUMN IF NOT EXISTS service_radius_km INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS location GEOMETRY(Point, 4326);

-- 3. Lägg till geo-kolumner på bokningar  
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS lat DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS lng DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS location GEOMETRY(Point, 4326),
  ADD COLUMN IF NOT EXISTS distance_km DECIMAL(6, 2);