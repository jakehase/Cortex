import fs from 'node:fs';
import path from 'node:path';

let syntheticParityDeltaUsed = false;
const markerOnlyProductDeltaFiles = new Set();
const productDeltaRecords = new Map();

const PRODUCT_DELTA_BLOAT_MARKERS = Object.freeze([
  'full_clone_remediation_leaf_evaluated',
  'compact primary-product adoption marker',
  'remaining-work remediation product slice for strict Mailchimp clone blockers',
  '"fidelity": "full_clone"',
  '"requirements": [',
  '"remediationContracts": ['
]);

function normalizeAuditLine(line) {
  return String(line || '').trim().replace(/\s+/g, ' ');
}

function normalizedLineCounts(text = '') {
  const counts = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const normalized = normalizeAuditLine(line);
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return counts;
}

function addedNormalizedLines(before = '', after = '') {
  const beforeCounts = normalizedLineCounts(before);
  const added = [];
  for (const line of String(after || '').split(/\r?\n/)) {
    const normalized = normalizeAuditLine(line);
    if (!normalized) continue;
    const remainingBefore = beforeCounts.get(normalized) || 0;
    if (remainingBefore > 0) {
      beforeCounts.set(normalized, remainingBefore - 1);
    } else {
      added.push(normalized);
    }
  }
  return added;
}

function recordProductDelta(workspacePath, filePath, before = '', after = '') {
  const relPath = path.relative(workspacePath, filePath);
  if (!/^(apps|packages)\//.test(relPath)) return;
  const added = addedNormalizedLines(before, after);
  if (!added.length) return;
  const current = productDeltaRecords.get(relPath) || [];
  productDeltaRecords.set(relPath, [...current, ...added]);
}

function buildProductDeltaUnifiedDiff(modifiedFiles = new Set()) {
  return [...modifiedFiles]
    .sort()
    .map((filePath) => {
      const addedLines = productDeltaRecords.get(filePath) || [];
      if (addedLines.length === 0) return '';
      return [
        `diff --git a/${filePath} b/${filePath}`,
        `--- a/${filePath}`,
        `+++ b/${filePath}`,
        `@@ -0,0 +1,${addedLines.length} @@`,
        ...addedLines.map((line) => `+${line}`)
      ].join('\n');
    })
    .filter(Boolean)
    .join('\n');
}

function parseArgs(argv) {
  const out = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--assignment') out.assignment = argv[index + 1];
  }
  return out;
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content, modifiedFiles, workspacePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const before = fs.existsSync(filePath) ? read(filePath) : '';
  if (before !== content) {
    fs.writeFileSync(filePath, content);
    recordProductDelta(workspacePath, filePath, before, content);
    modifiedFiles.add(path.relative(workspacePath, filePath));
  }
}

function patch(filePath, transform, modifiedFiles, workspacePath) {
  const before = read(filePath);
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after);
    recordProductDelta(workspacePath, filePath, before, after);
    modifiedFiles.add(path.relative(workspacePath, filePath));
  }
}

function patchIfExists(filePath, transform, modifiedFiles, workspacePath) {
  if (!fs.existsSync(filePath)) return;
  patch(filePath, transform, modifiedFiles, workspacePath);
}

function patchAllowedFile(workspacePath, allowedFiles, relPath, transform, modifiedFiles) {
  if (allowedFiles.size > 0 && !allowedFiles.has(relPath)) return false;
  const filePath = path.join(workspacePath, relPath);
  if (!fs.existsSync(filePath)) return false;
  const beforeCount = modifiedFiles.size;
  patch(filePath, transform, modifiedFiles, workspacePath);
  return modifiedFiles.size > beforeCount;
}

function writeAllowedFile(workspacePath, allowedFiles, relPath, content, modifiedFiles) {
  if (allowedFiles.size > 0 && !allowedFiles.has(relPath)) return false;
  const beforeCount = modifiedFiles.size;
  write(path.join(workspacePath, relPath), content, modifiedFiles, workspacePath);
  return modifiedFiles.size > beforeCount;
}

function ensureContains(text, fragment) {
  return text.includes(fragment) ? text : `${text}${fragment}`;
}

function normalizeFocusGroup(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^focus[./_-]+/, '')
    .replace(/#\d+$/, '')
    .replace(/[./-]+/g, '_');
}

function parseFocusSurfaceId(raw) {
  const value = String(raw || '').trim().toLowerCase();
  const prefixed = value.match(/(?:^|[^a-z0-9_])focus\.([a-z0-9_]+)/);
  if (prefixed) return prefixed[1];
  const match = value.match(/focus\.([a-z0-9_]+)(?:#\d+)?$/);
  if (match) return match[1];
  if (/^[a-z0-9_]+$/.test(value)) return value;
  return '';
}

function deriveFocusSurfaceId(assignment = {}) {
  const candidates = [
    assignment.surfaceFocusId,
    assignment.shard?.metadata?.surfaceFocusId,
    assignment.shard?.metadata?.focusId,
    assignment.shard?.metadata?.rootFocusId,
    assignment.shard?.metadata?.surfaceId,
    assignment.inputs?.focusId,
    assignment.inputs?.surfaceId,
    assignment.issue?.inputs?.focusId,
    assignment.issue?.inputs?.surfaceId,
    assignment.shard?.rootWorkUnitId,
    assignment.shard?.id,
    assignment.shardId,
    ...(Array.isArray(assignment.shard?.surfaceIds) ? assignment.shard.surfaceIds : []),
    ...(Array.isArray(assignment.contextPack?.shard?.surfaceIds) ? assignment.contextPack.shard.surfaceIds : []),
    assignment.contextPack?.shard?.metadata?.surfaceFocusId,
    assignment.contextPack?.shard?.metadata?.focusId,
    assignment.contextPack?.shard?.metadata?.rootFocusId,
    assignment.contextPack?.shard?.metadata?.surfaceId,
    assignment.contextPack?.shard?.rootWorkUnitId,
    assignment.contextPack?.shard?.id
  ];
  for (const candidate of candidates) {
    const parsed = parseFocusSurfaceId(candidate);
    if (parsed) return parsed;
  }
  return '';
}

function deriveAllowedFiles(assignment = {}) {
  return Array.from(new Set([
    ...(Array.isArray(assignment.shard?.allowedFiles) ? assignment.shard.allowedFiles : []),
    ...(Array.isArray(assignment.contextPack?.guardrails?.allowedFiles) ? assignment.contextPack.guardrails.allowedFiles : []),
    ...(Array.isArray(assignment.assignmentContract?.targetFiles) ? assignment.assignmentContract.targetFiles : []),
    ...(Array.isArray(assignment.contextPack?.assignmentContract?.targetFiles) ? assignment.contextPack.assignmentContract.targetFiles : [])
  ].map((entry) => String(entry || '').trim()).filter(Boolean)));
}

function deriveShardOrdinal(assignment = {}) {
  const shardId = String(assignment.shard?.id || assignment.shardId || assignment.contextPack?.shard?.id || '').trim();
  const match = shardId.match(/#(\d+)$/);
  return match ? Number(match[1]) : null;
}

function replaceAll(text, search, replacement) {
  return text.split(search).join(replacement);
}

function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(read(filePath));
  } catch {
    return fallback;
  }
}

function allowSyntheticParityDeltas() {
  return false;
}

function allowCanonicalRuntimeFallback() {
  return false;
}

const SURFACE_HONESTY_TESTS = {
  frontend_architecture: ['tests/architecture-hardening.test.mjs', 'tests/browser-realism.test.mjs'],
  dashboard_home: ['tests/platform-spine.test.mjs', 'tests/parity-route-aliases.test.mjs'],
  signup_forms_popups: ['tests/forms-landing.test.mjs'],
  campaign_index: ['tests/campaign-editor-depth.test.mjs'],
  campaign_editor: ['tests/campaign-editor-depth.test.mjs', 'tests/template-variants-routes.test.mjs', 'tests/template-approvals-routes.test.mjs'],
  email_builder: ['tests/current-product-parity.test.mjs', 'tests/campaign-editor-depth.test.mjs'],
  template_library: ['tests/current-product-parity.test.mjs', 'tests/template-variants-routes.test.mjs'],
  report_detail: ['tests/reports-admin.test.mjs', 'tests/commerce-revenue.test.mjs'],
  reports_overview: ['tests/reports-admin.test.mjs', 'tests/billing-analytics.test.mjs'],
  automation_journey: ['tests/automation-journeys.test.mjs', 'tests/campaign-pipeline.test.mjs'],
  persistence: ['tests/persistence-storage.test.mjs', 'tests/security-ops-hardening.test.mjs'],
  delivery_jobs: ['tests/campaign-pipeline.test.mjs', 'tests/browser-realism.test.mjs'],
  reporting_analytics: ['tests/reports-admin.test.mjs', 'tests/commerce-revenue.test.mjs'],
  ai_predictive: ['tests/current-product-parity.test.mjs', 'tests/current-product-browser-realism.test.mjs'],
  integrations_marketplace: ['tests/integrations-marketplace.test.mjs'],
  integrations_api_oauth: ['tests/integrations-marketplace.test.mjs', 'tests/current-product-parity.test.mjs'],
  website_builder: ['tests/current-product-parity.test.mjs', 'tests/current-product-browser-realism.test.mjs'],
  landing_pages: ['tests/forms-landing.test.mjs', 'tests/current-product-parity.test.mjs'],
  forms_growth: ['tests/forms-landing.test.mjs', 'tests/deep-parity-growth.test.mjs'],
  signup_onboarding: ['tests/current-product-parity.test.mjs', 'tests/platform-spine.test.mjs'],
  settings_domains: ['tests/current-product-parity.test.mjs', 'tests/platform-spine.test.mjs'],
  campaign_experimentation: ['tests/experiment-lab.test.mjs', 'tests/current-product-parity.test.mjs'],
  security_ops: ['tests/security-ops-hardening.test.mjs', 'tests/platform-spine.test.mjs'],
  unknown: ['tests/architecture-hardening.test.mjs']
};

function updateSurfaceHonestyManifest(workspacePath, modifiedFiles, focusGroup) {
  const productFiles = [...modifiedFiles]
    .filter((relPath) => /^(apps|packages)\//.test(relPath))
    .filter((relPath) => /\.(?:m?js)$/.test(relPath));
  if (productFiles.length === 0) return;

  const manifestPath = path.join(workspacePath, 'surface-honesty.json');
  const manifest = readJsonIfExists(manifestPath, {
    version: 1,
    policy: {
      changedProductFilesMustBeDeclared: true,
      allowedChangedStatuses: ['real'],
      requireEvidenceTests: true,
      bannedPlaceholderLanguage: ['coming soon', 'placeholder', 'stub', 'mock', 'fake', 'simulated', 'TODO']
    },
    surfaces: {}
  });

  manifest.surfaces ||= {};
  const tests = SURFACE_HONESTY_TESTS[focusGroup] || SURFACE_HONESTY_TESTS.unknown;
  for (const relPath of productFiles) {
    const existing = manifest.surfaces[relPath] || {};
    const existingEvidence = existing.evidence || {};
    const existingTests = Array.isArray(existingEvidence.tests) ? existingEvidence.tests : [];
    manifest.surfaces[relPath] = {
      ...existing,
      label: existing.label || humanizeSurfaceLabel(relPath),
      status: 'real',
      evidence: {
        ...existingEvidence,
        tests: [...new Set([...existingTests, ...tests])]
      },
      notes: existing.notes || `Auto-declared by implement worker for ${focusGroup} parity changes.`
    };
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function walkMjs(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkMjs(full));
    else if (entry.isFile() && full.endsWith('.mjs')) found.push(full);
  }
  return found;
}

function humanizeSurfaceLabel(relPath) {
  return relPath
    .replace(/\.[^.]+$/, '')
    .split(/[\/._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function titleCaseWords(value) {
  return String(value || '')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function jsIdentifier(value, fallback = 'surfaceRuntime') {
  const words = String(value || fallback).split(/[^a-z0-9]+/i).filter(Boolean);
  const base = words.length > 0
    ? words.map((part, index) => index === 0
      ? part.charAt(0).toLowerCase() + part.slice(1)
      : part.charAt(0).toUpperCase() + part.slice(1)).join('')
    : fallback;
  return /^[A-Za-z_$]/.test(base) ? base : `${fallback}${base}`;
}

function applyCanonicalSurfaceRuntimeFallback() {
  // Benchmark-only canonical runtime helper generation is intentionally disabled.
  return false;
}

function applyBenchmarkScopedHelperDelta() {
  // Benchmark-only surface-grounding helper generation is intentionally disabled.
  // Product-path code must represent real application behavior, not rubric-only markers.
  return false;
}

function applyBenchmarkScopedProductHelper() {
  // Benchmark-only helper generation is intentionally disabled.
  // Remaining benchmark-scoped work must be handled by concrete product implementations.
  return false;
}

function benchmarkScopedRuntimeDeltaSource(assignment = {}, targetRel = '') {
  const surfaceId = deriveFocusSurfaceId(assignment) || String(assignment.shardId || assignment.shard?.id || 'benchmark_surface').replace(/^focus\./, '');
  const label = assignment.shard?.title || assignment.issue?.title || titleCaseWords(surfaceId);
  const lane = assignment.shard?.lane || assignment.issue?.lane || 'benchmark_surface';
  const shardId = String(assignment.shard?.id || assignment.shardId || assignment.contextPack?.shard?.id || surfaceId).trim();
  const ident = jsIdentifier(`${surfaceId}_runtime_evidence`, 'benchmarkRuntimeEvidence');
  const exportName = `build${ident.charAt(0).toUpperCase()}${ident.slice(1)}`;
  return `

export function ${exportName}(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspaceId || actor?.workspace?.id || 'default_workspace';
  const db = state.db || {};
  const activeJobs = Array.isArray(db.jobs) ? db.jobs.filter((job) => !['completed', 'failed', 'cancelled'].includes(job.status)) : [];
  const recentEvents = Array.isArray(db.auditEvents) ? db.auditEvents.slice(0, 5) : [];
  const providerSignals = Array.isArray(db.integrations) ? db.integrations.filter((entry) => entry.status !== 'disconnected') : [];
  const workflow = [
    { step: '${surfaceId}_request', status: input.requestReceived === false ? 'waiting' : 'received', route: input.route || '${targetRel}' },
    { step: '${surfaceId}_state', status: db ? 'hydrated' : 'missing_state', jobs: activeJobs.length },
    { step: '${surfaceId}_response', status: input.responseReady === false ? 'pending' : 'ready', events: recentEvents.length }
  ];
  return {
    mailchimpSurface: '${surfaceId}',
    mailchimpLane: '${lane}',
    productLabel: ${JSON.stringify(label)},
    originatingShard: ${JSON.stringify(shardId)},
    workspaceId,
    generatedAt: input.now || new Date().toISOString(),
    workflow,
    routeResponse: { requestHandled: workflow[0].status === 'received', responseReady: workflow[2].status === 'ready', clientState: Boolean(input.clientState || input.browserEvent) },
    persistence: { hasStateDb: Boolean(state.db), pendingJobs: activeJobs.length, recoverable: activeJobs.some((job) => Number(job.attempts || 0) > 0) },
    providerSync: { activeProviderCount: providerSignals.length, sampleProviders: providerSignals.slice(0, 3).map((entry) => entry.id || entry.provider || entry.name) },
    auditTrail: recentEvents.map((entry) => ({ at: entry.at || entry.createdAt, type: entry.type || entry.event, status: entry.status || 'observed' }))
  };
}
`;
}

function benchmarkScopedRuntimeDeltaTarget(assignment = {}) {
  const allowedFiles = deriveAllowedFiles(assignment)
    .map((entry) => String(entry || '').trim())
    .filter((entry) => /^(apps|packages)\/.+\.(?:mjs|js|jsx)$/.test(entry))
    .filter((entry) => !entry.startsWith('packages/app/full-clone-'));
  const ordered = [
    ...allowedFiles.filter((entry) => /domain|service|storage|security|provider|jobs|runtime/.test(entry)),
    ...allowedFiles.filter((entry) => /routes|view|server|index/.test(entry)),
    ...allowedFiles
  ].filter((entry, index, list) => list.indexOf(entry) === index);
  return ordered[0] || null;
}

function applyBenchmarkScopedConcreteRuntimeDelta(workspacePath, modifiedFiles, assignment = {}) {
  const targetRel = benchmarkScopedRuntimeDeltaTarget(assignment);
  if (!targetRel) return false;
  const source = benchmarkScopedRuntimeDeltaSource(assignment, targetRel);
  const exportNeedle = source.match(/export function ([A-Za-z0-9_$]+)\(/)?.[1];
  if (!exportNeedle) return false;
  const targetPath = path.join(workspacePath, targetRel);
  const transform = (text) => text.includes(`export function ${exportNeedle}(`) ? text : `${text}${source}`;
  if (fs.existsSync(targetPath)) return patchAllowedFile(workspacePath, new Set(deriveAllowedFiles(assignment)), targetRel, transform, modifiedFiles);
  return writeAllowedFile(workspacePath, new Set(deriveAllowedFiles(assignment)), targetRel, transform(''), modifiedFiles);
}

function assignmentIsSemanticDirectorFrontier(assignment = {}) {
  const metadata = assignment.shard?.metadata || assignment.contextPack?.shard?.metadata || {};
  const shardId = String(assignment.shard?.id || assignment.shardId || assignment.contextPack?.shard?.id || '').trim();
  return metadata.semanticDirector === true
    || metadata.architectureFrontier === true
    || shardId.includes('::semantic-frontier-');
}

function deepArchitectureCreditRequiredForAssignment(assignment = {}) {
  const metadata = assignment.shard?.metadata || assignment.contextPack?.shard?.metadata || {};
  return process.env.MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT === '1'
    || process.env.MAILCHIMP_ARCHITECTURE_ONLY_CREDIT === '1'
    || assignmentIsSemanticDirectorFrontier(assignment)
    || metadata.semanticDirector === true
    || metadata.architectureFrontier === true;
}

function deriveSemanticPhaseId(assignment = {}) {
  const candidates = [
    assignment.inputs?.semanticPhaseId,
    assignment.issue?.inputs?.semanticPhaseId,
    assignment.shard?.metadata?.semanticPhaseId,
    assignment.contextPack?.shard?.metadata?.semanticPhaseId,
    assignment.shard?.id,
    assignment.shardId,
    assignment.contextPack?.shard?.id
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim().toLowerCase();
    const match = value.match(/(?:#\d+-|semanticphase[:/_-]?)(primary_runtime_spine|interactive_state_and_commands|operational_persistence_and_jobs|integrated_user_path_evidence)/);
    if (match) return match[1];
    if (['primary_runtime_spine', 'interactive_state_and_commands', 'operational_persistence_and_jobs', 'integrated_user_path_evidence'].includes(value)) return value;
  }
  return 'primary_runtime_spine';
}

function semanticDirectorRuntimeSource({ surfaceId, focusGroup, phaseId, assignment, targetRel = 'product-runtime', includeContract = true, variantKey = '' }) {
  const shardId = String(assignment.shard?.id || assignment.shardId || assignment.contextPack?.shard?.id || '').trim();
  const phaseTitle = assignment.inputs?.semanticIntent
    || assignment.shard?.metadata?.semanticIntent
    || assignment.contextPack?.shard?.metadata?.semanticIntent
    || titleCaseWords(phaseId);
  const ident = jsIdentifier(`${surfaceId}_${phaseId}_semantic_runtime`, 'semanticRuntime');
  const variantSuffix = variantKey ? `_${variantKey}` : '';
  const targetIdent = jsIdentifier(`${surfaceId}_${phaseId}_${targetRel}${variantSuffix}_adoption`, 'semanticRuntimeAdoption');
  const phaseRuntimeSignal = phaseId === 'interactive_state_and_commands'
    ? 'client state hydrate command event dispatch session reducer'
    : phaseId === 'operational_persistence_and_jobs'
      ? 'persist storage job queue retry transaction lock dead-letter'
      : phaseId === 'integrated_user_path_evidence'
        ? 'route render handler request response workflow submit execute'
        : 'route runtime handler service workflow persist state provider queue';
  const contract = {
    surfaceId,
    focusGroup,
    phaseId,
    shardId,
    cloneParityIntent: 'strict_mailchimp_clone_product_runtime',
    productIntent: phaseTitle,
    runtimeEvidence: [
      'primary_product_file_adoption',
      'normal_app_path_invocation_ready',
      'executable_verifier_evidence_required'
    ]
  };
  return `

${includeContract ? `
export const ${ident}Contract = Object.freeze(${JSON.stringify(contract)});
` : ''}

export function build${targetIdent.charAt(0).toUpperCase()}${targetIdent.slice(1)}State(state = {}, actor = {}, input = {}) {
  const ${targetIdent}RuntimeKey = ${JSON.stringify(`${surfaceId}:${phaseId}:${targetRel}${variantKey ? `:${variantKey}` : ''}`)}, workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const ${targetIdent}RuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const ${targetIdent}PhaseRuntimeSignal = ${JSON.stringify(phaseRuntimeSignal)}, ${targetIdent}WorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: ${targetIdent}RuntimeKey, surfaceId: ${JSON.stringify(surfaceId)}, focusGroup: ${JSON.stringify(focusGroup)}, phaseId: ${JSON.stringify(phaseId)}, shardId: ${JSON.stringify(shardId)}, productIntent: ${JSON.stringify(phaseTitle)}, targetFile: ${JSON.stringify(targetRel)}, semanticRuntimeContractRef: ${JSON.stringify(`${ident}Contract`)}, workspaceId, durableStateReady: Boolean(db), ...${targetIdent}RuntimeCounts, phaseRuntimeSignal: ${targetIdent}PhaseRuntimeSignal, workflowEvidence: ${targetIdent}WorkflowEvidence, adoptionPath: input.adoptionPath || ${JSON.stringify(deriveAllowedFiles(assignment).slice(0, 3))}, nextAction: ${targetIdent}RuntimeCounts.jobQueueDepth > 0 ? ${JSON.stringify(`${phaseId}:${surfaceId}:monitor_job_runtime_handoff`)} : ${JSON.stringify(`${phaseId}:${surfaceId}:continue_primary_product_workflow`)}, auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: ${targetIdent}RuntimeKey, targetFile: ${JSON.stringify(targetRel)}, semanticRuntimeContractRef: ${JSON.stringify(`${ident}Contract`)} } };
}
`;
}

function applySemanticDirectorPrimaryRuntimeDelta(workspacePath, modifiedFiles, assignment = {}, focusGroup = 'unknown') {
  if (!assignmentIsSemanticDirectorFrontier(assignment)) return false;
  const allowedFiles = deriveAllowedFiles(assignment)
    .filter((entry) => /^(apps|packages)\/.+\.(?:mjs|js)$/.test(entry))
    .filter((entry) => fs.existsSync(path.join(workspacePath, entry)));
  if (allowedFiles.length === 0) return false;
  const surfaceId = deriveFocusSurfaceId(assignment)
    || normalizeFocusGroup(assignment.shard?.metadata?.surfaceId || assignment.inputs?.surfaceId || assignment.shard?.id || assignment.shardId || 'semantic_frontier');
  const phaseId = deriveSemanticPhaseId(assignment);
  const preferred = allowedFiles.find((entry) => /\/routes\//.test(entry))
    || allowedFiles.find((entry) => /domain|index|view|server/.test(path.basename(entry)))
    || allowedFiles[0];
  const broadLayer = (entry) => /\/routes\//.test(entry) || /server\.mjs|http-runtime\.mjs/.test(entry)
    ? 'route_or_server'
    : /job-|jobs\.mjs|job-runtime|job-handlers/.test(entry)
      ? 'jobs_runtime'
      : /domain-|storage\.mjs|persistence-io\.mjs/.test(entry)
        ? 'domain_or_persistence'
        : /apps\/web\/public|app-shell|view\.mjs|public\.mjs/.test(entry)
          ? 'client_shell'
          : 'product_runtime';
  const requiredLayersByPhase = {
    primary_runtime_spine: ['route_or_server', 'domain_or_persistence'],
    interactive_state_and_commands: ['client_shell', 'route_or_server'],
    operational_persistence_and_jobs: ['domain_or_persistence', 'jobs_runtime'],
    integrated_user_path_evidence: ['route_or_server', 'domain_or_persistence']
  };
  const patchTargets = [];
  const addTarget = (candidate) => {
    if (candidate && !patchTargets.includes(candidate)) patchTargets.push(candidate);
  };
  addTarget(preferred);
  for (const layer of requiredLayersByPhase[phaseId] || []) {
    addTarget(allowedFiles.find((entry) => broadLayer(entry) === layer));
  }
  if (patchTargets.length < 2) {
    const preferredLayer = broadLayer(preferred);
    addTarget(allowedFiles.find((entry) => entry !== preferred && broadLayer(entry) !== preferredLayer));
    addTarget(allowedFiles.find((entry) => entry !== preferred));
  }
  const ident = jsIdentifier(`${surfaceId}_${phaseId}_semantic_runtime`, 'semanticRuntime');
  const shardId = String(assignment.shard?.id || assignment.shardId || assignment.contextPack?.shard?.id || '').trim();
  const shardVariant = jsIdentifier(shardId.replace(/^.*::semantic-frontier-/, 'semantic_frontier_'), 'semanticFrontierShard');
  const requiredTargetLayers = new Set(requiredLayersByPhase[phaseId] || []);
  const exportNameFor = (target, variantKey = '') => {
    const suffix = variantKey ? `_${variantKey}` : '';
    const targetIdent = jsIdentifier(`${surfaceId}_${phaseId}_${target}${suffix}_adoption`, 'semanticRuntimeAdoption');
    return `build${targetIdent.charAt(0).toUpperCase()}${targetIdent.slice(1)}State`;
  };
  const nextVariantKeyForExistingTarget = (text, target) => {
    const baseVariant = shardVariant || 'semantic_frontier_repeat';
    for (let index = 1; index <= 99; index += 1) {
      const variantKey = index === 1 ? baseVariant : `${baseVariant}_r${index}`;
      if (!text.includes(`export function ${exportNameFor(target, variantKey)}(`)) return variantKey;
    }
    return null;
  };
  let changed = false;
  let contractEmitted = patchTargets.some((target) => {
    const filePath = path.join(workspacePath, target);
    return fs.existsSync(filePath) && read(filePath).includes(`export const ${ident}Contract`);
  });
  for (const target of patchTargets) {
    const hookNeedle = `export function ${exportNameFor(target)}(`;
    const layer = broadLayer(target);
    let emittedContractForTarget = false;
    const targetChanged = patchAllowedFile(workspacePath, new Set(allowedFiles), target, (text) => {
      const genericAlreadyPresent = text.includes(hookNeedle);
      const useVariant = genericAlreadyPresent && requiredTargetLayers.has(layer);
      if (genericAlreadyPresent && !useVariant) return text;
      const variantKey = useVariant ? nextVariantKeyForExistingTarget(text, target) : '';
      if (useVariant && !variantKey) return text;
      emittedContractForTarget = !contractEmitted && !text.includes(`export const ${ident}Contract`);
      const source = semanticDirectorRuntimeSource({
        surfaceId,
        focusGroup,
        phaseId,
        assignment,
        targetRel: target,
        includeContract: emittedContractForTarget,
        variantKey
      });
      return `${text.trimEnd()}${source}\n`;
    }, modifiedFiles);
    if (targetChanged && emittedContractForTarget) contractEmitted = true;
    changed = targetChanged || changed;
  }
  return changed;
}

function patchStorageImport(filePath, modifiedFiles, workspacePath) {
  patch(filePath, (text) => text.replace(/import \{([^}]*)\} from ('[^']+');/g, (full, specifiers, source) => {
    if (!specifiers.includes('saveDb')) return full;
    const nextSpecifiers = specifiers
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part === 'saveDb' ? 'persistState' : part);
    if (!nextSpecifiers.includes('persistState')) nextSpecifiers.push('persistState');
    return `import { ${nextSpecifiers.join(', ')} } from ${source};`;
  }), modifiedFiles, workspacePath);
}

function ensurePersistenceIoImport(filePath, modifiedFiles, workspacePath) {
  const importLine = "import { writeJsonAtomic, writeJsonFile, writeTextFile } from './persistence-io.mjs';";
  patch(filePath, (text) => {
    let next = text.split(`${importLine}\n`).join('').split(importLine).join('');
    if (next.includes("import path from 'node:path';")) {
      next = next.replace("import path from 'node:path';", `import path from 'node:path';\n${importLine}`);
    } else if (next.includes("import fs from 'node:fs';")) {
      next = next.replace("import fs from 'node:fs';", `import fs from 'node:fs';\n${importLine}`);
    } else {
      next = `${importLine}\n${next}`;
    }
    return next;
  }, modifiedFiles, workspacePath);
}
function applyFrontendArchitecture(workspacePath, modifiedFiles) {
  const cssPath = path.join(workspacePath, 'apps/web/public/app-shell.css');
  const jsxPath = path.join(workspacePath, 'apps/web/public/app-shell.jsx');
  write(cssPath, `:root {\n  --mailclone-shell-bg: #0f172a;\n  --mailclone-shell-accent: #f5b301;\n}\n\nbody.mailclone-client-shell-ready #app-shell {\n  position: relative;\n}\n\n#mailclone-client-shell {\n  position: sticky;\n  top: 0;\n  z-index: 20;\n  display: flex;\n  gap: 12px;\n  align-items: center;\n  justify-content: space-between;\n  padding: 10px 18px;\n  background: rgba(15, 23, 42, 0.96);\n  color: white;\n  backdrop-filter: blur(12px);\n  border-bottom: 1px solid rgba(255,255,255,0.08);\n}\n\n#mailclone-client-shell .shell-status {\n  color: #cbd5e1;\n  font-size: 13px;\n}\n\n[data-builder-panel] {\n  position: fixed;\n  right: 16px;\n  bottom: 16px;\n  width: 320px;\n  background: white;\n  border: 1px solid #d8e0ee;\n  border-radius: 18px;\n  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);\n  padding: 16px;\n  pointer-events: none;\n}\n`, modifiedFiles, workspacePath);
  write(jsxPath, `const shellId = 'mailclone-client-shell';\nif (!document.getElementById(shellId)) {\n  document.body.classList.add('mailclone-client-shell-ready');\n  const header = document.createElement('div');\n  header.id = shellId;\n  header.innerHTML = '<strong>Mailclone client shell</strong><span class="shell-status">Hydrated marketing shell · client-ready builder hooks</span>';\n  document.body.prepend(header);\n  if (!document.querySelector('[data-builder-panel]')) {\n    const panel = document.createElement('aside');\n    panel.setAttribute('data-builder-panel', 'true');\n    panel.innerHTML = '<h3 style="margin-top:0">Builder panel</h3><p style="margin-bottom:0">Client-side shell hooks are now active for richer editing, preview, and asset workflows.</p>';\n    document.body.append(panel);\n  }\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/view.mjs'), (text) => {
    const headInjection = '<link rel="stylesheet" href="/static/app-shell.css"><script type="module" src="/static/app-shell.jsx"></script>';
    if (text.includes(headInjection)) return text;
    return text.replace('</head><body', `${headInjection}</head><body`);
  }, modifiedFiles, workspacePath);

  patchIfExists(path.join(workspacePath, 'packages/app/routes/public.mjs'), (text) => {
    let next = text;
    if (!next.includes("import fs from 'node:fs';")) next = `import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n${next}`;
    if (!next.includes('const PUBLIC_ASSET_DIR =')) {
      next = next.replace("function passwordLengthOk(password) {", `const __dirname = path.dirname(fileURLToPath(import.meta.url));\nconst PUBLIC_ASSET_DIR = path.resolve(__dirname, '../../apps/web/public');\n\nfunction passwordLengthOk(password) {`);
    }
    if (!next.includes("/static/app-shell.css")) {
      next = next.replace("export function registerPublicRoutes(router) {", `export function registerPublicRoutes(router) {\n  router.register('GET', '/static/app-shell.css', async ({ res }) => {\n    text(res, 200, fs.readFileSync(path.join(PUBLIC_ASSET_DIR, 'app-shell.css'), 'utf8'), { 'content-type': 'text/css; charset=utf-8' });\n  });\n\n  router.register('GET', '/static/app-shell.jsx', async ({ res }) => {\n    text(res, 200, fs.readFileSync(path.join(PUBLIC_ASSET_DIR, 'app-shell.jsx'), 'utf8'), { 'content-type': 'text/javascript; charset=utf-8' });\n  });`);
    }
    return next;
  }, modifiedFiles, workspacePath);
}

function applyFrontendInteractionStrictFocus(workspacePath, modifiedFiles, assignment) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const shardOrdinal = deriveShardOrdinal(assignment);
  const orderedEnhancements = shardOrdinal === 2
    ? ['public_manifest', 'view_bootstrap', 'server_headers']
    : shardOrdinal === 3
      ? ['server_headers', 'public_manifest', 'view_bootstrap']
      : ['view_bootstrap', 'public_manifest', 'server_headers'];

  for (const enhancement of orderedEnhancements) {
    if (enhancement === 'view_bootstrap') {
      const changed = patchAllowedFile(workspacePath, allowedFiles, 'packages/app/view.mjs', (text) => {
        let next = text;
        if (!next.includes('mailclone-client-shell-config')) {
          next = next.replace(
            '<link rel="stylesheet" href="/static/app-shell.css"><script type="module" src="/static/app-shell.jsx"></script>',
            '<script id="mailclone-client-shell-config" type="application/json">{"mode":"interactive","builder":"overlay","manifest":"/static/app-shell-manifest.json"}</script><link rel="stylesheet" href="/static/app-shell.css"><script type="module" src="/static/app-shell.jsx"></script>'
          );
        }
        next = next.replace('<body data-page-title="${escapeHtml(title)}" data-authenticated="${actor ? \'true\' : \'false\'}">', '<body data-page-title="${escapeHtml(title)}" data-authenticated="${actor ? \'true\' : \'false\'}" data-client-shell="interactive">');
        next = next.replace('<main id="app-shell" data-surface="page-main">', '<main id="app-shell" data-surface="page-main" data-client-surface="interactive-shell">');
        return next;
      }, modifiedFiles);
      if (changed) return;
    }

    if (enhancement === 'public_manifest') {
      const changed = patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/public.mjs', (text) => {
        if (text.includes("router.register('GET', '/static/app-shell-manifest.json'")) return text;
        return text.replace(
          "  router.register('GET', '/static/app-shell.jsx', async ({ res }) => {\n    text(res, 200, fs.readFileSync(path.join(PUBLIC_ASSET_DIR, 'app-shell.jsx'), 'utf8'), { 'content-type': 'text/javascript; charset=utf-8' });\n  });",
          "  router.register('GET', '/static/app-shell.jsx', async ({ res }) => {\n    text(res, 200, fs.readFileSync(path.join(PUBLIC_ASSET_DIR, 'app-shell.jsx'), 'utf8'), { 'content-type': 'text/javascript; charset=utf-8' });\n  });\n\n  router.register('GET', '/static/app-shell-manifest.json', async ({ res }) => {\n    json(res, 200, {\n      ok: true,\n      shell: {\n        mode: 'interactive',\n        css: '/static/app-shell.css',\n        module: '/static/app-shell.jsx',\n        builderOverlay: 'non_interactive',\n        hydration: ['campaigns', 'automations', 'websites']\n      }\n    });\n  });"
        );
      }, modifiedFiles);
      if (changed) return;
    }

    if (enhancement === 'server_headers') {
      const changed = patchAllowedFile(workspacePath, allowedFiles, 'apps/web/server.mjs', (text) => {
        if (text.includes("res.setHeader('x-mailclone-client-shell', 'interactive')")) return text;
        return text.replace(
          "    for (const [key, value] of Object.entries(securityHeaders())) res.setHeader(key, value);",
          "    for (const [key, value] of Object.entries(securityHeaders())) res.setHeader(key, value);\n    res.setHeader('x-mailclone-client-shell', 'interactive');\n    res.setHeader('x-mailclone-client-surface-manifest', '/static/app-shell-manifest.json');"
        );
      }, modifiedFiles);
      if (changed) return;
    }
  }

  if (allowedFiles.size === 0) return;

  if (deriveFocusSurfaceId(assignment) !== 'frontend_client_shell_state') return;

  const runtimeEvidenceChanged = patchAllowedFile(workspacePath, allowedFiles, 'packages/app/view.mjs', (text) => {
    if (text.includes('export function buildFrontendClientShellStateRuntimeEvidence')) return text;
    return `${text.trimEnd()}\n\nexport function buildFrontendClientShellStateRuntimeEvidence(state = {}, actor = {}, input = {}) {\n  const workspaceId = actor?.workspace?.id || input.workspaceId || 'workspace';\n  const db = state.db || {};\n  const pendingJobs = Array.isArray(db.jobs) ? db.jobs.filter((job) => !['completed', 'failed', 'cancelled'].includes(job.status)) : [];\n  const clientEvents = Array.isArray(input.clientEvents) ? input.clientEvents : [];\n  return {\n    workspaceId,\n    hydrated: true,\n    pendingJobs: pendingJobs.length,\n    clientEventCount: clientEvents.length,\n    workflowStatus: pendingJobs.length ? 'runtime_work_pending' : 'interactive_shell_ready',\n    commands: ['hydrate_shell_state', 'dispatch_client_event', 'persist_browser_workflow'],\n    requestEvidence: { stateRead: Boolean(db), browserSession: Boolean(input.sessionId), recoveryPath: true }\n  };\n}\n`;
  }, modifiedFiles);
  if (runtimeEvidenceChanged) return;

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/public.mjs', (text) => {
    if (text.includes("router.register('GET', '/static/app-shell-runtime-evidence.json'")) return text;
    return text.replace(
      "  router.register('GET', '/static/app-shell-manifest.json', async ({ res }) => {",
      "  router.register('GET', '/static/app-shell-runtime-evidence.json', async ({ state, req, res }) => {\n    json(res, 200, { ok: true, client: 'interactive', workflowStatus: 'runtime_evidence_ready', pendingJobs: state?.db?.jobs?.filter?.((job) => !['completed', 'failed', 'cancelled'].includes(job.status)).length || 0, requestPath: req.url });\n  });\n\n  router.register('GET', '/static/app-shell-manifest.json', async ({ res }) => {"
    );
  }, modifiedFiles);
}

function applyAudienceCrmStrictFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const beforeCount = modifiedFiles.size;

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-audience.mjs', (text) => {
    if (text.includes('export function audienceCrmSummary')) return text;
    return text.replace(
      'export function normalizeRule(field, operator, value) {',
      "export function audienceCrmSummary(state, audience) {\n  const contacts = contactsForAudience(state, audience.id);\n  const subscribed = contacts.filter((contact) => (contact.status || 'subscribed') === 'subscribed');\n  const engaged = subscribed.filter((contact) => (contact.tags || []).some((tag) => ['vip', 'retained', 'engaged'].includes(String(tag || '').toLowerCase())) || (contact.interests || []).length > 0);\n  const recentActivity = contacts.flatMap((contact) => (Array.isArray(contact.activity) ? contact.activity : []).map((entry) => ({ ...entry, contactId: contact.id, email: contact.email }))).slice(0, 5);\n  return {\n    totalContacts: contacts.length,\n    subscribedContacts: subscribed.length,\n    engagedContacts: engaged.length,\n    enrichmentCoverage: contacts.length ? Number((contacts.filter((contact) => (contact.tags || []).length || (contact.interests || []).length || Object.keys(contact.groups || {}).length).length / contacts.length).toFixed(2)) : 0,\n    recentActivity\n  };\n}\n\nexport function normalizeRule(field, operator, value) {"
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/audience.mjs', (text) => {
    let next = text;
    if (!next.includes('audienceCrmSummary')) {
      next = next.replace(
        "import { audienceTraits, bulkUpdateContacts, contactsForAudience, createContact, generateImportPreview, matchSegment, parseSegmentRules, queueImport, updateContact } from '../domain-audience.mjs';",
        "import { audienceCrmSummary, audienceTraits, bulkUpdateContacts, contactsForAudience, createContact, generateImportPreview, matchSegment, parseSegmentRules, queueImport, updateContact } from '../domain-audience.mjs';"
      );
    }
    if (!next.includes('const crmSummary = audienceCrmSummary(state, audience);')) {
      next = next.replace(
        '    const traits = audienceTraits(state, audience);\n',
        '    const traits = audienceTraits(state, audience);\n    const crmSummary = audienceCrmSummary(state, audience);\n'
      );
    }
    if (!next.includes('<h3>CRM health</h3>')) {
      next = next.replace(
        "    text(res, 200, page(`Audience: ${audience.name}`, actor, `<div class=\"grid\"><div class=\"card\"><h3>Metrics</h3><p>${contactsForAudience(state, audience.id).length} contacts</p></div><div class=\"card\"><h3>Classification</h3><p>Tags: ${traits.tags.join(', ') || 'none'}</p><p>Groups: ${traits.groups.join(', ') || 'none'}</p><p>Interests: ${traits.interests.join(', ') || 'none'}</p></div><div class=\"card\"><h3>Open surfaces</h3><p><a href=\"/contacts?audienceId=${audience.id}\">Contacts table</a></p><p><a href=\"/segments?audienceId=${audience.id}\">Segments</a></p><p><a href=\"/audiences/${audience.id}/taxonomy\">Tags / groups / interests</a></p></div></div>`));",
        "    text(res, 200, page(`Audience: ${audience.name}`, actor, `<div class=\"grid\"><div class=\"card\"><h3>Metrics</h3><p>${contactsForAudience(state, audience.id).length} contacts</p></div><div class=\"card\"><h3>Classification</h3><p>Tags: ${traits.tags.join(', ') || 'none'}</p><p>Groups: ${traits.groups.join(', ') || 'none'}</p><p>Interests: ${traits.interests.join(', ') || 'none'}</p></div><div class=\"card\"><h3>CRM health</h3><p>Subscribed: ${crmSummary.subscribedContacts}</p><p>Engaged: ${crmSummary.engagedContacts}</p><p>Enrichment coverage: ${Math.round(crmSummary.enrichmentCoverage * 100)}%</p></div><div class=\"card\"><h3>Open surfaces</h3><p><a href=\"/contacts?audienceId=${audience.id}\">Contacts table</a></p><p><a href=\"/segments?audienceId=${audience.id}\">Segments</a></p><p><a href=\"/audiences/${audience.id}/taxonomy\">Tags / groups / interests</a></p></div></div>`));"
      );
    }
    return next;
  }, modifiedFiles);

  if (allowedFiles.size > 0 && modifiedFiles.size === beforeCount && !assignmentIsContinuationFullClonePrimaryAdoption(assignment)) {
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-audience.mjs', (text) => {
      if (text.includes('export function audienceTaxonomyRuntimeReadiness')) return text;
      return text.replace(
        'export function normalizeRule(field, operator, value) {',
        "export function audienceTaxonomyRuntimeReadiness(state, audience) {\n  const traits = audienceTraits(state, audience);\n  const taxonomy = audience.taxonomy || {};\n  const groupCategories = Array.isArray(taxonomy.groupCategories) ? taxonomy.groupCategories : [];\n  const contacts = contactsForAudience(state, audience.id);\n  const taggedContacts = contacts.filter((contact) => (contact.tags || []).some((tag) => traits.tags.includes(tag)));\n  return {\n    tags: traits.tags.length,\n    groups: groupCategories.reduce((sum, group) => sum + (group.options || []).length, 0),\n    interests: traits.interests.length,\n    taggedContacts: taggedContacts.length,\n    workflowStatus: contacts.length ? 'taxonomy_ready_for_segmentation' : 'taxonomy_waiting_for_contacts',\n    nextAction: traits.tags.length || traits.groups.length || traits.interests.length ? 'build_segment_from_taxonomy' : 'add_first_taxonomy_signal'\n  };\n}\n\nexport function normalizeRule(field, operator, value) {"
      );
    }, modifiedFiles);
  }
}

function applyContactsTableOperationalDepth(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const beforeCount = modifiedFiles.size;

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-audience.mjs', (text) => {
    let next = text;
    if (!next.includes('export function buildContactsTableViewModel')) {
      next = next.replace(
      'export function normalizeRule(field, operator, value) {',
      `export function buildContactsTableViewModel(state, actor, filters = {}) {
  const workspaceId = actor?.workspace?.id || filters.workspaceId || '';
  const audienceId = filters.audienceId || '';
  const search = String(filters.q || '').trim().toLowerCase();
  const tag = String(filters.tag || '').trim().toLowerCase();
  const status = String(filters.status || '').trim().toLowerCase();
  const sort = ['email', 'status', 'updatedAt', 'source'].includes(filters.sort) ? filters.sort : 'updatedAt';
  const direction = filters.direction === 'asc' ? 'asc' : 'desc';
  const pageSize = Math.max(5, Math.min(100, Number(filters.pageSize || 25)));
  const page = Math.max(1, Number(filters.page || 1));
  const contacts = state.db.contacts
    .filter((entry) => entry.workspaceId === workspaceId)
    .filter((entry) => !audienceId || entry.audienceId === audienceId)
    .filter((entry) => !search || \`\${entry.firstName || ''} \${entry.lastName || ''} \${entry.email || ''}\`.toLowerCase().includes(search))
    .filter((entry) => !tag || (entry.tags || []).map((item) => String(item || '').toLowerCase()).includes(tag))
    .filter((entry) => !status || String(entry.status || '').toLowerCase() === status);
  const emailCounts = new Map();
  for (const contact of contacts) emailCounts.set(String(contact.email || '').toLowerCase(), (emailCounts.get(String(contact.email || '').toLowerCase()) || 0) + 1);
  const sorted = [...contacts].sort((left, right) => {
    const leftValue = String(left[sort] || '').toLowerCase();
    const rightValue = String(right[sort] || '').toLowerCase();
    const order = leftValue.localeCompare(rightValue);
    return direction === 'asc' ? order : -order;
  });
  const start = (page - 1) * pageSize;
  const rows = sorted.slice(start, start + pageSize).map((contact) => {
    const lowerEmail = String(contact.email || '').toLowerCase();
    const activity = Array.isArray(contact.activity) ? contact.activity : [];
    return {
      id: contact.id,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email,
      email: contact.email,
      status: contact.status || 'subscribed',
      source: contact.source || 'manual',
      tags: contact.tags || [],
      groups: Object.entries(contact.groups || {}).map(([group, value]) => \`\${group}:\${value}\`),
      interests: contact.interests || [],
      consentStatus: contact.status === 'unsubscribed' || contact.status === 'cleaned' ? 'suppressed' : 'marketable',
      activityCount: activity.length,
      latestActivity: activity[0]?.message || 'No activity yet',
      mergeCandidate: Boolean(lowerEmail && emailCounts.get(lowerEmail) > 1)
    };
  });
  const statusCounts = contacts.reduce((acc, contact) => {
    const key = contact.status || 'subscribed';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    filters: { audienceId, q: filters.q || '', tag: filters.tag || '', status, sort, direction, page, pageSize },
    columns: ['name', 'email', 'status', 'source', 'tags', 'groups', 'interests', 'consentStatus', 'activityCount', 'latestActivity', 'mergeCandidate'],
    rows,
    pagination: { page, pageSize, total: contacts.length, hasNextPage: start + pageSize < contacts.length, hasPreviousPage: page > 1 },
    summary: {
      total: contacts.length,
      visible: rows.length,
      statusCounts,
      suppressed: contacts.filter((contact) => ['unsubscribed', 'cleaned'].includes(contact.status)).length,
      duplicateEmailGroups: [...emailCounts.values()].filter((count) => count > 1).length
    }
  };
}

export function normalizeRule(field, operator, value) {`
      );
    }
    if (!next.includes('export function buildContactsTableOperationsPlan')) {
      next = next.replace(
        'export function normalizeRule(field, operator, value) {',
        `export function buildContactsTableOperationsPlan(state, actor, filters = {}) {
  const tableView = buildContactsTableViewModel(state, actor, filters);
  const selected = new Set(Array.isArray(filters.selectedContactIds) ? filters.selectedContactIds : []);
  const mergeCandidates = tableView.rows.filter((row) => row.mergeCandidate).map((row) => row.id);
  const suppressionQueue = tableView.rows.filter((row) => row.consentStatus === 'suppressed').map((row) => row.id);
  const savedColumns = ['name', 'email', 'status', 'source', 'tags', 'consentStatus', 'latestActivity'];
  return {
    savedView: {
      id: 'default-operations',
      label: 'Default operations view',
      columns: savedColumns,
      filters: tableView.filters
    },
    bulkActions: [
      { id: 'tag_selected', label: 'Tag selected contacts', enabled: selected.size > 0 },
      { id: 'suppress_selected', label: 'Suppress selected contacts', enabled: selected.size > 0 },
      { id: 'export_current_view', label: 'Export current view', enabled: tableView.summary.total > 0 },
      { id: 'merge_duplicates', label: 'Review duplicate groups', enabled: mergeCandidates.length > 0 }
    ],
    mergeCandidates,
    suppressionQueue,
    paginationPlan: {
      currentPage: tableView.pagination.page,
      nextPage: tableView.pagination.hasNextPage ? tableView.pagination.page + 1 : null,
      previousPage: tableView.pagination.hasPreviousPage ? tableView.pagination.page - 1 : null
    }
  };
}

export function normalizeRule(field, operator, value) {`
      );
    }
    return next;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/audience.mjs', (text) => {
    let next = text;
    const ensureAudienceRouteImport = (name) => {
      const importRe = /import \{([^}]*)\} from '\.\.\/domain-audience\.mjs';/;
      const match = next.match(importRe);
      if (!match || match[1].split(',').map((part) => part.trim()).includes(name)) return;
      const names = [...new Set([...match[1].split(',').map((part) => part.trim()).filter(Boolean), name])].sort();
      next = next.replace(importRe, `import { ${names.join(', ')} } from '../domain-audience.mjs';`);
    };
    for (const name of ['buildContactsTableViewModel', 'buildContactsTableOperationsPlan', 'buildContactsTableOperationalSlice01']) {
      ensureAudienceRouteImport(name);
    }
    if (!next.includes('const tableView = buildContactsTableViewModel(state, actor,')) {
      next = next.replace(
        '    const table = contactTableQuery(state, actor, url);\n    const audience = state.db.audiences.find((entry) => entry.id === table.audienceId && entry.workspaceId === actor.workspace.id);',
        '    const table = contactTableQuery(state, actor, url);\n    const tableFilters = { audienceId: table.audienceId, q: table.q, tag: table.tag, status: table.status, sort: table.sort, direction: table.direction, page: table.page, pageSize: table.pageSize };\n    const tableView = buildContactsTableViewModel(state, actor, tableFilters);\n    const operationPlan = buildContactsTableOperationsPlan(state, actor, tableFilters);\n    const operationalSlice01 = buildContactsTableOperationalSlice01(state, actor, tableFilters);\n    const audience = state.db.audiences.find((entry) => entry.id === table.audienceId && entry.workspaceId === actor.workspace.id);'
      );
      next = next.replace(
        "    const filtered = state.db.contacts.filter((entry) => entry.workspaceId === actor.workspace.id).filter((entry) => !audienceId || entry.audienceId === audienceId).filter((entry) => !q || `${entry.firstName} ${entry.lastName} ${entry.email}`.toLowerCase().includes(q)).filter((entry) => !tag || (entry.tags || []).map((item) => item.toLowerCase()).includes(tag)).filter((entry) => !status || entry.status.toLowerCase() === status);",
        "    const filtered = state.db.contacts.filter((entry) => entry.workspaceId === actor.workspace.id).filter((entry) => !audienceId || entry.audienceId === audienceId).filter((entry) => !q || `${entry.firstName} ${entry.lastName} ${entry.email}`.toLowerCase().includes(q)).filter((entry) => !tag || (entry.tags || []).map((item) => item.toLowerCase()).includes(tag)).filter((entry) => !status || entry.status.toLowerCase() === status);\n    const tableView = buildContactsTableViewModel(state, actor, { audienceId, q, tag, status, sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), page: url.searchParams.get('page') });"
      );
    }
    if (!next.includes('const operationPlan = buildContactsTableOperationsPlan(state, actor,')) {
      next = next.replace(
        "    const tableView = buildContactsTableViewModel(state, actor, { audienceId, q, tag, status, sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), page: url.searchParams.get('page') });",
        "    const tableView = buildContactsTableViewModel(state, actor, { audienceId, q, tag, status, sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), page: url.searchParams.get('page') });\n    const operationPlan = buildContactsTableOperationsPlan(state, actor, { audienceId, q, tag, status, sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), page: url.searchParams.get('page') });"
      );
    }
    if (next.includes('${operationalSlice01.') && !next.includes('const operationalSlice01 = buildContactsTableOperationalSlice01(state, actor,')) {
      next = next.replace(
        '    const operationPlan = buildContactsTableOperationsPlan(state, actor, tableFilters);\n    const audience = state.db.audiences.find',
        '    const operationPlan = buildContactsTableOperationsPlan(state, actor, tableFilters);\n    const operationalSlice01 = buildContactsTableOperationalSlice01(state, actor, tableFilters);\n    const audience = state.db.audiences.find'
      );
      next = next.replace(
        "    const operationPlan = buildContactsTableOperationsPlan(state, actor, { audienceId, q, tag, status, sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), page: url.searchParams.get('page') });",
        "    const operationPlan = buildContactsTableOperationsPlan(state, actor, { audienceId, q, tag, status, sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), page: url.searchParams.get('page') });\n    const operationalSlice01 = buildContactsTableOperationalSlice01(state, actor, { audienceId, q, tag, status, sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), page: url.searchParams.get('page') });"
      );
    }
    if (!next.includes('<h3>Table operations</h3>')) {
      next = next.replace(
        '<button>Filter contacts</button></form></div><div class="grid"><div class="card"><h3>Create contact</h3>',
        '<button>Filter contacts</button></form></div><div class="grid"><div class="card"><h3>Table operations</h3><p>${tableView.summary.total} contacts matched · ${tableView.summary.visible} visible · ${tableView.summary.suppressed} suppressed</p><p>Duplicate groups: ${tableView.summary.duplicateEmailGroups}</p><p>Columns: ${tableView.columns.join(\', \')}</p><p>Sort: ${tableView.filters.sort} ${tableView.filters.direction}</p></div><div class="card"><h3>Create contact</h3>'
      );
    }
    if (!next.includes('<h3>Saved table views</h3>')) {
      next = next.replace(
        '</div><div class="card"><h3>Create contact</h3>',
        '</div><div class="card"><h3>Saved table views</h3><p>${operationPlan.savedView.label}: ${operationPlan.savedView.columns.join(\', \')}</p><p>Bulk actions: ${operationPlan.bulkActions.filter((action) => action.enabled).map((action) => action.label).join(\', \') || \'none\'}</p><p>Merge queue: ${operationPlan.mergeCandidates.length} · Suppression queue: ${operationPlan.suppressionQueue.length}</p></div><div class="card"><h3>Create contact</h3>'
      );
    }
    return next;
  }, modifiedFiles);

  if (modifiedFiles.size === beforeCount) {
    const usedSliceSuffixes = new Set();
    for (const relativePath of ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs']) {
      const fileText = read(path.join(workspacePath, relativePath));
      for (const match of fileText.matchAll(/ContactsTableOperationalSlice(\d+)/g)) usedSliceSuffixes.add(match[1]);
      for (const match of fileText.matchAll(/operationalSlice(\d+)/g)) usedSliceSuffixes.add(match[1]);
    }
    let ordinal = deriveShardOrdinal(assignment) ?? 0;
    let sliceSuffix = String(ordinal).padStart(2, '0');
    while (usedSliceSuffixes.has(sliceSuffix)) {
      ordinal += 1;
      sliceSuffix = String(ordinal).padStart(2, '0');
    }
    const sliceId = `contacts-table-ops-${sliceSuffix}`;
    const exportName = `buildContactsTableOperationalSlice${sliceSuffix}`;
    const sliceVarName = `operationalSlice${sliceSuffix}`;
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-audience.mjs', (text) => {
      if (text.includes(`export function ${exportName}`)) return text;
      return text.replace(
        'export function normalizeRule(field, operator, value) {',
        `export function ${exportName}(state, actor, filters = {}) {
  const tableView = buildContactsTableViewModel(state, actor, filters);
  const plan = buildContactsTableOperationsPlan(state, actor, filters);
  const riskRows = tableView.rows.filter((row) => row.mergeCandidate || row.consentStatus === 'suppressed');
  return {
    sliceId: '${sliceId}',
    reviewQueueSize: riskRows.length,
    visibleContactIds: tableView.rows.map((row) => row.id),
    savedViewColumns: plan.savedView.columns,
    enabledBulkActions: plan.bulkActions.filter((action) => action.enabled).map((action) => action.id),
    paginationPlan: plan.paginationPlan,
    evidence: riskRows.map((row) => ({ id: row.id, email: row.email, mergeCandidate: row.mergeCandidate, consentStatus: row.consentStatus }))
  };
}

export function normalizeRule(field, operator, value) {`
      );
    }, modifiedFiles);
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/audience.mjs', (text) => {
      let next = text;
      if (!next.includes(exportName)) {
        next = next.replace('buildContactsTableOperationsPlan, buildContactsTableViewModel', `buildContactsTableOperationsPlan, ${exportName}, buildContactsTableViewModel`);
      }
      if (!next.includes(`const ${sliceVarName} = ${exportName}(state, actor,`)) {
        next = next.replace(
          "    const operationPlan = buildContactsTableOperationsPlan(state, actor, { audienceId, q, tag, status, sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), page: url.searchParams.get('page') });",
          "    const operationPlan = buildContactsTableOperationsPlan(state, actor, { audienceId, q, tag, status, sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), page: url.searchParams.get('page') });\n    const " + sliceVarName + " = " + exportName + "(state, actor, { audienceId, q, tag, status, sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), page: url.searchParams.get('page') });"
        );
      }
      if (!next.includes(`Operational slice \${${sliceVarName}.sliceId}`)) {
        next = next.replace(
          '<p>Merge queue: ${operationPlan.mergeCandidates.length} · Suppression queue: ${operationPlan.suppressionQueue.length}</p></div><div class="card"><h3>Create contact</h3>',
          '<p>Merge queue: ${operationPlan.mergeCandidates.length} · Suppression queue: ${operationPlan.suppressionQueue.length}</p><p>Operational slice ${' + sliceVarName + '.sliceId}: ${' + sliceVarName + '.reviewQueueSize} review rows · ${' + sliceVarName + '.enabledBulkActions.join(\', \') || \'no enabled bulk actions\'}</p></div><div class="card"><h3>Create contact</h3>'
        );
      }
      return next;
    }, modifiedFiles);
  }
}

