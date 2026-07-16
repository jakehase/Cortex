import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

type RouteLevel = { level: number; name?: string; reason?: string; method?: string; score?: number };
type LiveRouteLevel = RouteLevel & { always_on?: boolean };
type RoutePlan = {
  recommendedLevels: RouteLevel[];
  routingMethod?: string;
  reasoning?: string[];
  routingError?: string;
  routingMarkers?: Record<string, unknown>;
  workflowCheckpoint?: Record<string, unknown>;
};

type RouteStats = {
  version: number;
  updatedAt: string;
  byLevel: Record<string, { uses: number; successes: number; failures: number; score: number; lastReason?: string }>;
  byTask: Record<string, { uses: number; successes: number; failures: number }>;
};

type CapabilitySelfModel = {
  version?: number;
  generatedAt?: string;
  capabilities?: Record<string, { claimed?: boolean; implemented?: boolean; live?: boolean; verified?: boolean; observedAt?: string; evidence?: unknown[] }>;
  confidence?: Record<string, number>;
  degraded?: string[];
  recommendations?: string[];
};

type CreativityProfile = {
  requested: boolean;
  strictNovelty: boolean;
  signals: string[];
  explicitConstraints: string[];
  recentAnchorTerms: string[];
  quarantineTerms: string[];
  overlapTerms: string[];
  routeEnforced: boolean;
};

type PromptHistoryEntry = {
  createdAt: string;
  promptFingerprint: string;
  taskClass: string;
  tokens: string[];
};

type CreativityAudit = {
  auditedAt: string;
  passed: boolean;
  overlapTerms: string[];
  overlapRatio: number;
  itemCount: number;
  reasons: string[];
  retryRecommended: boolean;
};

type PendingCreativitySuppression = {
  deliveryKey: string;
  expectedOutputFingerprint: string;
  createdAt: number;
  retryPrompt: string;
  sessionKey: string;
};

type LastGoodRoutePlan = {
  savedAt: string;
  provenance: string;
  scopeTag: string;
  plan: RoutePlan;
  tag: string;
};

type PrincipalStatePaths = {
  scopeTag: string;
  root: string;
  stats: string;
  history: string;
  promptHistory: string;
  creativityRetry: string;
  creativityMetrics: string;
  lastGoodPlan: string;
};

const ALLOWED_CORTEX_LEVELS = new Set(Array.from({ length: 38 }, (_, index) => index + 1));
const ROUTE_PLAN_KEYS = new Set(['recommendedLevels', 'routingMethod', 'reasoning', 'routingError', 'routingMarkers', 'workflowCheckpoint']);
const ROUTE_LEVEL_KEYS = new Set(['level', 'name', 'reason', 'method', 'score']);
const LIVE_ROUTE_LEVEL_KEYS = new Set([...ROUTE_LEVEL_KEYS, 'always_on']);
const CHECKPOINT_KEYS = new Set(['checkpoint_id', 'state_machine', 'current_state', 'retry_policy', 'levels', 'durable_store']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
function isBoundedString(value: unknown, maxLength = 8_192, allowEmpty = true): value is string {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.length > 0);
}
function isJsonMetadata(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 16_384;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  if (depth >= 8) return false;
  if (Array.isArray(value)) return value.length <= 128 && value.every((item) => isJsonMetadata(item, depth + 1));
  if (!isRecord(value) || Object.keys(value).length > 128) return false;
  return Object.entries(value).every(([key, item]) => key.length <= 256 && isJsonMetadata(item, depth + 1));
}
function isWorkflowCheckpoint(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, CHECKPOINT_KEYS)) return false;
  if (!isBoundedString(value.checkpoint_id, 128, false)) return false;
  if (!Array.isArray(value.state_machine) || value.state_machine.length < 1 || value.state_machine.length > 32 || !value.state_machine.every((item) => isBoundedString(item, 128, false))) return false;
  if (!isBoundedString(value.current_state, 128, false) || !isBoundedString(value.durable_store, 4_096, false)) return false;
  if (!isRecord(value.retry_policy) || !hasOnlyKeys(value.retry_policy, new Set(['max_attempts', 'backoff_ms']))) return false;
  const maxAttempts = value.retry_policy.max_attempts;
  const backoffMs = value.retry_policy.backoff_ms;
  if (!Number.isInteger(maxAttempts) || (maxAttempts as number) < 0 || (maxAttempts as number) > 100) return false;
  if (!Number.isInteger(backoffMs) || (backoffMs as number) < 0 || (backoffMs as number) > 3_600_000) return false;
  return Array.isArray(value.levels) && value.levels.length <= 38
    && value.levels.every((level) => Number.isInteger(level) && ALLOWED_CORTEX_LEVELS.has(level as number));
}
function isRouteLevel(value: unknown): value is RouteLevel {
  if (!isRecord(value) || !hasOnlyKeys(value, ROUTE_LEVEL_KEYS)) return false;
  if (!Number.isInteger(value.level) || !ALLOWED_CORTEX_LEVELS.has(value.level as number)) return false;
  for (const field of ['name', 'reason', 'method'] as const) {
    if (value[field] !== undefined && !isBoundedString(value[field], 4_096)) return false;
  }
  return value.score === undefined || (typeof value.score === 'number' && Number.isFinite(value.score) && value.score >= 0 && value.score <= 1);
}
function isLiveRouteLevel(value: unknown): value is LiveRouteLevel {
  if (!isRecord(value) || !hasOnlyKeys(value, LIVE_ROUTE_LEVEL_KEYS)) return false;
  const { always_on: alwaysOn, ...routeLevel } = value;
  return (alwaysOn === undefined || typeof alwaysOn === 'boolean') && isRouteLevel(routeLevel);
}
function isRoutePlan(value: unknown): value is RoutePlan {
  if (!isRecord(value) || !hasOnlyKeys(value, ROUTE_PLAN_KEYS)) return false;
  if (!Array.isArray(value.recommendedLevels) || value.recommendedLevels.length < 1 || value.recommendedLevels.length > 64 || !value.recommendedLevels.every(isRouteLevel)) return false;
  if (value.routingMethod !== undefined && !isBoundedString(value.routingMethod, 1_024)) return false;
  if (value.routingError !== undefined && !isBoundedString(value.routingError, 8_192)) return false;
  if (value.reasoning !== undefined && (!Array.isArray(value.reasoning) || value.reasoning.length > 128 || !value.reasoning.every((item) => isBoundedString(item)))) return false;
  if (value.routingMarkers !== undefined && (!isRecord(value.routingMarkers) || !isJsonMetadata(value.routingMarkers))) return false;
  return value.workflowCheckpoint === undefined || isWorkflowCheckpoint(value.workflowCheckpoint);
}
function isLastGoodRoutePlan(value: unknown): value is LastGoodRoutePlan {
  return isRecord(value)
    && hasOnlyKeys(value, new Set(['savedAt', 'provenance', 'scopeTag', 'plan', 'tag']))
    && isBoundedString(value.savedAt, 64, false)
    && isBoundedString(value.provenance, 2_048, false)
    && typeof value.scopeTag === 'string'
    && /^[0-9a-f]{64}$/.test(value.scopeTag)
    && typeof value.tag === 'string'
    && /^[0-9a-f]{64}$/.test(value.tag)
    && isRoutePlan(value.plan);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function cachePayload(cache: Pick<LastGoodRoutePlan, 'savedAt' | 'provenance' | 'scopeTag' | 'plan'>): string {
  return canonicalJson({ savedAt: cache.savedAt, provenance: cache.provenance, scopeTag: cache.scopeTag, plan: cache.plan });
}

function signRouteCache(cache: Pick<LastGoodRoutePlan, 'savedAt' | 'provenance' | 'scopeTag' | 'plan'>, secret: string): string {
  return crypto.createHmac('sha256', secret).update(cachePayload(cache), 'utf8').digest('hex');
}

function verifyRouteCache(cache: unknown, secret: string | null): cache is LastGoodRoutePlan {
  if (!secret || !isLastGoodRoutePlan(cache)) return false;
  const supplied = Buffer.from(cache.tag, 'hex');
  const expected = Buffer.from(signRouteCache(cache, secret), 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function liveRouteLevels(value: unknown): LiveRouteLevel[] | null {
  if (!isRecord(value)) return null;
  const levels = value.recommended_levels ?? value.recommended;
  if (!Array.isArray(levels) || levels.length < 1 || levels.length > 64 || !levels.every(isLiveRouteLevel)) return null;
  if (value.routing_method !== undefined && !isBoundedString(value.routing_method, 1_024)) return null;
  if (value.reasoning !== undefined && (!Array.isArray(value.reasoning) || value.reasoning.length > 128 || !value.reasoning.every((item) => isBoundedString(item)))) return null;
  if (value.routing_markers !== undefined && (!isRecord(value.routing_markers) || !isJsonMetadata(value.routing_markers))) return null;
  if (value.workflow_checkpoint !== undefined && !isWorkflowCheckpoint(value.workflow_checkpoint)) return null;
  return levels;
}

type RunState = {
  prompt: string;
  promptFingerprint: string;
  plan: RoutePlan;
  taskClass: string;
  startedAt: number;
  toolCalls: { toolName: string; ok: boolean; durationMs?: number; error?: string }[];
  observedSignals: string[];
  selfModel?: CapabilitySelfModel;
  predictedChecks?: { capability: string; usable: boolean; confidence: number; rationale: string }[];
  creativity?: CreativityProfile;
  creativityAudit?: CreativityAudit;
  statePaths: PrincipalStatePaths;
};

function normalizeBaseUrl(value: unknown): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : 'http://127.0.0.1:8888';
  return text.endsWith('/') ? text.slice(0, -1) : text;
}
function normalizeWriteTokenHeader(value: unknown): string {
  if (value === undefined) return 'x-cortex-write-token';
  if (typeof value !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)) throw new Error('invalid Cortex write-token header name');
  return value.toLowerCase();
}
function asBool(value: unknown, fallback: boolean): boolean { return typeof value === 'boolean' ? value : fallback; }
function asNumber(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function nowIso(): string { return new Date().toISOString(); }

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','been','being','but','by','can','could','did','do','does','for','from','get','had','has','have','how','i','if','in','into','is','it','its','just','like','may','me','more','most','my','need','of','on','or','our','out','so','than','that','the','their','them','then','there','these','they','this','to','up','use','want','was','we','were','what','when','which','who','why','will','with','would','you','your'
]);

