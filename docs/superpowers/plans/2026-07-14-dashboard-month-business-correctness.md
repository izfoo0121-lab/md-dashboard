# Dashboard Month And Business Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct net-CTN purchase logic, KPI applicability, data-quality publishing, future planning, movement cohorts, and export parity.

**Architecture:** Put purchase and target applicability rules in tested pure helpers, validate snapshots before indexing/publishing, and make one future-normalization path feed rendering and every export.

**Tech Stack:** Python 3.11/pandas, JavaScript, Node `node:test`, Python `unittest`.

---

### Task 1: Define Positive Net CTN Purchase Semantics

**Files:**
- Modify: `process_data.py:1659-1699,2808-2994,3965-4181`
- Create: `tests/test_net_ctn_business_rules.py`

- [ ] **Step 1: Write failing net-quantity tests**

```python
def test_zero_net_ctn_is_not_purchase_or_new_sku(self):
    df = sales_rows(("CMP", 5), ("CMP", -5))
    card = build_card(df)
    self.assertFalse(card["sku_status"]["CMP"]["current"])
    self.assertEqual(0, card["new_sku_count"])

def test_negative_net_ctn_is_not_penetration(self):
    df = sales_rows(("EVO", -2))
    self.assertNotIn("D001", brand_buyers(df, "EVO", "Jul 26"))

def test_positive_net_ctn_remains_a_purchase(self):
    df = sales_rows(("TR20", 5), ("TR20", -1))
    self.assertTrue(build_card(df)["sku_status"]["TR20"]["current"])
```

- [ ] **Step 2: Run and confirm current row-existence failures**

Run: `python -m unittest tests.test_net_ctn_business_rules -v`

Expected: zero-net and negative-net cases fail.

- [ ] **Step 3: Add and use one grouped positive-purchase helper**

```python
def positive_net_purchase_rows(df, group_columns):
    if df.empty:
        return df.iloc[0:0].copy()
    grouped = (df.groupby(group_columns, dropna=False, as_index=False)["ctn"]
                 .sum())
    return grouped[grouped["ctn"] > 0].copy()
```

Use it for debtor activation, SKU status, New SKU current/lookback checks,
brand commission buyers, penetration source data, and campaign candidates. Do
not pre-filter positive transaction lines before aggregation.

- [ ] **Step 4: Run net-CTN and existing SKU tests**

Run: `python -m unittest tests.test_net_ctn_business_rules tests.test_new_sku_groups tests.test_configurable_brand_behavior -v`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add process_data.py tests/test_net_ctn_business_rules.py
git commit -m "fix: base SKU purchase rules on positive net CTN"
```

### Task 2: Exclude Missing And Non-Positive KPI Targets

**Files:**
- Modify: `process_data.py:5424-5620`
- Modify: `sales_dashboard.html:2990-3015,4588-4615,7790-7830`
- Modify: `tests/test_kpi_missing_targets.py`
- Modify: `tests/sales_kpi_target_blank.test.cjs`

- [ ] **Step 1: Add failing applicability and denominator tests**

```python
for value in (None, "", 0, -1, float("nan"), float("inf")):
    item = build_birthday_kpi(target=value)
    self.assertTrue(item["excluded"])
    self.assertTrue(item["target_missing"])
    self.assertEqual(0, item["max_score"])
