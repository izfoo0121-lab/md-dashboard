const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name, { asyncOnly = false } = {}) {
  const markers = asyncOnly
    ? [`async function ${name}(`]
    : [`function ${name}(`, `async function ${name}(`];
  const starts = markers.map(marker => html.indexOf(marker)).filter(index => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  assert(start >= 0, `${name} should exist`);

  const bodyStart = html.indexOf('{', html.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);

  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }

  throw new Error(`Could not extract ${name}`);
}

const expectedEngineScripts = [
  'campaign_engine/campaign_model.js',
  'campaign_engine/campaign_validation.js',
  'campaign_engine/campaign_db_mapper.js',
  'campaign_engine/campaign_repository.js',
  'campaign_engine/admin_campaign_adapter.js',
  'campaign_engine/index.js',
];

let previousScriptIndex = -1;
expectedEngineScripts.forEach(script => {
  const scriptIndex = html.indexOf(script);
  assert(scriptIndex >= 0, `admin.html should include ${script}`);
  assert(
    scriptIndex > previousScriptIndex,
    `${script} should be loaded after the previous campaign engine script`
  );
  previousScriptIndex = scriptIndex;
});

assert(
  html.includes('function buildAdminCampaignEngineContext'),
  'admin.html should define buildAdminCampaignEngineContext'
);
assert(
  /defaultTargetGroups\s*:\s*\[\s*['"]grp2a['"]\s*\]/.test(html),
  "buildAdminCampaignEngineContext should default campaigns to Group 2A"
);

assert.match(
  extractFunction('createCampaign', { asyncOnly: true }),
  /PFMDCampaignEngine\.admin\.createCampaignFromAdminForm/,
  'createCampaign should delegate to the shared admin campaign engine adapter'
);

console.log('admin_campaign_engine_integration.test.cjs passed');
