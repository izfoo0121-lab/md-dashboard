# Dashboard UI And Deployment Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish UI/accessibility fixes, eliminate stale state and caches, verify real browser behavior, and remove sensitive snapshots from the public Git tree only after protected readers pass.

**Architecture:** Consolidate state-reset and modal behavior into small helpers, add browser-level QA, then perform a gated cutover that retains local generated files but stops publishing them.

**Tech Stack:** HTML/CSS/JavaScript, Node `node:test`, Playwright, Python `unittest`, GitHub Pages.

---

### Task 1: Repair Layout, Viewport, Tabs, And Dialog Semantics

**Files:**
- Modify: `sales_dashboard.html:8-164,501-520,1408-1510,3259-3300,7629-9205`
- Create: `tests/sales_dashboard_ui_hardening.test.cjs`

- [ ] **Step 1: Write failing static UI assertions**

```javascript
assert.match(source, /\.brand-banner\s*\{[^}]*border:/s);
assert.doesNotMatch(source, /maximum-scale=1(?:\.0)?/);
assert.match(source, /role="tablist"/);
assert.equal((source.match(/role="tab"/g) || []).length, 8);
assert.match(source, /role="dialog"[^>]*aria-modal="true"/);
assert.doesNotMatch(source, /onclick="switchView\([^)]*\)"\s*>\s*<div/);
```

- [ ] **Step 2: Run and confirm CSS/accessibility failures**

Run: `node --test tests/sales_dashboard_ui_hardening.test.cjs`

Expected: missing banner selector, constrained viewport, non-button tabs, and non-modal sheets fail.

- [ ] **Step 3: Implement the minimal semantic controls**

```css
.brand-banner {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 12px 14px;
  display: flex;
  gap: 10px;
  align-items: center;
}
@media (max-width: 600px) {
  body.size-large, body.size-xl { zoom: 1; font-size: 16px; }
}
```

Change eight view controls to `<button type="button" role="tab">`; add roving
`tabindex`, `aria-selected`, ArrowLeft/ArrowRight/Home/End handling, and matching
`role="tabpanel"` containers. Add a shared dialog controller:

```javascript
function openDashboardDialog(element, opener = document.activeElement) {
  element.dataset.openerId = ensureElementId(opener);
  element.hidden = false;
  document.querySelector('main')?.setAttribute('inert', '');
  focusFirstControl(element);
}

function closeDashboardDialog(element) {
  element.hidden = true;
  document.querySelector('main')?.removeAttribute('inert');
  document.getElementById(element.dataset.openerId)?.focus();
}
```

Use it for flag, campaign, birthday, and event sheets. Escape closes sheets and
clears, but does not bypass, the mandatory PIN gate.

- [ ] **Step 4: Run static UI tests**

Run: `node --test tests/sales_dashboard_ui_hardening.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add sales_dashboard.html tests/sales_dashboard_ui_hardening.test.cjs
git commit -m "fix: harden dashboard layout and keyboard access"
```

### Task 2: Centralize Filter, Export, And Birthday Cache Resets

**Files:**
- Modify: `sales_dashboard.html:1114,1514-1634,3415-3508,3957-3983,4344-4370,5760-5910`
- Modify: `tests/sales_filtered_debtor_export.test.cjs`
- Modify: `tests/sales_dashboard_refresh_button.test.cjs`

- [ ] **Step 1: Add failing state-lifecycle tests**

```javascript
test('transition clears every export cache before async load', () => {
  seedAllExportCaches('BEN', 'Jul 26');
  beginDebtorExportTransition('Jun 26');
  assert.equal(_lastUnpurchasedExport, null);
  assert.equal(_lastCampsExport, null);
  assert.equal(debtorExportViewState.ready, false);
});

test('birthday failure retries and Refresh clears successful cache', async () => {
  await assert.rejects(() => ensureBirthdayOverridesForMonth('Jul 26'));
  assert.equal('Jul 26' in BIRTHDAY_OVERRIDES_BY_MONTH, false);
  await ensureBirthdayOverridesForMonth('Jul 26');
  clearDashboardDataCaches();
  assert.deepEqual(BIRTHDAY_OVERRIDES_BY_MONTH, {});
});
```

- [ ] **Step 2: Run and confirm stale-cache failures**

Run: `node --test tests/sales_filtered_debtor_export.test.cjs tests/sales_dashboard_refresh_button.test.cjs`

Expected: stale embedded export and permanent birthday-empty cache tests fail.

- [ ] **Step 3: Implement one reset function and context checks**

```javascript
function resetDebtorFilterState() {
  searchTerm = '';
  statusFilter = 'all';
  pendingFilter = 'all';
  typeFilter = 'all';
  specialFilter = null;
  syncFilterControlsFromState();
}

function invalidateDebtorExports() {
  debtorExportViewState = createEmptyDebtorExportViewState();
  _lastUnpurchasedExport = null;
  _lastCampsExport = null;
  closeDebtorDownloadMenu({ restoreFocus: false });
}
```

