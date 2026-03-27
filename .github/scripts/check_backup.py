#!/usr/bin/env python3
import json, sys, os

backup_file = os.environ.get("BACKUP_FILE", "")
if not backup_file or not os.path.exists(backup_file):
    print(f"Fil hittades inte: {backup_file}")
    sys.exit(1)

with open(backup_file) as f:
    d = json.load(f)

if isinstance(d, list) and d:
    print("Exempel pa forsta posten:")
    first = d[0]
    for k, v in list(first.items())[:5]:
        print(f"  {k}: {str(v)[:50]}")
else:
    print("Tom eller ogiltig backup-fil")
