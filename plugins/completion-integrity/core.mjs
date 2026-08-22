import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { bootstrapSurfaceHonestyManifest, enforceArchitecture } from '../../large-project-capability-stack/packages/architecture-enforcer/index.mjs';
import { compileClaimIntegrityReport, buildClaimResponseFrame } from '../../large-project-capability-stack/packages/claim-integrity/index.mjs';

const OPENCLAW_DIST_ROOT = '/usr/lib/node_modules/openclaw/dist';
let deliverOutboundPayloadsPromise = null;

function resolveDeliverRuntimeCandidates() {
  const candidates = [];
  const addCandidate = (filePath) => {
    if (!filePath || candidates.includes(filePath)) return;
    candidates.push(filePath);
  };

  addCandidate(path.join(OPENCLAW_DIST_ROOT, 'plugin-sdk', 'deliver-runtime-20_kW0lQ.js'));
  addCandidate(path.join(OPENCLAW_DIST_ROOT, 'plugin-sdk', 'deliver-runtime.js'));
  addCandidate(path.join(OPENCLAW_DIST_ROOT, 'deliver-runtime.js'));

  try {
    for (const entry of fs.readdirSync(OPENCLAW_DIST_ROOT)) {
      if (/^deliver-runtime-.*\.js$/.test(entry)) addCandidate(path.join(OPENCLAW_DIST_ROOT, entry));
    }
  } catch {}

  try {
    for (const entry of fs.readdirSync(path.join(OPENCLAW_DIST_ROOT, 'plugin-sdk'))) {
      if (/^deliver-runtime-.*\.js$/.test(entry)) addCandidate(path.join(OPENCLAW_DIST_ROOT, 'plugin-sdk', entry));
    }
  } catch {}

  return candidates;
}

async function loadDeliverOutboundPayloads() {
  if (!deliverOutboundPayloadsPromise) {
    deliverOutboundPayloadsPromise = (async () => {
      const candidates = resolveDeliverRuntimeCandidates();
      for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        const mod = await import(pathToFileURL(candidate).href);
        if (typeof mod.deliverOutboundPayloads === 'function') return mod.deliverOutboundPayloads;
      }
      throw new Error(`Unable to resolve OpenClaw deliver runtime from candidates: ${candidates.join(', ')}`);
    })();
  }
  return deliverOutboundPayloadsPromise;
}

async function defaultDeliver(payload) {
  const deliverOutboundPayloads = await loadDeliverOutboundPayloads();
  return deliverOutboundPayloads(payload);
}

const USER_VISIBLE_STATES = ['pending', 'running', 'internal_complete', 'notification_sent', 'delivery_confirmed', 'closed', 'failed'];
const DEFAULTS = {
  stateDir: '/root/clawd/state/completion-integrity',
  workspaceRoot: '/root/clawd',
  escalationAfterMs: 90_000,
  autoDeliveryAfterMs: 15_000,
  retryBackoffMs: 10_000,
  pollIntervalMs: 10_000,
  importantKeywords: ['fix', 'implement', 'deploy', 'restart', 'verify', 'debug', 'diagnose', 'migrate', 'patch', 'recover', 'continue', 'roadmap', 'clone'],
  lightweightKeywords: ['what happened', 'what changed', 'summarize', 'explain'],
  hardValidationModes: ['strict', 'important_only'],
};

const FIDELITY_LATTICE = ['prototype', 'production_slice', 'parity_for_scope', 'full_clone'];

