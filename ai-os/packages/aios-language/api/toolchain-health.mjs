const DEFAULT_CAPABILITY_POLICY = Object.freeze({
  allowed: Object.freeze([
    'filesystem:read',
    'kernel:job:enqueue',
    'runtime:adapter:handoff',
    'telemetry:read',
    'verifier:report',
  ]),
  denied: Object.freeze(['filesystem:write', 'network:external', 'process:spawn']),
});

const KNOWN_RECOVERY_ACTIONS = new Set(['retry', 'rollback', 'quarantine', 'degrade', 'halt']);
const KNOWN_LIFECYCLE_COMMANDS = new Set(['enable', 'disable', 'start', 'pause', 'resume', 'rollback', 'status']);
const KNOWN_SCHEDULE_MODES = new Set(['manual', 'periodic', 'cron', 'event']);
const SETTING_VALUE_KEYS = ['value', 'default', 'env'];
const STATEMENT_PATTERN = /^([A-Za-z][\w-]*)(?:\s+(.*))?$/;

export const TOOLCHAIN_HEALTH_EXAMPLE = [
  'source mailchimp-ingest grammar mailchimp-segment-v1',
  'capability telemetry:read required',
  'capability verifier:report required',
  'memory segment-cache ttl=300 scope=local',
  'verify contact-schema schema=mailchimp.contact required=true',
  'runtime adapter=mailchimp-sync mode=dry-run',
  'setting batch-size value=250 required=true mutable=true',
  'control sync enabled=true reason=operator-approved',
  'schedule hourly mode=periodic interval=3600 enabled=true',
  'lifecycle enable when=verified command=sync',
  'lifecycle pause when=diagnostic command=sync',
  'recover retry attempts=2 then=rollback',
  'status ok when=verified',
  'truth boundary boundary=local-only externalWrite=false',
].join('\n');

export function parseToolchainHealthSource(source, options = {}) {
  const text = normalizeSource(source);
  const ast = {
    type: 'ToolchainHealthProgram',
    version: 1,
    sourceHash: stableHash(text),
    declarations: [],
    diagnostics: [],
  };

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = stripInlineComment(rawLine).trim();
    if (!line) return;

    const parsed = parseDeclarationLine(line);
    if (!parsed) {
      ast.diagnostics.push(diagnostic('parse.syntax', `Unrecognized statement on line ${lineNumber}.`, lineNumber, 'error'));
      return;
    }

    const { kind, name, tail } = parsed;
    const attributes = parseAttributes(tail, lineNumber, ast.diagnostics);
    ast.declarations.push({
      type: 'Declaration',
      kind,
      name,
      attributes,
      line: lineNumber,
      raw: line,
    });
  });

  if (options.requireRuntime !== false && !ast.declarations.some((item) => item.kind === 'runtime')) {
    ast.diagnostics.push(diagnostic('parse.runtime.missing', 'Program must declare a runtime adapter.', 0, 'error'));
  }

  return ast;
}

