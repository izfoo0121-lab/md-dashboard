const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'sales_dashboard.html'),
  'utf8',
);


function extractFunction(name) {
  let start = html.indexOf(`async function ${name}`);
  if (start < 0) start = html.indexOf(`function ${name}`);
  assert(start >= 0, `${name} should exist`);
  const bodyStart = html.indexOf('{', html.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let index = bodyStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}


function extractIife(name) {
  const start = html.indexOf(`const ${name} = (() => {`);
  assert(start >= 0, `${name} should exist`);
  const endMarker = '\n})();';
  const end = html.indexOf(endMarker, start);
  assert(end >= 0, `${name} should have an IIFE body`);
  return html.slice(start, end + endMarker.length);
}


function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}


function extractFunctionOr(name, fallbackSource) {
  const markers = [`async function ${name}`, `function ${name}`];
  return markers.some(marker => html.includes(marker))
    ? extractFunction(name)
    : fallbackSource;
}


function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get length() {
      return values.size;
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
  };
}


function dashboardData(month, agents) {
  return {
    current_month: month,
    working_days: {},
    agents: Object.fromEntries(
      Object.entries(agents).map(([agent, debtorCodes]) => [agent, {
        debtor_cards: {
          debtors: debtorCodes.map(debtor_code => ({ debtor_code })),
        },
      }]),
    ),
  };
}


function createInitialFutureLoginContext(options = {}) {
  const publishedMonths = options.publishedMonths || ['Jun 26'];
  const calls = {
    errors: [],
    login: [],
    logout: 0,
    overlays: [],
    publicFetch: [],
    protectedFetch: 0,
  };
  const baseData = dashboardData('Jun 26', { BEN: ['300-BEN'] });
  const dots = Array.from({ length: 4 }, () => ({ className: '' }));
  const pinGate = { style: { display: 'flex' } };
  const context = {
    AVAILABLE_MONTHS: [],
    CURRENT_MONTH_SLUG: 'current',
    DATA: null,
    MONTHS_WITH_DATA: [],
    DashboardApi: {
      async login(pin, month) {
        calls.login.push({ month, pin });
        return {
          agent: 'BEN',
          role: 'agent',
          month: 'Jun 26',
          availableMonths: ['Jun 26'],
          data: baseData,
        };
      },
      async logout() {
        calls.logout += 1;
      },
    },
    beginDebtorExportTransition: () => 1,
    clearProtectedDashboardState() {
      context.DATA = null;
      context.currentAgent = null;
      context.authenticatedAgent = null;
      context.authenticatedRole = null;
      context.AVAILABLE_MONTHS = [];
      context.MONTHS_WITH_DATA = [];
    },
    commitDashboardEnvelope(result, commitOptions) {
      context.DATA = result.data;
      context.AVAILABLE_MONTHS = result.availableMonths || [];
      context.MONTHS_WITH_DATA = context.AVAILABLE_MONTHS.map(context.monthSlug);
      context.CURRENT_MONTH_SLUG = commitOptions.requestedSlug;
      context.authenticatedAgent = commitOptions.agent;
      context.authenticatedRole = commitOptions.role;
      context.currentAgent = commitOptions.agent;
    },
    completeDebtorExportTransition() {},
    document: {
      getElementById(id) {
        if (id === 'pin-gate') return pinGate;
        if (id === 'pin-name-hint') return { textContent: '' };
        if (id.startsWith('pd')) return dots[Number(id.slice(2))];
        return null;
      },
    },
    async fetch(url) {
      const requestUrl = String(url);
      if (requestUrl !== 'months_index.json') {
        calls.protectedFetch += 1;
        throw new Error(`protected generic fetch attempted: ${requestUrl}`);
      }
      calls.publicFetch.push(requestUrl);
      return {
        ok: true,
        async json() {
          return publishedMonths;
        },
      };
    },
    initializeDashboardAfterCommit: async () => {},
    isCurrentDebtorExportTransition: () => true,
    monthSlug: month => String(month || '').replace(' ', '').toLowerCase(),
    async prepareAuthorizedDashboardData(data) {
      calls.overlays.push(data.current_month);
      return data;
    },
    selectedDashboardMonth: () => 'Jul 26',
    showPinError(message) {
      calls.errors.push(message);
    },
    updatePinDisplay() {},
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var currentAgent = null;',
    'var authenticatedAgent = null;',
    'var authenticatedRole = null;',
    "var _pin = '1001';",
    'var _pinLocked = false;',
    'var _pinAttemptSequence = 0;',
    'var _pinLockOwner = 0;',
    extractFunction('monthSortKey'),
    extractFunction('fetchAvailableMonthLabels'),
    extractFunction('resolvePublishedBaseMonth'),
    extractFunction('isCampaignActiveInMonth'),
    extractFunction('monthLabelToIso'),
    extractFunction('isHistoricalMonth'),
    extractFunction('shouldIncludeLiveCampaignForSales'),
    extractFunction('retainFutureGeneratedCampaignFallbacks'),
    extractFunction('prepareAuthorizedInitialMonthData'),
    extractFunction('checkPin'),
  ].join('\n'), context);
  return { calls, context, pinGate };
}


function createPinRaceContext() {
  const calls = { login: [] };
  const dots = Array.from({ length: 4 }, () => ({ className: '' }));
  const pinGate = { style: { display: 'flex' } };
  let transitionVersion = 0;
  const context = {
    DATA: null,
    DashboardApi: {
      login(pin, month) {
        const pending = createDeferred();
        calls.login.push({ month, pin, ...pending });
        return pending.promise;
      },
    },
    beginDebtorExportTransition() {
      transitionVersion += 1;
      return transitionVersion;
    },
    clearProtectedDashboardState() {
      context.DATA = null;
      context.currentAgent = null;
      context.authenticatedAgent = null;
      context.authenticatedRole = null;
    },
    commitDashboardEnvelope(result, options) {
      context.DATA = result.data;
      context.authenticatedAgent = options.agent;
      context.authenticatedRole = options.role;
      context.currentAgent = options.agent;
    },
    completeDebtorExportTransition() {},
    document: {
      getElementById(id) {
        if (id === 'pin-gate') return pinGate;
        if (id === 'pin-name-hint') return { textContent: '' };
        if (id.startsWith('pd')) return dots[Number(id.slice(2))];
        return null;
      },
    },
    fetchAvailableMonthLabels: async () => ['Jul 26'],
    initializeDashboardAfterCommit: async () => {},
    isCurrentDebtorExportTransition(token) {
      return token === transitionVersion;
    },
    monthSlug: month => String(month || '').replace(' ', '').toLowerCase(),
    prepareAuthorizedInitialMonthData: async data => data,
    resolvePublishedBaseMonth: requestedMonth => requestedMonth,
    selectedDashboardMonth: () => 'Jul 26',
    showPinError() {},
    updatePinDisplay() {},
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var currentAgent = null;',
    'var authenticatedAgent = null;',
    'var authenticatedRole = null;',
    "var _pin = '1001';",
    'var _pinLocked = false;',
    'var _pinAttemptSequence = 0;',
    'var _pinLockOwner = 0;',
    extractFunction('checkPin'),
  ].join('\n'), context);
  return { calls, context };
}


function successfulLoginEnvelope(month = 'Jul 26') {
  return {
    agent: 'BEN',
    role: 'agent',
    month,
    availableMonths: [month],
    data: dashboardData(month, { BEN: ['300-BEN'] }),
  };
}


