const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const asyncMarker = `async function ${name}(`;
  const syncStart = html.indexOf(marker);
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

const confirmBulkMarkSource = extractFunction('confirmBulkMark');
assert(
  !confirmBulkMarkSource.includes('on_conflict=month,agent,camp_id,debtor_code,stage'),
  'Bulk mark should use the deployed claims unique key without stage'
);
assert(
  confirmBulkMarkSource.includes('buildBulkClaimRows'),
  'Bulk mark should build Supabase rows through the schema-compatible row helper'
);

const calls = [];
const context = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_KEY: 'anon-key',
  fetch: async (url, opts = {}) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => [] };
  },
  console: { warn() {} },
};
vm.createContext(context);
vm.runInContext(extractFunction('_fetchExistingClaims'), context);
vm.runInContext(extractFunction('buildBulkClaimRows'), context);

(async () => {
  const rows = context.buildBulkClaimRows({
    month: 'Jul 26',
    campId: 'birthday_gift_auto',
    campType: 'birthday_gift',
    remark: 'Bulk import',
    toCreate: [{ agent: 'BEN', code: '300-BY250' }],
  }, '2026-07-08T00:00:00.000Z');
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), [
    'actor',
    'agent',
    'bulk',
    'camp_id',
    'camp_type',
    'debtor_code',
    'month',
    'remark',
    'status',
    'ts',
  ].sort(), 'Bulk mark Supabase rows should match deployed claims columns');

  await context._fetchExistingClaims('Jul 26', 'birthday_gift_auto', ['BEN'], ['300-BY250']);
  assert.strictEqual(calls.length, 1, 'Bulk mark preview should query claims once');
  const decodedUrl = decodeURIComponent(calls[0].url);
  assert(decodedUrl.includes('/claims?'), 'Bulk mark preview should query the claims table');
  assert(
    !decodedUrl.includes('stage'),
    'Bulk mark preview should not select or filter claims.stage because deployed schema does not have it'
  );

  console.log('admin_bulk_mark_claim_schema.test.cjs passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
