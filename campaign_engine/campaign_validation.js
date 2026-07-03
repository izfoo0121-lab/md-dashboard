(function(root, factory) {
  const model = root.PFMDCampaignEngine && root.PFMDCampaignEngine.model
    ? root.PFMDCampaignEngine.model
    : (typeof require === 'function' ? require('./campaign_model.js') : null);
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PFMDCampaignEngine = Object.assign(root.PFMDCampaignEngine || {}, { validation: api });
})(typeof window !== 'undefined' ? window : globalThis, function(model) {
  function makeResult(errors, warnings) {
    return { ok: errors.length === 0, errors, warnings };
  }

  function error(code, message, detail) {
    return { code, message, detail };
  }

  function validateCampaignMechanism(draft) {
    const errors = [];
    const source = draft || {};
    const notes = source.notes || {};
    const mechanism = notes.mechanism_type || 'manual_claim';
    const matchValues = Array.isArray(notes.qualifying_values) ? notes.qualifying_values.filter(Boolean) : [];
    const lookbackMonths = Array.isArray(notes.lookback_months) ? notes.lookback_months.filter(Boolean) : [];
    const conversionRule = notes.conversion_rule || 'no_lookback_then_current';

    if (mechanism === 'conversion' || mechanism === 'linked_conversion_repeat') {
      if (!matchValues.length) errors.push(error('missing_qualifying_values', 'Conversion campaigns need at least one qualifying value.'));
      if (conversionRule === 'no_lookback_then_current' && !lookbackMonths.length) {
        errors.push(error('missing_lookback_months', 'No-lookback conversion needs at least one lookback month.'));
      }
    }

    if (mechanism === 'linked_conversion_repeat') {
      if (!notes.stage1_foc_note) errors.push(error('missing_stage1_foc_note', 'Linked conversion needs a Stage 1 FOC note.'));
      if (!notes.stage2_foc_note) errors.push(error('missing_stage2_foc_note', 'Linked conversion needs a Stage 2 FOC note.'));
      if ((Number(notes.stage2_min_ctn) || 0) <= 0) errors.push(error('missing_stage2_min_ctn', 'Linked conversion needs a repeat minimum CTN.'));
    }

    if (mechanism === 'volume_reward') {
      if (!matchValues.length) errors.push(error('missing_qualifying_values', 'Volume rewards need at least one qualifying value.'));
      if (!Array.isArray(notes.reward_tiers) || !notes.reward_tiers.length) {
        errors.push(error('missing_reward_tiers', 'Volume rewards need at least one reward tier.'));
      }
    }

    if (mechanism === 'delivery_gift') {
      const hasDefaultGift = !!source.default_foc_item;
      const hasDebtorPackage = (source.debtors || []).some(row => row.foc_item || row.foc_item_2 || row.foc_item2);
      if (!hasDefaultGift && !hasDebtorPackage) {
        errors.push(error('missing_delivery_gift_package', 'Delivery gifts need a default or debtor-level FOC package.'));
      }
    }

    return makeResult(errors, []);
  }

  function validateCampaignDebtorAgents(debtors, adapter) {
    const errors = [];
    const normalizeAgent = adapter && typeof adapter.normalizeAgent === 'function' ? adapter.normalizeAgent : model.upper;
    const activeAgents = new Set((adapter && Array.isArray(adapter.activeAgents) ? adapter.activeAgents : []).map(normalizeAgent).filter(Boolean));
    const bad = [];

    (debtors || []).forEach(row => {
      const agent = normalizeAgent(row && row.agent);
      if (!agent || (activeAgents.size && !activeAgents.has(agent))) {
        bad.push((row && (row.debtor_code || row.code)) || 'UNKNOWN');
      }
    });

    if (bad.length) {
      errors.push(error('unclaimable_debtor_agent', 'Campaign debtor list has rows that no active agent can claim.', bad));
    }

    return makeResult(errors, []);
  }

  function validateCampaignListingCoverage(debtors, targetGroups, adapter) {
    if (adapter && typeof adapter.validateListingCoverage === 'function') {
      return adapter.validateListingCoverage(debtors, targetGroups);
    }
    if (!Array.isArray(debtors) || !debtors.length) {
      return makeResult([error('empty_target_group_listing', 'No debtor rows match the selected campaign target group.')], []);
    }
    return makeResult([], []);
  }

  function validateCampaignDraft(draft, adapter) {
    const source = draft || {};
    const errors = [];
    const warnings = [];

    if (!source.name) errors.push(error('missing_name', 'Please enter campaign name.'));
    if (!source.deadline) errors.push(error('missing_deadline', 'Please set deadline.'));
    if (!Array.isArray(source.kpi_numerators) || !source.kpi_numerators.length) {
      errors.push(error('missing_kpi_numerator', 'Please select at least one KPI numerator.'));
    }
    if (!Array.isArray(source.debtors) || !source.debtors.length) {
      errors.push(error('missing_debtor_list', 'Please upload debtor list.'));
    }

    [validateCampaignMechanism(source), validateCampaignDebtorAgents(source.debtors, adapter), validateCampaignListingCoverage(source.debtors, source.target_groups || ['all'], adapter)]
      .forEach(result => {
        errors.push.apply(errors, result.errors);
        warnings.push.apply(warnings, result.warnings);
      });

    return makeResult(errors, warnings);
  }

  return {
    validateCampaignDraft,
    validateCampaignMechanism,
    validateCampaignDebtorAgents,
    validateCampaignListingCoverage,
  };
});
