const DEFAULT_TIMEOUT_MS = 8_000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const MAX_LOGIN_ATTEMPTS = 5;

export const MANAGER_AGENT = 'GT138888';


export class ApiError extends Error {
  constructor(status, message, code = 'dashboard_api_error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}


export async function parseJsonObjectBody(request, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive integer');
  }
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiError(413, 'request body too large', 'request_too_large');
  }

  const reader = request.body?.getReader();
  const chunks = [];
  let totalBytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array
          ? value
          : new Uint8Array(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // The 413 remains authoritative if stream cancellation fails.
          }
          throw new ApiError(413, 'request body too large', 'request_too_large');
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const encoded = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    encoded.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(encoded);
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid JSON body', 'invalid_json');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'request body must be an object', 'invalid_request');
  }
  return body;
}


function currentTime(deps) {
  const value = deps.now ? deps.now() : Date.now();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) {
    throw new ApiError(500, 'server clock unavailable', 'server_clock_unavailable');
  }
  return milliseconds;
}


function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new ApiError(400, `${label} is required`, 'invalid_request');
  return text;
}


function normalizeAgent(value) {
  return requiredText(value, 'agent').toUpperCase();
}


async function dependencyCall(
  deps,
  label,
  operation,
  unavailableMessage = `${label} unavailable`,
) {
  const configuredTimeout = Number(deps.timeoutMs);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_TIMEOUT_MS;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new ApiError(504, `${label} timed out`, 'dependency_timeout')),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, unavailableMessage, 'dependency_unavailable');
  } finally {
    clearTimeout(timer);
  }
}


export async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}


export async function timingSafeEqual(left, right) {
  const [leftDigest, rightDigest] = await Promise.all([
    sha256(left),
    sha256(right),
  ]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest.charCodeAt(index) ^ rightDigest.charCodeAt(index);
  }
  return difference === 0;
}


function randomSessionToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}


async function createSessionToken(deps) {
  const token = deps.randomToken
    ? await deps.randomToken()
    : randomSessionToken();
  return requiredText(token, 'session token');
}


export async function requireSession(token, deps) {
  const sessionToken = requiredText(token, 'session');
  const tokenHash = await sha256(sessionToken);
  const session = await dependencyCall(
    deps,
    'session lookup',
    () => deps.sessions.find(tokenHash),
    'session unavailable',
  );
  if (!session) {
    throw new ApiError(401, 'session expired', 'session_expired');
  }
  const expiresAt = Date.parse(session?.expires_at ?? '');
  if (!Number.isFinite(expiresAt) || expiresAt <= currentTime(deps)) {
    try {
      await dependencyCall(
        deps,
        'expired session cleanup',
        () => deps.sessions.delete(tokenHash),
        'session cleanup unavailable',
      );
    } catch {
      // Expiration remains authoritative when cleanup is temporarily unavailable.
    }
    throw new ApiError(401, 'session expired', 'session_expired');
  }
  if (!['agent', 'manager'].includes(session.role)) {
    throw new ApiError(401, 'session invalid', 'session_invalid');
  }

  await dependencyCall(
    deps,
    'session update',
    () => deps.sessions.touch(tokenHash, new Date(currentTime(deps)).toISOString()),
    'session unavailable',
  );
  return { ...session, token_hash: tokenHash };
}


export async function checkAgentMonthAccess(agent, month, deps) {
  const [monthly, global] = await dependencyCall(
    deps,
    'access check',
    () => Promise.all([
      deps.access.monthly(agent, month),
      deps.access.agent(agent),
    ]),
    'access unavailable',
  );
  if (!monthly || !global) {
    throw new ApiError(403, 'access unavailable', 'access_unavailable');
  }
  if (monthly.active !== true || global.active !== true) {
    throw new ApiError(403, 'access denied', 'access_denied');
  }
}


function rejectAgentSpoof(input, session) {
  if (input.agent == null || String(input.agent).trim() === '') return;
  if (normalizeAgent(input.agent) !== normalizeAgent(session.agent)) {
    throw new ApiError(403, 'agent mismatch', 'agent_mismatch');
  }
}


async function availableMonths(deps) {
  const months = await dependencyCall(
    deps,
    'snapshot month list',
    () => deps.snapshots.listMonths(),
    'dashboard data unavailable',
  );
  if (!Array.isArray(months)) {
    throw new ApiError(503, 'dashboard data unavailable', 'data_unavailable');
  }
  return months.map((month) => String(month));
}


