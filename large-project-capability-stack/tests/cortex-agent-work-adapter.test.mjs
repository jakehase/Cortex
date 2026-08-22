import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  compileCortexAgentWorkHandoff,
  cortexHandoffToAgentWorkSpec,
  writeCortexAgentWorkHandoff
} from '../packages/cortex-agent-work-adapter/index.mjs';

test('Cortex handoff compiles to Agent Work DSL run contract with Cortex provenance', () => {
  const compiled = compileCortexAgentWorkHandoff({
    objective: 'Integrate Agent Work DSL into Cortex orchestration handoff',
    repoPath: '/tmp/stack',
    fidelity: 'production_slice',
    requestedAgentCount: 3,
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send', 'relaunch_benchmark'] },
    doneWhen: ['runner_ingestion_passes', 'no_truth_layer_overclaim'],
    budgets: { token_cap: 500000, worker_prompt_tokens: 6000 },
    wavePolicy: { max_waves: 4, full_context_waves: 0 },
    expansionPolicy: { triggers: ['objective_red', 'graph_exhausted'], max_cycles: 2 },
    evidenceSchemas: [{ id: 'handoff_integrity', gates: ['verified_surface_count >= 1'] }],
    routeLevels: ['L5 oracle', 'L7 librarian'],
    memoryCitations: ['cortex:agent-work-dsl'],
    surfaces: [{
      id: 'runner_ingestion',
      label: 'Runner ingestion',
      files: ['apps/system-benchmark/run-agent-work-objective-controller.mjs'],
      verify: ['node --test tests/agent-work-dsl.test.mjs']
    }]
  }, { generatedAt: '2026-06-11T00:00:00.000Z', runId: 'cortex-handoff-test' });

  assert.equal(compiled.handoff.schemaVersion, 'cortex.agent_work_handoff.v0');
  assert.equal(compiled.agentWorkSpec.schemaVersion, 'claw.agent_work_spec.v0');
  assert.equal(compiled.runContract.runId, 'cortex-handoff-test');
  assert.equal(compiled.runContract.scope.agentWorkLanguage.cortex.routeLevels.includes('L5 oracle'), true);
  assert.equal(compiled.runContract.scope.budgets.token_cap, 500000);
  assert.equal(compiled.runContract.scope.wavePolicy.full_context_waves, 0);
  assert.equal(compiled.runContract.scope.expansionPolicy.max_cycles, 2);
  assert.equal(compiled.runContract.scope.evidenceSchemas[0].id, 'handoff_integrity');
  assert.equal(compiled.runContract.scope.agentWorkLanguage.runtime.defaultRunner, 'objective_controller');
  assert.equal(compiled.runtime.defaultRunnerScript, 'apps/system-benchmark/run-agent-work-objective-controller.mjs');
  assert.equal(compiled.runContract.metadata.cortexAgentWorkHandoff.memoryCitationCount, 1);
  assert.equal(compiled.safetyReport.externalWriteAllowed, false);
});

test('Cortex handoff adapter normalizes surface matrix shaped inputs', () => {
  const spec = cortexHandoffToAgentWorkSpec({
    goal: 'Surface Matrix Shape',
    repoPath: '/tmp/repo',
    surfaceMatrix: {
      surfaces: [{
        surfaceId: 'matrix_surface',
        productFiles: ['src/matrix.mjs'],
        verification: ['node --test tests/matrix.test.mjs']
      }]
    }
  }, { generatedAt: '2026-06-11T00:00:00.000Z' });
  assert.equal(spec.surfaces[0].id, 'matrix_surface');
  assert.equal(spec.surfaces[0].files[0], 'src/matrix.mjs');
  assert.equal(spec.surfaces[0].verify[0], 'node --test tests/matrix.test.mjs');
});

test('Cortex handoff adapter preserves template references for template-only surfaces', () => {
  const compiled = compileCortexAgentWorkHandoff({
    objective: 'Compile template-only Cortex surface',
    repoPath: '/tmp/repo',
    templates: [{
      id: 'node_test_surface',
      files: ['src/{{id}}.mjs'],
      verify: ['node --test {{metadata.test_path}}']
    }],
    surfaces: [{
      id: 'templated_runner',
      templateIds: ['node_test_surface'],
      metadata: { test_path: 'tests/templated-runner.test.mjs' }
    }]
  }, { generatedAt: '2026-06-11T00:00:00.000Z', runId: 'cortex-template-test' });

  assert.deepEqual(compiled.handoff.surfaces[0].templateIds, ['node_test_surface']);
  assert.deepEqual(compiled.runContract.scope.surfaces[0].allowedFiles, ['src/templated_runner.mjs']);
  assert.deepEqual(compiled.runContract.scope.surfaces[0].verification, ['node --test tests/templated-runner.test.mjs']);
  assert.deepEqual(compiled.runContract.scope.surfaces[0].metadata.templateIds, ['node_test_surface']);
});

test('Cortex handoff CLI writes compiler artifacts for runner ingestion', () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-agent-work-'));
  const handoffPath = path.join(temp, 'handoff.json');
  const outDir = path.join(temp, 'compiled');
  fs.writeFileSync(handoffPath, JSON.stringify({
    objective: 'Compile handoff through CLI',
    repoPath: root,
    fidelity: 'production_slice',
    permissions: { forbid: ['external_send', 'relaunch_benchmark'] },
    surfaces: [{
      id: 'cli_surface',
      files: ['packages/cortex-agent-work-adapter/index.mjs'],
      verify: ['node --test tests/cortex-agent-work-adapter.test.mjs']
    }]
  }));

  const run = spawnSync(process.execPath, [path.join(root, 'apps/system-benchmark/compile-cortex-agent-work.mjs'), handoffPath, '--out', outDir, '--run-id', 'cortex-cli-test'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.runId, 'cortex-cli-test');
  assert.equal(payload.defaultRunner, 'objective_controller');
  assert.match(payload.defaultCommand, /run-agent-work-objective-controller\.mjs/);
  assert.equal(fs.existsSync(path.join(outDir, 'cortex_handoff.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'run_contract.json')), true);
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'compiler_report.json'), 'utf8'));
  assert.equal(report.schemaVersion, 'cortex.agent_work_compilation.v0');
});

test('writeCortexAgentWorkHandoff returns materialized paths', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-agent-work-write-'));
  const result = writeCortexAgentWorkHandoff({
    outputDir: temp,
    options: { generatedAt: '2026-06-11T00:00:00.000Z', runId: 'write-cortex-handoff' },
    input: {
      objective: 'Write handoff artifacts',
      repoPath: '/tmp/repo',
      surfaces: [{ id: 'write_probe', files: ['src/write.mjs'], verify: ['node --test tests/write.test.mjs'] }]
    }
  });
  assert.equal(fs.existsSync(result.files.cortexHandoffPath), true);
  assert.equal(JSON.parse(fs.readFileSync(result.files.runContractPath, 'utf8')).runId, 'write-cortex-handoff');
});
