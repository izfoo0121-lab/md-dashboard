import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  handleAction,
  handleData,
  handleLogin,
  handleLogout,
  handleManagerPinsList,
  handleManagerPinsSave,
  handleSync,
  parseJsonObjectBody,
  sha256,
} from '../supabase/functions/dashboard-api/service.mjs';


const NOW = Date.parse('2026-07-14T12:00:00.000Z');
const MANAGER_AGENT = 'GT138888';
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const ACTIVE_GENERATION = '00000000-0000-4000-8000-000000000002';
const STALE_GENERATION = '00000000-0000-4000-8000-000000000001';


async function makeDeps() {
  const sessionRows = new Map();
  const createdSessions = [];
  const touchedSessions = [];
  const deletedSessions = [];
  const attempts = new Map();
  const loginAttemptCalls = { reserve: 0 };
  const pinLookupCalls = { count: 0 };
  const savedPins = [];
  const syncLoads = [];
  const activeLookups = [];
  const snapshotReads = [];
  const artifactReads = [];

  async function addSession(token, agent, role, expiresAt) {
    sessionRows.set(await sha256(token), {
      token_hash: await sha256(token),
      agent,
      role,
      created_at: '2026-07-14T10:00:00.000Z',
      expires_at: expiresAt,
      last_used_at: '2026-07-14T10:00:00.000Z',
    });
  }

  await addSession('ben-token', 'BEN', 'agent', '2026-07-15T00:00:00.000Z');
  await addSession('active-off', 'BEN', 'agent', '2026-07-15T00:00:00.000Z');
  await addSession('expired', 'BEN', 'agent', '2026-07-14T11:59:59.000Z');
  await addSession(
    'manager-token',
    MANAGER_AGENT,
    'manager',
    '2026-07-15T00:00:00.000Z',
  );

  const pinRows = [
    { agent: 'BEN', pin: '1001' },
    { agent: 'CJ', pin: '1002' },
    { agent: MANAGER_AGENT, pin: '9999' },
  ];
  const monthlyAccess = new Map([
    ['Jul 26|BEN', { active: true }],
    ['Jul 26|CJ', { active: true }],
    ['Jun 26|BEN', { active: false }],
  ]);
  const agentAccess = new Map([
    ['BEN', { active: true }],
    ['CJ', { active: true }],
  ]);
  const sharedRow = {
    month: 'Jul 26',
    generation_id: ACTIVE_GENERATION,
    shared_payload: {
      current_month: 'Jul 26',
      team: { sales: 200 },
      safe_only: true,
    },
    manager_support_payload: {
      current_month: 'Jul 26',
      birthday_by_month: { 'Jul 26': ['manager-only'] },
    },
  };
  const agentRows = [
    {
      month: 'Jul 26',
      generation_id: ACTIVE_GENERATION,
      agent: 'BEN',
      agent_payload: {
        agents: {
          BEN: {
            debtor_cards: {
              debtors: [{ debtor_code: 'B001', company_name: 'BEN debtor' }],
            },
          },
        },
      },
    },
    {
      month: 'Jul 26',
      generation_id: ACTIVE_GENERATION,
      agent: 'CJ',
      agent_payload: {
        agents: {
          CJ: {
            debtor_cards: {
              debtors: [{ debtor_code: 'C001', company_name: 'CJ debtor' }],
            },
          },
        },
      },
    },
  ];

  const deps = {
    now: () => NOW,
    timeoutMs: 50,
    randomToken: async () => 'new-session-token',
    sessions: {
      find: async (tokenHash) => sessionRows.get(tokenHash) ?? null,
      create: async (row) => {
        createdSessions.push(structuredClone(row));
        sessionRows.set(row.token_hash, structuredClone(row));
      },
      touch: async (tokenHash, lastUsedAt) => {
        touchedSessions.push({ tokenHash, lastUsedAt });
        const row = sessionRows.get(tokenHash);
        if (row) row.last_used_at = lastUsedAt;
      },
      delete: async (tokenHash) => {
        deletedSessions.push(tokenHash);
        sessionRows.delete(tokenHash);
      },
    },
    access: {
      monthly: async (agent, month) => monthlyAccess.get(`${month}|${agent}`) ?? null,
      agent: async (agent) => agentAccess.get(agent) ?? null,
    },
    pins: {
      listForAuthentication: async () => {
        pinLookupCalls.count += 1;
        return structuredClone(pinRows);
      },
      list: async () => structuredClone(pinRows),
      save: async (row) => {
        savedPins.push(structuredClone(row));
        const existing = pinRows.find((candidate) => candidate.agent === row.agent);
        if (existing) existing.pin = row.pin;
        else pinRows.push(structuredClone(row));
      },
    },
    snapshots: {
      getActive: async (month) => {
        activeLookups.push(month);
        return month === 'Jul 26'
          ? { month_key: month, generation_id: ACTIVE_GENERATION }
          : null;
      },
      getShared: async (month, generationId) => {
        snapshotReads.push({ resource: 'shared', month, generationId });
        return month === 'Jul 26' ? structuredClone(sharedRow) : null;
      },
      getAgent: async (month, generationId, agent) => {
        snapshotReads.push({ resource: 'agent', month, generationId, agent });
        const resolvedAgent = agent ?? generationId;
        if (month !== 'Jul 26') return null;
        return structuredClone(
          agentRows.find((row) => row.agent === resolvedAgent) ?? null,
        );
      },
      listAgents: async (month, generationId) => {
        snapshotReads.push({ resource: 'agents', month, generationId });
        return month === 'Jul 26' ? structuredClone(agentRows) : [];
      },
      listMonths: async () => ['Jul 26', 'Jun 26'],
    },
    artifacts: {
      get: async (month, generationId, artifactKey) => {
        artifactReads.push({ month, generationId, artifactKey });
        const resolvedArtifactKey = artifactKey ?? month;
        return resolvedArtifactKey === 'debtor_analysis'
          ? {
              month_key: 'Jul 26',
              generation_id: ACTIVE_GENERATION,
              artifact_key: resolvedArtifactKey,
              payload: {
                current_month: 'Jul 26',
                records: [{ debtor_code: 'B001' }],
              },
            }
          : null
      },
    },
    loginAttempts: {
      reserve: async (bucketKey, attemptedAt, maxAttempts) => {
        loginAttemptCalls.reserve += 1;
        const now = Date.parse(attemptedAt);
        const existing = attempts.get(bucketKey);
        const startedAt = Date.parse(existing?.window_started_at ?? '');
        const inWindow = Number.isFinite(startedAt)
          && now - startedAt < LOGIN_WINDOW_MS;
        const row = {
          bucket_key: bucketKey,
          window_started_at: inWindow
            ? existing.window_started_at
            : attemptedAt,
          attempts: inWindow ? Number(existing.attempts || 0) + 1 : 1,
        };
        attempts.set(bucketKey, structuredClone(row));
        return {
          allowed: row.attempts <= maxAttempts,
          attempt_count: row.attempts,
          window_started_at: row.window_started_at,
        };
      },
      delete: async (bucketKey) => attempts.delete(bucketKey),
    },
    sync: {
      load: async ({ agent, month }) => {
        syncLoads.push({ agent, month });
        return {
          claims: [{ agent: 'BEN', debtor_code: 'B001' }],
          flags: [],
          kpiScores: [{ agent: 'BEN', scores: { calls: 3 } }],
          birthdayOverrides: [],
        };
      },
    },
  };

  deps.state = {
    activeLookups,
    artifactReads,
    attempts,
    createdSessions,
    deletedSessions,
    loginAttemptCalls,
    pinLookupCalls,
    savedPins,
    sessionRows,
    snapshotReads,
    syncLoads,
    touchedSessions,
  };
  return deps;
}


