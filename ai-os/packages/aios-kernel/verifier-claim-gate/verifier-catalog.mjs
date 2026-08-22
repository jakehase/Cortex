export const surfaceId = "aios_verifier-claim-gate_verifier-catalog_061";
export const surfaceGroup = "verifier-claim-gate";
export const surfaceName = "verifier-catalog";

const DEFAULT_STAGES = ['submitted', 'routed', 'verified', 'blocked'];
const FINAL_STATUSES = new Set(['verified', 'blocked', 'waived']);
const KNOWN_OUTCOMES = new Set(['pass', 'fail', 'pending', 'waived']);
const HOSTED_KERNEL_REQUIRED_CAPABILITIES = ['claim.verify', 'proof.emit', 'audit.trace'];
const EXTERNAL_HANDOFF_ROUTES = new Set(['external-verifier', 'partner-verifier', 'remote-attestation']);
const DEFAULT_TENANT_ID = 'hosted-kernel';
const DEFAULT_WORKSPACE_ID = 'kernel-default';
const DEFAULT_CATALOG_PERMISSIONS = ['claim.verify', 'proof.emit', 'audit.trace'];
const DEFAULT_SETTINGS = {
  lifecycleEnabled: true,
  allowAutoDisable: false,
  requireProofForTerminalClaims: true,
  maxOpenClaimsPerVerifier: 25,
  scheduleCadenceMinutes: 60,
  staleVerifierMinutes: 240
};
const DEFAULT_HEALTH_POLICY = {
  failureThreshold: 1,
  retryBaseSeconds: 30,
  retryMaxSeconds: 900,
  degradedAfterFailures: 2
};
const KNOWN_LIFECYCLE_COMMANDS = new Set(['enable', 'disable', 'schedule', 'pause-schedule', 'resume-schedule']);
const VERIFIER_LIFECYCLE_COMMANDS = new Set(['enable', 'disable']);
const SCHEDULE_LIFECYCLE_COMMANDS = new Set(['schedule', 'pause-schedule', 'resume-schedule']);
const KNOWN_SYNC_STATUSES = new Set(['current', 'pending', 'stale', 'failed']);
const ACCEPTANCE_BLOCKING_SEVERITIES = new Set(['error']);
const KNOWN_EVIDENCE_KINDS = new Set(['attestation', 'trace', 'signature', 'receipt', 'snapshot', 'external-proof']);
const KNOWN_EVIDENCE_STATES = new Set(['valid', 'pending', 'stale', 'revoked', 'invalid']);
const KNOWN_RECOVERY_STATUSES = new Set(['cold-start', 'recovered', 'partial', 'invalid']);
const KNOWN_SUBMISSION_SEVERITIES = new Set(['low', 'normal', 'high', 'critical']);
const KNOWN_CLIENT_ACTIONS = new Set([
  'inspect',
  'accept-ready-claims',
  'resolve-blocking-issues',
  'assign-verifier',
  'continue-verification',
  'export'
]);
const KNOWN_CLIENT_CHANNELS = new Set(['ui', 'api', 'kernel-event', 'automation']);

