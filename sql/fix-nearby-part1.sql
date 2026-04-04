-- Part 1: Säkerställ kolumner + droppa gammal funktion
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0;
DROP FUNCTION IF EXISTS find_nearby_cleaners(double precision, double precision);
