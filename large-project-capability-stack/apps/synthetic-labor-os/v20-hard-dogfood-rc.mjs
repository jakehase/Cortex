#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SYNTHETIC_LABOR_OS_REMOTE_SYNC_PATHS,
  compileJobContract,
  createJob,
  createJobIntakeContract,
  createJobTestContract,
  queueJob,
  writeSyntheticLaborOsJob
} from '../../packages/synthetic-labor-os/index.mjs';

export const V20_HARD_DOGFOOD_SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v20.hard_dogfood_summary.v1';
export const V20_DEPENDENCY_SYNC_MANIFEST_SCHEMA = 'claw.synthetic_labor_os.v20.dependency_sync_manifest.v1';
export const V20_RELEASE_CANDIDATE_PACKET_SCHEMA = 'claw.synthetic_labor_os.v20.release_candidate_packet.v1';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = path.resolve(SCRIPT_DIR, '../..');
const WORKSPACE_ROOT = path.resolve(STACK_ROOT, '..');
const DEFAULT_REMOTE_HOST = process.env.SYNTHETIC_LABOR_OS_REMOTE_HOST || 'jake@37.27.129.239';
const DEFAULT_REMOTE_ROOT = process.env.SYNTHETIC_LABOR_OS_REMOTE_ROOT || '/home/jake/clawd-remote';
const TRUTH_BOUNDARY = 'This hard dogfood validates a bounded remote multi-repo execution contract. It is not a merge, publish, deploy, external send, source implementation, real multi-agent coding run, or full product-completeness claim.';

const PUBLIC_CORTEX_SYNC_PATHS = Object.freeze([
  'public/cortex_server/cortex_server/__init__.py',
  'public/cortex_server/cortex_server/modules/__init__.py',
  'public/cortex_server/cortex_server/modules/prior_art_gate.py',
  'public/cortex_server/cortex_server/modules/reasoning_planner.py',
  'public/cortex_server/cortex_server/routers/__init__.py',
  'public/cortex_server/cortex_server/routers/orchestrator.py',
  'public/cortex_server/cortex_server/runtime/__init__.py',
  'public/cortex_server/cortex_server/runtime/agent_work_dsl.py',
  'public/cortex_server/docs/CORTEX_PRIOR_ART_GATE.md',
  'public/cortex_server/scripts/prior_art_gate.py',
  'public/cortex_server/tests/test_prior_art_gate.py'
]);

const MAILCHIMP_SMOKE_SYNC_PATHS = Object.freeze([
  'mailchimp-clone/packages/app/domain-core.mjs',
  'mailchimp-clone/packages/app/domain-leads.mjs',
  'mailchimp-clone/packages/app/routes/platform.mjs',
  'mailchimp-clone/packages/app/storage.mjs',
  'mailchimp-clone/packages/app/view.mjs',
  'mailchimp-clone/tests/platform-spine.test.mjs',
  'mailchimp-clone/tests/phase9-platform-parity.test.mjs',
  'mailchimp-clone/tests/persistence-storage.test.mjs'
]);

const STACK_EXTRA_SYNC_PATHS = Object.freeze([
  'packages/continuous-workload-controller/index.mjs',
  'packages/multi-agent-orchestrator/index.mjs',
  'packages/orchestration-learning-ledger/index.mjs',
  'packages/orchestrator-run-state/index.mjs',
  'packages/agent-work-dsl/index.mjs',
  'packages/claim-integrity/index.mjs',
  'packages/proof-carrying-claim-ledger/index.mjs',
  'packages/system-benchmark/index.mjs',
  'packages/canonical-landing-evidence/index.mjs',
  'packages/task-contract/index.mjs',
  'apps/system-benchmark/build-objective-surface-decomposition.mjs',
  'apps/system-benchmark/check-route-collisions.mjs',
  'apps/system-benchmark/codex-creative-worker.mjs',
  'apps/system-benchmark/compile-agent-work-dsl.mjs',
  'apps/system-benchmark/compile-cortex-agent-work.mjs',
  'apps/system-benchmark/cortex-codex-boundary.mjs',
  'apps/system-benchmark/cortex-ops-health-dashboard.mjs',
  'apps/system-benchmark/create-agent-work-model-product-canary.mjs',
  'apps/system-benchmark/create-agent-work-model-scale-canary.mjs',
  'apps/system-benchmark/evaluate-production-quality-gate.mjs',
  'apps/system-benchmark/game-100-agent-surfaces.mjs',
  'apps/system-benchmark/init-transfer-benchmark.mjs',
  'apps/system-benchmark/live-transfer-verifier.mjs',
  'apps/system-benchmark/live-transfer-worker.mjs',
  'apps/system-benchmark/orchestration-learning-ledger.mjs',
  'apps/system-benchmark/pmhnp-tier2-scenarios.mjs',
  'apps/system-benchmark/run-agent-work-objective-controller.mjs',
  'apps/system-benchmark/run-continuous-real-workload-controller.mjs',
  'apps/system-benchmark/run-mailchimp-autonomous-autopilot.mjs',
  'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs',
  'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs',
  'apps/system-benchmark/run-mailchimp-real-parity-preflight.mjs',
  'apps/system-benchmark/run-semantic-continuous-planner-benchmark.mjs',
  'apps/system-benchmark/run-transfer-benchmark.mjs',
  'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs',
  'apps/system-benchmark/templates/benchmark-run-contract.template.json',
  'apps/system-benchmark/verify-creative-relaunch-readiness.mjs',
  'apps/system-benchmark/verify-game-100agent-readiness.mjs',
  'apps/system-benchmark/verify-godot-game-surface.mjs',
  'apps/system-benchmark/verify-mailchimp-no-generic-shim.mjs',
  'apps/system-benchmark/verify-mailchimp-production-surface.mjs',
  'apps/system-benchmark/verify-semantic-architecture-surface.mjs',
  'apps/system-benchmark/write-agent-work-deployment-manifest.mjs',
  'tests/continuous-workload-controller.test.mjs',
  'tests/multi-agent-orchestrator.test.mjs',
  'tests/orchestrator-run-state.test.mjs',
  'tests/proof-carrying-claim-ledger.test.mjs',
  'tests/claim-integrity.test.mjs',
  'tests/synthetic-labor-os.test.mjs',
  'tests/synthetic-labor-os-remote-smoke.test.mjs',
  'tests/system-benchmark.test.mjs'
]);

