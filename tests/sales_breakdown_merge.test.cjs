const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');
const start = html.indexOf('function analysisRowToBreakdownItem');
const end = html.indexOf('async function enrichMonthBreakdownsFromAnalysis', start);

assert(start >= 0, 'analysisRowToBreakdownItem function not found');
assert(end > start, 'enrichMonthBreakdownsFromAnalysis function not found after merge helpers');

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const staleSnapshotRows = [
  { item: 'IFACE R', ctn: 10, agent: 'KW' },
  { item: 'SKNR', ctn: 9, agent: 'KW' },
];
const currentAnalysisRows = [
  { sku: 'IFACE R', ctn: 12, amount: 399.2, agent: 'KW' },
  { sku: 'SKNR', ctn: 19, amount: 760, agent: 'KW' },
];

const merged = context.mergeAmountIntoBreakdownRows(staleSnapshotRows, currentAnalysisRows);
const ifaceR = merged.find(row => row.item === 'IFACE R');
const sknr = merged.find(row => row.item === 'SKNR');

assert.strictEqual(ifaceR.ctn, 12, 'stale snapshot CTN should be replaced by current analysis CTN');
assert.strictEqual(ifaceR.amount, 399.2);
assert(Math.abs(ifaceR.rm_ctn - (399.2 / 12)) < 0.000001, 'IFACE R RM/CTN should use current CTN');

assert.strictEqual(sknr.ctn, 19, 'stale snapshot CTN should be replaced by current analysis CTN');
assert.strictEqual(sknr.amount, 760);
assert(Math.abs(sknr.rm_ctn - 40) < 0.000001, 'SKNR RM/CTN should use current CTN');

console.log('sales_breakdown_merge.test.cjs passed');
