#!/usr/bin/env python3
"""
MD Sales Dashboard — process_data.py  (Phase 2)
================================================
Reads:
  - MD Sales Report (.xlsx)        — columns A:Z, sheet 'MD'
  - Debtor Maintenance (.xlsx)     — existing Phase 1 source
  - targets.json                   — monthly targets set via Admin Page

Outputs:
  - dashboard_data.json            — consumed by sales_dashboard.html

Scope: GRP 2A (Miracle & SS2) only.

Column reference (MD Sales Report):
  A=Tranx Mth  B=Doc No     C=Date (invoice)  D=Debtor Code  E=Company Name
  F=Sales Agent G=Area Code  H=Item Group      I=Item Code    J=Item Description
  K=UOM        L=Smallest Qty M=Unit Price     N=Discount     O=Local SubTotal
  P=Rebate     Q=PAID ON     R=UNIQ CODE       S=RM/CTN       T=RM/CTN Rebate
  U=Sales Type V=Comm Rate   W=QTY(CTN)        X=QTY(MC)      Y=RM/MC
  Z=>Shop Price Comm
"""

import json
import os
import sys
from datetime import datetime, date, timedelta
from pathlib import Path

import pandas as pd
import openpyxl

# ── Config ────────────────────────────────────────────────────────────────────

BASE_DIR        = Path(__file__).parent
SALES_FILE      = BASE_DIR / "MD Sales Report.xlsx"
DEBTOR_FILE     = BASE_DIR / "Debtor Maintenance.xlsx"
TARGETS_FILE    = BASE_DIR / "targets.json"
OUTPUT_FILE     = BASE_DIR / "dashboard_data.json"

# Area scope — Phase 2 covers GRP 2A only
SCOPE_AREA      = "GRP 2A"

# 8COM item group identifier
EIGHTCOM_GROUP  = "8COM"

# EVO commission: only item code 'EVO', RM/CTN (col S) >= 36
EVO_ITEM_CODE   = "EVO"
EVO_MIN_RM_CTN  = 36.0

# Aging threshold in days
OVERDUE_DAYS    = 60

# Sales Type → Tier mapping
SALES_TYPE_MAP  = {
    "Target":                  "normal",
    "Grey Area":               "ga",
    "Master Agent":            "ma",
    "Master Agent 35/45/55":   "ma",
    "Master Agent/Promo":      "ma",
    "Below Master Agent":      "ma",
}

# Brand → item code mapping (managed via Admin Page / targets.json brand_config)
DEFAULT_BRAND_CONFIG = {
    "iFACE":   ["IFACE B", "IFACE M", "IFACE R", "IFACE DB"],
    "SUKUN":   ["SKNR", "SKNW"],
    "EVO":     ["EVO"],          # special: also filter S >= 36
    "BISON":   ["BISON-G", "BISON-R", "BISON-M"],
    "TR20":    ["TR20"],
    "LAM+LWM": ["LAM", "LWM"],
}

# All Canggih in-house item codes (used for total Canggih CTN)
# Managed via Admin Page — loaded from targets.json if present
DEFAULT_INHOUSE_CODES = [
    "90", "DPM EVO", "IMP-001", "LB22", "LF-002", "LIC-001", "LMM-002",
    "TR-002", "CM-002", "LG22", "LR22", "LBOLD", "MARISE", "HTM-002",
    "ZYG", "ZL", "EC", "ZPA", "LC20", "CMX", "CMP",
    # brand commission codes also count as Canggih
    "IFACE B", "IFACE M", "IFACE R", "IFACE DB",
    "SKNR", "SKNW",
    "EVO",
    "BISON-G", "BISON-R", "BISON-M",
    "TR20",
    "LAM", "LWM",
]

