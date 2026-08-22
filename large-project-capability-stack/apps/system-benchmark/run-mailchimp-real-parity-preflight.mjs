#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const DEFAULT_MAILCHIMP_ROOT = path.resolve(path.join(DEFAULT_STACK_ROOT, '..', 'mailchimp-clone'));

function parseArgs(argv) {
  const args = {
    benchmarkId: 'mailchimp_phase9_real_parity_preflight',
    stackRoot: DEFAULT_STACK_ROOT,
    mailchimpRoot: DEFAULT_MAILCHIMP_ROOT,
    artifactRoot: null,
    canonicalMatrixPath: null,
    strictContractPath: null,
    proofMapPath: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--benchmark-id') { args.benchmarkId = next; index += 1; continue; }
    if (token === '--stack-root') { args.stackRoot = path.resolve(next); index += 1; continue; }
    if (token === '--mailchimp-root') { args.mailchimpRoot = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--canonical-matrix') { args.canonicalMatrixPath = path.resolve(next); index += 1; continue; }
    if (token === '--strict-contract') { args.strictContractPath = path.resolve(next); index += 1; continue; }
    if (token === '--proof-map') { args.proofMapPath = path.resolve(next); index += 1; continue; }
  }
  if (!args.artifactRoot) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    args.artifactRoot = path.join(args.stackRoot, 'artifacts/benchmarks', args.benchmarkId, `bootstrap-${stamp}`);
  }
  args.canonicalMatrixPath ||= path.join(args.mailchimpRoot, 'docs/MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json');
  args.strictContractPath ||= path.join(args.mailchimpRoot, 'strict_1to1_contract.json');
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function safeRead(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return ''; }
}

function hasPlaceholderLanguage(source = '') {
  return [
    /\bcoming soon\b/i,
    /\bnot implemented\b/i,
    /\b(todo|fixme)\b/i,
    /\b(stub|mock|fake|simulated)\b/i,
    /placeholder\s+(implementation|only|copy|data|route|surface|module)/i
  ].some((pattern) => pattern.test(source));
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'surface';
}

function classifyProofKinds(surface = {}, text = '') {
  const haystack = `${surface.id || ''} ${surface.label || ''} ${surface.purpose || ''} ${(surface.product_files || []).join(' ')} ${text}`.toLowerCase();
  const kinds = new Set(['product_diff', 'functional']);
  if (/route|view|wizard|dashboard|editor|builder|template|landing|form|signup|popup|browser|ui|page|frontend/.test(haystack)) kinds.add('browser_ui');
  if (/data|database|db|persistence|migration|storage|warehouse|crm|contact|audience|import|export|profile/.test(haystack)) kinds.add('db_persistence');
  if (/job|queue|delivery|send|schedule|automation|journey|workflow|backfill|worker|batch/.test(haystack)) kinds.add('job_event');
  if (/integration|oauth|webhook|provider|marketplace|ecommerce|commerce|partner|api key|api_keys/.test(haystack)) kinds.add('provider_integration');
  if (/analytics|report|metric|telemetry|attribution|experiment|forecast|predictive|insight/.test(haystack)) kinds.add('analytics_telemetry');
  if (/auth|security|permission|role|csrf|sso|compliance|privacy|billing|account|session/.test(haystack)) kinds.add('security_policy');
  return Array.from(kinds).sort();
}

function classifyLane(surface = {}, text = '') {
  const kinds = classifyProofKinds(surface, text);
  if (kinds.includes('provider_integration')) return 'integrations_api_oauth';
  if (kinds.includes('analytics_telemetry')) return 'reporting_analytics';
  if (kinds.includes('job_event')) return 'jobs_delivery_automation';
  if (kinds.includes('db_persistence')) return 'data_model_persistence';
  if (kinds.includes('security_policy')) return 'security_account_enterprise';
  if (kinds.includes('browser_ui')) return 'frontend_product_experience';
  return 'domain_product_depth';
}

function fileEvidence(root, relPaths = []) {
  return relPaths.map((relPath) => {
    const fullPath = path.join(root, relPath);
    const source = safeRead(fullPath);
    return {
      relPath,
      exists: fs.existsSync(fullPath),
      bytes: Buffer.byteLength(source),
      lineCount: source ? source.split('\n').length : 0,
      hasPlaceholderLanguage: hasPlaceholderLanguage(source)
    };
  });
}

