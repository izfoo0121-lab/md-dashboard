import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  ApiError,
  handleAction,
  parseJsonObjectBody,
  sha256,
} from './service.mjs';


const MAX_BODY_BYTES = 64 * 1024;
const LOGIN_WINDOW_SECONDS = 15 * 60;
let cachedDependencies: ReturnType<typeof buildDependencies> | undefined;


function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}


async function unwrap<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}


function buildDependencies() {
  const supabaseUrl = requiredEnvironment('SUPABASE_URL');
  const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const configuredTimeout = Number(Deno.env.get('DASHBOARD_DB_TIMEOUT_MS'));

  return {
    now: () => Date.now(),
    timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : 8_000,
    sessions: {
      find: (tokenHash: string) => unwrap(
        client
          .from('dashboard_sessions')
          .select('token_hash,agent,role,created_at,expires_at,last_used_at')
          .eq('token_hash', tokenHash)
          .maybeSingle(),
      ),
      create: (row: Record<string, unknown>) => unwrap(
        client.from('dashboard_sessions').insert(row),
      ),
      touch: (tokenHash: string, lastUsedAt: string) => unwrap(
        client
          .from('dashboard_sessions')
          .update({ last_used_at: lastUsedAt })
          .eq('token_hash', tokenHash),
      ),
      delete: (tokenHash: string) => unwrap(
        client
          .from('dashboard_sessions')
          .delete()
          .eq('token_hash', tokenHash),
      ),
    },
    access: {
      monthly: (agent: string, month: string) => unwrap(
        client
          .from('targets_monthly')
          .select('active')
          .eq('agent', agent)
          .eq('month', month)
          .maybeSingle(),
      ),
      agent: (agent: string) => unwrap(
        client
          .from('targets_agents')
          .select('active')
          .eq('agent', agent)
          .maybeSingle(),
      ),
    },
    pins: {
      listForAuthentication: () => unwrap(
        client
          .from('agent_pins')
          .select('agent,pin')
          .order('agent'),
      ),
      list: () => unwrap(
        client
          .from('agent_pins')
          .select('agent,pin')
          .order('agent'),
      ),
      save: (row: { agent: string; pin: string }) => unwrap(
        client.from('agent_pins').upsert(row, { onConflict: 'agent' }),
      ),
    },
    snapshots: {
      getActive: (month: string) => unwrap(
        client
          .from('dashboard_active_snapshots')
          .select('month_key,generation_id')
          .eq('month_key', month)
          .maybeSingle(),
      ),
      getShared: (month: string, generationId: string) => unwrap(
        client
          .from('dashboard_snapshots')
          .select('month,generation_id,shared_payload,manager_support_payload')
          .eq('month', month)
          .eq('generation_id', generationId)
          .maybeSingle(),
      ),
      getAgent: (month: string, generationId: string, agent: string) => unwrap(
        client
          .from('dashboard_agent_snapshots')
          .select('month,generation_id,agent,agent_payload')
          .eq('month', month)
          .eq('generation_id', generationId)
          .eq('agent', agent)
          .maybeSingle(),
      ),
      listAgents: (month: string, generationId: string) => unwrap(
        client
          .from('dashboard_agent_snapshots')
          .select('month,generation_id,agent,agent_payload')
          .eq('month', month)
          .eq('generation_id', generationId)
          .order('agent'),
      ),
      listMonths: async () => {
        const rows = await unwrap<Array<{ month_key: string }>>(
          client
            .from('dashboard_active_snapshots')
            .select('month_key,activated_at')
            .order('activated_at', { ascending: false }),
        );
        return rows.map((row) => row.month_key);
      },
    },
    artifacts: {
      get: (month: string, generationId: string, artifactKey: string) => unwrap(
        client
          .from('dashboard_manager_artifacts')
          .select('month_key,generation_id,artifact_key,payload')
          .eq('month_key', month)
          .eq('generation_id', generationId)
          .eq('artifact_key', artifactKey)
          .maybeSingle(),
      ),
    },
    loginAttempts: {
      reserve: async (
        bucketKey: string,
        attemptedAt: string,
        maxAttempts: number,
      ) => {
        const rows = await unwrap<Array<{
          allowed: boolean;
          attempt_count: number;
          window_started_at: string;
        }>>(
          client.rpc('dashboard_reserve_login_attempt', {
            p_bucket_key: bucketKey,
            p_attempted_at: attemptedAt,
            p_window_seconds: LOGIN_WINDOW_SECONDS,
            p_max_attempts: maxAttempts,
          }),
        );
        return rows?.[0] ?? null;
      },
      delete: (bucketKey: string) => unwrap(
        client
          .from('dashboard_login_attempts')
          .delete()
          .eq('bucket_key', bucketKey),
      ),
    },
    sync: {
      load: async ({ agent, month }: { agent: string; month: string }) => {
        const [claims, flags, kpiScores, birthdayOverrides] = await Promise.all([
          unwrap(
            client
              .from('claims')
              .select('*')
              .eq('month', month)
              .eq('agent', agent),
          ),
          unwrap(
            client
              .from('flags')
              .select('*')
              .eq('month', month)
              .eq('agent', agent),
          ),
          unwrap(
            client
              .from('kpi_scores')
              .select('*')
              .eq('month', month)
              .eq('agent', agent),
          ),
          unwrap(
            client
              .from('targets_birthday_overrides')
              .select('month,debtor_code,action')
              .eq('month', month),
          ),
        ]);
        return { claims, flags, kpiScores, birthdayOverrides };
      },
    },
  };
}


function dependencies() {
  cachedDependencies ??= buildDependencies();
  return cachedDependencies;
}


function allowedOrigins(): string[] {
  return (Deno.env.get('DASHBOARD_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}


function corsHeaders(request: Request): Record<string, string> {
  const requestOrigin = request.headers.get('origin') ?? '';
  const configured = allowedOrigins();
  const allowOrigin = configured.length === 0
    ? '*'
    : configured.includes(requestOrigin)
    ? requestOrigin
    : 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}


function jsonResponse(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}


async function parseBody(request: Request): Promise<Record<string, unknown>> {
  return parseJsonObjectBody(request, MAX_BODY_BYTES);
}


async function networkBucket(request: Request): Promise<string> {
  const forwardedFor = request.headers.get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim();
  const networkValue = request.headers.get('cf-connecting-ip')
    ?? forwardedFor
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
  const salt = requiredEnvironment('DASHBOARD_RATE_LIMIT_SALT');
  return sha256(`${salt}:${networkValue}`);
}


Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  try {
    if (request.method !== 'POST') {
      throw new ApiError(405, 'method not allowed', 'method_not_allowed');
    }
    const body = await parseBody(request);
    if (body.action === 'login') {
      body.bucket = await networkBucket(request);
    } else {
      delete body.bucket;
    }
    const result = await handleAction(body, dependencies());
    return jsonResponse(request, result);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.error('dashboard-api internal error');
    }
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError
      ? error.message
      : 'internal server error';
    const code = error instanceof ApiError ? error.code : 'internal_error';
    return jsonResponse(request, { error: message, code }, status);
  }
});