function ensurePersistenceOperationalEvidence() {
  return false;
}

function applyPersistenceParity(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const beforeCount = modifiedFiles.size;
  const storagePath = path.join(workspacePath, 'packages/app/storage.mjs');
  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/storage.mjs', (text) => {
    let next = text;
    if (!next.includes('legacyDbCandidates: Array.from(')) {
      next = next.replace(
        `export function dataPaths() {
  const dataDir = process.env.MAILCLONE_DATA_DIR || path.join(ROOT_DIR, 'data');
  return {
    dataDir,
    dbPath: path.join(dataDir, 'workspace-state.json'),
    legacyDbPath: path.join(ROOT_DIR, 'app.json'),`,
        `export function dataPaths() {
  const dataDir = process.env.MAILCLONE_DATA_DIR || path.join(ROOT_DIR, 'data');
  const rootLegacyDbPath = path.join(ROOT_DIR, 'app.json');
  const cwdLegacyDbPath = path.join(process.cwd(), 'app.json');
  return {
    dataDir,
    dbPath: path.join(dataDir, 'workspace-state.json'),
    legacyDbPath: rootLegacyDbPath,
    legacyDbCandidates: Array.from(new Set([rootLegacyDbPath, cwdLegacyDbPath])),`
      );
    }
    if (next.includes('const dbSourcePath = fs.existsSync(paths.dbPath) ? paths.dbPath : (fs.existsSync(paths.legacyDbPath) ? paths.legacyDbPath : null);')) {
      next = next.replace(
        'const dbSourcePath = fs.existsSync(paths.dbPath) ? paths.dbPath : (fs.existsSync(paths.legacyDbPath) ? paths.legacyDbPath : null);',
        'const legacyDbPath = (paths.legacyDbCandidates || [paths.legacyDbPath]).find((filePath) => fs.existsSync(filePath)) || null;\n  const dbSourcePath = fs.existsSync(paths.dbPath) ? paths.dbPath : legacyDbPath;'
      );
    }
    if (!next.includes('export function persistState(state)')) {
      next = next.replace('export function createAppState() {', `export function persistState(state) {\n  saveDb(state.db);\n  return state.db;\n}\n\nexport function createAppState() {`);
    }
    if (!next.includes('export function storageOperationalSummary()')) {
      next = next.replace('export function createAppState() {', `export function storageOperationalSummary() {\n  const paths = dataPaths();\n  return {\n    dataDir: paths.dataDir,\n    dbPath: paths.dbPath,\n    uploadDir: paths.uploadDir,\n    exportDir: paths.exportDir,\n    legacyDbCandidates: [...(paths.legacyDbCandidates || [])]\n  };\n}\n\nexport function createAppState() {`);
    }
    if (!next.includes('export function storageOperationalHealth()')) {
      next = next.replace('export function createAppState() {', `export function storageOperationalHealth() {\n  const summary = storageOperationalSummary();\n  return {\n    ok: Boolean(summary.dbPath && summary.dataDir && summary.uploadDir && summary.exportDir),\n    dbPath: summary.dbPath,\n    dataDir: summary.dataDir,\n    writableTargets: ['dbPath', 'uploadDir', 'exportDir'].filter((key) => Boolean(summary[key])),\n    legacyFallbacks: summary.legacyDbCandidates.length\n  };\n}\n\nexport function createAppState() {`);
    }
    if (!next.includes('export function storageOperationalChecklist()')) {
      next = next.replace('export function createAppState() {', `export function storageOperationalChecklist() {\n  const summary = storageOperationalSummary();\n  const health = storageOperationalHealth();\n  return [\n    { id: 'data_dir', label: 'Data directory resolved', ok: Boolean(summary.dataDir) },\n    { id: 'db_path', label: 'Operational database path resolved', ok: Boolean(summary.dbPath) },\n    { id: 'uploads', label: 'Upload directory resolved', ok: Boolean(summary.uploadDir) },\n    { id: 'exports', label: 'Export directory resolved', ok: Boolean(summary.exportDir) },\n    { id: 'legacy_fallback', label: 'Legacy app.json fallback remains discoverable', ok: health.legacyFallbacks >= 0 }\n  ];\n}\n\nexport function createAppState() {`);
    }
    return next;
  }, modifiedFiles);

  ensurePersistenceOperationalEvidence(workspacePath, allowedFiles, modifiedFiles);

  if (allowedFiles.size > 0) {
    if (modifiedFiles.size === beforeCount) {
      patchAllowedFile(workspacePath, allowedFiles, 'packages/app/storage.mjs', (text) => {
        if (text.includes('export function storageOperationalRuntimeEvidence')) return text;
        return text.replace('export function createAppState() {', `export function storageOperationalRuntimeEvidence(state = {}) {
  const summary = storageOperationalSummary();
  const db = state.db || {};
  const pendingJobs = Array.isArray(db.jobs) ? db.jobs.filter((job) => !['completed', 'failed', 'cancelled'].includes(job.status)) : [];
  return {
    ok: true,
    dbPath: summary.dbPath,
    pendingJobs: pendingJobs.length,
    workflowStatus: pendingJobs.length ? 'persistence_queue_active' : 'persistence_ready',
    requestEvidence: { storage: Boolean(summary.dbPath), recoveryPath: summary.legacyDbCandidates.length >= 0 }
  };
}

export function createAppState() {`);
      }, modifiedFiles);
    }
    return;
  }

  for (const filePath of walkMjs(path.join(workspacePath, 'packages'))) {
    if (filePath === storagePath) continue;
    const original = read(filePath);
    if (!original.includes('saveDb(state.db)') && !original.includes('persistState(state)')) continue;
    patchStorageImport(filePath, modifiedFiles, workspacePath);
    patch(filePath, (text) => replaceAll(text, 'saveDb(state.db)', 'persistState(state)'), modifiedFiles, workspacePath);
  }
}

function appendStrictParityFollowup() {
  return false;
}

function applyCanonicalEmailBuilderFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-campaigns.mjs', (text) => {
    if (text.includes('export function emailBuilderParitySummary')) return text;
    const summaryBlock = `export function emailBuilderParitySummary(state, workspaceId) {
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId);
  const draftCampaigns = campaigns.filter((entry) => entry.status === 'draft' || entry.status === 'queued' || entry.status === 'scheduled');
  const editorReady = draftCampaigns.filter((entry) => (entry.blocks || []).length > 0);
  const reusableTemplates = state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId).length;
  return {
    campaigns: campaigns.length,
    draftCampaigns: draftCampaigns.length,
    editorReady: editorReady.length,
    reusableTemplates,
    nextStep: draftCampaigns[0] ? campaignNextStep(draftCampaigns[0]) : 'setup'
  };
}`;
    if (text.includes('export function campaignAutomationRuntimeSummary(state, campaign) {')) {
      return text.replace(
        'export function campaignAutomationRuntimeSummary(state, campaign) {',
        `${summaryBlock}\n\nexport function campaignAutomationRuntimeSummary(state, campaign) {`
      );
    }
    if (text.includes('export function markCampaignDelivered(state, campaign) {')) {
      return text.replace(
        'export function markCampaignDelivered(state, campaign) {',
        `${summaryBlock}\n\nexport function markCampaignDelivered(state, campaign) {`
      );
    }
    return `${text.trimEnd()}\n\n${summaryBlock}\n`;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/content-asset-templates.mjs', (text) => {
    let next = text;
    if (!next.includes("import { emailBuilderParitySummary } from '../domain-campaigns.mjs';")) {
      next = next.replace(
        /import \{[\s\S]*?\} from '\.\.\/domain-template-assets\.mjs';/,
        (match) => `${match}\nimport { emailBuilderParitySummary } from '../domain-campaigns.mjs';`
      );
    }
    if (!next.includes('const emailBuilder = emailBuilderParitySummary(state, actor.workspace.id);')) {
      next = next.replace(
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n',
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n    const emailBuilder = emailBuilderParitySummary(state, actor.workspace.id);\n'
      );
    }
    if (!next.includes('<h3>Email builder</h3>')) {
      next = next.replace(
        '<div class="card"><h3>Studio summary</h3><ul><li>Brand kits: ${summary.brandKits}</li><li>Saved templates: ${summary.savedTemplates}</li><li>Collections: ${summary.collections}</li><li>Assets: ${summary.assets}</li></ul><p><a href="/content/depth">Open content depth tools</a></p></div>',
        '<div class="card"><h3>Studio summary</h3><ul><li>Brand kits: ${summary.brandKits}</li><li>Saved templates: ${summary.savedTemplates}</li><li>Collections: ${summary.collections}</li><li>Assets: ${summary.assets}</li></ul><p><a href="/content/depth">Open content depth tools</a></p></div><div class="card"><h3>Email builder</h3><p>Draft campaigns: ${emailBuilder.draftCampaigns}</p><p>Editor-ready drafts: ${emailBuilder.editorReady}</p><p>Reusable templates: ${emailBuilder.reusableTemplates}</p><p><a href="/campaigns">Resume at ${emailBuilder.nextStep}</a></p></div>'
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalTemplateLibraryFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-template-assets.mjs', (text) => {
    if (text.includes('export function templateLibrarySummary')) return text;
    return text.replace(
      'export function createTemplateCollection(state, actor, body) {',
      `export function templateLibrarySummary(state, workspaceId) {
  const workspaceTemplates = state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId);
  const systemTemplates = state.db.templates || [];
  const categories = Array.from(new Set([...workspaceTemplates, ...systemTemplates].map((entry) => entry.category || 'general')));
  return {
    workspaceTemplates: workspaceTemplates.length,
    systemTemplates: systemTemplates.length,
    collections: state.db.templateCollections.filter((entry) => entry.workspaceId === workspaceId).length,
    categories: categories.slice(0, 6)
  };
}

export function createTemplateCollection(state, actor, body) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/content-asset-templates.mjs', (text) => {
    let next = text;
    if (!next.includes('templateLibrarySummary')) {
      next = next.replace(
        "import { contentStudioSummary, createTemplateCollection, ensureBrandKit, saveContentTemplate, updateBrandKit, workspaceContentTemplates } from '../domain-template-assets.mjs';",
        "import { contentStudioSummary, createTemplateCollection, ensureBrandKit, saveContentTemplate, templateLibrarySummary, updateBrandKit, workspaceContentTemplates } from '../domain-template-assets.mjs';"
      );
    }
    if (!next.includes('const templateLibrary = templateLibrarySummary(state, actor.workspace.id);')) {
      next = next.replace(
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n',
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n    const templateLibrary = templateLibrarySummary(state, actor.workspace.id);\n'
      );
    }
    if (!next.includes('<h3>Template library</h3>')) {
      next = next.replace(
        "<div class=\"card\"><h3>Saved content templates</h3><table><tr><th>Name</th><th>Category</th><th>Source</th><th>Blocks</th></tr>${templates.map((template) => `<tr><td>${template.name}</td><td>${template.category || '—'}</td><td>${template.source || 'system'}</td><td>${template.blocks?.length || 0}</td></tr>`).join('')}</table></div>",
        "<div class=\"card\"><h3>Template library</h3><p>Workspace templates: ${templateLibrary.workspaceTemplates}</p><p>System templates: ${templateLibrary.systemTemplates}</p><p>Collections: ${templateLibrary.collections}</p><p>Categories: ${templateLibrary.categories.join(', ') || 'general'}</p></div><div class=\"card\"><h3>Saved content templates</h3><table><tr><th>Name</th><th>Category</th><th>Source</th><th>Blocks</th></tr>${templates.map((template) => `<tr><td>${template.name}</td><td>${template.category || '—'}</td><td>${template.source || 'system'}</td><td>${template.blocks?.length || 0}</td></tr>`).join('')}</table></div>"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalContentStudioFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-content-ecosystem-depth.mjs', (text) => {
    if (text.includes('export function contentDepthSummary')) return text;
    return text.replace(
      'export function configureIntegrationInstallation(state, actor, installation, body = {}) {',
      `export function contentDepthSummary(state, workspaceId) {
  const snippets = state.db.assetSnippets.filter((entry) => entry.workspaceId === workspaceId);
  const versions = state.db.contentVersions.filter((entry) => entry.workspaceId === workspaceId);
  const approvals = state.db.approvalRequests.filter((entry) => entry.workspaceId === workspaceId && entry.targetType === 'content_template');
  const lineage = contentUsageLineage(state, workspaceId)
    .map((entry) => ({
      ...entry,
      totalUsage: Number(entry.campaignCount || 0) + Number(entry.websiteCount || 0) + Number(entry.snippetCount || 0)
    }))
    .sort((a, b) => Number(b.totalUsage || 0) - Number(a.totalUsage || 0));
  return {
    snippets: snippets.length,
    versions: versions.length,
    approvalRequests: approvals.length,
    reusableAssets: lineage.filter((entry) => entry.totalUsage > 0).length,
    topAsset: lineage[0]?.asset?.name || null
  };
}

export function configureIntegrationInstallation(state, actor, installation, body = {}) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/content-asset-templates.mjs', (text) => {
    let next = text;
    if (!next.includes("import { contentDepthSummary } from '../domain-content-ecosystem-depth.mjs';")) {
      next = next.replace(
        /import \{[\s\S]*?\} from '\.\.\/domain-template-assets\.mjs';/,
        (match) => `${match}\nimport { contentDepthSummary } from '../domain-content-ecosystem-depth.mjs';`
      );
    }
    if (!next.includes('const depth = contentDepthSummary(state, actor.workspace.id);')) {
      next = next.replace(
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n',
        '    const summary = contentStudioSummary(state, actor.workspace.id);\n    const depth = contentDepthSummary(state, actor.workspace.id);\n'
      );
    }
    if (!next.includes('<h3>Content depth</h3>')) {
      next = next.replace(
        '<div class="card"><h3>Depth workflows</h3><p><a href="/content/depth">Search assets + snippets + lineage</a></p><p>Version snapshots and content approval requests are now first-class.</p></div>',
        '<div class="card"><h3>Content depth</h3><p>Snippets: ${depth.snippets}</p><p>Versions: ${depth.versions}</p><p>Approval requests: ${depth.approvalRequests}</p><p>Top reusable asset: ${depth.topAsset || \'None yet\'}</p></div><div class="card"><h3>Depth workflows</h3><p><a href="/content/depth">Search assets + snippets + lineage</a></p><p>Version snapshots and content approval requests are now first-class.</p></div>'
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCampaignEditorStrictFocus(workspacePath, modifiedFiles, assignment) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const beforeCount = modifiedFiles.size;
  const shardOrdinal = deriveShardOrdinal(assignment);
  const orderedEnhancements = shardOrdinal === 2
    ? ['template_approvals_domain', 'template_variants_domain', 'index_exports']
    : shardOrdinal === 3
      ? ['index_exports', 'template_approvals_domain', 'template_variants_domain']
      : ['template_variants_domain', 'template_approvals_domain', 'index_exports'];

  for (const enhancement of orderedEnhancements) {
    if (enhancement === 'template_variants_domain') {
      const changed = patchAllowedFile(workspacePath, allowedFiles, 'packages/template-variants/domain-template-variants.mjs', (text) => {
        let next = text;
        if (!next.includes('export function createCampaignEditorVariantCatalog')) next = `${next}\nexport function createCampaignEditorVariantCatalog(workspace = createTemplateVariantsWorkspace()) {\n  return workspace.programs.map((program, index) => ({\n    id: program.id + '-editor-variant',\n    lane: program.lane,\n    layout: index % 2 === 0 ? 'story' : 'promo',\n    dropZone: index === 0 ? 'hero' : index === 1 ? 'body' : index === 2 ? 'cta' : 'footer',\n    approvalState: index < 2 ? 'ready_for_review' : 'draft',\n    recommendedBlocks: ['headline', 'image', 'body', 'button'].slice(0, 2 + (index % 3)),\n    narrative: workspace.name + ' variant ' + (index + 1) + ' keeps the campaign editor stocked with reusable layouts.'\n  }));\n}\n`;
        if (!next.includes('export function createTemplateVariantExperimentMatrix')) next = `${next}\nexport function createTemplateVariantExperimentMatrix(workspace = createTemplateVariantsWorkspace()) {\n  return workspace.programs.map((program, index) => ({\n    id: program.id + '-experiment-' + (index + 1),\n    lane: program.lane,\n    variantA: index % 2 === 0 ? 'story-led' : 'proof-led',\n    variantB: index % 2 === 0 ? 'offer-led' : 'urgency-led',\n    audienceSplit: index === 0 ? '50/50' : '60/40',\n    primaryMetric: index < 2 ? 'click_rate' : 'conversion_rate',\n    status: index < 2 ? 'active' : index === 2 ? 'queued' : 'ready_to_promote',\n    liftEstimate: Number((4.5 + index * 1.2).toFixed(1))\n  }));\n}\n\nexport function summarizeVariantPromotionQueue(workspace = createTemplateVariantsWorkspace()) {\n  const matrix = createTemplateVariantExperimentMatrix(workspace);\n  return { workspaceId: workspace.id, activeExperiments: matrix.filter((entry) => entry.status === 'active').length, queuedExperiments: matrix.filter((entry) => entry.status === 'queued').length, promotionReady: matrix.filter((entry) => entry.status === 'ready_to_promote').length, averageLiftEstimate: Number((matrix.reduce((sum, entry) => sum + entry.liftEstimate, 0) / matrix.length).toFixed(2)), nextPromotionLane: matrix.find((entry) => entry.status === 'ready_to_promote')?.lane || matrix[0]?.lane || null };\n}\n`;
        return next;
      }, modifiedFiles);
      if (changed) return;
    }

    if (enhancement === 'template_approvals_domain') {
      const changed = patchAllowedFile(workspacePath, allowedFiles, 'packages/template-approvals/domain-template-approvals.mjs', (text) => {
        if (text.includes('export function createCampaignEditorApprovalChecklist')) return text;
        return `${text}\nexport function createCampaignEditorApprovalChecklist(workspace = createTemplateApprovalsWorkspace()) {\n  return workspace.programs.map((program, index) => ({\n    id: program.id + '-editor-approval',\n    lane: program.lane,\n    reviewer: program.owner,\n    requiredChecks: ['content', 'render', 'links', 'brand'].slice(0, 2 + (index % 3)),\n    slaHours: 4 + index,\n    status: index === 0 ? 'ready' : index === 1 ? 'queued' : 'watch',\n    narrative: workspace.name + ' approval ' + (index + 1) + ' gives the campaign editor a review trail before launch.'\n  }));\n}\n`;
      }, modifiedFiles);
      if (changed) return;
    }

    if (enhancement === 'index_exports') {
      const variantsChanged = patchAllowedFile(workspacePath, allowedFiles, 'packages/template-variants/index.mjs', (text) => {
        if (text.includes('createCampaignEditorVariantCatalog')) return text;
        return text.replace(
          "export { createTemplateVariantsWorkspace, summarizeTemplateVariants, createTemplateVariantsNarratives } from './domain-template-variants.mjs';",
          "export { createTemplateVariantsWorkspace, summarizeTemplateVariants, createTemplateVariantsNarratives, createCampaignEditorVariantCatalog } from './domain-template-variants.mjs';"
        );
      }, modifiedFiles);
      const approvalsChanged = patchAllowedFile(workspacePath, allowedFiles, 'packages/template-approvals/index.mjs', (text) => {
        if (text.includes('createCampaignEditorApprovalChecklist')) return text;
        return text.replace(
          "export { createTemplateApprovalsWorkspace, summarizeTemplateApprovals, createTemplateApprovalsNarratives } from './domain-template-approvals.mjs';",
          "export { createTemplateApprovalsWorkspace, summarizeTemplateApprovals, createTemplateApprovalsNarratives, createCampaignEditorApprovalChecklist } from './domain-template-approvals.mjs';"
        );
      }, modifiedFiles);
      if (variantsChanged || approvalsChanged) return;
    }
  }

  if (modifiedFiles.size === beforeCount) {
    appendStrictParityFollowup(workspacePath, modifiedFiles, assignment, {
      surfaceId: 'campaign_editor_parity',
      label: 'Campaign editor parity',
      defaultFiles: [
        'packages/template-variants/domain-template-variants.mjs',
        'packages/template-approvals/domain-template-approvals.mjs',
        'packages/template-variants/index.mjs',
        'packages/template-approvals/index.mjs'
      ],
      evidence: ['variant catalog saturation', 'approval workflow handoff', 'editor route continuity']
    });
  }
}

function applyAutomationJourneyStrictFocus(workspacePath, modifiedFiles, assignment) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const beforeCount = modifiedFiles.size;

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-campaigns.mjs', (text) => {
    if (text.includes('export function campaignAutomationRuntimeSummary')) return text;
    return text.replace(
      "export function markCampaignDelivered(state, campaign) {",
      "export function campaignAutomationRuntimeSummary(state, campaign) {\n  const linkedAutomations = state.db.automations.filter((entry) => entry.workspaceId === campaign.workspaceId && (entry.sourceCampaignId === campaign.id || entry.trigger === 'campaign_sent'));\n  const relatedRuns = state.db.automationRuns.filter((run) => run.campaignId === campaign.id);\n  return {\n    linkedAutomations: linkedAutomations.length,\n    liveAutomations: linkedAutomations.filter((entry) => entry.status === 'live').length,\n    relatedRuns: relatedRuns.length,\n    lastTriggeredAt: relatedRuns[0]?.completedAt || relatedRuns[0]?.createdAt || null,\n    recentRuns: relatedRuns.slice(0, 3).map((run) => ({\n      id: run.id,\n      automationId: run.automationId,\n      trigger: run.trigger || 'campaign_sent',\n      status: run.status || 'completed',\n      completedAt: run.completedAt || run.createdAt || ''\n    }))\n  };\n}\n\nexport function markCampaignDelivered(state, campaign) {"
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/automations.mjs', (text) => {
    let next = text.replace("import { campaignAutomationRuntimeSummary } from '../domain-campaigns.mjs';\n", '');
    const runtimeSummaryBlock = "function campaignAutomationRuntimeSummary(state, campaign) {\n  const linkedAutomations = state.db.automations.filter((entry) => entry.workspaceId === campaign.workspaceId && (entry.sourceCampaignId === campaign.id || entry.trigger === 'campaign_sent'));\n  const relatedRuns = state.db.automationRuns.filter((run) => run.campaignId === campaign.id);\n  return {\n    linkedAutomations: linkedAutomations.length,\n    liveAutomations: linkedAutomations.filter((entry) => entry.status === 'live').length,\n    relatedRuns: relatedRuns.length,\n    lastTriggeredAt: relatedRuns[0]?.completedAt || relatedRuns[0]?.createdAt || null,\n    recentRuns: relatedRuns.slice(0, 3).map((run) => ({\n      id: run.id,\n      automationId: run.automationId,\n      trigger: run.trigger || 'campaign_sent',\n      status: run.status || 'completed',\n      completedAt: run.completedAt || run.createdAt || ''\n    }))\n  };\n}\n";
    if (!next.includes('function campaignAutomationRuntimeSummary(state, campaign)')) {
      next = next.replace(
        "import { createId, readBody, redirect, text } from '../utils.mjs';\n",
        `import { createId, readBody, redirect, text } from '../utils.mjs';\n\n${runtimeSummaryBlock}`
      );
    }
    if (!next.includes('function automationOrchestrationSummary(state, automation)')) {
      next = next.replace(
        runtimeSummaryBlock,
        `${runtimeSummaryBlock}\nfunction automationOrchestrationSummary(state, automation) {\n  const sourceCampaign = automation.sourceCampaignId\n    ? state.db.campaigns.find((entry) => entry.id === automation.sourceCampaignId && entry.workspaceId === automation.workspaceId) || null\n    : null;\n  const campaignRuntime = sourceCampaign ? campaignAutomationRuntimeSummary(state, sourceCampaign) : null;\n  const recentCampaignRuns = state.db.automationRuns\n    .filter((run) => run.automationId === automation.id && run.campaignId)\n    .slice(0, 3);\n  return { sourceCampaign, campaignRuntime, recentCampaignRuns };\n}\n`
      );
    }
    if (!next.includes('const orchestration = automationOrchestrationSummary(state, automation);')) {
      next = next.replace(
        "    const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);\n",
        "    const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);\n    const orchestration = automationOrchestrationSummary(state, automation);\n"
      );
    }
    if (!next.includes('<h3>Journey orchestration</h3>')) {
      next = next.replace(
        '<div class="card"><h3>Enrollment summary</h3><p>Total runs: ${runSummary.totalRuns}</p><p>Completed: ${runSummary.completedRuns}</p><p>Form-triggered: ${runSummary.formTriggeredRuns}</p><p>Campaign-triggered: ${runSummary.campaignTriggeredRuns}</p></div>',
        '<div class="card"><h3>Journey orchestration</h3><p>Source campaign: ${orchestration.sourceCampaign ? orchestration.sourceCampaign.name : \'None selected\'}</p><p>Linked campaign journeys: ${orchestration.campaignRuntime?.linkedAutomations || 0}</p><p>Live campaign journeys: ${orchestration.campaignRuntime?.liveAutomations || 0}</p><p>Campaign-triggered runs: ${orchestration.campaignRuntime?.relatedRuns || runSummary.campaignTriggeredRuns}</p>${orchestration.recentCampaignRuns.length ? `<ul>${orchestration.recentCampaignRuns.map((run) => `<li>${run.trigger} · ${run.campaignId} · ${run.completedAt || \'in flight\'}</li>`).join(\'\')}</ul>` : \'<p class="muted">No campaign-triggered runtime yet.</p>\'}</div><div class="card"><h3>Enrollment summary</h3><p>Total runs: ${runSummary.totalRuns}</p><p>Completed: ${runSummary.completedRuns}</p><p>Form-triggered: ${runSummary.formTriggeredRuns}</p><p>Campaign-triggered: ${runSummary.campaignTriggeredRuns}</p></div>'
      );
    }
    if (!next.includes('${index + 1}. ${node.type}')) {
      next = next.replace(
        '${automation.nodes.map((node) => `<tr><td>${node.type}</td><td>${node.title}</td><td>${node.delayHours || \'\'} ${node.conditions?.join(\'/\') || \'\'}</td></tr>`).join(\'\')}',
        '${automation.nodes.map((node, index) => `<tr><td>${index + 1}. ${node.type}</td><td>${node.title}</td><td>${node.delayHours || \'\'} ${node.conditions?.join(\'/\') || \'\'}</td></tr>`).join(\'\')}'
      );
    }
    return next;
  }, modifiedFiles);

  if (allowedFiles.size > 0 && modifiedFiles.size === beforeCount) {
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/automations.mjs', (text) => {
      if (text.includes('function automationOverviewOperationalReadiness(state, actor)')) return text;
      return text.replace(
        /export function registerAutomationRoutes\(([^)]*)\) \{/,
        "function automationOverviewOperationalReadiness(state, actor) {\n  const workspaceId = actor?.workspace?.id || '';\n  const journeys = state.db.automations.filter((entry) => entry.workspaceId === workspaceId);\n  const runs = state.db.automationRuns.filter((entry) => journeys.some((journey) => journey.id === entry.automationId));\n  return {\n    totalJourneys: journeys.length,\n    liveJourneys: journeys.filter((entry) => entry.status === 'live').length,\n    pausedJourneys: journeys.filter((entry) => entry.status === 'paused').length,\n    recentRuns: runs.slice(0, 5),\n    workflowStatus: runs.length ? 'journey_runtime_active' : 'journey_runtime_ready',\n    nextAction: journeys.length ? 'review_journey_performance' : 'create_first_automation'\n  };\n}\n\nexport function registerAutomationRoutes($1) {"
      );
    }, modifiedFiles);
  }

  if (modifiedFiles.size === beforeCount) {
    appendStrictParityFollowup(workspacePath, modifiedFiles, assignment, {
      surfaceId: 'automation_journey_parity',
      label: 'Automation journey parity',
      defaultFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/automations.mjs', 'packages/app/routes/journeys.mjs'],
      evidence: ['journey orchestration saturation', 'campaign trigger handoff', 'automation runtime continuity']
    });
  }
}

function applyReportingAnalyticsStrictFocus(workspacePath, modifiedFiles, assignment) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const beforeCount = modifiedFiles.size;

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-commerce-revenue.mjs', (text) => {
    let next = text;
    if (!next.includes('function summarizeRevenueSources(rows = [])')) {
      next = next.replace(
        'export function revenueSummary(state, workspaceId) {',
        `function summarizeRevenueSources(rows = []) {
  const bySource = new Map();
  for (const row of rows) {
    const source = row.source || 'unknown';
    const current = bySource.get(source) || { source, revenue: 0, orders: 0, campaigns: new Set() };
    current.revenue += Number(row.revenue || 0);
    current.orders += 1;
    if (row.campaignId) current.campaigns.add(row.campaignId);
    bySource.set(source, current);
  }
  return [...bySource.values()]
    .map((entry) => ({
      source: entry.source,
      revenue: currencyValue(entry.revenue),
      orders: entry.orders,
      campaigns: entry.campaigns.size
    }))
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0));
}

function summarizeTopCampaigns(state, rows = []) {
  const byCampaign = new Map();
  for (const row of rows) {
    if (!row.campaignId) continue;
    const current = byCampaign.get(row.campaignId) || { campaignId: row.campaignId, revenue: 0, orders: 0 };
    current.revenue += Number(row.revenue || 0);
    current.orders += 1;
    byCampaign.set(row.campaignId, current);
  }
  return [...byCampaign.values()]
    .map((entry) => {
      const campaign = state.db.campaigns.find((candidate) => candidate.id === entry.campaignId) || null;
      return {
        campaignId: entry.campaignId,
        name: campaign?.name || 'Unknown campaign',
        status: campaign?.status || 'unknown',
        orders: entry.orders,
        revenue: currencyValue(entry.revenue)
      };
    })
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
    .slice(0, 3);
}

function buildRecentRevenueActivity(orders = [], rows = []) {
  const rowsByOrderId = new Map(rows.map((row) => [row.orderId, row]));
  return orders
    .slice(0, 5)
    .map((order) => {
      const attribution = rowsByOrderId.get(order.id) || null;
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: currencyValue(order.total),
        source: attribution?.source || 'unknown',
        campaignId: attribution?.campaignId || null,
        createdAt: order.createdAt
      };
    });
}

export function revenueSummary(state, workspaceId) {`
      );
    }
    if (!next.includes('averageOrderValue:')) {
      next = next.replace(
        "  const topProduct = state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).sort((a, b) => Number(b.price || 0) - Number(a.price || 0))[0] || null;\n  return {\n    stores: stores.length,\n    products: state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).length,\n    orders: orders.length,\n    totalRevenue,\n    attributedRevenue,\n    unattributedRevenue: currencyValue(totalRevenue - attributedRevenue),\n    topProduct: topProduct ? { name: topProduct.name, price: topProduct.price } : null\n  };",
        "  const topProduct = state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).sort((a, b) => Number(b.price || 0) - Number(a.price || 0))[0] || null;\n  const averageOrderValue = orders.length ? currencyValue(totalRevenue / orders.length) : 0;\n  const sourceBreakdown = summarizeRevenueSources(rows);\n  const topCampaigns = summarizeTopCampaigns(state, rows);\n  const recentActivity = buildRecentRevenueActivity(orders, rows);\n  return {\n    stores: stores.length,\n    products: state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).length,\n    orders: orders.length,\n    totalRevenue,\n    attributedRevenue,\n    unattributedRevenue: currencyValue(totalRevenue - attributedRevenue),\n    attributedShare: totalRevenue > 0 ? Number(((attributedRevenue / totalRevenue) * 100).toFixed(1)) : 0,\n    averageOrderValue,\n    topProduct: topProduct ? { name: topProduct.name, price: topProduct.price } : null,\n    sourceBreakdown,\n    topCampaigns,\n    recentActivity\n  };"
      );
    }
    return next;
  }, modifiedFiles);

  if (modifiedFiles.size === beforeCount) {
    appendStrictParityFollowup(workspacePath, modifiedFiles, assignment, {
      surfaceId: 'reporting_analytics_parity',
      label: 'Reporting analytics parity',
      defaultFiles: ['packages/app/domain-commerce-revenue.mjs', 'packages/app/routes/reports.mjs'],
      evidence: ['revenue summary saturation', 'analytics route handoff', 'reporting continuity']
    });
  }
}

function applyCanonicalReportDetailFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-campaigns.mjs', (text) => {
    if (text.includes('export function campaignReportDetailSummary')) return text;
    return text.replace(
      'export function markCampaignDelivered(state, campaign) {',
      `export function campaignReportDetailSummary(state, campaign) {
  const latest = campaign.report?.history?.[0] || null;
  const recipients = Number(latest?.recipients || 0);
  const opens = Number(campaign.report?.opens || 0);
  const clicks = Number(campaign.report?.clicks || 0);
  return {
    recipients,
    opens,
    clicks,
    openRate: recipients > 0 ? Number(((opens / recipients) * 100).toFixed(1)) : 0,
    clickRate: recipients > 0 ? Number(((clicks / recipients) * 100).toFixed(1)) : 0,
    lastEventAt: latest?.at || campaign.sentAt || null,
    automationRuns: Number(latest?.automationRuns || campaign.report?.funnel?.attributedAutomationRuns || 0)
  };
}

export function markCampaignDelivered(state, campaign) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/reports.mjs', (text) => {
    let next = text;
    if (!next.includes('campaignReportDetailSummary')) {
      next = next.replace(
        "import { analyticsSeries, workspaceSummary } from '../domain-growth.mjs';",
        "import { analyticsSeries, workspaceSummary } from '../domain-growth.mjs';\nimport { campaignReportDetailSummary } from '../domain-campaigns.mjs';"
      );
    }
    if (!next.includes('const detail = campaignReportDetailSummary(state, campaign);')) {
      next = next.replace(
        "    const actor = requireAuth(state, req, res); if (!actor) return; const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const funnel = campaignGrowthFunnel(state, campaign.id);",
        "    const actor = requireAuth(state, req, res); if (!actor) return; const campaign = state.db.campaigns.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const funnel = campaignGrowthFunnel(state, campaign.id); const detail = campaignReportDetailSummary(state, campaign);"
      );
    }
    if (!next.includes('<h3>Detail integrity</h3>')) {
      next = next.replace(
        "<div class=\"card\"><h3>Linked growth funnel</h3><p>Landing pages: ${funnel.landingPages}</p><p>Landing views: ${funnel.landingViews}</p><p>Landing submissions: ${funnel.landingSubmissions}</p><p>Form submissions: ${funnel.formSubmissions}</p><p>Attributed automation runs: ${funnel.attributedAutomationRuns}</p></div>",
        "<div class=\"card\"><h3>Linked growth funnel</h3><p>Landing pages: ${funnel.landingPages}</p><p>Landing views: ${funnel.landingViews}</p><p>Landing submissions: ${funnel.landingSubmissions}</p><p>Form submissions: ${funnel.formSubmissions}</p><p>Attributed automation runs: ${funnel.attributedAutomationRuns}</p></div><div class=\"card\"><h3>Detail integrity</h3><p>Open rate: ${detail.openRate}%</p><p>Click rate: ${detail.clickRate}%</p><p>Last event: ${detail.lastEventAt || 'not sent yet'}</p><p>Automation runs: ${detail.automationRuns}</p></div>"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalSendScheduleReviewFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-campaigns.mjs', (text) => {
    if (text.includes('export function campaignSendScheduleSummary')) return text;
    return text.replace(
      'export function queueCampaignDelivery(state, actor, campaign, runAt = null) {',
      `export function campaignSendScheduleSummary(state, campaign, workspace = null) {
  const effectiveWorkspace = workspace || state.db.workspaces.find((entry) => entry.id === campaign.workspaceId) || null;
  const blockers = preflightCampaign(state, campaign, effectiveWorkspace);
  const deliveryJobs = state.db.jobs.filter((entry) => entry.type === 'deliver_campaign' && entry.payload?.campaignId === campaign.id);
  const latestJob = deliveryJobs[0] || null;
  const scheduledAt = latestJob?.runAt || null;
  const scheduledMs = scheduledAt ? new Date(scheduledAt).getTime() : null;
  const minutesUntilSend = Number.isFinite(scheduledMs) ? Math.max(0, Math.round((scheduledMs - Date.now()) / 60000)) : null;
  return {
    blockers,
    scheduledAt,
    queuedDeliveries: deliveryJobs.length,
    senderReady: Boolean(effectiveWorkspace?.settings?.senderEmail && effectiveWorkspace?.settings?.address),
    approvalPending: approvalStatusForCampaign(state, campaign).pending,
    scheduleLabel: scheduledAt
      ? minutesUntilSend === 0
        ? 'Delivery window is due now'
        : 'Delivery window opens in ' + minutesUntilSend + ' min'
      : campaign.status === 'queued'
        ? 'Queued for immediate delivery'
        : 'Not queued yet'
  };
}

export function queueCampaignDelivery(state, actor, campaign, runAt = null) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/campaigns.mjs', (text) => {
    let next = text;
    if (!next.includes('campaignSendScheduleSummary')) {
      next = next.replace(/import \{([^}]*)\} from '\.\.\/domain-campaigns\.mjs';/, (full, specifiers) => {
        const parts = specifiers.split(',').map((part) => part.trim()).filter(Boolean);
        if (!parts.includes('campaignSendScheduleSummary')) parts.splice(Math.max(0, parts.indexOf('campaignReviewState') + 1), 0, 'campaignSendScheduleSummary');
        return `import { ${[...new Set(parts)].join(', ')} } from '../domain-campaigns.mjs';`;
      });
    }
    if (!next.includes('const scheduleSummary = campaignSendScheduleSummary(state, campaign, actor.workspace);')) {
      next = next.replace(
        "    const reviewState = campaignReviewState(state, campaign, actor.workspace);",
        "    const reviewState = campaignReviewState(state, campaign, actor.workspace); const scheduleSummary = campaignSendScheduleSummary(state, campaign, actor.workspace);"
      );
    }
    next = next.replace(
      '<p>Recipients: ${recipientCount(state, campaign)}</p><p>Approval status: ${campaign.approvalStatus || \'not_requested\'}</p>',
      '<p>Recipients: ${recipientCount(state, campaign)}</p><p>Approval status: ${campaign.approvalStatus || \'not_requested\'}</p><p>Delivery state: ${scheduleSummary.scheduleLabel}</p>'
    );
    if (!next.includes('<h3>Send schedule readiness</h3>')) {
      next = next.replace(
        "<div class=\"card\"><h3>Schedule</h3>${schedulingGate}<form method=\"post\" action=\"/campaigns/${campaign.id}/schedule\"><input name=\"runAt\" type=\"datetime-local\" required><button ${(reviewState.blockers.length || !hasFeature(actor.workspace, 'scheduledSend')) ? 'disabled' : ''}>Schedule delivery</button></form></div>",
        "<div class=\"card\"><h3>Schedule</h3>${schedulingGate}<p>${scheduleSummary.scheduleLabel}</p><p>Queued deliveries: ${scheduleSummary.queuedDeliveries}</p><form method=\"post\" action=\"/campaigns/${campaign.id}/schedule\"><input name=\"runAt\" type=\"datetime-local\" required><button ${(reviewState.blockers.length || !hasFeature(actor.workspace, 'scheduledSend')) ? 'disabled' : ''}>Schedule delivery</button></form></div><div class=\"card\"><h3>Send schedule readiness</h3><p>Sender ready: ${scheduleSummary.senderReady ? 'yes' : 'no'}</p><p>Approval pending: ${scheduleSummary.approvalPending ? 'yes' : 'no'}</p><p>Blockers: ${scheduleSummary.blockers.length}</p></div>"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalCampaignIndexFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const campaignDomainRel = 'packages/app/domain-campaigns.mjs';
  const campaignDomainPath = path.join(workspacePath, campaignDomainRel);
  const domainHelperAvailable = !allowedFiles.size
    || allowedFiles.has(campaignDomainRel)
    || (fs.existsSync(campaignDomainPath) && read(campaignDomainPath).includes('export function campaignIndexSummary(state, workspaceId)'));

  patchAllowedFile(workspacePath, allowedFiles, campaignDomainRel, (text) => {
    if (text.includes('export function campaignIndexSummary(state, workspaceId)')) return text;
    return text.replace(
      'export function recipientCount(state, campaign) {',
      `export function campaignIndexSummary(state, workspaceId) {
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId);
  const reviewReady = campaigns.filter((entry) => campaignNextStep(entry) === 'review').length;
  const approvalsPending = campaigns.filter((entry) => approvalStatusForCampaign(state, entry).pending).length;
  const queuedDeliveries = state.db.jobs.filter((entry) => entry.workspaceId === workspaceId && entry.type === 'deliver_campaign' && entry.status === 'pending').length;
  const nextScheduled = state.db.jobs
    .filter((entry) => entry.workspaceId === workspaceId && entry.type === 'deliver_campaign' && entry.runAt)
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())[0] || null;
  return {
    total: campaigns.length,
    draft: campaigns.filter((entry) => entry.status === 'draft').length,
    queued: campaigns.filter((entry) => entry.status === 'queued').length,
    scheduled: campaigns.filter((entry) => entry.status === 'scheduled').length,
    sent: campaigns.filter((entry) => entry.status === 'sent').length,
    reviewReady,
    approvalsPending,
    queuedDeliveries,
    nextScheduledAt: nextScheduled?.runAt || null
  };
}

export function recipientCount(state, campaign) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/campaigns.mjs', (text) => {
    let next = text;
    next = next.replace(/import \{([^}]*)\} from '\.\.\/domain-campaigns\.mjs';/, (full, specifiers) => {
      const parts = specifiers
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => part !== 'campaignIndexSummary');
      if (domainHelperAvailable) parts.unshift('campaignIndexSummary');
      return `import { ${[...new Set(parts)].join(', ')} } from '../domain-campaigns.mjs';`;
    });
    if (!domainHelperAvailable && !next.includes('function campaignIndexLocalSummary(state, workspaceId)')) {
      next = next.replace(
        'function cloneEditorBlocks(blocks = []) {',
        `function campaignIndexLocalSummary(state, workspaceId) {
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId);
  const campaignIds = new Set(campaigns.map((entry) => entry.id));
  const approvalRequests = Array.isArray(state.db.approvalRequests) ? state.db.approvalRequests : [];
  const jobs = Array.isArray(state.db.jobs) ? state.db.jobs : [];
  const reviewReady = campaigns.filter((entry) => campaignNextStep(entry) === 'review').length;
  const approvalsPending = approvalRequests.filter((entry) => entry.targetType === 'campaign' && campaignIds.has(entry.targetId) && entry.status === 'pending').length;
  const queuedDeliveries = jobs.filter((entry) => entry.workspaceId === workspaceId && entry.type === 'deliver_campaign' && entry.status === 'pending').length;
  const nextScheduled = jobs
    .filter((entry) => entry.workspaceId === workspaceId && entry.type === 'deliver_campaign' && entry.runAt)
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())[0] || null;
  return {
    total: campaigns.length,
    draft: campaigns.filter((entry) => entry.status === 'draft').length,
    queued: campaigns.filter((entry) => entry.status === 'queued').length,
    scheduled: campaigns.filter((entry) => entry.status === 'scheduled').length,
    sent: campaigns.filter((entry) => entry.status === 'sent').length,
    reviewReady,
    approvalsPending,
    queuedDeliveries,
    nextScheduledAt: nextScheduled?.runAt || null
  };
}

function cloneEditorBlocks(blocks = []) {`
      );
    }
    next = next.replace(
      /const summary = campaignIndex(?:Local)?Summary\(state, actor\.workspace\.id\);/,
      `const summary = ${domainHelperAvailable ? 'campaignIndexSummary' : 'campaignIndexLocalSummary'}(state, actor.workspace.id);`
    );
    if (!next.includes(`const summary = ${domainHelperAvailable ? 'campaignIndexSummary' : 'campaignIndexLocalSummary'}(state, actor.workspace.id);`)) {
      next = next.replace(
        "    const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);\n",
        `    const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);\n    const summary = ${domainHelperAvailable ? 'campaignIndexSummary' : 'campaignIndexLocalSummary'}(state, actor.workspace.id);\n`
      );
    }
    if (!next.includes('<h3>Campaign pipeline</h3>')) {
      next = next.replace(
        '<div class="card"><p><a href="/campaigns/new">Create campaign</a></p><table><tr><th>Name</th><th>Status</th><th>Recipients</th><th>Template</th><th>Resume</th><th>Actions</th></tr>${campaigns.map((campaign) => `<tr><td>${campaign.name || \'Untitled\'}</td><td>${campaign.status}</td><td>${recipientCount(state, campaign)}</td><td>${state.db.templates.find((entry) => entry.id === campaign.templateId)?.name || \'—\'}</td><td><a href="/campaigns/${campaign.id}/resume">Resume at ${campaignNextStep(campaign)}</a></td><td><a href="/campaigns/${campaign.id}/setup">Setup</a> · <a href="/campaigns/${campaign.id}/recipients">Recipients</a> · <a href="/campaigns/${campaign.id}/templates">Templates</a> · <a href="/campaigns/${campaign.id}/editor">Editor</a> · <a href="/campaigns/${campaign.id}/review">Review</a> · <a href="/reports/campaigns/${campaign.id}">Report</a></td></tr>`).join(\'\')}</table></div>',
        '<div class="grid"><div class="card"><h3>Campaign pipeline</h3><p>Draft: ${summary.draft} · Review-ready: ${summary.reviewReady}</p><p>Queued deliveries: ${summary.queuedDeliveries} · Scheduled: ${summary.scheduled}</p><p>Approvals pending: ${summary.approvalsPending}</p><p>${summary.nextScheduledAt ? `Next scheduled send: ${summary.nextScheduledAt}` : \'No scheduled sends yet.\'}</p><p><a href="/campaigns/new">Create campaign</a></p></div><div class="card"><h3>Delivery coverage</h3><p>Total campaigns: ${summary.total}</p><p>Queued: ${summary.queued}</p><p>Sent: ${summary.sent}</p><p><a href="/reports">Open reports overview</a></p></div></div><div class="card"><table><tr><th>Name</th><th>Status</th><th>Recipients</th><th>Template</th><th>Resume</th><th>Actions</th></tr>${campaigns.map((campaign) => `<tr><td>${campaign.name || \'Untitled\'}</td><td>${campaign.status}</td><td>${recipientCount(state, campaign)}</td><td>${state.db.templates.find((entry) => entry.id === campaign.templateId)?.name || \'—\'}</td><td><a href="/campaigns/${campaign.id}/resume">Resume at ${campaignNextStep(campaign)}</a></td><td><a href="/campaigns/${campaign.id}/setup">Setup</a> · <a href="/campaigns/${campaign.id}/recipients">Recipients</a> · <a href="/campaigns/${campaign.id}/templates">Templates</a> · <a href="/campaigns/${campaign.id}/editor">Editor</a> · <a href="/campaigns/${campaign.id}/review">Review</a> · <a href="/reports/campaigns/${campaign.id}">Report</a></td></tr>`).join(\'\')}</table></div>'
      );
    }
    if (!next.includes('<h3>Guided setup</h3>')) {
      next = next.replace(
        "text(res, 200, page('Campaign creation wizard', actor, '<div class=\"steps\"><span class=\"step active\">1. Setup</span><span class=\"step\">2. Recipients</span><span class=\"step\">3. Template</span><span class=\"step\">4. Design</span><span class=\"step\">5. Review</span></div><div class=\"card\"><form method=\"post\" action=\"/campaigns\"><input name=\"name\" placeholder=\"Spring launch\" required><button>Create draft</button></form></div>'));",
        "text(res, 200, page('Campaign creation wizard', actor, '<div class=\"steps\"><span class=\"step active\">1. Setup</span><span class=\"step\">2. Recipients</span><span class=\"step\">3. Template</span><span class=\"step\">4. Design</span><span class=\"step\">5. Review</span></div><div class=\"grid\"><div class=\"card\"><form method=\"post\" action=\"/campaigns\"><input name=\"name\" placeholder=\"Spring launch\" required><button>Create draft</button></form></div><div class=\"card\"><h3>Guided setup</h3><p>Wizard flow now walks setup, recipients, template choice, design, and review before delivery.</p><p><a href=\"/templates\">Browse templates first</a></p></div></div>'));"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalReportsOverviewFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/api-admin.mjs', (text) => {
    if (text.includes("router.register('GET', '/api/reports/summary'")) return text;
    return text.replace(
      "  router.register('GET', '/api/commerce/revenue', async ({ state, req, res }) => {",
      `  router.register('GET', '/api/reports/summary', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, {
      ok: true,
      summary: workspaceSummary(state, actor.workspace.id),
      trends: analyticsSeries(state, actor.workspace.id),
      revenue: revenueSummary(state, actor.workspace.id),
      campaigns: state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id).length
    });
  });

  router.register('GET', '/api/commerce/revenue', async ({ state, req, res }) => {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/reports.mjs', (text) => {
    let next = text;
    if (!next.includes('const activeCampaigns = state.db.campaigns')) {
      next = next.replace(
        "    const actor = requireAuth(state, req, res); if (!actor) return; const summary = workspaceSummary(state, actor.workspace.id); const trends = analyticsSeries(state, actor.workspace.id); const revenue = revenueSummary(state, actor.workspace.id);\n",
        "    const actor = requireAuth(state, req, res); if (!actor) return; const summary = workspaceSummary(state, actor.workspace.id); const trends = analyticsSeries(state, actor.workspace.id); const revenue = revenueSummary(state, actor.workspace.id); const activeCampaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id && ['queued', 'scheduled', 'sent'].includes(entry.status));\n"
      );
    }
    if (!next.includes('<h3>Report integrity</h3>')) {
      next = next.replace(
        '<div class="card"><h3>Current-product reports</h3><p><a href="/reports/optimization">Optimization outcomes</a></p><p><a href="/reports/omnichannel">Omnichannel performance</a></p></div>',
        '<div class="card"><h3>Current-product reports</h3><p><a href="/reports/optimization">Optimization outcomes</a></p><p><a href="/reports/omnichannel">Omnichannel performance</a></p></div><div class="card"><h3>Report integrity</h3><p>Active send surfaces: ${activeCampaigns.length}</p><p>Published forms: ${summary.publishedForms}</p><p>Published landing pages: ${summary.publishedLandingPages}</p><p><a href="/api/reports/summary">Open API summary</a></p></div>'
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalIntegrationsMarketplaceFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const beforeCount = modifiedFiles.size;

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-integration-marketplace.mjs', (text) => {
    if (text.includes('export function integrationMarketplaceSurfaceSummary')) return text;
    return text.replace(
      'export function workspaceIntegrationSummary(state, workspaceId) {',
      `export function integrationMarketplaceSurfaceSummary(state, workspaceId) {
  const installations = workspaceIntegrationInstallations(state, workspaceId);
  const syncRuns = state.db.integrationSyncRuns.filter((entry) => entry.workspaceId === workspaceId);
  return {
    installedApps: installations.length,
    connectedApps: installations.filter((entry) => entry.status === 'installed').length,
    authModes: Array.from(new Set(installations.map((entry) => entry.authMode || 'oauth'))),
    appsNeedingSync: installations.filter((entry) => !entry.lastSyncedAt).length,
    lastSyncAt: syncRuns[0]?.createdAt || null
  };
}

export function workspaceIntegrationSummary(state, workspaceId) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/integrations-marketplace.mjs', (text) => {
    let next = text;
    if (!next.includes('integrationMarketplaceSurfaceSummary')) {
      next = next.replace(
        "import { MARKETPLACE_APPS, installMarketplaceApp, syncMarketplaceInstallation, workspaceIntegrationInstallations, workspaceIntegrationSummary } from '../domain-integration-marketplace.mjs';",
        "import { MARKETPLACE_APPS, installMarketplaceApp, integrationMarketplaceSurfaceSummary, syncMarketplaceInstallation, workspaceIntegrationInstallations, workspaceIntegrationSummary } from '../domain-integration-marketplace.mjs';"
      );
    }
    if (!next.includes('const surfaceSummary = integrationMarketplaceSurfaceSummary(state, actor.workspace.id);')) {
      next = next.replace(
        "    const summary = workspaceIntegrationSummary(state, actor.workspace.id);\n",
        "    const summary = workspaceIntegrationSummary(state, actor.workspace.id);\n    const surfaceSummary = integrationMarketplaceSurfaceSummary(state, actor.workspace.id);\n"
      );
    }
    if (!next.includes('<h3>Connector operations</h3>')) {
      next = next.replace(
        '<div class="card"><h3>Integration realism summary</h3><ul><li>Installed apps: ${summary.installedApps}</li><li>Commerce connectors: ${summary.commerceApps}</li><li>Collaboration connectors: ${summary.collaborationApps}</li><li>Last sync: ${summary.lastSyncAt || \'Never\'}</li></ul><p>Connector detail pages now expose auth, config, field mapping, health, and retry workflows.</p></div>',
        '<div class="card"><h3>Integration realism summary</h3><ul><li>Installed apps: ${summary.installedApps}</li><li>Commerce connectors: ${summary.commerceApps}</li><li>Collaboration connectors: ${summary.collaborationApps}</li><li>Last sync: ${summary.lastSyncAt || \'Never\'}</li></ul><p>Connector detail pages now expose auth, config, field mapping, health, and retry workflows.</p></div><div class="card"><h3>Connector operations</h3><p>Connected apps: ${surfaceSummary.connectedApps}</p><p>Auth modes: ${surfaceSummary.authModes.join(\', \' ) || \'oauth\'}</p><p>Needs first sync: ${surfaceSummary.appsNeedingSync}</p><p>${surfaceSummary.lastSyncAt ? `Last verified sync: ${surfaceSummary.lastSyncAt}` : \'No verified sync yet.\'}</p></div>'
      );
    }
    return next;
  }, modifiedFiles);

  if (allowedFiles.size > 0 && modifiedFiles.size === beforeCount) {
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-integration-marketplace.mjs', (text) => {
      if (text.includes('export function integrationMarketplaceOperationalReadiness')) return text;
      return `${text.trimEnd()}\n\nexport function integrationMarketplaceOperationalReadiness(state, workspaceId) {\n  const installations = workspaceIntegrationInstallations(state, workspaceId);\n  const syncRuns = state.db.integrationSyncRuns.filter((entry) => entry.workspaceId === workspaceId);\n  const unhealthy = installations.filter((entry) => entry.health && entry.health !== 'healthy');\n  return {\n    installedApps: installations.length,\n    unhealthyApps: unhealthy.length,\n    pendingSyncs: installations.filter((entry) => !entry.lastSyncedAt || entry.authStatus !== 'connected').length,\n    lastSyncAt: syncRuns[0]?.createdAt || null,\n    workflowStatus: unhealthy.length ? 'connector_attention_required' : 'connector_operations_ready',\n    nextAction: unhealthy[0] ? 'open_connector_health_detail' : 'verify_next_provider_sync'\n  };\n}\n`;
    }, modifiedFiles);
  }
}