test('Sales loads dashboard_api.js and contains no public snapshot or PIN bypass', () => {
  assert.match(html, /<script\s+src=["']dashboard_api\.js["']><\/script>/);
  assert.match(
    html,
    /DashboardApi\.configure\(\{[\s\S]*?endpoint:\s*`\$\{AGENT_ACCESS_SUPABASE_URL\}\/functions\/v1\/dashboard-api`[\s\S]*?publishableKey:\s*AGENT_ACCESS_SUPABASE_KEY[\s\S]*?clientVersion:\s*SALES_DASHBOARD_BUILD/,
  );
  assert.doesNotMatch(html, /DEFAULT_(?:AGENT_)?PINS|DATA\.config\??\.agent_pins/);
  assert.doesNotMatch(html, /\/rest\/v1\/(?:agent_pins|targets_pins)\b/);
  assert.doesNotMatch(
    html,
    /dashboard_data\.json|debtor_analysis_data\.json|data_\$\{/,
  );
  assert.doesNotMatch(
    html,
    /CURRENT_MONTH_FILE|DEBTOR_ANALYSIS_CACHE|MONTH_SNAPSHOT_CACHE|fetch\(fallbackUrl\)/,
  );
  assert.doesNotMatch(
    html,
    /DEBTOR_["']\s*\+\s*["']ANALYSIS_CACHE|MONTH_["']\s*\+\s*["']SNAPSHOT_CACHE/,
  );
  assert.doesNotMatch(
    html,
    /(?:localStorage|sessionStorage)\.setItem\(\s*['"]md_(?:auth|agent)['"]/,
  );

  const checkPinSource = extractFunction('checkPin');
  const monthIndexSource = extractFunction('fetchAvailableMonthLabels');
  const loadDataSource = extractFunction('loadData');
  const selectAgentSource = extractFunction('selectAgent');
  const switchMonthSource = extractFunction('switchMonth');
  const refreshSource = extractFunction('forceRefreshDashboard');
  assert.match(checkPinSource, /const submittedPin = _pin;/);
  assert.match(checkPinSource, /DashboardApi\.login\(\s*submittedPin\s*,/);
  assert.match(monthIndexSource, /fetch\(\s*['"]months_index\.json['"]/);
  assert.doesNotMatch(
    monthIndexSource,
    /dashboard_data\.json|debtor_analysis_data\.json|data_\$\{|DashboardApi\./,
  );
  assert.match(loadDataSource, /DashboardApi\.loadData\(/);
  assert.match(switchMonthSource, /DashboardApi\.loadData\(/);
  assert.doesNotMatch(switchMonthSource, /\bfetch\s*\(/);
  assert.doesNotMatch(selectAgentSource, /\bfetch\s*\(/);
  assert.match(refreshSource, /switchMonth\(/);
});


test('unauthenticated boot shows only the PIN gate and makes no data request', async () => {
  const calls = [];
  const pinGate = { style: { display: 'none' } };
  const context = {
    DashboardApi: {
      restoreSession() {
        calls.push('restore');
        return null;
      },
      async loadData() {
        calls.push('load');
      },
    },
    clearProtectedDashboardState() {
      calls.push('clear');
    },
    document: {
      getElementById(id) {
        return id === 'pin-gate' ? pinGate : null;
      },
    },
    loadData: async () => calls.push('load'),
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('bootSalesDashboard'), context);

  await context.bootSalesDashboard();

  assert.deepEqual(calls, ['restore', 'clear']);
  assert.equal(pinGate.style.display, 'flex');
});


test('valid opaque session restores metadata and loads through DashboardApi', async () => {
  const calls = [];
  const context = {
    DashboardApi: {
      restoreSession() {
        return { agent: 'BEN', role: 'agent' };
      },
    },
    loadData: async () => calls.push('load'),
  };
  vm.createContext(context);
  vm.runInContext([
    'var authenticatedAgent = null;',
    'var authenticatedRole = null;',
    extractFunction('bootSalesDashboard'),
  ].join('\n'), context);

  await context.bootSalesDashboard();

  assert.deepEqual(calls, ['load']);
  assert.equal(context.authenticatedAgent, 'BEN');
  assert.equal(context.authenticatedRole, 'agent');
});


test('restored Jul session loads the Jun published base and synthesizes the requested future view', async () => {
  const calls = { api: [], errors: [], overlays: [], publicFetch: [], protectedFetch: 0 };
  const baseData = dashboardData('Jun 26', { BEN: ['300-BEN'] });
  const pinGate = { style: { display: 'flex' } };
  const context = {
    DATA: null,
    AVAILABLE_MONTHS: [],
    CURRENT_MONTH_SLUG: 'current',
    MONTHS_WITH_DATA: [],
    DashboardApi: {
      restoreSession() {
        return { agent: 'BEN', role: 'agent' };
      },
      async loadData(month) {
        calls.api.push(month);
        return {
          month: 'Jun 26',
          availableMonths: ['Jun 26'],
          data: baseData,
        };
      },
    },
    beginDebtorExportTransition: () => 1,
    chooseInitialMonthLabel: (_months, realMonth, explicitMonth) => explicitMonth || realMonth,
    clearProtectedDashboardState() {
      context.DATA = null;
    },
    commitDashboardEnvelope(result, options) {
      context.DATA = result.data;
      context.AVAILABLE_MONTHS = result.availableMonths || [];
      context.MONTHS_WITH_DATA = context.AVAILABLE_MONTHS.map(context.monthSlug);
      context.CURRENT_MONTH_SLUG = options.requestedSlug;
      context.currentAgent = 'BEN';
    },
    completeDebtorExportTransition() {},
    document: {
      getElementById(id) {
        return id === 'pin-gate' ? pinGate : null;
      },
    },
    explicitUrlMonthLabel: () => 'Jul 26',
    async fetch(url) {
      const requestUrl = String(url);
      if (requestUrl !== 'months_index.json') {
        calls.protectedFetch += 1;
        throw new Error(`protected generic fetch attempted: ${requestUrl}`);
      }
      calls.publicFetch.push(requestUrl);
      return { ok: true, json: async () => ['Jun 26', 'Aug 26'] };
    },
    getLastAgentSelection: () => '',
    getRealWorldMonthLabel: () => 'Jul 26',
    initializeDashboardAfterCommit: async () => {},
    isCurrentDebtorExportTransition: () => true,
    monthSlug: month => String(month || '').replace(' ', '').toLowerCase(),
    async prepareAuthorizedDashboardData(data) {
      calls.overlays.push(data.current_month);
      return data;
    },
    refreshIfStaleDashboardVersion: async () => false,
    showPinError(message) {
      calls.errors.push(message);
    },
    window: {},
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var authenticatedAgent = null;',
    'var authenticatedRole = null;',
    'var currentAgent = null;',
    extractFunction('monthSortKey'),
    extractFunction('fetchAvailableMonthLabels'),
    extractFunction('resolvePublishedBaseMonth'),
    extractFunction('isCampaignActiveInMonth'),
    extractFunction('monthLabelToIso'),
    extractFunction('isHistoricalMonth'),
    extractFunction('shouldIncludeLiveCampaignForSales'),
    extractFunction('retainFutureGeneratedCampaignFallbacks'),
    extractFunction('prepareAuthorizedInitialMonthData'),
    extractFunction('loadData'),
    extractFunction('bootSalesDashboard'),
  ].join('\n'), context);

  const loaded = await context.bootSalesDashboard();

  assert.equal(loaded, true);
  assert.deepEqual(calls.publicFetch, ['months_index.json']);
  assert.equal(calls.protectedFetch, 0);
  assert.deepEqual(calls.api, ['Jun 26']);
  assert.deepEqual(calls.overlays, ['Jul 26']);
  assert.equal(context.DATA.current_month, 'Jul 26');
  assert.equal(context.DATA.is_future_view, true);
  assert.equal(context.CURRENT_MONTH_SLUG, 'jul26');
  assert.equal(context.authenticatedAgent, 'BEN');
  assert.equal(context.authenticatedRole, 'agent');
  assert.equal(pinGate.style.display, 'none');
  assert.deepEqual(calls.errors, []);
});


test('restored session clears its opaque API session when the public month index is unavailable', async () => {
  const session = new Map([['md_dashboard_session', 'opaque-token']]);
  const calls = { errors: [], logout: 0, protectedFetch: 0, publicFetch: [] };
  const pinGate = { style: { display: 'none' } };
  const context = {
    DATA: { sensitive: true },
    AVAILABLE_MONTHS: [],
    CURRENT_MONTH_SLUG: 'current',
    MONTHS_WITH_DATA: [],
    DashboardApi: {
      async logout() {
        calls.logout += 1;
        session.clear();
      },
    },
    beginDebtorExportTransition: () => 1,
    clearProtectedDashboardState() {
      context.DATA = null;
      context.authenticatedAgent = null;
      context.authenticatedRole = null;
      context.currentAgent = null;
    },
    completeDebtorExportTransition() {},
    document: {
      getElementById(id) {
        return id === 'pin-gate' ? pinGate : null;
      },
    },
    async fetch(url) {
      const requestUrl = String(url);
      if (requestUrl !== 'months_index.json') {
        calls.protectedFetch += 1;
        throw new Error(`protected generic fetch attempted: ${requestUrl}`);
      }
      calls.publicFetch.push(requestUrl);
      throw new Error('month index offline');
    },
    isCurrentDebtorExportTransition: () => true,
    refreshIfStaleDashboardVersion: async () => false,
    showPinError(message) {
      calls.errors.push(message);
    },
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    "var authenticatedAgent = 'BEN';",
    "var authenticatedRole = 'agent';",
    "var currentAgent = 'BEN';",
    extractFunction('monthSortKey'),
    extractFunction('fetchAvailableMonthLabels'),
    extractFunction('loadData'),
  ].join('\n'), context);

  const loaded = await context.loadData();

  assert.equal(loaded, false);
  assert.deepEqual(calls.publicFetch, ['months_index.json']);
  assert.equal(calls.protectedFetch, 0);
  assert.equal(calls.logout, 1);
  assert.equal(session.size, 0);
  assert.equal(context.DATA, null);
  assert.equal(pinGate.style.display, 'flex');
  assert.equal(calls.errors.length, 1);
  assert.match(calls.errors[0], /published dashboard month index/i);
});


test('initial future planning keeps an explicit requested month in the month selector', async () => {
  const selector = { innerHTML: '', style: {}, value: '' };
  const context = {
    DATA: { current_month: 'Aug 26', is_future_view: true },
    CURRENT_MONTH_SLUG: 'aug26',
    MONTHS_WITH_DATA: [],
    document: {
      getElementById(id) {
        return id === 'month-selector-agent' ? selector : null;
      },
    },
    getRealWorldMonthLabel: () => 'Jul 26',
    monthSlug: month => String(month || '').replace(' ', '').toLowerCase(),
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    extractFunction('loadMonthIndex'),
  ].join('\n'), context);

  await context.loadMonthIndex(['Jun 26']);

  assert.match(selector.innerHTML, /AUG 26/);
  assert.equal(selector.value, 'aug26');
  assert.deepEqual(Array.from(context.MONTHS_WITH_DATA), ['jun26']);
});


test('successful PIN login commits only the gateway envelope data', async () => {
  const calls = [];
  const returnedData = dashboardData('Jul 26', { BEN: ['300-BEN'] });
  const pinGate = { style: { display: 'flex' } };
  const dots = Array.from({ length: 4 }, () => ({ className: '' }));
  const context = {
    DashboardApi: {
      async login(pin, month) {
        calls.push({ pin, month, pinBuffer: context._pin });
        return {
          sessionToken: 'opaque',
          agent: 'BEN',
          role: 'agent',
          month: 'Jul 26',
          availableMonths: ['Jul 26', 'Jun 26'],
          data: returnedData,
        };
      },
    },
    beginDebtorExportTransition: () => 1,
    commitDashboardEnvelope(result, options) {
      context.DATA = result.data;
      context.authenticatedAgent = options.agent;
      context.authenticatedRole = options.role;
      context.currentAgent = options.agent;
      context.AVAILABLE_MONTHS = result.availableMonths;
    },
    completeDebtorExportTransition() {},
    document: {
      getElementById(id) {
        if (id === 'pin-gate') return pinGate;
        if (id === 'pin-name-hint') return { textContent: '' };
        if (id.startsWith('pd')) return dots[Number(id.slice(2))];
        return null;
      },
    },
    fetch() {
      throw new Error('PIN login must not use fetch directly');
    },
    initializeDashboardAfterCommit: async () => calls.push({ initialized: true }),
    isCurrentDebtorExportTransition: () => true,
    monthSlug: month => String(month || '').replace(' ', '').toLowerCase(),
    prepareAuthorizedDashboardData: async data => data,
    prepareAuthorizedInitialMonthData: async data => data,
    fetchAvailableMonthLabels: async () => ['Jul 26'],
    resolvePublishedBaseMonth: requestedMonth => requestedMonth,
    selectedDashboardMonth: () => 'Jul 26',
    setTimeout(callback) {
      callback();
    },
    showPinError(message) {
      throw new Error(`unexpected login error: ${message}`);
    },
    updatePinDisplay() {},
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = null;',
    'var currentAgent = null;',
    'var authenticatedAgent = null;',
    'var authenticatedRole = null;',
    'var AVAILABLE_MONTHS = [];',
    "var _pin = '1001';",
    'var _pinLocked = false;',
    'var _pinAttemptSequence = 0;',
    'var _pinLockOwner = 0;',
    extractFunction('checkPin'),
  ].join('\n'), context);

  await context.checkPin();

  assert.strictEqual(context.DATA, returnedData);
  assert.equal(context.authenticatedAgent, 'BEN');
  assert.equal(context.authenticatedRole, 'agent');
  assert.equal(context.currentAgent, 'BEN');
  assert.equal(context._pin, '');
  assert.deepEqual(calls, [
    { pin: '1001', month: 'Jul 26', pinBuffer: '' },
    { initialized: true },
  ]);
});


test('fresh Jul login uses the Jun published base and synthesizes an authorized future view', async () => {
  const { calls, context, pinGate } = createInitialFutureLoginContext();

  const loggedIn = await context.checkPin();

  assert.equal(loggedIn, true);
  assert.deepEqual(calls.publicFetch, ['months_index.json']);
  assert.equal(calls.protectedFetch, 0);
  assert.deepEqual(calls.login, [{ pin: '1001', month: 'Jun 26' }]);
  assert.deepEqual(calls.overlays, ['Jul 26']);
  assert.equal(context.DATA.current_month, 'Jul 26');
  assert.equal(context.DATA.is_future_view, true);
  assert.equal(context.CURRENT_MONTH_SLUG, 'jul26');
  assert.equal(context.currentAgent, 'BEN');
  assert.equal(pinGate.style.display, 'none');
});


test('empty public month index stops login without a protected request or snapshot fallback', async () => {
  const { calls, context, pinGate } = createInitialFutureLoginContext({ publishedMonths: [] });

  const loggedIn = await context.checkPin();

  assert.equal(loggedIn, false);
  assert.deepEqual(calls.publicFetch, ['months_index.json']);
  assert.equal(calls.protectedFetch, 0);
  assert.deepEqual(calls.login, []);
  assert.equal(context.DATA, null);
  assert.equal(pinGate.style.display, 'flex');
  assert.equal(calls.errors.length, 1);
  assert.match(calls.errors[0], /published dashboard month/i);
});


test('failed PIN login leaves protected data empty and no API session', async () => {
  const session = new Map([['md_dashboard_session', 'old-token']]);
  const errors = [];
  const context = {
    DashboardApi: {
      async login() {
        session.clear();
        throw new Error('invalid PIN');
      },
    },
    beginDebtorExportTransition: () => 1,
    clearProtectedDashboardState() {
      context.DATA = null;
      context.currentAgent = null;
      context.authenticatedAgent = null;
      context.authenticatedRole = null;
    },
    completeDebtorExportTransition() {},
    isCurrentDebtorExportTransition: () => true,
    monthSlug: month => String(month || '').replace(' ', '').toLowerCase(),
    fetchAvailableMonthLabels: async () => ['Jul 26'],
    resolvePublishedBaseMonth: requestedMonth => requestedMonth,
    selectedDashboardMonth: () => 'Jul 26',
    showPinError(message) {
      errors.push(message);
    },
    updatePinDisplay() {},
  };
  vm.createContext(context);
  vm.runInContext([
    "var DATA = { sensitive: true };",
    "var currentAgent = 'BEN';",
    "var authenticatedAgent = 'BEN';",
    "var authenticatedRole = 'agent';",
    "var _pin = '0000';",
    'var _pinLocked = false;',
    'var _pinAttemptSequence = 0;',
    'var _pinLockOwner = 0;',
    extractFunction('checkPin'),
  ].join('\n'), context);

  await context.checkPin();

  assert.equal(context.DATA, null);
  assert.equal(context.currentAgent, null);
  assert.equal(session.size, 0);
  assert.equal(context._pin, '');
  assert.deepEqual(errors, ['invalid PIN']);
});


test('post-auth login failure terminates the newly created opaque session', async () => {
  const session = new Map();
  const context = {
    DashboardApi: {
      async login() {
        session.set('md_dashboard_session', 'new-token');
        return {
          agent: 'BEN',
          role: 'agent',
          month: 'Jul 26',
          availableMonths: ['Jul 26'],
          data: dashboardData('Jul 26', { BEN: ['300-BEN'] }),
        };
      },
      async logout() {
        session.clear();
        context.logoutCalls += 1;
      },
    },
    beginDebtorExportTransition: () => 1,
    clearProtectedDashboardState() {
      context.DATA = null;
      context.currentAgent = null;
      context.authenticatedAgent = null;
      context.authenticatedRole = null;
    },
    completeDebtorExportTransition() {},
    isCurrentDebtorExportTransition: () => true,
    logoutCalls: 0,
    monthSlug: month => String(month || '').replace(' ', '').toLowerCase(),
    prepareAuthorizedDashboardData: async () => {
      throw new Error('invalid gateway envelope');
    },
    prepareAuthorizedInitialMonthData: async data => context.prepareAuthorizedDashboardData(data),
    fetchAvailableMonthLabels: async () => ['Jul 26'],
    resolvePublishedBaseMonth: requestedMonth => requestedMonth,
    selectedDashboardMonth: () => 'Jul 26',
    showPinError() {},
    updatePinDisplay() {},
  };
  vm.createContext(context);
  vm.runInContext([
    "var DATA = { sensitive: true };",
    "var currentAgent = 'BEN';",
    "var authenticatedAgent = 'BEN';",
    "var authenticatedRole = 'agent';",
    "var _pin = '1001';",
    'var _pinLocked = false;',
    'var _pinAttemptSequence = 0;',
    'var _pinLockOwner = 0;',
    extractFunction('checkPin'),
  ].join('\n'), context);

  await context.checkPin();

  assert.equal(context.logoutCalls, 1);
  assert.equal(session.size, 0);
  assert.equal(context.DATA, null);
  assert.equal(context.currentAgent, null);
});


test('login initialization failure scrubs rendered debtor DOM and disables exports', async () => {
  const localStorage = createStorage({
    md_gist_cache: '{"sensitive":true}',
    camp_claim_Jul26_BEN_camp_300_A: '{"sensitive":true}',
  });
  const sessionStorage = createStorage({
    md_dashboard_session: 'opaque-token',
    md_dashboard_identity: '{"agent":"BEN","role":"agent"}',
  });
  const makeElement = initial => ({
    className: '',
    disabled: false,
    hidden: false,
    innerHTML: '',
    style: {},
    textContent: '',
    value: '',
    ...initial,
    remove() {
      this.removed = true;
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  });
  const elements = {
    'agent-select': makeElement({ value: 'BEN' }),
    'debtor-download-menu': makeElement({ hidden: false }),
    'debtor-download-toggle': makeElement(),
    'debtor-export-filtered': makeElement({ disabled: false }),
    'debtor-export-full': makeElement({ disabled: false }),
    'debtor-filtered-export-count': makeElement({ textContent: '1' }),
    'debtor-full-export-count': makeElement({ textContent: '1' }),
    'debtor-list': makeElement(),
    'pin-gate': makeElement({ style: { display: 'flex' } }),
    'pin-name-hint': makeElement(),
  };
  for (let index = 0; index < 4; index += 1) elements[`pd${index}`] = makeElement();
  const calls = { errors: [], logout: 0 };
  let transitionVersion = 0;
  const context = {
    DATA: null,
    AVAILABLE_MONTHS: [],
    CURRENT_MONTH_SLUG: 'current',
    MONTHS_WITH_DATA: [],
    BIRTHDAY_OVERRIDES_BY_MONTH: {},
    SALES_LIVE_STATIC_CONFIG_CACHE: undefined,
    DashboardApi: {
      async login() {
        return successfulLoginEnvelope();
      },
      async logout() {
        calls.logout += 1;
        sessionStorage.removeItem('md_dashboard_session');
        sessionStorage.removeItem('md_dashboard_identity');
      },
    },
    beginDebtorExportTransition() {
      transitionVersion += 1;
      return transitionVersion;
    },
    commitDashboardEnvelope(result, options) {
      context.DATA = result.data;
      context.currentAgent = options.agent;
      context.authenticatedAgent = options.agent;
      context.authenticatedRole = options.role;
    },
    completeDebtorExportTransition() {},
    console: { warn() {} },
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    fetchAvailableMonthLabels: async () => ['Jul 26'],
    async initializeDashboardAfterCommit() {
      elements['debtor-list'].innerHTML = '<div class="debtor-card">300-SECRET</div>';
      elements['debtor-export-filtered'].disabled = false;
      elements['debtor-export-full'].disabled = false;
      elements['pin-gate'].style.display = 'none';
      throw new Error('render initialization failed');
    },
    isCurrentDebtorExportTransition(token) {
      return token === transitionVersion;
    },
    localStorage,
    monthSlug: month => String(month || '').replace(' ', '').toLowerCase(),
    openBrandPenetration: new Set(['SUKUN']),
    prepareAuthorizedInitialMonthData: async data => data,
    resetDebtorExportView() {},
    resolvePublishedBaseMonth: requestedMonth => requestedMonth,
    selectedDashboardMonth: () => 'Jul 26',
    sessionStorage,
    showPinError(message) {
      calls.errors.push(message);
    },
    updateDebtorExportMenu() {},
    updatePinDisplay() {},
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var currentAgent = null;',
    'var authenticatedAgent = null;',
    'var authenticatedRole = null;',
    'var _lastUnpurchasedExport = { sensitive: true };',
    'var _lastCampsExport = { sensitive: true };',
    "var _pin = '1001';",
    'var _pinLocked = false;',
    'var _pinAttemptSequence = 0;',
    'var _pinLockOwner = 0;',
    extractFunctionOr('clearProtectedDashboardDom', 'function clearProtectedDashboardDom() {}'),
    extractFunction('clearProtectedDashboardState'),
    extractFunction('checkPin'),
  ].join('\n'), context);

  const loggedIn = await context.checkPin();

  assert.equal(loggedIn, false);
  assert.equal(calls.logout, 1);
  assert.equal(context.DATA, null);
  assert.equal(context.currentAgent, null);
  assert.equal(context.authenticatedAgent, null);
  assert.equal(context.authenticatedRole, null);
  assert.equal(elements['debtor-list'].innerHTML, '');
  assert.equal(elements['debtor-export-filtered'].disabled, true);
  assert.equal(elements['debtor-export-full'].disabled, true);
  assert.equal(elements['pin-gate'].style.display, 'flex');
  assert.equal(localStorage.values.has('md_gist_cache'), false);
  assert.equal(sessionStorage.values.has('md_dashboard_session'), false);
  assert.deepEqual(calls.errors, ['render initialization failed']);
});


test('login superseded by a non-login transition releases its PIN lock', async () => {
  const { calls, context } = createPinRaceContext();

  const login = context.checkPin();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.login.length, 1);

  context.beginDebtorExportTransition({ kind: 'month' });
  calls.login[0].resolve(successfulLoginEnvelope());

  assert.equal(await login, false);
  assert.equal(context._pinLocked, false);
  assert.equal(context._pinLockOwner, 0);
});


test('older login completion cannot unlock a newer in-flight PIN attempt', async () => {
  const { calls, context } = createPinRaceContext();

  const olderLogin = context.checkPin();
  await new Promise(resolve => setImmediate(resolve));
  context._pin = '2002';
  const newerLogin = context.checkPin();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.login.length, 2);

  calls.login[0].resolve(successfulLoginEnvelope());
  assert.equal(await olderLogin, false);
  assert.equal(context._pinLocked, true);
  assert.equal(context._pinLockOwner, 2);

  calls.login[1].resolve(successfulLoginEnvelope());
  assert.equal(await newerLogin, true);
  assert.equal(context._pinLocked, false);
  assert.equal(context._pinLockOwner, 0);
});


test('gateway envelope commit uses returned data and locks agent identity', () => {
  const returnedData = dashboardData('Jul 26', {
    BEN: ['300-BEN'],
  });
  const context = {
    DATA: null,
    AVAILABLE_MONTHS: [],
    CURRENT_MONTH_SLUG: 'current',
    MONTHS_WITH_DATA: [],
    authenticatedAgent: null,
    authenticatedRole: null,
    currentAgent: null,
    monthSlug(month) {
      return String(month || '').replace(' ', '').toLowerCase();
    },
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var authenticatedAgent = globalThis.authenticatedAgent;',
    'var authenticatedRole = globalThis.authenticatedRole;',
    'var currentAgent = globalThis.currentAgent;',
    extractFunction('commitDashboardEnvelope'),
  ].join('\n'), context);

  context.commitDashboardEnvelope({
    month: 'Jul 26',
    availableMonths: ['Jul 26', 'Jun 26'],
    data: returnedData,
  }, {
    agent: 'BEN',
    role: 'agent',
    desiredAgent: 'CJ',
    requestedSlug: 'jul26',
  });

  assert.strictEqual(context.DATA, returnedData);
  assert.equal(context.authenticatedAgent, 'BEN');
  assert.equal(context.authenticatedRole, 'agent');
  assert.equal(context.currentAgent, 'BEN');
  assert.deepEqual(Array.from(context.AVAILABLE_MONTHS), ['Jul 26', 'Jun 26']);
  assert.deepEqual(Array.from(context.MONTHS_WITH_DATA), ['jul26', 'jun26']);
});


test('agent envelope rejects peer rows without rewriting authenticated identity', () => {
  const returnedData = dashboardData('Jul 26', {
    BEN: ['300-BEN'],
    CJ: ['300-CJ'],
  });
  const context = {
    DATA: { sensitive: true },
    AVAILABLE_MONTHS: ['Jun 26'],
    CURRENT_MONTH_SLUG: 'jun26',
    MONTHS_WITH_DATA: ['jun26'],
    authenticatedAgent: 'BEN',
    authenticatedRole: 'agent',
    currentAgent: 'BEN',
    monthSlug(month) {
      return String(month || '').replace(' ', '').toLowerCase();
    },
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var authenticatedAgent = globalThis.authenticatedAgent;',
    'var authenticatedRole = globalThis.authenticatedRole;',
    'var currentAgent = globalThis.currentAgent;',
    extractFunction('commitDashboardEnvelope'),
  ].join('\n'), context);

  assert.throws(
    () => context.commitDashboardEnvelope({
      month: 'Jul 26',
      availableMonths: ['Jul 26', 'Jun 26'],
      data: returnedData,
    }),
    /authenticated agent|agent scope/i,
  );
  assert.equal(context.DATA, null);
  assert.equal(context.currentAgent, null);
  assert.equal(context.authenticatedAgent, 'BEN');
  assert.equal(context.authenticatedRole, 'agent');

  context.DATA = { sensitive: true };
  context.currentAgent = 'BEN';
  assert.throws(
    () => context.commitDashboardEnvelope({
      month: 'Jul 26',
      availableMonths: ['Jul 26'],
      data: dashboardData('Jul 26', { CJ: ['300-CJ'] }),
    }),
    /authenticated agent|agent scope/i,
  );
  assert.equal(context.DATA, null);
  assert.equal(context.currentAgent, null);
  assert.equal(context.authenticatedAgent, 'BEN');
  assert.equal(context.authenticatedRole, 'agent');
});


test('manager envelope commit may retain an authorized agent selection', () => {
  const returnedData = dashboardData('Jul 26', {
    BEN: ['300-BEN'],
    CJ: ['300-CJ'],
  });
  const context = {
    DATA: null,
    AVAILABLE_MONTHS: [],
    CURRENT_MONTH_SLUG: 'current',
    MONTHS_WITH_DATA: [],
    authenticatedAgent: 'GT138888',
    authenticatedRole: 'manager',
    currentAgent: 'BEN',
    monthSlug(month) {
      return String(month || '').replace(' ', '').toLowerCase();
    },
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var authenticatedAgent = globalThis.authenticatedAgent;',
    'var authenticatedRole = globalThis.authenticatedRole;',
    'var currentAgent = globalThis.currentAgent;',
    extractFunction('commitDashboardEnvelope'),
  ].join('\n'), context);

  context.commitDashboardEnvelope({
    month: 'Jul 26',
    availableMonths: ['Jul 26'],
    data: returnedData,
  }, {
    desiredAgent: 'CJ',
    requestedSlug: 'jul26',
  });

  assert.equal(context.currentAgent, 'CJ');
  assert.deepEqual(Object.keys(context.DATA.agents).sort(), ['BEN', 'CJ']);
});


function createAgentSelectionContext(role) {
  const agentSelect = { value: 'BEN' };
  const context = {
    DATA: dashboardData('Jul 26', { BEN: ['300-BEN'], CJ: ['300-CJ'] }),
    CURRENT_MONTH_SLUG: 'jul26',
    authenticatedAgent: 'BEN',
    authenticatedRole: role,
    currentAgent: 'BEN',
    currentPage: 1,
    filters: {},
    openBrandPenetration: new Set(),
    beginDebtorExportTransition: () => 1,
    buildTypeChipRow() {},
    completeDebtorExportTransition() {},
    document: {
      getElementById(id) {
        return id === 'agent-select' ? agentSelect : null;
      },
      querySelectorAll() {
        return [];
      },
    },
    getDebtorExportTransition: () => null,
    renderAll() {
      context.rendered = context.currentAgent;
    },
    renderNoAgentState() {},
    resetUnpurchasedFilters() {},
    saveLastAgentSelection() {},
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var authenticatedAgent = globalThis.authenticatedAgent;',
    'var authenticatedRole = globalThis.authenticatedRole;',
    'var currentAgent = globalThis.currentAgent;',
    'var currentPage = globalThis.currentPage;',
    'var filters = globalThis.filters;',
    'var openBrandPenetration = globalThis.openBrandPenetration;',
    "var dropCtnFilter = 'all';",
    "var dropSkuFilter = 'all';",
    "var gainCtnFilter = 'all';",
    "var gainSkuFilter = 'all';",
    "var nonvipTypeFilter = 'all';",
    extractFunction('selectAgent'),
  ].join('\n'), context);
  return { agentSelect, context };
}


test('agent role cannot switch to a peer', () => {
  const { agentSelect, context } = createAgentSelectionContext('agent');

  const selected = context.selectAgent('CJ');

  assert.equal(selected, false);
  assert.equal(context.currentAgent, 'BEN');
  assert.equal(agentSelect.value, 'BEN');
  assert.equal(context.rendered, undefined);
});


test('manager role can switch agents already present in authorized data', () => {
  const { agentSelect, context } = createAgentSelectionContext('manager');

  context.selectAgent('CJ');

  assert.equal(context.currentAgent, 'CJ');
  assert.equal(agentSelect.value, 'CJ');
  assert.equal(context.rendered, 'CJ');
});


test('manager role rejects an agent absent from authorized DATA', () => {
  const { agentSelect, context } = createAgentSelectionContext('manager');

  const selected = context.selectAgent('MISSING');

  assert.equal(selected, false);
  assert.equal(context.currentAgent, 'BEN');
  assert.equal(agentSelect.value, 'BEN');
  assert.equal(context.rendered, undefined);
});


test('month race commits only the latest DashboardApi response', async () => {
  const requests = [];
  const agentSelect = {
    value: 'BEN',
    innerHTML: '',
    appendChild() {},
  };
  const elements = {
    'agent-select': agentSelect,
    'month-selector-agent': { value: 'jul26' },
    'month-badge': { textContent: '' },
    'day-prog': { textContent: '' },
  };
  let transitionVersion = 0;
  const context = {
    DATA: dashboardData('Jul 26', { BEN: ['300-JUL'] }),
    AVAILABLE_MONTHS: ['Jun 26', 'Jul 26', 'Aug 26'],
    CURRENT_MONTH_SLUG: 'jul26',
    MONTHS_WITH_DATA: ['jun26', 'jul26', 'aug26'],
    authenticatedAgent: 'BEN',
    authenticatedRole: 'agent',
    currentAgent: 'BEN',
    filters: {},
    DashboardApi: {
      loadData(month) {
        const pending = createDeferred();
        requests.push({ month, ...pending });
        return pending.promise;
      },
    },
    alert() {},
    applyBirthdayTargetsToAgentKpi() {},
    beginDebtorExportTransition() {
      transitionVersion += 1;
      return transitionVersion;
    },
    buildTypeChipRow() {},
    cleanDashboardCacheBusterParam() {},
    commitDashboardEnvelope(result, options) {
      context.DATA = result.data;
      context.CURRENT_MONTH_SLUG = options.requestedSlug;
      context.currentAgent = 'BEN';
    },
    completeDebtorExportTransition() {},
    document: {
      createElement() {
        return {};
      },
      getElementById(id) {
        return elements[id] || null;
      },
    },
    initializeDashboardAfterMonthCommit() {},
    isCurrentDebtorExportTransition(token) {
      return token === transitionVersion;
    },
    monthLabelFromSlug(slug) {
      return { jun26: 'Jun 26', aug26: 'Aug 26' }[slug] || slug;
    },
    prepareAuthorizedDashboardData: async data => data,
    renderAll() {},
    renderGroupBrandTargets() {},
    renderNoAgentState() {},
    resolveDebtorExportTransitionAgent() {
      return 'BEN';
    },
    updateDebtorExportTransitionDesiredAgent() {},
    updateFutureViewBanner() {},
    window: {},
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var authenticatedAgent = globalThis.authenticatedAgent;',
    'var authenticatedRole = globalThis.authenticatedRole;',
    'var currentAgent = globalThis.currentAgent;',
    'var filters = globalThis.filters;',
    "var dropCtnFilter = 'all';",
    "var dropSkuFilter = 'all';",
    "var gainCtnFilter = 'all';",
    "var gainSkuFilter = 'all';",
    "var nonvipTypeFilter = 'all';",
    extractFunction('switchMonth'),
  ].join('\n'), context);

  const june = context.switchMonth('jun26');
  const august = context.switchMonth('aug26');
  requests[1].resolve({
    month: 'Aug 26',
    availableMonths: context.AVAILABLE_MONTHS,
    data: dashboardData('Aug 26', { BEN: ['300-AUG'] }),
  });
  await august;
  requests[0].resolve({
    month: 'Jun 26',
    availableMonths: context.AVAILABLE_MONTHS,
    data: dashboardData('Jun 26', { BEN: ['300-STALE'] }),
  });
  await june;

  assert.deepEqual(requests.map(request => request.month), ['Jun 26', 'Aug 26']);
  assert.equal(context.DATA.current_month, 'Aug 26');
  assert.deepEqual(
    context.DATA.agents.BEN.debtor_cards.debtors.map(row => row.debtor_code),
    ['300-AUG'],
  );
});


function createPlanningBaseResolutionScenario() {
  const calls = { alerts: [], api: [], cleared: 0 };
  const priorData = dashboardData('Jun 26', { BEN: ['300-BASE'] });
  const agentSelect = {
    value: 'BEN',
    innerHTML: '',
    appendChild() {},
  };
  const elements = {
    'agent-select': agentSelect,
    'month-selector-agent': { value: 'jun26' },
    'month-badge': { textContent: '' },
    'day-prog': { textContent: '' },
  };
  let transitionVersion = 0;
  const context = {
    DATA: priorData,
    AVAILABLE_MONTHS: ['Jun 26', 'Aug 26', 'Oct 26'],
    CURRENT_MONTH_SLUG: 'jun26',
    MONTHS_WITH_DATA: ['jun26', 'aug26', 'oct26'],
    authenticatedAgent: 'BEN',
    authenticatedRole: 'agent',
    currentAgent: 'BEN',
    filters: {},
    DashboardApi: {
      async loadData(month) {
        calls.api.push(month);
        return {
          month,
          availableMonths: context.AVAILABLE_MONTHS,
          data: dashboardData(month, { BEN: [`300-${month.replace(' ', '').toUpperCase()}`] }),
        };
      },
    },
    alert(message) {
      calls.alerts.push(message);
    },
    applyBirthdayTargetsToAgentKpi() {},
    beginDebtorExportTransition() {
      transitionVersion += 1;
      return transitionVersion;
    },
    buildTypeChipRow() {},
    cleanDashboardCacheBusterParam() {},
    clearProtectedDashboardState() {
      calls.cleared += 1;
    },
    commitDashboardEnvelope(result, options) {
      context.DATA = result.data;
      context.CURRENT_MONTH_SLUG = options.requestedSlug;
      context.currentAgent = 'BEN';
    },
    completeDebtorExportTransition() {},
    document: {
      createElement() {
        return {};
      },
      getElementById(id) {
        return elements[id] || null;
      },
    },
    isCurrentDebtorExportTransition(token) {
      return token === transitionVersion;
    },
    isDashboardAuthorizationError: () => false,
    latestAvailableMonth(months, fallback) {
      return months[months.length - 1] || fallback;
    },
    resolvePublishedBaseMonth(_requestedMonth, months) {
      return months[months.length - 1];
    },
    monthLabelFromSlug(slug) {
      return { may26: 'May 26', sep26: 'Sep 26' }[slug] || slug;
    },
    monthSlug(month) {
      return String(month || '').replace(' ', '').toLowerCase();
    },
    prepareAuthorizedDashboardData: async data => data,
    renderAll() {},
    renderGroupBrandTargets() {},
    renderNoAgentState() {},
    retainFutureGeneratedCampaignFallbacks(data) {
      return data;
    },
    resolveDebtorExportTransitionAgent() {
      return 'BEN';
    },
    structuredClone(value) {
      return JSON.parse(JSON.stringify(value));
    },
    updateDebtorExportTransitionDesiredAgent() {},
    updateFutureViewBanner() {},
    window: {},
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var authenticatedAgent = globalThis.authenticatedAgent;',
    'var authenticatedRole = globalThis.authenticatedRole;',
    'var currentAgent = globalThis.currentAgent;',
    'var filters = globalThis.filters;',
    "var dropCtnFilter = 'all';",
    "var dropSkuFilter = 'all';",
    "var gainCtnFilter = 'all';",
    "var gainSkuFilter = 'all';",
    "var nonvipTypeFilter = 'all';",
    extractFunction('monthSortKey'),
    extractFunction('resolvePublishedBaseMonth'),
    extractFunction('switchMonth'),
  ].join('\n'), context);
  return { calls, context, priorData };
}


test('future planning loads the greatest published month not after the request', async () => {
  const { calls, context } = createPlanningBaseResolutionScenario();

  await context.switchMonth('sep26');

  assert.deepEqual(calls.api, ['Aug 26']);
  assert.equal(context.DATA.current_month, 'Sep 26');
  assert.equal(context.DATA.is_future_view, true);
  assert.equal(context.CURRENT_MONTH_SLUG, 'sep26');
});


test('future planning before every published month fails without loading or relabeling later data', async () => {
  const { calls, context, priorData } = createPlanningBaseResolutionScenario();

  await context.switchMonth('may26');

  assert.deepEqual(calls.api, []);
  assert.strictEqual(context.DATA, priorData);
  assert.equal(context.DATA.current_month, 'Jun 26');
  assert.equal(context.CURRENT_MONTH_SLUG, 'jun26');
  assert.equal(calls.alerts.length, 1);
  assert.match(calls.alerts[0], /at or before May 26/i);
  assert.equal(calls.cleared, 0);
});


function createFuturePlanningScenario(options = {}) {
  const rejectLiveCampaignFetch = options.rejectLiveCampaignFetch === true;
  const syncMonths = {
    api: [],
    birthday: [],
    campaignFetches: 0,
    claims: [],
    kpi: [],
    warnings: [],
  };
  let generation = 0;
  let transitionVersion = 0;
  const generatedCampaigns = () => [
    {
      id: 'jun-only',
      name: 'June Only Generated Campaign',
      source: 'generated_json',
      start_date: '2025-01-01',
      deadline: '2026-06-30',
    },
    {
      id: 'summer-fallback',
      name: 'Generated July Fallback',
      source: 'generated_json',
      start_date: '2025-01-01',
      deadline: '2026-07-31',
    },
  ];
  const freshBaseData = () => {
    generation += 1;
    const data = dashboardData('Jun 26', { BEN: ['300-BEN'] });
    data.generation = generation;
    data.campaigns = generatedCampaigns();
    data.agents.BEN.debtor_cards.debtors[0].campaigns = generatedCampaigns().map(campaign => ({
      ...campaign,
      lookback_ctn: campaign.id === 'summer-fallback' ? 7 : 3,
    }));
    return data;
  };
  const staleData = freshBaseData();
  staleData.generation = 'stale';
  const agentSelect = {
    value: 'BEN',
    innerHTML: '',
    appendChild() {},
  };
  const elements = {
    'agent-select': agentSelect,
    'month-selector-agent': { value: 'jun26' },
    'month-badge': { textContent: '' },
    'day-prog': { textContent: '' },
  };
  const context = {
    DATA: staleData,
    AVAILABLE_MONTHS: ['Jun 26'],
    CURRENT_MONTH_SLUG: 'jun26',
    MONTHS_WITH_DATA: ['jun26'],
    authenticatedAgent: 'BEN',
    authenticatedRole: 'agent',
    currentAgent: 'BEN',
    filters: {},
    DashboardApi: {
      async loadData(month) {
        syncMonths.api.push(month);
        return {
          month,
          availableMonths: ['Jun 26'],
          data: freshBaseData(),
        };
      },
    },
    GistSync: {
      isConfigured: () => true,
      async syncToLocal(month) {
        syncMonths.claims.push(month);
      },
    },
    SupabaseKpiSync: {
      async apply(data) {
        syncMonths.kpi.push(data.current_month);
      },
    },
    alert() {},
    applyBirthdayTargetsToAgentKpi() {},
    applySalesLiveStaticConfig: async data => data,
    beginDebtorExportTransition() {
      transitionVersion += 1;
      return transitionVersion;
    },
    buildTypeChipRow() {},
    cleanDashboardCacheBusterParam() {},
    clearDashboardDataCaches() {},
    completeDebtorExportTransition() {},
    console: {
      log() {},
      warn(message) {
        syncMonths.warnings.push(String(message));
      },
    },
    document: {
      createElement() {
        return {};
      },
      getElementById(id) {
        return elements[id] || null;
      },
    },
    enrichMonthBreakdownsFromAnalysis: async data => data,
    async ensureBirthdayOverridesForMonth(month) {
      syncMonths.birthday.push(month);
    },
    isCurrentDebtorExportTransition(token) {
      return token === transitionVersion;
    },
    async fetchLiveCampaignDataForSales() {
      syncMonths.campaignFetches += 1;
      if (rejectLiveCampaignFetch) throw new Error('live campaign network down');
      return {
        campaigns: [{
          id: 'summer-fallback',
          name: 'Live July Campaign',
          active: true,
          start_date: '2025-01-01',
          deadline: '2026-07-31',
          debtors: [{
            debtor_code: '300-BEN',
            debtor_name: 'Authorized Debtor',
            agent: 'BEN',
            lookback_ctn: 0,
            current_ctn: 1,
          }],
        }],
      };
    },
    latestAvailableMonth(months, fallback) {
      return months[months.length - 1] || fallback;
    },
    monthLabelFromSlug(slug) {
      return { jun26: 'Jun 26', jul26: 'Jul 26' }[slug] || slug;
    },
    monthSlug(month) {
      return String(month || '').replace(' ', '').toLowerCase();
    },
    refreshIfStaleDashboardVersion: async () => false,
    renderAll() {},
    renderGroupBrandTargets() {},
    renderNoAgentState() {},
    resetUnpurchasedFilters() {},
    resolvePublishedBaseMonth(_requestedMonth, months) {
      return months[months.length - 1];
    },
    resolveDebtorExportTransitionAgent() {
      return 'BEN';
    },
    setRefreshButtonState() {},
    structuredClone(value) {
      return JSON.parse(JSON.stringify(value));
    },
    updateDebtorExportTransitionDesiredAgent() {},
    updateFutureViewBanner() {},
    updateSyncStatus() {},
    window: {
      MDAdminContext: {
        setWorkingMonth() {},
      },
    },
    MDAdminContext: {
      setWorkingMonth() {},
    },
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var authenticatedAgent = globalThis.authenticatedAgent;',
    'var authenticatedRole = globalThis.authenticatedRole;',
    'var currentAgent = globalThis.currentAgent;',
    'var filters = globalThis.filters;',
    "var dropCtnFilter = 'all';",
    "var dropSkuFilter = 'all';",
    "var gainCtnFilter = 'all';",
    "var gainSkuFilter = 'all';",
    "var nonvipTypeFilter = 'all';",
    extractFunction('isCampaignActiveInMonth'),
    extractFunction('monthLabelToIso'),
    extractFunction('isHistoricalMonth'),
    extractFunction('shouldIncludeLiveCampaignForSales'),
    extractFunction('salesDebtorRecordToCard'),
    extractFunction('salesCampaignEntryFromDebtor'),
    extractFunction('mergeSalesCampaignEntry'),
    extractFunction('mergeLiveCampaignsIntoSalesData'),
    extractIife('SalesLiveCampaignSync'),
    extractFunction('retainFutureGeneratedCampaignFallbacks'),
    extractFunction('prepareAuthorizedDashboardData'),
    extractFunction('commitDashboardEnvelope'),
    extractFunction('switchMonth'),
    extractFunction('forceRefreshDashboard'),
  ].join('\n'), context);

  return { context, syncMonths };
}


test('future planning merges live campaigns over the selected-month generated fallback', async () => {
  const { context, syncMonths } = createFuturePlanningScenario();

  await context.switchMonth('jul26');

  assert.deepEqual(syncMonths.api, ['Jun 26']);
  assert.equal(context.DATA.generation, 2);
  assert.equal(context.DATA.current_month, 'Jul 26');
  assert.equal(context.DATA.is_future_view, true);
  assert.deepEqual(
    Array.from(context.DATA.campaigns, campaign => campaign.id),
    ['summer-fallback'],
  );
  assert.equal(context.DATA.campaigns[0].name, 'Live July Campaign');
  assert.deepEqual(
    Array.from(
      context.DATA.agents.BEN.debtor_cards.debtors[0].campaigns,
      campaign => campaign.id,
    ),
    ['summer-fallback'],
  );
  assert.equal(
    context.DATA.agents.BEN.debtor_cards.debtors[0].campaigns[0].source,
    'live_supabase',
  );
  assert.equal(
    context.DATA.agents.BEN.debtor_cards.debtors[0].campaigns[0].lookback_ctn,
    7,
    'Successful live merge should preserve generated fallback metrics',
  );
  assert.deepEqual(syncMonths.kpi, ['Jul 26']);
  assert.deepEqual(syncMonths.birthday, ['Jul 26']);
  assert.equal(syncMonths.campaignFetches, 1);
  assert.deepEqual(syncMonths.claims, ['Jul 26']);

  await context.forceRefreshDashboard();

  assert.deepEqual(syncMonths.api, ['Jun 26', 'Jun 26']);
  assert.equal(context.DATA.generation, 3);
  assert.equal(context.DATA.current_month, 'Jul 26');
  assert.deepEqual(
    Array.from(context.DATA.campaigns, campaign => campaign.id),
    ['summer-fallback'],
  );
  assert.deepEqual(
    Array.from(
      context.DATA.agents.BEN.debtor_cards.debtors[0].campaigns,
      campaign => campaign.id,
    ),
    ['summer-fallback'],
  );
  assert.equal(
    context.DATA.agents.BEN.debtor_cards.debtors[0].campaigns[0].lookback_ctn,
    7,
  );
  assert.deepEqual(syncMonths.kpi, ['Jul 26', 'Jul 26']);
  assert.deepEqual(syncMonths.birthday, ['Jul 26', 'Jul 26']);
  assert.equal(syncMonths.campaignFetches, 2);
  assert.deepEqual(syncMonths.claims, ['Jul 26', 'Jul 26']);
  assert.deepEqual(syncMonths.warnings, []);
});


test('future planning retains selected-month generated campaigns when live fetch rejects', async () => {
  const { context, syncMonths } = createFuturePlanningScenario({
    rejectLiveCampaignFetch: true,
  });

  await context.switchMonth('jul26');

  assert.deepEqual(syncMonths.api, ['Jun 26']);
  assert.equal(syncMonths.campaignFetches, 1);
  assert.equal(context.DATA.generation, 2);
  assert.equal(context.DATA.current_month, 'Jul 26');
  assert.equal(context.DATA.is_future_view, true);
  assert.deepEqual(
    Array.from(context.DATA.campaigns, campaign => campaign.id),
    ['summer-fallback'],
  );
  assert.equal(context.DATA.campaigns[0].name, 'Generated July Fallback');
  assert.deepEqual(
    Array.from(
      context.DATA.agents.BEN.debtor_cards.debtors[0].campaigns,
      campaign => campaign.id,
    ),
    ['summer-fallback'],
  );
  assert.equal(
    context.DATA.agents.BEN.debtor_cards.debtors[0].campaigns[0].source,
    'generated_json',
  );
  assert.equal(
    context.DATA.agents.BEN.debtor_cards.debtors[0].campaigns[0].lookback_ctn,
    7,
  );
  assert.deepEqual(syncMonths.kpi, ['Jul 26']);
  assert.deepEqual(syncMonths.birthday, ['Jul 26']);
  assert.deepEqual(syncMonths.claims, ['Jul 26']);
  assert.equal(syncMonths.warnings.length, 1);
  assert.match(syncMonths.warnings[0], /keeping generated JSON only/);
});


test('DashboardApi authorization failure clears session, protected state, DOM, and exports', async () => {
  const priorData = dashboardData('Jun 26', { BEN: ['300-SECRET'] });
  const localStorage = createStorage({
    md_gist_cache: '{"sensitive":true}',
    camp_claim_Jun26_BEN_camp_300_SECRET: '{"sensitive":true}',
  });
  const sessionStorage = createStorage({
    md_dashboard_session: 'expired-token',
    md_dashboard_identity: '{"agent":"BEN","role":"agent"}',
  });
  const makeElement = initial => ({
    disabled: false,
    hidden: false,
    innerHTML: '',
    style: {},
    textContent: '',
    value: '',
    ...initial,
    appendChild() {},
    remove() {
      this.removed = true;
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  });
  const elements = {
    'agent-select': makeElement({ value: 'BEN' }),
    'debtor-download-menu': makeElement({ hidden: false }),
    'debtor-download-toggle': makeElement(),
    'debtor-export-filtered': makeElement({ disabled: false }),
    'debtor-export-full': makeElement({ disabled: false }),
    'debtor-list': makeElement({ innerHTML: '<div class="debtor-card">300-SECRET</div>' }),
    'month-badge': makeElement({ textContent: 'JUN 26' }),
    'month-selector-agent': makeElement({ value: 'jun26' }),
    'day-prog': makeElement({ textContent: 'Day 1 of 20' }),
    'pin-gate': makeElement({ style: { display: 'none' } }),
    'pin-name-hint': makeElement({ textContent: 'BEN' }),
    'flag-note': makeElement({ value: 'private transfer note for 300-SECRET' }),
    'flag-submit-btn': makeElement({ disabled: false }),
    'camps-filter-bar': makeElement({ innerHTML: '<span>Filter:</span><button>SECRET CAMPAIGN</button>' }),
    'type-filter-row': makeElement({ innerHTML: '<span>Type:</span><button>SECRET TYPE (99)</button>' }),
    'event-input': makeElement({ value: '48' }),
    'event-target-hint': makeElement({ textContent: 'Monthly target: 50 phone numbers' }),
    'bday-target-display': makeElement({ textContent: '12' }),
    'bday-actual-input': makeElement({ value: '7' }),
  };
  const makeOpenOverlay = () => {
    const overlay = makeElement();
    overlay.classList = {
      remove(name) {
        if (name === 'open') overlay.closed = true;
      },
    };
    return overlay;
  };
  elements['event-sheet-overlay'] = makeOpenOverlay();
  elements['bday-sheet-overlay'] = makeOpenOverlay();
  const protectedOverlays = [makeElement(), makeElement(), makeElement()];
  const protectedPanelIds = [
    'tier-cards',
    'monthly-personal-card',
    'sku-trend-table',
    'brand-cards',
    'newbie-content',
    'aging-content',
    'group-content',
    'kpi-content',
    'camps-content',
    'cd-list',
    'ctn-tt-items',
  ];
  protectedPanelIds.forEach(id => {
    elements[id] = makeElement({ innerHTML: `<div>${id}-300-SECRET-+601234-INVOICE-9</div>` });
  });
  const calls = { alerts: [], api: [], errors: [], logout: 0, render: 0 };
  let transitionVersion = 0;
  const context = {
    DATA: priorData,
    AVAILABLE_MONTHS: ['Jun 26', 'Jul 26'],
    CURRENT_MONTH_SLUG: 'jun26',
    MONTHS_WITH_DATA: ['jun26', 'jul26'],
    authenticatedAgent: 'BEN',
    authenticatedRole: 'agent',
    currentAgent: 'BEN',
    filters: {},
    BIRTHDAY_OVERRIDES_BY_MONTH: {},
    SALES_LIVE_STATIC_CONFIG_CACHE: undefined,
    DashboardApi: {
      async loadData(month) {
        calls.api.push(month);
        const error = new Error('session rejected');
        error.status = 403;
        error.code = 'access_denied';
        throw error;
      },
      async logout() {
        calls.logout += 1;
        sessionStorage.removeItem('md_dashboard_session');
        sessionStorage.removeItem('md_dashboard_identity');
      },
    },
    alert(message) {
      calls.alerts.push(message);
    },
    applyBirthdayTargetsToAgentKpi() {},
    beginDebtorExportTransition() {
      transitionVersion += 1;
      return transitionVersion;
    },
    buildTypeChipRow() {},
    cleanDashboardCacheBusterParam() {},
    completeDebtorExportTransition() {},
    console: { warn() {} },
    document: {
      createElement() {
        return makeElement();
      },
      getElementById(id) {
        return elements[id] || null;
      },
      querySelectorAll(selector) {
        return selector === '[data-protected-agent-overlay="true"]' ? protectedOverlays : [];
      },
    },
    isCurrentDebtorExportTransition(token) {
      return token === transitionVersion;
    },
    localStorage,
    monthLabelFromSlug: () => 'Jul 26',
    openBrandPenetration: new Set(['SUKUN']),
    renderAll() {
      calls.render += 1;
    },
    renderGroupBrandTargets() {},
    renderNoAgentState() {},
    resetDebtorExportView() {},
    resolveDebtorExportTransitionAgent() {
      return 'BEN';
    },
    sessionStorage,
    showPinError(message) {
      calls.errors.push(message);
    },
    updateDebtorExportMenu() {},
    updateDebtorExportTransitionDesiredAgent() {},
    updateFutureViewBanner() {},
    window: {
      _ctnBreakdowns: {
        BEN_300_SECRET: {
          'Jul 26': [{ item: 'SKNR', ctn: 3, amount: 123, agent: 'BEN' }],
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var authenticatedAgent = globalThis.authenticatedAgent;',
    'var authenticatedRole = globalThis.authenticatedRole;',
    'var currentAgent = globalThis.currentAgent;',
    'var filters = globalThis.filters;',
    'var _lastUnpurchasedExport = { sensitive: true };',
    'var _lastCampsExport = { sensitive: true };',
    'var _campDetailDebtor = "300-SECRET";',
    "var _pin = '';",
    'var _pinLocked = false;',
    'var _pinLockOwner = 0;',
    "var dropCtnFilter = 'all';",
    "var dropSkuFilter = 'all';",
    "var gainCtnFilter = 'all';",
    "var gainSkuFilter = 'all';",
    "var nonvipTypeFilter = 'all';",
    extractFunctionOr('clearProtectedDashboardDom', 'function clearProtectedDashboardDom() {}'),
    extractFunction('clearProtectedDashboardState'),
    extractFunctionOr(
      'isDashboardAuthorizationError',
      'function isDashboardAuthorizationError(error) { return [401, 403].includes(Number(error && error.status)); }',
    ),
    extractFunction('switchMonth'),
  ].join('\n'), context);

  await context.switchMonth('jul26');

  assert.deepEqual(calls.api, ['Jul 26']);
  assert.equal(calls.logout, 1);
  assert.equal(calls.render, 0);
  assert.deepEqual(calls.alerts, []);
  assert.deepEqual(calls.errors, ['session rejected']);
  assert.equal(context.DATA, null);
  assert.equal(context.currentAgent, null);
  assert.equal(context.authenticatedAgent, null);
  assert.equal(context.authenticatedRole, null);
  assert.equal(elements['debtor-list'].innerHTML, '');
  protectedPanelIds.forEach(id => {
    assert.equal(elements[id].innerHTML, '', `${id} should be scrubbed after authorization failure`);
  });
  assert.equal(elements['debtor-export-filtered'].disabled, true);
  assert.equal(elements['debtor-export-full'].disabled, true);
  assert.equal(elements['pin-gate'].style.display, 'flex');
  assert.equal(elements['pin-name-hint'].textContent, '');
  assert.equal(elements['flag-note'].value, '');
  assert.equal(elements['flag-submit-btn'].disabled, true);
  assert.doesNotMatch(elements['camps-filter-bar'].innerHTML, /SECRET/);
  assert.doesNotMatch(elements['type-filter-row'].innerHTML, /SECRET|\(99\)/);
  assert.equal(elements['event-input'].value, '');
  assert.equal(elements['event-target-hint'].textContent, '');
  assert.equal(elements['bday-target-display'].textContent, '');
  assert.equal(elements['bday-actual-input'].value, '');
  assert.equal(elements['event-sheet-overlay'].closed, true);
  assert.equal(elements['bday-sheet-overlay'].closed, true);
  assert.equal(context.window._ctnBreakdowns, undefined);
  assert.equal(vm.runInContext('_campDetailDebtor', context), null);
  protectedOverlays.forEach(overlay => assert.equal(overlay.removed, true));
  assert.equal(localStorage.values.has('md_gist_cache'), false);
  assert.equal(sessionStorage.values.has('md_dashboard_session'), false);
});


test('failed DashboardApi month request never invokes generic fetch', async () => {
  const priorData = dashboardData('Jun 26', { BEN: ['300-OLD'] });
  const agentSelect = {
    value: 'BEN',
    innerHTML: '',
    appendChild() {},
  };
  const elements = {
    'agent-select': agentSelect,
    'month-selector-agent': { value: 'jun26' },
    'month-badge': { textContent: '' },
    'day-prog': { textContent: '' },
  };
  let apiCalls = 0;
  let clearCalls = 0;
  let genericFetchCalls = 0;
  let logoutCalls = 0;
  let transitionVersion = 0;
  const context = {
    DATA: priorData,
    AVAILABLE_MONTHS: ['Jun 26'],
    CURRENT_MONTH_SLUG: 'jun26',
    MONTHS_WITH_DATA: ['jun26'],
    authenticatedAgent: 'BEN',
    authenticatedRole: 'agent',
    currentAgent: 'BEN',
    filters: {},
    DashboardApi: {
      async loadData() {
        apiCalls += 1;
        const error = new Error('gateway unavailable');
        error.status = 0;
        error.code = 'network_error';
        throw error;
      },
      async logout() {
        logoutCalls += 1;
      },
    },
    alert() {},
    applyBirthdayTargetsToAgentKpi() {},
    beginDebtorExportTransition() {
      transitionVersion += 1;
      return transitionVersion;
    },
    buildTypeChipRow() {},
    cleanDashboardCacheBusterParam() {},
    clearProtectedDashboardState() {
      clearCalls += 1;
    },
    completeDebtorExportTransition() {},
    document: {
      createElement() {
        return {};
      },
      getElementById(id) {
        return elements[id] || null;
      },
    },
    fetch() {
      genericFetchCalls += 1;
      throw new Error('generic fetch must not run');
    },
    isCurrentDebtorExportTransition(token) {
      return token === transitionVersion;
    },
    isDashboardAuthorizationError(error) {
      return [401, 403].includes(Number(error?.status));
    },
    monthLabelFromSlug: () => 'Jun 26',
    renderAll() {},
    renderGroupBrandTargets() {},
    renderNoAgentState() {},
    resetUnpurchasedFilters() {},
    resolveDebtorExportTransitionAgent() {
      return 'BEN';
    },
    updateDebtorExportTransitionDesiredAgent() {},
    updateFutureViewBanner() {},
    window: {},
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var authenticatedAgent = globalThis.authenticatedAgent;',
    'var authenticatedRole = globalThis.authenticatedRole;',
    'var currentAgent = globalThis.currentAgent;',
    'var filters = globalThis.filters;',
    "var dropCtnFilter = 'all';",
    "var dropSkuFilter = 'all';",
    "var gainCtnFilter = 'all';",
    "var gainSkuFilter = 'all';",
    "var nonvipTypeFilter = 'all';",
    extractFunction('switchMonth'),
  ].join('\n'), context);

  await context.switchMonth('jun26');

  assert.equal(apiCalls, 1);
  assert.equal(clearCalls, 0);
  assert.equal(genericFetchCalls, 0);
  assert.equal(logoutCalls, 0);
  assert.strictEqual(context.DATA, priorData);
  assert.equal(context.currentAgent, 'BEN');
  assert.equal(context.authenticatedAgent, 'BEN');
  assert.equal(context.authenticatedRole, 'agent');
});


test('logout clears API session and protected dashboard state', async () => {
  const removed = [];
  const localStorage = {
    values: new Map([
      ['md_sales_selected_agent', 'BEN'],
      ['md_gist_cache', '{"sensitive":true}'],
      ['camp_claim_Jul26_BEN_camp_300-A', '{"sensitive":true}'],
      ['touro_debtor_flags', '{"BEN":{"300-A":true}}'],
      ['kpi_manual', '{"BEN":{"event":1}}'],
      ['unrelated_preference', 'keep'],
    ]),
    get length() {
      return this.values.size;
    },
    key(index) {
      return [...this.values.keys()][index] ?? null;
    },
    removeItem(key) {
      removed.push(key);
      this.values.delete(key);
    },
  };
  const sessionStorage = {
    values: new Map([
      ['md_auth', '1'],
      ['md_agent', 'BEN'],
    ]),
    removeItem(key) {
      this.values.delete(key);
    },
  };
  const protectedPanelIds = [
    'tier-cards',
    'monthly-personal-card',
    'sku-trend-table',
    'brand-cards',
    'newbie-content',
    'aging-content',
    'group-content',
    'kpi-content',
    'camps-content',
    'cd-list',
    'ctn-tt-items',
  ];
  const elements = Object.fromEntries(protectedPanelIds.map(id => [id, {
    innerHTML: `<div>${id}-300-LOGOUT-+609999-INVOICE-77</div>`,
    style: {},
  }]));
  elements['debtor-list'] = { innerHTML: '<div>300-LOGOUT</div>', style: {} };
  elements['pin-gate'] = { style: { display: 'none' } };
  const context = {
    DATA: { sensitive: true },
    AVAILABLE_MONTHS: ['Jul 26'],
    CURRENT_MONTH_SLUG: 'jul26',
    MONTHS_WITH_DATA: ['jul26'],
    authenticatedAgent: 'BEN',
    authenticatedRole: 'agent',
    currentAgent: 'BEN',
    BIRTHDAY_OVERRIDES_BY_MONTH: { 'Jul 26': [{ debtor: '300-A' }] },
    SALES_LIVE_STATIC_CONFIG_CACHE: { zlb_brands: ['SUKUN'] },
    DashboardApi: {
      async logout() {
        context.loggedOut = true;
      },
    },
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    localStorage,
    sessionStorage,
    location: {
      reload() {
        context.reloaded = true;
      },
    },
    resetDebtorExportView() {},
  };
  vm.createContext(context);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var authenticatedAgent = globalThis.authenticatedAgent;',
    'var authenticatedRole = globalThis.authenticatedRole;',
    'var currentAgent = globalThis.currentAgent;',
    'var BIRTHDAY_OVERRIDES_BY_MONTH = globalThis.BIRTHDAY_OVERRIDES_BY_MONTH;',
    'var SALES_LIVE_STATIC_CONFIG_CACHE = globalThis.SALES_LIVE_STATIC_CONFIG_CACHE;',
    'var debtorExportTransitionVersion = 4;',
    'var debtorExportPendingTransition = { token: 4, kind: "month" };',
    "var _pin = '1001';",
    'var _pinLocked = true;',
    'var _pinLockOwner = 1;',
    extractFunction('clearProtectedDashboardDom'),
    extractFunction('clearProtectedDashboardState'),
    extractFunction('doAgentLogout'),
  ].join('\n'), context);

  await context.doAgentLogout();

  assert.equal(context.loggedOut, true);
  assert.equal(context.DATA, null);
  assert.equal(context.currentAgent, null);
  assert.equal(context.authenticatedAgent, null);
  assert.equal(context.authenticatedRole, null);
  assert.deepEqual(Array.from(context.AVAILABLE_MONTHS), []);
  assert.equal(localStorage.values.has('md_gist_cache'), false);
  assert.equal(localStorage.values.has('camp_claim_Jul26_BEN_camp_300-A'), false);
  assert.equal(localStorage.values.has('touro_debtor_flags'), false);
  assert.equal(localStorage.values.has('kpi_manual'), false);
  assert.equal(localStorage.values.get('unrelated_preference'), 'keep');
  assert.deepEqual(JSON.parse(JSON.stringify(context.BIRTHDAY_OVERRIDES_BY_MONTH)), {});
  assert.equal(context.SALES_LIVE_STATIC_CONFIG_CACHE, undefined);
  assert.equal(sessionStorage.values.has('md_auth'), false);
  assert.equal(sessionStorage.values.has('md_agent'), false);
  assert.equal(context.reloaded, true);
  assert.equal(elements['debtor-list'].innerHTML, '');
  protectedPanelIds.forEach(id => {
    assert.equal(elements[id].innerHTML, '', `${id} should be scrubbed after logout`);
  });
  assert.equal(vm.runInContext('debtorExportPendingTransition', context), null);
  assert.equal(vm.runInContext('debtorExportTransitionVersion', context), 5);
});


test('logout invalidates pending month transitions so late resolve or reject cannot restore protected data', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const request = createDeferred();
    const elements = {
      'agent-select': { value: 'BEN' },
      'month-selector-agent': { value: 'jun26', style: {} },
      'debtor-list': { innerHTML: '<div>300-RACE-SECRET</div>', style: {} },
      'aging-content': { innerHTML: '<div>300-RACE +601111 INV-123</div>', style: {} },
      'debtor-export-filtered': { disabled: false },
      'debtor-export-full': { disabled: false },
      'pin-gate': { style: { display: 'none' } },
    };
    let renderCalls = 0;
    const context = {
      DATA: dashboardData('Jun 26', { BEN: ['300-RACE-SECRET'] }),
      AVAILABLE_MONTHS: ['Jun 26', 'Jul 26'],
      CURRENT_MONTH_SLUG: 'jun26',
      MONTHS_WITH_DATA: ['jun26', 'jul26'],
      authenticatedAgent: 'BEN',
      authenticatedRole: 'agent',
      currentAgent: 'BEN',
      filters: {},
      BIRTHDAY_OVERRIDES_BY_MONTH: {},
      SALES_LIVE_STATIC_CONFIG_CACHE: undefined,
      DashboardApi: {
        loadData() {
          return request.promise;
        },
        async logout() {},
      },
      console: { warn() {} },
      document: {
        getElementById(id) {
          return elements[id] || null;
        },
      },
      localStorage: createStorage(),
      location: { reload() {} },
      monthLabelFromSlug: () => 'Jul 26',
      openBrandPenetration: new Set(),
      renderAll() {
        renderCalls += 1;
      },
      resetDebtorExportView() {},
      sessionStorage: createStorage(),
      updateDebtorExportMenu() {},
      window: {},
    };
    vm.createContext(context);
    vm.runInContext([
      'var DATA = globalThis.DATA;',
      'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
      'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
      'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
      'var authenticatedAgent = globalThis.authenticatedAgent;',
      'var authenticatedRole = globalThis.authenticatedRole;',
      'var currentAgent = globalThis.currentAgent;',
      'var filters = globalThis.filters;',
      'var debtorExportTransitionVersion = 0;',
      'var debtorExportPendingTransition = null;',
      'var debtorExportViewState = {};',
      'var _lastUnpurchasedExport = null;',
      'var _lastCampsExport = null;',
      "var _pin = '';",
      'var _pinLocked = false;',
      'var _pinLockOwner = 0;',
      "var dropCtnFilter = 'all';",
      "var dropSkuFilter = 'all';",
      "var gainCtnFilter = 'all';",
      "var gainSkuFilter = 'all';",
      "var nonvipTypeFilter = 'all';",
      extractFunction('createEmptyDebtorExportViewState'),
      extractFunction('beginDebtorExportTransition'),
      extractFunction('getDebtorExportTransition'),
      extractFunction('updateDebtorExportTransitionDesiredAgent'),
      extractFunction('resolveDebtorExportTransitionAgent'),
      extractFunction('isDebtorExportTransitionPending'),
      extractFunction('isCurrentDebtorExportTransition'),
      extractFunction('completeDebtorExportTransition'),
      extractFunction('clearProtectedDashboardDom'),
      extractFunction('clearProtectedDashboardState'),
      extractFunction('doAgentLogout'),
      extractFunction('switchMonth'),
    ].join('\n'), context);

    const monthPromise = context.switchMonth('jul26');
    await Promise.resolve();
    await context.doAgentLogout();
    if (outcome === 'resolve') {
      request.resolve({
        month: 'Jul 26',
        availableMonths: ['Jun 26', 'Jul 26'],
        data: dashboardData('Jul 26', { BEN: ['300-LATE-SECRET'] }),
      });
    } else {
      request.reject(new Error('late network failure'));
    }
    await monthPromise;

    assert.equal(context.DATA, null, `${outcome}: protected DATA must stay cleared`);
    assert.equal(context.currentAgent, null, `${outcome}: agent must stay cleared`);
    assert.equal(elements['debtor-list'].innerHTML, '', `${outcome}: debtor DOM must stay cleared`);
    assert.equal(elements['aging-content'].innerHTML, '', `${outcome}: aging DOM must stay cleared`);
    assert.equal(elements['debtor-export-filtered'].disabled, true, `${outcome}: filtered export must stay disabled`);
    assert.equal(elements['debtor-export-full'].disabled, true, `${outcome}: full export must stay disabled`);
    assert.equal(renderCalls, 0, `${outcome}: stale transition must not render`);
    assert.equal(context.isDebtorExportTransitionPending(), false, `${outcome}: transition must stay invalidated`);
  }
});
