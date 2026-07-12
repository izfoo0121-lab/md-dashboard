# Converter Debtor Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MD dashboard safely ingest the new `Debtor Type` sales-report column and consistently include `Converter` accounts in business performance, analysis, and SKU monitoring without counting 8COM as CCOM.

**Architecture:** Replace positional Excel parsing with a normalized header contract, then resolve debtor type through one shared policy and expose source-quality diagnostics in generated payloads. Keep Debtor Maintenance authoritative for account status while allowing the report's debtor type to preserve transaction metadata. Reuse the same configurable source paths in the dashboard processor, SKU report builder, and update script.

**Tech Stack:** Python 3, pandas, openpyxl, unittest, static HTML/JavaScript, Windows batch, GitHub Pages.

---

### Task 1: Header-Safe Sales Report Loader

**Files:**
- Modify: `process_data.py`
- Test: `tests/test_sales_report_loader.py`

- [ ] **Step 1: Write a failing regression test for the 27-column report**

Create a temporary workbook whose `Debtor Type` column sits between `PAID ON` and `UNIQ CODE`, call `load_sales_report(path)`, and assert `debtor_type`, `uniq_code`, `rm_ctn`, `sales_type`, and `qty_ctn` keep their intended values.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `python -m unittest tests.test_sales_report_loader -v`

Expected: failure because `load_sales_report` does not accept a path and still maps by numeric position.

- [ ] **Step 3: Implement normalized header mapping**

Add normalized aliases for the old 26-column and new 27-column schemas, read all workbook columns, validate required fields, create blank optional fields such as `debtor_type`, and retain the existing internal column names.

- [ ] **Step 4: Add legacy and malformed-schema tests**

Verify the old report still loads and that a missing required column raises a descriptive `ValueError` listing the missing headers.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `python -m unittest tests.test_sales_report_loader -v`

Expected: all loader tests pass.

### Task 2: Shared Debtor Type Policy And Quality Audit

**Files:**
- Modify: `process_data.py`
- Test: `tests/test_debtor_type_policy.py`
- Test: `tests/test_analysis_scope.py`

- [ ] **Step 1: Write failing policy tests**

Assert `Converter` normalizes as business/performance eligible, `P-Personal` remains excluded, blank/unknown types are marked `review_required`, and sales-row type is retained in debtor analysis when master metadata is missing.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `python -m unittest tests.test_debtor_type_policy tests.test_analysis_scope -v`

Expected: failures because no centralized policy or sales-type fallback exists.

- [ ] **Step 3: Implement the policy and audit metadata**

Add `normalize_debtor_type`, `classify_debtor_type`, and personal/business helpers. Resolve master-vs-sales type explicitly, record mismatch/orphan/review counts, and add source paths plus quality summary to `dashboard_data.json` and `debtor_analysis_data.json`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `python -m unittest tests.test_debtor_type_policy tests.test_analysis_scope -v`

Expected: all policy and analysis tests pass.

### Task 3: Converter In SKU Analysis Defaults

**Files:**
- Modify: `reports/miracle-2a-sku-strength/build_report_data.py`
- Modify: `reports/miracle-2a-sku-strength/penetration.html`
- Modify: `reports/miracle-2a-sku-strength/gap_opportunities.html`
- Test: `tests/test_analysis_scope.py`
- Create: `tests/sku_reports_converter.test.cjs`

- [ ] **Step 1: Write failing report tests**

Assert the report builder accepts configured workbook paths, carries `Converter` debtor metadata, penetration selects it by default, and gap analysis includes it in the business type set.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `python -m unittest tests.test_analysis_scope -v`

Run: `node --test tests/sku_reports_converter.test.cjs`

Expected: configured-path and default-business assertions fail.

- [ ] **Step 3: Implement report updates**

Honor `MD_SALES_FILE` and `MD_DEBTOR_FILE`, add `Converter` to default business views, and keep type options data-driven for future categories.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the two focused commands above and expect zero failures.

### Task 4: Safe Daily Source Selection

**Files:**
- Modify: `update_dashboard.bat`
- Test: `tests/test_update_dashboard_sources.py`

- [ ] **Step 1: Write failing batch-contract tests**

Assert the script honors `MD_SALES_FILE` and `MD_DEBTOR_FILE`, never copies a file onto itself, and reports which source paths are passed into both generators.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `python -m unittest tests.test_update_dashboard_sources -v`

Expected: environment-source assertions fail.

- [ ] **Step 3: Implement guarded source handling**

Use repository defaults when variables are absent, pass environment paths through to Python, and skip copy operations when source and destination resolve to the same path.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `python -m unittest tests.test_update_dashboard_sources -v`

Expected: all update-script tests pass.

### Task 5: Regenerate, Reconcile, And Document PFMD Handoff

**Files:**
- Modify generated dashboard/report JSON and JS assets only after source tests pass
- Create: `docs/pfmd-converter-sync-prompt.md`

- [ ] **Step 1: Run the full automated suite**

Run: `python -m unittest discover -s tests -p "test_*.py" -v`

Run: `node --test tests/*.test.cjs`

Expected: zero failures.

- [ ] **Step 2: Regenerate from explicit current sources**

Set `MD_SALES_FILE` and `MD_DEBTOR_FILE` to verified latest files, run `python process_data.py --month "Jul 26"`, then run `python reports/miracle-2a-sku-strength/build_report_data.py` without modifying the local dirty workbook.

- [ ] **Step 3: Reconcile Converter output**

Verify Converter appears in debtor analysis and SKU type options, CCOM excludes 8COM rows, and generated quality metadata reports type mismatches/orphans rather than silently dropping them.

- [ ] **Step 4: Write the PFMD implementation prompt**

Document the same schema contract, policy, all-group scope, affected pages, acceptance checks, and the PFMD-specific stale data file risks without editing the PFMD repository in this task.

- [ ] **Step 5: Review diff and commit only intended files**

Exclude `Debtor Maintenance.xlsx`, `config/`, and `stock_bot/`; run final tests again before any commit or push.
