#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildReleasePacket,
  buildRunLedger,
  createArtifactBundleManifest,
  renderReleasePacketMarkdown,
  verifyArtifactBundleManifest
} from '../../packages/synthetic-labor-os/index.mjs';

const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v19.release_packet_summary';

function parseArgs(argv) {
  const args = {
    artifactRoot: 'artifacts/synthetic-labor-os-v19/latest',
    repoRoot: process.cwd(),
    v18SummaryPath: 'artifacts/synthetic-labor-os-v18/latest/v18_whole_os_tournament_summary.json'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--v18-summary' || token === '--run-summary') { args.v18SummaryPath = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v19-release-packet.mjs [--artifact-root ROOT] [--v18-summary PATH]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function safeName(value = '') {
  return String(value || 'artifact')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'artifact';
}

function relFrom(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function copyEvidence(entry, index, evidenceDir, artifactRoot) {
  if (!entry.exists || !entry.isFile || !entry.path) {
    return { ...entry, copied: false, copiedPath: null, copiedRelativePath: null, copiedSha256: null };
  }
  const ext = path.extname(entry.path);
  const base = safeName(path.basename(entry.path, ext));
  const target = path.join(evidenceDir, `${String(index + 1).padStart(3, '0')}-${safeName(entry.label)}-${base}${ext}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(entry.path, target);
  const copiedSha256 = sha256File(target);
  return {
    ...entry,
    copied: copiedSha256 === entry.sha256,
    copiedPath: target,
    copiedRelativePath: relFrom(artifactRoot, target),
    copiedSha256
  };
}

function runPriorArtGate({ repoRoot, artifactRoot, generatedAt }) {
  const scriptPath = path.resolve(repoRoot, '..', 'public/cortex_server/scripts/prior_art_gate.py');
  const outputPath = path.join(artifactRoot, 'prior_art_gate.json');
  const objective = 'Implement SLOS v19 run ledger / release packet as an adapter over existing Cortex and SLOS truth-ledger primitives.';
  if (!fs.existsSync(scriptPath)) {
    const blocked = {
      schemaVersion: 'cortex.memory.prior_art_gate.v1',
      generatedAt,
      ok: false,
      status: 'blocked',
      objective,
      proposedAction: 'adapter_wrapper_only',
      decision: 'prior_art_gate_unavailable',
      failures: ['prior_art_gate_script_missing'],
      blocker: { blockerKind: 'prior_art_gate_unavailable', blocker: `Missing Cortex prior-art gate script: ${scriptPath}` },
      truthBoundary: 'V19 release packet requires a Cortex prior-art gate before claiming it is an adapter over existing ledger primitives.'
    };
    return { path: writeJson(outputPath, blocked), gate: blocked };
  }
  const args = [
    scriptPath,
    '--objective', objective,
    '--capability', 'memory prior-art gate',
    '--capability', 'run ledger',
    '--capability', 'release packet',
    '--capability', 'proof carrying claim ledger',
    '--capability', 'execution transaction',
    '--capability', 'artifact bundle manifest',
    '--path', 'public/cortex_server/cortex_server/modules/prior_art_gate.py',
    '--path', 'packages/proof-carrying-claim-ledger/index.mjs',
    '--path', 'packages/synthetic-labor-os/index.mjs',
    '--path', 'apps/synthetic-labor-os/v19-release-packet.mjs',
    '--proposed-action', 'adapter_wrapper_only',
    '--scan-root', path.resolve(repoRoot, '..', 'public/cortex_server/cortex_server'),
    '--scan-root', path.resolve(repoRoot, 'packages'),
    '--scan-root', path.resolve(repoRoot, 'apps/synthetic-labor-os')
  ];
  const run = spawnSync('python3', args, { cwd: path.resolve(repoRoot, '..', 'public/cortex_server'), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  let gate = null;
  try { gate = JSON.parse(run.stdout || '{}'); } catch { gate = null; }
  if (!gate || typeof gate !== 'object' || !gate.schemaVersion) {
    gate = {
      schemaVersion: 'cortex.memory.prior_art_gate.v1',
      generatedAt,
      ok: false,
      status: 'error',
      objective,
      proposedAction: 'adapter_wrapper_only',
      decision: 'prior_art_gate_parse_failed',
      failures: ['prior_art_gate_output_parse_failed'],
      command: ['python3', ...args].join(' '),
      exitCode: run.status ?? 1,
      stderrTail: String(run.stderr || '').slice(-2000),
      blocker: { blockerKind: 'prior_art_gate_failed', blocker: 'Cortex prior-art gate did not produce parseable JSON.' },
      truthBoundary: 'V19 release packet requires a parseable Cortex prior-art gate before claiming adapter/reuse status.'
    };
  }
  gate.generatedAt ||= generatedAt;
  gate.command = ['python3', ...args].join(' ');
  gate.exitCode = run.status ?? 0;
  return { path: writeJson(outputPath, gate), gate };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const repoRoot = path.resolve(args.repoRoot);
  const artifactRoot = path.resolve(args.artifactRoot);
  const packetRoot = path.join(artifactRoot, 'release_packet');
  const evidenceDir = path.join(packetRoot, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const priorArt = runPriorArtGate({ repoRoot, artifactRoot, generatedAt });

  const ledger = buildRunLedger({
    generatedAt,
    repoRoot,
    runSummaryPath: path.resolve(args.v18SummaryPath),
    priorArtGatePath: priorArt.path,
    priorArtGate: priorArt.gate,
    objective: 'Build an operator-readable run ledger/release packet from the SLOS v18 selected whole-OS winner.',
    stopCondition: 'release_packet_green_or_blocker_artifact'
  });
  const ledgerPath = writeJson(path.join(artifactRoot, 'run_ledger.json'), ledger);
  const copiedEvidence = ledger.evidence.map((entry, index) => copyEvidence(entry, index, evidenceDir, artifactRoot));
  const evidenceManifestPath = writeJson(path.join(packetRoot, 'evidence_manifest.json'), {
    schemaVersion: 'claw.synthetic_labor_os.v19.copied_evidence_manifest',
    generatedAt,
    ok: copiedEvidence.every((entry) => !entry.required || entry.copied === true),
    sourceEvidenceCount: ledger.evidence.length,
    copiedEvidenceCount: copiedEvidence.filter((entry) => entry.copied).length,
    missingRequiredLabels: copiedEvidence.filter((entry) => entry.required && !entry.copied).map((entry) => entry.label),
    evidence: copiedEvidence,
    truthBoundary: 'Copied evidence keeps packet review portable. It does not approve, merge, publish, deploy, or expand the underlying run claim.'
  });

  const includePaths = [ledgerPath, evidenceManifestPath, ...copiedEvidence.filter((entry) => entry.copiedPath).map((entry) => entry.copiedPath)]
    .map((filePath) => relFrom(artifactRoot, filePath));
  const bundleManifest = createArtifactBundleManifest({
    artifactRoot,
    includePaths,
    label: 'slos-v19-release-packet-evidence-bundle',
    createdBy: 'synthetic-labor-os-v19-release-packet',
    createdAt: generatedAt
  });
  const bundleManifestPath = writeJson(path.join(packetRoot, 'artifact_bundle_manifest.json'), bundleManifest);
  const bundleVerification = verifyArtifactBundleManifest({ artifactRoot, manifest: bundleManifest, generatedAt });
  const bundleVerificationPath = writeJson(path.join(packetRoot, 'artifact_bundle_verification.json'), bundleVerification);

  const packet = buildReleasePacket({
    generatedAt,
    ledger,
    ledgerPath,
    packetRoot,
    copiedEvidence,
    artifactBundleManifest: bundleManifest,
    artifactBundleVerification: bundleVerification,
    replayCommands: [
      'npm run ops:synthetic-labor-os:v19-release-packet',
      'node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'
    ]
  });
  const packetPath = writeJson(path.join(packetRoot, 'release_packet.json'), {
    ...packet,
    artifactBundleManifestPath: bundleManifestPath,
    artifactBundleVerificationPath: bundleVerificationPath,
    evidenceManifestPath
  });
  const markdownPath = path.join(packetRoot, 'release_packet.md');
  fs.writeFileSync(markdownPath, renderReleasePacketMarkdown(packet));
  const checksumLines = includePaths
    .map((relPath) => `${sha256File(path.join(artifactRoot, relPath))}  ${relPath}`)
    .sort()
    .join('\n');
  const checksumsPath = path.join(packetRoot, 'SHA256SUMS');
  fs.writeFileSync(checksumsPath, `${checksumLines}\n`);

  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt,
    ok: packet.ok === true,
    status: packet.status,
    packetId: packet.packetId,
    runId: packet.runId,
    ledgerPath,
    packetPath,
    markdownPath,
    evidenceManifestPath,
    artifactBundleManifestPath: bundleManifestPath,
    artifactBundleVerificationPath: bundleVerificationPath,
    checksumsPath,
    evidenceCount: ledger.evidence.length,
    copiedEvidenceCount: copiedEvidence.filter((entry) => entry.copied).length,
    gateCount: ledger.gates.length,
    greenGateCount: ledger.gates.filter((entry) => entry.ok).length,
    blocker: packet.blocker,
    truthBoundary: packet.truthBoundary
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v19_release_packet_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (packet.ok !== true) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
