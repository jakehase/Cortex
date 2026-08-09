import crypto from 'node:crypto';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { checkAnswer } from './checkers.mjs';
import { deploymentBindingDigest, validateDeploymentBinding } from './deployment-identity.mjs';
import { sha256Text } from './hash.mjs';
import {
  validatePhdTrustPolicy,
  verifyAuthorityAttestation,
} from './phd-trust.mjs';

export const PHD_ASSESSMENT_GENERATOR_VERSION = '1.1.0-fixture-drill';
export const INDEPENDENT_ASSESSMENT_ITEM_SCHEMA = 'cortex.learning_os.independent_assessment_item.v1';
export const INDEPENDENT_ASSESSMENT_BANK_SCHEMA = 'cortex.learning_os.independent_assessment_bank.v1';
export const INDEPENDENT_CHECKER_RUNTIME = 'cortex.learning_os.deterministic_checker.v1';

const DIGEST = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ASSESSMENT_ROLES = new Set([
  'acquisition',
  'correction',
  'promotion-transfer',
  'validity-direct',
  'validity-compositional',
  'retention',
]);
const CHECKER_FIELDS = Object.freeze({
  exact_number: ['expected', 'mode'],
  exact_integer_string: ['expected', 'mode'],
  numeric_tolerance: ['expected', 'mode', 'tolerance'],
  exact_string: ['caseSensitive', 'expected', 'mode'],
  multiple_choice: ['caseSensitive', 'expected', 'mode'],
  set_equality: ['expected', 'mode'],
  ordered_numeric_tuple: ['expected', 'mode'],
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}

function canonicalBase64(value) {
  if (typeof value !== 'string' || value.length < 4 || value.length > 2 * 1024 * 1024) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length > 0 && bytes.toString('base64') === value ? bytes : null;
}

function decodePrompt(content) {
  if (!exactKeys(content, ['encoding', 'mediaType', 'promptBase64'])
      || content.encoding !== 'base64'
      || content.mediaType !== 'text/plain; charset=utf-8') return null;
  const bytes = canonicalBase64(content.promptBase64);
  if (!bytes) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return bytes;
  } catch {
    return null;
  }
}

function validCampaignBinding(binding) {
  return exactKeys(binding, ['campaignDigest', 'campaignId'])
    && IDENTIFIER.test(String(binding.campaignId || ''))
    && DIGEST.test(String(binding.campaignDigest || ''));
}

function validBindings(bindings, { trustPolicy, deployment, campaignBinding } = {}) {
  if (!exactKeys(bindings, ['campaign', 'deploymentDigest', 'trustPolicyDigest'])
      || !validCampaignBinding(bindings.campaign)
      || !DIGEST.test(String(bindings.deploymentDigest || ''))
      || !DIGEST.test(String(bindings.trustPolicyDigest || ''))) return false;
  const deploymentValidation = validateDeploymentBinding(deployment);
  if (!deploymentValidation.ok
      || bindings.deploymentDigest !== deploymentBindingDigest(deployment)
      || bindings.trustPolicyDigest !== sha256Text(canonicalJson(trustPolicy))) return false;
  return campaignBinding === undefined
    || canonicalJson(bindings.campaign) === canonicalJson(campaignBinding);
}

function validChecker(checker) {
  if (!exactKeys(checker, ['runtime', 'specification', 'specificationSha256'])
      || checker.runtime !== INDEPENDENT_CHECKER_RUNTIME
      || !DIGEST.test(String(checker.specificationSha256 || ''))) return false;
  const specification = checker.specification;
  const fields = CHECKER_FIELDS[specification?.mode];
  if (!fields || !exactKeys(specification, fields)
      || checker.specificationSha256 !== sha256Text(canonicalJson(specification))
      || Buffer.byteLength(canonicalJson(specification), 'utf8') > 64 * 1024) return false;
  if (specification.mode === 'numeric_tolerance'
      && (!Number.isFinite(specification.expected)
        || !Number.isFinite(specification.tolerance)
        || specification.tolerance < 0)) return false;
  if (specification.mode === 'exact_number' && !Number.isFinite(specification.expected)) {
    return false;
  }
  if (specification.mode === 'exact_integer_string'
      && (typeof specification.expected !== 'string'
        || !/^-?\d+$/.test(specification.expected))) return false;
  if (['exact_string', 'multiple_choice'].includes(specification.mode)
      && (typeof specification.caseSensitive !== 'boolean'
        || typeof specification.expected !== 'string'
        || specification.expected.length < 1)) return false;
  if (specification.mode === 'set_equality'
      && (!Array.isArray(specification.expected)
        || specification.expected.length < 1
        || specification.expected.some((value) => (
          !(typeof value === 'string' && value.length > 0)
          && !(typeof value === 'number' && Number.isFinite(value))
        )))) return false;
  if (specification.mode === 'ordered_numeric_tuple'
      && (!Array.isArray(specification.expected)
        || specification.expected.length < 1
        || !specification.expected.every(Number.isFinite))) return false;
  const probe = checkAnswer('__cortex_checker_validation_probe__', specification);
  return probe.status !== 'error';
}

