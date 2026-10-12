import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from './codex-worker-launcher.mjs';

function fixture(context, mode = 'green') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-worker-launcher-test-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const log = path.join(root, 'ssh-args.log');
  const streams = {
    green: [
      { type: 'thread.started', thread_id: 'test' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Finished with verified output.' } },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 2 } },
    ],
    no_message: [
      { type: 'turn.started' },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
    ],
    out_of_order: [
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Late.' } },
      { type: 'turn.started' },
    ],
    terminal_error: [
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Not terminal.' } },
      { type: 'error' },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
    ],
  };
  const sshScriptFn = ({ args }) => {
    fs.appendFileSync(log, `${JSON.stringify(args)}\n`);
    if (args.length === 2) {
      return { status: 0, signal: null, stdout: 'preflight_ok\n', stderr: '' };
    }
    return {
      status: 0,
      signal: null,
      stdout: `${(streams[mode] || []).map((row) => JSON.stringify(row)).join('\n')}\n`,
      stderr: '',
    };
  };
  const config = path.join(root, 'config.json');
  fs.writeFileSync(config, `${JSON.stringify({
    schemaVersion: 'clawd.worker_launch.default.v2',
    executionPlane: { host: 'worker@example', codexBin: '/opt/codex', workspace: '/srv/work' },
    model: 'gpt-5.6-sol',
    authPolicyId: 'pmhnp_oauth_approved_2026-09-25',
    reasoningEffort: 'xhigh',
    serviceTierPolicy: 'provider_default_no_override',
    sandbox: 'workspace-write',
    timeoutsMs: { transport: 1000, provider: 1000 },
  }, null, 2)}\n`);
  return {
    root,
    log,
    config,
    artifact: path.join(root, 'result.json'),
    env: { ...process.env },
    sshScriptFn,
  };
}

function run(fx, extra = []) {
  try {
    const output = runCli([
      'exec',
      '--config', fx.config,
      '--prompt', 'Perform the bounded task.',
      '--artifact', fx.artifact,
      ...extra,
    ], fx.env, { sshScriptFn: fx.sshScriptFn });
    return {
      status: output.exitCode,
      signal: null,
      error: null,
      stdout: `${JSON.stringify(output.consoleResult, null, 2)}\n`,
      stderr: '',
    };
  } catch (error) {
    return {
      status: 1,
      signal: null,
      error,
      stdout: '',
      stderr: error instanceof Error ? error.stack || error.message : String(error),
    };
  }
}

function failureDetail(execution, fx) {
  let artifact = null;
  if (fs.existsSync(fx.artifact)) {
    try { artifact = JSON.parse(fs.readFileSync(fx.artifact, 'utf8')); } catch { artifact = 'unparseable'; }
  }
  return JSON.stringify({
    status: execution.status,
    signal: execution.signal,
    error: execution.error ? { code: execution.error.code, message: execution.error.message } : null,
    stdout: execution.stdout,
    stderr: execution.stderr,
    artifact,
  }, null, 2);
}

