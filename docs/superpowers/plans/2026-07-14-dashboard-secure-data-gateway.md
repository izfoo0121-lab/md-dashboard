# Dashboard Secure Data Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace public debtor snapshots and browser-side PIN lookup with a Supabase Edge Function that returns only session-authorized agent/month data.

**Architecture:** Keep canonical JSON local, split it into private shared and per-agent Supabase snapshots, and expose it through one session-based `dashboard-api`. A shared browser client replaces direct JSON/PIN-table fetches while preserving the existing page data shape.

**Tech Stack:** Python 3.11, Supabase PostgreSQL/RLS, Supabase Edge Functions, JavaScript ES modules, Node `node:test`, Python `unittest`.

---

### Task 1: Add Private Snapshot And Session Schema

**Files:**
- Create: `migrations/2026-07-14_dashboard_private_snapshots.sql`
- Create: `supabase/tests/dashboard_private_snapshots_test.sql`

- [ ] **Step 1: Write the failing schema assertions**

```sql
begin;
select plan(15);
select has_table('public', 'dashboard_snapshots');
select has_table('public', 'dashboard_agent_snapshots');
select has_table('public', 'dashboard_manager_artifacts');
select has_table('public', 'dashboard_sessions');
select has_table('public', 'dashboard_login_attempts');
select col_is_pk('public', 'dashboard_snapshots', 'month');
select col_is_pk('public', 'dashboard_manager_artifacts', 'artifact_key');
select col_is_pk('public', 'dashboard_sessions', 'token_hash');
select has_pk('public', 'dashboard_agent_snapshots');
select row_security_active('public', 'dashboard_snapshots');
select row_security_active('public', 'dashboard_agent_snapshots');
select row_security_active('public', 'dashboard_manager_artifacts');
select row_security_active('public', 'dashboard_sessions');
select row_security_active('public', 'dashboard_login_attempts');
select has_column('public', 'dashboard_snapshots', 'manager_support_payload');
select * from finish();
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails before the migration**

Run: `supabase test db supabase/tests/dashboard_private_snapshots_test.sql`

Expected: FAIL because the five tables do not exist. If Supabase CLI is unavailable, run the SQL in a disposable Supabase branch and save the failing output in the task notes.

- [ ] **Step 3: Add the forward-only migration**

```sql
create table if not exists public.dashboard_snapshots (
  month text primary key,
  generated_at timestamptz not null,
  shared_payload jsonb not null,
  manager_support_payload jsonb not null,
  data_quality jsonb not null default '{}'::jsonb,
  checksum text not null,
  source_version text not null
);

create table if not exists public.dashboard_agent_snapshots (
  month text not null references public.dashboard_snapshots(month) on delete cascade,
  agent text not null,
  agent_payload jsonb not null,
  checksum text not null,
  generated_at timestamptz not null,
  primary key (month, agent)
);

create table if not exists public.dashboard_manager_artifacts (
  artifact_key text primary key,
  generated_at timestamptz not null,
  payload jsonb not null,
  checksum text not null
);