export function verifyToolchainHealthAst(ast, policy = DEFAULT_CAPABILITY_POLICY) {
  const program = assertAst(ast);
  const diagnostics = [...program.diagnostics];
  const declarationsByKind = groupBy(program.declarations, 'kind');
  const capabilityDecls = declarationsByKind.capability ?? [];
  const runtimeDecl = firstDeclaration(declarationsByKind.runtime);
  const truthDecl = firstDeclaration(declarationsByKind.truth);
  const sourceDecl = firstDeclaration(declarationsByKind.source);
  const settingDecls = declarationsByKind.setting ?? [];
  const controlDecls = declarationsByKind.control ?? [];
  const scheduleDecls = declarationsByKind.schedule ?? [];
  const lifecycleDecls = declarationsByKind.lifecycle ?? [];

  if (!sourceDecl) {
    diagnostics.push(diagnostic('verify.source.missing', 'A source grammar declaration is required.', 0, 'error'));
  }

  if (!runtimeDecl) {
    diagnostics.push(diagnostic('verify.runtime.missing', 'A runtime adapter declaration is required.', 0, 'error'));
  }

  const capabilityNames = capabilityDecls.map((item) => item.name);
  const requiredCapabilities = new Set(['kernel:job:enqueue', 'runtime:adapter:handoff']);
  for (const requiredCapability of requiredCapabilities) {
    if (!capabilityNames.includes(requiredCapability)) {
      capabilityDecls.push(syntheticCapability(requiredCapability));
    }
  }

  for (const declaration of capabilityDecls) {
    const status = classifyCapability(declaration.name, policy);
    if (status === 'denied') {
      diagnostics.push(diagnostic('verify.capability.denied', `Capability "${declaration.name}" violates the local boundary policy.`, declaration.line, 'error'));
    } else if (status === 'unknown') {
      diagnostics.push(diagnostic('verify.capability.unknown', `Capability "${declaration.name}" is not declared by the policy.`, declaration.line, 'warning'));
    }
  }

  if (truthDecl?.attributes.externalWrite === true) {
    diagnostics.push(diagnostic('verify.truth.external_write', 'Truth boundary forbids external writes for this local toolchain surface.', truthDecl.line, 'error'));
  }

  validateSettings(settingDecls, diagnostics);
  validateControls(controlDecls, diagnostics);
  validateSchedules(scheduleDecls, diagnostics);
  validateLifecycle(lifecycleDecls, controlDecls, diagnostics);

  for (const recovery of declarationsByKind.recover ?? []) {
    if (!KNOWN_RECOVERY_ACTIONS.has(recovery.name)) {
      diagnostics.push(diagnostic('verify.recovery.unknown', `Unknown recovery action "${recovery.name}".`, recovery.line, 'warning'));
    }
    if (recovery.attributes.then && !KNOWN_RECOVERY_ACTIONS.has(String(recovery.attributes.then))) {
      diagnostics.push(diagnostic('verify.recovery.then_unknown', `Unknown chained recovery action "${recovery.attributes.then}".`, recovery.line, 'warning'));
    }
  }

  return {
    ok: !diagnostics.some((item) => item.severity === 'error'),
    diagnostics: sortDiagnostics(diagnostics),
    declarations: program.declarations.length,
    capabilityPolicy: {
      allowed: [...(policy.allowed ?? [])].sort(),
      denied: [...(policy.denied ?? [])].sort(),
    },
  };
}

export function compileToolchainHealth(sourceOrAst, options = {}) {
  const ast = typeof sourceOrAst === 'string'
    ? parseToolchainHealthSource(sourceOrAst, options.parser)
    : assertAst(sourceOrAst);
  const verification = verifyToolchainHealthAst(ast, options.capabilityPolicy ?? DEFAULT_CAPABILITY_POLICY);
  const declarationsByKind = groupBy(ast.declarations, 'kind');
  const sourceDecl = firstDeclaration(declarationsByKind.source);
  const runtimeDecl = firstDeclaration(declarationsByKind.runtime);
  const memoryDecls = declarationsByKind.memory ?? [];
  const verifierDecls = declarationsByKind.verify ?? [];
  const capabilityDecls = [
    ...(declarationsByKind.capability ?? []),
    syntheticCapability('kernel:job:enqueue'),
    syntheticCapability('runtime:adapter:handoff'),
  ];

  const jobDescriptor = {
    id: `toolchain-health:${ast.sourceHash}`,
    kind: 'aios.toolchain.health',
    source: sourceDecl ? {
      name: sourceDecl.name,
      grammar: sourceDecl.attributes.grammar ?? sourceDecl.attributes.parser ?? 'unspecified',
      line: sourceDecl.line,
    } : null,
    capabilities: uniqueByName(capabilityDecls).map((item) => ({
      name: item.name,
      required: item.attributes.required !== false,
      source: item.synthetic ? 'compiler' : 'program',
    })).sort((a, b) => a.name.localeCompare(b.name)),
    memory: memoryDecls.map((item) => ({
      region: item.name,
      scope: item.attributes.scope ?? 'local',
      ttlSeconds: numberOrDefault(item.attributes.ttl, null),
      durable: item.attributes.durable === true,
    })),
    verifierContracts: verifierDecls.map((item) => ({
      name: item.name,
      schema: item.attributes.schema ?? item.name,
      required: item.attributes.required !== false,
      line: item.line,
    })),
    runtimeHandoff: runtimeDecl ? {
      adapter: runtimeDecl.attributes.adapter ?? runtimeDecl.name,
      mode: runtimeDecl.attributes.mode ?? 'observe',
      payloadRef: `memory://${ast.sourceHash}/handoff`,
    } : null,
    settings: buildSettingsContract(declarationsByKind.setting ?? []),
    controls: buildControlState(declarationsByKind.control ?? []),
    schedule: buildScheduleControls(declarationsByKind.schedule ?? []),
    lifecycle: buildLifecycleControls(declarationsByKind.lifecycle ?? [], declarationsByKind.control ?? [], verification),
    recovery: buildRecoveryPlan(declarationsByKind.recover ?? []),
    statusModel: buildStatusModel(declarationsByKind.status ?? [], verification),
    truthBoundary: buildTruthBoundary(firstDeclaration(declarationsByKind.truth), verification),
  };

  return {
    ast,
    verification,
    jobDescriptor,
    runtimeAdapterRequest: createRuntimeAdapterRequest(jobDescriptor),
  };
}