test('login returns only the matched agent snapshot and stores only a token hash', async () => {
  const dependencies = await makeDeps();

  const result = await handleLogin(
    { pin: '1001', month: 'Jul 26', bucket: 'hashed-bucket' },
    dependencies,
  );

  assert.equal(result.agent, 'BEN');
  assert.equal(result.role, 'agent');
  assert.deepEqual(Object.keys(result.data.agents), ['BEN']);
  assert.equal(JSON.stringify(result.data).includes('CJ debtor'), false);
  assert.deepEqual(result.availableMonths, ['Jul 26', 'Jun 26']);
  const stored = dependencies.state.createdSessions[0];
  assert.equal(stored.token_hash, await sha256(result.sessionToken));
  assert.notEqual(stored.token_hash, result.sessionToken);
  assert.equal(JSON.stringify(stored).includes('1001'), false);
});


test('PIN comparison uses fixed-length timing-safe digests', async () => {
  const service = await import(
    '../supabase/functions/dashboard-api/service.mjs'
  );

  assert.equal(typeof service.timingSafeEqual, 'function');
  assert.equal(await service.timingSafeEqual('1001', '1001'), true);
  assert.equal(await service.timingSafeEqual('1001', '1002'), false);
  assert.equal(await service.timingSafeEqual('1', '0001'), false);
});


