const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'management.html'), 'utf8');

assert(
  html.includes('targets_monthly?select=month,agent,active,sales_progression,brand_commission,kpi_targets,kpi_overrides'),
  'Management should fetch monthly Admin targets from Supabase'
);
assert(
  html.includes('targets_agents?select=agent,active,sales_progression,brand_commission,kpi_targets,kpi_overrides'),
  'Management should fetch base Admin targets as fallback when monthly target rows are empty'
);
assert(
  html.includes('function applyMonthlyTargetOverrides'),
  'Management should expose an application bridge for monthly target overrides'
);
assert(
  html.includes('applyMonthlyTargetOverrides(dataObj, agentTargetRows)'),
  'Management should apply base agent targets before monthly overrides'
);
assert(
  html.includes('applyMonthlyTargetOverrides(dataObj, targetRows)'),
  'Management should apply target rows during Supabase sync'
);
assert(
  html.includes('item.target = targetValue'),
  'KPI item targets should be replaced by Admin monthly targets'
);
assert(
  html.includes('tier.target = targetValue'),
  'Sales progression tier targets should be replaced by Admin monthly targets'
);

console.log('management_live_targets_sync.test.cjs passed');
