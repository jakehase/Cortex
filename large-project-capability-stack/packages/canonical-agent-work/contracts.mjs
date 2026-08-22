import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_WORK_V1_CONTRACT_BUNDLE_SCHEMA = 'clawd.agent_work.contract_bundle.v1';

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const AGENT_WORK_V1_SCHEMA_FILES = Object.freeze({
  objectiveContract: 'objective-contract.schema.json',
  budgetContract: 'budget-contract.schema.json',
  permissionContract: 'permission-contract.schema.json',
  runManifest: 'run-manifest.schema.json',
  event: 'event.schema.json',
  task: 'task.schema.json',
  lease: 'lease.schema.json',
  workerCall: 'worker-call.schema.json',
  verifierResult: 'verifier-result.schema.json',
  stateTruth: 'state-truth.schema.json',
  blocker: 'blocker.schema.json',
  completionPacket: 'completion-packet.schema.json'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value))
    .filter(Boolean))];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function normalizeId(value, fallback = 'agent_work') {
  return clean(value || fallback)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

function numberFrom(source = {}, keys = []) {
  for (const key of keys) {
    const value = source?.[key];
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

export function loadAgentWorkV1Schemas() {
  return Object.fromEntries(Object.entries(AGENT_WORK_V1_SCHEMA_FILES).map(([kind, file]) => {
    const schemaPath = path.join(PACKAGE_DIR, 'schemas', file);
    return [kind, JSON.parse(fs.readFileSync(schemaPath, 'utf8'))];
  }));
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validateNode(value, schema, pointer, errors) {
  if (!schema || typeof schema !== 'object') return;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => typeMatches(value, type))) {
    errors.push({ path: pointer, code: 'type', message: `expected ${types.join('|')}` });
    return;
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push({ path: pointer, code: 'const', message: `must equal ${JSON.stringify(schema.const)}` });
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
    errors.push({ path: pointer, code: 'enum', message: `must be one of ${schema.enum.join(', ')}` });
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push({ path: pointer, code: 'minLength', message: `must contain at least ${schema.minLength} characters` });
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push({ path: pointer, code: 'pattern', message: `must match ${schema.pattern}` });
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) errors.push({ path: pointer, code: 'format', message: 'must be an ISO date-time' });
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push({ path: pointer, code: 'minimum', message: `must be >= ${schema.minimum}` });
    if (schema.maximum != null && value > schema.maximum) errors.push({ path: pointer, code: 'maximum', message: `must be <= ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push({ path: pointer, code: 'minItems', message: `must contain at least ${schema.minItems} items` });
    if (schema.uniqueItems) {
      const serialized = value.map((entry) => JSON.stringify(stableValue(entry)));
      if (new Set(serialized).size !== serialized.length) errors.push({ path: pointer, code: 'uniqueItems', message: 'must not contain duplicate items' });
    }
    if (schema.items) value.forEach((entry, index) => validateNode(entry, schema.items, `${pointer}/${index}`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!(required in value)) errors.push({ path: `${pointer}/${required}`, code: 'required', message: 'is required' });
    }
    const properties = schema.properties || {};
    for (const [key, entry] of Object.entries(value)) {
      if (properties[key]) validateNode(entry, properties[key], `${pointer}/${key}`, errors);
      else if (schema.additionalProperties === false) errors.push({ path: `${pointer}/${key}`, code: 'additionalProperties', message: 'unknown critical field' });
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateNode(entry, schema.additionalProperties, `${pointer}/${key}`, errors);
    }
  }
}

export function validateAgentWorkV1Contract(kind, value, { schemas = loadAgentWorkV1Schemas() } = {}) {
  const schema = schemas[kind];
  if (!schema) throw new Error(`unknown Agent Work v1 contract kind: ${kind}`);
  const errors = [];
  validateNode(value, schema, '$', errors);
  return { ok: errors.length === 0, kind, schemaId: schema.$id, errors };
}

function taskFromSurface({ surface, runId, objectiveId, generatedAt }) {
  const metadata = surface.metadata || {};
  const id = normalizeId(surface.id || surface.surfaceId || surface.label, 'task');
  return {
    schemaVersion: 'clawd.agent_work.task.v1',
    taskId: id,
    runId,
    objectiveId,
    surfaceIds: stableList([surface.id || id]),
    goal: clean(surface.productGoal || surface.goal || surface.label || `Complete ${id}`),
    allowedFiles: stableList(surface.allowedFiles || surface.files || surface.productFiles),
    requiredVerifiers: stableList(surface.verification || surface.verify || surface.verifiers),
    dependencies: stableList(surface.deps || metadata.deps),
    state: 'proposed',
    stateVersion: 1,
    idempotencyKey: `${runId}:${id}:task:1`,
    generatedAt,
    source: { schemaVersion: surface.schemaVersion || null, metadata: clone(metadata) }
  };
}

export function upgradeAgentWorkV0ToV1({ handoff = {}, runContract = {}, canonicalManifest = null } = {}) {
  const scope = runContract.scope || {};
  const language = scope.agentWorkLanguage || {};
  const generatedAt = clean(runContract.generatedAt || handoff.generatedAt || canonicalManifest?.generatedAt) || new Date().toISOString();
  const runId = clean(runContract.runId || handoff.runId || canonicalManifest?.runId) || normalizeId(runContract.benchmarkId || handoff.benchmarkId, 'agent_work_run');
  const objectiveId = normalizeId(language.goalId || handoff.goalId || runContract.benchmarkId || handoff.objective, 'agent_work_objective');
  const permissions = scope.permissionPolicy || handoff.permissions || {};
  const allow = stableList(permissions.allow);
  const forbid = stableList(permissions.forbid);
  const externalWritesAllowed = allow.includes('external_send') && !forbid.includes('external_send');
  const surfaces = Array.isArray(scope.surfaces) && scope.surfaces.length ? scope.surfaces : handoff.surfaces || [];
  const objectiveContract = {
    schemaVersion: 'clawd.agent_work.objective_contract.v1',
    objectiveId,
    objective: clean(handoff.objective || language.outcome),
    anchor: clean(handoff.replyAnchor || runContract.replyAnchor || handoff.objective || language.outcome),
    replyAnchor: clean(handoff.replyAnchor || runContract.replyAnchor) || null,
    targetPath: clean(runContract.repoPath || handoff.repoPath),
    fidelity: clean(runContract.fidelity || handoff.fidelity || 'production_slice'),
    scope: stableList(surfaces.map((surface) => surface.id || surface.surfaceId)),
    implementationSurface: clean(handoff.implementationSurface || handoff.implementation_surface || 'product_code'),
    stopCondition: clean(runContract.stopCondition || scope.stopCondition || handoff.stopCondition),
    doneWhen: stableList(scope.doneWhen || handoff.doneWhen),
    requestedClaims: stableList(handoff.requestedClaims || runContract.requestedClaims),
    generatedAt,
    source: {
      handoffSchemaVersion: handoff.schemaVersion || null,
      runContractSchemaVersion: runContract.schemaVersion || null,
      compatibilityMode: 'v0_to_v1'
    }
  };
  const permissionContract = {
    schemaVersion: 'clawd.agent_work.permission_contract.v1',
    runId,
    allow,
    forbid,
    externalWritesAllowed,
    defaultDenyExternalWrites: true,
    generatedAt,
    source: { compatibilityMode: 'v0_to_v1' }
  };
  const rawBudgets = scope.budgets || handoff.budgets || {};
  const budgetContract = {
    schemaVersion: 'clawd.agent_work.budget_contract.v1',
    runId,
    hard: true,
    limits: {
      tokenCap: numberFrom(rawBudgets, ['tokenCap', 'token_cap', 'tokens']),
      monetaryCapUsd: numberFrom(rawBudgets, ['monetaryCapUsd', 'monetary_cap_usd', 'cost_cap_usd']),
      durationMinutes: numberFrom(rawBudgets, ['durationMinutes', 'duration_minutes']) ?? numberFrom(scope, ['durationTargetMinutes']),
      workerSpawns: numberFrom(rawBudgets, ['workerSpawns', 'worker_spawns', 'max_workers']),
      retries: numberFrom(rawBudgets, ['retries', 'retry_cap', 'max_retries']),
      concurrency: numberFrom(rawBudgets, ['concurrency', 'max_concurrency']) ?? Number(runContract.requestedAgentCount || 1),
      providerCalls: numberFrom(rawBudgets, ['providerCalls', 'provider_calls', 'global_calls'])
    },
    generatedAt,
    source: { compatibilityMode: 'v0_to_v1', raw: clone(rawBudgets) }
  };
  const planDigest = digest({ objectiveContract, permissionContract, budgetContract, surfaces });
  const runManifest = {
    schemaVersion: 'clawd.agent_work.run_manifest.v1',
    runId,
    objectiveId,
    planDigest,
    sourceContractSchema: clean(runContract.schemaVersion || 'claw.agent_benchmark_run_contract.v1'),
    executionBoundary: clean(runContract.executionBoundary || handoff.executionBoundary || 'control_plane_allowed'),
    state: 'compiled',
    stateVersion: 1,
    idempotencyKey: `${runId}:manifest:${planDigest}`,
    artifactRoot: clean(runContract.artifactRoot || handoff.artifactRoot || canonicalManifest?.artifactRoot),
    controller: clean(canonicalManifest?.controller || 'apps/system-benchmark/run-agent-work-objective-controller.mjs'),
    generatedAt
  };
  const taskContracts = surfaces.map((surface) => taskFromSurface({ surface, runId, objectiveId, generatedAt }));
  const bundle = {
    schemaVersion: AGENT_WORK_V1_CONTRACT_BUNDLE_SCHEMA,
    objectiveContract,
    permissionContract,
    budgetContract,
    runManifest,
    taskContracts
  };
  return { ...bundle, validation: validateAgentWorkV1Bundle(bundle) };
}

export function validateAgentWorkV1Bundle(bundle = {}, options = {}) {
  const results = [
    validateAgentWorkV1Contract('objectiveContract', bundle.objectiveContract, options),
    validateAgentWorkV1Contract('permissionContract', bundle.permissionContract, options),
    validateAgentWorkV1Contract('budgetContract', bundle.budgetContract, options),
    validateAgentWorkV1Contract('runManifest', bundle.runManifest, options),
    ...(bundle.taskContracts || []).map((task) => validateAgentWorkV1Contract('task', task, options))
  ];
  const errors = results.flatMap((result) => result.errors.map((error) => ({ kind: result.kind, ...error })));
  const runIds = new Set([bundle.permissionContract?.runId, bundle.budgetContract?.runId, bundle.runManifest?.runId, ...(bundle.taskContracts || []).map((task) => task.runId)].filter(Boolean));
  if (runIds.size > 1) errors.push({ kind: 'bundle', path: '$/runId', code: 'crossContract', message: 'all contracts must use one runId' });
  const objectiveIds = new Set([bundle.objectiveContract?.objectiveId, bundle.runManifest?.objectiveId, ...(bundle.taskContracts || []).map((task) => task.objectiveId)].filter(Boolean));
  if (objectiveIds.size > 1) errors.push({ kind: 'bundle', path: '$/objectiveId', code: 'crossContract', message: 'all contracts must use one objectiveId' });
  if (bundle.permissionContract?.externalWritesAllowed === true && !bundle.permissionContract?.allow?.includes('external_send')) {
    errors.push({ kind: 'permissionContract', path: '$/externalWritesAllowed', code: 'crossContract', message: 'external writes require explicit external_send allow capability' });
  }
  const forbidden = new Set(bundle.permissionContract?.forbid || []);
  const permissionOverlap = (bundle.permissionContract?.allow || []).filter((capability) => forbidden.has(capability));
  if (permissionOverlap.length) {
    errors.push({ kind: 'permissionContract', path: '$/allow', code: 'crossContract', message: `capabilities cannot be both allowed and forbidden: ${permissionOverlap.join(', ')}` });
  }
  return { ok: errors.length === 0, results, errors };
}

export function writeAgentWorkV1Contracts({ bundle, outputDir } = {}) {
  if (!outputDir) throw new Error('outputDir is required');
  const validation = validateAgentWorkV1Bundle(bundle);
  if (!validation.ok) throw new Error(`Invalid Agent Work v1 bundle: ${validation.errors.map((error) => `${error.kind}${error.path}: ${error.message}`).join('; ')}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const files = {
    objectiveContractPath: path.join(outputDir, 'objective_contract.json'),
    permissionContractPath: path.join(outputDir, 'permission_contract.json'),
    budgetContractPath: path.join(outputDir, 'budget_contract.json'),
    runManifestPath: path.join(outputDir, 'run_manifest.json'),
    taskContractsPath: path.join(outputDir, 'task_contracts.json'),
    contractBundlePath: path.join(outputDir, 'agent_work_v1_contract_bundle.json')
  };
  fs.writeFileSync(files.objectiveContractPath, `${JSON.stringify(bundle.objectiveContract, null, 2)}\n`);
  fs.writeFileSync(files.permissionContractPath, `${JSON.stringify(bundle.permissionContract, null, 2)}\n`);
  fs.writeFileSync(files.budgetContractPath, `${JSON.stringify(bundle.budgetContract, null, 2)}\n`);
  fs.writeFileSync(files.runManifestPath, `${JSON.stringify(bundle.runManifest, null, 2)}\n`);
  fs.writeFileSync(files.taskContractsPath, `${JSON.stringify(bundle.taskContracts, null, 2)}\n`);
  fs.writeFileSync(files.contractBundlePath, `${JSON.stringify({ ...bundle, validation }, null, 2)}\n`);
  return files;
}
