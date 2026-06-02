const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

assert(html.includes('Campaign Type'), 'Admin should label the top dropdown as Campaign Type');
assert(html.includes('Mechanism Cards'), 'Admin should present reusable mechanism cards');
assert(html.includes('Gift / FOC Delivery'), 'Admin should include a gift delivery mechanism card label');
assert(html.includes('Brand Penetration / Win-back'), 'Admin should include a penetration mechanism card label');
assert(html.includes('Volume Segment Offer'), 'Admin should include a BISON-style volume segment mechanism card label');
assert(html.includes('PK / Commission Pool'), 'Admin should include a PK pool add-on label');
assert(html.includes('function campaignMechanismDisplayMeta'), 'Admin should expose mechanism display metadata helper');
assert(html.includes('function updateCampaignMechanismCopy'), 'Admin should update mechanism explanation when selection changes');
assert(html.includes('function validateCampaignMechanismBeforeSave'), 'Admin should validate missing mechanism requirements before save');
assert(html.includes('validateCampaignMechanismBeforeSave('), 'Admin save flow should call mechanism validation before Supabase save');
assert(html.includes('id="new-camp-mechanism-help"'), 'Create form should show selected mechanism help text');
assert(html.includes('id="new-camp-mechanism-preview"'), 'Create form should show mechanism preview text');
assert(html.includes('id="new-camp-pk-addon"'), 'Create form should expose the PK add-on card');
assert(html.includes('id="new-camp-gift-addon"'), 'Create form should expose the gift/FOC add-on card');
assert(html.includes('new-camp-volume-basis'), 'Existing volume basis field should remain available');
assert(html.includes('new-camp-reward-tiers'), 'Existing reward tier field should remain available');
assert(html.includes('new-camp-lookback-months'), 'Existing lookback field should remain available');

console.log('admin_campaign_mechanisms.test.cjs passed');
