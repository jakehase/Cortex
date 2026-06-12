import fs from 'node:fs';
import path from 'node:path';

export const AGENT_WORK_SPEC_SCHEMA = 'claw.agent_work_spec.v0';
export const AGENT_WORK_COMPILATION_SCHEMA = 'claw.agent_work_compilation.v0';
export const AGENT_WORK_RUN_CONTRACT_SCHEMA = 'claw.agent_benchmark_run_contract.v1';
export const AGENT_WORK_LANGUAGE_VERSION = 'v0.1';
export const FIDELITY_LATTICE = Object.freeze(['prototype', 'production_slice', 'parity_for_scope', 'full_clone']);

const DEFAULT_STOP_CONDITION = 'supervisor_green_or_blocker_report';
const DEFAULT_BENCHMARK_TIER = 'execution_smoke';
const DEFAULT_SCOREBOARD_PATH = 'artifacts/benchmarks/scoreboard.json';
const KNOWN_FORBIDDEN_COMMAND_CAPABILITIES = Object.freeze({
  external_send: [/\bsend(email|grid|mail)\b/i, /\bpost\s+to\s+(slack|discord|twitter|x\.com)\b/i],
  touch_prod: [/\bprod(uction)?[_ -]?(db|database)\b/i, /\bdeploy\s+prod/i],
  relaunch_benchmark: [/launch_live_controller/i, /run-continuous-real-workload-controller/i, /relaunch/i]
});

function nowIso() {
  return new Date().toISOString();
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeId(value, fallback = 'agent_work') {
  const cleaned = clean(value || fallback)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function stableList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((entry) => stableList(entry)).map(clean).filter(Boolean))];
  }
  if (value === undefined || value === null || value === '') return [];
  const text = String(value).trim();
  if (!text) return [];
  const bracket = text.match(/^\[(.*)\]$/s);
  const source = bracket ? bracket[1] : text;
  return [...new Set(source.split(/,|\n/).map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean))];
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nullableNonNegativeNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function booleanOr(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function objectOr(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {}
  }
  return fallback;
}

function arrayOr(value, fallback = []) {
  if (value === undefined || value === null || value === '') return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {}
  }
  return fallback;
}

function policyScalar(value) {
  if (value === undefined || value === null) return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'object') return value;
  const text = String(value).trim();
  if (!text) return '';
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      return JSON.parse(text);
    } catch {}
  }
  const lowered = text.toLowerCase();
  if (['true', 'yes', 'on'].includes(lowered)) return true;
  if (['false', 'no', 'off'].includes(lowered)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text.includes(',')) return stableList(text);
  return text;
}

function nonEmptyObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function normalizePolicyKey(key) {
  return String(key || '').trim().toLowerCase().replace(/[.-]/g, '_');
}

function assignPolicyDirective(target, key, value) {
  const normalized = normalizePolicyKey(key);
  if (!normalized) return;
  if (['trigger', 'triggers', 'when'].includes(normalized)) {
    target.triggers = stableList(value);
  } else if (['until', 'stop_when'].includes(normalized)) {
    target.until = stableList(value);
  } else if (['gate', 'gates', 'require', 'requires'].includes(normalized)) {
    target.gates = [...(target.gates || []), ...stableList(value)];
  } else if (['artifact', 'artifacts'].includes(normalized)) {
    target.artifacts = [...(target.artifacts || []), ...stableList(value)];
  } else {
    target[normalized] = policyScalar(value);
  }
}

function parseInlinePolicy(value) {
  const text = clean(value);
  if (!text) return {};
  const parsedObject = objectOr(text, null);
  if (parsedObject) return parsedObject;
  const directive = parseKeyValue(text);
  if (!directive) return {};
  const out = {};
  assignPolicyDirective(out, directive.key, directive.value);
  return out;
}

function parseEvidenceGate(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      expression: clean(value.expression || value.expr || `${value.metric || value.path || 'metric'} ${value.operator || value.op || '>='} ${value.expected ?? value.value ?? ''}`),
      metric: clean(value.metric || value.path),
      operator: clean(value.operator || value.op),
      expected: value.expected ?? value.value ?? null,
      metadata: value.metadata || {}
    };
  }
  const expression = clean(value);
  const match = expression.match(/^([A-Za-z0-9_.-]+)\s*(>=|<=|==|=|>|<)\s*(.+)$/);
  if (!match) return { expression, metric: '', operator: '', expected: null, metadata: {} };
  return {
    expression,
    metric: match[1],
    operator: match[2] === '=' ? '==' : match[2],
    expected: policyScalar(match[3]),
    metadata: {}
  };
}

function valueAtPath(context, key) {
  const parts = String(key || '').split('.').filter(Boolean);
  let current = context;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) current = current[part];
    else return undefined;
  }
  return current;
}

function renderTemplateValue(value, context) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (token, key) => {
    const resolved = valueAtPath(context, key);
    return resolved === undefined || resolved === null || resolved === '' ? token : String(resolved);
  });
}

function renderTemplateList(values, context) {
  return stableList(values).map((entry) => renderTemplateValue(entry, context));
}

