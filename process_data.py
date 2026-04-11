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
CAMPAIGNS_FILE  = BASE_DIR / "campaigns.json"
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


def get_monthly_targets(targets, cur_month):
    # Return agent targets for the given month, falling back to current targets
    monthly = targets.get("monthly_targets", {})
    if cur_month and cur_month in monthly:
        return monthly[cur_month]
    return targets.get("agents", {})


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

    # Read columns A:Z — row 0 is the real header (Tranx Mth, Doc. No., etc.)
    df = pd.read_excel(
        SALES_FILE,
        sheet_name=0,        # Read first sheet regardless of name (works for MD, Sheet1, etc.)
        header=0,        # row 0 = actual headers
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
    """Keep only GRP 2A and GRP 2 rows (strip whitespace first)."""
    df["area_code"] = df["area_code"].str.strip()
    ben_raw = df[df["agent"] == "BEN"]
    scoped = df[df["area_code"].isin(["GRP 2A", "GRP 2"])].copy()
    log(f"  Scope filter (GRP 2A + GRP 2): {len(scoped):,} rows retained")
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

    ben_canggih = canggih_paid[canggih_paid["agent"] == "BEN"]

    # All rows for unpaid calc
    eightcom_all = df[df["item_group"] == EIGHTCOM_GROUP]

    # Working days for avg calculation
    wd = calc_working_days(targets=None, cur_month=cur_month)
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
        monthly_agents = get_monthly_targets(targets, cur_month)
        ag_tgts   = monthly_agents.get(agent, targets.get("agents", {}).get(agent, {}))
        sp_tgts   = ag_tgts.get("sales_progression", {})

        ag_canggih     = canggih_paid[canggih_paid["agent"] == agent]
        ag_canggih_all = canggih_all[canggih_all["agent"] == agent]

        # Tier split
        mapped_type = ag_canggih["sales_type"].map(SALES_TYPE_MAP)
        normal_ctn = ag_canggih[mapped_type == "normal"]["qty_ctn"].sum()
        ga_ctn     = ag_canggih[mapped_type == "ga"]["qty_ctn"].sum()
        ma_ctn     = ag_canggih[mapped_type == "ma"]["qty_ctn"].sum()
        # Any rows with unmapped sales_type go into normal (don't lose CTN)
        unmapped_ctn = ag_canggih[mapped_type.isna()]["qty_ctn"].sum()
        if unmapped_ctn > 0:
            unmapped_types = ag_canggih[mapped_type.isna()]["sales_type"].unique().tolist()
            log(f"  {agent}: {round(float(unmapped_ctn),1)} CTN with unmapped sales_type: {unmapped_types} → added to Normal")
            normal_ctn += unmapped_ctn
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

        if agent == "BEN":
            unmapped = ag_canggih[~ag_canggih['sales_type'].isin(SALES_TYPE_MAP.keys())]

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
        monthly_agents = get_monthly_targets(targets, cur_month)
        ag_tgts   = monthly_agents.get(agent, targets.get("agents", {}).get(agent, {}))
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

            # ── Non-buyers (haven't bought in last 3 months) ───────────────
            # All debtors for this agent
            all_agent_debtors = set(df[df["agent"] == agent]["debtor_code"].unique())
            non_buyers = all_agent_debtors - prev_buyers
            non_buyer_count = len(non_buyers)

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
                "status":         status,
                "comm_earned":    comm_earned,
                "both_hit":       both_hit,
                "prev_buyers":    len(prev_buyers),
                "non_buyers":     non_buyer_count,
                "cur_buyers":     len(cur_buyers),
                "new_penetrations": penetration_count,
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
        all_unpaid_invoices = []

        for _, row in all_unpaid.iterrows():
            inv_date = row.get("date_parsed")
            if pd.isnull(inv_date):
                continue
            days_outstanding = (datetime.now() - inv_date).days
            inv = {
                "doc_no":           row.get("doc_no", ""),
                "debtor_code":      row.get("debtor_code", ""),
                "company_name":     row.get("company_name", ""),
                "invoice_date":     inv_date.strftime("%d/%m/%Y"),
                "days_outstanding": days_outstanding,
                "qty_ctn":          round(float(row.get("qty_ctn", 0)), 2),
                "item_code":        row.get("item_code", ""),
                "overdue":          days_outstanding >= OVERDUE_DAYS,
            }
            all_unpaid_invoices.append(inv)
            if days_outstanding >= OVERDUE_DAYS:
                overdue_invoices.append(inv)

        overdue_invoices.sort(key=lambda x: x["days_outstanding"], reverse=True)
        all_unpaid_invoices.sort(key=lambda x: x["days_outstanding"], reverse=True)

        # Group all unpaid by debtor for drill-down view
        debtor_outstanding = {}
        for inv in all_unpaid_invoices:
            dcode = inv["debtor_code"]
            if dcode not in debtor_outstanding:
                debtor_outstanding[dcode] = {
                    "debtor_code":   dcode,
                    "company_name":  inv["company_name"],
                    "total_ctn":     0,
                    "overdue_ctn":   0,
                    "invoice_count": 0,
                    "overdue_count": 0,
                    "oldest_days":   0,
                    "invoices":      [],
                }
            d = debtor_outstanding[dcode]
            d["total_ctn"]     = round(d["total_ctn"] + inv["qty_ctn"], 2)
            d["invoice_count"] += 1
            d["oldest_days"]    = max(d["oldest_days"], inv["days_outstanding"])
            if inv["overdue"]:
                d["overdue_ctn"]   = round(d["overdue_ctn"] + inv["qty_ctn"], 2)
                d["overdue_count"] += 1
            d["invoices"].append(inv)

        # Sort by oldest invoice first
        debtor_list = sorted(debtor_outstanding.values(), key=lambda x: x["oldest_days"], reverse=True)

        result[agent] = {
            "canggih_paid_ctn":      canggih_paid,
            "canggih_unpaid_ctn":    canggih_unpaid,
            "eightcom_paid_ctn":     eightcom_paid,
            "eightcom_unpaid_ctn":   eightcom_unpaid,
            "overdue_count":         len(overdue_invoices),
            "overdue_invoices":      overdue_invoices,
            "all_unpaid_invoices":   all_unpaid_invoices,
            "debtor_outstanding":    debtor_list,
            "outstanding_debtors":   len(debtor_list),
        }

    return result


# ── Phase 1 compatibility: existing debtor card data ─────────────────────────

def _calc_camp_progress(dcode, agent, campaign_map, d_rows, cur_m, area_groups):
    """Calculate campaign progress for a single debtor."""
    import copy
    camps = copy.deepcopy(campaign_map.get(dcode, []))
    if not camps:
        return []

    # Determine debtor's group from area_groups
    # area_groups maps area_code → group; agent's area is GRP 2A etc.
    # We'll resolve group from the area_code in the transaction rows
    debtor_area = ""
    if not d_rows.empty and "area_code" in d_rows.columns:
        debtor_area = d_rows["area_code"].iloc[0] if not d_rows.empty else ""
    group = area_groups.get(debtor_area, "")

    for camp in camps:
        camp["group"] = group

        # Resolve FOC item based on group
        foc_rule = camp.get("foc_item_rule", {})
        if foc_rule and group:
            camp["foc_item_resolved"] = foc_rule.get(group, camp.get("foc_item", ""))
        else:
            camp["foc_item_resolved"] = camp.get("foc_item", "")

        # Get this month's CTN for this brand
        brand    = camp.get("brand", "")
        brand_codes = []
        if brand:
            # Map brand to item codes using DEFAULT_BRAND_CONFIG
            brand_codes = DEFAULT_BRAND_CONFIG.get(brand, [])

        # Filter rows: this month + Target sales type only (if eligible_sales_type set)
        eligible_st = camp.get("eligible_sales_type", [])
        cur_rows = d_rows[d_rows["paid_on"] == cur_m] if not d_rows.empty else d_rows
        if eligible_st and not cur_rows.empty:
            cur_rows = cur_rows[cur_rows["sales_type"].isin(eligible_st)]
        if brand_codes and not cur_rows.empty:
            cur_rows = cur_rows[cur_rows["item_code"].isin(brand_codes)]

        ctn_this_month = round(float(cur_rows["qty_ctn"].sum()), 2) if not cur_rows.empty else 0.0
        camp["ctn_this_month"] = ctn_this_month

        # Calculate FOC earned and qualified status
        min_ctn    = camp.get("min_order_ctn", 0) or 0
        accum      = camp.get("accumulation", "per_transaction")
        r_limit    = camp.get("redemption_limit", 0) or 0
        r_unit     = camp.get("redemption_unit", "ctn")
        foc_per_t  = camp.get("foc_per_threshold", 0) or 0
        foc_per_c  = camp.get("foc_per_ctn", 0) or 0
        r_type     = camp.get("redemption_type", "free_goods")

        foc_earned  = 0
        qualified   = False

        if accum == "one_time":
            # Hit threshold once = 1 redemption
            qualified  = ctn_this_month >= min_ctn
            foc_earned = 1 if qualified else 0

        elif accum == "per_transaction":
            # Each invoice that hits threshold = 1 redemption
            # We approximate using total CTN ÷ threshold (floor)
            if min_ctn > 0:
                redemptions = int(ctn_this_month // min_ctn)
                foc_earned  = redemptions * foc_per_t if foc_per_t else redemptions
                qualified   = redemptions > 0
            # Apply cap
            if r_limit > 0 and foc_earned > r_limit:
                foc_earned = r_limit

        elif accum == "accumulate":
            # Accumulate total CTN, every min_ctn = foc_per_ctn packs
            if min_ctn > 0 and foc_per_c > 0:
                packs = int(ctn_this_month // min_ctn) * foc_per_c
                foc_earned = min(packs, r_limit) if r_limit > 0 else packs
                qualified  = foc_earned > 0
            elif ctn_this_month >= min_ctn:
                qualified  = True
                foc_earned = 1

        elif accum == "tiered_accumulate":
            if min_ctn > 0:
                redemptions = int(ctn_this_month // min_ctn)
                foc_earned  = redemptions * foc_per_t if foc_per_t else redemptions
                qualified   = redemptions > 0

        camp["foc_earned"]  = foc_earned
        camp["qualified"]   = qualified

    return camps



def _parse_birth_date(val):
    """Safely parse birth date — handles Excel serial numbers, strings, and datetime objects."""
    if val is None: return None
    try:
        if pd.isnull(val): return None
    except: pass
    try:
        # Handle Excel date serial number (e.g. 45808)
        if isinstance(val, (int, float)) and 20000 < float(val) < 55000:
            from datetime import datetime, timedelta
            # Excel epoch is 1900-01-01, with leap year bug (+1 offset)
            d = datetime(1899, 12, 30) + timedelta(days=int(val))
            return pd.Timestamp(d)
        # Handle string or datetime
        return pd.to_datetime(val, format='mixed', dayfirst=True, errors='coerce')
    except:
        return None

def calc_debtor_cards(df, debtor_df, agents, cur_month, campaign_map=None, area_groups=None):
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
    # Use cur_month (auto-detected from data) NOT date.today()
    # so that when April has no data and we fall back to March,
    # 本月 = Mar, M-1 = Feb, M-2 = Jan (not Apr/Mar/Feb)
    MONTH_ORDER_DC = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    try:
        parts = cur_month.split()
        mon_idx = MONTH_ORDER_DC.index(parts[0])
        yr = int(parts[1])
        anchor = date(2000 + yr, mon_idx + 1, 1)
    except Exception:
        anchor = date.today().replace(day=1)
    months = []
    d = anchor
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

            # Activation status
            # active         = bought this month
            # pending        = bought last month but not this month yet
            # need_reactivation = bought prev-prev month but missed last month (your Excel definition)
            # long_inactive  = didn't buy in prev-prev month either
            if d_rows.empty:
                status = "need_reactivation"
            else:
                bought_cur   = cur_m   in d_rows["paid_on"].values
                bought_prev1 = prev1_m in d_rows["paid_on"].values
                bought_prev2 = prev2_m in d_rows["paid_on"].values if prev2_m else False
                if bought_cur:
                    status = "active"
                elif bought_prev1:
                    status = "pending"
                elif bought_prev2:
                    status = "need_reactivation"  # bought 2 months ago, missed last month → visit needed
                else:
                    status = "need_reactivation"  # long inactive — still shows as 待激活

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
            birth_month = None  # store raw birth month (1-12) for frontend to check per selected month
            if birth_date and pd.notnull(birth_date):
                try:
                    bd = _parse_birth_date(birth_date)
                    if bd is None or pd.isnull(bd):
                        birth_date = None
                    else:
                        birth_month = int(bd.month)  # always store this
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

            # Overdue flag — check if this debtor has any overdue invoices
            ag_unpaid = df[(df["agent"]==agent) & (df["debtor_code"]==dcode) & (df["paid_on"]=="")].copy()
            has_overdue = False
            overdue_amount = 0.0
            if not ag_unpaid.empty:
                today_d2 = date.today()
                for _, row in ag_unpaid.iterrows():
                    inv_date = row.get("date_parsed")
                    if pd.notnull(inv_date):
                        days = (datetime.now() - inv_date).days
                        if days >= OVERDUE_DAYS:
                            has_overdue = True
                            overdue_amount += float(row.get("qty_ctn", 0))

            # Avg CTN (last 3 months) for order progression
            avg_ctn = round((ctn_prev1 + ctn_prev2 + ctn_cur) / 3, 1) if any([ctn_prev1, ctn_prev2, ctn_cur]) else 0

            debtor_cards.append({
                "debtor_code":        dcode,
                "company_name":       info.get("name", dcode),
                "phone":              info.get("phone", ""),
                "debtor_type":        info.get("type", ""),
                "vip":                info.get("vip", False),
                "is_new":             is_new,
                "birthday_this_month": birthday_this_month,
                "birth_date_raw":     str(_parse_birth_date(birth_date)) if birth_date and pd.notnull(birth_date) and _parse_birth_date(birth_date) is not None else None,
                "days_to_birthday":   days_to_bday,
                "birth_month":        birth_month,
                "birth_day":          (_parse_birth_date(info.get("birth_date")) or pd.NaT).day if _parse_birth_date(info.get("birth_date")) is not None and not pd.isnull(_parse_birth_date(info.get("birth_date"))) else None,
                "status":             status,
                "last_purchase_date": last_date_str,
                "ctn_cur":            ctn_cur,
                "ctn_prev1":          ctn_prev1,
                "ctn_prev2":          ctn_prev2,
                "avg_ctn_3m":         avg_ctn,
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
                "campaigns":          _calc_camp_progress(
                                        dcode, agent, (campaign_map or {}),
                                        d_rows, cur_m, area_groups
                                    ),
                "brand_camp_tiers":   {},
                "has_overdue":        has_overdue,
                "overdue_ctn":        round(overdue_amount, 1),
            })

        # Sort: active first, then pending, then need_reactivation
        order = {"active": 0, "pending": 1, "need_reactivation": 2}
        debtor_cards.sort(key=lambda x: order.get(x["status"], 3))

        # Summary counts
        active_count   = sum(1 for d in debtor_cards if d["status"] == "active")
        pending_count  = sum(1 for d in debtor_cards if d["status"] == "pending")
        # 待激活 = bought prev-prev month (e.g. Feb) but missed prev month (e.g. Mar) → need reactivation visit
        inactive_count = sum(
            1 for d in debtor_cards
            if (d.get("ctn_prev2", 0) or 0) > 0
            and (d.get("ctn_prev1", 0) or 0) == 0
            and (d.get("ctn_cur",   0) or 0) == 0
        )
        total          = len(debtor_cards)

        # 激活户口 = debtors who bought THIS month but NOT last month
        # Any debtor returning after a missed month counts as reactivation
        # Excludes: brand new accounts (is_new=True) — those count under new accounts KPI instead
        reactiv_count = sum(
            1 for d in debtor_cards
            if (d.get("ctn_cur", 0) or 0) > 0
            and (d.get("ctn_prev1", 0) or 0) == 0
            and not d.get("is_new", False)
        )

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
            "inactive_count":     inactive_count,
            "activation_rate":    activation_rate,
            "activation_base":    np_total,
            "activation_active":  np_active,
            "pending_activation": inactive_count,
            "total_new_sku":      total_new_sku,
        }

    return result


# ── Module 5: Group Brand Targets ────────────────────────────────────────────

def calc_group_brand_targets(df, targets, cur_month, group_brand_config):
    """Team-level CTN totals vs targets for 7 brand groups."""
    log("Calculating Group Brand Targets...")
    paid = df[df["paid_on"] == cur_month]
    canggih_paid = paid[paid["item_group"] != EIGHTCOM_GROUP]
    gb_targets = targets.get("group_brand_targets", {})
    result = {}
    for brand, codes in group_brand_config.items():
        actual = float(canggih_paid[canggih_paid["item_code"].isin(codes)]["qty_ctn"].sum())
        target = float(gb_targets.get(brand, 0) or 0)
        result[brand] = {
            "actual_ctn": round(actual, 1),
            "target_ctn": target,
            "gap":        round(actual - target, 1) if target else None,
            "pct":        pct(actual, target),
            "item_codes": list(codes),
        }
    return result


def save_debtor_snapshot(debtor_cards, targets, cur_month):
    """
    Save month-start debtor count per agent to targets.json.
    Only saves if no snapshot exists for this month yet (preserves Day 1 count).
    Also auto-calculates KPI targets based on debtor counts.
    """
    PERSONAL_TYPES = {"P-Personal","P-PERSONAL","personal","Personal","PERSONAL"}

    snapshots = targets.get("monthly_snapshots", {})

    # Only save if no snapshot for this month yet
    if cur_month not in snapshots:
        log(f"  Saving month-start debtor snapshot for {cur_month}...")
        snap = {}
        for agent, adata in debtor_cards.items():
            debtors     = adata.get("debtors", [])
            non_personal = [d for d in debtors
                           if d.get("debtor_type","") not in PERSONAL_TYPES]
            # Prev month inactive = need_reactivation (didn't buy last month)
            prev_inactive = [d for d in non_personal if d.get("status") == "need_reactivation"]
            snap[agent] = {
                "total_debtors":      len(debtors),
                "non_personal":       len(non_personal),
                "prev_inactive":      len(prev_inactive),
                "captured_date":      date.today().isoformat(),
            }
        snapshots[cur_month] = snap
        targets["monthly_snapshots"] = snapshots

        # Auto-calculate KPI targets from snapshot (only if not manually overridden)
        for agent, s in snap.items():
            ag_cfg = targets.get("agents", {}).get(agent, {})
            kpi_tgts = ag_cfg.get("kpi_targets", {})
            overrides = ag_cfg.get("kpi_overrides", {})  # manual overrides

            np_total     = s["non_personal"]
            prev_inactive = s["prev_inactive"]

            # Auto-calculate unless manually overridden
            if "activation_rate" not in overrides:
                kpi_tgts["activation_rate"] = 80  # % target stays 80%
            if "vip_count" not in overrides:
                kpi_tgts["vip_count"] = max(1, round(np_total * 0.20))
            if "reactivation" not in overrides:
                kpi_tgts["reactivation"] = max(1, round(prev_inactive * 0.40))
            # new_sku stays 17 unless overridden
            if "new_sku" not in overrides:
                kpi_tgts["new_sku"] = overrides.get("new_sku", 17)

            ag_cfg["kpi_targets"]   = kpi_tgts
            ag_cfg["kpi_auto_base"] = {
                "non_personal":  np_total,
                "prev_inactive": prev_inactive,
                "month":         cur_month,
            }
            targets["agents"][agent] = ag_cfg

        # Save updated targets.json
        with open(TARGETS_FILE, "w", encoding="utf-8") as f:
            json.dump(targets, f, ensure_ascii=False, indent=2)
        log(f"  ✅ Snapshot saved + KPI targets auto-calculated for {len(snap)} agents")
    else:
        log(f"  Snapshot for {cur_month} already exists — skipping (Day 1 count preserved)")

    return targets



def calc_birthday_campaign(debtor_cards, targets, cur_month=None):
    """
    Auto-generate birthday gift list:
    - VIP debtors only
    - Exclude P-Personal
    - Exclude new accounts opened this month
    - Target = total qualifying debtors (management audits agent's actual)
    - Birthday matching uses cur_month (selected month), not today
    """
    log("Generating birthday campaign list...")
    today      = date.today()
    overrides  = targets.get("birthday_overrides", {})

    # Determine which month to use for birthday matching
    MONTH_ORDER_BD = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    bday_month = today.month  # default to today
    bday_year  = today.year
    if cur_month:
        try:
            parts = cur_month.split()
            bday_month = MONTH_ORDER_BD.index(parts[0]) + 1
            bday_year  = 2000 + int(parts[1])
        except:
            pass
    PERSONAL_TYPES = {"P-Personal","P-PERSONAL","personal","Personal","PERSONAL"}

    birthday_debtors = []
    for agent, adata in debtor_cards.items():
        for d in adata.get("debtors", []):
            code        = d.get("debtor_code", "")
            db_type     = d.get("debtor_type", "")
            is_vip      = d.get("vip", False)
            is_personal = db_type in PERSONAL_TYPES
            is_new      = d.get("is_new", False)

            # Recompute birthday match for selected month (not today)
            birth_date = d.get("birth_date_raw") or None
            birthday_matches = False
            if birth_date:
                try:
                    bd = _parse_birth_date(birth_date)
                    if bd is not None and not pd.isnull(bd):
                        birthday_matches = (bd.month == bday_month)
                except:
                    pass
            # Fallback: use birth_month (1-12) if raw date unavailable
            if not birth_date:
                stored_birth_month = d.get("birth_month")
                if stored_birth_month is not None:
                    birthday_matches = (int(stored_birth_month) == bday_month)
                else:
                    birthday_matches = d.get("birthday_this_month", False)

            if (birthday_matches
                    and is_vip
                    and not is_personal
                    and not is_new
                    and overrides.get(code) != "remove"):
                birthday_debtors.append({
                    "code":   code,
                    "name":   d.get("company_name", code),
                    "agent":  agent,
                    "type":   db_type,
                    "phone":  d.get("phone", ""),
                    "source": "auto",
                })

    for code, action in overrides.items():
        if action == "add":
            for agent, adata in debtor_cards.items():
                d = next((x for x in adata.get("debtors",[]) if x.get("debtor_code")==code), None)
                if d:
                    birthday_debtors.append({
                        "code":   code,
                        "name":   d.get("company_name", code),
                        "agent":  agent,
                        "type":   d.get("debtor_type",""),
                        "phone":  d.get("phone",""),
                        "source": "manual",
                    })
                    break

    seen = set(); result = []
    for d in birthday_debtors:
        if d["code"] not in seen:
            seen.add(d["code"])
            result.append(d)

    by_agent = {}
    for d in result:
        by_agent.setdefault(d["agent"], []).append(d)

    from datetime import date as _date
    bday_label = _date(bday_year, bday_month, 1).strftime("%B %Y")
    log(f"  Birthday campaign: {len(result)} VIP debtors ({bday_label}) — excl new & personal")
    return {
        "month":    bday_label,
        "count":    len(result),
        "debtors":  result,
        "by_agent": {a: len(v) for a, v in by_agent.items()},
    }


def save_penetration_snapshot(brand_comm, targets, cur_month):
    """
    Auto-calculate penetration targets from non-buyer counts.
    5% of non-buyers for: iFACE, SUKUN, BISON, TR20
    EVO and LAM+LWM = manual only
    Only runs once per month (preserves Day 1 snapshot).
    Management can override per agent per brand via kpi_overrides.
    """
    AUTO_BRANDS = {"iFACE", "SUKUN", "BISON", "TR20"}
    MANUAL_BRANDS = {"EVO", "LAM+LWM"}
    SNAP_KEY = f"pen_snapshot_{cur_month}"

    snaps = targets.get("penetration_snapshots", {})
    if cur_month in snaps:
        log(f"  Penetration snapshot for {cur_month} already exists — skipping")
        return targets

    log(f"  Saving penetration snapshot for {cur_month}...")
    snap = {}
    for agent, bc in brand_comm.items():
        ag_cfg    = targets.get("agents", {}).get(agent, {})
        bc_tgts   = ag_cfg.get("brand_commission", {})
        overrides = ag_cfg.get("pen_overrides", {})
        snap[agent] = {}

        for brand, bdata in bc.items():
            non_buyers = bdata.get("non_buyers", 0)
            snap[agent][brand] = non_buyers

            # Auto-calculate target for selected brands
            if brand in AUTO_BRANDS and brand not in overrides:
                auto_target = max(1, round(non_buyers * 0.05))
                if brand not in bc_tgts:
                    bc_tgts[brand] = {}
                bc_tgts[brand]["penetration_target"] = auto_target
                bc_tgts[brand]["pen_auto"] = True
            elif brand in MANUAL_BRANDS:
                if brand not in bc_tgts:
                    bc_tgts[brand] = {}
                bc_tgts[brand]["pen_auto"] = False

        ag_cfg["brand_commission"] = bc_tgts
        targets["agents"][agent] = ag_cfg

    snaps[cur_month] = snap
    targets["penetration_snapshots"] = snaps

    # Save targets.json
    with open(TARGETS_FILE, "w", encoding="utf-8") as f:
        json.dump(targets, f, ensure_ascii=False, indent=2)
    log(f"  ✅ Penetration snapshot saved — auto-targets set for {len(snap)} agents")
    return targets



    """
    Auto-generate birthday gift list:
    - VIP debtors only
    - Exclude P-Personal
    - Exclude new accounts opened this month
    - Target = total qualifying debtors (management audits agent's actual)
    """
    log("Generating birthday campaign list...")
    today     = date.today()
    overrides = targets.get("birthday_overrides", {})
    PERSONAL_TYPES = {"P-Personal","P-PERSONAL","personal","Personal","PERSONAL"}

    birthday_debtors = []
    for agent, adata in debtor_cards.items():
        for d in adata.get("debtors", []):
            code       = d.get("debtor_code", "")
            db_type    = d.get("debtor_type", "")
            is_vip     = d.get("vip", False)
            is_personal = db_type in PERSONAL_TYPES
            is_new     = d.get("is_new", False)  # new account this month

            # Criteria: birthday this month + VIP + not personal + not new account
            # Recompute birthday match for selected month (not today)
            birth_date = d.get("birth_date_raw") or None
            birthday_matches = False
            if birth_date:
                try:
                    bd = _parse_birth_date(birth_date)
                    if bd is not None and not pd.isnull(bd):
                        birthday_matches = (bd.month == bday_month)
                except:
                    pass
            # Fallback: use birth_month (1-12) if raw date unavailable
            if not birth_date:
                stored_birth_month = d.get("birth_month")
                if stored_birth_month is not None:
                    birthday_matches = (int(stored_birth_month) == bday_month)
                else:
                    birthday_matches = d.get("birthday_this_month", False)

            if (birthday_matches
                    and is_vip
                    and not is_personal
                    and not is_new
                    and overrides.get(code) != "remove"):
                birthday_debtors.append({
                    "code":   code,
                    "name":   d.get("company_name", code),
                    "agent":  agent,
                    "type":   db_type,
                    "phone":  d.get("phone", ""),
                    "source": "auto",
                })

    # Marketing manual overrides — add specific debtors
    for code, action in overrides.items():
        if action == "add":
            for agent, adata in debtor_cards.items():
                d = next((x for x in adata.get("debtors",[]) if x.get("debtor_code")==code), None)
                if d:
                    birthday_debtors.append({
                        "code":   code,
                        "name":   d.get("company_name", code),
                        "agent":  agent,
                        "type":   d.get("debtor_type",""),
                        "phone":  d.get("phone",""),
                        "source": "manual",
                    })
                    break

    # Remove duplicates
    seen = set(); result = []
    for d in birthday_debtors:
        if d["code"] not in seen:
            seen.add(d["code"])
            result.append(d)

    # Group by agent for per-agent target
    by_agent = {}
    for d in result:
        by_agent.setdefault(d["agent"], []).append(d)

    log(f"  Birthday campaign: {len(result)} VIP debtors ({today.strftime('%B %Y')}) — excl new accounts & personal")
    return {
        "month":    today.strftime("%B %Y"),
        "count":    len(result),
        "debtors":  result,
        "by_agent": {a: len(v) for a, v in by_agent.items()},
    }


def calc_brand_campaigns(df, targets, agents, cur_month, prev_months, brand_config):
    """
    Auto-generate brand campaign promo tiers per debtor based on last 3 months avg CTN.
    Tier logic per campaign (configurable in targets.json brand_campaigns):
      A = avg CTN == 0            → Buy2Free1  (activate dormant)
      B = avg CTN 1 to tier_b_max → Buy5Free2  (upgrade small)
      C = avg CTN tier_b_max+1 to tier_c_max → Buy10Free4 (upgrade medium)
      KA= avg CTN > tier_c_max   → Buy10Free4 (retain key account)
    """
    log("Calculating Brand Campaigns...")
    brand_campaigns_cfg = targets.get("brand_campaigns", [])
    if not brand_campaigns_cfg:
        return []

    # All canggih rows
    canggih = df[df["item_group"] != EIGHTCOM_GROUP].copy()
    prev_paid = canggih[canggih["paid_on"].isin(prev_months)]

    results = []

    for camp in brand_campaigns_cfg:
        if not camp.get("active", True):
            continue

        brand     = camp.get("brand", "")
        codes     = brand_config.get(brand, [])
        if not codes:
            continue

        # Tier thresholds (configurable)
        tier_b_max = float(camp.get("tier_b_max", 5))   # B = 1 to this
        tier_c_max = float(camp.get("tier_c_max", 9))   # C = tier_b_max+1 to this

        # Tier promo labels (configurable)
        tier_labels = {
            "A":  camp.get("tier_a_promo", "买2条送1条"),
            "B":  camp.get("tier_b_promo", "买5条送2条"),
            "C":  camp.get("tier_c_promo", "买10条送4条"),
            "KA": camp.get("tier_ka_promo", "买10条送4条"),
        }

        # Manual overrides from targets.json {debtor_code: "A"|"B"|"C"|"KA"|"exclude"}
        overrides = camp.get("overrides", {})

        # EVO special: rm_ctn >= 36 filter
        if brand == "EVO":
            brand_prev = prev_paid[
                (prev_paid["item_code"].isin(codes)) &
                (prev_paid["rm_ctn"] >= EVO_MIN_RM_CTN)
            ]
        else:
            brand_prev = prev_paid[prev_paid["item_code"].isin(codes)]

        # All debtors across all agents
        all_debtors = set()
        for agent in agents:
            ag_debtors = brand_prev[brand_prev["agent"] == agent]["debtor_code"].unique()
            all_debtors.update(ag_debtors)

        # Also include debtors with 0 purchases (from debtor cards)
        # We'll calculate per-agent below
        debtor_list = []

        for agent in agents:
            ag_prev = brand_prev[brand_prev["agent"] == agent]

            # Get all debtors for this agent
            all_ag_debtors = df[df["agent"] == agent]["debtor_code"].unique()

            for dcode in all_ag_debtors:
                if overrides.get(dcode) == "exclude":
                    continue

                # Avg CTN over last 3 months
                d_rows = ag_prev[ag_prev["debtor_code"] == dcode]
                monthly_ctns = []
                for m in prev_months:
                    monthly_ctns.append(float(d_rows[d_rows["paid_on"] == m]["qty_ctn"].sum()))
                avg_ctn = sum(monthly_ctns) / len(monthly_ctns) if monthly_ctns else 0
                max_ctn = max(monthly_ctns) if monthly_ctns else 0

                # Determine tier
                if overrides.get(dcode):
                    tier = overrides[dcode]
                elif avg_ctn == 0:
                    tier = "A"
                elif avg_ctn <= tier_b_max:
                    tier = "B"
                elif avg_ctn <= tier_c_max:
                    tier = "C"
                else:
                    tier = "KA"

                debtor_list.append({
                    "code":      dcode,
                    "agent":     agent,
                    "avg_ctn":   round(avg_ctn, 1),
                    "max_ctn":   round(max_ctn, 1),
                    "tier":      tier,
                    "promo":     tier_labels.get(tier, ""),
                    "overridden": dcode in overrides,
                })

        results.append({
            "id":          camp.get("id", f"bc_{brand}"),
            "brand":       brand,
            "name":        camp.get("name", f"{brand} Campaign"),
            "active":      True,
            "deadline":    camp.get("deadline", ""),
            "tier_b_max":  tier_b_max,
            "tier_c_max":  tier_c_max,
            "tier_labels": tier_labels,
            "debtor_count": len(debtor_list),
            "tier_summary": {
                "A":  sum(1 for d in debtor_list if d["tier"]=="A"),
                "B":  sum(1 for d in debtor_list if d["tier"]=="B"),
                "C":  sum(1 for d in debtor_list if d["tier"]=="C"),
                "KA": sum(1 for d in debtor_list if d["tier"]=="KA"),
            },
            "debtors": debtor_list,
        })

        log(f"  {brand} campaign: {len(debtor_list)} debtors — "
            f"A:{results[-1]['tier_summary']['A']} "
            f"B:{results[-1]['tier_summary']['B']} "
            f"C:{results[-1]['tier_summary']['C']} "
            f"KA:{results[-1]['tier_summary']['KA']}")

    return results



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


def _calc_prev_month_ctn(df, prev_months):
    """Sum paid CTN for the immediate previous month."""
    if df is None or not prev_months: return 0
    prev_m = prev_months[0] if prev_months else None
    if not prev_m: return 0
    try:
        canggih = df[df["item_group"] != EIGHTCOM_GROUP]
        return round(float(canggih[canggih["paid_on"] == prev_m]["qty_ctn"].sum()), 2)
    except: return 0

def _calc_total_sales_ctn(df, cur_month):
    """Sum all (paid + unpaid) canggih CTN for current month."""
    if df is None: return 0
    try:
        canggih = df[df["item_group"] != EIGHTCOM_GROUP]
        return round(float(canggih[canggih["invoice_month"] == cur_month]["qty_ctn"].sum()), 2)             if "invoice_month" in df.columns             else round(float(canggih[canggih["paid_on"] == cur_month]["qty_ctn"].sum()), 2)
    except: return 0

def calc_team_summary(sales_prog, brand_comm, agents, targets, cur_month, df=None, prev_months=None):
    """Aggregate team-level totals for management view."""
    log("Calculating team summary...")

    team_targets = targets.get("team", {})
    # Use monthly targets for correct month
    monthly_agents = get_monthly_targets(targets, cur_month)
    t1_total = sum(
        (monthly_agents.get(a) or targets.get("agents", {}).get(a, {})).get("sales_progression", {}).get("normal_t1", 0) or 0
        for a in agents
    )

    team_normal_ctn  = sum(sales_prog.get(a, {}).get("normal_ctn", 0) for a in agents)
    team_ga_ctn      = sum(sales_prog.get(a, {}).get("ga_ctn", 0) for a in agents)
    team_ma_ctn      = sum(sales_prog.get(a, {}).get("ma_ctn", 0) for a in agents)
    team_canggih     = sum(sales_prog.get(a, {}).get("total_canggih_ctn", 0) for a in agents)
    team_8com        = sum(sales_prog.get(a, {}).get("eightcom_paid_ctn", 0) for a in agents)
    team_8com_unpaid = sum(sales_prog.get(a, {}).get("eightcom_unpaid_ctn", 0) for a in agents)

    # T2/GA/MA total targets from monthly targets
    t2_total = sum(
        (monthly_agents.get(a) or targets.get("agents", {}).get(a, {})).get("sales_progression", {}).get("normal_t2", 0) or 0
        for a in agents
    )
    ga_total = sum(
        (monthly_agents.get(a) or targets.get("agents", {}).get(a, {})).get("sales_progression", {}).get("ga", 0) or 0
        for a in agents
    )
    ma_total = sum(
        (monthly_agents.get(a) or targets.get("agents", {}).get(a, {})).get("sales_progression", {}).get("ma", 0) or 0
        for a in agents
    )

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
        "team_8com_unpaid":  round(team_8com_unpaid, 2),
        "t1_total_target":   t1_total,
        "t2_total_target":   t2_total,
        "ga_total_target":   ga_total,
        "ma_total_target":   ma_total,
        "t1_pct":            pct(team_normal_ctn, t1_total),
        "t2_pct":            pct(team_normal_ctn, t2_total),
        "ga_pct":            pct(team_ga_ctn, ga_total),
        "ma_pct":            pct(team_ma_ctn, ma_total),
        "t1_gap":            round(team_normal_ctn - t1_total, 2) if t1_total else None,
        "t2_gap":            round(team_normal_ctn - t2_total, 2) if t2_total else None,
        "ga_gap":            round(team_ga_ctn - ga_total, 2) if ga_total else None,
        "ma_gap":            round(team_ma_ctn - ma_total, 2) if ma_total else None,
        "t1_color":          color_code(pct(team_normal_ctn, t1_total)),
        "brand_summary":     brand_summary,
        "leaderboard":       leaderboard,
        "prev_month_ctn":    _calc_prev_month_ctn(df, prev_months),
        "total_sales_ctn":   _calc_total_sales_ctn(df, cur_month),
    }


# ── Module: KPI Calculation ───────────────────────────────────────────────────

# Full KPI item definitions — (key, label, section, source, default_weight)
# source: auto=calculated, manual_agent=agent enters, manual_mgmt=management enters, manual_accounts=accounts dept
KPI_ITEM_DEFS = [
    # Section A
    ("sales_normal_pct",    "销售 Normal %",               "A",  "auto",             0.35),
    # Section B
    ("alt_channel_contact", "Alt Sales - Contact <2 days", "B",  "manual_mgmt",      0.02),
    ("alt_channel_deliver", "Alt Sales - 送货 <7 days",    "B",  "manual_mgmt",      0.03),
    ("event",               "做Event / PSR",               "B",  "manual_agent",     0.03),
    ("new_accounts",        "开户口 (新户口)",              "B",  "auto",             0.04),
    ("vip_count",           "VIP 招聘",                    "B",  "auto",             0.01),
    ("reactivation",        "激活户口",                    "B",  "auto",             0.03),
    ("new_sku",             "加SKU数量",                   "B",  "auto",             0.03),
    ("activation_rate",     "持续光顾率",                  "B",  "auto",             0.03),
    ("iface_pen",           "iFACE Penetration",           "B",  "auto",             0.01875),
    ("iface_target",        "iFACE CTN Target",            "B",  "auto",             0.01875),
    ("sukun_pen",           "SUKUN Penetration",           "B",  "auto",             0.01875),
    ("sukun_target",        "SUKUN CTN Target",            "B",  "auto",             0.01875),
    ("evo_pen",             "EVO Penetration",             "B",  "auto",             0.01875),
    ("evo_target",          "EVO CTN Target",              "B",  "auto",             0.01875),
    ("bison_pen",           "BISON Penetration",           "B",  "auto",             0.0),
    ("bison_target",        "BISON CTN Target",            "B",  "auto",             0.0),
    ("tr20_pen",            "TR20 Penetration",            "B",  "auto",             0.01875),
    ("tr20_target",         "TR20 CTN Target",             "B",  "auto",             0.01875),
    ("lam_lwm_pen",         "LAM+LWM Penetration",         "B",  "auto",             0.0),
    ("lam_lwm_target",      "LAM+LWM CTN Target",          "B",  "auto",             0.0),
    # Section C
    ("birthday_campaign",   "生日礼物 Campaign",           "C",  "manual_agent",     0.01),
    ("campaign_1",          "Campaign Related",            "C",  "manual_agent",     0.02),
    # Section D - Accounts dept manual scoring
    ("d_key_accuracy",      "KEY 单精准度",                "D",  "manual_accounts",  0.05),
    ("d_account_accuracy",  "帐目精准度",                  "D",  "manual_accounts",  0.05),
    ("d_outstanding",       "欠账",                        "D",  "manual_accounts",  0.05),
    ("d_followup",          "其它 Follow Up",              "D",  "manual_accounts",  0.05),
    # Section E - Management manual scoring
    ("e_punctuality",       "准时 Punctuality",            "E",  "manual_mgmt",      0.01),
    ("e_warehouse",         "货仓整洁度",                  "E",  "manual_mgmt",      0.01),
    ("e_efficiency",        "有效率和有担待",              "E",  "manual_mgmt",      0.01),
    ("e_check_car",         "Check 车",                    "E",  "manual_mgmt",      0.01),
    ("e_check_stock",       "Check Stock",                 "E",  "manual_mgmt",      0.01),
]

# Default monthly weights (used if kpi_weights not set in targets.json)
DEFAULT_KPI_WEIGHTS = {
    "Jan 26": {
        "sales_normal_pct":0.35,"alt_channel_contact":0.02,"alt_channel_deliver":0.03,
        "event":0.03,"new_accounts":0.04,"vip_count":0.01,"reactivation":0.03,
        "new_sku":0.03,"activation_rate":0.03,
        "iface_pen":0.01875,"iface_target":0.01875,"sukun_pen":0.01875,"sukun_target":0.01875,
        "evo_pen":0.01875,"evo_target":0.01875,"bison_pen":0.0,"bison_target":0.0,
        "tr20_pen":0.01875,"tr20_target":0.01875,"lam_lwm_pen":0.0,"lam_lwm_target":0.0,
        "birthday_campaign":0.01,"campaign_1":0.02,
        "d_key_accuracy":0.05,"d_account_accuracy":0.05,"d_outstanding":0.05,"d_followup":0.05,
        "e_punctuality":0.01,"e_warehouse":0.01,"e_efficiency":0.01,"e_check_car":0.01,"e_check_stock":0.01,
    },
    "Feb 26": {
        "sales_normal_pct":0.35,"alt_channel_contact":0.02,"alt_channel_deliver":0.03,
        "event":0.03,"new_accounts":0.04,"vip_count":0.01,"reactivation":0.03,
        "new_sku":0.03,"activation_rate":0.03,
        "iface_pen":0.015,"iface_target":0.015,"sukun_pen":0.015,"sukun_target":0.015,
        "evo_pen":0.015,"evo_target":0.015,"bison_pen":0.015,"bison_target":0.015,
        "tr20_pen":0.015,"tr20_target":0.015,"lam_lwm_pen":0.0,"lam_lwm_target":0.0,
        "birthday_campaign":0.01,"campaign_1":0.02,
        "d_key_accuracy":0.05,"d_account_accuracy":0.05,"d_outstanding":0.05,"d_followup":0.05,
        "e_punctuality":0.01,"e_warehouse":0.01,"e_efficiency":0.01,"e_check_car":0.01,"e_check_stock":0.01,
    },
    "Mar 26": {
        "sales_normal_pct":0.35,"alt_channel_contact":0.02,"alt_channel_deliver":0.03,
        "event":0.03,"new_accounts":0.03,"vip_count":0.01,"reactivation":0.03,
        "new_sku":0.03,"activation_rate":0.03,
        "iface_pen":0.015,"iface_target":0.015,"sukun_pen":0.015,"sukun_target":0.015,
        "evo_pen":0.015,"evo_target":0.015,"bison_pen":0.015,"bison_target":0.015,
        "tr20_pen":0.015,"tr20_target":0.015,"lam_lwm_pen":0.0,"lam_lwm_target":0.0,
        "birthday_campaign":0.01,"campaign_1":0.02,
        "d_key_accuracy":0.05,"d_account_accuracy":0.05,"d_outstanding":0.05,"d_followup":0.05,
        "e_punctuality":0.01,"e_warehouse":0.01,"e_efficiency":0.01,"e_check_car":0.01,"e_check_stock":0.01,
    },
    "Apr 26": {
        "sales_normal_pct":0.37,"alt_channel_contact":0.02,"alt_channel_deliver":0.03,
        "event":0.03,"new_accounts":0.03,"vip_count":0.01,"reactivation":0.03,
        "new_sku":0.03,"activation_rate":0.03,
        "iface_pen":0.015,"iface_target":0.015,"sukun_pen":0.015,"sukun_target":0.015,
        "evo_pen":0.015,"evo_target":0.015,"bison_pen":0.015,"bison_target":0.015,
        "tr20_pen":0.015,"tr20_target":0.015,"lam_lwm_pen":0.015,"lam_lwm_target":0.015,
        "birthday_campaign":0.01,"campaign_1":0.02,
        "d_key_accuracy":0.04,"d_account_accuracy":0.04,"d_outstanding":0.04,"d_followup":0.04,
        "e_punctuality":0.01,"e_warehouse":0.01,"e_efficiency":0.01,"e_check_car":0.01,"e_check_stock":0.01,
    },
}

def calc_kpi(agents, targets, sales_prog, brand_comm, debtor_cards, birthday_camp=None, cur_month=None):
    """
    Calculate KPI scores for all Sections A-E.
    Sections A/B/C = auto-calculated from sales data.
    Section D = manual scores by accounts dept.
    Section E = manual scores by management.
    Weights loaded from targets.json kpi_weights per month.
    """
    log("Calculating KPI scores...")

    kpi_config = targets.get("kpi_config", {})

    # Load monthly weights — fallback to default if not set
    kpi_weights_all = targets.get("kpi_weights", DEFAULT_KPI_WEIGHTS)
    month_key = cur_month or "Apr 26"
    # Find best matching month weights
    month_weights = kpi_weights_all.get(month_key)
    if not month_weights:
        # Try to find nearest month
        for mk in sorted(kpi_weights_all.keys()):
            month_weights = kpi_weights_all[mk]
        if not month_weights:
            month_weights = DEFAULT_KPI_WEIGHTS.get(month_key, DEFAULT_KPI_WEIGHTS["Apr 26"])

    # Build KPI_ITEMS with weights from monthly config
    KPI_ITEMS = []
    for key, label, section, source, default_w in KPI_ITEM_DEFS:
        w = month_weights.get(key, default_w)
        KPI_ITEMS.append((key, label, section, source, float(w)))

    def score_item(actual, target, weight):
        """Score = min(actual/target, 1.0) × weight × 100"""
        if not target or target == 0: return 0.0
        return round(min(float(actual or 0) / float(target), 1.0) * weight * 100, 3)

    result = {}

    for agent in agents:
        monthly_agents = get_monthly_targets(targets, cur_month)
        ag_cfg   = monthly_agents.get(agent, targets.get("agents", {}).get(agent, {}))
        # Also check current agents for manual scores (kpi_manual is not stored monthly)
        ag_cfg_current = targets.get("agents", {}).get(agent, {})
        kpi_tgts = ag_cfg.get("kpi_targets", {})
        manual   = ag_cfg_current.get("kpi_manual", {})
        kpi_config["_birthday_camp"] = birthday_camp or {}

        # ── Pull actuals ──────────────────────────────────────────────────────
        sp = sales_prog.get(agent, {})
        bc = brand_comm.get(agent, {})
        dc = debtor_cards.get(agent, {})

        normal_pct = (sp.get("tiers", {}).get("normal_t1", {}).get("pct", 0) or 0)
        debtors    = dc.get("debtors", [])
        PERSONAL_TYPES_KPI = {"P-Personal","P-PERSONAL","personal","Personal","PERSONAL"}
        new_acc_count = sum(1 for d in debtors if d.get("is_new", False) and d.get("debtor_type","") not in PERSONAL_TYPES_KPI)
        vip_count     = sum(1 for d in debtors if d.get("vip", False))
        reactiv_count = dc.get("reactivation_count", 0) or 0
        new_sku_count = dc.get("total_new_sku", 0) or 0
        act_rate      = dc.get("activation_rate", 0) or 0

        def bdata(brand):
            d = bc.get(brand, {})
            return {
                "pen_actual":  d.get("penetration", {}).get("count", 0) or 0,
                "pen_target":  d.get("penetration", {}).get("target", 1) or 1,
                "ctn_actual":  d.get("ctn", {}).get("sold", 0) or 0,
                "ctn_target":  d.get("ctn", {}).get("target", 1) or 1,
            }
        bv = {b: bdata(b) for b in ["EVO","iFACE","SUKUN","BISON","TR20","LAM+LWM"]}

        def tgt(key, default): return float(kpi_tgts.get(key, default) or default)

        # ── Auto actuals and targets ──────────────────────────────────────────
        auto_actuals = {
            "sales_normal_pct": normal_pct,
            "new_accounts":     new_acc_count,
            "vip_count":        vip_count,
            "reactivation":     reactiv_count,
            "new_sku":          new_sku_count,
            "activation_rate":  act_rate,
            "iface_pen":        bv["iFACE"]["pen_actual"],
            "iface_target":     bv["iFACE"]["ctn_actual"],
            "sukun_pen":        bv["SUKUN"]["pen_actual"],
            "sukun_target":     bv["SUKUN"]["ctn_actual"],
            "evo_pen":          bv["EVO"]["pen_actual"],
            "evo_target":       bv["EVO"]["ctn_actual"],
            "bison_pen":        bv["BISON"]["pen_actual"],
            "bison_target":     bv["BISON"]["ctn_actual"],
            "tr20_pen":         bv["TR20"]["pen_actual"],
            "tr20_target":      bv["TR20"]["ctn_actual"],
            "lam_lwm_pen":      bv["LAM+LWM"]["pen_actual"],
            "lam_lwm_target":   bv["LAM+LWM"]["ctn_actual"],
        }
        auto_targets = {
            "sales_normal_pct": tgt("sales_normal_pct", 100),
            "new_accounts":     tgt("new_accounts",     5),
            "vip_count":        tgt("vip_count",        3),
            "reactivation":     tgt("reactivation",     5),
            "new_sku":          tgt("new_sku",          17),
            "activation_rate":  tgt("activation_rate",  80),
            "iface_pen":        bv["iFACE"]["pen_target"],
            "iface_target":     bv["iFACE"]["ctn_target"],
            "sukun_pen":        bv["SUKUN"]["pen_target"],
            "sukun_target":     bv["SUKUN"]["ctn_target"],
            "evo_pen":          bv["EVO"]["pen_target"],
            "evo_target":       bv["EVO"]["ctn_target"],
            "bison_pen":        bv["BISON"]["pen_target"],
            "bison_target":     bv["BISON"]["ctn_target"],
            "tr20_pen":         bv["TR20"]["pen_target"],
            "tr20_target":      bv["TR20"]["ctn_target"],
            "lam_lwm_pen":      bv["LAM+LWM"]["pen_target"],
            "lam_lwm_target":   bv["LAM+LWM"]["ctn_target"],
        }

        items_out = {}

        for key, label, section, source, weight in KPI_ITEMS:
            if weight == 0.0:
                # Excluded this month — still record but 0 weight/score
                items_out[key] = {
                    "label": label, "section": section, "weight": 0,
                    "actual": auto_actuals.get(key, manual.get(key, 0)),
                    "target": auto_targets.get(key, None),
                    "score": 0.0, "max_score": 0.0, "pct": 0,
                    "source": source, "excluded": True,
                }
                continue

            max_score = round(weight * 100, 3)

            if source == "auto":
                actual = auto_actuals.get(key, 0)
                target = auto_targets.get(key, 1)
                sc     = score_item(actual, target, weight)
                pct    = round(actual / target * 100, 1) if target else 0
                items_out[key] = {
                    "label": label, "section": section, "weight": weight,
                    "actual": actual, "target": target,
                    "score": sc, "max_score": max_score, "pct": pct,
                    "source": source, "excluded": False,
                }

            elif key == "event":
                actual = manual.get("event", 0) or 0
                target = tgt("event", 16)
                sc     = score_item(actual, target, weight)
                items_out[key] = {
                    "label": label, "section": section, "weight": weight,
                    "actual": actual, "target": target,
                    "score": sc, "max_score": max_score,
                    "pct": round(actual / target * 100, 1) if target else 0,
                    "source": source, "excluded": False,
                }

            elif key == "birthday_campaign":
                bday_data   = kpi_config.get("_birthday_camp", {})
                auto_target = bday_data.get("by_agent", {}).get(agent, 0)
                actual      = manual.get("birthday_campaign", 0) or 0
                sc          = score_item(actual, auto_target, weight) if auto_target else 0
                items_out[key] = {
                    "label": label, "section": section, "weight": weight,
                    "actual": actual, "target": auto_target,
                    "score": sc, "max_score": max_score,
                    "pct": round(actual / auto_target * 100, 1) if auto_target else 0,
                    "source": source, "excluded": False,
                    "input_role": "agent", "audit_role": "management",
                }

            elif key in ("alt_channel_contact", "alt_channel_deliver",
                         "campaign_1",
                         "d_key_accuracy","d_account_accuracy","d_outstanding","d_followup",
                         "e_punctuality","e_warehouse","e_efficiency","e_check_car","e_check_stock"):
                # Direct score entry — actual entered as score out of max
                actual = float(manual.get(key, 0) or 0)
                sc     = round(min(actual, max_score), 3)
                items_out[key] = {
                    "label": label, "section": section, "weight": weight,
                    "actual": actual, "target": max_score,
                    "score": sc, "max_score": max_score,
                    "pct": round(sc / max_score * 100, 1) if max_score else 0,
                    "source": source, "excluded": False,
                }

            else:
                # Fallback
                actual = manual.get(key, 0) or 0
                sc     = round(min(float(actual), max_score), 3)
                items_out[key] = {
                    "label": label, "section": section, "weight": weight,
                    "actual": actual, "target": max_score,
                    "score": sc, "max_score": max_score,
                    "pct": round(sc / max_score * 100, 1) if max_score else 0,
                    "source": source, "excluded": False,
                }

        # Section scores A-E
        section_scores = {}
        for sec in ["A","B","C","D","E"]:
            sec_items = {k: v for k, v in items_out.items() if v["section"] == sec}
            section_scores[sec] = {
                "score":     round(sum(v["score"] for v in sec_items.values()), 3),
                "max_score": round(sum(v["max_score"] for v in sec_items.values()), 3),
            }

        grand_total = round(sum(v["score"] for v in items_out.values()), 3)
        max_total   = round(sum(v["max_score"] for v in items_out.values()), 3)

        result[agent] = {
            "items":          items_out,
            "section_scores": section_scores,
            "grand_total":    grand_total,
            "max_total":      max_total,
            "grand_pct":      round(grand_total / max_total * 100, 1) if max_total else 0,
            "kpi_month":      month_key,
        }

    return result

def calc_working_days(targets=None, cur_month=None):
    """Calculate working day progress for the given month, deducting public holidays.
    For past months, elapsed = total (100%). For current month, use today's date.
    cur_month: label like 'Mar 26' — if None, uses today's month.
    """
    import calendar
    today = date.today()

    # Determine which month to calculate for
    MONTH_ORDER_WD = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    if cur_month:
        try:
            parts = cur_month.split()
            mon_idx = MONTH_ORDER_WD.index(parts[0]) + 1
            yr = 2000 + int(parts[1])
            first_day = date(yr, mon_idx, 1)
            last_day  = date(yr, mon_idx, calendar.monthrange(yr, mon_idx)[1])
            is_past   = (yr, mon_idx) < (today.year, today.month)
            is_current = (yr, mon_idx) == (today.year, today.month)
        except:
            first_day  = today.replace(day=1)
            last_day   = today.replace(day=calendar.monthrange(today.year, today.month)[1])
            is_past    = False
            is_current = True
    else:
        first_day  = today.replace(day=1)
        last_day   = today.replace(day=calendar.monthrange(today.year, today.month)[1])
        is_past    = False
        is_current = True

    # Public holidays for this month
    ph_list = []
    if targets:
        all_ph = targets.get("public_holidays", [])
        cur_ym = first_day.strftime("%Y-%m")
        for h in all_ph:
            date_str = h.get("date", h) if isinstance(h, dict) else h
            if isinstance(date_str, str) and date_str.startswith(cur_ym):
                try:
                    ph_list.append(date.fromisoformat(date_str))
                except:
                    pass

    total_working   = 0
    elapsed_working = 0
    # For past months elapsed = total; for current use today; for future elapsed = 0
    cutoff = last_day if is_past else (today if is_current else first_day - timedelta(days=1))
    d = first_day
    while d <= last_day:
        if d.weekday() < 6 and d not in ph_list:  # Mon–Sat, exclude PH
            total_working += 1
            if d <= cutoff:
                elapsed_working += 1
        d += timedelta(days=1)

    theoretical_pct = round(elapsed_working / total_working * 100, 2) if total_working else 0

    return {
        "date":                    today.strftime("%Y-%m-%d"),
        "month_label":             first_day.strftime("%b %Y"),
        "total_working_days":      total_working,
        "elapsed_working_days":    elapsed_working,
        "theoretical_pct":         theoretical_pct,
        "public_holidays_this_month": len(ph_list),
        "public_holidays":         [d.isoformat() for d in ph_list],
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main(override_month=None, fast=False):
    log("=" * 60)
    log("MD Sales Dashboard — process_data.py (Phase 2)")
    log("=" * 60)

    today      = date.today()
    cur_month  = current_month_label(today)
    prev_months = prev_month_labels(3, today)

    # ── Month override (e.g. py process_data.py --month "Mar 26") ──
    if override_month:
        cur_month = override_month.strip()
        log(f"⚠  Month override: {cur_month}")
        # Recalculate prev_months based on override
        MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        try:
            parts = cur_month.split()
            mon_idx = MONTH_ORDER.index(parts[0])
            yr = int('20' + parts[1])
            from datetime import date as _date
            override_date = _date(yr, mon_idx + 1, 1)
            prev_months = prev_month_labels(3, override_date)
        except Exception as e:
            log(f"  ⚠ Could not parse override month for prev_months: {e}")

    # ── Load data ──────────────────────────────────────────────────
    targets   = load_targets()
    df_raw    = load_sales_report()
    debtor_df = load_debtors()

    # ── Auto-detect current month from sales data ──────────────────
    # If today's month has no data, use latest month in paid_on column
    MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

    def month_sort_key(m):
        try:
            parts = str(m).split()
            mon = MONTH_ORDER.index(parts[0]) if parts[0] in MONTH_ORDER else 0
            yr  = int(parts[1]) if len(parts) > 1 else 0
            return yr * 12 + mon
        except: return 0

    paid_on_vals = [v for v in df_raw["paid_on"].unique()
                    if v and v not in ('', 'NoComm') and len(str(v).split()) == 2]

    if cur_month not in paid_on_vals and paid_on_vals:
        latest = sorted(paid_on_vals, key=month_sort_key)[-1]
        log(f"⚠ No data for {cur_month} — auto-switching to latest: {latest}")
        cur_month = latest
        try:
            parts = cur_month.split()
            mon_idx = MONTH_ORDER.index(parts[0])
            yr = int(parts[1])
            from datetime import date as _date
            fake_today = _date(2000 + yr, mon_idx + 1, 28)
            prev_months = prev_month_labels(3, fake_today)
            log(f"  Lookback adjusted to: {prev_months}")
        except: pass

    log(f"Current month: {cur_month}  |  Lookback: {prev_months}")

    # Load campaigns.json — build debtor→campaigns lookup + area_groups
    campaign_map = {}  # debtor_code → [campaign info with progress fields]
    area_groups  = {}  # area_code → group (MVP/MI/SS/SBG)
    camp_data_global = {}
    if CAMPAIGNS_FILE.exists():
        try:
            with open(CAMPAIGNS_FILE, encoding="utf-8") as f:
                camp_data_global = json.load(f)
            area_groups = camp_data_global.get("area_groups", {})
            for camp in camp_data_global.get("campaigns", []):
                if not camp.get("active", True): continue
                # ── Month filter — only show campaigns active in cur_month ──
                # start_date must be <= cur_month, deadline must be >= cur_month
                # Fall back to created_at if start_date missing
                camp_start    = camp.get("start_date") or camp.get("created_at", "")
                camp_deadline = camp.get("deadline", "")
                try:
                    from dateutil.parser import parse as dparse
                    cm_date = dparse("01 " + cur_month)
                    cm_str  = cm_date.strftime("%Y-%m")
                    if camp_start:
                        sd_str = dparse(str(camp_start)).strftime("%Y-%m")
                        if sd_str > cm_str: continue  # campaign not started yet
                    if camp_deadline:
                        dl_str = dparse(str(camp_deadline)).strftime("%Y-%m")
                        if dl_str < cm_str: continue  # campaign already ended
                except Exception:
                    pass  # if date parsing fails, include campaign
                cat_rules = camp.get("cat_rules", {})
                for d in camp.get("debtors", []):
                    code = d.get("code","") if isinstance(d, dict) else str(d)
                    cat  = d.get("cat","") if isinstance(d, dict) else ""
                    if not code: continue
                    # Get CAT-specific rules — try full key first (e.g. "D2"), then first char (e.g. "D")
                    cat_group = cat[0].upper() if cat else ""
                    crule = cat_rules.get(cat) or cat_rules.get(cat_group) or {} if cat else {}
                    if code not in campaign_map: campaign_map[code] = []
                    campaign_map[code].append({
                        "id":              camp.get("id",""),
                        "name":            camp.get("name",""),
                        "type":            camp.get("type","other"),
                        "brand":           camp.get("brand",""),
                        "cat":             cat,
                        "start_date":      camp.get("start_date",""),
                        "deadline":        camp.get("deadline",""),
                        "approval_required": camp.get("approval_required", False),
                        # CAT-level rules (fallback to campaign level)
                        "promo_detail":    crule.get("promo_detail", camp.get("promo_detail","")),
                        "redemption_type": crule.get("redemption_type", "free_goods"),
                        "accumulation":    crule.get("accumulation", "per_transaction"),
                        "redemption_limit":crule.get("redemption_limit", 0),
                        "redemption_unit": crule.get("redemption_unit", "ctn"),
                        "min_order_ctn":   crule.get("min_order_ctn", camp.get("min_order_ctn", 0)),
                        "foc_per_ctn":     crule.get("foc_per_ctn", 0),
                        "foc_per_threshold": crule.get("foc_per_threshold", 0),
                        "foc_item":        crule.get("foc_item", ""),
                        "foc_item_rule":   crule.get("foc_item_rule", {}),
                        "foc_note":        crule.get("foc_note", ""),
                        "voucher_amount":  crule.get("voucher_amount", 0),
                        "voucher_tracking":crule.get("voucher_tracking", False),
                        "eligible_sales_type": camp.get("eligible_sales_type", []),
                        "eligible_types":  camp.get("eligible_types", []),
                        "target_pct":      crule.get("target_pct", 0),
                        "target_label":    crule.get("target_label", ""),
                        # Progress fields — filled in calc_debtor_cards
                        "ctn_this_month":  0,
                        "foc_earned":      0,
                        "qualified":       False,
                        "group":           "",
                        "foc_item_resolved": "",
                    })
            log(f"Campaigns: {len(camp_data_global.get('campaigns',[]))} loaded, {len(campaign_map)} debtors tagged")
        except Exception as e:
            log(f"⚠ Could not load campaigns.json: {e}")

    # ── Scope filter ───────────────────────────────────────────────
    df = filter_scope(df_raw)

    ben_all = df[df["agent"] == "BEN"]
    ben_mar = ben_all[ben_all["paid_on"] == "Mar 26"]

    # ── Brand config (from targets.json or default) ─────────────────
    brand_config = targets.get("brand_config", DEFAULT_BRAND_CONFIG)
    group_brand_config = targets.get("group_brand_config", DEFAULT_GROUP_BRAND_CONFIG)

    # ── Agent list ─────────────────────────────────────────────────
    # Use agents defined in targets.json; fall back to agents found in data
    agents_from_targets = list(targets.get("agents", {}).keys())
    agents_from_data    = sorted(df["agent"].unique().tolist())
    agents = agents_from_targets if agents_from_targets else agents_from_data
    agents = [a for a in agents if a]  # remove blanks
    # Filter out inactive agents (active=False in targets.json)
    # Archived agents (archived=True) are also excluded from current view
    agents = [a for a in agents if targets.get("agents", {}).get(a, {}).get("active", True) != False]
    agents = [a for a in agents if not targets.get("agents", {}).get(a, {}).get("archived", False)]
    log(f"Agents: {agents}")

    # ── Agent Inheritance — merge archived predecessor's sales into successor ──
    # For each active agent with inherits_from, inject predecessor rows into df
    # so all calculations treat them as one combined agent.
    # Rule: Split mode — A's invoices stay as A in AutoCount, B's as B.
    #       We rename A's rows → B for months >= inherit_from_month.
    agents_cfg = targets.get("agents", {})
    inherit_map = {}  # predecessor → successor
    for agent, cfg in agents_cfg.items():
        pred = cfg.get("inherits_from")
        from_month = cfg.get("inherit_from_month")
        if pred and from_month:
            inherit_map[pred] = {"successor": agent, "from_month": from_month}
            log(f"  Inheritance: {pred} → {agent} from {from_month}")

    if inherit_map:
        # Build month sort key for comparison
        MONTH_ORDER = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        def month_key(m):
            # e.g. "Mar-25" or "Mar 25"
            parts = m.replace("-"," ").split()
            if len(parts) == 2:
                mon, yr = parts
                try: return int(yr)*100 + MONTH_ORDER.index(mon[:3].capitalize())
                except: return 0
            return 0

        rows_to_add = []
        for pred, info in inherit_map.items():
            successor   = info["successor"]
            from_month  = info["from_month"]
            from_key    = month_key(from_month)
            # Find all rows belonging to predecessor from inherit_from_month onwards
            pred_rows = df[df["agent"] == pred].copy()
            # Determine each row's month from invoice_date or paid_on
            for idx, row in pred_rows.iterrows():
                row_month = str(row.get("inv_month", "") or row.get("cur_month", "") or "").strip()
                if not row_month:
                    # fallback: derive from invoice date
                    inv_date = str(row.get("inv_date","")).strip()
                    if inv_date and inv_date not in ("","nan"):
                        try:
                            from datetime import datetime as _dt
                            d = _dt.strptime(inv_date[:10], "%Y-%m-%d")
                            row_month = d.strftime("%b-%y")
                        except: pass
                if month_key(row_month) >= from_key:
                    new_row = row.copy()
                    new_row["agent"] = successor
                    rows_to_add.append(new_row)

        if rows_to_add:
            import pandas as _pd
            extra = _pd.DataFrame(rows_to_add)
            df = _pd.concat([df, extra], ignore_index=True)
            log(f"  Inheritance: added {len(rows_to_add)} rows to successors")

    # ── Run modules ─────────────────────────────────────────────────
    sales_prog  = calc_sales_progression(df, targets, agents, cur_month)
    brand_comm  = calc_brand_commission(df, targets, agents, cur_month, prev_months, brand_config)

    # ── Auto-calculate penetration targets from non-buyer counts ─────────────
    targets = save_penetration_snapshot(brand_comm, targets, cur_month)
    newbie      = calc_newbie_scheme(df, targets, agents, cur_month)
    aging       = calc_aging(df, agents, cur_month)

    # ── Debtor cards — skip if --fast and cached JSON exists ────────
    month_slug   = cur_month.replace(" ", "").lower()
    monthly_file = BASE_DIR / f"data_{month_slug}.json"

    if fast and monthly_file.exists():
        log(f"⚡ --fast mode: loading debtor cards from {monthly_file.name}")
        with open(monthly_file, encoding="utf-8") as f:
            cached = json.load(f)
        debtor_cards = {
            agent: cached["agents"].get(agent, {}).get("debtor_cards", {})
            for agent in agents
        }
        log(f"   Loaded debtor cards for {len(debtor_cards)} agents from cache")
    else:
        if fast:
            log(f"⚡ --fast mode requested but no cached JSON found — running full debtor calc")
        debtor_cards = calc_debtor_cards(df, debtor_df, agents, cur_month, campaign_map, area_groups)

    # ── Save month-start snapshot + auto-calc KPI targets ───────────────────
    targets      = save_debtor_snapshot(debtor_cards, targets, cur_month)
    group_brands = calc_group_brand_targets(df, targets, cur_month, group_brand_config)
    birthday_camp = calc_birthday_campaign(debtor_cards, targets, cur_month)
    kpi          = calc_kpi(agents, targets, sales_prog, brand_comm, debtor_cards, birthday_camp, cur_month)
    team         = calc_team_summary(sales_prog, brand_comm, agents, targets, cur_month, df_raw, prev_months)
    working_days = calc_working_days(targets, cur_month)
    brand_camps  = calc_brand_campaigns(df, targets, agents, cur_month, prev_months, brand_config)

    # ── Enrich debtor cards with brand campaign tiers ───────────────────────
    for camp in brand_camps:
        for d in camp.get("debtors", []):
            agent = d.get("agent")
            code  = d.get("code")
            if not agent or not code: continue
            agent_cards = debtor_cards.get(agent, {}).get("debtors", [])
            for card in agent_cards:
                if card.get("debtor_code") == code:
                    if "brand_camp_tiers" not in card:
                        card["brand_camp_tiers"] = {}
                    card["brand_camp_tiers"][camp["brand"]] = {
                        "tier":  d["tier"],
                        "promo": d["promo"],
                        "avg_ctn": d["avg_ctn"],
                        "camp_name": camp["name"],
                    }
                    break

    # ── Assemble output ─────────────────────────────────────────────
    output = {
        "generated_at":   datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "current_month":  cur_month,
        "working_days":        working_days,
        "group_brand_targets": group_brands,
        "birthday_campaign":   birthday_camp,
        "brand_campaigns":     brand_camps,
        "agents":         {},
        "team":           team,
        "config": {
            "brand_config":       brand_config,
            "group_brand_config": group_brand_config,
            "inhouse_codes":      targets.get("inhouse_codes", DEFAULT_INHOUSE_CODES),
            "scope":              SCOPE_AREA,
            "group_incentive":    targets.get("team", {}).get("incentive", None),
        }
    }

    for agent in agents:
        ag_cfg = targets.get("agents", {}).get(agent, {})
        output["agents"][agent] = {
            "sales_progression":  sales_prog.get(agent, {}),
            "brand_commission":   brand_comm.get(agent, {}),
            "newbie_scheme":      newbie.get(agent, None),
            "aging":              aging.get(agent, {}),
            "debtor_cards":       debtor_cards.get(agent, {}),
            "kpi":                kpi.get(agent, {}),
            "inherited_from":     ag_cfg.get("inherits_from", None),
            "inherit_from_month": ag_cfg.get("inherit_from_month", None),
        }

    # ── Write JSON ──────────────────────────────────────────────────
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)

    # Also save monthly snapshot e.g. data_mar26.json
    month_slug = cur_month.replace(" ", "").lower()  # "mar26"
    monthly_file = BASE_DIR / f"data_{month_slug}.json"
    with open(monthly_file, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)
    log(f"   Monthly snapshot saved: data_{month_slug}.json")

    # Update months_index.json — list of available months
    index_file = BASE_DIR / "months_index.json"
    try:
        existing = json.loads(index_file.read_text(encoding="utf-8")) if index_file.exists() else []
    except:
        existing = []
    if cur_month not in existing:
        existing.append(cur_month)
    # Sort chronologically
    MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    def msort(m):
        try:
            p = m.split(); return int(p[1])*12 + MONTH_ORDER.index(p[0])
        except: return 0
    existing = sorted(existing, key=msort)
    index_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    log(f"   months_index.json updated: {existing}")

    size_kb = OUTPUT_FILE.stat().st_size / 1024
    log(f"\n✅ dashboard_data.json written — {size_kb:.0f} KB")
    log(f"   {len(agents)} agents  |  {cur_month}  |  Scope: {SCOPE_AREA}")
    log("=" * 60)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="MD Sales Dashboard data processor")
    parser.add_argument("--month", type=str, default=None,
        help="Override current month, e.g. --month 'Mar 26'")
    parser.add_argument("--fast", action="store_true",
        help="Skip debtor card recalculation — reuse cached debtor data from existing JSON")
    args = parser.parse_args()
    main(override_month=args.month, fast=args.fast)
