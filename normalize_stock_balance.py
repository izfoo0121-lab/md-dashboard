#!/usr/bin/env python3
"""
Normalize AutoCount Stock Balance exports for stock.html.

Current stock source:
  https://peb.connectscc.com/software/html5.html
  AutoCount > Stock > Stock Balance Report
  Export the report with Item Code and Smallest Bal. Qty.

Usage:
  python normalize_stock_balance.py "C:\\Users\\you\\Downloads\\Stock Balance.xlsx"

Outputs:
  reports/stock-daily/YYYY-MM-DD/autocount_stock_raw.<ext>
  reports/stock-daily/YYYY-MM-DD/stock_balance_normalized.csv
  reports/stock-daily/YYYY-MM-DD/stock_balance_normalized.json
  reports/stock-daily/latest_stock_balance.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Iterable

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_OUT_DIR = BASE_DIR / "reports" / "stock-daily"


ITEM_PATTERNS = (
    "itemcode",
    "stockitemcode",
    "stockcode",
    "item",
    "code",
    "sku",
)
QTY_PATTERNS = (
    "smallestbalqty",
    "smallestbalanceqty",
    "smallestqty",
    "smallestbalance",
    "stockqty",
    "balanceqty",
    "balqty",
    "onhandqty",
    "onhand",
    "qoh",
    "qty",
    "quantity",
)
DESC_PATTERNS = ("description", "desc", "itemdescription", "stockdescription")
GROUP_PATTERNS = ("itemgroup", "stockgroup", "group")
LOCATION_PATTERNS = ("location", "stocklocation", "loc")


def norm_header(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def clean_sku(value: object) -> str:
    text = str(value or "").strip()
    if not text or text.lower() in {"nan", "none"}:
        return ""
    return re.sub(r"\s+", " ", text).upper()


def parse_number(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and pd.notna(value):
        return float(value)
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "-"}:
        return None
    neg = text.startswith("(") and text.endswith(")")
    text = text.strip("()").replace(",", "")
    text = re.sub(r"[^0-9.\-]+", "", text)
    if text in {"", "-", ".", "-."}:
        return None
    try:
        num = float(text)
        return -num if neg else num
    except ValueError:
        return None


def find_col(headers: list[str], candidates: Iterable[str]) -> int:
    for candidate in candidates:
        for idx, header in enumerate(headers):
            if header == candidate:
                return idx
    for candidate in candidates:
        for idx, header in enumerate(headers):
            if candidate and candidate in header:
                return idx
    return -1


def read_raw_table(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xlsm", ".xls"}:
        return pd.read_excel(path, header=None, dtype=object)
    if suffix in {".csv", ".txt", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else ","
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.reader(f, delimiter=delimiter))
        width = max((len(row) for row in rows), default=0)
        padded = [row + [""] * (width - len(row)) for row in rows]
        return pd.DataFrame(padded, dtype=object)
    raise ValueError(f"Unsupported source file type: {suffix}")


def detect_header_row(raw: pd.DataFrame) -> tuple[int, list[str]]:
    max_scan = min(len(raw), 60)
    for row_idx in range(max_scan):
        values = raw.iloc[row_idx].tolist()
        headers = [norm_header(v) for v in values]
        item_idx = find_col(headers, ITEM_PATTERNS)
        qty_idx = find_col(headers, QTY_PATTERNS)
        if item_idx >= 0 and qty_idx >= 0:
            return row_idx, headers
    raise ValueError("Could not find AutoCount stock header row with Item Code and quantity columns")


def normalize(path: Path) -> dict:
    raw = read_raw_table(path)
    header_row, headers = detect_header_row(raw)
    body = raw.iloc[header_row + 1 :].reset_index(drop=True)

    item_idx = find_col(headers, ITEM_PATTERNS)
    qty_idx = find_col(headers, QTY_PATTERNS)
    desc_idx = find_col(headers, DESC_PATTERNS)
    group_idx = find_col(headers, GROUP_PATTERNS)
    location_idx = find_col(headers, LOCATION_PATTERNS)

    grouped: dict[str, dict] = {}
    by_location: dict[tuple[str, str], dict] = {}
    skipped = 0
    for _, row in body.iterrows():
        sku = clean_sku(row.iloc[item_idx] if item_idx < len(row) else "")
        qty = parse_number(row.iloc[qty_idx] if qty_idx < len(row) else None)
        location = clean_sku(row.iloc[location_idx] if location_idx >= 0 and location_idx < len(row) else "")
        if not sku:
            skipped += 1
            continue
        if qty is None:
            skipped += 1
            continue
        rec = grouped.setdefault(
            sku,
            {
                "sku": sku,
                "stockQty": 0.0,
                "description": "",
                "itemGroup": "",
            },
        )
        rec["stockQty"] += qty
        if location:
            loc_rec = by_location.setdefault(
                (sku, location),
                {
                    "sku": sku,
                    "location": location,
                    "stockQty": 0.0,
                },
            )
            loc_rec["stockQty"] += qty
        if desc_idx >= 0 and not rec["description"]:
            rec["description"] = str(row.iloc[desc_idx] or "").strip()
        if group_idx >= 0 and not rec["itemGroup"]:
            rec["itemGroup"] = str(row.iloc[group_idx] or "").strip()

    rows = sorted(grouped.values(), key=lambda r: r["sku"])
    for row in rows:
        row["stockQty"] = round(float(row["stockQty"]), 4)
    location_rows = sorted(by_location.values(), key=lambda r: (r["sku"], r["location"]))
    for row in location_rows:
        row["stockQty"] = round(float(row["stockQty"]), 4)

    return {
        "rows": rows,
        "location_rows": location_rows,
        "raw_row_count": int(max(0, len(body))),
        "normalized_row_count": len(rows),
        "location_row_count": len(location_rows),
        "skipped_row_count": skipped,
        "quantity_column": str(raw.iloc[header_row, qty_idx]),
        "item_column": str(raw.iloc[header_row, item_idx]),
        "location_column": str(raw.iloc[header_row, location_idx]) if location_idx >= 0 else "",
        "input_mode": "pkt",
    }


def write_outputs(source: Path, payload: dict, out_dir: Path, stock_date: str) -> Path:
    day_dir = out_dir / stock_date
    day_dir.mkdir(parents=True, exist_ok=True)

    raw_copy = day_dir / f"autocount_stock_raw{source.suffix.lower()}"
    if source.resolve() != raw_copy.resolve():
        shutil.copy2(source, raw_copy)

    csv_path = day_dir / "stock_balance_normalized.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["sku", "stockQty", "description", "itemGroup"])
        writer.writeheader()
        writer.writerows(payload["rows"])

    location_csv_path = day_dir / "stock_balance_by_location.csv"
    with location_csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["sku", "location", "stockQty"])
        writer.writeheader()
        writer.writerows(payload["location_rows"])

    payload = {
        **payload,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "stock_date": stock_date,
        "source_file": str(raw_copy.relative_to(BASE_DIR)) if raw_copy.is_relative_to(BASE_DIR) else str(raw_copy),
    }

    json_path = day_dir / "stock_balance_normalized.json"
    latest_path = out_dir / "latest_stock_balance.json"
    json_text = json.dumps(payload, indent=2, ensure_ascii=False)
    json_path.write_text(json_text, encoding="utf-8")
    latest_path.write_text(json_text, encoding="utf-8")
    return latest_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize AutoCount Stock Balance export for stock.html")
    parser.add_argument("source", type=Path, help="AutoCount stock balance export (.xlsx, .csv, .tsv)")
    parser.add_argument("--date", default=date.today().isoformat(), help="Stock date folder, YYYY-MM-DD")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="Output folder")
    args = parser.parse_args()

    source = args.source.expanduser().resolve()
    if not source.exists():
      raise SystemExit(f"Source file not found: {source}")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", args.date):
      raise SystemExit("--date must use YYYY-MM-DD")

    payload = normalize(source)
    latest_path = write_outputs(source, payload, args.out_dir.resolve(), args.date)
    print(f"Normalized {payload['raw_row_count']} rows -> {payload['normalized_row_count']} SKUs")
    print(f"Latest daily stock JSON: {latest_path}")


if __name__ == "__main__":
    main()
