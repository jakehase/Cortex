import fs from 'node:fs';
import path from 'node:path';

export const AGENT_WORK_SPEC_SCHEMA = 'claw.agent_work_spec.v0';
export const AGENT_WORK_COMPILATION_SCHEMA = 'claw.agent_work_compilation.v0';
export const AGENT_WORK_RUN_CONTRACT_SCHEMA = 'claw.agent_benchmark_run_contract.v1';
export const FIDELITY_LATTICE = Object.freeze(['prototype', 'production_slice', 'parity_for_scope', 'full_clone']);

const DEFAULT_STOP_CONDITION = 'supervisor_green_or_blocker_report';
const DEFAULT_BENCHMARK_TIER = 'agent_work_contract_v0';
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
  else if (['lane', 'domain'].includes(normalized)) surface[normalized] = value;
  else surface.metadata[normalized] = value;
}

export function parseAgentWorkSpec(text) {
  const source = String(text || '').trim();
  if (!source) return {};
  if (source.startsWith('{')) return JSON.parse(source);
  const spec = {
    permissions: { allow: [], forbid: [] },
    surfaces: [],
    doneWhen: [],
    requestedActions: [],
    metadata: {}
  };
  let currentSurface = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const withoutComment = stripComment(rawLine);
    if (!withoutComment.trim()) continue;
    const indent = rawLine.match(/^\s*/)?.[0]?.length || 0;
    const line = withoutComment.trim();
    const surfaceMatch = line.match(/^surface\s+(.+)$/i);
    if (surfaceMatch && indent === 0) {
      currentSurface = { id: normalizeId(surfaceMatch[1]), label: surfaceMatch[1].trim(), files: [], verify: [], deps: [], metadata: {} };
      spec.surfaces.push(currentSurface);
      continue;
    }
    const directive = parseKeyValue(line);
    if (!directive) continue;
    if (currentSurface && indent > 0) assignSurfaceDirective(currentSurface, directive.key, directive.value);
    else {
      currentSurface = null;
      assignDirective(spec, directive.key, directive.value);
    }
  }
  return spec;
}

function normalizeSurface(surface = {}, index = 0) {
  const id = normalizeId(surface.id || surface.surfaceId || surface.label || `surface_${index + 1}`);
  const files = stableList(surface.files || surface.allowedFiles || surface.allowed_files || surface.fileAreas || surface.productFiles || surface.product_files);
  const verification = stableList(surface.verify || surface.verification || surface.verifiers || surface.tests || surface.test);
  return {
    id,
    label: clean(surface.label || surface.name || id),
    goal: clean(surface.goal || surface.productGoal || surface.outcome || `Complete ${id}`),
    allowedFiles: files,
    verification,
    deps: stableList(surface.deps || surface.dependsOn || surface.depends_on),
    lane: clean(surface.lane || 'agent_work'),
    domain: clean(surface.domain || id),
    metadata: {
      ...(surface.metadata || {}),
      agentWorkDsl: true
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
  const spec = {
    schemaVersion: AGENT_WORK_SPEC_SCHEMA,
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
    surfaces: (parsed.surfaces || []).map(normalizeSurface),
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
  for (const surface of spec.surfaces || []) {
    if (!clean(surface.id)) errors.push('surface id is required');
    if (!Array.isArray(surface.allowedFiles) || surface.allowedFiles.length === 0) errors.push(`surface ${surface.id || '<unknown>'} needs allowedFiles`);
    if (!Array.isArray(surface.verification) || surface.verification.length === 0) errors.push(`surface ${surface.id || '<unknown>'} needs verification commands`);
  }
  if (!clean(spec.stopCondition)) errors.push('stopCondition is required');

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
  return {
    schemaVersion: AGENT_WORK_RUN_CONTRACT_SCHEMA,
    generatedAt: spec.generatedAt,
    benchmarkId: spec.benchmarkId,
    benchmarkTier: spec.benchmarkTier,
    benchmarkClass: 'agent_work_orchestration',
    fidelity: spec.fidelity,
    scope: {
      durationTargetMinutes: numberOr(spec.metadata.durationTargetMinutes || spec.metadata.duration_target_minutes, 60),
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
      truthGates: {
        noTruthLayerOverclaim: spec.doneWhen.includes('no_truth_layer_overclaim'),
        fullCloneParityRequired: spec.fidelity === 'full_clone',
        fullCloneParityEvidenceRequired: spec.fidelity === 'full_clone'
      },
      agentWorkLanguage: {
        schemaVersion: AGENT_WORK_SPEC_SCHEMA,
        goalId: spec.goalId,
        outcome: spec.outcome
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
        goalId: spec.goalId,
        compiler: 'packages/agent-work-dsl'
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
      truthLayerOverclaimBlocked: spec.doneWhen.includes('no_truth_layer_overclaim') || spec.fidelity === 'full_clone'
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
