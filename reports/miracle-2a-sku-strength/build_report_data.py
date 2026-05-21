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
SKU_GAP_JS = Path(__file__).with_name("sku_gap_opportunities.js")
SKU_PENETRATION_JS = Path(__file__).with_name("sku_penetration_data.js")
SKU_DEBTOR_HISTORY_JS = Path(__file__).with_name("sku_debtor_history.js")

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


def pct_delta(current, previous):
    previous = float(previous or 0)
    if previous == 0:
        return None
    return round((float(current or 0) - previous) / abs(previous) * 100, 1)


def build_trend(current_sales, current_qty, previous_metrics, current_customers=0):
    previous_sales = float(previous_metrics["sales"]) if previous_metrics else 0
    previous_qty = float(previous_metrics["qty"]) if previous_metrics else 0
    previous_customers = int(previous_metrics.get("customers", 0)) if previous_metrics else 0
    current_sales = float(current_sales or 0)
    current_qty = float(current_qty or 0)
    current_customers = int(current_customers or 0)
    return {
        "prevSales": money(previous_sales),
        "prevQty": qty(previous_qty),
        "prevCustomers": previous_customers,
        "salesDelta": money(current_sales - previous_sales),
        "qtyDelta": qty(current_qty - previous_qty),
        "customerDelta": current_customers - previous_customers,
        "salesPct": pct_delta(current_sales, previous_sales),
        "qtyPct": pct_delta(current_qty, previous_qty),
        "customerPct": pct_delta(current_customers, previous_customers),
    }


def load_sales(miracle_only=True):
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
    if miracle_only:
        df = df[df["agent"].isin(MIRACLE_AGENTS)].copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["doc_no"] = df["doc_no"].astype(str).str.strip()
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


def grouped_lookup(frame, keys):
    if frame.empty:
        return {}
    grouped = (
        frame.groupby(keys, dropna=False)
        .agg(sales=("sales", "sum"), qty=("qty_ctn", "sum"), customers=("debtor_code", "nunique"))
        .reset_index()
    )
    lookup = {}
    for row in grouped.itertuples(index=False):
        key = tuple(getattr(row, column) for column in keys)
        lookup[key] = {"sales": row.sales, "qty": row.qty, "customers": row.customers}
    return lookup


def debtor_sku_metrics(frame, debtor_codes, sku, desc):
    if frame.empty or not debtor_codes:
        return None
    rows = frame[
        frame["debtor_code"].isin(debtor_codes)
        & (frame["sku"] == sku)
        & (frame["desc"] == desc)
    ]
    if rows.empty:
        return None
    return {
        "sales": float(rows["sales"].sum()),
        "qty": float(rows["qty_ctn"].sum()),
        "customers": int(rows["debtor_code"].nunique()),
    }


def build_debtor_skus(frame):
    if frame.empty:
        return []
    grouped = (
        frame.groupby(["debtor_code", "sku", "desc"], dropna=False)
        .agg(sales=("sales", "sum"), qty=("qty_ctn", "sum"))
        .reset_index()
        .sort_values(["debtor_code", "sku", "desc"])
    )
    return [
        [str(row.debtor_code), str(row.sku), str(row.desc), money(row.sales), qty(row.qty)]
        for row in grouped.itertuples(index=False)
    ]


def build_debtor_sku_history(history_df, periods, debtor_codes):
    scoped_history = history_df[history_df["debtor_code"].isin(debtor_codes)].copy()
    return {
        period: build_debtor_skus(period_frame(scoped_history, period))
        for period in periods
    }


