"""
daily_automation.py – Spick daglig automation
Kör 08:00 varje dag. Hanterar:
1. Bokningspåminnelse (24h innan)
2. Recensionsbegäran (dagen efter städning)
3. Win-back mail (30 dagar utan ny bokning)
4. Städare-påminnelse (uppdrag imorgon)
5. Förfallna bokningar (ej betalda > 2h)
6. Admin daglig rapport
"""
import json, os, sys, urllib.request, urllib.parse, subprocess
from datetime import date, timedelta, datetime

SUPA_URL   = os.environ['SUPA_URL']
SUPA_KEY   = os.environ['SUPA_KEY']
RESEND_KEY = os.environ.get('RESEND_API_KEY', '')
ADMIN      = "hello@spick.se"
FROM       = "Spick <hello@spick.se>"

TODAY     = date.today().isoformat()
TOMORROW  = (date.today() + timedelta(days=1)).isoformat()
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()
DAYS30AGO = (date.today() - timedelta(days=30)).isoformat()
DAYS31AGO = (date.today() - timedelta(days=31)).isoformat()

def supa_get(path):
    try:
        r = subprocess.run([
            'curl', '-sf', f"{SUPA_URL}/rest/v1/{path}",
            '-H', f'apikey: {SUPA_KEY}',
            '-H', f'Authorization: Bearer {SUPA_KEY}',
            '-H', 'Accept: application/json'
        ], capture_output=True, text=True, timeout=15)
        if not r.stdout.strip():
            print(f"  ⚠️ Tom svar från {path[:50]}")
            return []
        d = json.loads(r.stdout)
        if isinstance(d, dict) and d.get('code'):
            print(f"  ⚠️ Supabase fel: {d.get('message','')}")
            return []
        return d if isinstance(d, list) else []
    except Exception as e:
        print(f"  ⚠️ supa_get fel: {e}")
        return []

def supa_patch(table, filter_str, data):
    body = json.dumps(data).encode()
    r = subprocess.run([
        'curl', '-sf', '-X', 'PATCH',
        f"{SUPA_URL}/rest/v1/{table}?{filter_str}",
        '-H', f'apikey: {SUPA_KEY}',
        '-H', f'Authorization: Bearer {SUPA_KEY}',
        '-H', 'Content-Type: application/json',
        '-H', 'Prefer: return=minimal',
        '-d', body.decode()
    ], capture_output=True, text=True)
    return r.returncode == 0

def send_email(to, subject, html):
    if not RESEND_KEY:
        print(f"  [EMAIL SKIP – ingen nyckel] {to}: {subject}")
        return
    body = json.dumps({"from": FROM, "to": to, "subject": subject, "html": html}).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails", body,
        {'Content-Type': 'application/json', 'Authorization': f'Bearer {RESEND_KEY}'},
        method='POST'
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        print(f"  ✅ Email skickat: {to} – {subject}")
    except Exception as e:
        print(f"  ❌ Email fel: {e}")

