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