test('request parser enforces actual UTF-8 bytes without trusting content length', async () => {
  const multibyteBody = JSON.stringify({ value: '界'.repeat(20) });
  assert.ok(multibyteBody.length < 40);

  await assert.rejects(
    () => parseJsonObjectBody(
      new Request('https://example.test/dashboard-api', {
        method: 'POST',
        body: multibyteBody,
      }),
      40,
    ),
    (error) => error?.status === 413 && error?.code === 'request_too_large',
  );

  await assert.rejects(
    () => parseJsonObjectBody(
      new Request('https://example.test/dashboard-api', {
        method: 'POST',
        headers: { 'content-length': '2' },
        body: JSON.stringify({ value: 'x'.repeat(64) }),
      }),
      40,
    ),
    (error) => error?.status === 413 && error?.code === 'request_too_large',
  );

  const parsed = await parseJsonObjectBody(
    new Request('https://example.test/dashboard-api', {
      method: 'POST',
      body: JSON.stringify({ action: 'logout' }),
    }),
    40,
  );
  assert.deepEqual(parsed, { action: 'logout' });
});


test('login verifies the full server-side PIN candidate set with generic failures', async () => {
  const validDependencies = await makeDeps();
  validDependencies.pins.listForAuthentication = async () => [
    { agent: 'CJ', pin: '1002' },
    { agent: 'BEN', pin: '1001' },
    { agent: MANAGER_AGENT, pin: '9999' },
  ];

  const valid = await handleLogin(
    { pin: '1001', month: 'Jul 26', bucket: 'timing-safe-valid' },
    validDependencies,
  );
  assert.equal(valid.agent, 'BEN');

  const invalidDependencies = await makeDeps();
  invalidDependencies.pins.listForAuthentication = async () => [
    { agent: 'CJ', pin: '1002' },
    { agent: 'BEN', pin: '1001' },
    { agent: MANAGER_AGENT, pin: '9999' },
  ];
  await assert.rejects(
    () => handleLogin(
      { pin: '4321', month: 'Jul 26', bucket: 'timing-safe-invalid' },
      invalidDependencies,
    ),
    (error) => (
      error.status === 401
      && error.code === 'invalid_pin'
      && error.message === 'invalid PIN'
    ),
  );
});


test('login rejects a PIN shared by multiple peer agents', async () => {
  const dependencies = await makeDeps();
  dependencies.pins.listForAuthentication = async () => [
    { agent: 'BEN', pin: '1001' },
    { agent: 'CJ', pin: '1001' },
    { agent: MANAGER_AGENT, pin: '9999' },
  ];

  await assert.rejects(
    () => handleLogin(
      { pin: '1001', month: 'Jul 26', bucket: 'duplicate-peer-pin' },
      dependencies,
    ),
    (error) => error?.status === 401 && error?.code === 'invalid_pin',
  );
  assert.deepEqual(dependencies.state.createdSessions, []);
});


