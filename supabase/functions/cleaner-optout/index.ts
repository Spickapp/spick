import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return new Response('Saknar token', { status: 400 })
  }

  const { error } = await supabase
    .from('cleaners')
    .update({ is_active: false })
    .eq('auth_user_id', token)

  if (error) {
    return new Response('Fel: ' + error.message, { status: 500 })
  }

  return new Response(`
    <html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h2>Du har avregistrerats</h2>
      <p>Du får inga fler boknings-notiser från Spick.</p>
    </body></html>
  `, { headers: { 'Content-Type': 'text/html' } })
})
