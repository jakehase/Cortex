const SearchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    maxResults: { type: 'number', minimum: 1, maximum: 50 },
    minScore: { type: 'number', minimum: 0, maximum: 1 }
  }
};

const GetSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string' },
    from: { type: 'number' },
    lines: { type: 'number' }
  }
};

function resolveConfig(pluginConfig) {
  const cfg = pluginConfig || {};
  return {
    baseUrl: String(cfg.baseUrl || 'http://127.0.0.1:18888').replace(/\/$/, ''),
    searchPath: String(cfg.searchPath || '/knowledge/search'),
    timeoutMs: Number(cfg.timeoutMs || 12000),
    retryCount: Number(cfg.retryCount ?? 2),
    retryBackoffMs: Number(cfg.retryBackoffMs ?? 350),
    curatedBoost: Number(cfg.curatedBoost ?? 0.24),
    projectFactBoost: Number(cfg.projectFactBoost ?? 0.12),
    durableCandidatePenalty: Number(cfg.durableCandidatePenalty ?? 0.14),
    noisyWhatsappPenalty: Number(cfg.noisyWhatsappPenalty ?? 0.26),
    noisyPatternPenalty: Number(cfg.noisyPatternPenalty ?? 0.2),
    conflictPenalty: Number(cfg.conflictPenalty ?? 0.18),
    recencyBoost: Number(cfg.recencyBoost ?? 0.12),
    explicitBoost: Number(cfg.explicitBoost ?? 0.14),
    corroborationBoost: Number(cfg.corroborationBoost ?? 0.08),
    hardQueryCandidateCount: Number(cfg.hardQueryCandidateCount ?? 12)
  };
}