test('login rejects a manager PIN shared by any peer agent', async () => {
  const dependencies = await makeDeps();
  dependencies.pins.listForAuthentication = async () => [
    { agent: MANAGER_AGENT, pin: '9999' },
    { agent: 'BEN', pin: '9999' },
    { agent: 'CJ', pin: '1002' },
  ];

  await assert.rejects(
    () => handleLogin(
      { pin: '9999', month: 'Jul 26', bucket: 'duplicate-manager-pin' },
      dependencies,
    ),
    (error) => error?.status === 401 && error?.code === 'invalid_pin',
  );
  assert.deepEqual(dependencies.state.createdSessions, []);
});


test('data rejects expired sessions', async () => {
  const dependencies = await makeDeps();

  await assert.rejects(
    () => handleData({ sessionToken: 'expired', month: 'Jul 26' }, dependencies),
    /expired/,
  );
  assert.deepEqual(
    dependencies.state.deletedSessions,
    [await sha256('expired')],
  );
});


test('expired session cleanup is best effort and preserves the 401 response', async () => {
  const dependencies = await makeDeps();
  let deleteCalls = 0;
  dependencies.sessions.delete = async () => {
    deleteCalls += 1;
    throw new Error('cleanup unavailable');
  };

  await assert.rejects(
    () => handleData({ sessionToken: 'expired', month: 'Jul 26' }, dependencies),
    (error) => (
      error.status === 401
      && error.code === 'session_expired'
      && /expired/u.test(error.message)
    ),
  );
  assert.equal(deleteCalls, 1);
});


test('data rejects inactive month access', async () => {
  const dependencies = await makeDeps();

  await assert.rejects(
    () => handleData({ sessionToken: 'active-off', month: 'Jun 26' }, dependencies),
    /access denied/,
  );
});


test('data rejects an agent supplied by the browser that differs from the session', async () => {
  const dependencies = await makeDeps();

  await assert.rejects(
    () => handleData(
      { sessionToken: 'ben-token', month: 'Jul 26', agent: 'CJ' },
      dependencies,
    ),
    /agent mismatch/,
  );
});


test('data rejects an agent row whose payload belongs to a different agent', async () => {
  const dependencies = await makeDeps();
  dependencies.snapshots.getAgent = async () => ({
    month: 'Jul 26',
    generation_id: ACTIVE_GENERATION,
    agent: 'BEN',
    agent_payload: {
      agents: {
        CJ: { debtor_cards: { debtors: [{ company_name: 'CJ debtor' }] } },
      },
    },
  });

  await assert.rejects(
    () => handleData({ sessionToken: 'ben-token', month: 'Jul 26' }, dependencies),
    /agent snapshot unavailable/,
  );
});


test('missing access rows fail closed', async () => {
  const dependencies = await makeDeps();

  await assert.rejects(
    () => handleData({ sessionToken: 'ben-token', month: 'May 26' }, dependencies),
    /access unavailable/,
  );
});


test('access lookup errors fail closed', async () => {
  const dependencies = await makeDeps();
  dependencies.access.monthly = async () => {
    throw new Error('database unavailable');
  };

  await assert.rejects(
    () => handleData({ sessionToken: 'ben-token', month: 'Jul 26' }, dependencies),
    /access unavailable/,
  );
});


test('five failed PIN attempts block the network bucket for 15 minutes', async () => {
  const dependencies = await makeDeps();

  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(
      () => handleLogin(
        { pin: '0000', month: 'Jul 26', bucket: 'hashed-bucket' },
        dependencies,
      ),
      /invalid PIN/,
    );
  }

  assert.equal(dependencies.state.attempts.get('hashed-bucket').attempts, 5);
  assert.deepEqual(
    dependencies.state.loginAttemptCalls,
    { reserve: 5 },
  );
  assert.equal(dependencies.state.pinLookupCalls.count, 5);
  await assert.rejects(
    () => handleLogin(
      { pin: '1001', month: 'Jul 26', bucket: 'hashed-bucket' },
      dependencies,
    ),
    /rate limit/,
  );
});


