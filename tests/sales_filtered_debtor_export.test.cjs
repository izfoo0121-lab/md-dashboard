const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');

function extractFunction(name) {
  const functionStart = html.indexOf(`function ${name}`);
  assert(functionStart >= 0, `${name} should exist`);
  const start = html.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const bodyStart = html.indexOf('{', html.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function extractFunctionIfPresent(name) {
  return html.includes(`function ${name}`) ? extractFunction(name) : '';
}

function debtorExportLifecycleSources() {
  return [
    'beginDebtorExportTransition',
    'isDebtorExportTransitionPending',
    'isCurrentDebtorExportTransition',
    'completeDebtorExportTransition',
    'getDebtorExportTransition',
    'updateDebtorExportTransitionDesiredAgent',
    'resolveDebtorExportTransitionAgent',
  ].map(extractFunctionIfPresent).filter(Boolean);
}

const converterDebtors = Array.from({ length: 37 }, (_, index) => {
  const sequence = String(index + 1).padStart(3, '0');
  return {
    debtor_code: `300-C${sequence}`,
    company_name: `CONVERTER SHOP ${index + 1}`,
    debtor_type: 'Converter',
    status: 'active',
    is_pending_activation: false,
  };
});
const activeShopDebtor = {
  debtor_code: '300-S001',
  company_name: 'CONVERTER SHOP RETAIL',
  debtor_type: 'SH-Shop',
  status: 'active',
  is_pending_activation: false,
};
const pendingConverterDebtor = {
  debtor_code: '300-P001',
  company_name: 'PENDING WHOLESALE',
  debtor_type: 'Converter',
  status: 'pending',
  is_pending_activation: true,
};
const debtors = [...converterDebtors, activeShopDebtor, pendingConverterDebtor];

let menuUpdates = 0;
const context = {
  DATA: { current_month: 'Jul 26' },
  currentAgent: 'JAMES',
  filters: { status: 'all', special: null, pending_activation: null, type: 'all' },
  updateDebtorExportMenu() {
    menuUpdates += 1;
  },
  debtorMatchesSearch(debtor, query) {
    const search = String(query || '').trim().toLowerCase();
    if (!search) return true;
    return [debtor.company_name, debtor.debtor_code, debtor.code]
      .some(value => String(value || '').toLowerCase().includes(search));
  },
  getDebtorType(debtor) {
    return String(debtor.debtor_type || debtor.type || '').trim();
  },
  newSkuKpiEntryCount(debtor) {
    return debtor.newSkuCount || 0;
  },
  isNoCcomBuyer(debtor) {
    return debtor.noCcom === true;
  },
  isThreeMonthNoCcomOrder(debtor) {
    return debtor.noThreeMonthOrder === true;
  },
  getFlag(agent, debtorCode) {
    return agent === 'JAMES' && debtorCode === '300-C001' ? { reason: 'follow_up' } : null;
  },
  visibleDebtorCampaigns(debtor) {
    return debtor.campaigns || [];
  },
  isNearTargetDebtor(debtor) {
    return debtor.nearTarget === true;
  },
};
vm.createContext(context);
vm.runInContext([
  'var DATA = globalThis.DATA;',
  'var currentAgent = globalThis.currentAgent;',
  'var filters = globalThis.filters;',
  extractFunction('createEmptyDebtorExportViewState'),
  ...debtorExportLifecycleSources(),
  extractFunction('uniqueDebtorsByCode'),
  extractFunction('publishDebtorExportView'),
  extractFunction('resetDebtorExportView'),
  extractFunction('getCurrentDebtorExportView'),
  extractFunction('buildDebtorFilterDescriptor'),
  extractFunction('debtorMatchesStandardViewFilters'),
  extractFunction('filterStandardDebtorsForView'),
  extractFunction('buildDynamicDebtorTypeSummary'),
  extractFunction('filterMovementDebtorsForView'),
  extractFunction('debtorsFromMovementRows'),
  'let debtorExportTransitionVersion = 0;',
  'let debtorExportPendingTransition = null;',
  'let debtorExportViewState = createEmptyDebtorExportViewState();',
].join('\n'), context);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.createEmptyDebtorExportViewState())),
  { agent: '', month: '', debtors: [], labels: [], active: false },
  'empty export state should be inert and detached from the current view'
);

context.currentAgent = null;
context.DATA = null;
assert.strictEqual(
  context.getCurrentDebtorExportView(),
  null,
  'empty export state should not become current when agent and month are uninitialized'
);
context.currentAgent = 'JAMES';
context.DATA = { current_month: 'Jul 26' };

const standardView = {
  search: 'converter shop',
  status: 'active',
  pendingActivation: null,
  special: null,
  type: 'Converter',
};
const standardFiltered = context.filterStandardDebtorsForView(debtors, standardView);
assert.strictEqual(
  standardFiltered.length,
  37,
  'standard filtering should return every matching debtor before pagination'
);

const codeFiltered = context.filterStandardDebtorsForView(debtors, {
  ...standardView,
  search: '300-C001',
});
assert.deepStrictEqual(
  Array.from(codeFiltered, debtor => debtor.debtor_code),
  ['300-C001'],
  'standard filtering should search debtor codes'
);

const baseFilterDebtor = {
  debtor_code: '300-T001',
  company_name: 'ISOLATED FILTER MATCH',
  debtor_type: 'Converter',
  status: 'active',
  is_pending_activation: true,
  vip: true,
  is_new: true,
  newSkuCount: 1,
  noCcom: true,
  noThreeMonthOrder: true,
  campaigns: [{ id: 'campaign-1' }],
  has_overdue: true,
  nearTarget: true,
};
const standardFilterCases = [
  {
    name: 'status',
    view: { search: 'isolated filter', status: 'active', type: 'Converter' },
    positive: { status: 'active' },
    negative: { status: 'pending' },
  },
  {
    name: 'pending activation',
    view: { pendingActivation: 'true' },
    positive: { is_pending_activation: true },
    negative: { is_pending_activation: false },
  },
  {
    name: 'VIP',
    view: { special: 'vip' },
    positive: { vip: true },
    negative: { vip: false },
  },
  {
    name: 'new debtor',
    view: { special: 'new' },
    positive: { is_new: true },
    negative: { is_new: false },
  },
  {
    name: 'birthday with uppercase code normalization',
    view: { special: 'birthday', birthdayCodes: new Set(['300-BDAY']) },
    positive: { debtor_code: '300-bday' },
    negative: { debtor_code: '300-other' },
  },
  {
    name: 'new SKU',
    view: { special: 'newsku' },
    positive: { newSkuCount: 1 },
    negative: { newSkuCount: 0 },
  },
  {
    name: 'CCOM not taken',
    view: { special: 'no_ccom' },
    positive: { noCcom: true },
    negative: { noCcom: false },
  },
  {
    name: 'three-month no order',
    view: { special: 'no3m' },
    positive: { noThreeMonthOrder: true },
    negative: { noThreeMonthOrder: false },
  },
  {
    name: 'flagged',
    view: { special: 'flagged' },
    positive: { debtor_code: '300-C001' },
    negative: { debtor_code: '300-C002' },
  },
  {
    name: 'campaign availability',
    view: { special: 'campaign' },
    positive: { campaigns: [{ id: 'campaign-1' }] },
    negative: { campaigns: [] },
  },
  {
    name: 'campaign debtor type',
    view: { special: 'campaign' },
    positive: { debtor_type: 'Converter' },
    negative: { debtor_type: '' },
  },
  {
    name: 'overdue',
    view: { special: 'overdue' },
    positive: { has_overdue: true },
    negative: { has_overdue: false },
  },
  {
    name: 'near target',
    view: { special: 'neartarget' },
    positive: { nearTarget: true },
    negative: { nearTarget: false },
  },
  {
    name: 'debtor type',
    view: { type: 'Converter' },
    positive: { debtor_type: 'Converter' },
    negative: { debtor_type: 'SH-Shop' },
  },
];
standardFilterCases.forEach(({ name, view, positive, negative }) => {
  assert.strictEqual(
    context.debtorMatchesStandardViewFilters({ ...baseFilterDebtor, ...positive }, view),
    true,
    `${name} should accept its positive case`
  );
  assert.strictEqual(
    context.debtorMatchesStandardViewFilters({ ...baseFilterDebtor, ...negative }, view),
    false,
    `${name} should reject its negative case`
  );
});

[
  { omitType: false, expected: false },
  { omitType: true, expected: true },
].forEach(({ omitType, expected }) => {
  assert.strictEqual(
    context.debtorMatchesStandardViewFilters(baseFilterDebtor, {
      type: 'SH-Shop',
      omitType,
    }),
    expected,
    `omitType=${omitType} should ${expected ? 'bypass' : 'enforce'} debtor type filtering`
  );
});

const allTypeDebtors = [
  { debtor_code: '300-T101', debtor_type: ' Converter ' },
  { debtor_code: '300-T102', debtor_type: 'SH-Shop' },
  { debtor_code: '300-T103', debtor_type: '' },
  { debtor_code: '300-T104', debtor_type: ' NaN ' },
];
const dynamicTypeSummary = context.buildDynamicDebtorTypeSummary(
  allTypeDebtors,
  [allTypeDebtors[0], allTypeDebtors[2], allTypeDebtors[3]]
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(dynamicTypeSummary)),
  { counts: { Converter: 1, 'SH-Shop': 0 }, total: 3 },
  'dynamic type summary should seed valid types, retain zero counts, and include no-type rows only in total'
);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(dynamicTypeSummary.counts, 'No Type'),
  false,
  'dynamic type summary should never create a No Type chip'
);

const descriptor = context.buildDebtorFilterDescriptor({ status: 'active', type: 'Converter' });
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(descriptor)),
  { active: true, labels: ['Status: active', 'Type: Converter'] },
  'descriptor should expose the active status and debtor type filters in display order'
);

