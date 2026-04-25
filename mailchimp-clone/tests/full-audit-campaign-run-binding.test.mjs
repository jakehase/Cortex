import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCampaignRunBinding, resolveMirroredArtifactPath } from '../scripts/lib/full-audit-campaign-run-binding.mjs';

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

test('resolveCampaignRunBinding prefers newer worker status run id over stale current_run.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-run-binding-'));
  const artifactDir = path.join(root, 'artifacts', 'full_audit_campaign');
  const currentRunPath = path.join(artifactDir, 'current_run.json');
  const workerStatusPath = path.join(artifactDir, 'reports', '100_agent_worker_status.json');
  const remoteExecutionStatusPath = path.join(root, 'artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline', 'remote_execution_status.json');

  writeJson(currentRunPath, {
    runId: 'campaign-old',
    generatedAt: '2026-04-08T22:53:53.048Z',
    remoteArtifactRoot: '/remote/old',
    remoteWorktree: '/remote/worktree-old',
    remoteBaselineRepo: '/remote/base-old'
  });
  writeJson(remoteExecutionStatusPath, {
    runId: 'campaign-new',
    generatedAt: '2026-04-09T14:17:52.775Z',
    artifactRoot: '/remote/new-artifacts',
    worktreePath: '/remote/worktree-new',
    baselineRepo: '/remote/base-new'
  });
  writeJson(workerStatusPath, {
    runId: 'campaign-new',
    generatedAt: '2026-04-09T14:18:08.982Z',
    running: false,
    mirrored: {
      remoteExecutionStatusPath: 'artifacts/qualification/orchestrator_real_repo_clean_baseline/remote_execution_status.json'
    }
  });

  const resolved = resolveCampaignRunBinding({
    rootDir: root,
    artifactDir,
    currentRunPath,
    workerStatusPath
  });

  assert.equal(resolved.runId, 'campaign-new');
  assert.equal(resolved.source, 'worker_status');
  assert.equal(resolved.currentRunStale, true);
  assert.equal(resolved.currentRun.remoteArtifactRoot, '/remote/new-artifacts');
  assert.equal(resolved.currentRun.remoteWorktree, '/remote/worktree-new');
  assert.equal(resolved.currentRun.remoteBaselineRepo, '/remote/base-new');
  assert.equal(resolved.runDir, path.join(artifactDir, 'runs', 'campaign-new'));
});

test('resolveMirroredArtifactPath resolves worker mirrored paths relative to repo root', () => {
  const root = '/tmp/mailchimp-root';
  const workerStatus = {
    mirrored: {
      canonicalSummaryPath: 'artifacts/qualification/orchestrator_real_repo_clean_baseline/canonical_summary.json'
    }
  };
  assert.equal(
    resolveMirroredArtifactPath(root, workerStatus, 'canonicalSummaryPath', null),
    '/tmp/mailchimp-root/artifacts/qualification/orchestrator_real_repo_clean_baseline/canonical_summary.json'
  );
  assert.equal(resolveMirroredArtifactPath(root, workerStatus, 'missing', '/fallback.json'), '/fallback.json');
});

test('resolveMirroredArtifactPath prefers an existing run-scoped fallback artifact over a mirrored global path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-run-binding-fallback-'));
  const workerStatus = {
    mirrored: {
      canonicalSummaryPath: 'artifacts/qualification/orchestrator_real_repo_clean_baseline/canonical_summary.json'
    }
  };
  const mirroredPath = path.join(root, workerStatus.mirrored.canonicalSummaryPath);
  const fallbackPath = path.join(root, 'artifacts', 'full_audit_campaign', 'runs', 'campaign-123', 'delegate', 'canonical_summary.json');
  fs.mkdirSync(path.dirname(mirroredPath), { recursive: true });
  fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
  fs.writeFileSync(mirroredPath, '{"scope":"global"}\n');
  fs.writeFileSync(fallbackPath, '{"scope":"run"}\n');

  assert.equal(resolveMirroredArtifactPath(root, workerStatus, 'canonicalSummaryPath', fallbackPath), fallbackPath);
});

test('resolveCampaignRunBinding does not carry remote metadata forward from an older iteration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-run-binding-newer-'));
  const artifactDir = path.join(root, 'artifacts', 'full_audit_campaign');
  const currentRunPath = path.join(artifactDir, 'current_run.json');
  const workerStatusPath = path.join(artifactDir, 'reports', '100_agent_worker_status.json');
  const remoteExecutionStatusPath = path.join(root, 'artifacts', 'qualification', 'orchestrator_real_repo_clean_baseline', 'remote_execution_status.json');

  writeJson(currentRunPath, {
    runId: 'campaign-new',
    generatedAt: '2026-04-09T17:30:00.000Z',
    remoteArtifactRoot: null,
    remoteWorktree: null,
    remoteBaselineRepo: null
  });
  writeJson(remoteExecutionStatusPath, {
    runId: 'campaign-old',
    generatedAt: '2026-04-09T17:20:00.000Z',
    artifactRoot: '/remote/old-artifacts',
    worktreePath: '/remote/worktree-old',
    baselineRepo: '/remote/base-old'
  });
  writeJson(workerStatusPath, {
    runId: 'campaign-old',
    generatedAt: '2026-04-09T17:20:05.000Z',
    running: false,
    mirrored: {
      remoteExecutionStatusPath: 'artifacts/qualification/orchestrator_real_repo_clean_baseline/remote_execution_status.json'
    }
  });

  const resolved = resolveCampaignRunBinding({
    rootDir: root,
    artifactDir,
    currentRunPath,
    workerStatusPath
  });

  assert.equal(resolved.runId, 'campaign-new');
  assert.equal(resolved.currentRun.remoteArtifactRoot, null);
  assert.equal(resolved.currentRun.remoteWorktree, null);
  assert.equal(resolved.currentRun.remoteBaselineRepo, null);
});
