export const surfaceId = "aios_capability-security_policy-evaluator_012";
export const surfaceGroup = "capability-security";
export const surfaceName = "policy-evaluator";

const DEFAULT_STALE_AFTER_MS = 60_000;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_HISTORY_SNAPSHOTS = 25;
const MIN_SCHEDULE_INTERVAL_MS = 5_000;
const MAX_SCHEDULE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

const LIFECYCLE_COMMANDS = new Set([
  'evaluate',
  'enable',
  'disable',
  'suspend',
  'resume',
  'dry-run',
  'reload-policies'
]);

const LIFECYCLE_SCHEDULE_COMMANDS = new Set(['suspend', 'resume', 'reload-policies']);
const LIFECYCLE_STATE_COMMANDS = new Set(['enable', 'disable', 'suspend', 'resume', 'reload-policies']);

const TRANSIENT_FAILURES = new Set([
  'policy_store_unavailable',
  'audit_sink_unavailable',
  'dependency_timeout',
  'kernel_state_unavailable',
  'provider_contract_unavailable',
  'external_handoff_unavailable',
  'operational_health_degraded',
  'policy_evaluator_circuit_open',
  'evaluation_queue_backlog',
  'validation_worker_unavailable',
  'policy_evaluator_no_recent_success',
  'operational_degraded_blocks_decision'
]);

const PROVIDER_CONTRACT_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.providerContracts.v1';
const EXTERNAL_HANDOFF_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.externalHandoff.v1';
const USER_PREVIEW_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.userPreview.v1';
const ACCEPTANCE_READINESS_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.acceptanceReadiness.v1';
const VALIDATION_SUMMARY_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.validationSummary.v1';
const NEXT_STEPS_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.nextSteps.v1';
const CLIENT_RUNTIME_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.clientRuntime.v1';
const CLIENT_REQUEST_STATE_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.clientRequestState.v1';
const WORKFLOW_HANDOFF_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.workflowHandoff.v1';
const CLIENT_REVIEW_PACKET_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.clientReviewPacket.v1';
const STATE_PERSISTENCE_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.statePersistence.v1';
const TENANT_BOUNDARY_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.tenantBoundary.v1';
const ROUTE_ACCEPTANCE_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.routeAcceptance.v1';
const ACCEPTANCE_REVIEW_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.acceptanceReview.v1';
const RECOVERY_PLAN_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.recoveryPlan.v1';
const WORKSPACE_GRANT_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.workspaceGrant.v1';
const OPERATIONAL_HEALTH_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.operationalHealth.v1';
const OPERATIONAL_RESPONSE_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.operationalResponse.v1';
const OPERATIONAL_DECISION_GATE_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.operationalDecisionGate.v1';
const PROOF_BUNDLE_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.proofBundle.v1';
const ANALYTICS_EXPORT_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.analyticsExport.v1';
const REPORTING_TIMELINE_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.reportingTimeline.v1';
const LIFECYCLE_EXECUTION_CONTROL_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.lifecycleExecutionControls.v1';
const LIFECYCLE_TRANSITION_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.lifecycleTransition.v1';
const STATE_MUTATION_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.stateMutation.v1';
const PROVIDER_NEGOTIATION_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.providerNegotiation.v1';
const PROVIDER_SYNC_STATUS_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.providerSyncStatus.v1';
const AUTHORIZATION_SCOPE_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.authorizationScope.v1';
const CAPABILITY_OPERATION_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.capabilityOperation.v1';
const TARGET_BOUNDARY_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.targetBoundary.v1';
const OPERATION_GUARDRAIL_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.operationGuardrails.v1';
const OPERATION_REVIEW_SCHEMA = 'aios.capabilitySecurity.policyEvaluator.operationReview.v1';

const ACCEPTANCE_ACTIONS = new Set(['accept', 'deny', 'request-changes']);
const DECISION_CLASSES = new Set(['syscall', 'file', 'shell', 'deploy', 'external-write', 'general']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(asObject(object), key);
}

function normalizeCapabilityRequest(input) {
  const request = asObject(input.capabilityRequest || input.request);
  const context = asObject(request.context || input.requestContext || input.context);
  const principal = request.principal || input.principal || 'anonymous';
  const capability = request.capability || input.capability || null;
  const route = request.route || input.route || 'unknown-route';
  const purpose = request.purpose || input.purpose || 'unspecified';
  const tenantId = request.tenantId || context.tenantId || input.tenantId || null;
  const workspaceId = request.workspaceId || context.workspaceId || input.workspaceId || null;
  return {
    id: request.id || input.requestId || `${principal}:${capability || 'missing'}:${route}`,
    principal,
    capability,
    route,
    purpose,
    tenantId,
    workspaceId,
    roles: normalizeStringList(request.roles || context.roles || input.roles),
    permissions: normalizeStringList(request.permissions || context.permissions || input.permissions),
    attributes: asObject(request.attributes)
  };
}

function normalizeDecisionClass(value, capability) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (DECISION_CLASSES.has(normalized)) return normalized;
  const capabilityText = String(capability || '').toLowerCase();
  if (capabilityText.includes('syscall')) return 'syscall';
  if (capabilityText.includes('external-write') || capabilityText.includes('external_write')) return 'external-write';
  if (capabilityText.includes('deploy')) return 'deploy';
  if (capabilityText.includes('shell') || capabilityText.includes('command')) return 'shell';
  if (capabilityText.includes('file') || capabilityText.includes('fs.')) return 'file';
  return 'general';
}

function normalizeOperationTargets(value) {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (entry && typeof entry === 'object') return entry.path || entry.url || entry.host || entry.name || entry.target || '';
      return '';
    })
    .filter(Boolean);
}

function normalizePathSegments(pathname) {
  const source = String(pathname || '').replaceAll('\\', '/');
  const absolute = source.startsWith('/');
  const trailingSlash = source.endsWith('/') && source.length > 1;
  const segments = [];
  let traversalCount = 0;
  let escapedRoot = false;

  for (const segment of source.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      traversalCount += 1;
      if (segments.length > 0) {
        segments.pop();
      } else {
        escapedRoot = true;
      }
      continue;
    }
    segments.push(segment);
  }

  const normalized = `${absolute ? '/' : ''}${segments.join('/')}${trailingSlash && segments.length > 0 ? '/' : ''}`;
  return {
    normalized: normalized || (absolute ? '/' : '.'),
    traversalCount,
    escapedRoot
  };
}

function normalizeOperationTarget(target) {
  const raw = String(target || '').trim();
  if (!raw) {
    return {
      raw,
      normalized: '',
      kind: 'empty',
      traversalCount: 0,
      escapedRoot: false,
      changed: false
    };
  }

  const urlMatch = raw.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i);
  if (urlMatch) {
    const [, scheme, authority, pathname = '/', search = ''] = urlMatch;
    const path = normalizePathSegments(pathname || '/');
    const normalized = `${scheme.toLowerCase()}://${authority.toLowerCase()}${path.normalized}${search || ''}`;
    return {
      raw,
      normalized,
      kind: 'url',
      traversalCount: path.traversalCount,
      escapedRoot: path.escapedRoot,
      changed: normalized !== raw
    };
  }

  const hostLike = /^[a-z0-9.-]+(?::\d+)?$/i.test(raw) && raw.includes('.');
  if (hostLike) {
    const normalized = raw.toLowerCase();
    return {
      raw,
      normalized,
      kind: 'host',
      traversalCount: 0,
      escapedRoot: false,
      changed: normalized !== raw
    };
  }

  const path = normalizePathSegments(raw);
  return {
    raw,
    normalized: path.normalized,
    kind: 'path',
    traversalCount: path.traversalCount,
    escapedRoot: path.escapedRoot,
    changed: path.normalized !== raw
  };
}

function normalizePolicyTargetPattern(pattern) {
  const raw = String(pattern || '').trim();
  if (!raw || raw === '*') return raw || '*';
  const wildcard = raw.endsWith('*');
  const base = wildcard ? raw.slice(0, -1) : raw;
  const normalized = normalizeOperationTarget(base).normalized;
  return `${normalized}${wildcard ? '*' : ''}`;
}

function normalizePolicyTargetPatterns(value) {
  const patterns = normalizeStringList(value);
  return patterns.length > 0 ? patterns.map(normalizePolicyTargetPattern) : [];
}

function buildTargetBoundary(rawTargets, path, externalHost, deploymentTarget) {
  const targetInputs = [
    ...rawTargets,
    ...(path ? [path] : []),
    ...(externalHost ? [externalHost] : []),
    ...(deploymentTarget ? [deploymentTarget] : [])
  ];
  const targetDetails = targetInputs
    .map(normalizeOperationTarget)
    .filter((target) => target.normalized);
  const normalizedTargets = [...new Set(targetDetails.map((target) => target.normalized))];
  const unsafeTargets = targetDetails.filter((target) => target.escapedRoot);
  const traversalTargets = targetDetails.filter((target) => target.traversalCount > 0);

  return {
    schema: TARGET_BOUNDARY_SCHEMA,
    rawTargets: [...new Set(targetDetails.map((target) => target.raw))],
    normalizedTargets,
    targetDetails,
    canonicalizationRequired: targetDetails.some((target) => target.changed),
    traversalDetected: traversalTargets.length > 0,
    unsafeRelativeTraversal: unsafeTargets.length > 0,
    unsafeTargetCount: unsafeTargets.length,
    traversalTargetCount: traversalTargets.length,
    matchingMode: 'canonical-prefix',
    status: unsafeTargets.length > 0 ? 'blocked' : traversalTargets.length > 0 ? 'canonicalized' : 'stable'
  };
}

function normalizeCapabilityOperation(input, request) {
  const source = asObject(input.operation || input.capabilityOperation || request.attributes.operation);
  const effects = normalizeStringList(source.effects || source.effect || input.effects);
  const rawTargets = normalizeOperationTargets(source.targets || source.target || source.paths || source.path || source.url || input.targets);
  const decisionClass = normalizeDecisionClass(source.class || source.type || source.decisionClass || input.decisionClass, request.capability);
  const rawCommand = source.command || request.attributes.command || input.commandLine || null;
  const syscall = source.syscall || request.attributes.syscall || input.syscall || null;
  const path = source.path || request.attributes.path || input.path || rawTargets[0] || null;
  const externalHost = source.host || source.hostname || source.domain || request.attributes.host || input.host || null;
  const deploymentTarget = source.environment || source.deploymentTarget || source.targetEnvironment || input.deploymentTarget || null;
  const targetBoundary = buildTargetBoundary(rawTargets, path, externalHost, deploymentTarget);
  const targets = targetBoundary.normalizedTargets;
  const mutating = Boolean(
    source.mutating
    || source.write
    || effects.some((effect) => ['write', 'delete', 'execute', 'deploy', 'network-write', 'external-write'].includes(effect))
    || ['shell', 'deploy', 'external-write'].includes(decisionClass)
  );
  const requiresExternalHandoff = Boolean(
    source.requiresExternalHandoff
    || input.requireExternalHandoff
    || decisionClass === 'deploy'
    || decisionClass === 'external-write'
  );

  return {
    schema: CAPABILITY_OPERATION_SCHEMA,
    decisionClass,
    mutating,
    requiresExternalHandoff,
    effects,
    rawTargets: targetBoundary.rawTargets,
    targets,
    syscall,
    command: rawCommand,
    path,
    externalHost,
    deploymentTarget,
    targetBoundary,
    routeDomain: decisionClass === 'syscall'
      ? 'hosted-kernel.syscall'
      : decisionClass === 'file'
        ? 'hosted-kernel.filesystem'
        : decisionClass === 'shell'
          ? 'hosted-kernel.shell'
          : decisionClass === 'deploy'
            ? 'hosted-kernel.deploy'
            : decisionClass === 'external-write'
              ? 'hosted-kernel.external-write'
              : 'hosted-kernel.capability',
    auditFingerprint: contractFingerprint({
      schema: CAPABILITY_OPERATION_SCHEMA,
      requestId: request.id,
      decisionClass,
      mutating,
      effects,
      rawTargets: targetBoundary.rawTargets,
      targets,
      syscall,
      command: rawCommand,
      path,
      externalHost,
      deploymentTarget,
      targetBoundaryStatus: targetBoundary.status
    })
  };
}

function normalizePolicies(input) {
  const policies = Array.isArray(input.policies) ? input.policies : [];
  return policies
    .filter((policy) => policy && typeof policy === 'object')
    .map((policy, index) => ({
      id: policy.id || `inline-policy-${index + 1}`,
      capability: policy.capability || '*',
      effect: policy.effect === 'deny' ? 'deny' : 'allow',
      principals: Array.isArray(policy.principals) ? policy.principals : ['*'],
      routes: Array.isArray(policy.routes) ? policy.routes : ['*'],
      tenants: normalizeStringList(policy.tenants || policy.tenantIds || policy.tenantId).length > 0
        ? normalizeStringList(policy.tenants || policy.tenantIds || policy.tenantId)
        : ['*'],
      workspaces: normalizeStringList(policy.workspaces || policy.workspaceIds || policy.workspaceId).length > 0
        ? normalizeStringList(policy.workspaces || policy.workspaceIds || policy.workspaceId)
        : ['*'],
      roles: normalizeStringList(policy.roles || policy.requiredRoles).length > 0
        ? normalizeStringList(policy.roles || policy.requiredRoles)
        : ['*'],
      permissions: normalizeStringList(policy.permissions || policy.requiredPermissions).length > 0
        ? normalizeStringList(policy.permissions || policy.requiredPermissions)
        : ['*'],
      decisionClasses: normalizeStringList(policy.decisionClasses || policy.operationClasses || policy.decisionClass || policy.operationClass).length > 0
        ? normalizeStringList(policy.decisionClasses || policy.operationClasses || policy.decisionClass || policy.operationClass).map((entry) => normalizeDecisionClass(entry, policy.capability))
        : ['*'],
      effects: normalizeStringList(policy.effects || policy.allowedEffects || policy.requiredEffects).length > 0
        ? normalizeStringList(policy.effects || policy.allowedEffects || policy.requiredEffects)
        : ['*'],
      targetPatterns: normalizePolicyTargetPatterns(policy.targets || policy.targetPatterns || policy.paths || policy.pathPatterns).length > 0
        ? normalizePolicyTargetPatterns(policy.targets || policy.targetPatterns || policy.paths || policy.pathPatterns)
        : ['*'],
      boundary: {
        allowCrossTenant: Boolean(policy.allowCrossTenant || policy.boundary?.allowCrossTenant),
        allowWorkspaceWildcard: policy.allowWorkspaceWildcard !== false && policy.boundary?.allowWorkspaceWildcard !== false
      },
      reason: policy.reason || 'policy matched hosted-kernel capability request'
    }));
}

function parseTimestampMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLifecycleSettings(input, nowMs) {
  const settings = asObject(input.lifecycleSettings || input.settings?.lifecycle);
  const schedule = asObject(settings.schedule || input.schedule);
  const controls = asObject(settings.controls);
  const commandExplicit = Boolean(settings.command || input.lifecycleCommand || input.command);
  const rawCommand = settings.command || input.lifecycleCommand || input.command || 'evaluate';
  const command = String(rawCommand).trim().toLowerCase();
  const intervalMs = Number(schedule.intervalMs ?? settings.intervalMs);
  const nextEvaluationAt = schedule.nextEvaluationAt || settings.nextEvaluationAt || null;
  const pausedUntil = schedule.pausedUntil || settings.pausedUntil || null;
  const nextEvaluationAtMs = parseTimestampMs(nextEvaluationAt);
  const pausedUntilMs = parseTimestampMs(pausedUntil);
  const maxSuspensionMs = Number(controls.maxSuspensionMs ?? settings.maxSuspensionMs);
  const scheduleEnabledSpecified = hasOwn(schedule, 'enabled') || hasOwn(settings, 'scheduleEnabled');
  const enabledSpecified = hasOwn(settings, 'enabled') || hasOwn(input, 'enabled');
  const enabled = settings.enabled ?? input.enabled;
  const mode = settings.mode === 'monitor' ? 'monitor' : 'enforce';
  const scheduleEnabled = Boolean(schedule.enabled ?? settings.scheduleEnabled);
  const dryRun = Boolean(settings.dryRun || command === 'dry-run' || mode === 'monitor');
  const dueNow = !scheduleEnabled || !nextEvaluationAtMs || nextEvaluationAtMs <= nowMs;
  const suspended = Boolean(pausedUntilMs && pausedUntilMs > nowMs);
  const scheduleWindowChanged = Boolean(nextEvaluationAt || pausedUntil || Number.isFinite(intervalMs));
  const scheduleMutationRequested = Boolean(scheduleEnabledSpecified || scheduleWindowChanged || LIFECYCLE_SCHEDULE_COMMANDS.has(command));
  const evaluatorStateMutationRequested = Boolean(enabledSpecified || LIFECYCLE_STATE_COMMANDS.has(command));

  return {
    schema: 'aios.capabilitySecurity.policyEvaluator.lifecycle.v1',
    command,
    commandExplicit,
    enabled: enabled !== false,
    mode,
    dryRun,
    schedule: {
      enabled: scheduleEnabled,
      enabledSpecified: scheduleEnabledSpecified,
      intervalMs: Number.isFinite(intervalMs) ? intervalMs : null,
      nextEvaluationAt,
      nextEvaluationAtMs,
      pausedUntil,
      pausedUntilMs,
      dueNow,
      suspended,
      mutationRequested: scheduleMutationRequested,
      windowChanged: scheduleWindowChanged
    },
    controls: {
      allowDisable: controls.allowDisable !== false,
      allowEnable: controls.allowEnable !== false,
      allowScheduleMutation: controls.allowScheduleMutation !== false,
      allowImmediateEvaluation: controls.allowImmediateEvaluation !== false,
      allowSuspend: controls.allowSuspend !== false,
      allowResume: controls.allowResume !== false,
      allowDryRun: controls.allowDryRun !== false,
      requireReasonForDisable: controls.requireReasonForDisable !== false,
      requireReasonForEnable: Boolean(controls.requireReasonForEnable),
      requireReasonForScheduleChange: Boolean(controls.requireReasonForScheduleChange),
      reason: settings.reason || input.reason || null,
      scheduleChangeReason: settings.scheduleChangeReason || controls.scheduleChangeReason || input.scheduleChangeReason || settings.reason || input.reason || null,
      requestedBy: settings.requestedBy || input.requestedBy || 'kernel',
      failClosedOnDisabled: controls.failClosedOnDisabled !== false,
      maxSuspensionMs: Number.isFinite(maxSuspensionMs) && maxSuspensionMs > 0 ? maxSuspensionMs : null
    },
    intent: {
      enabledSpecified,
      scheduleEnabledSpecified,
      evaluatorStateMutationRequested,
      scheduleMutationRequested
    }
  };
}

function validateLifecycleSettings(lifecycle, nowMs) {
  const errors = [];
  const scheduleMutationRequested = lifecycle.intent.scheduleMutationRequested;
  if (!LIFECYCLE_COMMANDS.has(lifecycle.command)) {
    errors.push(actionableError('invalid_lifecycle_command', 'Unsupported lifecycle command', 'Use evaluate, enable, disable, suspend, resume, dry-run, or reload-policies.'));
  }
  if (lifecycle.command === 'enable' && !lifecycle.controls.allowEnable) {
    errors.push(actionableError('enable_not_allowed', 'Enable command is blocked by lifecycle controls', 'Enable controls.allowEnable or remove the enable lifecycle command.'));
  }
  if (lifecycle.command === 'enable' && lifecycle.controls.requireReasonForEnable && !lifecycle.controls.reason) {
    errors.push(actionableError('enable_reason_required', 'Enable command requires a reason', 'Attach lifecycleSettings.reason for the hosted-kernel lifecycle audit trail.'));
  }
  if (lifecycle.command === 'disable' && !lifecycle.controls.allowDisable) {
    errors.push(actionableError('disable_not_allowed', 'Disable command is blocked by lifecycle controls', 'Enable allowDisable or use suspend for a temporary policy-evaluator pause.'));
  }
  if (lifecycle.command === 'disable' && lifecycle.controls.requireReasonForDisable && !lifecycle.controls.reason) {
    errors.push(actionableError('disable_reason_required', 'Disable command requires a reason', 'Attach lifecycleSettings.reason for the hosted-kernel audit trail.'));
  }
  if (lifecycle.command === 'suspend' && !lifecycle.controls.allowSuspend) {
    errors.push(actionableError('suspend_not_allowed', 'Suspend command is blocked by lifecycle controls', 'Enable controls.allowSuspend or remove the suspend lifecycle command.'));
  }
  if (lifecycle.command === 'resume' && !lifecycle.controls.allowResume) {
    errors.push(actionableError('resume_not_allowed', 'Resume command is blocked by lifecycle controls', 'Enable controls.allowResume or remove the resume lifecycle command.'));
  }
  if (lifecycle.command === 'dry-run' && !lifecycle.controls.allowDryRun) {
    errors.push(actionableError('dry_run_not_allowed', 'Dry-run command is blocked by lifecycle controls', 'Enable controls.allowDryRun or use enforce mode evaluation.'));
  }
  if (scheduleMutationRequested && !lifecycle.controls.allowScheduleMutation) {
    errors.push(actionableError('schedule_mutation_not_allowed', 'Lifecycle schedule changes are blocked by controls', 'Enable controls.allowScheduleMutation or remove schedule-changing lifecycle settings.'));
  }
  if (scheduleMutationRequested && lifecycle.controls.requireReasonForScheduleChange && !lifecycle.controls.scheduleChangeReason) {
    errors.push(actionableError('schedule_change_reason_required', 'Schedule changes require a reason', 'Attach lifecycleSettings.scheduleChangeReason for the hosted-kernel lifecycle audit trail.'));
  }
  if (lifecycle.commandExplicit && lifecycle.command === 'evaluate' && lifecycle.schedule.enabled && !lifecycle.schedule.dueNow && !lifecycle.controls.allowImmediateEvaluation) {
    errors.push(actionableError('immediate_evaluation_not_allowed', 'Immediate evaluation is blocked until the scheduled window', 'Wait until nextEvaluationAt or enable controls.allowImmediateEvaluation for explicit override evaluation.'));
  }
  if (!lifecycle.enabled && lifecycle.controls.failClosedOnDisabled && lifecycle.command !== 'enable') {
    errors.push(actionableError('policy_evaluator_disabled', 'Policy evaluator is disabled', 'Enable the evaluator before granting hosted-kernel capabilities.'));
  }
  if (lifecycle.schedule.enabled && lifecycle.schedule.intervalMs !== null && lifecycle.schedule.intervalMs < MIN_SCHEDULE_INTERVAL_MS) {
    errors.push(actionableError('schedule_interval_too_short', 'Policy evaluation schedule interval is too short', `Use an interval of at least ${MIN_SCHEDULE_INTERVAL_MS}ms.`));
  }
  if (lifecycle.schedule.enabled && lifecycle.schedule.intervalMs !== null && lifecycle.schedule.intervalMs > MAX_SCHEDULE_INTERVAL_MS) {
    errors.push(actionableError('schedule_interval_too_long', 'Policy evaluation schedule interval is too long', `Use an interval of at most ${MAX_SCHEDULE_INTERVAL_MS}ms.`));
  }
  if (lifecycle.schedule.enabled && lifecycle.schedule.nextEvaluationAt && lifecycle.schedule.nextEvaluationAtMs === null) {
    errors.push(actionableError('invalid_next_evaluation_at', 'nextEvaluationAt is not a valid timestamp', 'Provide lifecycleSettings.schedule.nextEvaluationAt as an ISO timestamp.'));
  }
  if (lifecycle.schedule.pausedUntil && lifecycle.schedule.pausedUntilMs === null) {
    errors.push(actionableError('invalid_paused_until', 'pausedUntil is not a valid timestamp', 'Provide lifecycleSettings.schedule.pausedUntil as an ISO timestamp.'));
  }
  if (lifecycle.command === 'suspend' && !lifecycle.schedule.pausedUntilMs) {
    errors.push(actionableError('suspend_until_required', 'Suspend command requires a pausedUntil timestamp', 'Attach lifecycleSettings.schedule.pausedUntil so the hosted kernel can automatically resume evaluation.'));
  }
  if (lifecycle.command === 'suspend' && lifecycle.schedule.pausedUntilMs !== null && !lifecycle.schedule.suspended) {
    errors.push(actionableError('suspend_until_not_future', 'Suspend command pausedUntil must be in the future', 'Choose a pausedUntil timestamp later than the current evaluation time.'));
  }
  if (lifecycle.command === 'suspend' && lifecycle.controls.maxSuspensionMs !== null && lifecycle.schedule.pausedUntilMs !== null) {
    const suspensionMs = lifecycle.schedule.pausedUntilMs - nowMs;
    if (suspensionMs > lifecycle.controls.maxSuspensionMs) {
      errors.push(actionableError('suspend_window_too_long', 'Suspend command exceeds the maximum allowed suspension window', `Choose a pausedUntil timestamp within ${lifecycle.controls.maxSuspensionMs}ms or raise controls.maxSuspensionMs.`));
    }
  }
  if (lifecycle.command === 'resume' && lifecycle.schedule.pausedUntil && !lifecycle.schedule.suspended) {
    errors.push(actionableError('resume_without_active_suspend', 'Resume command does not have an active suspension window', 'Use evaluate for normal policy checks or provide an active pausedUntil suspension to clear.'));
  }
  if (lifecycle.schedule.enabled && lifecycle.schedule.intervalMs === null) {
    errors.push(actionableError('schedule_interval_required', 'Scheduled evaluation requires an intervalMs value', 'Attach lifecycleSettings.schedule.intervalMs so the next evaluation window can be calculated.', 'warning'));
  }
  if (lifecycle.schedule.suspended) {
    errors.push(actionableError('policy_evaluator_suspended', 'Policy evaluator is suspended', 'Resume the evaluator or wait until pausedUntil before granting capabilities.', 'warning'));
  }
  if (lifecycle.schedule.enabled && !lifecycle.schedule.dueNow) {
    const severity = lifecycle.commandExplicit && lifecycle.command === 'evaluate' ? 'warning' : 'error';
    errors.push(actionableError('evaluation_not_due', 'Policy evaluation is scheduled for a future time', 'Wait until nextEvaluationAt or issue an explicit evaluate command.', severity));
  }
  return errors;
}

function operationTargetsMatch(patterns, targets) {
  if (listHasWildcard(patterns)) return true;
  if (targets.length === 0) return false;
  return targets.some((target) => patterns.some((pattern) => {
    if (pattern.endsWith('*')) return target.startsWith(pattern.slice(0, -1));
    return pattern === target;
  }));
}

function policyMatchesOperation(policy, operation) {
  const decisionClassMatch = matchValue(policy.decisionClasses, operation.decisionClass);
  const effectMatch = listHasWildcard(policy.effects)
    || operation.effects.length === 0
    || intersects(policy.effects, operation.effects);
  const targetMatch = operationTargetsMatch(policy.targetPatterns, operation.targets);

  return {
    decisionClassMatch,
    effectMatch,
    targetMatch,
    matched: decisionClassMatch && effectMatch && targetMatch
  };
}

function validateCapabilityOperation(operation, input) {
  const controls = asObject(input.operationControls || input.capabilityOperationControls);
  const failures = [];
  const requireTargetsForWrites = controls.requireTargetsForWrites !== false;
  const requireShellCommand = controls.requireShellCommand !== false;
  const requireDeployTarget = controls.requireDeployTarget !== false;
  const allowExternalWriteWithoutHandoff = Boolean(controls.allowExternalWriteWithoutHandoff);
  const allowUnsafeRelativeTargets = Boolean(controls.allowUnsafeRelativeTargets);

  if (operation.decisionClass === 'syscall' && !operation.syscall && operation.effects.length === 0) {
    failures.push(actionableError('syscall_identifier_required', 'Syscall capability decisions require a syscall name or effect', 'Attach operation.syscall or operation.effects so the evaluator can bind the syscall decision.'));
  }
  if (operation.targetBoundary.unsafeRelativeTraversal && !allowUnsafeRelativeTargets) {
    failures.push(actionableError(
      'operation_target_escapes_boundary',
      'Operation target escapes its canonical policy boundary',
      'Provide normalized in-bound targets or set operationControls.allowUnsafeRelativeTargets only for legacy read-only simulation.',
      'error',
      {
        targetBoundarySchema: operation.targetBoundary.schema,
        unsafeTargetCount: operation.targetBoundary.unsafeTargetCount,
        rawTargets: operation.targetBoundary.rawTargets,
        normalizedTargets: operation.targetBoundary.normalizedTargets
      }
    ));
  }
  if (operation.decisionClass === 'file' && requireTargetsForWrites && operation.mutating && !operation.path && operation.targets.length === 0) {
    failures.push(actionableError('file_write_target_required', 'File write decisions require a concrete target path', 'Attach operation.path or operation.targets before granting mutating file capabilities.'));
  }
  if (operation.decisionClass === 'shell' && requireShellCommand && !operation.command) {
    failures.push(actionableError('shell_command_required', 'Shell decisions require the command being evaluated', 'Attach operation.command so policy review and audit proof cover the exact shell execution.'));
  }
  if (operation.decisionClass === 'deploy' && requireDeployTarget && !operation.deploymentTarget) {
    failures.push(actionableError('deploy_target_required', 'Deploy decisions require a deployment target', 'Attach operation.deploymentTarget or operation.environment before granting deploy capabilities.'));
  }
  if (operation.decisionClass === 'external-write' && !operation.externalHost && operation.targets.length === 0) {
    failures.push(actionableError('external_write_target_required', 'External write decisions require a host or target', 'Attach operation.host or operation.targets before granting external write capabilities.'));
  }
  if (operation.decisionClass === 'external-write' && operation.requiresExternalHandoff && !allowExternalWriteWithoutHandoff && input.requireExternalHandoff === false) {
    failures.push(actionableError('external_write_handoff_required', 'External write decisions require external handoff controls', 'Enable requireExternalHandoff or set operationControls.allowExternalWriteWithoutHandoff for explicitly local simulations.'));
  }

  return failures;
}

