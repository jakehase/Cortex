#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { deploymentBindingDigest } from './deployment-identity.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import { independentAssessmentContentDigest } from './phd-assessment.mjs';
import { loadCanonicalPhdProgram } from './phd-program-runtime.mjs';

const [contentValue, outputValue, revisionValue] = process.argv.slice(2);
if (!contentValue || !outputValue || revisionValue === undefined) {
  throw new Error('usage: continuous-math-bank-assemble.mjs <commissioned-content> <unsigned-envelope-out> <base-mastery-revision>');
}
const contentPath = path.resolve(contentValue);
const outputPath = path.resolve(outputValue);
const baseMasteryRevision = Number(revisionValue);
if (!Number.isSafeInteger(baseMasteryRevision) || baseMasteryRevision < 0) throw new Error('invalid base mastery revision');
if (outputPath === contentPath || fs.existsSync(outputPath)) throw new Error('output must be a fresh distinct path');
const contentStat = fs.lstatSync(contentPath);
if (!contentStat.isFile() || contentStat.isSymbolicLink() || contentStat.size > 64 * 1024 * 1024) throw new Error('unsafe commissioned content input');
const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
if (content.schemaVersion !== 'cortex.learning_os.commissioned_assessment_content.v2'
    || !['acquisition', 'validity', 'retention'].includes(content.purpose)
    || !Array.isArray(content.items)
    || content.itemCount !== content.items.length
    || content.itemCount < 1
    || content.conceptCount !== new Set(content.items.map((row) => row.conceptId)).size) {
  throw new Error('commissioned content is incomplete');
}
const identity = currentCommittedIdentity({ requireClean: true });
if (canonicalJson(content.source) !== canonicalJson(identity)) throw new Error('commissioned content source differs from current exact commit');
const program = loadCanonicalPhdProgram({ sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, productTree: identity.productTree });
if (!program.ok || !program.productionTrustReady) throw new Error(`canonical program is not production ready: ${program.errors.join('; ')}`);
const contentSha256 = sha256Bytes(fs.readFileSync(contentPath));
const campaignRecord = {
  schemaVersion: 'cortex.learning_os.continuous_math_assessment_campaign_binding.v1',
  campaignId: content.campaignId,
  purpose: content.purpose,
  source: identity,
  baseMasteryRevision,
  commissionedContentSha256: contentSha256,
  conceptCount: content.conceptCount,
  itemCount: content.itemCount,
  itemBlueprints: content.itemBlueprints,
};
const bindings = {
  trustPolicyDigest: sha256Text(canonicalJson(program.trustPolicy)),
  deploymentDigest: deploymentBindingDigest(program.deployment),
  campaign: { campaignId: campaignRecord.campaignId, campaignDigest: sha256Text(canonicalJson(campaignRecord)) },
};
const concepts = new Map(program.graph.concepts.map((row) => [row.conceptId, row]));
const mappings = new Map(program.rubric.conceptMappings.map((row) => [row.conceptId, row]));
function checkerSpecification(row) {
  const compact = row.checker;
  const expected = JSON.parse(compact.expectedJson);
  if (compact.mode === 'numeric_tolerance') return { mode: compact.mode, expected, tolerance: compact.tolerance };
  if (['exact_string', 'multiple_choice'].includes(compact.mode)) return { mode: compact.mode, expected, caseSensitive: compact.caseSensitive };
  return { mode: compact.mode, expected };
}
const seen = new Set();
const items = content.items.map((row) => {
  if (seen.has(row.itemKey)) throw new Error(`duplicate commissioned item: ${row.itemKey}`);
  seen.add(row.itemKey);
  const concept = concepts.get(row.conceptId);
  const mapping = mappings.get(row.conceptId);
  if (!concept || !mapping) throw new Error(`unknown commissioned concept: ${row.conceptId}`);
  const promptBytes = Buffer.from(row.prompt, 'utf8');
  const specification = checkerSpecification(row);
  const item = {
    schemaVersion: 'cortex.learning_os.independent_assessment_item.v1',
    itemId: `commissioned-${sha256Text(`${content.campaignId}:${row.itemKey}`).slice(0, 32)}`,
    fixtureOnly: false,
    assessmentClass: 'independently_authored_concept_specific',
    assessmentRole: row.assessmentRole,
    content: { encoding: 'base64', mediaType: 'text/plain; charset=utf-8', promptBase64: promptBytes.toString('base64') },
    contentSha256: sha256Text(promptBytes),
    contentDigest: null,
    answerFormat: row.answerFormat,
    conceptId: row.conceptId,
    outcomeIds: concept.outcomes.map((outcome) => `outcome:${sha256Text(outcome)}`),
    stage: mapping.stage,
    trackIds: mapping.tracks,
    semanticFamilyId: `commissioned-${sha256Text(`${content.campaignId}:${row.conceptId}:${row.assessmentRole}:${row.variant}:${row.prompt}`).slice(0, 32)}`,
    checker: { runtime: 'cortex.learning_os.deterministic_checker.v1', specification, specificationSha256: sha256Text(canonicalJson(specification)) },
    resourceLimits: { maxPromptBytes: Math.max(4096, promptBytes.length), maxAnswerBytes: 4096, maxCheckerRuntimeMs: 1000 },
    toolsPolicy: { allowed: false, policy: 'no_tools' },
    bindings,
    authorAttestation: null,
    reviewerAttestation: null,
    truthBoundary: `Role-isolated no-tool ${content.purpose} item accepted after a separate reviewer independently solved it. Bank inclusion alone proves no candidate result.`,
  };
  item.contentDigest = independentAssessmentContentDigest(item);
  return item;
});
const bank = {
  schemaVersion: 'cortex.learning_os.independent_assessment_bank.v1',
  bankId: content.campaignId,
  fixtureOnly: false,
  assessmentClass: 'independently_authored_concept_specific',
  purpose: content.purpose,
  bindings,
  items,
  bankDigest: null,
  authorAttestation: null,
  reviewerAttestation: null,
  truthBoundary: `${content.purpose} bank commissioned through fresh role-isolated machine author/reviewer sessions with positive provider usage and no tool events. Signing authenticates provenance, not candidate performance.`,
};
const envelope = {
  schemaVersion: 'cortex.learning_os.unsigned_assessment_bank_envelope.v2',
  source: identity,
  deployment: program.deployment,
  trustPolicy: program.trustPolicy,
  campaignRecord,
  commissionedContent: {
    path: contentPath,
    sha256: contentSha256,
    authoringModel: content.authoringModel,
    reviewingModel: content.reviewingModel,
    roleIsolation: content.roleIsolation,
  },
  signingHistory: [],
  bank,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ ok: true, outputPath, source: identity, bankId: bank.bankId, purpose: bank.purpose, conceptCount: content.conceptCount, itemCount: items.length, bindings }, null, 2));