test('only five of twenty concurrent login attempts reach PIN lookup', async () => {
  const dependencies = await makeDeps();

  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => handleLogin(
      { pin: '0000', month: 'Jul 26', bucket: 'concurrent-bucket' },
      dependencies,
    )),
  );

  const invalidPins = results.filter((result) => (
    result.status === 'rejected' && result.reason.code === 'invalid_pin'
  ));
  const rateLimited = results.filter((result) => (
    result.status === 'rejected' && result.reason.code === 'rate_limited'
  ));

  assert.equal(invalidPins.length, 5);
  assert.equal(rateLimited.length, 15);
  assert.equal(dependencies.state.pinLookupCalls.count <= 5, true);
  assert.equal(dependencies.state.attempts.get('concurrent-bucket').attempts, 20);
  assert.deepEqual(
    dependencies.state.loginAttemptCalls,
    { reserve: 20 },
  );
});


test('login dependency calls have a bounded timeout', async () => {
  const dependencies = await makeDeps();
  dependencies.timeoutMs = 10;
  dependencies.pins.listForAuthentication = async () => new Promise(() => {});

  await assert.rejects(
    () => handleLogin(
      { pin: '1001', month: 'Jul 26', bucket: 'hashed-bucket' },
      dependencies,
    ),
    /timed out/,
  );
});


test('manager dashboard is assembled from manager support and every agent row', async () => {
  const dependencies = await makeDeps();

  const result = await handleData(
    { sessionToken: 'manager-token', month: 'Jul 26' },
    dependencies,
  );

  assert.deepEqual(Object.keys(result.data.agents).sort(), ['BEN', 'CJ']);
  assert.equal(result.data.current_month, 'Jul 26');
  assert.deepEqual(result.data.birthday_by_month, { 'Jul 26': ['manager-only'] });
  assert.equal(Object.hasOwn(result.data, 'safe_only'), false);
});


test('manager-only datasets and PIN actions reject agent sessions', async () => {
  const dependencies = await makeDeps();

  await assert.rejects(
    () => handleData(
      {
        sessionToken: 'ben-token',
        month: 'Jul 26',
        dataset: 'debtor_analysis',
      },
      dependencies,
    ),
    /manager required/,
  );
  await assert.rejects(
    () => handleManagerPinsList({ sessionToken: 'ben-token' }, dependencies),
    /manager required/,
  );
  await assert.rejects(
    () => handleManagerPinsSave(
      {
        sessionToken: 'ben-token',
        payload: { agent: 'BEN', pin: '1234' },
      },
      dependencies,
    ),
    /manager required/,
  );
});


test('manager can load debtor analysis without exposing it through dashboard data', async () => {
  const dependencies = await makeDeps();

  const dashboard = await handleData(
    { sessionToken: 'manager-token', month: 'Jul 26' },
    dependencies,
  );
  const analysis = await handleData(
    {
      sessionToken: 'manager-token',
      month: 'Jul 26',
      dataset: 'debtor_analysis',
    },
    dependencies,
  );

  assert.equal(Object.hasOwn(dashboard.data, 'records'), false);
  assert.deepEqual(analysis.data.records, [{ debtor_code: 'B001' }]);
});


