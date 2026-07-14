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


function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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
    /dashboard_data\.json|debtor_analysis_data\.json|months_index\.json|data_\$\{/,
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
  const loadDataSource = extractFunction('loadData');
  const selectAgentSource = extractFunction('selectAgent');
  const switchMonthSource = extractFunction('switchMonth');
  const refreshSource = extractFunction('forceRefreshDashboard');
  assert.match(checkPinSource, /const submittedPin = _pin;/);
  assert.match(checkPinSource, /DashboardApi\.login\(\s*submittedPin\s*,/);
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
    extractFunction('checkPin'),
  ].join('\n'), context);

  await context.checkPin();

  assert.equal(context.logoutCalls, 1);
  assert.equal(session.size, 0);
  assert.equal(context.DATA, null);
  assert.equal(context.currentAgent, null);
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


test('future planning and refresh load a fresh authorized base and sync the selected month', async () => {
  const syncMonths = {
    api: [],
    birthday: [],
    campaign: [],
    claims: [],
    kpi: [],
  };
  let generation = 0;
  let transitionVersion = 0;
  const freshBaseData = () => {
    generation += 1;
    const data = dashboardData('Jun 26', { BEN: ['300-BEN'] });
    data.generation = generation;
    data.campaigns = [{ id: 'jun-camp' }];
    data.agents.BEN.debtor_cards.debtors[0].campaigns = [{ id: 'jun-camp' }];
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
    SalesLiveCampaignSync: {
      async apply(data) {
        syncMonths.campaign.push(data.current_month);
        const campaign = { id: `${context.monthSlug(data.current_month)}-camp` };
        data.campaigns ||= [];
        data.campaigns.push(campaign);
        data.agents.BEN.debtor_cards.debtors[0].campaigns ||= [];
        data.agents.BEN.debtor_cards.debtors[0].campaigns.push(campaign);
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
    extractFunction('prepareAuthorizedDashboardData'),
    extractFunction('commitDashboardEnvelope'),
    extractFunction('switchMonth'),
    extractFunction('forceRefreshDashboard'),
  ].join('\n'), context);

  await context.switchMonth('jul26');

  assert.deepEqual(syncMonths.api, ['Jun 26']);
  assert.equal(context.DATA.generation, 2);
  assert.equal(context.DATA.current_month, 'Jul 26');
  assert.equal(context.DATA.is_future_view, true);
  assert.deepEqual(
    Array.from(
      context.DATA.agents.BEN.debtor_cards.debtors[0].campaigns,
      campaign => campaign.id,
    ),
    ['jul26-camp'],
  );
  assert.deepEqual(syncMonths.kpi, ['Jul 26']);
  assert.deepEqual(syncMonths.birthday, ['Jul 26']);
  assert.deepEqual(syncMonths.campaign, ['Jul 26']);
  assert.deepEqual(syncMonths.claims, ['Jul 26']);

  await context.forceRefreshDashboard();

  assert.deepEqual(syncMonths.api, ['Jun 26', 'Jun 26']);
  assert.equal(context.DATA.generation, 3);
  assert.equal(context.DATA.current_month, 'Jul 26');
  assert.deepEqual(
    Array.from(
      context.DATA.agents.BEN.debtor_cards.debtors[0].campaigns,
      campaign => campaign.id,
    ),
    ['jul26-camp'],
  );
  assert.deepEqual(syncMonths.kpi, ['Jul 26', 'Jul 26']);
  assert.deepEqual(syncMonths.birthday, ['Jul 26', 'Jul 26']);
  assert.deepEqual(syncMonths.campaign, ['Jul 26', 'Jul 26']);
  assert.deepEqual(syncMonths.claims, ['Jul 26', 'Jul 26']);
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
  let genericFetchCalls = 0;
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
        throw new Error('gateway unavailable');
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
  assert.equal(genericFetchCalls, 0);
  assert.strictEqual(context.DATA, priorData);
  assert.equal(context.currentAgent, 'BEN');
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
      getElementById() {
        return null;
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
    "var _pin = '1001';",
    'var _pinLocked = true;',
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
});
