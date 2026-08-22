import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import register from './index.ts';
import {
  LESSON_SCHEMA,
  activationProfilesForQuery,
  atomicWriteSignedRegistry,
  deduplicateLiveLessons,
  emptyRegistry,
  initializeRegistry,
  liveLessonSemanticKey,
  loadSignedRegistry,
  readRegistrySecret,
  selectLiveLessons,
  signRegistry,
  validateLiveLesson,
  verifyRegistry,
} from './registry.mjs';
import {
  TRANSFER_ENTRY_SCHEMA,
  atomicWriteSignedTransferRegistry,
  initializeTransferRegistry,
} from './transfer-registry.mjs';

function lesson(overrides = {}) {
  return {
    schemaVersion: LESSON_SCHEMA,
    lessonId: 'lesson_exact_multiplication_test',
    capsuleId: 'math-foundations-v0',
    domain: 'math',
    conceptIds: ['number-fractions'],
    rule: 'Decompose one factor into place-value chunks, sum exact partial products, and verify the result.',
    contraindications: ['Estimation is not the final exact answer.'],
    promotionProofDigest: 'a'.repeat(64),
    promotedAt: '2026-07-25T05:31:38.879Z',
    retestAfter: '2026-10-23T05:31:38.879Z',
    activationProfiles: ['exact_multiplication'],
    enabled: true,
    source: {
      runId: 'math-foundations-smoke-test',
      trustedLessonSha256: 'b'.repeat(64),
      promotionReportSha256: 'c'.repeat(64),
      artifactManifestSha256: 'd'.repeat(64),
    },
    ...overrides,
  };
}