function itemCore(item) {
  return {
    schemaVersion: item.schemaVersion,
    itemId: item.itemId,
    fixtureOnly: item.fixtureOnly,
    assessmentClass: item.assessmentClass,
    assessmentRole: item.assessmentRole,
    content: item.content,
    contentSha256: item.contentSha256,
    answerFormat: item.answerFormat,
    conceptId: item.conceptId,
    outcomeIds: item.outcomeIds,
    stage: item.stage,
    trackIds: item.trackIds,
    semanticFamilyId: item.semanticFamilyId,
    checker: item.checker,
    resourceLimits: item.resourceLimits,
    toolsPolicy: item.toolsPolicy,
    bindings: item.bindings,
    truthBoundary: item.truthBoundary,
  };
}

export function independentAssessmentContentDigest(item) {
  return sha256Text(canonicalJson(itemCore(item)));
}

export function independentAssessmentAttestationPayload(item, role) {
  if (!['author', 'reviewer'].includes(role)) throw new Error('invalid independent assessment attestation role');
  return {
    subjectSchemaVersion: INDEPENDENT_ASSESSMENT_ITEM_SCHEMA,
    subjectId: item?.itemId,
    subjectDigest: item?.contentDigest,
    bindingDigest: sha256Text(canonicalJson(item?.bindings)),
    role,
  };
}

function bankCore(bank) {
  return {
    schemaVersion: bank.schemaVersion,
    bankId: bank.bankId,
    fixtureOnly: bank.fixtureOnly,
    assessmentClass: bank.assessmentClass,
    purpose: bank.purpose,
    bindings: bank.bindings,
    itemRecordDigests: (bank.items || []).map((item) => sha256Text(canonicalJson(item))),
    truthBoundary: bank.truthBoundary,
  };
}

export function independentAssessmentBankDigest(bank) {
  return sha256Text(canonicalJson(bankCore(bank)));
}

export function independentAssessmentBankAttestationPayload(bank, role) {
  if (!['author', 'reviewer'].includes(role)) throw new Error('invalid independent bank attestation role');
  return {
    subjectSchemaVersion: INDEPENDENT_ASSESSMENT_BANK_SCHEMA,
    subjectId: bank?.bankId,
    subjectDigest: bank?.bankDigest,
    bindingDigest: sha256Text(canonicalJson(bank?.bindings)),
    role,
  };
}

