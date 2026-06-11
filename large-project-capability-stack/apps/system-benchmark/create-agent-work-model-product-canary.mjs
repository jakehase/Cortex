#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { writeCortexAgentWorkHandoff } from '../../packages/cortex-agent-work-adapter/index.mjs';

function parseArgs(argv) {
  const args = {
    out: null,
    fixtureRoot: null,
    repoPath: null,
    artifactRoot: null,
    runId: null,
    executionBoundary: 'remote_execution_required',
    workerCommand: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--out') { args.out = next; index += 1; continue; }
    if (token === '--fixture-root') { args.fixtureRoot = next; index += 1; continue; }
    if (token === '--repo' || token === '--repo-path') { args.repoPath = next; index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--run-id') { args.runId = next; index += 1; continue; }
    if (token === '--execution-boundary') { args.executionBoundary = next; index += 1; continue; }
    if (token === '--worker-command') { args.workerCommand = next; index += 1; continue; }
  }
  return args;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function createFixture(fixtureRoot) {
  write(path.join(fixtureRoot, 'packages/canary/index.mjs'), `export function agentWorkModelProductCanary(input = {}) {
  return {
    ok: false,
    kind: 'agent-work-model-product-canary',
    source: input.source || 'initial',
    verified: false,
    nextStep: 'model worker should make this verifier pass'
  };
}
`);
  write(path.join(fixtureRoot, 'tests/canary.test.mjs'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { agentWorkModelProductCanary } from '../packages/canary/index.mjs';

test('model product canary is repaired by the worker', () => {
  assert.deepEqual(agentWorkModelProductCanary({ source: 'codex-worker' }), {
    ok: true,
    kind: 'agent-work-model-product-canary',
    source: 'codex-worker',
    verified: true,
    implementedBy: 'model-worker'
  });
});
`);
  write(path.join(fixtureRoot, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test tests/canary.test.mjs' } }, null, 2) + '\n');
}

const args = parseArgs(process.argv.slice(2));
if (!args.out) {
  console.error('usage: node apps/system-benchmark/create-agent-work-model-product-canary.mjs --out <artifact-dir> [--fixture-root <repo>] [--repo <repo-path>] [--artifact-root <run-root>] [--run-id <id>] [--execution-boundary remote_execution_required|control_plane_allowed] [--worker-command <command>]');
  process.exit(2);
}

const outDir = path.resolve(args.out);
const fixtureRoot = path.resolve(args.fixtureRoot || path.join(outDir, 'fixture-repo'));
const repoPath = path.resolve(args.repoPath || fixtureRoot);
const runId = args.runId || `agent-work-model-product-canary-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const artifactRoot = path.resolve(args.artifactRoot || path.join(outDir, 'run'));
fs.mkdirSync(outDir, { recursive: true });
createFixture(fixtureRoot);

const handoffInput = {
  objective: 'Prove Agent Work DSL can drive a real model-worker product diff and verifier pass',
  goalId: 'agent_work_model_product_canary',
  repoPath,
  benchmarkId: 'agent_work_model_product_canary',
  benchmarkTier: 'execution_smoke',
  runId,
  artifactRoot,
  scoreboardPath: path.join(artifactRoot, 'scoreboard.json'),
  fidelity: 'production_slice',
  requestedAgentCount: 1,
  executionBoundary: args.executionBoundary,
  permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send', 'relaunch_benchmark', 'touch_prod'] },
  doneWhen: ['worker_product_diff_landed', 'verifier_passes', 'no_truth_layer_overclaim'],
  routeLevels: ['L5 oracle', 'L27 forge', 'L34 validator'],
  surfaces: [{
    id: 'model_product_canary',
    label: 'Model worker product-diff canary',
    goal: 'Repair packages/canary/index.mjs so tests/canary.test.mjs passes via a real product-code diff.',
    files: ['packages/canary/index.mjs'],
    verify: ['node --test tests/canary.test.mjs']
  }],
  metadata: {
    productDiffMode: 'creative_product_work',
    requireRealProductDiffs: true,
    creativeProductWork: {
      required: true,
      minIterations: 1,
      minWorkerRuntimeMs: 0,
      promptMode: 'compact',
      ...(args.workerCommand ? { workerCommand: args.workerCommand } : {})
    },
    canonicalLandingEvidence: {
      enabled: true,
      minAddedLineCount: 1,
      minUniqueNormalizedAddedLineCount: 1,
      duplicateLineRatioMax: 0.9
    }
  }
};
write(path.join(outDir, 'handoff_input.json'), JSON.stringify(handoffInput, null, 2) + '\n');
const compiled = writeCortexAgentWorkHandoff({ input: handoffInput, outputDir: path.join(outDir, 'compiled'), options: { runId } });
write(path.join(outDir, 'canary_meta.json'), JSON.stringify({
  runId,
  outDir,
  fixtureRoot,
  repoPath,
  artifactRoot,
  compiledDir: path.join(outDir, 'compiled'),
  runContractPath: compiled.files.runContractPath,
  cortexHandoffPath: compiled.files.cortexHandoffPath,
  workerCommand: args.workerCommand || null,
  executionBoundary: args.executionBoundary
}, null, 2) + '\n');
console.log(JSON.stringify({
  ok: true,
  runId,
  outDir,
  fixtureRoot,
  repoPath,
  artifactRoot,
  runContractPath: compiled.files.runContractPath,
  cortexHandoffPath: compiled.files.cortexHandoffPath,
  benchmarkTier: compiled.runContract.benchmarkTier,
  productDiffMode: compiled.runContract.scope.productDiffMode,
  executionBoundary: compiled.runContract.executionBoundary
}, null, 2));
