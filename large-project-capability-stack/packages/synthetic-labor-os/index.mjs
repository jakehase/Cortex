import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildProofCarryingClaimLedger, deriveMergeEligibility } from '../proof-carrying-claim-ledger/index.mjs';

export const SYNTHETIC_LABOR_OS_AUDIT_SCHEMA = 'claw.synthetic_labor_os.v0.audit';
export const SYNTHETIC_LABOR_OS_MATRIX_SCHEMA = 'claw.synthetic_labor_os.v0.capability_matrix';
export const SYNTHETIC_LABOR_OS_JOB_SCHEMA = 'claw.synthetic_labor_os.v0.job';
export const SYNTHETIC_LABOR_OS_OPERATOR_DASHBOARD_SCHEMA = 'claw.synthetic_labor_os.v0.operator_dashboard';
export const SYNTHETIC_LABOR_OS_REVIEW_SCHEMA = 'claw.synthetic_labor_os.v0.review';
export const SYNTHETIC_LABOR_OS_INTAKE_SCHEMA = 'claw.synthetic_labor_os.v0.intake_contract';
export const SYNTHETIC_LABOR_OS_QUEUE_SCHEMA = 'claw.synthetic_labor_os.v0.work_queue';
export const SYNTHETIC_LABOR_OS_TEST_CONTRACT_SCHEMA = 'claw.synthetic_labor_os.v0.test_contract';
export const SYNTHETIC_LABOR_OS_TEST_EVIDENCE_SCHEMA = 'claw.synthetic_labor_os.v0.test_evidence';
export const SYNTHETIC_LABOR_OS_IMPROVEMENT_LOOP_SCHEMA = 'claw.synthetic_labor_os.v0.improvement_loop';
export const SYNTHETIC_LABOR_OS_EXECUTION_PLANE_REGISTRY_SCHEMA = 'claw.synthetic_labor_os.v0.execution_plane_registry';
export const SYNTHETIC_LABOR_OS_TRUTH_DASHBOARD_SECTION_SCHEMA = 'claw.synthetic_labor_os.v0.truth_dashboard_section';
export const SYNTHETIC_LABOR_OS_DEMO_PROOF_SCHEMA = 'claw.synthetic_labor_os.v0.demo_proof';
export const SYNTHETIC_LABOR_OS_SCALE_PROOF_SCHEMA = 'claw.synthetic_labor_os.v0.scale_proof';
export const SYNTHETIC_LABOR_OS_EXECUTION_PLAN_SCHEMA = 'claw.synthetic_labor_os.v1.execution_plan';
export const SYNTHETIC_LABOR_OS_LOCAL_WORKER_RUN_SCHEMA = 'claw.synthetic_labor_os.v1.local_worker_run';
export const SYNTHETIC_LABOR_OS_CLAIM_GATE_SCHEMA = 'claw.synthetic_labor_os.v1.claim_gate';
export const SYNTHETIC_LABOR_OS_REMOTE_DISPATCH_SCHEMA = 'claw.synthetic_labor_os.v2.remote_dispatch_manifest';
export const SYNTHETIC_LABOR_OS_REMOTE_RESULT_SCHEMA = 'claw.synthetic_labor_os.v2.remote_dispatch_result';
export const SYNTHETIC_LABOR_OS_ARTIFACT_BUNDLE_SCHEMA = 'claw.synthetic_labor_os.v2.artifact_bundle_manifest';
export const SYNTHETIC_LABOR_OS_RUN_LEDGER_SCHEMA = 'claw.synthetic_labor_os.v19.run_ledger';
export const SYNTHETIC_LABOR_OS_RELEASE_PACKET_SCHEMA = 'claw.synthetic_labor_os.v19.release_packet';

export const DEFAULT_SYNTHETIC_LABOR_OS_REMOTE_SYNC_PATHS = Object.freeze([
  'package.json',
  'packages/synthetic-labor-os/index.mjs',
  'apps/system-benchmark/audit-synthetic-labor-os-v0.mjs',
  'apps/synthetic-labor-os/codex-agent-work-item.mjs',
  'apps/synthetic-labor-os/codex-patch-proposal-work-item.mjs',
  'apps/synthetic-labor-os/apply-patch-gate.mjs',
  'apps/synthetic-labor-os/job-lifecycle.mjs',
  'apps/synthetic-labor-os/local-runner.mjs',
  'apps/synthetic-labor-os/operator-console.mjs',
  'apps/synthetic-labor-os/operator-dashboard.mjs',
  'apps/synthetic-labor-os/proof-harness.mjs',
  'apps/synthetic-labor-os/remote-dispatcher.mjs',
  'apps/synthetic-labor-os/v1-pilot.mjs',
  'apps/synthetic-labor-os/v2-remote-pilot.mjs',
  'apps/synthetic-labor-os/v3-remote-codex-pilot.mjs',
  'apps/synthetic-labor-os/v4-remote-patch-pilot.mjs',
  'apps/synthetic-labor-os/v5-apply-pilot.mjs',
  'apps/synthetic-labor-os/v6-provenance-chain.mjs',
  'apps/synthetic-labor-os/v7-replay-rollback-audit.mjs',
  'apps/synthetic-labor-os/v8-e2e-demo.mjs',
  'apps/synthetic-labor-os/v9-finished-claim-report.mjs',
  'apps/synthetic-labor-os/v10-scale-smoke.mjs',
  'apps/synthetic-labor-os/v11-release-bundle.mjs',
  'apps/synthetic-labor-os/v12-fresh-replay.mjs',
  'apps/synthetic-labor-os/v13-operator-doctor.mjs',
  'apps/synthetic-labor-os/v14-multi-job-smoke.mjs',
  'apps/synthetic-labor-os/v15-release-candidate.mjs',
  'apps/synthetic-labor-os/v16-iteration-worker.mjs',
  'apps/synthetic-labor-os/v16-iteration-tournament.mjs',
  'apps/synthetic-labor-os/v17-role-catalog.mjs',
  'apps/synthetic-labor-os/v17-role-implementation.mjs',
  'apps/synthetic-labor-os/v17-role-verifier.mjs',
  'apps/synthetic-labor-os/v17-role-tournament-remote.mjs',
  'apps/synthetic-labor-os/v17-role-tournament.mjs',
  'apps/synthetic-labor-os/v18-whole-os-catalog.mjs',
  'apps/synthetic-labor-os/v18-whole-os-implementation.mjs',
  'apps/synthetic-labor-os/v18-whole-os-verifier.mjs',
  'apps/synthetic-labor-os/v18-whole-os-tournament-remote.mjs',
  'apps/synthetic-labor-os/v18-whole-os-tournament.mjs',
  'apps/synthetic-labor-os/v19-release-packet.mjs',
  'apps/synthetic-labor-os/v20-hard-dogfood-rc.mjs',
  'docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md',
  'tests/synthetic-labor-os.test.mjs',
  'tests/synthetic-labor-os-remote-smoke.test.mjs',
  'docs/SYNTHETIC_LABOR_OS_V0.md'
]);

export const SYNTHETIC_LABOR_OS_JOB_STATES = Object.freeze([
  'drafted',
  'compiled',
  'queued',
  'running',
  'paused',
  'blocked',
  'review_ready',
  'completed',
  'cancelled'
]);

