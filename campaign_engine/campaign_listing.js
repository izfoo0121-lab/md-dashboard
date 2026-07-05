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

  function inferSukunListingFocUnit(value) {
    const raw = text(value).toLowerCase();
    if (!raw) return '';
    if (raw.includes('条') || raw.includes('æ¡') || raw.includes('ctn') || raw.includes('carton')) return 'ctn';
    if (raw.includes('包') || raw.includes('åŒ…') || raw.includes('pack') || raw.includes('pkt')) return 'packs';
    return '';
  }

  function buildSukunListingFocPackage(sknQty, sknrQty, sknwQty) {
    const unit = inferSukunListingFocUnit(sknQty);
    if (!unit) return {};
    const sknr = qty(sknrQty);
    const sknw = qty(sknwQty);
    const row = {};
    if (sknr > 0) {
      row.foc_item = 'SKNR';
      row.foc_qty = sknr;
      row.foc_unit = unit;
    }
    if (sknw > 0) {
      row.foc_item2 = 'SKNW';
      row.foc_qty2 = sknw;
      row.foc_unit2 = unit;
      row.foc_item_2 = 'SKNW';
      row.foc_qty_2 = sknw;
      row.foc_unit_2 = unit;
    }
    return row;
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

  function parseCampaignUploadRows(headers, rows, opts) {
    const options = opts || {};
    const normalizedHeaders = (headers || []).map(h => text(h).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '));
    const findHeader = function() {
      const names = Array.from(arguments);
      return normalizedHeaders.findIndex(h => names.some(name => h === name || h.includes(name)));
    };
    const ci = findHeader('debtor code', 'code');
    const ni = findHeader('debtor name', 'company name', 'company', 'name');
    const cati = findHeader('cat', 'category', 'rebate');
    const agi = findHeader('agent');
    const foci1 = findHeader('foc item 1', 'foc item', 'foc sku', 'item');
    const qty1 = findHeader('foc qty 1', 'foc qty', 'qty 1', 'qty1', 'qty');
    const unit1 = findHeader('foc unit 1', 'foc unit', 'unit 1', 'unit');
    const foci2 = findHeader('foc item 2');
    const qty2 = findHeader('foc qty 2', 'qty 2', 'qty2');
    const unit2 = findHeader('foc unit 2', 'unit 2');
    const sknQtyi = findHeader('skn qty');
    const sknri = findHeader('sknr');
    const sknwi = findHeader('sknw');
    const appi = normalizedHeaders.findIndex(h => h.includes('approval'));
    const notei = normalizedHeaders.findIndex(h => h === 'notes' || h.includes('note'));
    const groupi = findHeader('group', 'team', 'cat group');
    const reasoni = findHeader('eligibility reason', 'eligible reason', 'reason');
    const groupMap = options.groupMap || {};
    const defaultGroup = options.defaultGroup || '';
    if (ci < 0) return [];

    return (rows || [])
      .filter(r => r && r[ci] && text(r[ci]) && text(r[ci]).toLowerCase() !== 'nan')
      .map(r => {
        const agent = agi >= 0 ? upper(r[agi]) : '';
        const reason = reasoni >= 0 ? text(r[reasoni]) : '';
        const group = groupi >= 0 ? upper(r[groupi]) : (groupMap[agent] || defaultGroup || '');
        const note = notei >= 0 ? text(r[notei]) : '';
        const sukunNote = sknQtyi >= 0 ? text(r[sknQtyi]) : '';
        const sukunPackage = buildSukunListingFocPackage(
          sukunNote,
          sknri >= 0 ? r[sknri] : '',
          sknwi >= 0 ? r[sknwi] : '',
        );
        const hasSukunPackage = !!(sukunPackage.foc_item || sukunPackage.foc_item_2);
        return {
          code: text(r[ci]),
          name: ni >= 0 ? text(r[ni]) : '',
          agent,
          cat: cati >= 0 ? upper(r[cati]) : '',
          cat_group: group,
          group,
          eligibility_reason: reason,
          promo_logic: reason,
          foc_item: hasSukunPackage ? (sukunPackage.foc_item || '') : (foci1 >= 0 ? upper(r[foci1]) : ''),
          foc_qty: hasSukunPackage ? (sukunPackage.foc_qty || 0) : (qty1 >= 0 ? qty(r[qty1]) : 0),
          foc_unit: hasSukunPackage ? (sukunPackage.foc_unit || '') : (unit1 >= 0 ? normalizeFocUnit(r[unit1]) : ''),
          foc_item2: hasSukunPackage ? (sukunPackage.foc_item2 || '') : (foci2 >= 0 ? upper(r[foci2]) : ''),
          foc_qty2: hasSukunPackage ? (sukunPackage.foc_qty2 || 0) : (qty2 >= 0 ? qty(r[qty2]) : 0),
          foc_unit2: hasSukunPackage ? (sukunPackage.foc_unit2 || '') : (unit2 >= 0 ? normalizeFocUnit(r[unit2]) : ''),
          foc_item_2: hasSukunPackage ? (sukunPackage.foc_item_2 || '') : (foci2 >= 0 ? upper(r[foci2]) : ''),
          foc_qty_2: hasSukunPackage ? (sukunPackage.foc_qty_2 || 0) : (qty2 >= 0 ? qty(r[qty2]) : 0),
          foc_unit_2: hasSukunPackage ? (sukunPackage.foc_unit_2 || '') : (unit2 >= 0 ? normalizeFocUnit(r[unit2]) : ''),
          approval: appi >= 0 ? upper(r[appi]) === 'TRUE' : false,
          notes: note || sukunNote || reason,
        };
      });
  }

  return {
    buildSukunListingFocPackage,
    campaignDebtorCode,
    campaignListingPreviewStats,
    campaignPackageSignature,
    formatFocPackage,
    inferSukunListingFocUnit,
    mergeCampaignDebtorListings,
    normalizeFocUnit,
    parseCampaignUploadRows,
  };
});
