"""
Miracle MD Dashboard — Targets Loader
Fetches targets from Supabase, assembles into targets.json-compatible dict.
Falls back to reading local targets.json if Supabase unreachable.

Usage in process_data.py:
  from targets_loader import load_targets
  targets = load_targets()  # Returns dict identical to targets.json shape
"""
import json
import os
from pathlib import Path
from datetime import datetime

try:
    from supabase import create_client
    HAS_SUPABASE = True
except ImportError:
    HAS_SUPABASE = False

# ── Config ─────────────────────────────────────────────
SUPABASE_URL = "https://rqitgmydcbyiygqjssrb.supabase.co"
SUPABASE_KEY = "sb_publishable_8xb7ZaHyr3OF3WNEqufuDg_67spOIFw"

BASE_DIR = Path(__file__).parent
TARGETS_FILE = BASE_DIR / "targets.json"
BACKUP_FILE = Path(os.getenv("MD_TARGETS_CACHE_FILE", str(BASE_DIR / ".cache" / "targets.latest.json")))


def _log(msg):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    try:
        print(line)
    except UnicodeEncodeError:
        print(line.encode("ascii", errors="replace").decode("ascii"))


def _fetch_table_rows(sb, table, *, required=False):
    """Read one targets table without letting optional permissions discard core targets."""
    try:
        return sb.table(table).select("*").execute().data or []
    except Exception as e:
        if required:
            raise
        _log(f"WARNING: Skipping optional Supabase table {table}: {e}")
        return []


def _norm_agent_code(value):
    return str(value or "").strip().upper()


def apply_agent_replacements(targets):
    """Apply configured agent archive/replacement rules to loaded targets."""
    if not isinstance(targets, dict):
        return targets

    replacements = targets.get("agent_replacements") or {}
    agents = targets.setdefault("agents", {})
    if not isinstance(replacements, dict) or not isinstance(agents, dict):
        return targets

    for predecessor, raw_cfg in replacements.items():
        old_agent = _norm_agent_code(predecessor)
        successor = ""
        from_month = ""

        if isinstance(raw_cfg, str):
            successor = _norm_agent_code(raw_cfg)
        elif isinstance(raw_cfg, dict):
            successor = _norm_agent_code(
                raw_cfg.get("successor")
                or raw_cfg.get("replaced_by")
                or raw_cfg.get("agent")
            )
            from_month = str(
                raw_cfg.get("from_month")
                or raw_cfg.get("inherit_from_month")
                or raw_cfg.get("month")
                or ""
            ).strip()

        if not old_agent or not successor or not from_month:
            continue

        old_cfg = agents.setdefault(old_agent, {})
        if isinstance(old_cfg, dict):
            old_cfg["active"] = False
            old_cfg["archived"] = True
            old_cfg["archived_from_month"] = from_month

        new_cfg = agents.setdefault(successor, {})
        if isinstance(new_cfg, dict):
            new_cfg["active"] = True
            new_cfg["archived"] = False
            new_cfg["inherits_from"] = old_agent
            new_cfg["inherit_from_month"] = from_month

    return targets


