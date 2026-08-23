import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildProviderAccessContract,
  executeCapabilityGatedProviderOperation,
  normalizeProviderPolicy,
} from '../packages/aios-language/runtime/provider-read-compute.mjs';


function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}


function providerPolicy({ resultContract = 'cortex.oracle-chat.v1', allowedModels = ['auto', 'tinyllama', 'gpt-5'] } = {}) {
  const compute = {
    enabled: true,
    path: '/oracle/chat',
    method: 'POST',
    capability: 'provider.cortex.compute',
    allowedModels,
  };
  if (resultContract) compute.resultContract = resultContract;
  return normalizeProviderPolicy({
    schemaVersion: 'aios.provider-read-compute-policy.v1',
    enabled: true,
    outputBoundary: 'internal-artifact-only',
    externalWrites: false,
    providers: {
      cortex: {
        enabled: true,
        transport: 'http-json',
        baseUrl: 'http://127.0.0.1:8000',
        allowLoopbackHttp: true,
        operations: { compute },
      },
    },
  });
}


function providerAccess(policy) {
  return buildProviderAccessContract({
    policy,
    capabilities: [{ name: 'provider.cortex.compute', scope: 'compute', boundary: 'external' }],
    syscalls: [{ op: 'provider.compute', args: { provider: 'cortex' } }],
  });
}


function validOracleBody(overrides = {}) {
  const response = overrides.response ?? 'verified provider answer';
  const model = overrides.model ?? 'gpt-5';
  const provider = overrides.provider ?? 'openrouter';
  const receipt = {
    version: 'cortex.oracle.completion.v1',
    receipt_id: 'oracle_verified_receipt',
    kind: 'provider_response',
    source: `${provider}:${model}`,
    completed_at: '2026-08-22T20:00:00+00:00',
    response_sha256: sha256(response),
    evidence: {
      provider,
      model,
      identity_source: 'openclaw_agent_meta',
    },
    ...(overrides.completion_receipt ?? {}),
  };
  return {
    response,
    model,
    done: true,
    lane: 'gated_direct',
    origin: 'openclaw_subprocess',
    provider_invoked: true,
    degraded: false,
    completion_receipt: receipt,
    ...overrides,
    completion_receipt: overrides.completion_receipt === null ? null : receipt,
  };
}


