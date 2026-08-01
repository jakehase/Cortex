import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Text } from './hash.mjs';
import {
  assertDeploymentBinding,
  validateDeploymentBinding,
} from './deployment-identity.mjs';
import {
  DEFAULT_PROOF_KERNEL_ROOT,
  PINNED_LEAN_PROOF_CONTEXT,
  PINNED_LEAN_PROOF_IDENTITIES,
  PROOF_HOLE_MARKER,
  PROOF_TRUTH_BOUNDARY,
  preflightLeanProofKernel,
  validateProofRuntimeEvidence,
} from './lean-proof-preflight.mjs';

export const PROOF_TASK_SCHEMA = 'cortex.learning_os.proof_task.v1';
export const PROOF_CANDIDATE_SCHEMA = 'cortex.learning_os.proof_candidate.v1';
export const PROOF_EVIDENCE_SCHEMA = 'cortex.learning_os.proof_kernel_evidence.v1';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const IMPORT_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;
const MAX_RECORD_BYTES = 1024 * 1024;
const HARD_LIMITS = Object.freeze({
  timeoutMs: { minimum: 100, maximum: 30_000 },
  maxCandidateBytes: { minimum: 1, maximum: 64 * 1024 },
  maxSourceBytes: { minimum: 256, maximum: 256 * 1024 },
  maxStdoutBytes: { minimum: 256, maximum: 64 * 1024 },
  maxStderrBytes: { minimum: 256, maximum: 64 * 1024 },
  maxHeartbeats: { minimum: 1_000, maximum: 2_000_000 },
  maxRecDepth: { minimum: 100, maximum: 10_000 },
});
const DEFAULT_LIMITS = Object.freeze({
  timeoutMs: 10_000,
  maxCandidateBytes: 16 * 1024,
  maxSourceBytes: 128 * 1024,
  maxStdoutBytes: 32 * 1024,
  maxStderrBytes: 32 * 1024,
  maxHeartbeats: 500_000,
  maxRecDepth: 2_000,
});
const TASK_KEYS = Object.freeze([
  'schemaVersion',
  'taskId',
  'conceptId',
  'theorem',
  'trustedContext',
  'toolchain',
  'deployment',
  'runIdentity',
  'limits',
  'truthBoundary',
]);
const CANDIDATE_KEYS = Object.freeze([
  'schemaVersion',
  'candidateId',
  'taskId',
  'conceptId',
  'taskBinding',
  'theoremBinding',
  'trustedContextBinding',
  'toolchain',
  'deployment',
  'runIdentity',
  'proof',
  'truthBoundary',
]);
const EVIDENCE_KEYS = Object.freeze([
  'schemaVersion',
  'evidenceId',
  'taskId',
  'candidateId',
  'conceptId',
  'bindings',
  'toolchain',
  'deployment',
  'runIdentity',
  'limits',
  'kernel',
  'command',
  'startedAt',
  'completedAt',
  'durationMs',
  'process',
  'output',
  'kernelAccepted',
  'truthBoundary',
]);
const BANNED_IDENTIFIERS = Object.freeze([
  'sorry',
  'admit',
  'sorryAx',
  'axiom',
  'opaque',
  'unsafe',
  'unsafeCast',
  'lcProof',
  'partial',
  'extern',
  'implemented_by',
  'import',
  'prelude',
  'theorem',
  'lemma',
  'def',
  'abbrev',
  'example',
  'instance',
  'structure',
  'inductive',
  'class',
  'constant',
  'namespace',
  'section',
  'end',
  'open',
  'export',
  'universe',
  'variable',
  'include',
  'omit',
  'attribute',
  'initialize',
  'builtin',
  'syntax',
  'macro',
  'elab',
  'command',
  'scoped',
  'mutual',
  'where',
  'set_option',
  'run_tac',
  'eval_tac',
  'native_decide',
  'include_str',
  'load_plugin',
  'IO',
  'System',
  'FilePath',
  'Process',
  'Environment',
  'getEnv',
  'setEnv',
  'readFile',
  'writeFile',
  'readDir',
  'createDir',
  'removeDir',
  'removeFile',
  'rename',
  'spawn',
  'runProcess',
  'Lean',
  'Lake',
]);

export class ProofKernelError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'ProofKernelError';
    this.code = code;
    this.details = details;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function copyPinnedIdentities() {
  return { ...PINNED_LEAN_PROOF_IDENTITIES };
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function byteDigest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function boundedIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function validUtf8String(value, maximumBytes, { allowNewlines = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maximumBytes) {
    return false;
  }
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code === 0x7f || code === 0x2028 || code === 0x2029
        || (code < 0x20 && code !== 0x09 && (code !== 0x0a || !allowNewlines))) {
      return false;
    }
  }
  return true;
}

function validatePinnedIdentities(value, label, errors) {
  const keys = Object.keys(PINNED_LEAN_PROOF_IDENTITIES);
  if (!exactKeys(value, keys) || !same(value, PINNED_LEAN_PROOF_IDENTITIES)) {
    errors.push(`${label} must equal the exact pinned Lean/mathlib identities`);
  }
}

function validateRunIdentity(value, label, errors) {
  if (!exactKeys(value, ['runId', 'seed'])) {
    errors.push(`${label} must contain only runId and seed`);
    return;
  }
  if (!boundedIdentifier(value.runId)) errors.push(`${label}.runId is invalid`);
  if (!validUtf8String(value.seed, 256)) errors.push(`${label}.seed is invalid`);
}

function validateLimits(value, errors) {
  const keys = Object.keys(HARD_LIMITS);
  if (!exactKeys(value, keys)) {
    errors.push('limits must contain only the complete pinned resource-limit fields');
    return;
  }
  for (const [key, range] of Object.entries(HARD_LIMITS)) {
    if (!Number.isSafeInteger(value[key])
        || value[key] < range.minimum
        || value[key] > range.maximum) {
      errors.push(`${key} must be an integer between ${range.minimum} and ${range.maximum}`);
    }
  }
}