create table if not exists public.dashboard_sessions (
  token_hash text primary key,
  agent text not null,
  role text not null check (role in ('agent', 'manager')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now()
);

create table if not exists public.dashboard_login_attempts (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  failures integer not null check (failures >= 0)
);

create index if not exists dashboard_agent_snapshots_agent_month_idx
  on public.dashboard_agent_snapshots(agent, month);
create index if not exists dashboard_sessions_expires_idx
  on public.dashboard_sessions(expires_at);

alter table public.dashboard_snapshots enable row level security;
alter table public.dashboard_agent_snapshots enable row level security;
alter table public.dashboard_manager_artifacts enable row level security;
alter table public.dashboard_sessions enable row level security;
alter table public.dashboard_login_attempts enable row level security;

revoke all on public.dashboard_snapshots from anon, authenticated;
revoke all on public.dashboard_agent_snapshots from anon, authenticated;
revoke all on public.dashboard_manager_artifacts from anon, authenticated;
revoke all on public.dashboard_sessions from anon, authenticated;
revoke all on public.dashboard_login_attempts from anon, authenticated;
```

- [ ] **Step 4: Run schema tests**

Run: `supabase test db supabase/tests/dashboard_private_snapshots_test.sql`

Expected: 15 assertions pass.

- [ ] **Step 5: Commit**

```powershell
git add migrations/2026-07-14_dashboard_private_snapshots.sql supabase/tests/dashboard_private_snapshots_test.sql
git commit -m "feat: add private dashboard snapshot schema"
```

### Task 2: Create The Snapshot Contract

**Files:**
- Create: `dashboard_snapshot_contract.py`
- Create: `tests/test_publish_dashboard_snapshots.py`

- [ ] **Step 1: Write failing contract tests**

```python
class SnapshotContractTests(unittest.TestCase):
    def test_split_contains_one_agent_and_no_peer_debtors(self):
        bundle = split_snapshot(sample_snapshot())
        ben = bundle["agents"]["BEN"]["agent_payload"]
        self.assertEqual(["BEN"], list(ben["agents"]))
        self.assertNotIn("CJ", json.dumps(ben))

    def test_shared_payload_has_no_agents_block(self):
        bundle = split_snapshot(sample_snapshot())
        self.assertNotIn("agents", bundle["shared"]["shared_payload"])

    def test_invalid_month_or_empty_snapshot_is_rejected(self):
        bad = sample_snapshot()
        for block in bad["agents"].values():
            block["debtor_cards"]["debtors"] = []
        with self.assertRaises(SnapshotValidationError):
            validate_snapshot(bad, expected_month="Jul 26")

    def test_shared_payload_uses_safe_allowlist(self):
        shared = split_snapshot(sample_snapshot())["shared"]["shared_payload"]
        self.assertNotIn("birthday_by_month", shared)
        self.assertNotIn("brand_penetration_candidates", shared)

    def test_manager_support_does_not_duplicate_agents(self):
        support = split_snapshot(sample_snapshot())["shared"]["manager_support_payload"]
        self.assertNotIn("agents", support)

    def test_manager_artifact_is_checksummed_separately(self):
        row = build_manager_artifact("debtor_analysis", {"months": ["Jul 26"]}, "2026-07-14")
        self.assertEqual("debtor_analysis", row["artifact_key"])
        self.assertEqual(64, len(row["checksum"]))

    def test_checksum_is_stable_across_key_order(self):
        self.assertEqual(checksum_payload({"a": 1, "b": 2}),
                         checksum_payload({"b": 2, "a": 1}))
```

- [ ] **Step 2: Run the tests and confirm missing-module failure**

Run: `python -m unittest tests.test_publish_dashboard_snapshots -v`

Expected: FAIL with `ModuleNotFoundError: dashboard_snapshot_contract`.

- [ ] **Step 3: Implement validation, canonical bytes, checksums, and split**

```python
class SnapshotValidationError(ValueError):
    pass

def canonical_json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":")).encode("utf-8")

def checksum_payload(value):
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()

SAFE_SHARED_KEYS = {
    "generated_at", "current_month", "data_quality", "working_days",
    "group_brand_targets", "team", "config", "campaign_group_progress",
}

def validate_snapshot(snapshot, expected_month=None, min_total_debtors=1):
    month = str(snapshot.get("current_month") or "").strip()
    if not month or (expected_month and month != expected_month):
        raise SnapshotValidationError("snapshot month mismatch")
    agents = snapshot.get("agents")
    if not isinstance(agents, dict) or not agents:
        raise SnapshotValidationError("snapshot has no agents")
    total_debtors = 0
    for agent, block in agents.items():
        debtors = block.get("debtor_cards", {}).get("debtors")
        if not isinstance(debtors, list):
            raise SnapshotValidationError(f"{agent} debtor records are malformed")
        total_debtors += len(debtors)
    if total_debtors < min_total_debtors:
        raise SnapshotValidationError("snapshot has too few debtor records")
    canonical_json_bytes(snapshot)
    return snapshot

