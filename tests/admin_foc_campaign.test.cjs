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
