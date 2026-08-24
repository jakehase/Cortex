import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildRemoteCompletionHandoff,
  completionHandoffSchemaVersion,
  defaultCompletionHandoffPath,
  extractCompletionSummary,
} from './remote-completion-handoff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('extracts the final bounded worker message from Codex JSONL', () => {
  const stdout = [
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Earlier update.' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Committed abc123; 12/12 tests passed; worktree clean. Remaining: deploy after review.' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 20 } }),
  ].join('\n');

  assert.equal(
    extractCompletionSummary(stdout),
    'Committed abc123; 12/12 tests passed; worktree clean. Remaining: deploy after review.',
  );
});

test('builds a deterministic review-only completion handoff without inferring a project', () => {
  const result = {
    schemaVersion: 'clawd.codex_worker_launch.v1',
    action: 'exec',
    generatedAt: '2026-08-21T00:00:00Z',
    startedAt: '2026-08-20T23:59:00Z',
    completedAt: '2026-08-21T00:00:00Z',
    executionPlane: { host: 'worker@example', workspace: '/srv/work' },
    ok: true,
    launchConfirmed: true,
    completionConfirmed: true,
    exitCode: 0,
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
    serviceTier: { requested: null, transmitted: false, providerConfirmed: false, policy: 'provider_default_no_override' },
    providerUsage: {
      callsStarted: 1,
      callsCompleted: 1,
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 5,
      tokensObserved: 35,
      orderedSingleTurn: true,
      finalAgentMessageObserved: true,
      terminalFailureObserved: false,
      eventStreamSha256: 'a'.repeat(64),
    },
    sourceIdentity: {
      launcherSha256: 'b'.repeat(64),
      handoffModuleSha256: 'c'.repeat(64),
      configSha256: 'd'.repeat(64),
    },
    stdout: [
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Tests passed and the worktree is clean.' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 20 } }),
    ].join('\n'),
  };

  const resultArtifact = { path: '/tmp/result.json', sha256: 'e'.repeat(64), bytes: 123, persisted: true };
  const first = buildRemoteCompletionHandoff({ result, resultArtifact, task: 'Website design learning checkpoint' });
  const second = buildRemoteCompletionHandoff({ result, resultArtifact, task: 'Website design learning checkpoint' });

  assert.equal(first.schemaVersion, completionHandoffSchemaVersion);
  assert.equal(first.status, 'complete');
  assert.equal(first.project, null);
  assert.equal(first.completion.summarySource, 'worker_final_message');
  assert.equal(first.handoffId, second.handoffId);
  assert.equal(first.integrity.canonicalPayloadSha256, first.handoffId);
  assert.equal(first.resultArtifact.sha256, resultArtifact.sha256);
  assert.equal(first.verifierReceipt.exactResultArtifactBound, true);
  assert.deepEqual(first.canonicalMemory, {
    writePerformed: false,
    reviewRequired: true,
    target: 'canonical_project_memory',
  });
});

test('launcher writes an automatic failed handoff sidecar beside a result artifact', (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-handoff-test-'));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const configPath = path.join(temporary, 'config.json');
  const artifactPath = path.join(temporary, 'worker-result.json');
  fs.writeFileSync(configPath, JSON.stringify({
    executionPlane: { host: 'invalid host', codexBin: '/bin/false', workspace: '/tmp' },
    model: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
    sandbox: 'read-only',
    timeoutsMs: { transport: 100, provider: 100 },
  }));

  const run = spawnSync(process.execPath, [
    path.join(here, 'codex-worker-launcher.mjs'),
    'exec',
    '--config', configPath,
    '--prompt', 'Do nothing.',
    '--artifact', artifactPath,
    '--project', 'website-design-learning',
  ], { encoding: 'utf8' });

  assert.equal(run.status, 1);
  const sidecarPath = defaultCompletionHandoffPath(artifactPath);
  const result = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const handoff = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  assert.equal(result.completionHandoffArtifact, sidecarPath);
  assert.equal(handoff.schemaVersion, completionHandoffSchemaVersion);
  assert.equal(handoff.status, 'failed');
  assert.equal(handoff.project, 'website-design-learning');
  assert.equal(handoff.canonicalMemory.writePerformed, false);
  assert.equal(handoff.canonicalMemory.reviewRequired, false);
  assert.equal(
    handoff.resultArtifact.sha256,
    crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex'),
  );
});

test('handoff identity binds usage, exit state, remaining work, and exact result digest', () => {
  const base = {
    schemaVersion: 'clawd.codex_worker_launch.v2',
    action: 'exec',
    startedAt: '2026-08-20T23:59:00Z',
    completedAt: '2026-08-21T00:00:00Z',
    executionPlane: { host: 'worker@example', workspace: '/srv/work' },
    ok: true,
    launchConfirmed: true,
    completionConfirmed: true,
    exitCode: 0,
    providerUsage: {
      callsStarted: 1,
      callsCompleted: 1,
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 0,
      tokensObserved: 30,
      orderedSingleTurn: true,
      finalAgentMessageObserved: true,
      terminalFailureObserved: false,
    },
    stdout: [
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Finished.' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 20 } }),
    ].join('\n'),
  };
  const artifact = { path: '/tmp/result.json', sha256: '1'.repeat(64), bytes: 100, persisted: true };
  const original = buildRemoteCompletionHandoff({ result: base, resultArtifact: artifact });
  const changedUsage = buildRemoteCompletionHandoff({
    result: { ...base, providerUsage: { ...base.providerUsage, inputTokens: 11, tokensObserved: 31 } },
    resultArtifact: artifact,
  });
  const changedResult = buildRemoteCompletionHandoff({
    result: base,
    resultArtifact: { ...artifact, sha256: '2'.repeat(64) },
  });
  const remaining = buildRemoteCompletionHandoff({ result: base, resultArtifact: artifact, remainingWork: 'Deploy.' });
  assert.notEqual(original.handoffId, changedUsage.handoffId);
  assert.notEqual(original.handoffId, changedResult.handoffId);
  assert.notEqual(original.handoffId, remaining.handoffId);
  assert.equal(remaining.status, 'execution_complete_review_required');
});