test('accepts exactly one ordered result and binds the exact persisted result artifact', (context) => {
  const fx = fixture(context);
  const execution = run(fx);
  assert.equal(execution.status, 0, failureDetail(execution, fx));
  const resultBytes = fs.readFileSync(fx.artifact);
  const result = JSON.parse(resultBytes);
  const handoff = JSON.parse(fs.readFileSync(path.join(fx.root, 'result.completion-handoff.json')));
  assert.equal(result.ok, true);
  assert.equal(result.providerUsage.orderedSingleTurn, true);
  assert.equal(result.providerUsage.finalAgentMessageObserved, true);
  assert.equal(result.providerUsage.terminalFailureObserved, false);
  assert.equal(result.serviceTier.requested, null);
  assert.equal(result.serviceTier.transmitted, false);
  assert.equal(result.serviceTier.providerConfirmed, false);
  assert.equal(result.authenticationPolicy.required, 'pmhnp_oauth_approved_2026-09-25');
  assert.equal(result.authenticationPolicy.accountIdentityProviderConfirmed, false);
  assert.equal(Object.hasOwn(result, 'completionHandoff'), false);
  assert.equal(handoff.status, 'complete');
  assert.equal(handoff.verifierReceipt.exactResultArtifactBound, true);
  assert.equal(handoff.resultArtifact.sha256, crypto.createHash('sha256').update(resultBytes).digest('hex'));
  assert.match(handoff.sourceIdentity.launcherSha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.statSync(fx.artifact).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(fx.root, 'result.completion-handoff.json')).mode & 0o777, 0o600);
  const sshArgs = fs.readFileSync(fx.log, 'utf8');
  assert.doesNotMatch(sshArgs, /service[_-]?tier/i);
  assert.match(sshArgs, /xhigh/);
});

test('rejects superseded reasoning and service-tier overrides before SSH transport', (context) => {
  const fx = fixture(context);
  const ultra = run(fx, ['--reasoning-effort', 'ultra']);
  assert.equal(ultra.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(fx.artifact)).failureCode, 'unsupported_reasoning_effort');
  assert.equal(fs.existsSync(fx.log), false);

  fs.rmSync(fx.artifact, { force: true });
  fs.rmSync(path.join(fx.root, 'result.completion-handoff.json'), { force: true });
  const priority = run(fx, ['--service-tier', 'priority']);
  assert.equal(priority.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(fx.artifact)).failureCode, 'service_tier_override_not_supported');
  assert.equal(fs.existsSync(fx.log), false);
});

test('rejects model and sandbox injection at admission before SSH transport', (context) => {
  const fx = fixture(context);
  const model = run(fx, ['--model', 'gpt-5.6-sol;touch /tmp/pwned']);
  assert.equal(model.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(fx.artifact)).failureCode, 'unsupported_model');
  assert.equal(fs.existsSync(fx.log), false);

  fs.rmSync(fx.artifact, { force: true });
  fs.rmSync(path.join(fx.root, 'result.completion-handoff.json'), { force: true });
  const sandbox = run(fx, ['--sandbox', 'workspace-write;id']);
  assert.equal(sandbox.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(fx.artifact)).failureCode, 'unsupported_sandbox');
  assert.equal(fs.existsSync(fx.log), false);
});

test('fails closed on missing, out-of-order, or terminal-error provider results', (context) => {
  for (const mode of ['no_message', 'out_of_order', 'terminal_error']) {
    const fx = fixture(context, mode);
    const execution = run(fx);
    assert.equal(execution.status, 1, `${mode}: ${execution.stderr || execution.stdout}`);
    const result = JSON.parse(fs.readFileSync(fx.artifact));
    const handoff = JSON.parse(fs.readFileSync(path.join(fx.root, 'result.completion-handoff.json')));
    assert.equal(result.ok, false, mode);
    assert.equal(handoff.status, 'failed', mode);
    assert.equal(handoff.verifierReceipt.exactResultArtifactBound, true, mode);
  }
});

test('remaining work prevents a terminal completion handoff and changes its identity', (context) => {
  const fx = fixture(context);
  const first = run(fx);
  assert.equal(first.status, 0, failureDetail(first, fx));
  const complete = JSON.parse(fs.readFileSync(path.join(fx.root, 'result.completion-handoff.json')));

  const secondArtifact = path.join(fx.root, 'second.json');
  fx.artifact = secondArtifact;
  const second = run(fx, ['--remaining-work', 'Deploy after review.']);
  assert.equal(second.status, 0);
  const review = JSON.parse(fs.readFileSync(path.join(fx.root, 'second.completion-handoff.json')));
  assert.equal(review.status, 'execution_complete_review_required');
  assert.notEqual(review.handoffId, complete.handoffId);
});