Call both before any agent/month async transition. Store `agent` and `month` in
embedded export caches and reject export when either differs from current
context. Do not cache failed birthday fetches; Refresh clears successful cache.

- [ ] **Step 4: Run state tests**

Run: `node --test tests/sales_filtered_debtor_export.test.cjs tests/sales_dashboard_refresh_button.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add sales_dashboard.html tests/sales_filtered_debtor_export.test.cjs tests/sales_dashboard_refresh_button.test.cjs
git commit -m "fix: reset dashboard filters and export caches"
```

### Task 3: Fix Pagination And Remove Proven Dead Code

**Files:**
- Modify: `sales_dashboard.html:4848-5425,6582-6595`
- Modify: `tests/sales_dashboard_ui_hardening.test.cjs`

- [ ] **Step 1: Add failing formatter and symbol-removal tests**

```javascript
assert.equal(formatPageInfo(0, 1, 25), '0–0 of 0');
assert.equal(formatPageInfo(37, 1, 25), '1–25 of 37');
for (const symbol of ['legacyRenderUnpurchasedMode', 'legacyExportUnpurchasedExcel',
                      'legacyExportUnpurchasedPDF']) {
  assert.equal(source.includes(`function ${symbol}`), false);
}
```

- [ ] **Step 2: Run and confirm pagination/dead-symbol failures**

Run: `node --test tests/sales_dashboard_ui_hardening.test.cjs`

Expected: `1–0 of 0` and legacy symbol assertions fail.

- [ ] **Step 3: Add one page formatter and remove unreachable blocks**

```javascript
function formatPageInfo(total, page, pageSize) {
  if (total <= 0) return '0–0 of 0';
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return `${start}–${end} of ${total}`;
}
```

Use it in standard, Drop, and Gain renderers. Delete the three legacy functions,
the unreachable tail of `setUnpurchasedBrand`, and the post-return wrong-PIN
block. Do not remove the live current implementations.

- [ ] **Step 4: Run UI and special-filter tests**

Run: `node --test tests/sales_dashboard_ui_hardening.test.cjs tests/sales_special_filter_policy.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add sales_dashboard.html tests/sales_dashboard_ui_hardening.test.cjs
git commit -m "refactor: remove dead dashboard filter code"
```

### Task 4: Add Real Browser Regression Coverage

**Files:**
- Create: `tests/sales_dashboard_ui.browser.test.cjs`

- [ ] **Step 1: Add the browser harness and failing scenarios**

```javascript
test('mobile XL has no overflow and dialogs restore focus', async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAsBen(page);
  await page.getByRole('button', { name: 'Large' }).click();
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth,
                                           client: document.documentElement.clientWidth }));
  assert.ok(size.scroll <= size.client);
  const opener = page.getByRole('button', { name: /flag/i }).first();
  await opener.click();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('no snapshot request occurs before authentication', async () => {
  assert.deepEqual(requests.filter(r => r.action === 'data'), []);
});
```

- [ ] **Step 2: Run browser tests and capture actual failures**

Run: `node --test tests/sales_dashboard_ui.browser.test.cjs`

Expected: any remaining mobile overflow, focus, keyboard, or pre-auth request defect fails with a named assertion.

- [ ] **Step 3: Make only the changes required by the browser failures**

Keep fixed board/tool dimensions stable, wrap the header controls at 375 px, and
correct focus order. Do not hide horizontal overflow globally.

- [ ] **Step 4: Run desktop and mobile browser tests**

Run: `node --test tests/sales_dashboard_ui.browser.test.cjs`

Expected: all browser scenarios pass at 1280x800 and 375x812.

- [ ] **Step 5: Commit**

```powershell
git add sales_dashboard.html tests/sales_dashboard_ui.browser.test.cjs
git commit -m "test: cover dashboard browser workflows"
```

### Task 5: Gate Daily Updates On The Complete Test Suite

**Files:**
- Modify: `update_dashboard.bat:153-205`
- Modify: `tests/test_update_dashboard_sources.py`

- [ ] **Step 1: Write failing complete-suite assertions**

```python
def test_daily_update_runs_all_node_tests(self):
    text = UPDATE_BAT.read_text(encoding="utf-8")
    self.assertIn('node --test tests\\*.test.cjs', text)
    self.assertNotIn('node tests\\sales_dashboard_version.test.cjs', text)
```

- [ ] **Step 2: Run and confirm smoke-only failure**

Run: `python -m unittest tests.test_update_dashboard_sources -v`

Expected: FAIL because the batch file runs only four selected Node tests.

- [ ] **Step 3: Run every CommonJS test before private publish**

```bat
node --test tests\*.test.cjs
if %errorlevel% neq 0 (
    echo ERROR: Dashboard test suite failed. Nothing was published or committed.
    pause & exit /b 1
)
```