function stripComment(line) {
  const hash = line.indexOf('#');
  return hash >= 0 ? line.slice(0, hash) : line;
}

function parseKeyValue(line) {
  const colon = line.match(/^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/);
  if (colon) return { key: colon[1], value: colon[2] };
  const space = line.match(/^([A-Za-z_][\w.-]*)\s+(.+)$/);
  if (space) return { key: space[1], value: space[2] };
  return null;
}

function assignDirective(target, key, value) {
  const normalized = key.toLowerCase().replace(/[.-]/g, '_');
  if (['goal', 'name', 'id'].includes(normalized)) target.goalId = value;
  else if (['outcome', 'description'].includes(normalized)) target.outcome = value;
  else if (['repo', 'repo_path', 'target_path'].includes(normalized)) target.repoPath = value;
  else if (['fidelity', 'requested_fidelity'].includes(normalized)) target.fidelity = value;
  else if (['agents', 'requested_agents', 'requested_agent_count'].includes(normalized)) target.agents = value;
  else if (['benchmark', 'benchmark_id'].includes(normalized)) target.benchmarkId = value;
  else if (['tier', 'benchmark_tier'].includes(normalized)) target.benchmarkTier = value;
  else if (['run', 'run_id'].includes(normalized)) target.runId = value;
  else if (['artifact_root', 'artifacts'].includes(normalized)) target.artifactRoot = value;
  else if (['scoreboard', 'scoreboard_path'].includes(normalized)) target.scoreboardPath = value;
  else if (['execution_boundary', 'boundary'].includes(normalized)) target.executionBoundary = value;
  else if (['stop', 'stop_condition'].includes(normalized)) target.stopCondition = value;
  else if (['allow', 'permissions_allow'].includes(normalized)) target.permissions.allow = stableList(value);
  else if (['forbid', 'forbidden', 'permissions_forbid'].includes(normalized)) target.permissions.forbid = stableList(value);
  else if (['done', 'done_when'].includes(normalized)) target.doneWhen.push(...stableList(value));
  else if (['action', 'requested_action', 'requested_actions'].includes(normalized)) target.requestedActions.push(...stableList(value));
  else if (['note', 'notes'].includes(normalized)) target.notes = value;
  else if (['reply_anchor'].includes(normalized)) target.replyAnchor = value;
  else target.metadata[normalized] = value;
}

function assignSurfaceDirective(surface, key, value) {
  const normalized = key.toLowerCase().replace(/[.-]/g, '_');
  if (['label', 'name'].includes(normalized)) surface.label = value;
  else if (['goal', 'outcome'].includes(normalized)) surface.goal = value;
  else if (['files', 'file', 'allowed_files', 'allowed'].includes(normalized)) surface.files.push(...stableList(value));
  else if (['verify', 'verification', 'verifier', 'test', 'tests'].includes(normalized)) surface.verify.push(...stableList(value));
  else if (['deps', 'depends_on', 'after'].includes(normalized)) surface.deps.push(...stableList(value));
  else if (['use', 'uses', 'template', 'templates'].includes(normalized)) surface.templateIds.push(...stableList(value));
  else if (['lane', 'domain'].includes(normalized)) surface[normalized] = value;
  else surface.metadata[normalized] = value;
}

function assignEvidenceDirective(schema, key, value) {
  const normalized = normalizePolicyKey(key);
  if (['require', 'requires', 'gate', 'gates'].includes(normalized)) schema.gates.push(...stableList(value));
  else if (['artifact', 'artifacts'].includes(normalized)) schema.artifacts.push(...stableList(value));
  else if (['metric', 'metrics'].includes(normalized)) schema.metrics.push(...stableList(value));
  else schema.metadata[normalized] = policyScalar(value);
}

