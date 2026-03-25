import os, sys, subprocess

DB_PASS = os.environ.get('SUPABASE_DB_PASSWORD', '')
PROJECT = "urjeijcncsyuletprydy"

subprocess.run(['sudo','apt-get','install','-y','-q','postgresql-client'],
               capture_output=True)

env = os.environ.copy()
env['PGSSLMODE'] = 'require'

# Slå upp IPv4-adressen explicit och använd den direkt
import socket
host = f"db.{PROJECT}.supabase.co"
ipv4 = socket.getaddrinfo(host, 5432, socket.AF_INET)[0][4][0]
print(f"IPv4: {ipv4}")

DB = f"postgresql://postgres:{DB_PASS}@{ipv4}:5432/postgres?sslmode=require"

def run_file(label, filepath):
    print(f"\n▶ {label}...")
    r = subprocess.run(
        ['psql', DB, '-f', filepath, '--set=ON_ERROR_STOP=0'],
        capture_output=True, text=True, env=env, timeout=60
    )
    out = r.stdout + r.stderr
    print(out[-800:])
    if r.returncode == 0 or any(x in out for x in ["already exists","42P07","42701","duplicate"]):
        print(f"✅ {label} klar!")
    else:
        print(f"❌ {label} misslyckades (exit {r.returncode})")
        sys.exit(1)

run_file("004_alias", "supabase/migrations/004_alias.sql")
run_file("005_data",  "supabase/migrations/005_data.sql")
run_file("006_keys",  "supabase/migrations/006_keys.sql")

print("\n▶ Verifierar tabeller...")
r = subprocess.run(['psql', DB, '-c',
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' "
    "AND table_name IN ('customer_profiles','analytics_events','key_methods','messages') "
    "ORDER BY table_name;"
], capture_output=True, text=True, env=env)
print(r.stdout)
print("\n🎉 Alla migrationer klara!")
 
