const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

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

assert(html.includes('debtor_code'), 'FOC upload help should name debtor_code');
assert(html.includes('foc_item'), 'FOC upload help should name foc_item');
assert(html.includes('foc_qty'), 'FOC upload help should name foc_qty');
assert(html.includes('foc_unit'), 'FOC upload help should name foc_unit');
assert(html.includes('foc_item_2'), 'FOC upload help should name optional foc_item_2');
assert(html.includes('foc_qty_2'), 'FOC upload help should name optional foc_qty_2');
assert(html.includes('foc_unit_2'), 'FOC upload help should name optional foc_unit_2');

assert(html.includes('function normalizeFocUnit'), 'Admin should normalize uploaded FOC units');
assert(html.includes('function formatFocPackage'), 'Admin should format per-debtor FOC package preview text');
assert(html.includes('function downloadFocCampaignTemplate'), 'Admin should provide a June FOC campaign upload template');
assert(html.includes('downloadFocCampaignTemplate()'), 'Admin upload UI should expose the FOC template action');
assert(html.includes('campaignSalesDashboardHref'), 'Admin campaign cards should build a Sales Dashboard deep link');
assert(html.includes('view=camps'), 'Admin campaign link should open Sales Dashboard campaigns view');
assert(html.includes('function previewCampEditFile'), 'Admin edit panel should support debtor-list upload preview');
assert(html.includes('function saveCampListingEdit'), 'Admin edit panel should save debtor-list changes');
assert(html.includes('camp-edit-list-mode-'), 'Admin edit panel should expose listing update mode');
assert(html.includes('Add / update only'), 'Admin edit panel should support safe add/update mode');
assert(html.includes('Replace full listing'), 'Admin edit panel should support full listing replacement');

assert(/foc_unit_2/.test(html), 'Admin preview should preserve second package unit');
assert(/packs/.test(html), 'Admin unit normalization should display pack variants consistently as packs');
assert(/ctn/.test(html), 'Admin unit normalization should display carton variants consistently as ctn');
assert(html.includes('SKN QTY'), 'Admin upload help should mention original SUKUN listing columns');

const context = {};
vm.createContext(context);
vm.runInContext([
  extractFunction('normalizeFocUnit'),
  extractFunction('_campNumOrNull'),
  extractFunction('_campTextOrNull'),
  extractFunction('inferSukunListingFocUnit'),
  extractFunction('buildSukunListingFocPackage'),
  `function formatFocPackage(row = {}) {
    const item1 = String(row.foc_item || '').trim().toUpperCase();
    const qty1 = parseFloat(row.foc_qty || 0) || 0;
    const unit1 = normalizeFocUnit(row.foc_unit || '');
    const item2 = String(row.foc_item_2 || row.foc_item2 || '').trim().toUpperCase();
    const qty2 = parseFloat(row.foc_qty_2 || row.foc_qty2 || 0) || 0;
    const unit2 = normalizeFocUnit(row.foc_unit_2 || row.foc_unit2 || unit1);
    const line = (item, qty, unit) => item ? item + (qty ? ' x ' + qty : '') + (unit ? ' ' + unit : '') : '';
    return [line(item1, qty1, unit1), line(item2, qty2, unit2)].filter(Boolean).join(' + ');
  }`,
  extractFunction('campaignDebtorCode'),
  extractFunction('campaignPackageSignature'),
  extractFunction('mergeCampaignDebtorListings'),
  extractFunction('campaignListingPreviewStats'),
  extractFunction('prepareCampaignDebtorForSave'),
  extractFunction('_campDebtorToDb'),
  `async ${extractFunction('_campPostRows')}`,
].join('\n'), context);

const plain = value => JSON.parse(JSON.stringify(value));

assert.deepStrictEqual(
  plain(context.buildSukunListingFocPackage('派4包FOC', 2, 2)),
  {
    foc_item: 'SKNR',
    foc_qty: 2,
    foc_unit: 'packs',
    foc_item2: 'SKNW',
    foc_qty2: 2,
    foc_unit2: 'packs',
    foc_item_2: 'SKNW',
    foc_qty_2: 2,
    foc_unit_2: 'packs',
  },
  'Original SUKUN pack listing should become two pack FOC lines'
);

assert.deepStrictEqual(
  plain(context.buildSukunListingFocPackage('派4条FOC', 2, 2)),
  {
    foc_item: 'SKNR',
    foc_qty: 2,
    foc_unit: 'ctn',
    foc_item2: 'SKNW',
    foc_qty2: 2,
    foc_unit2: 'ctn',
    foc_item_2: 'SKNW',
    foc_qty_2: 2,
    foc_unit_2: 'ctn',
  },
  'Original SUKUN carton listing should become two ctn FOC lines'
);