function identifierPattern(identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_'])${escaped}(?=$|[^A-Za-z0-9_'])`);
}

function delimiterErrors(term) {
  const errors = [];
  const stack = [];
  const openers = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
  const closers = new Set([...openers.values()]);
  for (const character of term) {
    if (openers.has(character)) stack.push(openers.get(character));
    else if (closers.has(character)) {
      if (stack.pop() !== character) {
        errors.push('candidate proof has unbalanced delimiters and could escape the proof hole');
        return errors;
      }
    }
  }
  if (stack.length !== 0) errors.push('candidate proof has unbalanced delimiters and could escape the proof hole');
  return errors;
}

export function validateCandidateProofTerm(proofTerm, { maximumBytes = HARD_LIMITS.maxCandidateBytes.maximum } = {}) {
  const errors = [];
  if (!validUtf8String(proofTerm, maximumBytes, { allowNewlines: true })) {
    return { ok: false, errors: ['candidate proof term is empty, invalid UTF-8 text, or outside its byte limit'] };
  }
  if (proofTerm.trim() !== proofTerm) errors.push('candidate proof term must not have leading or trailing whitespace');
  if (proofTerm.includes('\r')) errors.push('candidate proof term must use LF line endings');
  if (proofTerm.includes('--') || proofTerm.includes('/-') || proofTerm.includes('-/')) {
    errors.push('candidate comments are forbidden');
  }
  if (proofTerm.includes('"')) errors.push('candidate string literals are forbidden');
  if (proofTerm.includes('#')) errors.push('Lean command directives are forbidden in candidate proofs');
  if (proofTerm.includes('$') || proofTerm.includes('`') || proofTerm.includes(PROOF_HOLE_MARKER)) {
    errors.push('command injection or proof-hole marker text is forbidden');
  }
  for (const identifier of BANNED_IDENTIFIERS) {
    if (identifierPattern(identifier).test(proofTerm)) {
      errors.push(`forbidden Lean identifier or declaration: ${identifier}`);
    }
  }
  if (/(^|[^A-Za-z0-9_'])(?:exact|apply|simp)\?(?=$|[^A-Za-z0-9_'])/.test(proofTerm)) {
    errors.push('interactive suggestion tactics are forbidden');
  }
  errors.push(...delimiterErrors(proofTerm));
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function serializeProofRecord(record) {
  if (!isRecord(record)) throw new ProofKernelError('INVALID_RECORD', 'proof record must be an object');
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export function canonicalProofDigest(record) {
  if (!isRecord(record)) throw new ProofKernelError('INVALID_RECORD', 'proof record must be an object');
  return sha256Text(canonicalJson(record));
}

export function parseProofRecordBytes(input, label = 'proof record') {
  let bytes;
  if (Buffer.isBuffer(input)) bytes = Buffer.from(input);
  else if (input instanceof Uint8Array) bytes = Buffer.from(input);
  else if (typeof input === 'string') bytes = Buffer.from(input, 'utf8');
  else throw new ProofKernelError('INVALID_RECORD_BYTES', `${label} must be UTF-8 bytes or a string`);
  if (bytes.length < 2 || bytes.length > MAX_RECORD_BYTES) {
    throw new ProofKernelError('INVALID_RECORD_BYTES', `${label} byte size is outside the allowed range`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProofKernelError('INVALID_RECORD_BYTES', `${label} is not valid UTF-8`);
  }
  if (text.charCodeAt(0) === 0xfeff) throw new ProofKernelError('INVALID_RECORD_BYTES', `${label} must not contain a byte-order mark`);
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new ProofKernelError('INVALID_RECORD_BYTES', `${label} is not valid JSON: ${error.message}`);
  }
  if (!isRecord(record) || !serializeProofRecord(record).equals(bytes)) {
    throw new ProofKernelError(
      'NON_DETERMINISTIC_RECORD_BYTES',
      `${label} must use the deterministic two-space JSON serialization with one trailing LF`,
    );
  }
  return {
    record,
    bytes,
    bytesSha256: byteDigest(bytes),
    canonicalSha256: canonicalProofDigest(record),
  };
}

export function validateProofTask(task) {
  const errors = [];
  if (!exactKeys(task, TASK_KEYS)) {
    return { ok: false, errors: ['task must be an object with exactly the proof-task fields'] };
  }
  if (task.schemaVersion !== PROOF_TASK_SCHEMA) errors.push('invalid task schemaVersion');
  if (!boundedIdentifier(task.taskId)) errors.push('taskId is invalid');
  if (!boundedIdentifier(task.conceptId)) errors.push('conceptId is invalid');
  if (!exactKeys(task.theorem, ['statement', 'statementSha256', 'templateSha256'])) {
    errors.push('theorem must contain only statement, statementSha256, and templateSha256');
  } else {
    if (!validUtf8String(task.theorem.statement, 16 * 1024, { allowNewlines: true })) {
      errors.push('theorem.statement is invalid');
    }
    if (task.theorem.statementSha256 !== sha256Text(task.theorem.statement)) {
      errors.push('theorem statement digest mismatch');
    }
    if (!DIGEST.test(String(task.theorem.templateSha256 || ''))) errors.push('theorem template digest is invalid');
  }
  if (!exactKeys(task.trustedContext, ['allowedImports', 'allowedImportsSha256', 'preludeSha256'])) {
    errors.push('trustedContext must contain only the complete context binding');
  } else {
    if (!Array.isArray(task.trustedContext.allowedImports)
        || !task.trustedContext.allowedImports.every((value) => typeof value === 'string' && IMPORT_NAME.test(value))
        || !same(task.trustedContext.allowedImports, PINNED_LEAN_PROOF_CONTEXT.allowedImports)) {
      errors.push('allowed imports do not equal the immutable proof prelude imports');
    }
    if (task.trustedContext.allowedImportsSha256 !== sha256Text(canonicalJson(task.trustedContext.allowedImports))
        || task.trustedContext.allowedImportsSha256 !== PINNED_LEAN_PROOF_CONTEXT.allowedImportsSha256) {
      errors.push('allowed imports digest mismatch');
    }
    if (task.trustedContext.preludeSha256 !== PINNED_LEAN_PROOF_CONTEXT.preludeSha256) {
      errors.push('prelude digest mismatch');
    }
  }
  validatePinnedIdentities(task.toolchain, 'task.toolchain', errors);
  const deploymentValidation = validateDeploymentBinding(task.deployment);
  if (!deploymentValidation.ok) errors.push(...deploymentValidation.errors.map((error) => `task ${error}`));
  validateRunIdentity(task.runIdentity, 'task.runIdentity', errors);
  validateLimits(task.limits, errors);
  if (task.truthBoundary !== PROOF_TRUTH_BOUNDARY) errors.push('task truthBoundary is invalid');
  return { ok: errors.length === 0, errors };
}

function validateCandidateAgainstTask(candidate, task, taskEnvelope) {
  const errors = [];
  if (!exactKeys(candidate, CANDIDATE_KEYS)) {
    return ['candidate must be an object with exactly the proof-candidate fields'];
  }
  if (candidate.schemaVersion !== PROOF_CANDIDATE_SCHEMA) errors.push('invalid candidate schemaVersion');
  if (!boundedIdentifier(candidate.candidateId)) errors.push('candidateId is invalid');
  if (candidate.taskId !== task.taskId) errors.push('candidate taskId mismatch');
  if (candidate.conceptId !== task.conceptId) errors.push('candidate conceptId mismatch');
  if (!exactKeys(candidate.taskBinding, ['bytesSha256', 'canonicalSha256'])
      || candidate.taskBinding.bytesSha256 !== taskEnvelope.bytesSha256
      || candidate.taskBinding.canonicalSha256 !== taskEnvelope.canonicalSha256) {
    errors.push('candidate does not bind the exact task bytes and canonical digest');
  }
  if (!exactKeys(candidate.theoremBinding, ['statementSha256', 'templateSha256'])
      || candidate.theoremBinding.statementSha256 !== task.theorem.statementSha256
      || candidate.theoremBinding.templateSha256 !== task.theorem.templateSha256) {
    errors.push('candidate theorem binding mismatch');
  }
  if (!exactKeys(candidate.trustedContextBinding, ['allowedImportsSha256', 'preludeSha256'])
      || candidate.trustedContextBinding.allowedImportsSha256 !== task.trustedContext.allowedImportsSha256
      || candidate.trustedContextBinding.preludeSha256 !== task.trustedContext.preludeSha256) {
    errors.push('candidate trusted-context binding mismatch');
  }
  validatePinnedIdentities(candidate.toolchain, 'candidate.toolchain', errors);
  if (!same(candidate.deployment, task.deployment)) errors.push('candidate deployment binding mismatch');
  validateRunIdentity(candidate.runIdentity, 'candidate.runIdentity', errors);
  if (!same(candidate.runIdentity, task.runIdentity)) errors.push('candidate run identity mismatch');
  if (!exactKeys(candidate.proof, ['encoding', 'term', 'bytesSha256'])) {
    errors.push('candidate proof must contain only encoding, term, and bytesSha256');
  } else {
    if (candidate.proof.encoding !== 'utf8') errors.push('candidate proof encoding must be utf8');
    if (candidate.proof.bytesSha256 !== byteDigest(Buffer.from(String(candidate.proof.term || ''), 'utf8'))) {
      errors.push('candidate proof byte digest mismatch');
    }
    const staticValidation = validateCandidateProofTerm(candidate.proof.term, {
      maximumBytes: task.limits.maxCandidateBytes,
    });
    errors.push(...staticValidation.errors);
  }
  if (candidate.truthBoundary !== PROOF_TRUTH_BOUNDARY) errors.push('candidate truthBoundary is invalid');
  return errors;
}

export function validateProofCandidate(candidate, taskBytes) {
  let taskEnvelope;
  try {
    taskEnvelope = parseProofRecordBytes(taskBytes, 'task');
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
  const taskValidation = validateProofTask(taskEnvelope.record);
  if (!taskValidation.ok) return taskValidation;
  const errors = validateCandidateAgainstTask(candidate, taskEnvelope.record, taskEnvelope);
  return { ok: errors.length === 0, errors };
}

export function createProofTask({
  taskId,
  conceptId,
  theoremStatement,
  trustedTemplateBytes,
  runId,
  seed,
  deployment,
  limits = {},
} = {}) {
  const template = decodeTrustedBytes(trustedTemplateBytes, 'trusted template', 256 * 1024);
  const task = {
    schemaVersion: PROOF_TASK_SCHEMA,
    taskId,
    conceptId,
    theorem: {
      statement: theoremStatement,
      statementSha256: sha256Text(theoremStatement),
      templateSha256: byteDigest(template.bytes),
    },
    trustedContext: {
      allowedImports: [...PINNED_LEAN_PROOF_CONTEXT.allowedImports],
      allowedImportsSha256: PINNED_LEAN_PROOF_CONTEXT.allowedImportsSha256,
      preludeSha256: PINNED_LEAN_PROOF_CONTEXT.preludeSha256,
    },
    toolchain: copyPinnedIdentities(),
    deployment: structuredClone(deployment),
    runIdentity: { runId, seed },
    limits: { ...DEFAULT_LIMITS, ...limits },
    truthBoundary: PROOF_TRUTH_BOUNDARY,
  };
  const validation = validateProofTask(task);
  if (!validation.ok) {
    throw new ProofKernelError('INVALID_TASK', `invalid proof task: ${validation.errors.join('; ')}`, validation.errors);
  }
  return task;
}

export function createProofCandidate({
  taskBytes,
  candidateId,
  proofTerm,
} = {}) {
  const taskEnvelope = parseProofRecordBytes(taskBytes, 'task');
  const taskValidation = validateProofTask(taskEnvelope.record);
  if (!taskValidation.ok) {
    throw new ProofKernelError('INVALID_TASK', `invalid proof task: ${taskValidation.errors.join('; ')}`, taskValidation.errors);
  }
  const task = taskEnvelope.record;
  const candidate = {
    schemaVersion: PROOF_CANDIDATE_SCHEMA,
    candidateId,
    taskId: task.taskId,
    conceptId: task.conceptId,
    taskBinding: {
      bytesSha256: taskEnvelope.bytesSha256,
      canonicalSha256: taskEnvelope.canonicalSha256,
    },
    theoremBinding: {
      statementSha256: task.theorem.statementSha256,
      templateSha256: task.theorem.templateSha256,
    },
    trustedContextBinding: {
      allowedImportsSha256: task.trustedContext.allowedImportsSha256,
      preludeSha256: task.trustedContext.preludeSha256,
    },
    toolchain: copyPinnedIdentities(),
    deployment: structuredClone(task.deployment),
    runIdentity: { ...task.runIdentity },
    proof: {
      encoding: 'utf8',
      term: proofTerm,
      bytesSha256: byteDigest(Buffer.from(String(proofTerm || ''), 'utf8')),
    },
    truthBoundary: PROOF_TRUTH_BOUNDARY,
  };
  const errors = validateCandidateAgainstTask(candidate, task, taskEnvelope);
  if (errors.length) {
    throw new ProofKernelError(
      'CANDIDATE_STATIC_REJECTION',
      `candidate rejected before kernel execution: ${errors.join('; ')}`,
      errors,
    );
  }
  return candidate;
}

function decodeTrustedBytes(input, label, maximumBytes) {
  let bytes;
  if (Buffer.isBuffer(input)) bytes = Buffer.from(input);
  else if (input instanceof Uint8Array) bytes = Buffer.from(input);
  else if (typeof input === 'string') bytes = Buffer.from(input, 'utf8');
  else throw new ProofKernelError('INVALID_TRUSTED_BYTES', `${label} must be UTF-8 bytes or a string`);
  if (bytes.length < 1 || bytes.length > maximumBytes) {
    throw new ProofKernelError('INVALID_TRUSTED_BYTES', `${label} size is outside the allowed range`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProofKernelError('INVALID_TRUSTED_BYTES', `${label} is not valid UTF-8`);
  }
  if (text.includes('\0') || text.includes('\r') || text.charCodeAt(0) === 0xfeff) {
    throw new ProofKernelError('INVALID_TRUSTED_BYTES', `${label} has forbidden encoding or line endings`);
  }
  return { bytes, text };
}

function importLines(source) {
  return [...source.matchAll(/^import[ \t]+([^\n]+)$/gm)].map((match) => match[1].trim());
}

export function renderTrustedProofSource({
  task,
  candidate,
  trustedTemplateBytes,
} = {}) {
  const template = decodeTrustedBytes(
    trustedTemplateBytes,
    'trusted template',
    task?.limits?.maxSourceBytes || HARD_LIMITS.maxSourceBytes.maximum,
  );
  if (byteDigest(template.bytes) !== task.theorem.templateSha256) {
    throw new ProofKernelError('TEMPLATE_DIGEST_MISMATCH', 'trusted theorem template digest mismatch');
  }
  const expectedPrelude = 'import Mathlib\n';
  if (!template.text.startsWith(expectedPrelude)
      || task.trustedContext.preludeSha256 !== sha256Text(expectedPrelude)) {
    throw new ProofKernelError('PRELUDE_MISMATCH', 'trusted template does not begin with the immutable prelude');
  }
  const imports = importLines(template.text);
  if (!imports.every((name) => IMPORT_NAME.test(name))
      || !same(imports, task.trustedContext.allowedImports)) {
    throw new ProofKernelError('IMPORT_MISMATCH', 'trusted template imports differ from the task allowlist');
  }
  const markerCount = template.text.split(PROOF_HOLE_MARKER).length - 1;
  if (markerCount !== 1 || !template.text.includes(`(${PROOF_HOLE_MARKER})`)) {
    throw new ProofKernelError('INVALID_PROOF_HOLE', 'trusted template must contain exactly one parenthesized proof hole');
  }
  const statementCount = template.text.split(task.theorem.statement).length - 1;
  if (statementCount !== 1) {
    throw new ProofKernelError('THEOREM_TEMPLATE_MISMATCH', 'trusted template does not contain the exact theorem statement once');
  }
  if (/(^|[^A-Za-z0-9_'])(sorry|admit|sorryAx|axiom|opaque|unsafe)(?=$|[^A-Za-z0-9_'])/.test(
    template.text.replace(PROOF_HOLE_MARKER, ''),
  )) {
    throw new ProofKernelError('UNSAFE_TRUSTED_TEMPLATE', 'trusted template contains a forbidden declaration or placeholder');
  }
  const proofValidation = validateCandidateProofTerm(candidate.proof.term, {
    maximumBytes: task.limits.maxCandidateBytes,
  });
  if (!proofValidation.ok) {
    throw new ProofKernelError(
      'CANDIDATE_STATIC_REJECTION',
      `candidate rejected before source construction: ${proofValidation.errors.join('; ')}`,
      proofValidation.errors,
    );
  }
  const sourceText = template.text.replace(PROOF_HOLE_MARKER, candidate.proof.term);
  const sourceBytes = Buffer.from(sourceText, 'utf8');
  if (sourceBytes.length > task.limits.maxSourceBytes) {
    throw new ProofKernelError('SOURCE_SIZE_LIMIT', 'constructed Lean source exceeds the task byte limit');
  }
  return {
    sourceBytes,
    sourceText,
    sourceSha256: byteDigest(sourceBytes),
    templateSha256: byteDigest(template.bytes),
  };
}

function validateReplayDirectory(directoryPath) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const target = path.resolve(directoryPath);
  const relative = path.relative(temporaryRoot, target);
  if (!relative
      || relative.startsWith('..')
      || path.isAbsolute(relative)
      || relative.includes(path.sep)
      || !/^clos-lean-proof-[A-Za-z0-9]{6,64}$/.test(relative)) {
    throw new ProofKernelError('UNSAFE_REPLAY_PATH', 'evidence temporary source path is outside the verifier namespace');
  }
  return target;
}

export async function withTemporaryProofSource(sourceBytes, callback, { directoryPath = null } = {}) {
  const bytes = Buffer.from(sourceBytes);
  let temporaryDirectory;
  if (directoryPath) {
    temporaryDirectory = validateReplayDirectory(directoryPath);
    fs.mkdirSync(temporaryDirectory, { mode: 0o700 });
  } else {
    temporaryDirectory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'clos-lean-proof-'));
    fs.chmodSync(temporaryDirectory, 0o700);
  }
  const sourcePath = path.join(temporaryDirectory, 'Candidate.lean');
  let descriptor;
  try {
    descriptor = fs.openSync(
      sourcePath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.writeFileSync(descriptor, bytes);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== bytes.length) {
      throw new ProofKernelError('TEMP_SOURCE_FAILURE', 'temporary Lean source is not the expected regular file');
    }
    return await callback({ temporaryDirectory, sourcePath });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function boundedStreamState(maximumBytes) {
  const chunks = [];
  let capturedBytes = 0;
  let observedBytes = 0;
  return {
    add(chunk) {
      const bytes = Buffer.from(chunk);
      observedBytes += bytes.length;
      const remaining = maximumBytes - capturedBytes;
      if (remaining > 0) {
        const captured = bytes.subarray(0, remaining);
        chunks.push(captured);
        capturedBytes += captured.length;
      }
      return observedBytes > maximumBytes;
    },
    result() {
      const captured = Buffer.concat(chunks, capturedBytes);
      return {
        observedBytes,
        capturedBytes,
        truncated: observedBytes > maximumBytes,
        sha256: byteDigest(captured),
      };
    },
  };
}

async function spawnBounded(executable, argv, {
  cwd,
  env,
  timeoutMs,
  maxStdoutBytes,
  maxStderrBytes,
} = {}) {
  return await new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const stdout = boundedStreamState(maxStdoutBytes);
    const stderr = boundedStreamState(maxStderrBytes);
    let timedOut = false;
    let outputLimitExceeded = false;
    let spawnError = null;
    let settled = false;
    let child;

    const kill = () => {
      if (!child?.pid) return;
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch {}
      }
    };

    try {
      child = spawn(executable, argv, {
        cwd,
        env,
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        exitCode: null,
        signal: null,
        timedOut: false,
        outputLimitExceeded: false,
        errorCode: error.code || 'SPAWN_ERROR',
        durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
        stdout: stdout.result(),
        stderr: stderr.result(),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    timer.unref();

    child.stdout.on('data', (chunk) => {
      if (stdout.add(chunk)) {
        outputLimitExceeded = true;
        kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.add(chunk)) {
        outputLimitExceeded = true;
        kill();
      }
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        outputLimitExceeded,
        errorCode: spawnError?.code || null,
        durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
        stdout: stdout.result(),
        stderr: stderr.result(),
      });
    });
  });
}

