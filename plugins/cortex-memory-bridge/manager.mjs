import { createHmac } from 'node:crypto';

function resolveConfig(cfg) {
  const rootEntry = cfg?.plugins?.entries?.['cortex-memory-bridge'];
  const pluginCfg = rootEntry?.config || (cfg && typeof cfg === 'object' ? cfg : {}) || {};
  const writeTokenHeader = pluginCfg.writeTokenHeader ?? 'x-cortex-write-token';
  if (typeof writeTokenHeader !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(writeTokenHeader)) throw new Error('invalid Cortex write-token header name');
  return {
    baseUrl: String(pluginCfg.baseUrl || 'http://127.0.0.1:18888').replace(/\/$/, ''),
    searchPath: String(pluginCfg.searchPath || '/knowledge/search'),
    writeToken: typeof pluginCfg.writeToken === 'string' ? pluginCfg.writeToken : '',
    writeTokenHeader: writeTokenHeader.toLowerCase(),
    scopeHmacSecret: typeof pluginCfg.scopeHmacSecret === 'string' ? pluginCfg.scopeHmacSecret : '',
    scopeCredentialId: typeof pluginCfg.scopeCredentialId === 'string' ? pluginCfg.scopeCredentialId.trim() : '',
    sessionIdentityHmacSecret: typeof pluginCfg.sessionIdentityHmacSecret === 'string' ? pluginCfg.sessionIdentityHmacSecret : '',
    tenantId: typeof pluginCfg.tenantId === 'string' ? pluginCfg.tenantId.trim() : 'cortex-local',
    workspaceId: typeof pluginCfg.workspaceId === 'string' ? pluginCfg.workspaceId.trim() : 'default',
    userId: typeof pluginCfg.userId === 'string' && pluginCfg.userId.trim() ? pluginCfg.userId.trim() : 'local-user',
    channelId: typeof pluginCfg.channelId === 'string' && pluginCfg.channelId.trim() ? pluginCfg.channelId.trim() : 'local-channel',
    sessionId: typeof pluginCfg.sessionId === 'string' && pluginCfg.sessionId.trim() ? pluginCfg.sessionId.trim() : 'global-session',
    timeoutMs: Number(pluginCfg.timeoutMs || 12000),
    retryCount: Number(pluginCfg.retryCount ?? 2),
    retryBackoffMs: Number(pluginCfg.retryBackoffMs ?? 350),
    maxResponseBytes: Number(pluginCfg.maxResponseBytes ?? 1_048_576),
    curatedBoost: Number(pluginCfg.curatedBoost ?? 0.24),
    projectFactBoost: Number(pluginCfg.projectFactBoost ?? 0.12),
    durableCandidatePenalty: Number(pluginCfg.durableCandidatePenalty ?? 0.14),
    noisyWhatsappPenalty: Number(pluginCfg.noisyWhatsappPenalty ?? 0.26),
    noisyPatternPenalty: Number(pluginCfg.noisyPatternPenalty ?? 0.2),
    conflictPenalty: Number(pluginCfg.conflictPenalty ?? 0.18),
    recencyBoost: Number(pluginCfg.recencyBoost ?? 0.12),
    explicitBoost: Number(pluginCfg.explicitBoost ?? 0.14),
    corroborationBoost: Number(pluginCfg.corroborationBoost ?? 0.08),
    hardQueryCandidateCount: Number(pluginCfg.hardQueryCandidateCount ?? 12),
  };
}