function validateIndependentAssessmentItemInternal(item, {
  graph,
  rubric,
  trustPolicy,
  deployment,
  campaignBinding,
  requireProductionTrust,
} = {}) {
  const errors = [];
  if (!exactKeys(item, [
    'assessmentClass',
    'assessmentRole',
    'authorAttestation',
    'answerFormat',
    'bindings',
    'checker',
    'conceptId',
    'content',
    'contentDigest',
    'contentSha256',
    'fixtureOnly',
    'itemId',
    'outcomeIds',
    'resourceLimits',
    'reviewerAttestation',
    'schemaVersion',
    'semanticFamilyId',
    'stage',
    'toolsPolicy',
    'trackIds',
    'truthBoundary',
  ])) {
    return { ok: false, errors: ['independent assessment item fields are incomplete or unknown'] };
  }
  const promptBytes = decodePrompt(item.content);
  const mapping = rubric?.conceptMappings?.find((row) => row.conceptId === item.conceptId);
  const concept = graph?.concepts?.find((row) => row.conceptId === item.conceptId);
  const expectedOutcomes = concept?.outcomes?.map((outcome) => `outcome:${sha256Text(outcome)}`) || [];
  if (item.schemaVersion !== INDEPENDENT_ASSESSMENT_ITEM_SCHEMA
      || item.fixtureOnly !== !requireProductionTrust
      || item.assessmentClass !== (requireProductionTrust
        ? 'independently_authored_concept_specific'
        : 'controlled_fixture_only')
      || !ASSESSMENT_ROLES.has(item.assessmentRole)
      || !IDENTIFIER.test(String(item.itemId || ''))
      || !IDENTIFIER.test(String(item.conceptId || ''))
      || !IDENTIFIER.test(String(item.semanticFamilyId || ''))
      || !IDENTIFIER.test(String(item.stage || ''))
      || typeof item.answerFormat !== 'string' || item.answerFormat.length < 1 || item.answerFormat.length > 256
      || !Array.isArray(item.outcomeIds) || item.outcomeIds.length < 1
      || new Set(item.outcomeIds).size !== item.outcomeIds.length
      || item.outcomeIds.some((outcomeId) => !/^outcome:[0-9a-f]{64}$/.test(String(outcomeId)))
      || !Array.isArray(item.trackIds) || item.trackIds.length < 1
      || new Set(item.trackIds).size !== item.trackIds.length
      || item.trackIds.some((trackId) => !IDENTIFIER.test(String(trackId)))) {
    errors.push('independent assessment identity, role, or production classification is invalid');
  }
  if (!promptBytes || item.contentSha256 !== sha256Text(promptBytes)) {
    errors.push('independent assessment prompt bytes or digest are invalid');
  }
  if (!concept || !mapping
      || canonicalJson(item.outcomeIds) !== canonicalJson(expectedOutcomes)
      || item.stage !== mapping?.stage
      || canonicalJson(item.trackIds) !== canonicalJson(mapping?.tracks)) {
    errors.push('independent assessment graph, outcome, stage, or track binding mismatch');
  }
  if (!validChecker(item.checker)) errors.push('independent assessment checker specification is invalid');
  if (!exactKeys(item.resourceLimits, [
    'maxAnswerBytes',
    'maxCheckerRuntimeMs',
    'maxPromptBytes',
  ])
      || !Number.isSafeInteger(item.resourceLimits?.maxPromptBytes)
      || item.resourceLimits.maxPromptBytes < 1 || item.resourceLimits.maxPromptBytes > 1024 * 1024
      || !Number.isSafeInteger(item.resourceLimits?.maxAnswerBytes)
      || item.resourceLimits.maxAnswerBytes < 1 || item.resourceLimits.maxAnswerBytes > 1024 * 1024
      || !Number.isSafeInteger(item.resourceLimits?.maxCheckerRuntimeMs)
      || item.resourceLimits.maxCheckerRuntimeMs < 1 || item.resourceLimits.maxCheckerRuntimeMs > 10_000
      || (promptBytes && promptBytes.length > item.resourceLimits.maxPromptBytes)) {
    errors.push('independent assessment resource limits are invalid or exceeded');
  }
  if (!exactKeys(item.toolsPolicy, ['allowed', 'policy'])
      || item.toolsPolicy.allowed !== false
      || item.toolsPolicy.policy !== 'no_tools') {
    errors.push('independent assessment must bind the no-tools policy');
  }
  const trustValidation = validatePhdTrustPolicy(trustPolicy, {
    requireProduction: requireProductionTrust,
  });
  if (!trustValidation.ok) {
    errors.push(...trustValidation.errors.map((error) => `assessment trust policy: ${error}`));
  }
  if (!validBindings(item.bindings, { trustPolicy, deployment, campaignBinding })) {
    errors.push('independent assessment trust, deployment, or campaign binding mismatch');
  }
  if (!DIGEST.test(String(item.contentDigest || ''))
      || item.contentDigest !== independentAssessmentContentDigest(item)) {
    errors.push('independent assessment content digest mismatch');
  }
  const authorPayload = independentAssessmentAttestationPayload(item, 'author');
  const reviewerPayload = independentAssessmentAttestationPayload(item, 'reviewer');
  if (!verifyAuthorityAttestation(item.authorAttestation, {
    trustPolicy,
    capability: 'bank_authoring',
  }) || canonicalJson(item.authorAttestation?.payload) !== canonicalJson(authorPayload)) {
    errors.push('independent assessment author attestation is invalid');
  }
  if (!verifyAuthorityAttestation(item.reviewerAttestation, {
    trustPolicy,
    capability: 'bank_review',
  }) || canonicalJson(item.reviewerAttestation?.payload) !== canonicalJson(reviewerPayload)) {
    errors.push('independent assessment reviewer attestation is invalid');
  }
  if (item.authorAttestation?.authorityId === item.reviewerAttestation?.authorityId) {
    errors.push('independent assessment author and reviewer must be distinct authorities');
  }
  if (typeof item.truthBoundary !== 'string' || item.truthBoundary.length < 1) {
    errors.push('independent assessment truth boundary is missing');
  }
  return { ok: errors.length === 0, errors, promptBytes };
}

