import fs from 'node:fs';
import path from 'node:path';
import { MAILCHIMP_CANONICAL_ONE_PASS_PLAN as CANONICAL_ONE_PASS_PLAN } from './mailchimp-canonical-one-pass-plan-data.mjs';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const PRODUCT_ONLY_OVERRIDE = String(process.env.MAILCHIMP_PRODUCT_ONLY || '').trim();
const IMPLEMENTATION_PROFILE = String(process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE || '').trim();
export const PRODUCT_ONLY_MODE = PRODUCT_ONLY_OVERRIDE === '0'
  ? false
  : PRODUCT_ONLY_OVERRIDE === '1'
    ? true
    : IMPLEMENTATION_PROFILE === 'mailchimp_parity_focus'
      ? true
      : true;
const CURRENT_PRODUCT_GAP_MATRIX_PATH = path.join(ROOT, 'docs', 'MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json');
const STRICT_GAP_INVENTORY_PATH = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'strict_1to1_gap_inventory.json');
const DEFAULT_BENCHMARK_CONTRACT_PATH = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'one_pass_run_contract.latest.json');

function resolveBenchmarkContractPath() {
  return process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH
    ? path.resolve(ROOT, process.env.MAILCHIMP_ONE_PASS_CONTRACT_PATH)
    : DEFAULT_BENCHMARK_CONTRACT_PATH;
}

function readStrictGapJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function canonicalizeFocusId(value) {
  const normalized = String(value || '').trim();
  if (!normalized.startsWith('focus.')) return '';
  return normalized.replace(/#.+$/, '');
}

export function normalizeFocusIds(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => canonicalizeFocusId(value))
    .filter(Boolean)));
}

function canonicalSurfaceFocusId(surface) {
  return canonicalizeFocusId(`focus.${String(surface?.id || '').trim()}`);
}

function surfaceEquivalenceSignature(surface) {
  const productFiles = Array.from(new Set((surface?.productFiles || []).map((entry) => String(entry || '').trim()).filter(Boolean))).sort();
  const targetedTests = Array.from(new Set((surface?.targetedTests || []).map((entry) => String(entry || '').trim()).filter(Boolean))).sort();
  return JSON.stringify({ productFiles, targetedTests });
}

function surfaceCollisionSignature(surface) {
  return JSON.stringify({ productFiles: surfaceProductFiles(surface) });
}

function surfaceProductFiles(surface) {
  return Array.from(new Set((surface?.productFiles || []).map((entry) => String(entry || '').trim()).filter(Boolean))).sort();
}

function buildSurfaceGroupMap(signatureResolver) {
  const groups = new Map();
  for (const surface of CANONICAL_ONE_PASS_PLAN.surfaceChecklist || []) {
    const focusId = canonicalSurfaceFocusId(surface);
    if (!focusId) continue;
    const signature = signatureResolver(surface);
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(focusId);
  }
  const mapping = new Map();
  for (const focusIds of groups.values()) {
    const normalizedFocusIds = normalizeFocusIds(focusIds);
    for (const focusId of normalizedFocusIds) mapping.set(focusId, normalizedFocusIds);
  }
  return mapping;
}

const SURFACE_EQUIVALENCE_BY_FOCUS_ID = buildSurfaceGroupMap(surfaceEquivalenceSignature);
const SURFACE_COLLISION_BY_FOCUS_ID = buildSurfaceGroupMap(surfaceCollisionSignature);
const SURFACE_PRODUCT_FILES_BY_FOCUS_ID = new Map((CANONICAL_ONE_PASS_PLAN.surfaceChecklist || []).flatMap((surface) => {
  const focusId = canonicalSurfaceFocusId(surface);
  return focusId ? [[focusId, surfaceProductFiles(surface)]] : [];
}));

function benchmarkScopeEnabled() {
  return String(process.env.MAILCHIMP_USE_BENCHMARK_SCOPE || '').trim() === '1';
}

function benchmarkScopeCarriesCompletedFocusIds(contract = readBenchmarkContract()) {
  const requested = String(process.env.MAILCHIMP_BENCHMARK_CARRY_COMPLETED_FOCUS_IDS || '').trim();
  if (requested === '1') return true;
  if (requested === '0') return false;
  const benchmarkId = String(contract?.benchmarkId || '').trim();
  return [
    'mailchimp_substantial_canonical_parity_expansion_gate',
    'mailchimp_production_creation_gate'
  ].includes(benchmarkId);
}

function readBenchmarkContract() {
  try {
    return JSON.parse(fs.readFileSync(resolveBenchmarkContractPath(), 'utf8'));
  } catch {
    return null;
  }
}

