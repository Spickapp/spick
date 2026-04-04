-- Lägg till geo-kolumner på cleaner_applications
-- Kör manuellt i Supabase SQL Editor
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS home_lat double precision;
ALTER TABLE cleaner_applications ADD COLUMN IF NOT EXISTS home_lng double precision;