function asIsoTimestamp(value, fallback) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function asNonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function incrementCounter(target, key, amount = 1) {
  const counterKey = asNonEmptyString(key, 'unknown');
  target[counterKey] = (target[counterKey] || 0) + amount;
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function asPositiveInteger(value, fallback, minimum = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum ? number : fallback;
}

function normalizeCapabilityList(capabilities, fallback = []) {
  const source = Array.isArray(capabilities) && capabilities.length ? capabilities : fallback;
  return Array.from(
    new Set(source.map((capability) => asNonEmptyString(capability, '')).filter(Boolean))
  ).sort();
}

function normalizeScopeRef(value, fallback) {
  return asNonEmptyString(value, fallback).toLowerCase();
}

function normalizeAccessPolicy(policy = {}, generatedAt) {
  const tenantId = normalizeScopeRef(policy.tenantId || policy.tenant, DEFAULT_TENANT_ID);
  const workspaceId = normalizeScopeRef(policy.workspaceId || policy.workspace, DEFAULT_WORKSPACE_ID);
  const permissions = normalizeCapabilityList(policy.permissions, DEFAULT_CATALOG_PERMISSIONS);
  const roles = normalizeCapabilityList(policy.roles, ['catalog-operator']);
  return {
    tenantId,
    workspaceId,
    actorId: asNonEmptyString(policy.actorId || policy.actor, 'kernel-catalog'),
    actorType: asNonEmptyString(policy.actorType, 'service'),
    roles,
    permissions,
    enforceTenantIsolation: asBoolean(policy.enforceTenantIsolation, true),
    allowCrossWorkspaceHandoff: asBoolean(policy.allowCrossWorkspaceHandoff, false),
    auditSink: asNonEmptyString(policy.auditSink, `audit://${tenantId}/${workspaceId}/verifier-catalog`),
    evaluatedAt: asIsoTimestamp(policy.evaluatedAt, generatedAt)
  };
}

function normalizeWorkspaceList(workspaces, fallbackWorkspaceId) {
  if (typeof workspaces === 'string' && workspaces.trim()) {
    return [normalizeScopeRef(workspaces, fallbackWorkspaceId)];
  }
  return normalizeCapabilityList(workspaces, [fallbackWorkspaceId]).map((workspaceId) =>
    normalizeScopeRef(workspaceId, fallbackWorkspaceId)
  );
}

function normalizeVerifier(verifier = {}, index, accessPolicy = {}) {
  const id = asNonEmptyString(verifier.id, `verifier-${index + 1}`);
  const capabilities = normalizeCapabilityList(verifier.capabilities);
  const health = asNonEmptyString(verifier.health, 'unknown').toLowerCase();
  const tenantId = normalizeScopeRef(verifier.tenantId || verifier.tenant, accessPolicy.tenantId || DEFAULT_TENANT_ID);
  const workspaceIds = normalizeWorkspaceList(
    verifier.workspaceIds || verifier.workspaces || verifier.workspaceId,
    accessPolicy.workspaceId || DEFAULT_WORKSPACE_ID
  );
  return {
    id,
    label: asNonEmptyString(verifier.label, id),
    tenantId,
    workspaceIds,
    route: asNonEmptyString(verifier.route, 'hosted-kernel'),
    capabilities,
    permissions: normalizeCapabilityList(verifier.permissions, capabilities),
    role: asNonEmptyString(verifier.role, 'verifier'),
    health,
    active: verifier.active !== false && health !== 'offline',
    lastSeenAt: verifier.lastSeenAt ? asIsoTimestamp(verifier.lastSeenAt, verifier.lastSeenAt) : null
  };
}

function normalizeProviderContract(contract = {}, index, generatedAt) {
  const route = asNonEmptyString(contract.route, 'hosted-kernel');
  const syncStatus = asNonEmptyString(contract.syncStatus, 'pending').toLowerCase();
  return {
    id: asNonEmptyString(contract.id, `${route}-provider-${index + 1}`),
    providerId: asNonEmptyString(contract.providerId, route),
    service: asNonEmptyString(contract.service, 'verifier-catalog'),
    route,
    endpoint: asNonEmptyString(contract.endpoint, route === 'hosted-kernel' ? 'kernel://verifier-catalog' : ''),
    requiredCapabilities: normalizeCapabilityList(contract.requiredCapabilities, HOSTED_KERNEL_REQUIRED_CAPABILITIES),
    offeredCapabilities: normalizeCapabilityList(contract.offeredCapabilities),
    syncCursor: asNonEmptyString(contract.syncCursor, ''),
    syncStatus: KNOWN_SYNC_STATUSES.has(syncStatus) ? syncStatus : 'pending',
    syncedAt: contract.syncedAt ? asIsoTimestamp(contract.syncedAt, generatedAt) : null,
    acceptsExternalHandoff: asBoolean(contract.acceptsExternalHandoff, EXTERNAL_HANDOFF_ROUTES.has(route)),
    proofNamespace: asNonEmptyString(contract.proofNamespace, `provider:${route}`)
  };
}

function normalizeProviderContracts(providerContracts, verifiers, generatedAt) {
  const provided = Array.isArray(providerContracts)
    ? providerContracts.map((contract, index) => normalizeProviderContract(contract, index, generatedAt))
    : [];
  const routes = new Set([
    'hosted-kernel',
    ...verifiers.map((verifier) => verifier.route),
    ...provided.map((contract) => contract.route)
  ]);
  const byRoute = new Map(provided.map((contract) => [contract.route, contract]));

  for (const route of routes) {
    if (byRoute.has(route)) continue;
    const routeVerifiers = verifiers.filter((verifier) => verifier.route === route);
    byRoute.set(
      route,
      normalizeProviderContract(
        {
          id: `${route}-provider`,
          providerId: route,
          route,
          offeredCapabilities: routeVerifiers.flatMap((verifier) => verifier.capabilities),
          syncStatus: routeVerifiers.some((verifier) => verifier.active) ? 'current' : 'pending'
        },
        byRoute.size,
        generatedAt
      )
    );
  }

  return Array.from(byRoute.values()).sort((left, right) => left.route.localeCompare(right.route));
}

function normalizeSettings(settings = {}) {
  return {
    lifecycleEnabled: asBoolean(settings.lifecycleEnabled, DEFAULT_SETTINGS.lifecycleEnabled),
    allowAutoDisable: asBoolean(settings.allowAutoDisable, DEFAULT_SETTINGS.allowAutoDisable),
    requireProofForTerminalClaims: asBoolean(
      settings.requireProofForTerminalClaims,
      DEFAULT_SETTINGS.requireProofForTerminalClaims
    ),
    maxOpenClaimsPerVerifier: asPositiveInteger(
      settings.maxOpenClaimsPerVerifier,
      DEFAULT_SETTINGS.maxOpenClaimsPerVerifier
    ),
    scheduleCadenceMinutes: asPositiveInteger(
      settings.scheduleCadenceMinutes,
      DEFAULT_SETTINGS.scheduleCadenceMinutes,
      5
    ),
    staleVerifierMinutes: asPositiveInteger(
      settings.staleVerifierMinutes,
      DEFAULT_SETTINGS.staleVerifierMinutes,
      15
    )
  };
}

function normalizeHealthPolicy(policy = {}) {
  return {
    failureThreshold: asPositiveInteger(policy.failureThreshold, DEFAULT_HEALTH_POLICY.failureThreshold, 1),
    retryBaseSeconds: asPositiveInteger(policy.retryBaseSeconds, DEFAULT_HEALTH_POLICY.retryBaseSeconds, 1),
    retryMaxSeconds: asPositiveInteger(policy.retryMaxSeconds, DEFAULT_HEALTH_POLICY.retryMaxSeconds, 1),
    degradedAfterFailures: asPositiveInteger(policy.degradedAfterFailures, DEFAULT_HEALTH_POLICY.degradedAfterFailures, 1)
  };
}

function normalizeHealthIncident(incident = {}, index, generatedAt) {
  const failureCount = asPositiveInteger(incident.failureCount || incident.attempt || incident.attemptCount, 1, 1);
  const targetType = asNonEmptyString(incident.targetType || incident.type, 'catalog').toLowerCase();
  const targetId = asNonEmptyString(incident.targetId || incident.verifierId || incident.providerId || incident.claimId, 'catalog');
  return {
    id: asNonEmptyString(incident.id, `health-incident-${index + 1}`),
    source: asNonEmptyString(incident.source, 'operator-observed'),
    code: asNonEmptyString(incident.code, 'unknown-health-incident'),
    severity: asNonEmptyString(incident.severity, 'warning').toLowerCase(),
    targetType,
    targetId,
    message: asNonEmptyString(incident.message, 'Operational health incident was reported'),
    failureCount,
    retryable: asBoolean(incident.retryable, true),
    actionType: asNonEmptyString(incident.actionType || incident.action || incident.remediation, ''),
    observedAt: asIsoTimestamp(incident.observedAt || incident.createdAt, generatedAt),
    lastAttemptAt: incident.lastAttemptAt ? asIsoTimestamp(incident.lastAttemptAt, generatedAt) : null
  };
}

function normalizeHealthIncidents(incidents, generatedAt) {
  return Array.isArray(incidents)
    ? incidents.map((incident, index) => normalizeHealthIncident(incident, index, generatedAt))
    : [];
}

function normalizeLifecycleCommand(command = {}, index, generatedAt) {
  const action = asNonEmptyString(command.action, 'schedule').toLowerCase();
  const targetVerifierId = asNonEmptyString(command.verifierId || command.targetVerifierId, 'catalog');
  return {
    id: asNonEmptyString(command.id, `lifecycle-command-${index + 1}`),
    action: KNOWN_LIFECYCLE_COMMANDS.has(action) ? action : 'schedule',
    targetVerifierId,
    reason: asNonEmptyString(command.reason, 'operator-request'),
    requestedBy: asNonEmptyString(command.requestedBy, 'system'),
    requestedAt: asIsoTimestamp(command.requestedAt, generatedAt),
    effectiveAt: command.effectiveAt ? asIsoTimestamp(command.effectiveAt, generatedAt) : generatedAt
  };
}

function normalizePersistedCommandEffect(effect = {}, index, generatedAt) {
  const action = asNonEmptyString(effect.action, 'unknown').toLowerCase();
  const targetVerifierId = asNonEmptyString(effect.targetVerifierId || effect.verifierId, 'catalog');
  return {
    commandId: asNonEmptyString(effect.commandId || effect.id, `persisted-command-${index + 1}`),
    action,
    targetVerifierId,
    state: asNonEmptyString(effect.state, 'applied').toLowerCase(),
    effectiveAt: asIsoTimestamp(effect.effectiveAt || effect.appliedAt, generatedAt),
    proofRef: asNonEmptyString(effect.proofRef, `lifecycle:persisted:${action}:${targetVerifierId}`)
  };
}

function normalizePersistedVerifierState(state = {}, index, generatedAt) {
  const verifierId = asNonEmptyString(state.verifierId || state.id, `persisted-verifier-${index + 1}`);
  const commandState = asNonEmptyString(state.commandState, state.effectiveActive === false ? 'disabled' : 'enabled').toLowerCase();
  return {
    verifierId,
    effectiveActive: asBoolean(state.effectiveActive ?? state.active, commandState !== 'disabled'),
    commandState: commandState === 'disabled' ? 'disabled' : 'enabled',
    lastCommandId: asNonEmptyString(state.lastCommandId || state.commandId, ''),
    lastCommandAt: state.lastCommandAt || state.effectiveAt ? asIsoTimestamp(state.lastCommandAt || state.effectiveAt, generatedAt) : null,
    recoveredAt: generatedAt
  };
}

function normalizePersistedQueuedCommand(command = {}, index, generatedAt) {
  return {
    commandId: asNonEmptyString(command.commandId || command.id, `persisted-queued-command-${index + 1}`),
    action: asNonEmptyString(command.action, 'schedule').toLowerCase(),
    targetVerifierId: asNonEmptyString(command.targetVerifierId || command.verifierId, 'catalog'),
    effectiveAt: asIsoTimestamp(command.effectiveAt, generatedAt),
    reason: asNonEmptyString(command.reason, 'recovered-from-persisted-state')
  };
}

function normalizePersistedCatalogState(state = {}, generatedAt) {
  const rawStatus = asNonEmptyString(state.status || state.recoveryStatus, '').toLowerCase();
  const appliedCommandIds = normalizeCapabilityList(state.appliedCommandIds);
  const commandEffects = Array.isArray(state.commandEffects)
    ? state.commandEffects.map((effect, index) => normalizePersistedCommandEffect(effect, index, generatedAt))
    : [];
  const appliedFromEffects = commandEffects
    .filter((effect) => effect.state === 'applied' || effect.state === 'replayed')
    .map((effect) => effect.commandId);
  const verifierStates = Array.isArray(state.verifierStates)
    ? state.verifierStates.map((verifierState, index) => normalizePersistedVerifierState(verifierState, index, generatedAt))
    : [];
  const queuedCommands = Array.isArray(state.queuedCommands)
    ? state.queuedCommands.map((command, index) => normalizePersistedQueuedCommand(command, index, generatedAt))
    : [];
  const recoveredAppliedCommandIds = Array.from(new Set([...appliedCommandIds, ...appliedFromEffects])).sort();
  const checkpointId = asNonEmptyString(state.checkpointId || state.snapshotId, '');
  const lastGeneratedAt = state.lastGeneratedAt || state.generatedAt ? asIsoTimestamp(state.lastGeneratedAt || state.generatedAt, generatedAt) : null;
  const status =
    rawStatus && KNOWN_RECOVERY_STATUSES.has(rawStatus)
      ? rawStatus
      : checkpointId || recoveredAppliedCommandIds.length || verifierStates.length || queuedCommands.length
        ? 'recovered'
        : 'cold-start';

  return {
    checkpointId: checkpointId || `checkpoint:${surfaceName}:cold-start`,
    status,
    recoveredAt: generatedAt,
    lastGeneratedAt,
    appliedCommandIds: recoveredAppliedCommandIds,
    commandEffects,
    verifierStates,
    queuedCommands,
    providerSyncCursors: state.providerSyncCursors && typeof state.providerSyncCursors === 'object' ? { ...state.providerSyncCursors } : {},
    claimStatusById: state.claimStatusById && typeof state.claimStatusById === 'object' ? { ...state.claimStatusById } : {}
  };
}

function validateSettings(settings) {
  const issues = [];
  if (settings.maxOpenClaimsPerVerifier < 1) {
    issues.push({
      code: 'invalid-max-open-claims',
      severity: 'error',
      message: 'maxOpenClaimsPerVerifier must be at least 1'
    });
  }
  if (settings.scheduleCadenceMinutes < 5) {
    issues.push({
      code: 'invalid-schedule-cadence',
      severity: 'error',
      message: 'scheduleCadenceMinutes must be at least 5'
    });
  }
  if (settings.staleVerifierMinutes < settings.scheduleCadenceMinutes) {
    issues.push({
      code: 'stale-window-below-cadence',
      severity: 'warning',
      message: 'staleVerifierMinutes should be greater than or equal to scheduleCadenceMinutes'
    });
  }
  return issues;
}

function isDueAt(timestamp, generatedAt) {
  return new Date(timestamp).getTime() <= new Date(generatedAt).getTime();
}

function buildLifecycleCommandDecision({ command, generatedAt, settings, verifierIds }) {
  const isVerifierCommand = VERIFIER_LIFECYCLE_COMMANDS.has(command.action);
  const isScheduleCommand = SCHEDULE_LIFECYCLE_COMMANDS.has(command.action);
  const due = isDueAt(command.effectiveAt, generatedAt);
  const issues = [];

  if (command.targetVerifierId !== 'catalog' && !verifierIds.has(command.targetVerifierId)) {
    issues.push({
      commandId: command.id,
      code: 'unknown-verifier-target',
      severity: 'error',
      message: `Lifecycle command targets unknown verifier ${command.targetVerifierId}`
    });
  }
  if (isVerifierCommand && command.targetVerifierId === 'catalog') {
    issues.push({
      commandId: command.id,
      code: 'verifier-command-missing-target',
      severity: 'error',
      message: `${command.action} commands must target a verifier`
    });
  }
  if (isScheduleCommand && command.targetVerifierId !== 'catalog') {
    issues.push({
      commandId: command.id,
      code: 'schedule-command-targets-verifier',
      severity: 'warning',
      message: `${command.action} controls the catalog schedule and ignores verifier ${command.targetVerifierId}`
    });
  }
  if (!settings.lifecycleEnabled && command.action !== 'pause-schedule') {
    issues.push({
      commandId: command.id,
      code: 'lifecycle-disabled',
      severity: 'error',
      message: `Lifecycle command ${command.action} cannot run while lifecycle controls are disabled`
    });
  }

  return {
    due,
    accepted: !issues.some((issue) => issue.severity === 'error'),
    issues
  };
}

function buildVerifierControlState({ generatedAt, verifiers, openClaimsByVerifier, staleVerifierIds, overloadedVerifierIds, verifierOverrides, commandEffects }) {
  const latestCommandByVerifier = new Map();
  for (const effect of commandEffects) {
    if (!effect.accepted || effect.targetVerifierId === 'catalog' || !effect.applied) continue;
    latestCommandByVerifier.set(effect.targetVerifierId, effect);
  }

  return verifiers.map((verifier) => {
    const override = verifierOverrides.get(verifier.id);
    const commandEffect = latestCommandByVerifier.get(verifier.id);
    const openClaimCount = openClaimsByVerifier[verifier.id] || 0;
    const stale = staleVerifierIds.includes(verifier.id);
    const overloaded = overloadedVerifierIds.includes(verifier.id);
    const effectiveActive = override ? override.active : verifier.active;
    const commandState = override ? override.commandState : verifier.active ? 'enabled' : 'disabled';
    const operationalState = !effectiveActive
      ? 'disabled'
      : stale
        ? 'stale'
        : overloaded
          ? 'overloaded'
          : 'ready';

    return {
      verifierId: verifier.id,
      configuredActive: verifier.active,
      effectiveActive,
      commandState,
      operationalState,
      openClaimCount,
      stale,
      overloaded,
      lastSeenAt: verifier.lastSeenAt,
      lastCommandId: commandEffect?.commandId || null,
      lastCommandAt: commandEffect?.effectiveAt || null,
      nextAction:
        operationalState === 'disabled'
          ? { type: 'enable-verifier', verifierId: verifier.id, reason: 'verifier is disabled by catalog controls' }
          : operationalState === 'stale'
            ? { type: 'refresh-verifier-heartbeat', verifierId: verifier.id, reason: 'verifier exceeded stale window' }
            : operationalState === 'overloaded'
              ? { type: 'rebalance-verifier', verifierId: verifier.id, reason: 'open claim limit exceeded' }
              : { type: 'monitor-verifier', verifierId: verifier.id, reason: 'verifier is ready for scheduled lifecycle checks' },
      auditRef: `audit:${surfaceName}:lifecycle-verifier:${verifier.id}:${generatedAt}`
    };
  });
}

function normalizeClaim(claim = {}, index, now, accessPolicy = {}) {
  const status = asNonEmptyString(claim.status, 'submitted').toLowerCase();
  const outcome = asNonEmptyString(claim.outcome, status === 'verified' ? 'pass' : status === 'blocked' ? 'fail' : 'pending').toLowerCase();
  const stage = asNonEmptyString(claim.stage, status).toLowerCase();
  return {
    id: asNonEmptyString(claim.id, `claim-${index + 1}`),
    subject: asNonEmptyString(claim.subject, 'unspecified-subject'),
    tenantId: normalizeScopeRef(claim.tenantId || claim.tenant, accessPolicy.tenantId || DEFAULT_TENANT_ID),
    workspaceId: normalizeScopeRef(claim.workspaceId || claim.workspace, accessPolicy.workspaceId || DEFAULT_WORKSPACE_ID),
    route: asNonEmptyString(claim.route, 'hosted-kernel'),
    verifierId: asNonEmptyString(claim.verifierId, 'unassigned'),
    requiredPermission: asNonEmptyString(claim.requiredPermission, 'claim.verify'),
    status,
    stage,
    outcome: KNOWN_OUTCOMES.has(outcome) ? outcome : 'pending',
    severity: asNonEmptyString(claim.severity, 'normal').toLowerCase(),
    proofRef: asNonEmptyString(claim.proofRef, ''),
    updatedAt: asIsoTimestamp(claim.updatedAt, now)
  };
}

function normalizeClaimSubmission(submission = {}, index, generatedAt, accessPolicy = {}) {
  const rawSubject = typeof submission.subject === 'string' ? submission.subject.trim() : '';
  const rawRoute = typeof submission.route === 'string' ? submission.route.trim() : '';
  const severity = asNonEmptyString(submission.severity, 'normal').toLowerCase();
  const claimId = asNonEmptyString(submission.claimId || submission.id, `submission-claim-${index + 1}`);
  const requestedVerifierId = asNonEmptyString(
    submission.verifierId || submission.requestedVerifierId,
    'unassigned'
  );

  return {
    submissionId: asNonEmptyString(submission.submissionId || submission.requestId, `claim-submission-${index + 1}`),
    claimId,
    idempotencyKey: asNonEmptyString(
      submission.idempotencyKey,
      `${accessPolicy.tenantId || DEFAULT_TENANT_ID}:${accessPolicy.workspaceId || DEFAULT_WORKSPACE_ID}:${claimId}`
    ),
    subject: rawSubject || 'unspecified-subject',
    subjectProvided: Boolean(rawSubject),
    tenantId: normalizeScopeRef(submission.tenantId || submission.tenant, accessPolicy.tenantId || DEFAULT_TENANT_ID),
    workspaceId: normalizeScopeRef(
      submission.workspaceId || submission.workspace,
      accessPolicy.workspaceId || DEFAULT_WORKSPACE_ID
    ),
    route: rawRoute || 'hosted-kernel',
    routeProvided: Boolean(rawRoute),
    requestedVerifierId,
    requiredPermission: asNonEmptyString(submission.requiredPermission, 'claim.verify'),
    severity: KNOWN_SUBMISSION_SEVERITIES.has(severity) ? severity : 'normal',
    submittedBy: asNonEmptyString(submission.submittedBy || submission.actorId, accessPolicy.actorId || 'kernel-catalog'),
    submittedAt: asIsoTimestamp(submission.submittedAt || submission.createdAt, generatedAt),
    evidenceRefs: normalizeCapabilityList(submission.evidenceRefs || submission.proofRefs),
    source: asNonEmptyString(submission.source, 'hosted-kernel-intake')
  };
}

function normalizeClaimSubmissions(submissions, generatedAt, accessPolicy) {
  return Array.isArray(submissions)
    ? submissions.map((submission, index) => normalizeClaimSubmission(submission, index, generatedAt, accessPolicy))
    : [];
}

function buildClaimGateState({ generatedAt, accessPolicy, submissions, existingClaims }) {
  const seenClaimIds = new Set(existingClaims.map((claim) => claim.id));
  const seenIdempotencyKeys = new Set();
  const issues = [];
  const acceptedClaims = [];
  const rejectedSubmissions = [];
  const submissionDecisions = submissions.map((submission) => {
    const blockers = [
      submission.subjectProvided ? '' : 'subject-required',
      submission.routeProvided ? '' : 'route-required',
      accessPolicy.enforceTenantIsolation && submission.tenantId !== accessPolicy.tenantId
        ? 'tenant-outside-policy'
        : '',
      submission.workspaceId !== accessPolicy.workspaceId && !accessPolicy.allowCrossWorkspaceHandoff
        ? 'workspace-outside-policy'
        : '',
      accessPolicy.permissions.includes(submission.requiredPermission) ? '' : 'actor-missing-required-permission',
      seenClaimIds.has(submission.claimId) ? 'duplicate-claim-id' : '',
      seenIdempotencyKeys.has(submission.idempotencyKey) ? 'duplicate-idempotency-key' : ''
    ].filter(Boolean);
    const state = blockers.length ? 'rejected' : 'accepted';
    const auditRef = `${accessPolicy.auditSink}:claim-gate:${submission.submissionId}:${generatedAt}`;
    const proofRef = `proof:${surfaceName}:claim-gate:${submission.submissionId}:${state}`;
    const decision = {
      submissionId: submission.submissionId,
      claimId: submission.claimId,
      idempotencyKey: submission.idempotencyKey,
      state,
      route: submission.route,
      tenantId: submission.tenantId,
      workspaceId: submission.workspaceId,
      requestedVerifierId: submission.requestedVerifierId,
      requiredPermission: submission.requiredPermission,
      blockers,
      auditRef,
      proofRef,
      acceptedAt: state === 'accepted' ? generatedAt : null
    };

    seenIdempotencyKeys.add(submission.idempotencyKey);
    if (state === 'accepted') {
      seenClaimIds.add(submission.claimId);
      acceptedClaims.push(
        normalizeClaim(
          {
            id: submission.claimId,
            subject: submission.subject,
            tenantId: submission.tenantId,
            workspaceId: submission.workspaceId,
            route: submission.route,
            verifierId: submission.requestedVerifierId,
            requiredPermission: submission.requiredPermission,
            status: 'submitted',
            stage: 'submitted',
            outcome: 'pending',
            severity: submission.severity,
            updatedAt: generatedAt
          },
          existingClaims.length + acceptedClaims.length,
          generatedAt,
          accessPolicy
        )
      );
    } else {
      rejectedSubmissions.push(submission.submissionId);
      for (const blocker of blockers) {
        issues.push({
          source: 'claim-gate',
          code: blocker,
          severity: 'error',
          submissionId: submission.submissionId,
          claimId: submission.claimId,
          message: `Claim submission ${submission.submissionId} rejected by claim gate: ${blocker}`
        });
      }
    }

    return decision;
  });

  return {
    generatedAt,
    submissions,
    submissionDecisions,
    acceptedClaims,
    rejectedSubmissions,
    issues,
    summary: {
      state: issues.length ? 'blocked' : submissions.length ? 'ready' : 'idle',
      submittedCount: submissions.length,
      acceptedClaimIds: acceptedClaims.map((claim) => claim.id),
      rejectedSubmissionIds: rejectedSubmissions,
      auditRefs: submissionDecisions.map((decision) => decision.auditRef),
      proofRefs: submissionDecisions.map((decision) => decision.proofRef)
    }
  };
}

function normalizeEvidenceRecord(evidence = {}, index, generatedAt, accessPolicy = {}) {
  const state = asNonEmptyString(evidence.state || evidence.status, 'valid').toLowerCase();
  const kind = asNonEmptyString(evidence.kind || evidence.type, 'attestation').toLowerCase();
  const proofRef = asNonEmptyString(evidence.proofRef || evidence.ref, `proof:${surfaceName}:evidence-${index + 1}`);
  return {
    id: asNonEmptyString(evidence.id, `evidence-${index + 1}`),
    claimId: asNonEmptyString(evidence.claimId, ''),
    proofRef,
    kind: KNOWN_EVIDENCE_KINDS.has(kind) ? kind : 'attestation',
    issuer: asNonEmptyString(evidence.issuer, 'hosted-kernel'),
    route: asNonEmptyString(evidence.route, 'hosted-kernel'),
    tenantId: normalizeScopeRef(evidence.tenantId || evidence.tenant, accessPolicy.tenantId || DEFAULT_TENANT_ID),
    workspaceId: normalizeScopeRef(evidence.workspaceId || evidence.workspace, accessPolicy.workspaceId || DEFAULT_WORKSPACE_ID),
    digest: asNonEmptyString(evidence.digest || evidence.hash, ''),
    state: KNOWN_EVIDENCE_STATES.has(state) ? state : 'pending',
    collectedAt: asIsoTimestamp(evidence.collectedAt || evidence.createdAt, generatedAt),
    expiresAt: evidence.expiresAt ? asIsoTimestamp(evidence.expiresAt, generatedAt) : null,
    auditRef: asNonEmptyString(evidence.auditRef, `audit:${surfaceName}:evidence:${proofRef}:${generatedAt}`)
  };
}

function normalizeEvidenceRecords(evidence, generatedAt, accessPolicy) {
  return Array.isArray(evidence)
    ? evidence.map((record, index) => normalizeEvidenceRecord(record, index, generatedAt, accessPolicy))
    : [];
}

function buildAccessBoundaryState({ generatedAt, accessPolicy, verifiers, claims, providerServices }) {
  const issues = [];
  const verifierById = new Map(verifiers.map((verifier) => [verifier.id, verifier]));
  const providerByRoute = new Map(providerServices.contracts.map((contract) => [contract.route, contract]));
  const claimScopes = claims.map((claim) => {
    const verifier = verifierById.get(claim.verifierId);
    const provider = providerByRoute.get(claim.route);
    const tenantAllowed = !accessPolicy.enforceTenantIsolation || claim.tenantId === accessPolicy.tenantId;
    const workspaceAllowed =
      claim.workspaceId === accessPolicy.workspaceId ||
      (accessPolicy.allowCrossWorkspaceHandoff && provider?.acceptsExternalHandoff === true);
    const actorCanVerify = accessPolicy.permissions.includes(claim.requiredPermission);
    const verifierTenantAllowed =
      !verifier || !accessPolicy.enforceTenantIsolation || verifier.tenantId === claim.tenantId;
    const verifierWorkspaceAllowed =
      !verifier || verifier.workspaceIds.includes(claim.workspaceId) || verifier.workspaceIds.includes('*');
    const verifierCanVerify = !verifier || verifier.permissions.includes(claim.requiredPermission);
    const boundaryState =
      tenantAllowed && workspaceAllowed && actorCanVerify && verifierTenantAllowed && verifierWorkspaceAllowed && verifierCanVerify
        ? 'ready'
        : 'blocked';

    if (!tenantAllowed) {
      issues.push({
        source: 'access-boundary',
        code: 'claim-tenant-outside-policy',
        severity: 'error',
        claimId: claim.id,
        tenantId: claim.tenantId,
        expectedTenantId: accessPolicy.tenantId,
        message: `Claim ${claim.id} is outside tenant ${accessPolicy.tenantId}`
      });
    }
    if (!workspaceAllowed) {
      issues.push({
        source: 'access-boundary',
        code: 'claim-workspace-outside-policy',
        severity: 'error',
        claimId: claim.id,
        workspaceId: claim.workspaceId,
        expectedWorkspaceId: accessPolicy.workspaceId,
        message: `Claim ${claim.id} is outside workspace ${accessPolicy.workspaceId}`
      });
    }
    if (!actorCanVerify) {
      issues.push({
        source: 'access-boundary',
        code: 'actor-missing-claim-permission',
        severity: 'error',
        claimId: claim.id,
        requiredPermission: claim.requiredPermission,
        message: `Actor ${accessPolicy.actorId} lacks ${claim.requiredPermission}`
      });
    }
    if (verifier && (!verifierTenantAllowed || !verifierWorkspaceAllowed || !verifierCanVerify)) {
      issues.push({
        source: 'access-boundary',
        code: 'verifier-scope-or-permission-denied',
        severity: 'error',
        claimId: claim.id,
        verifierId: verifier.id,
        message: `Verifier ${verifier.id} cannot act on claim ${claim.id} within the active boundary`
      });
    }

    return {
      claimId: claim.id,
      tenantId: claim.tenantId,
      workspaceId: claim.workspaceId,
      verifierId: claim.verifierId,
      route: claim.route,
      requiredPermission: claim.requiredPermission,
      boundaryState,
      tenantAllowed,
      workspaceAllowed,
      actorCanVerify,
      verifierTenantAllowed,
      verifierWorkspaceAllowed,
      verifierCanVerify,
      auditRef: `${accessPolicy.auditSink}:boundary:${claim.id}:${generatedAt}`
    };
  });

  return {
    policy: accessPolicy,
    claimScopes,
    issues,
    summary: {
      status: issues.some((issue) => issue.severity === 'error') ? 'blocked' : 'ready',
      blockedClaimIds: claimScopes.filter((scope) => scope.boundaryState === 'blocked').map((scope) => scope.claimId),
      readyClaimIds: claimScopes.filter((scope) => scope.boundaryState === 'ready').map((scope) => scope.claimId),
      auditRefs: claimScopes.map((scope) => scope.auditRef),
      evaluatedAt: generatedAt
    }
  };
}

function buildProofLedgerState({ generatedAt, accessPolicy, claims, evidenceRecords }) {
  const evidenceByProofRef = new Map(evidenceRecords.map((record) => [record.proofRef, record]));
  const evidenceByClaimId = new Map();
  const issues = [];
  const claimProofs = claims.map((claim) => {
    const attachedEvidence = claim.proofRef ? evidenceByProofRef.get(claim.proofRef) : null;
    const claimEvidence = evidenceRecords.filter((record) => record.claimId === claim.id);
    const terminal = FINAL_STATUSES.has(claim.status);
    const evidenceExpired = attachedEvidence?.expiresAt
      ? new Date(attachedEvidence.expiresAt).getTime() <= new Date(generatedAt).getTime()
      : false;
    const evidenceScoped =
      !attachedEvidence ||
      (attachedEvidence.tenantId === claim.tenantId && attachedEvidence.workspaceId === claim.workspaceId);
    const evidenceRouteMatches = !attachedEvidence || attachedEvidence.route === claim.route;
    const evidenceValid = Boolean(
      attachedEvidence &&
        attachedEvidence.state === 'valid' &&
        !evidenceExpired &&
        evidenceScoped &&
        evidenceRouteMatches
    );

    if (claim.proofRef && !attachedEvidence) {
      issues.push({
        source: 'proof-ledger',
        code: 'claim-proof-ref-missing-evidence',
        severity: 'error',
        claimId: claim.id,
        proofRef: claim.proofRef,
        message: `Claim ${claim.id} references proof ${claim.proofRef} without a matching evidence record`
      });
    }
    if (attachedEvidence && attachedEvidence.state !== 'valid') {
      issues.push({
        source: 'proof-ledger',
        code: 'claim-proof-not-valid',
        severity: 'error',
        claimId: claim.id,
        proofRef: claim.proofRef,
        evidenceState: attachedEvidence.state,
        message: `Claim ${claim.id} proof ${claim.proofRef} is ${attachedEvidence.state}`
      });
    }
    if (attachedEvidence && evidenceExpired) {
      issues.push({
        source: 'proof-ledger',
        code: 'claim-proof-expired',
        severity: 'error',
        claimId: claim.id,
        proofRef: claim.proofRef,
        expiresAt: attachedEvidence.expiresAt,
        message: `Claim ${claim.id} proof ${claim.proofRef} expired at ${attachedEvidence.expiresAt}`
      });
    }
    if (attachedEvidence && !evidenceScoped) {
      issues.push({
        source: 'proof-ledger',
        code: 'claim-proof-scope-mismatch',
        severity: 'error',
        claimId: claim.id,
        proofRef: claim.proofRef,
        tenantId: attachedEvidence.tenantId,
        workspaceId: attachedEvidence.workspaceId,
        message: `Claim ${claim.id} proof ${claim.proofRef} is outside claim scope`
      });
    }
    if (attachedEvidence && !evidenceRouteMatches) {
      issues.push({
        source: 'proof-ledger',
        code: 'claim-proof-route-mismatch',
        severity: 'warning',
        claimId: claim.id,
        proofRef: claim.proofRef,
        route: attachedEvidence.route,
        message: `Claim ${claim.id} proof ${claim.proofRef} was collected on route ${attachedEvidence.route}`
      });
    }

    evidenceByClaimId.set(claim.id, claimEvidence);
    return {
      claimId: claim.id,
      proofRef: claim.proofRef || null,
      terminal,
      evidenceIds: claimEvidence.map((record) => record.id),
      attachedEvidenceId: attachedEvidence?.id || null,
      proofState: !terminal
        ? claim.proofRef
          ? evidenceValid
            ? 'prevalidated'
            : 'pending'
          : 'not-required'
        : evidenceValid
          ? 'verified'
          : 'blocked',
      evidenceValid,
      evidenceScoped,
      evidenceRouteMatches,
      evidenceExpired,
      auditRef: attachedEvidence?.auditRef || `${accessPolicy.auditSink}:proof-ledger:${claim.id}:${generatedAt}`
    };
  });

  return {
    generatedAt,
    evidenceRecords,
    claimProofs,
    issues,
    summary: {
      status: issues.some((issue) => issue.severity === 'error') ? 'blocked' : issues.length ? 'review' : 'ready',
      evidenceCount: evidenceRecords.length,
      verifiedClaimIds: claimProofs.filter((proof) => proof.proofState === 'verified').map((proof) => proof.claimId),
      blockedClaimIds: claimProofs.filter((proof) => proof.proofState === 'blocked').map((proof) => proof.claimId),
      orphanEvidenceIds: evidenceRecords
        .filter((record) => record.claimId && !claims.some((claim) => claim.id === record.claimId))
        .map((record) => record.id),
      auditRefs: claimProofs.map((proof) => proof.auditRef)
    }
  };
}

function buildAnalytics(claims, verifiers) {
  const counters = {
    totalClaims: claims.length,
    terminalClaims: 0,
    openClaims: 0,
    claimsByStatus: {},
    claimsByStage: {},
    claimsByOutcome: {},
    claimsByVerifier: {},
    activeVerifiers: 0,
    verifierHealth: {}
  };

  for (const verifier of verifiers) {
    if (verifier.active) counters.activeVerifiers += 1;
    incrementCounter(counters.verifierHealth, verifier.health);
  }

  for (const claim of claims) {
    incrementCounter(counters.claimsByStatus, claim.status);
    incrementCounter(counters.claimsByStage, claim.stage);
    incrementCounter(counters.claimsByOutcome, claim.outcome);
    incrementCounter(counters.claimsByVerifier, claim.verifierId);
    if (FINAL_STATUSES.has(claim.status)) counters.terminalClaims += 1;
    else counters.openClaims += 1;
  }

  counters.passRate = counters.totalClaims
    ? Number(((counters.claimsByOutcome.pass || 0) / counters.totalClaims).toFixed(4))
    : 0;
  counters.blockRate = counters.totalClaims
    ? Number(((counters.claimsByStatus.blocked || 0) / counters.totalClaims).toFixed(4))
    : 0;
  return counters;
}

function buildTimeline(claims, stages) {
  const stageOrder = stages.length ? stages : DEFAULT_STAGES;
  const buckets = new Map(stageOrder.map((stage) => [stage, { stage, count: 0, latestAt: null, outcomes: {} }]));

  for (const claim of claims) {
    if (!buckets.has(claim.stage)) {
      buckets.set(claim.stage, { stage: claim.stage, count: 0, latestAt: null, outcomes: {} });
    }
    const bucket = buckets.get(claim.stage);
    bucket.count += 1;
    incrementCounter(bucket.outcomes, claim.outcome);
    if (!bucket.latestAt || claim.updatedAt > bucket.latestAt) bucket.latestAt = claim.updatedAt;
  }

  return Array.from(buckets.values()).filter((bucket) => bucket.count > 0);
}

function buildProviderServiceState({ generatedAt, verifiers, claims, providerContracts }) {
  const contractIssues = [];
  const handoffQueue = [];
  const contracts = providerContracts.map((contract) => {
    const routeVerifiers = verifiers.filter((verifier) => verifier.route === contract.route);
    const activeCapabilities = normalizeCapabilityList(
      routeVerifiers.filter((verifier) => verifier.active).flatMap((verifier) => verifier.capabilities),
      contract.offeredCapabilities
    );
    const negotiatedCapabilities = contract.requiredCapabilities.filter((capability) =>
      activeCapabilities.includes(capability)
    );
    const missingCapabilities = contract.requiredCapabilities.filter((capability) =>
      !activeCapabilities.includes(capability)
    );
    const openClaimIds = claims
      .filter((claim) => claim.route === contract.route && !FINAL_STATUSES.has(claim.status))
      .map((claim) => claim.id);
    const terminalMissingProofIds = claims
      .filter((claim) => claim.route === contract.route && FINAL_STATUSES.has(claim.status) && !claim.proofRef)
      .map((claim) => claim.id);

    if (missingCapabilities.length) {
      contractIssues.push({
        providerId: contract.providerId,
        route: contract.route,
        code: 'provider-capability-gap',
        severity: 'error',
        missingCapabilities
      });
    }
    if (terminalMissingProofIds.length) {
      contractIssues.push({
        providerId: contract.providerId,
        route: contract.route,
        code: 'provider-terminal-proof-gap',
        severity: 'error',
        claimIds: terminalMissingProofIds
      });
    }

    const handoffClaimIds = contract.acceptsExternalHandoff
      ? openClaimIds.filter((claimId) => {
          const claim = claims.find((candidate) => candidate.id === claimId);
          return claim && (claim.status === 'submitted' || claim.status === 'routed');
        })
      : [];
    for (const claimId of handoffClaimIds) {
      handoffQueue.push({
        claimId,
        providerId: contract.providerId,
        route: contract.route,
        state: missingCapabilities.length ? 'blocked' : 'ready',
        reason: missingCapabilities.length ? 'provider capability negotiation incomplete' : 'external verifier handoff ready',
        proofRef: `${contract.proofNamespace}:handoff:${claimId}`
      });
    }

    return {
      ...contract,
      matchedVerifierIds: routeVerifiers.map((verifier) => verifier.id),
      activeVerifierIds: routeVerifiers.filter((verifier) => verifier.active).map((verifier) => verifier.id),
      negotiatedCapabilities,
      missingCapabilities,
      openClaimIds,
      terminalMissingProofIds,
      sync: {
        status: contract.syncStatus,
        cursor: contract.syncCursor || `${contract.route}:${generatedAt}`,
        syncedAt: contract.syncedAt,
        nextSyncAt: new Date(new Date(generatedAt).getTime() + DEFAULT_SETTINGS.scheduleCadenceMinutes * 60 * 1000).toISOString()
      }
    };
  });

  return {
    contracts,
    contractIssues,
    handoffQueue,
    syncMetadata: {
      generatedAt,
      providerCount: contracts.length,
      currentProviders: contracts.filter((contract) => contract.sync.status === 'current').map((contract) => contract.providerId),
      pendingProviders: contracts.filter((contract) => contract.sync.status !== 'current').map((contract) => contract.providerId),
      handoffReadyCount: handoffQueue.filter((handoff) => handoff.state === 'ready').length,
      handoffBlockedCount: handoffQueue.filter((handoff) => handoff.state === 'blocked').length
    }
  };
}

function buildHostedKernelRoutingState({ generatedAt, accessPolicy, claims, verifiers, providerServices, lifecycle, boundaryState }) {
  const providerByRoute = new Map(providerServices.contracts.map((contract) => [contract.route, contract]));
  const boundaryByClaimId = new Map(boundaryState.claimScopes.map((scope) => [scope.claimId, scope]));
  const verifierControlById = new Map(lifecycle.effectiveVerifierStates.map((state) => [state.verifierId, state]));
  const openClaimsByVerifier = { ...lifecycle.openClaimsByVerifier };
  const routingIssues = [];
  const decisions = claims.map((claim) => {
    const provider = providerByRoute.get(claim.route);
    const boundary = boundaryByClaimId.get(claim.id);
    const terminal = FINAL_STATUSES.has(claim.status);
    const existingVerifier = verifiers.find((verifier) => verifier.id === claim.verifierId);
    const existingControl = existingVerifier ? verifierControlById.get(existingVerifier.id) : null;
    const providerReady = Boolean(provider && !provider.missingCapabilities.length);
    const boundaryReady = boundary?.boundaryState === 'ready';
    const candidateVerifiers = verifiers
      .filter((verifier) => {
        const control = verifierControlById.get(verifier.id);
        return (
          verifier.route === claim.route &&
          verifier.permissions.includes(claim.requiredPermission) &&
          verifier.capabilities.includes('claim.verify') &&
          verifier.capabilities.includes('proof.emit') &&
          verifier.capabilities.includes('audit.trace') &&
          verifier.tenantId === claim.tenantId &&
          (verifier.workspaceIds.includes(claim.workspaceId) || verifier.workspaceIds.includes('*')) &&
          (control ? control.effectiveActive && control.operationalState === 'ready' : verifier.active)
        );
      })
      .map((verifier) => ({
        verifier,
        openClaimCount: openClaimsByVerifier[verifier.id] || 0
      }))
      .sort((left, right) => {
        if (left.openClaimCount !== right.openClaimCount) return left.openClaimCount - right.openClaimCount;
        return left.verifier.id.localeCompare(right.verifier.id);
      });
    const selectedCandidate = candidateVerifiers[0]?.verifier || null;
    const assignedVerifierReady = Boolean(
      existingVerifier &&
        existingControl?.effectiveActive !== false &&
        existingControl?.operationalState !== 'disabled' &&
        existingVerifier.route === claim.route &&
        existingVerifier.permissions.includes(claim.requiredPermission)
    );
    const decisionState = terminal
      ? 'terminal-no-route'
      : !boundaryReady
        ? 'blocked-boundary'
        : !provider
          ? 'blocked-missing-provider'
          : !providerReady
            ? 'blocked-provider-capability'
            : assignedVerifierReady
              ? 'assigned-existing'
              : selectedCandidate
                ? 'assign-ready'
                : 'blocked-no-verifier';
    const assignedVerifierId =
      decisionState === 'assigned-existing'
        ? existingVerifier.id
        : decisionState === 'assign-ready'
          ? selectedCandidate.id
          : claim.verifierId === 'unassigned'
            ? null
            : claim.verifierId;
    const blockers = [
      boundaryReady ? '' : 'access-boundary-blocked',
      provider ? '' : 'missing-provider-contract',
      provider && !providerReady ? 'provider-capability-gap' : '',
      !terminal && providerReady && boundaryReady && !assignedVerifierReady && !selectedCandidate ? 'no-ready-verifier' : ''
    ].filter(Boolean);

    if (!terminal && blockers.length) {
      routingIssues.push({
        source: 'hosted-kernel-routing',
        code: blockers[0],
        severity: blockers.includes('access-boundary-blocked') || blockers.includes('missing-provider-contract') ? 'error' : 'warning',
        claimId: claim.id,
        route: claim.route,
        verifierId: claim.verifierId,
        message: `Claim ${claim.id} cannot be routed on ${claim.route}: ${blockers.join(', ')}`
      });
    }
    if (decisionState === 'assign-ready') {
      incrementCounter(openClaimsByVerifier, selectedCandidate.id);
    }

    return {
      claimId: claim.id,
      route: claim.route,
      subject: claim.subject,
      terminal,
      currentVerifierId: claim.verifierId,
      assignedVerifierId,
      decisionState,
      candidateVerifierIds: candidateVerifiers.map((candidate) => candidate.verifier.id),
      providerId: provider?.providerId || null,
      providerReady,
      boundaryState: boundary?.boundaryState || 'blocked',
      requiredPermission: claim.requiredPermission,
      blockers,
      routeProofRef: `proof:${surfaceName}:route:${claim.id}:${assignedVerifierId || 'blocked'}`,
      routeAuditRef: `${accessPolicy.auditSink}:routing:${claim.id}:${generatedAt}`,
      assignment:
        decisionState === 'assign-ready' || decisionState === 'assigned-existing'
          ? {
              verifierId: assignedVerifierId,
              action: decisionState === 'assign-ready' ? 'assign-verifier' : 'preserve-assignment',
              reason: decisionState === 'assign-ready' ? 'least-loaded eligible verifier selected' : 'current assignment remains eligible',
              assignedAt: generatedAt
            }
          : null
    };
  });

  return {
    generatedAt,
    strategy: 'hosted-kernel-least-open-claims',
    decisions,
    routingIssues,
    summary: {
      state: routingIssues.some((issue) => issue.severity === 'error')
        ? 'blocked'
        : routingIssues.length
          ? 'review'
          : 'ready',
      assignmentReadyClaimIds: decisions.filter((decision) => decision.decisionState === 'assign-ready').map((decision) => decision.claimId),
      preservedAssignmentClaimIds: decisions.filter((decision) => decision.decisionState === 'assigned-existing').map((decision) => decision.claimId),
      blockedClaimIds: decisions.filter((decision) => decision.blockers.length).map((decision) => decision.claimId),
      auditRefs: decisions.map((decision) => decision.routeAuditRef),
      proofRefs: decisions.map((decision) => decision.routeProofRef)
    }
  };
}

function buildLifecycleState({ generatedAt, settings, verifiers, claims, commands, persistedState }) {
  const settingsIssues = validateSettings(settings);
  const verifierIds = new Set(verifiers.map((verifier) => verifier.id));
  const persistedAppliedCommandIds = new Set(persistedState.appliedCommandIds);
  const seenCommandIds = new Set();
  const openClaimsByVerifier = {};
  const overloadedVerifierIds = [];
  const staleVerifierIds = [];
  const commandEffects = [];
  const commandIssues = [];
  const verifierOverrides = new Map();
  const queuedCommandIds = [];
  const recoveredCommandIds = [];
  const duplicateCommandIds = [];
  let scheduleEnabled = settings.lifecycleEnabled;
  let nextRunAt = new Date(new Date(generatedAt).getTime() + settings.scheduleCadenceMinutes * 60 * 1000).toISOString();

  for (const verifierState of persistedState.verifierStates) {
    if (!verifierIds.has(verifierState.verifierId)) continue;
    verifierOverrides.set(verifierState.verifierId, {
      active: verifierState.effectiveActive,
      commandState: verifierState.commandState,
      commandId: verifierState.lastCommandId || null,
      recovered: true
    });
  }

  for (const claim of claims) {
    if (!FINAL_STATUSES.has(claim.status)) incrementCounter(openClaimsByVerifier, claim.verifierId);
  }

  for (const [verifierId, openCount] of Object.entries(openClaimsByVerifier)) {
    if (verifierId !== 'unassigned' && openCount > settings.maxOpenClaimsPerVerifier) {
      overloadedVerifierIds.push(verifierId);
    }
  }

  for (const verifier of verifiers) {
    if (!verifier.lastSeenAt) continue;
    const ageMinutes = Math.floor((new Date(generatedAt).getTime() - new Date(verifier.lastSeenAt).getTime()) / 60000);
    if (Number.isFinite(ageMinutes) && ageMinutes >= settings.staleVerifierMinutes) {
      staleVerifierIds.push(verifier.id);
    }
  }

  for (const command of commands) {
    if (seenCommandIds.has(command.id)) {
      duplicateCommandIds.push(command.id);
      commandEffects.push({
        commandId: command.id,
        action: command.action,
        targetVerifierId: command.targetVerifierId,
        accepted: true,
        applied: false,
        queued: false,
        state: 'duplicate-ignored',
        effectiveAt: command.effectiveAt,
        reason: command.reason,
        requestedBy: command.requestedBy,
        issueCodes: [],
        proofRef: `lifecycle:${command.id}:${command.action}:${command.targetVerifierId}`,
        idempotencyKey: `${command.action}:${command.targetVerifierId}:${command.id}`,
        restartSafe: true
      });
      continue;
    }
    seenCommandIds.add(command.id);

    if (persistedAppliedCommandIds.has(command.id)) {
      recoveredCommandIds.push(command.id);
      commandEffects.push({
        commandId: command.id,
        action: command.action,
        targetVerifierId: command.targetVerifierId,
        accepted: true,
        applied: false,
        queued: false,
        state: 'replayed',
        effectiveAt: command.effectiveAt,
        reason: command.reason,
        requestedBy: command.requestedBy,
        issueCodes: [],
        proofRef: `lifecycle:${command.id}:${command.action}:${command.targetVerifierId}`,
        idempotencyKey: `${command.action}:${command.targetVerifierId}:${command.id}`,
        restartSafe: true
      });
      continue;
    }

    const decision = buildLifecycleCommandDecision({
      command,
      generatedAt,
      settings,
      verifierIds
    });
    commandIssues.push(...decision.issues);

    const effect = {
      commandId: command.id,
      action: command.action,
      targetVerifierId: command.targetVerifierId,
      accepted: decision.accepted,
      applied: decision.accepted && decision.due,
      queued: decision.accepted && !decision.due,
      state: decision.accepted ? (decision.due ? 'applied' : 'queued') : 'rejected',
      effectiveAt: command.effectiveAt,
      reason: command.reason,
      requestedBy: command.requestedBy,
      issueCodes: decision.issues.map((issue) => issue.code),
      proofRef: `lifecycle:${command.id}:${command.action}:${command.targetVerifierId}`,
      idempotencyKey: `${command.action}:${command.targetVerifierId}:${command.id}`,
      restartSafe: true
    };
    commandEffects.push(effect);

    if (!decision.accepted) continue;
    if (!decision.due) {
      queuedCommandIds.push(command.id);
      continue;
    }

    if (command.action === 'pause-schedule') scheduleEnabled = false;
    if (command.action === 'resume-schedule' || command.action === 'schedule') scheduleEnabled = settings.lifecycleEnabled;
    if (command.action === 'schedule') nextRunAt = command.effectiveAt;
    if (command.action === 'enable') {
      verifierOverrides.set(command.targetVerifierId, {
        active: true,
        commandState: 'enabled',
        commandId: command.id
      });
    }
    if (command.action === 'disable') {
      verifierOverrides.set(command.targetVerifierId, {
        active: false,
        commandState: 'disabled',
        commandId: command.id
      });
    }
  }

  const effectiveVerifierStates = buildVerifierControlState({
    generatedAt,
    verifiers,
    openClaimsByVerifier,
    staleVerifierIds,
    overloadedVerifierIds,
    verifierOverrides,
    commandEffects
  });
  const disabledVerifierIds = effectiveVerifierStates
    .filter((verifier) => !verifier.effectiveActive)
    .map((verifier) => verifier.verifierId);
  const autoDisableCandidateIds = settings.allowAutoDisable
    ? Array.from(new Set([...staleVerifierIds, ...overloadedVerifierIds]))
    : [];
  const nextActionQueue = [
    ...commandEffects
      .filter((effect) => effect.state === 'rejected')
      .map((effect) => ({
        type: 'resolve-lifecycle-command',
        commandId: effect.commandId,
        priority: 'high',
        reason: `command rejected: ${effect.issueCodes.join(', ')}`
      })),
    ...commandEffects
      .filter((effect) => effect.state === 'queued')
      .map((effect) => ({
        type: 'await-lifecycle-command',
        commandId: effect.commandId,
        priority: 'normal',
        reason: `command is scheduled for ${effect.effectiveAt}`
      })),
    ...claims
      .filter((claim) => claim.verifierId === 'unassigned' && !FINAL_STATUSES.has(claim.status))
      .map((claim) => ({
        type: 'route-claim',
        claimId: claim.id,
        priority: claim.severity === 'critical' ? 'high' : 'normal',
        reason: 'claim has no assigned verifier'
      })),
    ...autoDisableCandidateIds.map((verifierId) => ({
      type: 'disable-verifier',
      verifierId,
      priority: 'high',
      reason: staleVerifierIds.includes(verifierId) ? 'verifier is stale' : 'open claim limit exceeded'
    })),
    ...effectiveVerifierStates
      .filter((verifier) => verifier.effectiveActive && verifier.operationalState !== 'ready')
      .map((verifier) => ({
        ...verifier.nextAction,
        priority: verifier.operationalState === 'stale' ? 'high' : 'normal'
      }))
  ];

  return {
    settings,
    settingsIssues,
    commands,
    commandEffects,
    commandIssues,
    controls: {
      lifecycleEnabled: settings.lifecycleEnabled,
      scheduleEnabled,
      nextRunAt: scheduleEnabled ? nextRunAt : null,
      cadenceMinutes: settings.scheduleCadenceMinutes,
      disabledVerifierIds,
      staleVerifierIds,
      overloadedVerifierIds,
      autoDisableCandidateIds,
      queuedCommandIds,
      recoveredCommandIds,
      duplicateCommandIds,
      recoveredQueuedCommandIds: persistedState.queuedCommands.map((command) => command.commandId),
      appliedCommandIds: commandEffects.filter((effect) => effect.applied).map((effect) => effect.commandId),
      rejectedCommandIds: commandEffects.filter((effect) => effect.state === 'rejected').map((effect) => effect.commandId)
    },
    recovery: {
      checkpointId: persistedState.checkpointId,
      status: persistedState.status,
      recoveredAt: persistedState.recoveredAt,
      lastGeneratedAt: persistedState.lastGeneratedAt,
      restoredAppliedCommandIds: persistedState.appliedCommandIds,
      restoredVerifierStateCount: persistedState.verifierStates.length,
      restoredAppliedCommandCount: persistedState.appliedCommandIds.length,
      restoredQueuedCommandCount: persistedState.queuedCommands.length,
      replayedCommandIds: recoveredCommandIds,
      duplicateCommandIds,
      restartSafe:
        persistedState.status === 'cold-start' ||
        !commandEffects.some((effect) => effect.state === 'rejected' && effect.issueCodes.includes('lifecycle-disabled'))
    },
    openClaimsByVerifier,
    effectiveVerifierStates,
    nextAction: nextActionQueue[0] || {
      type: scheduleEnabled ? 'wait-for-scheduled-run' : 'schedule-paused',
      priority: 'normal',
      reason: scheduleEnabled ? 'no immediate catalog lifecycle action required' : 'lifecycle schedule is paused'
    },
    nextActionQueue
  };
}

function buildPersistedStateEnvelope({ generatedAt, accessPolicy, lifecycle, providerServices, claims, proofLedger }) {
  const appliedCommandIds = Array.from(
    new Set([
      ...lifecycle.recovery.restoredAppliedCommandIds,
      ...lifecycle.recovery.replayedCommandIds,
      ...lifecycle.controls.appliedCommandIds
    ])
  ).sort();
  const queuedCommands = lifecycle.commandEffects
    .filter((effect) => effect.state === 'queued')
    .map((effect) => ({
      commandId: effect.commandId,
      action: effect.action,
      targetVerifierId: effect.targetVerifierId,
      effectiveAt: effect.effectiveAt,
      reason: effect.reason
    }));
  const verifierStates = lifecycle.effectiveVerifierStates.map((verifier) => ({
    verifierId: verifier.verifierId,
    effectiveActive: verifier.effectiveActive,
    commandState: verifier.commandState,
    operationalState: verifier.operationalState,
    openClaimCount: verifier.openClaimCount,
    lastCommandId: verifier.lastCommandId,
    lastCommandAt: verifier.lastCommandAt,
    auditRef: verifier.auditRef
  }));
  const providerSyncCursors = Object.fromEntries(
    providerServices.contracts.map((contract) => [
      contract.route,
      {
        providerId: contract.providerId,
        cursor: contract.sync.cursor,
        status: contract.sync.status,
        syncedAt: contract.sync.syncedAt,
        nextSyncAt: contract.sync.nextSyncAt
      }
    ])
  );
  const claimStatusById = Object.fromEntries(
    claims.map((claim) => [
      claim.id,
      {
        status: claim.status,
        stage: claim.stage,
        outcome: claim.outcome,
        verifierId: claim.verifierId,
        proofRef: claim.proofRef || null,
        proofState: proofLedger.claimProofs.find((proof) => proof.claimId === claim.id)?.proofState || 'unknown',
        updatedAt: claim.updatedAt
      }
    ])
  );
  const recoveryWarnings = [
    lifecycle.recovery.duplicateCommandIds.length ? 'duplicate-command-ids-ignored' : '',
    lifecycle.recovery.status === 'invalid' ? 'persisted-state-marked-invalid' : '',
    lifecycle.recovery.status === 'partial' ? 'persisted-state-partial' : ''
  ].filter(Boolean);
  const status =
    lifecycle.recovery.status === 'invalid'
      ? 'invalid'
      : recoveryWarnings.length
        ? 'partial'
        : 'recovered';

  return {
    checkpointId: `checkpoint:${surfaceName}:${generatedAt}`,
    previousCheckpointId: lifecycle.recovery.checkpointId,
    status,
    generatedAt,
    tenantId: accessPolicy.tenantId,
    workspaceId: accessPolicy.workspaceId,
    restartSafe: lifecycle.recovery.restartSafe && status !== 'invalid',
    idempotency: {
      appliedCommandIds,
      queuedCommandIds: queuedCommands.map((command) => command.commandId),
      replayedCommandIds: lifecycle.recovery.replayedCommandIds,
      duplicateCommandIds: lifecycle.recovery.duplicateCommandIds,
      commandEffectCount: lifecycle.commandEffects.length
    },
    verifierStates,
    queuedCommands,
    providerSyncCursors,
    claimStatusById,
    proofLedgerSummary: {
      status: proofLedger.summary.status,
      verifiedClaimIds: proofLedger.summary.verifiedClaimIds,
      blockedClaimIds: proofLedger.summary.blockedClaimIds,
      orphanEvidenceIds: proofLedger.summary.orphanEvidenceIds
    },
    recoveryWarnings,
    auditRef: `${accessPolicy.auditSink}:persisted-state:${generatedAt}`,
    proofRef: `proof:${surfaceName}:persisted-state:${generatedAt}`
  };
}

function buildHistorySnapshot({ now, claims, verifiers, analytics, previousSnapshots }) {
  const prior = Array.isArray(previousSnapshots) ? previousSnapshots.slice(-4) : [];
  return [
    ...prior.map((snapshot, index) => ({
      snapshotId: asNonEmptyString(snapshot.snapshotId, `prior-${index + 1}`),
      capturedAt: asIsoTimestamp(snapshot.capturedAt, now),
      totalClaims: Number.isFinite(snapshot.totalClaims) ? snapshot.totalClaims : 0,
      openClaims: Number.isFinite(snapshot.openClaims) ? snapshot.openClaims : 0,
      terminalClaims: Number.isFinite(snapshot.terminalClaims) ? snapshot.terminalClaims : 0,
      activeVerifiers: Number.isFinite(snapshot.activeVerifiers) ? snapshot.activeVerifiers : 0
    })),
    {
      snapshotId: `${surfaceName}:${now}`,
      capturedAt: now,
      totalClaims: claims.length,
      openClaims: analytics.openClaims,
      terminalClaims: analytics.terminalClaims,
      activeVerifiers: analytics.activeVerifiers,
      catalogSize: verifiers.length
    }
  ];
}

function normalizeExportRequest(exportRequest = {}) {
  const requestedFormats = normalizeCapabilityList(exportRequest.formats, ['json', 'csv'])
    .map((format) => format.toLowerCase())
    .filter((format) => ['json', 'csv', 'ndjson'].includes(format));
  const formats = requestedFormats.length ? requestedFormats : ['json'];
  const includeAudit = asBoolean(exportRequest.includeAudit, true);
  const includeEvidence = asBoolean(exportRequest.includeEvidence, false);
  const requestedSections = normalizeCapabilityList(exportRequest.sections, [
    'catalog',
    'claims',
    'analytics',
    'history',
    'timeline',
    'proof-ledger',
    'evidence',
    'routing',
    'client-decision',
    'acceptance-preview',
    'claim-gate',
    'workflow-handoff',
    'access-boundary',
    'persisted-state',
    'operational-health'
  ]);

  return {
    formats,
    sections: requestedSections,
    includeAudit,
    includeEvidence,
    maxRowsPerSection: asPositiveInteger(exportRequest.maxRowsPerSection, 5000, 1),
    requestedBy: asNonEmptyString(exportRequest.requestedBy, 'kernel-catalog'),
    requestId: asNonEmptyString(exportRequest.requestId, `export-request:${surfaceName}`)
  };
}

function normalizeClientRuntimeRequest(request = {}, generatedAt, claims = []) {
  const requestedAction = asNonEmptyString(request.action || request.intent, 'inspect').toLowerCase();
  const channel = asNonEmptyString(request.channel || request.surface || request.clientChannel, 'ui').toLowerCase();
  const claimIds = normalizeCapabilityList(request.claimIds || request.selectedClaimIds || request.focusClaimIds);
  const knownClaimIds = new Set(claims.map((claim) => claim.id));
  const selectedClaimIds = claimIds.filter((claimId) => knownClaimIds.has(claimId));
  const unknownClaimIds = claimIds.filter((claimId) => !knownClaimIds.has(claimId));
  const correlationId = asNonEmptyString(
    request.correlationId || request.requestId,
    `client-request:${surfaceName}:${generatedAt}`
  );
  const callbackRoute = asNonEmptyString(request.callbackRoute || request.returnTo, 'kernel://verifier-catalog/workflow');
  const dryRun = asBoolean(request.dryRun, requestedAction === 'inspect');

  return {
    correlationId,
    requestedAction: KNOWN_CLIENT_ACTIONS.has(requestedAction) ? requestedAction : 'inspect',
    channel: KNOWN_CLIENT_CHANNELS.has(channel) ? channel : 'ui',
    actorId: asNonEmptyString(request.actorId || request.requestedBy, 'catalog-client'),
    selectedClaimIds,
    unknownClaimIds,
    focusClaimIds: selectedClaimIds.length ? selectedClaimIds : claims.map((claim) => claim.id),
    callbackRoute,
    dryRun,
    requestedAt: asIsoTimestamp(request.requestedAt, generatedAt),
    auditRef: asNonEmptyString(request.auditRef, `audit:${surfaceName}:client-request:${correlationId}:${generatedAt}`)
  };
}

function buildTrendDelta(current, previous, key) {
  const currentValue = Number.isFinite(current?.[key]) ? current[key] : 0;
  const previousValue = Number.isFinite(previous?.[key]) ? previous[key] : 0;
  return {
    key,
    current: currentValue,
    previous: previousValue,
    delta: currentValue - previousValue
  };
}

function buildReportingState({ generatedAt, analytics, history, timeline, lifecycle, providerServices, routingState, boundaryState, proofLedger, claimGate, clientDecision, operationalHealth }) {
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const terminalBacklog = analytics.terminalClaims - clientDecision.acceptance.acceptedClaimIds.length;
  const proofBlockedCount = clientDecision.previewClaims.filter((claim) => claim.terminal && claim.proofState !== 'verified').length;
  const routeBlockedCount = clientDecision.previewClaims.filter((claim) =>
    ['missing-provider', 'capability-gap', 'handoff-blocked'].includes(claim.routeState)
  ).length;
  const timelineState = timeline.map((bucket) => ({
    stage: bucket.stage,
    count: bucket.count,
    latestAt: bucket.latestAt,
    passCount: bucket.outcomes.pass || 0,
    failCount: bucket.outcomes.fail || 0,
    pendingCount: bucket.outcomes.pending || 0,
    reportState:
      bucket.outcomes.fail > 0
        ? 'needs-review'
        : bucket.outcomes.pending > 0
          ? 'in-progress'
          : 'complete'
  }));
  const healthSignals = [
    {
      id: 'terminal-backlog',
      state: terminalBacklog > 0 ? 'blocked' : 'ready',
      count: terminalBacklog,
      message: `${terminalBacklog} terminal claim(s) are not acceptance-ready`
    },
    {
      id: 'proof-coverage',
      state: proofBlockedCount > 0 ? 'blocked' : 'ready',
      count: proofBlockedCount,
      message: `${proofBlockedCount} terminal claim(s) need proof evidence`
    },
    {
      id: 'route-readiness',
      state: routeBlockedCount > 0 ? 'review' : 'ready',
      count: routeBlockedCount,
      message: `${routeBlockedCount} claim route(s) need provider or handoff attention`
    },
    {
      id: 'access-boundary',
      state: boundaryState.summary.status,
      count: boundaryState.summary.blockedClaimIds.length,
      message: `${boundaryState.summary.blockedClaimIds.length} claim(s) blocked by access boundaries`
    },
    {
      id: 'proof-ledger',
      state: proofLedger.summary.status,
      count: proofLedger.summary.blockedClaimIds.length,
      message: `${proofLedger.summary.blockedClaimIds.length} terminal claim proof(s) blocked in ledger`
    },
    {
      id: 'claim-gate',
      state: claimGate.summary.state === 'blocked' ? 'blocked' : 'ready',
      count: claimGate.summary.rejectedSubmissionIds.length,
      message: `${claimGate.summary.acceptedClaimIds.length} submitted claim(s) accepted, ${claimGate.summary.rejectedSubmissionIds.length} rejected`
    },
    {
      id: 'provider-sync',
      state: providerServices.syncMetadata.pendingProviders.length ? 'review' : 'ready',
      count: providerServices.syncMetadata.pendingProviders.length,
      message: `${providerServices.syncMetadata.pendingProviders.length} provider(s) pending sync`
    },
    {
      id: 'hosted-kernel-routing',
      state: routingState.summary.state,
      count: routingState.summary.blockedClaimIds.length,
      message: `${routingState.summary.assignmentReadyClaimIds.length} claim assignment(s) ready, ${routingState.summary.blockedClaimIds.length} blocked`
    },
    {
      id: 'operational-health',
      state: operationalHealth.status === 'failed'
        ? 'blocked'
        : operationalHealth.degradedMode || operationalHealth.status === 'warning'
          ? 'review'
          : 'ready',
      count: operationalHealth.summary.failureCount,
      message: `${operationalHealth.summary.failureCount} operational failure state(s), next retry ${operationalHealth.summary.nextRetryAt || 'not scheduled'}`
    }
  ];

  return {
    generatedAt,
    status: healthSignals.some((signal) => signal.state === 'blocked')
      ? 'blocked'
      : healthSignals.some((signal) => signal.state === 'review')
        ? 'review'
        : 'ready',
    trendDeltas: [
      buildTrendDelta(history[history.length - 1], previous, 'totalClaims'),
      buildTrendDelta(history[history.length - 1], previous, 'openClaims'),
      buildTrendDelta(history[history.length - 1], previous, 'terminalClaims'),
      buildTrendDelta(history[history.length - 1], previous, 'activeVerifiers')
    ],
    timelineState,
    healthSignals,
    rollup: {
      totalClaims: analytics.totalClaims,
      openClaims: analytics.openClaims,
      terminalClaims: analytics.terminalClaims,
      acceptedClaims: clientDecision.acceptance.acceptedClaimIds.length,
      terminalBacklog,
      passRate: analytics.passRate,
      blockRate: analytics.blockRate,
      nextLifecycleAction: lifecycle.nextAction.type,
      nextLifecycleReason: lifecycle.nextAction.reason
    }
  };
}

function buildExportManifest({ generatedAt, exportRequest, verifiers, claims, analytics, history, timeline, lifecycle, providerServices, routingState, clientDecision, acceptancePreview, claimGate, workflowHandoff, boundaryState, proofLedger, reportingState, persistedStateEnvelope, operationalHealth }) {
  const sectionRows = {
    catalog: verifiers.length,
    claims: claims.length,
    analytics: Object.keys(analytics.claimsByStatus).length + Object.keys(analytics.claimsByVerifier).length,
    history: history.length,
    timeline: timeline.length,
    lifecycle: lifecycle.nextActionQueue.length,
    routing: routingState.decisions.length,
    'provider-contracts': providerServices.contracts.length,
    'external-handoff': providerServices.handoffQueue.length,
    'client-decision': clientDecision.previewClaims.length,
    'acceptance-preview': acceptancePreview.rows.length,
    'claim-gate': claimGate.submissionDecisions.length,
    'workflow-handoff': workflowHandoff.handoffClaims.length,
    'access-boundary': boundaryState.claimScopes.length,
    'proof-ledger': proofLedger.claimProofs.length,
    evidence: proofLedger.evidenceRecords.length,
    reporting: reportingState.healthSignals.length + reportingState.timelineState.length,
    'operational-health':
      operationalHealth.failureStates.length +
      operationalHealth.retryPlan.length +
      operationalHealth.incidentValidation.length,
    'persisted-state':
      persistedStateEnvelope.verifierStates.length +
      Object.keys(persistedStateEnvelope.providerSyncCursors).length +
      Object.keys(persistedStateEnvelope.claimStatusById).length
  };
  const manifests = [];

  for (const section of exportRequest.sections) {
    const rowCount = Math.min(sectionRows[section] || 0, exportRequest.maxRowsPerSection);
    for (const format of exportRequest.formats) {
      manifests.push({
        format,
        section,
        name: `${surfaceName}-${section}`,
        generatedAt,
        requestedBy: exportRequest.requestedBy,
        requestId: exportRequest.requestId,
        rowCount,
        truncated: (sectionRows[section] || 0) > exportRequest.maxRowsPerSection,
        includesAudit: exportRequest.includeAudit,
        includesEvidence: exportRequest.includeEvidence,
        auditRef: exportRequest.includeAudit ? `audit:${surfaceName}:export:${section}:${generatedAt}` : null,
        proofRef: `proof:${surfaceName}:export:${section}:${format}:${rowCount}`
      });
    }
  }

  return manifests;
}

function buildValidationSummary({ settingsIssues, commandIssues, contractIssues, routingIssues, boundaryIssues, proofLedgerIssues, claimGateIssues, claims, verifiers, providerServices }) {
  const issues = [
    ...settingsIssues.map((issue) => ({
      source: 'settings',
      code: issue.code,
      severity: issue.severity,
      message: issue.message
    })),
    ...commandIssues.map((issue) => ({
      source: 'lifecycle-command',
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      commandId: issue.commandId
    })),
    ...contractIssues.map((issue) => ({
      source: 'provider-contract',
      code: issue.code,
      severity: issue.severity,
      route: issue.route,
      providerId: issue.providerId,
      missingCapabilities: issue.missingCapabilities || [],
      claimIds: issue.claimIds || []
    })),
    ...routingIssues.map((issue) => ({
      source: issue.source,
      code: issue.code,
      severity: issue.severity,
      claimId: issue.claimId,
      route: issue.route,
      verifierId: issue.verifierId,
      message: issue.message
    })),
    ...boundaryIssues.map((issue) => ({
      source: issue.source,
      code: issue.code,
      severity: issue.severity,
      claimId: issue.claimId,
      verifierId: issue.verifierId,
      tenantId: issue.tenantId,
      workspaceId: issue.workspaceId,
      requiredPermission: issue.requiredPermission,
      message: issue.message
    })),
    ...proofLedgerIssues.map((issue) => ({
      source: issue.source,
      code: issue.code,
      severity: issue.severity,
      claimId: issue.claimId,
      proofRef: issue.proofRef,
      evidenceState: issue.evidenceState,
      tenantId: issue.tenantId,
      workspaceId: issue.workspaceId,
      route: issue.route,
      message: issue.message
    })),
    ...claimGateIssues.map((issue) => ({
      source: issue.source,
      code: issue.code,
      severity: issue.severity,
      submissionId: issue.submissionId,
      claimId: issue.claimId,
      message: issue.message
    }))
  ];
  const verifierIds = new Set(verifiers.map((verifier) => verifier.id));
  const contractRoutes = new Set(providerServices.contracts.map((contract) => contract.route));

  for (const claim of claims) {
    if (claim.verifierId !== 'unassigned' && !verifierIds.has(claim.verifierId)) {
      issues.push({
        source: 'claim',
        code: 'claim-verifier-not-in-catalog',
        severity: 'error',
        claimId: claim.id,
        verifierId: claim.verifierId,
        message: `Claim ${claim.id} references verifier ${claim.verifierId} that is not in the catalog`
      });
    }
    if (!contractRoutes.has(claim.route)) {
      issues.push({
        source: 'claim',
        code: 'claim-route-without-provider-contract',
        severity: 'warning',
        claimId: claim.id,
        route: claim.route,
        message: `Claim ${claim.id} has no provider contract for route ${claim.route}`
      });
    }
  }

  const bySeverity = issues.reduce((summary, issue) => {
    incrementCounter(summary, issue.severity || 'unknown');
    return summary;
  }, {});

  return {
    status: (bySeverity.error || 0) > 0 ? 'invalid' : (bySeverity.warning || 0) > 0 ? 'review' : 'valid',
    issueCount: issues.length,
    bySeverity,
    blockingIssueCount: issues.filter((issue) => ACCEPTANCE_BLOCKING_SEVERITIES.has(issue.severity)).length,
    issues
  };
}

function buildRetryDirective({ generatedAt, policy, failureCount, retryable, actionType, targetId }) {
  if (!retryable) {
    return {
      retryable: false,
      nextAttemptAt: null,
      backoffSeconds: 0,
      attempt: failureCount,
      actionType,
      targetId
    };
  }
  const backoffSeconds = Math.min(
    policy.retryMaxSeconds,
    policy.retryBaseSeconds * 2 ** Math.max(0, failureCount - 1)
  );
  return {
    retryable: true,
    nextAttemptAt: new Date(new Date(generatedAt).getTime() + backoffSeconds * 1000).toISOString(),
    backoffSeconds,
    attempt: failureCount,
    actionType,
    targetId
  };
}

function buildHealthIncidentTargetRegistry({ claims, lifecycle, providerServices, boundaryState, proofLedger }) {
  const registry = new Map();
  const register = (targetType, targetId, metadata = {}) => {
    registry.set(`${targetType}:${targetId}`, {
      targetType,
      targetId,
      ...metadata
    });
  };

  register('catalog', 'catalog', { state: lifecycle.controls.scheduleEnabled ? 'scheduled' : 'paused' });
  register('proof-ledger', 'proof-ledger', { status: proofLedger.summary.status });
  register('access-boundary', boundaryState.policy.workspaceId, {
    tenantId: boundaryState.policy.tenantId,
    blockedClaimIds: boundaryState.summary.blockedClaimIds
  });

  for (const claim of claims) {
    register('claim', claim.id, {
      route: claim.route,
      verifierId: claim.verifierId,
      status: claim.status,
      workspaceId: claim.workspaceId
    });
  }
  for (const verifier of lifecycle.effectiveVerifierStates) {
    register('verifier', verifier.verifierId, {
      operationalState: verifier.operationalState,
      effectiveActive: verifier.effectiveActive,
      openClaimCount: verifier.openClaimCount
    });
  }
  for (const provider of providerServices.contracts) {
    register('provider', provider.providerId, {
      route: provider.route,
      syncStatus: provider.sync.status,
      missingCapabilities: provider.missingCapabilities
    });
    register('provider-route', provider.route, {
      providerId: provider.providerId,
      syncStatus: provider.sync.status
    });
  }

  return registry;
}

function inferIncidentActionType(incident, targetKnown) {
  if (incident.actionType) return incident.actionType;
  if (!targetKnown) return 'reconcile-health-incident-target';
  if (incident.targetType === 'verifier') return 'refresh-verifier-heartbeat';
  if (incident.targetType === 'provider' || incident.targetType === 'provider-route') return 'retry-provider-sync';
  if (incident.targetType === 'claim') return 'inspect-claim';
  if (incident.targetType === 'proof-ledger') return 'attach-or-refresh-proof';
  if (incident.targetType === 'access-boundary') return 'resolve-access-boundary';
  return 'inspect-operational-health';
}

function buildOperationalHealthState({ generatedAt, policy, incidents, claims, lifecycle, providerServices, boundaryState, proofLedger, validationSummary }) {
  const targetRegistry = buildHealthIncidentTargetRegistry({
    claims,
    lifecycle,
    providerServices,
    boundaryState,
    proofLedger
  });
  const incidentFailuresByKey = new Map(
    incidents.map((incident) => [`${incident.targetType}:${incident.targetId}:${incident.code}`, incident.failureCount])
  );
  const failureStates = [];
  const incidentValidation = [];
  const addFailure = ({ source, code, severity = 'warning', targetType, targetId, message, retryable, actionType, evidence = {} }) => {
    const key = `${targetType}:${targetId}:${code}`;
    const failureCount = Math.max(policy.failureThreshold, incidentFailuresByKey.get(key) || 1);
    const retry = buildRetryDirective({
      generatedAt,
      policy,
      failureCount,
      retryable,
      actionType,
      targetId
    });
    failureStates.push({
      id: `${code}:${targetType}:${targetId}`,
      source,
      code,
      severity,
      targetType,
      targetId,
      message,
      failureCount,
      retry,
      degraded: severity === 'error' || failureCount >= policy.degradedAfterFailures,
      auditRef: `audit:${surfaceName}:operational-health:${code}:${targetId}:${generatedAt}`,
      proofRef: `proof:${surfaceName}:operational-health:${code}:${targetId}`,
      evidence
    });
  };

  for (const incident of incidents) {
    const registryEntry = targetRegistry.get(`${incident.targetType}:${incident.targetId}`);
    const targetKnown = Boolean(registryEntry);
    const effectiveSeverity =
      incident.severity === 'critical'
        ? 'error'
        : incident.severity === 'error' || incident.severity === 'warning'
          ? incident.severity
          : 'warning';
    const actionType = inferIncidentActionType(incident, targetKnown);
    const validationState = targetKnown ? 'accepted' : 'target-missing';
    incidentValidation.push({
      incidentId: incident.id,
      code: incident.code,
      source: incident.source,
      targetType: incident.targetType,
      targetId: incident.targetId,
      validationState,
      severity: targetKnown ? effectiveSeverity : 'error',
      retryable: targetKnown && incident.retryable,
      actionType,
      observedAt: incident.observedAt,
      registryRef: registryEntry || null,
      message: targetKnown
        ? `Incident ${incident.id} is bound to ${incident.targetType}:${incident.targetId}`
        : `Incident ${incident.id} targets unknown ${incident.targetType}:${incident.targetId}`
    });
    addFailure({
      source: `incident:${incident.source}`,
      code: targetKnown ? incident.code : 'operational-incident-target-missing',
      severity: targetKnown ? effectiveSeverity : 'error',
      targetType: targetKnown ? incident.targetType : 'catalog',
      targetId: targetKnown ? incident.targetId : 'catalog',
      message: targetKnown
        ? incident.message
        : `Health incident ${incident.id} cannot be bound to ${incident.targetType}:${incident.targetId}`,
      retryable: targetKnown && incident.retryable,
      actionType,
      evidence: {
        incidentId: incident.id,
        incidentCode: incident.code,
        targetKnown,
        observedAt: incident.observedAt,
        lastAttemptAt: incident.lastAttemptAt,
        registryRef: registryEntry || null
      }
    });
  }

  for (const verifierId of lifecycle.controls.staleVerifierIds) {
    addFailure({
      source: 'lifecycle',
      code: 'verifier-heartbeat-stale',
      severity: 'warning',
      targetType: 'verifier',
      targetId: verifierId,
      message: `Verifier ${verifierId} exceeded the stale heartbeat window`,
      retryable: true,
      actionType: 'refresh-verifier-heartbeat',
      evidence: { staleVerifierIds: lifecycle.controls.staleVerifierIds }
    });
  }
  for (const verifierId of lifecycle.controls.overloadedVerifierIds) {
    addFailure({
      source: 'lifecycle',
      code: 'verifier-open-claim-overload',
      severity: 'warning',
      targetType: 'verifier',
      targetId: verifierId,
      message: `Verifier ${verifierId} has more open claims than the configured limit`,
      retryable: true,
      actionType: 'rebalance-verifier',
      evidence: { openClaimsByVerifier: lifecycle.openClaimsByVerifier }
    });
  }
  if (!lifecycle.controls.scheduleEnabled) {
    addFailure({
      source: 'lifecycle',
      code: 'catalog-schedule-paused',
      severity: 'warning',
      targetType: 'catalog',
      targetId: 'catalog',
      message: 'Catalog lifecycle schedule is paused',
      retryable: false,
      actionType: 'resume-schedule',
      evidence: { nextRunAt: lifecycle.controls.nextRunAt }
    });
  }
  for (const provider of providerServices.contracts) {
    if (provider.sync.status === 'failed' || provider.sync.status === 'stale' || provider.missingCapabilities.length) {
      addFailure({
        source: 'provider-contract',
        code: provider.missingCapabilities.length ? 'provider-capability-gap' : 'provider-sync-not-current',
        severity: provider.missingCapabilities.length || provider.sync.status === 'failed' ? 'error' : 'warning',
        targetType: 'provider',
        targetId: provider.providerId,
        message: provider.missingCapabilities.length
          ? `Provider ${provider.providerId} is missing ${provider.missingCapabilities.join(', ')}`
          : `Provider ${provider.providerId} sync status is ${provider.sync.status}`,
        retryable: !provider.missingCapabilities.length,
        actionType: provider.missingCapabilities.length ? 'negotiate-provider-capabilities' : 'retry-provider-sync',
        evidence: { route: provider.route, syncStatus: provider.sync.status, missingCapabilities: provider.missingCapabilities }
      });
    }
  }
  if (boundaryState.summary.blockedClaimIds.length) {
    addFailure({
      source: 'access-boundary',
      code: 'claim-access-boundary-blocked',
      severity: 'error',
      targetType: 'access-boundary',
      targetId: boundaryState.policy.workspaceId,
      message: `${boundaryState.summary.blockedClaimIds.length} claim(s) are blocked by tenant, workspace, or permission boundaries`,
      retryable: false,
      actionType: 'resolve-access-boundary',
      evidence: { blockedClaimIds: boundaryState.summary.blockedClaimIds }
    });
  }
  if (proofLedger.summary.blockedClaimIds.length || proofLedger.summary.orphanEvidenceIds.length) {
    addFailure({
      source: 'proof-ledger',
      code: 'proof-ledger-not-ready',
      severity: proofLedger.summary.blockedClaimIds.length ? 'error' : 'warning',
      targetType: 'proof-ledger',
      targetId: 'proof-ledger',
      message: `${proofLedger.summary.blockedClaimIds.length} claim proof(s) blocked and ${proofLedger.summary.orphanEvidenceIds.length} orphan evidence record(s) found`,
      retryable: false,
      actionType: 'attach-or-refresh-proof',
      evidence: {
        blockedClaimIds: proofLedger.summary.blockedClaimIds,
        orphanEvidenceIds: proofLedger.summary.orphanEvidenceIds
      }
    });
  }
  if (validationSummary.blockingIssueCount) {
    addFailure({
      source: 'validation',
      code: 'catalog-validation-blocked',
      severity: 'error',
      targetType: 'catalog',
      targetId: 'catalog',
      message: `${validationSummary.blockingIssueCount} blocking validation issue(s) prevent safe acceptance`,
      retryable: false,
      actionType: 'resolve-validation-issues',
      evidence: { issueCount: validationSummary.issueCount, blockingIssueCount: validationSummary.blockingIssueCount }
    });
  }

  const actionableErrors = failureStates.map((failure) => ({
    code: failure.code,
    severity: failure.severity,
    targetType: failure.targetType,
    targetId: failure.targetId,
    message: failure.message,
    action: failure.retry.actionType,
    retryable: failure.retry.retryable,
    nextAttemptAt: failure.retry.nextAttemptAt,
    auditRef: failure.auditRef,
    proofRef: failure.proofRef
  }));
  const retryPlan = failureStates
    .filter((failure) => failure.retry.retryable)
    .map((failure) => ({
      targetType: failure.targetType,
      targetId: failure.targetId,
      action: failure.retry.actionType,
      attempt: failure.retry.attempt,
      backoffSeconds: failure.retry.backoffSeconds,
      nextAttemptAt: failure.retry.nextAttemptAt,
      proofRef: failure.proofRef
    }))
    .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt));

  return {
    generatedAt,
    policy,
    status: failureStates.some((failure) => failure.severity === 'error')
      ? 'failed'
      : failureStates.some((failure) => failure.degraded)
        ? 'degraded'
        : failureStates.length
          ? 'warning'
          : 'healthy',
    degradedMode: failureStates.some((failure) => failure.degraded),
    failureStates,
    retryPlan,
    actionableErrors,
    incidentValidation,
    incidentEcho: incidents,
    summary: {
      failureCount: failureStates.length,
      retryableFailureCount: retryPlan.length,
      actionableErrorCount: actionableErrors.length,
      incidentCount: incidents.length,
      invalidIncidentCount: incidentValidation.filter((incident) => incident.validationState !== 'accepted').length,
      degradedTargets: failureStates.filter((failure) => failure.degraded).map((failure) => `${failure.targetType}:${failure.targetId}`),
      nextRetryAt: retryPlan[0]?.nextAttemptAt || null,
      auditRefs: failureStates.map((failure) => failure.auditRef),
      proofRefs: failureStates.map((failure) => failure.proofRef)
    }
  };
}

