import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseAgentWorkSpec } from '../agent-work-dsl/index.mjs';

export const ORCHESTRATION_LEARNING_LEDGER_SCHEMA = 'clawd.orchestration_learning_ledger.v1';
export const ORCHESTRATION_LEARNING_ARTIFACT_SCHEMA = 'clawd.orchestration_learning_artifact.v1';
export const ORCHESTRATION_LEARNING_CONTEXT_SCHEMA = 'clawd.orchestration_learning_context.v1';
export const AGENT_WORK_PATTERN_FRAGMENT_FORMAT = 'agent_work_v0.1_fragment';

function iso(value = Date.now()) {
  return new Date(value).toISOString();
}

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function slug(value, fallback = 'learning_artifact') {
  const out = clean(value || fallback)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return out || fallback;
}

function stableList(value) {
  if (Array.isArray(value)) return [...new Set(value.flatMap(stableList).map(clean).filter(Boolean))].sort();
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string' && value.includes(',')) return stableList(value.split(','));
  const text = clean(value);
  return text ? [text] : [];
}

function orderedUnique(value) {
  const out = [];
  for (const entry of Array.isArray(value) ? value.flatMap(stableList) : stableList(value)) {
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

function sha256Text(text = '') {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function readText(filePath, fallback = '') {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

function numeric(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolish(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function artifactBucket(kind = 'architecture_pattern') {
  const normalized = slug(kind);
  if (/anti/.test(normalized)) return 'antiPatterns';
  if (/repair/.test(normalized)) return 'repairStrategies';
  return 'architecturePatterns';
}

function artifactKindForBucket(bucket = 'architecturePatterns') {
  if (bucket === 'antiPatterns') return 'anti_pattern';
  if (bucket === 'repairStrategies') return 'repair_strategy';
  return 'architecture_pattern';
}

export function createLearningLedger(input = {}) {
  const generatedAt = input.generatedAt || iso();
  return {
    schemaVersion: ORCHESTRATION_LEARNING_LEDGER_SCHEMA,
    generatedAt,
    updatedAt: input.updatedAt || generatedAt,
    project: clean(input.project || input.benchmarkId || 'orchestration'),
    description: clean(input.description || 'Learned architecture and orchestration patterns promoted by quality gates.'),
    architecturePatterns: Array.isArray(input.architecturePatterns) ? input.architecturePatterns : [],
    antiPatterns: Array.isArray(input.antiPatterns) ? input.antiPatterns : [],
    repairStrategies: Array.isArray(input.repairStrategies) ? input.repairStrategies : [],
    promotions: Array.isArray(input.promotions) ? input.promotions : [],
    quarantines: Array.isArray(input.quarantines) ? input.quarantines : []
  };
}

export function normalizeLearningLedger(input = {}) {
  const ledger = createLearningLedger(input || {});
  for (const bucket of ['architecturePatterns', 'antiPatterns', 'repairStrategies']) {
    ledger[bucket] = (ledger[bucket] || []).map((artifact) => normalizeLearningArtifact({ ...artifact, kind: artifact.kind || artifactKindForBucket(bucket) }));
  }
  return ledger;
}

export function readLearningLedger(filePath, fallback = createLearningLedger()) {
  if (!filePath) return normalizeLearningLedger(fallback);
  return normalizeLearningLedger(readJson(filePath, fallback) || fallback);
}

export function writeLearningLedger(filePath, ledger) {
  return writeJson(filePath, normalizeLearningLedger({ ...ledger, updatedAt: iso() }));
}

export function renderAgentWorkPatternFragment(artifact = {}) {
  const id = slug(artifact.id || artifact.title || artifact.kind || 'learned_pattern');
  const kind = slug(artifact.kind || 'architecture_pattern');
  const files = stableList(artifact.files || artifact.targetFiles || artifact.fileAreas || artifact.match?.files);
  const verifiers = stableList(artifact.verifiers || artifact.verification || artifact.match?.verifiers);
  const layers = stableList(artifact.architecture?.layers || artifact.layers || artifact.requiredLayers);
  const routeNamespaces = stableList(artifact.routeNamespaces || artifact.match?.routeNamespaces);
  const gates = stableList(artifact.gates || artifact.qualityGates || [
    'architectureFitnessScore >= 0.90',
    'architectureViolationCount == 0',
    'routeCollisionCount == 0'
  ]);
  const lines = [
    `template learned_${id}`,
    `  goal: ${clean(artifact.summary || artifact.title || `Apply learned ${kind} pattern ${id}`)}`,
    files.length ? `  files: ${files.join(', ')}` : '',
    verifiers.length ? `  verify: ${verifiers.join(', ')}` : '',
    `  lane: ${clean(artifact.lane || artifact.domain || 'learned_architecture')}`,
    `  kind: ${kind}`,
    layers.length ? `  architecture_layers: ${layers.join(', ')}` : '',
    routeNamespaces.length ? `  route_namespaces: ${routeNamespaces.join(', ')}` : '',
    '',
    `evidence learned_${id}_quality`,
    ...gates.map((gate) => `  require: ${gate}`)
  ].filter((line) => line !== '');
  return `${lines.join('\n')}\n`;
}

export function normalizeAgentWorkLanguageFragment(source = '', fallbackArtifact = {}) {
  const text = clean(source) || renderAgentWorkPatternFragment(fallbackArtifact);
  let parsed = null;
  let parseError = null;
  try { parsed = parseAgentWorkSpec(text); }
  catch (error) { parseError = error?.message || String(error); }
  return {
    format: AGENT_WORK_PATTERN_FRAGMENT_FORMAT,
    languageVersion: 'v0.1',
    source: text,
    parsed,
    parseOk: !parseError,
    parseError
  };
}

export function normalizeLearningArtifact(input = {}, options = {}) {
  const kind = slug(input.kind || options.kind || 'architecture_pattern');
  const title = clean(input.title || input.label || input.id || kind);
  const idSource = input.id || `${kind}:${title}:${stableList(input.files || input.targetFiles || input.fileAreas).join('|')}`;
  const id = slug(idSource, kind);
  const evidence = input.evidence || input.architectureEvidence || {};
  const files = stableList(input.files || input.targetFiles || input.fileAreas || evidence.modifiedPrimaryRuntimeFiles || evidence.evidencePrimaryRuntimeFiles);
  const verifiers = stableList(input.verifiers || input.verification || input.tests);
  const routeNamespaces = stableList(input.routeNamespaces || input.routes || input.routeNamespace);
  const layers = stableList(input.architecture?.layers || input.layers || evidence.layers || evidence.modifiedRequiredLayers);
  const agentWorkLanguage = normalizeAgentWorkLanguageFragment(input.agentWorkLanguage?.source || input.agentWork || '', {
    ...input,
    kind,
    id,
    title,
    files,
    verifiers,
    routeNamespaces,
    architecture: { ...(input.architecture || {}), layers }
  });
  const trust = clean(input.trust || input.status || options.trust || 'candidate');
  const qualityScore = numeric(input.qualityScore ?? input.score ?? evidence.qualityScore ?? evidence.architectureFitnessScore, null);
  const normalized = {
    schemaVersion: ORCHESTRATION_LEARNING_ARTIFACT_SCHEMA,
    id,
    kind,
    title,
    summary: clean(input.summary || input.description || title),
    trust,
    promoted: input.promoted === true || trust === 'trusted',
    project: clean(input.project || options.project || ''),
    benchmarkId: clean(input.benchmarkId || options.benchmarkId || ''),
    runId: clean(input.runId || options.runId || ''),
    surfaceIds: stableList(input.surfaceIds || input.sourceSurfaceIds || evidence.surfaceIds),
    lane: clean(input.lane || input.domain || ''),
    domain: clean(input.domain || ''),
    files,
    verifiers,
    routeNamespaces,
    architecture: {
      layers,
      runtimeIntegrated: input.architecture?.runtimeIntegrated ?? evidence.runtimeIntegrated ?? evidence.runtimeIntegrationEvidence?.ok ?? null,
      productDeltaRequired: input.architecture?.productDeltaRequired ?? true,
      notes: clean(input.architecture?.notes || '')
    },
    quality: {
      score: qualityScore,
      testFailureRegressionCount: numeric(input.quality?.testFailureRegressionCount ?? input.testFailureRegressionCount, null),
      routeCollisionCount: numeric(input.quality?.routeCollisionCount ?? input.routeCollisionCount, null),
      duplicateNormalizedLineRatio: numeric(input.quality?.duplicateNormalizedLineRatio ?? input.duplicateNormalizedLineRatio, null),
      architectureFitnessScore: numeric(input.quality?.architectureFitnessScore ?? input.architectureFitnessScore ?? qualityScore, null),
      architectureViolationCount: numeric(input.quality?.architectureViolationCount ?? input.architectureViolationCount, null)
    },
    failure: input.failure || null,
    provenance: {
      promotedAt: input.provenance?.promotedAt || input.promotedAt || null,
      sourceRunRoot: input.provenance?.sourceRunRoot || input.sourceRunRoot || options.sourceRunRoot || null,
      sourcePatchId: input.provenance?.sourcePatchId || input.patchId || input.shardId || null,
      source: clean(input.provenance?.source || input.source || options.source || 'manual')
    },
    agentWorkLanguage,
    metadata: input.metadata || {}
  };
  normalized.digest = sha256Text(JSON.stringify({ kind: normalized.kind, title: normalized.title, files: normalized.files, summary: normalized.summary, agentWorkLanguage: normalized.agentWorkLanguage.source }));
  return normalized;
}

function sameArtifact(a = {}, b = {}) {
  return a.id === b.id || (a.digest && b.digest && a.digest === b.digest);
}

export function upsertLearningArtifact(ledgerInput = {}, artifactInput = {}) {
  const ledger = normalizeLearningLedger(ledgerInput);
  const artifact = normalizeLearningArtifact(artifactInput, { project: ledger.project });
  const bucket = artifactBucket(artifact.kind);
  const existingIndex = ledger[bucket].findIndex((entry) => sameArtifact(entry, artifact));
  if (existingIndex >= 0) ledger[bucket][existingIndex] = { ...ledger[bucket][existingIndex], ...artifact };
  else ledger[bucket].push(artifact);
  ledger.updatedAt = iso();
  if (artifact.trust === 'trusted') ledger.promotions.push({ at: iso(), artifactId: artifact.id, kind: artifact.kind, reason: 'trusted_learning_artifact_upsert' });
  if (artifact.trust === 'quarantined') ledger.quarantines.push({ at: iso(), artifactId: artifact.id, kind: artifact.kind, reason: artifact.failure?.reason || 'learning_artifact_quarantined' });
  return ledger;
}

function fieldText(value) {
  return stableList(value).join(' ').toLowerCase();
}

function firstMarkdownHeading(text = '', fallback = 'post-run hardening') {
  const heading = String(text || '').split('\n').map((line) => line.trim()).find((line) => /^#\s+/.test(line));
  return clean(heading?.replace(/^#+\s*/, '') || fallback);
}

function firstMeaningfulParagraph(text = '', fallback = '') {
  const lines = String(text || '').split('\n').map((line) => line.trim());
  const paragraph = [];
  for (const line of lines) {
    if (!line || /^#/.test(line) || /^```/.test(line) || /^[-*]\s+`/.test(line)) {
      if (paragraph.length) break;
      continue;
    }
    if (/^(Generated|File|Command run|Result):/i.test(line)) continue;
    paragraph.push(line.replace(/^[-*]\s+/, ''));
    if (paragraph.join(' ').length > 220) break;
  }
  return clean(paragraph.join(' ') || fallback);
}

function normalizeEvidencePath(value = '', { runRoot = null } = {}) {
  let text = clean(value)
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/^a\//, '')
    .replace(/^b\//, '');
  if (!text || text === '/dev/null') return '';
  if (/^(node|npm|pnpm|yarn|bun|npx)\s+/.test(text)) return '';
  text = text.split('\t')[0].trim();
  if (runRoot && path.isAbsolute(text) && text.startsWith(path.resolve(runRoot) + path.sep)) {
    text = path.relative(runRoot, text);
  }
  for (const marker of ['/review_bundle/winner/', '/postrun_hardened_winner/workspace/', '/workspace/']) {
    const index = text.indexOf(marker);
    if (index >= 0) {
      text = text.slice(index + marker.length);
      break;
    }
  }
  text = text.replace(/^postrun_hardened_winner\/workspace\//, '').replace(/^workspace\//, '').replaceAll(path.sep, '/');
  if (!text || text.startsWith('/tmp/') || text.startsWith('tmp/')) return '';
  if (!/\.(mjs|js|ts|tsx|jsx|json|md|txt|test\.mjs)$/.test(text) && !text.includes('/tests/') && !text.includes('/src/')) return '';
  return text;
}

function extractEvidencePathsFromText(text = '', options = {}) {
  const out = [];
  const add = (value) => {
    const normalized = normalizeEvidencePath(value, options);
    if (normalized) out.push(normalized);
  };
  for (const match of String(text || '').matchAll(/(?:^|\n)File:\s*`?([^`\n]+)`?/g)) add(match[1]);
  for (const match of String(text || '').matchAll(/(?:^|\n)(?:---|\+\+\+)\s+([^\n]+)/g)) add(match[1]);
  for (const match of String(text || '').matchAll(/`([^`]*(?:src|tests|apps|packages)\/[^`]+)`/g)) add(match[1]);
  return stableList(out);
}

function extractVerifierCommandsFromText(text = '') {
  const commands = [];
  for (const match of String(text || '').matchAll(/`([^`]*(?:node|npm|pnpm|yarn|bun)\s+[^`]+)`/g)) {
    const command = clean(match[1]);
    if (command && !command.includes('<hardened-workspace>')) commands.push(command);
  }
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim().replace(/^[-*]\s+/, '');
    const match = trimmed.match(/^((?:node|npm|pnpm|yarn|bun)\s+.+?)\s+[—-]\s+(?:pass|ok)/i);
    if (match) commands.push(clean(match[1]));
  }
  return stableList(commands);
}

function postRunAgentWorkFragment({ id, kind, summary, files = [], verifiers = [], gates = [] } = {}) {
  const artifactId = slug(id || kind || 'postrun_hardening');
  const lines = [
    `template learned_${artifactId}`,
    `  goal: ${clean(summary || 'Apply validated post-run audit/hardening learning.')}`,
    files.length ? `  files: ${stableList(files).join(', ')}` : '',
    verifiers.length ? `  verify: ${stableList(verifiers).join(', ')}` : '',
    '  lane: postrun_hardening',
    `  kind: ${slug(kind || 'repair_strategy')}`,
    '',
    `evidence learned_${artifactId}_quality`,
    ...(gates.length ? gates : ['postRunAuditFindingAddressed == true', 'regressionTestAdded == true', 'validationPassed == true']).map((gate) => `  require: ${gate}`)
  ].filter((line) => line !== '');
  return `${lines.join('\n')}\n`;
}

function overlapCount(a = [], b = []) {
  const left = stableList(a);
  const right = stableList(b);
  return left.filter((entry) => right.some((candidate) => entry === candidate || entry.includes(candidate) || candidate.includes(entry))).length;
}

function matchLearningArtifact(artifact = {}, query = {}) {
  const queryFiles = stableList(query.files || query.allowedFiles || query.fileAreas || query.targetFiles || query.productFiles);
  const querySurfaceIds = stableList(query.surfaceIds || query.surfaceId || query.id);
  const queryRoutes = stableList(query.routeNamespaces || query.routes);
  const lane = clean(query.lane || query.domain).toLowerCase();
  const haystack = fieldText([artifact.title, artifact.summary, artifact.lane, artifact.domain, ...(artifact.surfaceIds || []), ...(artifact.files || []), ...(artifact.routeNamespaces || [])]);
  let score = 0;
  const fileOverlap = overlapCount(artifact.files, queryFiles);
  const surfaceOverlap = overlapCount(artifact.surfaceIds, querySurfaceIds);
  const routeOverlap = overlapCount(artifact.routeNamespaces, queryRoutes);
  if (fileOverlap) score += fileOverlap * 8;
  if (surfaceOverlap) score += surfaceOverlap * 6;
  if (routeOverlap) score += routeOverlap * 5;
  if (lane && haystack.includes(lane)) score += 3;
  for (const token of stableList([query.id, query.title, query.goal, query.domain, query.lane]).join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((entry) => entry.length > 3)) {
    if (haystack.includes(token)) score += 1;
  }
  if (artifact.trust === 'trusted') score += 4;
  if (artifact.trust === 'quarantined') score -= 4;
  return score;
}

function compactArtifact(artifact = {}, score = 0) {
  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    trust: artifact.trust,
    matchScore: score,
    files: artifact.files || [],
    verifiers: artifact.verifiers || [],
    routeNamespaces: artifact.routeNamespaces || [],
    architecture: artifact.architecture || {},
    quality: artifact.quality || {},
    failure: artifact.failure || null,
    provenance: artifact.provenance || null,
    agentWorkLanguage: artifact.agentWorkLanguage || normalizeAgentWorkLanguageFragment('', artifact)
  };
}

export function retrieveLearningPatterns({ ledger: ledgerInput = {}, query = {}, limit = 3, includeCandidates = true } = {}) {
  const ledger = normalizeLearningLedger(ledgerInput);
  const select = (bucket, options = {}) => (ledger[bucket] || [])
    .map((artifact) => ({ artifact, score: matchLearningArtifact(artifact, query) }))
    .filter(({ artifact, score }) => score > 0 && (includeCandidates || artifact.trust === 'trusted') && !options.excludeTrust?.includes(artifact.trust))
    .sort((a, b) => b.score - a.score || String(a.artifact.id).localeCompare(String(b.artifact.id)))
    .slice(0, limit)
    .map(({ artifact, score }) => compactArtifact(artifact, score));
  const architecturePatterns = select('architecturePatterns', { excludeTrust: ['quarantined'] });
  const antiPatterns = select('antiPatterns').slice(0, limit);
  const repairStrategies = select('repairStrategies', { excludeTrust: ['quarantined'] }).slice(0, limit);
  const agentWorkLanguageFragments = [...architecturePatterns, ...antiPatterns, ...repairStrategies]
    .map((artifact) => artifact.agentWorkLanguage)
    .filter((fragment) => fragment?.source);
  return {
    schemaVersion: ORCHESTRATION_LEARNING_CONTEXT_SCHEMA,
    generatedAt: iso(),
    ledgerProject: ledger.project,
    query,
    architecturePatterns,
    antiPatterns,
    repairStrategies,
    agentWorkLanguageFragments,
    retrievalDigest: sha256Text(JSON.stringify({ query, architecturePatterns: architecturePatterns.map((entry) => entry.id), antiPatterns: antiPatterns.map((entry) => entry.id), repairStrategies: repairStrategies.map((entry) => entry.id) }))
  };
}

export function buildLearningContextForShard({ ledger, shard = {}, surface = {}, limit = 3, includeCandidates = true } = {}) {
  const query = {
    id: shard.id || surface.id || null,
    title: shard.title || surface.label || null,
    goal: shard.goal || surface.goal || null,
    lane: shard.lane || surface.lane || shard.metadata?.focusLane || surface.metadata?.lane || null,
    domain: shard.domain || surface.domain || surface.metadata?.domain || null,
    surfaceIds: stableList([...(shard.surfaceIds || []), surface.id]),
    files: stableList([...(shard.allowedFiles || []), ...(shard.fileAreas || []), ...(surface.productFiles || []), ...(surface.allowedFiles || [])]),
    routeNamespaces: stableList(shard.metadata?.routeNamespaces || surface.metadata?.routeNamespaces || [])
  };
  return retrieveLearningPatterns({ ledger, query, limit, includeCandidates });
}

function architectureEvidenceOk(evidence = {}) {
  const layerCount = numeric(evidence.layerCount || (Array.isArray(evidence.layers) ? evidence.layers.length : 0), 0);
  const runtimeOk = evidence.runtimeIntegrated === true || evidence.runtimeIntegrationEvidence?.ok === true;
  const modifiedPrimaryFileCount = Array.isArray(evidence.modifiedPrimaryRuntimeFiles) ? evidence.modifiedPrimaryRuntimeFiles.length : 0;
  const semanticBloat = evidence.semanticBloatAudit?.semanticBloatSuspect === true || evidence.markerOnly === true;
  return evidence.ok === true && layerCount >= 2 && runtimeOk && modifiedPrimaryFileCount >= 1 && !semanticBloat;
}

export function extractPostRunHardeningArtifacts({ runRoot = null, benchmarkId = '', runId = '', project = '' } = {}) {
  if (!runRoot) return [];
  const root = path.resolve(runRoot);
  const candidates = [
    {
      kind: 'postrun_hardening',
      reportPath: path.join(root, 'postrun_hardened_winner', 'postrun_hardening_report.md'),
      diffPath: path.join(root, 'postrun_hardened_winner', 'postrun_hardening.diff'),
      auditPath: path.join(root, 'winner_postrun_audit.md')
    },
    {
      kind: 'postrun_hardening',
      reportPath: path.join(root, 'postrun_hardening_report.md'),
      diffPath: path.join(root, 'postrun_hardening.diff'),
      auditPath: path.join(root, 'winner_postrun_audit.md')
    }
  ];
  const artifacts = [];
  const seenReports = new Set();
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.reportPath) || seenReports.has(candidate.reportPath)) continue;
    seenReports.add(candidate.reportPath);
    const report = readText(candidate.reportPath);
    const diff = readText(candidate.diffPath);
    const audit = readText(candidate.auditPath);
    const combined = [report, diff, audit].filter(Boolean).join('\n\n');
    const title = firstMarkdownHeading(report, 'Post-run hardening');
    const summary = firstMeaningfulParagraph(report, 'Validated post-run hardening should be promoted into future worker context.');
    const files = extractEvidencePathsFromText(combined, { runRoot: root });
    const verifiers = extractVerifierCommandsFromText(report);
    const digest = sha256Text(combined).slice(0, 16);
    const repairId = `postrun_hardening:${path.basename(root)}:${digest}`;
    artifacts.push(normalizeLearningArtifact({
      kind: 'repair_strategy',
      id: repairId,
      title,
      summary,
      trust: 'trusted',
      project,
      benchmarkId,
      runId,
      files,
      verifiers,
      sourceRunRoot: root,
      source: 'post_run_hardening_report',
      agentWork: postRunAgentWorkFragment({
        id: repairId,
        kind: 'repair_strategy',
        summary,
        files,
        verifiers,
        gates: ['postRunAuditFindingAddressed == true', 'regressionTestAdded == true', 'validationPassed == true']
      }),
      metadata: {
        reportPath: candidate.reportPath,
        diffPath: fs.existsSync(candidate.diffPath) ? candidate.diffPath : null,
        auditPath: fs.existsSync(candidate.auditPath) ? candidate.auditPath : null,
        promotionReason: 'validated_post_run_hardening'
      }
    }));

    if (audit || /anti[- ]pattern|misleading|avoid|do not/i.test(report)) {
      const antiSummary = audit
        ? firstMeaningfulParagraph(audit, `Avoid repeating the post-run audit failure addressed by ${title}.`)
        : `Avoid repeating the post-run failure addressed by ${title}.`;
      const antiId = `postrun_audit_antipattern:${path.basename(root)}:${digest}`;
      artifacts.push(normalizeLearningArtifact({
        kind: 'anti_pattern',
        id: antiId,
        title: `Avoid repeat of ${title}`,
        summary: antiSummary,
        trust: 'trusted',
        project,
        benchmarkId,
        runId,
        files,
        verifiers,
        sourceRunRoot: root,
        source: 'post_run_audit_hardening',
        agentWork: postRunAgentWorkFragment({
          id: antiId,
          kind: 'anti_pattern',
          summary: antiSummary,
          files,
          verifiers,
          gates: ['postRunAuditFindingNotRepeated == true', 'regressionCoversPriorGap == true']
        }),
        metadata: {
          reportPath: candidate.reportPath,
          diffPath: fs.existsSync(candidate.diffPath) ? candidate.diffPath : null,
          auditPath: fs.existsSync(candidate.auditPath) ? candidate.auditPath : null,
          promotionReason: 'post_run_audit_antipattern'
        }
      }));
    }
  }
  return artifacts;
}

export function extractLearningArtifactsFromPatchQueue({ patchQueue = {}, productionQualityGate = {}, runRoot = null, benchmarkId = '', runId = '', project = '' } = {}) {
  const merged = Array.isArray(patchQueue.merged) ? patchQueue.merged : [];
  const rejected = Array.isArray(patchQueue.rejected) ? patchQueue.rejected : Array.isArray(patchQueue.rejections) ? patchQueue.rejections : [];
  const qualityOk = productionQualityGate.ok === true || productionQualityGate.metrics?.productionQualityGatePass === 1;
  const artifacts = [];
  for (const patch of merged) {
    const implementation = patch.metadata?.implementation || patch.implementation || {};
    const metadata = implementation.metadata || {};
    const evidence = metadata.architectureEvidence || patch.metadata?.architectureEvidence || {};
    if (!architectureEvidenceOk(evidence)) continue;
    const trust = qualityOk ? 'trusted' : 'candidate';
    artifacts.push(normalizeLearningArtifact({
      kind: 'architecture_pattern',
      id: patch.shardId || patch.id,
      title: `Architecture pattern from ${patch.shardId || patch.id || 'merged patch'}`,
      summary: evidence.summary || metadata.proofCarryingClaim?.claim || `Reapply the layered runtime integration shape proven by ${patch.shardId || patch.id || 'this patch'}.`,
      trust,
      project,
      benchmarkId,
      runId,
      surfaceIds: metadata.proofCarryingClaim?.surfaceIds || evidence.surfaceIds || [patch.shardId].filter(Boolean),
      files: stableList([...(patch.filePaths || []), ...(implementation.modifiedFiles || []), ...(evidence.modifiedPrimaryRuntimeFiles || [])]),
      verifiers: stableList(patch.requiredVerifiers || metadata.verifiers || []),
      layers: evidence.modifiedRequiredLayers || evidence.layers || [],
      architectureEvidence: evidence,
      quality: productionQualityGate.metrics || {},
      sourceRunRoot: runRoot,
      patchId: patch.id || patch.shardId,
      source: 'patch_queue_merged_architecture_evidence'
    }));
  }
  for (const patch of rejected) {
    const reason = patch.reason || patch.rejectionReason || patch.status || patch.metadata?.reason || 'rejected_patch';
    artifacts.push(normalizeLearningArtifact({
      kind: 'anti_pattern',
      id: patch.shardId || patch.id || reason,
      title: `Avoid ${reason}`,
      summary: `This shape was rejected by the orchestrator: ${reason}. Future workers should avoid repeating it and should satisfy the verifier/architecture gate instead.`,
      trust: 'trusted',
      project,
      benchmarkId,
      runId,
      surfaceIds: [patch.shardId, patch.taskId].filter(Boolean),
      files: patch.filePaths || patch.files || [],
      failure: { reason, category: patch.rejectionCategory || patch.category || null },
      sourceRunRoot: runRoot,
      patchId: patch.id || patch.shardId,
      source: 'patch_queue_rejection'
    }));
  }
  return artifacts;
}

export function promoteLearningFromRun({ ledger: ledgerInput = {}, patchQueue = {}, productionQualityGate = {}, runRoot = null, benchmarkId = '', runId = '', project = '' } = {}) {
  let ledger = normalizeLearningLedger({ ...ledgerInput, project: project || ledgerInput.project });
  const artifacts = [
    ...extractLearningArtifactsFromPatchQueue({ patchQueue, productionQualityGate, runRoot, benchmarkId, runId, project: project || ledger.project }),
    ...extractPostRunHardeningArtifacts({ runRoot, benchmarkId, runId, project: project || ledger.project })
  ];
  for (const artifact of artifacts) ledger = upsertLearningArtifact(ledger, artifact);
  ledger.updatedAt = iso();
  return { ledger, artifacts };
}

export function loadLearningConfig(config = {}, env = process.env) {
  const enabled = boolish(config.enabled ?? env.ORCHESTRATION_LEARNING_ENABLED, Boolean(config.ledger || config.ledgerPath || env.ORCHESTRATION_LEARNING_LEDGER_PATH));
  const ledgerPath = clean(config.ledgerPath || config.path || env.ORCHESTRATION_LEARNING_LEDGER_PATH);
  const limit = Math.max(0, numeric(config.limit ?? env.ORCHESTRATION_LEARNING_RETRIEVAL_LIMIT, 3));
  const includeCandidates = boolish(config.includeCandidates ?? env.ORCHESTRATION_LEARNING_INCLUDE_CANDIDATES, true);
  return { enabled, ledgerPath, ledger: config.ledger || null, limit, includeCandidates };
}
