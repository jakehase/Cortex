import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileTaskContract } from '../packages/task-contract/index.mjs';
import { createIssueGraph, upsertIssue, setIssueStatus } from '../packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, deriveSupervisorTruth } from '../packages/surface-matrix/index.mjs';
import { certifyClaim } from '../packages/certification/index.mjs';

function writeLines(filePath, count, line = 'export const value = 1;') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Array.from({ length: count }, () => line).join('\n'));
}

test('supervisor truth is matrix-derived, not file-existence-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualification-supervisor-'));
  const artifact = path.join(dir, 'artifact.txt');
  fs.writeFileSync(artifact, 'ok');
  const contract = compileTaskContract({ anchor: 'qualification', targetPath: dir, requestedScope: ['X1'], evidenceRequirements: ['artifact'] });
  let graph = createIssueGraph({});
  graph = upsertIssue(graph, { id: 'x1', title: 'X1', acceptanceCriteria: ['done'] });
  let matrix = compileSurfaceMatrix({ contract, graph, surfaces: [{ id: 'X1', label: 'X1', issueIds: ['x1'], requiredArtifacts: [artifact] }] });
  assert.equal(matrix.status, 'partial');
  assert.equal(deriveSupervisorTruth(matrix).supervisorStatus, 'red');
  graph = setIssueStatus(graph, 'x1', 'complete', [artifact]);
  matrix = compileSurfaceMatrix({ contract, graph, surfaces: [{ id: 'X1', label: 'X1', issueIds: ['x1'], requiredArtifacts: [artifact] }] });
  assert.equal(deriveSupervisorTruth(matrix).supervisorStatus, 'green');
});

test('honest qualification can go green while still denying full clone credibility', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualification-honesty-'));
  for (const folder of ['apps/web', 'packages/app/routes', 'packages/campaign', 'tests', 'docs', 'artifacts']) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }
  for (const file of [
    'apps/web/server.mjs',
    'apps/web/render.mjs',
    'packages/app/index.mjs',
    'packages/app/domain-core.mjs',
    'packages/app/routes/dashboard.mjs',
    'packages/campaign/index.mjs'
  ]) {
    writeLines(path.join(dir, file), 120);
  }
  for (let i = 0; i < 5; i += 1) writeLines(path.join(dir, 'tests', `suite-${i}.test.mjs`), 80, 'export const testCase = true;');

  const certification = certifyClaim({
    repoRoot: dir,
    requestedClaim: 'large_product_replica',
    evidenceArtifacts: [1, 2, 3, 4].map((n) => path.join(dir, 'artifacts', `${n}.json`)),
    repoTestsOk: true,
    targetTestsOk: true,
    supervisorOk: true,
    notifyOk: true,
    parityReport: {
      ok: true,
      passed: 4,
      evidence: { mode: 'http', browser: { available: false, real: false, driver: 'none' } }
    }
  });

  assert.equal(certification.statusFlags.scoped_completion_green, true);
  assert.equal(certification.statusFlags.full_clone_credible, false);
  assert.equal(certification.statusFlags.large_product_replica, false);
});
