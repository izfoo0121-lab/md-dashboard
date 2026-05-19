from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import json
import re

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
SALES_XLSX = ROOT / "MD Sales Report.xlsx"
DEBTOR_XLSX = ROOT / "Debtor Maintenance.xlsx"
INDEX_HTML = Path(__file__).with_name("index.html")
DEBTOR_STATUS_JS = Path(__file__).with_name("debtor_status.js")
AGENT_MONTHLY_JS = Path(__file__).with_name("agent_monthly_revenue.js")

STATE_MAP = {
    "Terengganu": ["KF", "JAMES", "NMK"],
    "Kelantan": ["YI", "KI-MI", "BEN", "JACKY"],
    "Pahang": ["LEON", "CJ", "KEE", "KW", "XIAN"],
}
AGENT_STATE = {agent: state for state, agents in STATE_MAP.items() for agent in agents}
MIRACLE_AGENTS = set(AGENT_STATE)


def money(value):
    return int(round(float(value or 0)))


def qty(value):
    return round(float(value or 0), 2)


def load_sales():
    df = pd.read_excel(SALES_XLSX, sheet_name=0)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.rename(columns={
        "Doc. No.": "doc_no",
        "Date": "date",
        "Debtor Code": "debtor_code",
        "Company Name": "company_name",
        "Sales Agent": "agent",
        "Area Code": "area_code",
        "Item Code": "sku",
        "Item Description": "desc",
        "Local SubTotal": "sales",
        "QTY (CTN)": "qty_ctn",
    })
    df["agent"] = df["agent"].astype(str).str.upper().str.strip()
    df = df[df["agent"].isin(MIRACLE_AGENTS)].copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["debtor_code"] = df["debtor_code"].astype(str).str.strip()
    df["sku"] = df["sku"].astype(str).str.strip()
    df["desc"] = df["desc"].astype(str).str.strip()
    df["sales"] = pd.to_numeric(df["sales"], errors="coerce").fillna(0)
    df["qty_ctn"] = pd.to_numeric(df["qty_ctn"], errors="coerce").fillna(0)
    df["state"] = df["agent"].map(AGENT_STATE)
    return df[df["date"].notna()].copy()


def load_debtors():
    df = pd.read_excel(DEBTOR_XLSX, sheet_name=0)
    df.columns = [str(c).strip() for c in df.columns]
    debtors = {}
    for _, row in df.iterrows():
        code = str(row.get("Code") or "").strip()
        if not code:
            continue
        active = str(row.get("Active") or "").strip()
        debtors[code] = {
            "name": str(row.get("Company Name") or "").strip(),
            "type": str(row.get("Debtor Type") or "").strip(),
            "agent": str(row.get("Agent") or "").strip(),
            "status": "Active" if active.lower() == "checked" else "Inactive",
        }
    return debtors


def period_frame(df, period):
    if period == "all":
        return df.copy()
    return df[df["period_key"] == period].copy()


def month_label(period_key):
    return pd.Timestamp(period_key + "-01").strftime("%b %Y")


def build_strength(df):
    data = {}
    periods = sorted(df["period_key"].dropna().unique())
    period_labels = [(period, month_label(period)) for period in periods]
    period_labels.append(("all", f"{month_label(periods[0])}-{month_label(periods[-1])}" if periods else "All months"))
    for period, label in period_labels:
        view = period_frame(df, period)
        states = []
        state_skus = []
        agents = []
        for state in STATE_MAP:
            srows = view[view["state"] == state]
            if srows.empty:
                continue
            total_sales = float(srows["sales"].sum())
            states.append({
                "state": state,
                "sales": money(total_sales),
                "qty": qty(srows["qty_ctn"].sum()),
                "customers": int(srows["debtor_code"].nunique()),
                "docs": int(srows["doc_no"].nunique()),
            })
            sku_rows = (
                srows.groupby(["sku", "desc"], dropna=False)
                .agg(sales=("sales", "sum"), qty=("qty_ctn", "sum"), customers=("debtor_code", "nunique"))
                .reset_index()
                .sort_values("sales", ascending=False)
                .head(5)
            )
            for rank, row in enumerate(sku_rows.itertuples(index=False), start=1):
                state_skus.append([
                    state, rank, row.sku, row.desc, money(row.sales), qty(row.qty),
                    int(row.customers), round(float(row.sales) / total_sales * 100, 1) if total_sales else 0,
                ])

        for state, state_agents in STATE_MAP.items():
            for agent in state_agents:
                arows = view[view["agent"] == agent]
                if arows.empty:
                    continue
                total_sales = float(arows["sales"].sum())
                sku_rows = (
                    arows.groupby(["sku", "desc"], dropna=False)
                    .agg(sales=("sales", "sum"), qty=("qty_ctn", "sum"), customers=("debtor_code", "nunique"))
                    .reset_index()
                    .sort_values("sales", ascending=False)
                    .head(3)
                )
                skus = [
                    [row.sku, row.desc, money(row.sales), qty(row.qty), int(row.customers),
                     round(float(row.sales) / total_sales * 100, 1) if total_sales else 0]
                    for row in sku_rows.itertuples(index=False)
                ]
                agents.append([state, agent, skus])

        data[period] = {
            "label": label,
            "states": sorted(states, key=lambda x: x["sales"], reverse=True),
            "stateSkus": state_skus,
            "agents": agents,
        }
    return data