function expectedCommand(task, preflight, sourcePath, temporaryDirectory) {
  const argv = [
    `-DmaxHeartbeats=${task.limits.maxHeartbeats}`,
    `-DmaxRecDepth=${task.limits.maxRecDepth}`,
    '-DwarningAsError=true',
    sourcePath,
  ];
  const environment = {
    LANG: 'C',
    LC_ALL: 'C',
    HOME: temporaryDirectory,
    LEAN_PATH: preflight.leanPath,
  };
  return {
    executable: preflight.leanExecutable,
    argv,
    cwd: preflight.proofKernelRoot,
    environment,
  };
}

function evidenceCore(evidence) {
  const { evidenceId: _evidenceId, ...core } = evidence;
  return core;
}

function finalizeEvidence(core) {
  return {
    schemaVersion: core.schemaVersion,
    evidenceId: `sha256:${sha256Text(canonicalJson(core))}`,
    ...Object.fromEntries(Object.entries(core).filter(([key]) => key !== 'schemaVersion')),
  };
}

function kernelSnapshot(preflight) {
  return {
    leanVersion: preflight.leanVersion,
    leanExecutable: preflight.leanExecutable,
    leanExecutableSha256: preflight.leanExecutableSha256,
    lakeExecutable: preflight.lakeExecutable,
    lakeExecutableSha256: preflight.lakeExecutableSha256,
    mathlibRoot: preflight.mathlibRoot,
    mathlibHead: preflight.mathlibHead,
    mathlibTagCommit: preflight.mathlibTagCommit,
    lakeManifestSha256: preflight.lakeManifestSha256,
    leanPathSha256: preflight.leanPathSha256,
    leanToolchainSha256: preflight.context.leanToolchainSha256,
    lakefileSha256: preflight.context.lakefileSha256,
    preludeSha256: preflight.context.preludeSha256,
    authenticatedRuntime: structuredClone(preflight.authenticatedRuntime),
  };
}

