import os, json, urllib.request, urllib.error, sys, subprocess

TOKEN   = os.environ.get('SUPABASE_ACCESS_TOKEN', '')
DB_PASS = os.environ.get('SUPABASE_DB_PASSWORD', '')
PROJECT = "urjeijcncsyuletprydy"

# Försök 1: Supabase Management API
def try_management_api(label, sql):
    API = f"https://api.supabase.com/v1/projects/{PROJECT}/database/query"
    body = json.dumps({"query": sql}).encode('utf-8')
    req  = urllib.request.Request(API, body, {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type":  "application/json"
    }, method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        data = json.loads(resp.read().decode())
        print(f"✅ {label} via API klar!")
        return True
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"API HTTP {e.code}: {err[:300]}")
        if "already exists" in err or "42P07" in err or "42701" in err:
            print(f"⚠️  {label} redan körd - OK")
            return True
        return False
    except Exception as e:
        print(f"API-fel: {e}")
        return False

# Försök 2: psql via Supabase pooler
def try_psql(label, filepath):
    DB = f"postgresql://postgres.{PROJECT}:{DB_PASS}@aws-0-eu-north-1.pooler.supabase.com:6543/postgres"
    env = os.environ.copy()
    env['PGSSLMODE'] = 'require'
    r = subprocess.run(
        ['psql', DB, '-f', filepath, '-v', 'ON_ERROR_STOP=0'],
        capture_output=True, text=True, env=env, timeout=60
    )
    print(r.stdout[-500:] if r.stdout else "(ingen stdout)")
    if r.returncode == 0 or "already exists" in (r.stderr + r.stdout):
        print(f"✅ {label} via psql klar!")
        return True
    print(f"psql stderr: {r.stderr[-300:]}")
    return False

MIGRATIONS = [
    ("004_alias", "supabase/migrations/004_alias.sql"),
    ("005_data",  "supabase/migrations/005_data.sql"),
    ("006_keys",  "supabase/migrations/006_keys.sql"),
]

# Installera psql om det behövs
subprocess.run(['sudo','apt-get','install','-y','-q','postgresql-client'],
               capture_output=True)

for label, filepath in MIGRATIONS:
    print(f"\n{'='*40}\n▶ {label}")
    with open(filepath, 'r', encoding='utf-8') as f:
        sql = f.read()
    
    ok = try_management_api(label, sql)
    if not ok:
        print(f"  → Försöker psql...")
        ok = try_psql(label, filepath)
    if not ok:
        print(f"❌ {label} misslyckades på båda metoder!")
        sys.exit(1)

# Verifiera via API
print("\n▶ Verifierar...")
body = json.dumps({"query": "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('customer_profiles','analytics_events','key_methods','messages') ORDER BY table_name;"}).encode()
try:
    req  = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT}/database/query",
        body, {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}, method="POST")
    resp = urllib.request.urlopen(req, timeout=30)
    data = json.loads(resp.read().decode())
    for r in (data if isinstance(data, list) else []):
        print(f"  ✅ {r.get('table_name')}")
except Exception as e:
    print(f"Verifiering: {e}")

print("\n🎉 Alla migrationer klara!")
