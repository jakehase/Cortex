import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGENT_WORK_PHASE9_MATRIX_SCHEMA,
  AGENT_WORK_PHASE9_RELEASE_SCHEMA,
  AGENT_WORK_RELEASE_TAG,
  AGENT_WORK_VERSION,
  AGENT_WORK_V1_LIMITATIONS,
  AGENT_WORK_V1_RELEASE_CLAIM,
  auditAgentWorkV1Routing,
  auditLegacyCompatibility,
  buildAgentWorkV1ReleasePacket,
  buildPhase9SurfaceMatrix,
  verifyReleaseDocumentation,
  writeAgentWorkV1ReleaseArtifacts
} from '../packages/canonical-agent-work/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));

function greenInput() {
  const digest = 'a'.repeat(40);
  return {
    phase8ReleasePacketPath: 'phase8/release_packet.json',
    phase8ReleasePacket: { status: 'green', releaseCandidateClaimAllowed: true, digest: 'phase8-digest' },
    routingAudit: { ok: true, expectedCli: 'apps/agent-work/cli.mjs' },
    architectureAudit: { ok: true, evidence: ['authority-matrix.json'] },
    compatibilityAudit: { ok: true },
    migrationRollback: { ok: true, rollbackTested: true, summary: 'new and compatibility paths replayed', evidence: ['migration-test.tap'] },
    documentationAudit: { ok: true, documents: [{ path: 'docs/operator.md', ok: true }] },
    versioning: { ok: true, version: AGENT_WORK_VERSION, tag: AGENT_WORK_RELEASE_TAG, evidence: ['package.json'] },
    cleanCheckout: { ok: true, dirty: false, summary: 'clean checkout passed', evidence: ['clean-checkout.tap'] },
    independentReview: { ok: true, reviewed: true, independent: true, summary: 'independent clean-checkout review green', evidence: ['independent-review.json'] },
    sourceIntegrity: { ok: true, sourceCommit: digest, remoteCommit: digest, artifactSourceDigest: digest, summary: 'digests agree', evidence: ['source-integrity.json'] },
    claimAudit: { ok: true, claim: AGENT_WORK_V1_RELEASE_CLAIM, limitations: AGENT_WORK_V1_LIMITATIONS, summary: 'exact claim accepted', evidence: ['claim-audit.json'] },
    externalActions: { performed: false, allowed: false, summary: 'no announcement or deployment', evidence: [] },
    correctedSoak: { durationMinutes: 361.06, waveCount: 243, peakPhysicalConcurrency: 2, thresholdPass: true, tokensObserved: 1000 }
  };
}

test('Phase 9 declares a stable v1 release identity and bounded exact claim', () => {
  assert.equal(AGENT_WORK_VERSION, '1.0.0');
  assert.equal(AGENT_WORK_RELEASE_TAG, 'agent-work-v1.0.0');
  assert.match(AGENT_WORK_V1_RELEASE_CLAIM, /private\/internal use/);
  assert.match(AGENT_WORK_V1_RELEASE_CLAIM, /production_slice/);
  assert.ok(AGENT_WORK_V1_LIMITATIONS.some((entry) => /peak physical concurrency to 2/.test(entry)));
  assert.ok(AGENT_WORK_V1_LIMITATIONS.some((entry) => /not a public GA/.test(entry)));
});

test('Phase 9 routing and compatibility audits keep one product CLI', () => {
  const packageJson = readJson('package.json');
  const architecturePolicy = readJson('config/agent-work-v1/architecture-policy.json');
  const canonicalExecutionPath = readJson('config/canonical-execution-path.json');
  const routing = auditAgentWorkV1Routing({ packageJson, architecturePolicy, canonicalExecutionPath });
  assert.equal(routing.ok, true, JSON.stringify(routing, null, 2));
  assert.equal(routing.expectedCli, 'apps/agent-work/cli.mjs');
  assert.equal(routing.bypasses.length, 0);
  assert.equal(routing.forbiddenTargets.length, 0);

  const compatibility = auditLegacyCompatibility({ repoRoot: root, packageJson, architecturePolicy });
  assert.equal(compatibility.ok, true, JSON.stringify(compatibility, null, 2));
  assert.equal(compatibility.legacyProductTargets.length, 0);
  assert.equal(compatibility.legacyCliWrapper.demoted, true);
});

test('Phase 9 requires substantive operator, architecture, extension, migration, and release docs', () => {
  const audit = verifyReleaseDocumentation({ repoRoot: root });
  assert.equal(audit.ok, true, JSON.stringify(audit, null, 2));
  assert.equal(audit.documents.every((entry) => entry.bytes >= 200), true);
});

test('Phase 9 matrix fails closed when release integrity evidence is absent', () => {
  const matrix = buildPhase9SurfaceMatrix({ phase8ReleasePacket: { status: 'green', releaseCandidateClaimAllowed: true } });
  assert.equal(matrix.schemaVersion, AGENT_WORK_PHASE9_MATRIX_SCHEMA);
  assert.equal(matrix.status, 'blocked');
  assert.ok(matrix.rows.some((row) => row.id === 'source_remote_artifact_digest_agreement' && row.ok === false));
  const packet = buildAgentWorkV1ReleasePacket({ matrix });
  assert.equal(packet.schemaVersion, AGENT_WORK_PHASE9_RELEASE_SCHEMA);
  assert.equal(packet.status, 'blocked');
  assert.equal(packet.releaseClaimAllowed, false);
  assert.deepEqual(packet.allowedClaims, []);
});

test('Phase 9 release packet is green only when all matrix rows are complete', () => {
  const input = greenInput();
  const matrix = buildPhase9SurfaceMatrix(input);
  assert.equal(matrix.status, 'all_complete', JSON.stringify(matrix, null, 2));
  assert.equal(matrix.completedCount, matrix.requiredCount);
  const packet = buildAgentWorkV1ReleasePacket({ ...input, matrix });
  assert.equal(packet.status, 'green');
  assert.equal(packet.supervisorStatus, 'green');
  assert.equal(packet.releaseClaimAllowed, true);
  assert.deepEqual(packet.allowedClaims, [AGENT_WORK_V1_RELEASE_CLAIM]);
  assert.equal(packet.qualification.correctedSoakPeakPhysicalConcurrency, 2);
  assert.ok(packet.blockedClaims.includes('observed 12-way physical concurrency during the six-hour soak'));
  assert.equal(packet.sourceIntegrity.sourceCommit, packet.sourceIntegrity.remoteCommit);
});

test('Phase 9 writes a matrix-derived release packet and completion summary', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-v1-release-'));
  const result = writeAgentWorkV1ReleaseArtifacts({ outputDir, ...greenInput() });
  assert.equal(result.packet.status, 'green');
  for (const file of ['surface_matrix.json', 'release_packet.json', 'completion_summary.json']) {
    assert.equal(fs.existsSync(path.join(outputDir, file)), true, file);
  }
  const summary = JSON.parse(fs.readFileSync(path.join(outputDir, 'completion_summary.json'), 'utf8'));
  assert.equal(summary.surfaceMatrixStatus, 'all_complete');
  assert.equal(summary.supervisorStatus, 'green');
  assert.equal(summary.releasePacketDigest, result.packet.digest);
});
