export const surfaceId = "aios_kernel-lifecycle_process-snapshot_007";
export const surfaceGroup = "kernel-lifecycle";
export const surfaceName = "process-snapshot";

const PROVIDER_CAPABILITIES = {
  snapshot: ['process:list', 'process:read', 'process:proof'],
  lifecycle: ['kernel:pause', 'kernel:resume', 'kernel:handoff'],
  sync: ['snapshot:sync-metadata', 'snapshot:external-handoff']
};

const SNAPSHOT_SCHEMA_VERSION = 'kernel.processSnapshot.v1';
const SNAPSHOT_SERIALIZATION_VERSION = 'kernel.processSnapshot.serialized.v1';
const PREVIEW_ACCEPTANCE_CONTRACT_VERSION = 'kernel.processSnapshot.previewAcceptance.v1';
const PROVIDER_PROTOCOL_VERSION = 'hosted-kernel.processSnapshot.v1';
const PROVIDER_COMMAND_HANDOFF_CONTRACT_VERSION = 'hosted-kernel.processSnapshot.providerCommandHandoff.v1';
const DEFAULT_PROVIDER = 'hosted-kernel';
const DEFAULT_SYNC_CHANNEL = 'kernel-lifecycle/process-snapshot';
const ACCEPTANCE_STATES = new Set(['accepted', 'rejected', 'pending']);
const RECOVERY_STATES = new Set(['clean', 'recovering', 'stale', 'conflict']);
const PROVIDER_SYNC_MODES = new Set(['push', 'pull', 'bidirectional']);
const HANDOFF_TARGETS = new Set(['external-orchestrator', 'runtime-client', 'operator-workbench']);
const PROVIDER_ACK_STATES = new Set(['pending', 'acknowledged', 'rejected', 'timed-out']);
const PROVIDER_DELIVERY_GUARANTEES = new Set(['at-least-once', 'exactly-once']);
const PERSISTED_COMMAND_STATES = new Set(['pending', 'running', 'completed', 'failed', 'abandoned']);
const CLIENT_WORKFLOW_MODES = new Set(['review-first', 'auto-commit-after-ack', 'local-preview-only']);
const CLIENT_RESUME_STRATEGIES = new Set(['focus-process', 'first-transferable', 'client-home']);
const LIFECYCLE_CONTROLS = ['pause-before-handoff', 'resume-after-handoff', 'checkpoint-before-transfer'];
const CLIENT_SURFACES = new Set([
  'kernel-console',
  'operator-workbench',
  'runtime-client',
  'external-orchestrator'
]);
const ACCESS_BOUNDARY_MODES = new Set(['enforce', 'audit-only']);
const HEALTH_STATES = new Set(['healthy', 'degraded', 'failed']);
const SCOPED_GRANT_LEVELS = new Set(['tenant', 'workspace', 'process']);
const EXPORT_FORMATS = new Set(['json', 'jsonl', 'csv']);
const EXPORT_DETAIL_LEVELS = new Set(['summary', 'process', 'full']);
const REPORT_AUDIENCES = new Set(['operator', 'auditor', 'provider', 'client']);
const SERIALIZED_SNAPSHOT_REQUIRED_SECTIONS = ['ps', 'replay', 'recovery', 'providerContract', 'claimEvidence'];
const SERIALIZED_SNAPSHOT_REQUIRED_CURSORS = ['replay', 'recovery', 'providerAck', 'commandJournal', 'externalHandoff'];
const SERIALIZED_SNAPSHOT_IMPORT_COMMANDS = [
  'restore-process-table',
  'restore-replay-cursor',
  'restore-recovery-state',
  'bind-provider-contract',
  'verify-claim-evidence'
];
const LIFECYCLE_SCHEDULE_MODES = new Set(['immediate', 'manual', 'deferred', 'recurring', 'disabled']);
const LIFECYCLE_COMMAND_DISPATCH_STATES = new Set(['disabled', 'blocked', 'queued', 'due', 'scheduled', 'recurring']);
const RESTART_COMMAND_STATES = new Set(['blocked', 'dispatchable', 'scheduled', 'waiting-ack', 'completed', 'suppressed']);
const HEALTH_SIGNAL_SEVERITIES = new Set(['info', 'warning', 'error', 'fatal']);
const HEALTH_FAILURE_STATES = new Set(['open', 'mitigating', 'retrying', 'resolved', 'suppressed']);
const DEFAULT_LIFECYCLE_SCHEDULE_STALE_AFTER_MS = 300000;
const DEFAULT_LIFECYCLE_RECURRING_CATCHUP_LIMIT = 25;
const HEALTH_COMPONENTS = new Set([
  'provider',
  'snapshot-store',
  'handoff-channel',
  'command-dispatch',
  'process-table',
  'tenant-boundary'
]);
const LIFECYCLE_CONTROL_PERMISSIONS = {
  'pause-before-handoff': 'kernel:pause',
  'resume-after-handoff': 'kernel:resume',
  'checkpoint-before-transfer': 'kernel:handoff'
};
const LIFECYCLE_COMMAND_TYPES = {
  'pause-before-handoff': 'pause-processes-before-handoff',
  'resume-after-handoff': 'resume-processes-after-handoff',
  'checkpoint-before-transfer': 'checkpoint-processes-before-transfer'
};
const ROLE_PERMISSIONS = {
  viewer: ['process:list', 'process:read', 'process:proof'],
  operator: ['process:list', 'process:read', 'process:proof', 'snapshot:external-handoff'],
  lifecycle_operator: [
    'process:list',
    'process:read',
    'process:proof',
    'snapshot:external-handoff',
    'kernel:pause',
    'kernel:resume',
    'kernel:handoff'
  ],
  auditor: ['process:list', 'process:read', 'process:proof', 'snapshot:audit-read'],
  tenant_admin: [
    'process:list',
    'process:read',
    'process:proof',
    'snapshot:audit-read',
    'snapshot:external-handoff',
    'kernel:pause',
    'kernel:resume',
    'kernel:handoff',
    'tenant:cross-workspace'
  ],
  kernel_admin: [
    'process:list',
    'process:read',
    'process:proof',
    'snapshot:audit-read',
    'snapshot:external-handoff',
    'kernel:pause',
    'kernel:resume',
    'kernel:handoff',
    'tenant:cross-workspace',
    'tenant:cross-tenant'
  ]
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeStringList(value, fallback = []) {
  const raw = Array.isArray(value) ? value : fallback;
  return [...new Set(raw.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))];
}

function normalizePositiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const numeric = typeof value === 'number' ? value : Number(value);
  const integer = Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
  return Math.max(minimum, Math.min(maximum, integer));
}

function normalizeScopedPermissionGrants(input, fallbackTenantId, fallbackWorkspaceId, now) {
  const request = asObject(input.request);
  const client = asObject(input.clientRuntime || input.client);
  const access = asObject(input.accessContext || input.access || input.tenantBoundary);
  const rawGrants = Array.isArray(access.scopedPermissions)
    ? access.scopedPermissions
    : Array.isArray(request.scopedPermissions)
      ? request.scopedPermissions
      : Array.isArray(client.scopedPermissions) ? client.scopedPermissions : [];
  const nowMs = Date.parse(now);

  return rawGrants.map((grant, index) => {
    const record = asObject(grant);
    const permission = asString(record.permission, null);
    const processIds = normalizeStringList(record.processIds || record.pids, []);
    const tenantId = asString(record.tenantId, fallbackTenantId);
    const workspaceId = asString(record.workspaceId, fallbackWorkspaceId);
    const requestedLevel = asString(record.level || record.scope, processIds.length > 0 ? 'process' : 'workspace');
    const level = SCOPED_GRANT_LEVELS.has(requestedLevel) ? requestedLevel : 'workspace';
    const expiresAt = asString(record.expiresAt, null);
    const expiresAtMs = expiresAt ? Date.parse(expiresAt) : null;
    const invalidReasons = [
      ...(permission ? [] : ['missing-permission']),
      ...(expiresAt && Number.isNaN(expiresAtMs) ? [`invalid-expires-at:${expiresAt}`] : []),
      ...(expiresAtMs !== null && !Number.isNaN(expiresAtMs) && expiresAtMs <= nowMs ? ['expired'] : []),
      ...(level === 'process' && processIds.length === 0 ? ['missing-process-scope'] : [])
    ];

    return {
      id: asString(record.id, `scoped-grant-${index + 1}`),
      permission,
      level,
      tenantId,
      workspaceId,
      processIds,
      expiresAt,
      delegatedBy: asString(record.delegatedBy, asString(record.issuer, null)),
      valid: invalidReasons.length === 0,
      invalidReasons
    };
  });
}

function scopedGrantMatchesProcess(grant, process, permission) {
  if (!grant.valid || grant.permission !== permission) return false;
  if (grant.tenantId !== process.tenantId) return false;
  if (grant.level === 'tenant') return true;
  if (grant.workspaceId !== process.workspaceId) return false;
  if (grant.level === 'workspace') return true;
  return grant.processIds.includes(process.pid);
}

function normalizeAccessContext(input, now) {
  const request = asObject(input.request);
  const client = asObject(input.clientRuntime || input.client);
  const access = asObject(input.accessContext || input.access || input.tenantBoundary);
  const roles = normalizeStringList(access.roles || request.roles || client.roles, ['operator']);
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const permissions = normalizeStringList(
    access.permissions || request.permissions || client.permissions,
    rolePermissions
  );
  const permissionSet = new Set([...rolePermissions, ...permissions]);
  const requestedMode = asString(access.boundaryMode || request.boundaryMode, 'enforce');
  const boundaryMode = ACCESS_BOUNDARY_MODES.has(requestedMode) ? requestedMode : 'enforce';
  const tenantId = asString(access.tenantId || request.tenantId || client.tenantId, 'hosted-kernel-tenant');
  const workspaceId = asString(access.workspaceId || request.workspaceId || client.workspaceId, 'default-workspace');

  return {
    actor: asString(request.actor, asString(client.actor, asString(access.actor, 'operator'))),
    tenantId,
    workspaceId,
    roles,
    permissions: [...permissionSet],
    scopedPermissions: normalizeScopedPermissionGrants(input, tenantId, workspaceId, now),
    boundaryMode,
    crossTenant: permissionSet.has('tenant:cross-tenant'),
    crossWorkspace: permissionSet.has('tenant:cross-workspace') || permissionSet.has('tenant:cross-tenant'),
    auditId: asString(access.auditId || request.auditId, `tenant-boundary:${now}`)
  };
}

function requiredPermissionsForProcess(record) {
  return normalizeStringList(record.requiredPermissions || record.permissionsRequired, ['process:read']);
}

function buildAccessBoundary(accessContext, processTable, now) {
  const permissionSet = new Set(accessContext.permissions);
  const validScopedGrants = accessContext.scopedPermissions.filter((grant) => grant.valid);
  const invalidScopedGrants = accessContext.scopedPermissions.filter((grant) => !grant.valid);
  const decisions = processTable.map((process) => {
    const tenantAllowed = accessContext.crossTenant || process.tenantId === accessContext.tenantId;
    const workspaceAllowed = accessContext.crossWorkspace || process.workspaceId === accessContext.workspaceId;
    const appliedScopedGrants = process.requiredPermissions.flatMap((permission) => (
      permissionSet.has(permission)
        ? []
        : validScopedGrants
          .filter((grant) => scopedGrantMatchesProcess(grant, process, permission))
          .map((grant) => ({
            id: grant.id,
            permission: grant.permission,
            level: grant.level,
            delegatedBy: grant.delegatedBy,
            expiresAt: grant.expiresAt
          }))
    ));
    const missingPermissions = process.requiredPermissions.filter((permission) => {
      if (permissionSet.has(permission)) return false;
      return !validScopedGrants.some((grant) => scopedGrantMatchesProcess(grant, process, permission));
    });
    const reasons = [
      ...(tenantAllowed ? [] : ['tenant-mismatch']),
      ...(workspaceAllowed ? [] : ['workspace-mismatch']),
      ...missingPermissions.map((permission) => `missing-permission:${permission}`)
    ];

    return {
      pid: process.pid,
      tenantId: process.tenantId,
      workspaceId: process.workspaceId,
      allowed: reasons.length === 0,
      reasons,
      requiredPermissions: process.requiredPermissions,
      appliedScopedGrants
    };
  });
  const visibleProcessIds = decisions.filter((decision) => decision.allowed).map((decision) => decision.pid);
  const withheldProcessIds = decisions.filter((decision) => !decision.allowed).map((decision) => decision.pid);
  const scopedGrantUse = decisions
    .filter((decision) => decision.appliedScopedGrants.length > 0)
    .map((decision) => ({
      pid: decision.pid,
      grantIds: decision.appliedScopedGrants.map((grant) => grant.id),
      permissions: decision.appliedScopedGrants.map((grant) => grant.permission)
    }));

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    mode: accessContext.boundaryMode,
    actor: accessContext.actor,
    tenantId: accessContext.tenantId,
    workspaceId: accessContext.workspaceId,
    roles: accessContext.roles,
    permissions: accessContext.permissions,
    scopedPermissions: {
      validCount: validScopedGrants.length,
      invalidCount: invalidScopedGrants.length,
      grants: accessContext.scopedPermissions.map((grant) => ({
        id: grant.id,
        permission: grant.permission,
        level: grant.level,
        tenantId: grant.tenantId,
        workspaceId: grant.workspaceId,
        processIds: grant.processIds,
        expiresAt: grant.expiresAt,
        delegatedBy: grant.delegatedBy,
        valid: grant.valid,
        invalidReasons: grant.invalidReasons
      })),
      applied: scopedGrantUse
    },
    visibleProcessIds,
    withheldProcessIds,
    visibleCount: visibleProcessIds.length,
    withheldCount: withheldProcessIds.length,
    decisions,
    enforced: accessContext.boundaryMode === 'enforce',
    generatedAt: now,
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        accessContext.auditId,
        accessContext.tenantId,
        accessContext.workspaceId,
        visibleProcessIds.join(',') || 'none',
        withheldProcessIds.join(',') || 'none',
        scopedGrantUse.map((usage) => `${usage.pid}:${usage.grantIds.join(',')}`).join('|') || 'no-scoped-grants'
      ].join('#')
    }
  };
}

function normalizeCapabilities(provider = {}) {
  const required = Object.values(PROVIDER_CAPABILITIES).flat();
  const declared = Array.isArray(provider.capabilities) ? provider.capabilities : required;
  const supported = required.filter((capability) => declared.includes(capability));
  const missing = required.filter((capability) => !supported.includes(capability));

  return {
    required,
    declared: [...new Set(declared.filter((capability) => typeof capability === 'string' && capability.trim()))],
    supported,
    missing,
    compatible: missing.length === 0
  };
}

function normalizeServiceContract(provider = {}, negotiation, now) {
  const contract = asObject(provider.serviceContract || provider.contract);
  const requestedProtocol = asString(contract.protocolVersion || provider.protocolVersion, PROVIDER_PROTOCOL_VERSION);
  const supportedProtocols = normalizeStringList(
    contract.supportedProtocols || provider.supportedProtocols,
    [PROVIDER_PROTOCOL_VERSION]
  );
  const requestedSyncMode = asString(contract.syncMode || provider.syncMode, 'bidirectional');
  const syncMode = PROVIDER_SYNC_MODES.has(requestedSyncMode) ? requestedSyncMode : 'bidirectional';
  const requestedTargets = normalizeStringList(
    contract.handoffTargets || provider.handoffTargets,
    ['external-orchestrator']
  );
  const handoffTargets = requestedTargets.filter((target) => HANDOFF_TARGETS.has(target));
  const lifecycleControls = normalizeStringList(
    contract.lifecycleControls || provider.lifecycleControls,
    LIFECYCLE_CONTROLS
  ).filter((control) => LIFECYCLE_CONTROLS.includes(control));
  const errors = [
    ...(supportedProtocols.includes(requestedProtocol) ? [] : [`unsupported-protocol:${requestedProtocol}`]),
    ...(handoffTargets.length > 0 ? [] : ['no-supported-handoff-target']),
    ...(lifecycleControls.includes('checkpoint-before-transfer') ? [] : ['missing-lifecycle-control:checkpoint-before-transfer']),
    ...(negotiation.compatible ? [] : ['capability-negotiation-incomplete'])
  ];
  const warnings = [
    ...(PROVIDER_SYNC_MODES.has(requestedSyncMode) ? [] : [`unsupported-sync-mode:${requestedSyncMode}`]),
    ...(lifecycleControls.includes('pause-before-handoff') ? [] : ['handoff-will-not-pause-processes']),
    ...(lifecycleControls.includes('resume-after-handoff') ? [] : ['handoff-resume-not-advertised'])
  ];

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    protocolVersion: requestedProtocol,
    supportedProtocols,
    syncMode,
    handoffTargets,
    lifecycleControls,
    maxProcessBatchSize: normalizePositiveInteger(contract.maxProcessBatchSize, 100, 1, 5000),
    ackDeadlineMs: normalizePositiveInteger(contract.ackDeadlineMs, 5000, 250, 60000),
    leaseTtlMs: normalizePositiveInteger(contract.leaseTtlMs, 30000, 1000, 300000),
    compatible: errors.length === 0,
    errors,
    warnings,
    negotiatedAt: now
  };
}

function normalizeProvider(input = {}, now = new Date().toISOString()) {
  const provider = asObject(input.provider);
  const negotiation = normalizeCapabilities(provider);
  const serviceContract = normalizeServiceContract(provider, negotiation, now);

  return {
    providerId: asString(provider.providerId, DEFAULT_PROVIDER),
    service: asString(provider.service, 'aios-hosted-kernel'),
    endpoint: asString(provider.endpoint, 'internal://kernel/process-snapshot'),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    negotiation,
    serviceContract,
    accepted: negotiation.compatible && serviceContract.compatible,
    contract: {
      request: {
        kernelSessionId: 'string',
        tenantId: 'string',
        workspaceId: 'string',
        roles: 'string[]',
        permissions: 'string[]',
        includeProcessTable: 'boolean',
        includeExternalHandoff: 'boolean',
        providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
        providerSyncMode: 'push | pull | bidirectional',
        handoffTarget: 'external-orchestrator | runtime-client | operator-workbench',
        lifecycleSettings: {
          enabled: 'boolean',
          enabledControls: 'KernelLifecycleControlId[]',
          disabledControls: 'KernelLifecycleControlId[]',
          schedule: 'KernelLifecycleCommandSchedule',
          controls: 'Record<KernelLifecycleControlId, KernelLifecycleControlOverride>'
        }
      },
      response: {
        snapshotId: 'string',
        accessBoundary: 'KernelTenantWorkspaceAccessBoundary',
        sync: 'KernelSnapshotSyncMetadata',
        providerSync: 'KernelProviderSnapshotSyncEnvelope',
        persistedState: 'KernelPersistedProcessSnapshotState',
        recovery: 'KernelProcessSnapshotRecoveryPlan',
        processTable: 'KernelProcessRecord[]',
        handoff: 'KernelExternalHandoffState',
        clientRuntime: 'KernelSnapshotClientRuntimeState',
        lifecycleSettings: 'KernelLifecycleCommandSettings',
        workflowHandoff: 'KernelSnapshotWorkflowHandoff',
        providerDelivery: 'KernelProviderHandoffDeliveryContract',
        providerCommandHandoff: 'KernelProviderCommandHandoffContract',
        restartCommandJournal: 'KernelRestartSafeCommandJournal',
        operationalHealth: 'KernelProcessSnapshotOperationalHealth',
        preview: 'KernelProcessSnapshotPreviewModel',
        acceptance: 'KernelProcessSnapshotAcceptanceDecision',
        readiness: 'KernelProcessSnapshotReadinessGates',
        validationSummary: 'KernelProcessSnapshotValidationSummary',
        nextSteps: 'KernelProcessSnapshotNextStepPlan',
        clientActionContract: 'KernelProcessSnapshotPreviewAcceptanceContract',
        analytics: 'KernelProcessSnapshotAnalyticsExport',
        serializedSnapshot: 'KernelProcessSnapshotSerializedEnvelope'
      }
    }
  };
}

function normalizePersistedCommandLedger(persisted, defaultIdempotencyKey, sync, now) {
  const ledger = asObject(persisted.commandLedger || persisted.recoveryCommandLedger);
  const rawCommands = [
    ...(Array.isArray(ledger.commands) ? ledger.commands : []),
    ...(Array.isArray(persisted.commands) ? persisted.commands : []),
    ...(Array.isArray(persisted.recoveryCommands) ? persisted.recoveryCommands : []),
    ...(Array.isArray(persisted.appliedCommands) ? persisted.appliedCommands : [])
  ];
  const records = rawCommands.map((command, index) => {
    const record = asObject(command);
    const type = asString(record.type || record.commandType, 'unknown-command');
    const id = asString(record.id || record.commandId, `${defaultIdempotencyKey}:${type}:${index + 1}`);
    const requestedState = asString(record.state || record.status, record.completedAt ? 'completed' : 'pending');
    const state = PERSISTED_COMMAND_STATES.has(requestedState) ? requestedState : 'pending';
    const checkpoint = asString(record.checkpoint || record.syncCheckpoint, sync.checkpoint);
    const idempotencyKey = asString(record.idempotencyKey, `${defaultIdempotencyKey}#${type}`);
    const attempts = normalizePositiveInteger(record.attempts || record.attemptCount, 0, 0, 1000);
    const completedAt = asString(record.completedAt || record.appliedAt, null);
    const invalidReasons = normalizeStringList([
      ...(type === 'unknown-command' ? ['missing-command-type'] : []),
      ...(state === 'completed' && !completedAt ? ['completed-command-missing-completed-at'] : []),
      ...(checkpoint !== sync.checkpoint ? [`checkpoint-mismatch:${checkpoint}`] : [])
    ]);

    return {
      id,
      type,
      idempotencyKey,
      checkpoint,
      state,
      attempts,
      completedAt,
      resultDigest: asString(record.resultDigest || record.digest, null),
      lastError: asString(record.lastError || record.error, null),
      valid: invalidReasons.length === 0,
      invalidReasons
    };
  });
  const validRecords = records.filter((record) => record.valid);
  const completedRecords = validRecords.filter((record) => record.state === 'completed');
  const failedRecords = validRecords.filter((record) => record.state === 'failed');
  const pendingRecords = validRecords.filter((record) => record.state === 'pending' || record.state === 'running');
  const completedCommandKeys = completedRecords.flatMap((record) => [record.id, record.idempotencyKey]);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    restoredAt: asString(ledger.restoredAt, now),
    cursor: asString(ledger.cursor || ledger.replayCursor, `${sync.checkpoint}:0`),
    records,
    validCount: validRecords.length,
    invalidCount: records.length - validRecords.length,
    completedCount: completedRecords.length,
    failedCount: failedRecords.length,
    pendingCount: pendingRecords.length,
    completedCommandKeys: [...new Set(completedCommandKeys)],
    failedCommandIds: failedRecords.map((record) => record.id),
    pendingCommandIds: pendingRecords.map((record) => record.id),
    restartSafe: failedRecords.length === 0 && records.every((record) => record.valid),
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        'persisted-command-ledger',
        sync.checkpoint,
        records.map((record) => `${record.id}:${record.state}:${record.idempotencyKey}`).join('|') || 'empty-ledger'
      ].join('#')
    }
  };
}

function normalizePersistedProcessRestoreRecords(rawProcesses, processTable, now) {
  const storedProcessIds = Object.keys(rawProcesses).filter((pid) => typeof pid === 'string' && pid.trim());
  const currentProcessIds = processTable.map((process) => process.pid);
  const currentProcessSet = new Set(currentProcessIds);
  const currentProcessById = processTable.reduce((index, process) => ({
    ...index,
    [process.pid]: process
  }), {});
  const storedOnlyRecords = storedProcessIds
    .filter((pid) => !currentProcessSet.has(pid))
    .map((pid) => {
      const stored = asObject(rawProcesses[pid]);
      return {
        pid,
        restoreState: 'missing-from-current-table',
        previousStatus: asString(stored.status, 'unknown'),
        currentStatus: null,
        previousCheckpointToken: asString(stored.checkpointToken, null),
        currentCheckpointToken: null,
        previousUpdatedAt: asString(stored.updatedAt, null),
        currentUpdatedAt: null,
        route: asString(stored.route, `${surfaceGroup}/${surfaceName}`),
        handoffEligible: false,
        replayRequired: true,
        driftReasons: ['process-missing-after-restart']
      };
    });
  const currentRecords = currentProcessIds.map((pid) => {
    const process = currentProcessById[pid];
    const stored = asObject(rawProcesses[pid]);
    const hadStoredRecord = storedProcessIds.includes(pid);
    const previousStatus = asString(stored.status, null);
    const previousCheckpointToken = asString(stored.checkpointToken, null);
    const statusChanged = hadStoredRecord && previousStatus !== process.status;
    const checkpointChanged = hadStoredRecord && previousCheckpointToken !== process.checkpointToken;
    const driftReasons = normalizeStringList([
      ...(hadStoredRecord ? [] : ['process-new-after-restart']),
      ...(statusChanged ? [`status-changed:${previousStatus}->${process.status}`] : []),
      ...(checkpointChanged ? ['checkpoint-token-changed'] : [])
    ]);
    const restoreState = !hadStoredRecord
      ? 'new-current-process'
      : driftReasons.length > 0 ? 'changed-since-persist' : 'restored';

    return {
      pid,
      restoreState,
      previousStatus,
      currentStatus: process.status,
      previousCheckpointToken,
      currentCheckpointToken: process.checkpointToken,
      previousUpdatedAt: asString(stored.updatedAt, null),
      currentUpdatedAt: process.updatedAt || now,
      route: process.route,
      handoffEligible: process.handoffEligible,
      replayRequired: driftReasons.length > 0,
      driftReasons
    };
  });
  const records = [...currentRecords, ...storedOnlyRecords];

  return {
    records,
    restoredProcessIds: records.filter((record) => record.restoreState === 'restored').map((record) => record.pid),
    replayRequiredProcessIds: records.filter((record) => record.replayRequired).map((record) => record.pid),
    missingProcessIds: storedOnlyRecords.map((record) => record.pid),
    newProcessIds: currentRecords.filter((record) => record.restoreState === 'new-current-process').map((record) => record.pid),
    changedProcessIds: currentRecords.filter((record) => record.restoreState === 'changed-since-persist').map((record) => record.pid),
    clean: records.every((record) => !record.replayRequired)
  };
}

function normalizePersistedBoundaryOwnership(persisted, storage, rawProcesses, processTable, accessBoundary, clientRuntime, sync, now) {
  const explicitTenantId = asString(persisted.tenantId || storage.tenantId || persisted.ownerTenantId, null);
  const explicitWorkspaceId = asString(persisted.workspaceId || storage.workspaceId || persisted.ownerWorkspaceId, null);
  const expectedTenantId = accessBoundary.tenantId;
  const expectedWorkspaceId = accessBoundary.workspaceId;
  const partitionKey = asString(storage.partitionKey || persisted.partitionKey, null);
  const expectedPartitionKey = [expectedTenantId, expectedWorkspaceId].join('/');
  const permissionSet = new Set(accessBoundary.permissions);
  const crossTenantAllowed = permissionSet.has('tenant:cross-tenant');
  const crossWorkspaceAllowed = crossTenantAllowed || permissionSet.has('tenant:cross-workspace');
  const persistedProcessRecords = Object.entries(rawProcesses)
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([pid, value]) => {
      const process = asObject(value);
      return {
        pid,
        tenantId: asString(process.tenantId, explicitTenantId),
        workspaceId: asString(process.workspaceId, explicitWorkspaceId)
      };
    });
  const currentProcessRecords = processTable.map((process) => ({
    pid: process.pid,
    tenantId: process.tenantId,
    workspaceId: process.workspaceId
  }));
  const persistedTenantIds = normalizeStringList([
    explicitTenantId,
    ...persistedProcessRecords.map((process) => process.tenantId)
  ]);
  const persistedWorkspaceIds = normalizeStringList([
    explicitWorkspaceId,
    ...persistedProcessRecords.map((process) => process.workspaceId)
  ]);
  const currentTenantIds = normalizeStringList(currentProcessRecords.map((process) => process.tenantId));
  const currentWorkspaceIds = normalizeStringList(currentProcessRecords.map((process) => process.workspaceId));
  const foreignTenantIds = persistedTenantIds.filter((tenantId) => tenantId !== expectedTenantId);
  const foreignWorkspaceIds = persistedWorkspaceIds.filter((workspaceId) => workspaceId !== expectedWorkspaceId);
  const tenantMismatch = foreignTenantIds.length > 0;
  const workspaceMismatch = foreignWorkspaceIds.length > 0;
  const partitionMismatch = Boolean(partitionKey) && partitionKey !== expectedPartitionKey;
  const blockedReasons = normalizeStringList([
    ...(tenantMismatch && !crossTenantAllowed ? foreignTenantIds.map((tenantId) => `persisted-tenant-mismatch:${tenantId}`) : []),
    ...(workspaceMismatch && !crossWorkspaceAllowed ? foreignWorkspaceIds.map((workspaceId) => `persisted-workspace-mismatch:${workspaceId}`) : []),
    ...(partitionMismatch && (!crossTenantAllowed || !crossWorkspaceAllowed) ? [`persisted-partition-mismatch:${partitionKey}`] : [])
  ]);
  const warnings = normalizeStringList([
    ...(tenantMismatch && crossTenantAllowed ? foreignTenantIds.map((tenantId) => `cross-tenant-persisted-state:${tenantId}`) : []),
    ...(workspaceMismatch && crossWorkspaceAllowed ? foreignWorkspaceIds.map((workspaceId) => `cross-workspace-persisted-state:${workspaceId}`) : []),
    ...(partitionMismatch && blockedReasons.length === 0 ? [`custom-persisted-partition:${partitionKey}`] : []),
    ...(persistedProcessRecords.length === 0 && (explicitTenantId || explicitWorkspaceId) ? ['persisted-state-has-owner-without-process-records'] : [])
  ]);
  const state = blockedReasons.length > 0
    ? 'blocked'
    : warnings.length > 0 ? 'elevated' : 'aligned';

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now,
    state,
    expected: {
      tenantId: expectedTenantId,
      workspaceId: expectedWorkspaceId,
      partitionKey: expectedPartitionKey
    },
    recorded: {
      tenantId: explicitTenantId,
      workspaceId: explicitWorkspaceId,
      partitionKey,
      tenantIds: persistedTenantIds,
      workspaceIds: persistedWorkspaceIds
    },
    current: {
      tenantIds: currentTenantIds,
      workspaceIds: currentWorkspaceIds,
      processCount: currentProcessRecords.length
    },
    privileges: {
      crossTenantAllowed,
      crossWorkspaceAllowed,
      roles: accessBoundary.roles
    },
    blocked: blockedReasons.length > 0,
    blockedReasons,
    warnings,
    handoff: {
      auditId: accessBoundary.actor,
      checkpoint: sync.checkpoint,
      requestId: clientRuntime.requestId,
      quarantineKey: blockedReasons.length > 0
        ? [clientRuntime.kernelSessionId, sync.checkpoint, 'persisted-boundary-quarantine'].join('#')
        : null
    },
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        'persisted-boundary-ownership',
        sync.checkpoint,
        expectedPartitionKey,
        partitionKey || 'no-partition',
        persistedTenantIds.join(',') || 'no-persisted-tenants',
        persistedWorkspaceIds.join(',') || 'no-persisted-workspaces',
        state,
        blockedReasons.join('|') || 'no-boundary-blockers'
      ].join('#'),
      sourceDigest: accessBoundary.proof.digest
    }
  };
}