def split_snapshot(snapshot):
    validate_snapshot(snapshot)
    shared_payload = {key: snapshot[key] for key in SAFE_SHARED_KEYS if key in snapshot}
    manager_support_payload = {key: value for key, value in snapshot.items() if key != "agents"}
    return {
        "shared": {
            "month": snapshot["current_month"],
            "generated_at": snapshot["generated_at"],
            "shared_payload": shared_payload,
            "manager_support_payload": manager_support_payload,
            "data_quality": snapshot.get("data_quality") or {},
            "checksum": checksum_payload(shared_payload),
        },
        "agents": {
            agent: {
                "month": snapshot["current_month"],
                "agent": agent,
                "agent_payload": {"agents": {agent: block}},
                "checksum": checksum_payload({"agents": {agent: block}}),
                "generated_at": snapshot["generated_at"],
            }
            for agent, block in snapshot["agents"].items()
        },
    }

def build_manager_artifact(artifact_key, payload, generated_at):
    return {
        "artifact_key": artifact_key,
        "generated_at": generated_at,
        "payload": payload,
        "checksum": checksum_payload(payload),
    }
```

- [ ] **Step 4: Run contract tests**

Run: `python -m unittest tests.test_publish_dashboard_snapshots -v`

Expected: all contract tests pass.

- [ ] **Step 5: Commit**

```powershell
git add dashboard_snapshot_contract.py tests/test_publish_dashboard_snapshots.py
git commit -m "feat: define private dashboard snapshot contract"
```

### Task 3: Add A Verified Snapshot Publisher

**Files:**
- Create: `publish_dashboard_snapshots.py`
- Modify: `tests/test_publish_dashboard_snapshots.py`

- [ ] **Step 1: Add failing publisher tests**

```python
def test_publish_uses_service_key_and_reads_rows_back(self):
    transport = FakeTransport()
    result = publish_bundle(sample_bundle(), [sample_analysis_artifact()], transport,
                            source_version="abc123")
    self.assertEqual({"Jul 26", "BEN", "CJ", "debtor_analysis"},
                     set(result["verified_keys"]))
    self.assertTrue(all("service-role" in call["authorization"] for call in transport.calls))

def test_publish_fails_when_readback_checksum_differs(self):
    transport = FakeTransport(readback_checksum="wrong")
    with self.assertRaises(PublishVerificationError):
        publish_bundle(sample_bundle(), [sample_analysis_artifact()], transport,
                       source_version="abc123")
```

- [ ] **Step 2: Run tests and confirm missing publisher failure**

Run: `python -m unittest tests.test_publish_dashboard_snapshots -v`

Expected: FAIL because `publish_bundle` is not defined.

- [ ] **Step 3: Implement explicit transport and verification**

```python
def publish_bundle(bundle, manager_artifacts, transport, source_version):
    shared = dict(bundle["shared"], source_version=source_version)
    transport.upsert("dashboard_snapshots", shared,
                     on_conflict="month")
    rows = list(bundle["agents"].values())
    transport.upsert("dashboard_agent_snapshots", rows,
                     on_conflict="month,agent")
    transport.upsert("dashboard_manager_artifacts", manager_artifacts,
                     on_conflict="artifact_key")
    shared_back = transport.select_one("dashboard_snapshots", month=shared["month"])
    if shared_back.get("checksum") != shared["checksum"]:
        raise PublishVerificationError("shared snapshot checksum mismatch")
    verified = {shared["month"]}
    for row in rows:
        back = transport.select_one("dashboard_agent_snapshots",
                                    month=row["month"], agent=row["agent"])
        if back.get("checksum") != row["checksum"]:
            raise PublishVerificationError(f"{row['agent']} checksum mismatch")
        verified.add(row["agent"])
    for row in manager_artifacts:
        back = transport.select_one("dashboard_manager_artifacts",
                                    artifact_key=row["artifact_key"])
        if back.get("checksum") != row["checksum"]:
            raise PublishVerificationError(f"{row['artifact_key']} checksum mismatch")
        verified.add(row["artifact_key"])
    return {"verified_keys": sorted(verified)}
