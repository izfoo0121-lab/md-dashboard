const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert(start >= 0, `${startMarker} should exist`);
  const end = html.indexOf(endMarker, start);
  assert(end > start, `${endMarker} should appear after ${startMarker}`);
  return html.slice(start, end);
}

function extractFunction(name) {
  const markers = [`function ${name}(`, `async function ${name}(`];
  const starts = markers.map(marker => html.indexOf(marker)).filter(index => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  assert(start >= 0, `${name} should exist`);
  const bodyStart = html.indexOf('{', html.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let index = bodyStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const context = {
  AGENTS: ['BEN', 'CJ', 'JACKY', 'JAMES', 'JW', 'KEAN', 'KEE', 'KF', 'KI-MI', 'KW', 'LEON', 'NMK', 'SAM', 'YI'],
  CONFIG: {
    md_agent_registry: {
      HUA: { group: 'grp2a', start_month: 'Jul 26' },
      YI: { group: 'grp2a' },
      KEAN: { group: 'grp2a', end_month: 'Jul 26' },
      XIAN: { group: 'grp2a', start_month: 'Jul 26' },
      ALFRED: { group: 'grp1' },
    },
    agents: {
      HUA: { active: true, is_newbie: true },
      YI: { active: true },
      KEAN: { active: false, archived: true, archived_from_month: 'Jul-26' },
      XIAN: { active: true, inherits_from: 'KEAN', inherit_from_month: 'Jul-26' },
      ALFRED: { active: true },
    },
    monthly_targets: {
      'Jul 26': {
        YI: { active: false },
      },
    },
    agent_replacements: {
      KEAN: { successor: 'XIAN', from_month: 'Jul-26' },
    },
  },
};
vm.createContext(context);
vm.runInContext(extractBlock('const MD_ADMIN_GROUP', 'const BRAND_PEN_GROUP_MAP_KEY'), context);

assert.strictEqual(context.isMdAdminScopedAgent('HUA'), true, 'registry should keep a new Group 2A agent in scope after reload');
assert.strictEqual(context.isMdAdminScopedAgent('ALFRED'), false, 'registry should keep non-Group 2A agents out of md-dashboard');

assert.deepStrictEqual(
  Array.from(context.getMdAdminOperationalAgents('Jun 26')),
  ['KEAN', 'YI'],
  'June should show the predecessor and the agent before the July access-off override'
);
assert.deepStrictEqual(
  Array.from(context.getMdAdminOperationalAgents('Jul 26')),
  ['HUA', 'XIAN'],
  'July should show the new/successor agents and hide archived or month-disabled agents'
);

context.ensureMdAgentRegistry(context.CONFIG, ['NEW-HIRE']);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.CONFIG.md_agent_registry['NEW-HIRE'])),
  { group: 'grp2a' },
  'bootstrap agents should be persisted into the dynamic Group 2A registry'
);

assert.match(extractFunction('addAgent'), /registerMdAdminAgent/, 'adding an agent should update the persistent registry');
assert.match(extractFunction('addAgent'), /refreshAgentDependentViews/, 'adding an agent should refresh dependent tabs');
assert.match(extractFunction('removeAgent'), /isAdminPersistedAgent/, 'persisted agents should not be removed only from browser memory');
assert.match(extractFunction('getBulkTargetTemplateAgents'), /getMdAdminOperationalAgents/, 'target templates should use the selected-month operational roster');
assert.match(extractFunction('renderNewbieForms'), /getMdAdminOperationalAgents/, 'Newbie Scheme should use the selected-month operational roster');
assert.match(extractFunction('renderAdminBrandSKU'), /getMdAdminOperationalAgents/, 'Brand SKU Status should use the selected-month operational roster');
assert.match(extractFunction('_activeAgentsForBulk'), /getMdAdminOperationalAgents/, 'campaign bulk actions should use the selected-month operational roster');

context.document = {
  getElementById(id) {
    return id === 'bulk-month-select' ? { value: 'Jul 26' } : null;
  },
};
context.getAdminWorkingMonth = () => 'Jul 26';
context.DASH_DATA = {
  agents: {
    HUA: {
      debtor_cards: {
        debtors: [{
          debtor_code: '300-KB040',
          company_name: 'WI CHONG',
          debtor_type: 'SH-Shop',
        }],
      },
    },
  },
};
vm.runInContext(extractFunction('_activeAgentsForBulk'), context);
vm.runInContext(extractFunction('_validateCodes'), context);
const bulkValidation = context._validateCodes(['300-KB040'], '');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(bulkValidation.valid)),
  [{ agent: 'HUA', code: '300-KB040', name: 'WI CHONG', type: 'SH-Shop' }],
  'bulk campaign validation should match debtors owned by a dynamically added active agent'
);
assert.deepStrictEqual(
  Array.from(bulkValidation.notFound),
  [],
  'a debtor owned by a dynamically added active agent must not be reported as code not found'
);

['renderAgentWorkdaysTable', 'renderAgentOffdaysTable', 'initLeaveRecordsTab'].forEach(name => {
  assert.doesNotMatch(extractFunction(name), /\bAGENTS\b/, `${name} should not use the legacy hard-coded roster`);
});

const saveSource = extractFunction('saveAllToSupabase');
assert.match(saveSource, /md_agent_registry/, 'agent registry should be saved in targets_static');

const loadSource = extractFunction('loadConfigFromSupabase');
assert.match(loadSource, /ensureMdAgentRegistry/, 'Supabase loading should restore the dynamic Group 2A registry before scoping agents');

context.SUPABASE_URL = 'https://example.supabase.test';
context.SUPABASE_KEY = 'test-key';
context.DASH_DATA = { agents: { BEN: {}, HUA: {} } };
context.console = console;
const tableRows = {
  targets_agents: [
    { agent: 'BEN', active: true, is_newbie: false },
    { agent: 'HUA', active: true, is_newbie: true },
    { agent: 'ALFRED', active: true, is_newbie: false },
  ],
  targets_monthly: [
    { month: 'Jul 26', agent: 'HUA', active: true, is_newbie: true },
    { month: 'Jul 26', agent: 'ALFRED', active: true, is_newbie: false },
  ],
  targets_pins: [],
  targets_birthday_overrides: [],
  targets_group_brand: [],
  targets_static: [],
  targets_snapshots: [],
};
context.fetch = async url => {
  const table = String(url).match(/\/rest\/v1\/([^?]+)/)?.[1];
  return { ok: true, async json() { return tableRows[table] || []; } };
};
vm.runInContext(extractFunction('loadConfigFromSupabase'), context);

(async () => {
  const loaded = await context.loadConfigFromSupabase();
  assert.deepStrictEqual(
    Object.keys(loaded.agents).sort(),
    ['BEN', 'HUA'],
    'Supabase reload should recover dashboard-backed Group 2A agents and exclude other groups'
  );
  assert.strictEqual(loaded.monthly_targets['Jul 26'].HUA.active, true, 'scoped monthly rows should survive reload');
  assert.strictEqual(loaded.monthly_targets['Jul 26'].ALFRED, undefined, 'other-group monthly rows should remain excluded');
  assert.strictEqual(loaded.md_agent_registry.HUA.group, 'grp2a', 'recovered agents should be persisted into the registry');
  console.log('admin_agent_lifecycle.test.cjs passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