function normalizeQuery(text) { return String(text || '').trim().toLowerCase(); }
function looksHistoricalQuery(query) { return /\b(history|historical|when|timeline|previous|earlier|used to|what happened|completion events|finished|completed)\b/i.test(query); }
function isShortVagueQuery(query) { const q = normalizeQuery(query); const words = q.split(/\s+/).filter(Boolean); return words.length <= 3 || q.length <= 24; }
function explicitNoiseSeekingQuery(query) { return /\b(link|source|url|hash|log|info|status line|status update|historical completion|completion event)\b/i.test(query); }
function isCurated(metadata) { const tags = Array.isArray(metadata?.tags) ? metadata.tags.map(String) : []; return metadata?.quality === 'curated' || tags.includes('curated'); }
function isWhatsappHighSignal(metadata) { return metadata?.source === 'whatsapp-high-signal'; }
function isProjectStateMemory(metadata) { return ['curated-project-facts', 'curated-preferences-priorities', 'curated-anti-drift', 'curated-noise-suppression'].includes(String(metadata?.source ?? '')); }
function isDurableCandidate(metadata) { return metadata?.source === 'durable-candidates'; }
function isGhostCache(metadata) { return String(metadata?.type ?? '').toLowerCase() === 'ghost_cache' || String(metadata?.source ?? '').toLowerCase() === 'ghost_cache'; }
function queryIsAboutGhostCache(query) { return /\bghost cache\b|\bghost\b.*\bcache\b|\bcache key\b|\bcached browse\b/.test(normalizeQuery(query)); }
function isProbeNoise(metadata, text) {
  const source = String(metadata?.source ?? '').toLowerCase();
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x) => String(x).toLowerCase()) : [];
  const t = String(text || '').trim().toLowerCase();
  return source.includes('probe') || tags.includes('probe') || t === 'probe' || /^probe[:\s-]?/.test(t);
}
function queryIsAboutProbe(query) { return /\bprobe\b|self-model|telemetry|diagnostic/.test(normalizeQuery(query)); }
function isInternalOracleMemory(metadata, text) {
  const source = String(metadata?.source ?? '').toLowerCase();
  const sessionKey = String(metadata?.sessionKey ?? '').toLowerCase();
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x) => String(x).toLowerCase()) : [];
  const t = String(text || '').toLowerCase();
  return source.includes('oracle')
    || sessionKey.includes('oracle')
    || tags.includes('semantic_prediction')
    || tags.includes('awareness')
    || /oracle predicts|durable verification marker|durable smoke marker|memory bridge probe|anti recursion|terminal synthesis|repeat safeguard|convergence guard|loop guard|recursion barrier/.test(t);
}
function queryIsAboutInternalOracle(query) { return /\boracle\b|semantic prediction|memory bridge probe|durable (verification|smoke) marker|anti recursion|recursion barrier|loop guard/.test(normalizeQuery(query)); }
function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && value.trim() !== '') return n > 1e12 ? n : n * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function extractTimestamp(metadata) {
  return toTimestamp(metadata?.timestamp) ?? toTimestamp(metadata?.createdAt) ?? toTimestamp(metadata?.updatedAt) ?? toTimestamp(metadata?.occurredAt) ?? null;
}
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
function recencyScore(timestampMs) {
  if (!timestampMs) return 0.25;
  const ageDays = Math.max(0, (Date.now() - timestampMs) / 86400000);
  if (ageDays <= 2) return 1;
  if (ageDays <= 7) return 0.85;
  if (ageDays <= 30) return 0.65;
  if (ageDays <= 180) return 0.45;
  return 0.25;
}
function explicitnessScore(text) {
  let score = 0.2;
  if (/\b(i prefer|prefer|remember this|please remember|call me|my timezone|we decided|the plan is|always use|default to|never use|use this|current|latest|final)\b/i.test(String(text || ''))) score += 0.55;
  if (/\b(maybe|probably|might|i think|seems|guess|not sure)\b/i.test(String(text || ''))) score -= 0.18;
  return Math.max(0, Math.min(1, score));
}
function sourceQualityScore(metadata) {
  if (isCurated(metadata)) return 1;
  if (isProjectStateMemory(metadata)) return 0.92;
  if (isDurableCandidate(metadata)) return 0.66;
  if (isWhatsappHighSignal(metadata)) return 0.54;
  return 0.45;
}
function extractEntity(query, text, metadata) {
  if (isInternalOracleMemory(metadata, text) && !queryIsAboutInternalOracle(query)) return undefined;
  const explicit = String(text || '').match(/\b(?:Jake|HeroUI|OpenClaw|Cortex|WhatsApp|Home Assistant|Oracle)\b/i)?.[0];
  if (explicit) return explicit;
  return String(query || '').match(/\b(?:Jake|HeroUI|OpenClaw|Cortex|WhatsApp|Home Assistant|Oracle)\b/i)?.[0];
}
function extractAttribute(query, text, metadata) {
  if (isInternalOracleMemory(metadata, text) && !queryIsAboutInternalOracle(query)) return 'internal_noise';
  const hay = `${query} ${text}`.toLowerCase();
  if (/latest|current|changed|used to|timeline|when|before|after/.test(hay)) return 'temporal_state';
  if (/prefer|preference|like|want|call me|timezone|pronouns/.test(hay)) return 'preference';
  if (/decid|plan|architecture|setup|config|memory/.test(hay)) return 'decision';
  if (/status|working|l2|browser bridge|tool/.test(hay)) return 'runtime_state';
  return undefined;
}
function normalizeValueSignature(text) { return String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }
function detectConflict(a, b) {
  if (!a.attribute || !b.attribute || a.attribute !== b.attribute) return false;
  if (a.entity && b.entity && a.entity.toLowerCase() !== b.entity.toLowerCase()) return false;
  if (!a.valueSignature || !b.valueSignature || a.valueSignature === b.valueSignature) return false;
  return true;
}
function queryNeedsReconcile(query) { return /\b(latest|current|end up|decide|decided|change|changed|still|final|actually|correct|updated|now|working)\b/i.test(query); }
function queryNeedsInvestigate(query) { return /\b(timeline|before|after|used to|across sessions|over time|reconstruct|walk me through|evolved|history|what happened)\b/i.test(query); }
function classifyQuery(query) {
  const tags = [];
  if (queryNeedsInvestigate(query)) tags.push('timeline');
  if (queryNeedsReconcile(query)) tags.push('conflict-prone');
  if (/\bprefer|preference|relationship|context|social cue\b/i.test(query)) tags.push('preference');
  if (tags.includes('timeline')) return { mode: 'investigate', tags };
  if (tags.length > 0) return { mode: 'reconcile', tags };
  return { mode: 'fast', tags: ['simple-recall'] };
}

