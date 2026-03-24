-- ============================================
-- Spick – Supabase Schema Update
-- Kör detta i Supabase SQL Editor
-- ============================================

-- 1. Skapa cleaners-tabellen (godkända städare som visas på stadare.html)
CREATE TABLE IF NOT EXISTS cleaners (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  city TEXT DEFAULT 'Stockholm',
  bio TEXT,
  hourly_rate INTEGER DEFAULT 350,
  services TEXT[],
  languages TEXT[],
  rating DECIMAL(3,2) DEFAULT 0,
  reviews INTEGER DEFAULT 0,
  jobs_completed INTEGER DEFAULT 0,
  available BOOLEAN DEFAULT true,
  featured BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'godkänd',
  days INTEGER[],
  application_id UUID,
  avatar_url TEXT
);

-- 2. Aktivera Row Level Security
ALTER TABLE cleaners ENABLE ROW LEVEL SECURITY;

-- 3. Läs-policy för alla
CREATE POLICY IF NOT EXISTS "Alla kan läsa godkända städare"
  ON cleaners FOR SELECT
  USING (status = 'godkänd');

-- 4. Skriv-policy (öppen för nu)
CREATE POLICY IF NOT EXISTS "Bara admin kan skriva"
  ON cleaners FOR ALL
  USING (true);

-- 5. Funktion: Godkänn ansökan → kopiera till cleaners
CREATE OR REPLACE FUNCTION approve_cleaner(application_id UUID)
RETURNS void AS $$
DECLARE
  app RECORD;
BEGIN
  -- Hämta från cleaner_applications
  SELECT * INTO app FROM cleaner_applications WHERE id = application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ansökan hittades inte: %', application_id;
  END IF;

  -- Uppdatera status
  UPDATE cleaner_applications SET status = 'godkänd' WHERE id = application_id;

  -- Lägg in i cleaners
  INSERT INTO cleaners (
    full_name, email, phone, city, bio,
    hourly_rate, services, available, status,
    application_id, days
  ) VALUES (
    COALESCE(app.full_name, app.name, 'Okänd'),
    app.email,
    app.phone,
    COALESCE(app.city, 'Stockholm'),
    COALESCE(app.bio, app.message, ''),
    COALESCE(app.hourly_rate, app.price, 350),
    ARRAY['Hemstädning'],
    true,
    'godkänd',
    application_id,
    ARRAY[1,1,1,1,1,0,0]
  )
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 6. Index
CREATE INDEX IF NOT EXISTS cleaners_status_idx ON cleaners(status);
CREATE INDEX IF NOT EXISTS cleaners_rating_idx ON cleaners(rating DESC);
