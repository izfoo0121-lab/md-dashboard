"""
Generate history.json from history.xlsx for GitHub Pages.
Run after save_history.py.
"""
import pandas as pd
import json
from pathlib import Path

BASE_DIR = Path(__file__).parent
HISTORY_XLSX = BASE_DIR / "history.xlsx"
HISTORY_JSON = BASE_DIR / "history.json"

if not HISTORY_XLSX.exists():
    print("history.xlsx not found")
    exit()

ef = pd.ExcelFile(HISTORY_XLSX)
df = pd.read_excel(HISTORY_XLSX, sheet_name="Monthly_Summary")
dt = pd.read_excel(HISTORY_XLSX, sheet_name="Team_Summary") if "Team_Summary" in ef.sheet_names else pd.DataFrame()

data = {
    "monthly": json.loads(df.to_json(orient="records", default_handler=str)),
    "team":    json.loads(dt.to_json(orient="records", default_handler=str)) if not dt.empty else [],
}

with open(HISTORY_JSON, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False)

print(f"✅ history.json saved — {HISTORY_JSON.stat().st_size//1024} KB")
