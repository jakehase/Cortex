#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_WORK_RELEASE_TAG,
  AGENT_WORK_V1_LIMITATIONS,
  AGENT_WORK_V1_RELEASE_CLAIM,
  AGENT_WORK_VERSION,
  auditAgentWorkV1Routing,
  auditLegacyCompatibility,
  verifyReleaseDocumentation,
  writeAgentWorkV1ReleaseArtifacts
} from '../../packages/canonical-agent-work/index.mjs';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const repoRoot = path.resolve(value('--repo-root') || process.cwd());
const evidencePath = value('--evidence');
const outputDir = path.resolve(value('--out') || path.join(repoRoot, 'artifacts/agent-work-v1/phase-9-release'));
if (!evidencePath) throw new Error('--evidence <phase9-evidence.json> is required');

const evidence = JSON.parse(fs.readFileSync(path.resolve(evidencePath), 'utf8'));
const phase8Path = path.resolve(evidence.phase8ReleasePacketPath);
const phase8ReleasePacket = JSON.parse(fs.readFileSync(phase8Path, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const architecturePolicy = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/agent-work-v1/architecture-policy.json'), 'utf8'));
const canonicalExecutionPath = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/canonical-execution-path.json'), 'utf8'));

const routingAudit = auditAgentWorkV1Routing({ packageJson, architecturePolicy, canonicalExecutionPath });
const compatibilityAudit = auditLegacyCompatibility({ repoRoot, packageJson, architecturePolicy });
const documentationAudit = verifyReleaseDocumentation({ repoRoot });
const versioning = {
  ok: packageJson.version === AGENT_WORK_VERSION && architecturePolicy.releaseVersion === AGENT_WORK_VERSION && architecturePolicy.releaseTag === AGENT_WORK_RELEASE_TAG,
  version: packageJson.version,
  tag: architecturePolicy.releaseTag,
  evidence: ['package.json', 'config/agent-work-v1/architecture-policy.json']
};
const claimAudit = {
  ok: evidence.claimAudit?.ok === true,
  claim: AGENT_WORK_V1_RELEASE_CLAIM,
  limitations: AGENT_WORK_V1_LIMITATIONS,
  summary: evidence.claimAudit?.summary || 'Exact claim and limitations reduced by the Phase 9 release builder.',
  evidence: evidence.claimAudit?.evidence || []
};

const result = writeAgentWorkV1ReleaseArtifacts({
  outputDir,
  ...evidence,
  phase8ReleasePacketPath: phase8Path,
  phase8ReleasePacket,
  routingAudit,
  compatibilityAudit,
  documentationAudit,
  versioning,
  claimAudit
});

console.log(JSON.stringify({
  schemaVersion: 'clawd.agent_work.phase9_release_build_result.v1',
  ok: result.packet.status === 'green',
  status: result.packet.status,
  outputDir: result.root,
  releasePacket: path.join(result.root, 'release_packet.json'),
  surfaceMatrix: path.join(result.root, 'surface_matrix.json'),
  releasePacketDigest: result.packet.digest,
  blocker: result.packet.status === 'green' ? null : result.packet.handoff.blocker
}, null, 2));
process.exitCode = result.packet.status === 'green' ? 0 : 1;