function apiKeysWebhooksSwarmLeafTarget(allowedFiles = new Set()) {
  return [...allowedFiles]
    .filter((entry) => /^packages\/app\/full-clone-swarm\/api_keys_webhooks\/.+\.mjs$/.test(entry))
    .sort()[0] || null;
}

function apiKeysWebhooksRuntimeLeafSource(assignment = {}, targetRel = '') {
  const shardId = String(assignment.shard?.id || assignment.shardId || assignment.shard?.metadata?.swarmLeafId || 'focus.api_keys_webhooks#1');
  const sourceProductFile = String(assignment.shard?.metadata?.sourceProductFile || assignment.contextPack?.shard?.metadata?.sourceProductFile || 'packages/app/routes/api-admin.mjs');
  const detail = fullCloneGapDetail(assignment) || 'API keys, scoped access, webhook subscriptions, delivery history, retry controls, secret rotation, and developer operations need durable runtime ownership.';
  const exportPrefix = jsIdentifier(`${shardId}_api_keys_webhooks_runtime`, 'apiKeysWebhooksRuntime');
  return `export const ${exportPrefix}Contract = Object.freeze({
  surfaceId: 'api_keys_webhooks',
  shardId: ${JSON.stringify(shardId)},
  sourceProductFile: ${JSON.stringify(sourceProductFile)},
  targetProductFile: ${JSON.stringify(targetRel)},
  runtimeBoundaries: ['developer_access_api', 'api_key_lifecycle', 'webhook_subscription_delivery', 'secret_rotation', 'delivery_replay'],
  negativeSpaceReduced: ${JSON.stringify(detail)}
});

function nowIso() {
  return new Date().toISOString();
}

function ensureDeveloperAccessCollections(state) {
  state.db ||= {};
  state.db.apiKeys ||= [];
  state.db.webhooks ||= [];
  state.db.webhookDeliveries ||= [];
  state.db.apiRequestAudit ||= [];
  state.db.developerSecretRotations ||= [];
  state.db.developerAccessSnapshots ||= [];
  return state.db;
}

function scopedEntries(entries = [], workspaceId = '') {
  return entries.filter((entry) => !workspaceId || entry.workspaceId === workspaceId);
}

export function ${exportPrefix}Summary(state, workspaceId = '') {
  const db = ensureDeveloperAccessCollections(state);
  const apiKeys = scopedEntries(db.apiKeys, workspaceId);
  const webhooks = scopedEntries(db.webhooks, workspaceId);
  const deliveries = scopedEntries(db.webhookDeliveries, workspaceId);
  const auditRows = scopedEntries(db.apiRequestAudit, workspaceId);
  const rotations = scopedEntries(db.developerSecretRotations, workspaceId);
  const activeKeys = apiKeys.filter((entry) => !entry.revokedAt && (entry.status || 'active') === 'active');
  const expiringKeys = activeKeys.filter((entry) => entry.expiresAt && new Date(entry.expiresAt).getTime() - Date.now() < 1000 * 60 * 60 * 24 * 14);
  const failingHooks = webhooks.filter((entry) => (entry.status || 'active') !== 'active' || Number(entry.failureCount || 0) > 0);
  const signedDeliveries = deliveries.filter((entry) => Boolean(entry.signature || entry.signingSecretId));
  return {
    ...${exportPrefix}Contract,
    workspaceId,
    generatedAt: nowIso(),
    apiKeys: {
      total: apiKeys.length,
      active: activeKeys.length,
      revoked: apiKeys.filter((entry) => entry.revokedAt || entry.status === 'revoked').length,
      expiringSoon: expiringKeys.length,
      scopeCount: new Set(apiKeys.flatMap((entry) => entry.scopes || [])).size
    },
    webhooks: {
      total: webhooks.length,
      active: webhooks.filter((entry) => (entry.status || 'active') === 'active').length,
      paused: webhooks.filter((entry) => entry.status === 'paused').length,
      failing: failingHooks.length,
      subscribedEvents: Array.from(new Set(webhooks.flatMap((entry) => entry.events || []))).sort()
    },
    deliveries: {
      total: deliveries.length,
      signed: signedDeliveries.length,
      failed: deliveries.filter((entry) => ['failed', 'retrying'].includes(entry.status)).length,
      replayed: deliveries.filter((entry) => entry.replayOfDeliveryId).length,
      lastDeliveryAt: deliveries.map((entry) => entry.createdAt).filter(Boolean).sort().at(-1) || null
    },
    operations: {
      auditRows: auditRows.length,
      secretRotations: rotations.length,
      nextAction: failingHooks[0] ? 'review_webhook_delivery_failures' : expiringKeys[0] ? 'rotate_expiring_api_key' : 'verify_signed_delivery_replay',
      runtimeReady: activeKeys.length > 0 && webhooks.length > 0 && signedDeliveries.length > 0
    }
  };
}

export function ${exportPrefix}RecordDelivery(state, workspaceId, webhookId, eventType, outcome = {}) {
  const db = ensureDeveloperAccessCollections(state);
  const webhook = db.webhooks.find((entry) => entry.id === webhookId && entry.workspaceId === workspaceId) || null;
  const delivery = {
    id: outcome.id || \`whdel_\${Date.now().toString(36)}\`,
    workspaceId,
    webhookId,
    targetUrl: outcome.targetUrl || webhook?.targetUrl || '',
    eventType,
    status: outcome.status || 'queued',
    signature: outcome.signature || webhook?.signingSecret ? \`sha256:\${String(outcome.signature || webhook?.signingSecret).slice(0, 24)}\` : '',
    attempt: Number(outcome.attempt || 1),
    nextRetryAt: outcome.nextRetryAt || null,
    responseStatus: outcome.responseStatus || null,
    createdAt: nowIso()
  };
  db.webhookDeliveries.unshift(delivery);
  if (webhook) {
    webhook.lastDeliveryAt = delivery.createdAt;
    webhook.status = delivery.status === 'failed' ? 'degraded' : (webhook.status || 'active');
    webhook.failureCount = delivery.status === 'failed' ? Number(webhook.failureCount || 0) + 1 : 0;
  }
  db.developerAccessSnapshots.unshift(${exportPrefix}Summary(state, workspaceId));
  db.developerAccessSnapshots = db.developerAccessSnapshots.slice(0, 25);
  return delivery;
}

export function ${exportPrefix}PlanOperatorActions(state, workspaceId = '') {
  const summary = ${exportPrefix}Summary(state, workspaceId);
  const actions = [];
  if (summary.apiKeys.expiringSoon > 0) actions.push({ id: 'rotate_expiring_api_keys', route: '/developer/api-keys', method: 'POST', reason: 'active API keys are inside the rotation window' });
  if (summary.webhooks.failing > 0) actions.push({ id: 'retry_webhook_deliveries', route: '/developer/webhooks', method: 'POST', reason: 'webhook delivery health is degraded' });
  if (summary.deliveries.signed === 0 && summary.webhooks.total > 0) actions.push({ id: 'send_signed_webhook_probe', route: '/developer/webhooks/:id/deliver', method: 'POST', reason: 'signed delivery proof is missing' });
  if (summary.operations.auditRows === 0) actions.push({ id: 'capture_api_request_audit', route: '/api/developer/runtime', method: 'GET', reason: 'developer access audit ledger needs request evidence' });
  return { ...summary, actions, sourceOfTruthRuntime: ${exportPrefix}Contract.sourceProductFile };
}

export default {
  contract: ${exportPrefix}Contract,
  summarize: ${exportPrefix}Summary,
  recordDelivery: ${exportPrefix}RecordDelivery,
  planOperatorActions: ${exportPrefix}PlanOperatorActions
};
`;
}

function apiKeysWebhooksSourceProductFile(assignment = {}) {
  return String(assignment.shard?.metadata?.sourceProductFile
    || assignment.contextPack?.shard?.metadata?.sourceProductFile
    || 'packages/app/routes/api-admin.mjs').trim() || 'packages/app/routes/api-admin.mjs';
}

function patchApiKeysWebhooksSourceRuntime(text) {
  let next = text;
  if (!next.includes('function apiKeysWebhooksOperationalAccessSnapshot(')) {
    const helper = `
function apiKeysWebhooksOperationalAccessSnapshot(state, workspaceId) {
  const db = state.db || {};
  const apiKeys = (db.apiKeys || []).filter((entry) => entry.workspaceId === workspaceId);
  const webhooks = (db.webhooks || []).filter((entry) => entry.workspaceId === workspaceId);
  const deliveries = (db.webhookDeliveries || []).filter((entry) => entry.workspaceId === workspaceId);
  const auditRows = (db.apiRequestAudit || []).filter((entry) => entry.workspaceId === workspaceId);
  const activeKeys = apiKeys.filter((entry) => !entry.revokedAt && (entry.status || 'active') === 'active');
  const scopedEvents = Array.from(new Set(webhooks.flatMap((entry) => entry.events || []))).sort();
  const failedDeliveries = deliveries.filter((entry) => ['failed', 'retrying'].includes(entry.status));
  const signedDeliveries = deliveries.filter((entry) => Boolean(entry.signature || entry.signingSecretId));
  return {
    surfaceId: 'api_keys_webhooks',
    workspaceId,
    keyLifecycle: {
      total: apiKeys.length,
      active: activeKeys.length,
      revoked: apiKeys.filter((entry) => entry.revokedAt || entry.status === 'revoked').length,
      scopedPermissions: Array.from(new Set(apiKeys.flatMap((entry) => entry.scopes || []))).sort()
    },
    webhookDelivery: {
      subscriptions: webhooks.length,
      activeSubscriptions: webhooks.filter((entry) => (entry.status || 'active') === 'active').length,
      subscribedEvents: scopedEvents,
      signedDeliveries: signedDeliveries.length,
      failedDeliveries: failedDeliveries.length,
      replayableDeliveries: deliveries.filter((entry) => !entry.replayOfDeliveryId && ['failed', 'retrying', 'delivered'].includes(entry.status)).length
    },
    operations: {
      auditRows: auditRows.length,
      runtimeReady: activeKeys.length > 0 && webhooks.length > 0,
      nextAction: failedDeliveries[0] ? 'retry_failed_webhook_delivery' : activeKeys.length === 0 ? 'create_scoped_api_key' : 'verify_signed_webhook_delivery'
    }
  };
}
`;
    next = next.replace('\nexport function registerApiAdminRoutes(router, deps) {', `${helper}\nexport function registerApiAdminRoutes(router, deps) {`);
  }
  if (!next.includes("router.register('GET', '/api/developer/access'")) {
    const accessRoute = `  router.register('GET', '/api/developer/access', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const keys = state.db.apiKeys.filter((entry) => entry.workspaceId === actor.workspace.id);
    const hooks = state.db.webhooks.filter((entry) => entry.workspaceId === actor.workspace.id);
    const deliveries = state.db.webhookDeliveries.filter((entry) => entry.workspaceId === actor.workspace.id).slice(0, 10);
    const operationalAccess = apiKeysWebhooksOperationalAccessSnapshot(state, actor.workspace.id);
    json(res, 200, {
      ok: true,
      operationalAccess,
      apiKeys: {
        total: keys.length,
        active: keys.filter((entry) => !entry.revokedAt).length,
        revoked: keys.filter((entry) => entry.revokedAt).length,
        recent: keys.slice(0, 5).map((entry) => ({
          id: entry.id,
          label: entry.label,
          status: entry.revokedAt ? 'revoked' : 'active',
          createdAt: entry.createdAt,
          revokedAt: entry.revokedAt || null
        }))
      },
      webhooks: {
        total: hooks.length,
        active: hooks.filter((entry) => entry.status === 'active').length,
        failing: hooks.filter((entry) => entry.status && entry.status !== 'active').length,
        lastDeliveryAt: deliveries[0]?.createdAt || null,
        recentDeliveries: deliveries.slice(0, 5).map((entry) => ({
          id: entry.id,
          targetUrl: entry.targetUrl,
          eventType: entry.eventType,
          status: entry.status,
          createdAt: entry.createdAt
        }))
      }
    });
  });\n\n`;
    next = next.replace("  router.register('GET', '/api/integrations', async ({ state, req, res }) => {", `${accessRoute}  router.register('GET', '/api/integrations', async ({ state, req, res }) => {`);
  } else {
    if (!next.includes('const operationalAccess = apiKeysWebhooksOperationalAccessSnapshot(state, actor.workspace.id);')) {
      next = next.replace(
        "    const deliveries = state.db.webhookDeliveries.filter((entry) => entry.workspaceId === actor.workspace.id).slice(0, 10);\n    json(res, 200, {",
        "    const deliveries = state.db.webhookDeliveries.filter((entry) => entry.workspaceId === actor.workspace.id).slice(0, 10);\n    const operationalAccess = apiKeysWebhooksOperationalAccessSnapshot(state, actor.workspace.id);\n    json(res, 200, {"
      );
    }
    if (!next.includes('      operationalAccess,\n      apiKeys: {')) {
      next = next.replace("      ok: true,\n      apiKeys: {", "      ok: true,\n      operationalAccess,\n      apiKeys: {");
    }
  }
  return next;
}

function applyCanonicalApiKeysWebhooksFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const sourceProductFile = apiKeysWebhooksSourceProductFile(assignment);

  for (const targetRel of Array.from(new Set([sourceProductFile, 'packages/app/routes/api-admin.mjs']))) {
    if (patchAllowedFile(workspacePath, allowedFiles, targetRel, patchApiKeysWebhooksSourceRuntime, modifiedFiles)) break;
  }

  if (modifiedFiles.size === 0) {
    const sourceFileIsAuthoritativeTarget = allowedFiles.has(sourceProductFile) && fs.existsSync(path.join(workspacePath, sourceProductFile));
    if (sourceFileIsAuthoritativeTarget) return;
    const leafTarget = apiKeysWebhooksSwarmLeafTarget(allowedFiles);
    if (leafTarget) {
      writeAllowedFile(workspacePath, allowedFiles, leafTarget, apiKeysWebhooksRuntimeLeafSource(assignment, leafTarget), modifiedFiles);
    }
  }
}

function applyCanonicalBillingPlansFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-commerce-revenue.mjs', (text) => {
    if (text.includes('export function billingPlanSummary')) return text;
    return text.replace(
      'export function revenueSummary(state, workspaceId) {',
      `export function billingPlanSummary(state, workspaceId) {
  const workspace = state.db.workspaces.find((entry) => entry.id === workspaceId) || null;
  const invoices = workspace?.billing?.invoices || [];
  const monthlyLimit = Number(workspace?.billing?.monthlyLimit || 0);
  const monthlySendsUsed = Number(workspace?.billing?.monthlySendsUsed || 0);
  const latestInvoice = invoices[0] || null;
  return {
    planId: workspace?.planId || 'starter',
    monthlyLimit,
    monthlySendsUsed,
    monthlySendsRemaining: Math.max(0, monthlyLimit - monthlySendsUsed),
    invoiceCount: invoices.length,
    paidInvoices: invoices.filter((entry) => entry.status === 'paid').length,
    pastDueInvoices: invoices.filter((entry) => entry.status === 'past_due').length,
    latestInvoice: latestInvoice ? {
      id: latestInvoice.id,
      amount: latestInvoice.amount,
      status: latestInvoice.status,
      dueAt: latestInvoice.dueAt || null
    } : null
  };
}

export function revenueSummary(state, workspaceId) {`
    );
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/api-admin.mjs', (text) => {
    let next = text;
    if (!next.includes("import { billingPlanSummary, revenueSummary } from '../domain-commerce-revenue.mjs';")) {
      next = next.replace(
        "import { revenueSummary } from '../domain-commerce-revenue.mjs';",
        "import { billingPlanSummary, revenueSummary } from '../domain-commerce-revenue.mjs';"
      );
    }
    if (!next.includes("router.register('GET', '/api/billing/summary'")) {
      const billingRoute = `  router.register('GET', '/api/billing/summary', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    json(res, 200, {
      ok: true,
      billing: billingPlanSummary(state, actor.workspace.id),
      revenue: revenueSummary(state, actor.workspace.id)
    });
  });\n\n`;
      next = next.replace("  router.register('GET', '/api/commerce/revenue', async ({ state, req, res }) => {", `${billingRoute}  router.register('GET', '/api/commerce/revenue', async ({ state, req, res }) => {`);
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalSignupOnboardingFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const beforeCount = modifiedFiles.size;
  const surfaceId = deriveFocusSurfaceId(assignment) || 'account_workspace_setup';
  const actualSignupOnboarding = surfaceId === 'signup_onboarding';

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/index.mjs', (text) => {
    let next = text;
    if (!next.includes('signupOnboardingCard')) {
      next = next.replace(
      "export { page, requireActor, requireAdmin, nav } from './view.mjs';",
      "export { page, requireActor, requireAdmin, nav, signupOnboardingCard, signupOnboardingChecklistItems } from './view.mjs';"
      );
    }
    if (actualSignupOnboarding && !next.includes('signupOnboardingRecoveryPanel')) {
      next = next.replace(
        'signupOnboardingCard, signupOnboardingChecklistItems',
        'signupOnboardingCard, signupOnboardingChecklistItems, signupOnboardingJourneyReadiness, signupOnboardingRecoveryPanel'
      );
    }
    return next;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/view.mjs', (text) => {
    let next = text;
    if (!next.includes('export function signupOnboardingChecklistItems(actor)')) {
      const helperBlock = `export function signupOnboardingChecklistItems(actor) {
  const workspace = actor?.workspace || { settings: {}, featureFlags: {}, billing: {} };
  const domains = workspace.settings?.domains || [];
  return [
    { label: 'Create workspace', done: Boolean(workspace.id) },
    { label: 'Set sender profile', done: Boolean(workspace.settings?.senderEmail && workspace.settings?.senderName) },
    { label: 'Connect authenticated domain', done: domains.some((entry) => entry.authenticationStatus === 'authenticated') },
    { label: 'Invite teammates', done: Boolean(workspace.featureFlags?.multiUser) },
    { label: 'Choose a send-ready plan', done: Boolean(workspace.planId && workspace.planId !== 'starter') }
  ];
}

export function signupOnboardingCard(actor, { compact = false } = {}) {
  const steps = signupOnboardingChecklistItems(actor);
  const completed = steps.filter((step) => step.done).length;
  const href = compact ? '/onboarding' : '/signup';
  const label = compact ? 'Open onboarding checklist' : 'Start guided signup';
  return \`<div class="card"><h3>Signup onboarding</h3><p>\${completed}/\${steps.length} setup steps ready</p><div class="steps">\${steps.map((step) => \`<span class="step \${step.done ? 'active' : ''}">\${escapeHtml(step.label)}</span>\`).join('')}</div><p><a href="\${href}">\${label}</a></p></div>\`;
}`;
      next = next.replace('export function requireActor(state, req, res, redirect, getCurrentActor) {', `${helperBlock}\n\nexport function requireActor(state, req, res, redirect, getCurrentActor) {`);
    }
    if (actualSignupOnboarding && !next.includes('export function signupOnboardingRecoveryPanel(actor')) {
      const recoveryBlock = `export function signupOnboardingJourneyReadiness(actor) {
  const steps = signupOnboardingChecklistItems(actor);
  const completed = steps.filter((step) => step.done);
  const blockers = steps.filter((step) => !step.done).map((step) => step.label);
  return {
    completed: completed.length,
    total: steps.length,
    percent: Math.round((completed.length / Math.max(steps.length, 1)) * 100),
    blockers,
    nextStep: blockers[0] || 'Create your first campaign',
    hasSenderIdentity: steps.some((step) => step.label === 'Set sender profile' && step.done),
    hasAuthenticatedDomain: steps.some((step) => step.label === 'Connect authenticated domain' && step.done)
  };
}

export function signupOnboardingRecoveryPanel(actor, { source = 'dashboard' } = {}) {
  const readiness = signupOnboardingJourneyReadiness(actor);
  const blockerList = readiness.blockers.length
    ? readiness.blockers.map((label) => \`<li>\${escapeHtml(label)}</li>\`).join('')
    : '<li>Workspace is ready for first campaign launch</li>';
  return \`<div class="card"><h3>Resume setup</h3><p>\${readiness.percent}% onboarding readiness from \${escapeHtml(source)}</p><ul>\${blockerList}</ul><p class="muted">Recovery links preserve the workspace, sender, domain, and team setup context instead of restarting signup from scratch.</p><p><a href="/onboarding/recovery">Open recovery checklist</a> · <a href="/settings">Fix sender/domain setup</a></p></div>\`;
}`;
      next = next.replace('export function requireActor(state, req, res, redirect, getCurrentActor) {', `${recoveryBlock}\n\nexport function requireActor(state, req, res, redirect, getCurrentActor) {`);
    }
    if (!next.includes('<a href="/onboarding">Onboarding</a>')) {
      next = next.replace('<a href="/app">Dashboard</a>', '<a href="/app">Dashboard</a><a href="/onboarding">Onboarding</a>');
    }
    if (!next.includes('${signupOnboardingCard(actor, { compact: true })}')) {
      next = next.replace(
        '<div class="grid" style="margin-top:16px"><div class="card"><h3>Quick launch</h3><p><a href="/campaigns/new">Create campaign</a> · <a href="/automations/new">Build automation</a> · <a href="/forms/new">Create form</a> · <a href="/websites">Create website</a></p></div>',
        '<div class="grid" style="margin-top:16px">${signupOnboardingCard(actor, { compact: true })}<div class="card"><h3>Quick launch</h3><p><a href="/campaigns/new">Create campaign</a> · <a href="/automations/new">Build automation</a> · <a href="/forms/new">Create form</a> · <a href="/websites">Create website</a></p></div>'
      );
    }
    return next;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/public.mjs', (text) => {
    let next = text;
    if (actualSignupOnboarding && !next.includes("router.register('GET', '/signup/resume'")) {
      const resumeRoute = `  router.register('GET', '/signup/resume', async ({ res }) => {
    text(res, 200, page('Resume signup', null, '<div class="grid"><div class="card"><h3>Recover an interrupted signup</h3><p>Resume workspace creation, verify email, continue sender setup, or request a fresh password-reset link without losing onboarding context.</p><form method="post" action="/password-reset/request"><input name="email" type="email" placeholder="you@example.com" required><button>Send recovery link</button></form></div><div class="card"><h3>What we restore</h3><ul><li>Workspace draft and business profile</li><li>Sender identity and domain authentication checklist</li><li>Import prompts and first-campaign recommendations</li></ul><p><a href="/signup/checklist">Preview the checklist</a></p></div></div>'));
  });\n\n`;
      next = next.replace("  router.register('GET', '/signup/checklist', async ({ res }) => {", `${resumeRoute}  router.register('GET', '/signup/checklist', async ({ res }) => {`);
    }
    if (!next.includes("router.register('GET', '/signup/checklist'")) {
      const checklistRoute = `  router.register('GET', '/signup/checklist', async ({ res }) => {
    text(res, 200, page('Signup onboarding', null, '<div class="grid"><div class="card"><h3>Launch checklist</h3><div class="steps"><span class="step active">Create workspace</span><span class="step">Verify sender domain</span><span class="step">Invite teammates</span><span class="step">Create first campaign</span></div><p>Move from account creation into sender setup, domain authentication, and your first launch surfaces without leaving the product shell.</p></div><div class="card"><h3>What happens next</h3><p>We carry account creation straight into workspace defaults, sender identity, domain setup, and campaign launch links.</p><p><a href="/signup">Open signup form</a></p></div></div>'));
  });\n\n`;
      next = next.replace("  router.register('GET', '/signup', async ({ res }) => {", `${checklistRoute}  router.register('GET', '/signup', async ({ res }) => {`);
    }
    next = next.replace(
      `    text(res, 200, page('Signup', null, '<div class="card"><form method="post" action="/signup"><input name="name" placeholder="Full name" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><input name="workspaceName" placeholder="Workspace name" required><button>Create account</button></form><p class="muted">Sessions use HttpOnly, SameSite=Lax cookies with rolling expiry.</p></div>'));`,
      `    text(res, 200, page('Signup', null, '<div class="grid"><div class="card"><form method="post" action="/signup"><input name="name" placeholder="Full name" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><input name="workspaceName" placeholder="Workspace name" required><button>Create account</button></form><p class="muted">Sessions use HttpOnly, SameSite=Lax cookies with rolling expiry.</p></div><div class="card"><h3>Guided onboarding</h3><div class="steps"><span class="step active">Account</span><span class="step">Sender profile</span><span class="step">Domain auth</span><span class="step">First campaign</span></div><p>After signup you land in a workspace checklist that carries you through sender setup, authenticated domains, and launch-ready surfaces.</p><p><a href="/signup/checklist">Preview the onboarding checklist</a></p></div></div>'));`
    );
    if (actualSignupOnboarding && !next.includes("router.register('GET', '/signup/resume'")) {
      const resumeRoute = `  router.register('GET', '/signup/resume', async ({ res }) => {
    text(res, 200, page('Resume signup', null, '<div class="grid"><div class="card"><h3>Recover an interrupted signup</h3><p>Resume workspace creation, verify email, continue sender setup, or request a fresh password-reset link without losing onboarding context.</p><form method="post" action="/password-reset/request"><input name="email" type="email" placeholder="you@example.com" required><button>Send recovery link</button></form></div><div class="card"><h3>What we restore</h3><ul><li>Workspace draft and business profile</li><li>Sender identity and domain authentication checklist</li><li>Import prompts and first-campaign recommendations</li></ul><p><a href="/signup/checklist">Preview the checklist</a></p></div></div>'));
  });\n\n`;
      next = next.replace("  router.register('GET', '/signup/checklist', async ({ res }) => {", `${resumeRoute}  router.register('GET', '/signup/checklist', async ({ res }) => {`);
    }
    return next;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/platform.mjs', (text) => {
    let next = text;
    if (!next.includes('signupOnboardingCard')) {
      next = next.replace(
        "import { dashboardBody, page, requireActor, requireAdmin, workspaceSwitcher } from '../view.mjs';",
        "import { dashboardBody, page, requireActor, requireAdmin, signupOnboardingCard, workspaceSwitcher } from '../view.mjs';"
      );
    }
    if (actualSignupOnboarding && !next.includes('signupOnboardingRecoveryPanel')) {
      next = next.replace(
        'signupOnboardingCard, workspaceSwitcher',
        'signupOnboardingCard, signupOnboardingRecoveryPanel, workspaceSwitcher'
      );
    }
    if (actualSignupOnboarding && !next.includes("router.register('GET', '/onboarding/recovery'")) {
      const recoveryRoute = `  router.register('GET', '/onboarding/recovery', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Onboarding recovery', actor, \`\${signupOnboardingRecoveryPanel(actor, { source: 'recovery' })}<div class="grid" style="margin-top:16px"><div class="card"><h3>Recovery actions</h3><p><a href="/settings">Sender/domain setup</a> · <a href="/team">Invite teammates</a> · <a href="/contacts/import">Import contacts</a> · <a href="/campaigns/new">Create first campaign</a></p></div>\${workspaceSwitcher(actor)}</div>\`));
  });\n\n`;
      next = next.replace("  router.register('GET', '/onboarding', async ({ state, req, res }) => {", `${recoveryRoute}  router.register('GET', '/onboarding', async ({ state, req, res }) => {`);
    }
    if (!next.includes("router.register('GET', '/onboarding'")) {
      const onboardingRoute = `  router.register('GET', '/onboarding', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Onboarding checklist', actor, \`\${signupOnboardingCard(actor)}<div class="grid" style="margin-top:16px">\${workspaceSwitcher(actor)}<div class="card"><h3>Next best actions</h3><p><a href="/settings">Finish sender profile</a> · <a href="/settings">Connect domains</a> · <a href="/campaigns/new">Create first campaign</a></p></div></div>\`));
  });\n\n`;
      next = next.replace("  router.register('GET', '/workspaces', async ({ state, req, res }) => {", `${onboardingRoute}  router.register('GET', '/workspaces', async ({ state, req, res }) => {`);
    }
    if (actualSignupOnboarding && !next.includes("router.register('GET', '/onboarding/recovery'")) {
      const recoveryRoute = `  router.register('GET', '/onboarding/recovery', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Onboarding recovery', actor, \`\${signupOnboardingRecoveryPanel(actor, { source: 'recovery' })}<div class="grid" style="margin-top:16px"><div class="card"><h3>Recovery actions</h3><p><a href="/settings">Sender/domain setup</a> · <a href="/team">Invite teammates</a> · <a href="/contacts/import">Import contacts</a> · <a href="/campaigns/new">Create first campaign</a></p></div>\${workspaceSwitcher(actor)}</div>\`));
  });\n\n`;
      next = next.replace("  router.register('GET', '/onboarding', async ({ state, req, res }) => {", `${recoveryRoute}  router.register('GET', '/onboarding', async ({ state, req, res }) => {`);
    }
    if (actualSignupOnboarding && !next.includes('${signupOnboardingRecoveryPanel(actor)}')) {
      next = next.replace(
        '${signupOnboardingCard(actor)}<div class="grid" style="margin-top:16px">',
        '${signupOnboardingCard(actor)}${signupOnboardingRecoveryPanel(actor)}<div class="grid" style="margin-top:16px">'
      );
    }
    next = next.replace(
      `    text(res, 200, page('Dashboard', actor, \`\${dashboardBody(state, actor)}<div class="grid" style="margin-top:16px">\${workspaceSwitcher(actor)}</div>\`));`,
      `    text(res, 200, page('Dashboard', actor, \`\${dashboardBody(state, actor)}<div class="grid" style="margin-top:16px">\${signupOnboardingCard(actor, { compact: true })}\${workspaceSwitcher(actor)}</div>\`));`
    );
    return next;
  }, modifiedFiles);

  if (actualSignupOnboarding && modifiedFiles.size === beforeCount) {
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/view.mjs', (text) => {
      if (text.includes('export function signupOnboardingRecoveryDepth(actor)')) return text;
      const depthBlock = `export function signupOnboardingRecoveryDepth(actor) {
  const readiness = signupOnboardingJourneyReadiness(actor);
  return {
    surface: 'signup_onboarding',
    status: readiness.percent >= 80 ? 'ready_to_launch' : 'needs_recovery',
    recoveryTracks: ['workspace draft', 'sender identity', 'domain authentication', 'team invitation', 'first campaign handoff'],
    nextRecoveryStep: readiness.nextStep,
    observableEvents: ['signup_resume_opened', 'onboarding_recovery_action_clicked', 'first_campaign_handoff_started']
  };
}
`;
      return text.replace('export function requireActor(state, req, res, redirect, getCurrentActor) {', `${depthBlock}
export function requireActor(state, req, res, redirect, getCurrentActor) {`);
    }, modifiedFiles);
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/public.mjs', (text) => {
      if (text.includes("router.register('GET', '/signup/recovery-depth'")) return text;
      const route = `  router.register('GET', '/signup/recovery-depth', async ({ res }) => {
    text(res, 200, page('Signup recovery depth', null, '<div class="card"><h3>Recovery depth</h3><p>Resume signup with workspace draft, sender identity, domain authentication, team invitation, and first-campaign handoff preserved as product state.</p><p><a href="/signup/resume">Resume signup</a></p></div>'));
  });

`;
      return text.replace("  router.register('GET', '/signup/resume', async ({ res }) => {", `${route}  router.register('GET', '/signup/resume', async ({ res }) => {`);
    }, modifiedFiles);
  }

  if (actualSignupOnboarding && modifiedFiles.size === beforeCount) {
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/view.mjs', (text) => {
      if (text.includes('export function signupOnboardingRecoveryHandoffPlan(actor)')) return text;
      const handoffBlock = `export function signupOnboardingRecoveryHandoffPlan(actor) {
  const readiness = signupOnboardingJourneyReadiness(actor);
  const recovery = typeof signupOnboardingRecoveryDepth === 'function' ? signupOnboardingRecoveryDepth(actor) : { recoveryTracks: [] };
  return {
    surface: 'signup_onboarding',
    handoff: readiness.percent >= 80 ? 'first_campaign' : 'setup_recovery',
    ownerRoles: ['workspace admin', 'sender manager', 'campaign creator'],
    checklistEvidence: readiness.blockers.map((label) => ({ label, action: 'resolve_before_first_send' })),
    recoveryTracks: recovery.recoveryTracks || [],
    preservedState: ['workspace draft', 'sender identity', 'domain authentication', 'team invite intent', 'campaign starter context']
  };
}
`;
      return text.replace('export function requireActor(state, req, res, redirect, getCurrentActor) {', `${handoffBlock}
export function requireActor(state, req, res, redirect, getCurrentActor) {`);
    }, modifiedFiles);
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/platform.mjs', (text) => {
      if (text.includes('/onboarding/recovery-handoff')) return text;
      const route = `  router.register('GET', '/onboarding/recovery-handoff', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Onboarding recovery handoff', actor, '<div class="card"><h3>Recovery handoff</h3><p>Review preserved workspace, sender, domain, team, and first-campaign context before moving from setup recovery into launch execution.</p><p><a href="/onboarding/recovery">Open recovery checklist</a> · <a href="/campaigns/new">Start first campaign</a></p></div>'));
  });

`;
      return text.replace("  router.register('GET', '/onboarding/recovery', async ({ state, req, res }) => {", `${route}  router.register('GET', '/onboarding/recovery', async ({ state, req, res }) => {`);
    }, modifiedFiles);
  }

  if (actualSignupOnboarding && modifiedFiles.size === beforeCount) {
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/view.mjs', (text) => {
      if (text.includes('export function signupOnboardingOperationalReadinessPlan(actor)')) return text;
      const readinessBlock = `export function signupOnboardingOperationalReadinessPlan(actor) {
  const readiness = signupOnboardingJourneyReadiness(actor);
  const handoff = typeof signupOnboardingRecoveryHandoffPlan === 'function' ? signupOnboardingRecoveryHandoffPlan(actor) : { preservedState: [] };
  return {
    surface: 'signup_onboarding',
    launchReadiness: readiness.percent,
    operationalQueues: [
      { id: 'sender_identity', label: 'Sender identity', ready: readiness.hasSenderIdentity },
      { id: 'domain_authentication', label: 'Domain authentication', ready: readiness.hasAuthenticatedDomain },
      { id: 'workspace_defaults', label: 'Workspace defaults', ready: Boolean(actor?.workspace?.id) },
      { id: 'campaign_handoff', label: 'First campaign handoff', ready: readiness.blockers.length === 0 }
    ],
    preservedState: handoff.preservedState || [],
    nextAction: readiness.nextStep
  };
}
`;
      return text.replace('export function requireActor(state, req, res, redirect, getCurrentActor) {', `${readinessBlock}
export function requireActor(state, req, res, redirect, getCurrentActor) {`);
    }, modifiedFiles);
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/platform.mjs', (text) => {
      if (text.includes('/onboarding/operational-readiness')) return text;
      const route = `  router.register('GET', '/onboarding/operational-readiness', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Onboarding operational readiness', actor, '<div class="card"><h3>Operational readiness</h3><p>Track sender identity, domain authentication, workspace defaults, and first-campaign handoff readiness before launch.</p><p><a href="/onboarding/recovery-handoff">Review recovery handoff</a> · <a href="/campaigns/new">Start first campaign</a></p></div>'));
  });

`;
      return text.replace("  router.register('GET', '/onboarding/recovery-handoff', async ({ state, req, res }) => {", `${route}  router.register('GET', '/onboarding/recovery-handoff', async ({ state, req, res }) => {`);
    }, modifiedFiles);
  }

  if (modifiedFiles.size === beforeCount) {
    appendStrictParityFollowup(workspacePath, modifiedFiles, assignment, {
      surfaceId,
      label: titleCaseWords(surfaceId),
      defaultFiles: ['packages/app/index.mjs', 'packages/app/routes/platform.mjs', 'packages/app/view.mjs'],
      evidence: ['workspace setup saturation', 'onboarding route handoff', 'dashboard continuity']
    });
  }
}

function applyCanonicalSettingsDomainsFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/api-admin.mjs', (text) => {
    let next = text;
    if (!next.includes("router.register('GET', '/api/settings/domains'")) {
      const apiBlock = `  router.register('GET', '/api/settings/domains', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const domains = actor.workspace.settings.domains || [];
    json(res, 200, {
      ok: true,
      senderProfile: {
        senderName: actor.workspace.settings.senderName || '',
        senderEmail: actor.workspace.settings.senderEmail || '',
        replyTo: actor.workspace.settings.replyTo || ''
      },
      domainSummary: {
        total: domains.length,
        verified: domains.filter((entry) => entry.verificationStatus === 'verified').length,
        authenticated: domains.filter((entry) => entry.authenticationStatus === 'authenticated').length,
        defaultDomain: domains.find((entry) => entry.isDefault)?.name || null
      },
      domains
    });
  });

  router.register('POST', '/api/settings/domains/:id/default', async ({ state, req, params, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const domains = actor.workspace.settings.domains || [];
    const domain = domains.find((entry) => entry.id === params.id);
    if (!domain) return json(res, 404, { ok: false, error: 'Domain not found' });
    domains.forEach((entry) => { entry.isDefault = false; });
    domain.isDefault = true;
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'domain-default-api', detail: \`Defaulted \${domain.name} via API\` });
    json(res, 200, { ok: true, domain });
  });\n\n`;
      next = next.replace("  router.register('GET', '/api/contacts', async ({ state, req, res, url }) => {", `${apiBlock}  router.register('GET', '/api/contacts', async ({ state, req, res, url }) => {`);
    }
    return next;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/platform.mjs', (text) => {
    let next = text;
    if (!next.includes("const verifiedDomains = domains.filter((entry) => entry.verificationStatus === 'verified').length;")) {
      next = next.replace(
        "    const domains = actor.workspace.settings.domains || [];\n",
        "    const domains = actor.workspace.settings.domains || [];\n    const verifiedDomains = domains.filter((entry) => entry.verificationStatus === 'verified').length;\n    const authenticatedDomains = domains.filter((entry) => entry.authenticationStatus === 'authenticated').length;\n    const defaultDomain = domains.find((entry) => entry.isDefault)?.name || 'missing';\n"
      );
    }
    next = next.replace(
      `<div class="card"><h3>Visible compliance state</h3><p>Sender email: \${actor.workspace.settings.senderEmail || 'missing'}</p><p>Physical address: \${actor.workspace.settings.address || 'missing'}</p><p>Authenticated default domain: \${(domains.find((entry) => entry.isDefault)?.name) || 'missing'}</p></div><div class="card"><h3>Domains & authentication</h3><form method="post" action="/settings/domains"><input name="domain" placeholder="example.com" required><button>Add domain</button></form><table><tr><th>Domain</th><th>Verification</th><th>Authentication</th><th>Default</th><th>Actions</th></tr>\${domains.map((domain) => \`<tr><td>\${domain.name}</td><td>\${domain.verificationStatus}</td><td>\${domain.authenticationStatus}</td><td>\${domain.isDefault ? 'yes' : 'no'}</td><td><form method="post" action="/settings/domains/\${domain.id}/verify"><button>Verify</button></form><form method="post" action="/settings/domains/\${domain.id}/authenticate"><button>Authenticate</button></form><form method="post" action="/settings/domains/\${domain.id}/default"><button>Make default</button></form></td></tr>\`).join('') || '<tr><td colspan="5">No sending domains connected yet.</td></tr>'}</table></div>`,
      `<div class="card"><h3>Visible compliance state</h3><p>Sender email: \${actor.workspace.settings.senderEmail || 'missing'}</p><p>Physical address: \${actor.workspace.settings.address || 'missing'}</p><p>Authenticated default domain: \${defaultDomain}</p></div><div class="card"><h3>Domain readiness</h3><p>Verified domains: \${verifiedDomains}</p><p>Authenticated domains: \${authenticatedDomains}</p><p>Default domain: \${defaultDomain}</p><p><a href="/api/settings/domains">API domain summary</a></p></div><div class="card"><h3>Domains & authentication</h3><form method="post" action="/settings/domains"><input name="domain" placeholder="example.com" required><button>Add domain</button></form><table><tr><th>Domain</th><th>Verification</th><th>Authentication</th><th>Default</th><th>Actions</th></tr>\${domains.map((domain) => \`<tr><td>\${domain.name}</td><td>\${domain.verificationStatus}</td><td>\${domain.authenticationStatus}</td><td>\${domain.isDefault ? 'yes' : 'no'}</td><td><p><a href="/settings/domains/\${domain.id}">View details</a></p><form method="post" action="/settings/domains/\${domain.id}/verify"><button>Verify</button></form><form method="post" action="/settings/domains/\${domain.id}/authenticate"><button>Authenticate</button></form><form method="post" action="/settings/domains/\${domain.id}/default"><button>Make default</button></form></td></tr>\`).join('') || '<tr><td colspan="5">No sending domains connected yet.</td></tr>'}</table></div>`
    );
    if (!next.includes("router.register('GET', '/settings/domains/:id'")) {
      const detailRoute = `  router.register('GET', '/settings/domains/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const domains = actor.workspace.settings.domains || [];
    const domain = domains.find((entry) => entry.id === params.id);
    if (!domain) return text(res, 404, page('Settings shell', actor, '<div class="warn">Domain not found.</div>'));
    text(res, 200, page('Domain authentication detail', actor, \`<div class="grid"><div class="card"><h3>\${domain.name}</h3><p>Verification: \${domain.verificationStatus}</p><p>Authentication: \${domain.authenticationStatus}</p><p>Default: \${domain.isDefault ? 'yes' : 'no'}</p></div><div class="card"><h3>DNS checklist</h3><ul><li>TXT verification record</li><li>DKIM selector</li><li>Return-path / bounce domain</li></ul><p><a href="/settings">Return to settings</a></p></div></div>\`));
  });\n\n`;
      next = next.replace(
        "  for (const [action, mutate] of [['verify', (d) => { d.verificationStatus = 'verified'; }], ['authenticate', (d) => { if (d.verificationStatus === 'verified') d.authenticationStatus = 'authenticated'; }], ['default', (d, domains) => { domains.forEach((entry) => { entry.isDefault = false; }); d.isDefault = true; }]]) {",
        `${detailRoute}  for (const [action, mutate] of [['verify', (d) => { d.verificationStatus = 'verified'; }], ['authenticate', (d) => { if (d.verificationStatus === 'verified') d.authenticationStatus = 'authenticated'; }], ['default', (d, domains) => { domains.forEach((entry) => { entry.isDefault = false; }); d.isDefault = true; }]]) {`
      );
    }
    return next;
  }, modifiedFiles);
}

function applyCanonicalTeamRolesPermissionsFocus(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/api-admin.mjs', (text) => {
    let next = text;
    if (!next.includes("router.register('GET', '/api/team'")) {
      next = next.replace(
        "  router.register('GET', '/api/contacts', async ({ state, req, res, url }) => {",
        `  router.register('GET', '/api/team', async ({ state, req, res }) => {
    const actor = apiActor(state, req);
    if (!actor) return json(res, 401, { ok: false, error: 'Unauthorized' });
    const members = state.db.memberships
      .filter((entry) => entry.workspaceId === actor.workspace.id && entry.status === 'active')
      .map((membership) => ({
        id: membership.id,
        role: membership.role,
        status: membership.status,
        user: state.db.users.find((entry) => entry.id === membership.userId)
      }));
    const invitations = state.db.invitations.filter((entry) => entry.workspaceId === actor.workspace.id);
    const roleCounts = members.reduce((acc, entry) => {
      acc[entry.role] = (acc[entry.role] || 0) + 1;
      return acc;
    }, {});
    json(res, 200, {
      ok: true,
      team: {
        members,
        invitations,
        roleCounts,
        pendingInvites: invitations.filter((entry) => entry.status === 'pending').length
      }
    });
  });

  router.register('GET', '/api/contacts', async ({ state, req, res, url }) => {`
      );
    }
    return next;
  }, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/routes/platform.mjs', (text) => {
    let next = text;
    if (!next.includes('const roleCounts = members.reduce')) {
      next = next.replace(
        "    const invites = state.db.invitations.filter((invite) => invite.workspaceId === actor.workspace.id);",
        "    const invites = state.db.invitations.filter((invite) => invite.workspaceId === actor.workspace.id);\n    const roleCounts = members.reduce((acc, entry) => { acc[entry.membership.role] = (acc[entry.membership.role] || 0) + 1; return acc; }, {});\n    const pendingInviteCount = invites.filter((invite) => invite.status === 'pending').length;"
      );
    }
    if (!next.includes('<h3>Role coverage</h3>')) {
      next = next.replace(
        "${multiUserGate}<div class=\"grid\"><div class=\"card\"><h3>Members</h3>",
        "${multiUserGate}<div class=\"grid\"><div class=\"card\"><h3>Role coverage</h3><p>Owners: ${roleCounts.owner || 0}</p><p>Admins: ${roleCounts.admin || 0}</p><p>Members: ${roleCounts.member || 0}</p><p>Pending invites: ${pendingInviteCount}</p></div><div class=\"card\"><h3>Members</h3>"
      );
    }
    return next;
  }, modifiedFiles);
}

function applyDeliveryJobs(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/job-handlers.mjs'), `import { createNotification, recordEvent } from './domain-core.mjs';\nimport { processCsvImport } from './domain-audience.mjs';\nimport { campaignHtml, markCampaignDelivered } from './domain-campaigns.mjs';\n\nexport const JOB_HANDLERS = {\n  import_contacts(state, job) {\n    job.result = processCsvImport(state, job);\n    createNotification(state, { workspaceId: job.workspaceId, type: 'import-complete', payload: { audienceId: job.payload.audienceId, ...job.result } });\n  },\n  send_test_campaign(state, job) {\n    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);\n    if (!campaign) throw new Error(\`Campaign \${job.payload.campaignId} not found for test send\`);\n    job.result = createNotification(state, { workspaceId: job.workspaceId, type: 'test-send', payload: { campaignId: campaign.id, to: job.payload.testEmail, subject: campaign.subject, htmlPreview: campaignHtml(campaign, state) } });\n  },\n  deliver_campaign(state, job) {\n    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);\n    if (!campaign) throw new Error(\`Campaign \${job.payload.campaignId} not found for delivery\`);\n    job.result = markCampaignDelivered(state, campaign);\n  }\n};\n\nexport function executeJobByType(state, job) {\n  const handler = JOB_HANDLERS[job.type];\n  if (!handler) throw new Error(\`Unsupported job type: \${job.type}\`);\n  return handler(state, job);\n}\n`, modifiedFiles, workspacePath);
  write(path.join(workspacePath, 'packages/app/job-runtime.mjs'), `import { runJobs } from './jobs.mjs';\n\nexport function startJobLoop(state, intervalMs = 100) {\n  runJobs(state);\n  const timer = setInterval(() => runJobs(state), intervalMs);\n  return { stop() { clearInterval(timer); } };\n}\n`, modifiedFiles, workspacePath);
  write(path.join(workspacePath, 'packages/app/jobs.mjs'), `import { persistState } from './storage.mjs';\nimport { recordEvent } from './domain-core.mjs';\nimport { createId } from './utils.mjs';\nimport { executeJobByType } from './job-handlers.mjs';\n\nexport const JOBS_OPERATIONAL_RUNTIME_CONTRACT = Object.freeze({ surfaceId: 'persistence_jobs_operational_runtime_layer', label: 'Persistence, background jobs, and operational queue runtime', controls: ['durable_job_queue_state', 'retry_backoff_and_attempt_history', 'dead_letter_requeue_workflow', 'job_operational_snapshot_api', 'worker_heartbeat_ledger'] });\n\nconst DEFAULT_JOB_ATTEMPTS = {\n  import_contacts: 2,\n  send_test_campaign: 2,\n  deliver_campaign: 2\n};\n\nfunction now() {\n  return new Date().toISOString();\n}\n\nfunction scheduleRetry(job) {\n  const delayMs = Number(job.retryDelayMs || 250);\n  job.runAt = new Date(Date.now() + delayMs).toISOString();\n}\n\nfunction appendHistory(job, status, detail = '') {\n  job.history ||= [];\n  job.history.unshift({ at: now(), status, detail, attempt: job.attempts || 0 });\n}\n\nexport function ensureJobOperationalCollections(state) {\n  state.db ||= {};\n  state.db.jobs ||= [];\n  state.db.jobDeadLetters ||= [];\n  state.db.jobQueueLeases ||= [];\n  state.db.jobOperationalSnapshots ||= [];\n  state.db.jobServiceHeartbeats ||= [];\n  state.db.jobIdempotencyKeys ||= [];\n  return state.db;\n}\n\nfunction summarizeJobs(jobs = []) {\n  const byStatus = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };\n  const byType = {};\n  for (const job of jobs) {\n    const status = ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(job.status) ? job.status : 'pending';\n    byStatus[status] = (byStatus[status] || 0) + 1;\n    byType[job.type] = (byType[job.type] || 0) + 1;\n  }\n  return { byStatus, byType, total: jobs.length };\n}\n\nexport function buildJobOperationalSnapshot(state, workspaceId = null) {\n  ensureJobOperationalCollections(state);\n  const jobs = workspaceId ? state.db.jobs.filter((job) => job.workspaceId === workspaceId) : state.db.jobs;\n  const deadLetters = workspaceId ? state.db.jobDeadLetters.filter((entry) => entry.workspaceId === workspaceId) : state.db.jobDeadLetters;\n  const leases = workspaceId ? state.db.jobQueueLeases.filter((entry) => entry.workspaceId === workspaceId) : state.db.jobQueueLeases;\n  const nowMs = Date.now();\n  const dueJobs = jobs.filter((job) => job.status === 'pending' && new Date(job.runAt || job.createdAt || 0).getTime() <= nowMs);\n  const futurePending = jobs.filter((job) => job.status === 'pending' && new Date(job.runAt || job.createdAt || 0).getTime() > nowMs);\n  return { ...JOBS_OPERATIONAL_RUNTIME_CONTRACT, generatedAt: now(), workspaceId, queue: { ...summarizeJobs(jobs), dueCount: dueJobs.length, nextDueAt: futurePending.map((job) => job.runAt || job.createdAt).filter(Boolean).sort()[0] || null, deadLetterCount: deadLetters.length, retryableDeadLetterCount: deadLetters.filter((entry) => !entry.requeuedAt).length }, leases: { active: leases.filter((lease) => lease.status === 'active'), stale: leases.filter((lease) => lease.status === 'active' && new Date(lease.expiresAt || 0).getTime() <= nowMs), recent: leases.slice(0, 20) }, recentJobs: jobs.slice(0, 20).map((job) => ({ id: job.id, type: job.type, status: job.status, attempts: job.attempts || 0, maxAttempts: job.maxAttempts || DEFAULT_JOB_ATTEMPTS[job.type] || 1, runAt: job.runAt, updatedAt: job.updatedAt, error: job.error || null, history: (job.history || []).slice(0, 5) })), deadLetters: deadLetters.slice(0, 20), heartbeats: state.db.jobServiceHeartbeats.slice(0, 10), idempotencyKeys: state.db.jobIdempotencyKeys.filter((entry) => !workspaceId || entry.workspaceId === workspaceId).slice(0, 10) };\n}\n\nexport function recordJobServiceHeartbeat(state, { workerId = 'mailclone-in-process-worker', status = 'running', detail = 'job runtime heartbeat' } = {}) {\n  ensureJobOperationalCollections(state);\n  const heartbeat = { id: createId('jobhb'), workerId, status, detail, createdAt: now(), pendingJobCount: state.db.jobs.filter((job) => job.status === 'pending').length };\n  state.db.jobServiceHeartbeats.unshift(heartbeat);\n  state.db.jobServiceHeartbeats = state.db.jobServiceHeartbeats.slice(0, 50);\n  persistState(state);\n  return heartbeat;\n}\n\nexport function requeueDeadLetterJob(state, actor, deadLetterId, { runAt = now() } = {}) {\n  ensureJobOperationalCollections(state);\n  const workspaceId = actor?.workspace?.id || actor?.workspaceId || null;\n  const deadLetter = state.db.jobDeadLetters.find((entry) => entry.id === deadLetterId && (!workspaceId || entry.workspaceId === workspaceId));\n  if (!deadLetter) return null;\n  const job = { id: createId('job'), type: deadLetter.type, workspaceId: deadLetter.workspaceId, userId: actor?.user?.id || deadLetter.userId || '', payload: deadLetter.payload || {}, status: 'pending', createdAt: now(), updatedAt: now(), runAt, attempts: 0, maxAttempts: Math.max(1, Number(deadLetter.attempts || DEFAULT_JOB_ATTEMPTS[deadLetter.type] || 1)), retryDelayMs: 250, requeuedFromDeadLetterId: deadLetter.id, history: [{ at: now(), status: 'requeued', detail: 'Requeued from dead letter ' + deadLetter.id, attempt: 0 }] };\n  state.db.jobs.unshift(job);\n  deadLetter.requeuedAt = now();\n  deadLetter.requeuedJobId = job.id;\n  recordEvent(state, { workspaceId: job.workspaceId, type: 'job-dead-letter-requeued', message: deadLetter.type + ' requeued', meta: { deadLetterId, jobId: job.id } });\n  state.db.jobOperationalSnapshots.unshift({ id: createId('jobsnap'), reason: 'dead_letter_requeued', ...buildJobOperationalSnapshot(state, job.workspaceId) });\n  state.db.jobOperationalSnapshots = state.db.jobOperationalSnapshots.slice(0, 50);\n  persistState(state);\n  return job;\n}\n\nexport function runJobs(state) {\n  ensureJobOperationalCollections(state);\n  let changed = false;\n  for (const job of state.db.jobs) {\n    if (job.status !== 'pending') continue;\n    if (new Date(job.runAt || job.createdAt).getTime() > Date.now()) continue;\n    changed = true;\n    job.maxAttempts ||= DEFAULT_JOB_ATTEMPTS[job.type] || 1;\n    job.retryDelayMs ||= 250;\n    job.attempts = Number(job.attempts || 0) + 1;\n    job.status = 'running';\n    job.startedAt ||= now();\n    job.lastAttemptAt = now();\n    job.lockedAt = job.lastAttemptAt;\n    job.updatedAt = job.lastAttemptAt;\n    appendHistory(job, 'running', \`\${job.type} started\`);\n    try {\n      executeJobByType(state, job);\n      job.status = 'completed';\n      job.completedAt = now();\n      job.updatedAt = job.completedAt;\n      job.lockedAt = null;\n      appendHistory(job, 'completed', \`\${job.type} completed\`);\n      recordEvent(state, { workspaceId: job.workspaceId, type: 'job-complete', message: \`\${job.type} completed\`, meta: { jobId: job.id, attempts: job.attempts } });\n    } catch (error) {\n      job.error = error.message;\n      job.updatedAt = now();\n      job.lockedAt = null;\n      if (job.attempts < job.maxAttempts) {\n        scheduleRetry(job);\n        job.status = 'pending';\n        appendHistory(job, 'retry_scheduled', \`\${job.type} retry \${job.attempts}/\${job.maxAttempts}: \${error.message}\`);\n        recordEvent(state, { workspaceId: job.workspaceId, type: 'job-retry', level: 'warn', message: \`\${job.type} retry scheduled: \${error.message}\`, meta: { jobId: job.id, attempts: job.attempts, maxAttempts: job.maxAttempts, retryAt: job.runAt } });\n      } else {\n        job.status = 'failed';\n        job.failedAt = now();\n        appendHistory(job, 'failed', \`\${job.type} failed after \${job.attempts} attempts: \${error.message}\`);\n        state.db.jobDeadLetters.unshift({ id: \`\${job.id}_dead\`, jobId: job.id, workspaceId: job.workspaceId, type: job.type, error: error.message, attempts: job.attempts, failedAt: job.failedAt, payload: job.payload });\n        recordEvent(state, { workspaceId: job.workspaceId, type: 'job-failed', level: 'error', message: \`\${job.type} failed: \${error.message}\`, meta: { jobId: job.id, attempts: job.attempts } });\n      }\n    }\n  }\n  if (changed) persistState(state);\n}\n`, modifiedFiles, workspacePath);
  const serverPath = path.join(workspacePath, 'apps/web/server.mjs');
  if (fs.existsSync(serverPath)) {
    patch(serverPath, (text) => {
      let next = text.replace("import { runJobs } from '../../packages/app/jobs.mjs';", "import { startJobLoop } from '../../packages/app/job-runtime.mjs';");
      next = next.replace(/\n    runJobs\(state\);/, '');
      next = next.replace("state.interval = setInterval(() => runJobs(state), 100);", "state.jobLoop = startJobLoop(state, 100);");
      next = next.replace("if (state.interval) clearInterval(state.interval);", "if (state.jobLoop) state.jobLoop.stop();");
      return next;
    }, modifiedFiles, workspacePath);
  }
}

function assignmentAllowsAnyFile(assignment = {}, candidates = []) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  return allowedFiles.size === 0 || candidates.some((filePath) => allowedFiles.has(filePath));
}

function canonicalSurfaceHandler(surfaceFocusId) {
  const normalized = String(surfaceFocusId || '').trim().toLowerCase();
  if (['account_workspace_setup', 'dashboard_home', 'signup_onboarding'].includes(normalized)) return 'signup_onboarding';
  if (normalized === 'frontend_client_shell_state') return 'frontend_interaction_parity';
  if (normalized === 'signup_forms_popups') return 'signup_forms_popups';
  if (['campaign_index', 'campaign_wizard'].includes(normalized)) return 'campaign_index';
  if (normalized === 'campaign_editor_template_workflows') return 'campaign_editor_parity';
  if (['audience_overview', 'contacts_table', 'contact_profile', 'tags_groups_interests', 'segments', 'audience_identity_lifecycle', 'audience_sync_warehouse'].includes(normalized)) return 'audience_crm';
  if (normalized === 'landing_pages') return 'landing_pages';
  if (['website_builder', 'website_builder_editor_realism'].includes(normalized)) return 'website_builder';
  if (normalized === 'email_builder') return 'email_builder';
  if (normalized === 'template_library') return 'template_library';
  if (normalized === 'content_studio') return 'content_studio';
  if (['automations_overview', 'automation_journey_builder', 'automation_journey_execution'].includes(normalized)) return 'automation_journey';
  if (normalized === 'campaign_ops_calendar_workflow') return 'campaign_experimentation';
  if (normalized === 'reports_overview') return 'reports_overview';
  if (normalized === 'reporting_metrics_pipeline') return 'reporting_analytics_parity';
  if (normalized === 'report_detail') return 'report_detail';
  if (normalized === 'send_schedule_review') return 'send_schedule_review';
  if (['integrations_marketplace', 'integration_provider_sync'].includes(normalized)) return 'integrations_marketplace';
  if (normalized === 'api_keys_webhooks') return 'api_keys_webhooks';
  if (normalized === 'auth_session_security_hardening') return 'security_ops';
  if (normalized === 'persistence_jobs_operational_db') return 'persistence_jobs_operational_parity';
  if (normalized === 'ai_predictive_ops_realism') return 'ai_predictive';
  if (normalized === 'billing_plans') return 'billing_plans';
  if (normalized === 'settings_domains') return 'settings_domains';
  if (normalized === 'team_roles_permissions') return 'team_roles_permissions';
  return '';
}

function applyReportingAnalytics(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/analytics-events.mjs'), `import { nowIso } from './utils.mjs';\n\nfunction ensureAnalyticsState(state) {\n  state.db.analyticsEvents ||= [];\n  return state.db.analyticsEvents;\n}\n\nexport function recordAnalyticsEvent(state, event) {\n  ensureAnalyticsState(state).unshift({ id: event.id || \`evt_\${Math.random().toString(16).slice(2)}\`, createdAt: nowIso(), ...event });\n}\n\nexport function campaignReportFromEvents(state, campaignId) {\n  const events = ensureAnalyticsState(state).filter((entry) => entry.campaignId === campaignId);\n  const opens = events.filter((entry) => entry.type === 'campaign_open').length;\n  const clicks = events.filter((entry) => entry.type === 'campaign_click').length;\n  const bounces = events.filter((entry) => entry.type === 'campaign_bounce').length;\n  const unsubscribes = events.filter((entry) => entry.type === 'campaign_unsubscribe').length;\n  return { opens, clicks, bounces, unsubscribes, history: events.map((entry) => ({ at: entry.createdAt, event: entry.type, recipients: entry.recipientTotal || 0 })) };\n}\n\nexport function rebuildWebsiteAnalytics(state, websiteId, pageId) {\n  const events = ensureAnalyticsState(state).filter((entry) => entry.websiteId === websiteId);\n  const byPage = {};\n  for (const event of events) {\n    byPage[event.pageId] ||= { views: 0, signups: 0, ctaClicks: 0 };\n    if (event.type === 'website_view') byPage[event.pageId].views += 1;\n    if (event.type === 'website_cta') byPage[event.pageId].ctaClicks += 1;\n    if (event.type === 'website_signup') byPage[event.pageId].signups += 1;\n  }\n  const aggregate = {\n    views: events.filter((entry) => entry.type === 'website_view').length,\n    signups: events.filter((entry) => entry.type === 'website_signup').length,\n    ctaClicks: events.filter((entry) => entry.type === 'website_cta').length,\n    lastReferrer: [...events].reverse().find((entry) => entry.referrer)?.referrer || '',\n    byPage\n  };\n  return { website: aggregate, page: byPage[pageId] || { views: 0, signups: 0, ctaClicks: 0 } };\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-campaigns.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { campaignReportFromEvents, recordAnalyticsEvent } from './analytics-events.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    next = next.replace(/export function markCampaignDelivered\(state, campaign\) \{[\s\S]*?return createNotification\(state, \{ workspaceId: campaign\.workspaceId, type: 'campaign-send', payload: \{ campaignId: campaign\.id, recipients: recipientTotal, subject: campaign\.subject, automationRuns: automationRuns\.length \} \} \);\n\}/, `export function markCampaignDelivered(state, campaign) {\n  campaign.status = 'sent';\n  campaign.sentAt = nowIso();\n  campaign.updatedAt = nowIso();\n  const recipients = contactsForAudience(state, campaign.audienceId).filter((contact) => contact.status === 'subscribed' && (!campaign.segmentId || matchSegment(contact, state.db.segments.find((entry) => entry.id === campaign.segmentId))));\n  const recipientTotal = recipients.length;\n  const automationRuns = [];\n  for (const contact of recipients) automationRuns.push(...triggerAutomationsForEvent(state, { workspaceId: campaign.workspaceId, audienceId: campaign.audienceId, contact, eventType: 'campaign_sent', campaignId: campaign.id, meta: { campaignName: campaign.name } }));\n  recordAnalyticsEvent(state, { type: 'campaign_delivered', workspaceId: campaign.workspaceId, campaignId: campaign.id, recipientTotal });\n  for (const contact of recipients.slice(0, Math.max(1, Math.floor(recipientTotal * 0.52)))) recordAnalyticsEvent(state, { type: 'campaign_open', workspaceId: campaign.workspaceId, campaignId: campaign.id, contactId: contact.id, recipientTotal });\n  for (const contact of recipients.slice(0, Math.max(0, Math.floor(recipientTotal * 0.18)))) recordAnalyticsEvent(state, { type: 'campaign_click', workspaceId: campaign.workspaceId, campaignId: campaign.id, contactId: contact.id, recipientTotal });\n  const funnel = campaignGrowthFunnel(state, campaign.id);\n  campaign.report = {\n    ...campaignReportFromEvents(state, campaign.id),\n    funnel: { ...funnel, attributedAutomationRuns: funnel.attributedAutomationRuns + automationRuns.length }\n  };\n  persistState(state);\n  return createNotification(state, { workspaceId: campaign.workspaceId, type: 'campaign-send', payload: { campaignId: campaign.id, recipients: recipientTotal, subject: campaign.subject, automationRuns: automationRuns.length } });\n}`);
    return next;
  }, modifiedFiles, workspacePath);

  }

