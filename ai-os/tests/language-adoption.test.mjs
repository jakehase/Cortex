import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  AIOS_CANONICAL_COMPILER,
  AIOS_CANONICAL_LANGUAGE_VERSION,
  assertCanonicalAiosReady,
  compileCanonicalAiosSource,
} from '../packages/aios-language/canonical.mjs';
import * as packageFacade from '../packages/aios-language/index.mjs';
import {
  buildProviderAccessContract,
  executeCapabilityGatedProviderOperation,
  normalizeProviderPolicy,
} from '../packages/aios-language/runtime/provider-read-compute.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.dirname(root);
const source = `job adapterStatus {
  capability aios.status: read @internal;
  memory adapterArtifacts: persistent;
  step inspect uses kernel.artifact.status() reads [adapterArtifacts] -> status recover halt;
  verify status exists;
  truth adapterState: source="artifact-root", confidence="observed";
  rollback retain_artifacts;
}`;

const providerSource = `job providerAssist {
  capability provider.local.read: read @external;
  capability provider.local.compute: compute @external;
  memory providerArtifacts: persistent;
  step recall uses provider.read(provider: "local", query: "bounded context", n_results: 2) writes [providerArtifacts] -> recallReceipt recover halt;
  step summarize uses provider.compute(provider: "local", prompt: "summarize", model: "test-model") writes [providerArtifacts] -> computeReceipt recover halt;
  verify provider artifacts exist;
  truth providerState: source="provider-result-artifacts", confidence="observed";
  rollback retain_artifacts;
}`;

function localProviderPolicy(endpoint) {
  return {
    schemaVersion: 'aios.provider-read-compute-policy.v1',
    enabled: true,
    mode: 'capability-gated-read-compute',
    outputBoundary: 'internal-artifact-only',
    externalWrites: false,
    providers: {
      local: {
        enabled: true,
        transport: 'http-json',
        baseUrl: endpoint,
        allowLoopbackHttp: true,
        timeoutMs: 5000,
        maxRequestBytes: 65536,
        maxResponseBytes: 65536,
        operations: {
          read: { enabled: true, path: '/read', method: 'POST', capability: 'provider.local.read' },
          compute: { enabled: true, path: '/compute', method: 'POST', capability: 'provider.local.compute', allowedModels: ['test-model'], allowedResponseModes: ['default'] },
        },
      },
    },
  };
}

function runNode(args, { cwd = root, expect = 0 } = {}) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  const text = (result.stdout || result.stderr).trim();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  assert.equal(result.status, expect, JSON.stringify({ args, status: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2));
  return parsed;
}

test('canonical compiler emits one runtime-compatible internal job', () => {
  const result = compileCanonicalAiosSource(source, { sourceName: 'adapter-status.aios', tenantId: 'test', workspaceId: 'test' });
  assert.equal(result.ok, true);
  assert.equal(result.protocol, AIOS_CANONICAL_COMPILER);
  assert.equal(result.language.version, AIOS_CANONICAL_LANGUAGE_VERSION);
  assert.equal(result.boundary.externalWrites, false);
  assert.equal(result.boundary.runtimeReplacement, false);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].syscalls[0].op, 'kernel.artifact.status');
  assert.deepEqual(result.jobs[0].verifierContracts, ['status exists']);
  assert.equal(result.jobs[0].truthBoundary.claims[0].name, 'adapterState');
  assert.equal(result.jobs[0].recovery.strategy, 'retain_artifacts');
  assert.equal(assertCanonicalAiosReady().ok, true);
});

test('package facade exports the canonical compiler as the adoption entrypoint', () => {
  assert.equal(packageFacade.compileCanonicalAiosSource, compileCanonicalAiosSource);
  assert.equal(packageFacade.AIOS_CANONICAL_LANGUAGE_VERSION, AIOS_CANONICAL_LANGUAGE_VERSION);
});

test('canonical compiler fails closed for external effects', () => {
  const external = `job blocked {
    capability email.send: write @external;
    step send uses remote.email(message="hi") -> receipt recover halt;
    verify receipt exists;
    truth delivery: source="provider", confidence="observed";
    rollback halt;
  }`;
  const result = compileCanonicalAiosSource(external, { sourceName: 'blocked.aios' });
  assert.equal(result.ok, false);
  assert.equal(result.jobs.length, 0);
  assert.ok(result.diagnostics.some((entry) => entry.code === 'AIOS_CANONICAL_EXTERNAL_EFFECT_BLOCKED'));
  assert.ok(result.diagnostics.some((entry) => entry.code === 'AIOS_CANONICAL_RUNTIME_ADAPTER_BLOCKED'));
});