async function activeGeneration(month, deps, unavailableMessage) {
  const active = await dependencyCall(
    deps,
    'active snapshot lookup',
    () => deps.snapshots.getActive(month),
    unavailableMessage,
  );
  if (!active) {
    throw new ApiError(404, 'dashboard month not found', 'month_not_found');
  }
  const generationId = String(active.generation_id ?? '').trim();
  if (
    !generationId
    || (active.month_key != null && String(active.month_key) !== month)
  ) {
    throw new ApiError(503, unavailableMessage, 'data_unavailable');
  }
  return generationId;
}


export function assembleAgentData(shared, agentRow) {
  const sharedPayload = shared?.shared_payload;
  const agentPayload = agentRow?.agent_payload;
  if (!sharedPayload || typeof sharedPayload !== 'object' || Array.isArray(sharedPayload)) {
    throw new ApiError(503, 'shared snapshot unavailable', 'data_unavailable');
  }
  if (!agentPayload || typeof agentPayload !== 'object' || Array.isArray(agentPayload)) {
    throw new ApiError(503, 'agent snapshot unavailable', 'data_unavailable');
  }
  const agentKeys = Object.keys(agentPayload.agents ?? {});
  if (
    agentKeys.length !== 1
    || (agentRow.agent && agentKeys[0] !== normalizeAgent(agentRow.agent))
  ) {
    throw new ApiError(503, 'agent snapshot unavailable', 'data_unavailable');
  }
  const safeShared = { ...sharedPayload };
  delete safeShared.agents;
  return { ...safeShared, ...agentPayload };
}


export function assembleManagerData(shared, agentRows) {
  const support = shared?.manager_support_payload;
  if (!support || typeof support !== 'object' || Array.isArray(support)) {
    throw new ApiError(503, 'manager snapshot unavailable', 'data_unavailable');
  }
  if (!Array.isArray(agentRows) || agentRows.length === 0) {
    throw new ApiError(503, 'manager snapshot unavailable', 'data_unavailable');
  }

  const agents = {};
  for (const row of agentRows) {
    const payloadAgents = row?.agent_payload?.agents;
    const keys = payloadAgents && typeof payloadAgents === 'object'
      ? Object.keys(payloadAgents)
      : [];
    if (keys.length !== 1 || (row.agent && keys[0] !== row.agent)) {
      throw new ApiError(503, 'manager snapshot unavailable', 'data_unavailable');
    }
    agents[keys[0]] = payloadAgents[keys[0]];
  }

  const managerSupport = { ...support };
  delete managerSupport.agents;
  return { ...managerSupport, agents };
}


async function loadDashboardData(session, monthValue, deps) {
  const month = requiredText(monthValue, 'month');
  const months = await availableMonths(deps);
  if (session.role !== 'manager') {
    await checkAgentMonthAccess(session.agent, month, deps);
  }
  const generationId = await activeGeneration(
    month,
    deps,
    'dashboard data unavailable',
  );

  const shared = await dependencyCall(
    deps,
    'shared snapshot lookup',
    () => deps.snapshots.getShared(month, generationId),
    'dashboard data unavailable',
  );
  if (!shared) throw new ApiError(404, 'dashboard month not found', 'month_not_found');

  let data;
  if (session.role === 'manager') {
    const rows = await dependencyCall(
      deps,
      'manager snapshot lookup',
      () => deps.snapshots.listAgents(month, generationId),
      'dashboard data unavailable',
    );
    data = assembleManagerData(shared, rows);
  } else {
    const row = await dependencyCall(
      deps,
      'agent snapshot lookup',
      () => deps.snapshots.getAgent(month, generationId, session.agent),
      'dashboard data unavailable',
    );
    if (!row) throw new ApiError(404, 'agent snapshot not found', 'data_not_found');
    data = assembleAgentData(shared, row);
  }

  return { month, availableMonths: months, data };
}


async function reserveLoginAttempt(bucketKey, attemptedAt, deps) {
  const reservation = await dependencyCall(
    deps,
    'login attempt reservation',
    () => deps.loginAttempts.reserve(
      bucketKey,
      attemptedAt,
      MAX_LOGIN_ATTEMPTS,
    ),
    'authentication unavailable',
  );
  if (!reservation || reservation.allowed !== true) {
    throw new ApiError(429, 'rate limit exceeded', 'rate_limited');
  }
}