function normalizeProcess(process, index, now) {
  const record = asObject(process);
  const pid = asString(record.pid, `process-${index + 1}`);
  const status = ['running', 'paused', 'waiting', 'exited', 'failed'].includes(record.status)
    ? record.status
    : 'waiting';

  return {
    pid,
    parentPid: asString(record.parentPid, null),
    status,
    tenantId: asString(record.tenantId, 'hosted-kernel-tenant'),
    workspaceId: asString(record.workspaceId, 'default-workspace'),
    requiredPermissions: requiredPermissionsForProcess(record),
    service: asString(record.service, 'unknown-service'),
    route: asString(record.route, `${surfaceGroup}/${surfaceName}`),
    startedAt: asString(record.startedAt, now),
    updatedAt: asString(record.updatedAt, now),
    handoffEligible: record.handoffEligible !== false && status !== 'exited' && status !== 'failed',
    checkpointToken: asString(record.checkpointToken, `${pid}:${status}`)
  };
}

function processSnapshotPriority(process) {
  const statusPriority = {
    running: 5,
    paused: 4,
    waiting: 3,
    failed: 2,
    exited: 1
  };
  return [
    process.handoffEligible ? 1 : 0,
    statusPriority[process.status] || 0,
    Date.parse(process.updatedAt) || 0,
    process.checkpointToken ? process.checkpointToken.length : 0
  ];
}

function compareProcessSnapshotPriority(left, right) {
  const leftPriority = processSnapshotPriority(left);
  const rightPriority = processSnapshotPriority(right);

  for (let index = 0; index < leftPriority.length; index += 1) {
    if (leftPriority[index] !== rightPriority[index]) {
      return leftPriority[index] - rightPriority[index];
    }
  }

  return 0;
}

function reconcileProcessSnapshotIdentity(rawProcessTable, now) {
  const buckets = rawProcessTable.reduce((index, process, originalIndex) => {
    const existing = index[process.pid] || [];
    return {
      ...index,
      [process.pid]: [...existing, { process, originalIndex }]
    };
  }, {});
  const duplicateBuckets = Object.entries(buckets).filter(([, records]) => records.length > 1);
  const selectedRecords = Object.values(buckets).map((records) => records
    .slice()
    .sort((left, right) => {
      const priorityDelta = compareProcessSnapshotPriority(right.process, left.process);
      return priorityDelta === 0 ? left.originalIndex - right.originalIndex : priorityDelta;
    })[0]);
  const processTable = selectedRecords
    .slice()
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map((record) => record.process);
  const conflicts = duplicateBuckets.map(([pid, records]) => {
    const winner = selectedRecords.find((record) => record.process.pid === pid);
    const rejected = records.filter((record) => record.originalIndex !== winner.originalIndex);
    const statuses = normalizeStringList(records.map((record) => record.process.status));
    const tenantIds = normalizeStringList(records.map((record) => record.process.tenantId));
    const workspaceIds = normalizeStringList(records.map((record) => record.process.workspaceId));
    const checkpointTokens = normalizeStringList(records.map((record) => record.process.checkpointToken));
    const conflictReasons = normalizeStringList([
      'duplicate-process-id',
      ...(statuses.length > 1 ? ['status-divergence'] : []),
      ...(tenantIds.length > 1 ? ['tenant-divergence'] : []),
      ...(workspaceIds.length > 1 ? ['workspace-divergence'] : []),
      ...(checkpointTokens.length > 1 ? ['checkpoint-token-divergence'] : [])
    ]);

    return {
      pid,
      duplicateCount: records.length,
      selectedOriginalIndex: winner.originalIndex,
      selectedCheckpointToken: winner.process.checkpointToken,
      selectedStatus: winner.process.status,
      selectedUpdatedAt: winner.process.updatedAt,
      rejectedOriginalIndexes: rejected.map((record) => record.originalIndex),
      rejectedCheckpointTokens: rejected.map((record) => record.process.checkpointToken),
      rejectedStatuses: rejected.map((record) => record.process.status),
      conflictReasons,
      resolution: 'selected-highest-priority-process-record'
    };
  });
  const duplicateProcessIds = conflicts.map((conflict) => conflict.pid);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now,
    inputCount: rawProcessTable.length,
    processCount: processTable.length,
    processTable,
    duplicateProcessIds,
    duplicateCount: rawProcessTable.length - processTable.length,
    conflicts,
    repaired: conflicts.length > 0,
    valid: conflicts.length === 0,
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        'process-identity-reconciliation',
        rawProcessTable.map((process) => `${process.pid}:${process.status}:${process.checkpointToken}`).join('|') || 'no-processes',
        conflicts.map((conflict) => `${conflict.pid}:${conflict.selectedCheckpointToken}:${conflict.rejectedCheckpointTokens.join(',')}`).join('|') || 'no-duplicates'
      ].join('#')
    }
  };
}

function normalizeClientRuntime(input, now, processTable) {
  const request = asObject(input.request);
  const client = asObject(input.clientRuntime || input.client);
  const workflow = asObject(request.workflowHandoff || request.workflow || client.workflowHandoff || client.workflow);
  const processIds = new Set(processTable.map((process) => process.pid));
  const rawRequestedProcessIds = Array.isArray(request.processIds)
    ? request.processIds
    : Array.isArray(client.processIds) ? client.processIds : [];
  const requestedProcessIds = rawRequestedProcessIds
    .filter((pid) => typeof pid === 'string' && pid.trim())
    .map((pid) => pid.trim());
  const selectedProcessIds = requestedProcessIds.filter((pid) => processIds.has(pid));
  const invalidProcessIds = requestedProcessIds.filter((pid) => !processIds.has(pid));
  const requestedFocus = asString(request.focusProcessId, asString(client.focusProcessId, selectedProcessIds[0] || null));
  const focusProcessId = processIds.has(requestedFocus) ? requestedFocus : null;
  const rawSurface = asString(client.surface, 'kernel-console');
  const surface = CLIENT_SURFACES.has(rawSurface) ? rawSurface : 'kernel-console';
  const includeExternalHandoff = request.includeExternalHandoff !== false && client.includeExternalHandoff !== false;
  const includeProcessTable = request.includeProcessTable !== false && input.includeProcessTable !== false;
  const requestedWorkflowMode = asString(workflow.mode || workflow.handoffMode, 'review-first');
  const requestedResumeStrategy = asString(workflow.resumeStrategy, focusProcessId ? 'focus-process' : 'first-transferable');
  const requestedHandoffTarget = asString(workflow.target || workflow.handoffTarget, null);
  const requestedReturnRoute = asString(workflow.returnRoute || workflow.clientReturnRoute, null);
  const workflowMode = CLIENT_WORKFLOW_MODES.has(requestedWorkflowMode) ? requestedWorkflowMode : 'review-first';
  const resumeStrategy = CLIENT_RESUME_STRATEGIES.has(requestedResumeStrategy)
    ? requestedResumeStrategy
    : focusProcessId ? 'focus-process' : 'first-transferable';
  const preferredHandoffTarget = requestedHandoffTarget && HANDOFF_TARGETS.has(requestedHandoffTarget)
    ? requestedHandoffTarget
    : null;
  const workflowWarnings = normalizeStringList([
    ...(CLIENT_WORKFLOW_MODES.has(requestedWorkflowMode) ? [] : [`unsupported-client-workflow-mode:${requestedWorkflowMode}`]),
    ...(CLIENT_RESUME_STRATEGIES.has(requestedResumeStrategy) ? [] : [`unsupported-client-resume-strategy:${requestedResumeStrategy}`]),
    ...(requestedHandoffTarget && !preferredHandoffTarget ? [`unsupported-client-handoff-target:${requestedHandoffTarget}`] : []),
    ...(requestedReturnRoute && !requestedReturnRoute.startsWith('/') && !requestedReturnRoute.startsWith(`${surfaceGroup}/`)
      ? [`non-local-return-route:${requestedReturnRoute}`]
      : [])
  ]);

  return {
    requestId: asString(request.requestId, `snapshot-request:${now}`),
    kernelSessionId: asString(request.kernelSessionId, asString(input.kernelSessionId, 'hosted-kernel-session')),
    actor: asString(request.actor, asString(client.actor, 'operator')),
    tenantId: asString(request.tenantId, asString(client.tenantId, 'hosted-kernel-tenant')),
    workspaceId: asString(request.workspaceId, asString(client.workspaceId, 'default-workspace')),
    surface,
    route: asString(client.route, `${surfaceGroup}/${surfaceName}`),
    includeProcessTable,
    includeExternalHandoff,
    focusProcessId,
    selectedProcessIds,
    invalidProcessIds,
    stateVersion: asString(client.stateVersion, `client-state:${now}`),
    workflowPreferences: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      mode: workflowMode,
      requestedMode: requestedWorkflowMode,
      resumeStrategy,
      requestedResumeStrategy,
      preferredHandoffTarget,
      requestedHandoffTarget,
      returnRoute: requestedReturnRoute || asString(client.route, `${surfaceGroup}/${surfaceName}`),
      notifyOnProviderAck: workflow.notifyOnProviderAck !== false,
      preserveSelectionOnReturn: workflow.preserveSelectionOnReturn !== false,
      warnings: workflowWarnings,
      preferenceKey: [
        asString(request.requestId, `snapshot-request:${now}`),
        workflowMode,
        resumeStrategy,
        preferredHandoffTarget || 'any-target',
        selectedProcessIds.join(',') || 'no-selection'
      ].join('#')
    },
    resumeAnchor: {
      processId: focusProcessId,
      checkpointToken: processTable.find((process) => process.pid === focusProcessId)?.checkpointToken || null,
      route: processTable.find((process) => process.pid === focusProcessId)?.route || `${surfaceGroup}/${surfaceName}`
    }
  };
}

function buildSyncMetadata(input, now, processTable, processIdentity = null) {
  const sync = asObject(input.sync);
  const checkpoint = asString(sync.checkpoint, input.checkpoint || `snapshot:${now}`);
  const identityDigest = processIdentity?.proof?.digest || 'no-process-identity-proof';

  return {
    channel: asString(sync.channel, DEFAULT_SYNC_CHANNEL),
    checkpoint,
    generatedAt: now,
    sourceClock: asString(sync.sourceClock, input.sourceClock || 'hosted-kernel-clock'),
    inputProcessCount: processIdentity?.inputCount ?? processTable.length,
    processCount: processTable.length,
    duplicateProcessCount: processIdentity?.duplicateCount ?? 0,
    duplicateProcessIds: processIdentity?.duplicateProcessIds || [],
    resumableCount: processTable.filter((process) => process.handoffEligible).length,
    proofDigest: [
      SNAPSHOT_SCHEMA_VERSION,
      checkpoint,
      processTable.map((process) => `${process.pid}:${process.status}:${process.checkpointToken}`).join('|'),
      identityDigest
    ].join('#')
  };
}

function buildProviderSyncEnvelope(providerContract, sync, clientRuntime, processTable, accessBoundary) {
  const visibleProcessSet = new Set(accessBoundary.visibleProcessIds);
  const transferableRecords = processTable
    .filter((process) => process.handoffEligible && visibleProcessSet.has(process.pid))
    .slice(0, providerContract.serviceContract.maxProcessBatchSize)
    .map((process) => ({
      pid: process.pid,
      status: process.status,
      service: process.service,
      route: process.route,
      checkpointToken: process.checkpointToken,
      updatedAt: process.updatedAt
    }));
  const overflowProcessIds = processTable
    .filter((process) => process.handoffEligible && visibleProcessSet.has(process.pid))
    .slice(providerContract.serviceContract.maxProcessBatchSize)
    .map((process) => process.pid);
  const lifecycleControls = providerContract.serviceContract.lifecycleControls;
  const controlPlan = {
    checkpointBeforeTransfer: lifecycleControls.includes('checkpoint-before-transfer'),
    pauseBeforeHandoff: lifecycleControls.includes('pause-before-handoff'),
    resumeAfterHandoff: lifecycleControls.includes('resume-after-handoff')
  };
  const syncVector = transferableRecords.map((process) => [
    process.pid,
    process.status,
    process.checkpointToken
  ].join(':'));

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    providerId: providerContract.providerId,
    service: providerContract.service,
    endpoint: providerContract.endpoint,
    protocolVersion: providerContract.serviceContract.protocolVersion,
    syncMode: providerContract.serviceContract.syncMode,
    channel: sync.channel,
    checkpoint: sync.checkpoint,
    clientRequestId: clientRuntime.requestId,
    kernelSessionId: clientRuntime.kernelSessionId,
    ackDeadlineMs: providerContract.serviceContract.ackDeadlineMs,
    leaseTtlMs: providerContract.serviceContract.leaseTtlMs,
    batch: {
      maxProcessBatchSize: providerContract.serviceContract.maxProcessBatchSize,
      transferableCount: transferableRecords.length,
      overflowProcessIds,
      processRecords: transferableRecords
    },
    controlPlan,
    compatible: providerContract.accepted && overflowProcessIds.length === 0,
    blockedReasons: [
      ...providerContract.serviceContract.errors.map((error) => `service-contract:${error}`),
      ...(overflowProcessIds.length ? ['provider-batch-size-exceeded'] : [])
    ],
    proof: {
      digest: [
        providerContract.providerId,
        providerContract.serviceContract.protocolVersion,
        sync.checkpoint,
        syncVector.join('|') || 'no-transferable-processes',
        accessBoundary.proof.digest
      ].join('#'),
      sourceDigest: sync.proofDigest
    }
  };
}

function isoFromMs(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function buildLifecycleScheduleDecision(control, now) {
  const nowMs = Date.parse(now);
  const runAtMs = control.runAt ? Date.parse(control.runAt) : null;
  const hasValidRunAt = runAtMs !== null && !Number.isNaN(runAtMs);
  const delayRunAtMs = control.delayMs > 0 && Number.isFinite(nowMs) ? nowMs + control.delayMs : null;
  const requestedFirstRunAtMs = hasValidRunAt ? runAtMs : delayRunAtMs;
  const firstRunAt = isoFromMs(requestedFirstRunAtMs);
  const catchupLimit = normalizePositiveInteger(
    control.maxCatchupRuns,
    DEFAULT_LIFECYCLE_RECURRING_CATCHUP_LIMIT,
    0,
    1000
  );
  const staleAfterMs = normalizePositiveInteger(
    control.staleAfterMs,
    DEFAULT_LIFECYCLE_SCHEDULE_STALE_AFTER_MS,
    0,
    86400000
  );
  let nextRunAt = firstRunAt;
  let dueNow = !firstRunAt || (requestedFirstRunAtMs !== null && requestedFirstRunAtMs <= nowMs);
  let overdueMs = dueNow && requestedFirstRunAtMs !== null ? Math.max(0, nowMs - requestedFirstRunAtMs) : 0;
  let missedRuns = 0;
  let catchupState = 'not-applicable';

  if (control.scheduleMode === 'recurring' && control.intervalMs > 0 && requestedFirstRunAtMs !== null) {
    const elapsedMs = Math.max(0, nowMs - requestedFirstRunAtMs);
    missedRuns = requestedFirstRunAtMs <= nowMs ? Math.floor(elapsedMs / control.intervalMs) + 1 : 0;
    const boundedMissedRuns = Math.min(missedRuns, catchupLimit);
    const nextRunAtMs = missedRuns > 0
      ? requestedFirstRunAtMs + (boundedMissedRuns * control.intervalMs)
      : requestedFirstRunAtMs;

    nextRunAt = isoFromMs(nextRunAtMs);
    dueNow = missedRuns > 0 && boundedMissedRuns === 0;
    overdueMs = missedRuns > 0 ? elapsedMs : 0;
    catchupState = missedRuns === 0
      ? 'waiting-first-run'
      : missedRuns > catchupLimit ? 'catchup-limit-exceeded' : 'advanced-to-next-run';
  }

  const stale = control.scheduleMode === 'deferred'
    && requestedFirstRunAtMs !== null
    && dueNow
    && overdueMs > staleAfterMs;
  const invalidReasons = normalizeStringList([
    ...(stale ? [`stale-deferred-run-at:${control.id}:${overdueMs}`] : []),
    ...(control.scheduleMode === 'recurring' && missedRuns > catchupLimit
      ? [`recurring-catchup-limit-exceeded:${control.id}:${missedRuns}`]
      : [])
  ]);

  return {
    firstRunAt,
    nextRunAt,
    dueNow,
    overdueMs,
    stale,
    catchupState,
    missedRuns,
    catchupLimit,
    staleAfterMs,
    invalidReasons
  };
}

function resolveLifecycleControlDispatch(control, sync, now) {
  const scheduleMode = control.scheduleMode;
  const disabled = !control.enabled || scheduleMode === 'disabled';
  const scheduleDecision = control.scheduleDecision || buildLifecycleScheduleDecision(control, now);
  const blockedReasons = normalizeStringList([
    ...control.invalidReasons,
    ...scheduleDecision.invalidReasons,
    ...(control.processIds.length > 0 ? [] : ['no-eligible-processes'])
  ]);
  const dispatchState = disabled
    ? 'disabled'
    : blockedReasons.length > 0 ? 'blocked'
      : scheduleMode === 'manual' ? 'queued'
        : scheduleMode === 'deferred' && !scheduleDecision.dueNow ? 'scheduled'
          : scheduleMode === 'recurring' ? 'recurring' : 'due';
  const executableNow = dispatchState === 'due' || dispatchState === 'queued';
  const schedulable = dispatchState === 'scheduled' || dispatchState === 'recurring';
  const nextRunAt = dispatchState === 'scheduled'
    ? scheduleDecision.nextRunAt
    : dispatchState === 'recurring'
      ? scheduleDecision.nextRunAt || now
      : executableNow ? now : null;
  const disabledBy = disabled
    ? control.providerSupported ? 'operator-settings' : 'provider-contract'
    : null;
  const nextAction = dispatchState === 'blocked'
    ? scheduleDecision.stale ? 'reschedule-stale-control' : 'resolve-control-blockers'
    : dispatchState === 'disabled'
      ? 'enable-control'
      : dispatchState === 'scheduled' ? 'wait-for-run-at'
        : dispatchState === 'recurring'
          ? scheduleDecision.catchupState === 'advanced-to-next-run' ? 'persist-advanced-recurring-schedule' : 'register-recurring-schedule'
          : 'dispatch-command';

  return {
    state: LIFECYCLE_COMMAND_DISPATCH_STATES.has(dispatchState) ? dispatchState : 'blocked',
    nextAction,
    executableNow,
    schedulable,
    disabledBy,
    dueAt: executableNow ? nextRunAt : null,
    nextRunAt,
    delayMs: control.delayMs,
    intervalMs: control.intervalMs,
    runAt: control.runAt,
    scheduleDecision,
    blockers: blockedReasons,
    routeIntent: [DEFAULT_SYNC_CHANNEL, sync.checkpoint, control.id, nextAction].join('#'),
    dispatchKey: [sync.checkpoint, control.commandType, dispatchState, control.processIds.join(',') || 'none'].join('#')
  };
}

function normalizeLifecycleSettings(input, providerContract, accessBoundary, processTable, sync, now) {
  const settings = asObject(input.lifecycleSettings || input.lifecycle || input.settings?.lifecycle);
  const controls = asObject(settings.controls);
  const schedule = asObject(settings.schedule || settings.scheduling);
  const requestedEnabledControls = normalizeStringList(settings.enabledControls, []);
  const requestedDisabledControls = normalizeStringList(settings.disabledControls, []);
  const enabledControls = new Set(requestedEnabledControls);
  const disabledControls = new Set(requestedDisabledControls);
  const unknownEnabledControls = requestedEnabledControls.filter((control) => !LIFECYCLE_CONTROLS.includes(control));
  const unknownDisabledControls = requestedDisabledControls.filter((control) => !LIFECYCLE_CONTROLS.includes(control));
  const conflictingControlRequests = requestedEnabledControls.filter((control) => disabledControls.has(control));
  const advertisedControls = new Set(providerContract.serviceContract.lifecycleControls);
  const permissionSet = new Set(accessBoundary.permissions);
  const visibleProcessIds = new Set(accessBoundary.visibleProcessIds);
  const commandProcessIds = processTable
    .filter((process) => process.handoffEligible && visibleProcessIds.has(process.pid))
    .map((process) => process.pid);
  const requestedMode = asString(schedule.mode || settings.scheduleMode, 'manual');
  const defaultScheduleMode = LIFECYCLE_SCHEDULE_MODES.has(requestedMode) ? requestedMode : 'manual';
  const requestedRunAt = asString(schedule.runAt || settings.runAt, null);
  const runAtMs = requestedRunAt ? Date.parse(requestedRunAt) : null;
  const invalidScheduleReasons = [
    ...(LIFECYCLE_SCHEDULE_MODES.has(requestedMode) ? [] : [`unsupported-schedule-mode:${requestedMode}`]),
    ...(requestedRunAt && Number.isNaN(runAtMs) ? [`invalid-run-at:${requestedRunAt}`] : []),
    ...(defaultScheduleMode === 'deferred' && !requestedRunAt && !schedule.delayMs ? ['deferred-schedule-missing-run-at-or-delay'] : []),
    ...(defaultScheduleMode === 'recurring' && !schedule.intervalMs ? ['recurring-schedule-missing-interval'] : [])
  ];
  const intervalMs = normalizePositiveInteger(schedule.intervalMs, 0, 0, 86400000);
  const staleAfterMs = normalizePositiveInteger(
    schedule.staleAfterMs || settings.staleAfterMs,
    DEFAULT_LIFECYCLE_SCHEDULE_STALE_AFTER_MS,
    0,
    86400000
  );
  const maxCatchupRuns = normalizePositiveInteger(
    schedule.maxCatchupRuns || settings.maxCatchupRuns,
    DEFAULT_LIFECYCLE_RECURRING_CATCHUP_LIMIT,
    0,
    1000
  );
  const scheduleWindow = {
    mode: defaultScheduleMode,
    runAt: requestedRunAt,
    delayMs: normalizePositiveInteger(schedule.delayMs, 0, 0, 86400000),
    intervalMs,
    staleAfterMs,
    maxCatchupRuns,
    timezone: asString(schedule.timezone, 'UTC'),
    valid: invalidScheduleReasons.length === 0,
    invalidReasons: invalidScheduleReasons
  };

  const normalizedControls = LIFECYCLE_CONTROLS.map((control) => {
    const override = asObject(controls[control]);
    const requestedControlMode = asString(override.scheduleMode, scheduleWindow.mode);
    const scheduleMode = LIFECYCLE_SCHEDULE_MODES.has(requestedControlMode) ? requestedControlMode : scheduleWindow.mode;
    const permission = LIFECYCLE_CONTROL_PERMISSIONS[control];
    const providerSupported = advertisedControls.has(control);
    const explicitlyEnabled = enabledControls.has(control) || override.enabled === true;
    const explicitlyDisabled = disabledControls.has(control) || override.enabled === false || scheduleMode === 'disabled';
    const enabled = settings.enabled === false
      ? false
      : explicitlyDisabled ? false : explicitlyEnabled || providerSupported;
    const permissionAllowed = permissionSet.has(permission);
    const runAt = asString(override.runAt, scheduleWindow.runAt);
    const delayMs = normalizePositiveInteger(override.delayMs, scheduleWindow.delayMs, 0, 86400000);
    const intervalMs = normalizePositiveInteger(override.intervalMs, scheduleWindow.intervalMs, 0, 86400000);
    const controlStaleAfterMs = normalizePositiveInteger(
      override.staleAfterMs,
      scheduleWindow.staleAfterMs,
      0,
      86400000
    );
    const controlMaxCatchupRuns = normalizePositiveInteger(
      override.maxCatchupRuns,
      scheduleWindow.maxCatchupRuns,
      0,
      1000
    );
    const invalidScheduleMode = !LIFECYCLE_SCHEDULE_MODES.has(requestedControlMode);
    const conflictRequested = enabledControls.has(control) && disabledControls.has(control);
    const scheduleDecision = buildLifecycleScheduleDecision({
      id: control,
      scheduleMode,
      runAt,
      delayMs,
      intervalMs,
      staleAfterMs: controlStaleAfterMs,
      maxCatchupRuns: controlMaxCatchupRuns
    }, now);
    const errors = [
      ...(providerSupported ? [] : [`provider-missing-control:${control}`]),
      ...(enabled ? [] : [`control-disabled:${control}`]),
      ...(permissionAllowed ? [] : [`missing-permission:${permission}`]),
      ...(conflictRequested ? [`conflicting-control-toggle:${control}`] : []),
      ...(invalidScheduleMode ? [`unsupported-control-schedule-mode:${control}:${requestedControlMode}`] : []),
      ...(runAt && Number.isNaN(Date.parse(runAt)) ? [`invalid-control-run-at:${control}:${runAt}`] : []),
      ...(scheduleMode === 'deferred' && !runAt && delayMs <= 0 ? [`control-missing-run-at-or-delay:${control}`] : []),
      ...(scheduleMode === 'recurring' && intervalMs <= 0 ? [`control-missing-interval:${control}`] : []),
      ...scheduleDecision.invalidReasons
    ];
    const controlRecord = {
      id: control,
      commandType: LIFECYCLE_COMMAND_TYPES[control],
      enabled,
      providerSupported,
      permission,
      permissionAllowed,
      scheduleMode,
      runAt,
      delayMs,
      intervalMs,
      staleAfterMs: controlStaleAfterMs,
      maxCatchupRuns: controlMaxCatchupRuns,
      scheduleDecision,
      processIds: commandProcessIds,
      valid: errors.length === 0,
      invalidReasons: errors
    };

    return {
      ...controlRecord,
      dispatch: resolveLifecycleControlDispatch(controlRecord, sync, now)
    };
  });
  const requiredControls = ['checkpoint-before-transfer'];
  const errors = normalizeStringList([
    ...scheduleWindow.invalidReasons,
    ...unknownEnabledControls.map((control) => `unknown-enabled-control:${control}`),
    ...unknownDisabledControls.map((control) => `unknown-disabled-control:${control}`),
    ...conflictingControlRequests.map((control) => `conflicting-control-toggle:${control}`),
    ...normalizedControls
      .filter((control) => requiredControls.includes(control.id) || control.enabled)
      .flatMap((control) => control.invalidReasons)
  ]);
  const dispatchSummary = normalizedControls.reduce((summary, control) => ({
    ...summary,
    [control.dispatch.state]: (summary[control.dispatch.state] || 0) + 1
  }), {});
  const executableControls = normalizedControls.filter((control) => control.dispatch.executableNow);
  const scheduledControls = normalizedControls.filter((control) => control.dispatch.schedulable);
  const blockedControls = normalizedControls.filter((control) => control.dispatch.state === 'blocked');
  const disabledControlRecords = normalizedControls.filter((control) => control.dispatch.state === 'disabled');
  const warnings = normalizeStringList([
    ...(settings.enabled === false ? ['lifecycle-settings-disabled'] : []),
    ...unknownEnabledControls.map((control) => `ignored-unknown-enabled-control:${control}`),
    ...unknownDisabledControls.map((control) => `ignored-unknown-disabled-control:${control}`),
    ...conflictingControlRequests.map((control) => `control-toggle-conflict-prefers-disabled:${control}`),
    ...normalizedControls
      .filter((control) => control.dispatch.scheduleDecision.catchupState === 'advanced-to-next-run')
      .map((control) => `recurring-control-advanced:${control.id}:${control.dispatch.scheduleDecision.missedRuns}`),
    ...normalizedControls
      .filter((control) => !control.enabled && !requiredControls.includes(control.id))
      .map((control) => `optional-control-disabled:${control.id}`),
    ...(commandProcessIds.length === 0 ? ['no-lifecycle-command-processes'] : [])
  ]);
  const commands = normalizedControls
    .filter((control) => control.valid && control.processIds.length > 0)
    .map((control) => ({
      id: [sync.checkpoint, control.commandType, control.scheduleMode].join(':'),
      type: control.commandType,
      control: control.id,
      permission: control.permission,
      scheduleMode: control.scheduleMode,
      runAt: control.runAt,
      delayMs: control.delayMs,
      intervalMs: control.intervalMs,
      staleAfterMs: control.staleAfterMs,
      maxCatchupRuns: control.maxCatchupRuns,
      checkpoint: sync.checkpoint,
      processIds: control.processIds,
      idempotencyKey: [sync.checkpoint, control.id, control.processIds.join(',')].join('#'),
      dispatchState: control.dispatch.state,
      dispatchKey: control.dispatch.dispatchKey,
      executableNow: control.dispatch.executableNow,
      schedulable: control.dispatch.schedulable,
      dueAt: control.dispatch.dueAt,
      nextRunAt: control.dispatch.nextRunAt,
      firstRunAt: control.dispatch.scheduleDecision.firstRunAt,
      scheduleCatchupState: control.dispatch.scheduleDecision.catchupState,
      missedRuns: control.dispatch.scheduleDecision.missedRuns,
      routeIntent: control.dispatch.routeIntent
    }));
  const nextAction = errors.length > 0
    ? 'resolve-lifecycle-settings'
    : executableControls.length > 0 ? 'dispatch-lifecycle-commands'
      : scheduledControls.length > 0 ? 'schedule-lifecycle-commands'
        : commands.length > 0 ? 'queue-lifecycle-commands' : 'monitor-lifecycle';

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    enabled: settings.enabled !== false,
    schedule: scheduleWindow,
    controls: normalizedControls,
    dispatch: {
      state: errors.length > 0
        ? 'blocked'
        : executableControls.length > 0 ? 'ready'
          : scheduledControls.length > 0 ? 'scheduled'
            : disabledControlRecords.length === normalizedControls.length ? 'disabled' : 'idle',
      counts: {
        ...dispatchSummary,
        executable: executableControls.length,
        schedulable: scheduledControls.length,
        blocked: blockedControls.length,
        disabled: disabledControlRecords.length
      },
      executableControlIds: executableControls.map((control) => control.id),
      scheduledControlIds: scheduledControls.map((control) => control.id),
      blockedControlIds: blockedControls.map((control) => control.id),
      disabledControlIds: disabledControlRecords.map((control) => control.id),
      nextRunAt: scheduledControls
        .map((control) => control.dispatch.nextRunAt)
        .filter(Boolean)
        .sort()[0] || null,
      routeIntents: normalizedControls.map((control) => ({
        control: control.id,
        action: control.dispatch.nextAction,
        routeIntent: control.dispatch.routeIntent,
        dispatchKey: control.dispatch.dispatchKey,
        firstRunAt: control.dispatch.scheduleDecision.firstRunAt,
        nextRunAt: control.dispatch.scheduleDecision.nextRunAt,
        scheduleState: control.dispatch.scheduleDecision.catchupState
      }))
    },
    commands,
    commandCount: commands.length,
    nextAction,
    valid: errors.length === 0,
    errors,
    warnings,
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        sync.checkpoint,
        scheduleWindow.mode,
        normalizedControls.map((control) => `${control.id}:${control.enabled ? 'on' : 'off'}:${control.scheduleMode}:${control.dispatch.state}`).join('|'),
        commands.map((command) => command.id).join('|') || 'no-lifecycle-commands'
      ].join('#'),
      sourceDigest: sync.proofDigest
    }
  };
}

