import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateCanonicalEntrypoints } from '../canonical-agent-work/architecture.mjs';

export const AGENT_WORK_VERSION = '1.0.0';
export const AGENT_WORK_RELEASE_TAG = 'agent-work-v1.0.0';
export const AGENT_WORK_PHASE9_MATRIX_SCHEMA = 'clawd.agent_work.phase9_surface_matrix.v1';
export const AGENT_WORK_PHASE9_RELEASE_SCHEMA = 'clawd.agent_work.phase9_release_packet.v1';
export const AGENT_WORK_V1_RELEASE_CLAIM = 'Agent Work v1.0.0 is green for private/internal use at production_slice fidelity across the declared four-workload Phase 8 matrix, with the canonical Agent Work CLI and facade, evidence-backed recovery, and bounded aggregate 12-worker qualification.';
export const AGENT_WORK_V1_LIMITATIONS = Object.freeze([
  'This is not a public GA announcement or production deployment.',
  'This is not universal parity, a full clone, or proof of all repository classes.',
  'The corrected six-hour soak proved the aggregate 12-worker tier, but provider call bundling limited observed peak physical concurrency to 2.',
  'Heavy execution remains execution-plane-only; the control plane compiles, supervises, and consumes artifacts.',
  'External actions remain denied by default and require separate approval.',
  'Synthetic Labor OS entrypoints are compatibility-only and are not a second Agent Work product API.'
]);

