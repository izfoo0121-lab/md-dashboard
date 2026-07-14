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
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const context = {};
vm.createContext(context);
['debtorTargetProgress', 'isNearTargetDebtor', 'compareNearTargetDebtors'].forEach(name => {
  vm.runInContext(extractFunction(name), context);
});

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.debtorTargetProgress({ ctn_cur: 8, avg_ctn_3m: 10 }))),
  { current: 8, target: 10, ratio: 0.8, gap: 2 },
  'target progress should use the same current-month CTN and 3-month average shown on debtor cards'
);
assert.strictEqual(
  context.isNearTargetDebtor({ ctn_cur: 7.9, avg_ctn_3m: 10 }),
  false,
  'customers below 80% of their 3-month average should not be labelled near target'
);
assert.strictEqual(
  context.isNearTargetDebtor({ ctn_cur: 8, avg_ctn_3m: 10 }),
  true,
  'customers at 80% of their 3-month average should be labelled near target'
);
assert.strictEqual(
  context.isNearTargetDebtor({ ctn_cur: '9.5', avg_ctn_3m: '10' }),
  true,
  'numeric payload strings should still be evaluated correctly'
);
assert.strictEqual(
  context.isNearTargetDebtor({ ctn_cur: 10, avg_ctn_3m: 10 }),
  false,
  'customers who already reached target should not remain in the near-target list'
);
assert.strictEqual(
  context.isNearTargetDebtor({ ctn_cur: 4, avg_ctn_3m: 0 }),
  false,
  'customers without a positive 3-month target should not be labelled near target'
);
assert(
  context.compareNearTargetDebtors(
    { ctn_cur: 9.5, avg_ctn_3m: 10 },
    { ctn_cur: 8, avg_ctn_3m: 10 }
  ) < 0,
  'near-target results should put the closest customer first'
);

const helperUses = html.match(/isNearTargetDebtor\(d\)/g) || [];
assert(
  helperUses.length >= 2,
  'the debtor filter and dynamic type counts should share the same near-target rule'
);

console.log('sales_near_target_filter.test.cjs passed');
