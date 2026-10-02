import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildProviderAccessContract,
  executeCapabilityGatedProviderOperation,
  validateProviderResultContract,
} from '../packages/aios-language/runtime/provider-read-compute.mjs';

const ORACLE_RESULT_CONTRACT = 'cortex.oracle-chat.v1';
const reviewedProviderPolicy = JSON.parse(fs.readFileSync(
  new URL('../kernel/policy/provider-read-compute.json', import.meta.url),
  'utf8',
));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}


function providerAccess() {
  return buildProviderAccessContract({
    policy: reviewedProviderPolicy,
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


function validTinyllamaBody(overrides = {}) {
  const completionReceipt = overrides.completion_receipt;
  return validOracleBody({
    model: 'tinyllama',
    provider: 'ollama',
    lane: 'requested_tinyllama',
    origin: 'ollama_provider',
    ...overrides,
    completion_receipt: completionReceipt === null ? null : {
      evidence: {
        provider: 'ollama',
        model: 'tinyllama',
        identity_source: 'ollama_response',
      },
      ...(completionReceipt ?? {}),
    },
  });
}


function validateOracleBody(body, { requestedModel = 'auto', allowedModels = ['auto', 'tinyllama', 'gpt-5'] } = {}) {
  return validateProviderResultContract(ORACLE_RESULT_CONTRACT, body, { requestedModel, allowedModels });
}


async function executeWithBody({ access, artifactRoot, ordinal, body, model = 'tinyllama' }) {
  return executeCapabilityGatedProviderOperation({
    policy: reviewedProviderPolicy,
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
  const access = providerAccess();
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-oracle-contract-reject-'));
  const cases = [
    [{}, 'AIOS_PROVIDER_RESULT_SCHEMA_INVALID'],
    [validTinyllamaBody({ response: '' }), 'AIOS_PROVIDER_RESULT_SCHEMA_INVALID'],
    [validTinyllamaBody({ done: false }), 'AIOS_PROVIDER_RESULT_INCOMPLETE'],
    [validTinyllamaBody({ degraded: true }), 'AIOS_PROVIDER_RESULT_DEGRADED'],
    [validTinyllamaBody({ provider_invoked: false }), 'AIOS_PROVIDER_RESULT_DEGRADED'],
    [validTinyllamaBody({ lane: 'emergency_static', origin: 'static_acknowledgement' }), 'AIOS_PROVIDER_RESULT_PROVENANCE_REJECTED'],
    [validTinyllamaBody({ lane: 'local_heuristic', origin: 'schema_repair' }), 'AIOS_PROVIDER_RESULT_PROVENANCE_REJECTED'],
    [validTinyllamaBody({ completion_receipt: null }), 'AIOS_PROVIDER_RESULT_RECEIPT_INVALID'],
    [validTinyllamaBody({ completion_receipt: { response_sha256: '0'.repeat(64) } }), 'AIOS_PROVIDER_RESULT_RECEIPT_INVALID'],
  ];
  try {
    for (let index = 0; index < cases.length; index += 1) {
      const [body, code] = cases[index];
      await assert.rejects(
        executeWithBody({ access, artifactRoot, ordinal: index + 1, body }),
        (error) => error.code === code,
      );
    }
    assert.equal(fs.existsSync(path.join(artifactRoot, 'provider-results')), false);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});


test('Cortex Oracle result contract enforces exact concrete model requests', async () => {
  const access = providerAccess();
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-oracle-contract-model-'));
  try {
    await assert.rejects(
      executeWithBody({
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

test('Cortex Oracle auto selection still enforces the selected-model allowlist without granting transport authority', () => {
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-oracle-contract-auto-model-'));
  try {
    assert.throws(
      () => validateOracleBody(
        validOracleBody({ model: 'unallowlisted-frontier-model' }),
        { requestedModel: 'auto', allowedModels: ['auto', 'tinyllama'] },
      ),
      (error) => error.code === 'AIOS_PROVIDER_RESULT_MODEL_MISMATCH',
    );
    assert.throws(
      () => validateOracleBody(
        validOracleBody({ model: 'auto' }),
        { requestedModel: 'auto', allowedModels: ['auto', 'tinyllama'] },
      ),
      (error) => error.code === 'AIOS_PROVIDER_RESULT_IDENTITY_MISMATCH',
    );
    assert.equal(fs.existsSync(path.join(artifactRoot, 'provider-results')), false);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});


test('dynamic Oracle identity validates without authority, reviewed transport persists identity, and generic contracts remain opt-in', async () => {
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-oracle-contract-valid-'));
  try {
    const dynamicCompletion = validateOracleBody(validOracleBody(), {
      requestedModel: 'auto',
      allowedModels: ['auto', 'tinyllama', 'gpt-5'],
    });
    assert.deepEqual(dynamicCompletion, {
      provider: 'openrouter',
      model: 'gpt-5',
      lane: 'gated_direct',
      origin: 'openclaw_subprocess',
      receiptId: 'oracle_verified_receipt',
      identitySource: 'openclaw_agent_meta',
      responseSha256: sha256('verified provider answer'),
    });
    assert.equal(fs.existsSync(path.join(artifactRoot, 'provider-results')), false);

    const access = providerAccess();
    const verified = await executeWithBody({
      access,
      artifactRoot,
      ordinal: 1,
      body: validTinyllamaBody(),
    });
    assert.equal(verified.resultContract, ORACLE_RESULT_CONTRACT);
    assert.equal(verified.selectedProvider, 'ollama');
    assert.equal(verified.selectedModel, 'tinyllama');
    assert.equal(verified.selectedLane, 'requested_tinyllama');
    const artifact = JSON.parse(fs.readFileSync(verified.resultPath, 'utf8'));
    assert.deepEqual(artifact.response.verifiedCompletion, {
      provider: 'ollama',
      model: 'tinyllama',
      lane: 'requested_tinyllama',
      origin: 'ollama_provider',
      receiptId: 'oracle_verified_receipt',
      identitySource: 'ollama_response',
      responseSha256: sha256('verified provider answer'),
    });

    const genericResultContract = null;
    const genericCompletion = validateProviderResultContract(
      genericResultContract,
      { answer: 'generic provider result' },
    );
    assert.equal(genericResultContract, null);
    assert.equal(genericCompletion?.model ?? null, null);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('production-shaped tinyllama policy accepts only a receipt-bound tinyllama completion', async () => {
  const access = providerAccess();
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-oracle-contract-tinyllama-'));
  try {
    const result = await executeWithBody({
      access,
      artifactRoot,
      ordinal: 1,
      body: validTinyllamaBody(),
      model: 'tinyllama',
    });
    assert.equal(result.selectedProvider, 'ollama');
    assert.equal(result.selectedModel, 'tinyllama');
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});