test('canonical compiler permits only policy-backed provider read and compute grants', () => {
  const policy = localProviderPolicy('http://127.0.0.1:43210');
  const result = compileCanonicalAiosSource(providerSource, {
    sourceName: 'provider.aios',
    providerPolicy: policy,
  });
  assert.equal(result.ok, true);
  assert.equal(result.boundary.externalWrites, false);
  assert.equal(result.boundary.outputBoundary, 'internal-artifact-only');
  assert.deepEqual(result.jobs[0].syscalls.map((entry) => entry.op), ['provider.read', 'provider.compute']);
  assert.deepEqual(result.jobs[0].providerAccess.grants.map((entry) => entry.capability), [
    'provider.local.read',
    'provider.local.compute',
  ]);
});

test('provider write, missing grants, invalid boundaries, and unallowlisted providers fail closed', () => {
  const policy = localProviderPolicy('http://127.0.0.1:43210');
  const writeSource = `job blockedWrite {
    capability provider.local.write: write @external;
    step publish uses provider.write(provider: "local", body: "no") -> receipt recover halt;
    verify receipt exists;
    truth writeState: source="provider", confidence="observed";
    rollback halt;
  }`;
  const writeResult = compileCanonicalAiosSource(writeSource, { sourceName: 'write.aios', providerPolicy: policy });
  assert.equal(writeResult.ok, false);
  assert.ok(writeResult.diagnostics.some((entry) => entry.code === 'AIOS_CANONICAL_EXTERNAL_EFFECT_BLOCKED'));

  const missingGrant = providerSource.replace('  capability provider.local.read: read @external;\n', '');
  const missingResult = compileCanonicalAiosSource(missingGrant, { sourceName: 'missing.aios', providerPolicy: policy });
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.diagnostics.some((entry) => entry.code === 'AIOS_CANONICAL_PROVIDER_GRANT_REQUIRED'));

  const invalidBoundary = providerSource.replace('provider.local.read: read @external', 'provider.local.read: read @internal');
  const boundaryResult = compileCanonicalAiosSource(invalidBoundary, { sourceName: 'boundary.aios', providerPolicy: policy });
  assert.equal(boundaryResult.ok, false);
  assert.ok(boundaryResult.diagnostics.some((entry) => entry.code === 'AIOS_PROVIDER_CAPABILITY_BOUNDARY_INVALID'));

  const unknownProvider = providerSource.replaceAll('provider.local.', 'provider.unknown.').replaceAll('provider: "local"', 'provider: "unknown"');
  const unknownResult = compileCanonicalAiosSource(unknownProvider, { sourceName: 'unknown.aios', providerPolicy: policy });
  assert.equal(unknownResult.ok, false);
  assert.ok(unknownResult.diagnostics.some((entry) => entry.code === 'AIOS_PROVIDER_NOT_ALLOWED'));
});

test('provider policy itself cannot enable external writes or non-POST transport', () => {
  assert.throws(
    () => normalizeProviderPolicy({ ...localProviderPolicy('http://127.0.0.1:43210'), externalWrites: true }),
    (error) => error.code === 'AIOS_PROVIDER_EXTERNAL_WRITES_FORBIDDEN',
  );
  const getPolicy = localProviderPolicy('http://127.0.0.1:43210');
  getPolicy.providers.local.operations.read.method = 'GET';
  assert.throws(
    () => normalizeProviderPolicy(getPolicy),
    (error) => error.code === 'AIOS_PROVIDER_TRANSPORT_NOT_ALLOWED',
  );
});