function shellCommandSignals(command) {
  const text = String(command || '');
  if (!text) {
    return {
      hasCommand: false,
      multiline: false,
      shellExpansion: false,
      pipelineOrRedirect: false,
      privileged: false,
      destructive: false,
      remoteInstaller: false
    };
  }
  return {
    hasCommand: true,
    multiline: /\r|\n/.test(text),
    shellExpansion: /[`$][({]?/.test(text),
    pipelineOrRedirect: /(^|[^|])\|([^|]|$)|[<>]/.test(text),
    privileged: /\b(?:sudo|su|doas|chmod\s+777|chown)\b/.test(text),
    destructive: /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b|:\s*>\s*\//.test(text),
    remoteInstaller: /\b(?:curl|wget)\b[\s\S]*(?:\||\bsh\b|\bbash\b)/.test(text)
  };
}

function buildOperationGuardrails(input, operation, matchedPolicies) {
  const controls = asObject(input.operationGuardrails || input.decisionClassControls || input.capabilityOperationControls);
  const allowPolicies = matchedPolicies.filter((policy) => policy.effect === 'allow');
  const broadAllowPolicies = allowPolicies.filter((policy) => listHasWildcard(policy.targetPatterns));
  const targetKinds = [...new Set(operation.targetBoundary.targetDetails.map((target) => target.kind))];
  const targetlessMutating = operation.mutating && operation.targets.length === 0;
  const wildcardMutatingAllow = operation.mutating
    && broadAllowPolicies.length > 0
    && controls.allowWildcardMutatingTargets !== true;
  const classRequiresConcreteTarget = operation.mutating
    && ['file', 'shell', 'deploy', 'external-write'].includes(operation.decisionClass)
    && controls.requireConcreteMutatingTarget !== false;
  const shellSignals = shellCommandSignals(operation.command);
  const productionDeploy = operation.decisionClass === 'deploy'
    && /\b(?:prod|production|live)\b/i.test(String(operation.deploymentTarget || operation.targets.join(' ')));
  const externalWriteHasNetworkTarget = operation.decisionClass !== 'external-write'
    || Boolean(operation.externalHost)
    || operation.targetBoundary.targetDetails.some((target) => target.kind === 'url' || target.kind === 'host');
  const guardrailFailures = [];

  if (classRequiresConcreteTarget && targetlessMutating) {
    guardrailFailures.push(actionableError(
      'mutating_operation_target_required',
      'Mutating capability decisions require a concrete operation target',
      'Attach operation.targets, operation.path, operation.host, or operation.deploymentTarget so the matched policy is not targetless.',
      'error',
      { guardrailSchema: OPERATION_GUARDRAIL_SCHEMA, decisionClass: operation.decisionClass }
    ));
  }
  if (wildcardMutatingAllow) {
    guardrailFailures.push(actionableError(
      'wildcard_mutating_policy_blocked',
      'Wildcard target allow policies cannot grant mutating capability decisions by default',
      'Publish target-scoped allow policies for file, shell, deploy, and external-write mutations, or set operationGuardrails.allowWildcardMutatingTargets for an audited exception.',
      'error',
      {
        guardrailSchema: OPERATION_GUARDRAIL_SCHEMA,
        broadAllowPolicyIds: broadAllowPolicies.map((policy) => policy.id),
        decisionClass: operation.decisionClass
      }
    ));
  }
  if (operation.decisionClass === 'shell' && shellSignals.multiline && controls.allowMultilineShellCommand !== true) {
    guardrailFailures.push(actionableError(
      'multiline_shell_command_blocked',
      'Shell capability decisions require a single command line by default',
      'Split multiline shell execution into reviewed operations or set operationGuardrails.allowMultilineShellCommand for an audited exception.',
      'error',
      { guardrailSchema: OPERATION_GUARDRAIL_SCHEMA }
    ));
  }
  if (operation.decisionClass === 'shell' && shellSignals.remoteInstaller && controls.allowRemoteInstallerShellCommand !== true) {
    guardrailFailures.push(actionableError(
      'remote_installer_shell_command_blocked',
      'Shell command pipes remote content into an interpreter',
      'Replace remote installer shell pipelines with a reviewed artifact or set operationGuardrails.allowRemoteInstallerShellCommand for an audited exception.',
      'error',
      { guardrailSchema: OPERATION_GUARDRAIL_SCHEMA }
    ));
  }
  if (operation.decisionClass === 'shell' && (shellSignals.shellExpansion || shellSignals.pipelineOrRedirect || shellSignals.privileged || shellSignals.destructive)) {
    guardrailFailures.push(actionableError(
      'shell_command_requires_elevated_review',
      'Shell command contains elevated-risk shell features',
      'Review shell expansion, pipes, redirects, privileged commands, or destructive flags before acceptance.',
      controls.blockElevatedShellFeatures === true ? 'error' : 'warning',
      { guardrailSchema: OPERATION_GUARDRAIL_SCHEMA, shellSignals }
    ));
  }
  if (productionDeploy && !operation.effects.includes('deploy') && controls.allowImplicitProductionDeploy !== true) {
    guardrailFailures.push(actionableError(
      'production_deploy_effect_required',
      'Production deploy decisions require an explicit deploy effect',
      'Attach operation.effects=["deploy"] for production or live deployment targets.',
      'error',
      { guardrailSchema: OPERATION_GUARDRAIL_SCHEMA, deploymentTarget: operation.deploymentTarget }
    ));
  }
  if (!externalWriteHasNetworkTarget && controls.allowPathOnlyExternalWrite !== true) {
    guardrailFailures.push(actionableError(
      'external_write_network_target_required',
      'External write decisions require a host or URL target',
      'Attach operation.host or a URL/host target so external-write policy evaluation binds to a network destination.',
      'error',
      { guardrailSchema: OPERATION_GUARDRAIL_SCHEMA, targetKinds }
    ));
  }

  const blockingCodes = guardrailFailures.filter((failure) => failure.severity === 'error').map((failure) => failure.code);
  const warningCodes = guardrailFailures.filter((failure) => failure.severity === 'warning').map((failure) => failure.code);

  return {
    schema: OPERATION_GUARDRAIL_SCHEMA,
    decisionClass: operation.decisionClass,
    routeDomain: operation.routeDomain,
    mutating: operation.mutating,
    targetKinds,
    targetCount: operation.targets.length,
    matchedAllowPolicyIds: allowPolicies.map((policy) => policy.id),
    broadAllowPolicyIds: broadAllowPolicies.map((policy) => policy.id),
    controls: {
      requireConcreteMutatingTarget: controls.requireConcreteMutatingTarget !== false,
      allowWildcardMutatingTargets: controls.allowWildcardMutatingTargets === true,
      allowMultilineShellCommand: controls.allowMultilineShellCommand === true,
      allowRemoteInstallerShellCommand: controls.allowRemoteInstallerShellCommand === true,
      blockElevatedShellFeatures: controls.blockElevatedShellFeatures === true,
      allowImplicitProductionDeploy: controls.allowImplicitProductionDeploy === true,
      allowPathOnlyExternalWrite: controls.allowPathOnlyExternalWrite === true
    },
    shellSignals,
    productionDeploy,
    externalWriteHasNetworkTarget,
    status: blockingCodes.length > 0 ? 'blocked' : warningCodes.length > 0 ? 'review_required' : 'passed',
    blockingCodes,
    warningCodes,
    failures: guardrailFailures
  };
}

function buildLifecycleExecutionControls(lifecycle, failures, commandPlan, nowMs) {
  const blockingCodes = new Set(failures.filter((failure) => failure.severity === 'error').map((failure) => failure.code));
  const scheduleMutationCommand = LIFECYCLE_SCHEDULE_COMMANDS.has(lifecycle.command);
  const schedulePatchChangesWindow = Boolean(
    commandPlan.schedulePatch.nextEvaluationAt !== lifecycle.schedule.nextEvaluationAt
    || commandPlan.schedulePatch.pausedUntil !== lifecycle.schedule.pausedUntil
    || commandPlan.schedulePatch.enabledSpecified
  );
  const scheduleMutationRequested = Boolean(
    lifecycle.intent.scheduleMutationRequested
    || scheduleMutationCommand
    || schedulePatchChangesWindow
    || lifecycle.schedule.intervalMs !== null
  );
  const immediateOverrideRequested = Boolean(
    lifecycle.commandExplicit
    && lifecycle.command === 'evaluate'
    && lifecycle.schedule.enabled
    && !lifecycle.schedule.dueNow
  );
  const suspensionDurationMs = lifecycle.command === 'suspend' && lifecycle.schedule.pausedUntilMs
    ? Math.max(0, lifecycle.schedule.pausedUntilMs - nowMs)
    : null;
  const deniedControlCodes = [
    ...(!lifecycle.controls.allowEnable && lifecycle.command === 'enable' ? ['enable_not_allowed'] : []),
    ...(!lifecycle.controls.allowDisable && lifecycle.command === 'disable' ? ['disable_not_allowed'] : []),
    ...(!lifecycle.controls.allowSuspend && lifecycle.command === 'suspend' ? ['suspend_not_allowed'] : []),
    ...(!lifecycle.controls.allowResume && lifecycle.command === 'resume' ? ['resume_not_allowed'] : []),
    ...(!lifecycle.controls.allowDryRun && lifecycle.command === 'dry-run' ? ['dry_run_not_allowed'] : []),
    ...(!lifecycle.controls.allowScheduleMutation && scheduleMutationRequested ? ['schedule_mutation_not_allowed'] : []),
    ...(!lifecycle.controls.allowImmediateEvaluation && immediateOverrideRequested ? ['immediate_evaluation_not_allowed'] : []),
    ...(lifecycle.controls.requireReasonForEnable && lifecycle.command === 'enable' && !lifecycle.controls.reason ? ['enable_reason_required'] : []),
    ...(lifecycle.controls.requireReasonForDisable && lifecycle.command === 'disable' && !lifecycle.controls.reason ? ['disable_reason_required'] : []),
    ...(lifecycle.controls.requireReasonForScheduleChange && scheduleMutationRequested && !lifecycle.controls.scheduleChangeReason ? ['schedule_change_reason_required'] : []),
    ...(lifecycle.controls.maxSuspensionMs !== null && suspensionDurationMs !== null && suspensionDurationMs > lifecycle.controls.maxSuspensionMs ? ['suspend_window_too_long'] : [])
  ];
  const commitPrerequisites = [
    {
      id: 'command_valid',
      satisfied: !blockingCodes.has('invalid_lifecycle_command'),
      requiredFor: 'all_lifecycle_commands'
    },
    {
      id: 'control_policy_allows_command',
      satisfied: deniedControlCodes.length === 0,
      requiredFor: lifecycle.command
    },
    {
      id: 'schedule_window_ready',
      satisfied: lifecycle.schedule.dueNow || immediateOverrideRequested || lifecycle.command !== 'evaluate',
      requiredFor: 'evaluate'
    },
    {
      id: 'state_commit_unblocked',
      satisfied: commandPlan.commitState !== 'blocked',
      requiredFor: commandPlan.operation
    }
  ];
  const blockedPrerequisites = commitPrerequisites.filter((item) => !item.satisfied).map((item) => item.id);
  const nextControlAction = deniedControlCodes.includes('schedule_change_reason_required')
    ? 'record_schedule_change_reason'
    : deniedControlCodes.includes('schedule_mutation_not_allowed')
      ? 'enable_schedule_mutation_control'
      : deniedControlCodes.includes('enable_reason_required')
        ? 'record_enable_reason'
        : deniedControlCodes.includes('enable_not_allowed')
          ? 'choose_allowed_enable_control'
      : deniedControlCodes.includes('immediate_evaluation_not_allowed')
        ? 'wait_for_scheduled_evaluation'
        : deniedControlCodes.includes('suspend_window_too_long')
          ? 'shorten_suspension_window'
          : deniedControlCodes.includes('suspend_not_allowed')
            ? 'choose_allowed_suspend_control'
            : deniedControlCodes.includes('resume_not_allowed')
              ? 'choose_allowed_resume_control'
              : deniedControlCodes.includes('dry_run_not_allowed')
                ? 'choose_allowed_dry_run_control'
                : deniedControlCodes.includes('disable_reason_required')
                  ? 'record_disable_reason'
                  : blockedPrerequisites.length > 0
                    ? 'resolve_lifecycle_control_block'
                    : commandPlan.commitState === 'ready_to_commit'
                      ? 'commit_lifecycle_state_patch'
                      : commandPlan.commitState === 'acknowledged_noop'
                        ? 'record_lifecycle_noop'
                        : 'continue_policy_evaluation';

  return {
    schema: LIFECYCLE_EXECUTION_CONTROL_SCHEMA,
    requestedBy: lifecycle.controls.requestedBy,
    command: lifecycle.command,
    operation: commandPlan.operation,
    scheduleMutationRequested,
    immediateOverrideRequested,
    suspensionDurationMs,
    maxSuspensionMs: lifecycle.controls.maxSuspensionMs,
    permitted: deniedControlCodes.length === 0 && blockedPrerequisites.length === 0,
    deniedControlCodes,
    blockedPrerequisites,
    commitPrerequisites,
    nextControlAction,
    auditTrail: {
      reason: lifecycle.controls.reason,
      scheduleChangeReason: lifecycle.controls.scheduleChangeReason,
      commandWouldChangeState: commandPlan.commandWouldChangeState,
      statePatchFingerprint: contractFingerprint(commandPlan.statePatch)
    }
  };
}

function buildLifecycleSettingsControlState(lifecycle, failures, commandPlan, executionControls) {
  const blockingCodes = new Set(failures.filter((failure) => failure.severity === 'error').map((failure) => failure.code));
  const settingsMutations = [
    ...(lifecycle.intent.enabledSpecified || ['enable', 'disable'].includes(lifecycle.command)
      ? [{
        setting: 'enabled',
        requested: commandPlan.effectiveEnabled,
        explicit: lifecycle.intent.enabledSpecified || ['enable', 'disable'].includes(lifecycle.command),
        source: ['enable', 'disable'].includes(lifecycle.command) ? 'command' : 'settings'
      }]
      : []),
    ...(lifecycle.command === 'dry-run' || lifecycle.mode === 'monitor'
      ? [{
        setting: 'mode',
        requested: lifecycle.dryRun ? 'monitor' : lifecycle.mode,
        explicit: lifecycle.command === 'dry-run' || lifecycle.mode === 'monitor',
        source: lifecycle.command === 'dry-run' ? 'command' : 'settings'
      }]
      : []),
    ...(lifecycle.intent.scheduleEnabledSpecified
      ? [{
        setting: 'schedule.enabled',
        requested: lifecycle.schedule.enabled,
        explicit: true,
        source: 'schedule'
      }]
      : []),
    ...(lifecycle.schedule.intervalMs !== null
      ? [{
        setting: 'schedule.intervalMs',
        requested: lifecycle.schedule.intervalMs,
        explicit: true,
        source: 'schedule'
      }]
      : []),
    ...(lifecycle.schedule.nextEvaluationAt
      ? [{
        setting: 'schedule.nextEvaluationAt',
        requested: lifecycle.schedule.nextEvaluationAt,
        explicit: true,
        source: 'schedule'
      }]
      : []),
    ...(lifecycle.command === 'suspend' || lifecycle.command === 'resume' || lifecycle.schedule.pausedUntil
      ? [{
        setting: 'schedule.pausedUntil',
        requested: commandPlan.schedulePatch.pausedUntil,
        explicit: lifecycle.command === 'suspend' || lifecycle.command === 'resume' || Boolean(lifecycle.schedule.pausedUntil),
        source: lifecycle.command === 'suspend' || lifecycle.command === 'resume' ? 'command' : 'schedule'
      }]
      : [])
  ];
  const blockedSettings = settingsMutations
    .filter((mutation) => {
      if (mutation.setting === 'enabled' && commandPlan.effectiveEnabled && blockingCodes.has('enable_not_allowed')) return true;
      if (mutation.setting === 'enabled' && !commandPlan.effectiveEnabled && blockingCodes.has('disable_not_allowed')) return true;
      if (mutation.setting.startsWith('schedule.') && blockingCodes.has('schedule_mutation_not_allowed')) return true;
      if (mutation.setting === 'schedule.pausedUntil' && blockingCodes.has('suspend_not_allowed')) return true;
      if (mutation.setting === 'schedule.pausedUntil' && blockingCodes.has('resume_not_allowed')) return true;
      if (mutation.setting === 'mode' && blockingCodes.has('dry_run_not_allowed')) return true;
      return false;
    })
    .map((mutation) => mutation.setting);
  const unappliedReasons = [
    ...executionControls.deniedControlCodes,
    ...commandPlan.blockedBy.filter((code) => !executionControls.deniedControlCodes.includes(code))
  ];
  const canApplySettings = executionControls.permitted && commandPlan.commitState === 'ready_to_commit';
  const stateAction = canApplySettings
    ? 'apply_settings_patch'
    : commandPlan.commitState === 'acknowledged_noop'
      ? 'acknowledge_noop_settings'
      : settingsMutations.length === 0
        ? 'observe_current_settings'
        : 'hold_settings_patch';

  return {
    schema: 'aios.capabilitySecurity.policyEvaluator.lifecycleSettingsControls.v1',
    stateAction,
    canApplySettings,
    settingsMutationCount: settingsMutations.length,
    settingsMutations,
    blockedSettings,
    unappliedReasons,
    explicitIntent: lifecycle.intent,
    controls: {
      allowEnable: lifecycle.controls.allowEnable,
      allowDisable: lifecycle.controls.allowDisable,
      allowSuspend: lifecycle.controls.allowSuspend,
      allowResume: lifecycle.controls.allowResume,
      allowDryRun: lifecycle.controls.allowDryRun,
      allowScheduleMutation: lifecycle.controls.allowScheduleMutation
    },
    nextAction: canApplySettings
      ? 'persist_lifecycle_settings'
      : unappliedReasons.includes('enable_reason_required')
        ? 'record_enable_reason'
        : unappliedReasons.includes('disable_reason_required')
          ? 'record_disable_reason'
          : unappliedReasons.includes('schedule_change_reason_required')
            ? 'record_schedule_change_reason'
            : blockedSettings.length > 0
              ? 'revise_blocked_lifecycle_settings'
              : commandPlan.commitState === 'acknowledged_noop'
                ? 'record_lifecycle_noop'
                : 'continue_without_settings_mutation'
  };
}

function buildLifecycleTransitionContract(lifecycle, failures, commandPlan, executionControls, nowMs) {
  const blockingCodes = failures.filter((failure) => failure.severity === 'error').map((failure) => failure.code);
  const warningCodes = failures.filter((failure) => failure.severity === 'warning').map((failure) => failure.code);
  const intervalNextAtMs = lifecycle.schedule.intervalMs ? nowMs + lifecycle.schedule.intervalMs : null;
  const commandCanMutate = executionControls.permitted
    && commandPlan.applyCommand
    && commandPlan.commitState === 'ready_to_commit';
  const checkpointAction = commandPlan.commitState === 'blocked'
    ? 'reject_lifecycle_transition'
    : commandPlan.commitState === 'ready_to_commit'
      ? 'persist_lifecycle_transition'
      : commandPlan.commitState === 'acknowledged_noop'
        ? 'append_lifecycle_acknowledgement'
        : 'observe_lifecycle_state';
  const runtimeMode = !commandPlan.effectiveEnabled
    ? 'disabled'
    : commandPlan.effectiveSuspended
      ? 'suspended'
      : lifecycle.dryRun
        ? 'monitoring'
        : 'enforcing';
  const nextWakeAt = commandPlan.effectiveSuspended
    ? commandPlan.schedulePatch.pausedUntil
    : commandPlan.schedulePatch.nextEvaluationAt
      || (intervalNextAtMs ? new Date(intervalNextAtMs).toISOString() : null);
  const routedCommand = lifecycle.command === 'reload-policies'
    ? ['flush_policy_cache', 'load_signed_policy_snapshot', 'evaluate_policy_now']
    : lifecycle.command === 'disable'
      ? ['persist_disabled_state', 'fail_closed_future_grants']
      : lifecycle.command === 'enable'
        ? ['persist_enabled_state', 'evaluate_policy_now']
        : lifecycle.command === 'suspend'
          ? ['persist_suspension_window', 'defer_policy_evaluation']
          : lifecycle.command === 'resume'
            ? ['clear_suspension_window', 'evaluate_policy_now']
            : lifecycle.command === 'dry-run'
              ? ['simulate_policy_decision', 'record_monitoring_audit']
              : lifecycle.schedule.enabled && !lifecycle.schedule.dueNow
                ? ['record_scheduled_observation', 'defer_policy_evaluation']
                : ['evaluate_policy_now'];
  const scheduleDirective = commandPlan.effectiveSuspended
    ? 'wake_at_paused_until'
    : lifecycle.schedule.enabled && !lifecycle.schedule.dueNow
      ? 'wait_until_next_evaluation'
      : lifecycle.schedule.enabled && lifecycle.schedule.intervalMs
        ? 'advance_interval_after_evaluation'
        : 'run_on_demand';

  return {
    schema: LIFECYCLE_TRANSITION_SCHEMA,
    transitionId: contractFingerprint({
      schema: LIFECYCLE_TRANSITION_SCHEMA,
      command: lifecycle.command,
      operation: commandPlan.operation,
      commitState: commandPlan.commitState,
      requestedBy: lifecycle.controls.requestedBy,
      statePatch: commandPlan.statePatch,
      blockingCodes
    }),
    command: lifecycle.command,
    operation: commandPlan.operation,
    runtimeMode,
    checkpointAction,
    commandCanMutate,
    requestedBy: lifecycle.controls.requestedBy,
    scheduleDirective,
    nextWakeAt,
    expectedState: {
      enabled: commandPlan.effectiveEnabled,
      suspended: commandPlan.effectiveSuspended,
      dryRun: lifecycle.dryRun,
      scheduleEnabled: lifecycle.schedule.enabled,
      intervalMs: lifecycle.schedule.intervalMs,
      nextEvaluationAt: commandPlan.schedulePatch.nextEvaluationAt,
      pausedUntil: commandPlan.schedulePatch.pausedUntil
    },
    route: {
      domain: 'hosted-kernel.lifecycle',
      actions: routedCommand,
      externalSideEffectsAllowed: commandCanMutate && lifecycle.command !== 'dry-run',
      policyEvaluationRequired: ['evaluate', 'enable', 'resume', 'reload-policies', 'dry-run'].includes(lifecycle.command)
    },
    audit: {
      reason: lifecycle.controls.reason,
      scheduleChangeReason: lifecycle.controls.scheduleChangeReason,
      blockingCodes,
      warningCodes,
      deniedControlCodes: executionControls.deniedControlCodes,
      statePatchFingerprint: executionControls.auditTrail.statePatchFingerprint,
      generatedAtMs: nowMs
    }
  };
}

function buildLifecycleCommandPlan(lifecycle, failures, nowMs) {
  const blockingCodes = new Set(failures.filter((failure) => failure.severity === 'error').map((failure) => failure.code));
  const hasBlockingError = blockingCodes.size > 0;
  const intervalNextMs = lifecycle.schedule.intervalMs ? nowMs + lifecycle.schedule.intervalMs : null;
  const scheduledNextMs = lifecycle.schedule.nextEvaluationAtMs || intervalNextMs;
  const nextScheduledEvaluationAt = scheduledNextMs ? new Date(scheduledNextMs).toISOString() : null;
  const scheduleEnabledPatchAction = lifecycle.intent.scheduleEnabledSpecified
    ? 'set_schedule_enabled'
    : lifecycle.command === 'suspend'
      ? 'preserve_schedule_enabled_while_suspended'
      : lifecycle.command === 'resume'
        ? 'preserve_schedule_enabled_after_resume'
        : 'preserve_schedule_enabled';
  const requestedEnabled = lifecycle.command === 'enable'
    ? true
    : lifecycle.command === 'disable'
      ? false
      : lifecycle.enabled;
  const requestedPausedUntil = lifecycle.command === 'resume'
    ? null
    : lifecycle.command === 'suspend'
      ? lifecycle.schedule.pausedUntil
      : lifecycle.schedule.pausedUntil;
  const commandIntrinsicStateChange = lifecycle.command === 'enable'
    ? !lifecycle.enabled
    : lifecycle.command === 'disable'
      ? lifecycle.enabled
      : lifecycle.command === 'resume'
        ? lifecycle.schedule.suspended || Boolean(lifecycle.schedule.pausedUntil)
        : lifecycle.command === 'suspend'
          ? Boolean(lifecycle.schedule.pausedUntil)
          : lifecycle.command === 'reload-policies';
  const settingsWouldChangeState = lifecycle.intent.enabledSpecified
    || lifecycle.intent.scheduleMutationRequested
    || lifecycle.command === 'dry-run'
    || lifecycle.mode === 'monitor';
  const commandWouldChangeState = Boolean(commandIntrinsicStateChange || settingsWouldChangeState);
  const applyCommand = lifecycle.commandExplicit && !hasBlockingError;
  const schedulePatch = {
    enabled: lifecycle.schedule.enabled,
    enabledSpecified: lifecycle.intent.scheduleEnabledSpecified,
    enabledPatchAction: scheduleEnabledPatchAction,
    intervalMs: lifecycle.schedule.intervalMs,
    intervalPatchAction: lifecycle.schedule.intervalMs !== null ? 'set_interval_ms' : 'preserve_interval_ms',
    nextEvaluationAt: lifecycle.command === 'evaluate' || lifecycle.command === 'dry-run' || lifecycle.command === 'reload-policies'
      ? nextScheduledEvaluationAt
      : lifecycle.schedule.nextEvaluationAt,
    nextEvaluationPatchAction: lifecycle.command === 'evaluate' || lifecycle.command === 'dry-run' || lifecycle.command === 'reload-policies'
      ? 'advance_after_evaluation'
      : lifecycle.schedule.nextEvaluationAt
        ? 'set_next_evaluation_at'
        : 'preserve_next_evaluation_at',
    pausedUntil: requestedPausedUntil,
    pausedUntilPatchAction: lifecycle.command === 'suspend'
      ? 'set_paused_until'
      : lifecycle.command === 'resume'
        ? 'clear_paused_until'
        : lifecycle.schedule.pausedUntil
          ? 'set_paused_until'
          : 'preserve_paused_until'
  };
  const statePatch = {
    enabled: requestedEnabled,
    enabledPatchAction: lifecycle.intent.enabledSpecified || ['enable', 'disable'].includes(lifecycle.command)
      ? 'set_enabled'
      : 'preserve_enabled',
    mode: lifecycle.mode,
    dryRun: lifecycle.dryRun,
    dryRunPatchAction: lifecycle.command === 'dry-run' || lifecycle.mode === 'monitor'
      ? 'set_dry_run'
      : 'preserve_dry_run',
    schedule: schedulePatch,
    updatedAtMs: nowMs
  };
  const operation = lifecycle.command === 'disable'
    ? 'disable_policy_evaluator'
    : lifecycle.command === 'enable'
      ? 'enable_policy_evaluator'
      : lifecycle.command === 'suspend'
        ? 'suspend_until_window'
        : lifecycle.command === 'resume'
          ? 'clear_suspension'
          : lifecycle.command === 'reload-policies'
            ? 'reload_policies_then_evaluate'
            : lifecycle.command === 'dry-run'
              ? 'simulate_without_commit'
              : 'evaluate_policy_now';
  const commitState = hasBlockingError
    ? 'blocked'
    : applyCommand && commandWouldChangeState
      ? 'ready_to_commit'
      : applyCommand
        ? 'acknowledged_noop'
        : 'observed';

  return {
    schema: 'aios.capabilitySecurity.policyEvaluator.lifecycleCommandPlan.v1',
    operation,
    commitState,
    commandWouldChangeState,
    applyCommand,
    effectiveEnabled: requestedEnabled,
    effectiveSuspended: Boolean(requestedPausedUntil && parseTimestampMs(requestedPausedUntil) > nowMs),
    schedulePatch,
    statePatch,
    blockedBy: [...blockingCodes],
    auditInputs: {
      requestedBy: lifecycle.controls.requestedBy,
      reason: lifecycle.controls.reason,
      commandExplicit: lifecycle.commandExplicit,
      failClosedOnDisabled: lifecycle.controls.failClosedOnDisabled
    }
  };
}

function buildLifecycleState(lifecycle, failures, nowMs) {
  const blockingCodes = new Set(failures.filter((failure) => failure.severity === 'error').map((failure) => failure.code));
  const commandPlan = buildLifecycleCommandPlan(lifecycle, failures, nowMs);
  const executionControls = buildLifecycleExecutionControls(lifecycle, failures, commandPlan, nowMs);
  const settingsControls = buildLifecycleSettingsControlState(lifecycle, failures, commandPlan, executionControls);
  const transition = buildLifecycleTransitionContract(lifecycle, failures, commandPlan, executionControls, nowMs);
  const nextEvaluationAtMs = lifecycle.schedule.nextEvaluationAtMs
    || (lifecycle.schedule.intervalMs ? nowMs + lifecycle.schedule.intervalMs : null);
  const nextEvaluationAt = nextEvaluationAtMs ? new Date(nextEvaluationAtMs).toISOString() : null;
  const commandAcknowledged = LIFECYCLE_COMMANDS.has(lifecycle.command) && !blockingCodes.has('invalid_lifecycle_command');
  const nextAction = blockingCodes.has('policy_evaluator_disabled')
    ? 'enable_policy_evaluator'
    : blockingCodes.has('schedule_change_reason_required')
      ? 'record_schedule_change_reason'
    : blockingCodes.has('schedule_mutation_not_allowed')
      ? 'enable_schedule_mutation_control'
    : blockingCodes.has('enable_reason_required')
      ? 'record_enable_reason'
    : blockingCodes.has('enable_not_allowed')
      ? 'choose_allowed_enable_control'
    : blockingCodes.has('immediate_evaluation_not_allowed')
      ? 'wait_for_scheduled_evaluation'
    : blockingCodes.has('suspend_window_too_long')
      ? 'shorten_suspension_window'
    : blockingCodes.has('suspend_not_allowed')
      ? 'choose_allowed_suspend_control'
    : blockingCodes.has('resume_not_allowed')
      ? 'choose_allowed_resume_control'
    : blockingCodes.has('dry_run_not_allowed')
      ? 'choose_allowed_dry_run_control'
    : blockingCodes.has('evaluation_not_due')
      ? 'wait_for_schedule'
    : blockingCodes.has('disable_reason_required')
      ? 'record_disable_reason'
      : blockingCodes.has('disable_not_allowed')
        ? 'choose_allowed_lifecycle_control'
        : settingsControls.nextAction !== 'continue_without_settings_mutation'
          ? settingsControls.nextAction
        : lifecycle.schedule.suspended
          ? 'wait_for_resume_window'
          : lifecycle.schedule.enabled && !lifecycle.schedule.dueNow
            ? 'wait_for_schedule'
            : lifecycle.command === 'reload-policies'
              ? 'reload_policy_snapshot'
              : lifecycle.dryRun
                ? 'review_dry_run_decision'
                : 'evaluate_now';

  return {
    schema: lifecycle.schema,
    command: lifecycle.command,
    commandExplicit: lifecycle.commandExplicit,
    commandAcknowledged,
    enabled: lifecycle.enabled,
    mode: lifecycle.mode,
    dryRun: lifecycle.dryRun,
    schedule: {
      enabled: lifecycle.schedule.enabled,
      dueNow: lifecycle.schedule.dueNow,
      suspended: lifecycle.schedule.suspended,
      intervalMs: lifecycle.schedule.intervalMs,
      nextEvaluationAt,
      pausedUntil: lifecycle.schedule.pausedUntil,
      enabledSpecified: lifecycle.schedule.enabledSpecified,
      mutationRequested: lifecycle.schedule.mutationRequested,
      windowChanged: lifecycle.schedule.windowChanged
    },
    intent: lifecycle.intent,
    controls: lifecycle.controls,
    commandPlan,
    executionControls,
    settingsControls,
    transition,
    nextAction,
    blockedBy: [...blockingCodes]
  };
}

function normalizePersistedEvaluatorState(input) {
  const state = asObject(input.persistedState || input.stateCheckpoint || input.kernelState?.policyEvaluator);
  const checkpoint = asObject(state.checkpoint || state.snapshot);
  const activeLease = asObject(state.activeLease || checkpoint.activeLease || state.lease);
  const durableWrite = asObject(state.durableWrite || checkpoint.durableWrite || state.lastWrite);
  const rawLedger = Array.isArray(state.commandLedger)
    ? state.commandLedger
    : Array.isArray(state.commands)
      ? state.commands
      : [];
  const rawDecisions = Array.isArray(state.committedDecisions)
    ? state.committedDecisions
    : Array.isArray(state.decisions)
      ? state.decisions
      : [];

  return {
    schema: state.schema || STATE_PERSISTENCE_SCHEMA,
    checkpointId: state.checkpointId || checkpoint.id || null,
    revision: Number.isFinite(Number(state.revision ?? checkpoint.revision)) ? Number(state.revision ?? checkpoint.revision) : 0,
    restoredAt: state.restoredAt || checkpoint.restoredAt || null,
    status: state.status || checkpoint.status || 'unknown',
    lastCommittedAt: state.lastCommittedAt || checkpoint.lastCommittedAt || null,
    lastRequestId: state.lastRequestId || checkpoint.requestId || null,
    lastCommandId: state.lastCommandId || checkpoint.commandId || durableWrite.commandId || null,
    activeLease: {
      leaseId: activeLease.leaseId || activeLease.id || null,
      commandId: activeLease.commandId || null,
      requestId: activeLease.requestId || null,
      acquiredAt: activeLease.acquiredAt || null,
      expiresAt: activeLease.expiresAt || null,
      owner: activeLease.owner || activeLease.workerId || null
    },
    durableWrite: {
      writeId: durableWrite.writeId || durableWrite.id || null,
      commandId: durableWrite.commandId || null,
      revision: Number.isFinite(Number(durableWrite.revision)) ? Number(durableWrite.revision) : null,
      phase: durableWrite.phase || durableWrite.status || null,
      flushedAt: durableWrite.flushedAt || durableWrite.completedAt || null
    },
    commandLedger: rawLedger
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry, index) => ({
        commandId: entry.commandId || entry.id || `persisted-command-${index + 1}`,
        requestId: entry.requestId || null,
        command: entry.command || entry.lifecycleCommand || 'evaluate',
        status: entry.status || (entry.appliedAt || entry.completedAt ? 'committed' : 'pending'),
        decision: entry.decision || null,
        reason: entry.reason || null,
        leaseId: entry.leaseId || null,
        preparedAt: entry.preparedAt || null,
        appliedAt: entry.appliedAt || entry.completedAt || null,
        supersedesCommandId: entry.supersedesCommandId || null,
        revision: Number.isFinite(Number(entry.revision)) ? Number(entry.revision) : null
      })),
    committedDecisions: rawDecisions
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry, index) => ({
        sequence: Number.isFinite(Number(entry.sequence)) ? Number(entry.sequence) : index + 1,
        requestId: entry.requestId || entry.id || 'unknown-request',
        decision: entry.decision || 'unknown',
        reason: entry.reason || 'unknown',
        committedAt: entry.committedAt || entry.generatedAt || entry.at || null,
        commandId: entry.commandId || null,
        auditHash: entry.auditHash || entry.proofHash || null
      }))
  };
}

function statusIsCommitted(status) {
  return ['committed', 'applied', 'completed'].includes(status);
}

function statusIsInFlight(status) {
  return ['pending', 'recovering', 'prepared', 'leased', 'writing'].includes(status);
}

function sameCommandScope(entry, commandId, requestId) {
  return entry.commandId === commandId || (requestId && entry.requestId === requestId && statusIsInFlight(entry.status));
}

function buildRestartRecoveryPlan({ persisted, commandId, request, lifecycleState, decision, reason, retry, duplicateCommitted, priorCommand, priorDecision, nowMs, now }) {
  const inFlightCommands = persisted.commandLedger.filter((entry) => statusIsInFlight(entry.status));
  const scopedInFlight = inFlightCommands.filter((entry) => sameCommandScope(entry, commandId, request.id));
  const conflictingInFlight = inFlightCommands.filter((entry) => entry.requestId === request.id && entry.commandId !== commandId);
  const leaseExpiresAtMs = parseTimestampMs(persisted.activeLease.expiresAt);
  const leaseExpired = Boolean(leaseExpiresAtMs && leaseExpiresAtMs <= nowMs);
  const leaseMatchesCommand = Boolean(persisted.activeLease.commandId && persisted.activeLease.commandId === commandId);
  const durableWriteMatchesCommand = Boolean(persisted.durableWrite.commandId && persisted.durableWrite.commandId === commandId);
  const recoveredDecision = priorDecision?.decision || priorCommand?.decision || decision;
  const recoveredReason = priorDecision?.reason || priorCommand?.reason || reason;
  const recoveryRequired = Boolean(
    scopedInFlight.length > 0
    || persisted.status === 'recovering'
    || persisted.status === 'dirty'
    || (persisted.activeLease.commandId && (!leaseMatchesCommand || leaseExpired))
    || (persisted.durableWrite.phase && !statusIsCommitted(persisted.durableWrite.phase))
  );
  const restartSafeStatus = duplicateCommitted
    ? 'idempotent_replay'
    : conflictingInFlight.length > 0
      ? 'blocked_by_inflight_command'
      : retry.retryable && recoveryRequired
        ? 'recoverable_pending_retry'
        : recoveryRequired
          ? 'recovered_ready_to_commit'
          : decision === 'allow'
            ? 'ready_to_commit'
            : 'decision_record_only';
  const recoveryAction = duplicateCommitted
    ? 'return_prior_commit'
    : conflictingInFlight.length > 0
      ? 'reconcile_conflicting_command'
      : scopedInFlight.length > 0 || durableWriteMatchesCommand
        ? 'resume_prepared_commit'
        : leaseExpired
          ? 'steal_expired_lease_and_replay'
          : recoveryRequired
            ? 'rebuild_checkpoint_from_ledger'
            : 'prepare_new_commit';

  return {
    schema: RECOVERY_PLAN_SCHEMA,
    required: recoveryRequired,
    action: recoveryAction,
    restartSafeStatus,
    safeToApplySideEffects: decision === 'allow' && !duplicateCommitted && !recoveryRequired && conflictingInFlight.length === 0,
    recoveredDecision,
    recoveredReason,
    lease: {
      currentLeaseId: persisted.activeLease.leaseId,
      owner: persisted.activeLease.owner,
      matchesCommand: leaseMatchesCommand,
      expired: leaseExpired,
      expiresAt: persisted.activeLease.expiresAt,
      nextLeaseId: `${surfaceId}:${request.id}:${commandId}:lease`
    },
    commandConflicts: conflictingInFlight.map((entry) => ({
      commandId: entry.commandId,
      status: entry.status,
      revision: entry.revision,
      preparedAt: entry.preparedAt,
      appliedAt: entry.appliedAt
    })),
    resumableCommands: scopedInFlight.map((entry) => ({
      commandId: entry.commandId,
      status: entry.status,
      revision: entry.revision,
      decision: entry.decision,
      reason: entry.reason
    })),
    durableWrite: {
      writeId: persisted.durableWrite.writeId || `${surfaceId}:${request.id}:${commandId}:write`,
      commandId,
      expectedPreviousRevision: persisted.revision,
      phase: duplicateCommitted ? 'already_committed' : recoveryRequired ? 'recovering' : 'prepared',
      idempotencyKey: commandId,
      writeBarrier: contractFingerprint({
        requestId: request.id,
        commandId,
        command: lifecycleState.command,
        decision,
        reason,
        previousRevision: persisted.revision
      })
    },
    audit: {
      generatedAt: now,
      priorCommandStatus: priorCommand?.status || null,
      priorDecision: priorDecision?.decision || null,
      retryableRecovery: retry.retryable,
      retryReasons: retry.retryReasons
    }
  };
}

function buildPersistedStateMutation({ persisted, recoveryPlan, commandId, request, lifecycleState, decision, reason, duplicateCommitted, priorCommand, priorDecision, now }) {
  const recoveredDecision = recoveryPlan.recoveredDecision || decision;
  const recoveredReason = recoveryPlan.recoveredReason || reason;
  const recoveryRequired = recoveryPlan.required;
  const shouldStage = recoveryRequired && !duplicateCommitted;
  const shouldCommit = !duplicateCommitted && !recoveryRequired;
  const shouldRecordDecision = shouldCommit || duplicateCommitted;
  const nextRevision = Math.max(0, persisted.revision) + (shouldCommit ? 1 : 0);
  const status = duplicateCommitted
    ? 'idempotent_replay'
    : shouldStage
      ? 'recovering'
      : decision === 'allow'
        ? 'committed'
        : 'denial_recorded';
  const leasePolicy = duplicateCommitted
    ? 'reuse_prior_commit_without_lease'
    : shouldStage
      ? 'acquire_recovery_lease'
      : 'release_after_commit';
  const durablePhase = duplicateCommitted
    ? 'already_committed'
    : shouldStage
      ? 'recovering'
      : 'committed';
  const appliedAt = shouldCommit ? now : priorCommand?.appliedAt || priorDecision?.committedAt || null;
  const preparedAt = shouldStage ? now : priorCommand?.preparedAt || null;
  const commandStatus = duplicateCommitted
    ? priorCommand?.status || 'committed'
    : shouldStage
      ? 'recovering'
      : 'committed';
  const activeLease = leasePolicy === 'reuse_prior_commit_without_lease'
    ? {
      leaseId: null,
      commandId: null,
      requestId: null,
      acquiredAt: null,
      expiresAt: null,
      owner: null
    }
    : leasePolicy === 'acquire_recovery_lease'
      ? {
        leaseId: recoveryPlan.lease.nextLeaseId,
        commandId,
        requestId: request.id,
        acquiredAt: now,
        expiresAt: recoveryPlan.lease.expiresAt,
        owner: lifecycleState.controls.requestedBy
      }
      : {
        leaseId: null,
        commandId: null,
        requestId: null,
        acquiredAt: null,
        expiresAt: null,
        owner: null
      };
  const ledgerEntry = {
    commandId,
    requestId: request.id,
    command: lifecycleState.command,
    status: commandStatus,
    decision: recoveredDecision,
    reason: recoveredReason,
    leaseId: activeLease.leaseId,
    preparedAt,
    appliedAt,
    supersedesCommandId: recoveryPlan.commandConflicts[0]?.commandId || null,
    revision: nextRevision
  };
  const decisionRecord = shouldRecordDecision
    ? {
      sequence: duplicateCommitted
        ? priorDecision?.sequence || Math.max(1, persisted.committedDecisions.length)
        : persisted.committedDecisions.length + 1,
      requestId: request.id,
      commandId,
      decision: recoveredDecision,
      reason: recoveredReason,
      committedAt: appliedAt,
      auditHash: contractFingerprint({
        schema: STATE_MUTATION_SCHEMA,
        requestId: request.id,
        commandId,
        decision: recoveredDecision,
        reason: recoveredReason,
        revision: nextRevision
      })
    }
    : null;
  const recoveryActions = [
    ...(duplicateCommitted ? ['return_prior_decision_without_side_effects'] : []),
    ...(shouldStage ? ['persist_recovery_checkpoint', recoveryPlan.action] : []),
    ...(shouldCommit ? ['append_command_ledger', 'append_decision_record', 'release_active_lease'] : []),
    ...(recoveryPlan.commandConflicts.length > 0 ? ['reconcile_conflicting_inflight_command'] : [])
  ];

  return {
    schema: STATE_MUTATION_SCHEMA,
    mutationId: contractFingerprint({
      requestId: request.id,
      commandId,
      previousRevision: persisted.revision,
      status,
      recoveryAction: recoveryPlan.action
    }),
    previousRevision: persisted.revision,
    nextRevision,
    revisionPolicy: shouldCommit ? 'increment_on_committed_mutation' : 'preserve_revision_until_recovery_commit',
    status,
    restartSafeStatus: recoveryPlan.restartSafeStatus,
    leasePolicy,
    durablePhase,
    recoveredDecision,
    recoveredReason,
    recoveryActions,
    activeLease,
    ledgerEntry,
    decisionRecord,
    sideEffectPolicy: {
      safeToApply: recoveryPlan.safeToApplySideEffects,
      reason: duplicateCommitted
        ? 'idempotent_replay_uses_prior_commit'
        : shouldStage
          ? 'recovery_checkpoint_must_commit_before_side_effects'
          : recoveryPlan.safeToApplySideEffects
            ? 'fresh_allowed_commit'
            : 'decision_is_not_side_effect_eligible'
    }
  };
}

function buildRestartStatusSemantics({ persisted, recoveryPlan, stateMutation, commandId, request, lifecycleState, duplicateCommitted, priorCommand, now }) {
  const terminalMutation = ['committed', 'denial_recorded', 'idempotent_replay'].includes(stateMutation.status);
  const checkpointStatus = duplicateCommitted
    ? 'stable_replayed'
    : stateMutation.status === 'recovering'
      ? 'recovering_replay_pending'
      : stateMutation.status === 'committed'
        ? 'stable_committed'
        : stateMutation.status === 'denial_recorded'
          ? 'stable_denial_recorded'
          : 'unstable_pending';
  const replayDisposition = duplicateCommitted
    ? 'return_recorded_result'
    : recoveryPlan.commandConflicts.length > 0
      ? 'manual_reconcile_before_replay'
      : stateMutation.status === 'recovering'
        ? 'resume_recovery_command'
        : terminalMutation
          ? 'no_replay_required'
          : 'prepare_replay_from_checkpoint';
  const restartAction = checkpointStatus === 'recovering_replay_pending'
    ? recoveryPlan.action
    : checkpointStatus === 'stable_replayed'
      ? 'skip_side_effects_and_emit_prior_result'
      : checkpointStatus.startsWith('stable_')
        ? 'load_checkpoint_without_replay'
        : 'rebuild_checkpoint_from_ledger';
  const commandStatus = stateMutation.ledgerEntry.status;
  const leaseRequiredOnRestart = stateMutation.leasePolicy === 'acquire_recovery_lease';
  const canResumeAfterRestart = Boolean(
    stateMutation.status === 'recovering'
    && recoveryPlan.commandConflicts.length === 0
    && stateMutation.activeLease.commandId === commandId
  );

  return {
    schema: 'aios.capabilitySecurity.policyEvaluator.restartStatus.v1',
    checkpointStatus,
    restartSafeStatus: stateMutation.restartSafeStatus,
    replayDisposition,
    restartAction,
    terminal: terminalMutation && recoveryPlan.commandConflicts.length === 0,
    canResumeAfterRestart,
    leaseRequiredOnRestart,
    idempotencyKey: commandId,
    requestId: request.id,
    lifecycleCommand: lifecycleState.command,
    priorCommandStatus: priorCommand?.status || null,
    previousCheckpointStatus: persisted.status,
    commandStatus,
    mutationStatus: stateMutation.status,
    durablePhase: stateMutation.durablePhase,
    sideEffectsAllowedAfterRestart: stateMutation.sideEffectPolicy.safeToApply && terminalMutation,
    generatedAt: now,
    operatorDirective: recoveryPlan.commandConflicts.length > 0
      ? 'resolve_conflicting_inflight_commands_before_restarting_side_effects'
      : canResumeAfterRestart
        ? 'resume_command_with_existing_idempotency_key'
        : duplicateCommitted
          ? 'serve_prior_commit_for_duplicate_command'
          : terminalMutation
            ? 'treat_checkpoint_as_authoritative'
            : 'rebuild_state_from_projected_ledger'
  };
}

function buildProjectedPersistedLedger({ persisted, stateMutation, recoveryPlan, commandId }) {
  const supersededCommandIds = new Set(recoveryPlan.commandConflicts.map((entry) => entry.commandId));
  const projectedCommands = persisted.commandLedger
    .filter((entry) => entry.commandId !== commandId)
    .map((entry) => {
      if (!supersededCommandIds.has(entry.commandId)) return entry;
      return {
        ...entry,
        status: 'superseded_by_recovery',
        supersededByCommandId: commandId,
        supersededAtRevision: stateMutation.nextRevision
      };
    });
  const shouldAddLedgerEntry = stateMutation.status !== 'idempotent_replay'
    || !projectedCommands.some((entry) => entry.commandId === stateMutation.ledgerEntry.commandId);
  const commandLedger = [
    ...projectedCommands,
    ...(shouldAddLedgerEntry ? [stateMutation.ledgerEntry] : [])
  ];
  const committedDecisions = stateMutation.decisionRecord
    ? [
      ...persisted.committedDecisions.filter((entry) => entry.commandId !== commandId),
      stateMutation.decisionRecord
    ]
    : persisted.committedDecisions;

  return {
    schema: 'aios.capabilitySecurity.policyEvaluator.projectedLedger.v1',
    commandLedger,
    committedDecisions,
    supersededCommandIds: [...supersededCommandIds],
    commandCount: commandLedger.length,
    committedDecisionCount: committedDecisions.length,
    latestCommandId: commandLedger[commandLedger.length - 1]?.commandId || null,
    latestDecisionCommandId: committedDecisions[committedDecisions.length - 1]?.commandId || null,
    projectionPolicy: stateMutation.status === 'recovering'
      ? 'stage_recovery_entry_without_revision_increment'
      : stateMutation.status === 'idempotent_replay'
        ? 'preserve_prior_committed_result'
        : 'replace_command_scope_with_authoritative_entry'
  };
}

function buildPersistenceRecoveryState({ input, request, lifecycleState, decision, reason, retry, externalHandoff, now }) {
  const persisted = normalizePersistedEvaluatorState(input);
  const nowMs = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const commandInput = asObject(input.commandEnvelope || input.idempotency || input.lifecycleSettings?.commandEnvelope);
  const commandId = commandInput.commandId
    || input.commandId
    || input.idempotencyKey
    || `${request.id}:${lifecycleState.command}:${lifecycleState.mode}`;
  const priorCommand = persisted.commandLedger.find((entry) => entry.commandId === commandId) || null;
  const priorDecision = persisted.committedDecisions.find((entry) => entry.commandId === commandId || entry.requestId === request.id) || null;
  const duplicateCommitted = Boolean((priorCommand && statusIsCommitted(priorCommand.status)) || priorDecision?.commandId === commandId);
  const recoveryPlan = buildRestartRecoveryPlan({
    persisted,
    commandId,
    request,
    lifecycleState,
    decision,
    reason,
    retry,
    duplicateCommitted,
    priorCommand,
    priorDecision,
    nowMs,
    now
  });
  const stateMutation = buildPersistedStateMutation({
    persisted,
    recoveryPlan,
    commandId,
    request,
    lifecycleState,
    decision,
    reason,
    duplicateCommitted,
    priorCommand,
    priorDecision,
    now
  });
  const restartStatus = buildRestartStatusSemantics({
    persisted,
    recoveryPlan,
    stateMutation,
    commandId,
    request,
    lifecycleState,
    duplicateCommitted,
    priorCommand,
    now
  });
  const projectedLedger = buildProjectedPersistedLedger({
    persisted,
    stateMutation,
    recoveryPlan,
    commandId
  });
  const recoveryRequired = recoveryPlan.required;

  return {
    schema: STATE_PERSISTENCE_SCHEMA,
    checkpoint: {
      checkpointId: persisted.checkpointId || `${surfaceId}:${request.id}`,
      restored: Boolean(persisted.checkpointId || persisted.restoredAt || persisted.revision > 0),
      restoredAt: persisted.restoredAt,
      previousRevision: persisted.revision,
      nextRevision: stateMutation.nextRevision,
      previousStatus: persisted.status,
      restartSafeStatus: stateMutation.restartSafeStatus,
      restartCheckpointStatus: restartStatus.checkpointStatus,
      replayDisposition: restartStatus.replayDisposition,
      mutationStatus: stateMutation.status,
      activeLeaseId: stateMutation.activeLease.leaseId,
      durableWriteId: recoveryPlan.durableWrite.writeId
    },
    idempotency: {
      commandId,
      command: lifecycleState.command,
      requestId: request.id,
      duplicate: Boolean(priorCommand || priorDecision),
      duplicateCommitted,
      recoveryRequired,
      previousDecision: recoveryPlan.recoveredDecision,
      previousReason: recoveryPlan.recoveredReason,
      result: duplicateCommitted
        ? 'already_applied'
        : recoveryRequired
          ? 'resume_or_reconcile'
          : 'new_command'
    },
    recoveryPlan,
    stateMutation,
    commitPlan: {
      action: recoveryPlan.action === 'prepare_new_commit'
        ? decision === 'allow'
          ? 'commit_decision_and_audit'
          : 'persist_denial_audit'
        : recoveryPlan.action,
      safeToApplySideEffects: recoveryPlan.safeToApplySideEffects,
      requiresReconciliation: recoveryRequired,
      retryableRecovery: retry.retryable,
      externalHandoffId: externalHandoff.handoffId,
      externalHandoffState: externalHandoff.state,
      durableWrite: {
        ...recoveryPlan.durableWrite,
        phase: stateMutation.durablePhase
      },
      revisionPolicy: stateMutation.revisionPolicy,
      sideEffectPolicy: stateMutation.sideEffectPolicy,
      restartStatus,
      generatedAt: now
    },
    nextSnapshot: {
      schema: STATE_PERSISTENCE_SCHEMA,
      checkpointId: persisted.checkpointId || `${surfaceId}:${request.id}`,
      revision: stateMutation.nextRevision,
      status: restartStatus.checkpointStatus,
      restartSafeStatus: stateMutation.restartSafeStatus,
      restartStatus,
      lastRequestId: request.id,
      lastCommandId: commandId,
      lastDecision: stateMutation.recoveredDecision,
      lastReason: stateMutation.recoveredReason,
      lastCommittedAt: stateMutation.ledgerEntry.appliedAt,
      activeLease: stateMutation.activeLease,
      durableWrite: {
        ...recoveryPlan.durableWrite,
        phase: stateMutation.durablePhase
      },
      commandLedgerEntry: stateMutation.ledgerEntry,
      committedDecisionEntry: stateMutation.decisionRecord,
      commandLedger: projectedLedger.commandLedger,
      committedDecisions: projectedLedger.committedDecisions,
      projectedLedger,
      recoveryActions: stateMutation.recoveryActions
    }
  };
}

function matchValue(patterns, value) {
  return patterns.includes('*') || patterns.includes(value);
}

function validateEvaluationInput(request, policies) {
  const errors = [];
  if (!request.capability) {
    errors.push(actionableError('missing_capability', 'capabilityRequest.capability is required', 'Provide the hosted-kernel capability being requested.'));
  }
  if (!request.principal || request.principal === 'anonymous') {
    errors.push(actionableError('missing_principal', 'capabilityRequest.principal is required', 'Attach the authenticated kernel principal before policy evaluation.'));
  }
  if (policies.length === 0) {
    errors.push(actionableError('missing_policies', 'At least one policy is required', 'Load signed capability policies from the policy store before granting access.'));
  }
  return errors;
}

function actionableError(code, message, remediation, severity = 'error', details = {}) {
  return {
    code,
    message,
    remediation,
    severity,
    surfaceId,
    retryable: TRANSIENT_FAILURES.has(code),
    ...details
  };
}

function buildRetryPlan(failures = [], attempt = 0) {
  const retryable = failures.filter((failure) => TRANSIENT_FAILURES.has(failure.code));
  if (retryable.length === 0) {
    return { retryable: false, nextAttemptAfterMs: null, retryReasons: [], backoffStrategy: 'none' };
  }
  const boundedAttempt = Math.max(0, Math.min(Number(attempt) || 0, 8));
  const exponentialDelayMs = Math.min(500 * 2 ** boundedAttempt, MAX_RETRY_DELAY_MS);
  const suggestedDelayMs = Math.max(
    0,
    ...retryable.map((failure) => Number(failure.retryAfterMs || failure.nextAttemptAfterMs || 0)).filter(Number.isFinite)
  );
  const nextAttemptAfterMs = Math.min(Math.max(exponentialDelayMs, suggestedDelayMs), MAX_RETRY_DELAY_MS);
  return {
    retryable: true,
    nextAttemptAfterMs,
    retryReasons: retryable.map((failure) => failure.code),
    backoffStrategy: suggestedDelayMs > exponentialDelayMs ? 'dependency_suggested_retry_after' : 'exponential'
  };
}

function normalizeHistorySnapshots(input) {
  const analytics = asObject(input.analytics);
  const reporting = asObject(input.reporting);
  const analyticsHistory = asObject(analytics.history);
  const reportingHistory = asObject(reporting.history);
  const persisted = normalizePersistedEvaluatorState(input);
  const explicitSnapshots = Array.isArray(input.historySnapshots)
    ? input.historySnapshots
    : Array.isArray(input.history)
      ? input.history
      : Array.isArray(analyticsHistory.snapshots)
        ? analyticsHistory.snapshots
        : Array.isArray(reportingHistory.snapshots)
          ? reportingHistory.snapshots
          : [];
  const persistedSnapshots = persisted.committedDecisions.map((entry) => ({
    sequence: entry.sequence,
    generatedAt: entry.committedAt,
    requestId: entry.requestId,
    decision: entry.decision,
    reason: entry.reason,
    commandId: entry.commandId,
    auditHash: entry.auditHash,
    source: 'persisted-decision-ledger'
  }));
  const snapshots = explicitSnapshots.length > 0 ? explicitSnapshots : persistedSnapshots;

  return snapshots
    .filter((snapshot) => snapshot && typeof snapshot === 'object')
    .slice(-MAX_HISTORY_SNAPSHOTS)
    .map((snapshot, index) => {
      const audit = asObject(snapshot.audit);
      const request = asObject(snapshot.request);
      const health = asObject(snapshot.health);
      const lifecycle = asObject(snapshot.lifecycle);
      const routeAcceptance = asObject(snapshot.routeAcceptance);
      const validationSummary = asObject(snapshot.validationSummary);
      const provider = asObject(snapshot.provider || snapshot.providerContracts);
      const proof = asObject(snapshot.proofBundle || snapshot.proof);
      const operation = asObject(snapshot.operation || snapshot.capabilityOperation);
      const guardrails = asObject(snapshot.operationGuardrails || operation.guardrails);
      const persistence = asObject(snapshot.statePersistence || snapshot.persistence || snapshot.state);
      const checkpoint = asObject(persistence.checkpoint);
      const idempotency = asObject(persistence.idempotency);
      const commitPlan = asObject(persistence.commitPlan);
      const durableWrite = asObject(commitPlan.durableWrite || persistence.durableWrite);
      const mutation = asObject(persistence.stateMutation || persistence.mutation);
      const generatedAt = snapshot.generatedAt || audit.generatedAt || snapshot.at || null;
      const decision = snapshot.decision || audit.decision || 'unknown';
      const reason = snapshot.reason || audit.reason || 'unknown';
      const decisionClass = normalizeDecisionClass(
        snapshot.decisionClass || operation.decisionClass || audit.operationDecisionClass,
        snapshot.capability || request.capability
      );
      const routeDomain = snapshot.routeDomain
        || operation.routeDomain
        || audit.operationRouteDomain
        || `hosted-kernel.${decisionClass}`;
      return {
        sequence: Number.isFinite(Number(snapshot.sequence)) ? Number(snapshot.sequence) : index + 1,
        generatedAt,
        generatedAtMs: parseTimestampMs(generatedAt),
        requestId: snapshot.requestId || audit.requestId || request.id || 'unknown-request',
        principal: snapshot.principal || request.principal || 'unknown-principal',
        capability: snapshot.capability || request.capability || 'unknown-capability',
        route: snapshot.route || request.route || 'unknown-route',
        decisionClass,
        routeDomain,
        mutating: Boolean(snapshot.mutating ?? operation.mutating ?? audit.operationMutating),
        requiresExternalHandoff: Boolean(snapshot.requiresExternalHandoff ?? operation.requiresExternalHandoff ?? audit.operationRequiresExternalHandoff),
        targetCount: Number.isFinite(Number(snapshot.targetCount ?? operation.targetCount ?? audit.operationCanonicalTargetCount))
          ? Number(snapshot.targetCount ?? operation.targetCount ?? audit.operationCanonicalTargetCount)
          : 0,
        guardrailStatus: snapshot.guardrailStatus || guardrails.status || audit.operationGuardrailStatus || null,
        decision,
        reason,
        degraded: Boolean(snapshot.degraded ?? health.degraded),
        retryable: Boolean(snapshot.retryable ?? asObject(snapshot.retry).retryable),
        matchedPolicyCount: Number(snapshot.matchedPolicyCount ?? asObject(audit).matchedPolicyIds?.length ?? 0),
        lifecycleCommand: snapshot.lifecycleCommand || lifecycle.command || audit.lifecycleCommand || null,
        lifecycleNextAction: snapshot.lifecycleNextAction || lifecycle.nextAction || audit.lifecycleNextAction || null,
        lifecycleMode: snapshot.lifecycleMode || lifecycle.mode || null,
        lifecycleEnabled: snapshot.lifecycleEnabled ?? lifecycle.enabled ?? null,
        acceptanceStatus: snapshot.acceptanceStatus || routeAcceptance.status || audit.routeAcceptanceStatus || null,
        validationStatus: snapshot.validationStatus || validationSummary.status || audit.validationSummaryStatus || null,
        providerStatus: snapshot.providerStatus || provider.status || audit.providerContractStatus || null,
        proofHash: snapshot.proofHash || proof.proofHash || audit.proofHash || snapshot.auditHash || null,
        commitEligible: Boolean(snapshot.commitEligible ?? proof.outcome?.commitEligible ?? audit.proofCommitEligible),
        safeToApplySideEffects: Boolean(snapshot.safeToApplySideEffects ?? commitPlan.safeToApplySideEffects ?? audit.safeToApplySideEffects),
        restartSafeStatus: snapshot.restartSafeStatus || checkpoint.restartSafeStatus || audit.stateRestartSafeStatus || null,
        mutationStatus: snapshot.mutationStatus || mutation.status || audit.stateMutationStatus || null,
        idempotencyResult: snapshot.idempotencyResult || idempotency.result || audit.idempotencyResult || null,
        recoveryRequired: Boolean(snapshot.recoveryRequired ?? idempotency.recoveryRequired ?? audit.recoveryRequired),
        duplicateCommand: Boolean(snapshot.duplicateCommand ?? idempotency.duplicate ?? audit.duplicateCommand),
        durableWritePhase: snapshot.durableWritePhase || durableWrite.phase || audit.durableWritePhase || null,
        durableWriteId: snapshot.durableWriteId || durableWrite.writeId || audit.durableWriteId || null,
        nextRevision: Number.isFinite(Number(snapshot.nextRevision ?? checkpoint.nextRevision ?? audit.stateNextRevision))
          ? Number(snapshot.nextRevision ?? checkpoint.nextRevision ?? audit.stateNextRevision)
          : null,
        source: snapshot.source || 'input-history'
      };
    });
}

function classifyAnalyticsRisk(snapshot) {
  const riskyClass = ['shell', 'deploy', 'external-write'].includes(snapshot.decisionClass);
  const reason = String(snapshot.reason || '');
  const blocked = snapshot.decision === 'deny'
    || snapshot.guardrailStatus === 'blocked'
    || snapshot.acceptanceStatus === 'blocked'
    || snapshot.validationStatus === 'blocked';
  const sideEffecting = Boolean(snapshot.mutating || snapshot.requiresExternalHandoff || snapshot.safeToApplySideEffects);
  const reliabilityRisk = Boolean(snapshot.degraded || snapshot.retryable || snapshot.recoveryRequired);
  const riskTier = blocked && (riskyClass || sideEffecting || reliabilityRisk)
    ? 'critical'
    : blocked
      ? 'high'
      : riskyClass && sideEffecting
        ? 'elevated'
        : reliabilityRisk
          ? 'watch'
          : 'normal';
  const reportBucket = reason === 'explicit_allow_policy'
    ? 'granted_by_policy'
    : reason === 'explicit_deny_policy'
      ? 'denied_by_policy'
      : reason === 'no_matching_allow_policy'
        ? 'missing_allow_policy'
        : reason === 'capability_operation_blocked'
          ? 'operation_guardrail'
          : reason === 'operational_degraded_blocks_decision'
            ? 'operational_health'
            : reason.includes('handoff')
              ? 'handoff_control'
              : reason.includes('tenant')
                ? 'tenant_boundary'
                : snapshot.decision === 'allow'
                  ? 'allowed_other'
                  : 'blocked_other';

  return {
    riskTier,
    reportBucket,
    sideEffecting,
    blocked,
    riskyDecisionClass: riskyClass,
    exportSeverity: riskTier === 'critical' || riskTier === 'high'
      ? 'action_required'
      : riskTier === 'elevated' || riskTier === 'watch'
        ? 'review'
        : 'informational'
  };
}

function incrementCounter(counters, key, amount = 1) {
  counters[key] = (counters[key] || 0) + amount;
}

function buildDecisionAnalytics(current, history) {
  const counters = {
    totalEvaluations: history.length + 1,
    allowed: 0,
    denied: 0,
    degraded: 0,
    retryable: 0,
    explicitDeny: 0,
    validationBlocked: 0,
    lifecycleBlocked: 0,
    noMatchingAllow: 0,
    stalePolicyWarnings: 0,
    accepted: 0,
    blockedAcceptance: 0,
    providerBlocked: 0,
    clientRuntimeBlocked: 0,
    tenantBoundaryBlocked: 0,
    decisionFlips: 0
  };
  const operationCounters = {
    syscall: 0,
    file: 0,
    shell: 0,
    deploy: 0,
    externalWrite: 0,
    general: 0,
    mutating: 0,
    targetless: 0,
    requiresExternalHandoff: 0,
    guardrailBlocked: 0,
    sideEffecting: 0,
    riskyDecisionClass: 0,
    actionRequired: 0
  };
  const persistenceCounters = {
    commitEligible: 0,
    safeSideEffects: 0,
    recoveryRequired: 0,
    duplicateCommand: 0,
    idempotentReplay: 0,
    durableCommitted: 0,
    mutationRecovering: 0,
    mutationDenied: 0
  };
  const principals = {};
  const capabilities = {};
  const routes = {};
  const reasons = {};
  const lifecycleModes = {};
  const decisionClasses = {};
  const routeDomains = {};
  const guardrailStatuses = {};
  const riskTiers = {};
  const reportBuckets = {};
  const exportSeverities = {};
  const acceptanceStatuses = {};
  const restartSafeStatuses = {};
  const mutationStatuses = {};
  const idempotencyResults = {};
  const durableWritePhases = {};
  const ordered = [...history, {
    decision: current.decision,
    reason: current.reason,
    principal: current.request.principal,
    capability: current.request.capability || 'missing-capability',
    route: current.request.route,
    decisionClass: current.operation.decisionClass,
    routeDomain: current.operation.routeDomain,
    mutating: current.operation.mutating,
    requiresExternalHandoff: current.operation.requiresExternalHandoff,
    targetCount: current.operation.targets.length,
    guardrailStatus: current.operationGuardrails.status,
    degraded: current.health.degraded,
    retryable: current.retry.retryable,
    lifecycleMode: current.lifecycle.mode,
    acceptanceStatus: current.routeAcceptance?.status || null,
    commitEligible: Boolean(current.proofBundle?.outcome?.commitEligible),
    safeToApplySideEffects: Boolean(current.statePersistence?.commitPlan?.safeToApplySideEffects),
    restartSafeStatus: current.statePersistence?.checkpoint?.restartSafeStatus || null,
    mutationStatus: current.statePersistence?.stateMutation?.status || null,
    idempotencyResult: current.statePersistence?.idempotency?.result || null,
    recoveryRequired: Boolean(current.statePersistence?.idempotency?.recoveryRequired),
    duplicateCommand: Boolean(current.statePersistence?.idempotency?.duplicate),
    durableWritePhase: current.statePersistence?.commitPlan?.durableWrite?.phase || null
  }];

  for (const snapshot of ordered) {
    const risk = classifyAnalyticsRisk(snapshot);
    if (snapshot.decision === 'allow') {
      counters.allowed += 1;
    } else if (snapshot.decision === 'deny') {
      counters.denied += 1;
    }
    if (snapshot.degraded) counters.degraded += 1;
    if (snapshot.retryable) counters.retryable += 1;
    if (snapshot.reason === 'explicit_deny_policy') counters.explicitDeny += 1;
    if (snapshot.reason === 'validation_failed') counters.validationBlocked += 1;
    if (snapshot.reason === 'lifecycle_control_blocked') counters.lifecycleBlocked += 1;
    if (snapshot.reason === 'no_matching_allow_policy') counters.noMatchingAllow += 1;
    if (snapshot.reason === 'provider_contract_blocked' || snapshot.reason === 'external_handoff_blocked') counters.providerBlocked += 1;
    if (snapshot.reason === 'client_runtime_handoff_blocked') counters.clientRuntimeBlocked += 1;
    if (snapshot.reason === 'tenant_boundary_blocked') counters.tenantBoundaryBlocked += 1;
    if (snapshot.acceptanceStatus === 'accepted') counters.accepted += 1;
    if (snapshot.acceptanceStatus === 'blocked') counters.blockedAcceptance += 1;
    if (snapshot.decisionClass === 'syscall') operationCounters.syscall += 1;
    if (snapshot.decisionClass === 'file') operationCounters.file += 1;
    if (snapshot.decisionClass === 'shell') operationCounters.shell += 1;
    if (snapshot.decisionClass === 'deploy') operationCounters.deploy += 1;
    if (snapshot.decisionClass === 'external-write') operationCounters.externalWrite += 1;
    if (snapshot.decisionClass === 'general') operationCounters.general += 1;
    if (snapshot.mutating) operationCounters.mutating += 1;
    if (snapshot.targetCount === 0) operationCounters.targetless += 1;
    if (snapshot.requiresExternalHandoff) operationCounters.requiresExternalHandoff += 1;
    if (snapshot.guardrailStatus === 'blocked') operationCounters.guardrailBlocked += 1;
    if (risk.sideEffecting) operationCounters.sideEffecting += 1;
    if (risk.riskyDecisionClass) operationCounters.riskyDecisionClass += 1;
    if (risk.exportSeverity === 'action_required') operationCounters.actionRequired += 1;
    if (snapshot.commitEligible) persistenceCounters.commitEligible += 1;
    if (snapshot.safeToApplySideEffects) persistenceCounters.safeSideEffects += 1;
    if (snapshot.recoveryRequired) persistenceCounters.recoveryRequired += 1;
    if (snapshot.duplicateCommand) persistenceCounters.duplicateCommand += 1;
    if (snapshot.idempotencyResult === 'already_applied') persistenceCounters.idempotentReplay += 1;
    if (snapshot.durableWritePhase === 'committed' || snapshot.mutationStatus === 'committed') persistenceCounters.durableCommitted += 1;
    if (snapshot.mutationStatus === 'recovering') persistenceCounters.mutationRecovering += 1;
    if (snapshot.mutationStatus === 'denial_recorded') persistenceCounters.mutationDenied += 1;
    incrementCounter(principals, snapshot.principal);
    incrementCounter(capabilities, snapshot.capability);
    incrementCounter(routes, snapshot.route);
    incrementCounter(reasons, snapshot.reason);
    incrementCounter(decisionClasses, snapshot.decisionClass || 'unknown');
    incrementCounter(routeDomains, snapshot.routeDomain || 'unknown');
    if (snapshot.guardrailStatus) incrementCounter(guardrailStatuses, snapshot.guardrailStatus);
    incrementCounter(riskTiers, risk.riskTier);
    incrementCounter(reportBuckets, risk.reportBucket);
    incrementCounter(exportSeverities, risk.exportSeverity);
    if (snapshot.lifecycleMode) incrementCounter(lifecycleModes, snapshot.lifecycleMode);
    if (snapshot.acceptanceStatus) incrementCounter(acceptanceStatuses, snapshot.acceptanceStatus);
    if (snapshot.restartSafeStatus) incrementCounter(restartSafeStatuses, snapshot.restartSafeStatus);
    if (snapshot.mutationStatus) incrementCounter(mutationStatuses, snapshot.mutationStatus);
    if (snapshot.idempotencyResult) incrementCounter(idempotencyResults, snapshot.idempotencyResult);
    if (snapshot.durableWritePhase) incrementCounter(durableWritePhases, snapshot.durableWritePhase);
  }

  counters.stalePolicyWarnings = current.health.failures.filter((failure) => failure.code === 'stale_policy_snapshot').length;
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].decision !== ordered[index].decision) {
      counters.decisionFlips += 1;
    }
  }

  return {
    counters: {
      ...counters,
      operations: operationCounters,
      persistence: persistenceCounters
    },
    dimensions: {
      principals,
      capabilities,
      routes,
      reasons,
      decisionClasses,
      routeDomains,
      guardrailStatuses,
      riskTiers,
      reportBuckets,
      exportSeverities,
      lifecycleModes,
      acceptanceStatuses,
      restartSafeStatuses,
      mutationStatuses,
      idempotencyResults,
      durableWritePhases
    },
    rates: {
      denyRate: counters.totalEvaluations > 0 ? counters.denied / counters.totalEvaluations : 0,
      degradedRate: counters.totalEvaluations > 0 ? counters.degraded / counters.totalEvaluations : 0,
      retryableRate: counters.totalEvaluations > 0 ? counters.retryable / counters.totalEvaluations : 0,
      acceptanceRate: counters.totalEvaluations > 0 ? counters.accepted / counters.totalEvaluations : 0,
      decisionFlipRate: counters.totalEvaluations > 1 ? counters.decisionFlips / (counters.totalEvaluations - 1) : 0,
      commitEligibilityRate: counters.totalEvaluations > 0 ? persistenceCounters.commitEligible / counters.totalEvaluations : 0,
      recoveryRate: counters.totalEvaluations > 0 ? persistenceCounters.recoveryRequired / counters.totalEvaluations : 0,
      durableCommitRate: counters.totalEvaluations > 0 ? persistenceCounters.durableCommitted / counters.totalEvaluations : 0,
      mutatingRate: counters.totalEvaluations > 0 ? operationCounters.mutating / counters.totalEvaluations : 0,
      actionRequiredRate: counters.totalEvaluations > 0 ? operationCounters.actionRequired / counters.totalEvaluations : 0
    }
  };
}

function topDimensionEntries(values, limit = 5) {
  return Object.entries(values)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function buildAnalyticsExportContract({ snapshots, timeline, analytics, currentSnapshot, now }) {
  const csvColumns = [
    'sequence',
    'generatedAt',
    'requestId',
    'principal',
    'capability',
    'route',
    'decisionClass',
    'routeDomain',
    'mutating',
    'requiresExternalHandoff',
    'targetCount',
    'guardrailStatus',
    'riskTier',
    'reportBucket',
    'exportSeverity',
    'decision',
    'reason',
    'degraded',
    'retryable',
    'acceptanceStatus',
    'validationStatus',
    'providerStatus',
    'proofHash',
    'commitEligible',
    'safeToApplySideEffects',
    'restartSafeStatus',
    'mutationStatus',
    'idempotencyResult',
    'recoveryRequired',
    'duplicateCommand',
    'durableWritePhase',
    'durableWriteId',
    'nextRevision'
  ];
  const rows = snapshots.map((snapshot) => ({
    sequence: snapshot.sequence,
    generatedAt: snapshot.generatedAt,
    requestId: snapshot.requestId,
    principal: snapshot.principal,
    capability: snapshot.capability,
    route: snapshot.route,
    decisionClass: snapshot.decisionClass,
    routeDomain: snapshot.routeDomain,
    mutating: snapshot.mutating,
    requiresExternalHandoff: snapshot.requiresExternalHandoff,
    targetCount: snapshot.targetCount,
    guardrailStatus: snapshot.guardrailStatus,
    riskTier: snapshot.riskTier,
    reportBucket: snapshot.reportBucket,
    exportSeverity: snapshot.exportSeverity,
    decision: snapshot.decision,
    reason: snapshot.reason,
    degraded: snapshot.degraded,
    retryable: snapshot.retryable,
    acceptanceStatus: snapshot.acceptanceStatus,
    validationStatus: snapshot.validationStatus,
    providerStatus: snapshot.providerStatus,
    proofHash: snapshot.proofHash,
    commitEligible: snapshot.commitEligible,
    safeToApplySideEffects: snapshot.safeToApplySideEffects,
    restartSafeStatus: snapshot.restartSafeStatus,
    mutationStatus: snapshot.mutationStatus,
    idempotencyResult: snapshot.idempotencyResult,
    recoveryRequired: snapshot.recoveryRequired,
    duplicateCommand: snapshot.duplicateCommand,
    durableWritePhase: snapshot.durableWritePhase,
    durableWriteId: snapshot.durableWriteId,
    nextRevision: snapshot.nextRevision
  }));
  const firstAt = snapshots[0]?.generatedAt || now;
  const lastAt = currentSnapshot.generatedAt;

  return {
    schema: ANALYTICS_EXPORT_SCHEMA,
    generatedAt: now,
    surfaceId,
    manifest: {
      exportId: contractFingerprint({ schema: ANALYTICS_EXPORT_SCHEMA, firstAt, lastAt, counters: analytics.counters }),
      rowCount: rows.length,
      formats: ['json', 'csv', 'ndjson'],
      csvColumns,
      timelineSchema: REPORTING_TIMELINE_SCHEMA
    },
    jsonRows: rows,
    csvRows: rows.map((row) => csvColumns.map((column) => row[column] ?? '')),
    ndjsonRecords: rows.map((row) => ({ schema: ANALYTICS_EXPORT_SCHEMA, ...row })),
    rollups: {
      decisionTotals: { allow: analytics.counters.allowed, deny: analytics.counters.denied },
      reliabilityTotals: {
        degraded: analytics.counters.degraded,
        retryable: analytics.counters.retryable,
        stalePolicyWarnings: analytics.counters.stalePolicyWarnings
      },
      blockingTotals: {
        validationBlocked: analytics.counters.validationBlocked,
        lifecycleBlocked: analytics.counters.lifecycleBlocked,
        tenantBoundaryBlocked: analytics.counters.tenantBoundaryBlocked,
        providerBlocked: analytics.counters.providerBlocked,
        clientRuntimeBlocked: analytics.counters.clientRuntimeBlocked,
        noMatchingAllow: analytics.counters.noMatchingAllow
      },
      persistenceTotals: analytics.counters.persistence,
      operationTotals: analytics.counters.operations,
      topReasons: topDimensionEntries(analytics.dimensions.reasons),
      topCapabilities: topDimensionEntries(analytics.dimensions.capabilities),
      topRoutes: topDimensionEntries(analytics.dimensions.routes),
      topDecisionClasses: topDimensionEntries(analytics.dimensions.decisionClasses),
      topRouteDomains: topDimensionEntries(analytics.dimensions.routeDomains),
      topRiskTiers: topDimensionEntries(analytics.dimensions.riskTiers),
      topReportBuckets: topDimensionEntries(analytics.dimensions.reportBuckets),
      topRestartSafeStatuses: topDimensionEntries(analytics.dimensions.restartSafeStatuses),
      topMutationStatuses: topDimensionEntries(analytics.dimensions.mutationStatuses),
      topIdempotencyResults: topDimensionEntries(analytics.dimensions.idempotencyResults)
    },
    timelineWindow: {
      schema: REPORTING_TIMELINE_SCHEMA,
      firstAt,
      lastAt,
      eventCount: timeline.length,
      latestEvent: timeline[timeline.length - 1] || null
    }
  };
}

function buildReportingState(current, history, analytics, now) {
  const currentSnapshotBase = {
    sequence: history.length + 1,
    generatedAt: now,
    generatedAtMs: parseTimestampMs(now),
    requestId: current.request.id,
    principal: current.request.principal,
    capability: current.request.capability || 'missing-capability',
    route: current.request.route,
    decisionClass: current.operation.decisionClass,
    routeDomain: current.operation.routeDomain,
    mutating: current.operation.mutating,
    requiresExternalHandoff: current.operation.requiresExternalHandoff,
    targetCount: current.operation.targets.length,
    guardrailStatus: current.operationGuardrails.status,
    decision: current.decision,
    reason: current.reason,
    degraded: current.health.degraded,
    retryable: current.retry.retryable,
    matchedPolicyCount: current.audit.matchedPolicyIds.length,
    lifecycleCommand: current.lifecycle.command,
    lifecycleNextAction: current.lifecycle.nextAction,
    lifecycleMode: current.lifecycle.mode,
    lifecycleEnabled: current.lifecycle.enabled,
    acceptanceStatus: current.routeAcceptance?.status || null,
    validationStatus: current.validationSummary?.status || null,
    providerStatus: current.providerState?.status || null,
    proofHash: current.proofBundle?.proofHash || null,
    commitEligible: Boolean(current.proofBundle?.outcome?.commitEligible),
    safeToApplySideEffects: Boolean(current.statePersistence?.commitPlan?.safeToApplySideEffects),
    restartSafeStatus: current.statePersistence?.checkpoint?.restartSafeStatus || null,
    mutationStatus: current.statePersistence?.stateMutation?.status || null,
    idempotencyResult: current.statePersistence?.idempotency?.result || null,
    recoveryRequired: Boolean(current.statePersistence?.idempotency?.recoveryRequired),
    duplicateCommand: Boolean(current.statePersistence?.idempotency?.duplicate),
    durableWritePhase: current.statePersistence?.commitPlan?.durableWrite?.phase || null,
    durableWriteId: current.statePersistence?.commitPlan?.durableWrite?.writeId || null,
    nextRevision: current.statePersistence?.checkpoint?.nextRevision ?? null,
    source: 'current-evaluation'
  };
  const currentSnapshot = {
    ...currentSnapshotBase,
    ...classifyAnalyticsRisk(currentSnapshotBase)
  };
  const snapshots = [...history, currentSnapshot]
    .slice(-MAX_HISTORY_SNAPSHOTS)
    .map((snapshot) => ({
      ...snapshot,
      ...classifyAnalyticsRisk(snapshot)
    }));
  const timeline = snapshots.map((snapshot, index) => {
    const previous = snapshots[index - 1] || null;
    return {
      schema: REPORTING_TIMELINE_SCHEMA,
      sequence: snapshot.sequence,
      at: snapshot.generatedAt,
      event: `policy.${snapshot.decision}`,
      requestId: snapshot.requestId,
      capability: snapshot.capability,
      route: snapshot.route,
      decisionClass: snapshot.decisionClass,
      routeDomain: snapshot.routeDomain,
      reason: snapshot.reason,
      riskTier: snapshot.riskTier,
      reportBucket: snapshot.reportBucket,
      exportSeverity: snapshot.exportSeverity,
      degraded: snapshot.degraded,
      lifecycleNextAction: snapshot.lifecycleNextAction || null,
      acceptanceStatus: snapshot.acceptanceStatus || null,
      validationStatus: snapshot.validationStatus || null,
      proofHash: snapshot.proofHash || null,
      commitEligible: snapshot.commitEligible,
      restartSafeStatus: snapshot.restartSafeStatus || null,
      mutationStatus: snapshot.mutationStatus || null,
      recoveryRequired: snapshot.recoveryRequired,
      durableWritePhase: snapshot.durableWritePhase || null,
      reportAction: snapshot.exportSeverity === 'action_required'
        ? 'investigate_before_grant'
        : snapshot.exportSeverity === 'review'
          ? 'include_in_operator_review'
          : 'archive_for_trend',
      transition: previous
        ? `${previous.decision}->${snapshot.decision}`
        : `start->${snapshot.decision}`
    };
  });
  const exportContract = buildAnalyticsExportContract({ snapshots, timeline, analytics, currentSnapshot, now });

  return {
    history: {
      maxSnapshots: MAX_HISTORY_SNAPSHOTS,
      snapshotCount: snapshots.length,
      latest: currentSnapshot,
      snapshots
    },
    timeline,
    exportSummary: {
      schema: 'aios.capabilitySecurity.policyEvaluator.analytics.v1',
      surfaceId,
      generatedAt: now,
      window: {
        firstAt: snapshots[0]?.generatedAt || now,
        lastAt: currentSnapshot.generatedAt,
        evaluationCount: analytics.counters.totalEvaluations
      },
      decisionTotals: {
        allow: analytics.counters.allowed,
        deny: analytics.counters.denied
      },
      reliabilityTotals: {
        degraded: analytics.counters.degraded,
        retryable: analytics.counters.retryable,
        stalePolicyWarnings: analytics.counters.stalePolicyWarnings
      },
      persistenceTotals: analytics.counters.persistence,
      operationTotals: analytics.counters.operations,
      controlTotals: {
        validationBlocked: analytics.counters.validationBlocked,
        lifecycleBlocked: analytics.counters.lifecycleBlocked,
        noMatchingAllow: analytics.counters.noMatchingAllow
      },
      topDimensions: {
        principals: topDimensionEntries(analytics.dimensions.principals),
        capabilities: topDimensionEntries(analytics.dimensions.capabilities),
        routes: topDimensionEntries(analytics.dimensions.routes),
        reasons: topDimensionEntries(analytics.dimensions.reasons),
        decisionClasses: topDimensionEntries(analytics.dimensions.decisionClasses),
        routeDomains: topDimensionEntries(analytics.dimensions.routeDomains),
        riskTiers: topDimensionEntries(analytics.dimensions.riskTiers),
        reportBuckets: topDimensionEntries(analytics.dimensions.reportBuckets)
      },
      exportId: exportContract.manifest.exportId,
      exportSchema: exportContract.schema
    },
    exportContract
  };
}

function finiteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeOperationalHealth(input, nowMs) {
  const dependencies = asObject(input.dependencies);
  const source = asObject(input.operationalHealth || dependencies.operationalHealth || input.health);
  const queue = asObject(source.queue || source.evaluationQueue);
  const circuitBreaker = asObject(source.circuitBreaker || source.breaker);
  const worker = asObject(source.worker || source.validationWorker);
  const lastSuccessAt = source.lastSuccessAt || source.lastHealthyAt || worker.lastSuccessAt || null;
  const lastErrorAt = source.lastErrorAt || worker.lastErrorAt || null;
  const lastSuccessAtMs = parseTimestampMs(lastSuccessAt) || finiteNumber(source.lastSuccessAtMs || worker.lastSuccessAtMs, null);
  const lastErrorAtMs = parseTimestampMs(lastErrorAt) || finiteNumber(source.lastErrorAtMs || worker.lastErrorAtMs, null);
  const maxSuccessAgeMs = finiteNumber(source.maxSuccessAgeMs ?? source.successStaleAfterMs, DEFAULT_STALE_AFTER_MS * 5);
  const depth = finiteNumber(queue.depth ?? queue.pending ?? source.queueDepth, 0);
  const maxDepth = finiteNumber(queue.maxDepth ?? queue.backlogThreshold ?? source.maxQueueDepth, 100);
  const retryAfterMs = finiteNumber(source.retryAfterMs ?? circuitBreaker.retryAfterMs ?? queue.retryAfterMs, null);
  const consecutiveFailures = finiteNumber(source.consecutiveFailures ?? worker.consecutiveFailures, 0);
  const maxConsecutiveFailures = finiteNumber(source.maxConsecutiveFailures ?? worker.maxConsecutiveFailures, 3);
  const workerStatus = worker.status || source.workerStatus || 'ready';
  const circuitState = circuitBreaker.state || circuitBreaker.status || source.circuitState || 'closed';
  const failureState = source.failureState || source.mode || null;
  const lastSuccessAgeMs = lastSuccessAtMs ? Math.max(0, nowMs - lastSuccessAtMs) : null;
  const lastErrorAgeMs = lastErrorAtMs ? Math.max(0, nowMs - lastErrorAtMs) : null;
  const failures = [];

  if (source.status && !['ready', 'healthy', 'ok'].includes(source.status)) {
    failures.push(actionableError(
      'operational_health_degraded',
      'Policy evaluator operational health is degraded',
      'Drain or repair the evaluator runtime before granting hosted-kernel capabilities.',
      source.status === 'degraded' ? 'warning' : 'error',
      { retryAfterMs }
    ));
  }
  if (circuitState === 'open') {
    failures.push(actionableError(
      'policy_evaluator_circuit_open',
      'Policy evaluator circuit breaker is open',
      'Wait for the circuit breaker retry window or restore the failing dependency before re-evaluating.',
      'error',
      { retryAfterMs }
    ));
  }
  if (depth > maxDepth) {
    failures.push(actionableError(
      'evaluation_queue_backlog',
      'Policy evaluation queue backlog exceeds the operational threshold',
      'Reduce queued evaluations or increase evaluator capacity before accepting new capability grants.',
      'warning',
      { retryAfterMs }
    ));
  }
  if (!['ready', 'active', 'healthy', 'unknown'].includes(workerStatus)) {
    failures.push(actionableError(
      'validation_worker_unavailable',
      'Policy validation worker is not ready',
      'Restart or reconnect the validation worker before completing capability acceptance.',
      'error',
      { retryAfterMs }
    ));
  }
  if (lastSuccessAgeMs !== null && maxSuccessAgeMs !== null && lastSuccessAgeMs > maxSuccessAgeMs) {
    failures.push(actionableError(
      'policy_evaluator_no_recent_success',
      'Policy evaluator has no recent successful evaluation',
      'Run a fresh evaluator health probe or reload the evaluator before granting capabilities.',
      'warning',
      { retryAfterMs }
    ));
  }
  if (consecutiveFailures >= maxConsecutiveFailures && maxConsecutiveFailures > 0) {
    failures.push(actionableError(
      'operational_health_degraded',
      'Policy evaluator consecutive failure threshold has been reached',
      'Pause acceptance and inspect recent evaluator errors before retrying capability evaluation.',
      'error',
      { retryAfterMs }
    ));
  }

  const blocking = failures.some((failure) => failure.severity === 'error');
  const degraded = failures.length > 0 || circuitState !== 'closed' || Boolean(failureState);

  return {
    schema: OPERATIONAL_HEALTH_SCHEMA,
    status: blocking ? 'unhealthy' : degraded ? 'degraded' : 'healthy',
    degraded,
    mode: failureState || (circuitState === 'open' ? 'fail_closed' : degraded ? 'limited' : 'normal'),
    circuitBreaker: {
      state: circuitState,
      retryAfterMs
    },
    queue: {
      depth,
      maxDepth,
      backlog: depth > maxDepth
    },
    worker: {
      status: workerStatus,
      consecutiveFailures,
      maxConsecutiveFailures
    },
    lastSuccessAt,
    lastSuccessAgeMs,
    lastErrorAt,
    lastErrorAgeMs,
    failures
  };
}

function operationalActionForFailure(failure) {
  if (failure.code === 'policy_evaluator_circuit_open') {
    return {
      action: 'wait_for_circuit_half_open',
      owner: 'runtime-operator',
      route: 'hosted-kernel.health.circuit-breaker',
      requiresHuman: false
    };
  }
  if (failure.code === 'evaluation_queue_backlog') {
    return {
      action: 'drain_evaluation_queue',
      owner: 'runtime-operator',
      route: 'hosted-kernel.health.queue',
      requiresHuman: false
    };
  }
  if (failure.code === 'validation_worker_unavailable') {
    return {
      action: 'restart_validation_worker',
      owner: 'capability-security-oncall',
      route: 'hosted-kernel.worker.validation',
      requiresHuman: true
    };
  }
  if (failure.code === 'policy_store_unavailable' || failure.code === 'stale_policy_snapshot') {
    return {
      action: 'reload_signed_policy_snapshot',
      owner: 'policy-store',
      route: 'hosted-kernel.policy-store.reload',
      requiresHuman: failure.severity === 'error'
    };
  }
  if (failure.code === 'audit_sink_unavailable') {
    return {
      action: 'buffer_audit_proof_and_reconnect_sink',
      owner: 'audit-pipeline',
      route: 'hosted-kernel.audit-sink',
      requiresHuman: false
    };
  }
  if (failure.code === 'kernel_state_unavailable') {
    return {
      action: 'wait_for_kernel_state_sync',
      owner: 'kernel-state',
      route: 'hosted-kernel.state-sync',
      requiresHuman: false
    };
  }
  if (failure.code === 'policy_evaluator_no_recent_success') {
    return {
      action: 'run_health_probe_before_acceptance',
      owner: 'capability-security-oncall',
      route: 'hosted-kernel.health.probe',
      requiresHuman: false
    };
  }
  return {
    action: failure.retryable ? 'retry_after_backoff' : 'resolve_configuration_error',
    owner: failure.retryable ? 'runtime-operator' : 'capability-security-oncall',
    route: 'hosted-kernel.policy-evaluator',
    requiresHuman: !failure.retryable
  };
}

function buildOperationalResponseContract({ input, operational, failures, policyAgeMs, staleAfterMs, nowMs }) {
  const source = asObject(input.operationalHealth || input.dependencies?.operationalHealth || input.health);
  const controls = asObject(source.controls || input.operationalControls);
  const blockingFailures = failures.filter((failure) => failure.severity === 'error');
  const warningFailures = failures.filter((failure) => failure.severity === 'warning');
  const retry = buildRetryPlan(failures, input.attempt);
  const failClosed = input.failClosedOnDegraded !== false && controls.failClosedOnDegraded !== false;
  const allowReadOnlyDegraded = Boolean(controls.allowReadOnlyDegraded || input.allowReadOnlyDegraded);
  const readOnlyEligible = allowReadOnlyDegraded
    && blockingFailures.length === 0
    && warningFailures.length > 0
    && !failures.some((failure) => ['audit_sink_unavailable', 'kernel_state_unavailable'].includes(failure.code));
  const responseMode = blockingFailures.length > 0 && failClosed
    ? 'fail_closed'
    : readOnlyEligible
      ? 'read_only_degraded'
      : warningFailures.length > 0
        ? 'continue_with_warnings'
        : 'normal';
  const retryAtMs = retry.nextAttemptAfterMs !== null ? nowMs + retry.nextAttemptAfterMs : null;
  const actions = failures.map((failure) => ({
    code: failure.code,
    severity: failure.severity,
    retryable: failure.retryable,
    retryAfterMs: Number.isFinite(Number(failure.retryAfterMs)) ? Number(failure.retryAfterMs) : null,
    remediation: failure.remediation,
    ...operationalActionForFailure(failure)
  }));
  const primaryAction = actions.find((action) => action.severity === 'error')
    || actions.find((action) => action.severity === 'warning')
    || null;
  const escalationRequired = actions.some((action) => action.requiresHuman && action.severity === 'error');
  const uniqueOwners = [...new Set(actions.map((action) => action.owner))];

  return {
    schema: OPERATIONAL_RESPONSE_SCHEMA,
    incidentId: failures.length > 0
      ? contractFingerprint({
        schema: OPERATIONAL_RESPONSE_SCHEMA,
        codes: failures.map((failure) => failure.code),
        operationalStatus: operational.status,
        circuitState: operational.circuitBreaker.state,
        queueDepth: operational.queue.depth,
        workerStatus: operational.worker.status
      })
      : null,
    status: failures.length === 0
      ? 'clear'
      : blockingFailures.length > 0
        ? 'blocked'
        : 'actionable_warning',
    responseMode,
    failClosed,
    readOnlyEligible,
    retry,
    retryWindow: {
      scheduled: retry.retryable,
      nextAttemptAfterMs: retry.nextAttemptAfterMs,
      nextAttemptAt: retryAtMs ? new Date(retryAtMs).toISOString() : null,
      backoffStrategy: retry.backoffStrategy,
      reasons: retry.retryReasons
    },
    degradationPolicy: {
      canEvaluate: responseMode !== 'fail_closed',
      canCommitGrant: responseMode === 'normal' || responseMode === 'continue_with_warnings',
      canPresentPreview: responseMode !== 'fail_closed' || failures.every((failure) => failure.retryable),
      sideEffectsAllowed: responseMode === 'normal',
      reason: responseMode === 'fail_closed'
        ? 'blocking_operational_failure'
        : responseMode === 'read_only_degraded'
          ? 'warnings_limited_to_preview'
          : responseMode === 'continue_with_warnings'
            ? 'non_blocking_operational_warnings'
            : 'operational_health_clear'
    },
    failureState: {
      blockingCodes: blockingFailures.map((failure) => failure.code),
      warningCodes: warningFailures.map((failure) => failure.code),
      policyAgeMs,
      staleAfterMs,
      circuitState: operational.circuitBreaker.state,
      queueBacklog: operational.queue.backlog,
      workerStatus: operational.worker.status,
      consecutiveFailures: operational.worker.consecutiveFailures,
      lastSuccessAgeMs: operational.lastSuccessAgeMs,
      lastErrorAgeMs: operational.lastErrorAgeMs
    },
    actions,
    primaryAction,
    escalation: {
      required: escalationRequired,
      owners: uniqueOwners,
      route: escalationRequired ? primaryAction?.route || 'hosted-kernel.policy-evaluator' : null
    }
  };
}

function computeHealth(input, nowMs) {
  const dependencies = asObject(input.dependencies);
  const policyStore = asObject(dependencies.policyStore);
  const auditSink = asObject(dependencies.auditSink);
  const kernelState = asObject(input.kernelState);
  const staleAfterMs = Number(input.staleAfterMs) > 0 ? Number(input.staleAfterMs) : DEFAULT_STALE_AFTER_MS;
  const lastPolicyLoadMs = Number(policyStore.lastLoadedAtMs || input.lastPolicyLoadMs || 0);
  const policyAgeMs = lastPolicyLoadMs > 0 ? Math.max(0, nowMs - lastPolicyLoadMs) : null;
  const failures = [];
  const operational = normalizeOperationalHealth(input, nowMs);

  if (policyStore.status && policyStore.status !== 'ready') {
    failures.push(actionableError('policy_store_unavailable', 'Policy store is not ready', 'Retry after refreshing the policy store dependency.'));
  }
  if (auditSink.status && auditSink.status !== 'ready') {
    failures.push(actionableError('audit_sink_unavailable', 'Audit sink is not ready', 'Buffer the evaluation proof and retry audit delivery.'));
  }
  if (kernelState.status && kernelState.status !== 'ready') {
    failures.push(actionableError('kernel_state_unavailable', 'Kernel state is not ready', 'Retry when hosted-kernel state synchronization completes.'));
  }
  if (policyAgeMs !== null && policyAgeMs > staleAfterMs) {
    failures.push(actionableError('stale_policy_snapshot', 'Policy snapshot is stale', 'Reload policies before granting new capability access.', 'warning'));
  }

  failures.push(...operational.failures);

  const degraded = operational.degraded || failures.some((failure) => failure.retryable || failure.code === 'stale_policy_snapshot');
  const operationalResponse = buildOperationalResponseContract({
    input,
    operational,
    failures,
    policyAgeMs,
    staleAfterMs,
    nowMs
  });
  return {
    status: failures.some((failure) => failure.severity === 'error') ? (degraded ? 'degraded' : 'unhealthy') : degraded ? 'degraded' : 'healthy',
    degraded,
    policyAgeMs,
    staleAfterMs,
    operational,
    operationalResponse,
    failures
  };
}

function buildOperationalDecisionGate(input, operation, health, nowMs) {
  const source = asObject(input.operationalHealth || input.dependencies?.operationalHealth || input.health);
  const controls = asObject(source.controls || input.operationalControls);
  const response = health.operationalResponse;
  const riskyClass = ['shell', 'deploy', 'external-write'].includes(operation.decisionClass);
  const mutatingKernelSurface = operation.mutating && ['syscall', 'file'].includes(operation.decisionClass);
  const readOnlyCompatible = !operation.mutating
    && !operation.requiresExternalHandoff
    && ['file', 'syscall', 'general'].includes(operation.decisionClass);
  const blockRiskyWarnings = controls.blockRiskyClassesOnWarning !== false;
  const allowReadOnlyDegraded = response.readOnlyEligible && readOnlyCompatible;
  const failClosed = response.responseMode === 'fail_closed';
  const warningOnlyRiskBlock = Boolean(
    response.responseMode === 'continue_with_warnings'
    && blockRiskyWarnings
    && (riskyClass || mutatingKernelSurface)
  );
  const degradedReadOnlyMismatch = Boolean(
    response.responseMode === 'read_only_degraded'
    && !readOnlyCompatible
  );
  const blocksDecision = Boolean(failClosed || degradedReadOnlyMismatch || warningOnlyRiskBlock);
  const retryAfterMs = response.retryWindow.nextAttemptAfterMs
    ?? health.operational.circuitBreaker.retryAfterMs
    ?? null;
  const blockReason = failClosed
    ? 'operational_response_fail_closed'
    : degradedReadOnlyMismatch
      ? 'degraded_mode_requires_read_only_operation'
      : warningOnlyRiskBlock
        ? 'risky_operation_blocked_while_degraded'
        : null;
  const failure = blocksDecision
    ? actionableError(
      'operational_degraded_blocks_decision',
      'Operational health prevents this capability decision class from being granted',
      failClosed
        ? 'Resolve blocking operational failures or wait for the retry window before granting hosted-kernel capabilities.'
        : readOnlyCompatible
          ? 'Retry after the degraded dependency clears, or evaluate as read-only preview without committing the grant.'
          : 'Retry after operational health returns to normal before granting shell, deploy, external-write, or mutating kernel capabilities.',
      'error',
      {
        schema: OPERATIONAL_DECISION_GATE_SCHEMA,
        blockReason,
        decisionClass: operation.decisionClass,
        mutating: operation.mutating,
        requiresExternalHandoff: operation.requiresExternalHandoff,
        responseMode: response.responseMode,
        incidentId: response.incidentId,
        retryAfterMs,
        retryAt: retryAfterMs !== null ? new Date(nowMs + retryAfterMs).toISOString() : null,
        blockingOperationalCodes: response.failureState.blockingCodes,
        warningOperationalCodes: response.failureState.warningCodes
      }
    )
    : null;

  return {
    schema: OPERATIONAL_DECISION_GATE_SCHEMA,
    status: blocksDecision ? 'blocked' : health.degraded ? allowReadOnlyDegraded ? 'read_only_allowed' : 'degraded_allowed' : 'passed',
    decisionClass: operation.decisionClass,
    routeDomain: operation.routeDomain,
    mutating: operation.mutating,
    requiresExternalHandoff: operation.requiresExternalHandoff,
    responseMode: response.responseMode,
    blockReason,
    blocksDecision,
    readOnlyCompatible,
    allowReadOnlyDegraded,
    riskyClass,
    mutatingKernelSurface,
    retry: {
      retryable: blocksDecision && Boolean(retryAfterMs !== null || response.retry.retryable),
      nextAttemptAfterMs: retryAfterMs,
      nextAttemptAt: retryAfterMs !== null ? new Date(nowMs + retryAfterMs).toISOString() : null,
      reasons: response.retryWindow.reasons
    },
    degradationPolicy: {
      canEvaluate: response.degradationPolicy.canEvaluate && !failClosed,
      canPreview: response.degradationPolicy.canPresentPreview || allowReadOnlyDegraded,
      canCommitGrant: response.degradationPolicy.canCommitGrant && !blocksDecision,
      sideEffectsAllowed: response.degradationPolicy.sideEffectsAllowed && !blocksDecision,
      operatorAction: response.primaryAction?.action || null
    },
    failures: failure ? [failure] : []
  };
}

function normalizeProviderContracts(input) {
  const dependencies = asObject(input.dependencies);
  const nowMs = Number.isFinite(Date.parse(input.now)) ? Date.parse(input.now) : Date.now();
  const rawContracts = Array.isArray(input.providerContracts)
    ? input.providerContracts
    : Array.isArray(input.providers)
      ? input.providers
      : Array.isArray(dependencies.providers)
        ? dependencies.providers
        : [];

  return rawContracts
    .filter((contract) => contract && typeof contract === 'object')
    .map((contract, index) => {
      const sync = asObject(contract.sync || contract.syncMetadata);
      const handoff = asObject(contract.handoff || contract.externalHandoff);
      const capabilities = Array.isArray(contract.capabilities)
        ? contract.capabilities
        : Array.isArray(contract.providedCapabilities)
          ? contract.providedCapabilities
          : [];
      const routes = Array.isArray(contract.routes) ? contract.routes : ['*'];
      const serviceContract = asObject(contract.serviceContract || contract.contract);
      const serviceScopes = asObject(contract.scopes || serviceContract.scopes);
      const handoffModes = normalizeStringList(contract.handoffModes || handoff.handoffModes || serviceContract.handoffModes);
      const operations = normalizeStringList(contract.operations || contract.supportedOperations || serviceContract.operations);
      const features = normalizeStringList(contract.features || contract.supportedFeatures || serviceContract.features || serviceContract.capabilities);
      const requiredClaims = normalizeStringList(contract.requiredClaims || serviceContract.requiredClaims || contract.claims);
      const lastSyncedAt = sync.lastSyncedAt || contract.lastSyncedAt || null;
      const lastSyncedAtMs = parseTimestampMs(lastSyncedAt) || finiteNumber(sync.lastSyncedAtMs ?? contract.lastSyncedAtMs, null);
      const maxSyncAgeMs = finiteNumber(sync.maxAgeMs ?? sync.maxSyncAgeMs ?? serviceContract.maxSyncAgeMs ?? contract.maxSyncAgeMs, null);
      const syncAgeMs = lastSyncedAtMs ? Math.max(0, nowMs - lastSyncedAtMs) : null;
      const requiresCursor = Boolean(sync.requiresCursor || serviceContract.requiresCursor || contract.requiresCursor);
      const requiresEpoch = Boolean(sync.requiresEpoch || serviceContract.requiresEpoch || contract.requiresEpoch);
      const cursor = sync.cursor || sync.syncCursor || contract.syncCursor || null;
      const epoch = sync.epoch || sync.syncEpoch || contract.syncEpoch || null;
      const staleByAge = Boolean(maxSyncAgeMs !== null && syncAgeMs !== null && syncAgeMs > maxSyncAgeMs);
      const missingCursor = Boolean(requiresCursor && !cursor);
      const missingEpoch = Boolean(requiresEpoch && !epoch);
      const handoffCheckpoint = asObject(handoff.checkpoint || handoff.handoffCheckpoint || contract.handoffCheckpoint);
      const checkpointState = handoffCheckpoint.state || handoffCheckpoint.status || handoff.checkpointState || contract.handoffCheckpointState || null;
      const checkpointId = handoffCheckpoint.id || handoffCheckpoint.checkpointId || contract.handoffCheckpointId || null;
      const checkpointCursor = handoffCheckpoint.cursor || handoffCheckpoint.syncCursor || null;
      return {
        id: contract.id || contract.providerId || `provider-contract-${index + 1}`,
        service: contract.service || contract.name || 'unnamed-provider',
        kind: contract.kind || contract.type || 'capability-provider',
        status: contract.status || 'unknown',
        capabilities: capabilities.length > 0 ? capabilities : ['*'],
        routes: routes.length > 0 ? routes : ['*'],
        contractVersion: contract.contractVersion || contract.version || 'unversioned',
        sync: {
          schema: PROVIDER_SYNC_STATUS_SCHEMA,
          cursor,
          policyVersion: sync.policyVersion || contract.policyVersion || null,
          lastSyncedAt,
          lastSyncedAtMs,
          ageMs: syncAgeMs,
          maxAgeMs: maxSyncAgeMs,
          epoch,
          source: sync.source || contract.syncSource || contract.service || contract.name || 'provider-contract',
          stale: Boolean(sync.stale || contract.syncStale || staleByAge || missingCursor || missingEpoch),
          requiresCursor,
          requiresEpoch,
          blockedReasons: [
            ...(sync.stale || contract.syncStale ? ['provider_sync_marked_stale'] : []),
            ...(staleByAge ? ['provider_sync_age_exceeded'] : []),
            ...(missingCursor ? ['provider_sync_cursor_missing'] : []),
            ...(missingEpoch ? ['provider_sync_epoch_missing'] : [])
          ]
        },
        handoff: {
          acceptsExternalHandoff: handoff.acceptsExternalHandoff !== false && contract.acceptsExternalHandoff !== false,
          endpoint: handoff.endpoint || contract.endpoint || null,
          state: handoff.state || contract.handoffState || 'ready',
          modes: handoffModes.length > 0 ? handoffModes : ['external-execution'],
          checkpoint: {
            id: checkpointId,
            state: checkpointState,
            cursor: checkpointCursor,
            committedAt: handoffCheckpoint.committedAt || handoffCheckpoint.appliedAt || null,
            required: Boolean(handoffCheckpoint.required || handoff.requireCheckpoint || contract.requireHandoffCheckpoint)
          }
        },
        serviceContract: {
          schema: PROVIDER_NEGOTIATION_SCHEMA,
          protocol: serviceContract.protocol || contract.protocol || 'hosted-kernel-provider',
          minConsumerVersion: serviceContract.minConsumerVersion || contract.minConsumerVersion || null,
          operations: operations.length > 0 ? operations : ['execute'],
          features: features.length > 0 ? features : ['basic-policy-evaluation'],
          requiredClaims,
          scopes: {
            tenants: normalizeStringList(serviceScopes.tenants || contract.tenants || contract.tenantIds).length > 0
              ? normalizeStringList(serviceScopes.tenants || contract.tenants || contract.tenantIds)
              : ['*'],
            workspaces: normalizeStringList(serviceScopes.workspaces || contract.workspaces || contract.workspaceIds).length > 0
              ? normalizeStringList(serviceScopes.workspaces || contract.workspaces || contract.workspaceIds)
              : ['*']
          },
          requiredPolicyVersion: serviceContract.requiredPolicyVersion || contract.requiredPolicyVersion || null,
          syncReadinessPolicy: sync.staleMode || serviceContract.syncReadinessPolicy || contract.syncReadinessPolicy || 'block_stale_required_provider',
          handoffCheckpointPolicy: handoffCheckpoint.policy || serviceContract.handoffCheckpointPolicy || contract.handoffCheckpointPolicy || 'require_committed_checkpoint_when_declared'
        }
      };
    });
}

function providerFeatureRequirementsForOperation(operation = {}) {
  const decisionClass = operation.decisionClass || 'general';
  const requirements = new Set(['policy-decision-receipt']);

  if (decisionClass === 'syscall') {
    requirements.add('kernel-syscall-dispatch');
    requirements.add('syscall-audit-bindings');
  } else if (decisionClass === 'file') {
    requirements.add('filesystem-target-canonicalization');
    if (operation.mutating) requirements.add('filesystem-write-journal');
  } else if (decisionClass === 'shell') {
    requirements.add('shell-command-attestation');
    requirements.add('shell-execution-envelope');
  } else if (decisionClass === 'deploy') {
    requirements.add('deployment-target-binding');
    requirements.add('release-promotion-handoff');
    requirements.add('rollback-checkpoint');
  } else if (decisionClass === 'external-write') {
    requirements.add('external-destination-binding');
    requirements.add('egress-write-handoff');
    requirements.add('idempotency-key');
  }

  if (operation.mutating) {
    requirements.add('side-effect-lease');
  }
  if (operation.requiresExternalHandoff) {
    requirements.add('external-handoff-state');
  }
  if (operation.targetBoundary?.canonicalizationRequired || operation.targetBoundary?.traversalDetected) {
    requirements.add('canonical-target-boundary');
  }

  return [...requirements];
}

function contractVersionRank(value) {
  const parts = String(value || '')
    .match(/\d+/g);
  if (!parts) return 0;
  return parts
    .slice(0, 3)
    .reduce((rank, part, index) => rank + (Number(part) || 0) * (100 ** (2 - index)), 0);
}

function normalizeProviderNegotiation(input, request, operation = {}) {
  const source = asObject(input.providerNegotiation || input.providerRequirements || input.serviceContract);
  const handoff = asObject(input.externalHandoff || input.handoff);
  const requiredClaims = normalizeStringList(source.requiredClaims || input.requiredProviderClaims);
  const requiredOperations = normalizeStringList(source.requiredOperations || source.operations || input.requiredProviderOperations);
  const explicitFeatures = normalizeStringList(source.requiredFeatures || source.features || input.requiredProviderFeatures);
  const operationFeatures = providerFeatureRequirementsForOperation(operation);
  const requiredSyncFreshnessMs = finiteNumber(source.requiredSyncFreshnessMs ?? source.maxProviderSyncAgeMs ?? input.maxProviderSyncAgeMs, null);

  return {
    schema: PROVIDER_NEGOTIATION_SCHEMA,
    required: Boolean(source.required || input.requireProviderNegotiation || input.requireProviderContract || input.requireExternalHandoff),
    requestedCapability: request.capability || 'missing-capability',
    requestedRoute: request.route,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    minContractVersion: source.minContractVersion || input.minProviderContractVersion || null,
    requiredPolicyVersion: source.requiredPolicyVersion || input.requiredProviderPolicyVersion || null,
    requiredOperations: requiredOperations.length > 0 ? requiredOperations : ['execute'],
    requiredFeatures: [...new Set([...operationFeatures, ...explicitFeatures])],
    featureBasis: {
      decisionClass: operation.decisionClass || 'general',
      mutating: Boolean(operation.mutating),
      requiresExternalHandoff: Boolean(operation.requiresExternalHandoff),
      targetBoundaryStatus: operation.targetBoundary?.status || 'unknown'
    },
    requiredClaims,
    handoffMode: source.handoffMode || handoff.mode || 'external-execution',
    requiredSyncFreshnessMs,
    requireSyncCursor: Boolean(source.requireSyncCursor || input.requireProviderSyncCursor),
    requireSyncEpoch: Boolean(source.requireSyncEpoch || input.requireProviderSyncEpoch),
    requireCommittedHandoffCheckpoint: Boolean(source.requireCommittedHandoffCheckpoint || handoff.requireCommittedCheckpoint || input.requireCommittedHandoffCheckpoint),
    requireTenantScope: Boolean(source.requireTenantScope || input.requireTenantScopedProvider),
    requireWorkspaceScope: Boolean(source.requireWorkspaceScope || input.requireWorkspaceScopedProvider)
  };
}

function buildProviderNegotiationResult(contract, request, negotiation) {
  const contractVersionOk = !negotiation.minContractVersion
    || contractVersionRank(contract.contractVersion) >= contractVersionRank(negotiation.minContractVersion);
  const policyVersionOk = !negotiation.requiredPolicyVersion
    || contract.sync.policyVersion === negotiation.requiredPolicyVersion
    || contract.serviceContract.requiredPolicyVersion === negotiation.requiredPolicyVersion;
  const operationOk = negotiation.requiredOperations.every((operation) => matchValue(contract.serviceContract.operations, operation));
  const missingRequiredFeatures = negotiation.requiredFeatures
    .filter((feature) => !matchValue(contract.serviceContract.features, feature));
  const featureOk = missingRequiredFeatures.length === 0;
  const claimOk = negotiation.requiredClaims.every((claim) => contract.serviceContract.requiredClaims.includes(claim));
  const handoffModeOk = matchValue(contract.handoff.modes, negotiation.handoffMode);
  const syncFreshnessOk = negotiation.requiredSyncFreshnessMs === null
    || (contract.sync.ageMs !== null && contract.sync.ageMs <= negotiation.requiredSyncFreshnessMs);
  const syncCursorOk = !negotiation.requireSyncCursor && !contract.sync.requiresCursor || Boolean(contract.sync.cursor);
  const syncEpochOk = !negotiation.requireSyncEpoch && !contract.sync.requiresEpoch || Boolean(contract.sync.epoch);
  const syncReady = !contract.sync.stale && syncFreshnessOk && syncCursorOk && syncEpochOk;
  const checkpoint = contract.handoff.checkpoint;
  const checkpointRequired = negotiation.requireCommittedHandoffCheckpoint || checkpoint.required;
  const checkpointCommitted = ['committed', 'applied', 'ready'].includes(checkpoint.state);
  const checkpointOk = !checkpointRequired || Boolean(checkpoint.id && checkpointCommitted);
  const tenantScopeOk = !negotiation.requireTenantScope
    || !request.tenantId
    || matchValue(contract.serviceContract.scopes.tenants, request.tenantId);
  const workspaceScopeOk = !negotiation.requireWorkspaceScope
    || !request.workspaceId
    || matchValue(contract.serviceContract.scopes.workspaces, request.workspaceId);
  const ready = ['ready', 'active'].includes(contract.status);
  const handoffReady = ready && contract.handoff.acceptsExternalHandoff && contract.handoff.state === 'ready' && handoffModeOk && checkpointOk;
  const blockedReasons = [
    ...(ready ? [] : ['provider_not_ready']),
    ...(contractVersionOk ? [] : ['contract_version_below_minimum']),
    ...(policyVersionOk ? [] : ['provider_policy_version_mismatch']),
    ...(operationOk ? [] : ['required_operation_not_supported']),
    ...(featureOk ? [] : ['required_provider_feature_missing']),
    ...(claimOk ? [] : ['required_claim_missing']),
    ...(handoffModeOk ? [] : ['handoff_mode_not_supported']),
    ...(syncReady ? [] : contract.sync.blockedReasons.length > 0 ? contract.sync.blockedReasons : ['provider_sync_not_ready']),
    ...(checkpointOk ? [] : ['handoff_checkpoint_not_committed']),
    ...(tenantScopeOk ? [] : ['provider_tenant_scope_mismatch']),
    ...(workspaceScopeOk ? [] : ['provider_workspace_scope_mismatch'])
  ];

  return {
    schema: PROVIDER_NEGOTIATION_SCHEMA,
    providerId: contract.id,
    service: contract.service,
    contractVersion: contract.contractVersion,
    protocol: contract.serviceContract.protocol,
    status: blockedReasons.length === 0 ? 'compatible' : 'blocked',
    ready,
    handoffReady,
    syncReady,
    checkpointReady: checkpointOk,
    selectedOperation: negotiation.requiredOperations[0] || 'execute',
    requiredFeatures: negotiation.requiredFeatures,
    providedFeatures: contract.serviceContract.features,
    missingRequiredFeatures,
    featureBasis: negotiation.featureBasis,
    handoffMode: negotiation.handoffMode,
    syncCursor: contract.sync.cursor,
    syncEpoch: contract.sync.epoch,
    syncAgeMs: contract.sync.ageMs,
    syncMaxAgeMs: contract.sync.maxAgeMs,
    policyVersion: contract.sync.policyVersion,
    handoffCheckpoint: {
      id: checkpoint.id,
      state: checkpoint.state,
      cursor: checkpoint.cursor,
      required: checkpointRequired
    },
    blockedReasons,
    satisfied: blockedReasons.length === 0
  };
}

function normalizeStringList(value) {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : [];
}

function listHasWildcard(values) {
  return values.includes('*');
}

function intersects(left, right) {
  return left.some((entry) => right.includes(entry));
}

function withoutWildcard(values) {
  return values.filter((entry) => entry !== '*');
}

function containsAll(allowedValues, requestedValues) {
  const allowed = new Set(withoutWildcard(allowedValues));
  const requested = withoutWildcard(requestedValues);
  return requested.every((entry) => allowed.has(entry));
}

function scopedIntersection(left, right) {
  if (listHasWildcard(left)) return withoutWildcard(right);
  if (listHasWildcard(right)) return withoutWildcard(left);
  return left.filter((entry) => right.includes(entry));
}

function hasScopedPolicy(policies) {
  return policies.some((policy) => (
    !listHasWildcard(policy.tenants)
    || !listHasWildcard(policy.workspaces)
    || !listHasWildcard(policy.roles)
    || !listHasWildcard(policy.permissions)
  ));
}

function policyMatchesTenantBoundary(policy, request, settings) {
  const tenantMatch = matchValue(policy.tenants, request.tenantId);
  const workspaceMatch = matchValue(policy.workspaces, request.workspaceId);
  const roleMatch = listHasWildcard(policy.roles)
    || (settings.requireAllPolicyRoles ? containsAll(request.roles, policy.roles) : intersects(policy.roles, request.roles));
  const permissionMatch = listHasWildcard(policy.permissions)
    || (settings.requireAllPolicyPermissions ? containsAll(request.permissions, policy.permissions) : intersects(policy.permissions, request.permissions));
  const crossTenantWildcard = listHasWildcard(policy.tenants) && !policy.boundary.allowCrossTenant && !settings.allowTenantWildcard;
  const workspaceWildcard = listHasWildcard(policy.workspaces) && !policy.boundary.allowWorkspaceWildcard && !settings.allowWorkspaceWildcard;

  return {
    policyId: policy.id,
    tenantMatch,
    workspaceMatch,
    roleMatch,
    permissionMatch,
    requiredRoles: withoutWildcard(policy.roles),
    requiredPermissions: withoutWildcard(policy.permissions),
    crossTenantWildcard,
    workspaceWildcard,
    matched: tenantMatch && workspaceMatch && roleMatch && permissionMatch && !crossTenantWildcard && !workspaceWildcard
  };
}

function normalizeWorkspaceGrants(input, request) {
  const boundary = asObject(input.tenantBoundary || input.boundaries?.tenant || input.securityBoundary);
  const rawGrants = Array.isArray(boundary.workspaceGrants)
    ? boundary.workspaceGrants
    : Array.isArray(input.workspaceGrants)
      ? input.workspaceGrants
      : Array.isArray(input.grants)
        ? input.grants
        : [];
  return rawGrants
    .filter((grant) => grant && typeof grant === 'object')
    .map((grant, index) => {
      const scope = asObject(grant.scope);
      const subject = asObject(grant.subject);
      const constraints = asObject(grant.constraints);
      const expiresAt = grant.expiresAt || constraints.expiresAt || null;
      const expiresAtMs = parseTimestampMs(expiresAt);
      return {
        schema: WORKSPACE_GRANT_SCHEMA,
        id: grant.id || grant.grantId || `workspace-grant-${index + 1}`,
        tenantId: grant.tenantId || scope.tenantId || null,
        workspaceId: grant.workspaceId || scope.workspaceId || null,
        principals: normalizeStringList(grant.principals || subject.principals || grant.principal || subject.principal),
        roles: normalizeStringList(grant.roles || subject.roles),
        permissions: normalizeStringList(grant.permissions || grant.allowedPermissions || constraints.permissions).length > 0
          ? normalizeStringList(grant.permissions || grant.allowedPermissions || constraints.permissions)
          : ['*'],
        targetPatterns: normalizePolicyTargetPatterns(grant.targets || grant.targetPatterns || grant.paths || constraints.targets || constraints.targetPatterns || constraints.paths),
        capabilities: normalizeStringList(grant.capabilities || grant.capability || constraints.capabilities).length > 0
          ? normalizeStringList(grant.capabilities || grant.capability || constraints.capabilities)
          : ['*'],
        routes: normalizeStringList(grant.routes || grant.route || constraints.routes).length > 0
          ? normalizeStringList(grant.routes || grant.route || constraints.routes)
          : ['*'],
        source: grant.source || grant.issuer || 'workspace-boundary',
        active: grant.active !== false && grant.status !== 'revoked' && grant.status !== 'disabled',
        expiresAt,
        expiresAtMs
      };
    });
}

function grantMatchesWorkspaceRequest(grant, request, nowMs, settings) {
  const tenantMatch = grant.tenantId === request.tenantId || (grant.tenantId === '*' && settings.allowTenantWildcard);
  const workspaceMatch = grant.workspaceId === request.workspaceId || (grant.workspaceId === '*' && settings.allowWorkspaceWildcard);
  const principalMatch = matchValue(grant.principals, request.principal) || intersects(grant.roles, request.roles) || listHasWildcard(grant.roles);
  const permissionMatch = listHasWildcard(grant.permissions)
    || (settings.requireAllRequestedPermissions ? containsAll(grant.permissions, request.permissions) : intersects(grant.permissions, request.permissions));
  const roleMatch = listHasWildcard(grant.roles)
    || grant.roles.length === 0
    || (settings.requireAllRequestedRoles ? containsAll(request.roles, grant.roles) : intersects(grant.roles, request.roles));
  const capabilityMatch = matchValue(grant.capabilities, request.capability);
  const routeMatch = matchValue(grant.routes, request.route);
  const expired = Boolean(grant.expiresAtMs && grant.expiresAtMs <= nowMs);
  const blockedReasons = [
    ...(grant.active ? [] : ['grant_inactive']),
    ...(expired ? ['grant_expired'] : []),
    ...(tenantMatch ? [] : ['tenant_mismatch']),
    ...(workspaceMatch ? [] : ['workspace_mismatch']),
    ...(principalMatch ? [] : ['principal_or_role_mismatch']),
    ...(roleMatch ? [] : ['role_mismatch']),
    ...(permissionMatch ? [] : ['permission_mismatch']),
    ...(capabilityMatch ? [] : ['capability_mismatch']),
    ...(routeMatch ? [] : ['route_mismatch'])
  ];

  return {
    grantId: grant.id,
    tenantId: grant.tenantId,
    workspaceId: grant.workspaceId,
    source: grant.source,
    active: grant.active,
    expired,
    tenantMatch,
    workspaceMatch,
    principalMatch,
    roleMatch,
    permissionMatch,
    capabilityMatch,
    routeMatch,
    roleCoverage: {
      required: withoutWildcard(grant.roles),
      provided: request.roles,
      matched: scopedIntersection(grant.roles, request.roles),
      requiresAll: settings.requireAllRequestedRoles
    },
    permissionCoverage: {
      required: withoutWildcard(request.permissions),
      granted: grant.permissions,
      matched: scopedIntersection(grant.permissions, request.permissions),
      requiresAll: settings.requireAllRequestedPermissions
    },
    matched: blockedReasons.length === 0,
    blockedReasons
  };
}

function targetPathForTenantScope(target) {
  if (target.kind === 'path') return target.normalized;
  if (target.kind !== 'url') return null;
  const match = target.normalized.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i);
  return match ? match[1] || '/' : null;
}

function defaultWorkspaceScopePatterns(request) {
  if (!request.tenantId || !request.workspaceId) return [];
  const tenant = encodeURIComponent(String(request.tenantId));
  const workspace = encodeURIComponent(String(request.workspaceId));
  return [
    `/tenants/${tenant}/workspaces/${workspace}/*`,
    `tenants/${tenant}/workspaces/${workspace}/*`,
    `/tenant/${tenant}/workspace/${workspace}/*`,
    `tenant/${tenant}/workspace/${workspace}/*`
  ];
}

function scopePatternsFromBoundary(boundary, selectedGrant) {
  const rawBoundaryPatterns = normalizePolicyTargetPatterns(
    boundary.targetPatterns
    || boundary.allowedTargetPatterns
    || boundary.workspaceTargetPatterns
    || boundary.pathPatterns
  );
  const grantPatterns = selectedGrant?.targetPatterns || [];
  return [...new Set([...rawBoundaryPatterns, ...grantPatterns])];
}

function targetMatchesScopePattern(targetPath, pattern) {
  if (!targetPath || !pattern) return false;
  const normalizedPattern = normalizePolicyTargetPattern(pattern);
  const comparisonPaths = [...new Set([
    targetPath,
    targetPath.startsWith('/') ? targetPath.slice(1) : `/${targetPath}`
  ])];
  if (normalizedPattern.endsWith('*')) {
    const prefix = normalizedPattern.slice(0, -1);
    const alternatePrefix = prefix.startsWith('/') ? prefix.slice(1) : `/${prefix}`;
    const prefixRoot = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const alternateRoot = alternatePrefix.endsWith('/') ? alternatePrefix.slice(0, -1) : alternatePrefix;
    return comparisonPaths.some((path) => (
      path === prefixRoot
      || path === alternateRoot
      || path.startsWith(prefix)
      || path.startsWith(alternatePrefix)
    ));
  }
  const alternatePattern = normalizedPattern.startsWith('/') ? normalizedPattern.slice(1) : `/${normalizedPattern}`;
  return comparisonPaths.some((path) => path === normalizedPattern || path === alternatePattern);
}

function buildWorkspaceTargetScope({ request, operation, boundary, workspaceGrants, selectedGrantId, settings }) {
  const selectedGrant = workspaceGrants.find((grant) => grant.id === selectedGrantId) || null;
  const explicitPatterns = scopePatternsFromBoundary(boundary, selectedGrant);
  const expectedPatterns = explicitPatterns.length > 0 ? explicitPatterns : defaultWorkspaceScopePatterns(request);
  const scopedDecisionClass = ['file', 'shell', 'deploy', 'external-write'].includes(operation.decisionClass);
  const required = Boolean(
    settings.requireWorkspaceTargetScope
    && settings.requireWorkspace
    && request.tenantId
    && request.workspaceId
    && operation.mutating
    && scopedDecisionClass
  );
  const targetEvaluations = operation.targetBoundary.targetDetails.map((target) => {
    const targetPath = targetPathForTenantScope(target);
    const checkable = Boolean(targetPath && target.kind !== 'host');
    const matchedPatterns = checkable
      ? expectedPatterns.filter((pattern) => targetMatchesScopePattern(targetPath, pattern))
      : [];
    return {
      raw: target.raw,
      normalized: target.normalized,
      kind: target.kind,
      targetPath,
      checkable,
      scoped: !checkable || matchedPatterns.length > 0,
      matchedPatterns
    };
  });
  const checkableTargets = targetEvaluations.filter((target) => target.checkable);
  const outOfScopeTargets = targetEvaluations.filter((target) => target.checkable && !target.scoped);
  const missingCheckableTarget = required && operation.targets.length > 0 && checkableTargets.length === 0;
  const status = !required
    ? 'not_required'
    : outOfScopeTargets.length > 0 || missingCheckableTarget
      ? 'blocked'
      : checkableTargets.length > 0
        ? 'scoped'
        : 'pending_target';

  return {
    schema: `${TENANT_BOUNDARY_SCHEMA}.workspaceTargetScope.v1`,
    required,
    status,
    source: explicitPatterns.length > 0 ? selectedGrant ? 'workspace-grant-or-boundary-patterns' : 'boundary-patterns' : 'derived-tenant-workspace-prefix',
    decisionClass: operation.decisionClass,
    mutating: operation.mutating,
    selectedGrantId,
    expectedPatterns,
    targetEvaluations,
    checkableTargetCount: checkableTargets.length,
    outOfScopeTargets: outOfScopeTargets.map((target) => ({
      raw: target.raw,
      normalized: target.normalized,
      kind: target.kind,
      targetPath: target.targetPath
    })),
    missingCheckableTarget
  };
}

function buildAuthorizationScope(request, tenantBoundary, workspaceGrants, grantScopes, policies) {
  const selectedGrantScope = grantScopes.find((scope) => scope.grantId === tenantBoundary.workspaceGrant?.selectedGrantId) || null;
  const selectedGrant = workspaceGrants.find((grant) => grant.id === selectedGrantScope?.grantId) || null;
  const matchedPolicies = policies.filter((policy) => tenantBoundary.matchedPolicyIds.includes(policy.id));
  const policyRoles = matchedPolicies.flatMap((policy) => withoutWildcard(policy.roles));
  const policyPermissions = matchedPolicies.flatMap((policy) => withoutWildcard(policy.permissions));
  const grantRoles = selectedGrant ? withoutWildcard(selectedGrant.roles) : [];
  const grantPermissions = selectedGrant ? withoutWildcard(selectedGrant.permissions) : [];
  const effectiveRoles = selectedGrant
    ? scopedIntersection(request.roles, grantRoles.length > 0 ? grantRoles : request.roles)
    : scopedIntersection(request.roles, policyRoles.length > 0 ? policyRoles : request.roles);
  const effectivePermissions = selectedGrant
    ? scopedIntersection(request.permissions, selectedGrant.permissions)
    : scopedIntersection(request.permissions, policyPermissions.length > 0 ? policyPermissions : request.permissions);
  const effectiveCapabilities = selectedGrant
    ? scopedIntersection([request.capability].filter(Boolean), selectedGrant.capabilities)
    : [request.capability].filter(Boolean);
  const effectiveRoutes = selectedGrant
    ? scopedIntersection([request.route], selectedGrant.routes)
    : [request.route];
  const source = selectedGrant
    ? 'workspace-grant'
    : matchedPolicies.length > 0
      ? 'matched-policy'
      : 'request-context';
  const boundaryComplete = Boolean(
    tenantBoundary.tenantId
    && (!tenantBoundary.settings.requireWorkspace || tenantBoundary.workspaceId)
    && (!tenantBoundary.settings.requireWorkspaceGrant || selectedGrant)
  );

  return {
    schema: AUTHORIZATION_SCOPE_SCHEMA,
    source,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    principal: request.principal,
    selectedGrantId: selectedGrant?.id || null,
    matchedPolicyIds: tenantBoundary.matchedPolicyIds,
    roles: effectiveRoles,
    permissions: effectivePermissions,
    capabilities: effectiveCapabilities,
    routes: effectiveRoutes,
    leastPrivilege: {
      roleCount: effectiveRoles.length,
      permissionCount: effectivePermissions.length,
      capabilityCount: effectiveCapabilities.length,
      routeCount: effectiveRoutes.length,
      grantConstrained: Boolean(selectedGrant),
      boundaryComplete
    },
    auditHandoff: {
      scopeFingerprint: contractFingerprint({
        schema: AUTHORIZATION_SCOPE_SCHEMA,
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        principal: request.principal,
        selectedGrantId: selectedGrant?.id || null,
        matchedPolicyIds: tenantBoundary.matchedPolicyIds,
        roles: effectiveRoles,
        permissions: effectivePermissions,
        capabilities: effectiveCapabilities,
        routes: effectiveRoutes
      }),
      proofRequired: tenantBoundary.required,
      selectedGrantSource: selectedGrant?.source || null
    }
  };
}

function buildTenantBoundaryState(input, request, policies, operation) {
  const boundary = asObject(input.tenantBoundary || input.boundaries?.tenant || input.securityBoundary);
  const scoped = Boolean(request.tenantId || request.workspaceId || request.roles.length > 0 || request.permissions.length > 0 || hasScopedPolicy(policies));
  const required = Boolean(boundary.required || input.requireTenantBoundary || scoped);
  const requireWorkspace = Boolean(boundary.requireWorkspace ?? input.requireWorkspaceBoundary ?? request.workspaceId ?? policies.some((policy) => !listHasWildcard(policy.workspaces)));
  const workspaceGrants = normalizeWorkspaceGrants(input, request);
  const settings = {
    required,
    requireWorkspace,
    allowTenantWildcard: Boolean(boundary.allowTenantWildcard || input.allowTenantWildcardPolicies),
    allowWorkspaceWildcard: boundary.allowWorkspaceWildcard !== false,
    requireRoleOrPermission: Boolean(boundary.requireRoleOrPermission || input.requireRoleOrPermission),
    requireWorkspaceGrant: Boolean(boundary.requireWorkspaceGrant || input.requireWorkspaceGrant || workspaceGrants.length > 0),
    requireAllPolicyRoles: Boolean(boundary.requireAllPolicyRoles || input.requireAllPolicyRoles),
    requireAllPolicyPermissions: Boolean(boundary.requireAllPolicyPermissions || input.requireAllPolicyPermissions),
    requireAllRequestedRoles: Boolean(boundary.requireAllRequestedRoles || input.requireAllRequestedRoles),
    requireAllRequestedPermissions: Boolean(boundary.requireAllRequestedPermissions || input.requireAllRequestedPermissions),
    requireWorkspaceTargetScope: boundary.requireWorkspaceTargetScope !== false
      && input.requireWorkspaceTargetScope !== false
      && Boolean(boundary.requireWorkspaceTargetScope || input.requireWorkspaceTargetScope || (required && requireWorkspace))
  };
  const failures = [];
  const policyScopes = policies.map((policy) => policyMatchesTenantBoundary(policy, request, settings));
  const matchingPolicyIds = policyScopes.filter((scope) => scope.matched).map((scope) => scope.policyId);
  const rejectedPolicyIds = policyScopes.filter((scope) => !scope.matched).map((scope) => scope.policyId);
  const nowMs = Number.isFinite(Date.parse(input.now)) ? Date.parse(input.now) : Date.now();
  const grantScopes = workspaceGrants.map((grant) => grantMatchesWorkspaceRequest(grant, request, nowMs, settings));
  const matchedGrantIds = grantScopes.filter((scope) => scope.matched).map((scope) => scope.grantId);
  const selectedGrant = matchedGrantIds[0] || null;
  const workspaceTargetScope = buildWorkspaceTargetScope({
    request,
    operation,
    boundary,
    workspaceGrants,
    selectedGrantId: selectedGrant,
    settings
  });

  if (required && !request.tenantId) {
    failures.push(actionableError('missing_tenant_scope', 'Tenant scope is required for scoped capability evaluation', 'Attach capabilityRequest.tenantId before granting hosted-kernel capabilities.'));
  }
  if (required && requireWorkspace && !request.workspaceId) {
    failures.push(actionableError('missing_workspace_scope', 'Workspace scope is required for this capability evaluation', 'Attach capabilityRequest.workspaceId or disable requireWorkspaceBoundary for tenant-only capabilities.'));
  }
  if (settings.requireRoleOrPermission && request.roles.length === 0 && request.permissions.length === 0) {
    failures.push(actionableError('missing_role_permission_context', 'Role or permission context is required by the tenant boundary', 'Attach request roles or permissions from the authenticated principal context.'));
  }
  if (required && policies.length > 0 && matchingPolicyIds.length === 0) {
    failures.push(actionableError('tenant_boundary_no_policy_match', 'No policy matched the request tenant, workspace, role, and permission boundary', 'Publish a policy whose tenant/workspace and role/permission constraints match this request.'));
  }
  if (policyScopes.some((scope) => scope.crossTenantWildcard)) {
    failures.push(actionableError('tenant_wildcard_blocked', 'Wildcard tenant policy is blocked by tenant boundary controls', 'Set policy.allowCrossTenant=true or tenantBoundary.allowTenantWildcard=true only for explicitly cross-tenant capabilities.'));
  }
  if (settings.requireWorkspaceGrant && workspaceGrants.length === 0) {
    failures.push(actionableError('workspace_grant_required', 'Workspace grant is required by the tenant boundary', 'Attach tenantBoundary.workspaceGrants or disable requireWorkspaceGrant for policy-only evaluation.'));
  }
  if (settings.requireWorkspaceGrant && workspaceGrants.length > 0 && matchedGrantIds.length === 0) {
    failures.push(actionableError('workspace_grant_not_authorized', 'No workspace grant authorizes this principal, capability, route, tenant, and workspace', 'Attach an active workspace grant whose subject, scope, capabilities, routes, and permissions match the request.'));
  }
  if (settings.requireWorkspaceGrant && matchedGrantIds.length === 0 && grantScopes.some((scope) => scope.blockedReasons.includes('tenant_mismatch'))) {
    failures.push(actionableError('workspace_grant_tenant_mismatch', 'Workspace grant tenant does not match the request tenant', 'Use a grant issued for this tenant or explicitly allow tenant wildcards for cross-tenant operations.'));
  }
  if (settings.requireWorkspaceGrant && matchedGrantIds.length === 0 && grantScopes.some((scope) => scope.blockedReasons.includes('workspace_mismatch'))) {
    failures.push(actionableError('workspace_grant_workspace_mismatch', 'Workspace grant does not match the request workspace', 'Use a grant scoped to the requested workspace or an approved workspace wildcard grant.'));
  }
  if (settings.requireAllRequestedPermissions && request.permissions.length > 0 && matchedGrantIds.length === 0 && grantScopes.some((scope) => scope.permissionMatch === false && scope.permissionCoverage.required.length > 0)) {
    failures.push(actionableError('workspace_grant_permission_coverage_incomplete', 'Workspace grant does not cover every requested permission', 'Issue a grant that includes all requested permissions, or disable requireAllRequestedPermissions for any-permission matching.'));
  }
  if (settings.requireAllPolicyRoles && matchingPolicyIds.length === 0 && policyScopes.some((scope) => scope.roleMatch === false && scope.requiredRoles.length > 1)) {
    failures.push(actionableError('policy_role_coverage_incomplete', 'Request roles do not satisfy every role required by a scoped policy', 'Attach all required roles to the authenticated request context or publish a policy with any-role matching.'));
  }
  if (settings.requireAllPolicyPermissions && matchingPolicyIds.length === 0 && policyScopes.some((scope) => scope.permissionMatch === false && scope.requiredPermissions.length > 1)) {
    failures.push(actionableError('policy_permission_coverage_incomplete', 'Request permissions do not satisfy every permission required by a scoped policy', 'Attach all required permissions to the authenticated request context or publish a policy with any-permission matching.'));
  }
  if (workspaceTargetScope.required && workspaceTargetScope.missingCheckableTarget) {
    failures.push(actionableError(
      'workspace_target_scope_required',
      'Workspace-scoped mutating decisions require a tenant/workspace target path',
      'Attach an operation target under the request tenant/workspace path or set tenantBoundary.requireWorkspaceTargetScope=false for a reviewed exception.',
      'error',
      {
        workspaceTargetScopeSchema: workspaceTargetScope.schema,
        decisionClass: workspaceTargetScope.decisionClass,
        expectedPatterns: workspaceTargetScope.expectedPatterns
      }
    ));
  }
  if (workspaceTargetScope.required && workspaceTargetScope.outOfScopeTargets.length > 0) {
    failures.push(actionableError(
      'workspace_target_scope_mismatch',
      'Operation targets are outside the request tenant/workspace boundary',
      'Use targets rooted in the request tenant/workspace scope or attach explicit tenantBoundary.workspaceTargetPatterns for this boundary.',
      'error',
      {
        workspaceTargetScopeSchema: workspaceTargetScope.schema,
        expectedPatterns: workspaceTargetScope.expectedPatterns,
        outOfScopeTargets: workspaceTargetScope.outOfScopeTargets
      }
    ));
  }

  const status = failures.some((failure) => failure.severity === 'error')
    ? 'blocked'
    : required
      ? 'scoped'
      : 'not_required';
  const workspaceGrant = {
    schema: WORKSPACE_GRANT_SCHEMA,
    required: settings.requireWorkspaceGrant,
    grantCount: workspaceGrants.length,
    selectedGrantId: selectedGrant,
    matchedGrantIds,
    rejectedGrantIds: grantScopes.filter((scope) => !scope.matched).map((scope) => scope.grantId),
    status: settings.requireWorkspaceGrant
      ? selectedGrant
        ? 'authorized'
        : 'blocked'
      : workspaceGrants.length > 0
        ? 'observed'
        : 'not_required',
    grantScopes
  };
  const boundaryState = {
    schema: TENANT_BOUNDARY_SCHEMA,
    required,
    scoped,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    principalRoles: request.roles,
    principalPermissions: request.permissions,
    settings,
    status,
    matchedPolicyIds: matchingPolicyIds,
    rejectedPolicyIds,
    workspaceGrant,
    workspaceTargetScope,
    policyScopes,
    failures
  };
  const authorizationScope = buildAuthorizationScope(request, boundaryState, workspaceGrants, grantScopes, policies);

  return {
    ...boundaryState,
    authorizationScope
  };
}

function normalizeClientRuntimeState(input, request, now) {
  const client = asObject(input.clientRuntime || input.client || input.requestContext?.clientRuntime);
  const workflow = asObject(client.workflow || client.workflowHandoff || input.workflowHandoff);
  const session = asObject(client.session || input.session);
  const runtimeState = client.state || client.status || 'unknown';
  const acceptsDecisions = client.acceptsPolicyDecisions !== false && workflow.acceptsPolicyDecisions !== false;
  const required = Boolean(client.required || input.requireClientRuntime || workflow.required);
  const visibleToUser = client.visibleToUser !== false && workflow.visibleToUser !== false;
  const confirmationRequired = Boolean(workflow.confirmationRequired || client.confirmationRequired);
  const confirmationToken = workflow.confirmationToken || client.confirmationToken || null;
  const supportedActions = normalizeStringList(workflow.supportedActions || client.supportedActions);
  const handoffActions = supportedActions.length > 0 ? supportedActions : ['grant', 'deny', 'request-changes'];
  const activeRequestId = workflow.requestId || client.requestId || session.requestId || null;
  const canReceiveRequest = !activeRequestId || activeRequestId === request.id;

  return {
    schema: CLIENT_RUNTIME_SCHEMA,
    required,
    clientId: client.id || client.clientId || session.clientId || 'unknown-client',
    sessionId: session.id || session.sessionId || null,
    state: runtimeState,
    visibleToUser,
    acceptsPolicyDecisions: acceptsDecisions,
    canReceiveRequest,
    activeRequestId,
    workflow: {
      handoffId: workflow.id || `${request.id}:client-runtime`,
      requestedAt: workflow.requestedAt || now,
      target: workflow.target || client.target || 'capability-request-panel',
      supportedActions: handoffActions,
      confirmationRequired,
      confirmationToken,
      nextAction: confirmationRequired && !confirmationToken
        ? 'collect_user_confirmation'
        : acceptsDecisions && canReceiveRequest
          ? 'present_policy_decision'
          : 'restore_client_handoff'
    }
  };
}

function validateClientRuntimeState(clientRuntime) {
  const failures = [];
  const readyStates = new Set(['ready', 'active', 'connected', 'unknown']);

  if (clientRuntime.required && !readyStates.has(clientRuntime.state)) {
    failures.push(actionableError('client_runtime_unavailable', 'Client runtime is not ready to receive the policy decision', 'Reconnect the requesting client runtime before completing capability handoff.'));
  }
  if (clientRuntime.required && !clientRuntime.acceptsPolicyDecisions) {
    failures.push(actionableError('client_runtime_handoff_blocked', 'Client runtime does not accept policy decision handoffs', 'Enable acceptsPolicyDecisions for the requesting client workflow.'));
  }
  if (clientRuntime.required && !clientRuntime.canReceiveRequest) {
    failures.push(actionableError('client_runtime_request_mismatch', 'Client runtime is bound to a different capability request', 'Clear the active workflow or attach the matching requestId before presenting this decision.'));
  }
  if (clientRuntime.required && !clientRuntime.visibleToUser) {
    failures.push(actionableError('client_runtime_not_visible', 'Client runtime handoff is not visible to the user', 'Route the policy decision to a visible client workflow surface before acceptance.'));
  }
  if (clientRuntime.workflow.confirmationRequired && !clientRuntime.workflow.confirmationToken) {
    failures.push(actionableError('client_runtime_confirmation_required', 'Client runtime requires confirmation before acceptance', 'Collect a confirmation token from the client workflow before granting the capability.'));
  }

  return failures;
}

function normalizeClientRequestState(input, request, clientRuntime, nowMs, now) {
  const client = asObject(input.clientRuntime || input.client || input.requestContext?.clientRuntime);
  const workflow = asObject(client.workflow || client.workflowHandoff || input.workflowHandoff);
  const source = asObject(input.clientRequestState || workflow.requestState || client.requestState || input.requestContext?.clientRequestState);
  const observedRequest = asObject(source.request || source.capabilityRequest);
  const requestedAt = source.requestedAt || source.createdAt || workflow.requestedAt || null;
  const updatedAt = source.updatedAt || source.observedAt || source.lastSeenAt || null;
  const updatedAtMs = parseTimestampMs(updatedAt) || finiteNumber(source.updatedAtMs ?? source.lastSeenAtMs, null);
  const maxAgeMs = finiteNumber(source.maxAgeMs ?? source.staleAfterMs ?? workflow.requestStateMaxAgeMs, null);
  const ageMs = updatedAtMs ? Math.max(0, nowMs - updatedAtMs) : null;
  const expectedRequestId = source.requestId || observedRequest.id || clientRuntime.activeRequestId || request.id;
  const expectedPrincipal = source.principal || observedRequest.principal || null;
  const expectedCapability = source.capability || observedRequest.capability || null;
  const expectedRoute = source.route || observedRequest.route || null;
  const revision = finiteNumber(source.revision ?? source.version ?? workflow.revision, null);
  const handoffCursor = source.handoffCursor || source.cursor || workflow.handoffCursor || null;
  const required = Boolean(source.required || input.requireClientRequestState || clientRuntime.required);
  const requireRevision = Boolean(source.requireRevision || input.requireClientRequestRevision);
  const requireHandoffCursor = Boolean(source.requireHandoffCursor || input.requireClientHandoffCursor);
  const phase = source.phase || source.status || (clientRuntime.workflow.nextAction === 'present_policy_decision' ? 'awaiting_decision' : 'handoff_pending');
  const terminal = ['accepted', 'denied', 'cancelled', 'expired'].includes(phase);
  const mismatches = [
    ...(expectedRequestId && expectedRequestId !== request.id ? ['request_id'] : []),
    ...(expectedPrincipal && expectedPrincipal !== request.principal ? ['principal'] : []),
    ...(expectedCapability && expectedCapability !== request.capability ? ['capability'] : []),
    ...(expectedRoute && expectedRoute !== request.route ? ['route'] : [])
  ];
  const stale = Boolean(maxAgeMs !== null && ageMs !== null && ageMs > maxAgeMs);
  const failures = [];

  if (required && mismatches.length > 0) {
    failures.push(actionableError(
      'client_request_state_mismatch',
      'Client request state does not match the capability request being evaluated',
      'Refresh the client workflow with the matching request id, principal, capability, and route before presenting the policy decision.',
      'error',
      { mismatches }
    ));
  }
  if (required && stale) {
    failures.push(actionableError(
      'client_request_state_stale',
      'Client request state is stale',
      'Refresh the client request state before accepting the hosted-kernel capability decision.',
      'error',
      { ageMs, maxAgeMs }
    ));
  }
  if (required && requireRevision && revision === null) {
    failures.push(actionableError(
      'client_request_revision_missing',
      'Client request state revision is required',
      'Attach clientRequestState.revision so acceptance can be tied to the visible request version.'
    ));
  }
  if (required && requireHandoffCursor && !handoffCursor) {
    failures.push(actionableError(
      'client_request_handoff_cursor_missing',
      'Client request handoff cursor is required',
      'Attach clientRequestState.handoffCursor from the client workflow before completing policy acceptance.'
    ));
  }
  if (required && terminal) {
    failures.push(actionableError(
      'client_request_already_finalized',
      'Client request workflow is already finalized',
      'Start a new client request workflow or clear the finalized client request state before re-evaluating this capability.'
    ));
  }

  return {
    schema: CLIENT_REQUEST_STATE_SCHEMA,
    required,
    requestId: expectedRequestId || request.id,
    phase,
    revision,
    requestedAt: requestedAt || clientRuntime.workflow.requestedAt || now,
    updatedAt,
    ageMs,
    maxAgeMs,
    stale,
    handoffCursor,
    expected: {
      principal: expectedPrincipal,
      capability: expectedCapability,
      route: expectedRoute
    },
    binding: {
      matchesRequest: mismatches.length === 0,
      mismatches,
      clientWorkflowHandoffId: clientRuntime.workflow.handoffId,
      clientWorkflowNextAction: clientRuntime.workflow.nextAction,
      stateFingerprint: contractFingerprint({
        schema: CLIENT_REQUEST_STATE_SCHEMA,
        requestId: expectedRequestId || request.id,
        phase,
        revision,
        handoffCursor,
        updatedAt
      })
    },
    handoff: {
      action: failures.some((failure) => failure.severity === 'error')
        ? 'refresh_client_request_state'
        : clientRuntime.workflow.nextAction === 'present_policy_decision'
          ? 'bind_preview_to_client_request'
          : clientRuntime.workflow.nextAction,
      cursorRequired: requireHandoffCursor,
      revisionRequired: requireRevision,
      canBindPreview: mismatches.length === 0 && !stale && !terminal
    },
    failures
  };
}

function buildProviderContractState(request, contracts, input, operation = {}) {
  const negotiation = normalizeProviderNegotiation(input, request, operation);
  const required = Boolean(negotiation.required || input.requireProviderContract || input.requireExternalHandoff || contracts.length > 0);
  const matching = contracts.filter((contract) => (
    matchValue(contract.capabilities, request.capability)
    && matchValue(contract.routes, request.route)
  ));
  const negotiationResults = matching.map((contract) => buildProviderNegotiationResult(contract, request, negotiation));
  const negotiatedProviderIds = negotiationResults
    .filter((result) => result.satisfied)
    .map((result) => result.providerId);
  const ready = matching.filter((contract) => negotiatedProviderIds.includes(contract.id));
  const handoffReady = ready.filter((contract) => {
    const result = negotiationResults.find((entry) => entry.providerId === contract.id);
    return result?.handoffReady;
  });
  const blockedNegotiations = negotiationResults.filter((result) => !result.satisfied);
  const negotiationMatrix = negotiationResults.map((result) => ({
    providerId: result.providerId,
    service: result.service,
    status: result.status,
    operation: result.selectedOperation,
    requiredFeatures: result.requiredFeatures,
    missingRequiredFeatures: result.missingRequiredFeatures,
    handoffMode: result.handoffMode,
    ready: result.ready,
    syncReady: result.syncReady,
    checkpointReady: result.checkpointReady,
    syncAgeMs: result.syncAgeMs,
    syncCursor: result.syncCursor,
    syncEpoch: result.syncEpoch,
    handoffCheckpointId: result.handoffCheckpoint.id,
    blockedReasons: result.blockedReasons
  }));
  const failures = [];

  if (required && contracts.length === 0) {
    failures.push(actionableError('provider_contract_missing', 'No provider contract is attached for capability negotiation', 'Attach providerContracts for the hosted-kernel service that will execute this capability.'));
  } else if (required && matching.length === 0) {
    failures.push(actionableError('provider_capability_not_offered', 'No provider contract offers the requested capability and route', 'Publish a provider contract whose capabilities and routes include this request.'));
  } else if (matching.length > 0 && ready.length === 0) {
    const reason = blockedNegotiations[0]?.blockedReasons[0] || 'provider_not_ready';
    const missingRequiredFeatures = [...new Set(blockedNegotiations.flatMap((result) => result.missingRequiredFeatures))];
    failures.push(actionableError(
      'provider_contract_unavailable',
      'Matching provider contracts are not ready or compatible',
      missingRequiredFeatures.length > 0
        ? 'Publish a provider service contract with the required operation features before handoff.'
        : 'Wait for provider readiness sync or publish a compatible provider service contract before handoff.',
      'error',
      { negotiationReason: reason, missingRequiredFeatures }
    ));
  }

  return {
    schema: PROVIDER_CONTRACT_SCHEMA,
    required,
    negotiation,
    requestedCapability: request.capability || 'missing-capability',
    requestedRoute: request.route,
    contractCount: contracts.length,
    matchedContractIds: matching.map((contract) => contract.id),
    readyContractIds: ready.map((contract) => contract.id),
    handoffReadyContractIds: handoffReady.map((contract) => contract.id),
    selectedProviderId: handoffReady[0]?.id || ready[0]?.id || null,
    selectedNegotiation: negotiationResults.find((result) => result.providerId === (handoffReady[0]?.id || ready[0]?.id)) || null,
    negotiationResults,
    negotiationMatrix,
    syncBlockedContractIds: negotiationResults
      .filter((result) => result.blockedReasons.some((reason) => reason.startsWith('provider_sync_')))
      .map((result) => result.providerId),
    checkpointBlockedContractIds: negotiationResults
      .filter((result) => result.blockedReasons.includes('handoff_checkpoint_not_committed'))
      .map((result) => result.providerId),
    featureBlockedContractIds: negotiationResults
      .filter((result) => result.blockedReasons.includes('required_provider_feature_missing'))
      .map((result) => result.providerId),
    requiredFeatures: negotiation.requiredFeatures,
    featureBasis: negotiation.featureBasis,
    status: failures.some((failure) => failure.severity === 'error')
      ? 'blocked'
      : ready.length > 0
        ? 'negotiated'
        : contracts.length > 0
          ? 'declared'
          : 'not_declared',
    contracts,
    failures
  };
}

function buildSyncMetadata(input, providerState, health, now) {
  const dependencies = asObject(input.dependencies);
  const policyStore = asObject(dependencies.policyStore);
  const providers = providerState.contracts.map((contract) => ({
    providerId: contract.id,
    service: contract.service,
    contractVersion: contract.contractVersion,
    protocol: contract.serviceContract.protocol,
    cursor: contract.sync.cursor,
    policyVersion: contract.sync.policyVersion,
    syncEpoch: contract.sync.epoch,
    supportedFeatures: contract.serviceContract.features,
    source: contract.sync.source,
    lastSyncedAt: contract.sync.lastSyncedAt,
    ageMs: contract.sync.ageMs,
    maxAgeMs: contract.sync.maxAgeMs,
    stale: contract.sync.stale,
    blockedReasons: contract.sync.blockedReasons,
    negotiationStatus: providerState.negotiationResults.find((result) => result.providerId === contract.id)?.status || 'not_matched'
  }));
  const staleProviderIds = providers
    .filter((provider) => provider.stale)
    .map((provider) => provider.providerId);

  return {
    schema: 'aios.capabilitySecurity.policyEvaluator.syncMetadata.v1',
    generatedAt: now,
    policyStore: {
      cursor: policyStore.cursor || input.policyCursor || null,
      policyVersion: policyStore.policyVersion || input.policyVersion || null,
      lastLoadedAtMs: Number(policyStore.lastLoadedAtMs || input.lastPolicyLoadMs || 0) || null,
      ageMs: health.policyAgeMs,
      staleAfterMs: health.staleAfterMs
    },
    providers,
    selectedProviderSync: providerState.selectedNegotiation
      ? {
        providerId: providerState.selectedNegotiation.providerId,
        cursor: providerState.selectedNegotiation.syncCursor,
        policyVersion: providerState.selectedNegotiation.policyVersion,
        syncEpoch: providerState.selectedNegotiation.syncEpoch,
        syncAgeMs: providerState.selectedNegotiation.syncAgeMs,
        handoffCheckpoint: providerState.selectedNegotiation.handoffCheckpoint,
        handoffMode: providerState.selectedNegotiation.handoffMode,
        selectedOperation: providerState.selectedNegotiation.selectedOperation,
        requiredFeatures: providerState.selectedNegotiation.requiredFeatures,
        missingRequiredFeatures: providerState.selectedNegotiation.missingRequiredFeatures,
        featureBasis: providerState.selectedNegotiation.featureBasis
      }
      : null,
    syncRequired: health.failures.some((failure) => failure.code === 'stale_policy_snapshot') || staleProviderIds.length > 0,
    staleProviderIds,
    providerSyncBlockedIds: providerState.syncBlockedContractIds,
    providerCheckpointBlockedIds: providerState.checkpointBlockedContractIds,
    providerFeatureBlockedIds: providerState.featureBlockedContractIds,
    requiredProviderFeatures: providerState.requiredFeatures,
    featureBasis: providerState.featureBasis
  };
}

function buildExternalHandoffState(input, request, decision, reason, providerState, syncMetadata, clientRuntime, now) {
  const handoffInput = asObject(input.externalHandoff || input.handoff);
  const required = Boolean(handoffInput.required || input.requireExternalHandoff);
  const selectedProviderId = handoffInput.providerId || providerState.selectedProviderId;
  const selectedNegotiation = providerState.negotiationResults.find((result) => result.providerId === selectedProviderId) || providerState.selectedNegotiation;
  const ready = Boolean(selectedProviderId && providerState.handoffReadyContractIds.includes(selectedProviderId) && selectedNegotiation?.satisfied);
  const blocked = decision !== 'allow' || (required && !ready);
  const failures = [];

  if (required && !ready) {
    failures.push(actionableError('external_handoff_unavailable', 'External handoff is required but no negotiated provider is ready', 'Mark a matching provider contract handoff.state as ready before enabling external execution.'));
  }

  return {
    schema: EXTERNAL_HANDOFF_SCHEMA,
    required,
    state: blocked ? 'blocked' : ready ? 'ready' : 'not_required',
    handoffId: handoffInput.id || `${request.id}:${selectedProviderId || 'no-provider'}`,
    providerId: selectedProviderId,
    requestId: request.id,
    capability: request.capability,
    route: request.route,
    serviceContract: selectedNegotiation
      ? {
        schema: selectedNegotiation.schema,
        providerId: selectedNegotiation.providerId,
        protocol: selectedNegotiation.protocol,
        contractVersion: selectedNegotiation.contractVersion,
        operation: selectedNegotiation.selectedOperation,
        handoffMode: selectedNegotiation.handoffMode,
        syncReady: selectedNegotiation.syncReady,
        checkpointReady: selectedNegotiation.checkpointReady,
        requiredFeatures: selectedNegotiation.requiredFeatures,
        missingRequiredFeatures: selectedNegotiation.missingRequiredFeatures,
        featureBasis: selectedNegotiation.featureBasis,
        handoffCheckpoint: selectedNegotiation.handoffCheckpoint,
        negotiationStatus: selectedNegotiation.status,
        blockedReasons: selectedNegotiation.blockedReasons
      }
      : null,
    decision,
    reason,
    syncCursor: syncMetadata.selectedProviderSync?.cursor || syncMetadata.policyStore.cursor,
    policyVersion: syncMetadata.selectedProviderSync?.policyVersion || syncMetadata.policyStore.policyVersion,
    syncEpoch: syncMetadata.selectedProviderSync?.syncEpoch || null,
    featureStatus: {
      requiredFeatures: syncMetadata.selectedProviderSync?.requiredFeatures || syncMetadata.requiredProviderFeatures || [],
      missingRequiredFeatures: syncMetadata.selectedProviderSync?.missingRequiredFeatures || [],
      featureBasis: syncMetadata.selectedProviderSync?.featureBasis || syncMetadata.featureBasis || null,
      providerFeatureBlockedIds: syncMetadata.providerFeatureBlockedIds || []
    },
    clientWorkflowHandoffId: clientRuntime.workflow.handoffId,
    clientWorkflowNextAction: clientRuntime.workflow.nextAction,
    generatedAt: now,
    failures
  };
}

function groupFailuresBySeverity(failures) {
  return failures.reduce((grouped, failure) => {
    const severity = failure.severity || 'error';
    grouped[severity] = grouped[severity] || [];
    grouped[severity].push(failure.code);
    return grouped;
  }, {});
}

function buildWorkflowHandoffContract({ input, request, operation, operationGuardrails, externalHandoff, clientRuntime, clientRequestState, now }) {
  const source = asObject(input.workflowHandoff || input.clientWorkflow || input.clientRuntime?.workflow);
  const riskyShell = operation.decisionClass === 'shell'
    && Object.entries(operationGuardrails.shellSignals || {}).some(([key, value]) => key !== 'hasCommand' && value === true);
  const highImpactDecision = ['shell', 'deploy', 'external-write'].includes(operation.decisionClass)
    || (operation.mutating && ['syscall', 'file'].includes(operation.decisionClass))
    || riskyShell
    || operation.requiresExternalHandoff
    || operationGuardrails.status === 'review_required';
  const required = Boolean(source.required ?? input.requireWorkflowHandoff ?? highImpactDecision);
  const acknowledgement = asObject(source.acknowledgement || source.userAcknowledgement || input.userAcknowledgement);
  const acknowledgedRequestId = acknowledgement.requestId || source.acknowledgedRequestId || null;
  const acknowledgedPreviewToken = acknowledgement.previewToken || source.previewToken || null;
  const requestedOwner = source.owner || source.assignee || source.requestedBy || clientRuntime.clientId;
  const supportedActions = normalizeStringList(source.supportedActions || clientRuntime.workflow.supportedActions);
  const allowedActions = supportedActions.length > 0 ? supportedActions : clientRuntime.workflow.supportedActions;
  const reviewReasons = [
    ...(operation.decisionClass === 'shell' ? ['shell_command_review'] : []),
    ...(operation.decisionClass === 'deploy' ? ['deployment_handoff_review'] : []),
    ...(operation.decisionClass === 'external-write' ? ['external_write_destination_review'] : []),
    ...(operation.mutating && ['syscall', 'file'].includes(operation.decisionClass) ? ['mutating_kernel_surface_review'] : []),
    ...(riskyShell ? ['elevated_shell_signal_review'] : []),
    ...(operation.requiresExternalHandoff ? ['external_provider_handoff_review'] : []),
    ...(operation.targetBoundary.canonicalizationRequired ? ['canonicalized_target_review'] : []),
    ...(operationGuardrails.status === 'review_required' ? operationGuardrails.warningCodes : [])
  ];
  const visible = clientRuntime.visibleToUser && clientRuntime.workflow.nextAction === 'present_policy_decision';
  const boundToRequest = clientRequestState.handoff.canBindPreview && clientRequestState.binding.matchesRequest;
  const acknowledgementRequired = Boolean(acknowledgement.required || source.requireAcknowledgement);
  const acknowledgementMatches = !acknowledgementRequired
    || (acknowledgedRequestId === request.id && Boolean(acknowledgedPreviewToken || acknowledgement.acceptedAt || acknowledgement.token));
  const missingReasons = [
    ...(required && !visible ? ['client_workflow_not_visible'] : []),
    ...(required && !boundToRequest ? ['client_request_state_not_bound'] : []),
    ...(required && externalHandoff.required && externalHandoff.state !== 'ready' ? ['external_handoff_not_ready'] : []),
    ...(required && acknowledgementRequired && !acknowledgementMatches ? ['workflow_acknowledgement_missing'] : [])
  ];
  const failures = missingReasons.map((code) => actionableError(
    code,
    code === 'workflow_acknowledgement_missing'
      ? 'Workflow handoff acknowledgement is required before acceptance'
      : 'Workflow handoff is not ready for this capability decision',
    code === 'client_workflow_not_visible'
      ? 'Present the policy decision on a visible client workflow before acceptance.'
      : code === 'client_request_state_not_bound'
        ? 'Refresh and bind the client request state to this capability request before acceptance.'
        : code === 'external_handoff_not_ready'
          ? 'Complete the external provider handoff readiness step before presenting acceptance.'
          : 'Attach acknowledgement.requestId and acknowledgement.previewToken from the visible client workflow.',
    'error',
    { schema: WORKFLOW_HANDOFF_SCHEMA, decisionClass: operation.decisionClass, reviewReasons }
  ));
  const nextAction = failures.some((failure) => failure.code === 'client_workflow_not_visible')
    ? 'present_policy_decision_to_client'
    : failures.some((failure) => failure.code === 'client_request_state_not_bound')
      ? 'bind_client_request_state'
      : failures.some((failure) => failure.code === 'external_handoff_not_ready')
        ? 'prepare_external_handoff'
        : failures.some((failure) => failure.code === 'workflow_acknowledgement_missing')
          ? 'collect_workflow_acknowledgement'
          : required
            ? 'handoff_ready_for_acceptance'
            : 'handoff_not_required';

  return {
    schema: WORKFLOW_HANDOFF_SCHEMA,
    required,
    status: failures.length > 0 ? 'blocked' : required ? 'ready' : 'not_required',
    handoffId: source.id || `${request.id}:workflow-handoff`,
    owner: requestedOwner,
    target: source.target || clientRuntime.workflow.target,
    decisionClass: operation.decisionClass,
    routeDomain: operation.routeDomain,
    highImpactDecision,
    reviewReasons: [...new Set(reviewReasons)],
    visible,
    boundToRequest,
    allowedActions,
    acknowledgement: {
      required: acknowledgementRequired,
      requestId: acknowledgedRequestId,
      previewToken: acknowledgedPreviewToken,
      acceptedAt: acknowledgement.acceptedAt || acknowledgement.submittedAt || null,
      matchesRequest: acknowledgementMatches
    },
    nextAction,
    generatedAt: now,
    failures
  };
}

function buildValidationSummary(validationErrors, operationErrors, lifecycleErrors, tenantBoundaryFailures, healthFailures, contractErrors, handoffFailures, clientRuntimeFailures, clientRequestFailures, workflowHandoffFailures = []) {
  const sections = [
    ['request', validationErrors],
    ['capabilityOperation', operationErrors],
    ['lifecycle', lifecycleErrors],
    ['tenantBoundary', tenantBoundaryFailures],
    ['dependencies', healthFailures],
    ['providerContracts', contractErrors],
    ['externalHandoff', handoffFailures],
    ['clientRuntime', clientRuntimeFailures],
    ['clientRequestState', clientRequestFailures],
    ['workflowHandoff', workflowHandoffFailures]
  ].map(([section, failures]) => {
    const blocking = failures.filter((failure) => failure.severity === 'error');
    return {
      section,
      status: blocking.length > 0 ? 'blocked' : failures.length > 0 ? 'warning' : 'passed',
      failureCount: failures.length,
      blockingCount: blocking.length,
      codes: failures.map((failure) => failure.code)
    };
  });
  const allFailures = sections.flatMap((section) => section.codes);
  const blockingSections = sections.filter((section) => section.status === 'blocked').map((section) => section.section);

  return {
    schema: VALIDATION_SUMMARY_SCHEMA,
    status: blockingSections.length > 0 ? 'blocked' : allFailures.length > 0 ? 'warning' : 'passed',
    blockingSections,
    totalFailureCount: allFailures.length,
    sections
  };
}

function buildOperationReviewContract({ request, operation, operationGuardrails, providerState, externalHandoff, clientRequestState }) {
  const shellSignals = operationGuardrails.shellSignals || {};
  const riskyShellSignals = Object.entries(shellSignals)
    .filter(([key, value]) => key !== 'hasCommand' && value === true)
    .map(([key]) => key);
  const hasConcreteTarget = operation.targets.length > 0 || Boolean(operation.path || operation.externalHost || operation.deploymentTarget);
  const hasNetworkTarget = Boolean(operation.externalHost)
    || operation.targetBoundary.targetDetails.some((target) => target.kind === 'url' || target.kind === 'host');
  const productionDeploy = operationGuardrails.productionDeploy === true;
  const classEvidence = {
    syscall: [
      {
        id: 'syscall_name_or_effect',
        label: 'Syscall or kernel effect',
        required: true,
        present: Boolean(operation.syscall || operation.effects.length > 0),
        value: operation.syscall || operation.effects[0] || null
      }
    ],
    file: [
      {
        id: 'file_target',
        label: 'Canonical file target',
        required: operation.mutating,
        present: hasConcreteTarget,
        value: operation.path || operation.targets[0] || null
      }
    ],
    shell: [
      {
        id: 'shell_command',
        label: 'Exact shell command',
        required: true,
        present: Boolean(operation.command),
        value: operation.command || null
      },
      {
        id: 'shell_risk_signals',
        label: 'Shell risk signals reviewed',
        required: riskyShellSignals.length > 0,
        present: operationGuardrails.status !== 'blocked',
        value: riskyShellSignals
      }
    ],
    deploy: [
      {
        id: 'deployment_target',
        label: 'Deployment target',
        required: true,
        present: Boolean(operation.deploymentTarget || operation.targets.length > 0),
        value: operation.deploymentTarget || operation.targets[0] || null
      },
      {
        id: 'deploy_effect',
        label: 'Explicit deploy effect',
        required: productionDeploy,
        present: operation.effects.includes('deploy'),
        value: operation.effects
      }
    ],
    'external-write': [
      {
        id: 'external_destination',
        label: 'External destination',
        required: true,
        present: hasNetworkTarget,
        value: operation.externalHost || operation.targets.find((target) => /^([a-z][a-z0-9+.-]*:\/\/|[a-z0-9.-]+(?::\d+)?$)/i.test(target)) || null
      },
      {
        id: 'external_handoff_state',
        label: 'External handoff state',
        required: operation.requiresExternalHandoff,
        present: externalHandoff.state === 'ready',
        value: externalHandoff.state
      }
    ],
    general: [
      {
        id: 'capability_label',
        label: 'Capability label',
        required: true,
        present: Boolean(request.capability),
        value: request.capability || null
      }
    ]
  };
  const commonEvidence = [
    {
      id: 'target_boundary',
      label: 'Target boundary',
      required: operation.mutating,
      present: !operation.targetBoundary.unsafeRelativeTraversal && operation.targetBoundary.status !== 'blocked',
      value: operation.targetBoundary.status
    },
    {
      id: 'guardrail_status',
      label: 'Operation guardrails',
      required: true,
      present: operationGuardrails.status !== 'blocked',
      value: operationGuardrails.status
    },
    {
      id: 'client_request_binding',
      label: 'Client request binding',
      required: clientRequestState.required,
      present: !clientRequestState.required || clientRequestState.handoff.canBindPreview,
      value: clientRequestState.binding.stateFingerprint
    }
  ];
  const evidenceItems = [...(classEvidence[operation.decisionClass] || classEvidence.general), ...commonEvidence]
    .map((item) => ({
      ...item,
      status: item.present ? 'visible' : item.required ? 'missing_required' : 'missing_optional'
    }));
  const missingRequired = evidenceItems.filter((item) => item.required && !item.present);
  const warningEvidence = evidenceItems.filter((item) => !item.required && !item.present);
  const status = missingRequired.length > 0 || operationGuardrails.status === 'blocked'
    ? 'blocked'
    : operationGuardrails.status === 'review_required' || warningEvidence.length > 0
      ? 'review_required'
      : 'ready';
  const routeBinding = {
    domain: operation.routeDomain,
    previewSectionId: `operation-${operation.decisionClass}`,
    acceptanceGateId: 'operation_review_evidence',
    proofFieldPrefix: `operation.${operation.decisionClass}`,
    submitRequires: missingRequired.map((item) => item.id)
  };
  const reviewFingerprint = contractFingerprint({
    schema: OPERATION_REVIEW_SCHEMA,
    requestId: request.id,
    decisionClass: operation.decisionClass,
    routeDomain: operation.routeDomain,
    evidence: evidenceItems.map((item) => ({ id: item.id, status: item.status, value: item.value })),
    guardrailStatus: operationGuardrails.status,
    selectedProviderId: providerState.selectedProviderId,
    externalHandoffState: externalHandoff.state,
    clientRequestStateFingerprint: clientRequestState.binding.stateFingerprint
  });

  return {
    schema: OPERATION_REVIEW_SCHEMA,
    status,
    reviewFingerprint,
    decisionClass: operation.decisionClass,
    routeDomain: operation.routeDomain,
    userVisibleSummary: missingRequired.length > 0
      ? `Missing ${operation.decisionClass} evidence: ${missingRequired.map((item) => item.label).join(', ')}.`
      : status === 'review_required'
        ? `${operation.decisionClass} decision needs review before acceptance.`
        : `${operation.decisionClass} decision evidence is ready for acceptance.`,
    evidenceItems,
    missingRequiredEvidenceIds: missingRequired.map((item) => item.id),
    warningEvidenceIds: warningEvidence.map((item) => item.id),
    routeBinding
  };
}

function buildUserPreview({ request, operation, operationGuardrails, decision, reason, matchedPolicies, deniedBy, allowedBy, lifecycleState, tenantBoundary, providerState, externalHandoff, syncMetadata, clientRuntime, clientRequestState, workflowHandoff }) {
  const selectedProvider = providerState.contracts.find((contract) => contract.id === providerState.selectedProviderId) || null;
  const primaryDeny = deniedBy[0] || null;
  const primaryAllow = allowedBy[0] || null;
  const operationReview = buildOperationReviewContract({
    request,
    operation,
    operationGuardrails,
    providerState,
    externalHandoff,
    clientRequestState
  });
  const headline = decision === 'allow'
    ? `Allow ${request.capability || 'requested capability'} for ${request.principal}`
    : `Deny ${request.capability || 'requested capability'} for ${request.principal}`;

  return {
    schema: USER_PREVIEW_SCHEMA,
    headline,
    status: decision === 'allow' ? 'grant_preview' : 'deny_preview',
    requestLabel: `${request.principal} -> ${request.capability || 'missing-capability'} on ${request.route}`,
    decision,
    reason,
    policyMatch: {
      matchedPolicyIds: matchedPolicies.map((policy) => policy.id),
      deniedPolicyIds: deniedBy.map((policy) => policy.id),
      allowedPolicyIds: allowedBy.map((policy) => policy.id),
      primaryReason: primaryDeny?.reason || primaryAllow?.reason || 'No matching allow policy was available.'
    },
    operation: {
      schema: operation.schema,
      decisionClass: operation.decisionClass,
      routeDomain: operation.routeDomain,
      mutating: operation.mutating,
      requiresExternalHandoff: operation.requiresExternalHandoff,
      effects: operation.effects,
      rawTargets: operation.rawTargets,
      targets: operation.targets,
      targetBoundary: {
        schema: operation.targetBoundary.schema,
        status: operation.targetBoundary.status,
        canonicalizationRequired: operation.targetBoundary.canonicalizationRequired,
        traversalDetected: operation.targetBoundary.traversalDetected,
        unsafeRelativeTraversal: operation.targetBoundary.unsafeRelativeTraversal,
        matchingMode: operation.targetBoundary.matchingMode
      },
      guardrails: {
        schema: operationGuardrails.schema,
        status: operationGuardrails.status,
        blockingCodes: operationGuardrails.blockingCodes,
        warningCodes: operationGuardrails.warningCodes,
        broadAllowPolicyIds: operationGuardrails.broadAllowPolicyIds,
        controls: operationGuardrails.controls
      },
      review: operationReview,
      auditFingerprint: operation.auditFingerprint
    },
    lifecycle: {
      mode: lifecycleState.mode,
      nextAction: lifecycleState.nextAction,
      dryRun: lifecycleState.dryRun,
      scheduleDueNow: lifecycleState.schedule.dueNow,
      commandPlanSchema: lifecycleState.commandPlan.schema,
      commandOperation: lifecycleState.commandPlan.operation,
      commandCommitState: lifecycleState.commandPlan.commitState,
      effectiveEnabled: lifecycleState.commandPlan.effectiveEnabled,
      effectiveSuspended: lifecycleState.commandPlan.effectiveSuspended,
      schedulePatch: lifecycleState.commandPlan.schedulePatch,
      executionControlSchema: lifecycleState.executionControls.schema,
      executionPermitted: lifecycleState.executionControls.permitted,
      nextControlAction: lifecycleState.executionControls.nextControlAction,
      deniedControlCodes: lifecycleState.executionControls.deniedControlCodes,
      commitPrerequisites: lifecycleState.executionControls.commitPrerequisites,
      transitionSchema: lifecycleState.transition.schema,
      transitionId: lifecycleState.transition.transitionId,
      transitionRuntimeMode: lifecycleState.transition.runtimeMode,
      transitionCheckpointAction: lifecycleState.transition.checkpointAction,
      transitionRouteActions: lifecycleState.transition.route.actions,
      transitionScheduleDirective: lifecycleState.transition.scheduleDirective,
      transitionNextWakeAt: lifecycleState.transition.nextWakeAt
    },
    tenantBoundary: {
      schema: tenantBoundary.schema,
      status: tenantBoundary.status,
      required: tenantBoundary.required,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      matchedPolicyIds: tenantBoundary.matchedPolicyIds,
      rejectedPolicyIds: tenantBoundary.rejectedPolicyIds,
      workspaceGrant: {
        schema: tenantBoundary.workspaceGrant.schema,
        required: tenantBoundary.workspaceGrant.required,
        status: tenantBoundary.workspaceGrant.status,
        selectedGrantId: tenantBoundary.workspaceGrant.selectedGrantId,
        matchedGrantIds: tenantBoundary.workspaceGrant.matchedGrantIds,
        rejectedGrantIds: tenantBoundary.workspaceGrant.rejectedGrantIds
      },
      workspaceTargetScope: {
        schema: tenantBoundary.workspaceTargetScope.schema,
        required: tenantBoundary.workspaceTargetScope.required,
        status: tenantBoundary.workspaceTargetScope.status,
        source: tenantBoundary.workspaceTargetScope.source,
        expectedPatterns: tenantBoundary.workspaceTargetScope.expectedPatterns,
        checkableTargetCount: tenantBoundary.workspaceTargetScope.checkableTargetCount,
        outOfScopeTargets: tenantBoundary.workspaceTargetScope.outOfScopeTargets
      },
      authorizationScope: {
        schema: tenantBoundary.authorizationScope.schema,
        source: tenantBoundary.authorizationScope.source,
        selectedGrantId: tenantBoundary.authorizationScope.selectedGrantId,
        roles: tenantBoundary.authorizationScope.roles,
        permissions: tenantBoundary.authorizationScope.permissions,
        capabilities: tenantBoundary.authorizationScope.capabilities,
        routes: tenantBoundary.authorizationScope.routes,
        scopeFingerprint: tenantBoundary.authorizationScope.auditHandoff.scopeFingerprint,
        leastPrivilege: tenantBoundary.authorizationScope.leastPrivilege
      }
    },
    provider: {
      selectedProviderId: providerState.selectedProviderId,
      selectedProviderName: selectedProvider?.service || null,
      status: providerState.status,
      negotiationSchema: providerState.negotiation.schema,
      selectedOperation: providerState.selectedNegotiation?.selectedOperation || null,
      handoffMode: providerState.selectedNegotiation?.handoffMode || providerState.negotiation.handoffMode,
      negotiationStatus: providerState.selectedNegotiation?.status || null,
      selectedProviderSyncReady: providerState.selectedNegotiation?.syncReady ?? null,
      selectedProviderCheckpointReady: providerState.selectedNegotiation?.checkpointReady ?? null,
      selectedProviderSyncAgeMs: providerState.selectedNegotiation?.syncAgeMs ?? null,
      requiredFeatures: providerState.requiredFeatures,
      featureBasis: providerState.featureBasis,
      selectedProviderMissingFeatures: providerState.selectedNegotiation?.missingRequiredFeatures || [],
      featureBlockedContractIds: providerState.featureBlockedContractIds,
      selectedProviderHandoffCheckpoint: providerState.selectedNegotiation?.handoffCheckpoint || null,
      blockedNegotiations: providerState.negotiationResults
        .filter((result) => !result.satisfied)
        .map((result) => ({
          providerId: result.providerId,
          blockedReasons: result.blockedReasons,
          missingRequiredFeatures: result.missingRequiredFeatures
        })),
      externalHandoffState: externalHandoff.state
    },
    clientRuntime: {
      clientId: clientRuntime.clientId,
      sessionId: clientRuntime.sessionId,
      state: clientRuntime.state,
      visibleToUser: clientRuntime.visibleToUser,
      handoffId: clientRuntime.workflow.handoffId,
      target: clientRuntime.workflow.target,
      nextAction: clientRuntime.workflow.nextAction,
      supportedActions: clientRuntime.workflow.supportedActions
    },
    workflowHandoff: {
      schema: workflowHandoff.schema,
      required: workflowHandoff.required,
      status: workflowHandoff.status,
      handoffId: workflowHandoff.handoffId,
      owner: workflowHandoff.owner,
      target: workflowHandoff.target,
      highImpactDecision: workflowHandoff.highImpactDecision,
      reviewReasons: workflowHandoff.reviewReasons,
      nextAction: workflowHandoff.nextAction,
      acknowledgementRequired: workflowHandoff.acknowledgement.required,
      acknowledgementMatchesRequest: workflowHandoff.acknowledgement.matchesRequest
    },
    clientRequestState: {
      schema: clientRequestState.schema,
      required: clientRequestState.required,
      requestId: clientRequestState.requestId,
      phase: clientRequestState.phase,
      revision: clientRequestState.revision,
      stale: clientRequestState.stale,
      ageMs: clientRequestState.ageMs,
      matchesRequest: clientRequestState.binding.matchesRequest,
      mismatches: clientRequestState.binding.mismatches,
      handoffAction: clientRequestState.handoff.action,
      canBindPreview: clientRequestState.handoff.canBindPreview
    },
    sync: {
      policyVersion: syncMetadata.policyStore.policyVersion,
      cursor: syncMetadata.policyStore.cursor,
      syncRequired: syncMetadata.syncRequired,
      providerSyncBlockedIds: syncMetadata.providerSyncBlockedIds,
      providerCheckpointBlockedIds: syncMetadata.providerCheckpointBlockedIds
    }
  };
}

function buildAcceptanceReadiness({ decision, operation, operationReview, health, lifecycleState, tenantBoundary, providerState, externalHandoff, clientRuntime, clientRequestState, workflowHandoff, validationSummary, retry }) {
  const gates = [
    {
      id: 'request_validation',
      label: 'Request validation',
      ready: !validationSummary.blockingSections.includes('request')
    },
    {
      id: 'capability_operation',
      label: 'Capability operation',
      ready: !validationSummary.blockingSections.includes('capabilityOperation')
        && (!operation.requiresExternalHandoff || externalHandoff.state === 'ready')
    },
    {
      id: 'operation_review_evidence',
      label: 'Visible operation evidence',
      ready: operationReview.status !== 'blocked'
    },
    {
      id: 'lifecycle_control',
      label: 'Lifecycle control',
      ready: !validationSummary.blockingSections.includes('lifecycle') && lifecycleState.commandAcknowledged
    },
    {
      id: 'tenant_boundary',
      label: 'Tenant and workspace boundary',
      ready: !tenantBoundary.required || (!validationSummary.blockingSections.includes('tenantBoundary') && tenantBoundary.status !== 'blocked')
    },
    {
      id: 'dependency_health',
      label: 'Dependency health',
      ready: !validationSummary.blockingSections.includes('dependencies') && (!health.degraded || health.failures.every((failure) => failure.severity !== 'error'))
    },
    {
      id: 'provider_contract',
      label: 'Provider contract',
      ready: !providerState.required || providerState.status === 'negotiated'
    },
    {
      id: 'external_handoff',
      label: 'External handoff',
      ready: !externalHandoff.required || externalHandoff.state === 'ready'
    },
    {
      id: 'client_runtime_handoff',
      label: 'Client runtime handoff',
      ready: !clientRuntime.required || (!validationSummary.blockingSections.includes('clientRuntime') && clientRuntime.workflow.nextAction === 'present_policy_decision')
    },
    {
      id: 'client_request_state',
      label: 'Client request state',
      ready: !clientRequestState.required || (!validationSummary.blockingSections.includes('clientRequestState') && clientRequestState.handoff.canBindPreview)
    },
    {
      id: 'workflow_handoff',
      label: 'Workflow handoff',
      ready: !workflowHandoff.required || (!validationSummary.blockingSections.includes('workflowHandoff') && workflowHandoff.status === 'ready')
    },
    {
      id: 'decision_acceptance',
      label: 'Decision acceptance',
      ready: decision === 'allow'
    }
  ];
  const blockedGateIds = gates.filter((gate) => !gate.ready).map((gate) => gate.id);

  return {
    schema: ACCEPTANCE_READINESS_SCHEMA,
    status: blockedGateIds.length === 0 ? 'ready_for_acceptance' : retry.retryable ? 'retryable_blocked' : 'blocked',
    ready: blockedGateIds.length === 0,
    blockedGateIds,
    gates
  };
}

function nextStepForFailure(failure) {
  return {
    id: `resolve_${failure.code}`,
    type: failure.retryable ? 'retry' : failure.severity === 'warning' ? 'review' : 'fix',
    label: failure.message,
    remediation: failure.remediation,
    code: failure.code,
    severity: failure.severity,
    retryable: failure.retryable
  };
}

function buildExplainableNextSteps({ decision, reason, finalFailures, operationReview, lifecycleState, tenantBoundary, providerState, externalHandoff, clientRuntime, clientRequestState, workflowHandoff, syncMetadata, retry }) {
  const failureSteps = finalFailures.map(nextStepForFailure);
  const operationReviewSteps = operationReview.missingRequiredEvidenceIds.map((evidenceId) => {
    const evidence = operationReview.evidenceItems.find((item) => item.id === evidenceId);
    return {
      id: `attach_${evidenceId}`,
      type: 'operation-review',
      label: evidence?.label || 'Attach operation evidence',
      remediation: `Attach visible ${operationReview.decisionClass} evidence for ${evidenceId} before acceptance.`,
      code: evidenceId,
      severity: 'error',
      retryable: false,
      routeBinding: operationReview.routeBinding
    };
  });
  const acceptanceStep = decision === 'allow'
    ? [{
      id: 'accept_policy_decision',
      type: 'accept',
      label: 'Accept hosted-kernel capability decision',
      remediation: externalHandoff.state === 'ready'
        ? 'Proceed with the selected provider handoff and persist the audit proof.'
        : 'Persist the audit proof and grant the capability in the hosted kernel.',
      code: reason,
      severity: 'info',
      retryable: false
    }]
    : [];
  const syncStep = syncMetadata.syncRequired
    ? [{
      id: 'refresh_policy_sync',
      type: 'sync',
      label: 'Refresh policy and provider sync state',
      remediation: 'Reload policies and provider cursors before requesting acceptance again.',
      code: 'sync_required',
      severity: 'warning',
      retryable: true
    }]
    : [];
  const lifecycleStep = lifecycleState.nextAction && lifecycleState.nextAction !== 'evaluate_now'
    ? [{
      id: lifecycleState.nextAction,
      type: 'lifecycle',
      label: 'Resolve lifecycle next action',
      remediation: lifecycleState.commandPlan.commitState === 'ready_to_commit'
        ? `Commit lifecycle operation ${lifecycleState.commandPlan.operation} before accepting the decision.`
        : `Complete lifecycle action ${lifecycleState.nextAction} before accepting the decision.`,
      code: lifecycleState.nextAction,
      severity: lifecycleState.blockedBy.length > 0 ? 'error' : 'info',
      retryable: false
    }]
    : [];
  const lifecycleControlStep = lifecycleState.executionControls.permitted || lifecycleState.executionControls.nextControlAction === lifecycleState.nextAction
    ? []
    : [{
      id: lifecycleState.executionControls.nextControlAction,
      type: 'lifecycle-control',
      label: 'Resolve lifecycle execution controls',
      remediation: lifecycleState.executionControls.deniedControlCodes.length > 0
        ? `Resolve lifecycle control denials: ${lifecycleState.executionControls.deniedControlCodes.join(', ')}.`
        : `Complete lifecycle control action ${lifecycleState.executionControls.nextControlAction}.`,
      code: lifecycleState.executionControls.nextControlAction,
      severity: lifecycleState.executionControls.deniedControlCodes.length > 0 ? 'error' : 'info',
      retryable: false
    }];
  const providerStep = providerState.required && !providerState.selectedProviderId
    ? [{
      id: 'select_ready_provider_contract',
      type: 'provider',
      label: 'Select a ready provider contract',
      remediation: 'Attach a ready provider contract that matches the requested capability and route.',
      code: 'provider_contract_not_selected',
      severity: 'error',
      retryable: false
    }]
    : [];
  const tenantStep = tenantBoundary.required && tenantBoundary.status === 'blocked'
    ? [{
      id: 'resolve_tenant_boundary',
      type: 'tenant-boundary',
      label: 'Resolve tenant and workspace boundary',
      remediation: 'Attach matching tenant, workspace, role, and permission context before accepting this capability decision.',
      code: 'tenant_boundary_blocked',
      severity: 'error',
      retryable: false
    }]
    : [];
  const clientStep = clientRuntime.required && clientRuntime.workflow.nextAction !== 'present_policy_decision'
    ? [{
      id: clientRuntime.workflow.nextAction,
      type: 'client-runtime',
      label: 'Prepare client workflow handoff',
      remediation: `Complete client workflow action ${clientRuntime.workflow.nextAction} before accepting the capability decision.`,
      code: clientRuntime.workflow.nextAction,
      severity: 'error',
      retryable: false
    }]
    : [];
  const clientRequestStep = clientRequestState.required && !clientRequestState.handoff.canBindPreview
    ? [{
      id: clientRequestState.handoff.action,
      type: 'client-request-state',
      label: 'Refresh client request state',
      remediation: clientRequestState.binding.mismatches.length > 0
        ? `Refresh the client workflow request binding: ${clientRequestState.binding.mismatches.join(', ')}.`
        : clientRequestState.stale
          ? 'Reload the client workflow request state before presenting the policy preview.'
          : 'Attach the required client request revision or handoff cursor before acceptance.',
      code: clientRequestState.handoff.action,
      severity: 'error',
      retryable: false
    }]
    : [];
  const workflowStep = workflowHandoff.required && workflowHandoff.status !== 'ready'
    ? [{
      id: workflowHandoff.nextAction,
      type: 'workflow-handoff',
      label: 'Complete visible workflow handoff',
      remediation: workflowHandoff.failures[0]?.remediation || 'Route the policy preview through the visible client workflow before acceptance.',
      code: workflowHandoff.nextAction,
      severity: 'error',
      retryable: false,
      routeBinding: {
        domain: workflowHandoff.routeDomain,
        previewSectionId: 'workflow-handoff',
        acceptanceGateId: 'workflow_handoff',
        submitRequires: workflowHandoff.failures.map((failure) => failure.code)
      }
    }]
    : [];
  const steps = [...failureSteps, ...operationReviewSteps, ...syncStep, ...lifecycleStep, ...lifecycleControlStep, ...tenantStep, ...providerStep, ...clientStep, ...clientRequestStep, ...workflowStep, ...acceptanceStep];

  return {
    schema: NEXT_STEPS_SCHEMA,
    status: decision === 'allow' ? 'acceptance_available' : retry.retryable ? 'retry_available' : 'requires_changes',
    retry,
    steps
  };
}

function stableContractString(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableContractString).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableContractString(value[key])}`).join(',')}}`;
}

function contractFingerprint(value) {
  const serialized = stableContractString(value);
  let hash = 5381;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = ((hash << 5) + hash) ^ serialized.charCodeAt(index);
  }
  return `pet_${(hash >>> 0).toString(36)}`;
}

function normalizeRouteAcceptance(input, request, now) {
  const source = asObject(input.routeAcceptance || input.acceptance || input.userAcceptance);
  const rawAction = source.action || source.decisionAction || source.userAction || null;
  const action = rawAction ? String(rawAction).trim().toLowerCase() : null;
  const allowedActions = normalizeStringList(source.allowedActions || source.supportedActions)
    .filter((candidate) => ACCEPTANCE_ACTIONS.has(candidate));

  return {
    required: Boolean(source.required ?? input.requireUserAcceptance),
    actor: source.actor || source.acceptedBy || request.principal,
    action,
    previewToken: source.previewToken || source.token || null,
    channel: source.channel || 'hosted-kernel-route',
    note: source.note || source.reason || null,
    submittedAt: source.submittedAt || source.acceptedAt || null,
    allowedActions: allowedActions.length > 0 ? allowedActions : [...ACCEPTANCE_ACTIONS],
    generatedAt: now
  };
}

function buildRouteAcceptanceContract({ input, request, preview, acceptanceReadiness, validationSummary, decision, reason, externalHandoff, clientRuntime, clientRequestState, workflowHandoff, statePersistence, nextSteps, now }) {
  const acceptance = normalizeRouteAcceptance(input, request, now);
  const previewToken = contractFingerprint({
    schema: preview.schema,
    requestId: request.id,
    principal: request.principal,
    capability: request.capability,
    route: request.route,
    decision,
    reason,
    policyMatch: preview.policyMatch,
    operationReview: preview.operation.review.reviewFingerprint,
    lifecycle: preview.lifecycle,
    tenantBoundary: preview.tenantBoundary,
    provider: preview.provider,
    clientWorkflowHandoffId: clientRuntime.workflow.handoffId,
    workflowHandoffId: workflowHandoff.handoffId,
    workflowHandoffStatus: workflowHandoff.status,
    clientRequestStateFingerprint: clientRequestState.binding.stateFingerprint
  });
  const actionAllowed = acceptance.action === null || acceptance.allowedActions.includes(acceptance.action);
  const tokenAccepted = !acceptance.previewToken || acceptance.previewToken === previewToken;
  const submitted = Boolean(acceptance.action);
  const accepted = submitted
    && acceptance.action === 'accept'
    && acceptanceReadiness.ready
    && decision === 'allow'
    && actionAllowed
    && tokenAccepted;
  const disabledReasons = [
    ...acceptanceReadiness.blockedGateIds.map((gateId) => `gate:${gateId}`),
    ...validationSummary.blockingSections.map((section) => `validation:${section}`),
    ...(decision !== 'allow' ? [`decision:${reason}`] : []),
    ...(actionAllowed ? [] : ['acceptance:unsupported_action']),
    ...(tokenAccepted ? [] : ['acceptance:preview_token_mismatch'])
  ];
  const routeMethod = accepted ? 'POST' : 'GET';
  const routeAction = accepted
    ? 'commit_capability_acceptance'
    : acceptanceReadiness.ready
      ? 'present_acceptance_preview'
      : 'present_blocked_preview';

  return {
    schema: ROUTE_ACCEPTANCE_SCHEMA,
    previewToken,
    required: acceptance.required,
    submitted,
    accepted,
    status: accepted
      ? 'accepted'
      : submitted && !actionAllowed
        ? 'invalid_action'
        : submitted && !tokenAccepted
          ? 'stale_preview'
          : acceptanceReadiness.ready
            ? 'awaiting_user_action'
            : 'blocked',
    actor: acceptance.actor,
    channel: acceptance.channel,
    action: acceptance.action,
    allowedActions: acceptance.allowedActions,
    disabledReasons,
    route: {
      method: routeMethod,
      action: routeAction,
      target: clientRuntime.workflow.target,
      requestId: request.id,
      handoffId: externalHandoff.handoffId,
      clientWorkflowHandoffId: clientRuntime.workflow.handoffId,
      workflowHandoffId: workflowHandoff.handoffId
    },
    submitPayload: {
      schema: ROUTE_ACCEPTANCE_SCHEMA,
      requestId: request.id,
      action: 'accept',
      previewToken,
      actor: acceptance.actor,
      channel: acceptance.channel
    },
    proofRequirements: {
      auditRequestId: request.id,
      previewToken,
      commandId: statePersistence.idempotency.commandId,
      checkpointId: statePersistence.checkpoint.checkpointId,
      nextRevision: statePersistence.checkpoint.nextRevision,
      externalHandoffState: externalHandoff.state,
      workflowHandoffState: workflowHandoff.status,
      workflowHandoffNextAction: workflowHandoff.nextAction,
      clientRequestStateFingerprint: clientRequestState.binding.stateFingerprint,
      clientRequestStateRevision: clientRequestState.revision,
      nextStepIds: nextSteps.steps.map((step) => step.id),
      operationReviewFingerprint: preview.operation.review.reviewFingerprint
    },
    note: acceptance.note,
    submittedAt: acceptance.submittedAt,
    generatedAt: now
  };
}

function buildAcceptanceReviewContract({ request, preview, acceptanceReadiness, routeAcceptance, validationSummary, nextSteps, clientRuntime, clientRequestState, workflowHandoff, proofBundle, now }) {
  const blockingGateLabels = acceptanceReadiness.gates
    .filter((gate) => !gate.ready)
    .map((gate) => gate.label);
  const primaryStep = nextSteps.steps.find((step) => step.severity === 'error')
    || nextSteps.steps.find((step) => step.type === 'accept')
    || nextSteps.steps[0]
    || null;
  const acceptEnabled = routeAcceptance.status === 'awaiting_user_action' && acceptanceReadiness.ready;
  const denyEnabled = routeAcceptance.allowedActions.includes('deny') && routeAcceptance.status !== 'accepted';
  const requestChangesEnabled = routeAcceptance.allowedActions.includes('request-changes') && routeAcceptance.status !== 'accepted';
  const reviewState = routeAcceptance.accepted
    ? 'accepted'
    : routeAcceptance.status === 'stale_preview'
      ? 'refresh_required'
      : routeAcceptance.status === 'invalid_action'
        ? 'action_correction_required'
        : acceptanceReadiness.ready
          ? 'awaiting_user_acceptance'
          : 'blocked_until_ready';
  const visibleSections = [
    {
      id: 'decision',
      status: preview.decision === 'allow' ? 'positive' : 'negative',
      title: preview.headline,
      summary: preview.policyMatch.primaryReason
    },
    {
      id: 'readiness',
      status: acceptanceReadiness.ready ? 'ready' : 'blocked',
      title: acceptanceReadiness.ready ? 'Ready for acceptance' : 'Acceptance blocked',
      summary: blockingGateLabels.length > 0 ? blockingGateLabels.join(', ') : 'All acceptance gates passed.'
    },
    {
      id: 'operation-review',
      status: preview.operation.review.status,
      title: 'Operation evidence',
      summary: preview.operation.review.userVisibleSummary
    },
    {
      id: 'workflow-handoff',
      status: workflowHandoff.status,
      title: 'Workflow handoff',
      summary: workflowHandoff.status === 'ready'
        ? 'Client workflow handoff is ready for acceptance.'
        : workflowHandoff.required
          ? `Complete ${workflowHandoff.nextAction} before acceptance.`
          : 'Workflow handoff is not required for this decision.'
    },
    {
      id: 'validation',
      status: validationSummary.status,
      title: 'Validation summary',
      summary: validationSummary.blockingSections.length > 0
        ? validationSummary.blockingSections.join(', ')
        : `${validationSummary.totalFailureCount} validation findings`
    },
    {
      id: 'next-step',
      status: primaryStep?.severity || 'info',
      title: primaryStep?.label || 'No follow-up required',
      summary: primaryStep?.remediation || 'The hosted-kernel policy decision can be recorded as-is.'
    }
  ];

  return {
    schema: ACCEPTANCE_REVIEW_SCHEMA,
    generatedAt: now,
    requestId: request.id,
    previewToken: routeAcceptance.previewToken,
    clientWorkflowHandoffId: clientRuntime.workflow.handoffId,
    reviewState,
    headline: preview.headline,
    decision: preview.decision,
    reason: preview.reason,
    routeStatus: routeAcceptance.status,
    readinessStatus: acceptanceReadiness.status,
    validationStatus: validationSummary.status,
    proofHash: proofBundle.proofHash,
    primaryNextStepId: primaryStep?.id || null,
    blockingGateLabels,
    visibleSections,
    actions: {
      accept: {
        enabled: acceptEnabled,
        method: routeAcceptance.route.method,
        target: routeAcceptance.route.target,
        payload: routeAcceptance.submitPayload,
        disabledReasons: acceptEnabled ? [] : routeAcceptance.disabledReasons
      },
      deny: {
        enabled: denyEnabled,
        payload: {
          ...routeAcceptance.submitPayload,
          action: 'deny'
        }
      },
      requestChanges: {
        enabled: requestChangesEnabled,
        payload: {
          ...routeAcceptance.submitPayload,
          action: 'request-changes'
        }
      }
    },
    clientPresentation: {
      target: clientRuntime.workflow.target,
      visibleToUser: clientRuntime.visibleToUser,
      supportedActions: clientRuntime.workflow.supportedActions,
      nextAction: acceptEnabled ? 'enable_acceptance_submit' : primaryStep?.id || clientRuntime.workflow.nextAction,
      workflowHandoff: {
        schema: workflowHandoff.schema,
        status: workflowHandoff.status,
        handoffId: workflowHandoff.handoffId,
        owner: workflowHandoff.owner,
        target: workflowHandoff.target,
        nextAction: workflowHandoff.nextAction,
        reviewReasons: workflowHandoff.reviewReasons
      },
      requestState: {
        schema: clientRequestState.schema,
        phase: clientRequestState.phase,
        revision: clientRequestState.revision,
        handoffCursor: clientRequestState.handoffCursor,
        stateFingerprint: clientRequestState.binding.stateFingerprint,
        canBindPreview: clientRequestState.handoff.canBindPreview
      }
    }
  };
}

function normalizeClientReviewOptions(input) {
  const source = asObject(input.clientReview || input.previewPresentation || input.uiPreview);
  const route = asObject(source.route);
  const proof = asObject(source.proof);
  const density = ['compact', 'comfortable', 'detailed'].includes(source.density) ? source.density : 'comfortable';
  const maxNextSteps = finiteNumber(source.maxNextSteps, 4);

  return {
    density,
    locale: source.locale || input.locale || 'en-US',
    routeBasePath: route.basePath || source.routeBasePath || '/capability-security/policy-evaluator',
    requireFreshPreviewToken: source.requireFreshPreviewToken !== false,
    includeProofDetails: proof.includeDetails !== false && source.includeProofDetails !== false,
    redactPolicyIds: Boolean(source.redactPolicyIds),
    maxNextSteps: Math.max(1, Math.min(maxNextSteps || 4, 8))
  };
}

function redactIdList(values, redact) {
  return redact ? values.map((_, index) => `policy-${index + 1}`) : values;
}

function buildClientReviewPacket({ input, request, preview, acceptanceReadiness, routeAcceptance, acceptanceReview, validationSummary, nextSteps, clientRuntime, clientRequestState, workflowHandoff, proofBundle, statePersistence, externalHandoff, now }) {
  const options = normalizeClientReviewOptions(input);
  const previewRoutePath = `${options.routeBasePath}/${encodeURIComponent(request.id)}/preview`;
  const actionRoutePath = `${options.routeBasePath}/${encodeURIComponent(request.id)}/acceptance`;
  const readinessItems = acceptanceReadiness.gates.map((gate) => ({
    id: gate.id,
    label: gate.label,
    state: gate.ready ? 'passed' : 'blocked',
    blockingReason: gate.ready ? null : routeAcceptance.disabledReasons.find((reason) => reason.includes(gate.id)) || `gate:${gate.id}`
  }));
  const validationCards = validationSummary.sections.map((section) => ({
    id: section.section,
    label: section.section,
    status: section.status,
    count: section.failureCount,
    blockingCount: section.blockingCount,
    codes: section.codes
  }));
  const nextStepQueue = nextSteps.steps
    .slice(0, options.maxNextSteps)
    .map((step, index) => ({
      ordinal: index + 1,
      id: step.id,
      type: step.type,
      label: step.label,
      remediation: step.remediation,
      severity: step.severity,
      retryable: step.retryable,
      routeHint: step.type === 'accept'
        ? actionRoutePath
        : step.type === 'retry' || step.retryable
          ? previewRoutePath
          : step.routeBinding?.previewSectionId || null,
      routeBinding: step.routeBinding || null
    }));
  const actionPayloads = {
    accept: acceptanceReview.actions.accept.payload,
    deny: acceptanceReview.actions.deny.payload,
    requestChanges: acceptanceReview.actions.requestChanges.payload
  };
  const packetId = contractFingerprint({
    schema: CLIENT_REVIEW_PACKET_SCHEMA,
    requestId: request.id,
    previewToken: routeAcceptance.previewToken,
    clientRequestStateFingerprint: clientRequestState.binding.stateFingerprint,
    workflowHandoffId: workflowHandoff.handoffId,
    workflowHandoffStatus: workflowHandoff.status,
    reviewState: acceptanceReview.reviewState,
    readinessStatus: acceptanceReadiness.status,
    validationStatus: validationSummary.status,
    operationReviewFingerprint: preview.operation.review.reviewFingerprint,
    proofHash: proofBundle.proofHash
  });

  return {
    schema: CLIENT_REVIEW_PACKET_SCHEMA,
    packetId,
    generatedAt: now,
    destination: {
      clientId: clientRuntime.clientId,
      sessionId: clientRuntime.sessionId,
      target: clientRuntime.workflow.target,
      handoffId: clientRuntime.workflow.handoffId,
      visibleToUser: clientRuntime.visibleToUser,
      requestStateFingerprint: clientRequestState.binding.stateFingerprint
    },
    presentation: {
      density: options.density,
      locale: options.locale,
      headline: acceptanceReview.headline,
      reviewState: acceptanceReview.reviewState,
      decisionTone: preview.decision === 'allow' ? 'positive' : 'negative',
      primaryNextStepId: acceptanceReview.primaryNextStepId,
      visibleSectionIds: acceptanceReview.visibleSections.map((section) => section.id)
    },
    navigation: {
      preview: {
        method: 'GET',
        path: previewRoutePath,
        previewToken: routeAcceptance.previewToken,
        requireFreshPreviewToken: options.requireFreshPreviewToken
      },
      submit: {
        method: 'POST',
        path: actionRoutePath,
        enabled: acceptanceReview.actions.accept.enabled,
        action: routeAcceptance.route.action,
        target: routeAcceptance.route.target
      }
    },
    decisionBanner: {
      decision: preview.decision,
      reason: preview.reason,
      requestLabel: preview.requestLabel,
      policySummary: {
        matchedPolicyIds: redactIdList(preview.policyMatch.matchedPolicyIds, options.redactPolicyIds),
        deniedPolicyIds: redactIdList(preview.policyMatch.deniedPolicyIds, options.redactPolicyIds),
        allowedPolicyIds: redactIdList(preview.policyMatch.allowedPolicyIds, options.redactPolicyIds),
        primaryReason: preview.policyMatch.primaryReason
      }
    },
    readinessChecklist: readinessItems,
    validationCards,
    nextStepQueue,
    actionBar: {
      allowedActions: routeAcceptance.allowedActions,
      disabledReasons: routeAcceptance.disabledReasons,
      acceptEnabled: acceptanceReview.actions.accept.enabled,
      denyEnabled: acceptanceReview.actions.deny.enabled,
      requestChangesEnabled: acceptanceReview.actions.requestChanges.enabled,
      payloads: actionPayloads
    },
    requestStateBinding: {
      schema: clientRequestState.schema,
      requestId: clientRequestState.requestId,
      phase: clientRequestState.phase,
      revision: clientRequestState.revision,
      handoffCursor: clientRequestState.handoffCursor,
      stale: clientRequestState.stale,
      ageMs: clientRequestState.ageMs,
      matchesRequest: clientRequestState.binding.matchesRequest,
      mismatches: clientRequestState.binding.mismatches,
      canBindPreview: clientRequestState.handoff.canBindPreview,
      handoffAction: clientRequestState.handoff.action
    },
    workflowHandoff: {
      schema: workflowHandoff.schema,
      required: workflowHandoff.required,
      status: workflowHandoff.status,
      handoffId: workflowHandoff.handoffId,
      owner: workflowHandoff.owner,
      target: workflowHandoff.target,
      highImpactDecision: workflowHandoff.highImpactDecision,
      reviewReasons: workflowHandoff.reviewReasons,
      allowedActions: workflowHandoff.allowedActions,
      acknowledgement: workflowHandoff.acknowledgement,
      nextAction: workflowHandoff.nextAction
    },
    operationReview: {
      schema: preview.operation.review.schema,
      status: preview.operation.review.status,
      decisionClass: preview.operation.review.decisionClass,
      routeDomain: preview.operation.review.routeDomain,
      summary: preview.operation.review.userVisibleSummary,
      reviewFingerprint: preview.operation.review.reviewFingerprint,
      evidenceItems: preview.operation.review.evidenceItems,
      missingRequiredEvidenceIds: preview.operation.review.missingRequiredEvidenceIds,
      warningEvidenceIds: preview.operation.review.warningEvidenceIds,
      routeBinding: preview.operation.review.routeBinding
    },
    proofSummary: {
      included: options.includeProofDetails,
      proofHash: proofBundle.proofHash,
      commitEligible: proofBundle.outcome.commitEligible,
      commandId: statePersistence.idempotency.commandId,
      checkpointId: statePersistence.checkpoint.checkpointId,
      nextRevision: statePersistence.checkpoint.nextRevision,
      externalHandoffState: externalHandoff.state,
      blockingCodes: options.includeProofDetails ? proofBundle.failureEvidence.blockingCodes : [],
      warningCodes: options.includeProofDetails ? proofBundle.failureEvidence.warningCodes : []
    },
    telemetry: {
      surfaceId,
      routeAcceptanceStatus: routeAcceptance.status,
      readinessStatus: acceptanceReadiness.status,
      validationStatus: validationSummary.status,
      nextStepCount: nextSteps.steps.length,
      packetFingerprint: packetId
    }
  };
}

function buildDecisionProofBundle({ request, operation, operationGuardrails, policies, matchedPolicies, deniedBy, allowedBy, decision, reason, lifecycleState, tenantBoundary, health, providerState, clientRuntime, clientRequestState, workflowHandoff, syncMetadata, externalHandoff, statePersistence, routeAcceptance, validationSummary, acceptanceReadiness, nextSteps, retry, finalFailures, now }) {
  const evaluatedPolicyIds = policies.map((policy) => policy.id);
  const warningCodes = finalFailures
    .filter((failure) => failure.severity === 'warning')
    .map((failure) => failure.code);
  const blockingCodes = finalFailures
    .filter((failure) => failure.severity === 'error')
    .map((failure) => failure.code);
  const gateResults = acceptanceReadiness.gates.map((gate) => ({
    gateId: gate.id,
    ready: gate.ready,
    blocking: acceptanceReadiness.blockedGateIds.includes(gate.id)
  }));
  const evidenceInputs = {
    requestId: request.id,
    principal: request.principal,
    capability: request.capability,
    route: request.route,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    roles: request.roles,
    permissions: request.permissions,
    operationSchema: operation.schema,
    operationDecisionClass: operation.decisionClass,
    operationRouteDomain: operation.routeDomain,
    operationMutating: operation.mutating,
    operationRequiresExternalHandoff: operation.requiresExternalHandoff,
    operationEffects: operation.effects,
    operationRawTargets: operation.rawTargets,
    operationTargets: operation.targets,
    operationTargetBoundaryStatus: operation.targetBoundary.status,
    operationTargetBoundaryUnsafe: operation.targetBoundary.unsafeRelativeTraversal,
    operationTargetBoundaryMatchingMode: operation.targetBoundary.matchingMode,
    operationGuardrailSchema: operationGuardrails.schema,
    operationGuardrailStatus: operationGuardrails.status,
    operationGuardrailBlockingCodes: operationGuardrails.blockingCodes,
    operationGuardrailWarningCodes: operationGuardrails.warningCodes,
    operationGuardrailBroadAllowPolicyIds: operationGuardrails.broadAllowPolicyIds,
    operationFingerprint: operation.auditFingerprint,
    policyIds: evaluatedPolicyIds,
    matchedPolicyIds: matchedPolicies.map((policy) => policy.id),
    deniedPolicyIds: deniedBy.map((policy) => policy.id),
    allowedPolicyIds: allowedBy.map((policy) => policy.id),
    workspaceGrantIds: tenantBoundary.workspaceGrant.matchedGrantIds,
    workspaceTargetScopeStatus: tenantBoundary.workspaceTargetScope.status,
    workspaceTargetScopeRequired: tenantBoundary.workspaceTargetScope.required,
    workspaceTargetScopeExpectedPatterns: tenantBoundary.workspaceTargetScope.expectedPatterns,
    workspaceTargetScopeOutOfScopeTargets: tenantBoundary.workspaceTargetScope.outOfScopeTargets,
    authorizationScopeFingerprint: tenantBoundary.authorizationScope.auditHandoff.scopeFingerprint,
    authorizationScopeSource: tenantBoundary.authorizationScope.source,
    authorizationScopeRoles: tenantBoundary.authorizationScope.roles,
    authorizationScopePermissions: tenantBoundary.authorizationScope.permissions,
    authorizationScopeCapabilities: tenantBoundary.authorizationScope.capabilities,
    authorizationScopeRoutes: tenantBoundary.authorizationScope.routes,
    providerContractIds: providerState.matchedContractIds,
    selectedProviderId: providerState.selectedProviderId,
    selectedProviderOperation: providerState.selectedNegotiation?.selectedOperation || null,
    selectedProviderHandoffMode: providerState.selectedNegotiation?.handoffMode || null,
    providerNegotiationStatuses: providerState.negotiationResults.map((result) => ({
      providerId: result.providerId,
      status: result.status,
      syncReady: result.syncReady,
      checkpointReady: result.checkpointReady,
      blockedReasons: result.blockedReasons
    })),
    providerNegotiationMatrix: providerState.negotiationMatrix,
    lifecycleCommand: lifecycleState.command,
    lifecycleCommitState: lifecycleState.commandPlan.commitState,
    lifecycleExecutionControlSchema: lifecycleState.executionControls.schema,
    lifecycleExecutionPermitted: lifecycleState.executionControls.permitted,
    lifecycleDeniedControlCodes: lifecycleState.executionControls.deniedControlCodes,
    lifecycleNextControlAction: lifecycleState.executionControls.nextControlAction,
    lifecycleSettingsControlSchema: lifecycleState.settingsControls.schema,
    lifecycleSettingsStateAction: lifecycleState.settingsControls.stateAction,
    lifecycleSettingsCanApply: lifecycleState.settingsControls.canApplySettings,
    lifecycleSettingsMutationCount: lifecycleState.settingsControls.settingsMutationCount,
    lifecycleSettingsBlockedSettings: lifecycleState.settingsControls.blockedSettings,
    lifecycleSettingsNextAction: lifecycleState.settingsControls.nextAction,
    lifecycleExplicitIntent: lifecycleState.settingsControls.explicitIntent,
    lifecycleTransitionId: lifecycleState.transition.transitionId,
    lifecycleTransitionRuntimeMode: lifecycleState.transition.runtimeMode,
    lifecycleTransitionCheckpointAction: lifecycleState.transition.checkpointAction,
    lifecycleTransitionScheduleDirective: lifecycleState.transition.scheduleDirective,
    lifecycleTransitionActions: lifecycleState.transition.route.actions,
    clientRequestStateFingerprint: clientRequestState.binding.stateFingerprint,
    clientRequestStatePhase: clientRequestState.phase,
    clientRequestStateRevision: clientRequestState.revision,
    clientRequestStateHandoffCursor: clientRequestState.handoffCursor,
    clientRequestStateCanBindPreview: clientRequestState.handoff.canBindPreview,
    workflowHandoffSchema: workflowHandoff.schema,
    workflowHandoffRequired: workflowHandoff.required,
    workflowHandoffStatus: workflowHandoff.status,
    workflowHandoffId: workflowHandoff.handoffId,
    workflowHandoffOwner: workflowHandoff.owner,
    workflowHandoffReviewReasons: workflowHandoff.reviewReasons,
    workflowHandoffNextAction: workflowHandoff.nextAction,
    workflowHandoffAcknowledgementRequired: workflowHandoff.acknowledgement.required,
    workflowHandoffAcknowledgementMatchesRequest: workflowHandoff.acknowledgement.matchesRequest,
    validationStatus: validationSummary.status,
    healthStatus: health.status,
    externalHandoffState: externalHandoff.state,
    commandId: statePersistence.idempotency.commandId,
    checkpointId: statePersistence.checkpoint.checkpointId,
    previewToken: routeAcceptance.previewToken,
    operationReviewSchema: routeAcceptance.proofRequirements.operationReviewFingerprint ? OPERATION_REVIEW_SCHEMA : null,
    operationReviewFingerprint: routeAcceptance.proofRequirements.operationReviewFingerprint
  };
  const proofHash = contractFingerprint({
    schema: PROOF_BUNDLE_SCHEMA,
    generatedAt: now,
    decision,
    reason,
    evidenceInputs,
    blockedGateIds: acceptanceReadiness.blockedGateIds,
    blockingCodes,
    warningCodes
  });
  const commitEligible = decision === 'allow'
    && acceptanceReadiness.ready
    && routeAcceptance.status === 'accepted'
    && statePersistence.commitPlan.safeToApplySideEffects
    && blockingCodes.length === 0;

  return {
    schema: PROOF_BUNDLE_SCHEMA,
    proofHash,
    generatedAt: now,
    surfaceId,
    requestId: request.id,
    decision,
    reason,
    outcome: {
      ok: decision === 'allow',
      commitEligible,
      acceptanceStatus: routeAcceptance.status,
      restartSafeStatus: statePersistence.checkpoint.restartSafeStatus,
      safeToApplySideEffects: statePersistence.commitPlan.safeToApplySideEffects,
      retryable: retry.retryable
    },
    evidenceInputs,
    policyEvidence: {
      policyCount: policies.length,
      evaluatedPolicyIds,
      matchedPolicyIds: evidenceInputs.matchedPolicyIds,
      deniedPolicyIds: evidenceInputs.deniedPolicyIds,
      allowedPolicyIds: evidenceInputs.allowedPolicyIds,
      explicitDeny: deniedBy.length > 0,
      explicitAllow: allowedBy.length > 0
    },
    operationEvidence: {
      schema: operation.schema,
      decisionClass: operation.decisionClass,
      routeDomain: operation.routeDomain,
      mutating: operation.mutating,
      requiresExternalHandoff: operation.requiresExternalHandoff,
      effects: operation.effects,
      rawTargets: operation.rawTargets,
      targets: operation.targets,
      targetBoundary: operation.targetBoundary,
      guardrails: {
        schema: operationGuardrails.schema,
        status: operationGuardrails.status,
        targetKinds: operationGuardrails.targetKinds,
        targetCount: operationGuardrails.targetCount,
        matchedAllowPolicyIds: operationGuardrails.matchedAllowPolicyIds,
        broadAllowPolicyIds: operationGuardrails.broadAllowPolicyIds,
        controls: operationGuardrails.controls,
        shellSignals: operationGuardrails.shellSignals,
        productionDeploy: operationGuardrails.productionDeploy,
        externalWriteHasNetworkTarget: operationGuardrails.externalWriteHasNetworkTarget,
        blockingCodes: operationGuardrails.blockingCodes,
        warningCodes: operationGuardrails.warningCodes
      },
      syscall: operation.syscall,
      command: operation.command,
      path: operation.path,
      externalHost: operation.externalHost,
      deploymentTarget: operation.deploymentTarget,
      auditFingerprint: operation.auditFingerprint
    },
    boundaryEvidence: {
      schema: tenantBoundary.schema,
      status: tenantBoundary.status,
      required: tenantBoundary.required,
      matchedPolicyIds: tenantBoundary.matchedPolicyIds,
      workspaceGrantRequired: tenantBoundary.workspaceGrant.required,
      workspaceGrantStatus: tenantBoundary.workspaceGrant.status,
      workspaceGrantSelectedId: tenantBoundary.workspaceGrant.selectedGrantId,
      workspaceTargetScopeSchema: tenantBoundary.workspaceTargetScope.schema,
      workspaceTargetScopeRequired: tenantBoundary.workspaceTargetScope.required,
      workspaceTargetScopeStatus: tenantBoundary.workspaceTargetScope.status,
      workspaceTargetScopeSource: tenantBoundary.workspaceTargetScope.source,
      workspaceTargetScopeCheckableTargetCount: tenantBoundary.workspaceTargetScope.checkableTargetCount,
      workspaceTargetScopeOutOfScopeCount: tenantBoundary.workspaceTargetScope.outOfScopeTargets.length,
      authorizationScopeSchema: tenantBoundary.authorizationScope.schema,
      authorizationScopeSource: tenantBoundary.authorizationScope.source,
      authorizationScopeFingerprint: tenantBoundary.authorizationScope.auditHandoff.scopeFingerprint,
      leastPrivilege: tenantBoundary.authorizationScope.leastPrivilege,
      effectiveRoles: tenantBoundary.authorizationScope.roles,
      effectivePermissions: tenantBoundary.authorizationScope.permissions,
      effectiveCapabilities: tenantBoundary.authorizationScope.capabilities,
      effectiveRoutes: tenantBoundary.authorizationScope.routes
    },
    runtimeEvidence: {
      lifecycleCommand: lifecycleState.command,
      lifecycleNextAction: lifecycleState.nextAction,
      lifecycleCommitState: lifecycleState.commandPlan.commitState,
      lifecycleExecutionPermitted: lifecycleState.executionControls.permitted,
      lifecycleNextControlAction: lifecycleState.executionControls.nextControlAction,
      lifecycleDeniedControlCodes: lifecycleState.executionControls.deniedControlCodes,
      lifecycleTransitionId: lifecycleState.transition.transitionId,
      lifecycleTransitionRuntimeMode: lifecycleState.transition.runtimeMode,
      lifecycleTransitionCheckpointAction: lifecycleState.transition.checkpointAction,
      lifecycleTransitionScheduleDirective: lifecycleState.transition.scheduleDirective,
      lifecycleTransitionNextWakeAt: lifecycleState.transition.nextWakeAt,
      lifecycleTransitionActions: lifecycleState.transition.route.actions,
      healthStatus: health.status,
      operationalMode: health.operational.mode,
      operationalResponseSchema: health.operationalResponse.schema,
      operationalResponseMode: health.operationalResponse.responseMode,
      operationalIncidentId: health.operationalResponse.incidentId,
      operationalPrimaryAction: health.operationalResponse.primaryAction?.action || null,
      operationalCanCommitGrant: health.operationalResponse.degradationPolicy.canCommitGrant,
      providerStatus: providerState.status,
      selectedProviderId: providerState.selectedProviderId,
      providerNegotiationSchema: providerState.negotiation.schema,
      providerNegotiationRequired: providerState.negotiation.required,
      selectedProviderOperation: providerState.selectedNegotiation?.selectedOperation || null,
      selectedProviderHandoffMode: providerState.selectedNegotiation?.handoffMode || null,
      selectedProviderSyncReady: providerState.selectedNegotiation?.syncReady ?? null,
      selectedProviderCheckpointReady: providerState.selectedNegotiation?.checkpointReady ?? null,
      providerSyncBlockedIds: providerState.syncBlockedContractIds,
      providerCheckpointBlockedIds: providerState.checkpointBlockedContractIds,
      clientRuntimeState: clientRuntime.state,
      clientWorkflowNextAction: clientRuntime.workflow.nextAction,
      clientRequestStateSchema: clientRequestState.schema,
      clientRequestStatePhase: clientRequestState.phase,
      clientRequestStateRevision: clientRequestState.revision,
      clientRequestStateStale: clientRequestState.stale,
      clientRequestStateMatchesRequest: clientRequestState.binding.matchesRequest,
      clientRequestStateMismatches: clientRequestState.binding.mismatches,
      clientRequestStateHandoffAction: clientRequestState.handoff.action,
      workflowHandoffStatus: workflowHandoff.status,
      workflowHandoffNextAction: workflowHandoff.nextAction,
      workflowHandoffReviewReasons: workflowHandoff.reviewReasons,
      syncRequired: syncMetadata.syncRequired,
      externalHandoffState: externalHandoff.state
    },
    acceptanceEvidence: {
      readinessStatus: acceptanceReadiness.status,
      blockedGateIds: acceptanceReadiness.blockedGateIds,
      gateResults,
      routeStatus: routeAcceptance.status,
      routeAccepted: routeAcceptance.accepted,
      previewToken: routeAcceptance.previewToken,
      operationReviewFingerprint: routeAcceptance.proofRequirements.operationReviewFingerprint,
      workflowHandoffState: routeAcceptance.proofRequirements.workflowHandoffState,
      workflowHandoffNextAction: routeAcceptance.proofRequirements.workflowHandoffNextAction,
      actor: routeAcceptance.actor,
      action: routeAcceptance.action
    },
    persistenceEvidence: {
      schema: statePersistence.schema,
      commandId: statePersistence.idempotency.commandId,
      idempotencyResult: statePersistence.idempotency.result,
      checkpointId: statePersistence.checkpoint.checkpointId,
      nextRevision: statePersistence.checkpoint.nextRevision,
      mutationSchema: statePersistence.stateMutation.schema,
      mutationId: statePersistence.stateMutation.mutationId,
      mutationStatus: statePersistence.stateMutation.status,
      revisionPolicy: statePersistence.stateMutation.revisionPolicy,
      leasePolicy: statePersistence.stateMutation.leasePolicy,
      recoveryActions: statePersistence.stateMutation.recoveryActions,
      sideEffectPolicyReason: statePersistence.stateMutation.sideEffectPolicy.reason,
      commitAction: statePersistence.commitPlan.action,
      durableWriteId: statePersistence.commitPlan.durableWrite.writeId,
      writeBarrier: statePersistence.commitPlan.durableWrite.writeBarrier
    },
    failureEvidence: {
      validationStatus: validationSummary.status,
      blockingCodes,
      warningCodes,
      nextStepIds: nextSteps.steps.map((step) => step.id)
    }
  };
}

export function evaluateCapabilityPolicy(input = {}) {
  const now = input.now || new Date().toISOString();
  const nowMs = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const request = normalizeCapabilityRequest(input);
  const operation = normalizeCapabilityOperation(input, request);
  const evaluatorInput = operation.requiresExternalHandoff
    ? { ...input, requireExternalHandoff: true }
    : input;
  const policies = normalizePolicies(input);
  const lifecycle = normalizeLifecycleSettings(input, nowMs);
  const validationErrors = validateEvaluationInput(request, policies);
  const baseOperationErrors = validateCapabilityOperation(operation, input);
  const lifecycleErrors = validateLifecycleSettings(lifecycle, nowMs);
  const tenantBoundary = buildTenantBoundaryState(input, request, policies, operation);
  const tenantBoundaryErrors = tenantBoundary.failures;
  const health = computeHealth(input, nowMs);
  const operationalDecisionGate = buildOperationalDecisionGate(input, operation, health, nowMs);
  const healthFailures = [...health.failures, ...operationalDecisionGate.failures];
  const providerContracts = normalizeProviderContracts(input);
  const providerState = buildProviderContractState(request, providerContracts, evaluatorInput, operation);
  const clientRuntime = normalizeClientRuntimeState(input, request, now);
  const clientRuntimeErrors = validateClientRuntimeState(clientRuntime);
  const clientRequestState = normalizeClientRequestState(input, request, clientRuntime, nowMs, now);
  const clientRequestErrors = clientRequestState.failures;
  const syncMetadata = buildSyncMetadata(input, providerState, health, now);
  const contractErrors = providerState.failures;
  const matchedPolicies = policies.filter((policy) => (
    matchValue([policy.capability], request.capability)
    && matchValue(policy.principals, request.principal)
    && matchValue(policy.routes, request.route)
    && policyMatchesOperation(policy, operation).matched
    && (!tenantBoundary.required || tenantBoundary.matchedPolicyIds.includes(policy.id))
  ));
  const operationGuardrails = buildOperationGuardrails(input, operation, matchedPolicies);
  const operationErrors = [...baseOperationErrors, ...operationGuardrails.failures];
  const failures = [...validationErrors, ...operationErrors, ...lifecycleErrors, ...tenantBoundaryErrors, ...healthFailures, ...contractErrors, ...clientRuntimeErrors, ...clientRequestErrors];
  const deniedBy = matchedPolicies.filter((policy) => policy.effect === 'deny');
  const allowedBy = matchedPolicies.filter((policy) => policy.effect === 'allow');
  const lifecycleState = buildLifecycleState(lifecycle, failures, nowMs);
  const validationBlocked = [...validationErrors, ...operationErrors, ...lifecycleErrors, ...tenantBoundaryErrors, ...contractErrors, ...clientRuntimeErrors, ...clientRequestErrors].some((failure) => failure.severity === 'error');
  const degradedBlocked = operationalDecisionGate.blocksDecision;
  const baseDecision = validationBlocked || degradedBlocked || deniedBy.length > 0 || allowedBy.length === 0 ? 'deny' : 'allow';
  const baseReason = validationBlocked
    ? contractErrors.some((failure) => failure.severity === 'error')
      ? 'provider_contract_blocked'
      : clientRuntimeErrors.some((failure) => failure.severity === 'error')
      ? 'client_runtime_handoff_blocked'
      : clientRequestErrors.some((failure) => failure.severity === 'error')
      ? 'client_runtime_handoff_blocked'
      : operationErrors.some((failure) => failure.severity === 'error')
      ? 'capability_operation_blocked'
      : tenantBoundaryErrors.some((failure) => failure.severity === 'error')
      ? 'tenant_boundary_blocked'
      : lifecycleErrors.some((failure) => failure.severity === 'error')
      ? 'lifecycle_control_blocked'
      : 'validation_failed'
    : degradedBlocked
      ? 'operational_degraded_blocks_decision'
      : deniedBy.length > 0
        ? 'explicit_deny_policy'
        : allowedBy.length > 0
          ? 'explicit_allow_policy'
          : 'no_matching_allow_policy';
  const externalHandoff = buildExternalHandoffState(evaluatorInput, request, baseDecision, baseReason, providerState, syncMetadata, clientRuntime, now);
  const handoffBlocked = externalHandoff.failures.some((failure) => failure.severity === 'error');
  const decision = handoffBlocked ? 'deny' : baseDecision;
  const reason = handoffBlocked ? 'external_handoff_blocked' : baseReason;
  const resolvedExternalHandoff = {
    ...externalHandoff,
    decision,
    reason,
    state: handoffBlocked ? 'blocked' : externalHandoff.state
  };
  const workflowHandoff = buildWorkflowHandoffContract({
    input,
    request,
    operation,
    operationGuardrails,
    externalHandoff: resolvedExternalHandoff,
    clientRuntime,
    clientRequestState,
    now
  });
  const workflowHandoffErrors = workflowHandoff.failures;
  const finalFailures = [
    ...failures,
    ...(handoffBlocked ? externalHandoff.failures : []),
    ...workflowHandoffErrors
  ];
  const retry = buildRetryPlan(finalFailures, input.attempt);
  const validationSummary = buildValidationSummary(validationErrors, operationErrors, lifecycleErrors, tenantBoundaryErrors, healthFailures, contractErrors, externalHandoff.failures, clientRuntimeErrors, clientRequestErrors, workflowHandoffErrors);
  const preview = buildUserPreview({
    request,
    operation,
    operationGuardrails,
    decision,
    reason,
    matchedPolicies,
    deniedBy,
    allowedBy,
    lifecycleState,
    tenantBoundary,
    providerState,
    externalHandoff: resolvedExternalHandoff,
    syncMetadata,
    clientRuntime,
    clientRequestState,
    workflowHandoff
  });
  const acceptanceReadiness = buildAcceptanceReadiness({
    decision,
    operation,
    operationReview: preview.operation.review,
    health,
    lifecycleState,
    tenantBoundary,
    providerState,
    externalHandoff: resolvedExternalHandoff,
    clientRuntime,
    clientRequestState,
    workflowHandoff,
    validationSummary,
    retry
  });
  const nextSteps = buildExplainableNextSteps({
    decision,
    reason,
    finalFailures,
    operationReview: preview.operation.review,
    lifecycleState,
    tenantBoundary,
    providerState,
    externalHandoff: resolvedExternalHandoff,
    clientRuntime,
    clientRequestState,
    workflowHandoff,
    syncMetadata,
    retry
  });
  const statePersistence = buildPersistenceRecoveryState({
    input,
    request,
    lifecycleState,
    decision,
    reason,
    retry,
    externalHandoff: resolvedExternalHandoff,
    now
  });
  const routeAcceptance = buildRouteAcceptanceContract({
    input,
    request,
    preview,
    acceptanceReadiness,
    validationSummary,
    decision,
    reason,
    externalHandoff: resolvedExternalHandoff,
    clientRuntime,
    clientRequestState,
    workflowHandoff,
    statePersistence,
    nextSteps,
    now
  });
  const proofBundle = buildDecisionProofBundle({
    request,
    operation,
    operationGuardrails,
    policies,
    matchedPolicies,
    deniedBy,
    allowedBy,
    decision,
    reason,
    lifecycleState,
    tenantBoundary,
    health,
    providerState,
    clientRuntime,
    clientRequestState,
    workflowHandoff,
    syncMetadata,
    externalHandoff: resolvedExternalHandoff,
    statePersistence,
    routeAcceptance,
    validationSummary,
    acceptanceReadiness,
    nextSteps,
    retry,
    finalFailures,
    now
  });
  const acceptanceReview = buildAcceptanceReviewContract({
    request,
    preview,
    acceptanceReadiness,
    routeAcceptance,
    validationSummary,
    nextSteps,
    clientRuntime,
    clientRequestState,
    workflowHandoff,
    proofBundle,
    now
  });
  const clientReviewPacket = buildClientReviewPacket({
    input,
    request,
    preview,
    acceptanceReadiness,
    routeAcceptance,
    acceptanceReview,
    validationSummary,
    nextSteps,
    clientRuntime,
    clientRequestState,
    workflowHandoff,
    proofBundle,
    statePersistence,
    externalHandoff: resolvedExternalHandoff,
    now
  });
  const historySnapshots = normalizeHistorySnapshots(input);
  const currentEvaluation = {
    decision,
    reason,
    request,
    operation,
    operationGuardrails,
    health,
    operationalDecisionGate,
    lifecycle: lifecycleState,
    tenantBoundary,
    routeAcceptance,
    acceptanceReview,
    clientReviewPacket,
    validationSummary,
    providerState,
    clientRequestState,
    workflowHandoff,
    statePersistence,
    proofBundle,
    retry,
    audit: {
      matchedPolicyIds: matchedPolicies.map((policy) => policy.id)
    }
  };
  const analytics = buildDecisionAnalytics(currentEvaluation, historySnapshots);
  const reporting = buildReportingState(currentEvaluation, historySnapshots, analytics, now);

  return {
    ok: decision === 'allow',
    decision,
    reason,
    request,
    operation,
    operationGuardrails,
    health,
    lifecycle: lifecycleState,
    tenantBoundary,
    preview,
    acceptanceReadiness,
    routeAcceptance,
    acceptanceReview,
    clientReviewPacket,
    validationSummary,
    nextSteps,
    providerContracts: providerState,
    clientRuntime,
    clientRequestState,
    workflowHandoff,
    syncMetadata,
    externalHandoff: resolvedExternalHandoff,
    statePersistence,
    proofBundle,
    degradedMode: {
      active: health.degraded,
      failClosed: input.failClosedOnDegraded !== false,
      operationalMode: health.operational.mode,
      responseMode: health.operationalResponse.responseMode,
      decisionGateStatus: operationalDecisionGate.status,
      decisionGateBlockReason: operationalDecisionGate.blockReason,
      incidentId: health.operationalResponse.incidentId,
      canPresentPreview: operationalDecisionGate.degradationPolicy.canPreview,
      canCommitGrant: operationalDecisionGate.degradationPolicy.canCommitGrant,
      primaryAction: health.operationalResponse.primaryAction,
      retryAfterMs: retry.nextAttemptAfterMs,
      userAction: operationalDecisionGate.blocksDecision
        ? operationalDecisionGate.failures[0]?.remediation || 'Resolve operational health before granting this capability.'
        : health.degraded
          ? 'Continue only within the reported degraded-mode limits.'
          : null
    },
    retry,
    actionableErrors: finalFailures,
    failureGroups: groupFailuresBySeverity(finalFailures),
    audit: {
      surfaceId,
      generatedAt: now,
      requestId: request.id,
      decision,
      reason,
      operationSchema: operation.schema,
      operationDecisionClass: operation.decisionClass,
      operationRouteDomain: operation.routeDomain,
      operationMutating: operation.mutating,
      operationRequiresExternalHandoff: operation.requiresExternalHandoff,
      operationEffects: operation.effects,
      operationRawTargets: operation.rawTargets,
      operationTargets: operation.targets,
      operationTargetBoundarySchema: operation.targetBoundary.schema,
      operationTargetBoundaryStatus: operation.targetBoundary.status,
      operationTargetBoundaryCanonicalizationRequired: operation.targetBoundary.canonicalizationRequired,
      operationTargetBoundaryTraversalDetected: operation.targetBoundary.traversalDetected,
      operationTargetBoundaryUnsafe: operation.targetBoundary.unsafeRelativeTraversal,
      operationTargetBoundaryMatchingMode: operation.targetBoundary.matchingMode,
      operationGuardrailSchema: operationGuardrails.schema,
      operationGuardrailStatus: operationGuardrails.status,
      operationGuardrailBlockingCodes: operationGuardrails.blockingCodes,
      operationGuardrailWarningCodes: operationGuardrails.warningCodes,
      operationGuardrailBroadAllowPolicyIds: operationGuardrails.broadAllowPolicyIds,
      operationGuardrailTargetKinds: operationGuardrails.targetKinds,
      operationReviewSchema: preview.operation.review.schema,
      operationReviewStatus: preview.operation.review.status,
      operationReviewFingerprint: preview.operation.review.reviewFingerprint,
      operationReviewMissingEvidenceIds: preview.operation.review.missingRequiredEvidenceIds,
      operationReviewRouteBinding: preview.operation.review.routeBinding,
      operationFingerprint: operation.auditFingerprint,
      matchedPolicyIds: matchedPolicies.map((policy) => policy.id),
      deniedPolicyIds: deniedBy.map((policy) => policy.id),
      allowedPolicyIds: allowedBy.map((policy) => policy.id),
      lifecycleCommand: lifecycleState.command,
      lifecycleNextAction: lifecycleState.nextAction,
      lifecycleBlockedBy: lifecycleState.blockedBy,
      lifecycleCommandPlanSchema: lifecycleState.commandPlan.schema,
      lifecycleCommandOperation: lifecycleState.commandPlan.operation,
      lifecycleCommandCommitState: lifecycleState.commandPlan.commitState,
      lifecycleCommandWouldChangeState: lifecycleState.commandPlan.commandWouldChangeState,
      lifecycleEffectiveEnabled: lifecycleState.commandPlan.effectiveEnabled,
      lifecycleEffectiveSuspended: lifecycleState.commandPlan.effectiveSuspended,
      lifecycleSchedulePatch: lifecycleState.commandPlan.schedulePatch,
      lifecycleExecutionControlSchema: lifecycleState.executionControls.schema,
      lifecycleExecutionPermitted: lifecycleState.executionControls.permitted,
      lifecycleDeniedControlCodes: lifecycleState.executionControls.deniedControlCodes,
      lifecycleBlockedPrerequisites: lifecycleState.executionControls.blockedPrerequisites,
      lifecycleNextControlAction: lifecycleState.executionControls.nextControlAction,
      lifecycleStatePatchFingerprint: lifecycleState.executionControls.auditTrail.statePatchFingerprint,
      lifecycleSettingsControlSchema: lifecycleState.settingsControls.schema,
      lifecycleSettingsStateAction: lifecycleState.settingsControls.stateAction,
      lifecycleSettingsCanApply: lifecycleState.settingsControls.canApplySettings,
      lifecycleSettingsMutationCount: lifecycleState.settingsControls.settingsMutationCount,
      lifecycleSettingsBlockedSettings: lifecycleState.settingsControls.blockedSettings,
      lifecycleSettingsNextAction: lifecycleState.settingsControls.nextAction,
      lifecycleTransitionSchema: lifecycleState.transition.schema,
      lifecycleTransitionId: lifecycleState.transition.transitionId,
      lifecycleTransitionRuntimeMode: lifecycleState.transition.runtimeMode,
      lifecycleTransitionCheckpointAction: lifecycleState.transition.checkpointAction,
      lifecycleTransitionCanMutate: lifecycleState.transition.commandCanMutate,
      lifecycleTransitionScheduleDirective: lifecycleState.transition.scheduleDirective,
      lifecycleTransitionNextWakeAt: lifecycleState.transition.nextWakeAt,
      lifecycleTransitionRouteActions: lifecycleState.transition.route.actions,
      tenantBoundarySchema: tenantBoundary.schema,
      tenantBoundaryStatus: tenantBoundary.status,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      tenantBoundaryMatchedPolicyIds: tenantBoundary.matchedPolicyIds,
      tenantBoundaryRejectedPolicyIds: tenantBoundary.rejectedPolicyIds,
      workspaceGrantSchema: tenantBoundary.workspaceGrant.schema,
      workspaceGrantRequired: tenantBoundary.workspaceGrant.required,
      workspaceGrantStatus: tenantBoundary.workspaceGrant.status,
      workspaceGrantSelectedId: tenantBoundary.workspaceGrant.selectedGrantId,
      workspaceGrantMatchedIds: tenantBoundary.workspaceGrant.matchedGrantIds,
      workspaceGrantRejectedIds: tenantBoundary.workspaceGrant.rejectedGrantIds,
      workspaceTargetScopeSchema: tenantBoundary.workspaceTargetScope.schema,
      workspaceTargetScopeRequired: tenantBoundary.workspaceTargetScope.required,
      workspaceTargetScopeStatus: tenantBoundary.workspaceTargetScope.status,
      workspaceTargetScopeSource: tenantBoundary.workspaceTargetScope.source,
      workspaceTargetScopeExpectedPatterns: tenantBoundary.workspaceTargetScope.expectedPatterns,
      workspaceTargetScopeCheckableTargetCount: tenantBoundary.workspaceTargetScope.checkableTargetCount,
      workspaceTargetScopeOutOfScopeCount: tenantBoundary.workspaceTargetScope.outOfScopeTargets.length,
      authorizationScopeSchema: tenantBoundary.authorizationScope.schema,
      authorizationScopeSource: tenantBoundary.authorizationScope.source,
      authorizationScopeFingerprint: tenantBoundary.authorizationScope.auditHandoff.scopeFingerprint,
      authorizationScopeSelectedGrantId: tenantBoundary.authorizationScope.selectedGrantId,
      authorizationScopeRoles: tenantBoundary.authorizationScope.roles,
      authorizationScopePermissions: tenantBoundary.authorizationScope.permissions,
      authorizationScopeCapabilities: tenantBoundary.authorizationScope.capabilities,
      authorizationScopeRoutes: tenantBoundary.authorizationScope.routes,
      authorizationScopeLeastPrivilege: tenantBoundary.authorizationScope.leastPrivilege,
      providerContractSchema: providerState.schema,
      providerContractStatus: providerState.status,
      selectedProviderId: providerState.selectedProviderId,
      providerMatchedContractIds: providerState.matchedContractIds,
      providerNegotiationSchema: providerState.negotiation.schema,
      providerNegotiationRequired: providerState.negotiation.required,
      providerNegotiationHandoffMode: providerState.negotiation.handoffMode,
      providerNegotiationRequiredOperations: providerState.negotiation.requiredOperations,
      providerNegotiationStatuses: providerState.negotiationResults.map((result) => ({
        providerId: result.providerId,
        status: result.status,
        syncReady: result.syncReady,
        checkpointReady: result.checkpointReady,
        blockedReasons: result.blockedReasons
      })),
      providerNegotiationMatrix: providerState.negotiationMatrix,
      selectedProviderOperation: providerState.selectedNegotiation?.selectedOperation || null,
      selectedProviderHandoffMode: providerState.selectedNegotiation?.handoffMode || null,
      selectedProviderSyncReady: providerState.selectedNegotiation?.syncReady ?? null,
      selectedProviderCheckpointReady: providerState.selectedNegotiation?.checkpointReady ?? null,
      selectedProviderSyncAgeMs: providerState.selectedNegotiation?.syncAgeMs ?? null,
      selectedProviderHandoffCheckpoint: providerState.selectedNegotiation?.handoffCheckpoint || null,
      selectedProviderSyncEpoch: providerState.selectedNegotiation?.syncEpoch || null,
      clientRuntimeSchema: clientRuntime.schema,
      clientRuntimeId: clientRuntime.clientId,
      clientRuntimeState: clientRuntime.state,
      clientRuntimeWorkflowHandoffId: clientRuntime.workflow.handoffId,
      clientRuntimeWorkflowNextAction: clientRuntime.workflow.nextAction,
      clientRequestStateSchema: clientRequestState.schema,
      clientRequestStateRequired: clientRequestState.required,
      clientRequestStateRequestId: clientRequestState.requestId,
      clientRequestStatePhase: clientRequestState.phase,
      clientRequestStateRevision: clientRequestState.revision,
      clientRequestStateStale: clientRequestState.stale,
      clientRequestStateMatchesRequest: clientRequestState.binding.matchesRequest,
      clientRequestStateMismatches: clientRequestState.binding.mismatches,
      clientRequestStateFingerprint: clientRequestState.binding.stateFingerprint,
      clientRequestStateHandoffAction: clientRequestState.handoff.action,
      clientRequestStateCanBindPreview: clientRequestState.handoff.canBindPreview,
      workflowHandoffSchema: workflowHandoff.schema,
      workflowHandoffStatus: workflowHandoff.status,
      workflowHandoffRequired: workflowHandoff.required,
      workflowHandoffId: workflowHandoff.handoffId,
      workflowHandoffNextAction: workflowHandoff.nextAction,
      workflowHandoffReviewReasons: workflowHandoff.reviewReasons,
      syncRequired: syncMetadata.syncRequired,
      syncStaleProviderIds: syncMetadata.staleProviderIds,
      syncProviderBlockedIds: syncMetadata.providerSyncBlockedIds,
      syncProviderCheckpointBlockedIds: syncMetadata.providerCheckpointBlockedIds,
      selectedProviderSync: syncMetadata.selectedProviderSync,
      externalHandoffState: resolvedExternalHandoff.state,
      externalHandoffId: externalHandoff.handoffId,
      externalHandoffOperation: resolvedExternalHandoff.serviceContract?.operation || null,
      externalHandoffMode: resolvedExternalHandoff.serviceContract?.handoffMode || null,
      statePersistenceSchema: statePersistence.schema,
      stateCheckpointId: statePersistence.checkpoint.checkpointId,
      stateRestartSafeStatus: statePersistence.checkpoint.restartSafeStatus,
      stateMutationSchema: statePersistence.stateMutation.schema,
      stateMutationId: statePersistence.stateMutation.mutationId,
      stateMutationStatus: statePersistence.stateMutation.status,
      stateRevisionPolicy: statePersistence.stateMutation.revisionPolicy,
      stateLeasePolicy: statePersistence.stateMutation.leasePolicy,
      stateRecoveryActions: statePersistence.stateMutation.recoveryActions,
      stateSideEffectPolicyReason: statePersistence.stateMutation.sideEffectPolicy.reason,
      stateNextRevision: statePersistence.checkpoint.nextRevision,
      idempotencyCommandId: statePersistence.idempotency.commandId,
      idempotencyResult: statePersistence.idempotency.result,
      duplicateCommand: statePersistence.idempotency.duplicate,
      recoveryRequired: statePersistence.idempotency.recoveryRequired,
      previewSchema: preview.schema,
      acceptanceReadinessStatus: acceptanceReadiness.status,
      routeAcceptanceSchema: routeAcceptance.schema,
      routeAcceptanceStatus: routeAcceptance.status,
      routeAcceptancePreviewToken: routeAcceptance.previewToken,
      routeAcceptanceAccepted: routeAcceptance.accepted,
      routeAcceptanceAction: routeAcceptance.action,
      routeAcceptanceDisabledReasons: routeAcceptance.disabledReasons,
      acceptanceReviewSchema: acceptanceReview.schema,
      acceptanceReviewState: acceptanceReview.reviewState,
      acceptanceReviewPrimaryNextStepId: acceptanceReview.primaryNextStepId,
      acceptanceReviewAcceptEnabled: acceptanceReview.actions.accept.enabled,
      acceptanceReviewVisibleSectionCount: acceptanceReview.visibleSections.length,
      clientReviewPacketSchema: clientReviewPacket.schema,
      clientReviewPacketId: clientReviewPacket.packetId,
      clientReviewPacketState: clientReviewPacket.presentation.reviewState,
      clientReviewPacketPreviewPath: clientReviewPacket.navigation.preview.path,
      clientReviewPacketSubmitPath: clientReviewPacket.navigation.submit.path,
      clientReviewPacketNextStepCount: clientReviewPacket.nextStepQueue.length,
      clientReviewPacketAcceptEnabled: clientReviewPacket.actionBar.acceptEnabled,
      proofBundleSchema: proofBundle.schema,
      proofHash: proofBundle.proofHash,
      proofCommitEligible: proofBundle.outcome.commitEligible,
      proofBlockingCodes: proofBundle.failureEvidence.blockingCodes,
      validationSummaryStatus: validationSummary.status,
      healthStatus: health.status,
      operationalHealthSchema: health.operational.schema,
      operationalHealthStatus: health.operational.status,
      operationalHealthMode: health.operational.mode,
      operationalCircuitState: health.operational.circuitBreaker.state,
      operationalQueueDepth: health.operational.queue.depth,
      operationalQueueBacklog: health.operational.queue.backlog,
      operationalWorkerStatus: health.operational.worker.status,
      operationalConsecutiveFailures: health.operational.worker.consecutiveFailures,
      operationalRetryAfterMs: health.operational.circuitBreaker.retryAfterMs,
      operationalResponseSchema: health.operationalResponse.schema,
      operationalResponseStatus: health.operationalResponse.status,
      operationalResponseMode: health.operationalResponse.responseMode,
      operationalIncidentId: health.operationalResponse.incidentId,
      operationalPrimaryAction: health.operationalResponse.primaryAction?.action || null,
      operationalEscalationRequired: health.operationalResponse.escalation.required,
      operationalCanEvaluate: health.operationalResponse.degradationPolicy.canEvaluate,
      operationalCanCommitGrant: health.operationalResponse.degradationPolicy.canCommitGrant,
      operationalDecisionGateSchema: operationalDecisionGate.schema,
      operationalDecisionGateStatus: operationalDecisionGate.status,
      operationalDecisionGateBlocksDecision: operationalDecisionGate.blocksDecision,
      operationalDecisionGateBlockReason: operationalDecisionGate.blockReason,
      operationalDecisionGateCanCommitGrant: operationalDecisionGate.degradationPolicy.canCommitGrant,
      operationalDecisionGateNextAttemptAt: operationalDecisionGate.retry.nextAttemptAt,
      nextStepCount: nextSteps.steps.length,
      analyticsCounters: analytics.counters,
      exportSchema: reporting.exportSummary.schema,
      analyticsExportSchema: reporting.exportContract.schema,
      analyticsExportId: reporting.exportContract.manifest.exportId,
      analyticsExportRowCount: reporting.exportContract.manifest.rowCount,
      reportingTimelineSchema: REPORTING_TIMELINE_SCHEMA
    },
    analytics,
    reporting,
    proof: {
      type: 'hosted-kernel-capability-policy-evaluation',
      policyCount: policies.length,
      validationErrorCount: validationErrors.length,
      operationErrorCount: operationErrors.length,
      operationSchema: operation.schema,
      operationDecisionClass: operation.decisionClass,
      operationRouteDomain: operation.routeDomain,
      operationMutating: operation.mutating,
      operationRequiresExternalHandoff: operation.requiresExternalHandoff,
      operationTargetBoundaryStatus: operation.targetBoundary.status,
      operationTargetBoundaryUnsafe: operation.targetBoundary.unsafeRelativeTraversal,
      operationGuardrailStatus: operationGuardrails.status,
      operationGuardrailBlockingCodeCount: operationGuardrails.blockingCodes.length,
      operationGuardrailWarningCodeCount: operationGuardrails.warningCodes.length,
      operationGuardrailBroadAllowPolicyCount: operationGuardrails.broadAllowPolicyIds.length,
      operationCanonicalTargetCount: operation.targets.length,
      operationReviewSchema: preview.operation.review.schema,
      operationReviewStatus: preview.operation.review.status,
      operationReviewMissingEvidenceCount: preview.operation.review.missingRequiredEvidenceIds.length,
      operationReviewWarningEvidenceCount: preview.operation.review.warningEvidenceIds.length,
      operationReviewFingerprint: preview.operation.review.reviewFingerprint,
      lifecycleErrorCount: lifecycleErrors.length,
      lifecycleSchema: lifecycleState.schema,
      lifecycleCommandPlanSchema: lifecycleState.commandPlan.schema,
      lifecycleNextAction: lifecycleState.nextAction,
      lifecycleCommandOperation: lifecycleState.commandPlan.operation,
      lifecycleCommandCommitState: lifecycleState.commandPlan.commitState,
      lifecycleCommandWouldChangeState: lifecycleState.commandPlan.commandWouldChangeState,
      lifecycleEffectiveEnabled: lifecycleState.commandPlan.effectiveEnabled,
      lifecycleEffectiveSuspended: lifecycleState.commandPlan.effectiveSuspended,
      lifecycleSchedulePatch: lifecycleState.commandPlan.schedulePatch,
      lifecycleExecutionControlSchema: lifecycleState.executionControls.schema,
      lifecycleExecutionPermitted: lifecycleState.executionControls.permitted,
      lifecycleDeniedControlCodeCount: lifecycleState.executionControls.deniedControlCodes.length,
      lifecycleBlockedPrerequisiteCount: lifecycleState.executionControls.blockedPrerequisites.length,
      lifecycleNextControlAction: lifecycleState.executionControls.nextControlAction,
      lifecycleSettingsControlSchema: lifecycleState.settingsControls.schema,
      lifecycleSettingsStateAction: lifecycleState.settingsControls.stateAction,
      lifecycleSettingsCanApply: lifecycleState.settingsControls.canApplySettings,
      lifecycleSettingsMutationCount: lifecycleState.settingsControls.settingsMutationCount,
      lifecycleSettingsBlockedSettingCount: lifecycleState.settingsControls.blockedSettings.length,
      lifecycleSettingsNextAction: lifecycleState.settingsControls.nextAction,
      lifecycleTransitionSchema: lifecycleState.transition.schema,
      lifecycleTransitionId: lifecycleState.transition.transitionId,
      lifecycleTransitionRuntimeMode: lifecycleState.transition.runtimeMode,
      lifecycleTransitionCheckpointAction: lifecycleState.transition.checkpointAction,
      lifecycleTransitionCanMutate: lifecycleState.transition.commandCanMutate,
      lifecycleTransitionScheduleDirective: lifecycleState.transition.scheduleDirective,
      lifecycleTransitionNextWakeAt: lifecycleState.transition.nextWakeAt,
      lifecycleTransitionActionCount: lifecycleState.transition.route.actions.length,
      tenantBoundarySchema: tenantBoundary.schema,
      tenantBoundaryRequired: tenantBoundary.required,
      tenantBoundaryStatus: tenantBoundary.status,
      tenantBoundaryFailureCount: tenantBoundaryErrors.length,
      tenantBoundaryMatchedPolicyCount: tenantBoundary.matchedPolicyIds.length,
      workspaceGrantSchema: tenantBoundary.workspaceGrant.schema,
      workspaceGrantRequired: tenantBoundary.workspaceGrant.required,
      workspaceGrantStatus: tenantBoundary.workspaceGrant.status,
      workspaceGrantSelectedId: tenantBoundary.workspaceGrant.selectedGrantId,
      workspaceGrantMatchedCount: tenantBoundary.workspaceGrant.matchedGrantIds.length,
      workspaceGrantRejectedCount: tenantBoundary.workspaceGrant.rejectedGrantIds.length,
      workspaceTargetScopeSchema: tenantBoundary.workspaceTargetScope.schema,
      workspaceTargetScopeRequired: tenantBoundary.workspaceTargetScope.required,
      workspaceTargetScopeStatus: tenantBoundary.workspaceTargetScope.status,
      workspaceTargetScopeCheckableTargetCount: tenantBoundary.workspaceTargetScope.checkableTargetCount,
      workspaceTargetScopeOutOfScopeCount: tenantBoundary.workspaceTargetScope.outOfScopeTargets.length,
      authorizationScopeSchema: tenantBoundary.authorizationScope.schema,
      authorizationScopeSource: tenantBoundary.authorizationScope.source,
      authorizationScopeFingerprint: tenantBoundary.authorizationScope.auditHandoff.scopeFingerprint,
      authorizationScopeRoleCount: tenantBoundary.authorizationScope.roles.length,
      authorizationScopePermissionCount: tenantBoundary.authorizationScope.permissions.length,
      authorizationScopeCapabilityCount: tenantBoundary.authorizationScope.capabilities.length,
      authorizationScopeRouteCount: tenantBoundary.authorizationScope.routes.length,
      authorizationScopeGrantConstrained: tenantBoundary.authorizationScope.leastPrivilege.grantConstrained,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      providerContractSchema: providerState.schema,
      providerContractStatus: providerState.status,
      providerContractCount: providerState.contractCount,
      providerContractFailureCount: contractErrors.length,
      providerNegotiationSchema: providerState.negotiation.schema,
      providerNegotiationRequired: providerState.negotiation.required,
      providerNegotiationResultCount: providerState.negotiationResults.length,
      providerNegotiationBlockedCount: providerState.negotiationResults.filter((result) => !result.satisfied).length,
      selectedProviderOperation: providerState.selectedNegotiation?.selectedOperation || null,
      selectedProviderHandoffMode: providerState.selectedNegotiation?.handoffMode || null,
      selectedProviderSyncReady: providerState.selectedNegotiation?.syncReady ?? null,
      selectedProviderCheckpointReady: providerState.selectedNegotiation?.checkpointReady ?? null,
      providerSyncBlockedCount: providerState.syncBlockedContractIds.length,
      providerCheckpointBlockedCount: providerState.checkpointBlockedContractIds.length,
      clientRuntimeSchema: clientRuntime.schema,
      clientRuntimeRequired: clientRuntime.required,
      clientRuntimeState: clientRuntime.state,
      clientRuntimeFailureCount: clientRuntimeErrors.length,
      clientWorkflowHandoffId: clientRuntime.workflow.handoffId,
      clientWorkflowNextAction: clientRuntime.workflow.nextAction,
      clientRequestStateSchema: clientRequestState.schema,
      clientRequestStateRequired: clientRequestState.required,
      clientRequestStatePhase: clientRequestState.phase,
      clientRequestStateRevision: clientRequestState.revision,
      clientRequestStateFailureCount: clientRequestErrors.length,
      clientRequestStateCanBindPreview: clientRequestState.handoff.canBindPreview,
      clientRequestStateFingerprint: clientRequestState.binding.stateFingerprint,
      workflowHandoffSchema: workflowHandoff.schema,
      workflowHandoffRequired: workflowHandoff.required,
      workflowHandoffStatus: workflowHandoff.status,
      workflowHandoffFailureCount: workflowHandoffErrors.length,
      workflowHandoffNextAction: workflowHandoff.nextAction,
      workflowHandoffReviewReasonCount: workflowHandoff.reviewReasons.length,
      selectedProviderId: providerState.selectedProviderId,
      syncMetadataSchema: syncMetadata.schema,
      syncRequired: syncMetadata.syncRequired,
      syncProviderBlockedCount: syncMetadata.providerSyncBlockedIds.length,
      syncProviderCheckpointBlockedCount: syncMetadata.providerCheckpointBlockedIds.length,
      selectedProviderSyncEpoch: syncMetadata.selectedProviderSync?.syncEpoch || null,
      externalHandoffSchema: externalHandoff.schema,
      externalHandoffState: resolvedExternalHandoff.state,
      externalHandoffFailureCount: externalHandoff.failures.length,
      externalHandoffOperation: resolvedExternalHandoff.serviceContract?.operation || null,
      statePersistenceSchema: statePersistence.schema,
      stateRestored: statePersistence.checkpoint.restored,
      stateRestartSafeStatus: statePersistence.checkpoint.restartSafeStatus,
      stateMutationSchema: statePersistence.stateMutation.schema,
      stateMutationStatus: statePersistence.stateMutation.status,
      stateRevisionPolicy: statePersistence.stateMutation.revisionPolicy,
      stateLeasePolicy: statePersistence.stateMutation.leasePolicy,
      stateNextRevision: statePersistence.checkpoint.nextRevision,
      idempotencyResult: statePersistence.idempotency.result,
      duplicateCommand: statePersistence.idempotency.duplicate,
      recoveryRequired: statePersistence.idempotency.recoveryRequired,
      safeToApplySideEffects: statePersistence.commitPlan.safeToApplySideEffects,
      userPreviewSchema: preview.schema,
      acceptanceReadinessSchema: acceptanceReadiness.schema,
      acceptanceReady: acceptanceReadiness.ready,
      blockedAcceptanceGateIds: acceptanceReadiness.blockedGateIds,
      routeAcceptanceSchema: routeAcceptance.schema,
      routeAcceptanceStatus: routeAcceptance.status,
      routeAcceptancePreviewToken: routeAcceptance.previewToken,
      routeAcceptanceAccepted: routeAcceptance.accepted,
      routeAcceptanceDisabledReasonCount: routeAcceptance.disabledReasons.length,
      routeAcceptanceSubmitAction: routeAcceptance.submitPayload.action,
      acceptanceReviewSchema: acceptanceReview.schema,
      acceptanceReviewState: acceptanceReview.reviewState,
      acceptanceReviewAcceptEnabled: acceptanceReview.actions.accept.enabled,
      acceptanceReviewPrimaryNextStepId: acceptanceReview.primaryNextStepId,
      clientReviewPacketSchema: clientReviewPacket.schema,
      clientReviewPacketId: clientReviewPacket.packetId,
      clientReviewPacketNextStepCount: clientReviewPacket.nextStepQueue.length,
      clientReviewPacketAcceptEnabled: clientReviewPacket.actionBar.acceptEnabled,
      proofBundleSchema: proofBundle.schema,
      proofHash: proofBundle.proofHash,
      proofCommitEligible: proofBundle.outcome.commitEligible,
      proofBlockingCodeCount: proofBundle.failureEvidence.blockingCodes.length,
      validationSummarySchema: validationSummary.schema,
      validationSummaryStatus: validationSummary.status,
      nextStepsSchema: nextSteps.schema,
      nextStepCount: nextSteps.steps.length,
      healthStatus: health.status,
      healthFailureCount: healthFailures.length,
      operationalHealthSchema: health.operational.schema,
      operationalHealthStatus: health.operational.status,
      operationalHealthMode: health.operational.mode,
      operationalHealthFailureCount: health.operational.failures.length,
      operationalCircuitState: health.operational.circuitBreaker.state,
      operationalQueueDepth: health.operational.queue.depth,
      operationalQueueBacklog: health.operational.queue.backlog,
      operationalWorkerStatus: health.operational.worker.status,
      operationalConsecutiveFailures: health.operational.worker.consecutiveFailures,
      operationalResponseSchema: health.operationalResponse.schema,
      operationalResponseStatus: health.operationalResponse.status,
      operationalResponseMode: health.operationalResponse.responseMode,
      operationalResponseActionCount: health.operationalResponse.actions.length,
      operationalEscalationRequired: health.operationalResponse.escalation.required,
      operationalDecisionGateSchema: operationalDecisionGate.schema,
      operationalDecisionGateStatus: operationalDecisionGate.status,
      operationalDecisionGateBlocksDecision: operationalDecisionGate.blocksDecision,
      operationalDecisionGateBlockReason: operationalDecisionGate.blockReason,
      operationalDecisionGateFailureCount: operationalDecisionGate.failures.length,
      retryBackoffStrategy: retry.backoffStrategy,
      historySnapshotCount: reporting.history.snapshotCount,
      exportSummarySchema: reporting.exportSummary.schema,
      analyticsExportSchema: reporting.exportContract.schema,
      analyticsExportRowCount: reporting.exportContract.manifest.rowCount,
      deterministicInputs: ['principal', 'capability', 'route', 'tenant', 'workspace', 'roles', 'permissions', 'workspace grants', 'authorization scope fingerprint', 'policies', 'canonical operation targets', 'target boundary status', 'dependency health', 'operational health', 'provider contracts', 'client runtime', 'client request state', 'workflow handoff', 'sync metadata', 'persisted state checkpoint', 'idempotency key']
    }
  };
}

export function describePolicyEvaluatorSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const evaluation = evaluateCapabilityPolicy({ ...input, now });
  return {
    ok: evaluation.ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel capability policy evaluator with health, validation, audit, proof, and retry contracts',
    evaluation,
    evidence: [
      ...Array.isArray(input.evidence) ? input.evidence : [],
      evaluation.audit,
      evaluation.proof
    ]
  };
}

export default describePolicyEvaluatorSurface;