def build_debtor_status(df, debtors):
    result = {}
    periods = list(sorted(df["period_key"].dropna().unique())) + ["all"]
    for period in periods:
        view = period_frame(df, period)
        state_summary = defaultdict(lambda: {"total": set(), "active": set(), "inactive": set(), "missing": set(), "sales": 0.0})
        agent_summary = defaultdict(lambda: {"total": set(), "active": set(), "inactive": set(), "missing": set(), "sales": 0.0})
        watchlist = []

        grouped = view.groupby(["state", "agent", "debtor_code"], dropna=False)
        for (state, agent, code), rows in grouped:
            debtor = debtors.get(code)
            status = debtor["status"] if debtor else "Missing"
            sales = float(rows["sales"].sum())
            for bucket in (state_summary[state], agent_summary[(state, agent)]):
                bucket["total"].add(code)
                bucket["sales"] += sales
                bucket[status.lower() if status in ("Active", "Inactive") else "missing"].add(code)
            if status != "Active":
                sku_sales = rows.groupby("sku")["sales"].sum().sort_values(ascending=False)
                watchlist.append({
                    "state": state,
                    "agent": agent,
                    "code": code,
                    "name": debtor["name"] if debtor else "",
                    "maintAgent": debtor["agent"] if debtor else "",
                    "maintType": debtor["type"] if debtor else "",
                    "status": status,
                    "sales": round(sales, 2),
                    "qty": qty(rows["qty_ctn"].sum()),
                    "docs": int(rows["doc_no"].nunique()),
                    "topSku": str(sku_sales.index[0]) if len(sku_sales) else "",
                    "lastDate": rows["date"].max().date().isoformat(),
                })

        def pack_state():
            return [
                {
                    "state": state,
                    "total": len(bucket["total"]),
                    "active": len(bucket["active"]),
                    "inactive": len(bucket["inactive"]),
                    "missing": len(bucket["missing"]),
                    "activeRate": round((len(bucket["active"]) / len(bucket["total"]) * 100) if bucket["total"] else 0, 1),
                    "sales": round(bucket["sales"], 2),
                }
                for state, bucket in sorted(state_summary.items(), key=lambda item: item[1]["sales"], reverse=True)
            ]

        def pack_agent():
            return [
                {
                    "state": state,
                    "agent": agent,
                    "total": len(bucket["total"]),
                    "active": len(bucket["active"]),
                    "inactive": len(bucket["inactive"]),
                    "missing": len(bucket["missing"]),
                    "activeRate": round((len(bucket["active"]) / len(bucket["total"]) * 100) if bucket["total"] else 0, 1),
                    "sales": round(bucket["sales"], 2),
                }
                for (state, agent), bucket in sorted(agent_summary.items())
            ]

        result[period] = {
            "stateStatus": pack_state(),
            "agentStatus": pack_agent(),
            "watchlist": sorted(watchlist, key=lambda row: row["sales"], reverse=True)[:80],
        }
    return result


def build_monthly(df):
    rows = df.copy()
    rows["month"] = rows["date"].dt.strftime("%Y-%m")
    months = sorted(rows["month"].unique())
    state_months = rows.groupby(["state", "month"])["sales"].sum()
    agent_months = rows.groupby(["state", "agent", "month"])["sales"].sum()
    return {
        "months": months,
        "states": [
            {
                "state": state,
                "months": {month: round(float(state_months.get((state, month), 0)), 2) for month in months},
                "total": round(float(sum(state_months.get((state, month), 0) for month in months)), 2),
            }
            for state in sorted(rows["state"].dropna().unique())
        ],
        "agents": [
            {
                "state": state,
                "agent": agent,
                "months": {month: round(float(agent_months.get((state, agent, month), 0)), 2) for month in months},
                "total": round(float(sum(agent_months.get((state, agent, month), 0) for month in months)), 2),
            }
            for state, agent in sorted(rows[["state", "agent"]].drop_duplicates().itertuples(index=False, name=None))
        ],
    }


def replace_index_data(data):
    text = INDEX_HTML.read_text(encoding="utf-8")
    replacement = "const data = " + json.dumps(data, ensure_ascii=False, indent=6) + ";"
    text = re.sub(r"const data = \{.*?\};\s*(?=\n\s*const fmt)", replacement + "\n", text, flags=re.S)
    latest = next((key for key in reversed(list(data.keys())) if key != "all"), "all")
    text = re.sub(r'let currentPeriod = "[^"]+";', f'let currentPeriod = "{latest}";', text)
    text = re.sub(
        r"Current view defaults to .*? all-month view covers .*?\.",
        "Use the month selector to inspect any available month, or choose All months for the full workbook range.",
        text,
    )
    text = text.replace(
        "Source workbook: C:\\Users\\tgy_3\\Downloads\\20260519 MD Sales Report.xlsx.",
        "Source workbook: C:\\Users\\tgy_3\\Desktop\\md-dashboard\\MD Sales Report.xlsx. Quantity uses column W, QTY(CTN).",
    )
    text = text.replace("Sales, qty, customers, orders", "Sales, CTN, customers, orders")
    text = text.replace("${fmt.format(s.qty)} qty", "${fmt.format(s.qty)} CTN")
    text = text.replace("<th class=\"num\">Qty</th>", "<th class=\"num\">CTN</th>")
    text = text.replace("<th class=\"num\">QTY</th>", "<th class=\"num\">CTN</th>")
    INDEX_HTML.write_text(text, encoding="utf-8")


def main():
    sales = load_sales()
    sales["period_key"] = sales["date"].dt.strftime("%Y-%m")
    debtors = load_debtors()
    replace_index_data(build_strength(sales))
    DEBTOR_STATUS_JS.write_text(
        "window.debtorStatusData = " + json.dumps(build_debtor_status(sales, debtors), ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    AGENT_MONTHLY_JS.write_text(
        "window.agentMonthlyRevenue = " + json.dumps(build_monthly(sales), ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print("Rebuilt SKU strength report with QTY(CTN).")


if __name__ == "__main__":
    main()
