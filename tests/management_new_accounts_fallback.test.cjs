const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'management.html'), 'utf8');
const match = html.match(
  /(function applyGeneratedActualFallbacks[\s\S]*?\n  })\n  async function fetch_birthday_claims/
);

assert(match, 'Management should provide generated KPI actual fallbacks before Supabase manual overrides');

const applyGeneratedActualFallbacks = new Function(
  '_applyItemActual',
  `return (${match[1]});`
)(
  (item, actual) => {
    item.actual = Number(actual || 0);
    delete item.needs_supabase_fetch;
    return true;
  }
);

const overrideMatch = html.match(
  /(function applyAgentOverride[\s\S]*?\n  })\n  function applyGeneratedActualFallbacks/
);

assert(overrideMatch, 'Management should apply Admin KPI manual rows after generated fallbacks');

const applyAgentOverride = new Function(
  'FIELD_MAP',
  '_findAgentData',
  '_applyItemActual',
  '_applyNewbieAccounts',
  `return (${overrideMatch[1]});`
)(
  { new_accounts: 'new_accounts' },
  (dataObj, agent) => dataObj.agents[agent],
  (item, actual) => {
    item.actual = Number(actual || 0);
    delete item.needs_supabase_fetch;
    return true;
  },
  () => {}
);

const data = {
  agents: {
    CJ: {
      debtor_cards: { opened_this_month: 3 },
      kpi: {
        items: {
          new_accounts: { actual: 0, needs_supabase_fetch: true },
        },
      },
    },
  },
};

assert.strictEqual(applyGeneratedActualFallbacks(data), 1);
assert.strictEqual(data.agents.CJ.kpi.items.new_accounts.actual, 3);
assert.strictEqual(data.agents.CJ.kpi.items.new_accounts.auto_actual, 3);
assert.strictEqual(data.agents.CJ.kpi.items.new_accounts.source, 'generated_new_accounts');

assert.strictEqual(applyAgentOverride(data, { agent: 'CJ', new_accounts: 7 }), 1);
assert.strictEqual(data.agents.CJ.kpi.items.new_accounts.actual, 7);
assert.strictEqual(data.agents.CJ.kpi.items.new_accounts.auto_actual, 3);
assert.strictEqual(data.agents.CJ.kpi.items.new_accounts.override_actual, 7);
assert.strictEqual(data.agents.CJ.kpi.items.new_accounts.final_actual, 7);
assert.strictEqual(data.agents.CJ.kpi.items.new_accounts.source, 'manual_override');

console.log('management_new_accounts_fallback.test.cjs passed');
