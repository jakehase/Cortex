import fs from 'node:fs';
import path from 'node:path';
import { MAILCHIMP_CANONICAL_ONE_PASS_PLAN as CANONICAL_ONE_PASS_PLAN } from './mailchimp-canonical-one-pass-plan-data.mjs';
import { bindStrictHierarchicalPlanToWorkUnits, buildStrictHierarchicalPlan } from './strict-hierarchical-planner.mjs';
import { buildObjectiveExpansionPlan, decomposeObjectiveToArchitectureEpics } from '../../../large-project-capability-stack/packages/objective-surface-decomposer/index.mjs';

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
const STRICT_GAP_INVENTORY_FALLBACK_PATHS = Object.freeze([
  path.join(ROOT, 'docs', 'MAILCHIMP_STRICT_1TO1_GAP_INVENTORY_2026-05-08.json')
]);
const DEFAULT_BENCHMARK_CONTRACT_PATH = path.join(ROOT, 'artifacts', 'full_audit_campaign', 'one_pass_run_contract.latest.json');

const FULL_CLONE_BROAD_OBJECTIVE_GAPS = Object.freeze([
  {
    id: 'frontend_client_shell_state',
    title: 'Frontend client shell state, hydration, and browser realism',
    detail: 'Build a real browser-side app shell with state handoff, asset serving, and interaction hooks instead of treating server-rendered route presence as full Mailchimp UI parity.',
    candidateAreas: ['apps/web/public', 'packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs']
  },
  {
    id: 'website_builder_editor_realism',
    title: 'Website builder editor realism and revision workflows',
    detail: 'Deepen the website builder toward editor-grade page state, revision/undo behavior, analytics handoff, and publish workflow evidence.',
    candidateAreas: ['packages/app/domain-website-builder.mjs', 'packages/app/routes/website-builder.mjs', 'apps/web/public']
  },
  {
    id: 'campaign_editor_template_workflows',
    title: 'Campaign editor, templates, and content workflow depth',
    detail: 'Advance the campaign editor beyond static forms into template selection, block variants, approvals, preheader/subject/content workflows, and send-review continuity.',
    candidateAreas: ['packages/app/domain-campaigns.mjs', 'packages/app/domain-template-assets.mjs', 'packages/app/routes/campaigns.mjs', 'packages/app/routes/content-asset-templates.mjs']
  },
  {
    id: 'automation_journey_execution',
    title: 'Automation journey execution runtime',
    detail: 'Add execution semantics for automation journeys: trigger handling, branching, delay/scheduling representation, run history, and recovery/audit visibility.',
    candidateAreas: ['packages/app/domain-campaigns.mjs', 'packages/app/domain-growth.mjs', 'packages/app/routes/automations.mjs', 'packages/app/job-runtime.mjs']
  },
  {
    id: 'campaign_ops_calendar_workflow',
    title: 'Campaign operations calendar, experimentation, and review workflow',
    detail: 'Add operational planning depth for experiments, calendar/review states, optimization decisions, and accountable campaign ops handoffs.',
    candidateAreas: ['packages/app/domain-current-product-ops.mjs', 'packages/app/experiment-engine.mjs', 'packages/app/domain-campaigns.mjs', 'packages/app/routes/current-product-ops.mjs']
  },
  {
    id: 'audience_identity_lifecycle',
    title: 'Audience identity lifecycle and CRM data governance',
    detail: 'Deepen contacts/audience parity with identity lifecycle, consent/status transitions, merge/import validation, segmentation, tags/groups/interests, and auditability.',
    candidateAreas: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs', 'packages/app/storage.mjs']
  },
  {
    id: 'audience_sync_warehouse',
    title: 'Audience sync, import, and warehouse-style operational depth',
    detail: 'Add operational data-sync depth for imports, normalization, error buckets, warehouse-like summary evidence, and recoverable audience processing.',
    candidateAreas: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs', 'packages/app/job-handlers.mjs', 'packages/app/jobs.mjs']
  },
  {
    id: 'reporting_metrics_pipeline',
    title: 'Reporting metrics pipeline and analytics event model',
    detail: 'Build credible analytics event capture, campaign/website metric aggregation, report detail evidence, and attribution-style summary flow.',
    candidateAreas: ['packages/app/analytics-events.mjs', 'packages/app/domain-campaigns.mjs', 'packages/app/routes/reports.mjs', 'packages/app/routes/api-admin.mjs']
  },
  {
    id: 'integration_provider_sync',
    title: 'Integration provider sync, OAuth-like handoff, and marketplace operations',
    detail: 'Move integrations beyond catalog cards into provider sync behavior, refreshed scopes, marketplace operations, and API/admin handoff evidence.',
    candidateAreas: ['packages/app/domain-integration-marketplace.mjs', 'packages/app/integration-provider.mjs', 'packages/app/routes/integrations-marketplace.mjs', 'packages/app/routes/api-admin.mjs']
  },
  {
    id: 'auth_session_security_hardening',
    title: 'Auth/session/security hardening and admin safety controls',
    detail: 'Add security depth for session handling, MFA/SSO-style state, role-aware access, CSRF/persistence/runtime hardening, and audit trails.',
    candidateAreas: ['packages/app/security.mjs', 'packages/app/storage.mjs', 'packages/app/persistence-io.mjs', 'packages/app/http-runtime.mjs', 'apps/web/server.mjs', 'packages/app/routes/platform.mjs', 'packages/app/routes/api-admin.mjs']
  },
  {
    id: 'persistence_jobs_operational_db',
    title: 'Persistence, jobs, and operational database realism',
    detail: 'Replace memory-only assumptions with durable persistence helpers, job retry/dead-letter behavior, and execution-loop evidence for delivery/import operations.',
    candidateAreas: ['packages/app/storage.mjs', 'packages/app/persistence-io.mjs', 'packages/app/jobs.mjs', 'packages/app/job-runtime.mjs', 'packages/app/job-handlers.mjs', 'apps/web/server.mjs']
  },
  {
    id: 'ai_predictive_ops_realism',
    title: 'AI/predictive operations realism',
    detail: 'Add provider-backed recommendation seams, predictive scoring, send-time/audience optimization handoffs, and explainable AI output state.',
    candidateAreas: ['packages/app/ai-provider.mjs', 'packages/app/predictive-model.mjs', 'packages/app/domain-current-product-ops.mjs', 'packages/predictive-segments/index.mjs', 'packages/send-time-optimizer/index.mjs']
  }
]);

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
  return normalized.replace(/(?:#|::).+$/, '');
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
      const label = String(surface?.label || surface?.title || id).trim();
      const lane = String(surface?.lane || '').trim() || 'benchmark_scope';
      const focusGroup = String(surface?.focusGroup || surface?.implementationFamily || resolveStrictGapFocusGroup(id)).trim();
      const candidateAreas = Array.isArray(surface?.candidateAreas) ? surface.candidateAreas : [];
      const allowedFiles = Array.from(new Set([
        ...(surface?.allowedFiles || []).map((entry) => String(entry || '').trim()).filter(Boolean),
        ...expandStrictGapCandidateAreas(candidateAreas),
        ...resolveStrictGapImplementationFiles(id)
      ].filter((filePath) => filePath && !String(filePath).startsWith('scripts/'))));
      const targetedTests = Array.from(new Set([
        ...verificationCommandTestFiles(surface?.verification || []),
        ...resolveStrictGapTargetedTests(id)
      ]));
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

export function objectiveCreditFocusIds(values = []) {
  // For full-clone objectives, completion credit must stay exact. Surface
  // equivalence/collision groups are useful for scheduling non-overlapping
  // shards, but using them as completion credit silently collapses distinct
  // product surfaces and exhausts the graph before the objective is actually
  // green. Narrower parity-for-scope/benchmark modes may still use equivalent
  // credit to avoid repeatedly working the same shallow file cluster.
  return requestedFidelity() === 'full_clone'
    ? normalizeFocusIds(values)
    : expandEquivalentFocusIds(values);
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
  return new Set(objectiveCreditFocusIds(String(process.env.MAILCHIMP_COMPLETED_FOCUS_IDS || '')
    .split(',')));
}

function verifiedCompletedFocusIds() {
  return new Set(objectiveCreditFocusIds(String(process.env.MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS || '')
    .split(',')));
}

function rawExcludedFocusIdEntries() {
  return String(process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => entry.startsWith('focus.') ? entry : `focus.${entry}`);
}

function excludedFocusIds() {
  return new Set(objectiveCreditFocusIds(rawExcludedFocusIdEntries()
    .filter((entry) => !entry.includes('::'))));
}

function excludedWorkUnitIds() {
  return new Set(rawExcludedFocusIdEntries()
    .filter((entry) => entry.includes('::')));
}

function strictGapInventoryEnabled() {
  const requested = String(process.env.MAILCHIMP_USE_STRICT_GAP_INVENTORY || '').trim();
  if (requested === '1') return true;
  if (requested === '0') return false;
  return IMPLEMENTATION_PROFILE === 'mailchimp_parity_focus'
    && strictGapInventorySourcePath() !== null;
}

function strictGapSequenceEnabled() {
  return process.env.MAILCHIMP_STRICT_GAP_SEQUENCE !== '0';
}

function strictGapSaturationCreditEnabled() {
  return process.env.MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION !== '1';
}

function strictGapSatisfactionCreditApplies() {
  return strictGapSaturationCreditEnabled() && requestedFidelity() !== 'full_clone';
}

function strictGapFocusId(gap) {
  return `focus.${String(gap?.id || '').trim()}`;
}

function loadStrictGapInventory() {
  const filePath = strictGapInventorySourcePath();
  if (filePath) return readStrictGapJson(filePath, { gaps: [] })?.gaps || [];
  return [];
}

function strictGapInventorySourcePath() {
  for (const filePath of [STRICT_GAP_INVENTORY_PATH, ...STRICT_GAP_INVENTORY_FALLBACK_PATHS]) {
    const payload = readStrictGapJson(filePath, null);
    if (Array.isArray(payload?.gaps) && payload.gaps.length > 0) return filePath;
  }
  return null;
}

export function fullCloneBroadObjectiveGaps() {
  return FULL_CLONE_BROAD_OBJECTIVE_GAPS.map((gap) => ({
    ...gap,
    broadFullCloneObjective: true
  }));
}

export function fullCloneObjectiveInventory() {
  const strictGaps = loadStrictGapInventory();
  if (requestedFidelity() !== 'full_clone' || process.env.MAILCHIMP_DISABLE_FULL_CLONE_BROAD_OBJECTIVES === '1') return strictGaps;
  const seen = new Set(strictGaps.map((gap) => String(gap?.id || '').trim()).filter(Boolean));
  const broadGaps = fullCloneBroadObjectiveGaps().filter((gap) => !seen.has(gap.id));
  return [...strictGaps, ...broadGaps];
}

function resolveStrictGapFocusGroup(gapId) {
  const normalized = String(gapId || '').trim().toLowerCase();
  if (normalized === 'frontend_client_shell_state') return 'frontend_architecture';
  if (normalized === 'website_builder_editor_realism') return 'website_builder';
  if (normalized === 'campaign_editor_template_workflows') return 'campaign_editor';
  if (normalized === 'automation_journey_execution') return 'automation_journey';
  if (normalized === 'campaign_ops_calendar_workflow') return 'campaign_experimentation';
  if (normalized === 'audience_identity_lifecycle') return 'audience_crm';
  if (normalized === 'audience_sync_warehouse') return 'audience_crm';
  if (normalized === 'reporting_metrics_pipeline') return 'reporting_analytics';
  if (normalized === 'integration_provider_sync') return 'integrations_api_oauth';
  if (normalized === 'auth_session_security_hardening') return 'security_ops';
  if (normalized === 'persistence_jobs_operational_db') return 'delivery_jobs';
  if (normalized === 'ai_predictive_ops_realism') return 'ai_predictive';
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

function existingStrictGapTargetedTests(testFiles = []) {
  const existing = Array.from(new Set((Array.isArray(testFiles) ? testFiles : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .filter((entry) => fs.existsSync(path.join(ROOT, entry)))));
  if (existing.length > 0) return existing;
  const fallback = 'tests/current-product-parity.test.mjs';
  return fs.existsSync(path.join(ROOT, fallback)) ? [fallback] : [];
}

function rawStrictGapTargetedTests(gapId) {
  const normalized = String(gapId || '').trim().toLowerCase();
  if (normalized === 'frontend_client_shell_state') return ['tests/current-product-browser-realism.test.mjs', 'tests/architecture-hardening.test.mjs'];
  if (normalized === 'website_builder_editor_realism') return ['tests/current-product-browser-realism.test.mjs', 'tests/current-product-parity.test.mjs'];
  if (normalized === 'campaign_editor_template_workflows') return ['tests/campaign-editor-depth.test.mjs', 'tests/template-variants-routes.test.mjs', 'tests/template-approvals-routes.test.mjs'];
  if (normalized === 'automation_journey_execution') return ['tests/automation-journeys.test.mjs'];
  if (normalized === 'campaign_ops_calendar_workflow') return ['tests/current-product-ops.test.mjs', 'tests/current-product-parity.test.mjs'];
  if (normalized === 'audience_identity_lifecycle') return ['tests/audience-core.test.mjs', 'tests/audience-funnels.test.mjs'];
  if (normalized === 'audience_sync_warehouse') return ['tests/audience-core.test.mjs', 'tests/architecture-hardening.test.mjs'];
  if (normalized === 'reporting_metrics_pipeline') return ['tests/reports-admin.test.mjs', 'tests/commerce-revenue.test.mjs'];
  if (normalized === 'integration_provider_sync') return ['tests/integrations-marketplace.test.mjs'];
  if (normalized === 'auth_session_security_hardening') return ['tests/security-ops-hardening.test.mjs', 'tests/platform-spine.test.mjs'];
  if (normalized === 'persistence_jobs_operational_db') return ['tests/architecture-hardening.test.mjs'];
  if (normalized === 'ai_predictive_ops_realism') return ['tests/current-product-parity.test.mjs', 'tests/current-product-browser-realism.test.mjs'];
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

function resolveStrictGapTargetedTests(gapId) {
  return existingStrictGapTargetedTests(rawStrictGapTargetedTests(gapId));
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
  const broadObjectiveFiles = {
    frontend_client_shell_state: ['apps/web/public/app-shell.css', 'apps/web/public/app-shell.jsx', 'packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs'],
    website_builder_editor_realism: ['packages/app/domain-website-builder.mjs', 'packages/app/routes/website-builder.mjs', 'apps/web/public/app-shell.css', 'apps/web/public/app-shell.jsx'],
    campaign_editor_template_workflows: ['packages/app/domain-campaigns.mjs', 'packages/app/domain-template-assets.mjs', 'packages/app/routes/campaigns.mjs', 'packages/app/routes/content-asset-templates.mjs'],
    automation_journey_execution: ['packages/app/domain-campaigns.mjs', 'packages/app/domain-growth.mjs', 'packages/app/routes/automations.mjs', 'packages/app/job-runtime.mjs'],
    campaign_ops_calendar_workflow: ['packages/app/domain-current-product-ops.mjs', 'packages/app/experiment-engine.mjs', 'packages/app/domain-campaigns.mjs', 'packages/app/routes/current-product-ops.mjs'],
    audience_identity_lifecycle: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs', 'packages/app/storage.mjs'],
    audience_sync_warehouse: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs', 'packages/app/job-handlers.mjs', 'packages/app/jobs.mjs'],
    reporting_metrics_pipeline: ['packages/app/analytics-events.mjs', 'packages/app/domain-campaigns.mjs', 'packages/app/routes/reports.mjs', 'packages/app/routes/api-admin.mjs'],
    integration_provider_sync: ['packages/app/domain-integration-marketplace.mjs', 'packages/app/integration-provider.mjs', 'packages/app/routes/integrations-marketplace.mjs', 'packages/app/routes/api-admin.mjs'],
    auth_session_security_hardening: ['packages/app/security.mjs', 'packages/app/storage.mjs', 'packages/app/persistence-io.mjs', 'packages/app/http-runtime.mjs', 'apps/web/server.mjs', 'packages/app/routes/platform.mjs', 'packages/app/routes/api-admin.mjs'],
    persistence_jobs_operational_db: ['packages/app/storage.mjs', 'packages/app/persistence-io.mjs', 'packages/app/jobs.mjs', 'packages/app/job-runtime.mjs', 'packages/app/job-handlers.mjs', 'apps/web/server.mjs'],
    ai_predictive_ops_realism: ['packages/app/ai-provider.mjs', 'packages/app/predictive-model.mjs', 'packages/app/domain-current-product-ops.mjs', 'packages/predictive-segments/index.mjs', 'packages/send-time-optimizer/index.mjs']
  };
  if (broadObjectiveFiles[normalized]) return broadObjectiveFiles[normalized];
  const canonicalSurfaceFiles = {
    signup_onboarding: ['packages/app/index.mjs', 'packages/app/routes/public.mjs', 'packages/app/routes/platform.mjs', 'packages/app/view.mjs', 'packages/app/storage.mjs', 'packages/app/persistence-io.mjs'],
    account_workspace_setup: ['packages/app/index.mjs', 'packages/app/routes/platform.mjs', 'packages/app/view.mjs', 'packages/app/storage.mjs', 'packages/app/persistence-io.mjs'],
    dashboard_home: ['packages/app/index.mjs', 'packages/app/routes/platform.mjs', 'packages/app/view.mjs', 'packages/app/domain-current-product-ops.mjs', 'packages/app/storage.mjs'],
    audience_overview: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
    contacts_table: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
    contact_profile: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
    tags_groups_interests: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
    segments: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
    signup_forms_popups: ['packages/app/domain-growth.mjs', 'packages/app/routes/forms.mjs'],
    campaign_index: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs'],
    campaign_wizard: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs'],
    email_builder: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs', 'packages/app/routes/content-asset-templates.mjs'],
    template_library: ['packages/app/domain-template-assets.mjs', 'packages/app/routes/content-asset-templates.mjs'],
    content_studio: ['packages/app/domain-content-ecosystem-depth.mjs', 'packages/app/routes/content-asset-templates.mjs'],
    send_schedule_review: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs'],
    reports_overview: ['packages/app/domain-growth.mjs', 'packages/app/domain-commerce-revenue.mjs', 'packages/app/routes/reports.mjs', 'packages/app/routes/api-admin.mjs'],
    report_detail: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/reports.mjs'],
    automations_overview: ['packages/app/domain-growth.mjs', 'packages/app/routes/automations.mjs'],
    automation_journey_builder: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/automations.mjs'],
    landing_pages: ['packages/app/domain-growth.mjs', 'packages/app/routes/website-builder.mjs'],
    website_builder: ['packages/app/domain-website-builder.mjs', 'packages/app/routes/website-builder.mjs'],
    integrations_marketplace: ['packages/app/domain-integration-marketplace.mjs', 'packages/app/routes/integrations-marketplace.mjs'],
    api_keys_webhooks: ['packages/app/routes/api-admin.mjs'],
    billing_plans: ['packages/app/domain-commerce-revenue.mjs', 'packages/app/routes/api-admin.mjs'],
    settings_domains: ['packages/app/domain-deliverability-compliance.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/routes/platform.mjs'],
    team_roles_permissions: ['packages/app/storage.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/routes/platform.mjs']
  };
  if (canonicalSurfaceFiles[normalized]) return canonicalSurfaceFiles[normalized];
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

const fileContentCache = new Map();

function cachedFileText(relativePath) {
  if (!relativePath) return null;
  const absolutePath = path.join(ROOT, relativePath);
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const cacheKey = absolutePath;
  const cached = fileContentCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.text;
  try {
    const text = fs.readFileSync(absolutePath, 'utf8');
    fileContentCache.set(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size, text });
    return text;
  } catch {
    return null;
  }
}

function fileContains(relativePath, needle) {
  if (!relativePath || !needle) return false;
  const text = cachedFileText(relativePath);
  return text != null && text.includes(needle);
}

function fileContainsAll(relativePath, needles = []) {
  const text = cachedFileText(relativePath);
  if (text == null) return false;
  return needles.every((needle) => text.includes(needle));
}

function filesContainAll(checks = []) {
  return checks.every(([relativePath, ...needles]) => fileContainsAll(relativePath, needles));
}

const STRICT_GAP_SATISFACTION_CHECKS = Object.freeze({
  signup_onboarding: [
    ['packages/app/view.mjs', 'signupOnboardingChecklistItems', 'signupOnboardingCard'],
    ['packages/app/routes/public.mjs', "router.register('GET', '/signup/checklist'"],
    ['packages/app/routes/platform.mjs', "router.register('GET', '/onboarding'", 'signupOnboardingCard(actor']
  ],
  account_workspace_setup: [
    ['packages/app/view.mjs', 'signupOnboardingChecklistItems', 'Set sender profile', 'Invite teammates'],
    ['packages/app/routes/platform.mjs', 'workspaceSwitcher(actor)', 'Next best actions']
  ],
  dashboard_home: [
    ['packages/app/view.mjs', 'function dashboardBody', 'Quick launch', 'signupOnboardingCard(actor, { compact: true })'],
    ['packages/app/routes/platform.mjs', "router.register('GET', '/app'", 'dashboardBody(state, actor)']
  ],
  audience_overview: [
    ['packages/app/domain-audience.mjs', 'export function audienceCrmSummary'],
    ['packages/app/routes/audience.mjs', '<h3>CRM health</h3>', '<h3>Open surfaces</h3>']
  ],
  contacts_table: [
    ['packages/app/domain-audience.mjs', 'export function generateImportPreview', 'export function bulkUpdateContacts'],
    ['packages/app/routes/audience.mjs', "router.register('GET', '/contacts'", '<h3>Bulk action</h3>', 'Import contacts']
  ],
  contact_profile: [
    ['packages/app/routes/audience.mjs', "router.register('GET', '/contacts/:id'", "router.register('POST', '/contacts/:id'", 'Activity']
  ],
  tags_groups_interests: [
    ['packages/app/domain-audience.mjs', 'taxonomy', 'groups', 'interests'],
    ['packages/app/routes/audience.mjs', "router.register('GET', '/audiences/:id/taxonomy'", 'Tags</h3>', 'Groups</h3>', 'Interests</h3>']
  ],
  segments: [
    ['packages/app/domain-audience.mjs', 'export function parseSegmentRules', 'export function matchSegment'],
    ['packages/app/routes/audience.mjs', "router.register('GET', '/segments'", "router.register('POST', '/segments'"]
  ],
  signup_forms_popups: [
    ['packages/app/domain-growth.mjs', 'export function popupTargetingSummary'],
    ['packages/app/routes/forms.mjs', 'popupMode', 'geotarget', 'triggerRule']
  ],
  campaign_index: [
    ['packages/app/domain-campaigns.mjs', 'export function campaignIndexSummary'],
    ['packages/app/routes/campaigns.mjs', '<h3>Campaign pipeline</h3>', '<h3>Delivery coverage</h3>']
  ],
  campaign_wizard: [
    ['packages/app/routes/campaigns.mjs', 'Campaign creation wizard', '<h3>Guided setup</h3>', 'Template library:']
  ],
  email_builder: [
    ['packages/app/domain-campaigns.mjs', 'export function emailBuilderParitySummary'],
    ['packages/app/routes/content-asset-templates.mjs', '<h3>Email builder</h3>']
  ],
  template_library: [
    ['packages/app/domain-template-assets.mjs', 'export function templateLibrarySummary'],
    ['packages/app/routes/content-asset-templates.mjs', '<h3>Template library</h3>']
  ],
  content_studio: [
    ['packages/app/domain-content-ecosystem-depth.mjs', 'export function contentDepthSummary'],
    ['packages/app/routes/content-asset-templates.mjs', '<h3>Content depth</h3>', 'Open content depth tools']
  ],
  send_schedule_review: [
    ['packages/app/domain-campaigns.mjs', 'export function campaignSendScheduleSummary'],
    ['packages/app/routes/campaigns.mjs', '<h3>Send schedule readiness</h3>']
  ],
  reports_overview: [
    ['packages/app/routes/api-admin.mjs', "router.register('GET', '/api/reports/summary'"],
    ['packages/app/routes/reports.mjs', '<h3>Report integrity</h3>']
  ],
  report_detail: [
    ['packages/app/domain-campaigns.mjs', 'export function campaignReportDetailSummary'],
    ['packages/app/routes/reports.mjs', '<h3>Detail integrity</h3>']
  ],
  automations_overview: [
    ['packages/app/domain-growth.mjs', 'export function createAutomation', 'export function validateAutomation', 'export function automationRunSummary'],
    ['packages/app/routes/automations.mjs', 'Automations overview', '/automations/new']
  ],
  automation_journey_builder: [
    ['packages/app/domain-campaigns.mjs', 'export function campaignAutomationRuntimeSummary'],
    ['packages/app/routes/automations.mjs', 'function automationOrchestrationSummary', '<h3>Journey orchestration</h3>']
  ],
  landing_pages: [
    ['packages/app/domain-growth.mjs', 'export function createLandingPage'],
    ['packages/app/routes/website-builder.mjs', '<option value="landing">landing</option>', 'Landing pages can link forms and campaigns']
  ],
  website_builder: [
    ['packages/app/domain-website-builder.mjs', 'export function recordWebsiteView'],
    ['packages/app/routes/website-builder.mjs', 'registerWebsiteBuilderRoutes', '<h3>Publish history</h3>', 'recordWebsiteView(state, website, sitePage']
  ],
  integrations_marketplace: [
    ['packages/app/domain-integration-marketplace.mjs', 'export function integrationMarketplaceSurfaceSummary'],
    ['packages/app/routes/integrations-marketplace.mjs', '<h3>Connector operations</h3>']
  ],
  api_keys_webhooks: [
    ['packages/app/routes/api-admin.mjs', "router.register('GET', '/api/developer/access'", 'webhookDeliveries']
  ],
  billing_plans: [
    ['packages/app/domain-commerce-revenue.mjs', 'export function billingPlanSummary'],
    ['packages/app/routes/api-admin.mjs', "router.register('GET', '/api/billing/summary'"]
  ],
  settings_domains: [
    ['packages/app/domain-deliverability-compliance.mjs', 'export function deliverabilityHealth'],
    ['packages/app/routes/api-admin.mjs', "router.register('GET', '/api/settings/domains'"],
    ['packages/app/routes/platform.mjs', '<h3>Domain readiness</h3>', "router.register('GET', '/settings/domains/:id'"]
  ],
  team_roles_permissions: [
    ['packages/app/routes/api-admin.mjs', "router.register('GET', '/api/team'"],
    ['packages/app/routes/platform.mjs', 'Team roles & invitations', '/team/members/${membership.id}/role']
  ]
});

export function strictGapAlreadySatisfied(gapId) {
  const normalized = String(gapId || '').trim().toLowerCase();
  if (STRICT_GAP_SATISFACTION_CHECKS[normalized]) {
    return filesContainAll(STRICT_GAP_SATISFACTION_CHECKS[normalized]);
  }
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
  const allGaps = fullCloneObjectiveInventory();
  const done = completedFocusIds();
  const verifiedDone = verifiedCompletedFocusIds();
  const excluded = excludedFocusIds();
  const excludedUnits = excludedWorkUnitIds();
  const creditSatisfied = strictGapSatisfactionCreditApplies();
  const structuralMode = fullCloneStructuralExpansionRequested();
  const frontierMode = fullCloneFrontierExpansionRequested();
  const remediationMode = fullCloneRemediationExpansionRequested();
  const strictInventoryRemediationMode = fullCloneStrictInventoryRemediationExpansionActive({ remediationMode });
  const continuationMode = fullCloneContinuationExpansionActive({ structuralMode, remediationMode, strictInventoryRemediationMode });
  const gapRequiresCurrentExpansion = (gap) => strictGapInCurrentExpansionPool(gap, { structuralMode, remediationMode, strictInventoryRemediationMode });
  const currentExpansionGaps = continuationMode ? allGaps.filter((gap) => gapRequiresCurrentExpansion(gap)) : [];
  const continuationWaveIndex = continuationMode ? nextFullCloneContinuationWaveIndex(currentExpansionGaps) : null;
  const gapNeedsFreshContinuation = (gap) => continuationMode
    && gapRequiresCurrentExpansion(gap)
    && !strictGapContinuationAlreadySatisfied(gap, continuationWaveIndex);
  const durableFocusCompleteForPlanner = (gap, focusId) => verifiedDone.has(focusId) || (done.has(focusId) && !gapNeedsFreshContinuation(gap));
  const remaining = allGaps.filter((gap) => {
    const focusId = strictGapFocusId(gap);
    return !durableFocusCompleteForPlanner(gap, focusId)
      && !excluded.has(focusId)
      && (!structuralMode || gapRequiresCurrentExpansion(gap))
      && (!fullCloneSwarmRequested() || structuralMode || !strictGapSwarmAlreadySatisfied(gap))
      && (!structuralMode || frontierMode || remediationMode || !strictGapStructuralAlreadySatisfied(gap))
      && (!frontierMode || remediationMode || !strictGapFrontierAlreadySatisfied(gap))
      && (!remediationMode || continuationMode || !strictGapRemediationAlreadySatisfied(gap))
      && (!creditSatisfied || !strictGapAlreadySatisfied(gap.id));
  });
  const repair = allGaps.filter((gap) => {
    const focusId = strictGapFocusId(gap);
    return !durableFocusCompleteForPlanner(gap, focusId)
      && excluded.has(focusId)
      && (!structuralMode || gapRequiresCurrentExpansion(gap))
      && (!fullCloneSwarmRequested() || structuralMode || !strictGapSwarmAlreadySatisfied(gap))
      && (!structuralMode || frontierMode || remediationMode || !strictGapStructuralAlreadySatisfied(gap))
      && (!frontierMode || remediationMode || !strictGapFrontierAlreadySatisfied(gap))
      && (!remediationMode || continuationMode || !strictGapRemediationAlreadySatisfied(gap))
      && (!creditSatisfied || !strictGapAlreadySatisfied(gap.id));
  });
  if (!strictGapInventoryEnabled()) return { allGaps, selectedGaps: [], excludedFocusIds: excluded, excludedWorkUnitIds: excludedUnits, verifiedCompletedFocusIds: verifiedDone };
  if (fullCloneSwarmRequested()) return { allGaps, selectedGaps: [...remaining, ...repair], excludedFocusIds: excluded, excludedWorkUnitIds: excludedUnits, verifiedCompletedFocusIds: verifiedDone, repairFocusIds: new Set(repair.map((gap) => strictGapFocusId(gap))), swarmMode: true, structuralMode, frontierMode, remediationMode, strictInventoryRemediationMode, continuationMode };
  if (!strictGapSequenceEnabled()) return { allGaps, selectedGaps: [...remaining, ...repair], excludedFocusIds: excluded, excludedWorkUnitIds: excludedUnits, verifiedCompletedFocusIds: verifiedDone, repairFocusIds: new Set(repair.map((gap) => strictGapFocusId(gap))) };
  if (requestedFidelity() === 'parity_for_scope') {
    return { allGaps, selectedGaps: remaining, excludedFocusIds: excluded, excludedWorkUnitIds: excludedUnits, verifiedCompletedFocusIds: verifiedDone };
  }
  const selectedGaps = remaining.length > 0 ? [remaining[0]] : repair.length > 0 ? [repair[0]] : [];
  return { allGaps, selectedGaps, excludedFocusIds: excluded, excludedWorkUnitIds: excludedUnits, verifiedCompletedFocusIds: verifiedDone, repairFocusIds: new Set(repair.map((gap) => strictGapFocusId(gap))) };
}

function swarmRolePlan(agentCount = requestedAgentCount()) {
  const planners = Math.max(2, Math.ceil(agentCount * 0.08));
  const verifiers = Math.max(8, Math.ceil(agentCount * 0.20));
  const watchers = Math.max(2, Math.ceil(agentCount * 0.05));
  const expanders = Math.max(2, Math.ceil(agentCount * 0.05));
  const mergeAdmission = Math.max(4, Math.ceil(agentCount * 0.07));
  const implementers = Math.max(1, agentCount - planners - verifiers - watchers - expanders - mergeAdmission);
  return {
    requestedAgentCount: agentCount,
    planners,
    implementers,
    verifiers,
    mergeAdmission,
    watchers,
    expanders,
    roles: ['objective_planner', 'shard_planner', 'implementer', 'verifier', 'merge_admission', 'supervisor_watch', 'objective_expander']
  };
}

function sanitizeShardLabel(value = '') {
  return String(value || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'leaf';
}

function swarmLeafProductModulePath(gap = {}, filePath = '', leafIndex = 0) {
  const surface = sanitizeShardLabel(gap.id || 'surface');
  const source = sanitizeShardLabel(path.basename(filePath || `leaf-${leafIndex + 1}.mjs`, path.extname(filePath || '')));
  return `packages/app/full-clone-swarm/${surface}/${String(leafIndex + 1).padStart(3, '0')}-${source}.mjs`;
}

const FULL_CLONE_STRUCTURAL_PHASES = Object.freeze([
  {
    id: 'client_runtime_state',
    title: 'client runtime state and browser handoff',
    acceptance: 'Expose a product module that models browser-visible state, hydration inputs, and actor/session handoff for this surface.'
  },
  {
    id: 'workflow_state_machine',
    title: 'workflow state machine and transition rules',
    acceptance: 'Define product state transitions, validation states, review gates, and completion/recovery paths for this surface.'
  },
  {
    id: 'data_contract_persistence',
    title: 'data contract and persistence boundary',
    acceptance: 'Specify durable entities, idempotent writes, migration-ready fields, and read models needed for this surface.'
  },
  {
    id: 'service_integration_boundary',
    title: 'service integration boundary and provider seams',
    acceptance: 'Model external/provider handoffs, retries, authorization scopes, and degraded-mode behavior for this surface.'
  },
  {
    id: 'browser_interaction_model',
    title: 'browser interaction model and UI affordances',
    acceptance: 'Represent the user-visible interaction affordances, loading states, keyboard/a11y hooks, and undo/preview behavior.'
  },
  {
    id: 'audit_observability',
    title: 'audit, observability, and analytics evidence',
    acceptance: 'Emit product-level audit events, analytics measurements, warning states, and traceable operational evidence.'
  },
  {
    id: 'permission_compliance',
    title: 'permission, compliance, and role coverage',
    acceptance: 'Capture role-specific access, compliance checks, consent/suppression or approval constraints, and safety messaging.'
  },
  {
    id: 'operational_recovery',
    title: 'operational recovery and support workflows',
    acceptance: 'Define retry, resume, handoff, support/admin recovery, and fallback behavior for interrupted or failed work.'
  }
]);

const FULL_CLONE_FRONTIER_PHASES = Object.freeze([
  {
    id: 'rich_client_application_spine',
    title: 'rich client application spine and editor host',
    acceptance: 'Define a client-app spine for this surface with route hydration, editor host state, command handling, and browser persistence boundaries.'
  },
  {
    id: 'collaborative_editor_runtime',
    title: 'collaborative editor runtime and interaction contract',
    acceptance: 'Model drag/drop, inline edits, undo/redo, preview, keyboard accessibility, collaboration locks, and recoverable editor commands.'
  },
  {
    id: 'production_database_concurrency',
    title: 'production database concurrency and migration contract',
    acceptance: 'Specify normalized entities, migrations, optimistic concurrency, transactional writes, idempotency keys, and read-model projections.'
  },
  {
    id: 'external_provider_runtime',
    title: 'external provider runtime and credential boundary',
    acceptance: 'Define OAuth/credential storage, provider request lifecycle, refresh/retry policy, webhook ingestion, and provider-specific failure semantics.'
  },
  {
    id: 'delivery_analytics_pipeline',
    title: 'delivery and analytics streaming pipeline',
    acceptance: 'Model queued delivery, event ingestion, attribution, rollups, replay, lag metrics, and report-consistency guarantees.'
  },
  {
    id: 'enterprise_security_governance',
    title: 'enterprise security governance and compliance program',
    acceptance: 'Capture CSRF, RBAC, MFA/SSO, audit export, data retention, consent, suppression, and workspace boundary protections.'
  },
  {
    id: 'operational_control_plane',
    title: 'operational control plane and support recovery',
    acceptance: 'Define admin/support workflows, incident recovery, dead-letter replay, diagnostics, user-facing degraded states, and escalation handoffs.'
  },
  {
    id: 'browser_backed_parity_evidence',
    title: 'browser-backed parity evidence and negative-space checks',
    acceptance: 'Attach browser-visible journeys, negative-space coverage, acceptance probes, and proof hooks that prevent route-presence-only parity claims.'
  }
]);

const FULL_CLONE_REMEDIATION_PHASES = Object.freeze([
  {
    id: 'client_app_runtime_adoption',
    title: 'client application runtime adoption slice',
    acceptance: 'Move this gap from isolated frontier evidence toward a first-class product runtime slice with hydrate/mount state, route handoff, command dispatch, and browser-visible recovery.'
  },
  {
    id: 'editor_interaction_runtime',
    title: 'editor interaction runtime slice',
    acceptance: 'Add product-code contracts for drag/drop, inline edit, preview, undo/redo, keyboard accessibility, conflict locks, and recoverable editor actions.'
  },
  {
    id: 'database_transaction_model',
    title: 'database transaction and concurrency slice',
    acceptance: 'Define production-grade transaction envelopes, optimistic concurrency, idempotency, migration state, and normalized entity projections for this gap.'
  },
  {
    id: 'read_model_projection_runtime',
    title: 'read model projection runtime slice',
    acceptance: 'Expose durable read models, materialized summaries, cursor pagination, replay checkpoints, and staleness/error handling required by this surface.'
  },
  {
    id: 'external_oauth_provider_runtime',
    title: 'external OAuth/provider runtime slice',
    acceptance: 'Model credential exchange, refresh, scope drift, provider retry/backoff, webhook verification, and provider-specific degraded states without local-only shortcuts.'
  },
  {
    id: 'delivery_queue_worker_runtime',
    title: 'delivery queue and worker runtime slice',
    acceptance: 'Define queue leases, worker execution boundaries, retry/dead-letter handling, idempotent delivery, and operational lag metrics.'
  },
  {
    id: 'analytics_event_stream_runtime',
    title: 'analytics event stream runtime slice',
    acceptance: 'Define event ingestion, attribution, replay, rollup consistency, report freshness, and non-deterministic telemetry handoffs for this surface.'
  },
  {
    id: 'security_governance_runtime',
    title: 'security governance runtime slice',
    acceptance: 'Add product-code controls for CSRF, RBAC, MFA/SSO handoff, consent, audit export, retention, suppression, and enterprise workspace boundaries.'
  },
  {
    id: 'support_recovery_runtime',
    title: 'support recovery and admin control slice',
    acceptance: 'Define admin/support diagnostics, incident recovery, replay, operator-visible failure state, and escalation handoff for this gap.'
  },
  {
    id: 'browser_evidence_acceptance_runtime',
    title: 'browser evidence and acceptance runtime slice',
    acceptance: 'Attach browser-backed acceptance probes, negative-space checks, fixture-free data hooks, and proof metadata that prevents scoped-green/no-throughput completion.'
  },
  {
    id: 'multi_tenant_workspace_boundaries',
    title: 'multi-tenant workspace boundary slice',
    acceptance: 'Model workspace/account isolation, organization switching, ownership transfer, tenant-scoped reads/writes, and cross-workspace denial evidence for this surface.'
  },
  {
    id: 'service_backed_provider_contracts',
    title: 'service-backed provider contract slice',
    acceptance: 'Define product contracts for external service adapters, provider capability discovery, credential rotation, webhook replay, and degraded-mode fallbacks without presenting local stubs as provider parity.'
  },
  {
    id: 'asset_rendering_pipeline_runtime',
    title: 'asset rendering and delivery pipeline slice',
    acceptance: 'Add product-code contracts for image/file asset normalization, template rendering, CDN/cache metadata, preview fidelity, and recoverable publish/delivery handoff.'
  },
  {
    id: 'workflow_approval_lifecycle_runtime',
    title: 'workflow approval and lifecycle slice',
    acceptance: 'Represent draft/review/approval/publish/archive lifecycle state, reviewer handoff, lock ownership, revision lineage, rollback, and audit-visible transition evidence.'
  },
  {
    id: 'data_privacy_compliance_runtime',
    title: 'data privacy and compliance runtime slice',
    acceptance: 'Capture GDPR/CCPA-style deletion, consent provenance, suppression boundaries, retention windows, exportability, legal hold, and compliance audit metadata for this surface.'
  },
  {
    id: 'observability_sla_runtime',
    title: 'observability and SLA runtime slice',
    acceptance: 'Attach product observability contracts for health signals, lag/error budgets, customer-visible degraded states, operator diagnostics, and recovery evidence.'
  },
  {
    id: 'import_export_migration_runtime',
    title: 'import/export and migration runtime slice',
    acceptance: 'Model bulk import/export jobs, schema mapping, validation errors, resumable migration checkpoints, reconciliation reports, and user-facing recovery workflows.'
  },
  {
    id: 'experimentation_optimization_runtime',
    title: 'experimentation and optimization runtime slice',
    acceptance: 'Define A/B and multivariate experiment contracts, winner selection, send-time/content optimization handoff, statistical guardrails, and rollback-safe result adoption.'
  },
  {
    id: 'realtime_collaboration_presence_runtime',
    title: 'real-time collaboration and presence slice',
    acceptance: 'Represent collaborator presence, cursor/comment state, conflict resolution, edit locks, autosave reconciliation, and accessibility-aware collaborative recovery.'
  },
  {
    id: 'billing_entitlement_usage_runtime',
    title: 'billing entitlement and usage runtime slice',
    acceptance: 'Connect surface behavior to plan entitlements, usage metering, overage/degrade rules, invoice/audit evidence, and role-aware upgrade or restriction workflows.'
  },
  {
    id: 'api_rate_limit_webhook_delivery_runtime',
    title: 'API rate-limit and webhook delivery slice',
    acceptance: 'Define API quota buckets, idempotency keys, request signing, webhook retry/dead-letter semantics, subscriber diagnostics, and replay-safe delivery evidence.'
  },
  {
    id: 'negative_space_parity_acceptance_runtime',
    title: 'negative-space parity acceptance slice',
    acceptance: 'List missing Mailchimp behaviors for this surface as executable acceptance gaps, bind them to product probes, and prevent future scoped-green claims while evidence remains absent.'
  },
  {
    id: 'enterprise_account_governance_runtime',
    title: 'enterprise account governance runtime slice',
    acceptance: 'Model enterprise account hierarchy, sub-account delegation, approval chains, workspace transfer, impersonation audit, and tenant-safe governance evidence for this surface.'
  },
  {
    id: 'data_residency_retention_runtime',
    title: 'data residency and retention runtime slice',
    acceptance: 'Define region-aware storage boundaries, retention policy evaluation, purge queues, legal hold exceptions, and customer-visible residency/retention controls.'
  },
  {
    id: 'consent_preference_center_runtime',
    title: 'consent and preference-center runtime slice',
    acceptance: 'Represent granular consent capture, preference-center updates, unsubscribe propagation, suppression conflict handling, and audit-ready consent provenance.'
  },
  {
    id: 'deliverability_reputation_runtime',
    title: 'deliverability and reputation runtime slice',
    acceptance: 'Add deliverability health, authentication checks, bounce/complaint feedback loops, sender reputation state, throttling, and remediation guidance contracts.'
  },
  {
    id: 'template_versioning_localization_runtime',
    title: 'template versioning and localization runtime slice',
    acceptance: 'Model template version lineage, localized variants, merge conflicts, approval state, asset fallback, and rollback-safe publishing for this surface.'
  },
  {
    id: 'audience_dedup_identity_resolution_runtime',
    title: 'audience deduplication and identity-resolution slice',
    acceptance: 'Define contact identity matching, duplicate resolution, merge previews, survivorship rules, source trust scoring, and reversible identity audit evidence.'
  },
  {
    id: 'journey_backfill_replay_runtime',
    title: 'journey backfill and replay runtime slice',
    acceptance: 'Represent automation backfill, event replay, skipped-step recovery, idempotent re-entry, delayed trigger reconciliation, and operator-visible replay diagnostics.'
  },
  {
    id: 'cross_channel_attribution_runtime',
    title: 'cross-channel attribution runtime slice',
    acceptance: 'Define attribution windows, channel normalization, conversion joins, assisted revenue, delayed event correction, and report freshness guarantees across this surface.'
  },
  {
    id: 'marketplace_app_review_runtime',
    title: 'marketplace app review and installation runtime slice',
    acceptance: 'Model app review status, permission changes, install rollback, provider health, customer support diagnostics, and marketplace compliance evidence.'
  },
  {
    id: 'incident_response_admin_runtime',
    title: 'incident response and admin runtime slice',
    acceptance: 'Define admin incident playbooks, customer impact state, freeze/unfreeze controls, remediation logs, support handoff, and post-incident audit evidence.'
  },
  {
    id: 'performance_accessibility_budget_runtime',
    title: 'performance and accessibility budget runtime slice',
    acceptance: 'Attach performance budgets, accessibility conformance checks, progressive enhancement fallbacks, degradation alerts, and browser-visible acceptance evidence.'
  },
  {
    id: 'full_stack_parity_evidence_runtime',
    title: 'full-stack parity evidence runtime slice',
    acceptance: 'Bind UI, route, domain, storage, queue, provider, analytics, and browser proof into one evidence envelope so this surface cannot pass from isolated helper modules alone.'
  }
]);

function fullCloneContinuationPhaseId(waveIndex = 1, phaseId = '') {
  return `continuation_wave_${String(Math.max(1, Number(waveIndex) || 1)).padStart(3, '0')}_${sanitizeShardLabel(phaseId || 'runtime')}`;
}

function fullCloneContinuationPhases(waveIndex = 1) {
  const normalizedWave = Math.max(1, Number(waveIndex) || 1);
  return FULL_CLONE_REMEDIATION_PHASES.map((phase) => ({
    ...phase,
    id: fullCloneContinuationPhaseId(normalizedWave, phase.id),
    title: `continuation wave ${String(normalizedWave).padStart(3, '0')} — ${phase.title}`,
    acceptance: `${phase.acceptance} Continue after the prior remediation matrix saturated while strict full-clone parity remained red; add a fresh primary-runtime adoption proof instead of replaying old phase ids.`
  }));
}

function structuralLeafProductModulePath(gap = {}, phase = {}, phaseIndex = 0) {
  const surface = sanitizeShardLabel(gap.id || 'surface');
  const phaseId = sanitizeShardLabel(phase.id || `phase-${phaseIndex + 1}`);
  return `packages/app/full-clone-structural/${surface}/${String(phaseIndex + 1).padStart(3, '0')}-${phaseId}.mjs`;
}

function frontierLeafProductModulePath(gap = {}, phase = {}, phaseIndex = 0) {
  const surface = sanitizeShardLabel(gap.id || 'surface');
  const phaseId = sanitizeShardLabel(phase.id || `phase-${phaseIndex + 1}`);
  return `packages/app/full-clone-frontier/${surface}/${String(phaseIndex + 1).padStart(3, '0')}-${phaseId}.mjs`;
}

function remediationLeafProductModulePath(gap = {}, phase = {}, phaseIndex = 0) {
  const surface = sanitizeShardLabel(gap.id || 'surface');
  const phaseId = sanitizeShardLabel(phase.id || `phase-${phaseIndex + 1}`);
  return `packages/app/full-clone-remediation/${surface}/${String(phaseIndex + 1).padStart(3, '0')}-${phaseId}.mjs`;
}

const PRIMARY_RUNTIME_ADOPTION_TARGETS = Object.freeze({
  client: ['apps/web/public/app-shell.jsx', 'apps/web/public/app-shell.css', 'packages/app/view.mjs', 'packages/app/routes/public.mjs', 'packages/app/routes/platform.mjs'],
  editor: ['apps/web/public/app-shell.jsx', 'packages/app/view.mjs', 'packages/app/domain-website-builder.mjs', 'packages/app/domain-campaigns.mjs', 'packages/app/routes/website-builder.mjs', 'packages/app/routes/campaigns.mjs'],
  persistence: ['packages/app/storage.mjs', 'packages/app/persistence-io.mjs', 'packages/app/jobs.mjs', 'packages/app/job-runtime.mjs', 'packages/app/job-handlers.mjs'],
  provider: ['packages/app/integration-provider.mjs', 'packages/app/service-backends.mjs', 'packages/app/ai-provider.mjs', 'packages/app/domain-integration-marketplace.mjs', 'packages/app/routes/api-admin.mjs'],
  operations: ['packages/app/jobs.mjs', 'packages/app/job-runtime.mjs', 'packages/app/job-handlers.mjs', 'packages/app/analytics-events.mjs', 'packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs'],
  security: ['packages/app/security.mjs', 'packages/app/http-runtime.mjs', 'packages/app/storage.mjs', 'packages/app/routes/platform.mjs', 'packages/app/routes/api-admin.mjs'],
  commerce: ['packages/app/domain-commerce-revenue.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/routes/platform.mjs'],
  audience: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs', 'packages/app/storage.mjs'],
  experiment: ['packages/app/experiment-engine.mjs', 'packages/app/predictive-model.mjs', 'packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs'],
  evidence: ['packages/app/primary-architecture.mjs', 'packages/app/production-architecture.mjs', 'packages/app/routes/architecture.mjs', 'packages/app/routes/platform.mjs']
});

function remediationPhasePrimaryRuntimeTargets(phaseId = '') {
  const normalized = String(phaseId || '').trim().toLowerCase();
  if (/client|browser|negative_space|frontend|accessibility/.test(normalized)) return PRIMARY_RUNTIME_ADOPTION_TARGETS.client;
  if (/editor|asset|template|workflow|collaboration|realtime/.test(normalized)) return PRIMARY_RUNTIME_ADOPTION_TARGETS.editor;
  if (/database|read_model|import_export|migration|data_residency|retention|dedup|identity/.test(normalized)) return PRIMARY_RUNTIME_ADOPTION_TARGETS.persistence;
  if (/oauth|provider|service|marketplace|api_rate|webhook|deliverability|consent|preference/.test(normalized)) return PRIMARY_RUNTIME_ADOPTION_TARGETS.provider;
  if (/delivery|queue|analytics|observability|support|recovery|journey|backfill|attribution/.test(normalized)) return PRIMARY_RUNTIME_ADOPTION_TARGETS.operations;
  if (/security|governance|privacy|compliance|tenant|workspace|enterprise|account/.test(normalized)) return PRIMARY_RUNTIME_ADOPTION_TARGETS.security;
  if (/billing|entitlement|usage/.test(normalized)) return PRIMARY_RUNTIME_ADOPTION_TARGETS.commerce;
  if (/audience/.test(normalized)) return PRIMARY_RUNTIME_ADOPTION_TARGETS.audience;
  if (/experimentation|optimization/.test(normalized)) return PRIMARY_RUNTIME_ADOPTION_TARGETS.experiment;
  return PRIMARY_RUNTIME_ADOPTION_TARGETS.evidence;
}

function existingProductFiles(filePaths = []) {
  return Array.from(new Set(filePaths.filter((filePath) => {
    const normalized = String(filePath || '').trim();
    return normalized && !normalized.startsWith('packages/app/full-clone-') && fs.existsSync(path.join(ROOT, normalized));
  })));
}

function sourceBackedSwarmLeafRuntimeTarget(gap = {}, sourceFilePath = '', leafModulePath = '') {
  const normalizedGapId = String(gap.id || '').trim();
  const normalizedSource = String(sourceFilePath || '').trim();
  const defaultTarget = {
    sourceBacked: false,
    fileAreas: [leafModulePath],
    allowedFiles: [leafModulePath],
    importFile: leafModulePath,
    extraImportFiles: [],
    primaryProductAdoptionRequired: false,
    primaryAdoptionFiles: []
  };
  if (normalizedGapId !== 'api_keys_webhooks') return defaultTarget;
  if (!/^(apps|packages|src|public)\/.+\.(?:mjs|js|jsx|css|ts|tsx)$/.test(normalizedSource)) return defaultTarget;
  if (normalizedSource.startsWith('packages/app/full-clone-')) return defaultTarget;
  if (!fs.existsSync(path.join(ROOT, normalizedSource))) return defaultTarget;
  const allowedFiles = Array.from(new Set([leafModulePath, normalizedSource].filter(Boolean)));
  return {
    sourceBacked: true,
    fileAreas: allowedFiles,
    allowedFiles,
    importFile: normalizedSource,
    extraImportFiles: [],
    primaryProductAdoptionRequired: true,
    primaryAdoptionFiles: [normalizedSource]
  };
}

function remediationPrimaryAdoptionFiles({ sourceFiles = [], phase = {} } = {}) {
  const phaseTargets = remediationPhasePrimaryRuntimeTargets(phase.id);
  const preferredSourceFiles = sourceFiles.filter((filePath) => !String(filePath || '').startsWith('packages/app/full-clone-'));
  const existing = existingProductFiles([...preferredSourceFiles, ...phaseTargets]);
  return existing.length > 0 ? existing : existingProductFiles(phaseTargets);
}

function expandStrictGapIntoSwarmLeaves(gap = {}, index = 0) {
  const focusId = strictGapFocusId(gap);
  const allowedFiles = Array.from(new Set([
    ...expandStrictGapCandidateAreas(gap.candidateAreas || []),
    ...resolveStrictGapImplementationFiles(gap.id)
  ]));
  const targetedTests = resolveStrictGapTargetedTests(gap.id);
  const focusGroup = resolveStrictGapFocusGroup(gap.id);
  const requiredVerifiers = productOnlyVerifiers(['tests']);
  const sourceFiles = allowedFiles.length > 0 ? allowedFiles : [`packages/app/${sanitizeShardLabel(gap.id)}.mjs`];
  return sourceFiles.map((sourceFilePath, leafIndex) => {
    const shardFocusId = `${focusId}#${leafIndex + 1}`;
    const leafModulePath = swarmLeafProductModulePath(gap, sourceFilePath, leafIndex);
    const runtimeTarget = sourceBackedSwarmLeafRuntimeTarget(gap, sourceFilePath, leafModulePath);
    const acceptanceChecks = [
      runtimeTarget.sourceBacked
        ? `Modify source runtime ${sourceFilePath} for ${gap.title}; do not credit an isolated leaf-only module`
        : `Create or modify ${leafModulePath} for ${gap.title}`,
      `Ground the leaf in source product area ${sourceFilePath}`,
      `Keep the change grounded to ${gap.id} full-clone parity`,
      ...targetedTests.slice(0, 2).map((testPath) => `Produce executable evidence for ${testPath}`)
    ];
    return {
      id: shardFocusId,
      title: `${gap.title} — ${path.basename(sourceFilePath)} leaf`,
      wave: `swarm_gap_${String(index + 1).padStart(2, '0')}`,
      lane: focusGroup,
      domain: 'mailchimp_full_clone_swarm',
      fileAreas: runtimeTarget.fileAreas,
      allowedFiles: runtimeTarget.allowedFiles,
      acceptanceChecks,
      requiredVerifiers: Array.from(new Set(['lint', 'imports', ...requiredVerifiers])),
      evidence: targetedTests,
      dependsOn: [],
      metadata: {
        focusId,
        surfaceId: gap.id,
        surfaceFocusId: gap.id,
        rootFocusId: focusId,
        swarmLeafId: shardFocusId,
        swarmRole: 'implementer',
        importFile: runtimeTarget.importFile,
        sourceProductFile: sourceFilePath,
        extraImportFiles: runtimeTarget.extraImportFiles,
        sourceBackedSwarmLeaf: runtimeTarget.sourceBacked,
        primaryProductAdoptionRequired: runtimeTarget.primaryProductAdoptionRequired,
        primaryAdoptionFile: runtimeTarget.primaryAdoptionFiles[0] || null,
        primaryAdoptionFiles: runtimeTarget.primaryAdoptionFiles,
        testFile: targetedTests[0] || null,
        focusGroup,
        strictGap: true,
        broadFullCloneObjective: gap.broadFullCloneObjective === true,
        strictGapDetail: gap.detail || null,
        candidateAreas: gap.candidateAreas || [],
        assignmentContract: buildGroundedAssignmentContract({
          artifactKind: 'product_diff',
          allowedFiles: runtimeTarget.allowedFiles,
          fileAreas: runtimeTarget.fileAreas,
          requiredVerifiers: Array.from(new Set(['lint', 'imports', ...requiredVerifiers])),
          acceptanceChecks
        })
      }
    };
  });
}

function expandStrictGapIntoStructuralLeaves(gap = {}, index = 0) {
  const focusId = strictGapFocusId(gap);
  const targetedTests = resolveStrictGapTargetedTests(gap.id);
  const focusGroup = resolveStrictGapFocusGroup(gap.id);
  const sourceFiles = Array.from(new Set([
    ...expandStrictGapCandidateAreas(gap.candidateAreas || []),
    ...resolveStrictGapImplementationFiles(gap.id)
  ])).filter(Boolean);
  const sourceProductFile = sourceFiles[0] || `packages/app/${sanitizeShardLabel(gap.id)}.mjs`;
  const requiredVerifiers = productOnlyVerifiers(['tests']);
  return FULL_CLONE_STRUCTURAL_PHASES.map((phase, phaseIndex) => {
    const shardFocusId = `${focusId}::structural#${phaseIndex + 1}`;
    const leafModulePath = structuralLeafProductModulePath(gap, phase, phaseIndex);
    const acceptanceChecks = [
      `Create ${leafModulePath} as a structural product module for ${gap.title}`,
      phase.acceptance,
      `Ground the work in ${sourceProductFile} and the ${gap.id} full-clone parity gap`,
      'Export executable product readiness helpers, not benchmark-only wrappers',
      ...targetedTests.slice(0, 2).map((testPath) => `Produce executable evidence for ${testPath}`)
    ];
    return {
      id: shardFocusId,
      title: `${gap.title} — ${phase.title}`,
      wave: `structural_gap_${String(index + 1).padStart(2, '0')}`,
      lane: focusGroup,
      domain: 'mailchimp_full_clone_structural',
      fileAreas: [leafModulePath],
      allowedFiles: [leafModulePath],
      acceptanceChecks,
      requiredVerifiers: Array.from(new Set(['lint', 'imports', ...requiredVerifiers])),
      evidence: targetedTests,
      dependsOn: [],
      metadata: {
        focusId,
        surfaceId: gap.id,
        surfaceFocusId: gap.id,
        rootFocusId: focusId,
        structuralLeafId: shardFocusId,
        structuralPhaseId: phase.id,
        structuralPhaseTitle: phase.title,
        swarmRole: 'implementer',
        importFile: leafModulePath,
        sourceProductFile,
        sourceProductFiles: sourceFiles,
        extraImportFiles: [],
        testFile: targetedTests[0] || null,
        focusGroup,
        strictGap: true,
        structuralFullClone: true,
        broadFullCloneObjective: gap.broadFullCloneObjective === true,
        strictGapDetail: gap.detail || null,
        candidateAreas: gap.candidateAreas || [],
        assignmentContract: buildGroundedAssignmentContract({
          artifactKind: 'product_diff',
          allowedFiles: [leafModulePath],
          fileAreas: [leafModulePath],
          requiredVerifiers: Array.from(new Set(['lint', 'imports', ...requiredVerifiers])),
          acceptanceChecks
        })
      }
    };
  });
}

function expandStrictGapIntoFrontierLeaves(gap = {}, index = 0) {
  const focusId = strictGapFocusId(gap);
  const targetedTests = resolveStrictGapTargetedTests(gap.id);
  const focusGroup = resolveStrictGapFocusGroup(gap.id);
  const sourceFiles = Array.from(new Set([
    ...expandStrictGapCandidateAreas(gap.candidateAreas || []),
    ...resolveStrictGapImplementationFiles(gap.id)
  ])).filter(Boolean);
  const sourceProductFile = sourceFiles[0] || `packages/app/${sanitizeShardLabel(gap.id)}.mjs`;
  const requiredVerifiers = productOnlyVerifiers(['tests']);
  return FULL_CLONE_FRONTIER_PHASES.map((phase, phaseIndex) => {
    const shardFocusId = `${focusId}::frontier#${phaseIndex + 1}`;
    const leafModulePath = frontierLeafProductModulePath(gap, phase, phaseIndex);
    const acceptanceChecks = [
      `Create ${leafModulePath} as the next-frontier structural product module for ${gap.title}`,
      phase.acceptance,
      `Ground the new frontier work in ${sourceProductFile} and the ${gap.id} full-clone strict-ceiling gap`,
      'Advance beyond saturated swarm/structural leaf modules; do not replay existing full-clone-structural paths',
      'Export executable product frontier helpers that model real client, database, or external-service parity requirements',
      ...targetedTests.slice(0, 2).map((testPath) => `Produce executable evidence for ${testPath}`)
    ];
    return {
      id: shardFocusId,
      title: `${gap.title} — ${phase.title}`,
      wave: `frontier_gap_${String(index + 1).padStart(2, '0')}`,
      lane: focusGroup,
      domain: 'mailchimp_full_clone_frontier',
      fileAreas: [leafModulePath],
      allowedFiles: [leafModulePath],
      acceptanceChecks,
      requiredVerifiers: Array.from(new Set(['lint', 'imports', ...requiredVerifiers])),
      evidence: targetedTests,
      dependsOn: [],
      metadata: {
        focusId,
        surfaceId: gap.id,
        surfaceFocusId: gap.id,
        rootFocusId: focusId,
        frontierLeafId: shardFocusId,
        structuralLeafId: shardFocusId,
        structuralPhaseId: phase.id,
        structuralPhaseTitle: phase.title,
        swarmRole: 'implementer',
        importFile: leafModulePath,
        sourceProductFile,
        sourceProductFiles: sourceFiles,
        extraImportFiles: [],
        testFile: targetedTests[0] || null,
        focusGroup,
        strictGap: true,
        structuralFullClone: true,
        frontierFullClone: true,
        broadFullCloneObjective: gap.broadFullCloneObjective === true,
        strictGapDetail: gap.detail || null,
        candidateAreas: gap.candidateAreas || [],
        assignmentContract: buildGroundedAssignmentContract({
          artifactKind: 'product_diff',
          allowedFiles: [leafModulePath],
          fileAreas: [leafModulePath],
          requiredVerifiers: Array.from(new Set(['lint', 'imports', ...requiredVerifiers])),
          acceptanceChecks
        })
      }
    };
  });
}

function expandStrictGapIntoRemediationLeaves(gap = {}, index = 0, options = {}) {
  const phases = Array.isArray(options.phases) && options.phases.length > 0 ? options.phases : FULL_CLONE_REMEDIATION_PHASES;
  const continuationWaveIndex = options.continuationWaveIndex || null;
  const focusId = strictGapFocusId(gap);
  const targetedTests = resolveStrictGapTargetedTests(gap.id);
  const focusGroup = resolveStrictGapFocusGroup(gap.id);
  const sourceFiles = Array.from(new Set([
    ...expandStrictGapCandidateAreas(gap.candidateAreas || []),
    ...resolveStrictGapImplementationFiles(gap.id)
  ])).filter(Boolean);
  const sourceProductFile = sourceFiles[0] || `packages/app/${sanitizeShardLabel(gap.id)}.mjs`;
  const requiredVerifiers = productOnlyVerifiers(['tests']);
  return phases.map((phase, phaseIndex) => {
    const shardFocusId = continuationWaveIndex
      ? `${focusId}::continuation-${String(continuationWaveIndex).padStart(3, '0')}#${phaseIndex + 1}`
      : `${focusId}::remediation#${phaseIndex + 1}`;
    const leafModulePath = remediationLeafProductModulePath(gap, phase, phaseIndex);
    const primaryAdoptionFiles = remediationPrimaryAdoptionFiles({ sourceFiles, phase });
    const primaryAdoptionFile = primaryAdoptionFiles.find((filePath) => /\.(mjs|js)$/.test(filePath)) || primaryAdoptionFiles[0] || sourceProductFile;
    const acceptanceChecks = [
      `Modify a primary runtime adoption target for ${gap.title}, starting with ${primaryAdoptionFile}`,
      phase.acceptance,
      `Ground the remediation work in ${sourceProductFile} and the ${gap.id} strict 1:1 blocker`,
      `Do not create or modify isolated remediation module ${leafModulePath} for completion credit`,
      'Advance beyond saturated swarm, structural, frontier, and remediation leaf modules by wiring adoption evidence into primary client, database, provider, queue, security, or browser-evidence architecture',
      ...(continuationWaveIndex ? [`This is continuation wave ${String(continuationWaveIndex).padStart(3, '0')}; use the fresh phase id ${phase.id} so saturated prior waves cannot produce a zero-work graph.`] : []),
      ...targetedTests.slice(0, 2).map((testPath) => `Produce executable evidence for ${testPath}`)
    ];
    return {
      id: shardFocusId,
      title: `${gap.title} — ${phase.title}`,
      wave: continuationWaveIndex ? `continuation_gap_${String(index + 1).padStart(2, '0')}_wave_${String(continuationWaveIndex).padStart(3, '0')}` : `remediation_gap_${String(index + 1).padStart(2, '0')}`,
      lane: focusGroup,
      domain: continuationWaveIndex ? 'mailchimp_full_clone_continuation' : 'mailchimp_full_clone_remediation',
      fileAreas: primaryAdoptionFiles,
      allowedFiles: primaryAdoptionFiles,
      acceptanceChecks,
      requiredVerifiers: Array.from(new Set(['lint', 'imports', ...requiredVerifiers])),
      evidence: targetedTests,
      dependsOn: [],
      metadata: {
        focusId,
        surfaceId: gap.id,
        surfaceFocusId: gap.id,
        rootFocusId: focusId,
        remediationLeafId: shardFocusId,
        frontierLeafId: shardFocusId,
        structuralLeafId: shardFocusId,
        structuralPhaseId: phase.id,
        structuralPhaseTitle: phase.title,
        swarmRole: 'implementer',
        importFile: primaryAdoptionFile,
        sourceProductFile,
        sourceProductFiles: sourceFiles,
        remediationModulePath: leafModulePath,
        primaryProductAdoptionRequired: true,
        primaryAdoptionFile,
        primaryAdoptionFiles,
        extraImportFiles: [],
        testFile: targetedTests[0] || null,
        focusGroup,
        strictGap: true,
        structuralFullClone: true,
        frontierFullClone: true,
        remediationFullClone: true,
        continuationFullClone: continuationWaveIndex ? true : false,
        continuationWaveIndex,
        broadFullCloneObjective: gap.broadFullCloneObjective === true,
        strictGapDetail: gap.detail || null,
        candidateAreas: gap.candidateAreas || [],
        assignmentContract: buildGroundedAssignmentContract({
          artifactKind: 'product_diff',
          allowedFiles: primaryAdoptionFiles,
          fileAreas: primaryAdoptionFiles,
          requiredVerifiers: Array.from(new Set(['lint', 'imports', ...requiredVerifiers])),
          acceptanceChecks
        })
      }
    };
  });
}

function swarmLeafUnitAlreadySatisfied(unit = {}) {
  const filePath = Array.isArray(unit.allowedFiles) ? unit.allowedFiles[0] : null;
  if (!filePath) return false;
  return fs.existsSync(path.join(ROOT, filePath)) && fileContains(filePath, 'full_clone_swarm_leaf_evaluated');
}

export function strictGapSwarmAlreadySatisfied(gap = {}) {
  const leaves = expandStrictGapIntoSwarmLeaves(gap, 0);
  return leaves.length > 0 && leaves.every((unit) => swarmLeafUnitAlreadySatisfied(unit));
}

function structuralLeafUnitAlreadySatisfied(unit = {}) {
  const filePath = Array.isArray(unit.allowedFiles) ? unit.allowedFiles[0] : null;
  if (!filePath) return false;
  return fs.existsSync(path.join(ROOT, filePath)) && fileContains(filePath, 'full_clone_structural_leaf_evaluated');
}

export function strictGapStructuralAlreadySatisfied(gap = {}) {
  const leaves = expandStrictGapIntoStructuralLeaves(gap, 0);
  return leaves.length > 0 && leaves.every((unit) => structuralLeafUnitAlreadySatisfied(unit));
}

function frontierLeafUnitAlreadySatisfied(unit = {}) {
  const filePath = Array.isArray(unit.allowedFiles) ? unit.allowedFiles[0] : null;
  if (!filePath) return false;
  return fs.existsSync(path.join(ROOT, filePath)) && fileContains(filePath, 'full_clone_frontier_leaf_evaluated');
}

export function strictGapFrontierAlreadySatisfied(gap = {}) {
  const leaves = expandStrictGapIntoFrontierLeaves(gap, 0);
  return leaves.length > 0 && leaves.every((unit) => frontierLeafUnitAlreadySatisfied(unit));
}

export function remediationLeafUnitAlreadySatisfied(unit = {}) {
  const phaseId = unit?.metadata?.structuralPhaseId;
  const surfaceId = unit?.metadata?.surfaceId;
  const adoptionFiles = Array.isArray(unit?.metadata?.primaryAdoptionFiles)
    ? unit.metadata.primaryAdoptionFiles
    : (Array.isArray(unit.allowedFiles) ? unit.allowedFiles : []);
  const primaryRuntimeFiles = adoptionFiles.filter((filePath) => String(filePath || '').trim() && !String(filePath || '').startsWith('packages/app/full-clone-'));
  if (primaryRuntimeFiles.length === 0 || !phaseId || !surfaceId) return false;
  return primaryRuntimeFiles.some((filePath) => {
    if (!fs.existsSync(path.join(ROOT, filePath))) return false;
    const markerSatisfied = fileContainsAll(filePath, [
      'full_clone_remediation_leaf_evaluated',
      `"structuralPhaseId": "${phaseId}"`,
      `"surfaceId": "${surfaceId}"`
    ]);
    const primaryAdoptionSatisfied = fileContainsAll(filePath, [
      'primary_runtime_adoption_evaluated',
      `surfaceId: "${surfaceId}"`,
      `phaseId: "${phaseId}"`
    ]);
    return markerSatisfied || primaryAdoptionSatisfied;
  });
}

export function strictGapRemediationAlreadySatisfied(gap = {}) {
  const leaves = expandStrictGapIntoRemediationLeaves(gap, 0);
  return leaves.length > 0 && leaves.every((unit) => remediationLeafUnitAlreadySatisfied(unit));
}

function strictGapContinuationAlreadySatisfied(gap = {}, waveIndex = 1) {
  const leaves = expandStrictGapIntoRemediationLeaves(gap, 0, {
    phases: fullCloneContinuationPhases(waveIndex),
    continuationWaveIndex: waveIndex
  });
  return leaves.length > 0 && leaves.every((unit) => remediationLeafUnitAlreadySatisfied(unit));
}

function strictInventoryGapRequiresFullCloneRemediation(gap = {}) {
  return gap?.broadFullCloneObjective !== true && gap?.requiredForFullClone === true;
}

function broadFullCloneRemediationAlreadySaturated() {
  const broadGaps = fullCloneBroadObjectiveGaps();
  return broadGaps.length > 0 && broadGaps.every((gap) => strictGapRemediationAlreadySatisfied(gap));
}

function remediationExpansionPoolGaps({ structuralMode = false, remediationMode = false, strictInventoryRemediationMode = false } = {}) {
  return fullCloneObjectiveInventory().filter((gap) => strictGapInCurrentExpansionPool(gap, { structuralMode, remediationMode, strictInventoryRemediationMode }));
}

function fullCloneRemediationExpansionSaturated({ structuralMode = false, remediationMode = false, strictInventoryRemediationMode = false } = {}) {
  if (!remediationMode) return false;
  const gaps = remediationExpansionPoolGaps({ structuralMode, remediationMode, strictInventoryRemediationMode });
  return gaps.length > 0 && gaps.every((gap) => strictGapRemediationAlreadySatisfied(gap));
}

function fullCloneContinuationExpansionActive({ structuralMode = fullCloneStructuralExpansionRequested(), remediationMode = fullCloneRemediationExpansionRequested(), strictInventoryRemediationMode = false } = {}) {
  if (requestedFidelity() !== 'full_clone' || !remediationMode) return false;
  if (process.env.MAILCHIMP_DISABLE_FULL_CLONE_CONTINUATION_EXPANSION === '1') return false;
  return process.env.MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION === '1'
    || fullCloneRemediationExpansionSaturated({ structuralMode, remediationMode, strictInventoryRemediationMode });
}

function nextFullCloneContinuationWaveIndex(gaps = []) {
  const candidates = Array.isArray(gaps) ? gaps : [];
  const minimumWaveIndex = Math.max(1, Number(process.env.MAILCHIMP_FULL_CLONE_CONTINUATION_MIN_WAVE || 1) || 1);
  if (candidates.length === 0) return minimumWaveIndex;
  for (let waveIndex = minimumWaveIndex; waveIndex <= 999; waveIndex += 1) {
    if (!candidates.every((gap) => strictGapContinuationAlreadySatisfied(gap, waveIndex))) return waveIndex;
  }
  return Math.max(1000, minimumWaveIndex);
}

function fullCloneStrictInventoryRemediationExpansionActive({ remediationMode = fullCloneRemediationExpansionRequested() } = {}) {
  if (requestedFidelity() !== 'full_clone' || !remediationMode) return false;
  if (process.env.MAILCHIMP_DISABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION === '1') return false;
  return process.env.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION === '1'
    || broadFullCloneRemediationAlreadySaturated();
}

function semanticWorkDirectorEnabled() {
  if (process.env.MAILCHIMP_DISABLE_SEMANTIC_WORK_DIRECTOR === '1') return false;
  if (process.env.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR !== '1') return false;
  if (requestedFidelity() === 'full_clone' && architectureEpicTargetIds().length > 0) return true;
  if (requestedFidelity() === 'full_clone' && fullCloneSwarmRequested()) return true;
  return requestedFidelity() === 'production_slice'
    && process.env.MAILCHIMP_PRODUCT_ONLY === '1'
    && requestedAgentCount() >= 80
    && strictGapInventoryEnabled()
    && semanticDirectorTargetFocusIds().size > 0;
}

const SEMANTIC_ARCHITECTURE_PHASES = Object.freeze([
  {
    id: 'primary_runtime_spine',
    title: 'primary runtime architecture spine',
    intent: 'Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.',
    checks: [
      'Primary product modules contain the new capability model and exported behavior',
      'Route/server/client entrypoints can exercise the capability through normal app paths'
    ]
  },
  {
    id: 'interactive_state_and_commands',
    title: 'interactive state and command workflow',
    intent: 'Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.',
    checks: [
      'User-facing state changes are represented as product data or commands',
      'The implementation exposes recoverable workflow evidence instead of static placeholders'
    ]
  },
  {
    id: 'operational_persistence_and_jobs',
    title: 'operational persistence, jobs, and audit handoff',
    intent: 'Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.',
    checks: [
      'The capability writes or reads through existing persistence/job/analytics seams when applicable',
      'Operational/audit evidence is visible from a primary runtime surface'
    ]
  },
  {
    id: 'integrated_user_path_evidence',
    title: 'integrated user-path evidence and verifier coverage',
    intent: 'Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.',
    checks: [
      'At least one primary route, shell, or server path renders or invokes the capability',
      'Targeted tests or import/lint evidence cover the adopted product path'
    ]
  }
]);

function semanticDirectorSaturationRatio({ allExecutableLeafCount = 0, allSaturatedExecutableLeafCount = 0 } = {}) {
  const denominator = Number(allExecutableLeafCount || 0);
  if (denominator <= 0) return 0;
  return Number((Number(allSaturatedExecutableLeafCount || 0) / denominator).toFixed(4));
}

function semanticDirectorShouldTakeOver({ continuationMode = false, remediationMode = false, workUnits = [], allExecutableLeafCount = 0, allSaturatedExecutableLeafCount = 0 } = {}) {
  if (!semanticWorkDirectorEnabled()) return { shouldDirect: false, reason: 'disabled' };
  if (process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE === '1') return { shouldDirect: true, reason: 'forced' };
  const targetFocusIds = semanticDirectorTargetFocusIds();
  if (targetFocusIds.size > 0 && workUnits.length < targetFocusIds.size) {
    return { shouldDirect: true, reason: 'targeted_focus_expansion' };
  }
  const saturationRatio = semanticDirectorSaturationRatio({ allExecutableLeafCount, allSaturatedExecutableLeafCount });
  const threshold = Math.max(0, Math.min(1, Number(process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SATURATION_THRESHOLD || 0.72) || 0.72));
  if ((continuationMode || remediationMode) && allExecutableLeafCount > 0 && saturationRatio >= threshold) {
    return { shouldDirect: true, reason: 'executable_leaf_saturation', saturationRatio, threshold };
  }
  if ((continuationMode || remediationMode) && workUnits.length > 0 && workUnits.length < Math.max(8, Math.floor(requestedAgentCount() / 2))) {
    return { shouldDirect: true, reason: 'insufficient_runnable_architecture_frontier', saturationRatio, threshold };
  }
  return { shouldDirect: false, reason: 'current_graph_still_has_unsaturated_frontier', saturationRatio, threshold };
}

const SEMANTIC_PHASE_RUNTIME_FILE_AREAS = Object.freeze({
  primary_runtime_spine: [],
  interactive_state_and_commands: [
    'apps/web/public/app-shell.jsx',
    'apps/web/public/app-shell.css',
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'apps/web/server.mjs'
  ],
  operational_persistence_and_jobs: [
    'packages/app/persistence-io.mjs',
    'packages/app/storage.mjs',
    'packages/app/jobs.mjs',
    'packages/app/job-runtime.mjs',
    'packages/app/job-handlers.mjs'
  ],
  integrated_user_path_evidence: []
});

const MAILCHIMP_ARCHITECTURE_EPIC_FOCUS_IDS = Object.freeze({
  rich_client_editor_architecture: [
    'frontend_client_shell_state',
    'campaign_editor_template_workflows',
    'campaign_wizard',
    'email_builder',
    'template_library',
    'content_studio'
  ],
  visual_website_builder: [
    'website_builder_editor_realism',
    'website_builder',
    'landing_pages',
    'signup_forms_popups'
  ],
  production_data_persistence: [
    'persistence_jobs_operational_db',
    'audience_sync_warehouse',
    'audience_identity_lifecycle',
    'auth_session_security_hardening'
  ],
  workflow_automation_runtime: [
    'automation_journey_execution',
    'automation_journey_builder',
    'automations_overview',
    'campaign_ops_calendar_workflow',
    'send_schedule_review'
  ],
  reporting_analytics_evidence: [
    'reporting_metrics_pipeline',
    'reports_overview',
    'report_detail'
  ],
  provider_service_integrations: [
    'integration_provider_sync',
    'integrations_marketplace',
    'api_keys_webhooks',
    'ai_predictive_ops_realism'
  ]
});

function architectureEpicTargetIds() {
  return String(process.env.MAILCHIMP_ARCHITECTURE_EPIC_TARGET_IDS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mailchimpArchitectureEpicPlan() {
  if (process.env.MAILCHIMP_DISABLE_ARCHITECTURE_EPIC_PLANNER === '1') return null;
  try {
    return decomposeObjectiveToArchitectureEpics({
      repoPath: ROOT,
      objective: {
        id: 'mailchimp_full_clone',
        title: 'Full Mailchimp clone: rich client editor, visual builder, production persistence, workflow automation, reporting evidence, and provider-backed services',
        requestedFidelity: requestedFidelity()
      },
      requestedAgentCount: requestedAgentCount(),
      targetEpicIds: architectureEpicTargetIds(),
      maxEpics: Number(process.env.MAILCHIMP_ARCHITECTURE_EPIC_MAX_EPICS || 0) || null,
      stage: process.env.MAILCHIMP_ARCHITECTURE_EPIC_STAGE || 'full_clone_relaunch_readiness'
    }).architectureEpicPlan;
  } catch (error) {
    return {
      status: 'blocked',
      blocker: {
        type: 'architecture_epic_planner_error',
        error: String(error?.message || error)
      },
      epics: [],
      summary: { architectureEpicPlannerError: String(error?.message || error) }
    };
  }
}

function mailchimpSharedObjectiveExpansionPlan({ currentWorkCount = 0, scopeAlreadySatisfied = false, supervisorState = {} } = {}) {
  if (process.env.MAILCHIMP_DISABLE_SHARED_OBJECTIVE_EXPANSION === '1') return null;
  if (requestedFidelity() !== 'full_clone') return null;
  try {
    return buildObjectiveExpansionPlan({
      repoPath: ROOT,
      objective: {
        id: 'mailchimp_full_clone',
        title: 'Full Mailchimp clone: dynamically expand missing rich-client, workflow, persistence, provider, analytics, security, and browser-evidence architecture until the strict supervisor is green or a real blocker is documented.',
        requestedFidelity: requestedFidelity()
      },
      requestedAgentCount: requestedAgentCount(),
      architectureEpics: true,
      targetEpicIds: architectureEpicTargetIds(),
      maxEpics: Number(process.env.MAILCHIMP_OBJECTIVE_EXPANSION_MAX_EPICS || process.env.MAILCHIMP_ARCHITECTURE_EPIC_MAX_EPICS || 5) || 5,
      stage: process.env.MAILCHIMP_OBJECTIVE_EXPANSION_STAGE || 'dynamic_final_boss_expansion',
      currentWorkCount,
      scopeAlreadySatisfied,
      supervisorState: {
        status: 'red',
        matrixStatus: scopeAlreadySatisfied ? 'all_complete' : 'partial',
        parityStatus: 'blocked',
        blockerKind: scopeAlreadySatisfied ? 'queue_exhausted_objective_remaining' : null,
        requestedFidelity: requestedFidelity(),
        ...supervisorState
      }
    });
  } catch (error) {
    return {
      schemaVersion: 'claw.objective_expansion_plan.v1',
      generatedAt: new Date().toISOString(),
      shouldExpand: false,
      reason: 'objective_expansion_planner_error',
      blocker: {
        type: 'objective_expansion_planner_error',
        error: String(error?.message || error),
        nextAction: 'Repair shared objective expansion planner before treating queue exhaustion as terminal.'
      },
      expansionWorkUnitCount: 0,
      remainingObjectiveIds: [],
      truthBoundary: 'Planner errors are blockers, not completion evidence.'
    };
  }
}

function adaptSharedObjectiveExpansionWorkUnit(unit = {}, index = 0) {
  const safeId = sanitizeShardLabel(unit.id || `objective_expansion_${index + 1}`);
  const id = `focus.shared_objective_expansion.${safeId}`;
  const allowedFiles = Array.from(new Set((unit.allowedFiles || unit.fileAreas || []).filter(Boolean)));
  const fileAreas = Array.from(new Set((unit.fileAreas || allowedFiles).filter(Boolean)));
  return {
    ...unit,
    id,
    originalSharedObjectiveExpansionId: unit.id || null,
    wave: unit.wave || `shared_objective_expansion_${String(index + 1).padStart(3, '0')}`,
    lane: unit.lane || 'shared_objective_expansion',
    domain: unit.domain || 'mailchimp_full_clone_shared_objective_expansion',
    allowedFiles,
    fileAreas,
    evidence: unit.evidence || unit.testFiles || [],
    metadata: {
      ...(unit.metadata || {}),
      focusId: id,
      sharedObjectiveExpansion: true,
      originalSharedObjectiveExpansionId: unit.id || null,
      assignmentContract: unit.metadata?.assignmentContract || buildGroundedAssignmentContract({
        artifactKind: 'product_diff',
        allowedFiles,
        fileAreas,
        requiredVerifiers: unit.requiredVerifiers || productOnlyVerifiers(['tests']),
        acceptanceChecks: unit.acceptanceChecks || ['Produce direct product-code evidence for the expanded objective surface.']
      })
    }
  };
}

function isExecutableProductRuntimeFile(filePath = '') {
  const value = String(filePath || '').trim();
  if (!/^(?:apps|packages|public|src)\//.test(value)) return false;
  if (/(^|\/)(?:tests?|__tests__|docs?|scripts?|artifacts?|fixtures?|mocks?|benchmarks?)\//i.test(value)) return false;
  if (/(?:^|\/)README\.md$/i.test(value)) return false;
  if (/\.(?:test|spec)\.(?:mjs|js|jsx|ts|tsx)$/i.test(value)) return false;
  return true;
}

function hasExecutableProductRuntimeContract(unit = {}) {
  const assignment = unit?.metadata?.assignmentContract || {};
  const candidateFiles = [
    ...(Array.isArray(unit.fileAreas) ? unit.fileAreas : []),
    ...(Array.isArray(unit.allowedFiles) ? unit.allowedFiles : []),
    ...(Array.isArray(assignment.targetFiles) ? assignment.targetFiles : []),
    ...(Array.isArray(assignment.targetModules) ? assignment.targetModules : [])
  ];
  return assignment.artifactKind === 'product_diff'
    && candidateFiles.some((filePath) => isExecutableProductRuntimeFile(filePath));
}

function architectureEpicForGap(architectureEpicPlan = null, gap = {}) {
  const gapId = String(gap?.id || '').trim();
  if (!gapId) return null;
  const epics = Array.isArray(architectureEpicPlan?.epics) ? architectureEpicPlan.epics : [];
  for (const epic of epics) {
    const mapped = MAILCHIMP_ARCHITECTURE_EPIC_FOCUS_IDS[epic.id] || [];
    if (mapped.includes(gapId)) return epic;
  }
  for (const [epicId, focusIds] of Object.entries(MAILCHIMP_ARCHITECTURE_EPIC_FOCUS_IDS)) {
    if (!focusIds.includes(gapId)) continue;
    return epics.find((epic) => epic.id === epicId) || { id: epicId, title: epicId.replace(/_/g, ' '), roles: [] };
  }
  return null;
}

function architectureEpicTargetFocusIds(architectureEpicPlan = null) {
  const ids = new Set();
  for (const epic of Array.isArray(architectureEpicPlan?.epics) ? architectureEpicPlan.epics : []) {
    for (const focusId of MAILCHIMP_ARCHITECTURE_EPIC_FOCUS_IDS[epic.id] || []) ids.add(`focus.${focusId}`);
  }
  return ids;
}

function architectureRoleForSemanticPhase(phaseId = '', epic = null) {
  const roles = Array.isArray(epic?.roles) ? epic.roles : [];
  const pick = (pattern, fallback) => roles.find((role) => pattern.test(role)) || fallback;
  if (phaseId === 'interactive_state_and_commands') return pick(/frontend|editor|browser/, 'editor_runtime_builder');
  if (phaseId === 'operational_persistence_and_jobs') return pick(/persistence|database|workflow|runtime/, 'persistence_database_agent');
  if (phaseId === 'integrated_user_path_evidence') return pick(/browser|truth|audit|verifier/, 'browser_parity_verifier');
  return pick(/frontend|workflow|provider|analytics|persistence/, 'frontend_architect');
}

const SEMANTIC_LAYER_FALLBACK_FILES = Object.freeze({
  client_shell: [
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'apps/web/server.mjs',
    'apps/web/public/app-shell.jsx',
    'apps/web/public/app-shell.css'
  ],
  route_or_server: [
    'packages/app/routes/api-admin.mjs',
    'packages/app/routes/platform.mjs',
    'apps/web/server.mjs'
  ],
  domain_or_persistence: [
    'packages/app/domain-current-product-ops.mjs',
    'packages/app/storage.mjs',
    'packages/app/persistence-io.mjs',
    'packages/app/domain-growth.mjs',
    'packages/app/domain-commerce-revenue.mjs'
  ],
  jobs_runtime: [
    'packages/app/jobs.mjs',
    'packages/app/job-runtime.mjs',
    'packages/app/job-handlers.mjs'
  ]
});

function semanticDirectorAllowedFile(filePath) {
  return filePath
    && !String(filePath).startsWith('scripts/')
    && !String(filePath).startsWith('tests/')
    && !String(filePath).startsWith('docs/')
    && !String(filePath).startsWith('artifacts/')
    && !String(filePath).startsWith('packages/app/full-clone-');
}

function semanticDirectorPrimaryFilesForGap(gap = {}) {
  return Array.from(new Set([
    ...expandStrictGapCandidateAreas(gap.candidateAreas || []),
    ...resolveStrictGapImplementationFiles(gap.id)
  ].filter(semanticDirectorAllowedFile)));
}

function semanticDirectorFilesForPhase(gap = {}, phase = {}) {
  const baseFiles = semanticDirectorPrimaryFilesForGap(gap);
  const phaseFiles = SEMANTIC_PHASE_RUNTIME_FILE_AREAS[String(phase?.id || '').trim()] || [];
  const initialFiles = Array.from(new Set([
    ...baseFiles,
    ...phaseFiles
  ].filter(semanticDirectorAllowedFile)
    .filter((filePath) => fs.existsSync(path.join(ROOT, filePath)) || baseFiles.includes(filePath))));
  const layers = new Set(initialFiles.map(semanticDirectorArchitectureLayerForFile));
  const requiredLayers = semanticDirectorRequiredLayersForPhase(String(phase?.id || '').trim());
  const fallbackFiles = [];
  for (const layer of requiredLayers) {
    if (layers.has(layer)) continue;
    const fallback = (SEMANTIC_LAYER_FALLBACK_FILES[layer] || [])
      .filter(semanticDirectorAllowedFile)
      .find((filePath) => fs.existsSync(path.join(ROOT, filePath)));
    if (fallback) {
      fallbackFiles.push(fallback);
      layers.add(layer);
    }
  }
  return Array.from(new Set([...initialFiles, ...fallbackFiles]));
}

function semanticDirectorRankGap(gap = {}) {
  const focusGroup = resolveStrictGapFocusGroup(gap.id);
  const lanePriority = {
    frontend_architecture: 100,
    website_builder: 95,
    campaign_editor: 92,
    automation_journey: 90,
    audience_crm: 84,
    reporting_analytics: 80,
    delivery_jobs: 78,
    integrations_api_oauth: 76,
    security_ops: 74,
    ai_predictive: 70,
    campaign_experimentation: 68
  };
  return (lanePriority[focusGroup] || 50) + (gap.broadFullCloneObjective === true ? 15 : 0);
}

function semanticDirectorJsIdentifier(value, fallback = 'semanticRuntime') {
  const words = String(value || fallback).split(/[^a-z0-9]+/i).filter(Boolean);
  const base = words.length > 0
    ? words.map((part, index) => index === 0
      ? part.charAt(0).toLowerCase() + part.slice(1)
      : part.charAt(0).toUpperCase() + part.slice(1)).join('')
    : fallback;
  return /^[A-Za-z_$]/.test(base) ? base : `${fallback}${base}`;
}

function semanticDirectorArchitectureLayerForFile(filePath) {
  const rel = String(filePath || '');
  if (/apps\/web\/public|app-shell|view\.mjs|public\.mjs/.test(rel)) return 'client_shell';
  if (/\/routes\//.test(rel) || /server\.mjs|http-runtime\.mjs/.test(rel)) return 'route_or_server';
  if (/domain-|storage\.mjs|persistence-io\.mjs/.test(rel)) return 'domain_or_persistence';
  if (/job-|jobs\.mjs|job-runtime|job-handlers/.test(rel)) return 'jobs_runtime';
  if (/integration|provider|webhook|api-admin/.test(rel)) return 'provider_or_api';
  if (/security|auth/.test(rel)) return 'security_runtime';
  return 'product_runtime';
}

function semanticDirectorRequiredLayersForPhase(phaseId) {
  if (phaseId === 'interactive_state_and_commands') return ['client_shell', 'route_or_server'];
  if (phaseId === 'operational_persistence_and_jobs') return ['domain_or_persistence', 'jobs_runtime'];
  if (phaseId === 'integrated_user_path_evidence') return ['route_or_server', 'domain_or_persistence'];
  return ['route_or_server', 'domain_or_persistence'];
}

function semanticDirectorPhaseAlreadyAdopted(gap = {}, phase = {}) {
  if (process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES === '0') return false;
  const surfaceId = String(gap?.id || '').trim();
  const phaseId = String(phase?.id || '').trim();
  if (!surfaceId || !phaseId) return false;
  const ident = semanticDirectorJsIdentifier(`${surfaceId}_${phaseId}_semantic_runtime`, 'semanticRuntime');
  const contractMarker = `export const ${ident}Contract`;
  const markedLayers = new Set();
  for (const relPath of semanticDirectorFilesForPhase(gap, phase)) {
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) continue;
    try {
      if (fs.readFileSync(fullPath, 'utf8').includes(contractMarker)) {
        markedLayers.add(semanticDirectorArchitectureLayerForFile(relPath));
      }
    } catch {
      // Treat unreadable files as not adopted so the verifier can surface the
      // real filesystem problem instead of silently shrinking the work graph.
    }
  }
  const requiredLayers = semanticDirectorRequiredLayersForPhase(phaseId);
  return requiredLayers.length > 0
    ? requiredLayers.every((layer) => markedLayers.has(layer))
    : markedLayers.size > 0;
}

function semanticDirectorRemainingPhasesForGap(gap = {}) {
  return SEMANTIC_ARCHITECTURE_PHASES.filter((phase) => !semanticDirectorPhaseAlreadyAdopted(gap, phase));
}

function buildSemanticDirectorWorkUnit({ gap, phase, gapIndex, phaseIndex, continuationWaveIndex = null, reason = null, architectureEpic = null }) {
  const focusId = strictGapFocusId(gap);
  const focusGroup = resolveStrictGapFocusGroup(gap.id);
  const primaryFiles = semanticDirectorFilesForPhase(gap, phase);
  const targetedTests = resolveStrictGapTargetedTests(gap.id);
  const architectureRole = architectureRoleForSemanticPhase(phase.id, architectureEpic);
  const wave = String(continuationWaveIndex || Number(process.env.MAILCHIMP_FULL_CLONE_CONTINUATION_MIN_WAVE || 1) || 1).padStart(3, '0');
  const id = `${focusId}::semantic-frontier-${wave}#${String(gapIndex + 1).padStart(2, '0')}-${phase.id}`;
  const acceptanceChecks = Array.from(new Set([
    architectureEpic ? `Execute architecture epic ${architectureEpic.title || architectureEpic.id} as ${architectureRole}` : null,
    `Semantically advance ${gap.title}: ${phase.intent}`,
    'Modify primary runtime product files; do not add isolated full-clone marker modules as the main deliverable',
    'Wire the new capability into a user-visible route, shell, server, job, analytics, persistence, or provider path',
    'Leave executable evidence that the capability is adopted by the primary app runtime',
    ...(phase.checks || []),
    ...targetedTests.map((testPath) => `Preserve or extend executable evidence for ${testPath}`)
  ].filter(Boolean)));
  const requiredVerifiers = productOnlyVerifiers(['lint', 'imports', ...(targetedTests.length > 0 ? ['tests'] : [])]);
  return {
    id,
    title: `${gap.title} — ${phase.title}`,
    goal: `${phase.intent} This semantic-director shard must decide what product architecture is missing and land that architecture in the primary runtime path.`,
    wave: `semantic_frontier_${wave}`,
    lane: focusGroup,
    domain: 'mailchimp_semantic_architecture_frontier',
    fileAreas: primaryFiles,
    allowedFiles: primaryFiles,
    inputRefs: ['semanticObjectiveDirectorPolicy'],
    inputs: {
      focusId,
      surfaceId: gap.id,
      semanticPhaseId: phase.id,
      semanticIntent: phase.intent,
      architectureEpicId: architectureEpic?.id || null,
      architectureRole,
      strictGapDetail: gap.detail || null
    },
    acceptanceChecks,
    requiredVerifiers,
    evidence: targetedTests,
    dependsOn: [],
    effortSteps: Math.max(6, primaryFiles.length + targetedTests.length + 2),
    metadata: {
      focusId,
      surfaceId: gap.id,
      rootFocusId: focusId,
      focusGroup,
      strictGap: gap.requiredForFullClone === true || gap.broadFullCloneObjective === true,
      broadFullCloneObjective: gap.broadFullCloneObjective === true,
      semanticDirector: true,
      architectureFrontier: true,
      architectureEpic: Boolean(architectureEpic),
      architectureEpicId: architectureEpic?.id || null,
      architectureEpicTitle: architectureEpic?.title || null,
      architectureRole,
      semanticDirectorReason: reason,
      semanticPhaseId: phase.id,
      semanticPhaseTitle: phase.title,
      semanticIntent: phase.intent,
      continuationWaveIndex,
      primaryProductAdoptionRequired: true,
      primaryAdoptionFiles: primaryFiles,
      importFile: primaryFiles[0] || null,
      testFile: targetedTests[0] || null,
      extraTestFiles: targetedTests.slice(1),
      strictGapDetail: gap.detail || null,
      candidateAreas: gap.candidateAreas || [],
      assignmentContract: buildGroundedAssignmentContract({
        artifactKind: 'product_diff',
        allowedFiles: primaryFiles,
        fileAreas: primaryFiles,
        requiredVerifiers,
        acceptanceChecks
      })
    }
  };
}

function semanticDirectorTargetFocusIds() {
  return new Set(String(process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => canonicalizeFocusId(entry.startsWith('focus.') ? entry : `focus.${entry}`))
    .filter(Boolean));
}

function buildSemanticWorkDirectorPlan({ gaps = [], completed = new Set(), hardCompleted = new Set(), excluded = new Set(), continuationMode = false, remediationMode = false, continuationWaveIndex = null, workUnits = [], allExecutableLeafCount = 0, allSaturatedExecutableLeafCount = 0 } = {}) {
  const decision = semanticDirectorShouldTakeOver({ continuationMode, remediationMode, workUnits, allExecutableLeafCount, allSaturatedExecutableLeafCount });
  const architectureEpicPlan = mailchimpArchitectureEpicPlan();
  const targetFocusIds = semanticDirectorTargetFocusIds();
  const explicitArchitectureEpicTargeting = architectureEpicTargetIds().length > 0;
  const targetEpicFocusIds = architectureEpicTargetFocusIds(architectureEpicPlan);
  const effectiveTargetFocusIds = targetFocusIds.size > 0 ? targetFocusIds : (explicitArchitectureEpicTargeting ? targetEpicFocusIds : new Set());
  const gapIsHardCompleted = (gap) => hardCompleted.has(strictGapFocusId(gap));
  const gapIsCompletedForCurrentDirectorPass = (gap) => gapIsHardCompleted(gap) || (completed.has(strictGapFocusId(gap)) && effectiveTargetFocusIds.size === 0);
  const candidateGaps = Array.from(new Map((Array.isArray(gaps) ? gaps : [])
    .filter((gap) => gap && gap.id)
    .filter((gap) => !gapIsHardCompleted(gap))
    .filter((gap) => effectiveTargetFocusIds.size === 0 || effectiveTargetFocusIds.has(strictGapFocusId(gap)))
    .filter((gap) => !gapIsCompletedForCurrentDirectorPass(gap))
    .filter((gap) => !excluded.has(strictGapFocusId(gap)))
    .filter((gap) => semanticDirectorPrimaryFilesForGap(gap).length >= 2)
    .filter((gap) => semanticDirectorRemainingPhasesForGap(gap).length > 0)
    .sort((left, right) => effectiveTargetFocusIds.size > 0
      ? Array.from(effectiveTargetFocusIds).indexOf(strictGapFocusId(left)) - Array.from(effectiveTargetFocusIds).indexOf(strictGapFocusId(right))
      : semanticDirectorRankGap(right) - semanticDirectorRankGap(left) || String(left.id).localeCompare(String(right.id)))
    .map((gap) => [gap.id, gap])).values());
  const requestedMaxGaps = Number(process.env.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS || candidateGaps.length) || candidateGaps.length;
  const maxGaps = effectiveTargetFocusIds.size > 0 ? Math.max(1, requestedMaxGaps) : Math.max(8, requestedMaxGaps);
  const selectedGaps = candidateGaps.slice(0, maxGaps);
  const semanticWorkUnits = decision.shouldDirect
    ? selectedGaps.flatMap((gap, gapIndex) => semanticDirectorRemainingPhasesForGap(gap).map((phase, phaseIndex) => buildSemanticDirectorWorkUnit({
      gap,
      phase,
      gapIndex,
      phaseIndex,
      continuationWaveIndex,
      reason: decision.reason,
      architectureEpic: architectureEpicForGap(architectureEpicPlan, gap)
    })))
    : [];
  return {
    enabled: semanticWorkDirectorEnabled(),
    active: decision.shouldDirect,
    reason: decision.reason,
    saturationRatio: decision.saturationRatio ?? semanticDirectorSaturationRatio({ allExecutableLeafCount, allSaturatedExecutableLeafCount }),
    threshold: decision.threshold ?? null,
    selectedGapCount: selectedGaps.length,
    phaseCount: SEMANTIC_ARCHITECTURE_PHASES.length,
    completedFocusCount: completed.size,
    selectedFocusIds: selectedGaps.map((gap) => strictGapFocusId(gap)),
    targetFocusIds: Array.from(targetFocusIds),
    targetEpicFocusIds: Array.from(targetEpicFocusIds),
    architectureEpicPlan: architectureEpicPlan ? {
      status: architectureEpicPlan.status,
      stage: architectureEpicPlan.stage,
      summary: architectureEpicPlan.summary || null,
      epics: (architectureEpicPlan.epics || []).map((epic) => ({
        id: epic.id,
        title: epic.title,
        ready: epic.ready,
        roles: epic.roles,
        targetFiles: epic.targetFiles,
        missingLayers: epic.missingLayers
      })),
      blocker: architectureEpicPlan.blocker || null
    } : null,
    policy: 'Select semantic architecture frontiers from remaining full-clone gaps; require primary-runtime adoption and executable evidence before returning to saturated continuation leaves.',
    workUnits: semanticWorkUnits
  };
}

function strictGapInCurrentExpansionPool(gap = {}, { structuralMode = false, remediationMode = false, strictInventoryRemediationMode = false } = {}) {
  if (!structuralMode) return true;
  if (gap?.broadFullCloneObjective === true) return true;
  return remediationMode && strictInventoryRemediationMode && strictInventoryGapRequiresFullCloneRemediation(gap);
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
  const scopedBenchmarkSurfaces = benchmarkScopeSurfaces();
  if (scopedBenchmarkSurfaces.length > 0) {
    return scopedBenchmarkSurfaces.map((surface) => surface.focusId);
  }
  if (strictGapInventoryEnabled()) {
    return activeStrictGapEntries().selectedGaps.map((gap) => strictGapFocusId(gap));
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

function deepArchitectureCreditRequired() {
  return process.env.MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT === '1'
    || process.env.MAILCHIMP_ARCHITECTURE_ONLY_CREDIT === '1';
}

function parseImplementationStdout(entry) {
  const stdout = String(entry?.metadata?.implementation?.stdout || '').trim();
  if (!stdout || stdout[0] !== '{') return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function architectureEvidenceFromPatchEntry(entry) {
  const parsedStdout = parseImplementationStdout(entry);
  return entry?.metadata?.implementation?.metadata?.architectureEvidence
    || entry?.metadata?.architectureEvidence
    || entry?.admissionAudit?.architectureAdmission?.details?.architectureEvidence
    || parsedStdout?.metadata?.architectureEvidence
    || parsedStdout?.architectureEvidence
    || null;
}

function semanticBloatAuditFromPatchEntry(entry) {
  const parsedStdout = parseImplementationStdout(entry);
  return entry?.metadata?.implementation?.metadata?.semanticBloatAudit
    || entry?.metadata?.semanticBloatAudit
    || entry?.admissionAudit?.semanticBloatAdmission?.details?.semanticBloatAudit
    || parsedStdout?.metadata?.semanticBloatAudit
    || parsedStdout?.semanticBloatAudit
    || architectureEvidenceFromPatchEntry(entry)?.semanticBloatAudit
    || null;
}

function claimIntegrityKindFromPatchEntry(entry) {
  const parsedStdout = parseImplementationStdout(entry);
  return String(entry?.metadata?.implementation?.metadata?.claimIntegrityKind
    || parsedStdout?.metadata?.claimIntegrityKind
    || parsedStdout?.claimIntegrityKind
    || '');
}

function patchEntryHasSemanticBloat(entry) {
  const audit = semanticBloatAuditFromPatchEntry(entry);
  const implementationStdout = String(entry?.metadata?.implementation?.stdout || '');
  const claimIntegrityKind = claimIntegrityKindFromPatchEntry(entry);
  return audit?.semanticBloatSuspect === true
    || claimIntegrityKind === 'semantic_bloat_delta'
    || /"claimIntegrityKind"\s*:\s*"semantic_bloat_delta"/.test(implementationStdout)
    || /"semanticBloatSuspect"\s*:\s*true/.test(implementationStdout);
}

function patchEntryHasSubstantiveDeltaEvidence(entry) {
  const claimIntegrityKind = claimIntegrityKindFromPatchEntry(entry);
  if (claimIntegrityKind !== 'substantive_product_delta') return true;
  const audit = semanticBloatAuditFromPatchEntry(entry);
  if (!audit || Number(audit.addedNonblankLines || 0) > 0) return true;
  const runtimeIntegrationOk = audit?.runtimeIntegrationEvidence?.ok === true
    || architectureEvidenceFromPatchEntry(entry)?.runtimeIntegrationEvidence?.ok === true;
  return runtimeIntegrationOk;
}

function patchEntryRequiresArchitectureCredit(entry) {
  const metadata = entry?.metadata || {};
  const shardMetadata = metadata?.contextPack?.shard?.metadata || {};
  const implementationStdout = String(entry?.metadata?.implementation?.stdout || '');
  const shardId = String(entry?.taskId || entry?.shardId || entry?.id || '').toLowerCase();
  return deepArchitectureCreditRequired()
    || metadata.semanticDirector === true
    || metadata.architectureFrontier === true
    || shardMetadata.semanticDirector === true
    || shardMetadata.architectureFrontier === true
    || shardId.includes('::semantic-frontier-')
    || /"semanticDirector"\s*:\s*true/.test(implementationStdout)
    || /"architectureFrontier"\s*:\s*true/.test(implementationStdout);
}

function hasDeepArchitectureProductEvidence(entry) {
  const evidence = architectureEvidenceFromPatchEntry(entry);
  if (!evidence || evidence.ok !== true || evidence.markerOnly === true) return false;
  if (evidence.semanticBloatAudit?.semanticBloatSuspect === true) return false;
  if (evidence.runtimeIntegrationEvidence?.ok !== true) return false;
  const modifiedPrimaryRuntimeFiles = Array.isArray(evidence.modifiedPrimaryRuntimeFiles)
    ? evidence.modifiedPrimaryRuntimeFiles
    : [];
  const evidencePrimaryRuntimeFiles = Array.isArray(evidence.evidencePrimaryRuntimeFiles)
    ? evidence.evidencePrimaryRuntimeFiles
    : modifiedPrimaryRuntimeFiles;
  const signaledFiles = Array.isArray(evidence.signaledFiles) ? evidence.signaledFiles : [];
  const modifiedSignaledFiles = Array.isArray(evidence.modifiedSignaledFiles)
    ? evidence.modifiedSignaledFiles
    : (modifiedPrimaryRuntimeFiles.length > 0 ? modifiedPrimaryRuntimeFiles : []);
  const modifiedRequiredLayers = Array.isArray(evidence.modifiedRequiredLayers)
    ? evidence.modifiedRequiredLayers
    : (modifiedPrimaryRuntimeFiles.length > 0 ? ['modified_primary_runtime'] : []);
  return Number(evidence.layerCount || 0) >= 2
    && evidencePrimaryRuntimeFiles.length >= 2
    && modifiedPrimaryRuntimeFiles.length >= 1
    && signaledFiles.length >= 2
    && modifiedSignaledFiles.length >= 1
    && modifiedRequiredLayers.length >= 1;
}

function hasTrustworthyProductSurfaceChange(entry) {
  const implementationStdout = String(entry?.metadata?.implementation?.stdout || '');
  const implementationMetadata = entry?.metadata?.implementation?.metadata || {};
  if (implementationMetadata?.claimIntegrityKind === 'synthetic_parity_delta'
    || /"claimIntegrityKind"\s*:\s*"synthetic_parity_delta"/.test(implementationStdout)) {
    return false;
  }
  if (implementationMetadata?.markerOnlyProductDelta === true
    || implementationMetadata?.claimIntegrityKind === 'marker_only_remediation_delta'
    || /"claimIntegrityKind"\s*:\s*"marker_only_remediation_delta"/.test(implementationStdout)
    || /"markerOnlyProductDelta"\s*:\s*true/.test(implementationStdout)) {
    return false;
  }
  if (patchEntryHasSemanticBloat(entry)) return false;
  if (!patchEntryHasSubstantiveDeltaEvidence(entry)) return false;
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
  if (patchEntryRequiresArchitectureCredit(entry) && !hasDeepArchitectureProductEvidence(entry)) return false;
  return !hasExplicitVerifierFailure;
}

export function extractVerifiedFocusIdsFromPatchQueue(patchQueue) {
  return Array.from(new Set((patchQueue?.merged || [])
    .map((entry) => ({ focusId: resolveFocusIdFromPatchEntry(entry), trustworthy: hasTrustworthyProductSurfaceChange(entry) }))
    .filter((entry) => entry.focusId && entry.trustworthy)
    .map((entry) => entry.focusId)));
}

export function extractSuspectFocusIdsFromPatchQueue(patchQueue) {
  return Array.from(new Set((patchQueue?.merged || [])
    .map((entry) => ({ focusId: resolveFocusIdFromPatchEntry(entry), suspect: patchEntryHasSemanticBloat(entry) }))
    .filter((entry) => entry.focusId && entry.suspect)
    .map((entry) => entry.focusId)));
}

export function remainingParityFocusIds(completedFocusIdsInput = completedFocusIds()) {
  const parityFocusIds = mailchimpParityFocusIds();
  const normalizedCompletedFocusIds = completedFocusIdsInput instanceof Set
    ? Array.from(completedFocusIdsInput)
    : (Array.isArray(completedFocusIdsInput) ? completedFocusIdsInput : []);
  const done = new Set(expandEquivalentFocusIds(normalizedCompletedFocusIds));
  const excluded = excludedFocusIds();
  return parityFocusIds.filter((id) => !done.has(id) && !excluded.has(id));
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
  scalePreflight: path.join(ARTIFACT_ROOT, 'scale_preflight.json'),
  resourcePreflight: path.join(ARTIFACT_ROOT, 'resource_preflight.json'),
  validationIndex: path.join(VALIDATION_DIR, 'validation_index.json'),
  mergeReport: path.join(MERGE_DIR, 'merge_report.json'),
  recoveryReport: path.join(RECOVERY_DIR, 'recovery_report.json'),
  blockerReport: path.join(ARTIFACT_ROOT, 'blocker_report.json'),
  supervisorStatus: path.join(ARTIFACT_ROOT, 'supervisor_status.json'),
  programState: path.join(ARTIFACT_ROOT, 'program_state.json'),
  completionSummary: path.join(ARTIFACT_ROOT, 'completion_summary.json'),
  notificationState: path.join(ARTIFACT_ROOT, 'notification_state.json'),
  launchChecklist: path.join(ARTIFACT_ROOT, 'launch_checklist.json'),
  launchLocBaseline: path.join(ARTIFACT_ROOT, 'launch_loc_baseline.json'),
  locAccounting: path.join(ARTIFACT_ROOT, 'loc_accounting.json'),
  strictHierarchicalPlan: path.join(ARTIFACT_ROOT, 'strict_hierarchical_plan.json')
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

function requestedAgentCount() {
  return Math.max(1, Number(process.env.MAILCHIMP_REQUESTED_AGENT_COUNT || process.env.ORCHESTRATOR_REQUESTED_AGENT_COUNT || 1));
}

function fullCloneSwarmRequested() {
  return requestedFidelity() === 'full_clone' && requestedAgentCount() >= 80;
}

function fullCloneStructuralExpansionRequested() {
  return requestedFidelity() === 'full_clone'
    && fullCloneSwarmRequested()
    && (process.env.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION === '1'
      || process.env.MAILCHIMP_STRUCTURAL_FULL_CLONE_EXPANSION === '1');
}

function fullCloneFrontierExpansionRequested() {
  return fullCloneStructuralExpansionRequested()
    && (process.env.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION === '1'
      || process.env.MAILCHIMP_FULL_CLONE_FRONTIER_EXPANSION === '1');
}

function fullCloneRemediationExpansionRequested() {
  return fullCloneFrontierExpansionRequested()
    && (process.env.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION === '1'
      || process.env.MAILCHIMP_FULL_CLONE_REMEDIATION_EXPANSION === '1');
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
    const hardCompleted = strictGapState.verifiedCompletedFocusIds || verifiedCompletedFocusIds();
    const gapIsHardCompleted = (gap) => hardCompleted.has(strictGapFocusId(gap));
    const selectedIds = new Set(strictGapState.selectedGaps.map((gap) => strictGapFocusId(gap)));
    const structuralMode = strictGapState.swarmMode === true && strictGapState.structuralMode === true;
    const frontierMode = structuralMode && strictGapState.frontierMode === true;
    const remediationMode = frontierMode && strictGapState.remediationMode === true;
    const strictInventoryRemediationMode = remediationMode && strictGapState.strictInventoryRemediationMode === true;
    const continuationMode = remediationMode && strictGapState.continuationMode === true;
    const allContinuationExpansionGaps = continuationMode
      ? strictGapState.allGaps.filter((gap) => strictGapInCurrentExpansionPool(gap, { structuralMode, remediationMode, strictInventoryRemediationMode }))
      : [];
    const currentExpansionGaps = strictGapState.allGaps.filter((gap) => !gapIsHardCompleted(gap) && strictGapInCurrentExpansionPool(gap, { structuralMode, remediationMode, strictInventoryRemediationMode }));
    const continuationWaveIndex = continuationMode ? nextFullCloneContinuationWaveIndex(allContinuationExpansionGaps.length > 0 ? allContinuationExpansionGaps : currentExpansionGaps) : null;
    const continuationWaveStillOpen = (gap) => continuationMode
      && strictGapInCurrentExpansionPool(gap, { structuralMode, remediationMode, strictInventoryRemediationMode })
      && !strictGapContinuationAlreadySatisfied(gap, continuationWaveIndex);
    const unsatisfiedContinuationExpansionGaps = continuationMode
      ? allContinuationExpansionGaps.filter((gap) => continuationWaveStillOpen(gap))
      : [];
    const reopenVerifiedContinuationRoots = continuationMode
      && currentExpansionGaps.length === 0
      && strictGapState.selectedGaps.length === 0
      && unsatisfiedContinuationExpansionGaps.length > 0;
    const activeContinuationExpansionGaps = continuationMode
      ? (currentExpansionGaps.length > 0 ? currentExpansionGaps : unsatisfiedContinuationExpansionGaps)
      : currentExpansionGaps;
    const expandExecutableLeaves = continuationMode
      ? ((gap, index) => expandStrictGapIntoRemediationLeaves(gap, index, { phases: fullCloneContinuationPhases(continuationWaveIndex), continuationWaveIndex }))
      : remediationMode ? expandStrictGapIntoRemediationLeaves : frontierMode ? expandStrictGapIntoFrontierLeaves : structuralMode ? expandStrictGapIntoStructuralLeaves : expandStrictGapIntoSwarmLeaves;
    const executableLeafAlreadySatisfied = remediationMode ? remediationLeafUnitAlreadySatisfied : frontierMode ? frontierLeafUnitAlreadySatisfied : structuralMode ? structuralLeafUnitAlreadySatisfied : swarmLeafUnitAlreadySatisfied;
    const excludedWorkUnitIds = strictGapState.excludedWorkUnitIds || new Set();
    const executableLeafIsTemporarilyExcluded = (unit = {}) => {
      const id = String(unit?.id || '');
      if (!id) return false;
      if (excludedWorkUnitIds.has(id)) return true;
      for (const excludedIdValue of excludedWorkUnitIds) {
        const excludedId = String(excludedIdValue || '');
        if (!excludedId) continue;
        if (excludedId.startsWith(`${id}#`)) return true;
        if (id.startsWith(`${excludedId}#`)) return true;
      }
      return false;
    };
    const totalSwarmLeafCount = strictGapState.swarmMode === true
      ? strictGapState.selectedGaps.reduce((total, gap, index) => total + expandStrictGapIntoSwarmLeaves(gap, index).length, 0)
      : 0;
    const saturatedSwarmLeafCount = strictGapState.swarmMode === true
      ? strictGapState.selectedGaps.reduce((total, gap, index) => total + expandStrictGapIntoSwarmLeaves(gap, index).filter((unit) => swarmLeafUnitAlreadySatisfied(unit)).length, 0)
      : 0;
    const allSwarmLeafCount = strictGapState.swarmMode === true
      ? strictGapState.allGaps.reduce((total, gap, index) => total + expandStrictGapIntoSwarmLeaves(gap, index).length, 0)
      : 0;
    const allSaturatedSwarmLeafCount = strictGapState.swarmMode === true
      ? strictGapState.allGaps.reduce((total, gap, index) => total + expandStrictGapIntoSwarmLeaves(gap, index).filter((unit) => swarmLeafUnitAlreadySatisfied(unit)).length, 0)
      : 0;
    const allSwarmFocusLanes = strictGapState.swarmMode === true
      ? Array.from(new Set(strictGapState.allGaps.map((gap) => resolveStrictGapFocusGroup(gap.id)).filter(Boolean)))
      : [];
    const totalStructuralLeafCount = structuralMode
      ? strictGapState.selectedGaps.reduce((total, gap, index) => total + expandStrictGapIntoStructuralLeaves(gap, index).length, 0)
      : 0;
    const saturatedStructuralLeafCount = structuralMode
      ? strictGapState.selectedGaps.reduce((total, gap, index) => total + expandStrictGapIntoStructuralLeaves(gap, index).filter((unit) => structuralLeafUnitAlreadySatisfied(unit)).length, 0)
      : 0;
    const allStructuralLeafCount = structuralMode
      ? strictGapState.allGaps.filter((gap) => gap.broadFullCloneObjective === true).reduce((total, gap, index) => total + expandStrictGapIntoStructuralLeaves(gap, index).length, 0)
      : 0;
    const allSaturatedStructuralLeafCount = structuralMode
      ? strictGapState.allGaps.filter((gap) => gap.broadFullCloneObjective === true).reduce((total, gap, index) => total + expandStrictGapIntoStructuralLeaves(gap, index).filter((unit) => structuralLeafUnitAlreadySatisfied(unit)).length, 0)
      : 0;
    const allStructuralFocusLanes = structuralMode
      ? Array.from(new Set(strictGapState.allGaps.filter((gap) => gap.broadFullCloneObjective === true).map((gap) => resolveStrictGapFocusGroup(gap.id)).filter(Boolean)))
      : [];
    const totalFrontierLeafCount = frontierMode
      ? strictGapState.selectedGaps.reduce((total, gap, index) => total + expandStrictGapIntoFrontierLeaves(gap, index).length, 0)
      : 0;
    const saturatedFrontierLeafCount = frontierMode
      ? strictGapState.selectedGaps.reduce((total, gap, index) => total + expandStrictGapIntoFrontierLeaves(gap, index).filter((unit) => frontierLeafUnitAlreadySatisfied(unit)).length, 0)
      : 0;
    const allFrontierLeafCount = frontierMode
      ? strictGapState.allGaps.filter((gap) => gap.broadFullCloneObjective === true).reduce((total, gap, index) => total + expandStrictGapIntoFrontierLeaves(gap, index).length, 0)
      : 0;
    const allSaturatedFrontierLeafCount = frontierMode
      ? strictGapState.allGaps.filter((gap) => gap.broadFullCloneObjective === true).reduce((total, gap, index) => total + expandStrictGapIntoFrontierLeaves(gap, index).filter((unit) => frontierLeafUnitAlreadySatisfied(unit)).length, 0)
      : 0;
    const allFrontierFocusLanes = frontierMode
      ? Array.from(new Set(strictGapState.allGaps.filter((gap) => gap.broadFullCloneObjective === true).map((gap) => resolveStrictGapFocusGroup(gap.id)).filter(Boolean)))
      : [];
    const totalRemediationLeafCount = remediationMode
      ? strictGapState.selectedGaps.reduce((total, gap, index) => total + expandStrictGapIntoRemediationLeaves(gap, index).length, 0)
      : 0;
    const saturatedRemediationLeafCount = remediationMode
      ? strictGapState.selectedGaps.reduce((total, gap, index) => total + expandStrictGapIntoRemediationLeaves(gap, index).filter((unit) => remediationLeafUnitAlreadySatisfied(unit)).length, 0)
      : 0;
    const allRemediationLeafCount = remediationMode
      ? currentExpansionGaps.reduce((total, gap, index) => total + expandStrictGapIntoRemediationLeaves(gap, index).length, 0)
      : 0;
    const allSaturatedRemediationLeafCount = remediationMode
      ? currentExpansionGaps.reduce((total, gap, index) => total + expandStrictGapIntoRemediationLeaves(gap, index).filter((unit) => remediationLeafUnitAlreadySatisfied(unit)).length, 0)
      : 0;
    const allRemediationFocusLanes = remediationMode
      ? Array.from(new Set(currentExpansionGaps.map((gap) => resolveStrictGapFocusGroup(gap.id)).filter(Boolean)))
      : [];
    const allContinuationLeafCount = continuationMode
      ? activeContinuationExpansionGaps.reduce((total, gap, index) => total + expandStrictGapIntoRemediationLeaves(gap, index, { phases: fullCloneContinuationPhases(continuationWaveIndex), continuationWaveIndex }).length, 0)
      : 0;
    const allSaturatedContinuationLeafCount = continuationMode
      ? activeContinuationExpansionGaps.reduce((total, gap, index) => total + expandStrictGapIntoRemediationLeaves(gap, index, { phases: fullCloneContinuationPhases(continuationWaveIndex), continuationWaveIndex }).filter((unit) => remediationLeafUnitAlreadySatisfied(unit)).length, 0)
      : 0;
    const allContinuationFocusLanes = continuationMode
      ? Array.from(new Set(activeContinuationExpansionGaps.map((gap) => resolveStrictGapFocusGroup(gap.id)).filter(Boolean)))
      : [];
    const allExecutableLeafCount = continuationMode ? allContinuationLeafCount : remediationMode ? allRemediationLeafCount : frontierMode ? allFrontierLeafCount : structuralMode ? allStructuralLeafCount : allSwarmLeafCount;
    const allSaturatedExecutableLeafCount = continuationMode ? allSaturatedContinuationLeafCount : remediationMode ? allSaturatedRemediationLeafCount : frontierMode ? allSaturatedFrontierLeafCount : structuralMode ? allSaturatedStructuralLeafCount : allSaturatedSwarmLeafCount;
    const allExecutableFocusLanes = continuationMode ? allContinuationFocusLanes : remediationMode ? allRemediationFocusLanes : frontierMode ? allFrontierFocusLanes : structuralMode ? allStructuralFocusLanes : allSwarmFocusLanes;
    let workUnits = strictGapState.swarmMode === true
      ? strictGapState.selectedGaps.flatMap((gap, index) => expandExecutableLeaves(gap, index)
        .filter((unit) => !executableLeafAlreadySatisfied(unit) && !executableLeafIsTemporarilyExcluded(unit)))
      : strictGapState.selectedGaps.map((gap, index) => {
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
          broadFullCloneObjective: gap.broadFullCloneObjective === true,
          repairRetry: strictGapState.repairFocusIds?.has(focusId) === true,
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
    if (continuationMode && workUnits.length === 0 && allSaturatedContinuationLeafCount < allContinuationLeafCount) {
      // Full-clone continuation can reach a pathological state where durable
      // focus credit removes the only selected focus lanes, while the broader
      // continuation wave still has unsatisfied executable leaves. Returning an
      // empty graph lets the live tier look mechanically green with zero shard
      // work even though the matrix is red/partial. Reopen the unsaturated
      // continuation leaves from the active expansion pool instead, including
      // verified-complete roots only when every ordinary lane has been
      // exhausted and the strict full-clone objective is still red.
      workUnits = activeContinuationExpansionGaps.flatMap((gap, index) => expandStrictGapIntoRemediationLeaves(gap, index, {
        phases: fullCloneContinuationPhases(continuationWaveIndex),
        continuationWaveIndex
      }).filter((unit) => !remediationLeafUnitAlreadySatisfied(unit) && !executableLeafIsTemporarilyExcluded(unit)));
    }
    const semanticDirector = buildSemanticWorkDirectorPlan({
      gaps: strictGapState.allGaps,
      completed: new Set([...completed, ...hardCompleted]),
      hardCompleted,
      excluded: strictGapState.excludedFocusIds || new Set(),
      continuationMode,
      remediationMode,
      continuationWaveIndex,
      workUnits,
      allExecutableLeafCount,
      allSaturatedExecutableLeafCount
    });
    if (semanticDirector.active && semanticDirector.workUnits.length > 0) {
      workUnits = semanticDirector.workUnits.filter((unit) => !executableLeafIsTemporarilyExcluded(unit));
    }
    const sharedObjectiveExpansionPlan = mailchimpSharedObjectiveExpansionPlan({
      currentWorkCount: workUnits.length,
      scopeAlreadySatisfied: continuationMode && workUnits.length === 0,
      supervisorState: {
        status: 'red',
        matrixStatus: workUnits.length === 0 ? 'all_complete' : 'partial',
        parityStatus: 'blocked',
        blockerKind: continuationMode && workUnits.length === 0 ? 'queue_exhausted_objective_remaining' : null,
        requestedFidelity: requestedFidelity()
      }
    });
    const sharedObjectiveExpansionFallbackActive = sharedObjectiveExpansionPlan?.shouldExpand === true && workUnits.length === 0;
    let sharedObjectiveExpansionDroppedNonExecutableCount = 0;
    if (sharedObjectiveExpansionFallbackActive) {
      const adaptedExpansionUnits = (sharedObjectiveExpansionPlan.workGraph?.workUnits || [])
        .map((unit, index) => adaptSharedObjectiveExpansionWorkUnit(unit, index))
        .filter((unit) => !executableLeafIsTemporarilyExcluded(unit));
      workUnits = adaptedExpansionUnits.filter((unit) => hasExecutableProductRuntimeContract(unit));
      sharedObjectiveExpansionDroppedNonExecutableCount = adaptedExpansionUnits.length - workUnits.length;
    }
    const semanticDirectorFocusIds = new Set(semanticDirector.active ? semanticDirector.selectedFocusIds : []);
    const rolePlan = strictGapState.swarmMode === true ? swarmRolePlan() : null;
    const strictHierarchicalPlan = buildStrictHierarchicalPlan({
      objectiveId: 'mailchimp_strict_full_clone_planning_layer',
      targetPath: ROOT,
      requestedFidelity: requestedFidelity(),
      gaps: strictGapState.allGaps,
      workUnits,
      mode: 'mailchimp_strict_gap_inventory',
      continuationWaveIndex,
      rolePlan
    });
    workUnits = bindStrictHierarchicalPlanToWorkUnits(workUnits, strictHierarchicalPlan);
    const gapSatisfiedForCurrentMode = (gap) => {
      const focusId = strictGapFocusId(gap);
      const gapRequiresCurrentExpansion = strictGapInCurrentExpansionPool(gap, { structuralMode, remediationMode, strictInventoryRemediationMode });
      const continuationSatisfied = continuationMode && gapRequiresCurrentExpansion && strictGapContinuationAlreadySatisfied(gap, continuationWaveIndex);
      const freshContinuationOpen = reopenVerifiedContinuationRoots && continuationMode && gapRequiresCurrentExpansion && !continuationSatisfied;
      const durableCompleted = !freshContinuationOpen
        && (hardCompleted.has(focusId) || (completed.has(focusId) && (!continuationMode || !gapRequiresCurrentExpansion || continuationSatisfied)));
      return durableCompleted
        || (strictGapSatisfactionCreditApplies() && strictGapAlreadySatisfied(gap.id))
        || (strictGapState.swarmMode === true && (!structuralMode || !gapRequiresCurrentExpansion) && strictGapSwarmAlreadySatisfied(gap))
        || (structuralMode && !frontierMode && gapRequiresCurrentExpansion && strictGapStructuralAlreadySatisfied(gap))
        || (frontierMode && !remediationMode && gapRequiresCurrentExpansion && strictGapFrontierAlreadySatisfied(gap))
        || (remediationMode && !continuationMode && gapRequiresCurrentExpansion && strictGapRemediationAlreadySatisfied(gap))
        || continuationSatisfied;
    };
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
          selectedRootFocusIds: Array.from(selectedIds),
          strictGapInventoryPath: path.relative(ROOT, strictGapInventorySourcePath() || STRICT_GAP_INVENTORY_PATH),
          strictGapSequenceMode: strictGapState.swarmMode === true ? false : strictGapSequenceEnabled(),
          swarmMode: strictGapState.swarmMode === true,
          structuralMode,
          frontierMode,
          remediationMode,
          strictInventoryRemediationMode,
          continuationMode,
          continuationWaveIndex,
          requestedAgentCount: requestedAgentCount(),
          rolePlan,
          totalSwarmLeafCount,
          saturatedSwarmLeafCount,
          allSwarmLeafCount,
          allSaturatedSwarmLeafCount,
          allSwarmFocusLanes,
          totalStructuralLeafCount,
          saturatedStructuralLeafCount,
          allStructuralLeafCount,
          allSaturatedStructuralLeafCount,
          allStructuralFocusLanes,
          totalFrontierLeafCount,
          saturatedFrontierLeafCount,
          allFrontierLeafCount,
          allSaturatedFrontierLeafCount,
          allFrontierFocusLanes,
          totalRemediationLeafCount,
          saturatedRemediationLeafCount,
          allRemediationLeafCount,
          allSaturatedRemediationLeafCount,
          allRemediationFocusLanes,
          allContinuationLeafCount,
          allSaturatedContinuationLeafCount,
          allContinuationFocusLanes,
          allExecutableLeafCount,
          allSaturatedExecutableLeafCount,
          allExecutableFocusLanes,
          reopenVerifiedContinuationRoots,
          continuationFallbackRootFocusIds: reopenVerifiedContinuationRoots
            ? activeContinuationExpansionGaps.map((gap) => strictGapFocusId(gap))
            : [],
          semanticDirector: {
            enabled: semanticDirector.enabled,
            active: semanticDirector.active,
            reason: semanticDirector.reason,
            saturationRatio: semanticDirector.saturationRatio,
            threshold: semanticDirector.threshold,
            selectedGapCount: semanticDirector.selectedGapCount,
            phaseCount: semanticDirector.phaseCount,
            selectedFocusIds: semanticDirector.selectedFocusIds,
            targetFocusIds: semanticDirector.targetFocusIds,
            targetEpicFocusIds: semanticDirector.targetEpicFocusIds,
            architectureEpicPlan: semanticDirector.architectureEpicPlan,
            policy: semanticDirector.policy
          },
          sharedObjectiveExpansion: sharedObjectiveExpansionPlan ? {
            enabled: true,
            fallbackActive: sharedObjectiveExpansionFallbackActive,
            shouldExpand: sharedObjectiveExpansionPlan.shouldExpand,
            reason: sharedObjectiveExpansionPlan.reason,
            mode: sharedObjectiveExpansionPlan.mode,
            expansionSurfaceCount: sharedObjectiveExpansionPlan.expansionSurfaceCount,
            expansionWorkUnitCount: sharedObjectiveExpansionPlan.expansionWorkUnitCount,
            executableWorkUnitCount: sharedObjectiveExpansionFallbackActive ? workUnits.length : 0,
            droppedNonExecutableWorkUnitCount: sharedObjectiveExpansionDroppedNonExecutableCount,
            remainingObjectiveIds: sharedObjectiveExpansionPlan.remainingObjectiveIds,
            truthBoundary: sharedObjectiveExpansionPlan.truthBoundary,
            blocker: sharedObjectiveExpansionPlan.blocker || null
          } : { enabled: false },
          strictHierarchicalPlan: {
            enabled: true,
            planId: strictHierarchicalPlan.planId,
            nodeCount: strictHierarchicalPlan.summary.nodeCount,
            maxDepth: strictHierarchicalPlan.summary.maxDepth,
            workUnitCoverage: strictHierarchicalPlan.summary.workUnitCoverage,
            novelPlannerFeatures: strictHierarchicalPlan.summary.novelPlannerFeatures,
            policy: strictHierarchicalPlan.policy
          },
          strictGapCount: loadStrictGapInventory().length,
          strictInventoryRemediationObjectiveCount: strictGapState.allGaps.filter((gap) => strictInventoryGapRequiresFullCloneRemediation(gap)).length,
          broadFullCloneObjectiveCount: strictGapState.allGaps.filter((gap) => gap.broadFullCloneObjective === true).length,
          repairFocusIds: Array.from(strictGapState.repairFocusIds || [])
        },
        workUnits
      },
      verifierCatalog: buildVerifierCatalog(),
      surfaceMatrix: {
        generatedAt: new Date().toISOString(),
        status: (semanticDirector.active || sharedObjectiveExpansionFallbackActive || sharedObjectiveExpansionPlan?.shouldExpand === true) ? 'partial' : (strictGapState.allGaps.length > 0 && strictGapState.allGaps.every((gap) => gapSatisfiedForCurrentMode(gap)) ? 'all_complete' : 'partial'),
        surfaces: strictGapState.allGaps.map((gap) => {
          const focusId = strictGapFocusId(gap);
          const gapRequiresCurrentExpansion = strictGapInCurrentExpansionPool(gap, { structuralMode, remediationMode, strictInventoryRemediationMode });
          const strictSatisfied = strictGapSatisfactionCreditApplies() && strictGapAlreadySatisfied(gap.id);
          const swarmSatisfied = strictGapState.swarmMode === true && (!structuralMode || !gapRequiresCurrentExpansion) && strictGapSwarmAlreadySatisfied(gap);
          const structuralSatisfied = structuralMode && !frontierMode && gapRequiresCurrentExpansion && strictGapStructuralAlreadySatisfied(gap);
          const frontierSatisfied = frontierMode && !remediationMode && gapRequiresCurrentExpansion && strictGapFrontierAlreadySatisfied(gap);
          const remediationSatisfied = remediationMode && !continuationMode && gapRequiresCurrentExpansion && strictGapRemediationAlreadySatisfied(gap);
          const continuationSatisfied = continuationMode && gapRequiresCurrentExpansion && strictGapContinuationAlreadySatisfied(gap, continuationWaveIndex);
          const saturated = strictSatisfied || swarmSatisfied || structuralSatisfied || frontierSatisfied || remediationSatisfied || continuationSatisfied;
          const excluded = strictGapState.excludedFocusIds?.has(focusId);
          const repairActive = strictGapState.repairFocusIds?.has(focusId) && selectedIds.has(focusId);
          const freshContinuationOpen = reopenVerifiedContinuationRoots && continuationMode && gapRequiresCurrentExpansion && !continuationSatisfied;
          const durableCompleted = !freshContinuationOpen
            && (hardCompleted.has(focusId) || (completed.has(focusId) && (!continuationMode || !gapRequiresCurrentExpansion || continuationSatisfied)));
          const done = durableCompleted || saturated;
          return {
            id: gap.id,
            status: semanticDirectorFocusIds.has(focusId)
              ? 'semantic_frontier_active'
              : done
                ? (saturated && !durableCompleted ? (continuationSatisfied ? 'continuation_leaf_satisfied' : remediationSatisfied ? 'remediation_leaf_satisfied' : frontierSatisfied ? 'frontier_leaf_satisfied' : structuralSatisfied ? 'structural_leaf_satisfied' : swarmSatisfied ? 'swarm_leaf_satisfied' : 'product_satisfied') : 'proven_complete')
              : repairActive
                ? 'repair_active'
                : excluded
                ? 'excluded_until_repaired'
                : selectedIds.has(focusId) ? 'active_gap' : 'remaining_gap',
            title: gap.title,
            notes: gap.detail || null,
            issueIds: [focusId],
            productFiles: expandStrictGapCandidateAreas(gap.candidateAreas || []),
            targetedTests: resolveStrictGapTargetedTests(gap.id),
            focusId,
            strictGap: true,
            broadFullCloneObjective: gap.broadFullCloneObjective === true
          };
        })
      },
      globalInputs: {
        semanticObjectiveDirectorPolicy: 'For full-clone work, infer the missing Mailchimp-grade architecture for the assigned capability, choose the highest-leverage primary runtime changes, avoid isolated generated marker modules, and prove adoption through route/shell/server/job/persistence/provider/test evidence.',
        strictHierarchicalPlanPolicy: strictHierarchicalPlan.policy
      },
      strictHierarchicalPlan,
      issueGraph: {
        generatedAt: new Date().toISOString(),
        issues: strictGapState.allGaps.map((gap) => ({
          id: strictGapFocusId(gap),
          title: gap.title,
          status: semanticDirectorFocusIds.has(strictGapFocusId(gap))
            ? 'open'
            : gapSatisfiedForCurrentMode(gap)
              ? 'complete'
              : strictGapState.excludedFocusIds?.has(strictGapFocusId(gap)) ? 'excluded_until_repaired' : 'open',
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
    const carriedCompletedFocusIds = carryCompletedFocusIds ? completedFocusIds() : new Set();
    const benchmarkSatisfiedFocusIds = new Set(scopedBenchmarkSurfaces
      .filter((surface) => {
        if (!carryCompletedFocusIds || !strictGapSaturationCreditEnabled() || !strictGapAlreadySatisfied(surface.id)) return false;
        const canonicalFiles = resolveStrictGapImplementationFiles(surface.id);
        if (canonicalFiles.length === 0) return false;
        const allowed = new Set(surface.allowedFiles || []);
        return canonicalFiles.some((filePath) => allowed.has(filePath));
      })
      .map((surface) => surface.focusId));
    const completed = new Set([...carriedCompletedFocusIds, ...benchmarkSatisfiedFocusIds]);
    const excluded = excludedFocusIds();
    const remainingOpenFocusIds = new Set(workUnits.map((unit) => unit.id).filter((id) => !completed.has(id) && !excluded.has(id)));
    const contractScopeParallelAll = process.env.MAILCHIMP_CONTRACT_SCOPE_PARALLEL_ALL !== '0';
    const selectedParityFocusIds = PRODUCT_ONLY_MODE && !contractScopeParallelAll
      ? new Set(selectNonOverlappingFocusIds(Array.from(remainingOpenFocusIds)))
      : remainingOpenFocusIds;
    const scopedWorkUnits = workUnits.filter((unit) => selectedParityFocusIds.has(unit.id));
    const scopedSurfaces = scopedBenchmarkSurfaces.map((surface) => ({
      id: surface.id,
      label: surface.label,
      issueIds: [surface.focusId],
      lane: surface.lane,
      requiredArtifacts: Array.from(new Set([...surface.allowedFiles, ...surface.targetedTests])),
      status: completed.has(surface.focusId)
        ? 'proven_complete'
        : excluded.has(surface.focusId)
          ? 'excluded_until_repaired'
          : 'open'
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
          excludedParityFocusIds: Array.from(excluded).filter((id) => workUnits.some((unit) => unit.id === id)),
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

  const excluded = excludedFocusIds();
  const remainingOpenFocusIds = PRODUCT_ONLY_MODE
    ? new Set(remainingParityFocusIds(completedFocusIds()))
    : new Set(workUnits.map((unit) => unit.id).filter((id) => !excluded.has(id)));
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
      status: excluded.has(`focus.${surface.id}`)
        ? 'excluded_until_repaired'
        : remainingOpenFocusIds.has(`focus.${surface.id}`) ? 'open' : 'proven_complete'
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
  const chaosEnabled = process.env.ORCHESTRATOR_ENABLE_FAILURE_INJECTIONS === '1'
    || process.env.ORCHESTRATOR_ENABLE_CHAOS === '1';
  if (!chaosEnabled) return [];
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
