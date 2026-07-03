(function(root, factory) {
  const mapper = root.PFMDCampaignEngine && root.PFMDCampaignEngine.mapper
    ? root.PFMDCampaignEngine.mapper
    : (typeof require === 'function' ? require('./campaign_db_mapper.js') : null);
  const api = factory(mapper);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PFMDCampaignEngine = Object.assign(root.PFMDCampaignEngine || {}, { repository: api });
})(typeof window !== 'undefined' ? window : globalThis, function(mapper) {
  function groupBy(rows, key) {
    return (rows || []).reduce(function(acc, row) {
      const value = row && row[key];
      if (!value) return acc;
      if (!acc[value]) acc[value] = [];
      acc[value].push(row);
      return acc;
    }, {});
  }

  async function postRows(deps, table, rows, chunkSize) {
    return writeRows(deps, table, rows, chunkSize, { Prefer: 'return=minimal' });
  }

  async function upsertRows(deps, table, rows, chunkSize) {
    return writeRows(deps, table, rows, chunkSize, { Prefer: 'resolution=merge-duplicates,return=minimal' });
  }

  async function writeRows(deps, table, rows, chunkSize, headers) {
    if (!rows || !rows.length) return;
    const size = chunkSize || deps.chunkSize || 500;
    const retryChunkSize = deps.retryChunkSize || 100;
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size);
      try {
        await writeChunk(deps, table, chunk, headers);
      } catch (error) {
        if (chunk.length <= retryChunkSize || !shouldRetryChunkWrite(error)) throw error;
        for (let j = 0; j < chunk.length; j += retryChunkSize) {
          await writeChunk(deps, table, chunk.slice(j, j + retryChunkSize), headers);
        }
      }
    }
  }

  function shouldRetryChunkWrite(error) {
    if (!error) return false;
    const status = Number(error.status || error.statusCode || error.code);
    if (status === 413 || status === 414 || status === 429) return true;
    const message = [
      error.message,
      error.details,
      error.hint,
      error.error,
      error.description,
    ].filter(Boolean).join(' ').toLowerCase();
    return (
      message.includes('payload too large') ||
      message.includes('request entity too large') ||
      message.includes('too large') ||
      message.includes('maximum') ||
      message.includes('body size')
    );
  }

  async function writeChunk(deps, table, chunk, headers) {
    return deps.supabaseFetch(table, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(chunk),
    });
  }

  async function deleteCampaignDebtorCodes(deps, campaignId, codes, chunkSize) {
    if (!codes || !codes.length) return;
    const size = chunkSize || deps.chunkSize || 500;
    const encodedCampaignId = encodeURIComponent(campaignId);
    for (let i = 0; i < codes.length; i += size) {
      const chunk = codes.slice(i, i + size);
      const encodedCodes = chunk.map(function(code) {
        return encodeURIComponent(code);
      }).join(',');
      await deps.supabaseFetch('campaign_debtors?campaign_id=eq.' + encodedCampaignId + '&debtor_code=in.(' + encodedCodes + ')', {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }
  }

  function campaignDeletePaths(campaignId) {
    const encodedCampaignId = encodeURIComponent(campaignId);
    return [
      'campaign_debtors?campaign_id=eq.' + encodedCampaignId,
      'campaign_cat_rules?campaign_id=eq.' + encodedCampaignId,
      'campaigns?id=eq.' + encodedCampaignId,
    ];
  }

  async function rollbackCampaignCreate(deps, campaignId) {
    const rollback = { attempted: true, ok: true, error: null };
    const cleanupPaths = campaignDeletePaths(campaignId);

    for (let i = 0; i < cleanupPaths.length; i += 1) {
      try {
        await deps.supabaseFetch(cleanupPaths[i], {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        });
      } catch (rollbackError) {
        rollback.ok = false;
        if (!rollback.error) rollback.error = rollbackError;
      }
    }

    return rollback;
  }

  async function createCampaign(deps, draft) {
    const now = deps.now || function() { return new Date(); };
    let insertedCampaign = false;

    try {
      await deps.supabaseFetch('campaigns', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(mapper.campaignToDbRow(draft, { now: now })),
      });
      insertedCampaign = true;

      await postRows(deps, 'campaign_cat_rules', mapper.campaignRuleRows(draft));
      await postRows(deps, 'campaign_debtors', mapper.campaignDebtorRows(draft));

      return { ok: true, campaign: draft };
    } catch (error) {
      const result = {
        ok: false,
        error: error,
        rollback: { attempted: insertedCampaign, ok: true, error: null },
      };

      if (insertedCampaign) {
        result.rollback = await rollbackCampaignCreate(deps, draft.id);
      }

      return result;
    }
  }

  async function loadCampaigns(deps) {
    const results = await Promise.all([
      deps.supabaseFetch('campaigns?select=*&order=created_at.desc'),
      deps.supabaseFetch('campaign_cat_rules?select=*'),
      deps.supabaseFetch('campaign_debtors?select=*&order=debtor_code.asc'),
    ]);
    const campaignRows = results[0] || [];
    const rulesByCampaign = groupBy(results[1] || [], 'campaign_id');
    const debtorsByCampaign = groupBy(results[2] || [], 'campaign_id');

    return {
      campaigns: campaignRows.map(function(row) {
        return mapper.campaignFromDb(row, rulesByCampaign, debtorsByCampaign);
      }),
    };
  }

  async function updateCampaign(deps, campaignId, patch) {
    const now = deps.now || function() { return new Date(); };
    return deps.supabaseFetch('campaigns?id=eq.' + encodeURIComponent(campaignId), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(Object.assign({}, patch, { updated_at: now().toISOString() })),
    });
  }

  async function closeCampaign(deps, campaignId) {
    return updateCampaign(deps, campaignId, { active: false });
  }

  async function reopenCampaign(deps, campaignId) {
    return updateCampaign(deps, campaignId, { active: true });
  }

  async function hardDeleteCampaign(deps, campaignId) {
    const cleanupPaths = campaignDeletePaths(campaignId);
    let result;
    for (let i = 0; i < cleanupPaths.length; i += 1) {
      result = await deps.supabaseFetch(cleanupPaths[i], {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }
    return result;
  }

  async function replaceCampaignDebtors(deps, campaignId, debtors) {
    const encodedCampaignId = encodeURIComponent(campaignId);
    const existingRows = await deps.supabaseFetch('campaign_debtors?campaign_id=eq.' + encodedCampaignId + '&select=debtor_code');
    const existingCodes = [];
    const seenExistingCodes = {};
    (existingRows || []).forEach(function(row) {
      const code = row && row.debtor_code;
      if (!code || seenExistingCodes[code]) return;
      seenExistingCodes[code] = true;
      existingCodes.push(code);
    });

    const rows = mapper.campaignDebtorRows({ id: campaignId, debtors: debtors || [] });
    await upsertRows(deps, 'campaign_debtors?on_conflict=campaign_id,debtor_code', rows);

    const replacementCodes = {};
    rows.forEach(function(row) {
      if (row && row.debtor_code) replacementCodes[row.debtor_code] = true;
    });
    const removedCodes = existingCodes.filter(function(code) {
      return !replacementCodes[code];
    });
    await deleteCampaignDebtorCodes(deps, campaignId, removedCodes);

    return { ok: true };
  }

  return {
    postRows: postRows,
    createCampaign: createCampaign,
    loadCampaigns: loadCampaigns,
    updateCampaign: updateCampaign,
    closeCampaign: closeCampaign,
    reopenCampaign: reopenCampaign,
    hardDeleteCampaign: hardDeleteCampaign,
    replaceCampaignDebtors: replaceCampaignDebtors,
  };
});
