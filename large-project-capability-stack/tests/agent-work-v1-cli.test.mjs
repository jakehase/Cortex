import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  AGENT_WORK_COMMANDS,
  AGENT_WORK_EXIT_CODES,
  buildCompletionPacket,
  cancelRun,
  compileObjective,
  doctor,
  getRunStatus,
  resolveAgentWorkConfig,
  startRun,
  verifyRun
} from '../packages/canonical-agent-work/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const cli = path.join(root, 'apps/agent-work/cli.mjs');
const compatibilityCli = path.join(root, 'apps/system-benchmark/canonical-agent-work.mjs');
const fixture = path.join(root, 'fixtures/agent-work-v1/v0-cortex-handoff.json');

function runCli(args, options = {}) {
  const run = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BENCHMARK_HOST_ROLE: 'control_plane', ...(options.env || {}) }
  });
  let json = null;
  try { json = JSON.parse(run.stdout); } catch {}
  return { ...run, json };
}

function tmpRunRoot(label = 'agent-work-v1-cli-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

test('Phase 2 facade exposes the required v1 library operations and command family', () => {
  assert.deepEqual(AGENT_WORK_COMMANDS, ['plan', 'run', 'status', 'resume', 'cancel', 'verify', 'report', 'doctor', 'replay']);
  for (const fn of [compileObjective, startRun, getRunStatus, cancelRun, verifyRun, buildCompletionPacket, doctor, resolveAgentWorkConfig]) {
    assert.equal(typeof fn, 'function');
  }
  assert.deepEqual(AGENT_WORK_EXIT_CODES, { success: 0, blocked: 1, invalidOrDenied: 2, infrastructure: 3, cancelled: 4 });
});

test('Phase 2 config resolution uses CLI over run config over workspace default and keeps env to host facts', () => {
  const out = tmpRunRoot();
  fs.writeFileSync(path.join(out, 'agent_work_config.json'), JSON.stringify({ fidelity: 'parity_for_scope', executionBoundary: 'control_plane_allowed' }, null, 2));
  const config = resolveAgentWorkConfig({
    workspaceRoot: root,
    runRoot: out,
    cliConfig: { fidelity: 'full_clone' },
    env: { BENCHMARK_HOST_ROLE: 'execution_plane', SHOULD_NOT_BECOME_CONFIG: 'yes' }
  });
  assert.equal(config.resolved.fidelity, 'full_clone');
  assert.equal(config.resolved.executionBoundary, 'control_plane_allowed');
  assert.equal(config.hostFacts.hostRole, 'execution_plane');
  assert.equal(config.resolved.SHOULD_NOT_BECOME_CONFIG, undefined);
  assert.deepEqual(config.precedence, ['cli', 'run_config', 'workspace_default']);
});

test('agent-work plan/status/report/doctor work locally with stable JSON output and no model calls', () => {
  const out = tmpRunRoot();
  const plan = runCli(['plan', fixture, '--out', out]);
  assert.equal(plan.status, 0, plan.stderr || plan.stdout);
  assert.equal(plan.json.operation, 'plan');
  assert.equal(plan.json.ok, true);
  assert.equal(plan.json.state, 'compiled');
  assert.equal(fs.existsSync(path.join(out, 'cli_contract_packet.json')), true);

  const status = runCli(['status', out, '--json']);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.equal(status.json.operation, 'status');
  assert.equal(status.json.state, 'compiled');
  assert.equal(status.json.data.runManifest.executionBoundary, 'remote_execution_required');

  const verify = runCli(['verify', out]);
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  assert.equal(verify.json.operation, 'verify');
  assert.equal(verify.json.data.verification.contractVerificationGreen, true);
  assert.equal(verify.json.data.verification.completionClaimAllowed, false);

  const report = runCli(['report', out, '--format', 'json']);
  assert.equal(report.status, 0, report.stderr || report.stdout);
  assert.equal(report.json.operation, 'report');
  assert.equal(report.json.data.report.completionClaimAllowed, false);
  assert.match(report.json.truthBoundary, /Phase 8 reports facade/);
  assert.equal(report.json.data.report.phase5WorkerExecutionGreen, false);
  assert.equal(report.json.data.report.phase6TruthGreen, false);
  assert.equal(report.json.data.report.phase7OpsGreen, false);
  assert.equal(report.json.data.report.phase8ReleaseCandidateGreen, false);

  const doctorRun = runCli(['doctor']);
  assert.equal(doctorRun.status, 0, doctorRun.stderr || doctorRun.stdout);
  assert.equal(doctorRun.json.operation, 'doctor');
  assert.equal(doctorRun.json.ok, true);
  assert.equal(doctorRun.json.data.checks.every((check) => typeof check.ok === 'boolean'), true);
});

test('agent-work run fails closed on the wrong execution plane and writes a blocker report', () => {
  const out = tmpRunRoot();
  assert.equal(runCli(['plan', fixture, '--out', out]).status, 0);
  const run = runCli(['run', out]);
  assert.equal(run.status, 2, run.stderr || run.stdout);
  assert.equal(run.json.operation, 'run');
  assert.equal(run.json.ok, false);
  assert.equal(run.json.blockerFamily, 'remote_execution_boundary_required');
  const blocker = JSON.parse(fs.readFileSync(path.join(out, 'blocker_report.json'), 'utf8'));
  assert.equal(blocker.code, 'remote_execution_boundary_required');
  assert.equal(blocker.terminal, false);
});

test('agent-work run on the execution plane requires a green Phase 5 worker execution packet', () => {
  const out = tmpRunRoot();
  assert.equal(runCli(['plan', fixture, '--out', out]).status, 0);
  const run = runCli(['run', out], { env: { BENCHMARK_HOST_ROLE: 'execution_plane' } });
  assert.equal(run.status, 1, run.stderr || run.stdout);
  assert.equal(run.json.blockerCode, 'phase5_worker_execution_packet_required');
  assert.equal(fs.existsSync(path.join(out, 'run_events.jsonl')), true);
  const blocker = JSON.parse(fs.readFileSync(path.join(out, 'blocker_report.json'), 'utf8'));
  assert.equal(blocker.code, 'phase5_worker_execution_packet_required');
});

test('agent-work cancel records cancellation and uses the stable cancellation exit code', () => {
  const out = tmpRunRoot();
  assert.equal(runCli(['plan', fixture, '--out', out]).status, 0);
  const cancel = runCli(['cancel', out, '--reason', 'operator requested stop']);
  assert.equal(cancel.status, 4, cancel.stderr || cancel.stdout);
  assert.equal(cancel.json.operation, 'cancel');
  assert.equal(cancel.json.state, 'cancelled');
  assert.equal(cancel.json.exitCode, 4);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'cancellation.json'), 'utf8')).reason, 'operator requested stop');
});