async function authenticatePin(pin, deps) {
  return dependencyCall(
    deps,
    'authentication lookup',
    async () => {
      const rows = await deps.pins.listForAuthentication();
      if (!Array.isArray(rows)) throw new Error('malformed PIN rows');
      const matches = await Promise.all(
        rows.map((row) => timingSafeEqual(pin, String(row?.pin ?? ''))),
      );
      const validFormat = /^\d{4}$/u.test(pin);
      let matched = null;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const hasAgent = String(row?.agent ?? '').trim() !== '';
        if (
          matches[index]
          && validFormat
          && hasAgent
          && row.active !== false
          && matched === null
        ) {
          matched = row;
        }
      }
      return matched;
    },
    'authentication unavailable',
  );
}


export async function handleLogin(input, deps) {
  const month = requiredText(input?.month, 'month');
  const pin = String(input?.pin ?? '').trim();
  const bucketKey = String(input?.bucket ?? '').trim() || 'anonymous';
  const now = currentTime(deps);
  await reserveLoginAttempt(bucketKey, new Date(now).toISOString(), deps);

  const pinRow = await authenticatePin(pin, deps);
  if (!pinRow || pinRow.active === false) {
    throw new ApiError(401, 'invalid PIN', 'invalid_pin');
  }

  const agent = normalizeAgent(pinRow.agent);
  const role = pinRow.role === 'manager' || agent === MANAGER_AGENT
    ? 'manager'
    : 'agent';
  const initial = await loadDashboardData({ agent, role }, month, deps);

  await dependencyCall(
    deps,
    'login attempt reset',
    () => deps.loginAttempts.delete(bucketKey),
    'authentication unavailable',
  );

  const sessionToken = await createSessionToken(deps);
  const tokenHash = await sha256(sessionToken);
  const createdAt = new Date(now).toISOString();
  await dependencyCall(
    deps,
    'session creation',
    () => deps.sessions.create({
      token_hash: tokenHash,
      agent,
      role,
      created_at: createdAt,
      expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
      last_used_at: createdAt,
    }),
    'session unavailable',
  );

  return {
    sessionToken,
    agent,
    role,
    ...initial,
  };
}


export async function handleData(input, deps) {
  const session = await requireSession(input?.sessionToken, deps);
  rejectAgentSpoof(input ?? {}, session);
  const dataset = String(input?.dataset ?? 'dashboard');

  if (dataset === 'dashboard') {
    return loadDashboardData(session, input?.month, deps);
  }
  if (dataset !== 'debtor_analysis') {
    throw new ApiError(400, 'unsupported dataset', 'unsupported_dataset');
  }
  if (session.role !== 'manager') {
    throw new ApiError(403, 'manager required', 'manager_required');
  }

  const month = requiredText(input?.month, 'month');
  const generationId = await activeGeneration(
    month,
    deps,
    'manager data unavailable',
  );
  const artifact = await dependencyCall(
    deps,
    'manager artifact lookup',
    () => deps.artifacts.get(month, generationId, 'debtor_analysis'),
    'manager data unavailable',
  );
  if (!artifact?.payload) {
    throw new ApiError(404, 'debtor analysis not found', 'data_not_found');
  }
  const months = await availableMonths(deps);
  if (String(artifact.payload.current_month ?? '').trim() !== month) {
    throw new ApiError(503, 'manager data unavailable', 'data_unavailable');
  }
  return { month, availableMonths: months, data: artifact.payload };
}


async function requireManager(input, deps) {
  const session = await requireSession(input?.sessionToken, deps);
  if (session.role !== 'manager') {
    throw new ApiError(403, 'manager required', 'manager_required');
  }
  return session;
}


export async function handleManagerPinsList(input, deps) {
  await requireManager(input, deps);
  const rows = await dependencyCall(
    deps,
    'PIN list lookup',
    () => deps.pins.list(),
    'PIN list unavailable',
  );
  if (!Array.isArray(rows)) {
    throw new ApiError(503, 'PIN list unavailable', 'dependency_unavailable');
  }
  const pins = rows
    .filter((row) => normalizeAgent(row.agent) !== MANAGER_AGENT)
    .map((row) => ({ agent: normalizeAgent(row.agent), pin: String(row.pin) }))
    .sort((left, right) => left.agent.localeCompare(right.agent));
  return { pins };
}


