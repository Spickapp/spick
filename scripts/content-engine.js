#!/usr/bin/env node
/**
 * SPICK CONTENT ENGINE — Veckovis AI-driven content-generering
 * Körs av GitHub Actions varje söndag 18:00 UTC
 * Genererar 7 inlägg, pushar till Buffer Drafts
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BUFFER_TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const SUPA_URL = process.env.SUPABASE_URL || 'https://urjeijcncsyuletprydy.supabase.co';
const SUPA_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── SEASON THEMES ──────────────────────────────────────────
const THEMES = {
  1: 'Nyårslöften & rutiner — ny start med professionell städning',
  2: 'Valentines — ge bort en ren lägenhet, presentkort',
  3: 'Vårstädning — fönster, garderob, balkong, djuprengöring',
  4: 'Allergi & pollen — allergisäkra ditt hem',
  5: 'Flyttsäsong — flyttstädning, deposition, nya hemmet',
  6: 'Semester — kom hem till rent, semesterstädning',
  7: 'Sommarstädning — lätt, snabb, 15 min/dag',
  8: 'Skolstart — organisera hemmet, ny rutin',
  9: 'Höststädning — fönsterputs, mörka kvällar, mys',
  10: 'Rena fönster innan mörkret — boka nu',
  11: 'Black Friday — bästa erbjudandet på städning',
  12: 'Julstädning — boka innan fullbokat, presentkort',
};

// ── GET WEEK CONTEXT ───────────────────────────────────────
function getContext() {
  const now = new Date();
  const week = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000));
  const month = now.getMonth() + 1;
  const theme = THEMES[month] || 'Allmänt städinnehåll';
  return { week, month, theme, date: now.toISOString().split('T')[0] };
}

// ── FETCH PAST PERFORMANCE ─────────────────────────────────
async function getPerformanceData() {
  if (!SUPA_KEY) return null;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/content_performance?select=hook,pillar,engagement_rate&order=engagement_rate.desc&limit=5`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    });
    return await r.json();
  } catch { return null; }
}

// ── GENERATE CONTENT VIA ANTHROPIC ─────────────────────────
async function generateContent(ctx, pastPerformance) {
  const feedbackBlock = pastPerformance && pastPerformance.length > 0
    ? `\nFEEDBACK FRÅN SENASTE VECKORNA:\nBästa hooks: ${pastPerformance.slice(0, 3).map(p => `"${p.hook}" (${p.engagement_rate}%)`).join(', ')}\nUndvik hooks liknande: ${pastPerformance.slice(-2).map(p => `"${p.hook}"`).join(', ')}\n`
    : '';

  const prompt = `Du är content manager för Spick.se (svensk städmarknadsplats).
${feedbackBlock}
Generera exakt 7 sociala medie-inlägg för vecka ${ctx.week} (${ctx.date}).

S�songstema: ${ctx.theme}

Fördelning:
- 2st Städtips/Lifehacks (pelare 1)
- 2st Före/Efter-transformation (pelare 2)
- 1st Trust/Transparens (pelare 3)
- 1st Pris/Erbjudande (pelare 4)
- 1st Underhållning/Relaterbart (pelare 5)

Per inlägg, ge EXAKT detta JSON-format:
{
  "posts": [
    {
      "pillar": 1,
      "pillar_name": "Städtips",
      "hook": "Max 8 ord som stoppar scrollandet",
      "caption_instagram": "150-300 ord, engagerande, med emoji (max 2 per mening)",
      "caption_tiktok": "50-100 ord, snabbt, Gen Z-vänligt",
      "caption_facebook": "100-200 ord, storytelling, community-ton",
      "hashtags": ["hemstädning", "städtips", "renthemma", "rutavdrag", "spick", "plus 5 till"],
      "image_description": "Detaljerad beskrivning för bildgenerering",
      "video_script": "Om video: steg-för-steg script med tidskoder, null om bild",
      "cta": "Boka hemstädning → spick.se",
      "best_format": "carousel|reel|single_image|story"
    }
  ]
}

REGLER:
- Alltid på svenska
- Nämn RUT-avdrag naturligt i minst 3 av 7 inlägg
- Nämn "175 kr/h" eller "från 175 kr/h" i prisinlägg
- Varje hook ska vara UNIK och specifik (aldrig generisk)
- CTA ska alltid inkludera spick.se
- Ingen AI-slang, ingen "corporate tone"
- Ton: Som en kompis som råkar vara expert på städning

Returnera BARA valid JSON, ingen annan text.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  
  // Parse JSON from response (handle potential markdown wrapping)
  const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(jsonStr);
}

// ── PUSH TO BUFFER ─────────────────────────────────────────
async function pushToBuffer(post, profileId) {
  if (!BUFFER_TOKEN) {
    console.log('  [DRY RUN] Would push to Buffer:', post.hook);
    return;
  }
  
  const text = `${post.hook}\n\n${post.caption_instagram}\n\n${post.hashtags.map(h => '#' + h).join(' ')}\n\n${post.cta}`;
  
  try {
    const r = await fetch('https://api.bufferapp.com/1/updates/create.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: BUFFER_TOKEN,
        profile_ids: profileId,
        text: text,
        draft: 'true', // Push as draft for review
      }),
    });
    const result = await r.json();
    console.log(`  ✅ Pushed to Buffer: "${post.hook}" (draft)`);
    return result;
  } catch (e) {
    console.error(`  ❌ Buffer error:`, e.message);
  }
}

// ── SAVE TO SUPABASE ───────────────────────────────────────
async function saveToSupabase(posts, ctx) {
  if (!SUPA_KEY) return;
  
  for (const post of posts) {
    try {
      await fetch(`${SUPA_URL}/rest/v1/content_queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
        },
        body: JSON.stringify({
          week: ctx.week,
          pillar: post.pillar,
          pillar_name: post.pillar_name,
          hook: post.hook,
          caption_instagram: post.caption_instagram,
          caption_tiktok: post.caption_tiktok,
          caption_facebook: post.caption_facebook,
          hashtags: post.hashtags,
          image_description: post.image_description,
          video_script: post.video_script,
          best_format: post.best_format,
          status: 'draft',
        }),
      });
    } catch (e) {
      console.warn('  Supabase save warning:', e.message);
    }
  }
  console.log(`  💾 Saved ${posts.length} posts to content_queue`);
}

// ── MAIN ───────────────────────────────────────────────────
async function main() {
  console.log('🚀 SPICK CONTENT ENGINE');
  console.log('═'.repeat(50));
  
  const ctx = getContext();
  console.log(`📅 Week ${ctx.week} | Month ${ctx.month} | ${ctx.date}`);
  console.log(`🎨 Theme: ${ctx.theme}`);
  
  // 1. Get past performance
  const perf = await getPerformanceData();
  if (perf) console.log(`📊 Loaded ${perf.length} performance records`);
  
  // 2. Generate content
  console.log('\n🤖 Generating 7 posts via Claude...');
  const content = await generateContent(ctx, perf);
  console.log(`✅ Generated ${content.posts.length} posts\n`);
  
  // 3. Display generated content
  for (const [i, post] of content.posts.entries()) {
    console.log(`[${i + 1}] ${post.pillar_name} | ${post.best_format}`);
    console.log(`    Hook: "${post.hook}"`);
    console.log(`    CTA: ${post.cta}`);
    console.log('');
  }
  
  // 4. Push to Buffer (as drafts)
  // Note: Buffer profile ID needs to be set — use Buffer API to get it
  // const BUFFER_PROFILE_ID = 'xxx'; 
  // for (const post of content.posts) {
  //   await pushToBuffer(post, BUFFER_PROFILE_ID);
  // }
  
  // 5. Save to Supabase
  await saveToSupabase(content.posts, ctx);
  
  console.log('═'.repeat(50));
  console.log('✅ Content engine complete');
}

main().catch(e => {
  console.error('❌ Content engine error:', e.message);
  process.exit(1);
});