Keep Python tests before publisher and Git staging. Browser tests stay in release
QA because they require Playwright runtime and a local server.

- [ ] **Step 4: Run batch-policy tests and full local suites**

Run: `python -m unittest tests.test_update_dashboard_sources -v`

Run: `node --test tests/*.test.cjs`

Expected: policy and all CommonJS tests pass.

- [ ] **Step 5: Commit**

```powershell
git add update_dashboard.bat tests/test_update_dashboard_sources.py
git commit -m "build: run complete dashboard tests before publish"
```

### Task 6: Remove Sensitive Snapshots From The Current Public Tree

**Files:**
- Modify: `.gitignore`
- Modify: `update_dashboard.bat:190-205`
- Modify: `DEPLOYMENT.md`
- Modify: `tests/test_update_dashboard_sources.py`
- Create: `tests/public_snapshot_urls.test.cjs`
- Untrack: `dashboard_data.json`
- Untrack: `debtor_analysis_data.json`
- Untrack: `data_*.json`

- [ ] **Step 1: Write failing tracked-file and live-URL tests**

```python
def test_sensitive_snapshots_are_not_staged_or_tracked(self):
    text = UPDATE_BAT.read_text(encoding="utf-8")
    self.assertNotRegex(text, r"git add .*dashboard_data\.json")
    self.assertNotRegex(text, r"git add .*data_\*\.json")
```

```javascript
for (const path of ['/dashboard_data.json', '/data_jul26.json', '/debtor_analysis_data.json']) {
  test(`${path} is not public`, async () => {
    const response = await fetch(baseUrl + path + '?v=' + Date.now());
    assert.ok([404, 410].includes(response.status));
  });
}
```

- [ ] **Step 2: Run local policy tests and confirm tracked-file failure**

Run: `python -m unittest tests.test_update_dashboard_sources -v`

Expected: FAIL while the batch still stages sensitive files.

- [ ] **Step 3: Add ignore rules and untrack without deleting local copies**

```gitignore
/dashboard_data.json
/debtor_analysis_data.json
/data_*.json
```

Run:

```powershell
git rm --cached -- dashboard_data.json debtor_analysis_data.json
git rm --cached -- data_*.json
```

Remove their `git add` lines from `update_dashboard.bat`. Document the exact
reader/API verification, private snapshot checksums, Pages deployment, 404
checks, and normal-revert rollback order.

- [ ] **Step 4: Verify local cutover before deployment**

Run: `git ls-files -- dashboard_data.json "data_*.json" debtor_analysis_data.json`

Expected: no output.

Run: `python -m unittest discover -s tests -p "test_*.py" -v`

Run: `node --test tests/*.test.cjs`

Run: `node --test tests/sales_dashboard_ui.browser.test.cjs`

Expected: all tests pass and protected readers work against the mock/branch API.

- [ ] **Step 5: Commit the cutover**

```powershell
git add .gitignore update_dashboard.bat DEPLOYMENT.md tests/test_update_dashboard_sources.py tests/public_snapshot_urls.test.cjs
git commit -m "security: stop publishing debtor snapshots"
```

### Task 7: Deploy, Verify, And Record The Cutover

**Files:**
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Apply additive migrations and deploy the Edge Function**

Run the Supabase migration tool for both 2026-07-14 migrations, then deploy
`dashboard-api`. Confirm anonymous snapshot/PIN reads are denied before changing
the public page.

- [ ] **Step 2: Publish and verify supported snapshots**

Run:

```powershell
python publish_dashboard_snapshots.py --input dashboard_data.json --analysis-input debtor_analysis_data.json --month "Jul 26"
```

Expected: shared and every active agent checksum read back successfully. Repeat
for each historical month that passes snapshot validation; incomplete March must
remain unavailable.

- [ ] **Step 3: Run branch smoke tests against live Supabase**

Verify wrong PIN, BEN login, manager login, inactive month denial, month switch,
claim stage 1/2 coexistence, remote claim/flag deletion, remark round trip, and
logout/session expiry.

- [ ] **Step 4: Deploy GitHub Pages and verify current public state**

Run:

```powershell
$env:DASHBOARD_BASE_URL="https://izfoo0121-lab.github.io/md-dashboard"
node --test tests/public_snapshot_urls.test.cjs
```

Expected: sensitive URLs return 404/410, `months_index.json` returns 200, and
Sales/Management/Admin authenticated workflows pass in Chrome desktop and mobile.

- [ ] **Step 5: Record deployment evidence**

Add migration IDs, Edge Function version, snapshot months/checksums, test counts,
Pages commit, smoke-test time, and rollback commit to `DEPLOYMENT.md`, then commit:

```powershell
git add DEPLOYMENT.md
git commit -m "docs: record secure dashboard cutover"
```
