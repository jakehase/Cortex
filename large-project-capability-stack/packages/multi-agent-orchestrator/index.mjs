import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { buildSelectedRunLandingEvidence, createCanonicalRunBaseline, evaluatePatchLandingEvidence } from '../canonical-landing-evidence/index.mjs';
import { buildSchedulerModel, buildSchedulerTruthReport } from '../orchestrator-scheduler-truth/index.mjs';
import { buildProofCarryingClaimLedger, evaluateProofCarryingPatchClaim } from '../proof-carrying-claim-ledger/index.mjs';
import { buildLearningContextForShard, loadLearningConfig, readLearningLedger } from '../orchestration-learning-ledger/index.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function iso(value = Date.now()) {
  return new Date(value).toISOString();
}

function stableList(list) {
  return [...new Set((list || []).filter((entry) => entry !== undefined && entry !== null && `${entry}`.trim() !== '').map((entry) => `${entry}`.trim()))].sort();
}

function orderedUniqueList(list) {
  const out = [];
  for (const entry of list || []) {
    const value = `${entry || ''}`.trim();
    if (!value || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

function chunk(list, size) {
  if (!list.length) return [[]];
  const width = Math.max(1, size || list.length);
  const out = [];
  for (let index = 0; index < list.length; index += width) out.push(list.slice(index, index + width));
  return out;
}

function schedulingGroupForShard(shard = {}) {
  const shardId = String(shard.id || shard.taskId || '').trim();
  if (shard.metadata?.focusId) return String(shard.metadata.focusId);
  if (shard.metadata?.focusLane) return String(shard.metadata.focusLane);
  if (shard.lane) return String(shard.lane);
  if (shard.domain) return String(shard.domain);
  if (shardId.includes('::')) return shardId.split('::')[0];
  if (shardId.includes('#')) return shardId.split('#')[0];
  return shardId || 'unknown';
}

function interleaveShardsBySchedulingGroup(shards = []) {
  const groups = new Map();
  for (const shard of shards) {
    const group = schedulingGroupForShard(shard);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(shard);
  }
  const orderedGroups = [...groups.keys()].sort();
  const out = [];
  while (orderedGroups.length > 0) {
    for (let index = 0; index < orderedGroups.length;) {
      const group = orderedGroups[index];
      const queue = groups.get(group) || [];
      const shard = queue.shift();
      if (shard) out.push(shard);
      if (queue.length === 0) orderedGroups.splice(index, 1);
      else index += 1;
    }
  }
  return out;
}

function leaseLayerForFile(filePath = '') {
  const rel = String(filePath || '');
  if (/apps\/web\/public|app-shell|view\.mjs|public\.mjs/.test(rel)) return 'client_shell';
  if (/\/routes\//.test(rel) || /server\.mjs|http-runtime\.mjs/.test(rel)) return 'route_or_server';
  if (/domain-|storage\.mjs|persistence-io\.mjs/.test(rel)) return 'domain_or_persistence';
  if (/job-|jobs\.mjs|job-runtime|job-handlers/.test(rel)) return 'jobs_runtime';
  if (/integration|provider|webhook|api-admin/.test(rel)) return 'provider_or_api';
  if (/security|auth/.test(rel)) return 'security_runtime';
  return 'product_runtime';
}

function leaseRequiredLayersForShard(shard = {}) {
  const phaseId = String(shard.metadata?.semanticPhaseId || shard.metadata?.structuralPhaseId || shard.metadata?.phaseId || '').trim();
  if (phaseId === 'interactive_state_and_commands') return ['client_shell', 'route_or_server'];
  if (phaseId === 'operational_persistence_and_jobs') return ['domain_or_persistence', 'jobs_runtime'];
  if (phaseId === 'integrated_user_path_evidence') return ['route_or_server', 'domain_or_persistence'];
  return ['route_or_server', 'domain_or_persistence'];
}

function semanticPhaseOrdinalFromSeed(seed = '') {
  const text = String(seed || '');
  const phases = [
    'primary_runtime_spine',
    'interactive_state_and_commands',
    'operational_persistence_and_jobs',
    'integrated_user_path_evidence'
  ];
  const index = phases.findIndex((phase) => text.includes(phase));
  return index < 0 ? 0 : index;
}

function leaseDistributionOrdinal(seed = '') {
  const text = String(seed || '');
  const surfaceMatch = /surface[_-](\d+)/i.exec(text);
  if (surfaceMatch) return Math.max(0, Number(surfaceMatch[1]) - 1);
  const semanticMatch = /semantic-frontier-\d+#(\d+)/.exec(text);
  if (semanticMatch) {
    const shardOrdinal = Math.max(0, Number(semanticMatch[1]) - 1);
    const hashAttempts = [...text.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
    const attemptOrdinal = hashAttempts.length > 1 ? Math.max(0, hashAttempts.at(-1) - 1) : 0;
    return (shardOrdinal * 8) + (semanticPhaseOrdinalFromSeed(text) * 2) + attemptOrdinal;
  }
  return null;
}

function deterministicIndex(seed = '', modulo = 1) {
  const width = Math.max(1, Number(modulo || 1));
  const ordinal = leaseDistributionOrdinal(seed);
  if (ordinal !== null && Number.isFinite(ordinal)) return ordinal % width;
  let hash = 2166136261;
  for (const char of String(seed || '')) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % width;
}

function rotatedCandidate(candidates = [], seed = '', selected = []) {
  const selectedSet = new Set(selected || []);
  const options = stableList(candidates).filter((entry) => !selectedSet.has(entry));
  if (!options.length) return null;
  return options[deterministicIndex(seed, options.length)];
}

function selectLayerDiverseLeaseTargets(targets = [], shard = {}) {
  const selected = [];
  const shardKey = String(shard.id || shard.taskId || shard.metadata?.focusId || shard.metadata?.focusLane || 'unknown');
  const phaseKey = String(shard.metadata?.semanticPhaseId || shard.metadata?.structuralPhaseId || shard.metadata?.phaseId || 'default');
  const orderedTargets = orderedUniqueList(targets);
  const leaseTargetCount = Math.max(1, Number(process.env.ORCHESTRATOR_PRIMARY_ADOPTION_LEASE_TARGET_COUNT || 1));
  const hasExplicitSourceTarget = Boolean(shard.metadata?.sourceProductFile)
    || (Array.isArray(shard.metadata?.sourceProductFiles) && shard.metadata.sourceProductFiles.length > 0)
    || Boolean(shard.metadata?.primaryAdoptionFile);
  if (leaseTargetCount === 1 && !hasExplicitSourceTarget) {
    return stableList([rotatedCandidate(orderedTargets, `${shardKey}:${phaseKey}:single-target`, [])]);
  }
  const addTarget = (candidate) => {
    if (candidate && !selected.includes(candidate)) selected.push(candidate);
  };
  for (const layer of leaseRequiredLayersForShard(shard)) {
    addTarget(rotatedCandidate(
      orderedTargets.filter((entry) => leaseLayerForFile(entry) === layer),
      `${shardKey}:${phaseKey}:${layer}`,
      selected
    ));
  }
  const primary = shard.metadata?.primaryAdoptionFile || shard.metadata?.sourceProductFile;
  if (selected.length < 2 && primary && !selected.includes(primary)) {
    const selectedLayers = new Set(selected.map(leaseLayerForFile));
    if (!selectedLayers.has(leaseLayerForFile(primary))) addTarget(primary);
  }
  if (selected.length < 2) {
    const selectedLayers = new Set(selected.map(leaseLayerForFile));
    addTarget(rotatedCandidate(
      orderedTargets.filter((entry) => !selectedLayers.has(leaseLayerForFile(entry))),
      `${shardKey}:${phaseKey}:fallback-layer`,
      selected
    ));
  }
  if (selected.length < 2) {
    addTarget(rotatedCandidate(orderedTargets, `${shardKey}:${phaseKey}:fallback-any`, selected));
  }
  return selected.slice(0, Math.min(leaseTargetCount, Math.max(1, orderedTargets.length)));
}

function normalizeArea(area) {
  return `${area || ''}`
    .replace(/\*\*$/g, '')
    .replace(/\*$/g, '')
    .replace(/\/$/, '')
    .trim();
}

function overlapsArea(left, right) {
  const a = normalizeArea(left);
  const b = normalizeArea(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

const WORKER_WORKSPACE_EXCLUDED_NAMES = new Set(['.git', 'node_modules', 'artifacts', 'coverage', 'dist', 'build', '.next', '.cache']);
const DEFAULT_ISOLATED_WORKER_COPY_PATHS = Object.freeze(['apps', 'packages', 'plugins', 'src', 'public', 'tests', 'scripts', 'examples', 'docs', 'kernel/contracts', 'artifacts/aios-v0/latest', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'surface-honesty.json']);

function normalizeRelativePath(value = '') {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!raw || raw.includes('\0') || path.isAbsolute(raw)) return null;
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

function safeJoin(rootPath, relativePath) {
  const rel = normalizeRelativePath(relativePath);
  if (!rel) return null;
  const root = path.resolve(rootPath || '.');
  const full = path.resolve(root, rel);
  if (full === root || !full.startsWith(`${root}${path.sep}`)) return null;
  return full;
}

function safePathSegment(value = '') {
  return String(value || 'worker')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'worker';
}

function isIsolatedWorkerWorkspaceMode(mode = 'shared') {
  return ['isolated', 'isolated_copy', 'isolated_product_copy', 'sparse_copy'].includes(String(mode || 'shared').trim());
}

function readTextIfExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? fs.readFileSync(filePath, 'utf8') : null;
  } catch {
    return null;
  }
}

function sha256Text(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function copyPathIntoWorkerWorkspace({ sourceRoot, targetRoot, relativePath }) {
  const rel = normalizeRelativePath(relativePath);
  if (!rel) return null;
  const source = safeJoin(sourceRoot, rel);
  const target = safeJoin(targetRoot, rel);
  if (!source || !target || !fs.existsSync(source)) return null;
  const sourceRootResolved = path.resolve(sourceRoot || '.');
  const explicitSourceResolved = path.resolve(source);
  const shouldCopy = (candidate) => {
    const candidateResolved = path.resolve(candidate);
    const explicitRelative = path.relative(explicitSourceResolved, candidateResolved);
    if (!explicitRelative || (!explicitRelative.startsWith('..') && !path.isAbsolute(explicitRelative))) {
      const nestedParts = explicitRelative.split(path.sep).filter(Boolean);
      return !nestedParts.some((part) => WORKER_WORKSPACE_EXCLUDED_NAMES.has(part));
    }
    const parts = path.relative(sourceRootResolved, candidateResolved).split(path.sep).filter(Boolean);
    return !parts.some((part) => WORKER_WORKSPACE_EXCLUDED_NAMES.has(part));
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.cpSync(source, target, { recursive: true, dereference: false, filter: shouldCopy });
  } else if (stat.isFile()) {
    fs.copyFileSync(source, target);
  }
  return rel;
}

function shardWorkspaceRelevantPaths(shard = {}) {
  const contract = shard.metadata?.assignmentContract || {};
  return stableList([
    ...(shard.allowedFiles || []),
    ...(shard.fileAreas || []),
    ...(contract.targetFiles || []),
    ...(contract.targetModules || []),
    shard.metadata?.importFile,
    ...(shard.metadata?.extraImportFiles || []),
    shard.metadata?.testFile,
    ...(shard.metadata?.extraTestFiles || []),
    shard.metadata?.sourceProductFile,
    ...(shard.metadata?.sourceProductFiles || []),
    shard.metadata?.primaryAdoptionFile,
    ...(shard.metadata?.primaryAdoptionFiles || [])
  ].map(normalizeRelativePath).filter(Boolean));
}

function collectWorkerWorkspaceCopyPaths({ mode = 'shared', shard = {}, copyPaths = [] } = {}) {
  const configured = stableList(copyPaths.map(normalizeRelativePath).filter(Boolean));
  const defaults = String(mode) === 'isolated_product_copy' ? [...DEFAULT_ISOLATED_WORKER_COPY_PATHS] : [];
  return stableList([...defaults, ...configured, ...shardWorkspaceRelevantPaths(shard)]);
}

function snapshotWorkerWorkspaceFiles(workspaceRoot, relativePaths = []) {
  const out = {};
  for (const rel of stableList(relativePaths.map(normalizeRelativePath).filter(Boolean))) {
    const full = safeJoin(workspaceRoot, rel);
    if (!full) continue;
    const content = readTextIfExists(full);
    out[rel] = {
      path: rel,
      exists: content !== null,
      sha256: content === null ? null : sha256Text(content),
      content
    };
  }
  return out;
}

function ensureNodeModulesLink(sourceRoot, targetRoot) {
  const source = path.join(sourceRoot, 'node_modules');
  const target = path.join(targetRoot, 'node_modules');
  if (!fs.existsSync(source) || fs.existsSync(target)) return null;
  try {
    fs.symlinkSync(source, target, 'dir');
    return 'node_modules';
  } catch {
    return null;
  }
}

function initializeWorkerWorkspaceGitBaseline(workspaceRoot) {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot) || fs.existsSync(path.join(workspaceRoot, '.git'))) return null;
  const runGit = (args) => spawnSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8
  });
  const init = runGit(['init']);
  if (init.status !== 0) {
    return { ok: false, mode: 'git_index_baseline', stage: 'init', exitCode: init.status, stderr: init.stderr || '', stdout: init.stdout || '' };
  }
  runGit(['config', 'user.email', 'worker-workspace@openclaw.local']);
  runGit(['config', 'user.name', 'OpenClaw Worker Workspace']);
  const add = runGit(['add', '-A']);
  if (add.status !== 0) {
    return { ok: false, mode: 'git_commit_baseline', stage: 'add', exitCode: add.status, stderr: add.stderr || '', stdout: add.stdout || '' };
  }
  const commit = runGit(['commit', '--allow-empty', '--no-gpg-sign', '-m', 'worker workspace baseline']);
  if (commit.status !== 0) {
    return { ok: false, mode: 'git_commit_baseline', stage: 'commit', exitCode: commit.status, stderr: commit.stderr || '', stdout: commit.stdout || '' };
  }
  return { ok: true, mode: 'git_commit_baseline', stage: 'ready' };
}

function prepareWorkerWorkspace({ mode = 'shared', workspacePath, directories, shard, agentId, lease, copyPaths = [] } = {}) {
  const normalizedMode = String(mode || 'shared').trim() || 'shared';
  if (!isIsolatedWorkerWorkspaceMode(normalizedMode)) {
    return { isolated: false, mode: 'shared', workspacePath, canonicalWorkspacePath: workspacePath, copiedPaths: [], baselineFiles: {} };
  }
  const workspaceRoot = path.join(
    directories.root,
    'worker_workspaces',
    safePathSegment(agentId),
    `${safePathSegment(shard?.id || 'shard')}__attempt-${Number(lease?.attempt || 1)}`
  );
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const requestedPaths = collectWorkerWorkspaceCopyPaths({ mode: normalizedMode, shard, copyPaths });
  const copiedPaths = [];
  for (const rel of requestedPaths) {
    const copied = copyPathIntoWorkerWorkspace({ sourceRoot: workspacePath, targetRoot: workspaceRoot, relativePath: rel });
    if (copied) copiedPaths.push(copied);
  }
  const linkedNodeModules = ensureNodeModulesLink(workspacePath, workspaceRoot);
  const gitBaseline = initializeWorkerWorkspaceGitBaseline(workspaceRoot);
  const snapshotPaths = stableList([...requestedPaths, ...shardWorkspaceRelevantPaths(shard)]);
  const baselineFiles = snapshotWorkerWorkspaceFiles(workspaceRoot, snapshotPaths);
  return {
    isolated: true,
    mode: normalizedMode,
    workspacePath: workspaceRoot,
    canonicalWorkspacePath: workspacePath,
    copiedPaths: stableList(copiedPaths),
    linkedNodeModules,
    gitBaseline,
    baselineFiles,
    preparedAt: new Date().toISOString()
  };
}

function captureModifiedFileSnapshots({ workerWorkspace, modifiedFiles = [] } = {}) {
  if (!workerWorkspace?.isolated) return [];
  const reported = new Set(modifiedFiles.map(normalizeRelativePath).filter(Boolean));
  for (const [rel, before] of Object.entries(workerWorkspace.baselineFiles || {})) {
    if (!before?.path || before.exists !== true) continue;
    const full = safeJoin(workerWorkspace.workspacePath, rel);
    const afterContent = full ? readTextIfExists(full) : null;
    const afterSha256 = afterContent === null ? null : sha256Text(afterContent);
    if (afterSha256 !== before.sha256) reported.add(rel);
  }
  return stableList([...reported]).map((rel) => {
    const full = safeJoin(workerWorkspace.workspacePath, rel);
    const afterContent = full ? readTextIfExists(full) : null;
    const before = workerWorkspace.baselineFiles?.[rel] || { exists: false, sha256: null, content: null };
    return {
      path: rel,
      beforeExists: before.exists === true,
      beforeSha256: before.sha256 || null,
      beforeContent: before.content,
      afterExists: afterContent !== null,
      afterSha256: afterContent === null ? null : sha256Text(afterContent),
      afterContent
    };
  });
}

function lineList(value = '') {
  const text = String(value || '');
  const lines = text.split(/\r?\n/);
  if (lines.length && lines.at(-1) === '') lines.pop();
  return lines;
}

function addedLinesBetween(before = '', after = '') {
  const beforeCounts = new Map();
  for (const line of lineList(before)) beforeCounts.set(line, (beforeCounts.get(line) || 0) + 1);
  const added = [];
  for (const line of lineList(after)) {
    const remaining = beforeCounts.get(line) || 0;
    if (remaining > 0) {
      beforeCounts.set(line, remaining - 1);
    } else {
      added.push(line);
    }
  }
  return added;
}

function missingLinesForMerge(current = '', addedLines = []) {
  const currentCounts = new Map();
  for (const line of lineList(current)) currentCounts.set(line, (currentCounts.get(line) || 0) + 1);
  const missing = [];
  for (const line of addedLines) {
    const remaining = currentCounts.get(line) || 0;
    if (remaining > 0) {
      currentCounts.set(line, remaining - 1);
    } else {
      missing.push(line);
    }
  }
  return missing;
}

function promoteSnapshotToCanonicalWorkspace({ canonicalWorkspacePath, snapshot }) {
  const target = safeJoin(canonicalWorkspacePath, snapshot?.path);
  if (!target) return { ok: false, path: snapshot?.path || null, mode: 'blocked', reason: 'unsafe_path' };
  const beforeContent = snapshot.beforeExists ? String(snapshot.beforeContent || '') : '';
  const afterContent = snapshot.afterExists ? String(snapshot.afterContent || '') : null;
  const currentContent = readTextIfExists(target);
  if (afterContent === null) {
    if (currentContent === null) return { ok: true, path: snapshot.path, mode: 'already_absent' };
    if (currentContent === beforeContent) {
      fs.rmSync(target, { force: true });
      return { ok: true, path: snapshot.path, mode: 'deleted' };
    }
    return { ok: false, path: snapshot.path, mode: 'blocked', reason: 'delete_conflict' };
  }
  if (currentContent === afterContent) return { ok: true, path: snapshot.path, mode: 'already_promoted' };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (currentContent === null || currentContent === beforeContent) {
    fs.writeFileSync(target, afterContent);
    return { ok: true, path: snapshot.path, mode: currentContent === null ? 'created_from_worker_snapshot' : 'replaced_from_worker_snapshot' };
  }
  if (afterContent.startsWith(beforeContent)) {
    const suffixDelta = afterContent.slice(beforeContent.length);
    if (!suffixDelta) return { ok: true, path: snapshot.path, mode: 'already_contains_worker_delta', addedLineCount: 0 };
    if (currentContent.includes(suffixDelta)) {
      return { ok: true, path: snapshot.path, mode: 'already_contains_worker_suffix_delta', addedLineCount: lineList(suffixDelta).length };
    }
    const separator = currentContent.endsWith('\n') || suffixDelta.startsWith('\n') ? '' : '\n';
    fs.writeFileSync(target, `${currentContent}${separator}${suffixDelta}`);
    return {
      ok: true,
      path: snapshot.path,
      mode: 'appended_worker_suffix_delta',
      addedLineCount: lineList(suffixDelta).length,
      appendedLineCount: lineList(suffixDelta).length
    };
  }
  return { ok: false, path: snapshot.path, mode: 'blocked', reason: 'non_additive_conflict' };
}

function promoteWorkerWorkspacePatch({ patch = {}, promotionSnapshots, canonicalWorkspacePath } = {}) {
  if (!promotionSnapshots) return { ok: true, skipped: true, reason: 'no_worker_workspace_snapshots' };
  const records = (promotionSnapshots.snapshots || []).map((snapshot) => promoteSnapshotToCanonicalWorkspace({ canonicalWorkspacePath, snapshot }));
  const failures = records.filter((entry) => entry.ok === false);
  return {
    schemaVersion: 'claw.worker_workspace_promotion.v1',
    generatedAt: new Date().toISOString(),
    patchId: patch.id || null,
    shardId: patch.shardId || null,
    workerWorkspaceMode: promotionSnapshots.workerWorkspace?.mode || null,
    copiedPathCount: promotionSnapshots.workerWorkspace?.copiedPathCount || 0,
    modifiedFileCount: records.length,
    ok: failures.length === 0,
    status: failures.length === 0 ? 'promoted' : 'blocked',
    records,
    failures
  };
}

function normalizeAssignmentContract(contract = {}, fallback = {}) {
  const targetFiles = stableList(contract.targetFiles || fallback.targetFiles || []);
  const targetModules = stableList(contract.targetModules || fallback.targetModules || []);
  const verifierRequirements = stableList(contract.verifierRequirements || fallback.verifierRequirements || []);
  const successPredicate = stableList(contract.successPredicate || fallback.successPredicate || []);
  return {
    artifactKind: `${contract.artifactKind || fallback.artifactKind || 'verification_evidence'}`.trim() || 'verification_evidence',
    targetFiles,
    targetModules,
    verifierRequirements,
    successPredicate
  };
}

function validateGroundedAssignmentContract(contract = {}) {
  const failures = [];
  if ((contract.targetFiles || []).length === 0 && (contract.targetModules || []).length === 0) failures.push('missing_targets');
  if ((contract.verifierRequirements || []).length === 0) failures.push('missing_verifier_requirements');
  if ((contract.successPredicate || []).length === 0) failures.push('missing_success_predicate');
  return {
    ok: failures.length === 0,
    failures
  };
}

export const HIERARCHICAL_WORK_PLANNING_VERSION = 1;

export const HIERARCHICAL_WORK_PLAN_DEFAULT_STAGES = Object.freeze([
  {
    id: 'negative_space_inventory',
    title: 'negative-space inventory',
    intent: 'Name what is absent, risky, unknown, or previously saturated before assigning implementation work.',
    proof: ['missing behavior list', 'known shortcut list', 'remaining gap note']
  },
  {
    id: 'source_of_truth_contract',
    title: 'source-of-truth contract',
    intent: 'Bind the assignment to the state, files, APIs, data, or operational boundary that owns the change.',
    proof: ['ownership boundary', 'target files/modules', 'state or API contract']
  },
  {
    id: 'execution_decomposition',
    title: 'execution decomposition',
    intent: 'Break the work into concrete ordered steps that an agent can execute without broad repository guessing.',
    proof: ['ordered substeps', 'dependency hints', 'anti-no-op criteria']
  },
  {
    id: 'integration_boundary',
    title: 'integration boundary',
    intent: 'Require the output to land in a primary runtime or delivery path instead of an isolated marker artifact.',
    proof: ['runtime adoption evidence', 'consumer/provider path', 'cross-boundary behavior']
  },
  {
    id: 'verification_gate',
    title: 'verification gate',
    intent: 'Make completion depend on executable evidence and surviving scoped changes, not activity volume.',
    proof: ['verifier result', 'surviving target delta', 'completion evidence']
  }
]);

const HIERARCHICAL_WORK_PLAN_DEFAULT_FEATURES = Object.freeze([
  'negative_space_inventory_per_surface',
  'failure_to_microplan_replanning',
  'target_file_role_weave',
  'source_of_truth_adoption_gate',
  'proof_node_completion_contracts',
  'proof_carrying_plan_ledger',
  'counterfactual_plan_twins'
]);

export const COUNTERFACTUAL_PLAN_TWIN_FAILURES = Object.freeze([
  {
    kind: 'zero_surviving_product_diff',
    detectsGateIds: ['surviving_product_diff'],
    invalidCompletionSignal: 'The agent reports completion, but no scoped target delta survives admission.',
    precommitQuestion: 'Which exact target file/module changed, and what behavior would disappear if reverted?',
    recoverySlot: 'onZeroSurvivingDiff'
  },
  {
    kind: 'marker_only_delta',
    detectsGateIds: ['source_of_truth_integration'],
    invalidCompletionSignal: 'The diff exists, but it is not consumed by the source-of-truth runtime, API, provider, data, user, or operational path.',
    precommitQuestion: 'Where is the produced behavior consumed by the real delivery path?',
    recoverySlot: 'onMarkerOnlyDiff'
  },
  {
    kind: 'wrong_target_delta',
    detectsGateIds: ['grounded_assignment_contract'],
    invalidCompletionSignal: 'The work lands outside the assignment contract or cannot prove target ownership.',
    precommitQuestion: 'Why does this target own the requested objective, and is it inside the allowed files/modules?',
    recoverySlot: 'onZeroSurvivingDiff'
  },
  {
    kind: 'negative_space_unreduced',
    detectsGateIds: ['negative_space_reduction'],
    invalidCompletionSignal: 'The patch cannot name which missing behavior, risk, or unknown it reduced.',
    precommitQuestion: 'Which item from the negative-space inventory is now smaller, and what remains?',
    recoverySlot: 'onZeroSurvivingDiff'
  },
  {
    kind: 'verifier_failure',
    detectsGateIds: ['verifier_evidence'],
    invalidCompletionSignal: 'Required executable evidence failed, was skipped, or is missing.',
    precommitQuestion: 'Which verifier proves the plan node, and what is the localized failing contract?',
    recoverySlot: 'onVerifierFailure'
  }
]);

function slug(value = 'node') {
  return `${value || 'node'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'node';
}

function titleCase(value = '') {
  return `${value || ''}`
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeHierarchicalOptions(options = {}) {
  const enabledOptions = options?.hierarchicalPlanning && typeof options.hierarchicalPlanning === 'object'
    ? options.hierarchicalPlanning
    : options;
  return {
    enabled: enabledOptions.enabled !== false,
    objectiveId: enabledOptions.objectiveId || 'agent_orchestration_objective',
    objectiveTitle: enabledOptions.objectiveTitle || 'Agent orchestration objective',
    requestedFidelity: enabledOptions.requestedFidelity || 'production_slice',
    inputRefName: enabledOptions.inputRefName || 'hierarchicalWorkPlanPolicy',
    metadataKey: enabledOptions.metadataKey || 'hierarchicalPlanning',
    planId: enabledOptions.planId || null,
    stages: Array.isArray(enabledOptions.stages) && enabledOptions.stages.length ? enabledOptions.stages : HIERARCHICAL_WORK_PLAN_DEFAULT_STAGES,
    novelPlannerFeatures: Array.isArray(enabledOptions.novelPlannerFeatures) && enabledOptions.novelPlannerFeatures.length
      ? enabledOptions.novelPlannerFeatures
      : HIERARCHICAL_WORK_PLAN_DEFAULT_FEATURES,
    policy: {
      sourceOfTruth: enabledOptions.policy?.sourceOfTruth || 'Plan nodes, not activity volume or worker count, determine completion eligibility.',
      completionRule: enabledOptions.policy?.completionRule || 'A work unit can only be credited when its implementation step and proof gate show a surviving scoped delta plus required verifier evidence.',
      replanRule: enabledOptions.policy?.replanRule || 'Zero-delta, marker-only, or verifier-failed nodes must be split into smaller target-bound microplans before retry.',
      noShortcutRule: enabledOptions.policy?.noShortcutRule || 'Docs/scripts/tests-only output is planning/scaffolding unless the assignment contract explicitly asked for that artifact kind.'
    },
    replanActions: {
      zeroSurvivingDiff: enabledOptions.replanActions?.zeroSurvivingDiff || 'split_to_target_microplan',
      markerOnly: enabledOptions.replanActions?.markerOnly || 'reject_and_require_integration_behavior',
      verifierFailure: enabledOptions.replanActions?.verifierFailure || 'localize_to_failing_contract'
    }
  };
}

function stageForWorkUnit(unit = {}, stages = HIERARCHICAL_WORK_PLAN_DEFAULT_STAGES) {
  const metadata = unit.metadata || {};
  const explicit = metadata.hierarchicalStageId || metadata.planningStageId || unit.stageId;
  if (explicit && stages.some((stage) => stage.id === explicit)) return explicit;
  const text = `${unit.id || ''} ${unit.title || ''} ${unit.goal || ''} ${(unit.acceptanceChecks || []).join(' ')} ${(unit.fileAreas || []).join(' ')} ${(unit.allowedFiles || []).join(' ')}`.toLowerCase();
  if (/negative|gap|inventory|unknown|missing|saturat/.test(text)) return 'negative_space_inventory';
  if (/state|contract|domain|schema|model|api|ownership|security|governance/.test(text)) return 'source_of_truth_contract';
  if (/route|client|server|runtime|provider|queue|job|integration|persistence|storage|workflow/.test(text)) return 'integration_boundary';
  if (/test|verif|proof|evidence|acceptance|lint|smoke|browser/.test(text)) return 'verification_gate';
  return 'execution_decomposition';
}

function targetRole(filePath = '') {
  const value = `${filePath || ''}`;
  if (/test|spec|__tests__/.test(value)) return 'test_or_verifier';
  if (/docs?|readme|adr|contract|plan/i.test(value)) return 'documentation_or_contract';
  if (/route|server|api|controller|handler/i.test(value)) return 'entrypoint_or_api';
  if (/client|view|ui|component|page|shell/i.test(value)) return 'user_interface';
  if (/domain|model|schema|store|storage|db|persistence|repository/i.test(value)) return 'state_or_domain';
  if (/job|queue|worker|provider|adapter|integration|sync/i.test(value)) return 'async_or_external_boundary';
  return 'implementation_target';
}

function targetFileRoleWeave(targetFiles = []) {
  const roles = new Map();
  for (const filePath of stableList(targetFiles)) {
    const role = targetRole(filePath);
    if (!roles.has(role)) roles.set(role, []);
    roles.get(role).push(filePath);
  }
  return [...roles.entries()].map(([role, files]) => ({ role, files }));
}

function surfaceIdsForWorkUnit(unit = {}, surfaceIndex = new Map()) {
  const metadata = unit.metadata || {};
  const candidates = [
    ...(unit.surfaceIds || []),
    ...(surfaceIndex.get(unit.id) || []),
    ...(metadata.focusId ? surfaceIndex.get(metadata.focusId) || [] : []),
    ...(metadata.rootFocusId ? surfaceIndex.get(metadata.rootFocusId) || [] : []),
    ...(metadata.surfaceId ? [metadata.surfaceId] : []),
    ...(metadata.rootSurfaceId ? [metadata.rootSurfaceId] : [])
  ];
  return stableList(candidates.length ? candidates : [unit.lane || unit.domain || unit.id]);
}

function buildHierarchicalSubsteps(unit = {}, options = normalizeHierarchicalOptions()) {
  const targets = stableList([...(unit.allowedFiles || []), ...(unit.fileAreas || [])]).slice(0, 6);
  const contract = unit.assignmentContract || unit.metadata?.assignmentContract || {};
  const artifactKind = contract.artifactKind || unit.metadata?.artifactKind || 'verification_evidence';
  return [
    `Restate the exact objective and negative space for ${unit.id}; do not infer completion from activity volume.`,
    `Choose the source-of-truth target from ${targets.join(', ') || 'the assignment contract'} and explain why it owns the change.`,
    `Produce a scoped ${artifactKind} change against the target files/modules; no generic marker-only output counts.`,
    'Wire the output through the runtime, API, provider, data, user, or operational boundary named by the plan node.',
    'Attach verifier evidence and list the remaining gaps before requesting completion credit.'
  ];
}

function buildHierarchicalAcceptanceGates(unit = {}) {
  const contract = normalizeAssignmentContract(unit.assignmentContract || unit.metadata?.assignmentContract || {}, {
    artifactKind: unit.metadata?.artifactKind || 'verification_evidence',
    targetFiles: unit.allowedFiles || [],
    targetModules: unit.fileAreas || [],
    verifierRequirements: unit.requiredVerifiers || [],
    successPredicate: unit.acceptanceChecks || []
  });
  return [
    {
      id: 'grounded_assignment_contract',
      kind: 'planning',
      required: true,
      description: 'The work unit must name concrete target files/modules, verifier requirements, and success predicates.',
      contract
    },
    {
      id: 'surviving_product_diff',
      kind: 'mechanical',
      required: contract.artifactKind === 'product_diff',
      description: 'Product-diff assignments require a surviving scoped target delta after merge/admission.',
      targetFiles: contract.targetFiles,
      targetModules: contract.targetModules
    },
    {
      id: 'source_of_truth_integration',
      kind: 'semantic',
      required: true,
      description: 'The output must be consumed by the source-of-truth runtime/delivery boundary named by the plan.'
    },
    {
      id: 'negative_space_reduction',
      kind: 'truth',
      required: true,
      description: 'The agent must state which missing behavior/risk/unknown this node reduced and what remains.'
    },
    {
      id: 'verifier_evidence',
      kind: 'executable',
      required: contract.verifierRequirements.length > 0,
      description: 'Required verifier evidence must pass or the node must emit a localized blocker/replan directive.',
      verifiers: contract.verifierRequirements
    }
  ];
}

function buildHierarchicalReplanPolicy(unit = {}, options = normalizeHierarchicalOptions()) {
  const targets = stableList([...(unit.allowedFiles || []), ...(unit.fileAreas || [])]);
  return {
    onZeroSurvivingDiff: {
      action: options.replanActions.zeroSurvivingDiff,
      reason: 'Activity without a surviving scoped delta means the assignment is too broad, stale, saturated, or pointed at the wrong source of truth.',
      microSteps: targets.slice(0, 8).map((target, index) => ({
        id: `micro_${String(index + 1).padStart(2, '0')}_${slug(target)}`,
        target,
        requiredOutput: 'one concrete owned behavior, state transition, integration point, runtime consumer, or verifier hook'
      }))
    },
    onMarkerOnlyDiff: {
      action: options.replanActions.markerOnly,
      reason: 'Marker-only deltas do not satisfy an implementation plan node unless explicitly requested.'
    },
    onVerifierFailure: {
      action: options.replanActions.verifierFailure,
      reason: 'Replan around the failing import/test/syntax/runtime contract instead of replaying the broad assignment.'
    }
  };
}

function recoveryForSlot(replanPolicy = {}, slot = 'onZeroSurvivingDiff') {
  if (slot === 'onMarkerOnlyDiff') return replanPolicy.onMarkerOnlyDiff || replanPolicy.onZeroSurvivingDiff || {};
  if (slot === 'onVerifierFailure') return replanPolicy.onVerifierFailure || replanPolicy.onZeroSurvivingDiff || {};
  return replanPolicy.onZeroSurvivingDiff || {};
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map((entry) => stableCanonical(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableCanonical(value[key])]));
  }
  return value;
}

function stableFingerprint(value) {
  const input = JSON.stringify(stableCanonical(value));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildCounterfactualFailureTwins({ unit = {}, acceptanceGates = [], replanPolicy = {}, targetFileRoleWeave = [] } = {}) {
  const gateIds = new Set((acceptanceGates || []).map((gate) => gate.id));
  return COUNTERFACTUAL_PLAN_TWIN_FAILURES
    .filter((twin) => twin.detectsGateIds.some((gateId) => gateIds.has(gateId)))
    .map((twin) => {
      const recovery = recoveryForSlot(replanPolicy, twin.recoverySlot);
      const payload = {
        workUnitId: unit.id,
        kind: twin.kind,
        detectsGateIds: twin.detectsGateIds,
        targetFileRoleWeave
      };
      return {
        id: `counterfactual:${slug(unit.id)}:${twin.kind}`,
        kind: twin.kind,
        workUnitId: unit.id,
        detectsGateIds: twin.detectsGateIds,
        invalidCompletionSignal: twin.invalidCompletionSignal,
        precommitQuestion: twin.precommitQuestion,
        recoveryAction: recovery.action || 'split_to_target_microplan',
        recoveryReason: recovery.reason || 'Precomputed counterfactual failure requires a narrower target-bound retry.',
        microSteps: recovery.microSteps || [],
        targetFileRoleWeave,
        counterfactualFingerprint: stableFingerprint(payload)
      };
    });
}

function buildProofObligationLedger({ unit = {}, acceptanceGates = [], counterfactualFailureTwins = [] } = {}) {
  return acceptanceGates.map((gate) => ({
    id: `obligation:${slug(unit.id)}:${gate.id}`,
    gateId: gate.id,
    workUnitId: unit.id,
    required: gate.required !== false,
    kind: gate.kind,
    status: 'pending',
    evidence: [],
    counterfactualTwinIds: counterfactualFailureTwins
      .filter((twin) => (twin.detectsGateIds || []).includes(gate.id))
      .map((twin) => twin.id)
  }));
}

function addPlanNode(nodes, links, seen, entry) {
  if (seen.has(entry.id)) return;
  seen.add(entry.id);
  nodes.push(entry);
  if (entry.parentId) links.push({ from: entry.parentId, to: entry.id, type: 'parent_child' });
  for (const dependency of entry.dependsOn || []) links.push({ from: dependency, to: entry.id, type: 'soft_dependency' });
}

export function buildHierarchicalWorkPlan({ objective = {}, workGraph = {}, surfaceMatrix = { surfaces: [] }, options = {} } = {}) {
  const config = normalizeHierarchicalOptions({ ...options, ...(options.hierarchicalPlanning || {}) });
  const surfaceIndex = buildSurfaceIndex(surfaceMatrix);
  const workUnits = Array.isArray(workGraph?.workUnits) ? workGraph.workUnits : [];
  const objectiveId = config.planId || `${slug(objective.id || workGraph.objectiveId || config.objectiveId)}_v${HIERARCHICAL_WORK_PLANNING_VERSION}`;
  const rootNodeId = `objective:${slug(objective.id || workGraph.objectiveId || config.objectiveId)}`;
  const nodes = [];
  const links = [];
  const seen = new Set();
  const bindings = [];

  addPlanNode(nodes, links, seen, {
    id: rootNodeId,
    type: 'objective',
    depth: 0,
    title: objective.title || config.objectiveTitle,
    parentId: null,
    targetPath: objective.targetPath || workGraph.targetPath || null,
    requestedFidelity: objective.requestedFidelity || config.requestedFidelity,
    policy: config.policy,
    completionSourceOfTruth: 'hierarchical_plan_nodes'
  });

  const surfaceById = new Map((surfaceMatrix?.surfaces || []).map((surface) => [surface.id, surface]));

  for (const unit of workUnits) {
    const domainId = slug(unit.domain || unit.lane || 'default');
    const domainNodeId = `domain:${domainId}`;
    addPlanNode(nodes, links, seen, {
      id: domainNodeId,
      type: 'domain',
      depth: 1,
      title: titleCase(unit.domain || unit.lane || 'Default'),
      parentId: rootNodeId,
      lane: unit.lane || 'default',
      domain: unit.domain || unit.lane || 'default'
    });

    const surfaceIds = surfaceIdsForWorkUnit(unit, surfaceIndex);
    const primarySurfaceId = slug(surfaceIds[0] || unit.id);
    const surface = surfaceById.get(surfaceIds[0]) || {};
    const surfaceNodeId = `surface:${primarySurfaceId}`;
    addPlanNode(nodes, links, seen, {
      id: surfaceNodeId,
      type: 'surface',
      depth: 2,
      title: surface.label || surface.title || titleCase(surfaceIds[0] || unit.id),
      parentId: domainNodeId,
      surfaceIds,
      issueIds: stableList(surface.issueIds || [unit.id]),
      negativeSpaceInventory: [
        'missing or unproven user/runtime behavior',
        'unowned target files/modules',
        'absent verifier or operational proof'
      ]
    });

    const stageId = stageForWorkUnit(unit, config.stages);
    const stage = config.stages.find((entry) => entry.id === stageId) || config.stages[0];
    const stageNodeId = `stage:${primarySurfaceId}:${slug(stageId)}`;
    const workNodeId = `work:${slug(unit.id)}`;
    const proofNodeId = `proof:${slug(unit.id)}`;
    const substeps = buildHierarchicalSubsteps(unit, config);
    const acceptanceGates = buildHierarchicalAcceptanceGates(unit);
    const replanPolicy = buildHierarchicalReplanPolicy(unit, config);
    const targetWeave = targetFileRoleWeave([...(unit.allowedFiles || []), ...(unit.fileAreas || [])]);
    const counterfactualFailureTwins = buildCounterfactualFailureTwins({ unit, acceptanceGates, replanPolicy, targetFileRoleWeave: targetWeave });
    const proofObligationLedger = buildProofObligationLedger({ unit, acceptanceGates, counterfactualFailureTwins });

    addPlanNode(nodes, links, seen, {
      id: stageNodeId,
      type: 'planning_stage',
      depth: 3,
      title: stage.title,
      parentId: surfaceNodeId,
      stageId,
      intent: stage.intent,
      proof: stage.proof,
      targetFileRoleWeave: targetWeave
    });

    addPlanNode(nodes, links, seen, {
      id: workNodeId,
      type: 'implementation_step',
      depth: 4,
      title: unit.title || unit.id,
      parentId: stageNodeId,
      workUnitId: unit.id,
      targetFiles: stableList(unit.allowedFiles || []),
      targetModules: stableList(unit.fileAreas || []),
      substeps,
      acceptanceGates,
      antiNoopPolicy: {
        forbidNoModifiedFiles: true,
        forbidMarkerOnlyDelta: true,
        requireScopedTargetEvidence: true,
        requireSourceOfTruthAdoption: true
      },
      replanPolicy,
      counterfactualFailureTwins,
      proofObligationLedger
    });

    addPlanNode(nodes, links, seen, {
      id: proofNodeId,
      type: 'proof_gate',
      depth: 5,
      title: `${unit.title || unit.id} proof gate`,
      parentId: workNodeId,
      workUnitId: unit.id,
      requiredVerifiers: stableList(unit.requiredVerifiers || []),
      successPredicate: stableList(unit.acceptanceChecks || []),
      proofObligationLedger,
      dependsOn: [workNodeId]
    });

    bindings.push({
      workUnitId: unit.id,
      nodeId: workNodeId,
      proofNodeId,
      stageNodeId,
      surfaceNodeId,
      rootNodeId,
      surfaceIds,
      stageId,
      depthPath: [rootNodeId, domainNodeId, surfaceNodeId, stageNodeId, workNodeId, proofNodeId],
      requiredSubsteps: substeps,
      acceptanceGates,
      targetFileRoleWeave: targetWeave,
      replanPolicy,
      counterfactualFailureTwins,
      proofObligationLedger,
      planFingerprint: stableFingerprint({ workUnitId: unit.id, stageId, acceptanceGates, targetWeave, counterfactualFailureTwins })
    });
  }

  const typeCounts = nodes.reduce((acc, entry) => {
    acc[entry.type] = (acc[entry.type] || 0) + 1;
    return acc;
  }, {});
  const counterfactualTwinCount = bindings.reduce((count, binding) => count + (binding.counterfactualFailureTwins || []).length, 0);
  const proofObligationCount = bindings.reduce((count, binding) => count + (binding.proofObligationLedger || []).length, 0);
  const workUnitCoverage = workUnits.length === 0 ? 1 : bindings.length / workUnits.length;
  return {
    version: HIERARCHICAL_WORK_PLANNING_VERSION,
    generatedAt: new Date().toISOString(),
    planId: objectiveId,
    rootNodeId,
    targetPath: objective.targetPath || workGraph.targetPath || null,
    requestedFidelity: objective.requestedFidelity || config.requestedFidelity,
    summary: {
      nodeCount: nodes.length,
      linkCount: links.length,
      workUnitCount: workUnits.length,
      boundWorkUnitCount: bindings.length,
      workUnitCoverage: Number(workUnitCoverage.toFixed(4)),
      maxDepth: Math.max(0, ...nodes.map((entry) => Number(entry.depth || 0))),
      typeCounts,
      counterfactualTwinCount,
      proofObligationCount,
      worldFirstCandidate: {
        name: 'Counterfactual Proof-Twin Planner',
        externallyVerified: false,
        description: 'Every assignment carries machine-readable failure twins that describe fake-success modes before the agent runs, plus recovery microplans and proof obligations.'
      },
      novelPlannerFeatures: [...config.novelPlannerFeatures]
    },
    policy: config.policy,
    stages: config.stages,
    nodes,
    links,
    workUnitBindings: bindings
  };
}

export function bindHierarchicalPlanToWorkUnits(workUnits = [], hierarchicalPlan = {}, options = {}) {
  const config = normalizeHierarchicalOptions(options);
  const bindingByUnitId = new Map((hierarchicalPlan.workUnitBindings || []).map((binding) => [binding.workUnitId, binding]));
  return (Array.isArray(workUnits) ? workUnits : []).map((unit) => {
    const binding = bindingByUnitId.get(unit.id);
    if (!binding) return unit;
    const addedChecks = [
      `Follow hierarchical plan node ${binding.nodeId}; do not treat broad activity as completion.`,
      binding.requiredSubsteps[0],
      binding.requiredSubsteps[2],
      'If this node cannot produce scoped evidence, return a blocker/replan directive instead of a no-op or marker-only patch.'
    ].filter(Boolean);
    const acceptanceChecks = stableList([...(unit.acceptanceChecks || []), ...addedChecks]);
    const assignmentContract = unit.metadata?.assignmentContract || unit.assignmentContract
      ? normalizeAssignmentContract(unit.metadata?.assignmentContract || unit.assignmentContract || {}, {
          artifactKind: unit.metadata?.artifactKind || 'verification_evidence',
          targetFiles: unit.allowedFiles || [],
          targetModules: unit.fileAreas || [],
          verifierRequirements: unit.requiredVerifiers || [],
          successPredicate: acceptanceChecks
        })
      : null;
    return {
      ...unit,
      inputRefs: stableList([...(unit.inputRefs || []), config.inputRefName]),
      acceptanceChecks,
      metadata: {
        ...(unit.metadata || {}),
        ...(assignmentContract ? { assignmentContract: { ...assignmentContract, successPredicate: stableList([...(assignmentContract.successPredicate || []), ...acceptanceChecks]) } } : {}),
        [config.metadataKey]: {
          version: hierarchicalPlan.version,
          planId: hierarchicalPlan.planId,
          nodeId: binding.nodeId,
          proofNodeId: binding.proofNodeId,
          stageNodeId: binding.stageNodeId,
          surfaceNodeId: binding.surfaceNodeId,
          depthPath: binding.depthPath,
          stageId: binding.stageId,
          surfaceIds: binding.surfaceIds,
          requiredSubsteps: binding.requiredSubsteps,
          acceptanceGates: binding.acceptanceGates,
          targetFileRoleWeave: binding.targetFileRoleWeave,
          replanPolicy: binding.replanPolicy,
          counterfactualFailureTwins: binding.counterfactualFailureTwins,
          proofObligationLedger: binding.proofObligationLedger,
          planFingerprint: binding.planFingerprint
        }
      }
    };
  });
}

export function bindHierarchicalPlanToWorkGraph({ workGraph = {}, hierarchicalPlan = null, surfaceMatrix = { surfaces: [] }, objective = {}, options = {} } = {}) {
  const plan = hierarchicalPlan || buildHierarchicalWorkPlan({ objective, workGraph, surfaceMatrix, options });
  return {
    workGraph: {
      ...workGraph,
      workUnits: bindHierarchicalPlanToWorkUnits(workGraph.workUnits || [], plan, options),
      summary: {
        ...(workGraph.summary || {}),
        hierarchicalPlanning: {
          enabled: true,
          planId: plan.planId,
          nodeCount: plan.summary.nodeCount,
          maxDepth: plan.summary.maxDepth,
          workUnitCoverage: plan.summary.workUnitCoverage,
          counterfactualTwinCount: plan.summary.counterfactualTwinCount,
          proofObligationCount: plan.summary.proofObligationCount,
          worldFirstCandidate: plan.summary.worldFirstCandidate,
          novelPlannerFeatures: plan.summary.novelPlannerFeatures,
          policy: plan.policy
        }
      }
    },
    hierarchicalPlan: plan
  };
}

export function deriveHierarchicalReplanDirectives({ hierarchicalPlan = {}, failedWorkUnitIds = [], failureKind = 'zero_surviving_product_diff', options = {} } = {}) {
  const requested = new Set(stableList(failedWorkUnitIds));
  return (hierarchicalPlan.workUnitBindings || [])
    .filter((binding) => requested.size === 0 || requested.has(binding.workUnitId))
    .map((binding) => ({
      workUnitId: binding.workUnitId,
      nodeId: binding.nodeId,
      proofNodeId: binding.proofNodeId,
      failureKind,
      action: failureKind === 'zero_surviving_product_diff'
        ? binding.replanPolicy?.onZeroSurvivingDiff?.action || normalizeHierarchicalOptions(options).replanActions.zeroSurvivingDiff
        : failureKind === 'marker_only_delta'
          ? binding.replanPolicy?.onMarkerOnlyDiff?.action || normalizeHierarchicalOptions(options).replanActions.markerOnly
          : binding.replanPolicy?.onVerifierFailure?.action || normalizeHierarchicalOptions(options).replanActions.verifierFailure,
      stageId: binding.stageId,
      surfaceIds: binding.surfaceIds,
      microSteps: binding.replanPolicy?.onZeroSurvivingDiff?.microSteps || [],
      counterfactualFailureTwin: (binding.counterfactualFailureTwins || []).find((twin) => twin.kind === failureKind) || null,
      requiredSubsteps: binding.requiredSubsteps,
      acceptanceGates: binding.acceptanceGates
    }));
}

function shardToRootWorkUnitMap(shardPlan = null) {
  const map = new Map();
  for (const shard of shardPlan?.shards || []) map.set(shard.id, shard.rootWorkUnitId || shard.id);
  return map;
}

function patchRootWorkUnitId(patch = {}, shardRootMap = new Map()) {
  if (patch.metadata?.hierarchicalPlanning?.workUnitId) return patch.metadata.hierarchicalPlanning.workUnitId;
  if (patch.metadata?.strictHierarchicalPlanning?.workUnitId) return patch.metadata.strictHierarchicalPlanning.workUnitId;
  if (shardRootMap.has(patch.shardId)) return shardRootMap.get(patch.shardId);
  if (shardRootMap.has(patch.taskId)) return shardRootMap.get(patch.taskId);
  return `${patch.taskId || patch.shardId || ''}`.replace(/#\d+$/, '');
}

function patchModifiedFiles(patch = {}) {
  return stableList([
    ...(patch.filePaths || []),
    ...(patch.metadata?.implementation?.modifiedFiles || []),
    ...(patch.metadata?.modifiedFiles || []),
    ...(patch.metadata?.result?.modifiedFiles || [])
  ]);
}

function filesOverlapAny(files = [], targets = []) {
  const normalizedTargets = stableList(targets);
  if (normalizedTargets.length === 0) return files.length > 0;
  return files.some((filePath) => normalizedTargets.some((targetPath) => overlapsArea(filePath, targetPath)));
}

function patchPlanEvidence(patch = {}) {
  return patch.metadata?.hierarchicalPlanningEvidence
    || patch.metadata?.planEvidence
    || patch.metadata?.strictHierarchicalPlanningEvidence
    || patch.metadata?.architectureEvidence
    || patch.admissionAudit?.architectureAdmission?.details?.architectureEvidence
    || {};
}

function patchVerifierEvidenceOk(patches = [], requiredVerifiers = []) {
  const required = stableList(requiredVerifiers);
  if (required.length === 0) return true;
  const passed = new Set();
  for (const patch of patches) {
    for (const result of patch.verifierResults || []) {
      if (result?.ok !== false && result.verifier) passed.add(result.verifier);
    }
  }
  return required.every((verifier) => passed.has(verifier));
}

function evaluateProofGateStatus({ gate = {}, binding = {}, mergedPatches = [] } = {}) {
  const evidencePatchIds = mergedPatches.map((patch) => patch.id).filter(Boolean);
  if (gate.id === 'grounded_assignment_contract') {
    const contract = gate.contract || {};
    const grounded = validateGroundedAssignmentContract(contract);
    return { gateId: gate.id, required: gate.required !== false, status: grounded.ok ? 'satisfied' : 'blocked', evidencePatchIds: [], failures: grounded.failures };
  }
  if (gate.id === 'surviving_product_diff') {
    const targetFiles = stableList([...(gate.targetFiles || []), ...(gate.targetModules || [])]);
    const hasDelta = mergedPatches.some((patch) => filesOverlapAny(patchModifiedFiles(patch), targetFiles));
    return { gateId: gate.id, required: gate.required !== false, status: hasDelta || gate.required === false ? 'satisfied' : 'pending', evidencePatchIds: hasDelta ? evidencePatchIds : [] };
  }
  if (gate.id === 'source_of_truth_integration') {
    const integrated = mergedPatches.some((patch) => {
      const evidence = patchPlanEvidence(patch);
      return evidence.sourceOfTruthIntegrated === true
        || evidence.runtimeIntegrated === true
        || evidence.integrationVerified === true
        || evidence.primaryRuntimeAdopted === true
        || evidence.integration === true;
    });
    return { gateId: gate.id, required: gate.required !== false, status: integrated ? 'satisfied' : 'pending', evidencePatchIds: integrated ? evidencePatchIds : [] };
  }
  if (gate.id === 'negative_space_reduction') {
    const reduced = mergedPatches.some((patch) => {
      const evidence = patchPlanEvidence(patch);
      return evidence.negativeSpaceReduced === true
        || stableList(evidence.reducedGaps || []).length > 0
        || `${evidence.remainingGaps || ''}`.trim().length > 0;
    });
    return { gateId: gate.id, required: gate.required !== false, status: reduced ? 'satisfied' : 'pending', evidencePatchIds: reduced ? evidencePatchIds : [] };
  }
  if (gate.id === 'verifier_evidence') {
    const ok = patchVerifierEvidenceOk(mergedPatches, gate.verifiers || []);
    return { gateId: gate.id, required: gate.required !== false, status: ok ? 'satisfied' : 'pending', evidencePatchIds: ok ? evidencePatchIds : [] };
  }
  return { gateId: gate.id, required: gate.required !== false, status: mergedPatches.length > 0 || gate.required === false ? 'satisfied' : 'pending', evidencePatchIds };
}

function failureKindForGate(gateId) {
  if (gateId === 'surviving_product_diff') return 'zero_surviving_product_diff';
  if (gateId === 'source_of_truth_integration') return 'marker_only_delta';
  if (gateId === 'grounded_assignment_contract') return 'wrong_target_delta';
  if (gateId === 'negative_space_reduction') return 'negative_space_unreduced';
  if (gateId === 'verifier_evidence') return 'verifier_failure';
  return 'zero_surviving_product_diff';
}

export function compileHierarchicalPlanLedger({ hierarchicalPlan = {}, patchQueue = createPatchQueue(), shardPlan = null } = {}) {
  const shardRootMap = shardToRootWorkUnitMap(shardPlan);
  const mergedByRoot = new Map();
  const rejectedByRoot = new Map();
  for (const patch of patchQueue?.merged || []) {
    const rootId = patchRootWorkUnitId(patch, shardRootMap);
    if (!rootId) continue;
    if (!mergedByRoot.has(rootId)) mergedByRoot.set(rootId, []);
    mergedByRoot.get(rootId).push(patch);
  }
  for (const patch of patchQueue?.rejected || []) {
    const rootId = patchRootWorkUnitId(patch, shardRootMap);
    if (!rootId) continue;
    if (!rejectedByRoot.has(rootId)) rejectedByRoot.set(rootId, []);
    rejectedByRoot.get(rootId).push(patch);
  }

  const records = (hierarchicalPlan.workUnitBindings || []).map((binding) => {
    const mergedPatches = mergedByRoot.get(binding.workUnitId) || [];
    const rejectedPatches = rejectedByRoot.get(binding.workUnitId) || [];
    const gateStatuses = (binding.acceptanceGates || []).map((gate) => evaluateProofGateStatus({ gate, binding, mergedPatches }));
    const requiredGateStatuses = gateStatuses.filter((gate) => gate.required !== false);
    const unsatisfiedRequiredGates = requiredGateStatuses.filter((gate) => gate.status !== 'satisfied');
    const triggeredTwins = unsatisfiedRequiredGates
      .map((gate) => (binding.counterfactualFailureTwins || []).find((twin) => twin.kind === failureKindForGate(gate.gateId)) || null)
      .filter(Boolean);
    const status = unsatisfiedRequiredGates.length === 0
      ? 'credited'
      : rejectedPatches.length > 0
        ? 'blocked'
        : mergedPatches.length > 0
          ? 'evidence_incomplete'
          : 'pending';
    return {
      workUnitId: binding.workUnitId,
      nodeId: binding.nodeId,
      proofNodeId: binding.proofNodeId,
      stageId: binding.stageId,
      surfaceIds: binding.surfaceIds,
      status,
      credited: status === 'credited',
      mergedPatchIds: mergedPatches.map((patch) => patch.id).filter(Boolean),
      rejectedPatchIds: rejectedPatches.map((patch) => patch.id).filter(Boolean),
      gateStatuses,
      unsatisfiedRequiredGateIds: unsatisfiedRequiredGates.map((gate) => gate.gateId),
      triggeredCounterfactualTwins: triggeredTwins,
      replanDirectives: triggeredTwins.map((twin) => ({
        workUnitId: binding.workUnitId,
        nodeId: binding.nodeId,
        failureKind: twin.kind,
        action: twin.recoveryAction,
        microSteps: twin.microSteps,
        counterfactualTwinId: twin.id
      }))
    };
  });

  const creditedWorkUnitCount = records.filter((record) => record.status === 'credited').length;
  const blockedWorkUnitCount = records.filter((record) => record.status === 'blocked').length;
  const evidenceIncompleteWorkUnitCount = records.filter((record) => record.status === 'evidence_incomplete').length;
  const pendingWorkUnitCount = records.filter((record) => record.status === 'pending').length;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    planId: hierarchicalPlan.planId || null,
    summary: {
      workUnitCount: records.length,
      creditedWorkUnitCount,
      blockedWorkUnitCount,
      evidenceIncompleteWorkUnitCount,
      pendingWorkUnitCount,
      completionEligible: records.length > 0 && creditedWorkUnitCount === records.length,
      status: records.length > 0 && creditedWorkUnitCount === records.length
        ? 'green'
        : blockedWorkUnitCount > 0
          ? 'red'
          : evidenceIncompleteWorkUnitCount > 0
            ? 'amber'
            : 'pending'
    },
    records
  };
}

function buildSurfaceIndex(surfaceMatrix) {
  const index = new Map();
  for (const surface of surfaceMatrix?.surfaces || []) {
    for (const issueId of surface.issueIds || []) {
      const existing = index.get(issueId) || [];
      existing.push(surface.id);
      index.set(issueId, stableList(existing));
    }
  }
  return index;
}

export function summarizeShardFrontier(shards = []) {
  const pending = new Set(shards.map((shard) => shard.id));
  const completed = new Set();
  const layers = [];

  while (pending.size > 0) {
    const ready = shards
      .filter((shard) => pending.has(shard.id) && (shard.dependencyShardIds || []).every((dependencyShardId) => completed.has(dependencyShardId)))
      .map((shard) => shard.id)
      .sort();

    if (!ready.length) {
      layers.push({ index: layers.length + 1, shardIds: [...pending].sort(), count: pending.size, blockedByCycle: true });
      break;
    }

    layers.push({ index: layers.length + 1, shardIds: ready, count: ready.length, blockedByCycle: false });
    for (const shardId of ready) {
      pending.delete(shardId);
      completed.add(shardId);
    }
  }

  const counts = layers.map((layer) => layer.count);
  return {
    initialReadyCount: counts[0] || 0,
    maxReadyCount: counts.length ? Math.max(...counts) : 0,
    layerCount: layers.length,
    blockedByCycle: layers.some((layer) => layer.blockedByCycle),
    layers
  };
}

function normalizeWorkUnit(unit, surfaceIndex = new Map()) {
  if (!unit?.id) throw new Error('workUnit.id is required');
  const fileAreas = stableList(unit.fileAreas || unit.fileArea || []);
  const allowedFiles = stableList(unit.allowedFiles || unit.files || []);
  const acceptanceChecks = stableList(unit.acceptanceChecks || unit.acceptanceCriteria || ['complete local acceptance checks']);
  const deps = stableList(unit.deps || unit.dependencies || []);
  const requiredVerifiers = stableList(unit.requiredVerifiers || ['tests']);
  const assignmentContract = normalizeAssignmentContract(unit.assignmentContract || unit.metadata?.assignmentContract || {}, {
    artifactKind: unit.metadata?.artifactKind || 'verification_evidence',
    targetFiles: allowedFiles,
    targetModules: fileAreas,
    verifierRequirements: requiredVerifiers,
    successPredicate: acceptanceChecks
  });
  return {
    id: unit.id,
    title: unit.title || unit.id,
    goal: unit.goal || unit.title || unit.id,
    lane: unit.lane || 'default',
    domain: unit.domain || unit.lane || 'default',
    fileAreas,
    allowedFiles,
    deps,
    inputRefs: stableList(unit.inputRefs || []),
    inputs: unit.inputs || {},
    requiredVerifiers,
    acceptanceChecks,
    effortSteps: Math.max(1, Number(unit.effortSteps || 1)),
    stallAttempts: stableList(unit.stallAttempts || []).map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry) && entry > 0),
    ownership: {
      lane: unit.lane || 'default',
      domain: unit.domain || unit.lane || 'default',
      fileAreas
    },
    surfaceIds: stableList(unit.surfaceIds || surfaceIndex.get(unit.id) || []),
    metadata: {
      ...(unit.metadata || {}),
      assignmentContract
    }
  };
}

export function buildShardPlan({ workGraph, surfaceMatrix = { surfaces: [] }, options = {} }) {
  const maxFileAreasPerShard = Math.max(1, Number(options.maxFileAreasPerShard || 2));
  const maxFilesPerShard = Math.max(1, Number(options.maxFilesPerShard || 4));
  const maxAcceptanceChecksPerShard = Math.max(1, Number(options.maxAcceptanceChecksPerShard || 4));
  const hierarchicalPlanningRequested = options.requireHierarchicalPlanning === true
    || options.hierarchicalPlanning === true
    || (options.hierarchicalPlanning && typeof options.hierarchicalPlanning === 'object' && options.hierarchicalPlanning.enabled === true);
  let effectiveWorkGraph = workGraph || {};
  let hierarchicalPlan = null;
  if (hierarchicalPlanningRequested) {
    const hierarchicalOptions = options.hierarchicalPlanning && typeof options.hierarchicalPlanning === 'object' ? options.hierarchicalPlanning : {};
    const bound = bindHierarchicalPlanToWorkGraph({
      workGraph: effectiveWorkGraph,
      surfaceMatrix,
      objective: hierarchicalOptions.objective || options.objective || {},
      options: hierarchicalOptions
    });
    effectiveWorkGraph = bound.workGraph;
    hierarchicalPlan = bound.hierarchicalPlan;
  }
  const surfaceIndex = buildSurfaceIndex(surfaceMatrix);
  const workUnits = (effectiveWorkGraph?.workUnits || []).map((unit) => normalizeWorkUnit(unit, surfaceIndex));
  const unitShardIds = new Map();

  for (const unit of workUnits) {
    const sliceCount = Math.max(
      chunk(unit.fileAreas, maxFileAreasPerShard).length,
      chunk(unit.allowedFiles, maxFilesPerShard).length,
      chunk(unit.acceptanceChecks, maxAcceptanceChecksPerShard).length
    );
    unitShardIds.set(unit.id, Array.from({ length: sliceCount }, (_, index) => sliceCount === 1 ? unit.id : `${unit.id}#${index + 1}`));
  }

  const shards = [];
  for (const unit of workUnits) {
    const shardIds = unitShardIds.get(unit.id);
    const fileAreaChunks = chunk(unit.fileAreas, maxFileAreasPerShard);
    const allowedFileChunks = chunk(unit.allowedFiles, maxFilesPerShard);
    const acceptanceChunks = chunk(unit.acceptanceChecks, maxAcceptanceChecksPerShard);
    for (let index = 0; index < shardIds.length; index += 1) {
      const shardId = shardIds[index];
      const dependencyShardIds = index > 0
        ? [shardIds[index - 1]]
        : stableList(unit.deps.map((depId) => unitShardIds.get(depId)?.at(-1)).filter(Boolean));
      const shardFileAreas = fileAreaChunks[index] || (fileAreaChunks.length > 0 ? unit.fileAreas : []);
      const shardAllowedFiles = allowedFileChunks[index] || (allowedFileChunks.length > 0 ? unit.allowedFiles : []);
      const shardAcceptanceChecks = acceptanceChunks[index] && acceptanceChunks[index].length ? acceptanceChunks[index] : unit.acceptanceChecks;
      shards.push({
        id: shardId,
        rootWorkUnitId: unit.id,
        title: shardIds.length === 1 ? unit.title : `${unit.title} (${index + 1}/${shardIds.length})`,
        goal: shardIds.length === 1 ? unit.goal : `${unit.goal} [slice ${index + 1}/${shardIds.length}]`,
        splitPart: shardIds.length === 1 ? null : { index: index + 1, total: shardIds.length },
        lane: unit.lane,
        domain: unit.domain,
        surfaceIds: unit.surfaceIds,
        fileAreas: shardFileAreas,
        allowedFiles: shardAllowedFiles,
        dependencyShardIds,
        inputRefs: unit.inputRefs,
        inputs: unit.inputs,
        acceptanceChecks: shardAcceptanceChecks,
        requiredVerifiers: unit.requiredVerifiers,
        effortSteps: unit.effortSteps,
        stallAttempts: unit.stallAttempts,
        ownership: unit.ownership,
        metadata: {
          ...unit.metadata,
          assignmentContract: normalizeAssignmentContract({
            ...(unit.metadata?.assignmentContract || {}),
            targetFiles: shardAllowedFiles,
            targetModules: shardFileAreas.length ? shardFileAreas : shardAllowedFiles,
            verifierRequirements: unit.requiredVerifiers,
            successPredicate: shardAcceptanceChecks
          }, {
            artifactKind: unit.metadata?.assignmentContract?.artifactKind || unit.metadata?.artifactKind || 'verification_evidence'
          })
        }
      });
    }
  }

  const byLane = {};
  const byDomain = {};
  for (const shard of shards) {
    byLane[shard.lane] ||= [];
    byLane[shard.lane].push(shard.id);
    byDomain[shard.domain] ||= [];
    byDomain[shard.domain].push(shard.id);
  }

  const frontier = summarizeShardFrontier(shards);

  return {
    generatedAt: new Date().toISOString(),
    targetPath: effectiveWorkGraph?.targetPath || null,
    summary: {
      workUnitCount: workUnits.length,
      shardCount: shards.length,
      laneCount: Object.keys(byLane).length,
      domainCount: Object.keys(byDomain).length,
      maxDependenciesPerShard: Math.max(0, ...shards.map((shard) => shard.dependencyShardIds.length)),
      initialReadyCount: frontier.initialReadyCount,
      maxReadyCount: frontier.maxReadyCount,
      readyLayerCount: frontier.layerCount,
      hierarchicalPlanning: hierarchicalPlan ? {
        enabled: true,
        planId: hierarchicalPlan.planId,
        nodeCount: hierarchicalPlan.summary.nodeCount,
        maxDepth: hierarchicalPlan.summary.maxDepth,
        workUnitCoverage: hierarchicalPlan.summary.workUnitCoverage,
        novelPlannerFeatures: hierarchicalPlan.summary.novelPlannerFeatures
      } : null
    },
    hierarchicalPlan,
    byLane,
    byDomain,
    workUnits,
    shards,
    frontier,
    rootShardMap: Object.fromEntries([...unitShardIds.entries()])
  };
}

export function createLeaseState(input = {}) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    defaultTtlMs: Math.max(1000, Number(input.defaultTtlMs || 5 * 60 * 1000)),
    sequence: 1,
    taskAttempts: {},
    tasks: {},
    fileAreas: {},
    history: []
  };
}

