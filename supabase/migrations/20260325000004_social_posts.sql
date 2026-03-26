CREATE TABLE IF NOT EXISTS social_posts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ig_post_id      TEXT,
  fb_post_id      TEXT,
  ig_content      TEXT,
  fb_content      TEXT,
  stats_snapshot  JSONB,
  posted_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
