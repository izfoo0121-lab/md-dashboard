const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const penetration = fs.readFileSync(
  path.join(root, 'reports', 'miracle-2a-sku-strength', 'penetration.html'),
  'utf8'
);
const gaps = fs.readFileSync(
  path.join(root, 'reports', 'miracle-2a-sku-strength', 'gap_opportunities.html'),
  'utf8'
);

const typeOrder = penetration.match(/const DEFAULT_TYPE_ORDER\s*=\s*(\[[^;]+\])/);
assert(typeOrder, 'penetration page must declare DEFAULT_TYPE_ORDER');
assert(
  JSON.parse(typeOrder[1]).includes('Converter'),
  'Converter must be selected in the default penetration debtor types'
);

const businessTypes = gaps.match(/const BUSINESS_TYPES\s*=\s*new Set\((\[[^;]+\])\)/);
assert(businessTypes, 'gap page must declare BUSINESS_TYPES');
assert(
  JSON.parse(businessTypes[1]).includes('Converter'),
  'Converter must be part of the gap page business debtor types'
);
assert(
  gaps.includes('Converter'),
  'gap page business option must make Converter discoverable'
);

console.log('sku_reports_converter.test.cjs passed');
