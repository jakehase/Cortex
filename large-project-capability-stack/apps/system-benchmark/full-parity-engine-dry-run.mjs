#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { computeParity, writeParityArtifacts } from '../../packages/full-parity-engine/index.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const objectivePath = value('--objective');
const referencePath = value('--reference');
const implementationPath = value('--implementation');
const verifiersPath = value('--verifiers');
const out = value('--out');
if (!objectivePath || !referencePath || !implementationPath || !out) {
  console.error('usage: full-parity-engine-dry-run.mjs --objective FILE --reference FILE --implementation FILE [--verifiers FILE] --out DIR');
  process.exit(2);
}
const read = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const result = computeParity({
  objective: read(objectivePath),
  referenceInventory: read(referencePath),
  implementationInventory: read(implementationPath),
  verifierResults: verifiersPath ? read(verifiersPath) : {}
});
const files = writeParityArtifacts(result, path.resolve(out));
console.log(JSON.stringify({ ok: true, parityGreen: result.supervisorTruth.parityGreen, gapCount: result.negativeSpace.gapCount, claimStatus: result.claimPacket.claimStatus, files }, null, 2));
