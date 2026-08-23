import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from './registry.mjs';
import { matcherDescriptor } from './transfer.mjs';

export const TRANSFER_REGISTRY_SCHEMA = 'cortex.learning_os.live_transfer_registry.v1';
export const TRANSFER_ENTRY_SCHEMA = 'cortex.learning_os.live_transfer_entry.v1';
export const TRANSFER_TELEMETRY_SCHEMA = 'cortex.learning_os.transfer_telemetry.v1';
const SIGNATURE_ALGORITHM = 'hmac-sha256';
const DIGEST = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const REGISTRY_KEYS = new Set(['schemaVersion', 'revision', 'updatedAt', 'enabled', 'entries', 'signature']);
const ENTRY_KEYS = new Set([
  'schemaVersion', 'entryId', 'profileId', 'profileVersion', 'conceptIds', 'matcherId',
  'enabled', 'qualificationState', 'activationBasis', 'qualificationRunId', 'artifactManifestDigest',
  'evidenceDigest', 'profileDigest', 'qualifiedAt', 'expiresAt', 'allowedAgentIds', 'context',
]);
const CONTEXT_KEYS = new Set([
  'applicabilityReason', 'assumptions', 'contraindications', 'computationalFormulation',
  'implementationPatterns', 'verificationOracle', 'complexityRisk', 'numericalRisk', 'truthBoundary',
]);
const ASSUMPTION_KEYS = new Set(['code', 'description']);

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function only(value, keys) {
  return record(value) && Object.keys(value).every((key) => keys.has(key));
}

function text(value, max, pattern = null) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && (!pattern || pattern.test(value));
}

function stringList(value, { min = 1, max = 16, itemMax = 1000, pattern = null } = {}) {
  return Array.isArray(value) && value.length >= min && value.length <= max
    && new Set(value).size === value.length
    && value.every((item) => text(item, itemMax, pattern));
}

