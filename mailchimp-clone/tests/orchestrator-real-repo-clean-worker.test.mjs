import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKER_SCRIPT = path.join(ROOT, 'scripts', 'orchestrator-real-repo-clean-worker.mjs');

function mkTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-clean-worker-'));
}

function writeVerifierScript(workspacePath) {
  const verifierPath = path.join(workspacePath, 'fake-verifier.mjs');
  fs.writeFileSync(verifierPath, `import fs from 'node:fs';\nimport path from 'node:path';\nconst markerPath = path.join(process.cwd(), 'verifier-ran.txt');\nfs.writeFileSync(markerPath, 'ran');\nconsole.log(JSON.stringify({ ok: true, markerPath }));\n`);
  return verifierPath;
}

function runWorkerWithAssignment(assignment, env = {}) {
  const workspacePath = mkTempDir();
  const verifierScriptPath = writeVerifierScript(workspacePath);
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  const resultPath = path.join(workspacePath, 'result.json');
  const logPath = path.join(workspacePath, 'worker.log');
  fs.writeFileSync(assignmentPath, JSON.stringify({
    workspacePath,
    verifierScriptPath,
    implementationScriptPath: null,
    resultPath,
    logPath,
    shard: { id: 'focus.test', requiredVerifiers: ['tests'], metadata: {} },
    lease: { leaseId: 'lease-1' },
    agentId: 'agent-1',
    executionMode: 'test',
    ...assignment
  }, null, 2));
  const result = spawnSync(process.execPath, [WORKER_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, MAILCHIMP_PRODUCT_ONLY: '1', ...env }
  });
  return {
    workspacePath,
    result,
    output: JSON.parse(fs.readFileSync(resultPath, 'utf8'))
  };
}

test('clean worker: strict parity-focus assignments run targeted tests in product-only mode', () => {
  const { workspacePath, result, output } = runWorkerWithAssignment({
    shard: {
      id: 'focus.ai_predictive_parity',
      requiredVerifiers: ['tests'],
      metadata: {
        strictGap: true,
        testFile: 'tests/current-product-parity.test.mjs'
      }
    },
    contextPack: {
      shard: { id: 'focus.ai_predictive_parity', surfaceIds: ['ai_predictive_parity'] },
      acceptanceChecks: ['Produce executable evidence for tests/current-product-parity.test.mjs'],
      assignmentContract: {
        verifierRequirements: ['tests'],
        successPredicate: ['Produce executable evidence for tests/current-product-parity.test.mjs']
      }
    }
  });
  assert.equal(result.status, 0, `worker should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.equal(output.verifierResults[0]?.skipped, undefined);
  assert.equal(output.verifierResults[0]?.ok, true);
  assert.ok(fs.existsSync(path.join(workspacePath, 'verifier-ran.txt')), 'targeted test verifier should actually run');
});

test('clean worker: generic tests still skip in product-only mode when no executable evidence is required', () => {
  const { workspacePath, result, output } = runWorkerWithAssignment({
    shard: {
      id: 'pkg.generic',
      requiredVerifiers: ['tests'],
      metadata: {}
    }
  });
  assert.equal(result.status, 0, `worker should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.equal(output.verifierResults[0]?.skipped, true);
  assert.equal(output.verifierResults[0]?.reason, 'product_only_mode');
  assert.equal(fs.existsSync(path.join(workspacePath, 'verifier-ran.txt')), false, 'generic product-only test verifier should remain skipped');
});
