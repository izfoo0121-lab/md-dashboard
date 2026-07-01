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
assert(html.includes('Linked Conversion + Repeat Promo'), 'Admin should include linked conversion + repeat mechanism');
assert(html.includes('linked_conversion_repeat'), 'Admin should persist linked conversion + repeat mechanism/numerator key');
assert(html.includes('value="none"'), 'Admin should allow tracking-only campaigns with no KPI numerator');
assert(html.includes('value="distribution"'), 'Admin should expose Distribution KPI numerator');
assert(html.includes('Distribution'), 'Admin should label distribution scoring clearly');
assert(html.includes('Penetration'), 'Admin should label count scoring as penetration');
assert(html.includes('new-camp-stage1-target-pct'), 'Create form should expose Stage 1 conversion target percentage');
assert(html.includes('new-camp-stage2-target-pct'), 'Create form should expose Stage 2 repeat target percentage');
assert(html.includes('[1ST OD]'), 'Create form should include default Stage 1 FOC note');
assert(html.includes('[RP OD]'), 'Create form should include default Stage 2 FOC note');

console.log('admin_campaign_mechanisms.test.cjs passed');