function signatureKeyId(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

function unsigned(value) {
  const { signature: _signature, ...payload } = value;
  return payload;
}

export function validateTransferEntry(entry, { now = Date.now(), allowExpired = true } = {}) {
  const errors = [];
  if (!only(entry, ENTRY_KEYS)) return { ok: false, errors: ['transfer entry must contain only allowed fields'] };
  if (entry.schemaVersion !== TRANSFER_ENTRY_SCHEMA) errors.push('invalid transfer entry schemaVersion');
  if (!text(entry.entryId, 160, ID)) errors.push('invalid entryId');
  if (!text(entry.profileId, 128, /^[a-z0-9][a-z0-9-]*$/)) errors.push('invalid profileId');
  if (!text(entry.profileVersion, 32)) errors.push('invalid profileVersion');
  const matcher = matcherDescriptor(entry.matcherId);
  if (!matcher || matcher.profileId !== entry.profileId) errors.push('matcher/profile mismatch');
  if (!stringList(entry.conceptIds, { max: 8, itemMax: 128, pattern: /^[a-z0-9][a-z0-9-]*$/ })
      || matcher && canonicalJson(entry.conceptIds) !== canonicalJson(matcher.conceptIds)) errors.push('invalid conceptIds');
  if (typeof entry.enabled !== 'boolean') errors.push('invalid entry enabled flag');
  const activationBasis = entry.activationBasis || (entry.qualificationState === 'qualified' ? 'independent_qualification' : '');
  if (!['qualified', 'operator_enabled'].includes(entry.qualificationState)) errors.push('entry is not active');
  if (entry.qualificationState === 'qualified' && activationBasis !== 'independent_qualification') errors.push('qualified entry requires independent_qualification activationBasis');
  if (entry.qualificationState === 'operator_enabled' && activationBasis !== 'operator_direct') errors.push('operator entry requires operator_direct activationBasis');
  if (entry.qualificationState === 'operator_enabled' && entry.enabled !== false) errors.push('operator entry must remain disabled outside independent qualification');
  if (entry.activationBasis !== undefined && !['independent_qualification', 'operator_direct'].includes(entry.activationBasis)) errors.push('invalid activationBasis');
  if (!text(entry.qualificationRunId, 160, ID)) errors.push('invalid qualificationRunId');
  for (const field of ['artifactManifestDigest', 'evidenceDigest', 'profileDigest']) {
    if (entry.qualificationState === 'qualified') {
      if (!text(entry[field], 64, DIGEST)) errors.push(`invalid ${field}`);
    } else if (entry[field] !== null) {
      errors.push(`operator proposal ${field} must be null`);
    }
  }
  const qualifiedAt = Date.parse(String(entry.qualifiedAt || ''));
  const expiresAt = Date.parse(String(entry.expiresAt || ''));
  if (!Number.isFinite(qualifiedAt)) errors.push('invalid qualifiedAt');
  if (!Number.isFinite(expiresAt) || expiresAt <= qualifiedAt) errors.push('invalid expiresAt');
  if (!allowExpired && Number.isFinite(expiresAt) && expiresAt <= now) errors.push('transfer entry expired');
  if (!stringList(entry.allowedAgentIds, { max: 16, itemMax: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })) errors.push('invalid allowedAgentIds');
  if (!only(entry.context, CONTEXT_KEYS)) errors.push('invalid context');
  else {
    for (const field of ['applicabilityReason', 'computationalFormulation', 'verificationOracle', 'complexityRisk', 'numericalRisk', 'truthBoundary']) {
      if (!text(entry.context[field], 2000)) errors.push(`invalid context.${field}`);
    }
    if (!Array.isArray(entry.context.assumptions) || entry.context.assumptions.length < 1 || entry.context.assumptions.length > 16
        || entry.context.assumptions.some((item) => !only(item, ASSUMPTION_KEYS)
          || !text(item.code, 128, /^[a-z0-9][a-z0-9._-]*$/) || !text(item.description, 1000))) errors.push('invalid context.assumptions');
    if (!stringList(entry.context.contraindications, { max: 16 })) errors.push('invalid context.contraindications');
    if (!stringList(entry.context.implementationPatterns, { max: 8 })) errors.push('invalid context.implementationPatterns');
  }
  return { ok: errors.length === 0, errors };
}

export function signTransferRegistry(registry, secret) {
  if (!text(secret, 4096) || secret.length < 32) throw new Error('transfer registry HMAC secret is missing or invalid');
  const payload = unsigned(registry);
  return {
    ...payload,
    signature: {
      algorithm: SIGNATURE_ALGORITHM,
      keyId: signatureKeyId(secret),
      digest: crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex'),
    },
  };
}

export function verifyTransferRegistry(registry, secret, { now = Date.now(), allowExpiredEntries = true } = {}) {
  const errors = [];
  if (!only(registry, REGISTRY_KEYS)) return { ok: false, errors: ['transfer registry must contain only allowed fields'] };
  if (registry.schemaVersion !== TRANSFER_REGISTRY_SCHEMA) errors.push('invalid transfer registry schemaVersion');
  if (!Number.isSafeInteger(registry.revision) || registry.revision < 0) errors.push('invalid transfer registry revision');
  if (!Number.isFinite(Date.parse(String(registry.updatedAt || '')))) errors.push('invalid transfer registry updatedAt');
  if (typeof registry.enabled !== 'boolean') errors.push('invalid transfer registry enabled flag');
  if (!Array.isArray(registry.entries) || registry.entries.length > 320) errors.push('invalid transfer entries');
  else {
    const ids = new Set();
    const contracts = new Set();
    for (const entry of registry.entries) {
      const result = validateTransferEntry(entry, { now, allowExpired: allowExpiredEntries });
      errors.push(...result.errors.map((error) => `${String(entry?.entryId || 'unknown')}: ${error}`));
      if (ids.has(entry?.entryId)) errors.push(`duplicate entryId: ${entry.entryId}`);
      const contractKey = `${String(entry?.profileId || '')}\u0000${String(entry?.matcherId || '')}`;
      if (contracts.has(contractKey)) errors.push(`duplicate profile/matcher contract: ${entry.profileId}:${entry.matcherId}`);
      ids.add(entry?.entryId);
      contracts.add(contractKey);
    }
  }
  if (!only(registry.signature, new Set(['algorithm', 'keyId', 'digest']))) errors.push('invalid transfer registry signature');
  else if (registry.signature.algorithm !== SIGNATURE_ALGORITHM
      || registry.signature.keyId !== signatureKeyId(secret)
      || !text(registry.signature.digest, 64, DIGEST)) errors.push('invalid transfer registry signature');
  else {
    const actual = Buffer.from(registry.signature.digest, 'hex');
    const expected = crypto.createHmac('sha256', secret).update(canonicalJson(unsigned(registry))).digest();
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) errors.push('transfer registry signature mismatch');
  }
  return { ok: errors.length === 0, errors };
}

function safeOwnerFile(filePath, label) {
  const target = path.resolve(filePath);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`${label} owner mismatch`);
  return target;
}

export function readTransferRegistrySecret(secretPath) {
  const value = fs.readFileSync(safeOwnerFile(secretPath, 'transfer registry secret'), 'utf8').trim();
  if (value.length < 32 || value.length > 4096) throw new Error('invalid transfer registry secret length');
  return value;
}

export function loadSignedTransferRegistry(registryPath, secret, options = {}) {
  const registry = JSON.parse(fs.readFileSync(safeOwnerFile(registryPath, 'transfer registry'), 'utf8'));
  const verification = verifyTransferRegistry(registry, secret, options);
  if (!verification.ok) throw new Error(`transfer registry verification failed: ${verification.errors.join('; ')}`);
  return registry;
}

