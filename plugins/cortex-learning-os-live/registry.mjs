import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REGISTRY_SCHEMA = 'cortex.learning_os.live_registry.v1';
export const LESSON_SCHEMA = 'cortex.learning_os.live_lesson.v1';
export const TELEMETRY_SCHEMA = 'cortex.learning_os.live_telemetry.v1';
export const SIGNATURE_ALGORITHM = 'hmac-sha256';
export const ACTIVATION_PROFILES = new Set([
  'exact_multiplication',
  'linear_equation',
  'quadratic_roots',
  'function_evaluation',
  'inverse_function',
  'geometric_series',
  'absolute_value_equation',
  'binomial_probability',
  'complement_probability',
  'combinations_permutations',
]);

const REGISTRY_KEYS = new Set(['schemaVersion', 'revision', 'updatedAt', 'enabled', 'lessons', 'signature']);
const SIGNATURE_KEYS = new Set(['algorithm', 'keyId', 'digest']);
const LESSON_KEYS = new Set([
  'schemaVersion', 'lessonId', 'capsuleId', 'domain', 'conceptIds', 'rule',
  'contraindications', 'promotionProofDigest', 'promotedAt', 'retestAfter',
  'activationProfiles', 'enabled', 'source',
]);
const SOURCE_KEYS = new Set([
  'runId', 'trustedLessonSha256', 'promotionReportSha256', 'artifactManifestSha256',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedString(value, maximum, { pattern = null, allowEmpty = false } = {}) {
  return typeof value === 'string'
    && value.length <= maximum
    && (allowEmpty || value.length > 0)
    && (!pattern || pattern.test(value));
}

export function canonicalJson(value) {
  const active = new Set();
  const serialize = (candidate) => {
    if (candidate === null) return 'null';
    if (typeof candidate === 'string' || typeof candidate === 'boolean') {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        throw new TypeError('canonical JSON rejects non-finite numbers');
      }
      return JSON.stringify(candidate);
    }
    if (typeof candidate !== 'object') {
      throw new TypeError(`canonical JSON rejects ${typeof candidate} values`);
    }
    if (active.has(candidate)) throw new TypeError('canonical JSON rejects cyclic values');
    const prototype = Object.getPrototypeOf(candidate);
    if (!Array.isArray(candidate)
        && prototype !== Object.prototype
        && prototype !== null) {
      throw new TypeError('canonical JSON accepts only arrays and plain objects');
    }
    active.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        const ownKeys = Reflect.ownKeys(candidate);
        if (ownKeys.length !== candidate.length + 1
            || ownKeys.some((key) => (
              key !== 'length'
              && (typeof key !== 'string'
                || !/^(0|[1-9]\d*)$/.test(key)
                || Number(key) >= candidate.length)
            ))) {
          throw new TypeError('canonical JSON rejects sparse or extended arrays');
        }
        for (let index = 0; index < candidate.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError('canonical JSON rejects sparse arrays');
          }
        }
        return `[${candidate.map(serialize).join(',')}]`;
      }
      const ownKeys = Reflect.ownKeys(candidate);
      const keys = Object.keys(candidate);
      if (ownKeys.length !== keys.length
          || keys.some((key) => !Object.hasOwn(
            Object.getOwnPropertyDescriptor(candidate, key),
            'value',
          ))) {
        throw new TypeError('canonical JSON rejects symbols, accessors, or hidden fields');
      }
      return `{${keys.sort().map((key) => (
        `${JSON.stringify(key)}:${serialize(candidate[key])}`
      )).join(',')}}`;
    } finally {
      active.delete(candidate);
    }
  };
  return serialize(value);
}

