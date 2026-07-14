# Dashboard Cloud State Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make claims, flags, KPI/birthday state, and campaign remarks consistent across devices with one staged schema and one authoritative sync implementation.

**Architecture:** Add a forward-only claims migration, expose state actions through the authenticated dashboard Edge service, and keep one shared browser adapter. Successful complete snapshots replace local state; partial or failed pulls leave prior state untouched.

**Tech Stack:** PostgreSQL, Supabase Edge Function service module, JavaScript ES modules, Node `node:test`, Python `unittest`.

---

### Task 1: Finalize The Claims Stage Schema

**Files:**
- Create: `migrations/2026-07-14_claims_stage_hardening.sql`
- Modify: `supabase/tests/dashboard_private_snapshots_test.sql`
- Modify: `tests/admin_bulk_mark_claim_schema.test.cjs`
- Modify: `tests/test_distribution_campaign.py`

- [ ] **Step 1: Change tests to require stage-aware behavior**

```javascript
assert.match(adminSource, /stage:\s*1/);
assert.match(adminSource, /on_conflict=month,agent,camp_id,debtor_code,stage/);
assert.match(adminSource, /stage=eq\.1/);
```

```python
self.assertIn("stage=eq.1", requested_url)
self.assertNotIn("schema does not have claims.stage", generated_warning)
```

- [ ] **Step 2: Run tests and confirm old-schema failures**

Run: `node --test tests/admin_bulk_mark_claim_schema.test.cjs`

Run: `python -m unittest tests.test_distribution_campaign -v`

Expected: both fail because current Admin and generator still use the four-column schema.

- [ ] **Step 3: Add the idempotent forward migration**

```sql
alter table public.claims add column if not exists stage smallint;
update public.claims set stage = 1 where stage is null;
alter table public.claims alter column stage type smallint using stage::smallint;
alter table public.claims alter column stage set default 1;
alter table public.claims alter column stage set not null;

do $$ begin
  alter table public.claims add constraint claims_stage_check check (stage in (1, 2));
exception when duplicate_object then null;
end $$;

alter table public.claims drop constraint if exists claims_month_agent_camp_id_debtor_code_key;
create unique index if not exists claims_stage_identity_uidx
  on public.claims(month, agent, camp_id, debtor_code, stage);
create index if not exists claims_month_agent_idx on public.claims(month, agent);
create index if not exists claims_month_campaign_idx on public.claims(month, camp_id);
```

Update Admin bulk rows/queries/conflict keys and `process_data.fetch_campaign_deliveries()` to use stage 1 explicitly.

- [ ] **Step 4: Run stage tests**

Run: `node --test tests/admin_bulk_mark_claim_schema.test.cjs tests/sales_stage_claims.test.cjs tests/campaign_audit_stage_claims.test.cjs`

Run: `python -m unittest tests.test_distribution_campaign -v`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add migrations/2026-07-14_claims_stage_hardening.sql admin.html process_data.py supabase/tests/dashboard_private_snapshots_test.sql tests/admin_bulk_mark_claim_schema.test.cjs tests/test_distribution_campaign.py
git commit -m "fix: standardize staged campaign claims"
```

### Task 2: Implement Complete Authoritative Reconciliation

**Files:**
- Create: `dashboard_state.js`
- Create: `tests/gistsync_authoritative_sync.test.cjs`
- Modify: `supabase/functions/dashboard-api/service.mjs`
- Modify: `supabase/functions/dashboard-api/index.ts`

- [ ] **Step 1: Write failing reconciliation tests**

```javascript
test('complete remote snapshot removes absent local claim and flag keys', () => {
  const next = reconcileDashboardState(localState(), {
    complete: true,
    claims: [remoteStageOneClaim],
    flags: [],
    kpiScores: {},
    birthdayOverrides: {}
  });
  assert.deepEqual(Object.keys(next.claims), [stageKey(remoteStageOneClaim)]);
  assert.deepEqual(next.flags, {});
});