export function validateIndependentAssessmentItem(item, options = {}) {
  return validateIndependentAssessmentItemInternal(item, {
    ...options,
    requireProductionTrust: true,
  });
}

export function validateIndependentAssessmentFixtureItem(item, options = {}) {
  return validateIndependentAssessmentItemInternal(item, {
    ...options,
    requireProductionTrust: false,
  });
}

function validateIndependentAssessmentBankInternal(bank, options = {}) {
  const errors = [];
  if (!exactKeys(bank, [
    'assessmentClass',
    'authorAttestation',
    'bankDigest',
    'bankId',
    'bindings',
    'fixtureOnly',
    'items',
    'purpose',
    'reviewerAttestation',
    'schemaVersion',
    'truthBoundary',
  ])) {
    return { ok: false, errors: ['independent assessment bank fields are incomplete or unknown'] };
  }
  if (bank.schemaVersion !== INDEPENDENT_ASSESSMENT_BANK_SCHEMA
      || bank.fixtureOnly !== !options.requireProductionTrust
      || bank.assessmentClass !== (options.requireProductionTrust
        ? 'independently_authored_concept_specific'
        : 'controlled_fixture_only')
      || !IDENTIFIER.test(String(bank.bankId || ''))
      || !['acquisition', 'validity', 'retention'].includes(bank.purpose)
      || !Array.isArray(bank.items) || bank.items.length < 1 || bank.items.length > 100_000) {
    errors.push('independent assessment bank identity, purpose, or item set is invalid');
  }
  if (!validBindings(bank.bindings, options)) {
    errors.push('independent assessment bank trust, deployment, or campaign binding mismatch');
  }
  const itemIds = new Set();
  const itemDigests = new Set();
  const itemValidator = options.requireProductionTrust
    ? validateIndependentAssessmentItem
    : validateIndependentAssessmentFixtureItem;
  for (const item of bank.items || []) {
    const validation = itemValidator(item, {
      ...options,
      campaignBinding: bank.bindings?.campaign,
    });
    errors.push(...validation.errors.map((error) => `${String(item?.itemId || 'unknown')}: ${error}`));
    const roleMatchesPurpose = bank.purpose === 'acquisition'
      ? ['acquisition', 'correction', 'promotion-transfer'].includes(item?.assessmentRole)
      : bank.purpose === 'validity'
        ? ['validity-direct', 'validity-compositional'].includes(item?.assessmentRole)
        : item?.assessmentRole === 'retention';
    if (canonicalJson(item?.bindings) !== canonicalJson(bank.bindings)
        || !roleMatchesPurpose
        || itemIds.has(item?.itemId) || itemDigests.has(item?.contentDigest)) {
      errors.push(`invalid, duplicate, or wrong-purpose bank item: ${String(item?.itemId || 'unknown')}`);
    }
    itemIds.add(item?.itemId);
    itemDigests.add(item?.contentDigest);
  }
  if (!DIGEST.test(String(bank.bankDigest || ''))
      || bank.bankDigest !== independentAssessmentBankDigest(bank)) {
    errors.push('independent assessment bank digest mismatch');
  }
  const authorPayload = independentAssessmentBankAttestationPayload(bank, 'author');
  const reviewerPayload = independentAssessmentBankAttestationPayload(bank, 'reviewer');
  if (!verifyAuthorityAttestation(bank.authorAttestation, {
    trustPolicy: options.trustPolicy,
    capability: 'bank_authoring',
  }) || canonicalJson(bank.authorAttestation?.payload) !== canonicalJson(authorPayload)) {
    errors.push('independent assessment bank author attestation is invalid');
  }
  if (!verifyAuthorityAttestation(bank.reviewerAttestation, {
    trustPolicy: options.trustPolicy,
    capability: 'bank_review',
  }) || canonicalJson(bank.reviewerAttestation?.payload) !== canonicalJson(reviewerPayload)) {
    errors.push('independent assessment bank reviewer attestation is invalid');
  }
  if (bank.authorAttestation?.authorityId === bank.reviewerAttestation?.authorityId) {
    errors.push('independent assessment bank author and reviewer must be distinct authorities');
  }
  if (typeof bank.truthBoundary !== 'string' || bank.truthBoundary.length < 1) {
    errors.push('independent assessment bank truth boundary is missing');
  }
  return { ok: errors.length === 0, errors };
}