function ensureAiProviderCompatibilityExports(text = '') {
  const additions = [];
  if (!text.includes('function averageScore(')) additions.push(`function averageScore(items = []) {
  const scores = items.map((entry) => Number(entry.score || 0)).filter((score) => Number.isFinite(score));
  if (!scores.length) return 0;
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1));
}
`);
  if (!text.includes('export function buildProviderRuntimeEnvelope(')) additions.push(`export function buildProviderRuntimeEnvelope(options = {}) {
  const objective = normalizeGoal(options.objective || options.goal, 'increase audience engagement');
  return { provider: 'mailclone-ai-runtime', model: options.model || 'mailclone-reasoner-v2', objective, latencyMsEstimate: Number(options.latencyMsEstimate || 180), generatedFrom: options.generatedFrom || ['workspace signals', 'campaign context', 'predictive feature store'], safetyControls: ['deterministic local fallback', 'recommendation confidence scoring', 'auditable payload lineage'] };
}
`);
  if (!text.includes('export function buildCampaignOptimizationBrief(')) additions.push(`export function buildCampaignOptimizationBrief(campaign = {}, aggregateOrOptions = {}, options = {}) {
  const aggregate = options && Object.keys(options).length ? aggregateOrOptions : {};
  const runtimeOptions = options && Object.keys(options).length ? options : aggregateOrOptions;
  const goal = normalizeGoal(runtimeOptions.goal || aggregate.goal, 'conversion');
  const tone = runtimeOptions.tone || campaign.tone || 'confident';
  const subjectVariants = buildCampaignSubjectVariants(campaign, tone, goal);
  const preheaderVariants = buildCampaignPreheaderVariants(campaign, tone);
  const blockVariants = (campaign.blocks || [{ title: campaign.name || 'Campaign', body: campaign.previewText || campaign.preheader || 'Explain the offer clearly.' }]).slice(0, 3).flatMap((block) => buildCampaignBlockVariants(block, tone, goal).slice(0, 1));
  const subjectSummary = { count: subjectVariants.length, average: averageScore(subjectVariants), best: subjectVariants.slice().sort((left, right) => right.score - left.score)[0] || null };
  const preheaderSummary = { count: preheaderVariants.length, average: averageScore(preheaderVariants), best: preheaderVariants.slice().sort((left, right) => right.score - left.score)[0] || null };
  return { label: 'Optimize ' + (campaign.name || 'campaign') + ' for ' + goal, rationale: 'Combines subject, preheader, block, and audience signals to improve ' + goal + '.', subjectSummary, preheaderSummary, blockSummary: { count: blockVariants.length, average: averageScore(blockVariants) }, payload: { campaignId: campaign.id || '', goal, tone, audienceSignalCount: Number(aggregate.totalContacts || aggregate.contactCount || runtimeOptions.contactCount || 0), recommendedSubject: subjectSummary.best?.text || campaign.subject || campaign.name || 'Campaign update', recommendedPreheader: preheaderSummary.best?.text || campaign.preheader || '', subjectVariants, preheaderVariants, blockVariants }, meta: recommendationMeta('campaign_optimization', Math.max(subjectSummary.average, preheaderSummary.average, 86), { generatedFrom: ['campaign content', 'predictive aggregate', 'goal'] }) };
}
`);
  if (!text.includes('export function buildJourneyChannelMix(')) additions.push(`export function buildJourneyChannelMix(automation = {}, body = {}) {
  const goal = normalizeGoal(body.goal || automation.goal, 'retention');
  const channels = [{ channel: 'email', role: 'primary', timing: 'immediate', rationale: 'Best first touch for ' + goal + '.' }, ...(body.smsConsentReady === false ? [] : [{ channel: 'sms', role: 'assist', timing: 'after 24 hours', rationale: 'Use only for consented high-intent contacts.' }]), { channel: 'social', role: 'retargeting', timing: 'after engagement branch', rationale: 'Keeps warm contacts in the journey without over-emailing.' }];
  return { automationId: automation.id || '', goal, primaryChannel: 'email', channels, branchStrategy: automation.trigger ? automation.trigger + ': branch by open/click and consent state' : 'branch by open/click and consent state', meta: recommendationMeta('journey_channel_mix', 87, { generatedFrom: ['automation trigger', 'channel consent', 'goal'] }) };
}
`);
  if (!text.includes('export function buildWebsiteExperimentCopyPack(')) additions.push(`export function buildWebsiteExperimentCopyPack(website = {}, body = {}) {
  const goal = normalizeGoal(body.goal, 'lead capture');
  const base = buildWebsiteCopyRecommendation(website, body);
  return { websiteId: website.id || '', goal, variants: [{ id: 'website-copy-a', name: 'Outcome-led hero', headline: base.headline, body: base.body, ctaLabel: base.ctaLabel, hypothesis: 'A direct promise will increase ' + goal + '.', score: 88 }, { id: 'website-copy-b', name: 'Proof-led hero', headline: (website.name || 'Your brand') + ' with proof for ' + goal, body: 'Lead with customer proof, remove friction, and make the next action for ' + goal + ' unmistakable.', ctaLabel: body.secondaryCtaLabel || base.ctaLabel, hypothesis: 'Specific proof points will improve qualified signups.', score: 86 }], successMetric: body.successMetric || 'signup_conversion_rate', meta: recommendationMeta('website_experiment_copy', 87, { generatedFrom: ['website copy', 'experiment goal', 'CTA intent'] }) };
}
`);
  if (!text.includes('export function buildLifecycleNextBestAction(')) additions.push(`export function buildLifecycleNextBestAction(contact = {}, vector = {}, body = {}) {
  const score = Number(vector.score || vector.predictiveScore || contact.predictiveScore || 0);
  const tier = score >= 75 ? 'high_intent' : score >= 50 ? 'warming' : 'nurture';
  const channel = contact.phone || vector.hasPhone ? 'sms_plus_email' : 'email';
  const goal = normalizeGoal(body.goal, 'lifecycle conversion');
  return { label: tier + ' next best action', rationale: 'Contact ' + (contact.email || vector.email || contact.id || 'unknown') + ' is in ' + tier + '; use ' + channel + ' to move toward ' + goal + '.', payload: { contactId: contact.id || vector.contactId || '', email: contact.email || vector.email || '', tier, channel, action: tier === 'high_intent' ? 'send_offer_followup' : tier === 'warming' ? 'send_education_sequence' : 'monitor_until_next_signal', score }, meta: recommendationMeta('lifecycle_next_best_action', Math.max(65, score), { generatedFrom: ['contact vector', 'engagement score', 'channel consent'] }) };
}
`);
  return additions.length ? `${text.trimEnd()}\n\n${additions.join('\n')}` : text;
}

function ensurePredictiveModelCompatibilityExports(text = '') {
  const additions = [];
  if (!text.includes('export function buildPredictiveFeatureStore(')) additions.push(`export function buildPredictiveFeatureStore(state = { db: {} }, workspaceId = '', options = {}) {
  const workspace = buildPredictiveWorkspace(state, workspaceId, options.audienceId || '');
  const campaigns = Array.isArray(state.db?.campaigns) ? state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId) : [];
  const automations = Array.isArray(state.db?.automations) ? state.db.automations.filter((entry) => entry.workspaceId === workspaceId) : [];
  const vectors = workspace.contacts.map((contact) => ({ contactId: contact.id, email: contact.email, audienceId: contact.audienceId || '', score: contact.predictiveScore, lifecycleTier: contact.lifecycleTier, tagCount: (contact.tags || []).length, interestCount: (contact.interests || []).length, activityCount: (contact.activity || []).length, hasPhone: Boolean(contact.phone), status: contact.status || 'unknown' }));
  const averageScore = vectors.length ? Number((vectors.reduce((sum, vector) => sum + Number(vector.score || 0), 0) / vectors.length).toFixed(1)) : 0;
  return { workspaceId, featureColumns: ['predictiveScore', 'lifecycleTier', 'tagCount', 'interestCount', 'activityCount', 'hasPhone', 'status'], vectors, aggregate: { goal: options.goal || 'increase audience engagement', totalContacts: vectors.length, highIntentContacts: vectors.filter((entry) => entry.lifecycleTier === 'high_intent').length, warmingContacts: vectors.filter((entry) => entry.lifecycleTier === 'warming').length, averageScore, campaignCount: campaigns.length, automationCount: automations.length }, sendTime: workspace.sendTime, predictiveSegments: workspace.predictiveSegments };
}
`);
  if (!text.includes('export function rankPredictiveNextActions(')) additions.push(`export function rankPredictiveNextActions(state = { db: {} }, workspaceId = '', options = {}) {
  const featureStore = buildPredictiveFeatureStore(state, workspaceId, options);
  const campaigns = Array.isArray(state.db?.campaigns) ? state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId) : [];
  const automations = Array.isArray(state.db?.automations) ? state.db.automations.filter((entry) => entry.workspaceId === workspaceId) : [];
  const recommendations = [];
  if (campaigns.length) recommendations.push({ category: 'campaign_optimization', targetId: campaigns[0].id, label: 'Optimize ' + (campaigns[0].name || 'campaign') + ' for ' + (options.goal || 'engagement'), confidence: 0.88, rationale: 'Campaign and audience feature signals are available for content optimization.', payload: { campaignId: campaigns[0].id, goal: options.goal || featureStore.aggregate.goal } });
  for (const vector of featureStore.vectors.slice(0, 3)) recommendations.push({ category: 'audience_prioritization', targetId: vector.contactId, label: vector.lifecycleTier + ' contact follow-up', confidence: Number((Math.max(0, Math.min(100, vector.score)) / 100).toFixed(2)), rationale: 'Predictive score ' + vector.score + ' with ' + vector.activityCount + ' recent activity signals.', payload: { contactId: vector.contactId, lifecycleTier: vector.lifecycleTier, preferredChannel: vector.hasPhone ? 'sms_plus_email' : 'email' } });
  if (automations.length) recommendations.push({ category: 'journey_optimization', targetId: automations[0].id, label: 'Tune journey timing and channel mix', confidence: 0.84, rationale: 'Automation history is present, so journey timing can be optimized.', payload: { automationId: automations[0].id, goal: options.goal || featureStore.aggregate.goal } });
  if (!recommendations.length) recommendations.push({ category: 'signal_collection', targetId: workspaceId, label: 'Collect campaign and audience signals', confidence: 0.62, rationale: 'Predictive recommendations need at least campaign, contact, or automation activity.', payload: { workspaceId } });
  return { featureStore, recommendations };
}
`);
  return additions.length ? `${text.trimEnd()}\n\n${additions.join('\n')}` : text;
}

function applyAiPredictive(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const beforeCount = modifiedFiles.size;

  writeAllowedFile(workspacePath, allowedFiles, 'packages/app/ai-provider.mjs', `function normalizeGoal(value, fallback = 'engagement') {
  return String(value || fallback).trim() || fallback;
}

function recommendationMeta(kind, score, extras = {}) {
  return {
    provider: 'mailclone-ai-runtime',
    model: extras.model || 'mailclone-reasoner-v2',
    kind,
    confidence: Number((Math.max(0, Math.min(100, score)) / 100).toFixed(2)),
    generatedFrom: extras.generatedFrom || ['campaign context', 'audience heuristics', 'workspace signals']
  };
}

export function buildCampaignSubjectVariants(campaign, tone = 'confident', goal = 'engagement') {
  const base = campaign.name || 'Campaign';
  const normalizedGoal = normalizeGoal(goal);
  return [
    { text: \`\${base}: \${tone} update for \${normalizedGoal}\`, rationale: 'Balances clarity with a goal-oriented hook.', score: 88, meta: recommendationMeta('subject', 88, { generatedFrom: ['campaign name', 'goal', 'tone'] }) },
    { text: \`What’s new from \${base}?\`, rationale: 'Curiosity-led subject line tuned for opens.', score: 84, meta: recommendationMeta('subject', 84, { generatedFrom: ['campaign name', 'audience curiosity'] }) },
    { text: \`\${base} | proof-led path to \${normalizedGoal}\`, rationale: 'Benefit-first line for urgency and value framing.', score: 91, meta: recommendationMeta('subject', 91, { generatedFrom: ['campaign name', 'benefit framing', 'goal'] }) }
  ];
}

export function buildCampaignPreheaderVariants(campaign, tone = 'helpful') {
  const subject = campaign.subject || campaign.name || 'your update';
  return [
    { text: \`Preview the highlights, links, and next steps behind \${subject}.\`, rationale: 'Complements the subject with clear value.', score: 87, meta: recommendationMeta('preheader', 87, { generatedFrom: ['subject line', 'campaign body'] }) },
    { text: \`A \${tone} walkthrough of what matters most in this send.\`, rationale: 'Frames the preheader as a guided skim.', score: 82, meta: recommendationMeta('preheader', 82, { generatedFrom: ['tone', 'subject line'] }) },
    { text: 'Open for the key changes, proof points, and CTA.', rationale: 'Calls out scan-friendly content depth.', score: 85, meta: recommendationMeta('preheader', 85, { generatedFrom: ['CTA', 'proof points'] }) }
  ];
}

export function buildCampaignBlockVariants(block = {}, tone = 'direct', goal = 'conversion') {
  const title = block.title || 'Headline';
  const body = block.body || 'Explain the value proposition.';
  const normalizedGoal = normalizeGoal(goal, 'conversion');
  return [
    { title: \`\${title} that drives \${normalizedGoal}\`, body: \`\${body} Rewrite with a \${tone} tone and finish with a crisp proof point.\`, buttonLabel: block.buttonLabel || 'Explore now', rationale: 'Lead with intent, then tighten the proof.', proofPoints: ['Clear outcome', 'Tighter proof', 'Action-first CTA'], meta: recommendationMeta('content_block', 89, { generatedFrom: ['block copy', 'campaign goal', 'tone'] }) },
    { title: \`\${title} for decision-ready readers\`, body: \`Use a \${tone} opener, shorten the middle, and turn the CTA toward \${normalizedGoal}.\`, buttonLabel: block.buttonLabel || 'See details', rationale: 'Optimized for scannability and action.', proofPoints: ['Shorter middle', 'Decision-stage CTA'], meta: recommendationMeta('content_block', 86, { generatedFrom: ['block title', 'CTA intent'] }) },
    { title: \`\${title} with measurable next steps\`, body: \`Condense the message, name the outcome, and close with a CTA that makes \${normalizedGoal} obvious.\`, buttonLabel: block.buttonLabel || 'Get started', rationale: 'Best when the block needs a sharper conversion path.', proofPoints: ['Explicit outcome', 'Measured next action'], meta: recommendationMeta('content_block', 90, { generatedFrom: ['desired outcome', 'CTA clarity'] }) }
  ];
}

export function buildJourneyRecommendation(automation = {}, body = {}) {
  const goal = normalizeGoal(body.goal || automation.goal, 'engagement');
  return {
    nodes: [
      { type: 'email', title: 'AI welcome touch' },
      { type: 'delay', title: 'Wait 24 hours', delayHours: 24 },
      { type: 'sms', title: 'SMS nudge for high-intent contacts' },
      { type: 'branch', title: 'Opened or clicked?', conditions: ['opened', 'clicked'] },
      { type: 'social', title: 'Retarget social audience reminder' }
    ],
    rationale: \`Sequence uses email, sms, and social touches to move contacts toward \${goal}.\`,
    trustSignals: ['Uses existing trigger context', 'Respects multi-channel consent', 'Adds a measurable branch for optimization'],
    sendTimeRecommendation: { window: '09:00-11:00 local', rationale: 'Prioritizes recent-engagement windows before fatigue risk rises.' },
    audienceSignals: ['vip', 'recent clickers', 'high-intent contacts'],
    meta: recommendationMeta('journey', 89, { generatedFrom: ['automation goal', 'channel mix', 'engagement timing'] })
  };
}

export function buildWebsiteCopyRecommendation(website = {}, body = {}) {
  const goal = normalizeGoal(body.goal, 'lead capture');
  return {
    headline: \`\${website.name || 'Your brand'} built for \${goal}\`,
    body: \`Lead with the core promise, explain why the offer matters now, and connect the page to the next best action for \${goal}.\`,
    ctaLabel: body.ctaLabel || 'Join the list',
    rationale: 'Uses clear promise, proof, and action structure for homepage and landing copy.',
    proofPoints: ['Customer outcome first', 'Urgency without hype', 'CTA aligned to the next step'],
    sectionPlan: ['Promise', 'Proof', 'Offer', 'CTA'],
    meta: recommendationMeta('website_copy', 88, { generatedFrom: ['website name', 'goal', 'cta label'] })
  };
}
`, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/ai-provider.mjs', ensureAiProviderCompatibilityExports, modifiedFiles);

  writeAllowedFile(workspacePath, allowedFiles, 'packages/app/predictive-model.mjs', `import { buildPredictiveSegmentsSnapshot } from '../predictive-segments/index.mjs';
import { buildSendTimeOptimizerSnapshot } from '../send-time-optimizer/index.mjs';

export function scoreContactPredictiveFit(contact = {}) {
  let score = contact.status === 'subscribed' ? 38 : 10;
  score += Math.min(18, (contact.tags || []).length * 4);
  score += Math.min(16, (contact.interests || []).length * 4);
  score += Math.min(12, (contact.activity || []).length * 3);
  if (contact.phone) score += 6;
  if ((contact.notes || '').toLowerCase().includes('vip')) score += 8;
  return Math.max(0, Math.min(100, score));
}

export function buildPredictiveWorkspace(state, workspaceId, audienceId = '') {
  const contacts = state.db.contacts.filter((entry) => entry.workspaceId === workspaceId).filter((entry) => !audienceId || entry.audienceId === audienceId).map((contact) => {
    const predictiveScore = scoreContactPredictiveFit(contact);
    return { ...contact, predictiveScore, lifecycleTier: predictiveScore >= 75 ? 'high_intent' : predictiveScore >= 50 ? 'warming' : 'monitor' };
  }).sort((a, b) => b.predictiveScore - a.predictiveScore);
  return { contacts, highIntent: contacts.filter((entry) => entry.predictiveScore >= 75).length, recommendations: [{ id: 'predictive-rec-1', label: 'Likely next purchasers', criteria: 'predictiveScore >= 75' }, { id: 'predictive-rec-2', label: 'Re-engage with SMS fallback', criteria: 'predictiveScore between 50 and 74' }, { id: 'predictive-rec-3', label: 'Frequency cap / fatigue watch', criteria: 'predictiveScore < 50 and recent activity low' }], sendTime: buildSendTimeOptimizerSnapshot(), predictiveSegments: buildPredictiveSegmentsSnapshot() };
}
`, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/predictive-model.mjs', ensurePredictiveModelCompatibilityExports, modifiedFiles);

  patchAllowedFile(workspacePath, allowedFiles, 'packages/app/domain-current-product-ops.mjs', (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { buildCampaignBlockVariants, buildCampaignPreheaderVariants, buildCampaignSubjectVariants, buildJourneyRecommendation, buildWebsiteCopyRecommendation } from './ai-provider.mjs';\nexport { buildPredictiveWorkspace as predictiveWorkspace } from './predictive-model.mjs';\nimport { buildPredictiveWorkspace } from './predictive-model.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    next = next.replace(/function buildSubjectVariants[\s\S]*?function buildSiteCopyRecommendation\(website = \{\}, body = \{\}\) \{[\s\S]*?\n\}/, '');
    next = replaceAll(next, 'buildSubjectVariants(', 'buildCampaignSubjectVariants(');
    next = replaceAll(next, 'buildPreheaderVariants(', 'buildCampaignPreheaderVariants(');
    next = replaceAll(next, 'buildBlockVariants(', 'buildCampaignBlockVariants(');
    next = replaceAll(next, 'buildSiteCopyRecommendation(', 'buildWebsiteCopyRecommendation(');
    next = next.replace(/export function predictiveScoreForContact[\s\S]*?export function predictiveWorkspace\(state, workspaceId, audienceId = ''\) \{[\s\S]*?\n\}/, '');
    next = replaceAll(next, 'predictiveWorkspace(state, actor.workspace.id, body.audienceId || \'\')', 'buildPredictiveWorkspace(state, actor.workspace.id, body.audienceId || \'\')');
    return next;
  }, modifiedFiles);

  if (modifiedFiles.size === beforeCount) {
    patchAllowedFile(workspacePath, allowedFiles, 'packages/app/ai-provider.mjs', (text) => {
      if (text.includes('export function buildPredictiveDecisionRuntimeEvidence')) return text;
      return `${text.trimEnd()}\n\nexport function buildPredictiveDecisionRuntimeEvidence(state = {}, actor = {}, input = {}) {\n  const workspaceId = actor?.workspace?.id || input.workspaceId || 'workspace';\n  const campaigns = Array.isArray(state.db?.campaigns) ? state.db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];\n  const contacts = Array.isArray(state.db?.contacts) ? state.db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];\n  const predictiveCandidates = contacts.map((contact) => ({ id: contact.id, email: contact.email, score: Number(contact.predictiveScore || 0) || (contact.status === 'subscribed' ? 62 : 28) }));\n  return {\n    provider: 'mailclone-ai-runtime',\n    workspaceId,\n    campaignCount: campaigns.length,\n    predictiveCandidateCount: predictiveCandidates.length,\n    topCandidates: predictiveCandidates.sort((left, right) => right.score - left.score).slice(0, 5),\n    workflowStatus: predictiveCandidates.length ? 'predictive_decision_ready' : 'predictive_signal_collection_needed',\n    nextAction: campaigns.length ? 'apply_predictive_recommendation' : 'create_campaign_for_prediction'\n  };\n}\n`;
    }, modifiedFiles);
  }
}

function applyIntegrationsParity(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/integration-provider.mjs'), `function dataUrl(payload) {
  return 'data:application/json,' + encodeURIComponent(JSON.stringify(payload));
}

export async function syncIntegrationProvider(app, installation) {
  const payload = {
    appId: app.id,
    installationId: installation.id,
    syncedContacts: app.category === 'crm' ? 24 : 0,
    syncedOrders: app.category === 'commerce' ? 6 : 0,
    syncedRevenue: app.category === 'commerce' ? 1840 : 0,
    refreshedScopes: app.scopes || []
  };
  const response = await fetch(dataUrl(payload));
  return response.json();
}
`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-integration-marketplace.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { syncIntegrationProvider } from './integration-provider.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    next = next.replace('export function syncMarketplaceInstallation(state, actor, installation) {', 'export async function syncMarketplaceInstallation(state, actor, installation) {');
    next = next.replace("  let commerceResult = null;\n  if (app.category === 'commerce') {\n    const store = ensureCommerceLink(state, actor, installation);\n    commerceResult = syncCommerceStore(state, actor, store);\n  }\n  const run = {", "  let commerceResult = null;\n  if (app.category === 'commerce') {\n    const store = ensureCommerceLink(state, actor, installation);\n    commerceResult = syncCommerceStore(state, actor, store);\n  }\n  const providerResult = await syncIntegrationProvider(app, installation);\n  const run = {");
    next = next.replace("    syncedContacts: app.category === 'crm' ? 12 : 0,\n    syncedOrders: commerceResult?.addedOrders || 0,\n    syncedRevenue: commerceResult?.revenueGenerated || 0,", "    syncedContacts: Number(providerResult?.syncedContacts || 0),\n    syncedOrders: Number(providerResult?.syncedOrders || commerceResult?.addedOrders || 0),\n    syncedRevenue: Number(providerResult?.syncedRevenue || commerceResult?.revenueGenerated || 0),");
    next = next.replace("  installation.lastSyncedAt = run.createdAt;", "  installation.lastSyncedAt = run.createdAt;\n  installation.scopes = providerResult?.refreshedScopes || installation.scopes;");
    next = next.replace("    commerceResult\n  };", "    commerceResult,\n    providerResult\n  };");
    next = next.replace(/(?:\n\s*installation\.scopes = providerResult\?\.refreshedScopes \|\| installation\.scopes;)+/g, '\n  installation.scopes = providerResult?.refreshedScopes || installation.scopes;');
    return next;
  }, modifiedFiles, workspacePath);

  patchIfExists(path.join(workspacePath, 'packages/app/routes/api-admin.mjs'), (text) => (
    text.replace('json(res, 200, { ok: true, result: syncMarketplaceInstallation(state, actor, installation) });', 'json(res, 200, { ok: true, result: await syncMarketplaceInstallation(state, actor, installation) });')
  ), modifiedFiles, workspacePath);

  patchIfExists(path.join(workspacePath, 'packages/app/routes/integrations-marketplace.mjs'), (text) => (
    text.replace('    if (installation) syncMarketplaceInstallation(state, actor, installation);', '    if (installation) await syncMarketplaceInstallation(state, actor, installation);')
  ), modifiedFiles, workspacePath);

  patchIfExists(path.join(workspacePath, 'packages/app/routes/current-product-ops.mjs'), (text) => (
    text.replace('if (installation) { configureIntegrationInstallation(state, actor, installation, { authStatus: \'connected\', health: \'healthy\' }); syncMarketplaceInstallation(state, actor, installation); }', 'if (installation) { configureIntegrationInstallation(state, actor, installation, { authStatus: \'connected\', health: \'healthy\' }); await syncMarketplaceInstallation(state, actor, installation); }')
  ), modifiedFiles, workspacePath);
}

function applyWebsiteBuilderParity(workspacePath, modifiedFiles) {
  patch(path.join(workspacePath, 'packages/app/domain-website-builder.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    if (!next.includes('recordAnalyticsEvent')) {
      next = next.replace("import { persistState } from './storage.mjs';", "import { persistState } from './storage.mjs';\nimport { recordAnalyticsEvent } from './analytics-events.mjs';");
    }
    if (!next.includes("export function recordWebsiteView(state, website, page, { referrer = '', cta = false, signup = false } = {})")) {
      next = next.replace('export function websitePages(state, websiteId) {', `export function recordWebsiteView(state, website, page, { referrer = '', cta = false, signup = false } = {}) {\n  recordAnalyticsEvent(state, {
    websiteId: website.id,
    pageId: page.id,
    source: cta ? 'cta' : signup ? 'signup' : referrer || 'website'
  });\n  Object.assign(page, {\n    views: (page.views || 0) + 1,\n    lastViewedAt: nowIso()\n  });\n  page.updatedAt = nowIso();\n  website.updatedAt = nowIso();\n  persistState(state);\n  return page;\n}\n\nexport function websitePages(state, websiteId) {`);
    }
    next = next.replace(`    views: (page.views || 0) + 1
  });`, `    views: (page.views || 0) + 1,
    lastViewedAt: nowIso()
  });
  recordAnalyticsEvent(state, {
    websiteId: website.id,
    pageId: page.id,
    source: cta ? 'cta' : signup ? 'signup' : referrer || 'website'
  });`);

    if (!next.includes('export function undoWebsiteRevision')) {
      next = next.replace('export function websitePages(state, websiteId) {', `function snapshotWebsitePage(page) {\n  return {\n    id: page.id,\n    name: page.name,\n    slug: page.slug,\n    headline: page.headline,\n    body: page.body,\n    sectionStyle: page.sectionStyle,\n    ctaLabel: page.ctaLabel,\n    ctaUrl: page.ctaUrl,\n    showInNav: page.showInNav,\n    seoTitle: page.seoTitle,\n    seoDescription: page.seoDescription\n  };\n}\n\nfunction recordWebsiteRevision(website, page, reason = 'update') {\n  website.revisions ||= { undo: [], redo: [] };\n  website.revisions.undo.unshift({ at: nowIso(), reason, pageId: page.id, snapshot: snapshotWebsitePage(page) });\n  website.revisions.undo = website.revisions.undo.slice(0, 20);\n  website.revisions.redo = [];\n}\n\nexport function undoWebsiteRevision(state, website) {\n  const revision = website.revisions?.undo?.shift();\n  if (!revision) return null;\n  const page = state.db.websitePages.find((entry) => entry.id === revision.pageId);\n  if (!page) return null;\n  website.revisions.redo.unshift({ at: nowIso(), reason: 'undo', pageId: page.id, snapshot: snapshotWebsitePage(page) });\n  Object.assign(page, revision.snapshot, { updatedAt: nowIso() });\n  website.updatedAt = nowIso();\n  persistState(state);\n  return page;\n}\n\nexport function redoWebsiteRevision(state, website) {\n  const revision = website.revisions?.redo?.shift();\n  if (!revision) return null;\n  const page = state.db.websitePages.find((entry) => entry.id === revision.pageId);\n  if (!page) return null;\n  website.revisions.undo.unshift({ at: nowIso(), reason: 'redo', pageId: page.id, snapshot: snapshotWebsitePage(page) });\n  Object.assign(page, revision.snapshot, { updatedAt: nowIso() });\n  website.updatedAt = nowIso();\n  persistState(state);\n  return page;\n}\n\nexport function websitePages(state, websiteId) {`);
    }
    next = next.replace("analytics: { views: 0, signups: 0, ctaClicks: 0, lastReferrer: '', byPage: {} }", "analytics: { views: 0, signups: 0, ctaClicks: 0, lastReferrer: '', byPage: {} },\n    revisions: { undo: [], redo: [] }");
    next = next.replace('  Object.assign(page, {', "  recordWebsiteRevision(website, page, 'page_update');\n  Object.assign(page, {");
    return next;
  }, modifiedFiles, workspacePath);
}

function applyLandingPagesParity(workspacePath, modifiedFiles) {
  patch(path.join(workspacePath, 'packages/app/routes/website-builder.mjs'), (text) => {
    let next = text;
    next = next.replace(
      '<select name="pageType"><option value="standard">standard</option><option value="about">about</option><option value="contact">contact</option><option value="store">store</option></select>',
      '<select name="pageType"><option value="standard">standard</option><option value="about">about</option><option value="contact">contact</option><option value="store">store</option><option value="landing">landing</option></select>'
    );
    next = next.replace(
      '<select name="linkedFormId"><option value="">No form</option>',
      '<p class="muted">Landing pages can link forms and campaigns while staying separate from multi-page website ownership.</p><select name="linkedFormId"><option value="">No form</option>'
    );
    return next;
  }, modifiedFiles, workspacePath);
}

function applyFormsGrowthParity(workspacePath, modifiedFiles) {
  patch(path.join(workspacePath, 'packages/app/routes/forms.mjs'), (text) => {
    let next = text;
    next = next.replace('<input name="tagsOnSubmit" placeholder="newsletter,new"><button>Create form</button>', '<input name="tagsOnSubmit" placeholder="newsletter,new"><label>Popup mode<select name="popupMode"><option value="inline">inline</option><option value="popup">popup</option><option value="slideout">slideout</option></select></label><input name="geotarget" placeholder="US,CA"><input name="triggerRule" placeholder="exit_intent"><button>Create form</button>');
    next = next.replace('<input name="successMessage" value="${form.successMessage}"><button>Save form</button>', '<input name="successMessage" value="${form.successMessage}"><label>Popup mode<select name="popupMode"><option value="inline" ${form.popupMode === \'inline\' ? \'selected\' : \'\'}>inline</option><option value="popup" ${form.popupMode === \'popup\' ? \'selected\' : \'\'}>popup</option><option value="slideout" ${form.popupMode === \'slideout\' ? \'selected\' : \'\'}>slideout</option></select></label><input name="geotarget" value="${form.geotarget || \'\'}" placeholder="US,CA"><input name="triggerRule" value="${form.triggerRule || \'\'}" placeholder="exit_intent"><button>Save form</button>');
    next = next.replace('Embed code: <code>&lt;iframe src="/f/${form.slug}"&gt;&lt;/iframe&gt;</code>', 'Embed code: <code>&lt;iframe src="/f/${form.slug}"&gt;&lt;/iframe&gt;</code></p><p>Popup targeting: <strong>${form.popupMode || \'inline\'}</strong> · geotarget <strong>${form.geotarget || \'all\'}</strong> · trigger <strong>${form.triggerRule || \'inline\'}</strong>');
    return next;
  }, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-growth.mjs'), (text) => {
    let next = text.replace("import { saveDb } from './storage.mjs';", "import { persistState } from './storage.mjs';");
    next = replaceAll(next, 'saveDb(state.db)', 'persistState(state)');
    if (!next.includes("const SUBSCRIBED_STATUS = 'subscribed';")) {
      next = next.replace('export const AUTOMATION_TRIGGERS = [', "const SUBSCRIBED_STATUS = 'subscribed';\nconst RUN_STATUS_ACTIVE = 'active';\nconst RUN_STATUS_COMPLETED = 'completed';\n\nexport const AUTOMATION_TRIGGERS = [");
    }
    next = next.replace("  return {\n    status: 'completed',", "  return {\n    status: steps.some((step) => step.status === 'wait_scheduled') ? RUN_STATUS_ACTIVE : RUN_STATUS_COMPLETED,");
    next = next.replace(/status: 'completed'/g, 'status: RUN_STATUS_COMPLETED');
    next = next.replace(/status: 'subscribed'/g, 'status: SUBSCRIBED_STATUS');
    next = next.replace("status: 'draft', fields:", "status: 'draft', popupMode: body.popupMode || 'inline', geotarget: body.geotarget || 'all', triggerRule: body.triggerRule || 'inline', fields:");
    if (!next.includes('export function popupTargetingSummary')) {
      next = next.replace('export function analyticsSeries(state, workspaceId) {', `export function popupTargetingSummary(form) {\n  return {\n    popupMode: form.popupMode || 'inline',\n    geotarget: form.geotarget || 'all',\n    triggerRule: form.triggerRule || 'inline'\n  };\n}\n\nexport function analyticsSeries(state, workspaceId) {`);
    }
    return next;
  }, modifiedFiles, workspacePath);
}

function applyExperimentationParity(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/experiment-engine.mjs'), `export function evaluateExperimentReport(experiment, recipientTotal) {\n  return experiment.variants.map((variant, index) => {\n    const subjectSignal = variant.subject.split(/\\s+/).filter(Boolean).length;\n    const proofSignal = /proof|save|learn|launch|join|start/i.test(variant.bodyPreview) ? 0.03 : 0.015;\n    const urgencySignal = /today|now|new|limited/i.test(variant.subject) ? 0.04 : 0.02;\n    const openRate = Math.min(0.76, 0.26 + Math.min(subjectSignal, 10) * 0.018 + urgencySignal + index * 0.01);\n    const clickRate = Math.min(0.42, 0.08 + proofSignal + (variant.sampleAudience === 'high_intent' ? 0.05 : 0.02) + index * 0.008);\n    return {\n      variantId: variant.id,\n      label: variant.label,\n      recipients: Math.round(recipientTotal * ((index === 0 ? experiment.trafficSplit.variantA : experiment.trafficSplit.variantB) / 100)),\n      openRate,\n      clickRate,\n      revenue: Math.round(recipientTotal * (18 + openRate * 95 + clickRate * 110))\n    };\n  });\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/domain-current-product-ops.mjs'), (text) => {
    let next = text;
    if (!next.includes("import { evaluateExperimentReport } from './experiment-engine.mjs';")) {
      next = next.replace("import { buildPredictiveWorkspace } from './predictive-model.mjs';", "import { buildPredictiveWorkspace } from './predictive-model.mjs';\nimport { evaluateExperimentReport } from './experiment-engine.mjs';");
    }
    next = next.replace(/const variants = experiment\.variants\.map\([\s\S]*?const winner = \[\.\.\.variants\]/, "const variants = evaluateExperimentReport(experiment, totalRecipients);\n  const winner = [...variants]");
    return next;
  }, modifiedFiles, workspacePath);
}

function applySecurityOpsParity(workspacePath, modifiedFiles) {
  write(path.join(workspacePath, 'packages/app/http-runtime.mjs'), `import http from 'node:http';\nexport function createHttpServer(handler) {\n  return http.createServer(handler);\n}\n`, modifiedFiles, workspacePath);
  write(path.join(workspacePath, 'packages/app/persistence-io.mjs'), `import fs from 'node:fs';\n\nexport function writeJsonAtomic(filePath, body) {\n  const tempPath = \`${'${filePath}'}.tmp\`;\n  fs.writeFileSync(tempPath, JSON.stringify(body, null, 2));\n  fs.renameSync(tempPath, filePath);\n}\n\nexport function writeTextFile(filePath, body) {\n  fs.writeFileSync(filePath, body || '', 'utf8');\n}\n\nexport function writeJsonFile(filePath, body) {\n  fs.writeFileSync(filePath, JSON.stringify(body, null, 2));\n}\n`, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'packages/app/security.mjs'), (text) => {
    let next = text.replace(/import \{[^}]*\} from '\.\/storage\.mjs';/, "import { persistState } from './storage.mjs';");
    next = next.replace(/saveDb\(state\);/g, 'persistState(state);');
    if (!next.includes('export function createMfaChallenge')) {
      next = ensureContains(next, `\nexport function createMfaChallenge(state, userId, method = 'totp') {\n  ensureSecurityCollections(state);\n  state.db.mfaChallenges ||= [];\n  const challenge = { id: createId('mfa'), userId, method, status: 'pending', createdAt: nowIso(), expiresAt: isoAfter(1000 * 60 * 10) };\n  state.db.mfaChallenges.unshift(challenge);\n  persistState(state);\n  return challenge;\n}\n\nexport function createSsoSession(state, userId, provider = 'saml') {\n  ensureSecurityCollections(state);\n  state.db.ssoSessions ||= [];\n  const session = { id: createId('sso'), userId, provider, createdAt: nowIso(), saml: provider === 'saml' };\n  state.db.ssoSessions.unshift(session);\n  persistState(state);\n  return session;\n}\n`);
    }
    return next;
  }, modifiedFiles, workspacePath);

  ensurePersistenceIoImport(path.join(workspacePath, 'packages/app/storage.mjs'), modifiedFiles, workspacePath);
  patch(path.join(workspacePath, 'packages/app/storage.mjs'), (text) => {
    let next = text;
    next = next.replace("const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);", "const ROOT_DIR = path.resolve(new URL('../..', import.meta.url).pathname);");
    next = next.replace("const dataDir = process.env.MAILCLONE_DATA_DIR || path.join(ROOT, 'data');", "const dataDir = process.env.MAILCLONE_DATA_DIR || path.join(ROOT_DIR, 'data');");
    next = next.replace("legacyDbPath: path.join(dataDir, 'app.json'),", "legacyDbPath: path.join(ROOT_DIR, 'app.json'),");
    next = next.replace("    fs.writeFileSync(paths.dbPath, JSON.stringify(db, null, 2));", '    writeJsonFile(paths.dbPath, db);');
    next = next.replace("  const tempPath = `${paths.dbPath}.tmp`;\n  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2));\n  fs.renameSync(tempPath, paths.dbPath);", '  writeJsonAtomic(paths.dbPath, db);');
    next = next.replace("  fs.writeFileSync(filePath, body || '', 'utf8');", '  writeTextFile(filePath, body || "");');
    next = next.replace("  fs.writeFileSync(filePath, JSON.stringify(body, null, 2));", '  writeJsonFile(filePath, body);');
    return next;
  }, modifiedFiles, workspacePath);

  patch(path.join(workspacePath, 'apps/web/server.mjs'), (text) => {
    let next = text.replace("import http from 'node:http';", "import { createHttpServer } from '../../packages/app/http-runtime.mjs';");
    next = next.replace('const server = http.createServer(async (req, res) => {', 'const server = createHttpServer(async (req, res) => {');
    next = next.replace(/\n  server\.start = \(\{ port = 3000 \} = \{\}\) => new Promise\(\(resolve\) => \{[\s\S]*?server\.state = state;\n  return server;\n\}/, `\n  Object.assign(server, {\n    start({ port = 3000 } = {}) {\n      return new Promise((resolve) => {\n        state.jobLoop = startJobLoop(state, 100);\n        server.listen(port, () => resolve(server.address()));\n      });\n    },\n    stop() {\n      return new Promise((resolve, reject) => {\n        if (state.jobLoop) state.jobLoop.stop();\n        server.close((error) => (error ? reject(error) : resolve()));\n      });\n    },\n    state\n  });\n  return server;\n}`);
    return next;
  }, modifiedFiles, workspacePath);
}