function normalizePersistedSnapshot(input, now, processTable, sync, clientRuntime, accessBoundary) {
  const persisted = asObject(input.persistedState || input.persistedSnapshot || input.previousSnapshot);
  const rawProcesses = asObject(persisted.processes);
  const restoreIndex = normalizePersistedProcessRestoreRecords(rawProcesses, processTable, now);
  const storedCheckpoint = asString(persisted.checkpoint, persisted.syncCheckpoint || null);
  const storedRequestId = asString(persisted.requestId, null);
  const storedKernelSessionId = asString(persisted.kernelSessionId, null);
  const currentProcessIds = processTable.map((process) => process.pid);
  const storage = asObject(persisted.storage || persisted.persistence || persisted.store);
  const persistedRevision = normalizePositiveInteger(persisted.revision || storage.revision, 0, 0);
  const nowMs = Date.parse(now);
  const lastPersistedAt = asString(persisted.persistedAt || storage.persistedAt, null);
  const heartbeatAt = asString(persisted.heartbeatAt || storage.heartbeatAt || persisted.lastHeartbeatAt, lastPersistedAt);
  const heartbeatAgeMs = heartbeatAt && !Number.isNaN(Date.parse(heartbeatAt)) && !Number.isNaN(nowMs)
    ? Math.max(0, nowMs - Date.parse(heartbeatAt))
    : null;
  const leaseTtlMs = normalizePositiveInteger(storage.leaseTtlMs || persisted.leaseTtlMs, 30000, 1000, 300000);
  const leaseExpired = heartbeatAgeMs !== null && heartbeatAgeMs > leaseTtlMs;
  const boundaryOwnership = normalizePersistedBoundaryOwnership(persisted, storage, rawProcesses, processTable, accessBoundary, clientRuntime, sync, now);
  const idempotencyKey = asString(
    persisted.idempotencyKey,
    [clientRuntime.kernelSessionId, clientRuntime.requestId, sync.checkpoint].join('#')
  );
  const commandLedger = normalizePersistedCommandLedger(persisted, idempotencyKey, sync, now);
  const reusable = storedCheckpoint === sync.checkpoint
    && (!storedRequestId || storedRequestId === clientRuntime.requestId)
    && (!storedKernelSessionId || storedKernelSessionId === clientRuntime.kernelSessionId)
    && !boundaryOwnership.blocked
    && restoreIndex.missingProcessIds.length === 0
    && restoreIndex.changedProcessIds.length === 0
    && !leaseExpired
    && commandLedger.restartSafe;
  const status = reusable
    ? 'clean'
    : boundaryOwnership.blocked ? 'conflict'
    : commandLedger.failedCount > 0 || commandLedger.invalidCount > 0 ? 'conflict'
    : leaseExpired && commandLedger.pendingCount > 0 ? 'conflict'
    : storedCheckpoint && storedCheckpoint !== sync.checkpoint ? 'stale'
      : restoreIndex.changedProcessIds.length > 0 || restoreIndex.missingProcessIds.length > 0 ? 'conflict' : 'recovering';
  const replayState = commandLedger.failedCount > 0
    ? 'requires-operator-reconcile'
    : boundaryOwnership.blocked ? 'quarantine-boundary-mismatch'
    : leaseExpired && commandLedger.pendingCount > 0 ? 'expired-lease-reconcile'
    : commandLedger.pendingCount > 0 ? 'resume-pending-commands'
      : commandLedger.completedCount > 0 ? 'suppress-completed-commands' : 'no-command-history';
  const writeIntent = {
    storeKey: asString(storage.storeKey, [clientRuntime.kernelSessionId, clientRuntime.workspaceId, sync.checkpoint].join('/')),
    partitionKey: asString(storage.partitionKey, boundaryOwnership.expected.partitionKey),
    revision: persistedRevision + 1,
    previousRevision: persistedRevision,
    compareAndSwapToken: asString(storage.etag || storage.compareAndSwapToken, storedCheckpoint || 'new-snapshot'),
    mode: boundaryOwnership.blocked
      ? 'quarantine-boundary-mismatch'
      : status === 'clean' ? 'confirm-existing' : status === 'stale' ? 'write-refreshed-checkpoint' : 'write-recovery-state',
    durableProcessCount: currentProcessIds.length,
    replayRequiredProcessIds: restoreIndex.replayRequiredProcessIds,
    commandCursor: commandLedger.cursor,
    idempotencyKey: `${idempotencyKey}#persist-state`,
    shouldPersist: !boundaryOwnership.blocked && (status !== 'clean' || commandLedger.pendingCount > 0 || restoreIndex.newProcessIds.length > 0),
    blockedReasons: normalizeStringList([
      ...boundaryOwnership.blockedReasons,
      ...(commandLedger.invalidCount > 0 ? ['command-ledger-invalid'] : []),
      ...(commandLedger.failedCount > 0 ? ['command-ledger-has-failed-commands'] : []),
      ...(leaseExpired ? ['persisted-state-lease-expired'] : [])
    ])
  };

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    status: RECOVERY_STATES.has(status) ? status : 'recovering',
    idempotencyKey,
    checkpoint: sync.checkpoint,
    previousCheckpoint: storedCheckpoint,
    requestId: clientRuntime.requestId,
    previousRequestId: storedRequestId,
    kernelSessionId: clientRuntime.kernelSessionId,
    previousKernelSessionId: storedKernelSessionId,
    generatedAt: now,
    restoredAt: asString(persisted.restoredAt, storedCheckpoint ? now : null),
    processIds: currentProcessIds,
    storage: {
      ...writeIntent,
      persistedAt: lastPersistedAt,
      heartbeatAt,
      heartbeatAgeMs,
      leaseTtlMs,
      leaseExpired,
      restartStatus: leaseExpired ? 'expired-lease' : reusable ? 'same-revision' : 'new-revision-required'
    },
    restart: {
      safe: !boundaryOwnership.blocked && (reusable || (status === 'recovering' && commandLedger.restartSafe)),
      replayState,
      reusable,
      reason: reusable
        ? 'persisted-state-matches-current-snapshot'
        : boundaryOwnership.blocked ? 'persisted-state-outside-active-tenant-boundary'
        : leaseExpired ? 'persisted-state-lease-expired'
        : status === 'stale' ? 'checkpoint-changed-since-persist'
          : status === 'conflict' ? 'persisted-state-requires-reconciliation' : 'persisted-state-can-recover'
    },
    boundaryOwnership,
    commandLedger,
    restoreIndex,
    processIndex: processTable.reduce((index, process) => ({
      ...index,
      [process.pid]: {
        status: process.status,
        route: process.route,
        checkpointToken: process.checkpointToken,
        handoffEligible: process.handoffEligible,
        updatedAt: process.updatedAt
      }
    }), {}),
    drift: {
      missingProcessIds: restoreIndex.missingProcessIds,
      newProcessIds: restoreIndex.newProcessIds,
      changedProcessIds: restoreIndex.changedProcessIds,
      replayRequiredProcessIds: restoreIndex.replayRequiredProcessIds
    },
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        idempotencyKey,
        sync.proofDigest,
        boundaryOwnership.proof.digest,
        commandLedger.proof.digest,
        replayState,
        writeIntent.storeKey,
        restoreIndex.records.map((record) => `${record.pid}:${record.restoreState}`).join('|') || 'no-restore-records'
      ].join('#'),
      sourceDigest: sync.proofDigest
    }
  };
}

function buildRecoveryPlan(persistedState, sync, handoff, acceptance, processTable) {
  const commands = [];
  const suppressedCommands = [];
  const commandBase = `${persistedState.idempotencyKey}:${persistedState.checkpoint}`;
  const completedCommandKeys = new Set(persistedState.commandLedger.completedCommandKeys);
  const pushCommand = (command) => {
    const replayStatus = completedCommandKeys.has(command.id) || completedCommandKeys.has(command.idempotencyKey)
      ? 'already-applied'
      : 'pending';
    const shapedCommand = {
      ...command,
      replayStatus,
      restartSafe: replayStatus === 'already-applied' || persistedState.commandLedger.restartSafe
    };

    if (replayStatus === 'already-applied') {
      suppressedCommands.push({
        ...shapedCommand,
        suppressedReason: 'completed-command-recovered-from-persisted-ledger'
      });
      return;
    }

    commands.push(shapedCommand);
  };

  if (persistedState.status === 'stale') {
    pushCommand({
      id: `${commandBase}:refresh-snapshot`,
      type: 'refresh-snapshot',
      idempotencyKey: `${persistedState.idempotencyKey}#refresh-snapshot`,
      checkpoint: persistedState.checkpoint,
      reason: 'persisted-checkpoint-mismatch'
    });
  }

  if (persistedState.status === 'conflict') {
    pushCommand({
      id: `${commandBase}:reconcile-process-table`,
      type: 'reconcile-process-table',
      idempotencyKey: `${persistedState.idempotencyKey}#reconcile-process-table`,
      checkpoint: persistedState.checkpoint,
      processIds: [
        ...persistedState.drift.missingProcessIds,
        ...persistedState.drift.changedProcessIds
      ],
      commandIds: persistedState.commandLedger.failedCommandIds,
      reason: 'persisted-process-state-drift'
    });
  }

  if (persistedState.boundaryOwnership.blocked) {
    pushCommand({
      id: `${commandBase}:quarantine-persisted-boundary`,
      type: 'quarantine-persisted-boundary',
      idempotencyKey: persistedState.boundaryOwnership.handoff.quarantineKey,
      checkpoint: persistedState.checkpoint,
      storeKey: persistedState.storage.storeKey,
      partitionKey: persistedState.storage.partitionKey,
      expectedTenantId: persistedState.boundaryOwnership.expected.tenantId,
      expectedWorkspaceId: persistedState.boundaryOwnership.expected.workspaceId,
      recordedTenantIds: persistedState.boundaryOwnership.recorded.tenantIds,
      recordedWorkspaceIds: persistedState.boundaryOwnership.recorded.workspaceIds,
      blockedReasons: persistedState.boundaryOwnership.blockedReasons,
      reason: 'persisted-state-crosses-active-tenant-boundary'
    });
  }

  if (persistedState.storage.shouldPersist) {
    pushCommand({
      id: `${commandBase}:persist-recovery-state`,
      type: 'persist-recovery-state',
      idempotencyKey: persistedState.storage.idempotencyKey,
      checkpoint: persistedState.checkpoint,
      storeKey: persistedState.storage.storeKey,
      partitionKey: persistedState.storage.partitionKey,
      revision: persistedState.storage.revision,
      previousRevision: persistedState.storage.previousRevision,
      compareAndSwapToken: persistedState.storage.compareAndSwapToken,
      writeMode: persistedState.storage.mode,
      processIds: persistedState.processIds,
      replayRequiredProcessIds: persistedState.drift.replayRequiredProcessIds,
      blockedReasons: persistedState.storage.blockedReasons,
      reason: persistedState.storage.leaseExpired
        ? 'persist-recovery-after-expired-lease'
        : persistedState.status === 'stale' ? 'persist-refreshed-checkpoint' : 'persist-shaped-recovery-state'
    });
  }

  if (handoff.state === 'ready' && acceptance.accepted) {
    pushCommand({
      id: `${commandBase}:commit-external-handoff`,
      type: 'commit-external-handoff',
      idempotencyKey: `${persistedState.idempotencyKey}#commit-external-handoff`,
      checkpoint: sync.checkpoint,
      commitToken: acceptance.commitToken,
      processIds: acceptance.processIds,
      reason: 'accepted-handoff-ready'
    });
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    restartSafe: persistedState.restart.safe && commands.every((command) => command.restartSafe),
    status: commands.length === 0 && suppressedCommands.length > 0
      ? 'replayed'
      : commands.length === 0 && persistedState.status === 'clean' ? 'restored' : persistedState.status,
    idempotencyKey: persistedState.idempotencyKey,
    checkpoint: sync.checkpoint,
    processCount: processTable.length,
    resumableProcessIds: processTable.filter((process) => process.handoffEligible).map((process) => process.pid),
    commands,
    suppressedCommands,
    commandCount: commands.length,
    suppressedCommandCount: suppressedCommands.length,
    commandLedger: {
      cursor: persistedState.commandLedger.cursor,
      completedCount: persistedState.commandLedger.completedCount,
      failedCount: persistedState.commandLedger.failedCount,
      pendingCount: persistedState.commandLedger.pendingCount,
      restartSafe: persistedState.commandLedger.restartSafe
    },
    proof: {
      digest: [
        persistedState.proof.digest,
        commands.map((command) => command.id).join('|') || 'no-commands',
        suppressedCommands.map((command) => command.id).join('|') || 'no-suppressed-commands'
      ].join('#'),
      sourceDigest: sync.proofDigest
    }
  };
}

function buildRestartCommandJournal(persistedState, recovery, lifecycleSettings, providerCommandHandoff, providerDelivery, sync, now) {
  const completedCommandKeys = new Set(persistedState.commandLedger.completedCommandKeys);
  const ledgerByIdempotencyKey = persistedState.commandLedger.records.reduce((index, record) => ({
    ...index,
    [record.idempotencyKey]: record
  }), {});
  const ledgerByCommandId = persistedState.commandLedger.records.reduce((index, record) => ({
    ...index,
    [record.id]: record
  }), {});
  const rawCommands = [
    ...recovery.commands.map((command) => ({ source: 'recovery', phase: 'recovery', command })),
    ...recovery.suppressedCommands.map((command) => ({ source: 'recovery', phase: 'recovery', command })),
    ...lifecycleSettings.commands.map((command) => ({ source: 'lifecycle', phase: 'lifecycle-control', command })),
    ...providerCommandHandoff.commands.map((command) => ({ source: 'provider', phase: command.phase, command }))
  ];
  const uniqueCommands = rawCommands.reduce((records, entry) => {
    const command = asObject(entry.command);
    const idempotencyKey = asString(command.idempotencyKey, `${persistedState.idempotencyKey}#${entry.source}:${records.length + 1}`);
    const existingIndex = records.findIndex((record) => record.idempotencyKey === idempotencyKey);
    const normalizedEntry = {
      ...entry,
      command: {
        ...command,
        id: asString(command.id || command.sourceCommandId, `${idempotencyKey}:command`),
        idempotencyKey
      }
    };

    if (existingIndex === -1) return [...records, normalizedEntry];

    const existing = records[existingIndex];
    const preferred = existing.source === 'recovery' ? existing : normalizedEntry;
    return records.map((record, index) => (index === existingIndex ? preferred : record));
  }, []);
  const records = uniqueCommands.map((entry, index) => {
    const command = entry.command;
    const ledgerRecord = ledgerByCommandId[command.id] || ledgerByIdempotencyKey[command.idempotencyKey] || null;
    const completed = completedCommandKeys.has(command.id) || completedCommandKeys.has(command.idempotencyKey)
      || ledgerRecord?.state === 'completed'
      || command.replayStatus === 'already-applied'
      || command.dispatchState === 'completed';
    const scheduled = command.schedulable || command.dispatchState === 'scheduled' || command.dispatchState === 'recurring';
    const waitingAck = entry.source === 'provider'
      && command.requiredAckState === 'acknowledged'
      && providerDelivery.acknowledgement.state === 'pending';
    const blockedReasons = normalizeStringList([
      ...normalizeStringList(command.blockedReasons, []),
      ...(ledgerRecord && !ledgerRecord.valid ? ledgerRecord.invalidReasons.map((reason) => `ledger:${reason}`) : []),
      ...(ledgerRecord?.state === 'failed' ? [`ledger-failed:${ledgerRecord.lastError || 'unknown'}`] : []),
      ...(persistedState.status === 'conflict' && entry.source !== 'recovery' ? ['persisted-state-conflict'] : []),
      ...(providerDelivery.acknowledgement.state === 'rejected' && entry.source === 'provider' ? ['provider-ack-rejected'] : []),
      ...(providerDelivery.acknowledgement.state === 'timed-out' && entry.source === 'provider' ? ['provider-ack-timed-out'] : [])
    ]);
    const requestedState = completed
      ? (command.suppressedReason ? 'suppressed' : 'completed')
      : blockedReasons.length > 0 ? 'blocked'
        : waitingAck ? 'waiting-ack'
          : scheduled ? 'scheduled' : 'dispatchable';
    const state = RESTART_COMMAND_STATES.has(requestedState) ? requestedState : 'blocked';

    return {
      id: command.id,
      sequence: index + 1,
      source: entry.source,
      phase: entry.phase,
      type: asString(command.type, 'unknown-command'),
      checkpoint: asString(command.checkpoint, sync.checkpoint),
      idempotencyKey: command.idempotencyKey,
      state,
      durable: Boolean(ledgerRecord) || entry.source === 'recovery',
      restartSafe: ['completed', 'suppressed', 'scheduled', 'waiting-ack'].includes(state)
        || (state === 'dispatchable' && persistedState.commandLedger.restartSafe),
      dispatchable: state === 'dispatchable',
      replayStatus: completed ? 'skip-completed' : state === 'blocked' ? 'blocked' : 'replay-required',
      routeIntent: asString(command.routeIntent, `${DEFAULT_SYNC_CHANNEL}#${sync.checkpoint}#${asString(command.type, 'unknown-command')}`),
      processIds: normalizeStringList(command.processIds, []),
      ackState: entry.source === 'provider' ? providerDelivery.acknowledgement.state : null,
      completedAt: ledgerRecord?.completedAt || null,
      attempts: ledgerRecord?.attempts || 0,
      blockedReasons
    };
  });
  const dispatchableRecords = records.filter((record) => record.dispatchable);
  const blockedRecords = records.filter((record) => record.state === 'blocked');
  const scheduledRecords = records.filter((record) => record.state === 'scheduled');
  const waitingAckRecords = records.filter((record) => record.state === 'waiting-ack');
  const completedRecords = records.filter((record) => record.state === 'completed' || record.state === 'suppressed');
  const journalState = blockedRecords.length > 0
    ? 'blocked'
    : dispatchableRecords.length > 0 ? 'dispatchable'
      : waitingAckRecords.length > 0 ? 'waiting-ack'
        : scheduledRecords.length > 0 ? 'scheduled'
          : completedRecords.length > 0 ? 'restored' : 'idle';

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now,
    checkpoint: sync.checkpoint,
    cursor: `${persistedState.commandLedger.cursor}:restart-journal:${records.length}`,
    state: journalState,
    restartSafe: blockedRecords.length === 0 && records.every((record) => record.restartSafe),
    idempotencyKey: `${persistedState.idempotencyKey}#restart-command-journal`,
    records,
    counts: {
      total: records.length,
      dispatchable: dispatchableRecords.length,
      blocked: blockedRecords.length,
      scheduled: scheduledRecords.length,
      waitingAck: waitingAckRecords.length,
      completedOrSuppressed: completedRecords.length
    },
    dispatchableCommandIds: dispatchableRecords.map((record) => record.id),
    blockedCommandIds: blockedRecords.map((record) => record.id),
    suppressedCommandIds: records.filter((record) => record.state === 'suppressed').map((record) => record.id),
    nextAction: blockedRecords.length > 0
      ? 'reconcile-command-journal'
      : dispatchableRecords.length > 0 ? 'dispatch-restart-safe-commands'
        : waitingAckRecords.length > 0 ? 'await-provider-ack'
          : scheduledRecords.length > 0 ? 'preserve-scheduled-commands' : 'monitor-command-ledger',
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        'restart-command-journal',
        sync.checkpoint,
        persistedState.commandLedger.proof.digest,
        records.map((record) => `${record.sequence}:${record.id}:${record.state}:${record.idempotencyKey}`).join('|') || 'no-restart-commands'
      ].join('#'),
      sourceDigest: persistedState.proof.digest
    }
  };
}

function buildExternalHandoff(input, providerContract, providerSync, sync, processTable, accessBoundary, lifecycleSettings = null) {
  const handoff = asObject(input.handoff);
  const requested = handoff.enabled !== false && input.includeExternalHandoff !== false;
  const readyProcesses = processTable.filter((process) => process.handoffEligible);
  const blockedReasons = [];
  const hasHandoffPermission = accessBoundary.permissions.includes('snapshot:external-handoff')
    || accessBoundary.permissions.includes('kernel:handoff');
  const requestedTarget = asString(handoff.target, 'external-orchestrator');
  const target = providerContract.serviceContract.handoffTargets.includes(requestedTarget)
    ? requestedTarget
    : providerContract.serviceContract.handoffTargets[0] || requestedTarget;
  const targetSupported = providerContract.serviceContract.handoffTargets.includes(target);

  if (!requested) blockedReasons.push('external-handoff-disabled');
  if (!providerContract.accepted) blockedReasons.push('provider-capability-mismatch');
  if (!providerSync.compatible) blockedReasons.push(...providerSync.blockedReasons);
  if (lifecycleSettings && !lifecycleSettings.valid) {
    blockedReasons.push(...lifecycleSettings.errors.map((error) => `lifecycle-settings:${error}`));
  }
  if (!targetSupported) blockedReasons.push(`unsupported-handoff-target:${requestedTarget}`);
  if (!hasHandoffPermission) blockedReasons.push('missing-permission:snapshot:external-handoff');
  if (processTable.length > 0 && readyProcesses.length === 0) blockedReasons.push('no-resumable-processes');
  const handoffBlockedReasons = normalizeStringList(blockedReasons);

  return {
    state: processTable.length === 0
      ? 'idle'
      : requested && providerContract.accepted && providerSync.compatible && targetSupported && hasHandoffPermission && readyProcesses.length > 0 ? 'ready' : 'blocked',
    target,
    requestedTarget,
    syncCheckpoint: sync.checkpoint,
    transferableProcessIds: providerSync.batch.processRecords.map((process) => process.pid),
    blockedReasons: handoffBlockedReasons,
    lease: {
      state: handoffBlockedReasons.length === 0 ? 'grantable' : 'withheld',
      ttlMs: providerContract.serviceContract.leaseTtlMs,
      ackDeadlineMs: providerContract.serviceContract.ackDeadlineMs,
      token: handoffBlockedReasons.length === 0
        ? [providerContract.providerId, target, sync.checkpoint].join(':')
        : null
    },
    providerSyncDigest: providerSync.proof.digest,
    access: {
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      visibleProcessIds: accessBoundary.visibleProcessIds,
      withheldProcessIds: accessBoundary.withheldProcessIds,
      permissionChecked: 'snapshot:external-handoff',
      scopedGrantIds: accessBoundary.scopedPermissions.applied
        .flatMap((usage) => usage.grantIds)
        .filter((grantId, index, grantIds) => grantIds.indexOf(grantId) === index),
      allowed: hasHandoffPermission
    },
    proof: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      providerId: providerContract.providerId,
      protocolVersion: providerContract.serviceContract.protocolVersion,
      processCount: processTable.length,
      resumableCount: providerSync.batch.transferableCount,
      accessDigest: accessBoundary.proof.digest,
      syncDigest: providerSync.proof.digest,
      digest: [sync.proofDigest, providerSync.proof.digest, target].join('#')
    }
  };
}

function buildWorkflowHandoff(clientRuntime, sync, handoff, acceptance, processTable) {
  const accepted = new Set(acceptance.processIds);
  const transferable = new Set(handoff.transferableProcessIds);
  const focusProcess = processTable.find((process) => process.pid === clientRuntime.focusProcessId) || null;
  const preferences = clientRuntime.workflowPreferences || {};
  const selectedRecords = processTable
    .filter((process) => accepted.has(process.pid) || (!acceptance.accepted && transferable.has(process.pid)))
    .map((process) => ({
      pid: process.pid,
      service: process.service,
      route: process.route,
      status: process.status,
      checkpointToken: process.checkpointToken,
      selected: accepted.has(process.pid)
    }));
  const firstTransferableRecord = selectedRecords.find((process) => transferable.has(process.pid)) || null;
  const resumeProcess = preferences.resumeStrategy === 'focus-process'
    ? focusProcess || firstTransferableRecord
    : preferences.resumeStrategy === 'first-transferable' ? firstTransferableRecord : null;
  const routeBase = asString(preferences.returnRoute, clientRuntime.route);
  const resumeRoute = resumeProcess
    ? `${routeBase}/process/${resumeProcess.pid}`
    : routeBase;
  const targetMismatch = preferences.preferredHandoffTarget && preferences.preferredHandoffTarget !== handoff.target;
  const clientBlockedReasons = normalizeStringList([
    ...(preferences.mode === 'local-preview-only' ? ['client-requested-local-preview-only'] : []),
    ...(targetMismatch ? [`client-preferred-target-unavailable:${preferences.preferredHandoffTarget}`] : []),
    ...normalizeStringList(preferences.warnings, [])
  ]);
  const action = acceptance.accepted
    ? 'commit-external-handoff'
    : preferences.mode === 'local-preview-only' ? 'keep-local-preview'
      : handoff.state === 'ready' ? 'present-acceptance-review' : 'keep-local-preview';
  const clientState = acceptance.accepted
    ? clientBlockedReasons.length === 0 ? 'committable' : 'local-only'
    : preferences.mode === 'local-preview-only' ? 'local-only'
      : handoff.state === 'ready' && clientBlockedReasons.length === 0 ? 'awaiting-operator' : 'local-only';
  const canReview = handoff.state === 'ready'
    && preferences.mode !== 'local-preview-only'
    && clientBlockedReasons.length === 0;
  const canCommit = acceptance.accepted && clientBlockedReasons.length === 0;
  const reviewPayload = {
    requestId: clientRuntime.requestId,
    checkpoint: sync.checkpoint,
    target: handoff.target,
    processIds: selectedRecords.map((process) => process.pid),
    preferenceKey: preferences.preferenceKey || null
  };

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    requestId: clientRuntime.requestId,
    kernelSessionId: clientRuntime.kernelSessionId,
    clientSurface: clientRuntime.surface,
    clientRoute: clientRuntime.route,
    action,
    state: clientState,
    clientWorkflowMode: preferences.mode || 'review-first',
    resumeStrategy: preferences.resumeStrategy || 'first-transferable',
    syncCheckpoint: sync.checkpoint,
    resumeAnchor: clientRuntime.resumeAnchor,
    clientResume: {
      route: resumeRoute,
      processId: resumeProcess?.pid || clientRuntime.resumeAnchor.processId,
      checkpointToken: resumeProcess?.checkpointToken || clientRuntime.resumeAnchor.checkpointToken,
      preserveSelection: preferences.preserveSelectionOnReturn !== false,
      selectedProcessIds: preferences.preserveSelectionOnReturn === false
        ? []
        : selectedRecords.map((process) => process.pid),
      notificationTopic: preferences.notifyOnProviderAck
        ? [DEFAULT_SYNC_CHANNEL, clientRuntime.requestId, 'provider-ack'].join('/')
        : null
    },
    clientControls: {
      review: {
        enabled: canReview,
        method: 'GET',
        route: `${routeBase}/review`,
        payload: reviewPayload,
        disabledReasons: canReview ? [] : clientBlockedReasons
      },
      accept: {
        enabled: canReview && !acceptance.accepted,
        method: 'POST',
        route: `${routeBase}/accept-preview`,
        payload: {
          ...reviewPayload,
          state: 'accepted'
        },
        disabledReasons: canReview && !acceptance.accepted ? [] : [
          ...clientBlockedReasons,
          ...(acceptance.accepted ? ['acceptance-already-committed'] : [])
        ]
      },
      commit: {
        enabled: canCommit,
        method: 'POST',
        route: `${routeBase}/commit-external-handoff`,
        payload: {
          requestId: clientRuntime.requestId,
          checkpoint: sync.checkpoint,
          commitToken: acceptance.commitToken,
          processIds: acceptance.processIds
        },
        disabledReasons: canCommit ? [] : [
          ...clientBlockedReasons,
          ...(acceptance.accepted ? [] : ['acceptance-not-committable'])
        ]
      },
      resumeClient: {
        enabled: true,
        method: 'GET',
        route: resumeRoute,
        payload: {
          requestId: clientRuntime.requestId,
          checkpoint: sync.checkpoint,
          processId: resumeProcess?.pid || null
        }
      }
    },
    clientBlockedReasons,
    focus: focusProcess ? {
      pid: focusProcess.pid,
      service: focusProcess.service,
      status: focusProcess.status,
      route: focusProcess.route,
      checkpointToken: focusProcess.checkpointToken
    } : null,
    selectedProcessRecords: selectedRecords,
    userVisibleMessage: acceptance.accepted
      ? `External handoff is ready to commit for ${acceptance.processIds.length} process records.`
      : preferences.mode === 'local-preview-only'
        ? 'Snapshot preview is pinned to this client and external handoff controls are disabled.'
      : handoff.state === 'ready'
        ? `Review ${handoff.transferableProcessIds.length} transferable process records before handoff.`
        : 'Snapshot remains local until handoff blockers are resolved.',
    proof: {
      digest: [
        clientRuntime.requestId,
        clientRuntime.stateVersion,
        sync.proofDigest,
        action,
        preferences.preferenceKey || 'no-client-preferences',
        resumeRoute,
        clientBlockedReasons.join('|') || 'client-workflow-ready'
      ].join('#'),
      sourceDigest: sync.proofDigest,
      stateVersion: clientRuntime.stateVersion
    }
  };
}

function normalizeAcceptance(input, handoff, processTable) {
  const acceptance = asObject(input.acceptance);
  const requestedState = asString(acceptance.state, 'pending');
  const state = ACCEPTANCE_STATES.has(requestedState) ? requestedState : 'pending';
  const selectedProcessIds = Array.isArray(acceptance.processIds)
    ? acceptance.processIds.filter((pid) => typeof pid === 'string' && pid.trim()).map((pid) => pid.trim())
    : handoff.transferableProcessIds;
  const knownProcessIds = new Set(processTable.map((process) => process.pid));
  const acceptedProcessIds = selectedProcessIds.filter((pid) => knownProcessIds.has(pid));
  const unknownProcessIds = selectedProcessIds.filter((pid) => !knownProcessIds.has(pid));
  const canCommit = state === 'accepted' && handoff.state === 'ready' && acceptedProcessIds.length > 0;

  return {
    state,
    accepted: canCommit,
    mode: asString(acceptance.mode, 'operator-preview'),
    acceptedBy: asString(acceptance.acceptedBy, null),
    acceptedAt: state === 'accepted' ? asString(acceptance.acceptedAt, input.now || null) : null,
    processIds: acceptedProcessIds,
    rejectedProcessIds: state === 'rejected' ? handoff.transferableProcessIds : [],
    invalidProcessIds: unknownProcessIds,
    commitToken: canCommit
      ? [handoff.syncCheckpoint, acceptedProcessIds.join(','), acceptance.nonce || 'accept'].join(':')
      : null
  };
}