export async function handleManagerPinsSave(input, deps) {
  await requireManager(input, deps);
  const payload = input?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ApiError(400, 'PIN payload is required', 'invalid_request');
  }
  const agent = normalizeAgent(payload.agent);
  const pin = String(payload.pin ?? '').trim();
  if (agent === MANAGER_AGENT) {
    throw new ApiError(
      403,
      'manager PIN cannot be changed through this action',
      'manager_pin_protected',
    );
  }
  if (!/^\d{4}$/u.test(pin)) {
    throw new ApiError(400, 'PIN must contain four digits', 'invalid_pin');
  }
  await dependencyCall(
    deps,
    'PIN save',
    () => deps.pins.save({ agent, pin }),
    'PIN save unavailable',
  );
  return { saved: true, agent };
}


export async function handleSync(input, deps) {
  const session = await requireSession(input?.sessionToken, deps);
  rejectAgentSpoof(input ?? {}, session);
  const month = requiredText(input?.month, 'month');
  const generationId = await activeGeneration(
    month,
    deps,
    'dashboard sync unavailable',
  );
  let agentSnapshot = null;
  if (session.role !== 'manager') {
    await checkAgentMonthAccess(session.agent, month, deps);
    agentSnapshot = await dependencyCall(
      deps,
      'agent snapshot lookup',
      () => deps.snapshots.getAgent(month, generationId, session.agent),
      'dashboard sync unavailable',
    );
    if (!agentSnapshot) {
      throw new ApiError(404, 'agent snapshot not found', 'data_not_found');
    }
  }
  const state = await dependencyCall(
    deps,
    'dashboard sync',
    () => deps.sync.load({ agent: session.agent, month }),
    'dashboard sync unavailable',
  );
  let claims = Array.isArray(state?.claims) ? state.claims : [];
  let flags = Array.isArray(state?.flags) ? state.flags : [];
  let kpiScores = Array.isArray(state?.kpiScores) ? state.kpiScores : [];
  let birthdayOverrides = Array.isArray(state?.birthdayOverrides)
    ? state.birthdayOverrides
    : [];

  if (session.role !== 'manager') {
    const sessionAgent = normalizeAgent(session.agent);
    const belongsToSession = (row) => (
      row
      && typeof row === 'object'
      && String(row.agent ?? '').trim().toUpperCase() === sessionAgent
    );
    claims = claims.filter(belongsToSession);
    flags = flags.filter(belongsToSession);
    kpiScores = kpiScores.filter(belongsToSession);

    const debtors = agentSnapshot?.agent_payload?.agents?.[sessionAgent]
      ?.debtor_cards?.debtors;
    if (!Array.isArray(debtors)) {
      throw new ApiError(503, 'dashboard sync unavailable', 'data_unavailable');
    }
    const allowedDebtorCodes = new Set(
      debtors
        .map((debtor) => String(debtor?.debtor_code ?? '').trim())
        .filter(Boolean),
    );
    birthdayOverrides = birthdayOverrides.filter((row) => (
      row
      && typeof row === 'object'
      && allowedDebtorCodes.has(String(row.debtor_code ?? '').trim())
    ));
  }

  return {
    month,
    claims,
    flags,
    kpiScores,
    birthdayOverrides,
  };
}


export async function handleLogout(input, deps) {
  const session = await requireSession(input?.sessionToken, deps);
  await dependencyCall(
    deps,
    'session deletion',
    () => deps.sessions.delete(session.token_hash),
    'session unavailable',
  );
  return { loggedOut: true };
}


export async function handleAction(input, deps) {
  switch (input?.action) {
    case 'login':
      return handleLogin(input, deps);
    case 'data':
      return handleData(input, deps);
    case 'sync':
      return handleSync(input, deps);
    case 'manager.pins.list':
      return handleManagerPinsList(input, deps);
    case 'manager.pins.save':
      return handleManagerPinsSave(input, deps);
    case 'logout':
      return handleLogout(input, deps);
    default:
      throw new ApiError(400, 'unsupported action', 'unsupported_action');
  }
}
