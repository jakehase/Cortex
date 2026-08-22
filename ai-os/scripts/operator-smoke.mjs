#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-operator-smoke-'));
const runCli = (args, { expect = 0 } = {}) => {
  const result = spawnSync(process.execPath, ['apps/aios-cli.mjs', ...args], { cwd: repoRoot, encoding: 'utf8' });
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const parsed = stdout ? JSON.parse(stdout) : stderr ? JSON.parse(stderr) : null;
  if (result.status !== expect) {
    throw new Error(JSON.stringify({ command: args, expectedStatus: expect, actualStatus: result.status, stdout: parsed || stdout, stderr }, null, 2));
  }
  return parsed;
};
const compile = runCli(['compile', 'examples/internal-adapter-status.aios', '--artifact-root', artifactRoot, '--workspace', 'operator-smoke']);
const jobPath = compile?.jobPaths?.[0];
if (!compile?.ok || !jobPath) throw new Error('canonical AIOS compile did not emit a runnable job');
const boot = runCli(['boot', '--artifact-root', artifactRoot]);
const run = runCli(['run', jobPath, '--artifact-root', artifactRoot]);
const processId = run?.process?.id;
if (!processId) throw new Error('run proof did not expose process.id');
const ps = runCli(['ps', '--artifact-root', artifactRoot]);
const logs = runCli(['logs', '--artifact-root', artifactRoot, '--process', processId]);
fs.mkdirSync(path.join(artifactRoot, 'packets'), { recursive: true });
fs.writeFileSync(path.join(artifactRoot, 'packets', 'verifier-evidence.packet.json'), JSON.stringify({
  ok: true,
  status: 'green',
  packetType: 'aios.verifier.evidence',
  generatedAt: new Date().toISOString(),
  evidence: [{ kind: 'operator_smoke', boot: boot.ok === true, run: run.ok === true, processId }],
  checks: [
    { name: 'language_compile', ok: compile.ok === true && compile.status?.state === 'ready' },
    { name: 'boot', ok: boot.ok === true },
    { name: 'run', ok: run.ok === true },
    { name: 'ps', ok: ps.ok === true && ps.count >= 1 },
    { name: 'logs', ok: logs.ok === true && logs.count >= 1 }
  ]
}, null, 2));
const claim = runCli(['claim', jobPath, '--artifact-root', artifactRoot]);
const report = {
  ok: true,
  artifactRoot,
  canonicalLanguage: compile.language?.version || null,
  compileProof: compile.proofPath,
  jobPath,
  processId,
  bootProof: boot.proofPath,
  runProof: run.proofPath,
  psCount: ps.count,
  logCount: logs.count,
  claimStatus: claim.claimStatus,
  claimPath: claim.claimPath
};
console.log(JSON.stringify(report, null, 2));