function nowIso() { return new Date().toISOString(); }
function parseMs(v) { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; }
function safeJsonParse(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }
function loadJson(file, fallback) { try { return safeJsonParse(fs.readFileSync(file, 'utf8'), fallback); } catch { return fallback; } }
function saveJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function normalize(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function normalizeSoft(text) { return normalize(text).toLowerCase(); }
function summarize(text, max = 240) { return normalize(text).slice(0, max); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }
function cleanPathCandidate(value) {
  return String(value || '').replace(/^['"`]+|['"`]+$/g, '').replace(/[),.;]+$/g, '').trim();
}
function readJsonIfExists(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function extractStructuredField(text, label) {
  const pattern = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\b(?:Reply anchor|Anchor|Target path|targetPath|Implementation surface|Diff scope|Fidelity|requestedFidelity|Scope|requestedScope|Stop condition|Surface matrix|surfaceMatrixPath|matrixPath|Campaign state path|Program state path|campaignStatePath|programStatePath|Campaign mode|Supervisor status|Parity status|Honesty manifest|Honesty gate|Evidence|What remains|Blocker|Next action):|$)`, 'i');
  const match = String(text || '').match(pattern);
  return cleanPathCandidate(match?.[1] || '');
}
function parseJsonCodeBlock(text, labelPattern) {
  const fencePattern = '```json\\s*([\\s\\S]*?)```';
  const match = String(text || '').match(new RegExp(`${labelPattern}:\\s*${fencePattern}`, 'i'));
  if (match?.[1]) return safeJsonParse(match[1], null);
  const fallback = String(text || '').match(new RegExp(`${labelPattern}:\\s*([\\s\\S]+)$`, 'i'));
  return fallback?.[1] ? safeJsonParse(fallback[1], null) : null;
}
function extractReplyThreadContext(prompt) {
  const conversationInfo = parseJsonCodeBlock(prompt, 'Conversation info \\(untrusted metadata\\)') || {};
  const repliedMessage = parseJsonCodeBlock(prompt, 'Replied message \\(untrusted, for context\\)') || {};
  const body = normalize(repliedMessage?.body || '');
  const summary = summarize(body || '', 220);
  return {
    present: Boolean(conversationInfo?.has_reply_context || conversationInfo?.reply_to_id || repliedMessage?.body),
    replyToId: normalize(conversationInfo?.reply_to_id || ''),
    senderLabel: normalize(repliedMessage?.sender_label || ''),
    body,
    summary,
  };
}
function stripInternalEnvelope(text) {
  return String(text || '')
    .replace(/Conversation info \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, ' ')
    .replace(/Sender \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, ' ')
    .replace(/Replied message \(untrusted, for context\):[\s\S]*?```[\s\S]*?```/gi, ' ')
    .replace(/Cortex upstream routing applied:[^\n]*/gi, ' ')
    .replace(/\bCORTEX_[A-Z0-9_]+\b[\s\S]*$/g, ' ')
    .trim();
}
function sanitizePrompt(text) {
  return normalize(stripInternalEnvelope(text));
}
function memoryDateStamp(isoValue) {
  const stamp = String(isoValue || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(stamp) ? stamp : nowIso().slice(0, 10);
}
function stripMarkdownNoise(text) {
  return normalize(String(text || '')
    .replace(/^\[cortex\]\s*/i, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1'));
}
const KNOWN_PROJECTS = [
  { slug: 'mailchimp', title: 'Mailchimp', patterns: [/\bmailchimp\b/i] },
  { slug: 'pmhnp-claim-guard', title: 'PMHNP Claim Guard', patterns: [/\bpmhnp\b/i, /\bclaim guard\b/i] },
];
const PROJECT_MEMORY_BLOCK_START = '<!-- completion-integrity:auto-project-memory:start -->';
const PROJECT_MEMORY_BLOCK_END = '<!-- completion-integrity:auto-project-memory:end -->';

function detectProjectDescriptor(...values) {
  const hay = values.map((value) => String(value || '')).join('\n');
  return KNOWN_PROJECTS.find((project) => project.patterns.some((pattern) => pattern.test(hay))) || null;
}
function renderBulletLines(items, emptyLine = '- none recorded') {
  if (!Array.isArray(items) || items.length === 0) return emptyLine;
  return items.map((item) => `- ${stripMarkdownNoise(item)}`).join('\n');
}
function upsertGeneratedProjectBlock(existing, generatedBlock) {
  const normalizedExisting = String(existing || '');
  const block = `${PROJECT_MEMORY_BLOCK_START}\n${generatedBlock.trim()}\n${PROJECT_MEMORY_BLOCK_END}`;
  if (!normalizedExisting.trim()) {
    return `${block}\n`;
  }
  if (normalizedExisting.includes(PROJECT_MEMORY_BLOCK_START) && normalizedExisting.includes(PROJECT_MEMORY_BLOCK_END)) {
    return normalizedExisting.replace(new RegExp(`${PROJECT_MEMORY_BLOCK_START}[\\s\\S]*?${PROJECT_MEMORY_BLOCK_END}`), block);
  }
  return `${normalizedExisting.replace(/\s*$/, '\n\n')}${block}\n`;
}
function renderProjectMemoryMarkdown(project, latest, history = []) {
  const statusLines = Object.entries(latest?.statusMap || {})
    .filter(([, value]) => normalize(value))
    .map(([label, value]) => `- ${label}: ${normalize(value)}`)
    .join('\n') || '- none recorded';
  const keyLessons = renderBulletLines(latest?.decisions || [], '- none recorded');
  const recentHistory = Array.isArray(history) && history.length
    ? history.slice(-5).reverse().map((entry) => `- ${entry.at}: ${entry.summary}`).join('\n')
    : '- none recorded';

  return [
    `# ${project.title} project memory`,
    '',
    'Canonical active-project memory for reply-anchored status, blockers, remaining surfaces, and lessons.',
    '',
    '## Latest canonical status',
    statusLines,
    '',
    '## Changed surfaces',
    renderBulletLines(latest?.changedSurfaces || []),
    '',
    '## Remaining surfaces',
    renderBulletLines(latest?.remainingSurfaces || []),
    '',
    '## Key lessons',
    keyLessons,
    '',
    '## Latest promoted summary',
    `- ${latest?.summary || 'none recorded'}`,
    '',
    '## Provenance',
    `- Last updated: ${latest?.at || 'unknown'}`,
    `- Reply anchor id: ${latest?.replyToId || 'unknown'}`,
    `- Reply anchor sender: ${latest?.senderLabel || 'unknown'}`,
    `- Promotion key: ${latest?.key || 'unknown'}`,
    '',
    '## Recent promotions',
    recentHistory,
  ].join('\n');
}
function extractFieldValue(body, label) {
  const match = String(body || '').match(new RegExp(`\\b${label}\\s*:\\s*([^\\n]+)`, 'i'));
  return normalize(match?.[1] || '');
}
function extractBulletsAfterHeading(body, headingRegex, maxItems = 6) {
  const lines = String(body || '').split(/\r?\n/);
  const out = [];
  let active = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!active) {
      if (headingRegex.test(line)) active = true;
      continue;
    }
    if (!line) {
      if (out.length) break;
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/)?.[1];
    if (bullet) {
      out.push(stripMarkdownNoise(bullet));
      if (out.length >= maxItems) break;
      continue;
    }
    if (out.length) break;
  }
  return out;
}
function isMemoryRepairPrompt(prompt) {
  return /\bmemory\b|\bremember\b|\bdeduct that\b|\bfrom memory\b|\bwhy weren'?t you able\b/i.test(stripInternalEnvelope(prompt));
}
function buildReplyAnchorPromotion(replyThread, prompt) {
  const rawBody = String(replyThread?.body || '');
  const body = stripMarkdownNoise(rawBody);
  if (!body) return null;
  const statusFields = [
    ['supervisorStatus', extractFieldValue(rawBody, 'supervisorStatus')],
    ['matrixStatus', extractFieldValue(rawBody, 'matrixStatus')],
    ['parityStatus', extractFieldValue(rawBody, 'parityStatus')],
    ['blocker', extractFieldValue(rawBody, 'blocker')],
  ].filter(([, value]) => value);
  const changedSurfaces = extractBulletsAfterHeading(rawBody, /what this run actually changed|real product surfaces changed/i, 6);
  const remainingSurfaces = extractBulletsAfterHeading(rawBody, /remaining surfaces|still not satisfied|these are still open/i, 6);
  const decisions = [];
  if (/\bpersistence first\b/i.test(body)) decisions.push('persistence remains the main choke point');
  if (/reply-anchor context .* primary/i.test(body) || /reply anchor .* primary/i.test(body)) decisions.push('reply-anchor context should be treated as primary');
  if (/\bwe decided\b|\bthe plan is\b|\bfrom now on\b|\balways use\b|\bdefault to\b/i.test(body)) decisions.push(summarize(body, 220));
  const preferenceLike = /\bcall me\b|\btimezone\b|\bpronouns\b|\bi prefer\b|\bpreference\b/i.test(body);
  const projectStatusLike = statusFields.length >= 2 || changedSurfaces.length > 0 || remainingSurfaces.length > 0;

  let score = 0;
  if (projectStatusLike) score += 0.68;
  if (decisions.length) score += 0.26;
  if (preferenceLike) score += 0.3;
  if (isMemoryRepairPrompt(prompt)) score += 0.14;
  if (body.length >= 180) score += 0.1;
  if (score < 0.72) return null;

  const parts = [];
  if (statusFields.length) parts.push(`canonical status: ${statusFields.map(([label, value]) => `${label}=${value}`).join(', ')}`);
  if (changedSurfaces.length) parts.push(`changed surfaces: ${changedSurfaces.join('; ')}`);
  if (remainingSurfaces.length) parts.push(`remaining surfaces: ${remainingSurfaces.join('; ')}`);
  if (decisions.length) parts.push(`key lesson: ${decisions[0]}`);
  if (!parts.length) parts.push(summarize(body, 520));

  const summary = summarize(parts.join('. '), 720);
  const project = detectProjectDescriptor(rawBody, prompt);
  return {
    key: hash(`${replyThread?.replyToId || replyThread?.summary || body}:${summary}`),
    line: `- Auto-promoted reply-anchor memory: ${summary}`,
    summary,
    score: Math.max(0, Math.min(1, score)),
    projectSlug: project?.slug || null,
    projectTitle: project?.title || null,
    statusFields,
    statusMap: Object.fromEntries(statusFields),
    changedSurfaces,
    remainingSurfaces,
    decisions,
  };
}
function extractText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (Array.isArray(value.content)) return extractText(value.content);
    if (Array.isArray(value.messages)) return extractText(value.messages);
  }
  return '';
}
function looksCron(prompt) { return normalizeSoft(sanitizePrompt(prompt)).startsWith('[cron:'); }
function looksCompletionEvent(prompt) {
  const p = normalizeSoft(sanitizePrompt(prompt));
  return p.includes('internal task completion event') || p.includes('source: subagent') || p.includes('completed successfully');
}
function inferTrustTier(prompt, cfg) {
  const p = normalizeSoft(sanitizePrompt(prompt));
  if (looksCron(prompt)) return 'background';
  if (cfg.importantKeywords.some((w) => p.includes(w))) return 'important';
  if (cfg.lightweightKeywords.some((w) => p.includes(w))) return 'normal';
  return 'normal';
}
function isConversationalQuestion(prompt) {
  const p = normalizeSoft(sanitizePrompt(prompt));
  if (!p) return true;
  if (/^(why|what|how|when|where|who|did|does|is|are|can|could|would|should)\b/.test(p)) return true;
  if (/^do\b/.test(p) && p.includes('?')) return true;
  if (p.includes('?')) return true;
  return /(what happened|summarize|explain|why were you|diagnose why)/.test(p);
}
function isUserVisibleTask(prompt, cfg) {
  if (!prompt || looksCompletionEvent(prompt) || looksCron(prompt)) return false;
  if (needsClaimIntegrity(prompt, cfg)) return true;
  if (isConversationalQuestion(prompt)) return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(fix|implement|do it|go ahead|continue|set up|wire|restart|verify|debug|diagnose|install|push|commit|create|update|deploy|patch|recover|phase\s*[0-9]+|phases\s*[0-9-]+|roadmap|clone)/.test(p);
}
function needsObjectiveGrounding(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(implement|fix|build|wire|patch|deploy|create|update|continue|phase\s*[0-9]+|phases\s*[0-9-]+|roadmap|clone|follow the previous|follow the roadmap)/.test(p);
}
function needsCloneParityContract(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /((1:1|1-to-1|1 to 1|one-to-one|one to one)\s+clone|clone\s+(of\s+)?[^.\n]{0,80}(1:1|1-to-1|1 to 1|one-to-one|one to one)|full\s+clone|exact\s+clone)/.test(p);
}
function hasAmbiguousReference(prompt) {
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(\bdo it\b|\bthis\b|\bthat\b|\bit\b|previous roadmap|follow the previous|phase\s*[0-9]+|phases\s*[0-9-]+|same roadmap|that one)/.test(p);
}
function hasGroundingProof(summary, grounding = {}) {
  const p = normalizeSoft(summary);
  const hasAnchor = p.includes('anchor:');
  const hasTarget = p.includes('target path:') || p.includes('target repo:') || p.includes('codebase:');
  const hasDiff = p.includes('diff scope:') || p.includes('implementation surface:') || p.includes('product files:') || p.includes('scaffolding only');
  const replyAnchorRequired = Boolean(grounding?.replyThread?.required);
  const hasReplyAnchor = !replyAnchorRequired || p.includes('reply anchor:');
  return hasAnchor && hasTarget && hasDiff && hasReplyAnchor;
}
function hasCloneParityProof(summary, cloneParity = {}) {
  if (!cloneParity?.required) return true;
  const p = normalizeSoft(summary);
  const blockerMode = hasBlockerReport(summary);
  const hasFullStatus = p.includes('parity status: full');
  const hasBlockedStatus = p.includes('parity status: blocked') || p.includes('parity status: incomplete') || p.includes('parity status: not full');
  const hasCoverage = p.includes('surface coverage:');
  const hasEvidence = p.includes('parity evidence:') || p.includes('parity checks:') || p.includes('parity tests:');
  const hasRemaining = p.includes('remaining gaps:');
  const downgradeWords = /(prototype|first-pass|first pass|vertical slice|mvp|mini version|working slice|scaffold-only|scaffolding only|partial parity|parity status: partial)/.test(p);
  if (blockerMode) return hasBlockedStatus && hasCoverage && hasEvidence && hasRemaining;
  return hasFullStatus && hasCoverage && hasEvidence && hasRemaining && !downgradeWords;
}
function inferRequestedFidelity(prompt, cfg) {
  const p = normalizeSoft(sanitizePrompt(prompt));
  if (needsCloneParityContract(prompt, cfg)) return 'full_clone';
  if (/(parity|equivalent|mirror|match mailchimp|close match|high-fidelity|high fidelity)/.test(p)) return 'parity_for_scope';
  if (/(prototype|mock|sketch|wireframe|rough draft|rough pass)/.test(p)) return 'prototype';
  return 'production_slice';
}
function needsClaimIntegrity(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  const asksForEstimate = /(\bwhat\s*%\b|\bpercentage\b|\bpercent\b|\bhow far along\b|\bhow complete\b|\bhow done\b|\bprogress\b)/.test(p);
  const projectLike = /(clone|parity|coverage|completion|roadmap|campaign|project|product|application|implementation|migration|audit|hardening)/.test(p);
  return asksForEstimate && projectLike;
}

function hasClaimIntegrityProgressEstimate(summary = '', prompt = '') {
  const text = `${summary}\n${prompt}`;
  const hasPercent = /\b\d{1,3}(?:\.\d+)?%/.test(summary) || /\b(single digits|low single digits|mid single digits|high single digits)\b/i.test(summary);
  const progressLike = /(clone|parity|progress|coverage|complete|completion|done|far along|roadmap|campaign|project|product|application)/i.test(text);
  return hasPercent && progressLike;
}

function hasClaimIntegrityFrame(summary = '') {
  const s = String(summary || '');
  const checks = [
    /observed\s*:/i.test(s),
    /estimated\s*:/i.test(s),
    /confidence\s*:/i.test(s),
    /what(?:'|’)s missing\s*:/i.test(s),
    /what would have to be true for a higher estimate\s*:/i.test(s)
  ];
  return checks.filter(Boolean).length >= 4;
}

function hasClaimIntegrityArtifactReference(summary = '') {
  return /(claim[ _-]?integrity|artifacts\/claim_integrity\/|cloneParityPercent|campaignReadinessPercent)/i.test(String(summary || ''));
}

function extractStructuredFieldVariants(text, labels = []) {
  for (const label of labels) {
    const value = extractStructuredField(text, label);
    if (value) return value;
  }
  return '';
}

function extractProposedPercent(summary = '') {
  const text = String(summary || '');
  const numeric = text.match(/\b(\d{1,3}(?:\.\d+)?)%/);
  if (numeric?.[1]) return Number(numeric[1]);
  if (/\blow single digits\b/i.test(text)) return 3;
  if (/\bmid single digits\b/i.test(text)) return 5;
  if (/\bhigh single digits\b/i.test(text)) return 8;
  if (/\bsingle digits\b/i.test(text)) return 5;
  return null;
}

function resolveArtifactPath(candidate, bases = []) {
  const cleaned = cleanPathCandidate(candidate);
  if (!cleaned) return null;
  const expandedBases = Array.from(new Set(
    bases
      .filter(Boolean)
      .flatMap((base) => {
        const abs = path.resolve(base);
        return [abs, path.dirname(abs), resolveRepoRoot(abs)].filter(Boolean);
      })
  ));
  const direct = path.isAbsolute(cleaned) ? cleaned : path.resolve(cleaned);
  const tries = path.isAbsolute(cleaned)
    ? [direct]
    : [
        ...expandedBases.map((base) => path.resolve(base, cleaned)),
        direct,
      ];
  for (const file of tries) {
    if (fs.existsSync(file)) return file;
  }
  return tries[0] || null;
}

function loadJsonArtifact(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return readJsonIfExists(filePath, null);
}

function resolveClaimIntegrityMirrorRoot(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const repoRoot = resolveRepoRoot(candidate);
    if (repoRoot) return repoRoot;
    const existing = resolveExistingPath(candidate);
    if (!existing) continue;
    try {
      return fs.statSync(existing).isDirectory() ? existing : path.dirname(existing);
    } catch {}
  }
  return null;
}