```

The CLI `main()` must require `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`, accept
`--input`, `--analysis-input`, `--month`, and `--dry-run`, build the
`debtor_analysis` manager artifact, and print no credential values.

- [ ] **Step 4: Run tests and a local dry run**

Run: `python -m unittest tests.test_publish_dashboard_snapshots -v`

Expected: all tests pass.

Run: `python publish_dashboard_snapshots.py --input dashboard_data.json --analysis-input debtor_analysis_data.json --month "Jul 26" --dry-run`

Expected: validation summary lists Jul 26, all agents, and checksums without network calls.

- [ ] **Step 5: Commit**

```powershell
git add publish_dashboard_snapshots.py tests/test_publish_dashboard_snapshots.py
git commit -m "feat: publish verified private dashboard snapshots"
```

### Task 4: Implement The Edge Service Core

**Files:**
- Create: `supabase/functions/dashboard-api/service.mjs`
- Create: `supabase/functions/dashboard-api/index.ts`
- Create: `supabase/config.toml`
- Create: `tests/dashboard_api_service.test.mjs`

- [ ] **Step 1: Write failing service tests**

```javascript
test('login returns only the matched agent snapshot', async () => {
  const result = await handleLogin({ pin: '1001', month: 'Jul 26' }, deps());
  assert.equal(result.agent, 'BEN');
  assert.deepEqual(Object.keys(result.data.agents), ['BEN']);
  assert.equal(JSON.stringify(result.data).includes('CJ debtor'), false);
});

test('data rejects expired, inactive, and spoofed sessions', async () => {
  await assert.rejects(() => handleData({ sessionToken: 'expired', month: 'Jul 26' }, deps()), /expired/);
  await assert.rejects(() => handleData({ sessionToken: 'active-off', month: 'Jun 26' }, deps()), /access denied/);
  await assert.rejects(() => handleData({ sessionToken: 'ben-token', month: 'Jul 26', agent: 'CJ' }, deps()), /agent mismatch/);
});

test('five failed PIN attempts block the network bucket for 15 minutes', async () => {
  for (let i = 0; i < 5; i += 1)
    await assert.rejects(() => handleLogin({ pin: '0000', month: 'Jul 26', bucket: 'hashed' }, deps()));
  await assert.rejects(() => handleLogin({ pin: '1001', month: 'Jul 26', bucket: 'hashed' }, deps()), /rate limit/);
});

test('manager dashboard is assembled without a duplicate full snapshot', async () => {
  const result = await handleData({ sessionToken: 'manager-token', month: 'Jul 26' }, deps());
  assert.deepEqual(Object.keys(result.data.agents).sort(), ['BEN', 'CJ']);
  assert.equal(result.data.current_month, 'Jul 26');
});

test('manager-only datasets and PIN actions reject agent sessions', async () => {
  await assert.rejects(
    () => handleData({ sessionToken: 'ben-token', month: 'Jul 26', dataset: 'debtor_analysis' }, deps()),
    /manager required/
  );
  await assert.rejects(() => handleManagerPinsList({ sessionToken: 'ben-token' }, deps()), /manager required/);
});
```

- [ ] **Step 2: Run tests and confirm missing-module failure**

Run: `node --test tests/dashboard_api_service.test.mjs`

Expected: FAIL because `service.mjs` does not exist.

- [ ] **Step 3: Implement session hashing, access checks, and assembly**

```javascript
export async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function requireSession(token, deps) {
  if (!token) throw new ApiError(401, 'session required');
  const session = await deps.sessions.find(await sha256(token));
  if (!session || Date.parse(session.expires_at) <= deps.now())
    throw new ApiError(401, 'session expired');
  return session;
}

export async function checkAgentMonthAccess(agent, month, deps) {
  const monthly = await deps.access.monthly(agent, month);
  const global = await deps.access.agent(agent);
  if (monthly?.active === false || global?.active === false) throw new ApiError(403, 'access denied');
  if (!monthly && !global) throw new ApiError(403, 'access unavailable');
}

