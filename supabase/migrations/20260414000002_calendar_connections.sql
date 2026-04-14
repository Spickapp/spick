-- ============================================================
-- Migration: calendar_connections — OAuth-tokens för Google/Outlook/CalDAV
-- Skapad: 2026-04-14
--
-- Lagrar åtkomsttokens för externa kalenderprovidrar.
-- Incremental sync via syncToken (Google) / deltaLink (Outlook).
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_connections (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cleaner_id       uuid NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('google', 'outlook', 'caldav')),
  access_token     text,           -- bör krypteras (AES-256-GCM) i framtid
  refresh_token   text,            -- bör krypteras
  token_expires_at timestamptz,
  calendar_id      text,           -- Google Calendar ID / Outlook folder ID
  caldav_url       text,           -- för CalDAV-import
  sync_token       text,           -- Google syncToken / Outlook deltaLink
  last_synced_at   timestamptz,
  is_active        boolean DEFAULT true,
  sync_direction   text DEFAULT 'both' CHECK (sync_direction IN ('inbound', 'outbound', 'both')),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),

  CONSTRAINT one_provider_per_cleaner UNIQUE (cleaner_id, provider)
);

-- Index
CREATE INDEX IF NOT EXISTS idx_cal_conn_cleaner ON calendar_connections (cleaner_id);
CREATE INDEX IF NOT EXISTS idx_cal_conn_active  ON calendar_connections (is_active) WHERE is_active = true;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_cal_conn_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cal_conn_updated ON calendar_connections;
CREATE TRIGGER trg_cal_conn_updated
  BEFORE UPDATE ON calendar_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_cal_conn_updated_at();

-- RLS
ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own connections" ON calendar_connections;
CREATE POLICY "Users read own connections"
  ON calendar_connections FOR SELECT
  USING (cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own connections" ON calendar_connections;
CREATE POLICY "Users manage own connections"
  ON calendar_connections FOR ALL
  USING (cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role manages all connections" ON calendar_connections;
CREATE POLICY "Service role manages all connections"
  ON calendar_connections FOR ALL
  USING (auth.role() = 'service_role');

-- GRANT
GRANT ALL ON calendar_connections TO anon, authenticated, service_role;

-- ============================================================
-- Unique index på (cleaner_id, external_id) för upsert i calendar-sync
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_cal_external_unique
  ON calendar_events (cleaner_id, external_id)
  WHERE external_id IS NOT NULL;

SELECT 'calendar_connections table + idx_cal_external_unique created' AS result;
