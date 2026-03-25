import json, os, urllib.request, subprocess
from datetime import date, timedelta

SUPA_URL = os.environ['SUPA_URL']
SUPA_KEY = os.environ['SUPA_KEY']
TOMORROW  = (date.today() + timedelta(days=1)).isoformat()
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()
print(f"Imorgon: {TOMORROW}, Igår: {YESTERDAY}")

def fetch(path):
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

def notify(payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{SUPA_URL}/functions/v1/notify", body,
        {'Content-Type':'application/json',
         'Authorization':f'Bearer {SUPA_KEY}',
         'apikey':SUPA_KEY}, method='POST')
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:
        print(f"  Notify-fel: {e}")
        return False

bookings = fetch(f"bookings?date=eq.{TOMORROW}&status=in.(bekr%C3%A4ftad,ny)&reminder_sent_at=is.null&select=*")
print(f"Påminnelser att skicka: {len(bookings)}")
for b in bookings:
    if notify({'type':'reminder','record':b}):
        print(f"  ✅ {b.get('email')}")

reviews = fetch(f"bookings?date=eq.{YESTERDAY}&status=eq.bekr%C3%A4ftad&review_sent_at=is.null&select=*")
print(f"Betygsförfrågningar: {len(reviews)}")
for b in reviews:
    if notify({'type':'review_request','record':b}):
        print(f"  ✅ {b.get('email')}")

print("✅ Daily automation klar!")