test('all snapshot resources are read from one resolved active generation', async () => {
  const dependencies = await makeDeps();

  await handleData(
    { sessionToken: 'ben-token', month: 'Jul 26' },
    dependencies,
  );
  await handleData(
    { sessionToken: 'manager-token', month: 'Jul 26' },
    dependencies,
  );
  await handleData(
    {
      sessionToken: 'manager-token',
      month: 'Jul 26',
      dataset: 'debtor_analysis',
    },
    dependencies,
  );
  await handleSync(
    { sessionToken: 'ben-token', month: 'Jul 26' },
    dependencies,
  );

  assert.deepEqual(
    new Set(dependencies.state.activeLookups),
    new Set(['Jul 26']),
  );
  assert.ok(dependencies.state.activeLookups.length >= 4);
  assert.ok(dependencies.state.snapshotReads.length >= 5);
  assert.equal(
    dependencies.state.snapshotReads.every(
      (read) => read.generationId === ACTIVE_GENERATION,
    ),
    true,
  );
  assert.deepEqual(dependencies.state.artifactReads, [
    {
      month: 'Jul 26',
      generationId: ACTIVE_GENERATION,
      artifactKey: 'debtor_analysis',
    },
  ]);
});


test('missing active generation fails before any snapshot row is read', async () => {
  const dependencies = await makeDeps();
  dependencies.snapshots.getActive = async () => null;

  await assert.rejects(
    () => handleData(
      { sessionToken: 'ben-token', month: 'Jul 26' },
      dependencies,
    ),
    (error) => error?.status === 404 && error?.code === 'month_not_found',
  );
  assert.deepEqual(dependencies.state.snapshotReads, []);
});


test('snapshot readers reject rows outside the resolved active generation', async (t) => {
  await t.test('shared snapshot', async () => {
    const dependencies = await makeDeps();
    const getShared = dependencies.snapshots.getShared;
    dependencies.snapshots.getShared = async (...args) => ({
      ...await getShared(...args),
      generation_id: STALE_GENERATION,
    });

    await assert.rejects(
      () => handleData(
        { sessionToken: 'ben-token', month: 'Jul 26' },
        dependencies,
      ),
      (error) => error?.status === 503 && error?.code === 'data_unavailable',
    );
  });

  await t.test('agent snapshot', async () => {
    const dependencies = await makeDeps();
    const getAgent = dependencies.snapshots.getAgent;
    dependencies.snapshots.getAgent = async (...args) => ({
      ...await getAgent(...args),
      generation_id: STALE_GENERATION,
    });

    await assert.rejects(
      () => handleData(
        { sessionToken: 'ben-token', month: 'Jul 26' },
        dependencies,
      ),
      (error) => error?.status === 503 && error?.code === 'data_unavailable',
    );
  });

  await t.test('manager agent list', async () => {
    const dependencies = await makeDeps();
    const listAgents = dependencies.snapshots.listAgents;
    dependencies.snapshots.listAgents = async (...args) => {
      const rows = await listAgents(...args);
      rows[0].generation_id = STALE_GENERATION;
      return rows;
    };

    await assert.rejects(
      () => handleData(
        { sessionToken: 'manager-token', month: 'Jul 26' },
        dependencies,
      ),
      (error) => error?.status === 503 && error?.code === 'data_unavailable',
    );
  });

  await t.test('manager artifact', async () => {
    const dependencies = await makeDeps();
    const getArtifact = dependencies.artifacts.get;
    dependencies.artifacts.get = async (...args) => ({
      ...await getArtifact(...args),
      generation_id: STALE_GENERATION,
      payload: null,
    });

    await assert.rejects(
      () => handleData(
        {
          sessionToken: 'manager-token',
          month: 'Jul 26',
          dataset: 'debtor_analysis',
        },
        dependencies,
      ),
      (error) => error?.status === 503 && error?.code === 'data_unavailable',
    );
  });

  await t.test('sync agent snapshot', async () => {
    const dependencies = await makeDeps();
    const getAgent = dependencies.snapshots.getAgent;
    dependencies.snapshots.getAgent = async (...args) => ({
      ...await getAgent(...args),
      generation_id: STALE_GENERATION,
    });

    await assert.rejects(
      () => handleSync(
        { sessionToken: 'ben-token', month: 'Jul 26' },
        dependencies,
      ),
      (error) => error?.status === 503 && error?.code === 'data_unavailable',
    );
  });
});


