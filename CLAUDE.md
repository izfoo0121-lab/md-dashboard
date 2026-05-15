# Touro MD Dashboard — Handoff

## Project Overview

Sales dashboard for Touro MD, a sales team management system. Tracks debtor purchases, agent KPIs, campaigns such as TR12, EVO MAY, Birthday, and provides admin tools for campaign configuration. Static site deployed via GitHub Pages, backed by Supabase for dynamic data.

## Repositories

### PROD

- Path: `C:\Users\tgy_3\Desktop\md-dashboard`
- Branch: `main`
- App code baseline before this handoff doc: `56add56`
- URL: https://izfoo0121-lab.github.io/md-dashboard/
- Data refresh/deploy wrapper: `update_dashboard.bat`

### TEST

- Path: `C:\Users\tgy_3\Desktop\md-dashboard-test`
- Branch: `main`
- App code baseline before this handoff doc: `eeeeace`
- Feature branch exists: `codex/per-campaign-kpi`
- URL: https://izfoo0121-lab.github.io/md-dashboard-test/

Both repos were clean after the latest pushes.

## Backend

Supabase project: `rqitgmydcbyiygqjssrb.supabase.co`

Shared between test and prod. Important tables:

- `campaigns` — campaign definitions with `kpi_numerators` JSONB and mechanism settings.
- `campaign_debtors` — enrolled debtors per campaign.
- `campaign_cat_rules` — campaign category rules, mostly empty.
- `campaign_deliveries` — delivery/claim tracking input for scoring.
- `kpi_manual_overrides` — manual KPI override values.
- `claims` — agent-facing audit table for Mark Claimed / Send Gift.
- `targets_agents` — per-agent monthly targets with `campaign_targets` JSONB.
- `targets_static` — per-month static config such as `kpi_weights`.
- `patronage_history` — frozen month-start denominator for sustained patronage rate.

RLS policies allow anon read and authenticated writes on relevant tables. Admin UI uses authenticated flow; sales dashboard uses publishable key.

## Key Files

- `process_data.py` — main pipeline, reads Supabase + Excel, writes JSON outputs.
- `update_dashboard.bat` — prod wrapper, runs pipeline and pushes generated data.
- `sales_dashboard.html` — agent-facing dashboard.
- `admin.html` — admin tool for campaigns, targets, overrides.
- `campaign_audit.html` — audit/approval view for claims and entitlements.
- `management.html` — management console, campaign progress, yearly view.
- `debtor_analysis.html` — debtor period comparison analysis.
- `Debtor Maintenance.xlsx` — debtor metadata source of truth.
- `MD Sales Report.xlsx` — invoice/sales source of truth.
- `dashboard_data.json` — main pipeline output.
- `data_may26.json` — current month output.
- `debtor_analysis_data.json` — debtor analysis output.
- `migrations/` — SQL migration audit files.

## Locked Business Rules

### EVO MAY 2026

Campaign id: `camp_1777773301331`

- Type: `conversion_tiered`
- Definition: debtor never bought EVO from any agent in Feb-Apr 2026, then bought EVO in May from current agent.
- Lookback is debtor-wide across all agents. Do not switch to agent-based lookback without explicit decision.
- Lookback exclusion: any EVO purchase at any price in Feb-Apr disqualifies.
- Current conversion: at least one May EVO invoice line with RM/CTN >= 41.
- Enrollment: Active, GRP 2A, non-Personal debtors, excluding historical EVO buyers.
- Expected current enrollment after cleanup: about `1089`.
- Tier model: per-agent count-based, not per-debtor.
- Tier thresholds: `[4, 7, 10, 14]` mapped to `BASELINE`, `TIER 1`, `TIER 2`, `TIER 3`.
- Count `0-3` means no tier yet and should show progress to BASELINE.
- Tier is status display only; do not auto-calculate reward from tier.

### TR12 PK 文化 May 2026

Campaign id: `camp_1778113461122`

- Type: `conversion_simple`
- Numerators: `count` and `ctn`.
- Conversion threshold: RM/CTN >= 37.50 per invoice line.

### 持续光顾率

- Target is hard-locked at 80%.
- Admin input is disabled.
- Pipeline ignores stale/manual `activation_rate` overrides.
- Calculation: `activation_active / activation_base`.
- `activation_base` is frozen month-start baseline from `patronage_history`, not live total.

## Critical Pipeline Behaviors

```python
# Converted flag
camp["converted"] = (lookback_ctn == 0) and (current_ctn > 0)

# Definition A debtor-wide lookback
d_all_invoice_rows = canggih_invoiced[canggih_invoiced["debtor_code"] == dcode]

# Per-agent tier from converted count
def _agent_tier_from_count(count, thresholds, tier_names):
    ...
```