const specialLabels = {
  vip: 'VIP',
  new: 'New',
  birthday: 'Birthday',
  drop: 'Drop',
  gain: 'Gain',
  unpurchased: 'Unpurchased',
  nonvip: 'Non-VIP',
  newsku: 'New SKU',
  no_ccom: 'CCOM not taken',
  no3m: '3-month no order',
  flagged: 'Flagged',
  campaign: 'Campaign',
  overdue: 'Overdue',
  neartarget: 'Near Target',
};
Object.entries(specialLabels).forEach(([special, label]) => {
  const specialDescriptor = context.buildDebtorFilterDescriptor({ special });
  assert.deepStrictEqual(
    Array.from(specialDescriptor.labels),
    [label],
    `${special} should have the expected export filter label`
  );
});
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.buildDebtorFilterDescriptor({
    special: '  custom cohort  ',
  }))),
  { active: true, labels: ['custom cohort'] },
  'unknown special filters should remain active with a trimmed fallback label'
);
assert.deepStrictEqual(
  Array.from(context.buildDebtorFilterDescriptor({
    search: '  converter shop  ',
    pending_activation: 'true',
  }).labels),
  ['Search: converter shop', 'Pending activation'],
  'descriptor should normalize search text and pending activation'
);

const movementFiltered = context.filterMovementDebtorsForView(debtors, {
  search: 'converter shop',
  type: 'Converter',
});
assert.strictEqual(
  movementFiltered.length,
  37,
  'movement filtering should honor search and selected type without status filtering'
);

const movementDebtors = context.debtorsFromMovementRows([
  { debtor_code: '300-C003' },
  { debtor_code: '300-c001' },
  { debtor_code: '300-C003' },
  { debtor_code: '300-MISSING' },
  { debtor_code: '300-C002' },
], debtors);
assert.deepStrictEqual(
  Array.from(movementDebtors, debtor => debtor.debtor_code),
  ['300-C003', '300-C001', '300-C002'],
  'movement rows should map to full debtors in display order and remove duplicate codes'
);

const firstDuplicate = { debtor_code: ' 300-D001 ', company_name: 'FIRST' };
const uniqueDebtors = context.uniqueDebtorsByCode([
  firstDuplicate,
  { code: '300-d001', company_name: 'DUPLICATE' },
  { debtor_code: '   ', company_name: 'BLANK' },
]);
assert.strictEqual(uniqueDebtors.length, 1, 'debtor code deduplication should ignore case and blank codes');
assert.strictEqual(uniqueDebtors[0], firstDuplicate, 'debtor code deduplication should preserve the first row');

const published = context.publishDebtorExportView(standardFiltered, {
  labels: [' Status: active ', '', 'Type: Converter'],
  active: true,
});
assert.strictEqual(published.debtors.length, 37, 'published export state should include all filtered rows');
assert.strictEqual(published.agent, 'JAMES', 'published export state should snapshot the current agent');
assert.strictEqual(published.month, 'Jul 26', 'published export state should snapshot the current month');
assert.deepStrictEqual(
  Array.from(published.labels),
  ['Status: active', 'Type: Converter'],
  'published export state should trim labels and omit blanks'
);
assert.strictEqual(published.active, true, 'published export state should retain an explicit active flag');
assert.strictEqual(menuUpdates, 1, 'publishing should refresh the debtor export menu once');
assert.strictEqual(context.getCurrentDebtorExportView(), published, 'current agent and month should expose the state');

context.currentAgent = 'CJ';
assert.strictEqual(
  context.getCurrentDebtorExportView(),
  null,
  'export state should be unavailable after the selected agent changes'
);

context.currentAgent = 'JAMES';
context.DATA.current_month = 'Aug 26';
assert.strictEqual(
  context.getCurrentDebtorExportView(),
  null,
  'export state should be unavailable after the selected month changes'
);

context.DATA.current_month = 'Jul 26';
context.resetDebtorExportView();
assert.strictEqual(menuUpdates, 2, 'resetting should refresh the debtor export menu a second time');
assert.strictEqual(context.getCurrentDebtorExportView(), null, 'reset export state should not match an active view');
context.resetDebtorExportView();
assert.strictEqual(menuUpdates, 2, 'resetting an already-empty export state should not refresh the menu again');

const noMenuContext = {
  DATA: { current_month: 'Jul 26' },
  currentAgent: 'JAMES',
};
vm.createContext(noMenuContext);
vm.runInContext([
  'var DATA = globalThis.DATA;',
  'var currentAgent = globalThis.currentAgent;',
  extractFunction('createEmptyDebtorExportViewState'),
  ...debtorExportLifecycleSources(),
  extractFunction('uniqueDebtorsByCode'),
  extractFunction('publishDebtorExportView'),
  extractFunction('resetDebtorExportView'),
  'let debtorExportTransitionVersion = 0;',
  'let debtorExportPendingTransition = null;',
  'let debtorExportViewState = createEmptyDebtorExportViewState();',
].join('\n'), noMenuContext);
assert.doesNotThrow(
  () => noMenuContext.publishDebtorExportView(converterDebtors, { active: true }),
  'publishing should not require updateDebtorExportMenu to exist'
);
assert.doesNotThrow(
  () => noMenuContext.resetDebtorExportView(),
  'resetting should not require updateDebtorExportMenu to exist'
);

function runMovementRendererContract({ mode, movementFilter, movementLabel }) {
  const isDrop = mode === 'drop';
  const matchingDebtors = Array.from({ length: 105 }, (_, index) => ({
    debtor_code: `300-M${String(index + 1).padStart(3, '0')}`,
    company_name: `TARGET MOVEMENT ${index + 1}`,
    debtor_type: 'Converter',
    rank: index,
  }));
  const inputDebtors = [
    ...matchingDebtors,
    { debtor_code: '300-WRONG-TYPE', company_name: 'TARGET WRONG TYPE', debtor_type: 'SH-Shop' },
    { debtor_code: '300-WRONG-SEARCH', company_name: 'OTHER CONVERTER', debtor_type: 'Converter' },
  ];
  const elements = {
    'debtor-search': { value: '  target  ' },
    'page-info': { textContent: '' },
    'btn-prev': { disabled: false, onclick: null },
    'btn-next': { disabled: false, onclick: null },
    'debtor-list': { innerHTML: '' },
  };
  const filterCalls = [];
  const published = [];
  const displayedCodes = [];
  const movementBuildCalls = [];
  const movementContext = {
    filters: { type: 'Converter' },
    dropSkuFilter: 'SKU-X',
    dropCtnFilter: isDrop ? movementFilter : 'all',
    gainSkuFilter: 'SKU-X',
    gainCtnFilter: isDrop ? 'all' : movementFilter,
    document: {
      getElementById(id) {
        return elements[id];
      },
    },
    buildDropSkuOptions(selectedDebtors) {
      assert.strictEqual(selectedDebtors.length, 105, `${mode} SKU options should use filtered debtors`);
      return ['SKU-X'];
    },
    buildDroppingSkuRows(selectedDebtors, selectedSku) {
      movementBuildCalls.push({ count: selectedDebtors.length, selectedSku });
      return selectedDebtors.map(d => ({
        debtor_code: d.debtor_code,
        company_name: d.company_name,
        debtor_type: d.debtor_type,
        sku: selectedSku,
        prev_ctn: d.rank + 1,
        cur_ctn: 0,
        drop_pct: 50,
        stopped: movementFilter === 'stopped',
      }));
    },
    buildGainingSkuRows(selectedDebtors, selectedSku) {
      movementBuildCalls.push({ count: selectedDebtors.length, selectedSku });
      return selectedDebtors.map(d => ({
        debtor_code: d.debtor_code,
        company_name: d.company_name,
        debtor_type: d.debtor_type,
        sku: selectedSku,
        prev_ctn: 0,
        cur_ctn: d.rank + 1,
        gain_pct: 50,
        is_new: movementFilter === 'newonly',
      }));
    },
    publishDebtorExportView(selectedDebtors, options) {
      published.push({
        debtors: Array.from(selectedDebtors),
        labels: Array.from(options.labels),
        active: options.active,
      });
    },
    renderDebtorCard(debtor) {
      displayedCodes.push(debtor.debtor_code);
      return `<div>${debtor.debtor_code}</div>`;
    },
    renderDropMovementExtra() {
      return '';
    },
    renderGainMovementExtra() {
      return '';
    },
  };
  vm.createContext(movementContext);
  const rendererName = isDrop ? 'renderDropMode' : 'renderGainMode';
  vm.runInContext([
    extractFunction('getDebtorType'),
    extractFunction('debtorMatchesSearch'),
    extractFunction('filterMovementDebtorsForView'),
    extractFunction('uniqueDebtorsByCode'),
    extractFunction('debtorsFromMovementRows'),
    extractFunction('debtorMovementFilterLabel'),
    extractFunction(rendererName),
  ].join('\n'), movementContext);

  const actualFilter = movementContext.filterMovementDebtorsForView;
  movementContext.filterMovementDebtorsForView = (selectedDebtors, options) => {
    filterCalls.push({ search: options.search, type: options.type });
    return actualFilter(selectedDebtors, options);
  };
  movementContext[rendererName](inputDebtors);

  const expectedCodes = matchingDebtors.slice().reverse().map(d => d.debtor_code);
  assert.deepStrictEqual(
    filterCalls,
    [{ search: 'target', type: 'Converter' }],
    `${mode} should pass trimmed search and selected type into movement filtering`
  );
  assert.deepStrictEqual(
    movementBuildCalls,
    [{ count: 105, selectedSku: 'SKU-X' }],
    `${mode} should build movement rows from the complete filtered debtor input`
  );
  assert.strictEqual(published.length, 1, `${mode} should publish once`);
  assert.strictEqual(published[0].active, true, `${mode} publication should be active`);
  assert.deepStrictEqual(
    published[0].debtors.map(d => d.debtor_code),
    expectedCodes,
    `${mode} should publish every sorted debtor before the 100-row display cap`
  );
  assert.deepStrictEqual(
    displayedCodes,
    expectedCodes.slice(0, 100),
    `${mode} should display only the first 100 sorted debtors`
  );
  assert.strictEqual(elements['page-info'].textContent, '1-100 of 105', `${mode} page info should report the cap`);
  assert.deepStrictEqual(
    published[0].labels,
    [
      isDrop ? 'Drop' : 'Gain',
      'Search: target',
      'Type: Converter',
      'SKU: SKU-X',
      `Movement: ${movementLabel}`,
    ],
    `${mode} publication labels should describe the filtered input`
  );
}