function nowIso() {
  return new Date().toISOString();
}

function nowStamp() {
  return nowIso().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function shellQuote(value = '') {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function uniqueStable(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseSha256Output(output = '') {
  const hashes = {};
  for (const line of String(output || '').split('\n')) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
    if (match) hashes[match[2].trim()] = match[1].toLowerCase();
  }
  return hashes;
}

function runLogged(command, args, { cwd = WORKSPACE_ROOT, logPath = null, input = null, maxBuffer = 80 * 1024 * 1024 } = {}) {
  const startedAt = nowIso();
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, input, encoding: 'utf8', maxBuffer });
  const payload = {
    command: [command, ...args],
    cwd,
    exitCode: result.status ?? 1,
    signal: result.signal || null,
    durationMs: Date.now() - started,
    startedAt,
    finishedAt: nowIso(),
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, [
      `$ ${[command, ...args].join(' ')}`,
      `cwd: ${cwd}`,
      `exitCode: ${payload.exitCode}`,
      `signal: ${payload.signal || ''}`,
      `durationMs: ${payload.durationMs}`,
      '',
      '--- stdout ---',
      payload.stdout,
      '--- stderr ---',
      payload.stderr,
      ''
    ].join('\n'));
  }
  return payload;
}

function assertFiles(base, paths) {
  const missing = paths.filter((rel) => !fs.existsSync(path.join(base, rel)) || !fs.statSync(path.join(base, rel)).isFile());
  if (missing.length) throw new Error(`missing required sync files under ${base}: ${missing.join(', ')}`);
}