export function assembleAgentData(shared, agentRow) {
  return { ...shared.shared_payload, ...agentRow.agent_payload };
}
```

`handleLogin()` must enforce five failures per salted network bucket per 15
minutes, look up PIN server-side, create a 12-hour opaque session, check access,
and return initial data. `handleData()` must derive agent/role from the session.
Agent responses merge safe shared plus one filtered agent payload. Manager
dashboard responses merge `manager_support_payload` with every agent row;
`dataset:'debtor_analysis'` reads `dashboard_manager_artifacts`. Implement
manager-only PIN list/save actions and, after Admin migration, revoke anonymous
access to `agent_pins`. `index.ts` must expose only POST/OPTIONS,
normalize errors, and use the service-role client from Edge secrets. Configure
`dashboard-api` explicitly in `supabase/config.toml`.

- [ ] **Step 4: Run service tests**

Run: `node --test tests/dashboard_api_service.test.mjs`

Expected: all service tests pass.

- [ ] **Step 5: Commit**

```powershell
git add supabase/config.toml supabase/functions/dashboard-api/service.mjs supabase/functions/dashboard-api/index.ts tests/dashboard_api_service.test.mjs
git commit -m "feat: add session-scoped dashboard edge service"
```

### Task 5: Create The Shared Browser API Client

**Files:**
- Create: `dashboard_api.js`
- Create: `tests/dashboard_api_client.test.cjs`

- [ ] **Step 1: Write failing timeout and session tests**

```javascript
test('request aborts and does not retain a failed session', async () => {
  const api = createDashboardApi({ fetch: neverResolvingFetch, timeoutMs: 20, sessionStorage });
  await assert.rejects(() => api.login('1001', 'Jul 26'), /timed out/);
  assert.equal(sessionStorage.getItem('md_dashboard_session'), null);
});

test('loadMonth sends only the opaque session token', async () => {
  const api = createDashboardApi({ fetch: recordingFetch, sessionStorage });
  sessionStorage.setItem('md_dashboard_session', 'opaque');
  await api.loadData('Jun 26');
  assert.deepEqual(lastBody(), { action: 'data', sessionToken: 'opaque', month: 'Jun 26' });
});