function uniqueStrings(items: string[]): string[] { return [...new Set(items.filter(Boolean))]; }
function extractContentTokens(text: string, limit = 16): string[] {
  const counts = new Map<string, number>();
  for (const token of normalizePrompt(text).split(' ')) {
    if (!token || token.length < 4) continue;
    if (STOP_WORDS.has(token)) continue;
    if (!/^[a-z][a-z0-9_-]+$/.test(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}
function detectCreativitySignals(prompt: string): string[] {
  const p = normalizePrompt(prompt);
  const signals: string[] = [];
  if (/\b(brainstorm|ideate|ideation|come up with|generate ideas|possibilities|concepts?)\b/.test(p)) signals.push('ideation');
  if (/\b(novel|novelty|original|invent|first to build|from scratch|new category|category defining)\b/.test(p)) signals.push('novelty');
  if (/\b(creative|creativity|wild|weird|blue sky|moonshot|surprising)\b/.test(p)) signals.push('divergence');
  if (/\b(orthogonal|not necessarily related|outside of|beyond|different direction|unrelated)\b/.test(p)) signals.push('distance');
  if (/\b(not .*memory|other than .*memory|didn.?t have to do with .*memory)\b/.test(p)) signals.push('negative_constraint');
  return uniqueStrings(signals);
}
function isCreativityPrompt(prompt: string): boolean {
  const p = normalizePrompt(prompt);
  const signals = detectCreativitySignals(prompt);
  if (!signals.length) return false;
  if (/\b(implement|fix|patch|edit|write tests?|code|plugin)\b/.test(p) && !/\b(brainstorm|idea|ideas|novel|novelty|orthogonal|original|from scratch|first to build|blue sky)\b/.test(p)) return false;
  return true;
}
function isStrictNoveltyPrompt(prompt: string): boolean {
  const p = normalizePrompt(prompt);
  return /\b(orthogonal|first to build|from scratch|not necessarily related|different direction|outside of|unrelated|blue sky|category defining)\b/.test(p) || /\b(not .*memory|other than .*memory|didn.?t have to do with .*memory)\b/.test(p);
}
function extractExplicitConstraintTerms(prompt: string): string[] {
  const out = new Set<string>();
  const p = normalizePrompt(prompt);
  const patterns = [
    /not(?: necessarily)?(?: related to| about| limited to| to do with)\s+([a-z0-9 -]{1,40})/g,
    /other than\s+([a-z0-9 -]{1,40})/g,
    /outside of\s+([a-z0-9 -]{1,40})/g,
    /beyond\s+([a-z0-9 -]{1,40})/g,
    /instead of\s+([a-z0-9 -]{1,40})/g,
    /didn.?t have to do with\s+([a-z0-9 -]{1,40})/g,
  ];
  for (const pattern of patterns) {
    for (const match of p.matchAll(pattern)) {
      for (const token of extractContentTokens(match[1] || '', 4)) out.add(token);
    }
  }
  if (/\bmemory\b/.test(p) && /\b(not|other than|outside of|beyond|instead of|didn)\b/.test(p)) out.add('memory');
  return [...out].slice(0, 8);
}
function recentAnchorTerms(entries: PromptHistoryEntry[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries.slice(-12)) {
    for (const token of entry.tokens || []) counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}
function flattenMessageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => flattenMessageText(item)).filter(Boolean).join(' ');
  if (!value || typeof value !== 'object') return '';
  const obj = value as Record<string, unknown>;
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.content === 'string') return obj.content;
  if (Array.isArray(obj.content)) return flattenMessageText(obj.content);
  if (typeof obj.body === 'string') return obj.body;
  if (typeof obj.message === 'string') return obj.message;
  return '';
}
function latestUserTurnText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (!item || typeof item !== 'object') continue;
    const role = String((item as any).role || '').toLowerCase();
    if (role !== 'user') continue;
    const text = flattenMessageText(item);
    if (text.trim()) return text.trim();
  }
  return '';
}
function tailIntentText(prompt: string): string {
  const tokens = normalizePrompt(prompt).split(' ').filter(Boolean);
  return tokens.slice(-48).join(' ').trim();
}
function isInternalOracleSession(sessionKey: string): boolean {
  const key = String(sessionKey || '').trim().toLowerCase();
  return key.startsWith('oracle-prod-bridge-short-')
    || key.startsWith('oracle-prod-bridge-general-')
    || key.startsWith('oracle-gateway-');
}
function shouldBypassRouteGate(sessionKey?: string): boolean {
  return isInternalOracleSession(String(sessionKey || ''));
}
function opaqueSessionIdentity(sessionKey: string, secret: string | null): string {
  const key = String(sessionKey || '').trim();
  if (!key) throw new Error('routing requires a non-empty trusted session identity');
  if (!secret) throw new Error('routing requires a keyed session identity secret');
  const digest = crypto.createHmac('sha256', secret).update(key, 'utf8').digest('hex');
  return `openclaw-${digest}`;
}
function buildCreativityProfile(intentText: string, priorPromptHistory: PromptHistoryEntry[], quarantineTermLimit: number, eligible = true): CreativityProfile {
  const focus = intentText.trim();
  const requested = eligible && isCreativityPrompt(focus);
  const strictNovelty = requested && isStrictNoveltyPrompt(focus);
  const signals = detectCreativitySignals(focus);
  const explicitConstraints = extractExplicitConstraintTerms(focus);
  const currentTokens = new Set(extractContentTokens(focus, quarantineTermLimit));
  const rawAnchors = requested ? recentAnchorTerms(priorPromptHistory, quarantineTermLimit) : [];
  const overlap = requested ? rawAnchors.filter((token) => currentTokens.has(token)).slice(0, quarantineTermLimit) : [];
  const anchors = requested ? rawAnchors.filter((token) => !currentTokens.has(token)) : [];
  const quarantineTerms = requested
    ? uniqueStrings([
        ...explicitConstraints,
        ...(strictNovelty ? anchors : anchors.slice(0, Math.min(4, quarantineTermLimit))),
      ]).slice(0, quarantineTermLimit)
    : [];
  return {
    requested,
    strictNovelty,
    signals,
    explicitConstraints,
    recentAnchorTerms: anchors,
    quarantineTerms,
    overlapTerms: overlap,
    routeEnforced: false,
  };
}
function ensureLevels(plan: RoutePlan, required: RouteLevel[]): RoutePlan {
  const existing = new Set(plan.recommendedLevels.map((x) => x.level));
  const merged = [...plan.recommendedLevels];
  for (const level of required) if (!existing.has(level.level)) merged.unshift(level);
  return { ...plan, recommendedLevels: uniqueLevels(merged) };
}

function countIdeaItems(text: string): number {
  const bulletMatches = text.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/g);
  if (bulletMatches?.length) return bulletMatches.length;
  const paragraphCount = text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).length;
  return Math.max(1, paragraphCount);
}
function auditCreativityOutput(output: string, creativity: CreativityProfile): CreativityAudit {
  const normalized = normalizePrompt(output);
  const distinctTerms = uniqueStrings([...creativity.quarantineTerms, ...creativity.recentAnchorTerms]).slice(0, 16);
  const overlapTerms = distinctTerms.filter((term) => normalized.includes(term));
  const overlapRatio = overlapTerms.length / Math.max(distinctTerms.length || 1, 1);
  const itemCount = countIdeaItems(output);
  const reasons: string[] = [];
  if (creativity.strictNovelty && overlapTerms.length >= 3) reasons.push('too_many_anchor_terms');
  if (creativity.strictNovelty && overlapRatio >= 0.34) reasons.push('anchor_overlap_ratio_high');
  if (creativity.signals.includes('ideation') && itemCount < 3) reasons.push('too_few_candidate_directions');
  const passed = reasons.length === 0;
  return {
    auditedAt: nowIso(),
    passed,
    overlapTerms,
    overlapRatio,
    itemCount,
    reasons,
    retryRecommended: !passed,
  };
}
function renderCreativityRetryBlock(audit?: CreativityAudit): string {
  if (!audit || !audit.retryRecommended) return '';
  return [
    'CORTEX_CREATIVITY_RETRY',
    'A previous creativity-targeted answer was judged too adjacent to recent context.',
    `audit_reasons: ${audit.reasons.join(', ') || 'none'}`,
    `audit_overlap_terms: ${audit.overlapTerms.join(', ') || 'none'}`,
    'retry_contract:',
    '- Increase conceptual distance from recent context.',
    '- Avoid the prior overlapping anchor terms unless strictly necessary.',
    '- Return at least 3 candidate directions before narrowing.',
    '- Lead with a wild-card or orthogonal option before any adjacent option.',
  ].join('\n');
}

