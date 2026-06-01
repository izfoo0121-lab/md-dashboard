const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

assert(html.includes('loadBrandPenetrationPreset'), 'Admin should expose a reusable brand penetration campaign preset loader');
assert(html.includes('generateBrandPenetrationCandidates'), 'Admin should auto-suggest eligible debtors from generated report history');
assert(html.includes('renderBrandPenetrationGroupMapEditor'), 'Admin should render optional custom group/team mapping');
assert(html.includes('Brand Penetration Campaign Helper'), 'Admin helper should be generic, not IFACE-only');
assert(html.includes('id="brand-pen-preset"'), 'Admin helper should expose a selectable brand preset dropdown');
assert(html.includes('applyBrandPenetrationPreset'), 'Admin helper should apply the selected brand preset');
assert(html.includes('ensureBrandPenetrationConversionMode'), 'Admin helper should force conversion mode before candidate generation');
assert(html.includes('prepareBrandPenetrationCampaignForm'), 'Admin helper should prepare the selected preset before candidate generation');
assert(html.includes('prepareBrandPenetrationCampaignForm();\n  const brand ='), 'Generating candidates should reveal conversion rule/lookback fields first');
assert(html.includes('<option value="SUKUN">SUKUN</option>'), 'Admin helper should offer SUKUN as a selectable penetration campaign brand');
assert(html.includes('<option value="BISON">BISON</option>'), 'Admin helper should offer BISON as a selectable penetration campaign brand');
assert(html.includes('<option value="CUSTOM">Custom</option>'), 'Admin helper should allow custom brand penetration campaigns');
assert(html.includes('data-brand-pen-agent-group'), 'Admin group mapping should use configurable labels rather than fixed IFACE groups');
assert(!html.includes('MVP / MI / SS / SBG group map'), 'Admin should not hardcode MVP/MI/SS/SBG as the default group model');
assert(html.includes('SUKUN') && html.includes('IFACE PEN'), 'Admin IFACE preset should still fill FOC SUKUN x 4 packs and IFACE PEN note');
assert(html.includes('eligibility_reason'), 'Admin campaign debtor rows should preserve IFACE eligibility reason');

console.log('admin_iface_campaign.test.cjs passed');