export function validateIndependentAssessmentBank(bank, options = {}) {
  return validateIndependentAssessmentBankInternal(bank, {
    ...options,
    requireProductionTrust: true,
  });
}

export function validateIndependentAssessmentFixtureBank(bank, options = {}) {
  return validateIndependentAssessmentBankInternal(bank, {
    ...options,
    requireProductionTrust: false,
  });
}

export function materializeIndependentAssessmentItem(item, { bank = null } = {}) {
  const promptBytes = decodePrompt(item?.content);
  if (!promptBytes
      || !DIGEST.test(String(item?.contentDigest || ''))
      || item.contentDigest !== independentAssessmentContentDigest(item)
      || !validChecker(item.checker)
      || ![true, false].includes(item.fixtureOnly)
      || (item.fixtureOnly
        ? item.assessmentClass !== 'controlled_fixture_only'
        : item.assessmentClass !== 'independently_authored_concept_specific')
      || typeof item.truthBoundary !== 'string'
      || item.truthBoundary.length < 1) {
    throw new Error('cannot materialize an invalid or unbound independent assessment record');
  }
  if (bank !== null) {
    if (!Array.isArray(bank?.items)
        || bank.fixtureOnly !== item.fixtureOnly
        || bank.assessmentClass !== item.assessmentClass
        || bank.bankDigest !== independentAssessmentBankDigest(bank)
        || !bank.items.some((candidate) => (
          canonicalJson(candidate) === canonicalJson(item)
        ))) {
      throw new Error('cannot materialize substituted independent assessment bank identity');
    }
  }
  return {
    schemaVersion: 'cortex.learning_os.exam_item.v0',
    itemId: item.itemId,
    fixtureOnly: item.fixtureOnly,
    prompt: promptBytes.toString('utf8'),
    conceptIds: [item.conceptId],
    difficulty: item.assessmentRole,
    answerFormat: item.answerFormat,
    checker: structuredClone(item.checker.specification),
    independentAssessment: {
      schemaVersion: item.schemaVersion,
      itemContentDigest: item.contentDigest,
      checkerSpecificationSha256: item.checker.specificationSha256,
      bankId: bank?.bankId || null,
      bankDigest: bank?.bankDigest || null,
      assessmentClass: item.assessmentClass,
      fixtureOnly: item.fixtureOnly,
      sourceTruthBoundary: item.truthBoundary,
      campaign: structuredClone(item.bindings.campaign),
    },
    truthBoundary: item.truthBoundary,
  };
}

function executeIndependentAssessmentItemInternal({ item, answer, options, requireProductionTrust }) {
  const validation = validateIndependentAssessmentItemInternal(item, {
    ...options,
    requireProductionTrust,
  });
  if (!validation.ok) throw new Error(`invalid independent assessment item: ${validation.errors.join('; ')}`);
  if (options?.bank !== null && options?.bank !== undefined) {
    const bankValidation = validateIndependentAssessmentBankInternal(options.bank, {
      ...options,
      requireProductionTrust,
    });
    if (!bankValidation.ok
        || !options.bank.items.some((candidate) => (
          canonicalJson(candidate) === canonicalJson(item)
        ))) {
      throw new Error(`invalid or substituted independent assessment bank: ${bankValidation.errors.join('; ')}`);
    }
  }
  const answerBytes = Buffer.from(
    typeof answer === 'string' ? answer : canonicalJson(answer),
    'utf8',
  );
  if (answerBytes.length > item.resourceLimits.maxAnswerBytes) {
    throw new Error('independent assessment answer exceeds signed resource limit');
  }
  const started = process.hrtime.bigint();
  const grading = checkAnswer(answer, item.checker.specification);
  const runtimeMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  if (runtimeMs > item.resourceLimits.maxCheckerRuntimeMs) {
    throw new Error('independent assessment checker exceeded signed runtime limit');
  }
  if (grading.status === 'error') throw new Error('independent assessment checker failed closed');
  return {
    item: materializeIndependentAssessmentItem(item, { bank: options?.bank }),
    grading,
    checkerRuntimeMs: runtimeMs,
    itemContentDigest: item.contentDigest,
    checkerSpecificationSha256: item.checker.specificationSha256,
  };
}

