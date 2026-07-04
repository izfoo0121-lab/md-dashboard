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
  renderDebtorCard.includes('new-sku-dot'),
  'debtor card should render New SKU items as status dots like the ZLB brand chips',
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
          EVO: { item_codes: ['EVO'], item_groups: ['EVO'] },
          'BISON-R': { item_codes: ['BISON-R'], item_groups: ['BISON-R'] },
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
  ['SUKUN', 'CMP', 'CMX', 'TR12', 'LF', 'TR20', 'EVO', 'BISON-R', '其他'],
  'right-side chips should show every configured New SKU item plus CMLT as other when present',
);
assert.deepStrictEqual(
  Array.from(entries, entry => entry.item),
  ['SUKUN', 'CMP', 'CMX', 'TR12', 'LF', 'TR20', 'EVO', 'BISON-R', 'CMLT'],
  'chip metadata should preserve the displayed item bucket for tooltip/export safety',
);
assert.deepStrictEqual(
  Array.from(entries, entry => entry.kpi),
  [true, true, false, true, false, false, false, false, false],
  'configured New SKU items bought this month should count toward the New SKU KPI',
);
assert.deepStrictEqual(
  Array.from(entries, entry => entry.status),
  ['new', 'new', 'none', 'new', 'none', 'none', 'none', 'none', 'other'],
  'right-side chips should distinguish current-month KPI, prior-month, unpurchased, and Other SKU',
);

const existingOnlyDebtor = {
  new_sku_count: 2,
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
  ['SUKUN', 'CMP', 'CMX', 'TR12', 'LF', 'TR20', 'EVO', 'BISON-R'],
  'right-side chips should still show every configured New SKU item even when the KPI count is zero',
);
assert.deepStrictEqual(
  Array.from(existingEntries, entry => entry.kpi),
  [false, false, false, false, true, true, false, false],
  'configured New SKU items bought this month should be visible and included in KPI count',
);
assert.deepStrictEqual(
  Array.from(existingEntries, entry => entry.status),
  ['none', 'none', 'none', 'none', 'new', 'new', 'none', 'none'],
  'current-month New SKU purchases should carry the KPI status even if older payload statuses said existing',
);

const priorOnlyDebtor = {
  new_sku_count: 0,
  new_sku_status: { LF: 'existing' },
  month_breakdown: {
    'Jul 26': [],
    'Jun 26': [{ item: 'LF-002', ctn: 4 }],
  },
};

const priorEntries = context.newSkuItemChipEntries(priorOnlyDebtor);
assert.strictEqual(
  priorEntries.find(entry => entry.label === 'LF').status,
  'existing',
  'New SKU items bought only in the prior three months should show the 3-month purchased status',
);

const repeatCurrentDebtor = {
  new_sku_count: 0,
  new_sku_status: { EVO: 'existing', 'BISON-R': 'existing' },
  month_breakdown: {
    'Jul 26': [
      { item: 'EVO', ctn: 1 },
      { item: 'BISON-R', ctn: 1 },
    ],
    'Jun 26': [
      { item: 'EVO', ctn: 10 },
      { item: 'BISON-R', ctn: 2 },
    ],
  },
};

const repeatEntries = context.newSkuItemChipEntries(repeatCurrentDebtor);
for (const label of ['EVO', 'BISON-R']) {
  const entry = repeatEntries.find(item => item.label === label);
  assert.strictEqual(entry.kpi, false, `${label} should not count KPI when bought in the prior three months`);
  assert.strictEqual(entry.status, 'existing', `${label} should show the 3-month purchased status when repeated`);
}

console.log('sales_new_sku_item_chips.test.cjs passed');