function buildClientDecisionContract({ generatedAt, claims, verifiers, lifecycle, providerServices, routingState, boundaryState, proofLedger, validationSummary, operationalHealth }) {
  const effectiveVerifierStates = Array.isArray(lifecycle.effectiveVerifierStates) ? lifecycle.effectiveVerifierStates : [];
  const effectiveActiveIds = effectiveVerifierStates
    .filter((verifier) => verifier.effectiveActive)
    .map((verifier) => verifier.verifierId);
  const activeVerifierIds = new Set(
    effectiveActiveIds.length
      ? effectiveActiveIds
      : verifiers.filter((verifier) => verifier.active).map((verifier) => verifier.id)
  );
  const providerByRoute = new Map(providerServices.contracts.map((contract) => [contract.route, contract]));
  const handoffByClaimId = new Map(providerServices.handoffQueue.map((handoff) => [handoff.claimId, handoff]));
  const routeDecisionByClaimId = new Map(routingState.decisions.map((decision) => [decision.claimId, decision]));
  const boundaryByClaimId = new Map(boundaryState.claimScopes.map((scope) => [scope.claimId, scope]));
  const proofByClaimId = new Map(proofLedger.claimProofs.map((proof) => [proof.claimId, proof]));
  const previewClaims = claims.map((claim) => {
    const provider = providerByRoute.get(claim.route);
    const handoff = handoffByClaimId.get(claim.id);
    const routeDecision = routeDecisionByClaimId.get(claim.id);
    const boundary = boundaryByClaimId.get(claim.id);
    const proof = proofByClaimId.get(claim.id);
    const terminal = FINAL_STATUSES.has(claim.status);
    const proofState = proof?.proofState || (claim.proofRef ? 'pending' : terminal ? 'blocked' : 'not-required');
    const routeState = provider
      ? provider.missingCapabilities.length
        ? 'capability-gap'
        : handoff?.state === 'blocked'
          ? 'handoff-blocked'
          : 'ready'
      : 'missing-provider';
    return {
      claimId: claim.id,
      subject: claim.subject,
      tenantId: claim.tenantId,
      workspaceId: claim.workspaceId,
      route: claim.route,
      verifierId: claim.verifierId,
      assignedVerifierId: routeDecision?.assignedVerifierId || null,
      requiredPermission: claim.requiredPermission,
      status: claim.status,
      outcome: claim.outcome,
      severity: claim.severity,
      terminal,
      proofState,
      proofRef: claim.proofRef || null,
      evidenceIds: proof?.evidenceIds || [],
      proofAuditRef: proof?.auditRef || null,
      routeState,
      routingDecisionState: routeDecision?.decisionState || 'unavailable',
      routingProofRef: routeDecision?.routeProofRef || null,
      routingAuditRef: routeDecision?.routeAuditRef || null,
      routingBlockers: routeDecision?.blockers || [],
      boundaryState: boundary?.boundaryState || 'blocked',
      auditRef: boundary?.auditRef || null,
      canAccept:
        terminal &&
        proofState === 'verified' &&
        routeState === 'ready' &&
        boundary?.boundaryState === 'ready' &&
        (claim.verifierId === 'unassigned' || activeVerifierIds.has(claim.verifierId)),
      previewLabel: `${claim.subject} -> ${claim.status}/${claim.outcome}`,
      explanation: terminal
        ? proofState === 'verified'
          ? boundary?.boundaryState === 'ready'
            ? 'Terminal claim includes ledger-verified proof and can be reviewed for acceptance.'
            : 'Terminal claim is blocked by tenant, workspace, or permission boundaries.'
          : 'Terminal claim needs valid ledger evidence before acceptance.'
        : 'Open claim remains visible in preview until verification reaches a terminal state.',
      nextStep:
        boundary?.boundaryState === 'blocked'
          ? { type: 'resolve-access-boundary', claimId: claim.id, reason: 'claim is outside tenant, workspace, or permission boundary' }
          : routeDecision?.decisionState === 'assign-ready'
          ? { type: 'assign-verifier', claimId: claim.id, verifierId: routeDecision.assignedVerifierId, reason: 'hosted-kernel routing selected an eligible verifier' }
          : routeDecision?.decisionState === 'blocked-no-verifier'
            ? { type: 'enable-or-register-verifier', claimId: claim.id, route: claim.route, reason: 'no active verifier is eligible for this claim route' }
          : terminal && proofState !== 'verified'
          ? { type: 'attach-or-refresh-proof', claimId: claim.id, reason: 'terminal claims require valid ledger evidence' }
          : routeState === 'missing-provider'
            ? { type: 'register-provider-contract', route: claim.route, reason: 'claim route has no provider contract' }
            : routeState === 'capability-gap'
              ? { type: 'negotiate-provider-capabilities', route: claim.route, reason: 'provider is missing required capabilities' }
              : !terminal
                ? { type: 'continue-verification', claimId: claim.id, reason: 'claim is not terminal' }
                : { type: 'accept-claim', claimId: claim.id, reason: 'claim has terminal status, proof, and ready route' }
    };
  });
  const readinessChecks = [
    {
      id: 'validation-clean',
      label: 'Validation',
      state: validationSummary.blockingIssueCount ? 'blocked' : validationSummary.issueCount ? 'review' : 'ready',
      detail: `${validationSummary.issueCount} validation issue(s), ${validationSummary.blockingIssueCount} blocking`
    },
    {
      id: 'provider-sync',
      label: 'Provider sync',
      state: providerServices.syncMetadata.pendingProviders.length ? 'review' : 'ready',
      detail: `${providerServices.syncMetadata.currentProviders.length} current, ${providerServices.syncMetadata.pendingProviders.length} pending`
    },
    {
      id: 'proof-coverage',
      label: 'Proof coverage',
      state: proofLedger.summary.status === 'blocked' || previewClaims.some((claim) => claim.terminal && claim.proofState !== 'verified')
        ? 'blocked'
        : proofLedger.summary.status === 'review'
          ? 'review'
          : 'ready',
      detail: `${previewClaims.filter((claim) => claim.proofState === 'verified').length} ledger-verified claim(s)`
    },
    {
      id: 'access-boundary',
      label: 'Access boundary',
      state: boundaryState.summary.status,
      detail: `${boundaryState.summary.readyClaimIds.length} scoped, ${boundaryState.summary.blockedClaimIds.length} blocked`
    },
    {
      id: 'lifecycle-controls',
      label: 'Lifecycle controls',
      state: lifecycle.controls.scheduleEnabled ? 'ready' : 'review',
      detail: lifecycle.controls.scheduleEnabled
        ? `next run at ${lifecycle.controls.nextRunAt}`
        : 'schedule is paused'
    },
    {
      id: 'hosted-kernel-routing',
      label: 'Hosted routing',
      state: routingState.summary.state,
      detail: `${routingState.summary.assignmentReadyClaimIds.length} assignment(s), ${routingState.summary.blockedClaimIds.length} blocked`
    },
    {
      id: 'operational-health',
      label: 'Operational health',
      state: operationalHealth.status === 'failed'
        ? 'blocked'
        : operationalHealth.degradedMode || operationalHealth.status === 'warning'
          ? 'review'
          : 'ready',
      detail: `${operationalHealth.summary.failureCount} failure state(s), ${operationalHealth.summary.retryableFailureCount} retryable`
    }
  ];
  const blockedCheck = readinessChecks.find((check) => check.state === 'blocked');
  const reviewCheck = readinessChecks.find((check) => check.state === 'review');
  const acceptance = {
    state: blockedCheck ? 'blocked' : reviewCheck ? 'review' : 'ready',
    acceptedClaimIds: previewClaims.filter((claim) => claim.canAccept).map((claim) => claim.claimId),
    blockedClaimIds: previewClaims.filter((claim) => !claim.canAccept && claim.terminal).map((claim) => claim.claimId),
    requiredChecks: readinessChecks.map((check) => check.id),
    decisionRef: `acceptance:${surfaceName}:${generatedAt}`
  };

  return {
    generatedAt,
    previewClaims,
    acceptance,
    readinessChecks,
    nextSteps: [
      ...previewClaims
        .filter((claim) => !claim.canAccept)
        .slice(0, 5)
        .map((claim) => claim.nextStep),
      lifecycle.nextAction
    ],
    clientHints: {
      primaryAction:
        acceptance.state === 'ready'
          ? 'accept-ready-claims'
          : acceptance.state === 'blocked'
            ? 'resolve-blocking-issues'
            : 'review-readiness-warnings',
      previewCount: previewClaims.length,
      acceptanceCount: acceptance.acceptedClaimIds.length,
      blockedTerminalCount: acceptance.blockedClaimIds.length
    }
  };
}