function mapCandidate(query, item, cfg, corroborationCount) {
  const metadata = item?.metadata ?? {};
  const text = String(item?.text ?? '');
  const rawScore = typeof item?.distance === 'number' ? 1 / (1 + item.distance) : (typeof item?.score === 'number' ? item.score : 0.5);
  const timestampMs = extractTimestamp(metadata);
  const signals = {
    rawScore,
    recencyScore: recencyScore(timestampMs),
    explicitnessScore: explicitnessScore(text),
    sourceQualityScore: sourceQualityScore(metadata),
    corroborationScore: Math.min(1, corroborationCount / 3),
    contradictionPenalty: 0,
    supersededPenalty: 0,
    reasons: [],
    entity: extractEntity(query, text, metadata),
    attribute: extractAttribute(query, text, metadata),
    valueSignature: normalizeValueSignature(text),
  };
  let score = rawScore * 0.3 + signals.recencyScore * cfg.recencyBoost + signals.explicitnessScore * cfg.explicitBoost + signals.sourceQualityScore * 0.1 + signals.corroborationScore * cfg.corroborationBoost;
  const historical = looksHistoricalQuery(query);
  const vague = isShortVagueQuery(query);
  const noiseSeeking = explicitNoiseSeekingQuery(query);
  if (isCurated(metadata)) { score += cfg.curatedBoost; signals.reasons.push('curated_boost'); }
  if (isProjectStateMemory(metadata) && !historical) { score += cfg.projectFactBoost; signals.reasons.push('project_fact_boost'); }
  if (isDurableCandidate(metadata) && vague && !historical) { score -= cfg.durableCandidatePenalty; signals.reasons.push('vague_candidate_penalty'); }
  if (isWhatsappHighSignal(metadata) && vague && !historical) { score -= cfg.noisyWhatsappPenalty; signals.reasons.push('vague_whatsapp_penalty'); }
  if (textMatchesNoise(text) && !noiseSeeking && !historical) { score -= cfg.noisyPatternPenalty; signals.reasons.push('noise_pattern_penalty'); }
  if (isGhostCache(metadata) && !queryIsAboutGhostCache(query)) { score -= 0.65; signals.reasons.push('ghost_cache_penalty'); }
  if (isProbeNoise(metadata, text) && !queryIsAboutProbe(query)) { score -= 0.7; signals.reasons.push('probe_noise_penalty'); }
  if (isInternalOracleMemory(metadata, text) && !queryIsAboutInternalOracle(query)) { score -= 0.55; signals.reasons.push('internal_oracle_penalty'); }
  if (signals.attribute === 'internal_noise' && !queryIsAboutInternalOracle(query)) { score -= 0.35; signals.reasons.push('internal_noise_attribute_penalty'); }
  if (signals.recencyScore >= 0.85) signals.reasons.push('recent');
  if (signals.explicitnessScore >= 0.7) signals.reasons.push('explicit');
  return {
    path: `cortex:${item.id ?? 'unknown'}`,
    startLine: 1,
    endLine: 1,
    score: Math.max(0, Math.min(1, score)),
    snippet: text,
    source: 'memory',
    citation: item?.id ? `cortex:${item.id}` : undefined,
    metadata: { ...metadata, rerank: signals.reasons, rawScore, timestampMs, candidateSignals: signals },
  };
}

function reconcileResults(query, items, cfg) {
  const classification = classifyQuery(query);
  const groupedBySignature = new Map();
  for (const item of items) {
    const signature = normalizeValueSignature(String(item?.text ?? ''));
    if (!signature) continue;
    groupedBySignature.set(signature, (groupedBySignature.get(signature) ?? 0) + 1);
  }
  const mapped = items.map((item) => mapCandidate(query, item, cfg, groupedBySignature.get(normalizeValueSignature(String(item?.text ?? ''))) ?? 1));
  const visible = mapped.filter((item) => {
    const signals = item.metadata.candidateSignals;
    if (signals.attribute === 'internal_noise' && !queryIsAboutInternalOracle(query)) return false;
    if (isGhostCache(item.metadata) && !queryIsAboutGhostCache(query)) return false;
    if (isProbeNoise(item.metadata, item.snippet) && !queryIsAboutProbe(query)) return false;
    return true;
  });

  const conflicts = [];
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const aSignals = visible[i].metadata.candidateSignals;
      const bSignals = visible[j].metadata.candidateSignals;
      if (!queryIsAboutInternalOracle(query) && aSignals.attribute === 'internal_noise' && bSignals.attribute === 'internal_noise') continue;
      if (!detectConflict(aSignals, bSignals)) continue;
      aSignals.contradictionPenalty += cfg.conflictPenalty;
      bSignals.contradictionPenalty += cfg.conflictPenalty;
      visible[i].score = Math.max(0, visible[i].score - cfg.conflictPenalty);
      visible[j].score = Math.max(0, visible[j].score - cfg.conflictPenalty);
      const aTs = Number(visible[i].metadata.timestampMs ?? 0);
      const bTs = Number(visible[j].metadata.timestampMs ?? 0);
      if (aTs && bTs && aTs !== bTs) {
        const older = aTs < bTs ? visible[i] : visible[j];
        older.score = Math.max(0, older.score - cfg.conflictPenalty / 2);
        older.metadata.candidateSignals.supersededPenalty += cfg.conflictPenalty / 2;
        older.metadata.candidateSignals.reasons.push('likely_superseded');
      }
      conflicts.push({ entity: aSignals.entity ?? bSignals.entity, attribute: aSignals.attribute, paths: [visible[i].path, visible[j].path], values: [aSignals.valueSignature ?? '', bSignals.valueSignature ?? ''] });
    }
  }

  visible.sort((a, b) => (b.score - a.score) || String(a.path).localeCompare(String(b.path)));
  const resolvedFactsMap = new Map();
  for (const item of visible) {
    const signals = item.metadata.candidateSignals;
    const key = `${signals.entity ?? 'unknown'}::${signals.attribute ?? 'unknown'}`;
    const existing = resolvedFactsMap.get(key);
    if (!existing || item.score > existing.bestScore) {
      resolvedFactsMap.set(key, { entity: signals.entity, attribute: signals.attribute, bestPath: item.path, supportingPaths: [item.path], bestScore: item.score });
    } else if (!existing.supportingPaths.includes(item.path)) {
      existing.supportingPaths.push(item.path);
    }
  }

  return {
    mode: classification.mode,
    queryType: classification.tags,
    results: visible.slice(0, classification.mode === 'investigate' ? cfg.hardQueryCandidateCount : items.length),
    resolvedFacts: Array.from(resolvedFactsMap.values()).map(({ bestScore, ...rest }) => rest),
    conflicts,
  };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function retryableError(error) {
  const msg = String(error?.message || error || '');
  return /aborted|AbortError|timeout|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|HTTP 408|HTTP 429|HTTP 500|HTTP 502|HTTP 503|HTTP 504/i.test(msg);
}
async function postJson(url, body, timeoutMs, retryCount = 0, retryBackoffMs = 250) {
  let lastError;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount || !retryableError(error)) throw error;
      await sleep(retryBackoffMs * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('unknown memory bridge error');
}