export function createRuntimeAdapterRequest(jobDescriptor, overrides = {}) {
  if (!jobDescriptor || typeof jobDescriptor !== 'object') {
    throw new TypeError('jobDescriptor must be an object.');
  }

  return {
    adapter: overrides.adapter ?? jobDescriptor.runtimeHandoff?.adapter ?? 'unknown',
    mode: overrides.mode ?? jobDescriptor.runtimeHandoff?.mode ?? 'observe',
    jobId: jobDescriptor.id,
    capabilityNames: (jobDescriptor.capabilities ?? []).map((item) => item.name).sort(),
    memoryRegions: (jobDescriptor.memory ?? []).map((item) => item.region).sort(),
    verifierContracts: (jobDescriptor.verifierContracts ?? []).map((item) => item.schema).sort(),
    settings: jobDescriptor.settings ?? [],
    controls: jobDescriptor.controls ?? [],
    schedule: jobDescriptor.schedule ?? [],
    lifecycle: jobDescriptor.lifecycle ?? [],
    nextAction: selectNextTimelineAction(verificationFromTruthBoundary(jobDescriptor.truthBoundary), jobDescriptor),
    recovery: jobDescriptor.recovery ?? [],
    truthBoundary: jobDescriptor.truthBoundary ?? buildTruthBoundary(null, { ok: false, diagnostics: [] }),
  };
}

export function summarizeToolchainHealth(sourceOrAst, options = {}) {
  const compiled = compileToolchainHealth(sourceOrAst, options);
  const { jobDescriptor, verification } = compiled;
  const snapshot = createToolchainHealthSnapshot(compiled, options.snapshot);
  return {
    ok: verification.ok,
    jobId: jobDescriptor.id,
    adapter: jobDescriptor.runtimeHandoff?.adapter ?? null,
    capabilityCount: jobDescriptor.capabilities.length,
    memoryRegionCount: jobDescriptor.memory.length,
    verifierContractCount: jobDescriptor.verifierContracts.length,
    recoveryActions: jobDescriptor.recovery.map((item) => item.action),
    truthBoundary: jobDescriptor.truthBoundary,
    analytics: snapshot.analytics,
    timeline: snapshot.timeline,
    exportSummary: snapshot.exportSummary,
    diagnostics: verification.diagnostics,
  };
}