function matrixLeafState(surfaceStatus = '', issueStatus = '', artifactsPresent = false) {
  if (issueStatus === 'complete' || surfaceStatus === 'all_complete') return 'complete';
  if (issueStatus === 'blocked') return artifactsPresent ? 'persisted_partial' : 'workflow_partial';
  if (issueStatus === 'in_progress') return artifactsPresent ? 'workflow_partial' : 'ui_stub';
  if (surfaceStatus === 'partial') return artifactsPresent ? 'workflow_partial' : 'missing';
  if (surfaceStatus === 'blocked') return artifactsPresent ? 'persisted_partial' : 'workflow_partial';
  return 'missing';
}

function deriveClaimIntegritySurfaces(matrix, { targetReference = null } = {}) {
  const surfaces = Array.isArray(matrix?.surfaces) ? matrix.surfaces : [];
  return surfaces.map((surface) => {
    const issues = Array.isArray(surface?.issues) && surface.issues.length ? surface.issues : [{
      id: surface.id,
      title: surface.label || surface.id,
      status: surface.status === 'all_complete' ? 'complete' : surface.status === 'blocked' ? 'blocked' : 'pending',
      artifacts: Array.isArray(surface.requiredArtifacts) ? surface.requiredArtifacts : [],
      notes: surface.status === 'all_complete' ? '' : `${surface.status || 'partial'} surface in matrix`
    }];
    return {
      id: surface.id,
      label: surface.label || surface.id,
      weight: 1,
      leaves: issues.map((issue) => {
        const proofArtifacts = Array.isArray(issue?.artifacts) ? issue.artifacts : [];
        const artifactsPresent = proofArtifacts.some((artifact) => fs.existsSync(artifact)) || Boolean(surface.artifactsPresent);
        const notes = normalize(issue?.notes || '');
        const missingAdjacent = [];
        if (issue?.status !== 'complete') missingAdjacent.push(notes || `${issue?.title || issue?.id || surface.id} remains incomplete`);
        if (!artifactsPresent) missingAdjacent.push('proof artifacts missing or incomplete');
        return {
          id: issue?.id || `${surface.id}.leaf`,
          label: issue?.title || issue?.id || surface.label || surface.id,
          currentState: matrixLeafState(surface.status, issue?.status, artifactsPresent),
          evidence: {
            targetReference: targetReference || matrix?.contractSummary?.requestedScope || matrix?.contractSummary?.targetPath || null,
            changedProductFiles: [],
            proofArtifacts,
            confidence: issue?.status === 'complete' ? 0.85 : artifactsPresent ? 0.55 : 0.35,
            missingAdjacent: Array.from(new Set(missingAdjacent.filter(Boolean)))
          }
        };
      })
    };
  });
}

