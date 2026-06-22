const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name, occurrence = 'first') {
  const matches = [];
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const start = html.indexOf(`function ${name}`, searchFrom);
    if (start < 0) break;
    let depth = 0;
    let seenBody = false;
    for (let i = start; i < html.length; i += 1) {
      const ch = html[i];
      if (ch === '{') {
        depth += 1;
        seenBody = true;
      } else if (ch === '}') {
        depth -= 1;
        if (seenBody && depth === 0) {
          matches.push(html.slice(start, i + 1));
          searchFrom = i + 1;
          break;
        }
      }
    }
    if (searchFrom <= start) break;
  }
  assert(matches.length, `${name} should exist`);
  return occurrence === 'last' ? matches[matches.length - 1] : matches[0];
}

const elements = {
  'brand-pen-values': { value: 'IFACE, IFACE B, IFACE M, IFACE R, IFACE DB, 8COM, LG22' },
  'brand-pen-exclude-types': { value: 'Personal, End User' },
  'new-camp-lookback-months': { value: 'May 26, Apr 26, Mar 26' },
  'new-camp-qualifying-item': { value: '' },
  'brand-pen-match-select': { innerHTML: '' },
  'brand-pen-match-chips': { innerHTML: '' },
  'brand-pen-type-options': { innerHTML: '' },
  'brand-pen-lookback-options': { innerHTML: '' },
};

const context = {
  document: { getElementById: id => elements[id] || null },
  window: {},
  DASH_DATA: {
    brand_penetration_filter_options: {
      item_group_values: ['IFACE', '8COM', 'LG22'],
      item_code_values: [],
      match_values: [],
      debtor_types: ['P-Personal', 'SH-Shop'],
      months: ['Jun 26', 'May 26', 'Apr 26', 'Mar 26'],
    },
    brand_penetration_presets: {},
  },
  _campCsv: value => String(value || '').split(',').map(v => v.trim()).filter(Boolean),
  setNewCampaignField: (id, value) => {
    if (elements[id]) elements[id].value = value;
  },
  _adminCurrentMonthDate: () => '2026-06-01',
  getAdminWorkingMonth: () => 'Jun 26',
};

vm.createContext(context);
vm.runInContext([
  extractFunction('kpiAdminEscape'),
  extractFunction('kpiAdminJsLiteral'),
  'const BRAND_PENETRATION_BUILTIN_PRESETS = { IFACE: { label: "IFACE", match_values: ["IFACE", "IFACE B", "IFACE M", "IFACE R", "IFACE DB"] } };',
  extractFunction('adminPreviousMonthLabels'),
  extractFunction('brandPenetrationUnique'),
  extractFunction('brandPenetrationMonthAnchor'),
  extractFunction('sortBrandPenetrationMonths'),
  extractFunction('getBrandPenetrationFilterOptions'),
  extractFunction('brandPenetrationOptionGroup'),
  extractFunction('brandPenetrationSelectedValues'),
  extractFunction('setBrandPenetrationCsvField'),
  extractFunction('syncBrandPenetrationSelectorFields'),
  extractFunction('renderBrandPenetrationOptionSelectors', 'last'),
  extractFunction('removeBrandPenetrationMatchValue'),
].join('\n'), context);

context.renderBrandPenetrationOptionSelectors();

assert(
  elements['brand-pen-match-chips'].innerHTML.includes('data-value="IFACE" onclick="removeBrandPenetrationMatchValue(this.dataset.value)"'),
  'Match chip remove handlers should read the value from a data attribute'
);
assert(
  !elements['brand-pen-match-chips'].innerHTML.includes('onclick="removeBrandPenetrationMatchValue("IFACE")'),
  'Match chip remove handlers should not nest double quotes inside a double-quoted attribute'
);

context.removeBrandPenetrationMatchValue('IFACE');
assert.deepStrictEqual(
  context.brandPenetrationSelectedValues('brand-pen-values'),
  ['IFACE B', 'IFACE M', 'IFACE R', 'IFACE DB', '8COM', 'LG22'],
  'Removing IFACE in Custom mode should update the stored match values'
);

context.removeBrandPenetrationMatchValue('IFACE B');
assert.deepStrictEqual(
  context.brandPenetrationSelectedValues('brand-pen-values'),
  ['IFACE M', 'IFACE R', 'IFACE DB', '8COM', 'LG22'],
  'Removing IFACE variants should also work after the chip list re-renders'
);

console.log('admin_brand_penetration_chips.test.cjs passed');