const plugin = {
  id: 'cortex-memory-bridge',
  name: 'Cortex Memory Bridge',
  description: 'Bridge from OpenClaw memory_search into Cortex /knowledge/search.',
  kind: 'memory',
  register(api) {
    api.registerTool(() => ({
      label: 'Memory Search',
      name: 'memory_search',
      description: 'Search Cortex-backed memory over HTTP.',
      parameters: SearchSchema,
      execute: async (_toolCallId, params) => {
        const cfg = resolveConfig(api.pluginConfig);
        const query = String(params?.query ?? '');
        const requestedMax = Number(params?.maxResults ?? 5);
        const classification = classifyQuery(query);
        const fetchCount = classification.mode === 'investigate' ? Math.max(requestedMax, cfg.hardQueryCandidateCount) : Math.max(requestedMax, 8);
        try {
          const response = await postJson(`${cfg.baseUrl}${cfg.searchPath}`, { query, n_results: fetchCount }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs);
          const rawItems = Array.isArray(response?.results) ? response.results : [];
          const reconciled = reconcileResults(query, rawItems, cfg);
          let results = reconciled.results.slice(0, requestedMax);
          const minScore = typeof params?.minScore === 'number' ? Number(params.minScore) : null;
          if (minScore !== null) results = results.filter((x) => x.score >= minScore);
          const cleanButEmpty = results.length === 0 && reconciled.resolvedFacts.length === 0 && reconciled.conflicts.length === 0;
          return JSON.stringify({
            results,
            provider: 'cortex-http',
            mode: response?.mode ?? response?.search_mode ?? 'semantic',
            memoryMode: reconciled.mode,
            queryType: reconciled.queryType,
            resolvedFacts: reconciled.resolvedFacts,
            conflicts: reconciled.conflicts,
            fallback: cleanButEmpty
              ? { from: 'memory', reason: 'clean_but_empty', suggestion: 'No relevant durable memory was found after noise suppression; fall back to workspace/filesystem or live tools.' }
              : (response?.degraded ? { from: 'cortex', reason: response?.warning ?? 'degraded' } : undefined),
          });
        } catch (error) {
          return JSON.stringify({ results: [], disabled: true, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }), { names: ['memory_search'] });

    api.registerTool(() => ({
      label: 'Memory Get',
      name: 'memory_get',
      description: 'Stub: Cortex does not currently expose OpenClaw-compatible file snippet reads.',
      parameters: GetSchema,
      execute: async (_toolCallId, params) => {
        const path = String(params?.path ?? '');
        return JSON.stringify({ path, text: '', disabled: true, error: 'cortex-memory-bridge does not implement memory_get yet; Cortex search endpoints return records, not workspace file snippets.' });
      }
    }), { names: ['memory_get'] });
  }
};

export default plugin;
