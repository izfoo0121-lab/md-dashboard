const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');

assert(
  html.includes('targets_monthly?select=month,agent,active,sales_progression,brand_commission,kpi_targets,kpi_overrides'),
  'Sales Dashboard should fetch month-scoped Admin targets from Supabase'
);
assert(
  html.includes('targets_agents?select=agent,active,sales_progression,brand_commission,kpi_targets'),
  'Sales Dashboard should fetch base agent targets as a compatibility fallback'
);
assert(
  html.includes('function applySalesTargetRows'),
  'Sales Dashboard should expose one target-row application bridge'
);
assert(
  html.includes('applySalesTargetRows(dataObj, agentTargetRows, { missingOnly: true })'),
  'Base targets should only fill missing generated values'
);
assert(
  html.includes('applySalesTargetRows(dataObj, monthlyTargetRows)'),
  'Month-scoped targets should override generated and base targets'
);
assert(
  html.includes('tier.target = targetValue'),
  'Sales tier target rows should update rendered agent progression targets'
);
assert(
  html.includes('item.target = targetValue'),
  'KPI target rows should update rendered agent KPI targets'
);

console.log('sales_live_targets_sync.test.cjs passed');
