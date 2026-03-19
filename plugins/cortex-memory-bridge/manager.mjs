function resolveConfig(cfg) {
  const entry = cfg?.plugins?.entries?.['cortex-memory-bridge'] || {};
  const pluginCfg = entry.config || {};
  return {
    baseUrl: String(pluginCfg.baseUrl || 'http://127.0.0.1:18888').replace(/\/$/, ''),
    searchPath: String(pluginCfg.searchPath || '/knowledge/search'),
    timeoutMs: Number(pluginCfg.timeoutMs || 8000),
    curatedBoost: Number(pluginCfg.curatedBoost ?? 0.24),
    projectFactBoost: Number(pluginCfg.projectFactBoost ?? 0.12),
    durableCandidatePenalty: Number(pluginCfg.durableCandidatePenalty ?? 0.14),
    noisyWhatsappPenalty: Number(pluginCfg.noisyWhatsappPenalty ?? 0.26),
    noisyPatternPenalty: Number(pluginCfg.noisyPatternPenalty ?? 0.2),
  };
}

function normalizeQuery(text) { return String(text || '').trim().toLowerCase(); }
function looksHistoricalQuery(query) { return /\b(history|historical|when|timeline|previous|earlier|used to|what happened|completion events|finished|completed)\b/i.test(query); }
function isShortVagueQuery(query) { const q=normalizeQuery(query); const words=q.split(/\s+/).filter(Boolean); return words.length <= 3 || q.length <= 24; }
function isCurated(metadata) { const tags=Array.isArray(metadata?.tags)?metadata.tags.map(String):[]; return metadata?.quality==='curated' || tags.includes('curated'); }
function isWhatsappHighSignal(metadata) { return metadata?.source === 'whatsapp-high-signal'; }
function isProjectStateMemory(metadata) { return ['curated-project-facts','curated-preferences-priorities','curated-anti-drift','curated-noise-suppression'].includes(String(metadata?.source ?? '')); }
function isDurableCandidate(metadata) { return metadata?.source === 'durable-candidates'; }
function textMatchesNoise(text) {
  const t = String(text || '').trim();
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
function explicitNoiseSeekingQuery(query) { return /\b(link|source|url|hash|log|info|status line|status update|historical completion|completion event)\b/i.test(query); }
function rerankResults(query, items, cfg) {
  const historical = looksHistoricalQuery(query);
  const vague = isShortVagueQuery(query);
  const noiseSeeking = explicitNoiseSeekingQuery(query);
  return items.map((item) => {
    const metadata = item?.metadata ?? {};
    const text = String(item?.text ?? '');
    const rawScore = typeof item?.distance === 'number' ? 1 / (1 + item.distance) : 0.5;
    let score = rawScore;
    if (isCurated(metadata)) score += cfg.curatedBoost;
    if (isProjectStateMemory(metadata) && !historical) score += cfg.projectFactBoost;
    if (isDurableCandidate(metadata) && vague && !historical) score -= cfg.durableCandidatePenalty;
    if (isWhatsappHighSignal(metadata) && vague && !historical) score -= cfg.noisyWhatsappPenalty;
    if (textMatchesNoise(text) && !noiseSeeking && !historical) score -= cfg.noisyPatternPenalty;
    return {
      path: `cortex:${item.id ?? 'unknown'}`,
      startLine: 1,
      endLine: 1,
      score: Math.max(0, Math.min(1, score)),
      snippet: text,
      source: 'memory',
      citation: item?.id ? `cortex:${item.id}` : undefined,
    };
  }).sort((a,b) => (b.score-a.score) || String(a.path).localeCompare(String(b.path)));
}

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

export class CortexMemorySearchManager {
  constructor(params) {
    this.cfg = params.cfg;
    this.agentId = params.agentId;
    this.rcfg = resolveConfig(params.cfg);
  }
  static async create(params) { return new CortexMemorySearchManager(params); }
  async search(query, opts={}) {
    const response = await postJson(`${this.rcfg.baseUrl}${this.rcfg.searchPath}`, { query, n_results: Number(opts.maxResults || 6) }, this.rcfg.timeoutMs);
    const items = Array.isArray(response?.results) ? response.results : [];
    let results = rerankResults(query, items, this.rcfg);
    const minScore = typeof opts.minScore === 'number' ? opts.minScore : null;
    if (minScore !== null) results = results.filter((x) => x.score >= minScore);
    return results;
  }
  async readFile(params) {
    return { path: String(params?.relPath || ''), text: '' };
  }
  status() {
    return {
      backend: 'builtin',
      provider: 'cortex-http',
      model: 'semantic-http',
      files: 0,
      chunks: 0,
      custom: { searchMode: 'semantic', bridge: 'cortex-memory-bridge', baseUrl: this.rcfg.baseUrl }
    };
  }
  async probeEmbeddingAvailability() { return { ok: true }; }
  async probeVectorAvailability() { return true; }
  async close() {}
}

export default { CortexMemorySearchManager };