export function emptyTransferRegistry(now = new Date().toISOString()) {
  return {
    schemaVersion: TRANSFER_REGISTRY_SCHEMA,
    revision: 0,
    updatedAt: now,
    enabled: true,
    entries: [],
  };
}

export function atomicWriteSignedTransferRegistry(registryPath, registry, secret) {
  const target = path.resolve(registryPath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.chmodSync(parent, 0o700);
  if (fs.existsSync(target)) safeOwnerFile(target, 'transfer registry');
  const signed = signTransferRegistry(registry, secret);
  const validation = verifyTransferRegistry(signed, secret, { allowExpiredEntries: true });
  if (!validation.ok) throw new Error(`refusing invalid transfer registry: ${validation.errors.join('; ')}`);
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  const descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(signed, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
  const directory = fs.openSync(parent, fs.constants.O_RDONLY);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  return signed;
}

export function initializeTransferRegistry({ registryPath, secretPath, now = new Date().toISOString() } = {}) {
  const resolvedSecret = path.resolve(secretPath);
  fs.mkdirSync(path.dirname(resolvedSecret), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(resolvedSecret)) fs.writeFileSync(resolvedSecret, `${crypto.randomBytes(48).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  const secret = readTransferRegistrySecret(resolvedSecret);
  if (fs.existsSync(registryPath)) return { registry: loadSignedTransferRegistry(registryPath, secret), secret };
  return { registry: atomicWriteSignedTransferRegistry(registryPath, emptyTransferRegistry(now), secret), secret };
}

export function selectQualifiedTransferEntries(registry, route, { agentId, now = Date.now() } = {}) {
  if (!registry?.enabled || !route?.applicable || route.codingContext !== true) return [];
  const applicable = new Set(route.selections
    .filter((row) => row.applicable === true && row.negativeGateCodes.length === 0)
    .map((row) => `${row.profileId}:${row.matcherId}`));
  return registry.entries
    .filter((entry) => entry.enabled && entry.qualificationState === 'qualified'
      && (entry.activationBasis === undefined || entry.activationBasis === 'independent_qualification'))
    .filter((entry) => Date.parse(entry.expiresAt) > now)
    .filter((entry) => entry.allowedAgentIds.includes(agentId))
    .filter((entry) => applicable.has(`${entry.profileId}:${entry.matcherId}`))
    .sort((left, right) => left.profileId.localeCompare(right.profileId))
    .slice(0, 3);
}

export function renderTransferContext(entries, route, { maxChars = 6000 } = {}) {
  if (!entries.length) return '';
  const legacyOnly = entries.every((entry) => entry.matcherId.startsWith('code-'));
  const lines = [
    legacyOnly ? 'CORTEX_LEARNING_OS_CODING_TRANSFER' : 'CORTEX_LEARNING_OS_PHD_MATH_TRANSFER',
    'mode: active_independently_qualified_transfer',
    'Use only the selected concepts whose observed assumptions hold; keep definitions, prerequisites, and boundaries explicit.',
    'Verify the result; full catalog coverage does not establish retained mastery, empirical benefit, or PhD equivalence.',
  ];
  for (const entry of entries) {
    const decision = route.selections.find((row) => row.profileId === entry.profileId && row.matcherId === entry.matcherId);
    lines.push(`profile_id: ${entry.profileId}`);
    lines.push(`concept_ids: ${entry.conceptIds.join(', ')}`);
    lines.push(`matcher_id: ${entry.matcherId}`);
    lines.push(`activation_basis: ${entry.activationBasis || 'independent_qualification'}`);
    lines.push(`applicability_reason: ${decision.applicabilityReasonCodes.join(', ')}; ${entry.context.applicabilityReason}`);
    lines.push(`observed_assumptions: ${decision.observedAssumptionCodes.join(', ')}`);
    for (const assumption of entry.context.assumptions) lines.push(`assumption_${assumption.code}: ${assumption.description}`);
    lines.push('contraindications:');
    for (const item of entry.context.contraindications) lines.push(`- ${item}`);
    lines.push(`computational_formulation: ${entry.context.computationalFormulation}`);
    lines.push('bounded_implementation_patterns:');
    for (const item of entry.context.implementationPatterns) lines.push(`- ${item}`);
    lines.push(`verification_oracle: ${entry.context.verificationOracle}`);
    lines.push(`complexity_risk: ${entry.context.complexityRisk}`);
    lines.push(`numerical_risk: ${entry.context.numericalRisk}`);
    lines.push(`evidence_digest: ${entry.evidenceDigest}`);
    lines.push(`expires_at: ${entry.expiresAt}`);
    lines.push(`truth_boundary: ${entry.context.truthBoundary}`);
  }
  const rendered = lines.join('\n');
  return rendered.length <= maxChars ? rendered : '';
}