const preparedFocDebtor = context.prepareCampaignDebtorForSave({
  code: '300-BR004',
  name: 'KEDAI RUNCIT TOK NGULU NASIR',
  agent: 'ben',
  foc_item: 'SKNR',
  foc_qty: 2,
  foc_unit: 'packs',
  foc_item_2: 'SKNW',
  foc_qty_2: 2,
  foc_unit_2: 'packs',
  notes: 'æ´¾4åŒ…FOC',
}, { groupMap: {}, defaultGroup: '' });

assert.strictEqual(preparedFocDebtor.notes, 'æ´¾4åŒ…FOC', 'FOC upload notes should be preserved as notes');
assert.strictEqual(preparedFocDebtor.eligibility_reason, '', 'FOC upload notes should not become eligibility reason');
assert.strictEqual(preparedFocDebtor.promo_logic, '', 'FOC upload notes should not be saved into constrained promo_logic');
assert.strictEqual(
  context._campDebtorToDb('camp_test', preparedFocDebtor).promo_logic,
  null,
  'Supabase payload should leave promo_logic null for plain FOC upload notes'
);

const preparedGeneratedCandidate = context.prepareCampaignDebtorForSave({
  code: '300-BR087',
  name: 'CARIL SHARI',
  agent: 'ben',
  debtor_type: 'FL-Freelancer',
  eligibility_reason: 'New account',
  promo_logic: 'New account',
  foc_item: 'SUKUN',
  foc_qty: 4,
  foc_unit: 'packs',
}, { groupMap: {}, defaultGroup: '' });

assert.strictEqual(preparedGeneratedCandidate.eligibility_reason, 'New account', 'Generated candidate should keep eligibility reason for display');
assert.strictEqual(
  context._campDebtorToDb('camp_test', preparedGeneratedCandidate).promo_logic,
  null,
  'Supabase payload should not put human eligibility labels into constrained promo_logic'
);
assert.strictEqual(
  context._campDebtorToDb('camp_test', preparedGeneratedCandidate).notes,
  'New account',
  'Supabase payload should preserve generated eligibility reason in notes'
);

const existingListing = [
  { code: '300-A001', name: 'Original A', agent: 'BEN', foc_item: 'SKNR', foc_qty: 2, foc_unit: 'packs' },
  { code: '300-B002', name: 'Keep B', agent: 'CJ', foc_item: 'SKNW', foc_qty: 2, foc_unit: 'packs' },
];
const uploadedListing = [
  { code: '300-A001', name: 'Updated A', agent: 'BEN', foc_item: 'SKNR', foc_qty: 2, foc_unit: 'ctn' },
  { code: '300-C003', name: 'New C', agent: 'KF', foc_item: 'SKNR', foc_qty: 1, foc_unit: 'packs' },
];

const mergeStats = context.campaignListingPreviewStats(existingListing, uploadedListing, 'merge');
assert.deepStrictEqual(
  plain(mergeStats),
  { current: 2, uploaded: 2, add: 1, update: 1, remove: 0, packageChanged: 1 },
  'Merge preview should count add/update/package changes without removals'
);

const mergedListing = context.mergeCampaignDebtorListings(existingListing, uploadedListing, 'merge');
assert.strictEqual(mergedListing.length, 3, 'Merge mode should keep old rows and add new rows');
assert.strictEqual(
  mergedListing.find(row => row.code === '300-A001').foc_unit,
  'ctn',
  'Merge mode should update matching debtor package instructions'
);
assert(mergedListing.some(row => row.code === '300-B002'), 'Merge mode should keep debtors missing from upload');

const replaceStats = context.campaignListingPreviewStats(existingListing, uploadedListing, 'replace');
assert.deepStrictEqual(
  plain(replaceStats),
  { current: 2, uploaded: 2, add: 1, update: 1, remove: 1, packageChanged: 1 },
  'Replace preview should count removed rows'
);

const replacedListing = context.mergeCampaignDebtorListings(existingListing, uploadedListing, 'replace');
assert.deepStrictEqual(
  plain(replacedListing.map(row => row.code).sort()),
  ['300-A001', '300-C003'],
  'Replace mode should use uploaded rows as the final listing'
);

(async () => {
  const calls = [];
  context._adminSupabaseFetch = async (table, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.length);
    if (body.length > 100) throw new Error('simulated large batch failure');
  };
  await context._campPostRows('campaign_debtors', Array.from({ length: 250 }, (_, i) => ({ i })));
  assert.deepStrictEqual(
    calls,
    [250, 100, 100, 50],
    'Campaign row posting should retry smaller chunks after a large batch failure'
  );
  console.log('admin_foc_campaign.test.cjs passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
