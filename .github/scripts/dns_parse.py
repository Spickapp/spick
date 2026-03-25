#!/usr/bin/env python3
"""Parsar Loopia XML-svar och extraherar DNS-records"""
import sys, re

def parse_records(data):
    structs = re.findall(r'<struct>(.*?)</struct>', data, re.DOTALL)
    records = []
    for s in structs:
        t = re.search(r'<n>type</n>\s*<value><string>([^<]+)</string>', s)
        d = re.search(r'<n>rdata</n>\s*<value><string>([^<]+)</string>', s)
        i = re.search(r'<n>record_id</n>\s*<value><int>([^<]+)</int>', s)
        if t and d:
            records.append({
                'type': t.group(1),
                'rdata': d.group(1),
                'id': i.group(1) if i else None
            })
    return records

mode = sys.argv[1] if len(sys.argv) > 1 else 'list'
data = sys.stdin.read()
records = parse_records(data)

if mode == 'list':
    for r in records:
        print(f"  {r['type']:8} id={r['id'] or '?':6}  {r['rdata']}")
elif mode == 'a-ids':
    ids = [r['id'] for r in records if r['type'] == 'A' and r['id']]
    print(' '.join(ids))
elif mode == 'all-ids':
    ids = [r['id'] for r in records if r['id']]
    print(' '.join(ids))
