import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import { validateJsonSchema } from './json-schema-validation.mjs';
import {
  createProofTask,
  serializeProofRecord,
} from './lean-proof-verifier.mjs';
import { CLOS_ROOT } from './paths.mjs';

export const PROOF_OBLIGATION_REGISTRY_SCHEMA = 'cortex.learning_os.proof_obligation_registry.v1';
export const RESEARCH_ARTIFACT_MARKER = '{{CORTEX_RESEARCH_ARTIFACT_SHA256}}';

const DIGEST = /^[0-9a-f]{64}$/;
const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_SCHEMA_PATH = path.join(
  MODULE_ROOT,
  '../schemas/proof-obligation-registry.schema.json',
);
const OBLIGATIONS = [
  'formal-proof-induction-well-ordering',
  'formal-proof-rank-nullity',
  'formal-proof-monotone-convergence',
  'formal-proof-first-isomorphism',
  'formal-proof-compact-image',
  'formal-proof-conditional-tower',
  'formal-proof-research-main-result',
];
const THEOREM_NAMES = new Map([
  ['formal-proof-induction-well-ordering', 'candidate_induction_well_ordering'],
  ['formal-proof-rank-nullity', 'candidate_rank_nullity'],
  ['formal-proof-monotone-convergence', 'candidate_monotone_convergence'],
  ['formal-proof-first-isomorphism', 'candidate_first_isomorphism'],
  ['formal-proof-compact-image', 'candidate_compact_image'],
  ['formal-proof-conditional-tower', 'candidate_conditional_tower'],
  ['formal-proof-research-main-result', 'candidate_research_fixture_digest_binding'],
]);
const REGISTRY_TRUTH_BOUNDARY = 'The registry binds seven trusted theorem templates. A registry entry is not proof evidence until an isolated candidate is independently accepted and replayed by pinned Lean.';

function assertFixtureOnlyBoolean(fixtureOnly) {
  if (typeof fixtureOnly !== 'boolean') {
    throw new Error('proof task fixtureOnly must be a boolean');
  }
}

function templatePath(obligationId) {
  return path.join(CLOS_ROOT, 'proof-kernel/templates', `${obligationId}.template.lean`);
}

export function extractProofTheoremStatement(templateText) {
  const start = templateText.indexOf('theorem ');
  const end = templateText.indexOf(' := ({{CORTEX_PROOF_HOLE}})');
  if (start < 0 || end <= start) throw new Error('proof template theorem statement is not extractable');
  return templateText.slice(start, end);
}

function decodeTemplate(bytes, obligationId) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`proof template is not valid UTF-8: ${obligationId}`);
  }
}

function requireExpectedTheorem(templateText, obligationId) {
  const statement = extractProofTheoremStatement(templateText);
  if (!statement.startsWith(`theorem ${THEOREM_NAMES.get(obligationId)}\n`)) {
    throw new Error(`proof template theorem does not match its obligation: ${obligationId}`);
  }
  return statement;
}

export function loadProofObligationRegistry({ rubric, templatesByObligation = null } = {}) {
  const rubricObligations = rubric?.formalProofObligations;
  const rubricById = new Map((rubricObligations || []).map((row) => [row.obligationId, row]));
  if (!Array.isArray(rubricObligations)
      || rubricObligations.length !== OBLIGATIONS.length
      || rubricById.size !== OBLIGATIONS.length
      || OBLIGATIONS.some((obligationId) => !rubricById.has(obligationId))) {
    throw new Error('rubric proof obligations do not match the trusted Lean registry');
  }
  if (templatesByObligation !== null
      && (typeof templatesByObligation !== 'object'
        || templatesByObligation === null
        || Array.isArray(templatesByObligation)
        || canonicalJson(Object.keys(templatesByObligation).sort())
          !== canonicalJson([...OBLIGATIONS].sort()))) {
    throw new Error('committed proof template set does not contain exactly seven obligations');
  }
  const entries = OBLIGATIONS.map((obligationId) => {
    const target = templatePath(obligationId);
    let templateBytes;
    if (templatesByObligation !== null) {
      const supplied = templatesByObligation[obligationId];
      if (!Buffer.isBuffer(supplied) || supplied.length < 100 || supplied.length > 256 * 1024) {
        throw new Error(`unsafe committed proof template: ${obligationId}`);
      }
      templateBytes = supplied;
    } else {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 100 || stat.size > 256 * 1024) {
        throw new Error(`unsafe proof template: ${obligationId}`);
      }
      templateBytes = fs.readFileSync(target);
    }
    const templateText = decodeTemplate(templateBytes, obligationId);
    if (!templateText.startsWith('import Mathlib\n')
        || templateText.split('{{CORTEX_PROOF_HOLE}}').length !== 2
        || (obligationId === 'formal-proof-research-main-result')
          !== templateText.includes(RESEARCH_ARTIFACT_MARKER)) {
      throw new Error(`invalid trusted proof template: ${obligationId}`);
    }
    const theoremStatement = requireExpectedTheorem(templateText, obligationId);
    return {
      obligationId,
      rubricSpecDigest: sha256Text(canonicalJson(rubricById.get(obligationId))),
      templateBlueprintSha256: sha256Bytes(templateBytes),
      allowedImports: ['Mathlib'],
      theoremStatement,
      researchArtifactBound: obligationId === 'formal-proof-research-main-result',
    };
  });
  const core = {
    schemaVersion: PROOF_OBLIGATION_REGISTRY_SCHEMA,
    entries,
    leanTemplateRoot: 'proof-kernel/templates',
    truthBoundary: REGISTRY_TRUTH_BOUNDARY,
  };
  const registry = {
    ...core,
    registryDigest: sha256Text(canonicalJson(core)),
  };
  const validation = validateJsonSchema(registry, REGISTRY_SCHEMA_PATH);
  if (!validation.ok) {
    throw new Error(`generated proof obligation registry is invalid: ${validation.errors.join('; ')}`);
  }
  return registry;
}

