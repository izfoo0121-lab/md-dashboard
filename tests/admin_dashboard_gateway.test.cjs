const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

function extractFunction(name) {
  const markers = [`function ${name}(`, `async function ${name}(`];
  const starts = markers.map(marker => html.indexOf(marker)).filter(index => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
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

test('Admin loads the shared gateway client and has no browser-side auth fallback', () => {
  assert.match(html, /<script\s+src=["']dashboard_api\.js["']/i);
  assert.doesNotMatch(html, /const\s+ADMIN_PW\b/);
  assert.doesNotMatch(html, /DEFAULT_AGENT_PINS|DEFAULT_PINS/);
  assert.doesNotMatch(html, /rest\/v1\/agent_pins/i);
  assert.doesNotMatch(html, /fetch\s*\(\s*[`'"]dashboard_data\.json/i);
  assert.doesNotMatch(html, /fetch\s*\(\s*[`'"]data_\$\{/i);
  assert.doesNotMatch(html, /fetch\s*\(\s*[`'"]targets\.json/i);
});

test('Admin login and restored sessions require a manager identity before rendering', () => {
  const login = extractFunction('doLogin');
  const boot = extractFunction('bootAdminDashboard');

  assert.match(login, /DashboardApi\.login\(/);
  assert.match(login, /role\s*!==\s*['"]manager['"]/);
  assert.match(login, /await\s+logout\(/);
  assert.match(login, /await\s+initAdmin\(/);

  assert.match(boot, /DashboardApi\.restoreSession\(/);
  assert.match(boot, /identity\.role\s*!==\s*['"]manager['"]/);
  assert.match(boot, /DashboardApi\.loadData\(/);
  assert.match(boot, /authorizedEnvelope\.role\s*!==\s*['"]manager['"]/);
  assert.match(boot, /await\s+initAdmin\(/);
});

test('Agent credentials cannot initialize Admin and their temporary session is closed', async () => {
  const calls = { initialized: 0, directLogout: 0, terminalLogout: 0, errors: [] };
  const elements = {
    'pw-input': { value: '1001' },
    'login-screen': { style: { display: 'flex' } },
    'main-app': { style: { display: 'none' } },
  };
  const context = {
    DashboardApi: {
      async login() {
        return { agent: 'BEN', role: 'agent', data: { sensitive: true } };
      },
      async logout() {
        calls.directLogout += 1;
      },
    },
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    getAdminRequestedMonth: () => 'Jul 26',
    async initAdmin() {
      calls.initialized += 1;
    },
    clearAdminProtectedState() {},
    async logout() {
      calls.terminalLogout += 1;
    },
    setAdminLoginBusy() {},
    showAdminApp() {
      elements['main-app'].style.display = 'block';
    },
    showAdminLoginError(message) {
      calls.errors.push(message);
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `var ADMIN_LOGIN_IN_FLIGHT = false;\n${extractFunction('doLogin')}`,
    context,
  );

  const result = await context.doLogin();

  assert.equal(result, false);
  assert.equal(calls.terminalLogout, 1);
  assert.equal(calls.directLogout, 0);
  assert.equal(calls.initialized, 0);
  assert.equal(elements['main-app'].style.display, 'none');
  assert.match(calls.errors.join(' '), /manager/i);
});

test('tampered cached manager metadata cannot pass server-verified Admin boot', async () => {
  const calls = { initialized: 0, directLogout: 0, terminalLogout: 0, cleared: 0, errors: [] };
  const context = {
    DashboardApi: {
      restoreSession() {
        return { agent: 'BEN', role: 'manager' };
      },
      async loadData() {
        return { agent: 'BEN', role: 'agent', data: { agents: { BEN: {} } } };
      },
      async logout() {
        calls.directLogout += 1;
      },
    },
    async initAdmin() {
      calls.initialized += 1;
    },
    clearAdminProtectedState() {
      calls.cleared += 1;
    },
    async logout() {
      calls.terminalLogout += 1;
      calls.cleared += 1;
    },
    getAdminRequestedMonth: () => 'Jul 26',
    setAdminLoginBusy() {},
    showAdminApp() {
      throw new Error('Admin app must stay hidden');
    },
    showAdminLoginError(message) {
      calls.errors.push(message);
    },
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('bootAdminDashboard'), context);

  const result = await context.bootAdminDashboard();

  assert.equal(result, false);
  assert.equal(calls.initialized, 0);
  assert.equal(calls.terminalLogout, 1);
  assert.equal(calls.directLogout, 0);
  assert.equal(calls.cleared, 1);
  assert.match(calls.errors.join(' '), /manager/i);
});

test('post-login Admin initialization failure closes the new session and clears partial state', async () => {
  const calls = { directLogout: 0, terminalLogout: 0, cleared: 0, errors: [] };
  const context = {
    DashboardApi: {
      async login() {
        return { agent: 'GT138888', role: 'manager', data: { sensitive: true } };
      },
      async logout() {
        calls.directLogout += 1;
      },
    },
    document: {
      getElementById(id) {
        return id === 'pw-input' ? { value: '9999' } : null;
      },
    },
    getAdminRequestedMonth: () => 'Jul 26',
    async initAdmin() {
      throw new Error('render failed');
    },
    clearAdminProtectedState() {
      calls.cleared += 1;
    },
    async logout() {
      calls.terminalLogout += 1;
      calls.cleared += 1;
    },
    setAdminLoginBusy() {},
    showAdminApp() {
      throw new Error('Admin app must stay hidden');
    },
    showAdminLoginError(message) {
      calls.errors.push(message);
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `var ADMIN_LOGIN_IN_FLIGHT = false;\n${extractFunction('doLogin')}`,
    context,
  );

  const result = await context.doLogin();

  assert.equal(result, false);
  assert.equal(calls.terminalLogout, 1);
  assert.equal(calls.directLogout, 0);
  assert.equal(calls.cleared, 1);
  assert.match(calls.errors.join(' '), /render failed/i);
});

test('Admin initialization consumes an authorized envelope instead of a public snapshot', () => {
  const init = extractFunction('initAdmin');
  const importJson = extractFunction('importJSON');
  assert.match(init, /authorizedEnvelope/);
  assert.match(init, /authorizedEnvelope\.role\s*!==\s*['"]manager['"]/);
  assert.match(init, /DASH_DATA\s*=\s*authorizedEnvelope\.data/);
  assert.doesNotMatch(init, /fetch\s*\(/);
  assert.match(importJson, /delete\s+CONFIG\.agent_pins/);
});

test('Admin PIN editor uses only manager-scoped gateway methods', () => {
  const render = extractFunction('renderPinForm');
  const save = extractFunction('savePins');
  const loadConfig = extractFunction('loadConfigFromSupabase');
  const saveConfig = extractFunction('saveAllToSupabase');

  assert.match(render, /DashboardApi\.listAgentPins\(/);
  assert.doesNotMatch(render, /CONFIG\.agent_pins|DEFAULT_AGENT_PINS|GT138888/);
  assert.match(save, /DashboardApi\.saveAgentPin\(/);
  assert.doesNotMatch(save, /CONFIG\.agent_pins|saveAll\s*\(/);
  assert.doesNotMatch(loadConfig, /targets_pins|agent_pins/);
  assert.doesNotMatch(saveConfig, /targets_pins|agent_pins/);
});

test('duplicate PIN input is rejected before any partial gateway save', async () => {
  const alerts = [];
  let saveCalls = 0;
  const elements = {
    pin_BEN: { value: '1234' },
    pin_CJ: { value: '1234' },
  };
  const context = {
    ADMIN_PIN_CACHE: {},
    CONFIG: { agents: { BEN: {}, CJ: {} } },
    DashboardApi: {
      async saveAgentPin() {
        saveCalls += 1;
      },
    },
    alert(message) {
      alerts.push(message);
    },
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    getMdAdminScopedAgents: () => ['BEN', 'CJ'],
    async renderPinForm() {},
    setTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('savePins'), context);

  await assert.doesNotReject(() => context.savePins());
  assert.equal(saveCalls, 0);
  assert.match(alerts.join(' '), /duplicate/i);
});

test('an expired PIN-list session logs out Admin instead of leaving protected UI open', async () => {
  let logoutCalls = 0;
  const container = { innerHTML: '' };
  const context = {
    DashboardApi: {
      async listAgentPins() {
        const error = new Error('expired');
        error.status = 401;
        throw error;
      },
    },
    document: {
      getElementById(id) {
        return id === 'pin-management-form' ? container : null;
      },
    },
    console: { warn() {} },
    async logout() {
      logoutCalls += 1;
    },
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('renderPinForm'), context);

  await context.renderPinForm();

  assert.equal(logoutCalls, 1);
});

test('an expired PIN-save session logs out Admin before attempting a refresh', async () => {
  let logoutCalls = 0;
  let refreshCalls = 0;
  const context = {
    ADMIN_PIN_CACHE: { BEN: '1111' },
    CONFIG: { agents: { BEN: {} } },
    DashboardApi: {
      async saveAgentPin() {
        const error = new Error('expired');
        error.status = 401;
        throw error;
      },
    },
    alert() {},
    document: {
      getElementById(id) {
        return id === 'pin_BEN' ? { value: '2222' } : null;
      },
    },
    getMdAdminScopedAgents: () => ['BEN'],
    async renderPinForm() {
      refreshCalls += 1;
    },
    async logout() {
      logoutCalls += 1;
    },
    setTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('savePins'), context);

  await context.savePins();

  assert.equal(logoutCalls, 1);
  assert.equal(refreshCalls, 0);
});

test('server-rejected manager identity cannot be committed during a month transition', async () => {
  let logoutCalls = 0;
  const selector = { disabled: false, value: 'Jul 26' };
  const context = {
    window: {
      MDAdminContext: {
        normalizeMonth(value) { return value; },
        setWorkingMonth(value) { return value; },
      },
    },
    ADMIN_ACTIVE_MONTH: 'Jun 26',
    ADMIN_AVAILABLE_MONTHS: ['Jun 26'],
    ADMIN_DIRTY: false,
    DASH_DATA: { before: true },
    DashboardApi: {
      async loadData() {
        return {
          agent: 'BEN',
          role: 'agent',
          availableMonths: ['Jun 26', 'Jul 26'],
          data: { after: true },
        };
      },
    },
    document: {
      getElementById(id) {
        return id === 'admin-working-month' ? selector : null;
      },
    },
    confirm: () => true,
    updateAdminDirtyIndicator() {},
    updateSaveStatus() {},
    populateMonthDropdowns() {},
    async refreshAgentDependentViews() {},
    renderSKUForms() {},
    renderKPIWeights() {},
    _populateGroupSpMonths() {},
    loadGroupSpOverride() {},
    async loadAgentCalendarSettings() {},
    renderBirthdayCampList() {},
    renderCampaignsList() {},
    populateBulkCampSelect() {},
    showToast() {},
    console: { warn() {} },
    async logout() {
      logoutCalls += 1;
    },
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('adminWorkingMonthSelectChanged'), context);

  await context.adminWorkingMonthSelectChanged('Jul 26');

  assert.deepEqual(context.DASH_DATA, { before: true });
  assert.equal(context.ADMIN_ACTIVE_MONTH, 'Jun 26');
  assert.equal(logoutCalls, 1);
});

test('an expired archive read logs out Admin', async () => {
  let logoutCalls = 0;
  const elements = {
    'archive-month-select': { value: 'Jul 26' },
    'archive-status': { innerHTML: '' },
  };
  const context = {
    DashboardApi: {
      async loadData() {
        const error = new Error('expired');
        error.status = 401;
        throw error;
      },
    },
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    async logout() {
      logoutCalls += 1;
    },
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('archiveSelectedMonth'), context);

  await context.archiveSelectedMonth();

  assert.equal(logoutCalls, 1);
});

test('Admin archive month choices come from the protected data envelope', () => {
  const loadMonths = extractFunction('loadArchiveMonths');

  assert.match(loadMonths, /ADMIN_AVAILABLE_MONTHS/);
  assert.doesNotMatch(loadMonths, /months_index\.json|fetch\s*\(/);
});

test('Admin without an explicit month opens the current month before a stale saved month', () => {
  const context = {
    window: {
      MDAdminContext: {
        urlMonth: () => '',
        savedMonth: () => 'May 26',
        currentMonthLabel: () => 'Jul 26',
      },
    },
    Date,
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('getAdminRequestedMonth'), context);

  assert.equal(context.getAdminRequestedMonth(), 'Jul 26');
});

test('Admin month transitions and archive reads load the protected month first', () => {
  const changeMonth = extractFunction('adminWorkingMonthSelectChanged');
  const archive = extractFunction('archiveSelectedMonth');
  const loadIndex = changeMonth.indexOf('DashboardApi.loadData');
  const commitIndex = changeMonth.indexOf('DASH_DATA =');

  assert(loadIndex >= 0, 'working-month changes should request gateway data');
  assert(commitIndex > loadIndex, 'new protected data should be committed only after loading succeeds');
  assert.match(archive, /DashboardApi\.loadData\(/);
  assert.doesNotMatch(archive, /dashboard_data\.json|data_\$\{/);
});

test('Admin logout clears protected browser state before reloading', () => {
  const clear = extractFunction('clearAdminProtectedState');
  const logout = extractFunction('logout');

  assert.match(clear, /DASH_DATA\s*=\s*\{\}/);
  assert.match(clear, /CONFIG\s*=\s*null/);
  assert.match(clear, /main-app/);
  assert.match(logout, /clearAdminProtectedState\(/);
  assert.match(logout, /DashboardApi\.logout\(/);
  assert.match(logout, /location\.reload\(/);
});

test('PIN tables are locked down after the Admin editor migration', () => {
  const migrationPath = path.join(
    root,
    'migrations',
    '2026-07-17_agent_pin_gateway_lockdown.sql',
  );
  assert.equal(fs.existsSync(migrationPath), true, 'PIN lockdown migration should exist');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(migration, /alter table public\.agent_pins enable row level security/i);
  assert.match(migration, /revoke all on table public\.agent_pins from anon, authenticated/i);
  assert.match(migration, /alter table if exists public\.targets_pins enable row level security/i);
  assert.match(migration, /to_regclass\(['"]public\.targets_pins['"]\)/i);
  assert.match(migration, /revoke all on table public\.targets_pins from anon, authenticated/i);
});