export function createToolchainHealthSnapshot(sourceOrCompiled, options = {}) {
  const compiled = isCompiledToolchainHealth(sourceOrCompiled)
    ? sourceOrCompiled
    : compileToolchainHealth(sourceOrCompiled, options);
  const { ast, verification, jobDescriptor, runtimeAdapterRequest } = compiled;
  const diagnosticsBySeverity = countBy(verification.diagnostics, 'severity');
  const declarationsByKind = countBy(ast.declarations, 'kind');
  const requiredCapabilities = jobDescriptor.capabilities.filter((item) => item.required);
  const localMemoryRegions = jobDescriptor.memory.filter((item) => item.scope === 'local');
  const durableMemoryRegions = jobDescriptor.memory.filter((item) => item.durable);
  const requiredVerifierContracts = jobDescriptor.verifierContracts.filter((item) => item.required);
  const deniedDiagnostics = verification.diagnostics.filter((item) => item.code === 'verify.capability.denied');
  const unknownCapabilityDiagnostics = verification.diagnostics.filter((item) => item.code === 'verify.capability.unknown');
  const recoveryActions = jobDescriptor.recovery.map((item) => item.action);
  const rollbackReady = jobDescriptor.recovery.some((item) => item.action === 'rollback' || item.then === 'rollback');
  const enabledControls = jobDescriptor.controls.filter((item) => item.enabled);
  const disabledControls = jobDescriptor.controls.filter((item) => !item.enabled);
  const enabledSchedules = jobDescriptor.schedule.filter((item) => item.enabled);
  const manualSchedules = jobDescriptor.schedule.filter((item) => item.mode === 'manual');
  const requiredSettings = jobDescriptor.settings.filter((item) => item.required);
  const mutableSettings = jobDescriptor.settings.filter((item) => item.mutable);
  const nextLifecycleAction = selectLifecycleAction(verification, jobDescriptor);
  const exportId = `toolchain-health-export:${stableHash([
    jobDescriptor.id,
    verification.ok ? 'ok' : 'blocked',
    verification.diagnostics.map((item) => `${item.code}:${item.line}:${item.severity}`).join('|'),
    recoveryActions.join(','),
    nextLifecycleAction.action,
  ].join('\n'))}`;

  const analytics = {
    declarationCount: ast.declarations.length,
    declarationKinds: declarationsByKind,
    capabilityCount: jobDescriptor.capabilities.length,
    requiredCapabilityCount: requiredCapabilities.length,
    memoryRegionCount: jobDescriptor.memory.length,
    localMemoryRegionCount: localMemoryRegions.length,
    durableMemoryRegionCount: durableMemoryRegions.length,
    verifierContractCount: jobDescriptor.verifierContracts.length,
    requiredVerifierContractCount: requiredVerifierContracts.length,
    recoveryActionCount: jobDescriptor.recovery.length,
    rollbackReady,
    settingCount: jobDescriptor.settings.length,
    requiredSettingCount: requiredSettings.length,
    mutableSettingCount: mutableSettings.length,
    controlCount: jobDescriptor.controls.length,
    enabledControlCount: enabledControls.length,
    disabledControlCount: disabledControls.length,
    scheduleCount: jobDescriptor.schedule.length,
    enabledScheduleCount: enabledSchedules.length,
    manualScheduleCount: manualSchedules.length,
    diagnosticCount: verification.diagnostics.length,
    diagnosticsBySeverity,
    deniedCapabilityCount: deniedDiagnostics.length,
    unknownCapabilityCount: unknownCapabilityDiagnostics.length,
    externalWriteRequested: jobDescriptor.truthBoundary.externalWrite === true,
  };

  const timeline = {
    state: verification.ok ? 'ready' : 'blocked',
    stage: verification.ok ? 'runtime-handoff' : 'verification',
    sequence: numberOrDefault(options.sequence, 1),
    sourceHash: ast.sourceHash,
    previousSourceHash: options.previousSourceHash ?? null,
    transition: classifySnapshotTransition(options.previousSourceHash, ast.sourceHash, verification.ok),
    rollbackEligible: jobDescriptor.statusModel.rollbackEligible || rollbackReady,
    nextAction: nextLifecycleAction.action,
    nextActionReason: nextLifecycleAction.reason,
    lifecycle: jobDescriptor.lifecycle,
    controls: jobDescriptor.controls,
    schedule: jobDescriptor.schedule,
    statusModel: jobDescriptor.statusModel,
  };

  const exportSummary = {
    id: exportId,
    jobId: jobDescriptor.id,
    sourceHash: ast.sourceHash,
    ok: verification.ok,
    adapter: runtimeAdapterRequest.adapter,
    mode: runtimeAdapterRequest.mode,
    capabilityNames: runtimeAdapterRequest.capabilityNames,
    memoryRegions: runtimeAdapterRequest.memoryRegions,
    verifierContracts: runtimeAdapterRequest.verifierContracts,
    settings: runtimeAdapterRequest.settings,
    controls: runtimeAdapterRequest.controls,
    schedule: runtimeAdapterRequest.schedule,
    lifecycle: runtimeAdapterRequest.lifecycle,
    recoveryActions,
    truthBoundary: jobDescriptor.truthBoundary.boundary,
    reportLevel: jobDescriptor.truthBoundary.reportLevel,
    blockedReasons: verification.diagnostics
      .filter((item) => item.severity === 'error')
      .map((item) => item.code),
  };

  return {
    type: 'ToolchainHealthSnapshot',
    version: 1,
    id: exportId,
    jobId: jobDescriptor.id,
    sourceHash: ast.sourceHash,
    analytics,
    timeline,
    exportSummary,
    diagnostics: verification.diagnostics,
  };
}