const REQUIRED_DOCS = Object.freeze([
  'docs/agent-work-v1/OPERATOR_GUIDE.md',
  'docs/agent-work-v1/ARCHITECTURE.md',
  'docs/agent-work-v1/EXTENSIONS.md',
  'docs/agent-work-v1/MIGRATION_AND_ROLLBACK.md',
  'docs/agent-work-v1/RELEASE_NOTES_V1.md',
  'docs/agent-work-v1/PHASE7_OPERATIONS_RUNBOOK.md',
  'docs/agent-work-v1/PHASE8_RELEASE_CANDIDATE_RUNBOOK.md'
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(packet) {
  const copy = { ...packet };
  delete copy.digest;
  return crypto.createHash('sha256').update(JSON.stringify(stable(copy))).digest('hex');
}

function withDigest(packet) {
  return { ...packet, digest: digest(packet) };
}

function check(id, ok, detail, evidence = []) {
  return { id, status: ok ? 'complete' : 'blocked', ok: Boolean(ok), detail: String(detail || ''), evidence: Array.isArray(evidence) ? evidence : [evidence] };
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function verifyReleaseDocumentation({ repoRoot, requiredDocs = REQUIRED_DOCS } = {}) {
  const root = path.resolve(repoRoot || process.cwd());
  const documents = requiredDocs.map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const exists = fs.existsSync(absolutePath);
    const bytes = exists ? fs.statSync(absolutePath).size : 0;
    return { path: relativePath, exists, bytes, ok: exists && bytes >= 200 };
  });
  return {
    ok: documents.every((entry) => entry.ok),
    documents,
    truthBoundary: 'Documentation presence and substance are release gates; documentation does not replace executable qualification evidence.'
  };
}

export function auditAgentWorkV1Routing({ packageJson = {}, architecturePolicy = {}, canonicalExecutionPath = {} } = {}) {
  const expectedCli = 'apps/agent-work/cli.mjs';
  const entrypointAudit = validateCanonicalEntrypoints({ packageJson, policy: architecturePolicy });
  const scripts = packageJson.scripts || {};
  const productScripts = Object.entries(scripts).filter(([name]) => name.startsWith('agent-work:'));
  const bypasses = productScripts
    .filter(([, command]) => !String(command).includes(expectedCli))
    .map(([name, command]) => ({ name, command }));
  const forbiddenTargets = productScripts
    .filter(([, command]) => /run-agent-work-objective-controller|run-transfer-orchestrator-benchmark|run-transfer-benchmark|synthetic-labor-os/.test(String(command)))
    .map(([name, command]) => ({ name, command }));
  const compiler = canonicalExecutionPath.canonicalCompiler;
  const ok = entrypointAudit.ok && bypasses.length === 0 && forbiddenTargets.length === 0 && compiler === expectedCli;
  return {
    schemaVersion: 'clawd.agent_work.phase9_routing_audit.v1',
    ok,
    expectedCli,
    productScriptCount: productScripts.length,
    bypasses,
    forbiddenTargets,
    canonicalCompiler: compiler || null,
    canonicalController: canonicalExecutionPath.canonicalController || null,
    entrypointAudit,
    truthBoundary: 'The public/internal default route must enter through the Agent Work CLI and canonical facade. The objective controller may remain an implementation detail behind that facade.'
  };
}

export function auditLegacyCompatibility({ repoRoot, packageJson = {}, architecturePolicy = {} } = {}) {
  const root = path.resolve(repoRoot || process.cwd());
  const compatibilityPaths = architecturePolicy.compatibilityOnly || [];
  const inspected = compatibilityPaths.map((entry) => ({ path: entry, exists: fs.existsSync(path.join(root, entry)) }));
  const productScripts = Object.entries(packageJson.scripts || {}).filter(([name]) => name.startsWith('agent-work:'));
  const legacyProductTargets = productScripts.filter(([, command]) => /synthetic-labor-os|system-benchmark\/canonical-agent-work/.test(String(command))).map(([name, command]) => ({ name, command }));
  const wrapperPath = path.join(root, 'apps/system-benchmark/canonical-agent-work.mjs');
  const wrapperSource = fs.existsSync(wrapperPath) ? fs.readFileSync(wrapperPath, 'utf8') : '';
  const wrapperDemoted = wrapperSource.includes('Compatibility entrypoint only') && wrapperSource.includes("../agent-work/cli.mjs");
  return {
    schemaVersion: 'clawd.agent_work.phase9_compatibility_audit.v1',
    ok: inspected.every((entry) => entry.exists) && legacyProductTargets.length === 0 && wrapperDemoted,
    compatibilityPaths: inspected,
    legacyProductTargets,
    legacyCliWrapper: { path: 'apps/system-benchmark/canonical-agent-work.mjs', demoted: wrapperDemoted },
    truthBoundary: 'Legacy surfaces may remain available for migration and replay, but they receive no canonical runtime or terminal-truth authority.'
  };
}

export function buildPhase9SurfaceMatrix(input = {}) {
  const phase8 = input.phase8ReleasePacket || {};
  const source = input.sourceIntegrity || {};
  const review = input.independentReview || {};
  const versioning = input.versioning || {};
  const migration = input.migrationRollback || {};
  const external = input.externalActions || {};
  const rows = [
    check('phase8_release_candidate_green', phase8.status === 'green' && phase8.releaseCandidateClaimAllowed === true, phase8.status || 'missing', [input.phase8ReleasePacketPath].filter(Boolean)),
    check('canonical_cli_and_facade', input.routingAudit?.ok === true, input.routingAudit?.ok ? input.routingAudit.expectedCli : 'routing audit red', ['apps/agent-work/cli.mjs', 'packages/canonical-agent-work']),
    check('single_authority_architecture', input.architectureAudit?.ok === true, input.architectureAudit?.ok ? 'authority and architecture policies green' : 'architecture audit red', input.architectureAudit?.evidence || []),
    check('legacy_paths_demoted', input.compatibilityAudit?.ok === true, input.compatibilityAudit?.ok ? 'compatibility-only; zero product-script targets' : 'compatibility audit red', ['config/agent-work-v1/architecture-policy.json']),
    check('migration_and_rollback_rehearsed', migration.ok === true && migration.rollbackTested === true, migration.summary || 'migration/rollback evidence missing', migration.evidence || []),
    check('operator_architecture_extension_docs', input.documentationAudit?.ok === true, input.documentationAudit?.ok ? 'required documentation present' : 'required documentation missing', (input.documentationAudit?.documents || []).filter((entry) => entry.ok).map((entry) => entry.path)),
    check('v1_version_schema_and_tag', versioning.ok === true && versioning.version === AGENT_WORK_VERSION && versioning.tag === AGENT_WORK_RELEASE_TAG, `${versioning.version || 'missing'} / ${versioning.tag || 'missing'}`, versioning.evidence || []),
    check('clean_checkout_qualification', input.cleanCheckout?.ok === true && input.cleanCheckout?.dirty === false, input.cleanCheckout?.summary || 'clean checkout evidence missing', input.cleanCheckout?.evidence || []),
    check('independent_release_review', review.ok === true && review.reviewed === true && review.independent === true, review.summary || 'independent review missing', review.evidence || []),
    check('source_remote_artifact_digest_agreement', source.ok === true && nonempty(source.sourceCommit) && source.sourceCommit === source.remoteCommit && source.sourceCommit === source.artifactSourceDigest, source.summary || 'source integrity evidence missing', source.evidence || []),
    check('exact_claim_and_limitations', input.claimAudit?.ok === true && input.claimAudit?.claim === AGENT_WORK_V1_RELEASE_CLAIM && (input.claimAudit?.limitations || []).length >= AGENT_WORK_V1_LIMITATIONS.length, input.claimAudit?.summary || 'claim audit missing', input.claimAudit?.evidence || []),
    check('no_external_announcement_or_deployment', external.performed === false && external.allowed === false, external.summary || 'external action boundary missing', external.evidence || [])
  ];
  const allComplete = rows.every((row) => row.ok);
  return withDigest({
    schemaVersion: AGENT_WORK_PHASE9_MATRIX_SCHEMA,
    generatedAt: new Date().toISOString(),
    status: allComplete ? 'all_complete' : 'blocked',
    rows,
    completedCount: rows.filter((row) => row.ok).length,
    requiredCount: rows.length,
    truthBoundary: 'Phase 9 is green only when every matrix row is complete. A partial matrix cannot authorize the Agent Work v1 release claim.'
  });
}

export function buildAgentWorkV1ReleasePacket(input = {}) {
  const matrix = input.matrix || buildPhase9SurfaceMatrix(input);
  const green = matrix.status === 'all_complete' && matrix.rows?.every((row) => row.ok);
  const packet = {
    schemaVersion: AGENT_WORK_PHASE9_RELEASE_SCHEMA,
    generatedAt: new Date().toISOString(),
    product: 'Agent Work',
    version: AGENT_WORK_VERSION,
    releaseTag: AGENT_WORK_RELEASE_TAG,
    fidelity: 'production_slice',
    status: green ? 'green' : 'blocked',
    supervisorStatus: green ? 'green' : 'red',
    releaseClaimAllowed: green,
    completionClaimAllowed: green,
    allowedClaims: green ? [AGENT_WORK_V1_RELEASE_CLAIM] : [],
    blockedClaims: [
      'public GA or production deployment',
      'universal parity or full-clone completion',
      '100 simultaneous physical workers',
      'observed 12-way physical concurrency during the six-hour soak'
    ],
    limitations: AGENT_WORK_V1_LIMITATIONS,
    priorPhaseProof: {
      phase8ReleasePacketDigest: input.phase8ReleasePacket?.digest || null,
      phase8Status: input.phase8ReleasePacket?.status || 'missing'
    },
    sourceIntegrity: input.sourceIntegrity || {},
    qualification: {
      workloadClasses: ['shared_stack_self_dogfood', 'ai_os_product_platform', 'clone_parity_slice', 'brownfield_transfer'],
      aggregateWorkerTier: 12,
      correctedSoakMinutes: Number(input.correctedSoak?.durationMinutes || 0),
      correctedSoakWaveCount: Number(input.correctedSoak?.waveCount || 0),
      correctedSoakPeakPhysicalConcurrency: Number(input.correctedSoak?.peakPhysicalConcurrency || 0),
      correctedSoakThresholdPass: input.correctedSoak?.thresholdPass === true,
      observedProviderTokens: Number(input.correctedSoak?.tokensObserved || 0)
    },
    routingAudit: input.routingAudit || {},
    compatibilityAudit: input.compatibilityAudit || {},
    independentReview: input.independentReview || {},
    surfaceMatrix: matrix,
    surfaceMatrixDigest: matrix.digest,
    replayCommands: [
      'npm test',
      'npm run agent-work:doctor -- --json',
      'node --test tests/agent-work-v1-cli.test.mjs tests/agent-work-release-candidate.test.mjs tests/agent-work-v1-release.test.mjs'
    ],
    handoff: green ? {
      canonicalCli: 'apps/agent-work/cli.mjs',
      canonicalFacade: 'packages/canonical-agent-work',
      operatorGuide: 'docs/agent-work-v1/OPERATOR_GUIDE.md',
      migrationAndRollback: 'docs/agent-work-v1/MIGRATION_AND_ROLLBACK.md',
      nextAction: 'Use Agent Work v1 as the default private/internal orchestration path; retain legacy paths for bounded compatibility and rollback only.'
    } : {
      blocker: matrix.rows?.filter((row) => !row.ok).map((row) => row.id) || ['surface_matrix_missing'],
      nextAction: 'Resolve every blocked Phase 9 matrix row and rebuild the release packet.'
    },
    truthBoundary: 'A green packet authorizes only the exact private/internal production_slice claim above. It is not a public announcement, deployment record, universal-parity proof, or physical-concurrency claim beyond observed evidence.'
  };
  return withDigest(packet);
}

export function writeAgentWorkV1ReleaseArtifacts({ outputDir, ...input } = {}) {
  const root = path.resolve(outputDir || 'artifacts/agent-work-v1/phase-9-release');
  fs.mkdirSync(root, { recursive: true });
  const matrix = buildPhase9SurfaceMatrix(input);
  const packet = buildAgentWorkV1ReleasePacket({ ...input, matrix });
  fs.writeFileSync(path.join(root, 'surface_matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'release_packet.json'), `${JSON.stringify(packet, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'completion_summary.json'), `${JSON.stringify({
    schemaVersion: 'clawd.agent_work.phase9_completion_summary.v1',
    generatedAt: packet.generatedAt,
    status: packet.status,
    supervisorStatus: packet.supervisorStatus,
    releaseClaimAllowed: packet.releaseClaimAllowed,
    surfaceMatrixStatus: matrix.status,
    releasePacketDigest: packet.digest,
    blocker: packet.status === 'green' ? null : packet.handoff.blocker,
    nextAction: packet.handoff.nextAction,
    truthBoundary: packet.truthBoundary
  }, null, 2)}\n`);
  return { root, matrix, packet };
}
