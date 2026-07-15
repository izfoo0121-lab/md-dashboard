# Sales Dashboard Hardening Design

Date: 2026-07-14

## Objective

Fix the confirmed Sales Dashboard security, synchronization, month-planning,
business-calculation, export, and usability defects without changing the public
GitHub Pages URL or the existing four-digit PIN workflow.

The completed system must no longer publish the Sales Dashboard debtor payload
as readable JSON. Agents must receive only the data authorized for their PIN,
agent code, and selected month. Management readers that currently depend on the
same payload must use an authorized manager data path before the public files are
removed.

## Confirmed Scope

### Security and authorization

- Stop loading debtor data before authentication.
- Stop direct browser reads of the complete `agent_pins` table.
- Recheck agent access on every month request and fail closed when access cannot
  be confirmed.
- Keep the authenticated agent identity separate from the currently displayed
  month data so a missing historical agent cannot fall through to global search.
- Add request timeouts and guaranteed PIN-input recovery.
- Remove current Sales Dashboard snapshots from the published GitHub tree after
  every dependent reader has moved to the protected API.

### Cloud state

- Make `claims.stage` a real, consistent schema field used by Admin,
  Management, Campaign Audit, and Sales Dashboard.
- Reconcile claims and flags authoritatively, including remote deletions.
- Store and restore campaign remarks.
- Run one startup synchronization per authenticated data load.
- Scope claim, flag, birthday-override, and KPI reads/writes to the authenticated
  session instead of trusting browser-supplied agent values.

### Month and export behavior

- Validate `months_index.json` entries against real snapshots.
- Build future planning from the latest chronologically available actual month,
  never from whichever month happens to be open.
- Roll the four displayed months forward correctly.
- Clear current-month transaction-derived state in future views, including stale
  SKU and campaign statuses.
- Disable Drop, Gain, current-month Unpurchased, Near Target, and equivalent
  transaction-derived cohorts in future views.
- Apply the same future normalization to filtered and full exports.
- Invalidate all export caches on agent/month transitions.
- Make special modes either honor visible global filters or visibly reset controls
  that do not apply.

### Business calculations and data quality

- A SKU counts as purchased, penetrated, or newly purchased only when its
  debtor/SKU/month aggregated net CTN is greater than zero.
- Returns and negative net quantities must not produce negative Gain percentages
  or Drop percentages above 100 percent.
- KPI items with missing, blank, or non-positive targets must be excluded and
  contribute zero to the denominator.
- Birthday override fetch failures must not be cached permanently.
- Missing debtor-type source columns, unexpected source headers, and unresolved
  transaction-only debtors must produce a blocking publish error rather than a
  silent zero-Converter result.
- Empty or structurally incomplete historical snapshots must not be advertised
  as available months.

### UI and accessibility

- Restore the missing `.brand-banner` rule.
- Persist campaign remarks through the same code path that reports success.
- Use keyboard-operable dashboard tabs.
- Give the PIN gate and bottom sheets dialog semantics, focus containment,
  Escape handling, and focus restoration.
- Prevent XL sizing from creating horizontal overflow on narrow screens and do
  not disable browser pinch zoom.
- Correct zero-result pagination text.
- Remove the unreachable legacy filter implementations once equivalent behavior
  is covered by tests.

## Chosen Architecture

### 1. Private snapshot storage

The local generator continues to produce the canonical full payload because the
daily pipeline and management reports need it. A new publisher splits that
payload into private Supabase records:

```text
dashboard_snapshots
  month              text primary key
  generated_at       timestamptz not null
  shared_payload     jsonb not null
  manager_support_payload jsonb not null
  data_quality       jsonb not null
  checksum           text not null
  source_version     text not null

dashboard_agent_snapshots
  month              text not null
  agent              text not null
  agent_payload      jsonb not null
  checksum           text not null
  generated_at       timestamptz not null
  primary key (month, agent)

dashboard_manager_artifacts
  artifact_key       text primary key
  generated_at       timestamptz not null
  payload            jsonb not null
  checksum           text not null

dashboard_sessions
  token_hash         text primary key
  agent              text not null
  role               text not null check (role in ('agent', 'manager'))
  created_at         timestamptz not null
  expires_at         timestamptz not null
  last_used_at       timestamptz not null

dashboard_login_attempts
  bucket_key         text primary key
  window_started_at  timestamptz not null
  failures           integer not null
```

All five tables use RLS with no anonymous read/write policy. The Edge Function
uses its service-role credential. Session tokens are random opaque values; only
their SHA-256 hashes are stored. Sessions expire after 12 hours and are removed
on logout or expiration cleanup.

