import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSelectedRunLandingEvidence,
  computeAddedLineStats,
  createCanonicalRunBaseline,
  deriveLandingEligibility,
  evaluatePatchLandingEvidence
} from '../packages/canonical-landing-evidence/index.mjs';
import {
  createPatchQueue,
  enqueuePatch,
  processPatchQueue
} from '../packages/multi-agent-orchestrator/index.mjs';

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-landing-evidence-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/runtime.mjs'), 'export const baseline = 1;\n');
  return repo;
}

const assignmentContract = {
  artifactKind: 'product_diff',
  targetFiles: ['packages/app/runtime.mjs'],
  targetModules: ['packages/app/runtime.mjs'],
  verifierRequirements: ['tests'],
  successPredicate: ['runtime behavior changes in packages/app/runtime.mjs']
};

function patch(overrides = {}) {
  return {
    id: overrides.id || 'patch-runtime',
    shardId: overrides.shardId || 'runtime-shard',
    filePaths: ['packages/app/runtime.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract,
      implementation: {
        modifiedFiles: ['packages/app/runtime.mjs'],
        diff: [
          '--- a/packages/app/runtime.mjs',
          '+++ b/packages/app/runtime.mjs',
          '@@ runtime delta @@',
          '+export function selectedRunRuntimeDelta() {',
          '+  return { ok: true, source: "canonical" };',
          '+}'
        ].join('\n')
      },
      ...(overrides.metadata || {})
    },
    ...overrides
  };
}

test('canonical landing evidence rejects claimed product diffs that did not change the canonical checkout', () => {
  const repo = makeRepo();
  const baseline = createCanonicalRunBaseline({ repoPath: repo, productPaths: ['packages/app/runtime.mjs'] });
  const record = evaluatePatchLandingEvidence(patch(), {
    repoPath: repo,
    baseline,
    policy: { productPaths: ['packages/app/runtime.mjs'] }
  });

  assert.equal(record.eligible, false);
  assert.equal(record.rejectionReason, 'no_landed_product_diff');
  assert.equal(deriveLandingEligibility({ record }).eligible, false);
});

test('canonical landing evidence credits only real selected-run product deltas and summarizes unique added lines', () => {
  const repo = makeRepo();
  const baseline = createCanonicalRunBaseline({ repoPath: repo, productPaths: ['packages/app/runtime.mjs'] });
  fs.appendFileSync(path.join(repo, 'packages/app/runtime.mjs'), '\nexport function selectedRunRuntimeDelta() { return { ok: true, source: "canonical" }; }\n');

  const record = evaluatePatchLandingEvidence(patch(), {
    repoPath: repo,
    baseline,
    policy: { productPaths: ['packages/app/runtime.mjs'] }
  });
  assert.equal(record.eligible, true);
  assert.deepEqual(record.landedProductFiles, ['packages/app/runtime.mjs']);
  assert.equal(record.addedLineStats.uniqueNormalizedAddedLineCount > 0, true);
  assert.equal(deriveLandingEligibility({ record }).eligible, true);

  const queue = { merged: [{ ...patch(), canonicalLandingRecord: record }], rejected: [] };
  const evidence = buildSelectedRunLandingEvidence({ repoPath: repo, baseline, patchQueue: queue, policy: { productPaths: ['packages/app/runtime.mjs'] } });
  assert.equal(evidence.summary.status, 'green');
  assert.equal(evidence.summary.selectedRunProductDeltaPresent, true);
  assert.deepEqual(evidence.summary.creditedProductFiles, ['packages/app/runtime.mjs']);
  assert.equal(computeAddedLineStats(patch().metadata.implementation.diff).addedLineCount, 3);
});

test('canonical landing evidence can enforce minimum added-line throughput policy', () => {
  const repo = makeRepo();
  const baseline = createCanonicalRunBaseline({ repoPath: repo, productPaths: ['packages/app/runtime.mjs'] });
  fs.appendFileSync(path.join(repo, 'packages/app/runtime.mjs'), '\nexport function selectedRunRuntimeDelta() { return { ok: true, source: "canonical" }; }\n');

  const record = evaluatePatchLandingEvidence(patch(), {
    repoPath: repo,
    baseline,
    policy: {
      productPaths: ['packages/app/runtime.mjs'],
      minAddedLineCount: 4,
      minUniqueNormalizedAddedLineCount: 4
    }
  });

  assert.equal(record.eligible, false);
  assert.equal(record.rejectionReason, 'added_line_count_below_policy');
  assert.deepEqual(record.failures, ['added_line_count_below_policy', 'unique_normalized_added_line_count_below_policy']);
  assert.equal(deriveLandingEligibility({ record }).eligible, false);
});

test('patch queue can block merge credit when canonical landing evidence is missing', async () => {
  const repo = makeRepo();
  const baseline = createCanonicalRunBaseline({ repoPath: repo, productPaths: ['packages/app/runtime.mjs'] });
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, patch({ id: 'patch-no-canonical-change' }));

  const processed = await processPatchQueue(queue, {
    canonicalLandingEvidence: true,
    landingEvidenceBaseline: baseline,
    landingEvidencePolicy: { repoPath: repo, productPaths: ['packages/app/runtime.mjs'] },
    verifyFns: { tests: async () => ({ ok: true }) }
  });

  assert.equal(processed.queue.merged.length, 0);
  assert.equal(processed.queue.rejected.length, 1);
  assert.equal(processed.queue.rejected[0].rejectionCategory, 'canonical_landing');
  assert.equal(processed.queue.rejected[0].rejectionReason, 'no_landed_product_diff');
  assert.equal(processed.landingEvidence.summary.status, 'red');
});

test('patch queue admits product diffs when the selected-run change is present in the canonical checkout', async () => {
  const repo = makeRepo();
  const baseline = createCanonicalRunBaseline({ repoPath: repo, productPaths: ['packages/app/runtime.mjs'] });
  fs.appendFileSync(path.join(repo, 'packages/app/runtime.mjs'), '\nexport function selectedRunRuntimeDelta() { return { ok: true, source: "canonical" }; }\n');
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, patch({ id: 'patch-with-canonical-change' }));

  const processed = await processPatchQueue(queue, {
    canonicalLandingEvidence: true,
    landingEvidenceBaseline: baseline,
    landingEvidencePolicy: { repoPath: repo, productPaths: ['packages/app/runtime.mjs'] },
    verifyFns: { tests: async () => ({ ok: true }) }
  });

  assert.equal(processed.queue.rejected.length, 0);
  assert.equal(processed.queue.merged.length, 1);
  assert.equal(processed.queue.merged[0].canonicalLandingRecord.eligible, true);
  assert.equal(processed.landingEvidence.summary.status, 'green');
});