async function executeWithBody({ policy, access, artifactRoot, ordinal, body, model = 'auto' }) {
  return executeCapabilityGatedProviderOperation({
    policy,
    access,
    op: 'provider.compute',
    args: { provider: 'cortex', prompt: 'test prompt', model },
    artifactRoot,
    processId: 'routing-provider-test',
    ordinal,
    fetchImpl: async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
}


test('Cortex Oracle result contract rejects empty, incomplete, synthetic, and receiptless success before writing', async () => {
  const policy = providerPolicy();
  const access = providerAccess(policy);
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-oracle-contract-reject-'));
  const cases = [
    [{}, 'AIOS_PROVIDER_RESULT_SCHEMA_INVALID'],
    [validOracleBody({ response: '' }), 'AIOS_PROVIDER_RESULT_SCHEMA_INVALID'],
    [validOracleBody({ done: false }), 'AIOS_PROVIDER_RESULT_INCOMPLETE'],
    [validOracleBody({ degraded: true }), 'AIOS_PROVIDER_RESULT_DEGRADED'],
    [validOracleBody({ provider_invoked: false }), 'AIOS_PROVIDER_RESULT_DEGRADED'],
    [validOracleBody({ lane: 'emergency_static', origin: 'static_acknowledgement' }), 'AIOS_PROVIDER_RESULT_PROVENANCE_REJECTED'],
    [validOracleBody({ lane: 'local_heuristic', origin: 'schema_repair' }), 'AIOS_PROVIDER_RESULT_PROVENANCE_REJECTED'],
    [validOracleBody({ completion_receipt: null }), 'AIOS_PROVIDER_RESULT_RECEIPT_INVALID'],
    [validOracleBody({ completion_receipt: { response_sha256: '0'.repeat(64) } }), 'AIOS_PROVIDER_RESULT_RECEIPT_INVALID'],
  ];
  try {
    for (let index = 0; index < cases.length; index += 1) {
      const [body, code] = cases[index];
      await assert.rejects(
        executeWithBody({ policy, access, artifactRoot, ordinal: index + 1, body }),
        (error) => error.code === code,
      );
    }
    assert.equal(fs.existsSync(path.join(artifactRoot, 'provider-results')), false);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});


test('Cortex Oracle result contract enforces exact concrete model requests', async () => {
  const policy = providerPolicy();
  const access = providerAccess(policy);
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-oracle-contract-model-'));
  try {
    await assert.rejects(
      executeWithBody({
        policy,
        access,
        artifactRoot,
        ordinal: 1,
        body: validOracleBody({ model: 'gpt-5' }),
        model: 'tinyllama',
      }),
      (error) => error.code === 'AIOS_PROVIDER_RESULT_MODEL_MISMATCH',
    );
    assert.equal(fs.existsSync(path.join(artifactRoot, 'provider-results')), false);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('Cortex Oracle auto selection still enforces the selected-model allowlist', async () => {
  const policy = providerPolicy({ allowedModels: ['auto', 'tinyllama'] });
  const access = providerAccess(policy);
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-oracle-contract-auto-model-'));
  try {
    await assert.rejects(
      executeWithBody({
        policy,
        access,
        artifactRoot,
        ordinal: 1,
        body: validOracleBody({ model: 'unallowlisted-frontier-model' }),
        model: 'auto',
      }),
      (error) => error.code === 'AIOS_PROVIDER_RESULT_MODEL_MISMATCH',
    );
    await assert.rejects(
      executeWithBody({
        policy,
        access,
        artifactRoot,
        ordinal: 2,
        body: validOracleBody({ model: 'auto' }),
        model: 'auto',
      }),
      (error) => error.code === 'AIOS_PROVIDER_RESULT_IDENTITY_MISMATCH',
    );
    assert.equal(fs.existsSync(path.join(artifactRoot, 'provider-results')), false);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});


test('verified dynamic Oracle identity is persisted while generic providers remain contract-opt-in', async () => {
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-oracle-contract-valid-'));
  try {
    const policy = providerPolicy();
    const access = providerAccess(policy);
    const verified = await executeWithBody({
      policy,
      access,
      artifactRoot,
      ordinal: 1,
      body: validOracleBody(),
    });
    assert.equal(verified.resultContract, 'cortex.oracle-chat.v1');
    assert.equal(verified.selectedProvider, 'openrouter');
    assert.equal(verified.selectedModel, 'gpt-5');
    assert.equal(verified.selectedLane, 'gated_direct');
    const artifact = JSON.parse(fs.readFileSync(verified.resultPath, 'utf8'));
    assert.deepEqual(artifact.response.verifiedCompletion, {
      provider: 'openrouter',
      model: 'gpt-5',
      lane: 'gated_direct',
      origin: 'openclaw_subprocess',
      receiptId: 'oracle_verified_receipt',
      identitySource: 'openclaw_agent_meta',
      responseSha256: sha256('verified provider answer'),
    });

    const genericPolicy = providerPolicy({ resultContract: null });
    const generic = await executeWithBody({
      policy: genericPolicy,
      access: providerAccess(genericPolicy),
      artifactRoot,
      ordinal: 2,
      body: { answer: 'generic provider result' },
    });
    assert.equal(generic.resultContract, null);
    assert.equal(generic.selectedModel, null);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('production-shaped tinyllama policy accepts only a receipt-bound tinyllama completion', async () => {
  const policy = providerPolicy({ allowedModels: ['tinyllama'] });
  const access = providerAccess(policy);
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-oracle-contract-tinyllama-'));
  try {
    const result = await executeWithBody({
      policy,
      access,
      artifactRoot,
      ordinal: 1,
      body: validOracleBody({
        model: 'tinyllama',
        provider: 'ollama',
        lane: 'requested_tinyllama',
        origin: 'ollama_provider',
        completion_receipt: {
          evidence: {
            provider: 'ollama',
            model: 'tinyllama',
            identity_source: 'ollama_response',
          },
        },
      }),
      model: 'tinyllama',
    });
    assert.equal(result.selectedProvider, 'ollama');
    assert.equal(result.selectedModel, 'tinyllama');
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});