async function executeValidated({
  taskEnvelope,
  candidateEnvelope,
  rendered,
  proofKernelRoot,
  replayDirectory = null,
  authenticatedPreflight = null,
} = {}) {
  const task = taskEnvelope.record;
  const candidate = candidateEnvelope.record;
  const preflight = authenticatedPreflight || preflightLeanProofKernel({
    proofKernelRoot,
    expectedDeployment: task.deployment,
  });
  if (preflight.status === 'absent') {
    throw new ProofKernelError('KERNEL_ABSENT', `pinned Lean proof kernel is absent: ${preflight.errors.join('; ')}`, preflight.errors);
  }
  if (!preflight.ready) {
    throw new ProofKernelError('KERNEL_INVALID', `pinned Lean proof kernel preflight failed: ${preflight.errors.join('; ')}`, preflight.errors);
  }
  const runtimeValidation = validateProofRuntimeEvidence(preflight.authenticatedRuntime, {
    trustPolicy: preflight.trustPolicy,
    expectedDeployment: task.deployment,
  });
  if (!runtimeValidation.ok) {
    throw new ProofKernelError(
      'RUNTIME_ATTESTATION_INVALID',
      `proof runtime evidence failed kernel-boundary authentication: ${runtimeValidation.errors.join('; ')}`,
      runtimeValidation.errors,
    );
  }

  return await withTemporaryProofSource(rendered.sourceBytes, async ({
    temporaryDirectory,
    sourcePath,
  }) => {
    const command = expectedCommand(task, preflight, sourcePath, temporaryDirectory);
    const startedAt = new Date().toISOString();
    const processResult = await spawnBounded(command.executable, command.argv, {
      cwd: command.cwd,
      env: command.environment,
      timeoutMs: task.limits.timeoutMs,
      maxStdoutBytes: task.limits.maxStdoutBytes,
      maxStderrBytes: task.limits.maxStderrBytes,
    });
    const completedAt = new Date().toISOString();
    const kernelAccepted = processResult.exitCode === 0
      && processResult.signal === null
      && processResult.timedOut === false
      && processResult.outputLimitExceeded === false
      && processResult.errorCode === null;
    const core = {
      schemaVersion: PROOF_EVIDENCE_SCHEMA,
      taskId: task.taskId,
      candidateId: candidate.candidateId,
      conceptId: task.conceptId,
      bindings: {
        taskBytesSha256: taskEnvelope.bytesSha256,
        taskCanonicalSha256: taskEnvelope.canonicalSha256,
        candidateBytesSha256: candidateEnvelope.bytesSha256,
        candidateCanonicalSha256: candidateEnvelope.canonicalSha256,
        theoremStatementSha256: task.theorem.statementSha256,
        templateSha256: task.theorem.templateSha256,
        candidateProofBytesSha256: candidate.proof.bytesSha256,
        allowedImportsSha256: task.trustedContext.allowedImportsSha256,
        preludeSha256: task.trustedContext.preludeSha256,
        renderedSourceSha256: rendered.sourceSha256,
      },
      toolchain: copyPinnedIdentities(),
      deployment: structuredClone(task.deployment),
      runIdentity: { ...task.runIdentity },
      limits: { ...task.limits },
      kernel: kernelSnapshot(preflight),
      command,
      startedAt,
      completedAt,
      durationMs: processResult.durationMs,
      process: {
        exitCode: processResult.exitCode,
        signal: processResult.signal,
        timedOut: processResult.timedOut,
        outputLimitExceeded: processResult.outputLimitExceeded,
        errorCode: processResult.errorCode,
      },
      output: {
        stdout: processResult.stdout,
        stderr: processResult.stderr,
      },
      kernelAccepted,
      truthBoundary: PROOF_TRUTH_BOUNDARY,
    };
    const evidence = finalizeEvidence(core);
    const validation = validateKernelEvidence(evidence);
    if (!validation.ok) {
      throw new ProofKernelError('INTERNAL_EVIDENCE_ERROR', validation.errors.join('; '), validation.errors);
    }
    return evidence;
  }, { directoryPath: replayDirectory });
}

