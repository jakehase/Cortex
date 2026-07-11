#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v11.release_bundle_summary';
const MANIFEST_SCHEMA = 'claw.synthetic_labor_os.v11.release_bundle_manifest';

function parseArgs(argv) {
  const args = {
    artifactRoot: 'artifacts/synthetic-labor-os-v11/latest',
    repoRoot: process.cwd(),
    v10SummaryPath: 'artifacts/synthetic-labor-os-v10/latest/v10_scale_smoke_summary.json'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--v10-summary') { args.v10SummaryPath = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v11-release-bundle.mjs [--artifact-root ROOT] [--v10-summary PATH]');
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

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256FileIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return sha256Buffer(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

function fileInfo(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return { exists: false, sizeBytes: null, sha256: null };
    const stat = fs.statSync(filePath);
    return { exists: true, sizeBytes: stat.size, sha256: sha256FileIfExists(filePath) };
  } catch {
    return { exists: false, sizeBytes: null, sha256: null };
  }
}

function safeName(value = '') {
  return String(value || 'artifact').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'artifact';
}

function pushArtifact(artifacts, label, filePath, required = true) {
  if (!filePath) {
    artifacts.push({ label, sourcePath: null, required, missingReason: 'path_not_provided' });
    return;
  }
  const resolved = path.resolve(filePath);
  if (artifacts.some((entry) => entry.sourcePath === resolved)) return;
  const info = fileInfo(resolved);
  artifacts.push({ label, sourcePath: resolved, required, ...info });
}

function copyArtifact(entry, index, bundleFilesDir) {
  if (!entry.exists) return { ...entry, bundledPath: null, copied: false };
  const ext = path.extname(entry.sourcePath);
  const basename = safeName(path.basename(entry.sourcePath, ext));
  const target = path.join(bundleFilesDir, `${String(index + 1).padStart(3, '0')}-${safeName(entry.label)}-${basename}${ext}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(entry.sourcePath, target);
  const copiedInfo = fileInfo(target);
  return {
    ...entry,
    bundledPath: target,
    bundledRelativePath: path.relative(path.dirname(bundleFilesDir), target),
    copied: copiedInfo.exists && copiedInfo.sha256 === entry.sha256,
    copiedSha256: copiedInfo.sha256,
    copiedSizeBytes: copiedInfo.sizeBytes
  };
}

function schemaOf(filePath) {
  if (!filePath || !filePath.endsWith('.json')) return null;
  return readJson(filePath, {})?.schemaVersion || null;
}

function okOf(filePath) {
  if (!filePath || !filePath.endsWith('.json')) return null;
  const json = readJson(filePath, null);
  if (!json || typeof json !== 'object') return null;
  if (typeof json.ok === 'boolean') return json.ok;
  if (typeof json.finishedClaimAllowed === 'boolean') return json.finishedClaimAllowed;
  if (typeof json.finishedForBoundedV10Sequence === 'boolean') return json.finishedForBoundedV10Sequence;
  return null;
}

function renderReadme(manifest) {
  const lines = [];
  lines.push('# Synthetic Labor OS v11 Release Bundle');
  lines.push('');
  lines.push(`Generated: ${manifest.generatedAt}`);
  lines.push(`Status: ${manifest.ok ? 'green' : 'blocked'}`);
  lines.push(`Bundle id: ${manifest.bundleId}`);
  lines.push('');
  lines.push('## What this bundle proves');
  lines.push('');
  lines.push('- v10 finished gate was green for the bounded SLOS v0/v10 productization sequence.');
  lines.push('- v8/v9 embedded reports are included.');
  lines.push('- v6/v7 lineage and hardening proofs are included when discoverable from the trace.');
  lines.push('- Checksums are recorded for every copied artifact.');
  lines.push('');
  lines.push('## Replay commands');
  lines.push('');
  for (const command of manifest.replayCommands) lines.push(`- \`${command}\``);
  lines.push('');
  lines.push('## Included artifacts');
  lines.push('');
  for (const artifact of manifest.artifacts) {
    lines.push(`- ${artifact.label}: ${artifact.bundledRelativePath || artifact.sourcePath || 'missing'}${artifact.sha256 ? ` (${artifact.sha256})` : ''}`);
  }
  lines.push('');
  lines.push(`Truth boundary: ${manifest.truthBoundary}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const repoRoot = path.resolve(args.repoRoot);
  const artifactRoot = path.resolve(args.artifactRoot);
  const bundleRoot = path.join(artifactRoot, 'release_bundle');
  const bundleFilesDir = path.join(bundleRoot, 'files');
  const v10SummaryPath = path.resolve(args.v10SummaryPath);
  const v10Summary = readJson(v10SummaryPath, null);
  const v10ProofPath = v10Summary?.proofPath ? path.resolve(v10Summary.proofPath) : null;
  const v10Proof = readJson(v10ProofPath, null);
  const v8SummaryPath = v10Summary?.v8SummaryPath || v10Proof?.gates?.v8E2eDemo?.summaryPath || null;
  const v8Summary = readJson(v8SummaryPath, null);
  const v8TracePath = v10Proof?.gates?.v8E2eDemo?.tracePath || v8Summary?.tracePath || null;
  const v8Trace = readJson(v8TracePath, null);
  const v9SummaryPath = v10Summary?.v9SummaryPath || v10Proof?.gates?.v9FinishedClaimReport?.summaryPath || null;
  const v9Summary = readJson(v9SummaryPath, null);
  const v9ReportPath = v10Proof?.gates?.v9FinishedClaimReport?.reportPath || v9Summary?.reportPath || null;
  const v9MarkdownPath = v10Proof?.gates?.v9FinishedClaimReport?.markdownPath || v9Summary?.markdownPath || null;

  const artifacts = [];
  pushArtifact(artifacts, 'v10-summary', v10SummaryPath);
  pushArtifact(artifacts, 'v10-proof', v10ProofPath);
  pushArtifact(artifacts, 'v8-summary', v8SummaryPath);
  pushArtifact(artifacts, 'v8-trace', v8TracePath);
  pushArtifact(artifacts, 'v9-summary', v9SummaryPath);
  pushArtifact(artifacts, 'v9-report', v9ReportPath);
  pushArtifact(artifacts, 'v9-markdown', v9MarkdownPath);
  pushArtifact(artifacts, 'v6-summary-from-v8', v8Summary?.v6SummaryPath || v8Trace?.embeddedRuns?.v6?.summaryPath || null, false);
  pushArtifact(artifacts, 'v6-chain-from-v8', v8Summary?.v6ChainPath || v8Trace?.embeddedRuns?.v6?.chainPath || null, false);
  pushArtifact(artifacts, 'v7-summary-from-v8', v8Summary?.v7SummaryPath || v8Trace?.embeddedRuns?.v7?.summaryPath || null, false);
  pushArtifact(artifacts, 'v7-proof-from-v8', v8Summary?.v7ProofPath || v8Trace?.embeddedRuns?.v7?.proofPath || null, false);
  for (const [index, run] of (v10Proof?.gates?.smokeCommands || []).entries()) {
    pushArtifact(artifacts, `v10-smoke-${index + 1}-log`, run.logPath, false);
  }

  const v6Chain = readJson(v8Summary?.v6ChainPath || v8Trace?.embeddedRuns?.v6?.chainPath || null, null);
  for (const [label, artifact] of Object.entries(v6Chain?.artifacts || {})) {
    pushArtifact(artifacts, `v6-source-${label}`, artifact?.path, false);
  }

  const copiedArtifacts = artifacts.map((entry, index) => ({
    ...copyArtifact(entry, index, bundleFilesDir),
    schemaVersion: schemaOf(entry.sourcePath),
    artifactOk: okOf(entry.sourcePath)
  }));
  const missingRequired = copiedArtifacts.filter((entry) => entry.required && !entry.exists).map((entry) => entry.label);
  const copyFailures = copiedArtifacts.filter((entry) => entry.exists && !entry.copied).map((entry) => entry.label);
  const redRequiredArtifacts = copiedArtifacts
    .filter((entry) => entry.required && entry.artifactOk === false)
    .map((entry) => entry.label);
  const failures = [];
  if (v10Summary?.ok !== true || v10Summary?.finishedForBoundedV10Sequence !== true) failures.push('v10_summary_not_green');
  if (v10Proof?.ok !== true || v10Proof?.finishedForBoundedV10Sequence !== true) failures.push('v10_proof_not_green');
  if (v8Summary?.ok !== true) failures.push('v8_summary_not_green');
  if (v9Summary?.ok !== true || v9Summary?.finishedClaimAllowed !== true) failures.push('v9_summary_not_green');
  for (const label of missingRequired) failures.push(`missing_required_artifact:${label}`);
  for (const label of copyFailures) failures.push(`copy_sha_mismatch:${label}`);
  for (const label of redRequiredArtifacts) failures.push(`required_artifact_red:${label}`);

  const ok = failures.length === 0;
  const bundleId = `slos-v11-release-${generatedAt.replace(/[^0-9A-Za-z]/g, '')}`;
  const replayCommands = [
    'npm run ops:synthetic-labor-os:v10-scale-smoke',
    'npm run ops:synthetic-labor-os:v11-release-bundle',
    'node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'
  ];
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    generatedAt,
    bundleId,
    ok,
    status: ok ? 'green_release_bundle' : 'blocked',
    repoRoot,
    bundleRoot,
    artifacts: copiedArtifacts,
    artifactCount: copiedArtifacts.length,
    copiedArtifactCount: copiedArtifacts.filter((entry) => entry.copied).length,
    replayCommands,
    failures,
    blocker: ok ? null : { blockerKind: 'v11_release_bundle_failed', blocker: `v11 release bundle failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v11 packages the green v10 bounded SLOS evidence into an internal release/handoff bundle. It does not merge, publish, deploy, send externally, or expand the v10 product claim.'
      : 'v11 is blocked; do not treat the release bundle as trustworthy until required artifacts copy cleanly and upstream gates are green.'
  };
  const manifestPath = writeJson(path.join(bundleRoot, 'release_manifest.json'), manifest);
  const checksums = copiedArtifacts
    .filter((entry) => entry.copied && entry.bundledRelativePath)
    .map((entry) => `${entry.sha256}  ${entry.bundledRelativePath}`)
    .sort()
    .join('\n');
  fs.writeFileSync(path.join(bundleRoot, 'SHA256SUMS'), `${checksums}\n`);
  const readmePath = path.join(bundleRoot, 'README.md');
  fs.writeFileSync(readmePath, renderReadme(manifest));
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt,
    ok,
    status: manifest.status,
    bundleId,
    manifestPath,
    readmePath,
    checksumsPath: path.join(bundleRoot, 'SHA256SUMS'),
    artifactCount: manifest.artifactCount,
    copiedArtifactCount: manifest.copiedArtifactCount,
    blocker: manifest.blocker,
    truthBoundary: manifest.truthBoundary
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v11_release_bundle_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
