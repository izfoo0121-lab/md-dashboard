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
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
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

const context = {
  AGENTS: ['YI', 'HUA'],
  CONFIG: {
    agents: {
      YI: { active: false, archived: true, default_group: 'grp2a', archived_from_month: 'Jul-26' },
      HUA: { active: true, default_group: 'grp2a', inherits_from: 'YI', inherit_from_month: 'Jul-26' },
    },
    agent_replacements: {
      YI: { successor: 'HUA', from_month: 'Jul-26' },
    },
  },
  DASH_DATA: {
    agents: {
      YI: {
        debtor_cards: {
          debtors: [
            { debtor_code: '300-JS106', company_name: 'YI LEGACY SHOP', debtor_type: 'SH-Shop' },
          ],
        },
      },
      HUA: {
        debtor_cards: {
          debtors: [
            { debtor_code: '300-HU001', company_name: 'HUA SHOP', debtor_type: 'SH-Shop' },
          ],
        },
      },
    },
  },
  document: {
    getElementById(id) {
      if (id === 'bulk-month-select') return { value: 'Jul 26' };
      return null;
    },
  },
  getAdminWorkingMonth: () => 'Jul 26',
};

vm.createContext(context);
vm.runInContext(extractBlock('const MD_ADMIN_GROUP', 'const BRAND_PEN_GROUP_MAP_KEY'), context);
vm.runInContext(extractFunction('_activeAgentsForBulk'), context);
vm.runInContext(extractFunction('_bulkAgentReplacementPairs'), context);
vm.runInContext(extractFunction('_bulkSourceAgentsForClaims'), context);
vm.runInContext(extractFunction('_validateCodes'), context);

let result = context._validateCodes(['300-JS106'], '');
assert.strictEqual(result.notFound.length, 0, 'All-agents bulk mark should find predecessor debtor codes');
assert.strictEqual(result.valid.length, 1, 'All-agents bulk mark should create one claimable row');
assert.strictEqual(result.valid[0].agent, 'HUA', 'Predecessor debtor claim should be written under successor agent');
assert.strictEqual(result.valid[0].sourceAgent, 'YI', 'Preview should retain the original debtor-card owner for audit/debugging');

result = context._validateCodes(['300-JS106'], 'HUA');
assert.strictEqual(result.notFound.length, 0, 'Selecting successor agent should still find predecessor debtor codes');
assert.strictEqual(result.valid[0].agent, 'HUA', 'Selected successor should receive the inherited debtor claim');

console.log('admin_bulk_mark_agent_handover.test.cjs passed');
