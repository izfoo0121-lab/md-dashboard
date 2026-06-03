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
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

assert(html.includes('function normalizeFocUnitDisplay'), 'Sales Dashboard should normalize FOC units for display');
assert(html.includes('function formatCampaignFocPackage'), 'Sales Dashboard should format exact per-debtor FOC packages');
assert(html.includes('FOC:'), 'Sales Dashboard debtor/campaign cards should display exact FOC package text');
assert(html.includes('function initialViewFromUrl'), 'Sales Dashboard should read ?view= from URL');
assert(html.includes('function applyInitialViewFromUrl'), 'Sales Dashboard should apply initial URL view after load');
assert(html.includes("'camps'"), 'Sales Dashboard should allow campaigns view deep link');
assert(html.includes("foc_item_2") && html.includes("foc_qty_2") && html.includes("foc_unit_2"), 'Sales Dashboard should display second debtor FOC line');
assert(html.includes('campaignVisibleForSelectedMonth'), 'Sales Dashboard should filter expired campaigns against the selected month');
assert(html.includes('filter(campaignVisibleForSelectedMonth)'), 'Debtor campaign badges should hide campaigns expired before the selected month');
assert(html.includes('function isFocClaimCampaign'), 'Sales Dashboard should classify pure FOC/gift claim campaigns separately from conversion campaigns');
assert(html.includes('Show FOC claim list') && html.includes('Hide FOC claim list'), 'FOC campaigns should use claim-list toggle wording');
assert.strictEqual(
  (html.match(/renderCampaignDebtorPanel\(c\)/g) || []).length,
  1,
  'FOC campaign cards should not append the shared conversion debtor panel'
);

const context = { DATA: { current_month: 'Jun 26' } };
vm.createContext(context);
vm.runInContext([
  'const DATA = globalThis.DATA;',
  extractFunction('isCampaignActiveInMonth'),
  extractFunction('isConversionCampaign'),
  extractFunction('isFocClaimCampaign'),
  extractFunction('isVisibleDebtorCampaign'),
  extractFunction('campaignVisibleForSelectedMonth'),
  extractFunction('visibleDebtorCampaigns'),
].join('\n'), context);

assert.strictEqual(
  context.isFocClaimCampaign({ type: 'other', mechanism_type: 'delivery_gift' }),
  true,
  'Delivery gift mechanisms should render as FOC claim lists even when the campaign type is generic'
);
assert.strictEqual(
  context.isFocClaimCampaign({ type: 'conversion_simple', mechanism_type: 'delivery_gift' }),
  false,
  'Conversion campaigns with FOC rewards should keep the conversion details renderer'
);

const debtor = {
  campaigns: [
    { id: 'may-expired', type: 'free_sample', created_at: '2026-05-01', deadline: '2026-05-31' },
    { id: 'jun-active', type: 'free_sample', created_at: '2026-05-01', deadline: '2026-06-30' },
    { id: 'jun-closed', type: 'free_sample', active: false, created_at: '2026-06-01', deadline: '2026-06-30' },
    { id: 'jun-lookback-conversion', type: 'conversion_simple', created_at: '2026-05-01', deadline: '2026-06-30', lookback_ctn: 5 },
  ],
};

assert.deepStrictEqual(
  context.visibleDebtorCampaigns(debtor).map(c => c.id),
  ['jun-active'],
  'June debtor cards should hide expired May campaigns and already-converted lookback campaigns'
);

context.DATA.current_month = 'May 26';
assert.deepStrictEqual(
  context.visibleDebtorCampaigns(debtor).map(c => c.id),
  ['may-expired', 'jun-active'],
  'May history should still show campaigns active in May'
);

console.log('sales_foc_campaign.test.cjs passed');
