import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateJsonSchema } from '../src/json-schema-validation.mjs';

const CLOS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_ROOT = path.join(CLOS_ROOT, 'schemas');
const cache = new Map();

function document(target) {
  const resolved = path.resolve(target);
  if (!cache.has(resolved)) {
    cache.set(resolved, JSON.parse(fs.readFileSync(resolved, 'utf8')));
  }
  return { path: resolved, schema: cache.get(resolved) };
}

function pointer(schema, fragment) {
  if (!fragment) return schema;
  return fragment.slice(1).split('/').filter(Boolean).reduce((value, token) => (
    value[token.replaceAll('~1', '/').replaceAll('~0', '~')]
  ), schema);
}

function matchingString(schema) {
  if (schema.format === 'date-time') return '2026-07-28T00:00:00.000Z';
  if (schema.contentEncoding === 'base64') {
    const bytes = schema.minLength === 88 && schema.maxLength === 88
      ? Buffer.alloc(64)
      : Buffer.from('x');
    return bytes.toString('base64');
  }
  const pattern = String(schema.pattern || '');
  const candidates = [
    '0'.repeat(64),
    '0'.repeat(40),
    '0'.repeat(32),
    '0'.repeat(16),
    `sha256:${'0'.repeat(64)}`,
    `/opt/cortex-learning-os/approved-model-executors/${'0'.repeat(64)}/codex`,
    `/opt/cortex-learning-os/approved-model-executors/${'0'.repeat(64)}`,
    `/opt/cortex-learning-os/approved-research-runtimes/${'0'.repeat(64)}/runtime`,
    `/opt/cortex-learning-os/approved-research-runtimes/${'0'.repeat(64)}`,
    '/tmp/x',
    'x.service',
    'x.socket',
    '0555',
    'cortex-learning-os/src/x.mjs',
    'a',
  ];
  const expression = pattern ? new RegExp(pattern, 'u') : null;
  let value = candidates.find((candidate) => (
    (!expression || expression.test(candidate))
    && candidate.length >= (schema.minLength || 0)
    && candidate.length <= (schema.maxLength || Number.POSITIVE_INFINITY)
  ));
  if (value === undefined) {
    value = 'a'.repeat(Math.max(1, schema.minLength || 1));
  }
  return value;
}

function example(schema, context) {
  if (schema === true) return {};
  if (schema.$ref) {
    const [relative, fragment = ''] = schema.$ref.split('#', 2);
    const target = relative === ''
      ? context
      : document(path.resolve(path.dirname(context.path), relative));
    return example(pointer(target.schema, fragment), target);
  }
  if (Array.isArray(schema.allOf)) {
    const { allOf, ...base } = schema;
    const values = [
      example(base, context),
      ...allOf.map((branch) => example(branch, context)),
    ];
    if (values.every((value) => (
      value !== null && typeof value === 'object' && !Array.isArray(value)
    ))) {
      return Object.assign({}, ...values);
    }
    return values[0];
  }
  if (schema.const !== undefined) return structuredClone(schema.const);
  if (Array.isArray(schema.enum)) return structuredClone(schema.enum[0]);
  if (Array.isArray(schema.oneOf)) {
    const branch = context.schema.$id === 'cortex.learning_os.deployment_binding'
      ? schema.oneOf[2]
      : schema.oneOf.find((candidate) => candidate.type !== 'null') || schema.oneOf[0];
    return example(branch, context);
  }
  const declared = Array.isArray(schema.type)
    ? schema.type.find((type) => type !== 'null')
    : schema.type;
  const type = declared || (schema.properties ? 'object' : undefined);
  if (type === 'string') return matchingString(schema);
  if (type === 'integer' || type === 'number') return schema.minimum || 0;
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  if (type === 'array') {
    const count = schema.minItems || 0;
    return Array.from({ length: count }, (_, index) => {
      if (Array.isArray(schema.prefixItems) && index < schema.prefixItems.length) {
        return example(schema.prefixItems[index], context);
      }
      return example(schema.items === undefined ? {} : schema.items, context);
    });
  }
  if (type === 'object') {
    const record = Object.fromEntries((schema.required || []).map((key) => [
      key,
      example(schema.properties?.[key] || {}, context),
    ]));
    while (Object.keys(record).length < (schema.minProperties || 0)) {
      record[`graph${Object.keys(record).length || ''}`] = example(
        typeof schema.additionalProperties === 'object'
          ? schema.additionalProperties
          : {},
        context,
      );
    }
    return record;
  }
  return {};
}

