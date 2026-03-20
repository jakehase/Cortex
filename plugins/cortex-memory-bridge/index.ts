import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/memory-core';

type BridgeConfig = {
  baseUrl?: string;
  searchPath?: string;
  storePath?: string;
  timeoutMs?: number;
  retryCount?: number;
  retryBackoffMs?: number;
  enabledWriteThrough?: boolean;
  curatedBoost?: number;
  projectFactBoost?: number;
  durableCandidatePenalty?: number;
  noisyWhatsappPenalty?: number;
  noisyPatternPenalty?: number;
  minDurabilityScore?: number;
  writeTags?: string[];
};

const SearchSchema = {
  type: 'object', additionalProperties: false, required: ['query'],
  properties: { query: { type: 'string', minLength: 1 }, maxResults: { type: 'number', minimum: 1, maximum: 50 }, minScore: { type: 'number', minimum: 0, maximum: 1 } },
} as const;
const GetSchema = {
  type: 'object', additionalProperties: false, required: ['path'],
  properties: { path: { type: 'string' }, from: { type: 'number' }, lines: { type: 'number' } },
} as const;

function resolveConfig(pluginConfig?: Record<string, unknown>): Required<Pick<BridgeConfig, 'baseUrl' | 'searchPath' | 'storePath' | 'timeoutMs' | 'retryCount' | 'retryBackoffMs' | 'curatedBoost' | 'noisyWhatsappPenalty' | 'noisyPatternPenalty' | 'minDurabilityScore' | 'writeTags'>> & BridgeConfig {
  const cfg = (pluginConfig ?? {}) as BridgeConfig;
  return {
    baseUrl: (cfg.baseUrl ?? 'http://127.0.0.1:18888').replace(/\/$/, ''),
    searchPath: cfg.searchPath ?? '/knowledge/search',
    storePath: cfg.storePath ?? '/l22/store',
    timeoutMs: cfg.timeoutMs ?? 12000,
    retryCount: cfg.retryCount ?? 2,
    retryBackoffMs: cfg.retryBackoffMs ?? 350,
    enabledWriteThrough: cfg.enabledWriteThrough ?? false,
    curatedBoost: cfg.curatedBoost ?? 0.24,
    projectFactBoost: cfg.projectFactBoost ?? 0.12,
    durableCandidatePenalty: cfg.durableCandidatePenalty ?? 0.14,
    noisyWhatsappPenalty: cfg.noisyWhatsappPenalty ?? 0.26,
    noisyPatternPenalty: cfg.noisyPatternPenalty ?? 0.2,
    minDurabilityScore: cfg.minDurabilityScore ?? 0.72,
    writeTags: Array.isArray(cfg.writeTags) ? cfg.writeTags.map((x) => String(x)) : ['durable-memory', 'auto-curated'],
  };
}

function normalizeQuery(text: string): string { return text.trim().toLowerCase(); }
function looksHistoricalQuery(query: string): boolean { return /\b(history|historical|when|timeline|previous|earlier|used to|what happened|completion events|finished|completed)\b/i.test(query); }
function isShortVagueQuery(query: string): boolean { const q = normalizeQuery(query); const words = q.split(/\s+/).filter(Boolean); return words.length <= 3 || q.length <= 24; }
function isCurated(metadata: any): boolean { const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x)) : []; return metadata?.quality === 'curated' || tags.includes('curated'); }
function isWhatsappHighSignal(metadata: any): boolean { return metadata?.source === 'whatsapp-high-signal'; }
function isProjectStateMemory(metadata: any): boolean { return ['curated-project-facts', 'curated-preferences-priorities', 'curated-anti-drift', 'curated-noise-suppression'].includes(String(metadata?.source ?? '')); }
function isDurableCandidate(metadata: any): boolean { return metadata?.source === 'durable-candidates'; }
function textMatchesNoise(text: string): boolean {
  const t = text.trim();
  return [
    /^\[.*\]\sJake:\s\*\*.*(COMPLETE|Finished|LIVE|OPERATIONAL).*$/i,
    /^\[.*\]\sJake:\s✅\s?.*$/i,
    /^\[.*\]\sJake:\s\*?Source:\*?\s*https?:\/\//i,
    /^\[.*\]\sJake:\shttps?:\/\/\S+$/i,
    /^\[.*\]\sJake:\sINFO\b/i,
    /^\[.*\]\sJake:\s[0-9a-f]{32,}$/i,
    /^\[.*\]\sJake:\s(Absolutely|Perfect|Okay|Yep|Yes)\b/i,
  ].some((re) => re.test(t));
}
function explicitNoiseSeekingQuery(query: string): boolean { return /\b(link|source|url|hash|log|info|status line|status update|historical completion|completion event)\b/i.test(query); }