export function materializeProofTemplate({
  obligationId,
  researchArtifactDigest = null,
  frozenTemplateBytes = null,
  expectedTemplateSha256 = null,
  expectedTheoremStatementSha256 = null,
  fixtureOnly = false,
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly);
  if (!OBLIGATIONS.includes(obligationId)) throw new Error('unknown trusted proof obligation');
  const isResearchMain = obligationId === 'formal-proof-research-main-result';
  if (isResearchMain && !fixtureOnly && !Buffer.isBuffer(frozenTemplateBytes)) {
    throw new Error('production research proof requires exact campaign-frozen external template bytes');
  }
  if (Buffer.isBuffer(frozenTemplateBytes) && !fixtureOnly
      && (!DIGEST.test(String(expectedTemplateSha256 || ''))
        || !DIGEST.test(String(expectedTheoremStatementSha256 || '')))) {
    throw new Error('production frozen proof bytes require expected template and theorem digests');
  }
  const templateBytes = Buffer.isBuffer(frozenTemplateBytes)
    ? frozenTemplateBytes
    : fs.readFileSync(templatePath(obligationId));
  let templateText = decodeTemplate(templateBytes, obligationId);
  if (!templateText.startsWith('import Mathlib\n')
      || templateText.split('{{CORTEX_PROOF_HOLE}}').length !== 2) {
    throw new Error(`invalid frozen proof template: ${obligationId}`);
  }
  if (!isResearchMain) requireExpectedTheorem(templateText, obligationId);
  if (isResearchMain && !fixtureOnly
      && (templateText.includes(RESEARCH_ARTIFACT_MARKER)
        || sha256Text(templateText) === sha256Text(fs.readFileSync(templatePath(obligationId))))) {
    throw new Error('production research proof rejects the checked-in digest-binding fixture template');
  }
  if (obligationId === 'formal-proof-research-main-result') {
    if (fixtureOnly) {
      if (!DIGEST.test(String(researchArtifactDigest || ''))) {
        throw new Error('fixture research proof requires an artifact SHA-256');
      }
      templateText = templateText.replace(RESEARCH_ARTIFACT_MARKER, researchArtifactDigest);
    } else if (researchArtifactDigest !== null) {
      throw new Error('production research theorem bytes bind claim semantics, not the digest fixture marker');
    }
  } else if (researchArtifactDigest !== null) {
    throw new Error('non-research proof cannot bind a research artifact');
  }
  if (templateText.includes(RESEARCH_ARTIFACT_MARKER)) throw new Error('unresolved research artifact marker');
  const materialized = Buffer.from(templateText, 'utf8');
  if (expectedTemplateSha256 !== null && sha256Bytes(materialized) !== expectedTemplateSha256) {
    throw new Error(`frozen proof template digest mismatch: ${obligationId}`);
  }
  const statement = extractProofTheoremStatement(templateText);
  if (expectedTheoremStatementSha256 !== null
      && sha256Text(statement) !== expectedTheoremStatementSha256) {
    throw new Error(`frozen proof theorem statement digest mismatch: ${obligationId}`);
  }
  return materialized;
}

export function createObligationProofTask({
  obligationId,
  researchArtifactDigest = null,
  frozenTemplateBytes = null,
  expectedTemplateSha256 = null,
  expectedTheoremStatementSha256 = null,
  fixtureOnly = false,
  deployment,
  runId,
  seed,
  limits,
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly);
  const trustedTemplateBytes = materializeProofTemplate({
    obligationId,
    researchArtifactDigest,
    frozenTemplateBytes,
    expectedTemplateSha256,
    expectedTheoremStatementSha256,
    fixtureOnly,
  });
  const templateText = trustedTemplateBytes.toString('utf8');
  const task = createProofTask({
    taskId: `proof-task.${obligationId}.${runId}`,
    conceptId: obligationId,
    theoremStatement: extractProofTheoremStatement(templateText),
    trustedTemplateBytes,
    runId,
    seed,
    limits,
    deployment,
  });
  return {
    task,
    taskBytes: serializeProofRecord(task),
    trustedTemplateBytes,
    obligationId,
    researchArtifactDigest,
  };
}