export function executeIndependentAssessmentItem({ item, answer, ...options } = {}) {
  return executeIndependentAssessmentItemInternal({
    item,
    answer,
    options,
    requireProductionTrust: true,
  });
}

export function executeIndependentAssessmentFixtureItem({ item, answer, ...options } = {}) {
  return executeIndependentAssessmentItemInternal({
    item,
    answer,
    options,
    requireProductionTrust: false,
  });
}

export function selectIndependentAssessmentItem({
  bank,
  conceptId,
  assessmentRole,
  selectionNonce,
} = {}) {
  if (!IDENTIFIER.test(String(conceptId || ''))
      || !ASSESSMENT_ROLES.has(assessmentRole)
      || typeof selectionNonce !== 'string' || selectionNonce.length < 1 || selectionNonce.length > 512) {
    throw new Error('invalid independent assessment selection request');
  }
  const candidates = (bank?.items || []).filter((item) => (
    item.conceptId === conceptId && item.assessmentRole === assessmentRole
  ));
  if (candidates.length < 1) {
    throw new Error(`independent assessment bank has no ${assessmentRole} item for ${conceptId}`);
  }
  return [...candidates].sort((left, right) => (
    sha256Text(`${selectionNonce}:${left.itemId}`).localeCompare(
      sha256Text(`${selectionNonce}:${right.itemId}`),
    )
  ))[0];
}

const PREFIX_TRACKS = [
  [/^proof-/, 'proof-foundations'],
  [/^linear-algebra-/, 'advanced-linear-algebra'],
  [/^real-analysis-/, 'real-analysis'],
  [/^complex-analysis-/, 'complex-analysis'],
  [/^functional-analysis-/, 'functional-analysis'],
  [/^harmonic-analysis-/, 'harmonic-analysis'],
  [/^(abstract-algebra-)/, 'abstract-algebra'],
  [/^commutative-algebra-/, 'commutative-algebra'],
  [/^topology-/, 'topology'],
  [/^algebraic-topology-/, 'algebraic-topology'],
  [/^differential-geometry-/, 'differential-geometry'],
  [/^differential-equations-/, 'differential-equations-dynamical-systems'],
  [/^(measure-theory-|probability-|stochastic-processes-)/, 'measure-probability-stochastic'],
  [/^statistics-/, 'statistics'],
  [/^(combinatorics-|graph-theory-)/, 'combinatorics-graph-theory'],
  [/^number-theory-/, 'number-theory'],
  [/^(logic-|set-theory-)/, 'logic-set-theory'],
  [/^(numerical-analysis-|optimization-)/, 'numerical-analysis-optimization'],
  [/^research-practice-/, 'research-practice'],
];

function hashInt(key, offset, maximum) {
  const digest = crypto.createHash('sha256').update(`${key}:${offset}`).digest();
  return digest.readUInt32BE(0) % maximum;
}

function integer(key, offset, minimum, maximum) {
  return minimum + hashInt(key, offset, maximum - minimum + 1);
}

function exact(prompt, expected, parameters) {
  return { prompt, answerFormat: 'number', checker: { mode: 'exact_number', expected }, parameters };
}

function tuple(prompt, expected, parameters) {
  return {
    prompt,
    answerFormat: 'ordered pair x,y',
    checker: { mode: 'ordered_numeric_tuple', expected },
    parameters,
  };
}

function choice(prompt, expected, parameters) {
  return { prompt, answerFormat: 'one letter', checker: { mode: 'multiple_choice', expected }, parameters };
}

function trackForConcept(conceptId) {
  return PREFIX_TRACKS.find(([pattern]) => pattern.test(conceptId))?.[1] || null;
}