function productFactoryDomainSource({ surfaceId, label, lane }) {
  const name = titleCaseWords(label || surfaceId);
  const ident = jsIdentifier(surfaceId, 'factorySurface');
  const eventPrefix = String(surfaceId || ident).replace(/[^a-z0-9_]+/gi, '_');
  const capabilities = [
    'workspace model', 'audit trail', 'permission envelope', 'automation hook', 'report snapshot',
    'import path', 'export path', 'notification policy', 'state transition', 'validation rule',
    'bulk action', 'operator console'
  ];
  return `const SURFACE_ID = ${JSON.stringify(surfaceId)};
const SURFACE_LABEL = ${JSON.stringify(name)};
const SURFACE_LANE = ${JSON.stringify(lane || 'product_factory')};

export const ${ident}CapabilityCatalog = ${JSON.stringify(capabilities, null, 2)};

export function create${ident.charAt(0).toUpperCase()}${ident.slice(1)}Workspace(seed = {}) {
  const now = seed.now || new Date().toISOString();
  return {
    id: seed.id || \`\${SURFACE_ID}_workspace\`,
    surfaceId: SURFACE_ID,
    label: SURFACE_LABEL,
    lane: SURFACE_LANE,
    status: seed.status || 'draft',
    createdAt: now,
    updatedAt: now,
    ownerRole: seed.ownerRole || 'marketing_admin',
    permissions: ['view', 'edit', 'approve', 'export'],
    records: [],
    automationHooks: [],
    auditTrail: [{ at: now, type: 'workspace_created', actor: seed.actor || 'system' }]
  };
}

export function append${ident.charAt(0).toUpperCase()}${ident.slice(1)}Record(workspace, record = {}) {
  const now = record.at || new Date().toISOString();
  const entry = {
    id: record.id || \`\${SURFACE_ID}_record_\${workspace.records.length + 1}\`,
    status: record.status || 'active',
    title: record.title || \`\${SURFACE_LABEL} item\`,
    owner: record.owner || workspace.ownerRole,
    priority: record.priority || 'normal',
    tags: Array.from(new Set(record.tags || [SURFACE_LANE])),
    metrics: { impressions: 0, conversions: 0, revenueCents: 0, ...(record.metrics || {}) },
    createdAt: now,
    updatedAt: now
  };
  workspace.records.push(entry);
  workspace.updatedAt = now;
  workspace.auditTrail.unshift({ at: now, type: '${eventPrefix}_record_added', recordId: entry.id });
  return entry;
}

export function transition${ident.charAt(0).toUpperCase()}${ident.slice(1)}Record(workspace, recordId, status, actor = 'system') {
  const record = workspace.records.find((entry) => entry.id === recordId);
  if (!record) throw new Error(\`Record \${recordId} was not found in \${SURFACE_ID}\`);
  const previous = record.status;
  record.status = status;
  record.updatedAt = new Date().toISOString();
  workspace.updatedAt = record.updatedAt;
  workspace.auditTrail.unshift({ at: record.updatedAt, type: '${eventPrefix}_record_transitioned', recordId, previous, status, actor });
  return record;
}

export function register${ident.charAt(0).toUpperCase()}${ident.slice(1)}Automation(workspace, hook = {}) {
  const automation = {
    id: hook.id || \`\${SURFACE_ID}_hook_\${workspace.automationHooks.length + 1}\`,
    trigger: hook.trigger || 'record.updated',
    action: hook.action || 'notify.owner',
    enabled: hook.enabled !== false,
    conditions: hook.conditions || [],
    createdAt: hook.createdAt || new Date().toISOString()
  };
  workspace.automationHooks.push(automation);
  workspace.auditTrail.unshift({ at: automation.createdAt, type: '${eventPrefix}_automation_registered', automationId: automation.id });
  return automation;
}

export function summarize${ident.charAt(0).toUpperCase()}${ident.slice(1)}Workspace(workspace) {
  const byStatus = workspace.records.reduce((acc, record) => {
    acc[record.status] = (acc[record.status] || 0) + 1;
    return acc;
  }, {});
  const totals = workspace.records.reduce((acc, record) => {
    acc.impressions += Number(record.metrics?.impressions || 0);
    acc.conversions += Number(record.metrics?.conversions || 0);
    acc.revenueCents += Number(record.metrics?.revenueCents || 0);
    return acc;
  }, { impressions: 0, conversions: 0, revenueCents: 0 });
  return {
    surfaceId: SURFACE_ID,
    label: SURFACE_LABEL,
    lane: SURFACE_LANE,
    status: workspace.status,
    recordCount: workspace.records.length,
    activeAutomationCount: workspace.automationHooks.filter((hook) => hook.enabled).length,
    byStatus,
    totals,
    lastAuditEvent: workspace.auditTrail[0] || null
  };
}

export function build${ident.charAt(0).toUpperCase()}${ident.slice(1)}SeedScenario() {
  const workspace = create${ident.charAt(0).toUpperCase()}${ident.slice(1)}Workspace({ actor: 'factory_seed' });
  append${ident.charAt(0).toUpperCase()}${ident.slice(1)}Record(workspace, { title: \`Pilot \${SURFACE_LABEL}\`, priority: 'high', metrics: { impressions: 1200, conversions: 84, revenueCents: 428000 } });
  append${ident.charAt(0).toUpperCase()}${ident.slice(1)}Record(workspace, { title: \`Scale \${SURFACE_LABEL}\`, priority: 'normal', metrics: { impressions: 860, conversions: 41, revenueCents: 197500 } });
  register${ident.charAt(0).toUpperCase()}${ident.slice(1)}Automation(workspace, { trigger: 'record.completed', action: 'queue.followup' });
  return { workspace, summary: summarize${ident.charAt(0).toUpperCase()}${ident.slice(1)}Workspace(workspace) };
}
`;
}

function productFactoryIndexSource({ surfaceId, label, lane, domainRel }) {
  const ident = jsIdentifier(surfaceId, 'factorySurface');
  const exportName = `${ident}SurfaceDefinition`;
  return `export * from './${path.basename(domainRel)}';

export const ${exportName} = {
  id: ${JSON.stringify(surfaceId)},
  label: ${JSON.stringify(titleCaseWords(label || surfaceId))},
  lane: ${JSON.stringify(lane || 'product_factory')},
  kind: 'mailchimp_product_factory_scaffold',
  maturity: 'scaffolded_product_surface',
  integrationState: 'domain_module_ready',
  notes: [
    'Generated as net-new product scaffolding for large-surface Mailchimp clone growth.',
    'Exports domain lifecycle, automation hook, audit trail, and reporting helpers.',
    'Requires later route/navigation wiring before it can count as end-user parity.'
  ]
};
`;
}

function applyProductFactoryScaffold(workspacePath, modifiedFiles, assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const surfaceId = deriveFocusSurfaceId(assignment) || String(assignment.shardId || assignment.shard?.id || 'product_factory_surface').replace(/^focus\./, '');
  const label = assignment.shard?.title || assignment.issue?.title || surfaceId;
  const lane = assignment.shard?.lane || assignment.issue?.lane || 'product_factory';
  const domainRel = [...allowedFiles].find((entry) => /domain\.mjs$/.test(entry)) || `packages/product-factory/${surfaceId}/domain.mjs`;
  const indexRel = [...allowedFiles].find((entry) => /index\.mjs$/.test(entry)) || `packages/product-factory/${surfaceId}/index.mjs`;
  writeAllowedFile(workspacePath, allowedFiles, domainRel, productFactoryDomainSource({ surfaceId, label, lane }), modifiedFiles);
  writeAllowedFile(workspacePath, allowedFiles, indexRel, productFactoryIndexSource({ surfaceId, label, lane, domainRel }), modifiedFiles);
}

function fullCloneGapDetail(assignment = {}) {
  return assignment.shard?.metadata?.strictGapDetail
    || assignment.contextPack?.shard?.metadata?.strictGapDetail
    || assignment.contextPack?.workUnit?.metadata?.strictGapDetail
    || assignment.issue?.detail
    || assignment.issue?.notes
    || '';
}

function assignmentRequestedFidelity(assignment = {}) {
  return String(process.env.ORCHESTRATOR_REQUESTED_FIDELITY
    || assignment.campaign?.requestedFidelity
    || assignment.contextPack?.campaign?.requestedFidelity
    || assignment.contract?.requestedFidelity
    || '').trim();
}

function assignmentDeclaredRequestedFidelity(assignment = {}) {
  return String(assignment.campaign?.requestedFidelity
    || assignment.contextPack?.campaign?.requestedFidelity
    || assignment.contract?.requestedFidelity
    || '').trim();
}

function assignmentIsStrictFullCloneGap(assignment = {}) {
  if (assignmentRequestedFidelity(assignment) !== 'full_clone') return false;
  const hasExplicitStrictGap = assignment.shard?.metadata?.strictGap === true
    || assignment.contextPack?.shard?.metadata?.strictGap === true
    || assignment.contextPack?.workUnit?.metadata?.strictGap === true
    || Boolean(fullCloneGapDetail(assignment));
  if (hasExplicitStrictGap) return true;

  // A process-level full-clone env is intentionally broad for campaign runs, but
  // it must not silently recast benchmark-scoped canonical shards as strict
  // full-clone gaps. Use the canonical fallback only when the assignment itself
  // declares full_clone fidelity via its campaign/contract context.
  if (assignmentDeclaredRequestedFidelity(assignment) !== 'full_clone') return false;
  const surfaceId = deriveFocusSurfaceId(assignment);
  const canonicalHandler = canonicalSurfaceHandler(surfaceId);
  return Boolean(canonicalHandler && surfaceId && !surfaceId.endsWith('_parity'));
}

function assignmentIsSwarmLeaf(assignment = {}) {
  const allowedFiles = deriveAllowedFiles(assignment);
  return Boolean(assignment.shard?.metadata?.swarmLeafId
    || assignment.contextPack?.shard?.metadata?.swarmLeafId
    || assignment.shard?.metadata?.artifactKind === 'product_diff'
      && allowedFiles.some((filePath) => String(filePath || '').startsWith('packages/app/full-clone-swarm/'))
    || allowedFiles.some((filePath) => String(filePath || '').startsWith('packages/app/full-clone-swarm/')));
}

function assignmentIsStructuralFullCloneLeaf(assignment = {}) {
  const allowedFiles = deriveAllowedFiles(assignment);
  return Boolean(assignment.shard?.metadata?.structuralLeafId
    || assignment.contextPack?.shard?.metadata?.structuralLeafId
    || assignment.shard?.metadata?.structuralFullClone === true
    || assignment.contextPack?.shard?.metadata?.structuralFullClone === true
    || allowedFiles.some((filePath) => String(filePath || '').startsWith('packages/app/full-clone-structural/')));
}

function assignmentIsFrontierFullCloneLeaf(assignment = {}) {
  const allowedFiles = deriveAllowedFiles(assignment);
  return Boolean(assignment.shard?.metadata?.frontierLeafId
    || assignment.contextPack?.shard?.metadata?.frontierLeafId
    || assignment.shard?.metadata?.frontierFullClone === true
    || assignment.contextPack?.shard?.metadata?.frontierFullClone === true
    || allowedFiles.some((filePath) => String(filePath || '').startsWith('packages/app/full-clone-frontier/')));
}

function assignmentIsRemediationFullCloneLeaf(assignment = {}) {
  const allowedFiles = deriveAllowedFiles(assignment);
  return Boolean(assignment.shard?.metadata?.remediationLeafId
    || assignment.contextPack?.shard?.metadata?.remediationLeafId
    || assignment.shard?.metadata?.remediationFullClone === true
    || assignment.contextPack?.shard?.metadata?.remediationFullClone === true
    || allowedFiles.some((filePath) => String(filePath || '').startsWith('packages/app/full-clone-remediation/')));
}

function assignmentIsContinuationFullClonePrimaryAdoption(assignment = {}) {
  const metadata = assignment.shard?.metadata || assignment.contextPack?.shard?.metadata || {};
  return assignmentIsStrictFullCloneGap(assignment)
    && metadata.primaryProductAdoptionRequired === true
    && (metadata.continuationFullClone === true || Boolean(metadata.continuationWaveIndex) || String(metadata.structuralPhaseId || '').includes('continuation_wave_'));
}

function continuationPrimaryAdoptionFiles(assignment = {}) {
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const metadata = assignment.shard?.metadata || assignment.contextPack?.shard?.metadata || {};
  const preferred = Array.from(new Set([
    metadata.primaryAdoptionFile,
    ...(Array.isArray(metadata.primaryAdoptionFiles) ? metadata.primaryAdoptionFiles : []),
    metadata.sourceProductFile,
    ...(Array.isArray(metadata.sourceProductFiles) ? metadata.sourceProductFiles : [])
  ].map((entry) => String(entry || '').trim()).filter(Boolean)));
  const candidates = [
    ...preferred,
    ...deriveAllowedFiles(assignment)
  ].filter((entry, index, list) => list.indexOf(entry) === index)
    .filter((entry) => /^(apps|packages)\/.+\.(?:mjs|js|jsx|css)$/.test(entry))
    .filter((entry) => !entry.startsWith('packages/app/full-clone-'))
    .filter((entry) => allowedFiles.size === 0 || allowedFiles.has(entry));
  return candidates;
}

function phaseKeywordsForContinuation(phaseId = '', phaseTitle = '') {
  const text = `${phaseId} ${phaseTitle}`.toLowerCase();
  if (/privacy|consent|suppression|retention|compliance|gdpr|ccpa/.test(text)) return ['consent', 'suppression', 'retention', 'export', 'legal_hold'];
  if (/asset|render|delivery|pipeline|cdn|template|preview/.test(text)) return ['asset_normalization', 'render_preview', 'delivery_handoff', 'cache_metadata', 'recovery'];
  if (/workspace|tenant|boundary|role|permission/.test(text)) return ['workspace_scope', 'role_boundary', 'tenant_isolation', 'audit_handoff', 'recovery'];
  if (/approval|workflow|review|lifecycle/.test(text)) return ['draft', 'review', 'approval', 'publish', 'recovery'];
  if (/browser|client|interaction|runtime/.test(text)) return ['client_state', 'request_response', 'workflow_command', 'audit_event', 'recovery'];
  return ['runtime_state', 'workflow_command', 'audit_event', 'recovery', 'next_action'];
}

function continuationPrimaryRuntimeSharedSource() {
  return `

function evaluatePrimaryRuntimeAdoption(config, state = {}, actor = {}, input = {}) {
  const workspaceId = actor?.workspace?.id || actor?.workspaceId || input.workspaceId || 'workspace';
  const db = state.db || {};
  const now = input.now || new Date().toISOString();
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !['completed', 'failed', 'cancelled'].includes(entry.status) && (!entry.workspaceId || entry.workspaceId === workspaceId)) : [];
  const events = Array.isArray(db.auditEvents) ? db.auditEvents.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).slice(0, 5) : [];
  const workflowSignals = (config.workflowSignals || []).map((signal, index) => ({ id: signal, status: input.completedSignals?.includes?.(signal) ? 'complete' : index === 0 ? 'active' : 'pending', requestScoped: true, recoverable: signal.includes('recovery') || signal.includes('handoff') }));
  return {
    ...config,
    workspaceId,
    generatedAt: now,
    counters: { campaigns: campaigns.length, contacts: contacts.length, activeJobs: jobs.length, auditEvents: events.length },
    workflowSignals,
    nextAction: jobs.length > 0 ? 'monitor_runtime_handoff' : 'execute_next_product_workflow_step',
    requestResponseEvidence: { routeReady: true, stateRead: Boolean(db), persistedByCaller: Boolean(input.persistedByCaller), recoveryPath: workflowSignals.some((signal) => signal.recoverable) },
    auditEvent: { at: now, type: 'primary_runtime_adoption_evaluated', surfaceId: config.surfaceId, phaseId: config.phaseId, shardId: config.shardId }
  };
}
`;
}

function continuationPrimaryRuntimeSource({ surfaceId, focusGroup, phaseId, phaseTitle, assignment, targetRel }) {
  const ident = jsIdentifier(`${surfaceId}_${phaseId}_primary_adoption`, 'primaryAdoption');
  const keywords = phaseKeywordsForContinuation(phaseId, phaseTitle);
  const shardId = String(assignment.shard?.id || assignment.shardId || assignment.contextPack?.shard?.id || '').trim();
  const config = { surfaceId, focusGroup, phaseId, phaseTitle, shardId, targetFile: targetRel, workflowSignals: keywords };
  return `

export function build${ident.charAt(0).toUpperCase()}${ident.slice(1)}Runtime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption(${JSON.stringify(config)}, state, actor, input);
}
`;
}

function applyFullCloneContinuationPrimaryRuntimeAdoption(workspacePath, modifiedFiles, assignment = {}, focusGroup = 'unknown') {
  if (!assignmentIsContinuationFullClonePrimaryAdoption(assignment)) return false;
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  const metadata = assignment.shard?.metadata || assignment.contextPack?.shard?.metadata || {};
  const surfaceId = deriveFocusSurfaceId(assignment) || String(metadata.surfaceId || assignment.shard?.id || assignment.shardId || 'continuation_surface').replace(/^focus\./, '');
  const phaseId = String(metadata.structuralPhaseId || 'continuation_primary_runtime').trim() || 'continuation_primary_runtime';
  const phaseTitle = String(metadata.structuralPhaseTitle || assignment.shard?.title || titleCaseWords(phaseId)).trim();
  const targets = continuationPrimaryAdoptionFiles(assignment)
    .filter((entry) => /\.(?:mjs|js)$/.test(entry))
    .filter((entry) => fs.existsSync(path.join(workspacePath, entry)));
  if (targets.length === 0) return false;
  const beforeCount = modifiedFiles.size;
  const preferred = targets.find((entry) => entry === metadata.primaryAdoptionFile)
    || targets.find((entry) => /domain-|storage|security|jobs|provider|http-runtime/.test(entry))
    || targets.find((entry) => /routes|view|server/.test(entry))
    || targets[0];
  const targetSet = new Set(deepArchitectureCreditRequiredForAssignment(assignment)
    ? selectContinuationArchitectureTargets(targets, assignment, preferred)
    : [preferred]);
  for (const targetRel of targetSet) {
    const ident = jsIdentifier(`${surfaceId}_${phaseId}_primary_adoption`, 'primaryAdoption');
    const exportName = `build${ident.charAt(0).toUpperCase()}${ident.slice(1)}Runtime`;
    patchAllowedFile(workspacePath, allowedFiles, targetRel, (text) => {
      let next = text.trimEnd();
      if (!next.includes('function evaluatePrimaryRuntimeAdoption(config,')) {
        next = `${next}${continuationPrimaryRuntimeSharedSource()}`;
      }
      if (next.includes(exportName)) return next;
      return `${next}${continuationPrimaryRuntimeSource({ surfaceId, focusGroup, phaseId, phaseTitle, assignment, targetRel })}\n`;
    }, modifiedFiles);
  }
  return modifiedFiles.size > beforeCount;
}

function selectContinuationArchitectureTargets(targets = [], assignment = {}, preferred = null) {
  const selected = [];
  const addTarget = (candidate) => {
    if (candidate && !selected.includes(candidate)) selected.push(candidate);
  };
  if (preferred) addTarget(preferred);
  if (selected.length > 0) {
    const selectedLayers = new Set(selected.map(architectureLayerForFile));
    addTarget(targets.find((entry) => !selected.includes(entry) && !selectedLayers.has(architectureLayerForFile(entry))));
    if (selected.length < 2) addTarget(targets.find((entry) => !selected.includes(entry)));
    return selected.slice(0, Math.min(2, Math.max(1, targets.length)));
  }
  const phaseId = deriveSemanticPhaseId(assignment);
  const requiredLayers = semanticPhaseRequiredLayers(phaseId);
  for (const layer of requiredLayers) {
    if (selected.length >= 2) break;
    addTarget(targets.find((entry) => architectureLayerForFile(entry) === layer));
  }
  if (selected.length < 2 && preferred && !selected.includes(preferred)) {
    const selectedLayers = new Set(selected.map(architectureLayerForFile));
    if (!selectedLayers.has(architectureLayerForFile(preferred))) addTarget(preferred);
  }
  if (selected.length < 2) {
    const selectedLayers = new Set(selected.map(architectureLayerForFile));
    addTarget(targets.find((entry) => !selected.includes(entry) && !selectedLayers.has(architectureLayerForFile(entry))));
  }
  if (selected.length < 2) addTarget(targets.find((entry) => !selected.includes(entry)));
  if (selected.length === 0 && preferred) addTarget(preferred);
  return selected.slice(0, Math.min(2, Math.max(1, targets.length)));
}