test('agent-work CLI returns stable malformed and missing-artifact JSON contracts', () => {
  const out = tmpRunRoot();
  const bad = path.join(out, 'bad.json');
  fs.writeFileSync(bad, '{not-json');
  const malformed = runCli(['plan', bad, '--out', path.join(out, 'planned')]);
  assert.equal(malformed.status, 2);
  assert.equal(malformed.json.blockerFamily, 'malformed_input');
  assert.equal(malformed.json.state, 'invalid_input');

  const missing = runCli(['status', path.join(out, 'missing-run-root')]);
  assert.equal(missing.status, 1);
  assert.equal(missing.json.state, 'missing_artifact');
  assert.equal(missing.json.blockerFamily, 'missing_artifact');
});

test('legacy positional CLI syntax still works but emits a compatibility warning', () => {
  const out = tmpRunRoot();
  const legacy = runCli([fixture, '--out', out]);
  assert.equal(legacy.status, 0, legacy.stderr || legacy.stdout);
  assert.match(legacy.stderr, /compatibility-warning/);
  assert.equal(legacy.json.operation, 'plan');
  assert.equal(legacy.json.ok, true);
});

test('the pre-v1 CLI location is a warning-emitting wrapper over the product CLI', () => {
  const run = spawnSync(process.execPath, [compatibilityCli, 'doctor'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BENCHMARK_HOST_ROLE: 'control_plane' }
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stderr, /compatibility-warning/);
  assert.equal(JSON.parse(run.stdout).operation, 'doctor');
});

test('agent-work package scripts route through the canonical product facade, not benchmark controllers', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '1.0.0');
  assert.equal(pkg.bin['agent-work'], 'apps/agent-work/cli.mjs');
  const productScripts = Object.entries(pkg.scripts).filter(([name]) => name.startsWith('agent-work:'));
  assert.ok(productScripts.length >= AGENT_WORK_COMMANDS.length);
  for (const [name, command] of productScripts) {
    assert.match(command, /apps\/agent-work\/cli\.mjs/, name);
    assert.doesNotMatch(command, /run-agent-work-objective-controller|run-transfer-orchestrator-benchmark|run-transfer-benchmark|synthetic-labor-os/, name);
  }
});