function parseArgs(argv) {
  const args = {
    artifactBase: 'artifacts/synthetic-labor-os-v20',
    artifactRoot: null,
    remoteHost: DEFAULT_REMOTE_HOST,
    remoteRoot: DEFAULT_REMOTE_ROOT,
    workspaceRoot: WORKSPACE_ROOT,
    stackRoot: STACK_ROOT,
    dryRun: false,
    noLatest: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-base') { args.artifactBase = next; index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--remote-host' || token === '--remote') { args.remoteHost = next; index += 1; continue; }
    if (token === '--remote-root') { args.remoteRoot = next; index += 1; continue; }
    if (token === '--workspace-root') { args.workspaceRoot = next; index += 1; continue; }
    if (token === '--stack-root') { args.stackRoot = next; index += 1; continue; }
    if (token === '--dry-run') { args.dryRun = true; continue; }
    if (token === '--no-latest') { args.noLatest = true; continue; }
    if (token === '--help' || token === '-h') {
      console.log(`usage:
  node apps/synthetic-labor-os/v20-hard-dogfood-rc.mjs [--artifact-base DIR] [--remote-host HOST]

Runs the official Synthetic Labor OS v20/v0.1 RC hard dogfood: writes a dependency sync manifest, pre-syncs bounded Cortex/Mailchimp dependencies to the execution plane, dispatches a remote multi-repo validation through SLOS, verifies returned artifacts, and writes a release-candidate packet. It does not merge, publish, deploy, send externally, or claim full product completeness.`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

export function buildV20HardDogfoodDependencyManifest(input = {}) {
  const workspaceRoot = path.resolve(input.workspaceRoot || WORKSPACE_ROOT);
  const stackRoot = path.resolve(input.stackRoot || STACK_ROOT);
  const remoteRoot = String(input.remoteRoot || DEFAULT_REMOTE_ROOT).replace(/\/+$/, '');
  const remoteStack = input.remoteStack || `${remoteRoot}/large-project-capability-stack`;
  const stackCodeSyncPaths = uniqueStable([
    ...DEFAULT_SYNTHETIC_LABOR_OS_REMOTE_SYNC_PATHS,
    ...STACK_EXTRA_SYNC_PATHS
  ]);
  const groups = [
    {
      id: 'stack_code_sync',
      title: 'SLOS/shared-stack code synced by remote dispatcher',
      transport: 'remote_dispatcher_code_sync',
      localBase: stackRoot,
      remoteBase: remoteStack,
      fileCount: stackCodeSyncPaths.length,
      paths: stackCodeSyncPaths,
      required: true,
      reason: 'Remote dispatcher must run the exact SLOS and shared-stack code/test surfaces used by the v20 dogfood contract.'
    },
    {
      id: 'public_cortex_prior_art',
      title: 'Public Cortex prior-art and Agent Work handoff dependencies',
      transport: 'pre_sync_tar_ssh',
      localBase: workspaceRoot,
      remoteBase: remoteRoot,
      fileCount: PUBLIC_CORTEX_SYNC_PATHS.length,
      paths: [...PUBLIC_CORTEX_SYNC_PATHS],
      required: true,
      reason: 'The hard dogfood validates cross-repo Cortex prior-art/handoff surfaces through the remote execution plane.'
    },
    {
      id: 'mailchimp_product_smoke',
      title: 'Mailchimp product smoke dependencies',
      transport: 'pre_sync_tar_ssh',
      localBase: workspaceRoot,
      remoteBase: remoteRoot,
      fileCount: MAILCHIMP_SMOKE_SYNC_PATHS.length,
      paths: [...MAILCHIMP_SMOKE_SYNC_PATHS],
      required: true,
      reason: 'The hard dogfood includes a bounded non-SLOS product smoke to prevent self-referential green.'
    }
  ];
  return {
    schemaVersion: V20_DEPENDENCY_SYNC_MANIFEST_SCHEMA,
    generatedAt: input.generatedAt || nowIso(),
    manifestId: input.manifestId || `slos-v20-dependency-sync-${nowStamp()}`,
    remoteHost: input.remoteHost || DEFAULT_REMOTE_HOST,
    workspaceRoot,
    stackRoot,
    remoteRoot,
    remoteStack,
    groupCount: groups.length,
    totalFileCount: groups.reduce((sum, group) => sum + group.fileCount, 0),
    groups,
    safety: {
      externalWritesAllowed: false,
      mergePublishDeployAllowed: false,
      remoteExecutionPlaneRequired: true,
      behaviorChanging: true
    },
    truthBoundary: 'Dependency sync manifest makes remote dogfood inputs explicit. It does not prove tests passed, merge, publish, deploy, or send externally.'
  };
}

export function summarizeHardEvidenceLog(text = '') {
  const sections = {};
  let current = 'unknown';
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    const marker = line.match(/^::(.+)$/);
    if (marker) {
      current = marker[1];
      sections[current] ||= {};
      continue;
    }
    const tests = line.match(/^# tests\s+(\d+)/);
    const pass = line.match(/^# pass\s+(\d+)/);
    const fail = line.match(/^# fail\s+(\d+)/);
    if (tests) sections[current] = { ...(sections[current] || {}), tests: Number(tests[1]) };
    if (pass) sections[current] = { ...(sections[current] || {}), pass: Number(pass[1]) };
    if (fail) sections[current] = { ...(sections[current] || {}), fail: Number(fail[1]) };
    const priorArt = line.match(/^prior_art_gate_ok\s+(\S+)\s+(\S+)/);
    if (priorArt) sections.public_cortex_prior_art_gate = { ...(sections.public_cortex_prior_art_gate || {}), decision: priorArt[1], highConfidence: Number(priorArt[2]) || 0, ok: true };
    const cortexHealth = line.match(/^cortex_structural_health_ok\s+(\d+)\s+(\d+)/);
    if (cortexHealth) sections.cortex_structural_memory_mirror = { ...(sections.cortex_structural_memory_mirror || {}), ok: true, nodeCount: Number(cortexHealth[1]), edgeCount: Number(cortexHealth[2]) };
  }
  return {
    schemaVersion: 'claw.synthetic_labor_os.v20.hard_evidence_log_summary.v1',
    sections,
    sharedStack: sections.shared_stack_orchestration_suite || null,
    mailchimpSmoke: sections.mailchimp_product_smoke || null,
    cortexPriorArt: sections.public_cortex_prior_art_gate || null,
    cortexStructuralHealth: sections.cortex_structural_memory_mirror || null
  };
}

export function buildV20ReleaseCandidatePacket(input = {}) {
  const summary = input.summary || {};
  const remoteDispatch = input.remoteDispatch || summary.remoteDispatch || {};
  const artifactIntegrity = input.artifactIntegrity || {};
  const dependencyManifest = input.dependencyManifest || {};
  const logSummary = input.logSummary || null;
  const gates = [
    { id: 'dependency_manifest_present', ok: dependencyManifest.schemaVersion === V20_DEPENDENCY_SYNC_MANIFEST_SCHEMA && dependencyManifest.groupCount >= 3, evidence: input.dependencyManifestPath || null },
    { id: 'pre_sync_green', ok: summary.preSync?.ok === true, evidence: summary.preSync || null },
    { id: 'prior_art_preflight_green', ok: summary.priorArtGate?.ok === true, evidence: summary.priorArtGate || null },
    { id: 'remote_dispatch_green', ok: remoteDispatch.ok === true, evidence: summary.dispatchDir || null },
    { id: 'remote_claim_gate_green', ok: remoteDispatch.completionClaimAllowed === true || remoteDispatch.thresholdPass === true, evidence: input.claimGatePath || null },
    { id: 'returned_artifact_integrity_green', ok: artifactIntegrity.ok === true || summary.artifactIntegrityOk === true, evidence: input.artifactIntegrityPath || null },
    { id: 'hard_multirepo_evidence_green', ok: summary.hardEvidence?.summaryOk === true, evidence: summary.hardEvidence || null }
  ];
  const failures = gates.filter((gate) => gate.ok !== true).map((gate) => `gate_failed:${gate.id}`);
  const ok = failures.length === 0;
  return {
    schemaVersion: V20_RELEASE_CANDIDATE_PACKET_SCHEMA,
    generatedAt: input.generatedAt || nowIso(),
    ok,
    status: ok ? 'green_v0_1_release_candidate_packet' : 'blocked',
    packetId: input.packetId || `slos-v20-v0-1-rc-${nowStamp()}`,
    runId: summary.runId || input.runId || null,
    jobId: summary.jobId || null,
    artifactRoot: summary.artifactRoot || null,
    remoteHost: summary.remoteHost || null,
    gates,
    failures,
    blocker: ok ? null : { blockerKind: 'slos_v20_release_candidate_blocked', blocker: `SLOS v20/v0.1 RC packet blocked: ${failures.join(', ')}` },
    evidence: {
      summaryPath: input.summaryPath || null,
      dependencyManifestPath: input.dependencyManifestPath || null,
      remoteDispatchResultPath: input.remoteDispatchResultPath || null,
      artifactIntegrityPath: input.artifactIntegrityPath || null,
      hardEvidenceLogPath: summary.hardEvidence?.combinedLogPath || null,
      claimGatePath: input.claimGatePath || null,
      releasePacketPath: input.packetPath || null,
      releasePacketMarkdownPath: input.markdownPath || null
    },
    observed: {
      sharedStack: logSummary?.sharedStack || null,
      mailchimpSmoke: logSummary?.mailchimpSmoke || null,
      cortexPriorArt: logSummary?.cortexPriorArt || null,
      cortexStructuralHealth: logSummary?.cortexStructuralHealth || null,
      syncPathCount: summary.syncPathCount || null,
      dependencyGroupCount: dependencyManifest.groupCount || null,
      dependencyTotalFileCount: dependencyManifest.totalFileCount || null
    },
    replayCommands: input.replayCommands || ['npm run ops:synthetic-labor-os:v20-hard-dogfood-rc'],
    truthBoundary: 'SLOS v20/v0.1 RC packet packages one bounded hard dogfood run. It does not merge, publish, deploy, send externally, prove real multi-agent coding, or claim full product completeness.'
  };
}

export function renderV20ReleaseCandidateMarkdown(packet = {}) {
  const lines = [];
  lines.push('# Synthetic Labor OS v20 / v0.1 Release Candidate Packet');
  lines.push('');
  lines.push(`Status: ${packet.status || 'unknown'}`);
  lines.push(`OK: ${packet.ok === true ? 'true' : 'false'}`);
  lines.push(`Run: ${packet.runId || ''}`);
  lines.push(`Job: ${packet.jobId || ''}`);
  lines.push(`Remote host: ${packet.remoteHost || ''}`);
  lines.push('');
  lines.push('## Gates');
  for (const gate of packet.gates || []) lines.push(`- ${gate.ok === true ? '✅' : '❌'} ${gate.id}`);
  lines.push('');
  lines.push('## Observed evidence');
  lines.push(`- Shared stack: ${packet.observed?.sharedStack ? `${packet.observed.sharedStack.pass}/${packet.observed.sharedStack.tests} pass, fail ${packet.observed.sharedStack.fail}` : 'unknown'}`);
  lines.push(`- Mailchimp smoke: ${packet.observed?.mailchimpSmoke ? `${packet.observed.mailchimpSmoke.pass}/${packet.observed.mailchimpSmoke.tests} pass, fail ${packet.observed.mailchimpSmoke.fail}` : 'unknown'}`);
  lines.push(`- Cortex prior-art: ${packet.observed?.cortexPriorArt ? `${packet.observed.cortexPriorArt.decision}, high-confidence ${packet.observed.cortexPriorArt.highConfidence}` : 'unknown'}`);
  lines.push(`- Cortex structural mirror: ${packet.observed?.cortexStructuralHealth ? `${packet.observed.cortexStructuralHealth.nodeCount} nodes / ${packet.observed.cortexStructuralHealth.edgeCount} edges` : 'unknown'}`);
  lines.push(`- Synced stack paths: ${packet.observed?.syncPathCount ?? 'unknown'}`);
  lines.push('');
  lines.push('## Replay commands');
  for (const command of packet.replayCommands || []) lines.push(`- \`${command}\``);
  lines.push('');
  lines.push(`Truth boundary: ${packet.truthBoundary || ''}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function preSyncGroup({ group, remoteHost, artifactRoot }) {
  assertFiles(group.localBase, group.paths);
  const dir = path.join(artifactRoot, 'pre_sync');
  const mkdir = runLogged('ssh', [remoteHost, `mkdir -p ${shellQuote(group.remoteBase)}`], { logPath: path.join(dir, `${group.id}_mkdir.log`) });
  if (mkdir.exitCode !== 0) throw new Error(`${group.id} remote mkdir failed`);
  const tarCommand = [
    `tar -czf - ${group.paths.map(shellQuote).join(' ')}`,
    `ssh ${shellQuote(remoteHost)} "cd ${shellQuote(group.remoteBase)} && tar -xzf -"`
  ].join(' | ');
  const sync = runLogged('bash', ['-lc', tarCommand], { cwd: group.localBase, logPath: path.join(dir, `${group.id}_sync.log`) });
  const localHashes = Object.fromEntries(group.paths.map((rel) => [rel, sha256File(path.join(group.localBase, rel))]));
  const remoteHashCommand = `cd ${shellQuote(group.remoteBase)} && sha256sum ${group.paths.map(shellQuote).join(' ')}`;
  const remote = runLogged('ssh', [remoteHost, remoteHashCommand], { logPath: path.join(dir, `${group.id}_remote_hash.log`) });
  const remoteHashes = remote.exitCode === 0 ? parseSha256Output(remote.stdout) : {};
  const mismatches = group.paths.filter((rel) => localHashes[rel] !== remoteHashes[rel]).map((rel) => ({ path: rel, local: localHashes[rel], remote: remoteHashes[rel] || null }));
  const summary = {
    schemaVersion: 'claw.synthetic_labor_os.v20.pre_sync_group.v1',
    generatedAt: nowIso(),
    groupId: group.id,
    title: group.title,
    localBase: group.localBase,
    remoteHost,
    remoteBase: group.remoteBase,
    fileCount: group.paths.length,
    syncExitCode: sync.exitCode,
    remoteHashExitCode: remote.exitCode,
    ok: sync.exitCode === 0 && remote.exitCode === 0 && mismatches.length === 0,
    mismatches,
    localHashes,
    remoteHashes,
    truthBoundary: 'Pre-sync copies bounded dependency files to the execution plane for this dogfood only; it does not merge, publish, deploy, or make external user-visible changes.'
  };
  writeJson(path.join(dir, `${group.id}_summary.json`), summary);
  if (!summary.ok) throw new Error(`${group.id} pre-sync failed`);
  return summary;
}

function runPriorArtGate({ artifactRoot, workspaceRoot, generatedAt }) {
  const outputPath = path.join(artifactRoot, 'prior_art_gate_preflight.json');
  const script = path.join(workspaceRoot, 'public/cortex_server/scripts/prior_art_gate.py');
  const args = [
    script,
    '--objective', 'Run Synthetic Labor OS v20/v0.1 RC hard dogfood as a remote multi-repo validation adapter over existing SLOS, Cortex prior-art, artifact-bundle, and claim-gate primitives.',
    '--capability', 'Synthetic Labor OS remote dispatch',
    '--capability', 'Cortex prior-art gate',
    '--capability', 'artifact bundle manifest',
    '--capability', 'claim gate',
    '--capability', 'multi-repo validation',
    '--path', 'large-project-capability-stack/apps/synthetic-labor-os/v20-hard-dogfood-rc.mjs',
    '--path', 'large-project-capability-stack/apps/synthetic-labor-os/remote-dispatcher.mjs',
    '--path', 'large-project-capability-stack/apps/synthetic-labor-os/local-runner.mjs',
    '--path', 'public/cortex_server/scripts/prior_art_gate.py',
    '--proposed-action', 'reuse_existing',
    '--scan-root', path.join(workspaceRoot, 'large-project-capability-stack/apps/synthetic-labor-os'),
    '--scan-root', path.join(workspaceRoot, 'large-project-capability-stack/packages/synthetic-labor-os'),
    '--scan-root', path.join(workspaceRoot, 'public/cortex_server')
  ];
  const run = runLogged('python3', args, { cwd: path.join(workspaceRoot, 'public/cortex_server'), logPath: path.join(artifactRoot, 'prior_art_gate_preflight.log') });
  let gate = null;
  try { gate = JSON.parse(run.stdout || '{}'); } catch { gate = null; }
  if (!gate || typeof gate !== 'object' || !gate.schemaVersion) {
    gate = {
      schemaVersion: 'cortex.memory.prior_art_gate.v1',
      generatedAt,
      ok: false,
      status: 'error',
      decision: 'prior_art_gate_parse_failed',
      failures: ['prior_art_gate_output_parse_failed'],
      exitCode: run.exitCode,
      stderrTail: String(run.stderr || '').slice(-2000)
    };
  }
  gate.generatedAt ||= generatedAt;
  gate.exitCode = run.exitCode;
  writeJson(outputPath, gate);
  return { path: outputPath, gate };
}

function buildHardCommand({ runId, remoteRoot, remoteStack, remoteEvidenceDir }) {
  const remotePublicCortex = `${remoteRoot}/public/cortex_server`;
  const remoteMailchimp = `${remoteRoot}/mailchimp-clone`;
  const script = `set -euo pipefail
mkdir -p "$REMOTE_HARD_EVIDENCE_DIR"
{
  echo "::remote_identity"
  hostname
  uname -a
  node --version
  python3 --version
  df -h .

  echo "::public_cortex_prior_art_gate"
  cd ${remotePublicCortex}
  python3 scripts/prior_art_gate.py \
    --objective "Remote SLOS v20 hard dogfood should reuse existing SLOS remote dispatch, artifact bundle, Cortex prior-art, and claim-gate primitives" \
    --capability "remote dispatch" \
    --capability "artifact bundle manifest" \
    --capability "prior art gate" \
    --capability "claim gate" \
    --path "scripts/prior_art_gate.py" \
    --path "cortex_server/modules/prior_art_gate.py" \
    --path "${remoteStack}/apps/synthetic-labor-os/remote-dispatcher.mjs" \
    --proposed-action reuse_existing \
    --scan-root "${remotePublicCortex}" \
    --scan-root "${remoteStack}/apps/synthetic-labor-os" \
    --scan-root "${remoteStack}/packages/synthetic-labor-os" \
    > "$REMOTE_HARD_EVIDENCE_DIR/cortex_prior_art_gate.json"
  python3 -c 'import json,os; p=os.environ["REMOTE_HARD_EVIDENCE_DIR"]+"/cortex_prior_art_gate.json"; d=json.load(open(p)); assert d.get("ok") is True and d.get("decision") in {"reuse_existing","extend_existing","adapter_wrapper_only"}, d; print("prior_art_gate_ok", d.get("decision"), d.get("sourceCoverage",{}).get("highConfidenceMatchCount"))'

  echo "::shared_stack_orchestration_suite"
  cd ${remoteStack}
  node --test tests/continuous-workload-controller.test.mjs tests/multi-agent-orchestrator.test.mjs tests/orchestrator-run-state.test.mjs tests/proof-carrying-claim-ledger.test.mjs tests/claim-integrity.test.mjs tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs tests/system-benchmark.test.mjs

  echo "::cortex_structural_memory_mirror"
  cd ${remoteRoot}/cortex-structural-memory
  python3 public/cortex_server/scripts/query_codebase_memory.py --health > "$REMOTE_HARD_EVIDENCE_DIR/cortex_structural_health.json"
  python3 -c 'import json,os; p=os.environ["REMOTE_HARD_EVIDENCE_DIR"]+"/cortex_structural_health.json"; d=json.load(open(p)); assert d.get("ok") is True and d.get("nodeCount",0) > 1000 and d.get("edgeCount",0) > 1000, d; print("cortex_structural_health_ok", d.get("nodeCount"), d.get("edgeCount"))'
  python3 public/cortex_server/scripts/query_codebase_memory.py --query prior_art_gate --limit 5 > "$REMOTE_HARD_EVIDENCE_DIR/cortex_prior_art_query.json"
  python3 public/cortex_server/scripts/query_codebase_memory.py --query buildRunLedger --impact --limit 3 > "$REMOTE_HARD_EVIDENCE_DIR/cortex_ledger_impact.json"

  echo "::mailchimp_product_smoke"
  cd ${remoteMailchimp}
  node --test tests/platform-spine.test.mjs tests/phase9-platform-parity.test.mjs tests/persistence-storage.test.mjs

  printf '{"ok":true,"remoteHost":"%s","runId":"%s","truthBoundary":"remote multi-repo dogfood validation only; no merge, deploy, publish, external send, source implementation, or full product completeness claim"}\n' "$(hostname)" "${runId}" > "$REMOTE_HARD_EVIDENCE_DIR/hard_multirepo_summary.json"
} 2>&1 | tee "$REMOTE_HARD_EVIDENCE_DIR/hard_multirepo_combined.log"`;
  return `REMOTE_HARD_EVIDENCE_DIR=${shellQuote(remoteEvidenceDir)} bash -lc ${shellQuote(script)}`;
}

function buildJobForRun({ generatedAt, runId, jobId, artifactRoot, remoteHost, remoteStack, remoteArtifactRoot, command }) {
  let job = createJob({
    id: jobId,
    createdAt: generatedAt,
    createdBy: 'cortex',
    objective: {
      id: jobId,
      title: 'Synthetic Labor OS v20/v0.1 RC hard remote multi-repo dogfood',
      outcome: 'Use the official SLOS v20 hard dogfood command to run a remote execution-plane validation spanning shared orchestration stack tests, Cortex prior-art and structural memory checks, and Mailchimp product smoke tests.',
      requestedFidelity: 'production_slice',
      stopCondition: 'v20_release_candidate_packet_green_or_blocker_artifact'
    },
    repoPath: STACK_ROOT,
    artifactRoot,
    fidelity: 'production_slice',
    requestedAgentCount: 5,
    permissions: { forbid: ['external_send', 'touch_prod_without_approval'] },
    executionPlane: { requiredHostRole: 'execution_plane', remoteHost }
  });
  const intakeContract = createJobIntakeContract({
    job,
    why: 'Jake authorized productizing the hard SLOS dogfood as a repeatable v20/v0.1 RC command rather than a one-off scratch run.',
    direction: 'Use the Hetzner execution plane, make dependency sync explicit, return artifacts, and let the claim gate go red if any cross-repo validation fails.'
  });
  const testContract = createJobTestContract({
    id: `test-contract-${runId}`,
    job,
    why: 'The v20 hard dogfood succeeds only if the official command can remote-dispatch, sync code, execute a multi-repo validation command, return artifacts, pass the SLOS claim gate, and package an RC packet.',
    invariants: [
      'Remote dispatch must run on Hetzner, not the control-plane host.',
      'SLOS and selected shared-stack code paths must hash-match remotely before accepting the run.',
      'Dependency sync inputs must be listed in a manifest before launch.',
      'Shared orchestration stack tests must pass remotely.',
      'Cortex prior-art gate and structural memory mirror must be readable and meaningful.',
      'Mailchimp product smoke tests must pass remotely.',
      'Returned artifact bundle integrity must verify.',
      'Release-candidate packet must stay scoped to the bounded dogfood claim.'
    ],
    commands: [command],
    docsRefs: ['docs/SYNTHETIC_LABOR_OS_V0.md', '/root/clawd/public/cortex_server/docs/CORTEX_PRIOR_ART_GATE.md'],
    expectedEvidence: ['dependency_sync_manifest', 'sync_proof', 'remote_runner_log', 'returned_artifacts', 'hard_multirepo_evidence', 'remote_dispatch_result', 'release_candidate_packet']
  });
  job = { ...job, artifacts: { ...(job.artifacts || {}), intakeContract, testContract } };
  job = compileJobContract(job, {
    actor: 'cortex',
    artifactRoot,
    runContract: {
      schemaVersion: 'claw.synthetic_labor_os.v20.run_contract.v1',
      generatedAt,
      jobId,
      objective: job.objective,
      repoPath: STACK_ROOT,
      remoteHost,
      remoteRepoPath: remoteStack,
      remoteArtifactRoot,
      requestedAgentCount: 5,
      fidelity: 'production_slice',
      stopCondition: 'v20_release_candidate_packet_green_or_blocker_artifact',
      truthBoundary: TRUTH_BOUNDARY
    },
    surfaceMatrix: {
      schemaVersion: 'claw.synthetic_labor_os.v20.surface_matrix.v1',
      generatedAt,
      jobId,
      rows: [
        { surfaceId: 'dependency_sync_manifest', status: 'pending', requiredEvidence: ['dependency_sync_manifest', 'pre_sync_hash_proofs'] },
        { surfaceId: 'remote_execution_boundary_and_sync', status: 'pending', requiredEvidence: ['remote_dispatch_manifest', 'sync_proof'] },
        { surfaceId: 'shared_orchestration_stack_suite', status: 'pending', requiredEvidence: ['remote_command_log', 'node_test_tap'] },
        { surfaceId: 'cortex_prior_art_and_structural_memory', status: 'pending', requiredEvidence: ['prior_art_gate', 'cortex_structural_health', 'query_results'] },
        { surfaceId: 'mailchimp_product_smoke', status: 'pending', requiredEvidence: ['mailchimp_node_tests'] },
        { surfaceId: 'returned_artifact_integrity', status: 'pending', requiredEvidence: ['artifact_bundle_manifest', 'artifact_integrity'] },
        { surfaceId: 'release_candidate_packet', status: 'pending', requiredEvidence: ['rc_packet_json', 'rc_packet_markdown'] }
      ]
    },
    workGraph: {
      schemaVersion: 'claw.synthetic_labor_os.v20.work_graph.v1',
      generatedAt,
      jobId,
      nodes: ['dependency_sync_manifest', 'remote_execution_boundary_and_sync', 'shared_orchestration_stack_suite', 'cortex_prior_art_and_structural_memory', 'mailchimp_product_smoke', 'returned_artifact_integrity', 'release_candidate_packet'].map((id, index) => ({ id, order: index + 1, state: 'ready' })),
      edges: []
    }
  });
  job = queueJob(job, {
    actor: 'cortex',
    queue: {
      schemaVersion: 'claw.synthetic_labor_os.v0.work_queue',
      generatedAt,
      jobId,
      queueId: `queue-${runId}`,
      expansionPolicy: 'stop_on_v20_release_candidate_packet_green_or_blocker',
      operatorControls: ['pause_job', 'request_review', 'reject_or_requeue_item'],
      workItems: [
        { id: 'v20-hard-remote-multirepo-validation', title: 'Run official v20 hard remote multi-repo validation', surfaceId: 'remote_execution_boundary_and_sync', state: 'ready', requiredEvidence: ['dependency_sync_manifest', 'sync_proof', 'hard_multirepo_evidence', 'remote_dispatch_result', 'release_candidate_packet'] }
      ],
      readyCount: 1,
      blockedCount: 0,
      truthBoundary: 'Queue state is scheduling intent; completion still requires artifacts and truth gates.'
    }
  });
  return job;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = nowIso();
  const workspaceRoot = path.resolve(args.workspaceRoot);
  const stackRoot = path.resolve(args.stackRoot);
  const remoteRoot = String(args.remoteRoot).replace(/\/+$/, '');
  const remoteStack = `${remoteRoot}/large-project-capability-stack`;
  const runId = `v20-hard-multirepo-remote-${nowStamp()}`;
  const jobId = `slos-v20-hard-dogfood-${runId}`;
  const artifactBase = path.resolve(stackRoot, args.artifactBase);
  const artifactRoot = path.resolve(stackRoot, args.artifactRoot || path.join(args.artifactBase, runId));
  const remoteArtifactRoot = `${remoteStack}/artifacts/synthetic-labor-os-v20/${runId}`;
  const remoteEvidenceDir = `${remoteArtifactRoot}/hard_multirepo_evidence`;
  fs.mkdirSync(artifactRoot, { recursive: true });

  const dependencyManifest = buildV20HardDogfoodDependencyManifest({ generatedAt, workspaceRoot, stackRoot, remoteRoot, remoteStack, remoteHost: args.remoteHost });
  const dependencyManifestPath = writeJson(path.join(artifactRoot, 'dependency_sync_manifest.json'), dependencyManifest);
  const stackCodeSyncGroup = dependencyManifest.groups.find((group) => group.id === 'stack_code_sync');
  assertFiles(stackCodeSyncGroup.localBase, stackCodeSyncGroup.paths);

  const preSyncSummaries = [];
  if (!args.dryRun) {
    for (const group of dependencyManifest.groups.filter((entry) => entry.transport === 'pre_sync_tar_ssh')) {
      preSyncSummaries.push(preSyncGroup({ group, remoteHost: args.remoteHost, artifactRoot }));
    }
  }
  const preSyncSummary = {
    schemaVersion: 'claw.synthetic_labor_os.v20.pre_sync_summary.v1',
    generatedAt: nowIso(),
    ok: !args.dryRun && preSyncSummaries.every((entry) => entry.ok),
    dryRun: args.dryRun,
    groups: preSyncSummaries,
    manifestPath: dependencyManifestPath,
    truthBoundary: 'Pre-sync evidence is a bounded execution-plane dependency sync for this dogfood only.'
  };
  const preSyncSummaryPath = writeJson(path.join(artifactRoot, 'pre_sync', 'pre_sync_summary.json'), preSyncSummary);

  const priorArt = args.dryRun ? { path: null, gate: { ok: false, decision: 'dry_run_not_executed' } } : runPriorArtGate({ artifactRoot, workspaceRoot, generatedAt });
  const command = buildHardCommand({ runId, remoteRoot, remoteStack, remoteEvidenceDir });
  let job = buildJobForRun({ generatedAt, runId, jobId, artifactRoot, remoteHost: args.remoteHost, remoteStack, remoteArtifactRoot, command });
  job = {
    ...job,
    artifacts: {
      ...(job.artifacts || {}),
      dependencySyncManifestPath: dependencyManifestPath,
      preSyncSummaryPath,
      priorArtGatePreflightPath: priorArt.path
    }
  };
  const jobPath = writeSyntheticLaborOsJob({ job, jobsDir: path.join(artifactRoot, 'jobs'), fileName: `${jobId}.json` }).jobPath;
  const inputPath = writeJson(path.join(artifactRoot, 'v20_hard_dogfood_input.json'), {
    schemaVersion: 'claw.synthetic_labor_os.v20.input.v1',
    generatedAt,
    runId,
    artifactRoot,
    jobId,
    jobPath,
    remoteHost: args.remoteHost,
    remoteRoot,
    remoteRepoPath: remoteStack,
    remoteArtifactRoot,
    remoteEvidenceDir,
    command,
    dependencyManifestPath,
    stackSyncPathCount: stackCodeSyncGroup.paths.length,
    truthBoundary: TRUTH_BOUNDARY
  });

  if (args.dryRun) {
    const drySummary = {
      schemaVersion: V20_HARD_DOGFOOD_SUMMARY_SCHEMA,
      generatedAt: nowIso(),
      ok: false,
      status: 'dry_run_planned_not_executed',
      runId,
      jobId,
      artifactRoot,
      jobPath,
      inputPath,
      dependencyManifestPath,
      blocker: { blockerKind: 'dry_run', blocker: 'Dry run wrote manifests only; remote execution was not launched.' },
      truthBoundary: TRUTH_BOUNDARY
    };
    writeJson(path.join(artifactRoot, 'v20_hard_dogfood_summary.json'), drySummary);
    console.log(JSON.stringify(drySummary, null, 2));
    return;
  }

  const dispatcherArgs = [
    'apps/synthetic-labor-os/remote-dispatcher.mjs',
    '--job', jobPath,
    '--artifact-root', artifactRoot,
    '--local-repo', stackRoot,
    '--remote-host', args.remoteHost,
    '--remote-repo', remoteStack,
    '--remote-artifact-root', remoteArtifactRoot,
    '--command', command,
    ...stackCodeSyncGroup.paths.flatMap((entry) => ['--sync-path', entry])
  ];
  const dispatch = runLogged('node', dispatcherArgs, {
    cwd: stackRoot,
    logPath: path.join(artifactRoot, 'remote_dispatcher.log'),
    maxBuffer: 140 * 1024 * 1024
  });
  fs.writeFileSync(path.join(artifactRoot, 'remote_dispatcher.stdout.json'), dispatch.stdout || '');
  fs.writeFileSync(path.join(artifactRoot, 'remote_dispatcher.stderr.log'), dispatch.stderr || '');
  const dispatcherPayload = readJson(path.join(artifactRoot, 'remote_dispatcher.stdout.json'), null);
  const dispatchDir = dispatcherPayload?.dispatchDir || null;
  const returnedEvidenceDir = dispatchDir ? path.join(dispatchDir, 'returned_artifacts', 'hard_multirepo_evidence') : null;
  const hardSummaryPath = returnedEvidenceDir ? path.join(returnedEvidenceDir, 'hard_multirepo_summary.json') : null;
  const hardSummary = hardSummaryPath ? readJson(hardSummaryPath, null) : null;
  const hardLogPath = returnedEvidenceDir ? path.join(returnedEvidenceDir, 'hard_multirepo_combined.log') : null;
  const hardLogText = hardLogPath && fs.existsSync(hardLogPath) ? fs.readFileSync(hardLogPath, 'utf8') : '';
  const logSummary = summarizeHardEvidenceLog(hardLogText);
  const artifactIntegrityPath = dispatchDir ? path.join(dispatchDir, 'artifact_integrity.json') : null;
  const artifactIntegrity = artifactIntegrityPath ? readJson(artifactIntegrityPath, null) : null;
  const remoteDispatchResultPath = dispatchDir ? path.join(dispatchDir, 'remote_dispatch_result.json') : null;
  const remoteDispatchFull = remoteDispatchResultPath ? readJson(remoteDispatchResultPath, null) : null;
  const returnedRunnerDir = dispatchDir ? path.join(dispatchDir, 'returned_artifacts', 'local_runner', jobId) : null;
  const claimGatePath = returnedRunnerDir && fs.existsSync(returnedRunnerDir)
    ? fs.readdirSync(returnedRunnerDir).map((entry) => path.join(returnedRunnerDir, entry, 'claim_gate.json')).find((candidate) => fs.existsSync(candidate)) || null
    : null;
  const returnedJob = readJson(path.join(artifactRoot, 'jobs', `${jobId}.json`), null);
  const remoteDispatch = dispatcherPayload?.result || remoteDispatchFull || null;

  const coreOk = dispatch.exitCode === 0
    && dispatcherPayload?.ok === true
    && remoteDispatch?.ok === true
    && hardSummary?.ok === true
    && priorArt.gate?.ok === true
    && preSyncSummary.ok === true
    && artifactIntegrity?.ok === true;

  const summaryPath = path.join(artifactRoot, 'v20_hard_dogfood_summary.json');
  let summary = {
    schemaVersion: V20_HARD_DOGFOOD_SUMMARY_SCHEMA,
    generatedAt: nowIso(),
    ok: coreOk,
    status: coreOk ? 'green_v20_hard_remote_multirepo_dogfood' : 'blocked',
    runId,
    jobId,
    dispatcherExitCode: dispatch.exitCode,
    durationMs: dispatch.durationMs,
    artifactRoot,
    jobPath,
    inputPath,
    dependencyManifestPath,
    preSyncSummaryPath,
    remoteHost: args.remoteHost,
    remoteArtifactRoot,
    dispatchDir,
    preSync: { ok: preSyncSummary.ok, groups: preSyncSummary.groups.map((entry) => ({ id: entry.groupId, fileCount: entry.fileCount, ok: entry.ok })) },
    priorArtGate: { ok: priorArt.gate?.ok === true, decision: priorArt.gate?.decision || null, highConfidence: priorArt.gate?.sourceCoverage?.highConfidenceMatchCount ?? null },
    remoteDispatch: remoteDispatch ? { ok: remoteDispatch.ok === true, failures: remoteDispatch.failures || [], thresholdPass: remoteDispatch.thresholdPass === true, completionClaimAllowed: remoteDispatch.completionSummary?.completionClaimAllowed ?? remoteDispatch.thresholdPass ?? null } : null,
    returnedJob: returnedJob ? { state: returnedJob.state || null, truthThresholdPass: returnedJob.truth?.thresholdPass ?? null, truthCompletionClaimAllowed: returnedJob.truth?.completionClaimAllowed ?? null } : null,
    artifactIntegrityOk: artifactIntegrity?.ok === true,
    hardEvidence: { returnedEvidenceDir, summaryPath: hardSummaryPath, summaryOk: hardSummary?.ok === true, cortexHealthPath: returnedEvidenceDir ? path.join(returnedEvidenceDir, 'cortex_structural_health.json') : null, combinedLogPath: hardLogPath, logSummary },
    syncPathCount: stackCodeSyncGroup.paths.length,
    blocker: coreOk ? null : { blockerKind: 'v20_hard_remote_multirepo_dogfood_failed', blocker: `SLOS v20 hard dogfood failed: dispatcherExit=${dispatch.exitCode}, remoteFailures=${(remoteDispatch?.failures || []).join(',') || 'unknown'}` },
    truthBoundary: TRUTH_BOUNDARY
  };

  const packetPath = path.join(artifactRoot, 'v20_release_candidate_packet.json');
  const markdownPath = path.join(artifactRoot, 'v20_release_candidate_packet.md');
  const packet = buildV20ReleaseCandidatePacket({
    generatedAt: nowIso(),
    summary,
    remoteDispatch: summary.remoteDispatch,
    artifactIntegrity,
    dependencyManifest,
    dependencyManifestPath,
    summaryPath,
    remoteDispatchResultPath,
    artifactIntegrityPath,
    claimGatePath,
    packetPath,
    markdownPath,
    logSummary,
    replayCommands: ['npm run ops:synthetic-labor-os:v20-hard-dogfood-rc']
  });
  writeJson(packetPath, packet);
  fs.writeFileSync(markdownPath, renderV20ReleaseCandidateMarkdown(packet));
  summary = {
    ...summary,
    ok: coreOk && packet.ok === true,
    status: coreOk && packet.ok === true ? 'green_v20_hard_remote_multirepo_dogfood' : 'blocked',
    releaseCandidatePacket: { ok: packet.ok === true, packetPath, markdownPath, status: packet.status },
    blocker: coreOk && packet.ok === true ? null : (summary.blocker || packet.blocker)
  };
  writeJson(summaryPath, summary);

  if (!args.noLatest) {
    const latest = path.join(artifactBase, 'latest');
    try { fs.rmSync(latest, { force: true, recursive: true }); } catch {}
    fs.symlinkSync(artifactRoot, latest, 'dir');
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