test('manager PIN list excludes the manager row and save returns no PIN', async () => {
  const dependencies = await makeDeps();

  const listed = await handleManagerPinsList(
    { sessionToken: 'manager-token' },
    dependencies,
  );
  const saved = await handleManagerPinsSave(
    {
      sessionToken: 'manager-token',
      payload: { agent: 'BEN', pin: '1234' },
    },
    dependencies,
  );

  assert.deepEqual(listed.pins, [
    { agent: 'BEN', pin: '1001' },
    { agent: 'CJ', pin: '1002' },
  ]);
  assert.deepEqual(dependencies.state.savedPins, [{ agent: 'BEN', pin: '1234' }]);
  assert.deepEqual(saved, { saved: true, agent: 'BEN' });
  assert.equal(Object.hasOwn(saved, 'pin'), false);
});


test('manager PIN save cannot replace the manager credential', async () => {
  const dependencies = await makeDeps();

  await assert.rejects(
    () => handleManagerPinsSave(
      {
        sessionToken: 'manager-token',
        payload: { agent: MANAGER_AGENT, pin: '1234' },
      },
      dependencies,
    ),
    /manager PIN cannot be changed/,
  );
});


test('manager PIN save rejects a PIN assigned to another agent', async () => {
  const dependencies = await makeDeps();

  await assert.rejects(
    () => handleManagerPinsSave(
      {
        sessionToken: 'manager-token',
        payload: { agent: 'BEN', pin: '1002' },
      },
      dependencies,
    ),
    (error) => (
      error?.status === 409
      && error?.code === 'pin_conflict'
      && error?.message === 'PIN is unavailable'
      && !error.message.includes('CJ')
    ),
  );
  assert.deepEqual(dependencies.state.savedPins, []);
});


test('manager PIN save allows the same PIN owner and an unused replacement', async () => {
  const dependencies = await makeDeps();

  const unchanged = await handleManagerPinsSave(
    {
      sessionToken: 'manager-token',
      payload: { agent: 'BEN', pin: '1001' },
    },
    dependencies,
  );
  const updated = await handleManagerPinsSave(
    {
      sessionToken: 'manager-token',
      payload: { agent: 'BEN', pin: '1234' },
    },
    dependencies,
  );

  assert.deepEqual(unchanged, { saved: true, agent: 'BEN' });
  assert.deepEqual(updated, { saved: true, agent: 'BEN' });
  assert.deepEqual(dependencies.state.savedPins, [
    { agent: 'BEN', pin: '1001' },
    { agent: 'BEN', pin: '1234' },
  ]);
});


test('sync derives the agent from the session and rejects spoofing', async () => {
  const dependencies = await makeDeps();

  const result = await handleSync(
    { sessionToken: 'ben-token', month: 'Jul 26' },
    dependencies,
  );

  assert.deepEqual(dependencies.state.syncLoads, [{ agent: 'BEN', month: 'Jul 26' }]);
  assert.deepEqual(result.claims, [{ agent: 'BEN', debtor_code: 'B001' }]);
  await assert.rejects(
    () => handleSync(
      { sessionToken: 'ben-token', month: 'Jul 26', agent: 'CJ' },
      dependencies,
    ),
    /agent mismatch/,
  );
});


test('sync discards peer rows and birthday overrides for peer debtors', async () => {
  const dependencies = await makeDeps();
  dependencies.sync.load = async () => ({
    claims: [
      { agent: 'BEN', debtor_code: 'B001' },
      { agent: 'CJ', debtor_code: 'C001' },
    ],
    flags: [
      { agent: 'BEN', debtor_code: 'B001' },
      { agent: 'CJ', debtor_code: 'C001' },
    ],
    kpiScores: [
      { agent: 'BEN', scores: { calls: 3 } },
      { agent: 'CJ', scores: { calls: 9 } },
    ],
    birthdayOverrides: [
      { debtor_code: 'B001', action: 'add' },
      { debtor_code: 'C001', action: 'remove' },
    ],
  });

  const result = await handleSync(
    { sessionToken: 'ben-token', month: 'Jul 26' },
    dependencies,
  );

  assert.deepEqual(result.claims, [{ agent: 'BEN', debtor_code: 'B001' }]);
  assert.deepEqual(result.flags, [{ agent: 'BEN', debtor_code: 'B001' }]);
  assert.deepEqual(result.kpiScores, [
    { agent: 'BEN', scores: { calls: 3 } },
  ]);
  assert.deepEqual(result.birthdayOverrides, [
    { debtor_code: 'B001', action: 'add' },
  ]);
});


