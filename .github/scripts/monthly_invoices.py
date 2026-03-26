#!/usr/bin/env python3
import os, json, urllib.request, urllib.error, subprocess, sys
from datetime import date, timedelta
from collections import defaultdict

SUPA_URL = os.environ.get('SUPA_URL', '')
SUPA_KEY = os.environ.get('SUPA_KEY', '')

if not SUPA_KEY:
    print("Saknar SUPABASE_ANON_KEY - hoppar over")
    sys.exit(0)

today = date.today()
if today.month == 1:
    first = date(today.year-1, 12, 1)
    last  = date(today.year, 1, 1) - timedelta(days=1)
else:
    first = date(today.year, today.month-1, 1)
    last  = date(today.year, today.month, 1) - timedelta(days=1)

month_str = first.strftime('%Y-%m')
print(f"Fakturor for {month_str} ({first} till {last})")

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

def post_data(path, body):
    try:
        data = json.dumps(body).encode()
        req  = urllib.request.Request(
            f"{SUPA_URL}/rest/v1/{path}", data,
            {"Content-Type": "application/json",
             "apikey": SUPA_KEY,
             "Authorization": f"Bearer {SUPA_KEY}",
             "Prefer": "return=minimal"},
            method="POST")
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:
        print(f"POST-fel ({path}): {e}")
        return False

bookings_klar = fetch(f"bookings?date=gte.{first}&date=lte.{last}&status=eq.klar&select=*")
bookings_paid = fetch(f"bookings?date=gte.{first}&date=lte.{last}&payment_status=eq.captured&select=*")
# Kombinera - klar eller captured
seen_ids = set()
bookings = []
for b in bookings_klar + bookings_paid:
    if isinstance(b, dict) and b.get('id') not in seen_ids:
        seen_ids.add(b.get('id'))
        bookings.append(b)
if not isinstance(bookings, list):
    bookings = []

print(f"Klara bokningar: {len(bookings)}")

by_cleaner = defaultdict(list)
for b in bookings:
    email = b.get('cleaner_email') or 'okand'
    by_cleaner[email].append(b)

total_provision = 0
for email, jobs in by_cleaner.items():
    revenue   = sum(float(j.get('total_price') or 0) for j in jobs)
    provision = round(revenue * 0.17)
    total_provision += provision
    print(f"  {email}: {len(jobs)} jobb, {revenue:.0f} kr, {provision} kr provision")
    post_data("invoices", {
        "cleaner_email": email,
        "period": month_str,
        "num_bookings": len(jobs),
        "gross_revenue": revenue,
        "provision_amount": provision,
        "status": "pending"
    })

print(f"Total provision: {total_provision} kr")

try:
    payload = json.dumps({"type": "weekly_report", "record": {
        "week": month_str, "bookings": len(bookings),
        "cleaners": len(by_cleaner), "revenue": total_provision
    }}).encode()
    req = urllib.request.Request(
        f"{SUPA_URL}/functions/v1/notify", payload,
        {"Content-Type": "application/json",
         "Authorization": f"Bearer {SUPA_KEY}",
         "apikey": SUPA_KEY},
        method="POST")
    urllib.request.urlopen(req, timeout=15)
    print("Manadsrapport skickad!")
except Exception as e:
    print(f"Notify-fel (icke-kritiskt): {e}")
