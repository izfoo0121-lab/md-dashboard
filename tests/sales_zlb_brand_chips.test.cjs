const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  'sales dashboard should define a helper that hides removed ZLB brands such as IFACE',
);
assert(
  !renderDebtorCard.includes("replace('IFACE','iFACE')"),
  'debtor card should not convert stale IFACE sku_status keys into visible iFACE chips',
);

const skuGroupsBlock = extractPythonBlock(processData, '# ZLB brand groups shown on debtor cards', '# New SKU groups');
assert(
  !skuGroupsBlock.includes('"IFACE"') && !skuGroupsBlock.includes("'IFACE'"),
  'process_data debtor-card SKU/ZLB groups should not include IFACE by default',
);

console.log('sales_zlb_brand_chips.test.cjs passed');