function isLeaseActive(lease, now = Date.now()) {
  return Boolean(lease && lease.status === 'active' && new Date(lease.expiresAt).getTime() > now);
}

function activeLeases(state, now = Date.now()) {
  return Object.values(state.tasks || {}).filter((lease) => isLeaseActive(lease, now));
}

export function detectOwnershipConflicts(state, request, now = Date.now()) {
  const taskId = request.taskId;
  const fileAreas = stableList(request.fileAreas || []);
  const conflicts = [];
  for (const lease of activeLeases(state, now)) {
    if (lease.taskId === taskId) {
      if (request.agentId && lease.agentId !== request.agentId) {
        conflicts.push({ type: 'task_owned', taskId, leaseId: lease.leaseId, ownerAgentId: lease.agentId });
      }
      continue;
    }
    const overlapping = fileAreas.filter((area) => lease.fileAreas.some((ownedArea) => overlapsArea(area, ownedArea)));
    if (overlapping.length) {
      conflicts.push({ type: 'file_area_owned', taskId, ownerTaskId: lease.taskId, ownerAgentId: lease.agentId, fileAreas: overlapping, leaseId: lease.leaseId });
    }
  }
  return conflicts;
}

export function acquireLease(state, request, now = Date.now()) {
  const next = clone(state);
  const fileAreas = stableList(request.fileAreas || []);
  const ttlMs = Math.max(1000, Number(request.ttlMs || next.defaultTtlMs));
  const conflicts = detectOwnershipConflicts(next, { ...request, fileAreas }, now);
  if (conflicts.length) return { ok: false, state: next, conflicts };

  const existing = next.tasks[request.taskId];
  if (existing && isLeaseActive(existing, now) && existing.agentId === request.agentId) {
    existing.expiresAt = iso(now + ttlMs);
    existing.ttlMs = ttlMs;
    next.history.push({ at: iso(now), type: 'lease_renewed_via_acquire', leaseId: existing.leaseId, taskId: existing.taskId, agentId: existing.agentId });
    return { ok: true, state: next, lease: clone(existing) };
  }

  const attempt = (next.taskAttempts[request.taskId] || 0) + 1;
  next.taskAttempts[request.taskId] = attempt;
  const leaseId = request.leaseId || `lease-${next.sequence++}`;
  const lease = {
    leaseId,
    taskId: request.taskId,
    agentId: request.agentId,
    fileAreas,
    claimedAt: iso(now),
    expiresAt: iso(now + ttlMs),
    ttlMs,
    status: 'active',
    attempt,
    metadata: request.metadata || {}
  };
  next.tasks[request.taskId] = lease;
  for (const area of fileAreas) next.fileAreas[area] = leaseId;
  next.history.push({ at: iso(now), type: 'lease_acquired', leaseId, taskId: request.taskId, agentId: request.agentId, fileAreas, attempt });
  return { ok: true, state: next, lease: clone(lease) };
}