function normalizePrompt(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9:/?._ -]+/g, ' ').trim();
}
function creativityOutputFingerprint(text: string): string {
  return normalizePrompt(text).replace(/\b\d+[.)]?\b/g, '#').trim();
}
function buildCreativityAutoRetryPrompt(audit: CreativityAudit): string {
  const overlapTerms = audit.overlapTerms.join(', ') || 'none';
  const reasons = audit.reasons.join(', ') || 'none';
  return [
    'Regenerate the previous answer now.',
    'This retry happens before delivery so only the improved answer should be shown.',
    `Prior audit reasons: ${reasons}.`,
    `Avoid these overlapping anchor terms unless absolutely necessary: ${overlapTerms}.`,
    'Requirements:',
    '- Increase conceptual distance from recent context.',
    '- Produce at least 3 candidate directions before narrowing.',
    '- Lead with a wild-card or orthogonal option before any adjacent option.',
    '- Do not apologize or explain the retry; just give the improved answer.',
  ].join('\n');
}
function fingerprintText(text: string): string {
  const normalized = normalizePrompt(text)
    .replace(/\b\d+\b/g, '#')
    .replace(/you are the host-side oracle executor for cortex\. return only the answer text that oracle should say\./g, '')
    .replace(/do not add labels confidence scores priorities disclaimers or meta-commentary\./g, '')
    .replace(/be concise but not shallow: answer the request directly with concrete substance\./g, '')
    .replace(/conversation info untrusted metadata : json /g, '')
    .replace(/sender untrusted metadata : json /g, '')
    .replace(/replied message untrusted for context : json /g, '')
    .replace(/openclaw runtime context internal : this context is runtime-generated not user-authored\. keep internal details private\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = normalized.split(' ').filter(Boolean);
  const head = tokens.slice(0, 12);
  const tail = tokens.slice(Math.max(12, tokens.length - 28));
  return [...head, ...tail].join(' ').trim();
}
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sa = new Set(a.split(' ').filter(Boolean));
  const sb = new Set(b.split(' ').filter(Boolean));
  let hit = 0;
  for (const token of sa) if (sb.has(token)) hit += 1;
  return hit / Math.max(sa.size, sb.size, 1);
}
function uniqueLevels(levels: RouteLevel[]): RouteLevel[] {
  const out: RouteLevel[] = [];
  const seen = new Set<number>();
  for (const item of levels) {
    const level = Number(item?.level || 0);
    if (!level || seen.has(level)) continue;
    seen.add(level);
    out.push({ level, name: item.name, reason: item.reason || item.method, method: item.method, score: item.score });
  }
  return out;
}

function normalizeLiveLevels(levels: RouteLevel[]): RouteLevel[] {
  const mandatory: RouteLevel[] = [
    { level: 24, name: 'Nexus', reason: 'mandatory upstream routing' },
    { level: 5, name: 'Oracle', reason: 'baseline reasoning' },
  ];
  const deduplicated = uniqueLevels(levels);
  const byLevel = new Map(deduplicated.map((item) => [item.level, item]));
  const nonMandatory = deduplicated.filter((item) => item.level !== 24 && item.level !== 5);
  return [byLevel.get(24) || mandatory[0], ...nonMandatory.slice(0, 62), byLevel.get(5) || mandatory[1]];
}
async function postJson(url: string, body: unknown, timeoutMs: number, maxResponseBytes = 1_048_576, writeHeaders: Record<string, string> = {}): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...writeHeaders }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxResponseBytes) {
      try { void res.body?.cancel().catch(() => {}); } catch {}
      throw new Error(`response exceeds ${maxResponseBytes} bytes`);
    }
    const reader = res.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxResponseBytes) { try { void reader.cancel().catch(() => {}); } catch {} throw new Error(`response exceeds ${maxResponseBytes} bytes`); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(bytes);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  } finally { clearTimeout(t); }
}
function hasLevel(plan: RoutePlan, level: number): boolean { return plan.recommendedLevels.some((x) => x.level === level); }
function classifyTask(prompt: string): string {
  const p = normalizePrompt(prompt);
  if (/\b(code|implement|fix|refactor|test|repo|plugin|typescript|python|bug)\b/.test(p)) return 'coding';
  if (/\b(research|source|evidence|compare|find out|current|news|browse|web)\b/.test(p)) return 'research';
  if (/\b(remember|memory|previous|prior|earlier|history|what did|decide|prefer)\b/.test(p)) return 'memory';
  if (/\b(design|architecture|plan|roadmap|system)\b/.test(p)) return 'design';
  return 'general';
}
function loadJson<T>(targetPath: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(targetPath, 'utf8')) as T; } catch { return fallback; }
}
type LockOwner = { version: 1; pid: number; startIdentity: string; token: string; createdAt: string };
type LockContender = LockOwner & { ticket: number | null };
const MALFORMED_LOCK_GRACE_MS = 30_000;
function processStartIdentity(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).split(' ');
    return fields[19] || null;
  } catch { return null; }
}
function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === 'EPERM'; }
}
function parseLockOwner(text: string): LockOwner | null {
  try {
    const value = JSON.parse(text);
    return isRecord(value) && value.version === 1 && Number.isInteger(value.pid) && (value.pid as number) > 0
      && isBoundedString(value.startIdentity, 256, false) && isBoundedString(value.token, 256, false)
      && isBoundedString(value.createdAt, 64, false) ? value as LockOwner : null;
  } catch {
    const [pidText, createdText] = text.trim().split(/\s+/);
    const pid = Number(pidText);
    return Number.isInteger(pid) && pid > 0 && Number.isFinite(Number(createdText))
      ? { version: 1, pid, startIdentity: '', token: `legacy:${pidText}:${createdText}`, createdAt: new Date(Number(createdText)).toISOString() }
      : null;
  }
}
function ownerIsDefinitelyStale(owner: LockOwner): boolean {
  if (!processIsAlive(owner.pid)) return true;
  if (!owner.startIdentity) return false;
  const actualIdentity = processStartIdentity(owner.pid);
  return actualIdentity !== null && actualIdentity !== owner.startIdentity;
}
function unlinkIfOwned(lock: string, token: string): boolean {
  try {
    const owner = parseLockOwner(fs.readFileSync(lock, 'utf8'));
    if (!owner || owner.token !== token) return false;
    fs.unlinkSync(lock);
    return true;
  } catch { return false; }
}
function malformedLockIsStale(lock: string): boolean {
  try {
    const first = fs.statSync(lock);
    if (Date.now() - first.mtimeMs < MALFORMED_LOCK_GRACE_MS) return false;
    if (parseLockOwner(fs.readFileSync(lock, 'utf8'))) return false;
    const second = fs.statSync(lock);
    return first.dev === second.dev && first.ino === second.ino
      && first.size === second.size && first.mtimeMs === second.mtimeMs;
  } catch { return false; }
}
function malformedContenderIsStale(entry: string): boolean {
  try {
    const first = fs.statSync(entry);
    if (Date.now() - first.mtimeMs < MALFORMED_LOCK_GRACE_MS) return false;
    const second = fs.statSync(entry);
    return first.dev === second.dev && first.ino === second.ino
      && first.size === second.size && first.mtimeMs === second.mtimeMs;
  } catch { return false; }
}
function createCompleteLock(lock: string): { fd: number; owner: LockOwner } {
  const owner: LockOwner = {
    version: 1,
    pid: process.pid,
    startIdentity: processStartIdentity(process.pid) || `runtime:${process.pid}`,
    token: crypto.randomBytes(24).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  const temporary = `${lock}.${process.pid}.${owner.token}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx');
    fs.writeFileSync(fd, JSON.stringify(owner));
    fs.fsyncSync(fd);
    // Publishing a hard link is exclusive and atomic: readers can only observe
    // either no lock or the complete, fsynced owner record.
    fs.linkSync(temporary, lock);
    // The temporary name is only cleanup after the lock has been published;
    // failure to remove that alias must not abandon the live lock.
    try { fs.unlinkSync(temporary); } catch {}
    return { fd, owner };
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}
function sleepForLock(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}
function publishContender(guard: string, contender: LockContender): string {
  const entry = path.join(guard, `${contender.pid}-${contender.token}`);
  const temporary = `${entry}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx');
    fs.writeFileSync(fd, JSON.stringify(contender));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, entry);
    return entry;
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}
function readContenders(guard: string): Array<{ path: string; owner: LockContender | null; staleMalformed: boolean }> {
  const result: Array<{ path: string; owner: LockContender | null; staleMalformed: boolean }> = [];
  for (const name of fs.readdirSync(guard)) {
    if (name.endsWith('.tmp')) continue;
    const entry = path.join(guard, name);
    let text = '';
    try { text = fs.readFileSync(entry, 'utf8'); } catch { continue; }
    const parsed = parseLockOwner(text) as LockContender | null;
    let ticket: unknown;
    try { const raw = JSON.parse(text); ticket = isRecord(raw) ? raw.ticket : undefined; } catch {}
    const owner = parsed && (ticket === null || (Number.isSafeInteger(ticket) && (ticket as number) > 0))
      ? { ...parsed, ticket: ticket as number | null } : null;
    result.push({
      path: entry,
      owner,
      staleMalformed: !owner && malformedContenderIsStale(entry),
    });
  }
  return result;
}
function acquireReclamationGuard(lock: string, deadline: number): { entry: string; owner: LockContender } {
  const guard = `${lock}.guard`;
  fs.mkdirSync(guard, { recursive: true });
  const base: LockContender = {
    version: 1,
    pid: process.pid,
    startIdentity: processStartIdentity(process.pid) || `runtime:${process.pid}`,
    token: crypto.randomBytes(24).toString('hex'),
    createdAt: new Date().toISOString(),
    ticket: null,
  };
  const entry = publishContender(guard, base);
  try {
    let maxTicket = 0;
    for (const contender of readContenders(guard)) {
      if (contender.path === entry) continue;
      if (contender.owner && ownerIsDefinitelyStale(contender.owner)) unlinkIfOwned(contender.path, contender.owner.token);
      else if (!contender.owner && contender.staleMalformed) try { fs.unlinkSync(contender.path); } catch {}
      else if (contender.owner?.ticket) maxTicket = Math.max(maxTicket, contender.owner.ticket);
    }
    const owner = { ...base, ticket: maxTicket + 1 };
    const replacement = `${entry}.ticket`;
    fs.writeFileSync(replacement, JSON.stringify(owner), { flag: 'wx' });
    fs.renameSync(replacement, entry);
    while (true) {
      let blocked = false;
      for (const contender of readContenders(guard)) {
        if (contender.path === entry) continue;
        if (contender.owner && ownerIsDefinitelyStale(contender.owner)) { unlinkIfOwned(contender.path, contender.owner.token); continue; }
        if (!contender.owner && contender.staleMalformed) { try { fs.unlinkSync(contender.path); } catch {}; continue; }
        if (!contender.owner || contender.owner.ticket === null
          || contender.owner.ticket < owner.ticket
          || (contender.owner.ticket === owner.ticket && contender.owner.token < owner.token)) blocked = true;
      }
      if (!blocked) return { entry, owner };
      if (Date.now() >= deadline) throw new Error(`timed out acquiring state lock ${lock}`);
      sleepForLock();
    }
  } catch (error) {
    unlinkIfOwned(entry, base.token);
    throw error;
  }
}
function withFileLock<T>(targetPath: string, transaction: () => T): T {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const lock = `${targetPath}.lock`;
  const deadline = Date.now() + 5_000;
  const guard = acquireReclamationGuard(lock, deadline);
  let lockFd: number | undefined;
  let owner: LockOwner | undefined;
  try { while (lockFd === undefined) {
    try {
      ({ fd: lockFd, owner } = createCompleteLock(lock));
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const existing = parseLockOwner(fs.readFileSync(lock, 'utf8'));
        if (existing && ownerIsDefinitelyStale(existing)) unlinkIfOwned(lock, existing.token);
        else if (!existing && malformedLockIsStale(lock)) fs.unlinkSync(lock);
      } catch {}
      if (Date.now() >= deadline) throw new Error(`timed out acquiring state lock ${lock}`);
      sleepForLock();
    }
  }
    return transaction();
  } finally {
    if (lockFd !== undefined) fs.closeSync(lockFd);
    if (owner) unlinkIfOwned(lock, owner.token);
    unlinkIfOwned(guard.entry, guard.owner.token);
  }
}