function buildAcceptancePreviewContract({ generatedAt, clientDecision, validationSummary, providerServices, boundaryState, proofLedger, lifecycle }) {
  const validationIssuesByClaimId = new Map();
  for (const issue of validationSummary.issues) {
    if (!issue.claimId) continue;
    const claimIssues = validationIssuesByClaimId.get(issue.claimId) || [];
    claimIssues.push({
      source: issue.source,
      code: issue.code,
      severity: issue.severity,
      message: issue.message || `${issue.source}:${issue.code}`
    });
    validationIssuesByClaimId.set(issue.claimId, claimIssues);
  }

  const boundaryByClaimId = new Map(boundaryState.claimScopes.map((scope) => [scope.claimId, scope]));
  const proofByClaimId = new Map(proofLedger.claimProofs.map((proof) => [proof.claimId, proof]));
  const providerByRoute = new Map(providerServices.contracts.map((contract) => [contract.route, contract]));
  const readinessChecksById = new Map(clientDecision.readinessChecks.map((check) => [check.id, check]));
  const rows = clientDecision.previewClaims.map((claim) => {
    const claimIssues = validationIssuesByClaimId.get(claim.claimId) || [];
    const boundary = boundaryByClaimId.get(claim.claimId);
    const proof = proofByClaimId.get(claim.claimId);
    const provider = providerByRoute.get(claim.route);
    const blockers = [
      ...claimIssues.filter((issue) => ACCEPTANCE_BLOCKING_SEVERITIES.has(issue.severity)).map((issue) => issue.code),
      claim.boundaryState === 'blocked' ? 'access-boundary-blocked' : '',
      claim.terminal && claim.proofState !== 'verified' ? 'proof-not-verified' : '',
      claim.routeState !== 'ready' ? `route-${claim.routeState}` : '',
      !claim.terminal ? 'claim-not-terminal' : ''
    ].filter(Boolean);
    const warnings = [
      ...claimIssues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code),
      provider?.sync.status !== 'current' ? 'provider-sync-pending' : '',
      lifecycle.controls.scheduleEnabled ? '' : 'lifecycle-schedule-paused'
    ].filter(Boolean);
    const readinessVector = [
      {
        id: 'terminal-state',
        state: claim.terminal ? 'ready' : 'pending',
        label: claim.terminal ? 'terminal' : 'open',
        detail: `${claim.status}/${claim.outcome}`
      },
      {
        id: 'proof-ledger',
        state: claim.proofState === 'verified' ? 'ready' : claim.terminal ? 'blocked' : 'pending',
        label: claim.proofState,
        detail: claim.proofRef ? `proof ${claim.proofRef}` : 'no proof reference'
      },
      {
        id: 'access-boundary',
        state: claim.boundaryState === 'ready' ? 'ready' : 'blocked',
        label: claim.boundaryState,
        detail: boundary?.auditRef || 'boundary audit unavailable'
      },
      {
        id: 'provider-route',
        state: claim.routeState === 'ready' ? 'ready' : claim.routeState === 'missing-provider' ? 'blocked' : 'review',
        label: claim.routeState,
        detail: provider ? `${provider.providerId} via ${provider.endpoint}` : `no provider for ${claim.route}`
      },
      {
        id: 'hosted-routing',
        state: claim.routingBlockers.length ? 'blocked' : claim.routingDecisionState === 'assign-ready' ? 'ready' : 'pending',
        label: claim.routingDecisionState,
        detail: claim.assignedVerifierId ? `verifier ${claim.assignedVerifierId}` : 'no verifier assignment'
      }
    ];
    const previewState = claim.canAccept
      ? warnings.length
        ? 'accept-with-warnings'
        : 'accept-ready'
      : blockers.includes('claim-not-terminal')
        ? 'in-progress'
        : 'needs-action';

    return {
      claimId: claim.claimId,
      subject: claim.subject,
      previewState,
      canAccept: claim.canAccept,
      primaryAction: claim.canAccept ? 'accept-claim' : claim.nextStep.type,
      disabledReason: claim.canAccept ? null : claim.nextStep.reason,
      readinessVector,
      blockers,
      warnings,
      validationIssues: claimIssues,
      acceptancePayload: claim.canAccept
        ? {
            claimId: claim.claimId,
            decisionRef: clientDecision.acceptance.decisionRef,
            proofRef: claim.proofRef,
            proofAuditRef: claim.proofAuditRef,
            boundaryAuditRef: claim.auditRef,
            acceptedAt: generatedAt
          }
        : null,
      route: {
        route: claim.route,
        state: claim.routeState,
        providerId: provider?.providerId || null,
        syncStatus: provider?.sync.status || 'missing',
        missingCapabilities: provider?.missingCapabilities || [],
        assignedVerifierId: claim.assignedVerifierId,
        routingDecisionState: claim.routingDecisionState
      },
      routing: {
        assignedVerifierId: claim.assignedVerifierId,
        decisionState: claim.routingDecisionState,
        blockers: claim.routingBlockers,
        proofRef: claim.routingProofRef,
        auditRef: claim.routingAuditRef
      },
      proof: {
        state: claim.proofState,
        proofRef: claim.proofRef,
        evidenceIds: claim.evidenceIds,
        auditRef: proof?.auditRef || claim.proofAuditRef
      },
      nextStep: claim.nextStep
    };
  });
  const routeCards = providerServices.contracts.map((provider) => {
    const routeRows = rows.filter((row) => row.route.route === provider.route);
    return {
      route: provider.route,
      providerId: provider.providerId,
      state: provider.missingCapabilities.length
        ? 'blocked'
        : provider.sync.status === 'current'
          ? 'ready'
          : 'review',
      endpoint: provider.endpoint,
      syncStatus: provider.sync.status,
      missingCapabilities: provider.missingCapabilities,
      impactedClaimIds: routeRows.map((row) => row.claimId),
      acceptReadyClaimIds: routeRows.filter((row) => row.canAccept).map((row) => row.claimId),
      nextSyncAt: provider.sync.nextSyncAt
    };
  });
  const orderedNextSteps = rows
    .filter((row) => !row.canAccept)
    .map((row) => ({
      ...row.nextStep,
      claimId: row.claimId,
      priority: row.blockers.length ? 'high' : 'normal',
      blockingCodes: row.blockers
    }));

  return {
    generatedAt,
    state: clientDecision.acceptance.state,
    summary: {
      totalPreviewClaims: rows.length,
      acceptReadyCount: rows.filter((row) => row.canAccept).length,
      needsActionCount: rows.filter((row) => row.previewState === 'needs-action').length,
      inProgressCount: rows.filter((row) => row.previewState === 'in-progress').length,
      warningCount: rows.reduce((count, row) => count + row.warnings.length, 0),
      blockingIssueCount: validationSummary.blockingIssueCount
    },
    validationCard: {
      status: validationSummary.status,
      issueCount: validationSummary.issueCount,
      bySeverity: validationSummary.bySeverity,
      blockingIssueCount: validationSummary.blockingIssueCount
    },
    readinessCards: clientDecision.readinessChecks.map((check) => ({
      ...check,
      blocking: check.state === 'blocked',
      reviewRequired: check.state === 'review'
    })),
    rows,
    routeCards,
    nextStepPlan: orderedNextSteps.length
      ? orderedNextSteps.slice(0, 8)
      : [
          {
            ...lifecycle.nextAction,
            priority: lifecycle.nextAction.priority || 'normal',
            blockingCodes: []
          }
        ],
    clientCommands: {
      primary: clientDecision.clientHints.primaryAction,
      acceptReadyClaims: rows
        .filter((row) => row.canAccept)
        .map((row) => row.acceptancePayload),
      refreshRequired:
        readinessChecksById.get('provider-sync')?.state === 'review' ||
        readinessChecksById.get('lifecycle-controls')?.state === 'review'
    }
  };
}