test('partial snapshot never deletes or replaces local state', () => {
  assert.deepEqual(reconcileDashboardState(localState(), { complete: false }), localState());
});
```

- [ ] **Step 2: Run and confirm missing-module failure**

Run: `node --test tests/gistsync_authoritative_sync.test.cjs`

Expected: FAIL because `dashboard_state.js` does not exist.

- [ ] **Step 3: Implement pure atomic reconciliation**

```javascript
export function reconcileDashboardState(previous, remote) {
  if (!remote || remote.complete !== true) return structuredClone(previous);
  return {
    claims: Object.fromEntries((remote.claims || []).map(row => [claimKey(row), normalizeClaim(row)])),
    flags: Object.fromEntries((remote.flags || []).map(row => [flagKey(row), normalizeFlag(row)])),
    kpiScores: structuredClone(remote.kpiScores || {}),
    birthdayOverrides: structuredClone(remote.birthdayOverrides || {}),
    syncedAt: remote.syncedAt || null,
  };
}
```

Add Edge `sync` action that fetches all pages for the session's agent/month. Any
HTTP, decode, timeout, or pagination-limit failure returns an error and never
sets `complete:true`.

- [ ] **Step 4: Run reconciliation and service tests**

Run: `node --test tests/gistsync_authoritative_sync.test.cjs tests/dashboard_api_service.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add dashboard_state.js tests/gistsync_authoritative_sync.test.cjs supabase/functions/dashboard-api/service.mjs supabase/functions/dashboard-api/index.ts
git commit -m "fix: reconcile dashboard cloud state authoritatively"
```

### Task 3: Add Session-Scoped Save And Delete Actions

**Files:**
- Modify: `supabase/functions/dashboard-api/service.mjs`
- Modify: `tests/dashboard_api_service.test.mjs`
- Modify: `tests/sales_future_claim_sync.test.cjs`

- [ ] **Step 1: Add failing write-authorization tests**

```javascript
test('claim save derives agent and uses five-column conflict identity', async () => {
  const result = await handleClaimSave({
    sessionToken: 'ben-token',
    payload: { agent: 'CJ', month: 'Jul 26', campId: 'c1', debtorCode: 'd1', stage: 2 }
  }, deps());
  assert.equal(result.row.agent, 'BEN');
  assert.equal(lastUpsert().onConflict, 'month,agent,camp_id,debtor_code,stage');
});

test('claim delete includes stage and cannot delete another agent', async () => {
  await handleClaimDelete({ sessionToken: 'ben-token', payload: claimPayload(2) }, deps());
  assert.deepEqual(lastDelete().where, {
    month: 'Jul 26', agent: 'BEN', camp_id: 'c1', debtor_code: 'd1', stage: 2
  });
});