```

```javascript
assert.equal(recalculateKpiTotals({ birthday: missingTargetItem }).maxTotal, 0);
assert.equal(applyBirthdayTarget(missingTargetItem, 0).max_score, 0);
```

- [ ] **Step 2: Run and confirm denominator failures**

Run: `python -m unittest tests.test_kpi_missing_targets -v`

Run: `node --test tests/sales_kpi_target_blank.test.cjs`

Expected: birthday/manual non-positive targets retain score weight and fail.

- [ ] **Step 3: Implement one finite-positive target rule**

```python
def applicable_target(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed > 0 else None

def exclude_missing_target(item):
    item.update(target=None, target_missing=True, excluded=True,
                max_score=0, score=0, pct=0)
    return item
```

Use the same semantics in the browser birthday/manual override recalculation and
recompute totals only from non-excluded items.

- [ ] **Step 4: Run KPI tests**

Run: `python -m unittest tests.test_kpi_missing_targets tests.test_kpi_auto_actual_fallback -v`

Run: `node --test tests/sales_kpi_target_blank.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add process_data.py sales_dashboard.html tests/test_kpi_missing_targets.py tests/sales_kpi_target_blank.test.cjs
git commit -m "fix: exclude missing KPI targets from totals"
```

### Task 3: Add Snapshot Completeness And Debtor-Type Publish Gates

**Files:**
- Modify: `dashboard_snapshot_contract.py`
- Modify: `process_data.py:3680-3763,6448-6609`
- Create: `tests/test_snapshot_validation.py`
- Create: `tests/test_dashboard_publish_quality.py`

- [ ] **Step 1: Write failing quality tests**

```python
def test_empty_shell_month_is_not_publishable(self):
    with self.assertRaisesRegex(SnapshotValidationError, "too few debtor records"):
        validate_snapshot(load_fixture("data_mar26.json"))

def test_current_publish_rejects_missing_debtor_type_column(self):
    quality = {"report_column_present": False, "sales_rows": 61940,
               "sales_rows_with_type": 0, "missing_master_debtors": 153}
    with self.assertRaisesRegex(SnapshotValidationError, "debtor type"):
        validate_data_quality(quality, current=True)

def test_historical_snapshot_without_types_disables_type_filter(self):
    capabilities = derive_snapshot_capabilities({"sales_rows_with_type": 0}, current=False)
    self.assertFalse(capabilities["debtor_type_filter"])
```

- [ ] **Step 2: Run and confirm silent-publish failures**

Run: `python -m unittest tests.test_snapshot_validation tests.test_dashboard_publish_quality -v`

Expected: FAIL because quality is informational only and March is accepted.

- [ ] **Step 3: Implement explicit quality policy**

```python
def validate_data_quality(quality, current, max_missing_master=0):
    if current and not quality.get("report_column_present"):
        raise SnapshotValidationError("current sales report is missing debtor type column")
    if current and int(quality.get("sales_rows_with_type") or 0) <= 0:
        raise SnapshotValidationError("current sales report has zero typed rows")
    if int(quality.get("missing_master_debtors") or 0) > max_missing_master:
        raise SnapshotValidationError("transaction debtors are missing master type")
```

Require a structurally valid month, non-empty agents, and a configured minimum
debtor count derived from the previous valid month. Rebuild `months_index.json`
from validated local snapshots; do not append unconditionally.
Historical snapshots that are otherwise valid but lack typed rows receive
`capabilities.debtor_type_filter=false`; the browser hides their type chips
instead of displaying misleading zero counts.

- [ ] **Step 4: Run quality and loader tests**

Run: `python -m unittest tests.test_snapshot_validation tests.test_dashboard_publish_quality tests.test_sales_report_loader tests.test_debtor_type_policy -v`

Expected: quality gates pass while legacy loader compatibility remains intact.

- [ ] **Step 5: Commit**

```powershell
git add dashboard_snapshot_contract.py process_data.py tests/test_snapshot_validation.py tests/test_dashboard_publish_quality.py
git commit -m "fix: block incomplete dashboard snapshots"
```

### Task 4: Resolve And Roll Future Planning From Latest Actual Month

**Files:**
- Modify: `sales_dashboard.html:2167-2375,2612-2890,4685-4707`
- Create: `tests/sales_future_planning.test.cjs`

- [ ] **Step 1: Write failing resolver and roll tests**

```javascript
test('future source is latest valid month before request, not open DATA', () => {
  assert.equal(resolveFutureSourceMonth('Aug 26', ['Apr 26', 'Jul 26', 'Jun 26']), 'Jul 26');
});

test('future window shifts actual history exactly once', () => {
  const result = futureDebtorPlanningCopy({ prev3: 110, prev2: 100, prev1: 52, current: 45 });
  assert.deepEqual(monthValues(result), [100, 52, 45, 0]);
  assert.deepEqual(result.sku_status, {});
});
```

- [ ] **Step 2: Run and confirm clone-current failures**

Run: `node --test tests/sales_future_planning.test.cjs`

Expected: FAIL because the page clones current DATA and does not roll values.

- [ ] **Step 3: Implement chronological source resolution and normalization**

```javascript
function resolveFutureSourceMonth(requested, available) {
  const requestKey = monthSortKey(requested);
  const prior = available.filter(m => monthSortKey(m) < requestKey)
                         .sort((a, b) => monthSortKey(b) - monthSortKey(a));
  if (!prior.length) throw new Error(`No actual snapshot before ${requested}`);
  return prior[0];
}

function rollPlanningMonths(values) {
  return { prev3: values.prev2, prev2: values.prev1,
           prev1: values.current, current: 0 };
}
```

Fetch the resolved source through `DashboardApi.loadData(sourceMonth)`, relabel
the requested month, clear transaction-derived status/campaign fields, and mark
`is_future_view=true`.

- [ ] **Step 4: Run future tests**

Run: `node --test tests/sales_future_planning.test.cjs tests/sales_iface_campaign.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add sales_dashboard.html tests/sales_future_planning.test.cjs
git commit -m "fix: roll future planning from latest actual month"
```

### Task 5: Normalize Movement And Special Filter Policy

**Files:**
- Modify: `sales_dashboard.html:3957-4175,4730-4945,5922-5998,6453-6467`
- Create: `tests/sales_movement_net_ctn.test.cjs`
- Create: `tests/sales_special_filter_policy.test.cjs`

- [ ] **Step 1: Write failing movement and filter tests**

```javascript
test('returns never create negative gain or drop above 100 percent', () => {
  assert.deepEqual(movement(-2, 0), { kind: 'none', pct: 0 });
  assert.deepEqual(movement(1, -1), { kind: 'drop', pct: 100, stopped: true });
});

test('future view rejects transaction-derived special filters', () => {
  assert.equal(canUseSpecialFilter('drop', { is_future_view: true }), false);
  assert.equal(canUseSpecialFilter('unpurchased', { is_future_view: true }), false);
});
```

- [ ] **Step 2: Run and confirm current formula/policy failures**

Run: `node --test tests/sales_movement_net_ctn.test.cjs tests/sales_special_filter_policy.test.cjs`

Expected: negative/over-100 movement and future cohort tests fail.

- [ ] **Step 3: Implement bounded movement and explicit reset policy**

```javascript
function normalizedMovement(previousRaw, currentRaw) {
  const previous = Math.max(0, Number(previousRaw) || 0);
  const current = Math.max(0, Number(currentRaw) || 0);
  if (previous > 0 && current < previous)
    return { kind: 'drop', pct: Math.min(100, (previous - current) / previous * 100), stopped: current === 0 };
  if (current > previous)
    return { kind: 'gain', pct: previous > 0 ? (current - previous) / previous * 100 : 100, stopped: false };
  return { kind: 'none', pct: 0, stopped: false };
}
```

`setSpecialFilter()` clears incompatible visible status/pending/type controls.
Disable and explain transaction-derived chips in future views. Use explicit
chronological previous-month keys rather than object property order.

- [ ] **Step 4: Run movement/filter tests**

Run: `node --test tests/sales_movement_net_ctn.test.cjs tests/sales_special_filter_policy.test.cjs tests/sales_filtered_debtor_export.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add sales_dashboard.html tests/sales_movement_net_ctn.test.cjs tests/sales_special_filter_policy.test.cjs
git commit -m "fix: normalize movement and special filters"
```

### Task 6: Make Full And Filtered Exports Share Canonical Rows

**Files:**
- Modify: `sales_dashboard.html:1537-1634,5602-5758`
- Create: `tests/sales_export_parity.test.cjs`
- Modify: `tests/sales_full_debtor_export.test.cjs`

- [ ] **Step 1: Write failing future export parity test**

```javascript
test('future full export equals unfiltered canonical normalized rows', () => {
  const full = buildFullDebtorExportRows(futureData, 'BEN');
  const filtered = buildFilteredDebtorExportRows(publishAllVisible(futureData, 'BEN'));
  assert.deepEqual(full.map(coreExportFields), filtered.map(coreExportFields));
  assert.equal(full[0].current_ctn, 0);
});

test('birthday export marker uses resolved month override cohort', () => {
  assert.equal(buildExportRow(overriddenBirthdayDebtor).birthday_this_month, 'Yes');
});
```

- [ ] **Step 2: Run and confirm prior-actual full export failure**

Run: `node --test tests/sales_export_parity.test.cjs tests/sales_full_debtor_export.test.cjs`

Expected: future full export contains prior actual status/CTN and fails.

- [ ] **Step 3: Build one canonical normalized list**

```javascript
function canonicalExportDebtors(data, agent) {
  const raw = data.agents?.[agent]?.debtor_cards?.debtors || [];
  return data.is_future_view ? raw.map(futureDebtorPlanningCopy) : raw;
}
```

Both full and filtered exporters call the same row builder. Filtered export only
narrows the canonical list. Preserve all-results behavior independent of
pagination. Derive the Birthday export marker from the selected month's resolved
birthday cohort, including overrides, rather than the raw debtor flag.

- [ ] **Step 4: Run all export tests**

Run: `node --test tests/sales_export_parity.test.cjs tests/sales_full_debtor_export.test.cjs tests/sales_filtered_debtor_export.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add sales_dashboard.html tests/sales_export_parity.test.cjs tests/sales_full_debtor_export.test.cjs
git commit -m "fix: unify full and filtered export data"
```
