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
  sha256,
} from '../supabase/functions/dashboard-api/service.mjs';


const NOW = Date.parse('2026-07-14T12:00:00.000Z');
const MANAGER_AGENT = 'GT138888';


async function makeDeps() {
  const sessionRows = new Map();
  const createdSessions = [];
  const touchedSessions = [];
  const deletedSessions = [];
  const attempts = new Map();
  const savedPins = [];
  const syncLoads = [];

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
      findByPin: async (pin) => pinRows.find((row) => row.pin === pin) ?? null,
      list: async () => structuredClone(pinRows),
      save: async (row) => {
        savedPins.push(structuredClone(row));
        const existing = pinRows.find((candidate) => candidate.agent === row.agent);
        if (existing) existing.pin = row.pin;
        else pinRows.push(structuredClone(row));
      },
    },
    snapshots: {
      getShared: async (month) => (month === 'Jul 26' ? structuredClone(sharedRow) : null),
      getAgent: async (month, agent) => {
        if (month !== 'Jul 26') return null;
        return structuredClone(agentRows.find((row) => row.agent === agent) ?? null);
      },
      listAgents: async (month) => (month === 'Jul 26' ? structuredClone(agentRows) : []),
      listMonths: async () => ['Jul 26', 'Jun 26'],
    },
    artifacts: {
      get: async (artifactKey) => (
        artifactKey === 'debtor_analysis'
          ? {
              artifact_key: artifactKey,
              payload: {
                current_month: 'Jul 26',
                records: [{ debtor_code: 'B001' }],
              },
            }
          : null
      ),
    },
    loginAttempts: {
      get: async (bucketKey) => attempts.get(bucketKey) ?? null,
      save: async (row) => attempts.set(row.bucket_key, structuredClone(row)),
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
    attempts,
    createdSessions,
    deletedSessions,
    savedPins,
    sessionRows,
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


test('data rejects expired sessions', async () => {
  const dependencies = await makeDeps();

  await assert.rejects(
    () => handleData({ sessionToken: 'expired', month: 'Jul 26' }, dependencies),
    /expired/,
  );
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

  assert.equal(dependencies.state.attempts.get('hashed-bucket').failures, 5);
  await assert.rejects(
    () => handleLogin(
      { pin: '1001', month: 'Jul 26', bucket: 'hashed-bucket' },
      dependencies,
    ),
    /rate limit/,
  );
});


test('login dependency calls have a bounded timeout', async () => {
  const dependencies = await makeDeps();
  dependencies.timeoutMs = 10;
  dependencies.pins.findByPin = async () => new Promise(() => {});

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
  assert.match(configSource, /\[functions\.dashboard-api\]/);
  assert.match(configSource, /verify_jwt\s*=\s*false/);
});