function detectRecoveryEvidencePath(campaignStatePath, programState = {}) {
  const evidence = programState?.evidence || {};
  const direct = [evidence.recoveryPath, evidence.recoverySimulationPath].find((candidate) => candidate && fs.existsSync(candidate));
  if (direct) return direct;
  if (!campaignStatePath) return null;
  const folder = path.dirname(campaignStatePath);
  const candidates = [
    path.join(folder, 'recovery_simulation.json'),
    path.join(folder, 'recovery_ledger.json'),
    path.join(folder, 'ledger.json')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function deriveExecutionReadiness({ task, matrix, programState, campaignStatePath, summary }) {
  const supervisorStatus = programState?.supervisor?.status || task?.campaign?.supervisorStatus || (/supervisor status:\s*(green|red|blocked|complete)/i.exec(String(summary || ''))?.[1] || null);
  const blocker = programState?.supervisor?.blocker ?? extractStructuredFieldVariants(summary, ['Blocker', 'blocker']);
  const matrixStatus = matrix?.status || task?.surfaceMatrix?.status || programState?.supervisor?.matrixStatus || null;
  const recoveryPath = detectRecoveryEvidencePath(campaignStatePath, programState);
  const workerSteps = Array.isArray(programState?.worker?.steps) ? programState.worker.steps.length : 0;
  const persistent = programState?.mode === 'persistent' || /campaign mode:\s*persistent/i.test(String(summary || ''));
  return {
    control_plane_ready: 1,
    execution_plane_ready: persistent ? (workerSteps > 0 ? 1 : 0.8) : 0.6,
    supervisor_truth: supervisorStatus === 'green' || supervisorStatus === 'complete' ? 1 : supervisorStatus === 'red' || supervisorStatus === 'blocked' ? 0.35 : 0.5,
    notifier_truth: programState?.notifier?.delivered === true ? 1 : programState?.notifier ? 0.75 : 0.6,
    repo_qualification: matrixStatus === 'all_complete' ? 1 : matrixStatus === 'partial' ? 0.55 : matrixStatus === 'blocked' ? 0.3 : 0.4,
    recovery_proven: recoveryPath ? 1 : workerSteps > 0 ? 0.65 : 0.4,
    no_null_blocker_contradiction: (supervisorStatus === 'red' || supervisorStatus === 'blocked') && (!normalize(String(blocker ?? '')) || normalizeSoft(String(blocker)) === 'null') ? 0.15 : 1,
  };
}

function inferRequestedScope(prompt, replyThread) {
  const anchor = normalize(replyThread?.summary || '');
  if (anchor) return summarize(anchor, 220);
  return summarize(sanitizePrompt(prompt), 220);
}
function needsCampaignRuntime(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(until complete|do not stop|keep going|keep iterating|long-run|long run|multi-stage|multi stage|worker \+ supervisor \+ notifier|campaign runtime|persistent campaign|phase\s*[0-9]+|phases\s*[0-9-]+|program\s*[0-9]+|programs\s*[0-9-]+|roadmap|clone)/.test(p);
}
function needsSurfaceMatrix(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(roadmap|phase\s*[0-9]+|phases\s*[0-9-]+|program\s*[0-9]+|programs\s*[0-9-]+|surface|clone|parity)/.test(p);
}
function hasTaskContractProof(summary, contract = {}) {
  if (!contract?.required) return true;
  const p = normalizeSoft(summary);
  const hasFidelity = p.includes('fidelity:');
  const hasScope = p.includes('scope:');
  const hasStop = p.includes('stop condition:');
  return hasFidelity && hasScope && hasStop;
}
function hasBlockerReport(summary) {
  const p = normalizeSoft(summary);
  const supervisorRed = /supervisor status:\s*(red|blocked|incomplete|not complete)|supervisor confirmed completion:\s*(no|false)|allcomplete:\s*false/.test(p);
  return supervisorRed && p.includes('blocker:') && p.includes('next action:');
}
function hasCampaignRuntimeProof(summary, campaign = {}) {
  if (!campaign?.required) return true;
  const p = normalizeSoft(summary);
  const hasMode = p.includes('campaign mode: persistent') || p.includes('campaign mode: session') || p.includes('campaign mode: persistent_campaign');
  const supervisorGreen = /supervisor status:\s*(green|complete)|supervisor confirmed completion:\s*(yes|true)|allcomplete:\s*true/.test(p);
  return hasMode && (supervisorGreen || hasBlockerReport(summary));
}
function surfaceMatrixState(summary) {
  const p = normalizeSoft(summary);
  if (/surface matrix status:\s*(all_complete|complete|green)/.test(p)) return 'all_complete';
  if (/surface matrix status:\s*(blocked|red)/.test(p)) return 'blocked';
  if (/surface matrix status:\s*(partial|in_progress|in progress|yellow)/.test(p)) return 'partial';
  return 'missing';
}
function hasSurfaceMatrixProof(summary, surfaceMatrix = {}, cloneParity = {}, campaign = {}) {
  if (!surfaceMatrix?.required) return true;
  const p = normalizeSoft(summary);
  const hasMatrix = p.includes('surface matrix:') || p.includes('surface checklist:');
  const state = surfaceMatrixState(summary);
  if (!hasMatrix || state === 'missing') return false;
  if (campaign?.required && hasBlockerReport(summary)) return true;
  if (cloneParity?.required) return state === 'all_complete';
  return state === 'all_complete' || state === 'partial';
}
function needsHonestyGate(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(real product|product surface|shared repo|surface honesty|honesty gate|product fix|product files|make this real)/.test(p);
}
function resolveExistingPath(targetPath) {
  const cleaned = cleanPathCandidate(targetPath);
  if (!cleaned) return null;
  if (fs.existsSync(cleaned)) return cleaned;
  const asDir = path.dirname(cleaned);
  return fs.existsSync(asDir) ? asDir : null;
}
function resolveRepoRoot(targetPath) {
  let current = resolveExistingPath(targetPath);
  if (!current) return null;
  if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolveExistingPath(targetPath);
}
function readHonestyOverride(repoRoot) {
  if (!repoRoot) return { valid: false, path: null, data: null, reason: 'repo_root_missing' };
  const candidates = [
    path.join(repoRoot, 'artifacts', 'honesty-override.json'),
    path.join(repoRoot, 'surface-honesty.override.json')
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const data = readJsonIfExists(candidate, null);
    if (!data || data.allowCompletionClaim !== true) return { valid: false, path: candidate, data, reason: 'override_missing_allow_flag' };
    if (!normalize(data.approvedBy || '')) return { valid: false, path: candidate, data, reason: 'override_missing_approved_by' };
    if (!normalize(data.reason || '')) return { valid: false, path: candidate, data, reason: 'override_missing_reason' };
    if (data.expiresAt && Date.parse(data.expiresAt) && Date.parse(data.expiresAt) < Date.now()) return { valid: false, path: candidate, data, reason: 'override_expired' };
    return { valid: true, path: candidate, data, reason: null };
  }
  return { valid: false, path: null, data: null, reason: 'override_missing' };
}
function findBoundedHonestyRoot(repoRoot, targetPath) {
  const existing = resolveExistingPath(targetPath);
  if (!repoRoot || !existing) return repoRoot;
  let current = fs.statSync(existing).isDirectory() ? existing : path.dirname(existing);
  if (!(current === repoRoot || current.startsWith(`${repoRoot}${path.sep}`))) return repoRoot;
  if (current === repoRoot) return repoRoot;
  while (current !== repoRoot) {
    if (fs.existsSync(path.join(current, 'surface-honesty.json')) || fs.existsSync(path.join(current, 'package.json')) || fs.existsSync(path.join(current, 'strict_1to1_contract.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fs.statSync(existing).isDirectory() ? existing : path.dirname(existing);
}
function summaryClaimsProductDiff(summary) {
  const p = normalizeSoft(summary);
  if (/diff scope:\s*(scaffolding only|docs only|tests only)|no product files changed/.test(p)) return false;
  return /diff scope:[^\n.]*product files|changed product surfaces|honesty manifest:|honesty gate:/.test(p);
}
function evaluateHonestyGate(summary, honesty = {}) {
  if (!honesty?.required) return { required: false, pass: true, targetPath: null, repoRoot: null, report: null, reason: null };
  const targetPath = extractStructuredField(summary, 'Target path');
  if (!targetPath) return { required: true, pass: false, targetPath: null, repoRoot: null, report: null, reason: 'honesty_target_path_missing' };
  const repoRoot = resolveRepoRoot(targetPath);
  if (!repoRoot) return { required: true, pass: false, targetPath, repoRoot: null, report: null, reason: 'honesty_target_path_unresolvable' };
  const scanRoot = repoRoot === DEFAULTS.workspaceRoot ? findBoundedHonestyRoot(repoRoot, targetPath) : repoRoot;
  const manifestPath = path.join(scanRoot, 'surface-honesty.json');
  const bootstrap = scanRoot === repoRoot && !fs.existsSync(manifestPath) ? bootstrapSurfaceHonestyManifest(scanRoot) : null;
  const report = enforceArchitecture(scanRoot);
  const override = readHonestyOverride(scanRoot);
  const pass = report?.honesty?.ok === true || override.valid === true;
  const status = report?.honesty?.ok === true ? 'green' : override.valid === true ? 'override' : 'red';
  return { required: true, pass, status, targetPath, repoRoot: scanRoot, report, bootstrap, override, reason: pass ? null : 'honesty_gate_failed' };
}
function cleanSummary(text, max = 280) { return summarize(sanitizePrompt(String(text || '').replace(/[{}\[\]"]+/g, '')), max); }
function buildCompletionMessage(task) {
  const done = cleanSummary(task.completionSummary) || `Completed: ${task.prompt}`;
  const blocked = hasBlockerReport(task.completionSummary || '');
  const lead = blocked ? 'Blocked' : 'Done';
  const remains = blocked
    ? 'follow the blocker + next-action path in the summary before treating this task as complete.'
    : task.validation?.required && !task.validation?.passed
      ? 'validator follow-up required'
      : 'none unless you want deeper verification.';
  const override = task.honesty?.status === 'override'
    ? `; override=${task.honesty.overridePath}${task.honesty.overrideApprovedBy ? ` approvedBy=${task.honesty.overrideApprovedBy}` : ''}`
    : '';
  const honesty = task.honesty?.required
    ? `\nHonesty gate: ${task.honesty?.status || 'unknown'}${task.honesty?.manifestPath ? ` (${task.honesty.manifestPath})` : ''}${task.honesty?.bootstrapCreated ? '; manifest bootstrapped automatically' : ''}${task.honesty?.changedProductFiles?.length ? `; changed product surfaces=${task.honesty.changedProductFiles.join(', ')}` : ''}${override}`
    : '';
  const claimIntegrityArtifacts = task.claimIntegrity?.repoReportPath || task.claimIntegrity?.repoResponseFramePath
    ? `\nClaim integrity artifacts: ${[
        task.claimIntegrity?.repoReportPath ? `report=${task.claimIntegrity.repoReportPath}` : null,
        task.claimIntegrity?.repoResponseFramePath ? `response_frame=${task.claimIntegrity.repoResponseFramePath}` : null,
        task.claimIntegrity?.repoSummaryPath ? `summary=${task.claimIntegrity.repoSummaryPath}` : null,
      ].filter(Boolean).join('; ')}`
    : '';
  return `${lead}: ${done}\nEvidence: completion-integrity recorded internal completion and confirmed outbound delivery progression for this task.${honesty}${claimIntegrityArtifacts}\nWhat remains: ${remains}`;
}

function looksLikeCompletionClaim(text, task) {
  const t = normalizeSoft(text);
  if (!t) return false;
  if (/^(done|completed|finished|shipped)\b/.test(t)) return true;
  if (/\bit'?s done\b/.test(t)) return true;
  if (t.includes('what remains:') || t.includes('evidence:')) return true;
  if (task?.completionSummary && t.includes(normalizeSoft(cleanSummary(task.completionSummary)).slice(0, 24))) return true;
  return false;
}

function honestyBlockText(task) {
  const manifest = task?.honesty?.manifestPath || 'surface-honesty.json';
  const changed = task?.honesty?.changedProductFiles?.length ? task.honesty.changedProductFiles.join(', ') : 'unknown changed product surfaces';
  const reason = task?.honesty?.violations?.[0]?.message || 'honesty gate is not green';
  return `Completion claim withheld: honesty gate is ${task?.honesty?.status || 'red'}, so I can't send a “done” claim for this implementation yet. Evidence: ${reason}. Manifest: ${manifest}. Changed product surfaces: ${changed}. What remains: truthfully declare the touched surfaces as real with evidence, or create an explicit override artifact at artifacts/honesty-override.json.`;
}
function parseRuntimeMessageSignal(message) {
  const raw = normalize(extractText(message));
  const p = normalizeSoft(raw);
  if (!raw) return null;
  const looksSystem = p.startsWith('system:') || p.includes('exec completed') || p.includes('exec failed') || p.includes('process exited') || p.includes('process completed');
  if (!looksSystem) return null;
  if (/exec failed|code [1-9][0-9]*|signal sig|process exited .*code [1-9][0-9]*/i.test(raw)) {
    return { kind: 'failed', summary: summarize(raw, 400) };
  }
  if (/exec completed|process exited|process completed/i.test(raw)) {
    return { kind: 'completed', summary: summarize(raw, 400) };
  }
  return null;
}

export function createCompletionIntegrityEngine(config = {}, deps = {}) {
  const cfg = { ...DEFAULTS, ...config };
  cfg.escalationAfterMs = Math.max(5_000, Math.trunc(cfg.escalationAfterMs));
  cfg.autoDeliveryAfterMs = Math.max(1_000, Math.trunc(cfg.autoDeliveryAfterMs));
  cfg.retryBackoffMs = Math.max(1_000, Math.trunc(cfg.retryBackoffMs));
  cfg.pollIntervalMs = Math.max(1_000, Math.trunc(cfg.pollIntervalMs));

  const logger = deps.logger || console;
  const deliver = deps.deliver || defaultDeliver;
  const clock = deps.clock || (() => Date.now());
  const isoNow = deps.isoNow || (() => new Date(clock()).toISOString());

  const paths = {
    tasks: path.join(cfg.stateDir, 'tasks.json'),
    routes: path.join(cfg.stateDir, 'routes.json'),
    metrics: path.join(cfg.stateDir, 'metrics.json'),
    events: path.join(cfg.stateDir, 'events.ndjson'),
    replyAnchorMemory: path.join(cfg.stateDir, 'reply-anchor-memory.json'),
    projectMemory: path.join(cfg.stateDir, 'project-memory.json'),
    claimIntegrityDir: path.join(cfg.stateDir, 'claim-integrity'),
  };
  const latestReplyThreadBySession = new Map();

  function claimIntegrityTaskDir(task) {
    const safe = String(task?.id || hash(task?.prompt || 'claim-integrity')).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
    return path.join(paths.claimIntegrityDir, safe);
  }

  function autoGenerateClaimIntegrityArtifacts(task) {
    if (!task?.claimIntegrity?.required) return null;
    const summary = String(task.completionSummary || '');
    const targetPath = extractStructuredFieldVariants(summary, ['Target path', 'targetPath']) || task?.honesty?.targetPath || null;
    const requestedFidelity = extractStructuredFieldVariants(summary, ['Fidelity', 'requestedFidelity']) || task?.contract?.requestedFidelity || null;
    const requestedScope = extractStructuredFieldVariants(summary, ['Scope', 'requestedScope']) || task?.contract?.requestedScope || task?.prompt || null;
    const surfaceMatrixField = extractStructuredFieldVariants(summary, ['Surface matrix', 'surfaceMatrixPath', 'matrixPath']);
    const baseCandidates = [cfg.workspaceRoot, targetPath, task?.honesty?.repoRoot].filter(Boolean);
    const matrixPath = resolveArtifactPath(surfaceMatrixField, baseCandidates);
    const matrix = loadJsonArtifact(matrixPath);
    if (!matrix?.surfaces?.length) {
      task.claimIntegrity = {
        ...(task.claimIntegrity || {}),
        autoGenerated: false,
        reportPath: null,
        responseFramePath: null,
        repoReportPath: null,
        repoResponseFramePath: null,
        repoSummaryPath: null,
        reportGeneratedAt: null,
        generationError: surfaceMatrixField ? 'surface_matrix_unreadable' : 'surface_matrix_missing',
        sourceMatrixPath: matrixPath || null,
        sourceProgramStatePath: null,
        derivedCloneParityPercent: null,
        derivedCampaignReadinessPercent: null,
        proposedPercent: extractProposedPercent(summary),
      };
      return null;
    }

    const campaignStateField = extractStructuredFieldVariants(summary, ['Campaign state path', 'Program state path', 'campaignStatePath', 'programStatePath']);
    const campaignStatePath = resolveArtifactPath(campaignStateField, [cfg.workspaceRoot, path.dirname(matrixPath), targetPath, task?.honesty?.repoRoot].filter(Boolean))
      || [path.join(path.dirname(matrixPath), 'program_state.json'), path.join(path.dirname(matrixPath), 'campaign_state.json')].find((candidate) => fs.existsSync(candidate))
      || null;
    const programState = loadJsonArtifact(campaignStatePath) || {};
    const executionReadiness = deriveExecutionReadiness({ task, matrix, programState, campaignStatePath, summary });
    const report = compileClaimIntegrityReport({
      title: `completion_integrity_${hash(task.id)}`,
      anchor: extractStructuredFieldVariants(summary, ['Anchor', 'Reply anchor']) || task.prompt,
      targetPath,
      requestedFidelity,
      requestedClaim: 'progress_estimate',
      executionReadiness,
      surfaces: deriveClaimIntegritySurfaces(matrix, { targetReference: matrixPath })
    });
    const proposedPercent = extractProposedPercent(summary);
    const responseFrame = buildClaimResponseFrame(report, { proposedPercent });
    const artifactDir = claimIntegrityTaskDir(task);
    const reportPath = path.join(artifactDir, 'report.json');
    const responseFramePath = path.join(artifactDir, 'response_frame.json');
    const summaryPath = path.join(artifactDir, 'summary.json');
    const repoMirrorRoot = resolveClaimIntegrityMirrorRoot(targetPath, matrixPath, task?.honesty?.repoRoot, cfg.workspaceRoot);
    const repoClaimIntegrityDir = repoMirrorRoot ? path.join(repoMirrorRoot, 'artifacts', 'claim_integrity') : null;
    const repoFilePrefix = `completion_integrity_${hash(task.id)}`;
    const repoReportPath = repoClaimIntegrityDir ? path.join(repoClaimIntegrityDir, `${repoFilePrefix}_report.json`) : null;
    const repoResponseFramePath = repoClaimIntegrityDir ? path.join(repoClaimIntegrityDir, `${repoFilePrefix}_response_frame.json`) : null;
    const repoSummaryPath = repoClaimIntegrityDir ? path.join(repoClaimIntegrityDir, `${repoFilePrefix}_summary.json`) : null;
    saveJson(reportPath, report);
    saveJson(responseFramePath, responseFrame);
    const summaryPayload = {
      generatedAt: isoNow(),
      source: 'completion-integrity-auto-claim-generator',
      targetPath,
      requestedFidelity,
      requestedScope,
      sourceMatrixPath: matrixPath,
      sourceProgramStatePath: campaignStatePath,
      proposedPercent,
      derivedCloneParityPercent: report.progress.cloneParityPercent,
      derivedCampaignReadinessPercent: report.progress.campaignReadinessPercent,
      responseFrame,
      stateArtifactPaths: {
        reportPath,
        responseFramePath,
        summaryPath,
      },
      repoArtifactPaths: repoClaimIntegrityDir ? {
        reportPath: repoReportPath,
        responseFramePath: repoResponseFramePath,
        summaryPath: repoSummaryPath,
      } : null,
    };
    saveJson(summaryPath, summaryPayload);
    if (repoClaimIntegrityDir) {
      saveJson(repoReportPath, report);
      saveJson(repoResponseFramePath, responseFrame);
      saveJson(repoSummaryPath, summaryPayload);
    }
    appendEvent({ type: 'claim_integrity_generated', taskId: task.id, sessionKey: task.sessionKey, reportPath, responseFramePath, matrixPath, repoReportPath, repoResponseFramePath });
    task.claimIntegrity = {
      ...(task.claimIntegrity || {}),
      autoGenerated: true,
      reportPath,
      responseFramePath,
      summaryPath,
      repoReportPath,
      repoResponseFramePath,
      repoSummaryPath,
      reportGeneratedAt: isoNow(),
      generationError: null,
      sourceMatrixPath: matrixPath,
      sourceProgramStatePath: campaignStatePath,
      derivedCloneParityPercent: report.progress.cloneParityPercent,
      derivedCampaignReadinessPercent: report.progress.campaignReadinessPercent,
      proposedPercent,
    };
    return { report, responseFrame, reportPath, responseFramePath, summaryPath, repoReportPath, repoResponseFramePath, repoSummaryPath, proposedPercent };
  }

  function loadReplyAnchorMemoryState() {
    return loadJson(paths.replyAnchorMemory, { seenKeys: [], promotions: [] });
  }
  function saveReplyAnchorMemoryState(state) {
    const next = {
      seenKeys: Array.from(new Set(Array.isArray(state?.seenKeys) ? state.seenKeys.map((x) => String(x)) : [])).slice(-500),
      promotions: Array.isArray(state?.promotions) ? state.promotions.slice(-200) : [],
    };
    saveJson(paths.replyAnchorMemory, next);
  }
  function loadProjectMemoryState() {
    return loadJson(paths.projectMemory, { projects: {} });
  }
  function saveProjectMemoryState(state) {
    const projects = Object.fromEntries(Object.entries(state?.projects || {}).map(([slug, projectState]) => {
      const entry = projectState || {};
      return [slug, {
        title: normalize(entry.title || ''),
        seenKeys: Array.from(new Set(Array.isArray(entry.seenKeys) ? entry.seenKeys.map((x) => String(x)) : [])).slice(-200),
        latest: entry.latest || null,
        history: Array.isArray(entry.history) ? entry.history.slice(-50) : [],
      }];
    }));
    saveJson(paths.projectMemory, { projects });
  }
  function maybePromoteProjectMemory(promotion, sessionKey, replyThread) {
    if (!promotion?.projectSlug) return null;
    const state = loadProjectMemoryState();
    const project = detectProjectDescriptor(promotion.projectSlug) || { slug: promotion.projectSlug, title: promotion.projectTitle || promotion.projectSlug };
    const existingProject = state.projects?.[project.slug] || { title: project.title, seenKeys: [], history: [], latest: null };
    const file = path.join(cfg.workspaceRoot, 'memory', 'projects', `${project.slug}.md`);
    const alreadySeen = Array.isArray(existingProject.seenKeys) && existingProject.seenKeys.includes(promotion.key);
    const latest = {
      key: promotion.key,
      at: isoNow(),
      summary: promotion.summary,
      replyToId: replyThread?.replyToId || null,
      senderLabel: replyThread?.senderLabel || null,
      statusMap: promotion.statusMap || {},
      changedSurfaces: promotion.changedSurfaces || [],
      remainingSurfaces: promotion.remainingSurfaces || [],
      decisions: promotion.decisions || [],
    };
    const historyEntry = { at: latest.at, summary: latest.summary, key: latest.key };
    if (!alreadySeen) existingProject.seenKeys = [...(existingProject.seenKeys || []), promotion.key];
    existingProject.title = project.title;
    existingProject.latest = latest;
    existingProject.history = [...(existingProject.history || []).filter((entry) => entry?.key !== historyEntry.key), historyEntry].slice(-50);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existingText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    fs.writeFileSync(file, upsertGeneratedProjectBlock(existingText, renderProjectMemoryMarkdown(project, latest, existingProject.history)));
    state.projects = { ...(state.projects || {}), [project.slug]: existingProject };
    saveProjectMemoryState(state);
    return { file, slug: project.slug, latest };
  }
  function maybePromoteReplyAnchorMemory(prompt, sessionKey, replyThread) {
    if (!replyThread?.present) return null;
    const promotion = buildReplyAnchorPromotion(replyThread, prompt);
    if (!promotion) return null;
    const state = loadReplyAnchorMemoryState();
    if (state.seenKeys.includes(promotion.key)) {
      maybePromoteProjectMemory(promotion, sessionKey, replyThread);
      return promotion;
    }
    const memoryFile = path.join(cfg.workspaceRoot, 'memory', `${memoryDateStamp(isoNow())}.md`);
    const existing = fs.existsSync(memoryFile) ? fs.readFileSync(memoryFile, 'utf8') : '';
    const nextContent = `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${promotion.line}\n`;
    fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
    fs.writeFileSync(memoryFile, nextContent);
    state.seenKeys.push(promotion.key);
    state.promotions.push({
      at: isoNow(),
      sessionKey,
      replyToId: replyThread.replyToId || null,
      senderLabel: replyThread.senderLabel || null,
      summary: promotion.summary,
      score: promotion.score,
      file: memoryFile,
    });
    saveReplyAnchorMemoryState(state);
    maybePromoteProjectMemory(promotion, sessionKey, replyThread);
    return promotion;
  }

  function migrateTask(task) {
    const next = { ...task };
    if (next.status === 'completed') next.status = 'internal_complete';
    if (next.status === 'announced') next.status = 'closed';
    if (!USER_VISIBLE_STATES.includes(next.status)) next.status = 'failed';
    next.updatedAt = next.updatedAt || next.closedAt || next.deliveryConfirmedAt || next.notificationSentAt || next.completedAt || next.createdAt || isoNow();
    next.history = Array.isArray(next.history) ? next.history : [{ from: null, to: next.status, at: next.updatedAt, migrated: true }];
    next.delivery = next.delivery || { attempts: 0, dedupeKeys: [], lastError: null };
    next.validation = next.validation || { required: false, mode: 'light', passed: true, runs: 0, failures: [] };
    next.trustTier = next.trustTier || 'normal';
    next.honesty = next.honesty || { required: false, proofPresent: false, targetPath: null, repoRoot: null, manifestPath: null, changedProductFiles: [], violations: [], status: null, bootstrapCreated: false, overridePath: null, overrideApprovedBy: null };
    next.contract = next.contract || { required: false, proofPresent: false, requestedFidelity: null, requestedScope: null, stopCondition: null };
    next.campaign = next.campaign || { required: false, proofPresent: false, modeRequired: null, supervisorStatus: null, blockerPresent: false };
    next.surfaceMatrix = next.surfaceMatrix || { required: false, proofPresent: false, status: null };
    next.claimIntegrity = next.claimIntegrity || {
      required: false,
      progressEstimatePresent: false,
      responseFramed: false,
      artifactReferenced: false,
      passed: null,
      autoGenerated: false,
      reportPath: null,
      responseFramePath: null,
      summaryPath: null,
      repoReportPath: null,
      repoResponseFramePath: null,
      repoSummaryPath: null,
      reportGeneratedAt: null,
      generationError: null,
      sourceMatrixPath: null,
      sourceProgramStatePath: null,
      derivedCloneParityPercent: null,
      derivedCampaignReadinessPercent: null,
      proposedPercent: null,
    };
    return next;
  }
  function loadStore() {
    const raw = loadJson(paths.tasks, { version: 3, tasks: [] });
    if (!raw || !Array.isArray(raw.tasks)) return { version: 3, tasks: [] };
    const migrated = { version: 3, tasks: raw.tasks.map(migrateTask) };
    return migrated;
  }
  function saveStore(store) { saveJson(paths.tasks, { version: 3, tasks: store.tasks.map(migrateTask) }); }
  function loadRoutes() { return loadJson(paths.routes, []); }
  function saveRoutes(routes) { saveJson(paths.routes, routes.slice(-500)); }
  function loadMetrics() {
    return loadJson(paths.metrics, {
      version: 1,
      counters: {
        silent_success_count: 0,
        duplicate_reply_count: 0,
        false_done_count: 0,
        tool_error_count: 0,
        recovery_success_count: 0,
        validator_runs: 0,
        validator_failures: 0,
      },
      completion_to_notification_latency_ms: [],
      completion_to_delivery_confirmed_latency_ms: [],
      recovery_events: [],
      task_state_counts: {},
      updatedAt: null,
    });
  }
  function saveMetrics(metrics) { metrics.updatedAt = isoNow(); saveJson(paths.metrics, metrics); }
  function appendEvent(event) { fs.mkdirSync(path.dirname(paths.events), { recursive: true }); fs.appendFileSync(paths.events, JSON.stringify({ at: isoNow(), ...event }) + '\n'); }

  function taskStateCounts(tasks) {
    return tasks.reduce((acc, task) => { acc[task.status] = (acc[task.status] || 0) + 1; return acc; }, {});
  }
  function refreshStateMetrics() {
    const metrics = loadMetrics();
    metrics.task_state_counts = taskStateCounts(loadStore().tasks);
    saveMetrics(metrics);
  }
  function mutateMetrics(mutator) { const metrics = loadMetrics(); mutator(metrics); saveMetrics(metrics); }
  function recordCounter(name, delta = 1) { mutateMetrics((m) => { m.counters[name] = (m.counters[name] || 0) + delta; }); }
  function recordLatency(bucket, ms) { mutateMetrics((m) => { if (Number.isFinite(ms) && ms >= 0) m[bucket].push(ms); m[bucket] = m[bucket].slice(-200); }); }

  function upsertTask(task) {
    const store = loadStore();
    const idx = store.tasks.findIndex((x) => x.id === task.id);
    if (idx >= 0) store.tasks[idx] = task; else store.tasks.push(task);
    store.tasks = store.tasks.slice(-500);
    saveStore(store);
    refreshStateMetrics();
  }
  function mutateTask(taskId, mutator) {
    const store = loadStore();
    const task = store.tasks.find((x) => x.id === taskId);
    if (!task) return null;
    mutator(task);
    saveStore(store);
    refreshStateMetrics();
    return task;
  }
  function findLatestActiveTask(sessionKey) {
    const store = loadStore();
    return [...store.tasks].reverse().find((x) => x.sessionKey === sessionKey && ['pending', 'running', 'internal_complete', 'notification_sent', 'delivery_confirmed'].includes(x.status));
  }
  function rememberRoute(sessionKey, route) {
    const routes = loadRoutes().filter((x) => x.sessionKey !== sessionKey);
    routes.push({ ...route, updatedAt: isoNow() });
    saveRoutes(routes);
  }
  function getRoute(sessionKey) { return loadRoutes().find((x) => x.sessionKey === sessionKey); }

  function transitionTask(task, nextStatus, extras = {}) {
    if (!USER_VISIBLE_STATES.includes(nextStatus)) throw new Error(`invalid status ${nextStatus}`);
    const prev = task.status;
    task.status = nextStatus;
    task.updatedAt = isoNow();
    task.history = task.history || [];
    task.history.push({ from: prev, to: nextStatus, at: task.updatedAt, ...extras });
    Object.assign(task, extras);
    appendEvent({ type: 'state_transition', taskId: task.id, sessionKey: task.sessionKey, from: prev, to: nextStatus });
    return task;
  }

  function createTask(sessionKey, prompt) {
    const trustTier = inferTrustTier(prompt, cfg);
    const validationRequired = trustTier === 'important' && cfg.hardValidationModes.includes(cfg.validationMode || 'important_only');
    const groundingRequired = needsObjectiveGrounding(prompt, cfg);
    const cloneParityRequired = needsCloneParityContract(prompt, cfg);
    const campaignRequired = needsCampaignRuntime(prompt, cfg);
    const surfaceMatrixRequired = needsSurfaceMatrix(prompt, cfg);
    const claimIntegrityRequired = needsClaimIntegrity(prompt, cfg);
    const replyThread = extractReplyThreadContext(prompt);
    const requestedFidelity = inferRequestedFidelity(prompt, cfg);
    const requestedScope = inferRequestedScope(prompt, replyThread);
    const task = {
      id: `${sessionKey}:${clock()}:${hash(prompt)}`,
      sessionKey,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      prompt: summarize(sanitizePrompt(prompt)),
      kind: 'user_visible',
      trustTier,
      status: 'pending',
      completionSummary: '',
      history: [{ from: null, to: 'pending', at: isoNow() }],
      delivery: { attempts: 0, dedupeKeys: [], lastError: null },
      validation: { required: validationRequired, mode: validationRequired ? 'strict' : 'light', passed: !validationRequired, runs: 0, failures: [] },
      honesty: {
        required: needsHonestyGate(prompt, cfg),
        proofPresent: false,
        targetPath: null,
        repoRoot: null,
        manifestPath: null,
        changedProductFiles: [],
        violations: [],
        status: null,
        bootstrapCreated: false,
        overridePath: null,
        overrideApprovedBy: null,
      },
      grounding: {
        required: groundingRequired,
        ambiguousReference: hasAmbiguousReference(prompt),
        proofPresent: false,
        replyThread: {
          present: replyThread.present,
          required: groundingRequired && replyThread.present,
          proofPresent: false,
          replyToId: replyThread.replyToId || null,
          senderLabel: replyThread.senderLabel || null,
          summary: replyThread.summary || null,
        },
      },
      cloneParity: {
        required: cloneParityRequired,
        proofPresent: false,
      },
      claimIntegrity: {
        required: claimIntegrityRequired,
        progressEstimatePresent: false,
        responseFramed: false,
        artifactReferenced: false,
        passed: null,
        autoGenerated: false,
        reportPath: null,
        responseFramePath: null,
        summaryPath: null,
        repoReportPath: null,
        repoResponseFramePath: null,
        repoSummaryPath: null,
        reportGeneratedAt: null,
        generationError: null,
        sourceMatrixPath: null,
        sourceProgramStatePath: null,
        derivedCloneParityPercent: null,
        derivedCampaignReadinessPercent: null,
        proposedPercent: null,
      },
      contract: {
        required: groundingRequired || cloneParityRequired || campaignRequired || surfaceMatrixRequired,
        proofPresent: false,
        requestedFidelity,
        requestedScope,
        stopCondition: campaignRequired ? 'supervisor_green_or_blocker_report' : 'completed_and_delivered',
      },
      campaign: {
        required: campaignRequired,
        proofPresent: false,
        modeRequired: campaignRequired ? 'persistent' : null,
        supervisorStatus: null,
        blockerPresent: false,
      },
      surfaceMatrix: {
        required: surfaceMatrixRequired,
        proofPresent: false,
        status: null,
      },
    };
    upsertTask(task);
    return task;
  }

  function startTask(taskId) { return mutateTask(taskId, (task) => { if (task.status === 'pending') transitionTask(task, 'running'); }); }
  function failTask(taskId, reason, source = 'runtime') {
    return mutateTask(taskId, (task) => {
      if (task.status === 'failed' || task.status === 'closed') return;
      transitionTask(task, 'failed', { failedAt: isoNow(), failureReason: summarize(reason, 400), failureSource: source });
      if (source === 'tool') recordCounter('tool_error_count');
    });
  }
  function completeInternally(taskId, summary, source = 'agent_end') {
    return mutateTask(taskId, (task) => {
      const summaryMax = task.cloneParity?.required || task.claimIntegrity?.required || task.campaign?.required || task.surfaceMatrix?.required
        ? 900
        : task.grounding?.required
          ? 560
          : 280;
      const nextSummary = cleanSummary(summary, summaryMax) || task.completionSummary || `Completed: ${task.prompt}`;
      if (task.status === 'internal_complete') {
        task.completionSummary = nextSummary;
        task.completedAt = task.completedAt || isoNow();
        task.completionSource = source;
        task.updatedAt = isoNow();
        return;
      }
      if (!['pending', 'running'].includes(task.status)) return;
      transitionTask(task, 'internal_complete', {
        completedAt: isoNow(),
        completionSummary: nextSummary,
        completionSource: source,
      });
    });
  }
  function runValidator(taskId, details = {}) {
    return mutateTask(taskId, (task) => {
      task.validation.runs += 1;
      recordCounter('validator_runs');
      const summary = normalizeSoft(`${task.completionSummary} ${JSON.stringify(details)}`);
      const contractPass = !task.contract?.required || hasTaskContractProof(task.completionSummary || '', task.contract || {});
      const groundingPass = !task.grounding?.required || hasGroundingProof(task.completionSummary || '', task.grounding || {});
      const campaignPass = !task.campaign?.required || hasCampaignRuntimeProof(task.completionSummary || '', task.campaign || {});
      const surfaceMatrixPass = !task.surfaceMatrix?.required || hasSurfaceMatrixProof(task.completionSummary || '', task.surfaceMatrix || {}, task.cloneParity || {}, task.campaign || {});
      const clonePass = !task.cloneParity?.required || hasCloneParityProof(task.completionSummary || '', task.cloneParity || {});
      const preHonestyPass = contractPass && groundingPass && campaignPass && surfaceMatrixPass && clonePass;
      const shouldRunHonestyGate = Boolean(task.honesty?.required && preHonestyPass && summaryClaimsProductDiff(task.completionSummary || ''));
      const honestyCheck = shouldRunHonestyGate
        ? evaluateHonestyGate(task.completionSummary || '', task.honesty || {})
        : { required: Boolean(task.honesty?.required), pass: true, status: task.honesty?.required ? 'not_required_for_non_product_or_preblocked_summary' : 'not_required', targetPath: null, repoRoot: null, report: null, reason: null };
      const progressEstimatePresent = hasClaimIntegrityProgressEstimate(task.completionSummary || '', task.prompt || '');
      const claimIntegrityFramePresent = hasClaimIntegrityFrame(task.completionSummary || '');
      const autoClaimIntegrity = autoGenerateClaimIntegrityArtifacts(task);
      const proposedPercent = task.claimIntegrity?.proposedPercent ?? extractProposedPercent(task.completionSummary || '');
      const claimIntegrityArtifactPresent = hasClaimIntegrityArtifactReference(task.completionSummary || '') || Boolean(autoClaimIntegrity?.reportPath || task.claimIntegrity?.reportPath);
      const autoGeneratedCompatible = !progressEstimatePresent
        || !claimIntegrityArtifactPresent
        || proposedPercent == null
        || !Number.isFinite(task.claimIntegrity?.derivedCloneParityPercent)
        || proposedPercent <= (Number(task.claimIntegrity.derivedCloneParityPercent) + 3);
      const claimIntegrityPass = !task.claimIntegrity?.required || !progressEstimatePresent || claimIntegrityFramePresent || (claimIntegrityArtifactPresent && autoGeneratedCompatible);
      const honestyPass = honestyCheck.pass;
      const pass = !task.validation.required || (summary.length >= 20 && !summary.includes('error:') && !summary.includes('failed') && contractPass && groundingPass && campaignPass && surfaceMatrixPass && clonePass && honestyPass && claimIntegrityPass);
      task.validation.passed = pass;
      task.validation.lastRunAt = isoNow();
      task.validation.lastDetails = details;
      task.honesty = task.honesty || { required: false, proofPresent: false, targetPath: null, repoRoot: null, manifestPath: null, changedProductFiles: [], violations: [], status: null, bootstrapCreated: false, overridePath: null, overrideApprovedBy: null };
      task.honesty.proofPresent = honestyPass;
      task.honesty.targetPath = honestyCheck.targetPath || null;
      task.honesty.repoRoot = honestyCheck.repoRoot || null;
      task.honesty.manifestPath = honestyCheck.report?.honesty?.manifestPath || null;
      task.honesty.changedProductFiles = honestyCheck.report?.honesty?.changedProductFiles || [];
      task.honesty.violations = honestyCheck.report?.honesty?.violations || (honestyCheck.reason ? [{ rule: honestyCheck.reason, path: honestyCheck.targetPath || task.prompt, message: honestyCheck.reason }] : []);
      task.honesty.status = honestyCheck.status || (honestyPass ? 'green' : task.honesty.required ? 'red' : 'not_required');
      task.honesty.bootstrapCreated = Boolean(honestyCheck.bootstrap?.created || honestyCheck.bootstrap?.updated);
      task.honesty.overridePath = honestyCheck.override?.path || null;
      task.honesty.overrideApprovedBy = honestyCheck.override?.data?.approvedBy || null;
      task.contract = task.contract || { required: false, proofPresent: false, requestedFidelity: null, requestedScope: null, stopCondition: null };
      task.contract.proofPresent = contractPass;
      task.grounding = task.grounding || { required: false, ambiguousReference: false, proofPresent: false, replyThread: { present: false, required: false, proofPresent: false } };
      task.grounding.proofPresent = groundingPass;
      task.grounding.replyThread = task.grounding.replyThread || { present: false, required: false, proofPresent: false };
      task.grounding.replyThread.proofPresent = !task.grounding.replyThread.required || normalizeSoft(task.completionSummary || '').includes('reply anchor:');
      task.campaign = task.campaign || { required: false, proofPresent: false, modeRequired: null, supervisorStatus: null, blockerPresent: false };
      task.campaign.proofPresent = campaignPass;
      task.campaign.blockerPresent = hasBlockerReport(task.completionSummary || '');
      task.campaign.supervisorStatus = /supervisor status:\s*(green|complete)|supervisor confirmed completion:\s*(yes|true)|allcomplete:\s*true/.test(normalizeSoft(task.completionSummary || ''))
        ? 'green'
        : /supervisor status:\s*(red|blocked|incomplete|not complete)|supervisor confirmed completion:\s*(no|false)|allcomplete:\s*false/.test(normalizeSoft(task.completionSummary || ''))
          ? 'red'
          : null;
      task.surfaceMatrix = task.surfaceMatrix || { required: false, proofPresent: false, status: null };
      task.surfaceMatrix.proofPresent = surfaceMatrixPass;
      task.surfaceMatrix.status = surfaceMatrixState(task.completionSummary || '');
      task.claimIntegrity = task.claimIntegrity || { required: false, progressEstimatePresent: false, responseFramed: false, artifactReferenced: false, passed: null };
      task.claimIntegrity.progressEstimatePresent = progressEstimatePresent;
      task.claimIntegrity.responseFramed = claimIntegrityFramePresent;
      task.claimIntegrity.artifactReferenced = claimIntegrityArtifactPresent;
      task.claimIntegrity.passed = claimIntegrityPass;
      task.claimIntegrity.proposedPercent = proposedPercent;
      task.cloneParity = task.cloneParity || { required: false, proofPresent: false };
      task.cloneParity.proofPresent = clonePass;
      if (!pass) {
        const reason = task.grounding.replyThread.required && !task.grounding.replyThread.proofPresent
          ? 'reply_thread_anchor_missing'
          : task.honesty.required && !task.honesty.proofPresent
            ? (task.honesty.violations?.[0]?.rule || 'honesty_gate_failed')
          : task.contract.required && !task.contract.proofPresent
            ? 'task_contract_proof_missing'
          : task.campaign.required && !task.campaign.proofPresent
            ? (task.campaign.supervisorStatus === 'red' ? 'campaign_stopped_while_supervisor_red' : 'campaign_runtime_proof_missing')
          : task.claimIntegrity?.required && task.claimIntegrity.progressEstimatePresent && !task.claimIntegrity.passed
            ? (task.claimIntegrity.artifactReferenced && !autoGeneratedCompatible ? 'claim_integrity_progress_estimate_exceeds_generated_report' : 'claim_integrity_progress_estimate_unbacked')
          : task.surfaceMatrix.required && !task.surfaceMatrix.proofPresent
            ? 'surface_matrix_proof_missing_or_incomplete'
          : task.cloneParity.required && !task.cloneParity.proofPresent
            ? 'clone_parity_proof_missing_or_partial'
          : groundingPass
            ? 'summary_missing_or_failed'
            : 'objective_grounding_proof_missing';
        task.validation.failures.push({ at: isoNow(), reason });
        recordCounter('validator_failures');
      }
    });
  }
  function markNotificationSent(taskId, info = {}) {
    return mutateTask(taskId, (task) => {
      if (task.status !== 'internal_complete') return;
      transitionTask(task, 'notification_sent', { notificationSentAt: isoNow(), ...info });
      const latency = parseMs(task.notificationSentAt) - parseMs(task.completedAt);
      recordLatency('completion_to_notification_latency_ms', latency);
    });
  }
  function markDeliveryConfirmed(taskId, info = {}) {
    return mutateTask(taskId, (task) => {
      if (!['notification_sent', 'delivery_confirmed'].includes(task.status)) return;
      if (task.status !== 'delivery_confirmed') {
        transitionTask(task, 'delivery_confirmed', { deliveryConfirmedAt: isoNow(), ...info });
        const latency = parseMs(task.deliveryConfirmedAt) - parseMs(task.completedAt);
        recordLatency('completion_to_delivery_confirmed_latency_ms', latency);
      }
    });
  }
  function closeTask(taskId, reason = 'user_visible_delivery_confirmed') {
    return mutateTask(taskId, (task) => {
      if (!['delivery_confirmed', 'failed'].includes(task.status)) return;
      transitionTask(task, 'closed', { closedAt: isoNow(), closeReason: reason });
    });
  }

  function recoverStaleTasks() {
    const store = loadStore();
    const now = clock();
    let recovered = 0;
    for (const task of store.tasks) {
      if (['pending', 'running'].includes(task.status) && now - parseMs(task.updatedAt) >= cfg.escalationAfterMs) {
        task.recoveredAt = isoNow();
        task.recoveryReason = 'restart_or_stale_running';
        task.status = 'internal_complete';
        task.completedAt = task.completedAt || isoNow();
        task.history = task.history || [];
        task.history.push({ from: 'running', to: 'internal_complete', at: isoNow(), recovery: true });
        recovered += 1;
      }
    }
    if (recovered) {
      saveStore(store);
      refreshStateMetrics();
      mutateMetrics((m) => { m.counters.recovery_success_count += recovered; m.recovery_events.push({ at: isoNow(), recovered }); m.recovery_events = m.recovery_events.slice(-100); });
    }
    return recovered;
  }

  async function autoDeliverCompletedTasks(runtimeCfg = {}) {
    const store = loadStore();
    const now = clock();
    let changed = false;
    for (const task of store.tasks) {
      if (task.status !== 'internal_complete') continue;
      if (task.validation?.required && !task.validation?.passed) continue;
      if (now - parseMs(task.completedAt) < cfg.autoDeliveryAfterMs) continue;
      if (task.delivery?.lastAttemptAt && now - parseMs(task.delivery.lastAttemptAt) < cfg.retryBackoffMs) continue;
      const route = getRoute(task.sessionKey);
      if (!route?.channelId || !route?.to) continue;
      const dedupeKey = hash(`${task.id}:${task.completedAt || ''}:${task.completionSummary || ''}`);
      if (task.delivery?.dedupeKeys?.includes(dedupeKey)) {
        recordCounter('duplicate_reply_count');
        continue;
      }
      task.delivery = task.delivery || { attempts: 0, dedupeKeys: [], lastError: null };
      task.delivery.attempts += 1;
      task.delivery.lastAttemptAt = isoNow();
      changed = true;
      try {
        await deliver({
          cfg: runtimeCfg,
          channel: route.channelId,
          to: route.to,
          accountId: route.accountId,
          payloads: [{ text: buildCompletionMessage(task), replyToId: route.replyToId }],
          replyToId: route.replyToId,
          session: { key: task.sessionKey },
          bestEffort: false,
        });
        task.delivery.dedupeKeys.push(dedupeKey);
        task.delivery.lastError = null;
        task.notificationReceipt = { dedupeKey, channelId: route.channelId, to: route.to, replyToId: route.replyToId };
        task.notificationSentAt = isoNow();
        task.status = 'notification_sent';
        task.history = task.history || [];
        task.history.push({ from: 'internal_complete', to: 'notification_sent', at: task.notificationSentAt, auto: true });
        recordLatency('completion_to_notification_latency_ms', parseMs(task.notificationSentAt) - parseMs(task.completedAt));
      } catch (error) {
        task.delivery.lastError = String(error);
        logger.warn?.(`completion-integrity auto-delivery failed session=${task.sessionKey}: ${String(error)}`);
        recordCounter('tool_error_count');
      }
    }
    if (changed) { saveStore(store); refreshStateMetrics(); }
  }

  function maybeCountSilentSuccess(task) {
    if (task.status === 'internal_complete' && !task.notificationSentAt && clock() - parseMs(task.completedAt) >= cfg.escalationAfterMs) {
      recordCounter('silent_success_count');
      return true;
    }
    return false;
  }
  function validateFalseDone(task) {
    if ((task.status === 'delivery_confirmed' || task.status === 'closed') && task.validation?.required && !task.validation?.passed) {
      recordCounter('false_done_count');
      return true;
    }
    return false;
  }

  function getPendingAnnouncements(sessionKey) {
    return loadStore().tasks.filter((t) => t.sessionKey === sessionKey && ['internal_complete', 'notification_sent'].includes(t.status));
  }

  function findLatestCompletionSensitiveTask(sessionKey) {
    return [...loadStore().tasks].reverse().find((t) => t.sessionKey === sessionKey && ['pending', 'running', 'internal_complete', 'notification_sent', 'delivery_confirmed'].includes(t.status));
  }

  function enforceOutboundHonesty(sessionKey, content) {
    if (!sessionKey) return null;
    const task = findLatestCompletionSensitiveTask(sessionKey);
    if (!task?.honesty?.required) return null;
    if (task.honesty.status === 'green' || task.honesty.status === 'override') return null;
    if (!looksLikeCompletionClaim(content, task)) return null;
    return { task, content: honestyBlockText(task) };
  }

  return {
    cfg,
    paths,
    createTask,
    startTask,
    failTask,
    completeInternally,
    runValidator,
    markNotificationSent,
    markDeliveryConfirmed,
    closeTask,
    rememberRoute,
    getRoute,
    loadStore,
    loadMetrics,
    autoDeliverCompletedTasks,
    recoverStaleTasks,
    getPendingAnnouncements,
    maybeCountSilentSuccess,
    validateFalseDone,
    isUserVisibleTask: (prompt) => isUserVisibleTask(prompt, cfg),
    inferTrustTier: (prompt) => inferTrustTier(prompt, cfg),
    buildPromptInjection(sessionKey) {
      const pending = getPendingAnnouncements(sessionKey);
      for (const task of pending) maybeCountSilentSuccess(task);
      const active = findLatestActiveTask(sessionKey);
      const replyThread = active?.grounding?.replyThread?.present ? active.grounding.replyThread : latestReplyThreadBySession.get(sessionKey);
      const lines = [];
      if (replyThread?.present) {
        lines.push(
          'REPLY_THREAD_GROUNDING',
          'This inbound message is a reply to an earlier message. Treat that replied message as the primary anchor before searching the repo or memory for alternatives.',
          replyThread.summary ? `Reply anchor summary: "${replyThread.summary}"` : `Reply anchor id: ${replyThread.replyToId || 'unknown'}`,
          replyThread.senderLabel ? `Reply anchor sender: ${replyThread.senderLabel}` : 'Reply anchor sender: unknown',
          '- Resolve phrases like "this", "that", "continue", "previous roadmap", and phase numbers against the replied message first.',
          '- Do not override a clear reply-thread anchor just because the repo contains other phase-shaped docs.',
          active?.grounding?.required
            ? '- In your grounding proof, include `Reply anchor: ...` with the specific phase/program/scope extracted from the replied message.'
            : '- When answering memory/history questions, explain the reply-anchor context first instead of acting like the scope is unknown.'
        );
      }
      if (active?.contract?.required) {
        lines.push(
          'TASK_CONTRACT',
          'Important execution task: lock a task contract before coding or claiming completion.',
          `- Fidelity: ${active.contract.requestedFidelity || 'production_slice'} (allowed lattice: ${FIDELITY_LATTICE.join(' < ')})`,
          `- Scope: ${active.contract.requestedScope || 'unspecified'}`,
          `- Stop condition: ${active.contract.stopCondition || 'completed_and_delivered'}`,
          'Required contract proof for completion:',
          '- Fidelity: ...',
          '- Scope: ...',
          '- Stop condition: ...',
          '- Do not silently shrink scope or downgrade fidelity mid-run.'
        );
      }
      if (active?.campaign?.required) {
        lines.push(
          'CAMPAIGN_RUNTIME',
          'This task requires campaign runtime semantics, not a one-shot pass.',
          '- One-shot “did one pass and stopped” behavior is invalid unless there is an explicit blocker report.',
          '- Use persistent campaign mode until the supervisor is green or a real blocker is documented.',
          'Required campaign proof for completion/reporting:',
          '- Campaign mode: persistent',
          '- Supervisor status: green (for completion) OR red with Blocker: ... and Next action: ... (for a blocker report)',
          '- If supervisor is red and there is no blocker report, keep going rather than stopping.'
        );
      }
      if (active?.surfaceMatrix?.required) {
        lines.push(
          'SURFACE_MATRIX',
          'This task requires a surface matrix/checklist derived from the requested scope.',
          '- Build/maintain a machine-readable surface matrix or checklist for the requested phases/programs/surfaces.',
          '- Supervisor truth gate must be derived from that matrix, not only from file existence.',
          'Required matrix proof for completion/reporting:',
          '- Surface matrix: <artifact path or identifier>',
          '- Surface matrix status: all_complete / partial / blocked',
          '- For full clone/parity claims, the matrix must be all_complete.'
        );
      }
      if (active?.cloneParity?.required) {
        lines.push(
          'CLONE_PARITY_CONTRACT',
          'A request for a 1:1/full/exact clone means parity-first, not MVP-first.',
          '- Do not silently reinterpret clone/parity work as a prototype, working slice, first pass, or mini version.',
          '- Completion is invalid unless the result is presented as full parity for the requested scope.',
          'Required clone proof for completion:',
          '- Parity status: full',
          '- Surface coverage: list the requested clone surfaces/programs covered',
          '- Parity evidence: list the concrete parity checks/tests run',
          '- Remaining gaps: none, or only clearly minor polish items',
          '- If the result is partial, prototype, scaffold, first-pass, or missing major surfaces, say so and do not claim completion.'
        );
      }
      if (active?.honesty?.required) {
        lines.push(
          'HONESTY_GATE',
          'This task is under the global surface-honesty policy for Cortex/OpenClaw work.',
          '- If the target repo has no honesty manifest yet, the validator will bootstrap a starter one automatically on first enforcement.',
          '- If you change real product files, update the target repo’s `surface-honesty.json` (or equivalent configured honesty manifest).',
          '- Changed product files must be declared, marked `real`, and carry concrete evidence.tests entries.',
          '- Do not claim completion unless the honesty gate is green for the target repo/path.',
          'Required honesty proof for completion/reporting:',
          '- Honesty manifest: <path>',
          '- Honesty gate: green / not_required',
          '- Changed product surfaces: <list or none>',
          '- Honesty evidence: <tests or executable checks that back the declared real surfaces>'
        );
      }
      if (active?.claimIntegrity?.required) {
        lines.push(
          'CLAIM_INTEGRITY',
          '- Do not give intuition-only completion or parity percentages.',
          '- Separate execution readiness from product parity.',
          '- If you include a real surface-matrix path plus supervisor state, the completion-integrity runtime can compile a claim-integrity artifact automatically.',
          '- If you give a percentage, it must be backed by a claim-integrity artifact or a structured frame with these fields:',
          '  - Observed:',
          '  - Estimated:',
          '  - Confidence:',
          '  - What\'s missing:',
          '  - What would have to be true for a higher estimate:',
          '- If you do not have an artifact-backed rubric yet, say unknown instead of guessing.'
        );
      }
      if (active?.grounding?.required) {
        lines.push(
          'OBJECTIVE_GROUNDING',
          'Important implementation task: before coding or claiming completion, resolve the exact objective anchor.',
          'Required grounding proof for this task:',
          '- Anchor: name the exact prior artifact/message/roadmap you are following.',
          active?.grounding?.replyThread?.required ? '- Reply anchor: restate the replied message that the current request is anchored to.' : '- Reply anchor: include this only when the current message is a reply and the replied message sets scope.',
          '- Target path: name the repo/path/codebase you are changing.',
          '- Implementation surface: say whether this is product code, scaffolding/control-plane, docs/tests, or mixed.',
          '- Diff scope: before claiming implementation, verify changed files include real product-surface files; if not, explicitly say scaffolding only and do not claim feature completion.',
          '- If the anchor or target path cannot be named confidently, stop and ask instead of guessing.',
          active.grounding.ambiguousReference ? '- Warning: the prompt contains ambiguous references (for example: this / do it / previous roadmap / phase numbers). Resolve them against the immediately previous user-visible artifact first.' : '- Prompt does not look reference-ambiguous, but grounding proof is still required before claiming completion.'
        );
      }
      if (pending.length) {
        lines.push(
          'COMPLETION_INTEGRITY',
          'A previously requested user-visible task completed and must be clearly disclosed before anything else.',
          'Use this structure naturally: done, evidence, what remains.',
          'Do not treat the task as closed until delivery is confirmed.',
          'Pending completed tasks:',
          ...pending.slice(-3).map((t) => `- ${t.completionSummary || t.prompt} [state=${t.status}; trust=${t.trustTier}]`),
        );
      }
      return lines.length ? { appendSystemContext: lines.join('\n') } : undefined;
    },
    onMessageReceived(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      if (!sessionKey) return;
      rememberRoute(sessionKey, {
        sessionKey,
        channelId: ctx?.channelId,
        accountId: ctx?.accountId,
        to: typeof event?.from === 'string' ? event.from : undefined,
        conversationId: ctx?.conversationId,
        replyToId: event?.metadata?.messageId,
      });
    },
    onBeforePromptBuild(event, ctx) {
      const prompt = typeof event?.prompt === 'string' ? event.prompt : '';
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      if (!prompt || !sessionKey) return;
      const replyThread = extractReplyThreadContext(prompt);
      if (replyThread.present) {
        latestReplyThreadBySession.set(sessionKey, replyThread);
        maybePromoteReplyAnchorMemory(prompt, sessionKey, replyThread);
      } else {
        latestReplyThreadBySession.delete(sessionKey);
      }
      const active = findLatestActiveTask(sessionKey);
      if (!active && isUserVisibleTask(prompt, cfg)) {
        const task = createTask(sessionKey, prompt);
        startTask(task.id);
      }
      return this.buildPromptInjection(sessionKey);
    },
    onSubagentEnded(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      if (!sessionKey) return;
      const task = findLatestActiveTask(sessionKey);
      if (!task) return;
      completeInternally(task.id, extractText(event?.result) || `Subagent completed for: ${task.prompt}`, 'subagent_ended');
      runValidator(task.id, { source: 'subagent_ended' });
    },
    onAgentEnd(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      if (!sessionKey) return;
      const task = findLatestActiveTask(sessionKey);
      if (!task) return;
      if (!event?.success) {
        failTask(task.id, 'agent_end reported failure');
        return;
      }
      const summary = extractText(event?.messages) || extractText(event?.result) || task.prompt;
      completeInternally(task.id, summary, 'agent_end');
      runValidator(task.id, { source: 'agent_end', success: true });
    },
    onMessageSent(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      if (!sessionKey) return;
      const task = findLatestActiveTask(sessionKey);
      if (!task) return;
      if (task.status === 'internal_complete') markNotificationSent(task.id, { source: 'message_sent' });
      if (task.status === 'notification_sent') {
        const outboundText = normalizeSoft(event?.content || event?.text || '');
        const expected = normalizeSoft(buildCompletionMessage(task));
        if (!outboundText || expected.includes(outboundText.slice(0, 24)) || outboundText.includes('done:')) {
          markDeliveryConfirmed(task.id, { source: 'message_sent' });
          closeTask(task.id);
        }
      }
    },
    onMessageSending(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      const blocked = enforceOutboundHonesty(sessionKey, event?.content || '');
      if (!blocked) return;
      return { content: blocked.content };
    },
    onBeforeMessageWrite(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || event?.sessionKey || '');
      if (!sessionKey) return;
      const signal = parseRuntimeMessageSignal(event?.message);
      if (!signal) return;
      const task = [...loadStore().tasks].reverse().find((t) => t.sessionKey === sessionKey && ['pending', 'running', 'internal_complete'].includes(t.status));
      if (!task) return;
      if (signal.kind === 'failed') {
        failTask(task.id, signal.summary, 'runtime_message');
        return;
      }
      completeInternally(task.id, signal.summary, 'runtime_message');
      runValidator(task.id, { source: 'runtime_message', signal: signal.kind });
    },
    onBeforeMessageWriteGuard(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || event?.sessionKey || '');
      const role = event?.message?.role;
      const content = extractText(event?.message?.content || event?.message?.text || event?.message);
      if (!sessionKey || role !== 'assistant') return;
      const blocked = enforceOutboundHonesty(sessionKey, content);
      if (!blocked) return;
      return { message: { ...event.message, content: blocked.content } };
    },
  };
}

export default function register(api) {
  const cfg = api.config || api.pluginConfig || {};
  const engine = createCompletionIntegrityEngine(cfg, { logger: api.logger, deliver: defaultDeliver });
  let timer = null;

  api.on('message_received', async (event, ctx) => engine.onMessageReceived(event, ctx));
  api.on('message_sending', async (event, ctx) => engine.onMessageSending(event, ctx));
  api.on('before_prompt_build', async (event, ctx) => engine.onBeforePromptBuild(event, ctx));
  api.on('subagent_ended', async (event, ctx) => engine.onSubagentEnded(event, ctx));
  api.on('agent_end', async (event, ctx) => engine.onAgentEnd(event, ctx));
  api.on('message_sent', async (event, ctx) => engine.onMessageSent(event, ctx));
  api.on('before_message_write', (event, ctx) => engine.onBeforeMessageWriteGuard(event, ctx) || engine.onBeforeMessageWrite(event, ctx));
  api.on('after_tool_call', async (event, ctx) => {
    const output = event?.result;
    const errorText = typeof output?.error === 'string' ? output.error : (output?.ok === false ? JSON.stringify(output) : '');
    if (!errorText) return;
    const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
    const task = sessionKey ? engine.loadStore().tasks.find((t) => t.sessionKey === sessionKey && ['pending', 'running', 'internal_complete', 'notification_sent'].includes(t.status)) : null;
    if (task) engine.failTask(task.id, errorText, 'tool');
  });
  api.on('gateway_start', async () => {
    engine.recoverStaleTasks();
    if (timer) clearInterval(timer);
    timer = setInterval(() => { void engine.autoDeliverCompletedTasks(api.config); }, engine.cfg.pollIntervalMs);
    void engine.autoDeliverCompletedTasks(api.config);
  });
  api.on('gateway_stop', async () => { if (timer) clearInterval(timer); timer = null; });
}