function rerankResults(query: string, items: any[], cfg: ReturnType<typeof resolveConfig>) {
  const historical = looksHistoricalQuery(query);
  const vague = isShortVagueQuery(query);
  const noiseSeeking = explicitNoiseSeekingQuery(query);
  return items.map((item: any) => {
    const metadata = item?.metadata ?? {};
    const text = String(item?.text ?? '');
    const rawScore = typeof item?.distance === 'number' ? 1 / (1 + item.distance) : 0.5;
    let score = rawScore;
    const reasons: string[] = [];
    if (isCurated(metadata)) { score += cfg.curatedBoost; reasons.push('curated_boost'); }
    if (isProjectStateMemory(metadata) && !historical) { score += cfg.projectFactBoost ?? 0.12; reasons.push('project_fact_boost'); }
    if (isDurableCandidate(metadata) && vague && !historical) { score -= cfg.durableCandidatePenalty ?? 0.14; reasons.push('vague_candidate_penalty'); }
    if (isWhatsappHighSignal(metadata) && vague && !historical) { score -= cfg.noisyWhatsappPenalty; reasons.push('vague_whatsapp_penalty'); }
    if (textMatchesNoise(text) && !noiseSeeking && !historical) { score -= cfg.noisyPatternPenalty; reasons.push('noise_pattern_penalty'); }
    return {
      path: `cortex:${item.id ?? 'unknown'}`,
      startLine: 1,
      endLine: 1,
      score: Math.max(0, Math.min(1, score)),
      snippet: text,
      source: 'memory',
      citation: item?.id ? `cortex:${item.id}` : undefined,
      metadata: { ...metadata, rerank: reasons, rawScore },
    };
  }).sort((a: any, b: any) => (b.score - a.score) || String(a.path).localeCompare(String(b.path)));
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function retryableError(error: unknown): boolean {
  const msg = String((error as any)?.message || error || '');
  return /aborted|AbortError|timeout|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|HTTP 408|HTTP 429|HTTP 500|HTTP 502|HTTP 503|HTTP 504/i.test(msg);
}
async function postJson(baseUrl: string, route: string, body: unknown, timeoutMs: number, retryCount = 0, retryBackoffMs = 250) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount || !retryableError(error)) throw error;
      await sleep(retryBackoffMs * (attempt + 1));
    } finally { clearTimeout(timer); }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'unknown memory bridge error'));
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const obj = value as Record<string, unknown>;
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.content === 'string') return obj.content;
  if (Array.isArray(obj.content)) {
    const contentText = obj.content.map((p) => extractText(p)).filter(Boolean).join('\n');
    if (contentText) return contentText;
  }
  if (typeof obj.role === 'string' && Array.isArray(obj.content)) {
    const roleContent = obj.content.map((p) => extractText(p)).filter(Boolean).join('\n');
    if (roleContent) return roleContent;
  }
  if (Array.isArray(obj.messages)) {
    const msgText = obj.messages.map((m) => extractText(m)).filter(Boolean).join('\n');
    if (msgText) return msgText;
  }
  if (Array.isArray(obj.payloads)) {
    const payloadText = obj.payloads.map((p) => extractText(p)).filter(Boolean).join('\n');
    if (payloadText) return payloadText;
  }
  if (typeof obj.type === 'string' && obj.type === 'text' && typeof obj.text === 'string') return obj.text;
  return Object.values(obj).map(extractText).filter(Boolean).join('\n');
}
function containsSecretLike(text: string): boolean {
  return /\b(api[_-]?key|token|password|secret|bearer|ssh-rsa|BEGIN [A-Z ]+ PRIVATE KEY)\b/i.test(text);
}
function summarizeShape(value: unknown, depth = 0): unknown {
  if (depth > 2) return typeof value;
  if (value == null) return value;
  if (typeof value === 'string') return { type: 'string', len: value.length, preview: value.slice(0, 120) };
  if (typeof value !== 'object') return { type: typeof value, value };
  if (Array.isArray(value)) return { type: 'array', len: value.length, sample: value.slice(0, 2).map((v) => summarizeShape(v, depth + 1)) };
  const obj = value as Record<string, unknown>;
  const entries = Object.entries(obj).slice(0, 12);
  const shape: Record<string, unknown> = {};
  for (const [k, v] of entries) shape[k] = summarizeShape(v, depth + 1);
  return { type: 'object', keys: Object.keys(obj).slice(0, 20), shape };
}
function durabilityScore(text: string): { score: number; reasons: string[]; kind: string } {
  const t = text.trim();
  const reasons: string[] = [];
  let score = 0;
  let kind = 'transient';
  if (!t || t.length < 20) return { score: 0, reasons: ['too_short'], kind };
  if (/\bremember this\b|\bplease remember\b|\bmy preference\b|\bi prefer\b|\bcall me\b|\btimezone\b|\bpronouns\b/i.test(t)) { score += 0.45; reasons.push('explicit_preference'); kind = 'preference'; }
  if (/\bdecision\b|\bwe decided\b|\bthe plan is\b|\bfrom now on\b|\bdefault to\b|\balways use\b/i.test(t)) { score += 0.35; reasons.push('decision'); kind = 'decision'; }
  if (/\bproject\b|\barchitecture\b|\bsetup\b|\bconnection details\b|\bssh\b|\bendpoint\b/i.test(t)) { score += 0.22; reasons.push('project_fact'); if (kind === 'transient') kind = 'fact'; }
  if (/\b(today|right now|currently|just now|this morning|tonight|lol|haha|thanks|ok|okay|sure)\b/i.test(t)) { score -= 0.18; reasons.push('transient_chat'); }
  if (/https?:\/\/\S+/.test(t) && t.length < 140) { score -= 0.18; reasons.push('bare_link'); }
  if (containsSecretLike(t)) { score = 0; reasons.push('secret_like'); kind = 'blocked'; }
  return { score: Math.max(0, Math.min(1, score)), reasons, kind };
}
async function maybeWriteThrough(api: OpenClawPluginApi, cfg: ReturnType<typeof resolveConfig>, event: any, ctx: any, fallbackText?: string) {
  if (!cfg.enabledWriteThrough) return;
  const text = [
    extractText(event?.messages ?? []),
    extractText(event?.result),
    extractText(event),
    String(fallbackText || ''),
  ].filter(Boolean).join('\n').replace(/\s+/g, ' ').trim();
  if (!text) {
    api.logger.info?.('cortex-memory-bridge: write-through skipped (no extractable text)');
    return;
  }
  const recent = text.slice(-2000);
  const dur = durabilityScore(recent);
  if (dur.score < cfg.minDurabilityScore) return;
  const senderScoped = { channel: ctx?.channelId ?? 'unknown', sessionKey: ctx?.sessionKey ?? undefined, source: 'openclaw-agent-end', quality: 'curated', memory_kind: dur.kind, tags: [...cfg.writeTags, ...dur.reasons] };
  try {
    await postJson(cfg.baseUrl, cfg.storePath, { type: 'memory', content: recent, tags: senderScoped.tags, metadata: senderScoped }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs);
    api.logger.info?.(`cortex-memory-bridge: stored durable memory candidate (${dur.kind}, score=${dur.score.toFixed(2)})`);
  } catch (error) {
    api.logger.warn?.(`cortex-memory-bridge: write-through failed: ${String(error)}`);
  }
}

