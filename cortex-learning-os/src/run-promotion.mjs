#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { evaluatePromotion } from './promotion.mjs';
import { buildCapabilityReport, buildRetrievalPack } from './retrieval-pack.mjs';

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const capsulePath = value('--capsule');
const candidatePath = value('--candidate');
const verifiersPath = value('--verifiers');
const out = value('--out');
const task = value('--task') || '';
const now = value('--now') || new Date().toISOString();
if (!capsulePath || !candidatePath || !verifiersPath || !out) {
  console.error('usage: run-promotion.mjs --capsule FILE --candidate FILE --verifiers FILE --task TEXT --out DIR [--now ISO]');
  process.exit(2);
}
const read = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const write = (dir, name, data) => {
  const target = path.join(dir, name);
  fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
  return target;
};
const capsule = read(capsulePath);
const candidate = read(candidatePath);
const verifierResults = read(verifiersPath);
if (!Array.isArray(verifierResults)) throw new Error('--verifiers must contain a JSON array');
const outputDir = path.resolve(out);
fs.mkdirSync(outputDir, { recursive: true });
const promotion = evaluatePromotion({ capsule, candidate, verifierResults, now });
const trustedLessons = promotion.trustedLesson ? [promotion.trustedLesson] : [];
const retrievalPack = buildRetrievalPack({ capsule, task, trustedLessons, candidateLessons: [candidate], now });
const capabilityReport = buildCapabilityReport({ capsule, examResults: verifierResults });
const files = {
  promotionProof: write(outputDir, 'promotion_proof.json', promotion.promotionProof),
  trustedLesson: write(outputDir, 'trusted_lesson.json', promotion.trustedLesson),
  retrievalPack: write(outputDir, 'retrieval_pack.json', retrievalPack),
  capabilityReport: write(outputDir, 'capability_report.json', capabilityReport)
};
const manifest = {
  schemaVersion: 'cortex.learning_os.artifact_manifest.v0',
  generatedAt: now,
  files: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, {
    path: file,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }])),
  promoted: promotion.promoted,
  truthBoundary: capabilityReport.truthBoundary
};
files.manifest = write(outputDir, 'artifact_manifest.json', manifest);
console.log(JSON.stringify({ ok: true, promoted: promotion.promoted, files, allowedClaims: capabilityReport.allowedClaims, rejectedClaims: capabilityReport.rejectedClaims }, null, 2));
if (!promotion.promoted) process.exitCode = 1;
