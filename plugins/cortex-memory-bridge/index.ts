import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/memory-core';
import { createHash } from 'node:crypto';

type BridgeConfig = {
  baseUrl?: string;
  searchPath?: string;
  storePath?: string;
  codecEventsPath?: string;
  timeoutMs?: number;
  retryCount?: number;
  retryBackoffMs?: number;
  enabledWriteThrough?: boolean;
  enabledCodecContinuity?: boolean;
  curatedBoost?: number;
  projectFactBoost?: number;
  durableCandidatePenalty?: number;
  noisyWhatsappPenalty?: number;
  noisyPatternPenalty?: number;
  minDurabilityScore?: number;
  writeTags?: string[];
  conflictPenalty?: number;
  recencyBoost?: number;
  explicitBoost?: number;
  corroborationBoost?: number;
  hardQueryCandidateCount?: number;
  maxResponseBytes?: number;
  lifecycleMaxInFlight?: number;
  recentOutputMaxChars?: number;
};

type MemoryCandidate = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: 'memory';
  citation?: string;
  metadata: Record<string, unknown>;
};

type QueryMode = 'fast' | 'reconcile' | 'investigate';
type CandidateSignals = {
  rawScore: number;
  recencyScore: number;
  explicitnessScore: number;
  sourceQualityScore: number;
  corroborationScore: number;
  lexicalOverlapScore: number;
  contradictionPenalty: number;
  supersededPenalty: number;
  reasons: string[];
  entity?: string;
  attribute?: string;
  valueSignature?: string;
};

type ReconcileResult = {
  mode: QueryMode;
  queryType: string[];
  results: MemoryCandidate[];
  resolvedFacts: Array<{ entity?: string; attribute?: string; bestPath: string; supportingPaths: string[] }>;
  conflicts: Array<{ entity?: string; attribute?: string; paths: string[]; values: string[] }>;
};

const LIFECYCLE_DEDUP_MAX_ENTRIES = 4096;
const LIFECYCLE_DEDUP_TTL_MS = 10 * 60 * 1000;
const LIFECYCLE_MAX_IN_FLIGHT = 64;
const RECENT_OUTPUT_MAX_ENTRIES = 1024;
const RECENT_OUTPUT_TTL_MS = 10 * 60 * 1000;
const RECENT_OUTPUT_MAX_CHARS = 4096;

function lifecyclePersistenceKey(session: string, payload: string): string {
  const sessionBytes = Buffer.from(session, 'utf8');
  const payloadBytes = Buffer.from(payload, 'utf8');
  const encodedLength = (length: number) => {
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeBigUInt64BE(BigInt(length));
    return buffer;
  };
  const digest = createHash('sha256')
    .update(encodedLength(sessionBytes.length))
    .update(sessionBytes)
    .update(encodedLength(payloadBytes.length))
    .update(payloadBytes)
    .digest('hex');
  return `${session}:${digest}`;
}

function lifecycleIdentity(event: any, ctx: any): string | undefined {
  for (const field of ['runId', 'run_id', 'completionId', 'completion_id']) {
    for (const source of [ctx, event]) {
      const value = source?.[field];
      if (typeof value === 'string' && value.trim()) {
        const digest = createHash('sha256').update(value.trim(), 'utf8').digest('hex');
        return `${field.replace('_', '').toLowerCase()}:${digest}`;
      }
    }
  }
  return undefined;
}

class ExpiringLruMap<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new Error('ExpiringLruMap requires positive integer bounds');
    }
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string, now = Date.now()): T | undefined {
    this.pruneExpired(now);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    this.pruneExpired(now);
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  delete(key: string): boolean { return this.entries.delete(key); }

  get size(): number { return this.entries.size; }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

class ExpiringLruSet {
  private readonly entries = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new Error('ExpiringLruSet requires positive integer bounds');
    }
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  has(key: string, now = Date.now()): boolean {
    this.pruneExpired(now);
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) return false;
    // Reinsert to make successful lookups the most-recently-used entries.
    this.entries.delete(key);
    this.entries.set(key, expiresAt);
    return true;
  }

  add(key: string, now = Date.now()): void {
    this.pruneExpired(now);
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, now + this.ttlMs);
  }

  private pruneExpired(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}

const SearchSchema = {
  type: 'object', additionalProperties: false, required: ['query'],
  properties: { query: { type: 'string', minLength: 1 }, maxResults: { type: 'number', minimum: 1, maximum: 50 }, minScore: { type: 'number', minimum: 0, maximum: 1 } },
} as const;
const GetSchema = {
  type: 'object', additionalProperties: false, required: ['path'],
  properties: { path: { type: 'string' }, from: { type: 'number' }, lines: { type: 'number' } },
} as const;

