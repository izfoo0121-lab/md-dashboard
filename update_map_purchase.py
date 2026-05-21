"""
Updates debtor_locations in Supabase with current-month purchase status.
Run after each process_data: python update_map_purchase.py
"""
import json, requests, math, sys, glob, os
sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = 'https://rqitgmydcbyiygqjssrb.supabase.co'
SUPABASE_KEY = 'sb_publishable_8xb7ZaHyr3OF3WNEqufuDg_67spOIFw'
TABLE = 'debtor_locations'
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates',
}

# Find latest monthly data file by modified time. Lexical sorting can pick the
# wrong month once filenames move beyond one naming pattern.
data_files = sorted(glob.glob('data_*.json'), key=os.path.getmtime, reverse=True)
if not data_files:
    print("No data_*.json found.")
    sys.exit(1)

src = data_files[0]
print(f"Reading: {src}")
with open(src, encoding='utf-8') as f:
    d = json.load(f)

print(f"Month: {d.get('current_month','?')}")

# Build lookup: debtor_code -> {ctn_cur, purchased}
lookup = {}
for agent_name, agent_data in d['agents'].items():
    for deb in agent_data.get('debtor_cards', {}).get('debtors', []):
        code = str(deb.get('debtor_code', '') or '').strip()
        if not code:
            continue
        ctn = float(deb.get('ctn_cur', 0) or 0)
        lookup[code] = {
            'code': code,
            'ctn_cur': ctn,
            'purchased': ctn > 0,
            'last_purchase': str(deb.get('last_purchase_date', '') or ''),
            'debtor_status': str(deb.get('status', '') or ''),
        }

print(f"Debtors with purchase data: {len(lookup)}")
purchased_count = sum(1 for v in lookup.values() if v['purchased'])
print(f"Purchased this month: {purchased_count} / {len(lookup)}")

LIMIT = 1000
BATCH = 500


def get_existing_mapped_codes():
    codes = set()
    offset = 0
    while True:
        r = requests.get(
            f'{SUPABASE_URL}/rest/v1/{TABLE}?select=code&lat=not.is.null&lng=not.is.null&limit={LIMIT}&offset={offset}',
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
            },
        )
        if r.status_code not in (200, 206):
            print(f"ERROR reading mapped debtor codes: {r.status_code} — {r.text[:300]}")
            sys.exit(1)
        rows = r.json()
        codes.update(str(row.get('code') or '').strip() for row in rows if row.get('code'))
        if len(rows) < LIMIT:
            break
        offset += LIMIT
    return codes


mapped_codes = get_existing_mapped_codes()
skipped_no_gps = sorted(set(lookup) - mapped_codes)
print(f"Mapped debtor rows with GPS: {len(mapped_codes)}")
print(f"Purchase rows skipped because no GPS row exists: {len(skipped_no_gps)}")

# Update every mapped debtor so old monthly purchase values are reset when a
# customer has no purchase row in the latest dashboard JSON.
records = []
for code in sorted(mapped_codes):
    records.append(lookup.get(code, {
        'code': code,
        'ctn_cur': 0,
        'purchased': False,
        'last_purchase': '',
        'debtor_status': '',
    }))

total_batches = math.ceil(len(records) / BATCH)
ok = 0

for i in range(total_batches):
    batch = records[i*BATCH:(i+1)*BATCH]
    r = requests.post(
        f'{SUPABASE_URL}/rest/v1/{TABLE}?on_conflict=code',
        headers=HEADERS,
        json=batch
    )
    if r.status_code in (200, 201):
        ok += len(batch)
        print(f"  Batch {i+1}/{total_batches}: {len(batch)} rows OK")
    else:
        print(f"  Batch {i+1}/{total_batches}: ERROR {r.status_code} — {r.text[:300]}")
        if 'column' in r.text and 'does not exist' in r.text:
            print("""
--- COLUMNS MISSING — run this SQL in Supabase SQL Editor first ---
ALTER TABLE debtor_locations
  ADD COLUMN IF NOT EXISTS ctn_cur double precision DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchased boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_purchase text,
  ADD COLUMN IF NOT EXISTS debtor_status text;
CREATE INDEX IF NOT EXISTS idx_dl_purchased ON debtor_locations(purchased);
""")
            sys.exit(1)

print(f"\nDone. {ok}/{len(records)} rows updated.")
