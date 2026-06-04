#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const DEFAULT_MAILCHIMP_ROOT = path.resolve(path.join(DEFAULT_STACK_ROOT, '..', 'mailchimp-clone'));

const CLIENT_EDITOR_SURFACE = {
  id: 'campaign_editor_client_interaction_layer',
  label: 'Campaign editor rich client interaction layer with draggable canvas, viewport state, duplicate, undo/redo, and serialized state',
  strictGap: 'frontend interaction parity / campaign editor parity',
  productFiles: [
    'apps/web/public/editor-client.mjs',
    'apps/web/public/app-shell.css',
    'packages/app/routes/public.mjs',
    'packages/app/routes/campaigns.mjs'
  ],
  targetedTests: [
    'tests/campaign-editor-client.test.mjs',
    'tests/campaign-editor-depth.test.mjs'
  ],
  requiredAssertions: [
    'client_module_served',
    'campaign_editor_route_adopts_client_canvas',
    'drag_reorder_state_model',
    'duplicate_block_state_model',
    'viewport_preview_state',
    'undo_redo_state_history',
    'serialized_editor_state_available',
    'server_durable_editor_forms_preserved'
  ]
};

const REMAINING_STRICT_GAPS_AFTER_THIS_WAVE = [
  'frontend interaction parity: Phase 12 adds a real campaign editor client module, but the whole app is not yet a Mailchimp-grade full client application',
  'campaign editor parity: Phase 12 adds draggable/undoable client state, but full drag/drop email builder parity still needs deeper visual block inspectors, asset transforms, and browser-backed interaction proof',
  'website builder parity: no visual site designer parity',
  'automation/journey parity: no Mailchimp-grade visual/orchestrated runtime parity',
  'audience/CRM parity: limited identity/lifecycle/warehouse realism',
  'reporting/analytics parity: telemetry remains local rather than production pipeline parity',
  'AI/predictive parity: recommendations still come from local Mailclone provider seams',
  'integration/provider parity: connector auth/sync remains simulated rather than real third-party provider behavior',
  'auth/session/security parity: improved, but full production security program remains unproven',
  'persistence/jobs/operational parity: SQLite wave is product-backed, but broader job-service replacement remains open'
];

function parseArgs(argv) {
  const args = { benchmarkId: 'mailchimp_phase12_client_editor_preflight', stackRoot: DEFAULT_STACK_ROOT, mailchimpRoot: DEFAULT_MAILCHIMP_ROOT, proofMapPath: null, artifactRoot: null };
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
    reason: proof.testsPassed === true && missingProductFiles.length === 0 && missingTargetedTests.length === 0 && missingAssertions.length === 0 ? 'client_editor_product_test_proof_valid' : 'proof_entry_incomplete'
  };
}

const args = parseArgs(process.argv.slice(2));
const proofDoc = args.proofMapPath ? readJson(args.proofMapPath, {}) : {};
const proofMap = normalizeProofMap(proofDoc);
const productEvidence = fileEvidence(args.mailchimpRoot, CLIENT_EDITOR_SURFACE.productFiles);
const testEvidence = fileEvidence(args.mailchimpRoot, CLIENT_EDITOR_SURFACE.targetedTests);
const proof = evaluateProof(CLIENT_EDITOR_SURFACE, proofMap);
const filesPresent = productEvidence.every((entry) => entry.exists) && testEvidence.every((entry) => entry.exists);
const thresholdPass = filesPresent && proof.valid;
const summary = {
  generatedAt: new Date().toISOString(),
  benchmarkId: args.benchmarkId,
  runId: `${args.benchmarkId}-${path.basename(args.artifactRoot).replace(/^bootstrap-/, '')}`,
  artifactRoot: args.artifactRoot,
  targetPath: args.mailchimpRoot,
  fidelity: 'full_clone',
  scope: 'phase12_strict_1to1_campaign_editor_client_interaction_wave',
  implementationSurface: 'primary_product_frontend_editor_architecture',
  strictGap: CLIENT_EDITOR_SURFACE.strictGap,
  thresholdPass,
  globalFullClonePass: false,
  parityStatus: thresholdPass ? 'phase12_client_editor_wave_green_global_strict_ceiling_still_open' : 'phase12_client_editor_wave_red',
  surface: { ...CLIENT_EDITOR_SURFACE, productEvidence, testEvidence, proof },
  blocker: thresholdPass ? null : {
    blocker: 'Campaign editor client interaction wave is not fully product/test proven.',
    nextAction: 'Provide client product files, executable tests, and valid proof map before crediting this strict architecture wave.'
  },
  remainingStrictGaps: REMAINING_STRICT_GAPS_AFTER_THIS_WAVE,
  truthBoundary: 'This scoped wave reduces the frontend/campaign-editor strict blocker with real product evidence. It is not a global Mailchimp full-clone completion claim.'
};
writeJson(path.join(args.artifactRoot, 'completion_summary.json'), summary);
writeJson(path.join(args.artifactRoot, 'surface_matrix.json'), { generatedAt: summary.generatedAt, status: thresholdPass ? 'all_complete_for_scope' : 'partial', surfaces: [summary.surface] });
writeJson(path.join(args.artifactRoot, 'next_work_queue.json'), { generatedAt: summary.generatedAt, count: thresholdPass ? 0 : 1, work: thresholdPass ? [] : [CLIENT_EDITOR_SURFACE] });
console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
