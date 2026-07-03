const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
  const syncMarker = `function ${name}(`;
  const asyncMarker = `async function ${name}(`;
  const syncStart = html.indexOf(syncMarker);
  const asyncStart = html.indexOf(asyncMarker);
  const candidates = [syncStart, asyncStart].filter(idx => idx >= 0);
  const start = candidates.length ? Math.min(...candidates) : -1;
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

assert(html.includes('id="admin-historical-month-guard"'), 'Admin should render a historical-month guard banner');
assert(html.includes('Unlock historical editing'), 'Admin should expose an explicit historical-month unlock action');
assert.match(extractFunction('saveAll'), /adminHistoricalSaveAllowed/, 'SAVE ALL should be blocked by the historical-month guard');
[
  'saveKpiManual',
  'saveKpiManualOverride',
  'saveAgentMonthlyAccess',
  'saveGroupSpOverride',
  'saveAgentWorkday',
  'saveAgentOffdays',
  'saveLeaveRecord',
].forEach(name => {
  assert.match(extractFunction(name), /adminHistoricalSaveAllowed/, `${name} should use the historical-month save guard`);
});

const alerts = [];
const confirms = [];
const context = {
  ADMIN_ACTIVE_MONTH: 'Jun 26',
  ADMIN_HISTORICAL_UNLOCKS: {},
  DASH_DATA: { current_month: 'Jun 26' },
  MDAdminContext: {
    currentMonthLabel: () => 'Jul 26',
    normalizeMonth: value => value,
  },
  document: {
    getElementById() { return null; },
    querySelectorAll() { return []; },
  },
  alert(msg) { alerts.push(msg); },
  confirm(msg) { confirms.push(msg); return context.__confirmResult; },
  console: { warn() {}, log() {}, error() {} },
};
context.window = context;
vm.createContext(context);

[
  'adminMonthLabelToIso',
  'adminIsoToMonthLabel',
  'getAdminWorkingMonth',
  'adminMonthSortKey',
  'adminReferenceMonth',
  'isHistoricalAdminMonth',
  'adminHistoricalUnlockKey',
  'isAdminHistoricalMonthUnlocked',
  'setAdminHistoricalMonthUnlocked',
  'adminHistoricalSaveAllowed',
].forEach(name => vm.runInContext(extractFunction(name), context));

assert(context.adminMonthSortKey('Jun 26') < context.adminMonthSortKey('Jul 26'), 'month sort should compare labels chronologically');
assert.strictEqual(context.adminReferenceMonth(), 'Jul 26', 'reference month should prefer the real current month over stale generated data');
assert.strictEqual(context.isHistoricalAdminMonth('Jun 26'), true, 'previous month should be considered historical');
assert.strictEqual(context.isHistoricalAdminMonth('Jul 26'), false, 'current month should not be considered historical');
assert.strictEqual(context.isHistoricalAdminMonth('Aug 26'), false, 'future month should not be considered historical');

assert.strictEqual(context.adminHistoricalSaveAllowed('Test save', 'Jun 26'), false, 'locked historical month should block saves');
assert.match(alerts.pop(), /Unlock historical editing/, 'locked save should tell the manager to unlock first');

context.setAdminHistoricalMonthUnlocked('Jun 26', true);
context.__confirmResult = false;
assert.strictEqual(context.adminHistoricalSaveAllowed('Test save', 'Jun 26'), false, 'unlocked historical save should still require confirmation');
assert.match(confirms.pop(), /Jun 26[\s\S]*Jul 26/, 'confirmation should name both selected and reference month');

context.__confirmResult = true;
assert.strictEqual(context.adminHistoricalSaveAllowed('Test save', 'Jun 26'), true, 'confirmed historical save should proceed after unlock');
assert.strictEqual(context.adminHistoricalSaveAllowed('Test save', 'Jul 26'), true, 'current month save should proceed without unlock');

console.log('admin_historical_month_guard.test.cjs passed');
