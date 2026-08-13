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
const outputValue = value('--out');
const campaignId = value('--campaign-id');
const thinking = value('--thinking', 'ultra');
if (!outputValue || !campaignId) {
  throw new Error('usage: continuous-math-validity-spec.mjs --out <fresh-file> --campaign-id <id> [--thinking ultra]');
}
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(campaignId)) {
  throw new Error('invalid validity campaign identity');
}
if (!['xhigh', 'ultra'].includes(thinking)) throw new Error('validity reasoning must be xhigh or ultra');
const outputPath = path.resolve(outputValue);
if (fs.existsSync(outputPath)) throw new Error('validity commissioning spec output must be fresh');

const identity = currentCommittedIdentity({ requireClean: true });
const program = loadCanonicalPhdProgram({
  sourceCommit: identity.sourceCommit,
  sourceTree: identity.sourceTree,
  productTree: identity.productTree,
});
if (!program.ok || !program.productionTrustReady) {
  throw new Error(`canonical program is not production-ready: ${program.errors.join('; ')}`);
}
if (program.graph.version !== '1.1.0' || program.graph.concepts.length !== 288) {
  throw new Error('validity source is not the exact 288-concept v1.1 curriculum');
}
const mappings = new Map(
  program.rubric.conceptMappings.map((mapping) => [mapping.conceptId, mapping]),
);
const concepts = program.graph.concepts.map((concept) => {
  const mapping = mappings.get(concept.conceptId);
  if (!mapping) throw new Error(`validity concept has no rubric mapping: ${concept.conceptId}`);
  return {
    conceptId: concept.conceptId,
    title: concept.title,
    category: concept.category,
    prerequisites: concept.prerequisites,
    outcomes: concept.outcomes,
    stage: mapping.stage,
    tracks: mapping.tracks,
    sourceIds: [],
  };
});
const spec = {
  schemaVersion: 'cortex.learning_os.continuous_math_bank_commissioning_spec.v1',
  campaignId,
  purpose: 'validity',
  source: identity,
  curriculum: {
    curriculumId: program.graph.curriculumId,
    version: program.graph.version,
  },
  conceptCount: concepts.length,
  expectedItemCount: concepts.length * 2,
  concepts,
  itemBlueprints: [
    { assessmentRole: 'validity-direct', variant: 1 },
    { assessmentRole: 'validity-compositional', variant: 1 },
  ],
  secrecyClass: 'fresh_disjoint_validity_unseen_until_scored_release',
  modelRuntime: {
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    thinking,
    sandbox: 'read-only',
    toolsAllowed: false,
  },
  provenancePolicy: {
    authorContext: 'committed_concept_metadata_only',
    targetAnswersExposedToCandidate: false,
    acquisitionAnswersExposedToAuthor: false,
    promotedLessonTextExposedToAuthor: false,
    exactPromptReuseForbidden: true,
    independentReviewerRequired: true,
  },
  truthBoundary: 'This spec commissions two fresh, disjoint, independently authored and reviewed unseen validity families for each of 288 acquired-once concepts. It contains no candidate answer and grants no validity, retention, utility, or model-weight credit.',
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(spec, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({
  ok: true,
  outputPath,
  campaignId,
  source: identity,
  conceptCount: spec.conceptCount,
  expectedItemCount: spec.expectedItemCount,
  modelRuntime: spec.modelRuntime,
}, null, 2));