The shared payload is built from an explicit safe-key allowlist. It may contain
aggregate team values and configuration needed by the Agent UI, but no other
agent's debtor cards, campaign candidates, names, phone numbers, claim state, or
export rows. The agent payload contains exactly one `agents[agent]` block plus
agent-filtered supporting collections. The private manager support payload keeps
top-level collections but excludes `agents`; manager responses rebuild the
canonical shape from all agent rows so the largest data block is not stored
twice. Separate manager artifacts hold protected datasets such as Debtor
Analysis that are not part of the Sales Dashboard snapshot.

### 2. Edge Function contract

One `dashboard-api` Edge Function owns Sales Dashboard authentication and data
access. Initial actions are:

```text
POST { action: "login", pin, month, clientVersion }
  -> { sessionToken, agent, role, month, availableMonths, data }

POST { action: "data", sessionToken, month, dataset?: "dashboard" | "debtor_analysis" }
  -> { month, availableMonths, data }

POST { action: "sync", sessionToken, month }
  -> { claims, flags, kpiScores, birthdayOverrides }

POST { action: "claim.save" | "claim.delete", sessionToken, payload }
POST { action: "flag.save" | "flag.delete", sessionToken, payload }
POST { action: "campaign.remark", sessionToken, payload }
POST { action: "kpi.save" | "birthday.save", sessionToken, payload }
POST { action: "manager.pins.list" | "manager.pins.save", sessionToken, payload }
POST { action: "logout", sessionToken }
```

The function derives the agent from the session. It ignores or rejects a
different agent supplied by the browser. `debtor_analysis` and manager PIN
actions require a manager session. Every month-scoped action checks both
`targets_monthly.active` and `targets_agents.active`; missing rows or database
errors deny non-manager access. Manager PIN handling uses the existing manager
identity (`GT138888`) but never exposes the PIN row to the browser.

Login and all state-changing actions have bounded database/fetch timeouts and
structured error responses. The browser shows retryable errors and always
releases the PIN lock in `finally` unless authentication succeeded.
Failed PIN attempts are rate-limited by a salted hash of the request network
bucket. Five failures in 15 minutes block further attempts for that bucket; a
successful login clears its failure row. Raw IP addresses are not stored.

### 3. Shared browser client

Create a small `dashboard_api.js` client used by Sales Dashboard and by the
Management/Admin readers that need the protected snapshot. It owns:

- session token storage in `sessionStorage`;
- request timeout and error normalization;
- login, month-load, sync, and logout calls;
- transition tokens that discard stale responses;
- export-state invalidation.

The Sales Dashboard must not contain fallback PINs or fall back to public JSON.
For local development, an explicitly enabled fixture mode may read local JSON;
production mode must reject that path.

### 4. Daily publishing flow

Add `publish_dashboard_snapshots.py` and call it from `update_dashboard.bat`
after generation and tests but before the Git commit:

1. Validate source freshness, required headers, debtor type coverage, supported
   month, non-empty agent blocks, and JSON finiteness.
2. Split canonical data into shared, manager-support, per-agent, and protected
   manager-artifact payloads.
3. Upsert private snapshots and manager artifacts using `SUPABASE_SERVICE_KEY`.
4. Read back row counts, checksums, month, and agent list.
5. Abort the daily update if upload or verification fails.
6. Commit only non-sensitive public metadata and aggregate artifacts.

`SUPABASE_SERVICE_KEY` is required in the local environment and is never written
to the repository. `months_index.json` may remain public because it contains only
month labels, but the API remains the authoritative available-month source.

Once all dependent readers use the API, tracked `dashboard_data.json` and
`data_*.json` files plus `debtor_analysis_data.json` are removed from the current
GitHub tree and ignored locally.
The local files remain available to the generator and archive tooling.

Historical copies remain in existing Git history until a separately approved
history-rewrite or repository-privacy operation is performed. This implementation
will not force-rewrite shared history automatically.

### 5. Claims schema

The live migration will:

- add `stage smallint not null default 1` with a `stage in (1, 2)` check;
- backfill existing claims to stage 1;
- replace the old unique key with
  `(month, agent, camp_id, debtor_code, stage)`;
- retain existing status, actor, remark, bulk, and timestamp fields;
- add month/agent/campaign indexes used by API reads.

All four pages use the same mapper and conflict key. Stage-2 claims can coexist
with stage-1 claims and deletion always includes stage.

## Correctness Rules

### Future planning

- Resolve the source snapshot as the greatest available month strictly before
  the requested future month.