test('deterministic provider read and compute execute through capability grants into internal artifacts only', async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ url: request.url, method: request.method, body: JSON.parse(body) });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(request.url === '/read'
        ? { results: [{ text: 'grounded' }] }
        : { answer: 'computed' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-provider-runtime-'));
  try {
    const policy = normalizeProviderPolicy(localProviderPolicy(`http://127.0.0.1:${port}`));
    const capabilities = [
      { name: 'provider.local.read', scope: 'read', boundary: 'external' },
      { name: 'provider.local.compute', scope: 'compute', boundary: 'external' },
    ];
    const access = buildProviderAccessContract({
      policy,
      capabilities,
      syscalls: [{ op: 'provider.read', args: { provider: 'local' } }, { op: 'provider.compute', args: { provider: 'local' } }],
    });
    assert.equal(access.ok, true);
    const read = await executeCapabilityGatedProviderOperation({
      policy,
      access,
      op: 'provider.read',
      args: { provider: 'local', query: 'bounded context', n_results: 2 },
      artifactRoot,
      processId: 'test-process',
      ordinal: 1,
    });
    const compute = await executeCapabilityGatedProviderOperation({
      policy,
      access,
      op: 'provider.compute',
      args: { provider: 'local', prompt: 'summarize', model: 'test-model' },
      artifactRoot,
      processId: 'test-process',
      ordinal: 2,
    });
    await assert.rejects(
      executeCapabilityGatedProviderOperation({
        policy,
        access,
        op: 'provider.compute',
        args: { provider: 'local', prompt: 'summarize', model: 'unlisted-model' },
        artifactRoot,
        processId: 'test-process',
        ordinal: 3,
      }),
      (error) => error.code === 'AIOS_PROVIDER_MODEL_NOT_ALLOWED',
    );
    await assert.rejects(
      executeCapabilityGatedProviderOperation({
        policy,
        access,
        op: 'provider.read',
        args: { provider: 'local', query: 'bounded context', url: 'https://not-allowed.example' },
        artifactRoot,
        processId: 'test-process',
        ordinal: 4,
      }),
      (error) => error.code === 'AIOS_PROVIDER_ARGUMENT_NOT_ALLOWED',
    );
    const forgedAccess = {
      ...access,
      grants: access.grants.map((grant) => grant.operation === 'read' ? { ...grant, path: '/other' } : grant),
    };
    await assert.rejects(
      executeCapabilityGatedProviderOperation({
        policy,
        access: forgedAccess,
        op: 'provider.read',
        args: { provider: 'local', query: 'bounded context' },
        artifactRoot,
        processId: 'test-process',
        ordinal: 5,
      }),
      (error) => error.code === 'AIOS_PROVIDER_GRANT_POLICY_MISMATCH',
    );
    for (const output of [read, compute]) {
      assert.equal(output.outputBoundary, 'internal-artifact-only');
      assert.equal(output.externalWrites, false);
      assert.equal(fs.existsSync(output.resultPath), true);
      const artifact = JSON.parse(fs.readFileSync(output.resultPath, 'utf8'));
      assert.equal(artifact.boundary.output, 'internal-artifact-only');
      assert.equal(artifact.boundary.externalWrites, false);
      assert.equal(artifact.response.status, 200);
    }
    assert.deepEqual(requests.map((entry) => [entry.method, entry.url]), [['POST', '/read'], ['POST', '/compute']]);
    assert.equal(requests[0].body.query, 'bounded context');
    assert.equal(requests[1].body.prompt, 'summarize');
  } finally {
    server.close();
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('canonical compiler requires capability, verifier, and truth declarations', () => {
  const incomplete = `job incomplete {
    step inspect uses kernel.artifact.status() -> status recover halt;
  }`;
  const result = compileCanonicalAiosSource(incomplete, { sourceName: 'incomplete.aios' });
  assert.equal(result.ok, false);
  const codes = new Set(result.diagnostics.map((entry) => entry.code));
  assert.ok(codes.has('AIOS_CANONICAL_CAPABILITY_REQUIRED'));
  assert.ok(codes.has('AIOS_CANONICAL_VERIFIER_REQUIRED'));
  assert.ok(codes.has('AIOS_CANONICAL_TRUTH_REQUIRED'));
});

test('CLI compiles canonical source and executes emitted job through the kernel', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-language-cli-'));
  const sourcePath = path.join(temp, 'status.aios');
  const artifactRoot = path.join(temp, 'artifacts');
  fs.writeFileSync(sourcePath, source);
  const compiled = runNode(['apps/aios-cli.mjs', 'compile', sourcePath, '--artifact-root', artifactRoot, '--workspace', 'test']);
  assert.equal(compiled.ok, true);
  assert.equal(compiled.status.state, 'ready');
  assert.equal(compiled.jobPaths.length, 1);
  assert.equal(fs.existsSync(compiled.proofPath), true);
  const boot = runNode(['apps/aios-cli.mjs', 'boot', '--artifact-root', artifactRoot]);
  assert.equal(boot.ok, true);
  const run = runNode(['apps/aios-cli.mjs', 'run', compiled.jobPaths[0], '--artifact-root', artifactRoot]);
  assert.equal(run.ok, true);
  const statusResult = run.syscallResults.find((entry) => entry.op === 'kernel.artifact.status');
  assert.equal(statusResult.ok, true);
  assert.equal(statusResult.output.bootOk, true);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('default OpenClaw adapter auto-compiles .aios source before execution', () => {
  const artifactRoot = fs.mkdtempSync(path.join(root, 'artifacts', 'openclaw-dogfood', 'language-adoption-test-'));
  const sourcePath = path.join(artifactRoot, 'status.aios');
  fs.writeFileSync(sourcePath, source);
  const boot = runNode(['scripts/aios-adapter.mjs', 'boot', '--artifact-root', artifactRoot], { cwd: workspaceRoot });
  assert.equal(boot.ok, true);
  const output = runNode([
    'scripts/aios-adapter.mjs', 'run', sourcePath,
    '--artifact-root', artifactRoot,
  ], { cwd: workspaceRoot });
  assert.equal(output.ok, true);
  assert.equal(output.languageCompilation.status.state, 'ready');
  assert.equal(fs.existsSync(output.languageCompilation.proofPath), true);
  assert.ok(output.syscallResults.some((entry) => entry.op === 'kernel.artifact.status' && entry.ok === true));
  fs.rmSync(artifactRoot, { recursive: true, force: true });
});
