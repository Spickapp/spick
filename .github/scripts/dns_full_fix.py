#!/usr/bin/env python3
"""
Komplett DNS-fix för spick.se
- Tar bort ALLA A-poster (oavsett IP)
- Tar bort wildcard-poster (• subdomain)  
- Lägger till korrekt GitHub Pages A-poster
- Behåller MX, NS, TXT, CNAME oförändrade
"""
import subprocess, sys, re

import os
U = os.environ.get("LOOPIA_USER", "spickdns@loopiaapi")
P = os.environ.get("LOOPIA_PASS", "SpickDNS2026!")
DOMAIN = "spick.se"
GITHUB_IPS = ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"]

def api(xml):
    r = subprocess.run(
        ["curl", "-sf", "-X", "POST", "https://api.loopia.se/RPCSERV",
         "-H", "Content-Type: text/xml", "--max-time", "15", "-d", xml],
        capture_output=True, text=True
    )
    return r.stdout

def get_records(subdomain=""):
    xml = f"""<?xml version='1.0'?><methodCall><methodName>getZoneRecords</methodName>
    <params>
      <param><value><string>{U}</string></value></param>
      <param><value><string>{P}</string></value></param>
      <param><value><string>{DOMAIN}</string></value></param>
      <param><value><string>{subdomain}</string></value></param>
    </params></methodCall>"""
    resp = api(xml)
    structs = re.findall(r'<struct>(.*?)</struct>', resp, re.DOTALL)
    records = []
    for s in structs:
        t  = re.search(r'<n>type</n>\s*<value><string>([^<]+)</string>', s)
        d  = re.search(r'<n>rdata</n>\s*<value><string>([^<]+)</string>', s)
        i  = re.search(r'<n>record_id</n>\s*<value><int>([^<]+)</int>', s)
        if t and d and i:
            records.append({'type': t.group(1), 'rdata': d.group(1), 'id': i.group(1)})
    return records

def remove_record(subdomain, record_id):
    xml = f"""<?xml version='1.0'?><methodCall><methodName>removeZoneRecord</methodName>
    <params>
      <param><value><string>{U}</string></value></param>
      <param><value><string>{P}</string></value></param>
      <param><value><string>{DOMAIN}</string></value></param>
      <param><value><string>{subdomain}</string></value></param>
      <param><value><int>{record_id}</int></value></param>
    </params></methodCall>"""
    resp = api(xml)
    return 'OK' in resp

def add_a(subdomain, ip, ttl=300):
    xml = f"""<?xml version='1.0'?><methodCall><methodName>addZoneRecord</methodName>
    <params>
      <param><value><string>{U}</string></value></param>
      <param><value><string>{P}</string></value></param>
      <param><value><string>{DOMAIN}</string></value></param>
      <param><value><string>{subdomain}</string></value></param>
      <param><value><struct>
        <member><n>type</n><value><string>A</string></value></member>
        <member><n>ttl</n><value><int>{ttl}</int></value></member>
        <member><n>priority</n><value><int>0</int></value></member>
        <member><n>rdata</n><value><string>{ip}</string></value></member>
      </struct></value></param>
    </params></methodCall>"""
    resp = api(xml)
    return 'OK' in resp

# ── STEG 1: Hämta alla records ────────────────────────
print("=== STEG 1: Nuvarande DNS-poster ===")

root_records = get_records("")
wildcard_records = get_records("*")

print(f"\n@ (root) - {len(root_records)} poster:")
for r in root_records:
    print(f"  {r['type']:6} id={r['id']:8} {r['rdata']}")

print(f"\n* (wildcard) - {len(wildcard_records)} poster:")
for r in wildcard_records:
    print(f"  {r['type']:6} id={r['id']:8} {r['rdata']}")

# ── STEG 2: Ta bort ALLA A-poster på @ ────────────────
print("\n=== STEG 2: Ta bort alla A-poster på @ ===")
for r in root_records:
    if r['type'] == 'A':
        result = remove_record("", r['id'])
        print(f"  {'✅' if result else '❌'} Tog bort A → {r['rdata']} (id={r['id']})")

# ── STEG 3: Ta bort ALLA poster på wildcard * ─────────
print("\n=== STEG 3: Ta bort wildcard * poster ===")
for r in wildcard_records:
    result = remove_record("*", r['id'])
    print(f"  {'✅' if result else '❌'} Tog bort {r['type']} → {r['rdata']} (id={r['id']})")

# ── STEG 4: Lägg till GitHub Pages A-poster ───────────
print("\n=== STEG 4: Lägg till GitHub Pages A-poster ===")
for ip in GITHUB_IPS:
    result = add_a("", ip)
    print(f"  {'✅' if result else '❌'} Lade till A → {ip}")

# ── STEG 5: Verifiera ─────────────────────────────────
import time
time.sleep(2)
print("\n=== STEG 5: Verifiering ===")
final = get_records("")
print(f"\n@ (root) efter fix - {len(final)} poster:")
for r in final:
    mark = "✅" if r['type'] != 'A' or r['rdata'] in GITHUB_IPS else "❌"
    print(f"  {mark} {r['type']:6} id={r['id']:8} {r['rdata']}")

a_records = [r for r in final if r['type'] == 'A']
correct = all(r['rdata'] in GITHUB_IPS for r in a_records)
print(f"\n{'✅ DNS korrekt! spick.se → GitHub Pages' if correct and len(a_records) == 4 else '⚠️  Kontrollera manuellt'}")
print("⏳ Propagering tar 5-30 min (TTL=300s)")