function normalizeProviderDeliveryContract(input, providerContract, providerSync, handoff, acceptance, lifecycleSettings, sync, clientRuntime, processTable, now) {
  const provider = asObject(input.provider);
  const delivery = asObject(input.providerDelivery || provider.deliveryContract || provider.delivery || provider.serviceContract?.delivery);
  const ackInput = asObject(delivery.ack || delivery.acknowledgement || input.providerAck || input.handoffAck);
  const requestedGuarantee = asString(delivery.guarantee || delivery.deliveryGuarantee, 'at-least-once');
  const deliveryGuarantee = PROVIDER_DELIVERY_GUARANTEES.has(requestedGuarantee) ? requestedGuarantee : 'at-least-once';
  const requestedAckState = asString(ackInput.state || ackInput.status, acceptance.accepted ? 'pending' : 'pending');
  const ackState = PROVIDER_ACK_STATES.has(requestedAckState) ? requestedAckState : 'pending';
  const expectedAckDigest = [
    providerSync.proof.digest,
    handoff.lease.token || 'no-lease',
    acceptance.commitToken || 'no-commit',
    lifecycleSettings.proof.digest
  ].join('#');
  const receivedAckDigest = asString(ackInput.digest || ackInput.receiptDigest, null);
  const acceptedSet = new Set(acceptance.processIds);
  const transferableSet = new Set(handoff.transferableProcessIds);
  const deliveryRecords = processTable
    .filter((process) => transferableSet.has(process.pid))
    .map((process) => ({
      pid: process.pid,
      status: process.status,
      route: process.route,
      checkpointToken: process.checkpointToken,
      acceptedForCommit: acceptedSet.has(process.pid),
      providerRecordId: [providerContract.providerId, sync.checkpoint, process.pid].join(':')
    }));
  const ackDigestMatches = ackState !== 'acknowledged'
    || !receivedAckDigest
    || receivedAckDigest === expectedAckDigest;
  const commitRequested = acceptance.accepted && handoff.state === 'ready';
  const errors = normalizeStringList([
    ...(providerContract.accepted ? [] : ['provider-contract-not-accepted']),
    ...(providerSync.compatible ? [] : ['provider-sync-not-compatible']),
    ...(handoff.state === 'blocked' ? handoff.blockedReasons.map((reason) => `handoff-blocked:${reason}`) : []),
    ...(commitRequested && deliveryRecords.filter((record) => record.acceptedForCommit).length === 0 ? ['accepted-handoff-has-no-delivery-records'] : []),
    ...(ackState === 'acknowledged' && !ackDigestMatches ? ['ack-digest-mismatch'] : []),
    ...(ackState === 'rejected' ? [`provider-ack-rejected:${asString(ackInput.reason, 'unspecified')}`] : []),
    ...(ackState === 'timed-out' ? ['provider-ack-timed-out'] : [])
  ]);
  const warnings = normalizeStringList([
    ...(PROVIDER_DELIVERY_GUARANTEES.has(requestedGuarantee) ? [] : [`unsupported-delivery-guarantee:${requestedGuarantee}`]),
    ...(commitRequested && ackState === 'pending' ? ['provider-ack-pending'] : []),
    ...(deliveryRecords.length < handoff.transferableProcessIds.length ? ['delivery-records-truncated-by-access-boundary'] : [])
  ]);
  const externalState = !clientRuntime.includeExternalHandoff || handoff.state === 'idle'
    ? 'local-only'
    : errors.length > 0 ? 'blocked'
      : commitRequested && ackState === 'acknowledged' ? 'committed'
        : commitRequested ? 'awaiting-provider-ack' : 'prepared';

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    providerId: providerContract.providerId,
    service: providerContract.service,
    protocolVersion: providerContract.serviceContract.protocolVersion,
    deliveryGuarantee,
    externalState,
    outbound: {
      channel: asString(delivery.outboundChannel, `${DEFAULT_SYNC_CHANNEL}/outbound`),
      checkpoint: sync.checkpoint,
      cursor: asString(delivery.cursor || delivery.syncCursor, `${sync.checkpoint}:0`),
      sequence: normalizePositiveInteger(delivery.sequence, 1, 1),
      idempotencyKey: [clientRuntime.kernelSessionId, clientRuntime.requestId, sync.checkpoint, providerContract.providerId].join('#')
    },
    acknowledgement: {
      channel: asString(delivery.ackChannel || delivery.inboundAckChannel, `${DEFAULT_SYNC_CHANNEL}/acks`),
      state: ackState,
      expectedDigest: expectedAckDigest,
      receivedDigest: receivedAckDigest,
      digestMatches: ackDigestMatches,
      acknowledgedBy: asString(ackInput.acknowledgedBy || ackInput.actor, null),
      acknowledgedAt: ackState === 'acknowledged' ? asString(ackInput.acknowledgedAt || ackInput.at, now) : null,
      deadlineAt: asString(ackInput.deadlineAt || delivery.ackDeadlineAt, null),
      deadlineMs: providerContract.serviceContract.ackDeadlineMs,
      reason: asString(ackInput.reason, null)
    },
    records: deliveryRecords,
    recordCount: deliveryRecords.length,
    commitRequested,
    commitToken: acceptance.commitToken,
    errors,
    warnings,
    valid: errors.length === 0,
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        providerContract.providerId,
        sync.checkpoint,
        deliveryGuarantee,
        externalState,
        expectedAckDigest,
        deliveryRecords.map((record) => `${record.pid}:${record.acceptedForCommit ? 'commit' : 'preview'}`).join('|') || 'no-delivery-records'
      ].join('#'),
      sourceDigest: providerSync.proof.digest
    }
  };
}

function normalizeProviderCommandHandoff(input, providerContract, providerDelivery, lifecycleSettings, handoff, acceptance, sync, clientRuntime, processTable, now) {
  const provider = asObject(input.provider);
  const commandHandoff = asObject(input.providerCommandHandoff || provider.commandHandoff || provider.serviceContract?.commandHandoff);
  const routePrefix = asString(commandHandoff.routePrefix, `${providerContract.endpoint}/commands`);
  const requestedMode = asString(commandHandoff.dispatchMode || commandHandoff.mode, lifecycleSettings.dispatch.state === 'scheduled' ? 'scheduled' : 'transactional');
  const dispatchMode = ['transactional', 'streaming', 'scheduled'].includes(requestedMode) ? requestedMode : 'transactional';
  const acceptedProcessSet = new Set(acceptance.processIds);
  const processRouteIndex = processTable.reduce((index, process) => ({
    ...index,
    [process.pid]: {
      service: process.service,
      route: process.route,
      checkpointToken: process.checkpointToken,
      status: process.status
    }
  }), {});
  const lifecycleCommandRecords = lifecycleSettings.commands
    .filter((command) => command.executableNow || command.schedulable)
    .map((command) => ({
      id: [providerContract.providerId, command.id].join(':'),
      sourceCommandId: command.id,
      type: command.type,
      phase: command.executableNow ? 'pre-handoff' : 'scheduled-lifecycle',
      route: `${routePrefix}/${command.control}`,
      routeIntent: command.routeIntent,
      dispatchState: command.dispatchState,
      scheduleMode: command.scheduleMode,
      dueAt: command.dueAt,
      nextRunAt: command.nextRunAt,
      processIds: command.processIds,
      idempotencyKey: [command.idempotencyKey, providerContract.providerId, dispatchMode].join('#'),
      requiredAckState: command.executableNow ? 'acknowledged' : 'pending'
    }));
  const commitCommand = acceptance.accepted
    ? [{
      id: [providerContract.providerId, sync.checkpoint, 'commit-external-handoff'].join(':'),
      sourceCommandId: acceptance.commitToken,
      type: 'commit-external-handoff',
      phase: 'handoff-commit',
      route: `${routePrefix}/commit-external-handoff`,
      routeIntent: [DEFAULT_SYNC_CHANNEL, sync.checkpoint, 'commit-external-handoff', handoff.target].join('#'),
      dispatchState: providerDelivery.acknowledgement.state === 'acknowledged' ? 'completed' : 'pending',
      scheduleMode: 'immediate',
      dueAt: now,
      nextRunAt: null,
      processIds: acceptance.processIds,
      idempotencyKey: [clientRuntime.kernelSessionId, clientRuntime.requestId, acceptance.commitToken, providerContract.providerId].join('#'),
      requiredAckState: 'acknowledged'
    }]
    : [];
  const commands = [...lifecycleCommandRecords, ...commitCommand].map((command, index) => ({
    ...command,
    sequence: normalizePositiveInteger(commandHandoff.startSequence, 1, 1) + index,
    processRecords: command.processIds.map((pid) => ({
      pid,
      acceptedForCommit: acceptedProcessSet.has(pid),
      service: processRouteIndex[pid]?.service || 'unknown-service',
      route: processRouteIndex[pid]?.route || `${surfaceGroup}/${surfaceName}`,
      checkpointToken: processRouteIndex[pid]?.checkpointToken || null,
      status: processRouteIndex[pid]?.status || 'unknown'
    }))
  }));
  const blockedReasons = normalizeStringList([
    ...(providerDelivery.valid ? [] : providerDelivery.errors.map((error) => `provider-delivery:${error}`)),
    ...(lifecycleSettings.valid ? [] : lifecycleSettings.errors.map((error) => `lifecycle-settings:${error}`)),
    ...(handoff.state === 'blocked' ? handoff.blockedReasons.map((reason) => `handoff:${reason}`) : []),
    ...(acceptance.accepted && providerDelivery.recordCount === 0 ? ['accepted-handoff-missing-provider-records'] : []),
    ...(acceptance.accepted && providerDelivery.acknowledgement.state === 'rejected' ? ['provider-rejected-command-handoff'] : []),
    ...(acceptance.accepted && providerDelivery.acknowledgement.state === 'timed-out' ? ['provider-command-ack-timeout'] : []),
    ...(['transactional', 'streaming', 'scheduled'].includes(requestedMode) ? [] : [`unsupported-command-dispatch-mode:${requestedMode}`])
  ]);
  const dispatchable = blockedReasons.length === 0
    && commands.length > 0
    && (providerDelivery.externalState === 'prepared' || providerDelivery.externalState === 'awaiting-provider-ack');
  const state = commands.length === 0
    ? 'idle'
    : blockedReasons.length > 0 ? 'blocked'
      : providerDelivery.acknowledgement.state === 'acknowledged' && acceptance.accepted ? 'completed'
        : dispatchable ? 'dispatchable' : 'prepared';

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    contractVersion: PROVIDER_COMMAND_HANDOFF_CONTRACT_VERSION,
    providerId: providerContract.providerId,
    service: providerContract.service,
    dispatchMode,
    state,
    dispatchable,
    routePrefix,
    outboundChannel: providerDelivery.outbound.channel,
    acknowledgementChannel: providerDelivery.acknowledgement.channel,
    ackState: providerDelivery.acknowledgement.state,
    ackDigest: providerDelivery.acknowledgement.expectedDigest,
    checkpoint: sync.checkpoint,
    cursor: asString(commandHandoff.cursor || commandHandoff.dispatchCursor, `${sync.checkpoint}:commands:0`),
    commandCount: commands.length,
    lifecycleCommandCount: lifecycleCommandRecords.length,
    commitCommandCount: commitCommand.length,
    commands,
    blockedReasons,
    warnings: normalizeStringList([
      ...(commands.length === 0 ? ['no-provider-command-handoff-required'] : []),
      ...(dispatchMode !== requestedMode ? [`normalized-command-dispatch-mode:${requestedMode}`] : []),
      ...(providerDelivery.acknowledgement.state === 'pending' && acceptance.accepted ? ['provider-command-handoff-awaiting-ack'] : [])
    ]),
    valid: blockedReasons.length === 0,
    proof: {
      digest: [
        PROVIDER_COMMAND_HANDOFF_CONTRACT_VERSION,
        providerContract.providerId,
        sync.checkpoint,
        dispatchMode,
        state,
        providerDelivery.proof.digest,
        lifecycleSettings.proof.digest,
        commands.map((command) => `${command.sequence}:${command.type}:${command.idempotencyKey}`).join('|') || 'no-provider-commands'
      ].join('#'),
      sourceDigest: providerDelivery.proof.digest
    }
  };
}

function buildPreviewRows(processTable, handoff, acceptance) {
  const transferable = new Set(handoff.transferableProcessIds);
  const accepted = new Set(acceptance.processIds);
  const childIndex = processTable.reduce((index, process) => {
    if (!process.parentPid) return index;
    return {
      ...index,
      [process.parentPid]: [...(index[process.parentPid] || []), process.pid]
    };
  }, {});

  return processTable.map((process) => ({
    id: process.pid,
    label: `${process.service} (${process.status})`,
    parentPid: process.parentPid,
    childProcessIds: childIndex[process.pid] || [],
    route: process.route,
    status: process.status,
    checkpointToken: process.checkpointToken,
    previewState: transferable.has(process.pid) ? 'transferable' : 'local-only',
    selectedForHandoff: accepted.has(process.pid),
    blockingReason: transferable.has(process.pid) ? null : `process-${process.status}-not-transferable`
  }));
}

function buildProcessTopology(processTable, accessBoundary, now) {
  const processIds = new Set(processTable.map((process) => process.pid));
  const withheldProcessIds = new Set(accessBoundary.withheldProcessIds);
  const childIndex = processTable.reduce((index, process) => {
    if (!process.parentPid) return index;
    return {
      ...index,
      [process.parentPid]: [...(index[process.parentPid] || []), process.pid]
    };
  }, {});
  const parentEdges = processTable
    .filter((process) => process.parentPid)
    .map((process) => ({
      parentPid: process.parentPid,
      childPid: process.pid,
      parentVisible: processIds.has(process.parentPid),
      parentWithheld: withheldProcessIds.has(process.parentPid)
    }));
  const orphanParentRefs = parentEdges
    .filter((edge) => !edge.parentVisible && !edge.parentWithheld)
    .map((edge) => ({ pid: edge.childPid, missingParentPid: edge.parentPid }));
  const withheldParentRefs = parentEdges
    .filter((edge) => edge.parentWithheld)
    .map((edge) => ({ pid: edge.childPid, withheldParentPid: edge.parentPid }));

  const lineageFor = (process) => {
    const visited = new Set([process.pid]);
    const lineage = [];
    let parentPid = process.parentPid;

    while (parentPid) {
      if (visited.has(parentPid)) {
        return { lineage, cycleAt: parentPid };
      }
      visited.add(parentPid);
      lineage.push(parentPid);
      const parent = processTable.find((candidate) => candidate.pid === parentPid);
      parentPid = parent?.parentPid || null;
    }

    return { lineage, cycleAt: null };
  };
  const records = processTable.map((process) => {
    const lineage = lineageFor(process);
    return {
      pid: process.pid,
      parentPid: process.parentPid,
      childProcessIds: childIndex[process.pid] || [],
      lineageProcessIds: lineage.lineage,
      root: !process.parentPid || !processIds.has(process.parentPid),
      depth: lineage.lineage.length,
      cycleDetected: Boolean(lineage.cycleAt),
      cycleAt: lineage.cycleAt,
      parentWithheld: process.parentPid ? withheldProcessIds.has(process.parentPid) : false
    };
  });
  const cycleProcessIds = records.filter((record) => record.cycleDetected).map((record) => record.pid);
  const rootProcessIds = records.filter((record) => record.root).map((record) => record.pid);
  const topologyErrors = normalizeStringList([
    ...cycleProcessIds.map((pid) => `process-parent-cycle:${pid}`)
  ]);
  const topologyWarnings = normalizeStringList([
    ...orphanParentRefs.map((ref) => `orphan-parent:${ref.pid}->${ref.missingParentPid}`),
    ...withheldParentRefs.map((ref) => `parent-withheld-by-access-boundary:${ref.pid}->${ref.withheldParentPid}`)
  ]);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now,
    processCount: processTable.length,
    rootProcessIds,
    duplicateProcessIds: [],
    orphanParentRefs,
    withheldParentRefs,
    cycleProcessIds,
    records,
    valid: topologyErrors.length === 0,
    warnings: topologyWarnings,
    errors: topologyErrors,
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        'process-topology',
        processTable.map((process) => `${process.pid}<-${process.parentPid || 'root'}`).join('|') || 'no-processes',
        'duplicates-reconciled-before-topology',
        cycleProcessIds.join(',') || 'no-cycles'
      ].join('#')
    }
  };
}

function buildReadiness(sync, providerSync, handoff, acceptance, validation, accessBoundary, providerContract, lifecycleSettings, providerDelivery, providerCommandHandoff, processTopology) {
  const gates = [
    {
      id: 'tenant-workspace-boundary',
      label: 'Tenant boundary',
      ready: accessBoundary.withheldCount === 0 || accessBoundary.enforced,
      detail: accessBoundary.withheldCount > 0
        ? `${accessBoundary.withheldCount} process records withheld outside ${accessBoundary.tenantId}/${accessBoundary.workspaceId}.`
        : `Scoped to ${accessBoundary.tenantId}/${accessBoundary.workspaceId}.`
    },
    {
      id: 'provider-contract',
      label: 'Provider contract',
      ready: providerContract.accepted,
      detail: providerContract.accepted
        ? `${providerContract.providerId} accepted ${providerContract.serviceContract.protocolVersion} over ${providerContract.serviceContract.syncMode} sync.`
        : [
          ...providerContract.negotiation.missing.map((capability) => `missing ${capability}`),
          ...providerContract.serviceContract.errors
        ].join(', ')
    },
    {
      id: 'provider-sync-envelope',
      label: 'Provider sync',
      ready: providerSync.compatible,
      detail: providerSync.compatible
        ? `Prepared ${providerSync.batch.transferableCount} records for ${providerSync.service}.`
        : providerSync.blockedReasons.join(', ')
    },
    {
      id: 'lifecycle-command-settings',
      label: 'Lifecycle commands',
      ready: lifecycleSettings.valid,
      detail: lifecycleSettings.valid
        ? `${lifecycleSettings.commandCount} lifecycle commands prepared with ${lifecycleSettings.schedule.mode} scheduling.`
        : lifecycleSettings.errors.join(', ')
    },
    {
      id: 'handoff-target',
      label: 'External handoff',
      ready: handoff.state === 'ready',
      detail: handoff.blockedReasons.length ? handoff.blockedReasons.join(', ') : `Ready for ${handoff.target}.`
    },
    {
      id: 'operator-acceptance',
      label: 'Operator acceptance',
      ready: acceptance.accepted,
      detail: acceptance.accepted ? `Accepted ${acceptance.processIds.length} process records.` : `Current state: ${acceptance.state}.`
    },
    {
      id: 'provider-delivery-ack',
      label: 'Provider delivery',
      ready: providerDelivery.valid && (!providerDelivery.commitRequested || providerDelivery.acknowledgement.state === 'acknowledged'),
      detail: providerDelivery.valid
        ? `${providerDelivery.externalState} on ${providerDelivery.outbound.channel} with ${providerDelivery.recordCount} delivery records.`
        : providerDelivery.errors.join(', ')
    },
    {
      id: 'provider-command-handoff',
      label: 'Provider commands',
      ready: providerCommandHandoff.valid && ['idle', 'dispatchable', 'completed'].includes(providerCommandHandoff.state),
      detail: providerCommandHandoff.valid
        ? `${providerCommandHandoff.commandCount} provider commands ${providerCommandHandoff.state} via ${providerCommandHandoff.dispatchMode} dispatch.`
        : providerCommandHandoff.blockedReasons.join(', ')
    },
    {
      id: 'process-topology',
      label: 'Process topology',
      ready: processTopology.valid,
      detail: processTopology.valid
        ? `${processTopology.rootProcessIds.length} roots and ${processTopology.processCount} process records mapped.`
        : processTopology.errors.join(', ')
    },
    {
      id: 'snapshot-proof',
      label: 'Snapshot proof',
      ready: Boolean(sync.proofDigest),
      detail: sync.proofDigest
    }
  ];

  return {
    state: gates.every((gate) => gate.ready) ? 'ready' : gates.some((gate) => gate.ready) ? 'partial' : 'blocked',
    gates,
    readyGateCount: gates.filter((gate) => gate.ready).length,
    totalGateCount: gates.length
  };
}

function buildValidationSummary(validation, handoff, acceptance, processTable) {
  const transferableCount = handoff.transferableProcessIds.length;

  return {
    severity: validation.errors.length > 0 ? 'error' : validation.warnings.length > 0 ? 'warning' : 'ok',
    title: validation.errors.length > 0
      ? 'Snapshot is not ready for external handoff'
      : transferableCount > 0 ? 'Snapshot can be reviewed for handoff' : 'Snapshot has no transferable processes',
    counts: {
      processes: processTable.length,
      transferable: transferableCount,
      accepted: acceptance.processIds.length,
      errors: validation.errors.length,
      warnings: validation.warnings.length
    },
    errors: validation.errors,
    warnings: [
      ...validation.warnings,
      ...acceptance.invalidProcessIds.map((pid) => `acceptance ignored unknown process:${pid}`)
    ]
  };
}

function normalizeOperationalHealthSignals(input, now, processTable, providerContract) {
  const health = asObject(input.operationalHealth || input.health || asObject(input.provider).health);
  const rawSignals = [
    ...(Array.isArray(health.signals) ? health.signals : []),
    ...(Array.isArray(health.failures) ? health.failures : []),
    ...(Array.isArray(health.errors) ? health.errors : []),
    ...(Array.isArray(asObject(input.provider).healthSignals) ? asObject(input.provider).healthSignals : [])
  ];
  const processIds = new Set(processTable.map((process) => process.pid));
  const defaultComponent = HEALTH_COMPONENTS.has(health.component) ? health.component : 'provider';
  const defaultSource = asString(health.source || health.probeId, providerContract.providerId);
  const records = rawSignals.map((signal, index) => {
    const record = asObject(signal);
    const requestedSeverity = asString(record.severity, null);
    const severity = HEALTH_SIGNAL_SEVERITIES.has(requestedSeverity)
      ? requestedSeverity
      : record.fatal === true ? 'fatal' : record.blocking === true ? 'error' : 'warning';
    const requestedState = asString(record.state || record.status, 'open');
    const state = HEALTH_FAILURE_STATES.has(requestedState) ? requestedState : 'open';
    const requestedComponent = asString(record.component || record.area, defaultComponent);
    const component = HEALTH_COMPONENTS.has(requestedComponent) ? requestedComponent : 'provider';
    const affectedProcessIds = normalizeStringList(record.processIds || record.pids || record.affectedProcessIds, [])
      .filter((pid) => processIds.has(pid));
    const unknownProcessIds = normalizeStringList(record.processIds || record.pids || record.affectedProcessIds, [])
      .filter((pid) => !processIds.has(pid));
    const code = asString(record.code || record.reason, `${component}-health-signal-${index + 1}`);
    const retryable = record.retryable === true || ['provider', 'handoff-channel', 'command-dispatch'].includes(component);
    const invalidReasons = normalizeStringList([
      ...(HEALTH_SIGNAL_SEVERITIES.has(requestedSeverity) || requestedSeverity === null ? [] : [`unsupported-severity:${requestedSeverity}`]),
      ...(HEALTH_FAILURE_STATES.has(requestedState) ? [] : [`unsupported-failure-state:${requestedState}`]),
      ...(HEALTH_COMPONENTS.has(requestedComponent) ? [] : [`unsupported-component:${requestedComponent}`]),
      ...unknownProcessIds.map((pid) => `unknown-process:${pid}`)
    ]);

    return {
      id: asString(record.id || record.signalId, `health-signal-${index + 1}`),
      source: asString(record.source || record.probeId, defaultSource),
      component,
      code,
      state,
      severity,
      message: asString(record.message || record.detail, `${component} reported ${code}.`),
      action: asString(record.action || record.remediation, retryable ? 'retry-after-backoff' : 'operator-remediation-required'),
      retryable,
      observedAt: asString(record.observedAt || record.createdAt || health.observedAt, now),
      deadlineAt: asString(record.deadlineAt || record.sloDeadlineAt, null),
      affectedProcessIds,
      invalidReasons,
      valid: invalidReasons.length === 0,
      open: state !== 'resolved' && state !== 'suppressed'
    };
  });
  const activeRecords = records.filter((record) => record.valid && record.open);
  const blockingRecords = activeRecords.filter((record) => record.severity === 'error' || record.severity === 'fatal');
  const warningRecords = activeRecords.filter((record) => record.severity === 'warning');
  const invalidRecords = records.filter((record) => !record.valid);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    observedAt: asString(health.observedAt, now),
    source: defaultSource,
    recordCount: records.length,
    activeCount: activeRecords.length,
    blockingCount: blockingRecords.length,
    warningCount: warningRecords.length,
    invalidCount: invalidRecords.length,
    records,
    blockingRecords,
    warningRecords,
    invalidRecords,
    retryableReasons: activeRecords
      .filter((record) => record.retryable)
      .map((record) => `health-signal:${record.component}:${record.code}`),
    degradedReasons: [
      ...warningRecords.map((record) => `health-warning:${record.component}:${record.code}`),
      ...invalidRecords.map((record) => `invalid-health-signal:${record.id}`)
    ],
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        'operational-health-signals',
        defaultSource,
        records.map((record) => `${record.id}:${record.component}:${record.state}:${record.severity}`).join('|') || 'no-health-signals'
      ].join('#')
    }
  };
}

function normalizeRetryPolicy(input, validation, handoff, persistedState, processTable, healthSignals) {
  const retry = asObject(input.retryPolicy || input.retry || input.backoff);
  const failedProcessCount = processTable.filter((process) => process.status === 'failed').length;
  const baseDelayMs = Math.max(250, Number.isFinite(retry.baseDelayMs) ? retry.baseDelayMs : 1000);
  const maxDelayMs = Math.max(baseDelayMs, Number.isFinite(retry.maxDelayMs) ? retry.maxDelayMs : 30000);
  const maxAttempts = Math.max(1, Number.isFinite(retry.maxAttempts) ? retry.maxAttempts : 4);
  const attempt = Math.max(0, Number.isFinite(retry.attempt) ? retry.attempt : 0);
  const retryableReasons = [
    ...validation.errors.filter((error) => error.includes('provider') || error.includes('handoff')),
    ...(persistedState.status === 'stale' ? ['persisted-state-stale'] : []),
    ...(persistedState.status === 'conflict' ? ['persisted-state-conflict'] : []),
    ...(failedProcessCount > 0 ? ['process-failure-present'] : []),
    ...healthSignals.retryableReasons
  ];
  const retryable = retry.enabled !== false
    && retryableReasons.length > 0
    && attempt < maxAttempts
    && handoff.state !== 'idle';
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));

  return {
    enabled: retry.enabled !== false,
    retryable,
    attempt,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    nextDelayMs: retryable ? exponentialDelay : null,
    nextRetryAt: retryable && retry.nextRetryAt ? asString(retry.nextRetryAt, null) : null,
    exhausted: retryableReasons.length > 0 && attempt >= maxAttempts,
    reasons: retryableReasons
  };
}

function buildOperationalHealth(input, validation, handoff, acceptance, persistedState, recovery, processTable, accessBoundary, providerContract, providerDelivery, providerCommandHandoff) {
  const failedProcesses = processTable.filter((process) => process.status === 'failed');
  const pausedProcesses = processTable.filter((process) => process.status === 'paused');
  const waitingProcesses = processTable.filter((process) => process.status === 'waiting');
  const now = asString(input.now, new Date().toISOString());
  const healthSignals = normalizeOperationalHealthSignals(input, now, processTable, providerContract);
  const blockingFailures = [
    ...validation.errors.map((error) => ({
      code: error,
      severity: error.startsWith('missing-capability:') ? 'fatal' : 'error',
      message: error.startsWith('missing-capability:')
        ? `Provider ${providerContract.providerId} is missing ${error.replace('missing-capability:', '')}.`
        : `Snapshot handoff is blocked by ${error.replace('handoff:', '')}.`,
      action: error.startsWith('missing-capability:')
        ? 'upgrade-provider-capabilities'
        : 'resolve-handoff-blocker'
    })),
    ...failedProcesses.map((process) => ({
      code: `process-failed:${process.pid}`,
      severity: 'error',
      message: `${process.service} failed before snapshot handoff and cannot be resumed externally.`,
      action: 'restart-or-exclude-process',
      pid: process.pid
    })),
    ...(persistedState.status === 'conflict' ? [{
      code: persistedState.boundaryOwnership.blocked ? 'persisted-state-boundary-mismatch' : 'persisted-state-conflict',
      severity: 'error',
      message: persistedState.boundaryOwnership.blocked
        ? 'Persisted snapshot state belongs outside the active tenant/workspace boundary and was quarantined.'
        : 'Persisted snapshot state does not match the current hosted kernel process table.',
      action: persistedState.boundaryOwnership.blocked ? 'quarantine-persisted-boundary' : 'run-reconcile-process-table',
      commandIds: recovery.commands
        .filter((command) => persistedState.boundaryOwnership.blocked
          ? command.type === 'quarantine-persisted-boundary'
          : command.type === 'reconcile-process-table')
        .map((command) => command.id),
      boundaryBlockedReasons: persistedState.boundaryOwnership.blockedReasons
    }] : []),
    ...(persistedState.status === 'stale' ? [{
      code: 'persisted-state-stale',
      severity: 'warning',
      message: 'Persisted snapshot checkpoint is stale for this request.',
      action: 'refresh-snapshot',
      commandIds: recovery.commands.filter((command) => command.type === 'refresh-snapshot').map((command) => command.id)
    }] : []),
    ...providerDelivery.errors.map((error) => ({
      code: `provider-delivery:${error}`,
      severity: error.includes('timed-out') || error.includes('rejected') || error.includes('mismatch') ? 'error' : 'warning',
      message: `Provider delivery contract reported ${error}.`,
      action: 'resolve-provider-delivery'
    })),
    ...providerCommandHandoff.blockedReasons.map((reason) => ({
      code: `provider-command-handoff:${reason}`,
      severity: reason.includes('timeout') || reason.includes('rejected') ? 'error' : 'warning',
      message: `Provider command handoff is blocked by ${reason}.`,
      action: 'resolve-provider-command-handoff'
    })),
    ...healthSignals.blockingRecords.map((record) => ({
      code: `health-signal:${record.component}:${record.code}`,
      severity: record.severity,
      message: record.message,
      action: record.action,
      source: record.source,
      component: record.component,
      failureState: record.state,
      retryable: record.retryable,
      observedAt: record.observedAt,
      deadlineAt: record.deadlineAt,
      signalId: record.id,
      affectedProcessIds: record.affectedProcessIds
    })),
    ...healthSignals.invalidRecords.map((record) => ({
      code: `invalid-health-signal:${record.id}`,
      severity: 'warning',
      message: `Ignored malformed hosted-kernel health signal ${record.id}.`,
      action: 'fix-health-signal-contract',
      source: record.source,
      component: record.component,
      invalidReasons: record.invalidReasons
    }))
  ];
  const retryPolicy = normalizeRetryPolicy(input, validation, handoff, persistedState, processTable, healthSignals);
  const degradedReasons = [
    ...(accessBoundary.withheldCount > 0 ? ['tenant-boundary-withheld-processes'] : []),
    ...(pausedProcesses.length > 0 ? ['paused-processes-present'] : []),
    ...(waitingProcesses.length > 0 ? ['waiting-processes-present'] : []),
    ...(acceptance.invalidProcessIds.length > 0 ? ['operator-selected-unknown-processes'] : []),
    ...(retryPolicy.exhausted ? ['retry-budget-exhausted'] : []),
    ...healthSignals.degradedReasons
  ];
  const state = blockingFailures.some((failure) => failure.severity === 'fatal') || retryPolicy.exhausted
    ? 'failed'
    : blockingFailures.length > 0 || degradedReasons.length > 0 || handoff.state === 'blocked' ? 'degraded' : 'healthy';
  const activeFailureStates = [
    ...healthSignals.blockingRecords,
    ...healthSignals.warningRecords
  ].map((record) => ({
    id: record.id,
    code: record.code,
    component: record.component,
    state: record.state,
    severity: record.severity,
    retryable: record.retryable,
    observedAt: record.observedAt,
    deadlineAt: record.deadlineAt,
    affectedProcessIds: record.affectedProcessIds
  }));
  const degradedModePlan = {
    enabled: state !== 'healthy',
    mode: state === 'failed'
      ? 'block-handoff'
      : handoff.state === 'ready' && healthSignals.blockingCount === 0 ? 'allow-review-with-warnings' : 'hold-external-commit',
    writePolicy: state === 'failed' || persistedState.boundaryOwnership.blocked ? 'read-only' : 'guarded-write',
    externalHandoffAllowed: state !== 'failed' && handoff.state === 'ready' && healthSignals.blockingCount === 0,
    operatorActions: normalizeStringList([
      ...(healthSignals.invalidCount > 0 ? ['fix-health-signal-contract'] : []),
      ...(healthSignals.blockingCount > 0 ? ['resolve-hosted-kernel-health-signals'] : []),
      ...(retryPolicy.retryable ? ['retry-after-backoff'] : []),
      ...(retryPolicy.exhausted ? ['reset-retry-budget-or-escalate'] : [])
    ])
  };

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    state: HEALTH_STATES.has(state) ? state : 'degraded',
    degradedMode: state !== 'healthy',
    degradedModePlan,
    degradedReasons,
    failureCount: blockingFailures.length,
    retryPolicy,
    healthSignals,
    activeFailureStates,
    failedProcessIds: failedProcesses.map((process) => process.pid),
    pausedProcessIds: pausedProcesses.map((process) => process.pid),
    waitingProcessIds: waitingProcesses.map((process) => process.pid),
    actionableErrors: blockingFailures,
    userVisibleStatus: state === 'healthy'
      ? 'Hosted kernel snapshot is healthy and ready for handoff.'
      : state === 'failed'
        ? 'Hosted kernel snapshot cannot continue until blocking errors are resolved.'
        : 'Hosted kernel snapshot is running in degraded mode with operator action required.',
    proof: {
      digest: [
        SNAPSHOT_SCHEMA_VERSION,
        providerContract.providerId,
        handoff.state,
        providerDelivery.externalState,
        persistedState.status,
        healthSignals.proof.digest,
        degradedModePlan.mode,
        blockingFailures.map((failure) => failure.code).join('|') || 'no-failures',
        degradedReasons.join('|') || 'no-degradation'
      ].join('#')
    }
  };
}