test('manager dataset and PIN methods remain session scoped', async () => {
  const api = createDashboardApi({ fetch: recordingFetch, sessionStorage });
  sessionStorage.setItem('md_dashboard_session', 'opaque');
  await api.loadData('Jul 26', 'debtor_analysis');
  assert.equal(lastBody().dataset, 'debtor_analysis');
  await api.listAgentPins();
  assert.equal(lastBody().action, 'manager.pins.list');
});
```

- [ ] **Step 2: Run and confirm missing-module failure**

Run: `node --test tests/dashboard_api_client.test.cjs`

Expected: FAIL because `dashboard_api.js` does not exist.

- [ ] **Step 3: Implement the client**

```javascript
async function request(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new DashboardApiError(response.status, payload.error || 'request failed');
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new DashboardApiError(408, 'request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
```

Expose `login`, `restoreSession`, `loadData`, `sync`, `listAgentPins`,
`saveAgentPin`, and `logout`. Store only
the opaque session token and agent/role metadata in `sessionStorage`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/dashboard_api_client.test.cjs`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add dashboard_api.js tests/dashboard_api_client.test.cjs
git commit -m "feat: add protected dashboard API client"
```

### Task 6: Migrate Snapshot Consumers Before Cutover

**Files:**
- Modify: `sales_dashboard.html:904-2890`
- Modify: `management.html:841-2014`
- Modify: `admin.html:1405-4305`
- Modify: `accounts.html:321-360`
- Modify: `campaign_audit.html:189-910`
- Modify: `debtor_analysis.html:225-320`
- Modify: `stock.html:502-560`
- Create: `migrations/2026-07-14_agent_pin_gateway_lockdown.sql`
- Create: `tests/dashboard_snapshot_consumers.test.cjs`
- Create: `tests/sales_dashboard_gateway.test.cjs`

- [ ] **Step 1: Write failing static and runtime tests**

```javascript
for (const file of protectedReaders) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /fetch\s*\(\s*[`'"](?:dashboard_data|data_\$\{|debtor_analysis_data)\.json/);
}
assert.doesNotMatch(adminSource, /rest\/v1\/agent_pins/);

test('sales page performs no debtor request before PIN login', async () => {
  const page = await loadSalesWithMockApi();
  assert.deepEqual(page.requests.filter(r => r.kind === 'snapshot'), []);
});
```

- [ ] **Step 2: Run tests and confirm direct-fetch failures**

Run: `node --test tests/dashboard_snapshot_consumers.test.cjs tests/sales_dashboard_gateway.test.cjs`

Expected: FAIL and list every current direct snapshot reader.

- [ ] **Step 3: Migrate readers in dependency order**

Add `<script src="dashboard_api.js"></script>` to each reader. Sales
`checkPin()` calls `DashboardApi.login(_pin, selectedMonth)` and commits `DATA`
only after success. `switchMonth()` calls `DashboardApi.loadData(month)` and
keeps `authenticatedAgent` separate from `currentAgent`. Remove `DEFAULT_PINS`,
direct `agent_pins` reads, and production JSON fallbacks.

Management, Admin, Campaign Audit, Accounts, and Stock must call the manager
login/data contract before their existing render functions. Debtor Analysis
requests `dataset:'debtor_analysis'`. Admin Agent Pins uses manager PIN methods
instead of direct `agent_pins` REST reads. Keep their existing `DATA`/`DASH_DATA`
shapes so this task changes transport, not presentation.

After the Admin PIN editor passes through the manager API, add this migration so
the publishable key can no longer enumerate or change PIN rows:

```sql
alter table public.agent_pins enable row level security;
revoke all on public.agent_pins from anon, authenticated;
```

- [ ] **Step 4: Run gateway and existing page tests**

Run: `node --test tests/dashboard_snapshot_consumers.test.cjs tests/sales_dashboard_gateway.test.cjs tests/sales*.test.cjs tests/management*.test.cjs tests/admin*.test.cjs tests/campaign_audit*.test.cjs`

Expected: all tests pass and no reader contains a direct sensitive JSON fetch.

- [ ] **Step 5: Commit**

```powershell
git add dashboard_api.js sales_dashboard.html management.html admin.html accounts.html campaign_audit.html debtor_analysis.html stock.html migrations/2026-07-14_agent_pin_gateway_lockdown.sql tests/dashboard_snapshot_consumers.test.cjs tests/sales_dashboard_gateway.test.cjs
git commit -m "feat: load dashboard snapshots through protected gateway"
```

### Task 7: Add Upload And Reader Smoke Gates Without Removing Files Yet

**Files:**
- Modify: `update_dashboard.bat:153-205`
- Modify: `tests/test_update_dashboard_sources.py`
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Write failing pipeline-order tests**

```python
def test_private_publish_happens_before_git_staging(self):
    text = UPDATE_BAT.read_text(encoding="utf-8")
    self.assertLess(text.index("publish_dashboard_snapshots.py"), text.index("git add"))
    self.assertIn("if %errorlevel% neq 0", text[text.index("publish_dashboard_snapshots.py"):])
```

- [ ] **Step 2: Run and confirm failure**

Run: `python -m unittest tests.test_update_dashboard_sources -v`

Expected: FAIL because the publisher is not called.

- [ ] **Step 3: Add the verified publish gate**

```bat
echo [5b/6] Publishing private dashboard snapshots...
if not defined SUPABASE_SERVICE_KEY (
    echo ERROR: SUPABASE_SERVICE_KEY is required for private snapshot publishing.
    pause & exit /b 1
)
%PYTHON% publish_dashboard_snapshots.py --input dashboard_data.json --analysis-input debtor_analysis_data.json
if %errorlevel% neq 0 (
    echo ERROR: Private snapshot publish or verification failed. Nothing was committed.
    pause & exit /b 1
)
```

Document dry run, live upload, API login/data smoke checks, and rollback. Keep
public files tracked until the UI/deployment plan completes production reader QA.

- [ ] **Step 4: Run pipeline tests**

Run: `python -m unittest tests.test_update_dashboard_sources -v`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add update_dashboard.bat tests/test_update_dashboard_sources.py DEPLOYMENT.md
git commit -m "build: gate updates on verified private snapshot publish"
```