def load_targets_from_supabase():
    """Fetch all targets tables and assemble into targets.json-shaped dict.
    Returns None if fails.
    """
    if not HAS_SUPABASE:
        return None

    try:
        sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        _log(f"⚠ Supabase client init failed: {e}")
        return None

    targets = {
        "_comment": "MD Sales Dashboard — loaded from Supabase",
        "_loaded_at": datetime.now().isoformat(),
    }

    try:
        # 1. Agents
        rows = _fetch_table_rows(sb, "targets_agents", required=True)
        agents = {}
        for r in rows:
            agent = r["agent"]
            cfg = {
                "is_newbie": r.get("is_newbie", False),
                "active": r.get("active", True),
                "is_new_this_month": r.get("is_new_this_month", False),
            }
            # Include non-null JSONB fields
            for k in ["sales_progression", "brand_commission", "kpi_targets", "campaign_targets",
                      "kpi_auto_base", "newbie_tiers", "newbie_account_tiers"]:
                if r.get(k) is not None:
                    cfg[k] = r[k]
            agents[agent] = cfg
        targets["agents"] = agents

        # 2. Monthly targets
        rows = _fetch_table_rows(sb, "targets_monthly", required=True)
        monthly = {}
        for r in rows:
            month = r["month"]
            agent = r["agent"]
            if month not in monthly:
                monthly[month] = {}
            # Special pseudo-agent '_GROUP_' stores group-level T1/T2/GA/MA override
            # Flatten it back to _group_override key in monthly[month]
            if agent == "_GROUP_":
                sp = r.get("sales_progression") or {}
                if sp:
                    monthly[month]["_group_override"] = sp
                continue
            cfg = {
                "is_newbie": r.get("is_newbie", False),
                "active": r.get("active", True),
            }
            for k in ["sales_progression", "brand_commission", "kpi_targets", "kpi_overrides"]:
                if r.get(k) is not None:
                    cfg[k] = r[k]
            monthly[month][agent] = cfg
        targets["monthly_targets"] = monthly

        # 3. Agent pins
        rows = _fetch_table_rows(sb, "targets_pins")
        targets["agent_pins"] = {r["agent"]: r["pin"] for r in rows}

        # 4. Birthday overrides
        rows = _fetch_table_rows(sb, "targets_birthday_overrides")
        bday = {}
        for r in rows:
            month = r.get("month")
            code = r.get("debtor_code")
            action = r.get("action") or r.get("birth_date")
            if not month or not code or action not in ("add", "remove"):
                continue
            bday.setdefault(month, {})[code] = action
        targets["birthday_overrides"] = bday

        # 5. Group brand targets
        rows = _fetch_table_rows(sb, "targets_group_brand")
        targets["group_brand_targets"] = {r["brand"]: float(r["target_ctn"] or 0) for r in rows}

        # 6. Static config
        rows = _fetch_table_rows(sb, "targets_static")
        for r in rows:
            targets[r["key"]] = r["value"]

        # 7. Snapshots
        rows = _fetch_table_rows(sb, "targets_snapshots")
        monthly_snaps = {}
        pen_snaps = {}
        for r in rows:
            if r["kind"] == "monthly":
                monthly_snaps[r["month"]] = r["value"]
            elif r["kind"] == "penetration":
                pen_snaps[r["month"]] = r["value"]
        if monthly_snaps:
            targets["monthly_snapshots"] = monthly_snaps
        if pen_snaps:
            targets["penetration_snapshots"] = pen_snaps

        _log(f"  Loaded from Supabase: {len(agents)} agents, {len(monthly)} months, "
             f"{len(targets.get('agent_pins', {}))} pins")
        return targets

    except Exception as e:
        _log(f"⚠ Supabase load failed: {e}")
        return None


def load_targets_from_file():
    """Load from local targets.json (legacy fallback)."""
    if not TARGETS_FILE.exists():
        _log(f"⚠ {TARGETS_FILE} not found")
        return {}
    try:
        with open(TARGETS_FILE, encoding="utf-8") as f:
            t = json.load(f)
        _log(f"  Loaded from file: {len(t)} sections")
        return t
    except Exception as e:
        _log(f"⚠ File load failed: {e}")
        return {}


def save_file_backup(targets):
    """Write live targets to an untracked local cache for backup/audit."""
    try:
        BACKUP_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(BACKUP_FILE, "w", encoding="utf-8") as f:
            json.dump(targets, f, indent=2, ensure_ascii=False)
        _log(f"  Wrote targets cache: {BACKUP_FILE.name} ({len(targets)} sections)")
    except Exception as e:
        _log(f"WARNING: Targets cache save failed: {e}")