function buildProofEntries(proofMap) {
  const entries = Array.isArray(proofMap?.leafProofs) ? proofMap.leafProofs : [];
  return new Map(entries.map((entry) => [entry.leafId || entry.id, entry]).filter(([id]) => Boolean(id)));
}

function evaluateLeafProof({ leafId, proofEntry, productFiles = [], targetedTests = [], proofKinds = [] }) {
  if (!proofEntry) return { ok: false, blockers: [{ kind: 'leaf_proof_missing', leafId }] };
  const blockers = [];
  if (proofEntry.status !== 'green') blockers.push({ kind: 'leaf_proof_not_green', actual: proofEntry.status || 'unknown' });
  if (proofEntry.testStatus !== 'pass' && proofEntry.testCommandExitCode !== 0) blockers.push({ kind: 'leaf_proof_tests_not_passed', actual: proofEntry.testStatus || proofEntry.testCommandExitCode });
  const entryProductFiles = new Set(proofEntry.productFiles || []);
  const entryTests = new Set(proofEntry.targetedTests || []);
  const entryProofKinds = new Set(proofEntry.proofKinds || []);
  const missingProductDiffFiles = productFiles.filter((relPath) => !entryProductFiles.has(relPath));
  const missingTargetedTestProof = targetedTests.filter((relPath) => !entryTests.has(relPath));
  const missingProofKinds = proofKinds.filter((kind) => !entryProofKinds.has(kind));
  if (missingProductDiffFiles.length) blockers.push({ kind: 'leaf_proof_missing_product_files', files: missingProductDiffFiles });
  if (missingTargetedTestProof.length) blockers.push({ kind: 'leaf_proof_missing_targeted_tests', files: missingTargetedTestProof });
  if (missingProofKinds.length) blockers.push({ kind: 'leaf_proof_missing_kinds', proofKinds: missingProofKinds });
  if (!Array.isArray(proofEntry.assertions) || proofEntry.assertions.length === 0) blockers.push({ kind: 'leaf_proof_missing_assertions' });
  return { ok: blockers.length === 0, blockers };
}