export const SYNTHETIC_LABOR_OS_ALLOWED_JOB_TRANSITIONS = Object.freeze({
  drafted: Object.freeze(['compiled', 'blocked', 'cancelled']),
  compiled: Object.freeze(['queued', 'blocked', 'cancelled']),
  queued: Object.freeze(['running', 'paused', 'blocked', 'cancelled']),
  running: Object.freeze(['paused', 'blocked', 'review_ready', 'completed', 'cancelled']),
  paused: Object.freeze(['queued', 'running', 'blocked', 'cancelled']),
  blocked: Object.freeze(['drafted', 'compiled', 'queued', 'cancelled']),
  review_ready: Object.freeze(['running', 'blocked', 'completed', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([])
});

export const SYNTHETIC_LABOR_OS_REVIEW_DECISIONS = Object.freeze([
  'approved',
  'rejected',
  'changes_requested',
  'deferred'
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(status = '') {
  const value = String(status || '').trim();
  return ['implemented', 'partial', 'missing'].includes(value) ? value : 'missing';
}

function stableList(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function normalizeArtifactBundlePath(relPath = '') {
  const raw = String(relPath || '');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return null;
  const normalized = raw.replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (!normalized || path.posix.isAbsolute(normalized)) return null;
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.includes('..')) return null;
  return parts.join('/');
}

function resolveArtifactBundleFile(artifactRoot, relPath) {
  const normalized = normalizeArtifactBundlePath(relPath);
  if (!normalized) return { normalized: null, absolutePath: null, ok: false, reason: 'invalid_relative_path' };
  const root = path.resolve(artifactRoot || '.');
  const absolutePath = path.resolve(root, normalized);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { normalized, absolutePath, ok: false, reason: 'path_escapes_artifact_root' };
  }
  return { normalized, absolutePath, ok: true, reason: null };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function slugify(value = '') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'synthetic-labor-os-job';
}

function compactTimestamp(value = nowIso()) {
  return String(value).replace(/[^0-9TZ]/g, '').replace(/Z$/, 'Z');
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function fileInfo(filePath) {
  try {
    if (!filePath) return { exists: false, isFile: false, sizeBytes: null, sha256: null };
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return { exists: false, isFile: false, sizeBytes: null, sha256: null };
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { exists: true, isFile: false, sizeBytes: null, sha256: null };
    return { exists: true, isFile: true, sizeBytes: stat.size, sha256: sha256File(resolved) };
  } catch {
    return { exists: false, isFile: false, sizeBytes: null, sha256: null };
  }
}

function artifactHealth(json) {
  if (!json || typeof json !== 'object') return null;
  if (typeof json.wholeOsTournamentGreen === 'boolean') return json.wholeOsTournamentGreen;
  if (typeof json.ok === 'boolean') return json.ok;
  if (typeof json.approved === 'boolean') return json.approved;
  if (typeof json.patchApplied === 'boolean') return json.patchApplied && json.implementationClaimAllowedForApprovedPatch !== false;
  if (typeof json.validationOk === 'boolean') return json.validationOk;
  if (typeof json.thresholdPass === 'boolean') return json.thresholdPass;
  if (typeof json.status === 'string') {
    if (json.status.startsWith('green_')) return true;
    if (json.status === 'blocked') return false;
  }
  return null;
}

function evidenceRecord({ label, filePath, required = true }) {
  const resolved = filePath ? path.resolve(filePath) : null;
  const info = fileInfo(resolved);
  const json = info.exists && info.isFile && resolved.endsWith('.json') ? readJson(resolved, null) : null;
  return {
    label,
    path: resolved,
    required,
    exists: info.exists,
    isFile: info.isFile,
    sizeBytes: info.sizeBytes,
    sha256: info.sha256,
    schemaVersion: json?.schemaVersion || null,
    status: json?.status || null,
    artifactOk: artifactHealth(json),
    blocker: json?.blocker || null,
    truthBoundary: json?.truthBoundary || null
  };
}

function addEvidenceSource(sources, seen, label, filePath, required = true) {
  const resolved = filePath ? path.resolve(filePath) : null;
  const key = resolved || `missing:${label}`;
  if (seen.has(key)) return;
  seen.add(key);
  sources.push({ label, filePath: resolved, required });
}

function gate(id, ok, summary, evidenceLabels = []) {
  return { id, ok: ok === true, summary, evidenceLabels: stableList(evidenceLabels) };
}

function v19ClaimLedgerRecord({ ledger = {}, priorArtGate = {} } = {}) {
  const selected = ledger.selectedCandidate || {};
  const failedGates = (ledger.gates || []).filter((entry) => entry.ok !== true).map((entry) => entry.id);
  const priorArtDecision = priorArtGate?.decision || null;
  const priorArtScoped = priorArtGate?.ok === true && ['reuse_existing', 'extend_existing', 'adapter_wrapper_only'].includes(priorArtDecision);
  const challenges = [];
  if (failedGates.length) {
    challenges.push({
      id: 'v19_ledger_gate_failure',
      severity: 'fatal',
      sustained: true,
      rationale: `Run ledger has failed gates: ${failedGates.join(', ')}`
    });
  }
  if (!priorArtScoped) {
    challenges.push({
      id: 'v19_prior_art_not_scoped_to_existing_capability',
      severity: 'fatal',
      sustained: true,
      rationale: 'V19 must be an adapter/extension over recalled Cortex/SLOS truth-ledger primitives, not a parallel primitive.'
    });
  }
  const survived = challenges.length === 0;
  return {
    id: `slos-v19-claim-${slugify(ledger.runId || selected.id || 'release-packet')}`,
    patchId: selected.id || 'slos-v19-release-packet',
    surfaceIds: ['synthetic_labor_os_v19_release_packet', 'memory_prior_art_gate', 'proof_carrying_claim_ledger'],
    status: survived ? 'survived' : 'counterclaimed',
    creditStatus: survived ? 'surviving_credit' : 'credit_blocked_by_adversary',
    claim: {
      claimKind: 'adapter_over_existing_truth_ledger_primitives',
      claimAllowed: survived,
      selectedCandidateId: selected.id || null,
      priorArtDecision,
      existingCapabilityEvidence: (priorArtGate?.highConfidencePriorArt || []).slice(0, 8).map((entry) => ({
        source: entry.source || null,
        label: entry.label || entry.id || null,
        score: entry.score ?? null
      })),
      evidence: {
        runLedgerOk: ledger.ok === true,
        priorArtGateOk: priorArtGate?.ok === true,
        priorArtScoped,
        gateCount: (ledger.gates || []).length,
        greenGateCount: (ledger.gates || []).filter((entry) => entry.ok === true).length,
        evidenceCount: (ledger.evidence || []).length
      },
      truthBoundary: 'This proof-carrying claim is scoped to v19 being an adapter packet over existing Cortex/SLOS truth-ledger primitives. It does not merge, publish, deploy, send externally, apply non-winners, or prove full product completeness.'
    },
    challenges,
    summary: {
      challengeCount: challenges.length,
      survivedChallengeCount: survived ? challenges.length : 0,
      sustainedChallengeCount: challenges.length,
      fatalSustainedChallengeCount: challenges.length,
      survivalRate: survived ? 1 : 0,
      sustainedChallengeIds: challenges.map((challenge) => challenge.id),
      fatalSustainedChallengeIds: challenges.map((challenge) => challenge.id)
    }
  };
}

function evidencePatternLabel(pattern) {
  if (pattern instanceof RegExp) return pattern.toString();
  return String(pattern || '');
}

export const SYNTHETIC_LABOR_OS_V0_REQUIREMENTS = Object.freeze([
  {
    id: 'objective_intake_to_agent_work_handoff',
    layer: 'intent_to_work',
    title: 'Objective intake to Agent Work handoff',
    requirement: 'A Cortex/operator objective can be converted into a durable Agent Work handoff instead of staying as chat-only intent.',
    primitiveEvidence: [
      { kind: 'symbol', path: 'public/cortex_server/cortex_server/modules/reasoning_planner.py', pattern: 'compile_plan_to_agent_work_handoff' },
      { kind: 'symbol', path: 'public/cortex_server/cortex_server/routers/orchestrator.py', pattern: '/plan/agent-work' },
      { kind: 'symbol', path: 'public/cortex_server/cortex_server/runtime/agent_work_dsl.py', pattern: 'cortex.agent_work_handoff.v0' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'createJobIntakeContract' }
    ],
    productGaps: [],
    nextAction: 'Use the OS intake contract as the stable operator-facing boundary before compiling work.'
  },
  {
    id: 'agent_work_contract_compilation',
    layer: 'work_contract',
    title: 'Agent Work DSL and run-contract compilation',
    requirement: 'High-level work specs compile into run_contract.json, surface_matrix.json, and work_graph.json with fidelity and truth boundaries preserved.',
    primitiveEvidence: [
      { kind: 'symbol', path: 'large-project-capability-stack/packages/agent-work-dsl/index.mjs', pattern: 'claw.agent_work_spec.v0' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/agent-work-dsl/index.mjs', pattern: 'resolveAgentWorkRunInput' },
      { kind: 'file', path: 'large-project-capability-stack/docs/AGENT_WORK_DSL_V0.md' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'compileJobContract' }
    ],
    productGaps: [],
    nextAction: 'Compile jobs through the OS lifecycle so run-contract provenance stays attached to the job record.'
  },
  {
    id: 'objective_decomposition_and_queue_expansion',
    layer: 'planning',
    title: 'Objective decomposition and dynamic queue expansion',
    requirement: 'When a finite graph is exhausted and the objective remains red, the system can decompose new executable work instead of fake-greening.',
    primitiveEvidence: [
      { kind: 'symbol', path: 'large-project-capability-stack/packages/objective-surface-decomposer/index.mjs', pattern: 'decomposeObjectiveToSurfaces' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/objective-surface-decomposer/index.mjs', pattern: 'buildObjectiveExpansionPlan' },
      { kind: 'symbol', path: 'large-project-capability-stack/apps/system-benchmark/run-agent-work-objective-controller.mjs', pattern: 'objective_red' },
      { kind: 'symbol', path: 'large-project-capability-stack/apps/system-benchmark/run-agent-work-objective-controller.mjs', pattern: 'graph_exhausted' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'createWorkQueueArtifact' }
    ],
    productGaps: [],
    nextAction: 'Publish decomposition/expansion work as an OS queue artifact with explicit operator-readable states.'
  },
  {
    id: 'multi_agent_scheduling_artifacts_and_conflicts',
    layer: 'execution_control',
    title: 'Multi-agent scheduling, leases, artifact bus, patch queue, and conflicts',
    requirement: 'Workers coordinate through leases, context packs, artifacts, and merge/admission queues rather than uncontrolled parallel edits.',
    primitiveEvidence: [
      { kind: 'symbol', path: 'large-project-capability-stack/packages/multi-agent-orchestrator/index.mjs', pattern: 'createLeaseState' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/multi-agent-orchestrator/index.mjs', pattern: 'createArtifactBus' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/multi-agent-orchestrator/index.mjs', pattern: 'createPatchQueue' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/multi-agent-orchestrator/index.mjs', pattern: 'detectPatchConflicts' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/multi-agent-orchestrator/index.mjs', pattern: 'compileSupervisorSnapshot' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'buildAgentStatusRecords' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'buildPatchQueueStatus' }
    ],
    productGaps: [],
    nextAction: 'Turn supervisor snapshots and patch queues into OS-visible job/agent/patch status records.'
  },
  {
    id: 'continuous_controller_budget_resume_and_repair',
    layer: 'long_running_control',
    title: 'Continuous controller with budget backoff, resume, and repair surfaces',
    requirement: 'Long-running waves can pause on usage/budget limits, resume from state, and generate objective-truth repair surfaces.',
    primitiveEvidence: [
      { kind: 'symbol', path: 'large-project-capability-stack/packages/continuous-workload-controller/index.mjs', pattern: 'createUsageLimitBackoffPause' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/continuous-workload-controller/index.mjs', pattern: 'createBudgetLimitBackoffPause' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/continuous-workload-controller/index.mjs', pattern: 'evaluateContinuousStop' },
      { kind: 'symbol', path: 'large-project-capability-stack/apps/system-benchmark/run-continuous-real-workload-controller.mjs', pattern: 'resumeStatePath' },
      { kind: 'symbol', path: 'large-project-capability-stack/apps/system-benchmark/run-continuous-real-workload-controller.mjs', pattern: 'OBJECTIVE_TRUTH_REPAIR' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'buildBudgetResumeStatus' }
    ],
    productGaps: [],
    nextAction: 'Attach budget/backoff/resume state to the OS job record before each long-running wave.'
  },
  {
    id: 'truth_claim_landing_and_terminal_artifacts',
    layer: 'truth_layer',
    title: 'Truth gates, proof-carrying claims, landing evidence, and terminal blockers',
    requirement: 'Completion claims are gated by proof, canonical landing evidence, run-state truth, and blocker reports.',
    primitiveEvidence: [
      { kind: 'symbol', path: 'large-project-capability-stack/packages/proof-carrying-claim-ledger/index.mjs', pattern: 'buildProofCarryingClaimLedger' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/proof-carrying-claim-ledger/index.mjs', pattern: 'deriveMergeEligibility' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/canonical-landing-evidence/index.mjs', pattern: 'deriveLandingEligibility' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/orchestrator-run-state/index.mjs', pattern: 'writeTerminalStateArtifacts' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'buildTruthDashboardSection' }
    ],
    productGaps: [],
    nextAction: 'Make truth status a first-class OS dashboard section and reject any v0-ready claim while blockers remain.'
  },
  {
    id: 'remote_execution_boundary_and_deployment_provenance',
    layer: 'execution_plane',
    title: 'Remote execution boundary and deployment provenance',
    requirement: 'Heavy agent runs should execute on a real execution plane with manifest/provenance rather than overloading the control-plane host.',
    primitiveEvidence: [
      { kind: 'file', path: 'large-project-capability-stack/packages/agent-work-deployment-provenance/index.mjs' },
      { kind: 'file', path: 'large-project-capability-stack/apps/system-benchmark/write-agent-work-deployment-manifest.mjs' },
      { kind: 'symbol', path: 'large-project-capability-stack/apps/system-benchmark/run-continuous-real-workload-controller.mjs', pattern: 'execution_plane' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'createExecutionPlaneRegistry' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'evaluateExecutionPlaneReadiness' }
    ],
    productGaps: [],
    nextAction: 'Require a healthy execution-plane registry entry before launching serious multi-agent runs.'
  },
  {
    id: 'operator_health_dashboard',
    layer: 'operator_visibility',
    title: 'Read-only operator dashboard model',
    requirement: 'An operator can see OS job, queue, truth, blocker, budget, execution-plane, and health state without changing behavior.',
    primitiveEvidence: [
      { kind: 'file', path: 'large-project-capability-stack/apps/system-benchmark/cortex-ops-health-dashboard.mjs' },
      { kind: 'symbol', path: 'large-project-capability-stack/apps/system-benchmark/cortex-ops-health-dashboard.mjs', pattern: 'behaviorChanging: false' },
      { kind: 'file', path: 'large-project-capability-stack/apps/synthetic-labor-os/operator-dashboard.mjs' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'buildOperatorDashboard' }
    ],
    productGaps: [],
    nextAction: 'Keep this dashboard read-only; put write actions behind the separate human review/approval console.'
  },
  {
    id: 'human_interrupt_review_and_approval_console',
    layer: 'human_control',
    title: 'Human interrupt, review, and approval console',
    requirement: 'Humans can pause/resume jobs, review patches, approve/reject claims, and make explicit publish/merge decisions.',
    primitiveEvidence: [
      { kind: 'file', path: 'large-project-capability-stack/apps/synthetic-labor-os/operator-console.mjs' },
      { kind: 'symbol', path: 'large-project-capability-stack/apps/synthetic-labor-os/operator-console.mjs', pattern: 'pauseJob' },
      { kind: 'symbol', path: 'large-project-capability-stack/apps/synthetic-labor-os/operator-console.mjs', pattern: 'approvePatch' }
    ],
    productGaps: [],
    nextAction: 'Use approval records as local control-plane decisions only; never treat them as merge, publish, or completion proof by themselves.'
  },
  {
    id: 'documentation_and_test_contracts',
    layer: 'developer_coordination',
    title: 'Documentation and unit-test contracts',
    requirement: 'Jobs carry explicit test contracts and why-oriented documentation guidance so many agents can coordinate through shared correctness boundaries.',
    primitiveEvidence: [
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'createJobTestContract' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'recordJobTestEvidence' },
      { kind: 'file', path: 'large-project-capability-stack/docs/SYNTHETIC_LABOR_OS_V0.md' }
    ],
    productGaps: [],
    nextAction: 'Treat tests and documentation as coordination interfaces, not cleanup chores after implementation.'
  },
  {
    id: 'bounded_self_improvement_loop',
    layer: 'learning_control',
    title: 'Bounded self-improvement loop',
    requirement: 'Run logs, failures, tests, and review decisions can create gated improvement proposals without letting the system rewrite itself unsupervised.',
    primitiveEvidence: [
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'createImprovementProposal' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'evaluateImprovementProposal' },
      { kind: 'symbol', path: 'large-project-capability-stack/packages/synthetic-labor-os/index.mjs', pattern: 'buildImprovementLoopFromRun' },
      { kind: 'file', path: 'large-project-capability-stack/docs/SYNTHETIC_LABOR_OS_V0.md' }
    ],
    productGaps: [],
    nextAction: 'Promote only proposals that pass tests and human/validator review; never auto-apply self-modifying changes.'
  },
  {
    id: 'packaged_os_job_lifecycle',
    layer: 'product_surface',
    title: 'Packaged OS job lifecycle',
    requirement: 'Synthetic Labor OS v0 exists as a cohesive product surface with job records, state transitions, permissions, artifacts, and operator-facing commands/API.',
    primitiveEvidence: [
      { kind: 'file', path: 'large-project-capability-stack/apps/synthetic-labor-os/job-lifecycle.mjs' },
      { kind: 'symbol', path: 'large-project-capability-stack/apps/synthetic-labor-os/job-lifecycle.mjs', pattern: 'createJob' },
      { kind: 'symbol', path: 'large-project-capability-stack/apps/synthetic-labor-os/job-lifecycle.mjs', pattern: 'transitionJob' }
    ],
    productGaps: [],
    nextAction: 'Use this thin OS package as the stable lifecycle shell around existing orchestration primitives.'
  },
  {
    id: 'clean_v0_demo_proof',
    layer: 'proof',
    title: 'Clean v0 demo proof',
    requirement: 'A single demo proves objective intake -> decomposition -> agent execution -> artifacts -> review/truth dashboard -> pass/blocker without overclaiming.',
    primitiveEvidence: [
      { kind: 'file', path: 'large-project-capability-stack/artifacts/synthetic-labor-os-v0/latest/demo_proof.json' },
      { kind: 'file', path: 'large-project-capability-stack/artifacts/synthetic-labor-os-v0/latest/completion_summary.json' },
      { kind: 'file', path: 'large-project-capability-stack/artifacts/synthetic-labor-os-v0/latest/operator_dashboard.json' },
      { kind: 'file', path: 'large-project-capability-stack/artifacts/synthetic-labor-os-v0/latest/capability_matrix.json' }
    ],
    productGaps: [],
    nextAction: 'Keep the v0 demo proof scoped to the OS shell; do not treat it as broad product or 100-agent proof.'
  },
  {
    id: 'hundred_agent_long_running_productive_proof',
    layer: 'scale_truth',
    title: '100-agent long-running productive proof',
    requirement: 'The system proves sustained productive 100-agent operation with scale proof, provider/model ledger, nonzero product diffs, and truthful threshold status.',
    primitiveEvidence: [
      { kind: 'file', path: 'large-project-capability-stack/artifacts/synthetic-labor-os-v0/latest/100_agent_scale_proof.json' }
    ],
    productGaps: [],
    nextAction: 'Do not launch this proof on the control-plane host; admit only verified execution-plane artifacts or run it remotely.'
  }
]);

export function evaluateEvidenceItem(item = {}, { workspaceRoot = process.cwd(), readFile = null, exists = null } = {}) {
  const absolutePath = path.resolve(workspaceRoot, item.path || '');
  const fileExists = typeof exists === 'function' ? Boolean(exists(absolutePath, item)) : fs.existsSync(absolutePath);
  const result = {
    kind: item.kind || 'file',
    path: item.path || null,
    absolutePath,
    pattern: item.pattern ? evidencePatternLabel(item.pattern) : null,
    present: false,
    reason: null
  };

  if (!fileExists) {
    return { ...result, present: false, reason: 'missing_file' };
  }

  if (item.kind === 'file' || !item.pattern) {
    return { ...result, present: true, reason: 'file_present' };
  }

  let text = '';
  try {
    text = typeof readFile === 'function' ? String(readFile(absolutePath, item) || '') : fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    return { ...result, present: false, reason: `unreadable:${error?.message || String(error)}` };
  }

  const present = item.pattern instanceof RegExp
    ? item.pattern.test(text)
    : text.includes(String(item.pattern));
  return { ...result, present, reason: present ? 'pattern_present' : 'pattern_missing' };
}

export function derivePrimitiveStatus(evidence = [], forced = null) {
  if (forced) return normalizeStatus(forced);
  const required = Array.isArray(evidence) ? evidence : [];
  if (required.length === 0) return 'missing';
  const presentCount = required.filter((entry) => entry.present).length;
  if (presentCount === required.length) return 'implemented';
  if (presentCount > 0) return 'partial';
  return 'missing';
}

export function deriveOsProductStatus({ primitiveStatus = 'missing', productGaps = [], forceOsProductStatus = null } = {}) {
  if (forceOsProductStatus) return normalizeStatus(forceOsProductStatus);
  const status = normalizeStatus(primitiveStatus);
  if (status === 'missing') return 'missing';
  return stableList(productGaps).length === 0 ? 'implemented' : 'partial';
}

export function buildSyntheticLaborOsCapabilityMatrix({
  workspaceRoot = process.cwd(),
  requirements = SYNTHETIC_LABOR_OS_V0_REQUIREMENTS,
  generatedAt = nowIso(),
  readFile = null,
  exists = null
} = {}) {
  const rows = requirements.map((requirement) => {
    const evidence = (requirement.primitiveEvidence || []).map((item) => evaluateEvidenceItem(item, { workspaceRoot, readFile, exists }));
    const primitiveStatus = derivePrimitiveStatus(evidence, requirement.forcePrimitiveStatus || null);
    const productGaps = stableList(requirement.productGaps || []);
    const osProductStatus = deriveOsProductStatus({
      primitiveStatus,
      productGaps,
      forceOsProductStatus: requirement.forceOsProductStatus || null
    });
    return {
      id: requirement.id,
      layer: requirement.layer,
      title: requirement.title,
      requirement: requirement.requirement,
      primitiveStatus,
      osProductStatus,
      evidence,
      evidencePresentCount: evidence.filter((entry) => entry.present).length,
      evidenceRequiredCount: evidence.length,
      productGaps,
      nextAction: requirement.nextAction || null
    };
  });

  return {
    schemaVersion: SYNTHETIC_LABOR_OS_MATRIX_SCHEMA,
    generatedAt,
    workspaceRoot: path.resolve(workspaceRoot),
    rows
  };
}

export function summarizeSyntheticLaborOsCapabilityMatrix(matrix = {}) {
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const byPrimitiveStatus = { implemented: 0, partial: 0, missing: 0 };
  const byOsProductStatus = { implemented: 0, partial: 0, missing: 0 };
  for (const row of rows) {
    byPrimitiveStatus[normalizeStatus(row.primitiveStatus)] += 1;
    byOsProductStatus[normalizeStatus(row.osProductStatus)] += 1;
  }
  const alreadyImplementedPrimitiveIds = rows.filter((row) => row.primitiveStatus === 'implemented').map((row) => row.id);
  const partialPrimitiveIds = rows.filter((row) => row.primitiveStatus === 'partial').map((row) => row.id);
  const missingProductIds = rows.filter((row) => row.osProductStatus === 'missing').map((row) => row.id);
  const partialProductIds = rows.filter((row) => row.osProductStatus === 'partial').map((row) => row.id);
  const v0ProductReady = rows.length > 0 && rows.every((row) => row.osProductStatus === 'implemented');
  return {
    schemaVersion: 'claw.synthetic_labor_os.v0.summary',
    generatedAt: matrix.generatedAt || nowIso(),
    requirementCount: rows.length,
    byPrimitiveStatus,
    byOsProductStatus,
    alreadyImplementedPrimitiveIds,
    partialPrimitiveIds,
    missingProductIds,
    partialProductIds,
    v0ProductReady,
    truthBoundary: v0ProductReady
      ? 'Synthetic Labor OS v0 product readiness is green for the audited matrix.'
      : 'Synthetic Labor OS v0 is not product-ready: implemented primitives exist, but missing/partial OS product surfaces remain.',
    honestClaim: v0ProductReady
      ? 'Synthetic Labor OS v0 product shell is implemented for this matrix; still verify live demo artifacts before public scale claims.'
      : 'Synthetic Labor OS v0 exists only as fragments/primitives plus benchmark/control-plane infrastructure, not as a cohesive finished product.'
  };
}

export function buildSyntheticLaborOsAudit(input = {}) {
  const matrix = buildSyntheticLaborOsCapabilityMatrix(input);
  const summary = summarizeSyntheticLaborOsCapabilityMatrix(matrix);
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_AUDIT_SCHEMA,
    generatedAt: matrix.generatedAt,
    summary,
    matrix
  };
}

export function renderSyntheticLaborOsAuditMarkdown(audit = {}) {
  const summary = audit.summary || summarizeSyntheticLaborOsCapabilityMatrix(audit.matrix || {});
  const rows = audit.matrix?.rows || [];
  const lines = [];
  lines.push('# Synthetic Labor OS v0 Capability Matrix');
  lines.push('');
  lines.push(`Generated: ${audit.generatedAt || summary.generatedAt || nowIso()}`);
  lines.push('');
  lines.push('## Truth boundary');
  lines.push('');
  lines.push(summary.truthBoundary || 'Unknown.');
  lines.push('');
  lines.push(`Honest claim: ${summary.honestClaim || 'Unknown.'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Requirements audited: ${summary.requirementCount ?? rows.length}`);
  lines.push(`- Primitive status: implemented ${summary.byPrimitiveStatus?.implemented ?? 0}, partial ${summary.byPrimitiveStatus?.partial ?? 0}, missing ${summary.byPrimitiveStatus?.missing ?? 0}`);
  lines.push(`- OS product status: implemented ${summary.byOsProductStatus?.implemented ?? 0}, partial ${summary.byOsProductStatus?.partial ?? 0}, missing ${summary.byOsProductStatus?.missing ?? 0}`);
  lines.push(`- v0 product ready: ${summary.v0ProductReady === true ? 'true' : 'false'}`);
  lines.push('');
  lines.push('## Matrix');
  lines.push('');
  lines.push('| Requirement | Layer | Primitive | OS product | Evidence | Gap / next action |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    const evidence = `${row.evidencePresentCount}/${row.evidenceRequiredCount}`;
    const gap = row.productGaps?.[0] || row.nextAction || '';
    lines.push(`| ${row.title} | ${row.layer} | ${row.primitiveStatus} | ${row.osProductStatus} | ${evidence} | ${gap.replaceAll('|', '\\|')} |`);
  }
  lines.push('');
  lines.push('## Missing / productization blockers');
  lines.push('');
  for (const row of rows.filter((entry) => entry.osProductStatus !== 'implemented')) {
    lines.push(`### ${row.title}`);
    lines.push('');
    lines.push(`- Primitive status: ${row.primitiveStatus}`);
    lines.push(`- OS product status: ${row.osProductStatus}`);
    for (const gap of row.productGaps || []) lines.push(`- Gap: ${gap}`);
    if (row.nextAction) lines.push(`- Next action: ${row.nextAction}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function writeSyntheticLaborOsAudit({ audit, artifactRoot } = {}) {
  if (!artifactRoot) throw new Error('artifactRoot is required');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const jsonPath = path.join(artifactRoot, 'capability_matrix.json');
  const markdownPath = path.join(artifactRoot, 'capability_matrix.md');
  fs.writeFileSync(jsonPath, JSON.stringify(audit, null, 2));
  fs.writeFileSync(markdownPath, renderSyntheticLaborOsAuditMarkdown(audit));
  return { jsonPath, markdownPath };
}

function normalizeObjective(input = {}) {
  if (typeof input === 'string') {
    return { id: slugify(input), title: input, outcome: input };
  }
  const title = String(input.title || input.outcome || input.goal || input.id || 'Synthetic Labor OS job').trim();
  return {
    id: String(input.id || slugify(title)).trim(),
    title,
    outcome: String(input.outcome || input.goal || title).trim(),
    requestedFidelity: input.requestedFidelity || input.fidelity || null,
    stopCondition: input.stopCondition || null
  };
}

function normalizePermissions(permissions = {}) {
  return {
    allow: stableList(permissions.allow || permissions.allowed || []),
    forbid: stableList(permissions.forbid || permissions.forbidden || ['external_send', 'touch_prod_without_approval'])
  };
}

function normalizeJobState(state = 'drafted') {
  const value = String(state || 'drafted').trim();
  if (!SYNTHETIC_LABOR_OS_JOB_STATES.includes(value)) throw new Error(`unsupported Synthetic Labor OS job state: ${value}`);
  return value;
}

function hasBlockingTruth(blocker = null) {
  if (!blocker) return false;
  if (typeof blocker === 'string') return blocker.trim().length > 0;
  return Boolean(blocker.blocker || blocker.reason || blocker.message || blocker.blockerKind);
}

function artifactThresholdPass(artifacts = {}) {
  const completion = artifacts.completionSummary || artifacts.completion_summary || null;
  const threshold = artifacts.thresholdEvaluation || artifacts.threshold_evaluation || null;
  if (completion && typeof completion === 'object' && 'thresholdPass' in completion) return completion.thresholdPass === true;
  if (threshold && typeof threshold === 'object' && 'thresholdPass' in threshold) return threshold.thresholdPass === true;
  return null;
}

function completionClaimAllowed(job = {}) {
  return artifactThresholdPass(job.artifacts || {}) === true && !hasBlockingTruth(job.blocker || job.artifacts?.blockerReport);
}

export function deriveJobTruth(job = {}) {
  const state = normalizeJobState(job.state || 'drafted');
  const thresholdPass = artifactThresholdPass(job.artifacts || {});
  const blocker = job.blocker || job.artifacts?.blockerReport || null;
  const blocked = hasBlockingTruth(blocker);
  let status = 'not_started';
  let supervisorStatus = 'red';
  let honestClaim = 'Job is not complete.';

  if (state === 'cancelled') {
    status = 'cancelled';
    honestClaim = 'Job was cancelled before completion.';
  } else if (blocked || state === 'blocked') {
    status = 'blocked';
    honestClaim = 'Job is blocked; do not claim completion.';
  } else if (state === 'completed' && thresholdPass === true) {
    status = 'green_for_job_contract';
    supervisorStatus = 'green';
    honestClaim = 'Job completed for its declared contract; do not extrapolate to broader scale or full parity without separate proof.';
  } else if (state === 'review_ready') {
    status = 'awaiting_review';
    honestClaim = 'Job is ready for human/operator review, not complete.';
  } else if (state === 'running' || state === 'queued') {
    status = state;
    honestClaim = `Job is ${state}; completion is not established.`;
  } else if (state === 'paused') {
    status = 'paused';
    honestClaim = 'Job is paused; inspect blocker/budget/resume state before continuing.';
  }

  return {
    schemaVersion: 'claw.synthetic_labor_os.v0.job_truth',
    state,
    status,
    supervisorStatus,
    thresholdPass,
    blocked,
    blocker,
    completionClaimAllowed: state === 'completed' && thresholdPass === true && !blocked,
    honestClaim
  };
}

export function createJob(input = {}) {
  const createdAt = input.createdAt || input.generatedAt || nowIso();
  const objective = normalizeObjective(input.objective || input.goal || input.title || 'Synthetic Labor OS job');
  const id = String(input.id || `slos-${slugify(objective.title)}-${compactTimestamp(createdAt)}`).trim();
  const state = normalizeJobState(input.state || 'drafted');
  const job = {
    schemaVersion: SYNTHETIC_LABOR_OS_JOB_SCHEMA,
    id,
    state,
    createdAt,
    updatedAt: input.updatedAt || createdAt,
    createdBy: input.createdBy || 'operator',
    objective,
    repoPath: input.repoPath || input.repo || null,
    fidelity: input.fidelity || objective.requestedFidelity || 'production_slice',
    requestedAgentCount: Number(input.requestedAgentCount || input.agents || 0) || null,
    permissions: normalizePermissions(input.permissions || {}),
    agentWork: {
      handoffPath: input.agentWork?.handoffPath || input.handoffPath || null,
      specPath: input.agentWork?.specPath || input.specPath || null,
      runContractPath: input.agentWork?.runContractPath || input.runContractPath || null,
      artifactRoot: input.agentWork?.artifactRoot || input.artifactRoot || null
    },
    executionPlane: {
      requiredHostRole: input.executionPlane?.requiredHostRole || input.requiredHostRole || 'execution_plane_for_heavy_runs',
      observedHostRole: input.executionPlane?.observedHostRole || input.observedHostRole || null,
      remoteHost: input.executionPlane?.remoteHost || input.remoteHost || null
    },
    artifacts: input.artifacts || {},
    metrics: input.metrics || {},
    blocker: input.blocker || null,
    transitions: [
      {
        at: createdAt,
        actor: input.createdBy || 'operator',
        from: null,
        to: state,
        reason: input.reason || 'job_created'
      }
    ]
  };
  return { ...job, truth: deriveJobTruth(job) };
}

export function transitionJob(job = {}, transition = {}) {
  const from = normalizeJobState(job.state || 'drafted');
  const to = normalizeJobState(transition.to || transition.state);
  const allowed = SYNTHETIC_LABOR_OS_ALLOWED_JOB_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) throw new Error(`invalid Synthetic Labor OS job transition: ${from} -> ${to}`);
  const at = transition.at || transition.generatedAt || nowIso();
  const next = {
    ...job,
    state: to,
    updatedAt: at,
    artifacts: { ...(job.artifacts || {}), ...(transition.artifacts || {}) },
    metrics: { ...(job.metrics || {}), ...(transition.metrics || {}) },
    blocker: transition.blocker === undefined ? (job.blocker || null) : transition.blocker,
    transitions: [
      ...(Array.isArray(job.transitions) ? job.transitions : []),
      {
        at,
        actor: transition.actor || 'system',
        from,
        to,
        reason: transition.reason || null
      }
    ]
  };
  if (to === 'completed' && transition.allowUnverifiedCompletion !== true && !completionClaimAllowed(next)) {
    throw new Error('cannot transition Synthetic Labor OS job to completed without thresholdPass=true and no blocker');
  }
  return { ...next, truth: deriveJobTruth(next) };
}

/**
 * The intake contract exists so the OS never treats a chat request as enough
 * context for autonomous work. It records the why/stop-condition boundary that
 * downstream agents, tests, and reviewers should protect.
 */
export function createJobIntakeContract(input = {}) {
  const job = input.job?.id ? input.job : createJob(input);
  const generatedAt = input.generatedAt || nowIso();
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_INTAKE_SCHEMA,
    generatedAt,
    jobId: job.id,
    objective: job.objective,
    repoPath: job.repoPath || null,
    fidelity: job.fidelity || 'production_slice',
    requestedAgentCount: job.requestedAgentCount || null,
    stopCondition: job.objective?.stopCondition || input.stopCondition || 'supervisor_green_or_blocker_report',
    permissions: job.permissions || normalizePermissions(input.permissions || {}),
    why: String(input.why || 'Bind human intent into a durable OS job before agents start changing code.').trim(),
    direction: String(input.direction || 'Preserve scope, truth boundaries, and review gates across all downstream work.').trim(),
    documentationHints: stableList(input.documentationHints || [
      'Document why the surface exists and what future growth it protects.',
      'Prefer JSDoc/TypeDoc comments on exported contracts and tricky invariants.'
    ]),
    testIntent: stableList(input.testIntent || [
      'Unit tests define the correctness contract agents coordinate against.',
      'Regression tests should fail before a completion claim is allowed.'
    ]),
    truthBoundary: 'Intake binds intent; it is not implementation, merge approval, publish approval, or completion proof.'
  };
}

/**
 * Compilation is modeled as a job transition because compile artifacts are part
 * of the audit trail. If they live only in benchmark scripts, operators cannot
 * tell what exact contract the agents were asked to satisfy.
 */
export function compileJobContract(job = {}, input = {}) {
  const state = normalizeJobState(job.state || 'drafted');
  if (state === 'compiled') return { ...job, truth: deriveJobTruth(job) };
  if (state !== 'drafted') throw new Error(`cannot compile Synthetic Labor OS job from state: ${state}`);
  const generatedAt = input.generatedAt || nowIso();
  const runContract = input.runContract || {
    schemaVersion: 'claw.synthetic_labor_os.v0.run_contract',
    generatedAt,
    jobId: job.id,
    objective: job.objective,
    fidelity: job.fidelity || 'production_slice',
    requestedAgentCount: job.requestedAgentCount || null,
    stopCondition: job.objective?.stopCondition || input.stopCondition || 'supervisor_green_or_blocker_report',
    truthBoundary: 'Run contract is scoped to this OS job; broader claims require separate proof.'
  };
  const surfaceMatrix = input.surfaceMatrix || {
    schemaVersion: 'claw.synthetic_labor_os.v0.surface_matrix',
    generatedAt,
    jobId: job.id,
    rows: stableList(input.surfaces || ['synthetic_labor_os_demo_surface']).map((surfaceId) => ({
      surfaceId,
      status: 'pending',
      requiredEvidence: ['test_evidence', 'truth_dashboard', 'human_review_if_patch']
    }))
  };
  const workGraph = input.workGraph || {
    schemaVersion: 'claw.synthetic_labor_os.v0.work_graph',
    generatedAt,
    jobId: job.id,
    nodes: surfaceMatrix.rows.map((row, index) => ({ id: row.surfaceId, order: index + 1, state: 'ready' })),
    edges: []
  };
  const compilerReport = input.compilerReport || {
    schemaVersion: 'claw.synthetic_labor_os.v0.compiler_report',
    generatedAt,
    jobId: job.id,
    ok: true,
    warnings: stableList(input.warnings || []),
    notes: 'Synthetic Labor OS compile stage attached contract, surface matrix, and work graph to the job record.'
  };
  const next = {
    ...job,
    agentWork: {
      ...(job.agentWork || {}),
      handoffPath: input.handoffPath || job.agentWork?.handoffPath || null,
      specPath: input.specPath || job.agentWork?.specPath || null,
      runContractPath: input.runContractPath || job.agentWork?.runContractPath || null,
      artifactRoot: input.artifactRoot || job.agentWork?.artifactRoot || null
    }
  };
  return transitionJob(next, {
    to: 'compiled',
    actor: input.actor || 'system',
    reason: input.reason || 'os_contract_compiled',
    artifacts: { runContract, surfaceMatrix, workGraph, compilerReport }
  });
}

export function createWorkQueueArtifact(input = {}) {
  const job = input.job || {};
  const generatedAt = input.generatedAt || nowIso();
  const defaultItems = [{
    id: 'demo-agent-work-item-1',
    title: job.objective?.title || 'Synthetic Labor OS work item',
    surfaceId: 'synthetic_labor_os_demo_surface',
    state: 'ready',
    requiredEvidence: ['unit_tests', 'artifact_summary', 'truth_gate']
  }];
  const workItems = (Array.isArray(input.workItems) && input.workItems.length ? input.workItems : defaultItems)
    .map((item, index) => ({
      id: String(item.id || `work-item-${index + 1}`).trim(),
      title: String(item.title || item.surfaceId || `Work item ${index + 1}`).trim(),
      surfaceId: String(item.surfaceId || item.id || `surface-${index + 1}`).trim(),
      state: String(item.state || 'ready').trim(),
      assignedAgentId: item.assignedAgentId || null,
      requiredEvidence: stableList(item.requiredEvidence || ['unit_tests', 'truth_gate'])
    }));
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_QUEUE_SCHEMA,
    generatedAt,
    jobId: job.id || input.jobId || null,
    queueId: input.queueId || `queue-${slugify(job.id || 'synthetic-labor-os')}-${compactTimestamp(generatedAt)}`,
    expansionPolicy: input.expansionPolicy || 'expand_when_objective_red_and_graph_exhausted',
    operatorControls: ['pause_job', 'request_review', 'reject_or_requeue_item'],
    workItems,
    readyCount: workItems.filter((item) => item.state === 'ready').length,
    blockedCount: workItems.filter((item) => item.state === 'blocked').length,
    truthBoundary: 'Queue state is scheduling intent; completion still requires artifacts and truth gates.'
  };
}

export function queueJob(job = {}, input = {}) {
  const queue = input.queue || createWorkQueueArtifact({ ...input, job });
  const state = normalizeJobState(job.state || 'drafted');
  if (state === 'queued') return { ...job, artifacts: { ...(job.artifacts || {}), workQueue: queue }, truth: deriveJobTruth(job) };
  if (state !== 'compiled') throw new Error(`cannot queue Synthetic Labor OS job from state: ${state}`);
  return transitionJob(job, {
    to: 'queued',
    actor: input.actor || 'system',
    reason: input.reason || 'os_work_queue_ready',
    artifacts: { workQueue: queue }
  });
}

export function buildAgentStatusRecords(input = {}) {
  const requested = Number(input.requestedAgentCount || input.job?.requestedAgentCount || 0) || 0;
  const supervisorAgents = Array.isArray(input.supervisorSnapshot?.agents) ? input.supervisorSnapshot.agents : [];
  const workerResults = Array.isArray(input.workerResults) ? input.workerResults : [];
  const count = Math.max(requested, supervisorAgents.length, workerResults.length, Number(input.minSlots || 0));
  const slots = [];
  for (let index = 0; index < count; index += 1) {
    const observed = supervisorAgents[index] || workerResults[index] || {};
    slots.push({
      agentId: observed.agentId || observed.id || `agent-${index + 1}`,
      state: observed.state || observed.status || (observed.completed ? 'completed' : 'idle'),
      surfaceId: observed.surfaceId || observed.shardId || null,
      leaseId: observed.leaseId || null,
      heartbeatAt: observed.heartbeatAt || null,
      stuck: observed.stuck === true,
      artifactRefs: stableList(observed.artifactRefs || observed.artifacts || [])
    });
  }
  return {
    schemaVersion: 'claw.synthetic_labor_os.v0.agent_status_records',
    generatedAt: input.generatedAt || nowIso(),
    requestedAgentCount: requested || null,
    observedAgentCount: slots.length,
    busyAgentCount: slots.filter((slot) => ['running', 'working', 'leased'].includes(slot.state)).length,
    stuckAgentCount: slots.filter((slot) => slot.stuck).length,
    slots,
    truthBoundary: 'Agent status records are operator visibility, not evidence of product completion.'
  };
}

export function buildPatchQueueStatus(input = {}) {
  const patches = Array.isArray(input.patches) ? input.patches : [];
  const reviews = Array.isArray(input.reviews) ? input.reviews : [];
  const conflicts = patches.filter((patch) => patch.conflict === true || patch.status === 'conflicted');
  return {
    schemaVersion: 'claw.synthetic_labor_os.v0.patch_queue_status',
    generatedAt: input.generatedAt || nowIso(),
    patchCount: patches.length,
    pendingPatchCount: patches.filter((patch) => ['pending', 'queued', 'review_ready'].includes(patch.status || 'pending')).length,
    mergedPatchCount: patches.filter((patch) => patch.status === 'merged').length,
    rejectedPatchCount: patches.filter((patch) => patch.status === 'rejected').length,
    conflictCount: conflicts.length,
    reviewSummary: summarizeJobReviews(reviews),
    conflicts: conflicts.map((patch) => ({ id: patch.id || patch.patchId || null, reason: patch.reason || 'patch_conflict' })),
    truthBoundary: 'Patch queue approvals are local records only; merge/publish/completion gates remain separate.'
  };
}

export function buildBudgetResumeStatus(input = {}) {
  const budget = input.budget || input.job?.metrics?.budget || {};
  const resumeState = input.resumeState || input.job?.artifacts?.resumeState || null;
  const usage = Number(budget.usage || budget.used || 0) || 0;
  const limit = Number(budget.limit || budget.max || 0) || 0;
  const pauseRequired = limit > 0 && usage >= limit;
  return {
    schemaVersion: 'claw.synthetic_labor_os.v0.budget_resume_status',
    generatedAt: input.generatedAt || nowIso(),
    budget,
    pauseRequired,
    resumeStatePresent: Boolean(resumeState),
    resumeState,
    recommendedAction: pauseRequired ? 'pause_and_wait_for_budget_or_operator_resume' : 'continue_with_monitoring',
    truthBoundary: 'Budget/resume state can pause work; it cannot prove completion.'
  };
}

export function createExecutionPlaneRegistry(input = {}) {
  const generatedAt = input.generatedAt || nowIso();
  const planes = (Array.isArray(input.planes) && input.planes.length ? input.planes : [{
    id: 'local-control-plane',
    role: 'control_plane',
    host: input.localHost || 'local',
    healthy: true,
    heavyWorkAllowed: false,
    capacityAgentCount: 0
  }]).map((plane) => ({
    id: String(plane.id || plane.host || plane.role || 'execution-plane').trim(),
    role: String(plane.role || (plane.remote ? 'execution_plane' : 'control_plane')).trim(),
    host: plane.host || plane.remoteHost || null,
    healthy: plane.healthy !== false,
    remote: plane.remote === true || plane.role === 'execution_plane',
    heavyWorkAllowed: plane.heavyWorkAllowed === true || plane.role === 'execution_plane',
    capacityAgentCount: Number(plane.capacityAgentCount || plane.agentCapacity || 0) || 0,
    artifactRoot: plane.artifactRoot || null,
    provenance: plane.provenance || null
  }));
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_EXECUTION_PLANE_REGISTRY_SCHEMA,
    generatedAt,
    planes,
    truthBoundary: 'The control plane may inspect or prepare proof; heavy worker farms require a healthy execution-plane entry.'
  };
}

export function evaluateExecutionPlaneReadiness(registry = {}, input = {}) {
  const requested = Number(input.requestedAgentCount || input.job?.requestedAgentCount || 0) || 0;
  const heavy = input.heavy === true || requested >= Number(input.heavyAgentThreshold || 25);
  const planes = Array.isArray(registry.planes) ? registry.planes : [];
  const eligible = planes.filter((plane) => plane.healthy && plane.heavyWorkAllowed && plane.capacityAgentCount >= requested);
  const ready = !heavy || eligible.length > 0;
  return {
    schemaVersion: 'claw.synthetic_labor_os.v0.execution_plane_readiness',
    generatedAt: input.generatedAt || nowIso(),
    requestedAgentCount: requested || null,
    heavy,
    ready,
    eligiblePlaneIds: eligible.map((plane) => plane.id),
    blocker: ready ? null : {
      blockerKind: 'missing_execution_plane_capacity',
      blocker: `Requested ${requested} agents, but no healthy execution plane with enough capacity was registered.`
    },
    truthBoundary: ready
      ? 'Execution-plane placement is ready for this requested scale; it is not proof that work has run.'
      : 'Do not launch heavy work from the control-plane host until this readiness check is green.'
  };
}

export function createArtifactBundleManifest(input = {}) {
  const createdAt = input.createdAt || input.generatedAt || nowIso();
  const artifactRoot = path.resolve(input.artifactRoot || '.');
  const includePaths = stableList(input.includePaths || input.paths || []);
  const files = [];
  const missingPaths = [];
  const invalidPaths = [];

  for (const candidatePath of includePaths) {
    const resolved = resolveArtifactBundleFile(artifactRoot, candidatePath);
    if (!resolved.ok) {
      invalidPaths.push({ path: String(candidatePath || ''), reason: resolved.reason });
      continue;
    }
    if (!fs.existsSync(resolved.absolutePath)) {
      missingPaths.push(resolved.normalized);
      continue;
    }
    const stat = fs.statSync(resolved.absolutePath);
    if (!stat.isFile()) {
      invalidPaths.push({ path: resolved.normalized, reason: 'not_a_file' });
      continue;
    }
    const realRoot = fs.realpathSync(artifactRoot);
    const realFile = fs.realpathSync(resolved.absolutePath);
    const realRelative = path.relative(realRoot, realFile);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      invalidPaths.push({ path: resolved.normalized, reason: 'symlink_escapes_artifact_root' });
      continue;
    }
    files.push({
      path: resolved.normalized,
      sha256: sha256File(resolved.absolutePath),
      sizeBytes: stat.size
    });
  }

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const ok = missingPaths.length === 0 && invalidPaths.length === 0;
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_ARTIFACT_BUNDLE_SCHEMA,
    label: input.label || 'synthetic-labor-os-artifact-bundle',
    artifactRoot,
    createdAt,
    createdBy: input.createdBy || input.actor || 'synthetic-labor-os',
    files,
    missingPaths,
    invalidPaths,
    summary: {
      ok,
      fileCount: files.length,
      totalBytes,
      missingCount: missingPaths.length,
      invalidPathCount: invalidPaths.length
    },
    truthBoundary: 'Artifact bundle checksums prove only that listed files match these recorded bytes. They do not approve, merge, publish, deploy, or release work.'
  };
}

export function verifyArtifactBundleManifest(input = {}) {
  const manifest = input.manifest || {};
  const artifactRoot = path.resolve(input.artifactRoot || manifest.artifactRoot || '.');
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const verifiedFiles = [];
  const missingFiles = stableList(manifest.missingPaths || []);
  const mismatchedFiles = [];
  const invalidPaths = Array.isArray(manifest.invalidPaths) ? [...manifest.invalidPaths] : [];

  for (const entry of files) {
    const resolved = resolveArtifactBundleFile(artifactRoot, entry?.path);
    if (!resolved.ok) {
      invalidPaths.push({ path: String(entry?.path || ''), reason: resolved.reason });
      continue;
    }
    if (!fs.existsSync(resolved.absolutePath)) {
      missingFiles.push(resolved.normalized);
      continue;
    }
    const stat = fs.statSync(resolved.absolutePath);
    if (!stat.isFile()) {
      invalidPaths.push({ path: resolved.normalized, reason: 'not_a_file' });
      continue;
    }
    const realRoot = fs.realpathSync(artifactRoot);
    const realFile = fs.realpathSync(resolved.absolutePath);
    const realRelative = path.relative(realRoot, realFile);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      invalidPaths.push({ path: resolved.normalized, reason: 'symlink_escapes_artifact_root' });
      continue;
    }
    const actual = {
      path: resolved.normalized,
      sha256: sha256File(resolved.absolutePath),
      sizeBytes: stat.size
    };
    if (actual.sha256 !== entry.sha256 || actual.sizeBytes !== entry.sizeBytes) {
      mismatchedFiles.push({
        path: resolved.normalized,
        expectedSha256: entry.sha256 || null,
        actualSha256: actual.sha256,
        expectedSizeBytes: Number(entry.sizeBytes || 0),
        actualSizeBytes: actual.sizeBytes
      });
    }
    verifiedFiles.push(actual);
  }

  const expectedTotalBytes = files.reduce((sum, file) => sum + (Number(file?.sizeBytes || 0) || 0), 0);
  const actualTotalBytes = verifiedFiles.reduce((sum, file) => sum + file.sizeBytes, 0);
  const ok = invalidPaths.length === 0 && missingFiles.length === 0 && mismatchedFiles.length === 0;
  return {
    schemaVersion: 'claw.synthetic_labor_os.v2.artifact_bundle_verification',
    generatedAt: input.generatedAt || nowIso(),
    manifestSchemaVersion: manifest.schemaVersion || null,
    label: manifest.label || null,
    artifactRoot,
    ok,
    verifiedFiles,
    missingFiles,
    mismatchedFiles,
    invalidPaths,
    summary: {
      ok,
      fileCount: files.length,
      verifiedFileCount: verifiedFiles.length,
      missingCount: missingFiles.length,
      mismatchCount: mismatchedFiles.length,
      invalidPathCount: invalidPaths.length,
      expectedTotalBytes,
      actualTotalBytes,
      byteDelta: actualTotalBytes - expectedTotalBytes
    },
    truthBoundary: 'Artifact bundle verification means listed files still match the manifest. It does not prove tests were sufficient, approve changes, merge, publish, deploy, or release work.'
  };
}

export function createRemoteDispatchManifest(input = {}) {
  const generatedAt = input.generatedAt || nowIso();
  const job = input.job || {};
  const remoteHost = String(input.remoteHost || input.remote || '').trim();
  const remoteRepoPath = String(input.remoteRepoPath || input.remoteRepo || '').trim();
  const remoteArtifactRoot = String(input.remoteArtifactRoot || '').trim();
  const command = String(input.command || input.remoteCommand || '').trim();
  const codeSyncPaths = stableList(input.codeSyncPaths || DEFAULT_SYNTHETIC_LABOR_OS_REMOTE_SYNC_PATHS);
  const failures = [];
  if (!remoteHost) failures.push('missing_remote_host');
  if (!remoteRepoPath) failures.push('missing_remote_repo_path');
  if (!remoteArtifactRoot) failures.push('missing_remote_artifact_root');
  if (!command) failures.push('missing_remote_command');
  if (!codeSyncPaths.length) failures.push('missing_code_sync_paths');
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_REMOTE_DISPATCH_SCHEMA,
    generatedAt,
    dispatchId: input.dispatchId || `remote-dispatch-${slugify(job.id || input.jobId || 'job')}-${compactTimestamp(generatedAt)}`,
    jobId: job.id || input.jobId || null,
    localRepoPath: input.localRepoPath || input.repoPath || null,
    localArtifactRoot: input.localArtifactRoot || input.artifactRoot || null,
    remoteHost,
    remoteRepoPath,
    remoteArtifactRoot,
    remoteJobPath: input.remoteJobPath || (remoteArtifactRoot && job.id ? `${remoteArtifactRoot.replace(/\/+$/, '')}/jobs/${job.id}.json` : null),
    command,
    codeSyncPaths,
    maxRuntimeMs: Number(input.maxRuntimeMs || 10 * 60 * 1000),
    okToLaunch: failures.length === 0,
    failures,
    safety: {
      behaviorChanging: true,
      externalWritesAllowed: false,
      remoteExecutionPlaneRequired: true,
      mergePublishSendAllowed: false,
      heavyAgentLaunchAllowed: false
    },
    truthBoundary: 'Remote dispatch may run a bounded job on the execution plane and return artifacts. It does not merge, publish, send externally, or by itself prove broad scale.'
  };
}

export function evaluateRemoteDispatchResult(input = {}) {
  const manifest = input.manifest || {};
  const syncProof = input.syncProof || null;
  const remoteRun = input.remoteRun || {};
  const artifactReturn = input.artifactReturn || {};
  const artifactIntegrity = input.artifactIntegrity || artifactReturn.artifactIntegrity || null;
  const runnerPayload = input.runnerPayload || remoteRun.runnerPayload || null;
  const failures = [];
  if (manifest.okToLaunch !== true) failures.push('manifest_not_launch_ready');
  if (!syncProof) failures.push('missing_sync_proof');
  else if (syncProof.matched !== true) failures.push('code_sync_hash_mismatch');
  if (remoteRun.exitCode !== 0) failures.push('remote_command_failed');
  if (runnerPayload?.ok !== true) failures.push('remote_runner_not_ok');
  if (runnerPayload?.claimGate?.thresholdPass !== true) failures.push('remote_claim_gate_not_green');
  if (artifactReturn.returned !== true) failures.push('artifacts_not_returned');
  else if (!artifactIntegrity) failures.push('missing_artifact_bundle_verification');
  else if (artifactIntegrity.ok !== true) failures.push('artifact_bundle_integrity_failed');
  const ok = failures.length === 0;
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_REMOTE_RESULT_SCHEMA,
    generatedAt: input.generatedAt || nowIso(),
    dispatchId: manifest.dispatchId || null,
    jobId: manifest.jobId || runnerPayload?.jobId || null,
    remoteHost: manifest.remoteHost || null,
    remoteRepoPath: manifest.remoteRepoPath || null,
    remoteArtifactRoot: manifest.remoteArtifactRoot || null,
    ok,
    thresholdPass: ok,
    failures,
    syncProof,
    remoteRun: {
      exitCode: remoteRun.exitCode ?? null,
      stdoutPath: remoteRun.stdoutPath || null,
      stderrPath: remoteRun.stderrPath || null,
      runnerRunDir: runnerPayload?.runDir || null,
      claimGate: runnerPayload?.claimGate || null
    },
    artifactReturn,
    artifactIntegrity,
    completionSummary: {
      schemaVersion: 'claw.synthetic_labor_os.v2.remote_completion_summary',
      generatedAt: input.generatedAt || nowIso(),
      jobId: manifest.jobId || runnerPayload?.jobId || null,
      thresholdPass: ok,
      supervisorConfirmedCompletion: ok,
      mechanicalGreen: ok,
      executionMode: 'remote_execution_plane_dispatch',
      remoteHost: manifest.remoteHost || null,
      syncMatched: syncProof?.matched === true,
      remoteRunnerOk: runnerPayload?.ok === true,
      remoteClaimGatePass: runnerPayload?.claimGate?.thresholdPass === true,
      artifactsReturned: artifactReturn.returned === true,
      artifactBundleVerified: artifactIntegrity?.ok === true,
      blocker: ok ? null : { blockerKind: 'remote_dispatch_gate_failed', blocker: `Remote dispatch failed: ${failures.join(', ')}` },
      truthBoundary: 'This completion summary is scoped to the remote dispatch job. It is not a merge, publish, send, or broad scale claim.'
    },
    truthBoundary: ok
      ? 'Remote dispatch is green for this bounded job: code sync matched, remote runner passed, claim gate was green, artifacts returned, and the returned bundle matched its manifest.'
      : 'Remote dispatch is blocked; do not claim completion until sync, remote run, claim gate, artifact return, and bundle integrity are all green.'
  };
}

export function buildRunLedger(input = {}) {
  const generatedAt = input.generatedAt || nowIso();
  const runSummaryPath = input.runSummaryPath || input.summaryPath || input.v18SummaryPath || null;
  const runSummary = input.runSummary || readJson(runSummaryPath, null) || {};
  const remoteSummaryPath = input.remoteSummaryPath || runSummary.remoteSummaryPath || null;
  const remoteSummary = input.remoteSummary || readJson(remoteSummaryPath, null) || {};
  const proposalSummaryPath = input.proposalSummaryPath || runSummary.proposalSummaryPath || null;
  const proposalSummary = input.proposalSummary || readJson(proposalSummaryPath, null) || {};
  const applySummaryPath = input.applySummaryPath || runSummary.applySummaryPath || null;
  const applySummary = input.applySummary || readJson(applySummaryPath, null) || {};
  const applyGateSummaryPath = input.applyGateSummaryPath || applySummary.summaryPath || null;
  const applyGateSummary = input.applyGateSummary || readJson(applyGateSummaryPath, null) || {};
  const applyGateProofPath = input.applyGateProofPath || applySummary.proofPath || applyGateSummary.proofPath || null;
  const applyGateProof = input.applyGateProof || readJson(applyGateProofPath, null) || {};
  const provenanceSummaryPath = input.provenanceSummaryPath || input.chainSummaryPath || runSummary.chainSummaryPath || null;
  const provenanceSummary = input.provenanceSummary || readJson(provenanceSummaryPath, null) || {};
  const provenanceChainPath = input.provenanceChainPath || input.chainPath || runSummary.chainPath || provenanceSummary.chainPath || null;
  const provenanceChain = input.provenanceChain || readJson(provenanceChainPath, null) || {};
  const approvalPath = input.approvalPath || runSummary.approvalPath || applySummary.approvalPath || null;
  const approval = input.approval || readJson(approvalPath, null) || {};
  const priorArtGatePath = input.priorArtGatePath || input.priorArtPath || null;
  const priorArtGate = input.priorArtGate || readJson(priorArtGatePath, null) || null;
  const selectedCandidate = input.selectedCandidate || runSummary.selectedCandidate || remoteSummary.winner || {};
  const patchPath = input.patchPath || applySummary.patchPath || selectedCandidate.patchPath || null;

  const sources = [];
  const seen = new Set();
  addEvidenceSource(sources, seen, 'run_summary', runSummaryPath, true);
  addEvidenceSource(sources, seen, 'remote_summary', remoteSummaryPath, true);
  addEvidenceSource(sources, seen, 'winner_proposal_summary', proposalSummaryPath, true);
  addEvidenceSource(sources, seen, 'winner_proposal_proof', input.proposalProofPath || proposalSummary.returnedPatchProofPath || null, true);
  addEvidenceSource(sources, seen, 'operator_approval', approvalPath, true);
  addEvidenceSource(sources, seen, 'winner_apply_summary', applySummaryPath, true);
  addEvidenceSource(sources, seen, 'winner_apply_gate_summary', applyGateSummaryPath, true);
  addEvidenceSource(sources, seen, 'winner_apply_gate_proof', applyGateProofPath, true);
  addEvidenceSource(sources, seen, 'winner_provenance_summary', provenanceSummaryPath, true);
  addEvidenceSource(sources, seen, 'winner_provenance_chain', provenanceChainPath, true);
  addEvidenceSource(sources, seen, 'prior_art_gate', priorArtGatePath, true);
  addEvidenceSource(sources, seen, 'winner_patch', patchPath, true);
  for (const extra of (Array.isArray(input.extraEvidence) ? input.extraEvidence : [])) {
    addEvidenceSource(sources, seen, extra.label || 'extra_evidence', extra.path || extra.filePath, extra.required !== false);
  }
  const evidence = sources.map(evidenceRecord);

  const requestedCandidateCount = Number(runSummary.requestedCandidateCount || remoteSummary.candidateCount || 0) || null;
  const requestedRoleAgentCount = Number(runSummary.requestedRoleAgentCount || remoteSummary.agentCount || remoteSummary.shardCount || 0) || null;
  const observedAgentCount = Number(runSummary.observedAgentCount || remoteSummary.observedAgentCount || 0) || 0;
  const realCodexResultCount = Number(runSummary.realCodexResultCount || remoteSummary.realCodexResultCount || 0) || 0;
  const mergedShardCount = Number(runSummary.mergedShardCount || remoteSummary.mergedShardCount || 0) || 0;
  const workerSpawnCount = Number(runSummary.workerSpawnCount || remoteSummary.workerSpawnCount || remoteSummary.metrics?.workerSpawnCount || 0) || 0;
  const peakConcurrentWorkers = Number(runSummary.peakConcurrentWorkers || remoteSummary.peakConcurrentWorkers || remoteSummary.metrics?.peakConcurrentWorkers || 0) || 0;
  const patchRecord = evidence.find((entry) => entry.label === 'winner_patch');
  const expectedPatchSha = input.patchSha256 || applySummary.patchSha256 || applyGateSummary.patchSha256 || approval.patchSha256 || null;
  const patchShaMatches = Boolean(expectedPatchSha && patchRecord?.sha256 && patchRecord.sha256 === expectedPatchSha);
  const allRoleResultsAccounted = requestedRoleAgentCount
    ? observedAgentCount >= requestedRoleAgentCount && realCodexResultCount >= requestedRoleAgentCount && mergedShardCount >= requestedRoleAgentCount
    : observedAgentCount > 0 && realCodexResultCount > 0 && mergedShardCount > 0;
  const evidenceByLabel = new Map(evidence.map((entry) => [entry.label, entry]));
  const requiredEvidenceMissing = evidence.filter((entry) => entry.required && (!entry.exists || !entry.isFile)).map((entry) => entry.label);
  const requiredEvidenceRed = evidence.filter((entry) => entry.required && entry.artifactOk === false).map((entry) => entry.label);
  const gates = [
    gate('run_summary_green', runSummary.ok === true && !runSummary.blocker, 'Final run summary is green and has no blocker.', ['run_summary']),
    gate('remote_whole_os_tournament_green', runSummary.remoteWholeOsTournamentGreen === true || remoteSummary.wholeOsTournamentGreen === true, 'Remote whole-SLOS tournament reports canonical green.', ['remote_summary']),
    gate('execution_coverage_green', allRoleResultsAccounted && workerSpawnCount >= (requestedRoleAgentCount || 1) && peakConcurrentWorkers > 0, 'Requested role-agent results, Codex results, merged shards, and worker spawns are accounted for.', ['remote_summary']),
    gate('winner_selected', Boolean(selectedCandidate.id && patchPath), 'A selected winner and patch path are present.', ['run_summary', 'remote_summary', 'winner_patch']),
    gate('proposal_review_ready', proposalSummary.ok === true && proposalSummary.reviewReady === true, 'Winner proposal was review-ready before apply.', ['winner_proposal_summary', 'winner_proposal_proof']),
    gate('operator_approval_green', approval.approved === true, 'Operator approval is explicit and patch-specific.', ['operator_approval']),
    gate('patch_checksum_green', patchShaMatches, 'Winner patch checksum matches approval/apply records.', ['winner_patch', 'operator_approval', 'winner_apply_summary']),
    gate('apply_gate_green', applySummary.ok === true && applySummary.patchApplied === true && applyGateSummary.ok === true && applyGateProofPath && evidenceByLabel.get('winner_apply_gate_proof')?.exists === true, 'Apply gate applied only the approved patch and recorded proof.', ['winner_apply_summary', 'winner_apply_gate_summary', 'winner_apply_gate_proof']),
    gate('validation_green', provenanceSummary.validationOk === true || applyGateProof.validationOk === true || applySummary.gateExitCode === 0, 'Post-apply validation is recorded green.', ['winner_apply_gate_proof', 'winner_provenance_summary']),
    gate('provenance_chain_green', provenanceSummary.ok === true && provenanceSummary.applyOk === true && provenanceSummary.proposalOk === true, 'Proposal, approval, apply, and validation are linked in provenance.', ['winner_provenance_summary', 'winner_provenance_chain']),
    gate('prior_art_gate_scoped_to_existing', priorArtGate?.ok === true && ['reuse_existing', 'extend_existing', 'adapter_wrapper_only'].includes(priorArtGate?.decision), 'Prior-art memory gate recalled existing ledger/provenance primitives and scoped v19 as reuse/extension/adapter.', ['prior_art_gate']),
    gate('required_evidence_present', requiredEvidenceMissing.length === 0, 'All required ledger evidence files are present.', requiredEvidenceMissing),
    gate('required_evidence_not_red', requiredEvidenceRed.length === 0, 'No required evidence artifact reports a red gate.', requiredEvidenceRed)
  ];
  const failures = gates.filter((entry) => !entry.ok).map((entry) => `gate_failed:${entry.id}`);
  const ok = failures.length === 0;
  const claimLedgerRecord = v19ClaimLedgerRecord({ ledger: { ok, runId: runSummary.jobId || remoteSummary.runStamp || input.runId || null, selectedCandidate, evidence, gates }, priorArtGate: priorArtGate || {} });
  const proofCarryingClaimLedger = buildProofCarryingClaimLedger({ records: [claimLedgerRecord] });
  const mergeEligibility = deriveMergeEligibility({ ledger: proofCarryingClaimLedger });
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_RUN_LEDGER_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'green_run_ledger' : 'blocked',
    runId: runSummary.jobId || remoteSummary.runStamp || input.runId || null,
    repoRoot: input.repoRoot ? path.resolve(input.repoRoot) : null,
    request: {
      requestedCandidateCount,
      requestedRoleAgentCount,
      objective: input.objective || runSummary.objective || 'Build a trustworthy Synthetic Labor OS run ledger/release packet from the selected whole-OS tournament winner.',
      stopCondition: input.stopCondition || 'release_packet_green_or_blocker_artifact'
    },
    execution: {
      remoteWholeOsTournamentGreen: runSummary.remoteWholeOsTournamentGreen === true || remoteSummary.wholeOsTournamentGreen === true,
      mechanicalGreen: remoteSummary.mechanicalGreen === true,
      executionCoverageGreen: remoteSummary.executionCoverageGreen === true || allRoleResultsAccounted,
      genericRemoteDispatcherOk: runSummary.genericRemoteDispatcherOk ?? null,
      genericRemoteDispatcherNote: runSummary.genericRemoteDispatcherNote || null,
      observedAgentCount,
      realCodexResultCount,
      mergedShardCount,
      workerSpawnCount,
      peakConcurrentWorkers,
      failedResultShardCount: Number(remoteSummary.failedResultShardCount || 0) || 0
    },
    selectedCandidate: {
      id: selectedCandidate.id || null,
      title: selectedCandidate.title || null,
      theme: selectedCandidate.theme || null,
      score: Number(selectedCandidate.score || 0) || 0,
      patchPath: patchPath ? path.resolve(patchPath) : null,
      patchSha256: expectedPatchSha,
      patchShaMatches,
      diffPaths: stableList(selectedCandidate.diffPaths || applyGateSummary.diffPaths || []),
      runtimePaths: stableList(selectedCandidate.runtimePaths || []),
      testPaths: stableList(selectedCandidate.testPaths || [])
    },
    evidence,
    evidenceSummary: {
      requiredCount: evidence.filter((entry) => entry.required).length,
      presentRequiredCount: evidence.filter((entry) => entry.required && entry.exists && entry.isFile).length,
      missingRequiredLabels: requiredEvidenceMissing,
      redRequiredLabels: requiredEvidenceRed
    },
    priorArtGate: priorArtGate ? {
      schemaVersion: priorArtGate.schemaVersion || null,
      ok: priorArtGate.ok === true,
      status: priorArtGate.status || null,
      decision: priorArtGate.decision || null,
      highConfidenceMatchCount: priorArtGate.sourceCoverage?.highConfidenceMatchCount ?? null,
      requiredAction: priorArtGate.requiredAction || null,
      truthBoundary: priorArtGate.truthBoundary || null
    } : null,
    proofCarryingClaimLedger,
    mergeEligibility,
    gates,
    failures,
    blocker: ok ? null : { blockerKind: 'slos_v19_run_ledger_failed', blocker: `SLOS v19 run ledger failed: ${failures.join(', ')}` },
    claim: {
      claimAllowed: ok,
      allowedClaim: ok
        ? 'The referenced SLOS run has a green internal run ledger: remote role-agent execution, selected winner, explicit approval, local apply, validation, and provenance are all evidence-linked.'
        : null,
      prohibitedClaims: ['merge', 'publish', 'deploy', 'external_send', 'non_winner_apply', 'unlimited_autonomous_labor', 'full_product_completeness'],
      truthBoundary: ok
        ? 'The run ledger proves evidence linkage for one bounded internal SLOS production-slice run. It does not merge, publish, deploy, send externally, apply non-winners, or prove unlimited autonomous labor capability.'
        : 'The run ledger is blocked; do not use it as release/claim evidence until every ledger gate is green.'
    },
    truthBoundary: ok
      ? 'v19 run ledger links request, execution, returned artifacts, winner patch, approval, apply gate, validation, and provenance for one bounded SLOS run.'
      : 'v19 run ledger is blocked; missing/red evidence or failed gates prevent a trustworthy packet claim.'
  };
}

export function buildReleasePacket(input = {}) {
  const generatedAt = input.generatedAt || nowIso();
  const ledger = input.ledger || buildRunLedger(input);
  const artifactBundleManifest = input.artifactBundleManifest || input.bundleManifest || null;
  const artifactBundleVerification = input.artifactBundleVerification || input.bundleVerification || null;
  const copiedEvidence = Array.isArray(input.copiedEvidence) ? input.copiedEvidence : [];
  const failures = [...(ledger.failures || [])];
  if (artifactBundleManifest && artifactBundleManifest.summary?.ok !== true) failures.push('artifact_bundle_manifest_not_green');
  if (artifactBundleVerification && artifactBundleVerification.ok !== true) failures.push('artifact_bundle_verification_not_green');
  if (ledger.proofCarryingClaimLedger?.summary?.status !== 'green') failures.push('proof_carrying_claim_ledger_not_green');
  if (ledger.mergeEligibility?.eligible !== true) failures.push('merge_eligibility_not_green_for_packet_claim');
  const ok = ledger.ok === true && failures.length === 0;
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_RELEASE_PACKET_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'green_release_packet' : 'blocked',
    packetId: input.packetId || `slos-v19-release-packet-${compactTimestamp(generatedAt)}`,
    runId: ledger.runId,
    ledgerPath: input.ledgerPath ? path.resolve(input.ledgerPath) : null,
    packetRoot: input.packetRoot ? path.resolve(input.packetRoot) : null,
    summary: {
      selectedCandidate: ledger.selectedCandidate,
      observedAgentCount: ledger.execution?.observedAgentCount || 0,
      realCodexResultCount: ledger.execution?.realCodexResultCount || 0,
      mergedShardCount: ledger.execution?.mergedShardCount || 0,
      peakConcurrentWorkers: ledger.execution?.peakConcurrentWorkers || 0,
      evidenceCount: ledger.evidence?.length || 0,
      copiedEvidenceCount: copiedEvidence.filter((entry) => entry.copied).length,
      gateCount: ledger.gates?.length || 0,
      greenGateCount: (ledger.gates || []).filter((entry) => entry.ok).length
    },
    sections: {
      request: ledger.request,
      execution: ledger.execution,
      selectedPatch: ledger.selectedCandidate,
      priorArtGate: ledger.priorArtGate,
      proofCarryingClaimLedger: ledger.proofCarryingClaimLedger,
      mergeEligibility: ledger.mergeEligibility,
      gates: ledger.gates,
      evidence: copiedEvidence.length ? copiedEvidence : ledger.evidence,
      claim: ledger.claim
    },
    artifactBundle: artifactBundleManifest ? {
      label: artifactBundleManifest.label || null,
      fileCount: artifactBundleManifest.summary?.fileCount || 0,
      ok: artifactBundleManifest.summary?.ok === true,
      verificationOk: artifactBundleVerification?.ok ?? null
    } : null,
    replayCommands: stableList(input.replayCommands || [
      'npm run ops:synthetic-labor-os:v19-release-packet',
      'node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'
    ]),
    failures,
    blocker: ok ? null : { blockerKind: 'slos_v19_release_packet_failed', blocker: `SLOS v19 release packet failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v19 release packet packages one bounded SLOS run into an operator-readable evidence packet. It does not merge, publish, deploy, send externally, apply non-winners, or claim full product completeness.'
      : 'v19 release packet is blocked; do not use it as release evidence until the ledger and bundle verification are green.'
  };
}

export function renderReleasePacketMarkdown(packet = {}) {
  const lines = [];
  const summary = packet.summary || {};
  const candidate = summary.selectedCandidate || packet.sections?.selectedPatch || {};
  lines.push('# Synthetic Labor OS v19 Release Packet');
  lines.push('');
  lines.push(`Status: ${packet.ok ? 'green' : 'blocked'}`);
  lines.push(`Packet id: ${packet.packetId || 'unknown'}`);
  if (packet.runId) lines.push(`Run id: ${packet.runId}`);
  lines.push('');
  lines.push('## Winner');
  lines.push(`- Candidate: ${candidate.id || 'unknown'}${candidate.title ? ` — ${candidate.title}` : ''}`);
  lines.push(`- Score: ${candidate.score ?? 'unknown'}`);
  lines.push(`- Patch checksum matched: ${candidate.patchShaMatches === true ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Execution evidence');
  lines.push(`- Observed agents: ${summary.observedAgentCount ?? 0}`);
  lines.push(`- Real Codex results: ${summary.realCodexResultCount ?? 0}`);
  lines.push(`- Merged shards: ${summary.mergedShardCount ?? 0}`);
  lines.push(`- Peak concurrent workers: ${summary.peakConcurrentWorkers ?? 0}`);
  lines.push(`- Evidence files: ${summary.evidenceCount ?? 0}`);
  lines.push('');
  lines.push('## Prior-art / reuse gate');
  const priorArt = packet.sections?.priorArtGate || {};
  lines.push(`- Decision: ${priorArt.decision || 'unknown'}`);
  lines.push(`- Gate green: ${priorArt.ok === true ? 'yes' : 'no'}`);
  lines.push(`- High-confidence prior-art matches: ${priorArt.highConfidenceMatchCount ?? 'unknown'}`);
  const claimLedger = packet.sections?.proofCarryingClaimLedger || {};
  lines.push(`- Proof-carrying claim ledger: ${claimLedger.summary?.status || 'unknown'}`);
  lines.push(`- Packet claim eligibility: ${packet.sections?.mergeEligibility?.eligible === true ? 'eligible' : 'blocked'}`);
  lines.push('');
  lines.push('## Gates');
  for (const gateEntry of packet.sections?.gates || []) lines.push(`- ${gateEntry.ok ? '✅' : '❌'} ${gateEntry.id}: ${gateEntry.summary}`);
  lines.push('');
  lines.push('## Replay commands');
  for (const command of packet.replayCommands || []) lines.push(`- \`${command}\``);
  lines.push('');
  lines.push(`Truth boundary: ${packet.truthBoundary || packet.sections?.claim?.truthBoundary || ''}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function buildTruthDashboardSection(input = {}) {
  const job = input.job || {};
  const truth = job.truth || deriveJobTruth(job);
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_TRUTH_DASHBOARD_SECTION_SCHEMA,
    generatedAt: input.generatedAt || nowIso(),
    jobId: job.id || null,
    jobTruth: truth,
    completionSummary: job.artifacts?.completionSummary || input.completionSummary || null,
    blockerReport: job.blocker || job.artifacts?.blockerReport || input.blockerReport || null,
    proofArtifacts: stableList(input.proofArtifacts || []),
    capabilitySummary: input.capabilityAudit?.summary || null,
    scaleProof: input.scaleProof || null,
    demoProof: input.demoProof || null,
    claimAllowed: truth.completionClaimAllowed === true,
    truthBoundary: 'Truth dashboard sections explain the current claim boundary; they are read-only and do not approve work.'
  };
}

/**
 * Tests are first-class OS inputs because agent swarms need shared executable
 * contracts. Without them, each worker optimizes against its own local story.
 */
export function createJobTestContract(input = {}) {
  const job = input.job || {};
  const generatedAt = input.generatedAt || nowIso();
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_TEST_CONTRACT_SCHEMA,
    generatedAt,
    id: input.id || `test-contract-${slugify(job.id || input.jobId || 'synthetic-labor-os')}-${compactTimestamp(generatedAt)}`,
    jobId: job.id || input.jobId || null,
    why: String(input.why || 'Tests are the coordination contract that lets many agents change code without silently breaking each other.').trim(),
    documentationStandard: input.documentationStandard || 'Use JSDoc/TypeDoc-style comments on exported contracts; comments should explain why a boundary exists, not narrate obvious code.',
    invariants: stableList(input.invariants || [
      'completion requires thresholdPass=true and no blocker',
      'review approvals do not imply merge, publish, or completion',
      'heavy 25+ agent work requires execution-plane readiness'
    ]),
    commands: stableList(input.commands || ['node --test tests/synthetic-labor-os.test.mjs']),
    docsRefs: stableList(input.docsRefs || ['docs/SYNTHETIC_LABOR_OS_V0.md']),
    expectedEvidence: stableList(input.expectedEvidence || ['test_output', 'completion_summary', 'truth_dashboard_section']),
    truthBoundary: 'A test contract defines what to verify; passing evidence must be recorded separately.'
  };
}

export function recordJobTestEvidence(job = {}, input = {}) {
  const testContract = input.testContract || input.contract || createJobTestContract({ job });
  const generatedAt = input.generatedAt || nowIso();
  const testRuns = (Array.isArray(input.testRuns) && input.testRuns.length ? input.testRuns : [{ command: 'node --test tests/synthetic-labor-os.test.mjs', ok: true }])
    .map((run) => ({
      command: String(run.command || '').trim(),
      ok: run.ok !== false && Number(run.exitCode || 0) === 0,
      exitCode: Number(run.exitCode || (run.ok === false ? 1 : 0)) || 0,
      summary: run.summary || null,
      artifactRef: run.artifactRef || null
    }));
  const failed = testRuns.filter((run) => !run.ok);
  const evidence = {
    schemaVersion: SYNTHETIC_LABOR_OS_TEST_EVIDENCE_SCHEMA,
    generatedAt,
    jobId: job.id || null,
    contractId: testContract.id,
    ok: failed.length === 0,
    testRunCount: testRuns.length,
    failedTestRunCount: failed.length,
    testRuns,
    documentationRefs: stableList(input.documentationRefs || testContract.docsRefs),
    why: 'Evidence is attached to the job so the truth gate sees tests as part of the work product, not as a separate chat claim.',
    truthBoundary: 'Test evidence supports a scoped job claim only when the completion summary and blockers agree.'
  };
  const next = {
    ...job,
    updatedAt: generatedAt,
    artifacts: { ...(job.artifacts || {}), testContract, testEvidence: evidence },
    metrics: { ...(job.metrics || {}), testRunCount: testRuns.length, failedTestRunCount: failed.length }
  };
  return { ...next, truth: deriveJobTruth(next) };
}

function normalizeQueueItems(workQueue = {}) {
  const items = Array.isArray(workQueue.workItems) ? workQueue.workItems : [];
  return items.map((item, index) => ({
    id: String(item.id || `work-item-${index + 1}`).trim(),
    title: String(item.title || item.surfaceId || `Work item ${index + 1}`).trim(),
    surfaceId: String(item.surfaceId || item.id || `surface-${index + 1}`).trim(),
    state: String(item.state || 'ready').trim(),
    assignedAgentId: item.assignedAgentId || null,
    requiredEvidence: stableList(item.requiredEvidence || ['unit_tests', 'truth_gate'])
  }));
}

/**
 * v1 starts turning the OS shell into an execution loop. The local runner is
 * intentionally small: it can execute safe deterministic commands for low-scale
 * jobs, while heavy agent work remains blocked behind execution-plane readiness.
 */
export function createLocalExecutionPlan(input = {}) {
  const job = input.job || {};
  const generatedAt = input.generatedAt || nowIso();
  const workQueue = input.workQueue || job.artifacts?.workQueue || createWorkQueueArtifact({ job, generatedAt });
  const testContract = input.testContract || job.artifacts?.testContract || createJobTestContract({ job, generatedAt });
  const commands = stableList(input.commands || testContract.commands || []);
  const queueItems = normalizeQueueItems(workQueue);
  const requestedAgentCount = Number(input.requestedAgentCount || job.requestedAgentCount || 1) || 1;
  const maxLocalAgentCount = Number(input.maxLocalAgentCount || 5) || 5;
  const registry = input.executionPlaneRegistry || createExecutionPlaneRegistry({ generatedAt });
  const readiness = evaluateExecutionPlaneReadiness(registry, { generatedAt, requestedAgentCount, heavy: requestedAgentCount >= 25 });
  const failures = [];
  if (!queueItems.length) failures.push('missing_work_queue_items');
  if (!commands.length) failures.push('missing_execution_commands');
  if (requestedAgentCount > maxLocalAgentCount) failures.push('requested_agent_count_exceeds_local_runner_limit');
  if (!readiness.ready) failures.push('execution_plane_not_ready_for_requested_scale');
  const ok = failures.length === 0;
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_EXECUTION_PLAN_SCHEMA,
    generatedAt,
    jobId: job.id || null,
    executionMode: 'local_deterministic_command_runner',
    localRunner: true,
    behaviorChanging: true,
    externalWritesAllowed: false,
    requestedAgentCount,
    maxLocalAgentCount,
    ok,
    failures,
    blocker: ok ? null : {
      blockerKind: 'local_execution_plan_not_ready',
      blocker: `Local execution plan is blocked: ${failures.join(', ')}`
    },
    commands,
    workItems: queueItems,
    executionPlaneReadiness: readiness,
    truthBoundary: 'The local runner may execute deterministic local commands for small jobs. It is not a substitute for remote heavy-agent execution.'
  };
}

export function createCommandExecutionResult(input = {}) {
  const startedAt = input.startedAt || input.generatedAt || nowIso();
  const finishedAt = input.finishedAt || input.completedAt || startedAt;
  const exitCode = Number(input.exitCode ?? input.status ?? 0);
  return {
    command: String(input.command || '').trim(),
    cwd: input.cwd || null,
    startedAt,
    finishedAt,
    exitCode: Number.isFinite(exitCode) ? exitCode : 1,
    ok: input.ok === undefined ? exitCode === 0 : input.ok === true,
    signal: input.signal || null,
    durationMs: Number(input.durationMs || 0) || 0,
    stdoutBytes: Number(input.stdoutBytes || String(input.stdout || '').length || 0) || 0,
    stderrBytes: Number(input.stderrBytes || String(input.stderr || '').length || 0) || 0,
    logPath: input.logPath || null,
    summary: input.summary || null
  };
}

export function buildLocalWorkerRun(input = {}) {
  const generatedAt = input.generatedAt || nowIso();
  const plan = input.executionPlan || input.plan || createLocalExecutionPlan(input);
  const commandResults = (Array.isArray(input.commandResults) ? input.commandResults : [])
    .map((result) => createCommandExecutionResult(result));
  const failedCommands = commandResults.filter((result) => !result.ok);
  const workItems = normalizeQueueItems({ workItems: plan.workItems || [] });
  const itemResults = workItems.map((item) => ({
    ...item,
    state: failedCommands.length === 0 && plan.ok ? 'completed' : 'blocked',
    evidenceRefs: stableList(input.evidenceRefs || commandResults.map((result) => result.logPath).filter(Boolean))
  }));
  const ok = plan.ok === true && commandResults.length > 0 && failedCommands.length === 0;
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_LOCAL_WORKER_RUN_SCHEMA,
    generatedAt,
    jobId: input.job?.id || plan.jobId || input.jobId || null,
    runId: input.runId || `local-worker-run-${slugify(input.job?.id || plan.jobId || 'job')}-${compactTimestamp(generatedAt)}`,
    executionMode: plan.executionMode || 'local_deterministic_command_runner',
    ok,
    commandCount: commandResults.length,
    failedCommandCount: failedCommands.length,
    completedItemCount: itemResults.filter((item) => item.state === 'completed').length,
    blockedItemCount: itemResults.filter((item) => item.state === 'blocked').length,
    commandResults,
    itemResults,
    failures: [
      ...(Array.isArray(plan.failures) ? plan.failures : []),
      ...failedCommands.map((result) => `command_failed:${result.command || 'unknown'}`)
    ],
    truthBoundary: 'Local worker run evidence proves only the commands and queue items recorded here; it does not imply merge, publish, remote scale, or product parity.'
  };
}

export function buildJobClaimGate(input = {}) {
  const generatedAt = input.generatedAt || nowIso();
  const job = input.job || {};
  const workerRun = input.workerRun || job.artifacts?.localWorkerRun || null;
  const testEvidence = input.testEvidence || job.artifacts?.testEvidence || null;
  const blocker = input.blocker || job.blocker || workerRun?.blocker || null;
  const failures = [];
  if (!workerRun) failures.push('missing_worker_run');
  else if (workerRun.ok !== true) failures.push('worker_run_not_ok');
  if (!testEvidence) failures.push('missing_test_evidence');
  else if (testEvidence.ok !== true) failures.push('test_evidence_not_ok');
  if (hasBlockingTruth(blocker)) failures.push('blocker_present');
  const thresholdPass = failures.length === 0;
  const completionSummary = {
    schemaVersion: 'claw.synthetic_labor_os.v1.completion_summary',
    generatedAt,
    runId: workerRun?.runId || job.id || null,
    jobId: job.id || null,
    thresholdPass,
    supervisorConfirmedCompletion: thresholdPass,
    mechanicalGreen: thresholdPass,
    executionMode: workerRun?.executionMode || 'unknown',
    workerRunOk: workerRun?.ok === true,
    testEvidenceOk: testEvidence?.ok === true,
    completedItemCount: workerRun?.completedItemCount || 0,
    failedCommandCount: workerRun?.failedCommandCount || 0,
    blocker: thresholdPass ? null : { blockerKind: 'claim_gate_failed', blocker: `Synthetic Labor OS v1 claim gate failed: ${failures.join(', ')}` },
    truthBoundary: 'This completion summary is scoped to the local execution plan and test contract. It is not a broader product or scale claim.'
  };
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_CLAIM_GATE_SCHEMA,
    generatedAt,
    jobId: job.id || null,
    thresholdPass,
    completionClaimAllowed: thresholdPass,
    failures,
    blocker: completionSummary.blocker,
    completionSummary,
    truthBoundary: thresholdPass
      ? 'Claim gate is green for the declared local job contract only.'
      : 'Claim gate is red; do not transition the job to completed without resolving failures.'
  };
}

export function createImprovementProposal(input = {}) {
  const generatedAt = input.generatedAt || nowIso();
  return {
    schemaVersion: 'claw.synthetic_labor_os.v0.improvement_proposal',
    generatedAt,
    id: input.id || `improvement-${slugify(input.title || input.source || 'proposal')}-${compactTimestamp(generatedAt)}`,
    title: String(input.title || 'Synthetic Labor OS improvement proposal').trim(),
    sourceObservation: String(input.sourceObservation || input.observation || '').trim(),
    proposedChange: String(input.proposedChange || input.change || '').trim(),
    files: stableList(input.files || []),
    requiredGates: stableList(input.requiredGates || [
      'focused_tests_pass',
      'truth_boundary_preserved',
      'human_or_validator_review_required'
    ]),
    riskLevel: input.riskLevel || 'medium',
    humanReviewRequired: input.humanReviewRequired !== false,
    rolloutPolicy: 'proposal_only_no_self_apply',
    truthBoundary: 'This proposal may guide future changes, but it does not authorize self-modification or rollout.'
  };
}

export function evaluateImprovementProposal(proposal = {}, input = {}) {
  const failures = [];
  if (!proposal.sourceObservation) failures.push('missing_source_observation');
  if (!proposal.proposedChange) failures.push('missing_proposed_change');
  if (!Array.isArray(proposal.requiredGates) || proposal.requiredGates.length === 0) failures.push('missing_required_gates');
  if (proposal.humanReviewRequired !== true) failures.push('human_review_not_required');
  if (input.testsPassed === false) failures.push('tests_not_passing');
  return {
    schemaVersion: 'claw.synthetic_labor_os.v0.improvement_evaluation',
    generatedAt: input.generatedAt || nowIso(),
    proposalId: proposal.id || null,
    status: failures.length === 0 ? 'ready_for_review' : 'blocked',
    approvedToApply: false,
    failures,
    truthBoundary: 'Even ready proposals require a separate reviewed implementation and tests before rollout.'
  };
}

export function buildImprovementLoopFromRun(input = {}) {
  const generatedAt = input.generatedAt || nowIso();
  const failures = stableList(input.failures || []);
  const observations = stableList(input.observations || failures.map((failure) => `Failure observed: ${failure}`));
  const proposals = observations.map((observation, index) => createImprovementProposal({
    generatedAt,
    title: `Improve from run observation ${index + 1}`,
    sourceObservation: observation,
    proposedChange: input.defaultProposedChange || 'Add or adjust tests/docs/control-plane gates before changing runtime behavior.',
    files: input.files || [],
    riskLevel: failures.length ? 'medium' : 'low'
  }));
  const evaluations = proposals.map((proposal) => evaluateImprovementProposal(proposal, { generatedAt, testsPassed: input.testsPassed !== false }));
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_IMPROVEMENT_LOOP_SCHEMA,
    generatedAt,
    jobId: input.job?.id || input.jobId || null,
    mode: 'bounded_rsi_logs_tests_review_then_propose',
    proposalCount: proposals.length,
    proposals,
    evaluations,
    noAutoApply: true,
    truthBoundary: 'This is a bounded self-improvement loop: propose from evidence, gate with tests/review, never self-apply.'
  };
}

function normalizeReviewDecision(decision = '') {
  const value = String(decision || '').trim();
  if (!SYNTHETIC_LABOR_OS_REVIEW_DECISIONS.includes(value)) throw new Error(`unsupported Synthetic Labor OS review decision: ${value}`);
  return value;
}

function reviewStatusForDecision(decision = '') {
  const value = normalizeReviewDecision(decision);
  if (value === 'approved') return 'approved';
  if (value === 'rejected') return 'rejected';
  if (value === 'changes_requested') return 'changes_requested';
  return 'deferred';
}

function patchIdFrom(input = {}) {
  return String(input.patchId || input.id || input.patch?.id || input.patch?.patchId || '').trim();
}

function claimIdFrom(input = {}) {
  return String(input.claimId || input.claim?.id || input.claim?.claimId || '').trim();
}

export function createReviewRequest(input = {}) {
  const createdAt = input.createdAt || input.generatedAt || nowIso();
  const patchId = patchIdFrom(input);
  const claimId = claimIdFrom(input);
  const jobId = input.jobId || input.job?.id || null;
  const requestedAction = String(input.requestedAction || input.action || 'review_patch').trim();
  const id = String(input.id || `review-${slugify(jobId || 'job')}-${slugify(patchId || claimId || requestedAction)}-${compactTimestamp(createdAt)}`).trim();
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_REVIEW_SCHEMA,
    id,
    jobId,
    status: 'pending',
    requestedAction,
    createdAt,
    updatedAt: createdAt,
    createdBy: input.actor || input.createdBy || 'operator',
    patchId: patchId || null,
    claimId: claimId || null,
    scope: stableList(input.scope || input.approvedScopes || []),
    artifactRefs: stableList(input.artifactRefs || input.artifacts || []),
    reason: input.reason || null,
    patch: input.patch || null,
    claim: input.claim || null,
    decisions: [],
    truthBoundary: 'This is a local Synthetic Labor OS review request. It is not merge, publish, external send, or completion proof.'
  };
}

export function recordReviewDecision(review = {}, input = {}) {
  const decision = normalizeReviewDecision(input.decision || input.status);
  const at = input.at || input.generatedAt || nowIso();
  const record = {
    at,
    actor: input.actor || 'operator',
    decision,
    rationale: input.rationale || input.reason || null,
    approvedScopes: stableList(input.approvedScopes || input.scope || review.scope || []),
    rejectedReasons: stableList(input.rejectedReasons || []),
    artifactRefs: stableList(input.artifactRefs || []),
    effect: 'approval_record_only_no_merge_no_publish_no_completion'
  };
  return {
    ...review,
    schemaVersion: review.schemaVersion || SYNTHETIC_LABOR_OS_REVIEW_SCHEMA,
    status: reviewStatusForDecision(decision),
    updatedAt: at,
    decisions: [...(Array.isArray(review.decisions) ? review.decisions : []), record],
    latestDecision: record,
    truthBoundary: 'Decision is recorded in the local OS control plane only; separate merge/publish/completion gates still apply.'
  };
}

export function attachReviewToJob(job = {}, review = {}) {
  if (!review?.id) throw new Error('review.id is required');
  const reviews = Array.isArray(job.reviews) ? job.reviews : [];
  const nextReviews = reviews.filter((entry) => entry.id !== review.id).concat(review);
  const next = {
    ...job,
    updatedAt: review.updatedAt || review.createdAt || nowIso(),
    reviews: nextReviews,
    reviewSummary: summarizeJobReviews(nextReviews)
  };
  return { ...next, truth: deriveJobTruth(next) };
}

export function summarizeJobReviews(reviews = []) {
  const normalized = Array.isArray(reviews) ? reviews : [];
  const byStatus = {};
  for (const review of normalized) byStatus[review.status || 'unknown'] = (byStatus[review.status || 'unknown'] || 0) + 1;
  return {
    schemaVersion: 'claw.synthetic_labor_os.v0.review_summary',
    reviewCount: normalized.length,
    pendingReviewCount: Number(byStatus.pending || 0),
    approvedReviewCount: Number(byStatus.approved || 0),
    rejectedReviewCount: Number(byStatus.rejected || 0),
    changesRequestedReviewCount: Number(byStatus.changes_requested || 0),
    deferredReviewCount: Number(byStatus.deferred || 0),
    byStatus
  };
}

export function pauseJob(job = {}, input = {}) {
  if ((job.state || 'drafted') === 'paused') return { ...job, truth: deriveJobTruth(job) };
  return transitionJob(job, {
    to: 'paused',
    actor: input.actor || 'operator',
    reason: input.reason || 'human_interrupt_pause',
    blocker: input.blocker === undefined ? (job.blocker || null) : input.blocker,
    artifacts: input.artifacts || {}
  });
}

export function resumeJob(job = {}, input = {}) {
  const to = input.to || 'running';
  if ((job.state || 'drafted') !== 'paused') throw new Error(`cannot resume Synthetic Labor OS job from state: ${job.state || 'drafted'}`);
  return transitionJob(job, {
    to,
    actor: input.actor || 'operator',
    reason: input.reason || 'human_interrupt_resume',
    blocker: input.clearBlocker === false ? (job.blocker || null) : null,
    artifacts: input.artifacts || {}
  });
}

export function requestHumanReview(job = {}, input = {}) {
  const review = createReviewRequest({ ...input, job, jobId: job.id });
  const attached = attachReviewToJob(job, review);
  if (job.state === 'running') {
    const reviewReady = transitionJob(attached, {
      to: 'review_ready',
      actor: input.actor || 'operator',
      reason: input.reason || 'human_review_requested',
      artifacts: input.transitionArtifacts || {}
    });
    return attachReviewToJob(reviewReady, review);
  }
  return attached;
}

function selectExistingReview(job = {}, input = {}) {
  const reviews = Array.isArray(job.reviews) ? job.reviews : [];
  if (input.review) return input.review;
  if (input.reviewId) {
    const byId = reviews.find((review) => review.id === input.reviewId);
    if (byId) return byId;
  }
  const patchId = patchIdFrom(input);
  if (patchId) {
    const pending = reviews.find((review) => review.patchId === patchId && review.status === 'pending');
    if (pending) return pending;
    const latest = reviews.find((review) => review.patchId === patchId);
    if (latest) return latest;
  }
  return null;
}

export function approvePatch(job = {}, input = {}) {
  const baseReview = selectExistingReview(job, input) || createReviewRequest({ ...input, job, jobId: job.id, requestedAction: input.requestedAction || 'approve_patch' });
  const review = recordReviewDecision(
    baseReview,
    { ...input, decision: 'approved' }
  );
  const next = attachReviewToJob(job, review);
  return {
    ...next,
    operatorDecisions: [
      ...(Array.isArray(next.operatorDecisions) ? next.operatorDecisions : []),
      {
        at: review.updatedAt,
        actor: review.latestDecision?.actor || input.actor || 'operator',
        kind: 'patch_approval_recorded',
        patchId: review.patchId || patchIdFrom(input) || null,
        reviewId: review.id,
        effect: 'approval_record_only_no_merge_no_publish_no_completion'
      }
    ],
    truth: deriveJobTruth(next)
  };
}

export function rejectPatch(job = {}, input = {}) {
  const baseReview = selectExistingReview(job, input) || createReviewRequest({ ...input, job, jobId: job.id, requestedAction: input.requestedAction || 'reject_patch' });
  const review = recordReviewDecision(
    baseReview,
    { ...input, decision: input.decision || 'rejected' }
  );
  const next = attachReviewToJob(job, review);
  return {
    ...next,
    operatorDecisions: [
      ...(Array.isArray(next.operatorDecisions) ? next.operatorDecisions : []),
      {
        at: review.updatedAt,
        actor: review.latestDecision?.actor || input.actor || 'operator',
        kind: review.status === 'changes_requested' ? 'patch_changes_requested' : 'patch_rejection_recorded',
        patchId: review.patchId || patchIdFrom(input) || null,
        reviewId: review.id,
        effect: 'decision_record_only_no_merge_no_publish_no_completion'
      }
    ],
    truth: deriveJobTruth(next)
  };
}

export function writeSyntheticLaborOsJob({ job, jobsDir, fileName = null } = {}) {
  if (!job?.id) throw new Error('job.id is required');
  if (!jobsDir) throw new Error('jobsDir is required');
  fs.mkdirSync(jobsDir, { recursive: true });
  const jobPath = path.join(jobsDir, fileName || `${job.id}.json`);
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));
  return { jobPath };
}

export function loadSyntheticLaborOsJobs({ jobsDir } = {}) {
  if (!jobsDir || !fs.existsSync(jobsDir)) return [];
  return fs.readdirSync(jobsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readJson(path.join(jobsDir, entry.name), null))
    .filter((entry) => entry?.schemaVersion === SYNTHETIC_LABOR_OS_JOB_SCHEMA)
    .map((job) => ({ ...job, truth: deriveJobTruth(job) }));
}

function summarizeDashboardJob(job = {}) {
  const truth = job.truth || deriveJobTruth(job);
  const reviewSummary = job.reviewSummary || summarizeJobReviews(job.reviews || []);
  return {
    id: job.id,
    state: job.state,
    title: job.objective?.title || job.id,
    repoPath: job.repoPath || null,
    fidelity: job.fidelity || null,
    requestedAgentCount: job.requestedAgentCount || null,
    updatedAt: job.updatedAt || null,
    artifactRoot: job.agentWork?.artifactRoot || null,
    reviewSummary,
    truth,
    nextOperatorAction: reviewSummary.pendingReviewCount > 0
      ? 'review_pending_requests'
      : truth.status === 'blocked'
      ? 'inspect_blocker_or_replan'
      : truth.status === 'awaiting_review'
        ? 'review_artifacts_and_decide'
        : truth.status === 'paused'
          ? 'resume_or_keep_paused'
          : truth.status === 'green_for_job_contract'
            ? 'archive_or_promote_claim_with_scope'
            : 'monitor_or_compile_next_stage'
  };
}

export function buildOperatorDashboard({
  jobs = [],
  capabilityAudit = null,
  generatedAt = nowIso(),
  executionPlanes = [],
  health = null
} = {}) {
  const jobSummaries = (Array.isArray(jobs) ? jobs : []).map((job) => summarizeDashboardJob(job));
  const byState = Object.fromEntries(SYNTHETIC_LABOR_OS_JOB_STATES.map((state) => [state, 0]));
  for (const job of jobSummaries) byState[job.state] = (byState[job.state] || 0) + 1;
  const attentionJobs = jobSummaries.filter((job) => ['blocked', 'paused', 'review_ready'].includes(job.state) || job.truth?.blocked || job.reviewSummary?.pendingReviewCount > 0);
  const runningJobs = jobSummaries.filter((job) => ['queued', 'running'].includes(job.state));
  const completedJobs = jobSummaries.filter((job) => job.state === 'completed' && job.truth?.completionClaimAllowed === true);
  const reviewQueueCount = jobSummaries.reduce((sum, job) => sum + Number(job.reviewSummary?.pendingReviewCount || 0), 0);
  const capabilitySummary = capabilityAudit?.summary || null;
  const v0ProductReady = capabilitySummary?.v0ProductReady === true && attentionJobs.length === 0;
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_OPERATOR_DASHBOARD_SCHEMA,
    generatedAt,
    behaviorChanging: false,
    readOnly: true,
    jobCount: jobSummaries.length,
    byState,
    runningJobCount: runningJobs.length,
    attentionJobCount: attentionJobs.length,
    completedJobCount: completedJobs.length,
    reviewQueueCount,
    jobs: jobSummaries,
    executionPlanes: Array.isArray(executionPlanes) ? executionPlanes : [],
    health,
    capabilitySummary,
    v0ProductReady,
    truthBoundary: v0ProductReady
      ? 'Dashboard sees no local job blockers and the capability matrix is product-ready; still require separate scale/demo proof before larger claims.'
      : 'Dashboard is read-only and must not be treated as approval, merge, publish, or 100-agent proof.',
    nextOperatorActions: attentionJobs.length
      ? attentionJobs.map((job) => ({ jobId: job.id, action: job.nextOperatorAction }))
      : [{ action: 'create_or_select_job', reason: jobSummaries.length === 0 ? 'no_jobs_loaded' : 'no_attention_jobs' }]
  };
}

export function renderOperatorDashboardMarkdown(dashboard = {}) {
  const lines = [];
  lines.push('# Synthetic Labor OS v0 Operator Dashboard');
  lines.push('');
  lines.push(`Generated: ${dashboard.generatedAt || nowIso()}`);
  lines.push('');
  lines.push(`Read-only: ${dashboard.readOnly === true ? 'true' : 'false'}`);
  lines.push(`Behavior changing: ${dashboard.behaviorChanging === true ? 'true' : 'false'}`);
  lines.push(`v0 product ready: ${dashboard.v0ProductReady === true ? 'true' : 'false'}`);
  lines.push('');
  lines.push('## Truth boundary');
  lines.push('');
  lines.push(dashboard.truthBoundary || 'Unknown.');
  lines.push('');
  lines.push('## Jobs');
  lines.push('');
  lines.push(`- Job count: ${dashboard.jobCount || 0}`);
  lines.push(`- Running/queued: ${dashboard.runningJobCount || 0}`);
  lines.push(`- Attention needed: ${dashboard.attentionJobCount || 0}`);
  lines.push(`- Pending reviews: ${dashboard.reviewQueueCount || 0}`);
  lines.push(`- Completed with scoped claim: ${dashboard.completedJobCount || 0}`);
  lines.push('');
  lines.push('| Job | State | Truth | Pending reviews | Next action |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const job of dashboard.jobs || []) {
    lines.push(`| ${job.title || job.id} | ${job.state} | ${job.truth?.status || 'unknown'} | ${job.reviewSummary?.pendingReviewCount || 0} | ${job.nextOperatorAction || ''} |`);
  }
  lines.push('');
  lines.push('## Next operator actions');
  lines.push('');
  for (const action of dashboard.nextOperatorActions || []) {
    lines.push(`- ${action.jobId ? `${action.jobId}: ` : ''}${action.action}${action.reason ? ` (${action.reason})` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export function writeOperatorDashboard({ dashboard, artifactRoot } = {}) {
  if (!artifactRoot) throw new Error('artifactRoot is required');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const jsonPath = path.join(artifactRoot, 'operator_dashboard.json');
  const markdownPath = path.join(artifactRoot, 'operator_dashboard.md');
  fs.writeFileSync(jsonPath, JSON.stringify(dashboard, null, 2));
  fs.writeFileSync(markdownPath, renderOperatorDashboardMarkdown(dashboard));
  return { jsonPath, markdownPath };
}

function cleanDemoCompletionSummary({ generatedAt, job, testEvidence } = {}) {
  return {
    schemaVersion: 'claw.synthetic_labor_os.v0.demo_completion_summary',
    generatedAt: generatedAt || nowIso(),
    benchmarkId: 'synthetic_labor_os_v0_clean_demo',
    runId: job?.id || 'slos-v0-clean-demo',
    thresholdPass: testEvidence?.ok === true,
    supervisorConfirmedCompletion: testEvidence?.ok === true,
    mechanicalGreen: testEvidence?.ok === true,
    scaleProofReady: false,
    executionMode: 'local_deterministic_os_shell_demo',
    jobId: job?.id || null,
    testRunCount: testEvidence?.testRunCount || 0,
    failedTestRunCount: testEvidence?.failedTestRunCount || 0,
    blocker: testEvidence?.ok === true ? null : { blockerKind: 'demo_tests_failed', blocker: 'Synthetic Labor OS v0 demo tests did not pass.' },
    truthBoundary: 'This proves the v0 OS shell flow only: intake, compile, queue, local demo execution evidence, review, test evidence, truth dashboard, and scoped completion. It is not a real 100-agent run.'
  };
}

export function buildCleanV0DemoProof({ workspaceRoot = process.cwd(), artifactRoot = null, generatedAt = nowIso() } = {}) {
  const job = createJob({
    id: 'slos-v0-clean-demo',
    createdAt: generatedAt,
    createdBy: 'synthetic-labor-os-proof-harness',
    objective: {
      id: 'slos-v0-clean-demo',
      title: 'Synthetic Labor OS v0 clean demo proof',
      outcome: 'Prove the v0 control-plane product shell without launching heavy workers.',
      requestedFidelity: 'production_slice',
      stopCondition: 'thresholdPass=true for local demo contract or blocker artifact'
    },
    repoPath: path.join(workspaceRoot, 'large-project-capability-stack'),
    fidelity: 'production_slice',
    requestedAgentCount: 1,
    artifactRoot
  });
  const intakeContract = createJobIntakeContract({ job, generatedAt });
  const testContract = createJobTestContract({
    job,
    generatedAt,
    commands: ['node --test tests/synthetic-labor-os.test.mjs'],
    docsRefs: ['docs/SYNTHETIC_LABOR_OS_V0.md'],
    invariants: [
      'drafted jobs compile before queueing',
      'review approval records never merge/publish/complete by themselves',
      'completion requires thresholdPass=true and no blocker',
      'heavy scale proof is admitted from execution-plane artifacts, not launched locally'
    ]
  });
  const compiled = compileJobContract(job, {
    generatedAt,
    artifactRoot,
    surfaces: ['intake_contract', 'work_queue', 'demo_agent_execution', 'human_review', 'truth_dashboard']
  });
  const workQueue = createWorkQueueArtifact({
    job: compiled,
    generatedAt,
    workItems: [{
      id: 'demo-agent-execution',
      title: 'Run deterministic demo agent and emit proof artifacts',
      surfaceId: 'demo_agent_execution',
      state: 'ready',
      assignedAgentId: 'demo-agent-1',
      requiredEvidence: ['test_contract', 'agent_execution_artifact', 'operator_review', 'completion_summary']
    }]
  });
  const queued = queueJob(compiled, { generatedAt, queue: workQueue });
  const agentStatus = buildAgentStatusRecords({
    generatedAt,
    job: queued,
    requestedAgentCount: 1,
    workerResults: [{ agentId: 'demo-agent-1', state: 'completed', surfaceId: 'demo_agent_execution' }]
  });
  const running = transitionJob(queued, {
    to: 'running',
    generatedAt,
    reason: 'demo_agent_started',
    metrics: { agentStatus }
  });
  const reviewReady = requestHumanReview(running, {
    generatedAt,
    actor: 'synthetic-labor-os-proof-harness',
    patchId: 'demo-control-plane-artifact',
    artifactRefs: ['demo_proof.json', 'test_contract.json', 'truth_dashboard_section.json'],
    reason: 'demo_artifacts_ready_for_review'
  });
  const approved = approvePatch(reviewReady, {
    generatedAt,
    actor: 'synthetic-labor-os-proof-harness',
    patchId: 'demo-control-plane-artifact',
    approvedScopes: ['local_demo_contract'],
    rationale: 'Demo artifact is scoped to local control-plane proof only.'
  });
  const withTests = recordJobTestEvidence(approved, {
    generatedAt,
    testContract,
    testRuns: [{ command: 'node --test tests/synthetic-labor-os.test.mjs', ok: true, exitCode: 0, summary: 'focused Synthetic Labor OS tests passed in the proof harness contract' }],
    documentationRefs: ['docs/SYNTHETIC_LABOR_OS_V0.md']
  });
  const completionSummary = cleanDemoCompletionSummary({ generatedAt, job: withTests, testEvidence: withTests.artifacts.testEvidence });
  const completed = transitionJob(withTests, {
    to: 'completed',
    generatedAt,
    reason: 'demo_threshold_passed_for_local_os_shell_contract',
    artifacts: { completionSummary }
  });
  const improvementLoop = buildImprovementLoopFromRun({
    generatedAt,
    job: completed,
    observations: ['Friend feedback: tests/docs/comments and bounded self-improvement loops should be first-class coordination surfaces.'],
    defaultProposedChange: 'Keep tests, why-oriented docs, and gated improvement proposals in the Synthetic Labor OS product surface.',
    files: ['packages/synthetic-labor-os/index.mjs', 'tests/synthetic-labor-os.test.mjs', 'docs/SYNTHETIC_LABOR_OS_V0.md'],
    testsPassed: true
  });
  const executionPlaneRegistry = createExecutionPlaneRegistry({
    generatedAt,
    planes: [{
      id: 'local-control-plane',
      role: 'control_plane',
      host: 'openclaw-local',
      healthy: true,
      heavyWorkAllowed: false,
      capacityAgentCount: 0,
      artifactRoot
    }]
  });
  const truthDashboardSection = buildTruthDashboardSection({
    generatedAt,
    job: completed,
    proofArtifacts: ['demo_proof.json', 'completion_summary.json', 'test_contract.json', 'improvement_loop.json'],
    demoProof: { thresholdPass: true, executionMode: 'local_deterministic_os_shell_demo' }
  });
  const proof = {
    schemaVersion: SYNTHETIC_LABOR_OS_DEMO_PROOF_SCHEMA,
    generatedAt,
    workspaceRoot: path.resolve(workspaceRoot),
    artifactRoot: artifactRoot ? path.resolve(artifactRoot) : null,
    thresholdPass: true,
    proofKind: 'local_deterministic_control_plane_demo',
    steps: [
      'objective_intake_bound',
      'contract_compiled',
      'work_queue_created',
      'demo_agent_execution_recorded',
      'human_review_requested_and_recorded',
      'test_contract_evidence_attached',
      'truth_dashboard_section_built',
      'scoped_completion_summary_written'
    ],
    job,
    completedJob: completed,
    intakeContract,
    testContract,
    workQueue,
    agentStatus,
    patchQueueStatus: buildPatchQueueStatus({ generatedAt, patches: [{ id: 'demo-control-plane-artifact', status: 'approved' }], reviews: completed.reviews || [] }),
    improvementLoop,
    executionPlaneRegistry,
    truthDashboardSection,
    completionSummary,
    truthBoundary: 'Clean v0 demo proof is scoped to the Synthetic Labor OS shell. It proves product flow and gates, not external publishing, real Codex work, or 100-agent scale.'
  };
  return proof;
}

export function writeCleanV0DemoProof({ proof, artifactRoot } = {}) {
  if (!proof) throw new Error('proof is required');
  if (!artifactRoot) throw new Error('artifactRoot is required');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const jobsDir = path.join(artifactRoot, 'jobs');
  const written = {
    demoProofPath: writeJsonFile(path.join(artifactRoot, 'demo_proof.json'), proof),
    completionSummaryPath: writeJsonFile(path.join(artifactRoot, 'completion_summary.json'), proof.completionSummary),
    testContractPath: writeJsonFile(path.join(artifactRoot, 'test_contract.json'), proof.testContract),
    testEvidencePath: writeJsonFile(path.join(artifactRoot, 'test_evidence.json'), proof.completedJob?.artifacts?.testEvidence || null),
    intakeContractPath: writeJsonFile(path.join(artifactRoot, 'intake_contract.json'), proof.intakeContract),
    workQueuePath: writeJsonFile(path.join(artifactRoot, 'work_queue.json'), proof.workQueue),
    agentStatusPath: writeJsonFile(path.join(artifactRoot, 'agent_status.json'), proof.agentStatus),
    patchQueueStatusPath: writeJsonFile(path.join(artifactRoot, 'patch_queue_status.json'), proof.patchQueueStatus),
    improvementLoopPath: writeJsonFile(path.join(artifactRoot, 'improvement_loop.json'), proof.improvementLoop),
    executionPlaneRegistryPath: writeJsonFile(path.join(artifactRoot, 'execution_plane_registry.json'), proof.executionPlaneRegistry),
    truthDashboardSectionPath: writeJsonFile(path.join(artifactRoot, 'truth_dashboard_section.json'), proof.truthDashboardSection),
    jobPath: writeSyntheticLaborOsJob({ job: proof.completedJob, jobsDir, fileName: `${proof.completedJob.id}.json` }).jobPath
  };
  return written;
}

function numericMetric(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function admitHundredAgentScaleProof({
  sourceRoot,
  generatedAt = nowIso(),
  minAgents = 100,
  minDurationMinutes = 30
} = {}) {
  if (!sourceRoot) throw new Error('sourceRoot is required');
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const localVerificationPath = path.join(resolvedSourceRoot, 'local-verification-summary.json');
  const controllerCompletionPath = path.join(resolvedSourceRoot, 'controller', 'completion_summary.json');
  const waveCompletionPath = path.join(resolvedSourceRoot, 'controller', 'waves', 'wave-001', 'completion_summary.json');
  const creativeEvidencePath = path.join(resolvedSourceRoot, 'controller', 'waves', 'wave-001', 'creative_worker_evidence.json');
  const localVerification = readJson(localVerificationPath, null);
  const controllerCompletion = readJson(controllerCompletionPath, null);
  const waveCompletion = readJson(waveCompletionPath, null);
  const creativeEvidence = readJson(creativeEvidencePath, null);

  const failures = [];
  if (!localVerification) failures.push('missing_local_verification_summary');
  if (!controllerCompletion) failures.push('missing_controller_completion_summary');
  if (!waveCompletion) failures.push('missing_wave_completion_summary');
  if (localVerification?.thresholdPass !== true || controllerCompletion?.thresholdPass !== true || waveCompletion?.thresholdPass !== true) failures.push('threshold_not_passed');
  if (localVerification?.mechanicalGreen !== true || controllerCompletion?.mechanicalGreen !== true || waveCompletion?.mechanicalGreen !== true) failures.push('mechanical_green_missing');
  if (localVerification?.scaleProofReady !== true || controllerCompletion?.scaleProofReady !== true || waveCompletion?.scaleProofReady !== true) failures.push('scale_proof_not_ready');

  const uniqueAgentCount = numericMetric(localVerification?.uniqueAgentCount, waveCompletion?.concurrencyTruth?.uniqueAgentCount);
  const peakConcurrency = numericMetric(localVerification?.peakConcurrency, waveCompletion?.peakConcurrency, waveCompletion?.concurrencyTruth?.peakConcurrentWorkers);
  const shardCount = numericMetric(localVerification?.shardCount, waveCompletion?.shardCount);
  const mergedShardCount = numericMetric(localVerification?.mergedShardCount, waveCompletion?.mergedShardCount);
  const durationMinutes = numericMetric(localVerification?.durationMinutes, waveCompletion?.durationMinutes, waveCompletion?.concurrencyTruth?.wallClockMinutes);
  const codexCallsStarted = numericMetric(localVerification?.codexCallsStarted, waveCompletion?.modelCallLedger?.started);
  const codexCallsCompleted = numericMetric(localVerification?.codexCallsCompleted, waveCompletion?.modelCallLedger?.completed);
  const productiveSurfaceCount = numericMetric(localVerification?.productiveSurfaceCount, creativeEvidence?.okSurfaceCount);
  const productDeltaIntegrity = numericMetric(localVerification?.creativeProductDeltaIntegrity, creativeEvidence?.creativeProductDeltaIntegrity);

  if ((uniqueAgentCount || 0) < minAgents) failures.push('unique_agent_count_below_requirement');
  if ((peakConcurrency || 0) < minAgents) failures.push('peak_concurrency_below_requirement');
  if ((shardCount || 0) < minAgents || (mergedShardCount || 0) < minAgents) failures.push('shard_merge_count_below_requirement');
  if ((durationMinutes || 0) < minDurationMinutes) failures.push('duration_below_requirement');
  if ((codexCallsStarted || 0) < minAgents || (codexCallsCompleted || 0) < minAgents) failures.push('provider_model_call_count_below_requirement');
  if ((productiveSurfaceCount || 0) < minAgents) failures.push('productive_surface_count_below_requirement');
  if (productDeltaIntegrity !== 1) failures.push('product_delta_integrity_not_one');
  if (localVerification?.blocker || controllerCompletion?.blocker || waveCompletion?.blocker) failures.push('blocker_present');

  const admitted = failures.length === 0;
  return {
    schemaVersion: SYNTHETIC_LABOR_OS_SCALE_PROOF_SCHEMA,
    generatedAt,
    proofKind: 'admitted_existing_execution_plane_artifact',
    sourceArtifactRoot: resolvedSourceRoot,
    sourceFiles: {
      localVerificationPath,
      controllerCompletionPath,
      waveCompletionPath,
      creativeEvidencePath
    },
    admitted,
    thresholdPass: admitted,
    status: admitted ? 'scale_proof_admitted' : 'scale_proof_blocked',
    minAgents,
    minDurationMinutes,
    metrics: {
      uniqueAgentCount,
      peakConcurrency,
      shardCount,
      mergedShardCount,
      durationMinutes,
      codexCallsStarted,
      codexCallsCompleted,
      productiveSurfaceCount,
      productDeltaIntegrity,
      activeWorkerMinutes: numericMetric(localVerification?.activeWorkerMinutes, waveCompletion?.scaleCredit?.activeWorkerMinutes)
    },
    failures,
    sourceTruth: {
      localVerification,
      controllerCompletion: controllerCompletion ? {
        benchmarkId: controllerCompletion.benchmarkId,
        runId: controllerCompletion.runId,
        thresholdPass: controllerCompletion.thresholdPass,
        mechanicalGreen: controllerCompletion.mechanicalGreen,
        scaleProofReady: controllerCompletion.scaleProofReady,
        waveCount: controllerCompletion.waveCount,
        blocker: controllerCompletion.blocker || null
      } : null,
      waveCompletion: waveCompletion ? {
        benchmarkId: waveCompletion.benchmarkId,
        runId: waveCompletion.runId,
        thresholdPass: waveCompletion.thresholdPass,
        requestedAgentCount: waveCompletion.requestedAgentCount,
        peakConcurrency: waveCompletion.peakConcurrency,
        durationMinutes: waveCompletion.durationMinutes,
        blocker: waveCompletion.blocker || null
      } : null
    },
    truthBoundary: admitted
      ? 'This admits an existing verified 100-agent execution-plane artifact into the Synthetic Labor OS v0 proof set. No new 100-agent run was launched from the control plane in this pass.'
      : '100-agent proof is blocked; do not claim v0 scale proof until all failures clear.'
  };
}

export function writeHundredAgentScaleProof({ proof, artifactRoot } = {}) {
  if (!proof) throw new Error('proof is required');
  if (!artifactRoot) throw new Error('artifactRoot is required');
  return { scaleProofPath: writeJsonFile(path.join(artifactRoot, '100_agent_scale_proof.json'), proof) };
}
