"""
weekly_report.py – Spick veckorapport
Skickas varje måndag kl 08:00. Innehåller:
- Veckans bokningar och omsättning
- Nya städare
- Kundbetyg
- Top städare
- Konvertering
- Åtgärdspunkter
"""
import json, os, subprocess, urllib.request
from datetime import date, timedelta

SUPA_URL   = os.environ['SUPA_URL']
SUPA_KEY   = os.environ['SUPA_KEY']
RESEND_KEY = os.environ.get('RESEND_API_KEY', '')
ADMIN      = "hello@spick.se"
FROM       = "Spick <hello@spick.se>"

WEEK_START = (date.today() - timedelta(days=7)).isoformat()
WEEK_END   = date.today().isoformat()
MONTH_START = date.today().replace(day=1).isoformat()

def supa_get(path):
    r = subprocess.run([
        'curl', '-sf', f"{SUPA_URL}/rest/v1/{path}",
        '-H', f'apikey: {SUPA_KEY}',
        '-H', f'Authorization: Bearer {SUPA_KEY}'
    ], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
        return d if isinstance(d, list) else []
    except:
        return []

def send_email(to, subject, html):
    if not RESEND_KEY: print(f"SKIP: {subject}"); return
    body = json.dumps({"from": FROM, "to": to, "subject": subject, "html": html}).encode()
    req = urllib.request.Request("https://api.resend.com/emails", body,
        {'Content-Type':'application/json','Authorization':f'Bearer {RESEND_KEY}'}, method='POST')
    try: urllib.request.urlopen(req, timeout=10); print(f"✅ {subject}")
    except Exception as e: print(f"❌ {e}")

def wrap(content):
    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{{margin:0;padding:0;background:#F7F7F5;font-family:Arial,sans-serif}}
.wrap{{max-width:620px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden}}
.header{{background:#0F6E56;padding:28px 32px}}.logo{{font-family:Georgia,serif;font-size:24px;font-weight:700;color:#fff}}
.sub{{color:rgba(255,255,255,.7);font-size:13px;margin-top:4px}}.body{{padding:32px}}
.footer{{padding:16px 32px;background:#F7F7F5;font-size:12px;color:#9E9E9A;text-align:center}}
h2{{font-family:Georgia,serif;font-size:20px;color:#1C1C1A;margin:0 0 16px}}
h3{{font-size:15px;color:#1C1C1A;margin:24px 0 8px}}
.kpi-grid{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:16px 0}}
.kpi{{background:#F7F7F5;border-radius:12px;padding:16px;text-align:center}}
.kpi-val{{font-size:28px;font-weight:700;color:#0F6E56;font-family:Georgia,serif}}
.kpi-lbl{{font-size:12px;color:#9E9E9A;margin-top:4px}}
.row{{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F0F0EC;font-size:14px}}
.row:last-child{{border:none}}.lbl{{color:#9B9B95}}.val{{font-weight:600;color:#1C1C1A}}
.bar{{background:#E8E8E4;border-radius:4px;height:8px;margin-top:4px}}
.bar-fill{{background:#0F6E56;border-radius:4px;height:8px}}
.alert{{background:#FFF5E5;border-left:4px solid #F59E0B;padding:12px 16px;border-radius:0 8px 8px 0;margin:8px 0;font-size:14px}}
.good{{background:#E1F5EE;border-left:4px solid #0F6E56;padding:12px 16px;border-radius:0 8px 8px 0;margin:8px 0;font-size:14px}}
.btn{{display:inline-block;background:#0F6E56;color:#fff;padding:10px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px}}
table{{width:100%;border-collapse:collapse;font-size:13px}}td,th{{padding:8px 12px;text-align:left;border-bottom:1px solid #F0F0EC}}
th{{background:#F7F7F5;font-weight:600;color:#6B6960}}
</style></head><body><div class="wrap">
<div class="header"><div class="logo">Spick</div><div class="sub">Veckorapport {WEEK_START} – {WEEK_END}</div></div>
<div class="body">{content}</div>
<div class="footer">Spick AB · hello@spick.se · <a href="https://spick.se/admin.html">Admin →</a></div>
</div></body></html>"""

# ── Hämta data ─────────────────────────────────────────────────
bookings     = supa_get(f"bookings?created_at=gte.{WEEK_START}T00:00:00&select=id,payment_status,total_price,service,city,rut,customer_email,date")
paid         = [b for b in bookings if b.get('payment_status') == 'paid']
revenue      = sum(b.get('total_price', 0) for b in paid)
rut_count    = sum(1 for b in paid if b.get('rut'))
conv_rate    = round(len(paid)/max(len(bookings),1)*100)

reviews      = supa_get(f"reviews?created_at=gte.{WEEK_START}T00:00:00&select=rating,comment,cleaner_id")
avg_rating   = round(sum(r.get('rating',5) for r in reviews)/max(len(reviews),1), 1) if reviews else 0

new_cleaners = supa_get(f"cleaners?created_at=gte.{WEEK_START}T00:00:00&select=id,full_name,city,avg_rating")
applications = supa_get(f"cleaner_applications?created_at=gte.{WEEK_START}T00:00:00&select=id,full_name,city,status")
pending_apps = [a for a in applications if a.get('status','pending') == 'pending']

# Månadsdata för jämförelse
month_bookings = supa_get(f"bookings?created_at=gte.{MONTH_START}T00:00:00&payment_status=eq.paid&select=total_price")
month_revenue  = sum(b.get('total_price', 0) for b in month_bookings)

# Tjänstefördelning
services = {}
for b in paid:
    s = b.get('service', 'Hemstädning')
    services[s] = services.get(s, 0) + 1
top_services = sorted(services.items(), key=lambda x: -x[1])[:5]

# Städer
cities = {}
for b in paid:
    c = b.get('city', 'Okänd')
    cities[c] = cities.get(c, 0) + 1
top_cities = sorted(cities.items(), key=lambda x: -x[1])[:5]

# ── Bygg rapport ───────────────────────────────────────────────
kpis = f"""
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-val">{len(paid)}</div><div class="kpi-lbl">Betalda bokningar</div></div>
  <div class="kpi"><div class="kpi-val">{int(revenue):,} kr</div><div class="kpi-lbl">Omsättning</div></div>
  <div class="kpi"><div class="kpi-val">{avg_rating}⭐</div><div class="kpi-lbl">Snittbetyg ({len(reviews)} st)</div></div>
</div>
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-val">{conv_rate}%</div><div class="kpi-lbl">Konvertering</div></div>
  <div class="kpi"><div class="kpi-val">{rut_count}</div><div class="kpi-lbl">RUT-bokningar</div></div>
  <div class="kpi"><div class="kpi-val">{len(new_cleaners)}</div><div class="kpi-lbl">Nya städare</div></div>
</div>"""

service_rows = "".join([
    f"<div class='row'><span class='lbl'>{s}</span><span class='val'>{c} st</span></div>"
    for s, c in top_services
])

city_rows = "".join([
    f"<div class='row'><span class='lbl'>{ci}</span><span class='val'>{co} st</span></div>"
    for ci, co in top_cities
])

# Varningar
alerts = ""
if conv_rate < 50:
    alerts += f"<div class='alert'>⚠️ Konvertering {conv_rate}% – under 50%. Kolla om checkout-flödet fungerar.</div>"
if avg_rating < 4.5 and len(reviews) > 0:
    alerts += f"<div class='alert'>⚠️ Snittbetyg {avg_rating}/5 – under målet 4.5. Granska negativa recensioner.</div>"
if pending_apps:
    alerts += f"<div class='alert'>📋 {len(pending_apps)} städaransökningar väntar på granskning.</div>"
if conv_rate >= 70:
    alerts += f"<div class='good'>🎉 Utmärkt konvertering {conv_rate}%!</div>"

cleaner_table = ""
if new_cleaners:
    rows = "".join([f"<tr><td>{c.get('full_name','')}</td><td>{c.get('city','')}</td><td>{c.get('avg_rating','-')}</td></tr>" for c in new_cleaners[:10]])
    cleaner_table = f"<h3>Nya städare ({len(new_cleaners)} st)</h3><table><tr><th>Namn</th><th>Stad</th><th>Betyg</th></tr>{rows}</table>"

review_table = ""
if reviews:
    top_reviews = [r for r in reviews if r.get('rating', 0) >= 4][:3]
    rows = "".join([f"<tr><td>{'⭐'*r.get('rating',5)}</td><td style='font-size:12px'>{r.get('comment','')[:80]}...</td></tr>" for r in top_reviews if r.get('comment')])
    if rows:
        review_table = f"<h3>Veckans bästa recensioner</h3><table><tr><th>Betyg</th><th>Kommentar</th></tr>{rows}</table>"

content = f"""
<h2>Veckans rapport 📊</h2>
{alerts}
{kpis}
<div style="background:#F7F7F5;border-radius:12px;padding:16px;margin:16px 0">
  <div class="row"><span class="lbl">Månadsintäkt hittills</span><span class="val">{int(month_revenue):,} kr</span></div>
  <div class="row"><span class="lbl">Ej betalda (leads)</span><span class="val">{len(bookings)-len(paid)} st</span></div>
  <div class="row"><span class="lbl">RUT-andel</span><span class="val">{round(rut_count/max(len(paid),1)*100)}%</span></div>
</div>
<h3>Populäraste tjänster</h3>
<div style="background:#F7F7F5;border-radius:12px;padding:16px">{service_rows}</div>
<h3>Populäraste städer</h3>
<div style="background:#F7F7F5;border-radius:12px;padding:16px">{city_rows}</div>
{cleaner_table}
{review_table}
<br><a href="https://spick.se/admin.html" class="btn">Öppna admin-panelen →</a>
"""

# Prenumerationer
active_subs = supa_get("subscriptions?status=eq.aktiv&select=id,customer_name,frequency,price")
sub_count = len(active_subs)
mrr_weekly = sum(b.get('price',0) for b in active_subs if b.get('frequency') in ['vecka','weekly'])
mrr_bi = sum(b.get('price',0)/2 for b in active_subs if b.get('frequency') in ['varannan_vecka','biweekly'])
mrr = mrr_weekly + mrr_bi

# Lägg till prenumerationsrad i rapporten
if sub_count:
    sub_row = f"""<div style="background:#F0FDF4;border-radius:12px;padding:14px;margin:12px 0;border:1.5px solid #86EFAC">
  <strong>🔄 Aktiva prenumerationer:</strong> {sub_count} st &nbsp;·&nbsp; 
  Beräknad vecko-MRR: <strong>{int(mrr):,} kr</strong>
</div>"""
    content = content.replace('<br><a href=', sub_row + '<br><a href=')

send_email(ADMIN, f"Spick veckorapport 📊 {len(paid)} bokningar · {int(revenue):,} kr", wrap(content))
print(f"✅ Veckorapport klar: {len(paid)} bokningar, {int(revenue)} kr, {sub_count} prenumerationer")