function normalizedSemanticText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function liveLessonSemanticKey(lesson) {
  const payload = {
    schemaVersion: 'cortex.learning_os.live_lesson_semantic_key.v1',
    capsuleId: String(lesson?.capsuleId || ''),
    domain: String(lesson?.domain || ''),
    conceptIds: [...new Set((lesson?.conceptIds || []).map(String))].sort(),
    rule: normalizedSemanticText(lesson?.rule),
    contraindications: [...new Set((lesson?.contraindications || []).map(normalizedSemanticText))].sort(),
    activationProfiles: [...new Set((lesson?.activationProfiles || []).map(String))].sort(),
  };
  return crypto.createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

export function deduplicateLiveLessons(lessons = []) {
  if (!Array.isArray(lessons)) throw new Error('lessons must be an array');
  const groups = new Map();
  for (const lesson of lessons) {
    const key = liveLessonSemanticKey(lesson);
    const group = groups.get(key) || [];
    group.push(lesson);
    groups.set(key, group);
  }
  const retained = [];
  const removedLessonIds = [];
  for (const group of groups.values()) {
    const ranked = [...group].sort((left, right) => (
      Date.parse(right.promotedAt) - Date.parse(left.promotedAt)
      || Date.parse(right.retestAfter) - Date.parse(left.retestAfter)
      || left.lessonId.localeCompare(right.lessonId)
    ));
    retained.push(ranked[0]);
    removedLessonIds.push(...ranked.slice(1).map((lesson) => lesson.lessonId));
  }
  return {
    lessons: retained.sort((left, right) => left.lessonId.localeCompare(right.lessonId)),
    removedLessonIds: [...new Set(removedLessonIds)].sort(),
  };
}

function signaturePayload(registry) {
  const { signature: _signature, ...payload } = registry;
  return canonicalJson(payload);
}

export function keyIdForSecret(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex').slice(0, 16);
}

export function signRegistry(registry, secret) {
  if (!boundedString(secret, 4_096)) throw new Error('registry HMAC secret is missing or invalid');
  const unsigned = { ...registry };
  delete unsigned.signature;
  const digest = crypto.createHmac('sha256', secret).update(signaturePayload(unsigned), 'utf8').digest('hex');
  return {
    ...unsigned,
    signature: {
      algorithm: SIGNATURE_ALGORITHM,
      keyId: keyIdForSecret(secret),
      digest,
    },
  };
}

export function validateLiveLesson(value, { now = Date.now(), allowExpired = false } = {}) {
  const errors = [];
  if (!isRecord(value) || !onlyKeys(value, LESSON_KEYS)) return { ok: false, errors: ['lesson must be an object with only allowed fields'] };
  if (value.schemaVersion !== LESSON_SCHEMA) errors.push('invalid lesson schemaVersion');
  if (!boundedString(value.lessonId, 128, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })) errors.push('invalid lessonId');
  if (!boundedString(value.capsuleId, 128, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })) errors.push('invalid capsuleId');
  if (value.domain !== 'math') errors.push('only the math domain is allowed');
  if (!Array.isArray(value.conceptIds) || value.conceptIds.length < 1 || value.conceptIds.length > 32
      || !value.conceptIds.every((item) => boundedString(item, 128, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ }))) errors.push('invalid conceptIds');
  if (!boundedString(value.rule, 2_000)) errors.push('invalid rule');
  if (!Array.isArray(value.contraindications) || value.contraindications.length < 1 || value.contraindications.length > 16
      || !value.contraindications.every((item) => boundedString(item, 1_000))) errors.push('invalid contraindications');
  if (!boundedString(value.promotionProofDigest, 64, { pattern: /^[0-9a-f]{64}$/ })) errors.push('invalid promotionProofDigest');
  const promotedAt = Date.parse(String(value.promotedAt || ''));
  const retestAfter = Date.parse(String(value.retestAfter || ''));
  if (!Number.isFinite(promotedAt)) errors.push('invalid promotedAt');
  if (!Number.isFinite(retestAfter) || retestAfter <= promotedAt) errors.push('invalid retestAfter');
  if (!allowExpired && Number.isFinite(retestAfter) && retestAfter <= now) errors.push('lesson is expired');
  if (!Array.isArray(value.activationProfiles) || value.activationProfiles.length < 1 || value.activationProfiles.length > 8
      || !value.activationProfiles.every((item) => ACTIVATION_PROFILES.has(item))
      || new Set(value.activationProfiles).size !== value.activationProfiles.length) errors.push('invalid activationProfiles');
  if (typeof value.enabled !== 'boolean') errors.push('invalid enabled flag');
  if (!isRecord(value.source) || !onlyKeys(value.source, SOURCE_KEYS)) errors.push('invalid source');
  else {
    if (!boundedString(value.source.runId, 160, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })) errors.push('invalid source.runId');
    for (const field of ['trustedLessonSha256', 'promotionReportSha256', 'artifactManifestSha256']) {
      if (!boundedString(value.source[field], 64, { pattern: /^[0-9a-f]{64}$/ })) errors.push(`invalid source.${field}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function verifyRegistry(registry, secret, { now = Date.now(), allowExpiredLessons = true } = {}) {
  const errors = [];
  if (!isRecord(registry) || !onlyKeys(registry, REGISTRY_KEYS)) return { ok: false, errors: ['registry must be an object with only allowed fields'] };
  if (registry.schemaVersion !== REGISTRY_SCHEMA) errors.push('invalid registry schemaVersion');
  if (!Number.isInteger(registry.revision) || registry.revision < 0 || registry.revision > Number.MAX_SAFE_INTEGER) errors.push('invalid registry revision');
  if (!Number.isFinite(Date.parse(String(registry.updatedAt || '')))) errors.push('invalid registry updatedAt');
  if (typeof registry.enabled !== 'boolean') errors.push('invalid registry enabled flag');
  if (!Array.isArray(registry.lessons) || registry.lessons.length > 1_000) errors.push('invalid registry lessons');
  else {
    const ids = new Set();
    for (const lesson of registry.lessons) {
      const result = validateLiveLesson(lesson, { now, allowExpired: allowExpiredLessons });
      errors.push(...result.errors.map((error) => `${String(lesson?.lessonId || 'unknown')}: ${error}`));
      if (ids.has(lesson?.lessonId)) errors.push(`duplicate lessonId: ${lesson.lessonId}`);
      ids.add(lesson?.lessonId);
    }
  }
  if (!isRecord(registry.signature) || !onlyKeys(registry.signature, SIGNATURE_KEYS)) errors.push('invalid registry signature');
  else {
    if (registry.signature.algorithm !== SIGNATURE_ALGORITHM) errors.push('invalid signature algorithm');
    if (registry.signature.keyId !== keyIdForSecret(secret)) errors.push('signature keyId mismatch');
    if (!boundedString(registry.signature.digest, 64, { pattern: /^[0-9a-f]{64}$/ })) errors.push('invalid signature digest');
    else {
      const supplied = Buffer.from(registry.signature.digest, 'hex');
      const expected = Buffer.from(
        crypto.createHmac('sha256', secret).update(signaturePayload(registry), 'utf8').digest('hex'),
        'hex',
      );
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) errors.push('registry signature mismatch');
    }
  }
  return { ok: errors.length === 0, errors };
}

function assertSafeRegularFile(filePath, { secret = false } = {}) {
  const target = path.resolve(filePath);
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${secret ? 'secret' : 'registry'} path must be a regular non-symlink file`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${secret ? 'secret' : 'registry'} file must not grant group or other permissions`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`${secret ? 'secret' : 'registry'} file owner does not match runtime user`);
  return target;
}

export function readRegistrySecret(secretPath) {
  const target = assertSafeRegularFile(secretPath, { secret: true });
  const secret = fs.readFileSync(target, 'utf8').trim();
  if (secret.length < 32 || secret.length > 4_096) throw new Error('registry secret length is outside the allowed range');
  return secret;
}

export function loadSignedRegistry(registryPath, secret, options = {}) {
  const target = assertSafeRegularFile(registryPath);
  const registry = JSON.parse(fs.readFileSync(target, 'utf8'));
  const verification = verifyRegistry(registry, secret, options);
  if (!verification.ok) throw new Error(`live registry verification failed: ${verification.errors.join('; ')}`);
  return registry;
}

export function emptyRegistry(now = new Date().toISOString()) {
  return {
    schemaVersion: REGISTRY_SCHEMA,
    revision: 0,
    updatedAt: now,
    enabled: true,
    lessons: [],
  };
}

export function atomicWriteSignedRegistry(registryPath, registry, secret) {
  const target = path.resolve(registryPath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.chmodSync(parent, 0o700);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('registry path cannot be a symbolic link');
  const signed = signRegistry(registry, secret);
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  const descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
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

export function initializeRegistry({ registryPath, secretPath, force = false, now = new Date().toISOString() } = {}) {
  const resolvedSecret = path.resolve(secretPath);
  const parent = path.dirname(resolvedSecret);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.chmodSync(parent, 0o700);
  if (!fs.existsSync(resolvedSecret)) {
    fs.writeFileSync(resolvedSecret, `${crypto.randomBytes(48).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  } else if (fs.lstatSync(resolvedSecret).isSymbolicLink()) {
    throw new Error('registry secret path cannot be a symbolic link');
  }
  fs.chmodSync(resolvedSecret, 0o600);
  const secret = readRegistrySecret(resolvedSecret);
  if (fs.existsSync(registryPath) && !force) {
    return { registry: loadSignedRegistry(registryPath, secret), secret };
  }
  return { registry: atomicWriteSignedRegistry(registryPath, emptyRegistry(now), secret), secret };
}

function operandDigits(value) {
  return String(value || '').replace(/[^0-9]/g, '').length;
}

export function activationProfilesForQuery(query) {
  const text = String(query || '').trim();
  const normalized = text.toLowerCase().replace(/[−–—]/g, '-');
  const profiles = new Set();
  const multiplication = normalized.match(/([+-]?\d[\d,]*(?:\.\d+)?)\s*(?:×|\*|\bx\b|\btimes\b|\bmultiplied\s+by\b)\s*([+-]?\d[\d,]*(?:\.\d+)?)/i);
  if (multiplication && (operandDigits(multiplication[1]) >= 2 || operandDigits(multiplication[2]) >= 2)
      && /\b(compute|calculate|multiply|product|exact|what\s+is|evaluate)\b/i.test(normalized)) profiles.add('exact_multiplication');
  if (/\bsolve\b/i.test(normalized) && /[a-z]\s*(?:[+\-*/]|=)|(?:=).*?[a-z]/i.test(normalized) && !/\bquadratic|\^2|²/i.test(normalized)) profiles.add('linear_equation');
  if (/\b(roots?|zeros?|solutions?)\b/i.test(normalized) && /(?:\^2|²|quadratic)/i.test(normalized)) profiles.add('quadratic_roots');
  if (/\b(?:f|g|h)\s*\([^)]*\)\s*=|\bevaluate\s+(?:f|g|h)\s*\(/i.test(normalized)) profiles.add('function_evaluation');
  if (/\b(?:inverse|f\s*\^\s*-?1|f⁻¹)\b/i.test(normalized)) profiles.add('inverse_function');
  if (/\b(?:geometric\s+series|infinite\s+(?:sum|series))\b/i.test(normalized) || /\.\.\./.test(normalized) && /\b(?:sum|compute)\b/i.test(normalized)) profiles.add('geometric_series');
  if (/\|[^|]+\|\s*=|\babsolute\s+value\b/i.test(normalized)) profiles.add('absolute_value_equation');
  if (/\b(?:exactly|at\s+least|at\s+most)\s+\d+\s+(?:heads?|successes?)\b/i.test(normalized)) profiles.add('binomial_probability');
  if (/\bprobability\b/i.test(normalized) && /\bat\s+least\s+one\b/i.test(normalized)) profiles.add('complement_probability');
  if (/\b(?:combination|permutation|choose|arrange|ordering)\b/i.test(normalized)) profiles.add('combinations_permutations');
  return [...profiles];
}

export function selectLiveLessons(registry, query, { now = Date.now(), maxLessons = 3 } = {}) {
  const profiles = activationProfilesForQuery(query);
  if (!registry?.enabled || profiles.length === 0) return { eligible: profiles.length > 0, profiles, lessons: [] };
  const profileSet = new Set(profiles);
  const lessons = registry.lessons
    .filter((lesson) => lesson.enabled)
    .filter((lesson) => Date.parse(lesson.retestAfter) > now)
    .map((lesson) => ({ lesson, overlap: lesson.activationProfiles.filter((profile) => profileSet.has(profile)).length }))
    .filter((row) => row.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || Date.parse(right.lesson.promotedAt) - Date.parse(left.lesson.promotedAt) || left.lesson.lessonId.localeCompare(right.lesson.lessonId))
    .slice(0, Math.max(1, Math.min(Number(maxLessons) || 3, 8)))
    .map((row) => row.lesson);
  return { eligible: true, profiles, lessons };
}

export function renderLearningContext(selection, { maxChars = 3_000 } = {}) {
  if (!selection?.lessons?.length) return '';
  const lines = [
    'CORTEX_LEARNING_OS_LIVE',
    'mode: active_verified_retrieval',
    `matched_profiles: ${selection.profiles.join(', ')}`,
    'Use the following verifier-promoted lessons only when they apply to the current math problem.',
    'Compute independently, obey each contraindication, and never claim broad mastery from these scoped lessons.',
  ];
  for (const lesson of selection.lessons) {
    lines.push(`lesson_id: ${lesson.lessonId}`);
    lines.push(`capsule_id: ${lesson.capsuleId}`);
    lines.push(`concepts: ${lesson.conceptIds.join(', ')}`);
    lines.push(`rule: ${lesson.rule}`);
    lines.push('contraindications:');
    for (const warning of lesson.contraindications) lines.push(`- ${warning}`);
    lines.push(`promotion_proof_digest: ${lesson.promotionProofDigest}`);
    lines.push(`retest_after: ${lesson.retestAfter}`);
  }
  const rendered = lines.join('\n');
  return rendered.length <= maxChars ? rendered : '';
}
