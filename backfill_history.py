"""
Backfill history.xlsx for Jan 2026 and Feb 2026 using the merged sales report.
Directly processes data without needing date patching.
"""
import json, sys, shutil, importlib
from pathlib import Path
from datetime import date
import pandas as pd

BASE_DIR = Path('/home/claude')
sys.path.insert(0, str(BASE_DIR))

def process_month(target_month_label, targets_file, lookback_months):
    """
    Process a specific historical month.
    target_month_label: e.g. 'Jan 26'
    lookback_months: e.g. ['Oct 25', 'Nov 25', 'Dec 25']
    """
    print(f"\n{'='*55}")
    print(f"  Processing: {target_month_label}")
    print(f"  Lookback:   {lookback_months}")
    print(f"{'='*55}")

    # Load targets for this month
    with open(BASE_DIR / targets_file, encoding='utf-8') as f:
        targets = json.load(f)

    # Import process_data modules
    import process_data as pd_mod
    importlib.reload(pd_mod)

    # Load data directly
    df_raw    = pd_mod.load_sales_report()
    debtor_df = pd_mod.load_debtors()

    # Override current_month and prev_months
    cur_month   = target_month_label
    prev_months = lookback_months

    print(f"  Sales rows loaded: {len(df_raw)}")

    # Scope filter
    df = pd_mod.filter_scope(df_raw)
    print(f"  After scope filter: {len(df)}")

    # Brand config
    brand_config       = targets.get("brand_config", pd_mod.DEFAULT_BRAND_CONFIG)
    group_brand_config = targets.get("group_brand_config", pd_mod.DEFAULT_GROUP_BRAND_CONFIG)

    # Fix empty brand_config
    for brand, codes in brand_config.items():
        if not codes:
            brand_config[brand] = pd_mod.DEFAULT_BRAND_CONFIG.get(brand, [])

    # Agents
    agents_from_targets = list(targets.get("agents", {}).keys())
    agents_from_data    = sorted(df["agent"].dropna().unique().tolist())
    agents = agents_from_targets if agents_from_targets else agents_from_data

    print(f"  Agents: {agents}")

    # Run all calculations
    sales_prog   = pd_mod.calc_sales_progression(df, targets, agents, cur_month)
    brand_comm   = pd_mod.calc_brand_commission(df, targets, agents, cur_month, prev_months, brand_config)
    newbie       = pd_mod.calc_newbie_scheme(df, targets, agents, cur_month)
    aging        = pd_mod.calc_aging(df, agents, cur_month)

    # Campaign map (empty for historical)
    campaign_map = {}
    debtor_cards = pd_mod.calc_debtor_cards(df, debtor_df, agents, cur_month, campaign_map)

    group_brands = pd_mod.calc_group_brand_targets(df, targets, cur_month, group_brand_config)
    kpi          = pd_mod.calc_kpi(agents, targets, sales_prog, brand_comm, debtor_cards)
    team         = pd_mod.calc_team_summary(sales_prog, brand_comm, agents, targets, cur_month)

    # Build working_days for this month
    from datetime import datetime, timedelta
    import calendar as cal_mod
    dt = datetime.strptime(cur_month, "%b %y")
    total_wd = 0
    last_day = cal_mod.monthrange(dt.year, dt.month)[1]
    ph_list = []
    for h in targets.get("public_holidays", []):
        ds = h.get("date", h) if isinstance(h, dict) else h
        if isinstance(ds, str) and ds.startswith(dt.strftime("%Y-%m")):
            try: ph_list.append(date.fromisoformat(ds))
            except: pass
    d = date(dt.year, dt.month, 1)
    while d <= date(dt.year, dt.month, last_day):
        if d.weekday() < 6 and d not in ph_list:
            total_wd += 1
        d += timedelta(days=1)

    working_days = {
        "date": f"{dt.year}-{dt.month:02d}-{last_day:02d}",
        "month_label": cur_month,
        "total_working_days": total_wd,
        "elapsed_working_days": total_wd,
        "theoretical_pct": 100.0,
        "public_holidays_this_month": len(ph_list),
    }

    # Build combined agents dict (same as process_data main)
    agents_out = {}
    for agent in agents:
        agents_out[agent] = {
            "sales_progression": sales_prog.get(agent, {}),
            "brand_commission":  brand_comm.get(agent, {}),
            "newbie_scheme":     newbie.get(agent, {}),
            "aging":             aging.get(agent, {}),
            "debtor_cards":      debtor_cards.get(agent, {}),
            "kpi":               kpi.get(agent, {}),
        }

    data = {
        "current_month":       cur_month,
        "generated_at":        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "agents":              agents_out,
        "team_summary":        team,
        "working_days":        working_days,
        "group_brand_targets": group_brands,
        "birthday_campaign":   {"month": cur_month, "count": 0, "debtors": []},
        "brand_campaigns":     [],
    }

    # Write temporary dashboard_data.json
    import json as json_mod
    tmp_file = BASE_DIR / "dashboard_data.json"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json_mod.dump(data, f, ensure_ascii=False, default=str)

    # Save to history
    import save_history as sh
    importlib.reload(sh)
    sh.save_history()

    print(f"\n✅ {target_month_label} saved to history.xlsx")

# ── Run Jan 2026 ────────────────────────────────────────────────────────
process_month(
    target_month_label = 'Jan 26',
    targets_file       = 'targets_january.json',
    lookback_months    = ['Oct 25', 'Nov 25', 'Dec 25'],
)

# ── Run Feb 2026 ────────────────────────────────────────────────────────
process_month(
    target_month_label = 'Feb 26',
    targets_file       = 'targets_february.json',
    lookback_months    = ['Nov 25', 'Dec 25', 'Jan 26'],
)

# ── Restore Mar 2026 ────────────────────────────────────────────────────
print("\n" + "="*55)
print("  Restoring March 2026 data...")
print("="*55)
import subprocess
result = subprocess.run(['python3', 'process_data.py'], cwd=str(BASE_DIR), capture_output=True, text=True)
print(result.stdout[-200:])

import save_history as sh
importlib.reload(sh)
sh.save_history()
print("✅ March 2026 restored to history.xlsx")
print("\n🎉 All done! history.xlsx now has Jan + Feb + Mar 2026")