function buildNextSteps(readiness, handoff, acceptance, operationalHealth, lifecycleSettings, providerDelivery, providerCommandHandoff) {
  const steps = [];

  if (!lifecycleSettings.valid) {
    steps.push({
      id: 'resolve-lifecycle-settings',
      action: 'configure',
      label: 'Resolve lifecycle command settings',
      reasons: lifecycleSettings.errors
    });
  }

  if (lifecycleSettings.valid && lifecycleSettings.commandCount > 0 && lifecycleSettings.nextAction !== 'monitor-lifecycle') {
    const lifecycleStepAction = lifecycleSettings.nextAction === 'dispatch-lifecycle-commands'
      ? 'dispatch'
      : lifecycleSettings.nextAction === 'queue-lifecycle-commands' ? 'queue' : 'schedule';
    steps.push({
      id: 'run-lifecycle-command-plan',
      action: lifecycleStepAction,
      label: lifecycleStepAction === 'dispatch'
        ? 'Dispatch lifecycle command plan'
        : lifecycleStepAction === 'queue' ? 'Queue lifecycle command plan' : 'Schedule lifecycle command plan',
      commandIds: lifecycleSettings.commands.map((command) => command.id),
      dispatchState: lifecycleSettings.dispatch.state,
      executableControlIds: lifecycleSettings.dispatch.executableControlIds,
      scheduledControlIds: lifecycleSettings.dispatch.scheduledControlIds,
      scheduleMode: lifecycleSettings.schedule.mode
    });
  }

  if (handoff.state === 'blocked') {
    steps.push({
      id: 'resolve-handoff-blockers',
      action: 'resolve',
      label: 'Resolve handoff blockers',
      reasons: handoff.blockedReasons
    });
  }

  if (handoff.state === 'ready' && acceptance.state === 'pending') {
    steps.push({
      id: 'accept-preview',
      action: 'accept',
      label: 'Accept snapshot preview',
      processIds: handoff.transferableProcessIds
    });
  }

  if (acceptance.accepted) {
    steps.push({
      id: 'commit-external-handoff',
      action: 'commit',
      label: 'Commit external handoff',
      commitToken: acceptance.commitToken,
      processIds: acceptance.processIds
    });
  }

  if (providerDelivery.commitRequested && providerDelivery.acknowledgement.state === 'pending') {
    steps.push({
      id: 'await-provider-ack',
      action: 'wait',
      label: 'Await provider acknowledgement',
      channel: providerDelivery.acknowledgement.channel,
      deadlineMs: providerDelivery.acknowledgement.deadlineMs,
      expectedDigest: providerDelivery.acknowledgement.expectedDigest
    });
  }

  if (!providerCommandHandoff.valid) {
    steps.push({
      id: 'resolve-provider-command-handoff',
      action: 'resolve',
      label: 'Resolve provider command handoff',
      reasons: providerCommandHandoff.blockedReasons
    });
  }

  if (providerCommandHandoff.dispatchable) {
    steps.push({
      id: 'dispatch-provider-command-handoff',
      action: 'dispatch',
      label: 'Dispatch provider command handoff',
      commandIds: providerCommandHandoff.commands.map((command) => command.id),
      channel: providerCommandHandoff.outboundChannel,
      ackChannel: providerCommandHandoff.acknowledgementChannel
    });
  }

  if (operationalHealth.retryPolicy.retryable) {
    steps.push({
      id: 'retry-snapshot-handoff',
      action: 'retry',
      label: 'Retry snapshot handoff',
      delayMs: operationalHealth.retryPolicy.nextDelayMs,
      attempt: operationalHealth.retryPolicy.attempt + 1,
      maxAttempts: operationalHealth.retryPolicy.maxAttempts,
      reasons: operationalHealth.retryPolicy.reasons
    });
  }

  for (const error of operationalHealth.actionableErrors.slice(0, 3)) {
    steps.push({
      id: `fix-${error.code}`,
      action: error.action,
      label: error.message,
      code: error.code,
      pid: error.pid || null,
      commandIds: error.commandIds || []
    });
  }

  return {
    recommendedAction: operationalHealth.state === 'failed'
      ? 'resolve'
      : steps[0]?.action || (readiness.state === 'ready' ? 'monitor' : 'inspect'),
    steps
  };
}

function buildPreviewAcceptanceDecisionMatrix(preview, handoff, acceptance, readiness, validationSummary, providerDelivery, providerCommandHandoff, clientRuntime, sync) {
  const blockingGateIds = readiness.gates
    .filter((gate) => !gate.ready)
    .map((gate) => gate.id);
  const validationBlocked = validationSummary.severity === 'error';
  const handoffBlocked = handoff.state !== 'ready';
  const alreadyAccepted = acceptance.state === 'accepted';
  const acknowledged = providerDelivery.acknowledgement.state === 'acknowledged';
  const transferableRows = preview.rows.filter((row) => row.previewState === 'transferable');
  const selectedSet = new Set(preview.rows.filter((row) => row.selectedForHandoff).map((row) => row.id));
  const acceptedSet = new Set(acceptance.accepted ? acceptance.processIds : []);
  const selectedTransferableProcessIds = transferableRows
    .filter((row) => selectedSet.has(row.id))
    .map((row) => row.id);
  const allTransferableProcessIds = transferableRows.map((row) => row.id);
  const defaultAcceptProcessIds = selectedTransferableProcessIds.length > 0
    ? selectedTransferableProcessIds
    : allTransferableProcessIds;
  const rows = preview.rows.map((row) => {
    const rowBlockedReasons = normalizeStringList([
      ...(row.previewState === 'transferable' ? [] : [row.blockingReason || 'process-not-transferable']),
      ...(handoffBlocked ? handoff.blockedReasons.map((reason) => `handoff:${reason}`) : []),
      ...(validationBlocked ? validationSummary.errors.map((error) => `validation:${error}`) : []),
      ...(alreadyAccepted && !acceptedSet.has(row.id) ? ['acceptance-already-committed-for-other-processes'] : [])
    ]);
    const selectable = row.previewState === 'transferable'
      && !handoffBlocked
      && !validationBlocked
      && !alreadyAccepted;
    const selected = selectedSet.has(row.id);
    const accepted = acceptedSet.has(row.id);
    const decisionState = accepted
      ? 'accepted'
      : selected && selectable ? 'selected'
        : selectable ? 'available'
          : row.previewState === 'transferable' ? 'blocked' : 'local-only';
    const nextAction = accepted
      ? acknowledged ? 'monitor-provider-ack' : 'commit-external-handoff'
      : selectable ? 'accept-preview'
        : row.previewState === 'transferable' ? 'resolve-blockers' : 'inspect-local-process';

    return {
      processId: row.id,
      label: row.label,
      status: row.status,
      route: row.route,
      checkpointToken: row.checkpointToken,
      parentPid: row.parentPid,
      childProcessIds: row.childProcessIds,
      decisionState,
      selectable,
      selected,
      accepted,
      nextAction,
      disabledReasons: rowBlockedReasons,
      readinessGateIds: rowBlockedReasons.length > 0 ? blockingGateIds : [],
      submitPreview: selectable
        ? {
          state: 'accepted',
          processIds: selected ? [row.id] : defaultAcceptProcessIds,
          requestId: clientRuntime.requestId,
          checkpoint: sync.checkpoint,
          nonceHint: [clientRuntime.requestId, row.id, sync.checkpoint].join('#')
        }
        : null
    };
  });
  const counts = rows.reduce((summary, row) => ({
    ...summary,
    [row.decisionState]: (summary[row.decisionState] || 0) + 1
  }), {});
  const blockedReasons = normalizeStringList([
    ...(handoffBlocked ? handoff.blockedReasons.map((reason) => `handoff:${reason}`) : []),
    ...(validationBlocked ? validationSummary.errors.map((error) => `validation:${error}`) : []),
    ...(providerCommandHandoff.valid ? [] : providerCommandHandoff.blockedReasons.map((reason) => `provider-command-handoff:${reason}`)),
    ...(transferableRows.length > 0 ? [] : ['no-transferable-processes'])
  ]);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedForRoute: clientRuntime.route,
    checkpoint: sync.checkpoint,
    defaultAcceptProcessIds,
    selectableCount: rows.filter((row) => row.selectable).length,
    selectedCount: rows.filter((row) => row.selected).length,
    acceptedCount: rows.filter((row) => row.accepted).length,
    blockedCount: rows.filter((row) => row.disabledReasons.length > 0).length,
    counts,
    blockedReasons,
    rows,
    proof: {
      digest: [
        PREVIEW_ACCEPTANCE_CONTRACT_VERSION,
        'preview-row-decision-matrix',
        clientRuntime.requestId,
        sync.checkpoint,
        rows.map((row) => `${row.processId}:${row.decisionState}:${row.nextAction}`).join('|') || 'no-preview-rows',
        blockedReasons.join('|') || 'row-decisions-ready'
      ].join('#'),
      sourceDigest: sync.proofDigest
    }
  };
}

function buildClientPreviewAcceptanceContract(clientRuntime, sync, preview, handoff, acceptance, readiness, validationSummary, nextSteps, operationalHealth, providerDelivery, providerCommandHandoff) {
  const blockingGateIds = readiness.gates
    .filter((gate) => !gate.ready)
    .map((gate) => gate.id);
  const selectableProcessIds = preview.rows
    .filter((row) => row.previewState === 'transferable')
    .map((row) => row.id);
  const selectedProcessIds = preview.rows
    .filter((row) => row.selectedForHandoff)
    .map((row) => row.id);
  const canAccept = handoff.state === 'ready'
    && validationSummary.severity !== 'error'
    && selectableProcessIds.length > 0
    && acceptance.state !== 'accepted';
  const canReject = handoff.state !== 'idle' && acceptance.state !== 'rejected';
  const submitDisabledReasons = normalizeStringList([
    ...(handoff.state === 'ready' ? [] : handoff.blockedReasons.map((reason) => `handoff:${reason}`)),
    ...(validationSummary.severity === 'error' ? validationSummary.errors.map((error) => `validation:${error}`) : []),
    ...(selectableProcessIds.length > 0 ? [] : ['no-transferable-processes']),
    ...(acceptance.state === 'accepted' ? ['acceptance-already-committed'] : [])
  ]);
  const decisionMatrix = buildPreviewAcceptanceDecisionMatrix(
    preview,
    handoff,
    acceptance,
    readiness,
    validationSummary,
    providerDelivery,
    providerCommandHandoff,
    clientRuntime,
    sync
  );
  const actionRows = nextSteps.steps.map((step, index) => ({
    id: step.id,
    order: index + 1,
    action: step.action,
    label: step.label,
    enabled: step.id === 'accept-preview' ? canAccept : step.action !== 'wait' || providerDelivery.acknowledgement.state !== 'acknowledged',
    processIds: step.processIds || [],
    commandIds: step.commandIds || [],
    commitToken: step.commitToken || null,
    reasons: step.reasons || [],
    routeIntent: [clientRuntime.route, step.action, step.id].join('#')
  }));
  const primaryAction = acceptance.accepted
    ? {
      id: 'commit-external-handoff',
      action: 'commit',
      label: 'Commit external handoff',
      enabled: true,
      commitToken: acceptance.commitToken,
      processIds: acceptance.processIds
    }
    : canAccept
    ? {
      id: 'accept-preview',
      action: 'accept',
      label: 'Accept snapshot preview',
      enabled: true,
      submitPayload: {
        state: 'accepted',
        processIds: decisionMatrix.defaultAcceptProcessIds,
        requestId: clientRuntime.requestId,
        checkpoint: sync.checkpoint,
        decisionDigest: decisionMatrix.proof.digest
      }
    }
    : {
      id: validationSummary.severity === 'error' ? 'inspect-validation' : nextSteps.steps[0]?.id || 'monitor-snapshot',
      action: nextSteps.recommendedAction,
      label: validationSummary.severity === 'error' ? validationSummary.title : nextSteps.steps[0]?.label || 'Monitor snapshot',
      enabled: false,
      disabledReasons: submitDisabledReasons
    };

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    contractVersion: PREVIEW_ACCEPTANCE_CONTRACT_VERSION,
    requestId: clientRuntime.requestId,
    kernelSessionId: clientRuntime.kernelSessionId,
    surface: clientRuntime.surface,
    route: clientRuntime.route,
    generatedFor: {
      tenantId: clientRuntime.tenantId,
      workspaceId: clientRuntime.workspaceId,
      actor: clientRuntime.actor
    },
    previewPanel: {
      title: preview.title,
      subtitle: preview.subtitle,
      healthState: preview.healthState,
      degradedMode: preview.degradedMode,
      focusProcessId: preview.focusProcessId,
      rowCount: preview.rows.length,
      transferableCount: selectableProcessIds.length,
      selectedCount: selectedProcessIds.length,
      availableCount: decisionMatrix.counts.available || 0,
      blockedCount: decisionMatrix.blockedCount,
      blockingGateIds,
      validationSeverity: validationSummary.severity
    },
    acceptanceControl: {
      state: acceptance.state,
      mode: acceptance.mode,
      canAccept,
      canReject,
      selectedProcessIds,
      selectableProcessIds,
      invalidProcessIds: acceptance.invalidProcessIds,
      commitToken: acceptance.commitToken,
      submitDisabledReasons,
      decisionDigest: decisionMatrix.proof.digest,
      rowDecisions: decisionMatrix.rows
    },
    routeHandlers: {
      preview: {
        method: 'GET',
        route: clientRuntime.route,
        responseField: 'preview'
      },
      validateAcceptance: {
        method: 'POST',
        route: `${clientRuntime.route}/validate-acceptance`,
        payloadSchema: {
          requestId: 'string',
          checkpoint: 'string',
          processIds: 'string[]',
          decisionDigest: 'string'
        },
        enabled: decisionMatrix.selectableCount > 0,
        responseFields: ['validationSummary', 'readiness', 'clientActionContract.acceptanceDecisionMatrix'],
        idempotencyKey: [clientRuntime.kernelSessionId, clientRuntime.requestId, sync.checkpoint, 'validate-acceptance'].join('#')
      },
      accept: {
        method: 'POST',
        route: `${clientRuntime.route}/accept-preview`,
        payloadSchema: {
          requestId: 'string',
          checkpoint: 'string',
          state: 'accepted | rejected | pending',
          processIds: 'string[]',
          nonce: 'string'
        },
        enabled: canAccept || canReject,
        idempotencyKey: [clientRuntime.kernelSessionId, clientRuntime.requestId, sync.checkpoint, 'acceptance'].join('#')
      },
      nextSteps: {
        method: 'GET',
        route: `${clientRuntime.route}/next-steps`,
        responseField: 'nextSteps'
      },
      providerCommandHandoff: {
        method: 'POST',
        route: `${clientRuntime.route}/provider-command-handoff`,
        payloadSchema: {
          requestId: 'string',
          checkpoint: 'string',
          commandIds: 'string[]',
          ackDigest: 'string'
        },
        enabled: providerCommandHandoff.dispatchable,
        idempotencyKey: [clientRuntime.kernelSessionId, clientRuntime.requestId, sync.checkpoint, 'provider-command-handoff'].join('#')
      }
    },
    primaryAction,
    acceptanceDecisionMatrix: decisionMatrix,
    nextStepActions: actionRows,
    readinessSummary: {
      state: readiness.state,
      readyGateCount: readiness.readyGateCount,
      totalGateCount: readiness.totalGateCount,
      blockingGateIds
    },
    validationSummary,
    providerDeliveryNotice: {
      externalState: providerDelivery.externalState,
      ackState: providerDelivery.acknowledgement.state,
      ackChannel: providerDelivery.acknowledgement.channel,
      deadlineMs: providerDelivery.acknowledgement.deadlineMs,
      visibleToClient: providerDelivery.commitRequested || providerDelivery.externalState !== 'local-only'
    },
    providerCommandNotice: {
      state: providerCommandHandoff.state,
      dispatchMode: providerCommandHandoff.dispatchMode,
      commandCount: providerCommandHandoff.commandCount,
      dispatchable: providerCommandHandoff.dispatchable,
      blockedReasons: providerCommandHandoff.blockedReasons,
      visibleToClient: providerCommandHandoff.commandCount > 0 || providerCommandHandoff.blockedReasons.length > 0
    },
    healthNotice: {
      state: operationalHealth.state,
      message: operationalHealth.userVisibleStatus,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
    },
    proof: {
      digest: [
        PREVIEW_ACCEPTANCE_CONTRACT_VERSION,
        clientRuntime.requestId,
        sync.checkpoint,
        readiness.state,
        validationSummary.severity,
        acceptance.state,
        selectableProcessIds.join(',') || 'no-selectable-processes',
        submitDisabledReasons.join('|') || 'acceptance-enabled'
      ].join('#'),
      sourceDigest: sync.proofDigest,
      stateVersion: clientRuntime.stateVersion
    }
  };
}

function countBy(processTable, selector) {
  return processTable.reduce((counts, process) => {
    const key = selector(process) || 'unknown';
    return {
      ...counts,
      [key]: (counts[key] || 0) + 1
    };
  }, {});
}

function canonicalizeSnapshotValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeSnapshotValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? null : value;
  }

  return Object.keys(value)
    .sort()
    .reduce((record, key) => ({
      ...record,
      [key]: canonicalizeSnapshotValue(value[key])
    }), {});
}

function stableSerializeSnapshotPayload(payload) {
  return JSON.stringify(canonicalizeSnapshotValue(payload));
}

function utf8ByteLength(value) {
  return typeof TextEncoder === 'function'
    ? new TextEncoder().encode(value).length
    : value.length;
}

function buildSerializedSnapshotImportPlan(sections, cursors, proofSections, processRecords, accessBoundary) {
  const sectionNames = Object.keys(sections);
  const missingSections = SERIALIZED_SNAPSHOT_REQUIRED_SECTIONS.filter((section) => !sectionNames.includes(section));
  const missingCursors = SERIALIZED_SNAPSHOT_REQUIRED_CURSORS.filter((cursor) => !asString(cursors[cursor], null));
  const psSection = asObject(sections.ps);
  const serializedBoundaryHandoff = asObject(psSection.boundaryHandoff);
  const replaySection = asObject(sections.replay);
  const recoverySection = asObject(sections.recovery);
  const claimEvidenceSection = asObject(sections.claimEvidence);
  const providerContractSection = asObject(sections.providerContract);
  const clientWorkflowSection = asObject(sections.clientWorkflow);
  const clientHandoffTicket = asObject(clientWorkflowSection.handoffTicket);
  const clientResume = asObject(clientWorkflowSection.resume);
  const clientReviewControl = asObject(asObject(clientWorkflowSection.controls).review);
  const hasClientWorkflowSection = sectionNames.includes('clientWorkflow');
  const providerContractBlockedReasons = normalizeStringList(providerContractSection.blockedReasons, []);
  const providerContractWarnings = normalizeStringList(providerContractSection.warnings, []);
  const providerContractInvalid = sectionNames.includes('providerContract') && providerContractSection.compatible !== true;
  const providerContractLeaseMissing = sectionNames.includes('providerContract')
    && providerContractSection.externalHandoff?.leaseState === 'grantable'
    && !asString(providerContractSection.externalHandoff?.leaseToken, null);
  const providerCommandCursorMissing = sectionNames.includes('providerContract')
    && providerContractSection.commandHandoff?.commandCount > 0
    && !asString(providerContractSection.commandHandoff?.cursor, null);
  const providerAckCursorMissing = sectionNames.includes('providerContract')
    && providerContractSection.delivery?.commitRequested === true
    && !asString(cursors.providerAck, null);
  const clientHandoffTicketMissing = hasClientWorkflowSection && !asString(clientHandoffTicket.ticketId, null);
  const clientHandoffRouteMissing = hasClientWorkflowSection && clientReviewControl.enabled === true
    && !asString(clientReviewControl.route, null);
  const clientResumeRouteMissing = hasClientWorkflowSection && clientResume.enabled !== false
    && !asString(clientResume.route, null);
  const clientWorkflowBlockedReasons = normalizeStringList(clientWorkflowSection.blockedReasons, []);
  const serializedBoundaryBlockedReasons = normalizeStringList(serializedBoundaryHandoff.blockedReasons, []);
  const serializedBoundaryWarnings = normalizeStringList(serializedBoundaryHandoff.warnings, []);
  const boundaryAuditPackageMissing = sectionNames.includes('ps')
    && accessBoundary.withheldCount > 0
    && !asString(serializedBoundaryHandoff.auditPackageId, null);
  const boundaryAuditCursorMissing = sectionNames.includes('ps')
    && accessBoundary.withheldCount > 0
    && !asString(serializedBoundaryHandoff.cursor, null);
  const claimedBoundaryValid = claimEvidenceSection.serializedBoundaryValid === true;
  const boundaryClaimMismatch = sectionNames.includes('claimEvidence')
    && serializedBoundaryBlockedReasons.length === 0
    && !claimedBoundaryValid;
  const claimBoundaryCursorMissing = sectionNames.includes('claimEvidence')
    && accessBoundary.withheldCount > 0
    && !asString(claimEvidenceSection.serializedBoundaryCursor, null);
  const claimBoundaryAuditMissing = sectionNames.includes('claimEvidence')
    && accessBoundary.withheldCount > 0
    && !asString(claimEvidenceSection.serializedBoundaryAuditPackageId, null);
  const claimedImportCommands = normalizeStringList(claimEvidenceSection.requiredImportCommands, []);
  const claimCursorKeys = Object.keys(asObject(claimEvidenceSection.cursorClaims));
  const completedImportCommandKeys = new Set([
    ...normalizeStringList(recoverySection.importedCommandKeys, []),
    ...normalizeStringList(recoverySection.completedImportCommandKeys, [])
  ]);
  const suppressedImportCommandKeys = new Set(normalizeStringList(recoverySection.suppressedImportCommandKeys, []));
  const missingClaimedImportCommands = sectionNames.includes('claimEvidence')
    ? SERIALIZED_SNAPSHOT_IMPORT_COMMANDS.filter((command) => !claimedImportCommands.includes(command))
    : SERIALIZED_SNAPSHOT_IMPORT_COMMANDS;
  const missingClaimedCursors = sectionNames.includes('claimEvidence')
    ? SERIALIZED_SNAPSHOT_REQUIRED_CURSORS.filter((cursor) => !claimCursorKeys.includes(cursor))
    : SERIALIZED_SNAPSHOT_REQUIRED_CURSORS;
  const invalidProofSections = proofSections
    .filter((section) => !asString(section.digest, null))
    .map((section) => section.id);
  const duplicateRecordIds = processRecords
    .map((process) => process.pid)
    .filter((pid, index, pids) => pids.indexOf(pid) !== index);
  const visibleRecordIds = new Set(accessBoundary.visibleProcessIds);
  const hiddenRecordLeaks = processRecords
    .filter((process) => !visibleRecordIds.has(process.pid) && accessBoundary.enforced)
    .map((process) => process.pid);
  const blockedReasons = normalizeStringList([
    ...missingSections.map((section) => `missing-section:${section}`),
    ...missingCursors.map((cursor) => `missing-cursor:${cursor}`),
    ...invalidProofSections.map((section) => `missing-proof-digest:${section}`),
    ...duplicateRecordIds.map((pid) => `duplicate-serialized-process:${pid}`),
    ...hiddenRecordLeaks.map((pid) => `withheld-process-leaked:${pid}`),
    ...serializedBoundaryBlockedReasons.map((reason) => `serialized-boundary:${reason}`),
    ...(boundaryAuditPackageMissing ? ['serialized-boundary-audit-package-missing'] : []),
    ...(boundaryAuditCursorMissing ? ['serialized-boundary-audit-cursor-missing'] : []),
    ...(boundaryClaimMismatch ? ['claim-evidence-boundary-valid-mismatch'] : []),
    ...(claimBoundaryCursorMissing ? ['claim-evidence-boundary-cursor-missing'] : []),
    ...(claimBoundaryAuditMissing ? ['claim-evidence-boundary-audit-package-missing'] : []),
    ...(providerContractInvalid ? ['provider-contract-not-compatible'] : []),
    ...providerContractBlockedReasons.map((reason) => `provider-contract:${reason}`),
    ...(providerContractLeaseMissing ? ['provider-contract-lease-token-missing'] : []),
    ...(providerCommandCursorMissing ? ['provider-command-cursor-missing'] : []),
    ...(providerAckCursorMissing ? ['provider-ack-cursor-missing'] : []),
    ...(clientHandoffTicketMissing ? ['client-workflow-ticket-missing'] : []),
    ...(clientHandoffRouteMissing ? ['client-workflow-review-route-missing'] : []),
    ...(clientResumeRouteMissing ? ['client-workflow-resume-route-missing'] : []),
    ...missingClaimedImportCommands.map((command) => `claim-evidence-missing-import-command:${command}`),
    ...missingClaimedCursors.map((cursor) => `claim-evidence-missing-cursor:${cursor}`)
  ]);
  const commands = SERIALIZED_SNAPSHOT_IMPORT_COMMANDS.map((command, index) => {
    const idempotencyKey = [
      SNAPSHOT_SERIALIZATION_VERSION,
      cursors.replay || 'missing-replay-cursor',
      cursors.recovery || 'missing-recovery-cursor',
      command
    ].join('#');
    const requiredSections = command === 'restore-process-table'
      ? ['ps']
      : command === 'restore-recovery-state'
        ? ['recovery']
        : command === 'restore-replay-cursor'
          ? ['replay']
          : command === 'bind-provider-contract' ? ['providerContract'] : ['claimEvidence'];
    const requiredCursors = command === 'restore-replay-cursor'
      ? ['replay', 'commandJournal']
      : command === 'restore-recovery-state'
        ? ['recovery']
        : command === 'bind-provider-contract' ? ['providerAck', 'externalHandoff'] : [];
    const missingCommandClaim = sectionNames.includes('claimEvidence') && !claimedImportCommands.includes(command);
    const missingCommandCursorClaims = requiredCursors.filter((cursor) => !claimCursorKeys.includes(cursor));
    const replayAlreadyCompleted = completedImportCommandKeys.has(command)
      || completedImportCommandKeys.has(idempotencyKey)
      || suppressedImportCommandKeys.has(command)
      || suppressedImportCommandKeys.has(idempotencyKey);
    const commandBlockedReasons = command === 'restore-process-table'
      ? [
        ...missingSections.filter((section) => section === 'ps').map((section) => `missing-section:${section}`),
        ...duplicateRecordIds.map((pid) => `duplicate-serialized-process:${pid}`),
        ...hiddenRecordLeaks.map((pid) => `withheld-process-leaked:${pid}`),
        ...serializedBoundaryBlockedReasons.map((reason) => `serialized-boundary:${reason}`),
        ...(boundaryAuditPackageMissing ? ['serialized-boundary-audit-package-missing'] : []),
        ...(boundaryAuditCursorMissing ? ['serialized-boundary-audit-cursor-missing'] : [])
      ]
      : command === 'restore-replay-cursor'
        ? missingCursors.filter((cursor) => cursor === 'replay' || cursor === 'commandJournal').map((cursor) => `missing-cursor:${cursor}`)
        : command === 'restore-recovery-state'
          ? missingCursors.filter((cursor) => cursor === 'recovery').map((cursor) => `missing-cursor:${cursor}`)
          : command === 'bind-provider-contract'
            ? [
              ...missingSections.filter((section) => section === 'providerContract').map((section) => `missing-section:${section}`),
              ...missingCursors
                .filter((cursor) => cursor === 'providerAck' || cursor === 'externalHandoff')
                .map((cursor) => `missing-cursor:${cursor}`),
              ...(providerContractInvalid ? ['provider-contract-not-compatible'] : []),
              ...providerContractBlockedReasons.map((reason) => `provider-contract:${reason}`),
              ...(providerContractLeaseMissing ? ['provider-contract-lease-token-missing'] : []),
              ...(providerCommandCursorMissing ? ['provider-command-cursor-missing'] : []),
              ...(providerAckCursorMissing ? ['provider-ack-cursor-missing'] : [])
            ]
            : [
              ...invalidProofSections.map((section) => `missing-proof-digest:${section}`),
              ...missingClaimedCursors.map((cursor) => `claim-evidence-missing-cursor:${cursor}`),
              ...(boundaryClaimMismatch ? ['claim-evidence-boundary-valid-mismatch'] : []),
              ...(claimBoundaryCursorMissing ? ['claim-evidence-boundary-cursor-missing'] : []),
              ...(claimBoundaryAuditMissing ? ['claim-evidence-boundary-audit-package-missing'] : [])
            ];
    const blocked = commandBlockedReasons.length > 0
      || missingCommandClaim
      || missingCommandCursorClaims.length > 0;
    const replayStatus = replayAlreadyCompleted
      ? 'already-applied'
      : blocked ? 'blocked' : 'replay-required';

    return {
      id: `serialized-import:${index + 1}:${command}`,
      command,
      idempotencyKey,
      state: replayAlreadyCompleted ? 'restored' : blocked ? 'blocked' : 'ready',
      replayStatus,
      restartSafe: replayAlreadyCompleted || (!blocked && Boolean(cursors.replay) && Boolean(cursors.recovery)),
      dispatchable: !replayAlreadyCompleted && !blocked,
      recoveryPath: command === 'restore-process-table'
        ? 'hydrate-process-table-before-replay'
        : command === 'restore-replay-cursor'
          ? 'advance-replay-cursor-before-dispatch'
          : command === 'restore-recovery-state'
            ? 'restore-recovery-status-before-write'
            : command === 'bind-provider-contract'
              ? 'bind-provider-before-external-handoff'
              : 'verify-claim-evidence-before-ack',
      cursorFence: {
        replay: cursors.replay || null,
        recovery: cursors.recovery || null,
        commandJournal: requiredCursors.includes('commandJournal') ? cursors.commandJournal || null : null,
        providerAck: requiredCursors.includes('providerAck') ? cursors.providerAck || null : null,
        externalHandoff: requiredCursors.includes('externalHandoff') ? cursors.externalHandoff || null : null
      },
      requiredSections,
      requiredCursors,
      claimEvidence: {
        commandClaimed: claimedImportCommands.includes(command),
        missingCursorClaims: missingCommandCursorClaims,
        digest: asString(claimEvidenceSection.proofDigest, null)
      },
      blockedReasons: normalizeStringList([
        ...commandBlockedReasons,
        ...(missingCommandClaim ? [`claim-evidence-missing-import-command:${command}`] : []),
        ...missingCommandCursorClaims.map((cursor) => `claim-evidence-missing-cursor:${cursor}`)
      ])
    };
  });
  const dispatchableCommands = commands.filter((command) => command.dispatchable);
  const blockedCommands = commands.filter((command) => command.state === 'blocked');
  const restoredCommands = commands.filter((command) => command.state === 'restored');
  const restartState = blockedCommands.length > 0
    ? 'blocked'
    : dispatchableCommands.length > 0 ? 'dispatchable'
      : restoredCommands.length === commands.length ? 'restored' : 'idle';
  const clientWorkflowValidation = hasClientWorkflowSection
    ? {
      section: 'clientWorkflow',
      valid: !clientHandoffTicketMissing
        && !clientHandoffRouteMissing
        && !clientResumeRouteMissing,
      ticketId: asString(clientHandoffTicket.ticketId, null),
      resumeRoute: asString(clientResume.route, null),
      reviewRoute: asString(clientReviewControl.route, null),
      workflowBlockedReasons: clientWorkflowBlockedReasons,
      blockedReasons: normalizeStringList([
        ...(clientHandoffTicketMissing ? ['client-workflow-ticket-missing'] : []),
        ...(clientHandoffRouteMissing ? ['client-workflow-review-route-missing'] : []),
        ...(clientResumeRouteMissing ? ['client-workflow-resume-route-missing'] : [])
      ])
    }
    : {
      section: 'clientWorkflow',
      valid: true,
      ticketId: null,
      resumeRoute: null,
      reviewRoute: null,
      blockedReasons: []
    };

  return {
    requiredSections: SERIALIZED_SNAPSHOT_REQUIRED_SECTIONS,
    requiredCursors: SERIALIZED_SNAPSHOT_REQUIRED_CURSORS,
    optionalSections: ['clientWorkflow'],
    clientWorkflowValidation,
    importCommands: commands,
    restart: {
      state: restartState,
      restartSafe: blockedCommands.length === 0 && commands.every((command) => command.restartSafe),
      cursorFence: [
        cursors.replay || 'missing-replay-cursor',
        cursors.recovery || 'missing-recovery-cursor',
        cursors.commandJournal || 'missing-command-journal-cursor',
        cursors.externalHandoff || 'missing-external-handoff-cursor'
      ].join('#'),
      dispatchableCommandIds: dispatchableCommands.map((command) => command.id),
      blockedCommandIds: blockedCommands.map((command) => command.id),
      restoredCommandIds: restoredCommands.map((command) => command.id),
      idempotencyKeys: commands.map((command) => command.idempotencyKey),
      nextAction: blockedCommands.length > 0
        ? 'repair-serialized-import-contract'
        : dispatchableCommands.length > 0 ? 'dispatch-idempotent-import-commands' : 'monitor-restored-import'
    },
    importable: blockedReasons.length === 0,
    blockedReasons,
    warnings: normalizeStringList([
      ...(accessBoundary.withheldCount > 0 ? [`redacted ${accessBoundary.withheldCount} process records by access boundary`] : []),
      ...serializedBoundaryWarnings.map((warning) => `serialized-boundary:${warning}`),
      ...providerContractWarnings.map((warning) => `provider-contract:${warning}`),
      ...clientWorkflowBlockedReasons.map((reason) => `client-workflow:${reason}`),
      ...(replaySection.restartSafe === false ? ['serialized-replay-section-not-restart-safe'] : []),
      ...(sectionNames.length > SERIALIZED_SNAPSHOT_REQUIRED_SECTIONS.length ? ['serialized-envelope-has-extended-sections'] : [])
    ])
  };
}