function schemaExample(name) {
  const context = document(path.join(SCHEMA_ROOT, name));
  return example(context.schema, context);
}

test('published proof wire schemas validate production-shaped v3 records exactly', () => {
  for (const name of [
    'proof-task.schema.json',
    'proof-runtime-evidence.schema.json',
    'proof-kernel-evidence.schema.json',
    'proof-replay-receipt.schema.json',
  ]) {
    const record = schemaExample(name);
    const validation = validateJsonSchema(record, path.join(SCHEMA_ROOT, name));
    assert.equal(
      validation.ok,
      true,
      `${name}: ${validation.errors.join('; ')}\n${JSON.stringify(record.deployment || null)}`,
    );
    const injected = { ...structuredClone(record), unapproved: true };
    assert.equal(
      validateJsonSchema(injected, path.join(SCHEMA_ROOT, name)).ok,
      false,
      `${name} must reject an unknown top-level field`,
    );
  }
  const taskWithRootDirectoryEntry = schemaExample('proof-task.schema.json');
  taskWithRootDirectoryEntry.deployment.executionClosure.entries[0].path =
    'cortex-learning-os';
  assert.equal(
    validateJsonSchema(
      taskWithRootDirectoryEntry,
      path.join(SCHEMA_ROOT, 'proof-task.schema.json'),
    ).ok,
    true,
    'a real execution closure contains its product root directory entry',
  );
});

test('production proof runtime and nested replay schemas reject downlevel deployments', () => {
  const legacyDeployment = {
    schemaVersion: 'cortex.learning_os.deployment_binding.v1',
    sourceCommit: '1'.repeat(40),
    sourceTree: '2'.repeat(40),
    contentDigests: { graph: '3'.repeat(64) },
  };
  const runtime = schemaExample('proof-runtime-evidence.schema.json');
  runtime.fixtureOnly = false;
  runtime.attestation.payload.runtimePayload.fixtureOnly = false;
  runtime.attestation.payload.runtimePayload.deployment = legacyDeployment;
  assert.equal(
    validateJsonSchema(
      runtime,
      path.join(SCHEMA_ROOT, 'proof-runtime-evidence.schema.json'),
    ).ok,
    false,
  );

  const task = schemaExample('proof-task.schema.json');
  task.deployment = legacyDeployment;
  assert.equal(
    validateJsonSchema(
      task,
      path.join(SCHEMA_ROOT, 'proof-task.schema.json'),
    ).ok,
    false,
  );

  const kernel = schemaExample('proof-kernel-evidence.schema.json');
  kernel.deployment = legacyDeployment;
  assert.equal(
    validateJsonSchema(
      kernel,
      path.join(SCHEMA_ROOT, 'proof-kernel-evidence.schema.json'),
    ).ok,
    false,
  );

  const receipt = schemaExample('proof-replay-receipt.schema.json');
  receipt.proofRuntime.fixtureOnly = false;
  receipt.proofRuntime.attestation.payload.runtimePayload.fixtureOnly = false;
  receipt.proofRuntime.attestation.payload.runtimePayload.deployment = legacyDeployment;
  assert.equal(
    validateJsonSchema(
      receipt,
      path.join(SCHEMA_ROOT, 'proof-replay-receipt.schema.json'),
    ).ok,
    false,
  );
  const receiptWithDownlevelKernel = schemaExample('proof-replay-receipt.schema.json');
  receiptWithDownlevelKernel.replayEvidence.deployment = legacyDeployment;
  assert.equal(
    validateJsonSchema(
      receiptWithDownlevelKernel,
      path.join(SCHEMA_ROOT, 'proof-replay-receipt.schema.json'),
    ).ok,
    false,
  );
});

test('production proof wire schemas reject unknown v3 deployment fields', () => {
  const cases = [
    [
      'proof-task.schema.json',
      (record) => record.deployment,
    ],
    [
      'proof-runtime-evidence.schema.json',
      (record) => record.attestation.payload.runtimePayload.deployment,
    ],
    [
      'proof-kernel-evidence.schema.json',
      (record) => record.deployment,
    ],
    [
      'proof-replay-receipt.schema.json',
      (record) => record.replayEvidence.deployment,
    ],
  ];
  for (const [name, deployment] of cases) {
    const record = schemaExample(name);
    deployment(record).unapproved = true;
    assert.equal(
      validateJsonSchema(record, path.join(SCHEMA_ROOT, name)).ok,
      false,
      `${name} must reject unknown v3 deployment fields`,
    );
  }
});
