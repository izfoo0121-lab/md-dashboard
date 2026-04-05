#!/usr/bin/env python3
"""
Quick diagnostic — shows unique paid_on values in MD Sales Report
Run: py check_paid_on.py
"""
import pandas as pd
from pathlib import Path

SALES_FILE = Path(__file__).parent / "MD Sales Report.xlsx"

df = pd.read_excel(
    SALES_FILE,
    sheet_name=0,
    header=1,
    usecols="A:Q",
    dtype=str,
    engine="openpyxl",
)

# Column Q = paid_on (index 16)
paid_col = df.columns[16]
print(f"paid_on column name: '{paid_col}'")
print()

vals = df[paid_col].fillna("").str.strip()
unique_vals = vals.value_counts()

print("All unique paid_on values (most frequent first):")
for val, count in unique_vals.items():
    print(f"  [{repr(val)}]  →  {count} rows")

print()
# Show a sample of March rows
mar_rows = df[vals.str.contains("Mar", case=False, na=False)]
print(f"Rows containing 'Mar': {len(mar_rows)}")
if not mar_rows.empty:
    print("Sample paid_on values for Mar rows:")
    print(mar_rows[paid_col].head(10).tolist())
