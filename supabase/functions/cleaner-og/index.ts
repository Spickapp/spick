import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function escOg(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 127) {
      out += '&#' + code + ';';
    } else if (s[i] === '&') out += '&amp;';
    else if (s[i] === '"') out += '&quot;';
    else if (s[i] === '<') out += '&lt;';
    else if (s[i] === '>') out += '&gt;';
    else out += s[i];
  }
  return out;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const slug = url.searchParams.get('s') || url.searchParams.get('slug')
    const id = url.searchParams.get('id')

    if (!slug && !id) {
      return Response.redirect('https://spick.se/boka.html', 302)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    let query = supabase
      .from('cleaners')
      .select('id,slug,full_name,city,bio,hourly_rate,avg_rating,review_count,services,avatar_url,identity_verified')
      .eq('is_approved', true)

    if (slug) query = query.eq('slug', slug)
    else query = query.eq('id', id)

    const { data, error } = await query.single()

    if (error || !data) {
      return Response.redirect('https://spick.se/boka.html', 302)
    }

    const c = data
    const firstName = (c.full_name || '').split(' ')[0]
    const rutPrice = Math.round((c.hourly_rate || 350) * 0.5)
    const profileUrl = 'https://spick.se/stadare-profil.html?' + (c.slug ? 's=' + c.slug : 'id=' + c.id)

    // Tjänster som text
    const services = Array.isArray(c.services)
      ? c.services.map((s: string) => s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]/gu, '').trim()).join(', ')
      : ''

    // OG-bild: städarens avatar eller generisk Spick-bild
    const ogImage = c.avatar_url || 'https://spick.se/assets/og-image.png'

    // Bygg titel och beskrivning
    const ogTitle = escOg(c.full_name + ' — Städare i ' + (c.city || 'Stockholm') + ' | Spick')
    const ogDesc = escOg('Boka ' + firstName + ' för ' + (services || 'städning').toLowerCase() + ' i ' + (c.city || 'Stockholm') + '. Från ' + rutPrice + ' kr/h med RUT-avdrag.' + (c.identity_verified ? ' ✓ ID-verifierad.' : ''))

    // Returnera HTML med OG-taggar + omdirigering
    const html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<title>${ogTitle}</title>
<meta name="description" content="${ogDesc}">
<meta property="og:type" content="profile">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="${c.avatar_url ? '500' : '1200'}">
<meta property="og:image:height" content="${c.avatar_url ? '500' : '630'}">
<meta property="og:url" content="${profileUrl}">
<meta property="og:site_name" content="Spick">
<meta name="twitter:card" content="summary${c.avatar_url ? '' : '_large_image'}">
<meta name="twitter:title" content="${ogTitle}">
<meta name="twitter:description" content="${ogDesc}">
<meta name="twitter:image" content="${ogImage}">
<meta http-equiv="refresh" content="0;url=${profileUrl}">
<link rel="canonical" href="${profileUrl}">
</head>
<body>
<p>Omdirigerar till <a href="${profileUrl}">${escOg(c.full_name)} p&#229; Spick</a>...</p>
</body>
</html>`

    return new Response(new TextEncoder().encode(html), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (e) {
    return Response.redirect('https://spick.se/boka.html', 302)
  }
})