function buildLeafSurfaces({ matrix, mailchimpRoot, proofEntries }) {
  const surfaces = Array.isArray(matrix?.surfaces) ? matrix.surfaces : [];
  const leaves = [];
  for (const surface of surfaces) {
    const requiredWork = Array.isArray(surface.required_work) && surface.required_work.length
      ? surface.required_work
      : [`Close remaining parity gap for ${surface.label || surface.id}.`];
    requiredWork.forEach((work, index) => {
      const fileChecks = fileEvidence(mailchimpRoot, surface.product_files || []);
      const testChecks = fileEvidence(mailchimpRoot, surface.targeted_tests || []);
      const proofKinds = classifyProofKinds(surface, work);
      const missingFiles = fileChecks.filter((entry) => !entry.exists).map((entry) => entry.relPath);
      const missingTests = testChecks.filter((entry) => !entry.exists).map((entry) => entry.relPath);
      const placeholderFiles = fileChecks.filter((entry) => entry.hasPlaceholderLanguage).map((entry) => entry.relPath);
      const leafId = `${slug(surface.id)}__req_${String(index + 1).padStart(2, '0')}`;
      const proofEvaluation = evaluateLeafProof({ leafId, proofEntry: proofEntries.get(leafId), productFiles: surface.product_files || [], targetedTests: surface.targeted_tests || [], proofKinds });
      const blockers = [];
      if (missingFiles.length) blockers.push({ kind: 'missing_product_file', files: missingFiles });
      if (missingTests.length) blockers.push({ kind: 'missing_targeted_test', files: missingTests });
      if (placeholderFiles.length) blockers.push({ kind: 'placeholder_language_present', files: placeholderFiles });
      if (!proofEvaluation.ok) blockers.push(...proofEvaluation.blockers, { kind: 'required_work_not_proven_complete', detail: work });
      leaves.push({
        id: leafId,
        parentSurfaceId: surface.id,
        label: `${surface.label || surface.id} — requirement ${index + 1}`,
        canonicalSurfaceStatus: surface.status || 'unknown',
        confidence: surface.confidence || null,
        lane: classifyLane(surface, work),
        requiredWork: work,
        productFiles: surface.product_files || [],
        targetedTests: surface.targeted_tests || [],
        proofKinds,
        evidence: {
          productFiles: fileChecks,
          targetedTests: testChecks,
          openGapFamilies: surface.open_gap_families || []
        },
        status: blockers.length === 0 ? 'green' : 'red',
        proof: proofEvaluation.ok ? proofEntries.get(leafId) : null,
        blockers
      });
    });
    for (const family of surface.open_gap_families || []) {
      const leafId = `${slug(surface.id)}__gap_${slug(family)}`;
      const productFiles = surface.product_files || [];
      const targetedTests = surface.targeted_tests || [];
      const proofKinds = classifyProofKinds(surface, family);
      const fileChecks = fileEvidence(mailchimpRoot, productFiles);
      const testChecks = fileEvidence(mailchimpRoot, targetedTests);
      const missingFiles = fileChecks.filter((entry) => !entry.exists).map((entry) => entry.relPath);
      const missingTests = testChecks.filter((entry) => !entry.exists).map((entry) => entry.relPath);
      const placeholderFiles = fileChecks.filter((entry) => entry.hasPlaceholderLanguage).map((entry) => entry.relPath);
      const proofEvaluation = evaluateLeafProof({ leafId, proofEntry: proofEntries.get(leafId), productFiles, targetedTests, proofKinds });
      const blockers = [];
      if (missingFiles.length) blockers.push({ kind: 'missing_product_file', files: missingFiles });
      if (missingTests.length) blockers.push({ kind: 'missing_targeted_test', files: missingTests });
      if (placeholderFiles.length) blockers.push({ kind: 'placeholder_language_present', files: placeholderFiles });
      if (!proofEvaluation.ok) blockers.push(...proofEvaluation.blockers, { kind: 'open_gap_family_not_proven_complete', family });
      leaves.push({
        id: leafId,
        parentSurfaceId: surface.id,
        label: `${surface.label || surface.id} — ${family}`,
        canonicalSurfaceStatus: surface.status || 'unknown',
        confidence: surface.confidence || null,
        lane: classifyLane(surface, family),
        requiredWork: `Resolve open gap family: ${family}`,
        productFiles,
        targetedTests,
        proofKinds,
        evidence: {
          productFiles: fileChecks,
          targetedTests: testChecks,
          openGapFamilies: [family]
        },
        status: blockers.length === 0 ? 'green' : 'red',
        proof: proofEvaluation.ok ? proofEntries.get(leafId) : null,
        blockers
      });
    }
  }
  return leaves;
}

