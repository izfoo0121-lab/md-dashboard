const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');

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

const context = {
  DATA: {
    current_month: 'Jun 26',
    brand_penetration_filter_options: {
      item_code_values: ['SKNR', 'SKNW', 'CMX', 'CMP', 'DPM EVO']
    }
  },
  UNPURCHASED_SKU_PRIORITY: ['SKNR', 'SKNW', 'CMX', 'CMP', 'DPM EVO', 'IFACE R'],
  UNPURCHASED_BRAND_ITEMS: {
    IFACE: ['IFACE B', 'IFACE M'],
    SUKUN: ['SKNR', 'SKNW']
  }
};
vm.createContext(context);

[
  'shiftedMonthLabel',
  'normalizeSkuItemCode',
  'getDebtorPurchaseBreakdown',
  'getUnpurchasedSkuCatalog',
  'skuRecencyMonths',
  'skuCtnInMonth',
  'summarizeDebtorSkuRecency',
  'matchesSkuRecencyMode'
].forEach(name => vm.runInContext(extractFunction(name), context));

const catalog = context.getUnpurchasedSkuCatalog([
  {
    month_breakdown: {
      'Jun 26': [{ item: 'IFACE R', ctn: 1 }]
    }
  }
]);

assert(catalog.includes('CMX'), 'SKU item catalog should include generated item codes beyond ZLB presets');
assert(catalog.includes('IFACE R'), 'SKU item catalog should include item codes found in debtor month breakdowns');
assert(!catalog.includes('SUKUN'), 'SKU item catalog should not include brand/group labels as selectable SKU items');

const rows = {
  buyerPrevOnly: {
    debtor_code: '300-A001',
    month_breakdown: {
      'Jun 26': [{ item: 'SKNR', ctn: 0 }],
      'May 26': [{ item: 'SKNR', ctn: 2 }],
      'Apr 26': [{ item: 'SKNW', ctn: 5 }],
      'Mar 26': []
    }
  },
  buyerCurrentOnly: {
    debtor_code: '300-B002',
    month_breakdown: {
      'Jun 26': [{ item: 'SKNR', ctn: 3 }],
      'May 26': [],
      'Apr 26': [],
      'Mar 26': []
    }
  },
  nonBuyer: {
    debtor_code: '300-C003',
    month_breakdown: {
      'Jun 26': [{ item: 'SKNW', ctn: 4 }],
      'May 26': [{ item: 'CMX', ctn: 1 }],
      'Apr 26': [],
      'Mar 26': []
    }
  },
  sknwOnly: {
    debtor_code: '300-D004',
    month_breakdown: {
      'Jun 26': [],
      'May 26': [{ item: 'SKNW', ctn: 4 }],
      'Apr 26': [],
      'Mar 26': []
    }
  }
};

const summary = context.summarizeDebtorSkuRecency(rows.buyerPrevOnly, 'SKNR', 'Jun 26');
assert.strictEqual(summary.prev3Ctn, 2, 'summary should total previous three months for the selected exact SKU');
assert.strictEqual(summary.currentCtn, 0, 'summary should keep current month CTN separate');
assert.strictEqual(summary.lastPurchaseMonth, 'May 26', 'summary should expose the latest purchase month for the selected SKU');

assert.strictEqual(
  context.matchesSkuRecencyMode(rows.nonBuyer, 'SKNR', 'not_bought', 'Jun 26'),
  true,
  '未购买 should include debtors with zero selected SKU CTN across previous 3 months plus current month'
);
assert.strictEqual(
  context.matchesSkuRecencyMode(rows.buyerCurrentOnly, 'SKNR', 'not_bought', 'Jun 26'),
  false,
  '未购买 should exclude debtors who bought the selected SKU in the current month'
);
assert.strictEqual(
  context.matchesSkuRecencyMode(rows.buyerPrevOnly, 'SKNR', 'bought_3m', 'Jun 26'),
  true,
  '三个月内购买 should include debtors who bought the selected SKU in the previous three months'
);
assert.strictEqual(
  context.matchesSkuRecencyMode(rows.buyerCurrentOnly, 'SKNR', 'bought_3m', 'Jun 26'),
  false,
  '三个月内购买 should not count current-month-only purchases'
);
assert.strictEqual(
  context.matchesSkuRecencyMode(rows.buyerPrevOnly, 'SKNW', 'bought_3m', 'Jun 26'),
  true,
  'exact SKU matching should allow SKNW to be checked separately from SKNR'
);
assert.strictEqual(
  context.matchesSkuRecencyMode(rows.sknwOnly, 'SKNR', 'bought_3m', 'Jun 26'),
  false,
  'exact SKU matching should not count SKNW as a SKNR purchase'
);

console.log('sales_unpurchased_sku_filter.test.cjs passed');
