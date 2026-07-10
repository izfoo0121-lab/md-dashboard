const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'management.html'), 'utf8');
const start = html.indexOf('let mgmtUnpurchasedMode');
assert(start >= 0, 'management unpurchased state should exist');
const end = html.indexOf('function renderGainingDebtorsPage', start);
assert(end > start, 'management unpurchased helper slice should be extractable');

const context = {
  console,
  document: {
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; },
  },
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

assert.strictEqual(
  typeof context.mgmtUnpurchasedSummaryRows,
  'function',
  'management unpurchased overview should expose a per-agent SKU status summary helper',
);

const rows = [
  { agent: 'YI', type: 'SH-Shop', brandStats: { SUKUN: { currentMonthCtn: 5, prevLookbackCtn: 0 } } },
  { agent: 'YI', type: 'FL-Freelancer', brandStats: { SUKUN: { currentMonthCtn: 0, prevLookbackCtn: 0 } } },
  { agent: 'CJ', type: 'SH-Shop', brandStats: { SUKUN: { currentMonthCtn: 0, prevLookbackCtn: 10 } } },
  { agent: 'CJ', type: 'SH-Shop', brandStats: { SUKUN: { currentMonthCtn: 1, prevLookbackCtn: 7 } } },
];

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.mgmtUnpurchasedSummaryRows(rows, 'SUKUN', 'all'))),
  [
    { agent: 'YI', totalDebtors: 2, currentBuyers: 1, unpurchased: 2 },
    { agent: 'CJ', totalDebtors: 2, currentBuyers: 1, unpurchased: 0 },
  ],
  'summary should count each agent total, current-month buyers, and unpurchased debtors for the selected SKU',
);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.mgmtUnpurchasedSummaryRows(rows, 'SUKUN', 'SH-Shop'))),
  [
    { agent: 'YI', totalDebtors: 1, currentBuyers: 1, unpurchased: 1 },
    { agent: 'CJ', totalDebtors: 2, currentBuyers: 1, unpurchased: 0 },
  ],
  'summary should respect the selected debtor type filter',
);

assert(
  context.renderMgmtUnpurchasedAgentSummary.toString().includes('本月购买') &&
  context.renderMgmtUnpurchasedAgentSummary.toString().includes('未购买') &&
  context.renderMgmtUnpurchasedAgentSummary.toString().includes('总户口'),
  'rendered summary should label total debtors, current-month buyers, and unpurchased status clearly',
);

console.log('management_unpurchased_agent_summary.test.cjs passed');
