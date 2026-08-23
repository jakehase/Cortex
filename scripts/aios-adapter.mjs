#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { AIOS_EVIDENCE_MAX_AGE_MS, digestJson, validateBoundVerifierEvidence } from '../ai-os/packages/aios-language/runtime/claim-evidence.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(path.join(SCRIPT_DIR, '..'));
const AI_OS_ROOT = path.join(WORKSPACE_ROOT, 'ai-os');
const AIOS_CLI = path.join(AI_OS_ROOT, 'apps', 'aios-cli.mjs');
const AIOS_VERIFIER = path.join(AI_OS_ROOT, 'apps', 'aios-verifier.mjs');
const PROVIDER_WORKFLOW_RUNNER = path.join(AI_OS_ROOT, 'apps', 'run-provider-workflow.mjs');
const DEFAULT_DOGFOOD_ROOT = path.join(AI_OS_ROOT, 'artifacts', 'openclaw-dogfood');
const RUNTIME_STATE_DIR = path.join(WORKSPACE_ROOT, 'state', 'ai-os-adapter');
const ROOT_POINTER_DIR = RUNTIME_STATE_DIR;
const ROOT_POINTER_FILE = path.join(ROOT_POINTER_DIR, 'latest-adapter-root.json');
const DEFAULT_CONFIG_TEMPLATE_FILE = path.join(WORKSPACE_ROOT, 'config', 'ai-os-adapter', 'default.json');
const DEFAULT_CONFIG_FILE = path.join(RUNTIME_STATE_DIR, 'active-default.json');
const DEFAULT_STATE_FILE = path.join(WORKSPACE_ROOT, 'state', 'ai-os-adapter', 'default-on-state.json');
const LAST_ROOT_FILE = path.join(RUNTIME_STATE_DIR, 'last-root.txt');
const PROVIDER_DOGFOOD_SOURCE = path.join(AI_OS_ROOT, 'examples', 'capability-gated-provider.aios');
const DEFAULT_PROVIDER_POLICY = path.join(AI_OS_ROOT, 'kernel', 'policy', 'provider-read-compute.json');
const ADAPTER_VERSION = 'openclaw-aios-adapter.v0.6-v1-freeze-provider-workflows';
const CANONICAL_LANGUAGE_VERSION = 'aios.language.v1';

function nowStamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function usage(exitCode = 0) {
  const text = `AI OS adapter — bounded local bridge for the AI OS language substrate\n\nUsage:\n  node scripts/aios-adapter.mjs promote-default [--label <name>]\n  node scripts/aios-adapter.mjs promote-default --resume --artifact-root <staged-workspace-path>\n  node scripts/aios-adapter.mjs dogfood-smoke [--artifact-root <workspace-path>] [--label <name>]\n  node scripts/aios-adapter.mjs provider-workflow --workflow <id> --query <text> [--artifact-root <workspace-path>]\n  node scripts/aios-adapter.mjs compile <source.aios> --artifact-root <workspace-path>\n  node scripts/aios-adapter.mjs boot --artifact-root <workspace-path>\n  node scripts/aios-adapter.mjs run <source.aios|job.json> --artifact-root <workspace-path>\n  node scripts/aios-adapter.mjs ps --artifact-root <workspace-path>\n  node scripts/aios-adapter.mjs logs --artifact-root <workspace-path> --process <process-id>\n  node scripts/aios-adapter.mjs claim <source.aios|job.json> --artifact-root <workspace-path>\n  node scripts/aios-adapter.mjs status [--artifact-root <workspace-path>|--last]\n  node scripts/aios-adapter.mjs recover [--artifact-root <workspace-path>|--last]\n\nSafety boundary:\n  - The checked-in default is disabled; promotion is a two-phase stage, explicit-approval, resume flow.\n  - AIOS v1 is frozen; surface changes require execution evidence and explicit approval.\n  - Canonical .aios source is compiled before bounded execution.\n  - Provider read/compute uses externally visible network POSTs; returned results stay in internal artifacts.\n  - Does not replace OpenClaw/Cortex routing or the chat/control-plane brain.\n  - Artifact roots must stay inside this workspace.\n`;
  console.log(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const [keyRaw, inline] = token.slice(2).split('=', 2);
    const key = keyRaw.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (inline !== undefined) { args[key] = inline; continue; }
    if (['last', 'resume'].includes(key)) { args[key] = true; continue; }
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

function ensureAiOsReady() {
  if (!fs.existsSync(AIOS_CLI)) {
    throw new Error(`AI OS CLI not found at ${AIOS_CLI}`);
  }
}

function resolveWorkspacePath(input, { defaultRoot = null, mustExist = false } = {}) {
  const raw = input || defaultRoot;
  if (!raw) throw new Error('workspace path required');
  const resolved = path.resolve(WORKSPACE_ROOT, raw);
  const rel = path.relative(WORKSPACE_ROOT, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refusing path outside workspace: ${resolved}`);
  }
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`path does not exist: ${resolved}`);
  return resolved;
}

function resolveAiOsArtifactRoot(input, { defaultRoot = null, mustExist = false } = {}) {
  const resolved = resolveWorkspacePath(input, { defaultRoot, mustExist });
  const rel = path.relative(AI_OS_ROOT, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`AI OS CLI requires artifact roots inside ${AI_OS_ROOT}; got ${resolved}`);
  }
  return resolved;
}

function defaultArtifactRoot(label = 'dogfood') {
  const safeLabel = String(label || 'dogfood').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'dogfood';
  return path.join(DEFAULT_DOGFOOD_ROOT, `${safeLabel}-${nowStamp()}`);
}

function parseJsonOutput(result) {
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (stdout) {
    try { return JSON.parse(stdout); } catch { return { rawStdout: stdout, rawStderr: stderr || null }; }
  }
  if (stderr) {
    try { return JSON.parse(stderr); } catch { return { rawStdout: stdout || null, rawStderr: stderr }; }
  }
  return null;
}

function runAios(args, { expect = 0 } = {}) {
  ensureAiOsReady();
  const result = spawnSync(process.execPath, [AIOS_CLI, ...args], {
    cwd: AI_OS_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      AIOS_OPERATOR: process.env.AIOS_OPERATOR || process.env.USER || 'openclaw',
      AIOS_TENANT_ID: process.env.AIOS_TENANT_ID || 'openclaw-local'
    }
  });
  const parsed = parseJsonOutput(result);
  if (result.status !== expect) {
    const error = new Error(`aios command failed: ${args.join(' ')}`);
    error.details = { command: args, expectedStatus: expect, actualStatus: result.status, parsed, stdout: result.stdout, stderr: result.stderr };
    throw error;
  }
  return parsed;
}

function runBoundVerifier({ artifactRoot, jobPath, providerPolicyPath = DEFAULT_PROVIDER_POLICY }) {
  const result = spawnSync(process.execPath, [
    AIOS_VERIFIER,
    '--job', jobPath,
    '--artifact-root', artifactRoot,
    '--provider-policy', providerPolicyPath,
  ], {
    cwd: AI_OS_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      AIOS_OPERATOR: process.env.AIOS_OPERATOR || process.env.USER || 'openclaw',
      AIOS_TENANT_ID: process.env.AIOS_TENANT_ID || 'openclaw-local'
    }
  });
  const parsed = parseJsonOutput(result);
  if (result.status !== 0 || parsed?.ok !== true) {
    const error = new Error('bound AIOS replay verifier rejected current run evidence');
    error.details = { actualStatus: result.status, parsed, stdout: result.stdout, stderr: result.stderr };
    throw error;
  }
  return parsed;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function readDefaultConfig() {
  return readJson(DEFAULT_CONFIG_FILE, null) || readJson(DEFAULT_CONFIG_TEMPLATE_FILE, null);
}

function rootPointerArtifactRoot() {
  return readJson(ROOT_POINTER_FILE, null)?.artifactRoot || null;
}

function defaultAdapterRoot({ mustExist = true } = {}) {
  const config = readDefaultConfig();
  const candidates = config?.enabled === true
    ? [config.defaultArtifactRoot].filter(Boolean)
    : [];
  for (const candidate of candidates) {
    try {
      return resolveAiOsArtifactRoot(candidate, { mustExist });
    } catch {
      // Try the next remembered/default root.
    }
  }
  return null;
}

function defaultSafetyBoundary({ defaultOn = false } = {}) {
  return defaultOn
    ? 'default_on_frozen_aios_v1_internal_status_recovery_handoff_provider_workflows_external_post_transport_internal_result_storage_no_runtime_replacement'
    : 'opt_in_frozen_aios_v1_capability_gated_provider_workflows_external_post_transport_internal_result_storage_no_default_runtime_replacement';
}

function writeDefaultConfig({ artifactRoot, promotionReportPath = null, status = 'green' } = {}) {
  const config = {
    schemaVersion: 'openclaw.aios.adapter.default.v1',
    enabled: true,
    mode: 'always_on_internal_aios_language_status_recovery_handoff_provider_read_compute',
    promotedAt: new Date().toISOString(),
    adapter: ADAPTER_VERSION,
    defaultArtifactRoot: artifactRoot,
    rootPointerFile: ROOT_POINTER_FILE,
    lastRootFile: LAST_ROOT_FILE,
    status,
    promotionReportPath,
    policy: {
      defaultUses: ['status', 'recover', 'local_handoff', 'bounded_internal_jobs', 'provider_read', 'provider_compute_internal_artifacts', 'provider_workflows'],
      canonicalLanguage: CANONICAL_LANGUAGE_VERSION,
      languageV1Frozen: true,
      languageSurfaceChangesRequireExecutionEvidenceAndApproval: true,
      sourceCompileRequiredForDogfood: true,
      capabilityGatedProviderReadCompute: true,
      providerWorkflows: ['research-synthesis', 'contradiction-review', 'implementation-brief'],
      providerOutputBoundary: 'internal-artifact-only',
      externalWritesExposed: true,
      externalTransportEffect: 'network-post',
      providerResultStorageExternalWrites: false,
      remoteSideEffects: 'not_observable',
      replacesCortexOpenClawRouting: false,
      replacesChatControlPlane: false,
      requiresExplicitApprovalFor: ['external_write', 'provider_handoff', 'default_runtime_replacement']
    },
    truthBoundary: 'This active default was atomically promoted only after fresh smoke, process-completion, supported verifier-contract replay, bound claim, recovery, and explicit operator approval. Provider calls perform externally visible network POST writes; returned results remain internal artifacts and remote side effects are not observable here. Local executable hashes detect version drift but are not cryptographic principal authentication. AIOS does not replace Cortex/OpenClaw routing or promote failed output.'
  };
  writeJsonAtomic(DEFAULT_CONFIG_FILE, config);
  return config;
}

function writeDefaultState({ artifactRoot, status = 'green', report = null } = {}) {
  const state = {
    schemaVersion: 'openclaw.aios.adapter.default_state.v1',
    updatedAt: new Date().toISOString(),
    enabled: true,
    mode: 'always_on_internal_aios_language_status_recovery_handoff_provider_read_compute',
    canonicalLanguage: CANONICAL_LANGUAGE_VERSION,
    artifactRoot,
    status,
    report,
    defaultConfigFile: DEFAULT_CONFIG_FILE,
    safetyBoundary: defaultSafetyBoundary({ defaultOn: true })
  };
  writeJsonAtomic(DEFAULT_STATE_FILE, state);
  return state;
}

function rememberRoot(artifactRoot, { defaultOn = null } = {}) {
  fs.mkdirSync(path.dirname(LAST_ROOT_FILE), { recursive: true });
  fs.writeFileSync(LAST_ROOT_FILE, `${artifactRoot}\n`);
  fs.mkdirSync(ROOT_POINTER_DIR, { recursive: true });
  const defaultConfig = readDefaultConfig();
  const enabled = defaultOn === null ? defaultConfig?.enabled === true : defaultOn === true;
  writeJsonAtomic(ROOT_POINTER_FILE, {
    generatedAt: new Date().toISOString(),
    artifactRoot,
    defaultOn: enabled,
    defaultConfigFile: enabled ? DEFAULT_CONFIG_FILE : null,
    note: enabled
      ? 'Latest AI OS adapter root and default-on internal substrate pointer; live artifact roots remain inside ai-os/ for workspace-boundary safety.'
      : 'AI OS CLI keeps live artifact roots inside ai-os/ for workspace-boundary safety; this root-level file is only a pointer.'
  });
}

function lastRoot() {
  return fs.existsSync(LAST_ROOT_FILE) ? fs.readFileSync(LAST_ROOT_FILE, 'utf8').trim() : null;
}

function artifactFreshness(packet, nowMs = Date.now()) {
  const observedAt = packet?.generatedAt || packet?.observedAt || null;
  const observedMs = Date.parse(String(observedAt || ''));
  const ageMs = Number.isFinite(observedMs) ? nowMs - observedMs : null;
  return {
    observedAt,
    ageMs,
    stale: ageMs === null || ageMs < -60_000 || ageMs > AIOS_EVIDENCE_MAX_AGE_MS,
    maximumAgeMs: AIOS_EVIDENCE_MAX_AGE_MS
  };
}

function expectedClaimHash(claim) {
  if (!claim) return null;
  return digestJson({
    packetType: claim.packetType,
    route: claim.route,
    operatorRequest: claim.operatorRequest,
    job: claim.job,
    artifactRoot: claim.artifactRoot,
    tenantBoundary: claim.tenantBoundary,
    lifecycleSettings: claim.lifecycleSettings,
    providerContract: claim.providerContract,
    requiredArtifacts: claim.requiredArtifacts,
    evidenceBinding: claim.evidenceBinding,
    verifierIdentity: claim.verifierIdentity,
    claimScope: claim.claimScope,
    claimStatus: claim.claimStatus,
    approvalRequirement: claim.approvalRequirement,
  });
}

function validatePromotionApproval({ smoke }) {
  const artifactRoot = resolveAiOsArtifactRoot(smoke?.artifactRoot, { mustExist: true });
  const claimPath = path.join(artifactRoot, 'packets', 'completion-claim.packet.json');
  const approvalPath = path.join(artifactRoot, 'packets', 'operator-approval.packet.json');
  const claim = readJson(claimPath, null);
  const approval = readJson(approvalPath, null);
  const approvalAt = Date.parse(String(approval?.generatedAt || ''));
  const claimAt = Date.parse(String(claim?.generatedAt || ''));
  const expectedApprovalHash = approval ? digestJson({
    packetType: approval.packetType,
    route: approval.route,
    operatorRequest: approval.operatorRequest,
    tenantBoundary: approval.tenantBoundary,
    providerContract: approval.providerContract,
    subject: approval.subject,
    decision: approval.decision,
    reason: approval.reason,
    approver: approval.approver,
  }) : null;
  const role = approval?.operatorRequest?.operatorScope?.role;
  const checks = [
    { name: 'claim_hash_valid', ok: typeof claim?.claimHash === 'string' && claim.claimHash === expectedClaimHash(claim) },
    { name: 'claim_requires_explicit_approval', ok: claim?.approvalRequirement === 'required' && claim?.nextAction?.state === 'awaiting_operator_approval' },
    { name: 'approval_packet_green', ok: approval?.packetType === 'aios.operator.approval' && approval?.ok === true && approval?.decision === 'approve' },
    { name: 'approval_subject_matches_claim', ok: typeof claim?.subject === 'string' && approval?.subject === claim.subject },
    { name: 'approval_artifact_root_matches', ok: approval?.artifactRoot === artifactRoot && claim?.artifactRoot === artifactRoot },
    { name: 'approval_tenant_matches_claim', ok: approval?.tenantBoundary?.boundaryHash === claim?.tenantBoundary?.boundaryHash },
    { name: 'approval_principal_is_explicit', ok: ['approver', 'operator', 'admin'].includes(role) && approval?.operatorRequest?.operatorScope?.roleAcceptedForCommand === true && approval?.approver === approval?.operatorRequest?.operatorScope?.operator },
    { name: 'approval_hash_valid', ok: typeof approval?.approvalHash === 'string' && approval.approvalHash === expectedApprovalHash },
    { name: 'approval_after_claim', ok: Number.isFinite(approvalAt) && Number.isFinite(claimAt) && approvalAt >= claimAt },
    { name: 'approval_fresh', ok: approval !== null && artifactFreshness(approval).stale === false },
  ];
  return {
    ok: checks.every((check) => check.ok),
    artifactRoot,
    claimPath,
    approvalPath,
    subject: claim?.subject || null,
    checks,
  };
}

function compactStatus(artifactRoot) {
  const config = readDefaultConfig();
  const root = resolveAiOsArtifactRoot(artifactRoot || defaultAdapterRoot({ mustExist: true }), { mustExist: true });
  const processIndex = readJson(path.join(root, 'processes', 'process-index.json'), {});
  const adapterReportPath = path.join(root, 'adapter-report.json');
  const statusReportPath = path.join(root, 'reports', 'status-report.json');
  const recoveryReportPath = path.join(root, 'reports', 'recovery-report.json');
  const adapterReportDirect = readJson(adapterReportPath, null);
  const statusReport = readJson(statusReportPath, null);
  const recoveryReport = readJson(recoveryReportPath, null);
  const adapterReport = adapterReportDirect || statusReport || recoveryReport;
  const claim = readJson(path.join(root, 'packets', 'completion-claim.packet.json'), null);
  const boot = readJson(path.join(root, 'packets', 'boot-proof.packet.json'), null);
  const run = readJson(path.join(root, 'packets', 'run-proof.packet.json'), null);
  const verifierEvidence = readJson(path.join(root, 'packets', 'verifier-evidence.packet.json'), null);
  const languageCompile = readJson(path.join(root, 'packets', 'language-compile.packet.json'), null);
  const languageSources = fs.readdirSync(root).filter((entry) => entry.endsWith('.aios')).sort();
  const rollbackPlanPath = path.join(root, 'reports', 'rollback-plan.md');
  const recoveryPlanPath = path.join(root, 'reports', 'recovery-plan.md');
  const tenantBoundary = readJson(path.join(root, '.aios-tenant-boundary.json'), null);
  const jobPath = run?.job?.path || null;
  const job = jobPath ? readJson(jobPath, null) : null;
  const providerPolicyPath = run?.providerPolicy?.path || DEFAULT_PROVIDER_POLICY;
  const providerPolicy = readJson(providerPolicyPath, null);
  const verifierValidation = job && boot && run && verifierEvidence && tenantBoundary && providerPolicy
    ? validateBoundVerifierEvidence({
      artifactRoot: root,
      job,
      bootProof: boot,
      runProof: run,
      verifierEvidence,
      providerPolicy,
      tenantBoundary
    })
    : { ok: false, errors: [{ code: 'AIOS_STATUS_REQUIRED_BOUND_EVIDENCE_MISSING' }], binding: null };
  const claimBindingOk = verifierValidation.ok === true
    && job !== null
    && verifierValidation.binding !== null
    && claim?.claimStatus === 'allowed'
    && claim?.claimHash === expectedClaimHash(claim)
    && claim?.job?.hash === run?.job?.hash
    && claim?.requiredArtifacts?.bootProof?.hash === (boot ? digestJson(boot) : null)
    && claim?.requiredArtifacts?.runProof?.hash === (run ? digestJson(run) : null)
    && claim?.requiredArtifacts?.verifierEvidence?.hash === (verifierEvidence ? digestJson(verifierEvidence) : null)
    && digestJson(claim?.evidenceBinding ?? null) === digestJson(verifierValidation.binding);
  const processCount = Array.isArray(processIndex.processes) ? processIndex.processes.length : (processIndex.count ?? null);
  const languageRequired = languageSources.length > 0;
  const readinessChecks = [
    { name: 'boot_proof_current_and_valid', ok: boot?.ok === true && artifactFreshness(boot).stale === false },
    { name: 'run_proof_current_and_valid', ok: run?.ok === true && run?.process?.state === 'completed' && artifactFreshness(run).stale === false },
    { name: 'bound_verifier_replay_current', ok: verifierValidation.ok === true },
    { name: 'completion_claim_bound', ok: claimBindingOk },
    { name: 'process_index_present', ok: Number.isInteger(processCount) && processCount > 0 },
    { name: 'canonical_language_compile_current', ok: languageRequired ? languageCompile?.ok === true : true }
  ];
  const passedChecks = readinessChecks.slice(0, 5).filter((check) => check.ok).length;
  const ok = readinessChecks.every((check) => check.ok);
  const status = ok ? 'green' : passedChecks > 0 ? 'degraded' : 'red';
  return {
    ok,
    status,
    available: true,
    readinessChecks,
    artifactRoot: root,
    defaultOn: config?.enabled === true,
    defaultMode: config?.mode || null,
    canonicalLanguage: config?.policy?.canonicalLanguage || null,
    languageV1Frozen: config?.policy?.languageV1Frozen === true,
    providerWorkflows: config?.policy?.providerWorkflows || [],
    languageSourcePresent: languageSources.length > 0,
    languageSources,
    languageCompileOk: languageCompile?.ok === true,
    languageCompileProof: languageCompile ? path.join(root, 'packets', 'language-compile.packet.json') : null,
    defaultConfigFile: config?.enabled === true ? DEFAULT_CONFIG_FILE : null,
    adapterReportPresent: Boolean(adapterReport),
    adapterReportSource: adapterReportDirect ? 'adapter-report.json' : statusReport ? 'reports/status-report.json' : recoveryReport ? 'reports/recovery-report.json' : null,
    statusReportPresent: Boolean(statusReport),
    rollbackPlanPresent: fs.existsSync(rollbackPlanPath),
    recoveryReportPresent: Boolean(recoveryReport),
    recoveryPlanPresent: fs.existsSync(recoveryPlanPath),
    verifierEvidenceOk: verifierValidation.ok === true,
    verifierEvidenceErrors: verifierValidation.errors,
    bootOk: readinessChecks[0].ok,
    runOk: readinessChecks[1].ok,
    claimStatus: claim?.claimStatus || null,
    claimBindingOk,
    processCount,
    freshness: {
      boot: artifactFreshness(boot),
      run: artifactFreshness(run),
      verifier: artifactFreshness(verifierEvidence),
      claim: artifactFreshness(claim)
    },
    historicalQualification: adapterReport ? {
      present: true,
      freshness: artifactFreshness(adapterReport),
      currentReadiness: ok
    } : { present: false, freshness: artifactFreshness(null), currentReadiness: ok },
    adapterReport
  };
}

function recoveryCheck(name, ok, details = {}) {
  return { name, ok: ok === true, ...details };
}

function recoveryAction(name, required, command, rationale) {
  return { name, required: Boolean(required), command, rationale };
}

function writeRecoveryPlan({ artifactRoot, report }) {
  const requiredActions = report.actions.filter((action) => action.required);
  const lines = [
    '# AI OS adapter recovery plan',
    '',
    `Generated: ${report.generatedAt}`,
    `Artifact root: \`${artifactRoot}\``,
    `Status: **${report.status}**`,
    '',
    '## Recovery checks',
    '',
    ...report.checks.map((check) => `- ${check.ok ? '[x]' : '[ ]'} ${check.name}`),
    '',
    '## Required actions',
    '',
    ...(requiredActions.length > 0
      ? requiredActions.map((action) => `- **${action.name}** — ${action.rationale}\n  - Command: \`${action.command}\``)
      : ['- None. Current adapter artifacts are recoverable/green for this bounded root.']),
    '',
    '## Boundary',
    '',
    '- Provider read/compute results remain inside the local AIOS artifact root.',
    '- Does not replace OpenClaw/Cortex routing.',
    '- Provider calls perform external network POST writes; returned results remain in local artifacts and remote side effects are not observable here.',
  ];
  const recoveryPlanPath = path.join(artifactRoot, 'reports', 'recovery-plan.md');
  fs.mkdirSync(path.dirname(recoveryPlanPath), { recursive: true });
  fs.writeFileSync(recoveryPlanPath, `${lines.join('\n')}\n`);
  return recoveryPlanPath;
}

function commandRecover(args) {
  const artifactRoot = resolveAiOsArtifactRoot(args.artifactRoot || (args.last ? lastRoot() : null) || defaultAdapterRoot({ mustExist: true }), { mustExist: true });
  const status = compactStatus(artifactRoot);
  const reportsDir = path.join(artifactRoot, 'reports');
  const processIndexPath = path.join(artifactRoot, 'processes', 'process-index.json');
  const jobCandidates = fs.readdirSync(artifactRoot).filter((entry) => entry.endsWith('.job.json')).sort();
  const relRoot = path.relative(WORKSPACE_ROOT, artifactRoot);
  const jobPath = jobCandidates[0] ? path.join(artifactRoot, jobCandidates[0]) : null;
  const relJob = jobPath ? path.relative(WORKSPACE_ROOT, jobPath) : '<job.json>';
  const checks = [
    recoveryCheck('artifact_root_inside_ai_os_workspace', artifactRoot.startsWith(AI_OS_ROOT + path.sep) || artifactRoot === AI_OS_ROOT, { artifactRoot }),
    recoveryCheck('boot_proof_green', status.bootOk, { packet: path.join(artifactRoot, 'packets', 'boot-proof.packet.json') }),
    recoveryCheck('run_proof_green', status.runOk, { packet: path.join(artifactRoot, 'packets', 'run-proof.packet.json') }),
    recoveryCheck('verifier_evidence_green', status.verifierEvidenceOk, { packet: path.join(artifactRoot, 'packets', 'verifier-evidence.packet.json') }),
    recoveryCheck('completion_claim_bound', status.claimStatus === 'allowed' && status.claimBindingOk, { claimStatus: status.claimStatus, claimBindingOk: status.claimBindingOk }),
    recoveryCheck('process_index_present', fs.existsSync(processIndexPath), { processIndexPath, processCount: status.processCount }),
    recoveryCheck('status_or_adapter_report_present_or_generated', true, {
      source: status.adapterReportSource,
      recoveryReportGeneratedByThisCommand: true
    }),
    recoveryCheck('rollback_or_recovery_plan_present_or_generated', true, {
      rollbackPlanPresent: status.rollbackPlanPresent,
      recoveryPlanPresent: status.recoveryPlanPresent,
      recoveryPlanGeneratedByThisCommand: true,
      rollbackPlan: path.join(reportsDir, 'rollback-plan.md'),
      recoveryPlan: path.join(reportsDir, 'recovery-plan.md')
    }),
    recoveryCheck('job_descriptor_present', jobCandidates.length > 0, { jobCandidates }),
    recoveryCheck(
      'canonical_language_compile_present_when_required',
      status.canonicalLanguage ? status.languageSourcePresent && status.languageCompileOk : true,
      {
        canonicalLanguage: status.canonicalLanguage,
        languageSources: status.languageSources,
        languageCompileProof: status.languageCompileProof
      }
    )
  ];
  const statusLabel = checks.every((check) => check.ok) ? 'green' : checks.some((check) => check.ok) ? 'degraded' : 'red';
  const actions = [
    recoveryAction('boot', !status.bootOk, `node scripts/aios-adapter.mjs boot --artifact-root ${relRoot}`, 'Boot proof is missing or not green.'),
    recoveryAction('run', !status.runOk, `node scripts/aios-adapter.mjs run ${relJob} --artifact-root ${relRoot}`, 'Run proof is missing or not green.'),
    recoveryAction('verify', !status.verifierEvidenceOk, `node ai-os/apps/aios-verifier.mjs --job ${relJob} --artifact-root ${relRoot}`, 'Fresh exact job/run/process/tenant/policy-bound verifier-contract replay evidence is missing or invalid.'),
    recoveryAction('claim', status.claimStatus !== 'allowed' || !status.claimBindingOk, `node scripts/aios-adapter.mjs claim ${relJob} --artifact-root ${relRoot}`, 'A current bound completion claim is not allowed yet.'),
    recoveryAction('rollback-plan', false, `node scripts/aios-adapter.mjs recover --artifact-root ${relRoot}`, 'Recovery command writes a local recovery plan for this artifact root.')
  ];
  const report = {
    ok: statusLabel === 'green',
    status: statusLabel,
    generatedAt: new Date().toISOString(),
    adapter: readDefaultConfig()?.enabled === true ? ADAPTER_VERSION : 'openclaw-aios-adapter.v0.2-recovery',
    artifactRoot,
    safetyBoundary: readDefaultConfig()?.enabled === true ? defaultSafetyBoundary({ defaultOn: true }) : defaultSafetyBoundary({ defaultOn: false }),
    statusSummary: status,
    checks,
    actions,
    nextAction: statusLabel === 'green'
      ? 'Adapter artifact root is recoverable; safe to use as bounded dogfood evidence.'
      : 'Run required recovery actions before allowing promotion or completion claims.'
  };
  const recoveryPlanPath = writeRecoveryPlan({ artifactRoot, report });
  report.recoveryPlanPath = recoveryPlanPath;
  const recoveryReportPath = path.join(reportsDir, 'recovery-report.json');
  writeJson(recoveryReportPath, report);
  if (args.remember !== false) rememberRoot(artifactRoot);
  return { ...report, recoveryReportPath };
}

function commandDogfoodSmoke(args) {
  const defaultOn = args.defaultOn === true;
  const artifactRoot = resolveAiOsArtifactRoot(args.artifactRoot || defaultArtifactRoot(args.label || (defaultOn ? 'default-on-adapter' : 'adapter-smoke')));
  const safetyBoundary = defaultSafetyBoundary({ defaultOn });
  fs.mkdirSync(artifactRoot, { recursive: true });
  const sourcePath = path.join(artifactRoot, 'adapter-dogfood.aios');
  fs.copyFileSync(PROVIDER_DOGFOOD_SOURCE, sourcePath);

  const languageCompile = runAios(['compile', sourcePath, '--artifact-root', artifactRoot, '--workspace', 'openclaw']);
  const jobPath = languageCompile?.jobPaths?.[0];
  if (!languageCompile?.ok || !jobPath) throw new Error('AIOS language compile did not emit a runnable job');
  const boot = runAios(['boot', '--artifact-root', artifactRoot]);
  const run = runAios(['run', jobPath, '--artifact-root', artifactRoot]);
  const processId = run?.process?.id;
  if (!processId) throw new Error('AI OS run did not return process.id');
  const statusSyscall = run?.syscallResults?.find((entry) => entry.op === 'kernel.artifact.status');
  const providerSyscalls = (run?.syscallResults ?? []).filter((entry) => ['provider.read', 'provider.compute'].includes(entry.op));
  const ps = runAios(['ps', '--artifact-root', artifactRoot]);
  const logs = runAios(['logs', '--artifact-root', artifactRoot, '--process', processId]);
  const checks = [
    { name: 'canonical_language_compile_green', ok: languageCompile?.ok === true && languageCompile?.status?.state === 'ready', proofPath: languageCompile?.proofPath || null },
    { name: 'compiled_job_emitted', ok: fs.existsSync(jobPath), jobPath },
    { name: 'external_post_transport_reported', ok: languageCompile?.boundary?.externalWrites === true && languageCompile?.boundary?.externalTransportEffect === 'network-post' && languageCompile?.boundary?.resultStorageExternalWrites === false && languageCompile?.boundary?.runtimeReplacement === false },
    { name: 'boot_proof_green', ok: boot?.ok === true, proofPath: boot?.proofPath || null },
    { name: 'run_proof_green', ok: run?.ok === true, proofPath: run?.proofPath || null },
    { name: 'internal_status_syscall_observed', ok: statusSyscall?.ok === true && statusSyscall?.output?.bootOk === true, output: statusSyscall?.output || null },
    { name: 'provider_read_compute_observed', ok: providerSyscalls.length === 2 && providerSyscalls.every((entry) => entry.ok === true), operations: providerSyscalls.map((entry) => entry.op) },
    { name: 'provider_outputs_internal_artifacts', ok: providerSyscalls.every((entry) => entry.output?.outputBoundary === 'internal-artifact-only' && entry.output?.externalWrites === true && entry.output?.externalTransportEffect === 'network-post' && entry.output?.resultStorageExternalWrites === false && fs.existsSync(entry.output?.resultPath || '')), resultPaths: providerSyscalls.map((entry) => entry.output?.resultPath || null) },
    { name: 'process_visible', ok: ps?.ok === true && Number(ps.count || 0) >= 1, count: ps?.count ?? null },
    { name: 'logs_visible', ok: logs?.ok === true && Number(logs.count || 0) >= 1, count: logs?.count ?? null }
  ];
  if (!checks.every((check) => check.ok === true)) {
    throw new Error(`AI OS dogfood checks failed: ${JSON.stringify(checks.filter((check) => !check.ok))}`);
  }
  const verifier = runBoundVerifier({ artifactRoot, jobPath });
  const claim = runAios(['claim', jobPath, '--artifact-root', artifactRoot]);
  const ok = checks.every((check) => check.ok === true) && claim?.claimStatus === 'allowed';
  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    adapter: ADAPTER_VERSION,
    canonicalLanguage: CANONICAL_LANGUAGE_VERSION,
    languageCompileProof: languageCompile?.proofPath || null,
    sourcePath,
    artifactRoot,
    jobPath,
    defaultOn,
    safetyBoundary,
    processId,
    bootProof: boot?.proofPath || null,
    runProof: run?.proofPath || null,
    verifierEvidence: verifier.verifierPath,
    statusSyscall: statusSyscall || null,
    providerSyscalls,
    checks,
    psCount: ps?.count ?? null,
    logCount: logs?.count ?? null,
    claimStatus: claim?.claimStatus || null,
    claimSubject: claim?.subject || null,
    claimPath: claim?.claimPath || null,
    claimApprovalRequirement: claim?.approvalRequirement || null,
    claimNextAction: claim?.nextAction || null,
    nextAction: defaultOn
      ? 'Canonical AIOS provider read/compute is staged for default promotion; explicit operator approval is still required before activation.'
      : 'Use this bounded source-language path for provider workflows while reporting external POST transport separately from internal result storage.'
  };
  writeJson(path.join(artifactRoot, 'adapter-report.json'), report);
  if (args.remember !== false) rememberRoot(artifactRoot);
  return report;
}

function commitDefaultPromotion({ smoke, recovery, approval }) {
  const state = writeDefaultState({ artifactRoot: smoke.artifactRoot, status: 'green', report: { smoke, recovery, approval } });
  rememberRoot(smoke.artifactRoot, { defaultOn: true });
  const config = writeDefaultConfig({ artifactRoot: smoke.artifactRoot, promotionReportPath: recovery.recoveryReportPath, status: 'green' });
  return { config, state };
}

function commandPromoteDefault(args, dependencies = {}) {
  const smokeRunner = dependencies.smokeRunner || commandDogfoodSmoke;
  const recoveryRunner = dependencies.recoveryRunner || commandRecover;
  const approvalValidator = dependencies.approvalValidator || validatePromotionApproval;
  const commitPromotion = dependencies.commitPromotion || commitDefaultPromotion;
  let smoke;
  if (args.resume === true) {
    const artifactRoot = resolveAiOsArtifactRoot(args.artifactRoot, { mustExist: true });
    const status = compactStatus(artifactRoot);
    const claim = readJson(path.join(artifactRoot, 'packets', 'completion-claim.packet.json'), null);
    smoke = {
      ok: status.ok === true && claim?.claimStatus === 'allowed' && status.claimBindingOk === true,
      staged: true,
      artifactRoot,
      claimStatus: claim?.claimStatus || null,
      claimSubject: claim?.subject || null,
      claimPath: path.join(artifactRoot, 'packets', 'completion-claim.packet.json'),
      claimApprovalRequirement: claim?.approvalRequirement || null,
      claimNextAction: claim?.nextAction || null,
      status,
    };
  } else {
    smoke = smokeRunner({ ...args, defaultOn: true, remember: false, label: args.label || 'default-on-integration' });
  }
  if (smoke?.ok !== true) {
    const error = new Error('AI OS default promotion blocked: smoke checks are not green');
    error.details = { smoke };
    throw error;
  }
  const recovery = recoveryRunner({ artifactRoot: smoke.artifactRoot, remember: false });
  if (recovery?.ok !== true || recovery?.status !== 'green') {
    const error = new Error('AI OS default promotion blocked: recovery checks are not green');
    error.details = { smoke, recovery };
    throw error;
  }
  const approval = approvalValidator({ smoke, recovery, args });
  if (approval?.ok !== true) {
    const error = new Error('AI OS default promotion blocked: explicit operator approval is missing or invalid');
    error.details = {
      smoke,
      recovery,
      approval,
      approvalCommand: smoke?.claimNextAction?.command || null,
      resumeCommand: ['node', 'scripts/aios-adapter.mjs', 'promote-default', '--resume', '--artifact-root', smoke.artifactRoot],
    };
    throw error;
  }
  const { config, state } = commitPromotion({ smoke, recovery, approval });
  return {
    ok: true,
    status: 'default_on',
    generatedAt: new Date().toISOString(),
    adapter: ADAPTER_VERSION,
    canonicalLanguage: CANONICAL_LANGUAGE_VERSION,
    artifactRoot: smoke.artifactRoot,
    defaultConfigFile: DEFAULT_CONFIG_FILE,
    defaultStateFile: DEFAULT_STATE_FILE,
    rootPointerFile: ROOT_POINTER_FILE,
    recoveryReportPath: recovery.recoveryReportPath,
    claimStatus: smoke.claimStatus || null,
    verifierEvidenceOk: recovery.statusSummary?.verifierEvidenceOk === true,
    bootOk: recovery.statusSummary?.bootOk === true,
    runOk: recovery.statusSummary?.runOk === true,
    approval,
    defaultConfig: config,
    defaultState: state,
    truthBoundary: config.truthBoundary
  };
}

function compileRuntimeInput(inputPath, artifactRoot, providerPolicyPath = null) {
  if (!inputPath.endsWith('.aios')) return { jobPath: inputPath, languageCompilation: null };
  const providerPolicyArgs = providerPolicyPath ? ['--provider-policy', providerPolicyPath] : [];
  const languageCompilation = runAios(['compile', inputPath, '--artifact-root', artifactRoot, '--workspace', 'openclaw', ...providerPolicyArgs]);
  const jobPath = languageCompilation?.jobPaths?.[0];
  if (!languageCompilation?.ok || !jobPath) throw new Error('AIOS source compilation did not emit a runnable job');
  return { jobPath, languageCompilation };
}

function commandForward(command, args) {
  const artifactMustExist = !['boot', 'compile'].includes(command);
  const artifactRoot = resolveAiOsArtifactRoot(args.artifactRoot || (args.last ? lastRoot() : null) || defaultAdapterRoot({ mustExist: artifactMustExist }), { mustExist: artifactMustExist });
  const inputPath = args._[1] ? resolveWorkspacePath(args._[1], { mustExist: true }) : null;
  const providerPolicyPath = args.providerPolicy ? resolveWorkspacePath(args.providerPolicy, { mustExist: true }) : null;
  const providerPolicyArgs = providerPolicyPath ? ['--provider-policy', providerPolicyPath] : [];
  if (command === 'compile') {
    if (!inputPath || !inputPath.endsWith('.aios')) throw new Error('compile requires <source.aios>');
    return runAios(['compile', inputPath, '--artifact-root', artifactRoot, '--workspace', 'openclaw', ...providerPolicyArgs]);
  }
  if (command === 'boot') return runAios(['boot', '--artifact-root', artifactRoot]);
  if (command === 'run') {
    if (!inputPath) throw new Error('run requires <source.aios|job.json>');
    const { jobPath, languageCompilation } = compileRuntimeInput(inputPath, artifactRoot, providerPolicyPath);
    const output = runAios(['run', jobPath, '--artifact-root', artifactRoot, ...providerPolicyArgs]);
    return languageCompilation ? { ...output, languageCompilation: { proofPath: languageCompilation.proofPath, status: languageCompilation.status, sourcePath: inputPath, jobPath } } : output;
  }
  if (command === 'ps') return runAios(['ps', '--artifact-root', artifactRoot]);
  if (command === 'logs') {
    if (!args.process) throw new Error('logs requires --process <process-id>');
    return runAios(['logs', '--artifact-root', artifactRoot, '--process', args.process]);
  }
  if (command === 'claim') {
    if (!inputPath) throw new Error('claim requires <source.aios|job.json>');
    const { jobPath, languageCompilation } = compileRuntimeInput(inputPath, artifactRoot, providerPolicyPath);
    if (Object.prototype.hasOwnProperty.call(args, 'writeVerifierEvidence')) {
      throw new Error('--write-verifier-evidence was removed: run the bound aios-verifier entry point after the exact job run');
    }
    const output = runAios(['claim', jobPath, '--artifact-root', artifactRoot, ...providerPolicyArgs]);
    return languageCompilation ? { ...output, languageCompilation: { proofPath: languageCompilation.proofPath, status: languageCompilation.status, sourcePath: inputPath, jobPath } } : output;
  }
  throw new Error(`unsupported forward command: ${command}`);
}

function commandProviderWorkflow(args) {
  const workflow = String(args.workflow || '').trim();
  const query = String(args.query || '').trim();
  if (!workflow) throw new Error('provider-workflow requires --workflow <id>');
  if (!query) throw new Error('provider-workflow requires --query <text>');
  const artifactRoot = resolveAiOsArtifactRoot(args.artifactRoot || defaultArtifactRoot(`provider-workflow-${workflow}`));
  const providerPolicy = resolveWorkspacePath(args.providerPolicy || path.join(AI_OS_ROOT, 'kernel', 'policy', 'provider-read-compute.json'), { mustExist: true });
  const command = [
    PROVIDER_WORKFLOW_RUNNER,
    '--workflow', workflow,
    '--query', query,
    '--artifact-root', artifactRoot,
    '--provider-policy', providerPolicy,
    '--ledger', path.join(artifactRoot, 'ledger.jsonl')
  ];
  const result = spawnSync(process.execPath, command, {
    cwd: AI_OS_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      AIOS_OPERATOR: process.env.AIOS_OPERATOR || process.env.USER || 'openclaw',
      AIOS_TENANT_ID: process.env.AIOS_TENANT_ID || 'openclaw-local'
    },
    maxBuffer: 32 * 1024 * 1024
  });
  const parsed = parseJsonOutput(result);
  if (result.status !== 0) {
    const error = new Error(`provider workflow failed: ${workflow}`);
    error.details = { command, actualStatus: result.status, parsed, stdout: result.stdout, stderr: result.stderr };
    throw error;
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  try {
    let output;
    if (command === 'help' || command === '--help' || command === '-h') usage(0);
    else if (command === 'promote-default') output = commandPromoteDefault(args);
    else if (command === 'dogfood-smoke') output = commandDogfoodSmoke(args);
    else if (command === 'provider-workflow') output = commandProviderWorkflow(args);
    else if (command === 'status') {
      output = compactStatus(args.artifactRoot || (args.last ? lastRoot() : null));
      if (output.ok !== true) process.exitCode = 1;
    }
    else if (command === 'recover') output = commandRecover(args);
    else if (['compile', 'boot', 'run', 'ps', 'logs', 'claim'].includes(command)) output = commandForward(command, args);
    else usage(2);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message, details: error.details || null }, null, 2));
    process.exit(1);
  }
}

export { commandForward, commandPromoteDefault, compactStatus, validatePromotionApproval };

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
