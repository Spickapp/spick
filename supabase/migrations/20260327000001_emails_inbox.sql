-- ══════════════════════════════════════════════════════════════
-- SPICK EMAIL INBOX – Hanterar alla inkommande mail automatiskt
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS emails (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  received_at     TIMESTAMPTZ DEFAULT NOW(),
  from_email      TEXT NOT NULL,
  from_name       TEXT,
  reply_to        TEXT,
  subject         TEXT,
  body_text       TEXT,
  body_html       TEXT,
  category        TEXT DEFAULT 'okategoriserat',
  priority        TEXT DEFAULT 'normal',
  ai_summary      TEXT,
  ai_reply        TEXT,
  status          TEXT DEFAULT 'ny',
  auto_replied    BOOLEAN DEFAULT FALSE,
  replied_at      TIMESTAMPTZ,
  admin_notes     TEXT,
  handled_at      TIMESTAMPTZ,
  resend_id       TEXT UNIQUE,
  raw_headers     JSONB
);

CREATE INDEX IF NOT EXISTS idx_emails_status   ON emails(status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_category ON emails(category, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_from     ON emails(from_email);

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='emails' AND policyname='Service role full access emails') THEN
    CREATE POLICY "Service role full access emails" ON emails FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='emails' AND policyname='Anon read emails') THEN
    CREATE POLICY "Anon read emails" ON emails FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='emails' AND policyname='Anon insert emails') THEN
    CREATE POLICY "Anon insert emails" ON emails FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