function parseAndValidateInputs({
  taskBytes,
  candidateBytes,
  trustedTemplateBytes,
  expectedDeployment,
}) {
  const taskEnvelope = parseProofRecordBytes(taskBytes, 'task');
  const taskValidation = validateProofTask(taskEnvelope.record);
  if (!taskValidation.ok) {
    throw new ProofKernelError('INVALID_TASK', `invalid proof task: ${taskValidation.errors.join('; ')}`, taskValidation.errors);
  }
  try {
    assertDeploymentBinding(taskEnvelope.record.deployment, expectedDeployment);
  } catch (error) {
    throw new ProofKernelError('DEPLOYMENT_SUBSTITUTION', error.message);
  }
  const candidateEnvelope = parseProofRecordBytes(candidateBytes, 'candidate');
  const candidateErrors = validateCandidateAgainstTask(
    candidateEnvelope.record,
    taskEnvelope.record,
    taskEnvelope,
  );
  if (candidateErrors.length) {
    throw new ProofKernelError(
      'CANDIDATE_STATIC_REJECTION',
      `candidate rejected before kernel execution: ${candidateErrors.join('; ')}`,
      candidateErrors,
    );
  }
  const rendered = renderTrustedProofSource({
    task: taskEnvelope.record,
    candidate: candidateEnvelope.record,
    trustedTemplateBytes,
  });
  return { taskEnvelope, candidateEnvelope, rendered };
}