function verificationCommandTestFiles(commands = []) {
  return Array.from(new Set((Array.isArray(commands) ? commands : [])
    .flatMap((command) => String(command || '').match(/tests\/[^\s'"`]+\.test\.mjs/g) || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function benchmarkScopeSurfaces() {
  if (!benchmarkScopeEnabled()) return [];
  const contract = readBenchmarkContract();
  const surfaces = Array.isArray(contract?.scope?.surfaces) ? contract.scope.surfaces : [];
  return surfaces
    .map((surface) => {
      const id = String(surface?.id || '').trim();
      const label = String(surface?.label || '').trim();
      const lane = String(surface?.lane || '').trim() || 'benchmark_scope';
      const focusGroup = String(surface?.focusGroup || surface?.implementationFamily || '').trim();
      const allowedFiles = Array.from(new Set((surface?.allowedFiles || []).map((entry) => String(entry || '').trim()).filter(Boolean)));
      const targetedTests = verificationCommandTestFiles(surface?.verification || []);
      if (!id || !label || allowedFiles.length === 0) return null;
      return {
        id,
        label,
        lane,
        focusGroup,
        focusId: canonicalizeFocusId(`focus.${id}`),
        allowedFiles,
        targetedTests,
        verification: Array.isArray(surface?.verification) ? surface.verification : []
      };
    })
    .filter(Boolean);
}

function focusProductFiles(focusId) {
  const benchmarkSurface = benchmarkScopeSurfaces().find((surface) => surface.focusId === focusId);
  if (benchmarkSurface) return benchmarkSurface.allowedFiles;
  return SURFACE_PRODUCT_FILES_BY_FOCUS_ID.get(focusId) || [];
}

export function expandEquivalentFocusIds(values = []) {
  const normalizedFocusIds = normalizeFocusIds(values);
  return normalizeFocusIds(normalizedFocusIds.flatMap((focusId) => SURFACE_EQUIVALENCE_BY_FOCUS_ID.get(focusId) || [focusId]));
}

export function selectNonOverlappingFocusIds(values = []) {
  const normalizedFocusIds = normalizeFocusIds(values);
  const selectedFocusIds = [];
  const claimedFiles = new Set();
  const claimedFocusIds = new Set();
  for (const focusId of normalizedFocusIds) {
    if (claimedFocusIds.has(focusId)) continue;
    const productFiles = focusProductFiles(focusId);
    if (productFiles.some((filePath) => claimedFiles.has(filePath))) continue;
    selectedFocusIds.push(focusId);
    for (const filePath of productFiles) claimedFiles.add(filePath);
    for (const siblingFocusId of SURFACE_COLLISION_BY_FOCUS_ID.get(focusId) || [focusId]) {
      claimedFocusIds.add(siblingFocusId);
    }
  }
  return selectedFocusIds;
}

function completedFocusIds() {
  return new Set(expandEquivalentFocusIds(String(process.env.MAILCHIMP_COMPLETED_FOCUS_IDS || '')
    .split(',')));
}

function strictGapInventoryEnabled() {
  const requested = String(process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY || '').trim();
  if (requested === '1') return true;
  if (requested === '0') return false;
  return IMPLEMENTATION_PROFILE === 'mailchimp_parity_focus' && fs.existsSync(STRICT_GAP_INVENTORY_PATH);
}

function strictGapSequenceEnabled() {
  return process.env.MAILCHIMP_STRICT_GAP_SEQUENCE !== '0';
}

function strictGapFocusId(gap) {
  return `focus.${String(gap?.id || '').trim()}`;
}

function loadStrictGapInventory() {
  const payload = readStrictGapJson(STRICT_GAP_INVENTORY_PATH, null);
  return Array.isArray(payload?.gaps) ? payload.gaps : [];
}

function resolveStrictGapFocusGroup(gapId) {
  const normalized = String(gapId || '').trim().toLowerCase();
  if (normalized === 'frontend_interaction_parity') return 'frontend_architecture';
  if (normalized === 'campaign_editor_parity') return 'campaign_editor';
  if (normalized === 'website_builder_parity') return 'website_builder';
  if (normalized === 'automation_journey_parity') return 'automation_journey';
  if (normalized === 'audience_crm_parity') return 'audience_crm';
  if (normalized === 'reporting_analytics_parity') return 'reporting_analytics';
  if (normalized === 'ai_predictive_parity') return 'ai_predictive';
  if (normalized === 'integration_provider_parity') return 'integrations_api_oauth';
  if (normalized === 'auth_session_security_parity') return 'security_ops';
  if (normalized === 'persistence_jobs_operational_parity') return 'delivery_jobs';
  return 'frontend_architecture';
}

function resolveStrictGapTargetedTests(gapId) {
  const normalized = String(gapId || '').trim().toLowerCase();
  if (normalized === 'frontend_interaction_parity') return ['tests/current-product-browser-realism.test.mjs', 'tests/architecture-hardening.test.mjs'];
  if (normalized === 'campaign_editor_parity') return ['tests/campaign-editor-depth.test.mjs', 'tests/template-variants-routes.test.mjs', 'tests/template-approvals-routes.test.mjs'];
  if (normalized === 'website_builder_parity') return ['tests/current-product-parity.test.mjs', 'tests/current-product-browser-realism.test.mjs'];
  if (normalized === 'automation_journey_parity') return ['tests/automation-journeys.test.mjs'];
  if (normalized === 'audience_crm_parity') return ['tests/audience-core.test.mjs', 'tests/audience-funnels.test.mjs'];
  if (normalized === 'reporting_analytics_parity') return ['tests/reports-admin.test.mjs', 'tests/commerce-revenue.test.mjs'];
  if (normalized === 'ai_predictive_parity') return ['tests/current-product-parity.test.mjs', 'tests/current-product-browser-realism.test.mjs'];
  if (normalized === 'integration_provider_parity') return ['tests/integrations-marketplace.test.mjs'];
  if (normalized === 'auth_session_security_parity') return ['tests/security-ops-hardening.test.mjs', 'tests/platform-spine.test.mjs'];
  if (normalized === 'persistence_jobs_operational_parity') return ['tests/architecture-hardening.test.mjs'];
  return ['tests/current-product-parity.test.mjs'];
}

function expandStrictGapCandidateAreas(candidateAreas = []) {
  const resolved = [];
  for (const area of candidateAreas) {
    const rel = String(area || '').trim();
    if (!rel) continue;
    const absolute = path.join(ROOT, rel);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const filePath of walkMjs(absolute)) resolved.push(path.relative(ROOT, filePath));
      continue;
    }
    resolved.push(rel);
  }
  return Array.from(new Set(resolved));
}

function resolveStrictGapImplementationFiles(gapId) {
  const normalized = String(gapId || '').trim().toLowerCase();
  if (normalized === 'audience_crm_parity') {
    return [
      'packages/app/domain-audience.mjs',
      'packages/app/routes/audience.mjs'
    ];
  }
  if (normalized === 'integration_provider_parity') {
    return [
      'packages/app/domain-integration-marketplace.mjs',
      'packages/app/integration-provider.mjs',
      'packages/app/routes/api-admin.mjs',
      'packages/app/routes/integrations-marketplace.mjs',
      'packages/app/routes/current-product-ops.mjs'
    ];
  }
  if (normalized === 'auth_session_security_parity') {
    return [
      'packages/app/security.mjs',
      'packages/app/routes/platform.mjs',
      'packages/app/routes/api-admin.mjs',
      'packages/app/storage.mjs',
      'packages/app/persistence-io.mjs',
      'packages/app/http-runtime.mjs',
      'apps/web/server.mjs'
    ];
  }
  if (normalized === 'persistence_jobs_operational_parity') {
    return [
      'packages/app/storage.mjs',
      'packages/app/job-handlers.mjs',
      'packages/app/job-runtime.mjs',
      'packages/app/jobs.mjs',
      'apps/web/server.mjs'
    ];
  }
  return [];
}

function fileContains(relativePath, needle) {
  if (!relativePath || !needle) return false;
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) return false;
  try {
    return fs.readFileSync(absolutePath, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

function strictGapAlreadySatisfied(gapId) {
  const normalized = String(gapId || '').trim().toLowerCase();
  if (normalized === 'integration_provider_parity') {
    return fileContains('packages/app/domain-integration-marketplace.mjs', 'export async function syncMarketplaceInstallation')
      && fileContains('packages/app/domain-integration-marketplace.mjs', 'providerResult?.refreshedScopes')
      && fileContains('packages/app/integration-provider.mjs', 'fetch(')
      && fileContains('packages/app/routes/api-admin.mjs', 'result: await syncMarketplaceInstallation(')
      && fileContains('packages/app/routes/integrations-marketplace.mjs', 'if (installation) await syncMarketplaceInstallation(')
      && fileContains('packages/app/routes/current-product-ops.mjs', 'await syncMarketplaceInstallation(state, actor, installation)');
  }
  if (normalized === 'auth_session_security_parity') {
    return fileContains('packages/app/security.mjs', 'export function createMfaChallenge')
      && fileContains('packages/app/security.mjs', 'export function createSsoSession')
      && fs.existsSync(path.join(ROOT, 'packages/app/persistence-io.mjs'))
      && fs.existsSync(path.join(ROOT, 'packages/app/http-runtime.mjs'));
  }
  return false;
}

function activeStrictGapEntries() {
  const allGaps = loadStrictGapInventory();
  const done = completedFocusIds();
  const remaining = allGaps.filter((gap) => !done.has(strictGapFocusId(gap)) && !strictGapAlreadySatisfied(gap.id));
  if (!strictGapInventoryEnabled()) return { allGaps, selectedGaps: [] };
  if (!strictGapSequenceEnabled()) return { allGaps, selectedGaps: remaining };
  if (requestedFidelity() === 'parity_for_scope') {
    return { allGaps, selectedGaps: remaining };
  }
  return { allGaps, selectedGaps: remaining.length > 0 ? [remaining[0]] : [] };
}

const PRODUCT_SURFACE_PROGRESS_EXCLUDES = [
  'artifacts/',
  'tests/',
  'scripts/',
  'docs/',
  'state/',
  'backups/',
  '_tmp/',
  '_logs/'
];

export function mailchimpParityFocusIds() {
  if (strictGapInventoryEnabled()) {
    return activeStrictGapEntries().selectedGaps.map((gap) => strictGapFocusId(gap));
  }
  const scopedBenchmarkSurfaces = benchmarkScopeSurfaces();
  if (scopedBenchmarkSurfaces.length > 0) {
    return scopedBenchmarkSurfaces.map((surface) => surface.focusId);
  }
  return CANONICAL_ONE_PASS_PLAN.surfaceChecklist.map((surface) => `focus.${surface.id}`);
}

export const MAILCHIMP_PARITY_FOCUS_IDS = mailchimpParityFocusIds();

function resolveFocusIdFromPatchEntry(entry) {
  for (const value of [entry?.taskId, entry?.shardId, typeof entry?.id === 'string' ? entry.id.replace(/^patch-/, '') : null]) {
    const focusId = canonicalizeFocusId(value);
    if (focusId) return focusId;
  }
  return null;
}

function collectVerifierResults(entry) {
  const nestedResults = [];
  for (const candidate of [entry?.metadata?.verifierResults, entry?.metadata?.implementation?.verifierResults]) {
    if (Array.isArray(candidate)) nestedResults.push(...candidate);
  }
  if (nestedResults.length > 0) return nestedResults;
  return Array.isArray(entry?.verifierResults) ? entry.verifierResults : [];
}

function hasTrustworthyProductSurfaceChange(entry) {
  const filePaths = [];
  for (const candidate of [entry?.filePaths, entry?.modifiedFiles, entry?.paths, entry?.metadata?.implementation?.modifiedFiles]) {
    if (Array.isArray(candidate)) filePaths.push(...candidate);
  }
  const normalizedProductSurfacePaths = filePaths
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((filePath) => !PRODUCT_SURFACE_PROGRESS_EXCLUDES.some((prefix) => filePath.startsWith(prefix)));
  if (normalizedProductSurfacePaths.length === 0) return false;
  const verifierResults = collectVerifierResults(entry);
  const hasExplicitVerifierFailure = verifierResults.some((result) => result?.ok === false && result?.skipped !== true);
  return !hasExplicitVerifierFailure;
}

export function extractVerifiedFocusIdsFromPatchQueue(patchQueue) {
  return Array.from(new Set((patchQueue?.merged || [])
    .map((entry) => ({ focusId: resolveFocusIdFromPatchEntry(entry), trustworthy: hasTrustworthyProductSurfaceChange(entry) }))
    .filter((entry) => entry.focusId && entry.trustworthy)
    .map((entry) => entry.focusId)));
}

export function remainingParityFocusIds(completedFocusIdsInput = completedFocusIds()) {
  const parityFocusIds = mailchimpParityFocusIds();
  const normalizedCompletedFocusIds = completedFocusIdsInput instanceof Set
    ? Array.from(completedFocusIdsInput)
    : (Array.isArray(completedFocusIdsInput) ? completedFocusIdsInput : []);
  const done = new Set(expandEquivalentFocusIds(normalizedCompletedFocusIds));
  return parityFocusIds.filter((id) => !done.has(id));
}

function loadOpenParityFocusIds() {
  try {
    const matrix = JSON.parse(fs.readFileSync(CURRENT_PRODUCT_GAP_MATRIX_PATH, 'utf8'));
    const families = Array.isArray(matrix?.gapFamilies) ? matrix.gapFamilies : [];
    const openFamilies = families.filter((family) => !['closed', 'done', 'complete'].includes(String(family?.status || '').toLowerCase()));
    const mapping = {
      website_builder_depth: ['focus.website-builder'],
      ai_marketing_assistance: ['focus.ai-predictive'],
      predictive_optimization_depth: ['focus.ai-predictive'],
      experimentation_depth: ['focus.campaign-experimentation'],
      omnichannel_depth: ['focus.integrations-api-oauth', 'focus.forms-growth'],
      content_studio_depth: ['focus.forms-growth'],
      integration_ecosystem_realism: ['focus.integrations-api-oauth']
    };
    const done = completedFocusIds();
    return new Set(openFamilies.flatMap((family) => mapping[family.id] || []).filter((id) => id && !done.has(id)));
  } catch {
    return new Set();
  }
}

function productOnlyVerifiers(verifiers = []) {
  return Array.from(new Set(verifiers.filter(Boolean)));
}

function buildGroundedAssignmentContract({ artifactKind = 'product_diff', allowedFiles = [], fileAreas = [], requiredVerifiers = [], acceptanceChecks = [] } = {}) {
  return {
    artifactKind,
    targetFiles: Array.from(new Set((allowedFiles || []).filter(Boolean))),
    targetModules: Array.from(new Set(((fileAreas || []).length ? fileAreas : allowedFiles).filter(Boolean))),
    verifierRequirements: productOnlyVerifiers(requiredVerifiers),
    successPredicate: Array.from(new Set((acceptanceChecks || []).filter(Boolean)))
  };
}

function splitCanonicalParityWorkUnits(workUnits = []) {
  return workUnits.flatMap((unit) => {
    // Keep campaign index intact: the route patch depends on the domain helper,
    // so per-file shards can manufacture a broken import/export pair and poison
    // unrelated verifier runs in the shared worktree.
    return [unit];
  });
}
export const STACK_ROOT = path.resolve(ROOT, '..', 'large-project-capability-stack');
export const ARTIFACT_ROOT = process.env.MAILCHIMP_ORCHESTRATOR_ARTIFACT_ROOT
  ? path.resolve(process.env.MAILCHIMP_ORCHESTRATOR_ARTIFACT_ROOT)
  : path.join(ROOT, 'artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline');
export const VALIDATION_DIR = path.join(ARTIFACT_ROOT, 'validation');
export const RUNS_DIR = path.join(ARTIFACT_ROOT, 'live_runs');
export const MERGE_DIR = path.join(ARTIFACT_ROOT, 'merge');
export const RECOVERY_DIR = path.join(ARTIFACT_ROOT, 'recovery');
export const REPORTS_DIR = path.join(ARTIFACT_ROOT, 'reports');
export const WORKER_SCRIPT = path.join(ROOT, 'scripts', 'orchestrator-real-repo-clean-worker.mjs');
export const VERIFIER_SCRIPT = path.join(ROOT, 'scripts', 'orchestrator-real-repo-clean-verifier.mjs');
export const STACK_FIXTURE_SCALE_PATH = path.join(STACK_ROOT, 'artifacts', 'qualification', 'multi_agent_orchestrator', 'scale_qualification.json');

export const paths = {
  contract: path.join(ARTIFACT_ROOT, 'contract.json'),
  issueGraph: path.join(ARTIFACT_ROOT, 'issue_graph.json'),
  surfaceMatrix: path.join(ARTIFACT_ROOT, 'surface_matrix.json'),
  campaignState: path.join(ARTIFACT_ROOT, 'campaign_state.json'),
  workGraph: path.join(ARTIFACT_ROOT, 'work_graph.json'),
  workSurfaceMatrix: path.join(ARTIFACT_ROOT, 'work_surface_matrix.json'),
  shardPlan: path.join(ARTIFACT_ROOT, 'shard_plan.json'),
  verifierCatalog: path.join(ARTIFACT_ROOT, 'verifier_catalog.json'),
  contextPacks: path.join(ARTIFACT_ROOT, 'context_packs.json'),
  selectedTierSupervisor: path.join(ARTIFACT_ROOT, 'selected_tier_supervisor.json'),
  selectedTierSummary: path.join(ARTIFACT_ROOT, 'selected_tier_summary.json'),
  leaseState: path.join(ARTIFACT_ROOT, 'lease_state.json'),
  patchQueueReport: path.join(ARTIFACT_ROOT, 'patch_queue_report.json'),
  artifactBus: path.join(ARTIFACT_ROOT, 'artifact_bus.json'),
  workerEvents: path.join(ARTIFACT_ROOT, 'worker_events.json'),
  liveExecutionSummary: path.join(ARTIFACT_ROOT, 'live_execution_summary.json'),
  scaleQualification: path.join(ARTIFACT_ROOT, 'scale_qualification.json'),
  validationIndex: path.join(VALIDATION_DIR, 'validation_index.json'),
  mergeReport: path.join(MERGE_DIR, 'merge_report.json'),
  recoveryReport: path.join(RECOVERY_DIR, 'recovery_report.json'),
  blockerReport: path.join(ARTIFACT_ROOT, 'blocker_report.json'),
  supervisorStatus: path.join(ARTIFACT_ROOT, 'supervisor_status.json'),
  programState: path.join(ARTIFACT_ROOT, 'program_state.json'),
  completionSummary: path.join(ARTIFACT_ROOT, 'completion_summary.json'),
  notificationState: path.join(ARTIFACT_ROOT, 'notification_state.json'),
  launchChecklist: path.join(ARTIFACT_ROOT, 'launch_checklist.json'),
  locAccounting: path.join(ARTIFACT_ROOT, 'loc_accounting.json')
};

export function ensureDirs() {
  for (const dirPath of [ARTIFACT_ROOT, VALIDATION_DIR, RUNS_DIR, MERGE_DIR, RECOVERY_DIR, REPORTS_DIR]) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function walkMjs(dirPath) {
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMjs(nextPath));
      continue;
    }
    if (/\.(mjs|js)$/.test(entry.name)) out.push(nextPath);
  }
  return out.sort();
}

function requestedFidelity() {
  return String(process.env.ORCHESTRATOR_REQUESTED_FIDELITY || 'full_clone').trim() || 'full_clone';
}

export function contractInput() {
  if (PRODUCT_ONLY_MODE && strictGapInventoryEnabled() && activeStrictGapEntries().allGaps.length > 0) {
    return buildMailchimpParityFocusWorkGraph().contractInput;
  }
  const scopedBenchmarkSurfaces = benchmarkScopeSurfaces();
  if (PRODUCT_ONLY_MODE && scopedBenchmarkSurfaces.length > 0) {
    const benchmarkContract = readBenchmarkContract();
    return {
      replyAnchor: 'Jake asked for the next threshold-focused Mailchimp production-creation run to launch against the benchmark scope surfaces.',
      anchor: [
        'artifacts/full_audit_campaign/one_pass_run_contract.latest.json',
        benchmarkContract?.benchmarkId || 'mailchimp_production_creation_gate'
      ].join(' | '),
      targetPath: ROOT,
      requestedFidelity: requestedFidelity(),
      requestedScope: scopedBenchmarkSurfaces.map((surface) => surface.label),
      stopCondition: 'supervisor_green_or_blocker_report',
      blockerPolicy: 'stop only on supervisor green or a structured blocker report when repo integrity or honest qualification fails',
      evidenceRequirements: [
        'real repo work graph and shard plan',
        'benchmark-scope Mailchimp surface matrix with per-surface status',
        'context packs and verifier catalog',
        'live worker event trail per tier',
        'lease, merge, patch, and recovery artifacts',
        'repo test and smoke validation logs mapped to targeted product surfaces',
        'staged scale execution report with honest highest proven tier',
        'launch checklist proving the run started with the intended guardrails',
        'mechanical LOC accounting for surviving product-code output',
        'program, completion, notification, and supervisor state'
      ],
      implementationSurface: 'benchmark-scoped Mailchimp product surfaces + orchestrator-driven shard execution + tests + merge/lease/recovery artifacts',
      campaignMode: 'persistent'
    };
  }
  return {
    replyAnchor: 'user approved starting a fresh cleaned-baseline 100-agent full Mailchimp parity campaign for the Mailchimp clone repo',
    anchor: [
      'current multi-agent orchestrator is live-qualified to 100 in fixture mode under /root/clawd/large-project-capability-stack',
      'current conversation concluding that the old wave6/LOC-inflation path was quarantined and that the next honest step is a cleaned-baseline 100-agent campaign on /root/clawd/mailchimp-clone',
      'docs/MAILCHIMP_FULL_CLONE_REPLAN_CLEAN_BASELINE_2026-04-04.md'
    ].join(' | '),
    targetPath: ROOT,
    requestedFidelity: requestedFidelity(),
    requestedScope: [
      'all 26 canonical Mailchimp product surfaces',
      'staged live coordination tiers 8 -> 16 -> 32 -> 64 -> 100 as honest product-parity execution allows',
      'parallel regression depth across remaining product surfaces, targeted tests, runtime slices, and full-repo health checks'
    ],
    stopCondition: 'supervisor_green_or_blocker_report',
    blockerPolicy: 'stop only on supervisor green or a structured blocker report when repo integrity or honest qualification fails',
    evidenceRequirements: [
      'real repo work graph and shard plan',
      'canonical 26-surface Mailchimp parity matrix with per-surface status',
      'context packs and verifier catalog',
      'live worker event trail per tier',
      'lease, merge, patch, and recovery artifacts',
      'repo test and smoke validation logs mapped to targeted product surfaces',
      'staged scale execution report with honest highest proven tier',
      'launch checklist proving the run started with the intended guardrails',
      'mechanical LOC accounting for surviving product-code output',
      'program, completion, notification, and supervisor state'
    ],
    implementationSurface: 'actual cleaned-baseline Mailchimp repo work + orchestrator-driven shard execution + tests + merge/lease/recovery artifacts',
    campaignMode: 'persistent'
  };
}

export function issueDefinitions() {
  if (PRODUCT_ONLY_MODE) {
    return buildMailchimpParityFocusWorkGraph().workGraph.workUnits.map((unit) => ({
      id: unit.id,
      title: unit.title,
      lane: unit.lane,
      deps: Array.isArray(unit.dependsOn) ? unit.dependsOn : [],
      acceptanceCriteria: Array.isArray(unit.evidence) ? unit.evidence : []
    }));
  }
  return [
    {
      id: 'q1.real_repo_parallel_slice',
      title: 'Real Mailchimp repo parallel qualification slice compiled',
      lane: 'planning',
      acceptanceCriteria: [
        'work graph is built from real Mailchimp package and runtime surfaces',
        'shard plan exceeds 120 shards',
        'context packs are generated for every shard'
      ]
    },
    {
      id: 'q2.live_worker_execution',
      title: 'Live worker farm executes real repo shard verifiers',
      lane: 'execution',
      deps: ['q1.real_repo_parallel_slice'],
      acceptanceCriteria: [
        'live worker farm runs against /root/clawd/mailchimp-clone',
        'lease and patch artifacts are recorded',
        'selected passing tier has zero state loss'
      ]
    },
    {
      id: 'q3.staged_scale_ladder',
      title: 'Staged scale ladder records the honest highest proven tier',
      lane: 'qualification',
      deps: ['q2.live_worker_execution'],
      acceptanceCriteria: [
        'tiers start at 8 and progress upward until honest stop',
        'scale_qualification.json distinguishes real repo live mode from fixture qualification',
        '100 is claimed only if the real repo truly passes at 100'
      ]
    },
    {
      id: 'q4.repo_integrity',
      title: 'Repo tests and smoke remain green or recoverable throughout qualification',
      lane: 'validation',
      deps: ['q3.staged_scale_ladder'],
      acceptanceCriteria: [
        'baseline repo tests pass',
        'post-tier repo tests remain green for every passing tier',
        'final smoke proof passes on the real repo'
      ]
    },
    {
      id: 'q5.supervisor_state',
      title: 'Supervisor-owned completion, notification, and program state artifacts exist',
      lane: 'supervision',
      deps: ['q4.repo_integrity'],
      acceptanceCriteria: [
        'program_state.json exists',
        'completion_summary.json exists',
        'notification_state.json exists',
        'launch_checklist.json exists',
        'loc_accounting.json exists',
        'supervisor_status.json reflects the final truth gate'
      ]
    }
  ];
}

export function surfaceDefinitions() {
  if (PRODUCT_ONLY_MODE) {
    return buildMailchimpParityFocusWorkGraph().surfaceMatrix.surfaces;
  }
  return [
    {
      id: 'real_repo_slice',
      label: 'Real repo parallel qualification slice',
      issueIds: ['q1.real_repo_parallel_slice'],
      requiredArtifacts: [paths.contract, paths.workGraph, paths.shardPlan, paths.contextPacks]
    },
    {
      id: 'live_worker_execution',
      label: 'Live worker execution, lease, merge, and recovery evidence',
      issueIds: ['q2.live_worker_execution'],
      requiredArtifacts: [paths.liveExecutionSummary, paths.leaseState, paths.patchQueueReport, paths.mergeReport, paths.recoveryReport]
    },
    {
      id: 'staged_scale_ladder',
      label: 'Staged real-repo scale ladder with honest highest tier',
      issueIds: ['q3.staged_scale_ladder'],
      requiredArtifacts: [paths.scaleQualification, paths.selectedTierSupervisor, paths.selectedTierSummary]
    },
    {
      id: 'repo_integrity',
      label: 'Repo integrity validation logs and smoke proof',
      issueIds: ['q4.repo_integrity'],
      requiredArtifacts: [paths.validationIndex, path.join(VALIDATION_DIR, 'baseline_repo_tests.log'), path.join(VALIDATION_DIR, 'final_smoke.log')]
    },
    {
      id: 'supervisor_state',
      label: 'Supervisor-owned completion state',
      issueIds: ['q5.supervisor_state'],
      requiredArtifacts: [paths.programState, paths.completionSummary, paths.notificationState, paths.launchChecklist, paths.locAccounting, paths.supervisorStatus]
    }
  ];
}

export function discoverPackageQualificationTargets() {
  const packageRoot = path.join(ROOT, 'packages');
  const testRoot = path.join(ROOT, 'tests');
  const targets = [];
  for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageName = entry.name;
    const testFile = path.join(testRoot, `${packageName}.test.mjs`);
    if (!fs.existsSync(testFile)) continue;
    const packageDir = path.join(packageRoot, packageName);
    const sourceFiles = walkMjs(packageDir).map(relative);
    targets.push({
      id: packageName,
      packageDir: relative(packageDir),
      testFile: relative(testFile),
      sourceFiles,
      importFile: sourceFiles.includes(`packages/${packageName}/index.mjs`) ? `packages/${packageName}/index.mjs` : sourceFiles[0],
      domain: packageName.split('-')[0] || packageName
    });
  }
  return targets.sort((left, right) => left.id.localeCompare(right.id));
}

export function runtimeQualificationTargets() {
  if (PRODUCT_ONLY_MODE) return [];
  return [
    {
      id: 'runtime.campaign-pipeline',
      lane: 'runtime_regression',
      domain: 'campaign',
      fileAreas: ['tests/campaign-pipeline.test.mjs'],
      allowedFiles: ['tests/campaign-pipeline.test.mjs'],
      requiredVerifiers: productOnlyVerifiers(['tests']),
      metadata: {
        testFile: 'tests/campaign-pipeline.test.mjs'
      }
    },
    {
      id: 'runtime.customer-journeys',
      lane: 'runtime_regression',
      domain: 'journeys',
      fileAreas: ['packages/customer-journeys', 'tests/automation-journeys.test.mjs', 'tests/transactional-journeys.test.mjs'],
      allowedFiles: walkMjs(path.join(ROOT, 'packages', 'customer-journeys')).map(relative),
      requiredVerifiers: productOnlyVerifiers(['lint', 'imports', 'tests']),
      metadata: {
        importFile: 'packages/customer-journeys/index.mjs',
        testFile: 'tests/automation-journeys.test.mjs',
        extraTestFiles: ['tests/transactional-journeys.test.mjs']
      }
    },
    {
      id: 'runtime.platform-spine',
      lane: 'runtime_regression',
      domain: 'platform',
      fileAreas: ['packages/app', 'tests/platform-spine.test.mjs', 'tests/forms-landing.test.mjs', 'tests/reports-admin.test.mjs'],
      allowedFiles: walkMjs(path.join(ROOT, 'packages', 'app')).map(relative),
      requiredVerifiers: productOnlyVerifiers(['lint', 'imports', 'tests']),
      metadata: {
        importFile: 'packages/app/index.mjs',
        testFile: 'tests/platform-spine.test.mjs',
        extraTestFiles: ['tests/forms-landing.test.mjs', 'tests/reports-admin.test.mjs']
      }
    },
    {
      id: 'runtime.ops-observer',
      lane: 'runtime_regression',
      domain: 'ops',
      fileAreas: ['apps/ops-observer/server.mjs', 'tests/ops-observer.test.mjs'],
      allowedFiles: ['apps/ops-observer/server.mjs', 'tests/ops-observer.test.mjs'],
      requiredVerifiers: productOnlyVerifiers(['lint', 'imports', 'tests']),
      metadata: {
        importFile: 'apps/ops-observer/server.mjs',
        testFile: 'tests/ops-observer.test.mjs'
      }
    }
  ];
}

export function buildRealRepoWorkGraph() {
  const packageTargets = discoverPackageQualificationTargets();
  const workUnits = [];
  const sourceIssueIds = [];
  const regressionIssueIds = [];
  const runtimeIssueIds = [];

  for (const target of packageTargets) {
    const sourceId = `pkg.${target.id}.source`;
    const testId = `pkg.${target.id}.tests`;
    workUnits.push({
      id: sourceId,
      title: `${target.id} source integrity`,
      goal: `Verify ${target.id} source surface is importable and syntax-clean`,
      lane: 'package_integrity',
      domain: target.domain,
      fileAreas: [target.packageDir],
      allowedFiles: target.sourceFiles,
      inputRefs: ['qualificationPolicy'],
      inputs: { packageName: target.id, kind: 'source', importFile: target.importFile },
      acceptanceChecks: [
        `syntax-check ${target.id}`,
        `import ${target.importFile}`,
        `persist artifact trail for ${target.id} source`
      ],
      requiredVerifiers: ['lint', 'imports'],
      effortSteps: 1,
      metadata: {
        packageName: target.id,
        kind: 'source',
        importFile: target.importFile,
        sourceFiles: target.sourceFiles
      }
    });
    if (!PRODUCT_ONLY_MODE) {
      workUnits.push({
        id: testId,
        title: `${target.id} targeted regression`,
        lane: 'package_regression',
        domain: target.domain,
        fileAreas: [target.testFile],
        allowedFiles: [target.testFile],
        evidence: ['targeted regression green'],
        requiredVerifiers: ['test'],
        effortSteps: 1,
        metadata: {
          packageName: target.id,
          kind: 'tests',
          testFile: target.testFile
        }
      });
      regressionIssueIds.push(testId);
    }

    sourceIssueIds.push(sourceId);
  }

  for (const runtimeTarget of runtimeQualificationTargets()) {
    workUnits.push({
      id: runtimeTarget.id,
      title: runtimeTarget.id.replace(/^runtime\./, '').replace(/-/g, ' '),
      goal: `Verify ${runtimeTarget.id} runtime slice on the real repo`,
      lane: runtimeTarget.lane,
      domain: runtimeTarget.domain,
      fileAreas: runtimeTarget.fileAreas,
      allowedFiles: runtimeTarget.allowedFiles,
      inputRefs: ['qualificationPolicy'],
      inputs: { runtimeTarget: runtimeTarget.id },
      acceptanceChecks: [`verify ${runtimeTarget.id}`],
      requiredVerifiers: runtimeTarget.requiredVerifiers,
      effortSteps: 1,
      metadata: runtimeTarget.metadata
    });
    runtimeIssueIds.push(runtimeTarget.id);
  }

  return {
    workGraph: {
      version: 1,
      targetPath: ROOT,
      workUnits
    },
    surfaceMatrix: {
      generatedAt: new Date().toISOString(),
      status: 'planned',
      surfaces: [
        { id: 'PACKAGE_SOURCE', label: 'Package source integrity', issueIds: sourceIssueIds },
        { id: 'PACKAGE_REGRESSION', label: 'Package targeted regression depth', issueIds: regressionIssueIds },
        { id: 'RUNTIME_REALISM', label: 'Runtime shell and smoke realism', issueIds: runtimeIssueIds }
      ]
    },
    globalInputs: {
      qualificationPolicy: 'Use real Mailchimp repo files and executable verifiers only; preserve repo integrity and stop at the highest honestly proven scale tier.'
    },
    packageTargets
  };
}

export function buildMailchimpParityFocusWorkGraph() {
  const strictGapState = activeStrictGapEntries();
  if (!benchmarkScopeEnabled() && strictGapInventoryEnabled() && strictGapState.allGaps.length > 0) {
    const completed = completedFocusIds();
    const selectedIds = new Set(strictGapState.selectedGaps.map((gap) => strictGapFocusId(gap)));
    const workUnits = strictGapState.selectedGaps.map((gap, index) => {
      const focusId = strictGapFocusId(gap);
      const allowedFiles = Array.from(new Set([
        ...expandStrictGapCandidateAreas(gap.candidateAreas || []),
        ...resolveStrictGapImplementationFiles(gap.id)
      ]));
      const targetedTests = resolveStrictGapTargetedTests(gap.id);
      const focusGroup = resolveStrictGapFocusGroup(gap.id);
      const requiredVerifiers = productOnlyVerifiers(['tests']);
      const acceptanceChecks = [
        `Modify at least one canonical product file for ${gap.title}`,
        ...targetedTests.map((testPath) => `Produce executable evidence for ${testPath}`)
      ];
      return {
        id: focusId,
        title: gap.title,
        wave: `strict_gap_${String(index + 1).padStart(2, '0')}`,
        lane: focusGroup,
        fileAreas: Array.from(new Set([...(gap.candidateAreas || []), ...allowedFiles])),
        allowedFiles,
        acceptanceChecks,
        requiredVerifiers,
        evidence: targetedTests,
        dependsOn: [],
        metadata: {
          focusId,
          surfaceId: gap.id,
          importFile: allowedFiles[0] || null,
          testFile: targetedTests[0] || null,
          focusGroup,
          strictGap: true,
          strictGapDetail: gap.detail || null,
          candidateAreas: gap.candidateAreas || [],
          assignmentContract: buildGroundedAssignmentContract({
            artifactKind: 'product_diff',
            allowedFiles,
            fileAreas: Array.from(new Set([...(gap.candidateAreas || []), ...allowedFiles])),
            requiredVerifiers,
            acceptanceChecks
          })
        }
      };
    });
    return {
      contractInput: {
        anchor: 'strict_1to1_gap_inventory',
        replyAnchor: 'Jake wants a continuous 6 hour Mailchimp run that starts with the first strict 1:1 gap and keeps moving through remaining gaps.',
        targetPath: ROOT,
        requestedFidelity: requestedFidelity(),
        requestedScope: strictGapState.allGaps.map((gap) => gap.title),
        stopCondition: 'supervisor_green_or_blocker_report',
        blockerPolicy: 'require_blocker_report_when_supervisor_red',
        evidenceRequirements: ['tests', 'artifacts', 'supervisor'],
        implementationSurface: 'product_code',
        campaignMode: 'persistent'
      },
      workGraph: {
        generatedAt: new Date().toISOString(),
        workspacePath: ROOT,
        qualificationMode: 'real_mailchimp_repo_live_worker_farm',
        profile: 'mailchimp_strict_gap_inventory',
        summary: {
          taskCount: workUnits.length,
          packageAppFileCount: workUnits.reduce((total, unit) => total + unit.allowedFiles.length, 0),
          selectedParityFocusIds: workUnits.map((unit) => unit.id),
          strictGapInventoryPath: path.relative(ROOT, STRICT_GAP_INVENTORY_PATH),
          strictGapSequenceMode: strictGapSequenceEnabled(),
          strictGapCount: strictGapState.allGaps.length
        },
        workUnits
      },
      verifierCatalog: buildVerifierCatalog(),
      surfaceMatrix: {
        generatedAt: new Date().toISOString(),
        status: strictGapState.allGaps.length > 0 && strictGapState.allGaps.every((gap) => completed.has(strictGapFocusId(gap))) ? 'all_complete' : 'partial',
        surfaces: strictGapState.allGaps.map((gap) => {
          const focusId = strictGapFocusId(gap);
          const done = completed.has(focusId);
          return {
            id: gap.id,
            status: done ? 'proven_complete' : selectedIds.has(focusId) ? 'active_gap' : 'remaining_gap',
            title: gap.title,
            notes: gap.detail || null,
            issueIds: [focusId],
            productFiles: expandStrictGapCandidateAreas(gap.candidateAreas || []),
            targetedTests: resolveStrictGapTargetedTests(gap.id),
            focusId,
            strictGap: true
          };
        })
      },
      issueGraph: {
        generatedAt: new Date().toISOString(),
        issues: strictGapState.allGaps.map((gap) => ({
          id: strictGapFocusId(gap),
          title: gap.title,
          status: completed.has(strictGapFocusId(gap)) ? 'complete' : 'open',
          notes: gap.detail || null
        }))
      }
    };
  }

  const scopedBenchmarkSurfaces = benchmarkScopeSurfaces();
  if (scopedBenchmarkSurfaces.length > 0) {
    const workUnits = scopedBenchmarkSurfaces.map((surface) => {
      const acceptanceChecks = [
        `Touch the benchmark-scoped product files for ${surface.label}`,
        `Preserve or add passing evidence for ${surface.label}`,
        'Do not over-credit neighboring Mailchimp surfaces without direct proof'
      ];
      const requiredVerifiers = productOnlyVerifiers(['lint', 'imports', ...(surface.targetedTests.length > 0 ? ['tests'] : [])]);
      return {
        id: surface.focusId,
        title: `${surface.label} parity`,
        goal: `Advance the benchmark-scoped Mailchimp surface ${surface.label} to direct product evidence.`,
        lane: surface.lane,
        domain: 'mailchimp_benchmark_surface',
        fileAreas: surface.allowedFiles,
        deps: [],
        allowedFiles: surface.allowedFiles,
        inputRefs: ['implementationPolicy'],
        acceptanceChecks,
        requiredVerifiers,
        effortSteps: Math.max(4, surface.allowedFiles.length + surface.targetedTests.length),
        evidence: surface.targetedTests,
        metadata: {
          benchmarkSurfaceId: surface.id,
          focusGroup: surface.focusGroup || 'benchmark_scope',
          importFile: surface.allowedFiles[0] || null,
          testFile: surface.targetedTests[0] || null,
          extraTestFiles: surface.targetedTests.slice(1),
          verification: surface.verification,
          assignmentContract: buildGroundedAssignmentContract({
            artifactKind: 'product_diff',
            allowedFiles: surface.allowedFiles,
            fileAreas: surface.allowedFiles,
            requiredVerifiers,
            acceptanceChecks
          })
        }
      };
    });

    // Synthetic benchmark-scope campaigns historically replayed the same surface
    // pool every iteration for throughput measurement. Substantial canonical
    // parity-expansion campaigns are different: replaying already-merged
    // surfaces causes no-op loops while the surface matrix remains partial. When
    // explicitly enabled, carry verified completed focus ids forward so the next
    // iteration advances to the remaining collision group instead of reworking
    // the first non-overlapping wave.
    const carryCompletedFocusIds = benchmarkScopeCarriesCompletedFocusIds();
    const completed = carryCompletedFocusIds ? completedFocusIds() : new Set();
    const remainingOpenFocusIds = new Set(workUnits.map((unit) => unit.id).filter((id) => !completed.has(id)));
    const selectedParityFocusIds = PRODUCT_ONLY_MODE
      ? new Set(selectNonOverlappingFocusIds(Array.from(remainingOpenFocusIds)))
      : remainingOpenFocusIds;
    const scopedWorkUnits = workUnits.filter((unit) => selectedParityFocusIds.has(unit.id));
    const scopedSurfaces = scopedBenchmarkSurfaces.map((surface) => ({
      id: surface.id,
      label: surface.label,
      issueIds: [surface.focusId],
      lane: surface.lane,
      requiredArtifacts: Array.from(new Set([...surface.allowedFiles, ...surface.targetedTests])),
      status: remainingOpenFocusIds.has(surface.focusId) ? 'open' : 'proven_complete'
    }));

    return {
      contractInput: {
        anchor: 'benchmark_scope_mailchimp_production_creation_gate',
        replyAnchor: 'Jake asked for the next threshold-focused Mailchimp production-creation run to launch against the benchmark scope surfaces.',
        targetPath: ROOT,
        requestedFidelity: requestedFidelity(),
        requestedScope: scopedBenchmarkSurfaces.map((surface) => surface.label),
        stopCondition: 'supervisor_green_or_blocker_report',
        blockerPolicy: 'require_blocker_report_when_supervisor_red',
        evidenceRequirements: ['tests', 'artifacts', 'supervisor'],
        implementationSurface: 'product_code',
        campaignMode: 'persistent'
      },
      workGraph: {
        version: 3,
        targetPath: ROOT,
        profile: 'mailchimp_benchmark_scope',
        summary: {
          taskCount: scopedWorkUnits.length,
          selectedParityFocusIds: scopedWorkUnits.map((unit) => unit.id),
          benchmarkScopeSurfaceCount: scopedBenchmarkSurfaces.length,
          benchmarkContractPath: path.relative(ROOT, resolveBenchmarkContractPath())
        },
        workUnits: scopedWorkUnits
      },
      surfaceMatrix: {
        generatedAt: new Date().toISOString(),
        status: remainingOpenFocusIds.size === 0 ? 'all_complete' : 'planned',
        surfaces: scopedSurfaces
      },
      globalInputs: {
        implementationPolicy: 'Make real product-surface changes for the benchmark-scoped Mailchimp production-creation surfaces. No placeholders, no fake green proofs, and do not collapse the run to orchestration-only qualification.'
      },
      packageTargets: []
    };
  }

  const packageAppFiles = walkMjs(path.join(ROOT, 'packages', 'app')).map(relative);
  const publicClientFiles = [
    'apps/web/server.mjs',
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'apps/web/public/app-shell.css',
    'apps/web/public/app-shell.jsx'
  ];
  const persistenceFiles = packageAppFiles;
  const jobFiles = [
    'apps/web/server.mjs',
    'packages/app/jobs.mjs',
    'packages/app/job-runtime.mjs',
    'packages/app/job-handlers.mjs',
    'packages/app/domain-campaigns.mjs'
  ];
  const analyticsFiles = [
    'packages/app/domain-campaigns.mjs',
    'packages/app/analytics-events.mjs'
  ];
  const aiFiles = [
    'packages/app/domain-current-product-ops.mjs',
    'packages/app/ai-provider.mjs',
    'packages/app/predictive-model.mjs'
  ];
  const integrationFiles = [
    'packages/app/domain-integration-marketplace.mjs',
    'packages/app/integration-provider.mjs',
    'packages/app/routes/integrations-marketplace.mjs'
  ];
  const websiteFiles = [
    'packages/app/domain-website-builder.mjs',
    'apps/web/public/app-shell.css',
    'packages/app/routes/current-product-parity.mjs'
  ];
  const growthFiles = [
    'packages/app/routes/forms.mjs',
    'packages/app/domain-growth.mjs'
  ];
  const experimentationFiles = [
    'packages/app/domain-current-product-ops.mjs',
    'packages/app/experiment-engine.mjs'
  ];
  const securityOpsFiles = [
    'packages/app/security.mjs',
    'packages/app/storage.mjs',
    'packages/app/persistence-io.mjs',
    'packages/app/http-runtime.mjs',
    'apps/web/server.mjs'
  ];

  const waveIndex = new Map();
  for (const [index, bundle] of CANONICAL_ONE_PASS_PLAN.laneBundles.entries()) {
    for (const laneId of bundle.laneIds || []) waveIndex.set(laneId, index);
  }

  const workUnits = CANONICAL_ONE_PASS_PLAN.surfaceChecklist.map((surface) => {
    const focusId = `focus.${surface.id}`;
    const bundlePosition = waveIndex.get(surface.id) ?? 0;
    const deps = CANONICAL_ONE_PASS_PLAN.laneBundles
      .slice(0, bundlePosition)
      .flatMap((bundle) => (bundle.laneIds || []).map((laneId) => `focus.${laneId}`));
    const allowedFiles = Array.from(new Set((surface.productFiles || []).filter(Boolean)));
    const testFiles = Array.from(new Set((surface.targetedTests || []).filter(Boolean)));
    const acceptanceChecks = [
      `Touch the canonical product files for ${surface.label}`,
      `Preserve or add passing evidence for ${surface.label}`,
      'Do not over-credit neighboring Mailchimp surfaces without direct proof'
    ];
    const requiredVerifiers = productOnlyVerifiers(['lint', 'imports', 'tests']);
    return {
      id: focusId,
      title: `${surface.label} parity`,
      goal: `Advance the canonical Mailchimp surface ${surface.label} to direct product parity evidence.`,
      lane: surface.wave || 'parity_focus',
      domain: 'mailchimp_surface',
      fileAreas: allowedFiles,
      deps,
      allowedFiles,
      inputRefs: ['implementationPolicy'],
      acceptanceChecks,
      requiredVerifiers,
      effortSteps: Math.max(4, allowedFiles.length + testFiles.length),
      metadata: {
        canonicalSurfaceId: surface.id,
        wave: surface.wave,
        priority: surface.priority,
        currentStatus: surface.currentStatus,
        importFile: allowedFiles[0] || null,
        testFile: testFiles[0] || null,
        extraTestFiles: testFiles.slice(1),
        assignmentContract: buildGroundedAssignmentContract({
          artifactKind: 'product_diff',
          allowedFiles,
          fileAreas: allowedFiles,
          requiredVerifiers,
          acceptanceChecks
        })
      }
    };
  });

  const remainingOpenFocusIds = PRODUCT_ONLY_MODE
    ? new Set(remainingParityFocusIds(completedFocusIds()))
    : new Set(workUnits.map((unit) => unit.id));
  const selectedParityFocusIds = PRODUCT_ONLY_MODE
    ? new Set(selectNonOverlappingFocusIds(Array.from(remainingOpenFocusIds)))
    : remainingOpenFocusIds;
  const scopedWorkUnits = splitCanonicalParityWorkUnits(workUnits.filter((unit) => selectedParityFocusIds.has(unit.id)));
  const scopedSurfaces = CANONICAL_ONE_PASS_PLAN.surfaceChecklist
    .map((surface) => ({
      id: surface.id,
      label: surface.label,
      issueIds: [`focus.${surface.id}`],
      priority: surface.priority,
      wave: surface.wave,
      requiredArtifacts: Array.from(new Set([...(surface.productFiles || []), ...(surface.targetedTests || [])])),
      status: remainingOpenFocusIds.has(`focus.${surface.id}`) ? 'open' : 'proven_complete'
    }));

  return {
    workGraph: {
      version: 3,
      targetPath: ROOT,
      workUnits: scopedWorkUnits
    },
    surfaceMatrix: {
      generatedAt: new Date().toISOString(),
      status: 'planned',
      surfaces: scopedSurfaces
    },
    globalInputs: {
      implementationPolicy: 'Make real product-surface changes for the remaining canonical Mailchimp clone surfaces. No placeholders, no fake green proofs, and do not collapse the run to orchestration-only qualification.'
    },
    packageTargets: []
  };
}

export function buildSelectedWorkGraphSeed() {
  if (benchmarkScopeEnabled()) {
    const surfaces = benchmarkScopeSurfaces();
    if (surfaces.length === 0) {
      throw new Error(`MAILCHIMP_USE_BENCHMARK_SCOPE=1 but no benchmark scope surfaces were loaded from ${resolveBenchmarkContractPath()}; refusing to fall back to parity/package qualification.`);
    }
    if (process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE !== 'mailchimp_parity_focus') {
      throw new Error(`MAILCHIMP_USE_BENCHMARK_SCOPE=1 requires ORCHESTRATOR_IMPLEMENTATION_PROFILE=mailchimp_parity_focus; refusing to run package/integrity qualification profile ${process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE || '(unset)'}.`);
    }
  }
  return process.env.ORCHESTRATOR_IMPLEMENTATION_PROFILE === 'mailchimp_parity_focus'
    ? buildMailchimpParityFocusWorkGraph()
    : buildRealRepoWorkGraph();
}

export function buildFailurePlan({ shardPlan, leaseTtlMs }) {
  const crashTargets = shardPlan.shards.filter((_, index) => index % 41 === 0).slice(0, 3);
  const stallTargets = shardPlan.shards.filter((_, index) => index % 29 === 0).slice(0, 5);
  const plan = [];
  for (const shard of crashTargets) {
    plan.push({
      shardId: shard.id,
      attempt: 1,
      mode: 'crash',
      note: 'real-repo deterministic crash injection'
    });
  }
  for (const shard of stallTargets) {
    if (plan.some((entry) => entry.shardId === shard.id && entry.attempt === 1)) continue;
    plan.push({
      shardId: shard.id,
      attempt: 1,
      mode: 'stall',
      delayMs: leaseTtlMs * 2,
      note: 'real-repo deterministic stall injection'
    });
  }
  return plan.sort((left, right) => left.shardId.localeCompare(right.shardId));
}

export function buildVerifierCatalog() {
  return {
    generatedAt: new Date().toISOString(),
    workspacePath: ROOT,
    qualificationMode: 'real_mailchimp_repo_live_worker_farm',
    verifiers: [
      {
        id: 'lint',
        command: `${process.execPath} ${VERIFIER_SCRIPT} --assignment <assignment.json> --verifier lint`,
        proof: 'runs node --check across shard-owned source files'
      },
      {
        id: 'imports',
        command: `${process.execPath} ${VERIFIER_SCRIPT} --assignment <assignment.json> --verifier imports`,
        proof: 'dynamically imports the shard entry surface from the real repo'
      },
      {
        id: 'tests',
        command: `${process.execPath} ${VERIFIER_SCRIPT} --assignment <assignment.json> --verifier tests`,
        proof: 'executes targeted node --test files against the real repo'
      },
      {
        id: 'smoke',
        command: `${process.execPath} ${VERIFIER_SCRIPT} --assignment <assignment.json> --verifier smoke`,
        proof: 'executes the real smoke-full-clone flow against a live ephemeral server'
      }
    ]
  };
}

export function tierRunDir(tier) {
  return path.join(RUNS_DIR, `tier-${String(tier).padStart(3, '0')}`);
}

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return payload;
}
