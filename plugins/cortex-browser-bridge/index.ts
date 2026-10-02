import { createHash, createHmac, randomBytes } from 'node:crypto';
import { deriveCortexPrincipal } from '../cortex-principal-identity.mjs';

type BridgeConfig = {
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  writeToken?: string;
  writeTokenHeader?: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  userId?: string;
  channelId?: string;
  scopeCredentialId?: string;
  scopeHmacSecret?: string;
  sessionIdentityHmacSecret?: string;
};

const BrowseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    url: { type: 'string' },
    maxResults: { type: 'number', minimum: 1, maximum: 10 },
    includeContent: { type: 'boolean' }
  }
} as const;

const StatusSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const;

function cfg(pluginConfig?: Record<string, unknown>): Required<BridgeConfig> {
  const c = (pluginConfig ?? {}) as BridgeConfig;
  const writeTokenHeader = c.writeTokenHeader ?? 'x-cortex-write-token';
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(writeTokenHeader)) throw new Error('invalid Cortex write-token header name');
  const resolved = {
    baseUrl: (c.baseUrl ?? 'http://127.0.0.1:18888').replace(/\/$/, ''),
    timeoutMs: typeof c.timeoutMs === 'number' ? c.timeoutMs : 15000,
    maxResponseBytes: typeof c.maxResponseBytes === 'number' ? c.maxResponseBytes : 1_048_576,
    writeToken: typeof c.writeToken === 'string' ? c.writeToken : '',
    writeTokenHeader: writeTokenHeader.toLowerCase(),
    tenantId: String(c.tenantId ?? '').trim(),
    workspaceId: String(c.workspaceId ?? '').trim(),
    agentId: String(c.agentId ?? '').trim(),
    userId: String(c.userId ?? '').trim(),
    channelId: String(c.channelId ?? '').trim(),
    scopeCredentialId: String(c.scopeCredentialId ?? '').trim(),
    scopeHmacSecret: String(c.scopeHmacSecret ?? ''),
    sessionIdentityHmacSecret: String(c.sessionIdentityHmacSecret ?? ''),
  };
  const missing = [
    'writeToken',
    'tenantId',
    'workspaceId',
    'agentId',
    'userId',
    'channelId',
    'scopeCredentialId',
    'scopeHmacSecret',
    'sessionIdentityHmacSecret',
  ].filter((field) => !String((resolved as any)[field] ?? '').trim());
  if (missing.length) throw new Error(`Cortex browser bridge requires ${missing.join(', ')}`);
  if (Buffer.byteLength(resolved.scopeHmacSecret, 'utf8') < 16) throw new Error('scopeHmacSecret must contain at least 16 bytes');
  if (Buffer.byteLength(resolved.sessionIdentityHmacSecret, 'utf8') < 16) throw new Error('sessionIdentityHmacSecret must contain at least 16 bytes');
  return resolved;
}

function actionHeaders(
  config: Required<BridgeConfig>,
  trustedContext: any,
  method: 'POST',
  path: string,
  body: string,
): Record<string, string> {
  const scope = deriveCortexPrincipal(config, trustedContext);
  const scopeValues = [
    scope.tenant_id,
    scope.workspace_id,
    scope.agent_id,
    scope.user_id,
    scope.channel_id,
    scope.session_id,
  ];
  const scopeSignature = createHmac('sha256', config.scopeHmacSecret)
    .update(['cortex.memory.principal.v2', config.scopeCredentialId, ...scopeValues].join('\n'), 'utf8')
    .digest('hex');
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60;
  const nonce = randomBytes(24).toString('base64url');
  const principalId = [
    'role:principal',
    `credential:${config.scopeCredentialId}`,
    ...Object.entries(scope).map(([field, value]) => `${field}:${value}`),
  ].join('|');
  const bodyDigest = createHash('sha256').update(body, 'utf8').digest('hex');
  const canonical = [
    'cortex.action.capability.v1',
    principalId,
    method,
    path,
    `sha256:${bodyDigest}`,
    nonce,
    String(issuedAt),
    String(expiresAt),
  ].join('\n');
  const actionSignature = createHmac('sha256', config.scopeHmacSecret)
    .update(canonical, 'utf8')
    .digest('hex');
  return {
    [config.writeTokenHeader]: config.writeToken,
    'x-cortex-tenant-id': scope.tenant_id,
    'x-cortex-workspace-id': scope.workspace_id,
    'x-cortex-agent-id': scope.agent_id,
    'x-cortex-user-id': scope.user_id,
    'x-cortex-channel-id': scope.channel_id,
    'x-cortex-session-id': scope.session_id,
    'x-cortex-scope-credential-id': config.scopeCredentialId,
    'x-cortex-scope-signature': scopeSignature,
    'x-cortex-action-nonce': nonce,
    'x-cortex-action-issued-at': String(issuedAt),
    'x-cortex-action-expires-at': String(expiresAt),
    'x-cortex-action-signature': actionSignature,
  };
}