const plugin = {
  id: 'cortex-memory-bridge',
  name: 'Cortex Memory Bridge',
  description: 'Bridge from OpenClaw memory_search into Cortex /knowledge/search with optional durable-memory write-through.',
  kind: 'memory',
  register(api: OpenClawPluginApi) {
    const recentOutputBySession = new Map<string, string>();
    api.registerTool(() => ({
      label: 'Memory Search', name: 'memory_search', description: 'Search Cortex-backed memory over HTTP.', parameters: SearchSchema,
      execute: async (_toolCallId, params) => {
        const cfg = resolveConfig(api.pluginConfig);
        try {
          const response = await postJson(cfg.baseUrl, cfg.searchPath, { query: String((params as { query: string }).query ?? ''), n_results: Number((params as { maxResults?: number }).maxResults ?? 5) }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs);
          const results = Array.isArray(response?.results) ? rerankResults(String((params as { query: string }).query ?? ''), response.results, cfg) : [];
          return JSON.stringify({ results, provider: 'cortex-http', mode: response?.mode ?? response?.search_mode ?? 'semantic', fallback: response?.degraded ? { from: 'cortex', reason: response?.warning ?? 'degraded' } : undefined });
        } catch (error) {
          return JSON.stringify({ results: [], disabled: true, error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), { names: ['memory_search'] });

    api.registerTool(() => ({
      label: 'Memory Get', name: 'memory_get', description: 'Stub: Cortex does not currently expose OpenClaw-compatible file snippet reads.', parameters: GetSchema,
      execute: async (_toolCallId, params) => {
        const path = String((params as { path?: string }).path ?? '');
        return JSON.stringify({ path, text: '', disabled: true, error: 'cortex-memory-bridge does not implement memory_get yet; Cortex search endpoints return records, not workspace file snippets.' });
      },
    }), { names: ['memory_get'] });

    api.on('llm_output', (event: any, ctx: any) => {
      const key = String(ctx?.sessionKey || ctx?.sessionId || '');
      const text = extractText(event).replace(/\s+/g, ' ').trim();
      if (key && text) recentOutputBySession.set(key, text.slice(-4000));
    });

    api.on('agent_end', async (event: any, ctx: any) => {
      const cfg = resolveConfig(api.pluginConfig);
      const key = String(ctx?.sessionKey || ctx?.sessionId || '');
      const fallbackText = key ? recentOutputBySession.get(key) : undefined;
      if (String(api.pluginConfig?.debugShapes || '') === 'true') {
        api.logger.info?.(`cortex-memory-bridge: agent_end shape ${JSON.stringify({ key, fallbackLen: fallbackText?.length || 0, summary: summarizeShape(event) })}`);
      }
      await maybeWriteThrough(api, cfg, event, ctx, fallbackText);
      if (key) recentOutputBySession.delete(key);
    });
  },
};

export default plugin;