[
  { mode: 'drop', movementFilter: 'stopped', movementLabel: 'Stopped purchase' },
  { mode: 'drop', movementFilter: 'reduced30', movementLabel: 'Reduced >=30%' },
  { mode: 'gain', movementFilter: 'newonly', movementLabel: 'New SKU only' },
  { mode: 'gain', movementFilter: 'increased30', movementLabel: 'Increased >=30%' },
].forEach(runMovementRendererContract);

const nonVipElements = {
  'debtor-search': { value: '  target  ' },
  'page-info': { textContent: '' },
  'btn-prev': { disabled: false, onclick: null },
  'btn-next': { disabled: false, onclick: null },
  'debtor-list': { innerHTML: '' },
};
const nonVipPublished = [];
const nonVipDisplayedCodes = [];
const matchingNonVipDebtors = Array.from({ length: 15 }, (_, index) => ({
  debtor_code: `300-N${String(index + 1).padStart(3, '0')}`,
  company_name: `TARGET NONVIP ${index + 1}`,
  debtor_type: 'Converter',
  vip: false,
  dm_active: true,
  ctn_cur: index + 1,
  ctn_prev1: 0,
  ctn_prev2: 0,
}));
const nonVipInput = [
  ...matchingNonVipDebtors,
  {
    debtor_code: '300-N-WRONG-TYPE', company_name: 'TARGET SHOP', debtor_type: 'SH-Shop',
    vip: false, dm_active: true, ctn_cur: 100,
  },
  {
    debtor_code: '300-N-WRONG-SEARCH', company_name: 'OTHER CONVERTER', debtor_type: 'Converter',
    vip: false, dm_active: true, ctn_cur: 100,
  },
  {
    debtor_code: '300-N-VIP', company_name: 'TARGET VIP', debtor_type: 'Converter',
    vip: true, dm_active: true, ctn_cur: 100,
  },
  {
    debtor_code: '300-N-PERSONAL', company_name: 'TARGET PERSONAL', debtor_type: 'P-Personal',
    vip: false, dm_active: true, ctn_cur: 100,
  },
];
const nonVipContext = {
  nonvipTypeFilter: 'Converter',
  nonvipPage: 1,
  PAGE_SIZE: 12,
  document: {
    getElementById(id) {
      return nonVipElements[id];
    },
  },
  publishDebtorExportView(selectedDebtors, options) {
    nonVipPublished.push({
      debtors: Array.from(selectedDebtors),
      labels: Array.from(options.labels),
      active: options.active,
    });
  },
  renderDebtorCard(debtor) {
    nonVipDisplayedCodes.push(debtor.debtor_code);
    return `<div>${debtor.debtor_code}</div>`;
  },
};
vm.createContext(nonVipContext);
vm.runInContext([
  extractFunction('getDebtorType'),
  extractFunction('debtorMatchesSearch'),
  extractFunction('renderNonVipMode'),
].join('\n'), nonVipContext);
nonVipContext.renderNonVipMode(nonVipInput);

const expectedNonVipCodes = matchingNonVipDebtors.slice().reverse().map(d => d.debtor_code);
assert.deepStrictEqual(
  nonVipPublished[0].debtors.map(d => d.debtor_code),
  expectedNonVipCodes,
  'Non-VIP should publish every search-and-type match in CTN order before pagination'
);
assert.deepStrictEqual(
  nonVipDisplayedCodes,
  expectedNonVipCodes.slice(0, 12),
  'Non-VIP should display only the current page after publishing the complete result'
);
assert.deepStrictEqual(
  nonVipPublished[0].labels,
  ['Non-VIP', 'Type: Converter', 'Search: target'],
  'Non-VIP publication labels should describe search and selected type'
);
assert.strictEqual(nonVipPublished[0].active, true, 'Non-VIP publication should be active');
assert.strictEqual(nonVipElements['page-info'].textContent, '1\u201312 of 15', 'Non-VIP page info should reflect matching rows');
assert(
  nonVipElements['debtor-list'].innerHTML.includes('15 matching of 17 non-VIP customers'),
  'Non-VIP summary should describe the current matching count and full eligible cohort'
);

const unpurchasedNoSkuEvents = [];
const unpurchasedNoSkuPublished = [];
const unpurchasedNoSkuList = { renderedHtml: '' };
Object.defineProperty(unpurchasedNoSkuList, 'innerHTML', {
  get() {
    return this.renderedHtml;
  },
  set(value) {
    unpurchasedNoSkuEvents.push('render');
    this.renderedHtml = value;
  },
});
const unpurchasedNoSkuContext = {
  document: {
    getElementById(id) {
      assert.strictEqual(id, 'debtor-list', 'no-SKU branch should only render the debtor list');
      return unpurchasedNoSkuList;
    },
  },
  getUnpurchasedSkuCatalog(eligibleDebtors) {
    assert.strictEqual(eligibleDebtors.length, 1, 'no-SKU branch should build the catalog from eligible debtors');
    return [];
  },
  publishDebtorExportView(selectedDebtors, options) {
    unpurchasedNoSkuEvents.push('publish');
    unpurchasedNoSkuPublished.push({
      debtors: Array.from(selectedDebtors),
      labels: Array.from(options.labels),
      active: options.active,
    });
  },
};
vm.createContext(unpurchasedNoSkuContext);
vm.runInContext([
  extractFunction('getDebtorType'),
  extractFunction('renderUnpurchasedMode'),
].join('\n'), unpurchasedNoSkuContext);
unpurchasedNoSkuContext.renderUnpurchasedMode([
  { debtor_code: '300-U001', company_name: 'NO SKU', debtor_type: 'Converter', dm_active: true },
]);
assert.deepStrictEqual(
  unpurchasedNoSkuPublished,
  [{ debtors: [], labels: ['Unpurchased'], active: true }],
  'Unpurchased no-SKU branch should publish an active empty result'
);
assert.deepStrictEqual(
  unpurchasedNoSkuEvents,
  ['publish', 'render'],
  'Unpurchased no-SKU branch should publish before rendering and returning'
);

const renderDebtorsSource = extractFunction('renderDebtors');
assert(
  renderDebtorsSource.includes('filterStandardDebtorsForView('),
  'renderDebtors should filter the standard debtor view through filterStandardDebtorsForView'
);
assert(
  renderDebtorsSource.includes('publishDebtorExportView('),
  'renderDebtors should publish the complete standard debtor view'
);
const standardMainFilterIndex = renderDebtorsSource.indexOf(
  'filterStandardDebtorsForView(debtors, standardView)'
);
const standardTypeFilterIndex = renderDebtorsSource.indexOf(
  'filterStandardDebtorsForView(allDebtors, {'
);
const standardSharedViewIndex = renderDebtorsSource.indexOf('...standardView', standardTypeFilterIndex);
const standardPublishIndex = renderDebtorsSource.indexOf('publishDebtorExportView(');
const standardTotalIndex = renderDebtorsSource.indexOf('const totalF = filtered.length');
const standardSliceIndex = renderDebtorsSource.indexOf('filtered.slice(');
assert(
  standardMainFilterIndex >= 0
    && standardTypeFilterIndex > standardMainFilterIndex
    && standardSharedViewIndex > standardTypeFilterIndex,
  'renderDebtors should feed standardView into both main and omit-type filtering paths'
);
assert(
  renderDebtorsSource.includes('buildDynamicDebtorTypeSummary(allDebtors, typeEligible)'),
  'renderDebtors should preserve baseline type-chip seeding through the dynamic type summary helper'
);
assert(
  standardPublishIndex > standardTypeFilterIndex
    && standardPublishIndex < standardTotalIndex
    && standardPublishIndex < standardSliceIndex,
  'renderDebtors should publish the complete filtered result before totals and pagination slicing'
);

const renderDropModeSource = extractFunction('renderDropMode');
assert(
  renderDropModeSource.includes('filterMovementDebtorsForView('),
  'renderDropMode should apply search and debtor type before building movement rows'
);
assert(
  renderDropModeSource.includes('debtorsFromMovementRows('),
  'renderDropMode should map complete movement rows back to debtors'
);
assert(
  renderDropModeSource.includes('publishDebtorExportView('),
  'renderDropMode should publish the complete drop view'
);

const renderGainModeSource = extractFunction('renderGainMode');
assert(
  renderGainModeSource.includes('filterMovementDebtorsForView('),
  'renderGainMode should apply search and debtor type before building movement rows'
);
assert(
  renderGainModeSource.includes('debtorsFromMovementRows('),
  'renderGainMode should map complete movement rows back to debtors'
);
assert(
  renderGainModeSource.includes('publishDebtorExportView('),
  'renderGainMode should publish the complete gain view'
);

const renderUnpurchasedModeSource = extractFunction('renderUnpurchasedMode');
assert(
  renderUnpurchasedModeSource.includes('publishDebtorExportView('),
  'renderUnpurchasedMode should publish the complete unpurchased view'
);

const renderNonVipModeSource = extractFunction('renderNonVipMode');
assert(
  renderNonVipModeSource.includes('debtorMatchesSearch('),
  'renderNonVipMode should apply the global debtor search'
);
assert(
  renderNonVipModeSource.includes('publishDebtorExportView('),
  'renderNonVipMode should publish the complete non-VIP view'
);

const selectAgentSource = extractFunction('selectAgent');
const selectAgentAssignmentIndex = selectAgentSource.indexOf('currentAgent = agent;');
const selectAgentBeginIndex = selectAgentSource.indexOf('beginDebtorExportTransition(');
const selectAgentFetchIndex = selectAgentSource.indexOf('fetch(fallbackUrl)');
if (selectAgentBeginIndex >= 0) {
  assert(
    selectAgentBeginIndex < selectAgentAssignmentIndex && selectAgentBeginIndex < selectAgentFetchIndex,
    'selectAgent should begin its export transition before assignment or async debtor loading'
  );
}