export function renewLease(state, request, now = Date.now()) {
  const next = clone(state);
  const lease = Object.values(next.tasks).find((entry) => entry.leaseId === request.leaseId || entry.taskId === request.taskId);
  if (!lease) return { ok: false, state: next, error: 'lease_not_found' };
  if (!isLeaseActive(lease, now)) return { ok: false, state: next, error: 'lease_not_active' };
  if (request.agentId && lease.agentId !== request.agentId) return { ok: false, state: next, error: 'lease_owned_by_other_agent' };
  const ttlMs = Math.max(1000, Number(request.ttlMs || lease.ttlMs || next.defaultTtlMs));
  lease.expiresAt = iso(now + ttlMs);
  lease.ttlMs = ttlMs;
  next.history.push({ at: iso(now), type: 'lease_renewed', leaseId: lease.leaseId, taskId: lease.taskId, agentId: lease.agentId, ttlMs });
  return { ok: true, state: next, lease: clone(lease) };
}

export function releaseLease(state, request, now = Date.now()) {
  const next = clone(state);
  const lease = Object.values(next.tasks).find((entry) => entry.leaseId === request.leaseId || entry.taskId === request.taskId);
  if (!lease) return { ok: false, state: next, error: 'lease_not_found' };
  if (request.agentId && lease.agentId !== request.agentId) return { ok: false, state: next, error: 'lease_owned_by_other_agent' };
  lease.status = request.reason === 'completed' ? 'completed' : request.reason === 'expired' ? 'expired' : 'released';
  lease.releasedAt = iso(now);
  lease.releaseReason = request.reason || 'released';
  for (const [area, leaseId] of Object.entries(next.fileAreas)) {
    if (leaseId === lease.leaseId) delete next.fileAreas[area];
  }
  next.history.push({ at: iso(now), type: 'lease_released', leaseId: lease.leaseId, taskId: lease.taskId, agentId: lease.agentId, reason: lease.releaseReason });
  return { ok: true, state: next, lease: clone(lease) };
}

export function detectStaleLeases(state, { now = Date.now() } = {}) {
  return Object.values(state.tasks || {})
    .filter((lease) => lease?.status === 'active' && new Date(lease.expiresAt).getTime() <= now)
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
}

export function recoverStaleLeases(state, { now = Date.now(), agentIds = [] } = {}) {
  let next = clone(state);
  const staleLeases = detectStaleLeases(next, { now });
  const recoveryActions = [];
  const orderedAgents = stableList(agentIds);
  let rotationIndex = 0;

  for (const stale of staleLeases) {
    const released = releaseLease(next, { leaseId: stale.leaseId, agentId: stale.agentId, reason: 'expired' }, now);
    next = released.state;
    const recoveryAgent = orderedAgents[rotationIndex % (orderedAgents.length || 1)] || stale.agentId;
    rotationIndex += 1;
    const reacquired = acquireLease(next, {
      taskId: stale.taskId,
      agentId: recoveryAgent,
      fileAreas: stale.fileAreas,
      ttlMs: stale.ttlMs,
      metadata: { recoveredFrom: stale.leaseId }
    }, now);
    next = reacquired.state;
    recoveryActions.push({
      taskId: stale.taskId,
      previousAgentId: stale.agentId,
      nextAgentId: reacquired.lease?.agentId || recoveryAgent,
      previousLeaseId: stale.leaseId,
      nextLeaseId: reacquired.lease?.leaseId || null,
      fileAreas: stale.fileAreas
    });
  }

  return {
    state: next,
    staleLeases,
    recoveryActions,
    recoveredCount: recoveryActions.length
  };
}

function detectFailedShards({ shardPlan, patchQueue, leaseState, maxAttemptsPerTask, activeShardIds = new Set(), leasedShardIds = new Set(), queuedShardIds = new Set() }) {
  if (!Number.isFinite(maxAttemptsPerTask) || maxAttemptsPerTask <= 0) return [];
  const merged = new Set((patchQueue?.merged || []).map((artifact) => artifact.shardId));
  const rejected = new Set((patchQueue?.rejected || []).map((artifact) => artifact.shardId).filter(Boolean));
  const active = activeShardIds instanceof Set ? activeShardIds : new Set(activeShardIds || []);
  const leased = leasedShardIds instanceof Set ? leasedShardIds : new Set(leasedShardIds || []);
  const queued = queuedShardIds instanceof Set ? queuedShardIds : new Set(queuedShardIds || []);
  return shardPlan.shards
    .filter((shard) => !merged.has(shard.id)
      && !rejected.has(shard.id)
      && !active.has(shard.id)
      && !leased.has(shard.id)
      && !queued.has(shard.id)
      && Number(leaseState?.taskAttempts?.[shard.id] || 0) >= maxAttemptsPerTask)
    .map((shard) => ({
      shardId: shard.id,
      attempts: Number(leaseState?.taskAttempts?.[shard.id] || 0),
      maxAttemptsPerTask,
      dependencies: shard.dependencyShardIds || [],
      fileAreas: shard.fileAreas || []
    }));
}

export function createArtifactBus(input = {}) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    rootPath: input.rootPath || null,
    sequence: 1,
    registry: [],
    events: []
  };
}

export function publishArtifact(bus, input) {
  const next = bus || createArtifactBus();
  const artifactId = input.id || `artifact-${next.sequence++}`;
  const artifact = {
    artifactId,
    type: input.type,
    shardId: input.shardId || null,
    taskId: input.taskId || input.shardId || null,
    producer: input.producer || null,
    filePath: input.filePath || null,
    metadata: input.metadata || {},
    createdAt: input.createdAt || new Date().toISOString()
  };
  next.registry.push(artifact);
  next.events.push({ id: `event-${next.sequence++}`, at: artifact.createdAt, type: 'artifact_published', artifactId, artifactType: artifact.type, shardId: artifact.shardId, taskId: artifact.taskId });
  return { bus: next, artifact };
}

export function recordArtifactEvent(bus, event) {
  const next = bus || createArtifactBus();
  next.events.push({ id: `event-${next.sequence++}`, at: event.at || new Date().toISOString(), ...event });
  return next;
}

export function findArtifacts(bus, filter = {}) {
  return bus.registry.filter((artifact) => {
    if (filter.type && artifact.type !== filter.type) return false;
    if (filter.shardId && artifact.shardId !== filter.shardId) return false;
    if (filter.taskId && artifact.taskId !== filter.taskId) return false;
    return true;
  });
}

export function summarizeArtifactBus(bus) {
  const byType = {};
  const byShard = {};
  for (const artifact of bus.registry) {
    byType[artifact.type] ||= 0;
    byType[artifact.type] += 1;
    if (artifact.shardId) {
      byShard[artifact.shardId] ||= 0;
      byShard[artifact.shardId] += 1;
    }
  }
  return {
    artifactCount: bus.registry.length,
    eventCount: bus.events.length,
    byType,
    byShard
  };
}

