(function attachDashboardApi(root, factory) {
  const exported = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = exported;
  root.DashboardApi = exported;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildDashboardApi(root) {
  'use strict';

  const SESSION_KEY = 'md_dashboard_session';
  const IDENTITY_KEY = 'md_dashboard_identity';
  const DEFAULT_ENDPOINT = '/functions/v1/dashboard-api';
  const DEFAULT_TIMEOUT_MS = 10_000;

  class DashboardApiError extends Error {
    constructor(status, message, code = 'dashboard_api_error') {
      super(message);
      this.name = 'DashboardApiError';
      this.status = status;
      this.code = code;
    }
  }

  class StaleDashboardResponseError extends DashboardApiError {
    constructor() {
      super(409, 'stale response discarded', 'stale_response');
      this.name = 'StaleDashboardResponseError';
    }
  }

  function createMemoryStorage() {
    const values = new Map();
    return {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      removeItem(key) {
        values.delete(key);
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
    };
  }

  function defaultStorage() {
    try {
      if (root.sessionStorage) return root.sessionStorage;
    } catch {
      // Browsers can deny storage in restricted contexts.
    }
    return createMemoryStorage();
  }

  function errorDetails(payload) {
    const raw = payload && payload.error;
    if (typeof raw === 'string' && raw.trim()) {
      return { message: raw, code: payload.code };
    }
    if (raw && typeof raw === 'object') {
      return {
        message: String(raw.message || 'request failed'),
        code: raw.code || payload.code,
      };
    }
    return {
      message: 'request failed',
      code: payload && payload.code,
    };
  }

  function createDashboardApi(options = {}) {
    const fetchImpl = options.fetch
      || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    const storage = options.sessionStorage || defaultStorage();
    const invalidateExportState = typeof options.invalidateExportState === 'function'
      ? options.invalidateExportState
      : null;
    const AbortControllerImpl = options.AbortController || root.AbortController;
    const extraHeaders = { ...(options.headers || {}) };

    let endpoint = String(
      options.endpoint || root.DASHBOARD_API_ENDPOINT || DEFAULT_ENDPOINT,
    );
    let publishableKey = String(
      options.publishableKey || root.DASHBOARD_API_PUBLISHABLE_KEY || '',
    );
    let clientVersion = options.clientVersion;
    let timeoutMs = Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_TIMEOUT_MS;
    let transitionVersion = 0;
    let exportVersion = 0;

    function clearSession() {
      try {
        storage.removeItem(SESSION_KEY);
        storage.removeItem(IDENTITY_KEY);
      } catch {
        // Clearing is best effort when the browser revokes storage access.
      }
    }

    function readToken() {
      try {
        return String(storage.getItem(SESSION_KEY) || '').trim();
      } catch {
        return '';
      }
    }

    function requireToken() {
      const token = readToken();
      if (!token) {
        throw new DashboardApiError(401, 'session required', 'session_required');
      }
      return token;
    }

    function storeSession(payload) {
      const token = String(payload && payload.sessionToken || '').trim();
      const agent = String(payload && payload.agent || '').trim();
      const role = String(payload && payload.role || '').trim();
      if (!token || !agent || !['agent', 'manager'].includes(role)) {
        throw new DashboardApiError(
          502,
          'invalid login response',
          'invalid_login_response',
        );
      }
      try {
        storage.setItem(SESSION_KEY, token);
        storage.setItem(IDENTITY_KEY, JSON.stringify({ agent, role }));
      } catch {
        clearSession();
        throw new DashboardApiError(
          500,
          'session storage unavailable',
          'storage_unavailable',
        );
      }
    }

    function restoreSession() {
      const token = readToken();
      let identity;
      try {
        identity = JSON.parse(storage.getItem(IDENTITY_KEY) || 'null');
      } catch {
        identity = null;
      }
      const agent = String(identity && identity.agent || '').trim();
      const role = String(identity && identity.role || '').trim();
      if (!token || !agent || !['agent', 'manager'].includes(role)) {
        clearSession();
        return null;
      }
      return { agent, role };
    }

    function invalidateExports(reason) {
      exportVersion += 1;
      if (invalidateExportState) invalidateExportState(reason);
    }

    function beginTransition(reason) {
      transitionVersion += 1;
      invalidateExports(reason);
      return transitionVersion;
    }

    function assertCurrentTransition(version) {
      if (version !== transitionVersion) throw new StaleDashboardResponseError();
    }

    function requestHeaders() {
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...extraHeaders,
      };
      if (publishableKey) {
        headers.apikey = publishableKey;
        headers.Authorization = `Bearer ${publishableKey}`;
      }
      return headers;
    }

    async function request(body) {
      if (!fetchImpl) {
        throw new DashboardApiError(
          500,
          'dashboard API fetch is unavailable',
          'client_configuration_error',
        );
      }
      if (!endpoint.trim()) {
        throw new DashboardApiError(
          500,
          'dashboard API endpoint is unavailable',
          'client_configuration_error',
        );
      }

      const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
      let timedOut = false;
      let timer;
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          if (controller) controller.abort();
          reject(new DashboardApiError(408, 'request timed out', 'request_timeout'));
        }, timeoutMs);
      });
      const operation = (async () => {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: requestHeaders(),
          body: JSON.stringify(body),
          signal: controller ? controller.signal : undefined,
        });
        let payload;
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }
        if (!response.ok) {
          const details = errorDetails(payload);
          if (Number(response.status) === 401 && body.sessionToken) {
            clearSession();
          }
          throw new DashboardApiError(
            Number(response.status) || 500,
            details.message,
            details.code || 'request_failed',
          );
        }
        return payload;
      })();

      try {
        return await Promise.race([operation, timeout]);
      } catch (error) {
        if (error instanceof DashboardApiError) throw error;
        if (timedOut || (error && error.name === 'AbortError')) {
          throw new DashboardApiError(408, 'request timed out', 'request_timeout');
        }
        throw new DashboardApiError(0, 'network request failed', 'network_error');
      } finally {
        clearTimeout(timer);
      }
    }

    async function login(pin, month, versionOverride) {
      const transition = beginTransition(`login:${month}`);
      clearSession();
      const body = { action: 'login', pin: String(pin), month: String(month) };
      const version = versionOverride || clientVersion;
      if (version) body.clientVersion = String(version);
      try {
        const payload = await request(body);
        assertCurrentTransition(transition);
        storeSession(payload);
        return payload;
      } catch (error) {
        if (transition === transitionVersion) clearSession();
        throw error;
      }
    }

    async function loadData(month, dataset) {
      const token = requireToken();
      const transition = beginTransition(`load:${month}`);
      const body = {
        action: 'data',
        sessionToken: token,
        month: String(month),
      };
      if (dataset) body.dataset = String(dataset);
      const payload = await request(body);
      assertCurrentTransition(transition);
      return payload;
    }

    function sync(month) {
      return request({
        action: 'sync',
        sessionToken: requireToken(),
        month: String(month),
      });
    }

    function listAgentPins() {
      return request({
        action: 'manager.pins.list',
        sessionToken: requireToken(),
      });
    }

    function saveAgentPin(agent, pin) {
      return request({
        action: 'manager.pins.save',
        sessionToken: requireToken(),
        payload: { agent: String(agent), pin: String(pin) },
      });
    }

    async function logout() {
      transitionVersion += 1;
      invalidateExports('logout');
      const token = readToken();
      if (!token) {
        clearSession();
        return { loggedOut: true };
      }
      try {
        return await request({ action: 'logout', sessionToken: token });
      } finally {
        clearSession();
      }
    }

    function configure(configuration = {}) {
      if (configuration.endpoint != null) {
        endpoint = String(configuration.endpoint);
      }
      if (configuration.publishableKey != null) {
        publishableKey = String(configuration.publishableKey);
      }
      if (configuration.clientVersion != null) {
        clientVersion = configuration.clientVersion;
      }
      if (Number(configuration.timeoutMs) > 0) {
        timeoutMs = Number(configuration.timeoutMs);
      }
      return api;
    }

    function getExportVersion() {
      return exportVersion;
    }

    const api = {
      configure,
      getExportVersion,
      listAgentPins,
      loadData,
      login,
      logout,
      restoreSession,
      saveAgentPin,
      sync,
    };
    return api;
  }

  const defaultApi = createDashboardApi();
  return {
    DashboardApiError,
    StaleDashboardResponseError,
    createDashboardApi,
    ...defaultApi,
  };
}));
