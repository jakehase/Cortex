#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { currentCommittedIdentity } from './git-product-source.mjs';
import { sha256Text } from './hash.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const candidateValue = value('--candidate');
const reportValue = value('--report');
const referenceValues = args.flatMap((argument, index) => (
  argument === '--reference' && index + 1 < args.length ? [args[index + 1]] : []
));
if (!candidateValue || !reportValue) {
  throw new Error('usage: continuous-math-validity-contamination.mjs --candidate <bank> --report <fresh-report> [--reference <bank>]...');
}
const candidatePath = path.resolve(candidateValue);
const reportPath = path.resolve(reportValue);
if (fs.existsSync(reportPath)) throw new Error('contamination report output must be fresh');

function readBank(target, label) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 128 * 1024 * 1024) {
    throw new Error(`${label} is unsafe or unavailable`);
  }
  const bank = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!bank || typeof bank !== 'object' || !Array.isArray(bank.items)) {
    throw new Error(`${label} is not an assessment bank`);
  }
  return bank;
}
function prompt(item) {
  const encoded = item?.content?.promptBase64;
  if (typeof encoded !== 'string') throw new Error(`assessment item has no canonical prompt: ${item?.itemId}`);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error(`assessment prompt is not canonical base64: ${item?.itemId}`);
  return bytes.toString('utf8');
}
function normalize(text) {
  return text.normalize('NFKC').toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function shingles(text, width = 5) {
  const tokens = normalize(text).split(' ').filter(Boolean);
  if (tokens.length <= width) return new Set([tokens.join(' ')]);
  return new Set(tokens.slice(0, tokens.length - width + 1).map((_, index) => (
    tokens.slice(index, index + width).join(' ')
  )));
}
function jaccard(left, right) {
  let overlap = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  for (const value of smaller) if (larger.has(value)) overlap += 1;
  const union = left.size + right.size - overlap;
  return union ? overlap / union : 1;
}
function records(bank, source) {
  return bank.items.map((item) => {
    const text = prompt(item);
    return {
      source,
      bankId: bank.bankId,
      itemId: item.itemId,
      conceptId: item.conceptId,
      assessmentRole: item.assessmentRole,
      semanticFamilyId: item.semanticFamilyId,
      contentDigest: item.contentDigest,
      normalizedPrompt: normalize(text),
      normalizedPromptSha256: sha256Text(normalize(text)),
      shingles: shingles(text),
    };
  });
}

const identity = currentCommittedIdentity({ requireClean: true });
const candidate = readBank(candidatePath, 'candidate validity bank');
if (candidate.purpose !== 'validity' || candidate.items.length !== 576
    || new Set(candidate.items.map((item) => item.conceptId)).size !== 288) {
  throw new Error('candidate validity bank is not the exact 288-concept/576-item surface');
}
const candidateRows = records(candidate, candidatePath);
const references = referenceValues.map((target) => path.resolve(target))
  .filter((target) => target !== candidatePath)
  .map((target) => ({ path: target, bank: readBank(target, `reference bank ${target}`) }));
const referenceRows = references.flatMap(({ path: target, bank }) => records(bank, target));
const conflicts = [];
const seenFamilies = new Map();
const seenDigests = new Map();
const seenPrompts = new Map();
for (const row of candidateRows) {
  for (const [kind, key, map] of [
    ['semantic_family_reuse', row.semanticFamilyId, seenFamilies],
    ['content_digest_reuse', row.contentDigest, seenDigests],
    ['normalized_prompt_reuse', row.normalizedPromptSha256, seenPrompts],
  ]) {
    if (map.has(key)) conflicts.push({ kind, candidate: row.itemId, other: map.get(key).itemId, otherBankId: map.get(key).bankId, similarity: 1 });
    else map.set(key, row);
  }
}
const referenceFamilies = new Map(referenceRows.map((row) => [row.semanticFamilyId, row]));
const referenceDigests = new Map(referenceRows.map((row) => [row.contentDigest, row]));
const referencePrompts = new Map(referenceRows.map((row) => [row.normalizedPromptSha256, row]));
for (const row of candidateRows) {
  for (const [kind, key, map] of [
    ['reference_semantic_family_reuse', row.semanticFamilyId, referenceFamilies],
    ['reference_content_digest_reuse', row.contentDigest, referenceDigests],
    ['reference_normalized_prompt_reuse', row.normalizedPromptSha256, referencePrompts],
  ]) {
    if (map.has(key)) conflicts.push({ kind, candidate: row.itemId, other: map.get(key).itemId, otherBankId: map.get(key).bankId, similarity: 1 });
  }
}
const similarityThreshold = 0.86;
const comparisonRows = [...candidateRows, ...referenceRows];
for (let leftIndex = 0; leftIndex < candidateRows.length; leftIndex += 1) {
  const left = candidateRows[leftIndex];
  for (let rightIndex = leftIndex + 1; rightIndex < comparisonRows.length; rightIndex += 1) {
    const right = comparisonRows[rightIndex];
    if (left.itemId === right.itemId && left.bankId === right.bankId) continue;
    const maximumPossible = Math.min(left.shingles.size, right.shingles.size)
      / Math.max(left.shingles.size, right.shingles.size);
    if (maximumPossible < similarityThreshold) continue;
    const similarity = jaccard(left.shingles, right.shingles);
    if (similarity >= similarityThreshold) {
      conflicts.push({
        kind: rightIndex < candidateRows.length
          ? 'candidate_near_duplicate_prompt'
          : 'reference_near_duplicate_prompt',
        candidate: left.itemId,
        other: right.itemId,
        otherBankId: right.bankId,
        similarity: Number(similarity.toFixed(6)),
      });
    }
  }
}
const uniqueConflicts = [...new Map(conflicts.map((conflict) => [
  `${conflict.kind}:${conflict.candidate}:${conflict.other}:${conflict.otherBankId}`,
  conflict,
])).values()];
const report = {
  schemaVersion: 'cortex.learning_os.validity_contamination_report.v1',
  status: uniqueConflicts.length === 0 ? 'green' : 'blocked',
  checkedAt: new Date().toISOString(),
  source: identity,
  candidate: {
    path: candidatePath,
    bankId: candidate.bankId,
    bankDigest: candidate.bankDigest,
    conceptCount: new Set(candidate.items.map((item) => item.conceptId)).size,
    itemCount: candidate.items.length,
  },
  references: references.map(({ path: target, bank }) => ({
    path: target,
    bankId: bank.bankId,
    bankDigest: bank.bankDigest,
    purpose: bank.purpose,
    itemCount: bank.items.length,
  })),
  checks: {
    uniqueCandidateSemanticFamilies: true,
    uniqueCandidateContentDigests: true,
    uniqueNormalizedCandidatePrompts: true,
    noExactReferenceReuse: true,
    noHighFiveGramPromptOverlap: true,
    fiveGramJaccardThreshold: similarityThreshold,
  },
  comparisonCount: candidateRows.length * Math.max(0, candidateRows.length + referenceRows.length - 1),
  conflicts: uniqueConflicts,
  truthBoundary: 'This deterministic audit rejects exact identity/content/prompt reuse and high normalized five-token-shingle overlap within the new bank and against supplied prior banks. It supplements, but does not replace, independent mathematical authorship/review or prove candidate performance.',
};
if (uniqueConflicts.length > 0) {
  for (const key of Object.keys(report.checks)) {
    if (key !== 'fiveGramJaccardThreshold') report.checks[key] = false;
  }
}
fs.mkdirSync(path.dirname(reportPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ ok: report.status === 'green', reportPath, status: report.status, conflictCount: uniqueConflicts.length }, null, 2));
if (report.status !== 'green') process.exitCode = 4;