const TRACK_SURFACES = {
  'proof-foundations': (key) => {
    const variant = hashInt(key, 0, 2);
    return choice(
      variant === 0
        ? 'Which is the logical negation of “for every x there exists y with P(x,y)”? A: for every x and y, not P; B: there exists x such that for every y, not P; C: there exists y such that for every x, not P; D: for every x there exists y with not P.'
        : 'To prove P → Q by contrapositive, which implication must be proved? A: Q → P; B: ¬P → ¬Q; C: ¬Q → ¬P; D: P ∧ ¬Q.',
      variant === 0 ? 'B' : 'C',
      { variant },
    );
  },
  'advanced-linear-algebra': (key) => {
    const dimension = integer(key, 0, 4, 12);
    const rank = integer(key, 1, 1, dimension - 1);
    return exact(`A linear map has a ${dimension}-dimensional domain and rank ${rank}. Compute its nullity.`, dimension - rank, { dimension, rank });
  },
  'real-analysis': (key) => {
    const slope = integer(key, 0, 2, 9);
    const epsilonDenominator = integer(key, 1, 2, 10);
    return exact(`For f(x)=${slope}x, give the largest simple δ of the form 1/n that proves |f(x)-f(a)|<1/${epsilonDenominator} whenever |x-a|<δ. Return n.`, slope * epsilonDenominator, { slope, epsilonDenominator });
  },
  'complex-analysis': (key) => {
    const coefficient = integer(key, 0, -9, 9) || 1;
    const pole = integer(key, 1, -5, 5);
    return exact(`Compute the residue at z=${pole} of ${coefficient}/(z-${pole}).`, coefficient, { coefficient, pole });
  },
  'functional-analysis': (key) => {
    const scalar = integer(key, 0, 2, 12);
    const norm = integer(key, 1, 1, 9);
    return exact(`A bounded operator T has operator norm ${norm}. Compute the operator norm of ${scalar}T.`, scalar * norm, { scalar, norm });
  },
  'harmonic-analysis': (key) => {
    const coefficient = integer(key, 0, 1, 8);
    return exact(`Under the orthonormal Fourier basis on the circle, a function has exactly two nonzero coefficients, ${coefficient} and ${coefficient + 1}. Compute the square of its L2 norm by Parseval.`, coefficient ** 2 + (coefficient + 1) ** 2, { coefficient });
  },
  'abstract-algebra': (key) => {
    const kernel = integer(key, 0, 2, 8);
    const image = integer(key, 1, 2, 9);
    return exact(`A homomorphism of finite groups has kernel size ${kernel} and image size ${image}. Compute the order of its domain.`, kernel * image, { kernel, image });
  },
  'commutative-algebra': (key) => {
    const prime = [2, 3, 5, 7][hashInt(key, 0, 4)];
    return choice(`In the localization Z_(p) at p=${prime}, which integers become units? A: only ±1; B: exactly integers divisible by p; C: exactly integers not divisible by p; D: no integers.`, 'C', { prime });
  },
  topology: (key) => {
    const points = integer(key, 0, 2, 12);
    return choice(`Let X be a discrete space with ${points} points. Which statement is true? A: only ∅ is open; B: every subset is open and closed; C: X is connected when it has more than one point; D: no singleton is compact.`, 'B', { points });
  },
  'algebraic-topology': (key) => {
    const vertices = integer(key, 0, 3, 12);
    const edges = integer(key, 1, vertices, vertices + 8);
    const faces = integer(key, 2, 1, 7);
    return exact(`A finite 2-dimensional cell complex has ${vertices} vertices, ${edges} edges, and ${faces} faces. Compute its Euler characteristic.`, vertices - edges + faces, { vertices, edges, faces });
  },
  'differential-geometry': (key) => {
    const genus = integer(key, 0, 0, 4);
    return exact(`For a closed orientable surface of genus ${genus}, compute its Euler characteristic, the integer multiplying 2π in Gauss–Bonnet.`, 2 - 2 * genus, { genus });
  },
  'differential-equations-dynamical-systems': (key) => {
    const a = integer(key, 0, 1, 5);
    const c = integer(key, 1, 1, 5);
    const b = integer(key, 2, 0, Math.max(0, Math.floor(Math.sqrt(a * c)) - 1));
    return choice(`Classify ${a}u_xx + ${2 * b}u_xy + ${c}u_yy=0 using B²-AC. A: elliptic; B: parabolic; C: hyperbolic; D: first order.`, 'A', { a, b, c });
  },
  'measure-probability-stochastic': (key) => {
    const left = integer(key, 0, -8, 3);
    const right = integer(key, 1, 4, 12);
    return exact(`A random variable takes values ${left} and ${right} with equal probability. Compute its expectation.`, (left + right) / 2, { left, right });
  },
  statistics: (key) => {
    const successes = integer(key, 0, 1, 8);
    const trials = integer(key, 1, successes + 1, 12);
    return exact(`For ${successes} successes in ${trials} Bernoulli trials, compute the maximum-likelihood estimate of p.`, successes / trials, { successes, trials });
  },
  'combinatorics-graph-theory': (key) => {
    const vertices = integer(key, 0, 3, 10);
    const degree = integer(key, 1, 1, vertices - 1);
    const evenDegree = degree + ((vertices * degree) % 2);
    return exact(`A finite graph has ${vertices} vertices, each of degree ${evenDegree}. Compute its number of edges.`, vertices * evenDegree / 2, { vertices, degree: evenDegree });
  },
  'number-theory': (key) => {
    const moduli = [[3, 5], [4, 5], [5, 7]][hashInt(key, 0, 3)];
    const [m, n] = moduli;
    const solution = integer(key, 1, 0, m * n - 1);
    return exact(`Find the least nonnegative x satisfying x≡${solution % m} (mod ${m}) and x≡${solution % n} (mod ${n}).`, solution, { m, n, solution });
  },
  'logic-set-theory': (key) => {
    const variant = hashInt(key, 0, 2);
    return choice(
      variant === 0
        ? 'In classical first-order logic, which condition makes an implication P→Q false? A: P false, Q false; B: P false, Q true; C: P true, Q false; D: P true, Q true.'
        : 'Which pair of injections is enough to prove |A|=|B|? A: A→B only; B: B→A only; C: both A→B and B→A; D: neither.',
      'C',
      { variant },
    );
  },
  'numerical-analysis-optimization': (key) => {
    const scalar = integer(key, 0, 2, 12);
    return exact(`For the scalar problem f(x)=${scalar}x, compute the relative condition number |x f'(x)/f(x)| at any nonzero x.`, 1, { scalar });
  },
  'research-practice': (key) => {
    const variant = hashInt(key, 0, 2);
    return choice(
      variant === 0
        ? 'Which novelty statement is justified when a frozen corpus search finds no match? A: globally novel; B: novel in all future literature; C: no match in the declared frozen corpus only; D: peer review is unnecessary.'
        : 'Which arrangement supplies independent reproduction? A: the author reruns the same session; B: a distinct reproducer uses the frozen environment and verifies result digests; C: the reviewer accepts without execution; D: the candidate edits canonical state.',
      variant === 0 ? 'C' : 'B',
      { variant },
    );
  },
};