function setupRegistry({ lessons = [lesson()], enabled = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-live-plugin-'));
  const registryPath = path.join(root, 'live-registry.json');
  const secretPath = path.join(root, 'registry.hmac');
  const telemetryPath = path.join(root, 'telemetry.json');
  const initialized = initializeRegistry({ registryPath, secretPath });
  const registry = atomicWriteSignedRegistry(registryPath, {
    ...initialized.registry,
    revision: 1,
    updatedAt: '2026-07-26T05:00:00.000Z',
    enabled,
    lessons,
  }, initialized.secret);
  return { root, registryPath, secretPath, telemetryPath, registry, secret: initialized.secret };
}

async function invoke(setup, { query = 'Compute exactly: 6,243,088,374 × 2,167,829.', prompt = null, mode = 'active', killSwitch = false, agentId = 'main', sessionKey = 'agent:main:whatsapp:direct:test', messages = null, configOverrides = {} } = {}) {
  const handlers = new Map();
  const logs = [];
  register({
    config: {
      enabled: true,
      mode,
      killSwitch,
      registryPath: setup.registryPath,
      registryHmacSecretPath: setup.secretPath,
      telemetryPath: setup.telemetryPath,
      allowedAgentIds: ['main'],
      maxLessons: 3,
      maxContextChars: 3000,
      telemetryMaxRecords: 100,
      ...configOverrides,
    },
    logger: { info(value) { logs.push(String(value)); }, warn(value) { logs.push(String(value)); } },
    on(name, handler) { handlers.set(name, handler); },
  });
  const result = await handlers.get('before_prompt_build')(
    { prompt: prompt ?? query, messages: messages ?? [{ role: 'user', content: query }] },
    { agentId, sessionKey },
  );
  const telemetry = fs.existsSync(setup.telemetryPath) ? JSON.parse(fs.readFileSync(setup.telemetryPath, 'utf8')) : null;
  return { context: String(result?.appendSystemContext || ''), telemetry, logs };
}

function transferEntry(overrides = {}) {
  return {
    schemaVersion: TRANSFER_ENTRY_SCHEMA,
    entryId: 'transfer_exact_multiplication_test',
    profileId: 'exact-multiplication',
    profileVersion: '1.0.0',
    conceptIds: ['number-fractions'],
    matcherId: 'code-exact-integer-multiplication-v1',
    enabled: true,
    qualificationState: 'qualified',
    qualificationRunId: 'transfer-qualified-test',
    artifactManifestDigest: '1'.repeat(64),
    evidenceDigest: '2'.repeat(64),
    profileDigest: '3'.repeat(64),
    qualifiedAt: '2026-07-26T05:00:00.000Z',
    expiresAt: '2027-07-26T05:00:00.000Z',
    allowedAgentIds: ['main'],
    context: {
      applicabilityReason: 'Exact integer code and overflow safety are explicit.',
      assumptions: [
        { code: 'operands-are-integers', description: 'Operands are explicitly integers.' },
        { code: 'exact-result-required', description: 'The result must be exact.' },
        { code: 'arbitrary-precision-or-overflow-safety-required', description: 'Overflow safety is explicit.' },
      ],
      contraindications: ['floating-point-domain: reject approximation'],
      computationalFormulation: 'Use exact signed integer arithmetic.',
      implementationPatterns: ['Parse exact integer strings and multiply with BigInt.'],
      verificationOracle: 'exact-integer-product-v1: compare exact signed decimal output.',
      complexityRisk: 'Complexity depends on operand digits.',
      numericalRisk: 'Floating-point conversion loses precision.',
      truthBoundary: 'This narrow entry is not broad coding mastery or empirical benefit.',
    },
    ...overrides,
  };
}

function setupTransferRegistry(root, entries = [transferEntry()]) {
  const registryPath = path.join(root, 'transfer-registry.json');
  const secretPath = path.join(root, 'transfer-registry.hmac');
  const telemetryPath = path.join(root, 'transfer-telemetry.json');
  const initialized = initializeTransferRegistry({ registryPath, secretPath });
  atomicWriteSignedTransferRegistry(registryPath, {
    ...initialized.registry,
    revision: 1,
    updatedAt: '2026-07-26T05:00:00.000Z',
    entries,
  }, initialized.secret);
  return { registryPath, secretPath, telemetryPath };
}

test('registry signatures and strict lesson schema validate', () => {
  const setup = setupRegistry();
  try {
    assert.equal(validateLiveLesson(lesson()).ok, true);
    assert.equal(verifyRegistry(setup.registry, setup.secret).ok, true);
    assert.equal(loadSignedRegistry(setup.registryPath, readRegistrySecret(setup.secretPath)).lessons.length, 1);
    const tampered = { ...setup.registry, revision: 99 };
    assert.equal(verifyRegistry(tampered, setup.secret).ok, false);
    assert.match(verifyRegistry(tampered, setup.secret).errors.join(' '), /signature mismatch/);
    assert.equal(signRegistry(emptyRegistry(), setup.secret).signature.digest.length, 64);
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});

test('semantic lesson deduplication retains the newest equivalent evidence deterministically', () => {
  const older = lesson();
  const newer = lesson({
    lessonId: 'lesson_exact_multiplication_newer',
    promotionProofDigest: 'e'.repeat(64),
    promotedAt: '2026-07-26T15:48:58.540Z',
    retestAfter: '2026-10-24T15:48:58.540Z',
    rule: '  Decompose one factor into place-value chunks,   sum exact partial products, and verify the result. ',
    source: {
      runId: 'math-training-newer',
      trustedLessonSha256: 'f'.repeat(64),
      promotionReportSha256: '1'.repeat(64),
      artifactManifestSha256: '2'.repeat(64),
    },
  });
  const distinct = lesson({
    lessonId: 'lesson_linear_equation_distinct',
    conceptIds: ['algebra-linear-equations'],
    rule: 'Apply the same inverse operation to both sides and verify by substitution.',
    activationProfiles: ['linear_equation'],
  });
  assert.equal(liveLessonSemanticKey(older), liveLessonSemanticKey(newer));
  assert.notEqual(liveLessonSemanticKey(older), liveLessonSemanticKey(distinct));
  const result = deduplicateLiveLessons([older, distinct, newer]);
  assert.deepEqual(result.lessons.map((row) => row.lessonId), [
    'lesson_exact_multiplication_newer',
    'lesson_linear_equation_distinct',
  ]);
  assert.deepEqual(result.removedLessonIds, ['lesson_exact_multiplication_test']);
});

test('query profiles are narrow and deterministic', () => {
  assert.deepEqual(activationProfilesForQuery('Compute exactly: 6,243,088,374 × 2,167,829.'), ['exact_multiplication']);
  assert.deepEqual(activationProfilesForQuery('What is the weather tomorrow?'), []);
  assert.deepEqual(activationProfilesForQuery('Refactor x * y in this TypeScript function.'), []);
  assert.deepEqual(activationProfilesForQuery('Solve 3x + 2 = 11.'), ['linear_equation']);
  assert.deepEqual(activationProfilesForQuery('Give the roots of x^2 - 5x + 6 = 0.'), ['quadratic_roots']);
});

test('active mode injects only a signed, unexpired, matching lesson', async () => {
  const setup = setupRegistry();
  try {
    const result = await invoke(setup);
    assert.match(result.context, /CORTEX_LEARNING_OS_LIVE/);
    assert.match(result.context, /lesson_exact_multiplication_test/);
    assert.match(result.context, /promotion_proof_digest: a{64}/);
    assert.equal(result.telemetry.counters.applied, 1);
    assert.equal(result.telemetry.records[0].answerInfluence, true);
    assert.deepEqual(result.telemetry.records[0].selectedLessonIds, ['lesson_exact_multiplication_test']);
    assert.doesNotMatch(JSON.stringify(result.telemetry), /6,243,088,374|2,167,829|Decompose one factor/);
    assert.equal(fs.statSync(setup.telemetryPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});

test('structured user turns take precedence and non-matching turns do not inject lessons', async () => {
  const setup = setupRegistry();
  try {
    assert.equal((await invoke(setup, { query: 'Draft a friendly project update.' })).context, '');
    assert.equal((await invoke(setup, { query: 'Solve 3x + 2 = 11.' })).context, '');
    assert.equal((await invoke(setup, {
      query: 'Draft a friendly project update.',
      prompt: 'Compute exactly: 98,765 × 4,321.',
    })).context, '');
    const state = JSON.parse(fs.readFileSync(setup.telemetryPath, 'utf8'));
    assert.equal(state.counters.applied || 0, 0);
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});

test('prompt fallback supports OpenClaw hook events that omit messages', async () => {
  const setup = setupRegistry();
  try {
    const result = await invoke(setup, { messages: [], prompt: 'Compute exactly: 98,765 × 4,321.' });
    assert.match(result.context, /CORTEX_LEARNING_OS_LIVE/);
    assert.equal(result.telemetry.records.at(-1).querySource, 'prompt_fallback');
    assert.equal(result.telemetry.records.at(-1).answerInfluence, true);
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});

test('shadow, kill switch, non-main agent, and training sessions remain answer-isolated', async () => {
  const setup = setupRegistry();
  try {
    assert.equal((await invoke(setup, { mode: 'shadow' })).context, '');
    assert.equal((await invoke(setup, { killSwitch: true })).context, '');
    assert.equal((await invoke(setup, { agentId: 'oracle' })).context, '');
    assert.equal((await invoke(setup, { sessionKey: 'math-foundations-training-1' })).context, '');
    const state = JSON.parse(fs.readFileSync(setup.telemetryPath, 'utf8'));
    assert.equal(state.counters.applied || 0, 0);
    assert.equal(state.counters.shadowSelected, 1);
    assert.equal(state.counters.bypassed, 3);
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});

test('tampered registry fails closed without lesson or query leakage', async () => {
  const setup = setupRegistry();
  try {
    const document = JSON.parse(fs.readFileSync(setup.registryPath, 'utf8'));
    document.lessons[0].rule = 'TAMPERED_PRIVATE_RULE';
    fs.writeFileSync(setup.registryPath, `${JSON.stringify(document)}\n`, { mode: 0o600 });
    const result = await invoke(setup);
    assert.equal(result.context, '');
    assert.equal(result.telemetry.counters.registryInvalid, 1);
    assert.doesNotMatch(JSON.stringify(result.telemetry), /TAMPERED_PRIVATE_RULE|6,243,088,374/);
    assert.match(result.logs.join('\n'), /registry rejected/);
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});

test('expired lessons remain signed evidence but are excluded from live selection', () => {
  const setup = setupRegistry({ lessons: [lesson({ retestAfter: '2026-07-25T06:00:00.000Z' })] });
  try {
    const registry = loadSignedRegistry(setup.registryPath, setup.secret, { allowExpiredLessons: true });
    const selection = selectLiveLessons(registry, 'Compute exactly: 12345 × 67890.', { now: Date.parse('2026-07-26T00:00:00Z') });
    assert.equal(selection.eligible, true);
    assert.deepEqual(selection.lessons, []);
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});

test('transfer defaults active but requires a qualified signed entry; explicit shadow remains isolated', async () => {
  const setup = setupRegistry({ lessons: [] });
  const transfer = setupTransferRegistry(setup.root);
  const query = 'Implement an overflow-safe arbitrary-precision integer multiplication function in TypeScript using BigInt and return the exact product.';
  const config = {
    transferRegistryPath: transfer.registryPath,
    transferRegistryHmacSecretPath: transfer.secretPath,
    transferTelemetryPath: transfer.telemetryPath,
  };
  try {
    const active = await invoke(setup, { query, configOverrides: config });
    assert.match(active.context, /CORTEX_LEARNING_OS_CODING_TRANSFER/);
    assert.match(active.context, /exact-integer-product-v1/);
    let telemetry = JSON.parse(fs.readFileSync(transfer.telemetryPath, 'utf8'));
    assert.equal(telemetry.records.at(-1).outcome, 'applied');
    assert.equal(telemetry.records.at(-1).answerInfluence, true);
    const shadow = await invoke(setup, { query, configOverrides: { ...config, transferMode: 'shadow' } });
    assert.equal(shadow.context, '');
    telemetry = JSON.parse(fs.readFileSync(transfer.telemetryPath, 'utf8'));
    assert.equal(telemetry.records.at(-1).outcome, 'shadow_selected');
    assert.equal(telemetry.records.at(-1).answerInfluence, false);
    assert.doesNotMatch(JSON.stringify(telemetry), /overflow-safe arbitrary-precision integer multiplication function/);
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});

test('active-default transfer injects nothing when the signed registry has no qualified entry', async () => {
  const setup = setupRegistry({ lessons: [] });
  const transfer = setupTransferRegistry(setup.root, []);
  const query = 'Implement an overflow-safe arbitrary-precision integer multiplication function in TypeScript using BigInt and return the exact product.';
  try {
    const result = await invoke(setup, {
      query,
      configOverrides: {
        transferRegistryPath: transfer.registryPath,
        transferRegistryHmacSecretPath: transfer.secretPath,
        transferTelemetryPath: transfer.telemetryPath,
      },
    });
    assert.equal(result.context, '');
    const telemetry = JSON.parse(fs.readFileSync(transfer.telemetryPath, 'utf8'));
    assert.equal(telemetry.records.at(-1).outcome, 'no_match');
    assert.equal(telemetry.records.at(-1).answerInfluence, false);
    assert.ok(telemetry.records.at(-1).reasonCodes.includes('no-active-qualified-entry'));
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});

test('transfer trust failure remains isolated from a valid math lesson path', async () => {
  const setup = setupRegistry();
  try {
    const query = 'In TypeScript, implement overflow-safe exact integer multiplication with BigInt, then compute exactly: 12,345 * 67,890.';
    const result = await invoke(setup, { query });
    assert.match(result.context, /CORTEX_LEARNING_OS_LIVE/);
    assert.doesNotMatch(result.context, /CORTEX_LEARNING_OS_CODING_TRANSFER/);
    assert.match(result.logs.join('\n'), /transfer registry rejected independently/);
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});
