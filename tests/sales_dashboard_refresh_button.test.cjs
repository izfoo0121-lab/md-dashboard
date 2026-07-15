const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');

function extractFunction(name) {
  let start = html.indexOf(`async function ${name}`);
  if (start < 0) start = html.indexOf(`function ${name}`);
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

function createContext(overrides = {}) {
  const context = {
    DATA: { current_month: 'Jul 26' },
    CURRENT_MONTH_SLUG: 'jul26',
    states: [],
    cleared: false,
    loadedSlug: null,
    loadedData: false,
    staleChecked: false,
    console: { warn() {} },
  };
  context.clearDashboardDataCaches = function clearDashboardDataCaches() { context.cleared = true; };
  context.setRefreshButtonState = function setRefreshButtonState(isRefreshing) { context.states.push(isRefreshing); };
  context.refreshIfStaleDashboardVersion = async function refreshIfStaleDashboardVersion() {
    context.staleChecked = true;
    return false;
  };
  context.switchMonth = async function switchMonth(slug) { context.loadedSlug = slug; };
  context.loadData = async function loadData() { context.loadedData = true; };
  Object.assign(context, overrides);
  vm.createContext(context);
  return context;
}

assert(html.includes('id="btn-force-refresh"'), 'Sales Dashboard should render a visible Refresh button');
assert(html.includes('onclick="forceRefreshDashboard()"'), 'Refresh button should call forceRefreshDashboard');

const clearDataCachesSource = extractFunction('clearDashboardDataCaches');
assert.doesNotMatch(
  clearDataCachesSource,
  /DEBTOR_ANALYSIS_CACHE|MONTH_SNAPSHOT_CACHE|DEBTOR_["']\s*\+\s*["']ANALYSIS_CACHE|MONTH_["']\s*\+\s*["']SNAPSHOT_CACHE/,
  'Refresh must not retain or disguise retired public snapshot caches'
);

const clearContext = {
  SALES_LIVE_STATIC_CONFIG_CACHE: { zlb_brands: ['SUKUN'] },
  localStorage: {
    removed: [],
    removeItem(key) { this.removed.push(key); },
  },
  console: { warn() {} },
};
vm.createContext(clearContext);
vm.runInContext(clearDataCachesSource, clearContext);
clearContext.clearDashboardDataCaches();

assert.strictEqual(
  clearContext.SALES_LIVE_STATIC_CONFIG_CACHE,
  undefined,
  'Refresh should clear live static config cache so Admin ZLB/SKU changes can be refetched'
);
assert.deepStrictEqual(
  clearContext.localStorage.removed,
  ['md_gist_cache', 'md_gist_cache_ts'],
  'Refresh should clear only the shared Supabase/Gist read cache, not claim/flag action keys'
);

const cleanUrlContext = {
  URL,
  window: {
    location: {
      href: 'https://izfoo0121-lab.github.io/md-dashboard/sales_dashboard.html?month=jul26&v=20260707-01#debtors',
    },
    history: {
      replaced: null,
      replaceState(_state, _title, url) { this.replaced = url; },
    },
  },
  console: { warn() {} },
};
vm.createContext(cleanUrlContext);
vm.runInContext(extractFunction('cleanDashboardCacheBusterParam'), cleanUrlContext);
cleanUrlContext.cleanDashboardCacheBusterParam();

assert(cleanUrlContext.window.history.replaced, 'Refresh flow should clean temporary cache-buster from the URL');
assert(!cleanUrlContext.window.history.replaced.includes('v='), 'Clean URL should remove only the temporary v parameter');
assert(
  cleanUrlContext.window.history.replaced.includes('month=jul26'),
  'Clean URL should preserve selected month context'
);

(async () => {
  const reloadContext = createContext();
  vm.runInContext(extractFunction('forceRefreshDashboard'), reloadContext);
  await reloadContext.forceRefreshDashboard();

  assert.strictEqual(reloadContext.cleared, true, 'Force refresh should clear caches first');
  assert.strictEqual(reloadContext.staleChecked, true, 'Force refresh should check dashboard_version.json');
  assert.strictEqual(reloadContext.loadedSlug, 'jul26', 'Force refresh should reload the currently selected month');
  assert.deepStrictEqual(reloadContext.states, [true, false], 'Refresh button should be disabled while refreshing');

  const staleContext = createContext();
  staleContext.refreshIfStaleDashboardVersion = async function refreshIfStaleDashboardVersion() {
    staleContext.staleChecked = true;
    return true;
  };
  staleContext.switchMonth = async function switchMonth() {
    throw new Error('should not load data after a version reload is triggered');
  };
  vm.runInContext(extractFunction('forceRefreshDashboard'), staleContext);
  await staleContext.forceRefreshDashboard();

  assert.strictEqual(staleContext.cleared, true, 'Force refresh should clear caches before shell reload');
  assert.strictEqual(staleContext.staleChecked, true, 'Force refresh should check latest shell version');
  assert.strictEqual(staleContext.loadedSlug, null, 'Force refresh should stop when page shell reload is triggered');

  console.log('sales_dashboard_refresh_button.test.cjs passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