test('logout deletes the hashed session token', async () => {
  const dependencies = await makeDeps();

  const result = await handleLogout(
    { sessionToken: 'ben-token' },
    dependencies,
  );

  assert.deepEqual(result, { loggedOut: true });
  assert.deepEqual(dependencies.state.deletedSessions, [await sha256('ben-token')]);
});


test('action router exposes the approved core actions and rejects unknown actions', async () => {
  const dependencies = await makeDeps();

  const result = await handleAction(
    { action: 'manager.pins.list', sessionToken: 'manager-token' },
    dependencies,
  );

  assert.equal(result.pins.length, 2);
  await assert.rejects(
    () => handleAction({ action: 'not-supported' }, dependencies),
    /unsupported action/,
  );
});


test('edge entrypoint and config explicitly use POST/OPTIONS custom session auth', () => {
  const indexSource = readFileSync(
    new URL('../supabase/functions/dashboard-api/index.ts', import.meta.url),
    'utf8',
  );
  const configSource = readFileSync(
    new URL('../supabase/config.toml', import.meta.url),
    'utf8',
  );

  assert.match(indexSource, /request\.method === 'OPTIONS'/);
  assert.match(indexSource, /request\.method !== 'POST'/);
  assert.match(indexSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(indexSource, /DASHBOARD_RATE_LIMIT_SALT/);
  assert.match(indexSource, /\.rpc\(\s*'dashboard_reserve_login_attempt'/);
  assert.match(indexSource, /listForAuthentication/);
  assert.match(
    indexSource,
    /parseJsonObjectBody\(request,\s*MAX_BODY_BYTES\)/,
  );
  assert.doesNotMatch(indexSource, /request\.json\(\)/);
  assert.doesNotMatch(indexSource, /\.eq\(\s*'pin'/);
  assert.match(configSource, /\[functions\.dashboard-api\]/);
  assert.match(configSource, /verify_jwt\s*=\s*false/);
});


test('edge dependencies query only the resolved active generation', () => {
  const indexSource = readFileSync(
    new URL('../supabase/functions/dashboard-api/index.ts', import.meta.url),
    'utf8',
  );

  assert.match(indexSource, /getActive:\s*\(month:\s*string\)/);
  assert.match(indexSource, /\.from\('dashboard_active_snapshots'\)/);
  assert.match(indexSource, /getShared:\s*\(month:\s*string,\s*generationId:\s*string\)/);
  assert.match(
    indexSource,
    /getAgent:\s*\(month:\s*string,\s*generationId:\s*string,\s*agent:\s*string\)/,
  );
  assert.match(indexSource, /listAgents:\s*\(month:\s*string,\s*generationId:\s*string\)/);
  assert.match(
    indexSource,
    /get:\s*\(month:\s*string,\s*generationId:\s*string,\s*artifactKey:\s*string\)/,
  );
  assert.ok(
    (indexSource.match(/\.eq\('generation_id',\s*generationId\)/g) ?? []).length >= 4,
  );
  assert.match(
    indexSource,
    /\.select\('month,generation_id,shared_payload,manager_support_payload'\)/,
  );
  assert.ok(
    (
      indexSource.match(
        /\.select\('month,generation_id,agent,agent_payload'\)/g,
      ) ?? []
    ).length >= 2,
  );
  assert.match(
    indexSource,
    /\.select\('month_key,generation_id,artifact_key,payload'\)/,
  );
});
