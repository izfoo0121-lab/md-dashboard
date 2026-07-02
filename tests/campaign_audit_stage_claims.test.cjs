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

const context = {};
vm.createContext(context);
vm.runInContext([
  extractFunction('normalizeAuditClaimStage'),
  extractFunction('auditClaimStageLabel'),
  extractFunction('getClaimKey'),
  extractFunction('getAuditKey'),
  extractFunction('indexSupabaseRows'),
].join('\n'), context);

context.indexSupabaseRows([
  {
    agent: 'CJ',
    camp_id: 'camp_sukun',
    debtor_code: '300-A001',
    stage: 1,
    status: 'verified',
    ts: '2026-07-02T00:00:00Z',
  },
  {
    agent: 'CJ',
    camp_id: 'camp_sukun',
    debtor_code: '300-A001',
    stage: 2,
    status: 'submitted',
    ts: '2026-07-03T00:00:00Z',
  },
]);

assert.strictEqual(context.normalizeAuditClaimStage(undefined), 1, 'Old claim rows should default to Stage 1');
assert.strictEqual(context.normalizeAuditClaimStage('2'), 2, 'Stage should normalize from Supabase strings');
assert.strictEqual(context.auditClaimStageLabel(1), '1ST OD', 'Stage 1 should display as 1ST OD');
assert.strictEqual(context.auditClaimStageLabel(2), 'RP OD', 'Stage 2 should display as RP OD');

assert.strictEqual(
  context.getClaimKey('Jul 26', 'CJ', 'camp_sukun', '300-A001', 1),
  'CJ|camp_sukun|300-A001|1',
  'Audit cache key should include Stage 1'
);
assert.strictEqual(
  context.getAuditKey('Jul 26', 'CJ', 'camp_sukun', '300-A001', 2),
  'CJ|camp_sukun|300-A001|2',
  'Audit cache key should include Stage 2'
);
assert.strictEqual(
  Object.keys(context.CLAIMS_CACHE).sort().join(','),
  'CJ|camp_sukun|300-A001|1,CJ|camp_sukun|300-A001|2',
  'Campaign Audit should keep Stage 1 and Stage 2 claims separate for the same debtor'
);
assert.strictEqual(context.CLAIMS_CACHE['CJ|camp_sukun|300-A001|1'].stage, 1);
assert.strictEqual(context.CLAIMS_CACHE['CJ|camp_sukun|300-A001|2'].stage, 2);

console.log('campaign_audit_stage_claims.test.cjs passed');
