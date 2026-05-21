"""
Upload debtor GPS locations from Excel to Supabase debtor_locations table.
Run once (or re-run to refresh): python upload_debtor_locations.py
"""
import pandas as pd, requests, json, sys, math

SUPABASE_URL = 'https://rqitgmydcbyiygqjssrb.supabase.co'
SUPABASE_KEY = 'sb_publishable_8xb7ZaHyr3OF3WNEqufuDg_67spOIFw'
TABLE = 'debtor_locations'
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates',
}

src = 'miracle debtor all active inactive.xlsx'
print(f"Reading: {src}")
df = pd.read_excel(src)


def clean(value):
    return str(value).strip() if pd.notna(value) else ''


records = []
skipped = 0
for _, row in df.iterrows():
    code = clean(row.get('Code'))
    coord = clean(row.get('Email Address'))
    if not code:
        skipped += 1
        continue
    if not coord or coord == 'nan':
        skipped += 1
        continue
    try:
        parts = coord.split(',')
        lat = float(parts[0].strip())
        lng = float(parts[1].strip())
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            skipped += 1
            continue
    except:
        skipped += 1
        continue

    records.append({
        'code':   code,
        'name':   clean(row.get('Company Name')),
        'phone':  clean(row.get('Phone 1')),
        'agent':  clean(row.get('Agent')).upper(),
        'day':    clean(row.get('Time')),
        'active': clean(row.get('Active')),
        'area':   clean(row.get('Area')),
        'lat':    lat,
        'lng':    lng,
    })

print(f"Valid: {len(records)}, Skipped (no coords): {skipped}")

# Upload in batches of 500
BATCH = 500
total_batches = math.ceil(len(records) / BATCH)
ok = 0
for i in range(total_batches):
    batch = records[i*BATCH:(i+1)*BATCH]
    r = requests.post(
        f'{SUPABASE_URL}/rest/v1/{TABLE}?on_conflict=code',
        headers=HEADERS,
        data=json.dumps(batch, ensure_ascii=False).encode('utf-8')
    )
    if r.status_code in (200, 201):
        ok += len(batch)
        print(f"  Batch {i+1}/{total_batches}: {len(batch)} rows OK")
    else:
        print(f"  Batch {i+1}/{total_batches}: ERROR {r.status_code} — {r.text[:300]}")
        if 'relation "debtor_locations" does not exist' in r.text or '42P01' in r.text:
            print("\n--- TABLE MISSING — run this SQL in Supabase SQL Editor first ---")
            print("""
CREATE TABLE IF NOT EXISTS debtor_locations (
  id      bigserial PRIMARY KEY,
  code    text,
  name    text,
  phone   text,
  agent   text,
  day     text,
  active  text,
  area    text,
  lat     double precision,
  lng     double precision,
  UNIQUE(code)
);
CREATE INDEX IF NOT EXISTS idx_dl_agent ON debtor_locations(agent);
CREATE INDEX IF NOT EXISTS idx_dl_day   ON debtor_locations(day);
            """)
            sys.exit(1)

print(f"\nDone. {ok}/{len(records)} rows uploaded to {TABLE}.")
