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

assert(html.includes('function isIfaceCampaign'), 'Sales Dashboard should detect IFACE campaign cards');
assert(html.includes('function renderIfaceMissionSummary'), 'Sales Dashboard should render an action-focused IFACE mission summary');
assert(html.includes('function futureDebtorPlanningCopy'), 'Sales Dashboard should keep debtor cards visible in future planning months');
assert(html.includes('function chooseInitialMonthLabel'), 'Sales Dashboard should choose the initial month through a testable helper');
assert(!html.includes("futureViewEmptyHtml('Debtor list')"), 'Future month view should not hide the debtor list');
assert(extractFunction('renderGroupBrandTargets').includes("futureViewEmptyHtml('Group targets')"), 'Future month view should not show prior-month Group tab results');
assert(extractFunction('loadData').includes('chooseInitialMonthLabel(months, realMonth, explicitMonth)'), 'Initial load should use the device-date month helper');
assert(extractFunction('loadData').includes('const shouldShowFutureMonth = !hasPreferredMonthData'), 'Initial load should allow device-date future view when JSON is not generated yet');
assert(html.includes('eligibility_reason'), 'Sales Dashboard should show why each IFACE debtor is eligible');
assert(html.includes('IFACE PEN'), 'Sales Dashboard should show the IFACE PEN FOC note');
assert(!html.includes('IFACE group standings in Sales'), 'Sales Dashboard should not render full group PK standings');

const context = {};
vm.createContext(context);
vm.runInContext(extractFunction('getDebtorType'), context);
vm.runInContext(extractFunction('isPersonalDebtor'), context);
vm.runInContext(extractFunction('futureDebtorSummaryStats'), context);
vm.runInContext(extractFunction('futureDebtorPlanningCopy'), context);
vm.runInContext(extractFunction('chooseInitialMonthLabel'), context);

const futureCopy = context.futureDebtorPlanningCopy({
  debtor_code: '300-C516',
  is_pending_activation: true,
  ctn_cur: 9,
  rm_cur: 100,
  invoice_count_cur: 1,
  new_sku_count: 1,
  new_sku_status: { EVO: 'new', SUKUN: 'existing' },
  campaigns: [{ id: 'jun-camp', converted: true, current_ctn: 5, current_rm: 50 }]
});

assert.strictEqual(futureCopy.new_sku_count, 0, 'Future planning debtor copy should not leak prior-month new SKU count');
assert.strictEqual(Object.keys(futureCopy.new_sku_status || {}).length, 0, 'Future planning debtor copy should not show prior-month new SKU badges');
assert.strictEqual(futureCopy.ctn_cur, 0, 'Future planning debtor copy should zero selected-month CTN');
assert.strictEqual(futureCopy.is_pending_activation, false, 'Future planning debtor copy should not carry prior-month pending activation flags');
assert.strictEqual(futureCopy.campaigns[0].converted, false, 'Future planning campaign copy should reset conversion state');

const futureSummary = context.futureDebtorSummaryStats(
  {},
  [
    { debtor_type: 'SH-Shop' },
    { debtor_type: 'P-Personal' },
    { debtor_type: 'FL-Freelancer' }
  ]
);
assert.strictEqual(futureSummary.total, 2, 'Future summary should count non-Personal debtors when generated activation base is unavailable');
assert.strictEqual(futureSummary.inactive, 0, 'Future summary should not show stale pending activation totals');

const futureSummaryWithBase = context.futureDebtorSummaryStats(
  { total_debtors: 159, activation_base_live: 159, pending_activation: 60 },
  new Array(265).fill(0).map(() => ({ debtor_type: 'SH-Shop' }))
);
assert.strictEqual(futureSummaryWithBase.total, 159, 'Future summary should prefer generated non-Personal account base over raw planning list length');
assert.strictEqual(futureSummaryWithBase.inactive, 0, 'Future summary should hide generated prior-month pending activation in future planning view');

assert.strictEqual(
  context.chooseInitialMonthLabel(['Apr 26', 'May 26'], 'Jun 26', ''),
  'Jun 26',
  'Sales Dashboard should default to device-date month even before that month has generated JSON'
);
assert.strictEqual(
  context.chooseInitialMonthLabel(['Apr 26', 'May 26'], 'Jun 26', 'May 26'),
  'May 26',
  'Explicit URL month should override the device-date default'
);

console.log('sales_iface_campaign.test.cjs passed');
