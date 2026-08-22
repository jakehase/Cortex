#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { currentCommittedIdentity } from './git-product-source.mjs';
import { loadCanonicalPhdProgram } from './phd-program-runtime.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const outRootValue = value('--out-root');
const cohortPathValue = value('--cohort-plan');
if (!outRootValue || !cohortPathValue) {
  throw new Error('usage: continuous-math-bank-spec.mjs --out-root <empty-dir> --cohort-plan <phase0-cohort-plan>');
}
const outRoot = path.resolve(outRootValue);
const cohortPath = path.resolve(cohortPathValue);
const campaignPrefix = value('--campaign-prefix', 'continuous-math-wave1-20260809');
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/.test(campaignPrefix)) throw new Error('invalid campaign prefix');

function readJson(target, label) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error(`${label} is unsafe`);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}
function atomicJson(target, record) {
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}
if (fs.existsSync(outRoot)) {
  const stat = fs.lstatSync(outRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(outRoot).length) throw new Error('--out-root must be absent or empty');
} else fs.mkdirSync(outRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(outRoot, 0o700);

const identity = currentCommittedIdentity({ requireClean: true });
const program = loadCanonicalPhdProgram({
  sourceCommit: identity.sourceCommit,
  sourceTree: identity.sourceTree,
  productTree: identity.productTree,
});
if (!program.ok || !program.productionTrustReady) throw new Error(`canonical program is not production-ready: ${program.errors.join('; ')}`);
if (program.graph.version !== '1.1.0' || program.graph.concepts.length !== 288) throw new Error('continuous math expansion source is not the exact 288-concept v1.1 graph');
const cohort = readJson(cohortPath, 'phase0 cohort plan');
const expansion = readJson(path.join(process.cwd(), 'surfaces/continuous-math-expansion-wave1-v1.json'), 'expansion surface');
const concepts = new Map(program.graph.concepts.map((row) => [row.conceptId, row]));
const mappings = new Map(program.rubric.conceptMappings.map((row) => [row.conceptId, row]));
const sourceIdsByConcept = new Map(expansion.tracks.flatMap((track) => track.conceptIds.map((conceptId) => [conceptId, track.sourceIds])));
const expansionIds = expansion.tracks.flatMap((track) => track.conceptIds);
if (expansionIds.length !== 24 || new Set(expansionIds).size !== 24) throw new Error('expansion surface is not exactly 24 unique concepts');

function conceptRecord(conceptId) {
  const concept = concepts.get(conceptId);
  const mapping = mappings.get(conceptId);
  if (!concept || !mapping) throw new Error(`unknown or unmapped concept: ${conceptId}`);
  return {
    conceptId,
    title: concept.title,
    category: concept.category,
    prerequisites: concept.prerequisites,
    outcomes: concept.outcomes,
    stage: mapping.stage,
    tracks: mapping.tracks,
    sourceIds: sourceIdsByConcept.get(conceptId) || [],
  };
}
function exactCohort(lane, expected) {
  const ids = (cohort?.[lane]?.concepts || []).map((row) => row.conceptId);
  if (ids.length !== expected || new Set(ids).size !== expected) throw new Error(`${lane} cohort must contain exactly ${expected} unique concepts`);
  return ids;
}
const priorValidityIds = exactCohort('validity', 24);
const retentionIds = exactCohort('retention', 19);
const specs = [
  {
    campaignId: `${campaignPrefix}-acquisition`,
    purpose: 'acquisition',
    conceptIds: expansionIds,
    itemBlueprints: [
      { assessmentRole: 'acquisition', variant: 1 },
      { assessmentRole: 'correction', variant: 1 },
      { assessmentRole: 'correction', variant: 2 },
    ],
    secrecyClass: 'candidate_unseen_until_release',
    truthBoundary: 'Items can support acquired-once or scoped correction evidence only.',
  },
  {
    campaignId: `${campaignPrefix}-validity`,
    purpose: 'validity',
    conceptIds: [...priorValidityIds, ...expansionIds],
    itemBlueprints: [
      { assessmentRole: 'validity-direct', variant: 1 },
      { assessmentRole: 'validity-compositional', variant: 1 },
    ],
    secrecyClass: 'disjoint_validity_unseen_until_release',
    truthBoundary: 'Items can support near-term validity only after a fresh scored candidate session; bank acceptance alone proves no validity.',
  },
  {
    campaignId: `${campaignPrefix}-retention-r7-pair`,
    purpose: 'retention',
    conceptIds: retentionIds,
    itemBlueprints: [
      { assessmentRole: 'retention', variant: 1 },
      { assessmentRole: 'retention', variant: 2 },
    ],
    secrecyClass: 'sealed_future_retention',
    truthBoundary: 'Sealing items starts no retention clock and gives no elapsed-time credit.',
  },
].map((spec) => ({
  schemaVersion: 'cortex.learning_os.continuous_math_bank_commissioning_spec.v1',
  ...spec,
  source: identity,
  curriculum: { curriculumId: program.graph.curriculumId, version: program.graph.version },
  conceptCount: spec.conceptIds.length,
  expectedItemCount: spec.conceptIds.length * spec.itemBlueprints.length,
  concepts: spec.conceptIds.map(conceptRecord),
  modelRuntime: { provider: 'openai-codex', model: 'gpt-5.6-sol', thinking: 'xhigh', sandbox: 'read-only', toolsAllowed: false },
}));
for (const spec of specs) atomicJson(path.join(outRoot, `${spec.purpose}.commissioning-spec.json`), spec);
atomicJson(path.join(outRoot, 'index.json'), {
  schemaVersion: 'cortex.learning_os.continuous_math_bank_commissioning_index.v1',
  source: identity,
  generatedAt: new Date().toISOString(),
  specs: specs.map((spec) => ({ campaignId: spec.campaignId, purpose: spec.purpose, conceptCount: spec.conceptCount, expectedItemCount: spec.expectedItemCount, path: `${spec.purpose}.commissioning-spec.json` })),
  totalConceptAssignments: specs.reduce((sum, spec) => sum + spec.conceptCount, 0),
  totalExpectedItems: specs.reduce((sum, spec) => sum + spec.expectedItemCount, 0),
  truthBoundary: 'These specs freeze independent commissioning inputs. They contain no model result or evidence credit.',
});
console.log(JSON.stringify({ ok: true, outRoot, source: identity, specs: specs.map((spec) => ({ purpose: spec.purpose, conceptCount: spec.conceptCount, expectedItemCount: spec.expectedItemCount })) }, null, 2));
