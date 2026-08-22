import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileCanonicalAgentWork, executeCanonicalAgentWork, CANONICAL_PIPELINE } from '../packages/canonical-agent-work/index.mjs';

const handoff = {
  objective: 'Implement a bounded brownfield product surface',
  repoPath: '/tmp/brownfield', fidelity: 'production_slice', requestedAgentCount: 2,
  executionBoundary: 'remote_execution_required', stopCondition: 'supervisor_green_or_blocker_report',
  permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send'] },
  doneWhen: ['independent_acceptance_green'],
  surfaces: [{ id: 'product_surface', files: ['src/product.mjs'], verify: ['node --test tests/product.test.mjs'] }]
};

test('canonical pipeline has one owner per stage and relegates SLOS to compatibility', () => {
  assert.deepEqual(CANONICAL_PIPELINE.stages.map((stage) => stage.owner), ['openclaw', 'cortex', 'agent_work', 'codex_workers', 'independent_verifier', 'openclaw']);
  assert.equal(CANONICAL_PIPELINE.compatibilityOnly.includes('synthetic_labor_os_v19'), true);
});

test('canonical compiler materializes Agent Work contracts and provenance', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-agent-work-'));
  const result = compileCanonicalAgentWork({ input: handoff, outputDir: out, options: { runId: 'canonical-test' } });
  assert.equal(result.canonicalManifest.compileGreen, true);
  assert.equal(result.canonicalManifest.executeAllowedHere, false);
  assert.equal(fs.existsSync(path.join(out, 'run_contract.json')), true);
  assert.equal(fs.existsSync(path.join(out, 'canonical_pipeline_manifest.json')), true);
});

test('remote contracts fail closed on the control-plane host', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-agent-work-block-'));
  const result = compileCanonicalAgentWork({ input: handoff, outputDir: out, options: { runId: 'boundary-test' } });
  const execution = executeCanonicalAgentWork({ compilation: result, dryRun: true });
  assert.equal(execution.blocked, true);
  assert.equal(execution.blockerFamily, 'remote_execution_boundary_required');
});