def build_strength(df, history_df=None):
    history_df = history_df if history_df is not None else df
    data = {}
    periods = sorted(df["period_key"].dropna().unique())
    period_labels = [(period, month_label(period)) for period in periods]
    period_labels.append(("all", f"{month_label(periods[0])}-{month_label(periods[-1])}" if periods else "All months"))
    for period, label in period_labels:
        view = period_frame(df, period)
        prev_period = periods[periods.index(period) - 1] if period in periods and periods.index(period) > 0 else None
        prev_view = period_frame(history_df, prev_period) if prev_period else history_df.iloc[0:0].copy()
        prev_state_sku_lookup = grouped_lookup(prev_view, ["state", "sku", "desc"]) if prev_period else {}
        prev_agent_sku_lookup = grouped_lookup(prev_view, ["state", "agent", "sku", "desc"]) if prev_period else {}
        states = []
        state_skus = []
        agents = []
        sku_options = []
        if not view.empty:
            sku_options = [
                [row.sku, row.desc]
                for row in (
                    view.groupby(["sku", "desc"], dropna=False)
                    .agg(sales=("sales", "sum"))
                    .reset_index()
                    .sort_values(["sku", "desc"])
                    .itertuples(index=False)
                )
            ]
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
                .agg(
                    sales=("sales", "sum"),
                    qty=("qty_ctn", "sum"),
                    customers=("debtor_code", "nunique"),
                )
                .reset_index()
                .sort_values("sales", ascending=False)
            )
            for rank, row in enumerate(sku_rows.itertuples(index=False), start=1):
                current_codes = sorted(set(
                    srows[(srows["sku"] == row.sku) & (srows["desc"] == row.desc)]["debtor_code"]
                ))
                previous_metrics = prev_state_sku_lookup.get((state, row.sku, row.desc)) if prev_period else None
                trend = build_trend(row.sales, row.qty, previous_metrics, row.customers) if prev_period else None
                state_skus.append([
                    state, rank, row.sku, row.desc, money(row.sales), qty(row.qty),
                    int(row.customers), round(float(row.sales) / total_sales * 100, 1) if total_sales else 0,
                    trend, current_codes,
                ])

        for state, state_agents in STATE_MAP.items():
            for agent in state_agents:
                arows = view[view["agent"] == agent]
                if arows.empty:
                    continue
                total_sales = float(arows["sales"].sum())
                sku_rows = (
                    arows.groupby(["sku", "desc"], dropna=False)
                    .agg(
                        sales=("sales", "sum"),
                        qty=("qty_ctn", "sum"),
                        customers=("debtor_code", "nunique"),
                    )
                    .reset_index()
                    .sort_values("sales", ascending=False)
                )
                skus = []
                for row in sku_rows.itertuples(index=False):
                    current_codes = sorted(set(
                        arows[(arows["sku"] == row.sku) & (arows["desc"] == row.desc)]["debtor_code"]
                    ))
                    previous_metrics = prev_agent_sku_lookup.get((state, agent, row.sku, row.desc)) if prev_period else None
                    agent_sku = [
                        row.sku, row.desc, money(row.sales), qty(row.qty), int(row.customers),
                        round(float(row.sales) / total_sales * 100, 1) if total_sales else 0,
                        build_trend(row.sales, row.qty, previous_metrics, row.customers) if prev_period else None,
                        current_codes,
                    ]
                    skus.append(agent_sku)
                agents.append([state, agent, skus])

        data[period] = {
            "label": label,
            "states": sorted(states, key=lambda x: x["sales"], reverse=True),
            "stateSkus": state_skus,
            "agents": agents,
            "skuOptions": sku_options,
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


def build_sku_gap(df, debtors):
    rows = df.copy()
    grouped = (
        rows.groupby(["period_key", "state", "agent", "debtor_code", "sku", "desc"], dropna=False)
        .agg(
            company_name=("company_name", "last"),
            sales=("sales", "sum"),
            qty=("qty_ctn", "sum"),
            docs=("doc_no", "nunique"),
            last_date=("date", "max"),
        )
        .reset_index()
    )

    debtor_names = (
        rows.sort_values("date")
        .groupby("debtor_code")["company_name"]
        .last()
        .to_dict()
    )
    debtor_meta = {}
    for code, debtor in debtors.items():
        agent = str(debtor.get("agent") or "").upper().strip()
        if agent not in MIRACLE_AGENTS:
            continue
        debtor_meta[code] = {
            "name": debtor["name"],
            "status": debtor["status"],
            "active": debtor["status"] == "Active",
            "maintAgent": agent,
            "maintType": debtor["type"],
            "state": AGENT_STATE.get(agent, ""),
        }

    for code, name in debtor_names.items():
        debtor = debtors.get(code)
        agent = str(debtor.get("agent") or "").upper().strip() if debtor else ""
        debtor_meta[code] = {
            "name": debtor["name"] if debtor and debtor["name"] else str(name or ""),
            "status": debtor["status"] if debtor else "Missing",
            "active": debtor["status"] == "Active" if debtor else False,
            "maintAgent": agent,
            "maintType": debtor["type"] if debtor else "",
            "state": AGENT_STATE.get(agent, ""),
            **debtor_meta.get(code, {}),
        }

    sku_options = [
        [row.sku, row.desc]
        for row in (
            rows.groupby(["sku", "desc"], dropna=False)
            .agg(sales=("sales", "sum"))
            .reset_index()
            .sort_values(["sku", "desc"])
            .itertuples(index=False)
        )
    ]

    records = []
    for row in grouped.itertuples(index=False):
        records.append({
            "month": row.period_key,
            "state": "" if pd.isna(row.state) else row.state,
            "agent": row.agent,
            "code": row.debtor_code,
            "name": debtor_meta.get(row.debtor_code, {}).get("name") or str(row.company_name or ""),
            "sku": row.sku,
            "desc": row.desc,
            "sales": round(float(row.sales or 0), 2),
            "qty": qty(row.qty),
            "docs": int(row.docs),
            "lastDate": row.last_date.date().isoformat() if pd.notna(row.last_date) else "",
        })

    return {
        "months": sorted(rows["period_key"].dropna().unique()),
        "skuOptions": sku_options,
        "typeOptions": sorted({meta["maintType"] for meta in debtor_meta.values() if meta.get("maintType")}),
        "debtors": debtor_meta,
        "records": records,
    }


def replace_index_data(data):
    text = INDEX_HTML.read_text(encoding="utf-8")
    replacement = "const data = " + json.dumps(data, ensure_ascii=False, indent=6) + ";"
    text = re.sub(r"const data = \{.*?\};\s*(?=\n\s*const fmt)", replacement + "\n", text, flags=re.S)
    latest = next((key for key in reversed(list(data.keys())) if key != "all"), "all")
    if "let currentPeriods" in text:
        text = re.sub(r'let currentPeriods = \[[^\]]*\];', f'let currentPeriods = ["{latest}"];', text)
    else:
        text = re.sub(r'let currentPeriod = "[^"]+";', f'let currentPeriods = ["{latest}"];', text)
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
    all_sales = load_sales(miracle_only=False)
    sales["period_key"] = sales["date"].dt.strftime("%Y-%m")
    all_sales["period_key"] = all_sales["date"].dt.strftime("%Y-%m")
    debtors = load_debtors()
    strength_data = build_strength(sales, all_sales)
    replace_index_data(strength_data)
    SKU_DEBTOR_HISTORY_JS.write_text(
        "window.skuDebtorHistory = " + json.dumps(
            build_debtor_sku_history(all_sales, [period for period in strength_data if period != "all"], set(sales["debtor_code"])),
            ensure_ascii=False,
            separators=(",", ":"),
        ) + ";\n",
        encoding="utf-8",
    )
    DEBTOR_STATUS_JS.write_text(
        "window.debtorStatusData = " + json.dumps(build_debtor_status(sales, debtors), ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    AGENT_MONTHLY_JS.write_text(
        "window.agentMonthlyRevenue = " + json.dumps(build_monthly(sales), ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    SKU_GAP_JS.write_text(
        "window.skuGapData = " + json.dumps(build_sku_gap(sales, debtors), ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    SKU_PENETRATION_JS.write_text(
        "window.skuPenetrationData = " + json.dumps(build_sku_gap(all_sales, debtors), ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print("Rebuilt SKU strength report with QTY(CTN).")


if __name__ == "__main__":
    main()
