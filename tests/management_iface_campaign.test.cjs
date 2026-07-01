const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'management.html'), 'utf8');

assert(html.includes('pk_pool_rate'), 'Management should read IFACE PK pool rate from campaign_group_progress');
assert(html.includes('Pool RM'), 'Management should show the IFACE RM3.50/CTN pool value');
assert(html.includes('winner_by_accounts'), 'Management should show penetration winner');
assert(html.includes('winner_by_ctn'), 'Management should show CTN winner');
assert(html.includes('function mgmtIsLinkedCampaign'), 'Management should detect linked conversion + repeat campaigns');
assert(html.includes('function mgmtLinkedProgressScore'), 'Management should calculate linked campaign /50 progress');
assert(html.includes('Linked campaign group standings'), 'Management should show linked campaign group standings separately');
assert(html.includes('1ST OD') && html.includes('RP OD'), 'Management should label linked campaign stages');

console.log('management_iface_campaign.test.cjs passed');