export function parseAgentWorkSpec(text) {
  const source = String(text || '').trim();
  if (!source) return {};
  if (source.startsWith('{')) return JSON.parse(source);
  const spec = {
    permissions: { allow: [], forbid: [] },
    surfaces: [],
    templates: [],
    budgets: {},
    wavePolicy: {},
    expansionPolicy: {},
    evidenceSchemas: [],
    doneWhen: [],
    requestedActions: [],
    metadata: {}
  };
  let currentBlock = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const withoutComment = stripComment(rawLine);
    if (!withoutComment.trim()) continue;
    const indent = rawLine.match(/^\s*/)?.[0]?.length || 0;
    const line = withoutComment.trim();
    const surfaceMatch = line.match(/^surface\s+(.+?)(?:\s+uses\s+(.+))?$/i);
    if (surfaceMatch && indent === 0) {
      const surface = { id: normalizeId(surfaceMatch[1]), label: surfaceMatch[1].trim(), files: [], verify: [], deps: [], templateIds: stableList(surfaceMatch[2]), metadata: {} };
      spec.surfaces.push(surface);
      currentBlock = { kind: 'surface', target: surface };
      continue;
    }
    const templateMatch = line.match(/^template\s+(.+)$/i);
    if (templateMatch && indent === 0) {
      const template = { id: normalizeId(templateMatch[1]), label: templateMatch[1].trim(), files: [], verify: [], deps: [], templateIds: [], metadata: {} };
      spec.templates.push(template);
      currentBlock = { kind: 'template', target: template };
      continue;
    }
    const evidenceMatch = line.match(/^(?:evidence_schema|evidence)\s+(.+)$/i);
    if (evidenceMatch && indent === 0) {
      const evidence = { id: normalizeId(evidenceMatch[1]), label: evidenceMatch[1].trim(), gates: [], artifacts: [], metrics: [], metadata: {} };
      spec.evidenceSchemas.push(evidence);
      currentBlock = { kind: 'evidence', target: evidence };
      continue;
    }
    const policyMatch = line.match(/^(budget|budgets|wave_policy|wave|expansion_policy|expansion)(?:\s+(.+))?$/i);
    if (policyMatch && indent === 0) {
      const kind = normalizePolicyKey(policyMatch[1]);
      const target = kind.startsWith('budget')
        ? spec.budgets
        : kind.startsWith('wave')
          ? spec.wavePolicy
          : spec.expansionPolicy;
      Object.assign(target, parseInlinePolicy(policyMatch[2]));
      currentBlock = { kind: 'policy', target };
      continue;
    }
    const directive = parseKeyValue(line);
    if (!directive) continue;
    if (currentBlock && indent > 0) {
      if (currentBlock.kind === 'surface' || currentBlock.kind === 'template') assignSurfaceDirective(currentBlock.target, directive.key, directive.value);
      else if (currentBlock.kind === 'evidence') assignEvidenceDirective(currentBlock.target, directive.key, directive.value);
      else assignPolicyDirective(currentBlock.target, directive.key, directive.value);
    }
    else {
      currentBlock = null;
      assignDirective(spec, directive.key, directive.value);
    }
  }
  return spec;
}

function normalizePolicyObject(...values) {
  const out = {};
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'string') Object.assign(out, parseInlinePolicy(value));
    else if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, entry] of Object.entries(value)) assignPolicyDirective(out, key, entry);
    }
  }
  return out;
}

function normalizeEvidenceSchemas(value = []) {
  const rows = Array.isArray(value)
    ? value
    : Object.entries(objectOr(value, {})).map(([id, schema]) => ({ id, ...(schema && typeof schema === 'object' ? schema : { gates: stableList(schema) }) }));
  return rows.map((schema, index) => {
    const gates = [
      ...arrayOr(schema.gates, []),
      ...arrayOr(schema.requires, []),
      ...arrayOr(schema.require, []),
      ...stableList(!Array.isArray(schema.gates) ? schema.gates : []),
      ...stableList(!Array.isArray(schema.requires) ? schema.requires : []),
      ...stableList(!Array.isArray(schema.require) ? schema.require : []),
      ...stableList(schema.gate)
    ].map(parseEvidenceGate).filter((gate) => gate.expression);
    return {
      id: normalizeId(schema.id || schema.name || schema.label || `evidence_${index + 1}`),
      label: clean(schema.label || schema.name || schema.id || `Evidence ${index + 1}`),
      gates,
      artifacts: stableList(schema.artifacts || schema.artifact),
      metrics: stableList(schema.metrics || schema.metric),
      metadata: schema.metadata || {}
    };
  });
}

function normalizeTemplate(template = {}, index = 0) {
  const id = normalizeId(template.id || template.name || template.label || `template_${index + 1}`);
  return {
    id,
    label: clean(template.label || template.name || id),
    goal: clean(template.goal || template.outcome),
    files: stableList(template.files || template.allowedFiles || template.allowed_files || template.fileAreas || template.productFiles || template.product_files),
    verify: stableList(template.verify || template.verification || template.verifiers || template.tests || template.test),
    deps: stableList(template.deps || template.dependsOn || template.depends_on),
    lane: clean(template.lane || ''),
    domain: clean(template.domain || ''),
    metadata: template.metadata || {}
  };
}

function normalizeTemplates(value = []) {
  const rows = Array.isArray(value)
    ? value
    : Object.entries(objectOr(value, {})).map(([id, template]) => ({ id, ...(template && typeof template === 'object' ? template : {}) }));
  return rows.map(normalizeTemplate);
}

