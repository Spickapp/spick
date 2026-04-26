-- ═══════════════════════════════════════════════════════════════
-- SPICK – Sprint 6 Content-Engine: blog_posts-tabell
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- Auto-genererad blogg-content via Anthropic Claude API publiceras
-- 2 ggr/vecka (tis+tor 09:00) av blog-auto-publish-cron-EF. Mål:
-- 50+ kvalitetsposts på 3 mån → 5x organic-trafik.
--
-- DESIGN
-- - SSOT: blog_posts-tabellen är central källa för alla auto-genererade
--   posts. Frontend (blogg/index.html + blogg/post.html?slug=) läser
--   härifrån via anon-RLS. Befintliga statiska blogg/*.html-filer
--   påverkas EJ — de kan migreras manuellt senare om så önskas.
-- - city + target_keyword: indexerade för framtida filtrering
--   (city-pages, kategori-vyer)
-- - view_count: enkel counter som frontend kan POST:a när posts läses;
--   ingen mätning här, bara struktur
--
-- REGLER (#26-#31):
-- - #28 SSOT: en tabell, allt content + metadata på samma plats
-- - #30 ingen regulator-claim: tabellen lagrar bara JSON-genererad
--   content; alla regulator-disclaimers ligger i prompt-template
--   (blog-generate EF) och i HTML-content som modellen producerar
-- - #31 schema verifierat via curl 404 mot prod 2026-04-26 — tabellen
--   finns INTE ännu, denna migration skapar den
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Tabell ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blog_posts (
  id                UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  slug              TEXT         NOT NULL UNIQUE,
  title             TEXT         NOT NULL,
  html_content      TEXT         NOT NULL,
  meta_description  TEXT         NOT NULL,
  target_keyword    TEXT,
  city              TEXT,
  og_image_prompt   TEXT,
  published_at      TIMESTAMPTZ,
  view_count        INTEGER      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.blog_posts                  IS 'Sprint 6: Auto-genererade blogg-posts via Anthropic Claude API';
COMMENT ON COLUMN public.blog_posts.slug             IS 'URL-slug, unik. Frontend-routing /blogg/{slug} → blogg/post.html?slug={slug}';
COMMENT ON COLUMN public.blog_posts.html_content     IS 'Renderad HTML från claude-haiku-4-5. Stylas av post.html.';
COMMENT ON COLUMN public.blog_posts.meta_description IS 'Max 155 tecken. Används i <meta name="description"> + OG.';
COMMENT ON COLUMN public.blog_posts.target_keyword   IS 'SEO-keyword posten är optimerad för (för framtida ranking-rapport).';
COMMENT ON COLUMN public.blog_posts.city             IS 'Lokaliserad post (NULL = generell). Används för stad-sidor i framtiden.';
COMMENT ON COLUMN public.blog_posts.published_at     IS 'Sätts av blog-auto-publish-cron vid INSERT. NULL = draft (ej publicerad).';

-- ── 2. Index ────────────────────────────────────────────────
-- slug är UNIQUE → index skapas automatiskt
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at
  ON public.blog_posts (published_at DESC)
  WHERE published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_blog_posts_city
  ON public.blog_posts (city)
  WHERE city IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_blog_posts_target_keyword
  ON public.blog_posts (target_keyword)
  WHERE target_keyword IS NOT NULL;

-- ── 3. RLS ──────────────────────────────────────────────────
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

-- Anon SELECT: bara publicerade posts
DROP POLICY IF EXISTS "anon read published blog posts" ON public.blog_posts;
CREATE POLICY "anon read published blog posts"
  ON public.blog_posts
  FOR SELECT
  TO anon, authenticated
  USING (published_at IS NOT NULL);

-- Service role: full access (för blog-auto-publish-cron + admin-UI)
DROP POLICY IF EXISTS "service role manage blog posts" ON public.blog_posts;
CREATE POLICY "service role manage blog posts"
  ON public.blog_posts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── 4. updated_at-trigger (SSOT-mönster från övriga tabeller) ──
CREATE OR REPLACE FUNCTION public.blog_posts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blog_posts_updated_at ON public.blog_posts;
CREATE TRIGGER trg_blog_posts_updated_at
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.blog_posts_set_updated_at();

-- ── 5. Initial topics-queue (5 topics) ────────────────────────
-- Format: JSON-array av { topic, target_keyword, city? }
-- platform_settings.value är TEXT — vi lagrar JSON-string här.
-- blog-auto-publish-cron pop:ar första item, processar, INSERTar i blog_posts.
INSERT INTO public.platform_settings (key, value)
VALUES (
  'blog_topics_queue',
  '[
    {"topic":"10 städtips för Stockholm","target_keyword":"städtips Stockholm","city":"Stockholm"},
    {"topic":"Hur funkar RUT-avdraget?","target_keyword":"RUT-avdrag guide"},
    {"topic":"Storstädning vs hemstädning — vilken passar dig?","target_keyword":"storstädning hemstädning"},
    {"topic":"7 saker du bör veta innan flyttstädning","target_keyword":"flyttstädning checklista"},
    {"topic":"Trappstädning för BRF — guide för styrelsen","target_keyword":"trappstädning BRF"}
  ]'
)
ON CONFLICT (key) DO NOTHING;
