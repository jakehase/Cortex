import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createLearningLedger,
  extractPostRunHardeningArtifacts,
  promoteLearningFromRun,
  retrieveLearningPatterns,
  upsertLearningArtifact,
  writeLearningLedger
} from '../packages/orchestration-learning-ledger/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);

test('orchestration learning ledger stores Agent Work pattern fragments and retrieves by assigned file', () => {
  let ledger = createLearningLedger({ project: 'mailchimp-learning' });
  ledger = upsertLearningArtifact(ledger, {
    kind: 'architecture_pattern',
    title: 'Audience route delegates through domain model',
    trust: 'trusted',
    files: ['packages/app/routes/audience.mjs', 'packages/app/domain-audience.mjs'],
    verifiers: ['node --test tests/audience-core.test.mjs'],
    layers: ['route', 'domain'],
    routeNamespaces: ['/audience'],
    agentWork: `template audience_route_domain
  files: packages/app/routes/audience.mjs, packages/app/domain-audience.mjs
  verify: node --test tests/audience-core.test.mjs
  lane: audience

evidence audience_quality
  require: architectureFitnessScore >= 0.90`
  });
  ledger = upsertLearningArtifact(ledger, {
    kind: 'anti_pattern',
    title: 'Avoid duplicate route registration',
    trust: 'trusted',
    files: ['packages/app/routes/audience.mjs'],
    summary: 'Do not register duplicate audience routes; extend the existing namespace.'
  });

  const result = retrieveLearningPatterns({
    ledger,
    query: { files: ['packages/app/routes/audience.mjs'], lane: 'audience', routeNamespaces: ['/audience'] },
    limit: 2
  });

  assert.equal(result.schemaVersion, 'clawd.orchestration_learning_context.v1');
  assert.equal(result.architecturePatterns.length, 1);
  assert.equal(result.architecturePatterns[0].trust, 'trusted');
  assert.equal(result.architecturePatterns[0].agentWorkLanguage.parseOk, true);
  assert.match(result.architecturePatterns[0].agentWorkLanguage.source, /template audience_route_domain/);
  assert.equal(result.antiPatterns[0].kind, 'anti_pattern');
  assert.match(result.retrievalDigest, /^[a-f0-9]{64}$/);
});

test('orchestration learning promotion trusts architecture patterns only when quality gate passes', () => {
  const patchQueue = {
    merged: [{
      id: 'patch-audience',
      shardId: 'audience_slice',
      filePaths: ['packages/app/routes/audience.mjs', 'packages/app/domain-audience.mjs'],
      metadata: {
        implementation: {
          modifiedFiles: ['packages/app/routes/audience.mjs'],
          metadata: {
            architectureEvidence: {
              ok: true,
              layerCount: 2,
              runtimeIntegrated: true,
              modifiedPrimaryRuntimeFiles: ['packages/app/routes/audience.mjs'],
              modifiedRequiredLayers: ['route', 'domain'],
              semanticBloatAudit: { semanticBloatSuspect: false }
            }
          }
        }
      }
    }],
    rejected: [{ id: 'patch-bad', shardId: 'bad_slice', reason: 'duplicate_route_registration', filePaths: ['packages/app/routes/audience.mjs'] }]
  };

  const candidate = promoteLearningFromRun({ ledger: createLearningLedger({ project: 'x' }), patchQueue, productionQualityGate: { ok: false } });
  assert.equal(candidate.artifacts.find((entry) => entry.kind === 'architecture_pattern').trust, 'candidate');

  const trusted = promoteLearningFromRun({ ledger: createLearningLedger({ project: 'x' }), patchQueue, productionQualityGate: { ok: true } });
  assert.equal(trusted.artifacts.find((entry) => entry.kind === 'architecture_pattern').trust, 'trusted');
  assert.equal(trusted.artifacts.some((entry) => entry.kind === 'anti_pattern'), true);
  assert.equal(trusted.ledger.architecturePatterns.length, 1);
  assert.equal(trusted.ledger.antiPatterns.length, 1);
});

