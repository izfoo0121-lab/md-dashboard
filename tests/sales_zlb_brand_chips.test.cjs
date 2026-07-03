const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const salesHtml = fs.readFileSync(path.join(root, 'sales_dashboard.html'), 'utf8');
const processData = fs.readFileSync(path.join(root, 'process_data.py'), 'utf8');

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

function extractPythonBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, `${startMarker} should exist`);
  const end = source.indexOf(endMarker, start);
  assert(end > start, `${endMarker} should appear after ${startMarker}`);
  return source.slice(start, end);
}

const renderDebtorCard = extractFunction(salesHtml, 'renderDebtorCard');
assert(
  renderDebtorCard.includes('ZLB Brand'),
  'debtor card chips should be labelled ZLB Brand, not generic SKU',
);
assert(
  renderDebtorCard.includes('isVisibleZlbBrandGroup'),
  'debtor card should filter visible ZLB brand groups through a dedicated helper',
);
assert(
  salesHtml.includes('function isVisibleZlbBrandGroup'),
  'sales dashboard should define a helper that applies the ZLB brand visibility cutoff',
);
assert(
  !renderDebtorCard.includes("replace('IFACE','iFACE')"),
  'debtor card should route ZLB labels through the cutoff helper instead of always showing IFACE',
);

assert(
  salesHtml.includes("const ZLB_IFACE_REMOVED_FROM_MONTH = 'Jul 26'"),
  'sales dashboard should make the IFACE removal month explicit',
);

const salesContext = {
  DATA: {
    current_month: 'Jun 26',
    config: { zlb_brands: ['SUKUN', 'EVO', 'BISON', 'LAM+LWM'] },
  },
};
vm.createContext(salesContext);
vm.runInContext(extractFunction(salesHtml, 'monthSortKey'), salesContext);
const zlbHelperStart = salesHtml.indexOf('const ZLB_IFACE_REMOVED_FROM_MONTH');
const zlbHelperEnd = salesHtml.indexOf('function monthSlug', zlbHelperStart);
assert(zlbHelperStart >= 0 && zlbHelperEnd > zlbHelperStart, 'ZLB helper block should be extractable');
vm.runInContext(salesHtml.slice(zlbHelperStart, zlbHelperEnd), salesContext);

assert.strictEqual(
  salesContext.isVisibleZlbBrandGroup('IFACE'),
  true,
  'Jun 26 historical ZLB chips should still show IFACE even when current config omits it',
);
salesContext.DATA.current_month = 'Jul 26';
assert.strictEqual(
  salesContext.isVisibleZlbBrandGroup('IFACE'),
  false,
  'Jul 26 onward ZLB chips should hide IFACE when config omits it',
);
assert.strictEqual(
  salesContext.isVisibleZlbBrandGroup('SUKUN'),
  true,
  'configured ZLB brands should remain visible after the IFACE cutoff',
);

const skuGroupsBlock = extractPythonBlock(processData, '# ZLB brand groups shown on debtor cards', '# New SKU groups');
assert(
  processData.includes('ZLB_IFACE_REMOVED_FROM_MONTH = "Jul 26"'),
  'process_data should make the IFACE removal month explicit',
);
assert(
  skuGroupsBlock.includes('zlb_brands_for_month'),
  'process_data debtor-card SKU/ZLB groups should apply the month cutoff before generating sku_status',
);

console.log('sales_zlb_brand_chips.test.cjs passed');
