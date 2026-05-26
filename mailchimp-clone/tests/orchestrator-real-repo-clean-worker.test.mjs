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

test('clean worker: preserves implementation diffs for semantic product admission', () => {
  const workspacePath = mkTempDir();
  fs.mkdirSync(path.join(workspacePath, 'packages/app'), { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'packages/app/domain-growth.mjs'), 'export const original = true;\n');

  const implementationScriptPath = path.join(workspacePath, 'fake-implement-with-diff.mjs');
  fs.writeFileSync(implementationScriptPath, `import fs from 'node:fs';\nimport path from 'node:path';\nconst assignmentPath = process.argv[process.argv.indexOf('--assignment') + 1];\nconst assignment = JSON.parse(fs.readFileSync(assignmentPath, 'utf8'));\nconst rel = 'packages/app/domain-growth.mjs';\nconst target = path.join(assignment.workspacePath, rel);\nfs.writeFileSync(target, 'export const original = true;\\nexport function realSignupRuntime(input) { return { ok: true, email: input.email }; }\\n');\nconst diff = '--- a/packages/app/domain-growth.mjs\\n+++ b/packages/app/domain-growth.mjs\\n@@\\n+export function realSignupRuntime(input) { return { ok: true, email: input.email }; }';\nconsole.log(JSON.stringify({ ok: true, modifiedFiles: [rel], diff, unifiedDiff: diff, diffSummary: 'real signup runtime diff' }));\n`);

  const assignmentPath = path.join(workspacePath, 'assignment.json');
  const resultPath = path.join(workspacePath, 'result.json');
  const logPath = path.join(workspacePath, 'worker.log');
  fs.writeFileSync(assignmentPath, JSON.stringify({
    workspacePath,
    verifierScriptPath: writeVerifierScript(workspacePath),
    implementationScriptPath,
    resultPath,
    logPath,
    shard: {
      id: 'focus.signup_forms_popups::semantic-frontier-001#01-primary_runtime_spine',
      allowedFiles: ['packages/app/domain-growth.mjs'],
      requiredVerifiers: [],
      metadata: { semanticDirector: true, architectureFrontier: true }
    },
    lease: { leaseId: 'lease-1' },
    agentId: 'agent-1',
    executionMode: 'test'
  }, null, 2));

  const result = spawnSync(process.execPath, [WORKER_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, MAILCHIMP_PRODUCT_ONLY: '1' }
  });
  assert.equal(result.status, 0, `worker should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(output.implementation.modifiedFiles[0], 'packages/app/domain-growth.mjs');
  assert.match(output.implementation.diff, /\+export function realSignupRuntime/);
  assert.equal(output.implementation.unifiedDiff, output.implementation.diff);
});

test('clean worker: verifier subprocess replaces tiny inherited heap caps', () => {
  const workspacePath = mkTempDir();
  const verifierScriptPath = path.join(workspacePath, 'heap-verifier.mjs');
  fs.writeFileSync(verifierScriptPath, `import fs from 'node:fs';\nimport path from 'node:path';\nfs.writeFileSync(path.join(process.cwd(), 'node-options.txt'), process.env.NODE_OPTIONS || '');\nconsole.log(JSON.stringify({ ok: true }));\n`);
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  const resultPath = path.join(workspacePath, 'result.json');
  const logPath = path.join(workspacePath, 'worker.log');
  fs.writeFileSync(assignmentPath, JSON.stringify({
    workspacePath,
    verifierScriptPath,
    implementationScriptPath: null,
    resultPath,
    logPath,
    shard: {
      id: 'focus.heap_cap',
      requiredVerifiers: ['imports'],
      metadata: { strictGap: true }
    },
    lease: { leaseId: 'lease-1' },
    agentId: 'agent-1',
    executionMode: 'test'
  }, null, 2));

  const result = spawnSync(process.execPath, [WORKER_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, MAILCHIMP_PRODUCT_ONLY: '1', NODE_OPTIONS: '--max-old-space-size=48 --trace-warnings', ORCHESTRATOR_VERIFIER_HEAP_MB: '768' }
  });
  assert.equal(result.status, 0, `worker should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const nodeOptions = fs.readFileSync(path.join(workspacePath, 'node-options.txt'), 'utf8');
  assert.match(nodeOptions, /--max-old-space-size=768/);
  assert.doesNotMatch(nodeOptions, /--max-old-space-size=48/);
  assert.match(nodeOptions, /--trace-warnings/);
});

test('clean worker: failed verification restores implementation writes from allowed files', () => {
  const workspacePath = mkTempDir();
  fs.mkdirSync(path.join(workspacePath, 'packages/app'), { recursive: true });
  const target = path.join(workspacePath, 'packages/app/domain-growth.mjs');
  fs.writeFileSync(target, 'export const original = true;\n');

  const implementationScriptPath = path.join(workspacePath, 'fake-implement.mjs');
  fs.writeFileSync(implementationScriptPath, `import fs from 'node:fs';\nimport path from 'node:path';\nconst assignmentPath = process.argv[process.argv.indexOf('--assignment') + 1];\nconst assignment = JSON.parse(fs.readFileSync(assignmentPath, 'utf8'));\nconst target = path.join(assignment.workspacePath, 'packages/app/domain-growth.mjs');\nfs.writeFileSync(target, 'export function broken( {\\n');\nconsole.log(JSON.stringify({ ok: true, modifiedFiles: ['packages/app/domain-growth.mjs'], diffSummary: 'intentional broken write' }));\n`);

  const verifierScriptPath = path.join(workspacePath, 'fake-failing-verifier.mjs');
  fs.writeFileSync(verifierScriptPath, `console.log(JSON.stringify({ ok: false, verifier: 'tests', reason: 'intentional failure' }));\nprocess.exit(3);\n`);

  const assignmentPath = path.join(workspacePath, 'assignment.json');
  const resultPath = path.join(workspacePath, 'result.json');
  const logPath = path.join(workspacePath, 'worker.log');
  fs.writeFileSync(assignmentPath, JSON.stringify({
    workspacePath,
    verifierScriptPath,
    implementationScriptPath,
    resultPath,
    logPath,
    shard: {
      id: 'focus.restore_failed_write',
      allowedFiles: ['packages/app/domain-growth.mjs'],
      requiredVerifiers: ['tests'],
      metadata: { strictGap: true, testFile: 'tests/intentional.test.mjs' }
    },
    lease: { leaseId: 'lease-1' },
    agentId: 'agent-1',
    executionMode: 'test'
  }, null, 2));

  const result = spawnSync(process.execPath, [WORKER_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, MAILCHIMP_PRODUCT_ONLY: '1' }
  });
  assert.equal(result.status, 2, `worker should fail verification\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.equal(fs.readFileSync(target, 'utf8'), 'export const original = true;\n');
  const output = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(output.ok, false);
  assert.equal(output.verifierResults[0]?.ok, false);
});
