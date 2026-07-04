const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const salesHtml = fs.readFileSync(path.join(root, 'sales_dashboard.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert(start >= 0, `${name} should exist`);
  const bodyStart = source.indexOf('{', source.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const renderDebtorCard = extractFunction(salesHtml, 'renderDebtorCard');
assert(
  renderDebtorCard.includes('newSkuItemChipEntries'),
  'debtor card should render right-side New SKU item chips from a dedicated helper',
);
assert(
  renderDebtorCard.includes('new-sku-panel'),
  'debtor card should place New SKU item chips in a separate right-side panel',
);

const context = {
  DATA: {
    current_month: 'Jul 26',
    config: {
      sku_rules_snapshot: {
        new_sku_groups: {
          SUKUN: { item_code_prefixes: ['SKN'], item_groups: ['SUKUN'] },
          CMP: { item_codes: ['CMP'], item_groups: ['CMP'] },
          CMX: { item_codes: ['CMX'], item_groups: ['CMX'] },
          TR12: { item_code_prefixes: ['TR-002', 'TR12'] },
          LF: { item_code_prefixes: ['LF'] },
          TR20: { item_code_prefixes: ['TR20'] },
        },
      },
    },
  },
};
vm.createContext(context);
vm.runInContext(extractFunction(salesHtml, 'monthSortKey'), context);
vm.runInContext(extractFunction(salesHtml, 'shiftedMonthLabel'), context);
const helperStart = salesHtml.indexOf('const ZLB_IFACE_REMOVED_FROM_MONTH');
const helperEnd = salesHtml.indexOf('function monthSlug', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'dashboard helper block should be extractable');
vm.runInContext(salesHtml.slice(helperStart, helperEnd), context);

const debtor = {
  new_sku_count: 2,
  new_sku_status: { SUKUN: 'new', CMP: 'new', CMX: 'none', TR12: 'existing' },
  month_breakdown: {
    'Jul 26': [
      { item: 'SKNR', ctn: 1 },
      { item: 'SKNW', ctn: 1 },
      { item: 'CMP', ctn: 2 },
      { item: 'CMLT', ctn: 3 },
      { item: 'TR-002', ctn: 1 },
    ],
    'Jun 26': [],
    'May 26': [],
    'Apr 26': [],
  },
};

const entries = context.newSkuItemChipEntries(debtor);
assert.deepStrictEqual(
  Array.from(entries, entry => entry.label),
  ['SKNR', 'SKNW', 'CMP', 'TR-002', '其他'],
  'right-side chips should show actual configured New SKU items bought this month plus CMLT as other',
);
assert.deepStrictEqual(
  Array.from(entries, entry => entry.item),
  ['SKNR', 'SKNW', 'CMP', 'TR-002', 'CMLT'],
  'chip metadata should preserve the source item code for tooltip/export safety',
);
assert.deepStrictEqual(
  Array.from(entries, entry => entry.kpi),
  [true, true, true, false, false],
  'only first-time New SKU items should count toward the New SKU KPI',
);
assert.deepStrictEqual(
  Array.from(entries, entry => entry.status),
  ['new', 'new', 'new', 'existing', 'other'],
  'right-side chips should distinguish KPI-new, existing New SKU, and Other SKU',
);

const existingOnlyDebtor = {
  new_sku_count: 0,
  new_sku_status: { LF: 'existing', TR20: 'existing' },
  month_breakdown: {
    'Jul 26': [
      { item: 'LF-002', ctn: 5 },
      { item: 'TR20', ctn: 3 },
    ],
  },
};

const existingEntries = context.newSkuItemChipEntries(existingOnlyDebtor);
assert.deepStrictEqual(
  Array.from(existingEntries, entry => entry.label),
  ['LF-002', 'TR20'],
  'right-side chips should still show configured New SKU items even when the KPI count is zero',
);
assert.deepStrictEqual(
  Array.from(existingEntries, entry => entry.kpi),
  [false, false],
  'existing New SKU items should be visible but excluded from KPI count',
);
assert.deepStrictEqual(
  Array.from(existingEntries, entry => entry.status),
  ['existing', 'existing'],
  'existing New SKU items should carry an existing status for styling and tooltips',
);

console.log('sales_new_sku_item_chips.test.cjs passed');