export function createToolchainHealthHistory(sourcesOrSnapshots, options = {}) {
  if (!Array.isArray(sourcesOrSnapshots)) {
    throw new TypeError('sourcesOrSnapshots must be an array.');
  }

  let previousSourceHash = options.previousSourceHash ?? null;
  const snapshots = sourcesOrSnapshots.map((item, index) => {
    const snapshot = isToolchainHealthSnapshot(item)
      ? item
      : createToolchainHealthSnapshot(item, {
        ...options,
        sequence: index + 1,
        previousSourceHash,
      });
    previousSourceHash = snapshot.sourceHash;
    return normalizeSnapshotSequence(snapshot, index + 1);
  });

  const states = countBy(snapshots.map((item) => item.timeline), 'state');
  const transitions = countBy(snapshots.map((item) => item.timeline), 'transition');
  const totals = snapshots.reduce((aggregate, snapshot) => ({
    diagnosticCount: aggregate.diagnosticCount + snapshot.analytics.diagnosticCount,
    deniedCapabilityCount: aggregate.deniedCapabilityCount + snapshot.analytics.deniedCapabilityCount,
    unknownCapabilityCount: aggregate.unknownCapabilityCount + snapshot.analytics.unknownCapabilityCount,
    rollbackReadyCount: aggregate.rollbackReadyCount + (snapshot.analytics.rollbackReady ? 1 : 0),
  }), {
    diagnosticCount: 0,
    deniedCapabilityCount: 0,
    unknownCapabilityCount: 0,
    rollbackReadyCount: 0,
  });

  return {
    type: 'ToolchainHealthHistory',
    version: 1,
    count: snapshots.length,
    latest: snapshots.at(-1)?.exportSummary ?? null,
    timeline: snapshots.map((item) => ({
      sequence: item.timeline.sequence,
      sourceHash: item.sourceHash,
      state: item.timeline.state,
      stage: item.timeline.stage,
      transition: item.timeline.transition,
      nextAction: item.timeline.nextAction,
      diagnosticCount: item.analytics.diagnosticCount,
    })),
    counters: {
      states,
      transitions,
      ...totals,
    },
    snapshots,
  };
}

export function exportToolchainHealthReport(sourcesOrSnapshots, options = {}) {
  const history = Array.isArray(sourcesOrSnapshots)
    ? createToolchainHealthHistory(sourcesOrSnapshots, options)
    : createToolchainHealthHistory([sourcesOrSnapshots], options);
  const latest = history.snapshots.at(-1) ?? null;

  return {
    type: 'ToolchainHealthExportReport',
    version: 1,
    generatedAt: options.generatedAt ?? null,
    reportId: `toolchain-health-report:${stableHash(history.timeline.map((item) => [
      item.sequence,
      item.sourceHash,
      item.state,
      item.transition,
    ].join(':')).join('|'))}`,
    ok: latest?.exportSummary.ok ?? false,
    latest: latest?.exportSummary ?? null,
    counters: history.counters,
    timeline: history.timeline,
    diagnostics: latest?.diagnostics ?? [],
    snapshots: options.includeSnapshots === true ? history.snapshots : undefined,
  };
}

function normalizeSource(source) {
  if (typeof source !== 'string') {
    throw new TypeError('toolchain health source must be a string.');
  }
  return source.replace(/\r\n/g, '\n').trim();
}

function stripInlineComment(line) {
  const index = line.indexOf('#');
  return index === -1 ? line : line.slice(0, index);
}

function parseDeclarationLine(line) {
  const match = STATEMENT_PATTERN.exec(line);
  if (!match) return null;

  const [, kind, rest = ''] = match;
  const trimmed = rest.trim();
  if (!trimmed) {
    return { kind, name: defaultDeclarationName(kind), tail: '' };
  }

  const firstSpace = trimmed.search(/\s/);
  const firstToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const remainder = firstSpace === -1 ? '' : trimmed.slice(firstSpace).trim();
  const equalsIndex = firstToken.indexOf('=');

  if (equalsIndex > 0) {
    return { kind, name: defaultDeclarationName(kind), tail: trimmed };
  }

  if (remainder.startsWith('=')) {
    return { kind, name: defaultDeclarationName(kind), tail: `${firstToken}${remainder}` };
  }

  return { kind, name: firstToken, tail: remainder };
}

function defaultDeclarationName(kind) {
  return {
    source: 'source',
    verify: 'contract',
    runtime: 'adapter',
    truth: 'boundary',
    status: 'state',
    recover: 'halt',
    memory: 'memory',
    capability: 'capability',
    setting: 'setting',
    control: 'control',
    schedule: 'schedule',
    lifecycle: 'status',
  }[kind] ?? 'declaration';
}

function parseAttributes(tail, line, diagnostics) {
  const attributes = {};
  const trimmed = tail.trim();
  if (!trimmed) return attributes;

  for (const token of trimmed.split(/\s+/)) {
    const separator = token.indexOf('=');
    if (separator === -1) {
      attributes[token] = true;
      continue;
    }
    const key = token.slice(0, separator);
    const rawValue = token.slice(separator + 1);
    if (!key) {
      diagnostics.push(diagnostic('parse.attribute.empty_key', `Empty attribute key on line ${line}.`, line, 'warning'));
      continue;
    }
    attributes[key] = parseAttributeValue(rawValue);
  }

  return attributes;
}