export async function verifyLeanProof({
  taskBytes,
  candidateBytes,
  trustedTemplateBytes,
  expectedDeployment,
  proofKernelRoot = DEFAULT_PROOF_KERNEL_ROOT,
} = {}) {
  const validated = parseAndValidateInputs({
    taskBytes,
    candidateBytes,
    trustedTemplateBytes,
    expectedDeployment,
  });
  return await executeValidated({
    ...validated,
    proofKernelRoot: path.resolve(proofKernelRoot),
  });
}

function validateOutputRecord(value, label, maximumBytes, errors) {
  if (!exactKeys(value, ['observedBytes', 'capturedBytes', 'truncated', 'sha256'])) {
    errors.push(`${label} is invalid`);
    return;
  }
  if (!Number.isSafeInteger(value.observedBytes) || value.observedBytes < 0
      || !Number.isSafeInteger(value.capturedBytes) || value.capturedBytes < 0
      || value.capturedBytes > value.observedBytes
      || value.capturedBytes > maximumBytes
      || typeof value.truncated !== 'boolean'
      || value.truncated !== (value.observedBytes > value.capturedBytes)
      || !DIGEST.test(String(value.sha256 || ''))) {
    errors.push(`${label} bounds or digest are invalid`);
  }
}

export function validateKernelEvidence(evidence) {
  const errors = [];
  if (!exactKeys(evidence, EVIDENCE_KEYS)) {
    return { ok: false, errors: ['evidence must be an object with exactly the kernel-evidence fields'] };
  }
  if (evidence.schemaVersion !== PROOF_EVIDENCE_SCHEMA) errors.push('invalid evidence schemaVersion');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(evidence.evidenceId || ''))
      || evidence.evidenceId !== `sha256:${sha256Text(canonicalJson(evidenceCore(evidence)))}`) {
    errors.push('evidenceId does not authenticate the complete canonical evidence record');
  }
  for (const [field, value] of [
    ['taskId', evidence.taskId],
    ['candidateId', evidence.candidateId],
    ['conceptId', evidence.conceptId],
  ]) {
    if (!boundedIdentifier(value)) errors.push(`${field} is invalid`);
  }
  const bindingKeys = [
    'taskBytesSha256',
    'taskCanonicalSha256',
    'candidateBytesSha256',
    'candidateCanonicalSha256',
    'theoremStatementSha256',
    'templateSha256',
    'candidateProofBytesSha256',
    'allowedImportsSha256',
    'preludeSha256',
    'renderedSourceSha256',
  ];
  if (!exactKeys(evidence.bindings, bindingKeys)
      || !bindingKeys.every((key) => DIGEST.test(String(evidence.bindings?.[key] || '')))) {
    errors.push('evidence bindings are incomplete or invalid');
  }
  if (evidence.bindings?.allowedImportsSha256 !== PINNED_LEAN_PROOF_CONTEXT.allowedImportsSha256
      || evidence.bindings?.preludeSha256 !== PINNED_LEAN_PROOF_CONTEXT.preludeSha256) {
    errors.push('evidence trusted-context bindings are not pinned');
  }
  validatePinnedIdentities(evidence.toolchain, 'evidence.toolchain', errors);
  const deploymentValidation = validateDeploymentBinding(evidence.deployment);
  if (!deploymentValidation.ok) errors.push(...deploymentValidation.errors.map((error) => `evidence ${error}`));
  validateRunIdentity(evidence.runIdentity, 'evidence.runIdentity', errors);
  validateLimits(evidence.limits, errors);
  const kernelKeys = [
    'leanVersion',
    'leanExecutable',
    'leanExecutableSha256',
    'lakeExecutable',
    'lakeExecutableSha256',
    'mathlibRoot',
    'mathlibHead',
    'mathlibTagCommit',
    'lakeManifestSha256',
    'leanPathSha256',
    'leanToolchainSha256',
    'lakefileSha256',
    'preludeSha256',
    'authenticatedRuntime',
  ];
  const runtimeValidation = validateProofRuntimeEvidence(evidence.kernel?.authenticatedRuntime, {
    expectedDeployment: evidence.deployment,
    allowFixture: evidence.kernel?.authenticatedRuntime?.fixtureOnly === true,
    requireAuthentication: false,
  });
  if (!exactKeys(evidence.kernel, kernelKeys)
      || typeof evidence.kernel.leanVersion !== 'string'
      || !path.isAbsolute(String(evidence.kernel.leanExecutable || ''))
      || !path.isAbsolute(String(evidence.kernel.lakeExecutable || ''))
      || !path.isAbsolute(String(evidence.kernel.mathlibRoot || ''))
      || ![
        'leanExecutableSha256',
        'lakeExecutableSha256',
        'lakeManifestSha256',
        'leanPathSha256',
        'leanToolchainSha256',
        'lakefileSha256',
        'preludeSha256',
      ].every((key) => DIGEST.test(String(evidence.kernel?.[key] || '')))
      || evidence.kernel.mathlibHead !== PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit
      || evidence.kernel.mathlibTagCommit !== PINNED_LEAN_PROOF_IDENTITIES.mathlibCommit
      || !runtimeValidation.ok) {
    errors.push('evidence kernel identity is incomplete or invalid');
    errors.push(...runtimeValidation.errors.map((error) => `evidence ${error}`));
  }
  const expectedVersion = `Lean (version 4.32.1, ${PINNED_LEAN_PROOF_IDENTITIES.leanArchitecture}, commit ${PINNED_LEAN_PROOF_IDENTITIES.leanCommit}, Release)`;
  if (evidence.kernel?.leanVersion !== expectedVersion
      || evidence.kernel?.leanToolchainSha256 !== PINNED_LEAN_PROOF_CONTEXT.leanToolchainSha256
      || evidence.kernel?.lakefileSha256 !== PINNED_LEAN_PROOF_CONTEXT.lakefileSha256
      || evidence.kernel?.preludeSha256 !== PINNED_LEAN_PROOF_CONTEXT.preludeSha256) {
    errors.push('evidence kernel product-byte identity mismatch');
  }
  if (!exactKeys(evidence.command, ['executable', 'argv', 'cwd', 'environment'])
      || typeof evidence.command.executable !== 'string'
      || !Array.isArray(evidence.command.argv)
      || evidence.command.argv.length !== 4
      || !evidence.command.argv.every((value) => typeof value === 'string')
      || !path.isAbsolute(String(evidence.command.cwd || ''))
      || !exactKeys(evidence.command.environment, ['LANG', 'LC_ALL', 'HOME', 'LEAN_PATH'])
      || evidence.command.environment.LANG !== 'C'
      || evidence.command.environment.LC_ALL !== 'C'
      || !path.isAbsolute(String(evidence.command.environment.HOME || ''))
      || typeof evidence.command.environment.LEAN_PATH !== 'string') {
    errors.push('evidence command or minimal environment is invalid');
  }
  const sourcePath = evidence.command?.argv?.at(-1);
  const expectedCwd = path.resolve(String(evidence.kernel?.mathlibRoot || '/invalid'), '../../..');
  let safeTemporaryPath = false;
  try {
    safeTemporaryPath = path.basename(sourcePath) === 'Candidate.lean'
      && validateReplayDirectory(path.dirname(sourcePath)) === path.dirname(sourcePath);
  } catch {}
  if (evidence.command?.executable !== evidence.kernel?.leanExecutable
      || evidence.command?.cwd !== expectedCwd
      || evidence.command?.argv?.[0] !== `-DmaxHeartbeats=${evidence.limits?.maxHeartbeats}`
      || evidence.command?.argv?.[1] !== `-DmaxRecDepth=${evidence.limits?.maxRecDepth}`
      || evidence.command?.argv?.[2] !== '-DwarningAsError=true'
      || !safeTemporaryPath
      || evidence.command?.environment?.HOME !== path.dirname(String(sourcePath || '/invalid'))
      || sha256Text(String(evidence.command?.environment?.LEAN_PATH || '')) !== evidence.kernel?.leanPathSha256) {
    errors.push('evidence command does not match the pinned kernel, limits, cwd, or temporary source');
  }
  if (!Number.isFinite(Date.parse(String(evidence.startedAt || '')))
      || !Number.isFinite(Date.parse(String(evidence.completedAt || '')))
      || Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)
      || typeof evidence.durationMs !== 'number'
      || !Number.isFinite(evidence.durationMs)
      || evidence.durationMs < 0) {
    errors.push('evidence timing is invalid');
  }
  if (!exactKeys(evidence.process, ['exitCode', 'signal', 'timedOut', 'outputLimitExceeded', 'errorCode'])
      || !(evidence.process.exitCode === null || Number.isInteger(evidence.process.exitCode))
      || !(evidence.process.signal === null || typeof evidence.process.signal === 'string')
      || typeof evidence.process.timedOut !== 'boolean'
      || typeof evidence.process.outputLimitExceeded !== 'boolean'
      || !(evidence.process.errorCode === null || typeof evidence.process.errorCode === 'string')) {
    errors.push('evidence process result is invalid');
  }
  if (!exactKeys(evidence.output, ['stdout', 'stderr'])) errors.push('evidence output is invalid');
  else {
    validateOutputRecord(evidence.output.stdout, 'evidence stdout', evidence.limits.maxStdoutBytes, errors);
    validateOutputRecord(evidence.output.stderr, 'evidence stderr', evidence.limits.maxStderrBytes, errors);
  }
  if (typeof evidence.kernelAccepted !== 'boolean'
      || evidence.kernelAccepted !== (
        evidence.process?.exitCode === 0
        && evidence.process?.signal === null
        && evidence.process?.timedOut === false
        && evidence.process?.outputLimitExceeded === false
        && evidence.process?.errorCode === null
      )) {
    errors.push('kernelAccepted does not match the recorded process result');
  }
  if (evidence.truthBoundary !== PROOF_TRUTH_BOUNDARY) errors.push('evidence truthBoundary is invalid');
  return { ok: errors.length === 0, errors };
}

