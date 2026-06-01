const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');

assert(html.includes('function isIfaceCampaign'), 'Sales Dashboard should detect IFACE campaign cards');
assert(html.includes('function renderIfaceMissionSummary'), 'Sales Dashboard should render an action-focused IFACE mission summary');
assert(html.includes('function futureDebtorPlanningCopy'), 'Sales Dashboard should keep debtor cards visible in future planning months');
assert(!html.includes("futureViewEmptyHtml('Debtor list')"), 'Future month view should not hide the debtor list');
assert(html.includes('eligibility_reason'), 'Sales Dashboard should show why each IFACE debtor is eligible');
assert(html.includes('IFACE PEN'), 'Sales Dashboard should show the IFACE PEN FOC note');
assert(!html.includes('IFACE group standings in Sales'), 'Sales Dashboard should not render full group PK standings');

console.log('sales_iface_campaign.test.cjs passed');