# Group-level brand targets — item codes per brand (set monthly in Admin Page)
# These are GROUP totals — no per-agent split, no RM36 filter (even for EVO)
DEFAULT_GROUP_BRAND_CONFIG = {
    "SUKUN":     ["SKNR", "SKNW"],
    "EVO":       ["EVO"],               # No RM36 filter for group target
    "IMP":       ["IMP-001"],
    "LF":        ["LF-002"],
    "CLASSMILD": ["CM-002"],
    "BISON":     ["BISON-G", "BISON-M", "BISON-R"],
    "TR":        ["TR20", "TR-002"],
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def load_targets():
    """Load targets.json; return empty structure if missing."""
    if not TARGETS_FILE.exists():
        log("⚠  targets.json not found — using empty targets")
        return {}
    with open(TARGETS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def current_month_label(today=None):
    """Return PAID ON label for current month, e.g. 'Mar 26'."""
    d = today or date.today()
    return d.strftime("%b %y")  # e.g. "Mar 26"


def prev_month_labels(n=3, today=None):
    """Return list of n previous month labels for penetration lookback."""
    d = today or date.today()
    labels = []
    for i in range(1, n + 1):
        first = (d.replace(day=1) - timedelta(days=1))
        for _ in range(i - 1):
            first = (first.replace(day=1) - timedelta(days=1))
        labels.append(first.strftime("%b %y"))
    return labels


def pct(actual, target):
    """Safe percentage calculation."""
    if not target or target == 0:
        return None
    return round(actual / target * 100, 1)


def color_code(pct_val):
    """Return colour status based on achievement %."""
    if pct_val is None:
        return "gray"
    if pct_val >= 80:
        return "green"
    if pct_val >= 50:
        return "amber"
    return "red"


# ── Load MD Sales Report ──────────────────────────────────────────────────────

def load_sales_report():
    log(f"Loading MD Sales Report: {SALES_FILE}")
    if not SALES_FILE.exists():
        log(f"❌ File not found: {SALES_FILE}")
        sys.exit(1)

    # Read columns A:Z (indices 0–25), skip row 1 (special ref row), use row 2 as header
    df = pd.read_excel(
        SALES_FILE,
        sheet_name=0,        # Read first sheet regardless of name (works for MD, Sheet1, etc.)
        header=1,        # row index 1 = Excel row 2 = actual headers
        usecols="A:Z",
        dtype=str,       # read all as string first, cast later
        engine="openpyxl",
    )

    # Standardise column names to our internal keys
    col_map = {
        df.columns[0]:  "tranx_mth",
        df.columns[1]:  "doc_no",
        df.columns[2]:  "date",
        df.columns[3]:  "debtor_code",
        df.columns[4]:  "company_name",
        df.columns[5]:  "agent",
        df.columns[6]:  "area_code",
        df.columns[7]:  "item_group",
        df.columns[8]:  "item_code",
        df.columns[9]:  "item_desc",
        df.columns[10]: "uom",
        df.columns[11]: "smallest_qty",
        df.columns[12]: "unit_price",
        df.columns[13]: "discount",
        df.columns[14]: "local_subtotal",
        df.columns[15]: "rebate",
        df.columns[16]: "paid_on",
        df.columns[17]: "uniq_code",
        df.columns[18]: "rm_ctn",
        df.columns[19]: "rm_ctn_rebate",
        df.columns[20]: "sales_type",
        df.columns[21]: "comm_rate",
        df.columns[22]: "qty_ctn",
        df.columns[23]: "qty_mc",
        df.columns[24]: "rm_mc",
        df.columns[25]: "shop_price_comm",
    }
    df = df.rename(columns=col_map)

    # Cast numeric columns
    df["qty_ctn"]       = pd.to_numeric(df["qty_ctn"],       errors="coerce").fillna(0)
    df["rm_ctn"]        = pd.to_numeric(df["rm_ctn"],        errors="coerce").fillna(0)
    df["local_subtotal"]= pd.to_numeric(df["local_subtotal"],errors="coerce").fillna(0)

    # Normalise string columns — strip whitespace
    for col in ["agent", "area_code", "item_group", "item_code",
                "sales_type", "paid_on", "debtor_code"]:
        df[col] = df[col].fillna("").str.strip()

    # Parse invoice date (col C) — stored as Excel serial or string
    df["date_parsed"] = pd.to_datetime(df["date"], errors="coerce")

    log(f"  {len(df):,} total rows loaded")
    return df


# ── Load Debtor Maintenance ───────────────────────────────────────────────────

def load_debtors():
    log(f"Loading Debtor Maintenance: {DEBTOR_FILE}")
    if not DEBTOR_FILE.exists():
        log("⚠  Debtor file not found — debtor info will be empty")
        return pd.DataFrame()
    df = pd.read_excel(DEBTOR_FILE, dtype=str, engine="openpyxl")
    df.columns = [str(c).strip() for c in df.columns]
    log(f"  Debtor columns: {list(df.columns)}")
    log(f"  Total rows: {len(df)}")
    return df


# ── Filter: Scope to GRP 2A ───────────────────────────────────────────────────

def filter_scope(df):
    """Keep only GRP 2A rows."""
    scoped = df[df["area_code"] == SCOPE_AREA].copy()
    log(f"  Scope filter (GRP 2A): {len(scoped):,} rows retained")
    return scoped


# ── Module 1: Sales Progression ───────────────────────────────────────────────

def calc_sales_progression(df, targets, agents, cur_month):
    """
    Per agent: sum paid Canggih CTN split by tier (Normal / GA / MA).
    Also: transaction count, avg per working day, per-SKU debtor+CTN 4-month trend.
    """
    log("Calculating Sales Progression...")

    # Paid rows this month
    paid = df[df["paid_on"] == cur_month].copy()

    # Split Canggih vs 8COM
    canggih_paid  = paid[paid["item_group"] != EIGHTCOM_GROUP]
    eightcom_paid = paid[paid["item_group"] == EIGHTCOM_GROUP]

    # All rows for unpaid calc
    eightcom_all = df[df["item_group"] == EIGHTCOM_GROUP]

    # Working days for avg calculation
    wd = calc_working_days()
    elapsed_days = max(wd["elapsed_working_days"], 1)

    # All Canggih for 4-month SKU trend
    canggih_all = df[df["item_group"] != EIGHTCOM_GROUP]

    # 4-month labels for trend (current + prev 3)
    from datetime import date
    today = date.today()
    month_labels = []
    for i in range(3, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12; y -= 1
        month_labels.append(date(y, m, 1).strftime("%b %y"))

    result = {}

    for agent in agents:
        ag_tgts   = targets.get("agents", {}).get(agent, {})
        sp_tgts   = ag_tgts.get("sales_progression", {})

        ag_canggih     = canggih_paid[canggih_paid["agent"] == agent]
        ag_canggih_all = canggih_all[canggih_all["agent"] == agent]

        # Tier split
        normal_ctn = ag_canggih[ag_canggih["sales_type"].map(SALES_TYPE_MAP) == "normal"]["qty_ctn"].sum()
        ga_ctn     = ag_canggih[ag_canggih["sales_type"].map(SALES_TYPE_MAP) == "ga"]["qty_ctn"].sum()
        ma_ctn     = ag_canggih[ag_canggih["sales_type"].map(SALES_TYPE_MAP) == "ma"]["qty_ctn"].sum()
        total_canggih_ctn = ag_canggih["qty_ctn"].sum()

        # 8COM
        ag_8com_paid   = eightcom_paid[eightcom_paid["agent"] == agent]["qty_ctn"].sum()
        ag_8com_unpaid = eightcom_all[
            (eightcom_all["agent"] == agent) & (eightcom_all["paid_on"] == "")
        ]["qty_ctn"].sum()

        # Transaction counts (unique invoices this month)
        txn_count = ag_canggih["doc_no"].nunique() if "doc_no" in ag_canggih.columns else len(ag_canggih)
        avg_txn   = round(txn_count / elapsed_days, 1)

        # Targets
        t1 = sp_tgts.get("normal_t1")
        t2 = sp_tgts.get("normal_t2")
        ga = sp_tgts.get("ga")
        ma = sp_tgts.get("ma")

        normal_ctn = round(float(normal_ctn), 2)
        ga_ctn     = round(float(ga_ctn), 2)
        ma_ctn     = round(float(ma_ctn), 2)

        # ── Per-SKU 4-month trend (like Image 1) ──────────────────────────
        SKU_CODES = {
            "CM-002":   "CM-002",   "EVO":     "EVO",     "IMP-001": "IMP-001",
            "LF-002":   "LF-002",   "TR-002":  "TR-002",  "TR20":    "TR20",
            "SKNR":     "SKNR",     "SKNW":    "SKNW",
            "IFACE B":  "IFACE B",  "IFACE M": "IFACE M", "IFACE R": "IFACE R", "IFACE DB":"IFACE DB",
            "BISON-G":  "BISON-G",  "BISON-M": "BISON-M", "BISON-R": "BISON-R",
            "LAM":      "LAM",      "LWM":     "LWM",
        }
        sku_trend = {}
        for sku_label, sku_code in SKU_CODES.items():
            sku_rows = ag_canggih_all[ag_canggih_all["item_code"] == sku_code]
            month_data = {}
            for lbl in month_labels:
                m_rows = sku_rows[sku_rows["paid_on"] == lbl]
                month_data[lbl] = {
                    "debtors": int(m_rows["debtor_code"].nunique()),
                    "ctn":     round(float(m_rows["qty_ctn"].sum()), 0),
                }
            sku_trend[sku_label] = month_data

        # Active debtors per month (for 活跃顾客 row)
        active_by_month = {}
        total_debtors = ag_canggih_all["debtor_code"].nunique()
        for lbl in month_labels:
            m_rows = ag_canggih_all[ag_canggih_all["paid_on"] == lbl]
            active_by_month[lbl] = {
                "debtors": int(m_rows["debtor_code"].nunique()),
                "ctn":     round(float(m_rows["qty_ctn"].sum()), 0),
            }

        result[agent] = {
            "normal_ctn":          normal_ctn,
            "ga_ctn":              ga_ctn,
            "ma_ctn":              ma_ctn,
            "total_canggih_ctn":   round(float(total_canggih_ctn), 2),
            "eightcom_paid_ctn":   round(float(ag_8com_paid), 2),
            "eightcom_unpaid_ctn": round(float(ag_8com_unpaid), 2),
            "txn_count":           int(txn_count),
            "avg_txn_per_day":     avg_txn,
            "elapsed_working_days": elapsed_days,
            "month_labels":        month_labels,
            "sku_trend":           sku_trend,
            "active_by_month":     active_by_month,
            "total_debtors_all":   int(total_debtors),
            "tiers": {
                "normal_t1": {
                    "target": t1, "actual": normal_ctn,
                    "gap":   round(normal_ctn - t1, 2) if t1 else None,
                    "pct":   pct(normal_ctn, t1), "color": color_code(pct(normal_ctn, t1)),
                },
                "normal_t2": {
                    "target": t2, "actual": normal_ctn,
                    "gap":   round(normal_ctn - t2, 2) if t2 else None,
                    "pct":   pct(normal_ctn, t2), "color": color_code(pct(normal_ctn, t2)),
                },
                "ga": {"target": ga, "actual": ga_ctn,
                    "gap": round(ga_ctn - ga, 2) if ga else None,
                    "pct": pct(ga_ctn, ga), "color": color_code(pct(ga_ctn, ga)),
                } if ga else None,
                "ma": {"target": ma, "actual": ma_ctn,
                    "gap": round(ma_ctn - ma, 2) if ma else None,
                    "pct": pct(ma_ctn, ma), "color": color_code(pct(ma_ctn, ma)),
                } if ma else None,
            }
        }

    return result


# ── Module 2: Brand Commission ────────────────────────────────────────────────

def calc_brand_commission(df, targets, agents, cur_month, prev_months, brand_config):
    """
    Per agent per brand:
      Criteria 1 — Penetration: debtors with 0 purchases in prev 3 months, buys this month
      Criteria 2 — CTN target:  paid CTN this month >= target
      Special:  EVO — only rows where rm_ctn >= 36
    """
    log("Calculating Brand Commission...")

    # Canggih only
    canggih = df[df["item_group"] != EIGHTCOM_GROUP].copy()

    # Paid this month (for CTN target and commission calc)
    paid_cur = canggih[canggih["paid_on"] == cur_month]

    # Previous 3 months data (for penetration lookback)
    prev_paid = canggih[canggih["paid_on"].isin(prev_months)]

    result = {}

    for agent in agents:
        ag_tgts   = targets.get("agents", {}).get(agent, {})
        bc_tgts   = ag_tgts.get("brand_commission", {})

        ag_paid_cur  = paid_cur[paid_cur["agent"] == agent]
        ag_prev_paid = prev_paid[prev_paid["agent"] == agent]

        result[agent] = {}

        for brand, codes in brand_config.items():
            brand_tgt = bc_tgts.get(brand, {})

            # ── Filter rows for this brand ──────────────────────────
            if brand == "EVO":
                # Current month paid: item_code = EVO AND rm_ctn >= 36
                cur_rows = ag_paid_cur[
                    (ag_paid_cur["item_code"].isin(codes)) &
                    (ag_paid_cur["rm_ctn"] >= EVO_MIN_RM_CTN)
                ]
                # Prev months: item_code = EVO (any price — just for penetration lookback)
                prev_rows = ag_prev_paid[ag_prev_paid["item_code"].isin(codes)]
            else:
                cur_rows  = ag_paid_cur[ag_paid_cur["item_code"].isin(codes)]
                prev_rows = ag_prev_paid[ag_prev_paid["item_code"].isin(codes)]

            # ── Criteria 1: Penetration ─────────────────────────────
            # Debtors who bought this brand in prev 3 months
            prev_buyers = set(prev_rows["debtor_code"].unique())

            # Debtors who bought this brand this month
            cur_buyers = set(cur_rows["debtor_code"].unique())

            # Penetration = debtors in cur_buyers who were NOT in prev_buyers
            new_penetrations = cur_buyers - prev_buyers
            penetration_count  = len(new_penetrations)
            penetration_target = brand_tgt.get("penetration_target", 0)
            penetration_hit    = penetration_count >= penetration_target if penetration_target else False

            # ── Criteria 2: CTN Target ──────────────────────────────
            ctn_sold   = round(float(cur_rows["qty_ctn"].sum()), 2)
            ctn_target = brand_tgt.get("ctn_target", 0)
            ctn_hit    = ctn_sold >= ctn_target if ctn_target else False

            # ── Commission ──────────────────────────────────────────
            both_hit   = penetration_hit and ctn_hit
            comm_earned = round(ctn_sold * 1.80, 2) if both_hit else 0.0

            # Status label
            if both_hit:
                status = "both_hit"
            elif penetration_hit or ctn_hit:
                status = "one_hit"
            else:
                status = "none_hit"

            result[agent][brand] = {
                "penetration": {
                    "count":    penetration_count,
                    "target":   penetration_target,
                    "hit":      penetration_hit,
                    "pct":      pct(penetration_count, penetration_target),
                },
                "ctn": {
                    "sold":     ctn_sold,
                    "target":   ctn_target,
                    "hit":      ctn_hit,
                    "gap":      round(ctn_sold - ctn_target, 2) if ctn_target else None,
                    "pct":      pct(ctn_sold, ctn_target),
                },
                "status":       status,
                "comm_earned":  comm_earned,
                "both_hit":     both_hit,
            }

    return result


# ── Module 3: Newbie Scheme ───────────────────────────────────────────────────

def calc_newbie_scheme(df, targets, agents, cur_month):
    """
    For agents flagged as newbie:
      - CTN tiers: per-agent thresholds and rewards (from agent.newbie_tiers)
      - New account bonus: global tiers (same for all newbies)
    """
    log("Calculating Newbie Scheme...")

    newbie_config  = targets.get("newbie_scheme", {})
    account_tiers  = newbie_config.get("account_tiers", [])  # [{count, reward}] — global
    agents_cfg     = targets.get("agents", {})

    # Default CTN tiers fallback (if agent has no individual tiers set)
    DEFAULT_CTN_TIERS = [
        {"threshold": 1000, "reward": 1200},
        {"threshold": 1342, "reward": 1800},
        {"threshold": 1592, "reward": 2400},
    ]

    # Canggih paid this month
    canggih_paid_cur = df[
        (df["item_group"] != EIGHTCOM_GROUP) &
        (df["paid_on"] == cur_month)
    ]

    # All historical data for new account detection
    all_prev = df[df["paid_on"] != cur_month]

    result = {}

    for agent in agents:
        ag_info = agents_cfg.get(agent, {})
        if not ag_info.get("is_newbie", False):
            continue  # Skip non-newbie agents

        # Per-agent CTN tiers (falls back to global default if not set)
        ctn_tiers = ag_info.get("newbie_tiers", DEFAULT_CTN_TIERS)
        if not ctn_tiers:
            ctn_tiers = DEFAULT_CTN_TIERS

        # CTN: Normal tier only
        ag_paid    = canggih_paid_cur[canggih_paid_cur["agent"] == agent]
        normal_ctn = round(float(
            ag_paid[ag_paid["sales_type"].map(SALES_TYPE_MAP) == "normal"]["qty_ctn"].sum()
        ), 2)

        # Determine highest CTN tier hit
        ctn_tier_hit = None
        ctn_reward   = 0
        for tier in sorted(ctn_tiers, key=lambda x: x["threshold"]):
            if normal_ctn >= tier["threshold"]:
                ctn_tier_hit = tier["threshold"]
                ctn_reward   = tier["reward"]

        # New accounts this month vs all previous
        cur_debtors  = set(df[
            (df["agent"] == agent) & (df["paid_on"] == cur_month)
        ]["debtor_code"].unique())
        prev_debtors = set(all_prev[all_prev["agent"] == agent]["debtor_code"].unique())
        new_accounts = cur_debtors - prev_debtors
        new_acc_count = len(new_accounts)

        # Account bonus tier (global)
        acc_tier_hit = None
        acc_reward   = 0
        for tier in sorted(account_tiers, key=lambda x: x["count"]):
            if new_acc_count >= tier["count"]:
                acc_tier_hit = tier["count"]
                acc_reward   = tier["reward"]

        result[agent] = {
            "is_newbie":       True,
            "normal_ctn":      normal_ctn,
            "ctn_tiers":       ctn_tiers,       # per-agent tiers
            "ctn_tier_hit":    ctn_tier_hit,
            "ctn_reward":      ctn_reward,
            "new_accounts":    new_acc_count,
            "account_tiers":   account_tiers,   # global tiers
            "acc_tier_hit":    acc_tier_hit,
            "acc_reward":      acc_reward,
            "total_incentive": ctn_reward + acc_reward,
            "next_ctn_tier":   next(
                (t for t in sorted(ctn_tiers, key=lambda x: x["threshold"])
                 if t["threshold"] > normal_ctn), None
            ),
        }

    return result


# ── Module 4: Paid vs Unpaid (Aging) ─────────────────────────────────────────

def calc_aging(df, agents, cur_month):
    """
    Per agent: paid CTN, unpaid CTN (Canggih + 8COM separately).
    Flag unpaid invoices >= OVERDUE_DAYS.
    """
    log("Calculating Paid vs Unpaid / Aging...")

    today = date.today()

    # Canggih
    canggih = df[df["item_group"] != EIGHTCOM_GROUP]
    eightcom = df[df["item_group"] == EIGHTCOM_GROUP]

    result = {}

    for agent in agents:
        # ── Canggih ────────────────────────────────────────────────
        ag_c = canggih[canggih["agent"] == agent]
        canggih_paid   = round(float(ag_c[ag_c["paid_on"] != ""]["qty_ctn"].sum()), 2)
        canggih_unpaid_rows = ag_c[ag_c["paid_on"] == ""]
        canggih_unpaid = round(float(canggih_unpaid_rows["qty_ctn"].sum()), 2)

        # ── 8COM ───────────────────────────────────────────────────
        ag_8 = eightcom[eightcom["agent"] == agent]
        eightcom_paid   = round(float(ag_8[ag_8["paid_on"] != ""]["qty_ctn"].sum()), 2)
        eightcom_unpaid_rows = ag_8[ag_8["paid_on"] == ""]
        eightcom_unpaid = round(float(eightcom_unpaid_rows["qty_ctn"].sum()), 2)

        # ── Aging: all unpaid rows ──────────────────────────────────
        all_unpaid = ag_c[ag_c["paid_on"] == ""].copy()
        overdue_invoices = []

        for _, row in all_unpaid.iterrows():
            inv_date = row.get("date_parsed")
            if pd.isnull(inv_date):
                continue
            days_outstanding = (datetime.now() - inv_date).days
            if days_outstanding >= OVERDUE_DAYS:
                overdue_invoices.append({
                    "doc_no":           row.get("doc_no", ""),
                    "debtor_code":      row.get("debtor_code", ""),
                    "company_name":     row.get("company_name", ""),
                    "invoice_date":     inv_date.strftime("%d/%m/%Y"),
                    "days_outstanding": days_outstanding,
                    "qty_ctn":          round(float(row.get("qty_ctn", 0)), 2),
                    "item_code":        row.get("item_code", ""),
                })

        overdue_invoices.sort(key=lambda x: x["days_outstanding"], reverse=True)

        result[agent] = {
            "canggih_paid_ctn":      canggih_paid,
            "canggih_unpaid_ctn":    canggih_unpaid,
            "eightcom_paid_ctn":     eightcom_paid,
            "eightcom_unpaid_ctn":   eightcom_unpaid,
            "overdue_count":         len(overdue_invoices),
            "overdue_invoices":      overdue_invoices,
        }

    return result


# ── Phase 1 compatibility: existing debtor card data ─────────────────────────

def calc_debtor_cards(df, debtor_df, agents, cur_month):
    """
    Preserve existing Phase 1 debtor card logic:
    - Activation status per debtor (Active / Pending / Need Reactivation)
    - SKU group penetration
    - Last purchase date, new debtor badge
    - 3-month CTN bars
    Returns per-agent debtor list.
    """
    log("Calculating debtor cards (Phase 1 logic)...")

    # Month labels for 3-month window
    today = date.today()
    months = []
    d = today.replace(day=1)
    for _ in range(4):  # current + 3 previous
        months.append(d.strftime("%b %y"))
        d = (d - timedelta(days=1)).replace(day=1)
    cur_m, prev1_m, prev2_m, prev3_m = months[0], months[1], months[2], months[3]

    # Canggih paid transactions
    canggih_paid = df[
        (df["item_group"] != EIGHTCOM_GROUP) &
        (df["paid_on"] != "")
    ]

    # Build debtor lookup from Debtor Maintenance
    debtor_info = {}
    if not debtor_df.empty:
        cols = list(debtor_df.columns)
        log(f"  Debtor columns: {cols}")

        # Exact column names from Debtor Maintenance.xlsx
        # Code, Company Name, Attention, Debtor Type, Phone 1, Area, Agent,
        # Active, Open Acct Date, Birth Date
        CODE_COL  = next((c for c in cols if c.strip() in ('Code','Debtor Code')), cols[0] if cols else None)
        NAME_COL  = next((c for c in cols if 'Company' in c or 'Name' in c), None)
        ATT_COL   = next((c for c in cols if 'Attention' in c), None)
        TYPE_COL  = next((c for c in cols if 'Debtor Type' in c or c=='Type'), None)
        PHONE_COL = next((c for c in cols if 'Phone' in c), None)  # Phone 1
        OPEN_COL  = next((c for c in cols if 'Open Acct' in c or 'Open' in c), None)
        BIRTH_COL = next((c for c in cols if 'Birth' in c), None)
        AGENT_COL = next((c for c in cols if c.strip() == 'Agent'), None)

        log(f"  Mapped → code:{CODE_COL} name:{NAME_COL} phone:{PHONE_COL} type:{TYPE_COL} vip:{ATT_COL} agent:{AGENT_COL}")

        for _, row in debtor_df.iterrows():
            code = str(row.get(CODE_COL, '') if CODE_COL else '').strip()
            if not code or code.lower() in ('nan', 'none', ''):
                continue

            phone_raw = str(row.get(PHONE_COL, '') if PHONE_COL else '').strip()
            phone_raw = '' if phone_raw.lower() in ('nan', 'none') else phone_raw

            vip_raw   = str(row.get(ATT_COL, '') if ATT_COL else '').strip().upper()
            type_raw  = str(row.get(TYPE_COL, '') if TYPE_COL else '').strip()
            type_raw  = '' if type_raw.lower() in ('nan', 'none') else type_raw
            agent_raw = str(row.get(AGENT_COL, '') if AGENT_COL else '').strip()
            agent_raw = '' if agent_raw.lower() in ('nan', 'none') else agent_raw

            debtor_info[code] = {
                "name":       str(row.get(NAME_COL, code) if NAME_COL else code).strip(),
                "phone":      phone_raw,
                "vip":        vip_raw == "VIP",
                "birth_date": row.get(BIRTH_COL, None) if BIRTH_COL else None,
                "open_date":  row.get(OPEN_COL, None)  if OPEN_COL  else None,
                "type":       type_raw,
                "agent":      agent_raw,
            }

    # SKU groups
    sku_groups = {
        "IFACE":   ["IFACE B", "IFACE DB", "IFACE M", "IFACE R"],
        "SUKUN":   ["SKNW", "SKNR"],
        "EVO":     ["EVO"],
        "BISON":   ["BISON-R", "BISON-M", "BISON-G"],
        "TR20":    ["TR20"],
        "LAM+LWM": ["LAM", "LWM"],
    }

    # 新增SKU groups — separate from display SKU dots
    # Logic: didn't buy last 3 months BUT bought this month = +1
    new_sku_groups = {
        "SUKUN": ["SKNW", "SKNR"],
        "EVO":   ["EVO"],
        "CM":    ["CM-002"],
        "IMP":   ["IMP-001"],
        "LF":    ["LF-002"],
        "TR12":  ["TR-002"],
        "TR20":  ["TR20"],
    }

    result = {}

    for agent in agents:
        ag_data = canggih_paid[canggih_paid["agent"] == agent]

        # ── Base debtor list from Debtor Maintenance (official assigned list) ──
        # Use debtors assigned to this agent in debtor_info
        dm_debtor_codes = [
            code for code, info in debtor_info.items()
            if info.get("agent", "").strip().upper() == agent.upper()
        ]

        # Also include any debtors found in transaction data (fallback)
        tx_debtor_codes = list(ag_data["debtor_code"].unique())

        # Merge: DM list is primary, tx adds any missing
        all_debtor_codes = list(dict.fromkeys(dm_debtor_codes + [
            c for c in tx_debtor_codes if c not in dm_debtor_codes
        ]))

        if not all_debtor_codes:
            # If debtor maintenance has no agent column match, fall back to tx data
            all_debtor_codes = tx_debtor_codes

        log(f"  {agent}: {len(dm_debtor_codes)} from DM + {len([c for c in tx_debtor_codes if c not in dm_debtor_codes])} from TX = {len(all_debtor_codes)} total")

        debtor_cards = []
        for dcode in all_debtor_codes:
            d_rows = ag_data[ag_data["debtor_code"] == dcode]

            # Activation status — debtors with no transactions = need_reactivation
            if d_rows.empty:
                status = "need_reactivation"
            else:
                bought_cur   = cur_m   in d_rows["paid_on"].values
                bought_prev1 = prev1_m in d_rows["paid_on"].values
                if bought_cur:
                    status = "active"
                elif bought_prev1:
                    status = "pending"
                else:
                    status = "need_reactivation"

            # Last purchase date
            last_date = d_rows["date_parsed"].max() if not d_rows.empty else None
            last_date_str = last_date.strftime("%d/%m/%Y") if last_date and pd.notnull(last_date) else ""

            # 3-month CTN
            ctn_cur   = round(float(d_rows[d_rows["paid_on"] == cur_m]["qty_ctn"].sum()), 2)   if not d_rows.empty else 0.0
            ctn_prev1 = round(float(d_rows[d_rows["paid_on"] == prev1_m]["qty_ctn"].sum()), 2) if not d_rows.empty else 0.0
            ctn_prev2 = round(float(d_rows[d_rows["paid_on"] == prev2_m]["qty_ctn"].sum()), 2) if not d_rows.empty else 0.0

            # Item breakdown per month (for tooltip on CTN tap)
            def item_breakdown(month_label):
                m_rows = d_rows[d_rows["paid_on"] == month_label]
                if m_rows.empty:
                    return []
                grp = m_rows.groupby("item_code")["qty_ctn"].sum().reset_index()
                grp = grp[grp["qty_ctn"] > 0].sort_values("qty_ctn", ascending=False)
                return [{"item": str(r["item_code"]), "ctn": round(float(r["qty_ctn"]), 1)}
                        for _, r in grp.iterrows()]

            month_breakdown = {
                cur_m:   item_breakdown(cur_m),
                prev1_m: item_breakdown(prev1_m),
                prev2_m: item_breakdown(prev2_m),
            }

            # Volume drop
            volume_drop_pct = None
            if ctn_prev1 > 0 and ctn_cur < ctn_prev1:
                volume_drop_pct = round((ctn_prev1 - ctn_cur) / ctn_prev1 * 100, 1)

            # Trend arrow
            if ctn_cur > ctn_prev1:
                trend = "up"
            elif ctn_cur < ctn_prev1:
                trend = "down"
            else:
                trend = "flat"

            # SKU group status per group
            # green  = didn't buy last 3 months BUT bought this month (new penetration)
            # yellow = bought in last 3 months (regular — may or may not buy this month)
            # red    = not bought in last 3 months AND not this month (lapsed)
            sku_status = {}
            sku_bought_groups = 0
            sku_sales_type = {}  # sales type per SKU group this month
            for grp, codes in sku_groups.items():
                grp_rows = d_rows[d_rows["item_code"].isin(codes)]
                bought_this  = cur_m in grp_rows["paid_on"].values
                bought_past  = any(m in grp_rows["paid_on"].values for m in [prev1_m, prev2_m, prev3_m])
                if bought_this and not bought_past:
                    sku_status[grp] = "new_penetration"
                    sku_bought_groups += 1
                elif bought_past:
                    sku_status[grp] = "regular"
                    if bought_this:
                        sku_bought_groups += 1
                else:
                    sku_status[grp] = "lapsed"

                # Sales type for this SKU group this month
                if bought_this:
                    cur_grp_rows = grp_rows[grp_rows["paid_on"] == cur_m]
                    types = cur_grp_rows["sales_type"].unique().tolist()
                    # Pick best tier: Target > Grey Area > MA > MA Promo > Below MA
                    tier_order = ["Target", "Grey Area", "Master Agent 35/45/55",
                                  "Master Agent/Promo", "Below Master Agent"]
                    best = next((t for t in tier_order if t in types), types[0] if types else "")
                    sku_sales_type[grp] = best

            # Debtor info
            info = debtor_info.get(dcode, {})

            # New debtor (open date within 90 days)
            is_new = False
            open_date = info.get("open_date")
            if open_date and pd.notnull(open_date):
                try:
                    od = pd.to_datetime(open_date)
                    is_new = (datetime.now() - od).days <= 90
                except Exception:
                    pass

            # Birthday this month
            birth_date = info.get("birth_date")
            days_to_bday = None
            birthday_this_month = False
            if birth_date and pd.notnull(birth_date):
                try:
                    bd = pd.to_datetime(birth_date)
                    today_d = date.today()
                    next_bday = bd.replace(year=today_d.year).date()
                    if next_bday < today_d:
                        next_bday = bd.replace(year=today_d.year + 1).date()
                    days_to_bday = (next_bday - today_d).days
                    birthday_this_month = next_bday.month == today_d.month
                except Exception:
                    pass

            # 新增SKU — count groups where didn't buy last 3 months but bought this month
            new_sku_status = {}
            new_sku_count  = 0
            for grp, codes in new_sku_groups.items():
                grp_rows = d_rows[d_rows["item_code"].isin(codes)]
                bought_this  = cur_m in grp_rows["paid_on"].values
                bought_past  = any(m in grp_rows["paid_on"].values for m in [prev1_m, prev2_m, prev3_m])
                if bought_this and not bought_past:
                    new_sku_status[grp] = "new"   # counts!
                    new_sku_count += 1
                elif bought_past or bought_this:
                    new_sku_status[grp] = "existing"
                else:
                    new_sku_status[grp] = "none"

            # Sales type for this debtor this month
            cur_sales_types = d_rows[d_rows["paid_on"] == cur_m]["sales_type"].unique().tolist() if not d_rows.empty else []

            debtor_cards.append({
                "debtor_code":        dcode,
                "company_name":       info.get("name", dcode),
                "phone":              info.get("phone", ""),
                "debtor_type":        info.get("type", ""),
                "vip":                info.get("vip", False),
                "is_new":             is_new,
                "birthday_this_month": birthday_this_month,
                "days_to_birthday":   days_to_bday,
                "status":             status,
                "last_purchase_date": last_date_str,
                "ctn_cur":            ctn_cur,
                "ctn_prev1":          ctn_prev1,
                "ctn_prev2":          ctn_prev2,
                "month_breakdown":    month_breakdown,
                "volume_drop_pct":    volume_drop_pct,
                "trend":              trend,
                "sku_status":         sku_status,
                "sku_sales_type":     sku_sales_type,
                "sku_bought_groups":  sku_bought_groups,
                "sku_total_groups":   len(sku_groups),
                "new_sku_count":      new_sku_count,
                "new_sku_status":     new_sku_status,
                "new_sku_total":      len(new_sku_groups),
                "sales_types":        cur_sales_types,
            })

        # Sort: active first, then pending, then need_reactivation
        order = {"active": 0, "pending": 1, "need_reactivation": 2}
        debtor_cards.sort(key=lambda x: order.get(x["status"], 3))

        # Summary counts
        active_count   = sum(1 for d in debtor_cards if d["status"] == "active")
        pending_count  = sum(1 for d in debtor_cards if d["status"] == "pending")
        reactiv_count  = sum(1 for d in debtor_cards if d["status"] == "need_reactivation")
        total          = len(debtor_cards)

        # 持续光顾率 = active (excl. Personal) ÷ total (excl. Personal)
        # Exclude P-Personal debtor type from this calculation
        PERSONAL_TYPES = {"P-Personal", "P-PERSONAL", "personal", "Personal", "PERSONAL"}
        non_personal   = [d for d in debtor_cards if d.get("type","") not in PERSONAL_TYPES
                          and d.get("debtor_type","") not in PERSONAL_TYPES]
        np_total       = len(non_personal)
        np_active      = sum(1 for d in non_personal if d["status"] == "active")
        activation_rate = round(np_active / np_total * 100, 1) if np_total > 0 else 0

        # Agent total 新增SKU this month
        total_new_sku = sum(d["new_sku_count"] for d in debtor_cards)

        result[agent] = {
            "debtors":            debtor_cards,
            "total_debtors":      total,
            "active_count":       active_count,
            "pending_count":      pending_count,
            "reactivation_count": reactiv_count,
            "activation_rate":    activation_rate,
            "activation_base":    np_total,
            "activation_active":  np_active,
            "pending_activation": reactiv_count,
            "total_new_sku":      total_new_sku,
        }

    return result


# ── Module 5: Group Brand Targets ────────────────────────────────────────────

def calc_group_brand_targets(df, targets, cur_month, group_brand_config):
    """
    Group-level CTN vs target for 7 brands.
    Actual = sum of ALL agents' paid CTN for that brand's item codes.
    No RM36 filter (even for EVO).
    Target set monthly in Admin Page as single value per brand.
    """
    log("Calculating Group Brand Targets...")

    # Canggih paid this month only
    paid = df[
        (df["item_group"] != EIGHTCOM_GROUP) &
        (df["paid_on"] == cur_month)
    ]

    group_targets = targets.get("group_brand_targets", {})
    result = {}

    for brand, codes in group_brand_config.items():
        brand_rows = paid[paid["item_code"].isin(codes)]
        actual_ctn = round(float(brand_rows["qty_ctn"].sum()), 2)
        target_ctn = group_targets.get(brand)

        result[brand] = {
            "item_codes":  codes,
            "actual_ctn":  actual_ctn,
            "target_ctn":  target_ctn,
            "gap":         round(actual_ctn - target_ctn, 2) if target_ctn else None,
            "pct":         pct(actual_ctn, target_ctn),
            "color":       color_code(pct(actual_ctn, target_ctn)),
        }

    return result


# ── Team summary ──────────────────────────────────────────────────────────────

def calc_team_summary(sales_prog, brand_comm, agents, targets, cur_month):
    """Aggregate team-level totals for management view."""
    log("Calculating team summary...")

    team_targets = targets.get("team", {})
    t1_total = sum(
        targets.get("agents", {}).get(a, {}).get("sales_progression", {}).get("normal_t1", 0) or 0
        for a in agents
    )

    team_normal_ctn = sum(sales_prog.get(a, {}).get("normal_ctn", 0) for a in agents)
    team_ga_ctn     = sum(sales_prog.get(a, {}).get("ga_ctn", 0) for a in agents)
    team_ma_ctn     = sum(sales_prog.get(a, {}).get("ma_ctn", 0) for a in agents)
    team_canggih    = sum(sales_prog.get(a, {}).get("total_canggih_ctn", 0) for a in agents)
    team_8com       = sum(sales_prog.get(a, {}).get("eightcom_paid_ctn", 0) for a in agents)

    # Brand commission team totals
    brand_summary = {}
    for brand in DEFAULT_BRAND_CONFIG.keys():
        total_comm = sum(
            brand_comm.get(a, {}).get(brand, {}).get("comm_earned", 0)
            for a in agents
        )
        both_hit_agents = [
            a for a in agents
            if brand_comm.get(a, {}).get(brand, {}).get("both_hit", False)
        ]
        one_hit_agents = [
            a for a in agents
            if brand_comm.get(a, {}).get(brand, {}).get("status") == "one_hit"
        ]
        none_hit_agents = [
            a for a in agents
            if brand_comm.get(a, {}).get(brand, {}).get("status") == "none_hit"
        ]
        brand_summary[brand] = {
            "total_comm":       round(total_comm, 2),
            "both_hit_agents":  both_hit_agents,
            "one_hit_agents":   one_hit_agents,
            "none_hit_agents":  none_hit_agents,
        }

    # Agent leaderboard (sorted by Normal T1 %)
    leaderboard = []
    for agent in agents:
        sp = sales_prog.get(agent, {})
        t1_tgt = targets.get("agents", {}).get(agent, {}).get(
            "sales_progression", {}).get("normal_t1")
        t1_pct = pct(sp.get("normal_ctn", 0), t1_tgt) if t1_tgt else None
        brands_earned = sum(
            1 for brand in DEFAULT_BRAND_CONFIG
            if brand_comm.get(agent, {}).get(brand, {}).get("both_hit", False)
        )
        leaderboard.append({
            "agent":          agent,
            "normal_ctn":     sp.get("normal_ctn", 0),
            "t1_target":      t1_tgt,
            "t1_pct":         t1_pct,
            "t1_color":       color_code(t1_pct),
            "brands_earned":  brands_earned,
        })
    leaderboard.sort(key=lambda x: (x["t1_pct"] or 0), reverse=True)
    for i, entry in enumerate(leaderboard):
        entry["rank"] = i + 1

    return {
        "team_normal_ctn":   round(team_normal_ctn, 2),
        "team_ga_ctn":       round(team_ga_ctn, 2),
        "team_ma_ctn":       round(team_ma_ctn, 2),
        "team_canggih_ctn":  round(team_canggih, 2),
        "team_8com_ctn":     round(team_8com, 2),
        "t1_total_target":   t1_total,
        "t1_pct":            pct(team_normal_ctn, t1_total),
        "t1_color":          color_code(pct(team_normal_ctn, t1_total)),
        "brand_summary":     brand_summary,
        "leaderboard":       leaderboard,
    }


# ── Module: KPI Calculation ───────────────────────────────────────────────────

def calc_kpi(agents, targets, sales_prog, brand_comm, debtor_cards):
    """
    Calculate KPI scores for Sections A, B, C.
    Section D & E keyed in manually by Accounts (later).
    Scoring: min(actual/target, 1.0) × weight = score points
    """
    log("Calculating KPI scores...")

    kpi_config = targets.get("kpi_config", {})

    # ── Default weightages ────────────────────────────────────────────────────
    KPI_ITEMS = [
        # key                   label                          section  weight
        ("sales_normal_pct",    "销售 Normal %",               "A",     0.35),
        ("new_accounts",        "开新户口",                     "B",     0.04),
        ("vip_count",           "VIP 招聘",                    "B",     0.01),
        ("reactivation",        "激活户口",                     "B",     0.03),
        ("new_sku",             "加SKU数量",                    "B",     0.03),
        ("activation_rate",     "持续光顾率",                   "B",     0.03),
        ("event",               "Event / PSR",                 "B",     0.03),
        ("alt_channel",         "来自替代渠道的销售",            "B",     0.02),
        ("case_followup",       "确保70%案件7天内完成",          "B",     0.03),
        ("evo_pen",             "EVO Penetration",             "B",     0.015),
        ("evo_target",          "EVO Target",                  "B",     0.015),
        ("iface_pen",           "iFACE Penetration",           "B",     0.015),
        ("iface_target",        "iFACE Target",                "B",     0.015),
        ("sukun_pen",           "SUKUN Penetration",           "B",     0.015),
        ("sukun_target",        "SUKUN Target",                "B",     0.015),
        ("bison_pen",           "BISON Penetration",           "B",     0.015),
        ("bison_target",        "BISON Target",                "B",     0.015),
        ("tr20_pen",            "TR20 Penetration",            "B",     0.015),
        ("tr20_target",         "TR20 Target",                 "B",     0.015),
        ("birthday_campaign",   "生日礼物 Campaign",            "C",     0.01),
        ("iface_campaign",      "iFACE Campaign",              "C",     0.02),
    ]

    def score_item(actual, target, weight):
        """Score = min(actual/target, 1.0) × weight × 100"""
        if not target or target == 0: return 0.0
        return round(min(float(actual or 0) / float(target), 1.0) * weight * 100, 3)

    result = {}

    for agent in agents:
        ag_cfg  = targets.get("agents", {}).get(agent, {})
        kpi_ag  = kpi_config.get(agent, {})
        # KPI targets now stored under agent.kpi_targets in targets.json
        kpi_tgts = ag_cfg.get("kpi_targets", {})
        # Manual scores stored under agent.kpi_manual
        manual = ag_cfg.get("kpi_manual", {})

        # ── Pull actuals ──────────────────────────────────────────────────────
        sp = sales_prog.get(agent, {})
        bc = brand_comm.get(agent, {})
        dc = debtor_cards.get(agent, {})

        normal_pct    = (sp.get("tiers", {}).get("normal_t1", {}).get("pct", 0) or 0)
        debtors       = dc.get("debtors", [])
        new_acc_count = sum(1 for d in debtors if d.get("is_new", False))
        vip_count     = sum(1 for d in debtors if d.get("vip", False))
        reactiv_count = dc.get("reactivation_count", 0) or 0
        new_sku_count = dc.get("total_new_sku", 0) or 0
        act_rate      = dc.get("activation_rate", 0) or 0

        # Manual entries from agent config
        event_actual     = manual.get("event", 0) or 0
        alt_ch_score     = manual.get("alt_channel", 0) or 0
        case_fu_score    = manual.get("case_followup", 0) or 0
        bday_camp_score  = manual.get("birthday_campaign", 0) or 0
        iface_camp_score = manual.get("iface_campaign", 0) or 0

        # Brand commission data
        def bdata(brand):
            d = bc.get(brand, {})
            return {
                "pen_actual":  d.get("penetration", {}).get("count", 0) or 0,
                "pen_target":  d.get("penetration", {}).get("target", 1) or 1,
                "ctn_actual":  d.get("ctn", {}).get("sold", 0) or 0,
                "ctn_target":  d.get("ctn", {}).get("target", 1) or 1,
            }

        bv = {b: bdata(b) for b in ["EVO","iFACE","SUKUN","BISON","TR20"]}

        # ── Build items with scores ───────────────────────────────────────────
        # Get targets from kpi_tgts (set per agent in Admin Page under kpi_targets)
        def tgt(key, default): return float(kpi_tgts.get(key, default) or default)

        actuals = {
            "sales_normal_pct": normal_pct,
            "new_accounts":     new_acc_count,
            "vip_count":        vip_count,
            "reactivation":     reactiv_count,
            "new_sku":          new_sku_count,
            "activation_rate":  act_rate,
            "event":            event_actual,
            "evo_pen":          bv["EVO"]["pen_actual"],
            "evo_target":       bv["EVO"]["ctn_actual"],
            "iface_pen":        bv["iFACE"]["pen_actual"],
            "iface_target":     bv["iFACE"]["ctn_actual"],
            "sukun_pen":        bv["SUKUN"]["pen_actual"],
            "sukun_target":     bv["SUKUN"]["ctn_actual"],
            "bison_pen":        bv["BISON"]["pen_actual"],
            "bison_target":     bv["BISON"]["ctn_actual"],
            "tr20_pen":         bv["TR20"]["pen_actual"],
            "tr20_target":      bv["TR20"]["ctn_actual"],
        }

        item_targets = {
            "sales_normal_pct": tgt("sales_normal_pct", 100),
            "new_accounts":     tgt("new_accounts",     5),
            "vip_count":        tgt("vip_count",        3),
            "reactivation":     tgt("reactivation",     5),
            "new_sku":          tgt("new_sku",          17),
            "activation_rate":  tgt("activation_rate",  80),
            "event":            tgt("event",            16),
            "evo_pen":          bv["EVO"]["pen_target"],
            "evo_target":       bv["EVO"]["ctn_target"],
            "iface_pen":        bv["iFACE"]["pen_target"],
            "iface_target":     bv["iFACE"]["ctn_target"],
            "sukun_pen":        bv["SUKUN"]["pen_target"],
            "sukun_target":     bv["SUKUN"]["ctn_target"],
            "bison_pen":        bv["BISON"]["pen_target"],
            "bison_target":     bv["BISON"]["ctn_target"],
            "tr20_pen":         bv["TR20"]["pen_target"],
            "tr20_target":      bv["TR20"]["ctn_target"],
        }

        items_out = {}
        total_auto_score  = 0.0
        total_manual_score = 0.0
        total_max_auto    = 0.0

        for key, label, section, default_weight in KPI_ITEMS:
            # Per-agent weight override from Admin
            weight = float(kpi_ag.get(f"{key}_weight", default_weight))

            if key in ("alt_channel", "case_followup"):
                # Manual score entered directly (not actual/target ratio)
                # alt_channel max = weight*100, entered as direct score
                sc = round(min(float(manual.get(key, 0) or 0), weight * 100), 3)
                items_out[key] = {
                    "label": label, "section": section, "weight": weight,
                    "actual": manual.get(key, 0), "target": None,
                    "score": sc, "max_score": round(weight * 100, 3),
                    "pct": round(sc / (weight * 100) * 100, 1) if weight else 0,
                    "source": "manual", "input_role": "management" if key == "case_followup" else "marketing",
                }
                total_manual_score += sc

            elif key in ("birthday_campaign", "iface_campaign"):
                sc = round(min(float(manual.get(key, 0) or 0), weight * 100), 3)
                items_out[key] = {
                    "label": label, "section": section, "weight": weight,
                    "actual": manual.get(key, 0), "target": None,
                    "score": sc, "max_score": round(weight * 100, 3),
                    "pct": round(sc / (weight * 100) * 100, 1) if weight else 0,
                    "source": "manual", "input_role": "marketing",
                }
                total_manual_score += sc

            elif key == "event":
                sc = score_item(actuals[key], item_targets[key], weight)
                items_out[key] = {
                    "label": label, "section": section, "weight": weight,
                    "actual": actuals[key], "target": item_targets[key],
                    "score": sc, "max_score": round(weight * 100, 3),
                    "pct": round(actuals[key] / item_targets[key] * 100, 1) if item_targets[key] else 0,
                    "source": "manual", "input_role": "agent",
                }
                total_manual_score += sc

            else:
                actual = actuals.get(key, 0)
                target = item_targets.get(key, 1)
                sc     = score_item(actual, target, weight)
                pct    = round(actual / target * 100, 1) if target else 0
                items_out[key] = {
                    "label": label, "section": section, "weight": weight,
                    "actual": actual, "target": target,
                    "score": sc, "max_score": round(weight * 100, 3),
                    "pct": pct,
                    "source": "auto", "input_role": "system",
                }
                total_auto_score  += sc
                total_manual_score += 0  # counted separately

        # Section scores
        section_scores = {}
        for sec in ["A", "B", "C"]:
            sec_items = {k: v for k, v in items_out.items() if v["section"] == sec}
            section_scores[sec] = {
                "score":     round(sum(v["score"] for v in sec_items.values()), 3),
                "max_score": round(sum(v["max_score"] for v in sec_items.values()), 3),
            }

        total_abc = round(sum(v["score"] for v in items_out.values()), 3)
        max_abc   = round(sum(v["max_score"] for v in items_out.values()), 3)

        result[agent] = {
            "items":          items_out,
            "section_scores": section_scores,
            "total_abc":      total_abc,
            "max_abc":        max_abc,
            "total_pct":      round(total_abc / max_abc * 100, 1) if max_abc else 0,
            # Placeholder for D & E (keyed by Accounts dept)
            "section_d":      {"score": manual.get("section_d_score", None), "max_score": 20.0},
            "section_e":      {"score": manual.get("section_e_score", None), "max_score": 5.0},
            "grand_total":    round(total_abc + (manual.get("section_d_score") or 0) + (manual.get("section_e_score") or 0), 3),
        }

    return result

def calc_working_days():
    """Calculate working day progress for current month."""
    today = date.today()
    first_day = today.replace(day=1)

    # Count Mon–Sat as working days (adjust if your team uses different schedule)
    total_working = 0
    elapsed_working = 0
    d = first_day
    import calendar
    last_day = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    while d <= last_day:
        if d.weekday() < 6:  # Mon=0 ... Sat=5, Sun=6
            total_working += 1
            if d <= today:
                elapsed_working += 1
        d += timedelta(days=1)

    theoretical_pct = round(elapsed_working / total_working * 100, 2) if total_working else 0

    return {
        "date":              today.strftime("%Y-%m-%d"),
        "month_label":       today.strftime("%b %Y"),
        "total_working_days":  total_working,
        "elapsed_working_days": elapsed_working,
        "theoretical_pct":   theoretical_pct,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    log("=" * 60)
    log("MD Sales Dashboard — process_data.py (Phase 2)")
    log("=" * 60)

    today      = date.today()
    cur_month  = current_month_label(today)
    prev_months = prev_month_labels(3, today)
    log(f"Current month: {cur_month}  |  Lookback: {prev_months}")

    # ── Load data ──────────────────────────────────────────────────
    targets   = load_targets()
    df_raw    = load_sales_report()
    debtor_df = load_debtors()

    # ── Scope filter ───────────────────────────────────────────────
    df = filter_scope(df_raw)

    # ── Brand config (from targets.json or default) ─────────────────
    brand_config = targets.get("brand_config", DEFAULT_BRAND_CONFIG)
    group_brand_config = targets.get("group_brand_config", DEFAULT_GROUP_BRAND_CONFIG)

    # ── Agent list ─────────────────────────────────────────────────
    # Use agents defined in targets.json; fall back to agents found in data
    agents_from_targets = list(targets.get("agents", {}).keys())
    agents_from_data    = sorted(df["agent"].unique().tolist())
    agents = agents_from_targets if agents_from_targets else agents_from_data
    agents = [a for a in agents if a]  # remove blanks
    log(f"Agents: {agents}")

    # ── Run modules ─────────────────────────────────────────────────
    sales_prog  = calc_sales_progression(df, targets, agents, cur_month)
    brand_comm  = calc_brand_commission(df, targets, agents, cur_month, prev_months, brand_config)
    newbie      = calc_newbie_scheme(df, targets, agents, cur_month)
    aging       = calc_aging(df, agents, cur_month)
    debtor_cards = calc_debtor_cards(df, debtor_df, agents, cur_month)
    group_brands = calc_group_brand_targets(df, targets, cur_month, group_brand_config)
    kpi         = calc_kpi(agents, targets, sales_prog, brand_comm, debtor_cards)
    team        = calc_team_summary(sales_prog, brand_comm, agents, targets, cur_month)
    working_days = calc_working_days()

    # ── Assemble output ─────────────────────────────────────────────
    output = {
        "generated_at":   datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "current_month":  cur_month,
        "working_days":   working_days,
        "group_brand_targets": group_brands,
        "agents":         {},
        "team":           team,
        "config": {
            "brand_config":       brand_config,
            "group_brand_config": group_brand_config,
            "inhouse_codes":      targets.get("inhouse_codes", DEFAULT_INHOUSE_CODES),
            "scope":              SCOPE_AREA,
        }
    }

    for agent in agents:
        output["agents"][agent] = {
            "sales_progression":  sales_prog.get(agent, {}),
            "brand_commission":   brand_comm.get(agent, {}),
            "newbie_scheme":      newbie.get(agent, None),
            "aging":              aging.get(agent, {}),
            "debtor_cards":       debtor_cards.get(agent, {}),
            "kpi":                kpi.get(agent, {}),
        }

    # ── Write JSON ──────────────────────────────────────────────────
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)

    size_kb = OUTPUT_FILE.stat().st_size / 1024
    log(f"\n✅ dashboard_data.json written — {size_kb:.0f} KB")
    log(f"   {len(agents)} agents  |  {cur_month}  |  Scope: {SCOPE_AREA}")
    log("=" * 60)


if __name__ == "__main__":
    main()