const switchMonthSource = extractFunction('switchMonth');
const switchMonthBeginIndex = switchMonthSource.indexOf('beginDebtorExportTransition(');
const switchMonthReadIndex = switchMonthSource.indexOf("document.getElementById('agent-select')");
const switchMonthFetchIndex = switchMonthSource.indexOf('await fetch(url)');
if (switchMonthBeginIndex >= 0) {
  assert(
    switchMonthBeginIndex < switchMonthReadIndex && switchMonthBeginIndex < switchMonthFetchIndex,
    'switchMonth should begin its export transition before reading selection or fetching asynchronously'
  );
}

const noAgentSource = extractFunction('renderNoAgentState');
const noAgentResetIndex = noAgentSource.indexOf('resetDebtorExportView(');
assert(
  noAgentResetIndex >= 0 && noAgentResetIndex < noAgentSource.indexOf('document.getElementById('),
  'renderNoAgentState should reset stale export state before rendering or returning'
);

const exportFilteredDebtorListExcelSource = extractFunction('exportFilteredDebtorListExcel');
assert(
  exportFilteredDebtorListExcelSource.includes('buildFullDebtorExportRows('),
  'filtered export should use the shared debtor row mapping'
);

const downloadToggleIds = html.match(/\bid=["']debtor-download-toggle["']/g) || [];
assert.strictEqual(downloadToggleIds.length, 1, 'Debtors tab should expose exactly one download toggle');
const downloadToggleMarkup = html.match(/<button\b[^>]*\bid=["']debtor-download-toggle["'][^>]*>/i)?.[0] || '';
assert(downloadToggleMarkup, 'download toggle markup should exist');
assert(
  /\baria-expanded=["']false["']/.test(downloadToggleMarkup),
  'download toggle should start with aria-expanded=false'
);
assert(
  /\baria-controls=["']debtor-download-menu["']/.test(downloadToggleMarkup),
  'download toggle should identify the controlled menu'
);
assert(
  /\baria-haspopup=["']menu["']/.test(downloadToggleMarkup),
  'download toggle should expose menu-button semantics'
);
const downloadMenuMarkup = html.match(/<div\b[^>]*\bid=["']debtor-download-menu["'][^>]*>/i)?.[0] || '';
assert(/\brole=["']menu["']/.test(downloadMenuMarkup), 'download popup should expose role=menu');
const downloadMenuItems = html.match(/<button\b[^>]*\brole=["']menuitem["'][^>]*>/gi) || [];
assert.strictEqual(downloadMenuItems.length, 2, 'download menu should expose exactly two menuitem buttons');
assert(
  downloadMenuItems.some(markup => /\bid=["']debtor-export-filtered["']/.test(markup)),
  'filtered export should be one of the two menuitems'
);
assert(
  downloadMenuItems.some(markup => /\bid=["']debtor-export-full["']/.test(markup)),
  'full export should be one of the two menuitems'
);
assert(html.includes('Filtered result'), 'download menu should label the filtered export');
assert(html.includes('Full debtor list'), 'download menu should label the full export');
const mobileDebtorDownloadRule = html.match(
  /@media\(max-width:640px\)\{\s*\.debtor-export-bar\{[^}]*\}\s*\.debtor-export-summary\{[^}]*\}\s*\.debtor-download-wrap\{[^}]*\}\s*\.debtor-download-menu\{([^}]*)\}\s*\}/
)?.[1] || '';
assert(mobileDebtorDownloadRule, 'mobile debtor download menu CSS should exist');
assert(
  /position\s*:\s*absolute(?:;|$)/.test(mobileDebtorDownloadRule)
    && /bottom\s*:\s*calc\(100%\s*\+\s*6px\)(?:;|$)/.test(mobileDebtorDownloadRule)
    && /top\s*:\s*auto(?:;|$)/.test(mobileDebtorDownloadRule),
  'mobile download menu should open upward as an absolute popover'
);
const mobileDebtorDownloadZIndex = Number(
  mobileDebtorDownloadRule.match(/z-index\s*:\s*(\d+)/)?.[1]
);
assert(
  mobileDebtorDownloadZIndex > 100,
  'mobile download menu should stack above the fixed bottom nav'
);

let filteredExportState = {
  agent: 'JAMES',
  month: 'Jul 26',
  debtors: converterDebtors,
  labels: ['Type: Converter'],
  active: true,
};
const filteredExportCalls = [];
const filteredBuildCalls = [];
const filteredAlerts = [];
let filteredRenderCalls = 0;
let filteredStateReads = 0;
let filteredMenuCloseCalls = 0;
const filteredExportContext = {
  DATA: {
    current_month: 'Jul 26',
    agents: {
      JAMES: { debtor_cards: { debtors } },
    },
  },
  currentAgent: 'JAMES',
  getCurrentDebtorExportView() {
    filteredStateReads += 1;
    return filteredExportState;
  },
  renderDebtors() {
    filteredRenderCalls += 1;
  },
  alert(message) {
    filteredAlerts.push(message);
  },
  exportDebtorRows(rows, sheetName, baseName) {
    filteredExportCalls.push({ rows: Array.from(rows), sheetName, baseName });
  },
  closeDebtorDownloadMenu() {
    filteredMenuCloseCalls += 1;
  },
  getFlag() {
    return null;
  },
  visibleDebtorCampaigns(debtor) {
    return debtor.campaigns || [];
  },
  formatCampaignFocPackage() {
    return '';
  },
  newSkuKpiEntryCount() {
    return 0;
  },
};
vm.createContext(filteredExportContext);
vm.runInContext([
  'var DATA = globalThis.DATA;',
  'var currentAgent = globalThis.currentAgent;',
  extractFunction('safeExportText'),
  extractFunction('safeExportFilenamePart'),
  extractFunction('fullDebtorExportCampaigns'),
  extractFunction('campaignNamesForDebtorExport'),
  extractFunction('campaignFocForDebtorExport'),
  extractFunction('numericExportValue'),
  extractFunction('exportMonthName'),
  extractFunction('debtorBirthdayExportValue'),
  extractFunction('debtorBirthdayThisMonthExportValue'),
  extractFunction('debtorAccountStatusExportValue'),
  extractFunction('debtorAreaExportValue'),
  extractFunction('buildFullDebtorExportRows'),
  exportFilteredDebtorListExcelSource,
].join('\n'), filteredExportContext);
const originalBuildFilteredRows = filteredExportContext.buildFullDebtorExportRows;
filteredExportContext.buildFullDebtorExportRows = (agent, dataArg, debtorOverride) => {
  filteredBuildCalls.push({ agent, month: dataArg?.current_month, debtorOverride });
  return originalBuildFilteredRows(agent, dataArg, debtorOverride);
};

filteredExportContext.exportFilteredDebtorListExcel();
assert.strictEqual(filteredBuildCalls.length, 1, 'filtered export should build rows once');
assert.strictEqual(filteredBuildCalls[0].agent, 'JAMES', 'filtered export should use the selected agent');
assert.strictEqual(filteredBuildCalls[0].month, 'Jul 26', 'filtered export should use the selected month data');
assert.strictEqual(
  filteredBuildCalls[0].debtorOverride,
  filteredExportState.debtors,
  'filtered export should pass the complete current view as an explicit debtor override'
);
assert.strictEqual(filteredExportCalls.length, 1, 'filtered export should write one file');
assert.strictEqual(filteredExportCalls[0].rows.length, 37, 'filtered export should include every matching debtor');
assert(
  filteredExportCalls[0].rows.every(row => row['Debtor Type'] === 'Converter'),
  'filtered export should map the current Converter debtor rows'
);
assert.strictEqual(filteredExportCalls[0].sheetName, 'Filtered Debtor List');
assert.strictEqual(filteredExportCalls[0].baseName, 'MD_Filtered_Debtor_List_JAMES_Jul_26');
assert.strictEqual(filteredMenuCloseCalls, 1, 'successful filtered export should close the menu');

filteredExportState = {
  agent: 'JAMES',
  month: 'Jul 26',
  debtors,
  labels: [],
  active: false,
};
filteredExportContext.exportFilteredDebtorListExcel();
assert(
  filteredAlerts.at(-1).includes('Apply a filter or search'),
  'filtered export should require an active filter or search'
);
assert.strictEqual(filteredExportCalls.length, 1, 'no-filter guard should not export another file');

filteredExportContext.currentAgent = '';
filteredExportContext.exportFilteredDebtorListExcel();
assert.strictEqual(filteredAlerts.at(-1), 'Select an agent first.');
assert.strictEqual(filteredExportCalls.length, 1, 'no-agent guard should not export');

filteredExportContext.currentAgent = 'JAMES';
filteredExportState = null;
const stateReadsBeforeStale = filteredStateReads;
filteredExportContext.exportFilteredDebtorListExcel();
assert.strictEqual(filteredRenderCalls, 1, 'stale filtered export should render debtors once before re-reading state');
assert.strictEqual(
  filteredStateReads - stateReadsBeforeStale,
  2,
  'stale filtered export should re-read state once after rendering'
);
assert.strictEqual(filteredAlerts.at(-1), 'Debtor list is still loading.');
assert.strictEqual(filteredExportCalls.length, 1, 'stale filtered export should remain blocked');

filteredExportState = {
  agent: 'JAMES',
  month: 'Jul 26',
  debtors: [],
  labels: ['Type: Converter'],
  active: true,
};
filteredExportContext.exportFilteredDebtorListExcel();
assert.strictEqual(filteredAlerts.at(-1), 'No matching debtors to export.');
assert.strictEqual(filteredExportCalls.length, 1, 'zero-match filtered export should remain blocked');

const exportMenuElements = Object.fromEntries([
  'debtor-export-match-count',
  'debtor-export-filter-labels',
  'debtor-export-filtered',
  'debtor-filtered-export-help',
  'debtor-filtered-export-count',
  'debtor-export-full',
  'debtor-full-export-count',
].map(id => [id, { id, textContent: '', disabled: false }]));
const fullMenuDebtors = [...converterDebtors, activeShopDebtor, pendingConverterDebtor];
let exportMenuState = {
  agent: 'JAMES',
  month: 'Jul 26',
  debtors: converterDebtors,
  labels: ['Type: Converter'],
  active: true,
};
const exportMenuContext = {
  DATA: {
    current_month: 'Jul 26',
    agents: { JAMES: { debtor_cards: { debtors: fullMenuDebtors } } },
  },
  currentAgent: 'JAMES',
  document: {
    getElementById(id) {
      return exportMenuElements[id] || null;
    },
  },
  getCurrentDebtorExportView() {
    return exportMenuState;
  },
};
vm.createContext(exportMenuContext);
vm.runInContext([
  'var DATA = globalThis.DATA;',
  'var currentAgent = globalThis.currentAgent;',
  extractFunction('updateDebtorExportMenu'),
].join('\n'), exportMenuContext);

exportMenuContext.updateDebtorExportMenu();
assert.strictEqual(exportMenuElements['debtor-export-match-count'].textContent, '37 matching debtors');
assert.strictEqual(exportMenuElements['debtor-export-filter-labels'].textContent, 'Type: Converter');
assert.strictEqual(exportMenuElements['debtor-filtered-export-count'].textContent, '37');
assert.strictEqual(exportMenuElements['debtor-full-export-count'].textContent, '39');
assert.strictEqual(exportMenuElements['debtor-filtered-export-help'].textContent, 'Uses current filters and search');
assert.strictEqual(exportMenuElements['debtor-export-filtered'].disabled, false);
assert.strictEqual(exportMenuElements['debtor-export-full'].disabled, false);

exportMenuState = {
  agent: 'JAMES',
  month: 'Jul 26',
  debtors: fullMenuDebtors,
  labels: [],
  active: false,
};
exportMenuContext.updateDebtorExportMenu();
assert.strictEqual(exportMenuElements['debtor-export-match-count'].textContent, '39 debtors');
assert.strictEqual(exportMenuElements['debtor-export-filter-labels'].textContent, 'No filters active');
assert.strictEqual(exportMenuElements['debtor-filtered-export-help'].textContent, 'No filters active');
assert.strictEqual(exportMenuElements['debtor-filtered-export-count'].textContent, '39');
assert.strictEqual(exportMenuElements['debtor-export-filtered'].disabled, true);
assert.strictEqual(exportMenuElements['debtor-export-full'].disabled, false);

exportMenuState = null;
exportMenuContext.updateDebtorExportMenu();
assert.strictEqual(exportMenuElements['debtor-export-match-count'].textContent, 'Preparing debtor list');
assert.strictEqual(exportMenuElements['debtor-export-filter-labels'].textContent, 'Select agent or wait for loading');
assert.strictEqual(exportMenuElements['debtor-filtered-export-help'].textContent, 'Loading debtor list');
assert.strictEqual(exportMenuElements['debtor-filtered-export-count'].textContent, '0');
assert.strictEqual(exportMenuElements['debtor-full-export-count'].textContent, '0');
assert.strictEqual(exportMenuElements['debtor-export-filtered'].disabled, true);
assert.strictEqual(exportMenuElements['debtor-export-full'].disabled, true);

const missingMenuDomContext = {
  DATA: null,
  currentAgent: null,
  document: { getElementById() { return null; } },
  getCurrentDebtorExportView() { return null; },
};
vm.createContext(missingMenuDomContext);
vm.runInContext([
  'var DATA = globalThis.DATA;',
  'var currentAgent = globalThis.currentAgent;',
  extractFunction('updateDebtorExportMenu'),
].join('\n'), missingMenuDomContext);
assert.doesNotThrow(
  () => missingMenuDomContext.updateDebtorExportMenu(),
  'menu updates should tolerate missing DOM nodes'
);

const menuFocusCalls = [];
let debtorMenuDocument;
const menuToggleElement = {
  attributes: { 'aria-expanded': 'false' },
  getAttribute(name) { return this.attributes[name]; },
  setAttribute(name, value) { this.attributes[name] = String(value); },
  focus() {
    debtorMenuDocument.activeElement = this;
    menuFocusCalls.push('toggle');
  },
};
const filteredMenuItem = {
  id: 'debtor-export-filtered',
  disabled: false,
  focus() {
    debtorMenuDocument.activeElement = this;
    menuFocusCalls.push(this.id);
  },
};
const fullMenuItem = {
  id: 'debtor-export-full',
  disabled: false,
  focus() {
    debtorMenuDocument.activeElement = this;
    menuFocusCalls.push(this.id);
  },
};
const menuPopupElement = {
  hidden: true,
  querySelectorAll(selector) {
    assert.strictEqual(selector, '[role="menuitem"]');
    return [filteredMenuItem, fullMenuItem];
  },
};
const debtorMenuListeners = { click: [], keydown: [] };
debtorMenuDocument = {
  activeElement: menuToggleElement,
  getElementById(id) {
    if (id === 'debtor-download-toggle') return menuToggleElement;
    if (id === 'debtor-download-menu') return menuPopupElement;
    return null;
  },
  addEventListener(type, listener) {
    debtorMenuListeners[type].push(listener);
  },
};
const debtorMenuContext = {
  document: debtorMenuDocument,
};
vm.createContext(debtorMenuContext);
vm.runInContext([
  'let debtorDownloadMenuEventsBound = false;',
  extractFunction('debtorDownloadEnabledMenuItems'),
  extractFunction('setDebtorDownloadMenuOpen'),
  extractFunction('toggleDebtorDownloadMenu'),
  extractFunction('closeDebtorDownloadMenu'),
  extractFunction('bindDebtorDownloadMenuEvents'),
].join('\n'), debtorMenuContext);

let propagationStops = 0;
debtorMenuContext.toggleDebtorDownloadMenu({ stopPropagation() { propagationStops += 1; } });
assert.strictEqual(propagationStops, 1, 'toggle should stop click propagation');
assert.strictEqual(menuToggleElement.attributes['aria-expanded'], 'true');
assert.strictEqual(menuPopupElement.hidden, false);
assert.strictEqual(menuFocusCalls.at(-1), 'debtor-export-filtered', 'opening should focus the first enabled item');
debtorMenuContext.bindDebtorDownloadMenuEvents();
debtorMenuContext.bindDebtorDownloadMenuEvents();
assert.strictEqual(debtorMenuListeners.click.length, 1, 'outside-click binding should be installed once');
assert.strictEqual(debtorMenuListeners.keydown.length, 1, 'menu keyboard binding should be installed once');
debtorMenuListeners.click[0]({ target: { closest() { return {}; } } });
assert.strictEqual(menuPopupElement.hidden, false, 'clicks inside the wrapper should leave the menu open');
debtorMenuListeners.click[0]({ target: { closest() { return null; } } });
assert.strictEqual(menuPopupElement.hidden, true, 'outside clicks should close the menu');

filteredMenuItem.disabled = true;
debtorMenuContext.setDebtorDownloadMenuOpen(true);
assert.strictEqual(menuFocusCalls.at(-1), 'debtor-export-full', 'opening should skip disabled menuitems');
filteredMenuItem.disabled = false;
debtorMenuContext.setDebtorDownloadMenuOpen(true);

function pressDebtorMenuKey(key) {
  let prevented = 0;
  debtorMenuListeners.keydown[0]({
    key,
    preventDefault() { prevented += 1; },
  });
  return prevented;
}

assert.strictEqual(pressDebtorMenuKey('ArrowDown'), 1);
assert.strictEqual(menuFocusCalls.at(-1), 'debtor-export-full');
pressDebtorMenuKey('ArrowDown');
assert.strictEqual(menuFocusCalls.at(-1), 'debtor-export-filtered', 'ArrowDown should wrap enabled items');
pressDebtorMenuKey('ArrowUp');
assert.strictEqual(menuFocusCalls.at(-1), 'debtor-export-full', 'ArrowUp should wrap enabled items');
pressDebtorMenuKey('Home');
assert.strictEqual(menuFocusCalls.at(-1), 'debtor-export-filtered');
pressDebtorMenuKey('End');
assert.strictEqual(menuFocusCalls.at(-1), 'debtor-export-full');
assert.strictEqual(pressDebtorMenuKey('Tab'), 0, 'Tab should preserve native focus progression');
assert.strictEqual(menuPopupElement.hidden, true, 'Tab should close the menu');

debtorMenuContext.setDebtorDownloadMenuOpen(true);
assert.strictEqual(pressDebtorMenuKey('Escape'), 1);
assert.strictEqual(menuPopupElement.hidden, true, 'Escape should close the menu');
assert.strictEqual(menuFocusCalls.at(-1), 'toggle', 'Escape should restore focus to the toggle');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function transitionScopeData(month, debtorCodesByAgent) {
  return {
    current_month: month,
    working_days: {},
    agents: Object.fromEntries(Object.entries(debtorCodesByAgent).map(([agent, debtorCodes]) => [
      agent,
      {
        debtor_cards: {
          debtors: debtorCodes.map(code => ({
            debtor_code: code,
            company_name: `${month} ${code}`,
            debtor_type: 'Converter',
          })),
        },
      },
    ])),
  };
}

function transitionMonthData(month, debtorCodes) {
  return transitionScopeData(month, { JAMES: debtorCodes });
}

(async () => {
  const transitionMenuElements = Object.fromEntries([
    'debtor-export-match-count',
    'debtor-export-filter-labels',
    'debtor-export-filtered',
    'debtor-filtered-export-help',
    'debtor-filtered-export-count',
    'debtor-export-full',
    'debtor-full-export-count',
  ].map(id => [id, { id, textContent: '', disabled: false, style: {} }]));
  const transitionAgentSelect = {
    value: 'JAMES',
    innerHTML: '',
    options: [],
    appendChild(option) {
      this.options.push(option);
    },
  };
  const transitionDom = {
    ...transitionMenuElements,
    'agent-select': transitionAgentSelect,
    'month-badge': { textContent: '' },
    'day-prog': { textContent: '' },
    'month-selector-agent': { value: 'jun26' },
    'debtor-search': { value: '', placeholder: '', style: {} },
    'search-clear-btn': { style: {} },
    'global-search-results': { style: {} },
    'debtor-list': { style: {} },
  };
  const transitionFetchRequests = [];
  const transitionAlerts = [];
  const transitionExports = [];
  const transitionAdminMonths = [];
  const transitionAdminContext = {
    setWorkingMonth(month) {
      transitionAdminMonths.push(month);
    },
  };
  let transitionRenderDebtorsCalls = 0;
  let transitionRenderAllCalls = 0;
  let transitionRenderNoAgentCalls = 0;
  const transitionContext = {
    DATA: transitionMonthData('Jun 26', ['300-OLD']),
    AVAILABLE_MONTHS: ['Jun 26', 'Jul 26', 'Aug 26', 'Oct 26'],
    currentAgent: 'JAMES',
    filters: { status: 'all', special: null, pending_activation: null, type: 'all', brand: 'all' },
    currentPage: 1,
    openBrandPenetration: new Set(),
    MONTHS_WITH_DATA: ['jun26', 'jul26', 'aug26', 'oct26'],
    CURRENT_MONTH_SLUG: 'jun26',
    window: { REPO_RAW: 'https://example.invalid/raw', CACHE_V: '1', MDAdminContext: transitionAdminContext },
    MDAdminContext: transitionAdminContext,
    document: {
      getElementById(id) {
        return transitionDom[id] || null;
      },
      createElement() {
        return { value: '', textContent: '' };
      },
      querySelectorAll() {
        return [];
      },
    },
    DashboardApi: {
      loadData(month) {
        const deferred = createDeferred();
        transitionFetchRequests.push({ month, ...deferred });
        return deferred.promise.then(async response => {
          if (!response || typeof response !== 'object' || !Object.prototype.hasOwnProperty.call(response, 'ok')) {
            return response;
          }
          if (!response.ok) throw new Error('Not found');
          const data = await response.json();
          return {
            month: data.current_month || month,
            availableMonths: transitionContext.AVAILABLE_MONTHS,
            data,
          };
        });
      },
    },
    fetch() {
      throw new Error('generic snapshot fetch is forbidden');
    },
    monthLabelFromSlug(slug) {
      return {
        jun26: 'Jun 26',
        jul26: 'Jul 26',
        aug26: 'Aug 26',
        sep26: 'Sep 26',
        oct26: 'Oct 26',
      }[slug] || slug;
    },
    monthSlug(month) {
      return String(month || '').replace(' ', '').toLowerCase();
    },
    latestAvailableMonth(months, fallback) {
      return months[months.length - 1] || fallback;
    },
    applySalesLiveStaticConfig: async dataArg => dataArg,
    enrichMonthBreakdownsFromAnalysis: async dataArg => dataArg,
    SupabaseKpiSync: { apply: async dataArg => dataArg },
    ensureBirthdayOverridesForMonth: async () => ({}),
    SalesLiveCampaignSync: { apply: async () => 0 },
    prepareAuthorizedDashboardData: async dataArg => dataArg,
    commitDashboardEnvelope(result, options) {
      transitionContext.DATA = result.data;
      transitionContext.AVAILABLE_MONTHS = result.availableMonths || [];
      transitionContext.MONTHS_WITH_DATA = transitionContext.AVAILABLE_MONTHS.map(
        month => transitionContext.monthSlug(month)
      );
      transitionContext.CURRENT_MONTH_SLUG = options.requestedSlug;
      transitionContext.currentAgent = result.data?.agents?.[options.desiredAgent]
        ? options.desiredAgent
        : '';
    },
    applyBirthdayTargetsToAgentKpi() {},
    renderGroupBrandTargets() {},
    buildTypeChipRow() {},
    resetUnpurchasedFilters() {},
    saveLastAgentSelection() {},
    cleanDashboardCacheBusterParam() {},
    updateFutureViewBanner() {},
    closeDebtorDownloadMenu() {},
    safeExportFilenamePart(value) {
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    },
    buildFullDebtorExportRows(agent, dataArg, debtorOverride) {
      const selected = Array.isArray(debtorOverride)
        ? debtorOverride
        : dataArg?.agents?.[agent]?.debtor_cards?.debtors || [];
      return selected.map(debtor => ({ 'Debtor Code': debtor.debtor_code }));
    },
    exportDebtorRows(rows, sheetName, baseName) {
      transitionExports.push({ rows: Array.from(rows), sheetName, baseName });
    },
    alert(message) {
      transitionAlerts.push(message);
    },
  };
  transitionContext.renderDebtors = () => {
    transitionRenderDebtorsCalls += 1;
    const selected = transitionContext.DATA?.agents?.[transitionContext.currentAgent]?.debtor_cards?.debtors || [];
    return transitionContext.publishDebtorExportView(selected, { labels: ['Stray render'], active: true });
  };
  transitionContext.renderAll = () => {
    transitionRenderAllCalls += 1;
    const selected = transitionContext.DATA?.agents?.[transitionContext.currentAgent]?.debtor_cards?.debtors || [];
    return transitionContext.publishDebtorExportView(selected, {
      labels: [`Month: ${transitionContext.DATA?.current_month || ''}`],
      active: true,
    });
  };
  transitionContext.renderNoAgentState = () => {
    transitionRenderNoAgentCalls += 1;
    transitionContext.resetDebtorExportView();
  };

  vm.createContext(transitionContext);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var AVAILABLE_MONTHS = globalThis.AVAILABLE_MONTHS;',
    'var currentAgent = globalThis.currentAgent;',
    'var filters = globalThis.filters;',
    'var currentPage = globalThis.currentPage;',
    'var openBrandPenetration = globalThis.openBrandPenetration;',
    'var MONTHS_WITH_DATA = globalThis.MONTHS_WITH_DATA;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    "var dropCtnFilter = 'all';",
    "var dropSkuFilter = 'all';",
    "var gainCtnFilter = 'all';",
    "var gainSkuFilter = 'all';",
    "var nonvipTypeFilter = 'all';",
    'var window = globalThis.window;',
    'var document = globalThis.document;',
    'let debtorExportTransitionVersion = 0;',
    'let debtorExportPendingTransition = null;',
    'let debtorExportViewState = createEmptyDebtorExportViewState();',
    extractFunction('createEmptyDebtorExportViewState'),
    ...debtorExportLifecycleSources(),
    extractFunction('uniqueDebtorsByCode'),
    extractFunction('publishDebtorExportView'),
    extractFunction('resetDebtorExportView'),
    extractFunction('getCurrentDebtorExportView'),
    extractFunction('updateDebtorExportMenu'),
    extractFunction('exportFullDebtorListExcel'),
    extractFunction('exportFilteredDebtorListExcel'),
    extractFunction('monthSortKey'),
    extractFunction('resolvePublishedBaseMonth'),
    extractFunction('isDashboardAuthorizationError'),
    extractFunction('isCampaignActiveInMonth'),
    extractFunction('monthLabelToIso'),
    extractFunction('isHistoricalMonth'),
    extractFunction('shouldIncludeLiveCampaignForSales'),
    extractFunction('retainFutureGeneratedCampaignFallbacks'),
    extractFunction('selectAgent'),
    extractFunction('switchMonth'),
  ].join('\n'), transitionContext);

  transitionContext.publishDebtorExportView(
    transitionContext.DATA.agents.JAMES.debtor_cards.debtors,
    { labels: ['Month: Jun 26'], active: false }
  );
  const pendingSwitch = transitionContext.switchMonth('jul26');
  assert.strictEqual(transitionFetchRequests.length, 1, 'switchMonth should pause on the deferred month fetch');

  const directPendingPublication = transitionContext.publishDebtorExportView(
    transitionContext.DATA.agents.JAMES.debtor_cards.debtors,
    { labels: ['Stale direct publication'], active: true }
  );
  const renderPendingPublication = transitionContext.renderDebtors();
  transitionContext.exportFullDebtorListExcel();
  transitionContext.exportFilteredDebtorListExcel();

  assert.strictEqual(
    directPendingPublication,
    null,
    'pending month transition should refuse direct stale publication'
  );
  assert.strictEqual(
    renderPendingPublication,
    null,
    'pending month transition should refuse publication from a stray render'
  );
  assert.strictEqual(
    typeof transitionContext.isDebtorExportTransitionPending,
    'function',
    'dashboard should expose a production pending-transition helper'
  );
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), true);
  assert.strictEqual(transitionContext.getCurrentDebtorExportView(), null);
  assert.strictEqual(transitionExports.length, 0, 'both exports should remain blocked during month loading');
  assert.deepStrictEqual(
    transitionAlerts.slice(-2),
    ['Debtor list is still loading.', 'Debtor list is still loading.'],
    'both export actions should report loading during the transition'
  );
  assert.strictEqual(transitionMenuElements['debtor-export-filtered'].disabled, true);
  assert.strictEqual(transitionMenuElements['debtor-export-full'].disabled, true);
  assert.strictEqual(transitionMenuElements['debtor-filtered-export-count'].textContent, '0');
  assert.strictEqual(transitionMenuElements['debtor-full-export-count'].textContent, '0');
  assert.strictEqual(transitionMenuElements['debtor-export-match-count'].textContent, 'Preparing debtor list');
  assert.strictEqual(transitionRenderDebtorsCalls, 2, 'explicit and filtered-export renders should both stay blocked');

  const julyData = transitionMonthData('Jul 26', ['300-JUL-1', '300-JUL-2']);
  transitionFetchRequests[0].resolve({ ok: true, json: async () => julyData });
  await pendingSwitch;

  const julyState = transitionContext.getCurrentDebtorExportView();
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), false);
  assert.strictEqual(transitionContext.DATA.current_month, 'Jul 26');
  assert.strictEqual(julyState?.agent, 'JAMES');
  assert.strictEqual(julyState?.month, 'Jul 26');
  assert.deepStrictEqual(
    Array.from(julyState?.debtors || [], debtor => debtor.debtor_code),
    ['300-JUL-1', '300-JUL-2'],
    'final render should publish only the requested month debtors'
  );
  assert.strictEqual(transitionRenderAllCalls, 1, 'requested month should render once after transition completion');
  assert.strictEqual(transitionMenuElements['debtor-export-filtered'].disabled, false);
  assert.strictEqual(transitionMenuElements['debtor-export-full'].disabled, false);

  const renderCountBeforeOverlap = transitionRenderAllCalls;
  const olderSwitch = transitionContext.switchMonth('jun26');
  const olderRequest = transitionFetchRequests[1];
  const newerSwitch = transitionContext.switchMonth('aug26');
  const newerRequest = transitionFetchRequests[2];
  olderRequest.resolve({ ok: true, json: async () => transitionMonthData('Jun 26', ['300-STALE']) });
  await olderSwitch;
  assert.strictEqual(
    transitionContext.isDebtorExportTransitionPending(),
    true,
    'older month completion must not unlock a newer transition'
  );
  assert.strictEqual(transitionContext.DATA.current_month, 'Jul 26');
  assert.strictEqual(transitionRenderAllCalls, renderCountBeforeOverlap, 'older request must not render over latest');

  newerRequest.resolve({ ok: true, json: async () => transitionMonthData('Aug 26', ['300-AUG']) });
  await newerSwitch;
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), false);
  assert.strictEqual(transitionContext.DATA.current_month, 'Aug 26');
  assert.strictEqual(transitionRenderAllCalls, renderCountBeforeOverlap + 1);
  assert.strictEqual(transitionContext.getCurrentDebtorExportView()?.month, 'Aug 26');

  const renderCountBeforeFuture = transitionRenderAllCalls;
  const futureRequestStart = transitionFetchRequests.length;
  const futureSwitch = transitionContext.switchMonth('sep26');
  const futureRequest = transitionFetchRequests[futureRequestStart];
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), true);
  assert.strictEqual(
    transitionContext.DATA.current_month,
    'Aug 26',
    'future transition should prepare a separate view without mutating current DATA before awaits finish'
  );
  futureRequest.resolve({
    ok: true,
    json: async () => transitionMonthData('Aug 26', ['300-AUG']),
  });
  await futureSwitch;
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), false);
  assert.strictEqual(transitionContext.DATA.current_month, 'Sep 26');
  assert.strictEqual(transitionContext.DATA.is_future_view, true);
  assert.strictEqual(transitionRenderAllCalls, renderCountBeforeFuture + 1);
  assert.strictEqual(transitionContext.getCurrentDebtorExportView()?.month, 'Sep 26');

  const renderCountBeforeError = transitionRenderAllCalls;
  const failedRequestStart = transitionFetchRequests.length;
  const failedSwitch = transitionContext.switchMonth('oct26');
  const failedRequest = transitionFetchRequests[failedRequestStart];
  failedRequest.reject(new Error('network down'));
  await failedSwitch;
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), false);
  assert.strictEqual(transitionContext.DATA.current_month, 'Sep 26');
  assert.strictEqual(transitionContext.getCurrentDebtorExportView()?.month, 'Sep 26');
  assert.strictEqual(
    transitionRenderAllCalls,
    renderCountBeforeError + 1,
    'current transition failure should republish the last coherent view'
  );
  assert(transitionAlerts.at(-1).includes('Could not load data for oct26'));

  const staleToken = transitionContext.beginDebtorExportTransition();
  const latestToken = transitionContext.beginDebtorExportTransition();
  assert.strictEqual(transitionContext.completeDebtorExportTransition(staleToken), false);
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), true);
  assert.strictEqual(transitionContext.isCurrentDebtorExportTransition(latestToken), true);
  assert.strictEqual(transitionContext.completeDebtorExportTransition(latestToken), true);
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), false);

  transitionContext.DATA = transitionScopeData('Jun 26', {
    JAMES: ['300-JUN-JAMES'],
    CJ: [],
  });
  transitionContext.currentAgent = 'JAMES';
  transitionContext.CURRENT_MONTH_SLUG = 'jun26';
  transitionAgentSelect.value = 'JAMES';
  transitionDom['month-selector-agent'].value = 'jun26';
  transitionContext.renderAll();
  const crossPathFetchStart = transitionFetchRequests.length;
  const crossPathAdminStart = transitionAdminMonths.length;
  const crossPathExportsStart = transitionExports.length;
  transitionDom['month-selector-agent'].value = 'jul26';
  const crossPathSwitch = transitionContext.switchMonth('jul26');
  const crossPathMonthRequest = transitionFetchRequests[crossPathFetchStart];

  transitionContext.selectAgent('CJ');
  assert.strictEqual(
    transitionFetchRequests.length,
    crossPathFetchStart + 1,
    'agent selection during month loading must not fetch an old-month fallback'
  );
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), true);
  assert.strictEqual(transitionContext.currentAgent, 'CJ');
  assert.strictEqual(transitionAgentSelect.value, 'CJ');
  assert.strictEqual(
    transitionDom['month-selector-agent'].value,
    'jun26',
    'month selector should continue to describe committed DATA while loading'
  );
  assert.strictEqual(
    transitionAdminMonths.slice(crossPathAdminStart).includes('Jul 26'),
    false,
    'admin context should not move to the requested month before DATA commits'
  );
  assert.strictEqual(transitionContext.getCurrentDebtorExportView(), null);
  transitionContext.exportFullDebtorListExcel();
  assert.strictEqual(transitionExports.length, crossPathExportsStart);

  crossPathMonthRequest.resolve({
    ok: true,
    json: async () => transitionScopeData('Jul 26', {
      JAMES: ['300-JUL-JAMES'],
      CJ: ['300-JUL-CJ-1', '300-JUL-CJ-2'],
    }),
  });
  await crossPathSwitch;
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), false);
  assert.strictEqual(transitionContext.DATA.current_month, 'Jul 26');
  assert.strictEqual(transitionContext.CURRENT_MONTH_SLUG, 'jul26');
  assert.strictEqual(transitionContext.currentAgent, 'CJ');
  assert.strictEqual(transitionAgentSelect.value, 'CJ');
  assert.strictEqual(transitionDom['month-selector-agent'].value, 'jul26');
  assert.strictEqual(transitionAdminMonths.at(-1), 'Jul 26');
  assert.deepStrictEqual(
    Array.from(transitionContext.getCurrentDebtorExportView()?.debtors || [], debtor => debtor.debtor_code),
    ['300-JUL-CJ-1', '300-JUL-CJ-2'],
    'month commit should publish only the latest desired agent from requested-month DATA'
  );

  const rapidFetchStart = transitionFetchRequests.length;
  const rapidSwitch = transitionContext.switchMonth('aug26');
  const rapidMonthRequest = transitionFetchRequests[rapidFetchStart];
  transitionContext.selectAgent('JAMES');
  transitionContext.selectAgent('CJ');
  transitionContext.selectAgent('JAMES');
  assert.strictEqual(
    transitionFetchRequests.length,
    rapidFetchStart + 1,
    'rapid desired-agent changes must remain attached to the month request'
  );
  rapidMonthRequest.resolve({
    ok: true,
    json: async () => transitionScopeData('Aug 26', {
      JAMES: ['300-AUG-JAMES'],
      CJ: ['300-AUG-CJ'],
    }),
  });
  await rapidSwitch;
  assert.strictEqual(transitionContext.currentAgent, 'JAMES');
  assert.strictEqual(transitionAgentSelect.value, 'JAMES');
  assert.deepStrictEqual(
    Array.from(transitionContext.getCurrentDebtorExportView()?.debtors || [], debtor => debtor.debtor_code),
    ['300-AUG-JAMES'],
    'latest desired agent should win when selection changes rapidly during month loading'
  );

  transitionContext.DATA = transitionScopeData('Aug 26', {
    JAMES: ['300-AUG-JAMES'],
    CJ: [],
  });
  transitionContext.currentAgent = 'CJ';
  transitionContext.CURRENT_MONTH_SLUG = 'aug26';
  transitionAgentSelect.value = 'CJ';
  transitionDom['month-selector-agent'].value = 'aug26';
  const reverseFetchStart = transitionFetchRequests.length;
  const staleAgentFallback = transitionContext.selectAgent('CJ');
  const staleAgentRequest = transitionFetchRequests[reverseFetchStart];
  assert(staleAgentFallback && typeof staleAgentFallback.then === 'function');
  const reverseMonthSwitch = transitionContext.switchMonth('jul26');
  const reverseMonthRequest = transitionFetchRequests[reverseFetchStart + 1];
  reverseMonthRequest.resolve({
    ok: true,
    json: async () => transitionScopeData('Jul 26', {
      JAMES: ['300-NEW-JAMES'],
      CJ: ['300-NEW-CJ'],
    }),
  });
  await reverseMonthSwitch;
  const rendersAfterReverseMonth = transitionRenderAllCalls;
  staleAgentRequest.resolve({
    ok: true,
    json: async () => transitionScopeData('Aug 26', { CJ: ['300-STALE-FALLBACK'] }),
  });
  await staleAgentFallback;
  assert.strictEqual(transitionContext.DATA.current_month, 'Jul 26');
  assert.strictEqual(transitionContext.currentAgent, 'CJ');
  assert.strictEqual(transitionRenderAllCalls, rendersAfterReverseMonth);
  assert.deepStrictEqual(
    Array.from(transitionContext.DATA.agents.CJ.debtor_cards.debtors, debtor => debtor.debtor_code),
    ['300-NEW-CJ'],
    'stale agent fallback must not merge or render over a newer month scope'
  );
  assert.strictEqual(transitionContext.getCurrentDebtorExportView()?.month, 'Jul 26');

  transitionContext.DATA = transitionScopeData('Jul 26', { CJ: [] });
  transitionContext.currentAgent = 'CJ';
  transitionContext.CURRENT_MONTH_SLUG = 'jul26';
  transitionAgentSelect.value = 'CJ';
  const staleFailureFetchStart = transitionFetchRequests.length;
  const staleFailedFallback = transitionContext.selectAgent('CJ');
  const staleFailedRequest = transitionFetchRequests[staleFailureFetchStart];
  const recoveryMonthSwitch = transitionContext.switchMonth('aug26');
  const recoveryMonthRequest = transitionFetchRequests[staleFailureFetchStart + 1];
  recoveryMonthRequest.resolve({
    ok: true,
    json: async () => transitionScopeData('Aug 26', { CJ: ['300-RECOVERED-CJ'] }),
  });
  await recoveryMonthSwitch;
  const alertsBeforeStaleFailure = transitionAlerts.length;
  const rendersBeforeStaleFailure = transitionRenderAllCalls;
  staleFailedRequest.reject(new Error('stale fallback failed'));
  await staleFailedFallback;
  assert.strictEqual(transitionAlerts.length, alertsBeforeStaleFailure);
  assert.strictEqual(transitionRenderAllCalls, rendersBeforeStaleFailure);
  assert.strictEqual(transitionContext.DATA.current_month, 'Aug 26');
  assert.deepStrictEqual(
    Array.from(transitionContext.DATA.agents.CJ.debtor_cards.debtors, debtor => debtor.debtor_code),
    ['300-RECOVERED-CJ'],
    'stale failed agent token must not alter the current scope'
  );

  const missingFetchStart = transitionFetchRequests.length;
  const missingAgentSwitch = transitionContext.switchMonth('jun26');
  const missingAgentRequest = transitionFetchRequests[missingFetchStart];
  transitionContext.selectAgent('MISSING');
  missingAgentRequest.resolve({
    ok: true,
    json: async () => transitionScopeData('Jun 26', { JAMES: ['300-JUN-ONLY'] }),
  });
  await missingAgentSwitch;
  assert.strictEqual(transitionContext.isDebtorExportTransitionPending(), false);
  assert.strictEqual(transitionContext.DATA.current_month, 'Jun 26');
  assert.strictEqual(transitionContext.currentAgent, '');
  assert.strictEqual(transitionAgentSelect.value, '');
  assert.strictEqual(transitionContext.getCurrentDebtorExportView(), null);
  assert(transitionRenderNoAgentCalls > 0, 'missing desired agent should settle into the no-agent state');

  assert.strictEqual(
    typeof transitionContext.getDebtorExportTransition,
    'function',
    'transition lifecycle should expose current metadata for coordinated scope changes'
  );
  const metadataToken = transitionContext.beginDebtorExportTransition({
    kind: 'month',
    requestedMonthSlug: 'jul26',
    desiredAgent: 'JAMES',
  });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(transitionContext.getDebtorExportTransition(metadataToken))),
    { token: metadataToken, kind: 'month', requestedMonthSlug: 'jul26', desiredAgent: 'JAMES' }
  );
  assert.strictEqual(transitionContext.updateDebtorExportTransitionDesiredAgent(metadataToken, 'CJ'), true);
  assert.strictEqual(transitionContext.getDebtorExportTransition(metadataToken).desiredAgent, 'CJ');
  assert.strictEqual(transitionContext.completeDebtorExportTransition(metadataToken), true);

  const agentMenuElements = Object.fromEntries([
    'debtor-export-match-count',
    'debtor-export-filter-labels',
    'debtor-export-filtered',
    'debtor-filtered-export-help',
    'debtor-filtered-export-count',
    'debtor-export-full',
    'debtor-full-export-count',
  ].map(id => [id, { id, textContent: '', disabled: false, style: {} }]));
  const agentDom = {
    ...agentMenuElements,
    'debtor-search': { value: '', placeholder: '', style: {} },
    'search-clear-btn': { style: {} },
    'global-search-results': { style: {} },
    'debtor-list': { style: {} },
  };
  const agentFetchRequests = [];
  let agentRenderAllCalls = 0;
  let agentRenderNoAgentCalls = 0;
  const agentErrors = [];
  const agentAlerts = [];
  const agentExports = [];
  const agentContext = {
    DATA: transitionMonthData('Jul 26', []),
    currentAgent: null,
    filters: { status: 'all', special: null, pending_activation: null, type: 'all', brand: 'all' },
    currentPage: 1,
    openBrandPenetration: new Set(),
    CURRENT_MONTH_SLUG: 'jul26',
    window: { REPO_RAW: 'https://example.invalid/raw', CACHE_V: '1' },
    document: {
      getElementById(id) {
        return agentDom[id] || null;
      },
      querySelectorAll() {
        return [];
      },
    },
    DashboardApi: {
      loadData(month) {
        const deferred = createDeferred();
        agentFetchRequests.push({ month, ...deferred });
        return deferred.promise.then(async response => {
          if (!response || typeof response !== 'object' || !Object.prototype.hasOwnProperty.call(response, 'ok')) {
            return response;
          }
          if (!response.ok) throw new Error('Not found');
          const data = await response.json();
          return { month, availableMonths: [], data };
        });
      },
    },
    fetch() {
      throw new Error('generic snapshot fetch is forbidden');
    },
    saveLastAgentSelection() {},
    resetUnpurchasedFilters() {},
    buildTypeChipRow() {},
    alert(message) {
      agentAlerts.push(message);
    },
    safeExportFilenamePart(value) {
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    },
    buildFullDebtorExportRows(agent, dataArg) {
      return (dataArg?.agents?.[agent]?.debtor_cards?.debtors || []).map(debtor => ({
        'Debtor Code': debtor.debtor_code,
      }));
    },
    exportDebtorRows(...args) {
      agentExports.push(args);
    },
    closeDebtorDownloadMenu() {},
    console: { error(error) { agentErrors.push(error); } },
  };
  agentContext.renderAll = () => {
    agentRenderAllCalls += 1;
    const selected = agentContext.DATA?.agents?.[agentContext.currentAgent]?.debtor_cards?.debtors || [];
    return agentContext.publishDebtorExportView(selected, { labels: [], active: false });
  };
  agentContext.renderNoAgentState = () => {
    agentRenderNoAgentCalls += 1;
    agentContext.resetDebtorExportView();
  };

  vm.createContext(agentContext);
  vm.runInContext([
    'var DATA = globalThis.DATA;',
    'var currentAgent = globalThis.currentAgent;',
    'var filters = globalThis.filters;',
    'var currentPage = globalThis.currentPage;',
    'var openBrandPenetration = globalThis.openBrandPenetration;',
    'var CURRENT_MONTH_SLUG = globalThis.CURRENT_MONTH_SLUG;',
    'var window = globalThis.window;',
    'var document = globalThis.document;',
    'let debtorExportTransitionVersion = 0;',
    'let debtorExportPendingTransition = null;',
    'let debtorExportViewState = createEmptyDebtorExportViewState();',
    extractFunction('createEmptyDebtorExportViewState'),
    ...debtorExportLifecycleSources(),
    extractFunction('uniqueDebtorsByCode'),
    extractFunction('publishDebtorExportView'),
    extractFunction('resetDebtorExportView'),
    extractFunction('getCurrentDebtorExportView'),
    extractFunction('updateDebtorExportMenu'),
    extractFunction('exportFullDebtorListExcel'),
    extractFunction('selectAgent'),
  ].join('\n'), agentContext);

  const fallbackSelection = agentContext.selectAgent('JAMES');
  assert(fallbackSelection && typeof fallbackSelection.then === 'function', 'fallback selection should return its fetch');
  assert.strictEqual(agentContext.isDebtorExportTransitionPending(), true);
  assert.strictEqual(
    agentContext.publishDebtorExportView([{ debtor_code: '300-STALE-AGENT' }], { active: true }),
    null,
    'agent fallback should reject publication while its fetch is pending'
  );
  agentFetchRequests[0].resolve({
    ok: true,
    json: async () => transitionMonthData('Jul 26', ['300-AGENT-1', '300-AGENT-2']),
  });
  await fallbackSelection;
  assert.strictEqual(agentContext.isDebtorExportTransitionPending(), false);
  assert.strictEqual(agentRenderAllCalls, 1);
  assert.deepStrictEqual(
    Array.from(agentContext.getCurrentDebtorExportView()?.debtors || [], debtor => debtor.debtor_code),
    ['300-AGENT-1', '300-AGENT-2']
  );

  agentContext.DATA = transitionMonthData('Jul 26', []);
  const failedSelection = agentContext.selectAgent('JAMES');
  agentFetchRequests[1].reject(new Error('fallback failed'));
  await failedSelection;
  assert.strictEqual(agentContext.isDebtorExportTransitionPending(), false);
  assert.strictEqual(agentContext.getCurrentDebtorExportView()?.agent, 'JAMES');
  assert.strictEqual(agentContext.getCurrentDebtorExportView()?.month, 'Jul 26');
  assert.deepStrictEqual(Array.from(agentContext.getCurrentDebtorExportView()?.debtors || []), []);
  assert.strictEqual(agentMenuElements['debtor-export-filtered'].disabled, true);
  assert.strictEqual(agentMenuElements['debtor-export-full'].disabled, false);
  assert.strictEqual(agentMenuElements['debtor-full-export-count'].textContent, '0');
  assert.strictEqual(agentRenderAllCalls, 2, 'failed fallback should render a coherent selected-agent empty state');
  assert(agentAlerts.at(-1).includes('retry'), 'failed fallback should give the user a retry-capable signal');
  assert.strictEqual(agentErrors.length, 1);
  agentContext.exportFullDebtorListExcel();
  assert.strictEqual(agentAlerts.at(-1), 'No debtors to export for this agent.');
  assert.strictEqual(agentExports.length, 0);

  agentContext.DATA = transitionMonthData('Jul 26', ['300-IMMEDIATE']);
  agentContext.selectAgent('JAMES');
  assert.strictEqual(agentContext.isDebtorExportTransitionPending(), false);
  assert.strictEqual(agentRenderAllCalls, 3, 'immediate agent data should render synchronously after transition end');
  assert.deepStrictEqual(
    Array.from(agentContext.getCurrentDebtorExportView()?.debtors || [], debtor => debtor.debtor_code),
    ['300-IMMEDIATE']
  );

  delete agentDom['debtor-list'];
  assert.doesNotThrow(
    () => agentContext.selectAgent('JAMES'),
    'agent selection should tolerate a missing debtor-list node'
  );
  assert.strictEqual(agentRenderAllCalls, 4);

  agentContext.selectAgent('');
  assert.strictEqual(agentContext.isDebtorExportTransitionPending(), false);
  assert.strictEqual(agentContext.getCurrentDebtorExportView(), null);
  assert.strictEqual(agentRenderNoAgentCalls, 1, 'no-agent selection should end before rendering its empty state');

  console.log('sales_filtered_debtor_export.test.cjs passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
