# SPICK CONTENT ENGINE — Autonom marknadsföringsmaskin

## Systemöversikt

Helautomatiserat content-system som genererar, schemalägger och publicerar
inlägg på Instagram, Facebook och TikTok — dagligen, utan manuell input.

### Teknisk stack
- **AI:** Claude Sonnet via Anthropic API (content-generering)
- **Scheduling:** Buffer API + MCP (schemaläggning + publicering)
- **Data:** Supabase (statistik, reviews, performance-tracking)
- **Trigger:** GitHub Actions cron (dagligen 09:00 svensk tid)
- **Notiser:** Resend (admin-preview varje morgon)
- **Tracking:** Facebook Pixel (56 sidor), UTM-parametrar

### Flöde
```
GitHub Actions (07:00 UTC) → Edge Function → Stats från Supabase →
Claude API genererar content → Buffer schemalägger → Auto-publicering →
Veckovis feedback-analys → Justerad strategi
```

## 5 Content Pillars

| Pillar | Andel | Syfte | Format |
|--------|-------|-------|--------|
| 🏠 Städtips & Lifehacks | 30% | Auktoritet, sparningar/delningar | Carousel, korta videor |
| ✨ Transformationer | 25% | Visuellt tillfredsställande, viral potential | Before/after, timelapse |
| 🤝 Trust & Transparens | 20% | Förtroende, minska köpbarriärer | Testimonials, fakta |
| 💰 RUT & Ekonomi | 15% | Utbilda om RUT, visa prisfördelar | Beräkningar, infografik |
| 👋 Bakom Kulisserna | 10% | Humanisera varumärket | Stories, team, grundarhistoria |

## Postningsschema (7 inlägg/vecka)

| Dag | Pillar | Instagram | Facebook | TikTok |
|-----|--------|-----------|----------|--------|
| Mån | 🏠 Tips | Feed 12:00 | Text+bild 09:00 | — |
| Tis | ✨ Transform | Reel 18:00 | — | Video 18:00 |
| Ons | 🤝 Trust | Feed 17:00 | Text+länk 12:00 | — |
| Tor | 💰 RUT | Reel 12:00 | — | Video 18:00 |
| Fre | 🏠 Tips | Feed 12:00 | Text+bild 15:00 | — |
| Lör | ✨ Transform | Reel 09:00 | — | Video 18:00 |
| Sön | 👋 BTS | Stories | — | Video 12:00 |

## Filer
- Edge Function: `supabase/functions/social-media/index.ts`
- Workflow: `.github/workflows/social-media.yml`
- Dashboard: `spick-content-engine.jsx` (interaktiv React)

## Tillväxtmål

| KPI | 3 mån | 6 mån | 12 mån |
|-----|-------|-------|--------|
| IG följare | 500 | 2 000 | 8 000 |
| Leads/mån | 10 | 50 | 200 |
| Trafik från social | 100 | 500 | 2 000 |
