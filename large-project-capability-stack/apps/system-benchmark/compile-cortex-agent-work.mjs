#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { writeCortexAgentWorkHandoff } from '../../packages/cortex-agent-work-adapter/index.mjs';

function usage() {
  console.error('usage: node apps/system-benchmark/compile-cortex-agent-work.mjs <cortex-handoff.json> --out <artifact-dir> [--repo <repo-path>] [--run-id <id>]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { inputPath: null, out: null, repoPath: null, runId: null, generatedAt: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (!args.inputPath && !token.startsWith('--')) { args.inputPath = path.resolve(token); continue; }
    if (token === '--out') { args.out = path.resolve(next); index += 1; continue; }
    if (token === '--repo') { args.repoPath = path.resolve(next); index += 1; continue; }
    if (token === '--run-id') { args.runId = String(next || ''); index += 1; continue; }
    if (token === '--generated-at') { args.generatedAt = String(next || ''); index += 1; continue; }
  }
  if (!args.inputPath || !args.out) usage();
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!fs.existsSync(args.inputPath)) {
  console.error(`handoff not found: ${args.inputPath}`);
  process.exit(2);
}

const input = JSON.parse(fs.readFileSync(args.inputPath, 'utf8'));
const result = writeCortexAgentWorkHandoff({
  input,
  outputDir: args.out,
  options: {
    repoPath: args.repoPath || undefined,
    runId: args.runId || undefined,
    generatedAt: args.generatedAt || undefined,
    artifactRoot: args.out
  }
});

console.log(JSON.stringify({
  ok: true,
  schemaVersion: result.schemaVersion,
  handoffSchemaVersion: result.handoff.schemaVersion,
  runId: result.runContract.runId,
  benchmarkId: result.runContract.benchmarkId,
  surfaceCount: result.surfaceMatrix.surfaces.length,
  runContractPath: result.files.runContractPath,
  cortexHandoffPath: result.files.cortexHandoffPath,
  defaultRunner: result.runtime.defaultRunner,
  defaultCommand: result.runtime.defaultCommand,
  relaunchAllowed: result.safetyReport.relaunchAllowed,
  externalWriteAllowed: result.safetyReport.externalWriteAllowed
}, null, 2));
