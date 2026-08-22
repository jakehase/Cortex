import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DEFAULT_PRODUCT_EXTENSIONS = /\.(?:mjs|js|jsx|ts|tsx|html|css|json|vue|svelte)$/i;
const DEFAULT_GODOT_PRODUCT_EXTENSIONS = /\.(?:gd|tscn|tres|res|cfg|json|import|shader|material|godot)$/i;
const DEFAULT_GODOT_PRODUCT_PATH_RE = /^(?:project\.godot$|(?:scripts|scenes|ui|assets|autoload|addons|tools\/editor|tools\/qa)\/)/i;
const DEFAULT_EXCLUDED_PATH_RE = /(^|\/)(?:\.git|node_modules|docs?|tests?|__tests__|test|spec|scripts?|artifacts?|benchmarks?|fixtures?|mocks?|coverage|dist|build)\//i;
const DEFAULT_EXCLUDED_FILE_RE = /(?:^|\/)[^/]+\.(?:test|spec|fixture|mock)\.(?:mjs|js|jsx|ts|tsx)$/i;

function nowIso() {
  return new Date().toISOString();
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function stableList(values = []) {
  const input = Array.isArray(values) ? values : [values];
  return [...new Set(input
    .map((value) => String(value || '').trim())
    .filter(Boolean))].sort();
}

function orderedUnique(values = []) {
  const out = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = String(value || '').trim();
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function normalizeRelativePath(value = '') {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!raw || path.isAbsolute(raw) || raw.includes('\0')) return null;
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return null;
  return normalized;
}

function normalizeArea(value = '') {
  const normalized = normalizeRelativePath(value);
  return normalized ? normalized.replace(/\*\*$/g, '').replace(/\*$/g, '').replace(/\/$/, '') : null;
}

function overlapsArea(left, right) {
  const a = normalizeArea(left);
  const b = normalizeArea(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function safeJoin(repoPath, relativePath) {
  const rel = normalizeRelativePath(relativePath);
  if (!rel) return null;
  const root = path.resolve(repoPath || '.');
  const full = path.resolve(root, rel);
  return full === root || !full.startsWith(`${root}${path.sep}`) ? null : full;
}

function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'coverage', 'dist', 'build'].includes(entry.name)) continue;
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function fileHash(fullPath) {
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
}

function readText(fullPath) {
  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch {
    return '';
  }
}

function fileRecord(repoPath, relativePath) {
  const rel = normalizeRelativePath(relativePath);
  const full = rel ? safeJoin(repoPath, rel) : null;
  const exists = Boolean(full && fs.existsSync(full) && fs.statSync(full).isFile());
  const text = exists ? readText(full) : '';
  return {
    path: rel,
    exists,
    hash: exists ? fileHash(full) : null,
    sizeBytes: exists ? fs.statSync(full).size : 0,
    lineCount: exists ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0
  };
}

function gitFact(repoPath, args, fallback = null) {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

export function isProductRuntimeFile(relativePath = '', policy = {}) {
  const rel = normalizeRelativePath(relativePath);
  if (!rel) return false;
  const godotExtensionRe = policy.godotProductExtensionPattern || DEFAULT_GODOT_PRODUCT_EXTENSIONS;
  const godotProductPathRe = policy.godotProductPathPattern || DEFAULT_GODOT_PRODUCT_PATH_RE;
  const godotExcludedPathRe = policy.godotExcludedPathPattern || /(^|\/)(?:\.git|node_modules|docs?|tests?|__tests__|test|spec|artifacts?|benchmarks?|fixtures?|mocks?|coverage|dist|build)\//i;
  if (godotProductPathRe.test(rel) && godotExtensionRe.test(rel)) {
    if (godotExcludedPathRe.test(`${rel}/`)) return false;
    if ((policy.godotExcludedFilePattern || DEFAULT_EXCLUDED_FILE_RE).test(rel)) return false;
    return true;
  }
  const extensionRe = policy.productExtensionPattern || DEFAULT_PRODUCT_EXTENSIONS;
  if (!extensionRe.test(rel)) return false;
  if ((policy.excludedPathPattern || DEFAULT_EXCLUDED_PATH_RE).test(`${rel}/`)) return false;
  if ((policy.excludedFilePattern || DEFAULT_EXCLUDED_FILE_RE).test(rel)) return false;
  return true;
}

function expandProductPath(repoPath, candidate, policy = {}) {
  const rel = normalizeRelativePath(candidate);
  if (!rel) return [];
  const full = safeJoin(repoPath, rel);
  if (!full || !fs.existsSync(full)) return [rel].filter((entry) => isProductRuntimeFile(entry, policy));
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    return walk(full)
      .map((filePath) => path.relative(path.resolve(repoPath), filePath).replace(/\\/g, '/'))
      .filter((entry) => isProductRuntimeFile(entry, policy));
  }
  return isProductRuntimeFile(rel, policy) ? [rel] : [];
}

export function collectProductFiles(repoPath, productPaths = [], policy = {}) {
  const root = path.resolve(repoPath || '.');
  if (!fs.existsSync(root)) return [];
  const explicit = stableList(productPaths);
  if (explicit.length > 0) {
    return stableList(explicit.flatMap((entry) => expandProductPath(root, entry, policy)));
  }
  return stableList(walk(root)
    .map((filePath) => path.relative(root, filePath).replace(/\\/g, '/'))
    .filter((entry) => isProductRuntimeFile(entry, policy)));
}

export function createCanonicalRunBaseline({ repoPath, productPaths = [], policy = {} } = {}) {
  const root = path.resolve(repoPath || '.');
  const files = collectProductFiles(root, productPaths, policy);
  const gitHead = fs.existsSync(path.join(root, '.git')) ? gitFact(root, ['rev-parse', 'HEAD']) : null;
  const gitStatusPorcelain = fs.existsSync(path.join(root, '.git'))
    ? stableList((gitFact(root, ['status', '--porcelain'], '') || '').split('\n').filter(Boolean))
    : [];
  return {
    schemaVersion: 'claw.canonical_run_baseline.v1',
    generatedAt: nowIso(),
    repoPath: root,
    productPaths: stableList(productPaths),
    productFileCount: files.length,
    git: {
      head: gitHead,
      statusPorcelain: gitStatusPorcelain,
      clean: gitHead == null ? null : gitStatusPorcelain.length === 0
    },
    files: Object.fromEntries(files.map((rel) => [rel, fileRecord(root, rel)]))
  };
}

function patchImplementation(patch = {}) {
  return patch.metadata?.implementation || patch.implementation || {};
}

function patchAssignmentTargets(patch = {}) {
  const contract = patch.metadata?.assignmentContract || patch.metadata?.contextPack?.assignmentContract || {};
  const guardrails = patch.metadata?.contextPack?.guardrails || {};
  return stableList([
    ...(contract.targetFiles || []),
    ...(contract.targetModules || []),
    ...(guardrails.allowedFiles || []),
    ...(guardrails.fileAreas || [])
  ]);
}

function patchClaimedFiles(patch = {}) {
  const implementation = patchImplementation(patch);
  const implementationMeta = implementation.metadata || {};
  return stableList([
    ...(patch.filePaths || []),
    ...(implementation.modifiedFiles || []),
    ...(patch.metadata?.modifiedFiles || []),
    ...(patch.metadata?.result?.modifiedFiles || []),
    ...(implementationMeta.modifiedFiles || []),
    implementationMeta.modifiedFile,
    patch.metadata?.modifiedFile
  ].map(normalizeRelativePath).filter(Boolean));
}

function extractAddedLines(diffText = '') {
  const lines = String(diffText || '').split('\n');
  const unifiedAdded = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++'));
  const sourceLines = unifiedAdded.length ? unifiedAdded.map((line) => line.slice(1)) : [];
  return sourceLines.map((line) => line.trim()).filter(Boolean);
}

function normalizeAddedLine(line = '') {
  return String(line || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/["'`]/g, '"')
    .toLowerCase();
}

export function computeAddedLineStats(diffText = '') {
  const addedLines = extractAddedLines(diffText);
  const normalized = addedLines.map(normalizeAddedLine).filter(Boolean);
  const unique = new Set(normalized);
  const duplicateLineInstanceCount = Math.max(0, normalized.length - unique.size);
  return {
    addedLineCount: addedLines.length,
    normalizedAddedLineCount: normalized.length,
    uniqueNormalizedAddedLineCount: unique.size,
    duplicateLineInstanceCount,
    duplicateLineRatio: normalized.length > 0 ? round(duplicateLineInstanceCount / normalized.length, 4) : 0,
    sampleAddedLines: addedLines.slice(0, 12)
  };
}

function patchDiffText(patch = {}) {
  const implementation = patchImplementation(patch);
  const candidates = [
    implementation.diff,
    implementation.unifiedDiff,
    implementation.patch,
    patch.metadata?.implementationDiff,
    patch.metadata?.unifiedDiff,
    patch.metadata?.diff,
    patch.diff,
    patch.unifiedDiff
  ];
  return candidates.map((entry) => String(entry || '').trim()).find(Boolean) || '';
}

function resolveAllowedProductPaths(patch, policy = {}) {
  return stableList([
    ...(policy.allowedProductPaths || []),
    ...(policy.productPaths || []),
    ...patchAssignmentTargets(patch)
  ].map(normalizeRelativePath).filter(Boolean));
}

export function evaluatePatchLandingEvidence(patch = {}, { repoPath, baseline = null, policy = {} } = {}) {
  const root = path.resolve(repoPath || baseline?.repoPath || '.');
  const mode = policy.mode || 'block_on_failed_landing';
  const claimedFiles = patchClaimedFiles(patch);
  const allowedProductPaths = resolveAllowedProductPaths(patch, policy);
  const duplicateLineRatioMax = Number.isFinite(Number(policy.duplicateLineRatioMax)) ? Number(policy.duplicateLineRatioMax) : 0.92;
  const duplicateLineCheckMinAddedLines = Number.isFinite(Number(policy.duplicateLineCheckMinAddedLines)) ? Number(policy.duplicateLineCheckMinAddedLines) : 20;
  const records = claimedFiles.map((rel) => {
    const safe = Boolean(normalizeRelativePath(rel) && safeJoin(root, rel));
    const productRuntimeFile = safe && isProductRuntimeFile(rel, policy);
    const inAllowedProductScope = allowedProductPaths.length === 0 || allowedProductPaths.some((allowedPath) => overlapsArea(rel, allowedPath));
    const before = baseline?.files?.[rel] || { path: rel, exists: false, hash: null, sizeBytes: 0, lineCount: 0 };
    const after = safe ? fileRecord(root, rel) : { path: rel, exists: false, hash: null, sizeBytes: 0, lineCount: 0 };
    const changed = safe && before.hash !== after.hash && (before.exists || after.exists);
    return {
      path: rel,
      safe,
      productRuntimeFile,
      inAllowedProductScope,
      beforeHash: before.hash,
      afterHash: after.hash,
      beforeExists: before.exists === true,
      afterExists: after.exists === true,
      beforeSizeBytes: before.sizeBytes || 0,
      afterSizeBytes: after.sizeBytes || 0,
      changed,
      status: !safe ? 'unsafe_path'
        : !productRuntimeFile ? 'not_product_runtime_file'
          : !inAllowedProductScope ? 'outside_allowed_product_scope'
            : changed ? 'changed' : 'no_change'
    };
  });

  const landedProductFiles = records.filter((entry) => entry.changed && entry.productRuntimeFile && entry.inAllowedProductScope).map((entry) => entry.path);
  const changedOutsideAllowedProductFiles = records.filter((entry) => entry.changed && entry.productRuntimeFile && !entry.inAllowedProductScope).map((entry) => entry.path);
  const unsafePaths = records.filter((entry) => !entry.safe).map((entry) => entry.path);
  const addedLineStats = computeAddedLineStats(patchDiffText(patch));
  const minAddedLineCount = Number.isFinite(Number(policy.minAddedLineCount)) ? Number(policy.minAddedLineCount) : 0;
  const minUniqueNormalizedAddedLineCount = Number.isFinite(Number(policy.minUniqueNormalizedAddedLineCount)) ? Number(policy.minUniqueNormalizedAddedLineCount) : 0;
  const failures = [];
  if (!baseline) failures.push('missing_canonical_baseline');
  if (claimedFiles.length === 0) failures.push('missing_claimed_files');
  if (unsafePaths.length > 0) failures.push('unsafe_claimed_paths');
  if (changedOutsideAllowedProductFiles.length > 0) failures.push('changed_files_outside_allowed_product_scope');
  if (landedProductFiles.length === 0) failures.push('no_landed_product_diff');
  if (minAddedLineCount > 0 && addedLineStats.addedLineCount < minAddedLineCount) failures.push('added_line_count_below_policy');
  if (minUniqueNormalizedAddedLineCount > 0 && addedLineStats.uniqueNormalizedAddedLineCount < minUniqueNormalizedAddedLineCount) failures.push('unique_normalized_added_line_count_below_policy');
  if (addedLineStats.addedLineCount >= duplicateLineCheckMinAddedLines && addedLineStats.duplicateLineRatio > duplicateLineRatioMax) failures.push('duplicate_added_line_ratio_exceeds_policy');

  const eligible = failures.length === 0;
  const rejectionPriority = [
    'missing_canonical_baseline',
    'unsafe_claimed_paths',
    'changed_files_outside_allowed_product_scope',
    'no_landed_product_diff',
    'added_line_count_below_policy',
    'unique_normalized_added_line_count_below_policy',
    'duplicate_added_line_ratio_exceeds_policy'
  ];
  const rejectionReason = rejectionPriority.find((reason) => failures.includes(reason)) || failures[0] || null;

  return {
    schemaVersion: 'claw.canonical_patch_landing_evidence.v1',
    generatedAt: nowIso(),
    mode,
    patchId: patch.id || null,
    shardId: patch.shardId || null,
    taskId: patch.taskId || patch.shardId || null,
    agentId: patch.agentId || null,
    repoPath: root,
    claimedFiles,
    allowedProductPaths,
    landedProductFiles,
    changedOutsideAllowedProductFiles,
    unsafePaths,
    addedLineStats,
    records,
    eligible,
    status: eligible ? 'landed' : 'blocked',
    rejectionCategory: 'canonical_landing',
    rejectionReason,
    failures
  };
}

function diffBaselineToCurrent({ repoPath, baseline, policy = {} } = {}) {
  if (!baseline) return [];
  const root = path.resolve(repoPath || baseline.repoPath || '.');
  const currentFiles = collectProductFiles(root, baseline.productPaths || [], policy);
  const allFiles = stableList([...Object.keys(baseline.files || {}), ...currentFiles]);
  return allFiles.map((rel) => {
    const before = baseline.files?.[rel] || { path: rel, exists: false, hash: null, sizeBytes: 0 };
    const after = fileRecord(root, rel);
    return {
      path: rel,
      beforeHash: before.hash,
      afterHash: after.hash,
      beforeExists: before.exists === true,
      afterExists: after.exists === true,
      changed: before.hash !== after.hash && (before.exists || after.exists),
      productRuntimeFile: isProductRuntimeFile(rel, policy)
    };
  }).filter((entry) => entry.changed && entry.productRuntimeFile);
}

export function buildSelectedRunLandingEvidence({ repoPath, baseline = null, patchQueue = {}, records = [], policy = {} } = {}) {
  const root = path.resolve(repoPath || baseline?.repoPath || '.');
  const queueRecords = [
    ...(patchQueue.merged || []).map((patch) => patch.canonicalLandingRecord || evaluatePatchLandingEvidence(patch, { repoPath: root, baseline, policy })),
    ...(patchQueue.rejected || []).map((patch) => patch.canonicalLandingRecord || evaluatePatchLandingEvidence(patch, { repoPath: root, baseline, policy }))
  ];
  const allRecords = [...queueRecords, ...records].filter(Boolean);
  const creditedRecords = allRecords.filter((record) => record.eligible === true && (patchQueue.merged || []).some((patch) => patch.id === record.patchId));
  const creditedProductFiles = stableList(creditedRecords.flatMap((record) => record.landedProductFiles || []));
  const canonicalChangedProductFiles = diffBaselineToCurrent({ repoPath: root, baseline, policy }).map((entry) => entry.path);
  const uncreditedChangedProductFiles = canonicalChangedProductFiles.filter((filePath) => !creditedProductFiles.includes(filePath));
  const totalAddedLineStats = allRecords.reduce((summary, record) => {
    const stats = record.addedLineStats || {};
    summary.addedLineCount += Number(stats.addedLineCount || 0);
    summary.uniqueNormalizedAddedLineCount += Number(stats.uniqueNormalizedAddedLineCount || 0);
    summary.duplicateLineInstanceCount += Number(stats.duplicateLineInstanceCount || 0);
    summary.maxDuplicateLineRatio = Math.max(summary.maxDuplicateLineRatio, Number(stats.duplicateLineRatio || 0));
    return summary;
  }, { addedLineCount: 0, uniqueNormalizedAddedLineCount: 0, duplicateLineInstanceCount: 0, maxDuplicateLineRatio: 0 });
  totalAddedLineStats.duplicateLineRatio = totalAddedLineStats.addedLineCount > 0
    ? round(totalAddedLineStats.duplicateLineInstanceCount / totalAddedLineStats.addedLineCount, 4)
    : 0;

  const blockedPatchCount = allRecords.filter((record) => record.eligible === false).length;
  const summary = {
    selectedPatchCount: (patchQueue.merged || []).length,
    rejectedPatchCount: (patchQueue.rejected || []).length,
    recordCount: allRecords.length,
    creditedPatchCount: creditedRecords.length,
    blockedPatchCount,
    landedProductFileCount: creditedProductFiles.length,
    creditedProductFiles,
    canonicalChangedProductFileCount: canonicalChangedProductFiles.length,
    canonicalChangedProductFiles,
    uncreditedChangedProductFileCount: uncreditedChangedProductFiles.length,
    uncreditedChangedProductFiles,
    selectedRunProductDeltaPresent: creditedProductFiles.length > 0,
    addedLineStats: totalAddedLineStats,
    status: creditedRecords.length === (patchQueue.merged || []).length && blockedPatchCount === 0 && uncreditedChangedProductFiles.length === 0 ? 'green' : 'red'
  };

  return {
    schemaVersion: 'claw.selected_run_landing_evidence.v1',
    generatedAt: nowIso(),
    repoPath: root,
    baseline: baseline ? {
      generatedAt: baseline.generatedAt,
      repoPath: baseline.repoPath,
      productPathCount: (baseline.productPaths || []).length,
      productFileCount: baseline.productFileCount,
      git: baseline.git || null
    } : null,
    policy: {
      mode: policy.mode || 'block_on_failed_landing',
      duplicateLineRatioMax: Number.isFinite(Number(policy.duplicateLineRatioMax)) ? Number(policy.duplicateLineRatioMax) : 0.92,
      duplicateLineCheckMinAddedLines: Number.isFinite(Number(policy.duplicateLineCheckMinAddedLines)) ? Number(policy.duplicateLineCheckMinAddedLines) : 20,
      minAddedLineCount: Number.isFinite(Number(policy.minAddedLineCount)) ? Number(policy.minAddedLineCount) : 0,
      minUniqueNormalizedAddedLineCount: Number.isFinite(Number(policy.minUniqueNormalizedAddedLineCount)) ? Number(policy.minUniqueNormalizedAddedLineCount) : 0,
      productPaths: stableList(policy.productPaths || [])
    },
    summary,
    records: allRecords
  };
}

export function deriveLandingEligibility(input = {}, policy = {}) {
  const record = input.record || input.landingRecord || (input.schemaVersion === 'claw.canonical_patch_landing_evidence.v1' ? input : null);
  const landingEvidence = input.landingEvidence || input.selectedRunLandingEvidence || null;
  const mode = policy.mode || input.mode || 'block_on_failed_landing';
  if (mode === 'off') return { eligible: true, status: 'not_required', reason: 'canonical_landing_off', mode };
  if (mode === 'audit_only') return { eligible: true, status: 'audit_only', reason: 'canonical_landing_audit_only', mode, record: record || null, landingEvidence };
  if (record) {
    return {
      eligible: record.eligible === true,
      status: record.eligible === true ? 'eligible' : 'blocked',
      reason: record.eligible === true ? 'canonical_landing_confirmed' : record.rejectionReason || 'canonical_landing_failed',
      mode,
      record
    };
  }
  if (landingEvidence) {
    const ok = landingEvidence.summary?.status === 'green' && landingEvidence.summary?.selectedRunProductDeltaPresent === true;
    return {
      eligible: ok,
      status: ok ? 'eligible' : 'blocked',
      reason: ok ? 'selected_run_landing_green' : `selected_run_landing_${landingEvidence.summary?.status || 'missing'}`,
      mode,
      landingEvidence
    };
  }
  return { eligible: false, status: 'blocked', reason: 'missing_canonical_landing_record', mode };
}
