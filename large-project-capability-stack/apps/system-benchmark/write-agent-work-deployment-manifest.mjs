#!/usr/bin/env node
import path from 'node:path';
import {
  readDeploymentManifest,
  verifyDeploymentManifest,
  writeDeploymentManifest
} from '../../packages/agent-work-deployment-provenance/index.mjs';

function parseArgs(argv) {
  const args = { root: process.cwd(), includes: [], out: null, remoteRoot: null, bundleId: null, verify: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--root') { args.root = next; index += 1; continue; }
    if (token === '--include' || token === '--path') { args.includes.push(next); index += 1; continue; }
    if (token === '--out') { args.out = next; index += 1; continue; }
    if (token === '--remote-root') { args.remoteRoot = next; index += 1; continue; }
    if (token === '--bundle-id') { args.bundleId = next; index += 1; continue; }
    if (token === '--verify') { args.verify = next; index += 1; continue; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
try {
  if (args.verify) {
    const manifest = readDeploymentManifest(args.verify);
    const verification = verifyDeploymentManifest({ root: args.root, manifest });
    console.log(JSON.stringify(verification, null, 2));
    process.exit(verification.ok ? 0 : 2);
  }
  if (!args.out || !args.includes.length) {
    console.error('usage: node apps/system-benchmark/write-agent-work-deployment-manifest.mjs --root <repo> --out <manifest.json> --include <path> [--include <path> ...] [--remote-root <path>] [--bundle-id <id>]');
    console.error('   or: node apps/system-benchmark/write-agent-work-deployment-manifest.mjs --root <repo> --verify <manifest.json>');
    process.exit(2);
  }
  const manifest = writeDeploymentManifest({
    root: args.root,
    includePaths: args.includes,
    outputPath: args.out,
    remoteRoot: args.remoteRoot,
    bundleId: args.bundleId
  });
  console.log(JSON.stringify({
    ok: true,
    manifestPath: path.resolve(args.out),
    schemaVersion: manifest.schemaVersion,
    bundleId: manifest.bundleId,
    gitCommit: manifest.git?.commit || null,
    gitDirty: manifest.git?.dirty ?? null,
    fileCount: manifest.fileCount,
    aggregateSha256: manifest.aggregateSha256,
    remoteRoot: manifest.remoteRoot
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
}