test('orchestration learning promotion captures validated post-run hardening reports', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestration-postrun-learning-'));
  const hardeningDir = path.join(temp, 'postrun_hardened_winner');
  fs.mkdirSync(hardeningDir, { recursive: true });
  fs.writeFileSync(path.join(temp, 'winner_postrun_audit.md'), `# Winner post-run audit

The audit found that replaying a still-pending event left \`stats().pending\` inflated because the implementation exposed raw queue length.
`);
  fs.writeFileSync(path.join(hardeningDir, 'postrun_hardening_report.md'), `# Post-run hardened winner — candidate_03

This artifact is a post-run hardening bundle.

File: \`workspace/apps/webhook-real-codex/candidate_03/src/service.mjs\`

Changed \`stats().pending\` from raw FIFO queue size to record-status pending count.

## Validation run

- \`node --test tests/webhook-real-codex/candidate_03.test.mjs\` — pass
`);
  fs.writeFileSync(path.join(hardeningDir, 'postrun_hardening.diff'), `--- /tmp/original/review_bundle/winner/apps/webhook-real-codex/candidate_03/src/service.mjs
+++ ${path.join(temp, 'postrun_hardened_winner/workspace/apps/webhook-real-codex/candidate_03/src/service.mjs')}
@@
-      pending: queue.size(),
+      pending: byStatus[STATUSES.pending] ?? 0,
--- /tmp/original/review_bundle/winner/tests/webhook-real-codex/candidate_03.test.mjs
+++ ${path.join(temp, 'postrun_hardened_winner/workspace/tests/webhook-real-codex/candidate_03.test.mjs')}
@@
+  assert.equal(app.stats().pending, 0);
`);

  const extracted = extractPostRunHardeningArtifacts({ runRoot: temp, project: 'showcase' });
  assert.equal(extracted.some((artifact) => artifact.kind === 'repair_strategy'), true);
  assert.equal(extracted.some((artifact) => artifact.kind === 'anti_pattern'), true);
  assert.equal(extracted.every((artifact) => artifact.trust === 'trusted'), true);
  assert.equal(extracted.some((artifact) => artifact.files.includes('apps/webhook-real-codex/candidate_03/src/service.mjs')), true);
  assert.equal(extracted.some((artifact) => artifact.files.includes('tests/webhook-real-codex/candidate_03.test.mjs')), true);
  assert.equal(extracted.some((artifact) => artifact.files.some((file) => file.startsWith('node '))), false);
  assert.match(extracted.find((artifact) => artifact.kind === 'repair_strategy').agentWorkLanguage.source, /postRunAuditFindingAddressed/);

  const promoted = promoteLearningFromRun({ ledger: createLearningLedger({ project: 'showcase' }), runRoot: temp, project: 'showcase' });
  assert.equal(promoted.ledger.repairStrategies.length, 1);
  assert.equal(promoted.ledger.antiPatterns.length, 1);

  const retrieved = retrieveLearningPatterns({
    ledger: promoted.ledger,
    query: { files: ['apps/webhook-real-codex/candidate_99/src/service.mjs'], lane: 'postrun_hardening' },
    limit: 3
  });
  assert.equal(retrieved.repairStrategies.length, 1);
  assert.equal(retrieved.antiPatterns.length, 1);
});

test('orchestration learning ledger CLI can add and retrieve Agent Work patterns', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestration-learning-ledger-'));
  const ledgerPath = path.join(temp, 'ledger.json');
  const fragmentPath = path.join(temp, 'pattern.aw');
  fs.writeFileSync(fragmentPath, `template route_domain_pattern
  files: packages/app/routes/campaigns.mjs
  lane: campaigns

evidence route_domain_quality
  require: architectureFitnessScore >= 0.90
`);

  const cli = path.join(root, 'apps/system-benchmark/orchestration-learning-ledger.mjs');
  let run = spawnSync(process.execPath, [cli, 'init', '--ledger', ledgerPath, '--project', 'cli-learning'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  run = spawnSync(process.execPath, [cli, 'add', '--ledger', ledgerPath, '--kind', 'architecture_pattern', '--title', 'Campaign route-domain', '--files', 'packages/app/routes/campaigns.mjs', '--agent-work', fragmentPath], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  run = spawnSync(process.execPath, [cli, 'retrieve', '--ledger', ledgerPath, '--files', 'packages/app/routes/campaigns.mjs', '--lane', 'campaigns'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.result.architecturePatterns[0].title, 'Campaign route-domain');
  assert.equal(payload.result.agentWorkLanguageFragments[0].parseOk, true);

  writeLearningLedger(ledgerPath, createLearningLedger({ project: 'reset-proof' }));
  assert.equal(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).project, 'reset-proof');
});