function parseAttributeValue(rawValue) {
  const value = rawValue.replace(/^["']|["']$/g, '');
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.includes(',')) return value.split(',').filter(Boolean);
  return value;
}

function assertAst(ast) {
  if (!ast || ast.type !== 'ToolchainHealthProgram' || !Array.isArray(ast.declarations)) {
    throw new TypeError('Expected a ToolchainHealthProgram AST.');
  }
  return ast;
}

function diagnostic(code, message, line, severity) {
  return { code, message, line, severity };
}

function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((a, b) => a.line - b.line || a.code.localeCompare(b.code));
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const groupKey = item[key];
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(item);
    return groups;
  }, {});
}

function firstDeclaration(items) {
  return Array.isArray(items) && items.length > 0 ? items[0] : null;
}

function syntheticCapability(name) {
  return {
    type: 'Declaration',
    kind: 'capability',
    name,
    attributes: { required: true },
    line: 0,
    synthetic: true,
  };
}

function classifyCapability(name, policy) {
  if ((policy.denied ?? []).includes(name)) return 'denied';
  if ((policy.allowed ?? []).includes(name)) return 'allowed';
  return 'unknown';
}

function uniqueByName(items) {
  const seen = new Map();
  for (const item of items) {
    if (!seen.has(item.name)) seen.set(item.name, item);
  }
  return [...seen.values()];
}