function buildWorkflowHandoffState({ generatedAt, clientRequest, acceptancePreview, providerServices, routingState, accessPolicy }) {
  const rowsByClaimId = new Map(acceptancePreview.rows.map((row) => [row.claimId, row]));
  const routingByClaimId = new Map(routingState.decisions.map((decision) => [decision.claimId, decision]));
  const providerByRoute = new Map(providerServices.contracts.map((contract) => [contract.route, contract]));
  const selectedRows = clientRequest.focusClaimIds.map((claimId) => rowsByClaimId.get(claimId)).filter(Boolean);
  const handoffRows = selectedRows.length ? selectedRows : acceptancePreview.rows;
  const handoffClaims = handoffRows.map((row) => {
    const routeDecision = routingByClaimId.get(row.claimId);
    const provider = providerByRoute.get(row.route.route);
    const handoffType = row.canAccept
      ? 'acceptance'
      : row.nextStep.type === 'assign-verifier'
        ? 'routing'
        : row.route.state === 'missing-provider' || row.route.state === 'capability-gap'
          ? 'provider'
          : row.proof.state !== 'verified' && row.blockers.includes('proof-not-verified')
            ? 'proof'
            : 'remediation';
    const command =
      handoffType === 'acceptance'
        ? 'accept-claim'
        : handoffType === 'routing'
          ? 'assign-verifier'
          : row.nextStep.type;

    return {
      claimId: row.claimId,
      handoffType,
      command,
      state: row.canAccept ? 'ready' : row.blockers.length ? 'blocked' : 'pending',
      callbackRoute: clientRequest.callbackRoute,
      providerId: provider?.providerId || null,
      route: row.route.route,
      assignedVerifierId: row.routing.assignedVerifierId || routeDecision?.assignedVerifierId || null,
      blockers: row.blockers,
      warnings: row.warnings,
      proofRef: row.canAccept
        ? row.acceptancePayload?.proofRef || row.proof.proofRef
        : row.routing.proofRef || row.proof.proofRef || `proof:${surfaceName}:workflow:${row.claimId}`,
      auditRef: `${accessPolicy.auditSink}:workflow-handoff:${clientRequest.correlationId}:${row.claimId}:${generatedAt}`,
      payload: {
        correlationId: clientRequest.correlationId,
        claimId: row.claimId,
        action: command,
        dryRun: clientRequest.dryRun,
        decisionRef: row.acceptancePayload?.decisionRef || null,
        routingDecisionState: row.routing.decisionState,
        nextStep: row.nextStep
      }
    };
  });
  const readyCommands = handoffClaims.filter((claim) => claim.state === 'ready');
  const blockedCommands = handoffClaims.filter((claim) => claim.state === 'blocked');

  return {
    generatedAt,
    request: clientRequest,
    state: clientRequest.unknownClaimIds.length || blockedCommands.length
      ? 'blocked'
      : readyCommands.length
        ? 'ready'
        : 'pending',
    handoffClaims,
    commandEnvelope: {
      correlationId: clientRequest.correlationId,
      channel: clientRequest.channel,
      requestedAction: clientRequest.requestedAction,
      actorId: clientRequest.actorId,
      dryRun: clientRequest.dryRun,
      readyCommandCount: readyCommands.length,
      blockedCommandCount: blockedCommands.length,
      unknownClaimIds: clientRequest.unknownClaimIds,
      callbackRoute: clientRequest.callbackRoute,
      auditRef: clientRequest.auditRef,
      proofRef: `proof:${surfaceName}:workflow-handoff:${clientRequest.correlationId}`
    },
    nextHandoff: readyCommands[0] || handoffClaims[0] || {
      claimId: null,
      handoffType: 'idle',
      command: 'inspect',
      state: 'pending',
      callbackRoute: clientRequest.callbackRoute,
      blockers: clientRequest.unknownClaimIds.length ? ['unknown-claim-selection'] : [],
      proofRef: `proof:${surfaceName}:workflow:idle`,
      auditRef: `${accessPolicy.auditSink}:workflow-handoff:${clientRequest.correlationId}:idle:${generatedAt}`
    },
    summary: {
      selectedClaimCount: clientRequest.focusClaimIds.length,
      readyClaimIds: readyCommands.map((claim) => claim.claimId),
      blockedClaimIds: blockedCommands.map((claim) => claim.claimId),
      unknownClaimIds: clientRequest.unknownClaimIds,
      auditRefs: handoffClaims.map((claim) => claim.auditRef),
      proofRefs: handoffClaims.map((claim) => claim.proofRef)
    }
  };
}