function reclaimWriteTemporaries(targetPath: string): void {
  const directory = path.dirname(targetPath);
  const basename = path.basename(targetPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const temporaryName = new RegExp(`^${basename}\\.\\d+\\.\\d+\\.tmp$`);
  const flags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
  let dirFd: number | undefined;
  try {
    const named = fs.lstatSync(directory);
    if (!named.isDirectory()) {
      throw new Error(`state directory changed while reclaiming temporary files for ${targetPath}`);
    }
    let opened = named;
    let reclamationDirectory = directory;
    try {
      dirFd = fs.openSync(directory, flags);
      opened = fs.fstatSync(dirFd);
      if (!opened.isDirectory() || opened.dev !== named.dev || opened.ino !== named.ino) {
        throw new Error(`state directory changed while reclaiming temporary files for ${targetPath}`);
      }
      const procDirectory = `/proc/self/fd/${dirFd}`;
      try {
        const procStat = fs.statSync(procDirectory);
        if (!procStat.isDirectory() || procStat.dev !== opened.dev || procStat.ino !== opened.ino) throw new Error('directory descriptor identity mismatch');
        reclamationDirectory = procDirectory;
      } catch (error: any) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
        // Non-Linux platforms do not expose directory descriptors through /proc.
      }
    } catch (error: any) {
      if (dirFd !== undefined || process.platform !== 'win32' || !['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP'].includes(error?.code)) throw error;
      // Windows cannot open a directory as a file descriptor. The named path
      // is revalidated before every deletion below.
    }
    for (const name of fs.readdirSync(reclamationDirectory)) {
      if (!temporaryName.test(name)) continue;
      if (reclamationDirectory === directory) {
        const current = fs.lstatSync(directory);
        if (!current.isDirectory() || current.dev !== opened.dev || current.ino !== opened.ino) {
          throw new Error(`state directory changed while reclaiming temporary files for ${targetPath}`);
        }
      }
      try { fs.unlinkSync(path.join(reclamationDirectory, name)); } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  } finally {
    if (dirFd !== undefined) fs.closeSync(dirFd);
  }
}

function writeJsonAtomic(targetPath: string, value: unknown) {
  reclaimWriteTemporaries(targetPath);
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, targetPath);
    if (process.platform !== 'win32') {
      const dirFd = fs.openSync(path.dirname(targetPath), 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function saveJson(targetPath: string, value: unknown) {
  withFileLock(targetPath, () => writeJsonAtomic(targetPath, value));
}
function updateJson<T, R>(targetPath: string, fallback: T, mutate: (value: T) => R): R {
  return withFileLock(targetPath, () => {
    const value = loadJson(targetPath, fallback);
    const result = mutate(value);
    writeJsonAtomic(targetPath, value);
    return result;
  });
}
function buildFailureModes(prompt: string, plan: RoutePlan): string[] {
  const task = classifyTask(prompt);
  const modes = [
    'Do not emit repeated near-identical chain summaries.',
    'Do not present reasoning guesses as observed facts.',
    'If uncertainty remains, state it once and move on.',
  ];
  if (task === 'coding') modes.push('Do not claim implementation complete without inspecting files and validating with tests or executable checks.');
  if (task === 'research') modes.push('Do not answer from memory when current sources or tool evidence are required.');
  if (task === 'memory' || hasLevel(plan, 22) || hasLevel(plan, 7)) modes.push('Do not answer memory/history questions without grounding in memory_search results when available.');
  if (hasLevel(plan, 34)) modes.push('Run a validator-style pass against task-specific failure modes before finalizing the answer.');
  return modes;
}
function loadStats(statsPath: string): RouteStats {
  try {
    const raw = JSON.parse(fs.readFileSync(statsPath, 'utf8')) as RouteStats;
    if (raw && raw.version === 1) return raw;
  } catch {}
  return { version: 1, updatedAt: nowIso(), byLevel: {}, byTask: {} };
}
function updateStats(statsPath: string, mutate: (stats: RouteStats) => void) {
  withFileLock(statsPath, () => {
    const stats = loadStats(statsPath);
    mutate(stats);
    writeJsonAtomic(statsPath, { ...stats, updatedAt: nowIso() });
  });
}
function scoreLevel(level: RouteLevel, stats: RouteStats, taskClass: string): number {
  const base = typeof level.score === 'number' ? level.score : 0.5;
  const hist = stats.byLevel[String(level.level)];
  const task = stats.byTask[taskClass];
  const histAdj = hist ? clamp((hist.successes - hist.failures) / Math.max(hist.uses, 3), -0.2, 0.2) : 0;
  const taskAdj = task ? clamp((task.successes - task.failures) / Math.max(task.uses, 4), -0.1, 0.1) : 0;
  return clamp(base + histAdj + taskAdj, 0, 1);
}
function prioritizePlan(plan: RoutePlan, stats: RouteStats, taskClass: string, maxLevels: number, creativity?: CreativityProfile): RoutePlan {
  const mandatory = new Set<number>([24, 5]);
  if (taskClass === 'coding') { mandatory.add(4); mandatory.add(27); mandatory.add(34); }
  if (taskClass === 'memory') mandatory.add(22);
  if (creativity?.requested) { mandatory.add(13); mandatory.add(29); mandatory.add(32); mandatory.add(34); }
  const withScores = uniqueLevels(plan.recommendedLevels).map((level) => {
    let score = scoreLevel(level, stats, taskClass);
    if (creativity?.requested && (level.level === 13 || level.level === 29 || level.level === 32)) score = clamp(score + 0.2, 0, 1);
    if (creativity?.strictNovelty && level.level === 34) score = clamp(score + 0.1, 0, 1);
    return { ...level, score };
  });
  const sorted = withScores.sort((a, b) => {
    const ma = mandatory.has(a.level) ? 1 : 0;
    const mb = mandatory.has(b.level) ? 1 : 0;
    return (mb - ma) || ((b.score || 0) - (a.score || 0)) || (a.level - b.level);
  });
  const chosen = sorted.filter((x, i) => i < maxLevels || mandatory.has(x.level));
  return { ...plan, recommendedLevels: uniqueLevels(chosen) };
}

function predictCapabilityUse(prompt: string, model: CapabilitySelfModel): { capability: string; usable: boolean; confidence: number; rationale: string }[] {
  const task = classifyTask(prompt);
  const checks: { capability: string; usable: boolean; confidence: number; rationale: string }[] = [];
  const degraded = new Set(model.degraded || []);
  const confidence = model.confidence || {};
  if (task === 'research') {
    const usable = !degraded.has('l2_browser_bridge') && (confidence.l2_browser_bridge ?? 0) >= 0.6;
    checks.push({ capability: 'l2_browser_bridge', usable, confidence: confidence.l2_browser_bridge ?? 0, rationale: usable ? 'Observed browser path appears healthy enough for primary use.' : 'Observed browser path is degraded or weakly verified; require fallback language.' });
  }
  if (task === 'memory') {
    const usable = !degraded.has('memory_write_through') && (confidence.memory_write_through ?? 0) >= 0.5;
    checks.push({ capability: 'memory_write_through', usable, confidence: confidence.memory_write_through ?? 0, rationale: usable ? 'Memory endpoint is live, but rely only with partial confidence.' : 'Memory path is degraded or not trustworthy enough for strong claims.' });
  }
  return checks;
}
function renderSelfModelBlock(model: CapabilitySelfModel, predicted: { capability: string; usable: boolean; confidence: number; rationale: string }[]): string {
  const degraded = (model.degraded || []).map((x) => `- ${x}`).join('\n') || '- none';
  const recs = (model.recommendations || []).slice(0, 5).map((x) => `- ${x}`).join('\n') || '- none';
  const preds = predicted.map((x) => `- ${x.capability}: usable=${x.usable} confidence=${x.confidence.toFixed(2)} rationale=${x.rationale}`).join('\n') || '- none';
  return [
    'CORTEX_SELF_MODEL',
    `generated_at: ${model.generatedAt || 'unknown'}`,
    'degraded_capabilities:',
    degraded,
    'counterfactual_pre_action_checks:',
    preds,
    'operational_recommendations:',
    recs,
  ].join('\n');
}
function renderExecutionContract(plan: RoutePlan, prompt: string): string {
  const lines = [
    'Execution contract for this turn:',
    '- Cortex-selected levels are operational instructions, not decorative metadata. Tool choice must follow them when a Cortex path exists.',
    '- Answer the user\'s actual request directly. Do not answer with meta-commentary about recursion, duplicate suppression, chain completions, stop conditions, or orchestration state.',
    '- If a prompt fragment or upstream trace mentions recursion control or deduplication, treat that as internal guidance only and do not repeat it to the user.',
  ];
  const l2 = hasLevel(plan, 2);
  const l4 = hasLevel(plan, 4);
  const l7 = hasLevel(plan, 7);
  const l22 = hasLevel(plan, 22);
  const l34 = hasLevel(plan, 34);
  if (l2) lines.push('- L2 Ghost present: for web/current-events/research/browsing tasks, use Cortex browsing first before generic web_search/web_fetch. Only fall back after a concrete Cortex browser failure and say so explicitly.');
  if (l7 || l22) lines.push('- L7/L22 present: for prior work, memory, past decisions, dates, people, preferences, or durable context, use Cortex-backed memory_search first before generic filesystem/history search.');
  if (l2 && (l7 || l22) && l34) lines.push('- Research chain present: default order is L2 browse/discover → L7/L22 retrieve/contextualize → L34 validate → then answer.');
  if (l4) lines.push('- L4 Lab present: for code/repo tasks, inspect the workspace and validate changes with tools/tests before concluding.');
  lines.push('- Give one normal user-facing answer, not a self-referential synthesis report, unless the user explicitly asks for a structured report.');
  lines.push('- Treat tool outputs as observed evidence; clearly separate observed facts from inference.');
  for (const mode of buildFailureModes(prompt, plan)) lines.push(`- Failure mode guard: ${mode}`);
  lines.push('- Do not let generic tool availability override Cortex-first routing unless the Cortex path is missing or broken and that failure is made explicit.');
  return lines.join('\n');
}
function renderGovernorBlock(plan: RoutePlan, prompt: string, duplicateRisk: boolean, budget: { maxReasoningPasses: number; maxToolRounds: number }, creativity?: CreativityProfile): string {
  const markers = duplicateRisk ? 'duplicate_chain_risk=true' : 'duplicate_chain_risk=false';
  return [
    'CORTEX_EXECUTION_GOVERNOR',
    `task_class: ${classifyTask(prompt)}`,
    `governor_markers: ${markers}${creativity?.requested ? ', creativity_mode=true' : ''}`,
    `reasoning_budget.max_passes: ${budget.maxReasoningPasses}`,
    `reasoning_budget.max_tool_rounds: ${budget.maxToolRounds}`,
    'answer_contract:',
    '- Return a normal answer to the user\'s request.',
    '- Keep internal orchestration language out of the final reply.',
    '- If uncertainty matters, include it briefly and concretely.',
    'duplicate_suppression:',
    '- Avoid repeating near-identical drafts internally.',
    '- Do not mention duplicate suppression or loop control in the final answer.',
  ].join('\n');
}
function renderCreativityGovernorBlock(creativity: CreativityProfile): string {
  if (!creativity.requested) return '';
  return [
    'CORTEX_CREATIVITY_GOVERNOR',
    `mode: ${creativity.strictNovelty ? 'strict_novelty' : 'novelty'}`,
    `signals: ${creativity.signals.join(', ') || 'none'}`,
    `route_enforced: ${creativity.routeEnforced}`,
    `recent_anchor_overlap: ${creativity.overlapTerms.join(', ') || 'none'}`,
    'explicit_constraints:',
    ...(creativity.explicitConstraints.length ? creativity.explicitConstraints.map((term) => `- ${term}`) : ['- none']),
    'context_quarantine:',
    ...(creativity.quarantineTerms.length ? creativity.quarantineTerms.map((term) => `- ${term}`) : ['- none']),
    'distance_contract:',
    '- First generate at least 3 candidate directions that avoid the quarantined terms.',
    '- Do not let the lead idea be a near-neighbor of the last few turns.',
    '- If novelty/originality was requested, lead with Orthogonal or Wild-card before Adjacent.',
    '- Only reuse recent project nouns after presenting at least one genuinely different direction.',
    'muse_dreamer_contract:',
    '- Dreamer: generate high-variance, cross-domain candidates.',
    '- Muse: rename/reframe survivors into elegant, surprising forms.',
    '- Synthesist: pick the strongest non-obvious direction and explain why.',
    'anti_anchor_checks:',
    '- If the answer could have been produced by simply continuing the previous thread, regenerate once with higher conceptual distance.',
    '- If the lead option reuses more than two quarantined terms, regenerate.',
    '- Do not quietly collapse all buckets into adjacent ideas.',
  ].join('\n');
}
function renderPlan(plan: RoutePlan, prompt: string, duplicateRisk: boolean, creativity?: CreativityProfile, retryAudit?: CreativityAudit): string {
  const levels = plan.recommendedLevels.map((x) => `- L${x.level}${x.name ? ` ${x.name}` : ''}${x.reason ? ` — ${x.reason}` : ''}${typeof x.score === 'number' ? ` [score=${x.score.toFixed(2)}]` : ''}`).join('\n');
  const reasoning = (plan.reasoning || []).slice(0, 8).map((x) => `- ${x}`).join('\n');
  const budget = { maxReasoningPasses: duplicateRisk ? 2 : 3, maxToolRounds: classifyTask(prompt) === 'coding' ? 5 : 3 };
  return [
    'CORTEX_ROUTE_GATE',
    `routing_method: ${plan.routingMethod || 'nexus_orchestration'}`,
    'Before answering, apply the following Cortex-selected levels for this turn:',
    levels || '- L24 Nexus\n- L5 Oracle',
    reasoning ? `routing_reasoning:\n${reasoning}` : '',
    renderExecutionContract(plan, prompt),
    renderGovernorBlock(plan, prompt, duplicateRisk, budget, creativity),
    renderCreativityGovernorBlock(creativity || { requested: false, strictNovelty: false, signals: [], explicitConstraints: [], recentAnchorTerms: [], quarantineTerms: [], overlapTerms: [], routeEnforced: false }),
    renderCreativityRetryBlock(retryAudit),
    'Identity/architecture contract for this turn:',
    '- Cortex is the primary mind for reasoning, memory, and routing.',
    '- OpenClaw is the mediation/runtime layer and should not override Cortex identity or intent.',
    '- If asked who you are, answer from Cortex identity first, not generic assistant/OpenClaw identity.',
    '- Preserve quality and naturalness; do not force a repetitive opener unless the prompt calls for identity clarification.',
    'This routing decision was made upstream by Cortex and is mandatory context for this turn.'
  ].filter(Boolean).join('\n');
}

export default function register(api: any) {
  const cfg = api.pluginConfig || api.config || {};
  if (!asBool(cfg.enabled, true)) return;

  const sessionIdentityHmacSecret = typeof cfg.sessionIdentityHmacSecret === 'string' && cfg.sessionIdentityHmacSecret.trim().length > 0
    ? String(cfg.sessionIdentityHmacSecret)
    : null;
  if (!sessionIdentityHmacSecret) {
    throw new Error('cortex-route-gate requires an explicitly provisioned keyed session identity secret (sessionIdentityHmacSecret) shared with cortex-memory-bridge');
  }

  const baseUrl = normalizeBaseUrl(cfg.baseUrl);
  const requireRouting = asBool(cfg.requireRouting, true);
  const timeoutMs = asNumber(cfg.timeoutMs, 8000);
  const maxResponseBytes = asNumber(cfg.maxResponseBytes, 1_048_576);
  const maxRoutingPromptBytes = asNumber(cfg.maxRoutingPromptBytes, 262_144);
  const writeToken = typeof cfg.writeToken === 'string' && cfg.writeToken.length > 0 ? String(cfg.writeToken) : null;
  const writeTokenHeader = normalizeWriteTokenHeader(cfg.writeTokenHeader);
  const writeHeaders = writeToken ? { [writeTokenHeader]: writeToken } : {};
  const configuredTenantId = typeof cfg.tenantId === 'string' && cfg.tenantId.trim() ? cfg.tenantId.trim() : '';
  const configuredWorkspaceId = typeof cfg.workspaceId === 'string' && cfg.workspaceId.trim() ? cfg.workspaceId.trim() : '';
  const scopeCredentialId = typeof cfg.scopeCredentialId === 'string' ? cfg.scopeCredentialId.trim() : '';
  const scopeHmacSecret = typeof cfg.scopeHmacSecret === 'string' ? String(cfg.scopeHmacSecret) : '';
  const hasScopeCredentialId = scopeCredentialId.length > 0;
  const hasScopeHmacSecret = scopeHmacSecret.trim().length > 0;
  const allowUnsignedLocalDevelopment = cfg.allowUnsignedLocalDevelopment === true;
  // Tenant/workspace are instance configuration, while agent/user/channel and
  // session are per-callback identities. Local instance defaults remain valid.
  const tenantId = configuredTenantId || 'cortex-local';
  const workspaceId = configuredWorkspaceId || 'default';
  const boundedOpaqueId = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
  if (hasScopeCredentialId !== hasScopeHmacSecret) {
    throw new Error('cortex-route-gate requires scopeCredentialId and scopeHmacSecret together');
  }
  if (hasScopeCredentialId && !boundedOpaqueId.test(scopeCredentialId)) {
    throw new Error('cortex-route-gate scopeCredentialId must be a bounded opaque identifier');
  }
  if (!hasScopeCredentialId) {
    if (!allowUnsignedLocalDevelopment) {
      throw new Error('cortex-route-gate requires scopeCredentialId and scopeHmacSecret unless allowUnsignedLocalDevelopment is explicitly enabled');
    }
    if (tenantId !== 'cortex-local' || workspaceId !== 'default') {
      throw new Error('cortex-route-gate allowUnsignedLocalDevelopment is restricted to the cortex-local/default scope');
    }
  }
  if (!writeToken && !allowUnsignedLocalDevelopment) {
    throw new Error('cortex-route-gate requires writeToken outside explicit unsigned local development');
  }
  const maxCachedPlanAgeMs = asNumber(cfg.maxCachedPlanAgeMs, 300_000);
  // Capture once at construction so later mutation of the caller-owned config cannot change trust.
  const routeCacheHmacSecret = typeof cfg.routeCacheHmacSecret === 'string' && cfg.routeCacheHmacSecret.length > 0
    ? String(cfg.routeCacheHmacSecret)
    : null;
  const maxLevels = asNumber(cfg.maxLevels, 10);
  const creativityGovernorEnabled = asBool(cfg.creativityGovernorEnabled, true);
  const creativityHistorySize = asNumber(cfg.creativityHistorySize, 24);
  const creativityQuarantineTerms = asNumber(cfg.creativityQuarantineTerms, 8);
  const creativityAuditEnabled = asBool(cfg.creativityAuditEnabled, true);
  const creativityAuditOverlapThreshold = asNumber(cfg.creativityAuditOverlapThreshold, 0.34);
  const oracleSessionQuarantineEnabled = asBool(cfg.oracleSessionQuarantineEnabled, false);
  const oracleSessionResetBytes = asNumber(cfg.oracleSessionResetBytes, 500_000);
  const oracleSessionDir = typeof cfg.oracleSessionDir === 'string' && cfg.oracleSessionDir.trim()
    ? cfg.oracleSessionDir.trim()
    : path.join(process.env.HOME || '/root', '.openclaw', 'agents', 'main', 'sessions');
  const stateDir = typeof cfg.stateDir === 'string' && cfg.stateDir.trim() ? cfg.stateDir.trim() : path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw'), 'cortex-route-gate');
  const selfModelPath = path.join('/root/clawd/state', 'cortex-self-model.json');
  const contradictionPath = path.join('/root/clawd/state', 'cortex-contradictions.json');
  const runStateByKey = new Map<string, RunState>();
  const pendingCreativitySuppressions = new Map<string, PendingCreativitySuppression>();

  function principalState(ctx: any, rawSessionKey: string): { scope: Record<string, string>; sessionIdentity: string; statePaths: PrincipalStatePaths; stateKey: string } {
    if (!rawSessionKey.trim()) throw new Error('routing requires a non-empty trusted session identity from the callback');
    const sessionIdentity = opaqueSessionIdentity(rawSessionKey, sessionIdentityHmacSecret);
    const scope = {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      agent_id: String(ctx?.agentId || '').trim(),
      user_id: String(ctx?.userId || ctx?.requesterSenderId || '').trim(),
      channel_id: String(ctx?.channelId || ctx?.messageChannel || '').trim(),
      session_id: sessionIdentity,
    };
    if (Object.values(scope).some((value) => !boundedOpaqueId.test(value))) {
      throw new Error('routing requires a complete bounded trusted Cortex principal');
    }
    const canonicalScope = [scope.tenant_id, scope.workspace_id, scope.agent_id, scope.user_id, scope.channel_id, scope.session_id].join('\n');
    const scopeTag = crypto.createHmac('sha256', sessionIdentityHmacSecret).update(`cortex.route-gate.state.v1\n${canonicalScope}`, 'utf8').digest('hex');
    const root = path.join(stateDir, 'principals', scopeTag);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const statePaths: PrincipalStatePaths = {
      scopeTag,
      root,
      stats: path.join(root, 'adaptive-routing-stats.json'),
      history: path.join(root, 'prompt-fingerprints.json'),
      promptHistory: path.join(root, 'prompt-history.json'),
      creativityRetry: path.join(root, 'creativity-retry.json'),
      creativityMetrics: path.join(root, 'creativity-metrics.json'),
      lastGoodPlan: path.join(root, 'last-good-plan.json'),
    };
    return { scope, sessionIdentity, statePaths, stateKey: scopeTag };
  }

  function nexusPrincipalHeaders(scope: Record<string, string>, sessionIdentity: string): Record<string, string> {
    const headers: Record<string, string> = {
      ...writeHeaders,
      'x-session-id': sessionIdentity,
      'x-cortex-tenant-id': scope.tenant_id,
      'x-cortex-workspace-id': scope.workspace_id,
      'x-cortex-agent-id': scope.agent_id,
      'x-cortex-user-id': scope.user_id,
      'x-cortex-channel-id': scope.channel_id,
      'x-cortex-session-id': scope.session_id,
    };
    if (scopeCredentialId && scopeHmacSecret) {
      if (!boundedOpaqueId.test(scopeCredentialId)) throw new Error('routing scope credential ID is invalid');
      headers['x-cortex-scope-credential-id'] = scopeCredentialId;
      headers['x-cortex-scope-signature'] = crypto.createHmac('sha256', scopeHmacSecret)
        .update([
          'cortex.memory.principal.v2',
          scopeCredentialId,
          scope.tenant_id,
          scope.workspace_id,
          scope.agent_id,
          scope.user_id,
          scope.channel_id,
          scope.session_id,
        ].join('\n'), 'utf8')
        .digest('hex');
    }
    return headers;
  }

  // Legacy unscoped files are never consumed. Move them aside so an upgrade
  // cannot silently reuse cross-principal history or route plans.
  for (const legacyName of ['adaptive-routing-stats.json', 'prompt-fingerprints.json', 'prompt-history.json', 'creativity-retry.json', 'creativity-metrics.json', 'last-good-plan.json']) {
    const legacyPath = path.join(stateDir, legacyName);
    if (!fs.existsSync(legacyPath)) continue;
    const quarantine = path.join(stateDir, 'quarantine', 'legacy-global');
    fs.mkdirSync(quarantine, { recursive: true, mode: 0o700 });
    fs.renameSync(legacyPath, path.join(quarantine, `${Date.now()}-${legacyName}`));
  }

  function archiveOversizedOracleSessions() {
    if (!oracleSessionQuarantineEnabled || !oracleSessionResetBytes || oracleSessionResetBytes < 1024) return;
    try {
      const entries = fs.readdirSync(oracleSessionDir, { withFileTypes: true });
      const quarantineDir = path.join(oracleSessionDir, 'quarantine');
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const sessionName = entry.name.replace(/\.jsonl$/i, '');
        if (!isInternalOracleSession(sessionName)) continue;
        const filePath = path.join(oracleSessionDir, entry.name);
        const stat = fs.statSync(filePath);
        if (stat.size <= oracleSessionResetBytes) continue;
        fs.mkdirSync(quarantineDir, { recursive: true });
        const targetPath = path.join(quarantineDir, `${sessionName}.${Math.trunc(stat.mtimeMs)}.${stat.size}.jsonl`);
        if (fs.existsSync(targetPath)) continue;
        fs.copyFileSync(filePath, targetPath, fs.constants.COPYFILE_EXCL);
        const targetFd = fs.openSync(targetPath, 'r');
        try { fs.fsyncSync(targetFd); } finally { fs.closeSync(targetFd); }
        api.logger.warn?.(`cortex-route-gate: archived oversized oracle session without moving the active file ${entry.name} size=${stat.size}`);
      }
    } catch (error) {
      api.logger.warn?.(`cortex-route-gate: failed to quarantine oversized oracle sessions: ${String(error)}`);
    }
  }

  archiveOversizedOracleSessions();

  function loadPromptHistory(promptHistoryPath: string): PromptHistoryEntry[] {
    try {
      const raw = JSON.parse(fs.readFileSync(promptHistoryPath, 'utf8'));
      return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') as PromptHistoryEntry[] : [];
    } catch { return []; }
  }
  function updateCreativityMetrics(creativityMetricsPath: string, mutate: (metrics: any) => void) {
    updateJson(creativityMetricsPath, { version: 1, updatedAt: nowIso(), counters: { audited: 0, failed: 0, retryInjected: 0 } }, (metrics: any) => {
      mutate(metrics);
      metrics.updatedAt = nowIso();
    });
  }
  function extractDeliveryKeyFromSessionKey(sessionKey: string): string | undefined {
    const match = /^agent:[^:]+:([^:]+):direct:(.+)$/.exec(sessionKey);
    if (!match) return undefined;
    const channel = String(match[1] || '').trim();
    const to = String(match[2] || '').trim();
    if (!channel || !to) return undefined;
    return `${channel}:default:${to}`;
  }
  function cleanupPendingCreativitySuppressions(nowMs = Date.now()) {
    for (const [key, value] of pendingCreativitySuppressions.entries()) {
      if (nowMs - value.createdAt > 2 * 60 * 1000) pendingCreativitySuppressions.delete(key);
    }
  }

  function stateKeyForContext(ctx: any): string {
    try {
      return principalState(ctx, String(ctx?.sessionKey || ctx?.sessionId || '')).stateKey;
    } catch {
      return '';
    }
  }

  function scopedDeliveryKey(value: string, stateKey: string): string {
    return crypto.createHmac('sha256', sessionIdentityHmacSecret)
      .update(`cortex.route-gate.delivery.v1\n${stateKey}\n${value}`, 'utf8')
      .digest('hex');
  }

  async function getPlan(prompt: string, messages: unknown[], sessionKey: string | undefined, trustedContext: any): Promise<{ plan: RoutePlan; duplicateRisk: boolean; taskClass: string; selfModel: CapabilitySelfModel; predictedChecks: { capability: string; usable: boolean; confidence: number; rationale: string }[]; creativity: CreativityProfile; intentText: string; statePaths: PrincipalStatePaths; stateKey: string }> {
    const principal = principalState(trustedContext, String(sessionKey || ''));
    const { statePaths } = principal;
    let plan: RoutePlan | null = null;
    try {
      if (Buffer.byteLength(prompt, 'utf8') > maxRoutingPromptBytes) {
        throw new Error(`routing prompt exceeds ${maxRoutingPromptBytes} bytes`);
      }
      const data = await postJson(
        `${baseUrl}/nexus/orchestrate`,
        { query: prompt },
        timeoutMs,
        maxResponseBytes,
        nexusPrincipalHeaders(principal.scope, principal.sessionIdentity),
      );
      const recommended = liveRouteLevels(data);
      if (!recommended) throw new Error('invalid live route response schema');
      const rawPlan: RoutePlan = {
        recommendedLevels: normalizeLiveLevels(recommended),
        routingMethod: data.routing_method,
        reasoning: data.reasoning,
        routingMarkers: data.routing_markers,
        workflowCheckpoint: data.workflow_checkpoint,
      };
      if (!isRoutePlan(rawPlan)) throw new Error('invalid normalized live route plan');
      plan = {
        recommendedLevels: rawPlan.recommendedLevels,
        routingMethod: rawPlan.routingMethod || 'nexus_orchestration',
        reasoning: rawPlan.reasoning || [],
        routingMarkers: rawPlan.routingMarkers,
        workflowCheckpoint: rawPlan.workflowCheckpoint,
      };
      if (!isRoutePlan(plan)) throw new Error('invalid defaulted live route plan');
      if (routeCacheHmacSecret) {
        const cache = { savedAt: nowIso(), provenance: baseUrl, scopeTag: statePaths.scopeTag, plan };
        const signedCache = { ...cache, tag: signRouteCache(cache, routeCacheHmacSecret) } satisfies LastGoodRoutePlan;
        try {
          saveJson(statePaths.lastGoodPlan, signedCache);
        } catch (error) {
          api.logger.warn?.(`cortex-route-gate: failed to persist last-good route plan: ${String(error)}`);
        }
      }
    } catch (error) {
      const message = `cortex-route-gate: routing failed for prompt: ${String(error)}`;
      api.logger.warn(message);
      const lastGoodPlan = loadJson<LastGoodRoutePlan | null>(statePaths.lastGoodPlan, null);
      const savedAtMs = Date.parse(lastGoodPlan?.savedAt || '');
      const cachedAgeMs = Date.now() - savedAtMs;
      const validCache = !requireRouting && verifyRouteCache(lastGoodPlan, routeCacheHmacSecret) && lastGoodPlan.provenance === baseUrl && lastGoodPlan.scopeTag === statePaths.scopeTag && Number.isFinite(savedAtMs) && cachedAgeMs >= 0 && cachedAgeMs <= maxCachedPlanAgeMs;
      if (validCache && lastGoodPlan) {
        api.logger.warn(`cortex-route-gate: using cached last-good plan from ${lastGoodPlan.savedAt || 'unknown'} after routing failure${requireRouting ? ' (requireRouting preserved via stale fallback)' : ''}`);
        plan = {
          ...lastGoodPlan.plan,
          routingMethod: 'cached_fallback',
          routingError: String(error),
          reasoning: [
            `Cortex routing failed, using cached last-good route plan from ${lastGoodPlan.savedAt || 'unknown'}.`,
            ...(lastGoodPlan.plan.reasoning || []),
          ],
          routingMarkers: {
            ...(lastGoodPlan.plan.routingMarkers || {}),
            degraded: true,
            cachedFallback: true,
            requireRouting,
            cachedPlanSavedAt: lastGoodPlan.savedAt || null,
            cachedPlanAgeMs: Number.isFinite(cachedAgeMs) ? cachedAgeMs : null,
          },
        };
      } else {
        if (requireRouting) throw new Error(`routing unavailable while requireRouting is enabled: ${String(error)}`);
        throw new Error(`routing unavailable and no valid last-good route plan exists: ${String(error)}`);
      }
    }
    const intentText = latestUserTurnText(messages) || tailIntentText(prompt);
    const creativityEligible = Boolean(latestUserTurnText(messages)) && !(sessionKey || '').includes(':cron:');
    const taskClass = classifyTask(intentText || prompt);
    const stats = loadStats(statePaths.stats);
    const selfModel = loadJson<CapabilitySelfModel>(selfModelPath, { version: 1, capabilities: {}, confidence: {}, degraded: [], recommendations: [] });
    const predictedChecks = predictCapabilityUse(intentText || prompt, selfModel);
    const priorPromptHistory = loadPromptHistory(statePaths.promptHistory);
    let creativity: CreativityProfile = creativityGovernorEnabled ? buildCreativityProfile(intentText, priorPromptHistory, creativityQuarantineTerms, creativityEligible) : { requested: false, strictNovelty: false, signals: [], explicitConstraints: [], recentAnchorTerms: [], quarantineTerms: [], overlapTerms: [], routeEnforced: false };
    let routedPlan = plan!;
    if (creativity.requested) {
      const creativeLevels: RouteLevel[] = [
        { level: 13, name: 'Dreamer', reason: 'creativity_governor' },
        { level: 29, name: 'Muse', reason: 'creativity_governor' },
        { level: 32, name: 'Synthesist', reason: 'creativity_governor' },
        { level: 34, name: 'Validator', reason: 'creativity_governor' },
      ];
      creativity = { ...creativity, routeEnforced: !creativeLevels.every((level) => hasLevel(routedPlan, level.level)) };
      routedPlan = ensureLevels(routedPlan, creativeLevels);
    }
    const prioritized = prioritizePlan(routedPlan, stats, taskClass, maxLevels, creativity);
    const fingerprint = fingerprintText(prompt);
    const duplicateRisk = updateJson(statePaths.history, [] as string[], (history) => {
      const duplicate = history.some((x) => similarity(x, fingerprint) >= 0.9);
      history.push(fingerprint);
      const compact: string[] = [];
      for (const item of history.slice(-200)) {
        if (!item) continue;
        if (compact.some((existing) => similarity(existing, item) >= 0.92)) continue;
        compact.push(item);
      }
      history.splice(0, history.length, ...compact.slice(-100));
      return duplicate;
    });
    updateJson(statePaths.promptHistory, [] as PromptHistoryEntry[], (history) => {
      history.push({ createdAt: nowIso(), promptFingerprint: fingerprint, taskClass, tokens: extractContentTokens(intentText || prompt, creativityQuarantineTerms) });
      history.splice(0, Math.max(0, history.length - creativityHistorySize));
    });
    return { plan: prioritized, duplicateRisk, taskClass, selfModel, predictedChecks, creativity, intentText, statePaths, stateKey: principal.stateKey };
  }

  api.on('before_prompt_build', async (event: any, ctx: any) => {
    const prompt = typeof event?.prompt === 'string' ? event.prompt.trim() : '';
    if (!prompt) return;
    const rawSessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
    if (shouldBypassRouteGate(rawSessionKey)) {
      const bypassStateKey = stateKeyForContext(ctx);
      if (bypassStateKey) runStateByKey.delete(bypassStateKey);
      api.logger.info?.(`cortex-route-gate: bypassed internal oracle session=${rawSessionKey || 'unknown'}`);
      return;
    }
    let route;
    try {
      route = await getPlan(prompt, Array.isArray(event?.messages) ? event.messages : [], rawSessionKey, ctx);
    } catch (error) {
      if (requireRouting) throw error;
      api.logger.warn?.(`cortex-route-gate: optional routing skipped: ${String(error)}`);
      return;
    }
    const { plan, duplicateRisk, taskClass, selfModel, predictedChecks, creativity, intentText, statePaths, stateKey } = route;
    const retryAudit = stateKey && creativity.requested
      ? updateJson(statePaths.creativityRetry, {} as Record<string, CreativityAudit>, (state) => {
          const audit = state[rawSessionKey];
          if (audit) delete state[rawSessionKey];
          return audit;
        })
      : undefined;
    if (stateKey) {
      runStateByKey.set(stateKey, {
        prompt,
        promptFingerprint: fingerprintText(prompt),
        plan,
        taskClass,
        startedAt: Date.now(),
        toolCalls: [],
        observedSignals: [],
        selfModel,
        predictedChecks,
        creativity,
        creativityAudit: retryAudit,
        statePaths,
      });
    }
    if (stateKey && retryAudit && creativity.requested) updateCreativityMetrics(statePaths.creativityMetrics, (metrics) => { metrics.counters.retryInjected = Number(metrics.counters.retryInjected || 0) + 1; });
    api.logger.info?.(`cortex-route-gate: appended self-model block principal=${stateKey || 'unknown'} degraded=${(selfModel.degraded || []).length} predicted=${predictedChecks.length} creativity=${creativity.requested} intent=${JSON.stringify((intentText || '').slice(0, 80))}`);
    return { appendSystemContext: `${renderPlan(plan, prompt, duplicateRisk, creativity, retryAudit)}\n${renderSelfModelBlock(selfModel, predictedChecks)}` };
  });

  api.on('before_tool_call', async (event: any, ctx: any) => {
    const rs = runStateByKey.get(stateKeyForContext(ctx));
    if (!rs) return;
    if ((event?.toolName === 'web_search' || event?.toolName === 'web_fetch') && !hasLevel(rs.plan, 2)) {
      rs.observedSignals.push('web_tool_without_l2');
    }
    if ((event?.toolName === 'web_search' || event?.toolName === 'web_fetch') && rs.predictedChecks?.some((x) => x.capability === 'l2_browser_bridge' && !x.usable)) {
      rs.observedSignals.push('counterfactual_warn:l2_browser_bridge');
    }
    if (event?.toolName === 'memory_search' && !hasLevel(rs.plan, 22) && !hasLevel(rs.plan, 7)) {
      rs.observedSignals.push('memory_tool_without_l7l22');
    }
    if (event?.toolName === 'memory_search' && rs.predictedChecks?.some((x) => x.capability === 'memory_write_through' && !x.usable)) {
      rs.observedSignals.push('counterfactual_warn:memory_write_through');
    }
    if (rs.creativity?.requested && (event?.toolName === 'memory_search' || event?.toolName === 'web_search' || event?.toolName === 'web_fetch')) {
      rs.observedSignals.push(`creative_grounding:${String(event.toolName)}`);
    }
  });

  api.on('after_tool_call', async (event: any, ctx: any) => {
    const rs = runStateByKey.get(stateKeyForContext(ctx));
    if (!rs) return;
    rs.toolCalls.push({ toolName: String(event?.toolName || ''), ok: !event?.error, durationMs: typeof event?.durationMs === 'number' ? event.durationMs : undefined, error: event?.error ? String(event.error) : undefined });
    if (event?.error) rs.observedSignals.push(`tool_error:${String(event.toolName || 'unknown')}`);
  });

  api.on('tool_result_persist', (event: any) => {
    const toolName = String(event?.toolName || '');
    const message = event?.message;
    if (!message || typeof message !== 'object') return;
    const content = (message as any).content;
    const groundedPrefix = `GROUNDING NOTE: Tool output below is observed tool data for ${toolName || 'unknown tool'}. Distinguish raw output from later inference.\n`;
    if (typeof content === 'string' && !content.startsWith('GROUNDING NOTE:')) {
      return { message: { ...(message as any), content: groundedPrefix + content } };
    }
    return;
  });

  api.on('llm_output', async (event: any, ctx: any) => {
    const rawSessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
    const stateKey = stateKeyForContext(ctx);
    const rs = stateKey ? runStateByKey.get(stateKey) : undefined;
    if (!rs || !rs.creativity?.requested || !creativityAuditEnabled) return;
    cleanupPendingCreativitySuppressions();
    const output = Array.isArray(event?.assistantTexts) ? event.assistantTexts.join('\n\n') : '';
    if (!output.trim()) return;
    const audit = auditCreativityOutput(output, rs.creativity);
    if (audit.overlapRatio < creativityAuditOverlapThreshold && audit.reasons.includes('anchor_overlap_ratio_high')) {
      audit.reasons.splice(audit.reasons.indexOf('anchor_overlap_ratio_high'), 1);
      audit.passed = audit.reasons.length === 0;
      audit.retryRecommended = !audit.passed;
    }
    rs.creativityAudit = audit;
    updateCreativityMetrics(rs.statePaths.creativityMetrics, (metrics) => {
      metrics.counters.audited = Number(metrics.counters.audited || 0) + 1;
      if (!audit.passed) metrics.counters.failed = Number(metrics.counters.failed || 0) + 1;
    });
    if (stateKey) updateJson(rs.statePaths.creativityRetry, {} as Record<string, CreativityAudit>, (state) => {
      if (audit.passed) delete state[rawSessionKey];
      else state[rawSessionKey] = audit;
    });
    if (!audit.passed && stateKey) {
      rs.observedSignals.push(`creativity_audit_failed:${audit.reasons.join('|')}`);
      api.logger.warn?.(`cortex-route-gate: creativity audit failed session=${stateKey} reasons=${audit.reasons.join(',') || 'none'} overlap=${audit.overlapTerms.join(',') || 'none'}`);

      const deliveryKeyRaw = extractDeliveryKeyFromSessionKey(rawSessionKey);
      const deliveryKey = deliveryKeyRaw ? scopedDeliveryKey(deliveryKeyRaw, stateKey) : undefined;
      if (deliveryKey && typeof api.sendUserMessage === 'function') {
        pendingCreativitySuppressions.set(deliveryKey, {
          deliveryKey,
          expectedOutputFingerprint: creativityOutputFingerprint(output),
          createdAt: Date.now(),
          retryPrompt: buildCreativityAutoRetryPrompt(audit),
          sessionKey: stateKey,
        });
        updateCreativityMetrics(rs.statePaths.creativityMetrics, (metrics) => { metrics.counters.retryTriggered = Number(metrics.counters.retryTriggered || 0) + 1; });
        rs.observedSignals.push('creativity_retry_predelivery');
        api.logger.info?.(`cortex-route-gate: scheduled pre-delivery creativity retry session=${stateKey} delivery=${deliveryKey}`);
        api.sendUserMessage(buildCreativityAutoRetryPrompt(audit), { deliverAs: 'followUp' });
      }
    }
  });

  api.on('message_sending', async (event: any, ctx: any) => {
    cleanupPendingCreativitySuppressions();
    const stateKey = stateKeyForContext(ctx);
    if (!stateKey) return;
    const deliveryKey = scopedDeliveryKey(
      `${String(ctx?.channelId || '').trim()}:${String(ctx?.accountId || 'default').trim() || 'default'}:${String(event?.to || '').trim()}`,
      stateKey,
    );
    const pending = pendingCreativitySuppressions.get(deliveryKey);
    if (!pending) return;
    const outgoing = typeof event?.content === 'string' ? event.content : '';
    if (!outgoing.trim()) return;
    if (similarity(creativityOutputFingerprint(outgoing), pending.expectedOutputFingerprint) < 0.9) return;
    pendingCreativitySuppressions.delete(deliveryKey);
    api.logger.info?.(`cortex-route-gate: cancelled pre-delivery adjacent creative answer for ${deliveryKey}`);
    return { cancel: true };
  });

  api.on('agent_end', async (event: any, ctx: any) => {
    const stateKey = stateKeyForContext(ctx);
    const rs = stateKey ? runStateByKey.get(stateKey) : undefined;
    if (!rs) return;
    const contradictions = loadJson<{ contradictions?: any[] }>(contradictionPath, { contradictions: [] });
    const success = Boolean(event?.success) && !rs.observedSignals.some((x) => x.startsWith('tool_error:'));
    updateStats(rs.statePaths.stats, (stats) => {
      const taskBucket = stats.byTask[rs.taskClass] || { uses: 0, successes: 0, failures: 0 };
      taskBucket.uses += 1;
      if (success) taskBucket.successes += 1; else taskBucket.failures += 1;
      stats.byTask[rs.taskClass] = taskBucket;
      for (const level of rs.plan.recommendedLevels) {
        const bucket = stats.byLevel[String(level.level)] || { uses: 0, successes: 0, failures: 0, score: 0.5 };
        bucket.uses += 1;
        if (success) bucket.successes += 1; else bucket.failures += 1;
        bucket.score = clamp(0.5 + (bucket.successes - bucket.failures) / Math.max(bucket.uses, 4), 0, 1);
        bucket.lastReason = success ? 'successful_run' : (rs.observedSignals[0] || 'failed_run');
        stats.byLevel[String(level.level)] = bucket;
      }
    });
    if ((contradictions.contradictions || []).length > 0 && rs.observedSignals.every((x) => !x.startsWith('contradiction:'))) {
      const severe = (contradictions.contradictions || []).filter((x: any) => x?.severity === 'high').length;
      if (severe > 0) rs.observedSignals.push(`contradiction:high:${severe}`);
    }
    runStateByKey.delete(stateKey);
  });
}

export { updateJson, withFileLock };
