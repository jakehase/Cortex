#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const DEFAULT_MAILCHIMP_ROOT = path.resolve(path.join(DEFAULT_STACK_ROOT, '..', 'mailchimp-clone'));

const DATA_PLANE_SURFACE = {
  id: 'sqlite_persistence_data_plane',
  label: 'SQLite-backed persistence data plane with migrations, write ledger, and app-path adoption',
  strictGap: 'persistence/jobs/operational parity',
  productFiles: [
    'packages/app/storage-sqlite.mjs',
    'packages/app/storage.mjs',
    'packages/app/routes/api-admin.mjs'
  ],
  targetedTests: [
    'tests/sqlite-persistence.test.mjs',
    'tests/persistence-storage.test.mjs'
  ],
  requiredAssertions: [
    'sqlite_storage_engine',
    'migration_ledger',
    'write_ledger',
    'server_restart_persistence',
    'admin_system_app_path_adoption',
    'legacy_json_fallback_preserved'
  ]
};

const REMAINING_STRICT_GAPS_AFTER_THIS_WAVE = [
  'frontend interaction parity: no Mailchimp-grade full client application architecture',
  'campaign editor parity: no rich drag/drop email editor with full interaction parity',
  'website builder parity: no visual site designer parity',
  'automation/journey parity: no Mailchimp-grade visual/orchestrated runtime parity',
  'audience/CRM parity: limited identity/lifecycle/warehouse realism',
  'reporting/analytics parity: telemetry remains local rather than production pipeline parity',
  'AI/predictive parity: recommendations still come from local Mailclone provider seams',
  'integration/provider parity: connector auth/sync remains simulated rather than real third-party provider behavior',
  'auth/session/security parity: improved, but full production security program remains unproven',
  'persistence/jobs/operational parity: SQLite data-plane wave is product-backed, but full external operational/runtime parity still needs broader DB rollout and job-service replacement'
];

function parseArgs(argv) {
  const args = { benchmarkId: 'mailchimp_phase11_sqlite_data_plane_preflight', stackRoot: DEFAULT_STACK_ROOT, mailchimpRoot: DEFAULT_MAILCHIMP_ROOT, proofMapPath: null, artifactRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--benchmark-id') { args.benchmarkId = next; index += 1; continue; }
    if (token === '--stack-root') { args.stackRoot = path.resolve(next); index += 1; continue; }
    if (token === '--mailchimp-root') { args.mailchimpRoot = path.resolve(next); index += 1; continue; }
    if (token === '--proof-map') { args.proofMapPath = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
  }
  if (!args.artifactRoot) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    args.artifactRoot = path.join(args.stackRoot, 'artifacts/benchmarks', args.benchmarkId, `bootstrap-${stamp}`);
  }
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fileEvidence(root, relPaths = []) {
  return relPaths.map((relPath) => {
    const fullPath = path.join(root, relPath);
    const exists = fs.existsSync(fullPath);
    const source = exists ? fs.readFileSync(fullPath, 'utf8') : '';
    return { relPath, exists, bytes: Buffer.byteLength(source), lineCount: source ? source.split('\n').length : 0 };
  });
}

function normalizeProofMap(proofDoc) {
  if (!proofDoc || typeof proofDoc !== 'object') return {};
  if (proofDoc.proofs && typeof proofDoc.proofs === 'object' && !Array.isArray(proofDoc.proofs)) return proofDoc.proofs;
  return proofDoc;
}

function evaluateProof(surface, proofMap) {
  const proof = proofMap[surface.id] || null;
  if (!proof) return { present: false, valid: false, reason: 'missing_proof_entry' };
  const productFiles = new Set(proof.productFiles || []);
  const targetedTests = new Set(proof.targetedTests || []);
  const assertions = Array.isArray(proof.assertions) ? proof.assertions : [];
  const assertionIds = new Set(assertions.map((entry) => typeof entry === 'string' ? entry : entry.id).filter(Boolean));
  const missingProductFiles = surface.productFiles.filter((relPath) => !productFiles.has(relPath));
  const missingTargetedTests = surface.targetedTests.filter((relPath) => !targetedTests.has(relPath));
  const missingAssertions = surface.requiredAssertions.filter((id) => !assertionIds.has(id));
  return {
    present: true,
    valid: proof.testsPassed === true && missingProductFiles.length === 0 && missingTargetedTests.length === 0 && missingAssertions.length === 0,
    testsPassed: proof.testsPassed === true,
    runCommand: proof.runCommand || null,
    artifact: proof.artifact || null,
    missingProductFiles,
    missingTargetedTests,
    missingAssertions,
    assertionCount: assertions.length,
    reason: proof.testsPassed === true && missingProductFiles.length === 0 && missingTargetedTests.length === 0 && missingAssertions.length === 0 ? 'sqlite_data_plane_product_test_proof_valid' : 'proof_entry_incomplete'
  };
}

const args = parseArgs(process.argv.slice(2));
const proofDoc = args.proofMapPath ? readJson(args.proofMapPath, {}) : {};
const proofMap = normalizeProofMap(proofDoc);
const productEvidence = fileEvidence(args.mailchimpRoot, DATA_PLANE_SURFACE.productFiles);
const testEvidence = fileEvidence(args.mailchimpRoot, DATA_PLANE_SURFACE.targetedTests);
const proof = evaluateProof(DATA_PLANE_SURFACE, proofMap);
const filesPresent = productEvidence.every((entry) => entry.exists) && testEvidence.every((entry) => entry.exists);
const thresholdPass = filesPresent && proof.valid;
const summary = {
  generatedAt: new Date().toISOString(),
  benchmarkId: args.benchmarkId,
  runId: `${args.benchmarkId}-${path.basename(args.artifactRoot).replace(/^bootstrap-/, '')}`,
  artifactRoot: args.artifactRoot,
  targetPath: args.mailchimpRoot,
  fidelity: 'full_clone',
  scope: 'phase11_strict_1to1_persistence_data_plane_wave',
  implementationSurface: 'primary_product_persistence_architecture',
  strictGap: DATA_PLANE_SURFACE.strictGap,
  thresholdPass,
  globalFullClonePass: false,
  parityStatus: thresholdPass ? 'phase11_data_plane_wave_green_global_strict_ceiling_still_open' : 'phase11_data_plane_wave_red',
  surface: { ...DATA_PLANE_SURFACE, productEvidence, testEvidence, proof },
  blocker: thresholdPass ? null : {
    blocker: 'SQLite persistence data-plane wave is not fully product/test proven.',
    nextAction: 'Provide product files, executable tests, and a valid proof map before crediting this strict architecture wave.'
  },
  remainingStrictGaps: REMAINING_STRICT_GAPS_AFTER_THIS_WAVE,
  truthBoundary: 'This scoped wave reduces the persistence/data-plane strict blocker with real product evidence. It is not a global Mailchimp full-clone completion claim.'
};
writeJson(path.join(args.artifactRoot, 'completion_summary.json'), summary);
writeJson(path.join(args.artifactRoot, 'surface_matrix.json'), { generatedAt: summary.generatedAt, status: thresholdPass ? 'all_complete_for_scope' : 'partial', surfaces: [summary.surface] });
writeJson(path.join(args.artifactRoot, 'next_work_queue.json'), { generatedAt: summary.generatedAt, count: thresholdPass ? 0 : 1, work: thresholdPass ? [] : [DATA_PLANE_SURFACE] });
console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