export function describeVerifierCatalogSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const generatedAt = asIsoTimestamp(now, new Date().toISOString());
  const accessPolicy = normalizeAccessPolicy(input.accessPolicy, generatedAt);
  const verifiers = Array.isArray(input.verifiers)
    ? input.verifiers.map((verifier, index) => normalizeVerifier(verifier, index, accessPolicy))
    : [];
  const existingClaims = Array.isArray(input.claims)
    ? input.claims.map((claim, index) => normalizeClaim(claim, index, generatedAt, accessPolicy))
    : [];
  const claimSubmissions = normalizeClaimSubmissions(input.claimSubmissions || input.submissions, generatedAt, accessPolicy);
  const claimGate = buildClaimGateState({
    generatedAt,
    accessPolicy,
    submissions: claimSubmissions,
    existingClaims
  });
  const claims = [...existingClaims, ...claimGate.acceptedClaims];
  const clientRequest = normalizeClientRuntimeRequest(input.clientRequest || input.request, generatedAt, claims);
  const stages = Array.isArray(input.stages)
    ? input.stages.map((stage) => asNonEmptyString(stage, '')).filter(Boolean)
    : DEFAULT_STAGES;
  const settings = normalizeSettings(input.settings);
  const healthPolicy = normalizeHealthPolicy(input.healthPolicy);
  const healthIncidents = normalizeHealthIncidents(input.healthIncidents, generatedAt);
  const persistedState = normalizePersistedCatalogState(input.persistedState || input.state, generatedAt);
  const lifecycleCommands = Array.isArray(input.lifecycleCommands)
    ? input.lifecycleCommands.map((command, index) => normalizeLifecycleCommand(command, index, generatedAt))
    : [];
  const providerContracts = normalizeProviderContracts(input.providerContracts, verifiers, generatedAt);
  const evidenceRecords = normalizeEvidenceRecords(input.evidence, generatedAt, accessPolicy);
  const analytics = buildAnalytics(claims, verifiers);
  const timeline = buildTimeline(claims, stages);
  const providerServices = buildProviderServiceState({
    generatedAt,
    verifiers,
    claims,
    providerContracts
  });
  const boundaryState = buildAccessBoundaryState({
    generatedAt,
    accessPolicy,
    verifiers,
    claims,
    providerServices
  });
  const proofLedger = buildProofLedgerState({
    generatedAt,
    accessPolicy,
    claims,
    evidenceRecords
  });
  const lifecycle = buildLifecycleState({
    generatedAt,
    settings,
    verifiers,
    claims,
    commands: lifecycleCommands,
    persistedState
  });
  const routingState = buildHostedKernelRoutingState({
    generatedAt,
    accessPolicy,
    claims,
    verifiers,
    providerServices,
    lifecycle,
    boundaryState
  });
  const persistedStateEnvelope = buildPersistedStateEnvelope({
    generatedAt,
    accessPolicy,
    lifecycle,
    providerServices,
    claims,
    proofLedger
  });
  const validationSummary = buildValidationSummary({
    settingsIssues: lifecycle.settingsIssues,
    commandIssues: lifecycle.commandIssues,
    contractIssues: providerServices.contractIssues,
    routingIssues: routingState.routingIssues,
    boundaryIssues: boundaryState.issues,
    proofLedgerIssues: proofLedger.issues,
    claimGateIssues: claimGate.issues,
    claims,
    verifiers,
    providerServices
  });
  const operationalHealth = buildOperationalHealthState({
    generatedAt,
    policy: healthPolicy,
    incidents: healthIncidents,
    claims,
    lifecycle,
    providerServices,
    boundaryState,
    proofLedger,
    validationSummary
  });
  const clientDecision = buildClientDecisionContract({
    generatedAt,
    claims,
    verifiers,
    lifecycle,
    providerServices,
    routingState,
    boundaryState,
    proofLedger,
    validationSummary,
    operationalHealth
  });
  const acceptancePreview = buildAcceptancePreviewContract({
    generatedAt,
    clientDecision,
    validationSummary,
    providerServices,
    boundaryState,
    proofLedger,
    lifecycle
  });
  const workflowHandoff = buildWorkflowHandoffState({
    generatedAt,
    clientRequest,
    acceptancePreview,
    providerServices,
    routingState,
    accessPolicy
  });
  const history = buildHistorySnapshot({
    now: generatedAt,
    claims,
    verifiers,
    analytics,
    previousSnapshots: input.historySnapshots
  });
  const exportRequest = normalizeExportRequest(input.exportRequest);
  const reportingState = buildReportingState({
    generatedAt,
    analytics,
    history,
    timeline,
    lifecycle,
    providerServices,
    routingState,
    boundaryState,
    proofLedger,
    claimGate,
    clientDecision,
    operationalHealth
  });
  const exportManifest = buildExportManifest({
    generatedAt,
    exportRequest,
    verifiers,
    claims,
    analytics,
    history,
    timeline,
    lifecycle,
    providerServices,
    routingState,
    clientDecision,
    acceptancePreview,
    claimGate,
    workflowHandoff,
    boundaryState,
    proofLedger,
    reportingState,
    persistedStateEnvelope,
    operationalHealth
  });
  const blockedClaims = claims.filter((claim) => claim.status === 'blocked');
  const unassignedClaims = claims.filter((claim) => claim.verifierId === 'unassigned');

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel verifier catalog analytics/export contract',
    dataContract: {
      verifiers: 'Array<{id,label,tenantId,workspaceIds,route,capabilities,permissions,role,health,active,lastSeenAt}>',
      claims: 'Array<{id,subject,tenantId,workspaceId,route,verifierId,requiredPermission,status,stage,outcome,severity,proofRef,updatedAt}>',
      claimSubmissions: 'Array<{submissionId,claimId,idempotencyKey,subject,tenantId,workspaceId,route,requestedVerifierId,requiredPermission,severity,submittedBy,submittedAt,evidenceRefs,source}>',
      claimGate: 'Object<{generatedAt,submissions,submissionDecisions,acceptedClaims,rejectedSubmissions,issues,summary}>',
      accessPolicy: 'Object<{tenantId,workspaceId,actorId,actorType,roles,permissions,enforceTenantIsolation,allowCrossWorkspaceHandoff,auditSink,evaluatedAt}>',
      boundaryState: 'Object<{policy,claimScopes,issues,summary}>',
      evidenceRecords: 'Array<{id,claimId,proofRef,kind,issuer,route,tenantId,workspaceId,digest,state,collectedAt,expiresAt,auditRef}>',
      proofLedger: 'Object<{generatedAt,evidenceRecords,claimProofs,issues,summary}>',
      settings: 'Object<{lifecycleEnabled,allowAutoDisable,requireProofForTerminalClaims,maxOpenClaimsPerVerifier,scheduleCadenceMinutes,staleVerifierMinutes}>',
      healthPolicy: 'Object<{failureThreshold,retryBaseSeconds,retryMaxSeconds,degradedAfterFailures}>',
      healthIncidents: 'Array<{id,source,code,severity,targetType,targetId,message,failureCount,retryable,actionType,observedAt,lastAttemptAt}>',
      operationalHealth: 'Object<{generatedAt,policy,status,degradedMode,failureStates,retryPlan,actionableErrors,incidentValidation,incidentEcho,summary}>',
      lifecycleCommands: 'Array<{id,action,targetVerifierId,reason,requestedBy,requestedAt,effectiveAt}>',
      lifecycle: 'Object<{settings,settingsIssues,commands,commandEffects,commandIssues,controls,openClaimsByVerifier,effectiveVerifierStates,nextAction,nextActionQueue}>',
      persistedState: 'Object<{checkpointId,status,recoveredAt,lastGeneratedAt,appliedCommandIds,commandEffects,verifierStates,queuedCommands,providerSyncCursors,claimStatusById}>',
      persistedStateEnvelope: 'Object<{checkpointId,previousCheckpointId,status,generatedAt,tenantId,workspaceId,restartSafe,idempotency,verifierStates,queuedCommands,providerSyncCursors,claimStatusById,proofLedgerSummary,recoveryWarnings,auditRef,proofRef}>',
      providerContracts: 'Array<{id,providerId,service,route,endpoint,requiredCapabilities,offeredCapabilities,syncCursor,syncStatus,syncedAt,acceptsExternalHandoff,proofNamespace}>',
      providerServices: 'Object<{contracts,contractIssues,handoffQueue,syncMetadata}>',
      routingState: 'Object<{generatedAt,strategy,decisions,routingIssues,summary}>',
      validationSummary: 'Object<{status,issueCount,bySeverity,blockingIssueCount,issues}>',
      clientRequest: 'Object<{correlationId,requestedAction,channel,actorId,selectedClaimIds,unknownClaimIds,focusClaimIds,callbackRoute,dryRun,requestedAt,auditRef}>',
      clientDecision: 'Object<{generatedAt,previewClaims,acceptance,readinessChecks,nextSteps,clientHints}>',
      acceptancePreview: 'Object<{generatedAt,state,summary,validationCard,readinessCards,rows,routeCards,nextStepPlan,clientCommands}>',
      workflowHandoff: 'Object<{generatedAt,request,state,handoffClaims,commandEnvelope,nextHandoff,summary}>',
      history: 'Array<{snapshotId,capturedAt,totalClaims,openClaims,terminalClaims,activeVerifiers,catalogSize?}>',
      reportingState: 'Object<{generatedAt,status,trendDeltas,timelineState,healthSignals,rollup}>',
      exportRequest: 'Object<{formats,sections,includeAudit,includeEvidence,maxRowsPerSection,requestedBy,requestId}>',
      exportManifest: 'Array<{format,section,name,generatedAt,requestedBy,requestId,rowCount,truncated,includesAudit,includesEvidence,auditRef,proofRef}>',
      exports: 'Array<{format,name,generatedAt,rowCount,fields}>'
    },
    verifiers,
    claims,
    claimSubmissions,
    claimGate,
    accessPolicy,
    boundaryState,
    evidenceRecords,
    proofLedger,
    settings,
    healthPolicy,
    healthIncidents,
    operationalHealth,
    persistedState,
    lifecycleCommands,
    providerContracts,
    providerServices,
    routingState,
    lifecycle,
    persistedStateEnvelope,
    validationSummary,
    clientRequest,
    clientDecision,
    acceptancePreview,
    workflowHandoff,
    analytics,
    history,
    timeline,
    reportingState,
    exportRequest,
    exportManifest,
    reports: {
      blockedClaimIds: blockedClaims.map((claim) => claim.id),
      unassignedClaimIds: unassignedClaims.map((claim) => claim.id),
      routeCoverage: Object.fromEntries(
        verifiers.map((verifier) => [
          verifier.id,
          claims.filter((claim) => claim.verifierId === verifier.id).length
        ])
      ),
      status: reportingState.status,
      routingStatus: routingState.summary.state,
      claimGateStatus: claimGate.summary.state,
      claimGateAcceptedClaimIds: claimGate.summary.acceptedClaimIds,
      claimGateRejectedSubmissionIds: claimGate.summary.rejectedSubmissionIds,
      routingAssignmentsReady: routingState.summary.assignmentReadyClaimIds,
      routingBlockedClaimIds: routingState.summary.blockedClaimIds,
      operationalHealthStatus: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode,
      actionableErrors: operationalHealth.actionableErrors,
      retryPlan: operationalHealth.retryPlan,
      healthSignals: reportingState.healthSignals,
      trendDeltas: reportingState.trendDeltas,
      rollup: reportingState.rollup
    },
    exports: [
      {
        format: 'json',
        name: `${surfaceName}-catalog-summary`,
        generatedAt,
        rowCount: verifiers.length,
        fields: ['id', 'label', 'route', 'capabilities', 'health', 'active', 'lastSeenAt']
      },
      {
        format: 'csv',
        name: `${surfaceName}-claim-analytics`,
        generatedAt,
        rowCount: claims.length,
        fields: [
          'id',
          'subject',
          'tenantId',
          'workspaceId',
          'route',
          'verifierId',
          'requiredPermission',
          'status',
          'stage',
          'outcome',
          'severity',
          'proofRef',
          'updatedAt'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-history-snapshots`,
        generatedAt,
        rowCount: history.length,
        fields: ['snapshotId', 'capturedAt', 'totalClaims', 'openClaims', 'terminalClaims', 'activeVerifiers', 'catalogSize']
      },
      {
        format: 'json',
        name: `${surfaceName}-operational-health`,
        generatedAt,
        rowCount:
          operationalHealth.failureStates.length +
          operationalHealth.retryPlan.length +
          operationalHealth.incidentValidation.length,
        fields: [
          'status',
          'degradedMode',
          'policy',
          'failureStates',
          'retryPlan',
          'actionableErrors',
          'incidentValidation',
          'summary',
          'incidentEcho'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-lifecycle-controls`,
        generatedAt,
        rowCount: lifecycle.nextActionQueue.length,
        fields: [
          'settings',
          'settingsIssues',
          'commands',
          'commandEffects',
          'commandIssues',
          'controls',
          'openClaimsByVerifier',
          'effectiveVerifierStates',
          'nextAction',
          'nextActionQueue'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-persisted-state`,
        generatedAt,
        rowCount:
          persistedStateEnvelope.verifierStates.length +
          Object.keys(persistedStateEnvelope.providerSyncCursors).length +
          Object.keys(persistedStateEnvelope.claimStatusById).length,
        fields: [
          'checkpointId',
          'previousCheckpointId',
          'status',
          'restartSafe',
          'idempotency',
          'verifierStates',
          'queuedCommands',
          'providerSyncCursors',
          'claimStatusById',
          'proofLedgerSummary',
          'recoveryWarnings',
          'auditRef',
          'proofRef'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-provider-contracts`,
        generatedAt,
        rowCount: providerServices.contracts.length,
        fields: [
          'id',
          'providerId',
          'service',
          'route',
          'endpoint',
          'requiredCapabilities',
          'negotiatedCapabilities',
          'missingCapabilities',
          'sync',
          'matchedVerifierIds',
          'activeVerifierIds',
          'openClaimIds'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-hosted-routing`,
        generatedAt,
        rowCount: routingState.decisions.length,
        fields: [
          'claimId',
          'route',
          'currentVerifierId',
          'assignedVerifierId',
          'decisionState',
          'candidateVerifierIds',
          'providerReady',
          'boundaryState',
          'blockers',
          'routeProofRef',
          'routeAuditRef'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-external-handoff`,
        generatedAt,
        rowCount: providerServices.handoffQueue.length,
        fields: ['claimId', 'providerId', 'route', 'state', 'reason', 'proofRef']
      },
      {
        format: 'json',
        name: `${surfaceName}-client-decision`,
        generatedAt,
        rowCount: clientDecision.previewClaims.length,
        fields: [
          'previewClaims',
          'acceptance',
          'readinessChecks',
          'validationSummary',
          'nextSteps',
          'clientHints'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-acceptance-preview`,
        generatedAt,
        rowCount: acceptancePreview.rows.length,
        fields: [
          'state',
          'summary',
          'validationCard',
          'readinessCards',
          'rows',
          'routeCards',
          'nextStepPlan',
          'clientCommands'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-claim-gate`,
        generatedAt,
        rowCount: claimGate.submissionDecisions.length,
        fields: [
          'submissions',
          'submissionDecisions',
          'acceptedClaims',
          'rejectedSubmissions',
          'issues',
          'summary',
          'auditRef',
          'proofRef'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-workflow-handoff`,
        generatedAt,
        rowCount: workflowHandoff.handoffClaims.length,
        fields: [
          'request',
          'state',
          'handoffClaims',
          'commandEnvelope',
          'nextHandoff',
          'summary',
          'auditRef',
          'proofRef'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-access-boundary`,
        generatedAt,
        rowCount: boundaryState.claimScopes.length,
        fields: [
          'policy',
          'claimScopes',
          'issues',
          'summary',
          'tenantId',
          'workspaceId',
          'requiredPermission',
          'auditRef'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-proof-ledger`,
        generatedAt,
        rowCount: proofLedger.claimProofs.length,
        fields: [
          'claimId',
          'proofRef',
          'terminal',
          'evidenceIds',
          'attachedEvidenceId',
          'proofState',
          'evidenceValid',
          'evidenceScoped',
          'evidenceRouteMatches',
          'evidenceExpired',
          'auditRef'
        ]
      },
      {
        format: 'json',
        name: `${surfaceName}-evidence-records`,
        generatedAt,
        rowCount: evidenceRecords.length,
        fields: [
          'id',
          'claimId',
          'proofRef',
          'kind',
          'issuer',
          'route',
          'tenantId',
          'workspaceId',
          'digest',
          'state',
          'collectedAt',
          'expiresAt',
          'auditRef'
        ]
      },
      ...exportManifest.map((manifest) => ({
        format: manifest.format,
        name: manifest.name,
        generatedAt: manifest.generatedAt,
        rowCount: manifest.rowCount,
        fields: [
          'section',
          'requestId',
          'requestedBy',
          'truncated',
          'includesAudit',
          'includesEvidence',
          'auditRef',
          'proofRef'
        ],
        section: manifest.section,
        requestId: manifest.requestId,
        requestedBy: manifest.requestedBy,
        truncated: manifest.truncated,
        auditRef: manifest.auditRef,
        proofRef: manifest.proofRef
      }))
    ],
    audit: {
      proofRefs: claims.map((claim) => claim.proofRef).filter(Boolean),
      missingProofClaimIds: claims.filter((claim) => !claim.proofRef && FINAL_STATUSES.has(claim.status)).map((claim) => claim.id),
      lifecycleProofRefs: lifecycle.commandEffects.map((effect) => effect.proofRef),
      lifecycleIssueCount: lifecycle.settingsIssues.length + lifecycle.commandIssues.length,
      lifecycleAppliedCommandIds: lifecycle.controls.appliedCommandIds,
      lifecycleQueuedCommandIds: lifecycle.controls.queuedCommandIds,
      lifecycleRejectedCommandIds: lifecycle.controls.rejectedCommandIds,
      lifecycleRecoveredCommandIds: lifecycle.controls.recoveredCommandIds,
      lifecycleDuplicateCommandIds: lifecycle.controls.duplicateCommandIds,
      lifecycleEffectiveDisabledVerifierIds: lifecycle.controls.disabledVerifierIds,
      persistedStateStatus: persistedStateEnvelope.status,
      persistedStateRestartSafe: persistedStateEnvelope.restartSafe,
      persistedStateCheckpointId: persistedStateEnvelope.checkpointId,
      persistedStatePreviousCheckpointId: persistedStateEnvelope.previousCheckpointId,
      persistedStateProofRef: persistedStateEnvelope.proofRef,
      persistedStateAuditRef: persistedStateEnvelope.auditRef,
      persistedAppliedCommandIds: persistedStateEnvelope.idempotency.appliedCommandIds,
      persistedQueuedCommandIds: persistedStateEnvelope.idempotency.queuedCommandIds,
      persistedRecoveryWarnings: persistedStateEnvelope.recoveryWarnings,
      providerProofRefs: providerServices.handoffQueue.map((handoff) => handoff.proofRef),
      providerIssueCount: providerServices.contractIssues.length,
      providerSyncStatus: providerServices.syncMetadata,
      routingState: routingState.summary.state,
      routingAssignmentReadyClaimIds: routingState.summary.assignmentReadyClaimIds,
      routingPreservedAssignmentClaimIds: routingState.summary.preservedAssignmentClaimIds,
      routingBlockedClaimIds: routingState.summary.blockedClaimIds,
      routingAuditRefs: routingState.summary.auditRefs,
      routingProofRefs: routingState.summary.proofRefs,
      claimGateState: claimGate.summary.state,
      claimGateAcceptedClaimIds: claimGate.summary.acceptedClaimIds,
      claimGateRejectedSubmissionIds: claimGate.summary.rejectedSubmissionIds,
      claimGateAuditRefs: claimGate.summary.auditRefs,
      claimGateProofRefs: claimGate.summary.proofRefs,
      claimGateIssueCount: claimGate.issues.length,
      proofLedgerStatus: proofLedger.summary.status,
      proofLedgerVerifiedClaimIds: proofLedger.summary.verifiedClaimIds,
      proofLedgerBlockedClaimIds: proofLedger.summary.blockedClaimIds,
      proofLedgerAuditRefs: proofLedger.summary.auditRefs,
      orphanEvidenceIds: proofLedger.summary.orphanEvidenceIds,
      boundaryStatus: boundaryState.summary.status,
      boundaryBlockedClaimIds: boundaryState.summary.blockedClaimIds,
      boundaryAuditRefs: boundaryState.summary.auditRefs,
      tenantId: accessPolicy.tenantId,
      workspaceId: accessPolicy.workspaceId,
      actorId: accessPolicy.actorId,
      validationStatus: validationSummary.status,
      acceptanceState: clientDecision.acceptance.state,
      acceptancePreviewState: acceptancePreview.state,
      workflowHandoffState: workflowHandoff.state,
      workflowHandoffNextCommand: workflowHandoff.nextHandoff.command,
      workflowReadyClaimIds: workflowHandoff.summary.readyClaimIds,
      workflowBlockedClaimIds: workflowHandoff.summary.blockedClaimIds,
      acceptancePreviewReadyCount: acceptancePreview.summary.acceptReadyCount,
      acceptancePreviewNeedsActionCount: acceptancePreview.summary.needsActionCount,
      acceptanceDecisionRef: clientDecision.acceptance.decisionRef,
      readinessBlockedCheckIds: clientDecision.readinessChecks
        .filter((check) => check.state === 'blocked')
        .map((check) => check.id),
      acceptedPreviewClaimIds: clientDecision.acceptance.acceptedClaimIds,
      acceptancePreviewNextStepTypes: acceptancePreview.nextStepPlan.map((step) => step.type),
      workflowHandoffAuditRefs: workflowHandoff.summary.auditRefs,
      workflowHandoffProofRefs: workflowHandoff.summary.proofRefs,
      clientCorrelationId: clientRequest.correlationId,
      clientUnknownClaimIds: clientRequest.unknownClaimIds,
      exportRequestId: exportRequest.requestId,
      exportProofRefs: exportManifest.map((manifest) => manifest.proofRef),
      exportAuditRefs: exportManifest.map((manifest) => manifest.auditRef).filter(Boolean),
      reportingStatus: reportingState.status,
      reportingSignalIds: reportingState.healthSignals.map((signal) => signal.id),
      operationalHealthStatus: operationalHealth.status,
      operationalHealthDegradedMode: operationalHealth.degradedMode,
      operationalHealthFailureCount: operationalHealth.summary.failureCount,
      operationalHealthRetryableFailureCount: operationalHealth.summary.retryableFailureCount,
      operationalHealthIncidentCount: operationalHealth.summary.incidentCount,
      operationalHealthInvalidIncidentCount: operationalHealth.summary.invalidIncidentCount,
      operationalHealthNextRetryAt: operationalHealth.summary.nextRetryAt,
      operationalHealthActionCodes: operationalHealth.actionableErrors.map((error) => error.code),
      operationalHealthAuditRefs: operationalHealth.summary.auditRefs,
      operationalHealthProofRefs: operationalHealth.summary.proofRefs,
      nextActionType: lifecycle.nextAction.type,
      evidenceCount: evidenceRecords.length
    },
    evidence: evidenceRecords
  };
}

export default describeVerifierCatalogSurface;