def sync_to_supabase(targets):
    """Push targets dict back to Supabase. Used after process_data.py modifies
    snapshots + auto-generated KPI targets.
    Reverse of load_targets_from_supabase().
    Raises exception on failure so caller can log."""
    if not HAS_SUPABASE:
        raise RuntimeError("supabase library not installed")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. Agents (upsert all)
    agents = targets.get("agents", {})
    if agents:
        rows = []
        for agent, cfg in agents.items():
            rows.append({
                "agent": agent,
                "is_newbie": cfg.get("is_newbie", False),
                "active": cfg.get("active", True),
                "is_new_this_month": cfg.get("is_new_this_month", False),
                "sales_progression": cfg.get("sales_progression"),
                "brand_commission": cfg.get("brand_commission"),
                "kpi_targets": cfg.get("kpi_targets"),
                "campaign_targets": cfg.get("campaign_targets") or {},
                "kpi_auto_base": cfg.get("kpi_auto_base"),
                "newbie_tiers": cfg.get("newbie_tiers"),
                "newbie_account_tiers": cfg.get("newbie_account_tiers"),
                "updated_by": "process_data.py",
            })
        sb.table("targets_agents").upsert(rows).execute()

    # 2. Monthly targets
    monthly = targets.get("monthly_targets", {})
    if monthly:
        rows = []
        for month, agents_month in monthly.items():
            for agent, cfg in agents_month.items():
                # Skip special keys (start with _) — handled below
                if agent.startswith("_"):
                    continue
                rows.append({
                    "month": month,
                    "agent": agent,
                    "is_newbie": cfg.get("is_newbie", False),
                    "active": cfg.get("active", True),
                    "sales_progression": cfg.get("sales_progression"),
                    "brand_commission": cfg.get("brand_commission"),
                    "kpi_targets": cfg.get("kpi_targets"),
                    "kpi_overrides": cfg.get("kpi_overrides"),
                    "updated_by": "process_data.py",
                })
            # Group-level override → stored as pseudo-agent '_GROUP_'
            grp_override = agents_month.get("_group_override")
            if grp_override and isinstance(grp_override, dict) and len(grp_override):
                rows.append({
                    "month": month,
                    "agent": "_GROUP_",
                    "is_newbie": False,
                    "active": True,
                    "sales_progression": grp_override,
                    "brand_commission": None,
                    "kpi_targets": None,
                    "kpi_overrides": None,
                    "updated_by": "process_data.py",
                })
        # Batch upsert
        for i in range(0, len(rows), 100):
            sb.table("targets_monthly").upsert(rows[i:i+100]).execute()

    # 3. Static config (brand_config, etc.)
    for key in ["agent_replacements", "brand_config", "group_brand_config",
                "inhouse_codes", "kpi_weights", "newbie_scheme", "sku_trace_config"]:
        if key in targets:
            sb.table("targets_static").upsert({
                "key": key, "value": targets[key]
            }).execute()

    # 4. Group brand targets
    gbt = targets.get("group_brand_targets", {})
    if gbt:
        rows = [{"brand": b, "target_ctn": float(t or 0)} for b, t in gbt.items()]
        sb.table("targets_group_brand").upsert(rows).execute()

    # 5. Agent pins
    pins = targets.get("agent_pins", {})
    if pins:
        rows = [{"agent": a, "pin": str(p)} for a, p in pins.items()]
        sb.table("targets_pins").upsert(rows).execute()

    # 6. Birthday overrides
    bday = targets.get("birthday_overrides", {})
    if bday:
        rows = []
        for month, code_map in bday.items():
            if isinstance(code_map, dict) and len(str(month)) == 7 and str(month)[4] == "-":
                for code, action in code_map.items():
                    if action not in ("add", "remove"):
                        continue
                    rows.append({
                        "month": month,
                        "debtor_code": code,
                        "action": action,
                        "birth_date": action,
                    })
        if rows:
            sb.table("targets_birthday_overrides").upsert(rows, on_conflict="month,debtor_code").execute()

    # 7. Snapshots
    for month, snap in targets.get("monthly_snapshots", {}).items():
        sb.table("targets_snapshots").upsert({
            "kind": "monthly", "month": month, "value": snap
        }).execute()
    for month, snap in targets.get("penetration_snapshots", {}).items():
        sb.table("targets_snapshots").upsert({
            "kind": "penetration", "month": month, "value": snap
        }).execute()


def load_targets():
    """Main entry point. Tries Supabase first, falls back to file.
    Also writes file backup if Supabase succeeded (keeps file in sync)."""
    _log("Loading targets...")
    t = load_targets_from_supabase()
    if t is not None:
        t = apply_agent_replacements(t)
        # Write backup for offline reliability
        save_file_backup(t)
        return t
    # Fallback to file
    _log("  Falling back to local file")
    return apply_agent_replacements(load_targets_from_file())


if __name__ == "__main__":
    # Test it
    t = load_targets()
    print(f"\nSections: {list(t.keys())}")
    print(f"Agents: {len(t.get('agents', {}))}")
    print(f"Monthly: {list(t.get('monthly_targets', {}).keys())}")
