const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');
const start = html.indexOf('function normalizePriceValues');
const end = html.indexOf('async function enrichMonthBreakdownsFromAnalysis', start);

assert(start >= 0, 'analysisRowToBreakdownItem function not found');
assert(end > start, 'enrichMonthBreakdownsFromAnalysis function not found after merge helpers');

const context = {
  fmtMoney(value) {
    const n = Number(value || 0);
    const hasCents = Math.abs(n % 1) > 0.005;
    return 'RM ' + n.toLocaleString('en-MY', {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2,
    });
  },
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const staleSnapshotRows = [
  { item: 'IFACE R', ctn: 10, agent: 'KW' },
  { item: 'SKNR', ctn: 9, agent: 'KW' },
];
const currentAnalysisRows = [
  { sku: 'IFACE R', ctn: 12, amount: 399.2, agent: 'KW', rm_ctn_values: [29.1, 34.1], rm_ctn_rebate_values: [29.1, 34.1] },
  { sku: 'SKNR', ctn: 19, amount: 760, agent: 'KW', rm_ctn_values: [40], rm_ctn_rebate_values: [40] },
];

const merged = context.mergeAmountIntoBreakdownRows(staleSnapshotRows, currentAnalysisRows);
const ifaceR = merged.find(row => row.item === 'IFACE R');
const sknr = merged.find(row => row.item === 'SKNR');

assert.strictEqual(ifaceR.ctn, 12, 'stale snapshot CTN should be replaced by current analysis CTN');
assert.strictEqual(ifaceR.amount, 399.2);
assert.deepStrictEqual(Array.from(ifaceR.rm_ctn_values), [29.1, 34.1], 'IFACE R should keep source RM/CTN values from columns S/T');
assert.strictEqual(context.formatCtnPrice(ifaceR), 'RM 29.10 / RM 34.10/CTN');

assert.strictEqual(sknr.ctn, 19, 'stale snapshot CTN should be replaced by current analysis CTN');
assert.strictEqual(sknr.amount, 760);
assert.deepStrictEqual(Array.from(sknr.rm_ctn_values), [40], 'SKNR should keep source RM/CTN values from columns S/T');
assert.strictEqual(context.formatCtnPrice(sknr), 'RM 40/CTN');

console.log('sales_breakdown_merge.test.cjs passed');
