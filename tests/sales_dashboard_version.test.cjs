const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');
const versionPath = path.join(__dirname, '..', 'dashboard_version.json');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}`);
  assert(start >= 0, `${name} should exist`);
  const bodyStart = html.indexOf('{', html.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

assert(html.includes('const SALES_DASHBOARD_BUILD'), 'Sales Dashboard should carry a local build marker');
assert(html.includes('refreshIfStaleDashboardVersion()'), 'Sales Dashboard should check for a stale cached shell before loading data');
assert(fs.existsSync(versionPath), 'dashboard_version.json should publish the latest Sales Dashboard build marker');

const buildMatch = html.match(/const SALES_DASHBOARD_BUILD\s*=\s*'([^']+)'/);
assert(buildMatch, 'Sales Dashboard build marker should be a simple quoted string');
const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
assert.strictEqual(
  versionJson.sales_dashboard,
  buildMatch[1],
  'dashboard_version.json should match the inline Sales Dashboard build marker'
);

const context = { URL, URLSearchParams };
vm.createContext(context);
vm.runInContext([
  extractFunction('normalizeDashboardVersionPayload'),
  extractFunction('shouldReloadForDashboardVersion'),
  extractFunction('buildDashboardVersionReloadUrl'),
].join('\n'), context);

assert.strictEqual(
  context.normalizeDashboardVersionPayload({ sales_dashboard: ' 20260621-01 ' }),
  '20260621-01',
  'Version payload should prefer and trim sales_dashboard'
);
assert.strictEqual(
  context.normalizeDashboardVersionPayload({ build: 'fallback-build' }),
  'fallback-build',
  'Version payload should support generic build fallback'
);
assert.strictEqual(
  context.shouldReloadForDashboardVersion('20260621-02', '20260621-01', ''),
  true,
  'A stale cached dashboard should reload when latest build differs'
);
assert.strictEqual(
  context.shouldReloadForDashboardVersion('20260621-01', '20260621-01', ''),
  false,
  'Current dashboard should not reload when build markers match'
);
assert.strictEqual(
  context.shouldReloadForDashboardVersion('20260621-02', '20260621-01', '?month=jun26&v=20260621-02'),
  false,
  'Dashboard should not loop when URL already has the latest cache-busting version'
);

const nextUrl = context.buildDashboardVersionReloadUrl(
  'https://izfoo0121-lab.github.io/md-dashboard/sales_dashboard.html?month=jun26&view=camps',
  '20260621-02'
);
assert.strictEqual(
  nextUrl,
  'https://izfoo0121-lab.github.io/md-dashboard/sales_dashboard.html?month=jun26&view=camps&v=20260621-02',
  'Reload URL should preserve existing month/view params and add the latest version'
);

console.log('sales_dashboard_version.test.cjs passed');
