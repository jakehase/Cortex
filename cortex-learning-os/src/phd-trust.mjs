import crypto from 'node:crypto';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  executionEvidenceSha256,
  validateExecutionEvidenceRecord,
  verifyExecutionEvidenceBytes,
} from './execution-evidence.mjs';
import { sha256Text } from './hash.mjs';

export const PHD_TRUST_POLICY_SCHEMA = 'cortex.learning_os.phd_trust_policy.v1';
export const AUTHORITY_ATTESTATION_SCHEMA = 'cortex.learning_os.authority_attestation.v1';
export const EXECUTION_ATTESTATION_SCHEMA = 'cortex.learning_os.execution_attestation.v2';

const DIGEST = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const REQUIRED_PRODUCTION_CAPABILITIES = Object.freeze([
  'acquisition',
  'bank_authoring',
  'bank_review',
  'execution',
  'grader',
  'proctor',
  'proof_replay',
  'proof_runtime',
  'qualification_family_registry',
  'research_correspondence',
  'research_reproduction',
  'research_review',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function publicKeyFingerprint(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('trust authority key must be Ed25519');
  return sha256Text(key.export({ format: 'der', type: 'spki' }));
}

export function validatePhdTrustPolicy(policy, { requireProduction = false } = {}) {
  const errors = [];
  if (!isRecord(policy) || policy.schemaVersion !== PHD_TRUST_POLICY_SCHEMA) {
    return { ok: false, errors: ['invalid PhD trust policy schemaVersion'] };
  }
  if (!exactKeys(policy, [
    'schemaVersion',
    'policyId',
    'boundaryId',
    'productionEnabled',
    'authorities',
    'truthBoundary',
  ])) {
    errors.push('PhD trust policy fields are incomplete or unknown');
  }
  if (!IDENTIFIER.test(String(policy.policyId || ''))
      || !IDENTIFIER.test(String(policy.boundaryId || ''))) {
    errors.push('invalid trust policy or boundary identity');
  }
  if (typeof policy.productionEnabled !== 'boolean') errors.push('trust policy must declare productionEnabled');
  if (!Array.isArray(policy.authorities) || policy.authorities.length > 128) {
    errors.push('trust policy authorities are invalid');
  } else {
    const authorityIds = new Set();
    const keyIds = new Set();
    for (const authority of policy.authorities) {
      let fingerprint = null;
      try {
        fingerprint = publicKeyFingerprint(authority?.publicKeyPem);
      } catch {
        errors.push(`invalid trust authority key: ${String(authority?.authorityId || 'unknown')}`);
      }
      if (!exactKeys(authority, ['authorityId', 'capabilities', 'publicKeyPem', 'keyId'])
          || !IDENTIFIER.test(String(authority?.authorityId || ''))
          || authorityIds.has(authority.authorityId)
          || !Array.isArray(authority.capabilities) || authority.capabilities.length < 1
          || new Set(authority.capabilities).size !== authority.capabilities.length
          || authority.capabilities.some((capability) => !IDENTIFIER.test(String(capability)))) {
        errors.push('invalid or duplicate trust authority');
      }
      if (fingerprint && (authority.keyId !== fingerprint || keyIds.has(fingerprint))) {
        errors.push('trust authority keyId mismatch or key reuse');
      }
      authorityIds.add(authority?.authorityId);
      if (fingerprint) keyIds.add(fingerprint);
    }
  }
  if (requireProduction) {
    if (policy.productionEnabled !== true) errors.push('production trust policy is not enabled');
    for (const capability of REQUIRED_PRODUCTION_CAPABILITIES) {
      const matching = (policy.authorities || []).filter((authority) => (
        authority.capabilities?.includes(capability)
      ));
      if (matching.length < 1) errors.push(`production trust policy omits ${capability} authority`);
    }
    for (const authority of policy.authorities || []) {
      const criticalCapabilities = (Array.isArray(authority?.capabilities)
        ? authority.capabilities
        : []).filter((capability) => (
        REQUIRED_PRODUCTION_CAPABILITIES.includes(capability)
      ));
      if (criticalCapabilities.length > 1) {
        errors.push(`production authority combines independent capabilities: ${authority.authorityId}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function authorityFor(policy, authorityId, capability) {
  const validation = validatePhdTrustPolicy(policy);
  if (!validation.ok) throw new Error(`invalid PhD trust policy: ${validation.errors.join('; ')}`);
  const authority = policy.authorities.find((row) => row.authorityId === authorityId);
  if (!authority || !authority.capabilities.includes(capability)) {
    throw new Error(`authority is not trusted for ${capability}`);
  }
  return authority;
}

export function verifyAuthorityAttestation(attestation, {
  trustPolicy,
  capability,
  schemaVersion = AUTHORITY_ATTESTATION_SCHEMA,
} = {}) {
  if (!exactKeys(attestation, [
    'schemaVersion',
    'attestationId',
    'authorityId',
    'payload',
    'signature',
  ])
      || attestation.schemaVersion !== schemaVersion
      || !IDENTIFIER.test(String(attestation.attestationId || ''))
      || !IDENTIFIER.test(String(attestation.authorityId || ''))
      || !isRecord(attestation.payload)
      || !exactKeys(attestation.signature, ['algorithm', 'keyId', 'valueBase64'])
      || attestation.signature?.algorithm !== 'ed25519'
      || !DIGEST.test(String(attestation.signature?.keyId || ''))
      || typeof attestation.signature?.valueBase64 !== 'string') return false;
  const signatureBytes = Buffer.from(attestation.signature.valueBase64, 'base64');
  if (signatureBytes.length !== 64
      || signatureBytes.toString('base64') !== attestation.signature.valueBase64) return false;
  let authority;
  try {
    authority = authorityFor(trustPolicy, attestation.authorityId, capability);
  } catch {
    return false;
  }
  if (attestation.signature.keyId !== authority.keyId) return false;
  try {
    return crypto.verify(
      null,
      Buffer.from(canonicalJson({
        schemaVersion: attestation.schemaVersion,
        attestationId: attestation.attestationId,
        authorityId: attestation.authorityId,
        payload: attestation.payload,
      }), 'utf8'),
      authority.publicKeyPem,
      signatureBytes,
    );
  } catch {
    return false;
  }
}

export function createExecutionAttestation({
  trustPolicy,
  privateKeyPem,
  executionEvidenceCore,
  executionEvidenceSha256: suppliedExecutionEvidenceSha256,
  executionId,
  ledgerPreviousSha256 = null,
} = {}) {
  const trustValidation = validatePhdTrustPolicy(trustPolicy, { requireProduction: true });
  if (!trustValidation.ok) {
    throw new Error(`cannot sign execution evidence under an invalid production trust policy: ${trustValidation.errors.join('; ')}`);
  }
  const evidenceValidation = validateExecutionEvidenceRecord({
    core: executionEvidenceCore,
    executionEvidenceSha256: suppliedExecutionEvidenceSha256,
  });
  if (!evidenceValidation.ok) {
    throw new Error(`cannot sign invalid execution evidence: ${evidenceValidation.errors.join('; ')}`);
  }
  if (!IDENTIFIER.test(String(executionId || ''))
      || (!DIGEST.test(String(ledgerPreviousSha256 || '')) && ledgerPreviousSha256 !== null)) {
    throw new Error('execution attestation identity or ledger predecessor is invalid');
  }
  const authorities = trustPolicy.authorities.filter((authority) => (
    authority.capabilities.length === 1 && authority.capabilities[0] === 'execution'
  ));
  if (authorities.length !== 1) throw new Error('production trust policy requires one dedicated execution authority');
  const authority = authorities[0];
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const derivedPublicKey = crypto.createPublicKey(privateKey);
  const derivedFingerprint = sha256Text(derivedPublicKey.export({ format: 'der', type: 'spki' }));
  if (derivedFingerprint !== authority.keyId) {
    throw new Error('execution authority private key does not match the production trust policy');
  }
  const payload = {
    boundaryId: trustPolicy.boundaryId,
    executionEvidenceCore: structuredClone(executionEvidenceCore),
    executionEvidenceSha256: suppliedExecutionEvidenceSha256,
    executionId,
    ledgerPreviousSha256,
  };
  const core = {
    schemaVersion: EXECUTION_ATTESTATION_SCHEMA,
    attestationId: `attestation-${executionId}`,
    authorityId: authority.authorityId,
    payload,
  };
  const attestation = {
    ...core,
    signature: {
      algorithm: 'ed25519',
      keyId: authority.keyId,
      valueBase64: crypto.sign(
        null,
        Buffer.from(canonicalJson(core), 'utf8'),
        privateKey,
      ).toString('base64'),
    },
  };
  if (!verifyAuthorityAttestation(attestation, {
    trustPolicy,
    capability: 'execution',
    schemaVersion: EXECUTION_ATTESTATION_SCHEMA,
  })) {
    throw new Error('execution attestation failed self-verification');
  }
  return attestation;
}

export function validateCapabilityAuthorityIndependence({
  trustPolicy,
  firstAttestation,
  firstCapability,
  secondAttestation,
  secondCapability,
  requireProduction = true,
} = {}) {
  const errors = [];
  const trustValidation = validatePhdTrustPolicy(trustPolicy, { requireProduction });
  if (!trustValidation.ok) {
    errors.push(...trustValidation.errors.map((error) => `trust policy: ${error}`));
    return { ok: false, errors };
  }
  if (!IDENTIFIER.test(String(firstCapability || ''))
      || !IDENTIFIER.test(String(secondCapability || ''))
      || firstCapability === secondCapability) {
    errors.push('independent capability identities are invalid');
    return { ok: false, errors };
  }
  if (!verifyAuthorityAttestation(firstAttestation, {
    trustPolicy,
    capability: firstCapability,
  })) {
    errors.push(`first authority is not authenticated for ${firstCapability}`);
  }
  if (!verifyAuthorityAttestation(secondAttestation, {
    trustPolicy,
    capability: secondCapability,
  })) {
    errors.push(`second authority is not authenticated for ${secondCapability}`);
  }
  if (firstAttestation?.authorityId === secondAttestation?.authorityId) {
    errors.push('independent capabilities use the same authority ID');
  }
  if (firstAttestation?.signature?.keyId === secondAttestation?.signature?.keyId) {
    errors.push('independent capabilities use the same verification-key digest');
  }
  return { ok: errors.length === 0, errors };
}

export function verifyTrustedExecutionEvidence({
  attestation,
  trustPolicy,
  executionEvidenceCore,
  executionEvidenceSha256: suppliedExecutionEvidenceSha256,
  inputBytes,
  rawOutputBytes,
  rawEventLedgerBytes,
  rawStderrBytes,
  expected,
} = {}) {
  const errors = [];
  if (!verifyAuthorityAttestation(attestation, {
    trustPolicy,
    capability: 'execution',
    schemaVersion: EXECUTION_ATTESTATION_SCHEMA,
  })) {
    return { ok: false, errors: ['trusted execution attestation signature mismatch'] };
  }
  const envelope = attestation.payload;
  if (!isRecord(envelope)
      || canonicalJson(Object.keys(envelope).sort()) !== canonicalJson([
        'boundaryId',
        'executionEvidenceCore',
        'executionEvidenceSha256',
        'executionId',
        'ledgerPreviousSha256',
      ])
      || envelope.boundaryId !== trustPolicy.boundaryId
      || !IDENTIFIER.test(String(envelope.executionId || ''))
      || (!DIGEST.test(String(envelope.ledgerPreviousSha256 || ''))
        && envelope.ledgerPreviousSha256 !== null)) {
    errors.push('trusted execution authenticated envelope is invalid');
  }
  const attestedRecord = {
    core: envelope?.executionEvidenceCore,
    executionEvidenceSha256: envelope?.executionEvidenceSha256,
  };
  const attestedValidation = validateExecutionEvidenceRecord(attestedRecord);
  errors.push(...attestedValidation.errors);
  const suppliedRecord = {
    core: executionEvidenceCore,
    executionEvidenceSha256: suppliedExecutionEvidenceSha256,
  };
  const suppliedValidation = validateExecutionEvidenceRecord(suppliedRecord);
  errors.push(...suppliedValidation.errors.map((error) => `stored execution-evidence: ${error}`));
  if (attestedValidation.ok && suppliedValidation.ok
      && (canonicalJson(executionEvidenceCore) !== canonicalJson(envelope.executionEvidenceCore)
        || suppliedExecutionEvidenceSha256 !== envelope.executionEvidenceSha256)) {
    errors.push('stored execution-evidence core or digest is detached from the authenticated envelope');
  }
  const core = envelope?.executionEvidenceCore;
  if (attestedValidation.ok) {
    if (inputBytes === undefined || rawOutputBytes === undefined
        || rawEventLedgerBytes === undefined || rawStderrBytes === undefined) {
      errors.push('trusted execution exact prompt, output, stdout, or stderr bytes are unavailable');
    } else {
      const outputPath = core.outputs.files.length === 1 ? core.outputs.files[0].path : null;
      if (outputPath === null) {
        errors.push('trusted model execution must have exactly one canonical output file');
      } else {
        const byteValidation = verifyExecutionEvidenceBytes(core, {
          inputBytes,
          rawOutputs: {
            stdout: rawEventLedgerBytes,
            stderr: rawStderrBytes,
          },
          outputFiles: {
            [outputPath]: rawOutputBytes,
          },
        });
        errors.push(...byteValidation.errors);
      }
    }
  }
  const model = core?.model;
  const bindings = core?.bindings;
  const processRecord = core?.process;
  if (core?.executionKind !== 'model'
      || model?.provider !== expected?.provider
      || model?.model !== expected?.model
      || model?.thinking !== 'xhigh'
      || model?.sandbox !== 'read-only'
      || model?.toolsAllowed !== false
      || !Array.isArray(model?.toolsUsed) || model.toolsUsed.length !== 0
      || model?.plannedSessionId !== expected?.plannedSessionId
      || core?.input?.sha256 !== expected?.promptSha256) {
    errors.push('trusted execution runtime, prompt, role, or session binding mismatch');
  }
  if (expected?.role !== undefined && expected.role !== null
      && expected.role !== core?.environment?.declared?.role) {
    errors.push('trusted execution role binding mismatch');
  }
  if (isRecord(expected?.bindings)) {
    for (const [key, value] of Object.entries(expected.bindings)) {
      if (!Object.hasOwn(bindings || {}, key) || bindings[key] !== value) {
        errors.push(`trusted execution ${key} binding mismatch`);
      }
    }
  }
  if (expected?.command !== undefined
      && canonicalJson(core?.command) !== canonicalJson(expected.command)) {
    errors.push('trusted execution command or executable binding mismatch');
  }
  if (trustPolicy?.productionEnabled === true
      && expected?.approvedExecutable === undefined) {
    errors.push('trusted production execution is missing the independently approved executable identity');
  }
  if (expected?.approvedExecutable !== undefined) {
    const approved = expected.approvedExecutable;
    if (!isRecord(approved)
        || core?.command?.requestedArgv?.[0] !== approved.path
        || core?.command?.executedArgv?.[0] !== '/proc/self/fd/3'
        || core?.command?.executable?.invoked !== approved.path
        || core?.command?.executable?.resolvedPath !== '/proc/self/fd/3'
        || core?.command?.executable?.bytes !== approved.bytes
        || core?.command?.executable?.sha256 !== approved.sha256) {
      errors.push('trusted execution differs from the independently approved executable identity');
    }
  }
  if (expected?.observedEnvironment !== undefined
      && canonicalJson(core?.environment?.observed)
        !== canonicalJson(expected.observedEnvironment)) {
    errors.push('trusted execution observed environment binding mismatch');
  }
  const startedAt = Date.parse(String(processRecord?.startedAt || ''));
  const completedAt = Date.parse(String(processRecord?.completedAt || ''));
  const expectedNotBefore = Date.parse(String(expected?.notBefore || ''));
  const expectedNotAfter = Date.parse(String(expected?.notAfter || ''));
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)
      || new Date(startedAt).toISOString() !== processRecord?.startedAt
      || new Date(completedAt).toISOString() !== processRecord?.completedAt
      || completedAt < startedAt) {
    errors.push('trusted execution timestamps are invalid');
  }
  if (!Number.isFinite(expectedNotBefore) || !Number.isFinite(expectedNotAfter)
      || expectedNotAfter < expectedNotBefore) {
    errors.push('trusted execution expected interval is missing or invalid');
  } else if (startedAt < expectedNotBefore || completedAt > expectedNotAfter) {
    errors.push('trusted execution is stale, pre-commit, or outside its authenticated interval');
  }
  if (typeof expected?.startedAt !== 'string' || typeof expected?.completedAt !== 'string'
      || processRecord?.startedAt !== expected.startedAt
      || processRecord?.completedAt !== expected.completedAt) {
    errors.push('stored wrapper attempt times differ from authenticated provider times');
  }
  const projectedPayload = attestedValidation.ok ? executionEvidencePayload(attestation) : null;
  return {
    ok: errors.length === 0,
    errors,
    payload: projectedPayload,
    core: attestedValidation.ok ? core : null,
    executionEvidenceSha256: attestedValidation.ok
      ? executionEvidenceSha256(core)
      : null,
  };
}

export function executionEvidencePayload(attestation) {
  const envelope = attestation?.payload;
  const validation = validateExecutionEvidenceRecord({
    core: envelope?.executionEvidenceCore,
    executionEvidenceSha256: envelope?.executionEvidenceSha256,
  });
  if (!validation.ok || envelope.executionEvidenceCore.executionKind !== 'model') return null;
  const core = envelope.executionEvidenceCore;
  const output = core.outputs.files[0];
  const stdout = core.outputs.raw.find((record) => record.name === 'stdout');
  return {
    boundaryId: envelope.boundaryId,
    executionId: envelope.executionId,
    ledgerPreviousSha256: envelope.ledgerPreviousSha256,
    provider: core.model.provider,
    model: core.model.model,
    thinking: core.model.thinking,
    sandbox: core.model.sandbox,
    toolsAllowed: core.model.toolsAllowed,
    toolsUsed: core.model.toolsUsed,
    usage: core.model.usage,
    providerRequestId: core.model.providerRequestId,
    providerSessionId: core.model.providerSessionId,
    plannedSessionId: core.model.plannedSessionId,
    role: core.environment.declared.role,
    promptSha256: core.input.sha256,
    outputSha256: output.sha256,
    rawEventLedgerSha256: stdout.sha256,
    startedAt: core.process.startedAt,
    completedAt: core.process.completedAt,
    executionEvidenceCore: core,
    executionEvidenceSha256: envelope.executionEvidenceSha256,
  };
}

export function authorityIdsForCapability(policy, capability) {
  return (policy?.authorities || [])
    .filter((authority) => authority.capabilities?.includes(capability))
    .map((authority) => authority.authorityId);
}