function buildSerializedSnapshotHealth(input, payloadByteLength, importPlan, accessBoundary, providerContractSection, clientWorkflowSection, now) {
  const serialization = asObject(input.serialization || input.serializedSnapshot || input.snapshotSerialization);
  const retry = asObject(serialization.retryPolicy || serialization.retry || input.retryPolicy);
  const maxPayloadBytes = normalizePositiveInteger(serialization.maxPayloadBytes, 524288, 1024, 10485760);
  const warningPayloadBytes = normalizePositiveInteger(
    serialization.warningPayloadBytes,
    Math.floor(maxPayloadBytes * 0.8),
    1024,
    maxPayloadBytes
  );
  const baseDelayMs = normalizePositiveInteger(retry.baseDelayMs, 1000, 250, 60000);
  const maxDelayMs = normalizePositiveInteger(retry.maxDelayMs, 30000, baseDelayMs, 300000);
  const maxAttempts = normalizePositiveInteger(retry.maxAttempts, 4, 1, 25);
  const attempt = normalizePositiveInteger(retry.attempt, 0, 0, 1000);
  const oversized = payloadByteLength > maxPayloadBytes;
  const nearLimit = !oversized && payloadByteLength > warningPayloadBytes;
  const importBlockedReasons = normalizeStringList(importPlan.blockedReasons, []);
  const transientImportReasons = importBlockedReasons.filter((reason) => (
    reason.includes('provider-ack')
    || reason.includes('provider-command-cursor')
    || reason.includes('external-handoff')
    || reason.includes('client-workflow')
  ));
  const boundaryIntegrityReasons = importBlockedReasons.filter((reason) => (
    reason.includes('withheld-process-leaked')
    || reason.includes('serialized-boundary')
    || reason.includes('claim-evidence-boundary')
  ));
  const providerContractReasons = normalizeStringList(providerContractSection.blockedReasons, []);
  const clientWorkflowReasons = normalizeStringList(clientWorkflowSection.blockedReasons, []);
  const actionableErrors = normalizeStringList([
    ...(oversized ? ['serialized-payload-over-max-bytes'] : []),
    ...importBlockedReasons.map((reason) => `serialized-import:${reason}`),
    ...providerContractReasons.map((reason) => `serialized-provider-contract:${reason}`),
    ...clientWorkflowReasons.map((reason) => `serialized-client-workflow:${reason}`)
  ]).map((code) => {
    const fatal = code === 'serialized-payload-over-max-bytes'
      || code.includes('withheld-process-leaked')
      || code.includes('claim-evidence-boundary-valid-mismatch');
    const retryable = transientImportReasons.some((reason) => code.endsWith(reason));
    const action = code === 'serialized-payload-over-max-bytes'
      ? 'reduce-serialized-detail-or-split-snapshot'
      : code.includes('serialized-boundary') || code.includes('claim-evidence-boundary')
        ? 'repair-boundary-claim-evidence'
        : retryable ? 'retry-serialization-after-provider-sync' : 'repair-serialized-import-contract';

    return {
      code,
      severity: fatal ? 'fatal' : retryable ? 'warning' : 'error',
      retryable,
      action,
      message: code === 'serialized-payload-over-max-bytes'
        ? `Serialized process snapshot is ${payloadByteLength} bytes, above the ${maxPayloadBytes} byte export limit.`
        : `Serialized process snapshot blocked by ${code.replace('serialized-import:', '').replace('serialized-provider-contract:', '').replace('serialized-client-workflow:', '')}.`
    };
  });
  const retryable = retry.enabled !== false
    && transientImportReasons.length > 0
    && attempt < maxAttempts
    && !oversized
    && boundaryIntegrityReasons.length === 0;
  const nextDelayMs = retryable ? Math.min(maxDelayMs, baseDelayMs * (2 ** attempt)) : null;
  const nowMs = Date.parse(now);
  const nextRetryAt = retryable && Number.isFinite(nowMs) ? isoFromMs(nowMs + nextDelayMs) : null;
  const state = actionableErrors.some((error) => error.severity === 'fatal')
    ? 'failed'
    : importBlockedReasons.length > 0 || providerContractReasons.length > 0 || nearLimit ? 'degraded' : 'healthy';
  const exportMode = state === 'failed'
    ? 'blocked'
    : importBlockedReasons.length > 0 ? 'metadata-only-with-repair-plan'
      : nearLimit || accessBoundary.withheldCount > 0 ? 'guarded-full-export' : 'full-export';
  const operatorActions = normalizeStringList([
    ...(oversized ? ['reduce-serialized-detail-or-split-snapshot'] : []),
    ...(boundaryIntegrityReasons.length > 0 ? ['repair-boundary-claim-evidence'] : []),
    ...(providerContractReasons.length > 0 ? ['resolve-provider-contract-before-export'] : []),
    ...(clientWorkflowReasons.length > 0 ? ['repair-client-workflow-import-binding'] : []),
    ...(retryable ? ['retry-serialization-after-provider-sync'] : []),
    ...(nearLimit ? ['monitor-serialized-payload-size'] : [])
  ]);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now,
    state,
    exportMode,
    importable: importPlan.importable && state !== 'failed',
    restartSafe: importPlan.restart.restartSafe && state !== 'failed',
    payloadBytes: {
      actual: payloadByteLength,
      warning: warningPayloadBytes,
      max: maxPayloadBytes,
      utilization: Number((payloadByteLength / maxPayloadBytes).toFixed(4)),
      nearLimit,
      oversized
    },
    retryPolicy: {
      enabled: retry.enabled !== false,
      retryable,
      attempt,
      maxAttempts,
      exhausted: transientImportReasons.length > 0 && attempt >= maxAttempts,
      baseDelayMs,
      maxDelayMs,
      nextDelayMs,
      nextRetryAt,
      reasons: transientImportReasons
    },
    degradedReasons: normalizeStringList([
      ...(nearLimit ? ['serialized-payload-near-byte-limit'] : []),
      ...(accessBoundary.withheldCount > 0 ? ['serialized-output-redacted-by-tenant-boundary'] : []),
      ...importPlan.warnings.map((warning) => `serialized-import-warning:${warning}`)
    ]),
    failureStates: actionableErrors.map((error) => ({
      code: error.code,
      severity: error.severity,
      retryable: error.retryable,
      action: error.action
    })),
    actionableErrors,
    operatorActions,
    userVisibleStatus: state === 'healthy'
      ? 'Serialized process snapshot is importable and restart-safe.'
      : state === 'failed'
        ? 'Serialized process snapshot export is blocked until fatal serialization issues are repaired.'
        : 'Serialized process snapshot is degraded and includes a repair or retry plan.',
    proof: {
      digest: [
        SNAPSHOT_SERIALIZATION_VERSION,
        'serialized-envelope-health',
        payloadByteLength,
        maxPayloadBytes,
        state,
        exportMode,
        importBlockedReasons.join('|') || 'no-import-blockers',
        operatorActions.join('|') || 'no-operator-actions'
      ].join('#'),
      sourceDigest: importPlan.restart.cursorFence
    }
  };
}

function buildSerializedClientWorkflowSection(clientRuntime, workflowHandoff, acceptance, sync, readiness, validationSummary, providerDelivery, providerCommandHandoff) {
  const controls = asObject(workflowHandoff.clientControls);
  const routeControls = Object.entries(controls).reduce((index, [id, control]) => {
    const record = asObject(control);
    const route = asString(record.route, null);
    const method = asString(record.method, id === 'resumeClient' ? 'GET' : 'POST');

    return {
      ...index,
      [id]: {
        enabled: record.enabled !== false,
        method,
        route,
        payload: asObject(record.payload),
        disabledReasons: normalizeStringList(record.disabledReasons, []),
        routeIntent: route
          ? [clientRuntime.requestId, sync.checkpoint, method, route].join('#')
          : null
      }
    };
  }, {});
  const activeControlIds = Object.entries(routeControls)
    .filter(([, control]) => control.enabled)
    .map(([id]) => id);
  const selectedProcessRecords = Array.isArray(workflowHandoff.selectedProcessRecords)
    ? workflowHandoff.selectedProcessRecords
    : [];
  const resumeRoute = asString(workflowHandoff.clientResume?.route, clientRuntime.route);
  const notificationTopic = asString(workflowHandoff.clientResume?.notificationTopic, null);
  const commitControl = asObject(routeControls.commit);
  const acceptControl = asObject(routeControls.accept);
  const reviewControl = asObject(routeControls.review);
  const resumeControl = asObject(routeControls.resumeClient);
  const ticketState = acceptance.accepted
    ? providerDelivery.acknowledgement.state === 'acknowledged' ? 'committed' : 'commit-pending-provider-ack'
    : workflowHandoff.state === 'awaiting-operator' ? 'awaiting-client-acceptance' : workflowHandoff.state;
  const blockedReasons = normalizeStringList([
    ...normalizeStringList(workflowHandoff.clientBlockedReasons, []),
    ...(readiness.state === 'blocked' ? ['readiness-blocked'] : []),
    ...(validationSummary.severity === 'error' ? validationSummary.errors.map((error) => `validation:${error}`) : []),
    ...(providerCommandHandoff.valid ? [] : providerCommandHandoff.blockedReasons.map((reason) => `provider-command-handoff:${reason}`)),
    ...(reviewControl.enabled && !reviewControl.route ? ['review-control-route-missing'] : []),
    ...(acceptControl.enabled && !acceptControl.route ? ['accept-control-route-missing'] : []),
    ...(commitControl.enabled && !commitControl.route ? ['commit-control-route-missing'] : []),
    ...(resumeControl.enabled && !resumeControl.route ? ['resume-control-route-missing'] : [])
  ]);
  const ticketId = [
    clientRuntime.kernelSessionId,
    clientRuntime.requestId,
    sync.checkpoint,
    workflowHandoff.action,
    activeControlIds.join(',') || 'no-active-controls'
  ].join('#');

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sectionVersion: 'kernel.processSnapshot.serialized.clientWorkflow.v1',
    requestId: clientRuntime.requestId,
    kernelSessionId: clientRuntime.kernelSessionId,
    clientSurface: clientRuntime.surface,
    clientRoute: clientRuntime.route,
    workflowState: workflowHandoff.state,
    workflowAction: workflowHandoff.action,
    workflowMode: workflowHandoff.clientWorkflowMode,
    resumeStrategy: workflowHandoff.resumeStrategy,
    readinessState: readiness.state,
    validationSeverity: validationSummary.severity,
    selectedProcessIds: selectedProcessRecords.map((process) => process.pid),
    acceptedProcessIds: acceptance.processIds,
    handoffTicket: {
      ticketId,
      state: ticketState,
      commitToken: acceptance.commitToken,
      activeControlIds,
      idempotencyKey: [ticketId, providerDelivery.acknowledgement.state].join('#'),
      expiresWithCheckpoint: sync.checkpoint
    },
    resume: {
      enabled: true,
      route: resumeRoute,
      processId: workflowHandoff.clientResume?.processId || null,
      checkpointToken: workflowHandoff.clientResume?.checkpointToken || null,
      preserveSelection: workflowHandoff.clientResume?.preserveSelection !== false,
      selectedProcessIds: normalizeStringList(workflowHandoff.clientResume?.selectedProcessIds, []),
      notificationTopic
    },
    controls: routeControls,
    providerAck: {
      state: providerDelivery.acknowledgement.state,
      expectedDigest: providerDelivery.acknowledgement.expectedDigest,
      channel: providerDelivery.acknowledgement.channel,
      visibleToClient: providerDelivery.commitRequested || providerDelivery.externalState !== 'local-only'
    },
    providerCommand: {
      state: providerCommandHandoff.state,
      dispatchable: providerCommandHandoff.dispatchable,
      commandCount: providerCommandHandoff.commandCount,
      cursor: providerCommandHandoff.cursor
    },
    importBinding: {
      restoreRoute: resumeRoute,
      reviewRoute: reviewControl.route,
      acceptRoute: acceptControl.route,
      commitRoute: commitControl.route,
      notificationTopic,
      requiredControlIds: activeControlIds
    },
    blockedReasons,
    valid: blockedReasons.length === 0,
    proof: {
      digest: [
        SNAPSHOT_SERIALIZATION_VERSION,
        'serialized-client-workflow',
        ticketId,
        resumeRoute,
        workflowHandoff.proof.digest,
        providerDelivery.proof.digest,
        providerCommandHandoff.proof.digest,
        blockedReasons.join('|') || 'client-workflow-ready'
      ].join('#'),
      sourceDigest: workflowHandoff.proof.digest,
      stateVersion: clientRuntime.stateVersion
    }
  };
}

function buildSerializedProviderContractSection(providerContract, providerSync, handoff, providerDelivery, providerCommandHandoff, sync, clientRuntime) {
  const missingCapabilities = providerContract.negotiation.missing;
  const serviceContractErrors = providerContract.serviceContract.errors;
  const commandBlockedReasons = providerCommandHandoff.blockedReasons;
  const deliveryErrors = providerDelivery.errors;
  const blockedReasons = normalizeStringList([
    ...missingCapabilities.map((capability) => `missing-capability:${capability}`),
    ...serviceContractErrors.map((error) => `service-contract:${error}`),
    ...providerSync.blockedReasons.map((reason) => `provider-sync:${reason}`),
    ...handoff.blockedReasons.map((reason) => `handoff:${reason}`),
    ...deliveryErrors.map((error) => `provider-delivery:${error}`),
    ...commandBlockedReasons.map((reason) => `provider-command-handoff:${reason}`)
  ]);
  const warnings = normalizeStringList([
    ...providerContract.serviceContract.warnings.map((warning) => `service-contract:${warning}`),
    ...providerDelivery.warnings.map((warning) => `provider-delivery:${warning}`),
    ...providerCommandHandoff.warnings.map((warning) => `provider-command-handoff:${warning}`),
    ...(providerSync.batch.overflowProcessIds.length > 0 ? ['provider-sync-batch-overflow'] : [])
  ]);
  const lifecycleControls = providerContract.serviceContract.lifecycleControls;
  const providerCursors = {
    providerAck: providerDelivery.acknowledgement.expectedDigest,
    externalHandoff: [
      providerContract.providerId,
      handoff.target,
      handoff.lease.token || 'no-lease',
      providerDelivery.externalState,
      providerCommandHandoff.cursor
    ].join('#'),
    commandHandoff: providerCommandHandoff.cursor,
    outbound: providerDelivery.outbound.cursor
  };
  const compatible = providerContract.accepted
    && providerSync.compatible
    && providerDelivery.valid
    && providerCommandHandoff.valid
    && blockedReasons.length === 0;

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    providerId: providerContract.providerId,
    service: providerContract.service,
    endpoint: providerContract.endpoint,
    protocolVersion: providerContract.serviceContract.protocolVersion,
    supportedProtocols: providerContract.serviceContract.supportedProtocols,
    syncMode: providerContract.serviceContract.syncMode,
    compatible,
    accepted: providerContract.accepted,
    capabilityNegotiation: {
      required: providerContract.negotiation.required,
      declared: providerContract.negotiation.declared,
      supported: providerContract.negotiation.supported,
      missing: missingCapabilities
    },
    serviceContract: {
      maxProcessBatchSize: providerContract.serviceContract.maxProcessBatchSize,
      ackDeadlineMs: providerContract.serviceContract.ackDeadlineMs,
      leaseTtlMs: providerContract.serviceContract.leaseTtlMs,
      handoffTargets: providerContract.serviceContract.handoffTargets,
      lifecycleControls,
      controlPermissions: lifecycleControls.reduce((index, control) => ({
        ...index,
        [control]: LIFECYCLE_CONTROL_PERMISSIONS[control]
      }), {})
    },
    syncEnvelope: {
      channel: providerSync.channel,
      checkpoint: sync.checkpoint,
      transferableCount: providerSync.batch.transferableCount,
      overflowProcessIds: providerSync.batch.overflowProcessIds,
      controlPlan: providerSync.controlPlan,
      digest: providerSync.proof.digest
    },
    externalHandoff: {
      state: handoff.state,
      target: handoff.target,
      requestedTarget: handoff.requestedTarget,
      leaseState: handoff.lease.state,
      leaseToken: handoff.lease.token,
      leaseTtlMs: handoff.lease.ttlMs,
      transferableProcessIds: handoff.transferableProcessIds
    },
    delivery: {
      externalState: providerDelivery.externalState,
      deliveryGuarantee: providerDelivery.deliveryGuarantee,
      outboundChannel: providerDelivery.outbound.channel,
      acknowledgementChannel: providerDelivery.acknowledgement.channel,
      ackState: providerDelivery.acknowledgement.state,
      ackDeadlineMs: providerDelivery.acknowledgement.deadlineMs,
      commitRequested: providerDelivery.commitRequested,
      recordCount: providerDelivery.recordCount
    },
    commandHandoff: {
      contractVersion: providerCommandHandoff.contractVersion,
      state: providerCommandHandoff.state,
      dispatchMode: providerCommandHandoff.dispatchMode,
      dispatchable: providerCommandHandoff.dispatchable,
      cursor: providerCommandHandoff.cursor,
      commandCount: providerCommandHandoff.commandCount,
      lifecycleCommandCount: providerCommandHandoff.lifecycleCommandCount,
      commitCommandCount: providerCommandHandoff.commitCommandCount
    },
    clientBinding: {
      requestId: clientRuntime.requestId,
      kernelSessionId: clientRuntime.kernelSessionId,
      surface: clientRuntime.surface,
      route: clientRuntime.route
    },
    cursors: providerCursors,
    blockedReasons,
    warnings,
    proof: {
      digest: [
        SNAPSHOT_SERIALIZATION_VERSION,
        'serialized-provider-contract',
        providerContract.providerId,
        sync.checkpoint,
        providerContract.serviceContract.protocolVersion,
        providerDelivery.externalState,
        providerCommandHandoff.state,
        providerCursors.externalHandoff,
        blockedReasons.join('|') || 'provider-contract-ready'
      ].join('#'),
      sourceDigest: providerSync.proof.digest
    }
  };
}

function buildSerializedBoundaryHandoff(accessBoundary, processTable, handoff, acceptance, clientRuntime, sync, now) {
  const visibleProcessIds = new Set(accessBoundary.visibleProcessIds);
  const withheldProcessIds = new Set(accessBoundary.withheldProcessIds);
  const transferSet = new Set(handoff.transferableProcessIds);
  const acceptedSet = new Set(acceptance.processIds);
  const withheldRecords = processTable
    .filter((process) => withheldProcessIds.has(process.pid) || !visibleProcessIds.has(process.pid))
    .map((process) => ({
      pid: process.pid,
      tenantId: process.tenantId,
      workspaceId: process.workspaceId,
      status: process.status,
      route: process.route,
      service: process.service,
      deniedReasons: accessBoundary.decisions.find((decision) => decision.pid === process.pid)?.reasons || ['not-visible'],
      checkpointTokenPresent: Boolean(process.checkpointToken),
      handoffRequested: transferSet.has(process.pid) || acceptedSet.has(process.pid)
    }));
  const visibleRecords = processTable
    .filter((process) => visibleProcessIds.has(process.pid))
    .map((process) => ({
      pid: process.pid,
      parentPid: process.parentPid && visibleProcessIds.has(process.parentPid) ? process.parentPid : null,
      parentRedacted: Boolean(process.parentPid && !visibleProcessIds.has(process.parentPid)),
      status: process.status,
      service: process.service,
      route: process.route,
      checkpointToken: process.checkpointToken,
      updatedAt: process.updatedAt,
      handoffEligible: process.handoffEligible,
      transferable: transferSet.has(process.pid),
      acceptedForHandoff: acceptedSet.has(process.pid)
    }));
  const leakedHandoffIds = withheldRecords
    .filter((process) => process.handoffRequested)
    .map((process) => process.pid);
  const parentRedactionIds = visibleRecords
    .filter((process) => process.parentRedacted)
    .map((process) => process.pid);
  const blockedReasons = normalizeStringList([
    ...leakedHandoffIds.map((pid) => `withheld-process-selected-for-handoff:${pid}`)
  ]);
  const warnings = normalizeStringList([
    ...(accessBoundary.mode === 'audit-only' && withheldRecords.length > 0
      ? ['audit-only-boundary-redacted-from-serialized-process-table']
      : []),
    ...parentRedactionIds.map((pid) => `serialized-parent-redacted:${pid}`),
    ...(accessBoundary.scopedPermissions.invalidCount > 0
      ? [`invalid-scoped-grants-omitted:${accessBoundary.scopedPermissions.invalidCount}`]
      : [])
  ]);
  const auditPackageId = [
    clientRuntime.kernelSessionId,
    clientRuntime.requestId,
    sync.checkpoint,
    accessBoundary.tenantId,
    accessBoundary.workspaceId,
    'serialized-boundary-audit'
  ].join('#');

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now,
    mode: accessBoundary.mode,
    enforced: accessBoundary.enforced,
    actor: accessBoundary.actor,
    tenantId: accessBoundary.tenantId,
    workspaceId: accessBoundary.workspaceId,
    visibleProcessIds: visibleRecords.map((process) => process.pid),
    withheldProcessIds: withheldRecords.map((process) => process.pid),
    visibleRecords,
    withheldRecords,
    handoff: {
      auditPackageId,
      destination: 'tenant-boundary-audit-ledger',
      checkpoint: sync.checkpoint,
      requestId: clientRuntime.requestId,
      cursor: [auditPackageId, visibleRecords.length, withheldRecords.length].join('#'),
      requiredRole: 'auditor',
      requiredPermission: 'snapshot:audit-read',
      includesWithheldMetadata: withheldRecords.length > 0,
      includesWithheldPayload: false
    },
    blockedReasons,
    warnings,
    valid: blockedReasons.length === 0,
    proof: {
      digest: [
        SNAPSHOT_SERIALIZATION_VERSION,
        'serialized-boundary-handoff',
        sync.checkpoint,
        accessBoundary.proof.digest,
        visibleRecords.map((process) => `${process.pid}:${process.checkpointToken}`).join('|') || 'no-visible-processes',
        withheldRecords.map((process) => `${process.pid}:${process.deniedReasons.join(',')}`).join('|') || 'no-withheld-processes',
        blockedReasons.join('|') || 'boundary-handoff-ready'
      ].join('#'),
      sourceDigest: accessBoundary.proof.digest
    }
  };
}

function buildSerializedProcessSnapshot(context) {
  const {
    input = {},
    now,
    processTable,
    processIdentity,
    accessBoundary,
    sync,
    providerContract,
    providerSync,
    persistedState,
    recovery,
    restartCommandJournal,
    handoff,
    acceptance,
    providerDelivery,
    providerCommandHandoff,
    workflowHandoff,
    operationalHealth,
    readiness,
    validationSummary,
    clientRuntime,
    processTopology
  } = context;
  const boundaryHandoff = buildSerializedBoundaryHandoff(
    accessBoundary,
    processTable,
    handoff,
    acceptance,
    clientRuntime,
    sync,
    now
  );
  const processRecords = boundaryHandoff.visibleRecords;
  const proofSections = [
    { id: 'sync', digest: sync.proofDigest },
    { id: 'access-boundary', digest: accessBoundary.proof.digest },
    { id: 'serialized-boundary-handoff', digest: boundaryHandoff.proof.digest },
    { id: 'provider-sync', digest: providerSync.proof.digest },
    { id: 'persisted-state', digest: persistedState.proof.digest },
    { id: 'recovery', digest: recovery.proof.digest },
    { id: 'restart-command-journal', digest: restartCommandJournal.proof.digest },
    { id: 'provider-delivery', digest: providerDelivery.proof.digest },
    { id: 'provider-command-handoff', digest: providerCommandHandoff.proof.digest },
    { id: 'workflow-handoff', digest: workflowHandoff.proof.digest },
    { id: 'operational-health', digest: operationalHealth.proof.digest },
    { id: 'process-topology', digest: processTopology.proof.digest }
  ];
  const providerContractSection = buildSerializedProviderContractSection(
    providerContract,
    providerSync,
    handoff,
    providerDelivery,
    providerCommandHandoff,
    sync,
    clientRuntime
  );
  const clientWorkflowSection = buildSerializedClientWorkflowSection(
    clientRuntime,
    workflowHandoff,
    acceptance,
    sync,
    readiness,
    validationSummary,
    providerDelivery,
    providerCommandHandoff
  );
  proofSections.push({ id: 'serialized-provider-contract', digest: providerContractSection.proof.digest });
  proofSections.push({ id: 'serialized-client-workflow', digest: clientWorkflowSection.proof.digest });
  const replayCursor = [
    clientRuntime.kernelSessionId,
    clientRuntime.requestId,
    sync.checkpoint,
    persistedState.commandLedger.cursor,
    restartCommandJournal.cursor
  ].join('#');
  const recoveryCursor = [
    persistedState.storage.storeKey,
    persistedState.storage.revision,
    persistedState.status,
    recovery.status
  ].join('#');
  const cursors = {
    replay: replayCursor,
    recovery: recoveryCursor,
    providerAck: providerDelivery.acknowledgement.expectedDigest,
    commandJournal: restartCommandJournal.cursor,
    externalHandoff: providerContractSection.cursors.externalHandoff
  };
  const sections = {
    ps: {
      processCount: processRecords.length,
      inputProcessCount: processIdentity.inputCount,
      duplicateProcessIds: processIdentity.duplicateProcessIds,
      identityRepaired: processIdentity.repaired,
      visibleProcessIds: accessBoundary.visibleProcessIds,
      withheldProcessIds: accessBoundary.withheldProcessIds,
      boundaryHandoff: {
        auditPackageId: boundaryHandoff.handoff.auditPackageId,
        cursor: boundaryHandoff.handoff.cursor,
        destination: boundaryHandoff.handoff.destination,
        redactedProcessCount: boundaryHandoff.withheldProcessIds.length,
        parentRedactionCount: processRecords.filter((process) => process.parentRedacted).length,
        blockedReasons: boundaryHandoff.blockedReasons,
        warnings: boundaryHandoff.warnings,
        digest: boundaryHandoff.proof.digest
      },
      records: processRecords
    },
    replay: {
      cursor: replayCursor,
      restartSafe: restartCommandJournal.restartSafe,
      dispatchableCommandIds: restartCommandJournal.dispatchableCommandIds,
      blockedCommandIds: restartCommandJournal.blockedCommandIds,
      suppressedCommandIds: restartCommandJournal.suppressedCommandIds,
      commandCount: restartCommandJournal.counts.total
    },
    recovery: {
      cursor: recoveryCursor,
      status: recovery.status,
      restartSafe: recovery.restartSafe,
      commandIds: recovery.commands.map((command) => command.id),
      suppressedCommandIds: recovery.suppressedCommands.map((command) => command.id),
      replayRequiredProcessIds: persistedState.drift.replayRequiredProcessIds,
      shouldPersist: persistedState.storage.shouldPersist
    },
    providerContract: providerContractSection,
    claimEvidence: {
      evidenceType: 'kernel-process-snapshot-serialized-claim',
      providerId: providerContract.providerId,
      protocolVersion: providerContract.serviceContract.protocolVersion,
      checkpoint: sync.checkpoint,
      readinessState: readiness.state,
      validationSeverity: validationSummary.severity,
      healthState: operationalHealth.state,
      handoffState: handoff.state,
      providerDeliveryState: providerDelivery.externalState,
      providerCommandHandoffState: providerCommandHandoff.state,
      providerContractCompatible: providerContractSection.compatible,
      providerContractBlockedReasons: providerContractSection.blockedReasons,
      serializedBoundaryMode: boundaryHandoff.mode,
      serializedBoundaryValid: boundaryHandoff.valid,
      serializedBoundaryAuditPackageId: boundaryHandoff.handoff.auditPackageId,
      serializedBoundaryCursor: boundaryHandoff.handoff.cursor,
      serializedBoundaryWarnings: boundaryHandoff.warnings,
      serializedBoundaryBlockedReasons: boundaryHandoff.blockedReasons,
      serializedWithheldProcessIds: boundaryHandoff.withheldProcessIds,
      clientWorkflowState: clientWorkflowSection.workflowState,
      clientWorkflowTicketId: clientWorkflowSection.handoffTicket.ticketId,
      clientWorkflowValid: clientWorkflowSection.valid,
      clientWorkflowBlockedReasons: clientWorkflowSection.blockedReasons,
      clientResumeRoute: clientWorkflowSection.resume.route,
      externalHandoffCursor: providerContractSection.cursors.externalHandoff,
      requiredImportCommands: SERIALIZED_SNAPSHOT_IMPORT_COMMANDS,
      cursorClaims: Object.entries(cursors).reduce((claims, [cursor, value]) => ({
        ...claims,
        [cursor]: {
          value,
          present: Boolean(asString(value, null)),
          claimId: [SNAPSHOT_SERIALIZATION_VERSION, sync.checkpoint, cursor, value || 'missing'].join('#')
        }
      }), {}),
      acceptanceState: acceptance.state,
      proofDigests: proofSections
    },
    clientWorkflow: clientWorkflowSection
  };
  const importPlan = buildSerializedSnapshotImportPlan(
    sections,
    cursors,
    proofSections,
    processRecords,
    accessBoundary
  );
  const payloadBase = {
    serializationVersion: SNAPSHOT_SERIALIZATION_VERSION,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: sync.checkpoint,
    generatedAt: now,
    tenantBoundary: {
      mode: accessBoundary.mode,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      visibleCount: accessBoundary.visibleCount,
      withheldCount: accessBoundary.withheldCount
    },
    provider: {
      providerId: providerContract.providerId,
      service: providerContract.service,
      accepted: providerContract.accepted,
      syncMode: providerContract.serviceContract.syncMode,
      deliveryState: providerDelivery.externalState,
      commandHandoffState: providerCommandHandoff.state
    },
    serializationContract: {
      deterministic: true,
      canonicalOrdering: 'recursive-object-key-sort',
      importable: importPlan.importable,
      restartState: importPlan.restart.state,
      restartSafe: importPlan.restart.restartSafe,
      importCursorFence: importPlan.restart.cursorFence,
      requiredSections: importPlan.requiredSections,
      requiredCursors: importPlan.requiredCursors,
      idempotentImportCommands: importPlan.importCommands.map((command) => ({
        command: command.command,
        idempotencyKey: command.idempotencyKey,
        replayStatus: command.replayStatus,
        restartSafe: command.restartSafe
      })),
      blockedReasons: importPlan.blockedReasons,
      warnings: importPlan.warnings
    },
    sections
  };
  const draftPayloadJson = stableSerializeSnapshotPayload(payloadBase);
  const draftSerializationHealth = buildSerializedSnapshotHealth(
    input,
    utf8ByteLength(draftPayloadJson),
    importPlan,
    accessBoundary,
    providerContractSection,
    clientWorkflowSection,
    now
  );
  const draftPayload = {
    ...payloadBase,
    serializationContract: {
      ...payloadBase.serializationContract,
      health: draftSerializationHealth
    }
  };
  const finalDraftJson = stableSerializeSnapshotPayload(draftPayload);
  const serializationHealth = buildSerializedSnapshotHealth(
    input,
    utf8ByteLength(finalDraftJson),
    importPlan,
    accessBoundary,
    providerContractSection,
    clientWorkflowSection,
    now
  );
  const payload = {
    ...payloadBase,
    serializationContract: {
      ...payloadBase.serializationContract,
      health: serializationHealth
    }
  };
  const payloadJson = stableSerializeSnapshotPayload(payload);
  const payloadByteLength = utf8ByteLength(payloadJson);
  const digest = [
    SNAPSHOT_SERIALIZATION_VERSION,
    payload.snapshotId,
    payloadByteLength,
    serializationHealth.proof.digest,
    proofSections.map((section) => `${section.id}:${section.digest}`).join('|')
  ].join('#');

  return {
    serializationVersion: SNAPSHOT_SERIALIZATION_VERSION,
    mediaType: 'application/vnd.aios.kernel.process-snapshot+json',
    snapshotId: sync.checkpoint,
    checkpoint: sync.checkpoint,
    generatedAt: now,
    byteLength: payloadByteLength,
    payloadPreview: payloadJson.slice(0, 320),
    payload,
    canonicalPayloadJson: payloadJson,
    cursors,
    importPlan,
    serializationHealth,
    identity: {
      inputProcessCount: processIdentity.inputCount,
      canonicalProcessCount: processIdentity.processCount,
      duplicateCount: processIdentity.duplicateCount,
      duplicateProcessIds: processIdentity.duplicateProcessIds,
      conflicts: processIdentity.conflicts,
      digest: processIdentity.proof.digest
    },
    redaction: {
      mode: accessBoundary.mode,
      enforced: accessBoundary.enforced,
      visibleProcessCount: accessBoundary.visibleCount,
      withheldProcessCount: accessBoundary.withheldCount,
      withheldProcessIds: accessBoundary.withheldProcessIds
    },
    proof: {
      digest,
      sections: proofSections,
      sourceDigest: sync.proofDigest
    }
  };
}