function normalizeSurface(surface = {}, index = 0, templateLookup = new Map(), templateErrors = []) {
  const id = normalizeId(surface.id || surface.surfaceId || surface.label || `surface_${index + 1}`);
  const templateIds = stableList(surface.templateIds || surface.template_ids || surface.templates || surface.template || surface.uses || surface.use);
  const templates = [];
  for (const templateId of templateIds) {
    const normalizedTemplateId = normalizeId(templateId);
    const template = templateLookup.get(normalizedTemplateId);
    if (!template) templateErrors.push(`surface ${id} references unknown template ${templateId}`);
    else templates.push(template);
  }
  const mergedMetadata = Object.assign({}, ...templates.map((template) => template.metadata || {}), surface.metadata || {});
  const context = {
    ...mergedMetadata,
    metadata: mergedMetadata,
    id,
    label: clean(surface.label || surface.name || templates.find((template) => template.label)?.label || id),
    goal: clean(surface.goal || surface.productGoal || surface.outcome || templates.find((template) => template.goal)?.goal || `Complete ${id}`),
    lane: clean(surface.lane || templates.find((template) => template.lane)?.lane || 'agent_work'),
    domain: clean(surface.domain || templates.find((template) => template.domain)?.domain || id)
  };
  const files = renderTemplateList([...templates.flatMap((template) => template.files || []), ...stableList(surface.files || surface.allowedFiles || surface.allowed_files || surface.fileAreas || surface.productFiles || surface.product_files)], context);
  const verification = renderTemplateList([...templates.flatMap((template) => template.verify || []), ...stableList(surface.verify || surface.verification || surface.verifiers || surface.tests || surface.test)], context);
  return {
    id,
    label: context.label,
    goal: context.goal,
    allowedFiles: files,
    verification,
    deps: renderTemplateList([...templates.flatMap((template) => template.deps || []), ...stableList(surface.deps || surface.dependsOn || surface.depends_on)], context),
    lane: context.lane,
    domain: context.domain,
    metadata: {
      ...mergedMetadata,
      agentWorkDsl: true,
      templateIds
    }
  };
}