function boolish(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
  return fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function approxTokenCount(value = '') {
  return Math.ceil(String(value || '').length / 4);
}

function compactInlineText(value = '', maxChars = 1200) {
  const text = String(value || '');
  const max = Math.max(120, Number(maxChars || 1200));
  if (text.length <= max) return text;
  const head = Math.max(60, Math.floor(max * 0.62));
  const tail = Math.max(40, max - head - 80);
  return `${text.slice(0, head)}
...[context-governor trimmed ${Math.max(0, text.length - head - tail)} chars]...
${text.slice(-tail)}`;
}

function valueKind(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function compactInputValue(key, value, policy, state) {
  const serialized = JSON.stringify(value ?? null);
  const approxTokens = approxTokenCount(serialized);
  const maxInlineChars = Math.max(80, Number(policy.maxInputChars || 1200));
  const remainingChars = Math.max(0, Number(policy.maxTotalInputChars || 6000) - state.inlineChars);
  const handle = {
    key,
    kind: valueKind(value),
    approxTokens,
    retrieval: 'on_demand',
    reason: serialized.length > maxInlineChars ? 'input_too_large_for_worker_pack' : 'context_total_budget_reserved'
  };
  if (serialized.length <= maxInlineChars && serialized.length <= remainingChars) {
    state.inlineChars += serialized.length;
    return { kept: true, value, handle: null };
  }
  if (typeof value === 'string' && remainingChars > 120) {
    const trimmed = compactInlineText(value, Math.min(maxInlineChars, remainingChars));
    state.inlineChars += trimmed.length;
    return { kept: true, value: trimmed, handle: { ...handle, inlineTrimmed: true } };
  }
  return { kept: false, value: { __contextRef: `input:${key}`, kind: handle.kind, approxTokens, retrieval: 'on_demand' }, handle };
}

export function estimateContextTokens(value) {
  return approxTokenCount(typeof value === 'string' ? value : JSON.stringify(value ?? null));
}

export function normalizeContextGovernorOptions(options = {}, { agentCount = 0, shardCount = 0 } = {}) {
  const explicitEnabled = options.enabled ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR;
  const autoEnabled = Number(agentCount || 0) >= positiveNumber(process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_AUTO_AGENT_THRESHOLD, 25)
    || boolish(process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_AUTO, false);
  const enabled = explicitEnabled === undefined || explicitEnabled === null || explicitEnabled === ''
    ? autoEnabled
    : boolish(explicitEnabled, autoEnabled);
  const maxWorkerTokens = positiveNumber(options.maxWorkerTokens ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS, 3200);
  const hardGateDefault = enabled && Number(agentCount || 0) >= positiveNumber(process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_HARD_GATE_AGENT_THRESHOLD, 25);
  return {
    enabled,
    mode: options.mode || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_MODE || 'narrow_worker_context_packs',
    hardGate: boolish(options.hardGate ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_HARD_GATE, hardGateDefault),
    maxWorkerTokens,
    globalTokenCap: positiveNumber(options.globalTokenCap ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_GLOBAL_TOKEN_CAP, null),
    targetSavingsMin: positiveNumber(options.targetSavingsMin ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_TARGET_SAVINGS_MIN, 5),
    targetSavingsMax: positiveNumber(options.targetSavingsMax ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_TARGET_SAVINGS_MAX, 10),
    maxInputChars: positiveNumber(options.maxInputChars ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_INPUT_CHARS, 1200),
    maxTotalInputChars: positiveNumber(options.maxTotalInputChars ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_TOTAL_INPUT_CHARS, 6000),
    maxDependencyArtifacts: positiveNumber(options.maxDependencyArtifacts ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_DEPENDENCY_ARTIFACTS, 8),
    maxRelatedSurfaces: positiveNumber(options.maxRelatedSurfaces ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_RELATED_SURFACES, 8),
    maxAllowedFiles: positiveNumber(options.maxAllowedFiles ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_ALLOWED_FILES, 16),
    maxFileAreas: positiveNumber(options.maxFileAreas ?? process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_FILE_AREAS, 12),
    workerPromptMode: options.workerPromptMode || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_WORKER_PROMPT_MODE || 'compact',
    workerRole: options.workerRole || 'narrow_worker',
    plannerRole: options.plannerRole || 'planner_or_reviewer',
    reviewerRole: options.reviewerRole || 'reviewer_or_gatekeeper',
    workerModel: options.workerModel || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_WORKER_MODEL || 'cheap_implementation_worker',
    plannerModel: options.plannerModel || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_PLANNER_MODEL || 'strong_planner',
    reviewerModel: options.reviewerModel || process.env.ORCHESTRATOR_CONTEXT_GOVERNOR_REVIEWER_MODEL || 'strong_reviewer',
    retrievalMode: options.retrievalMode || 'on_demand_assigned_files_only',
    waveFactpackSchema: options.waveFactpackSchema || 'clawd.wave_factpack.v1',
    agentCount: Number(agentCount || 0),
    shardCount: Number(shardCount || 0)
  };
}

export function buildModelTierPlan({ shard = {}, policy = normalizeContextGovernorOptions({}, {}) } = {}) {
  const artifactKind = shard.metadata?.assignmentContract?.artifactKind || shard.metadata?.artifactKind || 'verification_evidence';
  const complexity = stableList([
    shard.metadata?.semanticPhaseId,
    shard.metadata?.structuralPhaseId,
    shard.metadata?.focusLane,
    shard.lane,
    shard.domain
  ]).join(':');
  const needsStrongWorker = /security|auth|persistence|migration|architecture|editor|journey/i.test(`${artifactKind}:${complexity}`);
  return {
    schemaVersion: 'clawd.model_tier_plan.v1',
    planner: { role: policy.plannerRole, tier: policy.plannerModel, context: 'surface_matrix+wave_factpack+blockers' },
    reviewer: { role: policy.reviewerRole, tier: policy.reviewerModel, context: 'patch+proof+targeted_failure' },
    worker: {
      role: policy.workerRole,
      tier: needsStrongWorker ? `${policy.workerModel}+escalate_if_needed` : policy.workerModel,
      promptMode: policy.workerPromptMode,
      context: 'single_shard_context_pack+retrieval_manifest',
      escalation: 'return blocker/escalation request instead of expanding context autonomously'
    }
  };
}

function compactVerifierCatalogForWorker(verifierCatalog = {}) {
  if (!verifierCatalog || typeof verifierCatalog !== 'object') return verifierCatalog;
  return Object.fromEntries(Object.entries(verifierCatalog).map(([id, entry]) => [id, {
    id: entry?.id || id,
    command: entry?.command || null,
    purpose: entry?.purpose || null,
    surfaceId: entry?.surfaceId || null,
    allowedFiles: stableList(entry?.allowedFiles || [])
  }]));
}

function compactAcceptanceCheckForWorker(check = '') {
  const text = String(check || '').trim();
  const verifierMatch = text.match(/^Verifier passes:\s*(.+)$/i);
  if (verifierMatch) return 'Verifier passes: assigned external surface verifier';
  return compactInlineText(text, 220);
}

function compactAssignmentContractForWorker(contract = {}) {
  if (!contract || typeof contract !== 'object') return contract;
  return {
    ...contract,
    successPredicate: stableList(contract.successPredicate || []).map(compactAcceptanceCheckForWorker),
    verifierRequirements: stableList(contract.verifierRequirements || [])
  };
}

function compactLearningPatternForWorker(pattern = {}) {
  return {
    id: pattern?.id || null,
    kind: pattern?.kind || null,
    title: compactInlineText(pattern?.title || '', 120),
    summary: compactInlineText(pattern?.summary || '', 320),
    trust: pattern?.trust || null,
    matchScore: pattern?.matchScore ?? null,
    files: stableList(pattern?.files || []).slice(0, 4),
    verifiers: stableList(pattern?.verifiers || []).slice(0, 4),
    failure: pattern?.failure ? {
      reason: pattern.failure.reason || null,
      category: pattern.failure.category || null
    } : null
  };
}

function compactLearningContextForWorker(context = {}) {
  if (!context || typeof context !== 'object') return context;
  const agentWorkLanguageFragments = (Array.isArray(context.agentWorkLanguageFragments) ? context.agentWorkLanguageFragments : [])
    .slice(0, 3)
    .map((fragment) => ({
      format: fragment?.format || null,
      languageVersion: fragment?.languageVersion || null,
      parseOk: fragment?.parseOk === true,
      parseError: fragment?.parseError || null,
      sourcePreview: compactInlineText(fragment?.source || '', 320)
    }));
  return {
    schemaVersion: context.schemaVersion || 'clawd.orchestration_learning_context.v1',
    ledgerProject: context.ledgerProject || null,
    query: context.query ? {
      id: context.query.id || null,
      lane: context.query.lane || null,
      files: stableList(context.query.files || []).slice(0, 4)
    } : null,
    architecturePatterns: (Array.isArray(context.architecturePatterns) ? context.architecturePatterns : []).slice(0, 2).map(compactLearningPatternForWorker),
    antiPatterns: (Array.isArray(context.antiPatterns) ? context.antiPatterns : []).slice(0, 3).map(compactLearningPatternForWorker),
    repairStrategies: (Array.isArray(context.repairStrategies) ? context.repairStrategies : []).slice(0, 2).map(compactLearningPatternForWorker),
    agentWorkLanguageFragments,
    compactedForWorkerPrompt: true,
    omittedFields: ['agentWorkLanguage.parsed', 'agentWorkLanguage.source_full', 'provenance', 'quality.details']
  };
}

export function compactContextPack(pack, options = {}) {
  const policy = normalizeContextGovernorOptions(options, options);
  if (!policy.enabled) return pack;
  const preGovernorJson = JSON.stringify(pack ?? null);
  const compact = clone(pack);
  const omissions = [];
  const inputHandles = [];
  const inputState = { inlineChars: 0 };
  if (compact.inputs?.verifierCatalog) {
    compact.inputs.verifierCatalog = compactVerifierCatalogForWorker(compact.inputs.verifierCatalog);
    omissions.push({ type: 'verifierCatalog.command', reason: 'external_verifier_commands_available_by_id_after_worker_patch', retrieval: 'verifier_catalog_by_shard' });
  }
  compact.acceptanceChecks = stableList(compact.acceptanceChecks || []).map(compactAcceptanceCheckForWorker);
  compact.assignmentContract = compactAssignmentContractForWorker(compact.assignmentContract || {});
  if (compact.learningContext) {
    compact.learningContext = compactLearningContextForWorker(compact.learningContext);
    omissions.push({ type: 'learningContext.verbose_fields', reason: 'learning patterns compacted to ids/summaries/handles for worker budget', retrieval: 'orchestration_learning_ledger_by_pattern_id' });
  }
  const nextInputs = {};
  for (const [key, value] of Object.entries(compact.inputs || {})) {
    const result = compactInputValue(key, value, policy, inputState);
    nextInputs[key] = result.value;
    if (result.handle) inputHandles.push(result.handle);
    if (!result.kept) omissions.push({ type: 'input', key, reason: result.handle?.reason || 'input_omitted' });
  }
  compact.inputs = nextInputs;

  const fullAllowedFiles = stableList(compact.guardrails?.allowedFiles || []);
  const fullFileAreas = stableList(compact.guardrails?.fileAreas || []);
  const allowedFiles = fullAllowedFiles.slice(0, policy.maxAllowedFiles);
  const fileAreas = fullFileAreas.slice(0, policy.maxFileAreas);
  if (fullAllowedFiles.length > allowedFiles.length) omissions.push({ type: 'allowedFiles', omittedCount: fullAllowedFiles.length - allowedFiles.length, retrieval: 'assignment.shard.allowedFiles' });
  if (fullFileAreas.length > fileAreas.length) omissions.push({ type: 'fileAreas', omittedCount: fullFileAreas.length - fileAreas.length, retrieval: 'assignment.shard.fileAreas' });
  compact.guardrails = {
    ...(compact.guardrails || {}),
    allowedFiles,
    fileAreas,
    avoidWholeProjectPromptDump: true,
    retrievalBeforeBroadSearch: true,
    maxWorkerContextTokens: policy.maxWorkerTokens,
    promptMode: policy.workerPromptMode
  };

  const dependencyArtifacts = (compact.dependencies?.artifacts || []).slice(0, policy.maxDependencyArtifacts);
  if ((compact.dependencies?.artifacts || []).length > dependencyArtifacts.length) omissions.push({ type: 'dependencyArtifacts', omittedCount: compact.dependencies.artifacts.length - dependencyArtifacts.length, retrieval: 'artifact_bus_lookup_by_dependency_shard' });
  compact.dependencies = {
    ...(compact.dependencies || {}),
    artifacts: dependencyArtifacts,
    previousWaveFactpack: compact.dependencies?.previousWaveFactpack || null
  };
  compact.relatedSurfaces = (compact.relatedSurfaces || []).slice(0, policy.maxRelatedSurfaces);

  const retrievalFiles = stableList([
    ...fullAllowedFiles,
    ...fullFileAreas,
    ...(compact.assignmentContract?.targetFiles || []),
    ...(compact.assignmentContract?.targetModules || [])
  ]);
  compact.retrievalManifest = {
    mode: policy.retrievalMode,
    instructions: [
      'Start with assigned product files only.',
      'Request or inspect direct imports only when the compact pack is stale or insufficient.',
      'Do not paste whole repo summaries or prior transcripts into worker prompts.',
      compact.learningContext ? 'Apply matching learned Agent Work pattern fragments when they fit the assigned surface; obey anti-pattern warnings first.' : null
    ],
    fileHandles: retrievalFiles.map((rel) => ({ rel, allowed: fullAllowedFiles.includes(rel) || fullFileAreas.some((area) => overlapsArea(rel, area)) })),
    inputHandles,
    dependencyLookup: stableList(compact.dependencies?.shardIds || []).map((shardId) => ({ shardId, lookup: 'artifact_bus_by_shard' })),
    learningPatternHandles: compact.learningContext ? [
      ...(compact.learningContext.architecturePatterns || []).map((pattern) => ({ kind: 'architecture_pattern', id: pattern.id, trust: pattern.trust, matchScore: pattern.matchScore })),
      ...(compact.learningContext.antiPatterns || []).map((pattern) => ({ kind: 'anti_pattern', id: pattern.id, trust: pattern.trust, matchScore: pattern.matchScore })),
      ...(compact.learningContext.repairStrategies || []).map((pattern) => ({ kind: 'repair_strategy', id: pattern.id, trust: pattern.trust, matchScore: pattern.matchScore }))
    ] : []
  };
  compact.retrievalManifest.instructions = compact.retrievalManifest.instructions.filter(Boolean);
  compact.modelTierPlan = buildModelTierPlan({ shard: compact.shard || {}, policy });
  compact.contextGovernor = {
    schemaVersion: 'clawd.context_governor.v1',
    enabled: true,
    mode: policy.mode,
    hierarchy: {
      plannerContext: 'broad_objective_surface_matrix_wave_factpack',
      reviewerContext: 'patch_proof_failure_only',
      workerContext: 'narrow_single_shard_context_pack',
      workerRole: policy.workerRole
    },
    targetSavingsRange: `${policy.targetSavingsMin}-${policy.targetSavingsMax}x`,
    launchGate: { hardGate: policy.hardGate, maxWorkerTokens: policy.maxWorkerTokens },
    omissions
  };
  compact.contextCache = {
    schemaVersion: 'clawd.context_cache.v1',
    packDigest: sha256Text(JSON.stringify({
      campaign: compact.campaign,
      shard: compact.shard,
      guardrails: compact.guardrails,
      dependencies: compact.dependencies,
      assignmentContract: compact.assignmentContract,
      acceptanceChecks: compact.acceptanceChecks,
      verifiers: compact.verifiers,
      relatedSurfaces: compact.relatedSurfaces,
      learningContext: compact.learningContext,
      inputs: compact.inputs,
      retrievalManifest: compact.retrievalManifest,
      modelTierPlan: compact.modelTierPlan
    })),
    retrievalDigest: sha256Text(JSON.stringify(compact.retrievalManifest || {})),
    promptTemplateKey: `${policy.workerPromptMode}:${policy.workerRole}:${policy.retrievalMode}`,
    cachePolicy: 'dedupe_identical_compact_packs_and_reuse_retrieval_handles; never replay worker transcripts'
  };
  const postGovernorJson = JSON.stringify(compact ?? null);
  const preTokens = approxTokenCount(preGovernorJson);
  const postTokens = approxTokenCount(postGovernorJson);
  compact.contextFootprint = {
    ...(compact.contextFootprint || {}),
    preGovernorApproxTokens: preTokens,
    approxTokens: postTokens,
    postGovernorApproxTokens: postTokens,
    savedApproxTokens: Math.max(0, preTokens - postTokens),
    projectedSavingsRatio: Number((preTokens / Math.max(1, postTokens)).toFixed(2)),
    budgetMaxTokens: policy.maxWorkerTokens,
    budgetOk: postTokens <= policy.maxWorkerTokens,
    omittedContextItemCount: omissions.length + inputHandles.length
  };
  return compact;
}

export function evaluateContextPackBudget(pack, options = {}) {
  const policy = normalizeContextGovernorOptions(options, options);
  const approxTokens = pack?.contextFootprint?.postGovernorApproxTokens || pack?.contextFootprint?.approxTokens || estimateContextTokens(pack);
  return {
    ok: approxTokens <= policy.maxWorkerTokens,
    approxTokens,
    maxWorkerTokens: policy.maxWorkerTokens,
    overByTokens: Math.max(0, approxTokens - policy.maxWorkerTokens),
    shardId: pack?.shard?.id || null,
    mode: policy.mode,
    hardGate: policy.hardGate
  };
}

export function buildContextGovernorReport({ contextPacks = [], options = {}, agentCount = 0, shardCount = 0 } = {}) {
  const policy = normalizeContextGovernorOptions(options, { agentCount, shardCount });
  const packs = contextPacks.map((pack) => ({
    shardId: pack?.shard?.id || null,
    budget: evaluateContextPackBudget(pack, policy),
    footprint: pack?.contextFootprint || { approxTokens: estimateContextTokens(pack) },
    workerRole: pack?.contextGovernor?.hierarchy?.workerRole || null,
    workerModel: pack?.modelTierPlan?.worker?.tier || null,
    promptMode: pack?.modelTierPlan?.worker?.promptMode || null,
    retrievalMode: pack?.retrievalManifest?.mode || null,
    contextCache: pack?.contextCache || null
  }));
  const totalTokens = packs.reduce((sum, entry) => sum + Number(entry.budget.approxTokens || 0), 0);
  const totalPreTokens = packs.reduce((sum, entry) => sum + Number(entry.footprint.preGovernorApproxTokens || entry.budget.approxTokens || 0), 0);
  const perPackOverBudget = packs.filter((entry) => !entry.budget.ok);
  const globalTokenCapExceeded = policy.globalTokenCap != null && totalTokens > policy.globalTokenCap;
  const overBudget = [
    ...perPackOverBudget.map((entry) => entry.budget),
    ...(globalTokenCapExceeded ? [{
      ok: false,
      reason: 'global_token_cap_exceeded',
      approxTokens: totalTokens,
      maxWorkerTokens: policy.maxWorkerTokens,
      globalTokenCap: policy.globalTokenCap,
      shardId: '*'
    }] : [])
  ];
  const savingsRatio = Number((totalPreTokens / Math.max(1, totalTokens)).toFixed(2));
  const uniquePackDigests = new Set(packs.map((entry) => entry.contextCache?.packDigest).filter(Boolean));
  const uniqueRetrievalDigests = new Set(packs.map((entry) => entry.contextCache?.retrievalDigest).filter(Boolean));
  return {
    schemaVersion: 'clawd.context_governor_report.v1',
    generatedAt: new Date().toISOString(),
    enabled: policy.enabled,
    mode: policy.mode,
    ok: overBudget.length === 0,
    hardGate: policy.hardGate,
    globalTokenCap: policy.globalTokenCap,
    globalTokenCapExceeded,
    targetSavingsRange: `${policy.targetSavingsMin}-${policy.targetSavingsMax}x`,
    observedSavingsRatio: savingsRatio,
    targetSavingsReached: savingsRatio >= policy.targetSavingsMin,
    packCount: packs.length,
    agentCount: policy.agentCount || agentCount,
    shardCount: policy.shardCount || shardCount,
    totalApproxTokens: totalTokens,
    totalPreGovernorApproxTokens: totalPreTokens,
    averageApproxTokens: packs.length ? Math.round(totalTokens / packs.length) : 0,
    maxApproxTokens: packs.length ? Math.max(...packs.map((entry) => entry.budget.approxTokens)) : 0,
    budgetFailureCount: overBudget.length,
    budgetFailures: overBudget,
    contextCache: {
      uniquePackDigestCount: uniquePackDigests.size,
      duplicatePackCount: Math.max(0, packs.length - uniquePackDigests.size),
      uniqueRetrievalDigestCount: uniqueRetrievalDigests.size,
      duplicateRetrievalManifestCount: Math.max(0, packs.length - uniqueRetrievalDigests.size),
      policy: 'dedupe identical compact packs/retrieval handles before prompt construction where the execution backend supports cache reuse'
    },
    hierarchy: {
      plannerAgents: '5-10 broad planner/reviewer agents keep objective context',
      workerAgents: 'narrow workers receive single-shard compact packs plus retrieval handles',
      transcriptReplay: 'disabled; future waves consume wave_factpack.json'
    },
    packs
  };
}

export function buildWaveFactPack({ waveNumber = 1, runSummary = {}, patchQueue = createPatchQueue(), workerEvents = [], contextGovernorReport = null, previousWaveFactpack = null } = {}) {
  const rejectedByReason = {};
  for (const patch of patchQueue.rejected || []) {
    const reason = patch.rejectionReason || patch.reason || patch.status || 'rejected';
    rejectedByReason[reason] ||= 0;
    rejectedByReason[reason] += 1;
  }
  const recentFailures = workerEvents
    .filter((event) => /exit|timeout|failed|rejected/i.test(String(event.type || '')) && event.ok !== true)
    .slice(-20)
    .map((event) => ({ type: event.type, shardId: event.shardId || null, agentId: event.agentId || null, reason: event.reason || event.killReason || event.rejectionReason || null }));
  return {
    schemaVersion: 'clawd.wave_factpack.v1',
    generatedAt: new Date().toISOString(),
    waveNumber,
    previousWaveHash: previousWaveFactpack ? sha256Text(JSON.stringify(previousWaveFactpack)) : null,
    summary: {
      agentCount: runSummary.agentCount || null,
      shardCount: runSummary.shardCount || 0,
      mergedShardCount: runSummary.mergedShardCount || 0,
      elapsedMs: runSummary.elapsedMs || 0,
      supervisorStatus: runSummary.supervisorStatus || null,
      thresholdPass: runSummary.thresholdPass ?? null
    },
    mergedShardIds: stableList((patchQueue.merged || []).map((patch) => patch.shardId).filter(Boolean)),
    rejectedShardIds: stableList((patchQueue.rejected || []).map((patch) => patch.shardId).filter(Boolean)),
    rejectedByReason,
    recentFailures,
    contextGovernor: contextGovernorReport ? {
      ok: contextGovernorReport.ok,
      observedSavingsRatio: contextGovernorReport.observedSavingsRatio,
      totalApproxTokens: contextGovernorReport.totalApproxTokens,
      budgetFailureCount: contextGovernorReport.budgetFailureCount
    } : null,
    nextWaveInstructions: [
      'Use this factpack instead of previous worker transcripts.',
      'Carry forward only unresolved shard ids, failure families, and verifier signals.',
      'Do not paste merged worker logs into future worker prompts.'
    ]
  };
}

export function compileContextPack({ contract, shard, shardPlan, surfaceMatrix = { surfaces: [] }, artifactBus = createArtifactBus(), globalInputs = {}, contextGovernorOptions = {}, previousWaveFactpack = null, orchestrationLearning = null }) {
  const dependencyArtifacts = (shard.dependencyShardIds || []).flatMap((dependencyShardId) => findArtifacts(artifactBus, { shardId: dependencyShardId })).map((artifact) => ({
    artifactId: artifact.artifactId,
    type: artifact.type,
    shardId: artifact.shardId,
    filePath: artifact.filePath
  }));
  const inputs = { ...(shard.inputs || {}) };
  for (const ref of shard.inputRefs || []) {
    if (Object.prototype.hasOwnProperty.call(globalInputs, ref)) inputs[ref] = globalInputs[ref];
  }
  const relatedSurfaces = (surfaceMatrix.surfaces || []).filter((surface) => (shard.surfaceIds || []).includes(surface.id)).map((surface) => ({ id: surface.id, label: surface.label }));
  const fullRelatedSurfaces = (surfaceMatrix.surfaces || []).filter((surface) => (shard.surfaceIds || []).includes(surface.id));
  const learningConfig = loadLearningConfig(orchestrationLearning || contract?.orchestrationLearning || globalInputs?.orchestrationLearning || {});
  const learningLedger = learningConfig.enabled
    ? learningConfig.ledger || (learningConfig.ledgerPath ? readLearningLedger(learningConfig.ledgerPath, null) : null)
    : null;
  const learningContext = learningLedger
    ? buildLearningContextForShard({
      ledger: learningLedger,
      shard,
      surface: fullRelatedSurfaces[0] || {},
      limit: learningConfig.limit,
      includeCandidates: learningConfig.includeCandidates
    })
    : null;
  const assignmentContract = normalizeAssignmentContract(shard.metadata?.assignmentContract || {}, {
    artifactKind: 'verification_evidence',
    targetFiles: shard.allowedFiles || [],
    targetModules: shard.fileAreas || [],
    verifierRequirements: shard.requiredVerifiers || [],
    successPredicate: shard.acceptanceChecks || []
  });
  const previousWaveSummary = previousWaveFactpack ? {
    schemaVersion: previousWaveFactpack.schemaVersion || null,
    waveNumber: previousWaveFactpack.waveNumber || null,
    summary: previousWaveFactpack.summary || null,
    rejectedByReason: previousWaveFactpack.rejectedByReason || {},
    recentFailureCount: Array.isArray(previousWaveFactpack.recentFailures) ? previousWaveFactpack.recentFailures.length : 0
  } : null;
  const pack = {
    version: 2,
    generatedAt: new Date().toISOString(),
    campaign: {
      requestedFidelity: contract?.requestedFidelity || null,
      scope: contract?.requestedScope || [],
      targetPath: contract?.targetPath || null
    },
    shard: {
      id: shard.id,
      rootWorkUnitId: shard.rootWorkUnitId,
      title: shard.title,
      goal: shard.goal,
      lane: shard.lane,
      domain: shard.domain,
      surfaceIds: shard.surfaceIds || []
    },
    guardrails: {
      allowedFiles: shard.allowedFiles || [],
      fileAreas: shard.fileAreas || [],
      avoidWholeProjectPromptDump: true
    },
    dependencies: {
      shardIds: shard.dependencyShardIds || [],
      artifacts: dependencyArtifacts,
      previousWaveFactpack: previousWaveSummary
    },
    inputs,
    learningContext,
    assignmentContract,
    acceptanceChecks: shard.acceptanceChecks || [],
    verifiers: shard.requiredVerifiers || [],
    relatedSurfaces,
    contextFootprint: {
      inputKeyCount: Object.keys(inputs).length,
      dependencyArtifactCount: dependencyArtifacts.length,
      approxBytes: JSON.stringify({ inputs, dependencyArtifacts }).length
    }
  };
  return compactContextPack(pack, contextGovernorOptions);
}

export function compileContextPacks({ contract, shardPlan, surfaceMatrix, artifactBus, globalInputs = {}, contextGovernorOptions = {}, previousWaveFactpack = null }) {
  const learningConfig = loadLearningConfig(contract?.orchestrationLearning || globalInputs?.orchestrationLearning || {});
  const orchestrationLearning = learningConfig.enabled
    ? {
      ...learningConfig,
      ledger: learningConfig.ledger || (learningConfig.ledgerPath ? readLearningLedger(learningConfig.ledgerPath, null) : null)
    }
    : learningConfig;
  return shardPlan.shards.map((shard) => compileContextPack({ contract, shard, shardPlan, surfaceMatrix, artifactBus, globalInputs, contextGovernorOptions, previousWaveFactpack, orchestrationLearning }));
}

export function createPatchArtifact(input = {}) {
  if (!input.id && !input.shardId) throw new Error('patch artifact requires id or shardId');
  return {
    id: input.id || `patch-${input.shardId}`,
    shardId: input.shardId || null,
    taskId: input.taskId || input.shardId || null,
    agentId: input.agentId || null,
    filePaths: stableList(input.filePaths || []),
    diffSummary: input.diffSummary || '',
    requiredVerifiers: stableList(input.requiredVerifiers || ['tests']),
    dependencyShardIds: stableList(input.dependencyShardIds || []),
    createdAt: input.createdAt || new Date().toISOString(),
    metadata: input.metadata || {},
    status: input.status || 'queued'
  };
}

export function createPatchQueue() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    queued: [],
    merged: [],
    rejected: [],
    history: []
  };
}

export function enqueuePatch(queue, artifact) {
  const next = clone(queue);
  next.queued.push(createPatchArtifact(artifact));
  next.history.push({ at: new Date().toISOString(), type: 'patch_enqueued', patchId: artifact.id || `patch-${artifact.shardId}` });
  return next;
}

export function detectPatchConflicts(queue, artifact, { leaseState = createLeaseState(), mergedArtifacts = [] } = {}) {
  const patch = createPatchArtifact(artifact);
  const conflicts = [];
  for (const existing of [...(queue?.queued || []), ...mergedArtifacts]) {
    if (existing.id === patch.id) continue;
    const overlappingFiles = patch.filePaths.filter((filePath) => (existing.filePaths || []).some((otherPath) => overlapsArea(filePath, otherPath)));
    if (overlappingFiles.length) conflicts.push({ type: 'patch_collision', patchId: existing.id, filePaths: overlappingFiles });
  }
  for (const lease of activeLeases(leaseState)) {
    if (lease.taskId === patch.taskId) continue;
    const overlappingFiles = patch.filePaths.filter((filePath) => lease.fileAreas.some((area) => overlapsArea(filePath, area)));
    if (overlappingFiles.length) conflicts.push({ type: 'ownership_collision', patchId: patch.id, ownerTaskId: lease.taskId, ownerAgentId: lease.agentId, filePaths: overlappingFiles });
  }
  return conflicts;
}

