export const surfaceId = "aios_capability-security_external-write-guard_016";
export const surfaceGroup = "capability-security";
export const surfaceName = "external-write-guard";

const DEFAULT_ALLOWED_SCHEMES = ['file', 'artifact', 'workspace'];
const DEFAULT_BLOCKED_SCHEMES = ['http', 'https', 's3', 'gs', 'ftp'];
const DEFAULT_CLIENT_CHANNEL = 'hosted-kernel';
const DEFAULT_PROVIDER_CAPABILITIES = [
  'external-write.preview',
  'external-write.acceptance',
  'external-write.commit-intent',
  'external-write.audit-proof'
];
const DEFAULT_PROVIDER_CAPABILITY_ALIASES = {
  'external-write.filesystem': ['external-write.scheme.file', 'external-write.scheme.workspace', 'external-write.scheme.relative'],
  'external-write.local-targets': ['external-write.scheme.file', 'external-write.scheme.workspace', 'external-write.scheme.relative'],
  'external-write.all-operations': ['external-write.operation.write', 'external-write.operation.create', 'external-write.operation.update', 'external-write.operation.delete']
};
const LIFECYCLE_COMMAND_TYPES = [
  'enable-guard',
  'disable-guard',
  'resume-guard',
  'schedule-guard',
  'update-guard-settings'
];
const LIFECYCLE_MODES = ['enforce', 'monitor', 'disabled'];
const WRITE_REVIEW_STAGES = ['draft', 'send'];
const COMMIT_APPROVAL_INTENTS = ['commit-guarded-writes', 'commit', 'send-and-commit'];
const ACCEPTANCE_APPROVAL_INTENTS = ['accept-preview', 'accept', 'preview-acceptance'];
const PERSISTED_STATE_VERSION = 1;
const DEFAULT_ACCEPTANCE_TTL_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SCHEDULE_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_HEALTH_BACKOFF_MS = [1000, 5000, 15000, 60000];
const DEFAULT_HEALTH_CHECK_STALE_MS = 5 * 60 * 1000;
const CLIENT_CHANNEL_PROFILES = {
  'hosted-kernel': {
    surface: 'kernel.review',
    reviewPanel: 'external-write-guard',
    commandTransport: 'kernel-command',
    allowsInlineAcceptance: true
  },
  cli: {
    surface: 'terminal.review',
    reviewPanel: 'external-write-guard',
    commandTransport: 'stdin-command',
    allowsInlineAcceptance: false
  },
  api: {
    surface: 'api.workflow',
    reviewPanel: 'external-write-guard',
    commandTransport: 'http-command',
    allowsInlineAcceptance: false
  }
};
const CLIENT_RUNTIME_CAPABILITY_REQUIREMENTS = {
  'commit-guarded-writes': ['external-write-guard.command.commit'],
  'accept-preview': ['external-write-guard.command.accept-preview'],
  'clear-acceptance': ['external-write-guard.command.clear-acceptance'],
  'remove-external-targets': ['external-write-guard.command.remediate-targets'],
  'submit-proposed-writes': ['external-write-guard.preview.submit'],
  'negotiate-provider-contract': ['external-write-guard.provider.negotiate'],
  'repair-provider-service-contract': ['external-write-guard.provider.repair-contract'],
  'sync-provider-contract': ['external-write-guard.provider.sync-contract'],
  'await-provider-ack': ['external-write-guard.provider.await-ack'],
  'retry-operational-health-check': ['external-write-guard.operational-health.retry'],
  'enable-guard': ['external-write-guard.lifecycle.enable'],
  'disable-guard': ['external-write-guard.lifecycle.disable'],
  'resume-guard': ['external-write-guard.lifecycle.resume'],
  'schedule-guard': ['external-write-guard.lifecycle.schedule'],
  'update-guard-settings': ['external-write-guard.lifecycle.update-settings']
};

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeUri(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeStringList(value) {
  return toArray(value)
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function normalizeStringEntries(value) {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return normalizeStringList(value);
}

function normalizeStringRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [nonEmptyString(key), nonEmptyString(entry)])
      .filter(([key, entry]) => key && entry)
  );
}

function stableScalar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function stableStringify(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${key}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return stableScalar(value);
}

function normalizeNumericRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [nonEmptyString(key), Number.isFinite(entry) ? entry : Number(entry)])
      .filter(([key, entry]) => key && Number.isFinite(entry))
  );
}

function normalizePositiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function schemeFor(uri) {
  if (/^[a-z]:[\\/]/i.test(uri) || /^\\\\/.test(uri)) return 'file';
  const match = uri.match(/^([a-z][a-z0-9+.-]*):/i);
  return match ? match[1].toLowerCase() : 'relative';
}

function firstString(...values) {
  for (const value of values) {
    const normalized = nonEmptyString(value);
    if (normalized) return normalized;
  }
  return '';
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeIsoInstant(value) {
  const normalized = nonEmptyString(value);
  if (!normalized) return '';
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function instantIsFuture(value, now) {
  const timestamp = Date.parse(value);
  const nowTimestamp = Date.parse(now);
  return Number.isFinite(timestamp) && Number.isFinite(nowTimestamp) && timestamp > nowTimestamp;
}

function elapsedSince(value, now) {
  const timestamp = Date.parse(value);
  const nowTimestamp = Date.parse(now);
  return Number.isFinite(timestamp) && Number.isFinite(nowTimestamp) ? nowTimestamp - timestamp : null;
}

function normalizeHistorySnapshots(value) {
  return toArray(value)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => ({
      id: nonEmptyString(entry.id) || `history-${index + 1}`,
      capturedAt: normalizeIsoInstant(entry.capturedAt || entry.generatedAt || entry.updatedAt),
      requestId: nonEmptyString(entry.requestId),
      revision: Number.isInteger(entry.revision) && entry.revision >= 0 ? entry.revision : 0,
      readinessState: nonEmptyString(entry.readinessState || entry.state),
      canCommit: entry.canCommit === true,
      counters: normalizeNumericRecord(entry.counters),
      approvalBoundaryCounters: normalizeNumericRecord(entry.approvalBoundaryCounters),
      blockerCounts: normalizeNumericRecord(entry.blockerCounts),
      stageCounts: normalizeNumericRecord(entry.stageCounts),
      providerState: nonEmptyString(entry.providerState),
      lifecycleMode: nonEmptyString(entry.lifecycleMode)
    }))
    .filter((entry) => entry.capturedAt || Object.keys(entry.counters).length)
    .slice(-12);
}

function normalizeCommandLedger(value) {
  return toArray(value)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => ({
      id: nonEmptyString(entry.id || entry.commandId) || `command-${index + 1}`,
      type: nonEmptyString(entry.type || entry.commandType),
      appliedAt: normalizeIsoInstant(entry.appliedAt || entry.updatedAt || entry.issuedAt),
      issuedAt: normalizeIsoInstant(entry.issuedAt),
      result: nonEmptyString(entry.result || entry.status) || 'applied',
      replayCount: Number.isInteger(entry.replayCount) && entry.replayCount >= 0 ? entry.replayCount : 0,
      writeIds: normalizeStringList(entry.writeIds),
      stateRevision: Number.isInteger(entry.stateRevision) && entry.stateRevision >= 0 ? entry.stateRevision : 0,
      readinessState: nonEmptyString(entry.readinessState),
      rejectedReason: nonEmptyString(entry.rejectedReason),
      commitApprovalBoundary: objectValue(entry.commitApprovalBoundary),
      lifecycleCommandBoundary: objectValue(entry.lifecycleCommandBoundary),
      recoveryMode: nonEmptyString(entry.recoveryMode)
    }))
    .filter((entry) => entry.id && (entry.type || entry.appliedAt || entry.result))
    .slice(-24);
}

function normalizeApprovalProofRecord(value, writeId = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const scope = objectValue(value.approvalScope, value.scope, value.boundaryScope);
  const normalizedWriteId = firstString(value.writeId, value.id, writeId);
  const approvalStage = WRITE_REVIEW_STAGES.includes(nonEmptyString(value.approvalStage || value.reviewStage || value.stage))
    ? nonEmptyString(value.approvalStage || value.reviewStage || value.stage)
    : '';
  const approvalFingerprint = firstString(
    value.approvalFingerprint,
    value.fingerprint,
    value.acceptedFingerprint,
    value.requiredApprovalFingerprint
  );
  const approvedAt = normalizeIsoInstant(value.approvedAt || value.acceptedAt || value.issuedAt || value.createdAt);
  const source = firstString(value.source, value.approvalSource, value.channel);
  const commandId = firstString(value.commandId, value.acceptanceCommandId, value.idempotencyKey);
  if (!normalizedWriteId || (!approvalFingerprint && !approvedAt && !approvalStage && !source && !commandId)) return null;
  return {
    writeId: normalizedWriteId,
    approvalStage,
    approvalFingerprint,
    approvedAt,
    source,
    commandId,
    actorId: firstString(value.actorId, value.approverId, value.userId),
    clientId: firstString(value.clientId, value.runtimeId),
    tenantId: firstString(value.tenantId, scope.tenantId),
    workspaceId: firstString(value.workspaceId, scope.workspaceId),
    targetPath: firstString(value.targetPath, scope.targetPath, value.path),
    matchingRoots: normalizeStringList(value.matchingRoots || scope.matchingRoots || value.workspaceRoots),
    permissionGrantIds: normalizeStringList(value.permissionGrantIds || scope.permissionGrantIds || value.matchedPermissionGrants),
    requiredPermissions: normalizeStringList(value.requiredPermissions || scope.requiredPermissions),
    actorRoles: normalizeStringList(value.actorRoles || scope.actorRoles),
    approvalIntent: firstString(value.approvalIntent, value.intent, value.action),
    explicit: normalizeBoolean(value.explicit ?? value.explicitApproval, Boolean(approvalFingerprint || commandId || approvedAt))
  };
}

function normalizeApprovalProofRecordMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([writeId, proof]) => {
        const normalized = normalizeApprovalProofRecord(proof, writeId);
        return [nonEmptyString(writeId), normalized];
      })
      .filter(([writeId, proof]) => writeId && proof)
  );
}

function normalizeRecoveryEnvelope(value) {
  const envelope = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const commandResultsInput = envelope.commandResults && typeof envelope.commandResults === 'object' && !Array.isArray(envelope.commandResults)
    ? envelope.commandResults
    : {};
  const commandResults = Object.fromEntries(
    Object.entries(commandResultsInput)
      .map(([id, result]) => {
        const normalizedId = nonEmptyString(id);
        const normalizedResult = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
        return [normalizedId, {
          result: nonEmptyString(normalizedResult.result || normalizedResult.status),
          appliedAt: normalizeIsoInstant(normalizedResult.appliedAt || normalizedResult.updatedAt),
          stateRevision: normalizePositiveInteger(normalizedResult.stateRevision ?? normalizedResult.revision, 0),
          replayCount: normalizePositiveInteger(normalizedResult.replayCount, 0)
        }];
      })
      .filter(([id, result]) => id && (result.result || result.appliedAt || result.stateRevision))
  );
  return {
    version: normalizePositiveInteger(envelope.version, 1),
    state: nonEmptyString(envelope.state),
    stateKey: nonEmptyString(envelope.stateKey),
    route: nonEmptyString(envelope.route),
    requestId: nonEmptyString(envelope.requestId),
    checkpointedAt: normalizeIsoInstant(envelope.checkpointedAt || envelope.persistedAt || envelope.updatedAt),
    revision: normalizePositiveInteger(envelope.revision, 0),
    previewFingerprint: nonEmptyString(envelope.previewFingerprint),
    recoveryToken: nonEmptyString(envelope.recoveryToken || envelope.resumeToken),
    replayToken: nonEmptyString(envelope.replayToken),
    commitToken: nonEmptyString(envelope.commitToken),
    lastAppliedCommandId: nonEmptyString(envelope.lastAppliedCommandId),
    persistedCommandIds: normalizeStringList(envelope.persistedCommandIds || envelope.appliedCommandIds),
    commandResults
  };
}

function normalizeRecoveryPlan(value) {
  const plan = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    version: normalizePositiveInteger(plan.version, 1),
    state: nonEmptyString(plan.state),
    action: nonEmptyString(plan.action),
    status: nonEmptyString(plan.status),
    idempotencyKey: nonEmptyString(plan.idempotencyKey),
    requiresExplicitUserAction: plan.requiresExplicitUserAction === true,
    safeToResumePreview: plan.safeToResumePreview === true,
    safeToReplayCommandResult: plan.safeToReplayCommandResult === true,
    blockedReasons: normalizeStringList(plan.blockedReasons || plan.blockers),
    nextCommandType: nonEmptyString(plan.nextCommandType),
    nextCommandId: nonEmptyString(plan.nextCommandId),
    nextCommandWriteIds: normalizeStringList(plan.nextCommandWriteIds),
    previousAction: nonEmptyString(plan.previousAction),
    generatedAt: normalizeIsoInstant(plan.generatedAt || plan.updatedAt)
  };
}

function commandPersistenceRecord(command, persistedState) {
  if (!command?.id) return null;
  const fromCommandResults = persistedState.recoveryEnvelope.commandResults[command.id];
  if (fromCommandResults && ['applied', 'idempotent-replay'].includes(fromCommandResults.result)) {
    return {
      source: 'recovery-envelope.commandResults',
      result: fromCommandResults.result,
      appliedAt: fromCommandResults.appliedAt,
      stateRevision: fromCommandResults.stateRevision,
      replayCount: fromCommandResults.replayCount
    };
  }
  if (persistedState.recoveryEnvelope.persistedCommandIds.includes(command.id)) {
    return {
      source: 'recovery-envelope.persistedCommandIds',
      result: 'applied',
      appliedAt: '',
      stateRevision: persistedState.recoveryEnvelope.revision || persistedState.previousRevision,
      replayCount: 0
    };
  }
  const ledgerEntry = persistedState.commandLedger.find((entry) => entry.id === command.id);
  if (ledgerEntry && ['applied', 'idempotent-replay'].includes(ledgerEntry.result)) {
    return {
      source: 'command-ledger',
      result: ledgerEntry.result,
      appliedAt: ledgerEntry.appliedAt,
      stateRevision: ledgerEntry.stateRevision,
      replayCount: ledgerEntry.replayCount
    };
  }
  if (persistedState.appliedCommandIds.includes(command.id)) {
    return {
      source: 'appliedCommandIds',
      result: 'applied',
      appliedAt: '',
      stateRevision: persistedState.previousRevision,
      replayCount: 0
    };
  }
  return null;
}

function commandWasPreviouslyApplied(command, persistedState) {
  return Boolean(commandPersistenceRecord(command, persistedState));
}

function objectValue(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
}

function channelProfileFor(channel) {
  return CLIENT_CHANNEL_PROFILES[channel] || CLIENT_CHANNEL_PROFILES[DEFAULT_CLIENT_CHANNEL];
}

function normalizeWorkflowState(input, request, client, route, requestId) {
  const workflow = input.workflow && typeof input.workflow === 'object'
    ? input.workflow
    : input.clientWorkflow && typeof input.clientWorkflow === 'object'
      ? input.clientWorkflow
      : client.workflow && typeof client.workflow === 'object'
        ? client.workflow
        : {};
  const currentSurface = firstString(workflow.currentSurface, workflow.surface, client.surface, request.surface);
  const currentPanel = firstString(workflow.currentPanel, workflow.panel, client.panel, request.panel);
  const reviewSurface = firstString(workflow.reviewSurface, workflow.targetSurface, workflow.handoffSurface);
  const reviewPanel = firstString(workflow.reviewPanel, workflow.targetPanel, workflow.handoffPanel);
  const returnRoute = firstString(workflow.returnRoute, workflow.returnTo, request.returnRoute, client.returnRoute, route);
  const correlationId = firstString(workflow.correlationId, request.correlationId, input.correlationId, requestId);
  const resumeToken = firstString(workflow.resumeToken, workflow.token, input.resumeToken);
  return {
    currentSurface,
    currentPanel,
    reviewSurface,
    reviewPanel,
    returnRoute,
    correlationId,
    resumeToken,
    requestedMode: firstString(workflow.mode, workflow.handoffMode, input.workflowMode),
    suppressInlineAcceptance: workflow.suppressInlineAcceptance === true || client.suppressInlineAcceptance === true,
    handoffReason: firstString(workflow.handoffReason, input.handoffReason)
  };
}

function normalizeClientRuntimeState(input, request, client) {
  const runtime = objectValue(client.runtime, client.clientRuntime, input.clientRuntime, input.runtime);
  const capabilities = normalizeStringList(runtime.capabilities || client.capabilities || input.clientCapabilities);
  const capabilitySet = new Set(capabilities);
  const declaredRuntime = Object.keys(runtime).length > 0 || capabilities.length > 0;
  const statePathPrefix = firstString(
    runtime.statePathPrefix,
    runtime.stateRoot,
    client.statePathPrefix,
    request.statePathPrefix,
    'capabilitySecurity.externalWriteGuard'
  );
  const routePatchPath = firstString(
    runtime.routePatchPath,
    runtime.patchPath,
    client.routePatchPath,
    `${statePathPrefix}.routePatch`
  );
  const commandQueuePath = firstString(
    runtime.commandQueuePath,
    runtime.queuePath,
    client.commandQueuePath,
    `${statePathPrefix}.commands`
  );
  return {
    runtimeId: firstString(runtime.id, runtime.runtimeId, client.runtimeId),
    runtimeVersion: firstString(runtime.version, runtime.runtimeVersion, client.runtimeVersion),
    statePathPrefix,
    routePatchPath,
    commandQueuePath,
    capabilities,
    capabilityStrict: declaredRuntime,
    supportsRoutePatch: normalizeBoolean(
      runtime.supportsRoutePatch ?? client.supportsRoutePatch,
      !declaredRuntime || capabilitySet.has('external-write-guard.route-patch.apply') || capabilitySet.has('state.routePatch.apply')
    ),
    supportsCommandQueue: normalizeBoolean(
      runtime.supportsCommandQueue ?? client.supportsCommandQueue,
      !declaredRuntime || capabilitySet.has('external-write-guard.command.queue') || capabilitySet.has('commands.enqueue')
    ),
    supportsWorkflowHandoff: normalizeBoolean(
      runtime.supportsWorkflowHandoff ?? client.supportsWorkflowHandoff,
      !declaredRuntime || capabilitySet.has('external-write-guard.workflow.handoff') || capabilitySet.has('workflow.handoff')
    ),
    supportsInlineReview: normalizeBoolean(
      runtime.supportsInlineReview ?? client.supportsInlineReview,
      !declaredRuntime || capabilitySet.has('external-write-guard.inline-review') || capabilitySet.has('review.inline')
    ),
    requestedHandoffMode: firstString(runtime.handoffMode, runtime.mode, client.handoffMode, input.handoffMode),
    adoptionToken: firstString(runtime.adoptionToken, runtime.token, client.adoptionToken, input.clientRuntimeAdoptionToken)
  };
}

function buildWorkflowDestination(requestContext, action, visibleWriteIds, readiness, acceptance) {
  const profile = channelProfileFor(requestContext.channel);
  const workflow = requestContext.workflow;
  const runtime = requestContext.clientRuntime;
  const targetSurface = workflow.reviewSurface || profile.surface;
  const targetPanel = workflow.reviewPanel || profile.reviewPanel;
  const actionId = readiness.canCommit
    ? 'commit-guarded-writes'
    : acceptance.missingWriteIds.length
      ? 'accept-preview'
      : action === 'remediate-targets'
        ? 'remove-external-targets'
        : 'submit-proposed-writes';
  const resumeToken = workflow.resumeToken || [
    'external-write-guard',
    requestContext.requestId || requestContext.client.sessionId || requestContext.client.id || 'anonymous',
    targetSurface,
    targetPanel
  ].join(':');
  const routeParams = {
    surface: targetSurface,
    panel: targetPanel,
    action,
    actionId,
    requestId: requestContext.requestId,
    correlationId: workflow.correlationId,
    writeIds: visibleWriteIds
  };
  const canInlineAccept = profile.allowsInlineAcceptance
    && requestContext.isInteractive
    && !workflow.suppressInlineAcceptance
    && runtime.supportsInlineReview
    && acceptance.missingWriteIds.length > 0;
  const requiredRuntimeCapabilities = [
    'external-write-guard.route-patch.apply',
    ...(CLIENT_RUNTIME_CAPABILITY_REQUIREMENTS[actionId] || []),
    ...(canInlineAccept ? CLIENT_RUNTIME_CAPABILITY_REQUIREMENTS['accept-preview'] : [])
  ].filter((capability, index, all) => all.indexOf(capability) === index);
  const runtimeCapabilitySet = new Set(runtime.capabilities);
  const missingRuntimeCapabilities = runtime.capabilityStrict
    ? requiredRuntimeCapabilities.filter((capability) => !runtimeCapabilitySet.has(capability))
    : [];
  const canApplyRoutePatch = runtime.supportsRoutePatch && !missingRuntimeCapabilities.includes('external-write-guard.route-patch.apply');
  const canQueueCommand = runtime.supportsCommandQueue && (
    !runtime.capabilityStrict || (CLIENT_RUNTIME_CAPABILITY_REQUIREMENTS[actionId] || []).every((capability) => runtimeCapabilitySet.has(capability))
  );
  const runtimeHandoffMode = runtime.requestedHandoffMode || (
    canInlineAccept
      ? 'inline-acceptance'
      : canApplyRoutePatch && canQueueCommand
        ? 'runtime-command-queue'
        : runtime.supportsWorkflowHandoff
          ? 'workflow-handoff'
          : 'external-command'
  );
  return {
    surface: targetSurface,
    panel: targetPanel,
    mode: workflow.requestedMode || (requestContext.isInteractive ? 'interactive-review' : 'deferred-review'),
    commandTransport: profile.commandTransport,
    returnRoute: workflow.returnRoute,
    correlationId: workflow.correlationId,
    resumeToken,
    actionId,
    canInlineAccept,
    requiresUserVisibleHandoff: !readiness.canCommit || !requestContext.isInteractive,
    routeParams,
    runtimeAdoption: {
      runtimeId: runtime.runtimeId,
      runtimeVersion: runtime.runtimeVersion,
      mode: runtimeHandoffMode,
      statePathPrefix: runtime.statePathPrefix,
      routePatchPath: runtime.routePatchPath,
      commandQueuePath: runtime.commandQueuePath,
      requiredCapabilities: requiredRuntimeCapabilities,
      missingCapabilities: missingRuntimeCapabilities,
      canApplyRoutePatch,
      canQueueCommand,
      supportsWorkflowHandoff: runtime.supportsWorkflowHandoff,
      adoptionToken: runtime.adoptionToken,
      blockedReason: missingRuntimeCapabilities.length
        ? 'missing-client-runtime-capabilities'
        : !canApplyRoutePatch && !runtime.supportsWorkflowHandoff
          ? 'client-runtime-handoff-unsupported'
          : ''
    }
  };
}

function normalizePathBoundary(value) {
  const raw = normalizeUri(value).replace(/\\/g, '/');
  const windowsDriveMatch = raw.match(/^([a-z]):\//i);
  const isWindowsDrive = Boolean(windowsDriveMatch);
  const isUncPath = raw.startsWith('//') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const isPosixAbsolute = raw.startsWith('/') && !isUncPath;
  const withoutScheme = raw
    .replace(/^[a-z]:\//i, '/')
    .replace(/^file:\/\/+/i, '/')
    .replace(/^workspace:\/\/+/i, '/')
    .replace(/^workspace:/i, '')
    .replace(/^artifact:\/\/+/i, '/');
  const parts = [];
  let escapedAboveRoot = false;
  for (const segment of withoutScheme.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length) {
        parts.pop();
      } else {
        escapedAboveRoot = true;
      }
      continue;
    }
    parts.push(segment);
  }
  return {
    raw,
    path: `/${parts.join('/')}`,
    escapedAboveRoot,
    addressing: {
      absolute: isPosixAbsolute || isWindowsDrive || isUncPath || /^file:\/\//i.test(raw),
      hostAbsolute: isPosixAbsolute || isWindowsDrive || isUncPath,
      windowsDrive: windowsDriveMatch?.[1]?.toUpperCase() || '',
      unc: isUncPath,
      normalizedInput: withoutScheme
    }
  };
}

function pathIsWithinRoot(target, root) {
  if (!root.path || root.path === '/') return true;
  return target.path === root.path || target.path.startsWith(`${root.path}/`);
}

function normalizeWorkspaceRootMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([workspaceId, roots]) => [
        nonEmptyString(workspaceId),
        normalizeStringList(roots)
          .map(normalizePathBoundary)
          .filter((root) => root.path && !root.escapedAboveRoot)
      ])
      .filter(([workspaceId, roots]) => workspaceId && roots.length)
  );
}

function rootsForWorkspace(boundary, workspaceId) {
  const scopedRoots = boundary.workspaceRootMap[workspaceId] || [];
  return scopedRoots.length ? scopedRoots : boundary.workspaceRoots;
}

function isolationAppliesToTenant(boundary) {
  return boundary.isolationMode === 'tenant' || boundary.isolationMode === 'tenant-workspace';
}

function isolationAppliesToWorkspace(boundary) {
  return boundary.isolationMode === 'workspace' || boundary.isolationMode === 'tenant-workspace';
}

function normalizeScopedPermissionGrant(value, index, source = 'direct') {
  if (typeof value === 'string') {
    return {
      id: `${source}-grant-${index + 1}`,
      source,
      permissions: [value.trim()].filter(Boolean),
      tenantIds: [],
      workspaceIds: [],
      operations: [],
      schemes: [],
      rootPaths: []
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rootPaths = normalizeStringEntries(value.rootPaths || value.roots || value.workspaceRoots)
    .map(normalizePathBoundary)
    .filter((root) => root.path && !root.escapedAboveRoot)
    .map((root) => root.path);
  const permissions = normalizeStringEntries(value.permissions || value.permission || value.capabilities || value.capability);
  return {
    id: firstString(value.id, value.grantId, `${source}-grant-${index + 1}`),
    source: firstString(value.source, source),
    permissions,
    tenantIds: normalizeStringEntries(value.tenantIds || value.tenants || value.tenantId),
    workspaceIds: normalizeStringEntries(value.workspaceIds || value.workspaces || value.workspaceId),
    operations: normalizeStringEntries(value.operations || value.operation),
    schemes: normalizeStringEntries(value.schemes || value.scheme).map((scheme) => scheme.toLowerCase()),
    rootPaths
  };
}

function normalizeScopedPermissionGrants(value, source = 'direct') {
  const grants = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value]
      : typeof value === 'string'
        ? [value]
        : [];
  return grants
    .map((grant, index) => normalizeScopedPermissionGrant(grant, index, source))
    .filter((grant) => grant && grant.permissions.length);
}

function buildRoleScopedPermissionGrants(actorRoles, roleGrants) {
  if (!roleGrants || typeof roleGrants !== 'object' || Array.isArray(roleGrants)) return [];
  return actorRoles.flatMap((role) => normalizeScopedPermissionGrants(roleGrants[role], `role:${role}`));
}

function permissionTokenMatches(heldPermission, requiredPermission) {
  if (!requiredPermission) return true;
  if (heldPermission === requiredPermission) return true;
  if (heldPermission === '*') return true;
  if (heldPermission.endsWith(':*') && requiredPermission.startsWith(heldPermission.slice(0, -1))) return true;
  if (heldPermission.endsWith('.*') && requiredPermission.startsWith(heldPermission.slice(0, -1))) return true;
  return false;
}

function operationPermissionRequirements(write, boundary) {
  const explicit = normalizeStringEntries(
    boundary.operationPermissionMap[write.operation]
      || boundary.operationPermissionMap[`${write.scheme}:${write.operation}`]
      || boundary.operationPermissionMap.default
  );
  return explicit.length
    ? explicit
    : [write.operation === 'delete' ? 'workspace:delete' : 'workspace:write'];
}

function scopedGrantMatchesWrite(grant, write, requiredPermissions) {
  const tenantMatches = !grant.tenantIds.length || grant.tenantIds.includes('*') || grant.tenantIds.includes(write.tenantId);
  const workspaceMatches = !grant.workspaceIds.length || grant.workspaceIds.includes('*') || grant.workspaceIds.includes(write.workspaceId);
  const operationMatches = !grant.operations.length || grant.operations.includes('*') || grant.operations.includes(write.operation);
  const schemeMatches = !grant.schemes.length || grant.schemes.includes('*') || grant.schemes.includes(write.scheme);
  const rootMatches = !grant.rootPaths.length
    || !write.targetPath
    || grant.rootPaths.some((rootPath) => pathIsWithinRoot(write.targetPath, { path: rootPath }));
  const permissionMatches = requiredPermissions.every((requiredPermission) =>
    grant.permissions.some((permission) => permissionTokenMatches(permission, requiredPermission))
  );
  return tenantMatches && workspaceMatches && operationMatches && schemeMatches && rootMatches && permissionMatches;
}

function buildWritePermissionEvidence(write, boundary) {
  const requiredPermissions = operationPermissionRequirements(write, boundary);
  const globalPermissionMatches = requiredPermissions.filter((permission) =>
    boundary.actorPermissions.some((actorPermission) => permissionTokenMatches(actorPermission, permission))
  );
  const matchingGrants = boundary.scopedPermissionGrants
    .filter((grant) => scopedGrantMatchesWrite(grant, write, requiredPermissions))
    .map((grant) => ({
      id: grant.id,
      source: grant.source,
      permissions: grant.permissions,
      tenantIds: grant.tenantIds,
      workspaceIds: grant.workspaceIds,
      operations: grant.operations,
      schemes: grant.schemes,
      rootPaths: grant.rootPaths
    }));
  return {
    requiredPermissions,
    globalPermissionMatches,
    matchingScopedGrants: matchingGrants,
    scopedAuthorizationRequired: boundary.requireScopedWritePermissions,
    scopedAuthorizationSatisfied: !boundary.requireScopedWritePermissions || matchingGrants.length > 0 || globalPermissionMatches.length === requiredPermissions.length,
    mode: boundary.writePermissionMode
  };
}

function buildWriteScopeEvidence(write, boundary) {
  const roots = rootsForWorkspace(boundary, write.workspaceId);
  const matchingRoots = write.targetPath
    ? roots.filter((root) => pathIsWithinRoot(write.targetPath, root)).map((root) => root.path)
    : [];
  const targetAddressing = write.targetAddressing || buildTargetAddressingEvidence(write, roots, matchingRoots);
  return {
    tenantId: write.tenantId,
    workspaceId: write.workspaceId,
    declaredTenantId: write.declaredTenantId,
    declaredWorkspaceId: write.declaredWorkspaceId,
    tenantInheritedFromBoundary: !write.declaredTenantId && Boolean(write.tenantId && write.tenantId === boundary.tenantId),
    workspaceInheritedFromBoundary: !write.declaredWorkspaceId && Boolean(write.workspaceId && write.workspaceId === boundary.workspaceId),
    targetPath: write.targetPath?.path || '',
    escapedAboveRoot: write.targetPath?.escapedAboveRoot === true,
    requiredRootCount: roots.length,
    matchingRoots,
    matchedWorkspaceRoot: roots.length === 0 || matchingRoots.length > 0,
    targetAddressing,
    isolationMode: boundary.isolationMode,
    requiresDeclaredTenantId: boundary.requireDeclaredTenantId,
    requiresDeclaredWorkspaceId: boundary.requireDeclaredWorkspaceId
  };
}

function buildTargetAddressingEvidence(write, roots, matchingRoots) {
  const pathAddressing = write.targetPath?.addressing || {};
  const hasWorkspaceRootPolicy = roots.length > 0;
  const anchoredToWorkspaceRoot = matchingRoots.length > 0;
  const workspaceRelative = write.scheme === 'relative' || write.scheme === 'workspace';
  const fileUri = write.scheme === 'file';
  const hostAbsolute = pathAddressing.hostAbsolute === true;
  const fileUriAbsolute = fileUri && pathAddressing.absolute === true;
  const localTarget = ['file', 'workspace', 'relative'].includes(write.scheme);
  const anchorState = !localTarget
    ? 'not-local'
    : anchoredToWorkspaceRoot
      ? 'workspace-root'
      : workspaceRelative && !hostAbsolute
        ? 'workspace-relative'
        : hasWorkspaceRootPolicy
          ? 'outside-workspace-root'
          : fileUriAbsolute || hostAbsolute
            ? 'unanchored-host-absolute'
            : 'unanchored-local';
  const riskReasons = [
    ...(hostAbsolute && !anchoredToWorkspaceRoot ? ['host-absolute-path'] : []),
    ...(fileUriAbsolute && !anchoredToWorkspaceRoot ? ['file-uri-without-workspace-root'] : []),
    ...(pathAddressing.unc && !anchoredToWorkspaceRoot ? ['unc-path'] : []),
    ...(pathAddressing.windowsDrive && !anchoredToWorkspaceRoot ? ['windows-drive-path'] : []),
    ...(write.targetPath?.escapedAboveRoot ? ['path-traversal-above-root'] : []),
    ...(hasWorkspaceRootPolicy && localTarget && !anchoredToWorkspaceRoot ? ['workspace-root-miss'] : [])
  ];
  return {
    scheme: write.scheme,
    localTarget,
    workspaceRelative,
    fileUri,
    hostAbsolute,
    fileUriAbsolute,
    windowsDrive: pathAddressing.windowsDrive || '',
    unc: pathAddressing.unc === true,
    hasWorkspaceRootPolicy,
    anchoredToWorkspaceRoot,
    anchorState,
    riskReasons
  };
}

function normalizeWrite(write, index) {
  const uri = normalizeUri(write?.uri || write?.target || write?.path);
  const bytes = Number.isFinite(write?.bytes) && write.bytes >= 0 ? Math.trunc(write.bytes) : null;
  const declaredCapability = typeof write?.capability === 'string' ? write.capability.trim() : '';
  const boundary = write?.boundary && typeof write.boundary === 'object' ? write.boundary : {};
  const tenantId = firstString(write?.tenantId, write?.tenant, boundary.tenantId);
  const workspaceId = firstString(write?.workspaceId, write?.workspace, boundary.workspaceId);
  const reviewStage = WRITE_REVIEW_STAGES.includes(nonEmptyString(write?.reviewStage || write?.stage || write?.phase))
    ? nonEmptyString(write?.reviewStage || write?.stage || write?.phase)
    : 'draft';
  const draftFingerprint = firstString(
    write?.draftFingerprint,
    write?.contentFingerprint,
    write?.fingerprint,
    write?.checksum,
    write?.etag
  );
  const draftVersion = firstString(write?.draftVersion, write?.version, write?.revision);
  const draftPayload = stableStringify(
    write?.draft
      ?? write?.content
      ?? write?.patch
      ?? write?.body
      ?? write?.payload
      ?? ''
  );
  return {
    id: typeof write?.id === 'string' && write.id.trim() ? write.id.trim() : `write-${index + 1}`,
    uri,
    scheme: uri ? schemeFor(uri) : 'missing',
    operation: typeof write?.operation === 'string' && write.operation.trim() ? write.operation.trim() : 'write',
    bytes,
    capability: declaredCapability,
    reason: typeof write?.reason === 'string' ? write.reason.trim() : '',
    tenantId,
    declaredTenantId: tenantId,
    workspaceId,
    declaredWorkspaceId: workspaceId,
    reviewStage,
    draftVersion,
    draftFingerprint,
    draftPayloadFingerprint: draftPayload ? `payload:${draftPayload.length}:${draftPayload}` : ''
  };
}

function writeApprovalFingerprint(write) {
  return [
    'external-write-guard.approval.v1',
    write.id,
    write.reviewStage,
    write.operation,
    write.scheme,
    write.uri,
    write.bytes === null ? '' : write.bytes,
    write.capability,
    write.tenantId,
    write.workspaceId,
    write.targetPath?.path || '',
    write.draftVersion,
    write.draftFingerprint,
    write.draftPayloadFingerprint
  ].join('|');
}

function buildStateKey(requestContext) {
  return [
    'capabilitySecurity.externalWriteGuard',
    requestContext.route,
    requestContext.requestId || requestContext.client.sessionId || requestContext.client.id || 'anonymous'
  ].join(':');
}

function normalizePersistedState(input, requestContext) {
  const state = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state?.capabilitySecurity?.externalWriteGuard && typeof input.state.capabilitySecurity.externalWriteGuard === 'object'
      ? input.state.capabilitySecurity.externalWriteGuard
      : {};
  const stateKey = nonEmptyString(state.stateKey) || buildStateKey(requestContext);
  const previewWrites = toArray(state.previewWrites)
    .filter((write) => write && typeof write === 'object')
    .map(normalizeWrite);
  const acceptedWriteIds = normalizeStringList(state.acceptedWriteIds);
  const acceptedWriteAts = normalizeStringRecord(state.acceptedWriteAts || state.acceptanceTimestamps);
  const acceptedWriteFingerprints = normalizeStringRecord(state.acceptedWriteFingerprints || state.acceptanceFingerprints);
  const acceptedWriteApprovalProofs = normalizeApprovalProofRecordMap(
    state.acceptedWriteApprovalProofs
      || state.acceptanceApprovalProofs
      || state.approvalProofs
      || state.approvalBoundary?.proofsByWriteId
  );
  const appliedCommandIds = normalizeStringList(state.appliedCommandIds);
  const previousStatus = nonEmptyString(state.status) || 'new';
  const recoveredAt = nonEmptyString(state.recoveredAt);
  const updatedAt = normalizeIsoInstant(state.updatedAt || state.persistedAt);
  const lifecycleSettings = objectValue(state.lifecycleSettings);
  const analyticsHistory = normalizeHistorySnapshots(state.analyticsHistory || state.historySnapshots || state.reporting?.history);
  const commandLedger = normalizeCommandLedger(state.commandLedger || state.commands);
  const operationalHealth = objectValue(state.operationalHealth);
  const operationalHealthRetry = objectValue(operationalHealth.retry);
  const restartStatus = objectValue(state.restartStatus);
  const recoveryEnvelope = normalizeRecoveryEnvelope(state.recoveryEnvelope || state.recoveryCheckpoint || restartStatus.recoveryEnvelope);
  const previousRecoveryPlan = normalizeRecoveryPlan(state.recoveryPlan || restartStatus.recoveryPlan);
  return {
    version: Number.isInteger(state.version) && state.version > 0 ? state.version : PERSISTED_STATE_VERSION,
    stateKey,
    previousRevision: Number.isInteger(state.revision) && state.revision >= 0 ? state.revision : 0,
    previousStatus,
    recoveredAt,
    updatedAt,
    route: nonEmptyString(state.route),
    requestId: nonEmptyString(state.requestId),
    previewWrites,
    acceptedWriteIds,
    acceptedWriteAts,
    acceptedWriteFingerprints,
    acceptedWriteApprovalProofs,
    appliedCommandIds,
    commandLedger,
    previewFingerprint: nonEmptyString(state.previewFingerprint || restartStatus.previewFingerprint || recoveryEnvelope.previewFingerprint),
    recoveryEnvelope,
    previousRecoveryPlan,
    lifecycleSettings,
    analyticsHistory,
    operationalHealth: {
      status: nonEmptyString(operationalHealth.status),
      checkedAt: normalizeIsoInstant(operationalHealth.checkedAt),
      retryAttempt: normalizePositiveInteger(operationalHealthRetry.attempt ?? operationalHealth.retryAttempt, 0),
      retryExhausted: operationalHealthRetry.exhausted === true,
      nextRetryAt: normalizeIsoInstant(operationalHealthRetry.nextRetryAt)
    },
    hasRecoverablePreview: previewWrites.length > 0
  };
}

function normalizeGuardCommand(input) {
  const command = input.command && typeof input.command === 'object' ? input.command : {};
  const type = nonEmptyString(command.type || command.name || input.commandType);
  if (!type) return null;
  const id = nonEmptyString(command.id || command.commandId || input.commandId) || `${type}:${normalizeStringList(command.writeIds).join(',') || 'all'}`;
  const commitApprovalFingerprints = normalizeStringRecord(
    command.requiredApprovalFingerprints
      || command.commitApprovalFingerprints
      || command.acceptedWriteFingerprints
      || input.commandRequiredApprovalFingerprints
  );
  const approvalProofs = normalizeApprovalProofRecordMap(
    command.approvalProofs
      || command.acceptanceProofs
      || command.acceptedWriteApprovalProofs
      || input.commandApprovalProofs
  );
  const settings = objectValue(command.settings, command.lifecycleSettings, input.commandSettings);
  const schedule = objectValue(command.schedule, command.lifecycleSchedule, input.commandSchedule);
  return {
    id,
    type,
    writeIds: normalizeStringList(command.writeIds || input.commandWriteIds),
    acceptanceFingerprints: normalizeStringRecord(
      command.acceptanceFingerprints
        || command.acceptedWriteFingerprints
        || input.commandAcceptanceFingerprints
    ),
    commitApprovalFingerprints,
    approvalProofs,
    issuedAt: nonEmptyString(command.issuedAt || input.commandIssuedAt),
    settings,
    schedule,
    reason: firstString(command.reason, command.message, input.commandReason)
  };
}

function normalizeLifecycleSettings(input, persistedState, command, commandAlreadyApplied, now) {
  const requestedSettings = objectValue(
    input.lifecycleSettings,
    input.settings?.externalWriteGuard,
    input.policy?.lifecycle
  );
  const persistedSettings = objectValue(persistedState.lifecycleSettings);
  const base = { ...persistedSettings, ...requestedSettings };
  const commandCanMutate = command && !commandAlreadyApplied && LIFECYCLE_COMMAND_TYPES.includes(command.type);
  const commandSettings = commandCanMutate ? { ...command.settings, ...command.schedule } : {};
  const effective = { ...base, ...commandSettings };
  if (commandCanMutate && command.type === 'enable-guard') {
    effective.enabled = true;
    effective.mode = effective.mode === 'disabled' ? 'enforce' : effective.mode;
  }
  if (commandCanMutate && command.type === 'disable-guard') {
    effective.enabled = false;
    effective.mode = 'disabled';
    effective.pauseUntil = '';
    effective.deferCommitUntil = '';
    effective.scheduledResumeAt = '';
  }
  if (commandCanMutate && command.type === 'resume-guard') {
    effective.enabled = true;
    effective.pauseUntil = '';
    effective.deferCommitUntil = '';
    effective.scheduledResumeAt = '';
  }
  const mode = LIFECYCLE_MODES.includes(nonEmptyString(effective.mode))
    ? nonEmptyString(effective.mode)
    : normalizeBoolean(effective.enabled, true) === false
      ? 'disabled'
      : 'enforce';
  const enabled = mode !== 'disabled' && normalizeBoolean(effective.enabled, true) !== false;
  const pauseUntil = normalizeIsoInstant(effective.pauseUntil || effective.pausedUntil);
  const deferCommitUntil = normalizeIsoInstant(effective.deferCommitUntil || effective.commitAfter);
  const scheduledResumeAt = normalizeIsoInstant(effective.scheduledResumeAt || effective.resumeAt);
  const maxScheduleHorizonMs = normalizePositiveInteger(
    effective.maxScheduleHorizonMs ?? effective.scheduleMaxHorizonMs,
    DEFAULT_SCHEDULE_HORIZON_MS
  );
  const maxAcceptanceTtlMs = normalizePositiveInteger(
    effective.maxAcceptanceTtlMs ?? effective.acceptanceTtlMaxMs,
    DEFAULT_ACCEPTANCE_TTL_MAX_MS
  );
  const commandPayloadKeys = commandCanMutate
    ? Object.keys({ ...command.settings, ...command.schedule }).filter((key) => nonEmptyString(key))
    : [];
  const invalidInstants = [
    ['pauseUntil', effective.pauseUntil || effective.pausedUntil],
    ['deferCommitUntil', effective.deferCommitUntil || effective.commitAfter],
    ['scheduledResumeAt', effective.scheduledResumeAt || effective.resumeAt]
  ]
    .filter(([, value]) => nonEmptyString(value))
    .filter(([field, value]) => !normalizeIsoInstant(value))
    .map(([field]) => `invalid-${field}`);
  const rawAcceptanceTtlMs = effective.acceptanceTtlMs ?? effective.acceptanceTtl;
  const acceptanceTtlMs = Number.isFinite(rawAcceptanceTtlMs) && rawAcceptanceTtlMs >= 0
    ? Math.trunc(rawAcceptanceTtlMs)
    : null;
  const nowTimestamp = Date.parse(now);
  const scheduleInstants = [
    ['pauseUntil', pauseUntil],
    ['deferCommitUntil', deferCommitUntil],
    ['scheduledResumeAt', scheduledResumeAt]
  ].filter(([, value]) => value);
  const staleScheduleFields = scheduleInstants
    .filter(([, value]) => !instantIsFuture(value, now))
    .map(([field]) => `stale-${field}`);
  const scheduleHorizonErrors = Number.isFinite(nowTimestamp)
    ? scheduleInstants
      .filter(([, value]) => Date.parse(value) - nowTimestamp > maxScheduleHorizonMs)
      .map(([field]) => `schedule-horizon-exceeded:${field}`)
    : [];
  const scheduleCommandMissingWindow = commandCanMutate && command.type === 'schedule-guard' && !scheduleInstants.length
    ? ['schedule-command-missing-window']
    : [];
  const disabledWithActiveSchedule = normalizeBoolean(effective.enabled, true) === false
    && scheduleInstants.some(([, value]) => instantIsFuture(value, now))
    ? ['disabled-guard-cannot-hold-active-schedule']
    : [];
  const ttlValidationErrors = [
    ...(rawAcceptanceTtlMs !== undefined && acceptanceTtlMs === null ? ['invalid-acceptance-ttl-ms'] : []),
    ...(acceptanceTtlMs !== null && acceptanceTtlMs > maxAcceptanceTtlMs ? ['acceptance-ttl-exceeds-maximum'] : [])
  ];
  const validationErrors = [
    ...invalidInstants,
    ...staleScheduleFields,
    ...scheduleHorizonErrors,
    ...scheduleCommandMissingWindow,
    ...disabledWithActiveSchedule,
    ...ttlValidationErrors,
    ...(nonEmptyString(effective.mode) && !LIFECYCLE_MODES.includes(nonEmptyString(effective.mode)) ? ['invalid-lifecycle-mode'] : [])
  ];
  const paused = pauseUntil ? instantIsFuture(pauseUntil, now) : false;
  const commitDeferred = deferCommitUntil ? instantIsFuture(deferCommitUntil, now) : false;
  const scheduleState = !enabled
    ? 'disabled'
    : validationErrors.some((error) => error.includes('schedule') || error.includes('pauseUntil') || error.includes('deferCommitUntil') || error.includes('scheduledResumeAt'))
      ? 'invalid'
      : paused && commitDeferred
        ? 'paused-and-commit-deferred'
        : paused
          ? 'paused'
          : commitDeferred
            ? 'commit-deferred'
            : scheduledResumeAt && instantIsFuture(scheduledResumeAt, now)
              ? 'resume-scheduled'
              : 'open';
  const nextLifecycleAction = !enabled
    ? 'enable-guard'
    : validationErrors.length
      ? 'update-guard-settings'
      : paused || commitDeferred
        ? 'resume-guard'
        : 'none';
  const nextLifecycleActionReason = !enabled
    ? 'guard-disabled'
    : validationErrors.length
      ? validationErrors[0]
      : paused
        ? 'guard-paused'
        : commitDeferred
          ? 'commit-deferred-by-schedule'
          : '';
  return {
    version: 1,
    enabled,
    mode,
    enforcementActive: enabled && mode === 'enforce',
    monitorOnly: enabled && mode === 'monitor',
    paused,
    pauseUntil,
    commitDeferred,
    deferCommitUntil,
    scheduledResumeAt,
    scheduleReason: firstString(effective.scheduleReason, effective.reason, command?.reason),
    acceptanceTtlMs,
    maxAcceptanceTtlMs,
    maxScheduleHorizonMs,
    validationErrors,
    lastCommandType: commandCanMutate ? command.type : '',
    lastCommandId: commandCanMutate ? command.id : '',
    lastCommandPayloadKeys: commandPayloadKeys,
    scheduleState,
    nextLifecycleAction,
    nextLifecycleActionReason,
    commandPolicy: {
      supportedCommandTypes: LIFECYCLE_COMMAND_TYPES,
      mutatingCommandApplied: commandCanMutate,
      commandAlreadyApplied,
      scheduleCommandRequiresFutureWindow: true,
      disableClearsCommitEligibility: true,
      resumeClearsScheduleFields: true,
      acceptanceTtlUnit: 'milliseconds'
    }
  };
}

function lifecycleSnapshotFromRawSettings(rawSettings, now) {
  const settings = objectValue(rawSettings);
  const mode = LIFECYCLE_MODES.includes(nonEmptyString(settings.mode))
    ? nonEmptyString(settings.mode)
    : normalizeBoolean(settings.enabled, true) === false
      ? 'disabled'
      : 'enforce';
  const enabled = mode !== 'disabled' && normalizeBoolean(settings.enabled, true) !== false;
  const pauseUntil = normalizeIsoInstant(settings.pauseUntil || settings.pausedUntil);
  const deferCommitUntil = normalizeIsoInstant(settings.deferCommitUntil || settings.commitAfter);
  const scheduledResumeAt = normalizeIsoInstant(settings.scheduledResumeAt || settings.resumeAt);
  return {
    enabled,
    mode,
    paused: pauseUntil ? instantIsFuture(pauseUntil, now) : false,
    commitDeferred: deferCommitUntil ? instantIsFuture(deferCommitUntil, now) : false,
    resumeScheduled: scheduledResumeAt ? instantIsFuture(scheduledResumeAt, now) : false,
    pauseUntil,
    deferCommitUntil,
    scheduledResumeAt
  };
}

function lifecycleCommandPayloadSummary(command) {
  if (!command || !LIFECYCLE_COMMAND_TYPES.includes(command.type)) {
    return {
      settingsKeys: [],
      scheduleKeys: [],
      hasSettings: false,
      hasSchedule: false
    };
  }
  const settingsKeys = Object.keys(command.settings || {}).filter((key) => nonEmptyString(key));
  const scheduleKeys = Object.keys(command.schedule || {}).filter((key) => nonEmptyString(key));
  return {
    settingsKeys,
    scheduleKeys,
    hasSettings: settingsKeys.length > 0,
    hasSchedule: scheduleKeys.length > 0
  };
}

function buildLifecycleCommandBoundary(command, persistedState, lifecycleSettings, commandAlreadyApplied, now) {
  if (!command || !LIFECYCLE_COMMAND_TYPES.includes(command.type)) {
    return {
      checked: false,
      ok: true,
      rejectedReason: ''
    };
  }
  const previous = lifecycleSnapshotFromRawSettings(persistedState.lifecycleSettings, now);
  const payload = lifecycleCommandPayloadSummary(command);
  const lifecycleValidationErrors = lifecycleSettings.validationErrors || [];
  const commandValidationErrors = lifecycleValidationErrors.filter((error) =>
    error.startsWith('invalid-')
    || error.startsWith('stale-')
    || error.includes('schedule')
    || error.includes('ttl')
    || error === 'disabled-guard-cannot-hold-active-schedule'
  );
  const noActiveSchedule = !previous.paused && !previous.commitDeferred && !previous.resumeScheduled;
  const transitionErrors = [
    ...(command.type === 'enable-guard' && previous.enabled ? ['enable-command-guard-already-enabled'] : []),
    ...(command.type === 'disable-guard' && !previous.enabled ? ['disable-command-guard-already-disabled'] : []),
    ...(command.type === 'disable-guard' && !command.reason ? ['disable-command-requires-reason'] : []),
    ...(command.type === 'resume-guard' && noActiveSchedule ? ['resume-command-requires-active-schedule'] : []),
    ...(command.type === 'schedule-guard' && !previous.enabled ? ['schedule-command-requires-enabled-guard'] : []),
    ...(command.type === 'schedule-guard' && !payload.hasSchedule ? ['schedule-command-requires-schedule-payload'] : []),
    ...(command.type === 'update-guard-settings' && !payload.hasSettings ? ['settings-command-requires-settings-payload'] : []),
    ...(command.type === 'update-guard-settings' && payload.scheduleKeys.length ? ['settings-command-must-not-carry-schedule-payload'] : [])
  ];
  const blockers = [
    ...(commandAlreadyApplied ? ['lifecycle-command-idempotent-replay'] : []),
    ...transitionErrors,
    ...commandValidationErrors
  ].filter((reason, index, all) => reason && all.indexOf(reason) === index);
  const nextAction = blockers.length
    ? blockers.includes('disable-command-requires-reason')
      ? 'disable-guard'
      : blockers.includes('schedule-command-requires-enabled-guard')
        ? 'enable-guard'
        : blockers.includes('resume-command-requires-active-schedule')
          ? 'schedule-guard'
          : blockers.some((reason) => reason.includes('settings') || reason.includes('ttl') || reason.startsWith('invalid-'))
            ? 'update-guard-settings'
            : lifecycleSettings.nextLifecycleAction || 'update-guard-settings'
    : lifecycleSettings.nextLifecycleAction;
  return {
    checked: true,
    ok: blockers.length === 0,
    rejectedReason: blockers[0] || '',
    commandType: command.type,
    commandId: command.id,
    payload,
    previous,
    requested: {
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      paused: lifecycleSettings.paused,
      commitDeferred: lifecycleSettings.commitDeferred,
      scheduleState: lifecycleSettings.scheduleState,
      pauseUntil: lifecycleSettings.pauseUntil,
      deferCommitUntil: lifecycleSettings.deferCommitUntil,
      scheduledResumeAt: lifecycleSettings.scheduledResumeAt
    },
    transitionErrors,
    validationErrors: commandValidationErrors,
    blockers,
    nextAction,
    nextActionReason: blockers[0] || lifecycleSettings.nextLifecycleActionReason || ''
  };
}

function decisionForWrite(write, policy) {
  if (!write.uri) {
    return { decision: 'blocked', severity: 'error', reason: 'missing-target-uri' };
  }
  if (policy.blockedSchemes.includes(write.scheme)) {
    return { decision: 'blocked', severity: 'error', reason: `external-scheme:${write.scheme}` };
  }
  if (!policy.allowedSchemes.includes(write.scheme) && write.scheme !== 'relative') {
    return { decision: 'review', severity: 'warning', reason: `unrecognized-scheme:${write.scheme}` };
  }
  if (policy.requireCapability && !write.capability) {
    return { decision: 'review', severity: 'warning', reason: 'missing-write-capability' };
  }
  if (policy.maxBytes !== null && write.bytes !== null && write.bytes > policy.maxBytes) {
    return { decision: 'review', severity: 'warning', reason: 'write-size-over-policy' };
  }
  return { decision: 'allowed', severity: 'info', reason: 'inside-declared-write-boundary' };
}

function buildPolicy(input) {
  const policy = input.policy && typeof input.policy === 'object' ? input.policy : {};
  const allowedSchemes = toArray(policy.allowedSchemes).map(String).map((value) => value.toLowerCase());
  const blockedSchemes = toArray(policy.blockedSchemes).map(String).map((value) => value.toLowerCase());
  const maxBytes = Number.isFinite(policy.maxBytes) && policy.maxBytes >= 0 ? Math.trunc(policy.maxBytes) : null;
  return {
    allowedSchemes: allowedSchemes.length ? allowedSchemes : DEFAULT_ALLOWED_SCHEMES,
    blockedSchemes: blockedSchemes.length ? blockedSchemes : DEFAULT_BLOCKED_SCHEMES,
    requireCapability: policy.requireCapability !== false,
    requireUserAcceptance: policy.requireUserAcceptance !== false,
    requireExplicitApproval: policy.requireExplicitApproval !== false,
    requireSendStageForCommit: policy.requireSendStageForCommit !== false,
    requireApprovalScopeBinding: policy.requireApprovalScopeBinding !== false,
    enforceActorPermissions: policy.enforceActorPermissions === true,
    requireProviderContract: policy.requireProviderContract === true,
    requireAnchoredLocalTargets: policy.requireAnchoredLocalTargets !== false,
    allowUnscopedAbsoluteFileTargets: policy.allowUnscopedAbsoluteFileTargets === true,
    providerRequiredCapabilities: normalizeStringList(policy.providerRequiredCapabilities || input.providerRequiredCapabilities),
    maxBytes
  };
}

function buildRequestContext(input) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const client = input.client && typeof input.client === 'object' ? input.client : {};
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const route = nonEmptyString(request.route) || nonEmptyString(input.route) || 'capability-security/external-write-guard';
  const requestId = nonEmptyString(request.id) || nonEmptyString(request.requestId) || nonEmptyString(input.requestId) || nonEmptyString(input.traceId);
  const clientId = nonEmptyString(client.id) || nonEmptyString(client.clientId) || nonEmptyString(input.clientId);
  const sessionId = nonEmptyString(client.sessionId) || nonEmptyString(request.sessionId) || nonEmptyString(input.sessionId);
  const actorId = nonEmptyString(actor.id) || nonEmptyString(actor.userId) || nonEmptyString(input.actorId);
  const tenantId = firstString(request.tenantId, input.tenantId, client.tenantId, actor.tenantId);
  const workspaceId = firstString(request.workspaceId, input.workspaceId, client.workspaceId, actor.workspaceId);
  const scopes = normalizeStringList(request.scopes || input.scopes);
  const channel = nonEmptyString(client.channel) || nonEmptyString(input.channel) || DEFAULT_CLIENT_CHANNEL;
  const workflow = normalizeWorkflowState(input, request, client, route, requestId);
  const clientRuntime = normalizeClientRuntimeState(input, request, client);
  return {
    requestId,
    route,
    channel,
    tenantId,
    workspaceId,
    client: {
      id: clientId,
      sessionId,
      tenantId: firstString(client.tenantId, tenantId),
      workspaceId: firstString(client.workspaceId, workspaceId),
      displayName: nonEmptyString(client.displayName) || nonEmptyString(client.name)
    },
    actor: {
      id: actorId,
      tenantId: firstString(actor.tenantId, tenantId),
      workspaceId: firstString(actor.workspaceId, workspaceId),
      displayName: nonEmptyString(actor.displayName) || nonEmptyString(actor.name)
    },
    scopes,
    workflow,
    clientRuntime,
    isInteractive: client.interactive !== false && input.interactive !== false
  };
}

function permissionsForRoles(roles, rolePermissions) {
  const permissions = new Set();
  for (const role of roles) {
    for (const permission of normalizeStringList(rolePermissions[role])) {
      permissions.add(permission);
    }
  }
  return permissions;
}

function buildSecurityBoundary(input, policy, requestContext) {
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const rawBoundary = input.boundary && typeof input.boundary === 'object' ? input.boundary : {};
  const policyBoundary = input.policy?.boundary && typeof input.policy.boundary === 'object' ? input.policy.boundary : {};
  const boundary = { ...policyBoundary, ...rawBoundary };
  const rolePermissions = {
    admin: ['external-write:commit', 'capability-security.external-write.commit', 'workspace:write'],
    maintainer: ['external-write:commit', 'workspace:write'],
    writer: ['workspace:write'],
    ...(boundary.rolePermissions && typeof boundary.rolePermissions === 'object' ? boundary.rolePermissions : {})
  };
  const actorRoles = normalizeStringList(actor.roles || input.roles);
  const directPermissions = normalizeStringList(actor.permissions || input.permissions);
  const scopedPermissions = normalizeStringList(request.permissions || requestContext.scopes);
  const roleGrantedPermissions = permissionsForRoles(actorRoles, rolePermissions);
  const effectivePermissions = new Set([...directPermissions, ...scopedPermissions, ...roleGrantedPermissions]);
  const requiredPermissions = normalizeStringList(boundary.requiredPermissions || input.policy?.requiredPermissions || input.requiredPermissions);
  const directScopedGrants = normalizeScopedPermissionGrants(
    actor.permissionGrants
      || actor.scopedPermissions
      || input.permissionGrants
      || input.scopedPermissions,
    'actor'
  );
  const requestScopedGrants = normalizeScopedPermissionGrants(
    request.permissionGrants
      || request.scopedPermissions
      || boundary.permissionGrants
      || boundary.scopedPermissions,
    'request'
  );
  const roleScopedGrants = buildRoleScopedPermissionGrants(actorRoles, boundary.roleGrants || boundary.rolePermissionGrants);
  const operationPermissionMap = objectValue(
    boundary.operationPermissionMap,
    boundary.writeOperationPermissions,
    input.policy?.operationPermissionMap
  );
  const writePermissionMode = ['global', 'scoped', 'hybrid'].includes(nonEmptyString(boundary.writePermissionMode || input.writePermissionMode))
    ? nonEmptyString(boundary.writePermissionMode || input.writePermissionMode)
    : 'hybrid';
  const requireScopedWritePermissions = boundary.requireScopedWritePermissions === true
    || boundary.requireScopedPermissionGrants === true
    || writePermissionMode === 'scoped';
  const allowedTenantIds = normalizeStringList(boundary.allowedTenantIds || input.allowedTenantIds);
  const allowedWorkspaceIds = normalizeStringList(boundary.allowedWorkspaceIds || input.allowedWorkspaceIds);
  const workspaceRoots = normalizeStringList(boundary.workspaceRoots || input.workspaceRoots || request.workspaceRoots)
    .map(normalizePathBoundary)
    .filter((root) => root.path && !root.escapedAboveRoot);
  const workspaceRootMap = normalizeWorkspaceRootMap(
    boundary.workspaceRootMap
      || boundary.workspaceRootsByWorkspace
      || input.workspaceRootMap
      || request.workspaceRootMap
  );
  const isolationMode = ['tenant', 'workspace', 'tenant-workspace', 'advisory'].includes(nonEmptyString(boundary.isolationMode || input.isolationMode))
    ? nonEmptyString(boundary.isolationMode || input.isolationMode)
    : 'tenant-workspace';
  const enforceActorPermissions = policy.enforceActorPermissions || boundary.enforceActorPermissions === true || requiredPermissions.length > 0;
  const missingPermissions = enforceActorPermissions
    ? requiredPermissions.filter((permission) => !effectivePermissions.has(permission))
    : [];
  return {
    tenantId: firstString(boundary.tenantId, requestContext.tenantId),
    workspaceId: firstString(boundary.workspaceId, requestContext.workspaceId),
    allowedTenantIds,
    allowedWorkspaceIds,
    workspaceRoots,
    workspaceRootMap,
    isolationMode,
    requireDeclaredTenantId: boundary.requireDeclaredTenantId === true || boundary.requireExplicitTenantId === true,
    requireDeclaredWorkspaceId: boundary.requireDeclaredWorkspaceId === true || boundary.requireExplicitWorkspaceId === true,
    requireAnchoredLocalTargets: policy.requireAnchoredLocalTargets && boundary.requireAnchoredLocalTargets !== false,
    allowUnscopedAbsoluteFileTargets: policy.allowUnscopedAbsoluteFileTargets || boundary.allowUnscopedAbsoluteFileTargets === true,
    actorRoles,
    actorPermissions: [...effectivePermissions],
    requiredPermissions,
    scopedPermissionGrants: [...directScopedGrants, ...requestScopedGrants, ...roleScopedGrants],
    operationPermissionMap,
    writePermissionMode,
    requireScopedWritePermissions,
    enforceActorPermissions,
    missingPermissions
  };
}

function applyHostedBoundary(write, boundary) {
  const scopedWrite = {
    ...write,
    tenantId: write.tenantId || boundary.tenantId,
    workspaceId: write.workspaceId || boundary.workspaceId,
    targetPath: ['file', 'workspace', 'relative'].includes(write.scheme)
      ? normalizePathBoundary(write.uri)
      : null
  };
  return {
    ...scopedWrite,
    scopeEvidence: buildWriteScopeEvidence(scopedWrite, boundary),
    permissionEvidence: buildWritePermissionEvidence(scopedWrite, boundary)
  };
}

function boundaryDecisionForWrite(write, boundary) {
  if (boundary.missingPermissions.length) {
    return { decision: 'blocked', severity: 'error', reason: 'missing-required-permissions' };
  }
  if (boundary.requireDeclaredTenantId && !write.declaredTenantId) {
    return { decision: 'blocked', severity: 'error', reason: 'missing-declared-tenant-id' };
  }
  if (boundary.requireDeclaredWorkspaceId && !write.declaredWorkspaceId) {
    return { decision: 'blocked', severity: 'error', reason: 'missing-declared-workspace-id' };
  }
  if (write.declaredTenantId && boundary.tenantId && write.declaredTenantId !== boundary.tenantId && isolationAppliesToTenant(boundary)) {
    return { decision: 'blocked', severity: 'error', reason: 'cross-tenant-write-target' };
  }
  if (write.declaredWorkspaceId && boundary.workspaceId && write.declaredWorkspaceId !== boundary.workspaceId && isolationAppliesToWorkspace(boundary)) {
    return { decision: 'blocked', severity: 'error', reason: 'cross-workspace-write-target' };
  }
  if (boundary.isolationMode === 'advisory' && write.declaredTenantId && boundary.tenantId && write.declaredTenantId !== boundary.tenantId) {
    return { decision: 'review', severity: 'warning', reason: 'advisory-cross-tenant-write-target' };
  }
  if (boundary.isolationMode === 'advisory' && write.declaredWorkspaceId && boundary.workspaceId && write.declaredWorkspaceId !== boundary.workspaceId) {
    return { decision: 'review', severity: 'warning', reason: 'advisory-cross-workspace-write-target' };
  }
  if (boundary.allowedTenantIds.length && !write.tenantId) {
    return { decision: 'blocked', severity: 'error', reason: 'tenant-context-missing' };
  }
  if (boundary.allowedWorkspaceIds.length && !write.workspaceId) {
    return { decision: 'blocked', severity: 'error', reason: 'workspace-context-missing' };
  }
  if (boundary.allowedTenantIds.length && write.tenantId && !boundary.allowedTenantIds.includes(write.tenantId)) {
    return { decision: 'blocked', severity: 'error', reason: 'tenant-not-in-boundary' };
  }
  if (boundary.allowedWorkspaceIds.length && write.workspaceId && !boundary.allowedWorkspaceIds.includes(write.workspaceId)) {
    return { decision: 'blocked', severity: 'error', reason: 'workspace-not-in-boundary' };
  }
  if (write.targetPath?.escapedAboveRoot) {
    return { decision: 'blocked', severity: 'error', reason: 'path-escapes-workspace-root' };
  }
  const addressing = write.scopeEvidence?.targetAddressing;
  if (
    boundary.requireAnchoredLocalTargets
    && addressing?.anchorState === 'unanchored-host-absolute'
    && !boundary.allowUnscopedAbsoluteFileTargets
  ) {
    return { decision: 'blocked', severity: 'error', reason: 'unanchored-host-absolute-write-target' };
  }
  const applicableRoots = rootsForWorkspace(boundary, write.workspaceId);
  if (applicableRoots.length && write.targetPath && !applicableRoots.some((root) => pathIsWithinRoot(write.targetPath, root))) {
    return { decision: 'blocked', severity: 'error', reason: 'target-outside-workspace-roots' };
  }
  if (boundary.enforceActorPermissions && !write.permissionEvidence?.scopedAuthorizationSatisfied) {
    return { decision: 'blocked', severity: 'error', reason: 'missing-scoped-write-permission' };
  }
  return null;
}

function buildPreviewWrites(input, policy, persistedState, boundary) {
  const proposedWrites = toArray(input.proposedWrites);
  const sourceWrites = proposedWrites.length ? proposedWrites : persistedState.previewWrites;
  return sourceWrites
    .filter((write) => write && typeof write === 'object')
    .map(normalizeWrite)
    .map((write) => applyHostedBoundary(write, boundary))
    .map((write) => ({ ...write, ...(boundaryDecisionForWrite(write, boundary) || decisionForWrite(write, policy)) }));
}

function buildDataContract(previewWrites, validationSummary, policy, requestContext, persistedState, boundary, providerContract, lifecycleSettings, analyticsReport, restartStatus, operationalHealth, commandStatus = {}) {
  const reviewedWriteIds = previewWrites
    .filter((write) => write.decision !== 'allowed')
    .map((write) => write.id);
  const blockedSchemes = [...new Set(previewWrites.filter((write) => write.decision === 'blocked').map((write) => write.scheme))];
  return {
    version: 1,
    name: 'external-write-guard.review',
    route: requestContext.route,
    requiredFields: ['proposedWrites[].uri', 'proposedWrites[].operation'],
    optionalFields: ['proposedWrites[].bytes', 'proposedWrites[].capability', 'proposedWrites[].draftFingerprint', 'proposedWrites[].reviewStage', 'acceptedWriteIds[]', 'acceptedWriteAts{}', 'acceptedWriteFingerprints{}', 'command.acceptanceFingerprints{}'],
    stateKeys: {
      root: persistedState.stateKey,
      previewWrites: 'capabilitySecurity.externalWriteGuard.preview.writes',
      acceptance: 'capabilitySecurity.externalWriteGuard.acceptance',
      acceptanceTimestamps: 'capabilitySecurity.externalWriteGuard.acceptance.acceptedWriteAts',
      acceptanceFingerprints: 'capabilitySecurity.externalWriteGuard.acceptance.acceptedWriteFingerprints',
      acceptanceApprovalProofs: 'capabilitySecurity.externalWriteGuard.acceptance.acceptedWriteApprovalProofs',
      acceptanceExpiry: 'capabilitySecurity.externalWriteGuard.acceptance.expiresAtByWriteId',
      staleAcceptance: 'capabilitySecurity.externalWriteGuard.acceptance.staleAcceptedWriteIds',
      approvalProofMissing: 'capabilitySecurity.externalWriteGuard.acceptance.approvalProofMissingWriteIds',
      approvalProofIntentMismatch: 'capabilitySecurity.externalWriteGuard.acceptance.approvalProofIntentMismatchWriteIds',
      approvalProofStageMismatch: 'capabilitySecurity.externalWriteGuard.acceptance.approvalProofStageMismatchWriteIds',
      approvalProofFingerprintMismatch: 'capabilitySecurity.externalWriteGuard.acceptance.approvalProofFingerprintMismatchWriteIds',
      approvalProofScopeMismatch: 'capabilitySecurity.externalWriteGuard.acceptance.approvalProofScopeMismatchWriteIds',
      approvalBoundarySummary: 'capabilitySecurity.externalWriteGuard.acceptance.approvalBoundarySummary',
      approvalPhaseByWriteId: 'capabilitySecurity.externalWriteGuard.acceptance.approvalBoundarySummary.byWriteId',
      commitIntentBoundary: 'capabilitySecurity.externalWriteGuard.acceptance.approvalBoundarySummary.commitIntentBoundary',
      readiness: 'capabilitySecurity.externalWriteGuard.readiness',
      clientReviewPacket: 'capabilitySecurity.externalWriteGuard.clientReviewPacket',
      previewAcceptanceContract: 'capabilitySecurity.externalWriteGuard.clientReviewPacket.previewAcceptanceContract',
      previewAcceptanceRows: 'capabilitySecurity.externalWriteGuard.clientReviewPacket.previewAcceptanceContract.rows',
      previewAcceptanceCommands: 'capabilitySecurity.externalWriteGuard.clientReviewPacket.previewAcceptanceContract.commandContracts',
      readinessChecklist: 'capabilitySecurity.externalWriteGuard.clientReviewPacket.readinessChecklist',
      nextStepContracts: 'capabilitySecurity.externalWriteGuard.clientReviewPacket.nextStepContracts',
      appliedCommands: 'capabilitySecurity.externalWriteGuard.appliedCommandIds',
      recoveryEnvelope: 'capabilitySecurity.externalWriteGuard.recoveryEnvelope',
      recoveryToken: 'capabilitySecurity.externalWriteGuard.recoveryEnvelope.recoveryToken',
      replayToken: 'capabilitySecurity.externalWriteGuard.recoveryEnvelope.replayToken',
      recoveryPlan: 'capabilitySecurity.externalWriteGuard.recoveryPlan',
      recoveryPlanNextCommand: 'capabilitySecurity.externalWriteGuard.recoveryPlan.nextCommand',
      recoveryPlanReplayResult: 'capabilitySecurity.externalWriteGuard.recoveryPlan.replayedCommandResult',
      providerSync: 'capabilitySecurity.externalWriteGuard.providerSync',
      externalHandoff: 'capabilitySecurity.externalWriteGuard.externalHandoff',
      lifecycleSettings: 'capabilitySecurity.externalWriteGuard.lifecycleSettings',
      lifecycleControls: 'capabilitySecurity.externalWriteGuard.lifecycleControls',
      boundaryScope: 'capabilitySecurity.externalWriteGuard.boundary.scope',
      boundaryScopeEvidence: 'capabilitySecurity.externalWriteGuard.boundary.scopeEvidenceByWriteId',
      boundaryPermissionEvidence: 'capabilitySecurity.externalWriteGuard.boundary.permissionEvidenceByWriteId',
      analyticsHistory: 'capabilitySecurity.externalWriteGuard.analytics.history',
      analyticsCounters: 'capabilitySecurity.externalWriteGuard.analytics.counters',
      exportSummary: 'capabilitySecurity.externalWriteGuard.analytics.exportSummary',
      exportRows: 'capabilitySecurity.externalWriteGuard.analytics.exportRows',
      exportManifest: 'capabilitySecurity.externalWriteGuard.analytics.exportManifest',
      timelineReport: 'capabilitySecurity.externalWriteGuard.analytics.timeline',
      operationalHealth: 'capabilitySecurity.externalWriteGuard.operationalHealth',
      actionableErrors: 'capabilitySecurity.externalWriteGuard.operationalHealth.actionableErrors',
      clientRuntimeAdoption: 'capabilitySecurity.externalWriteGuard.clientRuntimeAdoption',
      clientRuntimeRoutePatch: 'capabilitySecurity.externalWriteGuard.clientRuntimeAdoption.routePatch',
      clientRuntimeCommandQueue: 'capabilitySecurity.externalWriteGuard.clientRuntimeAdoption.commandQueue',
      clientRuntimeCommandPolicy: 'capabilitySecurity.externalWriteGuard.clientRuntimeAdoption.commandPolicy',
      clientRuntimeHandoffFallback: 'capabilitySecurity.externalWriteGuard.clientRuntimeAdoption.handoffFallback'
    },
    policySnapshot: {
      allowedSchemes: policy.allowedSchemes,
      blockedSchemes: policy.blockedSchemes,
      requireCapability: policy.requireCapability,
      requireUserAcceptance: policy.requireUserAcceptance,
      requireExplicitApproval: policy.requireExplicitApproval,
      requireSendStageForCommit: policy.requireSendStageForCommit,
      requireApprovalScopeBinding: policy.requireApprovalScopeBinding,
      enforceActorPermissions: policy.enforceActorPermissions,
      requireProviderContract: policy.requireProviderContract,
      requireAnchoredLocalTargets: policy.requireAnchoredLocalTargets,
      allowUnscopedAbsoluteFileTargets: policy.allowUnscopedAbsoluteFileTargets,
      providerRequiredCapabilities: providerContract.requiredCapabilities,
      maxBytes: policy.maxBytes,
      lifecycleMode: lifecycleSettings.mode,
      lifecycleEnabled: lifecycleSettings.enabled
    },
    operationalHealthSnapshot: {
      status: operationalHealth.status,
      commitAllowed: operationalHealth.commitAllowed,
      failureReasons: operationalHealth.failureReasons,
      degradedReasons: operationalHealth.degradedReasons,
      observedHealth: operationalHealth.observedHealth,
      retryable: operationalHealth.retry.retryable,
      retryAttempt: operationalHealth.retry.attempt,
      retryMaxAttempts: operationalHealth.retry.maxAttempts,
      nextRetryAt: operationalHealth.retry.nextRetryAt,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
    },
    clientRuntimeSnapshot: {
      runtimeId: requestContext.clientRuntime.runtimeId,
      runtimeVersion: requestContext.clientRuntime.runtimeVersion,
      statePathPrefix: requestContext.clientRuntime.statePathPrefix,
      routePatchPath: requestContext.clientRuntime.routePatchPath,
      commandQueuePath: requestContext.clientRuntime.commandQueuePath,
      supportsRoutePatch: requestContext.clientRuntime.supportsRoutePatch,
      supportsCommandQueue: requestContext.clientRuntime.supportsCommandQueue,
      supportsWorkflowHandoff: requestContext.clientRuntime.supportsWorkflowHandoff,
      supportsInlineReview: requestContext.clientRuntime.supportsInlineReview,
      declaredCapabilities: requestContext.clientRuntime.capabilities
    },
    acceptanceSnapshot: {
      ttlMs: lifecycleSettings.acceptanceTtlMs,
      timestampField: 'acceptedWriteAts',
      fingerprintField: 'acceptedWriteFingerprints',
      currentFingerprintField: 'currentWriteFingerprints',
      approvalBoundaryField: 'approvalBoundary',
      approvalProofField: 'acceptedWriteApprovalProofs',
      commandApprovalProofsField: 'command.approvalProofs',
      commandApprovalProofField: 'command.requiredApprovalFingerprints',
      staleField: 'staleAcceptedWriteIds',
      explicitApprovalMissingField: 'explicitApprovalMissingWriteIds',
      approvalProofMissingField: 'approvalProofMissingWriteIds',
      approvalProofIntentMismatchField: 'approvalProofIntentMismatchWriteIds',
      approvalProofStageMismatchField: 'approvalProofStageMismatchWriteIds',
      approvalProofFingerprintMismatchField: 'approvalProofFingerprintMismatchWriteIds',
      approvalProofScopeMismatchField: 'approvalProofScopeMismatchWriteIds',
      approvalScopeBindingField: 'approvalBoundarySummary.scopeBindingBoundary',
      approvalBoundarySummaryField: 'approvalBoundarySummary',
      approvalPhaseByWriteIdField: 'approvalBoundarySummary.byWriteId',
      acceptedApprovalIntents: ACCEPTANCE_APPROVAL_INTENTS,
      commitApprovalIntents: COMMIT_APPROVAL_INTENTS,
      draftStageField: 'draftStageWriteIds',
      sendStageField: 'sendStageWriteIds',
      commitStageField: 'commitStageWriteIds',
      expiryField: 'expiresAtByWriteId',
      expiredWriteIdsField: 'expiredWriteIds'
    },
    providerSnapshot: {
      providerId: providerContract.providerId,
      service: providerContract.service,
      contractVersion: providerContract.contractVersion,
      required: providerContract.required,
      ready: providerContract.ready,
      supportedCapabilities: providerContract.supportedCapabilities,
      missingCapabilities: providerContract.missingCapabilities,
      syncKey: providerContract.sync.syncKey,
      handoffState: providerContract.handoff.state,
      handoffManifestId: providerContract.handoff.manifest.manifestId,
      handoffManifestState: providerContract.handoff.manifest.state,
      handoffBlockedWriteIds: providerContract.handoff.manifest.blockedWriteIds,
      serviceContract: {
        syncDomain: providerContract.serviceContract.syncDomain,
        supportedOperations: providerContract.serviceContract.supportedOperations,
        supportedSchemes: providerContract.serviceContract.supportedSchemes,
        maxBatchWrites: providerContract.serviceContract.maxBatchWrites,
        maxBytesPerWrite: providerContract.serviceContract.maxBytesPerWrite,
        violations: providerContract.serviceContract.violations,
        externalAckRequired: providerContract.serviceContract.externalAck.required,
        externalAckState: providerContract.serviceContract.externalAck.state,
        dispatchBoundaryState: providerContract.serviceContract.dispatchBoundary.state,
        dispatchRequiredReviewStage: providerContract.serviceContract.dispatchBoundary.requiredReviewStage,
        dispatchBlockedWriteIds: providerContract.serviceContract.dispatchBoundary.blockedWriteIds,
        dispatchReadyWriteIds: providerContract.serviceContract.dispatchBoundary.handoffReadyWriteIds,
        enforceWriteCapabilities: providerContract.serviceContract.capabilityNegotiation.enforceWriteCapabilities,
        missingWriteCapabilityIds: providerContract.serviceContract.capabilityNegotiation.missingWriteCapabilityIds,
        providerSyncRequired: providerContract.serviceContract.providerSync.required,
        providerSyncAcknowledgementRequired: providerContract.serviceContract.providerSync.acknowledgementRequired,
        providerSyncCurrent: providerContract.serviceContract.providerSync.current,
        providerSyncAcknowledged: providerContract.serviceContract.providerSync.acknowledged,
        providerSyncPendingReasons: providerContract.serviceContract.providerSync.pendingReasons
      }
    },
    lifecycleSnapshot: {
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      enforcementActive: lifecycleSettings.enforcementActive,
      monitorOnly: lifecycleSettings.monitorOnly,
      paused: lifecycleSettings.paused,
      pauseUntil: lifecycleSettings.pauseUntil,
      commitDeferred: lifecycleSettings.commitDeferred,
      deferCommitUntil: lifecycleSettings.deferCommitUntil,
      scheduledResumeAt: lifecycleSettings.scheduledResumeAt,
      scheduleState: lifecycleSettings.scheduleState,
      maxScheduleHorizonMs: lifecycleSettings.maxScheduleHorizonMs,
      maxAcceptanceTtlMs: lifecycleSettings.maxAcceptanceTtlMs,
      validationErrors: lifecycleSettings.validationErrors,
      nextLifecycleAction: lifecycleSettings.nextLifecycleAction,
      nextLifecycleActionReason: lifecycleSettings.nextLifecycleActionReason,
      lastCommandBoundary: commandStatus.lifecycleCommandBoundary || { checked: false },
      nextCommandAfterRejection: commandStatus.nextActionAfterRejection || '',
      commandPolicy: lifecycleSettings.commandPolicy
    },
    boundarySnapshot: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      allowedTenantIds: boundary.allowedTenantIds,
      allowedWorkspaceIds: boundary.allowedWorkspaceIds,
      workspaceRoots: boundary.workspaceRoots.map((root) => root.path),
      workspaceRootMap: Object.fromEntries(
        Object.entries(boundary.workspaceRootMap).map(([workspaceId, roots]) => [workspaceId, roots.map((root) => root.path)])
      ),
      isolationMode: boundary.isolationMode,
      requireDeclaredTenantId: boundary.requireDeclaredTenantId,
      requireDeclaredWorkspaceId: boundary.requireDeclaredWorkspaceId,
      requireAnchoredLocalTargets: boundary.requireAnchoredLocalTargets,
      allowUnscopedAbsoluteFileTargets: boundary.allowUnscopedAbsoluteFileTargets,
      scopeEvidenceByWriteId: Object.fromEntries(
        previewWrites.map((write) => [write.id, write.scopeEvidence])
      ),
      requiredPermissions: boundary.requiredPermissions,
      missingPermissions: boundary.missingPermissions,
      writePermissionMode: boundary.writePermissionMode,
      requireScopedWritePermissions: boundary.requireScopedWritePermissions,
      scopedPermissionGrantCount: boundary.scopedPermissionGrants.length,
      operationPermissionMap: boundary.operationPermissionMap,
      permissionEvidenceByWriteId: Object.fromEntries(
        previewWrites.map((write) => [write.id, write.permissionEvidence])
      )
    },
    counters: {
      proposedWrites: validationSummary.total,
      reviewedWrites: reviewedWriteIds.length,
      blockedWrites: validationSummary.blocked,
      pendingAcceptanceWrites: analyticsReport.counters.pendingAcceptanceWrites,
      staleAcceptanceWrites: analyticsReport.counters.staleAcceptanceWrites,
      draftStageWrites: analyticsReport.counters.draftStageWrites,
      sendStageWrites: analyticsReport.counters.sendStageWrites,
      commitReadyWrites: analyticsReport.counters.commitReadyWrites,
      commitBlockedWrites: analyticsReport.counters.commitBlockedWrites,
      explicitApprovalMissingWrites: analyticsReport.counters.explicitApprovalMissingWrites,
      providerViolations: analyticsReport.counters.providerViolations,
      readinessBlockers: analyticsReport.counters.readinessBlockers,
      knownBytes: analyticsReport.counters.knownBytes
    },
    analyticsSnapshot: {
      version: analyticsReport.version,
      currentSnapshotId: analyticsReport.currentSnapshot.id,
      historyDepth: analyticsReport.history.length,
      trend: analyticsReport.trend,
      approvalBoundaryState: analyticsReport.approvalBoundary.state,
      approvalBoundaryCounters: analyticsReport.approvalBoundary.counters,
      exportFormat: analyticsReport.exportSummary.format,
      exportManifestId: analyticsReport.exportManifest.manifestId,
      exportManifestState: analyticsReport.exportManifest.state,
      exportRowCount: analyticsReport.exportRows.length,
      riskBucketCounts: analyticsReport.exportSummary.riskBucketCounts,
      csvColumns: analyticsReport.exportSummary.csvColumns,
      jsonPointers: analyticsReport.exportSummary.jsonPointers
    },
    clientContracts: {
      previewRows: 'clientReviewPacket.previewRows[]',
      acceptanceActions: 'clientReviewPacket.acceptance.actions[]',
      acceptanceFingerprints: 'clientReviewPacket.acceptance.currentWriteFingerprints',
      acceptanceApprovalProofs: 'clientReviewPacket.acceptance.acceptedWriteApprovalProofs',
      approvalBoundarySummary: 'clientReviewPacket.acceptance.approvalBoundarySummary',
      approvalPhaseByWriteId: 'clientReviewPacket.acceptance.approvalBoundarySummary.byWriteId',
      commandApprovalProofs: 'clientReviewPacket.acceptance.actions[].approvalProofs',
      validation: 'clientReviewPacket.validation',
      readiness: 'clientReviewPacket.readiness',
      readinessChecklist: 'clientReviewPacket.readinessChecklist',
      routePatch: 'clientReviewPacket.routePatch',
      nextStepContracts: 'clientReviewPacket.nextStepContracts.contracts[]',
      nextStepCommandPayloads: 'clientReviewPacket.nextStepContracts.contracts[].commandPayload',
      previewAcceptanceContract: 'clientReviewPacket.previewAcceptanceContract',
      previewAcceptanceRows: 'clientReviewPacket.previewAcceptanceContract.rows[]',
      previewAcceptanceCommandContracts: 'clientReviewPacket.previewAcceptanceContract.commandContracts[]',
      workflowDestination: 'workflowHandoff.destination',
      providerServiceContract: 'providerContract.serviceContract',
      providerHandoffManifest: 'providerContract.handoff.manifest',
      providerDispatchBoundary: 'providerContract.serviceContract.dispatchBoundary',
      lifecycleControls: 'clientReviewPacket.lifecycleControls',
      boundaryScope: 'clientReviewPacket.boundaryScope',
      boundaryScopeEvidence: 'clientReviewPacket.previewRows[].scopeEvidence',
      boundaryPermissionEvidence: 'clientReviewPacket.previewRows[].permissionEvidence',
      analyticsCounters: 'clientReviewPacket.reporting.counters',
      exportSummary: 'clientReviewPacket.reporting.exportSummary',
      exportManifest: 'clientReviewPacket.reporting.exportManifest',
      exportRows: 'clientReviewPacket.reporting.exportRows[]',
      timeline: 'clientReviewPacket.reporting.timeline[]',
      operationalHealth: 'clientReviewPacket.operationalHealth',
      actionableErrors: 'clientReviewPacket.operationalHealth.actionableErrors',
      clientRuntimeAdoption: 'clientReviewPacket.clientRuntimeAdoption',
      runtimeRoutePatch: 'clientReviewPacket.clientRuntimeAdoption.routePatch',
      runtimeCommandPayloads: 'clientReviewPacket.clientRuntimeAdoption.commandPayloads[]',
      runtimeCommandPolicy: 'clientReviewPacket.clientRuntimeAdoption.commandPolicy',
      runtimeRejectedPayloads: 'clientReviewPacket.clientRuntimeAdoption.commandQueue.rejectedPayloads[]',
      runtimeFallbackInstructions: 'clientReviewPacket.clientRuntimeAdoption.handoffFallback.instructions[]',
      recoveryPlan: 'clientReviewPacket.restartStatus.recoveryPlan',
      recoveryPlanNextCommand: 'clientReviewPacket.restartStatus.recoveryPlan.nextCommand',
      recoveryPlanReplayResult: 'clientReviewPacket.restartStatus.recoveryPlan.replayedCommandResult'
    },
    workflowContract: {
      destinationSurface: 'workflowHandoff.destination.surface',
      destinationPanel: 'workflowHandoff.destination.panel',
      commandTransport: 'workflowHandoff.destination.commandTransport',
      resumeToken: 'workflowHandoff.destination.resumeToken',
      correlationId: 'workflowHandoff.destination.correlationId',
      runtimeAdoptionMode: 'workflowHandoff.destination.runtimeAdoption.mode',
      runtimeMissingCapabilities: 'workflowHandoff.destination.runtimeAdoption.missingCapabilities'
    },
    restartSafe: {
      persistedStateVersion: PERSISTED_STATE_VERSION,
      previousRevision: persistedState.previousRevision,
      recoveredPreview: persistedState.hasRecoverablePreview,
      state: restartStatus.state,
      restartSafe: restartStatus.restartSafe,
      blockers: restartStatus.blockers,
      previewFingerprint: restartStatus.previewFingerprint,
      persistedPreviewFingerprint: restartStatus.persistedPreviewFingerprint,
      idempotentReplay: restartStatus.idempotentReplay,
      replayToken: restartStatus.replayToken,
      recoveryToken: restartStatus.recoveryToken,
      checkpointedAt: restartStatus.checkpointedAt,
      commandResultContract: {
        source: 'recoveryEnvelope.commandResults',
        resultField: 'result',
        stateRevisionField: 'stateRevision',
        replayCountField: 'replayCount'
      },
      replaySemantics: restartStatus.replaySemantics,
      recoveryPlan: restartStatus.recoveryPlan
    },
    reviewedWriteIds,
    blockedSchemes
  };
}

function buildValidationSummary(previewWrites) {
  const totals = previewWrites.reduce(
    (acc, write) => {
      acc.total += 1;
      acc[write.decision] += 1;
      if (write.severity === 'error') acc.errors += 1;
      if (write.severity === 'warning') acc.warnings += 1;
      return acc;
    },
    { total: 0, allowed: 0, review: 0, blocked: 0, errors: 0, warnings: 0 }
  );
  return {
    ...totals,
    valid: totals.total > 0 && totals.blocked === 0,
    summaryText:
      totals.total === 0
        ? 'No proposed writes were supplied for external-write-guard preview.'
        : `${totals.allowed} allowed, ${totals.review} need review, ${totals.blocked} blocked`
  };
}

function countBy(values) {
  return values.reduce((acc, value) => {
    const key = nonEmptyString(value) || 'unspecified';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function sumNumeric(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function expandProviderCapabilities(capabilities, aliases = DEFAULT_PROVIDER_CAPABILITY_ALIASES) {
  const expanded = new Set(normalizeStringList(capabilities));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [capability, impliedCapabilities] of Object.entries(aliases)) {
      if (!expanded.has(capability)) continue;
      for (const impliedCapability of normalizeStringList(impliedCapabilities)) {
        if (!expanded.has(impliedCapability)) {
          expanded.add(impliedCapability);
          changed = true;
        }
      }
    }
  }
  return expanded;
}

function providerHasCapability(capabilities, capability) {
  if (!capability) return true;
  if (capabilities.has(capability)) return true;
  const parts = capability.split('.');
  while (parts.length > 1) {
    parts.pop();
    if (capabilities.has(`${parts.join('.')}.*`)) return true;
  }
  return false;
}

function buildWriteCapabilityRequirements(write, serviceContract) {
  const declaredRequirements = normalizeStringList(
    serviceContract.writeCapabilityRequirements?.[write.id]
      || serviceContract.capabilityRequirements?.[write.operation]
      || []
  );
  return [
    ...declaredRequirements,
    ...(write.capability ? [write.capability] : []),
    `external-write.operation.${write.operation}`,
    `external-write.scheme.${write.scheme}`
  ].filter((capability, index, all) => capability && all.indexOf(capability) === index);
}

function buildProviderCapabilityNegotiation(provider, serviceContract, previewWrites, supportedCapabilities) {
  const enforceWriteCapabilities = normalizeBoolean(
    serviceContract.enforceWriteCapabilities ?? provider.enforceWriteCapabilities,
    false
  );
  const writeCapabilityRequirements = previewWrites.map((write) => {
    const requiredCapabilities = buildWriteCapabilityRequirements(write, serviceContract);
    const missingCapabilities = enforceWriteCapabilities
      ? requiredCapabilities.filter((capability) => !providerHasCapability(supportedCapabilities, capability))
      : [];
    return {
      writeId: write.id,
      operation: write.operation,
      scheme: write.scheme,
      requiredCapabilities,
      missingCapabilities,
      satisfied: missingCapabilities.length === 0
    };
  });
  const missingWriteCapabilityIds = writeCapabilityRequirements
    .filter((entry) => !entry.satisfied)
    .map((entry) => entry.writeId);
  return {
    enforceWriteCapabilities,
    writeCapabilityRequirements,
    missingWriteCapabilityIds,
    missingCapabilities: [...new Set(writeCapabilityRequirements.flatMap((entry) => entry.missingCapabilities))]
  };
}

function normalizeProviderSyncContract(provider, serviceContract, previousProviderSync, syncKey, previousRevision, nextRevision, writeFingerprint, now) {
  const syncInput = objectValue(serviceContract.sync, provider.sync, provider.providerSync, provider.handoffSync);
  const ackInput = objectValue(syncInput.ack, syncInput.acknowledgement, provider.syncAck, provider.providerSyncAck);
  const observedRevision = normalizePositiveInteger(
    syncInput.observedRevision
      ?? syncInput.revision
      ?? provider.observedSyncRevision
      ?? previousProviderSync.observedRevision
      ?? previousProviderSync.syncRevision,
    0
  );
  const acknowledgedRevision = normalizePositiveInteger(
    ackInput.revision
      ?? ackInput.acknowledgedRevision
      ?? syncInput.acknowledgedRevision
      ?? previousProviderSync.acknowledgedRevision,
    0
  );
  const observedCursor = firstString(
    syncInput.observedCursor,
    syncInput.cursor,
    provider.observedSyncCursor,
    previousProviderSync.observedCursor,
    previousProviderSync.syncCursor
  );
  const acknowledgedCursor = firstString(
    ackInput.cursor,
    ackInput.acknowledgedCursor,
    syncInput.acknowledgedCursor,
    previousProviderSync.acknowledgedCursor
  );
  const observedFingerprint = firstString(
    syncInput.writeFingerprint,
    syncInput.previewFingerprint,
    provider.observedWriteFingerprint,
    previousProviderSync.writeFingerprint
  );
  const acknowledgedFingerprint = firstString(
    ackInput.writeFingerprint,
    ackInput.previewFingerprint,
    syncInput.acknowledgedWriteFingerprint,
    previousProviderSync.acknowledgedWriteFingerprint
  );
  const expectedCursor = writeFingerprint ? `${syncKey}:${nextRevision}` : firstString(previousProviderSync.syncCursor);
  const currentFingerprintObserved = !writeFingerprint
    || observedFingerprint === writeFingerprint
    || acknowledgedFingerprint === writeFingerprint;
  const currentRevisionObserved = observedRevision >= nextRevision || acknowledgedRevision >= nextRevision;
  const currentCursorObserved = !expectedCursor || observedCursor === expectedCursor || acknowledgedCursor === expectedCursor;
  const requiresCurrentSync = normalizeBoolean(
    syncInput.requiresCurrentSync
      ?? syncInput.required
      ?? serviceContract.requiresCurrentSync
      ?? provider.requiresCurrentSync,
    false
  );
  const requiresAcknowledgement = normalizeBoolean(
    syncInput.requiresAcknowledgement
      ?? syncInput.requiresAck
      ?? serviceContract.requiresSyncAck
      ?? provider.requiresSyncAck,
    false
  );
  const acknowledged = !requiresAcknowledgement
    || (acknowledgedRevision >= nextRevision && (!writeFingerprint || acknowledgedFingerprint === writeFingerprint || acknowledgedCursor === expectedCursor));
  const current = !requiresCurrentSync
    || (currentFingerprintObserved && (currentRevisionObserved || currentCursorObserved));
  const pendingReasons = [
    ...(requiresCurrentSync && !currentFingerprintObserved ? ['provider-sync-fingerprint-stale'] : []),
    ...(requiresCurrentSync && !currentRevisionObserved && !currentCursorObserved ? ['provider-sync-revision-stale'] : []),
    ...(requiresAcknowledgement && !acknowledged ? ['provider-sync-ack-pending'] : [])
  ];
  return {
    version: 1,
    required: requiresCurrentSync,
    acknowledgementRequired: requiresAcknowledgement,
    syncKey,
    previousRevision,
    nextRevision,
    expectedCursor,
    writeFingerprint,
    observedRevision,
    observedCursor,
    observedWriteFingerprint: observedFingerprint,
    acknowledgedRevision,
    acknowledgedCursor,
    acknowledgedWriteFingerprint: acknowledgedFingerprint,
    observedAt: normalizeIsoInstant(syncInput.observedAt || provider.observedAt || previousProviderSync.observedAt),
    acknowledgedAt: normalizeIsoInstant(ackInput.acknowledgedAt || ackInput.updatedAt || previousProviderSync.acknowledgedAt),
    checkedAt: now,
    current,
    acknowledged,
    pending: pendingReasons.length > 0,
    pendingReasons,
    handoffState: pendingReasons.length
      ? 'awaiting-provider-sync'
      : writeFingerprint
        ? 'provider-sync-current'
        : 'no-write-fingerprint'
  };
}

function normalizeProviderDispatchBoundary(provider, serviceContract, previewWrites) {
  const dispatchInput = objectValue(serviceContract.dispatch, serviceContract.handoff, provider.dispatch, provider.handoffPolicy);
  const providerConfigured = Boolean(firstString(provider.id, provider.providerId, provider.name));
  const declaredDispatchPolicy = Object.keys(dispatchInput).length > 0
    || serviceContract.requireSendStageForDispatch !== undefined
    || provider.requireSendStageForDispatch !== undefined
    || serviceContract.requiredReviewStage !== undefined
    || provider.requiredReviewStage !== undefined;
  const requestedStage = firstString(
    dispatchInput.requiredReviewStage,
    dispatchInput.requiredStage,
    serviceContract.requiredReviewStage,
    provider.requiredReviewStage
  );
  const requiredReviewStage = WRITE_REVIEW_STAGES.includes(requestedStage) ? requestedStage : 'send';
  const sendOnlyDispatch = normalizeBoolean(
    dispatchInput.requireSendStage
      ?? dispatchInput.sendStageOnly
      ?? serviceContract.requireSendStageForDispatch
      ?? provider.requireSendStageForDispatch,
    true
  );
  const holdDrafts = normalizeBoolean(
    dispatchInput.holdDrafts
      ?? dispatchInput.blockDraftHandoff
      ?? serviceContract.holdDrafts,
    (declaredDispatchPolicy || providerConfigured) && sendOnlyDispatch
  );
  const draftWriteIds = previewWrites
    .filter((write) => write.reviewStage !== requiredReviewStage)
    .map((write) => write.id);
  const sendStageWriteIds = previewWrites
    .filter((write) => write.reviewStage === requiredReviewStage)
    .map((write) => write.id);
  const blockedWriteIds = holdDrafts ? draftWriteIds : [];
  const handoffReadyWriteIds = previewWrites
    .filter((write) => !blockedWriteIds.includes(write.id))
    .map((write) => write.id);
  return {
    version: 1,
    declared: declaredDispatchPolicy,
    providerConfigured,
    requiredReviewStage,
    sendOnlyDispatch,
    holdDrafts,
    draftWriteIds,
    sendStageWriteIds,
    blockedWriteIds,
    handoffReadyWriteIds,
    state: blockedWriteIds.length
      ? 'drafts-held'
      : handoffReadyWriteIds.length
        ? 'dispatch-ready'
        : 'empty-dispatch',
    blockerReason: blockedWriteIds.length ? 'provider-dispatch-requires-send-stage' : '',
    contractField: 'provider.serviceContract.dispatch'
  };
}

function buildCounterDeltas(counters, previousSnapshot) {
  if (!previousSnapshot) return {};
  return {
    proposedWrites: counters.proposedWrites - (previousSnapshot.counters.proposedWrites || 0),
    blockedWrites: counters.blockedWrites - (previousSnapshot.counters.blockedWrites || 0),
    reviewWrites: counters.reviewWrites - (previousSnapshot.counters.reviewWrites || 0),
    acceptedWrites: counters.acceptedWrites - (previousSnapshot.counters.acceptedWrites || 0),
    pendingAcceptanceWrites: counters.pendingAcceptanceWrites - (previousSnapshot.counters.pendingAcceptanceWrites || 0),
    expiredAcceptanceWrites: counters.expiredAcceptanceWrites - (previousSnapshot.counters.expiredAcceptanceWrites || 0),
    staleAcceptanceWrites: counters.staleAcceptanceWrites - (previousSnapshot.counters.staleAcceptanceWrites || 0),
    readinessBlockers: counters.readinessBlockers - (previousSnapshot.counters.readinessBlockers || 0),
    providerViolations: counters.providerViolations - (previousSnapshot.counters.providerViolations || 0),
    draftStageWrites: counters.draftStageWrites - (previousSnapshot.counters.draftStageWrites || 0),
    sendStageWrites: counters.sendStageWrites - (previousSnapshot.counters.sendStageWrites || 0),
    commitReadyWrites: counters.commitReadyWrites - (previousSnapshot.counters.commitReadyWrites || 0),
    commitBlockedWrites: counters.commitBlockedWrites - (previousSnapshot.counters.commitBlockedWrites || 0),
    explicitApprovalMissingWrites: counters.explicitApprovalMissingWrites - (previousSnapshot.counters.explicitApprovalMissingWrites || 0),
    invalidApprovalProofWrites: counters.invalidApprovalProofWrites - (previousSnapshot.counters.invalidApprovalProofWrites || 0),
    knownBytes: counters.knownBytes - (previousSnapshot.counters.knownBytes || 0),
    blockedBytes: counters.blockedBytes - (previousSnapshot.counters.blockedBytes || 0)
  };
}

function classifyAnalyticsTrend(deltas, readiness, operationalSignals) {
  if (!Object.keys(deltas).length) {
    return readiness.canCommit ? 'baseline-ready' : 'baseline-blocked';
  }
  const riskDelta = sumNumeric([
    deltas.blockedWrites,
    deltas.pendingAcceptanceWrites,
    deltas.expiredAcceptanceWrites,
    deltas.staleAcceptanceWrites,
    deltas.commitBlockedWrites,
    deltas.explicitApprovalMissingWrites,
    deltas.invalidApprovalProofWrites,
    deltas.readinessBlockers,
    deltas.providerViolations
  ]);
  if (readiness.canCommit && riskDelta <= 0) return 'improving';
  if (operationalSignals.failureReasons > 0 || riskDelta > 0) return 'regressing';
  if (riskDelta < 0) return 'recovering';
  return 'stable';
}

function riskBucketForExportRow(write, acceptanceState, providerContract) {
  if (write.decision === 'blocked') return 'blocked';
  if (providerContract.serviceContract.capabilityNegotiation.missingWriteCapabilityIds.includes(write.id)) return 'provider-capability';
  if (providerContract.serviceContract.unsupportedOperationWriteIds.includes(write.id)) return 'provider-operation';
  if (providerContract.serviceContract.unsupportedSchemeWriteIds.includes(write.id)) return 'provider-scheme';
  if (providerContract.serviceContract.oversizedWriteIds.includes(write.id)) return 'provider-size';
  if (providerContract.serviceContract.dispatchBoundary.blockedWriteIds.includes(write.id)) return 'provider-dispatch-stage';
  if (acceptanceState === 'expired') return 'expired-acceptance';
  if (acceptanceState === 'stale') return 'stale-acceptance';
  if (acceptanceState === 'draft-only') return 'draft-stage';
  if (acceptanceState === 'approval-record-missing') return 'approval-proof';
  if (acceptanceState === 'approval-record-invalid') return 'approval-proof';
  if (acceptanceState === 'approval-required') return 'explicit-approval';
  if (acceptanceState === 'pending') return 'pending-acceptance';
  if (write.decision === 'review') return 'review';
  return 'clear';
}

function approvalBoundaryStateForRow(row) {
  if (row.decision === 'blocked') return 'not-reviewable';
  if (row.commitReady) return 'commit-ready';
  if (row.reviewStage !== 'send') return 'draft-held';
  if (row.explicitApprovalMissing) return 'explicit-approval-required';
  if (row.approvalProofMissing) return 'proof-missing';
  if (row.approvalProofIntentMismatch || row.approvalProofStageMismatch || row.approvalProofFingerprintMismatch || row.approvalProofScopeMismatch) return 'proof-invalid';
  if (row.acceptanceState === 'accepted') return 'accepted-awaiting-commit-proof';
  if (row.acceptanceState === 'pending') return 'acceptance-pending';
  return row.acceptanceState || 'unknown';
}

function buildApprovalBoundaryAnalytics(exportRows, acceptance) {
  const boundaryByWriteId = acceptance.approvalBoundarySummary?.byWriteId || {};
  const reviewableRows = exportRows.filter((row) => row.decision !== 'blocked');
  const rowsByStage = Object.fromEntries(WRITE_REVIEW_STAGES.map((stage) => [
    stage,
    reviewableRows.filter((row) => row.reviewStage === stage)
  ]));
  const invalidProofRows = reviewableRows.filter((row) =>
    row.approvalProofIntentMismatch || row.approvalProofStageMismatch || row.approvalProofFingerprintMismatch || row.approvalProofScopeMismatch
  );
  const perStage = Object.fromEntries(WRITE_REVIEW_STAGES.map((stage) => {
    const rows = rowsByStage[stage] || [];
    return [stage, {
      writeCount: rows.length,
      acceptedCount: rows.filter((row) => row.acceptanceState === 'accepted').length,
      pendingAcceptanceCount: rows.filter((row) => row.acceptanceState === 'pending').length,
      explicitApprovalMissingCount: rows.filter((row) => row.explicitApprovalMissing).length,
      proofMissingCount: rows.filter((row) => row.approvalProofMissing).length,
      proofInvalidCount: rows.filter((row) =>
        row.approvalProofIntentMismatch || row.approvalProofStageMismatch || row.approvalProofFingerprintMismatch || row.approvalProofScopeMismatch
      ).length,
      commitReadyCount: rows.filter((row) => row.commitReady).length,
      blockedReasonCounts: countBy(rows.flatMap((row) => boundaryByWriteId[row.writeId]?.blockers || []))
    }];
  }));
  const counters = {
    reviewableWrites: reviewableRows.length,
    draftStageWrites: perStage.draft?.writeCount || 0,
    sendStageWrites: perStage.send?.writeCount || 0,
    commitReadyWrites: acceptance.commitReadyWriteIds.length,
    commitBlockedWrites: acceptance.approvalBoundarySummary?.commitBlockedWriteIds?.length || 0,
    acceptanceOnlyWrites: acceptance.approvalBoundarySummary?.acceptanceOnlyWriteIds?.length || 0,
    explicitApprovalMissingWrites: acceptance.explicitApprovalMissingWriteIds.length,
    missingApprovalProofWrites: acceptance.approvalProofMissingWriteIds.length,
    invalidApprovalProofWrites: invalidProofRows.length,
    staleAcceptedWrites: acceptance.staleAcceptedWriteIds.length,
    expiredAcceptedWrites: acceptance.expiredWriteIds.length
  };
  const state = counters.commitBlockedWrites
    ? counters.draftStageWrites
      ? 'blocked-by-draft-stage'
      : counters.explicitApprovalMissingWrites || counters.missingApprovalProofWrites || counters.invalidApprovalProofWrites
        ? 'blocked-by-approval-proof'
        : 'blocked-by-acceptance'
    : counters.reviewableWrites
      ? 'commit-boundary-clear'
      : 'no-reviewable-writes';
  return {
    version: 1,
    state,
    mode: acceptance.approvalBoundarySummary?.mode || '',
    requireSendStageForCommit: acceptance.requireSendStageForCommit,
    requireExplicitApproval: acceptance.requireExplicitApproval,
    counters,
    perStage,
    stageCounts: Object.fromEntries(WRITE_REVIEW_STAGES.map((stage) => [stage, perStage[stage]?.writeCount || 0])),
    commitBlockedWriteIds: acceptance.approvalBoundarySummary?.commitBlockedWriteIds || [],
    acceptanceOnlyWriteIds: acceptance.approvalBoundarySummary?.acceptanceOnlyWriteIds || [],
    exportColumns: [
      'approvalBoundaryState',
      'approvalBoundaryBlockers',
      'approvalProofPresent',
      'approvalProofExplicit'
    ]
  };
}

function normalizeAnalyticsExportRequest(input) {
  const analytics = objectValue(input.analytics, input.reporting, input.policy?.analytics);
  const exportRequest = objectValue(analytics.export, analytics.exportRequest, input.exportRequest);
  const requestedFormats = normalizeStringEntries(exportRequest.formats || exportRequest.format || analytics.exportFormats)
    .map((format) => format.toLowerCase())
    .filter((format) => ['json', 'csv', 'timeline'].includes(format));
  const includeRows = normalizeBoolean(exportRequest.includeRows ?? analytics.includeExportRows, true);
  const includeTimeline = normalizeBoolean(exportRequest.includeTimeline ?? analytics.includeTimeline, true);
  const redactionMode = ['none', 'tenant-workspace', 'target-paths'].includes(nonEmptyString(exportRequest.redactionMode || analytics.redactionMode))
    ? nonEmptyString(exportRequest.redactionMode || analytics.redactionMode)
    : 'none';
  return {
    requested: Object.keys(exportRequest).length > 0 || requestedFormats.length > 0,
    formats: requestedFormats.length ? requestedFormats : ['json', 'csv'],
    includeRows,
    includeTimeline,
    redactionMode,
    destination: firstString(exportRequest.destination, exportRequest.sink, analytics.exportDestination),
    requestedBy: firstString(exportRequest.requestedBy, analytics.requestedBy, input.actorId),
    minHistoryDepth: normalizePositiveInteger(exportRequest.minHistoryDepth ?? analytics.minHistoryDepth, 1),
    requireReadyState: normalizeBoolean(exportRequest.requireReadyState ?? analytics.requireReadyState, false)
  };
}

function buildAnalyticsExportRows(previewWrites, acceptance, providerContract) {
  const acceptedWriteIds = new Set(acceptance.acceptedWriteIds);
  const missingWriteIds = new Set(acceptance.missingWriteIds);
  const expiredWriteIds = new Set(acceptance.expiredWriteIds);
  const staleAcceptedWriteIds = new Set(acceptance.staleAcceptedWriteIds);
  const explicitApprovalMissingWriteIds = new Set(acceptance.explicitApprovalMissingWriteIds);
  const approvalPhaseByWriteId = acceptance.approvalBoundarySummary?.byWriteId || {};
  const approvalProofMissingWriteIds = new Set(acceptance.approvalProofMissingWriteIds);
  const approvalProofIntentMismatchWriteIds = new Set(acceptance.approvalProofIntentMismatchWriteIds);
  const approvalProofStageMismatchWriteIds = new Set(acceptance.approvalProofStageMismatchWriteIds);
  const approvalProofFingerprintMismatchWriteIds = new Set(acceptance.approvalProofFingerprintMismatchWriteIds);
  const approvalProofScopeMismatchWriteIds = new Set(acceptance.approvalProofScopeMismatchWriteIds);
  const draftStageWriteIds = new Set(acceptance.draftStageWriteIds);
  const commitReadyWriteIds = new Set(acceptance.commitReadyWriteIds);
  return previewWrites.map((write) => {
    const acceptanceState = write.decision === 'blocked'
      ? 'not-acceptable'
      : draftStageWriteIds.has(write.id)
        ? 'draft-only'
      : expiredWriteIds.has(write.id)
        ? 'expired'
        : staleAcceptedWriteIds.has(write.id)
          ? 'stale'
        : approvalProofMissingWriteIds.has(write.id)
          ? 'approval-record-missing'
        : approvalProofIntentMismatchWriteIds.has(write.id) || approvalProofStageMismatchWriteIds.has(write.id) || approvalProofFingerprintMismatchWriteIds.has(write.id) || approvalProofScopeMismatchWriteIds.has(write.id)
          ? 'approval-record-invalid'
        : explicitApprovalMissingWriteIds.has(write.id)
          ? 'approval-required'
        : acceptedWriteIds.has(write.id)
          ? 'accepted'
          : missingWriteIds.has(write.id)
            ? 'pending'
            : 'not-required';
    return {
      writeId: write.id,
      scheme: write.scheme,
      operation: write.operation,
      decision: write.decision,
      reason: write.reason,
      bytes: write.bytes,
      tenantId: write.tenantId,
      workspaceId: write.workspaceId,
      targetPath: write.targetPath?.path || '',
      scopeMatchedWorkspaceRoot: write.scopeEvidence?.matchedWorkspaceRoot === true,
      scopeMatchingRoots: write.scopeEvidence?.matchingRoots || [],
      scopeTenantInherited: write.scopeEvidence?.tenantInheritedFromBoundary === true,
      scopeWorkspaceInherited: write.scopeEvidence?.workspaceInheritedFromBoundary === true,
      targetAnchorState: write.scopeEvidence?.targetAddressing?.anchorState || '',
      targetHostAbsolute: write.scopeEvidence?.targetAddressing?.hostAbsolute === true,
      targetAnchoredToWorkspaceRoot: write.scopeEvidence?.targetAddressing?.anchoredToWorkspaceRoot === true,
      targetAddressingRisks: write.scopeEvidence?.targetAddressing?.riskReasons || [],
      permissionMode: write.permissionEvidence?.mode || '',
      scopedAuthorizationRequired: write.permissionEvidence?.scopedAuthorizationRequired === true,
      scopedAuthorizationSatisfied: write.permissionEvidence?.scopedAuthorizationSatisfied !== false,
      requiredPermissions: write.permissionEvidence?.requiredPermissions || [],
      matchedPermissionGrants: write.permissionEvidence?.matchingScopedGrants?.map((grant) => grant.id) || [],
      acceptanceState,
      acceptedAt: acceptance.acceptedWriteAts[write.id] || '',
      acceptedFingerprint: acceptance.acceptedWriteFingerprints[write.id] || '',
      approvalProof: acceptance.acceptedWriteApprovalProofs[write.id] || null,
      approvalProofMissing: acceptance.approvalProofMissingWriteIds.includes(write.id),
      approvalProofIntentMismatch: acceptance.approvalProofIntentMismatchWriteIds.includes(write.id),
      approvalProofStageMismatch: acceptance.approvalProofStageMismatchWriteIds.includes(write.id),
      approvalProofFingerprintMismatch: acceptance.approvalProofFingerprintMismatchWriteIds.includes(write.id),
      approvalProofScopeMismatch: acceptance.approvalProofScopeMismatchWriteIds.includes(write.id),
      currentFingerprint: acceptance.currentWriteFingerprints[write.id] || '',
      acceptanceExpiresAt: acceptance.expiresAtByWriteId[write.id] || '',
      reviewStage: write.reviewStage,
      acceptancePhase: approvalPhaseByWriteId[write.id]?.acceptancePhase || '',
      commitPhase: approvalPhaseByWriteId[write.id]?.commitPhase || '',
      approvalBoundaryState: '',
      approvalBoundaryBlockers: approvalPhaseByWriteId[write.id]?.blockers || [],
      approvalProofPresent: Boolean(acceptance.acceptedWriteApprovalProofs[write.id]),
      approvalProofExplicit: acceptance.acceptedWriteApprovalProofs[write.id]?.explicit === true,
      explicitApprovalMissing: explicitApprovalMissingWriteIds.has(write.id),
      commitReady: commitReadyWriteIds.has(write.id),
      providerRisk: riskBucketForExportRow(write, acceptanceState, providerContract)
    };
  }).map((row) => ({
    ...row,
    approvalBoundaryState: approvalBoundaryStateForRow(row)
  }));
}

function redactExportRows(rows, exportRequest) {
  if (exportRequest.redactionMode === 'none') return rows;
  return rows.map((row) => ({
    ...row,
    ...(exportRequest.redactionMode === 'tenant-workspace' ? { tenantId: '', workspaceId: '' } : {}),
    ...(exportRequest.redactionMode === 'target-paths' ? { targetPath: '', scopeMatchingRoots: [] } : {})
  }));
}

function buildExportManifest(now, requestContext, persistedState, exportRequest, exportRows, timeline, readiness, validationSummary, exportSummary) {
  const blockers = [
    ...(!exportRows.length ? ['no-export-rows'] : []),
    ...(exportRequest.requireReadyState && !readiness.canCommit ? ['readiness-not-ready'] : []),
    ...(exportSummary.historyDepth < exportRequest.minHistoryDepth ? ['history-depth-below-request'] : []),
    ...(!exportRequest.includeRows ? ['row-export-disabled'] : []),
    ...(!exportRequest.includeTimeline ? ['timeline-export-disabled'] : [])
  ];
  const artifactBase = [
    persistedState.stateKey,
    requestContext.requestId || 'anonymous',
    exportSummary.currentSnapshotId || 'snapshot'
  ].join(':');
  return {
    version: 1,
    generatedAt: now,
    manifestId: `${artifactBase}:export-manifest`,
    state: blockers.length ? 'blocked' : 'ready',
    requested: exportRequest.requested,
    requestedBy: exportRequest.requestedBy,
    destination: exportRequest.destination,
    formats: exportRequest.formats,
    redactionMode: exportRequest.redactionMode,
    blockers,
    artifacts: exportRequest.formats.map((format) => ({
      id: `${artifactBase}:export:${format}`,
      format,
      rowCount: format === 'timeline' ? timeline.length : exportRows.length,
      payloadPointer: format === 'timeline' ? '/analytics/timeline' : format === 'csv' ? '/analytics/exportRows' : '/analytics/exportSummary',
      contentType: format === 'csv' ? 'text/csv' : 'application/json',
      ready: blockers.length === 0 && (format !== 'csv' || exportRequest.includeRows) && (format !== 'timeline' || exportRequest.includeTimeline)
    })),
    qualityGates: {
      canCommit: readiness.canCommit,
      validationState: validationSummary.valid ? 'valid' : 'invalid',
      historyDepth: exportSummary.historyDepth,
      minHistoryDepth: exportRequest.minHistoryDepth,
      includeRows: exportRequest.includeRows,
      includeTimeline: exportRequest.includeTimeline
    }
  };
}

function buildAnalyticsReport(now, input, requestContext, persistedState, previewWrites, acceptance, readiness, validationSummary, providerContract, lifecycleSettings, recoveryStatus, commandStatus) {
  const blockedWrites = previewWrites.filter((write) => write.decision === 'blocked');
  const reviewWrites = previewWrites.filter((write) => write.decision === 'review');
  const acceptedWriteIds = new Set(acceptance.acceptedWriteIds);
  const totalKnownBytes = previewWrites
    .filter((write) => write.bytes !== null)
    .reduce((total, write) => total + write.bytes, 0);
  const counters = {
    proposedWrites: validationSummary.total,
    allowedWrites: validationSummary.allowed,
    reviewWrites: validationSummary.review,
    blockedWrites: validationSummary.blocked,
    acceptedWrites: acceptance.acceptedWriteIds.length,
    pendingAcceptanceWrites: acceptance.missingWriteIds.length,
    expiredAcceptanceWrites: acceptance.expiredWriteIds.length,
    staleAcceptanceWrites: acceptance.staleAcceptedWriteIds.length,
    draftStageWrites: acceptance.draftStageWriteIds.length,
    sendStageWrites: acceptance.sendStageWriteIds.length,
    commitReadyWrites: acceptance.commitReadyWriteIds.length,
    commitBlockedWrites: acceptance.approvalBoundarySummary.commitBlockedWriteIds.length,
    explicitApprovalMissingWrites: acceptance.explicitApprovalMissingWriteIds.length,
    invalidApprovalProofWrites: acceptance.approvalProofIntentMismatchWriteIds.length
      + acceptance.approvalProofStageMismatchWriteIds.length
      + acceptance.approvalProofFingerprintMismatchWriteIds.length
      + acceptance.approvalProofScopeMismatchWriteIds.length,
    providerViolations: providerContract.serviceContract.violations.length,
    readinessBlockers: readiness.blockers.length,
    knownBytes: totalKnownBytes,
    acceptedBytes: previewWrites
      .filter((write) => acceptedWriteIds.has(write.id) && write.bytes !== null)
      .reduce((total, write) => total + write.bytes, 0),
    blockedBytes: blockedWrites
      .filter((write) => write.bytes !== null)
      .reduce((total, write) => total + write.bytes, 0)
  };
  const exportRows = buildAnalyticsExportRows(previewWrites, acceptance, providerContract);
  const approvalBoundaryAnalytics = buildApprovalBoundaryAnalytics(exportRows, acceptance);
  const previousSnapshot = persistedState.analyticsHistory[persistedState.analyticsHistory.length - 1] || null;
  const historySnapshot = {
    id: `${persistedState.stateKey}:analytics:${persistedState.previousRevision + 1}`,
    capturedAt: now,
    requestId: requestContext.requestId,
    revision: persistedState.previousRevision + (commandStatus.applied || recoveryStatus.mode === 'fresh-preview' ? 1 : 0),
    readinessState: readiness.state,
    canCommit: readiness.canCommit,
    counters,
    approvalBoundaryCounters: approvalBoundaryAnalytics.counters,
    blockerCounts: countBy(readiness.blockers),
    stageCounts: approvalBoundaryAnalytics.stageCounts,
    providerState: providerContract.handoff.state,
    lifecycleMode: lifecycleSettings.mode
  };
  const deltas = buildCounterDeltas(counters, previousSnapshot);
  const trend = classifyAnalyticsTrend(deltas, readiness, {
    failureReasons: readiness.blockers.filter((blocker) => blocker.startsWith('operational-health-')).length
  });
  const exportRequest = normalizeAnalyticsExportRequest(input);
  const visibleExportRows = exportRequest.includeRows ? redactExportRows(exportRows, exportRequest) : [];
  const exportRowCounts = countBy(exportRows.map((row) => row.providerRisk));
  const timeline = [
    ...(previousSnapshot ? [{
      at: now,
      type: 'analytics-trend',
      label: 'Analytics trend updated',
      state: trend,
      counters: {
        blockedWritesDelta: deltas.blockedWrites || 0,
        pendingAcceptanceDelta: deltas.pendingAcceptanceWrites || 0,
        staleAcceptanceDelta: deltas.staleAcceptanceWrites || 0,
        commitBlockedDelta: deltas.commitBlockedWrites || 0,
        providerViolationsDelta: deltas.providerViolations || 0
      }
    }] : []),
    {
      at: now,
      type: 'preview-evaluated',
      label: 'External write preview evaluated',
      state: validationSummary.valid ? 'valid' : 'invalid',
      counters: {
        proposedWrites: counters.proposedWrites,
        blockedWrites: counters.blockedWrites,
        reviewWrites: counters.reviewWrites
      }
    },
    {
      at: now,
      type: 'approval-boundary',
      label: 'Draft/send approval boundary evaluated',
      state: approvalBoundaryAnalytics.state,
      counters: approvalBoundaryAnalytics.counters,
      stageCounts: approvalBoundaryAnalytics.stageCounts,
      blockedWriteIds: approvalBoundaryAnalytics.commitBlockedWriteIds
    },
    ...(recoveryStatus.recovered ? [{
      at: persistedState.recoveredAt || now,
      type: 'preview-recovered',
      label: 'Preview restored from persisted state',
      state: recoveryStatus.previousStatus || 'recovered',
      counters: { recoveredWriteCount: recoveryStatus.recoveredWriteCount || previewWrites.length }
    }] : []),
    ...(commandStatus.received ? [{
      at: normalizeIsoInstant(commandStatus.issuedAt) || now,
      type: 'guard-command',
      label: commandStatus.applied ? 'Guard command applied' : 'Guard command rejected',
      state: commandStatus.applied ? 'applied' : commandStatus.rejectedReason || 'not-applied',
      commandId: commandStatus.id,
      commandType: commandStatus.type
    }] : []),
    {
      at: now,
      type: 'provider-contract',
      label: 'Provider contract checked',
      state: providerContract.ready && providerContract.serviceContract.valid ? 'ready' : providerContract.handoff.state,
      counters: {
        missingCapabilities: providerContract.missingCapabilities.length,
        serviceViolations: providerContract.serviceContract.violations.length
      }
    },
    {
      at: now,
      type: 'readiness',
      label: readiness.canCommit ? 'Guarded writes ready' : 'Guarded writes blocked',
      state: readiness.state,
      blockers: readiness.blockers
    }
  ];
  const exportSummary = {
    format: 'external-write-guard.analytics-export.v1',
    generatedAt: now,
    stateKey: persistedState.stateKey,
    route: requestContext.route,
    requestId: requestContext.requestId,
    tenantId: requestContext.tenantId,
    workspaceId: requestContext.workspaceId,
    readinessState: readiness.state,
    canCommit: readiness.canCommit,
    currentSnapshotId: historySnapshot.id,
    historyDepth: persistedState.analyticsHistory.length + 1,
    counters,
    approvalBoundary: approvalBoundaryAnalytics,
    decisionCounts: {
      allowed: validationSummary.allowed,
      review: validationSummary.review,
      blocked: validationSummary.blocked
    },
    schemeCounts: countBy(previewWrites.map((write) => write.scheme)),
    blockedReasonCounts: countBy(blockedWrites.map((write) => write.reason)),
    reviewReasonCounts: countBy(reviewWrites.map((write) => write.reason)),
    blockerCounts: countBy(readiness.blockers),
    provider: {
      providerId: providerContract.providerId,
      service: providerContract.service,
      handoffState: providerContract.handoff.state,
      syncCursor: providerContract.sync.nextCursor,
      serviceViolations: providerContract.serviceContract.violations,
      capabilityNegotiation: {
        enforced: providerContract.serviceContract.capabilityNegotiation.enforceWriteCapabilities,
        missingWriteCapabilityIds: providerContract.serviceContract.capabilityNegotiation.missingWriteCapabilityIds,
        missingCapabilities: providerContract.serviceContract.capabilityNegotiation.missingCapabilities
      },
      handoffManifestId: providerContract.handoff.manifest.manifestId,
      handoffManifestState: providerContract.handoff.manifest.state,
      externalAckState: providerContract.serviceContract.externalAck.state,
      dispatchBoundary: {
        state: providerContract.serviceContract.dispatchBoundary.state,
        requiredReviewStage: providerContract.serviceContract.dispatchBoundary.requiredReviewStage,
        blockedWriteIds: providerContract.serviceContract.dispatchBoundary.blockedWriteIds,
        readyWriteIds: providerContract.serviceContract.dispatchBoundary.handoffReadyWriteIds
      },
      sync: {
        required: providerContract.serviceContract.providerSync.required,
        acknowledgementRequired: providerContract.serviceContract.providerSync.acknowledgementRequired,
        current: providerContract.serviceContract.providerSync.current,
        acknowledged: providerContract.serviceContract.providerSync.acknowledged,
        pendingReasons: providerContract.serviceContract.providerSync.pendingReasons,
        expectedCursor: providerContract.serviceContract.providerSync.expectedCursor
      }
    },
    lifecycle: {
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      paused: lifecycleSettings.paused,
      commitDeferred: lifecycleSettings.commitDeferred,
      scheduleState: lifecycleSettings.scheduleState,
      nextActionId: lifecycleSettings.nextLifecycleAction,
      nextActionReason: lifecycleSettings.nextLifecycleActionReason
    },
    rowCount: exportRows.length,
    exportedRowCount: visibleExportRows.length,
    riskBucketCounts: exportRowCounts,
    exportRequest: {
      requested: exportRequest.requested,
      formats: exportRequest.formats,
      destination: exportRequest.destination,
      redactionMode: exportRequest.redactionMode,
      includeRows: exportRequest.includeRows,
      includeTimeline: exportRequest.includeTimeline,
      requireReadyState: exportRequest.requireReadyState
    },
    csvColumns: [
      'capturedAt',
      'requestId',
      'route',
      'writeId',
      'scheme',
      'operation',
      'decision',
      'reason',
      'bytes',
      'tenantId',
      'workspaceId',
      'targetPath',
      'scopeMatchedWorkspaceRoot',
      'targetAnchorState',
      'targetHostAbsolute',
      'targetAnchoredToWorkspaceRoot',
      'scopeTenantInherited',
      'scopeWorkspaceInherited',
      'permissionMode',
      'scopedAuthorizationRequired',
      'scopedAuthorizationSatisfied',
      'matchedPermissionGrants',
      'acceptanceState',
      'acceptedAt',
      'acceptedFingerprint',
      'currentFingerprint',
      'acceptanceExpiresAt',
      'reviewStage',
      'acceptancePhase',
      'commitPhase',
      'approvalBoundaryState',
      'approvalBoundaryBlockers',
      'approvalProofPresent',
      'approvalProofExplicit',
      'explicitApprovalMissing',
      'commitReady',
      'providerRisk'
    ],
    jsonPointers: {
      counters: '/analytics/counters',
      approvalBoundary: '/analytics/approvalBoundary',
      history: '/analytics/history',
      timeline: '/analytics/timeline',
      exportSummary: '/analytics/exportSummary',
      exportRows: '/analytics/exportRows',
      previewRows: '/clientReviewPacket/previewRows'
    }
  };
  const visibleTimeline = exportRequest.includeTimeline ? timeline : [];
  const exportManifest = buildExportManifest(
    now,
    requestContext,
    persistedState,
    exportRequest,
    visibleExportRows,
    visibleTimeline,
    readiness,
    validationSummary,
    exportSummary
  );
  return {
    version: 1,
    counters,
    deltas,
    trend,
    approvalBoundary: approvalBoundaryAnalytics,
    history: [...persistedState.analyticsHistory.slice(-11), historySnapshot],
    currentSnapshot: historySnapshot,
    timeline: visibleTimeline,
    exportRows: visibleExportRows,
    exportSummary: {
      ...exportSummary,
      manifestId: exportManifest.manifestId,
      manifestState: exportManifest.state,
      manifestBlockers: exportManifest.blockers,
      artifactCount: exportManifest.artifacts.length
    },
    exportManifest
  };
}

function pruneExpiredAcceptance(acceptedWriteIds, acceptedWriteAts, acceptedWriteFingerprints, acceptedWriteApprovalProofs, lifecycleSettings, now) {
  if (lifecycleSettings.acceptanceTtlMs === null) {
    return {
      acceptedWriteIds,
      acceptedWriteAts,
      acceptedWriteFingerprints,
      acceptedWriteApprovalProofs,
      expiredWriteIds: [],
      expiresAtByWriteId: {}
    };
  }
  const activeWriteIds = [];
  const activeWriteAts = {};
  const activeWriteFingerprints = {};
  const activeWriteApprovalProofs = {};
  const expiredWriteIds = [];
  const expiresAtByWriteId = {};
  for (const id of acceptedWriteIds) {
    const acceptedAt = normalizeIsoInstant(acceptedWriteAts[id]);
    if (!acceptedAt) {
      activeWriteIds.push(id);
      if (acceptedWriteFingerprints[id]) activeWriteFingerprints[id] = acceptedWriteFingerprints[id];
      if (acceptedWriteApprovalProofs[id]) activeWriteApprovalProofs[id] = acceptedWriteApprovalProofs[id];
      continue;
    }
    const ageMs = elapsedSince(acceptedAt, now);
    const expiresAt = new Date(Date.parse(acceptedAt) + lifecycleSettings.acceptanceTtlMs).toISOString();
    expiresAtByWriteId[id] = expiresAt;
    if (ageMs !== null && ageMs > lifecycleSettings.acceptanceTtlMs) {
      expiredWriteIds.push(id);
    } else {
      activeWriteIds.push(id);
      activeWriteAts[id] = acceptedAt;
      if (acceptedWriteFingerprints[id]) activeWriteFingerprints[id] = acceptedWriteFingerprints[id];
      if (acceptedWriteApprovalProofs[id]) activeWriteApprovalProofs[id] = acceptedWriteApprovalProofs[id];
    }
  }
  return {
    acceptedWriteIds: activeWriteIds,
    acceptedWriteAts: activeWriteAts,
    acceptedWriteFingerprints: activeWriteFingerprints,
    acceptedWriteApprovalProofs: activeWriteApprovalProofs,
    expiredWriteIds,
    expiresAtByWriteId
  };
}

function buildApprovalScopeForWrite(write, requestContext, boundary) {
  return {
    tenantId: write.tenantId || '',
    workspaceId: write.workspaceId || '',
    targetPath: write.targetPath?.path || '',
    matchingRoots: write.scopeEvidence?.matchingRoots || [],
    permissionGrantIds: write.permissionEvidence?.matchingScopedGrants?.map((grant) => grant.id) || [],
    requiredPermissions: write.permissionEvidence?.requiredPermissions || [],
    actorId: requestContext.actor.id,
    clientId: requestContext.client.id,
    actorRoles: boundary.actorRoles,
    isolationMode: boundary.isolationMode
  };
}

function stringFieldMatches(proof, expected, field) {
  const expectedValue = nonEmptyString(expected[field]);
  const proofValue = nonEmptyString(proof[field]);
  return !expectedValue || proofValue === expectedValue;
}

function listFieldCovers(proof, expected, field) {
  const expectedValues = normalizeStringList(expected[field]);
  const proofValues = normalizeStringList(proof[field]);
  return expectedValues.every((value) => proofValues.includes(value));
}

function buildApprovalScopeBinding(proof, expectedScope, required) {
  const suppliedFields = [
    'tenantId',
    'workspaceId',
    'targetPath',
    'actorId',
    'clientId',
    'matchingRoots',
    'permissionGrantIds',
    'requiredPermissions',
    'actorRoles'
  ].filter((field) => {
    const value = proof?.[field];
    return Array.isArray(value) ? value.length > 0 : Boolean(nonEmptyString(value));
  });
  const missingFields = required
    ? [
      ...(['tenantId', 'workspaceId', 'targetPath', 'actorId', 'clientId'].filter((field) =>
        nonEmptyString(expectedScope[field]) && !nonEmptyString(proof?.[field])
      )),
      ...(['matchingRoots', 'permissionGrantIds', 'requiredPermissions', 'actorRoles'].filter((field) =>
        normalizeStringList(expectedScope[field]).length > 0 && !normalizeStringList(proof?.[field]).length
      ))
    ]
    : [];
  const mismatchedFields = [
    ...(['tenantId', 'workspaceId', 'targetPath', 'actorId', 'clientId'].filter((field) =>
      nonEmptyString(proof?.[field]) && !stringFieldMatches(proof, expectedScope, field)
    )),
    ...(['matchingRoots', 'permissionGrantIds', 'requiredPermissions', 'actorRoles'].filter((field) =>
      normalizeStringList(proof?.[field]).length > 0 && !listFieldCovers(proof, expectedScope, field)
    ))
  ];
  return {
    required,
    expectedScope,
    suppliedFields,
    missingFields,
    mismatchedFields,
    bound: (!required || missingFields.length === 0) && mismatchedFields.length === 0
  };
}

function buildAcceptedWrites(input, previewWrites, persistedState, command, commandAlreadyApplied, lifecycleSettings, now, requestContext, boundary) {
  const acceptedWriteIds = new Set([...persistedState.acceptedWriteIds, ...normalizeStringList(input.acceptedWriteIds)]);
  const acceptedWriteAts = {
    ...persistedState.acceptedWriteAts,
    ...normalizeStringRecord(input.acceptedWriteAts || input.acceptanceTimestamps)
  };
  const acceptedWriteFingerprints = {
    ...persistedState.acceptedWriteFingerprints,
    ...normalizeStringRecord(input.acceptedWriteFingerprints || input.acceptanceFingerprints)
  };
  const acceptedWriteApprovalProofs = {
    ...persistedState.acceptedWriteApprovalProofs,
    ...normalizeApprovalProofRecordMap(input.acceptedWriteApprovalProofs || input.acceptanceApprovalProofs || input.approvalProofs)
  };
  if (!command || commandAlreadyApplied) {
    return pruneExpiredAcceptance([...acceptedWriteIds], acceptedWriteAts, acceptedWriteFingerprints, acceptedWriteApprovalProofs, lifecycleSettings, now);
  }
  const knownWriteIds = new Set(previewWrites.map((write) => write.id));
  const previewWriteById = new Map(previewWrites.map((write) => [write.id, write]));
  const unknownWriteIds = command.writeIds.filter((id) => !knownWriteIds.has(id));
  if (unknownWriteIds.length || !['accept-preview', 'clear-acceptance'].includes(command.type)) {
    return pruneExpiredAcceptance([...acceptedWriteIds], acceptedWriteAts, acceptedWriteFingerprints, acceptedWriteApprovalProofs, lifecycleSettings, now);
  }
  if (command.type === 'clear-acceptance') {
    return pruneExpiredAcceptance([], {}, {}, {}, lifecycleSettings, now);
  }
  if (command.type === 'accept-preview') {
    const writeIds = command.writeIds.length
      ? command.writeIds
      : previewWrites.filter((write) => write.decision !== 'blocked').map((write) => write.id);
    const acceptedAt = normalizeIsoInstant(command.issuedAt) || now;
    writeIds.forEach((id) => {
      const write = previewWriteById.get(id);
      const suppliedProof = command.approvalProofs[id] || {};
      const suppliedFingerprint = command.acceptanceFingerprints[id] || suppliedProof.approvalFingerprint || '';
      acceptedWriteIds.add(id);
      acceptedWriteAts[id] = acceptedAt;
      acceptedWriteFingerprints[id] = suppliedFingerprint;
      acceptedWriteApprovalProofs[id] = {
        writeId: id,
        approvalStage: suppliedProof.approvalStage || write?.reviewStage || '',
        approvalFingerprint: suppliedFingerprint,
        approvedAt: suppliedProof.approvedAt || acceptedAt,
        source: suppliedProof.source || 'command',
        commandId: suppliedProof.commandId || command.id,
        actorId: suppliedProof.actorId || requestContext.actor.id,
        clientId: suppliedProof.clientId || requestContext.client.id,
        ...buildApprovalScopeForWrite(write, requestContext, boundary),
        approvalIntent: suppliedProof.approvalIntent || 'accept-preview',
        explicit: suppliedProof.explicit !== false
      };
    });
  }
  return pruneExpiredAcceptance([...acceptedWriteIds], acceptedWriteAts, acceptedWriteFingerprints, acceptedWriteApprovalProofs, lifecycleSettings, now);
}

function buildAcceptance(acceptedWrites, previewWrites, policy, lifecycleSettings, requestContext, boundary) {
  const acceptedWriteIds = new Set(acceptedWrites.acceptedWriteIds.map(String));
  const reviewableWrites = previewWrites.filter((write) => write.decision !== 'blocked');
  const reviewableWriteIds = reviewableWrites.map((write) => write.id);
  const requiredWriteIds = policy.requireUserAcceptance ? reviewableWrites.map((write) => write.id) : [];
  const sendStageWriteIds = reviewableWrites
    .filter((write) => write.reviewStage === 'send')
    .map((write) => write.id);
  const draftStageWriteIds = reviewableWrites
    .filter((write) => write.reviewStage !== 'send')
    .map((write) => write.id);
  const commitStageWriteIds = policy.requireSendStageForCommit ? sendStageWriteIds : requiredWriteIds;
  const currentFingerprintByWriteId = Object.fromEntries(
    reviewableWrites.map((write) => [write.id, writeApprovalFingerprint(write)])
  );
  const acceptedWriteFingerprints = Object.fromEntries(
    Object.entries(acceptedWrites.acceptedWriteFingerprints || {}).filter(([id]) => requiredWriteIds.includes(id))
  );
  const acceptedWriteApprovalProofs = Object.fromEntries(
    Object.entries(acceptedWrites.acceptedWriteApprovalProofs || {}).filter(([id]) => requiredWriteIds.includes(id))
  );
  const fingerprintMatches = (id) =>
    Boolean(acceptedWriteFingerprints[id])
    && Boolean(currentFingerprintByWriteId[id])
    && acceptedWriteFingerprints[id] === currentFingerprintByWriteId[id];
  const proofFor = (id) => acceptedWriteApprovalProofs[id] || {};
  const approvalIntentFor = (id) => nonEmptyString(proofFor(id).approvalIntent || proofFor(id).intent);
  const proofIntentMatchesAcceptance = (id) => {
    const intent = approvalIntentFor(id);
    return !intent || ACCEPTANCE_APPROVAL_INTENTS.includes(intent);
  };
  const proofFingerprintMatches = (id) =>
    Boolean(proofFor(id).approvalFingerprint)
    && Boolean(currentFingerprintByWriteId[id])
    && proofFor(id).approvalFingerprint === currentFingerprintByWriteId[id];
  const proofStageMatches = (id) =>
    !policy.requireSendStageForCommit || proofFor(id).approvalStage === 'send';
  const expectedScopeByWriteId = Object.fromEntries(
    reviewableWrites.map((write) => [write.id, buildApprovalScopeForWrite(write, requestContext, boundary)])
  );
  const proofScopeBindingFor = (id) =>
    buildApprovalScopeBinding(proofFor(id), expectedScopeByWriteId[id] || {}, policy.requireApprovalScopeBinding);
  const proofScopeMatches = (id) => proofScopeBindingFor(id).bound;
  const proofIsExplicit = (id) =>
    proofFor(id).explicit === true
    && Boolean(proofFor(id).approvedAt || proofFor(id).commandId || proofFor(id).source);
  const proofCurrent = (id) =>
    proofIsExplicit(id)
    && proofIntentMatchesAcceptance(id)
    && proofStageMatches(id)
    && proofFingerprintMatches(id)
    && proofScopeMatches(id);
  const explicitApprovalMissingWriteIds = policy.requireExplicitApproval
    ? commitStageWriteIds.filter((id) => acceptedWriteIds.has(id) && (!fingerprintMatches(id) || !proofCurrent(id)))
    : [];
  const approvalProofMissingWriteIds = policy.requireExplicitApproval
    ? commitStageWriteIds.filter((id) => acceptedWriteIds.has(id) && !proofIsExplicit(id))
    : [];
  const approvalProofStageMismatchWriteIds = policy.requireExplicitApproval
    ? commitStageWriteIds.filter((id) => acceptedWriteIds.has(id) && proofIsExplicit(id) && !proofStageMatches(id))
    : [];
  const approvalProofFingerprintMismatchWriteIds = policy.requireExplicitApproval
    ? commitStageWriteIds.filter((id) => acceptedWriteIds.has(id) && proofIsExplicit(id) && !proofFingerprintMatches(id))
    : [];
  const approvalProofScopeMismatchWriteIds = policy.requireExplicitApproval && policy.requireApprovalScopeBinding
    ? commitStageWriteIds.filter((id) => acceptedWriteIds.has(id) && proofIsExplicit(id) && !proofScopeMatches(id))
    : [];
  const approvalProofIntentMismatchWriteIds = policy.requireExplicitApproval
    ? commitStageWriteIds.filter((id) => acceptedWriteIds.has(id) && proofIsExplicit(id) && !proofIntentMatchesAcceptance(id))
    : [];
  const staleAcceptedWriteIds = requiredWriteIds.filter((id) =>
    acceptedWriteIds.has(id)
      && acceptedWriteFingerprints[id]
      && currentFingerprintByWriteId[id]
      && acceptedWriteFingerprints[id] !== currentFingerprintByWriteId[id]
  );
  const missingWriteIds = requiredWriteIds.filter((id) =>
    !acceptedWriteIds.has(id)
    || staleAcceptedWriteIds.includes(id)
    || explicitApprovalMissingWriteIds.includes(id)
  );
  const currentAcceptedWriteIds = [...acceptedWriteIds].filter((id) =>
    requiredWriteIds.includes(id)
      && !staleAcceptedWriteIds.includes(id)
      && !explicitApprovalMissingWriteIds.includes(id)
  );
  const commitReadyWriteIds = commitStageWriteIds.filter((id) =>
    currentAcceptedWriteIds.includes(id)
      && (!policy.requireExplicitApproval || (fingerprintMatches(id) && proofCurrent(id)))
  );
  const sendStageReady = !policy.requireSendStageForCommit || draftStageWriteIds.length === 0;
  const explicitApprovalReady = !policy.requireExplicitApproval
    || commitStageWriteIds.every((id) => fingerprintMatches(id) && proofCurrent(id));
  const approvalBoundaryByWriteId = Object.fromEntries(
    reviewableWrites.map((write) => {
      const currentFingerprint = currentFingerprintByWriteId[write.id] || '';
      const acceptedFingerprint = acceptedWriteFingerprints[write.id] || '';
      const approvalProof = acceptedWriteApprovalProofs[write.id] || null;
      const stageCommitEligible = !policy.requireSendStageForCommit || write.reviewStage === 'send';
      const accepted = acceptedWriteIds.has(write.id);
      const acceptedFingerprintMatches = Boolean(acceptedFingerprint)
        && Boolean(currentFingerprint)
        && acceptedFingerprint === currentFingerprint;
      const approvalProofCurrent = !policy.requireExplicitApproval || proofCurrent(write.id);
      const explicitApprovalCurrent = !policy.requireExplicitApproval || (
        accepted
        && acceptedFingerprintMatches
        && approvalProofCurrent
      );
      const approvalSource = firstString(approvalProof?.source, approvalProof?.approvalSource);
      const approvalIntent = firstString(approvalProof?.approvalIntent, approvalProof?.intent);
      const scopeBinding = proofScopeBindingFor(write.id);
      const approvalRecord = {
        present: Boolean(approvalProof),
        explicit: proofIsExplicit(write.id),
        source: approvalSource,
        commandId: firstString(approvalProof?.commandId, approvalProof?.acceptanceCommandId),
        approvedAt: normalizeIsoInstant(approvalProof?.approvedAt),
        intent: approvalIntent,
        intentAllowedForAcceptance: proofIntentMatchesAcceptance(write.id),
        stage: approvalProof?.approvalStage || '',
        stageMatches: !approvalProof || proofStageMatches(write.id),
        fingerprint: approvalProof?.approvalFingerprint || '',
        fingerprintMatches: !approvalProof || proofFingerprintMatches(write.id),
        scopeBinding,
        scopeMatches: !approvalProof || scopeBinding.bound
      };
      const acceptanceRecord = {
        required: policy.requireUserAcceptance,
        accepted,
        acceptedAt: acceptedWrites.acceptedWriteAts[write.id] || '',
        acceptedFingerprint,
        currentFingerprint,
        acceptedFingerprintMatches,
        stale: staleAcceptedWriteIds.includes(write.id),
        expired: acceptedWrites.expiredWriteIds.includes(write.id)
      };
      const blockers = [
        ...(write.reviewStage === 'send' ? [] : ['draft-stage-write']),
        ...(policy.requireUserAcceptance && !accepted ? ['missing-user-acceptance'] : []),
        ...(staleAcceptedWriteIds.includes(write.id) ? ['stale-approval-fingerprint'] : []),
        ...(explicitApprovalMissingWriteIds.includes(write.id) ? ['missing-explicit-approval-fingerprint'] : []),
        ...(approvalProofMissingWriteIds.includes(write.id) ? ['missing-explicit-approval-proof'] : []),
        ...(approvalProofIntentMismatchWriteIds.includes(write.id) ? ['approval-proof-intent-mismatch'] : []),
        ...(approvalProofStageMismatchWriteIds.includes(write.id) ? ['approval-proof-not-send-stage'] : []),
        ...(approvalProofFingerprintMismatchWriteIds.includes(write.id) ? ['approval-proof-fingerprint-mismatch'] : []),
        ...(approvalProofScopeMismatchWriteIds.includes(write.id) ? ['approval-proof-scope-mismatch'] : []),
        ...(!stageCommitEligible ? ['send-stage-required'] : [])
      ];
      return [write.id, {
        writeId: write.id,
        reviewStage: write.reviewStage,
        stageCommitEligible,
        userAcceptanceRequired: policy.requireUserAcceptance,
        explicitApprovalRequired: policy.requireExplicitApproval,
        accepted,
        acceptedAt: acceptanceRecord.acceptedAt,
        acceptedFingerprint,
        currentFingerprint,
        acceptanceRecord,
        approvalProof,
        approvalRecord,
        approvalProofCurrent,
        approvalProofStageMatches: !approvalProof || proofStageMatches(write.id),
        approvalProofFingerprintMatches: !approvalProof || proofFingerprintMatches(write.id),
        approvalProofIntentMatches: !approvalProof || proofIntentMatchesAcceptance(write.id),
        approvalProofScopeMatches: !approvalProof || scopeBinding.bound,
        explicitApprovalCurrent,
        commitEligible: stageCommitEligible && (!policy.requireUserAcceptance || accepted) && explicitApprovalCurrent,
        blockers
      }];
    })
  );
  const approvalBoundary = {
    version: 1,
    mode: policy.requireSendStageForCommit ? 'send-stage-only' : 'all-reviewable-writes',
    reviewableWriteIds,
    requiredWriteIds,
    commitStageWriteIds,
    sendStageWriteIds,
    draftStageWriteIds,
    commitReadyWriteIds,
    requiresExplicitCommandProof: policy.requireExplicitApproval,
    requiresApprovalScopeBinding: policy.requireApprovalScopeBinding,
    expectedApprovalScopes: expectedScopeByWriteId,
    requiredApprovalFingerprints: Object.fromEntries(
      commitStageWriteIds.map((id) => [id, currentFingerprintByWriteId[id] || ''])
    ),
    byWriteId: approvalBoundaryByWriteId
  };
  const approvalBoundarySummary = buildApprovalBoundarySummary({
    reviewableWrites,
    requiredWriteIds,
    commitStageWriteIds,
    sendStageWriteIds,
    draftStageWriteIds,
    commitReadyWriteIds,
    acceptedWriteIds,
    currentAcceptedWriteIds,
    staleAcceptedWriteIds,
    explicitApprovalMissingWriteIds,
    approvalProofMissingWriteIds,
    approvalProofIntentMismatchWriteIds,
    approvalProofStageMismatchWriteIds,
    approvalProofFingerprintMismatchWriteIds,
    approvalProofScopeMismatchWriteIds,
    expiredWriteIds: acceptedWrites.expiredWriteIds,
    approvalBoundary,
    policy
  });
  return {
    required: policy.requireUserAcceptance,
    requireExplicitApproval: policy.requireExplicitApproval,
    requireSendStageForCommit: policy.requireSendStageForCommit,
    requiredWriteIds,
    reviewableWriteIds,
    commitStageWriteIds,
    sendStageWriteIds,
    draftStageWriteIds,
    commitReadyWriteIds,
    acceptedWriteIds: currentAcceptedWriteIds,
    acceptedWriteAts: Object.fromEntries(
      Object.entries(acceptedWrites.acceptedWriteAts).filter(([id]) => currentAcceptedWriteIds.includes(id))
    ),
    acceptedWriteFingerprints: Object.fromEntries(
      Object.entries(acceptedWriteFingerprints).filter(([id]) => currentAcceptedWriteIds.includes(id))
    ),
    acceptedWriteApprovalProofs: Object.fromEntries(
      Object.entries(acceptedWriteApprovalProofs).filter(([id]) => currentAcceptedWriteIds.includes(id))
    ),
    currentWriteFingerprints: currentFingerprintByWriteId,
    staleAcceptedWriteIds,
    explicitApprovalMissingWriteIds,
    approvalProofMissingWriteIds,
    approvalProofIntentMismatchWriteIds,
    approvalProofStageMismatchWriteIds,
    approvalProofFingerprintMismatchWriteIds,
    approvalProofScopeMismatchWriteIds,
    missingWriteIds,
    expiredWriteIds: acceptedWrites.expiredWriteIds.filter((id) => requiredWriteIds.includes(id)),
    expiresAtByWriteId: Object.fromEntries(
      Object.entries(acceptedWrites.expiresAtByWriteId).filter(([id]) => requiredWriteIds.includes(id))
    ),
    ttlMs: lifecycleSettings.acceptanceTtlMs,
    sendStageReady,
    explicitApprovalReady,
    approvalBoundary,
    approvalBoundarySummary,
    accepted: !policy.requireUserAcceptance || (missingWriteIds.length === 0 && sendStageReady && explicitApprovalReady)
  };
}

function buildApprovalBoundarySummary({
  reviewableWrites,
  requiredWriteIds,
  commitStageWriteIds,
  sendStageWriteIds,
  draftStageWriteIds,
  commitReadyWriteIds,
  acceptedWriteIds,
  currentAcceptedWriteIds,
  staleAcceptedWriteIds,
  explicitApprovalMissingWriteIds,
  approvalProofMissingWriteIds,
  approvalProofIntentMismatchWriteIds,
  approvalProofStageMismatchWriteIds,
  approvalProofFingerprintMismatchWriteIds,
  approvalProofScopeMismatchWriteIds,
  expiredWriteIds,
  approvalBoundary,
  policy
}) {
  const acceptedSet = new Set(acceptedWriteIds);
  const currentAcceptedSet = new Set(currentAcceptedWriteIds);
  const commitReadySet = new Set(commitReadyWriteIds);
  const expiredSet = new Set(expiredWriteIds);
  const byWriteId = Object.fromEntries(reviewableWrites.map((write) => {
    const boundary = approvalBoundary.byWriteId[write.id] || {};
    const blockers = [
      ...(boundary.blockers || []),
      ...(expiredSet.has(write.id) ? ['acceptance-expired'] : [])
    ].filter((reason, index, all) => reason && all.indexOf(reason) === index);
    const acceptancePhase = !policy.requireUserAcceptance
      ? 'not-required'
      : !acceptedSet.has(write.id)
        ? 'needs-acceptance'
        : currentAcceptedSet.has(write.id)
          ? 'accepted-current'
          : 'accepted-not-current';
    const commitPhase = write.reviewStage !== 'send' && policy.requireSendStageForCommit
      ? 'draft-blocked'
      : commitReadySet.has(write.id)
        ? 'send-approved'
        : blockers.length
          ? 'send-approval-blocked'
          : 'send-approval-pending';
    return [write.id, {
      writeId: write.id,
      reviewStage: write.reviewStage,
      acceptancePhase,
      commitPhase,
      accepted: acceptedSet.has(write.id),
      currentAccepted: currentAcceptedSet.has(write.id),
      commitReady: commitReadySet.has(write.id),
      requiresAcceptanceProof: policy.requireUserAcceptance,
      requiresExplicitSendApproval: policy.requireExplicitApproval && commitStageWriteIds.includes(write.id),
      requiresCommandScopedCommitProof: policy.requireExplicitApproval && commitStageWriteIds.includes(write.id),
      requiresScopeBoundApproval: policy.requireApprovalScopeBinding && commitStageWriteIds.includes(write.id),
      acceptedApprovalIntent: boundary.approvalRecord?.intent || '',
      acceptedApprovalStage: boundary.approvalRecord?.stage || '',
      expectedApprovalFingerprint: boundary.currentFingerprint || '',
      expectedApprovalScope: boundary.approvalRecord?.scopeBinding?.expectedScope || {},
      blockers
    }];
  }));
  const commitBlockedWriteIds = commitStageWriteIds.filter((id) => !commitReadySet.has(id));
  const acceptanceOnlyWriteIds = requiredWriteIds.filter((id) => currentAcceptedSet.has(id) && !commitReadySet.has(id));
  return {
    version: 1,
    mode: policy.requireSendStageForCommit ? 'accept-draft-send-commit' : 'accept-then-commit',
    acceptanceIntentBoundary: {
      acceptedIntents: ACCEPTANCE_APPROVAL_INTENTS,
      commitIntentsRejectedForAcceptance: COMMIT_APPROVAL_INTENTS,
      emptyIntentAllowedForLegacyAcceptance: true
    },
    commitIntentBoundary: {
      acceptedIntents: COMMIT_APPROVAL_INTENTS,
      requiresCommandScopedProof: policy.requireExplicitApproval,
      rejectsPersistedOnlyProof: policy.requireExplicitApproval,
      requiredStageByWriteId: Object.fromEntries(
        commitStageWriteIds.map((id) => [id, policy.requireSendStageForCommit ? 'send' : approvalBoundary.byWriteId[id]?.reviewStage || ''])
      ),
      requiredFingerprints: approvalBoundary.requiredApprovalFingerprints
    },
    scopeBindingBoundary: {
      required: policy.requireApprovalScopeBinding,
      requiredScopeByWriteId: approvalBoundary.expectedApprovalScopes || {},
      scopeMismatchWriteIds: approvalProofScopeMismatchWriteIds
    },
    counts: {
      reviewable: reviewableWrites.length,
      requiredAcceptance: requiredWriteIds.length,
      draftStage: draftStageWriteIds.length,
      sendStage: sendStageWriteIds.length,
      commitStage: commitStageWriteIds.length,
      commitReady: commitReadyWriteIds.length,
      commitBlocked: commitBlockedWriteIds.length
    },
    draftBlockedWriteIds: draftStageWriteIds,
    acceptanceOnlyWriteIds,
    commitBlockedWriteIds,
    staleAcceptedWriteIds,
    explicitApprovalMissingWriteIds,
    approvalProofMissingWriteIds,
    approvalProofIntentMismatchWriteIds,
    approvalProofStageMismatchWriteIds,
    approvalProofFingerprintMismatchWriteIds,
    approvalProofScopeMismatchWriteIds,
    expiredWriteIds,
    byWriteId
  };
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function buildCommitProofBoundaryForWrite(id, acceptance, suppliedFingerprints, suppliedApprovalProofs) {
  const expectedFingerprint = acceptance.approvalBoundary.requiredApprovalFingerprints[id] || '';
  const persistedProof = acceptance.acceptedWriteApprovalProofs[id] || null;
  const commandProof = suppliedApprovalProofs[id] || null;
  const boundary = acceptance.approvalBoundary.byWriteId[id] || {};
  const requiredStage = acceptance.requireSendStageForCommit ? 'send' : boundary.reviewStage || '';
  const suppliedFingerprint = suppliedFingerprints[id] || '';
  const selectedProof = commandProof || persistedProof || {};
  const commandIntent = nonEmptyString(commandProof?.approvalIntent || commandProof?.intent);
  const persistedIntent = nonEmptyString(persistedProof?.approvalIntent || persistedProof?.intent);
  const selectedIntent = nonEmptyString(selectedProof.approvalIntent || selectedProof.intent);
  const commandStage = nonEmptyString(commandProof?.approvalStage || commandProof?.reviewStage || commandProof?.stage);
  const persistedStage = nonEmptyString(persistedProof?.approvalStage || persistedProof?.reviewStage || persistedProof?.stage);
  const selectedStage = nonEmptyString(selectedProof.approvalStage || selectedProof.reviewStage || selectedProof.stage);
  const commandFingerprint = nonEmptyString(commandProof?.approvalFingerprint || commandProof?.fingerprint);
  const persistedFingerprint = nonEmptyString(persistedProof?.approvalFingerprint || persistedProof?.fingerprint);
  const selectedFingerprint = nonEmptyString(selectedProof.approvalFingerprint || selectedProof.fingerprint);
  const expectedScope = boundary.approvalRecord?.scopeBinding?.expectedScope
    || acceptance.approvalBoundary.expectedApprovalScopes?.[id]
    || {};
  const commandProofScopeBinding = buildApprovalScopeBinding(commandProof || {}, expectedScope, acceptance.approvalBoundary.requiresApprovalScopeBinding === true);
  const persistedProofScopeBinding = buildApprovalScopeBinding(persistedProof || {}, expectedScope, acceptance.approvalBoundary.requiresApprovalScopeBinding === true);
  const commandProofExplicit = commandProof?.explicit === true
    && Boolean(commandProof.approvedAt || commandProof.commandId || commandProof.source);
  const persistedProofExplicit = persistedProof?.explicit === true
    && Boolean(persistedProof.approvedAt || persistedProof.commandId || persistedProof.source);
  const suppliedFingerprintMatches = Boolean(suppliedFingerprint)
    && Boolean(expectedFingerprint)
    && suppliedFingerprint === expectedFingerprint;
  const commandProofFingerprintMatches = Boolean(commandFingerprint)
    && Boolean(expectedFingerprint)
    && commandFingerprint === expectedFingerprint;
  const persistedProofFingerprintMatches = Boolean(persistedFingerprint)
    && Boolean(expectedFingerprint)
    && persistedFingerprint === expectedFingerprint;
  const commandProofStageMatches = !requiredStage || commandStage === requiredStage;
  const persistedProofStageMatches = !requiredStage || persistedStage === requiredStage;
  const commandProofIntentMatches = COMMIT_APPROVAL_INTENTS.includes(commandIntent);
  const persistedProofIntentMatches = COMMIT_APPROVAL_INTENTS.includes(persistedIntent);
  const persistedOnly = !commandProof && Boolean(persistedProof);
  const draftOnlyApproval = acceptance.requireSendStageForCommit && (
    (commandProof && commandStage && commandStage !== 'send')
    || (persistedProof && persistedStage && persistedStage !== 'send')
    || boundary.reviewStage !== 'send'
  );
  const commandProofCurrent = commandProofExplicit
    && commandProofIntentMatches
    && commandProofStageMatches
    && commandProofFingerprintMatches
    && commandProofScopeBinding.bound;
  return {
    writeId: id,
    expectedFingerprint,
    suppliedFingerprint,
    suppliedFingerprintMatches,
    requiredStage,
    reviewStage: boundary.reviewStage || '',
    commandProofPresent: Boolean(commandProof),
    persistedProofPresent: Boolean(persistedProof),
    persistedOnly,
    draftOnlyApproval,
    selectedProofSource: commandProof ? 'command' : persistedProof ? 'persisted-acceptance' : '',
    selectedIntent,
    selectedStage,
    selectedFingerprint,
    commandProof: {
      explicit: commandProofExplicit,
      intent: commandIntent,
      intentMatchesCommit: commandProofIntentMatches,
      stage: commandStage,
      stageMatches: commandProof ? commandProofStageMatches : false,
      fingerprint: commandFingerprint,
      fingerprintMatches: commandProof ? commandProofFingerprintMatches : false,
      scopeBinding: commandProofScopeBinding,
      scopeMatches: commandProof ? commandProofScopeBinding.bound : false
    },
    persistedProof: {
      explicit: persistedProofExplicit,
      intent: persistedIntent,
      intentMatchesCommit: persistedProof ? persistedProofIntentMatches : false,
      stage: persistedStage,
      stageMatches: persistedProof ? persistedProofStageMatches : false,
      fingerprint: persistedFingerprint,
      fingerprintMatches: persistedProof ? persistedProofFingerprintMatches : false,
      scopeBinding: persistedProofScopeBinding,
      scopeMatches: persistedProof ? persistedProofScopeBinding.bound : false
    },
    commandProofCurrent
  };
}

function buildCommitApprovalCommandBoundary(command, acceptance, readiness) {
  if (!command || command.type !== 'commit-guarded-writes') {
    return {
      checked: false,
      ok: true,
      rejectedReason: ''
    };
  }
  const expectedWriteIds = acceptance.commitStageWriteIds;
  const requestedWriteIds = command.writeIds.length ? command.writeIds : expectedWriteIds;
  const requestedDraftWriteIds = requestedWriteIds.filter((id) => acceptance.draftStageWriteIds.includes(id));
  const nonCommitStageWriteIds = requestedWriteIds.filter((id) => !expectedWriteIds.includes(id));
  const omittedCommitStageWriteIds = expectedWriteIds.filter((id) => !requestedWriteIds.includes(id));
  const expectedFingerprints = acceptance.approvalBoundary.requiredApprovalFingerprints;
  const suppliedFingerprints = {
    ...command.acceptanceFingerprints,
    ...command.commitApprovalFingerprints
  };
  const suppliedApprovalProofs = command.approvalProofs || {};
  const proofDiagnosticsByWriteId = Object.fromEntries(
    expectedWriteIds.map((id) => [
      id,
      buildCommitProofBoundaryForWrite(id, acceptance, suppliedFingerprints, suppliedApprovalProofs)
    ])
  );
  const missingProofWriteIds = acceptance.requireExplicitApproval
    ? expectedWriteIds.filter((id) => !suppliedFingerprints[id])
    : [];
  const mismatchedProofWriteIds = acceptance.requireExplicitApproval
    ? expectedWriteIds.filter((id) => suppliedFingerprints[id] && suppliedFingerprints[id] !== expectedFingerprints[id])
    : [];
  const missingApprovalProofRecordWriteIds = acceptance.requireExplicitApproval
    ? expectedWriteIds.filter((id) => !proofDiagnosticsByWriteId[id]?.commandProof.explicit)
    : [];
  const approvalProofStageMismatchWriteIds = acceptance.requireExplicitApproval
    ? expectedWriteIds.filter((id) => proofDiagnosticsByWriteId[id]?.commandProof.explicit && !proofDiagnosticsByWriteId[id]?.commandProof.stageMatches)
    : [];
  const approvalProofIntentMismatchWriteIds = acceptance.requireExplicitApproval
    ? expectedWriteIds.filter((id) => proofDiagnosticsByWriteId[id]?.commandProof.explicit && !proofDiagnosticsByWriteId[id]?.commandProof.intentMatchesCommit)
    : [];
  const approvalProofFingerprintMismatchWriteIds = acceptance.requireExplicitApproval
    ? expectedWriteIds.filter((id) => proofDiagnosticsByWriteId[id]?.commandProof.explicit && !proofDiagnosticsByWriteId[id]?.commandProof.fingerprintMatches)
    : [];
  const approvalProofScopeMismatchWriteIds = acceptance.requireExplicitApproval && acceptance.approvalBoundary.requiresApprovalScopeBinding
    ? expectedWriteIds.filter((id) => proofDiagnosticsByWriteId[id]?.commandProof.explicit && !proofDiagnosticsByWriteId[id]?.commandProof.scopeMatches)
    : [];
  const suppliedApprovalProofMissingWriteIds = acceptance.requireExplicitApproval
    ? expectedWriteIds.filter((id) => !suppliedApprovalProofs[id])
    : [];
  const acceptedProofMissingWriteIds = expectedWriteIds.filter((id) => !acceptance.acceptedWriteFingerprints[id]);
  const persistedOnlyApprovalProofWriteIds = acceptance.requireExplicitApproval
    ? expectedWriteIds.filter((id) => proofDiagnosticsByWriteId[id]?.persistedOnly)
    : [];
  const draftOnlyApprovalProofWriteIds = acceptance.requireExplicitApproval
    ? expectedWriteIds.filter((id) => proofDiagnosticsByWriteId[id]?.draftOnlyApproval)
    : [];
  const commandProofNotCurrentWriteIds = acceptance.requireExplicitApproval
    ? expectedWriteIds.filter((id) => !proofDiagnosticsByWriteId[id]?.commandProofCurrent)
    : [];
  const blockers = [
    ...(!readiness.canCommit ? readiness.blockers : []),
    ...(requestedDraftWriteIds.length ? ['commit-command-includes-draft-writes'] : []),
    ...(nonCommitStageWriteIds.length ? ['commit-command-targets-non-commit-stage-writes'] : []),
    ...(omittedCommitStageWriteIds.length ? ['commit-command-omits-required-writes'] : []),
    ...(!sameStringSet(requestedWriteIds, expectedWriteIds) ? ['commit-command-write-scope-mismatch'] : []),
    ...(missingProofWriteIds.length ? ['commit-command-missing-approval-proof'] : []),
    ...(mismatchedProofWriteIds.length ? ['commit-command-approval-proof-mismatch'] : []),
    ...(suppliedApprovalProofMissingWriteIds.length ? ['commit-command-missing-commit-approval-record'] : []),
    ...(missingApprovalProofRecordWriteIds.length ? ['commit-command-missing-explicit-approval-record'] : []),
    ...(approvalProofIntentMismatchWriteIds.length ? ['commit-command-approval-record-not-commit-intent'] : []),
    ...(approvalProofStageMismatchWriteIds.length ? ['commit-command-approval-record-not-send-stage'] : []),
    ...(approvalProofFingerprintMismatchWriteIds.length ? ['commit-command-approval-record-fingerprint-mismatch'] : []),
    ...(approvalProofScopeMismatchWriteIds.length ? ['commit-command-approval-record-scope-mismatch'] : []),
    ...(persistedOnlyApprovalProofWriteIds.length ? ['commit-command-requires-command-scoped-approval-record'] : []),
    ...(draftOnlyApprovalProofWriteIds.length ? ['commit-command-draft-approval-cannot-send'] : []),
    ...(commandProofNotCurrentWriteIds.length ? ['commit-command-approval-record-not-current'] : []),
    ...(acceptedProofMissingWriteIds.length && acceptance.requireExplicitApproval ? ['persisted-approval-proof-missing'] : [])
  ].filter((reason, index, all) => reason && all.indexOf(reason) === index);
  return {
    checked: true,
    ok: blockers.length === 0,
    rejectedReason: blockers[0] || '',
    requestedWriteIds,
    expectedWriteIds,
    requestedDraftWriteIds,
    nonCommitStageWriteIds,
    omittedCommitStageWriteIds,
    missingProofWriteIds,
    mismatchedProofWriteIds,
    missingApprovalProofRecordWriteIds,
    suppliedApprovalProofMissingWriteIds,
    approvalProofIntentMismatchWriteIds,
    approvalProofStageMismatchWriteIds,
    approvalProofFingerprintMismatchWriteIds,
    approvalProofScopeMismatchWriteIds,
    acceptedProofMissingWriteIds,
    persistedOnlyApprovalProofWriteIds,
    draftOnlyApprovalProofWriteIds,
    commandProofNotCurrentWriteIds,
    suppliedFingerprints,
    suppliedApprovalProofs,
    expectedFingerprints,
    proofDiagnosticsByWriteId,
    blockers
  };
}

function normalizeHealthRetryPolicy(input, persistedState) {
  const health = objectValue(input.operationalHealth, input.health, input.policy?.operationalHealth);
  const retry = objectValue(health.retry, health.retryPolicy, input.retryPolicy);
  const command = objectValue(input.command);
  const commandType = nonEmptyString(command.type || command.name || input.commandType);
  const commandIsRetry = commandType === 'retry-operational-health-check';
  const backoffMs = toArray(retry.backoffMs || retry.backoff)
    .map((value) => normalizePositiveInteger(value, null))
    .filter((value) => value !== null);
  const requestedAttempt = normalizePositiveInteger(
    retry.attempt ?? health.retryAttempt ?? input.retryAttempt ?? persistedState.operationalHealth.retryAttempt,
    0
  );
  const maxAttempts = normalizePositiveInteger(retry.maxAttempts ?? health.maxRetryAttempts, 3);
  const selectedBackoff = backoffMs.length ? backoffMs : DEFAULT_HEALTH_BACKOFF_MS;
  const attempt = commandIsRetry ? Math.min(requestedAttempt + 1, maxAttempts) : requestedAttempt;
  const cappedAttempt = Math.min(attempt, Math.max(selectedBackoff.length - 1, 0));
  return {
    attempt,
    maxAttempts,
    exhausted: attempt >= maxAttempts,
    backoffMs: selectedBackoff,
    nextDelayMs: selectedBackoff[cappedAttempt] ?? selectedBackoff[selectedBackoff.length - 1],
    strategy: firstString(retry.strategy, retry.kind, 'exponential-backoff'),
    commandApplied: commandIsRetry
  };
}

function normalizeHealthFreshnessPolicy(now, input, persistedState, retryPolicy) {
  const health = objectValue(input.operationalHealth, input.health, input.policy?.operationalHealth);
  const suppliedCheckedAt = normalizeIsoInstant(
    health.checkedAt
      || health.observedAt
      || health.lastCheckedAt
      || input.healthCheckedAt
  );
  const persistedCheckedAt = persistedState.operationalHealth.checkedAt;
  const checkedAt = suppliedCheckedAt || persistedCheckedAt;
  const ageMs = checkedAt ? elapsedSince(checkedAt, now) : null;
  const maxAgeMs = normalizePositiveInteger(
    health.maxCheckAgeMs
      ?? health.maxStaleMs
      ?? health.staleAfterMs
      ?? input.operationalHealthMaxStaleMs,
    DEFAULT_HEALTH_CHECK_STALE_MS
  );
  const persistedStatus = persistedState.operationalHealth.status;
  const suppliedStatus = nonEmptyString(health.status || health.state).toLowerCase();
  const previousUnhealthy = ['failed', 'degraded'].includes(persistedStatus);
  const suppliedHealthy = ['healthy', 'ok', 'ready'].includes(suppliedStatus);
  const suppliedUnhealthy = ['failed', 'degraded', 'unhealthy', 'error'].includes(suppliedStatus);
  const stale = previousUnhealthy
    && !suppliedHealthy
    && (!checkedAt || ageMs === null || ageMs > maxAgeMs);
  const nextRetryAt = persistedState.operationalHealth.nextRetryAt;
  const retryBackoffActive = Boolean(previousUnhealthy
    && !suppliedHealthy
    && nextRetryAt
    && instantIsFuture(nextRetryAt, now));
  return {
    checkedAt,
    ageMs,
    maxAgeMs,
    stale,
    source: suppliedCheckedAt ? 'request' : persistedCheckedAt ? 'persisted-state' : 'missing',
    previousStatus: persistedStatus,
    suppliedStatus,
    suppliedHealthy,
    suppliedUnhealthy,
    retryBackoffActive,
    persistedNextRetryAt: nextRetryAt,
    retryCommandApplied: retryPolicy.commandApplied === true
  };
}

function buildOperationalHealth(now, input, persistedState, validationSummary, acceptance, providerContract, lifecycleSettings, recoveryGuard) {
  const health = objectValue(input.operationalHealth, input.health, input.policy?.operationalHealth);
  const degradedMode = objectValue(health.degradedMode, input.degradedMode);
  const retryPolicy = normalizeHealthRetryPolicy(input, persistedState);
  const freshness = normalizeHealthFreshnessPolicy(now, input, persistedState, retryPolicy);
  const failureReasons = [
    ...(validationSummary.blocked > 0 ? ['blocked-write-targets'] : []),
    ...(lifecycleSettings.validationErrors.length ? ['invalid-lifecycle-settings'] : []),
    ...(providerContract.serviceContract.violations.length ? ['provider-service-contract-violation'] : []),
    ...(providerContract.required && !providerContract.ready && retryPolicy.exhausted ? ['provider-contract-retry-exhausted'] : []),
    ...(freshness.stale && retryPolicy.exhausted ? ['operational-health-check-stale-retry-exhausted'] : []),
    ...(freshness.suppliedUnhealthy ? ['reported-operational-health-unhealthy'] : []),
    ...(recoveryGuard.blockers.length ? ['recovery-guard-blocked'] : [])
  ];
  const degradedReasons = [
    ...(!lifecycleSettings.enabled ? ['guard-disabled'] : []),
    ...(lifecycleSettings.monitorOnly ? ['monitor-only-mode'] : []),
    ...(lifecycleSettings.paused ? ['guard-paused'] : []),
    ...(lifecycleSettings.commitDeferred ? ['commit-deferred'] : []),
    ...(providerContract.required && !providerContract.ready && !retryPolicy.exhausted ? ['provider-contract-not-ready'] : []),
    ...(providerContract.serviceContract.externalAck.pending ? ['external-provider-ack-pending'] : []),
    ...(acceptance.missingWriteIds.length ? ['pending-user-acceptance'] : []),
    ...(acceptance.draftStageWriteIds.length ? ['draft-writes-not-send-ready'] : []),
    ...(acceptance.explicitApprovalMissingWriteIds.length ? ['missing-explicit-send-approval'] : []),
    ...(acceptance.expiredWriteIds.length ? ['expired-user-acceptance'] : []),
    ...(freshness.stale && !retryPolicy.exhausted ? ['operational-health-check-stale'] : []),
    ...(freshness.retryBackoffActive ? ['health-retry-backoff-active'] : [])
  ].filter((reason) => !failureReasons.includes(reason));
  const status = failureReasons.length
    ? 'failed'
    : degradedReasons.length
      ? 'degraded'
      : 'healthy';
  const allowCommitInDegraded = normalizeBoolean(degradedMode.allowCommit, false) || lifecycleSettings.monitorOnly;
  const retryable = status !== 'healthy'
    && !retryPolicy.exhausted
    && (
      providerContract.handoff.retryable
      || providerContract.serviceContract.externalAck.pending
      || lifecycleSettings.paused
      || lifecycleSettings.commitDeferred
      || freshness.stale
      || freshness.suppliedUnhealthy
    );
  const nowTimestamp = Date.parse(now);
  const persistedRetryAt = freshness.retryBackoffActive ? freshness.persistedNextRetryAt : '';
  const nextRetryAt = persistedRetryAt || (retryable && retryPolicy.nextDelayMs && Number.isFinite(nowTimestamp)
    ? new Date(nowTimestamp + retryPolicy.nextDelayMs).toISOString()
    : '');
  const actionableErrors = [
    ...(validationSummary.blocked > 0 ? [{
      code: 'blocked-write-targets',
      severity: 'error',
      actionId: 'remove-external-targets',
      message: 'Remove or remap blocked external write targets before commit.'
    }] : []),
    ...(providerContract.required && !providerContract.ready ? [{
      code: retryPolicy.exhausted ? 'provider-contract-retry-exhausted' : 'provider-contract-not-ready',
      severity: retryPolicy.exhausted ? 'error' : 'warning',
      actionId: 'negotiate-provider-contract',
      message: retryPolicy.exhausted
        ? 'Provider capability negotiation exhausted retry attempts.'
        : 'Provider capability negotiation is not ready yet.',
      missingCapabilities: providerContract.missingCapabilities
    }] : []),
    ...(providerContract.serviceContract.violations.length ? [{
      code: 'provider-service-contract-violation',
      severity: 'error',
      actionId: 'repair-provider-service-contract',
      message: 'Provider service contract does not support this guarded write batch.',
      violations: providerContract.serviceContract.violations
    }] : []),
    ...(lifecycleSettings.validationErrors.length ? [{
      code: 'invalid-lifecycle-settings',
      severity: 'error',
      actionId: 'update-guard-settings',
      message: 'External write guard lifecycle settings are invalid.',
      validationErrors: lifecycleSettings.validationErrors
    }] : []),
    ...(freshness.stale || freshness.suppliedUnhealthy ? [{
      code: freshness.stale ? 'operational-health-check-stale' : 'reported-operational-health-unhealthy',
      severity: retryPolicy.exhausted || freshness.suppliedUnhealthy ? 'error' : 'warning',
      actionId: 'retry-operational-health-check',
      message: freshness.stale
        ? 'Refresh external write guard operational health before commit.'
        : 'External write guard reported an unhealthy operational state.',
      checkedAt: freshness.checkedAt,
      ageMs: freshness.ageMs,
      maxAgeMs: freshness.maxAgeMs,
      previousStatus: freshness.previousStatus,
      suppliedStatus: freshness.suppliedStatus,
      nextRetryAt,
      retryBackoffActive: freshness.retryBackoffActive
    }] : [])
  ];
  return {
    version: 1,
    checkedAt: now,
    observedHealth: {
      checkedAt: freshness.checkedAt,
      ageMs: freshness.ageMs,
      maxAgeMs: freshness.maxAgeMs,
      stale: freshness.stale,
      source: freshness.source,
      previousStatus: freshness.previousStatus,
      suppliedStatus: freshness.suppliedStatus,
      retryBackoffActive: freshness.retryBackoffActive
    },
    status,
    commitAllowed: status === 'healthy' || (status === 'degraded' && allowCommitInDegraded),
    degradedMode: {
      enabled: status === 'degraded',
      allowCommit: allowCommitInDegraded,
      reason: firstString(degradedMode.reason, health.degradedReason)
    },
    failureReasons,
    degradedReasons,
    retry: {
      ...retryPolicy,
      retryable,
      nextRetryAt,
      commandType: retryable ? 'retry-operational-health-check' : ''
    },
    actionableErrors,
    summary: status === 'healthy'
      ? 'External write guard operational health is healthy.'
      : status === 'failed'
        ? `External write guard failed: ${failureReasons.join(', ')}.`
        : `External write guard is degraded: ${degradedReasons.join(', ')}.`
  };
}

function buildReadiness(validationSummary, acceptance, providerContract, lifecycleSettings, recoveryGuard = { blockers: [] }, operationalHealth = { commitAllowed: true, status: 'healthy' }) {
  const blockers = [];
  if (validationSummary.total === 0) blockers.push('no-proposed-writes');
  if (validationSummary.blocked > 0) blockers.push('blocked-external-write-targets');
  if (!acceptance.accepted) blockers.push('pending-user-acceptance');
  if (!acceptance.sendStageReady) blockers.push('draft-writes-not-send-ready');
  if (!acceptance.explicitApprovalReady) blockers.push('missing-explicit-send-approval');
  if (providerContract.required && !providerContract.ready) blockers.push('provider-contract-not-ready');
  if (providerContract.serviceContract.violations.length) blockers.push('provider-service-contract-violation');
  if (providerContract.serviceContract.externalAck.pending) blockers.push('external-provider-ack-pending');
  if (!lifecycleSettings.enabled) blockers.push('guard-disabled');
  if (lifecycleSettings.validationErrors.length) blockers.push('invalid-lifecycle-settings');
  if (lifecycleSettings.paused) blockers.push('guard-paused');
  if (lifecycleSettings.commitDeferred) blockers.push('commit-deferred-by-schedule');
  if (!operationalHealth.commitAllowed) blockers.push(`operational-health-${operationalHealth.status}`);
  blockers.push(...recoveryGuard.blockers);
  return {
    state: blockers.length ? 'not-ready' : 'ready',
    canCommit: blockers.length === 0,
    blockers,
    lifecycle: {
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      paused: lifecycleSettings.paused,
      pauseUntil: lifecycleSettings.pauseUntil,
      commitDeferred: lifecycleSettings.commitDeferred,
      deferCommitUntil: lifecycleSettings.deferCommitUntil,
      scheduleState: lifecycleSettings.scheduleState,
      nextLifecycleAction: lifecycleSettings.nextLifecycleAction,
      nextLifecycleActionReason: lifecycleSettings.nextLifecycleActionReason
    }
  };
}

function buildNextSteps(previewWrites, acceptance, readiness, providerContract, lifecycleSettings, operationalHealth) {
  if (readiness.canCommit) {
    return [{ id: 'commit-guarded-writes', label: 'Commit guarded writes', kind: 'primary' }];
  }
  const steps = [];
  if (operationalHealth.retry.retryable) {
    steps.push({
      id: 'retry-operational-health-check',
      label: 'Retry external write guard health check',
      kind: 'recovery-action',
      retryAttempt: operationalHealth.retry.attempt,
      nextRetryAt: operationalHealth.retry.nextRetryAt,
      nextDelayMs: operationalHealth.retry.nextDelayMs
    });
  }
  for (const error of operationalHealth.actionableErrors) {
    if (!steps.some((step) => step.id === error.actionId)) {
      steps.push({
        id: error.actionId,
        label: error.message,
        kind: error.severity === 'error' ? 'error-action' : 'recovery-action',
        errorCode: error.code
      });
    }
  }
  if (!lifecycleSettings.enabled) {
    steps.push({ id: 'enable-guard', label: 'Enable external write guard', kind: 'lifecycle-action' });
  }
  if (lifecycleSettings.validationErrors.length) {
    steps.push({
      id: 'update-guard-settings',
      label: 'Fix external write guard settings',
      kind: 'settings-action',
      validationErrors: lifecycleSettings.validationErrors
    });
  }
  if (lifecycleSettings.paused || lifecycleSettings.commitDeferred) {
    steps.push({
      id: 'resume-guard',
      label: 'Resume external write guard schedule',
      kind: 'schedule-action',
      resumeAt: lifecycleSettings.scheduledResumeAt || lifecycleSettings.pauseUntil || lifecycleSettings.deferCommitUntil
    });
  }
  if (previewWrites.some((write) => write.decision === 'blocked')) {
    steps.push({ id: 'remove-external-targets', label: 'Remove or remap blocked external targets', kind: 'remediation' });
  }
  if (acceptance.missingWriteIds.length) {
    steps.push({ id: 'accept-preview', label: 'Accept reviewed write preview', kind: 'user-action', writeIds: acceptance.missingWriteIds });
  }
  if (acceptance.draftStageWriteIds.length) {
    steps.push({
      id: 'submit-proposed-writes',
      label: 'Submit send-stage write preview',
      kind: 'input-required',
      writeIds: acceptance.draftStageWriteIds,
      requiredReviewStage: 'send'
    });
  }
  if (readiness.blockers.includes('provider-contract-not-ready')) {
    steps.push({
      id: 'negotiate-provider-contract',
      label: 'Negotiate provider write-guard capabilities',
      kind: 'integration-action',
      missingCapabilities: providerContract.missingCapabilities
    });
  }
  if (readiness.blockers.includes('provider-service-contract-violation')) {
    if (providerContract.serviceContract.dispatchBoundary.blockedWriteIds.length) {
      steps.push({
        id: 'submit-proposed-writes',
        label: 'Submit send-stage write preview for provider handoff',
        kind: 'input-required',
        writeIds: providerContract.serviceContract.dispatchBoundary.blockedWriteIds,
        requiredReviewStage: providerContract.serviceContract.dispatchBoundary.requiredReviewStage,
        contractState: providerContract.serviceContract.dispatchBoundary.state
      });
    }
    if (providerContract.serviceContract.providerSync.pending) {
      steps.push({
        id: 'sync-provider-contract',
        label: 'Sync provider handoff state',
        kind: 'integration-action',
        syncKey: providerContract.serviceContract.providerSync.syncKey,
        expectedCursor: providerContract.serviceContract.providerSync.expectedCursor,
        pendingReasons: providerContract.serviceContract.providerSync.pendingReasons
      });
    }
    steps.push({
      id: 'repair-provider-service-contract',
      label: 'Repair provider service contract',
      kind: 'integration-action',
      violations: providerContract.serviceContract.violations
    });
  }
  if (readiness.blockers.includes('external-provider-ack-pending')) {
    steps.push({
      id: 'await-provider-ack',
      label: 'Wait for provider handoff acknowledgement',
      kind: 'integration-action',
      ackState: providerContract.serviceContract.externalAck.state,
      handoffId: providerContract.serviceContract.externalAck.handoffId
    });
  }
  if (!previewWrites.length) {
    steps.push({ id: 'submit-proposed-writes', label: 'Submit proposed write targets for preview', kind: 'input-required' });
  }
  return steps;
}

function statusToneForWrite(write) {
  if (write.decision === 'blocked') return 'danger';
  if (write.decision === 'review') return 'warning';
  return 'success';
}

function buildClientPreviewRows(previewWrites, acceptance, providerContract) {
  const acceptedWriteIds = new Set(acceptance.acceptedWriteIds);
  const missingWriteIds = new Set(acceptance.missingWriteIds);
  const expiredWriteIds = new Set(acceptance.expiredWriteIds);
  const staleAcceptedWriteIds = new Set(acceptance.staleAcceptedWriteIds);
  const explicitApprovalMissingWriteIds = new Set(acceptance.explicitApprovalMissingWriteIds);
  const approvalProofIntentMismatchWriteIds = new Set(acceptance.approvalProofIntentMismatchWriteIds);
  const approvalProofStageMismatchWriteIds = new Set(acceptance.approvalProofStageMismatchWriteIds);
  const approvalProofFingerprintMismatchWriteIds = new Set(acceptance.approvalProofFingerprintMismatchWriteIds);
  const approvalProofScopeMismatchWriteIds = new Set(acceptance.approvalProofScopeMismatchWriteIds);
  const draftStageWriteIds = new Set(acceptance.draftStageWriteIds);
  const approvalPhaseByWriteId = acceptance.approvalBoundarySummary?.byWriteId || {};
  const providerHandoffByWriteId = new Map(providerContract.handoff.manifest.writes.map((write) => [write.writeId, write]));
  return previewWrites.map((write, index) => {
    const providerHandoff = providerHandoffByWriteId.get(write.id) || null;
    const blocked = write.decision === 'blocked';
    const acceptanceState = blocked
      ? 'not-acceptable'
      : draftStageWriteIds.has(write.id)
        ? 'draft-only'
      : expiredWriteIds.has(write.id)
        ? 'expired'
        : staleAcceptedWriteIds.has(write.id)
        ? 'stale'
        : approvalProofIntentMismatchWriteIds.has(write.id)
          || approvalProofStageMismatchWriteIds.has(write.id)
          || approvalProofFingerprintMismatchWriteIds.has(write.id)
          || approvalProofScopeMismatchWriteIds.has(write.id)
        ? 'approval-record-invalid'
        : explicitApprovalMissingWriteIds.has(write.id)
        ? 'approval-required'
        : acceptedWriteIds.has(write.id)
        ? 'accepted'
        : missingWriteIds.has(write.id)
          ? 'pending'
          : 'not-required';
    return {
      id: write.id,
      ordinal: index + 1,
      target: write.uri || '(missing target)',
      targetScheme: write.scheme,
      operation: write.operation,
      bytes: write.bytes,
      capability: write.capability,
      tenantId: write.tenantId,
      workspaceId: write.workspaceId,
      targetPath: write.targetPath?.path || '',
      targetAddressing: write.scopeEvidence?.targetAddressing || null,
      scopeEvidence: write.scopeEvidence,
      permissionEvidence: write.permissionEvidence,
      decision: write.decision,
      severity: write.severity,
      tone: statusToneForWrite(write),
      reason: write.reason,
      acceptanceState,
      acceptancePhase: approvalPhaseByWriteId[write.id]?.acceptancePhase || '',
      commitPhase: approvalPhaseByWriteId[write.id]?.commitPhase || '',
      approvalPhaseBlockers: approvalPhaseByWriteId[write.id]?.blockers || [],
      acceptedAt: acceptance.acceptedWriteAts[write.id] || '',
      acceptedFingerprint: acceptance.acceptedWriteFingerprints[write.id] || '',
      currentFingerprint: acceptance.currentWriteFingerprints[write.id] || '',
      acceptanceStale: staleAcceptedWriteIds.has(write.id),
      explicitApprovalMissing: explicitApprovalMissingWriteIds.has(write.id),
      approvalProofIntentMismatch: approvalProofIntentMismatchWriteIds.has(write.id),
      approvalProofStageMismatch: approvalProofStageMismatchWriteIds.has(write.id),
      approvalProofFingerprintMismatch: approvalProofFingerprintMismatchWriteIds.has(write.id),
      approvalProofScopeMismatch: approvalProofScopeMismatchWriteIds.has(write.id),
      acceptanceExpiresAt: acceptance.expiresAtByWriteId[write.id] || '',
      acceptanceExpired: expiredWriteIds.has(write.id),
      sendStageReady: write.reviewStage === 'send',
      reviewStage: write.reviewStage,
      draftVersion: write.draftVersion,
      draftFingerprint: write.draftFingerprint || write.draftPayloadFingerprint,
      providerHandoffState: providerHandoff?.state || providerContract.handoff.state,
      providerHandoffBlockers: providerHandoff?.blockers || [],
      providerDispatchBoundary: providerHandoff?.dispatchBoundary || null,
      providerRequiredCapabilities: providerHandoff?.requiredCapabilities || [],
      providerMissingCapabilities: providerHandoff?.missingCapabilities || [],
      providerSyncCursor: providerHandoff?.syncCursor || '',
      selectable: !blocked,
      blocked,
      explainers: [
        write.reason ? `decision:${write.reason}` : '',
        approvalPhaseByWriteId[write.id]?.acceptancePhase ? `acceptance-phase:${approvalPhaseByWriteId[write.id].acceptancePhase}` : '',
        approvalPhaseByWriteId[write.id]?.commitPhase ? `commit-phase:${approvalPhaseByWriteId[write.id].commitPhase}` : '',
        write.capability ? `capability:${write.capability}` : 'capability:missing',
        providerHandoff?.state ? `provider-handoff:${providerHandoff.state}` : '',
        providerHandoff?.dispatchBoundary?.blockerReason ? `provider-dispatch:${providerHandoff.dispatchBoundary.blockerReason}` : '',
        providerHandoff?.missingCapabilities?.length ? `provider-missing-capabilities:${providerHandoff.missingCapabilities.join(',')}` : '',
        acceptance.expiresAtByWriteId[write.id] ? `acceptance-expires:${acceptance.expiresAtByWriteId[write.id]}` : '',
        staleAcceptedWriteIds.has(write.id) ? 'acceptance:stale-draft-fingerprint' : '',
        explicitApprovalMissingWriteIds.has(write.id) ? 'acceptance:explicit-send-approval-required' : '',
        acceptance.approvalProofMissingWriteIds.includes(write.id) ? 'acceptance:explicit-approval-proof-missing' : '',
        acceptance.approvalProofIntentMismatchWriteIds.includes(write.id) ? 'acceptance:approval-proof-intent-mismatch' : '',
        acceptance.approvalProofStageMismatchWriteIds.includes(write.id) ? 'acceptance:approval-proof-not-send-stage' : '',
        acceptance.approvalProofFingerprintMismatchWriteIds.includes(write.id) ? 'acceptance:approval-proof-fingerprint-mismatch' : '',
        acceptance.approvalProofScopeMismatchWriteIds.includes(write.id) ? 'acceptance:approval-proof-scope-mismatch' : '',
        acceptance.currentWriteFingerprints[write.id] ? `current-fingerprint:${acceptance.currentWriteFingerprints[write.id]}` : '',
        write.reviewStage === 'send' ? 'stage:send' : 'stage:draft',
        write.targetPath?.path ? `path:${write.targetPath.path}` : '',
        write.scopeEvidence?.targetAddressing?.anchorState ? `target-anchor:${write.scopeEvidence.targetAddressing.anchorState}` : '',
        write.scopeEvidence?.targetAddressing?.riskReasons?.length
          ? `target-risk:${write.scopeEvidence.targetAddressing.riskReasons.join(',')}`
          : '',
        write.scopeEvidence?.matchingRoots?.length ? `workspace-root:${write.scopeEvidence.matchingRoots.join(',')}` : '',
        write.scopeEvidence?.tenantInheritedFromBoundary ? 'tenant:inherited-from-boundary' : '',
        write.scopeEvidence?.workspaceInheritedFromBoundary ? 'workspace:inherited-from-boundary' : '',
        write.permissionEvidence?.scopedAuthorizationRequired ? `permission-mode:${write.permissionEvidence.mode}` : '',
        write.permissionEvidence?.requiredPermissions?.length ? `required-permissions:${write.permissionEvidence.requiredPermissions.join(',')}` : '',
        write.permissionEvidence?.matchingScopedGrants?.length
          ? `matched-grants:${write.permissionEvidence.matchingScopedGrants.map((grant) => grant.id).join(',')}`
          : '',
        write.permissionEvidence?.scopedAuthorizationSatisfied === false ? 'permission:scoped-authorization-missing' : ''
      ].filter(Boolean)
    };
  });
}

function buildValidationDetails(validationSummary, previewRows, boundary, providerContract) {
  const blockedRows = previewRows.filter((row) => row.blocked);
  const reviewRows = previewRows.filter((row) => row.decision === 'review');
  const acceptedRows = previewRows.filter((row) => row.acceptanceState === 'accepted');
  const pendingRows = previewRows.filter((row) => row.acceptanceState === 'pending');
  const expiredRows = previewRows.filter((row) => row.acceptanceState === 'expired');
  const staleRows = previewRows.filter((row) => row.acceptanceState === 'stale');
  const draftOnlyRows = previewRows.filter((row) => row.acceptanceState === 'draft-only');
  const explicitApprovalRows = previewRows.filter((row) => row.acceptanceState === 'approval-required');
  return {
    headline: validationSummary.summaryText,
    state: validationSummary.valid ? 'valid' : 'invalid',
    counts: {
      total: validationSummary.total,
      allowed: validationSummary.allowed,
      review: validationSummary.review,
      blocked: validationSummary.blocked,
      accepted: acceptedRows.length,
      pendingAcceptance: pendingRows.length,
      expiredAcceptance: expiredRows.length,
      staleAcceptance: staleRows.length,
      draftOnlyWrites: draftOnlyRows.length,
      explicitApprovalRequired: explicitApprovalRows.length,
      errors: validationSummary.errors,
      warnings: validationSummary.warnings
    },
    blockerReasons: [...new Set(blockedRows.map((row) => row.reason))],
    reviewReasons: [...new Set(reviewRows.map((row) => row.reason))],
    boundaryEvidence: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      workspaceRoots: boundary.workspaceRoots.map((root) => root.path),
      workspaceRootMap: Object.fromEntries(
        Object.entries(boundary.workspaceRootMap).map(([workspaceId, roots]) => [workspaceId, roots.map((root) => root.path)])
      ),
      isolationMode: boundary.isolationMode,
      requireDeclaredTenantId: boundary.requireDeclaredTenantId,
      requireDeclaredWorkspaceId: boundary.requireDeclaredWorkspaceId,
      requireAnchoredLocalTargets: boundary.requireAnchoredLocalTargets,
      allowUnscopedAbsoluteFileTargets: boundary.allowUnscopedAbsoluteFileTargets,
      targetAddressingByWriteId: Object.fromEntries(previewRows.map((row) => [row.id, row.targetAddressing])),
      scopeEvidenceByWriteId: Object.fromEntries(previewRows.map((row) => [row.id, row.scopeEvidence])),
      permissionEvidenceByWriteId: Object.fromEntries(previewRows.map((row) => [row.id, row.permissionEvidence])),
      missingPermissions: boundary.missingPermissions,
      writePermissionMode: boundary.writePermissionMode,
      requireScopedWritePermissions: boundary.requireScopedWritePermissions,
      scopedPermissionGrantCount: boundary.scopedPermissionGrants.length
    },
    providerEvidence: {
      required: providerContract.required,
      ready: providerContract.ready,
      missingCapabilities: providerContract.missingCapabilities,
      handoffState: providerContract.handoff.state,
      serviceContract: providerContract.serviceContract
    },
    approvalBoundaryEvidence: {
      phaseCounts: countBy(previewRows.map((row) => row.commitPhase || row.acceptanceState)),
      acceptancePhasesByWriteId: Object.fromEntries(previewRows.map((row) => [row.id, row.acceptancePhase || ''])),
      commitPhasesByWriteId: Object.fromEntries(previewRows.map((row) => [row.id, row.commitPhase || ''])),
      phaseBlockersByWriteId: Object.fromEntries(previewRows.map((row) => [row.id, row.approvalPhaseBlockers || []]))
    }
  };
}

function buildApprovalProofPayloads(writeIds, acceptance, source = 'client-command') {
  return Object.fromEntries(writeIds.map((id) => [id, {
    writeId: id,
    approvalStage: acceptance.approvalBoundary.byWriteId[id]?.reviewStage || '',
    approvalFingerprint: acceptance.currentWriteFingerprints[id] || '',
    approvedAt: '',
    source,
    commandId: '',
    approvalIntent: source === 'commit-command' ? 'commit-guarded-writes' : 'accept-preview',
    explicit: true,
    ...(acceptance.approvalBoundary.expectedApprovalScopes?.[id] || {})
  }]));
}

function buildAcceptanceActions(acceptance, readiness, commandStatus) {
  const actions = [];
  if (acceptance.missingWriteIds.length) {
    actions.push({
      id: 'accept-preview',
      commandType: 'accept-preview',
      label: 'Accept preview',
      enabled: true,
      writeIds: acceptance.missingWriteIds,
      currentWriteFingerprints: Object.fromEntries(
        acceptance.missingWriteIds.map((id) => [id, acceptance.currentWriteFingerprints[id] || ''])
      ),
      approvalProofs: buildApprovalProofPayloads(acceptance.missingWriteIds, acceptance, 'accept-preview-action'),
      approvalBoundarySummary: acceptance.approvalBoundarySummary,
      staleAcceptedWriteIds: acceptance.staleAcceptedWriteIds,
      explicitApprovalMissingWriteIds: acceptance.explicitApprovalMissingWriteIds,
      approvalProofMissingWriteIds: acceptance.approvalProofMissingWriteIds,
      approvalProofIntentMismatchWriteIds: acceptance.approvalProofIntentMismatchWriteIds,
      approvalProofStageMismatchWriteIds: acceptance.approvalProofStageMismatchWriteIds,
      approvalProofFingerprintMismatchWriteIds: acceptance.approvalProofFingerprintMismatchWriteIds,
      approvalProofScopeMismatchWriteIds: acceptance.approvalProofScopeMismatchWriteIds,
      draftStageWriteIds: acceptance.draftStageWriteIds,
      sendStageWriteIds: acceptance.sendStageWriteIds,
      expiredWriteIds: acceptance.expiredWriteIds,
      ttlMs: acceptance.ttlMs,
      resultState: 'acceptance-pending'
    });
  }
  if (acceptance.acceptedWriteIds.length) {
    actions.push({
      id: 'clear-acceptance',
      commandType: 'clear-acceptance',
      label: 'Clear acceptance',
      enabled: true,
      writeIds: acceptance.acceptedWriteIds,
      acceptedWriteFingerprints: acceptance.acceptedWriteFingerprints,
      acceptedWriteApprovalProofs: acceptance.acceptedWriteApprovalProofs,
      resultState: 'acceptance-cleared'
    });
  }
  actions.push({
    id: 'commit-guarded-writes',
    commandType: 'commit-guarded-writes',
    label: 'Commit guarded writes',
    enabled: readiness.canCommit,
    writeIds: acceptance.commitStageWriteIds,
    approvalBoundaryMode: acceptance.approvalBoundary.mode,
    approvalBoundarySummary: acceptance.approvalBoundarySummary,
    requiresCommandScopedApprovalProof: acceptance.approvalBoundary.requiresExplicitCommandProof,
    commandApprovalIntents: COMMIT_APPROVAL_INTENTS,
    acceptedApprovalIntents: ACCEPTANCE_APPROVAL_INTENTS,
    requiredApprovalStages: Object.fromEntries(
      acceptance.commitStageWriteIds.map((id) => [
        id,
        acceptance.requireSendStageForCommit ? 'send' : acceptance.approvalBoundary.byWriteId[id]?.reviewStage || ''
      ])
    ),
    draftApprovalCannotCommit: acceptance.requireSendStageForCommit,
    approvalBoundaryByWriteId: Object.fromEntries(
      acceptance.commitStageWriteIds.map((id) => [id, acceptance.approvalBoundary.byWriteId[id] || null])
    ),
    acceptedWriteFingerprints: acceptance.acceptedWriteFingerprints,
    acceptedWriteApprovalProofs: acceptance.acceptedWriteApprovalProofs,
    requiredApprovalFingerprints: Object.fromEntries(
      acceptance.commitStageWriteIds.map((id) => [id, acceptance.currentWriteFingerprints[id] || ''])
    ),
    approvalProofs: buildApprovalProofPayloads(acceptance.commitStageWriteIds, acceptance, 'commit-command'),
    draftStageWriteIds: acceptance.draftStageWriteIds,
    resultState: readiness.canCommit ? 'commit-requested' : 'commit-blocked',
    disabledReason: readiness.canCommit ? '' : readiness.blockers.join(',')
  });
  return actions.map((action) => ({
    ...action,
    replaySafe: commandStatus.idempotentReplay !== true,
    lastCommandRejectedReason: commandStatus.rejectedReason || ''
  }));
}

function buildReadinessChecklist(readiness, validation, acceptance, providerContract, lifecycleSettings, operationalHealth) {
  const blockerSet = new Set(readiness.blockers);
  const checks = [
    {
      id: 'preview-supplied',
      label: 'Write preview supplied',
      state: blockerSet.has('no-proposed-writes') ? 'blocked' : 'passed',
      reason: blockerSet.has('no-proposed-writes') ? 'no-proposed-writes' : '',
      evidence: { proposedWrites: validation.counts.total }
    },
    {
      id: 'targets-allowed',
      label: 'Targets stay inside allowed write boundary',
      state: blockerSet.has('blocked-external-write-targets') ? 'blocked' : 'passed',
      reason: blockerSet.has('blocked-external-write-targets') ? 'blocked-external-write-targets' : '',
      evidence: {
        blockedWrites: validation.counts.blocked,
        blockerReasons: validation.blockerReasons,
        workspaceRoots: validation.boundaryEvidence.workspaceRoots
      }
    },
    {
      id: 'acceptance-current',
      label: 'User acceptance is current',
      state: blockerSet.has('pending-user-acceptance') ? 'blocked' : acceptance.required ? 'passed' : 'not-required',
      reason: blockerSet.has('pending-user-acceptance') ? 'pending-user-acceptance' : '',
      evidence: {
        requiredWriteIds: acceptance.requiredWriteIds,
        missingWriteIds: acceptance.missingWriteIds,
        staleAcceptedWriteIds: acceptance.staleAcceptedWriteIds,
        expiredWriteIds: acceptance.expiredWriteIds,
        currentWriteFingerprints: acceptance.currentWriteFingerprints,
        ttlMs: acceptance.ttlMs
      }
    },
    {
      id: 'send-approval-current',
      label: 'Send-stage approval is explicit and current',
      state: blockerSet.has('draft-writes-not-send-ready') || blockerSet.has('missing-explicit-send-approval')
        ? 'blocked'
        : acceptance.required
          ? 'passed'
          : 'not-required',
      reason: [
        blockerSet.has('draft-writes-not-send-ready') ? 'draft-writes-not-send-ready' : '',
        blockerSet.has('missing-explicit-send-approval') ? 'missing-explicit-send-approval' : ''
      ].filter(Boolean).join(','),
      evidence: {
        requireExplicitApproval: acceptance.requireExplicitApproval,
        requireSendStageForCommit: acceptance.requireSendStageForCommit,
        commitStageWriteIds: acceptance.commitStageWriteIds,
        draftStageWriteIds: acceptance.draftStageWriteIds,
        sendStageWriteIds: acceptance.sendStageWriteIds,
        explicitApprovalMissingWriteIds: acceptance.explicitApprovalMissingWriteIds,
        approvalProofIntentMismatchWriteIds: acceptance.approvalProofIntentMismatchWriteIds,
        approvalProofStageMismatchWriteIds: acceptance.approvalProofStageMismatchWriteIds,
        approvalProofFingerprintMismatchWriteIds: acceptance.approvalProofFingerprintMismatchWriteIds,
        approvalProofScopeMismatchWriteIds: acceptance.approvalProofScopeMismatchWriteIds,
        commitReadyWriteIds: acceptance.commitReadyWriteIds
      }
    },
    {
      id: 'provider-ready',
      label: 'Provider contract can receive guarded writes',
      state: providerContract.required
        ? blockerSet.has('provider-contract-not-ready') || blockerSet.has('provider-service-contract-violation') || blockerSet.has('external-provider-ack-pending')
          ? 'blocked'
          : 'passed'
        : 'not-required',
      reason: [
        blockerSet.has('provider-contract-not-ready') ? 'provider-contract-not-ready' : '',
        blockerSet.has('provider-service-contract-violation') ? 'provider-service-contract-violation' : '',
        blockerSet.has('external-provider-ack-pending') ? 'external-provider-ack-pending' : ''
      ].filter(Boolean).join(','),
      evidence: {
        providerId: providerContract.providerId,
        handoffState: providerContract.handoff.state,
        missingCapabilities: providerContract.missingCapabilities,
        serviceViolations: providerContract.serviceContract.violations,
        externalAckState: providerContract.serviceContract.externalAck.state
      }
    },
    {
      id: 'lifecycle-open',
      label: 'Guard lifecycle permits commit',
      state: ['guard-disabled', 'invalid-lifecycle-settings', 'guard-paused', 'commit-deferred-by-schedule'].some((blocker) => blockerSet.has(blocker))
        ? 'blocked'
        : 'passed',
      reason: [
        blockerSet.has('guard-disabled') ? 'guard-disabled' : '',
        blockerSet.has('invalid-lifecycle-settings') ? 'invalid-lifecycle-settings' : '',
        blockerSet.has('guard-paused') ? 'guard-paused' : '',
        blockerSet.has('commit-deferred-by-schedule') ? 'commit-deferred-by-schedule' : ''
      ].filter(Boolean).join(','),
      evidence: {
        enabled: lifecycleSettings.enabled,
        mode: lifecycleSettings.mode,
        pauseUntil: lifecycleSettings.pauseUntil,
        deferCommitUntil: lifecycleSettings.deferCommitUntil,
        validationErrors: lifecycleSettings.validationErrors
      }
    },
    {
      id: 'operational-health-clear',
      label: 'Operational health permits commit',
      state: operationalHealth.commitAllowed ? 'passed' : 'blocked',
      reason: operationalHealth.commitAllowed ? '' : `operational-health-${operationalHealth.status}`,
      evidence: {
        status: operationalHealth.status,
        failureReasons: operationalHealth.failureReasons,
        degradedReasons: operationalHealth.degradedReasons,
        observedHealth: operationalHealth.observedHealth,
        nextRetryAt: operationalHealth.retry.nextRetryAt
      }
    }
  ];
  return {
    version: 1,
    state: readiness.canCommit ? 'ready' : 'blocked',
    passed: checks.filter((check) => check.state === 'passed').length,
    blocked: checks.filter((check) => check.state === 'blocked').length,
    notRequired: checks.filter((check) => check.state === 'not-required').length,
    checks
  };
}

function commandPayloadForNextStep(step, requestContext, destination, acceptance, previewRows) {
  const blockedWriteIds = previewRows.filter((row) => row.blocked).map((row) => row.id);
  const base = {
    commandId: `${requestContext.requestId || requestContext.workflow.correlationId || 'external-write'}:${step.id}`,
    type: step.id,
    route: requestContext.route,
    surface: destination.surface,
    panel: destination.panel,
    resumeToken: destination.resumeToken,
    correlationId: destination.correlationId
  };
  if (step.id === 'accept-preview') {
    const writeIds = step.writeIds || acceptance.missingWriteIds;
    return {
      ...base,
      type: 'accept-preview',
      writeIds,
      acceptanceFingerprints: Object.fromEntries(writeIds.map((id) => [id, acceptance.currentWriteFingerprints[id] || ''])),
      approvalProofs: buildApprovalProofPayloads(writeIds, acceptance, 'accept-preview-command'),
      approvalBoundarySummary: acceptance.approvalBoundarySummary
    };
  }
  if (step.id === 'commit-guarded-writes') {
    return {
      ...base,
      type: 'commit-guarded-writes',
      writeIds: acceptance.commitStageWriteIds,
      acceptedWriteFingerprints: acceptance.acceptedWriteFingerprints,
      acceptedWriteApprovalProofs: acceptance.acceptedWriteApprovalProofs,
      requiredApprovalFingerprints: Object.fromEntries(
        acceptance.commitStageWriteIds.map((id) => [id, acceptance.currentWriteFingerprints[id] || ''])
      ),
      approvalProofs: buildApprovalProofPayloads(acceptance.commitStageWriteIds, acceptance, 'commit-command'),
      approvalBoundarySummary: acceptance.approvalBoundarySummary
    };
  }
  if (step.id === 'remove-external-targets') {
    return { ...base, type: 'remediate-targets', writeIds: blockedWriteIds };
  }
  if (['enable-guard', 'resume-guard', 'update-guard-settings'].includes(step.id)) {
    return { ...base, type: step.id, settings: step.validationErrors ? { validationErrors: step.validationErrors } : {} };
  }
  if (step.id === 'retry-operational-health-check') {
    return { ...base, type: 'retry-operational-health-check', retryAttempt: step.retryAttempt, nextRetryAt: step.nextRetryAt };
  }
  if (step.id === 'sync-provider-contract') {
    return {
      ...base,
      type: 'sync-provider-contract',
      providerSync: {
        syncKey: step.syncKey,
        expectedCursor: step.expectedCursor,
        pendingReasons: step.pendingReasons || []
      }
    };
  }
  return { ...base, writeIds: step.writeIds || [] };
}

function buildNextStepContracts(nextSteps, requestContext, destination, acceptance, previewRows, readinessChecklist) {
  const blockerChecks = readinessChecklist.checks.filter((check) => check.state === 'blocked');
  const blockerByAction = new Map([
    ['submit-proposed-writes', ['preview-supplied', 'send-approval-current']],
    ['remove-external-targets', ['targets-allowed']],
    ['accept-preview', ['acceptance-current', 'send-approval-current']],
    ['negotiate-provider-contract', ['provider-ready']],
    ['repair-provider-service-contract', ['provider-ready']],
    ['sync-provider-contract', ['provider-ready']],
    ['await-provider-ack', ['provider-ready']],
    ['enable-guard', ['lifecycle-open']],
    ['resume-guard', ['lifecycle-open']],
    ['update-guard-settings', ['lifecycle-open']],
    ['retry-operational-health-check', ['operational-health-clear']],
    ['commit-guarded-writes', []]
  ]);
  return {
    version: 1,
    transport: destination.commandTransport,
    destination: {
      surface: destination.surface,
      panel: destination.panel,
      actionId: destination.actionId,
      resumeToken: destination.resumeToken
    },
    contracts: nextSteps.map((step, index) => {
      const resolvesCheckIds = blockerByAction.get(step.id) || [];
      return {
        id: step.id,
        ordinal: index + 1,
        kind: step.kind,
        label: step.label,
        enabled: step.id === 'commit-guarded-writes' ? blockerChecks.length === 0 : true,
        resolvesCheckIds,
        unresolvedBlockersAfterAction: blockerChecks
          .filter((check) => !resolvesCheckIds.includes(check.id))
          .map((check) => check.id),
        targetWriteIds: step.writeIds || (step.id === 'remove-external-targets' ? previewRows.filter((row) => row.blocked).map((row) => row.id) : []),
        payloadSchema: {
          required: ['commandId', 'type', 'route', 'resumeToken'],
          optional: ['writeIds', 'acceptanceFingerprints', 'acceptedWriteFingerprints', 'acceptedWriteApprovalProofs', 'approvalProofs', 'approvalBoundarySummary', 'settings', 'retryAttempt', 'nextRetryAt', 'correlationId', 'providerSync']
        },
        commandPayload: commandPayloadForNextStep(step, requestContext, destination, acceptance, previewRows)
      };
    })
  };
}

function buildPreviewAcceptanceContract(previewRows, acceptance, readiness, validation, readinessChecklist, nextStepContracts) {
  const blockedCheckIds = readinessChecklist.checks
    .filter((check) => check.state === 'blocked')
    .map((check) => check.id);
  const contractByAction = new Map(nextStepContracts.contracts.map((contract) => [contract.id, contract]));
  const acceptanceCommand = contractByAction.get('accept-preview')?.commandPayload || null;
  const commitCommand = contractByAction.get('commit-guarded-writes')?.commandPayload || null;
  const rows = previewRows.map((row) => {
    const boundary = acceptance.approvalBoundary.byWriteId[row.id] || {};
    const pendingAcceptance = acceptance.missingWriteIds.includes(row.id);
    const commitBlocked = acceptance.approvalBoundarySummary.commitBlockedWriteIds.includes(row.id);
    const commandPayloads = [
      ...(pendingAcceptance && acceptanceCommand ? [{ actionId: 'accept-preview', commandId: acceptanceCommand.commandId }] : []),
      ...(acceptance.commitStageWriteIds.includes(row.id) && commitCommand ? [{ actionId: 'commit-guarded-writes', commandId: commitCommand.commandId }] : [])
    ];
    return {
      writeId: row.id,
      target: row.target,
      operation: row.operation,
      reviewStage: row.reviewStage,
      decision: row.decision,
      severity: row.severity,
      acceptanceState: row.acceptanceState,
      acceptancePhase: row.acceptancePhase,
      commitPhase: row.commitPhase,
      selectableForAcceptance: row.selectable && pendingAcceptance,
      selectableForCommit: readiness.canCommit && acceptance.commitStageWriteIds.includes(row.id),
      sendStageRequired: acceptance.requireSendStageForCommit,
      explicitApprovalRequired: acceptance.requireExplicitApproval && acceptance.commitStageWriteIds.includes(row.id),
      expectedApprovalFingerprint: acceptance.currentWriteFingerprints[row.id] || '',
      acceptedFingerprint: acceptance.acceptedWriteFingerprints[row.id] || '',
      acceptedAt: acceptance.acceptedWriteAts[row.id] || '',
      expiresAt: acceptance.expiresAtByWriteId[row.id] || '',
      validationReasons: [
        row.reason,
        ...(row.approvalPhaseBlockers || []),
        ...(row.providerHandoffBlockers || [])
      ].filter((reason, index, all) => reason && all.indexOf(reason) === index),
      approvalRecord: boundary.approvalRecord || {
        present: false,
        explicit: false,
        intent: '',
        stage: '',
        fingerprintMatches: false
      },
      readinessImpact: {
        blocksCommit: row.blocked || commitBlocked || pendingAcceptance,
        blockedCheckIds: [
          ...(row.blocked ? ['targets-allowed'] : []),
          ...(pendingAcceptance ? ['acceptance-current'] : []),
          ...(commitBlocked ? ['send-approval-current'] : [])
        ].filter((id, index, all) => id && all.indexOf(id) === index)
      },
      commandPayloadRefs: commandPayloads
    };
  });
  const commandContracts = nextStepContracts.contracts.map((contract) => ({
    actionId: contract.id,
    enabled: contract.enabled,
    kind: contract.kind,
    label: contract.label,
    resolvesCheckIds: contract.resolvesCheckIds,
    unresolvedBlockersAfterAction: contract.unresolvedBlockersAfterAction,
    targetWriteIds: contract.targetWriteIds,
    commandId: contract.commandPayload.commandId,
    commandType: contract.commandPayload.type,
    payloadSchema: contract.payloadSchema,
    payload: contract.commandPayload
  }));
  return {
    version: 1,
    state: readiness.canCommit ? 'ready-to-commit' : blockedCheckIds.length ? 'needs-review-action' : 'collect-preview',
    summary: validation.headline,
    badgeTone: readiness.canCommit ? 'success' : validation.counts.blocked ? 'danger' : 'warning',
    rowCount: rows.length,
    selectedWriteIds: rows
      .filter((row) => row.selectableForAcceptance || row.selectableForCommit)
      .map((row) => row.writeId),
    blockedCheckIds,
    validationSummary: {
      state: validation.state,
      counts: validation.counts,
      blockerReasons: validation.blockerReasons,
      reviewReasons: validation.reviewReasons
    },
    acceptanceSummary: {
      required: acceptance.required,
      accepted: acceptance.accepted,
      requireExplicitApproval: acceptance.requireExplicitApproval,
      requireSendStageForCommit: acceptance.requireSendStageForCommit,
      missingWriteIds: acceptance.missingWriteIds,
      commitReadyWriteIds: acceptance.commitReadyWriteIds,
      commitBlockedWriteIds: acceptance.approvalBoundarySummary.commitBlockedWriteIds,
      draftStageWriteIds: acceptance.draftStageWriteIds,
      expiredWriteIds: acceptance.expiredWriteIds,
      staleAcceptedWriteIds: acceptance.staleAcceptedWriteIds
    },
    rows,
    commandContracts
  };
}

function runtimeCommandEligibility(contract, runtime, destination) {
  const requiredCapabilities = CLIENT_RUNTIME_CAPABILITY_REQUIREMENTS[contract.id] || [];
  const runtimeCapabilitySet = new Set(runtime.capabilities);
  const missingCapabilities = runtime.capabilityStrict
    ? requiredCapabilities.filter((capability) => !runtimeCapabilitySet.has(capability))
    : [];
  const disabledReasons = [
    ...(contract.enabled ? [] : ['contract-disabled']),
    ...(destination.runtimeAdoption.canQueueCommand ? [] : ['runtime-command-queue-unavailable']),
    ...(missingCapabilities.length ? ['missing-command-runtime-capabilities'] : [])
  ];
  return {
    actionId: contract.id,
    commandId: contract.commandPayload.commandId,
    type: contract.commandPayload.type,
    queueable: disabledReasons.length === 0,
    requiredCapabilities,
    missingCapabilities,
    disabledReasons
  };
}

function buildRuntimeHandoffInstructions(destination, readiness, commandEligibility) {
  const queueableActions = commandEligibility.filter((entry) => entry.queueable).map((entry) => entry.actionId);
  const blockedActions = commandEligibility.filter((entry) => !entry.queueable).map((entry) => entry.actionId);
  return [
    {
      id: 'open-review-destination',
      required: true,
      surface: destination.surface,
      panel: destination.panel,
      actionId: destination.actionId,
      resumeToken: destination.resumeToken
    },
    {
      id: 'apply-route-patch',
      required: destination.runtimeAdoption.canApplyRoutePatch,
      statePath: destination.runtimeAdoption.routePatchPath,
      blockedReason: destination.runtimeAdoption.canApplyRoutePatch ? '' : destination.runtimeAdoption.blockedReason || 'route-patch-unavailable'
    },
    {
      id: 'enqueue-runtime-command',
      required: destination.runtimeAdoption.canQueueCommand && queueableActions.length > 0,
      queuePath: destination.runtimeAdoption.commandQueuePath,
      queueableActions,
      blockedActions
    },
    {
      id: 'show-user-visible-review',
      required: !readiness.canCommit || blockedActions.length > 0 || !destination.runtimeAdoption.canQueueCommand,
      reason: !readiness.canCommit
        ? 'guard-review-required'
        : blockedActions.length
          ? 'some-runtime-commands-not-queueable'
          : !destination.runtimeAdoption.canQueueCommand
            ? 'runtime-command-queue-unavailable'
            : ''
    }
  ];
}

function buildClientRuntimeAdoption(requestContext, destination, readiness, nextStepContracts, routePatch) {
  const runtime = requestContext.clientRuntime;
  const commandEligibility = nextStepContracts.contracts.map((contract) =>
    runtimeCommandEligibility(contract, runtime, destination)
  );
  const eligibilityByAction = new Map(commandEligibility.map((entry) => [entry.actionId, entry]));
  const commandPayloads = nextStepContracts.contracts
    .map((contract) => {
      const eligibility = eligibilityByAction.get(contract.id) || {
        queueable: false,
        disabledReasons: ['missing-command-eligibility'],
        requiredCapabilities: [],
        missingCapabilities: []
      };
      return {
        actionId: contract.id,
        commandId: contract.commandPayload.commandId,
        type: contract.commandPayload.type,
        transport: nextStepContracts.transport,
        queuePath: runtime.commandQueuePath,
        queueable: eligibility.queueable,
        requiredCapabilities: eligibility.requiredCapabilities,
        missingCapabilities: eligibility.missingCapabilities,
        disabledReasons: eligibility.disabledReasons,
        payload: contract.commandPayload
      };
    });
  const queueablePayloads = commandPayloads.filter((payload) => payload.queueable);
  const rejectedPayloads = commandPayloads.filter((payload) => !payload.queueable);
  const routePatchEntries = Object.entries(routePatch).map(([path, value]) => ({
    path: `${runtime.statePathPrefix}.${path.replace(/^externalWriteGuard\./, '')}`,
    value
  }));
  const handoffInstructions = buildRuntimeHandoffInstructions(destination, readiness, commandEligibility);
  const fallbackReason = destination.runtimeAdoption.blockedReason
    || (rejectedPayloads.length
      ? 'runtime-command-contracts-rejected'
      : readiness.canCommit
        ? 'runtime-command-handoff'
        : 'user-visible-review-required');
  return {
    version: 1,
    runtimeId: runtime.runtimeId,
    runtimeVersion: runtime.runtimeVersion,
    mode: destination.runtimeAdoption.mode,
    adoptionToken: destination.runtimeAdoption.adoptionToken,
    statePathPrefix: runtime.statePathPrefix,
    blockedReason: destination.runtimeAdoption.blockedReason,
    requiredCapabilities: destination.runtimeAdoption.requiredCapabilities,
    missingCapabilities: destination.runtimeAdoption.missingCapabilities,
    supports: {
      routePatch: runtime.supportsRoutePatch,
      commandQueue: runtime.supportsCommandQueue,
      workflowHandoff: runtime.supportsWorkflowHandoff,
      inlineReview: runtime.supportsInlineReview
    },
    routePatch: {
      path: runtime.routePatchPath,
      apply: destination.runtimeAdoption.canApplyRoutePatch,
      entryCount: routePatchEntries.length,
      entries: destination.runtimeAdoption.canApplyRoutePatch ? routePatchEntries : []
    },
    commandPolicy: {
      requiresExplicitRuntimeCapability: runtime.capabilityStrict,
      queueableActionIds: queueablePayloads.map((payload) => payload.actionId),
      rejectedActionIds: rejectedPayloads.map((payload) => payload.actionId),
      eligibilityByAction: Object.fromEntries(commandEligibility.map((entry) => [entry.actionId, entry])),
      commandQueueRequiresEnabledContract: true,
      disabledContractsStayUserVisible: true
    },
    commandPayloads,
    commandQueue: {
      path: runtime.commandQueuePath,
      enqueue: destination.runtimeAdoption.canQueueCommand,
      payloadCount: queueablePayloads.length,
      rejectedPayloadCount: rejectedPayloads.length,
      payloads: destination.runtimeAdoption.canQueueCommand ? queueablePayloads : [],
      rejectedPayloads
    },
    handoffFallback: {
      required: !destination.runtimeAdoption.canApplyRoutePatch || !destination.runtimeAdoption.canQueueCommand || rejectedPayloads.length > 0,
      surface: destination.surface,
      panel: destination.panel,
      actionId: destination.actionId,
      resumeToken: destination.resumeToken,
      reason: fallbackReason,
      instructions: handoffInstructions
    }
  };
}

function buildLifecycleControls(lifecycleSettings, readiness, commandStatus) {
  const blockedByReplay = commandStatus.idempotentReplay === true;
  const lifecycleCommandBoundary = commandStatus.lifecycleCommandBoundary || { checked: false };
  const lifecycleBlockers = readiness.blockers.filter((blocker) => [
    'guard-disabled',
    'invalid-lifecycle-settings',
    'guard-paused',
    'commit-deferred-by-schedule'
  ].includes(blocker));
  const controls = [
    {
      id: 'enable-guard',
      commandType: 'enable-guard',
      label: 'Enable guard',
      enabled: !lifecycleSettings.enabled,
      resultState: 'guard-enabled',
      requiredFields: ['commandId', 'type'],
      settingsTemplate: { enabled: true, mode: 'enforce' }
    },
    {
      id: 'disable-guard',
      commandType: 'disable-guard',
      label: 'Disable guard',
      enabled: lifecycleSettings.enabled,
      resultState: 'guard-disabled',
      requiredFields: ['commandId', 'type', 'reason'],
      settingsTemplate: { enabled: false, mode: 'disabled' }
    },
    {
      id: 'resume-guard',
      commandType: 'resume-guard',
      label: 'Resume now',
      enabled: lifecycleSettings.paused || lifecycleSettings.commitDeferred,
      resultState: 'schedule-resumed',
      requiredFields: ['commandId', 'type'],
      clearsFields: ['pauseUntil', 'deferCommitUntil', 'scheduledResumeAt'],
      settingsTemplate: { enabled: true, pauseUntil: '', deferCommitUntil: '', scheduledResumeAt: '' }
    },
    {
      id: 'schedule-guard',
      commandType: 'schedule-guard',
      label: 'Schedule guard',
      enabled: lifecycleSettings.enabled,
      resultState: 'guard-scheduled',
      requiredFields: ['commandId', 'type', 'schedule'],
      scheduleFields: ['pauseUntil', 'deferCommitUntil', 'scheduledResumeAt', 'scheduleReason'],
      scheduleValidation: {
        requiresFutureWindow: true,
        maxScheduleHorizonMs: lifecycleSettings.maxScheduleHorizonMs,
        currentScheduleState: lifecycleSettings.scheduleState
      }
    },
    {
      id: 'update-guard-settings',
      commandType: 'update-guard-settings',
      label: 'Update settings',
      enabled: true,
      resultState: lifecycleSettings.validationErrors.length ? 'settings-repair-requested' : 'settings-updated',
      requiredFields: ['commandId', 'type', 'settings'],
      settingsFields: ['enabled', 'mode', 'acceptanceTtlMs', 'maxAcceptanceTtlMs', 'maxScheduleHorizonMs'],
      settingsValidation: {
        allowedModes: LIFECYCLE_MODES,
        acceptanceTtlUnit: 'milliseconds',
        maxAcceptanceTtlMs: lifecycleSettings.maxAcceptanceTtlMs,
        currentValidationErrors: lifecycleSettings.validationErrors
      }
    }
  ];
  return {
    state: lifecycleSettings.enabled ? lifecycleSettings.mode : 'disabled',
    scheduleState: lifecycleSettings.scheduleState,
    nextActionId: lifecycleSettings.nextLifecycleAction,
    nextActionReason: lifecycleSettings.nextLifecycleActionReason,
    canCommitWhenLifecycleClears: readiness.blockers.length > 0 && readiness.blockers.every((blocker) => lifecycleBlockers.includes(blocker)),
    schedule: {
      paused: lifecycleSettings.paused,
      pauseUntil: lifecycleSettings.pauseUntil,
      commitDeferred: lifecycleSettings.commitDeferred,
      deferCommitUntil: lifecycleSettings.deferCommitUntil,
      scheduledResumeAt: lifecycleSettings.scheduledResumeAt,
      maxScheduleHorizonMs: lifecycleSettings.maxScheduleHorizonMs,
      reason: lifecycleSettings.scheduleReason
    },
    settings: {
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      acceptanceTtlMs: lifecycleSettings.acceptanceTtlMs,
      maxAcceptanceTtlMs: lifecycleSettings.maxAcceptanceTtlMs,
      lastCommandType: lifecycleSettings.lastCommandType,
      lastCommandId: lifecycleSettings.lastCommandId,
      lastCommandPayloadKeys: lifecycleSettings.lastCommandPayloadKeys
    },
    validationErrors: lifecycleSettings.validationErrors,
    lastCommandBoundary: lifecycleCommandBoundary,
    lastCommandRejected: lifecycleCommandBoundary.checked && lifecycleCommandBoundary.ok === false,
    nextCommandAfterRejection: commandStatus.nextActionAfterRejection || lifecycleCommandBoundary.nextAction || '',
    commandPolicy: lifecycleSettings.commandPolicy,
    commandCatalog: Object.fromEntries(controls.map((control) => [control.commandType, {
      commandType: control.commandType,
      requiredFields: control.requiredFields,
      optionalFields: [...(control.settingsFields || []), ...(control.scheduleFields || []), 'reason'],
      resultState: control.resultState
    }])),
    actions: controls.map((control) => ({
      ...control,
      replaySafe: !blockedByReplay,
      disabledReason: control.enabled
        ? ''
        : control.id === 'enable-guard'
          ? 'guard-already-enabled'
          : control.id === 'disable-guard'
            ? 'guard-already-disabled'
            : control.id === 'resume-guard'
              ? 'schedule-already-open'
              : 'control-not-applicable',
      nextActionCandidate: control.id === lifecycleSettings.nextLifecycleAction,
      rejectionRecoveryCandidate: control.id === (commandStatus.nextActionAfterRejection || lifecycleCommandBoundary.nextAction),
      commandBoundaryBlockers: lifecycleCommandBoundary.commandType === control.commandType
        ? lifecycleCommandBoundary.blockers || []
        : [],
      lastCommandRejectedReason: commandStatus.rejectedReason || ''
    }))
  };
}

function buildClientReviewPacket(requestContext, previewWrites, acceptance, readiness, validationSummary, nextSteps, boundary, providerContract, commandStatus, lifecycleSettings, analyticsReport, restartStatus, operationalHealth) {
  const previewRows = buildClientPreviewRows(previewWrites, acceptance, providerContract);
  const validation = buildValidationDetails(validationSummary, previewRows, boundary, providerContract);
  const blockedWriteIds = previewRows.filter((row) => row.blocked).map((row) => row.id);
  const reviewWriteIds = previewRows.filter((row) => row.decision === 'review').map((row) => row.id);
  const visibleWriteIds = blockedWriteIds.length
    ? blockedWriteIds
    : acceptance.missingWriteIds.length
      ? acceptance.missingWriteIds
      : reviewWriteIds;
  const destination = buildWorkflowDestination(
    requestContext,
    readiness.canCommit ? 'commit' : blockedWriteIds.length ? 'remediate-targets' : acceptance.missingWriteIds.length ? 'request-acceptance' : 'collect-write-preview',
    visibleWriteIds,
    readiness,
    acceptance
  );
  const readinessChecklist = buildReadinessChecklist(readiness, validation, acceptance, providerContract, lifecycleSettings, operationalHealth);
  const nextStepContracts = buildNextStepContracts(nextSteps, requestContext, destination, acceptance, previewRows, readinessChecklist);
  const previewAcceptanceContract = buildPreviewAcceptanceContract(
    previewRows,
    acceptance,
    readiness,
    validation,
    readinessChecklist,
    nextStepContracts
  );
  const runtimeRoutePatch = {
    'externalWriteGuard.review.readiness': readiness.state,
    'externalWriteGuard.review.canCommit': readiness.canCommit,
    'externalWriteGuard.review.primaryActionId': readiness.canCommit ? 'commit-guarded-writes' : nextSteps[0]?.id || '',
    'externalWriteGuard.review.previewAcceptanceState': previewAcceptanceContract.state,
    'externalWriteGuard.review.previewAcceptanceSelectedWriteIds': previewAcceptanceContract.selectedWriteIds,
    'externalWriteGuard.review.previewAcceptanceCommandIds': previewAcceptanceContract.commandContracts.map((contract) => contract.commandId),
    'externalWriteGuard.review.explicitApprovalMissingIds': acceptance.explicitApprovalMissingWriteIds,
    'externalWriteGuard.review.approvalProofMissingIds': acceptance.approvalProofMissingWriteIds,
    'externalWriteGuard.review.approvalProofIntentMismatchIds': acceptance.approvalProofIntentMismatchWriteIds,
    'externalWriteGuard.review.approvalProofStageMismatchIds': acceptance.approvalProofStageMismatchWriteIds,
    'externalWriteGuard.review.approvalProofFingerprintMismatchIds': acceptance.approvalProofFingerprintMismatchWriteIds,
    'externalWriteGuard.review.approvalProofScopeMismatchIds': acceptance.approvalProofScopeMismatchWriteIds,
    'externalWriteGuard.review.approvalBoundarySummary': acceptance.approvalBoundarySummary,
    'externalWriteGuard.review.acceptancePhaseByWriteId': acceptance.approvalBoundarySummary.byWriteId,
    'externalWriteGuard.review.draftStageWriteIds': acceptance.draftStageWriteIds,
    'externalWriteGuard.review.commitReadyWriteIds': acceptance.commitReadyWriteIds,
    'externalWriteGuard.workflow.surface': destination.surface,
    'externalWriteGuard.workflow.panel': destination.panel,
    'externalWriteGuard.workflow.actionId': destination.actionId,
    'externalWriteGuard.workflow.resumeToken': destination.resumeToken,
    'externalWriteGuard.runtimeAdoption.mode': destination.runtimeAdoption.mode,
    'externalWriteGuard.runtimeAdoption.blockedReason': destination.runtimeAdoption.blockedReason,
    'externalWriteGuard.runtimeAdoption.missingCapabilities': destination.runtimeAdoption.missingCapabilities
  };
  const clientRuntimeAdoption = buildClientRuntimeAdoption(requestContext, destination, readiness, nextStepContracts, runtimeRoutePatch);
  return {
    contractVersion: 1,
    surface: surfaceName,
    route: requestContext.route,
    requestId: requestContext.requestId,
    channel: requestContext.channel,
    interactive: requestContext.isInteractive,
    readiness: {
      state: readiness.state,
      canCommit: readiness.canCommit,
      blockers: readiness.blockers,
      lifecycle: readiness.lifecycle,
      badgeTone: readiness.canCommit ? 'success' : validation.counts.blocked ? 'danger' : 'warning',
      primaryActionId: readiness.canCommit
        ? 'commit-guarded-writes'
        : nextSteps[0]?.id || 'submit-proposed-writes'
    },
    readinessChecklist,
    validation,
    previewRows,
    previewAcceptanceContract,
    acceptance: {
      required: acceptance.required,
      requireExplicitApproval: acceptance.requireExplicitApproval,
      requireSendStageForCommit: acceptance.requireSendStageForCommit,
      accepted: acceptance.accepted,
      reviewableWriteIds: acceptance.reviewableWriteIds,
      requiredWriteIds: acceptance.requiredWriteIds,
      approvalBoundary: acceptance.approvalBoundary,
      approvalBoundarySummary: acceptance.approvalBoundarySummary,
      commitStageWriteIds: acceptance.commitStageWriteIds,
      sendStageWriteIds: acceptance.sendStageWriteIds,
      draftStageWriteIds: acceptance.draftStageWriteIds,
      commitReadyWriteIds: acceptance.commitReadyWriteIds,
      acceptedWriteIds: acceptance.acceptedWriteIds,
      acceptedWriteAts: acceptance.acceptedWriteAts,
      acceptedWriteFingerprints: acceptance.acceptedWriteFingerprints,
      acceptedWriteApprovalProofs: acceptance.acceptedWriteApprovalProofs,
      currentWriteFingerprints: acceptance.currentWriteFingerprints,
      missingWriteIds: acceptance.missingWriteIds,
      staleAcceptedWriteIds: acceptance.staleAcceptedWriteIds,
      explicitApprovalMissingWriteIds: acceptance.explicitApprovalMissingWriteIds,
      approvalProofMissingWriteIds: acceptance.approvalProofMissingWriteIds,
      approvalProofIntentMismatchWriteIds: acceptance.approvalProofIntentMismatchWriteIds,
      approvalProofStageMismatchWriteIds: acceptance.approvalProofStageMismatchWriteIds,
      approvalProofFingerprintMismatchWriteIds: acceptance.approvalProofFingerprintMismatchWriteIds,
      approvalProofScopeMismatchWriteIds: acceptance.approvalProofScopeMismatchWriteIds,
      expiredWriteIds: acceptance.expiredWriteIds,
      expiresAtByWriteId: acceptance.expiresAtByWriteId,
      ttlMs: acceptance.ttlMs,
      actions: buildAcceptanceActions(acceptance, readiness, commandStatus)
    },
    lifecycleControls: buildLifecycleControls(lifecycleSettings, readiness, commandStatus),
    boundaryScope: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      allowedTenantIds: boundary.allowedTenantIds,
      allowedWorkspaceIds: boundary.allowedWorkspaceIds,
      workspaceRoots: boundary.workspaceRoots.map((root) => root.path),
      workspaceRootMap: Object.fromEntries(
        Object.entries(boundary.workspaceRootMap).map(([workspaceId, roots]) => [workspaceId, roots.map((root) => root.path)])
      ),
      isolationMode: boundary.isolationMode,
      requireDeclaredTenantId: boundary.requireDeclaredTenantId,
      requireDeclaredWorkspaceId: boundary.requireDeclaredWorkspaceId,
      missingPermissions: boundary.missingPermissions,
      writePermissionMode: boundary.writePermissionMode,
      requireScopedWritePermissions: boundary.requireScopedWritePermissions,
      scopedPermissionGrantCount: boundary.scopedPermissionGrants.length
    },
    operationalHealth: {
      version: operationalHealth.version,
      checkedAt: operationalHealth.checkedAt,
      status: operationalHealth.status,
      commitAllowed: operationalHealth.commitAllowed,
      summary: operationalHealth.summary,
      badgeTone: operationalHealth.status === 'failed' ? 'danger' : operationalHealth.status === 'degraded' ? 'warning' : 'success',
      failureReasons: operationalHealth.failureReasons,
      degradedReasons: operationalHealth.degradedReasons,
      degradedMode: operationalHealth.degradedMode,
      observedHealth: operationalHealth.observedHealth,
      retry: operationalHealth.retry,
      actionableErrors: operationalHealth.actionableErrors
    },
    reporting: {
      version: analyticsReport.version,
      counters: analyticsReport.counters,
      deltas: analyticsReport.deltas,
      trend: analyticsReport.trend,
      approvalBoundary: analyticsReport.approvalBoundary,
      currentSnapshot: analyticsReport.currentSnapshot,
      timeline: analyticsReport.timeline,
      exportRows: analyticsReport.exportRows,
      exportSummary: analyticsReport.exportSummary,
      exportManifest: analyticsReport.exportManifest,
      historyDepth: analyticsReport.history.length,
      exportActions: [
        {
          id: 'export-guard-analytics-json',
          label: 'Export analytics JSON',
          format: 'json',
          enabled: analyticsReport.exportManifest.state === 'ready',
          payloadPointer: '/analytics/exportSummary'
        },
        {
          id: 'export-guard-preview-csv',
          label: 'Export preview CSV',
          format: 'csv',
          enabled: analyticsReport.exportManifest.state === 'ready'
            && analyticsReport.exportManifest.artifacts.some((artifact) => artifact.format === 'csv' && artifact.ready),
          columns: analyticsReport.exportSummary.csvColumns,
          payloadPointer: '/analytics/exportRows'
        },
        {
          id: 'export-guard-timeline-json',
          label: 'Export timeline JSON',
          format: 'timeline',
          enabled: analyticsReport.exportManifest.state === 'ready'
            && analyticsReport.exportManifest.artifacts.some((artifact) => artifact.format === 'timeline' && artifact.ready),
          payloadPointer: '/analytics/timeline'
        }
      ]
    },
    restartStatus: {
      state: restartStatus.state,
      restartSafe: restartStatus.restartSafe,
      recoveryMode: restartStatus.recoveryMode,
      previousRevision: restartStatus.previousRevision,
      previousStatus: restartStatus.previousStatus,
      blockers: restartStatus.blockers,
      stale: restartStatus.stale,
      fingerprintMatches: restartStatus.fingerprintMatches,
      persistedPreviewFingerprint: restartStatus.persistedPreviewFingerprint,
      recoveryToken: restartStatus.recoveryToken,
      replayToken: restartStatus.replayToken,
      checkpointedAt: restartStatus.checkpointedAt,
      recoveredWriteCount: restartStatus.recoveredWriteCount,
      idempotentReplay: restartStatus.idempotentReplay,
      replayedCommandId: restartStatus.replayedCommandId,
      replaySemantics: restartStatus.replaySemantics,
      recoveryPlan: restartStatus.recoveryPlan,
      lastPersistedCommand: restartStatus.lastPersistedCommand
    },
    workflowDestination: {
      surface: destination.surface,
      panel: destination.panel,
      mode: destination.mode,
      actionId: destination.actionId,
      commandTransport: destination.commandTransport,
      resumeToken: destination.resumeToken,
      canInlineAccept: destination.canInlineAccept,
      runtimeAdoption: destination.runtimeAdoption
    },
    nextSteps: nextSteps.map((step, index) => ({
      ...step,
      ordinal: index + 1,
      visible: true,
      targetWriteIds: step.writeIds || (step.id === 'remove-external-targets'
        ? previewRows.filter((row) => row.blocked).map((row) => row.id)
        : [])
    })),
    nextStepContracts,
    clientRuntimeAdoption,
    routePatch: {
      'externalWriteGuard.review.readiness': readiness.state,
      'externalWriteGuard.review.canCommit': readiness.canCommit,
      'externalWriteGuard.review.primaryActionId': readiness.canCommit ? 'commit-guarded-writes' : nextSteps[0]?.id || '',
      'externalWriteGuard.review.readinessChecklistState': readinessChecklist.state,
      'externalWriteGuard.review.blockedCheckIds': readinessChecklist.checks.filter((check) => check.state === 'blocked').map((check) => check.id),
      'externalWriteGuard.review.nextStepContractIds': nextStepContracts.contracts.map((contract) => contract.id),
      'externalWriteGuard.review.previewAcceptanceState': previewAcceptanceContract.state,
      'externalWriteGuard.review.previewAcceptanceSelectedWriteIds': previewAcceptanceContract.selectedWriteIds,
      'externalWriteGuard.review.previewAcceptanceBlockedCheckIds': previewAcceptanceContract.blockedCheckIds,
      'externalWriteGuard.review.previewAcceptanceCommandIds': previewAcceptanceContract.commandContracts.map((contract) => contract.commandId),
      'externalWriteGuard.review.previewAcceptanceCommandTypes': previewAcceptanceContract.commandContracts.map((contract) => contract.commandType),
      'externalWriteGuard.provider.serviceContract.valid': providerContract.serviceContract.valid,
      'externalWriteGuard.provider.serviceContract.violations': providerContract.serviceContract.violations,
      'externalWriteGuard.provider.capabilityNegotiation.enforced': providerContract.serviceContract.capabilityNegotiation.enforceWriteCapabilities,
      'externalWriteGuard.provider.capabilityNegotiation.missingWriteCapabilityIds': providerContract.serviceContract.capabilityNegotiation.missingWriteCapabilityIds,
      'externalWriteGuard.provider.sync.current': providerContract.serviceContract.providerSync.current,
      'externalWriteGuard.provider.sync.acknowledged': providerContract.serviceContract.providerSync.acknowledged,
      'externalWriteGuard.provider.sync.pendingReasons': providerContract.serviceContract.providerSync.pendingReasons,
      'externalWriteGuard.provider.sync.expectedCursor': providerContract.serviceContract.providerSync.expectedCursor,
      'externalWriteGuard.provider.handoff.manifestId': providerContract.handoff.manifest.manifestId,
      'externalWriteGuard.provider.handoff.manifestState': providerContract.handoff.manifest.state,
      'externalWriteGuard.provider.handoff.blockedWriteIds': providerContract.handoff.manifest.blockedWriteIds,
      'externalWriteGuard.provider.externalAck.state': providerContract.serviceContract.externalAck.state,
      'externalWriteGuard.provider.externalAck.handoffId': providerContract.serviceContract.externalAck.handoffId,
      'externalWriteGuard.lifecycle.enabled': lifecycleSettings.enabled,
      'externalWriteGuard.lifecycle.mode': lifecycleSettings.mode,
      'externalWriteGuard.lifecycle.nextActionId': lifecycleSettings.nextLifecycleAction,
      'externalWriteGuard.lifecycle.nextActionReason': lifecycleSettings.nextLifecycleActionReason,
      'externalWriteGuard.lifecycle.scheduleState': lifecycleSettings.scheduleState,
      'externalWriteGuard.lifecycle.paused': lifecycleSettings.paused,
      'externalWriteGuard.lifecycle.commitDeferred': lifecycleSettings.commitDeferred,
      'externalWriteGuard.lifecycle.validationErrors': lifecycleSettings.validationErrors,
      'externalWriteGuard.lifecycle.commandTypes': lifecycleSettings.commandPolicy.supportedCommandTypes,
      'externalWriteGuard.lifecycle.lastCommandBoundary': commandStatus.lifecycleCommandBoundary || { checked: false },
      'externalWriteGuard.lifecycle.nextCommandAfterRejection': commandStatus.nextActionAfterRejection || '',
      'externalWriteGuard.boundary.tenantId': boundary.tenantId,
      'externalWriteGuard.boundary.workspaceId': boundary.workspaceId,
      'externalWriteGuard.boundary.isolationMode': boundary.isolationMode,
      'externalWriteGuard.boundary.requireDeclaredTenantId': boundary.requireDeclaredTenantId,
      'externalWriteGuard.boundary.requireDeclaredWorkspaceId': boundary.requireDeclaredWorkspaceId,
      'externalWriteGuard.boundary.scopeEvidenceByWriteId': Object.fromEntries(previewRows.map((row) => [row.id, row.scopeEvidence])),
      'externalWriteGuard.boundary.permissionEvidenceByWriteId': Object.fromEntries(previewRows.map((row) => [row.id, row.permissionEvidence])),
      'externalWriteGuard.boundary.writePermissionMode': boundary.writePermissionMode,
      'externalWriteGuard.boundary.requireScopedWritePermissions': boundary.requireScopedWritePermissions,
      'externalWriteGuard.operationalHealth.status': operationalHealth.status,
      'externalWriteGuard.operationalHealth.commitAllowed': operationalHealth.commitAllowed,
      'externalWriteGuard.operationalHealth.summary': operationalHealth.summary,
      'externalWriteGuard.operationalHealth.failureReasons': operationalHealth.failureReasons,
      'externalWriteGuard.operationalHealth.degradedReasons': operationalHealth.degradedReasons,
      'externalWriteGuard.operationalHealth.observedHealth': operationalHealth.observedHealth,
      'externalWriteGuard.operationalHealth.observedStale': operationalHealth.observedHealth.stale,
      'externalWriteGuard.operationalHealth.retryBackoffActive': operationalHealth.observedHealth.retryBackoffActive,
      'externalWriteGuard.operationalHealth.retryable': operationalHealth.retry.retryable,
      'externalWriteGuard.operationalHealth.nextRetryAt': operationalHealth.retry.nextRetryAt,
      'externalWriteGuard.operationalHealth.actionableErrorCodes': operationalHealth.actionableErrors.map((error) => error.code),
      'externalWriteGuard.analytics.counters': analyticsReport.counters,
      'externalWriteGuard.analytics.deltas': analyticsReport.deltas,
      'externalWriteGuard.analytics.trend': analyticsReport.trend,
      'externalWriteGuard.analytics.historyDepth': analyticsReport.history.length,
      'externalWriteGuard.analytics.currentSnapshotId': analyticsReport.currentSnapshot.id,
      'externalWriteGuard.analytics.exportFormat': analyticsReport.exportSummary.format,
      'externalWriteGuard.analytics.exportManifestId': analyticsReport.exportManifest.manifestId,
      'externalWriteGuard.analytics.exportManifestState': analyticsReport.exportManifest.state,
      'externalWriteGuard.analytics.exportManifestBlockers': analyticsReport.exportManifest.blockers,
      'externalWriteGuard.analytics.exportRowCount': analyticsReport.exportRows.length,
      'externalWriteGuard.analytics.riskBucketCounts': analyticsReport.exportSummary.riskBucketCounts,
      'externalWriteGuard.restart.state': restartStatus.state,
      'externalWriteGuard.restart.safe': restartStatus.restartSafe,
      'externalWriteGuard.restart.blockers': restartStatus.blockers,
      'externalWriteGuard.restart.fingerprintMatches': restartStatus.fingerprintMatches,
      'externalWriteGuard.restart.persistedPreviewFingerprint': restartStatus.persistedPreviewFingerprint,
      'externalWriteGuard.restart.recoveryToken': restartStatus.recoveryToken,
      'externalWriteGuard.restart.replayToken': restartStatus.replayToken,
      'externalWriteGuard.restart.checkpointedAt': restartStatus.checkpointedAt,
      'externalWriteGuard.restart.idempotentReplay': restartStatus.idempotentReplay,
      'externalWriteGuard.restart.replayAllowedToMutateState': restartStatus.replaySemantics.allowedToMutateState,
      'externalWriteGuard.review.pendingAcceptanceIds': acceptance.missingWriteIds,
      'externalWriteGuard.review.staleAcceptanceIds': acceptance.staleAcceptedWriteIds,
      'externalWriteGuard.review.explicitApprovalMissingIds': acceptance.explicitApprovalMissingWriteIds,
      'externalWriteGuard.review.approvalProofMissingIds': acceptance.approvalProofMissingWriteIds,
      'externalWriteGuard.review.approvalProofIntentMismatchIds': acceptance.approvalProofIntentMismatchWriteIds,
      'externalWriteGuard.review.approvalProofStageMismatchIds': acceptance.approvalProofStageMismatchWriteIds,
      'externalWriteGuard.review.approvalProofFingerprintMismatchIds': acceptance.approvalProofFingerprintMismatchWriteIds,
      'externalWriteGuard.review.approvalProofScopeMismatchIds': acceptance.approvalProofScopeMismatchWriteIds,
      'externalWriteGuard.review.approvalBoundarySummary': acceptance.approvalBoundarySummary,
      'externalWriteGuard.review.acceptancePhaseByWriteId': acceptance.approvalBoundarySummary.byWriteId,
      'externalWriteGuard.review.draftStageWriteIds': acceptance.draftStageWriteIds,
      'externalWriteGuard.review.sendStageWriteIds': acceptance.sendStageWriteIds,
      'externalWriteGuard.review.commitReadyWriteIds': acceptance.commitReadyWriteIds,
      'externalWriteGuard.review.approvalBoundary': acceptance.approvalBoundary,
      'externalWriteGuard.review.expiredAcceptanceIds': acceptance.expiredWriteIds,
      'externalWriteGuard.review.currentWriteFingerprints': acceptance.currentWriteFingerprints,
      'externalWriteGuard.review.acceptedWriteFingerprints': acceptance.acceptedWriteFingerprints,
      'externalWriteGuard.review.acceptedWriteApprovalProofs': acceptance.acceptedWriteApprovalProofs,
      'externalWriteGuard.review.acceptanceExpiresAtByWriteId': acceptance.expiresAtByWriteId,
      'externalWriteGuard.review.blockedWriteIds': blockedWriteIds,
      'externalWriteGuard.workflow.surface': destination.surface,
      'externalWriteGuard.workflow.panel': destination.panel,
      'externalWriteGuard.workflow.actionId': destination.actionId,
      'externalWriteGuard.workflow.resumeToken': destination.resumeToken,
      'externalWriteGuard.runtimeAdoption.mode': clientRuntimeAdoption.mode,
      'externalWriteGuard.runtimeAdoption.routePatchPath': clientRuntimeAdoption.routePatch.path,
      'externalWriteGuard.runtimeAdoption.commandQueuePath': clientRuntimeAdoption.commandQueue.path,
      'externalWriteGuard.runtimeAdoption.canApplyRoutePatch': clientRuntimeAdoption.routePatch.apply,
      'externalWriteGuard.runtimeAdoption.canQueueCommand': clientRuntimeAdoption.commandQueue.enqueue,
      'externalWriteGuard.runtimeAdoption.queueableActionIds': clientRuntimeAdoption.commandPolicy.queueableActionIds,
      'externalWriteGuard.runtimeAdoption.rejectedActionIds': clientRuntimeAdoption.commandPolicy.rejectedActionIds,
      'externalWriteGuard.runtimeAdoption.commandEligibility': clientRuntimeAdoption.commandPolicy.eligibilityByAction,
      'externalWriteGuard.runtimeAdoption.handoffFallbackRequired': clientRuntimeAdoption.handoffFallback.required,
      'externalWriteGuard.runtimeAdoption.handoffInstructions': clientRuntimeAdoption.handoffFallback.instructions,
      'externalWriteGuard.runtimeAdoption.missingCapabilities': clientRuntimeAdoption.missingCapabilities,
      'externalWriteGuard.runtimeAdoption.blockedReason': clientRuntimeAdoption.blockedReason
    }
  };
}

function buildRecoveryStatus(input, persistedState, previewWrites) {
  const suppliedWrites = toArray(input.proposedWrites).length;
  if (suppliedWrites > 0) {
    return {
      mode: 'fresh-preview',
      recovered: false,
      reason: 'request-supplied-proposed-writes'
    };
  }
  if (persistedState.hasRecoverablePreview) {
    return {
      mode: 'recovered-preview',
      recovered: true,
      reason: 'restored-preview-from-persisted-state',
      recoveredWriteCount: previewWrites.length,
      previousStatus: persistedState.previousStatus
    };
  }
  return {
    mode: 'empty-preview',
    recovered: false,
    reason: 'no-request-or-persisted-preview'
  };
}

function buildRecoveryGuard(now, requestContext, persistedState, recoveryStatus, previewWrites) {
  if (!recoveryStatus.recovered) {
    return {
      routeMatches: true,
      requestMatches: true,
      fingerprintMatches: true,
      envelopeRouteMatches: true,
      envelopeRequestMatches: true,
      stale: false,
      ageMs: null,
      maxRecoverableAgeMs: 24 * 60 * 60 * 1000,
      blockers: []
    };
  }
  const previewFingerprint = fingerprintPreviewWrites(previewWrites);
  const envelope = persistedState.recoveryEnvelope;
  const routeMatches = !persistedState.route || persistedState.route === requestContext.route;
  const requestMatches = !persistedState.requestId || !requestContext.requestId || persistedState.requestId === requestContext.requestId;
  const envelopeRouteMatches = !envelope.route || envelope.route === requestContext.route;
  const envelopeRequestMatches = !envelope.requestId || !requestContext.requestId || envelope.requestId === requestContext.requestId;
  const persistedFingerprint = persistedState.previewFingerprint || envelope.previewFingerprint;
  const fingerprintMatches = !persistedFingerprint || !previewFingerprint || persistedFingerprint === previewFingerprint;
  const updatedAt = persistedState.updatedAt || envelope.checkpointedAt || persistedState.recoveredAt || '';
  const ageMs = updatedAt ? elapsedSince(updatedAt, now) : null;
  const maxRecoverableAgeMs = 24 * 60 * 60 * 1000;
  const stale = ageMs !== null && ageMs > maxRecoverableAgeMs;
  return {
    routeMatches,
    requestMatches,
    envelopeRouteMatches,
    envelopeRequestMatches,
    fingerprintMatches,
    stale,
    ageMs,
    maxRecoverableAgeMs,
    blockers: [
      ...(!routeMatches ? ['persisted-route-mismatch'] : []),
      ...(!requestMatches ? ['persisted-request-mismatch'] : []),
      ...(!envelopeRouteMatches ? ['recovery-envelope-route-mismatch'] : []),
      ...(!envelopeRequestMatches ? ['recovery-envelope-request-mismatch'] : []),
      ...(!fingerprintMatches ? ['persisted-preview-fingerprint-mismatch'] : []),
      ...(stale ? ['persisted-preview-stale'] : [])
    ]
  };
}

function fingerprintPreviewWrites(previewWrites) {
  return previewWrites
    .map((write) => [
      write.id,
      write.scheme,
      write.operation,
      write.uri,
      write.bytes === null ? '' : write.bytes,
      write.decision,
      write.reason,
      write.tenantId,
      write.workspaceId
    ].join('~'))
    .join('|');
}

function buildRestartRecoveryPlan(persistedState, restartState, recoveryStatus, recoveryGuard, previewWrites, commandStatus, readiness, acceptance, previewFingerprint) {
  const blockedReasons = [...recoveryGuard.blockers];
  const commandReplay = commandStatus.idempotentReplay === true;
  const hasPreview = previewWrites.length > 0;
  const recoverablePreview = recoveryStatus.recovered && blockedReasons.length === 0;
  const missingAcceptanceWriteIds = normalizeStringList(acceptance?.missingWriteIds);
  const commitBlockedWriteIds = normalizeStringList(acceptance?.commitBlockedWriteIds);
  const safeToResumePreview = ['fresh', 'recovered', 'replay'].includes(restartState) && hasPreview;
  const baseCommandId = [
    persistedState.stateKey,
    'recovery',
    restartState,
    previewFingerprint || 'empty'
  ].join(':');
  const nextCommandType = commandReplay
    ? ''
    : blockedReasons.length
      ? 'submit-proposed-writes'
      : !hasPreview
        ? 'submit-proposed-writes'
        : missingAcceptanceWriteIds.length
          ? 'accept-preview'
          : readiness?.canCommit
            ? 'commit-guarded-writes'
            : commitBlockedWriteIds.length
              ? 'accept-preview'
              : '';
  const nextCommandWriteIds = nextCommandType === 'accept-preview'
    ? (missingAcceptanceWriteIds.length ? missingAcceptanceWriteIds : commitBlockedWriteIds)
    : nextCommandType === 'commit-guarded-writes'
      ? normalizeStringList(acceptance?.commitReadyWriteIds)
      : [];
  const action = commandReplay
    ? 'return-persisted-command-result'
    : blockedReasons.length
      ? 'discard-recovered-preview-and-resubmit'
      : !hasPreview
        ? 'submit-new-preview'
        : missingAcceptanceWriteIds.length
          ? 'resume-preview-and-request-acceptance'
          : readiness?.canCommit
            ? 'resume-preview-and-request-commit'
            : recoverablePreview
              ? 'resume-preview-awaiting-remediation'
              : 'await-preview';
  const nextCommandId = nextCommandType ? `${baseCommandId}:${nextCommandType}` : '';
  return {
    version: 1,
    state: restartState,
    action,
    status: commandReplay
      ? 'idempotent-command-result-available'
      : blockedReasons.length
        ? 'manual-resubmission-required'
        : safeToResumePreview
          ? 'restart-safe'
          : 'waiting-for-preview',
    generatedAt: '',
    idempotencyKey: `${baseCommandId}:${action}`,
    previousAction: persistedState.previousRecoveryPlan.action,
    changedSinceLastCheckpoint: persistedState.previousRecoveryPlan.action
      ? persistedState.previousRecoveryPlan.action !== action
        || persistedState.previousRecoveryPlan.idempotencyKey !== `${baseCommandId}:${action}`
      : false,
    safeToResumePreview,
    safeToReplayCommandResult: commandReplay,
    requiresExplicitUserAction: !commandReplay && (blockedReasons.length > 0 || Boolean(nextCommandType)),
    blockedReasons,
    recoveredWriteIds: recoverablePreview ? previewWrites.map((write) => write.id) : [],
    discardedRecoveredWriteIds: blockedReasons.length ? previewWrites.map((write) => write.id) : [],
    nextCommandType,
    nextCommandId,
    nextCommandWriteIds,
    nextCommand: nextCommandType ? {
      id: nextCommandId,
      type: nextCommandType,
      writeIds: nextCommandWriteIds,
      recoveryToken: persistedState.recoveryEnvelope.recoveryToken || `${persistedState.stateKey}:recover:${persistedState.previousRevision}`,
      replaySafe: !commandReplay,
      requiresFreshExplicitApproval: ['accept-preview', 'commit-guarded-writes'].includes(nextCommandType),
      reason: action
    } : null,
    replayedCommandResult: commandReplay ? {
      commandId: commandStatus.id,
      commandType: commandStatus.type,
      result: commandStatus.persistedResult || 'applied',
      source: commandStatus.persistedResultSource,
      appliedAt: commandStatus.previousAppliedAt,
      stateRevision: commandStatus.previousStateRevision,
      replayCount: commandStatus.previousReplayCount + 1
    } : null
  };
}

function buildRestartStatus(persistedState, recoveryStatus, recoveryGuard, previewWrites, commandStatus, readiness, acceptance) {
  const blockers = recoveryGuard.blockers;
  const recovered = recoveryStatus.recovered && blockers.length === 0;
  const restartState = commandStatus.idempotentReplay
    ? 'replay'
    : blockers.includes('persisted-preview-fingerprint-mismatch')
      ? 'forked'
      : recoveryGuard.stale
        ? 'stale'
        : recoveryStatus.mode === 'fresh-preview'
          ? 'fresh'
          : recovered
            ? 'recovered'
            : recoveryStatus.recovered
              ? 'recovery-blocked'
              : 'empty';
  const lastCommand = persistedState.commandLedger[persistedState.commandLedger.length - 1] || null;
  const previewFingerprint = fingerprintPreviewWrites(previewWrites);
  const recoveryPlan = buildRestartRecoveryPlan(
    persistedState,
    restartState,
    recoveryStatus,
    recoveryGuard,
    previewWrites,
    commandStatus,
    readiness,
    acceptance,
    previewFingerprint
  );
  return {
    version: 1,
    state: restartState,
    restartSafe: ['fresh', 'recovered', 'replay'].includes(restartState),
    recovered,
    recoveryMode: recoveryStatus.mode,
    previousStatus: persistedState.previousStatus,
    previousRevision: persistedState.previousRevision,
    stateKey: persistedState.stateKey,
    routeMatches: recoveryGuard.routeMatches,
    requestMatches: recoveryGuard.requestMatches,
    envelopeRouteMatches: recoveryGuard.envelopeRouteMatches,
    envelopeRequestMatches: recoveryGuard.envelopeRequestMatches,
    fingerprintMatches: recoveryGuard.fingerprintMatches,
    stale: recoveryGuard.stale,
    ageMs: recoveryGuard.ageMs,
    maxRecoverableAgeMs: recoveryGuard.maxRecoverableAgeMs,
    blockers,
    previewFingerprint,
    persistedPreviewFingerprint: persistedState.previewFingerprint || persistedState.recoveryEnvelope.previewFingerprint,
    recoveredWriteCount: recoveryStatus.recoveredWriteCount || 0,
    idempotentReplay: commandStatus.idempotentReplay === true,
    replayedCommandId: commandStatus.idempotentReplay ? commandStatus.id : '',
    replayToken: commandStatus.idempotentReplay
      ? persistedState.recoveryEnvelope.replayToken || `${persistedState.stateKey}:replay:${commandStatus.id}`
      : '',
    recoveryToken: persistedState.recoveryEnvelope.recoveryToken || `${persistedState.stateKey}:recover:${persistedState.previousRevision}`,
    checkpointedAt: persistedState.recoveryEnvelope.checkpointedAt || persistedState.updatedAt,
    lastPersistedCommand: lastCommand ? {
      id: lastCommand.id,
      type: lastCommand.type,
      result: lastCommand.result,
      appliedAt: lastCommand.appliedAt,
      stateRevision: lastCommand.stateRevision,
      replayCount: lastCommand.replayCount,
      commitApprovalBoundary: lastCommand.commitApprovalBoundary || { checked: false },
      lifecycleCommandBoundary: lastCommand.lifecycleCommandBoundary || { checked: false }
    } : null,
    replaySemantics: {
      receivedCommandId: commandStatus.id || '',
      alreadyApplied: commandStatus.idempotentReplay === true,
      allowedToMutateState: commandStatus.applied === true,
      commitApprovalBoundary: commandStatus.commitApprovalBoundary || { checked: false },
      lifecycleCommandBoundary: commandStatus.lifecycleCommandBoundary || { checked: false },
      persistedResult: commandStatus.persistedResult || '',
      persistedResultSource: commandStatus.persistedResultSource || '',
      previousAppliedAt: commandStatus.previousAppliedAt || '',
      previousStateRevision: commandStatus.previousStateRevision || 0,
      previousReplayCount: commandStatus.previousReplayCount || 0,
      persistedCommandIds: persistedState.recoveryEnvelope.persistedCommandIds.length
        ? persistedState.recoveryEnvelope.persistedCommandIds
        : persistedState.appliedCommandIds
    },
    recoveryPlan,
    statusSemantics: {
      fresh: 'request supplied a new write preview and increments persisted revision',
      recovered: 'preview restored from compatible persisted state without incrementing revision',
      replay: 'received command was already applied and must not mutate persisted state again',
      stale: 'persisted preview exists but is older than the restart recovery window',
      forked: 'persisted recovery fingerprint does not match the recovered preview',
      'recovery-blocked': 'persisted preview exists but route, request, or freshness checks failed',
      empty: 'no request preview or persisted preview was available'
    }
  };
}

function buildCommandStatus(command, persistedState, acceptedWriteIds, previewWrites, readiness, acceptance, lifecycleSettings, now, lifecycleCommandBoundaryOverride = null) {
  if (!command) {
    return {
      received: false,
      applied: false,
      idempotentReplay: false,
      commitApprovalBoundary: { checked: false },
      lifecycleCommandBoundary: { checked: false }
    };
  }
  const knownWriteIds = new Set(previewWrites.map((write) => write.id));
  const writeScopedCommand = ['accept-preview', 'clear-acceptance', 'commit-guarded-writes'].includes(command.type);
  const unknownWriteIds = writeScopedCommand ? command.writeIds.filter((id) => !knownWriteIds.has(id)) : [];
  const persistedCommandRecord = commandPersistenceRecord(command, persistedState);
  const idempotentReplay = Boolean(persistedCommandRecord);
  const supported = [
    'accept-preview',
    'clear-acceptance',
    'commit-guarded-writes',
    'retry-operational-health-check',
    ...LIFECYCLE_COMMAND_TYPES
  ].includes(command.type);
  const commitApprovalBoundary = buildCommitApprovalCommandBoundary(command, acceptance, readiness);
  const commitRejected = command.type === 'commit-guarded-writes' && !commitApprovalBoundary.ok;
  const lifecycleCommandBoundary = lifecycleCommandBoundaryOverride?.checked
    ? lifecycleCommandBoundaryOverride
    : buildLifecycleCommandBoundary(command, persistedState, lifecycleSettings, idempotentReplay, now);
  const lifecycleRejected = lifecycleCommandBoundary.checked && !lifecycleCommandBoundary.ok;
  const commitRejectedReason = commitApprovalBoundary.rejectedReason
    || (readiness.blockers.includes('missing-explicit-send-approval')
      ? 'missing-explicit-send-approval'
      : readiness.blockers.includes('draft-writes-not-send-ready')
        ? 'draft-writes-not-send-ready'
        : 'not-ready-to-commit');
  return {
    received: true,
    id: command.id,
    type: command.type,
    issuedAt: command.issuedAt,
    reason: command.reason,
    writeIds: command.writeIds,
    applied: supported && !idempotentReplay && !unknownWriteIds.length && !commitRejected && !lifecycleRejected,
    idempotentReplay,
    acceptedWriteIds,
    unknownWriteIds,
    commitApprovalBoundary,
    lifecycleCommandBoundary,
    nextActionAfterRejection: lifecycleRejected
      ? lifecycleCommandBoundary.nextAction
      : commitRejected
        ? 'commit-guarded-writes'
        : unknownWriteIds.length
          ? 'submit-proposed-writes'
          : '',
    persistedResult: persistedCommandRecord?.result || '',
    persistedResultSource: persistedCommandRecord?.source || '',
    previousAppliedAt: persistedCommandRecord?.appliedAt || '',
    previousStateRevision: persistedCommandRecord?.stateRevision || 0,
    previousReplayCount: persistedCommandRecord?.replayCount || 0,
    rejectedReason: !supported
      ? 'unsupported-command'
      : unknownWriteIds.length
        ? 'unknown-write-ids'
        : commitRejected
          ? commitRejectedReason
          : lifecycleRejected
            ? lifecycleCommandBoundary.rejectedReason
          : ''
  };
}

function buildPersistedStatePatch(now, requestContext, persistedState, recoveryStatus, restartStatus, commandStatus, previewWrites, acceptance, readiness, validationSummary, providerContract, lifecycleSettings, analyticsReport, operationalHealth, boundary) {
  const appliedCommandIds = new Set(persistedState.appliedCommandIds);
  if (commandStatus.applied && commandStatus.id) {
    appliedCommandIds.add(commandStatus.id);
  }
  if (commandStatus.idempotentReplay && commandStatus.id) {
    appliedCommandIds.add(commandStatus.id);
  }
  const revision = persistedState.previousRevision + (commandStatus.applied || recoveryStatus.mode === 'fresh-preview' ? 1 : 0);
  const status = readiness.canCommit ? 'ready' : readiness.blockers.includes('blocked-external-write-targets') ? 'blocked' : 'pending';
  const commandLedger = [...persistedState.commandLedger];
  if (commandStatus.received) {
    const priorIndex = commandLedger.findIndex((entry) => entry.id === commandStatus.id);
    const prior = priorIndex >= 0 ? commandLedger[priorIndex] : null;
    const replayCount = commandStatus.idempotentReplay
      ? Math.max(prior?.replayCount || 0, commandStatus.previousReplayCount || 0) + 1
      : prior?.replayCount || 0;
    const replayedStateRevision = commandStatus.idempotentReplay
      ? commandStatus.previousStateRevision || prior?.stateRevision || revision
      : revision;
    const ledgerEntry = {
      id: commandStatus.id,
      type: commandStatus.type,
      issuedAt: normalizeIsoInstant(commandStatus.issuedAt),
      appliedAt: commandStatus.applied ? now : prior?.appliedAt || commandStatus.previousAppliedAt || '',
      result: commandStatus.applied
        ? 'applied'
        : commandStatus.idempotentReplay
          ? 'idempotent-replay'
          : 'rejected',
      replayCount,
      writeIds: normalizeStringList(commandStatus.writeIds),
      stateRevision: replayedStateRevision,
      readinessState: readiness.state,
      rejectedReason: commandStatus.rejectedReason || '',
      commitApprovalBoundary: commandStatus.commitApprovalBoundary || { checked: false },
      lifecycleCommandBoundary: commandStatus.lifecycleCommandBoundary || { checked: false },
      recoveryMode: restartStatus.recoveryMode
    };
    if (priorIndex >= 0) {
      commandLedger.splice(priorIndex, 1, ledgerEntry);
    } else {
      commandLedger.push(ledgerEntry);
    }
  }
  return {
    version: PERSISTED_STATE_VERSION,
    stateKey: persistedState.stateKey,
    revision,
    status,
    updatedAt: now,
    route: requestContext.route,
    requestId: requestContext.requestId,
    client: {
      id: requestContext.client.id,
      sessionId: requestContext.client.sessionId,
      channel: requestContext.channel,
      workflowSurface: requestContext.workflow.currentSurface,
      workflowPanel: requestContext.workflow.currentPanel,
      workflowCorrelationId: requestContext.workflow.correlationId
    },
    clientRuntime: {
      runtimeId: requestContext.clientRuntime.runtimeId,
      runtimeVersion: requestContext.clientRuntime.runtimeVersion,
      statePathPrefix: requestContext.clientRuntime.statePathPrefix,
      routePatchPath: requestContext.clientRuntime.routePatchPath,
      commandQueuePath: requestContext.clientRuntime.commandQueuePath,
      supportsRoutePatch: requestContext.clientRuntime.supportsRoutePatch,
      supportsCommandQueue: requestContext.clientRuntime.supportsCommandQueue,
      supportsWorkflowHandoff: requestContext.clientRuntime.supportsWorkflowHandoff,
      supportsInlineReview: requestContext.clientRuntime.supportsInlineReview,
      capabilities: requestContext.clientRuntime.capabilities,
      adoptionToken: requestContext.clientRuntime.adoptionToken
    },
    recoveryMode: recoveryStatus.mode,
    recoveryEnvelope: {
      version: 1,
      state: restartStatus.state,
      stateKey: persistedState.stateKey,
      route: requestContext.route,
      requestId: requestContext.requestId,
      checkpointedAt: now,
      revision,
      previewFingerprint: restartStatus.previewFingerprint,
      recoveryToken: restartStatus.recoveryToken,
      replayToken: commandStatus.id
        ? `${persistedState.stateKey}:replay:${commandStatus.id}:${revision}`
        : persistedState.recoveryEnvelope.replayToken,
      commitToken: readiness.canCommit ? `${persistedState.stateKey}:commit:${revision}:${restartStatus.previewFingerprint}` : '',
      lastAppliedCommandId: commandStatus.applied
        ? commandStatus.id
        : persistedState.recoveryEnvelope.lastAppliedCommandId,
      persistedCommandIds: [...appliedCommandIds],
      recoveryPlan: {
        ...restartStatus.recoveryPlan,
        generatedAt: now
      },
      commandResults: Object.fromEntries(commandLedger.slice(-12).map((entry) => [entry.id, {
        result: entry.result,
        appliedAt: entry.appliedAt,
        stateRevision: entry.stateRevision,
        replayCount: entry.replayCount,
        readinessState: entry.readinessState,
        recoveryMode: entry.recoveryMode,
        rejectedReason: entry.rejectedReason,
        commitApprovalBoundary: entry.commitApprovalBoundary || { checked: false },
        lifecycleCommandBoundary: entry.lifecycleCommandBoundary || { checked: false }
      }]))
    },
    restartStatus: {
      version: restartStatus.version,
      state: restartStatus.state,
      restartSafe: restartStatus.restartSafe,
      recovered: restartStatus.recovered,
      routeMatches: restartStatus.routeMatches,
      requestMatches: restartStatus.requestMatches,
      envelopeRouteMatches: restartStatus.envelopeRouteMatches,
      envelopeRequestMatches: restartStatus.envelopeRequestMatches,
      fingerprintMatches: restartStatus.fingerprintMatches,
      stale: restartStatus.stale,
      ageMs: restartStatus.ageMs,
      blockers: restartStatus.blockers,
      previewFingerprint: restartStatus.previewFingerprint,
      persistedPreviewFingerprint: restartStatus.persistedPreviewFingerprint,
      idempotentReplay: restartStatus.idempotentReplay,
      replayedCommandId: restartStatus.replayedCommandId,
      recoveryToken: restartStatus.recoveryToken,
      replayToken: restartStatus.replayToken,
      checkpointedAt: restartStatus.checkpointedAt,
      recoveryPlan: {
        ...restartStatus.recoveryPlan,
        generatedAt: now
      }
    },
    recoveryPlan: {
      ...restartStatus.recoveryPlan,
      generatedAt: now
    },
    previewWrites: previewWrites.map((write) => ({
      id: write.id,
      uri: write.uri,
      scheme: write.scheme,
      operation: write.operation,
      bytes: write.bytes,
      capability: write.capability,
      reviewStage: write.reviewStage,
      draftVersion: write.draftVersion,
      draftFingerprint: write.draftFingerprint,
      draftPayloadFingerprint: write.draftPayloadFingerprint,
      approvalFingerprint: writeApprovalFingerprint(write),
      tenantId: write.tenantId,
      workspaceId: write.workspaceId,
      targetPath: write.targetPath?.path || '',
      scopeEvidence: write.scopeEvidence,
      permissionEvidence: write.permissionEvidence,
      reason: write.reason,
      decision: write.decision
    })),
    boundaryScope: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      allowedTenantIds: boundary.allowedTenantIds,
      allowedWorkspaceIds: boundary.allowedWorkspaceIds,
      workspaceRoots: boundary.workspaceRoots.map((root) => root.path),
      workspaceRootMap: Object.fromEntries(
        Object.entries(boundary.workspaceRootMap).map(([workspaceId, roots]) => [workspaceId, roots.map((root) => root.path)])
      ),
      isolationMode: boundary.isolationMode,
      requireDeclaredTenantId: boundary.requireDeclaredTenantId,
      requireDeclaredWorkspaceId: boundary.requireDeclaredWorkspaceId,
      requiredPermissions: boundary.requiredPermissions,
      missingPermissions: boundary.missingPermissions,
      scopedPermissionGrants: boundary.scopedPermissionGrants,
      operationPermissionMap: boundary.operationPermissionMap,
      writePermissionMode: boundary.writePermissionMode,
      requireScopedWritePermissions: boundary.requireScopedWritePermissions,
      permissionEvidenceByWriteId: Object.fromEntries(previewWrites.map((write) => [write.id, write.permissionEvidence]))
    },
    acceptedWriteIds: acceptance.acceptedWriteIds,
    acceptedWriteAts: acceptance.acceptedWriteAts,
    acceptedWriteFingerprints: acceptance.acceptedWriteFingerprints,
    currentWriteFingerprints: acceptance.currentWriteFingerprints,
    approvalBoundary: acceptance.approvalBoundary,
    approvalBoundarySummary: acceptance.approvalBoundarySummary,
    staleAcceptedWriteIds: acceptance.staleAcceptedWriteIds,
    explicitApprovalMissingWriteIds: acceptance.explicitApprovalMissingWriteIds,
    approvalProofIntentMismatchWriteIds: acceptance.approvalProofIntentMismatchWriteIds,
    approvalProofStageMismatchWriteIds: acceptance.approvalProofStageMismatchWriteIds,
    approvalProofFingerprintMismatchWriteIds: acceptance.approvalProofFingerprintMismatchWriteIds,
    approvalProofScopeMismatchWriteIds: acceptance.approvalProofScopeMismatchWriteIds,
    requiredWriteIds: acceptance.requiredWriteIds,
    commitStageWriteIds: acceptance.commitStageWriteIds,
    sendStageWriteIds: acceptance.sendStageWriteIds,
    draftStageWriteIds: acceptance.draftStageWriteIds,
    commitReadyWriteIds: acceptance.commitReadyWriteIds,
    requireExplicitApproval: acceptance.requireExplicitApproval,
    requireSendStageForCommit: acceptance.requireSendStageForCommit,
    expiredWriteIds: acceptance.expiredWriteIds,
    acceptanceExpiresAtByWriteId: acceptance.expiresAtByWriteId,
    appliedCommandIds: [...appliedCommandIds],
    commandLedger: commandLedger.slice(-24),
    readiness: {
      state: readiness.state,
      canCommit: readiness.canCommit,
      blockers: readiness.blockers,
      lifecycle: readiness.lifecycle
    },
    lifecycleSettings: {
      version: lifecycleSettings.version,
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      paused: lifecycleSettings.paused,
      pauseUntil: lifecycleSettings.pauseUntil,
      commitDeferred: lifecycleSettings.commitDeferred,
      deferCommitUntil: lifecycleSettings.deferCommitUntil,
      scheduledResumeAt: lifecycleSettings.scheduledResumeAt,
      scheduleReason: lifecycleSettings.scheduleReason,
      acceptanceTtlMs: lifecycleSettings.acceptanceTtlMs,
      maxAcceptanceTtlMs: lifecycleSettings.maxAcceptanceTtlMs,
      maxScheduleHorizonMs: lifecycleSettings.maxScheduleHorizonMs,
      validationErrors: lifecycleSettings.validationErrors,
      lastCommandType: lifecycleSettings.lastCommandType,
      lastCommandId: lifecycleSettings.lastCommandId,
      lastCommandPayloadKeys: lifecycleSettings.lastCommandPayloadKeys,
      lastCommandBoundary: commandStatus.lifecycleCommandBoundary || { checked: false },
      nextCommandAfterRejection: commandStatus.nextActionAfterRejection || '',
      scheduleState: lifecycleSettings.scheduleState,
      nextLifecycleAction: lifecycleSettings.nextLifecycleAction,
      nextLifecycleActionReason: lifecycleSettings.nextLifecycleActionReason,
      commandPolicy: lifecycleSettings.commandPolicy
    },
    providerSync: {
      providerId: providerContract.providerId,
      service: providerContract.service,
      contractVersion: providerContract.contractVersion,
      syncKey: providerContract.sync.syncKey,
      syncRevision: providerContract.sync.nextRevision,
      syncCursor: providerContract.sync.nextCursor,
      syncDomain: providerContract.serviceContract.syncDomain,
      expectedCursor: providerContract.serviceContract.providerSync.expectedCursor,
      writeFingerprint: providerContract.serviceContract.providerSync.writeFingerprint,
      observedRevision: providerContract.serviceContract.providerSync.observedRevision,
      observedCursor: providerContract.serviceContract.providerSync.observedCursor,
      observedWriteFingerprint: providerContract.serviceContract.providerSync.observedWriteFingerprint,
      acknowledgedRevision: providerContract.serviceContract.providerSync.acknowledgedRevision,
      acknowledgedCursor: providerContract.serviceContract.providerSync.acknowledgedCursor,
      acknowledgedWriteFingerprint: providerContract.serviceContract.providerSync.acknowledgedWriteFingerprint,
      syncCurrent: providerContract.serviceContract.providerSync.current,
      syncAcknowledged: providerContract.serviceContract.providerSync.acknowledged,
      syncPendingReasons: providerContract.serviceContract.providerSync.pendingReasons,
      lastNegotiatedAt: providerContract.negotiatedAt,
      declaredSupportedCapabilities: providerContract.declaredSupportedCapabilities,
      missingCapabilities: providerContract.missingCapabilities,
      capabilityNegotiation: providerContract.serviceContract.capabilityNegotiation,
      serviceViolations: providerContract.serviceContract.violations,
      externalAckState: providerContract.serviceContract.externalAck.state,
      externalAckToken: providerContract.serviceContract.externalAck.token,
      handoffState: providerContract.handoff.state,
      handoffManifest: providerContract.handoff.manifest
    },
    operationalHealth: {
      version: operationalHealth.version,
      checkedAt: operationalHealth.checkedAt,
      status: operationalHealth.status,
      commitAllowed: operationalHealth.commitAllowed,
      failureReasons: operationalHealth.failureReasons,
      degradedReasons: operationalHealth.degradedReasons,
      degradedMode: operationalHealth.degradedMode,
      observedHealth: operationalHealth.observedHealth,
      retry: operationalHealth.retry,
      actionableErrors: operationalHealth.actionableErrors,
      summary: operationalHealth.summary
    },
    analytics: {
      version: analyticsReport.version,
      counters: analyticsReport.counters,
      deltas: analyticsReport.deltas,
      trend: analyticsReport.trend,
      approvalBoundary: analyticsReport.approvalBoundary,
      currentSnapshot: analyticsReport.currentSnapshot,
      history: analyticsReport.history,
      exportRows: analyticsReport.exportRows,
      exportSummary: analyticsReport.exportSummary,
      exportManifest: analyticsReport.exportManifest,
      timeline: analyticsReport.timeline
    },
    analyticsHistory: analyticsReport.history,
    approvalBoundaryAnalytics: analyticsReport.approvalBoundary,
    exportRows: analyticsReport.exportRows,
    exportSummary: analyticsReport.exportSummary,
    exportManifest: analyticsReport.exportManifest,
    timelineReport: analyticsReport.timeline,
    validationSummary
  };
}

function normalizeProviderServiceContract(provider, policy, requestContext, previousProviderSync, previewWrites, ready, supportedCapabilities, syncContext = {}) {
  const serviceContract = objectValue(provider.serviceContract, provider.contract, provider.service);
  const limits = objectValue(serviceContract.limits, provider.limits);
  const supportedOperations = normalizeStringList(
    serviceContract.supportedOperations || provider.supportedOperations || provider.operations
  );
  const supportedSchemesInput = normalizeStringList(
    serviceContract.supportedSchemes || provider.supportedSchemes || provider.schemes
  );
  const supportedSchemes = supportedSchemesInput.length ? supportedSchemesInput.map((scheme) => scheme.toLowerCase()) : policy.allowedSchemes;
  const maxBatchWrites = Number.isInteger(limits.maxBatchWrites) && limits.maxBatchWrites >= 0
    ? limits.maxBatchWrites
    : null;
  const maxBytesPerWrite = Number.isFinite(limits.maxBytesPerWrite) && limits.maxBytesPerWrite >= 0
    ? Math.trunc(limits.maxBytesPerWrite)
    : null;
  const unsupportedOperationWriteIds = supportedOperations.length
    ? previewWrites.filter((write) => !supportedOperations.includes(write.operation)).map((write) => write.id)
    : [];
  const unsupportedSchemeWriteIds = supportedSchemes.length
    ? previewWrites.filter((write) => !supportedSchemes.includes(write.scheme) && write.scheme !== 'relative').map((write) => write.id)
    : [];
  const oversizedWriteIds = maxBytesPerWrite === null
    ? []
    : previewWrites.filter((write) => write.bytes !== null && write.bytes > maxBytesPerWrite).map((write) => write.id);
  const batchLimitExceeded = maxBatchWrites !== null && previewWrites.length > maxBatchWrites;
  const requiresExternalAck = normalizeBoolean(
    serviceContract.requiresExternalAck ?? provider.requiresExternalAck,
    false
  );
  const externalAckInput = objectValue(serviceContract.externalAck, provider.externalAck, provider.ack, previousProviderSync.externalAck);
  const ackState = firstString(externalAckInput.state, previousProviderSync.externalAckState, requiresExternalAck ? 'pending' : 'not-required');
  const ackToken = firstString(externalAckInput.token, externalAckInput.ackToken, previousProviderSync.externalAckToken);
  const ackHandoffId = firstString(
    externalAckInput.handoffId,
    externalAckInput.id,
    previousProviderSync.externalAckHandoffId,
    `${requestContext.requestId || 'request'}:provider-ack`
  );
  const externalAckAccepted = !requiresExternalAck || ['acknowledged', 'accepted', 'complete'].includes(ackState);
  const capabilityNegotiation = buildProviderCapabilityNegotiation(provider, serviceContract, previewWrites, supportedCapabilities);
  const dispatchBoundary = normalizeProviderDispatchBoundary(provider, serviceContract, previewWrites);
  const providerSync = normalizeProviderSyncContract(
    provider,
    serviceContract,
    previousProviderSync,
    syncContext.syncKey || `${requestContext.route}:provider-service`,
    syncContext.previousRevision || 0,
    syncContext.nextRevision || syncContext.previousRevision || 0,
    syncContext.writeFingerprint || '',
    syncContext.now || ''
  );
  const violations = [
    ...(unsupportedOperationWriteIds.length ? ['unsupported-provider-operations'] : []),
    ...(unsupportedSchemeWriteIds.length ? ['unsupported-provider-schemes'] : []),
    ...(oversizedWriteIds.length ? ['provider-write-size-limit-exceeded'] : []),
    ...(batchLimitExceeded ? ['provider-batch-limit-exceeded'] : []),
    ...(capabilityNegotiation.missingWriteCapabilityIds.length ? ['missing-provider-write-capabilities'] : []),
    ...(dispatchBoundary.blockedWriteIds.length ? ['provider-dispatch-requires-send-stage'] : []),
    ...(providerSync.required && !providerSync.current ? ['provider-sync-not-current'] : []),
    ...(providerSync.acknowledgementRequired && !providerSync.acknowledged ? ['provider-sync-ack-pending'] : [])
  ];
  const syncDomain = firstString(
    serviceContract.syncDomain,
    provider.syncDomain,
    previousProviderSync.syncDomain,
    `${requestContext.route}:provider-service`
  );
  return {
    version: 1,
    syncDomain,
    supportedOperations,
    supportedSchemes,
    maxBatchWrites,
    maxBytesPerWrite,
    unsupportedOperationWriteIds,
    unsupportedSchemeWriteIds,
    oversizedWriteIds,
    batchLimitExceeded,
    capabilityNegotiation,
    dispatchBoundary,
    providerSync,
    violations,
    valid: violations.length === 0,
    externalAck: {
      required: requiresExternalAck,
      state: ackState,
      token: ackToken,
      handoffId: ackHandoffId,
      pending: ready && requiresExternalAck && !externalAckAccepted,
      accepted: externalAckAccepted
    }
  };
}

function buildProviderHandoffManifest(requestContext, providerContractBase, previewWrites) {
  const serviceContract = providerContractBase.serviceContract;
  const capabilityEntries = new Map(
    serviceContract.capabilityNegotiation.writeCapabilityRequirements.map((entry) => [entry.writeId, entry])
  );
  const handoffWrites = previewWrites.map((write, index) => {
    const capabilityEntry = capabilityEntries.get(write.id) || {
      requiredCapabilities: [],
      missingCapabilities: [],
      satisfied: true
    };
    const blockers = [
      ...(write.decision === 'blocked' ? ['write-blocked-by-guard'] : []),
      ...(serviceContract.unsupportedOperationWriteIds.includes(write.id) ? ['unsupported-provider-operation'] : []),
      ...(serviceContract.unsupportedSchemeWriteIds.includes(write.id) ? ['unsupported-provider-scheme'] : []),
      ...(serviceContract.oversizedWriteIds.includes(write.id) ? ['provider-write-size-limit-exceeded'] : []),
      ...(capabilityEntry.missingCapabilities.length ? ['missing-provider-write-capabilities'] : []),
      ...(serviceContract.dispatchBoundary.blockedWriteIds.includes(write.id) ? ['provider-dispatch-requires-send-stage'] : [])
    ];
    const state = blockers.length
      ? 'blocked'
      : serviceContract.providerSync.pending
        ? 'awaiting-provider-sync'
        : serviceContract.externalAck.pending
          ? 'awaiting-provider-ack'
          : providerContractBase.ready
            ? 'handoff-ready'
            : 'awaiting-provider-negotiation';
    return {
      id: `${providerContractBase.sync.syncKey}:write:${index + 1}`,
      writeId: write.id,
      uri: write.uri,
      operation: write.operation,
      scheme: write.scheme,
      reviewStage: write.reviewStage,
      state,
      blockers,
      dispatchBoundary: {
        requiredReviewStage: serviceContract.dispatchBoundary.requiredReviewStage,
        sendOnlyDispatch: serviceContract.dispatchBoundary.sendOnlyDispatch,
        handoffReady: serviceContract.dispatchBoundary.handoffReadyWriteIds.includes(write.id),
        blockerReason: serviceContract.dispatchBoundary.blockedWriteIds.includes(write.id)
          ? serviceContract.dispatchBoundary.blockerReason
          : ''
      },
      syncState: serviceContract.providerSync.handoffState,
      syncPendingReasons: serviceContract.providerSync.pendingReasons,
      requiredCapabilities: capabilityEntry.requiredCapabilities,
      missingCapabilities: capabilityEntry.missingCapabilities,
      ackToken: serviceContract.externalAck.required ? serviceContract.externalAck.token : '',
      syncCursor: `${providerContractBase.sync.syncKey}:${write.id}:${state}`,
      target: {
        tenantId: write.tenantId,
        workspaceId: write.workspaceId,
        path: write.targetPath?.path || ''
      }
    };
  });
  const blockedWriteIds = handoffWrites.filter((write) => write.state === 'blocked').map((write) => write.writeId);
  return {
    version: 1,
    manifestId: `${providerContractBase.sync.syncKey}:handoff:${providerContractBase.sync.nextRevision}`,
    route: requestContext.route,
    requestId: requestContext.requestId,
    providerId: providerContractBase.providerId,
    service: providerContractBase.service,
    state: blockedWriteIds.length
      ? 'blocked'
      : serviceContract.providerSync.pending
        ? 'awaiting-provider-sync'
        : serviceContract.externalAck.pending
          ? 'awaiting-provider-ack'
          : providerContractBase.ready
            ? 'ready'
            : providerContractBase.handoff.state,
    blockedWriteIds,
    syncPendingReasons: serviceContract.providerSync.pendingReasons,
    syncExpectedCursor: serviceContract.providerSync.expectedCursor,
    syncAcknowledged: serviceContract.providerSync.acknowledged,
    dispatchBoundary: serviceContract.dispatchBoundary,
    writeCount: handoffWrites.length,
    writes: handoffWrites
  };
}

function buildProviderContract(now, input, policy, requestContext, persistedState, previewWrites) {
  const provider = input.provider && typeof input.provider === 'object'
    ? input.provider
    : input.integrationProvider && typeof input.integrationProvider === 'object'
      ? input.integrationProvider
      : input.serviceProvider && typeof input.serviceProvider === 'object'
        ? input.serviceProvider
        : {};
  const previousProviderSync = objectValue(
    input.persistedState?.providerSync,
    input.state?.capabilitySecurity?.externalWriteGuard?.providerSync,
    input.providerSync
  );
  const providerId = firstString(provider.id, provider.providerId, provider.name, input.providerId);
  const service = firstString(provider.service, provider.serviceName, provider.kind, 'external-write-provider');
  const contractVersion = firstString(provider.contractVersion, provider.version, 'external-write-guard.provider.v1');
  const declaredSupportedCapabilities = normalizeStringList(
    provider.capabilities || provider.supportedCapabilities || provider.negotiatedCapabilities
  );
  const supportedCapabilities = expandProviderCapabilities(declaredSupportedCapabilities);
  const requestedCapabilities = normalizeStringList(
    provider.requiredCapabilities || policy.providerRequiredCapabilities
  );
  const requiredCapabilities = requestedCapabilities.length ? requestedCapabilities : DEFAULT_PROVIDER_CAPABILITIES;
  const missingCapabilities = requiredCapabilities.filter((capability) => !providerHasCapability(supportedCapabilities, capability));
  const required = policy.requireProviderContract || provider.required === true || providerId !== '';
  const ready = !required || (providerId !== '' && missingCapabilities.length === 0);
  const syncRevision = Number.isInteger(previousProviderSync.syncRevision) && previousProviderSync.syncRevision >= 0
    ? previousProviderSync.syncRevision
    : 0;
  const writeFingerprint = previewWrites
    .map((write) => `${write.id}:${write.scheme}:${write.decision}:${write.targetPath?.path || write.uri}`)
    .join('|');
  const syncKey = [
    'external-write-guard.provider',
    requestContext.route,
    requestContext.requestId || persistedState.stateKey,
    providerId || service
  ].join(':');
  const handoffState = !required
    ? 'not-required'
    : ready
      ? 'negotiated'
      : providerId
        ? 'capability-mismatch'
        : 'provider-missing';
  const plannedNextRevision = syncRevision + (writeFingerprint ? 1 : 0);
  const serviceContract = normalizeProviderServiceContract(
    provider,
    policy,
    requestContext,
    previousProviderSync,
    previewWrites,
    ready,
    supportedCapabilities,
    {
      syncKey,
      previousRevision: syncRevision,
      nextRevision: plannedNextRevision,
      writeFingerprint,
      now
    }
  );
  const hasProviderSyncDelta = writeFingerprint || serviceContract.violations.length || serviceContract.providerSync.pending;
  const nextRevision = syncRevision + (hasProviderSyncDelta ? 1 : 0);
  const nextCursor = hasProviderSyncDelta ? `${syncKey}:${nextRevision}` : nonEmptyString(previousProviderSync.syncCursor);
  const providerContractBase = {
    providerId,
    service,
    contractVersion,
    required,
    ready,
    requiredCapabilities,
    declaredSupportedCapabilities,
    supportedCapabilities: [...supportedCapabilities],
    missingCapabilities,
    negotiatedAt: now,
    sync: {
      syncKey,
      previousRevision: syncRevision,
      nextRevision,
      previousCursor: nonEmptyString(previousProviderSync.syncCursor),
      nextCursor,
      writeFingerprint,
      current: serviceContract.providerSync.current,
      acknowledged: serviceContract.providerSync.acknowledged,
      pending: serviceContract.providerSync.pending,
      pendingReasons: serviceContract.providerSync.pendingReasons,
      expectedCursor: serviceContract.providerSync.expectedCursor
    },
    serviceContract,
    handoff: {
      state: handoffState,
      channel: firstString(provider.channel, provider.handoffChannel, requestContext.channel),
      endpoint: firstString(provider.endpoint, provider.url),
      retryable: (required && !ready && missingCapabilities.length > 0) || serviceContract.violations.length > 0
    }
  };
  const manifest = buildProviderHandoffManifest(requestContext, providerContractBase, previewWrites);
  return {
    ...providerContractBase,
    handoff: {
      ...providerContractBase.handoff,
      manifest,
      state: manifest.state === 'blocked' && handoffState === 'negotiated' ? 'handoff-blocked' : handoffState
    }
  };
}

function buildWorkflowHandoff(requestContext, previewWrites, acceptance, readiness, validationSummary, boundary, providerContract, lifecycleSettings, analyticsReport, operationalHealth) {
  const blockedWriteIds = previewWrites.filter((write) => write.decision === 'blocked').map((write) => write.id);
  const reviewWriteIds = previewWrites.filter((write) => write.decision === 'review').map((write) => write.id);
  const visibleWriteIds = blockedWriteIds.length ? blockedWriteIds : acceptance.missingWriteIds.length ? acceptance.missingWriteIds : reviewWriteIds;
  const action =
    readiness.canCommit
      ? 'commit'
      : blockedWriteIds.length
        ? 'remediate-targets'
        : acceptance.missingWriteIds.length
          ? 'request-acceptance'
          : 'collect-write-preview';
  const titleByAction = {
    commit: 'Guarded writes ready to commit',
    'remediate-targets': 'External write targets blocked',
    'request-acceptance': 'Review write preview before commit',
    'collect-write-preview': 'Write targets required'
  };
  const destination = buildWorkflowDestination(requestContext, action, visibleWriteIds, readiness, acceptance);
  return {
    action,
    title: titleByAction[action],
    route: requestContext.route,
    requestId: requestContext.requestId,
    channel: requestContext.channel,
    interactive: requestContext.isInteractive,
    destination,
    runtimeAdoption: destination.runtimeAdoption,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    boundaryScope: {
      allowedTenantIds: boundary.allowedTenantIds,
      allowedWorkspaceIds: boundary.allowedWorkspaceIds,
      workspaceRoots: boundary.workspaceRoots.map((root) => root.path),
      workspaceRootMap: Object.fromEntries(
        Object.entries(boundary.workspaceRootMap).map(([workspaceId, roots]) => [workspaceId, roots.map((root) => root.path)])
      ),
      isolationMode: boundary.isolationMode,
      requireDeclaredTenantId: boundary.requireDeclaredTenantId,
      requireDeclaredWorkspaceId: boundary.requireDeclaredWorkspaceId,
      missingPermissions: boundary.missingPermissions,
      writePermissionMode: boundary.writePermissionMode,
      requireScopedWritePermissions: boundary.requireScopedWritePermissions,
      scopedPermissionGrantCount: boundary.scopedPermissionGrants.length
    },
    provider: {
      providerId: providerContract.providerId,
      service: providerContract.service,
      contractVersion: providerContract.contractVersion,
      ready: providerContract.ready,
      missingCapabilities: providerContract.missingCapabilities,
      syncKey: providerContract.sync.syncKey,
      syncCursor: providerContract.sync.nextCursor,
      handoffState: providerContract.handoff.state,
      handoffChannel: providerContract.handoff.channel,
      handoffEndpoint: providerContract.handoff.endpoint,
      handoffManifest: providerContract.handoff.manifest,
      retryable: providerContract.handoff.retryable,
      serviceContract: {
        syncDomain: providerContract.serviceContract.syncDomain,
        valid: providerContract.serviceContract.valid,
        violations: providerContract.serviceContract.violations,
        unsupportedOperationWriteIds: providerContract.serviceContract.unsupportedOperationWriteIds,
        unsupportedSchemeWriteIds: providerContract.serviceContract.unsupportedSchemeWriteIds,
        oversizedWriteIds: providerContract.serviceContract.oversizedWriteIds,
        batchLimitExceeded: providerContract.serviceContract.batchLimitExceeded,
        capabilityNegotiation: providerContract.serviceContract.capabilityNegotiation,
        providerSync: providerContract.serviceContract.providerSync,
        externalAck: providerContract.serviceContract.externalAck
      }
    },
    lifecycle: {
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      paused: lifecycleSettings.paused,
      pauseUntil: lifecycleSettings.pauseUntil,
      commitDeferred: lifecycleSettings.commitDeferred,
      deferCommitUntil: lifecycleSettings.deferCommitUntil,
      scheduleState: lifecycleSettings.scheduleState,
      validationErrors: lifecycleSettings.validationErrors,
      nextActionId: lifecycleSettings.nextLifecycleAction,
      nextActionReason: lifecycleSettings.nextLifecycleActionReason,
      commandPolicy: lifecycleSettings.commandPolicy
    },
    operationalHealth: {
      status: operationalHealth.status,
      commitAllowed: operationalHealth.commitAllowed,
      failureReasons: operationalHealth.failureReasons,
      degradedReasons: operationalHealth.degradedReasons,
      observedHealth: operationalHealth.observedHealth,
      retryable: operationalHealth.retry.retryable,
      nextRetryAt: operationalHealth.retry.nextRetryAt,
      actionableErrors: operationalHealth.actionableErrors
    },
    visibleWriteIds,
    commitTokenRequired: readiness.canCommit,
    auditHandoff: {
      sink: 'capability-security.audit-log',
      proofType: 'external-write-guard.audit-proof',
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      blockedWriteIds,
      expiredAcceptanceIds: acceptance.expiredWriteIds,
      scopeEvidenceByWriteId: Object.fromEntries(previewWrites.map((write) => [write.id, write.scopeEvidence])),
      permissionEvidenceByWriteId: Object.fromEntries(previewWrites.map((write) => [write.id, write.permissionEvidence])),
      writePermissionMode: boundary.writePermissionMode,
      requireScopedWritePermissions: boundary.requireScopedWritePermissions
    },
    clientStatePatch: {
      'capabilitySecurity.externalWriteGuard.status': readiness.state,
      'capabilitySecurity.externalWriteGuard.summary': validationSummary.summaryText,
      'capabilitySecurity.externalWriteGuard.visibleWriteIds': visibleWriteIds,
      'capabilitySecurity.externalWriteGuard.analyticsCounters': analyticsReport.counters,
      'capabilitySecurity.externalWriteGuard.analyticsDeltas': analyticsReport.deltas,
      'capabilitySecurity.externalWriteGuard.analyticsTrend': analyticsReport.trend,
      'capabilitySecurity.externalWriteGuard.analyticsHistoryDepth': analyticsReport.history.length,
      'capabilitySecurity.externalWriteGuard.exportSummary': analyticsReport.exportSummary,
      'capabilitySecurity.externalWriteGuard.exportManifest': analyticsReport.exportManifest,
      'capabilitySecurity.externalWriteGuard.exportRows': analyticsReport.exportRows,
      'capabilitySecurity.externalWriteGuard.timelineReport': analyticsReport.timeline,
      'capabilitySecurity.externalWriteGuard.expiredAcceptanceIds': acceptance.expiredWriteIds,
      'capabilitySecurity.externalWriteGuard.explicitApprovalMissingIds': acceptance.explicitApprovalMissingWriteIds,
      'capabilitySecurity.externalWriteGuard.approvalProofMissingIds': acceptance.approvalProofMissingWriteIds,
      'capabilitySecurity.externalWriteGuard.approvalProofIntentMismatchIds': acceptance.approvalProofIntentMismatchWriteIds,
      'capabilitySecurity.externalWriteGuard.approvalProofStageMismatchIds': acceptance.approvalProofStageMismatchWriteIds,
      'capabilitySecurity.externalWriteGuard.approvalProofFingerprintMismatchIds': acceptance.approvalProofFingerprintMismatchWriteIds,
      'capabilitySecurity.externalWriteGuard.approvalProofScopeMismatchIds': acceptance.approvalProofScopeMismatchWriteIds,
      'capabilitySecurity.externalWriteGuard.acceptedWriteApprovalProofs': acceptance.acceptedWriteApprovalProofs,
      'capabilitySecurity.externalWriteGuard.approvalBoundarySummary': acceptance.approvalBoundarySummary,
      'capabilitySecurity.externalWriteGuard.acceptancePhaseByWriteId': acceptance.approvalBoundarySummary.byWriteId,
      'capabilitySecurity.externalWriteGuard.draftStageWriteIds': acceptance.draftStageWriteIds,
      'capabilitySecurity.externalWriteGuard.sendStageWriteIds': acceptance.sendStageWriteIds,
      'capabilitySecurity.externalWriteGuard.commitReadyWriteIds': acceptance.commitReadyWriteIds,
      'capabilitySecurity.externalWriteGuard.acceptanceExpiresAtByWriteId': acceptance.expiresAtByWriteId,
      'capabilitySecurity.externalWriteGuard.providerHandoffState': providerContract.handoff.state,
      'capabilitySecurity.externalWriteGuard.providerHandoffManifest': providerContract.handoff.manifest,
      'capabilitySecurity.externalWriteGuard.providerSyncCursor': providerContract.sync.nextCursor,
      'capabilitySecurity.externalWriteGuard.providerServiceContractValid': providerContract.serviceContract.valid,
      'capabilitySecurity.externalWriteGuard.providerServiceViolations': providerContract.serviceContract.violations,
      'capabilitySecurity.externalWriteGuard.providerCapabilityNegotiation': providerContract.serviceContract.capabilityNegotiation,
      'capabilitySecurity.externalWriteGuard.providerDispatchBoundary': providerContract.serviceContract.dispatchBoundary,
      'capabilitySecurity.externalWriteGuard.providerDispatchBlockedWriteIds': providerContract.serviceContract.dispatchBoundary.blockedWriteIds,
      'capabilitySecurity.externalWriteGuard.providerDispatchReadyWriteIds': providerContract.serviceContract.dispatchBoundary.handoffReadyWriteIds,
      'capabilitySecurity.externalWriteGuard.providerSyncCurrent': providerContract.serviceContract.providerSync.current,
      'capabilitySecurity.externalWriteGuard.providerSyncAcknowledged': providerContract.serviceContract.providerSync.acknowledged,
      'capabilitySecurity.externalWriteGuard.providerSyncExpectedCursor': providerContract.serviceContract.providerSync.expectedCursor,
      'capabilitySecurity.externalWriteGuard.providerSyncPendingReasons': providerContract.serviceContract.providerSync.pendingReasons,
      'capabilitySecurity.externalWriteGuard.providerExternalAckState': providerContract.serviceContract.externalAck.state,
      'capabilitySecurity.externalWriteGuard.providerExternalAckHandoffId': providerContract.serviceContract.externalAck.handoffId,
      'capabilitySecurity.externalWriteGuard.lifecycleEnabled': lifecycleSettings.enabled,
      'capabilitySecurity.externalWriteGuard.lifecycleMode': lifecycleSettings.mode,
      'capabilitySecurity.externalWriteGuard.lifecycleNextActionId': lifecycleSettings.nextLifecycleAction,
      'capabilitySecurity.externalWriteGuard.lifecycleNextActionReason': lifecycleSettings.nextLifecycleActionReason,
      'capabilitySecurity.externalWriteGuard.lifecycleScheduleState': lifecycleSettings.scheduleState,
      'capabilitySecurity.externalWriteGuard.lifecycleValidationErrors': lifecycleSettings.validationErrors,
      'capabilitySecurity.externalWriteGuard.lifecycleCommandPolicy': lifecycleSettings.commandPolicy,
      'capabilitySecurity.externalWriteGuard.boundaryScope': {
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        isolationMode: boundary.isolationMode,
        requireDeclaredTenantId: boundary.requireDeclaredTenantId,
        requireDeclaredWorkspaceId: boundary.requireDeclaredWorkspaceId
      },
      'capabilitySecurity.externalWriteGuard.boundaryScopeEvidenceByWriteId': Object.fromEntries(previewWrites.map((write) => [write.id, write.scopeEvidence])),
      'capabilitySecurity.externalWriteGuard.boundaryPermissionEvidenceByWriteId': Object.fromEntries(previewWrites.map((write) => [write.id, write.permissionEvidence])),
      'capabilitySecurity.externalWriteGuard.boundaryWritePermissionMode': boundary.writePermissionMode,
      'capabilitySecurity.externalWriteGuard.boundaryRequireScopedWritePermissions': boundary.requireScopedWritePermissions,
      'capabilitySecurity.externalWriteGuard.operationalHealthStatus': operationalHealth.status,
      'capabilitySecurity.externalWriteGuard.operationalHealthSummary': operationalHealth.summary,
      'capabilitySecurity.externalWriteGuard.operationalHealthCommitAllowed': operationalHealth.commitAllowed,
      'capabilitySecurity.externalWriteGuard.operationalHealthObserved': operationalHealth.observedHealth,
      'capabilitySecurity.externalWriteGuard.operationalHealthObservedStale': operationalHealth.observedHealth.stale,
      'capabilitySecurity.externalWriteGuard.operationalHealthRetryBackoffActive': operationalHealth.observedHealth.retryBackoffActive,
      'capabilitySecurity.externalWriteGuard.operationalHealthNextRetryAt': operationalHealth.retry.nextRetryAt,
      'capabilitySecurity.externalWriteGuard.operationalHealthActionableErrors': operationalHealth.actionableErrors,
      'capabilitySecurity.externalWriteGuard.workflowSurface': destination.surface,
      'capabilitySecurity.externalWriteGuard.workflowPanel': destination.panel,
      'capabilitySecurity.externalWriteGuard.workflowActionId': destination.actionId,
      'capabilitySecurity.externalWriteGuard.workflowResumeToken': destination.resumeToken,
      'capabilitySecurity.externalWriteGuard.workflowCanInlineAccept': destination.canInlineAccept,
      'capabilitySecurity.externalWriteGuard.runtimeAdoptionMode': destination.runtimeAdoption.mode,
      'capabilitySecurity.externalWriteGuard.runtimeAdoptionBlockedReason': destination.runtimeAdoption.blockedReason,
      'capabilitySecurity.externalWriteGuard.runtimeRequiredCapabilities': destination.runtimeAdoption.requiredCapabilities,
      'capabilitySecurity.externalWriteGuard.runtimeMissingCapabilities': destination.runtimeAdoption.missingCapabilities,
      'capabilitySecurity.externalWriteGuard.runtimeRoutePatchPath': destination.runtimeAdoption.routePatchPath,
      'capabilitySecurity.externalWriteGuard.runtimeCommandQueuePath': destination.runtimeAdoption.commandQueuePath,
      'capabilitySecurity.externalWriteGuard.runtimeCanApplyRoutePatch': destination.runtimeAdoption.canApplyRoutePatch,
      'capabilitySecurity.externalWriteGuard.runtimeCanQueueCommand': destination.runtimeAdoption.canQueueCommand
    }
  };
}

function buildAuditProof(now, requestContext, policy, previewWrites, acceptance, readiness, boundary, providerContract, lifecycleSettings, analyticsReport, restartStatus, operationalHealth) {
  const reviewedTargets = previewWrites.map((write) => ({
    id: write.id,
    scheme: write.scheme,
    decision: write.decision,
    reason: write.reason,
    tenantId: write.tenantId,
    workspaceId: write.workspaceId,
    targetPath: write.targetPath?.path || '',
    scopeEvidence: write.scopeEvidence,
    permissionEvidence: write.permissionEvidence
  }));
  return {
    type: 'external-write-guard.audit-proof',
    generatedAt: now,
    requestId: requestContext.requestId,
    route: requestContext.route,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    actorId: requestContext.actor.id,
    clientId: requestContext.client.id,
    actorRoles: boundary.actorRoles,
    requiredPermissions: boundary.requiredPermissions,
    missingPermissions: boundary.missingPermissions,
    policyHashBasis: [
      policy.allowedSchemes.join(','),
      policy.blockedSchemes.join(','),
      String(policy.requireCapability),
      String(policy.requireUserAcceptance),
      String(policy.requireExplicitApproval),
      String(policy.requireSendStageForCommit),
      String(policy.maxBytes),
      boundary.tenantId,
      boundary.workspaceId,
      boundary.workspaceRoots.map((root) => root.path).join(','),
      Object.entries(boundary.workspaceRootMap)
        .map(([workspaceId, roots]) => `${workspaceId}:${roots.map((root) => root.path).join(',')}`)
        .join(';'),
      boundary.isolationMode,
      String(boundary.requireDeclaredTenantId),
      String(boundary.requireDeclaredWorkspaceId),
      previewWrites.map((write) => [
        write.id,
        write.scopeEvidence?.tenantInheritedFromBoundary,
        write.scopeEvidence?.workspaceInheritedFromBoundary,
        write.scopeEvidence?.matchedWorkspaceRoot,
        write.scopeEvidence?.matchingRoots?.join(','),
        write.permissionEvidence?.mode,
        write.permissionEvidence?.scopedAuthorizationRequired,
        write.permissionEvidence?.scopedAuthorizationSatisfied,
        write.permissionEvidence?.requiredPermissions?.join(','),
        write.permissionEvidence?.matchingScopedGrants?.map((grant) => grant.id).join(',')
      ].join(':')).join(','),
      boundary.requiredPermissions.join(','),
      boundary.writePermissionMode,
      String(boundary.requireScopedWritePermissions),
      boundary.scopedPermissionGrants.map((grant) => [
        grant.id,
        grant.source,
        grant.permissions.join(','),
        grant.tenantIds.join(','),
        grant.workspaceIds.join(','),
        grant.operations.join(','),
        grant.schemes.join(','),
        grant.rootPaths.join(',')
      ].join(':')).join(';'),
      Object.entries(boundary.operationPermissionMap)
        .map(([operation, permissions]) => `${operation}:${normalizeStringEntries(permissions).join(',')}`)
        .join(';'),
      providerContract.providerId,
      providerContract.contractVersion,
      providerContract.requiredCapabilities.join(','),
      providerContract.declaredSupportedCapabilities.join(','),
      providerContract.supportedCapabilities.join(','),
      providerContract.serviceContract.syncDomain,
      providerContract.serviceContract.supportedOperations.join(','),
      providerContract.serviceContract.supportedSchemes.join(','),
      String(providerContract.serviceContract.maxBatchWrites),
      String(providerContract.serviceContract.maxBytesPerWrite),
      providerContract.serviceContract.violations.join(','),
      providerContract.serviceContract.capabilityNegotiation.missingCapabilities.join(','),
      providerContract.serviceContract.providerSync.current,
      providerContract.serviceContract.providerSync.acknowledged,
      providerContract.serviceContract.providerSync.expectedCursor,
      providerContract.serviceContract.providerSync.observedRevision,
      providerContract.serviceContract.providerSync.acknowledgedRevision,
      providerContract.serviceContract.providerSync.pendingReasons.join(','),
      providerContract.handoff.manifest.state,
      providerContract.handoff.manifest.blockedWriteIds.join(','),
      providerContract.serviceContract.dispatchBoundary.state,
      providerContract.serviceContract.dispatchBoundary.requiredReviewStage,
      providerContract.serviceContract.dispatchBoundary.blockedWriteIds.join(','),
      providerContract.serviceContract.dispatchBoundary.handoffReadyWriteIds.join(','),
      providerContract.serviceContract.externalAck.state,
      providerContract.serviceContract.externalAck.handoffId,
      acceptance.acceptedWriteIds.join(','),
      acceptance.commitReadyWriteIds.join(','),
      acceptance.draftStageWriteIds.join(','),
      acceptance.approvalBoundarySummary.commitBlockedWriteIds.join(','),
      acceptance.approvalBoundarySummary.acceptanceOnlyWriteIds.join(','),
      acceptance.explicitApprovalMissingWriteIds.join(','),
      acceptance.approvalProofIntentMismatchWriteIds.join(','),
      acceptance.approvalProofStageMismatchWriteIds.join(','),
      acceptance.approvalProofFingerprintMismatchWriteIds.join(','),
      acceptance.approvalProofScopeMismatchWriteIds.join(','),
      acceptance.expiredWriteIds.join(','),
      Object.entries(acceptance.expiresAtByWriteId).map(([id, expiresAt]) => `${id}:${expiresAt}`).join(','),
      lifecycleSettings.enabled,
      lifecycleSettings.mode,
      lifecycleSettings.pauseUntil,
      lifecycleSettings.deferCommitUntil,
      lifecycleSettings.scheduleState,
      lifecycleSettings.nextLifecycleActionReason,
      lifecycleSettings.validationErrors.join(','),
      lifecycleSettings.lastCommandPayloadKeys.join(','),
      analyticsReport.currentSnapshot.id,
      analyticsReport.counters.blockedWrites,
      analyticsReport.counters.pendingAcceptanceWrites,
      analyticsReport.counters.providerViolations,
      restartStatus.state,
      restartStatus.previewFingerprint,
      restartStatus.persistedPreviewFingerprint,
      restartStatus.blockers.join(','),
      restartStatus.recoveryToken,
      restartStatus.replayToken,
      operationalHealth.status,
      operationalHealth.commitAllowed,
      operationalHealth.failureReasons.join(','),
      operationalHealth.degradedReasons.join(','),
      operationalHealth.retry.attempt,
      operationalHealth.retry.maxAttempts,
      operationalHealth.retry.nextRetryAt,
      requestContext.clientRuntime.runtimeId,
      requestContext.clientRuntime.runtimeVersion,
      requestContext.clientRuntime.statePathPrefix,
      requestContext.clientRuntime.routePatchPath,
      requestContext.clientRuntime.commandQueuePath,
      requestContext.clientRuntime.capabilities.join(','),
      requestContext.clientRuntime.supportsRoutePatch,
      requestContext.clientRuntime.supportsCommandQueue,
      requestContext.clientRuntime.supportsWorkflowHandoff,
      requestContext.clientRuntime.supportsInlineReview
    ].join('|'),
    clientRuntimeEvidence: {
      runtimeId: requestContext.clientRuntime.runtimeId,
      runtimeVersion: requestContext.clientRuntime.runtimeVersion,
      statePathPrefix: requestContext.clientRuntime.statePathPrefix,
      routePatchPath: requestContext.clientRuntime.routePatchPath,
      commandQueuePath: requestContext.clientRuntime.commandQueuePath,
      capabilities: requestContext.clientRuntime.capabilities,
      supportsRoutePatch: requestContext.clientRuntime.supportsRoutePatch,
      supportsCommandQueue: requestContext.clientRuntime.supportsCommandQueue,
      supportsWorkflowHandoff: requestContext.clientRuntime.supportsWorkflowHandoff,
      supportsInlineReview: requestContext.clientRuntime.supportsInlineReview,
      requestedHandoffMode: requestContext.clientRuntime.requestedHandoffMode,
      adoptionTokenPresent: Boolean(requestContext.clientRuntime.adoptionToken)
    },
    boundaryEvidence: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      allowedTenantIds: boundary.allowedTenantIds,
      allowedWorkspaceIds: boundary.allowedWorkspaceIds,
      workspaceRoots: boundary.workspaceRoots.map((root) => root.path),
      workspaceRootMap: Object.fromEntries(
        Object.entries(boundary.workspaceRootMap).map(([workspaceId, roots]) => [workspaceId, roots.map((root) => root.path)])
      ),
      isolationMode: boundary.isolationMode,
      requireDeclaredTenantId: boundary.requireDeclaredTenantId,
      requireDeclaredWorkspaceId: boundary.requireDeclaredWorkspaceId,
      scopeEvidenceByWriteId: Object.fromEntries(previewWrites.map((write) => [write.id, write.scopeEvidence])),
      permissionEvidenceByWriteId: Object.fromEntries(previewWrites.map((write) => [write.id, write.permissionEvidence])),
      writePermissionMode: boundary.writePermissionMode,
      requireScopedWritePermissions: boundary.requireScopedWritePermissions,
      scopedPermissionGrants: boundary.scopedPermissionGrants,
      operationPermissionMap: boundary.operationPermissionMap
    },
    restartEvidence: {
      version: restartStatus.version,
      state: restartStatus.state,
      restartSafe: restartStatus.restartSafe,
      recovered: restartStatus.recovered,
      previousRevision: restartStatus.previousRevision,
      previousStatus: restartStatus.previousStatus,
      routeMatches: restartStatus.routeMatches,
      requestMatches: restartStatus.requestMatches,
      envelopeRouteMatches: restartStatus.envelopeRouteMatches,
      envelopeRequestMatches: restartStatus.envelopeRequestMatches,
      fingerprintMatches: restartStatus.fingerprintMatches,
      stale: restartStatus.stale,
      blockers: restartStatus.blockers,
      previewFingerprint: restartStatus.previewFingerprint,
      persistedPreviewFingerprint: restartStatus.persistedPreviewFingerprint,
      recoveryToken: restartStatus.recoveryToken,
      replayToken: restartStatus.replayToken,
      checkpointedAt: restartStatus.checkpointedAt,
      idempotentReplay: restartStatus.idempotentReplay,
      replayedCommandId: restartStatus.replayedCommandId,
      replaySemantics: restartStatus.replaySemantics
    },
    canCommit: readiness.canCommit,
    providerContract: {
      providerId: providerContract.providerId,
      service: providerContract.service,
      contractVersion: providerContract.contractVersion,
      required: providerContract.required,
      ready: providerContract.ready,
      missingCapabilities: providerContract.missingCapabilities,
      syncKey: providerContract.sync.syncKey,
      syncCursor: providerContract.sync.nextCursor,
      handoffState: providerContract.handoff.state,
      handoffManifest: providerContract.handoff.manifest,
      serviceContract: {
        syncDomain: providerContract.serviceContract.syncDomain,
        valid: providerContract.serviceContract.valid,
        violations: providerContract.serviceContract.violations,
        unsupportedOperationWriteIds: providerContract.serviceContract.unsupportedOperationWriteIds,
        unsupportedSchemeWriteIds: providerContract.serviceContract.unsupportedSchemeWriteIds,
        oversizedWriteIds: providerContract.serviceContract.oversizedWriteIds,
        batchLimitExceeded: providerContract.serviceContract.batchLimitExceeded,
        capabilityNegotiation: providerContract.serviceContract.capabilityNegotiation,
        providerSync: providerContract.serviceContract.providerSync,
        externalAck: providerContract.serviceContract.externalAck
      }
    },
    lifecycle: {
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      enforcementActive: lifecycleSettings.enforcementActive,
      monitorOnly: lifecycleSettings.monitorOnly,
      paused: lifecycleSettings.paused,
      pauseUntil: lifecycleSettings.pauseUntil,
      commitDeferred: lifecycleSettings.commitDeferred,
      deferCommitUntil: lifecycleSettings.deferCommitUntil,
      scheduledResumeAt: lifecycleSettings.scheduledResumeAt,
      scheduleState: lifecycleSettings.scheduleState,
      validationErrors: lifecycleSettings.validationErrors,
      nextActionId: lifecycleSettings.nextLifecycleAction,
      nextActionReason: lifecycleSettings.nextLifecycleActionReason,
      lastCommandPayloadKeys: lifecycleSettings.lastCommandPayloadKeys,
      commandPolicy: lifecycleSettings.commandPolicy
    },
    operationalHealth: {
      version: operationalHealth.version,
      checkedAt: operationalHealth.checkedAt,
      status: operationalHealth.status,
      commitAllowed: operationalHealth.commitAllowed,
      failureReasons: operationalHealth.failureReasons,
      degradedReasons: operationalHealth.degradedReasons,
      retry: operationalHealth.retry,
      actionableErrors: operationalHealth.actionableErrors,
      summary: operationalHealth.summary
    },
    acceptanceWindow: {
      required: acceptance.required,
      requireExplicitApproval: acceptance.requireExplicitApproval,
      requireSendStageForCommit: acceptance.requireSendStageForCommit,
      ttlMs: acceptance.ttlMs,
      requiredWriteIds: acceptance.requiredWriteIds,
      approvalBoundary: acceptance.approvalBoundary,
      approvalBoundarySummary: acceptance.approvalBoundarySummary,
      commitStageWriteIds: acceptance.commitStageWriteIds,
      sendStageWriteIds: acceptance.sendStageWriteIds,
      draftStageWriteIds: acceptance.draftStageWriteIds,
      commitReadyWriteIds: acceptance.commitReadyWriteIds,
      acceptedWriteIds: acceptance.acceptedWriteIds,
      acceptedWriteAts: acceptance.acceptedWriteAts,
      explicitApprovalMissingWriteIds: acceptance.explicitApprovalMissingWriteIds,
      approvalProofIntentMismatchWriteIds: acceptance.approvalProofIntentMismatchWriteIds,
      approvalProofStageMismatchWriteIds: acceptance.approvalProofStageMismatchWriteIds,
      approvalProofFingerprintMismatchWriteIds: acceptance.approvalProofFingerprintMismatchWriteIds,
      approvalProofScopeMismatchWriteIds: acceptance.approvalProofScopeMismatchWriteIds,
      expiredWriteIds: acceptance.expiredWriteIds,
      expiresAtByWriteId: acceptance.expiresAtByWriteId,
      missingWriteIds: acceptance.missingWriteIds
    },
    analyticsEvidence: {
      version: analyticsReport.version,
      currentSnapshotId: analyticsReport.currentSnapshot.id,
      counters: analyticsReport.counters,
      deltas: analyticsReport.deltas,
      trend: analyticsReport.trend,
      approvalBoundary: analyticsReport.approvalBoundary,
      historyDepth: analyticsReport.history.length,
      exportFormat: analyticsReport.exportSummary.format,
      exportManifestId: analyticsReport.exportManifest.manifestId,
      exportManifestState: analyticsReport.exportManifest.state,
      exportManifestBlockers: analyticsReport.exportManifest.blockers,
      exportRowCount: analyticsReport.exportRows.length,
      riskBucketCounts: analyticsReport.exportSummary.riskBucketCounts,
      blockerCounts: analyticsReport.exportSummary.blockerCounts,
      blockedReasonCounts: analyticsReport.exportSummary.blockedReasonCounts,
      timelineEventTypes: analyticsReport.timeline.map((event) => event.type)
    },
    reviewedTargets
  };
}

export function describeExternalWriteGuardSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const policy = buildPolicy(input);
  const requestContext = buildRequestContext(input);
  const securityBoundary = buildSecurityBoundary(input, policy, requestContext);
  const persistedState = normalizePersistedState(input, requestContext);
  const command = normalizeGuardCommand(input);
  const commandAlreadyApplied = commandWasPreviouslyApplied(command, persistedState);
  let lifecycleSettings = normalizeLifecycleSettings(input, persistedState, command, commandAlreadyApplied, now);
  const lifecycleCommandPreflight = buildLifecycleCommandBoundary(command, persistedState, lifecycleSettings, commandAlreadyApplied, now);
  if (lifecycleCommandPreflight.checked && !lifecycleCommandPreflight.ok) {
    lifecycleSettings = normalizeLifecycleSettings(input, persistedState, null, false, now);
  }
  const previewWrites = buildPreviewWrites(input, policy, persistedState, securityBoundary);
  const providerContract = buildProviderContract(now, input, policy, requestContext, persistedState, previewWrites);
  const acceptedWrites = buildAcceptedWrites(
    input,
    previewWrites,
    persistedState,
    command,
    commandAlreadyApplied,
    lifecycleSettings,
    now,
    requestContext,
    securityBoundary
  );
  const validationSummary = buildValidationSummary(previewWrites);
  const acceptance = buildAcceptance(acceptedWrites, previewWrites, policy, lifecycleSettings, requestContext, securityBoundary);
  const recoveryStatus = buildRecoveryStatus(input, persistedState, previewWrites);
  const recoveryGuard = buildRecoveryGuard(now, requestContext, persistedState, recoveryStatus, previewWrites);
  const operationalHealth = buildOperationalHealth(now, input, persistedState, validationSummary, acceptance, providerContract, lifecycleSettings, recoveryGuard);
  const readiness = buildReadiness(validationSummary, acceptance, providerContract, lifecycleSettings, recoveryGuard, operationalHealth);
  const commandStatus = buildCommandStatus(
    command,
    persistedState,
    acceptedWrites.acceptedWriteIds,
    previewWrites,
    readiness,
    acceptance,
    lifecycleSettings,
    now,
    lifecycleCommandPreflight
  );
  const restartStatus = buildRestartStatus(persistedState, recoveryStatus, recoveryGuard, previewWrites, commandStatus, readiness, acceptance);
  const analyticsReport = buildAnalyticsReport(
    now,
    input,
    requestContext,
    persistedState,
    previewWrites,
    acceptance,
    readiness,
    validationSummary,
    providerContract,
    lifecycleSettings,
    recoveryStatus,
    commandStatus
  );
  const dataContract = buildDataContract(previewWrites, validationSummary, policy, requestContext, persistedState, securityBoundary, providerContract, lifecycleSettings, analyticsReport, restartStatus, operationalHealth, commandStatus);
  const workflowHandoff = buildWorkflowHandoff(requestContext, previewWrites, acceptance, readiness, validationSummary, securityBoundary, providerContract, lifecycleSettings, analyticsReport, operationalHealth);
  const nextSteps = buildNextSteps(previewWrites, acceptance, readiness, providerContract, lifecycleSettings, operationalHealth);
  const clientReviewPacket = buildClientReviewPacket(
    requestContext,
    previewWrites,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
    securityBoundary,
    providerContract,
    commandStatus,
    lifecycleSettings,
    analyticsReport,
    restartStatus,
    operationalHealth
  );
  const persistedStatePatch = buildPersistedStatePatch(now, requestContext, persistedState, recoveryStatus, restartStatus, commandStatus, previewWrites, acceptance, readiness, validationSummary, providerContract, lifecycleSettings, analyticsReport, operationalHealth, securityBoundary);
  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel external write guard preview and acceptance contract',
    requestContext,
    dataContract,
    providerContract,
    lifecycleSettings,
    policy,
    securityBoundary,
    recoveryStatus,
    restartStatus,
    commandStatus,
    operationalHealth,
    persistedStatePatch,
    preview: {
      writes: previewWrites,
      userVisibleRows: clientReviewPacket.previewRows
    },
    acceptance,
    readiness,
    validationSummary,
    analytics: analyticsReport,
    nextSteps,
    clientReviewPacket,
    workflowHandoff,
    auditProof: buildAuditProof(now, requestContext, policy, previewWrites, acceptance, readiness, securityBoundary, providerContract, lifecycleSettings, analyticsReport, restartStatus, operationalHealth),
    evidence: toArray(input.evidence)
  };
}

export default describeExternalWriteGuardSurface;
