const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}`);
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
assert.match(html, /penetration_auto_brands/, 'Admin should persist configurable auto brand list');
assert.match(html, /zlb_brands/, 'Admin should persist configurable ZLB brand list');

const elements = new Map([
  ['brand-behavior-config', makeElement('brand-behavior-config')],
  ['brand-sku-behavior-summary', makeElement('brand-sku-behavior-summary')],
  ['admin-brand-sku-status', makeElement('admin-brand-sku-status')],
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
  document: {
    getElementById(id) { return elements.get(id) || null; },
  },
  updateRawJSON() {},
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
  'normalizeGroupBrandKey',
  'normalizeGroupBrandCodes',
  'normalizeGroupBrandConfig',
  'normalizeAdminConfigDefaults',
  'renderBrandSkuBehaviorSummary',
  'renderBrandBehaviorConfig',
  'updateBrandBehaviorList',
  'renderAdminBrandSKU',
  'renderSKUForms',
  'skuChip',
].forEach(name => vm.runInContext(extractFunction(name), context));

context.renderBrandBehaviorConfig();
assert.match(
  elements.get('brand-behavior-config').innerHTML,
  /iFACE, CMP, BISON, TR20/,
  'Admin editor should show configured Auto brand list',
);
assert.match(
  elements.get('brand-behavior-config').innerHTML,
  /SUKUN, CMP, BISON/,
  'Admin editor should show configured ZLB brand list',
);

context.renderAdminBrandSKU();
const tableHtml = elements.get('admin-brand-sku-status').innerHTML;
assert.match(tableHtml, /CMP/, 'Brand SKU status should render configured CMP column');
assert.match(tableHtml, /SUKUN/, 'Brand SKU status should still render non-auto configured SUKUN column');
assert.match(tableHtml, /Manual/, 'Brand SKU status should mark non-auto brands as Manual');
assert.match(elements.get('brand-sku-behavior-summary').innerHTML, /CMP/, 'Summary should mention CMP as Auto');
const autoSummary = elements.get('brand-sku-behavior-summary').innerHTML.split('Manual:')[0];
assert.doesNotMatch(autoSummary, /SUKUN/, 'Summary should not list SUKUN as Auto');

context.updateBrandBehaviorList('penetration_auto_brands', 'CMP, TR20');
assert.deepEqual(context.CONFIG.penetration_auto_brands, ['CMP', 'TR20']);
context.updateBrandBehaviorList('zlb_brands', 'SUKUN, CMP, CMX');
assert.deepEqual(context.CONFIG.zlb_brands, ['SUKUN', 'CMP', 'CMX']);

context.CONFIG.brand_config = {
  'BAD" onclick="alert(1)': ['SKU"><img src=x>'],
};
context.renderSKUForms();
const skuHtml = elements.get('brand-sku-forms').innerHTML;
assert.doesNotMatch(skuHtml, /<img/i, 'Brand SKU forms should HTML-escape SKU labels from config');
assert.doesNotMatch(skuHtml, /onclick="alert/i, 'Brand SKU forms should not allow brand keys to break inline handlers');
assert.match(skuHtml, /&quot;/, 'Brand SKU forms should encode quotes in rendered config values');

console.log('admin_brand_behavior_config.test.cjs passed');