function assertEvidenceMatchesInputs(evidence, validated) {
  const { taskEnvelope, candidateEnvelope, rendered } = validated;
  const task = taskEnvelope.record;
  const candidate = candidateEnvelope.record;
  const expectedBindings = {
    taskBytesSha256: taskEnvelope.bytesSha256,
    taskCanonicalSha256: taskEnvelope.canonicalSha256,
    candidateBytesSha256: candidateEnvelope.bytesSha256,
    candidateCanonicalSha256: candidateEnvelope.canonicalSha256,
    theoremStatementSha256: task.theorem.statementSha256,
    templateSha256: task.theorem.templateSha256,
    candidateProofBytesSha256: candidate.proof.bytesSha256,
    allowedImportsSha256: task.trustedContext.allowedImportsSha256,
    preludeSha256: task.trustedContext.preludeSha256,
    renderedSourceSha256: rendered.sourceSha256,
  };
  if (evidence.taskId !== task.taskId
      || evidence.candidateId !== candidate.candidateId
      || evidence.conceptId !== task.conceptId
      || !same(evidence.bindings, expectedBindings)
      || !same(evidence.toolchain, task.toolchain)
      || !same(evidence.deployment, task.deployment)
      || !same(evidence.runIdentity, task.runIdentity)
      || !same(evidence.limits, task.limits)) {
    throw new ProofKernelError('EVIDENCE_SUBSTITUTION', 'evidence does not bind the supplied task/candidate bytes and identities');
  }
}

