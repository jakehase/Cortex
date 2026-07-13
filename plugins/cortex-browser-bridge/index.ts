type BridgeConfig = { baseUrl?: string; timeoutMs?: number; maxResponseBytes?: number };

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
  return {
    baseUrl: (c.baseUrl ?? 'http://127.0.0.1:18888').replace(/\/$/, ''),
    timeoutMs: typeof c.timeoutMs === 'number' ? c.timeoutMs : 15000,
    maxResponseBytes: typeof c.maxResponseBytes === 'number' ? c.maxResponseBytes : 1_048_576,
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
    api.registerTool(() => ({
      label: 'Cortex Browse',
      name: 'cortex_browse',
      description: 'Use Cortex L2 Ghost browser/search endpoint before generic web tools.',
      parameters: BrowseSchema,
      execute: async (_toolCallId: string, params: any) => {
        const c = cfg(api.pluginConfig);
        const query = String(params?.query ?? '');
        const hasUrl = typeof params?.url === 'string' && String(params.url).trim().length > 0;
        const payload = {
          query,
          ...(hasUrl ? { url: String(params.url) } : {}),
          max_results: Number(params?.maxResults ?? 5),
          include_content: Boolean(params?.includeContent ?? true),
        };
        const endpoint = hasUrl ? '/browser/browse' : '/browser/search';
        try {
          const response = await requestText(`${c.baseUrl}${endpoint}`, { method: 'POST', body: JSON.stringify(payload) }, c.timeoutMs, c.maxResponseBytes);
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.text.slice(0, 300)}`);
          return JSON.stringify({ ok: true, provider: 'cortex-browser', endpoint, data: maybeJson(response.text) });
        } catch (error) {
          return JSON.stringify({ ok: false, provider: 'cortex-browser', endpoint, error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), { names: ['cortex_browse'] });

    api.registerTool(() => ({
      label: 'Cortex Browser Status',
      name: 'cortex_browser_status',
      description: 'Check whether Cortex L2 Ghost browser endpoint is available.',
      parameters: StatusSchema,
      execute: async () => {
        const c = cfg(api.pluginConfig);
        try {
          const response = await requestText(`${c.baseUrl}/browser/status`, { method: 'GET' }, c.timeoutMs, c.maxResponseBytes);
          return JSON.stringify({ ok: response.ok, status: response.status, body: maybeJson(response.text) });
        } catch (error) {
          return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), { names: ['cortex_browser_status'] });
  },
};

export default plugin;