export async function requestText(url: string, init: RequestInit, timeoutMs: number, maxResponseBytes: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxResponseBytes) {
      try { void res.body?.cancel().catch(() => {}); } catch { /* Preserve the bounded-read failure if cleanup fails. */ }
      throw new Error(`response exceeds ${maxResponseBytes} bytes`);
    }
    const reader = res.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxResponseBytes) { try { void reader.cancel().catch(() => {}); } catch {} throw new Error(`response exceeds ${maxResponseBytes} bytes`); }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(bytes);
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function maybeJson(text: string) {
  try { return JSON.parse(text); } catch { return text; }
}

const plugin = {
  id: 'cortex-browser-bridge',
  name: 'Cortex Browser Bridge',
  description: 'Expose Cortex L2 Ghost browser endpoints as first-class tools.',
  register(api: any) {
    const registrationConfig = cfg(api.pluginConfig);
    api.registerTool((trustedContext: any) => ({
      label: 'Cortex Browse',
      name: 'cortex_browse',
      description: 'Use Cortex L2 Ghost browser/search endpoint before generic web tools.',
      parameters: BrowseSchema,
      execute: async (_toolCallId: string, params: any) => {
        const c = registrationConfig;
        const query = String(params?.query ?? '');
        const hasUrl = typeof params?.url === 'string' && String(params.url).trim().length > 0;
        const payload = {
          query,
          ...(hasUrl ? { url: String(params.url) } : {}),
          max_results: Number(params?.maxResults ?? 5),
          include_content: Boolean(params?.includeContent ?? true),
        };
        const endpoint = hasUrl ? '/browser/browse' : '/browser/search';
        const body = JSON.stringify(payload);
        try {
          const headers = actionHeaders(c, trustedContext, 'POST', endpoint, body);
          const response = await requestText(`${c.baseUrl}${endpoint}`, { method: 'POST', headers, body }, c.timeoutMs, c.maxResponseBytes);
          if (!response.ok) {
            return JSON.stringify({
              ok: false,
              provider: 'cortex-browser',
              endpoint,
              status: response.status,
              error: 'Cortex browser request failed',
            });
          }
          return JSON.stringify({ ok: true, provider: 'cortex-browser', endpoint, data: maybeJson(response.text) });
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const boundedReadFailure = /^response exceeds \d+ bytes$/.test(message) ? message : 'Cortex browser request failed';
          return JSON.stringify({ ok: false, provider: 'cortex-browser', endpoint, error: boundedReadFailure });
        }
      },
    }), { names: ['cortex_browse'] });

    api.registerTool((_trustedContext: any) => ({
      label: 'Cortex Browser Status',
      name: 'cortex_browser_status',
      description: 'Check whether Cortex L2 Ghost browser endpoint is available.',
      parameters: StatusSchema,
      execute: async () => {
        const c = registrationConfig;
        try {
          const response = await requestText(`${c.baseUrl}/browser/status`, { method: 'GET' }, c.timeoutMs, c.maxResponseBytes);
          return JSON.stringify({ ok: response.ok, status: response.status });
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const boundedReadFailure = /^response exceeds \d+ bytes$/.test(message) ? message : 'Cortex browser status request failed';
          return JSON.stringify({ ok: false, error: boundedReadFailure });
        }
      },
    }), { names: ['cortex_browser_status'] });
  },
};

export default plugin;
