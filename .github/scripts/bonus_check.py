import json, os, urllib.request, urllib.error, subprocess

SUPA_URL = os.environ['SUPA_URL']
SUPA_KEY = os.environ['SUPA_KEY']

def fetch(path):
    r = subprocess.run([
        'curl', '-sf',
        f"{SUPA_URL}/rest/v1/{path}",
        '-H', f'apikey: {SUPA_KEY}',
        '-H', f'Authorization: Bearer {SUPA_KEY}'
    ], capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except Exception as e:
        print(f"JSON-fel: {e}, svar: {r.stdout[:200]}")
        return []

LEVELS = [('Platinum',301,4.9),('Guld',101,4.7),('Silver',21,4.5),('Brons',0,0.0)]

def get_level(jobs, rating):
    for name, mj, mr in LEVELS:
        if jobs >= mj and (rating >= mr or mr == 0.0):
            return name
    return 'Brons'

cleaners = fetch("cleaners?status=eq.godk%C3%A4nd&select=id,full_name,email,avg_rating,review_count,bonus_level")
if not isinstance(cleaners, list):
    print(f"Oväntat svar: {cleaners}")
    exit(0)

print(f"Antal städare: {len(cleaners)}")

for c in cleaners:
    jobs   = c.get('review_count', 0) or 0
    rating = float(c.get('avg_rating', 0) or 0)
    cur    = c.get('bonus_level', 'Brons') or 'Brons'
    new    = get_level(jobs, rating)
    if new != cur:
        body = json.dumps({'bonus_level': new}).encode()
        req  = urllib.request.Request(
            f"{SUPA_URL}/rest/v1/cleaners?id=eq.{c['id']}", body,
            {'Content-Type':'application/json',
             'Authorization':f'Bearer {SUPA_KEY}',
             'apikey':SUPA_KEY,
             'Prefer':'return=minimal'}, method='PATCH')
        try:
            urllib.request.urlopen(req, timeout=10)
            print(f"Uppgraderad {c['full_name']}: {cur} -> {new}")
            # Notifiera städaren via email
            emoji = {'Platinum':'💎','Guld':'🥇','Silver':'🥈'}.get(new, '🥉')
            bonus_body = json.dumps({"type": "cleaner_approved", "record": {
                "email": c['email'],
                "full_name": c['full_name'],
                "hourly_rate": 290,
                "bonus_upgrade": True,
                "bonus_level": new,
                "bonus_emoji": emoji
            }}).encode()
            bonus_req = urllib.request.Request(
                f"{SUPA_URL}/functions/v1/notify", bonus_body,
                {"Content-Type":"application/json","Authorization":f"Bearer {SUPA_KEY}","apikey":SUPA_KEY},
                method="POST")
            try: urllib.request.urlopen(bonus_req, timeout=10)
            except: pass
        except Exception as e:
            print(f"Fel: {e}")
    else:
        print(f"OK {c.get('full_name','?')}: {cur}")

print("✅ Bonus check klar!")
