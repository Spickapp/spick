-- ═══════════════════════════════════════════════════════════════
-- SPICK — Content Engine DB-tabeller
-- content_queue: AI-genererade inlägg (draft → scheduled → posted)
-- content_performance: Engagement-data per inlägg (feedback loop)
-- ═══════════════════════════════════════════════════════════════

-- Kö med AI-genererade inlägg
CREATE TABLE IF NOT EXISTS content_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  week INT NOT NULL,
  pillar INT NOT NULL CHECK (pillar BETWEEN 1 AND 5),
  pillar_name TEXT NOT NULL,
  hook TEXT NOT NULL,
  caption_instagram TEXT,
  caption_tiktok TEXT,
  caption_facebook TEXT,
  hashtags TEXT[],
  image_description TEXT,
  video_script TEXT,
  best_format TEXT CHECK (best_format IN ('carousel', 'reel', 'single_image', 'story', 'video')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'scheduled', 'posted', 'rejected')),
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  buffer_id TEXT,
  platform TEXT
);

-- Performance-tracking per publicerat inlägg
CREATE TABLE IF NOT EXISTS content_performance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  content_id UUID REFERENCES content_queue(id),
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'facebook', 'linkedin')),
  post_url TEXT,
  pillar INT NOT NULL,
  hook TEXT,
  likes INT DEFAULT 0,
  comments INT DEFAULT 0,
  saves INT DEFAULT 0,
  shares INT DEFAULT 0,
  reach INT DEFAULT 0,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  engagement_rate NUMERIC GENERATED ALWAYS AS (
    CASE WHEN reach > 0 
    THEN (likes + comments * 2 + saves * 3 + shares * 5)::numeric / reach * 100
    ELSE 0 END
  ) STORED,
  converted BOOLEAN DEFAULT false,
  notes TEXT
);

-- RLS: service_role only (admin + content engine)
ALTER TABLE content_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access content_queue" ON content_queue FOR ALL
  TO service_role USING (true);
CREATE POLICY "Service role full access content_performance" ON content_performance FOR ALL
  TO service_role USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_queue_week ON content_queue(week);
CREATE INDEX IF NOT EXISTS idx_content_queue_status ON content_queue(status);
CREATE INDEX IF NOT EXISTS idx_content_performance_platform ON content_performance(platform);
CREATE INDEX IF NOT EXISTS idx_content_performance_pillar ON content_performance(pillar);
