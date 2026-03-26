-- Drop och återskapa cleaner_applications med ALLA kolumner
-- PostgREST schema cache problem löstes ej med NOTIFY, kräver komplett recreate

-- Spara befintlig data
CREATE TABLE IF NOT EXISTS cleaner_applications_backup AS 
  SELECT * FROM cleaner_applications;

-- Droppa och återskapa med korrekt schema
DROP TABLE IF EXISTS cleaner_applications;

CREATE TABLE cleaner_applications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      TEXT NOT NULL,
  email          TEXT NOT NULL,
  phone          TEXT,
  city           TEXT,
  services       TEXT,
  hourly_rate    INTEGER DEFAULT 350,
  bio            TEXT,
  languages      TEXT,
  available_days TEXT,
  has_fskatt     BOOLEAN DEFAULT false,
  has_insurance  BOOLEAN DEFAULT false,
  status         TEXT DEFAULT 'pending',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Återställ data från backup (alla kolumner som fanns)
INSERT INTO cleaner_applications (id, full_name, email, phone, city, services, hourly_rate, bio, has_fskatt, status, created_at)
SELECT id, full_name, email, phone, city, services, 
       COALESCE(hourly_rate, 350), bio, 
       COALESCE(has_fskatt, false), 
       COALESCE(status, 'pending'), 
       COALESCE(created_at, NOW())
FROM cleaner_applications_backup;

-- RLS
ALTER TABLE cleaner_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon kan insertera ansökan" ON cleaner_applications
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Autentiserad kan läsa ansökningar" ON cleaner_applications
  FOR SELECT TO authenticated USING (true);

DROP TABLE IF EXISTS cleaner_applications_backup;

SELECT 'cleaner_applications recreated med ' || COUNT(*) || ' kolumner ✅' AS status
FROM information_schema.columns 
WHERE table_name = 'cleaner_applications';