- Shift source `M-2`, `M-1`, and current actual into the requested view's
  `M-3`, `M-2`, and `M-1`; requested current values are unavailable/zero only
  for display planning.
- Remove current purchase-derived SKU and campaign status instead of carrying it
  forward.
- Keep static debtor metadata and target configuration appropriate to the
  requested month.
- Full and filtered exports use one normalized canonical debtor list.

### SKU and movement

- Aggregate transaction rows before evaluating a purchase.
- `net_ctn > 0` means purchased.
- `net_ctn <= 0` means not purchased for penetration/New SKU purposes.
- Drop/Gain compares `max(net_ctn, 0)` values and treats current zero as stopped;
  percentage labels are bounded to meaningful non-negative ranges.

### KPI and birthday

- A target is applicable only when it parses to a finite value greater than zero.
- Non-applicable items set `excluded=true`, `target_missing=true`,
  `max_score=0`, and do not affect totals.
- Birthday override request failures are not cached. Successful values may use a
  short month-scoped cache that Refresh clears.

### Data quality and Converter

- The configured debtor-type column or an approved alias must be present in the
  current source report.
- The publisher rejects a current snapshot when the type column is absent, when
  typed row count unexpectedly drops to zero, or when unresolved transaction-only
  debtors exceed the configured threshold.
- Converter is included in debtor-type filters and performance calculations once
  present in canonical data; it is not silently inferred from unrelated fields.

## Migration and Rollback Order

1. Add regression tests and schema migration files.
2. Apply additive snapshot/session schema and claims-stage migration.
3. Deploy `dashboard-api` without changing the live page.
4. Upload and verify current plus supported historical snapshots.
5. Deploy browser client and migrate Sales Dashboard.
6. Migrate Management/Admin readers that consume the same snapshots.
7. Verify agent, manager, month, claim, flag, export, and mobile workflows.
8. Remove public snapshot files from the current Git tree.
9. Update the daily script and deployment documentation.

Rollback before step 8 is a frontend revert. Rollback after step 8 restores the
previous frontend and public snapshot files in one normal revert commit. Database
changes are additive; rolling back does not drop data or the new `stage` column.

## Test Strategy

Every behavior change follows red-green TDD.

### Python

- snapshot split and checksum tests;
- publish validation and fail-closed source-quality tests;
- positive-CTN New SKU/penetration tests;
- returns/negative-net fixtures;
- target applicability and KPI denominator tests;
- historical month completeness tests;
- Converter source-header tests.

### JavaScript and Edge Function

- login success, wrong PIN, timeout, and access-off tests;
- session agent spoof rejection;
- month-switch authorization and stale-response tests;
- authoritative claim/flag deletion reconciliation;
- claims stage conflict/delete behavior;
- campaign remark round trip;
- future rolling-window and export parity tests;
- special-filter reset/composition tests;
- export cache invalidation tests;
- zero-result pagination and birthday override cache tests.

### Browser QA

- desktop and 375 px mobile login, tabs, filters, exports, and logout;
- keyboard-only PIN gate, navigation tabs, and bottom sheets;
- no horizontal overflow in normal or XL mode;
- network failures leave a retryable UI and never reveal another agent;
- no dashboard debtor request occurs before authentication;
- direct public snapshot URLs return 404 after cutover.

### Supabase smoke checks

- anonymous users cannot select snapshot, session, or PIN rows;
- agent sessions cannot request another agent's data;
- inactive month access is denied;
- manager sessions can load all expected agent snapshots;
- stage-1 and stage-2 claims coexist and delete independently.

## Acceptance Criteria

- The production Sales Dashboard URL remains unchanged.
- An agent logs in with the existing four-digit PIN and sees only that agent.
- Month switching cannot bypass access or expose global search.
- No current public GitHub Pages snapshot contains Sales Dashboard debtor detail.
- Filtered and full exports agree with the displayed month and agent.
- Future views do not fabricate sales-derived cohorts.
- Zero and negative net CTN do not count as purchase/New SKU penetration.
- KPI totals exclude missing targets.
- Claims, flags, remarks, and remote deletions persist consistently across two
  browser sessions.
- Missing Converter/type source data blocks publication with a clear error.
- Complete automated tests, browser QA, and Supabase smoke checks pass before
  deployment.

## Explicit Non-Goals

- No redesign of commission rules or visual branding.
- No automatic force-push or destructive rewrite of existing Git history.
- No PFMD synchronization in this change set; PFMD receives a separate prompt or
  port after the MD implementation is verified.
- No replacement of the existing four-digit PIN user experience with email-based
  Supabase Auth in this phase.
