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
  const syncMarker = `function ${name}(`;
  const asyncMarker = `async function ${name}(`;
  const syncStart = html.indexOf(syncMarker);
  const asyncStart = html.indexOf(asyncMarker);
  const candidates = [syncStart, asyncStart].filter(idx => idx >= 0);
  const start = candidates.length ? Math.min(...candidates) : -1;
  assert(start >= 0, `${name} should exist`);
  const fnStart = html.startsWith(asyncMarker, start) ? start : start;
  const bodyStart = html.indexOf('{', html.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(fnStart, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const helperBlock = extractBlock('const MD_ADMIN_GROUP', 'const BRAND_PEN_GROUP_MAP_KEY');
const context = {
  AGENTS: ['BEN', 'CJ', 'JACKY', 'JAMES', 'JW', 'KEAN', 'KEE', 'KF', 'KI-MI', 'KW', 'LEON', 'NMK', 'SAM', 'YI'],
  CONFIG: {
    agents: {
      BEN: {},
      CJ: { default_group: 'GRP 2A' },
      NEW2A: { default_group: 'grp2a' },
      WEI: { default_group: 'grp1' },
      HIN: { group: 'GRP 3/3A' },
      ARCHIVED2A: { default_group: 'grp2a', archived: true },
      INACTIVE2A: { default_group: 'grp2a', active: false },
    },
  },
};
vm.createContext(context);
vm.runInContext(helperBlock, context);
vm.runInContext(extractFunction('applyAgentReplacementsToConfig'), context);

assert.strictEqual(context.normalizeAdminGroup('GRP 2A'), 'grp2a');
assert.strictEqual(context.normalizeAdminGroup('grp 2a'), 'grp2a');
assert.strictEqual(context.normalizeAdminGroup('GRP 3/3A'), 'grp3_3a');
assert.strictEqual(context.isMdAdminScopedAgent('BEN'), true, 'Known md-dashboard agents should default to group2a');
assert.strictEqual(context.isMdAdminScopedAgent('WEI'), false, 'Group 1 agents from shared Supabase should be hidden');
assert.strictEqual(context.isMdAdminScopedAgent('HIN'), false, 'Group 3/3A agents from shared Supabase should be hidden');
assert.deepStrictEqual(
  context.getMdAdminScopedAgents(Object.keys(context.CONFIG.agents)),
  ['BEN', 'CJ', 'NEW2A'],
  'Default scoped agent list should include only active, non-archived group2a agents'
);
assert.deepStrictEqual(
  context.getMdAdminScopedAgents(Object.keys(context.CONFIG.agents), { includeArchived: true, includeInactive: true }),
  ['ARCHIVED2A', 'BEN', 'CJ', 'INACTIVE2A', 'NEW2A'],
  'Scoped helper should opt into archived/inactive group2a agents where admin tools need them'
);

[
  'loadKpiManual',
  'getKpiManualOverrideAgents',
  'saveKpiManual',
  'renderPinForm',
  'savePins',
  'setAllAgentCardsMinimized',
  'renderAgentForms',
  'parseTargetsWideCsv',
  'parseTargetsCsv',
  'renderNewbieForms',
  'saveAllToSupabase',
  'loadConfigFromSupabase',
  'renderAdminBrandSKU',
  'openArchiveModal',
].forEach(name => {
  const src = extractFunction(name);
  assert(
    src.includes('getMdAdminScopedAgents') || src.includes('isMdAdminScopedAgent'),
    `${name} should use md-dashboard group2a scoping`
  );
});

assert.match(extractFunction('buildDefaultConfig'), /default_group:\s*MD_ADMIN_GROUP/, 'Default md agents should carry group2a metadata');
assert.match(extractFunction('addAgent'), /default_group:\s*MD_ADMIN_GROUP/, 'Agents added in md admin should be group2a by default');

const replacementConfig = {
  agents: {
    KEAN: { active: true },
    XIAN: { active: true },
  },
  agent_replacements: {
    KEAN: { successor: 'XIAN', from_month: 'Jul-26' },
  },
};
context.applyAgentReplacementsToConfig(replacementConfig);
assert.strictEqual(
  replacementConfig.agents.XIAN.default_group,
  'grp2a',
  'Agent replacement successors should inherit the md-dashboard group so they remain visible in Agent Targets'
);
context.CONFIG = replacementConfig;
assert.strictEqual(
  context.isMdAdminScopedAgent('XIAN'),
  true,
  'A replacement successor like XIAN should be visible in the md-dashboard Agent Targets list'
);
assert.match(
  extractFunction('confirmArchive'),
  /ensureReplacementSuccessorGroup\(CONFIG,\s*_archiveTarget,\s*successor\)/,
  'Archive & Replace should write group metadata when creating a successor agent'
);

console.log('admin_group2a_scope.test.cjs passed');
