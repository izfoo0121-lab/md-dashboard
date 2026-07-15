const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DashboardApiError,
  createDashboardApi,
} = require('../dashboard_api.js');


function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    dump() {
      return Object.fromEntries(values);
    },
  };
}


function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}


function createRecordingFetch(calls, payload = { ok: true }) {
  return async (url, options) => {
    calls.push({
      url,
      options,
      body: JSON.parse(options.body),
    });
    return jsonResponse(payload);
  };
}


function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}


test('request aborts and does not retain a failed session', async () => {
  const sessionStorage = createStorage();
  const neverResolvingFetch = () => new Promise(() => {});
  const api = createDashboardApi({
    fetch: neverResolvingFetch,
    timeoutMs: 20,
    sessionStorage,
  });

  await assert.rejects(
    () => api.login('1001', 'Jul 26'),
    (error) => {
      assert(error instanceof DashboardApiError);
      assert.equal(error.status, 408);
      assert.match(error.message, /timed out/);
      return true;
    },
  );
  assert.equal(sessionStorage.getItem('md_dashboard_session'), null);
  assert.equal(sessionStorage.getItem('md_dashboard_identity'), null);
});


test('loadData sends only the opaque session token', async () => {
  const calls = [];
  const sessionStorage = createStorage({ md_dashboard_session: 'opaque' });
  const api = createDashboardApi({
    fetch: createRecordingFetch(calls),
    sessionStorage,
  });

  await api.loadData('Jun 26');

  assert.deepEqual(calls.at(-1).body, {
    action: 'data',
    sessionToken: 'opaque',
    month: 'Jun 26',
  });
});


test('manager dataset and PIN methods remain session scoped', async () => {
  const calls = [];
  const sessionStorage = createStorage({ md_dashboard_session: 'opaque' });
  const api = createDashboardApi({
    fetch: createRecordingFetch(calls),
    sessionStorage,
  });

  await api.loadData('Jul 26', 'debtor_analysis');
  await api.listAgentPins();
  await api.saveAgentPin('BEN', '1234');

  assert.deepEqual(calls[0].body, {
    action: 'data',
    sessionToken: 'opaque',
    month: 'Jul 26',
    dataset: 'debtor_analysis',
  });
  assert.deepEqual(calls[1].body, {
    action: 'manager.pins.list',
    sessionToken: 'opaque',
  });
  assert.deepEqual(calls[2].body, {
    action: 'manager.pins.save',
    sessionToken: 'opaque',
    payload: { agent: 'BEN', pin: '1234' },
  });
});


test('login stores only the token and agent role metadata', async () => {
  const calls = [];
  const sessionStorage = createStorage();
  const api = createDashboardApi({
    fetch: createRecordingFetch(calls, {
      sessionToken: 'opaque-token',
      agent: 'BEN',
      role: 'agent',
      month: 'Jul 26',
      availableMonths: ['Jul 26'],
      data: { agents: { BEN: { debtor: 'sensitive' } } },
    }),
    sessionStorage,
    clientVersion: 'test-client',
  });

  const result = await api.login('1001', 'Jul 26');

  assert.equal(result.agent, 'BEN');
  assert.deepEqual(calls[0].body, {
    action: 'login',
    pin: '1001',
    month: 'Jul 26',
    clientVersion: 'test-client',
  });
  assert.deepEqual(Object.keys(sessionStorage.dump()).sort(), [
    'md_dashboard_identity',
    'md_dashboard_session',
  ]);
  assert.equal(sessionStorage.getItem('md_dashboard_session'), 'opaque-token');
  assert.deepEqual(
    JSON.parse(sessionStorage.getItem('md_dashboard_identity')),
    { agent: 'BEN', role: 'agent' },
  );
  assert.equal(JSON.stringify(sessionStorage.dump()).includes('1001'), false);
  assert.equal(JSON.stringify(sessionStorage.dump()).includes('sensitive'), false);
});