function groupCount(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function topRedWorkQueue(leaves, limit = 100) {
  return leaves.slice(0, limit).map((leaf) => ({
    id: leaf.id,
    parentSurfaceId: leaf.parentSurfaceId,
    lane: leaf.lane,
    productGoal: leaf.requiredWork,
    allowedFiles: leaf.productFiles,
    targetedTests: leaf.targetedTests,
    proofKinds: leaf.proofKinds,
    stopCondition: 'leaf_surface_proven_green_or_blocker_report'
  }));
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
fs.mkdirSync(args.artifactRoot, { recursive: true });

const matrix = readJson(args.canonicalMatrixPath, null);
const strictContract = readJson(args.strictContractPath, null);
const proofMap = args.proofMapPath ? readJson(args.proofMapPath, null) : null;
const proofEntries = buildProofEntries(proofMap);
const missingInputs = [];
if (!matrix) missingInputs.push(args.canonicalMatrixPath);
if (!strictContract) missingInputs.push(args.strictContractPath);
if (args.proofMapPath && !proofMap) missingInputs.push(args.proofMapPath);

const canonicalSurfaces = Array.isArray(matrix?.surfaces) ? matrix.surfaces : [];
const leafSurfaces = matrix ? buildLeafSurfaces({ matrix, mailchimpRoot: args.mailchimpRoot, proofEntries }) : [];
const redLeafSurfaces = leafSurfaces.filter((leaf) => leaf.status !== 'green');
const greenLeafSurfaces = leafSurfaces.filter((leaf) => leaf.status === 'green');
const productFiles = Array.from(new Set(canonicalSurfaces.flatMap((surface) => surface.product_files || []))).sort();
const targetedTests = Array.from(new Set(canonicalSurfaces.flatMap((surface) => surface.targeted_tests || []))).sort();
const productFileEvidence = fileEvidence(args.mailchimpRoot, productFiles);
const targetedTestEvidence = fileEvidence(args.mailchimpRoot, targetedTests);
const missingProductFiles = productFileEvidence.filter((entry) => !entry.exists).map((entry) => entry.relPath);
const missingTargetedTests = targetedTestEvidence.filter((entry) => !entry.exists).map((entry) => entry.relPath);
const placeholderProductFiles = productFileEvidence.filter((entry) => entry.hasPlaceholderLanguage).map((entry) => entry.relPath);

const inventoryReady = missingInputs.length === 0 && canonicalSurfaces.length > 0 && leafSurfaces.length > 0;
const fullCloneParityGreen = inventoryReady && redLeafSurfaces.length === 0 && missingProductFiles.length === 0 && missingTargetedTests.length === 0 && placeholderProductFiles.length === 0;
const elapsedMs = Date.now() - startedAt;

const inventory = {
  schemaVersion: 'clawd.mailchimp.real_parity_inventory.v1',
  generatedAt: new Date().toISOString(),
  benchmarkId: args.benchmarkId,
  fidelity: 'full_clone',
  source: {
    canonicalMatrixPath: args.canonicalMatrixPath,
    strictContractPath: args.strictContractPath,
    proofMapPath: args.proofMapPath,
    mailchimpRoot: args.mailchimpRoot
  },
  inventoryCompleteness: 'phase9_seed_from_canonical_audit_and_strict_contract',
  negativeSpacePolicy: 'unknown_or_uninventoried_real_mailchimp_surfaces_are_red_until_explicitly_mapped',
  canonicalSurfaceCount: canonicalSurfaces.length,
  leafSurfaceCount: leafSurfaces.length,
  greenLeafSurfaceCount: greenLeafSurfaces.length,
  redLeafSurfaceCount: redLeafSurfaces.length,
  proofMapStatus: proofMap ? (proofMap.status || 'present') : 'not_provided',
  proofLeafCount: proofEntries.size,
  lanes: groupCount(leafSurfaces.map((leaf) => leaf.lane)),
  proofKinds: groupCount(leafSurfaces.flatMap((leaf) => leaf.proofKinds)),
  productFiles: productFileEvidence,
  targetedTests: targetedTestEvidence,
  missingProductFiles,
  missingTargetedTests,
  placeholderProductFiles,
  leafSurfaces,
  nextWorkQueue: topRedWorkQueue(redLeafSurfaces, 100)
};

const blocker = fullCloneParityGreen ? null : {
  blocker: inventoryReady
    ? 'Phase 9 real Mailchimp parity inventory is built, but full-clone parity remains red.'
    : 'Phase 9 real Mailchimp parity inventory could not be built from the required source artifacts.',
  blockerKind: inventoryReady ? 'real_mailchimp_full_clone_matrix_red' : 'phase9_inventory_inputs_missing',
  nextAction: inventoryReady
    ? 'Launch bounded real-product parity work against nextWorkQueue, require product diffs plus browser/functional/DB/job/integration/security/analytics proof per leaf, and keep unknown surfaces red.'
    : 'Restore the canonical parity matrix and strict 1:1 contract, then rerun this preflight.',
  missingInputs,
  greenLeafSurfaceCount: greenLeafSurfaces.length,
  redLeafSurfaceCount: redLeafSurfaces.length,
  missingProductFiles,
  missingTargetedTests,
  placeholderProductFiles
};

const completion = {
  generatedAt: new Date().toISOString(),
  benchmarkId: args.benchmarkId,
  runId: `${args.benchmarkId}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}`,
  artifactRoot: args.artifactRoot,
  targetPath: args.mailchimpRoot,
  fidelity: 'full_clone',
  scope: 'phase9_real_mailchimp_parity_inventory_and_preflight',
  stopCondition: 'inventory_ready_with_full_clone_green_or_blocker_report',
  implementationSurface: 'benchmark_control_plane_inventory_preflight',
  thresholdPass: fullCloneParityGreen,
  mechanicalGreen: inventoryReady,
  scaleProofReady: false,
  inventoryReady,
  parityStatus: fullCloneParityGreen ? 'full' : 'not_full_clone',
  matrixStatus: fullCloneParityGreen ? 'all_complete' : 'red',
  canonicalSurfaceCount: canonicalSurfaces.length,
  leafSurfaceCount: leafSurfaces.length,
  greenLeafSurfaceCount: greenLeafSurfaces.length,
  redLeafSurfaceCount: redLeafSurfaces.length,
  nextWorkQueueCount: inventory.nextWorkQueue.length,
  durationMinutes: Number((elapsedMs / 60000).toFixed(2)),
  blocker
};

const thresholdEvaluation = {
  generatedAt: new Date().toISOString(),
  thresholdPass: completion.thresholdPass,
  ok: completion.thresholdPass,
  benchmarkTier: 'phase9_full_clone_preflight',
  failures: completion.thresholdPass ? [] : [{ metric: 'fullCloneParityGreen', actual: false, requirement: '= true', reason: blocker?.blockerKind || 'full_clone_matrix_red' }],
  metrics: {
    inventoryReady,
    canonicalSurfaceCount: canonicalSurfaces.length,
    leafSurfaceCount: leafSurfaces.length,
    greenLeafSurfaceCount: greenLeafSurfaces.length,
    redLeafSurfaceCount: redLeafSurfaces.length,
    missingProductFileCount: missingProductFiles.length,
    missingTargetedTestCount: missingTargetedTests.length,
    placeholderProductFileCount: placeholderProductFiles.length
  }
};

writeJson(path.join(args.artifactRoot, 'real_parity_inventory.json'), inventory);
writeJson(path.join(args.artifactRoot, 'surface_matrix.json'), {
  schemaVersion: 'clawd.mailchimp.phase9_surface_matrix.v1',
  generatedAt: new Date().toISOString(),
  status: fullCloneParityGreen ? 'all_complete' : 'red',
  surfaces: leafSurfaces
});
writeJson(path.join(args.artifactRoot, 'next_work_queue.json'), {
  generatedAt: new Date().toISOString(),
  count: inventory.nextWorkQueue.length,
  work: inventory.nextWorkQueue
});
writeJson(path.join(args.artifactRoot, 'completion_summary.json'), completion);
writeJson(path.join(args.artifactRoot, 'threshold_evaluation.json'), thresholdEvaluation);
writeJson(path.join(args.artifactRoot, 'program_state.json'), {
  schemaVersion: 'clawd.mailchimp.phase9_program_state.v1',
  generatedAt: new Date().toISOString(),
  status: completion.thresholdPass ? 'passed' : 'blocked',
  done: true,
  stopAllowed: true,
  stopReason: completion.thresholdPass ? 'full_clone_matrix_green' : 'phase9_preflight_blocker_report_written',
  summary: completion.thresholdPass ? 'Phase 9 full-clone matrix is green.' : blocker.blocker
});
if (blocker) writeJson(path.join(args.artifactRoot, 'blocker_report.json'), { generatedAt: new Date().toISOString(), benchmarkId: args.benchmarkId, status: 'blocked', phase: 'phase9_real_mailchimp_parity_preflight', ...blocker });

console.log(JSON.stringify({
  ok: completion.mechanicalGreen,
  thresholdPass: completion.thresholdPass,
  inventoryReady: completion.inventoryReady,
  parityStatus: completion.parityStatus,
  canonicalSurfaceCount: completion.canonicalSurfaceCount,
  leafSurfaceCount: completion.leafSurfaceCount,
  greenLeafSurfaceCount: completion.greenLeafSurfaceCount,
  redLeafSurfaceCount: completion.redLeafSurfaceCount,
  nextWorkQueueCount: completion.nextWorkQueueCount,
  artifactRoot: args.artifactRoot,
  blocker
}, null, 2));

process.exit(completion.mechanicalGreen ? 0 : 1);
