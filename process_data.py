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
    df.columns = [c.strip() for c in df.columns]
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
    Also compute total Canggih CTN and 8COM CTN.
    """
    log("Calculating Sales Progression...")

    # Paid rows this month
    paid = df[df["paid_on"] == cur_month].copy()

    # Split Canggih vs 8COM
    canggih_paid = paid[paid["item_group"] != EIGHTCOM_GROUP]
    eightcom_paid = paid[paid["item_group"] == EIGHTCOM_GROUP]

    # All rows (paid + unpaid) for 8COM unpaid calc
    eightcom_all = df[df["item_group"] == EIGHTCOM_GROUP]
    canggih_all  = df[df["item_group"] != EIGHTCOM_GROUP]

    result = {}

    for agent in agents:
        ag_tgts = targets.get("agents", {}).get(agent, {})
        sp_tgts = ag_tgts.get("sales_progression", {})

        # Canggih paid this month for this agent
        ag_canggih = canggih_paid[canggih_paid["agent"] == agent]

        # Tier split using sales_type → tier map
        normal_ctn = ag_canggih[
            ag_canggih["sales_type"].map(SALES_TYPE_MAP) == "normal"
        ]["qty_ctn"].sum()

        ga_ctn = ag_canggih[
            ag_canggih["sales_type"].map(SALES_TYPE_MAP) == "ga"
        ]["qty_ctn"].sum()

        ma_ctn = ag_canggih[
            ag_canggih["sales_type"].map(SALES_TYPE_MAP) == "ma"
        ]["qty_ctn"].sum()

        total_canggih_ctn = ag_canggih["qty_ctn"].sum()

        # 8COM
        ag_8com_paid   = eightcom_paid[eightcom_paid["agent"] == agent]["qty_ctn"].sum()
        ag_8com_unpaid = eightcom_all[
            (eightcom_all["agent"] == agent) & (eightcom_all["paid_on"] == "")
        ]["qty_ctn"].sum()

        # Targets
        t1  = sp_tgts.get("normal_t1")
        t2  = sp_tgts.get("normal_t2")
        ga  = sp_tgts.get("ga")
        ma  = sp_tgts.get("ma")

        normal_ctn = round(float(normal_ctn), 2)
        ga_ctn     = round(float(ga_ctn), 2)
        ma_ctn     = round(float(ma_ctn), 2)

        result[agent] = {
            "normal_ctn":       normal_ctn,
            "ga_ctn":           ga_ctn,
            "ma_ctn":           ma_ctn,
            "total_canggih_ctn": round(float(total_canggih_ctn), 2),
            "eightcom_paid_ctn":   round(float(ag_8com_paid), 2),
            "eightcom_unpaid_ctn": round(float(ag_8com_unpaid), 2),
            "tiers": {
                "normal_t1": {
                    "target":  t1,
                    "actual":  normal_ctn,
                    "gap":     round(normal_ctn - t1, 2) if t1 else None,
                    "pct":     pct(normal_ctn, t1),
                    "color":   color_code(pct(normal_ctn, t1)),
                },
                "normal_t2": {
                    "target":  t2,
                    "actual":  normal_ctn,
                    "gap":     round(normal_ctn - t2, 2) if t2 else None,
                    "pct":     pct(normal_ctn, t2),
                    "color":   color_code(pct(normal_ctn, t2)),
                },
                "ga": {
                    "target":  ga,
                    "actual":  ga_ctn,
                    "gap":     round(ga_ctn - ga, 2) if ga else None,
                    "pct":     pct(ga_ctn, ga),
                    "color":   color_code(pct(ga_ctn, ga)),
                } if ga else None,
                "ma": {
                    "target":  ma,
                    "actual":  ma_ctn,
                    "gap":     round(ma_ctn - ma, 2) if ma else None,
                    "pct":     pct(ma_ctn, ma),
                    "color":   color_code(pct(ma_ctn, ma)),
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
      - CTN tiers: global thresholds (same for all newbies)
      - New account bonus: debtors appearing for first time this month
    """
    log("Calculating Newbie Scheme...")

    newbie_config   = targets.get("newbie_scheme", {})
    ctn_tiers       = newbie_config.get("ctn_tiers", [])      # [{threshold, reward}]
    account_tiers   = newbie_config.get("account_tiers", [])  # [{count, reward}]

    # Canggih paid this month
    canggih_paid_cur = df[
        (df["item_group"] != EIGHTCOM_GROUP) &
        (df["paid_on"] == cur_month)
    ]

    # All historical data for new account detection
    all_prev = df[df["paid_on"] != cur_month]

    result = {}

    for agent in agents:
        ag_info = targets.get("agents", {}).get(agent, {})
        if not ag_info.get("is_newbie", False):
            continue  # Skip non-newbie agents

        # CTN: Normal tier only (same filter as sales progression Normal)
        ag_paid = canggih_paid_cur[canggih_paid_cur["agent"] == agent]
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

        # New accounts: debtors this agent transacted with this month
        # who have NEVER appeared in previous months data
        cur_debtors  = set(df[
            (df["agent"] == agent) & (df["paid_on"] == cur_month)
        ]["debtor_code"].unique())
        prev_debtors = set(all_prev[all_prev["agent"] == agent]["debtor_code"].unique())
        new_accounts = cur_debtors - prev_debtors
        new_acc_count = len(new_accounts)

        # Determine account bonus tier
        acc_tier_hit   = None
        acc_reward     = 0
        for tier in sorted(account_tiers, key=lambda x: x["count"]):
            if new_acc_count >= tier["count"]:
                acc_tier_hit = tier["count"]
                acc_reward   = tier["reward"]

        result[agent] = {
            "is_newbie":      True,
            "normal_ctn":     normal_ctn,
            "ctn_tiers":      ctn_tiers,
            "ctn_tier_hit":   ctn_tier_hit,
            "ctn_reward":     ctn_reward,
            "new_accounts":   new_acc_count,
            "account_tiers":  account_tiers,
            "acc_tier_hit":   acc_tier_hit,
            "acc_reward":     acc_reward,
            "total_incentive": ctn_reward + acc_reward,
            # Progress to next tier
            "next_ctn_tier": next(
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
        # Log actual columns to help debug mismatches
        log(f"  Debtor columns: {list(debtor_df.columns[:10])}")

        # Flexible column name matching — lowercase comparison
        col_map = {}
        for col in debtor_df.columns:
            cl = col.strip().lower()
            if 'debtor' in cl and 'code' in cl:      col_map['code']  = col
            elif 'company' in cl or 'name' in cl:    col_map.setdefault('name', col)
            elif 'phone' in cl or 'tel' in cl or 'mobile' in cl: col_map['phone'] = col
            elif 'attention' in cl or 'remark' in cl: col_map['vip']  = col
            elif 'birth' in cl:                       col_map['birth'] = col
            elif 'open' in cl and ('acc' in cl or 'date' in cl): col_map['open']  = col
            elif 'type' in cl:                        col_map.setdefault('type', col)
        log(f"  Debtor col_map: {col_map}")

        for _, row in debtor_df.iterrows():
            code = str(row.get(col_map.get('code', 'Debtor Code'), '')).strip()
            if code and code != 'nan':
                vip_raw = str(row.get(col_map.get('vip', 'Attention'), '')).strip().upper()
                debtor_info[code] = {
                    "name":       str(row.get(col_map.get('name', 'Company Name'), '')).strip(),
                    "phone":      str(row.get(col_map.get('phone', 'Phone'), '')).strip().replace('nan',''),
                    "vip":        vip_raw == "VIP",
                    "birth_date": row.get(col_map.get('birth', 'Birth Date'), None),
                    "open_date":  row.get(col_map.get('open', 'Open Acct Date'), None),
                    "type":       str(row.get(col_map.get('type', 'Debtor Type'), '')).strip().replace('nan',''),
                }

    # SKU groups
    sku_groups = {
        "IFACE":   ["IFACE B", "IFACE DB", "IFACE M", "IFACE R"],
        "SUKUN":   ["SKNW", "SKNR"],
        "EVO":     ["EVO"],
        "BISON":   ["BISON-R", "BISON-M", "BISON-G"],
        "LAM+LWM": ["LAM", "LWM"],
    }

    result = {}

    for agent in agents:
        ag_data = canggih_paid[canggih_paid["agent"] == agent]

        # All debtors this agent has transacted with (any month in data)
        all_debtor_codes = ag_data["debtor_code"].unique()

        debtor_cards = []
        for dcode in all_debtor_codes:
            d_rows = ag_data[ag_data["debtor_code"] == dcode]

            # Activation status
            bought_cur   = cur_m  in d_rows["paid_on"].values
            bought_prev1 = prev1_m in d_rows["paid_on"].values

            if bought_cur:
                status = "active"
            elif bought_prev1:
                status = "pending"
            else:
                status = "need_reactivation"

            # Last purchase date
            last_date = d_rows["date_parsed"].max()
            last_date_str = last_date.strftime("%d/%m/%Y") if pd.notnull(last_date) else ""

            # 3-month CTN
            ctn_cur   = round(float(d_rows[d_rows["paid_on"] == cur_m]["qty_ctn"].sum()), 2)
            ctn_prev1 = round(float(d_rows[d_rows["paid_on"] == prev1_m]["qty_ctn"].sum()), 2)
            ctn_prev2 = round(float(d_rows[d_rows["paid_on"] == prev2_m]["qty_ctn"].sum()), 2)

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
            sku_status = {}
            sku_bought_groups = 0
            for grp, codes in sku_groups.items():
                grp_rows = d_rows[d_rows["item_code"].isin(codes)]
                bought_this_month  = cur_m  in grp_rows["paid_on"].values
                bought_past_months = any(
                    m in grp_rows["paid_on"].values for m in [prev1_m, prev2_m, prev3_m]
                )
                if bought_this_month:
                    sku_status[grp] = "this_month"
                    sku_bought_groups += 1
                elif bought_past_months:
                    sku_status[grp] = "past_months"
                else:
                    sku_status[grp] = "never"

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

            # Sales type for this debtor this month
            cur_sales_types = d_rows[d_rows["paid_on"] == cur_m]["sales_type"].unique().tolist()

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
                "volume_drop_pct":    volume_drop_pct,
                "trend":              trend,
                "sku_status":         sku_status,
                "sku_bought_groups":  sku_bought_groups,
                "sku_total_groups":   len(sku_groups),
                "sales_types":        cur_sales_types,
            })

        # Sort: active first, then pending, then need_reactivation
        order = {"active": 0, "pending": 1, "need_reactivation": 2}
        debtor_cards.sort(key=lambda x: order.get(x["status"], 3))

        # Summary counts
        active_count   = sum(1 for d in debtor_cards if d["status"] == "active")
        pending_count  = sum(1 for d in debtor_cards if d["status"] == "pending")
        reactiv_count  = sum(1 for d in debtor_cards if d["status"] == "need_reactivation")

        result[agent] = {
            "debtors":         debtor_cards,
            "total_debtors":   len(debtor_cards),
            "active_count":    active_count,
            "pending_count":   pending_count,
            "reactivation_count": reactiv_count,
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


# ── Working days progress ─────────────────────────────────────────────────────

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