def wrap(content):
    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{{margin:0;padding:0;background:#F7F7F5;font-family:'DM Sans',Arial,sans-serif}}
.wrap{{max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07)}}
.header{{background:#0F6E56;padding:24px 32px}}.logo{{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff}}
.body{{padding:32px}}.footer{{padding:16px 32px;background:#F7F7F5;font-size:12px;color:#9E9E9A;text-align:center}}
h2{{font-family:Georgia,serif;font-size:20px;color:#1C1C1A;margin:0 0 12px}}
p{{color:#6B6960;line-height:1.7;font-size:15px;margin:0 0 12px}}
.card{{background:#F7F7F5;border-radius:12px;padding:20px;margin:16px 0}}
.row{{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E8E8E4;font-size:14px}}
.row:last-child{{border:none}}.row .lbl{{color:#9B9B95}}.row .val{{font-weight:600;color:#1C1C1A}}
.btn{{display:inline-block;background:#0F6E56;color:#fff;padding:12px 28px;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px;margin-top:8px}}
.stars{{font-size:2rem;letter-spacing:4px;margin:16px 0}}
</style></head><body><div class="wrap">
<div class="header"><div class="logo">Spick</div></div>
<div class="body">{content}</div>
<div class="footer">Spick · 559402-4522 · hello@spick.se · <a href="https://spick.se">spick.se</a><br>
<a href="https://spick.se/integritetspolicy.html" style="color:#9E9E9A">Integritetspolicy</a> · 
<a href="https://spick.se/avtal.html" style="color:#9E9E9A">Villkor</a></div>
</div></body></html>"""

stats = {"reminders": 0, "reviews": 0, "winback": 0, "cleaner_reminders": 0, "expired": 0}

# ═══════════════════════════════════════════════════════════════
# 1. KUNDPÅMINNELSE – 24h innan städning
# ═══════════════════════════════════════════════════════════════
print("\n=== 1. Kundpåminnelser (imorgon) ===")
bookings_tomorrow = supa_get(
    f"bookings?date=eq.{TOMORROW}&payment_status=eq.paid&reminder_sent=is.null&select=id,customer_name,customer_email,date,time,service,address,hours,total_price,rut"
)
for b in bookings_tomorrow:
    price_display = f"{int(b.get('total_price',0))} kr" + (" (efter RUT)" if b.get('rut') else "")
    html = wrap(f"""
<h2>Påminnelse om din städning imorgon 🌿</h2>
<p>Hej {(b.get('customer_name') or '').split()[0] or 'där'}! En städare kommer imorgon – här är detaljerna.</p>
<div class="card">
  <div class="row"><span class="lbl">Datum</span><span class="val">{b.get('date','')}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">{b.get('time','09:00')}</span></div>
  <div class="row"><span class="lbl">Tjänst</span><span class="val">{b.get('service','Hemstädning')} · {b.get('hours',3)}h</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">{b.get('address','')}</span></div>
  <div class="row"><span class="lbl">Pris</span><span class="val">{price_display}</span></div>
</div>
<p>💡 <strong>Tips:</strong> Plocka undan lösa saker så kan städaren fokusera på rengöringen!</p>
<p>Om du behöver ändra eller avboka, hör av dig senast <strong>kl 20:00 ikväll</strong> till <a href="mailto:hello@spick.se">hello@spick.se</a>.</p>
<a href="https://spick.se/min-bokning.html?bid={b.get('id','')}" class="btn">Visa min bokning →</a>
""")
    send_email(b['customer_email'], "Påminnelse: Din städning imorgon 🌿", html)
    supa_patch("bookings", f"id=eq.{b['id']}", {"reminder_sent": TODAY})
    stats["reminders"] += 1

# ═══════════════════════════════════════════════════════════════
# 2. RECENSIONSBEGÄRAN – dagen efter städning
# ═══════════════════════════════════════════════════════════════
print("\n=== 2. Recensionsbegäran (igår) ===")
bookings_yesterday = supa_get(
    f"bookings?date=eq.{YESTERDAY}&payment_status=eq.paid&review_requested=is.null&select=id,customer_name,customer_email,service,cleaner_id"
)
for b in bookings_yesterday:
    name = b.get('customer_name','')
    fname = (name.split()[0] if name and name.strip() else 'där')
    html = wrap(f"""
<h2>Hur gick städningen? ⭐</h2>
<p>Hej {fname}! Vi hoppas att du är nöjd med din {b.get('service','städning').lower()} igår.</p>
<p>Din recension hjälper andra kunder att hitta rätt städare – och vi uppskattar din feedback enormt!</p>
<div class="stars">⭐⭐⭐⭐⭐</div>
<a href="https://spick.se/betygsatt.html?bid={b.get('id','')}" class="btn">Betygsätt städningen →</a>
<p style="margin-top:20px;font-size:13px;color:#9E9E9A">Tar bara 30 sekunder • Hjälper städaren att växa</p>
<hr style="border:none;border-top:1px solid #E8E8E4;margin:20px 0">
<p style="font-size:13px">Inte nöjd? Vi erbjuder <strong>gratis omstädning</strong> – svara på detta mail eller skriv till <a href="mailto:hello@spick.se">hello@spick.se</a></p>
""")
    send_email(b['customer_email'], "Hur gick städningen? Betygsätt din städare ⭐", html)
    supa_patch("bookings", f"id=eq.{b['id']}", {"review_requested": TODAY})
    stats["reviews"] += 1

# ═══════════════════════════════════════════════════════════════
# 3. WIN-BACK – kunder som inte bokat på 30 dagar
# ═══════════════════════════════════════════════════════════════
print("\n=== 3. Win-back (30 dagar inaktiva) ===")
# Hitta kunder med senaste bokning för 30-31 dagar sedan
winback_bookings = supa_get(
    f"bookings?date=gte.{DAYS31AGO}&date=lte.{DAYS30AGO}&payment_status=eq.paid&winback_sent=is.null&select=customer_name,customer_email,email,name"
)
seen = set()
for b in winback_bookings:
    em = b.get('customer_email','')
    if not em or em in seen:
        continue
    seen.add(em)
    fname = (b.get('customer_name') or b.get('name') or '').split()[0] or 'där'
    html = wrap(f"""
<h2>Vi saknar dig, {fname}! 🌿</h2>
<p>Det har gått ett tag sedan din senaste städning. Dags att ta hand om hemmet igen?</p>
<div class="card">
  <p style="margin:0;font-size:15px;font-weight:600;color:#0F6E56">🎁 10% rabatt på din nästa bokning</p>
  <p style="margin:8px 0 0;font-size:13px;color:#6B6960">Använd koden <strong>VÄLKOMMEN10</strong> vid bokning – gäller 7 dagar</p>
</div>
<p>Hundratals nöjda kunder i din stad – BankID-verifierade städare, 100% nöjdhetsgaranti.</p>
<a href="https://spick.se/boka.html" class="btn">Boka städning nu →</a>
""")
    send_email(em, f"Vi saknar dig, {fname}! 🌿 Här är 10% rabatt", html)
    supa_patch("bookings", f"customer_email=eq.{urllib.parse.quote(em)}&date=eq.{DAYS30AGO}", {"winback_sent": TODAY})
    stats["winback"] += 1

# ═══════════════════════════════════════════════════════════════
# 4. STÄDARE-PÅMINNELSE – uppdrag imorgon
# ═══════════════════════════════════════════════════════════════
print("\n=== 4. Städare-påminnelse (uppdrag imorgon) ===")
cleaner_jobs = supa_get(
    f"bookings?date=eq.{TOMORROW}&payment_status=eq.paid&cleaner_id=not.is.null&cleaner_reminded=is.null&select=id,date,time,service,address,hours,cleaner_id,total_price"
)
# Hämta städare för varje bokning
for b in cleaner_jobs:
    cleaners = supa_get(f"cleaners?id=eq.{b['cleaner_id']}&select=full_name,email")
    if not cleaners:
        continue
    c = cleaners[0]
    earning = int(b.get('total_price', 0) * 0.83)
    html = wrap(f"""
<h2>Påminnelse: Du har ett uppdrag imorgon 🧹</h2>
<p>Hej {c.get('full_name','').split()[0]}! En kund väntar på dig imorgon.</p>
<div class="card">
  <div class="row"><span class="lbl">Datum</span><span class="val">{b.get('date','')}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">{b.get('time','09:00')}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">{b.get('address','')}</span></div>
  <div class="row"><span class="lbl">Tjänst</span><span class="val">{b.get('service','Hemstädning')} · {b.get('hours',3)}h</span></div>
  <div class="row"><span class="lbl">Din intjäning</span><span class="val" style="color:#0F6E56">{earning} kr</span></div>
</div>
<p>✅ Ta med all utrustning<br>✅ Var i tid – kunden förväntar sig dig<br>✅ Markera jobbet som klart i appen efter</p>
<a href="https://spick.se/stadare-dashboard.html" class="btn">Öppna städardashboard →</a>
""")
    send_email(c['email'], f"Påminnelse: Städning imorgon kl {b.get('time','09:00')} 🧹", html)
    supa_patch("bookings", f"id=eq.{b['id']}", {"cleaner_reminded": TODAY})
    stats["cleaner_reminders"] += 1

# ═══════════════════════════════════════════════════════════════
# 5. FÖRFALLNA BOKNINGAR – ej betalda > 2 timmar
# ═══════════════════════════════════════════════════════════════
print("\n=== 5. Förfallna bokningar ===")
# Sätt bokningar skapade igår eller tidigare med pending-status till expired
expired_result = subprocess.run([
    'curl', '-sf', '-X', 'PATCH',
    f"{SUPA_URL}/rest/v1/bookings?payment_status=eq.pending&created_at=lt.{TODAY}T00:00:00",
    '-H', f'apikey: {SUPA_KEY}',
    '-H', f'Authorization: Bearer {SUPA_KEY}',
    '-H', 'Content-Type: application/json',
    '-H', 'Prefer: return=representation',
    '-d', json.dumps({"payment_status": "expired"})
], capture_output=True, text=True)
try:
    expired = json.loads(expired_result.stdout)
    stats["expired"] = len(expired) if isinstance(expired, list) else 0
    print(f"  {stats['expired']} bokningar markerade som expired")
except:
    pass

# ═══════════════════════════════════════════════════════════════
# 6. ADMIN DAGLIG RAPPORT
# ═══════════════════════════════════════════════════════════════
print("\n=== 6. Admin daglig rapport ===")
todays_bookings = supa_get(f"bookings?date=eq.{TODAY}&select=id,service,total_price,payment_status,customer_name,address")
# Veckans bokningar för trendvisning
week_ago = (date.today() - timedelta(days=7)).isoformat()
week_bookings = supa_get(f"bookings?date=gte.{week_ago}&payment_status=eq.paid&select=id,total_price")
week_revenue = sum(b.get('total_price', 0) for b in week_bookings)
# Aktiva prenumerationer
active_subs = supa_get(f"subscriptions?status=eq.aktiv&select=id,customer_name,frequency")
paid_today = [b for b in todays_bookings if b.get('payment_status') == 'paid']
revenue_today = sum(b.get('total_price', 0) for b in paid_today)

new_applications = supa_get(f"cleaner_applications?created_at=gte.{TODAY}T00:00:00&select=id,name,city")

if paid_today or new_applications:
    jobs_html = "".join([
        f"<div class='row'><span class='lbl'>{b.get('customer_name','')}</span><span class='val'>{b.get('service','')} · {int(b.get('total_price',0))} kr</span></div>"
        for b in paid_today
    ])
    apps_html = "".join([
        f"<li>{a.get('name','')} – {a.get('city','')}</li>"
        for a in new_applications
    ])
    html = wrap(f"""
<h2>Daglig rapport – {TODAY} 📊</h2>
<div class="card">
  <div class="row"><span class="lbl">Städningar idag</span><span class="val">{len(paid_today)} st</span></div>
  <div class="row"><span class="lbl">Omsättning</span><span class="val">{int(revenue_today)} kr</span></div>
  <div class="row"><span class="lbl">Nya ansökningar</span><span class="val">{len(new_applications)} st</span></div>
  <div class="row"><span class="lbl">Påminnelser skickade</span><span class="val">{stats['reminders']}</span></div>
  <div class="row"><span class="lbl">Veckomsättning</span><span class="val">{int(week_revenue)} kr</span></div>
  <div class="row"><span class="lbl">Aktiva prenumerationer</span><span class="val">{len(active_subs)} st</span></div>
  <div class="row"><span class="lbl">Recensionsbegäran</span><span class="val">{stats['reviews']}</span></div>
  <div class="row"><span class="lbl">Win-back mail</span><span class="val">{stats['winback']}</span></div>
</div>
{f"<h3>Dagens städningar</h3><div class='card'>{jobs_html}</div>" if jobs_html else ""}
{f"<h3>Nya städaransökningar</h3><ul style='color:#6B6960'>{apps_html}</ul><a href='https://spick.se/admin.html' class='btn'>Granska ansökningar →</a>" if apps_html else ""}
""")
    send_email(ADMIN, f"Spick daglig rapport {TODAY} – {len(paid_today)} städningar", html)

print(f"\n✅ Klar! {stats}")

import sys
sys.exit(0)
