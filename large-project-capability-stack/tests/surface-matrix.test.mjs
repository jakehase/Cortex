import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileTaskContract } from '../packages/task-contract/index.mjs';
import { createIssueGraph, upsertIssue, setIssueStatus } from '../packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, deriveSupervisorTruth } from '../packages/surface-matrix/index.mjs';

test('derives machine-readable surface status from graph plus artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-matrix-'));
  const artifact = path.join(dir, 'artifact.json');
  fs.writeFileSync(artifact, '{}');
  const contract = compileTaskContract({ anchor: 'a', targetPath: dir, requestedScope: ['X1'], evidenceRequirements: ['artifact'] });
  let graph = createIssueGraph({});
  graph = upsertIssue(graph, { id: 'x1', title: 'X1', acceptanceCriteria: ['done'] });
  graph = setIssueStatus(graph, 'x1', 'complete', [artifact]);
  const matrix = compileSurfaceMatrix({ contract, graph, surfaces: [{ id: 'X1', label: 'X1', issueIds: ['x1'], requiredArtifacts: [artifact] }] });
  assert.equal(matrix.status, 'all_complete');
  assert.equal(deriveSupervisorTruth(matrix).supervisorStatus, 'green');
});