export async function processPatchQueue(queue, { leaseState = createLeaseState(), verifyFns = {}, completedShardIds = [], allowProductOnlyVerifierSkip = false, proofCarryingClaims = false, claimLedgerPolicy = {}, adversarialClaimVerifiers = {}, canonicalLandingEvidence = false, landingEvidenceBaseline = null, landingEvidencePolicy = {}, promotePatch = null } = {}) {
  const next = clone(queue);
  const decisions = [];
  const pending = [];
  const mergedShardIds = new Set([...(completedShardIds || []), ...next.merged.map((artifact) => artifact.shardId)]);
  const claimLedgerMode = claimLedgerPolicy?.mode || (proofCarryingClaims ? 'block_on_failed_claim' : 'off');
  const claimLedgerEnabled = claimLedgerMode !== 'off';
  const claimLedgerBlocksMerge = claimLedgerMode === 'block_on_failed_claim' || claimLedgerMode === 'require_adversarial_survival';
  const landingEvidenceMode = landingEvidencePolicy?.mode || (canonicalLandingEvidence ? 'block_on_failed_landing' : 'off');
  const landingEvidenceEnabled = landingEvidenceMode !== 'off';
  const landingEvidenceBlocksMerge = landingEvidenceMode === 'block_on_failed_landing' || landingEvidenceMode === 'require_canonical_landing';
  const landingPolicy = { ...landingEvidencePolicy, mode: landingEvidenceMode };

  for (const entry of next.queued) {
    const patch = createPatchArtifact(entry);
    const unmetDependencies = patch.dependencyShardIds.filter((dependencyShardId) => !mergedShardIds.has(dependencyShardId));
    if (unmetDependencies.length) {
      patch.status = 'waiting_dependencies';
      pending.push(patch);
      decisions.push({ patchId: patch.id, status: patch.status, unmetDependencies });
      continue;
    }

    const conflicts = detectPatchConflicts({ queued: pending, merged: next.merged, rejected: next.rejected }, patch, { leaseState, mergedArtifacts: [] });
    if (conflicts.length) {
      patch.status = 'waiting_conflicts';
      pending.push(patch);
      decisions.push({ patchId: patch.id, status: patch.status, conflicts });
      continue;
    }

    const verifierResults = [];
    let verifierFailed = false;
    for (const verifierName of patch.requiredVerifiers) {
      const verifier = verifyFns[verifierName] || (async () => ({ ok: true, verifier: verifierName }));
      const result = await verifier(patch);
      verifierResults.push({ verifier: verifierName, ...result });
      if (result.ok === false) {
        verifierFailed = true;
        patch.status = 'rejected';
        next.rejected.push({ ...patch, rejectedAt: new Date().toISOString(), verifierResults });
        decisions.push({ patchId: patch.id, status: 'rejected', verifierResults });
        break;
      }
    }
    if (verifierFailed) continue;

    const admission = evaluatePatchAdmission(patch, verifierResults, { allowProductOnlyVerifierSkip });
    if (!admission.ok) {
      patch.status = 'rejected';
      patch.rejectionCategory = admission.category;
      patch.rejectionReason = admission.reason;
      patch.admissionAudit = admission.details;
      next.rejected.push({ ...patch, rejectedAt: new Date().toISOString(), verifierResults });
      decisions.push({ patchId: patch.id, status: 'rejected', verifierResults, rejectionCategory: admission.category, rejectionReason: admission.reason });
      continue;
    }

    let workspacePromotionRecord = null;
    if (typeof promotePatch === 'function') {
      workspacePromotionRecord = await promotePatch(patch);
      patch.workspacePromotionRecord = workspacePromotionRecord;
      if (workspacePromotionRecord?.ok === false) {
        patch.status = 'rejected';
        patch.rejectionCategory = 'workspace_promotion';
        patch.rejectionReason = workspacePromotionRecord.failures?.[0]?.reason || workspacePromotionRecord.reason || 'worker_workspace_promotion_failed';
        patch.admissionAudit = admission.details;
        next.rejected.push({ ...patch, rejectedAt: new Date().toISOString(), verifierResults });
        decisions.push({ patchId: patch.id, status: 'rejected', verifierResults, rejectionCategory: patch.rejectionCategory, rejectionReason: patch.rejectionReason, workspacePromotionRecord });
        continue;
      }
    }

    const productDiffPatch = admission.details?.assignmentContract?.artifactKind === 'product_diff'
      || patch.metadata?.assignmentContract?.artifactKind === 'product_diff';
    let canonicalLandingRecord = null;
    if (landingEvidenceEnabled && productDiffPatch) {
      canonicalLandingRecord = evaluatePatchLandingEvidence(patch, {
        repoPath: landingPolicy.repoPath,
        baseline: landingEvidenceBaseline,
        policy: landingPolicy
      });
      patch.canonicalLandingRecord = canonicalLandingRecord;
      if (!canonicalLandingRecord.eligible && landingEvidenceBlocksMerge) {
        patch.status = 'rejected';
        patch.rejectionCategory = canonicalLandingRecord.rejectionCategory;
        patch.rejectionReason = canonicalLandingRecord.rejectionReason;
        patch.admissionAudit = { ...admission.details, canonicalLandingRecord };
        next.rejected.push({ ...patch, rejectedAt: new Date().toISOString(), verifierResults });
        decisions.push({
          patchId: patch.id,
          status: 'rejected',
          verifierResults,
          rejectionCategory: canonicalLandingRecord.rejectionCategory,
          rejectionReason: canonicalLandingRecord.rejectionReason,
          canonicalLandingRecord,
          ...(workspacePromotionRecord ? { workspacePromotionRecord } : {})
        });
        continue;
      }
    }

    const claimRequired = claimLedgerEnabled && Boolean(proofCarryingClaims || patch.metadata?.proofCarryingClaim || patch.metadata?.claimLedgerClaim);
    let proofCarryingClaim = null;
    if (claimRequired) {
      proofCarryingClaim = await evaluateProofCarryingPatchClaim(patch, {
        verifierResults,
        admission,
        policy: claimLedgerPolicy,
        adversarialVerifiers: adversarialClaimVerifiers
      });
      patch.proofCarryingClaimRecord = proofCarryingClaim.record;
      if (!proofCarryingClaim.survived && claimLedgerBlocksMerge) {
        patch.status = 'rejected';
        patch.rejectionCategory = proofCarryingClaim.rejectionCategory;
        patch.rejectionReason = proofCarryingClaim.rejectionReason;
        patch.admissionAudit = admission.details;
        next.rejected.push({ ...patch, rejectedAt: new Date().toISOString(), verifierResults });
        decisions.push({
          patchId: patch.id,
          status: 'rejected',
          verifierResults,
          rejectionCategory: proofCarryingClaim.rejectionCategory,
          rejectionReason: proofCarryingClaim.rejectionReason,
          claimLedgerRecord: proofCarryingClaim.record,
          ...(workspacePromotionRecord ? { workspacePromotionRecord } : {})
        });
        continue;
      }
    }

    patch.status = 'merged';
    patch.verifierResults = verifierResults;
    patch.admissionAudit = canonicalLandingRecord ? { ...admission.details, canonicalLandingRecord } : admission.details;
    if (canonicalLandingRecord) patch.canonicalLandingRecord = canonicalLandingRecord;
    if (workspacePromotionRecord) patch.workspacePromotionRecord = workspacePromotionRecord;
    if (canonicalLandingRecord && !canonicalLandingRecord.eligible) patch.canonicalLandingAuditOnly = true;
    if (proofCarryingClaim) patch.proofCarryingClaimRecord = proofCarryingClaim.record;
    if (proofCarryingClaim && !proofCarryingClaim.survived) patch.claimLedgerAuditOnly = true;
    patch.mergedAt = new Date().toISOString();
    next.merged.push(patch);
    mergedShardIds.add(patch.shardId);
    decisions.push({ patchId: patch.id, status: 'merged', verifierResults, ...(canonicalLandingRecord ? { canonicalLandingRecord } : {}), ...(proofCarryingClaim ? { claimLedgerRecord: proofCarryingClaim.record } : {}) });
  }

  next.queued = pending;
  const hasClaimLedgerRecords = [...next.merged, ...next.rejected].some((patch) => patch.proofCarryingClaimRecord || patch.claimLedgerRecord);
  if (landingEvidenceEnabled) next.landingEvidence = buildSelectedRunLandingEvidence({ repoPath: landingPolicy.repoPath, baseline: landingEvidenceBaseline, patchQueue: next, policy: landingPolicy });
  if (claimLedgerEnabled || hasClaimLedgerRecords) next.claimLedger = buildProofCarryingClaimLedger({ patchQueue: next });
  next.history.push({ at: new Date().toISOString(), type: 'patch_queue_processed', decisions, ...(next.landingEvidence ? { landingEvidenceSummary: next.landingEvidence.summary } : {}), ...(next.claimLedger ? { claimLedgerSummary: next.claimLedger.summary } : {}) });
  return { queue: next, decisions, claimLedger: next.claimLedger || null, landingEvidence: next.landingEvidence || null };
}

function deriveShardStatuses({ shardPlan, leaseState, patchQueue, blockers = [], now = Date.now() }) {
  const mergedShardIds = new Set((patchQueue?.merged || []).map((artifact) => artifact.shardId));
  const unresolvedRejected = (patchQueue?.rejected || []).filter((artifact) => artifact?.shardId && !mergedShardIds.has(artifact.shardId));
  const blockedShardIds = new Set([
    ...blockers.map((entry) => entry.shardId).filter(Boolean),
    ...unresolvedRejected.map((artifact) => artifact.shardId).filter(Boolean)
  ]);
  const activeTaskIds = new Set(activeLeases(leaseState, now).map((lease) => lease.taskId));
  const statuses = {};
  for (const shard of shardPlan.shards) {
    if (mergedShardIds.has(shard.id)) statuses[shard.id] = 'complete';
    else if (blockedShardIds.has(shard.id)) statuses[shard.id] = 'blocked';
    else if (activeTaskIds.has(shard.id)) statuses[shard.id] = 'in_progress';
    else if ((shard.dependencyShardIds || []).every((dependencyShardId) => mergedShardIds.has(dependencyShardId))) statuses[shard.id] = 'ready';
    else statuses[shard.id] = 'pending';
  }
  return statuses;
}

