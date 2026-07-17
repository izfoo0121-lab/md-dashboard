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
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const store = {};
const context = {
  DATA: { current_month: 'Jul 26' },
  localStorage: {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; },
  },
  blockFutureViewAction: () => false,
};
vm.createContext(context);
vm.runInContext([
  'const DATA = globalThis.DATA;',
  'const localStorage = globalThis.localStorage;',
  'const blockFutureViewAction = globalThis.blockFutureViewAction;',
  extractFunction('normalizeCampClaimStage'),
  extractFunction('campClaimStageLabel'),
  extractFunction('campaignClaimStagePrefix'),
  extractFunction('campClaimStorageSuffix'),
  extractFunction('getCampClaimKey'),
  extractFunction('getCampClaims'),
  extractFunction('saveCampClaim'),
  extractFunction('removeCampClaim'),
].join('\n'), context);

assert.strictEqual(context.normalizeCampClaimStage(null), 1, 'Blank stage should default to Stage 1');
assert.strictEqual(context.normalizeCampClaimStage('2'), 2, 'String stage 2 should normalize to number 2');
assert.strictEqual(context.campClaimStageLabel(1), '1ST OD', 'Stage 1 should display as 1ST OD');
assert.strictEqual(context.campClaimStageLabel(2), 'RP OD', 'Stage 2 should display as RP OD');
assert.strictEqual(
  context.campaignClaimStagePrefix('free_sample', 1),
  '',
  'Normal FOC campaigns such as CM7 should not display a conversion stage label'
);
assert.strictEqual(
  context.campaignClaimStagePrefix('birthday_gift', 1),
  '',
  'Birthday campaigns should not display a conversion stage label'
);
assert.strictEqual(
  context.campaignClaimStagePrefix('conversion_simple', 1),
  '1ST OD',
  'Conversion campaigns should retain the Stage 1 label'
);
assert.strictEqual(
  context.campaignClaimStagePrefix('conversion_tiered', 2),
  'RP OD',
  'Conversion campaigns should retain the Stage 2 label'
);

const legacyKey = 'camp_claim_Jul26_KI-MI_camp_sukun_300-A001';
assert.strictEqual(
  context.getCampClaimKey('KI-MI', 'camp_sukun', '300-A001', 1),
  legacyKey,
  'Stage 1 should keep the old localStorage key for backward compatibility'
);
assert.strictEqual(
  context.getCampClaimKey('KI-MI', 'camp_sukun', '300-A001', 2),
  `${legacyKey}__stage2`,
  'Stage 2 should use a distinct stage-aware localStorage key'
);

store[legacyKey] = JSON.stringify({ status: 'verified', remark: 'old row' });
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.getCampClaims('KI-MI', 'camp_sukun', '300-A001', 1))),
  { status: 'verified', remark: 'old row', stage: 1 },
  'Stage 1 should read old single-stage claims as Stage 1'
);

context.saveCampClaim('KI-MI', 'camp_sukun', '300-A001', { status: 'submitted' }, 2);
assert.deepStrictEqual(
  JSON.parse(store[`${legacyKey}__stage2`]),
  { status: 'submitted', stage: 2 },
  'Stage 2 save should persist stage metadata without overwriting Stage 1'
);
assert.strictEqual(JSON.parse(store[legacyKey]).stage || 1, 1, 'Stage 1 key should remain intact');

context.removeCampClaim('KI-MI', 'camp_sukun', '300-A001', 2);
assert.strictEqual(store[`${legacyKey}__stage2`], undefined, 'Stage 2 removal should only remove Stage 2');
assert.ok(store[legacyKey], 'Stage 2 removal should not remove Stage 1');

console.log('sales_stage_claims.test.cjs passed');
