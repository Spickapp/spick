#!/usr/bin/env python3
import os, json, urllib.request, urllib.error, subprocess, sys
from datetime import date, timedelta

SUPA_URL = os.environ.get('SUPA_URL', '')
SUPA_KEY = os.environ.get('SUPA_KEY', '')

if not SUPA_KEY:
    print("Saknar SUPABASE_ANON_KEY - hoppar over")
    sys.exit(0)

WEEK_AGO = (date.today() - timedelta(days=7)).isoformat()
TODAY    = date.today().isoformat()

def fetch(path):
    try:
        r = subprocess.run(
            ['curl', '-sf', '--max-time', '10',
             f"{SUPA_URL}/rest/v1/{path}",
             '-H', f'apikey: {SUPA_KEY}',
             '-H', f'Authorization: Bearer {SUPA_KEY}'],
            capture_output=True, text=True)
        return json.loads(r.stdout) if r.stdout else []
    except Exception as e:
        print(f"Fetch-fel: {e}")
        return []

bookings = fetch(f"bookings?created_at=gte.{WEEK_AGO}T00:00:00")
cleaners = fetch("cleaners?status=eq.godk%C3%A4nd")
reviews  = fetch(f"reviews?created_at=gte.{WEEK_AGO}T00:00:00")

b_count = len(bookings) if isinstance(bookings, list) else 0
c_count = len(cleaners) if isinstance(cleaners, list) else 0
r_count = len(reviews)  if isinstance(reviews, list) else 0
revenue = sum(float(b.get('total_price') or 0) * 0.17
              for b in (bookings if isinstance(bookings, list) else []))

print(f"Vecka {WEEK_AGO} till {TODAY}")
print(f"Bokningar: {b_count} | Stadare: {c_count} | Betyg: {r_count}")
print(f"Est. provision: {revenue:.0f} kr")

payload = json.dumps({"type": "weekly_report", "record": {
    "week": WEEK_AGO, "bookings": b_count,
    "cleaners": c_count, "reviews": r_count,
    "revenue": round(revenue)
}}).encode()

try:
    req = urllib.request.Request(
        f"{SUPA_URL}/functions/v1/notify", payload,
        {"Content-Type": "application/json",
         "Authorization": f"Bearer {SUPA_KEY}",
         "apikey": SUPA_KEY},
        method="POST")
    urllib.request.urlopen(req, timeout=15)
    print("Veckorapport skickad!")
except Exception as e:
    print(f"Notify-fel (icke-kritiskt): {e}")
