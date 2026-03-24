// Supabase Edge Function: notify
// Skickar e-post till kund och admin vid ny bokning
// Deploya: npx supabase functions deploy notify --project-ref urjeijcncsyuletprydy

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL = 'hello@spick.se'
const FROM_NAME = 'Spick'

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_NAME + ' <' + FROM_EMAIL + '>', to: [to], subject, html }),
  })
  return res.json()
}

serve(async (req) => {
  try {
    const payload = await req.json()
    const b = payload.record
    if (!b || !b.email) return new Response(JSON.stringify({ error: 'Ingen bokning' }), { status: 400 })

    const rutPris = b.rut ? Math.round((b.hours * 350) * 0.5) : b.hours * 350
    const totalPris = b.hours * 350

    const customerHtml = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px"><div style="background:#0F6E56;border-radius:16px;padding:32px;text-align:center;margin-bottom:32px"><h1 style="color:white;font-size:24px;margin:0">Bokning mottagen! ✅</h1></div><p>Hej ' + b.name + ',</p><p style="color:#6B6960">Vi återkommer med bekräftelse inom 2 timmar.</p><div style="background:#F7F7F5;border-radius:12px;padding:24px;margin:24px 0"><h3 style="color:#0F6E56;margin-top:0">Bokningsdetaljer</h3><table style="width:100%"><tr><td style="color:#6B6960">Tjänst</td><td><b>' + b.service + '</b></td></tr><tr><td style="color:#6B6960">Datum</td><td><b>' + b.date + ' kl ' + b.time + '</b></td></tr><tr><td style="color:#6B6960">Adress</td><td><b>' + b.address + '</b></td></tr><tr><td style="color:#6B6960">Pris</td><td><b>' + (b.rut ? rutPris + ' kr efter RUT (tot ' + totalPris + ' kr)' : totalPris + ' kr') + '</b></td></tr></table></div><p style="color:#6B6960;font-size:14px">Frågor? <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a></p></div>'

    const adminHtml = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2 style="color:#0F6E56">Ny bokning!</h2><table style="width:100%;background:#f9f9f9;padding:16px;border-radius:8px"><tr><td><b>Kund</b></td><td>' + b.name + '</td></tr><tr><td><b>E-post</b></td><td>' + b.email + '</td></tr><tr><td><b>Tel</b></td><td>' + b.phone + '</td></tr><tr><td><b>Tjänst</b></td><td>' + b.service + '</td></tr><tr><td><b>Datum</b></td><td>' + b.date + ' kl ' + b.time + '</td></tr><tr><td><b>Adress</b></td><td>' + b.address + ', ' + b.city + '</td></tr><tr><td><b>Timmar</b></td><td>' + b.hours + ' h</td></tr><tr><td><b>RUT</b></td><td>' + (b.rut ? 'Ja' : 'Nej') + '</td></tr></table><br><a href="https://taupe-snickerdoodle-35ebec.netlify.app/admin.html" style="background:#0F6E56;color:white;padding:10px 20px;border-radius:8px;text-decoration:none">Öppna admin-panelen</a></div>'

    const [c, a] = await Promise.all([
      sendEmail(b.email, 'Bokningsbekräftelse – ' + b.service + ' ' + b.date, customerHtml),
      sendEmail(FROM_EMAIL, 'Ny bokning: ' + b.name + ' – ' + b.service, adminHtml),
    ])

    return new Response(JSON.stringify({ success: true, customer: c, admin: a }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})