test('failed login clears a previous session and normalizes API errors', async () => {
  const sessionStorage = createStorage({
    md_dashboard_session: 'old-token',
    md_dashboard_identity: JSON.stringify({ agent: 'BEN', role: 'agent' }),
  });
  const api = createDashboardApi({
    fetch: async () => jsonResponse(
      { error: 'invalid PIN', code: 'invalid_pin' },
      401,
    ),
    sessionStorage,
  });

  await assert.rejects(
    () => api.login('0000', 'Jul 26'),
    (error) => {
      assert(error instanceof DashboardApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, 'invalid_pin');
      assert.equal(error.message, 'invalid PIN');
      return true;
    },
  );
  assert.deepEqual(sessionStorage.dump(), {});
});


test('session-authenticated request clears a token rejected with 401', async () => {
  const sessionStorage = createStorage({
    md_dashboard_session: 'expired-token',
    md_dashboard_identity: JSON.stringify({ agent: 'BEN', role: 'agent' }),
  });
  const api = createDashboardApi({
    fetch: async () => jsonResponse(
      { error: 'session expired', code: 'session_expired' },
      401,
    ),
    sessionStorage,
  });

  await assert.rejects(() => api.loadData('Jul 26'), /session expired/);

  assert.deepEqual(sessionStorage.dump(), {});
});


test('newer month transition discards an older response and invalidates exports', async () => {
  const pending = [];
  const invalidations = [];
  const sessionStorage = createStorage({ md_dashboard_session: 'opaque' });
  const api = createDashboardApi({
    fetch: (url, options) => {
      const request = deferred();
      pending.push({ request, body: JSON.parse(options.body) });
      return request.promise;
    },
    invalidateExportState: (reason) => invalidations.push(reason),
    sessionStorage,
  });

  const june = api.loadData('Jun 26');
  const juneRejected = assert.rejects(
    june,
    (error) => error.code === 'stale_response',
  );
  const july = api.loadData('Jul 26');
  pending[1].request.resolve(jsonResponse({ month: 'Jul 26' }));
  assert.deepEqual(await july, { month: 'Jul 26' });
  pending[0].request.resolve(jsonResponse({ month: 'Jun 26' }));
  await juneRejected;

  assert.deepEqual(invalidations, ['load:Jun 26', 'load:Jul 26']);
  assert.equal(api.getExportVersion(), 2);
});


test('sync derives identity from storage and sends no browser agent', async () => {
  const calls = [];
  const sessionStorage = createStorage({ md_dashboard_session: 'opaque' });
  const api = createDashboardApi({
    fetch: createRecordingFetch(calls, { claims: [] }),
    sessionStorage,
  });

  await api.sync('Jul 26');

  assert.deepEqual(calls[0].body, {
    action: 'sync',
    sessionToken: 'opaque',
    month: 'Jul 26',
  });
});


test('logout clears local session even when the request fails', async () => {
  const invalidations = [];
  const sessionStorage = createStorage({
    md_dashboard_session: 'opaque',
    md_dashboard_identity: JSON.stringify({ agent: 'BEN', role: 'agent' }),
  });
  const api = createDashboardApi({
    fetch: async () => {
      throw new TypeError('network down');
    },
    invalidateExportState: (reason) => invalidations.push(reason),
    sessionStorage,
  });

  await assert.rejects(() => api.logout(), /network request failed/);

  assert.deepEqual(sessionStorage.dump(), {});
  assert.deepEqual(invalidations, ['logout']);
});


test('restoreSession clears incomplete or malformed session metadata', () => {
  const sessionStorage = createStorage({
    md_dashboard_session: 'opaque',
    md_dashboard_identity: '{bad json',
  });
  const api = createDashboardApi({
    fetch: async () => jsonResponse({}),
    sessionStorage,
  });

  assert.equal(api.restoreSession(), null);
  assert.deepEqual(sessionStorage.dump(), {});
});


test('browser client contains no service credential or fallback PIN map', () => {
  const source = readFileSync(
    path.join(__dirname, '..', 'dashboard_api.js'),
    'utf8',
  );

  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.doesNotMatch(source, /DEFAULT_PINS|DEFAULT_AGENT_PINS/);
});