export function normalizeAgentWorkSpec(input = {}, options = {}) {
  const parsed = typeof input === 'string' ? parseAgentWorkSpec(input) : input;
  const generatedAt = clean(parsed.generatedAt || parsed.generated_at || options.generatedAt) || nowIso();
  const goalId = normalizeId(parsed.goalId || parsed.goal || parsed.name || parsed.id || 'agent_work_goal');
  const benchmarkId = normalizeId(parsed.benchmarkId || parsed.benchmark || goalId);
  const runId = clean(parsed.runId || parsed.run_id || options.runId) || `${benchmarkId}-${generatedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const repoPath = clean(parsed.repoPath || parsed.repo || parsed.targetPath || parsed.target_path || options.repoPath);
  const artifactRoot = clean(parsed.artifactRoot || parsed.artifact_root || options.artifactRoot)
    || path.join('artifacts', 'agent-work-dsl', benchmarkId, runId);
  const templates = normalizeTemplates(parsed.templates || parsed.template);
  const templateLookup = new Map(templates.map((template) => [template.id, template]));
  const templateErrors = [];
  const spec = {
    schemaVersion: AGENT_WORK_SPEC_SCHEMA,
    languageVersion: clean(parsed.languageVersion || parsed.language_version || AGENT_WORK_LANGUAGE_VERSION),
    generatedAt,
    goalId,
    outcome: clean(parsed.outcome || parsed.description || parsed.goal || goalId),
    benchmarkId,
    benchmarkTier: clean(parsed.benchmarkTier || parsed.benchmark_tier || parsed.tier || DEFAULT_BENCHMARK_TIER),
    runId,
    repoPath: repoPath ? path.resolve(repoPath) : '',
    artifactRoot,
    scoreboardPath: clean(parsed.scoreboardPath || parsed.scoreboard_path || DEFAULT_SCOREBOARD_PATH),
    fidelity: clean(parsed.fidelity || parsed.requestedFidelity || parsed.requested_fidelity || 'production_slice'),
    requestedAgentCount: numberOr(parsed.agents || parsed.requestedAgents || parsed.requestedAgentCount || parsed.requested_agent_count, 1),
    executionBoundary: clean(parsed.executionBoundary || parsed.execution_boundary || 'control_plane_allowed'),
    stopCondition: clean(parsed.stopCondition || parsed.stop_condition || DEFAULT_STOP_CONDITION),
    permissions: {
      allow: stableList(parsed.permissions?.allow || parsed.allow || parsed.permissions_allow),
      forbid: stableList(parsed.permissions?.forbid || parsed.forbid || parsed.forbidden || parsed.permissions_forbid)
    },
    requestedActions: stableList(parsed.requestedActions || parsed.requested_actions || parsed.action || parsed.actions),
    doneWhen: stableList(parsed.doneWhen || parsed.done_when || parsed.done || parsed.stopWhen || parsed.stop_when),
    budgets: normalizePolicyObject(parsed.budgets || parsed.budget || parsed.resourceBudgets || parsed.resource_budgets),
    wavePolicy: normalizePolicyObject(parsed.wavePolicy || parsed.wave_policy || parsed.wave),
    expansionPolicy: normalizePolicyObject(parsed.expansionPolicy || parsed.expansion_policy || parsed.expansion),
    evidenceSchemas: normalizeEvidenceSchemas(parsed.evidenceSchemas || parsed.evidence_schemas || parsed.evidence || []),
    templates,
    templateErrors,
    surfaces: (parsed.surfaces || []).map((surface, index) => normalizeSurface(surface, index, templateLookup, templateErrors)),
    replyAnchor: clean(parsed.replyAnchor || parsed.reply_anchor || options.replyAnchor),
    notes: clean(parsed.notes || parsed.note || ''),
    metadata: parsed.metadata || {}
  };
  return spec;
}

function commandViolationsForForbiddenCapabilities(spec) {
  const forbidden = new Set(spec.permissions.forbid);
  const commands = spec.surfaces.flatMap((surface) => surface.verification.map((command) => ({ surfaceId: surface.id, command })));
  const violations = [];
  for (const forbiddenCapability of forbidden) {
    for (const pattern of KNOWN_FORBIDDEN_COMMAND_CAPABILITIES[forbiddenCapability] || []) {
      for (const command of commands) {
        if (pattern.test(command.command)) {
          violations.push(`verification for ${command.surfaceId} appears to require forbidden capability ${forbiddenCapability}: ${command.command}`);
        }
      }
    }
  }
  return violations;
}

export function validateAgentWorkSpec(spec = {}) {
  const errors = [];
  if (spec.schemaVersion && spec.schemaVersion !== AGENT_WORK_SPEC_SCHEMA) errors.push(`unsupported schemaVersion ${spec.schemaVersion}`);
  if (!clean(spec.goalId)) errors.push('goalId is required');
  if (!clean(spec.repoPath)) errors.push('repoPath is required');
  if (!FIDELITY_LATTICE.includes(spec.fidelity)) errors.push(`fidelity must be one of ${FIDELITY_LATTICE.join(', ')}`);
  if (!Number.isFinite(Number(spec.requestedAgentCount)) || Number(spec.requestedAgentCount) < 1) errors.push('requestedAgentCount must be >= 1');
  if (!Array.isArray(spec.surfaces) || spec.surfaces.length === 0) errors.push('at least one surface is required');
  for (const templateError of spec.templateErrors || []) errors.push(templateError);
  for (const surface of spec.surfaces || []) {
    if (!clean(surface.id)) errors.push('surface id is required');
    if (!Array.isArray(surface.allowedFiles) || surface.allowedFiles.length === 0) errors.push(`surface ${surface.id || '<unknown>'} needs allowedFiles`);
    if (!Array.isArray(surface.verification) || surface.verification.length === 0) errors.push(`surface ${surface.id || '<unknown>'} needs verification commands`);
    for (const file of surface.allowedFiles || []) {
      if (String(file).includes('{{')) errors.push(`surface ${surface.id || '<unknown>'} has unresolved template token in file path: ${file}`);
    }
    for (const command of surface.verification || []) {
      if (String(command).includes('{{')) errors.push(`surface ${surface.id || '<unknown>'} has unresolved template token in verifier command: ${command}`);
    }
  }
  if (!clean(spec.stopCondition)) errors.push('stopCondition is required');
  for (const [policyName, policy] of [['budgets', spec.budgets], ['wavePolicy', spec.wavePolicy], ['expansionPolicy', spec.expansionPolicy]]) {
    for (const [key, value] of Object.entries(policy || {})) {
      if (typeof value === 'number' && value < 0) errors.push(`${policyName}.${key} must be non-negative`);
    }
  }
  for (const schema of spec.evidenceSchemas || []) {
    if (!clean(schema.id)) errors.push('evidence schema id is required');
    if ((!schema.gates || schema.gates.length === 0) && (!schema.artifacts || schema.artifacts.length === 0)) errors.push(`evidence schema ${schema.id || '<unknown>'} needs at least one gate or artifact`);
  }

  const forbidden = new Set(spec.permissions?.forbid || []);
  const requested = new Set(spec.requestedActions || []);
  for (const action of requested) {
    if (forbidden.has(action)) errors.push(`requested action ${action} is forbidden by permissions`);
  }
  errors.push(...commandViolationsForForbiddenCapabilities(spec));

  if (spec.fidelity === 'full_clone') {
    const done = new Set(spec.doneWhen || []);
    const hasParityGate = done.has('parity_matrix_all_complete') || done.has('full_clone_parity_evidence') || spec.metadata?.fullCloneParityEvidence === true;
    if (!hasParityGate) errors.push('full_clone fidelity requires parity_matrix_all_complete or explicit fullCloneParityEvidence');
  }

  return { ok: errors.length === 0, errors };
}

function uniqueVerifierSet(surfaces) {
  const seen = new Set();
  const verifierSet = [];
  for (const surface of surfaces) {
    for (const command of surface.verification) {
      const key = command;
      if (seen.has(key)) continue;
      seen.add(key);
      verifierSet.push({ kind: 'shell_command', command, surfaceIds: [surface.id] });
    }
  }
  return verifierSet;
}

function buildRunContract(spec) {
  const explicitDurationTargetMinutes = nullableNonNegativeNumber(spec.metadata.durationTargetMinutes ?? spec.metadata.duration_target_minutes, null);
  const durationTargetMinutes = explicitDurationTargetMinutes != null
    ? explicitDurationTargetMinutes
    : spec.benchmarkTier === 'execution_smoke'
      ? null
      : 60;
  const productDiffMode = clean(spec.metadata.productDiffMode ?? spec.metadata.product_diff_mode);
  const creativeProductWork = objectOr(spec.metadata.creativeProductWork ?? spec.metadata.creative_product_work, {});
  const creativeProductWorkRequired = booleanOr(creativeProductWork.required, productDiffMode === 'creative_product_work' ? true : undefined);
  const defaultRequireRealProductDiffs = productDiffMode
    ? true
    : spec.benchmarkTier === 'execution_smoke'
      ? false
      : undefined;
  const requireRealProductDiffs = booleanOr(spec.metadata.requireRealProductDiffs ?? spec.metadata.require_real_product_diffs, defaultRequireRealProductDiffs);
  const canonicalLandingEvidence = objectOr(spec.metadata.canonicalLandingEvidence ?? spec.metadata.canonical_landing_evidence, {});
  const semanticProductAdmission = objectOr(spec.metadata.semanticProductAdmission ?? spec.metadata.semantic_product_admission, {});
  return {
    schemaVersion: AGENT_WORK_RUN_CONTRACT_SCHEMA,
    generatedAt: spec.generatedAt,
    benchmarkId: spec.benchmarkId,
    benchmarkTier: spec.benchmarkTier,
    benchmarkClass: 'agent_work_orchestration',
    fidelity: spec.fidelity,
    scope: {
      durationTargetMinutes,
      ...(productDiffMode ? { productDiffMode } : {}),
      ...(requireRealProductDiffs !== undefined ? { requireRealProductDiffs } : {}),
      ...(Object.keys(creativeProductWork).length || creativeProductWorkRequired !== undefined ? {
        creativeProductWork: {
          ...(creativeProductWork || {}),
          ...(creativeProductWorkRequired !== undefined ? { required: creativeProductWorkRequired } : {})
        }
      } : {}),
      ...(Object.keys(canonicalLandingEvidence).length ? { canonicalLandingEvidence } : {}),
      ...(Object.keys(semanticProductAdmission).length ? { semanticProductAdmission } : {}),
      surfaces: spec.surfaces.map((surface) => ({
        id: surface.id,
        label: surface.label,
        allowedFiles: surface.allowedFiles,
        verification: surface.verification,
        productGoal: surface.goal,
        metadata: {
          ...surface.metadata,
          lane: surface.lane,
          domain: surface.domain,
          deps: surface.deps
        }
      })),
      stopCondition: spec.stopCondition,
      permissionPolicy: spec.permissions,
      requestedActions: spec.requestedActions,
      doneWhen: spec.doneWhen,
      budgets: spec.budgets,
      wavePolicy: spec.wavePolicy,
      expansionPolicy: spec.expansionPolicy,
      evidenceSchemas: spec.evidenceSchemas,
      truthGates: {
        noTruthLayerOverclaim: spec.doneWhen.includes('no_truth_layer_overclaim'),
        fullCloneParityRequired: spec.fidelity === 'full_clone',
        fullCloneParityEvidenceRequired: spec.fidelity === 'full_clone'
      },
      agentWorkLanguage: {
        schemaVersion: AGENT_WORK_SPEC_SCHEMA,
        languageVersion: spec.languageVersion,
        goalId: spec.goalId,
        outcome: spec.outcome,
        features: {
          budgets: nonEmptyObject(spec.budgets),
          wavePolicy: nonEmptyObject(spec.wavePolicy),
          expansionPolicy: nonEmptyObject(spec.expansionPolicy),
          evidenceSchemas: (spec.evidenceSchemas || []).length > 0,
          templates: (spec.templates || []).length > 0
        }
      }
    },
    repoPath: spec.repoPath,
    verifierSet: uniqueVerifierSet(spec.surfaces),
    requestedAgentCount: spec.requestedAgentCount,
    executionBoundary: spec.executionBoundary,
    stopCondition: spec.stopCondition,
    scoreboardPath: spec.scoreboardPath,
    runId: spec.runId,
    artifactRoot: spec.artifactRoot,
    notes: spec.notes || `Compiled from ${AGENT_WORK_SPEC_SCHEMA}`,
    replyAnchor: spec.replyAnchor,
    metadata: {
      ...(spec.metadata || {}),
      agentWorkDsl: {
        schemaVersion: AGENT_WORK_SPEC_SCHEMA,
        languageVersion: spec.languageVersion,
        goalId: spec.goalId,
        compiler: 'packages/agent-work-dsl',
        policies: {
          budgets: spec.budgets,
          wavePolicy: spec.wavePolicy,
          expansionPolicy: spec.expansionPolicy,
          evidenceSchemas: spec.evidenceSchemas.map((schema) => schema.id),
          templates: spec.templates.map((template) => template.id)
        }
      }
    }
  };
}

function buildSurfaceMatrix(spec) {
  return {
    schemaVersion: 'claw.transfer_surface_matrix.v1',
    generatedAt: spec.generatedAt,
    benchmarkId: spec.benchmarkId,
    runId: spec.runId,
    status: 'pending',
    evidenceSchemas: spec.evidenceSchemas,
    surfaces: spec.surfaces.map((surface) => ({
      id: surface.id,
      label: surface.label,
      status: 'pending',
      productFiles: surface.allowedFiles,
      verification: surface.verification,
      requiredArtifacts: surface.verification.map((command) => ({ kind: 'verifier_command', command })),
      metadata: surface.metadata
    }))
  };
}

function buildWorkGraph(spec) {
  return {
    schemaVersion: 'claw.agent_work_graph.v0',
    generatedAt: spec.generatedAt,
    targetPath: spec.repoPath,
    policies: {
      budgets: spec.budgets,
      wavePolicy: spec.wavePolicy,
      expansionPolicy: spec.expansionPolicy,
      evidenceSchemas: spec.evidenceSchemas
    },
    templates: spec.templates,
    workUnits: spec.surfaces.map((surface) => ({
      id: surface.id,
      title: surface.label,
      goal: surface.goal,
      lane: surface.lane,
      domain: surface.domain,
      deps: surface.deps,
      fileAreas: surface.allowedFiles,
      allowedFiles: surface.allowedFiles,
      surfaceIds: [surface.id],
      requiredVerifiers: surface.verification.map((_, index) => `${surface.id}__verify_${index + 1}`),
      acceptanceChecks: surface.verification.map((command) => `Verifier passes: ${command}`),
      metadata: surface.metadata
    }))
  };
}

export function compileAgentWorkSpec(input = {}, options = {}) {
  const spec = normalizeAgentWorkSpec(input, options);
  const validation = validateAgentWorkSpec(spec);
  if (!validation.ok) throw new Error(`Invalid agent work spec: ${validation.errors.join('; ')}`);
  const runContract = buildRunContract(spec);
  const surfaceMatrix = buildSurfaceMatrix(spec);
  const workGraph = buildWorkGraph(spec);
  return {
    schemaVersion: AGENT_WORK_COMPILATION_SCHEMA,
    generatedAt: spec.generatedAt,
    spec,
    validation,
    safetyReport: {
      permissions: spec.permissions,
      requestedActions: spec.requestedActions,
      relaunchAllowed: !spec.permissions.forbid.includes('relaunch_benchmark'),
      externalWriteAllowed: !spec.permissions.forbid.includes('external_send'),
      truthLayerOverclaimBlocked: spec.doneWhen.includes('no_truth_layer_overclaim') || spec.fidelity === 'full_clone',
      dynamicExpansionDeclared: nonEmptyObject(spec.expansionPolicy),
      wavePolicyDeclared: nonEmptyObject(spec.wavePolicy),
      evidenceSchemasDeclared: (spec.evidenceSchemas || []).length > 0
    },
    runContract,
    surfaceMatrix,
    workGraph
  };
}

export function writeAgentWorkCompilation({ input, outputDir, options = {} } = {}) {
  if (!outputDir) throw new Error('outputDir is required');
  const compilation = compileAgentWorkSpec(input, options);
  fs.mkdirSync(outputDir, { recursive: true });
  const files = {
    specPath: path.join(outputDir, 'agent_work_spec.json'),
    runContractPath: path.join(outputDir, 'run_contract.json'),
    surfaceMatrixPath: path.join(outputDir, 'surface_matrix.json'),
    workGraphPath: path.join(outputDir, 'work_graph.json'),
    compilerReportPath: path.join(outputDir, 'compiler_report.json')
  };
  fs.writeFileSync(files.specPath, `${JSON.stringify(compilation.spec, null, 2)}\n`);
  fs.writeFileSync(files.runContractPath, `${JSON.stringify(compilation.runContract, null, 2)}\n`);
  fs.writeFileSync(files.surfaceMatrixPath, `${JSON.stringify(compilation.surfaceMatrix, null, 2)}\n`);
  fs.writeFileSync(files.workGraphPath, `${JSON.stringify(compilation.workGraph, null, 2)}\n`);
  fs.writeFileSync(files.compilerReportPath, `${JSON.stringify({ ...compilation, files }, null, 2)}\n`);
  return { ...compilation, files };
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return null;
  }
}

function looksLikeRunContract(value) {
  return Boolean(value && typeof value === 'object'
    && (value.schemaVersion === AGENT_WORK_RUN_CONTRACT_SCHEMA
      || (value.repoPath && value.artifactRoot && Array.isArray(value.scope?.surfaces))));
}

function looksLikeAgentWorkCompilation(value) {
  return Boolean(value && typeof value === 'object'
    && (value.schemaVersion === AGENT_WORK_COMPILATION_SCHEMA || looksLikeRunContract(value.runContract)));
}

function looksLikeAgentWorkSpec(value) {
  return Boolean(value && typeof value === 'object'
    && !looksLikeRunContract(value)
    && (value.schemaVersion === AGENT_WORK_SPEC_SCHEMA || Array.isArray(value.surfaces)));
}

function materializeCompilationArtifacts(compilation, outputDir) {
  if (!outputDir) throw new Error('outputDir is required to materialize agent work compilation');
  fs.mkdirSync(outputDir, { recursive: true });
  const files = {
    specPath: path.join(outputDir, 'agent_work_spec.json'),
    runContractPath: path.join(outputDir, 'run_contract.json'),
    surfaceMatrixPath: path.join(outputDir, 'surface_matrix.json'),
    workGraphPath: path.join(outputDir, 'work_graph.json'),
    compilerReportPath: path.join(outputDir, 'compiler_report.json')
  };
  fs.writeFileSync(files.specPath, `${JSON.stringify(compilation.spec, null, 2)}\n`);
  fs.writeFileSync(files.runContractPath, `${JSON.stringify(compilation.runContract, null, 2)}\n`);
  fs.writeFileSync(files.surfaceMatrixPath, `${JSON.stringify(compilation.surfaceMatrix, null, 2)}\n`);
  fs.writeFileSync(files.workGraphPath, `${JSON.stringify(compilation.workGraph, null, 2)}\n`);
  fs.writeFileSync(files.compilerReportPath, `${JSON.stringify({ ...compilation, files }, null, 2)}\n`);
  return files;
}

function resolvedOutputDirForCompilation(compilation, inputPath, options = {}) {
  const explicit = options.outputDir || options.artifactRoot;
  if (explicit) return path.resolve(explicit);
  const artifactRoot = compilation?.runContract?.artifactRoot || compilation?.spec?.artifactRoot;
  if (artifactRoot) return path.resolve(artifactRoot);
  const baseName = inputPath ? path.basename(inputPath).replace(/\.[^.]+$/, '') : compilation?.runContract?.runId || 'agent-work';
  return path.resolve('artifacts', 'agent-work-dsl', 'runner-ingested', baseName || 'agent-work');
}

function runInputResolution({ inputPath, inputKind, runContract, runContractPath, compilation = null, compilerFiles = null }) {
  return {
    schemaVersion: 'claw.agent_work_runner_input_resolution.v0',
    generatedAt: nowIso(),
    inputPath,
    inputKind,
    runContract,
    runContractPath,
    artifactRoot: runContract?.artifactRoot ? path.resolve(runContract.artifactRoot) : null,
    compilation,
    compilerFiles,
    compiledFromAgentWorkDsl: Boolean(compilation)
  };
}

export function resolveAgentWorkRunInput(inputPath, options = {}) {
  if (!inputPath) throw new Error('inputPath is required');
  const resolvedInputPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInputPath)) throw new Error(`agent work run input not found: ${resolvedInputPath}`);
  const stat = fs.statSync(resolvedInputPath);

  if (stat.isDirectory()) {
    const runContractPath = path.join(resolvedInputPath, 'run_contract.json');
    if (fs.existsSync(runContractPath)) {
      const runContract = JSON.parse(fs.readFileSync(runContractPath, 'utf8'));
      return runInputResolution({ inputPath: resolvedInputPath, inputKind: 'run_contract_directory', runContract, runContractPath });
    }
    const compilerReportPath = path.join(resolvedInputPath, 'compiler_report.json');
    if (fs.existsSync(compilerReportPath)) return resolveAgentWorkRunInput(compilerReportPath, options);
    const specPath = path.join(resolvedInputPath, 'agent_work_spec.json');
    if (fs.existsSync(specPath)) return resolveAgentWorkRunInput(specPath, { ...options, outputDir: options.outputDir || resolvedInputPath });
    throw new Error(`directory is not an agent work run input: ${resolvedInputPath}`);
  }

  const text = fs.readFileSync(resolvedInputPath, 'utf8');
  const parsed = parseJsonMaybe(text);
  if (looksLikeRunContract(parsed)) {
    return runInputResolution({ inputPath: resolvedInputPath, inputKind: 'run_contract_json', runContract: parsed, runContractPath: resolvedInputPath });
  }

  if (looksLikeAgentWorkCompilation(parsed)) {
    const compilation = parsed.compilation?.runContract
      ? parsed.compilation
      : {
        ...parsed,
        spec: parsed.spec || parsed.agentWorkSpec,
        runContract: parsed.runContract,
        surfaceMatrix: parsed.surfaceMatrix,
        workGraph: parsed.workGraph
      };
    const runContract = compilation.runContract;
    const existingRunContractPath = parsed.files?.runContractPath ? path.resolve(parsed.files.runContractPath) : null;
    if (existingRunContractPath && fs.existsSync(existingRunContractPath)) {
      return runInputResolution({ inputPath: resolvedInputPath, inputKind: 'agent_work_compiler_report', runContract, runContractPath: existingRunContractPath, compilation, compilerFiles: parsed.files || null });
    }
    const outputDir = resolvedOutputDirForCompilation(compilation, resolvedInputPath, options);
    const compilerFiles = materializeCompilationArtifacts(compilation, outputDir);
    return runInputResolution({ inputPath: resolvedInputPath, inputKind: 'agent_work_compiler_report', runContract: compilation.runContract, runContractPath: compilerFiles.runContractPath, compilation, compilerFiles });
  }

  const specInput = looksLikeAgentWorkSpec(parsed) ? parsed : text;
  const compilation = compileAgentWorkSpec(specInput, options);
  const outputDir = resolvedOutputDirForCompilation(compilation, resolvedInputPath, options);
  const compilerFiles = materializeCompilationArtifacts(compilation, outputDir);
  return runInputResolution({ inputPath: resolvedInputPath, inputKind: parsed ? 'agent_work_spec_json' : 'agent_work_text_spec', runContract: compilation.runContract, runContractPath: compilerFiles.runContractPath, compilation, compilerFiles });
}