function resolveConfig(pluginConfig?: Record<string, unknown>): Required<Pick<BridgeConfig, 'baseUrl' | 'searchPath' | 'storePath' | 'codecEventsPath' | 'timeoutMs' | 'retryCount' | 'retryBackoffMs' | 'curatedBoost' | 'projectFactBoost' | 'durableCandidatePenalty' | 'noisyWhatsappPenalty' | 'noisyPatternPenalty' | 'minDurabilityScore' | 'writeTags' | 'conflictPenalty' | 'recencyBoost' | 'explicitBoost' | 'corroborationBoost' | 'hardQueryCandidateCount' | 'maxResponseBytes' | 'lifecycleMaxInFlight' | 'recentOutputMaxChars'>> & BridgeConfig {
  const cfg = (pluginConfig ?? {}) as BridgeConfig;
  return {
    baseUrl: (cfg.baseUrl ?? 'http://127.0.0.1:18888').replace(/\/$/, ''),
    searchPath: cfg.searchPath ?? '/knowledge/search',
    storePath: cfg.storePath ?? '/l22/store',
    codecEventsPath: cfg.codecEventsPath ?? '/nexus/codec/events',
    timeoutMs: cfg.timeoutMs ?? 12000,
    retryCount: cfg.retryCount ?? 2,
    retryBackoffMs: cfg.retryBackoffMs ?? 350,
    enabledWriteThrough: cfg.enabledWriteThrough ?? false,
    enabledCodecContinuity: cfg.enabledCodecContinuity ?? false,
    maxResponseBytes: cfg.maxResponseBytes ?? 1_048_576,
    lifecycleMaxInFlight: Number.isSafeInteger(cfg.lifecycleMaxInFlight) && Number(cfg.lifecycleMaxInFlight) > 0
      ? Math.min(4096, Number(cfg.lifecycleMaxInFlight))
      : LIFECYCLE_MAX_IN_FLIGHT,
    recentOutputMaxChars: Number.isSafeInteger(cfg.recentOutputMaxChars) && Number(cfg.recentOutputMaxChars) > 0
      ? Math.min(65_536, Number(cfg.recentOutputMaxChars))
      : RECENT_OUTPUT_MAX_CHARS,
    curatedBoost: cfg.curatedBoost ?? 0.24,
    projectFactBoost: cfg.projectFactBoost ?? 0.12,
    durableCandidatePenalty: cfg.durableCandidatePenalty ?? 0.14,
    noisyWhatsappPenalty: cfg.noisyWhatsappPenalty ?? 0.26,
    noisyPatternPenalty: cfg.noisyPatternPenalty ?? 0.2,
    minDurabilityScore: cfg.minDurabilityScore ?? 0.72,
    writeTags: Array.isArray(cfg.writeTags) ? cfg.writeTags.map((x) => String(x)) : ['durable-memory', 'auto-curated'],
    conflictPenalty: cfg.conflictPenalty ?? 0.18,
    recencyBoost: cfg.recencyBoost ?? 0.12,
    explicitBoost: cfg.explicitBoost ?? 0.14,
    corroborationBoost: cfg.corroborationBoost ?? 0.08,
    hardQueryCandidateCount: cfg.hardQueryCandidateCount ?? 12,
  };
}

