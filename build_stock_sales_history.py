#!/usr/bin/env python3
"""
Build stock-monitor SKU sales history from the AutoCount MD Sales raw export.

This fills the stock page gap for 8COM and other stock-master SKUs that are not
included in dashboard_data.json debtor-card SKU breakdowns.

Usage:
  python build_stock_sales_history.py
  python build_stock_sales_history.py "C:\\Users\\tgy_3\\Downloads\\20260522 MD Sales Report raw XLSX 20260201-20260521.xlsx"

Output:
  stock_sales_history.json
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
DASHBOARD_DATA = BASE_DIR / "dashboard_data.json"
STOCK_HTML = BASE_DIR / "stock.html"
OUTPUT = BASE_DIR / "stock_sales_history.json"
DOWNLOADS = Path.home() / "Downloads"
LOCATION_AGENTS = {
    "Kelantan": ["YI", "KI-MI", "BEN", "JACKY"],
    "Pahang": ["LEON", "CJ", "KEE", "KW", "XIAN"],
    "Terengganu": ["KF", "JAMES", "NMK"],
}
AGENT_LOCATION = {agent: location for location, agents in LOCATION_AGENTS.items() for agent in agents}


def clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).upper()


def company_for_group(group: object) -> str:
    return "8COM" if clean_text(group) == "8COM" else "CCOM"


def month_rank(label: str) -> int:
    months = {m: i for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}
    parts = str(label or "").strip().split()
    if len(parts) != 2:
        return 0
    return (2000 + int(parts[1])) * 100 + months.get(parts[0], 0)


def load_master() -> dict[str, dict]:
    text = STOCK_HTML.read_text(encoding="utf-8")
    match = re.search(r"const DEFAULT_MASTER = `([\s\S]*?)`;", text)
    if not match:
        raise RuntimeError("Could not find DEFAULT_MASTER in stock.html")
    master: dict[str, dict] = {}
    block = match.group(1).replace("\\t", "\t")
    for line in block.splitlines()[1:]:
        parts = [part.strip() for part in line.split("\t")]
        if len(parts) < 3 or not parts[0]:
            continue
        try:
            master[clean_text(parts[0])] = {
                "sku": clean_text(parts[0]),
                "pktCtn": float(parts[1]),
                "mc": float(parts[2]),
            }
        except ValueError:
            continue
    return master


def latest_raw_sales_file() -> Path:
    candidates = sorted(
        DOWNLOADS.glob("*MD Sales Report raw XLSX*.xlsx"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    candidates = [p for p in candidates if not p.name.startswith("~$")]
    if not candidates:
        raise FileNotFoundError("No *MD Sales Report raw XLSX*.xlsx found in Downloads")
    return candidates[0]


def ensure_rec(container: dict, key: str, extra: dict | None = None) -> dict:
    rec = container.get(key)
    if rec is None:
        rec = {"monthly": {}, **(extra or {})}
        container[key] = rec
    return rec


def add_month(rec: dict, month: str, ctn: float) -> None:
    rec["monthly"][month] = rec["monthly"].get(month, 0.0) + ctn


def finalize(rec: dict, months: list[str], current: str, previous: str) -> None:
    total = sum(float(rec["monthly"].get(month, 0.0)) for month in months)
    rec["currentSalesCtn"] = round(float(rec["monthly"].get(current, 0.0)), 4)
    rec["previousSalesCtn"] = round(float(rec["monthly"].get(previous, 0.0)), 4)
    rec["avgSalesCtn"] = round(total / len(months), 4) if months else 0.0
    rec["hasSalesHistory"] = abs(total) > 0.0001
    rec["monthly"] = {month: round(float(rec["monthly"].get(month, 0.0)), 4) for month in months}


def build(source: Path) -> dict:
    dashboard = json.loads(DASHBOARD_DATA.read_text(encoding="utf-8"))
    active_agents = [clean_text(agent) for agent in dashboard.get("config", {}).get("active_agents", []) if agent]
    active_set = set(active_agents)
    master = load_master()

    df = pd.read_excel(source, dtype=object)
    required = ["Area Code", "Sales Agent", "Item Group", "Item Code", "Description", "Smallest Qty", "Paid On"]
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise RuntimeError(f"Missing columns in raw sales export: {missing}")

    for col in ["Area Code", "Sales Agent", "Item Group", "Item Code", "Description", "Paid On"]:
        df[col] = df[col].fillna("").astype(str).str.strip()
    df["Smallest Qty"] = pd.to_numeric(df["Smallest Qty"], errors="coerce").fillna(0)

    mask = (
        (df["Area Code"].str.upper() == "GRP 2A")
        & (df["Sales Agent"].str.upper().isin(active_set))
        & (df["Item Code"].str.upper().isin(master.keys()))
        & (df["Paid On"].str.match(r"^[A-Za-z]{3} \d{2}$", na=False))
    )
    scoped = df.loc[mask].copy()

    month_labels = sorted(scoped["Paid On"].dropna().unique().tolist(), key=month_rank)
    current = dashboard.get("current_month") if dashboard.get("current_month") in month_labels else (month_labels[-1] if month_labels else "")
    current_idx = month_labels.index(current) if current in month_labels else len(month_labels) - 1
    selected_months = month_labels[max(0, current_idx - 2) : current_idx + 1]
    previous = selected_months[-2] if len(selected_months) >= 2 else ""

    by_sku: dict[str, dict] = {}
    item_meta: dict[str, dict] = {}
    row_count = 0
    for _, row in scoped.iterrows():
        sku = clean_text(row["Item Code"])
        month = row["Paid On"].strip()
        agent = clean_text(row["Sales Agent"])
        if month not in selected_months or not sku or agent not in active_set:
            continue
        pkt_ctn = master.get(sku, {}).get("pktCtn") or 0
        if pkt_ctn <= 0:
            continue
        ctn = float(row["Smallest Qty"] or 0) / pkt_ctn
        if abs(ctn) <= 0.0001:
            continue
        sku_rec = ensure_rec(by_sku, sku, {"sku": sku, "locations": {}})
        add_month(sku_rec, month, ctn)
        row_count += 1
        meta = item_meta.setdefault(sku, {"sku": sku, "itemGroup": "", "description": ""})
        if not meta["itemGroup"]:
            meta["itemGroup"] = str(row["Item Group"]).strip()
        if not meta["description"]:
            meta["description"] = str(row["Description"]).strip()

        location = AGENT_LOCATION.get(agent)
        if location:
            locations = sku_rec["locations"]
            loc_rec = ensure_rec(locations, location, {"location": location, "agents": {}})
            add_month(loc_rec, month, ctn)
            agent_rec = ensure_rec(loc_rec["agents"], agent, {"agent": agent, "location": location})
            add_month(agent_rec, month, ctn)

    rows = []
    for sku, rec in sorted(by_sku.items()):
        finalize(rec, selected_months, current, previous)
        top_driver = None
        for loc_rec in rec["locations"].values():
            finalize(loc_rec, selected_months, current, previous)
            for agent_rec in loc_rec["agents"].values():
                finalize(agent_rec, selected_months, current, previous)
                if top_driver is None or agent_rec["avgSalesCtn"] > top_driver["avgSalesCtn"]:
                    top_driver = {
                        "location": agent_rec["location"],
                        "agent": agent_rec["agent"],
                        "avgSalesCtn": agent_rec["avgSalesCtn"],
                    }
        rec["topDriver"] = top_driver
        rec["itemGroup"] = item_meta.get(sku, {}).get("itemGroup", "")
        rec["company"] = company_for_group(rec["itemGroup"])
        rec["description"] = item_meta.get(sku, {}).get("description", "")
        rows.append(rec)

    mapped_agents = [agent for agent in active_agents if agent in AGENT_LOCATION]
    excluded_agents = [agent for agent in active_agents if agent not in AGENT_LOCATION]
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source_file": str(source),
        "current_month": current,
        "previous_month": previous,
        "months": selected_months,
        "active_agents": active_agents,
        "mapped_agents": mapped_agents,
        "excluded_agents": excluded_agents,
        "row_count": row_count,
        "sku_count": len(rows),
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build stock page SKU sales history from MD Sales raw export")
    parser.add_argument("source", nargs="?", type=Path, default=None, help="Raw MD Sales Report XLSX")
    parser.add_argument("--out", type=Path, default=OUTPUT, help="Output JSON path")
    args = parser.parse_args()

    source = (args.source or latest_raw_sales_file()).expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"Source file not found: {source}")
    payload = build(source)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Built {payload['sku_count']} SKU sales records from {payload['row_count']} rows")
    print(f"Output: {args.out}")


if __name__ == "__main__":
    main()