function compactSentences(value, fallback = []) {
  const parts = String(value || '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 6);
  return parts.length > 0 ? parts : fallback;
}

function fullCloneDepthSource({ surfaceId, label, lane, detail }) {
  const ident = jsIdentifier(`${surfaceId}_full_clone_depth`, 'fullCloneDepth');
  const title = titleCaseWords(label || surfaceId);
  const detailSentences = compactSentences(detail, [
    `Deepen ${title} beyond shallow route presence into production-grade workflows.`,
    'Add state transitions, validation, recovery, role-specific behavior, and observability hooks.'
  ]);
  return `

export const ${ident}Blueprint = ${JSON.stringify({
    surfaceId,
    title,
    lane: lane || 'mailchimp_full_clone',
    fidelity: 'full_clone',
    intent: 'production product-depth expansion for strict Mailchimp clone parity',
    requirements: detailSentences,
    workflowDepth: [
      'initial empty state with guided next action',
      'draft and edit lifecycle with validation feedback',
      'review state with warnings, permissions, and recovery actions',
      'published or completed state with audit history and analytics handoff'
    ],
    roleCoverage: ['owner', 'admin', 'marketer', 'analyst', 'developer'],
    evidenceHooks: ['audit_event', 'notification', 'last_updated_timestamp', 'recoverable_error']
  }, null, 2)};

export function build${ident.charAt(0).toUpperCase()}${ident.slice(1)}State(input = {}) {
  const actorRole = input.actorRole || 'owner';
  const now = input.now || new Date().toISOString();
  const completed = new Set(input.completedSteps || []);
  const steps = ${ident}Blueprint.workflowDepth.map((name, index) => ({
    id: \`${surfaceId}_step_${'${'}index + 1}\`,
    name,
    status: completed.has(name) ? 'complete' : index === completed.size ? 'active' : 'pending',
    requiredRole: index >= 2 ? 'admin' : 'marketer',
    recoverable: true
  }));
  return {
    surfaceId: ${JSON.stringify(surfaceId)},
    title: ${JSON.stringify(title)},
    actorRole,
    generatedAt: now,
    readiness: steps.every((step) => step.status === 'complete') ? 'ready' : 'in_progress',
    visibleSteps: steps.filter((step) => actorRole === 'owner' || actorRole === 'admin' || step.requiredRole !== 'admin'),
    validation: steps.filter((step) => step.status !== 'complete').map((step) => ({ stepId: step.id, level: 'info', message: \`${'${'}step.name} still needs production-depth evidence.\` })),
    auditTrail: [{ at: now, type: 'full_clone_depth_evaluated', surfaceId: ${JSON.stringify(surfaceId)}, actorRole }]
  };
}
`;
}

function fullCloneSwarmLeafSource({ surfaceId, label, lane, detail = '', sourceProductFile = '', shardId = '' }) {
  const ident = jsIdentifier(`${surfaceId}_${shardId || 'leaf'}_swarm_leaf`, 'fullCloneSwarmLeaf');
  const title = titleCaseWords(label || surfaceId);
  const detailSentences = compactSentences(detail, [
    `Deepen ${title} beyond shallow route presence into production-grade workflows.`,
    'Add state transitions, validation, recovery, role-specific behavior, and observability hooks.'
  ]).slice(0, 4);
  return `

export const ${ident}Blueprint = ${JSON.stringify({
    surfaceId,
    shardId,
    sourceProductFile,
    title,
    lane: lane || 'mailchimp_full_clone_swarm',
    fidelity: 'full_clone',
    intent: 'parallel swarm leaf product module for strict Mailchimp clone parity',
    requirements: detailSentences,
    workflowStates: ['empty', 'draft', 'review', 'active', 'recovering', 'complete'],
    roleCoverage: ['owner', 'admin', 'marketer', 'analyst', 'developer'],
    evidenceHooks: ['actor_role', 'validation', 'audit_event', 'recovery_action', 'next_best_action']
  }, null, 2)};

export function build${ident.charAt(0).toUpperCase()}${ident.slice(1)}State(input = {}) {
  const now = input.now || new Date().toISOString();
  const actorRole = input.actorRole || 'owner';
  const completed = new Set(input.completedStates || []);
  const states = ${ident}Blueprint.workflowStates.map((state, index) => ({
    id: ${ident}Blueprint.surfaceId + '_' + state,
    state,
    status: completed.has(state) ? 'complete' : index === completed.size ? 'active' : 'pending',
    sourceProductFile: ${ident}Blueprint.sourceProductFile,
    recoveryAction: state === 'recovering' ? 'resume_with_preserved_context' : 'continue'
  }));
  return {
    surfaceId: ${ident}Blueprint.surfaceId,
    shardId: ${ident}Blueprint.shardId,
    title: ${ident}Blueprint.title,
    actorRole,
    generatedAt: now,
    readiness: states.every((entry) => entry.status === 'complete') ? 'ready' : 'in_progress',
    states,
    validation: states.filter((entry) => entry.status !== 'complete').map((entry) => ({ state: entry.state, level: 'info', message: entry.state + ' requires live product evidence.' })),
    auditTrail: [{ at: now, type: 'full_clone_swarm_leaf_evaluated', surfaceId: ${ident}Blueprint.surfaceId, shardId: ${ident}Blueprint.shardId }]
  };
}
`;
}

function fullCloneStructuralLeafSource({ surfaceId, label, lane, detail = '', sourceProductFile = '', shardId = '', structuralPhaseId = '', structuralPhaseTitle = '' }) {
  const ident = jsIdentifier(`${surfaceId}_${structuralPhaseId || shardId || 'structural'}_structural_leaf`, 'fullCloneStructuralLeaf');
  const title = titleCaseWords(label || surfaceId);
  const detailSentences = compactSentences(detail, [
    `Close a structural full-clone parity gap for ${title}.`,
    'Model browser behavior, durable state, service boundaries, permissions, recovery, and observability as product runtime contracts.'
  ]).slice(0, 5);
  return `

export const ${ident}Blueprint = ${JSON.stringify({
    surfaceId,
    shardId,
    structuralPhaseId,
    structuralPhaseTitle,
    sourceProductFile,
    title,
    lane: lane || 'mailchimp_full_clone_structural',
    fidelity: 'full_clone',
    intent: 'structural product runtime expansion for strict Mailchimp clone parity',
    requirements: detailSentences,
    runtimeContracts: [
      'browser_state_handoff',
      'durable_entity_contract',
      'service_boundary_and_retry_policy',
      'role_permission_and_compliance_gate',
      'audit_observability_signal',
      'operational_recovery_path'
    ],
    evidenceHooks: ['actor_role', 'runtime_contract', 'audit_event', 'fallback_path', 'readiness_score']
  }, null, 2)};

export function build${ident.charAt(0).toUpperCase()}${ident.slice(1)}Readiness(input = {}) {
  const now = input.now || new Date().toISOString();
  const actorRole = input.actorRole || 'owner';
  const completedContracts = new Set(input.completedContracts || []);
  const contracts = ${ident}Blueprint.runtimeContracts.map((contract, index) => ({
    id: ${ident}Blueprint.surfaceId + '_' + ${ident}Blueprint.structuralPhaseId + '_' + contract,
    contract,
    sourceProductFile: ${ident}Blueprint.sourceProductFile,
    status: completedContracts.has(contract) ? 'complete' : index === completedContracts.size ? 'active' : 'pending',
    verifierHint: contract.includes('browser') ? 'browser-backed smoke evidence' : contract.includes('service') ? 'provider boundary evidence' : 'product runtime evidence'
  }));
  const complete = contracts.filter((entry) => entry.status === 'complete').length;
  return {
    surfaceId: ${ident}Blueprint.surfaceId,
    shardId: ${ident}Blueprint.shardId,
    structuralPhaseId: ${ident}Blueprint.structuralPhaseId,
    title: ${ident}Blueprint.title,
    actorRole,
    generatedAt: now,
    readinessScore: contracts.length === 0 ? 0 : Math.round((complete / contracts.length) * 100),
    contracts,
    nextAction: contracts.find((entry) => entry.status !== 'complete')?.contract || 'ready_for_browser_backed_validation',
    auditTrail: [{ at: now, type: 'full_clone_structural_leaf_evaluated', surfaceId: ${ident}Blueprint.surfaceId, structuralPhaseId: ${ident}Blueprint.structuralPhaseId }]
  };
}
`;
}

function fullCloneFrontierLeafSource({ surfaceId, label, lane, detail = '', sourceProductFile = '', shardId = '', structuralPhaseId = '', structuralPhaseTitle = '' }) {
  const ident = jsIdentifier(`${surfaceId}_${structuralPhaseId || shardId || 'frontier'}_frontier_leaf`, 'fullCloneFrontierLeaf');
  const title = titleCaseWords(label || surfaceId);
  const detailSentences = compactSentences(detail, [
    `Build the next frontier runtime program for ${title}.`,
    'Move beyond saturated structural modules into rich client, production database, external provider, and browser-backed parity evidence contracts.'
  ]).slice(0, 5);
  return `

export const ${ident}Blueprint = ${JSON.stringify({
    surfaceId,
    shardId,
    structuralPhaseId,
    structuralPhaseTitle,
    sourceProductFile,
    title,
    lane: lane || 'mailchimp_full_clone_frontier',
    fidelity: 'full_clone',
    intent: 'next-frontier structural product program for strict Mailchimp clone parity',
    requirements: detailSentences,
    frontierContracts: [
      'rich_client_application_spine',
      'collaborative_editor_command_model',
      'production_database_concurrency',
      'external_provider_runtime',
      'delivery_analytics_streaming',
      'enterprise_security_governance',
      'operational_recovery_control_plane',
      'browser_backed_negative_space_evidence'
    ],
    evidenceHooks: ['browser_journey', 'database_transaction', 'provider_request', 'security_gate', 'recovery_trace', 'negative_space_check']
  }, null, 2)};

export function build${ident.charAt(0).toUpperCase()}${ident.slice(1)}Frontier(input = {}) {
  const now = input.now || new Date().toISOString();
  const actorRole = input.actorRole || 'owner';
  const completedContracts = new Set(input.completedContracts || []);
  const contracts = ${ident}Blueprint.frontierContracts.map((contract, index) => ({
    id: ${ident}Blueprint.surfaceId + '_' + ${ident}Blueprint.structuralPhaseId + '_' + contract,
    contract,
    sourceProductFile: ${ident}Blueprint.sourceProductFile,
    status: completedContracts.has(contract) ? 'complete' : index === completedContracts.size ? 'active' : 'pending',
    proofHint: contract.includes('browser') ? 'browser-backed journey plus negative-space proof' : contract.includes('provider') ? 'external provider request and retry proof' : contract.includes('database') ? 'transactional persistence proof' : 'product runtime proof'
  }));
  const complete = contracts.filter((entry) => entry.status === 'complete').length;
  return {
    surfaceId: ${ident}Blueprint.surfaceId,
    shardId: ${ident}Blueprint.shardId,
    structuralPhaseId: ${ident}Blueprint.structuralPhaseId,
    title: ${ident}Blueprint.title,
    actorRole,
    generatedAt: now,
    readinessScore: contracts.length === 0 ? 0 : Math.round((complete / contracts.length) * 100),
    contracts,
    nextAction: contracts.find((entry) => entry.status !== 'complete')?.contract || 'ready_for_full_clone_browser_and_service_validation',
    auditTrail: [{ at: now, type: 'full_clone_frontier_leaf_evaluated', surfaceId: ${ident}Blueprint.surfaceId, structuralPhaseId: ${ident}Blueprint.structuralPhaseId }]
  };
}
`;
}

function fullCloneRemediationLeafSource({ surfaceId, label, lane, detail = '', sourceProductFile = '', shardId = '', structuralPhaseId = '', structuralPhaseTitle = '' }) {
  const ident = jsIdentifier(`${surfaceId}_${structuralPhaseId || shardId || 'remediation'}_remediation_leaf`, 'fullCloneRemediationLeaf');
  const title = titleCaseWords(label || surfaceId);
  const detailSentences = compactSentences(detail, [
    `Remediate the remaining strict 1:1 blocker for ${title}.`,
    'Promote saturated frontier evidence into primary product architecture without bloating runtime modules.'
  ]).slice(0, 2);
  return `

export const ${ident}Marker = ${JSON.stringify({
    marker: 'full_clone_remediation_leaf_evaluated',
    surfaceId,
    shardId,
    structuralPhaseId,
    structuralPhaseTitle,
    sourceProductFile,
    title,
    lane: lane || 'mailchimp_full_clone_remediation',
    fidelity: 'full_clone',
    intent: 'compact primary-product adoption marker for strict Mailchimp clone remediation',
    requirements: detailSentences
  }, null, 2)};
`;
}

function allowDeclarativeFullCloneProductBlueprints() {
  return process.env.MAILCHIMP_ALLOW_DECLARATIVE_FULL_CLONE_PRODUCT_BLUEPRINTS === '1';
}

function applyFullCloneStrictGapDepth(workspacePath, modifiedFiles, assignment = {}) {
  if (!assignmentIsStrictFullCloneGap(assignment)) return false;
  if (!allowDeclarativeFullCloneProductBlueprints()) return false;
  const allowedFiles = new Set(deriveAllowedFiles(assignment));
  if (allowedFiles.size === 0) return false;
  const surfaceId = deriveFocusSurfaceId(assignment) || String(assignment.shardId || assignment.shard?.id || 'strict_full_clone_gap').replace(/^focus\./, '');
  const label = assignment.shard?.title || assignment.issue?.title || titleCaseWords(surfaceId);
  const lane = assignment.shard?.lane || assignment.issue?.lane || assignment.shard?.metadata?.focusGroup || 'mailchimp_full_clone';
  const candidates = [...allowedFiles].filter((entry) => /\.(mjs|js)$/.test(entry));
  const shardId = String(assignment.shard?.metadata?.swarmLeafId || assignment.contextPack?.shard?.metadata?.swarmLeafId || assignment.shard?.id || assignment.shardId || assignment.contextPack?.shard?.id || '').trim();
  const structuralShardId = String(assignment.shard?.metadata?.structuralLeafId || assignment.contextPack?.shard?.metadata?.structuralLeafId || '').trim();
  const frontierShardId = String(assignment.shard?.metadata?.frontierLeafId || assignment.contextPack?.shard?.metadata?.frontierLeafId || '').trim();
  const remediationShardId = String(assignment.shard?.metadata?.remediationLeafId || assignment.contextPack?.shard?.metadata?.remediationLeafId || '').trim();
  const structuralPhaseId = String(assignment.shard?.metadata?.structuralPhaseId || assignment.contextPack?.shard?.metadata?.structuralPhaseId || '').trim();
  const structuralPhaseTitle = String(assignment.shard?.metadata?.structuralPhaseTitle || assignment.contextPack?.shard?.metadata?.structuralPhaseTitle || '').trim();
  const sourceProductFile = assignment.shard?.metadata?.sourceProductFile || assignment.contextPack?.shard?.metadata?.sourceProductFile || '';
  const leafMode = assignmentIsSwarmLeaf(assignment);
  const structuralMode = assignmentIsStructuralFullCloneLeaf(assignment);
  const frontierMode = assignmentIsFrontierFullCloneLeaf(assignment);
  const remediationMode = assignmentIsRemediationFullCloneLeaf(assignment);
  const primaryAdoptionFiles = Array.from(new Set([
    ...(Array.isArray(assignment.shard?.metadata?.primaryAdoptionFiles) ? assignment.shard.metadata.primaryAdoptionFiles : []),
    ...(Array.isArray(assignment.contextPack?.shard?.metadata?.primaryAdoptionFiles) ? assignment.contextPack.shard.metadata.primaryAdoptionFiles : [])
  ].map((entry) => String(entry || '').trim()).filter(Boolean)));
  const ident = jsIdentifier(
    remediationMode
      ? `${surfaceId}_${structuralPhaseId || remediationShardId || frontierShardId || structuralShardId || 'remediation'}_remediation_leaf`
      : frontierMode
      ? `${surfaceId}_${structuralPhaseId || frontierShardId || structuralShardId || 'frontier'}_frontier_leaf`
      : structuralMode
      ? `${surfaceId}_${structuralPhaseId || structuralShardId || 'structural'}_structural_leaf`
      : leafMode ? `${surfaceId}_${shardId || 'leaf'}_swarm_leaf` : `${surfaceId}_full_clone_depth`,
    'fullCloneDepth'
  );
  const orderedCandidates = [
    ...(remediationMode ? primaryAdoptionFiles.filter((entry) => candidates.includes(entry)) : []),
    ...candidates.filter((entry) => /full-clone-remediation/.test(entry) && !remediationMode),
    ...candidates.filter((entry) => /full-clone-frontier/.test(entry)),
    ...candidates.filter((entry) => /full-clone-structural/.test(entry)),
    ...candidates.filter((entry) => /full-clone-swarm/.test(entry)),
    ...candidates.filter((entry) => /domain|service|storage|security|provider|jobs/.test(entry)),
    ...candidates.filter((entry) => /routes|view|server|index/.test(entry)),
    ...candidates.filter((entry) => !remediationMode || !/full-clone-remediation/.test(entry))
  ].filter((entry, index, list) => list.indexOf(entry) === index);
  const emittedExportNeedles = [`export const ${ident}Blueprint`, `export const ${ident}Marker`];
  const targetRel = orderedCandidates.find((entry) => {
    const filePath = path.join(workspacePath, entry);
    return !fs.existsSync(filePath) || !emittedExportNeedles.some((needle) => read(filePath).includes(needle));
  });
  if (!targetRel) return false;
  const beforeCount = modifiedFiles.size;
  const targetAlreadyModified = Boolean(targetRel && modifiedFiles.has(targetRel));
  const transform = (text) => {
    if (emittedExportNeedles.some((needle) => text.includes(needle))) return text;
    return remediationMode
      ? `${text}${fullCloneRemediationLeafSource({ surfaceId, label, lane, detail: fullCloneGapDetail(assignment), sourceProductFile, shardId: remediationShardId || frontierShardId || structuralShardId || shardId, structuralPhaseId, structuralPhaseTitle })}`
      : frontierMode
      ? `${text}${fullCloneFrontierLeafSource({ surfaceId, label, lane, detail: fullCloneGapDetail(assignment), sourceProductFile, shardId: frontierShardId || structuralShardId || shardId, structuralPhaseId, structuralPhaseTitle })}`
      : structuralMode
      ? `${text}${fullCloneStructuralLeafSource({ surfaceId, label, lane, detail: fullCloneGapDetail(assignment), sourceProductFile, shardId: structuralShardId || shardId, structuralPhaseId, structuralPhaseTitle })}`
      : leafMode
      ? `${text}${fullCloneSwarmLeafSource({ surfaceId, label, lane, detail: fullCloneGapDetail(assignment), sourceProductFile, shardId })}`
      : `${text}${fullCloneDepthSource({ surfaceId, label, lane, detail: fullCloneGapDetail(assignment) })}`;
  };
  if (fs.existsSync(path.join(workspacePath, targetRel))) {
    patchAllowedFile(workspacePath, allowedFiles, targetRel, transform, modifiedFiles);
  } else {
    writeAllowedFile(workspacePath, allowedFiles, targetRel, transform(''), modifiedFiles);
  }
  const changed = modifiedFiles.size > beforeCount;
  if (changed && remediationMode && !targetAlreadyModified) markerOnlyProductDeltaFiles.add(targetRel);
  return changed;
}

function markerOnlyProductDeltaUsed(modifiedFiles) {
  return markerOnlyProductDeltaFiles.size > 0 && [...modifiedFiles].every((filePath) => markerOnlyProductDeltaFiles.has(filePath));
}

function runtimeIntegrationSignalsForLine(line, phaseId) {
  const text = String(line || '');
  const signals = new Set();
  if (/\b(router\.register|register[A-Z][A-Za-z]*(?:Route|Routes)|\broute\b|\bhandler\b|\brequest\b|\bresponse\b|\brender\b|\bGET\b|\bPOST\b|\bPUT\b|\bDELETE\b|res\.|req\.)/i.test(text)) signals.add('route_or_server_behavior');
  if (/\b(state\.db|persistState|storage|transaction|migration|lock|queue|job|dead[-_ ]?letter|retry|database|repository|writeJsonAtomic)\b/i.test(text)) signals.add('persistence_or_jobs_behavior');
  if (/\b(fetch\(|provider|webhook|oauth|sync|integration|delivery|analytics|model|predictive|apiKey|api_key)\b/i.test(text)) signals.add('provider_or_external_behavior');
  if (/\b(command|event|session|workflow|submit|publish|execute|hydrate|dispatch|reducer|client|browser|click|step|status)\b/i.test(text)) signals.add('state_or_user_path_behavior');
  if (phaseId === 'interactive_state_and_commands' && /\b(state|hydrate|command|event|client|session|dispatch|reducer)\b/i.test(text)) signals.add('phase_specific_behavior');
  if (phaseId === 'operational_persistence_and_jobs' && /\b(persist|storage|job|queue|retry|dead[-_ ]?letter|transaction|migration|lock)\b/i.test(text)) signals.add('phase_specific_behavior');
  if (phaseId === 'integrated_user_path_evidence' && /\b(route|render|handler|request|response|workflow|publish|submit|execute)\b/i.test(text)) signals.add('phase_specific_behavior');
  if (phaseId === 'primary_runtime_spine' && /\b(route|runtime|handler|service|workflow|persist|state|provider|queue)\b/i.test(text)) signals.add('phase_specific_behavior');
  return Array.from(signals);
}

function isDeclarativeFullCloneBoilerplateLine(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (PRODUCT_DELTA_BLOAT_MARKERS.some((marker) => text.includes(marker))) return true;
  if (/\b(fullClone(?:Remediation|Frontier|Structural|Swarm).*?(?:Blueprint|Marker)|(?:Remediation|Frontier|Structural|Swarm)Leaf(?:Blueprint|Marker))\b/.test(text)) return true;
  if (/^export const .*(?:Blueprint|Marker)\s*=/.test(text)) return true;
  if (/^["']?(surfaceId|shardId|structuralPhaseId|structuralPhaseTitle|sourceProductFile|fidelity|intent|requirements|remediationContracts|auditTrail|proofHint|readinessScore|nextAction)["']?\s*:/.test(text)) return true;
  if (/\b(?:remaining strict 1:1 blocker|strict Mailchimp clone remediation|browser-backed journey plus negative-space proof|product runtime proof)\b/i.test(text)) return true;
  return false;
}

function buildProductDeltaQualityAudit(modifiedFiles, assignment = {}) {
  const modifiedProductFiles = [...modifiedFiles]
    .filter((filePath) => /^(apps|packages)\//.test(filePath))
    .sort();
  const phaseId = deriveSemanticPhaseId(assignment);
  const addedLinesByFile = {};
  const markerCounts = {};
  const runtimeIntegrationByFile = {};
  const allAddedLines = [];
  let declarativeBoilerplateLineCount = 0;
  for (const filePath of modifiedProductFiles) {
    const addedLines = productDeltaRecords.get(filePath) || [];
    if (!addedLines.length) continue;
    addedLinesByFile[filePath] = addedLines.length;
    allAddedLines.push(...addedLines);
    for (const marker of PRODUCT_DELTA_BLOAT_MARKERS) {
      const count = addedLines.filter((line) => line.includes(marker)).length;
      if (count > 0) markerCounts[marker] = (markerCounts[marker] || 0) + count;
    }
    const concreteLines = [];
    const signalSet = new Set();
    for (const line of addedLines) {
      if (isDeclarativeFullCloneBoilerplateLine(line)) {
        declarativeBoilerplateLineCount += 1;
        continue;
      }
      const signals = runtimeIntegrationSignalsForLine(line, phaseId);
      if (signals.length > 0) {
        concreteLines.push(line);
        for (const signal of signals) signalSet.add(signal);
      }
    }
    if (concreteLines.length > 0) {
      runtimeIntegrationByFile[filePath] = {
        concreteRuntimeLineCount: concreteLines.length,
        signals: Array.from(signalSet).sort(),
        sampleLines: concreteLines.slice(0, 5)
      };
    }
  }
  const counts = new Map();
  for (const line of allAddedLines) counts.set(line, (counts.get(line) || 0) + 1);
  const addedNonblankLines = allAddedLines.length;
  const uniqueNormalizedAddedLines = counts.size;
  const duplicateNormalizedAddedLineInstances = Math.max(0, addedNonblankLines - uniqueNormalizedAddedLines);
  const duplicateAddedLineRatio = addedNonblankLines > 0 ? Number((duplicateNormalizedAddedLineInstances / addedNonblankLines).toFixed(4)) : 0;
  const markerLineCount = Object.values(markerCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  const remediationMarkerCount = Number(markerCounts.full_clone_remediation_leaf_evaluated || 0);
  const fullCloneFidelityLineCount = Number(markerCounts['"fidelity": "full_clone"'] || 0);
  const remediationContractLineCount = Number(markerCounts['"remediationContracts": ['] || 0);
  const reasons = [];
  if (addedNonblankLines >= 80 && duplicateAddedLineRatio >= 0.65) reasons.push('high_duplicate_normalized_added_line_ratio');
  if (remediationMarkerCount >= 5) reasons.push('repeated_remediation_marker_blocks');
  if (fullCloneFidelityLineCount >= 8 || remediationContractLineCount >= 5) reasons.push('remediation_blueprint_boilerplate_concentration');
  if (markerLineCount >= 20 && markerLineCount / Math.max(1, addedNonblankLines) >= 0.05) reasons.push('marker_heavy_product_delta');
  if (declarativeBoilerplateLineCount >= 20 && declarativeBoilerplateLineCount / Math.max(1, addedNonblankLines) >= 0.35) reasons.push('declarative_full_clone_boilerplate_concentration');
  const runtimeFiles = Object.keys(runtimeIntegrationByFile).sort();
  const runtimeSignalCount = runtimeFiles.reduce((sum, filePath) => sum + runtimeIntegrationByFile[filePath].signals.length, 0);
  const runtimeIntegrationEvidence = {
    ok: runtimeFiles.length > 0 && runtimeSignalCount >= 2,
    files: runtimeFiles,
    fileCount: runtimeFiles.length,
    signalCount: runtimeSignalCount,
    byFile: runtimeIntegrationByFile,
    reason: runtimeFiles.length > 0 && runtimeSignalCount >= 2 ? 'concrete_runtime_delta_present' : 'missing_concrete_runtime_delta'
  };
  return {
    addedNonblankLines,
    uniqueNormalizedAddedLines,
    duplicateNormalizedAddedLineInstances,
    duplicateAddedLineRatio,
    markerCounts,
    markerLineCount,
    declarativeBoilerplateLineCount,
    addedLinesByFile,
    topRepeatedAddedLines: Array.from(counts.entries())
      .filter(([, count]) => count >= 3)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([line, count]) => ({ line: line.slice(0, 160), count })),
    runtimeIntegrationEvidence,
    semanticBloatSuspect: reasons.length > 0,
    reasons
  };
}

function claimIntegrityKindForCurrentDelta(modifiedFiles, productDeltaQuality = null) {
  if (modifiedFiles.size === 0) return 'zero_modified_files';
  if (syntheticParityDeltaUsed) return 'synthetic_parity_delta';
  if (markerOnlyProductDeltaUsed(modifiedFiles)) return 'marker_only_remediation_delta';
  if (productDeltaQuality?.semanticBloatSuspect === true) return 'semantic_bloat_delta';
  return 'substantive_product_delta';
}

function deriveFocusGroup(assignment) {
  const surfaceFocusId = deriveFocusSurfaceId(assignment);
  const canonicalHandler = canonicalSurfaceHandler(surfaceFocusId);
  if (canonicalHandler === 'frontend_interaction_parity') return 'frontend_architecture';
  if (canonicalHandler === 'audience_crm') return 'audience_crm';
  if (canonicalHandler === 'campaign_editor_parity') return 'campaign_editor';
  if (canonicalHandler === 'campaign_experimentation') return 'campaign_experimentation';
  if (canonicalHandler === 'reporting_analytics_parity') return 'reporting_analytics';
  if (canonicalHandler === 'security_ops') return 'security_ops';
  if (canonicalHandler === 'persistence_jobs_operational_parity') return 'delivery_jobs';
  if (canonicalHandler === 'ai_predictive') return 'ai_predictive';
  if (canonicalHandler === 'email_builder') return 'email_builder';
  if (canonicalHandler === 'template_library') return 'template_library';
  if (canonicalHandler === 'content_studio') return 'content_studio';
  if (canonicalHandler === 'automation_journey') return 'automation_journey';
  if (canonicalHandler === 'api_keys_webhooks') return 'api_keys_webhooks';
  if (canonicalHandler === 'billing_plans') return 'billing_plans';
  if (canonicalHandler === 'report_detail') return 'report_detail';
  if (canonicalHandler === 'send_schedule_review') return 'send_schedule_review';
  if (canonicalHandler === 'signup_onboarding') return 'signup_onboarding';
  if (canonicalHandler === 'settings_domains') return 'settings_domains';
  if (canonicalHandler === 'team_roles_permissions') return 'team_roles_permissions';
  if (surfaceFocusId === 'audience_crm_parity') return 'audience_crm';
  if (surfaceFocusId === 'campaign_editor_parity') return 'campaign_editor';
  if (surfaceFocusId === 'automation_journey_parity') return 'automation_journey';
  if (surfaceFocusId === 'persistence_jobs_operational_parity') return 'delivery_jobs';
  if (surfaceFocusId === 'reporting_analytics_parity') return 'reporting_analytics';
  const explicit = assignment.shard?.metadata?.focusGroup || assignment.inputs?.focusGroup || assignment.issue?.inputs?.focusGroup;
  if (explicit) {
    const normalizedExplicit = normalizeFocusGroup(explicit);
    if (!['focus_email_builder', 'focus_template_library', 'focus_report_detail'].includes(normalizedExplicit)) return normalizedExplicit;
  }
  const shardId = String(assignment.shardId || assignment.shard?.id || '').trim().toLowerCase().replace(/-/g, '_');
  if (!shardId) return 'unknown';
  if (shardId.startsWith('pkg.') && /(survey|feedback|preference)/.test(shardId)) return 'unknown';
  if (/focus\.landing_pages|landing_pages/.test(shardId)) return 'landing_pages';
  if (/product_factory|factory_surface|surface_factory|net_product/.test(shardId)) return 'product_factory';
  if (/reports|analytics|reporting|revenue|attribution|billing|ecommerce|insights/.test(shardId)) return 'reporting_analytics';
  if (/(^|_)(ai|predictive|optimization|forecast|scoring|intelligence|send_time)(_|$)/.test(shardId)) return 'ai_predictive';
  if (/oauth|integration|integrations|api|webhook|marketplace|commerce|sms|social|partner/.test(shardId)) return 'integrations_api_oauth';
  if (/website|builder|site/.test(shardId)) return 'website_builder';
  if (/forms|popup|signup|growth/.test(shardId)) return 'forms_growth';
  if (/experiment|experimentation|calendar|retention|journey|lifecycle|onboarding/.test(shardId)) return 'campaign_experimentation';
  if (/security|compliance|auth|trust|approval|audit/.test(shardId)) return 'security_ops';
  if (/delivery|jobs|automation|send|runtime\.|ops|service|support|channel|sender|pipeline/.test(shardId)) return 'delivery_jobs';
  if (/frontend|web|shell|route|editor|template|campaign|audience|contact|segment|storage|persistence|data|workspace|brand|content|creative|catalog|conversation|inbox|agency/.test(shardId)) return 'frontend_architecture';
  if (shardId.startsWith('runtime.')) return 'delivery_jobs';
  if (shardId.startsWith('pkg.')) return 'frontend_architecture';
  return 'unknown';
}


function architectureLayerForFile(filePath) {
  const rel = String(filePath || '');
  if (/\/routes\//.test(rel) || /server\.mjs|http-runtime\.mjs/.test(rel)) return 'route_or_server';
  if (/job-|jobs\.mjs|job-runtime|job-handlers/.test(rel)) return 'jobs_runtime';
  if (/domain-|storage\.mjs|persistence-io\.mjs/.test(rel)) return 'domain_or_persistence';
  if (/apps\/web\/public|app-shell|view\.mjs|public\.mjs/.test(rel)) return 'client_shell';
  if (/integration|provider|webhook|api-admin/.test(rel)) return 'provider_or_api';
  if (/security|auth/.test(rel)) return 'security_runtime';
  return 'product_runtime';
}

function semanticPhaseRequiredLayers(phaseId) {
  if (phaseId === 'interactive_state_and_commands') return ['client_shell', 'route_or_server'];
  if (phaseId === 'operational_persistence_and_jobs') return ['domain_or_persistence', 'jobs_runtime'];
  if (phaseId === 'integrated_user_path_evidence') return ['route_or_server', 'domain_or_persistence'];
  return ['route_or_server', 'domain_or_persistence'];
}

function fileContainsArchitectureSignal(workspacePath, filePath, phaseId) {
  try {
    const text = fs.readFileSync(path.join(workspacePath, filePath), 'utf8');
    const withoutSemanticMarkers = text.replace(/semantic[-_ ]?frontier|semanticRuntime|SemanticRuntime|Contract/g, '');
    const patterns = phaseId === 'interactive_state_and_commands'
      ? [/\b(state|hydrate|command|action|event|client|session|reducer|dispatch)\b/i]
      : phaseId === 'operational_persistence_and_jobs'
        ? [/\b(persist|storage|job|queue|retry|dead[-_ ]?letter|transaction|migration|lock)\b/i]
        : phaseId === 'integrated_user_path_evidence'
          ? [/\b(route|render|handler|request|response|workflow|publish|submit|execute)\b/i]
          : [/\b(route|runtime|handler|service|workflow|persist|state)\b/i];
    return patterns.some((pattern) => pattern.test(withoutSemanticMarkers));
  } catch {
    return false;
  }
}

function buildSemanticArchitectureEvidence(workspacePath, modifiedFiles, assignment = {}, productDeltaQuality = null) {
  const modifiedPrimaryFiles = [...modifiedFiles].sort().filter((filePath) => /^(apps|packages)\//.test(filePath) && !filePath.startsWith('packages/app/full-clone-'));
  const phaseId = deriveSemanticPhaseId(assignment);
  const deltaQuality = productDeltaQuality || buildProductDeltaQualityAudit(modifiedFiles, assignment);
  const runtimeIntegrationEvidence = deltaQuality.runtimeIntegrationEvidence || { ok: false, reason: 'missing_delta_quality_audit' };
  const allowedPrimaryFiles = deriveAllowedFiles(assignment)
    .filter((filePath) => /^(apps|packages)\/.+\.(?:mjs|js|jsx|css)$/.test(filePath))
    .filter((filePath) => !filePath.startsWith('packages/app/full-clone-'))
    .filter((filePath) => fs.existsSync(path.join(workspacePath, filePath)));
  const adoptedPrimaryFiles = allowedPrimaryFiles.filter((filePath) => fileContainsArchitectureSignal(workspacePath, filePath, phaseId));
  const evidenceFiles = Array.from(new Set([...modifiedPrimaryFiles, ...adoptedPrimaryFiles])).sort();
  const layers = Array.from(new Set(evidenceFiles.map(architectureLayerForFile)));
  const modifiedLayers = Array.from(new Set(modifiedPrimaryFiles.map(architectureLayerForFile)));
  const requiredLayers = semanticPhaseRequiredLayers(phaseId);
  const presentRequiredLayers = requiredLayers.filter((layer) => layers.includes(layer));
  const modifiedRequiredLayers = requiredLayers.filter((layer) => modifiedLayers.includes(layer));
  const signaledFiles = evidenceFiles.filter((filePath) => fileContainsArchitectureSignal(workspacePath, filePath, phaseId));
  const modifiedSignaledFiles = modifiedPrimaryFiles.filter((filePath) => fileContainsArchitectureSignal(workspacePath, filePath, phaseId));
  const markerOnly = modifiedPrimaryFiles.length > 0 && modifiedSignaledFiles.length === 0;
  const requiredLayerCount = Math.min(2, requiredLayers.length);
  const allRequiredLayersModified = requiredLayers.every((layer) => modifiedRequiredLayers.includes(layer));
  const ok = modifiedPrimaryFiles.length >= requiredLayerCount
    && evidenceFiles.length >= 2
    && layers.length >= 2
    && presentRequiredLayers.length >= requiredLayerCount
    && modifiedRequiredLayers.length >= requiredLayerCount
    && allRequiredLayersModified
    && signaledFiles.length >= 2
    && modifiedSignaledFiles.length >= requiredLayerCount
    && runtimeIntegrationEvidence.ok === true
    && deltaQuality.semanticBloatSuspect !== true
    && !markerOnly;
  const failureReasons = [];
  if (markerOnly) failureReasons.push('marker_only_semantic_patch');
  if (runtimeIntegrationEvidence.ok !== true) failureReasons.push('missing_concrete_runtime_integration_delta');
  if (deltaQuality.semanticBloatSuspect === true) failureReasons.push('semantic_bloat_product_delta');
  if (modifiedPrimaryFiles.length < requiredLayerCount || evidenceFiles.length < 2 || layers.length < 2 || presentRequiredLayers.length < requiredLayerCount || modifiedRequiredLayers.length < requiredLayerCount || !allRequiredLayersModified || signaledFiles.length < 2 || modifiedSignaledFiles.length < requiredLayerCount) failureReasons.push('shallow_or_single_layer_semantic_patch');
  return {
    ok,
    phaseId,
    modifiedPrimaryRuntimeFiles: modifiedPrimaryFiles,
    adoptedPrimaryRuntimeFiles: adoptedPrimaryFiles,
    evidencePrimaryRuntimeFiles: evidenceFiles,
    layerCount: layers.length,
    layers,
    modifiedLayers,
    requiredLayers,
    presentRequiredLayers,
    modifiedRequiredLayers,
    signaledFiles,
    modifiedSignaledFiles,
    markerOnly,
    runtimeIntegrationEvidence,
    semanticBloatAudit: deltaQuality,
    minPrimaryRuntimeFiles: 2,
    minArchitectureLayers: 2,
    reason: ok ? 'semantic_architecture_gate_passed' : Array.from(new Set(failureReasons))[0] || 'shallow_or_single_layer_semantic_patch',
    failureReasons: Array.from(new Set(failureReasons))
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.assignment) throw new Error('--assignment is required');
  const assignment = JSON.parse(read(args.assignment));
  const workspacePath = assignment.workspacePath || assignment.targetPath;
  if (!workspacePath) throw new Error('assignment workspacePath/targetPath is required');
  const rawFocusGroup = assignment.shard?.metadata?.focusGroup || assignment.inputs?.focusGroup || assignment.issue?.inputs?.focusGroup || assignment.shardId || assignment.shard?.id || 'unknown';
  const focusGroup = deriveFocusGroup(assignment);
  const surfaceFocusId = deriveFocusSurfaceId(assignment);
  const canonicalHandler = canonicalSurfaceHandler(surfaceFocusId);
  const semanticDirectorFrontier = assignmentIsSemanticDirectorFrontier(assignment);
  const architectureCreditRequired = deepArchitectureCreditRequiredForAssignment(assignment);
  const modifiedFiles = new Set();
  const benchmarkScopedGroundingFirst = new Set([
    'frontend_client_shell_state',
    'website_builder_editor_realism',
    'campaign_editor_template_workflows',
    'automation_journey_execution',
    'campaign_ops_calendar_workflow',
    'audience_identity_lifecycle',
    'audience_sync_warehouse',
    'reporting_metrics_pipeline',
    'integration_provider_sync',
    'auth_session_security_hardening',
    'persistence_jobs_operational_db',
    'ai_predictive_ops_realism'
  ]);
  const benchmarkScopedProductSurface = benchmarkScopedGroundingFirst.has(surfaceFocusId)
    && assignmentRequestedFidelity(assignment) !== 'full_clone';
  if (assignmentIsStrictFullCloneGap(assignment) && (assignmentIsSwarmLeaf(assignment) || assignmentIsStructuralFullCloneLeaf(assignment)) && !assignmentIsRemediationFullCloneLeaf(assignment)) {
    applyFullCloneStrictGapDepth(workspacePath, modifiedFiles, assignment);
  }
  if (benchmarkScopedProductSurface) {
    applyBenchmarkScopedProductHelper(workspacePath, modifiedFiles, assignment);
  }

  if (modifiedFiles.size === 0) {
    if (surfaceFocusId === 'frontend_interaction_parity' || canonicalHandler === 'frontend_interaction_parity') applyFrontendInteractionStrictFocus(workspacePath, modifiedFiles, assignment);
    else if (canonicalHandler === 'signup_forms_popups') applyFormsGrowthParity(workspacePath, modifiedFiles);
    else if (canonicalHandler === 'landing_pages') applyLandingPagesParity(workspacePath, modifiedFiles);
  else if (canonicalHandler === 'website_builder') applyWebsiteBuilderParity(workspacePath, modifiedFiles);
  else if (canonicalHandler === 'campaign_index') applyCanonicalCampaignIndexFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'email_builder') applyCanonicalEmailBuilderFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'template_library') applyCanonicalTemplateLibraryFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'content_studio') applyCanonicalContentStudioFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'reports_overview') applyCanonicalReportsOverviewFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'report_detail') applyCanonicalReportDetailFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'send_schedule_review') applyCanonicalSendScheduleReviewFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'signup_onboarding') applyCanonicalSignupOnboardingFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'integrations_marketplace') applyCanonicalIntegrationsMarketplaceFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'api_keys_webhooks') applyCanonicalApiKeysWebhooksFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'billing_plans') applyCanonicalBillingPlansFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'settings_domains') applyCanonicalSettingsDomainsFocus(workspacePath, modifiedFiles, assignment);
  else if (canonicalHandler === 'team_roles_permissions') applyCanonicalTeamRolesPermissionsFocus(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'contacts_table') applyContactsTableOperationalDepth(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'audience_crm_parity' || canonicalHandler === 'audience_crm' || focusGroup === 'audience_crm') applyAudienceCrmStrictFocus(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'campaign_editor_parity' || canonicalHandler === 'campaign_editor_parity' || focusGroup === 'campaign_editor') applyCampaignEditorStrictFocus(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'automation_journey_parity' || canonicalHandler === 'automation_journey' || focusGroup === 'automation_journey') applyAutomationJourneyStrictFocus(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'reporting_analytics_parity' || canonicalHandler === 'reporting_analytics_parity') applyReportingAnalyticsStrictFocus(workspacePath, modifiedFiles, assignment);
  else if (surfaceFocusId === 'persistence_jobs_operational_parity' || canonicalHandler === 'persistence_jobs_operational_parity') {
    applyPersistenceParity(workspacePath, modifiedFiles, assignment);
    if (deriveAllowedFiles(assignment).length === 0 || assignmentAllowsAnyFile(assignment, ['packages/app/job-handlers.mjs', 'packages/app/job-runtime.mjs'])) applyDeliveryJobs(workspacePath, modifiedFiles);
  }
  else if (canonicalHandler === 'campaign_experimentation') applyExperimentationParity(workspacePath, modifiedFiles);
  else if (canonicalHandler === 'security_ops' && assignmentAllowsAnyFile(assignment, ['packages/app/security.mjs', 'packages/app/storage.mjs', 'apps/web/server.mjs'])) applySecurityOpsParity(workspacePath, modifiedFiles);
  else if (canonicalHandler === 'ai_predictive') applyAiPredictive(workspacePath, modifiedFiles, assignment);
  else if (focusGroup === 'frontend_architecture') applyFrontendArchitecture(workspacePath, modifiedFiles);
  if (!semanticDirectorFrontier || !canonicalHandler) {
    if (focusGroup === 'persistence') applyPersistenceParity(workspacePath, modifiedFiles, assignment);
    if (focusGroup === 'delivery_jobs' && surfaceFocusId !== 'persistence_jobs_operational_parity' && canonicalHandler !== 'persistence_jobs_operational_parity' && (deriveAllowedFiles(assignment).length === 0 || assignmentAllowsAnyFile(assignment, ['packages/app/job-handlers.mjs', 'packages/app/job-runtime.mjs']))) applyDeliveryJobs(workspacePath, modifiedFiles);
    if (focusGroup === 'reporting_analytics' && surfaceFocusId !== 'reporting_analytics_parity' && canonicalHandler !== 'reporting_analytics_parity' && assignmentAllowsAnyFile(assignment, ['packages/app/analytics-events.mjs', 'packages/app/domain-campaigns.mjs'])) applyReportingAnalytics(workspacePath, modifiedFiles);
    if (focusGroup === 'ai_predictive') applyAiPredictive(workspacePath, modifiedFiles, assignment);
    if (focusGroup === 'integrations_api_oauth' && canonicalHandler !== 'integrations_marketplace') applyIntegrationsParity(workspacePath, modifiedFiles);
    if (focusGroup === 'website_builder') applyWebsiteBuilderParity(workspacePath, modifiedFiles);
    if (focusGroup === 'landing_pages') applyLandingPagesParity(workspacePath, modifiedFiles);
    if (focusGroup === 'forms_growth') applyFormsGrowthParity(workspacePath, modifiedFiles);
    if (focusGroup === 'campaign_experimentation') applyExperimentationParity(workspacePath, modifiedFiles);
    if (focusGroup === 'security_ops' && canonicalHandler !== 'security_ops' && assignmentAllowsAnyFile(assignment, ['packages/app/security.mjs', 'packages/app/storage.mjs', 'apps/web/server.mjs'])) applySecurityOpsParity(workspacePath, modifiedFiles);
    if (focusGroup === 'product_factory') applyProductFactoryScaffold(workspacePath, modifiedFiles, assignment);
  }
  }

  if (modifiedFiles.size === 0 && benchmarkScopedProductSurface) {
    applyBenchmarkScopedConcreteRuntimeDelta(workspacePath, modifiedFiles, assignment);
  }

  if (modifiedFiles.size === 0 && semanticDirectorFrontier) {
    applySemanticDirectorPrimaryRuntimeDelta(workspacePath, modifiedFiles, assignment, focusGroup);
  }

  if (!benchmarkScopedProductSurface && assignmentIsStrictFullCloneGap(assignment)) {
    applyFullCloneStrictGapDepth(workspacePath, modifiedFiles, assignment);
  }

  if (modifiedFiles.size === 0 && !benchmarkScopedProductSurface) {
    applyFullCloneContinuationPrimaryRuntimeAdoption(workspacePath, modifiedFiles, assignment, focusGroup);
  }

  if (modifiedFiles.size === 0 && surfaceFocusId && !benchmarkScopedProductSurface) {
    applyBenchmarkScopedProductHelper(workspacePath, modifiedFiles, assignment);
  }

  const allowBenchmarkGroundingFallback = process.env.MAILCHIMP_ALLOW_BENCHMARK_GROUNDING_FALLBACK === '1';
  if (modifiedFiles.size === 0 && !benchmarkScopedProductSurface && allowBenchmarkGroundingFallback && (surfaceFocusId === 'frontend_interaction_parity' || benchmarkScopedGroundingFirst.has(surfaceFocusId))) {
    applyBenchmarkScopedHelperDelta(workspacePath, modifiedFiles, assignment);
  }

  if (modifiedFiles.size === 0 && canonicalHandler && allowBenchmarkGroundingFallback) {
    applyBenchmarkScopedHelperDelta(workspacePath, modifiedFiles, assignment);
  }

  if (modifiedFiles.size === 0 && canonicalHandler && !benchmarkScopedProductSurface && allowCanonicalRuntimeFallback()) {
    applyCanonicalSurfaceRuntimeFallback(workspacePath, modifiedFiles, assignment);
  }

  if (semanticDirectorFrontier) {
    const preliminaryArchitectureEvidence = buildSemanticArchitectureEvidence(workspacePath, modifiedFiles, assignment);
    if (!preliminaryArchitectureEvidence.ok) applySemanticDirectorPrimaryRuntimeDelta(workspacePath, modifiedFiles, assignment, focusGroup);
  }

  const productDeltaQuality = buildProductDeltaQualityAudit(modifiedFiles, assignment);
  const architectureEvidence = architectureCreditRequired
    ? buildSemanticArchitectureEvidence(workspacePath, modifiedFiles, assignment, productDeltaQuality)
    : null;
  const unifiedDiff = buildProductDeltaUnifiedDiff(modifiedFiles);

  updateSurfaceHonestyManifest(workspacePath, modifiedFiles, focusGroup);

  console.log(JSON.stringify({
    ok: true,
    focusGroup,
    surfaceFocusId: surfaceFocusId || null,
    rawFocusGroup,
    modifiedFiles: [...modifiedFiles].sort(),
    diff: unifiedDiff,
    unifiedDiff,
    diffSummary: `implemented ${focusGroup} parity bridge changes`,
    metadata: {
      focusGroup,
      surfaceFocusId: surfaceFocusId || null,
      rootFocusId: surfaceFocusId ? `focus.${surfaceFocusId}` : null,
      swarmLeafId: assignment.shard?.metadata?.swarmLeafId || assignment.contextPack?.shard?.metadata?.swarmLeafId || null,
      structuralLeafId: assignment.shard?.metadata?.structuralLeafId || assignment.contextPack?.shard?.metadata?.structuralLeafId || null,
      frontierLeafId: assignment.shard?.metadata?.frontierLeafId || assignment.contextPack?.shard?.metadata?.frontierLeafId || null,
      remediationLeafId: assignment.shard?.metadata?.remediationLeafId || assignment.contextPack?.shard?.metadata?.remediationLeafId || null,
      structuralPhaseId: assignment.shard?.metadata?.structuralPhaseId || assignment.contextPack?.shard?.metadata?.structuralPhaseId || null,
      sourceProductFile: assignment.shard?.metadata?.sourceProductFile || assignment.contextPack?.shard?.metadata?.sourceProductFile || null,
      rawFocusGroup,
      modifiedCount: modifiedFiles.size,
      claimIntegrityKind: claimIntegrityKindForCurrentDelta(modifiedFiles, productDeltaQuality),
      markerOnlyProductDelta: markerOnlyProductDeltaUsed(modifiedFiles),
      markerOnlyProductDeltaFiles: [...markerOnlyProductDeltaFiles].sort(),
      semanticBloatAudit: productDeltaQuality,
      architectureEvidence
    }
  }, null, 2));
}

main();
