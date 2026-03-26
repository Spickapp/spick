-- ── STÄDARENS TILLGÄNGLIGHET ────────────────────────────────────────────────
-- Veckoschemat: vilka dagar + tider en städare är tillgänglig
CREATE TABLE IF NOT EXISTS cleaner_availability (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cleaner_id    UUID NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=sön,1=mån...6=lör
  start_time    TIME NOT NULL DEFAULT '08:00',
  end_time      TIME NOT NULL DEFAULT '17:00',
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cleaner_id, day_of_week)
);

-- Spärrade datum (semester, sjukdom etc)
CREATE TABLE IF NOT EXISTS cleaner_blocked_dates (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cleaner_id  UUID NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  blocked_date DATE NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cleaner_id, blocked_date)
);

-- Index för snabb datumfiltrering
CREATE INDEX IF NOT EXISTS idx_avail_cleaner ON cleaner_availability(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_blocked_cleaner ON cleaner_blocked_dates(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_blocked_date ON cleaner_blocked_dates(blocked_date);

-- RLS
ALTER TABLE cleaner_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_blocked_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read availability" ON cleaner_availability FOR SELECT USING (true);
CREATE POLICY "Public read blocked dates" ON cleaner_blocked_dates FOR SELECT USING (true);
CREATE POLICY "Service role manage availability" ON cleaner_availability FOR ALL USING (auth.role()='service_role');
CREATE POLICY "Service role manage blocked" ON cleaner_blocked_dates FOR ALL USING (auth.role()='service_role');

-- Seeddata: ge alla befintliga godkända städare ett standard-schema (mån–fre 08-17)
INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time)
SELECT id, d, '08:00', '17:00'
FROM cleaners, generate_series(1,5) AS d  -- 1=måndag...5=fredag
WHERE status = 'godkänd'
ON CONFLICT (cleaner_id, day_of_week) DO NOTHING;
