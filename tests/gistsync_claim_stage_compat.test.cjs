const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'gistsync_supabase.js'), 'utf8');
const OLD_CLAIMS_CONFLICT_RE = new RegExp(
  `claims\\?on_conflict=${['month', 'agent', 'camp_id', 'debtor_code'].join(',')}(?!,stage)`,
);

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers.map(marker => source.indexOf(marker)).filter(idx => idx >= 0).sort((a, b) => a - b)[0] ?? -1;
  assert(start >= 0, `${name} should exist`);
  const bodyStart = source.indexOf('{', start);
  assert(bodyStart >= 0, `${name} should have a body`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

assert.doesNotMatch(
  source,
  OLD_CLAIMS_CONFLICT_RE,
  'GistSync should not use the old 4-column claims conflict target',
);
assert.match(
  source,
  /claims\?on_conflict=month,agent,camp_id,debtor_code,stage/,
  'GistSync should use the 5-column claims conflict target',
);

assert.match(
  extractFunction('push'),
  /stage\s*:/,
  'GistSync bulk claim push should write a stage value',
);
assert.match(
  extractFunction('saveClaim'),
  /stage\s*:\s*1/,
  'GistSync single claim save should write stage 1',
);
assert.match(
  extractFunction('removeClaim'),
  /stage=eq\./,
  'GistSync claim delete should filter by stage',
);

console.log('gistsync_claim_stage_compat.test.cjs passed');