function normalizeQuery(text: string): string { return text.trim().toLowerCase(); }
function looksHistoricalQuery(query: string): boolean { return /\b(history|historical|when|timeline|previous|earlier|used to|what happened|completion events|finished|completed)\b/i.test(query); }
function isShortVagueQuery(query: string): boolean { const q = normalizeQuery(query); const words = q.split(/\s+/).filter(Boolean); return words.length <= 3 || q.length <= 24; }
function explicitNoiseSeekingQuery(query: string): boolean { return /\b(link|source|url|hash|log|info|status line|status update|historical completion|completion event)\b/i.test(query); }
const STOPWORDS = new Set(['the','a','an','and','or','but','for','from','with','without','into','onto','about','what','where','when','which','who','whom','this','that','these','those','is','are','was','were','be','been','being','to','of','in','on','at','by','my','we','it','as','do','did','does','how','main','session']);
function semanticTerms(text: string): string[] {
  return Array.from(new Set(normalizeQuery(text).split(/[^a-z0-9_.-]+/).filter((x) => x.length >= 3 && !STOPWORDS.has(x))));
}
function lexicalOverlapScore(query: string, text: string, metadata: Record<string, unknown>): number {
  const qTerms = semanticTerms(query);
  if (!qTerms.length) return 0;
  const hay = `${text} ${String(metadata?.topic ?? '')} ${Array.isArray(metadata?.tags) ? metadata.tags.join(' ') : ''}`.toLowerCase();
  let hits = 0;
  for (const term of qTerms) {
    if (hay.includes(term)) hits += 1;
  }
  return Math.max(0, Math.min(1, hits / qTerms.length));
}
function isCurated(metadata: any): boolean { const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x)) : []; return metadata?.quality === 'curated' || tags.includes('curated'); }
function isWhatsappHighSignal(metadata: any): boolean { return metadata?.source === 'whatsapp-high-signal'; }
function isProjectStateMemory(metadata: any): boolean { return ['curated-project-facts', 'curated-preferences-priorities', 'curated-anti-drift', 'curated-noise-suppression'].includes(String(metadata?.source ?? '')); }
function isDurableCandidate(metadata: any): boolean { return metadata?.source === 'durable-candidates'; }
function isGhostCache(metadata: any): boolean { return String(metadata?.type ?? '').toLowerCase() === 'ghost_cache' || String(metadata?.source ?? '').toLowerCase() === 'ghost_cache'; }
function queryIsAboutGhostCache(query: string): boolean { return /\bghost cache\b|\bghost\b.*\bcache\b|\bcache key\b|\bcached browse\b/.test(normalizeQuery(query)); }
function isProbeNoise(metadata: any, text: string): boolean {
  const source = String(metadata?.source ?? '').toLowerCase();
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x).toLowerCase()) : [];
  const t = text.trim().toLowerCase();
  return source.includes('probe') || tags.includes('probe') || t === 'probe' || /^probe[:\s-]?/.test(t);
}
function queryIsAboutProbe(query: string): boolean { return /\bprobe\b|self-model|telemetry|diagnostic/.test(normalizeQuery(query)); }
function isLeakyInternalTrace(text: string): boolean {
  const t = text.toLowerCase();
  return /encrypted_content|thinkingsignature|cortex upstream routing applied:|\bthinking\s*\{|"type":"reasoning"|gaaaaaab/.test(t);
}
function queryIsAboutInternalTrace(query: string): boolean { return /encrypted_content|thinking|routing applied|reasoning payload|internal trace/.test(normalizeQuery(query)); }
function isExecutionTraceNoise(text: string): boolean {
  const t = text.toLowerCase();
  return /\btoolcall\b|\bsessions_yield\b|\bsessions_spawn\b|\bcall_[a-z0-9]+\b|"command":|"workdir":|"yieldms":|"timeoutseconds":|"runtime":"subagent"|openclaw gateway restart/.test(t);
}
function queryIsAboutExecutionTrace(query: string): boolean { return /toolcall|sessions_yield|sessions_spawn|execution trace|tool trace|gateway restart/.test(normalizeQuery(query)); }
function isRecentSummaryQuery(query: string): boolean {
  return /\bwhat changed recently\b|\brecent changes\b|\brecent update\b|\bstatus update\b|\bwhat'?s going on\b|\bhow'?s this going\b|\bwhat happened lately\b|\blately\b/.test(normalizeQuery(query));
}
function queryLooksLikePreference(query: string): boolean {
  return /\bprefer|preference|call me|timezone|pronouns|reply prefix|replies begin with|reply begin with|what should replies begin with|prefix should replies use\b/i.test(query);
}
function looksLikePreferenceQuestionEcho(text: string): boolean {
  return /\bopen loops?:\b|\bwhat did jake ask me\b|\bwhat should replies begin with\b|\bwhat preference does jake\b|\bprefix replies with\b/i.test(text);
}
function looksLikeExplicitPreferenceFact(text: string): boolean {
  return /\b(?:jake\s+)?prefers?\s+repl(?:y|ies)\s+to\s+begin\s+with\b|\breplies\s+to\s+begin\s+with\s*\[cortex\]/i.test(text);
}
function isRecentSummaryMemory(metadata: Record<string, unknown>, text: string): boolean {
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x).toLowerCase()) : [];
  const topic = String(metadata?.topic ?? '').toLowerCase();
  const t = text.toLowerCase();
  return tags.includes('recent-summary')
    || topic.includes('recent-status')
    || /recent status summary:|recent changes:|this session:|bridge repair completed|write-through proved|ranking improved|noise suppression improved/.test(t);
}
function isInternalOracleMemory(metadata: Record<string, unknown>, text: string): boolean {
  const source = String(metadata?.source ?? '').toLowerCase();
  const sessionKey = String(metadata?.sessionKey ?? '').toLowerCase();
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x).toLowerCase()) : [];
  const t = text.toLowerCase();
  return source.includes('oracle')
    || sessionKey.includes('oracle')
    || tags.includes('semantic_prediction')
    || tags.includes('awareness')
    || /oracle predicts|durable verification marker|durable smoke marker|memory bridge probe|anti recursion|terminal synthesis|repeat safeguard|convergence guard|loop guard|recursion barrier/.test(t);
}
function queryIsAboutInternalOracle(query: string): boolean {
  return /\boracle\b|semantic prediction|memory bridge probe|durable (verification|smoke) marker|anti recursion|recursion barrier|loop guard/.test(query.toLowerCase());
}
function isOracleBoilerplate(text: string, metadata: Record<string, unknown>): boolean {
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x: unknown) => String(x).toLowerCase()) : [];
  const t = text.toLowerCase().trim();
  return tags.includes('semantic_prediction')
    || tags.includes('awareness')
    || /^asking oracle for a semantic prediction\.\.\.?$/.test(t)
    || /^oracle predicts:?$/i.test(text.trim());
}
function queryWantsOracleBoilerplate(query: string): boolean {
  return /semantic prediction|raw oracle|oracle trace|oracle predicts|awareness/.test(normalizeQuery(query));
}
function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && value.trim() !== '') return n > 1e12 ? n : n * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function extractTimestamp(metadata: Record<string, unknown>): number | null {
  return toTimestamp(metadata.timestamp) ?? toTimestamp(metadata.createdAt) ?? toTimestamp(metadata.updatedAt) ?? toTimestamp(metadata.occurredAt) ?? null;
}
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  return Number.isFinite(n) ? n : null;
}
function candidateRawScore(item: any, metadata: Record<string, unknown>): number {
  // Cortex/Librarian may already reconcile semantic distance, lexical overlap,
  // freshness, and stale-negative penalties into an explicit score. Prefer that
  // over raw vector distance so the OpenClaw-facing bridge does not undo Cortex's
  // broader recall-integrity judgment.
  const direct = finiteNumber(item?.score);
  if (direct !== null) return clamp01(direct);
  const hybrid = finiteNumber(metadata?.hybrid_score);
  if (hybrid !== null) return clamp01(hybrid);
  const relevance = finiteNumber(metadata?.relevance_score);
  if (relevance !== null) return clamp01(relevance);
  const distance = finiteNumber(item?.distance);
  return distance !== null ? 1 / (1 + Math.max(0, distance)) : 0.5;
}
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
function recencyScore(timestampMs: number | null): number {
  if (!timestampMs) return 0.25;
  const ageDays = Math.max(0, (Date.now() - timestampMs) / 86400000);
  if (ageDays <= 2) return 1;
  if (ageDays <= 7) return 0.85;
  if (ageDays <= 30) return 0.65;
  if (ageDays <= 180) return 0.45;
  return 0.25;
}
function explicitnessScore(text: string): number {
  let score = 0.2;
  if (/\b(i prefer|prefer|remember this|please remember|call me|my timezone|we decided|the plan is|always use|default to|never use|use this|current|latest|final)\b/i.test(text)) score += 0.55;
  if (/\b(maybe|probably|might|i think|seems|guess|not sure)\b/i.test(text)) score -= 0.18;
  return Math.max(0, Math.min(1, score));
}
function queryWantsNegativeEvidence(query: string): boolean {
  return /\b(not found|no evidence|no record|absence|missing|remaining|open gap|open gaps|gap inventory|gap list|blocker|what(?:'s| is| was)? still missing|what(?:'s| is| was)? left|what remains)\b/i.test(normalizeQuery(query));
}
function queryWantsMemorySystem(query: string): boolean {
  return /\bmemory system|memory search|memory_search|recall|librarian|cortex memory|knowledge\/search|reranker|ranking|semantic search\b/i.test(normalizeQuery(query));
}
function isMemorySystemMetaRow(text: string, metadata: Record<string, unknown>): boolean {
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.join(' ') : '';
  const hay = `${text} ${String(metadata?.source ?? '')} ${tags}`.toLowerCase();
  return /memory_search\(|memory search|local file-?memory lexical fallback|recall regression|recall route|librarian\.py|test_librarian_recall_fallback|stale-negative|correction\/conclusion rows|reranker|cortex memory bridge|cortex-memory-bridge|knowledge\/search/.test(hay);
}
function isFreshOrCorrectiveFact(text: string, metadata: Record<string, unknown>): boolean {
  const t = String(text || '');
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.map((x) => String(x).toLowerCase()) : [];
  if (metadata?.correction_memory === true || tags.includes('correction') || tags.includes('current_fact') || tags.includes('source_of_truth')) return true;
  if (/\bcorrection\s*:|\bcorrected\b|\btruth corrected\b|\boperational conclusion\b|\bdirectly supports\b|\bsource of truth\b|\bcurrent (?:canonical )?(?:status|state|context|truth|fact|setup)\b|\blatest (?:canonical )?(?:status|state|context|truth|fact|setup)\b|\bfinal (?:answer|decision|state|status|setup)\b|\bnew controller\s*:/i.test(t)) return true;
  if (/\bno found\b|\bno (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bfound no (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bcould not (?:find|locate|confirm|verify|surface|recover)\b|\b(?:cannot|can't|unable to) (?:find|locate|confirm|verify|surface|recover)\b|\bnot (?:found|located|confirmed|verified|available|present|implemented|synced|documented)\b|\bneed(?:s|ed)? to (?:implement|build|add|fix|repair|wire|create)\b|\bshould (?:implement|build|add|fix|repair|wire|create)\b|\bnext action\s*:\s*(?:implement|build|add|fix|repair|wire|create)\b|\bnot (?:yet )?implemented\b|\bunimplemented\b/i.test(t)) return false;
  return /\bimplemented\b|\bfixed\b|\brepaired\b|\bverified\b|\blive verification\b|\btests? passed\b/i.test(t);
}
function isStaleNegativeOrOpenWork(query: string, text: string, metadata: Record<string, unknown>): boolean {
  if (queryWantsNegativeEvidence(query) || isFreshOrCorrectiveFact(text, metadata)) return false;
  if (metadata?.stale_negative_memory === true) return true;
  const t = String(text || '');
  return /\bno found\b|\bno (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bfound no (?:explicit )?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b|\bcould not (?:find|locate|confirm|verify|surface|recover)\b|\b(?:cannot|can't|unable to) (?:find|locate|confirm|verify|surface|recover)\b|\bnot (?:found|located|confirmed|verified|available|present|implemented|synced|documented)\b|\bnot in (?:memory|hard memory|durable memory|local files|the ledger|the repo)\b|\bmissing (?:from|in) (?:memory|hard memory|durable memory|local files|the ledger|the repo)\b|\bneed(?:s|ed)? to (?:implement|build|add|fix|repair|wire|create)\b|\bshould (?:implement|build|add|fix|repair|wire|create)\b|\bnext action\s*:\s*(?:implement|build|add|fix|repair|wire|create)\b|\bnot (?:yet )?implemented\b|\bunimplemented\b/i.test(t);
}
function sourceQualityScore(metadata: Record<string, unknown>): number {
  if (metadata?.canonical_project_memory === true || metadata?.source === 'canonical_project_file') return 1;
  if (isCurated(metadata)) return 1;
  if (isProjectStateMemory(metadata)) return 0.92;
  if (isDurableCandidate(metadata)) return 0.66;
  if (isWhatsappHighSignal(metadata)) return 0.54;
  return 0.45;
}
function extractEntity(query: string, text: string, metadata: Record<string, unknown>): string | undefined {
  if (isInternalOracleMemory(metadata, text) && !queryIsAboutInternalOracle(query)) return undefined;
  const explicit = text.match(/\b(?:Jake|HeroUI|OpenClaw|Cortex|WhatsApp|Home Assistant|Oracle)\b/i)?.[0];
  if (explicit) return explicit;
  const fromQuery = query.match(/\b(?:Jake|HeroUI|OpenClaw|Cortex|WhatsApp|Home Assistant|Oracle)\b/i)?.[0];
  return fromQuery ?? undefined;
}
function extractAttribute(query: string, text: string, metadata: Record<string, unknown>): string | undefined {
  if (isInternalOracleMemory(metadata, text) && !queryIsAboutInternalOracle(query)) return 'internal_noise';
  const textHay = text.toLowerCase();
  const queryHay = query.toLowerCase();
  if (isRecentSummaryMemory(metadata, text)) return 'recent_summary';
  if (/latest|current|changed|used to|timeline|when|before|after|renamed|fixed|updated/.test(textHay)) return 'temporal_state';
  if (/prefer|preference|like|want|call me|timezone|pronouns|replies begin with|reply prefix/.test(textHay) || queryLooksLikePreference(queryHay)) return 'preference';
  if (/decid|plan|architecture|setup|config|memory/.test(textHay)) return 'decision';
  if (/status|working|l2|browser bridge|tool|runtime/.test(textHay)) return 'runtime_state';
  return undefined;
}
function normalizeValueSignature(text: string): string {
  return text.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}
function isTentativePreferenceSignature(signature: string | undefined): boolean {
  const s = String(signature || '').toLowerCase();
  return /\bopen loops?\b|\bwhat did\b|\bask me\b|\bquestion\b|\bunknown\b|\bsystem\b/.test(s);
}
function canonicalPreferenceCore(signature: string | undefined): string {
  const s = String(signature || '').toLowerCase();
  const match = s.match(/(?:jake\s+)?prefers?\s+repl(?:y|ies)\s+to\s+begin\s+with\s+[a-z0-9\[\]]+/);
  return match ? match[0] : '';
}
function detectConflict(a: CandidateSignals, b: CandidateSignals): boolean {
  if (!a.attribute || !b.attribute || a.attribute !== b.attribute) return false;
  if (a.attribute === 'recent_summary') return false;
  if (a.entity && b.entity && a.entity.toLowerCase() !== b.entity.toLowerCase()) return false;
  if (!a.valueSignature || !b.valueSignature || a.valueSignature === b.valueSignature) return false;
  if (a.attribute === 'preference') {
    if (isTentativePreferenceSignature(a.valueSignature) || isTentativePreferenceSignature(b.valueSignature)) return false;
    const aCore = canonicalPreferenceCore(a.valueSignature);
    const bCore = canonicalPreferenceCore(b.valueSignature);
    if (aCore && bCore && aCore === bCore) return false;
  }
  return true;
}
function queryNeedsReconcile(query: string): boolean {
  return /\b(latest|current|end up|decide|decided|change|changed|still|final|actually|correct|updated|now|working)\b/i.test(query);
}
function queryNeedsInvestigate(query: string): boolean {
  return /\b(timeline|before|after|used to|across sessions|over time|reconstruct|walk me through|evolved|history|what happened)\b/i.test(query);
}
function classifyQuery(query: string): { mode: QueryMode; tags: string[] } {
  const tags: string[] = [];
  if (isRecentSummaryQuery(query)) tags.push('recent-summary');
  if (queryNeedsInvestigate(query)) tags.push('timeline');
  if (queryNeedsReconcile(query)) tags.push('conflict-prone');
  if (/\bprefer|preference|relationship|context|social cue\b/i.test(query) || queryLooksLikePreference(query)) tags.push('preference');
  if (tags.includes('timeline')) return { mode: 'investigate', tags };
  if (tags.includes('recent-summary')) return { mode: 'reconcile', tags };
  if (tags.length > 0) return { mode: 'reconcile', tags };
  return { mode: 'fast', tags: ['simple-recall'] };
}

function mapCandidate(query: string, item: any, cfg: ReturnType<typeof resolveConfig>, corroborationCount: number): MemoryCandidate {
  const metadata = (item?.metadata ?? {}) as Record<string, unknown>;
  const text = String(item?.text ?? '');
  const rawScore = candidateRawScore(item, metadata);
  const timestampMs = extractTimestamp(metadata);
  const signals: CandidateSignals = {
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
  const authorityRank = finiteNumber(metadata?.authority_rank) ?? 30;
  score += Math.min(0.24, authorityRank / 420);
  if (metadata?.canonical_project_memory === true || metadata?.source === 'canonical_project_file') { score += 0.2; signals.reasons.push('canonical_project_authority'); }
  const memoryStatus = String(metadata?.memory_status ?? 'active').toLowerCase();
  if (!looksHistoricalQuery(query) && (memoryStatus === 'superseded' || memoryStatus === 'tombstoned')) { score -= 0.8; signals.supersededPenalty += 0.8; signals.reasons.push('explicitly_superseded'); }
  if (isProjectStateMemory(metadata) && !historical) { score += cfg.projectFactBoost; signals.reasons.push('project_fact_boost'); }
  if (signals.lexicalOverlapScore >= 0.34) { signals.reasons.push('lexical_overlap'); }
  if (!vague && signals.lexicalOverlapScore === 0) { score -= 0.12; signals.reasons.push('no_overlap_penalty'); }
  if (queryLooksLikePreference(query) && signals.attribute === 'preference') { score += 0.22; signals.reasons.push('preference_match_boost'); }
  if (queryLooksLikePreference(query) && looksLikeExplicitPreferenceFact(text)) { score += 0.34; signals.reasons.push('explicit_preference_phrase_boost'); }
  if (queryLooksLikePreference(query) && looksLikePreferenceQuestionEcho(text)) { score -= 0.42; signals.reasons.push('preference_question_echo_penalty'); }
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

function reconcileResults(query: string, items: any[], cfg: ReturnType<typeof resolveConfig>): ReconcileResult {
  const classification = classifyQuery(query);
  const groupedBySignature = new Map<string, number>();
  for (const item of items) {
    const signature = normalizeValueSignature(String(item?.text ?? ''));
    if (!signature) continue;
    groupedBySignature.set(signature, (groupedBySignature.get(signature) ?? 0) + 1);
  }
  const mapped = items.map((item) => mapCandidate(query, item, cfg, groupedBySignature.get(normalizeValueSignature(String(item?.text ?? ''))) ?? 1));
  let visible = mapped.filter((item) => {
    const signals = item.metadata.candidateSignals as CandidateSignals;
    const memoryStatus = String(item.metadata?.memory_status ?? 'active').toLowerCase();
    if (!looksHistoricalQuery(query) && (memoryStatus === 'superseded' || memoryStatus === 'tombstoned')) return false;
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
  const deduped = new Map<string, MemoryCandidate>();
  for (const item of visible) {
    const sig = String((item.metadata.candidateSignals as CandidateSignals).valueSignature ?? item.snippet);
    const existing = deduped.get(sig);
    if (!existing || item.score > existing.score) deduped.set(sig, item);
  }
  visible = Array.from(deduped.values());
  if (isRecentSummaryQuery(query)) {
    const summaryOnly = visible.filter((item) => isRecentSummaryMemory(item.metadata, item.snippet));
    if (summaryOnly.length > 0) visible = summaryOnly;
  }
  const hasFreshFact = visible.some((item) => {
    const signals = item.metadata.candidateSignals as CandidateSignals;
    return isFreshOrCorrectiveFact(item.snippet, item.metadata) && signals.lexicalOverlapScore >= 0.25;
  });
  if (hasFreshFact && !queryWantsNegativeEvidence(query)) {
    visible = visible.filter((item) => {
      if (!isStaleNegativeOrOpenWork(query, item.snippet, item.metadata)) return true;
      const signals = item.metadata.candidateSignals as CandidateSignals;
      signals.supersededPenalty += cfg.conflictPenalty;
      signals.reasons.push('suppressed_by_fresh_fact');
      item.score = Math.max(0, item.score - cfg.conflictPenalty * 2);
      return classification.mode === 'investigate';
    });
  }
  const conflicts: ReconcileResult['conflicts'] = [];
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const aSignals = visible[i].metadata.candidateSignals as CandidateSignals;
      const bSignals = visible[j].metadata.candidateSignals as CandidateSignals;
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
        const olderSignals = older.metadata.candidateSignals as CandidateSignals;
        olderSignals.supersededPenalty += cfg.conflictPenalty / 2;
        olderSignals.reasons.push('likely_superseded');
      }
      conflicts.push({
        entity: aSignals.entity ?? bSignals.entity,
        attribute: aSignals.attribute,
        paths: [visible[i].path, visible[j].path],
        values: [aSignals.valueSignature ?? '', bSignals.valueSignature ?? ''],
      });
    }
  }
  visible.sort((a, b) => (b.score - a.score) || String(a.path).localeCompare(String(b.path)));
  const resolvedFactsMap = new Map<string, { entity?: string; attribute?: string; bestPath: string; supportingPaths: string[]; bestScore: number }>();
  for (const item of visible) {
    const signals = item.metadata.candidateSignals as CandidateSignals;
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
    resolvedFacts: Array.from(resolvedFactsMap.values()).map(({ bestScore: _bestScore, ...rest }) => rest),
    conflicts,
  };
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function retryableError(error: unknown): boolean {
  const msg = String((error as any)?.message || error || '');
  return /aborted|AbortError|timeout|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|HTTP 408|HTTP 429|HTTP 500|HTTP 502|HTTP 503|HTTP 504/i.test(msg);
}
async function postJson(baseUrl: string, route: string, body: unknown, timeoutMs: number, retryCount = 0, retryBackoffMs = 250, maxResponseBytes = 1_048_576) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const cap = maxResponseBytes;
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > cap) {
        try { void res.body?.cancel().catch(() => {}); } catch {}
        throw new Error(`response exceeds ${cap} bytes`);
      }
      const reader = res.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > cap) { try { void reader.cancel().catch(() => {}); } catch {} throw new Error(`response exceeds ${cap} bytes`); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const text = new TextDecoder().decode(bytes);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : {};
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
  if (obj.type === 'thinking' || typeof obj.thinkingSignature === 'string' || typeof obj.encrypted_content === 'string') return '';
  if (typeof obj.customType === 'string' && obj.display === false) return '';
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

function extractAssistantVisibleText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  return messages
    .filter((m) => m && typeof m === 'object' && (m as Record<string, unknown>).role === 'assistant')
    .map((m) => extractText((m as Record<string, unknown>).content ?? m))
    .filter(Boolean)
    .join('\n');
}
function detectProjectSlug(text: string): string | null {
  const t = normalizeQuery(text);
  if (/\bmailchimp\b/.test(t)) return 'mailchimp';
  if (/\bpmhnp\b|\bclaim guard\b/.test(t)) return 'pmhnp-claim-guard';
  return null;
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
  if (/\b(supervisorstatus|matrixstatus|paritystatus)\b|\bcanonical status\b|\bremaining surfaces\b|\bremaining unsatisfied surfaces\b|\bwhat this run actually changed\b|\bblocker\s*:\s*|\btrustworthy partial result\b/i.test(t)) { score += 0.58; reasons.push('canonical_project_status'); kind = 'project_state'; }
  if (/\bremember this\b|\bplease remember\b|\bmy preference\b|\bi prefer\b|\bcall me\b|\btimezone\b|\bpronouns\b/i.test(t)) { score += 0.45; reasons.push('explicit_preference'); kind = 'preference'; }
  if (/\bdecision\b|\bwe decided\b|\bthe plan is\b|\bfrom now on\b|\bdefault to\b|\balways use\b/i.test(t)) { score += 0.35; reasons.push('decision'); kind = 'decision'; }
  if (/\breply-anchor context .* primary\b|\breply anchor .* primary\b|\bpersistence first\b/i.test(t)) { score += 0.2; reasons.push('anti_drift_or_lesson'); if (kind === 'transient') kind = 'decision'; }
  if (/\bproject\b|\barchitecture\b|\bsetup\b|\bconnection details\b|\bssh\b|\bendpoint\b/i.test(t)) { score += 0.22; reasons.push('project_fact'); if (kind === 'transient') kind = 'fact'; }
  if (detectProjectSlug(t)) { score += 0.16; reasons.push('named_project'); if (kind === 'transient') kind = 'fact'; }
  if (/\b(today|right now|currently|just now|this morning|tonight|lol|haha|thanks|ok|okay|sure)\b/i.test(t)) { score -= 0.18; reasons.push('transient_chat'); }
  if (/https?:\/\/\S+/.test(t) && t.length < 140) { score -= 0.18; reasons.push('bare_link'); }
  if (containsSecretLike(t)) { score = 0; reasons.push('secret_like'); kind = 'blocked'; }
  return { score: Math.max(0, Math.min(1, score)), reasons, kind };
}
function buildWriteThroughMetadata(cfg: ReturnType<typeof resolveConfig>, ctx: any, text: string, dur: ReturnType<typeof durabilityScore>) {
  const project = detectProjectSlug(text);
  const tags = Array.from(new Set([...(cfg.writeTags || []), ...dur.reasons, ...(project ? [project] : [])]));
  let source = 'openclaw-agent-end';
  let topic: string | undefined;
  if (dur.kind === 'project_state') {
    source = 'curated-project-facts';
    topic = project ? `${project}-canonical-status` : 'canonical-project-status';
  } else if (dur.kind === 'preference') {
    source = 'curated-preferences-priorities';
    topic = 'preferences';
  } else if (dur.kind === 'decision') {
    source = 'curated-anti-drift';
    topic = project ? `${project}-durable-decision` : 'durable-decision';
  }
  return {
    channel: ctx?.channelId ?? 'unknown',
    sessionKey: ctx?.sessionKey ?? undefined,
    source,
    quality: 'curated',
    memory_kind: dur.kind,
    tags,
    project: project ?? undefined,
    topic,
    fact_key: topic ? `${project ?? 'global'}:${topic}` : undefined,
    memory_status: 'active',
    authority_rank: source.startsWith('curated-') ? 65 : 30,
    memory_schema_version: 'cortex.memory.governance.v1',
    correction_memory: /\bcorrection\s*:|\bcorrected\b|\bcurrent canonical status\b/i.test(text),
  };
}

async function maybeWriteCodecContinuity(api: OpenClawPluginApi, cfg: ReturnType<typeof resolveConfig>, event: any, ctx: any, fallbackText?: string) {
  if (cfg.enabledCodecContinuity === false) return true;
  const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '').trim();
  if (!sessionKey) return true;
  const text = [extractAssistantVisibleText(event?.messages), extractText(event?.result), String(fallbackText || '')]
    .filter(Boolean).join('\n').replace(/\s+/g, ' ').trim().slice(-2400);
  if (text.length < 20 || containsSecretLike(text)) return true;
  try {
    await postJson(cfg.baseUrl, cfg.codecEventsPath, {
      idempotency_key: ctx?.idempotencyKey,
      session_key: sessionKey,
      events: [{ text, tags: ['openclaw', 'session-continuity'], metadata: { source: 'cortex-memory-bridge', channel: ctx?.channelId ?? 'unknown' } }],
      max_chars: 1200,
    }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes);
    return true;
  } catch (error) {
    api.logger.warn?.(`cortex-memory-bridge: Codec continuity write failed: ${String(error)}`);
    return false;
  }
}
async function maybeWriteThrough(api: OpenClawPluginApi, cfg: ReturnType<typeof resolveConfig>, event: any, ctx: any, fallbackText?: string) {
  if (!cfg.enabledWriteThrough) return true;
  const text = [
    extractAssistantVisibleText(event?.messages),
    extractText(event?.result),
    String(fallbackText || ''),
  ].filter(Boolean).join('\n').replace(/\s+/g, ' ').trim();
  if (!text) {
    api.logger.info?.('cortex-memory-bridge: write-through skipped (no extractable text)');
    return true;
  }
  const recent = text.slice(-2000);
  const dur = durabilityScore(recent);
  if (dur.score < cfg.minDurabilityScore) {
    api.logger.info?.(`cortex-memory-bridge: write-through skipped (score=${dur.score.toFixed(2)} < min=${cfg.minDurabilityScore.toFixed(2)} reasons=${dur.reasons.join(',') || 'none'})`);
    return true;
  }
  const senderScoped = buildWriteThroughMetadata(cfg, ctx, recent, dur);
  try {
    await postJson(cfg.baseUrl, cfg.storePath, { type: 'memory', content: recent, tags: senderScoped.tags, metadata: senderScoped, idempotency_key: ctx?.idempotencyKey }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes);
    api.logger.info?.(`cortex-memory-bridge: stored durable memory candidate (${dur.kind}, score=${dur.score.toFixed(2)})`);
    return true;
  } catch (error) {
    api.logger.warn?.(`cortex-memory-bridge: write-through failed: ${String(error)}`);
    return false;
  }
}

const plugin = {
  id: 'cortex-memory-bridge',
  name: 'Cortex Memory Bridge',
  description: 'Bridge from OpenClaw memory_search into Cortex /knowledge/search with optional durable-memory write-through.',
  kind: 'memory',
  register(api: OpenClawPluginApi) {
    const recentOutputMaxChars = resolveConfig(api.pluginConfig).recentOutputMaxChars;
    const recentOutputBySession = new ExpiringLruMap<string>(RECENT_OUTPUT_MAX_ENTRIES, RECENT_OUTPUT_TTL_MS);
    const completed = new ExpiringLruSet(LIFECYCLE_DEDUP_MAX_ENTRIES, LIFECYCLE_DEDUP_TTL_MS);
    const inFlight = new Map<string, Promise<boolean>>();
    const makePersistenceKey = (session: string, event: any, ctx: any, fallback?: string) => {
      const identity = lifecycleIdentity(event, ctx);
      const payload = identity ? `lifecycle:${identity}` : `content:${String(fallback || '').slice(-recentOutputMaxChars)}`;
      return lifecyclePersistenceKey(session, payload);
    };
    const persistLifecycle = (persistenceKey: string, cfg: ReturnType<typeof resolveConfig>, event: any, ctx: any, fallbackText?: string) => {
      if (completed.has(persistenceKey)) return Promise.resolve(true);
      const existing = inFlight.get(persistenceKey);
      if (existing) return existing;
      if (inFlight.size >= cfg.lifecycleMaxInFlight) {
        api.logger.warn?.(`cortex-memory-bridge: lifecycle persistence rejected at in-flight capacity ${cfg.lifecycleMaxInFlight}`);
        return Promise.resolve(false);
      }
      const pending = (async () => {
        const writeThroughSucceeded = await maybeWriteThrough(api, cfg, event, { ...ctx, idempotencyKey: persistenceKey }, fallbackText);
        const codecSucceeded = await maybeWriteCodecContinuity(api, cfg, event, { ...ctx, idempotencyKey: persistenceKey }, fallbackText);
        const succeeded = writeThroughSucceeded && codecSucceeded;
        if (succeeded) completed.add(persistenceKey);
        return succeeded;
      })().finally(() => {
        inFlight.delete(persistenceKey);
      });
      inFlight.set(persistenceKey, pending);
      return pending;
    };

    api.registerMemoryRuntime({
      async getMemorySearchManager(params: { agentId: string }) {
        try {
          const mod = await import('./manager.mjs');
          const manager = await mod.CortexMemorySearchManager.create({
            cfg: (api.pluginConfig ?? {}) as Record<string, unknown>,
            agentId: params?.agentId ?? 'main',
          });
          return { manager };
        } catch (error) {
          return {
            manager: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      resolveMemoryBackendConfig() {
        return { backend: 'builtin' as const };
      },
      async closeAllMemorySearchManagers() {},
    });

    api.registerTool(() => ({
      label: 'Memory Search', name: 'memory_search', description: 'Search Cortex-backed memory over HTTP.', parameters: SearchSchema,
      execute: async (_toolCallId, params) => {
        const cfg = resolveConfig(api.pluginConfig);
        const query = String((params as { query: string }).query ?? '');
        const requestedMax = Number((params as { maxResults?: number }).maxResults ?? 5);
        const classification = classifyQuery(query);
        const recentSummaryQuery = classification.tags.includes('recent-summary');
        const fetchCount = classification.mode === 'investigate'
          ? Math.max(requestedMax, cfg.hardQueryCandidateCount)
          : recentSummaryQuery
            ? Math.max(requestedMax, Math.max(cfg.hardQueryCandidateCount, 20))
            : Math.max(requestedMax, 8);
        try {
          const response = await postJson(cfg.baseUrl, cfg.searchPath, { query, n_results: fetchCount }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes);
          let rawItems = Array.isArray(response?.results) ? response.results : [];
          if (recentSummaryQuery && !rawItems.some((item: any) => isRecentSummaryMemory((item?.metadata ?? {}) as Record<string, unknown>, String(item?.text ?? '')))) {
            const seen = new Set(rawItems.map((item: any) => String(item?.id ?? '')));
            for (const expandedQuery of [`recent status summary ${query}`.trim(), `question: ${query} answer:`.trim(), 'Cortex memory bridge repair completed']) {
              const expanded = await postJson(cfg.baseUrl, cfg.searchPath, { query: expandedQuery, n_results: fetchCount }, cfg.timeoutMs, cfg.retryCount, cfg.retryBackoffMs, cfg.maxResponseBytes);
              const extra = Array.isArray(expanded?.results) ? expanded.results : [];
              for (const item of extra) {
                const id = String(item?.id ?? '');
                if (id && seen.has(id)) continue;
                if (id) seen.add(id);
                rawItems.push(item);
              }
              if (rawItems.some((item: any) => isRecentSummaryMemory((item?.metadata ?? {}) as Record<string, unknown>, String(item?.text ?? '')))) break;
            }
          }
          const reconciled = reconcileResults(query, rawItems, cfg);
          let results = reconciled.results.slice(0, requestedMax);
          const minScore = typeof (params as { minScore?: number }).minScore === 'number' ? Number((params as { minScore?: number }).minScore) : null;
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
      const text = extractText(event);
      if (key && text) recentOutputBySession.set(key, text.slice(-recentOutputMaxChars));
    });

    api.on('subagent_ended', async (event: any, ctx: any) => {
      const cfg = resolveConfig(api.pluginConfig);
      const key = String(ctx?.sessionKey || ctx?.sessionId || '');
      const fallbackText = key ? recentOutputBySession.get(key) : undefined;
      if (String(api.pluginConfig?.debugShapes || '') === 'true') {
        api.logger.info?.(`cortex-memory-bridge: subagent_ended shape ${JSON.stringify({ key, fallbackLen: fallbackText?.length || 0, summary: summarizeShape(event) })}`);
      }
      const persistenceKey = makePersistenceKey(key, event, ctx, fallbackText || extractText(event?.result));
      await persistLifecycle(persistenceKey, cfg, { result: event?.result, messages: event?.messages }, ctx, fallbackText);
    });

    api.on('agent_end', async (event: any, ctx: any) => {
      const cfg = resolveConfig(api.pluginConfig);
      const key = String(ctx?.sessionKey || ctx?.sessionId || '');
      const fallbackText = key ? recentOutputBySession.get(key) : undefined;
      if (String(api.pluginConfig?.debugShapes || '') === 'true') {
        api.logger.info?.(`cortex-memory-bridge: agent_end shape ${JSON.stringify({ key, fallbackLen: fallbackText?.length || 0, summary: summarizeShape(event) })}`);
      }
      const persistenceKey = makePersistenceKey(key, event, ctx, fallbackText || extractText(event?.result));
      await persistLifecycle(persistenceKey, cfg, event, ctx, fallbackText);
      if (key) recentOutputBySession.delete(key);
    });
  },
};

export default plugin;
export { ExpiringLruMap, durabilityScore, buildWriteThroughMetadata, lifecyclePersistenceKey, reconcileResults };
