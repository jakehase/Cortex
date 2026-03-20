import fs from 'node:fs';
import path from 'node:path';

type RouteLevel = { level: number; name?: string; reason?: string; method?: string; score?: number };
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
};

function normalizeBaseUrl(value: unknown): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : 'http://127.0.0.1:18888';
  return text.endsWith('/') ? text.slice(0, -1) : text;
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
async function postJson(url: string, body: unknown, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    const text = await res.text();
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
function saveStats(statsPath: string, stats: RouteStats) {
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  fs.writeFileSync(statsPath, JSON.stringify({ ...stats, updatedAt: nowIso() }, null, 2));
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
  const cfg = api.config || {};
  if (!asBool(cfg.enabled, true)) return;

  const baseUrl = normalizeBaseUrl(cfg.baseUrl);
  const requireRouting = asBool(cfg.requireRouting, true);
  const timeoutMs = asNumber(cfg.timeoutMs, 8000);
  const maxLevels = asNumber(cfg.maxLevels, 10);
  const creativityGovernorEnabled = asBool(cfg.creativityGovernorEnabled, true);
  const creativityHistorySize = asNumber(cfg.creativityHistorySize, 24);
  const creativityQuarantineTerms = asNumber(cfg.creativityQuarantineTerms, 8);
  const creativityAuditEnabled = asBool(cfg.creativityAuditEnabled, true);
  const creativityAuditOverlapThreshold = asNumber(cfg.creativityAuditOverlapThreshold, 0.34);
  const stateDir = typeof cfg.stateDir === 'string' && cfg.stateDir.trim() ? cfg.stateDir.trim() : path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw'), 'cortex-route-gate');
  const statsPath = path.join(stateDir, 'adaptive-routing-stats.json');
  const historyPath = path.join(stateDir, 'prompt-fingerprints.json');
  const promptHistoryPath = path.join(stateDir, 'prompt-history.json');
  const creativityRetryPath = path.join(stateDir, 'creativity-retry.json');
  const creativityMetricsPath = path.join(stateDir, 'creativity-metrics.json');
  const selfModelPath = path.join('/root/clawd/state', 'cortex-self-model.json');
  const contradictionPath = path.join('/root/clawd/state', 'cortex-contradictions.json');
  const runStateByKey = new Map<string, RunState>();

  function loadFingerprintHistory(): string[] {
    try { return JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch { return []; }
  }
  function saveFingerprintHistory(history: string[]) {
    const compact: string[] = [];
    for (const item of history.slice(-200)) {
      if (!item) continue;
      if (compact.some((existing) => similarity(existing, item) >= 0.92)) continue;
      compact.push(item);
    }
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(compact.slice(-100), null, 2));
  }
  function loadPromptHistory(): PromptHistoryEntry[] {
    try {
      const raw = JSON.parse(fs.readFileSync(promptHistoryPath, 'utf8'));
      return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') as PromptHistoryEntry[] : [];
    } catch { return []; }
  }
  function savePromptHistory(history: PromptHistoryEntry[]) {
    fs.mkdirSync(path.dirname(promptHistoryPath), { recursive: true });
    fs.writeFileSync(promptHistoryPath, JSON.stringify(history.slice(-creativityHistorySize), null, 2));
  }
  function loadCreativityRetryState(): Record<string, CreativityAudit> {
    try { return JSON.parse(fs.readFileSync(creativityRetryPath, 'utf8')); } catch { return {}; }
  }
  function saveCreativityRetryState(state: Record<string, CreativityAudit>) {
    fs.mkdirSync(path.dirname(creativityRetryPath), { recursive: true });
    fs.writeFileSync(creativityRetryPath, JSON.stringify(state, null, 2));
  }
  function loadCreativityMetrics(): any {
    try { return JSON.parse(fs.readFileSync(creativityMetricsPath, 'utf8')); } catch { return { version: 1, updatedAt: nowIso(), counters: { audited: 0, failed: 0, retryInjected: 0 } }; }
  }
  function saveCreativityMetrics(metrics: any) {
    fs.mkdirSync(path.dirname(creativityMetricsPath), { recursive: true });
    fs.writeFileSync(creativityMetricsPath, JSON.stringify({ ...metrics, updatedAt: nowIso() }, null, 2));
  }

  async function getPlan(prompt: string, messages: unknown[], sessionKey?: string): Promise<{ plan: RoutePlan; duplicateRisk: boolean; taskClass: string; selfModel: CapabilitySelfModel; predictedChecks: { capability: string; usable: boolean; confidence: number; rationale: string }[]; creativity: CreativityProfile; intentText: string }> {
    let plan: RoutePlan | null = null;
    try {
      const data = await postJson(`${baseUrl}/nexus/orchestrate?query=${encodeURIComponent(prompt)}`, {}, timeoutMs);
      const recommended = Array.isArray(data?.recommended_levels) ? data.recommended_levels : (Array.isArray(data?.recommended) ? data.recommended : []);
      let normalized = uniqueLevels((recommended as RouteLevel[]).slice(0, Math.max(maxLevels, 20)));
      if (!normalized.some((x) => x.level === 24)) normalized = [{ level: 24, name: 'Nexus', reason: 'mandatory upstream routing' }, ...normalized];
      if (!normalized.some((x) => x.level === 5)) normalized.push({ level: 5, name: 'Oracle', reason: 'baseline reasoning' });
      plan = {
        recommendedLevels: normalized,
        routingMethod: typeof data?.routing_method === 'string' ? data.routing_method : 'nexus_orchestration',
        reasoning: Array.isArray(data?.reasoning) ? data.reasoning.map((x: any) => String(x)) : [],
        routingMarkers: typeof data?.routing_markers === 'object' && data.routing_markers ? data.routing_markers : undefined,
        workflowCheckpoint: typeof data?.workflow_checkpoint === 'object' && data.workflow_checkpoint ? data.workflow_checkpoint : undefined,
      };
    } catch (error) {
      api.logger.warn(`cortex-route-gate: routing failed for prompt: ${String(error)}`);
      if (!requireRouting) {
        plan = {
          recommendedLevels: [{ level: 24, name: 'Nexus', reason: 'fallback routing' }, { level: 5, name: 'Oracle', reason: 'baseline reasoning' }],
          routingMethod: 'fallback',
          routingError: String(error), reasoning: ['Cortex routing failed, using fallback mandatory routing envelope.'],
        };
      } else {
        plan = {
          recommendedLevels: [{ level: 24, name: 'Nexus', reason: 'fallback routing' }, { level: 5, name: 'Oracle', reason: 'baseline reasoning' }],
          routingMethod: 'fallback',
          routingError: String(error), reasoning: ['Cortex routing failed, using fallback mandatory routing envelope.'],
        };
      }
    }
    const intentText = latestUserTurnText(messages) || tailIntentText(prompt);
    const creativityEligible = Boolean(latestUserTurnText(messages)) && !(sessionKey || '').includes(':cron:');
    const taskClass = classifyTask(intentText || prompt);
    const stats = loadStats(statsPath);
    const selfModel = loadJson<CapabilitySelfModel>(selfModelPath, { version: 1, capabilities: {}, confidence: {}, degraded: [], recommendations: [] });
    const predictedChecks = predictCapabilityUse(intentText || prompt, selfModel);
    const priorPromptHistory = loadPromptHistory();
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
    const history = loadFingerprintHistory();
    const duplicateRisk = history.some((x) => similarity(x, fingerprint) >= 0.9);
    history.push(fingerprint);
    saveFingerprintHistory(history);
    const promptHistory = priorPromptHistory.concat([{ createdAt: nowIso(), promptFingerprint: fingerprint, taskClass, tokens: extractContentTokens(intentText || prompt, creativityQuarantineTerms) }]);
    savePromptHistory(promptHistory);
    return { plan: prioritized, duplicateRisk, taskClass, selfModel, predictedChecks, creativity, intentText };
  }

  api.on('before_prompt_build', async (event: any, ctx: any) => {
    const prompt = typeof event?.prompt === 'string' ? event.prompt.trim() : '';
    if (!prompt) return;
    const stateKey = String(ctx?.sessionKey || ctx?.sessionId || '');
    const { plan, duplicateRisk, taskClass, selfModel, predictedChecks, creativity, intentText } = await getPlan(prompt, Array.isArray(event?.messages) ? event.messages : [], stateKey);
    const retryState = stateKey ? loadCreativityRetryState() : {};
    const retryAudit = stateKey && creativity.requested ? retryState[stateKey] : undefined;
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
      });
    }
    if (stateKey && retryAudit && creativity.requested) { const metrics = loadCreativityMetrics(); metrics.counters.retryInjected = Number(metrics.counters.retryInjected || 0) + 1; saveCreativityMetrics(metrics); delete retryState[stateKey]; saveCreativityRetryState(retryState); }
    api.logger.info?.(`cortex-route-gate: appended self-model block session=${stateKey || 'unknown'} degraded=${(selfModel.degraded || []).length} predicted=${predictedChecks.length} creativity=${creativity.requested} intent=${JSON.stringify((intentText || '').slice(0, 80))}`);
    return { appendSystemContext: `${renderPlan(plan, prompt, duplicateRisk, creativity, retryAudit)}\n${renderSelfModelBlock(selfModel, predictedChecks)}` };
  });

  api.on('before_tool_call', async (event: any, ctx: any) => {
    const rs = runStateByKey.get(String(ctx?.sessionKey || ctx?.sessionId || ''));
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
    const rs = runStateByKey.get(String(ctx?.sessionKey || ctx?.sessionId || ''));
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
    const stateKey = String(ctx?.sessionKey || ctx?.sessionId || '');
    const rs = stateKey ? runStateByKey.get(stateKey) : undefined;
    if (!rs || !rs.creativity?.requested || !creativityAuditEnabled) return;
    const output = Array.isArray(event?.assistantTexts) ? event.assistantTexts.join('\n\n') : '';
    if (!output.trim()) return;
    const audit = auditCreativityOutput(output, rs.creativity);
    if (audit.overlapRatio < creativityAuditOverlapThreshold && audit.reasons.includes('anchor_overlap_ratio_high')) {
      audit.reasons.splice(audit.reasons.indexOf('anchor_overlap_ratio_high'), 1);
      audit.passed = audit.reasons.length === 0;
      audit.retryRecommended = !audit.passed;
    }
    rs.creativityAudit = audit;
    const metrics = loadCreativityMetrics();
    metrics.counters.audited = Number(metrics.counters.audited || 0) + 1;
    if (!audit.passed) metrics.counters.failed = Number(metrics.counters.failed || 0) + 1;
    saveCreativityMetrics(metrics);
    const retryState = stateKey ? loadCreativityRetryState() : undefined;
    if (audit.passed && stateKey && retryState?.[stateKey]) {
      delete retryState[stateKey];
      saveCreativityRetryState(retryState);
    }
    if (!audit.passed && stateKey && retryState) {
      retryState[stateKey] = audit;
      saveCreativityRetryState(retryState);
      rs.observedSignals.push(`creativity_audit_failed:${audit.reasons.join('|')}`);
      api.logger.warn?.(`cortex-route-gate: creativity audit failed session=${stateKey} reasons=${audit.reasons.join(',') || 'none'} overlap=${audit.overlapTerms.join(',') || 'none'}`);
    }
  });

  api.on('agent_end', async (event: any, ctx: any) => {
    const stateKey = String(ctx?.sessionKey || ctx?.sessionId || '');
    const rs = stateKey ? runStateByKey.get(stateKey) : undefined;
    if (!rs) return;
    const stats = loadStats(statsPath);
    const contradictions = loadJson<{ contradictions?: any[] }>(contradictionPath, { contradictions: [] });
    const success = Boolean(event?.success) && !rs.observedSignals.some((x) => x.startsWith('tool_error:'));
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
    saveStats(statsPath, stats);
    if ((contradictions.contradictions || []).length > 0 && rs.observedSignals.every((x) => !x.startsWith('contradiction:'))) {
      const severe = (contradictions.contradictions || []).filter((x: any) => x?.severity === 'high').length;
      if (severe > 0) rs.observedSignals.push(`contradiction:high:${severe}`);
    }
    runStateByKey.delete(stateKey);
  });
}
