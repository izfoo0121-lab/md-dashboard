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
assert(html.includes('id="brand-pen-match-select"'), 'Admin helper should expose selectable match values');
assert(html.includes('id="brand-pen-type-options"'), 'Admin helper should expose selectable debtor type exclusions');
assert(html.includes('id="brand-pen-lookback-options"'), 'Admin helper should expose selectable lookback months');
assert(html.includes('renderBrandPenetrationOptionSelectors'), 'Admin helper should render selectable brand penetration option controls');
assert(html.includes('syncBrandPenetrationSelectorFields'), 'Admin helper should sync selectable options back into campaign fields');
assert(html.includes('exportBrandPenetrationCandidatesExcel'), 'Admin helper should export generated eligible debtors to Excel');
assert(html.includes('Export eligible Excel'), 'Admin helper should show an eligible debtor Excel export button');
assert(html.includes('type="hidden" id="brand-pen-values"'), 'Admin helper should keep match values as hidden storage only');
assert(html.includes('type="hidden" id="brand-pen-exclude-types"'), 'Admin helper should keep exclude types as hidden storage only');
assert(!html.includes('<div class="field-lbl">Match Values</div>'), 'Admin helper should not show duplicate raw Match Values field');
assert(!html.includes('<div class="field-lbl">Exclude Types</div>'), 'Admin helper should not show duplicate raw Exclude Types field');
assert(html.includes('Canggih Item Groups'), 'Admin match dropdown should group selectable Canggih item groups first');
assert(html.includes('item_group_values'), 'Admin match dropdown should consume generated item group options');
assert(html.includes('Item Codes'), 'Admin match dropdown should separate item code options from group options');
assert(html.includes('<option value="SUKUN">SUKUN</option>'), 'Admin helper should offer SUKUN as a selectable penetration campaign brand');
assert(html.includes('<option value="BISON">BISON</option>'), 'Admin helper should offer BISON as a selectable penetration campaign brand');
assert(html.includes('<option value="CUSTOM">Custom</option>'), 'Admin helper should allow custom brand penetration campaigns');
assert(html.includes('data-brand-pen-agent-group'), 'Admin group mapping should use configurable labels rather than fixed IFACE groups');
assert(!html.includes('MVP / MI / SS / SBG group map'), 'Admin should not hardcode MVP/MI/SS/SBG as the default group model');
assert(html.includes('SUKUN') && html.includes('IFACE PEN'), 'Admin IFACE preset should still fill FOC SUKUN x 4 packs and IFACE PEN note');
assert(html.includes('eligibility_reason'), 'Admin campaign debtor rows should preserve IFACE eligibility reason');

console.log('admin_iface_campaign.test.cjs passed');
