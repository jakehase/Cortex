import crypto from 'node:crypto';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { validateApprovedModelExecutableBinding } from './approved-model-executable.mjs';
import { validateApprovedResearchRuntimeBinding } from './approved-research-runtime.mjs';
import { validateExecutionClosure } from './git-product-source.mjs';

export const DEPLOYMENT_BINDING_SCHEMA = 'cortex.learning_os.deployment_binding.v1';
export const FROZEN_DEPLOYMENT_BINDING_SCHEMA = 'cortex.learning_os.deployment_binding.v2';
export const APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA =
  'cortex.learning_os.deployment_binding.v3';
export const MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA =
  'cortex.learning_os.deployment_binding.v4';

const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const CONTENT_ID = /^[a-z][a-z0-9-]{0,63}$/;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function artifactBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(canonicalJson(value), 'utf8');
}

export function validateDeploymentBinding(binding, { requiredContentIds = [] } = {}) {
  const errors = [];
  const keys = Object.keys(binding || {}).sort();
  const frozen = [
    FROZEN_DEPLOYMENT_BINDING_SCHEMA,
    APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
    MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  ].includes(binding?.schemaVersion);
  const fullApprovedExecutable = binding?.schemaVersion
    === APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA;
  const modelApprovedExecutable = binding?.schemaVersion
    === MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA;
  const approvedExecutable = fullApprovedExecutable || modelApprovedExecutable;
  const expectedKeys = frozen ? [
    ...(approvedExecutable ? ['approvedModelExecutable'] : []),
    ...(fullApprovedExecutable ? ['approvedResearchRuntime'] : []),
    'closureSha256', 'contentDigests', 'executionClosure', 'productTree',
    'runtimeSha256', 'schemaVersion', 'sourceCommit', 'sourceTree',
  ] : [
    'contentDigests', 'schemaVersion', 'sourceCommit', 'sourceTree',
  ];
  if (canonicalJson(keys) !== canonicalJson(expectedKeys)) {
    errors.push('deployment binding fields are incomplete or unknown');
  }
  if (![
    DEPLOYMENT_BINDING_SCHEMA,
    FROZEN_DEPLOYMENT_BINDING_SCHEMA,
    APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
    MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  ]
    .includes(binding?.schemaVersion)) errors.push('invalid deployment binding schemaVersion');
  if (!COMMIT.test(String(binding?.sourceCommit || ''))) errors.push('invalid deployment source commit');
  if (!COMMIT.test(String(binding?.sourceTree || ''))) errors.push('invalid deployment source tree');
  const content = binding?.contentDigests;
  if (!content || typeof content !== 'object' || Array.isArray(content)
      || Object.keys(content).length < 1
      || Object.entries(content).some(([id, digest]) => !CONTENT_ID.test(id) || !DIGEST.test(String(digest)))) {
    errors.push('invalid deployment content digests');
  }
  for (const id of requiredContentIds) {
    if (!DIGEST.test(String(content?.[id] || ''))) errors.push(`deployment binding omits ${id}`);
  }
  if (frozen) {
    const closure = validateExecutionClosure(binding?.executionClosure);
    if (!closure.ok) errors.push(...closure.errors);
    if (!COMMIT.test(String(binding?.productTree || ''))
        || !DIGEST.test(String(binding?.runtimeSha256 || ''))
        || !DIGEST.test(String(binding?.closureSha256 || ''))
        || (approvedExecutable && binding.executionClosure?.immutable !== true)
        || binding.productTree !== binding.executionClosure?.productTree
        || binding.sourceCommit !== binding.executionClosure?.sourceCommit
        || binding.sourceTree !== binding.executionClosure?.sourceTree
        || binding.runtimeSha256 !== binding.executionClosure?.runtimeSha256
        || binding.closureSha256 !== binding.executionClosure?.closureSha256) {
      errors.push('deployment frozen product, runtime, or closure identity substitution or mismatch');
    }
    if (approvedExecutable) {
      const executable = validateApprovedModelExecutableBinding(binding.approvedModelExecutable);
      errors.push(...executable.errors.map((error) => `approved model executable: ${error}`));
      if (fullApprovedExecutable) {
        const researchRuntime = validateApprovedResearchRuntimeBinding(
          binding.approvedResearchRuntime,
          { observe: false },
        );
        errors.push(...researchRuntime.errors.map((error) => `approved research runtime: ${error}`));
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function buildDeploymentBinding({
  sourceCommit,
  sourceTree,
  productTree = null,
  executionClosure = null,
  approvedModelExecutable = null,
  approvedResearchRuntime = null,
  artifacts,
} = {}) {
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw new Error('deployment artifacts must be a named object');
  }
  if (approvedModelExecutable === null && approvedResearchRuntime !== null) {
    throw new Error('approved research runtime requires an approved model executable');
  }
  const contentDigests = Object.fromEntries(Object.entries(artifacts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, value]) => {
      if (!CONTENT_ID.test(id)) throw new Error(`invalid deployment content id: ${id}`);
      return [id, sha256(artifactBytes(value))];
    }));
  const binding = {
    schemaVersion: executionClosure === null
      ? DEPLOYMENT_BINDING_SCHEMA
      : approvedModelExecutable === null
        ? FROZEN_DEPLOYMENT_BINDING_SCHEMA
        : approvedResearchRuntime === null
          ? MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA
          : APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
    sourceCommit,
    sourceTree,
    ...(executionClosure === null ? {} : {
      productTree,
      runtimeSha256: executionClosure.runtimeSha256,
      closureSha256: executionClosure.closureSha256,
      executionClosure,
      ...(approvedModelExecutable === null ? {} : {
        approvedModelExecutable: structuredClone(approvedModelExecutable),
        ...(approvedResearchRuntime === null ? {} : {
          approvedResearchRuntime: structuredClone(approvedResearchRuntime),
        }),
      }),
    }),
    contentDigests,
  };
  const validation = validateDeploymentBinding(binding);
  if (!validation.ok) throw new Error(`invalid deployment binding: ${validation.errors.join('; ')}`);
  return binding;
}

export function isFrozenDeploymentBinding(binding) {
  return [
    FROZEN_DEPLOYMENT_BINDING_SCHEMA,
    APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
    MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  ].includes(binding?.schemaVersion);
}

export function isModelExecutableDeploymentBinding(binding) {
  return [
    APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
    MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  ].includes(binding?.schemaVersion);
}

export function bindApprovedModelExecutable(
  deployment,
  approvedModelExecutable,
  approvedResearchRuntime = null,
) {
  const validation = validateDeploymentBinding(deployment);
  if (!validation.ok || !isFrozenDeploymentBinding(deployment)) {
    throw new Error(`cannot bind an executable to an invalid frozen deployment: ${validation.errors.join('; ')}`);
  }
  if (deployment.executionClosure?.immutable !== true) {
    throw new Error('cannot bind approved runtimes to a mutable execution closure');
  }
  const executable = validateApprovedModelExecutableBinding(approvedModelExecutable);
  const researchRuntime = approvedResearchRuntime === null
    ? { ok: true, errors: [] }
    : validateApprovedResearchRuntimeBinding(
      approvedResearchRuntime,
      { observe: false },
    );
  if (!executable.ok) {
    throw new Error(`cannot bind an invalid approved model executable: ${executable.errors.join('; ')}`);
  }
  if (!researchRuntime.ok) {
    throw new Error(`cannot bind an invalid approved research runtime: ${researchRuntime.errors.join('; ')}`);
  }
  const binding = {
    ...sourceDeploymentBinding(deployment),
    schemaVersion: approvedResearchRuntime === null
      ? MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA
      : APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
    approvedModelExecutable: structuredClone(approvedModelExecutable),
    ...(approvedResearchRuntime === null ? {} : {
      approvedResearchRuntime: structuredClone(approvedResearchRuntime),
    }),
  };
  const bound = validateDeploymentBinding(binding);
  if (!bound.ok) throw new Error(`invalid executable-bound deployment: ${bound.errors.join('; ')}`);
  return binding;
}

export function sourceDeploymentBinding(deployment) {
  const validation = validateDeploymentBinding(deployment);
  if (!validation.ok) throw new Error(`invalid deployment binding: ${validation.errors.join('; ')}`);
  if (!isModelExecutableDeploymentBinding(deployment)) {
    return structuredClone(deployment);
  }
  const {
    approvedModelExecutable: _approvedModelExecutable,
    approvedResearchRuntime: _approvedResearchRuntime,
    ...sourceDeployment
  } = deployment;
  sourceDeployment.schemaVersion = FROZEN_DEPLOYMENT_BINDING_SCHEMA;
  const sourceValidation = validateDeploymentBinding(sourceDeployment);
  if (!sourceValidation.ok) {
    throw new Error(`invalid source deployment projection: ${sourceValidation.errors.join('; ')}`);
  }
  return sourceDeployment;
}

export function assertModelQualificationDeployment(deployment, committedSourceDeployment) {
  const validation = validateDeploymentBinding(deployment);
  const sourceValidation = validateDeploymentBinding(committedSourceDeployment);
  const executableValidation = validateApprovedModelExecutableBinding(
    deployment?.approvedModelExecutable,
  );
  if (!validation.ok
      || deployment?.schemaVersion !== MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA
      || !sourceValidation.ok
      || committedSourceDeployment?.schemaVersion !== FROZEN_DEPLOYMENT_BINDING_SCHEMA
      || canonicalJson(sourceDeploymentBinding(deployment))
        !== canonicalJson(committedSourceDeployment)
      || !executableValidation.ok) {
    throw new Error([
      'model qualification deployment is not the exact executable-bound projection of committed source',
      ...validation.errors,
      ...sourceValidation.errors,
      ...executableValidation.errors,
    ].join('; '));
  }
  return deployment;
}

export function assertQualificationDeployment(deployment, committedSourceDeployment) {
  const validation = validateDeploymentBinding(deployment);
  const sourceValidation = validateDeploymentBinding(committedSourceDeployment);
  const executableValidation = validateApprovedModelExecutableBinding(
    deployment?.approvedModelExecutable,
  );
  const researchRuntimeValidation = validateApprovedResearchRuntimeBinding(
    deployment?.approvedResearchRuntime,
    { observe: false },
  );
  if (!validation.ok
      || deployment?.schemaVersion !== APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA
      || !sourceValidation.ok
      || committedSourceDeployment?.schemaVersion !== FROZEN_DEPLOYMENT_BINDING_SCHEMA
      || canonicalJson(sourceDeploymentBinding(deployment))
        !== canonicalJson(committedSourceDeployment)
      || !executableValidation.ok
      || !researchRuntimeValidation.ok) {
    throw new Error([
      'qualification deployment is not the exact executable-bound projection of committed source',
      ...validation.errors,
      ...sourceValidation.errors,
      ...executableValidation.errors,
      ...researchRuntimeValidation.errors,
    ].join('; '));
  }
  return deployment;
}

export function deploymentBindingDigest(binding) {
  const validation = validateDeploymentBinding(binding);
  if (!validation.ok) throw new Error(`invalid deployment binding: ${validation.errors.join('; ')}`);
  return sha256(Buffer.from(canonicalJson(binding), 'utf8'));
}

export function assertDeploymentBinding(binding, expected, options = {}) {
  const validation = validateDeploymentBinding(binding, options);
  if (!validation.ok) throw new Error(`invalid deployment binding: ${validation.errors.join('; ')}`);
  const expectedValidation = validateDeploymentBinding(expected, options);
  if (!expectedValidation.ok) throw new Error(`invalid expected deployment binding: ${expectedValidation.errors.join('; ')}`);
  if (canonicalJson(binding) !== canonicalJson(expected)) {
    throw new Error('deployment commit, tree, or content digest substitution');
  }
  return true;
}