export function supportsPhdAssessmentConcept(conceptId) {
  const track = trackForConcept(String(conceptId || ''));
  return track !== null && Object.hasOwn(TRACK_SURFACES, track);
}

export function generatePhdAssessment({ conceptId, seed, role } = {}) {
  const track = trackForConcept(String(conceptId || ''));
  if (!track || !Object.hasOwn(TRACK_SURFACES, track)) {
    throw new Error(`unsupported PhD assessment conceptId: ${String(conceptId)}`);
  }
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 256) throw new Error('PhD assessment seed is invalid');
  const key = `${conceptId}:${role}:${seed}:phd-assessment-v1`;
  const built = TRACK_SURFACES[track](key);
  const parameters = {
    ...built.parameters,
    track,
    conceptBinding: sha256Text(conceptId),
    variant: sha256Text(key).slice(0, 16),
  };
  const family = `phd-${track}-v1`;
  const checker = built.checker;
  return {
    schemaVersion: 'cortex.learning_os.exam_item.v0',
    itemId: `phd-${sha256Text(key).slice(0, 24)}`,
    fixtureOnly: true,
    prompt: `[${conceptId}] ${built.prompt}`,
    conceptIds: [conceptId],
    difficulty: role,
    answerFormat: built.answerFormat,
    checker,
    generation: {
      schemaVersion: 'cortex.learning_os.exercise_generation.v1',
      generatorVersion: PHD_ASSESSMENT_GENERATOR_VERSION,
      assessmentClass: 'synthetic_track_drill_unqualified',
      family,
      conceptId,
      seed,
      role,
      parameters,
      oracleDigest: sha256Text(canonicalJson({ family, parameters, checker })),
    },
    truthBoundary: 'This deterministic broad-track drill does not assess the named concept outcome and is ineligible for production acquisition, retention, or qualification.',
  };
}

export function replayPhdAssessment(item) {
  const generation = item?.generation;
  const regenerated = generatePhdAssessment({
    conceptId: generation?.conceptId,
    seed: generation?.seed,
    role: generation?.role,
  });
  if (canonicalJson(regenerated) !== canonicalJson(item)) throw new Error('PhD assessment replay mismatch');
  return regenerated;
}

export function verifyPhdAssessmentAnswer({ item, answer } = {}) {
  replayPhdAssessment(item);
  return checkAnswer(answer, item.checker);
}
