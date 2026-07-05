(function(root, factory) {
  const model = root.PFMDCampaignEngine && root.PFMDCampaignEngine.model
    ? root.PFMDCampaignEngine.model
    : (typeof require === 'function' ? require('./campaign_model.js') : null);
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PFMDCampaignEngine = Object.assign(root.PFMDCampaignEngine || {}, { listing: api });
})(typeof window !== 'undefined' ? window : globalThis, function(model) {
  function text(value) {
    if (model && typeof model.text === 'function') return model.text(value);
    return String(value == null ? '' : value).trim();
  }

  function upper(value) {
    if (model && typeof model.upper === 'function') return model.upper(value);
    return text(value).toUpperCase();
  }

  function normalizeFocUnit(value) {
    if (model && typeof model.normalizeFocUnit === 'function') return model.normalizeFocUnit(value);
    const raw = text(value).toLowerCase();
    const units = {
      ctn: 'ctn',
      carton: 'ctn',
      cartons: 'ctn',
      pack: 'packs',
      packs: 'packs',
      pkt: 'packs',
      pkts: 'packs',
      packet: 'packs',
      packets: 'packs',
      box: 'box',
      boxes: 'box',
      piece: 'piece',
      pieces: 'piece',
      pc: 'piece',
      pcs: 'piece',
    };
    return units[raw] || raw;
  }

  function qty(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }

  function fmtQty(value) {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  }

  function formatFocPackage(row, fallback) {
    const source = row || {};
    const defaults = fallback || {};
    const item1 = upper(source.foc_item || defaults.default_foc_item || '');
    const qty1 = qty(source.foc_qty ?? defaults.default_foc_qty ?? 0);
    const unit1 = normalizeFocUnit(source.foc_unit || defaults.default_foc_unit || '');
    const item2 = upper(source.foc_item_2 || source.foc_item2 || defaults.default_foc_item_2 || defaults.default_foc_item2 || '');
    const qty2 = qty(source.foc_qty_2 ?? source.foc_qty2 ?? defaults.default_foc_qty_2 ?? defaults.default_foc_qty2 ?? 0);
    const unit2 = normalizeFocUnit(source.foc_unit_2 || source.foc_unit2 || defaults.default_foc_unit_2 || defaults.default_foc_unit2 || unit1);
    const line = function(item, amount, unit) {
      return item ? item + (amount ? ' x ' + fmtQty(amount) : '') + (unit ? ' ' + unit : '') : '';
    };
    return [line(item1, qty1, unit1), line(item2, qty2, unit2)].filter(Boolean).join(' + ');
  }

  function campaignDebtorCode(row) {
    return upper(row && (row.code || row.debtor_code));
  }

  function campaignPackageSignature(row) {
    return formatFocPackage(row || {}).toUpperCase();
  }

  function mergeCampaignDebtorListings(existingRows, uploadedRows, mode) {
    const uploaded = (uploadedRows || []).filter(row => campaignDebtorCode(row));
    if (mode === 'replace') return uploaded.map(row => Object.assign({}, row));

    const byCode = new Map();
    (existingRows || []).forEach(row => {
      const code = campaignDebtorCode(row);
      if (code) byCode.set(code, Object.assign({}, row, { code: row.code || row.debtor_code || code }));
    });
    uploaded.forEach(row => {
      const code = campaignDebtorCode(row);
      byCode.set(code, Object.assign({}, row, { code: row.code || row.debtor_code || code }));
    });
    return Array.from(byCode.values());
  }

  function campaignListingPreviewStats(existingRows, uploadedRows, mode) {
    const existing = (existingRows || []).filter(row => campaignDebtorCode(row));
    const uploaded = (uploadedRows || []).filter(row => campaignDebtorCode(row));
    const existingByCode = new Map(existing.map(row => [campaignDebtorCode(row), row]));
    const uploadedCodes = new Set(uploaded.map(row => campaignDebtorCode(row)));
    const stats = {
      current: existing.length,
      uploaded: uploaded.length,
      add: 0,
      update: 0,
      remove: 0,
      packageChanged: 0,
    };

    uploaded.forEach(row => {
      const code = campaignDebtorCode(row);
      const old = existingByCode.get(code);
      if (old) {
        stats.update += 1;
        if (campaignPackageSignature(old) !== campaignPackageSignature(row)) stats.packageChanged += 1;
      } else {
        stats.add += 1;
      }
    });

    if (mode === 'replace') {
      stats.remove = existing.filter(row => !uploadedCodes.has(campaignDebtorCode(row))).length;
    }
    return stats;
  }

  return {
    campaignDebtorCode,
    campaignListingPreviewStats,
    campaignPackageSignature,
    formatFocPackage,
    mergeCampaignDebtorListings,
    normalizeFocUnit,
  };
});
