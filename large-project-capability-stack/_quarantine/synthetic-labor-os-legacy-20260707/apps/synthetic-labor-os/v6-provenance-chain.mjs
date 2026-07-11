#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROVENANCE_CHAIN_SCHEMA = 'claw.synthetic_labor_os.v6.provenance_chain';

function parseArgs(argv) {
  const args = {
    artifactRoot: 'artifacts/synthetic-labor-os-v6/latest',
    repoRoot: process.cwd(),
    v4SummaryPath: 'artifacts/synthetic-labor-os-v4/latest/v4_remote_patch_pilot_summary.json',
    v5SummaryPath: 'artifacts/synthetic-labor-os-v5/latest/v5_apply_pilot_summary.json',
    format: 'json'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--v4-summary') { args.v4SummaryPath = next; index += 1; continue; }
    if (token === '--v5-summary') { args.v5SummaryPath = next; index += 1; continue; }
    if (token === '--format') { args.format = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log(`usage:
  node apps/synthetic-labor-os/v6-provenance-chain.mjs [--artifact-root ROOT] [--v4-summary PATH] [--v5-summary PATH]

Builds and verifies a machine-readable provenance chain linking remote patch proposal, approval, apply, and validation proof. It does not merge, publish, deploy, or send externally.`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function sha256FileIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function stableList(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').trim()).filter(Boolean)));
}

function sameSet(a = [], b = []) {
  const aa = stableList(a).sort();
  const bb = stableList(b).sort();
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}

function relOrNull(repoRoot, filePath) {
  if (!filePath) return null;
  const relative = path.relative(repoRoot, filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}

function renderMarkdown(chain = {}) {
  const lines = [];
  lines.push(`# Synthetic Labor OS v6 Provenance Chain`);
  lines.push('');
  lines.push(`- Status: ${chain.ok ? 'green' : 'blocked'}`);
  lines.push(`- Chain id: ${chain.chainId}`);
  lines.push(`- Patch SHA256: ${chain.patch?.sha256 || 'unknown'}`);
  lines.push(`- Target files: ${(chain.patch?.targetFiles || []).join(', ') || 'none'}`);
  lines.push(`- Proposal review-ready: ${chain.links?.proposal?.ok === true}`);
  lines.push(`- Approval verified: ${chain.links?.approval?.ok === true}`);
  lines.push(`- Apply verified: ${chain.links?.apply?.ok === true}`);
  lines.push(`- Validation verified: ${chain.links?.validation?.ok === true}`);
  lines.push(`- Blocker: ${chain.blocker?.blocker || 'none'}`);
  lines.push('');
  lines.push(`Truth boundary: ${chain.truthBoundary}`);
  lines.push('');
  lines.push('## Artifacts');
  for (const [name, artifact] of Object.entries(chain.artifacts || {})) {
    lines.push(`- ${name}: ${artifact?.path || 'missing'}${artifact?.sha256 ? ` (${artifact.sha256})` : ''}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildProvenanceChain(input = {}) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const repoRoot = path.resolve(input.repoRoot || process.cwd());
  const v4SummaryPath = path.resolve(input.v4SummaryPath);
  const v5SummaryPath = path.resolve(input.v5SummaryPath);
  const v4Summary = readJson(v4SummaryPath, null);
  const v5Summary = readJson(v5SummaryPath, null);
  const v4ProofPath = v4Summary?.returnedPatchProofPath ? path.resolve(v4Summary.returnedPatchProofPath) : null;
  const v5ProofPath = v5Summary?.proofPath ? path.resolve(v5Summary.proofPath) : null;
  const v4Proof = readJson(v4ProofPath, null);
  const v5Proof = readJson(v5ProofPath, null);
  const approvalPath = v5Summary?.approvalPath ? path.resolve(v5Summary.approvalPath) : null;
  const approval = readJson(approvalPath, null);
  const patchPath = v5Summary?.patchPath ? path.resolve(v5Summary.patchPath) : (v4Proof?.patchProposal?.path ? path.resolve(v4Proof.patchProposal.path) : null);
  const patchSha = sha256FileIfExists(patchPath);
  const failures = [];

  if (!v4Summary) failures.push('missing_v4_summary');
  if (!v5Summary) failures.push('missing_v5_summary');
  if (!v4Proof) failures.push('missing_v4_patch_proposal_proof');
  if (!v5Proof) failures.push('missing_v5_apply_gate_proof');
  if (!approval) failures.push('missing_v5_approval');
  if (!patchPath || !patchSha) failures.push('missing_patch_file');

  const proposalOk = v4Summary?.ok === true
    && v4Summary?.reviewReady === true
    && v4Summary?.patchApplied === false
    && v4Proof?.ok === true
    && v4Proof?.reviewReady === true
    && v4Proof?.patchApplied === false
    && v4Proof?.patchVerification?.gitApplyCheck?.ok === true;
  if (!proposalOk) failures.push('proposal_link_not_green');

  const v4PatchSha = v4Proof?.patchProposal?.sha256 || sha256FileIfExists(v4Proof?.patchProposal?.path || null);
  const v5PatchSha = v5Summary?.patchSha256 || v5Proof?.patch?.sha256 || null;
  if (patchSha && v4PatchSha && patchSha !== v4PatchSha) failures.push('patch_sha_mismatch_v4');
  if (patchSha && v5PatchSha && patchSha !== v5PatchSha) failures.push('patch_sha_mismatch_v5');

  const proposalTargets = stableList(v4Summary?.targetFiles || v4Proof?.patchProposal?.targetFiles || []);
  const applyDiffPaths = stableList(v5Proof?.patch?.diffPaths || []);
  const changedTargets = stableList(v5Proof?.targetSnapshots?.changedTargets || []);
  if (!sameSet(proposalTargets, applyDiffPaths)) failures.push('proposal_targets_do_not_match_apply_diff_paths');
  if (!sameSet(applyDiffPaths, changedTargets)) failures.push('apply_changed_targets_do_not_match_diff_paths');

  const approvalOk = approval?.approved === true
    && Boolean(approval?.actor)
    && Boolean(approval?.approvedAt)
    && (!approval?.patchSha256 || approval.patchSha256 === patchSha)
    && v5Proof?.approval?.verification?.ok === true;
  if (!approvalOk) failures.push('approval_link_not_green');

  const applyOk = v5Summary?.ok === true
    && v5Summary?.patchApplied === true
    && v5Summary?.implementationClaimAllowedForApprovedPatch === true
    && v5Proof?.ok === true
    && v5Proof?.patchApplied === true
    && v5Proof?.implementationClaimAllowedForApprovedPatch === true
    && v5Proof?.gates?.gitApplyCheck?.ok === true
    && v5Proof?.gates?.gitApply?.ok === true;
  if (!applyOk) failures.push('apply_link_not_green');

  const validationRuns = Array.isArray(v5Proof?.gates?.validationRuns) ? v5Proof.gates.validationRuns : [];
  const validationOk = validationRuns.length > 0 && validationRuns.every((run) => run.ok === true && run.exitCode === 0);
  if (!validationOk) failures.push('validation_link_not_green');

  const prohibited = stableList(approval?.prohibitedActions || []);
  for (const action of ['merge', 'publish', 'deploy', 'external_send']) {
    if (!prohibited.includes(action)) failures.push(`approval_missing_prohibited_action:${action}`);
  }

  const ok = failures.length === 0;
  const chainId = input.chainId || `slos-v6-provenance-${String(generatedAt).replace(/[^0-9A-Za-z]/g, '')}`;
  const artifacts = {
    v4Summary: { path: v4SummaryPath, sha256: sha256FileIfExists(v4SummaryPath) },
    v4PatchProof: { path: v4ProofPath, sha256: sha256FileIfExists(v4ProofPath) },
    patch: { path: patchPath, sha256: patchSha },
    v5Approval: { path: approvalPath, sha256: sha256FileIfExists(approvalPath) },
    v5Summary: { path: v5SummaryPath, sha256: sha256FileIfExists(v5SummaryPath) },
    v5ApplyProof: { path: v5ProofPath, sha256: sha256FileIfExists(v5ProofPath) }
  };

  return {
    schemaVersion: PROVENANCE_CHAIN_SCHEMA,
    generatedAt,
    chainId,
    ok,
    status: ok ? 'green_for_approved_patch_chain' : 'blocked',
    repoRoot,
    patch: {
      path: patchPath,
      relativePath: relOrNull(repoRoot, patchPath),
      sha256: patchSha,
      targetFiles: proposalTargets,
      changedTargets
    },
    links: {
      proposal: {
        ok: proposalOk,
        reviewReady: v4Summary?.reviewReady === true,
        patchAppliedAtProposalStage: v4Summary?.patchApplied === true,
        codexVersion: v4Summary?.codexVersion || v4Proof?.codex?.version || null,
        remoteHost: v4Summary?.remoteHost || null,
        proofPath: v4ProofPath
      },
      approval: {
        ok: approvalOk,
        actor: approval?.actor || null,
        approvedAt: approval?.approvedAt || null,
        approvalId: approval?.approvalId || null,
        approvedTargets: stableList(approval?.approvedTargets || []),
        prohibitedActions: prohibited,
        proofPath: approvalPath
      },
      apply: {
        ok: applyOk,
        patchApplied: v5Summary?.patchApplied === true,
        changedTargets,
        gitApplyContext: v5Proof?.gitApplyContext || null,
        proofPath: v5ProofPath
      },
      validation: {
        ok: validationOk,
        validationRuns: validationRuns.map((run) => ({
          command: run.command,
          ok: run.ok,
          exitCode: run.exitCode,
          durationMs: run.durationMs,
          logPath: run.logPath || null
        }))
      }
    },
    artifacts,
    failures,
    blocker: ok ? null : { blockerKind: 'provenance_chain_failed', blocker: `Provenance chain failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'This chain proves one remote Codex patch proposal was reviewed, explicitly approved, applied to the local worktree, and validated. It is not a merge, publish, deploy, external send, broad-scale orchestration claim, or full product-completeness claim.'
      : 'Provenance chain is red; do not claim the applied patch is legitimate until every proposal, approval, apply, and validation link is green.'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.repoRoot);
  const artifactRoot = path.resolve(args.artifactRoot);
  const chain = buildProvenanceChain({
    repoRoot,
    v4SummaryPath: path.resolve(args.v4SummaryPath),
    v5SummaryPath: path.resolve(args.v5SummaryPath)
  });
  const chainPath = writeJson(path.join(artifactRoot, 'v6_provenance_chain.json'), chain);
  const markdownPath = path.join(artifactRoot, 'v6_provenance_chain.md');
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(markdownPath, renderMarkdown(chain));
  const summary = {
    schemaVersion: 'claw.synthetic_labor_os.v6.provenance_chain_summary',
    generatedAt: chain.generatedAt,
    ok: chain.ok,
    status: chain.status,
    chainId: chain.chainId,
    chainPath,
    markdownPath,
    patchSha256: chain.patch.sha256,
    targetFiles: chain.patch.targetFiles,
    changedTargets: chain.patch.changedTargets,
    proposalOk: chain.links.proposal.ok,
    approvalOk: chain.links.approval.ok,
    applyOk: chain.links.apply.ok,
    validationOk: chain.links.validation.ok,
    blocker: chain.blocker,
    truthBoundary: chain.truthBoundary
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v6_provenance_chain_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!chain.ok) process.exitCode = 1;
}

export { buildProvenanceChain, renderMarkdown };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