Important data rules:

- CTN tiles and popups use invoice-month basis, not paid-month.
- 未购买 filter uses invoice-basis history.
- Popup totals must match card totals.
- Conversion campaign rollup writes:
  - `agent_tier_idx`
  - `agent_tier_label`
  - `to_next_tier`
  - `next_tier_label`
  - `converted_count`
  - `enrolled_count`

## Recent Major Work

### Per-Campaign KPI Rebuild

Completed through Phase D on prod.

- Added `kpi_numerators`.
- Admin UI supports numerator checkboxes: Count, Carton Volume.
- Migrated campaign target keys to `camp_<id>_<numerator>`.
- Pipeline scoring generates per-campaign KPI items.
- Scoring priority:
  1. `campaign_deliveries`
  2. `kpi_manual_overrides`
  3. Auto-detect from sales
  4. Default 0
- Mark Claimed writes to both `claims` and `campaign_deliveries`.

### Campaign Mechanism Builder

Admin UI supports:

- Mechanism type
- Conversion rule
- Match by
- Qualifying item group
- Min RM/CTN
- Lookback months
- Volume basis
- Sort by
- Reward/claim tiers

Irrelevant tier fields are hidden for non-tiered campaigns.

### Campaign Audit

- Shows Birthday claimed status.
- ALL view includes entitlements.
- Conversion campaign tabs show converted debtors.
- Birthday audit grouped by agent.
- Lists are collapsible/minimizable.
- TR12/EVO tabs show claim/converted debtor info.

### Management

- Expired campaigns moved to a separate view.
- Campaign progress is month-aware.
- Campaign-period claims are loaded for expired cards.
- Follow-up purchase tracking concept added.
- Debtor movement list paginated.
- SKU filters work in movement views.
- Yearly target progression analysis improved.

### Debtor Analysis

New page: `debtor_analysis.html`

- Period/month comparison.
- Multi-select filters: agent, debtor type, brand, SKU, sales type.
- Grouping options.
- Sparkline/trend movement view.

### Sales Dashboard

- Dark/light toggle.
- Persistent content size toggle:
  - `A Compact` = 85%
  - `A Normal` = 100%
  - `A Large` = 120%
  - `A XL` = 135%
- Debtor CTN card and popup alignment fixed.
- Mark Claimed button works across campaign types.

## Recent Bug Fixes

- 未购买 filter fixed using invoice-basis `unpurchased_breakdown`.
- Conversion flag now requires `lookback_ctn == 0`.
- Historical EVO buyers removed from EVO MAY enrollment.
- Stale `activation_rate = 1` no longer affects scoring.
- Management and admin sustained patronage target/calculation aligned.
- EVO MAY Mark Claimed button missing in conversion branch fixed.
- Admin init-order bugs for campaign data rendering fixed.

## Open / Pending Items

Low priority / parked:

- `1125 vs 1089` EVO enrollment gap: user manual count differed from pipeline. Parked unless user reopens.
- KEAN toggle behavior: unclear whether disabled agent should still show data but skip KPI.
- XIAN converted count small gap was discussed; user later accepted manual calculation issue.

Future polish:

- Debtor analysis page UI after real use.
- Yearly target progression as stronger planning tool.
- Campaign mechanism builder advanced reward tiers and FOC SKU logic.
- Decide whether admin Section C warning banner still needed.

## Working Conventions

- Prefer test first for risky changes, then prod.
- For small fixes, both repos often patched and pushed together.
- Supabase SQL is run manually by user; keep migration audit files in `migrations/`.
- Regenerate pipeline via `python process_data.py` or prod `update_dashboard.bat`.
- Verify live GitHub Pages markers after pushing important UI changes.
- Keep communication concise and decision-focused.

## Critical Things Not To Do

- Do not switch EVO MAY to agent-based lookback without explicit user decision.
- Do not remove RM41 floor from EVO current conversion.
- Do not use paid-month for CTN tiles or 未购买 filter.
- Do not add automatic reward calculations to EVO tiers.
- Do not trust stale `activation_rate` overrides; target is fixed 80.

## Useful Diagnostics

Browser console:

```javascript
const evo = DATA.agents.LEON.conversion_campaigns['camp_1777773301331'];
console.log(evo);
```

Supabase:

```sql
SELECT COUNT(*)
FROM campaign_debtors
WHERE campaign_id = 'camp_1777773301331';
```

Pipeline JSON:

```python
import json
with open("dashboard_data.json", encoding="utf-8") as f:
    d = json.load(f)
print(d["agents"]["LEON"]["conversion_campaigns"].get("camp_1777773301331", {}))
```
