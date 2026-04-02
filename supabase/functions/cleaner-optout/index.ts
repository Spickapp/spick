import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from "../_shared/email.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return new Response('Saknar token', { status: 400 })
  }

  // Verify cleaner exists before updating
  const { data: cleaner } = await supabase
    .from('cleaners')
    .select('id, full_name')
    .eq('auth_user_id', token)
    .maybeSingle()

  if (!cleaner) {
    return new Response('Städare hittades inte', { status: 404 })
  }

  const { error } = await supabase
    .from('cleaners')
    .update({ status: 'inaktiv' })
    .eq('id', cleaner.id)

  if (error) {
    return new Response('Fel: ' + error.message, { status: 500 })
  }

  console.log(`Cleaner opt-out: ${cleaner.full_name} (${cleaner.id})`)

  return new Response(`
    <html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h2>Du har avregistrerats</h2>
      <p>Du får inga fler boknings-notiser från Spick.</p>
      <p style="margin-top:24px;color:#6B6960">Vill du komma tillbaka? Kontakta <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a></p>
    </body></html>
  `, { headers: { 'Content-Type': 'text/html' } })
})
