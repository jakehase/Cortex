import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(here, 'codex-worker-launcher.mjs');

function fixture(context, mode = 'green') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-worker-launcher-test-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(root, 'ssh-args.log');
  const ssh = path.join(bin, 'ssh');
  fs.writeFileSync(ssh, `#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "$FAKE_SSH_ARG_LOG"
printf '\n' >> "$FAKE_SSH_ARG_LOG"
cat >/dev/null
if (( $# < 13 )); then
  printf 'preflight_ok\\n'
  exit 0
fi
case "$FAKE_STREAM_MODE" in
  green)
    printf '%s\\n' '{"type":"thread.started","thread_id":"test"}'
    printf '%s\\n' '{"type":"turn.started"}'
    printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Finished with verified output."}}'
    printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5,"reasoning_output_tokens":2}}'
    ;;
  no_message)
    printf '%s\\n' '{"type":"turn.started"}'
    printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'
    ;;
  out_of_order)
    printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'
    printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Late."}}'
    printf '%s\\n' '{"type":"turn.started"}'
    ;;
  terminal_error)
    printf '%s\\n' '{"type":"turn.started"}'
    printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Not terminal."}}'
    printf '%s\\n' '{"type":"error"}'
    printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'
    ;;
esac
`, { mode: 0o755 });
  const config = path.join(root, 'config.json');
  fs.writeFileSync(config, `${JSON.stringify({
    schemaVersion: 'clawd.worker_launch.default.v2',
    executionPlane: { host: 'worker@example', codexBin: '/opt/codex', workspace: '/srv/work' },
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
    serviceTierPolicy: 'provider_default_no_override',
    sandbox: 'workspace-write',
    timeoutsMs: { transport: 1000, provider: 1000 },
  }, null, 2)}\n`);
  return {
    root,
    log,
    config,
    artifact: path.join(root, 'result.json'),
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_SSH_ARG_LOG: log,
      FAKE_STREAM_MODE: mode,
    },
  };
}

function run(fx, extra = []) {
  return spawnSync(process.execPath, [
    launcher,
    'exec',
    '--config', fx.config,
    '--prompt', 'Perform the bounded task.',
    '--artifact', fx.artifact,
    ...extra,
  ], { encoding: 'utf8', env: fx.env });
}

test('accepts exactly one ordered result and binds the exact persisted result artifact', (context) => {
  const fx = fixture(context);
  const execution = run(fx);
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
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
  assert.equal(Object.hasOwn(result, 'completionHandoff'), false);
  assert.equal(handoff.status, 'complete');
  assert.equal(handoff.verifierReceipt.exactResultArtifactBound, true);
  assert.equal(handoff.resultArtifact.sha256, crypto.createHash('sha256').update(resultBytes).digest('hex'));
  assert.match(handoff.sourceIdentity.launcherSha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.statSync(fx.artifact).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(fx.root, 'result.completion-handoff.json')).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(fx.log, 'utf8'), /service[_-]?tier/i);
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
  assert.equal(first.status, 0);
  const complete = JSON.parse(fs.readFileSync(path.join(fx.root, 'result.completion-handoff.json')));

  const secondArtifact = path.join(fx.root, 'second.json');
  fx.artifact = secondArtifact;
  const second = run(fx, ['--remaining-work', 'Deploy after review.']);
  assert.equal(second.status, 0);
  const review = JSON.parse(fs.readFileSync(path.join(fx.root, 'second.completion-handoff.json')));
  assert.equal(review.status, 'execution_complete_review_required');
  assert.notEqual(review.handoffId, complete.handoffId);
});
