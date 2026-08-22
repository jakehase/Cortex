import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { matcherDescriptor } from '../../plugins/cortex-learning-os-live/transfer.mjs';
import { sha256Text } from './hash.mjs';
import { CLOS_ROOT } from './paths.mjs';

export const TRANSFER_PROFILE_SCHEMA = 'cortex.learning_os.transfer_profile.v1';
const PROFILE_FILES = Object.freeze({
  'exact-multiplication': path.join(CLOS_ROOT, 'profiles/transfer/exact-multiplication.v1.json'),
  'algebra-factoring': path.join(CLOS_ROOT, 'profiles/transfer/algebra-factoring.v1.json'),
});
const PROFILE_KEYS = new Set([
  'schemaVersion', 'profileId', 'version', 'mathConceptIds', 'semanticMatcherId',
  'activationConditions', 'requiredAssumptions', 'contraindications',
  'computationalFormulation', 'implementationPatterns', 'verification',
  'risks', 'qualificationPolicy', 'source', 'truthBoundary',
]);

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function only(value, keys) {
  return record(value) && Object.keys(value).every((key) => keys.has(key));
}

function bounded(value, maximum, pattern = null) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && (!pattern || pattern.test(value));
}

function codeList(value, { min = 1, max = 16 } = {}) {
  return Array.isArray(value) && value.length >= min && value.length <= max
    && new Set(value).size === value.length
    && value.every((item) => bounded(item, 128, /^[a-z0-9][a-z0-9._-]*$/));
}

export function computedProfileDigest(profile) {
  const payload = structuredClone(profile);
  if (payload?.source) delete payload.source.profileDigest;
  return sha256Text(canonicalJson(payload));
}

export function validateTransferProfile(profile, { conceptIds = null } = {}) {
  const errors = [];
  if (!only(profile, PROFILE_KEYS)) return { ok: false, errors: ['profile must contain only allowed fields'] };
  if (profile.schemaVersion !== TRANSFER_PROFILE_SCHEMA) errors.push('invalid transfer profile schemaVersion');
  if (!bounded(profile.profileId, 128, /^[a-z0-9][a-z0-9-]*$/)) errors.push('invalid profileId');
  if (!bounded(profile.version, 32)) errors.push('invalid profile version');
  if (!codeList(profile.mathConceptIds, { max: 8 })) errors.push('invalid mathConceptIds');
  if (conceptIds && profile.mathConceptIds.some((id) => !conceptIds.has(id))) errors.push('unknown math concept');
  const matcher = matcherDescriptor(profile.semanticMatcherId);
  if (!matcher || matcher.profileId !== profile.profileId
      || canonicalJson(matcher.conceptIds) !== canonicalJson(profile.mathConceptIds)) errors.push('profile matcher binding mismatch');
  if (!codeList(profile.activationConditions)) errors.push('invalid activationConditions');
  if (!Array.isArray(profile.requiredAssumptions) || profile.requiredAssumptions.length < 1 || profile.requiredAssumptions.length > 16
      || profile.requiredAssumptions.some((item) => !only(item, new Set(['code', 'description', 'observable']))
        || !bounded(item.code, 128, /^[a-z0-9][a-z0-9._-]*$/) || !bounded(item.description, 1000)
        || item.observable !== true)) errors.push('invalid requiredAssumptions');
  if (!Array.isArray(profile.contraindications) || profile.contraindications.length < 1 || profile.contraindications.length > 16
      || profile.contraindications.some((item) => !only(item, new Set(['code', 'description']))
        || !bounded(item.code, 128, /^[a-z0-9][a-z0-9._-]*$/) || !bounded(item.description, 1000))) errors.push('invalid contraindications');
  if (!bounded(profile.computationalFormulation, 2000)) errors.push('invalid computationalFormulation');
  if (!Array.isArray(profile.implementationPatterns) || profile.implementationPatterns.length < 1 || profile.implementationPatterns.length > 8
      || profile.implementationPatterns.some((item) => !bounded(item, 1000))) errors.push('invalid implementationPatterns');
  if (!only(profile.verification, new Set(['oracleId', 'strategy', 'deterministic']))
      || !['exact-integer-product-v1', 'integer-polynomial-identity-v1'].includes(profile.verification?.oracleId)
      || !bounded(profile.verification?.strategy, 2000) || profile.verification?.deterministic !== true) errors.push('invalid verification');
  if (!only(profile.risks, new Set(['complexity', 'numerical']))
      || !bounded(profile.risks?.complexity, 1000) || !bounded(profile.risks?.numerical, 1000)) errors.push('invalid risks');
  if (!only(profile.qualificationPolicy, new Set(['policyId', 'requiredFamilies', 'candidateArm', 'noTransferArm']))
      || profile.qualificationPolicy?.policyId !== 'coding-transfer-v0.9'
      || canonicalJson(profile.qualificationPolicy?.requiredFamilies) !== canonicalJson(['acquisition', 'held-out', 'negative-semantic', 'assumption-violation', 'regression'])
      || profile.qualificationPolicy?.candidateArm !== 'candidate' || profile.qualificationPolicy?.noTransferArm !== 'no-transfer') errors.push('invalid qualificationPolicy');
  if (!only(profile.source, new Set(['baseCommit', 'sourceDigest', 'profileDigest']))
      || !/^[0-9a-f]{40}$/.test(String(profile.source?.baseCommit || ''))
      || profile.source?.sourceDigest !== sha256Text(profile.source?.baseCommit)
      || profile.source?.profileDigest !== computedProfileDigest(profile)) errors.push('profile source/digest mismatch');
  if (!bounded(profile.truthBoundary, 2000)) errors.push('invalid truthBoundary');
  return { ok: errors.length === 0, errors };
}

export function loadTransferProfile(profileId, { graph = null } = {}) {
  const filePath = PROFILE_FILES[profileId];
  if (!filePath) throw new Error(`unknown transfer profile: ${profileId}`);
  const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const conceptIds = graph ? new Set(graph.concepts.map((concept) => concept.conceptId)) : null;
  const validation = validateTransferProfile(profile, { conceptIds });
  if (!validation.ok) throw new Error(`invalid transfer profile ${profileId}: ${validation.errors.join('; ')}`);
  return profile;
}

export function loadAllTransferProfiles(options = {}) {
  return Object.keys(PROFILE_FILES).map((profileId) => loadTransferProfile(profileId, options));
}

export function transferProfilePath(profileId) {
  if (!PROFILE_FILES[profileId]) throw new Error(`unknown transfer profile: ${profileId}`);
  return PROFILE_FILES[profileId];
}
