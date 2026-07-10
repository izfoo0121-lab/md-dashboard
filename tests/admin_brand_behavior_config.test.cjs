const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} should exist`);
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

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert(start >= 0, `${startMarker} should exist`);
  const end = html.indexOf(endMarker, start);
  assert(end > start, `${endMarker} should appear after ${startMarker}`);
  return html.slice(start, end);
}

function makeElement(id) {
  return {
    id,
    innerHTML: '',
    value: '',
    style: {},
    dataset: {},
  };
}

assert.equal(html.includes('id="brand-behavior-config"'), true, 'Admin should expose brand behavior config controls');
assert.equal(html.includes('id="zlb-brand-effective-preview"'), true, 'Admin should expose an effective ZLB brand preview');
assert.equal(html.includes('addZlbBrandConfig'), true, 'Admin ZLB section should expose an add control');
assert.equal(html.includes('removeZlbBrandConfig'), true, 'Admin ZLB section should expose a remove control');
assert.match(html, /penetration_auto_brands/, 'Admin should persist configurable auto brand list');
assert.match(html, /zlb_brands/, 'Admin should persist configurable ZLB brand list');

const elements = new Map([
  ['brand-behavior-config', makeElement('brand-behavior-config')],
  ['brand-sku-behavior-summary', makeElement('brand-sku-behavior-summary')],
  ['admin-brand-sku-status', makeElement('admin-brand-sku-status')],
  ['admin-brand-sku-drilldown', makeElement('admin-brand-sku-drilldown')],
  ['zlb-brand-effective-preview', makeElement('zlb-brand-effective-preview')],
  ['zlb-new-brand', makeElement('zlb-new-brand')],
  ['brand-sku-forms', makeElement('brand-sku-forms')],
]);

const context = {
  AGENTS: ['BEN'],
  DEFAULT_BRAND_CONFIG: {
    iFACE: ['IFACE B', 'IFACE M', 'IFACE R', 'IFACE DB'],
    SUKUN: ['SKNR', 'SKNW'],
    CMP: ['CMP'],
    EVO: ['EVO'],
    BISON: ['BISON-G', 'BISON-R', 'BISON-M'],
    TR20: ['TR20'],
    'LAM+LWM': ['LAM', 'LWM'],
  },
  DEFAULT_BRANDS: ['iFACE', 'SUKUN', 'CMP', 'EVO', 'BISON', 'TR20', 'LAM+LWM'],
  DEFAULT_PENETRATION_AUTO_BRANDS: ['iFACE', 'CMP', 'BISON', 'TR20'],
  DEFAULT_ZLB_BRANDS: ['SUKUN', 'EVO', 'BISON', 'LAM+LWM'],
  ZLB_IFACE_REMOVED_FROM_MONTH: 'Jul 26',
  ADMIN_ZLB_EXCLUDED_BRANDS: new Set(['CMP']),
  CONFIG: {
    brand_config: {
      iFACE: ['IFACE B'],
      SUKUN: ['SKNR'],
      CMP: ['CMP'],
      BISON: ['BISON-R'],
      TR20: ['TR20'],
    },
    penetration_auto_brands: ['iFACE', 'CMP', 'BISON', 'TR20'],
    zlb_brands: ['SUKUN', 'CMP', 'BISON'],
    penetration_snapshots: {
      'Jun 26': {
        BEN: { iFACE: 10, SUKUN: 20, CMP: 40, BISON: 0, TR20: 5 },
      },
      'Sep 26': {
        BEN: { iFACE: 99, SUKUN: 99, CMP: 99, BISON: 99, TR20: 99 },
      },
    },
    agents: {
      BEN: {
        brand_commission: {
          iFACE: { penetration_target: 1, pen_auto: true },
          SUKUN: { penetration_target: 7, pen_auto: false },
          CMP: { penetration_target: 2, pen_auto: true },
          BISON: { penetration_target: 0, pen_auto: true },
          TR20: { penetration_target: 1, pen_auto: true },
        },
      },
    },
  },
  DASH_DATA: {},
  document: {
    getElementById(id) { return elements.get(id) || null; },
  },
  Blob,
  URL: {
    createObjectURL() { return 'blob:test'; },
    revokeObjectURL() {},
  },
  updateRawJSON() { context.rawUpdated = true; },
  getAdminWorkingMonth() { return context.ADMIN_ACTIVE_MONTH || 'Jul 26'; },
  adminMonthSortKey(month) {
    const [mon, yy] = String(month || '').split(' ');
    const idx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(mon);
    return idx < 0 ? NaN : (2000 + parseInt(yy || '0', 10)) * 12 + idx + 1;
  },
  ADMIN_ACTIVE_MONTH: 'Jul 26',
  console,
  renderInhouseCodes() {},
  renderSkuTraceConfig() {},
  renderNewSkuRulesEditor() {},
  renderSkuRulesPreview() {},
};
context.window = context;
vm.createContext(context);
vm.runInContext(extractBlock('const MD_ADMIN_GROUP', 'const BRAND_PEN_GROUP_MAP_KEY'), context);
vm.runInContext(extractBlock('const DEFAULT_GROUP_BRAND_CONFIG', 'function renderGroupBrandForms'), context);

[
  'kpiAdminEscape',
  'kpiAdminJsLiteral',
  'kpiAdminEventArg',
  'adminBrandKey',
  'adminBrandDomId',
  'adminBrandListFromValue',
  'adminDefaultBrandConfig',
  'adminBrandKeys',
  'adminBrandSortKey',
  'adminSortBrandKeys',
  'adminConfiguredBrandList',
  'adminIsZlbExcludedBrand',
  'adminConfiguredZlbBrands',
  'adminEffectiveZlbBrands',
  'adminBrandCodesForMapping',
  'refreshZlbBrandConfigViews',
  'renderEffectiveZlbBrandPreview',
  'addZlbBrandConfig',
  'removeZlbBrandConfig',
  'normalizeGroupBrandKey',
  'normalizeGroupBrandCodes',
  'normalizeGroupBrandConfig',
  'applyAgentReplacementsToConfig',
  'normalizeAdminConfigDefaults',
  'adminLatestSnapshotMonth',
  'adminBrandSnapshotSelection',
  'adminBrandPresetKey',
  'adminBrandMatchValues',
  'adminBrandDebtorCardLookup',
  'adminBrandReason',
  'adminBrandCandidateArraysForData',
  'adminBrandCandidateArrays',
  'adminBrandNormalizeCandidateRow',
  'adminBrandGeneratedCandidateRows',
  'adminBrandNonBuyerRows',
  'adminBrandGeneratedCandidateCount',
  'adminBrandNonBuyerCount',
  'adminBrandDisplayNonBuyer',
  'renderBrandSkuBehaviorSummary',
  'renderBrandBehaviorConfig',
  'updateBrandBehaviorList',
  'renderAdminBrandSKU',
  'adminBrandDrilldownRowHtml',
  'renderAdminBrandNonBuyerDrilldown',
  'openAdminBrandNonBuyerDrilldown',
  'closeAdminBrandNonBuyerDrilldown',
  'adminBrandCsvSafeValue',
  'adminBrandDrilldownCsvCell',
  'exportAdminBrandNonBuyers',
  'renderSKUForms',
  'skuChip',
  'brandPenetrationNormKey',
  'brandPenetrationTypeExcluded',
  'brandPenetrationCsvCell',
].forEach(name => vm.runInContext(extractFunction(name), context));

context.renderBrandBehaviorConfig();
assert.match(
  elements.get('brand-behavior-config').innerHTML,
  /iFACE, CMP, BISON, TR20/,
  'Admin editor should show configured Auto brand list',
);
assert.match(
  elements.get('brand-behavior-config').innerHTML,
  /SUKUN, BISON/,
  'Admin editor should show configured ZLB brand list without CMP',
);
assert.doesNotMatch(
  elements.get('brand-behavior-config').innerHTML,
  /SUKUN, CMP, BISON/,
  'CMP should not be accepted as a ZLB brand because it belongs to Group Brand Target',
);

context.renderSKUForms();
let zlbPreviewHtml = elements.get('zlb-brand-effective-preview').innerHTML;
assert.match(zlbPreviewHtml, /Effective for[\s\S]*Jul 26/, 'ZLB preview should name the working month');
assert.match(zlbPreviewHtml, /SUKUN/, 'Jul ZLB preview should show configured ZLB brands');
assert.match(zlbPreviewHtml, /id="zlb-new-brand"/, 'ZLB preview should include an add input in the ZLB section');
assert.match(zlbPreviewHtml, /removeZlbBrandConfig/, 'ZLB preview should render remove controls for configured ZLB brands');
assert.doesNotMatch(zlbPreviewHtml, /iFACE/, 'Jul ZLB preview should not show historical iFACE');
assert.doesNotMatch(zlbPreviewHtml, /CMP/, 'Jul ZLB preview should not show CMP as a ZLB brand');

elements.get('zlb-new-brand').value = 'CMX';
context.addZlbBrandConfig();
assert.deepEqual(context.CONFIG.zlb_brands, ['SUKUN', 'BISON', 'CMX'], 'Adding in ZLB section should update config.zlb_brands');
assert.deepEqual(context.CONFIG.brand_config.CMX, [], 'Adding a new ZLB brand should create an empty global item mapping for it');
assert.match(elements.get('brand-sku-forms').innerHTML, /CMX/, 'Adding a ZLB brand should refresh the global mapping editor');
assert.strictEqual(context.rawUpdated, true, 'Adding a ZLB brand should mark raw JSON dirty');

elements.get('zlb-new-brand').value = 'CMP';
context.addZlbBrandConfig();
assert.deepEqual(context.CONFIG.zlb_brands, ['SUKUN', 'BISON', 'CMX'], 'CMP should not be addable as a ZLB brand');

context.removeZlbBrandConfig('BISON');
assert.deepEqual(context.CONFIG.zlb_brands, ['SUKUN', 'CMX'], 'Removing in ZLB section should update config.zlb_brands');

context.ADMIN_ACTIVE_MONTH = 'Jun 26';
context.renderSKUForms();
zlbPreviewHtml = elements.get('zlb-brand-effective-preview').innerHTML;
assert.match(zlbPreviewHtml, /iFACE/, 'Historical ZLB preview should retain iFACE before Jul 26');
assert.doesNotMatch(zlbPreviewHtml, /CMP/, 'Historical ZLB preview should still exclude CMP');

context.renderAdminBrandSKU();
const tableHtml = elements.get('admin-brand-sku-status').innerHTML;
assert.match(tableHtml, /CMP/, 'Brand SKU status should render configured CMP column');
assert.match(tableHtml, /SUKUN/, 'Brand SKU status should still render non-auto configured SUKUN column');
assert.match(tableHtml, /Manual/, 'Brand SKU status should mark non-auto brands as Manual');
assert.match(tableHtml, /Snapshot month:[\s\S]*Jun 26/, 'Brand SKU status should use the selected working month snapshot when available');
assert.match(tableHtml, />40</, 'Brand SKU status should show the working month CMP non-buyer count');
assert.doesNotMatch(tableHtml, /Working month Jun 26 has no penetration snapshot/, 'Brand SKU status should not warn when the selected month snapshot exists');
assert.match(elements.get('brand-sku-behavior-summary').innerHTML, /CMP/, 'Summary should mention CMP as Auto');
const autoSummary = elements.get('brand-sku-behavior-summary').innerHTML.split('Manual:')[0];
assert.doesNotMatch(autoSummary, /SUKUN/, 'Summary should not list SUKUN as Auto');

context.CONFIG.penetration_snapshots = {
  'May 26': { BEN: { CMP: 88 } },
};
context.ADMIN_ACTIVE_MONTH = 'Jun 26';
context.renderAdminBrandSKU();
const fallbackHtml = elements.get('admin-brand-sku-status').innerHTML;
assert.match(fallbackHtml, /Snapshot month:[\s\S]*May 26/, 'Brand SKU status should fall back to latest valid snapshot when working month is missing');
assert.match(fallbackHtml, /Working month Jun 26 has no penetration snapshot; showing May 26 snapshot/, 'Brand SKU status should make fallback snapshot explicit');

context.CONFIG.penetration_snapshots = {
  'Jun 26': { BEN: { CMP: 1 } },
};
context.ADMIN_ACTIVE_MONTH = 'Jun 26';
context.DASH_DATA = {
  current_month: 'Jun 26',
  brand_penetration_candidates_by_month: {
    CMP: {
      'Jun 26': [
        { debtor_code: '300-A', debtor_name: 'Alpha Shop', agent: 'BEN', debtor_type: 'SH-Shop', eligibility_reason: '3-month no CMP' },
        { debtor_code: '300-B', debtor_name: 'Other Agent', agent: 'CJ', debtor_type: 'SH-Shop', eligibility_reason: '3-month no CMP' },
      ],
    },
  },
  agents: {
    BEN: {
      debtor_cards: {
        debtors: [{ debtor_code: '300-A', company_name: 'Alpha Shop Card', last_purchase_date: '10/06/2026' }],
      },
    },
  },
};
context.renderAdminBrandSKU();
const clickableHtml = elements.get('admin-brand-sku-status').innerHTML;
assert.match(clickableHtml, /data-admin-brand-drilldown/, 'Brand SKU status should expose clickable Not Bought cells');
context.openAdminBrandNonBuyerDrilldown('BEN', 'CMP', 'Jun 26', 1);
const drilldownHtml = elements.get('admin-brand-sku-drilldown').innerHTML;
assert.match(drilldownHtml, /BEN \/ CMP \/ Jun 26/, 'Brand SKU drilldown should show selected agent, brand, and month');
assert.match(drilldownHtml, /300-A/, 'Brand SKU drilldown should list generated debtor candidates for the selected agent');
assert.doesNotMatch(drilldownHtml, /300-B/, 'Brand SKU drilldown should not mix another agent into Group2A agent view');

context.updateBrandBehaviorList('penetration_auto_brands', 'CMP, TR20');
assert.deepEqual(context.CONFIG.penetration_auto_brands, ['CMP', 'TR20']);
context.updateBrandBehaviorList('zlb_brands', 'SUKUN, CMP, CMX');
assert.deepEqual(context.CONFIG.zlb_brands, ['SUKUN', 'CMX']);

context.CONFIG.brand_config = {
  'BAD" onclick="alert(1)': ['SKU"><img src=x>'],
};
context.renderSKUForms();
const skuHtml = elements.get('brand-sku-forms').innerHTML;
assert.doesNotMatch(skuHtml, /<img/i, 'Brand SKU forms should HTML-escape SKU labels from config');
assert.doesNotMatch(skuHtml, /onclick="alert/i, 'Brand SKU forms should not allow brand keys to break inline handlers');
assert.match(skuHtml, /&quot;/, 'Brand SKU forms should encode quotes in rendered config values');

console.log('admin_brand_behavior_config.test.cjs passed');
