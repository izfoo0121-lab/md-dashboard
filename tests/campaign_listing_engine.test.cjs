const assert = require('assert');
const listing = require('../campaign_engine/campaign_listing.js');

const plain = value => JSON.parse(JSON.stringify(value));

const existingListing = [
  { code: '300-A001', name: 'Original A', agent: 'BEN', foc_item: 'SKNR', foc_qty: 2, foc_unit: 'packs' },
  { debtor_code: '300-B002', name: 'Keep B', agent: 'CJ', foc_item: 'SKNW', foc_qty: 2, foc_unit: 'packs' },
];

const uploadedListing = [
  { debtor_code: '300-a001', name: 'Updated A', agent: 'BEN', foc_item: 'SKNR', foc_qty: 2, foc_unit: 'ctn' },
  { code: '300-C003', name: 'New C', agent: 'KF', foc_item: 'SKNR', foc_qty: 1, foc_unit: 'packs' },
  { code: '', name: 'Blank row ignored' },
];

assert.strictEqual(listing.campaignDebtorCode({ debtor_code: ' 300-a001 ' }), '300-A001');
assert.strictEqual(
  listing.formatFocPackage({ foc_item: 'sknr', foc_qty: 2, foc_unit: 'packet', foc_item2: 'sknw', foc_qty2: 1, foc_unit2: 'carton' }),
  'SKNR x 2 packs + SKNW x 1 ctn',
);
assert.strictEqual(listing.inferSukunListingFocUnit('派4包FOC'), 'packs');
assert.strictEqual(listing.inferSukunListingFocUnit('派4条FOC'), 'ctn');
assert.strictEqual(listing.inferSukunListingFocUnit('4 pkt'), 'packs');
assert.strictEqual(listing.inferSukunListingFocUnit('4 cartons'), 'ctn');
assert.deepStrictEqual(
  plain(listing.buildSukunListingFocPackage('派4包FOC', 2, 2)),
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
);
assert.deepStrictEqual(
  plain(listing.buildSukunListingFocPackage('派4条FOC', 2, 2)),
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
);

const parsedUpload = listing.parseCampaignUploadRows(
  ['debtor_code', 'company name', 'agent', 'category', 'skn qty', 'sknr', 'sknw', 'eligibility reason', 'notes', 'approval'],
  [
    ['300-D004', 'Shop D', 'ben', 'vip', '派4包FOC', 2, 2, 'New account', 'Manual note', 'TRUE'],
    ['nan', 'Ignored', 'cj', '', '', '', '', '', '', ''],
    ['', 'Blank ignored', 'cj', '', '', '', '', '', '', ''],
  ],
  { groupMap: { BEN: 'GRP2A' }, defaultGroup: 'MIRACLE' },
);
assert.deepStrictEqual(
  plain(parsedUpload),
  [{
    code: '300-D004',
    name: 'Shop D',
    agent: 'BEN',
    cat: 'VIP',
    cat_group: 'GRP2A',
    group: 'GRP2A',
    eligibility_reason: 'New account',
    promo_logic: 'New account',
    foc_item: 'SKNR',
    foc_qty: 2,
    foc_unit: 'packs',
    foc_item2: 'SKNW',
    foc_qty2: 2,
    foc_unit2: 'packs',
    foc_item_2: 'SKNW',
    foc_qty_2: 2,
    foc_unit_2: 'packs',
    approval: true,
    notes: 'Manual note',
  }],
);

assert.deepStrictEqual(
  plain(listing.campaignListingPreviewStats(existingListing, uploadedListing, 'merge')),
  { current: 2, uploaded: 2, add: 1, update: 1, remove: 0, packageChanged: 1 },
);

assert.deepStrictEqual(
  plain(listing.campaignListingPreviewStats(existingListing, uploadedListing, 'replace')),
  { current: 2, uploaded: 2, add: 1, update: 1, remove: 1, packageChanged: 1 },
);

const merged = listing.mergeCampaignDebtorListings(existingListing, uploadedListing, 'merge');
assert.deepStrictEqual(
  plain(merged.map(row => listing.campaignDebtorCode(row)).sort()),
  ['300-A001', '300-B002', '300-C003'],
);
assert.strictEqual(
  merged.find(row => listing.campaignDebtorCode(row) === '300-A001').foc_unit,
  'ctn',
);

const replaced = listing.mergeCampaignDebtorListings(existingListing, uploadedListing, 'replace');
assert.deepStrictEqual(
  plain(replaced.map(row => listing.campaignDebtorCode(row)).sort()),
  ['300-A001', '300-C003'],
);

console.log('campaign_listing_engine.test.cjs passed');