function aggregateSupervision(shards, statuses, key) {
  const groups = {};
  for (const shard of shards) {
    const groupKey = shard[key];
    groups[groupKey] ||= { id: groupKey, total: 0, ready: 0, pending: 0, in_progress: 0, complete: 0, blocked: 0, shardIds: [] };
    groups[groupKey].total += 1;
    groups[groupKey][statuses[shard.id]] += 1;
    groups[groupKey].shardIds.push(shard.id);
  }
  return Object.values(groups).map((group) => ({
    ...group,
    status: group.complete === group.total ? 'green' : group.blocked > 0 ? 'red' : group.in_progress > 0 || group.ready > 0 ? 'amber' : 'red'
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function shardHealth(status) {
  if (status === 'complete') return 'green';
  if (status === 'blocked') return 'red';
  return 'amber';
}

export function compileSupervisorSnapshot({ shardPlan, leaseState = createLeaseState(), patchQueue = createPatchQueue(), artifactBus = createArtifactBus(), blockers = [], now = Date.now(), landingEvidence = null, schedulerTruth = null, claimLedger = null }) {
  const shardStatuses = deriveShardStatuses({ shardPlan, leaseState, patchQueue, blockers, now });
  const lanes = aggregateSupervision(shardPlan.shards, shardStatuses, 'lane');
  const domains = aggregateSupervision(shardPlan.shards, shardStatuses, 'domain');
  const staleLeases = detectStaleLeases(leaseState, { now });
  const mergedShardIds = new Set((patchQueue?.merged || []).map((artifact) => artifact.shardId));
  const unresolvedRejected = (patchQueue?.rejected || []).filter((artifact) => artifact?.shardId && !mergedShardIds.has(artifact.shardId));
  const escalations = [
    ...blockers,
    ...staleLeases.map((lease) => ({ type: 'stale_lease', shardId: lease.taskId, leaseId: lease.leaseId, agentId: lease.agentId })),
    ...unresolvedRejected.map((artifact) => ({ type: 'rejected_patch', shardId: artifact.shardId, patchId: artifact.id }))
  ];
  const counts = Object.values(shardStatuses).reduce((summary, status) => {
    summary[status] += 1;
    return summary;
  }, { ready: 0, pending: 0, in_progress: 0, complete: 0, blocked: 0 });
  const shards = shardPlan.shards.map((shard) => ({
    id: shard.id,
    rootWorkUnitId: shard.rootWorkUnitId,
    lane: shard.lane,
    domain: shard.domain,
    status: shardHealth(shardStatuses[shard.id]),
    state: shardStatuses[shard.id],
    dependencyShardIds: [...(shard.dependencyShardIds || [])],
  }));
  const topLevelStatus = counts.complete === shardPlan.shards.length && escalations.length === 0 && counts.blocked === 0
    ? 'green'
    : escalations.length > 0 || counts.blocked > 0
      ? 'red'
      : 'amber';

  return {
    generatedAt: new Date().toISOString(),
    topLevel: {
      status: topLevelStatus,
      counts,
      shardCount: shardPlan.shards.length,
      escalationCount: escalations.length
    },
    lanes,
    domains,
    shards,
    shardStatuses,
    escalations,
    escalationCount: escalations.length,
    artifactBusSummary: summarizeArtifactBus(artifactBus),
    landingEvidence: landingEvidence || patchQueue?.landingEvidence || null,
    schedulerTruth: schedulerTruth || null,
    claimLedger: claimLedger || buildProofCarryingClaimLedger({ patchQueue })
  };
}

export async function runScaleSimulation({
  workGraph,
  surfaceMatrix,
  agentCount,
  maxTicks = 200,
  tickMs = 1000,
  leaseTtlMs = 3 * 1000,
  buildVerifierMap,
  plannerOptions = {}
}) {
  const shardPlan = buildShardPlan({ workGraph, surfaceMatrix, options: plannerOptions });
  const agents = Array.from({ length: agentCount }, (_, index) => `agent-${index + 1}`);
  let leaseState = createLeaseState({ defaultTtlMs: leaseTtlMs });
  let artifactBus = createArtifactBus();
  let patchQueue = createPatchQueue();
  const runtime = Object.fromEntries(shardPlan.shards.map((shard) => [shard.id, {
    remainingSteps: shard.effortSteps,
    stallAttempts: shard.stallAttempts,
    stallAppliedAttempts: [],
    stalledLeaseIds: [],
    merged: false,
    lastLeaseId: null
  }]));
  const assignments = {};
  const verifyFns = buildVerifierMap ? buildVerifierMap({ shardPlan }) : {
    tests: async () => ({ ok: true }),
    lint: async () => ({ ok: true }),
    smoke: async () => ({ ok: true })
  };
  const metrics = {
    conflictsPrevented: 0,
    staleLeaseCount: 0,
    recoveryCount: 0,
    mergedPatchCount: 0,
    shardOutputCount: 0
  };

  function mergedShardIds() {
    return new Set(patchQueue.merged.map((artifact) => artifact.shardId));
  }

  for (let tick = 0; tick < maxTicks; tick += 1) {
    const now = tick * tickMs;
    const staleLeases = detectStaleLeases(leaseState, { now });
    if (staleLeases.length) {
      metrics.staleLeaseCount += staleLeases.length;
      const idleAgents = agents.filter((agentId) => !assignments[agentId]);
      const recovery = recoverStaleLeases(leaseState, { now, agentIds: idleAgents.length ? idleAgents : agents });
      leaseState = recovery.state;
      metrics.recoveryCount += recovery.recoveryActions.length;
      for (const action of recovery.recoveryActions) {
        artifactBus = recordArtifactEvent(artifactBus, { type: 'lease_recovered', taskId: action.taskId, shardId: action.taskId, previousAgentId: action.previousAgentId, nextAgentId: action.nextAgentId });
        for (const [agentId, assignment] of Object.entries(assignments)) {
          if (assignment.shardId === action.taskId) delete assignments[agentId];
        }
        const recoveredLease = leaseState.tasks[action.taskId];
        assignments[action.nextAgentId] = { shardId: action.taskId, leaseId: recoveredLease.leaseId };
      }
    }

    const merged = mergedShardIds();
    const activeShardIds = new Set(Object.values(assignments).map((assignment) => assignment.shardId));
    const readyShards = shardPlan.shards
      .filter((shard) => !merged.has(shard.id) && !activeShardIds.has(shard.id) && (shard.dependencyShardIds || []).every((dependencyShardId) => merged.has(dependencyShardId)))
      .sort((left, right) => left.id.localeCompare(right.id));

    for (const agentId of agents) {
      if (assignments[agentId]) continue;
      const candidateIndex = readyShards.findIndex((candidate) => {
        const conflicts = detectOwnershipConflicts(leaseState, { taskId: candidate.id, agentId, fileAreas: candidate.fileAreas }, now);
        if (conflicts.length) metrics.conflictsPrevented += conflicts.length;
        return conflicts.length === 0;
      });
      if (candidateIndex < 0) continue;
      const shard = readyShards.splice(candidateIndex, 1)[0];
      const acquisition = acquireLease(leaseState, { taskId: shard.id, agentId, fileAreas: shard.fileAreas, ttlMs: leaseTtlMs }, now);
      leaseState = acquisition.state;
      if (!acquisition.ok) {
        metrics.conflictsPrevented += acquisition.conflicts.length;
        continue;
      }
      runtime[shard.id].lastLeaseId = acquisition.lease.leaseId;
      assignments[agentId] = { shardId: shard.id, leaseId: acquisition.lease.leaseId };
      artifactBus = recordArtifactEvent(artifactBus, { type: 'lease_claimed', taskId: shard.id, shardId: shard.id, agentId });
    }

    for (const [agentId, assignment] of Object.entries({ ...assignments })) {
      const shard = shardPlan.shards.find((entry) => entry.id === assignment.shardId);
      const taskLease = leaseState.tasks[assignment.shardId];
      if (!taskLease || taskLease.leaseId !== assignment.leaseId) continue;
      const runtimeEntry = runtime[assignment.shardId];
      if (runtimeEntry.stallAttempts.includes(taskLease.attempt) && !runtimeEntry.stallAppliedAttempts.includes(taskLease.attempt)) {
        runtimeEntry.stallAppliedAttempts.push(taskLease.attempt);
        runtimeEntry.stalledLeaseIds.push(taskLease.leaseId);
        artifactBus = recordArtifactEvent(artifactBus, { type: 'worker_stalled', taskId: shard.id, shardId: shard.id, agentId, attempt: taskLease.attempt });
        continue;
      }
      if (runtimeEntry.stalledLeaseIds.includes(taskLease.leaseId)) continue;

      runtimeEntry.remainingSteps -= 1;
      if (runtimeEntry.remainingSteps > 0) continue;

      const publishResult = publishArtifact(artifactBus, {
        type: 'shard_output',
        shardId: shard.id,
        taskId: shard.id,
        producer: agentId,
        filePath: `artifacts/${shard.id}.json`,
        metadata: { lane: shard.lane, domain: shard.domain }
      });
      artifactBus = publishResult.bus;
      metrics.shardOutputCount += 1;
      const released = releaseLease(leaseState, { leaseId: taskLease.leaseId, agentId, reason: 'completed' }, now);
      leaseState = released.state;
      delete assignments[agentId];
      patchQueue = enqueuePatch(patchQueue, createPatchArtifact({
        shardId: shard.id,
        taskId: shard.id,
        agentId,
        filePaths: shard.allowedFiles.length ? shard.allowedFiles : shard.fileAreas,
        diffSummary: `${shard.title} patch`,
        requiredVerifiers: shard.requiredVerifiers,
        dependencyShardIds: shard.dependencyShardIds,
        metadata: {
          assignmentContract: shard.metadata?.assignmentContract || null
        }
      }));
    }

    const queueResult = await processPatchQueue(patchQueue, { leaseState, verifyFns, completedShardIds: [...merged] });
    patchQueue = queueResult.queue;
    for (const decision of queueResult.decisions.filter((entry) => entry.status === 'merged')) {
      metrics.mergedPatchCount += 1;
      const patch = patchQueue.merged.find((entry) => entry.id === decision.patchId);
      if (patch) {
        artifactBus = publishArtifact(artifactBus, {
          type: 'patch_merged',
          shardId: patch.shardId,
          taskId: patch.taskId,
          producer: patch.agentId,
          filePath: `merge/${patch.id}.json`
        }).bus;
      }
    }

    if (patchQueue.merged.length === shardPlan.shards.length) break;
  }

  const supervisor = compileSupervisorSnapshot({ shardPlan, leaseState, patchQueue, artifactBus, now: maxTicks * tickMs });
  const continuityFailures = shardPlan.shards.filter((shard) => {
    const outputs = findArtifacts(artifactBus, { shardId: shard.id }).filter((artifact) => artifact.type === 'shard_output');
    const merges = findArtifacts(artifactBus, { shardId: shard.id }).filter((artifact) => artifact.type === 'patch_merged');
    return outputs.length === 0 || merges.length === 0;
  }).map((shard) => shard.id);

  return {
    ok: patchQueue.merged.length === shardPlan.shards.length && supervisor.topLevel.status === 'green' && continuityFailures.length === 0,
    agentCount,
    shardCount: shardPlan.shards.length,
    mergedShardCount: patchQueue.merged.length,
    supervisor,
    metrics: {
      ...metrics,
      stateLossEvents: continuityFailures.length,
      continuityFailures
    },
    shardPlan,
    leaseState,
    artifactBus,
    patchQueue
  };
}

export async function qualifyScaleTiers({ tiers = [4, 8, 16, 32], workGraph, surfaceMatrix, options = {} }) {
  const results = [];
  for (const tier of tiers) {
    const simulation = await runScaleSimulation({ workGraph, surfaceMatrix, agentCount: tier, ...options });
    results.push({
      tier,
      ok: simulation.ok,
      shardCount: simulation.shardCount,
      mergedShardCount: simulation.mergedShardCount,
      supervisorStatus: simulation.supervisor.topLevel.status,
      recoveryCount: simulation.metrics.recoveryCount,
      staleLeaseCount: simulation.metrics.staleLeaseCount,
      stateLossEvents: simulation.metrics.stateLossEvents,
      simulation
    });
    if (!simulation.ok) break;
  }

  const passing = results.filter((entry) => entry.ok).map((entry) => entry.tier);
  return {
    generatedAt: new Date().toISOString(),
    tiers: results.map((entry) => ({
      tier: entry.tier,
      ok: entry.ok,
      shardCount: entry.shardCount,
      mergedShardCount: entry.mergedShardCount,
      supervisorStatus: entry.supervisorStatus,
      recoveryCount: entry.recoveryCount,
      staleLeaseCount: entry.staleLeaseCount,
      stateLossEvents: entry.stateLossEvents
    })),
    highestPassingTier: passing.length ? Math.max(...passing) : null,
    allRequestedTiersPassed: results.every((entry) => entry.ok),
    rawResults: results
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function collectRecordedVerifierResult(resultPath, verifierName) {
  const result = loadJson(resultPath, null);
  const recorded = result?.verifierResults?.find((entry) => entry.verifier === verifierName);
  if (!recorded) return { ok: false, verifier: verifierName, error: 'verifier_result_missing', resultPath };
  return {
    ok: recorded.ok !== false,
    verifier: verifierName,
    command: recorded.command || null,
    durationMs: recorded.durationMs || 0,
    stdout: recorded.stdout || '',
    stderr: recorded.stderr || '',
    metadata: recorded.metadata || null,
    parsedOutputSummary: recorded.parsedOutputSummary || recorded.metadata?.parsedOutputSummary || null,
    skipped: recorded.skipped === true,
    reason: recorded.reason || null,
    resultPath
  };
}

export function createRecordedVerifierMap() {
  return {
    tests: async (patch) => collectRecordedVerifierResult(patch.metadata?.resultPath, 'tests'),
    lint: async (patch) => collectRecordedVerifierResult(patch.metadata?.resultPath, 'lint'),
    imports: async (patch) => collectRecordedVerifierResult(patch.metadata?.resultPath, 'imports'),
    smoke: async (patch) => collectRecordedVerifierResult(patch.metadata?.resultPath, 'smoke')
  };
}


function patchRequiresArchitectureAdmission(patch = {}, assignmentContract = {}) {
  const metadata = patch.metadata || {};
  const contextPack = metadata.contextPack || {};
  const inputs = contextPack.inputs || {};
  const shardMetadata = contextPack.shard?.metadata || {};
  const implementationMetadata = metadata.implementation?.metadata || {};
  const predicates = Array.isArray(assignmentContract.successPredicate) ? assignmentContract.successPredicate : [];
  const shardId = String(patch.shardId || patch.taskId || patch.id || contextPack.shard?.id || '').toLowerCase();
  const productDiffMode = metadata.productDiffMode
    || implementationMetadata.productDiffMode
    || inputs.productDiffMode
    || shardMetadata.productDiffMode
    || null;
  return metadata.semanticDirector === true
    || metadata.architectureFrontier === true
    || metadata.semanticProductAdmissionRequired === true
    || implementationMetadata.semanticProductAdmissionRequired === true
    || inputs.semanticProductAdmission?.required === true
    || shardMetadata.semanticDirector === true
    || shardMetadata.architectureFrontier === true
    || shardMetadata.semanticProductAdmissionRequired === true
    || productDiffMode === 'semantic_product_architecture'
    || shardId.includes('::semantic-frontier-')
    || predicates.some((predicate) => /semantic\s+(?:product\s+)?architecture|architecture\s+frontier|primary[- ]runtime\s+architecture|source[- ]of[- ]truth/i.test(String(predicate || '')));
}

function implementationPayload(patch = {}) {
  return patch.metadata?.implementation || patch.implementation || {};
}

function implementationMetadata(patch = {}) {
  return implementationPayload(patch).metadata || {};
}

function patchResultFilePaths(patch = {}) {
  const implementation = implementationPayload(patch);
  const metadata = patch.metadata || {};
  const implementationMeta = implementation.metadata || {};
  return stableList([
    ...(implementation.modifiedFiles || []),
    ...(metadata.modifiedFiles || []),
    ...(metadata.result?.modifiedFiles || []),
    ...(implementationMeta.modifiedFiles || []),
    implementationMeta.modifiedFile,
    metadata.modifiedFile
  ]);
}

function patchDeclaredFilePaths(patch = {}) {
  return stableList(patch.filePaths || []);
}

function semanticProductTargets(assignmentContract = {}) {
  return stableList([...(assignmentContract.targetFiles || []), ...(assignmentContract.targetModules || [])]);
}

function implementationDiffText(patch = {}) {
  const implementation = implementationPayload(patch);
  const metadata = patch.metadata || {};
  const candidates = [
    implementation.diff,
    implementation.unifiedDiff,
    implementation.patch,
    metadata.implementationDiff,
    metadata.unifiedDiff,
    metadata.diff,
    patch.diff,
    patch.unifiedDiff
  ];
  return candidates.map((entry) => String(entry || '').trim()).find(Boolean) || '';
}

function isProductRuntimePath(filePath = '') {
  const rel = String(filePath || '').replace(/^\.\//, '');
  const godotProduct = (
    rel === 'project.godot'
    || /^(?:scripts|scenes|ui|assets|autoload|addons|tools\/editor|tools\/qa)\//.test(rel)
  )
    && /\.(?:gd|tscn|tres|res|cfg|json|import|shader|material|godot)$/i.test(rel)
    && !/(^|\/)(?:docs?|tests?|__tests__|artifacts?|benchmarks?|fixtures?|mocks?)\//i.test(rel);
  if (godotProduct) return true;
  if (!/\.(?:mjs|js|jsx|ts|tsx|css|json|vue|svelte)$/i.test(rel)) return false;
  if (/(^|\/)(?:docs?|tests?|__tests__|test|spec|scripts?|artifacts?|benchmarks?|fixtures?|mocks?)\//i.test(rel)) return false;
  if (/(?:^|\/)[^/]+\.(?:test|spec|fixture|mock)\.(?:mjs|js|jsx|ts|tsx)$/i.test(rel)) return false;
  return true;
}

function extractAddedDiffLines(diffText = '') {
  const lines = String(diffText || '').split('\n');
  const unifiedAdded = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++'));
  const sourceLines = unifiedAdded.length ? unifiedAdded.map((line) => line.slice(1)) : lines;
  return sourceLines.map((line) => line.trim()).filter(Boolean);
}

function sourceSyntaxOnlyLine(line = '') {
  const value = String(line || '').trim();
  if (!value) return true;
  if (/^(?:\/\/|\/\*|\*|\*\/)/.test(value)) return true;
  if (/^(?:import\b|export\s+(?:type\b|interface\b|\{|\*\s+from\b)|export\s+\{[^}]*\}\s+from\b)/.test(value)) return true;
  if (/^(?:type|interface|declare)\b/.test(value)) return true;
  if (/^[{}()[\],;:]+$/.test(value)) return true;
  if (/^['"`][^'"`]*['"`]\s*;?$/.test(value)) return true;
  if (/^['"]?[a-zA-Z0-9_$-]+['"]?\s*:\s*(?:['"`][^'"`]*['"`]|\d+(?:\.\d+)?|true|false|null)\s*,?$/.test(value)) return true;
  if (/^(?:export\s+)?const\s+[a-zA-Z_$][\w$]*\s*=\s*(?:Object\.freeze\s*\(|\{\s*\}?|\[\s*\]?|['"`][^'"`]*['"`]|\d+(?:\.\d+)?|true|false|null)\s*[),;]*$/.test(value)) return true;
  return false;
}

function markerOnlyDiffLine(line = '') {
  const value = String(line || '').trim();
  return sourceSyntaxOnlyLine(value)
    || /transferBenchmarkEvidence|deterministic_product_diff_transfer_benchmark|semantic_product_architecture_transfer_benchmark|markerOnlyProductDelta|claimIntegrityKind/i.test(value)
    || /^Object\.freeze\s*\(/.test(value);
}

function classifyImplementationDiff(diffText = '') {
  const addedLines = extractAddedDiffLines(diffText);
  const meaningfulLines = addedLines.filter((line) => !sourceSyntaxOnlyLine(line) || /transferBenchmarkEvidence|markerOnlyProductDelta|claimIntegrityKind/i.test(line));
  const markerTokenPresent = addedLines.some((line) => /transferBenchmarkEvidence|deterministic_product_diff_transfer_benchmark|semantic_product_architecture_transfer_benchmark|markerOnlyProductDelta|claimIntegrityKind/i.test(line));
  const markerOnly = markerTokenPresent && addedLines.length > 0 && addedLines.every((line) => markerOnlyDiffLine(line));
  const sourceSyntaxOnly = addedLines.length > 0 && addedLines.every((line) => sourceSyntaxOnlyLine(line));
  return {
    addedLineCount: addedLines.length,
    meaningfulLineCount: meaningfulLines.length,
    markerOnly,
    sourceSyntaxOnly,
    sampleAddedLines: addedLines.slice(0, 12)
  };
}

function genericSemanticShimRejectionRequired(patch = {}) {
  const metadata = patch.metadata || {};
  const implementationMeta = implementationMetadata(patch);
  const contextInputs = metadata.contextPack?.inputs || {};
  const shardMetadata = metadata.contextPack?.shard?.metadata || {};
  const semanticAdmission = contextInputs.semanticProductAdmission || {};
  return semanticAdmission.rejectGenericSemanticShim === true
    || semanticAdmission.rejectGenericSemanticShims === true
    || contextInputs.rejectGenericSemanticShim === true
    || shardMetadata.rejectGenericSemanticShim === true
    || metadata.rejectGenericSemanticShim === true
    || implementationMeta.rejectGenericSemanticShim === true;
}

function auditGenericSemanticShimDiff(diffText = '') {
  const addedLines = extractAddedDiffLines(diffText);
  const source = addedLines.join('\n');
  const countMatches = (pattern) => {
    const matches = source.match(pattern);
    return matches ? matches.length : 0;
  };
  const patternCounts = {
    semanticProductArchitectureRuntime: countMatches(/semanticProductArchitectureRuntime_/g),
    semanticProductArchitectureFixtureState: countMatches(/semanticProductArchitectureFixtureState_/g),
    semanticProductArchitectureFixtureRouter: countMatches(/semanticProductArchitectureFixtureRouter_/g),
    semanticProductArchitectureExistingProductArgs: countMatches(/semanticProductArchitectureExistingProductArgs_/g),
    semanticProductArchitectureIntegratedCall: countMatches(/semanticProductArchitectureIntegratedCall_/g),
    semanticProductArchitectureNormalFlow: countMatches(/semanticProductArchitectureNormalFlow_/g),
    normalFlowProofGlobal: countMatches(/__semanticProductArchitectureNormalFlowProofs/g),
    inMemorySemanticBenchmark: countMatches(/in_memory_semantic_benchmark/g),
    benchmarkFixtureText: countMatches(/Semantic benchmark workspace|Benchmark Audience|Benchmark Campaign|Benchmark Site|semantic_runtime_verifier/g)
  };
  const genericLineCount = addedLines.filter((line) => /semanticProductArchitecture(?:Runtime|FixtureState|FixtureRouter|ExistingProductArgs|IntegratedCall|NormalFlow)_|__semanticProductArchitectureNormalFlowProofs|in_memory_semantic_benchmark|Semantic benchmark workspace|Benchmark Audience|Benchmark Campaign|Benchmark Site|semantic_runtime_verifier/.test(line)).length;
  const genericLineRatio = addedLines.length > 0 ? Number((genericLineCount / addedLines.length).toFixed(4)) : 0;
  const generatedRuntimeShimPresent = patternCounts.semanticProductArchitectureRuntime > 0
    && patternCounts.semanticProductArchitectureIntegratedCall > 0
    && patternCounts.semanticProductArchitectureNormalFlow > 0;
  const generatedFixturePresent = patternCounts.semanticProductArchitectureFixtureState > 0
    || patternCounts.semanticProductArchitectureFixtureRouter > 0
    || patternCounts.inMemorySemanticBenchmark > 0
    || patternCounts.benchmarkFixtureText > 0;
  const genericShimSuspect = addedLines.length >= 40
    && generatedRuntimeShimPresent
    && generatedFixturePresent
    && genericLineRatio >= 0.08;
  return {
    addedLineCount: addedLines.length,
    genericLineCount,
    genericLineRatio,
    patternCounts,
    generatedRuntimeShimPresent,
    generatedFixturePresent,
    genericShimSuspect,
    sampleGenericLines: addedLines.filter((line) => /semanticProductArchitecture|in_memory_semantic_benchmark|Semantic benchmark|Benchmark Audience|Benchmark Campaign/.test(line)).slice(0, 12)
  };
}

function evaluateSemanticProductAdmission(patch = {}, assignmentContract = {}) {
  const required = patchRequiresArchitectureAdmission(patch, assignmentContract);
  if (!required) return { ok: true, required: false };

  const implementation = implementationPayload(patch);
  const implementationMeta = implementationMetadata(patch);
  const architectureEvidence = implementationMeta.architectureEvidence || patch.metadata?.architectureEvidence || null;
  const patchFilePaths = patchDeclaredFilePaths(patch);
  const resultFilePaths = patchResultFilePaths(patch);
  const modifiedFiles = stableList([...patchFilePaths, ...resultFilePaths]);
  const targets = semanticProductTargets(assignmentContract);
  const productFiles = modifiedFiles.filter((filePath) => isProductRuntimePath(filePath));
  const touchedTargetFiles = targets.length === 0
    ? modifiedFiles
    : modifiedFiles.filter((filePath) => targets.some((targetPath) => overlapsArea(filePath, targetPath)));
  const touchedProductTargetFiles = touchedTargetFiles.filter((filePath) => isProductRuntimePath(filePath));
  const pathDetails = { assignmentContract, patchFilePaths, resultFilePaths, modifiedFiles, targets, productFiles, touchedTargetFiles, touchedProductTargetFiles };

  if (assignmentContract.artifactKind !== 'product_diff') {
    return { ok: false, required: true, category: 'architecture_quality', reason: 'semantic_product_requires_product_diff_artifact', details: pathDetails };
  }
  if (modifiedFiles.length === 0) {
    return { ok: false, required: true, category: 'no_op', reason: 'zero_semantic_product_files', details: pathDetails };
  }
  if (patchFilePaths.length > 0 && resultFilePaths.length > 0 && !resultFilePaths.some((resultPath) => patchFilePaths.some((patchPath) => overlapsArea(resultPath, patchPath)))) {
    return { ok: false, required: true, category: 'planner_failure', reason: 'patch_result_file_mismatch', details: pathDetails };
  }
  if (productFiles.length === 0) {
    return { ok: false, required: true, category: 'no_op', reason: 'docs_tests_scripts_only_product_claim', details: pathDetails };
  }
  if (touchedTargetFiles.length === 0) {
    return { ok: false, required: true, category: 'planner_failure', reason: 'semantic_product_out_of_scope', details: pathDetails };
  }
  if (touchedProductTargetFiles.length === 0) {
    return { ok: false, required: true, category: 'no_op', reason: 'no_product_runtime_target_delta', details: pathDetails };
  }

  const diffText = implementationDiffText(patch);
  if (!diffText) {
    if (architectureEvidence) {
      return { ok: true, required: true, details: { ...pathDetails, diffEvidenceSource: 'architecture_evidence', architectureEvidence } };
    }
    return { ok: false, required: true, category: 'architecture_quality', reason: 'missing_implementation_diff', details: pathDetails };
  }
  const diffClassification = classifyImplementationDiff(diffText);
  const claimIntegrity = implementationClaimIntegrity(patch);
  const semanticBloatAudit = implementationMeta.semanticBloatAudit || patch.metadata?.semanticBloatAudit || implementationMeta.architectureEvidence?.semanticBloatAudit || null;
  const genericSemanticShimAudit = auditGenericSemanticShimDiff(diffText);
  const genericSemanticShimRejection = genericSemanticShimRejectionRequired(patch);
  const diffDetails = { ...pathDetails, diffClassification, claimIntegrity, semanticBloatAudit, genericSemanticShimAudit, genericSemanticShimRejection };
  if (diffClassification.addedLineCount === 0) {
    return { ok: false, required: true, category: 'no_op', reason: 'empty_implementation_diff', details: diffDetails };
  }
  if (claimIntegrity.markerOnlyProductDelta || diffClassification.markerOnly) {
    return { ok: false, required: true, category: 'no_op', reason: 'marker_only_product_delta', details: diffDetails };
  }
  if (claimIntegrity.semanticBloatProductDelta || semanticBloatAudit?.semanticBloatSuspect === true) {
    return { ok: false, required: true, category: 'no_op', reason: 'semantic_bloat_product_delta', details: diffDetails };
  }
  if (genericSemanticShimRejection && genericSemanticShimAudit.genericShimSuspect) {
    return { ok: false, required: true, category: 'no_op', reason: 'generic_semantic_shim_product_delta', details: diffDetails };
  }
  if (diffClassification.sourceSyntaxOnly) {
    return { ok: false, required: true, category: 'no_op', reason: 'source_syntax_only_product_delta', details: diffDetails };
  }
  return { ok: true, required: true, details: diffDetails };
}

function evaluateArchitectureAdmission(patch = {}, assignmentContract = {}) {
  if (!patchRequiresArchitectureAdmission(patch, assignmentContract)) return { ok: true, required: false };
  const evidence = patch.metadata?.implementation?.metadata?.architectureEvidence
    || patch.metadata?.architectureEvidence
    || null;
  if (!evidence || evidence.ok !== true) {
    return {
      ok: false,
      required: true,
      category: 'architecture_quality',
      reason: evidence?.reason || 'missing_semantic_architecture_evidence',
      details: { assignmentContract, architectureEvidence: evidence }
    };
  }
  const layerCount = Number(evidence.layerCount || 0);
  const modifiedPrimaryFileCount = Array.isArray(evidence.modifiedPrimaryRuntimeFiles) ? evidence.modifiedPrimaryRuntimeFiles.length : 0;
  const evidencePrimaryFileCount = Array.isArray(evidence.evidencePrimaryRuntimeFiles)
    ? evidence.evidencePrimaryRuntimeFiles.length
    : modifiedPrimaryFileCount;
  const modifiedRequiredLayerCount = Array.isArray(evidence.modifiedRequiredLayers) ? evidence.modifiedRequiredLayers.length : modifiedPrimaryFileCount > 0 ? 1 : 0;
  const signaledFileCount = Array.isArray(evidence.signaledFiles) ? evidence.signaledFiles.length : 0;
  const modifiedSignaledFileCount = Array.isArray(evidence.modifiedSignaledFiles) ? evidence.modifiedSignaledFiles.length : modifiedPrimaryFileCount > 0 ? 1 : 0;
  const runtimeIntegrationOk = evidence.runtimeIntegrationEvidence?.ok === true;
  const strictRuntimeExecutionRequired = semanticRuntimeExecutionRequired(patch);
  const generatedRuntimeReferenced = evidence.runtimeIntegrationEvidence?.generatedRuntimeReferenced === true
    || Number(evidence.runtimeIntegrationEvidence?.generatedRuntimeReferenceCount || 0) > 0;
  const existingProductCallRequired = evidence.runtimeIntegrationEvidence?.existingProductCallRequired === true
    || patch.metadata?.contextPack?.inputs?.semanticProductAdmission?.requireExistingProductCall === true
    || patch.metadata?.contextPack?.shard?.metadata?.semanticExistingProductCallRequired === true;
  const existingProductCallWired = evidence.runtimeIntegrationEvidence?.existingProductCallWired === true
    || Boolean(evidence.runtimeIntegrationEvidence?.existingProductExportName);
  const semanticBloatSuspect = evidence.semanticBloatAudit?.semanticBloatSuspect === true;
  if (semanticBloatSuspect) {
    return {
      ok: false,
      required: true,
      category: 'architecture_quality',
      reason: 'semantic_bloat_product_delta',
      details: { assignmentContract, architectureEvidence: evidence }
    };
  }
  if (modifiedPrimaryFileCount < 1 || evidencePrimaryFileCount < 2 || layerCount < 2 || modifiedRequiredLayerCount < 1 || signaledFileCount < 2 || modifiedSignaledFileCount < 1 || evidence.markerOnly === true || !runtimeIntegrationOk) {
    return {
      ok: false,
      required: true,
      category: 'architecture_quality',
      reason: !runtimeIntegrationOk ? 'missing_concrete_runtime_integration_delta' : 'shallow_semantic_patch',
      details: { assignmentContract, architectureEvidence: evidence }
    };
  }
  if (strictRuntimeExecutionRequired && !generatedRuntimeReferenced) {
    return {
      ok: false,
      required: true,
      category: 'architecture_quality',
      reason: 'export_only_semantic_runtime',
      details: { assignmentContract, architectureEvidence: evidence }
    };
  }
  if (strictRuntimeExecutionRequired && existingProductCallRequired && !existingProductCallWired) {
    return {
      ok: false,
      required: true,
      category: 'architecture_quality',
      reason: 'missing_existing_product_call_wiring',
      details: { assignmentContract, architectureEvidence: evidence }
    };
  }
  return { ok: true, required: true, details: { architectureEvidence: evidence } };
}

function implementationClaimIntegrity(patch = {}) {
  const implementation = patch.metadata?.implementation || {};
  const metadata = implementation.metadata || {};
  const stdout = String(implementation.stdout || '');
  const claimIntegrityKind = String(metadata.claimIntegrityKind || '');
  const semanticBloatAudit = metadata.semanticBloatAudit || patch.metadata?.semanticBloatAudit || metadata.architectureEvidence?.semanticBloatAudit || null;
  const markerOnlyProductDelta = metadata.markerOnlyProductDelta === true
    || claimIntegrityKind === 'marker_only_remediation_delta'
    || /"claimIntegrityKind"\s*:\s*"marker_only_remediation_delta"/.test(stdout)
    || /"markerOnlyProductDelta"\s*:\s*true/.test(stdout);
  const semanticBloatProductDelta = semanticBloatAudit?.semanticBloatSuspect === true
    || claimIntegrityKind === 'semantic_bloat_delta'
    || /"claimIntegrityKind"\s*:\s*"semantic_bloat_delta"/.test(stdout)
    || /"semanticBloatSuspect"\s*:\s*true/.test(stdout);
  return {
    claimIntegrityKind,
    markerOnlyProductDelta,
    semanticBloatProductDelta,
    semanticBloatAudit
  };
}

function semanticRuntimeExecutionRequired(patch = {}) {
  const metadata = patch.metadata || {};
  const contextInputs = metadata.contextPack?.inputs || {};
  const shardMetadata = metadata.contextPack?.shard?.metadata || {};
  const implementationMeta = implementationMetadata(patch);
  return contextInputs.semanticProductAdmission?.requireRuntimeExecution === true
    || contextInputs.semanticProductAdmission?.requireExistingProductCall === true
    || shardMetadata.semanticRuntimeExecutionRequired === true
    || shardMetadata.semanticExistingProductCallRequired === true
    || metadata.semanticRuntimeExecutionRequired === true
    || metadata.semanticExistingProductCallRequired === true
    || implementationMeta.semanticRuntimeExecutionRequired === true
    || implementationMeta.semanticExistingProductCallRequired === true;
}

function normalFlowIntegrationRequired(patch = {}) {
  const metadata = patch.metadata || {};
  const contextInputs = metadata.contextPack?.inputs || {};
  const shardMetadata = metadata.contextPack?.shard?.metadata || {};
  const implementationMeta = implementationMetadata(patch);
  return contextInputs.semanticProductAdmission?.requireNormalFlowIntegration === true
    || contextInputs.semanticProductAdmission?.requireExistingProductNormalFlow === true
    || shardMetadata.semanticNormalFlowIntegrationRequired === true
    || shardMetadata.semanticExistingProductNormalFlowRequired === true
    || metadata.semanticNormalFlowIntegrationRequired === true
    || metadata.semanticExistingProductNormalFlowRequired === true
    || implementationMeta.semanticNormalFlowIntegrationRequired === true
    || implementationMeta.semanticExistingProductNormalFlowRequired === true;
}

function verifierSemanticRuntimeExecutionProof(verifierResults = []) {
  for (const result of verifierResults || []) {
    if (!result || result.ok === false || result.skipped === true) continue;
    const summary = result.parsedOutputSummary || result.metadata?.parsedOutputSummary || null;
    const semanticRuntimeExecution = summary?.semanticRuntimeExecution || result.metadata?.semanticRuntimeExecution || null;
    if (semanticRuntimeExecution?.ok === true) {
      return { ok: true, source: 'parsed_output_summary', verifier: result.verifier || null, semanticRuntimeExecution };
    }
    const stdout = String(result.stdout || '').trim();
    if (stdout && stdout.includes('semanticRuntimeExecution')) {
      try {
        const parsed = JSON.parse(stdout);
        if (parsed?.semanticRuntimeExecution?.ok === true) {
          return { ok: true, source: 'stdout_json', verifier: result.verifier || null, semanticRuntimeExecution: parsed.semanticRuntimeExecution };
        }
      } catch {}
    }
  }
  return { ok: false, reason: 'missing_semantic_runtime_execution_proof' };
}

function verifierNormalFlowIntegrationProof(verifierResults = []) {
  for (const result of verifierResults || []) {
    if (!result || result.ok === false || result.skipped === true) continue;
    const summary = result.parsedOutputSummary || result.metadata?.parsedOutputSummary || null;
    const semanticRuntimeExecution = summary?.semanticRuntimeExecution || result.metadata?.semanticRuntimeExecution || null;
    const proof = semanticRuntimeExecution?.normalFlowProof || null;
    if (semanticRuntimeExecution?.ok === true && proof?.ok === true && proof.source === 'existing_product_function') {
      return { ok: true, source: 'parsed_output_summary', verifier: result.verifier || null, semanticRuntimeExecution, normalFlowProof: proof };
    }
    const stdout = String(result.stdout || '').trim();
    if (stdout && stdout.includes('semanticRuntimeExecution')) {
      try {
        const parsed = JSON.parse(stdout);
        const stdoutExecution = parsed?.semanticRuntimeExecution || null;
        const stdoutProof = stdoutExecution?.normalFlowProof || null;
        if (stdoutExecution?.ok === true && stdoutProof?.ok === true && stdoutProof.source === 'existing_product_function') {
          return { ok: true, source: 'stdout_json', verifier: result.verifier || null, semanticRuntimeExecution: stdoutExecution, normalFlowProof: stdoutProof };
        }
      } catch {}
    }
  }
  return { ok: false, reason: 'missing_existing_product_normal_flow_proof' };
}

function evaluatePatchAdmission(patch, verifierResults = [], { allowProductOnlyVerifierSkip = false } = {}) {
  const assignmentContract = normalizeAssignmentContract(patch.metadata?.assignmentContract || {}, {
    artifactKind: patch.filePaths?.length ? 'product_diff' : 'verification_evidence',
    targetFiles: patch.filePaths || [],
    verifierRequirements: patch.requiredVerifiers || [],
    successPredicate: patch.metadata?.contextPack?.acceptanceChecks || []
  });
  const grounded = validateGroundedAssignmentContract(assignmentContract);
  if (!grounded.ok) {
    return {
      ok: false,
      category: 'planner_failure',
      reason: 'ungrounded_assignment_contract',
      details: {
        failures: grounded.failures,
        assignmentContract
      }
    };
  }

  const modifiedFiles = patchModifiedFiles(patch);
  const targetAreas = semanticProductTargets(assignmentContract);
  const touchedTargetFiles = targetAreas.length === 0
    ? modifiedFiles
    : modifiedFiles.filter((filePath) => targetAreas.some((targetPath) => overlapsArea(filePath, targetPath)));
  const outOfScopeFiles = targetAreas.length === 0
    ? []
    : modifiedFiles.filter((filePath) => !targetAreas.some((targetPath) => overlapsArea(filePath, targetPath)));
  const nonSkippedVerifierPass = verifierResults.some((result) => result?.ok !== false && result?.skipped !== true);
  const productOnlyVerifierSkip = verifierResults.some((result) => result?.ok !== false && result?.skipped === true && result?.reason === 'product_only_mode');
  const productOnlySkipAllowed = Boolean(allowProductOnlyVerifierSkip || patch.metadata?.allowProductOnlyVerifierSkip === true || patch.metadata?.contextPack?.guardrails?.allowProductOnlyVerifierSkip === true);
  const admissibleVerifierEvidence = nonSkippedVerifierPass
    || (assignmentContract.artifactKind === 'product_diff' && touchedTargetFiles.length > 0 && productOnlyVerifierSkip && productOnlySkipAllowed);

  if (assignmentContract.artifactKind === 'product_diff') {
    if (modifiedFiles.length === 0) {
      return {
        ok: false,
        category: 'no_op',
        reason: 'zero_modified_files',
        details: { assignmentContract, modifiedFiles }
      };
    }
    if (touchedTargetFiles.length === 0) {
      return {
        ok: false,
        category: 'planner_failure',
        reason: 'out_of_scope_modified_files',
        details: { assignmentContract, modifiedFiles, outOfScopeFiles }
      };
    }
    if (!admissibleVerifierEvidence) {
      return {
        ok: false,
        category: 'no_op',
        reason: 'no_non_skipped_verifier_evidence',
        details: { assignmentContract, modifiedFiles, verifierResults, productOnlyVerifierSkip, productOnlySkipAllowed }
      };
    }
    const claimIntegrity = implementationClaimIntegrity(patch);
    if (claimIntegrity.markerOnlyProductDelta) {
      return {
        ok: false,
        category: 'no_op',
        reason: 'marker_only_product_delta',
        details: { assignmentContract, modifiedFiles, claimIntegrity }
      };
    }
    if (claimIntegrity.semanticBloatProductDelta) {
      return {
        ok: false,
        category: 'no_op',
        reason: 'semantic_bloat_product_delta',
        details: { assignmentContract, modifiedFiles, claimIntegrity }
      };
    }
  } else if (!nonSkippedVerifierPass) {
    return {
      ok: false,
      category: 'no_op',
      reason: 'no_non_skipped_verifier_evidence',
      details: { assignmentContract, verifierResults }
    };
  }

  const semanticProductAdmission = evaluateSemanticProductAdmission(patch, assignmentContract);
  if (!semanticProductAdmission.ok) {
    return {
      ok: false,
      category: semanticProductAdmission.category,
      reason: semanticProductAdmission.reason,
      details: {
        semanticProductAdmission,
        ...semanticProductAdmission.details
      }
    };
  }

  const architectureAdmission = evaluateArchitectureAdmission(patch, assignmentContract);
  if (!architectureAdmission.ok) {
    return {
      ok: false,
      category: architectureAdmission.category,
      reason: architectureAdmission.reason,
      details: architectureAdmission.details
    };
  }

  const runtimeExecutionRequired = semanticRuntimeExecutionRequired(patch);
  const runtimeExecutionProof = runtimeExecutionRequired
    ? verifierSemanticRuntimeExecutionProof(verifierResults)
    : { ok: true, required: false };
  if (runtimeExecutionRequired && !runtimeExecutionProof.ok) {
    return {
      ok: false,
      category: 'architecture_quality',
      reason: runtimeExecutionProof.reason || 'missing_semantic_runtime_execution_proof',
      details: {
        assignmentContract,
        verifierResults,
        runtimeExecutionProof
      }
    };
  }

  const normalFlowRequired = normalFlowIntegrationRequired(patch);
  const normalFlowProof = normalFlowRequired
    ? verifierNormalFlowIntegrationProof(verifierResults)
    : { ok: true, required: false };
  if (normalFlowRequired && !normalFlowProof.ok) {
    return {
      ok: false,
      category: 'architecture_quality',
      reason: normalFlowProof.reason || 'missing_existing_product_normal_flow_proof',
      details: {
        assignmentContract,
        verifierResults,
        normalFlowProof
      }
    };
  }

  return {
    ok: true,
    details: {
      assignmentContract,
      modifiedFiles,
      touchedTargetFiles,
      outOfScopeFiles,
      nonSkippedVerifierPass,
      productOnlyVerifierSkip,
      productOnlySkipAllowed,
      admissibleVerifierEvidence,
      semanticProductAdmission,
      architectureAdmission,
      runtimeExecutionRequired,
      runtimeExecutionProof,
      normalFlowRequired,
      normalFlowProof
    }
  };
}

function normalizeFailureInjections(failureInjections = []) {
  const byShard = new Map();
  for (const injection of failureInjections || []) {
    if (!injection?.shardId) continue;
    const key = `${injection.shardId}:${Number(injection.attempt || 1)}`;
    byShard.set(key, {
      shardId: injection.shardId,
      attempt: Number(injection.attempt || 1),
      mode: injection.mode || 'stall',
      delayMs: Number(injection.delayMs || 0),
      note: injection.note || null
    });
  }
  return byShard;
}

function createRunDirectories(rootPath) {
  return {
    root: ensureDir(rootPath),
    assignments: ensureDir(path.join(rootPath, 'assignments')),
    results: ensureDir(path.join(rootPath, 'results')),
    logs: ensureDir(path.join(rootPath, 'logs'))
  };
}

function createLiveWorkerAssignment({ directories, shard, pack, workspacePath, canonicalWorkspacePath = null, workerWorkspace = null, workerScriptPath, verifierScriptPath, implementationScriptPath, lease, agentId, failureInjection, executionMode }) {
  const assignment = {
    version: 1,
    generatedAt: new Date().toISOString(),
    executionMode,
    workerScriptPath,
    verifierScriptPath,
    implementationScriptPath: implementationScriptPath || shard.metadata?.implementationScriptPath || null,
    workspacePath,
    canonicalWorkspacePath: canonicalWorkspacePath || workspacePath,
    workerWorkspace: workerWorkspace ? {
      isolated: workerWorkspace.isolated === true,
      mode: workerWorkspace.mode || 'shared',
      copiedPaths: workerWorkspace.copiedPaths || [],
      linkedNodeModules: workerWorkspace.linkedNodeModules || null
    } : null,
    shard,
    contextPack: pack,
    lease,
    agentId,
    resultPath: path.join(directories.results, `${shard.id}__attempt-${lease.attempt}.json`),
    logPath: path.join(directories.logs, `${shard.id}__attempt-${lease.attempt}.log`),
    failureInjection: failureInjection || null
  };
  const assignmentPath = path.join(directories.assignments, `${shard.id}__attempt-${lease.attempt}.json`);
  saveJson(assignmentPath, assignment);
  return { assignmentPath, assignment };
}

function killProcessGroupOrChild(child, signal = 'SIGKILL') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return false;
  let killed = false;
  if (process.platform !== 'win32' && Number(child.pid) > 0) {
    try {
      process.kill(-child.pid, signal);
      killed = true;
    } catch {}
  }
  try {
    killed = child.kill(signal) || killed;
  } catch {}
  return killed;
}

function killWorker(info, { reason = 'terminated', signal = 'SIGKILL' } = {}) {
  if (!info?.child || info.child.exitCode !== null || info.child.signalCode !== null) return false;
  info.killRequestedAt ||= Date.now();
  info.killReason ||= reason;
  info.killSignal ||= signal;
  return killProcessGroupOrChild(info.child, signal);
}

function appendNodeOption(existing, nextOption) {
  const current = String(existing || '').trim();
  const parts = current ? current.split(/\s+/).filter(Boolean) : [];
  if (!parts.includes(nextOption)) parts.push(nextOption);
  return parts.join(' ').trim();
}

function createOutputCollector(limitBytes = 16 * 1024) {
  const maxBytes = Math.max(1024, Number(limitBytes || 16 * 1024));
  let chunks = [];
  let totalBytes = 0;
  return {
    push(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8');
      if (!buffer.length) return;
      chunks.push(buffer);
      totalBytes += buffer.length;
      while (totalBytes > maxBytes && chunks.length) {
        const first = chunks[0];
        const overflow = totalBytes - maxBytes;
        if (overflow >= first.length) {
          chunks.shift();
          totalBytes -= first.length;
          continue;
        }
        chunks[0] = first.subarray(overflow);
        totalBytes -= overflow;
        break;
      }
    },
    text() {
      return Buffer.concat(chunks).toString('utf8');
    }
  };
}

function serializeSpawnError(error) {
  return {
    message: String(error?.message || error),
    code: error?.code || null,
    errno: error?.errno ?? null,
    syscall: error?.syscall || null,
    path: error?.path || null,
    spawnargs: Array.isArray(error?.spawnargs) ? error.spawnargs : []
  };
}

function resolveNodeExecutable() {
  const explicit = String(process.env.ORCHESTRATOR_NODE_BINARY || '').trim();
  if (explicit) return explicit;
  const candidates = [process.execPath, 'node']
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) return candidate;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return process.execPath || 'node';
}

function spawnLiveWorker({ workerScriptPath, assignmentPath, cwd, workerMemoryLimitMb = 96, outputCaptureBytes = 16 * 1024 }) {
  const env = {
    ...process.env,
    NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, `--max-old-space-size=${Math.max(32, Number(workerMemoryLimitMb || 96))}`)
  };
  const stdout = createOutputCollector(outputCaptureBytes);
  const stderr = createOutputCollector(outputCaptureBytes);
  const handle = {
    child: null,
    stdout,
    stderr,
    spawnError: null,
    command: resolveNodeExecutable(),
    cwd
  };
  try {
    const child = spawn(handle.command, [workerScriptPath, '--assignment', assignmentPath], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      detached: process.platform !== 'win32'
    });
    handle.child = child;
    child.on('error', (error) => {
      handle.spawnError = serializeSpawnError(error);
      stderr.push(Buffer.from(`\n[worker_spawn_error] ${JSON.stringify(handle.spawnError)}\n`));
    });
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
  } catch (error) {
    handle.spawnError = serializeSpawnError(error);
    stderr.push(Buffer.from(`\n[worker_spawn_error] ${JSON.stringify(handle.spawnError)}\n`));
  }
  return handle;
}

export async function runLiveWorkerFarm({
  workGraph,
  surfaceMatrix,
  agentCount,
  workerScriptPath,
  verifierScriptPath,
  implementationScriptPath = null,
  workspacePath,
  runRoot,
  maxRuntimeMs = 120000,
  pollMs = 25,
  leaseTtlMs = 2000,
  maxAttemptsPerTask = Number(process.env.ORCHESTRATOR_MAX_ATTEMPTS_PER_TASK || 4),
  workerMemoryLimitMb = Number(process.env.ORCHESTRATOR_WORKER_MAX_OLD_SPACE_MB || 96),
  outputCaptureBytes = Number(process.env.ORCHESTRATOR_WORKER_OUTPUT_CAPTURE_BYTES || 16 * 1024),
  maxSpawnsPerTick = Number(process.env.ORCHESTRATOR_MAX_SPAWNS_PER_TICK || agentCount),
  maxWorkerSpawns = Number(process.env.ORCHESTRATOR_MAX_WORKER_SPAWNS || 0) || Infinity,
  workerWorkspaceMode = process.env.ORCHESTRATOR_WORKER_WORKSPACE_MODE || 'shared',
  workerWorkspaceCopyPaths = [],
  promoteMergedWorkerWorkspaceChanges = process.env.ORCHESTRATOR_PROMOTE_WORKER_WORKSPACE_CHANGES === '1' ? true : undefined,
  relaxLeaseFileAreasForIsolatedWorkspaces = true,
  workerTimeoutMs = Number(process.env.ORCHESTRATOR_WORKER_TIMEOUT_MS || 0) || Math.max(10_000, Math.min(Number(maxRuntimeMs || 120_000), 300_000)),
  workerKillGraceMs = Number(process.env.ORCHESTRATOR_WORKER_KILL_GRACE_MS || 2_000),
  plannerOptions = {},
  failureInjections = [],
  globalInputs = {},
  verifyFns = createRecordedVerifierMap(),
  executionMode = 'live_multiprocess_worker_farm',
  campaignContract = null,
  allowProductOnlyVerifierSkip = false,
  canonicalLandingEvidence = false,
  landingEvidencePolicy = {},
  proofCarryingClaims = false,
  claimLedgerPolicy = {},
  adversarialClaimVerifiers = {},
  contextGovernorOptions = {},
  previousWaveFactpack = null
}) {
  const shardPlan = buildShardPlan({ workGraph, surfaceMatrix, options: plannerOptions });
  const frontier = summarizeShardFrontier(shardPlan.shards);
  const schedulerModel = buildSchedulerModel({ shardPlan, surfaceMatrix });
  const directories = createRunDirectories(runRoot);
  const effectiveMaxWorkerSpawns = Number.isFinite(Number(maxWorkerSpawns)) && Number(maxWorkerSpawns) >= 0
    ? Number(maxWorkerSpawns)
    : Infinity;
  const effectiveWorkerWorkspaceMode = String(workerWorkspaceMode || 'shared').trim() || 'shared';
  const isolatedWorkerWorkspaces = isIsolatedWorkerWorkspaceMode(effectiveWorkerWorkspaceMode);
  const promoteWorkerWorkspaceChanges = isolatedWorkerWorkspaces && promoteMergedWorkerWorkspaceChanges !== false;
  const workerWorkspacePromotionSnapshots = new Map();
  const landingEvidenceMode = landingEvidencePolicy?.mode || (canonicalLandingEvidence ? 'block_on_failed_landing' : 'off');
  const landingEvidenceEnabled = landingEvidenceMode !== 'off';
  const claimLedgerMode = claimLedgerPolicy?.mode || (proofCarryingClaims ? 'block_on_failed_claim' : 'off');
  const claimLedgerEnabled = claimLedgerMode !== 'off';
  const effectiveClaimLedgerPolicy = { ...claimLedgerPolicy, mode: claimLedgerMode };
  const landingEvidenceProductPaths = stableList([
    ...(landingEvidencePolicy?.productPaths || []),
    ...shardPlan.shards.flatMap((shard) => [...(shard.allowedFiles || []), ...(shard.fileAreas || [])])
  ]);
  const landingPolicy = {
    ...landingEvidencePolicy,
    mode: landingEvidenceMode,
    repoPath: landingEvidencePolicy?.repoPath || workspacePath,
    productPaths: landingEvidenceProductPaths
  };
  const landingEvidenceBaseline = landingEvidenceEnabled
    ? createCanonicalRunBaseline({ repoPath: workspacePath, productPaths: landingEvidenceProductPaths, policy: landingPolicy })
    : null;
  let leaseState = createLeaseState({ defaultTtlMs: leaseTtlMs });
  let artifactBus = createArtifactBus({ rootPath: runRoot });
  let patchQueue = createPatchQueue();
  const effectiveCampaignContract = {
    requestedFidelity: campaignContract?.fidelity || campaignContract?.requestedFidelity || 'production_slice',
    requestedScope: campaignContract?.requestedScope
      || (Array.isArray(campaignContract?.scope?.surfaces) ? campaignContract.scope.surfaces.map((surface) => surface.id).filter(Boolean) : null)
      || ['live-worker-qualification'],
    targetPath: campaignContract?.targetPath || campaignContract?.repoPath || workGraph.targetPath || workspacePath,
    orchestrationLearning: campaignContract?.orchestrationLearning || campaignContract?.scope?.orchestrationLearning || globalInputs?.orchestrationLearning || null
  };
  const contextGovernorPolicy = normalizeContextGovernorOptions(contextGovernorOptions, { agentCount, shardCount: shardPlan.shards.length });
  const contextPacks = compileContextPacks({ contract: effectiveCampaignContract, shardPlan, surfaceMatrix, artifactBus, globalInputs, contextGovernorOptions: contextGovernorPolicy, previousWaveFactpack });
  if (process.env.ORCHESTRATOR_SAVE_CONTEXT_PACK_DIAGNOSTICS !== '0') {
    saveJson(path.join(runRoot, 'context_pack_diagnostics.json'), {
      generatedAt: new Date().toISOString(),
      sampleCount: Math.min(3, contextPacks.length),
      samples: contextPacks.slice(0, 3).map((pack) => ({
        shardId: pack?.shard?.id || null,
        approxTokens: estimateContextTokens(pack),
        components: Object.fromEntries(Object.entries(pack || {}).map(([key, value]) => [key, estimateContextTokens(value)]))
      }))
    });
    if (contextPacks[0]) saveJson(path.join(runRoot, 'context_pack_sample.json'), contextPacks[0]);
  }
  const contextGovernorReport = buildContextGovernorReport({ contextPacks, options: contextGovernorPolicy, agentCount, shardCount: shardPlan.shards.length });
  const packByShardId = new Map(contextPacks.map((pack) => [pack.shard.id, pack]));
  const shardById = new Map(shardPlan.shards.map((shard) => [shard.id, shard]));
  const groundingFailures = shardPlan.shards
    .map((shard) => {
      const assignmentContract = normalizeAssignmentContract(shard.metadata?.assignmentContract || {}, {
        artifactKind: 'verification_evidence',
        targetFiles: shard.allowedFiles || [],
        targetModules: shard.fileAreas || [],
        verifierRequirements: shard.requiredVerifiers || [],
        successPredicate: shard.acceptanceChecks || []
      });
      const grounded = validateGroundedAssignmentContract(assignmentContract);
      if (grounded.ok) return null;
      return {
        type: 'planner_failure',
        shardId: shard.id,
        reason: 'ungrounded_assignment_contract',
        failures: grounded.failures,
        assignmentContract
      };
    })
    .filter(Boolean);
  saveJson(path.join(runRoot, 'assignment_contract_audit.json'), {
    generatedAt: new Date().toISOString(),
    shardCount: shardPlan.shards.length,
    invalidShardCount: groundingFailures.length,
    invalidShards: groundingFailures
  });
  saveJson(path.join(runRoot, 'scheduler_model.json'), schedulerModel);
  saveJson(path.join(runRoot, 'context_governor_report.json'), contextGovernorReport);
  if (contextGovernorReport.enabled && contextGovernorReport.hardGate && !contextGovernorReport.ok) {
    const blockedSummary = {
      generatedAt: new Date().toISOString(),
      executionMode,
      agentCount,
      shardCount: shardPlan.shards.length,
      frontier,
      mergedShardCount: 0,
      elapsedMs: 0,
      blocker: 'context_pack_budget_exceeded',
      metrics: {
        workerSpawnCount: 0,
        workerExitFailures: 0,
        workerSpawnFailures: 0,
        staleLeaseCount: 0,
        recoveryCount: 0,
        crashInjectionCount: 0,
        stallInjectionCount: 0,
        mergedPatchCount: 0,
        shardOutputCount: 0,
        lateResultsIgnored: 0,
        workerTimeoutCount: 0,
        forcedWorkerCleanupCount: 0,
        observedAgentCount: 0,
        observedAgentIds: [],
        peakConcurrentWorkers: 0,
        contextGovernorBlocked: true
      },
      contextGovernor: contextGovernorReport
    };
    const blockedSupervisor = {
      generatedAt: new Date().toISOString(),
      topLevel: { status: 'red', reason: 'context_pack_budget_exceeded', blockerKind: 'token_efficiency_launch_gate' },
      contextGovernor: contextGovernorReport
    };
    const blockedFactpack = buildWaveFactPack({ waveNumber: 1, runSummary: blockedSummary, patchQueue, workerEvents: [], contextGovernorReport, previousWaveFactpack });
    saveJson(path.join(runRoot, 'summary.json'), blockedSummary);
    saveJson(path.join(runRoot, 'worker_events.json'), []);
    saveJson(path.join(runRoot, 'lease_state.json'), leaseState);
    saveJson(path.join(runRoot, 'patch_queue.json'), patchQueue);
    saveJson(path.join(runRoot, 'artifact_bus.json'), artifactBus);
    saveJson(path.join(runRoot, 'supervisor.json'), blockedSupervisor);
    saveJson(path.join(runRoot, 'wave_factpack.json'), blockedFactpack);
    return {
      ok: false,
      executionMode,
      agentCount,
      shardPlan,
      frontier,
      leaseState,
      artifactBus,
      patchQueue,
      landingEvidence: null,
      claimLedger: null,
      schedulerTruth: null,
      supervisor: blockedSupervisor,
      workerEvents: [],
      summary: blockedSummary,
      metrics: blockedSummary.metrics,
      contextGovernor: contextGovernorReport,
      waveFactpack: blockedFactpack,
      runRoot
    };
  }
  if (landingEvidenceEnabled) {
    saveJson(path.join(runRoot, 'landing_baseline.json'), landingEvidenceBaseline);
  }
  const injectionMap = normalizeFailureInjections(failureInjections);
  const agents = Array.from({ length: agentCount }, (_, index) => `agent-${index + 1}`);
  const activeWorkers = new Map();
  const metrics = {
    workerSpawnCount: 0,
    workerExitFailures: 0,
    workerSpawnFailures: 0,
    staleLeaseCount: 0,
    recoveryCount: 0,
    crashInjectionCount: 0,
    stallInjectionCount: 0,
    mergedPatchCount: 0,
    shardOutputCount: 0,
    lateResultsIgnored: 0,
    workerTimeoutCount: 0,
    forcedWorkerCleanupCount: 0
  };

  function workerSpawnBudgetRemaining() {
    return !Number.isFinite(effectiveMaxWorkerSpawns) || metrics.workerSpawnCount < effectiveMaxWorkerSpawns;
  }

  function recordWorkerSpawnBudgetExhausted(extra = {}) {
    recordWorkerEvent({
      type: 'worker_spawn_budget_exhausted',
      workerSpawnCount: metrics.workerSpawnCount,
      maxWorkerSpawns: effectiveMaxWorkerSpawns,
      ...extra
    });
  }

  const observedAgentIds = new Set();
  const agentLastDispatchSequence = new Map(agents.map((agentId) => [agentId, 0]));
  let agentDispatchSequence = 0;
  let peakConcurrentWorkers = 0;
  let lastFailedShardSignature = null;
  const workerEvents = [];
  const startedAt = Date.now();

  function recordWorkerEvent(event) {
    const entry = { at: new Date().toISOString(), ...event };
    workerEvents.push(entry);
    artifactBus = recordArtifactEvent(artifactBus, entry);
  }

  function observeWorkerSpawn(agentId) {
    if (agentId) observedAgentIds.add(String(agentId));
    peakConcurrentWorkers = Math.max(peakConcurrentWorkers, activeWorkers.size);
  }

  function mergedShardIds() {
    return new Set((patchQueue.merged || []).map((artifact) => artifact.shardId));
  }

  function rejectedShardIds() {
    return new Set((patchQueue.rejected || []).map((artifact) => artifact.shardId).filter(Boolean));
  }

  if (groundingFailures.length > 0) {
    const supervisor = compileSupervisorSnapshot({ shardPlan, leaseState, patchQueue, artifactBus, blockers: groundingFailures, now: Date.now() });
    const summary = {
      generatedAt: new Date().toISOString(),
      executionMode,
      agentCount,
      shardCount: shardPlan.shards.length,
      frontier,
      mergedShardCount: 0,
      elapsedMs: 0,
      metrics: {
        ...metrics,
        observedAgentCount: 0,
        observedAgentIds: [],
        peakConcurrentWorkers: 0,
        maxAttemptsPerTask,
        failedShards: [],
        plannerFailures: groundingFailures,
        stateLossEvents: 0,
        continuityFailures: []
      }
    };
    saveJson(path.join(runRoot, 'summary.json'), summary);
    saveJson(path.join(runRoot, 'worker_events.json'), workerEvents);
    saveJson(path.join(runRoot, 'lease_state.json'), leaseState);
    saveJson(path.join(runRoot, 'patch_queue.json'), patchQueue);
    saveJson(path.join(runRoot, 'artifact_bus.json'), artifactBus);
    saveJson(path.join(runRoot, 'supervisor.json'), supervisor);
    return {
      ok: false,
      executionMode,
      agentCount,
      shardPlan,
      frontier,
      summary,
      supervisor,
      metrics: summary.metrics,
      leaseState,
      patchQueue,
      artifactBus,
      runRoot
    };
  }

  function clearWorker(agentId) {
    const info = activeWorkers.get(agentId);
    if (!info) return;
    activeWorkers.delete(agentId);
  }

  function shardLeaseFileAreas(shard) {
    const metadata = shard?.metadata || {};
    const primaryAdoptionRequested = metadata.primaryProductAdoptionRequired === true
      || metadata.continuationFullClone === true
      || Boolean(metadata.primaryAdoptionFile)
      || (Array.isArray(metadata.primaryAdoptionFiles) && metadata.primaryAdoptionFiles.length > 0);
    if (primaryAdoptionRequested) {
      const sourceTargets = orderedUniqueList([
        ...(Array.isArray(metadata.sourceProductFiles) ? metadata.sourceProductFiles : []),
        metadata.sourceProductFile
      ]).filter((filePath) => /^(apps|packages|src|public)\/.+\.(?:mjs|js|jsx|css|ts|tsx)$/.test(filePath));
      if (sourceTargets.length > 0) return stableList(selectLayerDiverseLeaseTargets(sourceTargets, shard));
      const primaryTargets = orderedUniqueList([
        metadata.primaryAdoptionFile,
        ...(Array.isArray(metadata.primaryAdoptionFiles) ? metadata.primaryAdoptionFiles : [])
      ]).filter((filePath) => /^(apps|packages|src|public)\/.+\.(?:mjs|js|jsx|css|ts|tsx)$/.test(filePath));
      if (primaryTargets.length > 0) return stableList(selectLayerDiverseLeaseTargets(primaryTargets, shard));
    }
    return stableList([...(shard.fileAreas || []), ...(shard.allowedFiles || [])]);
  }

  function reserveAgentIds() {
    return agents
      .filter((agentId) => !activeWorkers.has(agentId))
      .sort((left, right) => {
        const leftObserved = observedAgentIds.has(left) ? 1 : 0;
        const rightObserved = observedAgentIds.has(right) ? 1 : 0;
        if (leftObserved !== rightObserved) return leftObserved - rightObserved;
        const leftLast = agentLastDispatchSequence.get(left) || 0;
        const rightLast = agentLastDispatchSequence.get(right) || 0;
        if (leftLast !== rightLast) return leftLast - rightLast;
        return left.localeCompare(right, undefined, { numeric: true });
      });
  }

  function noteAgentDispatch(agentId) {
    if (!agentId) return;
    agentDispatchSequence += 1;
    agentLastDispatchSequence.set(agentId, agentDispatchSequence);
  }

  function finalizeResult(agentId, info) {
    if (!info || info.processed) return;
    info.processed = true;
    const currentLease = leaseState.tasks[info.shardId];
    const result = loadJson(info.resultPath, null);
    const childStdout = info.stdout?.text?.() || '';
    const childStderr = info.stderr?.text?.() || '';
    const workerWorkspaceSummary = info.workerWorkspace?.isolated ? {
      isolated: true,
      mode: info.workerWorkspace.mode,
      path: info.workerWorkspace.workspacePath,
      copiedPathCount: info.workerWorkspace.copiedPaths?.length || 0,
      linkedNodeModules: info.workerWorkspace.linkedNodeModules || null,
      gitBaseline: info.workerWorkspace.gitBaseline || null
    } : null;
    const promotionPatchId = `patch-${info.shardId}`;
    if (result?.implementation && info.workerWorkspace?.isolated) {
      const snapshots = captureModifiedFileSnapshots({
        workerWorkspace: info.workerWorkspace,
        modifiedFiles: result.implementation.modifiedFiles || []
      });
      workerWorkspacePromotionSnapshots.set(promotionPatchId, {
        workerWorkspace: workerWorkspaceSummary,
        snapshots
      });
      result.implementation.metadata ||= {};
      result.implementation.metadata.workerWorkspace = workerWorkspaceSummary;
      result.implementation.metadata.workerWorkspacePromotionKey = promotionPatchId;
      result.implementation.metadata.workerWorkspaceModifiedFileCount = snapshots.length;
    }

    function terminallyRejectWorkerResult({ category = 'worker_result_failed', reason = 'worker_returned_nonzero_with_result' } = {}) {
      const changedFiles = stableList(result?.implementation?.modifiedFiles || []);
      const shard = shardById.get(info.shardId) || {};
      const rejectedPatch = createPatchArtifact({
        shardId: info.shardId,
        taskId: info.shardId,
        agentId,
        filePaths: changedFiles,
        diffSummary: result?.implementation?.diffSummary || result?.reason || `rejected ${info.shardId}`,
        requiredVerifiers: shard.requiredVerifiers || ['tests'],
        dependencyShardIds: shard.dependencyShardIds || [],
        metadata: {
          executionMode,
          resultPath: info.resultPath,
          implementation: result?.implementation || null,
          verifierResults: result?.verifierResults || [],
          assignmentContract: shard.metadata?.assignmentContract || null,
          contextPack: packByShardId.get(info.shardId) || null,
          workerExitCode: info.exitCode,
          workerSignalCode: info.signalCode,
          workerResultOk: result?.ok ?? null,
          stdout: childStdout,
          stderr: childStderr,
          workerWorkspace: workerWorkspaceSummary
        }
      });
      rejectedPatch.status = 'rejected';
      rejectedPatch.rejectionCategory = category;
      rejectedPatch.rejectionReason = reason;
      rejectedPatch.rejectedAt = new Date().toISOString();
      patchQueue.rejected.push(rejectedPatch);
      patchQueue.history.push({
        at: rejectedPatch.rejectedAt,
        type: 'worker_result_terminal_rejection',
        patchId: rejectedPatch.id,
        shardId: info.shardId,
        rejectionCategory: category,
        rejectionReason: reason
      });
      artifactBus = publishArtifact(artifactBus, {
        type: 'shard_output',
        shardId: info.shardId,
        taskId: info.shardId,
        producer: agentId,
        filePath: info.resultPath,
        metadata: {
          executionMode,
          resultPath: info.resultPath,
          implementation: result?.implementation || null,
          verifierResults: result?.verifierResults || [],
          stdout: childStdout,
          stderr: childStderr,
          workerWorkspace: workerWorkspaceSummary,
          terminalRejection: { category, reason }
        }
      }).bus;
      metrics.shardOutputCount += 1;
      leaseState = releaseLease(leaseState, { leaseId: info.leaseId, agentId, reason: 'completed' }).state;
      recordWorkerEvent({ type: 'live_worker_result_terminal_rejection', shardId: info.shardId, agentId, leaseId: info.leaseId, exitCode: info.exitCode, signalCode: info.signalCode, ok: false, resultPath: info.resultPath, rejectionCategory: category, rejectionReason: reason });
      clearWorker(agentId);
    }

    if (!result || info.exitCode !== 0 || info.spawnError) {
      if (result && !info.spawnError && result?.implementation?.ok === true) {
        const runtimeEvidence = result?.implementation?.metadata?.semanticBloatAudit?.runtimeIntegrationEvidence || {};
        const admissionFailure = result?.admissionFailure || null;
        const architectureEvidence = admissionFailure?.architectureEvidence || result?.implementation?.metadata?.architectureEvidence || null;
        terminallyRejectWorkerResult({
          category: admissionFailure ? 'quality_gate_failed' : runtimeEvidence.ok === false ? 'quality_gate_failed' : 'worker_result_failed',
          reason: admissionFailure?.reason || architectureEvidence?.reason || runtimeEvidence.reason || result.reason || result.error || 'worker_returned_nonzero_with_result'
        });
        return;
      }
      const creativeEvidence = result?.implementation?.metadata?.creativeWorkerEvidence || null;
      const creativeBudgetStopReason = creativeEvidence?.budget?.stopReason || null;
      const creativeFailureReasons = creativeEvidence?.failureReasons || [];
      const nonRetryableCreativeStop = result && !info.spawnError && result?.implementation?.metadata?.productDiffMode === 'creative_product_work'
        && (creativeEvidence?.retryable === false
          || creativeBudgetStopReason === 'codex_usage_limit_observed'
          || creativeBudgetStopReason === 'creative_global_token_limit_reached'
          || creativeBudgetStopReason === 'creative_global_reserved_token_limit_reached'
          || creativeBudgetStopReason === 'creative_global_call_limit_reached'
          || creativeFailureReasons.includes('creative_worker_generic_semantic_shim_detected'));
      if (nonRetryableCreativeStop) {
        terminallyRejectWorkerResult({
          category: 'non_retryable_creative_worker_stop',
          reason: creativeBudgetStopReason || creativeFailureReasons[0] || result.reason || 'creative_worker_non_retryable_failure'
        });
        return;
      }
      const spawnError = info.spawnError || (info.exitCode === -2
        ? { message: 'worker process failed to spawn', code: 'ENOENT', errno: -2, syscall: 'spawn', path: info.spawned?.command || null, spawnargs: [workerScriptPath, '--assignment', info.assignmentPath].filter(Boolean) }
        : null);
      metrics.workerExitFailures += info.exitCode === 0 && !spawnError ? 0 : 1;
      if (spawnError) metrics.workerSpawnFailures += 1;
      leaseState = releaseLease(leaseState, { leaseId: info.leaseId, agentId, reason: 'failed' }).state;
      recordWorkerEvent({ type: 'live_worker_exit', shardId: info.shardId, agentId, leaseId: info.leaseId, exitCode: info.exitCode, signalCode: info.signalCode, spawnError, timedOut: Boolean(info.timedOut), killReason: info.killReason || null, ok: false });
      clearWorker(agentId);
      return;
    }

    if (!currentLease || currentLease.leaseId !== info.leaseId) {
      metrics.lateResultsIgnored += 1;
      recordWorkerEvent({ type: 'late_result_ignored', shardId: info.shardId, agentId, leaseId: info.leaseId, currentLeaseId: currentLease?.leaseId || null, resultPath: info.resultPath });
      clearWorker(agentId);
      return;
    }

    const publishResult = publishArtifact(artifactBus, {
      type: 'shard_output',
      shardId: info.shardId,
      taskId: info.shardId,
      producer: agentId,
      filePath: info.resultPath,
        metadata: {
          executionMode,
          resultPath: info.resultPath,
          implementation: result.implementation || null,
          verifierResults: result.verifierResults || [],
          stdout: childStdout,
          stderr: childStderr,
          workerWorkspace: workerWorkspaceSummary
        }
      });
    artifactBus = publishResult.bus;
    metrics.shardOutputCount += 1;
    leaseState = releaseLease(leaseState, { leaseId: info.leaseId, agentId, reason: 'completed' }).state;
    const changedFiles = stableList(result?.implementation?.modifiedFiles || []);
    patchQueue = enqueuePatch(patchQueue, createPatchArtifact({
      shardId: info.shardId,
      taskId: info.shardId,
      agentId,
      filePaths: changedFiles,
      diffSummary: result?.implementation?.diffSummary || `verified ${info.shardId}`,
      requiredVerifiers: shardById.get(info.shardId)?.requiredVerifiers || ['tests'],
      dependencyShardIds: shardById.get(info.shardId)?.dependencyShardIds || [],
        metadata: {
          executionMode,
          resultPath: info.resultPath,
          implementation: result.implementation || null,
          verifierResults: result.verifierResults || [],
          assignmentContract: shardById.get(info.shardId)?.metadata?.assignmentContract || null,
          contextPack: packByShardId.get(info.shardId) || null,
          workerWorkspace: workerWorkspaceSummary,
          workerWorkspacePromotionKey: info.workerWorkspace?.isolated ? promotionPatchId : null
        }
      }));
    recordWorkerEvent({ type: 'live_worker_exit', shardId: info.shardId, agentId, leaseId: info.leaseId, exitCode: info.exitCode, signalCode: info.signalCode, ok: true, resultPath: info.resultPath });
    clearWorker(agentId);
  }

  function renewActiveWorkerLeases(now) {
    const renewalIntervalMs = Math.max(50, Math.min(5000, Math.floor(Number(leaseTtlMs || 2000) / 3)));
    for (const [agentId, info] of activeWorkers.entries()) {
      if (!info || info.processed) continue;
      if (info.killRequestedAt) continue;
      if (info.spawned?.spawnError) continue;
      if (info.child.exitCode !== null || info.child.signalCode !== null) continue;
      if (now - Number(info.lastLeaseRenewalAt || 0) < renewalIntervalMs) continue;
      const currentLease = leaseState.tasks[info.shardId];
      if (!currentLease || currentLease.leaseId !== info.leaseId || currentLease.agentId !== agentId) continue;
      const renewed = renewLease(leaseState, { leaseId: info.leaseId, agentId, ttlMs: leaseTtlMs }, now);
      leaseState = renewed.state;
      if (renewed.ok) {
        info.lastLeaseRenewalAt = now;
        info.leaseRenewalCount = Number(info.leaseRenewalCount || 0) + 1;
        if (info.leaseRenewalCount === 1 || info.leaseRenewalCount % 12 === 0) {
          recordWorkerEvent({ type: 'live_worker_lease_renewed', shardId: info.shardId, agentId, leaseId: info.leaseId, renewalCount: info.leaseRenewalCount });
        }
      }
    }
  }

  function enforceWorkerRuntimeBudget(now) {
    for (const [agentId, info] of activeWorkers.entries()) {
      if (!info || info.processed) continue;
      if (info.child?.exitCode !== null || info.child?.signalCode !== null) continue;
      const spawnedAt = Number(info.startedAtMs || startedAt);
      if (!info.timedOut && now - spawnedAt > workerTimeoutMs) {
        info.timedOut = true;
        info.timeoutMs = workerTimeoutMs;
        metrics.workerTimeoutCount += 1;
        recordWorkerEvent({ type: 'live_worker_timeout', shardId: info.shardId, agentId, leaseId: info.leaseId, runtimeMs: now - spawnedAt, workerTimeoutMs });
        killWorker(info, { reason: 'worker_timeout', signal: 'SIGKILL' });
        continue;
      }
      if (info.killRequestedAt && now - Number(info.killRequestedAt) > workerKillGraceMs) {
        metrics.forcedWorkerCleanupCount += 1;
        recordWorkerEvent({ type: 'live_worker_forced_cleanup', shardId: info.shardId, agentId, leaseId: info.leaseId, killReason: info.killReason || null, killSignal: info.killSignal || null });
        info.exitCode = 1;
        info.signalCode = info.killSignal || 'SIGKILL';
        finalizeResult(agentId, info);
      }
    }
  }

  async function drainReadyPatchQueue() {
    const merged = mergedShardIds();
    const queueResult = await processPatchQueue(patchQueue, {
      leaseState,
      verifyFns,
      completedShardIds: [...merged],
      allowProductOnlyVerifierSkip,
      canonicalLandingEvidence: landingEvidenceEnabled,
      landingEvidenceBaseline,
      landingEvidencePolicy: landingPolicy,
      proofCarryingClaims: claimLedgerEnabled || proofCarryingClaims,
      claimLedgerPolicy: effectiveClaimLedgerPolicy,
      adversarialClaimVerifiers,
      promotePatch: promoteWorkerWorkspaceChanges
        ? async (patch) => promoteWorkerWorkspacePatch({
          patch,
          promotionSnapshots: workerWorkspacePromotionSnapshots.get(patch.id),
          canonicalWorkspacePath: workspacePath
        })
        : null
    });
    patchQueue = queueResult.queue;
    for (const decision of queueResult.decisions.filter((entry) => entry.status === 'merged')) {
      const patch = patchQueue.merged.find((entry) => entry.id === decision.patchId);
      if (patch) {
        metrics.mergedPatchCount += 1;
        artifactBus = publishArtifact(artifactBus, {
          type: 'patch_merged',
          shardId: patch.shardId,
          taskId: patch.taskId,
          producer: patch.agentId,
          filePath: patch.metadata?.resultPath || `merge/${patch.id}.json`,
          metadata: { executionMode, verifierResults: patch.verifierResults || [] }
        }).bus;
      }
    }
    return queueResult;
  }

  while (Date.now() - startedAt < maxRuntimeMs) {
    for (const [agentId, info] of [...activeWorkers.entries()]) {
      if (info.spawned?.spawnError) {
        info.exitCode = 1;
        info.signalCode = null;
        info.spawnError = info.spawned.spawnError;
        finalizeResult(agentId, info);
      } else if (info.child?.exitCode !== null || info.child?.signalCode !== null) {
        info.exitCode = info.child?.exitCode ?? 1;
        info.signalCode = info.child?.signalCode ?? null;
        finalizeResult(agentId, info);
      }
    }

    const now = Date.now();
    enforceWorkerRuntimeBudget(now);
    renewActiveWorkerLeases(now);
    const staleLeases = detectStaleLeases(leaseState, { now });
    if (staleLeases.length) {
      metrics.staleLeaseCount += staleLeases.length;
      for (const stale of staleLeases) {
        const ownerAgentId = [...activeWorkers.entries()].find(([, info]) => info.leaseId === stale.leaseId)?.[0];
        if (ownerAgentId) {
          killWorker(activeWorkers.get(ownerAgentId));
          clearWorker(ownerAgentId);
        }
      }
      const recovery = recoverStaleLeases(leaseState, { now, agentIds: reserveAgentIds() });
      leaseState = recovery.state;
      metrics.recoveryCount += recovery.recoveryActions.length;
      for (const action of recovery.recoveryActions) {
        recordWorkerEvent({ type: 'lease_recovered', shardId: action.taskId, previousAgentId: action.previousAgentId, nextAgentId: action.nextAgentId, previousLeaseId: action.previousLeaseId, nextLeaseId: action.nextLeaseId });
      }
    }

    const recoveredReservations = activeLeases(leaseState, now)
      .filter((lease) => lease.metadata?.recoveredFrom && !activeWorkers.has(lease.agentId))
      .sort((left, right) => left.taskId.localeCompare(right.taskId));

    for (const lease of recoveredReservations) {
      if (!workerSpawnBudgetRemaining()) {
        recordWorkerSpawnBudgetExhausted({ phase: 'recovered_reservation_spawn', recoveredShardId: lease.taskId, recoveredAgentId: lease.agentId });
        break;
      }
      const shard = shardById.get(lease.taskId);
      if (!shard) continue;
      const workerWorkspace = prepareWorkerWorkspace({
        mode: effectiveWorkerWorkspaceMode,
        workspacePath,
        directories,
        shard,
        agentId: lease.agentId,
        lease,
        copyPaths: workerWorkspaceCopyPaths
      });
      const { assignmentPath, assignment } = createLiveWorkerAssignment({
        directories,
        shard,
        pack: packByShardId.get(shard.id),
        workspacePath: workerWorkspace.workspacePath,
        canonicalWorkspacePath: workspacePath,
        workerWorkspace,
        workerScriptPath,
        verifierScriptPath,
        implementationScriptPath,
        lease,
        agentId: lease.agentId,
        failureInjection: null,
        executionMode
      });
      const spawned = spawnLiveWorker({
        workerScriptPath,
        assignmentPath,
        cwd: workerWorkspace.workspacePath,
        workerMemoryLimitMb,
        outputCaptureBytes
      });
      activeWorkers.set(lease.agentId, {
        shardId: shard.id,
        leaseId: lease.leaseId,
        resultPath: assignment.resultPath,
        child: spawned.child,
        spawned,
        stdout: spawned.stdout,
        stderr: spawned.stderr,
        workerWorkspace,
        processed: false,
        assignmentPath,
        startedAtMs: Date.now()
      });
      noteAgentDispatch(lease.agentId);
      observeWorkerSpawn(lease.agentId);
      metrics.workerSpawnCount += 1;
      recordWorkerEvent({
        type: 'live_worker_respawned',
        shardId: shard.id,
        agentId: lease.agentId,
        leaseId: lease.leaseId,
        attempt: lease.attempt,
        recoveredFrom: lease.metadata?.recoveredFrom || null,
        workerWorkspaceMode: workerWorkspace.mode || 'shared',
        contextFootprint: assignment.contextPack?.contextFootprint || null,
        workerRole: assignment.contextPack?.contextGovernor?.hierarchy?.workerRole || null,
        workerModel: assignment.contextPack?.modelTierPlan?.worker?.tier || null,
        promptMode: assignment.contextPack?.modelTierPlan?.worker?.promptMode || null
      });
    }

    await drainReadyPatchQueue();

    const merged = mergedShardIds();
    const rejected = rejectedShardIds();
    const activeShardIds = new Set([...activeWorkers.values()].map((info) => info.shardId));
    const leasedShardIds = new Set(activeLeases(leaseState, now).map((lease) => lease.taskId));
    const queuedShardIds = new Set((patchQueue.queued || []).map((artifact) => artifact.shardId));
    const readyShards = interleaveShardsBySchedulingGroup(shardPlan.shards
      .filter((shard) => !merged.has(shard.id) && !rejected.has(shard.id) && !queuedShardIds.has(shard.id) && !activeShardIds.has(shard.id) && !leasedShardIds.has(shard.id) && Number(leaseState.taskAttempts?.[shard.id] || 0) < maxAttemptsPerTask && (shard.dependencyShardIds || []).every((dependencyShardId) => merged.has(dependencyShardId)))
      .sort((left, right) => left.id.localeCompare(right.id)));

    let spawnedThisTick = 0;
    for (const agentId of reserveAgentIds()) {
      if (!workerSpawnBudgetRemaining()) break;
      if (spawnedThisTick >= Math.max(1, Number(maxSpawnsPerTick || agentCount))) break;
      let shard = null;
      let acquisition = null;
      while (readyShards.length > 0) {
        const candidate = readyShards.shift();
        const logicalFileAreas = shardLeaseFileAreas(candidate);
        const candidateAcquisition = acquireLease(leaseState, {
          taskId: candidate.id,
          agentId,
          fileAreas: isolatedWorkerWorkspaces && relaxLeaseFileAreasForIsolatedWorkspaces ? [] : logicalFileAreas,
          ttlMs: leaseTtlMs,
          metadata: isolatedWorkerWorkspaces ? { workerWorkspaceMode: effectiveWorkerWorkspaceMode, logicalFileAreas } : {}
        }, now);
        leaseState = candidateAcquisition.state;
        if (!candidateAcquisition.ok) continue;
        shard = candidate;
        acquisition = candidateAcquisition;
        break;
      }
      if (!shard || !acquisition) break;
      const failureInjection = injectionMap.get(`${shard.id}:${acquisition.lease.attempt}`) || null;
      if (failureInjection?.mode === 'stall') metrics.stallInjectionCount += 1;
      if (failureInjection?.mode === 'crash') metrics.crashInjectionCount += 1;
      const workerWorkspace = prepareWorkerWorkspace({
        mode: effectiveWorkerWorkspaceMode,
        workspacePath,
        directories,
        shard,
        agentId,
        lease: acquisition.lease,
        copyPaths: workerWorkspaceCopyPaths
      });
      const { assignmentPath, assignment } = createLiveWorkerAssignment({
        directories,
        shard,
        pack: packByShardId.get(shard.id),
        workspacePath: workerWorkspace.workspacePath,
        canonicalWorkspacePath: workspacePath,
        workerWorkspace,
        workerScriptPath,
        verifierScriptPath,
        implementationScriptPath,
        lease: acquisition.lease,
        agentId,
        failureInjection,
        executionMode
      });
      const spawned = spawnLiveWorker({
        workerScriptPath,
        assignmentPath,
        cwd: workerWorkspace.workspacePath,
        workerMemoryLimitMb,
        outputCaptureBytes
      });
      activeWorkers.set(agentId, {
        shardId: shard.id,
        leaseId: acquisition.lease.leaseId,
        resultPath: assignment.resultPath,
        child: spawned.child,
        spawned,
        stdout: spawned.stdout,
        stderr: spawned.stderr,
        workerWorkspace,
        processed: false,
        assignmentPath,
        startedAtMs: Date.now()
      });
      noteAgentDispatch(agentId);
      observeWorkerSpawn(agentId);
      activeShardIds.add(shard.id);
      leasedShardIds.add(shard.id);
      metrics.workerSpawnCount += 1;
      spawnedThisTick += 1;
      recordWorkerEvent({
        type: 'live_worker_spawned',
        shardId: shard.id,
        agentId,
        leaseId: acquisition.lease.leaseId,
        attempt: acquisition.lease.attempt,
        failureInjection,
        workerWorkspaceMode: workerWorkspace.mode || 'shared',
        contextFootprint: assignment.contextPack?.contextFootprint || null,
        workerRole: assignment.contextPack?.contextGovernor?.hierarchy?.workerRole || null,
        workerModel: assignment.contextPack?.modelTierPlan?.worker?.tier || null,
        promptMode: assignment.contextPack?.modelTierPlan?.worker?.promptMode || null
      });
    }

    await drainReadyPatchQueue();

    if (workerSpawnBudgetRemaining() === false && activeWorkers.size === 0 && patchQueue.queued.length === 0 && readyShards.length > 0) {
      recordWorkerSpawnBudgetExhausted({
        phase: 'scheduler_loop',
        readyShardCount: readyShards.length,
        readyShardIds: readyShards.map((shard) => shard.id).slice(0, 25)
      });
      break;
    }

    const failedShards = detectFailedShards({ shardPlan, patchQueue, leaseState, maxAttemptsPerTask, activeShardIds, leasedShardIds, queuedShardIds });
    if (failedShards.length) {
      const failedShardSignature = failedShards.map((entry) => entry.shardId).sort().join(',');
      if (failedShardSignature !== lastFailedShardSignature) {
        recordWorkerEvent({
          type: activeWorkers.size > 0 ? 'shard_attempts_exhausted_waiting_for_active_workers' : 'shard_attempts_exhausted',
          failedShards,
          activeWorkerCount: activeWorkers.size,
          queuedPatchCount: patchQueue.queued.length,
          readyShardCount: readyShards.length
        });
        lastFailedShardSignature = failedShardSignature;
      }
      if (activeWorkers.size === 0 && patchQueue.queued.length === 0 && readyShards.length === 0) break;
    }

    if (activeWorkers.size === 0 && patchQueue.queued.length === 0 && readyShards.length === 0) {
      const terminalShardIds = new Set([...mergedShardIds(), ...rejectedShardIds()]);
      const remainingShardIds = shardPlan.shards
        .filter((shard) => !terminalShardIds.has(shard.id))
        .map((shard) => shard.id);
      recordWorkerEvent({
        type: 'no_schedulable_work_remaining',
        mergedShardCount: patchQueue.merged.length,
        rejectedShardCount: patchQueue.rejected.length,
        remainingShardCount: remainingShardIds.length,
        remainingShardIds: remainingShardIds.slice(0, 25),
        note: 'All currently schedulable work is either merged or rejected; not retrying no-op/rejected leaves blocks starvation of later ready shards.'
      });
      break;
    }

    if (patchQueue.merged.length === shardPlan.shards.length) break;
    await sleep(pollMs);
  }

  for (const info of activeWorkers.values()) killWorker(info);
  await sleep(10);
  for (const [agentId, info] of [...activeWorkers.entries()]) {
    info.exitCode = info.child.exitCode;
    info.signalCode = info.child.signalCode;
    finalizeResult(agentId, info);
  }

  const finalLandingEvidence = landingEvidenceEnabled
    ? buildSelectedRunLandingEvidence({ repoPath: workspacePath, baseline: landingEvidenceBaseline, patchQueue, policy: landingPolicy })
    : null;
  if (finalLandingEvidence) patchQueue.landingEvidence = finalLandingEvidence;
  const finalClaimLedger = claimLedgerEnabled
    ? buildProofCarryingClaimLedger({ patchQueue })
    : patchQueue.claimLedger || null;
  if (finalClaimLedger) patchQueue.claimLedger = finalClaimLedger;
  const schedulerTruth = buildSchedulerTruthReport({
    schedulerModel,
    workerEvents,
    shardPlan,
    patchQueue,
    requestedAgentCount: agentCount,
    requireProductiveMerges: false
  });
  const supervisor = compileSupervisorSnapshot({ shardPlan, leaseState, patchQueue, artifactBus, now: Date.now(), landingEvidence: finalLandingEvidence, schedulerTruth, claimLedger: finalClaimLedger });
  const failedShards = detectFailedShards({ shardPlan, patchQueue, leaseState, maxAttemptsPerTask });
  const terminalRejectedShardIds = new Set((patchQueue.rejected || []).map((artifact) => artifact.shardId).filter(Boolean));
  const continuityFailures = shardPlan.shards.filter((shard) => {
    const outputs = findArtifacts(artifactBus, { shardId: shard.id }).filter((artifact) => artifact.type === 'shard_output');
    const merges = findArtifacts(artifactBus, { shardId: shard.id }).filter((artifact) => artifact.type === 'patch_merged');
    return outputs.length > 0 && merges.length === 0 && !terminalRejectedShardIds.has(shard.id);
  }).map((shard) => shard.id);

  const summary = {
    generatedAt: new Date().toISOString(),
    executionMode,
    agentCount,
    shardCount: shardPlan.shards.length,
    frontier,
    mergedShardCount: patchQueue.merged.length,
    elapsedMs: Date.now() - startedAt,
    metrics: {
      ...metrics,
      observedAgentCount: observedAgentIds.size,
      observedAgentIds: [...observedAgentIds].sort(),
      peakConcurrentWorkers,
      agentDispatchPolicy: 'prefer_unobserved_then_least_recently_dispatched',
      workerWorkspaceMode: effectiveWorkerWorkspaceMode,
      isolatedWorkerWorkspaces,
      workerWorkspacePromotionEnabled: promoteWorkerWorkspaceChanges,
      maxWorkerSpawns: Number.isFinite(effectiveMaxWorkerSpawns) ? effectiveMaxWorkerSpawns : null,
      workerSpawnBudgetExhausted: Number.isFinite(effectiveMaxWorkerSpawns) && metrics.workerSpawnCount >= effectiveMaxWorkerSpawns && patchQueue.merged.length < shardPlan.shards.length,
      maxAttemptsPerTask,
      failedShards,
      stateLossEvents: continuityFailures.length,
      continuityFailures
    }
  };
  summary.schedulerTruth = schedulerTruth;
  summary.claimLedger = finalClaimLedger;
  summary.contextGovernor = contextGovernorReport;
  summary.metrics.activeWorkerMinutes = schedulerTruth.concurrencyTruth.activeWorkerMinutes;
  summary.metrics.idleGapCount = schedulerTruth.concurrencyTruth.idleGapCount;
  summary.metrics.longestIdleGapMs = schedulerTruth.concurrencyTruth.longestIdleGapMs;
  summary.metrics.medianTimeToNextAssignmentMs = schedulerTruth.concurrencyTruth.medianTimeToNextAssignmentMs;
  const waveFactpack = buildWaveFactPack({ waveNumber: 1, runSummary: summary, patchQueue, workerEvents, contextGovernorReport, previousWaveFactpack });
  saveJson(path.join(runRoot, 'summary.json'), summary);
  saveJson(path.join(runRoot, 'wave_factpack.json'), waveFactpack);
  saveJson(path.join(runRoot, 'worker_events.json'), workerEvents);
  saveJson(path.join(runRoot, 'lease_state.json'), leaseState);
  saveJson(path.join(runRoot, 'patch_queue.json'), patchQueue);
  if (finalLandingEvidence) saveJson(path.join(runRoot, 'landing_evidence.json'), finalLandingEvidence);
  if (finalClaimLedger) saveJson(path.join(runRoot, 'claim_ledger.json'), finalClaimLedger);
  saveJson(path.join(runRoot, 'artifact_bus.json'), artifactBus);
  saveJson(path.join(runRoot, 'scheduler_truth.json'), schedulerTruth);
  saveJson(path.join(runRoot, 'supervisor.json'), supervisor);

  return {
    ok: patchQueue.merged.length === shardPlan.shards.length && supervisor.topLevel.status === 'green' && continuityFailures.length === 0 && failedShards.length === 0,
    executionMode,
    agentCount,
    shardPlan,
    frontier,
    leaseState,
    artifactBus,
    patchQueue,
    landingEvidence: finalLandingEvidence,
    claimLedger: finalClaimLedger,
    schedulerTruth,
    supervisor,
    workerEvents,
    contextGovernor: contextGovernorReport,
    waveFactpack,
    summary,
    metrics: summary.metrics,
    runRoot
  };
}

export async function qualifyLiveScaleTiers({ tiers = [32, 64, 100], workGraph, surfaceMatrix, options = {} }) {
  const results = [];
  for (const tier of tiers) {
    const liveRun = await runLiveWorkerFarm({ workGraph, surfaceMatrix, agentCount: tier, ...options, runRoot: path.join(options.runRoot || process.cwd(), `tier-${String(tier).padStart(3, '0')}`) });
    results.push({
      tier,
      ok: liveRun.ok,
      shardCount: liveRun.shardPlan.shards.length,
      mergedShardCount: liveRun.patchQueue.merged.length,
      supervisorStatus: liveRun.supervisor.topLevel.status,
      recoveryCount: liveRun.metrics.recoveryCount,
      staleLeaseCount: liveRun.metrics.staleLeaseCount,
      stateLossEvents: liveRun.metrics.stateLossEvents,
      executionMode: liveRun.executionMode,
      elapsedMs: liveRun.summary.elapsedMs,
      liveRun
    });
    if (!liveRun.ok) break;
  }

  const passing = results.filter((entry) => entry.ok).map((entry) => entry.tier);
  return {
    generatedAt: new Date().toISOString(),
    tiers: results.map((entry) => ({
      tier: entry.tier,
      ok: entry.ok,
      shardCount: entry.shardCount,
      mergedShardCount: entry.mergedShardCount,
      supervisorStatus: entry.supervisorStatus,
      recoveryCount: entry.recoveryCount,
      staleLeaseCount: entry.staleLeaseCount,
      stateLossEvents: entry.stateLossEvents,
      observedAgentCount: entry.liveRun?.metrics?.observedAgentCount || 0,
      peakConcurrentWorkers: entry.liveRun?.metrics?.peakConcurrentWorkers || 0,
      executionMode: entry.executionMode,
      elapsedMs: entry.elapsedMs
    })),
    highestPassingTier: passing.length ? Math.max(...passing) : null,
    allRequestedTiersPassed: results.length === tiers.length && results.every((entry) => entry.ok),
    rawResults: results
  };
}

export function saveJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return payload;
}

export function loadJson(filePath, fallback = null) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
}
