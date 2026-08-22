import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createDeploymentManifest,
  verifyDeploymentManifest,
  writeDeploymentManifest
} from '../packages/agent-work-deployment-provenance/index.mjs';

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('deployment provenance manifest records file hashes and git-safe metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-deploy-'));
  write(path.join(root, 'packages/demo/index.mjs'), 'export const demo = true;\n');
  write(path.join(root, 'node_modules/ignored/index.mjs'), 'ignore me');
  const manifest = createDeploymentManifest({
    root,
    includePaths: ['packages'],
    remoteRoot: '/remote/stack',
    bundleId: 'bundle-test',
    generatedAt: '2026-06-11T00:00:00.000Z'
  });
  assert.equal(manifest.schemaVersion, 'claw.agent_work_deployment_manifest.v0');
  assert.equal(manifest.bundleId, 'bundle-test');
  assert.equal(manifest.remoteRoot, '/remote/stack');
  assert.equal(manifest.fileCount, 1);
  assert.equal(manifest.files[0].path, 'packages/demo/index.mjs');
  assert.equal(typeof manifest.files[0].sha256, 'string');
  assert.equal(manifest.git.present, false);

  const verified = verifyDeploymentManifest({ root, manifest });
  assert.equal(verified.ok, true);
  assert.equal(verified.fileCount, 1);

  fs.appendFileSync(path.join(root, 'packages/demo/index.mjs'), 'export const changed = true;\n');
  const afterChange = verifyDeploymentManifest({ root, manifest });
  assert.equal(afterChange.ok, false);
  assert.equal(afterChange.mismatches[0].path, 'packages/demo/index.mjs');
});

test('deployment provenance CLI writes and verifies manifests', () => {
  const stackRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-deploy-cli-'));
  const out = path.join(temp, 'deployment_manifest.json');
  const writeRun = spawnSync(process.execPath, [
    path.join(stackRoot, 'apps/system-benchmark/write-agent-work-deployment-manifest.mjs'),
    '--root', stackRoot,
    '--out', out,
    '--include', 'packages/agent-work-dsl/index.mjs',
    '--include', 'packages/cortex-agent-work-adapter/index.mjs',
    '--remote-root', '/remote/stack',
    '--bundle-id', 'cli-bundle'
  ], { cwd: stackRoot, encoding: 'utf8' });
  assert.equal(writeRun.status, 0, writeRun.stderr || writeRun.stdout);
  const payload = JSON.parse(writeRun.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.bundleId, 'cli-bundle');
  assert.equal(fs.existsSync(out), true);

  const verifyRun = spawnSync(process.execPath, [
    path.join(stackRoot, 'apps/system-benchmark/write-agent-work-deployment-manifest.mjs'),
    '--root', stackRoot,
    '--verify', out
  ], { cwd: stackRoot, encoding: 'utf8' });
  assert.equal(verifyRun.status, 0, verifyRun.stderr || verifyRun.stdout);
  assert.equal(JSON.parse(verifyRun.stdout).ok, true);
});
