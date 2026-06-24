const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'campaign_audit.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}`);
  assert(start >= 0, `${name} should exist`);
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') {
      depth += 1;
      seenBody = true;
    } else if (ch === '}') {
      depth -= 1;
      if (seenBody && depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

assert(html.includes('BULK REMOVE TARGET'), 'Campaign Audit should expose a manager bulk remove target action');
assert(html.includes("showBulkMarkPanel('remove')"), 'Bulk remove button should open the shared bulk tool in remove mode');
assert(html.includes('Manager Off'), 'Manager-off rows should be labelled separately from agent exclusions');
assert(html.includes('Undo Off'), 'Manager-off rows should expose Undo Off');
assert(html.includes('undoManagerOff'), 'Campaign Audit should provide an undo function for manager-off rows');
assert(html.includes('management_bulk_off'), 'Bulk remove should persist a manager bulk-off actor');

const context = {};
vm.createContext(context);
vm.runInContext([
  extractFunction('auditClaimCategory'),
  extractFunction('auditClaimIsManagerOff'),
  extractFunction('campaignAuditBulkReasonLabel'),
  extractFunction('campaignAuditBulkClaimData'),
  extractFunction('campaignAuditBulkSelectionState'),
  extractFunction('campaignAuditBulkAgentOptions'),
  extractFunction('campaignAuditBulkSelectedEntries'),
  extractFunction('campaignAuditBulkCodeKeys'),
].join('\n'), context);

const managerOffClaim = context.campaignAuditBulkClaimData('remove', {
  ts: '2026-06-24T01:00:00.000Z',
  reason: 'wrong_agent',
  remark: 'moved to KW',
  batchId: 'bulk_off_test',
  campType: 'free_sample',
});
const plain = value => JSON.parse(JSON.stringify(value));

assert.deepStrictEqual(
  plain(managerOffClaim),
  {
    ts: '2026-06-24T01:00:00.000Z',
    count: 1,
    remark: 'Manager off: Assigned to wrong agent - moved to KW [bulk_off_test]',
    bulk: true,
    status: 'excluded',
    actor: 'management_bulk_off',
    reason: 'wrong_agent',
    campType: 'free_sample',
  },
  'Remove mode should write a reversible manager-off claim override'
);
assert.strictEqual(context.auditClaimIsManagerOff(managerOffClaim), true, 'Manager off claim should be identifiable');
assert.strictEqual(context.auditClaimCategory(managerOffClaim, null), 'excluded', 'Manager off rows should count as excluded');
assert.deepStrictEqual(
  plain(context.campaignAuditBulkSelectionState(null, null, 'remove')),
  { canSelect: true, label: '' },
  'Bulk remove should allow unclaimed target debtors'
);
assert.deepStrictEqual(
  plain(context.campaignAuditBulkSelectionState({ status: 'submitted' }, null, 'remove')),
  { canSelect: false, label: 'Request already sent' },
  'Bulk remove should not allow rows already requested by agents'
);
assert.deepStrictEqual(
  plain(context.campaignAuditBulkSelectionState({ status: 'verified' }, { status: 'verified' }, 'remove')),
  { canSelect: false, label: 'Already processed' },
  'Bulk remove should not allow processed rows'
);
assert.deepStrictEqual(
  plain(context.campaignAuditBulkAgentOptions('remove', ['BEN', 'CJ'])),
  [
    { value: 'ALL', label: 'All Agents' },
    { value: 'BEN', label: 'BEN' },
    { value: 'CJ', label: 'CJ' },
  ],
  'Bulk remove should default to an all-agent scope'
);
assert.deepStrictEqual(
  plain(context.campaignAuditBulkAgentOptions('delivered', ['BEN'])),
  [
    { value: '', label: '-- Select Agent --' },
    { value: 'BEN', label: 'BEN' },
  ],
  'Bulk delivered should remain agent-scoped'
);
assert.deepStrictEqual(
  plain(context.campaignAuditBulkSelectedEntries([
    { value: '300-A001', dataset: { agent: 'BEN', code: '300-A001' } },
    { value: '300-A002', dataset: { agent: 'CJ', code: '300-A002' } },
  ], 'ALL')),
  [
    { agent: 'BEN', debtorCode: '300-A001' },
    { agent: 'CJ', debtorCode: '300-A002' },
  ],
  'Bulk remove should persist each uploaded debtor under its actual campaign agent'
);
assert.deepStrictEqual(
  plain(context.campaignAuditBulkCodeKeys('300-L0382')),
  ['300-L0382', 'L0382'],
  'Bulk upload should match full debtor codes and short Excel debtor codes'
);
assert.deepStrictEqual(
  plain(context.campaignAuditBulkCodeKeys(' Km013 ')),
  ['KM013'],
  'Bulk upload should normalize pasted Excel code casing'
);

console.log('campaign_audit_manager_off.test.cjs passed');