function normalizeQuery(text) { return String(text || '').trim().toLowerCase(); }
function looksHistoricalQuery(query) { return /\b(history|historical|when|timeline|previous|earlier|used to|what happened|completion events|finished|completed)\b/i.test(query); }
function isShortVagueQuery(query) { const q = normalizeQuery(query); const words = q.split(/\s+/).filter(Boolean); return words.length <= 3 || q.length <= 24; }
function explicitNoiseSeekingQuery(query) { return /\b(link|source|url|hash|log|info|status line|status update|historical completion|completion event)\b/i.test(query); }
const STOPWORDS = new Set(['the','a','an','and','or','but','for','from','with','without','into','onto','about','what','where','when','which','who','whom','this','that','these','those','is','are','was','were','be','been','being','to','of','in','on','at','by','my','we','it','as','do','did','does','how','main','session']);
function semanticTerms(text) {
  return Array.from(new Set(normalizeQuery(text).split(/[^a-z0-9_.-]+/).filter((x) => x.length >= 3 && !STOPWORDS.has(x))));
}
function lexicalOverlapScore(query, text, metadata) {
  const qTerms = semanticTerms(query);
  if (!qTerms.length) return 0;
  const hay = `${text} ${String(metadata?.topic ?? '')} ${Array.isArray(metadata?.tags) ? metadata.tags.join(' ') : ''}`.toLowerCase();
  let hits = 0;
  for (const term of qTerms) {
    if (hay.includes(term)) hits += 1;
  }
  return Math.max(0, Math.min(1, hits / qTerms.length));
}
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
function isLeakyInternalTrace(text) {
  const t = String(text || '').toLowerCase();
  return /encrypted_content|thinkingsignature|cortex upstream routing applied:|\bthinking\s*\{|"type":"reasoning"|gaaaaaab/.test(t);
}
function queryIsAboutInternalTrace(query) { return /encrypted_content|thinking|routing applied|reasoning payload|internal trace/.test(normalizeQuery(query)); }
function isExecutionTraceNoise(text) {
  const t = String(text || '').toLowerCase();
  return /\btoolcall\b|\bsessions_yield\b|\bsessions_spawn\b|\bcall_[a-z0-9]+\b|"command":|"workdir":|"yieldms":|"timeoutseconds":|"runtime":"subagent"|openclaw gateway restart/.test(t);
}
function queryIsAboutExecutionTrace(query) { return /toolcall|sessions_yield|sessions_spawn|execution trace|tool trace|gateway restart/.test(normalizeQuery(query)); }
function isRecentSummaryQuery(query) {
  return /\bwhat changed recently\b|\brecent changes\b|\brecent update\b|\bstatus update\b|\bwhat'?s going on\b|\bhow'?s this going\b|\bwhat happened lately\b|\blately\b/.test(normalizeQuery(query));
}
function isRecentSummaryMemory(metadata, text) {
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x) => String(x).toLowerCase()) : [];
  const topic = String(metadata?.topic ?? '').toLowerCase();
  const t = String(text || '').toLowerCase();
  return tags.includes('recent-summary')
    || topic.includes('recent-status')
    || /recent status summary:|recent changes:|this session:|bridge repair completed|write-through proved|ranking improved|noise suppression improved/.test(t);
}
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
function isOracleBoilerplate(text, metadata) {
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x) => String(x).toLowerCase()) : [];
  const t = String(text || '').toLowerCase().trim();
  return tags.includes('semantic_prediction')
    || tags.includes('awareness')
    || /^asking oracle for a semantic prediction\.\.\.?$/.test(t)
    || /^oracle predicts:?$/i.test(String(text || '').trim());
}
function queryWantsOracleBoilerplate(query) { return /semantic prediction|raw oracle|oracle trace|oracle predicts|awareness/.test(normalizeQuery(query)); }
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
function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function finiteNumber(value) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  return Number.isFinite(n) ? n : null;
}
function candidateRawScore(item, metadata) {
  const direct = finiteNumber(item?.score);
  if (direct !== null) return clamp01(direct);
  const hybrid = finiteNumber(metadata?.hybrid_score);
  if (hybrid !== null) return clamp01(hybrid);
  const relevance = finiteNumber(metadata?.relevance_score);
  if (relevance !== null) return clamp01(relevance);
  const distance = finiteNumber(item?.distance);
  return distance !== null ? 1 / (1 + Math.max(0, distance)) : 0.5;
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
function queryWantsNegativeEvidence(query) {
  return /\b(not found|no evidence|no record|absence|missing|remaining|open gap|open gaps|gap inventory|gap list|blocker|what(?:'s| is| was)? still missing|what(?:'s| is| was)? left|what remains)\b/i.test(normalizeQuery(query));
}
function queryWantsMemorySystem(query) {
  return /\bmemory system|memory search|memory_search|recall|librarian|cortex memory|knowledge\/search|reranker|ranking|semantic search\b/i.test(normalizeQuery(query));
}
function isMemorySystemMetaRow(text, metadata) {
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.join(' ') : '';
  const hay = `${text} ${String(metadata?.source ?? '')} ${tags}`.toLowerCase();
  return /memory_search\(|memory search|local file-?memory lexical fallback|recall regression|recall route|librarian\.py|test_librarian_recall_fallback|stale-negative|correction\/conclusion rows|reranker|cortex memory bridge|cortex-memory-bridge|knowledge\/search/.test(hay);
}
function isFreshOrCorrectiveFact(text, metadata) {
  const t = String(text || '');
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x) => String(x).toLowerCase()) : [];
  if (metadata?.correction_memory === true || tags.includes('correction') || tags.includes('current_fact') || tags.includes('source_of_truth')) return true;
  if (/\bcorrection\s*:|\bcorrected\b|\btruth corrected\b|\boperational conclusion\b|\bdirectly supports\b|\bsource of truth\b|\bcurrent (?:canonical )?(?:status|state|context|truth|fact|setup)\b|\blatest (?:canonical )?(?:status|state|context|truth|fact|setup)\b|\bfinal (?:answer|decision|state|status|setup)\b|\bnew controller\s*:/i.test(t)) return true;
  if (/\bno found\b|\bno (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bfound no (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bcould not (?:find|locate|confirm|verify|surface|recover)\b|\b(?:cannot|can't|unable to) (?:find|locate|confirm|verify|surface|recover)\b|\bnot (?:found|located|confirmed|verified|available|present|implemented|synced|documented)\b|\bneed(?:s|ed)? to (?:implement|build|add|fix|repair|wire|create)\b|\bshould (?:implement|build|add|fix|repair|wire|create)\b|\bnext action\s*:\s*(?:implement|build|add|fix|repair|wire|create)\b|\bnot (?:yet )?implemented\b|\bunimplemented\b/i.test(t)) return false;
  return /\bimplemented\b|\bfixed\b|\brepaired\b|\bverified\b|\blive verification\b|\btests? passed\b/i.test(t);
}
function isStaleNegativeOrOpenWork(query, text, metadata) {
  if (queryWantsNegativeEvidence(query) || isFreshOrCorrectiveFact(text, metadata)) return false;
  if (metadata?.stale_negative_memory === true) return true;
  const t = String(text || '');
  return /\bno found\b|\bno (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bfound no (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bcould not (?:find|locate|confirm|verify|surface|recover)\b|\b(?:cannot|can't|unable to) (?:find|locate|confirm|verify|surface|recover)\b|\bnot (?:found|located|confirmed|verified|available|present|implemented|synced|documented)\b|\bnot in (?:memory|hard memory|durable memory|local files|the ledger|the repo)\b|\bmissing (?:from|in) (?:memory|hard memory|durable memory|local files|the ledger|the repo)\b|\bneed(?:s|ed)? to (?:implement|build|add|fix|repair|wire|create)\b|\bshould (?:implement|build|add|fix|repair|wire|create)\b|\bnext action\s*:\s*(?:implement|build|add|fix|repair|wire|create)\b|\bnot (?:yet )?implemented\b|\bunimplemented\b/i.test(t);
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
  const textHay = String(text || '').toLowerCase();
  const queryHay = String(query || '').toLowerCase();
  if (isRecentSummaryMemory(metadata, text)) return 'recent_summary';
  if (/latest|current|changed|used to|timeline|when|before|after|renamed|fixed|updated/.test(textHay)) return 'temporal_state';
  if (/prefer|preference|like|want|call me|timezone|pronouns/.test(textHay) || /prefer|preference|call me|timezone|pronouns/.test(queryHay)) return 'preference';
  if (/decid|plan|architecture|setup|config|memory/.test(textHay)) return 'decision';
  if (/status|working|l2|browser bridge|tool|runtime/.test(textHay)) return 'runtime_state';
  return undefined;
}
function normalizeValueSignature(text) { return String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }
function detectConflict(a, b) {
  if (!a.attribute || !b.attribute || a.attribute !== b.attribute) return false;
  if (a.attribute === 'recent_summary') return false;
  if (a.entity && b.entity && a.entity.toLowerCase() !== b.entity.toLowerCase()) return false;
  if (!a.valueSignature || !b.valueSignature || a.valueSignature === b.valueSignature) return false;
  return true;
}
function queryNeedsReconcile(query) { return /\b(latest|current|end up|decide|decided|change|changed|still|final|actually|correct|updated|now|working)\b/i.test(query); }
function queryNeedsInvestigate(query) { return /\b(timeline|before|after|used to|across sessions|over time|reconstruct|walk me through|evolved|history|what happened)\b/i.test(query); }
function classifyQuery(query) {
  const tags = [];
  if (isRecentSummaryQuery(query)) tags.push('recent-summary');
  if (queryNeedsInvestigate(query)) tags.push('timeline');
  if (queryNeedsReconcile(query)) tags.push('conflict-prone');
  if (/\bprefer|preference|relationship|context|social cue\b/i.test(query)) tags.push('preference');
  if (tags.includes('timeline')) return { mode: 'investigate', tags };
  if (tags.includes('recent-summary')) return { mode: 'reconcile', tags };
  if (tags.length > 0) return { mode: 'reconcile', tags };
  return { mode: 'fast', tags: ['simple-recall'] };
}

function mapCandidate(query, item, cfg, corroborationCount) {
  const metadata = item?.metadata ?? {};
  const text = String(item?.text ?? '');
  const rawScore = candidateRawScore(item, metadata);
  const timestampMs = extractTimestamp(metadata);
  const signals = {
    rawScore,
    recencyScore: recencyScore(timestampMs),
    explicitnessScore: explicitnessScore(text),
    sourceQualityScore: sourceQualityScore(metadata),
    corroborationScore: Math.min(1, corroborationCount / 3),
    lexicalOverlapScore: lexicalOverlapScore(query, text, metadata),
    contradictionPenalty: 0,
    supersededPenalty: 0,
    reasons: [],
    entity: extractEntity(query, text, metadata),
    attribute: extractAttribute(query, text, metadata),
    valueSignature: normalizeValueSignature(text),
  };
  let score = rawScore * 0.3 + signals.recencyScore * cfg.recencyBoost + signals.explicitnessScore * cfg.explicitBoost + signals.sourceQualityScore * 0.1 + signals.corroborationScore * cfg.corroborationBoost + signals.lexicalOverlapScore * 0.22;
  const historical = looksHistoricalQuery(query);
  const vague = isShortVagueQuery(query);
  const noiseSeeking = explicitNoiseSeekingQuery(query);
  if (isCurated(metadata)) { score += cfg.curatedBoost; signals.reasons.push('curated_boost'); }
  if (isProjectStateMemory(metadata) && !historical) { score += cfg.projectFactBoost; signals.reasons.push('project_fact_boost'); }
  if (signals.lexicalOverlapScore >= 0.34) signals.reasons.push('lexical_overlap');
  if (!vague && signals.lexicalOverlapScore === 0) { score -= 0.12; signals.reasons.push('no_overlap_penalty'); }
  if (isMemorySystemMetaRow(text, metadata) && !queryWantsMemorySystem(query)) { score -= 0.5; signals.reasons.push('memory_system_meta_penalty'); }
  if (isFreshOrCorrectiveFact(text, metadata) && !historical) { score += 0.18; signals.reasons.push('fresh_or_corrective_fact_boost'); }
  if (isStaleNegativeOrOpenWork(query, text, metadata) && !historical) {
    score -= 0.44;
    signals.supersededPenalty += 0.22;
    signals.reasons.push('stale_negative_or_open_work_penalty');
  }
  if (isDurableCandidate(metadata) && vague && !historical) { score -= cfg.durableCandidatePenalty; signals.reasons.push('vague_candidate_penalty'); }
  if (isWhatsappHighSignal(metadata) && vague && !historical) { score -= cfg.noisyWhatsappPenalty; signals.reasons.push('vague_whatsapp_penalty'); }
  if (textMatchesNoise(text) && !noiseSeeking && !historical) { score -= cfg.noisyPatternPenalty; signals.reasons.push('noise_pattern_penalty'); }
  if (isGhostCache(metadata) && !queryIsAboutGhostCache(query)) { score -= 0.65; signals.reasons.push('ghost_cache_penalty'); }
  if (isProbeNoise(metadata, text) && !queryIsAboutProbe(query)) { score -= 0.7; signals.reasons.push('probe_noise_penalty'); }
  if (isLeakyInternalTrace(text) && !queryIsAboutInternalTrace(query)) { score -= 0.9; signals.reasons.push('leaky_internal_trace_penalty'); }
  if (isExecutionTraceNoise(text) && !queryIsAboutExecutionTrace(query)) { score -= 0.85; signals.reasons.push('execution_trace_penalty'); }
  if (isOracleBoilerplate(text, metadata) && !queryWantsOracleBoilerplate(query)) { score -= 0.92; signals.reasons.push('oracle_boilerplate_penalty'); }
  if (isInternalOracleMemory(metadata, text) && !queryIsAboutInternalOracle(query)) { score -= 0.55; signals.reasons.push('internal_oracle_penalty'); }
  if (signals.attribute === 'internal_noise' && !queryIsAboutInternalOracle(query)) { score -= 0.35; signals.reasons.push('internal_noise_attribute_penalty'); }
  if (isRecentSummaryQuery(query)) {
    if (isRecentSummaryMemory(metadata, text)) { score += 0.34; signals.reasons.push('recent_summary_boost'); }
    else {
      if (signals.recencyScore < 0.85) { score -= 0.18; signals.reasons.push('stale_for_recent_summary'); }
      if (/connection detail|ip address|ssh|token stored|authentication:|auth profile|credential/i.test(text)) { score -= 0.22; signals.reasons.push('static_detail_penalty'); }
    }
  }
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
  let visible = mapped.filter((item) => {
    const signals = item.metadata.candidateSignals;
    if (signals.attribute === 'internal_noise' && !queryIsAboutInternalOracle(query)) return false;
    if (isGhostCache(item.metadata) && !queryIsAboutGhostCache(query)) return false;
    if (isProbeNoise(item.metadata, item.snippet) && !queryIsAboutProbe(query)) return false;
    if (isLeakyInternalTrace(item.snippet) && !queryIsAboutInternalTrace(query)) return false;
    if (isExecutionTraceNoise(item.snippet) && !queryIsAboutExecutionTrace(query)) return false;
    if (isOracleBoilerplate(item.snippet, item.metadata) && !queryWantsOracleBoilerplate(query)) return false;
    if (isMemorySystemMetaRow(item.snippet, item.metadata) && !queryWantsMemorySystem(query)) return false;
    if (isRecentSummaryQuery(query) && !isRecentSummaryMemory(item.metadata, item.snippet) && (signals.recencyScore < 0.85 || /connection detail|ip address|ssh|token stored|authentication:/i.test(item.snippet))) return false;
    return true;
  });

  const deduped = new Map();
  for (const item of visible) {
    const sig = String(item.metadata.candidateSignals?.valueSignature ?? item.snippet);
    const existing = deduped.get(sig);
    if (!existing || item.score > existing.score) deduped.set(sig, item);
  }
  visible = Array.from(deduped.values());
  if (isRecentSummaryQuery(query)) {
    const summaryOnly = visible.filter((item) => isRecentSummaryMemory(item.metadata, item.snippet));
    if (summaryOnly.length > 0) visible = summaryOnly;
  }
  const hasFreshFact = visible.some((item) => {
    const signals = item.metadata.candidateSignals;
    return isFreshOrCorrectiveFact(item.snippet, item.metadata) && signals.lexicalOverlapScore >= 0.25;
  });
  if (hasFreshFact && !queryWantsNegativeEvidence(query)) {
    visible = visible.filter((item) => {
      if (!isStaleNegativeOrOpenWork(query, item.snippet, item.metadata)) return true;
      const signals = item.metadata.candidateSignals;
      signals.supersededPenalty += cfg.conflictPenalty;
      signals.reasons.push('suppressed_by_fresh_fact');
      item.score = Math.max(0, item.score - cfg.conflictPenalty * 2);
      return classification.mode === 'investigate';
    });
  }
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
async function postJson(url, body, timeoutMs, retryCount = 0, retryBackoffMs = 250, maxResponseBytes = 1_048_576, writeHeaders = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...writeHeaders }, body: JSON.stringify(body), signal: controller.signal });
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxResponseBytes) {
        try { void res.body?.cancel().catch(() => {}); } catch {}
        throw new Error(`response exceeds ${maxResponseBytes} bytes`);
      }
      const reader = res.body?.getReader(); let size = 0; const chunks = [];
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxResponseBytes) { try { void reader.cancel().catch(() => {}); } catch {} throw new Error(`response exceeds ${maxResponseBytes} bytes`); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const text = new TextDecoder().decode(bytes);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : {};
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount || !retryableError(error)) throw error;
      await sleep(retryBackoffMs * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('unknown cortex memory manager error');
}

function scopedIdentity(rcfg, agentId, opts = {}) {
  const rawSession = String(opts.sessionKey || opts.sessionId || rcfg.sessionId || '').trim();
  if (!rcfg.sessionIdentityHmacSecret) throw new Error('sessionIdentityHmacSecret is required for canonical Cortex session identity');
  const sessionDigest = createHmac('sha256', rcfg.sessionIdentityHmacSecret).update(rawSession, 'utf8').digest('hex');
  const scope = {
    tenant_id: String(opts.tenantId || rcfg.tenantId || '').trim(),
    workspace_id: String(opts.workspaceId || rcfg.workspaceId || '').trim(),
    agent_id: String(opts.agentId || agentId || '').trim(),
    user_id: String(opts.userId || rcfg.userId || '').trim(),
    channel_id: String(opts.channelId || rcfg.channelId || '').trim(),
    session_id: `openclaw-${sessionDigest}`,
  };
  if (Object.values(scope).some((value) => !value)) {
    throw new Error('every Cortex principal scope dimension is required');
  }
  return scope;
}

function requireTrustedPrincipalContext(context, fallbackAgentId) {
  const trusted = Object.freeze({
    sessionKey: String(context?.sessionKey || context?.sessionId || '').trim(),
    userId: String(context?.userId || context?.requesterSenderId || '').trim(),
    channelId: String(context?.channelId || context?.messageChannel || '').trim(),
    agentId: String(context?.agentId || fallbackAgentId || '').trim(),
  });
  const missing = Object.entries(trusted).filter(([, value]) => !value).map(([field]) => field);
  if (missing.length) throw new Error(`Cortex memory manager requires trusted invocation context: missing ${missing.join(', ')}`);
  return trusted;
}

function scopedHeaders(rcfg, scope) {
  const secret = String(rcfg.scopeHmacSecret || '');
  const headers = rcfg.writeToken ? { [rcfg.writeTokenHeader]: rcfg.writeToken } : {};
  const tenantId = String(scope.tenant_id || '').trim();
  const workspaceId = String(scope.workspace_id || '').trim();
  const credentialId = String(rcfg.scopeCredentialId || '').trim();
  if (!secret || !credentialId) {
    if (tenantId === 'cortex-local' && workspaceId === 'default') {
      return {
        ...headers,
        'x-cortex-tenant-id': tenantId,
        'x-cortex-workspace-id': workspaceId,
        'x-cortex-agent-id': scope.agent_id,
        'x-cortex-user-id': scope.user_id,
        'x-cortex-channel-id': scope.channel_id,
        'x-cortex-session-id': scope.session_id,
      };
    }
    throw new Error('scopeCredentialId and scopeHmacSecret are required to authenticate non-default Cortex memory scope');
  }
  const signature = createHmac('sha256', secret)
    .update(['cortex.memory.principal.v2', credentialId, tenantId, workspaceId, scope.agent_id, scope.user_id, scope.channel_id, scope.session_id].join('\n'), 'utf8')
    .digest('hex');
  return {
    ...headers,
    'x-cortex-tenant-id': tenantId,
    'x-cortex-workspace-id': workspaceId,
    'x-cortex-agent-id': scope.agent_id,
    'x-cortex-user-id': scope.user_id,
    'x-cortex-channel-id': scope.channel_id,
    'x-cortex-session-id': scope.session_id,
    'x-cortex-scope-credential-id': credentialId,
    'x-cortex-scope-signature': signature,
  };
}

function memoryScopeFields(rcfg, scope) {
  const headers = scopedHeaders(rcfg, scope);
  return {
    tenant_id: headers['x-cortex-tenant-id'],
    workspace_id: headers['x-cortex-workspace-id'],
    scope_credential_id: headers['x-cortex-scope-credential-id'],
    ...(headers['x-cortex-scope-signature'] ? { scope_signature: headers['x-cortex-scope-signature'] } : {}),
  };
}

function unavailableSearchReason(response) {
  if (!response || typeof response !== 'object') return 'invalid search response';
  if (response.disabled === true || response.available === false) return String(response.error || response.warning || 'search backend unavailable');
  if (typeof response.error === 'string' && response.error.trim()) return response.error.trim();
  const mode = String(response.search_mode ?? response.mode ?? '').trim().toLowerCase();
  if (['disabled', 'error', 'failed', 'none', 'unavailable'].includes(mode)) return String(response.warning || `search mode ${mode}`);
  return null;
}

export class CortexMemorySearchManager {
  constructor(params) {
    this.cfg = params.cfg;
    this.invocationContext = requireTrustedPrincipalContext(params.invocationContext || params, params.agentId);
    this.agentId = this.invocationContext.agentId;
    this.rcfg = resolveConfig(params.cfg);
  }
  static async create(params) { return new CortexMemorySearchManager(params); }
  async search(query, opts = {}) {
    const classification = classifyQuery(query);
    const requestedMax = Number(opts.maxResults || 6);
    const fetchCount = classification.mode === 'investigate' ? Math.max(requestedMax, this.rcfg.hardQueryCandidateCount) : Math.max(requestedMax, 8);
    const scope = scopedIdentity(this.rcfg, this.agentId, this.invocationContext);
    const headers = scopedHeaders(this.rcfg, scope);
    const response = await postJson(`${this.rcfg.baseUrl}${this.rcfg.searchPath}`, {
      query,
      n_results: fetchCount,
      scope,
      ...memoryScopeFields(this.rcfg, scope),
    }, this.rcfg.timeoutMs, this.rcfg.retryCount, this.rcfg.retryBackoffMs, this.rcfg.maxResponseBytes, headers);
    const unavailable = unavailableSearchReason(response);
    if (unavailable) throw new Error(`Cortex memory search unavailable: ${unavailable}`);
    const items = Array.isArray(response?.results) ? response.results : [];
    const reconciled = reconcileResults(query, items, this.rcfg);
    let results = reconciled.results.slice(0, requestedMax);
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
      custom: { searchMode: 'semantic', bridge: 'cortex-memory-bridge', baseUrl: this.rcfg.baseUrl, scoped: true, modes: ['fast', 'reconcile', 'investigate-lite'] }
    };
  }
  async probeSearchAvailability() {
    try {
      const scope = scopedIdentity(this.rcfg, this.agentId, this.invocationContext);
      const headers = scopedHeaders(this.rcfg, scope);
      const response = await postJson(`${this.rcfg.baseUrl}${this.rcfg.searchPath}`, {
        query: 'cortex memory backend availability probe',
        n_results: 1,
        scope,
        ...memoryScopeFields(this.rcfg, scope),
      }, this.rcfg.timeoutMs, 0, this.rcfg.retryBackoffMs, this.rcfg.maxResponseBytes, headers);
      const unavailable = unavailableSearchReason(response);
      return unavailable ? { ok: false, error: unavailable } : { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async probeEmbeddingAvailability() { return this.probeSearchAvailability(); }
  async probeVectorAvailability() { return (await this.probeSearchAvailability()).ok; }
  async close() {}
}

export default { CortexMemorySearchManager };
