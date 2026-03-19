type BridgeConfig = { baseUrl?: string; timeoutMs?: number };

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
  };
}

async function requestJson(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
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
        const payload = {
          query: String(params?.query ?? ''),
          url: params?.url ? String(params.url) : undefined,
          max_results: Number(params?.maxResults ?? 5),
          include_content: Boolean(params?.includeContent ?? true),
        };
        try {
          const data = await requestJson(`${c.baseUrl}/browser/browse`, { method: 'POST', body: JSON.stringify(payload) }, c.timeoutMs);
          return JSON.stringify({ ok: true, provider: 'cortex-browser', data });
        } catch (error) {
          return JSON.stringify({ ok: false, provider: 'cortex-browser', error: error instanceof Error ? error.message : String(error) });
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
          const res = await fetch(`${c.baseUrl}/browser/status`);
          const text = await res.text();
          return JSON.stringify({ ok: res.ok, status: res.status, body: text.slice(0, 1000) });
        } catch (error) {
          return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), { names: ['cortex_browser_status'] });
  },
};

export default plugin;
