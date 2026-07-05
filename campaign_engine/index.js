(function(root) {
  const engine = root.PFMDCampaignEngine || {};
  const requiredModules = ['model', 'listing', 'validation', 'mapper', 'repository', 'admin'];
  const missing = requiredModules.filter(function(name) {
    return !engine[name];
  });

  if (missing.length && root.console && typeof root.console.warn === 'function') {
    root.console.warn('PFMDCampaignEngine missing modules: ' + missing.join(', '));
  }

  engine.version = 'phase1';
  root.PFMDCampaignEngine = engine;
})(typeof window !== 'undefined' ? window : globalThis);