function replayComparable(evidence) {
  return {
    schemaVersion: evidence.schemaVersion,
    taskId: evidence.taskId,
    candidateId: evidence.candidateId,
    conceptId: evidence.conceptId,
    bindings: evidence.bindings,
    toolchain: evidence.toolchain,
    deployment: evidence.deployment,
    runIdentity: evidence.runIdentity,
    limits: evidence.limits,
    kernel: evidence.kernel,
    command: evidence.command,
    process: evidence.process,
    output: evidence.output,
    kernelAccepted: evidence.kernelAccepted,
    truthBoundary: evidence.truthBoundary,
  };
}

export function validateReplayEvidenceIdentity(originalEvidence, replayEvidence) {
  const originalValidation = validateKernelEvidence(originalEvidence);
  const replayValidation = validateKernelEvidence(replayEvidence);
  const errors = [
    ...originalValidation.errors.map((error) => `original evidence: ${error}`),
    ...replayValidation.errors.map((error) => `replay evidence: ${error}`),
  ];
  if (originalValidation.ok
      && replayValidation.ok
      && !same(replayComparable(replayEvidence), replayComparable(originalEvidence))) {
    errors.push('replay did not reproduce the exact runtime, identities, bindings, command, and result');
  }
  return { ok: errors.length === 0, errors };
}

export async function replayLeanProofEvidence({
  taskBytes,
  candidateBytes,
  trustedTemplateBytes,
  expectedDeployment,
  evidence,
  proofKernelRoot = DEFAULT_PROOF_KERNEL_ROOT,
} = {}) {
  const evidenceValidation = validateKernelEvidence(evidence);
  if (!evidenceValidation.ok) {
    throw new ProofKernelError(
      'INVALID_EVIDENCE',
      `kernel evidence is invalid: ${evidenceValidation.errors.join('; ')}`,
      evidenceValidation.errors,
    );
  }
  const validated = parseAndValidateInputs({
    taskBytes,
    candidateBytes,
    trustedTemplateBytes,
    expectedDeployment,
  });
  assertEvidenceMatchesInputs(evidence, validated);
  const replayPreflight = preflightLeanProofKernel({
    proofKernelRoot: path.resolve(proofKernelRoot),
    expectedDeployment: validated.taskEnvelope.record.deployment,
  });
  if (replayPreflight.status === 'absent') {
    throw new ProofKernelError(
      'KERNEL_ABSENT',
      `pinned Lean proof kernel is absent: ${replayPreflight.errors.join('; ')}`,
      replayPreflight.errors,
    );
  }
  if (!replayPreflight.ready) {
    throw new ProofKernelError(
      'KERNEL_INVALID',
      `pinned Lean proof kernel preflight failed: ${replayPreflight.errors.join('; ')}`,
      replayPreflight.errors,
    );
  }
  const originalRuntimeValidation = validateProofRuntimeEvidence(
    evidence.kernel.authenticatedRuntime,
    {
      trustPolicy: replayPreflight.trustPolicy,
      expectedDeployment: validated.taskEnvelope.record.deployment,
    },
  );
  if (!originalRuntimeValidation.ok) {
    throw new ProofKernelError(
      'RUNTIME_ATTESTATION_INVALID',
      `recorded proof runtime failed replay-boundary authentication: ${originalRuntimeValidation.errors.join('; ')}`,
      originalRuntimeValidation.errors,
    );
  }
  if (!same(
    evidence.kernel.authenticatedRuntime,
    replayPreflight.authenticatedRuntime,
  )) {
    throw new ProofKernelError(
      'REPLAY_RUNTIME_MISMATCH',
      'independent replay is running under a different exact proof runtime attestation',
    );
  }
  const sourcePath = evidence.command.argv.at(-1);
  if (path.basename(sourcePath) !== 'Candidate.lean'
      || evidence.command.environment.HOME !== path.dirname(sourcePath)) {
    throw new ProofKernelError('EVIDENCE_SUBSTITUTION', 'evidence temporary source path is inconsistent');
  }
  const replayEvidence = await executeValidated({
    ...validated,
    proofKernelRoot: path.resolve(proofKernelRoot),
    replayDirectory: path.dirname(sourcePath),
    authenticatedPreflight: replayPreflight,
  });
  if (!validateReplayEvidenceIdentity(evidence, replayEvidence).ok) {
    throw new ProofKernelError('REPLAY_MISMATCH', 'independent kernel replay did not reproduce the recorded evidence');
  }
  return {
    verified: true,
    originalEvidenceDigest: canonicalProofDigest(evidence),
    replayEvidenceDigest: canonicalProofDigest(replayEvidence),
    replayEvidence,
  };
}