function numberOrDefault(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validateSettings(settingDecls, diagnostics) {
  const seen = new Set();
  for (const setting of settingDecls) {
    if (seen.has(setting.name)) {
      diagnostics.push(diagnostic('verify.setting.duplicate', `Setting "${setting.name}" is declared more than once.`, setting.line, 'warning'));
    }
    seen.add(setting.name);

    const hasValue = SETTING_VALUE_KEYS.some((key) => setting.attributes[key] !== undefined);
    if (setting.attributes.required === true && !hasValue) {
      diagnostics.push(diagnostic('verify.setting.required_missing_value', `Required setting "${setting.name}" must declare value, default, or env.`, setting.line, 'error'));
    }
    if (setting.attributes.externalWrite === true) {
      diagnostics.push(diagnostic('verify.setting.external_write', `Setting "${setting.name}" cannot request external writes.`, setting.line, 'error'));
    }
    if (setting.attributes.mutable !== undefined && typeof setting.attributes.mutable !== 'boolean') {
      diagnostics.push(diagnostic('verify.setting.mutable_invalid', `Setting "${setting.name}" mutable must be true or false.`, setting.line, 'warning'));
    }
  }
}

function validateControls(controlDecls, diagnostics) {
  const seen = new Set();
  for (const control of controlDecls) {
    if (seen.has(control.name)) {
      diagnostics.push(diagnostic('verify.control.duplicate', `Control "${control.name}" is declared more than once.`, control.line, 'warning'));
    }
    seen.add(control.name);

    if (control.attributes.enabled !== undefined && typeof control.attributes.enabled !== 'boolean') {
      diagnostics.push(diagnostic('verify.control.enabled_invalid', `Control "${control.name}" enabled must be true or false.`, control.line, 'warning'));
    }
    if (control.attributes.enabled === false && !control.attributes.reason) {
      diagnostics.push(diagnostic('verify.control.disabled_reason_missing', `Disabled control "${control.name}" should include a reason.`, control.line, 'warning'));
    }
  }
}

function validateSchedules(scheduleDecls, diagnostics) {
  for (const schedule of scheduleDecls) {
    const mode = String(schedule.attributes.mode ?? 'manual');
    if (!KNOWN_SCHEDULE_MODES.has(mode)) {
      diagnostics.push(diagnostic('verify.schedule.mode_unknown', `Unknown schedule mode "${mode}" for "${schedule.name}".`, schedule.line, 'warning'));
    }

    const interval = numberOrDefault(schedule.attributes.interval, null);
    if (mode === 'periodic' && (!interval || interval < 1)) {
      diagnostics.push(diagnostic('verify.schedule.interval_required', `Periodic schedule "${schedule.name}" requires interval greater than zero.`, schedule.line, 'error'));
    }
    if (mode === 'cron' && !schedule.attributes.cron) {
      diagnostics.push(diagnostic('verify.schedule.cron_required', `Cron schedule "${schedule.name}" requires cron expression.`, schedule.line, 'error'));
    }
    if (schedule.attributes.enabled !== undefined && typeof schedule.attributes.enabled !== 'boolean') {
      diagnostics.push(diagnostic('verify.schedule.enabled_invalid', `Schedule "${schedule.name}" enabled must be true or false.`, schedule.line, 'warning'));
    }
  }
}

function validateLifecycle(lifecycleDecls, controlDecls, diagnostics) {
  const controlNames = new Set(controlDecls.map((item) => item.name));
  for (const lifecycle of lifecycleDecls) {
    if (!KNOWN_LIFECYCLE_COMMANDS.has(lifecycle.name)) {
      diagnostics.push(diagnostic('verify.lifecycle.command_unknown', `Unknown lifecycle command "${lifecycle.name}".`, lifecycle.line, 'warning'));
    }

    const targetControl = lifecycle.attributes.command ?? lifecycle.attributes.control ?? null;
    if (targetControl && controlNames.size > 0 && !controlNames.has(String(targetControl))) {
      diagnostics.push(diagnostic('verify.lifecycle.control_unknown', `Lifecycle command "${lifecycle.name}" references unknown control "${targetControl}".`, lifecycle.line, 'warning'));
    }
    if (lifecycle.attributes.enabled !== undefined && typeof lifecycle.attributes.enabled !== 'boolean') {
      diagnostics.push(diagnostic('verify.lifecycle.enabled_invalid', `Lifecycle command "${lifecycle.name}" enabled must be true or false.`, lifecycle.line, 'warning'));
    }
  }
}

function buildSettingsContract(settingDecls) {
  return uniqueByName(settingDecls).map((item) => {
    const valueKey = SETTING_VALUE_KEYS.find((key) => item.attributes[key] !== undefined) ?? null;
    return {
      name: item.name,
      required: item.attributes.required === true,
      mutable: item.attributes.mutable === true,
      source: valueKey ?? 'unset',
      value: valueKey && valueKey !== 'env' ? item.attributes[valueKey] : undefined,
      env: valueKey === 'env' ? String(item.attributes.env) : undefined,
      line: item.line,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function buildControlState(controlDecls) {
  return uniqueByName(controlDecls).map((item) => ({
    name: item.name,
    enabled: item.attributes.enabled !== false,
    reason: item.attributes.reason ?? null,
    owner: item.attributes.owner ?? 'operator',
    line: item.line,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function buildScheduleControls(scheduleDecls) {
  return uniqueByName(scheduleDecls).map((item) => {
    const mode = String(item.attributes.mode ?? 'manual');
    return {
      name: item.name,
      mode,
      enabled: item.attributes.enabled !== false,
      intervalSeconds: mode === 'periodic' ? numberOrDefault(item.attributes.interval, null) : null,
      cron: mode === 'cron' ? String(item.attributes.cron ?? '') : null,
      event: mode === 'event' ? String(item.attributes.event ?? item.name) : null,
      line: item.line,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function buildLifecycleControls(lifecycleDecls, controlDecls, verification) {
  const controlNames = new Set(controlDecls.map((item) => item.name));
  const declared = lifecycleDecls.map((item, index) => ({
    order: index + 1,
    command: item.name,
    enabled: item.attributes.enabled !== false,
    when: item.attributes.when ?? (verification.ok ? 'verified' : 'diagnostic'),
    control: item.attributes.command ?? item.attributes.control ?? (controlNames.size === 1 ? [...controlNames][0] : null),
    line: item.line,
  }));

  if (declared.length > 0) return declared;

  return [{
    order: 1,
    command: verification.ok ? 'start' : 'status',
    enabled: true,
    when: verification.ok ? 'verified' : 'diagnostic',
    control: controlNames.size === 1 ? [...controlNames][0] : null,
    line: 0,
  }];
}

function buildRecoveryPlan(recoveryDecls) {
  const plan = recoveryDecls.map((item, index) => ({
    order: index + 1,
    action: item.name,
    attempts: numberOrDefault(item.attributes.attempts, item.name === 'retry' ? 1 : 0),
    then: item.attributes.then ?? null,
    line: item.line,
  }));

  return plan.length > 0 ? plan : [{ order: 1, action: 'halt', attempts: 0, then: null, line: 0 }];
}

function buildStatusModel(statusDecls, verification) {
  const declared = statusDecls.map((item) => ({
    state: item.name,
    when: item.attributes.when ?? 'manual',
    line: item.line,
  }));

  return {
    current: verification.ok ? 'ready' : 'blocked',
    declared,
    rollbackEligible: declared.some((item) => item.state === 'rollback') || !verification.ok,
  };
}

function buildTruthBoundary(truthDecl, verification) {
  const boundary = truthDecl?.attributes.boundary ?? truthDecl?.name ?? 'local-only';
  return {
    boundary,
    externalWrite: truthDecl?.attributes.externalWrite === true,
    reportLevel: verification.ok ? 'verified' : 'diagnostic',
    claims: verification.diagnostics.map((item) => ({
      code: item.code,
      severity: item.severity,
      line: item.line,
    })),
  };
}

function isCompiledToolchainHealth(value) {
  return Boolean(
    value
    && value.ast?.type === 'ToolchainHealthProgram'
    && value.verification
    && value.jobDescriptor
    && value.runtimeAdapterRequest,
  );
}

function isToolchainHealthSnapshot(value) {
  return Boolean(
    value
    && value.type === 'ToolchainHealthSnapshot'
    && value.analytics
    && value.timeline
    && value.exportSummary,
  );
}

function countBy(items, key) {
  const counts = {};
  for (const item of items ?? []) {
    const rawKey = typeof key === 'function' ? key(item) : item?.[key];
    const countKey = rawKey == null ? 'unknown' : String(rawKey);
    counts[countKey] = (counts[countKey] ?? 0) + 1;
  }
  return sortObjectKeys(counts);
}

function sortObjectKeys(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function classifySnapshotTransition(previousSourceHash, sourceHash, ok) {
  if (!previousSourceHash) return ok ? 'initial-ready' : 'initial-blocked';
  if (previousSourceHash === sourceHash) return ok ? 'unchanged-ready' : 'unchanged-blocked';
  return ok ? 'changed-ready' : 'changed-blocked';
}

function selectNextTimelineAction(verification, jobDescriptor) {
  const lifecycleAction = selectLifecycleAction(verification, jobDescriptor);
  if (lifecycleAction.source === 'lifecycle') return lifecycleAction.action;

  if (verification.ok) {
    return jobDescriptor.runtimeHandoff ? 'handoff-runtime-adapter' : 'declare-runtime-adapter';
  }

  const firstError = verification.diagnostics.find((item) => item.severity === 'error');
  if (!firstError) return 'review-warnings';
  if (firstError.code === 'verify.capability.denied') return 'remove-denied-capability';
  if (firstError.code === 'verify.truth.external_write') return 'enforce-local-truth-boundary';
  if (firstError.code === 'verify.runtime.missing' || firstError.code === 'parse.runtime.missing') {
    return 'declare-runtime-adapter';
  }
  if (firstError.code === 'verify.source.missing') return 'declare-source-grammar';
  return 'resolve-verifier-diagnostics';
}

function verificationFromTruthBoundary(truthBoundary) {
  const claims = Array.isArray(truthBoundary?.claims) ? truthBoundary.claims : [];
  return {
    ok: truthBoundary?.reportLevel === 'verified' && !claims.some((item) => item.severity === 'error'),
    diagnostics: claims.map((item) => ({
      code: item.code,
      severity: item.severity,
      line: item.line,
    })),
  };
}

function selectLifecycleAction(verification, jobDescriptor) {
  const disabledControl = (jobDescriptor.controls ?? []).find((item) => !item.enabled);
  if (disabledControl) {
    return {
      action: `enable-control:${disabledControl.name}`,
      reason: disabledControl.reason ?? 'control-disabled',
      source: 'control',
    };
  }

  const enabledLifecycle = (jobDescriptor.lifecycle ?? []).filter((item) => item.enabled);
  const desiredWhen = verification.ok ? 'verified' : 'diagnostic';
  const matching = enabledLifecycle.find((item) => item.when === desiredWhen)
    ?? enabledLifecycle.find((item) => item.when === 'always')
    ?? null;

  if (matching) {
    const suffix = matching.control ? `:${matching.control}` : '';
    return {
      action: `${matching.command}${suffix}`,
      reason: `lifecycle:${matching.when}`,
      source: 'lifecycle',
    };
  }

  if (!verification.ok) {
    const firstError = verification.diagnostics.find((item) => item.severity === 'error');
    return {
      action: firstError ? 'resolve-verifier-diagnostics' : 'review-warnings',
      reason: firstError?.code ?? 'warning-only',
      source: 'verification',
    };
  }

  const activeSchedule = (jobDescriptor.schedule ?? []).find((item) => item.enabled && item.mode !== 'manual');
  if (activeSchedule) {
    return {
      action: `await-schedule:${activeSchedule.name}`,
      reason: `schedule:${activeSchedule.mode}`,
      source: 'schedule',
    };
  }

  return {
    action: jobDescriptor.runtimeHandoff ? 'handoff-runtime-adapter' : 'declare-runtime-adapter',
    reason: jobDescriptor.runtimeHandoff ? 'runtime-ready' : 'runtime-missing',
    source: 'runtime',
  };
}

function normalizeSnapshotSequence(snapshot, sequence) {
  if (snapshot.timeline.sequence === sequence) return snapshot;
  return {
    ...snapshot,
    timeline: {
      ...snapshot.timeline,
      sequence,
    },
  };
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