function normalizeRequestedExportFormats(input) {
  const analytics = asObject(input.analytics || input.reporting);
  const exports = asObject(analytics.exports || input.exports);
  const requestedFormats = normalizeStringList(exports.formats || analytics.exportFormats, ['json', 'csv']);
  const formats = requestedFormats.filter((format) => EXPORT_FORMATS.has(format));
  return formats.length > 0 ? formats : ['json'];
}

function normalizeAnalyticsReportingOptions(input, clientRuntime) {
  const analytics = asObject(input.analytics || input.reporting);
  const exports = asObject(analytics.exports || input.exports);
  const requestedAudience = asString(analytics.audience || exports.audience, clientRuntime.surface === 'external-orchestrator' ? 'provider' : 'operator');
  const requestedDetailLevel = asString(exports.detailLevel || analytics.detailLevel, 'process');
  const audience = REPORT_AUDIENCES.has(requestedAudience) ? requestedAudience : 'operator';
  const detailLevel = EXPORT_DETAIL_LEVELS.has(requestedDetailLevel) ? requestedDetailLevel : 'process';
  const includeProofs = exports.includeProofs !== false && analytics.includeProofs !== false;
  const includeRows = detailLevel !== 'summary' && exports.includeRows !== false;
  const redactedFields = normalizeStringList(
    exports.redactedFields || analytics.redactedFields,
    audience === 'provider' ? ['tenantId', 'workspaceId'] : []
  );

  return {
    audience,
    detailLevel,
    includeProofs,
    includeRows,
    redactedFields,
    destination: asString(exports.destination || analytics.destination, audience === 'provider' ? 'provider-handoff-archive' : 'operator-reporting'),
    retentionDays: normalizePositiveInteger(exports.retentionDays || analytics.retentionDays, audience === 'auditor' ? 90 : 30, 1, 3650),
    invalidReasons: normalizeStringList([
      ...(REPORT_AUDIENCES.has(requestedAudience) ? [] : [`unsupported-report-audience:${requestedAudience}`]),
      ...(EXPORT_DETAIL_LEVELS.has(requestedDetailLevel) ? [] : [`unsupported-export-detail-level:${requestedDetailLevel}`])
    ])
  };
}

function redactExportRow(row, redactedFields) {
  if (redactedFields.length === 0) return row;
  return Object.entries(row).reduce((record, [key, value]) => ({
    ...record,
    [key]: redactedFields.includes(key) ? '[redacted]' : value
  }), {});
}

function buildDelimitedRows(rows, columns, delimiter) {
  const encode = (value) => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    return stringValue.includes(delimiter) || stringValue.includes('"') || stringValue.includes('\n')
      ? `"${stringValue.replaceAll('"', '""')}"`
      : stringValue;
  };

  return [
    columns.join(delimiter),
    ...rows.map((row) => columns.map((column) => encode(row[column])).join(delimiter))
  ].join('\n');
}

function buildExportArtifacts(exportRows, requestedFormats, reportingOptions, summary, proofDigest) {
  const columns = [
    'snapshotId',
    'requestId',
    'pid',
    'tenantId',
    'workspaceId',
    'service',
    'route',
    'status',
    'handoffEligible',
    'transferable',
    'acceptedForHandoff',
    'checkpointToken',
    'updatedAt'
  ];
  const rows = reportingOptions.includeRows
    ? exportRows.map((row) => redactExportRow(row, reportingOptions.redactedFields))
    : [];
  const manifest = requestedFormats.map((format) => {
    const payload = format === 'csv'
      ? buildDelimitedRows(rows, columns, ',')
      : format === 'jsonl'
        ? rows.map((row) => JSON.stringify(row)).join('\n')
        : JSON.stringify({ summary, rows }, null, 2);

    return {
      format,
      mediaType: format === 'csv' ? 'text/csv' : format === 'jsonl' ? 'application/x-ndjson' : 'application/json',
      destination: reportingOptions.destination,
      rowCount: rows.length,
      byteLength: payload.length,
      shaLikeDigest: [proofDigest, format, payload.length, rows.length].join('#'),
      payloadPreview: payload.slice(0, 240)
    };
  });

  return {
    columns,
    rows,
    manifest,
    packageCount: manifest.length,
    totalByteLength: manifest.reduce((total, artifact) => total + artifact.byteLength, 0)
  };
}

function normalizeHistorySnapshots(input, currentSnapshot, now) {
  const analytics = asObject(input.analytics || input.reporting);
  const rawHistory = Array.isArray(analytics.history)
    ? analytics.history
    : Array.isArray(input.historySnapshots) ? input.historySnapshots : [];
  const historyLimit = normalizePositiveInteger(analytics.historyLimit, 8, 1, 24);
  const normalizedHistory = rawHistory.slice(-historyLimit).map((snapshot, index) => {
    const record = asObject(snapshot);
    const counters = asObject(record.counters);
    const processCounts = asObject(counters.processes || record.processCounts);

    return {
      id: asString(record.id || record.snapshotId, `history-${index + 1}`),
      checkpoint: asString(record.checkpoint, 'unknown-checkpoint'),
      capturedAt: asString(record.capturedAt || record.generatedAt, now),
      healthState: asString(record.healthState, 'unknown'),
      handoffState: asString(record.handoffState, 'unknown'),
      processCount: normalizePositiveInteger(processCounts.total || record.processCount, 0, 0),
      transferableCount: normalizePositiveInteger(processCounts.transferable || record.transferableCount, 0, 0),
      withheldCount: normalizePositiveInteger(processCounts.withheld || record.withheldCount, 0, 0),
      recoveryCommandCount: normalizePositiveInteger(record.recoveryCommandCount, 0, 0)
    };
  });

  return [...normalizedHistory, currentSnapshot].slice(-(historyLimit + 1));
}

function buildAnalyticsHistoryRollup(history, currentSnapshot, previous, now) {
  const processCounts = history.map((snapshot) => snapshot.processCount);
  const transferableCounts = history.map((snapshot) => snapshot.transferableCount);
  const withheldCounts = history.map((snapshot) => snapshot.withheldCount);
  const recoveryCounts = history.map((snapshot) => snapshot.recoveryCommandCount);
  const unhealthySnapshots = history.filter((snapshot) => snapshot.healthState !== 'healthy');
  const blockedHandoffSnapshots = history.filter((snapshot) => !['ready', 'accepted'].includes(snapshot.handoffState));
  const processDelta = previous ? currentSnapshot.processCount - previous.processCount : 0;
  const transferableDelta = previous ? currentSnapshot.transferableCount - previous.transferableCount : 0;
  const withheldDelta = previous ? currentSnapshot.withheldCount - previous.withheldCount : 0;
  const recoveryCommandDelta = previous ? currentSnapshot.recoveryCommandCount - previous.recoveryCommandCount : 0;
  const regressionSignals = normalizeStringList([
    ...(processDelta < 0 ? ['process-count-decreased'] : []),
    ...(transferableDelta < 0 ? ['transferable-count-decreased'] : []),
    ...(withheldDelta > 0 ? ['withheld-process-count-increased'] : []),
    ...(recoveryCommandDelta > 0 ? ['recovery-command-count-increased'] : []),
    ...(currentSnapshot.healthState !== 'healthy' ? [`current-health:${currentSnapshot.healthState}`] : []),
    ...(!['ready', 'accepted'].includes(currentSnapshot.handoffState) ? [`current-handoff:${currentSnapshot.handoffState}`] : [])
  ]);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now,
    sampleCount: history.length,
    currentCheckpoint: currentSnapshot.checkpoint,
    previousCheckpoint: previous?.checkpoint || null,
    firstCheckpoint: history[0]?.checkpoint || currentSnapshot.checkpoint,
    deltas: {
      processCount: processDelta,
      transferableCount: transferableDelta,
      withheldCount: withheldDelta,
      recoveryCommandCount: recoveryCommandDelta
    },
    extrema: {
      maxProcessCount: processCounts.length ? Math.max(...processCounts) : 0,
      minProcessCount: processCounts.length ? Math.min(...processCounts) : 0,
      maxTransferableCount: transferableCounts.length ? Math.max(...transferableCounts) : 0,
      maxWithheldCount: withheldCounts.length ? Math.max(...withheldCounts) : 0,
      maxRecoveryCommandCount: recoveryCounts.length ? Math.max(...recoveryCounts) : 0
    },
    reliability: {
      unhealthyCheckpointIds: unhealthySnapshots.map((snapshot) => snapshot.checkpoint),
      blockedHandoffCheckpointIds: blockedHandoffSnapshots.map((snapshot) => snapshot.checkpoint),
      cleanRun: unhealthySnapshots.length === 0 && blockedHandoffSnapshots.length === 0,
      regressionSignals
    },
    exportSummary: {
      trendDirection: processDelta > 0 ? 'growing' : processDelta < 0 ? 'shrinking' : 'flat',
      transferableTrend: transferableDelta > 0 ? 'improving' : transferableDelta < 0 ? 'declining' : 'flat',
      withheldTrend: withheldDelta > 0 ? 'more-restricted' : withheldDelta < 0 ? 'less-restricted' : 'flat',
      recoveryTrend: recoveryCommandDelta > 0 ? 'more-recovery-work' : recoveryCommandDelta < 0 ? 'less-recovery-work' : 'flat'
    }
  };
}

function buildAnalyticsExportReadiness(exportArtifacts, requestedFormats, reportingOptions, reportState) {
  const manifestByFormat = exportArtifacts.manifest.reduce((index, artifact) => ({
    ...index,
    [artifact.format]: artifact
  }), {});
  const formatStates = requestedFormats.map((format) => {
    const artifact = manifestByFormat[format] || null;
    const blockedReasons = normalizeStringList([
      ...(artifact ? [] : ['missing-export-artifact']),
      ...(artifact && reportingOptions.includeRows && artifact.rowCount === 0 ? ['empty-export-rows'] : []),
      ...(artifact && artifact.byteLength === 0 ? ['empty-export-payload'] : []),
      ...(reportState === 'blocked' ? ['report-blocked'] : [])
    ]);

    return {
      format,
      ready: blockedReasons.length === 0,
      rowCount: artifact?.rowCount || 0,
      byteLength: artifact?.byteLength || 0,
      digest: artifact?.shaLikeDigest || null,
      blockedReasons
    };
  });
  const blockedFormats = formatStates.filter((formatState) => !formatState.ready);

  return {
    ready: blockedFormats.length === 0,
    requestedFormats,
    readyFormats: formatStates.filter((formatState) => formatState.ready).map((formatState) => formatState.format),
    blockedFormats: blockedFormats.map((formatState) => formatState.format),
    formatStates,
    destination: reportingOptions.destination,
    retentionDays: reportingOptions.retentionDays,
    blockedReasons: normalizeStringList(blockedFormats.flatMap((formatState) => (
      formatState.blockedReasons.map((reason) => `${formatState.format}:${reason}`)
    )))
  };
}

function buildProcessSnapshotAnalytics(input, context) {
  const {
    now,
    processTable,
    processIdentity,
    accessBoundary,
    providerSync,
    persistedState,
    recovery,
    handoff,
    workflowHandoff,
    operationalHealth,
    acceptance,
    readiness,
    validationSummary,
    sync,
    providerContract,
    clientRuntime,
    lifecycleSettings,
    providerDelivery,
    providerCommandHandoff,
    restartCommandJournal,
    processTopology
  } = context;
  const statusCounts = countBy(processTable, (process) => process.status);
  const serviceCounts = countBy(processTable, (process) => process.service);
  const routeCounts = countBy(processTable, (process) => process.route);
  const acceptedSet = new Set(acceptance.processIds);
  const transferableSet = new Set(handoff.transferableProcessIds);
  const currentSnapshot = {
    id: sync.checkpoint,
    checkpoint: sync.checkpoint,
    capturedAt: now,
    healthState: operationalHealth.state,
    handoffState: handoff.state,
    processCount: processTable.length,
    transferableCount: handoff.transferableProcessIds.length,
    withheldCount: accessBoundary.withheldCount,
    recoveryCommandCount: recovery.commandCount
  };
  const history = normalizeHistorySnapshots(input, currentSnapshot, now);
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const historyRollup = buildAnalyticsHistoryRollup(history, currentSnapshot, previous, now);
  const requestedFormats = normalizeRequestedExportFormats(input);
  const reportingOptions = normalizeAnalyticsReportingOptions(input, clientRuntime);
  const exportRows = processTable.map((process) => ({
    snapshotId: sync.checkpoint,
    requestId: clientRuntime.requestId,
    pid: process.pid,
    parentPid: process.parentPid,
    tenantId: process.tenantId,
    workspaceId: process.workspaceId,
    service: process.service,
    route: process.route,
    status: process.status,
    handoffEligible: process.handoffEligible,
    transferable: transferableSet.has(process.pid),
    acceptedForHandoff: acceptedSet.has(process.pid),
    checkpointToken: process.checkpointToken,
    updatedAt: process.updatedAt
  }));
  const timeline = [
    {
      id: 'snapshot-captured',
      at: sync.generatedAt,
      state: 'captured',
      label: `Captured ${processTable.length} hosted-kernel process records.`,
      checkpoint: sync.checkpoint
    },
    {
      id: 'provider-sync-prepared',
      at: providerContract.serviceContract.negotiatedAt,
      state: providerSync.compatible ? 'prepared' : 'blocked',
      label: providerSync.compatible
        ? `Prepared ${providerSync.batch.transferableCount} records for ${providerSync.providerId}.`
        : `Provider sync blocked: ${providerSync.blockedReasons.join(', ') || 'unknown'}.`,
      digest: providerSync.proof.digest
    },
    {
      id: 'lifecycle-command-plan',
      at: now,
      state: lifecycleSettings.valid ? 'prepared' : 'invalid',
      label: lifecycleSettings.valid
        ? `Prepared ${lifecycleSettings.commandCount} lifecycle commands with ${lifecycleSettings.schedule.mode} scheduling.`
        : `Lifecycle settings invalid: ${lifecycleSettings.errors.join(', ') || 'unknown'}.`,
      action: lifecycleSettings.nextAction,
      digest: lifecycleSettings.proof.digest
    },
    {
      id: 'persisted-state-restore',
      at: now,
      state: persistedState.storage.shouldPersist ? 'write-required' : persistedState.status,
      label: persistedState.storage.shouldPersist
        ? `Persisted recovery state requires ${persistedState.storage.mode} at revision ${persistedState.storage.revision}.`
        : `Persisted state restored as ${persistedState.storage.restartStatus}.`,
      restartStatus: persistedState.storage.restartStatus,
      leaseExpired: persistedState.storage.leaseExpired,
      replayRequiredCount: persistedState.drift.replayRequiredProcessIds.length,
      digest: persistedState.proof.digest
    },
    {
      id: 'handoff-decision',
      at: now,
      state: handoff.state,
      label: handoff.state === 'ready'
        ? `Handoff ready for ${handoff.target}.`
        : `Handoff ${handoff.state} with ${handoff.blockedReasons.length} blockers.`,
      target: handoff.target
    },
    {
      id: 'provider-delivery-contract',
      at: now,
      state: providerDelivery.externalState,
      label: providerDelivery.valid
        ? `Provider delivery ${providerDelivery.externalState} with ${providerDelivery.recordCount} outbound records.`
        : `Provider delivery blocked: ${providerDelivery.errors.join(', ') || 'unknown'}.`,
      ackState: providerDelivery.acknowledgement.state,
      digest: providerDelivery.proof.digest
    },
    {
      id: 'provider-command-handoff',
      at: now,
      state: providerCommandHandoff.state,
      label: providerCommandHandoff.valid
        ? `Provider command handoff ${providerCommandHandoff.state} with ${providerCommandHandoff.commandCount} commands.`
        : `Provider command handoff blocked: ${providerCommandHandoff.blockedReasons.join(', ') || 'unknown'}.`,
      dispatchMode: providerCommandHandoff.dispatchMode,
      commandCount: providerCommandHandoff.commandCount,
      digest: providerCommandHandoff.proof.digest
    },
    {
      id: 'restart-command-journal',
      at: now,
      state: restartCommandJournal.state,
      label: restartCommandJournal.restartSafe
        ? `Restart journal is ${restartCommandJournal.state} with ${restartCommandJournal.counts.total} durable command records.`
        : `Restart journal requires reconciliation for ${restartCommandJournal.counts.blocked} command records.`,
      nextAction: restartCommandJournal.nextAction,
      dispatchableCount: restartCommandJournal.counts.dispatchable,
      blockedCount: restartCommandJournal.counts.blocked,
      digest: restartCommandJournal.proof.digest
    },
    {
      id: 'workflow-reporting',
      at: now,
      state: workflowHandoff.state,
      label: workflowHandoff.userVisibleMessage,
      action: workflowHandoff.action
    }
  ];
  const reportState = validationSummary.severity === 'error' || reportingOptions.invalidReasons.length > 0
    ? 'blocked'
    : operationalHealth.state === 'healthy' && readiness.state === 'ready' ? 'publishable' : 'draft';
  const reportSummary = {
    title: 'Hosted kernel process snapshot analytics',
    checkpoint: sync.checkpoint,
    healthState: operationalHealth.state,
    handoffState: handoff.state,
    readinessState: readiness.state,
    reportState,
    audience: reportingOptions.audience,
    detailLevel: reportingOptions.detailLevel,
    recommendedExportName: `${clientRuntime.kernelSessionId}-${sync.checkpoint}-process-snapshot`
  };
  const exportProofSeed = [
    SNAPSHOT_SCHEMA_VERSION,
    sync.proofDigest,
    providerSync.proof.digest,
    providerDelivery.proof.digest,
    providerCommandHandoff.proof.digest,
    restartCommandJournal.proof.digest,
    lifecycleSettings.proof.digest,
    processTopology.proof.digest,
    operationalHealth.proof.digest,
    exportRows.map((row) => `${row.pid}:${row.status}:${row.transferable ? 'transferable' : 'local'}`).join('|') || 'no-export-rows'
  ].join('#');
  const exportArtifacts = buildExportArtifacts(exportRows, requestedFormats, reportingOptions, reportSummary, exportProofSeed);
  const exportReadiness = buildAnalyticsExportReadiness(exportArtifacts, requestedFormats, reportingOptions, reportState);
  const timelineSummary = {
    eventCount: timeline.length,
    blockedEventIds: timeline.filter((event) => ['blocked', 'invalid'].includes(event.state)).map((event) => event.id),
    latestState: timeline[timeline.length - 1]?.state || 'unknown',
    firstEventAt: timeline[0]?.at || now,
    lastEventAt: timeline[timeline.length - 1]?.at || now
  };

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    reportId: [clientRuntime.kernelSessionId, sync.checkpoint, 'analytics'].join('#'),
    generatedAt: now,
    counters: {
      processes: {
        total: processTable.length,
        inputTotal: processIdentity.inputCount,
        duplicateRepaired: processIdentity.duplicateCount,
        byStatus: statusCounts,
        byService: serviceCounts,
        byRoute: routeCounts,
        handoffEligible: processTable.filter((process) => process.handoffEligible).length,
        transferable: handoff.transferableProcessIds.length,
        acceptedForHandoff: acceptance.processIds.length,
        withheldByAccessBoundary: accessBoundary.withheldCount
      },
      provider: {
        accepted: providerContract.accepted,
        compatibleSync: providerSync.compatible,
        transferableBatchSize: providerSync.batch.transferableCount,
        overflowCount: providerSync.batch.overflowProcessIds.length,
        blockedReasonCount: providerSync.blockedReasons.length,
        deliveryExternalState: providerDelivery.externalState,
        deliveryRecordCount: providerDelivery.recordCount,
        deliveryAckState: providerDelivery.acknowledgement.state,
        deliveryValid: providerDelivery.valid,
        commandHandoffState: providerCommandHandoff.state,
        commandHandoffDispatchable: providerCommandHandoff.dispatchable,
        commandHandoffMode: providerCommandHandoff.dispatchMode,
        commandHandoffCount: providerCommandHandoff.commandCount,
        commandHandoffBlockedReasonCount: providerCommandHandoff.blockedReasons.length
      },
      lifecycle: {
        persistedStateStatus: persistedState.status,
        persistedStateRestartStatus: persistedState.storage.restartStatus,
        persistedStateShouldPersist: persistedState.storage.shouldPersist,
        persistedStateLeaseExpired: persistedState.storage.leaseExpired,
        persistedStateReplayRequiredCount: persistedState.drift.replayRequiredProcessIds.length,
        persistedStateRestoredProcessCount: persistedState.restoreIndex.restoredProcessIds.length,
        recoveryCommandCount: recovery.commandCount,
        lifecycleSettingsValid: lifecycleSettings.valid,
        lifecycleCommandCount: lifecycleSettings.commandCount,
        restartCommandJournalState: restartCommandJournal.state,
        restartCommandJournalSafe: restartCommandJournal.restartSafe,
        restartCommandJournalCount: restartCommandJournal.counts.total,
        restartCommandJournalDispatchableCount: restartCommandJournal.counts.dispatchable,
        restartCommandJournalBlockedCount: restartCommandJournal.counts.blocked,
        restartCommandJournalWaitingAckCount: restartCommandJournal.counts.waitingAck,
        lifecycleNextAction: lifecycleSettings.nextAction,
        lifecycleScheduleMode: lifecycleSettings.schedule.mode,
        lifecycleDispatchState: lifecycleSettings.dispatch.state,
        lifecycleExecutableControlCount: lifecycleSettings.dispatch.counts.executable,
        lifecycleScheduledControlCount: lifecycleSettings.dispatch.counts.schedulable,
        lifecycleBlockedControlCount: lifecycleSettings.dispatch.counts.blocked,
        readinessState: readiness.state,
        readyGateCount: readiness.readyGateCount,
        totalGateCount: readiness.totalGateCount,
        healthState: operationalHealth.state,
        failureCount: operationalHealth.failureCount,
        retryable: operationalHealth.retryPolicy.retryable
      },
      validation: validationSummary.counts
    },
    reportingCounters: {
      historySampleCount: historyRollup.sampleCount,
      historyRegressionSignalCount: historyRollup.reliability.regressionSignals.length,
      unhealthyHistoryCount: historyRollup.reliability.unhealthyCheckpointIds.length,
      blockedHandoffHistoryCount: historyRollup.reliability.blockedHandoffCheckpointIds.length,
      exportReadyFormatCount: exportReadiness.readyFormats.length,
      exportBlockedFormatCount: exportReadiness.blockedFormats.length,
      exportBlockedReasonCount: exportReadiness.blockedReasons.length
    },
    topology: {
      rootProcessIds: processTopology.rootProcessIds,
      duplicateProcessIds: processIdentity.duplicateProcessIds,
      duplicateConflicts: processIdentity.conflicts,
      identityRepaired: processIdentity.repaired,
      identityDigest: processIdentity.proof.digest,
      orphanParentRefs: processTopology.orphanParentRefs,
      withheldParentRefs: processTopology.withheldParentRefs,
      cycleProcessIds: processTopology.cycleProcessIds,
      valid: processTopology.valid,
      warningCount: processTopology.warnings.length,
      errorCount: processTopology.errors.length
    },
    trends: {
      previousCheckpoint: previous?.checkpoint || null,
      processCountDelta: historyRollup.deltas.processCount,
      transferableCountDelta: historyRollup.deltas.transferableCount,
      withheldCountDelta: historyRollup.deltas.withheldCount,
      recoveryCommandDelta: historyRollup.deltas.recoveryCommandCount,
      processTrend: historyRollup.exportSummary.trendDirection,
      transferableTrend: historyRollup.exportSummary.transferableTrend,
      withheldTrend: historyRollup.exportSummary.withheldTrend,
      recoveryTrend: historyRollup.exportSummary.recoveryTrend
    },
    historyRollup,
    history,
    timeline,
    timelineSummary,
    reportState: {
      state: reportState,
      publishable: reportState === 'publishable',
      audience: reportingOptions.audience,
      destination: reportingOptions.destination,
      retentionDays: reportingOptions.retentionDays,
      detailLevel: reportingOptions.detailLevel,
      includeRows: reportingOptions.includeRows,
      includeProofs: reportingOptions.includeProofs,
      redactedFields: reportingOptions.redactedFields,
      invalidReasons: reportingOptions.invalidReasons,
      blockedReasons: normalizeStringList([
        ...reportingOptions.invalidReasons,
        ...(validationSummary.severity === 'error' ? validationSummary.errors : []),
        ...(exportArtifacts.rows.length === 0 && reportingOptions.includeRows ? ['export-has-no-visible-process-rows'] : [])
      ])
    },
    exports: {
      ready: exportRows.length > 0 && reportState !== 'blocked',
      formats: requestedFormats,
      rowCount: exportArtifacts.rows.length,
      sourceRowCount: exportRows.length,
      csvColumns: exportArtifacts.columns,
      rows: exportArtifacts.rows,
      manifest: exportArtifacts.manifest,
      readiness: exportReadiness,
      packageCount: exportArtifacts.packageCount,
      totalByteLength: exportArtifacts.totalByteLength,
      summary: reportSummary
    },
    proof: {
      digest: [exportProofSeed, reportState, exportArtifacts.manifest.map((artifact) => artifact.shaLikeDigest).join('|')].join('#'),
      sourceDigest: sync.proofDigest
    }
  };
}

