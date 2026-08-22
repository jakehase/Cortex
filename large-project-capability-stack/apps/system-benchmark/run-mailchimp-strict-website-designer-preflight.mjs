#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const DEFAULT_MAILCHIMP_ROOT = path.resolve(path.join(DEFAULT_STACK_ROOT, '..', 'mailchimp-clone'));

const WEBSITE_DESIGNER_SURFACE = {
  id: 'website_builder_visual_designer_layer',
  label: 'Website builder visual designer layer with site-map reorder, page duplication, theme edits, responsive preview, undo/redo, and serialized state',
  strictGap: 'website builder parity / frontend interaction parity',
  productFiles: [
    'apps/web/public/website-designer-client.mjs',
    'apps/web/public/app-shell.css',
    'packages/app/routes/public.mjs',
    'packages/app/routes/website-builder.mjs'
  ],
  targetedTests: [
    'tests/website-designer-client.test.mjs',
    'tests/current-product-parity.test.mjs'
  ],
  requiredAssertions: [
    'website_designer_module_served',
    'website_builder_route_adopts_visual_designer',
    'site_map_reorder_state_model',
    'duplicate_page_state_model',
    'theme_update_state_model',
    'responsive_preview_state',
    'undo_redo_state_history',
    'serialized_designer_state_available',
    'durable_website_forms_preserved'
  ]
};

const REMAINING_STRICT_GAPS_AFTER_THIS_WAVE = [
  'frontend interaction parity: client modules now exist for campaign editor and website designer, but the whole app is not yet a Mailchimp-grade full client application',
  'campaign editor parity: full drag/drop email builder parity still needs deeper visual block inspectors, asset transforms, and browser-backed interaction proof',
  'website builder parity: Phase 13 adds visual designer state, but full site designer parity still needs richer visual editing, asset layout transforms, and browser proof',
  'automation/journey parity: no Mailchimp-grade visual/orchestrated runtime parity',
  'audience/CRM parity: limited identity/lifecycle/warehouse realism',
  'reporting/analytics parity: telemetry remains local rather than production pipeline parity',
  'AI/predictive parity: recommendations still come from local Mailclone provider seams',
  'integration/provider parity: connector auth/sync remains simulated rather than real third-party provider behavior',
  'auth/session/security parity: improved, but full production security program remains unproven',
  'persistence/jobs/operational parity: SQLite wave is product-backed, but broader job-service replacement remains open'
];

function parseArgs(argv) {
  const args = { benchmarkId: 'mailchimp_phase13_website_designer_preflight', stackRoot: DEFAULT_STACK_ROOT, mailchimpRoot: DEFAULT_MAILCHIMP_ROOT, proofMapPath: null, artifactRoot: null };
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

function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); }
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
    reason: proof.testsPassed === true && missingProductFiles.length === 0 && missingTargetedTests.length === 0 && missingAssertions.length === 0 ? 'website_designer_product_test_proof_valid' : 'proof_entry_incomplete'
  };
}

const args = parseArgs(process.argv.slice(2));
const proofDoc = args.proofMapPath ? readJson(args.proofMapPath, {}) : {};
const proofMap = normalizeProofMap(proofDoc);
const productEvidence = fileEvidence(args.mailchimpRoot, WEBSITE_DESIGNER_SURFACE.productFiles);
const testEvidence = fileEvidence(args.mailchimpRoot, WEBSITE_DESIGNER_SURFACE.targetedTests);
const proof = evaluateProof(WEBSITE_DESIGNER_SURFACE, proofMap);
const filesPresent = productEvidence.every((entry) => entry.exists) && testEvidence.every((entry) => entry.exists);
const thresholdPass = filesPresent && proof.valid;
const summary = {
  generatedAt: new Date().toISOString(),
  benchmarkId: args.benchmarkId,
  runId: `${args.benchmarkId}-${path.basename(args.artifactRoot).replace(/^bootstrap-/, '')}`,
  artifactRoot: args.artifactRoot,
  targetPath: args.mailchimpRoot,
  fidelity: 'full_clone',
  scope: 'phase13_strict_1to1_website_builder_visual_designer_wave',
  implementationSurface: 'primary_product_website_frontend_architecture',
  strictGap: WEBSITE_DESIGNER_SURFACE.strictGap,
  thresholdPass,
  globalFullClonePass: false,
  parityStatus: thresholdPass ? 'phase13_website_designer_wave_green_global_strict_ceiling_still_open' : 'phase13_website_designer_wave_red',
  surface: { ...WEBSITE_DESIGNER_SURFACE, productEvidence, testEvidence, proof },
  blocker: thresholdPass ? null : { blocker: 'Website visual designer wave is not fully product/test proven.', nextAction: 'Provide website designer product files, executable tests, and valid proof map before crediting this strict architecture wave.' },
  remainingStrictGaps: REMAINING_STRICT_GAPS_AFTER_THIS_WAVE,
  truthBoundary: 'This scoped wave reduces the website-builder/frontend strict blocker with real product evidence. It is not a global Mailchimp full-clone completion claim.'
};
writeJson(path.join(args.artifactRoot, 'completion_summary.json'), summary);
writeJson(path.join(args.artifactRoot, 'surface_matrix.json'), { generatedAt: summary.generatedAt, status: thresholdPass ? 'all_complete_for_scope' : 'partial', surfaces: [summary.surface] });
writeJson(path.join(args.artifactRoot, 'next_work_queue.json'), { generatedAt: summary.generatedAt, count: thresholdPass ? 0 : 1, work: thresholdPass ? [] : [WEBSITE_DESIGNER_SURFACE] });
console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
