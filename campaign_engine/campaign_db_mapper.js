(function(root, factory) {
  const model = root.PFMDCampaignEngine && root.PFMDCampaignEngine.model
    ? root.PFMDCampaignEngine.model
    : (typeof require === 'function' ? require('./campaign_model.js') : null);
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PFMDCampaignEngine = Object.assign(root.PFMDCampaignEngine || {}, { mapper: api });
})(typeof window !== 'undefined' ? window : globalThis, function(model) {
  function textOrNull(value) {
    const s = model.text(value);
    return s ? s : null;
  }

  function ruleNotes(rule) {
    const notes = {};
    if (rule && rule.max_redempt !== undefined && rule.max_redempt !== '') notes.max_redempt = rule.max_redempt;
    if (rule && rule.accumulative !== undefined && rule.accumulative !== '') {
      notes.accumulative = rule.accumulative === true || rule.accumulative === 'yes';
    }
    return Object.keys(notes).length ? JSON.stringify(notes) : textOrNull(rule && rule.notes);
  }

  function normalizeTargetGroup(value) {
    const raw = model.text(value).toLowerCase().replace(/[()+]/g, ' ').replace(/\s+/g, ' ');
    if (!raw || raw === 'all') return 'all';
    if (raw === 'grp1' || raw === 'grp 1') return 'grp1';
    if (raw === 'grp2a' || raw === 'grp 2a') return 'grp2a';
    if (raw === 'grp3' || raw === 'grp 3' || raw === 'grp3a' || raw === 'grp 3a' || raw === 'grp3_3a' || raw === 'grp 3 3a') return 'grp3_3a';
    if (raw === 'grp4' || raw === 'grp 4' || raw === 'grp4a' || raw === 'grp 4a' || raw === 'grp4_4a' || raw === 'grp 4 4a') return 'grp4_4a';
    return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function normalizeTargetGroups(value) {
    const raw = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
    const groups = [];
    raw.forEach(function(entry) {
      const parts = typeof entry === 'string' ? entry.split(/[,\n]/) : [entry];
      parts.forEach(function(part) {
        const group = normalizeTargetGroup(part);
        if (group && groups.indexOf(group) === -1) groups.push(group);
      });
    });
    return groups;
  }

  function targetGroupsApplyToAll(groups) {
    return !groups.length || groups.indexOf('all') !== -1;
  }

  function notesObject(notes) {
    return notes && typeof notes === 'object' && !Array.isArray(notes) ? notes : {};
  }

  function campaignNotesToDb(draft) {
    const notes = notesObject(draft.notes);
    const sourceGroups = Object.prototype.hasOwnProperty.call(draft, 'target_groups')
      ? draft.target_groups
      : (notes.target_groups || notes.apply_groups || notes.target_group);
    const targetGroups = normalizeTargetGroups(sourceGroups);
    return {
      ...notes,
      target_groups: targetGroupsApplyToAll(targetGroups) ? ['all'] : targetGroups,
    };
  }

  function campaignToDbRow(draft, opts) {
    const options = opts || {};
    const now = options.now || function() { return new Date(); };
    return {
      id: draft.id,
      name: draft.name,
      type: draft.type || 'other',
      brands: Array.isArray(draft.brands) ? draft.brands : (draft.brand ? [draft.brand] : []),
      description: textOrNull(draft.description),
      notes: campaignNotesToDb(draft),
      promo_detail: textOrNull(draft.promo_detail),
      foc_note: textOrNull(draft.foc_note),
      conditions: Array.isArray(draft.conditions) ? draft.conditions : [],
      festive_occasion: textOrNull(draft.festive_occasion),
      min_order_ctn: model.numOrNull(draft.min_order_ctn),
      default_foc_item: textOrNull(draft.default_foc_item),
      default_foc_qty: model.numOrNull(draft.default_foc_qty),
      default_foc_unit: textOrNull(model.normalizeFocUnit(draft.default_foc_unit)),
      default_foc_type: textOrNull(draft.default_foc_type),
      default_foc_item_2: textOrNull(draft.default_foc_item_2 || draft.foc_item2),
      default_foc_qty_2: model.numOrNull(draft.default_foc_qty_2 ?? draft.foc_qty2),
      default_foc_unit_2: textOrNull(model.normalizeFocUnit(draft.default_foc_unit_2 || draft.foc_unit2)),
      no_cap: !!draft.no_cap,
      active: draft.active !== false,
      start_date: draft.start_date || null,
      deadline: draft.deadline || null,
      kpi_numerators: Array.isArray(draft.kpi_numerators) && draft.kpi_numerators.length ? draft.kpi_numerators : ['count'],
      updated_at: now().toISOString(),
    };
  }

  function campaignRuleRows(draft) {
    return Object.entries(draft.cat_rules || {}).map(function(entry) {
      const catGroup = entry[0];
      const rule = entry[1] || {};
      return {
        campaign_id: draft.id,
        cat_group: catGroup,
        min_order_ctn: model.numOrNull(rule.min_order_ctn ?? rule.min_ctn),
        foc_item: textOrNull(rule.foc_item),
        foc_qty: model.numOrNull(rule.foc_qty),
        foc_unit: textOrNull(model.normalizeFocUnit(rule.foc_unit)),
        foc_type: textOrNull(rule.foc_type),
        promo_detail: rule.promo_detail || rule.promo || null,
        cap: model.numOrNull(rule.cap),
        target_pct: model.numOrNull(rule.target_pct),
        target_label: textOrNull(rule.target_label),
        notes: ruleNotes(rule),
      };
    });
  }

  function campaignDebtorRows(draft) {
    return (draft.debtors || []).map(function(debtor) {
      const cat = debtor.cat || '';
      const catGroup = debtor.cat_group || (cat ? String(cat).trim().charAt(0).toUpperCase() : null);
      const debtorNotes = debtor.notes || debtor.eligibility_reason || debtor.promo_logic || null;
      return {
        campaign_id: draft.id,
        debtor_code: debtor.code || debtor.debtor_code || '',
        debtor_name: debtor.name || debtor.debtor_name || null,
        agent: debtor.agent || null,
        cat: debtor.cat || null,
        cat_group: catGroup || null,
        debtor_type: debtor.debtor_type || null,
        foc_item: textOrNull(debtor.foc_item),
        foc_qty: model.numOrNull(debtor.foc_qty),
        foc_unit: textOrNull(model.normalizeFocUnit(debtor.foc_unit)),
        foc_type: textOrNull(debtor.foc_type),
        rebate: model.numOrNull(debtor.rebate),
        foc_item_2: textOrNull(debtor.foc_item_2 || debtor.foc_item2),
        foc_qty_2: model.numOrNull(debtor.foc_qty_2 ?? debtor.foc_qty2),
        foc_unit_2: textOrNull(model.normalizeFocUnit(debtor.foc_unit_2 || debtor.foc_unit2)),
        avg_ctn: model.numOrNull(debtor.avg_ctn),
        promo_logic: null,
        approval: !!debtor.approval,
        approval_note: debtor.approval_note || null,
        notes: debtorNotes,
      };
    });
  }

  function parseRuleNotes(notes) {
    if (!notes) return {};
    try {
      const parsed = JSON.parse(notes);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { notes: notes };
    } catch (_) {
      return { notes: notes };
    }
  }

  function campaignFromDb(row, rulesByCampaign, debtorsByCampaign) {
    const rules = rulesByCampaign || {};
    const debtorsById = debtorsByCampaign || {};
    const brands = Array.isArray(row.brands) ? row.brands : (row.brands ? [row.brands] : []);
    const notes = notesObject(row.notes);
    const targetGroups = normalizeTargetGroups(notes.target_groups || notes.apply_groups || notes.target_group);
    const catRules = {};
    (rules[row.id] || []).forEach(function(rule) {
      if (!rule.cat_group) return;
      catRules[rule.cat_group] = {
        promo: rule.promo_detail || '',
        promo_detail: rule.promo_detail || '',
        min_ctn: rule.min_order_ctn ?? '',
        min_order_ctn: rule.min_order_ctn ?? null,
        foc_item: rule.foc_item ?? '',
        foc_qty: rule.foc_qty ?? '',
        foc_unit: rule.foc_unit ?? '',
        foc_type: rule.foc_type ?? '',
        cap: rule.cap ?? null,
        target_pct: rule.target_pct ?? null,
        target_label: rule.target_label ?? '',
        ...parseRuleNotes(rule.notes),
      };
    });

    const debtors = (debtorsById[row.id] || []).map(function(debtor) {
      return {
        code: debtor.debtor_code || '',
        debtor_code: debtor.debtor_code || '',
        name: debtor.debtor_name || '',
        debtor_name: debtor.debtor_name || '',
        agent: debtor.agent || '',
        cat: debtor.cat || '',
        cat_group: debtor.cat_group || '',
        debtor_type: debtor.debtor_type || '',
        foc_item: debtor.foc_item || '',
        foc_qty: debtor.foc_qty ?? '',
        foc_unit: debtor.foc_unit || '',
        foc_type: debtor.foc_type || '',
        rebate: debtor.rebate ?? null,
        foc_item2: debtor.foc_item_2 || '',
        foc_qty2: debtor.foc_qty_2 ?? '',
        foc_item_2: debtor.foc_item_2 || '',
        foc_qty_2: debtor.foc_qty_2 ?? '',
        foc_unit_2: debtor.foc_unit_2 || '',
        avg_ctn: debtor.avg_ctn ?? null,
        promo_logic: debtor.promo_logic || '',
        eligibility_reason: debtor.promo_logic || debtor.notes || '',
        approval: !!debtor.approval,
        approval_note: debtor.approval_note || '',
        notes: debtor.notes || '',
      };
    });

    return {
      id: row.id,
      name: row.name || '',
      type: row.type || 'other',
      brand: brands.length === 1 ? brands[0] : '',
      brands: brands,
      description: row.description || '',
      notes: notes,
      target_groups: targetGroupsApplyToAll(targetGroups) ? ['all'] : targetGroups,
      promo_detail: row.promo_detail || '',
      min_order_ctn: row.min_order_ctn ?? null,
      cat_rules: catRules,
      default_foc_item: row.default_foc_item || '',
      default_foc_qty: row.default_foc_qty ?? '',
      default_foc_unit: row.default_foc_unit || '',
      default_foc_type: row.default_foc_type || '',
      default_foc_item_2: row.default_foc_item_2 || '',
      default_foc_qty_2: row.default_foc_qty_2 ?? '',
      default_foc_unit_2: row.default_foc_unit_2 || '',
      foc_note: row.foc_note || '',
      festive_occasion: row.festive_occasion || '',
      conditions: row.conditions || [],
      no_cap: !!row.no_cap,
      active: row.active !== false,
      start_date: row.start_date || null,
      deadline: row.deadline || '',
      kpi_numerators: Array.isArray(row.kpi_numerators) && row.kpi_numerators.length ? row.kpi_numerators : ['count'],
      created_at: row.created_at || '',
      updated_at: row.updated_at || '',
      debtors: debtors,
    };
  }

  return {
    campaignToDbRow,
    campaignRuleRows,
    campaignDebtorRows,
    campaignFromDb,
  };
});