export function describeProcessSnapshotSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const inputProcessTable = (Array.isArray(input.processes) ? input.processes : [])
    .map((process, index) => normalizeProcess(process, index, now));
  const processIdentity = reconcileProcessSnapshotIdentity(inputProcessTable, now);
  const rawProcessTable = processIdentity.processTable;
  const accessContext = normalizeAccessContext(input, now);
  const accessBoundary = buildAccessBoundary(accessContext, rawProcessTable, now);
  const processTable = accessBoundary.mode === 'audit-only'
    ? rawProcessTable
    : rawProcessTable.filter((process) => accessBoundary.visibleProcessIds.includes(process.pid));
  const processTopology = buildProcessTopology(processTable, accessBoundary, now);
  const providerContract = normalizeProvider(input, now);
  const clientRuntime = normalizeClientRuntime(input, now, processTable);
  const sync = buildSyncMetadata(input, now, processTable, processIdentity);
  const providerSync = buildProviderSyncEnvelope(providerContract, sync, clientRuntime, processTable, accessBoundary);
  const lifecycleSettings = normalizeLifecycleSettings(input, providerContract, accessBoundary, processTable, sync, now);
  const handoff = buildExternalHandoff(
    { ...input, includeExternalHandoff: clientRuntime.includeExternalHandoff },
    providerContract,
    providerSync,
    sync,
    processTable,
    accessBoundary,
    lifecycleSettings
  );
  const validation = {
    ok: providerContract.accepted && lifecycleSettings.valid && handoff.state === 'ready',
    errors: normalizeStringList([
      ...providerContract.negotiation.missing.map((capability) => `missing-capability:${capability}`),
      ...providerContract.serviceContract.errors.map((error) => `service-contract:${error}`),
      ...providerSync.blockedReasons.map((reason) => `provider-sync:${reason}`),
      ...lifecycleSettings.errors.map((error) => `lifecycle-settings:${error}`),
      ...processTopology.errors.map((error) => `process-topology:${error}`),
      ...handoff.blockedReasons.map((reason) => `handoff:${reason}`)
    ]),
    warnings: normalizeStringList([
      ...providerContract.serviceContract.warnings.map((warning) => `service-contract:${warning}`),
      ...lifecycleSettings.warnings.map((warning) => `lifecycle-settings:${warning}`),
      ...processTopology.warnings.map((warning) => `process-topology:${warning}`),
      ...(accessBoundary.withheldCount > 0
        ? [`tenant boundary withheld ${accessBoundary.withheldCount} process records`]
        : []),
      ...(accessBoundary.scopedPermissions.invalidCount > 0
        ? [`ignored ${accessBoundary.scopedPermissions.invalidCount} invalid scoped permission grants`]
        : []),
      ...processIdentity.conflicts.map((conflict) => `reconciled duplicate process identity:${conflict.pid}`),
      ...(processTable.length === 0 ? ['snapshot contains no process records'] : []),
      ...clientRuntime.invalidProcessIds.map((pid) => `client requested unknown process:${pid}`),
      ...(clientRuntime.focusProcessId ? [] : ['client focus process was not resolved'])
    ])
  };
  const acceptanceInput = {
    ...input,
    now,
    acceptance: {
      ...asObject(input.acceptance),
      processIds: Array.isArray(asObject(input.acceptance).processIds)
        ? asObject(input.acceptance).processIds
        : clientRuntime.selectedProcessIds
    }
  };
  const acceptance = normalizeAcceptance(acceptanceInput, handoff, processTable);
  const providerDelivery = normalizeProviderDeliveryContract(
    input,
    providerContract,
    providerSync,
    handoff,
    acceptance,
    lifecycleSettings,
    sync,
    clientRuntime,
    processTable,
    now
  );
  const providerCommandHandoff = normalizeProviderCommandHandoff(
    input,
    providerContract,
    providerDelivery,
    lifecycleSettings,
    handoff,
    acceptance,
    sync,
    clientRuntime,
    processTable,
    now
  );
  validation.errors = normalizeStringList([
    ...validation.errors,
    ...providerCommandHandoff.blockedReasons.map((reason) => `provider-command-handoff:${reason}`)
  ]);
  validation.warnings = normalizeStringList([
    ...validation.warnings,
    ...providerDelivery.warnings.map((warning) => `provider-delivery:${warning}`),
    ...providerCommandHandoff.warnings.map((warning) => `provider-command-handoff:${warning}`)
  ]);
  const persistedState = normalizePersistedSnapshot(input, now, processTable, sync, clientRuntime, accessBoundary);
  const recovery = buildRecoveryPlan(persistedState, sync, handoff, acceptance, processTable);
  const restartCommandJournal = buildRestartCommandJournal(
    persistedState,
    recovery,
    lifecycleSettings,
    providerCommandHandoff,
    providerDelivery,
    sync,
    now
  );
  const workflowHandoff = buildWorkflowHandoff(clientRuntime, sync, handoff, acceptance, processTable);
  const operationalHealth = buildOperationalHealth(
    input,
    validation,
    handoff,
    acceptance,
    persistedState,
    recovery,
    processTable,
    accessBoundary,
    providerContract,
    providerDelivery,
    providerCommandHandoff
  );
  const preview = {
    title: 'Hosted kernel process snapshot',
    subtitle: `${processTable.length} processes captured from ${providerContract.service}`,
    focusProcessId: clientRuntime.focusProcessId,
    workflowAction: workflowHandoff.action,
    healthState: operationalHealth.state,
    degradedMode: operationalHealth.degradedMode,
    rows: buildPreviewRows(processTable, handoff, acceptance)
  };
  const readiness = buildReadiness(sync, providerSync, handoff, acceptance, validation, accessBoundary, providerContract, lifecycleSettings, providerDelivery, providerCommandHandoff, processTopology);
  const validationSummary = buildValidationSummary(validation, handoff, acceptance, processTable);
  const nextSteps = buildNextSteps(readiness, handoff, acceptance, operationalHealth, lifecycleSettings, providerDelivery, providerCommandHandoff);
  const clientActionContract = buildClientPreviewAcceptanceContract(
    clientRuntime,
    sync,
    preview,
    handoff,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
    operationalHealth,
    providerDelivery,
    providerCommandHandoff
  );
  const analytics = buildProcessSnapshotAnalytics(input, {
    now,
    processTable,
    processIdentity,
    accessBoundary,
    providerSync,
    persistedState,
    recovery,
    handoff,
    workflowHandoff,
    operationalHealth,
    acceptance,
    readiness,
    validationSummary,
    sync,
    providerContract,
    clientRuntime,
    lifecycleSettings,
    providerDelivery,
    providerCommandHandoff,
    restartCommandJournal,
    processTopology
  });
  const serializedSnapshot = buildSerializedProcessSnapshot({
    input,
    now,
    processTable,
    processIdentity,
    accessBoundary,
    sync,
    providerContract,
    providerSync,
    persistedState,
    recovery,
    restartCommandJournal,
    handoff,
    acceptance,
    providerDelivery,
    providerCommandHandoff,
    workflowHandoff,
    operationalHealth,
    readiness,
    validationSummary,
    clientRuntime,
    processTopology
  });

  return {
    ok: validation.errors.length === 0 && readiness.state === 'ready' && operationalHealth.state === 'healthy',
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    contract: providerContract,
    accessBoundary,
    sync,
    providerSync,
    lifecycleSettings,
    persistedState,
    recovery,
    restartCommandJournal,
    clientRuntime,
    processTable,
    processIdentity,
    processTopology,
    handoff,
    workflowHandoff,
    providerDelivery,
    providerCommandHandoff,
    operationalHealth,
    preview,
    acceptance,
    readiness,
    validation,
    validationSummary,
    nextSteps,
    clientActionContract,
    analytics,
    serializedSnapshot,
    audit: {
      evidenceType: 'kernel-process-snapshot-proof',
      providerAccepted: providerContract.accepted,
      capabilityGaps: providerContract.negotiation.missing,
      providerProtocolVersion: providerContract.serviceContract.protocolVersion,
      providerSyncMode: providerContract.serviceContract.syncMode,
      providerSyncCompatible: providerSync.compatible,
      providerSyncDigest: providerSync.proof.digest,
      providerSyncBlockedReasons: providerSync.blockedReasons,
      providerDeliveryState: providerDelivery.externalState,
      providerDeliveryValid: providerDelivery.valid,
      providerDeliveryRecordCount: providerDelivery.recordCount,
      providerDeliveryAckState: providerDelivery.acknowledgement.state,
      providerDeliveryAckDigestMatches: providerDelivery.acknowledgement.digestMatches,
      providerDeliveryDigest: providerDelivery.proof.digest,
      providerCommandHandoffState: providerCommandHandoff.state,
      providerCommandHandoffDispatchable: providerCommandHandoff.dispatchable,
      providerCommandHandoffMode: providerCommandHandoff.dispatchMode,
      providerCommandHandoffCommandCount: providerCommandHandoff.commandCount,
      providerCommandHandoffBlockedReasonCount: providerCommandHandoff.blockedReasons.length,
      providerCommandHandoffDigest: providerCommandHandoff.proof.digest,
      lifecycleSettingsValid: lifecycleSettings.valid,
      lifecycleScheduleMode: lifecycleSettings.schedule.mode,
      lifecycleCommandCount: lifecycleSettings.commandCount,
      lifecycleNextAction: lifecycleSettings.nextAction,
      lifecycleDispatchState: lifecycleSettings.dispatch.state,
      lifecycleExecutableControlCount: lifecycleSettings.dispatch.counts.executable,
      lifecycleScheduledControlCount: lifecycleSettings.dispatch.counts.schedulable,
      lifecycleBlockedControlCount: lifecycleSettings.dispatch.counts.blocked,
      lifecycleDisabledControlCount: lifecycleSettings.dispatch.counts.disabled,
      lifecycleDigest: lifecycleSettings.proof.digest,
      processTopologyValid: processTopology.valid,
      processTopologyRootCount: processTopology.rootProcessIds.length,
      processTopologyDuplicateCount: processIdentity.duplicateProcessIds.length,
      processIdentityInputCount: processIdentity.inputCount,
      processIdentityCanonicalCount: processIdentity.processCount,
      processIdentityDuplicateCount: processIdentity.duplicateCount,
      processIdentityRepaired: processIdentity.repaired,
      processIdentityDigest: processIdentity.proof.digest,
      processTopologyOrphanParentCount: processTopology.orphanParentRefs.length,
      processTopologyWithheldParentCount: processTopology.withheldParentRefs.length,
      processTopologyCycleCount: processTopology.cycleProcessIds.length,
      processTopologyDigest: processTopology.proof.digest,
      handoffLeaseState: handoff.lease.state,
      handoffLeaseTtlMs: handoff.lease.ttlMs,
      digest: sync.proofDigest,
      accessDigest: accessBoundary.proof.digest,
      clientRequestId: clientRuntime.requestId,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      boundaryMode: accessBoundary.mode,
      withheldProcessCount: accessBoundary.withheldCount,
      scopedPermissionGrantCount: accessBoundary.scopedPermissions.validCount,
      invalidScopedPermissionGrantCount: accessBoundary.scopedPermissions.invalidCount,
      appliedScopedPermissionProcessCount: accessBoundary.scopedPermissions.applied.length,
      workflowAction: workflowHandoff.action,
      workflowState: workflowHandoff.state,
      workflowClientMode: workflowHandoff.clientWorkflowMode,
      workflowResumeStrategy: workflowHandoff.resumeStrategy,
      workflowResumeRoute: workflowHandoff.clientResume.route,
      workflowClientBlockedReasonCount: workflowHandoff.clientBlockedReasons.length,
      workflowReviewEnabled: workflowHandoff.clientControls.review.enabled,
      workflowAcceptEnabled: workflowHandoff.clientControls.accept.enabled,
      workflowCommitEnabled: workflowHandoff.clientControls.commit.enabled,
      workflowDigest: workflowHandoff.proof.digest,
      acceptanceState: acceptance.state,
      persistedStateStatus: persistedState.status,
      persistedStateRestartStatus: persistedState.storage.restartStatus,
      persistedStateStoreKey: persistedState.storage.storeKey,
      persistedStateRevision: persistedState.storage.revision,
      persistedStateShouldPersist: persistedState.storage.shouldPersist,
      persistedStateLeaseExpired: persistedState.storage.leaseExpired,
      persistedStateBoundaryState: persistedState.boundaryOwnership.state,
      persistedStateBoundaryBlocked: persistedState.boundaryOwnership.blocked,
      persistedStateBoundaryBlockedReasonCount: persistedState.boundaryOwnership.blockedReasons.length,
      persistedStateBoundaryWarningCount: persistedState.boundaryOwnership.warnings.length,
      persistedStateBoundaryDigest: persistedState.boundaryOwnership.proof.digest,
      persistedStateReplayRequiredCount: persistedState.drift.replayRequiredProcessIds.length,
      persistedStateRestoredProcessCount: persistedState.restoreIndex.restoredProcessIds.length,
      recoveryStatus: recovery.status,
      idempotencyKey: persistedState.idempotencyKey,
      recoveryCommandCount: recovery.commandCount,
      restartCommandJournalState: restartCommandJournal.state,
      restartCommandJournalSafe: restartCommandJournal.restartSafe,
      restartCommandJournalCommandCount: restartCommandJournal.counts.total,
      restartCommandJournalDispatchableCount: restartCommandJournal.counts.dispatchable,
      restartCommandJournalBlockedCount: restartCommandJournal.counts.blocked,
      restartCommandJournalWaitingAckCount: restartCommandJournal.counts.waitingAck,
      restartCommandJournalDigest: restartCommandJournal.proof.digest,
      readinessState: readiness.state,
      previewAcceptanceContractVersion: clientActionContract.contractVersion,
      previewAcceptanceCanAccept: clientActionContract.acceptanceControl.canAccept,
      previewAcceptanceSelectableCount: clientActionContract.acceptanceControl.selectableProcessIds.length,
      previewAcceptanceDisabledReasonCount: clientActionContract.acceptanceControl.submitDisabledReasons.length,
      previewAcceptancePrimaryAction: clientActionContract.primaryAction.id,
      previewAcceptanceDigest: clientActionContract.proof.digest,
      healthState: operationalHealth.state,
      degradedMode: operationalHealth.degradedMode,
      failureCount: operationalHealth.failureCount,
      retryable: operationalHealth.retryPolicy.retryable,
      nextRetryDelayMs: operationalHealth.retryPolicy.nextDelayMs,
      recommendedAction: nextSteps.recommendedAction,
      analyticsReportId: analytics.reportId,
      analyticsDigest: analytics.proof.digest,
      analyticsReportState: analytics.reportState.state,
      analyticsReportAudience: analytics.reportState.audience,
      analyticsReportDestination: analytics.reportState.destination,
      analyticsReportPublishable: analytics.reportState.publishable,
      analyticsReportBlockedReasonCount: analytics.reportState.blockedReasons.length,
      analyticsExportRowCount: analytics.exports.rowCount,
      analyticsExportSourceRowCount: analytics.exports.sourceRowCount,
      analyticsExportFormats: analytics.exports.formats,
      analyticsExportPackageCount: analytics.exports.packageCount,
      analyticsExportTotalByteLength: analytics.exports.totalByteLength,
      analyticsHistoryDepth: analytics.history.length,
      analyticsHistoryRegressionSignalCount: analytics.reportingCounters.historyRegressionSignalCount,
      analyticsHistoryCleanRun: analytics.historyRollup.reliability.cleanRun,
      analyticsProcessTrend: analytics.trends.processTrend,
      analyticsTransferableTrend: analytics.trends.transferableTrend,
      analyticsExportReady: analytics.exports.readiness.ready,
      analyticsExportReadyFormatCount: analytics.reportingCounters.exportReadyFormatCount,
      analyticsExportBlockedFormatCount: analytics.reportingCounters.exportBlockedFormatCount,
      analyticsExportBlockedReasonCount: analytics.reportingCounters.exportBlockedReasonCount,
      analyticsTimelineEventCount: analytics.timeline.length,
      analyticsTimelineBlockedEventCount: analytics.timelineSummary.blockedEventIds.length,
      serializedSnapshotVersion: serializedSnapshot.serializationVersion,
      serializedSnapshotMediaType: serializedSnapshot.mediaType,
      serializedSnapshotByteLength: serializedSnapshot.byteLength,
      serializedSnapshotDigest: serializedSnapshot.proof.digest,
      serializedSnapshotReplayCursor: serializedSnapshot.cursors.replay,
      serializedSnapshotRecoveryCursor: serializedSnapshot.cursors.recovery,
      serializedSnapshotExternalHandoffCursor: serializedSnapshot.cursors.externalHandoff,
      serializedSnapshotProviderContractCompatible: serializedSnapshot.payload.sections.providerContract.compatible,
      serializedSnapshotProviderContractBlockedReasonCount: serializedSnapshot.payload.sections.providerContract.blockedReasons.length,
      serializedSnapshotClientWorkflowState: serializedSnapshot.payload.sections.clientWorkflow.workflowState,
      serializedSnapshotClientWorkflowAction: serializedSnapshot.payload.sections.clientWorkflow.workflowAction,
      serializedSnapshotClientWorkflowTicketId: serializedSnapshot.payload.sections.clientWorkflow.handoffTicket.ticketId,
      serializedSnapshotClientWorkflowValid: serializedSnapshot.payload.sections.clientWorkflow.valid,
      serializedSnapshotClientWorkflowBlockedReasonCount: serializedSnapshot.payload.sections.clientWorkflow.blockedReasons.length,
      serializedSnapshotClientWorkflowResumeRoute: serializedSnapshot.payload.sections.clientWorkflow.resume.route,
      serializedSnapshotWithheldProcessCount: serializedSnapshot.redaction.withheldProcessCount,
      serializedSnapshotImportable: serializedSnapshot.importPlan.importable,
      serializedSnapshotImportBlockedReasonCount: serializedSnapshot.importPlan.blockedReasons.length,
      serializedSnapshotClientWorkflowImportValid: serializedSnapshot.importPlan.clientWorkflowValidation.valid,
      serializedSnapshotImportCommandCount: serializedSnapshot.importPlan.importCommands.length,
      serializedSnapshotHealthState: serializedSnapshot.serializationHealth.state,
      serializedSnapshotExportMode: serializedSnapshot.serializationHealth.exportMode,
      serializedSnapshotPayloadByteLimit: serializedSnapshot.serializationHealth.payloadBytes.max,
      serializedSnapshotPayloadByteUtilization: serializedSnapshot.serializationHealth.payloadBytes.utilization,
      serializedSnapshotPayloadNearLimit: serializedSnapshot.serializationHealth.payloadBytes.nearLimit,
      serializedSnapshotPayloadOversized: serializedSnapshot.serializationHealth.payloadBytes.oversized,
      serializedSnapshotRetryable: serializedSnapshot.serializationHealth.retryPolicy.retryable,
      serializedSnapshotNextRetryDelayMs: serializedSnapshot.serializationHealth.retryPolicy.nextDelayMs,
      serializedSnapshotActionableErrorCount: serializedSnapshot.serializationHealth.actionableErrors.length,
      serializedSnapshotOperatorActions: serializedSnapshot.serializationHealth.operatorActions,
      serializedSnapshotHealthDigest: serializedSnapshot.serializationHealth.proof.digest
    },
    evidence: [
      ...(Array.isArray(input.evidence) ? input.evidence : []),
      {
        type: 'process-snapshot-contract',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        providerId: providerContract.providerId,
        protocolVersion: providerContract.serviceContract.protocolVersion,
        syncMode: providerContract.serviceContract.syncMode,
        compatible: providerContract.accepted,
        digest: sync.proofDigest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-provider-sync',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        providerId: providerSync.providerId,
        service: providerSync.service,
        protocolVersion: providerSync.protocolVersion,
        syncMode: providerSync.syncMode,
        checkpoint: providerSync.checkpoint,
        transferableCount: providerSync.batch.transferableCount,
        overflowProcessIds: providerSync.batch.overflowProcessIds,
        controlPlan: providerSync.controlPlan,
        compatible: providerSync.compatible,
        blockedReasons: providerSync.blockedReasons,
        digest: providerSync.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-provider-delivery-contract',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        providerId: providerDelivery.providerId,
        protocolVersion: providerDelivery.protocolVersion,
        deliveryGuarantee: providerDelivery.deliveryGuarantee,
        externalState: providerDelivery.externalState,
        outboundChannel: providerDelivery.outbound.channel,
        ackChannel: providerDelivery.acknowledgement.channel,
        ackState: providerDelivery.acknowledgement.state,
        ackDigestMatches: providerDelivery.acknowledgement.digestMatches,
        recordCount: providerDelivery.recordCount,
        commitRequested: providerDelivery.commitRequested,
        errors: providerDelivery.errors,
        warnings: providerDelivery.warnings,
        digest: providerDelivery.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-provider-command-handoff',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        contractVersion: providerCommandHandoff.contractVersion,
        providerId: providerCommandHandoff.providerId,
        dispatchMode: providerCommandHandoff.dispatchMode,
        state: providerCommandHandoff.state,
        dispatchable: providerCommandHandoff.dispatchable,
        outboundChannel: providerCommandHandoff.outboundChannel,
        acknowledgementChannel: providerCommandHandoff.acknowledgementChannel,
        ackState: providerCommandHandoff.ackState,
        commandCount: providerCommandHandoff.commandCount,
        lifecycleCommandCount: providerCommandHandoff.lifecycleCommandCount,
        commitCommandCount: providerCommandHandoff.commitCommandCount,
        commandIds: providerCommandHandoff.commands.map((command) => command.id),
        blockedReasons: providerCommandHandoff.blockedReasons,
        warnings: providerCommandHandoff.warnings,
        digest: providerCommandHandoff.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-process-topology',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        valid: processTopology.valid,
        processCount: processTopology.processCount,
        rootProcessIds: processTopology.rootProcessIds,
        duplicateProcessIds: processTopology.duplicateProcessIds,
        orphanParentRefs: processTopology.orphanParentRefs,
        withheldParentRefs: processTopology.withheldParentRefs,
        cycleProcessIds: processTopology.cycleProcessIds,
        errors: processTopology.errors,
        warnings: processTopology.warnings,
        digest: processTopology.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-process-identity-reconciliation',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        valid: processIdentity.valid,
        repaired: processIdentity.repaired,
        inputProcessCount: processIdentity.inputCount,
        canonicalProcessCount: processIdentity.processCount,
        duplicateProcessCount: processIdentity.duplicateCount,
        duplicateProcessIds: processIdentity.duplicateProcessIds,
        conflicts: processIdentity.conflicts,
        digest: processIdentity.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-lifecycle-command-plan',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        valid: lifecycleSettings.valid,
        enabled: lifecycleSettings.enabled,
        scheduleMode: lifecycleSettings.schedule.mode,
        dispatchState: lifecycleSettings.dispatch.state,
        executableControlIds: lifecycleSettings.dispatch.executableControlIds,
        scheduledControlIds: lifecycleSettings.dispatch.scheduledControlIds,
        blockedControlIds: lifecycleSettings.dispatch.blockedControlIds,
        disabledControlIds: lifecycleSettings.dispatch.disabledControlIds,
        nextRunAt: lifecycleSettings.dispatch.nextRunAt,
        routeIntents: lifecycleSettings.dispatch.routeIntents,
        commandCount: lifecycleSettings.commandCount,
        nextAction: lifecycleSettings.nextAction,
        errors: lifecycleSettings.errors,
        warnings: lifecycleSettings.warnings,
        commandTypes: lifecycleSettings.commands.map((command) => command.type),
        digest: lifecycleSettings.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-tenant-boundary',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        tenantId: accessBoundary.tenantId,
        workspaceId: accessBoundary.workspaceId,
        mode: accessBoundary.mode,
        visibleCount: accessBoundary.visibleCount,
        withheldCount: accessBoundary.withheldCount,
        scopedPermissionGrantCount: accessBoundary.scopedPermissions.validCount,
        invalidScopedPermissionGrantCount: accessBoundary.scopedPermissions.invalidCount,
        appliedScopedPermissions: accessBoundary.scopedPermissions.applied,
        digest: accessBoundary.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-preview-acceptance',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        contractVersion: clientActionContract.contractVersion,
        readinessState: readiness.state,
        acceptanceState: acceptance.state,
        canAccept: clientActionContract.acceptanceControl.canAccept,
        canReject: clientActionContract.acceptanceControl.canReject,
        selectableProcessIds: clientActionContract.acceptanceControl.selectableProcessIds,
        selectedProcessIds: clientActionContract.acceptanceControl.selectedProcessIds,
        submitDisabledReasons: clientActionContract.acceptanceControl.submitDisabledReasons,
        primaryAction: clientActionContract.primaryAction,
        routeHandlers: clientActionContract.routeHandlers,
        commitToken: acceptance.commitToken,
        digest: clientActionContract.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-persisted-state',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        status: persistedState.status,
        idempotencyKey: persistedState.idempotencyKey,
        storeKey: persistedState.storage.storeKey,
        partitionKey: persistedState.storage.partitionKey,
        revision: persistedState.storage.revision,
        previousRevision: persistedState.storage.previousRevision,
        compareAndSwapToken: persistedState.storage.compareAndSwapToken,
        writeMode: persistedState.storage.mode,
        shouldPersist: persistedState.storage.shouldPersist,
        leaseExpired: persistedState.storage.leaseExpired,
        restartStatus: persistedState.storage.restartStatus,
        boundaryOwnership: persistedState.boundaryOwnership,
        restoredProcessIds: persistedState.restoreIndex.restoredProcessIds,
        replayRequiredProcessIds: persistedState.restoreIndex.replayRequiredProcessIds,
        restoreRecords: persistedState.restoreIndex.records,
        digest: persistedState.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-persisted-boundary-ownership',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        state: persistedState.boundaryOwnership.state,
        expected: persistedState.boundaryOwnership.expected,
        recorded: persistedState.boundaryOwnership.recorded,
        privileges: persistedState.boundaryOwnership.privileges,
        blocked: persistedState.boundaryOwnership.blocked,
        blockedReasons: persistedState.boundaryOwnership.blockedReasons,
        warnings: persistedState.boundaryOwnership.warnings,
        quarantineKey: persistedState.boundaryOwnership.handoff.quarantineKey,
        digest: persistedState.boundaryOwnership.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-recovery-plan',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        status: recovery.status,
        commandCount: recovery.commandCount,
        commandIds: recovery.commands.map((command) => command.id),
        suppressedCommandIds: recovery.suppressedCommands.map((command) => command.id),
        digest: recovery.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-restart-command-journal',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        state: restartCommandJournal.state,
        restartSafe: restartCommandJournal.restartSafe,
        cursor: restartCommandJournal.cursor,
        commandCount: restartCommandJournal.counts.total,
        dispatchableCommandIds: restartCommandJournal.dispatchableCommandIds,
        blockedCommandIds: restartCommandJournal.blockedCommandIds,
        suppressedCommandIds: restartCommandJournal.suppressedCommandIds,
        nextAction: restartCommandJournal.nextAction,
        digest: restartCommandJournal.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-client-workflow-handoff',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        requestId: clientRuntime.requestId,
        kernelSessionId: clientRuntime.kernelSessionId,
        action: workflowHandoff.action,
        state: workflowHandoff.state,
        clientWorkflowMode: workflowHandoff.clientWorkflowMode,
        resumeStrategy: workflowHandoff.resumeStrategy,
        resumeRoute: workflowHandoff.clientResume.route,
        resumeProcessId: workflowHandoff.clientResume.processId,
        notificationTopic: workflowHandoff.clientResume.notificationTopic,
        clientControls: workflowHandoff.clientControls,
        clientBlockedReasons: workflowHandoff.clientBlockedReasons,
        digest: workflowHandoff.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-operational-health',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        state: operationalHealth.state,
        degradedMode: operationalHealth.degradedMode,
        failureCount: operationalHealth.failureCount,
        retryable: operationalHealth.retryPolicy.retryable,
        nextRetryDelayMs: operationalHealth.retryPolicy.nextDelayMs,
        actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
        digest: operationalHealth.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-analytics-export',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        reportId: analytics.reportId,
        checkpoint: sync.checkpoint,
        processCount: analytics.counters.processes.total,
        transferableCount: analytics.counters.processes.transferable,
        reportState: analytics.reportState.state,
        reportAudience: analytics.reportState.audience,
        reportDestination: analytics.reportState.destination,
        publishable: analytics.reportState.publishable,
        blockedReasons: analytics.reportState.blockedReasons,
        exportFormats: analytics.exports.formats,
        exportRowCount: analytics.exports.rowCount,
        sourceRowCount: analytics.exports.sourceRowCount,
        exportPackageCount: analytics.exports.packageCount,
        exportTotalByteLength: analytics.exports.totalByteLength,
        exportManifest: analytics.exports.manifest,
        exportReadiness: analytics.exports.readiness,
        historyDepth: analytics.history.length,
        historyRollup: analytics.historyRollup,
        reportingCounters: analytics.reportingCounters,
        trends: analytics.trends,
        timelineEventCount: analytics.timeline.length,
        timelineBlockedEventIds: analytics.timelineSummary.blockedEventIds,
        digest: analytics.proof.digest,
        generatedAt: now
      },
      {
        type: 'process-snapshot-serialized-envelope',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        serializationVersion: serializedSnapshot.serializationVersion,
        mediaType: serializedSnapshot.mediaType,
        snapshotId: serializedSnapshot.snapshotId,
        checkpoint: serializedSnapshot.checkpoint,
        byteLength: serializedSnapshot.byteLength,
        replayCursor: serializedSnapshot.cursors.replay,
        recoveryCursor: serializedSnapshot.cursors.recovery,
        providerAckCursor: serializedSnapshot.cursors.providerAck,
        commandJournalCursor: serializedSnapshot.cursors.commandJournal,
        externalHandoffCursor: serializedSnapshot.cursors.externalHandoff,
        providerContractCompatible: serializedSnapshot.payload.sections.providerContract.compatible,
        providerContractBlockedReasons: serializedSnapshot.payload.sections.providerContract.blockedReasons,
        providerContractWarnings: serializedSnapshot.payload.sections.providerContract.warnings,
        visibleProcessCount: serializedSnapshot.redaction.visibleProcessCount,
        withheldProcessCount: serializedSnapshot.redaction.withheldProcessCount,
        withheldProcessIds: serializedSnapshot.redaction.withheldProcessIds,
        importable: serializedSnapshot.importPlan.importable,
        importCommands: serializedSnapshot.importPlan.importCommands,
        importBlockedReasons: serializedSnapshot.importPlan.blockedReasons,
        importWarnings: serializedSnapshot.importPlan.warnings,
        healthState: serializedSnapshot.serializationHealth.state,
        exportMode: serializedSnapshot.serializationHealth.exportMode,
        payloadBytes: serializedSnapshot.serializationHealth.payloadBytes,
        retryPolicy: serializedSnapshot.serializationHealth.retryPolicy,
        actionableErrors: serializedSnapshot.serializationHealth.actionableErrors,
        operatorActions: serializedSnapshot.serializationHealth.operatorActions,
        proofSections: serializedSnapshot.proof.sections,
        healthDigest: serializedSnapshot.serializationHealth.proof.digest,
        digest: serializedSnapshot.proof.digest,
        payloadPreview: serializedSnapshot.payloadPreview,
        generatedAt: now
      },
      {
        type: 'process-snapshot-serialized-client-workflow',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        serializationVersion: serializedSnapshot.serializationVersion,
        requestId: serializedSnapshot.payload.sections.clientWorkflow.requestId,
        kernelSessionId: serializedSnapshot.payload.sections.clientWorkflow.kernelSessionId,
        clientSurface: serializedSnapshot.payload.sections.clientWorkflow.clientSurface,
        clientRoute: serializedSnapshot.payload.sections.clientWorkflow.clientRoute,
        workflowState: serializedSnapshot.payload.sections.clientWorkflow.workflowState,
        workflowAction: serializedSnapshot.payload.sections.clientWorkflow.workflowAction,
        workflowMode: serializedSnapshot.payload.sections.clientWorkflow.workflowMode,
        resumeStrategy: serializedSnapshot.payload.sections.clientWorkflow.resumeStrategy,
        ticketId: serializedSnapshot.payload.sections.clientWorkflow.handoffTicket.ticketId,
        ticketState: serializedSnapshot.payload.sections.clientWorkflow.handoffTicket.state,
        activeControlIds: serializedSnapshot.payload.sections.clientWorkflow.handoffTicket.activeControlIds,
        resumeRoute: serializedSnapshot.payload.sections.clientWorkflow.resume.route,
        resumeProcessId: serializedSnapshot.payload.sections.clientWorkflow.resume.processId,
        selectedProcessIds: serializedSnapshot.payload.sections.clientWorkflow.selectedProcessIds,
        acceptedProcessIds: serializedSnapshot.payload.sections.clientWorkflow.acceptedProcessIds,
        providerAckState: serializedSnapshot.payload.sections.clientWorkflow.providerAck.state,
        providerCommandState: serializedSnapshot.payload.sections.clientWorkflow.providerCommand.state,
        providerCommandCursor: serializedSnapshot.payload.sections.clientWorkflow.providerCommand.cursor,
        importBinding: serializedSnapshot.payload.sections.clientWorkflow.importBinding,
        importValidation: serializedSnapshot.importPlan.clientWorkflowValidation,
        blockedReasons: serializedSnapshot.payload.sections.clientWorkflow.blockedReasons,
        valid: serializedSnapshot.payload.sections.clientWorkflow.valid,
        digest: serializedSnapshot.payload.sections.clientWorkflow.proof.digest,
        generatedAt: now
      }
    ]
  };
}

export default describeProcessSnapshotSurface;