test('KPI and birthday writes derive scope from the session', async () => {
  await handleKpiSave({ sessionToken: 'ben-token', payload: { agent: 'CJ', month: 'Jul 26', scores: {} } }, deps());
  assert.equal(lastUpsert().row.agent, 'BEN');
  await handleBirthdaySave({ sessionToken: 'manager-token', payload: { month: 'Jul 26', debtorCode: 'D1', included: true } }, deps());
  assert.equal(lastUpsert().row.debtor_code, 'D1');
});
```

- [ ] **Step 2: Run and confirm missing action failures**

Run: `node --test tests/dashboard_api_service.test.mjs tests/sales_future_claim_sync.test.cjs`

Expected: FAIL because state actions are not implemented through the Edge service.

- [ ] **Step 3: Implement confirmed writes with rollback-safe responses**

```javascript
export async function handleClaimSave(input, deps) {
  const session = await requireSession(input.sessionToken, deps);
  const row = normalizeClaimWrite(input.payload, session.agent);
  await checkAgentMonthAccess(session.agent, row.month, deps);
  const saved = await deps.claims.upsert(row, 'month,agent,camp_id,debtor_code,stage');
  return { row: saved };
}
```

Implement equivalent `claim.delete`, `flag.save`, `flag.delete`,
`campaign.remark`, `kpi.save`, and manager-only `birthday.save`. Add
manager-only `manager.pins.list` and `manager.pins.save`, then revoke anonymous
reads/writes on `agent_pins`. Reject unknown actions and invalid stage values.
Browser local state changes only after a successful API response; failed
optimistic UI updates restore their previous value.

- [ ] **Step 4: Run write tests**

Run: `node --test tests/dashboard_api_service.test.mjs tests/sales_future_claim_sync.test.cjs tests/sales_stage_claims.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add supabase/functions/dashboard-api/service.mjs tests/dashboard_api_service.test.mjs tests/sales_future_claim_sync.test.cjs
git commit -m "fix: scope dashboard state writes to authenticated sessions"
```

### Task 4: Replace Duplicate Browser Sync Implementations

**Files:**
- Modify: `gistsync_supabase.js:1-478`
- Modify: `sales_dashboard.html:8443-9760`
- Modify: `management.html:2542-4405`
- Modify: `admin.html:10433-11120`
- Modify: `campaign_audit.html:402-1960`
- Modify: `accounts.html:321-720`
- Create: `migrations/2026-07-14_dashboard_state_gateway_lockdown.sql`
- Modify: `tests/sales_stage_claims.test.cjs`
- Modify: `tests/campaign_audit_stage_claims.test.cjs`
- Modify: `tests/management_birthday_claims_legacy.test.cjs`

- [ ] **Step 1: Write failing single-adapter assertions**

```javascript
for (const html of pages) {
  assert.match(html, /<script src="gistsync_supabase\.js"><\/script>/);
  assert.doesNotMatch(html, /const GistSync\s*=\s*\(\(\)\s*=>/);
}
assert.doesNotMatch(management, /schema does not have claims\.stage/);
assert.match(lockdownSql, /revoke all on public\.claims from anon, authenticated/);
assert.match(lockdownSql, /revoke all on public\.flags from anon, authenticated/);
```

- [ ] **Step 2: Run and confirm duplicate-IIFE failures**

Run: `node --test tests/sales_stage_claims.test.cjs tests/campaign_audit_stage_claims.test.cjs tests/management_birthday_claims_legacy.test.cjs`

Expected: FAIL because pages still embed divergent adapters and Management still has the legacy fallback.

- [ ] **Step 3: Make `gistsync_supabase.js` the compatibility adapter**

```javascript
async function syncToLocal({ agent, month }) {
  const remote = await DashboardApi.sync(month);
  const previous = readScopedState(agent, month);
  const next = DashboardState.reconcileDashboardState(previous, remote);
  writeScopedState(agent, month, next);
  return next;
}
```

Expose `saveClaim`, `removeClaim`, `saveFlag`, `removeFlag`,
`saveCampaignRemark`, `saveKPIScores`, and `saveBirthdayOverride` as
`DashboardApi` calls. Preserve `reason` and `stage`; use one local storage key
scoped by agent and month. Remove the five embedded GistSync IIFEs and the
stage-less Management fallback.

After every reader uses the authenticated adapter, add the forward-only
lockdown migration:

```sql
alter table public.claims enable row level security;
alter table public.flags enable row level security;
alter table public.kpi_scores enable row level security;
revoke all on public.claims from anon, authenticated;
revoke all on public.flags from anon, authenticated;
revoke all on public.kpi_scores from anon, authenticated;
```

- [ ] **Step 4: Run all page state tests**

Run: `node --test tests/admin*.test.cjs tests/management*.test.cjs tests/campaign_audit*.test.cjs tests/sales*.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add gistsync_supabase.js sales_dashboard.html management.html admin.html campaign_audit.html accounts.html migrations/2026-07-14_dashboard_state_gateway_lockdown.sql tests/sales_stage_claims.test.cjs tests/campaign_audit_stage_claims.test.cjs tests/management_birthday_claims_legacy.test.cjs
git commit -m "refactor: unify dashboard cloud state adapter"
```

### Task 5: Fix Campaign Remarks And Startup Synchronization

**Files:**
- Modify: `sales_dashboard.html:7935-8085`
- Modify: `sales_dashboard.html:2849-3178`
- Modify: `management.html:1985-2020`
- Create: `tests/sales_campaign_remark_sync.test.cjs`
- Create: `tests/sales_startup_sync_once.test.cjs`

- [ ] **Step 1: Write failing behavior tests**

```javascript
test('campaign remark round-trips through the shared adapter', async () => {
  await saveCampRemark('c1', 'd1', 'audit remark');
  assert.equal(await reloadRemark('c1', 'd1'), 'audit remark');
});

test('initial authenticated load starts one sync', async () => {
  await loadAuthenticatedFixture();
  assert.equal(syncCalls, 1);
});
```

- [ ] **Step 2: Run and confirm duplicate/empty remark failures**

Run: `node --test tests/sales_campaign_remark_sync.test.cjs tests/sales_startup_sync_once.test.cjs`

Expected: FAIL because the later duplicate drops the remark and startup sync runs twice.

- [ ] **Step 3: Keep one remark function and one startup owner**

```javascript
async function saveCampRemark(campId, debtorCode, remark) {
  const saved = await GistSync.saveCampaignRemark({
    month: DATA.current_month, campId, debtorCode, remark: String(remark || '').trim()
  });
  setCampStatus(campId, debtorCode, { remark: saved.remark });
  renderDebtors();
}
```

Delete the duplicate `saveCampRemark`. Let authenticated `loadData()` own the
startup sync; remove the second call from `init()`. Management likewise calls
`pullGistData()` once after protected data load.

- [ ] **Step 4: Run sync and remark tests**

Run: `node --test tests/sales_campaign_remark_sync.test.cjs tests/sales_startup_sync_once.test.cjs tests/sales*.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add sales_dashboard.html management.html tests/sales_campaign_remark_sync.test.cjs tests/sales_startup_sync_once.test.cjs
git commit -m "fix: persist remarks and synchronize once"
```
