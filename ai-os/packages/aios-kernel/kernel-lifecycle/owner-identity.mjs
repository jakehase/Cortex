export const surfaceId = "aios_kernel-lifecycle_owner-identity_005";
export const surfaceGroup = "kernel-lifecycle";
export const surfaceName = "owner-identity";

const lifecycleEventTypes = new Set([
  "owner.claimed",
  "owner.verified",
  "owner.transferred",
  "kernel.hosted",
  "kernel.suspended",
  "kernel.resumed",
  "kernel.retired"
]);

const terminalKernelStates = new Set(["suspended", "retired"]);
const lifecycleCommandTypes = new Set([
  "kernel.enable",
  "kernel.disable",
  "kernel.suspend",
  "kernel.resume",
  "kernel.retire",
  "owner.verify",
  "owner.transfer"
]);

const ownerIdentityCapabilities = new Set([
  "owner.claim.read",
  "owner.claim.write",
  "owner.verify.request",
  "kernel.lifecycle.read",
  "kernel.lifecycle.command",
  "kernel.lifecycle.handoff",
  "audit.proof.read"
]);

const providerAuthModes = new Set(["signed-webhook", "service-token", "mtls", "manual-review"]);
const providerDeliveryModes = new Set(["pull", "push", "bidirectional"]);
const providerHandoffModes = new Set(["manual-review", "automatic", "audit-only"]);
const providerRuntimeHealthStatuses = new Set(["healthy", "degraded", "down", "unknown"]);
const providerCircuitStates = new Set(["closed", "half-open", "open", "manual-review"]);
const authorizationSubjectTypes = new Set(["owner", "operator", "service", "provider", "system"]);
const mailchimpProviderCapabilities = new Set([
  "owner.claim.read",
  "kernel.lifecycle.read",
  "kernel.lifecycle.handoff",
  "audit.proof.read"
]);
const mailchimpRetryableFailureCodes = new Set([
  "mailchimp-rate-limited",
  "mailchimp-webhook-delayed",
  "mailchimp-sync-stale",
  "mailchimp-api-timeout",
  "provider-health-degraded"
]);

const lifecycleCommandPermissionByType = {
  "kernel.enable": "kernel.lifecycle.command",
  "kernel.disable": "kernel.lifecycle.command",
  "kernel.suspend": "kernel.lifecycle.command",
  "kernel.resume": "kernel.lifecycle.command",
  "kernel.retire": "kernel.lifecycle.command",
  "owner.verify": "owner.verify.request",
  "owner.transfer": "owner.claim.write"
};

const privilegedJobPermissionByType = {
  "owner.claim.sync": "owner.claim.write",
  "owner.claim.verify": "owner.verify.request",
  "kernel.lifecycle.apply": "kernel.lifecycle.command",
  "kernel.lifecycle.handoff": "kernel.lifecycle.handoff",
  "audit.proof.export": "audit.proof.read"
};

const ownerRolePermissions = {
  owner: [
    "owner.claim.read",
    "owner.claim.write",
    "owner.verify.request",
    "kernel.lifecycle.read",
    "kernel.lifecycle.command",
    "kernel.lifecycle.handoff",
    "audit.proof.read"
  ],
  operator: [
    "owner.claim.read",
    "kernel.lifecycle.read",
    "kernel.lifecycle.command",
    "kernel.lifecycle.handoff",
    "audit.proof.read"
  ],
  auditor: ["owner.claim.read", "kernel.lifecycle.read", "audit.proof.read"],
  viewer: ["owner.claim.read", "kernel.lifecycle.read"]
};

const lifecycleSettingDefaults = {
  lifecycleControlsEnabled: true,
  ownerVerificationRequired: true,
  allowUnverifiedOwnerHosting: false,
  scheduleWindowMinutes: 60,
  minScheduleLeadMinutes: 0,
  commandCooldownMinutes: 0,
  maxPendingCommands: 25,
  disableRequiresReason: true,
  allowRetireFromHosted: false
};
const maxPersistedRuntimeRecoveryAgeMinutes = 24 * 60;

function stableText(value, fallback = "unknown") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeTimestamp(value, fallback) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeOwnerClaim(claim = {}, index = 0, now, workspaceScope) {
  const ownerId = stableText(claim.ownerId || claim.id, `owner-${index + 1}`);
  const source = stableText(claim.source, "self-attested");
  const verifiedAt = claim.verifiedAt ? normalizeTimestamp(claim.verifiedAt, now) : null;
  const normalized = {
    ownerId,
    displayName: stableText(claim.displayName || claim.name, ownerId),
    source,
    verified: Boolean(claim.verified || verifiedAt),
    verifiedAt,
    tenantId: scopedText(claim.tenantId || claim.tenant, workspaceScope.tenantId),
    workspaceId: scopedText(claim.workspaceId || claim.workspace, workspaceScope.workspaceId),
    roles: normalizeRoleList(claim.roles || claim.role),
    permissions: normalizePermissionList(claim.permissions || claim.capabilities),
    proofRef: stableText(claim.proofRef || claim.proof, `${source}:${ownerId}`)
  };
  return {
    ...normalized,
    effectivePermissions: ownerPermissions(normalized)
  };
}

function normalizeLifecycleEvent(event = {}, index = 0, now, workspaceScope) {
  const type = stableText(event.type, "kernel.hosted");
  const acceptedType = lifecycleEventTypes.has(type) ? type : "kernel.hosted";
  const at = normalizeTimestamp(event.at || event.timestamp, now);
  const ownerId = stableText(event.ownerId || event.owner, "unassigned");
  return {
    eventId: stableText(event.eventId || event.id, `${acceptedType}:${ownerId}:${index + 1}`),
    type: acceptedType,
    at,
    ownerId,
    kernelId: stableText(event.kernelId || event.kernel, "hosted-kernel"),
    tenantId: scopedText(event.tenantId || event.tenant, workspaceScope.tenantId),
    workspaceId: scopedText(event.workspaceId || event.workspace, workspaceScope.workspaceId),
    actor: stableText(event.actor, ownerId),
    proofRef: stableText(event.proofRef || event.proof, `${acceptedType}:${ownerId}:${at}`)
  };
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function normalizeLifecycleSettings(settings = {}) {
  return {
    lifecycleControlsEnabled: normalizeBoolean(
      settings.lifecycleControlsEnabled ?? settings.enabled,
      lifecycleSettingDefaults.lifecycleControlsEnabled
    ),
    ownerVerificationRequired: normalizeBoolean(
      settings.ownerVerificationRequired,
      lifecycleSettingDefaults.ownerVerificationRequired
    ),
    allowUnverifiedOwnerHosting: normalizeBoolean(
      settings.allowUnverifiedOwnerHosting,
      lifecycleSettingDefaults.allowUnverifiedOwnerHosting
    ),
    scheduleWindowMinutes: normalizePositiveInteger(
      settings.scheduleWindowMinutes,
      lifecycleSettingDefaults.scheduleWindowMinutes,
      { min: 5, max: 10080 }
    ),
    minScheduleLeadMinutes: normalizePositiveInteger(
      settings.minScheduleLeadMinutes,
      lifecycleSettingDefaults.minScheduleLeadMinutes,
      { min: 0, max: 1440 }
    ),
    commandCooldownMinutes: normalizePositiveInteger(
      settings.commandCooldownMinutes,
      lifecycleSettingDefaults.commandCooldownMinutes,
      { min: 0, max: 1440 }
    ),
    maxPendingCommands: normalizePositiveInteger(
      settings.maxPendingCommands,
      lifecycleSettingDefaults.maxPendingCommands,
      { min: 1, max: 250 }
    ),
    disableRequiresReason: normalizeBoolean(
      settings.disableRequiresReason,
      lifecycleSettingDefaults.disableRequiresReason
    ),
    allowRetireFromHosted: normalizeBoolean(
      settings.allowRetireFromHosted,
      lifecycleSettingDefaults.allowRetireFromHosted
    )
  };
}

function recordHasExplicitAuthorizationSubject(record = {}) {
  return Boolean(
    record.authorizationSubject ||
    record.actorIdentity ||
    record.principal ||
    record.actorSubject ||
    record.actorId ||
    record.actor ||
    record.actorPermissions ||
    record.actorCapabilities ||
    record.authorizationProofRef ||
    record.actorProofRef
  );
}

function requestAuthorizationSubjectForRecord(record = {}, ownerId, clientRequestState) {
  if (recordHasExplicitAuthorizationSubject(record) || !clientRequestState?.actorIdentity) return record;
  const requestActor = clientRequestState.actorIdentity;
  if (!requestActor.actorId && !requestActor.ownerId) return record;
  return {
    ...record,
    actorId: requestActor.actorId,
    actor: requestActor.actorId,
    actorOwnerId: requestActor.ownerId || ownerId,
    actorType: requestActor.subjectType,
    actorRoles: requestActor.roles,
    actorPermissions: requestActor.permissions,
    authorizationProofRef: requestActor.proofRef || clientRequestState.proofRef,
    authorizationSource: "client-request",
    authorizationSubject: {
      ...requestActor,
      ownerId: requestActor.ownerId || ownerId,
      tenantId: requestActor.tenantId || clientRequestState.tenantId,
      workspaceId: requestActor.workspaceId || clientRequestState.workspaceId,
      proofRef: requestActor.proofRef || clientRequestState.proofRef,
      source: "client-request"
    }
  };
}

function requestAuthorizationAdoption(record = {}, authorizationSubject, clientRequestState) {
  const fromClientRequest = authorizationSubject.authorizationSource === "client-request";
  const explicitAuthorization = recordHasExplicitAuthorizationSubject(record);
  return {
    contractVersion: "hosted-kernel-owner-identity.request-authorization-adoption.v1",
    requestId: fromClientRequest ? clientRequestState.requestId : null,
    sessionId: fromClientRequest ? clientRequestState.sessionId : null,
    source: fromClientRequest
      ? "client-request"
      : explicitAuthorization
        ? "record-authorization"
        : "owner-fallback",
    adopted: fromClientRequest,
    actorId: authorizationSubject.actorId,
    actorOwnerId: authorizationSubject.ownerId,
    requestedCapabilities: fromClientRequest ? clientRequestState.requestedCapabilities : [],
    proofRef: fromClientRequest ? clientRequestState.proofRef : authorizationSubject.proofRef
  };
}

function normalizeLifecycleCommand(command = {}, index = 0, now, workspaceScope, clientRequestState = null) {
  const type = stableText(command.type, "kernel.enable");
  const acceptedType = lifecycleCommandTypes.has(type) ? type : "kernel.enable";
  const requestedAt = normalizeTimestamp(command.requestedAt || command.at, now);
  const scheduleAt = command.scheduleAt ? normalizeTimestamp(command.scheduleAt, requestedAt) : requestedAt;
  const ownerId = stableText(command.ownerId || command.owner, "unassigned");
  const targetOwnerId = stableText(
    command.targetOwnerId || command.newOwnerId || command.transferToOwnerId || command.targetOwner,
    ""
  );
  const authorizationInput = requestAuthorizationSubjectForRecord(command, ownerId, clientRequestState);
  const authorizationSubject = normalizeAuthorizationSubject(authorizationInput, ownerId, workspaceScope);
  return {
    commandId: stableText(command.commandId || command.id, `${acceptedType}:${ownerId}:${index + 1}`),
    type: acceptedType,
    requestedAt,
    scheduleAt,
    ownerId,
    targetOwnerId: acceptedType === "owner.transfer" ? targetOwnerId : null,
    kernelId: stableText(command.kernelId || command.kernel, "hosted-kernel"),
    tenantId: scopedText(command.tenantId || command.tenant, workspaceScope.tenantId),
    workspaceId: scopedText(command.workspaceId || command.workspace, workspaceScope.workspaceId),
    actor: authorizationSubject.actorId,
    actorIdentity: authorizationSubject,
    requestAuthorization: requestAuthorizationAdoption(command, authorizationSubject, clientRequestState),
    reason: stableText(command.reason, acceptedType),
    requiredPermission: lifecycleCommandPermissionByType[acceptedType] || "kernel.lifecycle.command",
    transferProofRef: acceptedType === "owner.transfer"
      ? stableText(command.transferProofRef || command.transferProof || command.acceptanceProofRef, `owner-transfer:${ownerId}:${targetOwnerId || "missing-target"}:${scheduleAt}`)
      : null,
    proofRef: stableText(command.proofRef || command.proof, `${acceptedType}:${ownerId}:${scheduleAt}`)
  };
}

function normalizePrivilegedJob(job = {}, index = 0, now, workspaceScope, clientRequestState = null) {
  const rawType = stableText(job.type || job.jobType || job.action, "kernel.lifecycle.apply");
  const ownerId = stableText(job.ownerId || job.owner || job.actorOwnerId, "unassigned");
  const requestedPermission = stableText(job.requiredPermission || job.permission || job.capability, "");
  const requiredPermission = ownerIdentityCapabilities.has(requestedPermission)
    ? requestedPermission
    : privilegedJobPermissionByType[rawType] || "kernel.lifecycle.command";
  const requestedAt = normalizeTimestamp(job.requestedAt || job.createdAt || job.at, now);
  const authorizationInput = requestAuthorizationSubjectForRecord(job, ownerId, clientRequestState);
  const authorizationSubject = normalizeAuthorizationSubject(authorizationInput, ownerId, workspaceScope);
  return {
    jobId: stableText(job.jobId || job.id, `privileged-job:${index + 1}`),
    type: rawType,
    requestedAt,
    ownerId,
    kernelId: stableText(job.kernelId || job.kernel, "hosted-kernel"),
    tenantId: scopedText(job.tenantId || job.tenant, workspaceScope.tenantId),
    workspaceId: scopedText(job.workspaceId || job.workspace, workspaceScope.workspaceId),
    actor: authorizationSubject.actorId,
    actorIdentity: authorizationSubject,
    requestAuthorization: requestAuthorizationAdoption(job, authorizationSubject, clientRequestState),
    requiredPermission,
    reason: stableText(job.reason || job.description, rawType),
    idempotencyKey: stableText(
      job.idempotencyKey || job.dedupeKey,
      `${rawType}:${ownerId}:${requestedAt}:${index + 1}`
    ),
    proofRef: stableText(job.proofRef || job.proof, `privileged-job:${rawType}:${ownerId}:${requestedAt}`)
  };
}

function normalizeStringList(values = []) {
  return Array.isArray(values)
    ? values.map((value) => stableText(value, "")).filter(Boolean)
    : [];
}

function normalizePermissionList(values = []) {
  return normalizeStringList(values).filter((value) => ownerIdentityCapabilities.has(value));
}

function normalizeRoleList(values = []) {
  const roles = normalizeStringList(Array.isArray(values) ? values : [values]);
  return roles.length ? roles : ["viewer"];
}

function normalizeAuthorizationSubject(command = {}, ownerId, workspaceScope) {
  const source = command.authorizationSubject || command.actorIdentity || command.principal || command.actorSubject || {};
  const hasObjectSource = source && typeof source === "object" && !Array.isArray(source);
  const subject = hasObjectSource ? source : {};
  const hasFlatActorSource = Boolean(command.actorId || command.actor || command.actorPermissions || command.actorCapabilities);
  const rawType = stableText(subject.type || subject.subjectType || command.actorType, "owner");
  const actorId = stableText(
    subject.actorId || subject.subjectId || subject.id || command.actorId || command.actor,
    ownerId
  );
  const delegatedOwnerId = stableText(
    subject.ownerId || subject.owner || command.actorOwnerId || command.delegatedOwnerId,
    ownerId
  );
  const roles = normalizeRoleList(subject.roles || subject.role || command.actorRoles || command.actorRole);
  const permissions = normalizePermissionList(
    subject.permissions || subject.capabilities || command.actorPermissions || command.actorCapabilities
  );
  const suppliedProofRef = stableText(
    subject.proofRef || subject.proof || command.actorProofRef || command.authorizationProofRef,
    ""
  );
  const normalized = {
    actorId,
    subjectType: authorizationSubjectTypes.has(rawType) ? rawType : "owner",
    ownerId: delegatedOwnerId,
    authorizationSource: stableText(
      subject.source || command.authorizationSource || command.actorSource,
      hasObjectSource || hasFlatActorSource ? "record-authorization" : "owner-fallback"
    ),
    displayName: stableText(subject.displayName || subject.name || command.actorDisplayName, actorId),
    tenantId: scopedText(subject.tenantId || subject.tenant || command.actorTenantId, workspaceScope.tenantId),
    workspaceId: scopedText(subject.workspaceId || subject.workspace || command.actorWorkspaceId, workspaceScope.workspaceId),
    roles,
    permissions,
    proofProvided: Boolean(suppliedProofRef),
    proofRef: suppliedProofRef || `authorization-subject:${actorId}:${delegatedOwnerId}`
  };
  return {
    ...normalized,
    delegated: normalized.actorId !== ownerId || normalized.ownerId !== ownerId,
    effectivePermissions: ownerPermissions(normalized)
  };
}

function normalizeWorkspaceScope(scope = {}, now) {
  const tenantId = stableText(scope.tenantId || scope.tenant || scope.organizationId, "tenant-default");
  const workspaceId = stableText(scope.workspaceId || scope.workspace || scope.projectId, "workspace-default");
  const allowedTenantIds = normalizeStringList(scope.allowedTenantIds || scope.tenants);
  const allowedWorkspaceIds = normalizeStringList(scope.allowedWorkspaceIds || scope.workspaces);
  return {
    tenantId,
    workspaceId,
    boundaryMode: scope.boundaryMode === "permissive" ? "permissive" : "strict",
    allowedTenantIds: allowedTenantIds.length ? allowedTenantIds : [tenantId],
    allowedWorkspaceIds: allowedWorkspaceIds.length ? allowedWorkspaceIds : [workspaceId],
    auditChannel: stableText(scope.auditChannel || scope.auditRoute, `${surfaceGroup}/${surfaceName}/audit-handoff`),
    proofRef: stableText(scope.proofRef || scope.proof, `workspace-scope:${tenantId}:${workspaceId}:${now}`)
  };
}

function scopedText(value, fallback) {
  return stableText(value, fallback);
}

function ownerPermissions(owner) {
  const expanded = new Set(owner.permissions);
  for (const role of owner.roles) {
    for (const permission of ownerRolePermissions[role] || []) {
      expanded.add(permission);
    }
  }
  return Array.from(expanded).sort();
}

function identityClaimSignature(owner) {
  return {
    displayName: owner.displayName,
    source: owner.source,
    tenantId: owner.tenantId,
    workspaceId: owner.workspaceId,
    verified: owner.verified,
    verifiedAt: owner.verifiedAt || "",
    roles: owner.roles.slice().sort(),
    permissions: owner.effectivePermissions.slice().sort(),
    proofRef: owner.proofRef
  };
}

function compareOwnerClaimIdentity(first, next) {
  const firstSignature = identityClaimSignature(first);
  const nextSignature = identityClaimSignature(next);
  const conflicts = [];
  for (const key of ["displayName", "source", "tenantId", "workspaceId", "verified", "verifiedAt", "proofRef"]) {
    if (firstSignature[key] !== nextSignature[key]) conflicts.push(`owner-claim-${key}-conflict`);
  }
  if (firstSignature.roles.join("|") !== nextSignature.roles.join("|")) {
    conflicts.push("owner-claim-role-conflict");
  }
  if (firstSignature.permissions.join("|") !== nextSignature.permissions.join("|")) {
    conflicts.push("owner-claim-permission-conflict");
  }
  return conflicts;
}

function buildOwnerIdentityRegistry(owners, workspaceScope, now) {
  const byOwnerId = new Map();
  const duplicateClaimGroups = [];
  const conflictingOwnerIds = new Set();
  const ownerBoundaryEvaluations = owners.map((owner) => evaluateWorkspaceBoundaryRecord({
    subjectType: "owner-claim",
    subjectId: owner.ownerId,
    tenantId: owner.tenantId,
    workspaceId: owner.workspaceId,
    workspaceScope,
    proofRef: owner.proofRef,
    tenantViolationCode: "owner-outside-workspace-boundary",
    workspaceViolationCode: "owner-outside-workspace-boundary"
  }));

  for (const owner of owners) {
    const group = byOwnerId.get(owner.ownerId) || [];
    group.push(owner);
    byOwnerId.set(owner.ownerId, group);
  }

  for (const [ownerId, claims] of byOwnerId.entries()) {
    if (claims.length < 2) continue;
    const canonical = claims[0];
    const conflictCodes = Array.from(new Set(
      claims.slice(1).flatMap((claim) => compareOwnerClaimIdentity(canonical, claim))
    )).sort();
    if (conflictCodes.length) conflictingOwnerIds.add(ownerId);
    duplicateClaimGroups.push({
      ownerId,
      claimCount: claims.length,
      status: conflictCodes.length ? "conflicting" : "duplicate-confirmed",
      conflictCodes,
      canonicalProofRef: canonical.proofRef,
      proofRefs: Array.from(new Set(claims.map((claim) => claim.proofRef))).sort(),
      tenantIds: Array.from(new Set(claims.map((claim) => claim.tenantId))).sort(),
      workspaceIds: Array.from(new Set(claims.map((claim) => claim.workspaceId))).sort(),
      verifiedClaims: claims.filter((claim) => claim.verified).length,
      displayNames: Array.from(new Set(claims.map((claim) => claim.displayName))).sort()
    });
  }

  const ownerMap = new Map();
  for (const owner of owners) {
    if (!ownerMap.has(owner.ownerId)) ownerMap.set(owner.ownerId, owner);
  }

  const verifiedOwnerIds = owners.filter((owner) => owner.verified).map((owner) => owner.ownerId);
  const ownerBoundaryViolations = ownerBoundaryEvaluations.flatMap((evaluation) =>
    evaluation.violations.map((violation) => ({
      ...violation,
      ownerId: evaluation.subjectId,
      code: "owner-outside-workspace-boundary",
      proofRef: evaluation.proofRef
    }))
  );
  const integrityErrors = [
    ...duplicateClaimGroups
      .filter((group) => group.status === "conflicting")
      .map((group) => ({
        scope: "owner-claim",
        code: "conflicting-owner-identity-claims",
        ownerId: group.ownerId,
        causeCodes: group.conflictCodes,
        proofRefs: group.proofRefs
      })),
    ...ownerBoundaryViolations.map((violation) => ({
      scope: "owner-claim",
      code: "owner-claim-outside-workspace-boundary",
      ownerId: violation.ownerId,
      causeCodes: [violation.code],
      proofRefs: [violation.proofRef]
    }))
  ];

  return {
    contractVersion: "hosted-kernel-owner-identity.registry.v1",
    generatedAt: now,
    status: integrityErrors.length ? "blocked" : duplicateClaimGroups.length ? "review" : "verified",
    ownerMap,
    conflictingOwnerIds,
    duplicateClaimGroups,
    ownerBoundaryEvaluations,
    ownerBoundaryViolations,
    verifiedOwnerIds: Array.from(new Set(verifiedOwnerIds)).sort(),
    ambiguousOwnerIds: Array.from(conflictingOwnerIds).sort(),
    integrityErrors,
    audit: {
      route: `${surfaceGroup}/${surfaceName}/owner-identity-registry`,
      proofRefs: Array.from(new Set(owners.map((owner) => owner.proofRef))).sort()
    }
  };
}

function serializeOwnerIdentityRegistry(registry) {
  return {
    contractVersion: registry.contractVersion,
    generatedAt: registry.generatedAt,
    status: registry.status,
    uniqueOwnerIds: Array.from(registry.ownerMap.keys()).sort(),
    verifiedOwnerIds: registry.verifiedOwnerIds,
    ambiguousOwnerIds: registry.ambiguousOwnerIds,
    duplicateClaimGroups: registry.duplicateClaimGroups,
    ownerBoundaryViolations: registry.ownerBoundaryViolations,
    integrityErrors: registry.integrityErrors,
    audit: registry.audit
  };
}

function normalizeProviderContract(provider = {}, index = 0, now, workspaceScope) {
  const providerId = stableText(provider.providerId || provider.id, `provider-${index + 1}`);
  const requestedCapabilities = normalizeStringList(
    provider.requestedCapabilities || provider.capabilities || provider.scopes
  );
  const authMode = stableText(provider.authMode || provider.authenticationMode || provider.auth, "manual-review");
  const deliveryMode = stableText(provider.deliveryMode || provider.syncMode || provider.transportMode, "pull");
  const handoffMode = stableText(provider.handoffMode || provider.mode, "manual-review");
  const syncIntervalMinutes = normalizePositiveInteger(
    provider.syncIntervalMinutes || provider.pollIntervalMinutes,
    15,
    { min: 1, max: 1440 }
  );
  return {
    providerId,
    displayName: stableText(provider.displayName || provider.name, providerId),
    contractVersion: stableText(provider.contractVersion || provider.version, "hosted-kernel-owner-provider.v1"),
    endpoint: stableText(provider.endpoint || provider.route, `${surfaceGroup}/${surfaceName}/providers/${providerId}`),
    callbackEndpoint: stableText(
      provider.callbackEndpoint || provider.callbackRoute || provider.webhookRoute,
      ""
    ),
    requestedCapabilities,
    requiredCapabilities: normalizeStringList(provider.requiredCapabilities),
    syncCursor: stableText(provider.syncCursor || provider.cursor, `${providerId}:${now}`),
    lastSyncedAt: provider.lastSyncedAt ? normalizeTimestamp(provider.lastSyncedAt, now) : null,
    authMode: providerAuthModes.has(authMode) ? authMode : "manual-review",
    deliveryMode: providerDeliveryModes.has(deliveryMode) ? deliveryMode : "pull",
    handoffMode: providerHandoffModes.has(handoffMode) ? handoffMode : "manual-review",
    syncIntervalMinutes,
    maxBatchSize: normalizePositiveInteger(
      provider.maxBatchSize || provider.batchSize,
      50,
      { min: 1, max: 500 }
    ),
    tenantId: scopedText(provider.tenantId || provider.tenant, workspaceScope.tenantId),
    workspaceId: scopedText(provider.workspaceId || provider.workspace, workspaceScope.workspaceId),
    proofRef: stableText(provider.proofRef || provider.proof, `provider-contract:${providerId}`)
  };
}

function isMailchimpOwnerProvider(provider) {
  return [
    provider.providerId,
    provider.displayName,
    provider.endpoint,
    provider.contractVersion,
    provider.proofRef
  ].some((value) => String(value || "").toLowerCase().includes("mailchimp"));
}

function buildMailchimpOwnerProviderProfile(provider) {
  if (!isMailchimpOwnerProvider(provider)) return null;
  const grantedCapabilitySet = new Set(provider.requestedCapabilities);
  const missingCapabilities = Array.from(mailchimpProviderCapabilities)
    .filter((capability) => !grantedCapabilitySet.has(capability));
  const webhookReady = provider.authMode === "signed-webhook" && Boolean(provider.callbackEndpoint);
  return {
    product: "mailchimp",
    accountRef: provider.providerId,
    requiredCapabilities: Array.from(mailchimpProviderCapabilities),
    missingCapabilities,
    webhookReady,
    callbackEndpoint: provider.callbackEndpoint || null,
    handoffMode: provider.handoffMode,
    syncCursor: provider.syncCursor,
    readiness: missingCapabilities.length
      ? "capability-negotiation-required"
      : !webhookReady
        ? "webhook-contract-required"
        : provider.handoffMode === "audit-only"
          ? "audit-only"
          : "handoff-ready",
    nextAction: missingCapabilities.length
      ? "negotiate-mailchimp-owner-provider-capabilities"
      : !webhookReady
        ? "configure-mailchimp-signed-webhook-callback"
        : provider.handoffMode === "audit-only"
          ? "enable-mailchimp-provider-handoff"
          : "monitor-mailchimp-provider-health"
  };
}

function buildMailchimpProviderAcknowledgementProfile(contract, now) {
  const commandCount = contract.externalHandoff.commandIds.length;
  const lease = contract.externalHandoff.lease || {};
  const leaseExpiresAt = lease.expiresAt || null;
  const leaseExpiresAtMs = leaseExpiresAt ? new Date(leaseExpiresAt).getTime() : null;
  const nowMs = new Date(now).getTime();
  const leaseExpired = Number.isFinite(leaseExpiresAtMs) && Number.isFinite(nowMs) && leaseExpiresAtMs <= nowMs;
  const acknowledgementRoute = lease.acknowledgementRoute ||
    `${surfaceGroup}/${surfaceName}/providers/${contract.providerId}/mailchimp-handoff-ack`;
  const requiresAcknowledgement = commandCount > 0 && contract.externalHandoff.state === "ready";
  const blockers = [
    contract.mailchimp.webhookReady ? null : "mailchimp-ack-webhook-not-ready",
    contract.sync.stale ? "mailchimp-ack-sync-stale" : null,
    requiresAcknowledgement && !lease.leaseId ? "mailchimp-ack-lease-missing" : null,
    requiresAcknowledgement && leaseExpired ? "mailchimp-ack-lease-expired" : null,
    contract.externalHandoff.state === "ready" || contract.externalHandoff.state === "idle"
      ? null
      : "mailchimp-ack-handoff-not-ready"
  ].filter(Boolean);
  const waiting = requiresAcknowledgement && blockers.length === 0;

  return {
    contractVersion: "hosted-kernel-owner-identity.mailchimp-provider-acknowledgement.v1",
    providerId: contract.providerId,
    requiresAcknowledgement,
    state: blockers.length
      ? "blocked"
      : waiting
        ? "waiting"
        : "not-required",
    acknowledgementRoute,
    leaseId: lease.leaseId || null,
    leaseExpiresAt,
    leaseExpired,
    commandIds: contract.externalHandoff.commandIds,
    expectedReceipt: requiresAcknowledgement
      ? {
          receiptId: `mailchimp-handoff-receipt:${contract.providerId}:${contract.sync.cursor}`,
          providerId: contract.providerId,
          commandIds: contract.externalHandoff.commandIds,
          syncCursor: contract.sync.cursor,
          proofRef: contract.externalHandoff.proofRef,
          acceptedStates: ["accepted", "completed", "failed"],
          idempotencyKey: [
            "mailchimp-provider-ack",
            contract.providerId,
            contract.sync.cursor,
            contract.externalHandoff.commandIds.join(",") || "no-command"
          ].join(":")
        }
      : null,
    blockers,
    nextAction: blockers.includes("mailchimp-ack-webhook-not-ready")
      ? "configure-mailchimp-signed-webhook-callback"
      : blockers.includes("mailchimp-ack-sync-stale")
        ? "refresh-mailchimp-owner-provider-sync"
        : blockers.includes("mailchimp-ack-lease-missing") || blockers.includes("mailchimp-ack-lease-expired")
          ? "renew-mailchimp-handoff-lease"
          : blockers.includes("mailchimp-ack-handoff-not-ready")
            ? "prepare-mailchimp-provider-handoff"
            : waiting
              ? "await-mailchimp-handoff-acknowledgement"
              : "none",
    resumeWhen: blockers.length
      ? "mailchimp_provider_acknowledgement_ready"
      : waiting
        ? "mailchimp_handoff_acknowledged"
        : null
  };
}

function buildMailchimpProviderAcceptanceBoundary(contract) {
  const boundary = contract.boundary || {};
  const evaluation = boundary.evaluation || {};
  const violationCodes = Array.isArray(evaluation.violations)
    ? evaluation.violations.map((violation) => violation.code)
    : [];
  const missingCapabilities = contract.mailchimp?.missingCapabilities || [];
  const contractIssues = contract.contractIssues || [];
  const webhookReady = Boolean(contract.mailchimp?.webhookReady);
  const syncReady = !contract.sync?.stale;
  const handoffReady = contract.externalHandoff?.state === "ready" ||
    (contract.mailchimp?.handoffMode === "audit-only" && contract.externalHandoff?.state === "audit-observe-only");
  const blockers = [
    ...(boundary.status === "blocked" ? ["mailchimp-provider-boundary-blocked"] : []),
    ...violationCodes,
    ...(missingCapabilities.length ? ["mailchimp-provider-capability-missing"] : []),
    ...(webhookReady ? [] : ["mailchimp-provider-webhook-not-ready"]),
    ...(syncReady ? [] : ["mailchimp-provider-sync-stale"]),
    ...(handoffReady ? [] : ["mailchimp-provider-handoff-not-ready"]),
    ...(contractIssues.includes("provider-auth-mode-requires-manual-review") ? ["mailchimp-provider-auth-manual-review"] : [])
  ];
  const warnings = [
    ...(contract.mailchimp?.handoffMode === "audit-only" ? ["mailchimp-provider-audit-only-handoff"] : []),
    ...(contract.status === "negotiated" && contract.sync?.stale ? ["mailchimp-provider-sync-warning"] : [])
  ];

  return {
    contractVersion: "hosted-kernel-owner-identity.mailchimp-provider-acceptance-boundary.v1",
    providerId: contract.providerId,
    tenantId: contract.tenantId,
    workspaceId: contract.workspaceId,
    boundaryStatus: boundary.status || "unknown",
    boundaryMode: boundary.mode || evaluation.mode || "unknown",
    tenantInScope: boundary.tenantInScope !== false && evaluation.tenantInScope !== false,
    workspaceInScope: boundary.workspaceInScope !== false && evaluation.workspaceInScope !== false,
    grantedCapabilities: contract.grantedCapabilities,
    missingCapabilities,
    webhookReady,
    syncReady,
    handoffReady,
    acceptedForPreview: blockers.length === 0,
    blockers: Array.from(new Set(blockers)).sort(),
    warnings: Array.from(new Set(warnings)).sort(),
    nextAction: blockers.includes("mailchimp-provider-boundary-blocked") ||
      violationCodes.some((code) => code.includes("tenant") || code.includes("workspace"))
      ? "repair-mailchimp-provider-workspace-boundary"
      : blockers.includes("mailchimp-provider-capability-missing")
        ? "negotiate-mailchimp-owner-provider-capabilities"
        : blockers.includes("mailchimp-provider-webhook-not-ready")
          ? "configure-mailchimp-signed-webhook-callback"
          : blockers.includes("mailchimp-provider-sync-stale")
            ? "refresh-mailchimp-owner-provider-sync"
            : blockers.includes("mailchimp-provider-handoff-not-ready")
              ? "prepare-mailchimp-provider-handoff"
              : blockers.includes("mailchimp-provider-auth-manual-review")
                ? "activate-mailchimp-provider-auth"
                : warnings.length
                  ? "review-mailchimp-provider-warning"
                  : "accept-mailchimp-provider-preview"
  };
}

function buildMailchimpProviderReporting({ contracts, now }) {
  const mailchimpContracts = contracts.filter((contract) => contract.mailchimp);
  const acknowledgementProfiles = mailchimpContracts.map((contract) =>
    buildMailchimpProviderAcknowledgementProfile(contract, now)
  );
  const acknowledgementByProvider = new Map(acknowledgementProfiles.map((profile) => [
    profile.providerId,
    profile
  ]));
  const rows = mailchimpContracts.map((contract) => {
    const acceptanceBoundary = buildMailchimpProviderAcceptanceBoundary(contract);

    return {
      providerId: contract.providerId,
      displayName: contract.displayName,
      status: contract.status,
      readiness: contract.mailchimp.readiness,
      nextAction: acceptanceBoundary.nextAction === "accept-mailchimp-provider-preview"
        ? contract.mailchimp.nextAction
        : acceptanceBoundary.nextAction,
      accountRef: contract.mailchimp.accountRef,
      webhookReady: contract.mailchimp.webhookReady,
      callbackEndpoint: contract.mailchimp.callbackEndpoint,
      handoffMode: contract.mailchimp.handoffMode,
      externalHandoffState: contract.externalHandoff.state,
      externalHandoffCommandCount: contract.externalHandoff.commandIds.length,
      tenantId: contract.tenantId,
      workspaceId: contract.workspaceId,
      grantedCapabilities: contract.grantedCapabilities,
      missingCapabilities: contract.mailchimp.missingCapabilities,
      contractIssues: contract.contractIssues,
      acceptanceBoundary,
      syncCursor: contract.sync.cursor,
      lastSyncedAt: contract.sync.lastSyncedAt,
      syncStale: contract.sync.stale,
      syncLagSeconds: contract.sync.lagSeconds,
      proofRef: contract.externalHandoff.proofRef,
      acknowledgement: acknowledgementByProvider.get(contract.providerId)
    };
  });
  const ackBlockedRows = rows.filter((row) => row.acknowledgement?.state === "blocked");
  const ackWaitingRows = rows.filter((row) => row.acknowledgement?.state === "waiting");
  const boundaryBlockedRows = rows.filter((row) => !row.acceptanceBoundary.acceptedForPreview);
  const blockedRows = rows.filter((row) =>
    row.status === "blocked" ||
      row.readiness !== "handoff-ready" ||
      !row.acceptanceBoundary.acceptedForPreview ||
      row.acknowledgement?.state === "blocked"
  );
  const webhookBlockedRows = rows.filter((row) => !row.webhookReady);
  const auditOnlyRows = rows.filter((row) => row.handoffMode === "audit-only");
  const syncStaleRows = rows.filter((row) => row.syncStale);
  const nextActions = Array.from(new Set([
    ...rows.map((row) => row.nextAction),
    ...rows.map((row) => row.acknowledgement?.nextAction)
  ].filter(Boolean))).sort();

  return {
    contractVersion: "hosted-kernel-owner-identity.mailchimp-provider-reporting.v1",
    generatedAt: now,
    detected: rows.length > 0,
    status: blockedRows.length
      ? "attention"
      : rows.length
        ? "ready"
        : "not-required",
    counters: {
      providers: rows.length,
      readyProviders: rows.filter((row) => row.readiness === "handoff-ready").length,
      blockedProviders: blockedRows.length,
      webhookBlockedProviders: webhookBlockedRows.length,
      auditOnlyProviders: auditOnlyRows.length,
      syncStaleProviders: syncStaleRows.length,
      boundaryBlockedProviders: boundaryBlockedRows.length,
      acknowledgementBlockedProviders: ackBlockedRows.length,
      acknowledgementWaitingProviders: ackWaitingRows.length,
      handoffCommandCount: rows.reduce((count, row) => count + row.externalHandoffCommandCount, 0)
    },
    readyProviderIds: rows
      .filter((row) => row.readiness === "handoff-ready" && row.acknowledgement?.state !== "blocked")
      .map((row) => row.providerId),
    blockedProviderIds: blockedRows.map((row) => row.providerId),
    webhookBlockedProviderIds: webhookBlockedRows.map((row) => row.providerId),
    boundaryBlockedProviderIds: boundaryBlockedRows.map((row) => row.providerId),
    syncStaleProviderIds: syncStaleRows.map((row) => row.providerId),
    acknowledgementBlockedProviderIds: ackBlockedRows.map((row) => row.providerId),
    acknowledgementWaitingProviderIds: ackWaitingRows.map((row) => row.providerId),
    nextActions,
    acknowledgementProfiles,
    rows,
    exportContract: {
      route: `${surfaceGroup}/${surfaceName}/export-rows/mailchimp-providers`,
      format: "json,csv",
      columns: [
        "providerId",
        "status",
        "readiness",
        "nextAction",
        "webhookReady",
        "handoffMode",
        "externalHandoffState",
        "externalHandoffCommandCount",
        "tenantId",
        "workspaceId",
        "acceptanceBoundaryState",
        "acceptanceBoundaryNextAction",
        "lastSyncedAt",
        "syncStale",
        "acknowledgementState",
        "acknowledgementNextAction",
        "proofRef"
      ],
      rowCount: rows.length,
      proofRefs: rows.map((row) => row.proofRef).filter(Boolean)
    }
  };
}

function buildMailchimpLifecycleHandoffControl({ providerServiceContracts, lifecycleControlState, clientRequestState, now }) {
  const reporting = providerServiceContracts.mailchimpReporting;
  const rows = reporting.rows || [];
  const scopeAcknowledgement = clientRequestState.mailchimpScopeAcknowledgement;
  const scopeAcknowledgementRows = scopeAcknowledgement.rows || [];
  const readyRows = rows.filter((row) =>
    row.readiness === "handoff-ready" && row.acknowledgement?.state !== "blocked"
  );
  const blockedRows = rows.filter((row) =>
    row.status === "blocked" ||
      row.readiness !== "handoff-ready" ||
      row.acknowledgement?.state === "blocked"
  );
  const queue = lifecycleControlState.queue || {};
  const pendingCommands = lifecycleControlState.pendingCommands || [];
  const readyCommands = pendingCommands.filter((command) => command.status === "ready");
  const handoffCommands = readyRows.flatMap((row) => {
    const maxCommands = row.externalHandoffCommandCount > 0
      ? row.externalHandoffCommandCount
      : readyCommands.length;
    return readyCommands.slice(0, maxCommands || readyCommands.length).map((command) => ({
      providerId: row.providerId,
      commandId: command.commandId,
      type: command.type,
      kernelId: command.kernelId,
      ownerId: command.ownerId,
      scheduleAt: command.scheduleAt,
      effect: command.effect,
      proofRef: command.proofRef,
      idempotencyKey: [
        "mailchimp-lifecycle-handoff",
        row.providerId,
        command.commandId,
        command.scheduleAt,
        scopeAcknowledgement.receiptDigest || "no-scope-ack"
      ].join(":")
    }));
  });
  const acknowledgedProviderIds = new Set(scopeAcknowledgementRows
    .filter((row) => row.accepted)
    .map((row) => row.providerId)
    .filter(Boolean));
  const providersRequiringScopeAck = readyRows.filter((row) =>
    scopeAcknowledgement.required &&
      scopeAcknowledgementRows.some((ack) => ack.providerId === row.providerId)
  );
  const missingScopeAckProviderIds = providersRequiringScopeAck
    .filter((row) => !acknowledgedProviderIds.has(row.providerId))
    .map((row) => row.providerId);
  const blockers = Array.from(new Set([
    ...blockedRows.flatMap((row) => row.contractIssues),
    ...rows.flatMap((row) => row.acknowledgement?.blockers || []),
    ...(scopeAcknowledgement.status === "blocked" ? scopeAcknowledgement.blockers : []),
    ...(missingScopeAckProviderIds.length ? ["mailchimp-scope-acknowledgement-missing"] : []),
    ...(reporting.counters.providers === 0 ? ["mailchimp-provider-contract-missing"] : []),
    ...(queue.blocked ? ["lifecycle-command-queue-blocked"] : []),
    ...(readyCommands.length === 0 && reporting.detected ? ["mailchimp-lifecycle-command-not-ready"] : []),
    ...(clientRequestState?.actorIdentity?.actorId ? [] : ["client-request-actor-missing"])
  ])).sort();
  const nextActions = Array.from(new Set([
    ...reporting.nextActions,
    ...(blockers.includes("mailchimp-provider-contract-missing")
      ? ["register-mailchimp-owner-provider"]
      : []),
    ...(blockers.includes("mailchimp-lifecycle-command-not-ready")
      ? ["prepare-owner-lifecycle-command"]
      : []),
    ...(blockers.includes("client-request-actor-missing")
      ? ["attach-client-request-actor"]
      : []),
    ...(blockers.includes("mailchimp-scope-acknowledgement-missing")
      ? ["acknowledge-mailchimp-scope-handoff"]
      : []),
    ...(handoffCommands.length ? ["dispatch-mailchimp-lifecycle-handoff"] : [])
  ])).sort();
  const providerPayloads = readyRows.map((row) => {
    const commands = handoffCommands.filter((command) => command.providerId === row.providerId);
    const scopeAckRows = scopeAcknowledgementRows.filter((ack) => ack.providerId === row.providerId);
    return {
      contractVersion: "hosted-kernel-owner-identity.mailchimp-lifecycle-provider-payload.v1",
      providerId: row.providerId,
      accountRef: row.accountRef,
      callbackEndpoint: row.callbackEndpoint,
      handoffMode: row.handoffMode,
      syncCursor: row.syncCursor,
      lastSyncedAt: row.lastSyncedAt,
      proofRef: row.proofRef,
      acknowledgement: row.acknowledgement,
      scopeAcknowledgement: {
        required: scopeAckRows.length > 0,
        accepted: scopeAckRows.length === 0 || scopeAckRows.some((ack) => ack.accepted),
        rows: scopeAckRows,
        receiptIds: scopeAckRows.map((ack) => ack.receiptId).filter(Boolean),
        receiptLedgerStatus: scopeAcknowledgement.receiptLedger?.status || "not-supplied",
        receiptLedgerBlockers: scopeAcknowledgement.receiptLedger?.blockers || [],
        nextAction: scopeAckRows.some((ack) => !ack.accepted)
          ? "acknowledge-mailchimp-scope-handoff"
          : "none"
      },
      commandCount: commands.length,
      commands,
      acknowledgementRoute: row.acknowledgement?.acknowledgementRoute ||
        `${surfaceGroup}/${surfaceName}/providers/${row.providerId}/mailchimp-handoff-ack`,
      failureRoute: `${surfaceGroup}/${surfaceName}/providers/${row.providerId}/mailchimp-handoff-failure`
    };
  });
  const routePayload = {
    contractVersion: "hosted-kernel-owner-identity.mailchimp-lifecycle-handoff-route.v1",
    route: `${surfaceGroup}/${surfaceName}/mailchimp-lifecycle-handoff`,
    method: "POST",
    requestId: clientRequestState.requestId,
    sessionId: clientRequestState.sessionId,
    actorId: clientRequestState.actorIdentity?.actorId || null,
    requiredFields: ["providerId", "commandId", "proofRef", "acknowledgementRoute", "scopeAcknowledgement"],
    idempotencyKey: [
      "mailchimp-owner-lifecycle",
      clientRequestState.requestId || "request",
      reporting.counters.providers,
      handoffCommands.length,
      lifecycleControlState.restartRecovery?.status || "runtime",
      scopeAcknowledgement.receiptDigest || "no-scope-ack"
    ].join(":"),
    providers: providerPayloads
  };

  return {
    contractVersion: "hosted-kernel-owner-identity.mailchimp-lifecycle-handoff-control.v1",
    generatedAt: now,
    detected: reporting.detected,
    status: !reporting.detected
      ? "not-required"
      : blockers.length
        ? "blocked"
        : handoffCommands.length
          ? "dispatch-ready"
          : "waiting-for-command",
    providerCount: reporting.counters.providers,
    readyProviderIds: readyRows.map((row) => row.providerId),
    blockedProviderIds: blockedRows.map((row) => row.providerId),
    acknowledgementBlockedProviderIds: reporting.acknowledgementBlockedProviderIds,
    acknowledgementWaitingProviderIds: reporting.acknowledgementWaitingProviderIds,
    scopeAcknowledgement: {
      contractVersion: "hosted-kernel-owner-identity.mailchimp-scope-acknowledgement-adoption.v1",
      status: scopeAcknowledgement.status,
      required: scopeAcknowledgement.required,
      supplied: scopeAcknowledgement.supplied,
      acceptedCount: scopeAcknowledgement.acceptedCount,
      blockedCount: scopeAcknowledgement.blockedCount,
      missingProviderIds: missingScopeAckProviderIds,
      receiptDigest: scopeAcknowledgement.receiptDigest,
      receiptLedger: scopeAcknowledgement.receiptLedger,
      nextAction: missingScopeAckProviderIds.length
        ? "acknowledge-mailchimp-scope-handoff"
        : scopeAcknowledgement.nextAction,
      rows: scopeAcknowledgementRows
    },
    commandCount: handoffCommands.length,
    blockers,
    nextActions,
    routePayload,
    providerPayloads,
    exportContract: {
      route: `${surfaceGroup}/${surfaceName}/export-rows/mailchimp-lifecycle-handoff`,
      format: "json,csv",
      rowCount: handoffCommands.length,
      columns: [
        "providerId",
        "commandId",
        "type",
        "kernelId",
        "ownerId",
        "scheduleAt",
        "effect",
        "proofRef",
        "scopeAcknowledgementStatus",
        "scopeAcknowledgementReceiptIds",
        "idempotencyKey"
      ],
      proofRefs: Array.from(new Set([
        ...providerPayloads.map((payload) => payload.proofRef),
        ...handoffCommands.map((command) => command.proofRef),
        ...scopeAcknowledgementRows.map((row) => row.proofRef)
      ].filter(Boolean)))
    },
    resumeWhen: !reporting.detected
      ? null
      : blockers.includes("mailchimp-provider-contract-missing")
        ? "mailchimp_owner_provider_registered"
        : blockers.includes("mailchimp-lifecycle-command-not-ready")
        ? "owner_lifecycle_command_ready"
        : blockers.includes("mailchimp-scope-acknowledgement-missing")
          ? "mailchimp_scope_handoff_acknowledged"
        : blockers.length
          ? "mailchimp_provider_reporting_ready"
          : "mailchimp_lifecycle_handoff_acknowledged"
  };
}

function normalizeProviderRuntimeHealthSignal(providerId, signal = {}, now) {
  const status = stableText(signal.status || signal.state, "unknown");
  const circuitState = stableText(signal.circuitState || signal.circuit || signal.breakerState, "");
  const impactedCapabilities = normalizeStringList(
    signal.impactedCapabilities || signal.degradedCapabilities || signal.capabilities
  );
  return {
    providerId,
    status: providerRuntimeHealthStatuses.has(status) ? status : "unknown",
    observedAt: normalizeTimestamp(signal.observedAt || signal.checkedAt || signal.at, now),
    circuitState: providerCircuitStates.has(circuitState)
      ? circuitState
      : status === "down"
        ? "open"
        : status === "degraded"
          ? "half-open"
          : "closed",
    consecutiveFailures: normalizePositiveInteger(
      signal.consecutiveFailures || signal.failures,
      0,
      { min: 0, max: 1000 }
    ),
    lastSuccessAt: signal.lastSuccessAt ? normalizeTimestamp(signal.lastSuccessAt, now) : null,
    lastFailureAt: signal.lastFailureAt ? normalizeTimestamp(signal.lastFailureAt, now) : null,
    failureCode: stableText(signal.failureCode || signal.code, status === "healthy" ? "none" : "provider-health-unreported"),
    failureMessage: stableText(signal.failureMessage || signal.message, ""),
    retryEligible: normalizeBoolean(signal.retryEligible ?? signal.retryable, status !== "healthy"),
    impactedCapabilities: impactedCapabilities.filter((capability) => ownerIdentityCapabilities.has(capability)),
    rejectedCapabilities: impactedCapabilities.filter((capability) => !ownerIdentityCapabilities.has(capability)),
    proofRef: stableText(signal.proofRef || signal.proof, `provider-health:${providerId}:${now}`)
  };
}

function normalizeOperationalTelemetry(input = {}, now) {
  const normalizeAttempt = (attempt, fallbackCode, maxAttempts = 100) => ({
    attempts: normalizePositiveInteger(attempt?.attempts ?? attempt, 0, { min: 0, max: maxAttempts }),
    lastFailureAt: attempt?.lastFailureAt ? normalizeTimestamp(attempt.lastFailureAt, null) : null,
    lastFailureCode: stableText(attempt?.lastFailureCode || attempt?.code, fallbackCode)
  });
  const commandAttempts = Object.fromEntries(
    Object.entries(input.commandAttempts || input.commands || {}).map(([commandId, attempt]) => [
      stableText(commandId),
      normalizeAttempt(attempt, "unknown-command-failure")
    ])
  );
  const jobAttempts = Object.fromEntries(
    Object.entries(input.jobAttempts || input.privilegedJobAttempts || input.privilegedJobs || input.jobs || {}).map(([jobId, attempt]) => [
      stableText(jobId),
      normalizeAttempt(attempt, "unknown-privileged-job-failure")
    ])
  );
  const providerAttempts = Object.fromEntries(
    Object.entries(input.providerAttempts || input.providers || {}).map(([providerId, attempt]) => [
      stableText(providerId),
      normalizeAttempt(attempt, "unknown-provider-failure")
    ])
  );
  const providerHealth = Object.fromEntries(
    Object.entries(input.providerHealth || input.providerRuntimeHealth || input.providerStatus || {}).map(([providerId, signal]) => {
      const normalizedProviderId = stableText(providerId);
      return [
        normalizedProviderId,
        normalizeProviderRuntimeHealthSignal(normalizedProviderId, signal, now)
      ];
    })
  );
  return {
    maxRetryAttempts: normalizePositiveInteger(input.maxRetryAttempts, 5, { min: 1, max: 25 }),
    baseRetryDelayMinutes: normalizePositiveInteger(input.baseRetryDelayMinutes, 5, { min: 1, max: 240 }),
    maxRetryDelayMinutes: normalizePositiveInteger(input.maxRetryDelayMinutes, 60, { min: 5, max: 1440 }),
    commandAttempts,
    jobAttempts,
    providerAttempts,
    providerHealth
  };
}

function commandFingerprint(command) {
  return [
    command.type,
    command.kernelId,
    command.ownerId,
    command.targetOwnerId || "",
    command.tenantId,
    command.workspaceId,
    command.scheduleAt,
    commandEffect(command.type)
  ].join("|");
}

function normalizeCommandReceipt(receipt = {}, index = 0, now, workspaceScope) {
  const commandId = stableText(receipt.commandId || receipt.id, `persisted-command:${index + 1}`);
  const status = ["accepted", "applied", "completed", "failed", "rejected"].includes(receipt.status)
    ? receipt.status
    : "accepted";
  const type = stableText(receipt.type, "kernel.enable");
  const acceptedType = lifecycleCommandTypes.has(type) ? type : "kernel.enable";
  const kernelId = stableText(receipt.kernelId || receipt.kernel, "hosted-kernel");
  const ownerId = stableText(receipt.ownerId || receipt.owner, "unassigned");
  const scheduleAt = normalizeTimestamp(receipt.scheduleAt || receipt.appliedAt || receipt.completedAt, now);
  return {
    receiptId: stableText(receipt.receiptId || receipt.id, `owner-identity-command-receipt:${commandId}`),
    commandId,
    fingerprint: stableText(
      receipt.fingerprint,
      [
        acceptedType,
        kernelId,
        ownerId,
        stableText(receipt.targetOwnerId || receipt.newOwnerId, ""),
        scopedText(receipt.tenantId || receipt.tenant, workspaceScope.tenantId),
        scopedText(receipt.workspaceId || receipt.workspace, workspaceScope.workspaceId),
        scheduleAt,
        commandEffect(acceptedType)
      ].join("|")
    ),
    status,
    type: acceptedType,
    kernelId,
    ownerId,
    targetOwnerId: stableText(receipt.targetOwnerId || receipt.newOwnerId, ""),
    tenantId: scopedText(receipt.tenantId || receipt.tenant, workspaceScope.tenantId),
    workspaceId: scopedText(receipt.workspaceId || receipt.workspace, workspaceScope.workspaceId),
    scheduleAt,
    acceptedAt: normalizeTimestamp(receipt.acceptedAt || receipt.createdAt, now),
    appliedAt: receipt.appliedAt || receipt.completedAt
      ? normalizeTimestamp(receipt.appliedAt || receipt.completedAt, now)
      : null,
    effect: stableText(receipt.effect, commandEffect(acceptedType)),
    proofRef: stableText(receipt.proofRef || receipt.proof, `command-receipt:${commandId}:${status}`)
  };
}

function jobFingerprint(job) {
  return [
    job.type,
    job.kernelId,
    job.ownerId,
    job.tenantId,
    job.workspaceId,
    job.requiredPermission,
    job.idempotencyKey
  ].join("|");
}

function normalizePrivilegedJobReceipt(receipt = {}, index = 0, now, workspaceScope) {
  const jobId = stableText(receipt.jobId || receipt.id, `persisted-privileged-job:${index + 1}`);
  const status = ["accepted", "completed", "failed", "rejected"].includes(receipt.status)
    ? receipt.status
    : "accepted";
  const type = stableText(receipt.type || receipt.jobType || receipt.action, "kernel.lifecycle.apply");
  const ownerId = stableText(receipt.ownerId || receipt.owner || receipt.actorOwnerId, "unassigned");
  const kernelId = stableText(receipt.kernelId || receipt.kernel, "hosted-kernel");
  const tenantId = scopedText(receipt.tenantId || receipt.tenant, workspaceScope.tenantId);
  const workspaceId = scopedText(receipt.workspaceId || receipt.workspace, workspaceScope.workspaceId);
  const requestedPermission = stableText(receipt.requiredPermission || receipt.permission || receipt.capability, "");
  const requiredPermission = ownerIdentityCapabilities.has(requestedPermission)
    ? requestedPermission
    : privilegedJobPermissionByType[type] || "kernel.lifecycle.command";
  const requestedAt = normalizeTimestamp(receipt.requestedAt || receipt.acceptedAt || receipt.createdAt, now);
  const idempotencyKey = stableText(
    receipt.idempotencyKey || receipt.dedupeKey || receipt.fingerprint,
    `${type}:${ownerId}:${requestedAt}:${index + 1}`
  );
  const fingerprint = stableText(
    receipt.fingerprint,
    [type, kernelId, ownerId, tenantId, workspaceId, requiredPermission, idempotencyKey].join("|")
  );
  return {
    receiptId: stableText(receipt.receiptId || receipt.id, `owner-identity-privileged-job-receipt:${jobId}`),
    jobId,
    fingerprint,
    status,
    type,
    kernelId,
    ownerId,
    tenantId,
    workspaceId,
    requiredPermission,
    idempotencyKey,
    requestedAt,
    acceptedAt: normalizeTimestamp(receipt.acceptedAt || receipt.createdAt || receipt.requestedAt, now),
    completedAt: receipt.completedAt || receipt.appliedAt
      ? normalizeTimestamp(receipt.completedAt || receipt.appliedAt, now)
      : null,
    failureCode: status === "failed" || status === "rejected"
      ? stableText(receipt.failureCode || receipt.code, "privileged-job-previously-failed")
      : null,
    proofRef: stableText(receipt.proofRef || receipt.proof, `privileged-job-receipt:${jobId}:${status}`)
  };
}

function normalizePersistedKernelState(kernel = {}, index = 0, now, workspaceScope) {
  return {
    kernelId: stableText(kernel.kernelId || kernel.id, `persisted-kernel:${index + 1}`),
    ownerId: stableText(kernel.ownerId || kernel.owner, "unassigned"),
    tenantId: scopedText(kernel.tenantId || kernel.tenant, workspaceScope.tenantId),
    workspaceId: scopedText(kernel.workspaceId || kernel.workspace, workspaceScope.workspaceId),
    state: ["hosted", "suspended", "retired", "unseen"].includes(kernel.state) ? kernel.state : "unseen",
    updatedAt: normalizeTimestamp(kernel.updatedAt || kernel.lastSeenAt, now),
    lastEvent: stableText(kernel.lastEvent, "persisted-state"),
    lastProofRef: stableText(kernel.lastProofRef || kernel.proofRef || kernel.proof, `persisted-kernel:${index + 1}`)
  };
}

function buildPersistedReceiptIntegrity(receipts = [], {
  receiptKind,
  idField,
  subjectField
}) {
  const byReceiptId = new Map();
  const byFingerprint = new Map();
  for (const receipt of receipts) {
    const receiptId = stableText(receipt[idField], "");
    const subjectId = stableText(receipt[subjectField], "");
    const fingerprint = stableText(receipt.fingerprint, "");
    const receiptGroup = byReceiptId.get(receiptId) || [];
    receiptGroup.push(receipt);
    byReceiptId.set(receiptId, receiptGroup);
    if (fingerprint) {
      const fingerprintGroup = byFingerprint.get(fingerprint) || [];
      fingerprintGroup.push(receipt);
      byFingerprint.set(fingerprint, fingerprintGroup);
    }
  }

  const duplicateReceiptIds = [];
  const conflictingReceiptGroups = [];
  for (const [receiptId, group] of byReceiptId.entries()) {
    if (group.length < 2) continue;
    duplicateReceiptIds.push(receiptId);
    const signatures = new Set(group.map((receipt) => [
      receipt[subjectField],
      receipt.fingerprint,
      receipt.status,
      receipt.type,
      receipt.kernelId,
      receipt.ownerId,
      receipt.tenantId,
      receipt.workspaceId
    ].join("|")));
    if (signatures.size > 1) {
      conflictingReceiptGroups.push({
        receiptId,
        receiptKind,
        receiptCount: group.length,
        subjectIds: Array.from(new Set(group.map((receipt) => receipt[subjectField]))).sort(),
        statuses: Array.from(new Set(group.map((receipt) => receipt.status))).sort(),
        fingerprints: Array.from(new Set(group.map((receipt) => receipt.fingerprint))).sort(),
        proofRefs: Array.from(new Set(group.map((receipt) => receipt.proofRef))).sort()
      });
    }
  }

  const sharedFingerprintGroups = Array.from(byFingerprint.entries())
    .map(([fingerprint, group]) => ({
      fingerprint,
      receiptKind,
      receiptIds: Array.from(new Set(group.map((receipt) => receipt[idField]))).sort(),
      subjectIds: Array.from(new Set(group.map((receipt) => receipt[subjectField]))).sort(),
      statuses: Array.from(new Set(group.map((receipt) => receipt.status))).sort(),
      proofRefs: Array.from(new Set(group.map((receipt) => receipt.proofRef))).sort()
    }))
    .filter((group) => group.receiptIds.length > 1 || group.subjectIds.length > 1);

  return {
    contractVersion: "hosted-kernel-owner-identity.persisted-receipt-integrity.v1",
    receiptKind,
    receiptCount: receipts.length,
    uniqueReceiptIds: byReceiptId.size,
    duplicateReceiptIds: duplicateReceiptIds.sort(),
    conflictingReceiptGroups,
    sharedFingerprintGroups,
    status: conflictingReceiptGroups.length
      ? "conflicting"
      : duplicateReceiptIds.length
        ? "duplicate"
        : "unique"
  };
}

function evaluatePersistedRuntimeTruth({
  source,
  commandReceipts,
  privilegedJobReceipts,
  kernelStates,
  now,
  workspaceScope
}) {
  const recoveryWatermark = source.recoveryWatermark || source.watermark
    ? normalizeTimestamp(source.recoveryWatermark || source.watermark, now)
    : null;
  const sourceUpdatedAt = source.updatedAt || source.persistedAt || source.snapshotAt || recoveryWatermark;
  const sourceUpdatedAtIso = sourceUpdatedAt ? normalizeTimestamp(sourceUpdatedAt, null) : null;
  const nowMs = new Date(now).getTime();
  const updatedAtMs = sourceUpdatedAtIso ? new Date(sourceUpdatedAtIso).getTime() : null;
  const ageMinutes = updatedAtMs && Number.isFinite(nowMs)
    ? Math.max(0, Math.round((nowMs - updatedAtMs) / 60000))
    : null;
  const present = Boolean(
    Object.keys(source).length ||
      commandReceipts.length ||
      privilegedJobReceipts.length ||
      kernelStates.length
  );
  const sourceTenantId = stableText(source.tenantId || source.tenant, workspaceScope.tenantId);
  const sourceWorkspaceId = stableText(source.workspaceId || source.workspace, workspaceScope.workspaceId);
  const sourceBoundary = evaluateWorkspaceBoundaryRecord({
    subjectType: "persisted-runtime-state",
    subjectId: stableText(source.storageKey || source.key, "persisted-runtime-state"),
    tenantId: sourceTenantId,
    workspaceId: sourceWorkspaceId,
    workspaceScope,
    proofRef: stableText(source.proofRef || source.proof, `persisted-runtime-state:${sourceTenantId}:${sourceWorkspaceId}`),
    tenantViolationCode: "persisted-runtime-tenant-outside-workspace-scope",
    workspaceViolationCode: "persisted-runtime-workspace-outside-workspace-scope"
  });
  const receiptBoundaryViolations = [
    ...commandReceipts
      .filter((receipt) => {
        const boundary = evaluateWorkspaceBoundaryRecord({
          subjectType: "persisted-command-receipt",
          subjectId: receipt.receiptId,
          tenantId: receipt.tenantId,
          workspaceId: receipt.workspaceId,
          workspaceScope,
          proofRef: receipt.proofRef
        });
        return boundary.status === "blocked";
      })
      .map((receipt) => ({
        scope: "command-receipt",
        receiptId: receipt.receiptId,
        commandId: receipt.commandId,
        tenantId: receipt.tenantId,
        workspaceId: receipt.workspaceId
      })),
    ...privilegedJobReceipts
      .filter((receipt) => {
        const boundary = evaluateWorkspaceBoundaryRecord({
          subjectType: "persisted-privileged-job-receipt",
          subjectId: receipt.receiptId,
          tenantId: receipt.tenantId,
          workspaceId: receipt.workspaceId,
          workspaceScope,
          proofRef: receipt.proofRef
        });
        return boundary.status === "blocked";
      })
      .map((receipt) => ({
        scope: "privileged-job-receipt",
        receiptId: receipt.receiptId,
        jobId: receipt.jobId,
        tenantId: receipt.tenantId,
        workspaceId: receipt.workspaceId
      }))
  ];
  const kernelBoundaryViolations = kernelStates
    .filter((kernel) => {
      const boundary = evaluateWorkspaceBoundaryRecord({
        subjectType: "persisted-kernel-state",
        subjectId: kernel.kernelId,
        tenantId: kernel.tenantId,
        workspaceId: kernel.workspaceId,
        workspaceScope,
        proofRef: kernel.lastProofRef
      });
      return boundary.status === "blocked";
    })
    .map((kernel) => ({
      kernelId: kernel.kernelId,
      tenantId: kernel.tenantId,
      workspaceId: kernel.workspaceId,
      proofRef: kernel.lastProofRef
    }));
  const commandReceiptIntegrity = buildPersistedReceiptIntegrity(commandReceipts, {
    receiptKind: "lifecycle-command",
    idField: "receiptId",
    subjectField: "commandId"
  });
  const privilegedJobReceiptIntegrity = buildPersistedReceiptIntegrity(privilegedJobReceipts, {
    receiptKind: "privileged-job",
    idField: "receiptId",
    subjectField: "jobId"
  });
  const stale = ageMinutes !== null && ageMinutes > maxPersistedRuntimeRecoveryAgeMinutes;
  const futureSnapshot = updatedAtMs !== null && updatedAtMs > nowMs + 60_000;
  const failures = [
    ...(present && sourceBoundary.status === "blocked" ? ["persisted-runtime-boundary-mismatch"] : []),
    ...(present && receiptBoundaryViolations.length ? ["persisted-receipt-boundary-mismatch"] : []),
    ...(present && kernelBoundaryViolations.length ? ["persisted-kernel-boundary-mismatch"] : []),
    ...(present && commandReceiptIntegrity.duplicateReceiptIds.length ? ["persisted-command-receipt-duplicate-id"] : []),
    ...(present && commandReceiptIntegrity.conflictingReceiptGroups.length ? ["persisted-command-receipt-conflict"] : []),
    ...(present && privilegedJobReceiptIntegrity.duplicateReceiptIds.length ? ["persisted-privileged-job-receipt-duplicate-id"] : []),
    ...(present && privilegedJobReceiptIntegrity.conflictingReceiptGroups.length ? ["persisted-privileged-job-receipt-conflict"] : []),
    ...(present && sourceUpdatedAt && !sourceUpdatedAtIso ? ["persisted-runtime-timestamp-invalid"] : []),
    ...(present && stale ? ["persisted-runtime-snapshot-stale"] : []),
    ...(present && futureSnapshot ? ["persisted-runtime-snapshot-from-future"] : [])
  ];
  const trustedForKernelRecovery = present && failures.every((failure) =>
    failure !== "persisted-runtime-boundary-mismatch" &&
      failure !== "persisted-kernel-boundary-mismatch" &&
      failure !== "persisted-runtime-timestamp-invalid" &&
      failure !== "persisted-runtime-snapshot-from-future"
  );
  const trustedForReceiptReplay = present && failures.length === 0;

  return {
    contractVersion: "hosted-kernel-owner-identity.persisted-runtime-truth.v1",
    present,
    sourceUpdatedAt: sourceUpdatedAtIso,
    recoveryWatermark,
    ageMinutes,
    maxRecoveryAgeMinutes: maxPersistedRuntimeRecoveryAgeMinutes,
    stale,
    futureSnapshot,
    sourceBoundary,
    receiptBoundaryViolations,
    kernelBoundaryViolations,
    duplicateReceiptIds: commandReceiptIntegrity.duplicateReceiptIds,
    duplicatePrivilegedJobReceiptIds: privilegedJobReceiptIntegrity.duplicateReceiptIds,
    commandReceiptIntegrity,
    privilegedJobReceiptIntegrity,
    trustedForKernelRecovery,
    trustedForReceiptReplay,
    trustLevel: !present
      ? "absent"
      : trustedForReceiptReplay
        ? "trusted"
        : trustedForKernelRecovery
          ? "kernel-state-only"
          : "untrusted",
    failures,
    replayDisposition: !present
      ? "cold-start"
      : trustedForReceiptReplay
        ? "replay-receipts-and-kernel-state"
        : trustedForKernelRecovery
          ? "recover-kernel-state-without-receipt-replay"
          : "quarantine-persisted-runtime-state",
    repairAction: failures.length
      ? "repair-or-refresh-persisted-owner-identity-runtime-state"
      : "retain-persisted-runtime-state"
  };
}

function normalizePersistedOwnerIdentityState(input = {}, now, workspaceScope) {
  const source = input.persistedState || input.recoveredState || input.previousState || input.durableState || {};
  const rawReceipts = Array.isArray(source.commandReceipts)
    ? source.commandReceipts
    : Array.isArray(source.lifecycleCommandReceipts)
      ? source.lifecycleCommandReceipts
      : [];
  const rawKernels = Array.isArray(source.kernelStates)
    ? source.kernelStates
    : Array.isArray(source.lastKnownKernels)
      ? source.lastKnownKernels
      : [];
  const rawJobReceipts = Array.isArray(source.privilegedJobReceipts)
    ? source.privilegedJobReceipts
    : Array.isArray(source.jobReceipts)
      ? source.jobReceipts
      : Array.isArray(source.privilegedJobs)
        ? source.privilegedJobs
        : [];
  const commandReceipts = rawReceipts.map((receipt, index) =>
    normalizeCommandReceipt(receipt, index, now, workspaceScope)
  );
  const privilegedJobReceipts = rawJobReceipts.map((receipt, index) =>
    normalizePrivilegedJobReceipt(receipt, index, now, workspaceScope)
  );
  const kernelStates = rawKernels.map((kernel, index) =>
    normalizePersistedKernelState(kernel, index, now, workspaceScope)
  );
  const recoveryTruth = evaluatePersistedRuntimeTruth({
    source,
    commandReceipts,
    privilegedJobReceipts,
    kernelStates,
    now,
    workspaceScope
  });
  return {
    contractVersion: "hosted-kernel-owner-identity.persisted-runtime-state.v1",
    storageKey: stableText(
      source.storageKey || source.key,
      `${surfaceGroup}/${surfaceName}/${workspaceScope.tenantId}/${workspaceScope.workspaceId}/runtime-state`
    ),
    bootId: stableText(source.bootId || input.bootId, `boot:${now}`),
    recoveredAt: now,
    recoveryWatermark: source.recoveryWatermark || source.watermark
      ? normalizeTimestamp(source.recoveryWatermark || source.watermark, now)
      : null,
    snapshotId: stableText(source.snapshotId || source.lastSnapshotId, "none"),
    recoveryTruth,
    commandReceipts,
    privilegedJobReceipts,
    kernelStates,
    proofRef: stableText(source.proofRef || source.proof, `persisted-owner-identity:${workspaceScope.tenantId}:${workspaceScope.workspaceId}`)
  };
}

function deriveKernelState(eventType) {
  if (eventType === "kernel.suspended") return "suspended";
  if (eventType === "kernel.resumed") return "hosted";
  if (eventType === "kernel.retired") return "retired";
  return "hosted";
}

function buildTimeline(events) {
  return events
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at) || a.eventId.localeCompare(b.eventId))
    .map((event, index) => ({
      sequence: index + 1,
      at: event.at,
      label: event.type,
      ownerId: event.ownerId,
      kernelId: event.kernelId,
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      proofRef: event.proofRef
    }));
}

function getLatestKernelStates(timeline) {
  const states = new Map();
  for (const event of timeline) {
    states.set(event.kernelId, {
      kernelId: event.kernelId,
      ownerId: event.ownerId,
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      state: deriveKernelState(event.label),
      lastEvent: event.label,
      lastProofRef: event.proofRef,
      updatedAt: event.at
    });
  }
  return states;
}

function buildKernelOwnerBindings({ latestStates, ownerIdentityRegistry, now }) {
  const bindings = Array.from(latestStates.values())
    .sort((a, b) => a.kernelId.localeCompare(b.kernelId))
    .map((kernel) => {
      const owner = ownerIdentityRegistry.ownerMap.get(kernel.ownerId) || null;
      const ownerConflict = ownerIdentityRegistry.conflictingOwnerIds.has(kernel.ownerId);
      const bindingErrors = [
        ...(owner ? [] : ["kernel-owner-claim-missing"]),
        ...(ownerConflict ? ["kernel-owner-identity-conflict"] : []),
        ...(owner && owner.tenantId !== kernel.tenantId ? ["kernel-owner-tenant-boundary-violation"] : []),
        ...(owner && owner.workspaceId !== kernel.workspaceId ? ["kernel-owner-workspace-boundary-violation"] : [])
      ];
      return {
        bindingId: `kernel-owner-binding:${kernel.kernelId}:${kernel.ownerId}`,
        kernelId: kernel.kernelId,
        ownerId: kernel.ownerId,
        ownerDisplayName: owner?.displayName || kernel.ownerId,
        ownerVerified: Boolean(owner?.verified),
        ownerClaimResolved: Boolean(owner),
        ownerIdentityConflict: ownerConflict,
        tenantId: kernel.tenantId,
        workspaceId: kernel.workspaceId,
        ownerTenantId: owner?.tenantId || null,
        ownerWorkspaceId: owner?.workspaceId || null,
        kernelState: kernel.state,
        lastEvent: kernel.lastEvent,
        updatedAt: kernel.updatedAt,
        status: bindingErrors.length
          ? "blocked"
          : owner?.verified
            ? "bound-verified-owner"
            : "bound-unverified-owner",
        bindingErrors,
        proofRefs: Array.from(new Set([kernel.lastProofRef, owner?.proofRef].filter(Boolean)))
      };
    });
  const blockedBindings = bindings.filter((binding) => binding.status === "blocked");
  const unverifiedBindings = bindings.filter((binding) => binding.status === "bound-unverified-owner");
  return {
    contractVersion: "hosted-kernel-owner-identity.kernel-owner-bindings.v1",
    generatedAt: now,
    status: blockedBindings.length ? "blocked" : unverifiedBindings.length ? "review" : "verified",
    bindings,
    blockedKernelIds: blockedBindings.map((binding) => binding.kernelId),
    unverifiedKernelIds: unverifiedBindings.map((binding) => binding.kernelId),
    bindingErrors: blockedBindings.flatMap((binding) =>
      binding.bindingErrors.map((code) => ({
        scope: "kernel-owner-binding",
        code,
        kernelId: binding.kernelId,
        ownerId: binding.ownerId,
        proofRefs: binding.proofRefs
      }))
    ),
    audit: {
      route: `${surfaceGroup}/${surfaceName}/kernel-owner-bindings`,
      proofRefs: Array.from(new Set(bindings.flatMap((binding) => binding.proofRefs)))
    }
  };
}

function mergePersistedKernelStates(latestStates, persistedKernelStates = [], recoveryTruth = null) {
  const merged = new Map(latestStates);
  const recoveryFindings = [];
  if (recoveryTruth && recoveryTruth.present && !recoveryTruth.trustedForKernelRecovery) {
    return {
      states: merged,
      recoveryFindings: [{
        kernelId: null,
        status: "persisted-kernel-state-quarantined",
        persistedUpdatedAt: recoveryTruth.sourceUpdatedAt,
        timelineUpdatedAt: null,
        proofRef: recoveryTruth.sourceBoundary?.proofRef || null,
        failureCodes: recoveryTruth.failures,
        repairAction: recoveryTruth.repairAction
      }]
    };
  }
  for (const kernel of persistedKernelStates) {
    const current = merged.get(kernel.kernelId);
    const persistedIsNewer = !current || kernel.updatedAt.localeCompare(current.updatedAt) > 0;
    if (persistedIsNewer) {
      merged.set(kernel.kernelId, {
        kernelId: kernel.kernelId,
        ownerId: kernel.ownerId,
        tenantId: kernel.tenantId,
        workspaceId: kernel.workspaceId,
        state: kernel.state,
        updatedAt: kernel.updatedAt,
        lastEvent: kernel.lastEvent,
        lastProofRef: kernel.lastProofRef,
        recoveredFromPersistence: true
      });
      recoveryFindings.push({
        kernelId: kernel.kernelId,
        status: current ? "persisted-state-superseded-timeline" : "persisted-state-restored",
        persistedUpdatedAt: kernel.updatedAt,
        timelineUpdatedAt: current?.updatedAt || null,
        proofRef: kernel.lastProofRef
      });
    } else if (current) {
      recoveryFindings.push({
        kernelId: kernel.kernelId,
        status: "timeline-state-newer-than-persisted",
        persistedUpdatedAt: kernel.updatedAt,
        timelineUpdatedAt: current.updatedAt,
        proofRef: current.lastProofRef
      });
    }
  }
  return {
    states: merged,
    recoveryFindings
  };
}

function commandEffect(type) {
  if (type === "kernel.disable" || type === "kernel.suspend") return "suspended";
  if (type === "kernel.enable" || type === "kernel.resume") return "hosted";
  if (type === "kernel.retire") return "retired";
  if (type === "owner.verify") return "owner-verification";
  if (type === "owner.transfer") return "owner-transfer";
  return "hosted";
}

function lifecycleCommandGroup(type) {
  if (type === "kernel.enable" || type === "kernel.resume") return "enable";
  if (type === "kernel.disable" || type === "kernel.suspend") return "disable";
  if (type === "kernel.retire") return "retire";
  if (type === "owner.verify") return "verify-owner";
  if (type === "owner.transfer") return "transfer-owner";
  return "lifecycle";
}

function reasonIsExplicit(command) {
  return command.reason !== command.type && command.reason !== lifecycleCommandPermissionByType[command.type];
}

function minutesBetween(from, to) {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
  return Math.round((toMs - fromMs) / 60000);
}

function scheduleState(command, settings, now) {
  const leadMinutes = Math.max(0, minutesBetween(command.requestedAt, command.scheduleAt));
  const untilDueMinutes = minutesBetween(now, command.scheduleAt);
  return {
    requestedAt: command.requestedAt,
    scheduleAt: command.scheduleAt,
    state: untilDueMinutes > 0 ? "scheduled" : "due",
    leadMinutes,
    minutesUntilDue: Math.max(0, untilDueMinutes),
    minLeadMinutes: settings.minScheduleLeadMinutes,
    maxWindowMinutes: settings.scheduleWindowMinutes,
    withinLeadPolicy: leadMinutes >= settings.minScheduleLeadMinutes,
    withinWindowPolicy: Math.max(0, untilDueMinutes) <= settings.scheduleWindowMinutes
  };
}

function isKernelMutationCommand(command) {
  return command.type.startsWith("kernel.");
}

function queueConflictEffect(command) {
  if (!isKernelMutationCommand(command)) return "owner-identity";
  if (command.commandGroup === "enable") return "enable-hosting";
  if (command.commandGroup === "disable") return "disable-hosting";
  return command.commandGroup;
}

function commandQueueBucket(command) {
  if (command.status === "blocked") return "blocked";
  if (command.scheduling.state === "due") return "due-now";
  return "scheduled";
}

function buildLifecycleQueueControls(pendingCommands, settings, now) {
  const kernelCommands = pendingCommands
    .filter(isKernelMutationCommand)
    .slice()
    .sort((a, b) =>
      a.kernelId.localeCompare(b.kernelId) ||
      a.scheduleAt.localeCompare(b.scheduleAt) ||
      a.commandId.localeCompare(b.commandId)
    );
  const commandFindings = new Map();
  const byKernel = new Map();
  const grouped = {};

  for (const command of pendingCommands) {
    const bucket = commandQueueBucket(command);
    grouped[bucket] = grouped[bucket] || [];
    grouped[bucket].push(command.commandId);
  }

  for (const command of kernelCommands) {
    const bucket = byKernel.get(command.kernelId) || [];
    bucket.push(command);
    byKernel.set(command.kernelId, bucket);
  }

  for (const commands of byKernel.values()) {
    let retireScheduled = null;
    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      const previous = commands[index - 1] || null;
      const findings = commandFindings.get(command.commandId) || { errors: [], warnings: [] };

      if (retireScheduled && command.commandId !== retireScheduled.commandId) {
        findings.errors.push("command-after-retire-in-queue");
      }
      if (previous && previous.scheduleAt === command.scheduleAt) {
        const previousFindings = commandFindings.get(previous.commandId) || { errors: [], warnings: [] };
        if (previous.commandGroup === command.commandGroup) {
          findings.warnings.push("duplicate-kernel-lifecycle-command");
          previousFindings.warnings.push("duplicate-kernel-lifecycle-command");
        } else {
          findings.errors.push("conflicting-kernel-lifecycle-command");
          previousFindings.errors.push("conflicting-kernel-lifecycle-command");
        }
        commandFindings.set(previous.commandId, previousFindings);
      }
      if (
        previous &&
        settings.commandCooldownMinutes > 0 &&
        minutesBetween(previous.scheduleAt, command.scheduleAt) < settings.commandCooldownMinutes
      ) {
        findings.errors.push("queued-kernel-command-cooldown-overlap");
      }
      if (command.commandGroup === "retire") {
        retireScheduled = command;
      }
      commandFindings.set(command.commandId, findings);
    }
  }

  const conflicts = Array.from(commandFindings.entries())
    .filter(([, finding]) => finding.errors.length || finding.warnings.length)
    .map(([commandId, finding]) => ({
      commandId,
      errors: finding.errors,
      warnings: finding.warnings
    }));

  return {
    contractVersion: "hosted-kernel-owner-identity.lifecycle-queue-controls.v1",
    generatedAt: now,
    status: conflicts.some((conflict) => conflict.errors.length)
      ? "blocked"
      : conflicts.length
        ? "ready-with-warnings"
        : "ready",
    queueBuckets: {
      dueNowCommandIds: grouped["due-now"] || [],
      scheduledCommandIds: grouped.scheduled || [],
      blockedCommandIds: grouped.blocked || []
    },
    kernelExecutionPlan: Array.from(byKernel.entries()).map(([kernelId, commands]) => ({
      kernelId,
      commandIds: commands.map((command) => command.commandId),
      nextCommandId: commands.find((command) => command.status === "ready")?.commandId || null,
      effects: commands.map((command) => ({
        commandId: command.commandId,
        scheduleAt: command.scheduleAt,
        effect: queueConflictEffect(command),
        currentState: command.currentState,
        expectedState: command.effect
      }))
    })),
    conflicts
  };
}

function applyLifecycleQueueControls(command, queueControls) {
  const conflict = queueControls.conflicts.find((item) => item.commandId === command.commandId);
  if (!conflict) return command;
  const errors = Array.from(new Set([...command.errors, ...conflict.errors]));
  const warnings = Array.from(new Set([...command.warnings, ...conflict.warnings]));
  return {
    ...command,
    status: errors.length ? "blocked" : command.status,
    errors,
    warnings,
    queuePolicy: {
      status: conflict.errors.length ? "blocked" : "accepted-with-warnings",
      errors: conflict.errors,
      warnings: conflict.warnings
    }
  };
}

function buildLifecycleSettingsControlState(settings, commands) {
  const settingsErrors = [];
  const settingsWarnings = [];
  if (settings.minScheduleLeadMinutes > settings.scheduleWindowMinutes) {
    settingsErrors.push("min-schedule-lead-exceeds-schedule-window");
  }
  if (!settings.lifecycleControlsEnabled && commands.some((command) => command.type.startsWith("kernel."))) {
    settingsWarnings.push("kernel-commands-present-while-controls-disabled");
  }
  if (!settings.ownerVerificationRequired && !settings.allowUnverifiedOwnerHosting) {
    settingsWarnings.push("unverified-hosting-disabled-even-though-verification-not-required");
  }
  return {
    contractVersion: "hosted-kernel-owner-identity.lifecycle-settings-controls.v1",
    toggles: {
      lifecycleControlsEnabled: settings.lifecycleControlsEnabled,
      ownerVerificationRequired: settings.ownerVerificationRequired,
      allowUnverifiedOwnerHosting: settings.allowUnverifiedOwnerHosting,
      disableRequiresReason: settings.disableRequiresReason,
      allowRetireFromHosted: settings.allowRetireFromHosted
    },
    scheduling: {
      minScheduleLeadMinutes: settings.minScheduleLeadMinutes,
      scheduleWindowMinutes: settings.scheduleWindowMinutes,
      commandCooldownMinutes: settings.commandCooldownMinutes,
      maxPendingCommands: settings.maxPendingCommands
    },
    validation: {
      status: settingsErrors.length ? "invalid" : settingsWarnings.length ? "valid-with-warnings" : "valid",
      errors: settingsErrors,
      warnings: settingsWarnings
    }
  };
}

function buildLifecycleActionControlState({ settings, settingsControlState, pendingCommands, latestStates, now }) {
  const settingsInvalid = settingsControlState.validation.status === "invalid";
  const pendingKernelCommands = pendingCommands.filter(isKernelMutationCommand);
  const pendingByKernel = new Map();
  for (const command of pendingKernelCommands) {
    const bucket = pendingByKernel.get(command.kernelId) || [];
    bucket.push(command);
    pendingByKernel.set(command.kernelId, bucket);
  }

  const mutationActionTypes = [
    "kernel.enable",
    "kernel.disable",
    "kernel.suspend",
    "kernel.resume",
    "kernel.retire"
  ];
  const schedulePolicy = {
    minLeadMinutes: settings.minScheduleLeadMinutes,
    maxWindowMinutes: settings.scheduleWindowMinutes,
    earliestScheduleAt: addMinutes(now, settings.minScheduleLeadMinutes),
    latestScheduleAt: addMinutes(now, settings.scheduleWindowMinutes),
    commandCooldownMinutes: settings.commandCooldownMinutes,
    maxPendingCommands: settings.maxPendingCommands
  };
  const actionCatalog = mutationActionTypes.map((type) => ({
    type,
    commandGroup: lifecycleCommandGroup(type),
    effect: commandEffect(type),
    requiredPermission: lifecycleCommandPermissionByType[type],
    reasonRequired: settings.disableRequiresReason && lifecycleCommandGroup(type) === "disable",
    schedulePolicy
  }));

  const controlledKernelMap = new Map(latestStates);
  for (const command of pendingKernelCommands) {
    if (controlledKernelMap.has(command.kernelId)) continue;
    controlledKernelMap.set(command.kernelId, {
      kernelId: command.kernelId,
      ownerId: command.ownerId,
      tenantId: command.tenantId,
      workspaceId: command.workspaceId,
      state: "unseen",
      updatedAt: command.requestedAt,
      lastEvent: "pending-lifecycle-command",
      lastProofRef: command.proofRef
    });
  }

  const controlsByKernel = Array.from(controlledKernelMap.values())
    .sort((a, b) => a.kernelId.localeCompare(b.kernelId))
    .map((kernel) => {
      const kernelPending = (pendingByKernel.get(kernel.kernelId) || [])
        .slice()
        .sort((a, b) => a.scheduleAt.localeCompare(b.scheduleAt) || a.commandId.localeCompare(b.commandId));
      const pendingRetire = kernelPending.find((command) => command.commandGroup === "retire");
      const cooldownActive = settings.commandCooldownMinutes > 0 &&
        minutesBetween(kernel.updatedAt, now) < settings.commandCooldownMinutes;
      const cooldownUntil = cooldownActive ? addMinutes(kernel.updatedAt, settings.commandCooldownMinutes) : null;
      const actionStates = mutationActionTypes.map((type) => {
        const commandGroup = lifecycleCommandGroup(type);
        const sameGroupPending = kernelPending.filter((command) => command.commandGroup === commandGroup);
        const oppositePending = kernelPending.filter((command) =>
          (commandGroup === "enable" && command.commandGroup === "disable") ||
          (commandGroup === "disable" && command.commandGroup === "enable")
        );
        const disabledReasons = [
          ...(settingsInvalid ? ["lifecycle-settings-invalid"] : []),
          ...(settings.lifecycleControlsEnabled ? [] : ["lifecycle-controls-disabled"]),
          ...(cooldownActive ? ["kernel-command-cooldown-active"] : []),
          ...(kernel.state === "retired" && type !== "kernel.retire" ? ["kernel-retired"] : []),
          ...(kernel.state === "hosted" && (type === "kernel.enable" || type === "kernel.resume") ? ["kernel-already-hosted"] : []),
          ...(kernel.state === "suspended" && (type === "kernel.disable" || type === "kernel.suspend") ? ["kernel-already-suspended"] : []),
          ...(type === "kernel.retire" && kernel.state === "hosted" && !settings.allowRetireFromHosted
            ? ["retire-requires-suspended-kernel"]
            : []),
          ...(pendingRetire && pendingRetire.type !== type ? ["retire-command-already-scheduled"] : []),
          ...(oppositePending.length ? ["opposing-lifecycle-command-pending"] : [])
        ];
        return {
          type,
          commandGroup,
          enabled: disabledReasons.length === 0,
          disabledReasons: Array.from(new Set(disabledReasons)),
          pendingCommandIds: sameGroupPending.map((command) => command.commandId),
          conflictingCommandIds: oppositePending.map((command) => command.commandId),
          cooldownUntil,
          nextPermittedScheduleAt: cooldownUntil && cooldownUntil.localeCompare(schedulePolicy.earliestScheduleAt) > 0
            ? cooldownUntil
            : schedulePolicy.earliestScheduleAt,
          requiresReason: settings.disableRequiresReason && commandGroup === "disable",
          expectedState: commandEffect(type)
        };
      });
      return {
        kernelId: kernel.kernelId,
        ownerId: kernel.ownerId,
        tenantId: kernel.tenantId,
        workspaceId: kernel.workspaceId,
        currentState: kernel.state,
        updatedAt: kernel.updatedAt,
        pendingCommandIds: kernelPending.map((command) => command.commandId),
        enabledActions: actionStates.filter((action) => action.enabled).map((action) => action.type),
        disabledActions: actionStates.filter((action) => !action.enabled).map((action) => action.type),
        actionStates
      };
    });

  const allowedActions = Array.from(new Set(controlsByKernel.flatMap((kernel) => kernel.enabledActions))).sort();
  const disabledActionReasons = countBy(
    controlsByKernel.flatMap((kernel) =>
      kernel.actionStates.flatMap((action) => action.disabledReasons.map((reason) => ({ reason })))
    ),
    (item) => item.reason
  );

  return {
    contractVersion: "hosted-kernel-owner-identity.lifecycle-action-controls.v1",
    generatedAt: now,
    status: settingsInvalid
      ? "settings-invalid"
      : allowedActions.length
        ? "actions-available"
        : controlsByKernel.length
          ? "actions-blocked"
          : "no-kernels",
    schedulePolicy,
    actionCatalog,
    controlsByKernel,
    allowedActions,
    disabledActionReasons,
    nextAllowedAction: controlsByKernel
      .flatMap((kernel) => kernel.actionStates
        .filter((action) => action.enabled)
        .map((action) => ({
          action: action.type,
          kernelId: kernel.kernelId,
          ownerId: kernel.ownerId,
          scheduleAt: action.nextPermittedScheduleAt,
          expectedState: action.expectedState
        })))
      .sort((a, b) => a.scheduleAt.localeCompare(b.scheduleAt) || a.kernelId.localeCompare(b.kernelId))[0] || null
  };
}

function validateStateTransition(command, currentKernel, settings) {
  const errors = [];
  const warnings = [];
  const state = currentKernel?.state || "unseen";
  if ((command.type === "kernel.enable" || command.type === "kernel.resume") && state === "hosted") {
    warnings.push("kernel-already-hosted");
  }
  if ((command.type === "kernel.disable" || command.type === "kernel.suspend") && state === "suspended") {
    warnings.push("kernel-already-suspended");
  }
  if (command.type !== "owner.verify" && command.type !== "owner.transfer" && state === "retired" && command.type !== "kernel.retire") {
    errors.push("cannot-change-retired-kernel");
  }
  if (command.type === "kernel.resume" && state === "retired") {
    errors.push("cannot-resume-retired-kernel");
  }
  if (command.type === "kernel.retire" && state === "retired") {
    warnings.push("kernel-already-retired");
  }
  if (command.type === "kernel.retire" && state === "hosted" && !settings.allowRetireFromHosted) {
    errors.push("retire-requires-suspended-kernel");
  }
  return { state, errors, warnings };
}

function isWithinScope(value, allowedValues) {
  return allowedValues.includes(value);
}

function evaluateWorkspaceBoundaryRecord({
  subjectType,
  subjectId,
  tenantId,
  workspaceId,
  workspaceScope,
  proofRef,
  tenantViolationCode = "tenant-outside-workspace-scope",
  workspaceViolationCode = "workspace-outside-workspace-scope"
}) {
  const normalizedTenantId = scopedText(tenantId, workspaceScope.tenantId);
  const normalizedWorkspaceId = scopedText(workspaceId, workspaceScope.workspaceId);
  const tenantInScope = workspaceScope.boundaryMode === "permissive" ||
    isWithinScope(normalizedTenantId, workspaceScope.allowedTenantIds);
  const workspaceInScope = workspaceScope.boundaryMode === "permissive" ||
    isWithinScope(normalizedWorkspaceId, workspaceScope.allowedWorkspaceIds);
  const violations = [
    ...(tenantInScope
      ? []
      : [{
          scope: subjectType,
          code: tenantViolationCode,
          subjectId,
          tenantId: normalizedTenantId,
          workspaceId: normalizedWorkspaceId,
          allowedTenantIds: workspaceScope.allowedTenantIds
        }]),
    ...(workspaceInScope
      ? []
      : [{
          scope: subjectType,
          code: workspaceViolationCode,
          subjectId,
          tenantId: normalizedTenantId,
          workspaceId: normalizedWorkspaceId,
          allowedWorkspaceIds: workspaceScope.allowedWorkspaceIds
        }])
  ];
  return {
    contractVersion: "hosted-kernel-owner-identity.workspace-boundary-evaluation.v1",
    subjectType,
    subjectId,
    tenantId: normalizedTenantId,
    workspaceId: normalizedWorkspaceId,
    mode: workspaceScope.boundaryMode,
    status: violations.length
      ? "blocked"
      : workspaceScope.boundaryMode === "permissive"
        ? "observed"
        : "within-boundary",
    tenantInScope,
    workspaceInScope,
    allowedTenantIds: workspaceScope.allowedTenantIds,
    allowedWorkspaceIds: workspaceScope.allowedWorkspaceIds,
    violations,
    proofRef: stableText(proofRef, `workspace-boundary:${subjectType}:${subjectId}:${workspaceScope.proofRef}`)
  };
}

function boundaryViolationCodes(boundaryEvaluation) {
  return boundaryEvaluation.violations.map((violation) => violation.code);
}

function scopedRelationshipViolations({ source, target, relationship, sourceLabel, targetLabel }) {
  if (!source || !target) return [];
  const codePrefix = targetLabel === "owner"
    ? "owner"
    : targetLabel === "target-owner"
      ? "owner-transfer-target"
      : targetLabel;
  return [
    ...(source.tenantId === target.tenantId
      ? []
      : [`${codePrefix}-tenant-boundary-violation`]),
    ...(source.workspaceId === target.workspaceId
      ? []
      : [`${codePrefix}-workspace-boundary-violation`])
  ].map((code) => ({
    code,
    relationship,
    source: {
      type: sourceLabel,
      tenantId: source.tenantId,
      workspaceId: source.workspaceId
    },
    target: {
      type: targetLabel,
      tenantId: target.tenantId,
      workspaceId: target.workspaceId
    }
  }));
}

function buildAuthorizationMetadata(command, owner, workspaceScope) {
  const actor = command.actorIdentity || normalizeAuthorizationSubject(command, command.ownerId, workspaceScope);
  const actorBoundary = evaluateWorkspaceBoundaryRecord({
    subjectType: "authorization-subject",
    subjectId: actor.actorId,
    tenantId: actor.tenantId,
    workspaceId: actor.workspaceId,
    workspaceScope,
    proofRef: actor.proofRef,
    tenantViolationCode: "actor-tenant-outside-workspace-scope",
    workspaceViolationCode: "actor-workspace-outside-workspace-scope"
  });
  const actorOwnerAligned = actor.ownerId === command.ownerId;
  const actorMatchesOwnerClaim = !owner ||
    actor.ownerId === owner.ownerId ||
    actor.actorId === owner.ownerId;
  const delegated = actor.delegated || !actorOwnerAligned || actor.subjectType !== "owner";
  const delegatedPermissionGranted = actor.effectivePermissions.includes(command.requiredPermission);
  const ownerClaimPermissionGranted = Boolean(owner?.effectivePermissions.includes(command.requiredPermission));
  const errors = [
    ...boundaryViolationCodes(actorBoundary),
    ...(actorMatchesOwnerClaim ? [] : ["actor-owner-claim-mismatch"]),
    ...(delegated && !delegatedPermissionGranted ? ["actor-missing-required-permission"] : []),
    ...(delegated && !actor.proofProvided ? ["actor-delegation-missing-proof"] : [])
  ];
  const warnings = [
    ...(delegated ? ["delegated-actor-authorizing-owner-command"] : []),
    ...(!owner && actor.subjectType === "owner" ? ["actor-owner-claim-unresolved"] : []),
    ...(delegated && ownerClaimPermissionGranted && !delegatedPermissionGranted
      ? ["owner-has-permission-but-actor-does-not"]
      : [])
  ];
  return {
    contractVersion: "hosted-kernel-owner-identity.authorization-metadata.v1",
    actorId: actor.actorId,
    subjectType: actor.subjectType,
    authorizationSource: actor.authorizationSource,
    delegated,
    ownerId: actor.ownerId,
    tenantId: actor.tenantId,
    workspaceId: actor.workspaceId,
    requiredPermission: command.requiredPermission,
    grantedPermissions: actor.effectivePermissions,
    permissionGranted: delegated ? delegatedPermissionGranted : ownerClaimPermissionGranted || delegatedPermissionGranted,
    ownerClaimPermissionGranted,
    delegatedPermissionGranted,
    ownerClaimMatched: actorMatchesOwnerClaim,
    boundary: actorBoundary,
    errors,
    warnings,
    proofProvided: actor.proofProvided,
    proofRef: actor.proofRef
  };
}

function buildPrivilegedJobAuthorizationState({ jobs, ownerIdentityRegistry, workspaceScope, now }) {
  const ownerMap = ownerIdentityRegistry?.ownerMap || new Map();
  const evaluatedJobs = jobs.map((job) => {
    const owner = ownerMap.get(job.ownerId);
    const jobBoundary = evaluateWorkspaceBoundaryRecord({
      subjectType: "privileged-job",
      subjectId: job.jobId,
      tenantId: job.tenantId,
      workspaceId: job.workspaceId,
      workspaceScope,
      proofRef: job.proofRef,
      tenantViolationCode: "job-tenant-outside-workspace-scope",
      workspaceViolationCode: "job-workspace-outside-workspace-scope"
    });
    const authorization = buildAuthorizationMetadata({
      commandId: job.jobId,
      type: job.type,
      ownerId: job.ownerId,
      actorIdentity: job.actorIdentity,
      requiredPermission: job.requiredPermission
    }, owner, workspaceScope);
    const ownerRelationshipFindings = scopedRelationshipViolations({
      source: job,
      target: owner,
      relationship: "owner",
      sourceLabel: "privileged-job",
      targetLabel: "owner"
    });
    const errors = [
      ...boundaryViolationCodes(jobBoundary),
      ...authorization.errors,
      ...(owner ? [] : ["job-owner-claim-missing"]),
      ...(ownerIdentityRegistry?.conflictingOwnerIds?.has(job.ownerId) ? ["job-owner-identity-conflict"] : []),
      ...(owner && !owner.effectivePermissions.includes(job.requiredPermission)
        ? ["job-owner-missing-required-permission"]
        : []),
      ...ownerRelationshipFindings.map((finding) => finding.code)
    ];
    const warnings = [
      ...authorization.warnings,
      ...(owner && !owner.verified ? ["job-owner-unverified"] : []),
      ...(privilegedJobPermissionByType[job.type] ? [] : ["job-type-uses-explicit-or-default-permission"])
    ];
    return {
      jobId: job.jobId,
      type: job.type,
      status: errors.length ? "blocked" : "authorized",
      requestedAt: job.requestedAt,
      ownerId: job.ownerId,
      kernelId: job.kernelId,
      tenantId: job.tenantId,
      workspaceId: job.workspaceId,
      actorId: authorization.actorId,
      actorSubjectType: authorization.subjectType,
      delegatedActor: authorization.delegated,
      requestAuthorization: job.requestAuthorization,
      requiredPermission: job.requiredPermission,
      permissionGranted: authorization.permissionGranted,
      authorization,
      boundary: {
        evaluation: jobBoundary,
        relationshipFindings: ownerRelationshipFindings,
        ownerTenantId: owner?.tenantId || null,
        ownerWorkspaceId: owner?.workspaceId || null,
        ownerVerified: Boolean(owner?.verified)
      },
      idempotencyKey: job.idempotencyKey,
      errors: Array.from(new Set(errors)),
      warnings: Array.from(new Set(warnings)),
      proofRef: job.proofRef
    };
  });
  const blockedJobs = evaluatedJobs.filter((job) => job.status === "blocked");
  const authorizedJobs = evaluatedJobs.filter((job) => job.status === "authorized");
  return {
    contractVersion: "hosted-kernel-owner-identity.privileged-job-authorization.v1",
    generatedAt: now,
    status: blockedJobs.length ? "blocked" : evaluatedJobs.length ? "authorized" : "idle",
    jobs: evaluatedJobs,
    authorizedJobIds: authorizedJobs.map((job) => job.jobId),
    blockedJobIds: blockedJobs.map((job) => job.jobId),
    authorizationErrors: blockedJobs.flatMap((job) =>
      job.errors.map((code) => ({
        scope: "privileged-job",
        code,
        jobId: job.jobId,
        ownerId: job.ownerId,
        kernelId: job.kernelId,
        proofRef: job.proofRef
      }))
    ),
    audit: {
      route: `${surfaceGroup}/${surfaceName}/privileged-job-authorization`,
      proofRefs: Array.from(new Set(evaluatedJobs.flatMap((job) => [
        job.proofRef,
        job.authorization?.proofRef
      ].filter(Boolean))))
    }
  };
}

function receiptMatchesPrivilegedJob(receipt, job) {
  return receipt.jobId === job.jobId ||
    receipt.idempotencyKey === job.idempotencyKey ||
    receipt.fingerprint === jobFingerprint(job);
}

function buildPrivilegedJobReceiptWrite(job, now) {
  const restartSafety = job.restartSafety || {};
  const durableReceiptIds = restartSafety.durableReceiptIds || [];
  const writeStatus = job.status === "completed-from-recovery"
    ? "completed"
    : job.status === "blocked"
      ? "rejected"
      : "accepted";
  return {
    receiptId: durableReceiptIds[0] || `owner-identity-privileged-job-receipt:${job.jobId}:${writeStatus}`,
    jobId: job.jobId,
    fingerprint: restartSafety.idempotencyKey || jobFingerprint(job),
    status: writeStatus,
    type: job.type,
    kernelId: job.kernelId,
    ownerId: job.ownerId,
    tenantId: job.tenantId,
    workspaceId: job.workspaceId,
    requiredPermission: job.requiredPermission,
    idempotencyKey: job.idempotencyKey,
    requestedAt: job.requestedAt,
    acceptedAt: job.requestedAt,
    completedAt: job.status === "completed-from-recovery" ? now : null,
    writeDisposition: durableReceiptIds.length
      ? "skip-existing-durable-job-receipt"
      : "persist-privileged-job-receipt",
    proofRef: durableReceiptIds.length
      ? restartSafety.proofRefs[0] || job.proofRef
      : `privileged-job-receipt:${job.jobId}:${writeStatus}`
  };
}

function buildRestartSafePrivilegedJobAuthorizationState({ privilegedJobAuthorizationState, persistedRuntimeState, now }) {
  const receiptsByJob = new Map();
  const recoveryTruth = persistedRuntimeState.recoveryTruth || {};
  const replayableReceipts = recoveryTruth.trustedForReceiptReplay === false
    ? []
    : persistedRuntimeState.privilegedJobReceipts || [];
  for (const receipt of replayableReceipts) {
    const bucket = receiptsByJob.get(receipt.jobId) || [];
    bucket.push(receipt);
    receiptsByJob.set(receipt.jobId, bucket);
  }

  const completedStatuses = new Set(["completed"]);
  const failedStatuses = new Set(["failed", "rejected"]);
  const jobs = privilegedJobAuthorizationState.jobs.map((job) => {
    const jobReceipts = [
      ...(receiptsByJob.get(job.jobId) || []),
      ...replayableReceipts.filter((receipt) =>
        receipt.jobId !== job.jobId && receiptMatchesPrivilegedJob(receipt, job)
      )
    ];
    const completedReceipt = jobReceipts.find((receipt) =>
      completedStatuses.has(receipt.status) && receiptMatchesPrivilegedJob(receipt, job)
    );
    const failedReceipt = jobReceipts.find((receipt) =>
      failedStatuses.has(receipt.status) && receiptMatchesPrivilegedJob(receipt, job)
    );
    const restartSafety = {
      idempotencyKey: jobFingerprint(job),
      durableReceiptIds: jobReceipts.map((receipt) => receipt.receiptId),
      persistedStatus: completedReceipt?.status || failedReceipt?.status || jobReceipts[0]?.status || "not-persisted",
      replayDisposition: completedReceipt
        ? "already-completed"
        : failedReceipt
          ? "previously-failed"
          : jobReceipts.length
            ? "receipt-observed"
            : "new-privileged-job",
      recoveredAt: now,
      failureCode: failedReceipt?.failureCode || null,
      proofRefs: jobReceipts.map((receipt) => receipt.proofRef)
    };

    if (completedReceipt) {
      return {
        ...job,
        status: "completed-from-recovery",
        warnings: Array.from(new Set([...job.warnings, "privileged-job-already-completed-from-persisted-receipt"])),
        restartSafety
      };
    }
    if (failedReceipt && job.status === "authorized") {
      return {
        ...job,
        status: "blocked",
        errors: Array.from(new Set([...job.errors, "privileged-job-previously-failed-before-restart"])),
        restartSafety
      };
    }
    return {
      ...job,
      restartSafety
    };
  });

  const authorizedJobs = jobs.filter((job) => job.status === "authorized");
  const completedJobs = jobs.filter((job) => job.status === "completed-from-recovery");
  const blockedJobs = jobs.filter((job) => job.status === "blocked");
  const receiptWrites = jobs.map((job) => buildPrivilegedJobReceiptWrite(job, now));
  const pendingWrites = receiptWrites.filter((receipt) => receipt.writeDisposition === "persist-privileged-job-receipt");

  return {
    ...privilegedJobAuthorizationState,
    status: blockedJobs.length
      ? "blocked"
      : authorizedJobs.length
        ? "authorized"
        : completedJobs.length
          ? "recovered-idempotent"
          : "idle",
    jobs,
    authorizedJobIds: authorizedJobs.map((job) => job.jobId),
    blockedJobIds: blockedJobs.map((job) => job.jobId),
    completedFromRecoveryJobIds: completedJobs.map((job) => job.jobId),
    restartRecovery: {
      contractVersion: "hosted-kernel-owner-identity.privileged-job-restart-recovery.v1",
      status: blockedJobs.length
        ? "recovered-with-job-blockers"
        : completedJobs.length
          ? "recovered-idempotent-jobs"
            : (persistedRuntimeState.privilegedJobReceipts || []).length
            ? recoveryTruth.trustedForReceiptReplay === false
              ? "receipt-replay-quarantined"
              : "recovered"
            : "cold-start",
      recoveredAt: now,
      bootId: persistedRuntimeState.bootId,
      storageKey: persistedRuntimeState.storageKey,
      recoveryTruth,
      completedJobIds: completedJobs.map((job) => job.jobId),
      blockedAfterRecoveryJobIds: blockedJobs.map((job) => job.jobId),
      newJobIds: jobs
        .filter((job) => job.restartSafety.replayDisposition === "new-privileged-job")
        .map((job) => job.jobId),
      observedReceiptIds: Array.from(new Set(jobs.flatMap((job) => job.restartSafety.durableReceiptIds))),
      proofRefs: Array.from(new Set([
        persistedRuntimeState.proofRef,
        ...replayableReceipts.map((receipt) => receipt.proofRef),
        ...jobs.flatMap((job) => job.restartSafety.proofRefs)
      ].filter(Boolean))),
      durableStateProjection: {
        status: pendingWrites.length ? "ready-to-persist" : "idempotent-no-new-job-writes",
        writeMode: pendingWrites.length ? "append-privileged-job-receipts" : "no-job-receipt-writes",
        privilegedJobReceiptWrites: pendingWrites.length,
        retainedJobReceipts: (persistedRuntimeState.privilegedJobReceipts || []).length
      }
    },
    durableReceiptWrites: receiptWrites
  };
}

function validateLifecycleCommand(command, { ownerMap, latestStates, settings, workspaceScope, now, ownerIdentityRegistry, kernelOwnerBindings }) {
  const owner = ownerMap.get(command.ownerId);
  const targetOwner = command.targetOwnerId ? ownerMap.get(command.targetOwnerId) : null;
  const currentKernel = latestStates.get(command.kernelId);
  const kernelOwnerBinding = kernelOwnerBindings?.bindings?.find((binding) => binding.kernelId === command.kernelId) || null;
  const scheduling = scheduleState(command, settings, now);
  const transition = validateStateTransition(command, currentKernel, settings);
  const commandBoundary = evaluateWorkspaceBoundaryRecord({
    subjectType: "lifecycle-command",
    subjectId: command.commandId,
    tenantId: command.tenantId,
    workspaceId: command.workspaceId,
    workspaceScope,
    proofRef: command.proofRef
  });
  const authorization = buildAuthorizationMetadata(command, owner, workspaceScope);
  const relationshipBoundaryFindings = [
    ...scopedRelationshipViolations({
      source: command,
      target: owner,
      relationship: "owner",
      sourceLabel: "lifecycle-command",
      targetLabel: "owner"
    }),
    ...scopedRelationshipViolations({
      source: command,
      target: targetOwner,
      relationship: "owner-transfer",
      sourceLabel: "lifecycle-command",
      targetLabel: "target-owner"
    }),
    ...scopedRelationshipViolations({
      source: command,
      target: currentKernel,
      relationship: "kernel",
      sourceLabel: "lifecycle-command",
      targetLabel: "kernel"
    })
  ];
  const errors = [];
  const warnings = [];

  if (!settings.lifecycleControlsEnabled && command.type !== "owner.verify") {
    errors.push("lifecycle-controls-disabled");
  }
  errors.push(...boundaryViolationCodes(commandBoundary));
  errors.push(...authorization.errors);
  warnings.push(...authorization.warnings);
  if (ownerIdentityRegistry?.conflictingOwnerIds?.has(command.ownerId)) {
    errors.push("owner-identity-conflict");
  }
  if (kernelOwnerBinding?.status === "blocked") {
    errors.push(...kernelOwnerBinding.bindingErrors);
  }
  if (kernelOwnerBinding && kernelOwnerBinding.ownerId !== command.ownerId) {
    errors.push("command-owner-does-not-match-kernel-owner-binding");
  }
  if (command.targetOwnerId && ownerIdentityRegistry?.conflictingOwnerIds?.has(command.targetOwnerId)) {
    errors.push("owner-transfer-target-identity-conflict");
  }
  if (!owner) {
    errors.push("unknown-owner");
  } else if (
    command.type !== "owner.verify" &&
    settings.ownerVerificationRequired &&
    !settings.allowUnverifiedOwnerHosting &&
    !owner.verified
  ) {
    errors.push("owner-not-verified");
  } else if (owner) {
    errors.push(...relationshipBoundaryFindings
      .filter((finding) => finding.relationship === "owner")
      .map((finding) => finding.code));
    if (!owner.effectivePermissions.includes(command.requiredPermission)) {
      errors.push("owner-missing-required-permission");
    }
  }
  if (command.type === "owner.transfer") {
    if (!command.targetOwnerId) {
      errors.push("owner-transfer-missing-target-owner");
    } else if (!targetOwner) {
      errors.push("owner-transfer-target-unknown");
    } else {
      if (targetOwner.ownerId === command.ownerId) {
        warnings.push("owner-transfer-target-is-current-owner");
      }
      errors.push(...relationshipBoundaryFindings
        .filter((finding) => finding.relationship === "owner-transfer")
        .map((finding) => finding.code));
      if (settings.ownerVerificationRequired && !targetOwner.verified) {
        errors.push("owner-transfer-target-not-verified");
      }
      if (!targetOwner.effectivePermissions.includes("kernel.lifecycle.handoff")) {
        errors.push("owner-transfer-target-missing-handoff-permission");
      }
    }
    if (currentKernel && currentKernel.ownerId !== command.ownerId) {
      errors.push("owner-transfer-source-not-current-kernel-owner");
    }
  }
  errors.push(...relationshipBoundaryFindings
    .filter((finding) => finding.relationship === "kernel")
    .map((finding) => finding.code));
  if (settings.disableRequiresReason && lifecycleCommandGroup(command.type) === "disable" && !reasonIsExplicit(command)) {
    errors.push("disable-command-requires-explicit-reason");
  }
  if (minutesBetween(command.requestedAt, command.scheduleAt) < 0) {
    errors.push("schedule-before-request");
  }
  if (!scheduling.withinLeadPolicy) {
    errors.push("schedule-lead-time-below-policy");
  }
  if (!scheduling.withinWindowPolicy) {
    errors.push("schedule-outside-policy-window");
  }
  if (
    settings.commandCooldownMinutes > 0 &&
    currentKernel?.updatedAt &&
    minutesBetween(currentKernel.updatedAt, command.requestedAt) < settings.commandCooldownMinutes
  ) {
    errors.push("kernel-command-cooldown-active");
  }
  errors.push(...transition.errors);
  warnings.push(...transition.warnings);

  return {
    commandId: command.commandId,
    type: command.type,
    kernelId: command.kernelId,
    ownerId: command.ownerId,
    tenantId: command.tenantId,
    workspaceId: command.workspaceId,
    requestedAt: command.requestedAt,
    scheduleAt: command.scheduleAt,
    commandGroup: lifecycleCommandGroup(command.type),
    effect: commandEffect(command.type),
    currentState: currentKernel?.state || "unseen",
    requiredPermission: command.requiredPermission,
    authorization,
    requestAuthorization: command.requestAuthorization,
    scheduling,
    controls: {
      lifecycleControlsEnabled: settings.lifecycleControlsEnabled,
      disableRequiresReason: settings.disableRequiresReason,
      allowRetireFromHosted: settings.allowRetireFromHosted,
      commandCooldownMinutes: settings.commandCooldownMinutes
    },
    boundary: {
      mode: workspaceScope.boundaryMode,
      evaluation: commandBoundary,
      relationshipFindings: relationshipBoundaryFindings,
      ownerIdentityStatus: ownerIdentityRegistry?.status || "unknown",
      kernelOwnerBindingStatus: kernelOwnerBinding?.status || "unbound",
      ownerIdentityConflict: Boolean(ownerIdentityRegistry?.conflictingOwnerIds?.has(command.ownerId)),
      targetOwnerIdentityConflict: Boolean(command.targetOwnerId && ownerIdentityRegistry?.conflictingOwnerIds?.has(command.targetOwnerId)),
      kernelOwnerBinding: kernelOwnerBinding
        ? {
            bindingId: kernelOwnerBinding.bindingId,
            status: kernelOwnerBinding.status,
            ownerId: kernelOwnerBinding.ownerId,
            ownerVerified: kernelOwnerBinding.ownerVerified,
            bindingErrors: kernelOwnerBinding.bindingErrors,
            proofRefs: kernelOwnerBinding.proofRefs
          }
        : null,
      ownerTenantId: owner?.tenantId || null,
      ownerWorkspaceId: owner?.workspaceId || null,
      targetOwnerTenantId: targetOwner?.tenantId || null,
      targetOwnerWorkspaceId: targetOwner?.workspaceId || null,
      kernelTenantId: currentKernel?.tenantId || null,
      kernelWorkspaceId: currentKernel?.workspaceId || null
    },
    transfer: command.type === "owner.transfer"
      ? {
          sourceOwnerId: command.ownerId,
          targetOwnerId: command.targetOwnerId,
          targetVerified: Boolean(targetOwner?.verified),
          targetHasHandoffPermission: Boolean(targetOwner?.effectivePermissions.includes("kernel.lifecycle.handoff")),
          transferProofRef: command.transferProofRef,
          currentKernelOwnerId: currentKernel?.ownerId || null
        }
      : null,
    status: errors.length ? "blocked" : "ready",
    errors,
    warnings,
    proofRef: command.proofRef
  };
}

function buildOwnerTransferContract({ owners, lifecycleControlState, timeline, workspaceScope, now }) {
  const ownerMap = new Map(owners.map((owner) => [owner.ownerId, owner]));
  const latestStates = getLatestKernelStates(timeline);
  const transferCommands = lifecycleControlState.pendingCommands.filter((command) => command.type === "owner.transfer");
  const transferEvents = timeline.filter((event) => event.label === "owner.transferred");
  const transfers = transferCommands.map((command) => {
    const sourceOwner = ownerMap.get(command.ownerId);
    const targetOwner = command.transfer?.targetOwnerId ? ownerMap.get(command.transfer.targetOwnerId) : null;
    const kernel = latestStates.get(command.kernelId) || null;
    const blockingReasons = command.errors.filter((error) => error.includes("transfer") || error.includes("boundary"));
    return {
      transferId: `owner-transfer:${command.commandId}`,
      commandId: command.commandId,
      kernelId: command.kernelId,
      sourceOwnerId: command.ownerId,
      sourceOwnerVerified: Boolean(sourceOwner?.verified),
      targetOwnerId: command.transfer?.targetOwnerId || null,
      targetOwnerVerified: Boolean(targetOwner?.verified),
      tenantId: command.tenantId,
      workspaceId: command.workspaceId,
      status: command.status === "ready" && !blockingReasons.length ? "ready-for-handoff" : "blocked",
      scheduledAt: command.scheduleAt,
      currentKernelOwnerId: kernel?.ownerId || null,
      blockingReasons,
      proofRefs: [command.proofRef, command.transfer?.transferProofRef].filter(Boolean)
    };
  });
  const readyTransfers = transfers.filter((transfer) => transfer.status === "ready-for-handoff");
  const blockedTransfers = transfers.filter((transfer) => transfer.status === "blocked");

  return {
    contractVersion: "hosted-kernel-owner-identity.owner-transfer.v1",
    generatedAt: now,
    workspace: {
      tenantId: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      boundaryMode: workspaceScope.boundaryMode
    },
    summary: {
      requestedTransfers: transfers.length,
      readyTransfers: readyTransfers.length,
      blockedTransfers: blockedTransfers.length,
      observedTransferEvents: transferEvents.length
    },
    transfers,
    observedTransfers: transferEvents.map((event) => ({
      eventId: event.eventId,
      at: event.at,
      kernelId: event.kernelId,
      ownerId: event.ownerId,
      proofRef: event.proofRef
    })),
    nextHandoff: readyTransfers
      .slice()
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.commandId.localeCompare(b.commandId))[0] || null,
    audit: {
      status: blockedTransfers.length ? "blocked" : readyTransfers.length ? "ready" : "idle",
      proofRefs: Array.from(new Set(transfers.flatMap((transfer) => transfer.proofRefs))),
      route: `${surfaceGroup}/${surfaceName}/owner-transfer-handoff`
    }
  };
}

function buildLifecycleControlState({ commands, owners, timeline, settings, workspaceScope, now, persistedRuntimeState, ownerIdentityRegistry }) {
  const ownerMap = ownerIdentityRegistry?.ownerMap || new Map(owners.map((owner) => [owner.ownerId, owner]));
  const timelineStates = getLatestKernelStates(timeline);
  const recoveredKernelState = mergePersistedKernelStates(
    timelineStates,
    persistedRuntimeState?.kernelStates || [],
    persistedRuntimeState?.recoveryTruth || null
  );
  const latestStates = recoveredKernelState.states;
  const kernelOwnerBindings = buildKernelOwnerBindings({
    latestStates,
    ownerIdentityRegistry,
    now
  });
  const settingsControlState = buildLifecycleSettingsControlState(settings, commands);
  const basePending = commands.slice(0, settings.maxPendingCommands).map((command) =>
    validateLifecycleCommand(command, { ownerMap, latestStates, settings, workspaceScope, now, ownerIdentityRegistry, kernelOwnerBindings })
  );
  const queueControls = buildLifecycleQueueControls(basePending, settings, now);
  const pending = basePending.map((command) => applyLifecycleQueueControls(command, queueControls));
  const refreshedQueueControls = buildLifecycleQueueControls(pending, settings, now);
  const actionControlState = buildLifecycleActionControlState({
    settings,
    settingsControlState,
    pendingCommands: pending,
    latestStates,
    now
  });
  const blocked = pending.filter((command) => command.status === "blocked");
  const ready = pending.filter((command) => command.status === "ready");
  const nextReady = ready
    .slice()
    .sort((a, b) => a.scheduleAt.localeCompare(b.scheduleAt) || a.commandId.localeCompare(b.commandId))[0];

  return {
    enabled: settings.lifecycleControlsEnabled,
    policy: settings,
    settingsControlState,
    actionControls: actionControlState,
    queueControls: refreshedQueueControls,
    recoveredKernelState: {
      contractVersion: "hosted-kernel-owner-identity.recovered-kernel-state.v1",
      source: persistedRuntimeState?.kernelStates?.length ? "timeline-and-persisted-state" : "timeline-only",
      trustLevel: persistedRuntimeState?.recoveryTruth?.trustLevel || "unknown",
      trustedForKernelRecovery: persistedRuntimeState?.recoveryTruth?.trustedForKernelRecovery !== false,
      restoredKernelIds: recoveredKernelState.recoveryFindings
        .filter((finding) => finding.status === "persisted-state-restored")
        .map((finding) => finding.kernelId),
      supersededTimelineKernelIds: recoveredKernelState.recoveryFindings
        .filter((finding) => finding.status === "persisted-state-superseded-timeline")
        .map((finding) => finding.kernelId),
      findings: recoveredKernelState.recoveryFindings
    },
    kernelOwnerBindings,
    pendingCommands: pending,
    queue: {
      accepted: ready.length,
      blocked: blocked.length,
      dueNow: refreshedQueueControls.queueBuckets.dueNowCommandIds.length,
      scheduled: refreshedQueueControls.queueBuckets.scheduledCommandIds.length,
      conflicts: refreshedQueueControls.conflicts.filter((conflict) => conflict.errors.length).length,
      warnings: refreshedQueueControls.conflicts.filter((conflict) => conflict.warnings.length).length,
      truncated: Math.max(0, commands.length - settings.maxPendingCommands)
    },
    nextAction: nextReady
      ? {
      action: nextReady.type,
      commandId: nextReady.commandId,
      queueBucket: nextReady.scheduling.state === "due" ? "due-now" : "scheduled",
      commandGroup: nextReady.commandGroup,
      kernelId: nextReady.kernelId,
      ownerId: nextReady.ownerId,
      tenantId: nextReady.tenantId,
      workspaceId: nextReady.workspaceId,
      dueAt: nextReady.scheduleAt,
      scheduleState: nextReady.scheduling.state,
      minutesUntilDue: nextReady.scheduling.minutesUntilDue,
      expectedState: nextReady.effect,
      proofRef: nextReady.proofRef
        }
      : {
          action: settingsControlState.validation.status === "invalid"
            ? "repair-lifecycle-settings"
            : blocked.length
              ? "resolve-blocked-lifecycle-command"
              : actionControlState.nextAllowedAction
                ? actionControlState.nextAllowedAction.action
              : "await-lifecycle-command",
          settingsErrors: settingsControlState.validation.errors,
          blockedCommandIds: blocked.map((command) => command.commandId),
          nextAllowedAction: actionControlState.nextAllowedAction,
          dueAt: now
        }
  };
}

function receiptMatchesCommand(receipt, command) {
  return receipt.commandId === command.commandId || receipt.fingerprint === commandFingerprint(command);
}

function receiptRetentionStatus(receipt, pendingCommands) {
  const matchingCommand = pendingCommands.find((command) => receiptMatchesCommand(receipt, command));
  if (matchingCommand) return "retain-active-command-receipt";
  if (receipt.status === "applied" || receipt.status === "completed") return "retain-applied-audit-receipt";
  if (receipt.status === "failed" || receipt.status === "rejected") return "retain-failure-audit-receipt";
  return "eligible-for-compaction";
}

function buildDurableRuntimeStateProjection({ lifecycleControlState, privilegedJobAuthorizationState, persistedRuntimeState, now }) {
  const commandReceiptWrites = lifecycleControlState.pendingCommands.map((command) => {
    const idempotencyKey = command.restartSafety?.idempotencyKey || commandFingerprint(command);
    const observedReceiptIds = command.restartSafety?.durableReceiptIds || [];
    const alreadyDurable = command.status === "replayed" || observedReceiptIds.length > 0;
    const writeStatus = command.status === "ready"
      ? "accepted"
      : command.status === "replayed"
        ? "completed"
        : command.status === "blocked"
          ? "rejected"
          : "accepted";
    return {
      receiptId: observedReceiptIds[0] || `owner-identity-command-receipt:${command.commandId}:${writeStatus}`,
      commandId: command.commandId,
      fingerprint: idempotencyKey,
      status: writeStatus,
      type: command.type,
      kernelId: command.kernelId,
      ownerId: command.ownerId,
      targetOwnerId: command.transfer?.targetOwnerId || "",
      tenantId: command.tenantId,
      workspaceId: command.workspaceId,
      scheduleAt: command.scheduleAt,
      acceptedAt: command.requestedAt,
      appliedAt: command.status === "replayed" ? now : null,
      effect: command.effect,
      writeDisposition: alreadyDurable ? "skip-existing-durable-receipt" : "persist-command-receipt",
      proofRef: observedReceiptIds.length
        ? command.restartSafety.proofRefs[0] || command.proofRef
        : `command-receipt:${command.commandId}:${writeStatus}`
    };
  });
  const retainedReceiptRefs = persistedRuntimeState.commandReceipts.map((receipt) => ({
    receiptId: receipt.receiptId,
    commandId: receipt.commandId,
    status: receipt.status,
    retention: receiptRetentionStatus(receipt, lifecycleControlState.pendingCommands),
    proofRef: receipt.proofRef
  }));
  const privilegedJobReceiptWrites = privilegedJobAuthorizationState?.durableReceiptWrites || [];
  const retainedPrivilegedJobReceiptRefs = (persistedRuntimeState.privilegedJobReceipts || []).map((receipt) => ({
    receiptId: receipt.receiptId,
    jobId: receipt.jobId,
    status: receipt.status,
    retention: privilegedJobAuthorizationState?.jobs?.some((job) => receiptMatchesPrivilegedJob(receipt, job))
      ? "retain-active-privileged-job-receipt"
      : receipt.status === "completed"
        ? "retain-completed-job-audit-receipt"
        : receipt.status === "failed" || receipt.status === "rejected"
          ? "retain-failure-job-audit-receipt"
          : "eligible-for-compaction",
    proofRef: receipt.proofRef
  }));
  const projectedKernelStates = Array.from(
    new Map([
      ...persistedRuntimeState.kernelStates.map((kernel) => [kernel.kernelId, kernel]),
      ...lifecycleControlState.pendingCommands
        .filter((command) => command.status === "ready" || command.status === "replayed")
        .map((command) => [command.kernelId, {
          kernelId: command.kernelId,
          ownerId: command.transfer?.targetOwnerId || command.ownerId,
          tenantId: command.tenantId,
          workspaceId: command.workspaceId,
          state: command.effect === "owner-transfer" || command.effect === "owner-verification"
            ? command.currentState
            : command.effect,
          updatedAt: command.scheduleAt,
          lastEvent: command.type,
          lastProofRef: command.proofRef
        }])
    ]).values()
  ).sort((a, b) => a.kernelId.localeCompare(b.kernelId));
  const pendingCommandWrites = commandReceiptWrites.filter((receipt) => receipt.writeDisposition === "persist-command-receipt");
  const pendingJobWrites = privilegedJobReceiptWrites.filter((receipt) =>
    receipt.writeDisposition === "persist-privileged-job-receipt"
  );
  const pendingWrites = [...pendingCommandWrites, ...pendingJobWrites];
  return {
    contractVersion: "hosted-kernel-owner-identity.durable-runtime-state-projection.v1",
    generatedAt: now,
    storageKey: persistedRuntimeState.storageKey,
    bootId: persistedRuntimeState.bootId,
    snapshotId: `owner-identity-runtime:${persistedRuntimeState.bootId}:${now}`,
    writeMode: pendingCommandWrites.length && pendingJobWrites.length
      ? "append-command-and-job-receipts-and-snapshot"
      : pendingCommandWrites.length
        ? "append-command-receipts-and-snapshot"
        : pendingJobWrites.length
          ? "append-privileged-job-receipts-and-snapshot"
          : "snapshot-only",
    status: lifecycleControlState.queue.blocked || privilegedJobAuthorizationState?.blockedJobIds?.length
      ? "blocked-writes-require-review"
      : pendingWrites.length
        ? "ready-to-persist"
        : "idempotent-no-new-runtime-writes",
    recoveryWatermark: now,
    commandReceiptWrites,
    privilegedJobReceiptWrites,
    retainedReceiptRefs,
    retainedPrivilegedJobReceiptRefs,
    kernelStates: projectedKernelStates,
    compaction: {
      eligibleReceiptIds: retainedReceiptRefs
        .filter((receipt) => receipt.retention === "eligible-for-compaction")
        .map((receipt) => receipt.receiptId),
      eligiblePrivilegedJobReceiptIds: retainedPrivilegedJobReceiptRefs
        .filter((receipt) => receipt.retention === "eligible-for-compaction")
        .map((receipt) => receipt.receiptId),
      retainedReceiptIds: retainedReceiptRefs
        .filter((receipt) => receipt.retention !== "eligible-for-compaction")
        .map((receipt) => receipt.receiptId),
      retainedPrivilegedJobReceiptIds: retainedPrivilegedJobReceiptRefs
        .filter((receipt) => receipt.retention !== "eligible-for-compaction")
        .map((receipt) => receipt.receiptId)
    },
    audit: {
      route: `${surfaceGroup}/${surfaceName}/persisted-runtime-state`,
      proofRefs: Array.from(new Set([
        persistedRuntimeState.proofRef,
        ...commandReceiptWrites.map((receipt) => receipt.proofRef),
        ...privilegedJobReceiptWrites.map((receipt) => receipt.proofRef),
        ...projectedKernelStates.map((kernel) => kernel.lastProofRef)
      ].filter(Boolean)))
    }
  };
}

function buildRestartSafeLifecycleState({ lifecycleControlState, privilegedJobAuthorizationState, persistedRuntimeState, now }) {
  const receiptsByCommand = new Map();
  const recoveryTruth = persistedRuntimeState.recoveryTruth || {};
  const replayableReceipts = recoveryTruth.trustedForReceiptReplay === false
    ? []
    : persistedRuntimeState.commandReceipts;
  for (const receipt of replayableReceipts) {
    const bucket = receiptsByCommand.get(receipt.commandId) || [];
    bucket.push(receipt);
    receiptsByCommand.set(receipt.commandId, bucket);
  }

  const replayableStatuses = new Set(["applied", "completed"]);
  const failedStatuses = new Set(["failed", "rejected"]);
  const pendingCommands = lifecycleControlState.pendingCommands.map((command) => {
    const commandReceipts = [
      ...(receiptsByCommand.get(command.commandId) || []),
      ...replayableReceipts.filter((receipt) =>
        receipt.commandId !== command.commandId && receipt.fingerprint === commandFingerprint(command)
      )
    ];
    const appliedReceipt = commandReceipts.find((receipt) =>
      replayableStatuses.has(receipt.status) && receiptMatchesCommand(receipt, command)
    );
    const failedReceipt = commandReceipts.find((receipt) =>
      failedStatuses.has(receipt.status) && receiptMatchesCommand(receipt, command)
    );
    const restartSafety = {
      idempotencyKey: commandFingerprint(command),
      durableReceiptIds: commandReceipts.map((receipt) => receipt.receiptId),
      persistedStatus: appliedReceipt?.status || failedReceipt?.status || commandReceipts[0]?.status || "not-persisted",
      replayDisposition: appliedReceipt
        ? "already-applied"
        : failedReceipt
          ? "previously-failed"
          : commandReceipts.length
            ? "receipt-observed"
            : "new-command",
      recoveredAt: now,
      proofRefs: commandReceipts.map((receipt) => receipt.proofRef)
    };

    if (appliedReceipt) {
      return {
        ...command,
        status: "replayed",
        warnings: Array.from(new Set([...command.warnings, "command-already-applied-from-persisted-receipt"])),
        restartSafety
      };
    }
    if (failedReceipt && command.status === "ready") {
      return {
        ...command,
        status: "blocked",
        errors: Array.from(new Set([...command.errors, "command-previously-failed-before-restart"])),
        restartSafety
      };
    }
    return {
      ...command,
      restartSafety
    };
  });

  const ready = pendingCommands.filter((command) => command.status === "ready");
  const blocked = pendingCommands.filter((command) => command.status === "blocked");
  const replayed = pendingCommands.filter((command) => command.status === "replayed");
  const nextReady = ready
    .slice()
    .sort((a, b) => a.scheduleAt.localeCompare(b.scheduleAt) || a.commandId.localeCompare(b.commandId))[0];
  const durableStateProjection = buildDurableRuntimeStateProjection({
    lifecycleControlState: {
      ...lifecycleControlState,
      pendingCommands,
      queue: {
        ...lifecycleControlState.queue,
        accepted: ready.length,
        blocked: blocked.length,
        replayed: replayed.length,
        restartRecovered: persistedRuntimeState.commandReceipts.length
      }
    },
    privilegedJobAuthorizationState,
    persistedRuntimeState,
    now
  });

  return {
    ...lifecycleControlState,
    pendingCommands,
    queue: {
      ...lifecycleControlState.queue,
      accepted: ready.length,
      blocked: blocked.length,
      replayed: replayed.length,
      restartRecovered: persistedRuntimeState.commandReceipts.length
    },
    nextAction: nextReady
      ? {
          ...lifecycleControlState.nextAction,
          action: nextReady.type,
          commandId: nextReady.commandId,
          queueBucket: nextReady.scheduling.state === "due" ? "due-now" : "scheduled",
          commandGroup: nextReady.commandGroup,
          kernelId: nextReady.kernelId,
          ownerId: nextReady.ownerId,
          tenantId: nextReady.tenantId,
          workspaceId: nextReady.workspaceId,
          dueAt: nextReady.scheduleAt,
          scheduleState: nextReady.scheduling.state,
          minutesUntilDue: nextReady.scheduling.minutesUntilDue,
          expectedState: nextReady.effect,
          proofRef: nextReady.proofRef
        }
      : {
          action: blocked.length
            ? "resolve-blocked-lifecycle-command"
            : replayed.length
              ? "await-new-lifecycle-command-after-replay"
              : lifecycleControlState.nextAction.action,
          blockedCommandIds: blocked.map((command) => command.commandId),
          replayedCommandIds: replayed.map((command) => command.commandId),
          dueAt: now
        },
    restartRecovery: {
      contractVersion: "hosted-kernel-owner-identity.restart-recovery.v1",
      status: blocked.length
        ? "recovered-with-blockers"
        : replayed.length
          ? "recovered-idempotent"
          : persistedRuntimeState.commandReceipts.length || persistedRuntimeState.kernelStates.length
            ? "recovered"
            : "cold-start",
      recoveredAt: now,
      bootId: persistedRuntimeState.bootId,
      storageKey: persistedRuntimeState.storageKey,
      recoveryWatermark: persistedRuntimeState.recoveryWatermark,
      replayedCommandIds: replayed.map((command) => command.commandId),
      blockedAfterRecoveryCommandIds: blocked.map((command) => command.commandId),
      newCommandIds: pendingCommands
        .filter((command) => command.restartSafety.replayDisposition === "new-command")
        .map((command) => command.commandId),
      persistedKernelStates: persistedRuntimeState.kernelStates,
      proofRefs: Array.from(new Set([
        persistedRuntimeState.proofRef,
        ...durableStateProjection.audit.proofRefs,
        ...persistedRuntimeState.commandReceipts.map((receipt) => receipt.proofRef),
        ...persistedRuntimeState.kernelStates.map((kernel) => kernel.lastProofRef)
      ])),
      durableStateProjection: {
        status: durableStateProjection.status,
        snapshotId: durableStateProjection.snapshotId,
        writeMode: durableStateProjection.writeMode,
        commandReceiptWrites: durableStateProjection.commandReceiptWrites.length,
        privilegedJobReceiptWrites: durableStateProjection.privilegedJobReceiptWrites.length,
        retainedReceipts: durableStateProjection.retainedReceiptRefs.length,
        retainedPrivilegedJobReceipts: durableStateProjection.retainedPrivilegedJobReceiptRefs.length,
        projectedKernelStates: durableStateProjection.kernelStates.length
      }
    },
    durableStateProjection
  };
}

function buildProviderServiceContractState({ providers, owners, timeline, lifecycleControlState, workspaceScope, now }) {
  const verifiedOwnerIds = new Set(owners.filter((owner) => owner.verified).map((owner) => owner.ownerId));
  const latestStates = getLatestKernelStates(timeline);
  const activeKernels = Array.from(latestStates.values()).filter((kernel) => kernel.state === "hosted");
  const readyCommands = lifecycleControlState.pendingCommands.filter((command) => command.status === "ready");
  const baseAvailable = new Set(["owner.claim.read", "kernel.lifecycle.read", "audit.proof.read"]);

  if (owners.length) baseAvailable.add("owner.claim.write");
  if (verifiedOwnerIds.size) baseAvailable.add("owner.verify.request");
  if (lifecycleControlState.enabled && activeKernels.length) {
    baseAvailable.add("kernel.lifecycle.command");
  }
  if (lifecycleControlState.queue.accepted > 0 || lifecycleControlState.queue.blocked > 0) {
    baseAvailable.add("kernel.lifecycle.handoff");
  }

  const contracts = providers.map((provider) => {
    const requested = provider.requestedCapabilities.length
      ? provider.requestedCapabilities
      : Array.from(ownerIdentityCapabilities);
    const providerBoundary = evaluateWorkspaceBoundaryRecord({
      subjectType: "provider-contract",
      subjectId: provider.providerId,
      tenantId: provider.tenantId,
      workspaceId: provider.workspaceId,
      workspaceScope,
      proofRef: provider.proofRef,
      tenantViolationCode: "provider-tenant-outside-workspace-scope",
      workspaceViolationCode: "provider-workspace-outside-workspace-scope"
    });
    const tenantInScope = providerBoundary.tenantInScope;
    const workspaceInScope = providerBoundary.workspaceInScope;
    const providerInScope = providerBoundary.status !== "blocked";
    const granted = providerInScope
      ? requested.filter((capability) => ownerIdentityCapabilities.has(capability) && baseAvailable.has(capability))
      : [];
    const denied = requested.filter((capability) => !granted.includes(capability));
    const mailchimpProfile = buildMailchimpOwnerProviderProfile({
      ...provider,
      requestedCapabilities: granted
    });
    const missingRequired = Array.from(new Set([
      ...provider.requiredCapabilities.filter((capability) => !granted.includes(capability)),
      ...(mailchimpProfile?.missingCapabilities || [])
    ]));
    const lastSyncedAt = provider.lastSyncedAt || now;
    const syncLagSeconds = Math.max(0, Math.round((new Date(now).getTime() - new Date(lastSyncedAt).getTime()) / 1000));
    const syncStale = syncLagSeconds > provider.syncIntervalMinutes * 60;
    const needsCallback = provider.deliveryMode !== "pull";
    const hasCallback = Boolean(provider.callbackEndpoint);
    const authReady = provider.authMode !== "manual-review";
    const handoffEligible = providerInScope &&
      !missingRequired.length &&
      authReady &&
      (!needsCallback || hasCallback) &&
      provider.handoffMode !== "audit-only";
    const deniedReasons = requested
      .filter((capability) => !granted.includes(capability))
      .map((capability) => ({
        capability,
        reason: !ownerIdentityCapabilities.has(capability)
          ? "unknown-capability"
          : !baseAvailable.has(capability)
            ? "capability-not-currently-available"
            : providerInScope
              ? "not-granted"
              : "provider-outside-workspace-boundary"
      }));
    const providerReadyCommands = handoffEligible ? readyCommands.slice(0, provider.maxBatchSize) : [];
    const contractIssues = [
      ...(providerInScope ? [] : ["provider-outside-workspace-boundary"]),
      ...(missingRequired.length ? ["provider-missing-required-capabilities"] : []),
      ...(authReady ? [] : ["provider-auth-mode-requires-manual-review"]),
      ...(needsCallback && !hasCallback ? ["provider-callback-endpoint-required"] : []),
      ...(syncStale ? ["provider-sync-stale"] : []),
      ...(mailchimpProfile && !mailchimpProfile.webhookReady ? ["mailchimp-webhook-contract-required"] : []),
      ...(mailchimpProfile && mailchimpProfile.handoffMode === "audit-only" ? ["mailchimp-handoff-audit-only"] : [])
    ];
    const handoffState = !providerInScope
      ? "blocked-by-workspace-boundary"
      : missingRequired.length
        ? "requires-capability-resolution"
        : !authReady
          ? "requires-auth-activation"
          : needsCallback && !hasCallback
            ? "requires-callback-endpoint"
            : lifecycleControlState.nextAction.action === "await-lifecycle-command"
              ? "idle"
              : provider.handoffMode === "audit-only"
                ? "audit-observe-only"
                : "ready";

    return {
      providerId: provider.providerId,
      displayName: provider.displayName,
      contractVersion: provider.contractVersion,
      endpoint: provider.endpoint,
      callbackEndpoint: provider.callbackEndpoint || null,
      status: contractIssues.some((issue) => issue !== "provider-sync-stale") ? "blocked" : "negotiated",
      tenantId: provider.tenantId,
      workspaceId: provider.workspaceId,
      authentication: {
        mode: provider.authMode,
        status: authReady ? "active" : "manual-review-required",
        proofRequired: provider.authMode === "signed-webhook" || provider.authMode === "mtls"
      },
      boundary: {
        mode: workspaceScope.boundaryMode,
        tenantInScope,
        workspaceInScope,
        status: providerBoundary.status,
        reason: providerInScope ? "within-workspace-boundary" : "outside-workspace-boundary",
        evaluation: providerBoundary
      },
      grantedCapabilities: granted,
      deniedCapabilities: denied,
      deniedCapabilityReasons: deniedReasons,
      missingRequiredCapabilities: missingRequired,
      contractIssues,
      mailchimp: mailchimpProfile,
      sync: {
        cursor: provider.syncCursor,
        lastSyncedAt,
        lagSeconds: syncLagSeconds,
        stale: syncStale,
        intervalMinutes: provider.syncIntervalMinutes,
        nextSyncAt: now,
        watermark: timeline.at(-1)?.at || now,
        deliveryMode: provider.deliveryMode,
        maxBatchSize: provider.maxBatchSize,
        routes: {
          pull: provider.endpoint,
          push: provider.callbackEndpoint || null,
          acknowledgement: `${surfaceGroup}/${surfaceName}/providers/${provider.providerId}/sync-ack`
        }
      },
      externalHandoff: {
        mode: provider.handoffMode,
        state: handoffState,
        nextAction: lifecycleControlState.nextAction.action,
        commandIds: providerReadyCommands.map((command) => command.commandId),
        lease: handoffEligible && providerReadyCommands.length
          ? {
              leaseId: `provider-handoff:${provider.providerId}:${provider.syncCursor}`,
              issuedAt: now,
              expiresAt: addMinutes(now, provider.syncIntervalMinutes),
              maxCommands: provider.maxBatchSize,
              commandCount: providerReadyCommands.length,
              acknowledgementRoute: `${surfaceGroup}/${surfaceName}/providers/${provider.providerId}/handoff-ack`
            }
          : null,
        payloadContract: {
          contractVersion: "hosted-kernel-owner-provider.handoff-payload.v1",
          includes: ["providerId", "workspace", "capabilities", "commands", "proofRefs"],
          commandFields: ["commandId", "type", "kernelId", "ownerId", "scheduleAt", "effect", "proofRef"],
          proofRefs: Array.from(new Set([
            provider.proofRef,
            ...providerReadyCommands.map((command) => command.proofRef)
          ]))
        },
        proofRef: provider.proofRef
      }
    };
  });

  const blocked = contracts.filter((contract) => contract.status === "blocked");
  const stale = contracts.filter((contract) => contract.sync.stale);
  const mailchimpReporting = buildMailchimpProviderReporting({ contracts, now });
  return {
    contractVersion: "hosted-kernel-owner-provider.v1",
    availableCapabilities: Array.from(baseAvailable).sort(),
    knownCapabilities: Array.from(ownerIdentityCapabilities).sort(),
    providers: contracts,
    syncMetadata: {
      generatedAt: now,
      providerCount: providers.length,
      negotiated: contracts.length - blocked.length,
      blocked: blocked.length,
      stale: stale.length,
      latestLifecycleWatermark: timeline.at(-1)?.at || now,
      nextSyncAt: contracts
        .map((contract) => contract.sync.nextSyncAt)
        .sort()[0] || now
    },
    mailchimpReporting,
    externalHandoffState: {
      state: blocked.length ? "blocked-provider-contracts" : contracts.some((contract) => contract.externalHandoff.state === "ready") ? "ready" : "idle",
      blockedProviderIds: blocked.map((contract) => contract.providerId),
      staleProviderIds: stale.map((contract) => contract.providerId),
      readyProviderIds: contracts
        .filter((contract) => contract.externalHandoff.state === "ready")
        .map((contract) => contract.providerId)
    }
  };
}

function buildWorkspaceBoundaryState({ workspaceScope, owners, events, commands, providers, lifecycleControlState, providerServiceContracts, ownerIdentityRegistry, privilegedJobAuthorizationState, now }) {
  const ownerBoundaryEvaluations = ownerIdentityRegistry?.ownerBoundaryEvaluations || owners.map((owner) => evaluateWorkspaceBoundaryRecord({
    subjectType: "owner-claim",
    subjectId: owner.ownerId,
    tenantId: owner.tenantId,
    workspaceId: owner.workspaceId,
    workspaceScope,
    proofRef: owner.proofRef,
    tenantViolationCode: "owner-outside-workspace-boundary",
    workspaceViolationCode: "owner-outside-workspace-boundary"
  }));
  const eventBoundaryEvaluations = events.map((event) => evaluateWorkspaceBoundaryRecord({
    subjectType: "lifecycle-event",
    subjectId: event.eventId,
    tenantId: event.tenantId,
    workspaceId: event.workspaceId,
    workspaceScope,
    proofRef: event.proofRef,
    tenantViolationCode: "event-outside-workspace-boundary",
    workspaceViolationCode: "event-outside-workspace-boundary"
  }));
  const commandBoundaryEvaluations = lifecycleControlState.pendingCommands.map((command) =>
    command.boundary.evaluation || evaluateWorkspaceBoundaryRecord({
      subjectType: "lifecycle-command",
      subjectId: command.commandId,
      tenantId: command.tenantId,
      workspaceId: command.workspaceId,
      workspaceScope,
      proofRef: command.proofRef
    })
  );
  const providerBoundaryEvaluations = providerServiceContracts.providers.map((contract) =>
    contract.boundary.evaluation || evaluateWorkspaceBoundaryRecord({
      subjectType: "provider-contract",
      subjectId: contract.providerId,
      tenantId: contract.tenantId,
      workspaceId: contract.workspaceId,
      workspaceScope,
      proofRef: contract.externalHandoff.proofRef,
      tenantViolationCode: "provider-tenant-outside-workspace-scope",
      workspaceViolationCode: "provider-workspace-outside-workspace-scope"
    })
  );
  const jobBoundaryEvaluations = (privilegedJobAuthorizationState?.jobs || []).map((job) =>
    job.boundary.evaluation || evaluateWorkspaceBoundaryRecord({
      subjectType: "privileged-job",
      subjectId: job.jobId,
      tenantId: job.tenantId,
      workspaceId: job.workspaceId,
      workspaceScope,
      proofRef: job.proofRef,
      tenantViolationCode: "job-tenant-outside-workspace-scope",
      workspaceViolationCode: "job-workspace-outside-workspace-scope"
    })
  );
  const ownerViolations = ownerIdentityRegistry?.ownerBoundaryViolations || ownerBoundaryEvaluations.flatMap((evaluation) =>
    evaluation.violations.map((violation) => ({
      ...violation,
      ownerId: evaluation.subjectId,
      code: "owner-outside-workspace-boundary",
      proofRef: evaluation.proofRef
    }))
  );
  const eventViolations = eventBoundaryEvaluations.flatMap((evaluation) =>
    evaluation.violations.map((violation) => ({
      ...violation,
      eventId: evaluation.subjectId,
      code: "event-outside-workspace-boundary",
      proofRef: evaluation.proofRef
    }))
  );
  const commandBoundaryBlocks = lifecycleControlState.pendingCommands.filter((command) =>
    command.errors.some((error) => error.includes("boundary") || error.includes("workspace-scope"))
  );
  const providerBoundaryBlocks = providerServiceContracts.providers.filter(
    (contract) => contract.boundary.status === "blocked" || contract.boundary.reason === "outside-workspace-boundary"
  );
  const jobBoundaryBlocks = (privilegedJobAuthorizationState?.jobs || []).filter((job) =>
    job.errors.some((error) => error.includes("boundary") || error.includes("workspace-scope"))
  );
  const allBoundaryEvaluations = [
    ...ownerBoundaryEvaluations,
    ...eventBoundaryEvaluations,
    ...commandBoundaryEvaluations,
    ...providerBoundaryEvaluations,
    ...jobBoundaryEvaluations
  ];
  return {
    contractVersion: "hosted-kernel-owner-identity.workspace-boundary.v1",
    generatedAt: now,
    scope: workspaceScope,
    isolation: {
      mode: workspaceScope.boundaryMode,
      status: ownerViolations.length || eventViolations.length || commandBoundaryBlocks.length || providerBoundaryBlocks.length || jobBoundaryBlocks.length
        ? "blocked"
        : "enforced",
      allowedTenantIds: workspaceScope.allowedTenantIds,
      allowedWorkspaceIds: workspaceScope.allowedWorkspaceIds
    },
    evaluations: allBoundaryEvaluations,
    violations: [
      ...ownerViolations.map((owner) => ({
        scope: "owner-claim",
        code: owner.code,
        ownerId: owner.ownerId,
        tenantId: owner.tenantId,
        workspaceId: owner.workspaceId,
        proofRef: owner.proofRef
      })),
      ...eventViolations.map((event) => ({
        scope: "lifecycle-event",
        code: event.code,
        eventId: event.eventId,
        tenantId: event.tenantId,
        workspaceId: event.workspaceId,
        proofRef: event.proofRef
      })),
      ...commandBoundaryBlocks.map((command) => ({
        scope: "lifecycle-command",
        code: "command-boundary-blocked",
        commandId: command.commandId,
        errors: command.errors,
        tenantId: command.tenantId,
        workspaceId: command.workspaceId,
        proofRef: command.boundary.evaluation?.proofRef || command.proofRef,
        relationshipFindings: command.boundary.relationshipFindings || []
      })),
      ...providerBoundaryBlocks.map((contract) => ({
        scope: "provider-contract",
        code: "provider-outside-workspace-boundary",
        providerId: contract.providerId,
        tenantId: contract.tenantId,
        workspaceId: contract.workspaceId,
        proofRef: contract.boundary.evaluation?.proofRef || contract.externalHandoff.proofRef
      })),
      ...jobBoundaryBlocks.map((job) => ({
        scope: "privileged-job",
        code: "job-boundary-blocked",
        jobId: job.jobId,
        errors: job.errors,
        tenantId: job.tenantId,
        workspaceId: job.workspaceId,
        proofRef: job.boundary.evaluation?.proofRef || job.proofRef,
        relationshipFindings: job.boundary.relationshipFindings || []
      }))
    ],
    auditHandoff: {
      contractVersion: "hosted-kernel-owner-identity.boundary-audit-handoff.v1",
      route: workspaceScope.auditChannel,
      proofRef: workspaceScope.proofRef,
      ownerIdentityRegistryStatus: ownerIdentityRegistry?.status || "unknown",
      ambiguousOwnerIds: ownerIdentityRegistry?.ambiguousOwnerIds || [],
      providerIds: providers.map((provider) => provider.providerId),
      commandIds: commands.map((command) => command.commandId),
      privilegedJobIds: (privilegedJobAuthorizationState?.jobs || []).map((job) => job.jobId),
      blockedCommandIds: commandBoundaryBlocks.map((command) => command.commandId),
      blockedProviderIds: providerBoundaryBlocks.map((contract) => contract.providerId),
      blockedPrivilegedJobIds: jobBoundaryBlocks.map((job) => job.jobId),
      evaluationProofRefs: Array.from(new Set(allBoundaryEvaluations.map((evaluation) => evaluation.proofRef))),
      violationSubjects: allBoundaryEvaluations
        .filter((evaluation) => evaluation.violations.length)
        .map((evaluation) => ({
          subjectType: evaluation.subjectType,
          subjectId: evaluation.subjectId,
          tenantId: evaluation.tenantId,
          workspaceId: evaluation.workspaceId,
          codes: evaluation.violations.map((violation) => violation.code),
          proofRef: evaluation.proofRef
        }))
    }
  };
}

function buildHistorySnapshots(events, owners, now) {
  const ownerMap = new Map(owners.map((owner) => [owner.ownerId, owner]));
  const snapshots = [];
  const kernelState = new Map();
  const runningCounters = {
    hosted: 0,
    resumed: 0,
    suspended: 0,
    retired: 0,
    ownerTransfers: 0,
    ownerVerifications: 0
  };
  let previousHostedCount = 0;
  for (const event of buildTimeline(events)) {
    const nextState = deriveKernelState(event.label);
    if (event.label === "kernel.hosted") runningCounters.hosted += 1;
    if (event.label === "kernel.resumed") runningCounters.resumed += 1;
    if (event.label === "kernel.suspended") runningCounters.suspended += 1;
    if (event.label === "kernel.retired") runningCounters.retired += 1;
    if (event.label === "owner.transferred") runningCounters.ownerTransfers += 1;
    if (event.label === "owner.verified") runningCounters.ownerVerifications += 1;
    kernelState.set(event.kernelId, {
      kernelId: event.kernelId,
      ownerId: event.ownerId,
      ownerDisplayName: ownerMap.get(event.ownerId)?.displayName || event.ownerId,
      state: nextState,
      lastEvent: event.label,
      lastProofRef: event.proofRef,
      updatedAt: event.at
    });
    const kernels = Array.from(kernelState.values());
    const hostedKernelCount = kernels.filter((kernel) => kernel.state === "hosted").length;
    const terminalKernelCount = kernels.filter((kernel) => terminalKernelStates.has(kernel.state)).length;
    snapshots.push({
      snapshotId: `owner-identity-history:${event.sequence}`,
      sequence: event.sequence,
      capturedAt: event.at,
      triggeringEvent: {
        eventId: event.eventId,
        type: event.label,
        ownerId: event.ownerId,
        kernelId: event.kernelId,
        proofRef: event.proofRef
      },
      activeOwners: owners.filter((owner) => owner.verified).length,
      totalOwners: owners.length,
      ownerDisplayName: ownerMap.get(event.ownerId)?.displayName || event.ownerId,
      counters: {
        ...runningCounters,
        knownKernels: kernels.length,
        hostedKernels: hostedKernelCount,
        terminalKernels: terminalKernelCount
      },
      delta: {
        hostedKernelCount: hostedKernelCount - previousHostedCount,
        stateChange: `${event.kernelId}:${nextState}`
      },
      kernels
    });
    previousHostedCount = hostedKernelCount;
  }
  if (!snapshots.length) {
    snapshots.push({
      snapshotId: "owner-identity-history:empty",
      sequence: 0,
      capturedAt: now,
      triggeringEvent: null,
      activeOwners: owners.filter((owner) => owner.verified).length,
      totalOwners: owners.length,
      ownerDisplayName: owners[0]?.displayName || "unassigned",
      counters: {
        ...runningCounters,
        knownKernels: 0,
        hostedKernels: 0,
        terminalKernels: 0
      },
      delta: {
        hostedKernelCount: 0,
        stateChange: "none"
      },
      kernels: []
    });
  }
  return snapshots;
}

function countBy(values, selectKey) {
  const counts = {};
  for (const value of values) {
    const key = stableText(selectKey(value), "unknown");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function buildTimelineBuckets(timeline) {
  const buckets = new Map();
  for (const event of timeline) {
    const day = event.at.slice(0, 10);
    const bucket = buckets.get(day) || {
      day,
      events: 0,
      hosted: 0,
      suspended: 0,
      retired: 0,
      ownerTransfers: 0,
      proofRefs: []
    };
    bucket.events += 1;
    if (event.label === "kernel.hosted" || event.label === "kernel.resumed") bucket.hosted += 1;
    if (event.label === "kernel.suspended") bucket.suspended += 1;
    if (event.label === "kernel.retired") bucket.retired += 1;
    if (event.label === "owner.transferred") bucket.ownerTransfers += 1;
    bucket.proofRefs.push(event.proofRef);
    buckets.set(day, bucket);
  }
  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket,
    proofRefs: Array.from(new Set(bucket.proofRefs)).sort()
  }));
}

function authorizationFailureCodes(record) {
  const explicitErrors = Array.isArray(record.errors) ? record.errors : [];
  const authorizationErrors = Array.isArray(record.authorization?.errors)
    ? record.authorization.errors
    : [];
  return Array.from(new Set([...explicitErrors, ...authorizationErrors])).sort();
}

function authorizationExportRow(record, source) {
  const authorization = record.authorization || {};
  const failureCodes = authorizationFailureCodes(record);
  const permissionGranted = Boolean(authorization.permissionGranted ?? record.permissionGranted);
  const requestAuthorization = record.requestAuthorization || {};
  return {
    source,
    decisionId: source === "lifecycle-command" ? record.commandId : record.jobId,
    type: record.type,
    status: record.status,
    ownerId: record.ownerId,
    actorId: authorization.actorId || record.actorId || record.actor || record.ownerId,
    actorSubjectType: authorization.subjectType || record.actorSubjectType || "owner",
    delegatedActor: Boolean(authorization.delegated ?? record.delegatedActor),
    requiredPermission: record.requiredPermission,
    permissionGranted,
    decision: failureCodes.length || !permissionGranted ? "denied" : "granted",
    kernelId: record.kernelId,
    tenantId: record.tenantId,
    workspaceId: record.workspaceId,
    failureCodes,
    warningCodes: Array.isArray(record.warnings) ? record.warnings : [],
    proofRef: record.proofRef,
    authorizationProofRef: authorization.proofRef || null,
    requestId: requestAuthorization.requestId || null,
    sessionId: requestAuthorization.sessionId || null,
    authorizationSource: requestAuthorization.source || authorization.authorizationSource || "unknown",
    adoptedClientAuthorization: Boolean(requestAuthorization.adopted)
  };
}

function buildAuthorizationReportingState({ lifecycleControlState, privilegedJobAuthorizationState, now }) {
  const commandRows = lifecycleControlState.pendingCommands.map((command) =>
    authorizationExportRow(command, "lifecycle-command")
  );
  const jobRows = (privilegedJobAuthorizationState?.jobs || []).map((job) =>
    authorizationExportRow(job, "privileged-job")
  );
  const rows = [...commandRows, ...jobRows].sort((a, b) =>
    a.source.localeCompare(b.source) ||
    a.requiredPermission.localeCompare(b.requiredPermission) ||
    a.decisionId.localeCompare(b.decisionId)
  );
  const deniedRows = rows.filter((row) => row.decision === "denied");
  const delegatedRows = rows.filter((row) => row.delegatedActor);
  const permissionDeniedRows = deniedRows.filter((row) =>
    row.failureCodes.some((code) => code.includes("permission")) || !row.permissionGranted
  );
  const proofMissingRows = deniedRows.filter((row) =>
    row.failureCodes.some((code) => code.includes("proof"))
  );
  const boundaryDeniedRows = deniedRows.filter((row) =>
    row.failureCodes.some((code) => code.includes("boundary") || code.includes("workspace-scope"))
  );
  const ownerIntegrityDeniedRows = deniedRows.filter((row) =>
    row.failureCodes.some((code) => code.includes("owner-identity") || code.includes("owner-claim") || code.includes("kernel-owner"))
  );

  return {
    contractVersion: "hosted-kernel-owner-identity.authorization-reporting.v1",
    generatedAt: now,
    status: deniedRows.length ? "review-required" : rows.length ? "complete" : "idle",
    counters: {
      authorizationDecisions: rows.length,
      grantedAuthorizationDecisions: rows.length - deniedRows.length,
      deniedAuthorizationDecisions: deniedRows.length,
      delegatedAuthorizationDecisions: delegatedRows.length,
      lifecycleCommandAuthorizationDecisions: commandRows.length,
      privilegedJobAuthorizationDecisions: jobRows.length,
      permissionDeniedDecisions: permissionDeniedRows.length,
      proofMissingDecisions: proofMissingRows.length,
      boundaryDeniedDecisions: boundaryDeniedRows.length,
      ownerIntegrityDeniedDecisions: ownerIntegrityDeniedRows.length
    },
    byRequiredPermission: countBy(rows, (row) => row.requiredPermission),
    byActorSubjectType: countBy(rows, (row) => row.actorSubjectType),
    byDecision: countBy(rows, (row) => row.decision),
    deniedDecisionIds: deniedRows.map((row) => row.decisionId),
    delegatedDecisionIds: delegatedRows.map((row) => row.decisionId),
    failureCodeSummary: countBy(
      deniedRows.flatMap((row) => row.failureCodes.map((code) => ({ code }))),
      (item) => item.code
    ),
    exportRows: rows,
    audit: {
      route: `${surfaceGroup}/${surfaceName}/authorization-reporting`,
      proofRefs: Array.from(new Set(rows.flatMap((row) => [
        row.proofRef,
        row.authorizationProofRef
      ].filter(Boolean)))).sort()
    }
  };
}

function buildAnalytics({ events, owners, evidence, timeline, lifecycleControlState, ownerTransferState, providerServiceContracts, workspaceBoundaryState, ownerIdentityRegistry, privilegedJobAuthorizationState, now }) {
  const latestKernelStates = Array.from(getLatestKernelStates(timeline).values());
  const readyCommands = lifecycleControlState.pendingCommands.filter((command) => command.status === "ready");
  const blockedCommands = lifecycleControlState.pendingCommands.filter((command) => command.status === "blocked");
  const privilegedJobs = privilegedJobAuthorizationState?.jobs || [];
  const authorizationReporting = buildAuthorizationReportingState({
    lifecycleControlState,
    privilegedJobAuthorizationState,
    now
  });
  const proofReferences = new Set([
    ...owners.map((owner) => owner.proofRef),
    ...events.map((event) => event.proofRef),
    ...lifecycleControlState.pendingCommands.map((command) => command.proofRef),
    ...privilegedJobs.flatMap((job) => [job.proofRef, job.authorization?.proofRef].filter(Boolean)),
    ...authorizationReporting.audit.proofRefs,
    ...providerServiceContracts.providers.map((contract) => contract.externalHandoff.proofRef),
    ...evidence.map((item) => stableText(item?.proofRef || item?.id || item))
  ]);
  const counters = {
    ownerClaims: owners.length,
    uniqueOwnerClaims: ownerIdentityRegistry?.ownerMap?.size || new Set(owners.map((owner) => owner.ownerId)).size,
    duplicateOwnerClaimGroups: ownerIdentityRegistry?.duplicateClaimGroups?.length || 0,
    conflictingOwnerIdentityClaims: ownerIdentityRegistry?.ambiguousOwnerIds?.length || 0,
    kernelOwnerBindings: lifecycleControlState.kernelOwnerBindings.bindings.length,
    blockedKernelOwnerBindings: lifecycleControlState.kernelOwnerBindings.blockedKernelIds.length,
    unverifiedKernelOwnerBindings: lifecycleControlState.kernelOwnerBindings.unverifiedKernelIds.length,
    verifiedOwners: owners.filter((owner) => owner.verified).length,
    unverifiedOwners: owners.filter((owner) => !owner.verified).length,
    knownKernels: latestKernelStates.length,
    hostedKernels: latestKernelStates.filter((kernel) => kernel.state === "hosted").length,
    suspendedKernels: latestKernelStates.filter((kernel) => kernel.state === "suspended").length,
    retiredKernels: latestKernelStates.filter((kernel) => kernel.state === "retired").length,
    hostedKernelEvents: events.filter((event) => event.type === "kernel.hosted").length,
    resumedKernelEvents: events.filter((event) => event.type === "kernel.resumed").length,
    transferEvents: events.filter((event) => event.type === "owner.transferred").length,
    suspendedOrRetiredKernels: events.filter((event) => terminalKernelStates.has(deriveKernelState(event.type))).length,
    readyLifecycleCommands: readyCommands.length,
    blockedLifecycleCommands: blockedCommands.length,
    privilegedJobs: privilegedJobs.length,
    authorizedPrivilegedJobs: privilegedJobs.filter((job) => job.status === "authorized").length,
    completedPrivilegedJobsFromRecovery: privilegedJobs.filter((job) => job.status === "completed-from-recovery").length,
    blockedPrivilegedJobs: privilegedJobs.filter((job) => job.status === "blocked").length,
    delegatedActorCommands: lifecycleControlState.pendingCommands.filter((command) => command.authorization?.delegated).length,
    delegatedActorJobs: privilegedJobs.filter((job) => job.authorization?.delegated).length,
    actorAuthorizationFailures: lifecycleControlState.pendingCommands.filter((command) =>
      command.authorization?.errors?.length
    ).length + privilegedJobs.filter((job) => job.authorization?.errors?.length).length,
    authorizationDecisions: authorizationReporting.counters.authorizationDecisions,
    grantedAuthorizationDecisions: authorizationReporting.counters.grantedAuthorizationDecisions,
    deniedAuthorizationDecisions: authorizationReporting.counters.deniedAuthorizationDecisions,
    delegatedAuthorizationDecisions: authorizationReporting.counters.delegatedAuthorizationDecisions,
    permissionDeniedDecisions: authorizationReporting.counters.permissionDeniedDecisions,
    proofMissingDecisions: authorizationReporting.counters.proofMissingDecisions,
    boundaryDeniedDecisions: authorizationReporting.counters.boundaryDeniedDecisions,
    ownerIntegrityDeniedDecisions: authorizationReporting.counters.ownerIntegrityDeniedDecisions,
    dueLifecycleCommands: lifecycleControlState.queue.dueNow,
    scheduledLifecycleCommands: lifecycleControlState.queue.scheduled,
    lifecycleQueueConflicts: lifecycleControlState.queue.conflicts,
    requestedOwnerTransfers: ownerTransferState.summary.requestedTransfers,
    readyOwnerTransfers: ownerTransferState.summary.readyTransfers,
    blockedOwnerTransfers: ownerTransferState.summary.blockedTransfers,
    observedOwnerTransferEvents: ownerTransferState.summary.observedTransferEvents,
    negotiatedProviders: providerServiceContracts.syncMetadata.negotiated,
    blockedProviders: providerServiceContracts.syncMetadata.blocked,
    mailchimpProviders: providerServiceContracts.mailchimpReporting.counters.providers,
    mailchimpReadyProviders: providerServiceContracts.mailchimpReporting.counters.readyProviders,
    mailchimpBlockedProviders: providerServiceContracts.mailchimpReporting.counters.blockedProviders,
    mailchimpWebhookBlockedProviders: providerServiceContracts.mailchimpReporting.counters.webhookBlockedProviders,
    mailchimpSyncStaleProviders: providerServiceContracts.mailchimpReporting.counters.syncStaleProviders,
    mailchimpHandoffCommandCount: providerServiceContracts.mailchimpReporting.counters.handoffCommandCount,
    workspaceBoundaryViolations: workspaceBoundaryState.violations.length,
    workspaceBoundaryEvaluations: workspaceBoundaryState.evaluations.length,
    proofReferences: proofReferences.size
  };
  return {
    contractVersion: "hosted-kernel-owner-identity.analytics-report.v1",
    generatedAt: now,
    counters,
    verificationRate: counters.ownerClaims ? counters.verifiedOwners / counters.ownerClaims : 0,
    hostedKernelRate: counters.knownKernels ? counters.hostedKernels / counters.knownKernels : 0,
    commandAcceptanceRate: lifecycleControlState.pendingCommands.length
      ? counters.readyLifecycleCommands / lifecycleControlState.pendingCommands.length
      : 0,
    hasTransferHistory: counters.transferEvents > 0,
    hasHostedKernelHistory: counters.hostedKernelEvents > 0,
    byOwner: countBy(events, (event) => event.ownerId),
    byKernel: countBy(events, (event) => event.kernelId),
    byEventType: countBy(events, (event) => event.type),
    authorizationReporting,
    timelineBuckets: buildTimelineBuckets(timeline),
    reportingState: {
      status: workspaceBoundaryState.violations.length ||
        blockedCommands.length ||
        privilegedJobAuthorizationState?.blockedJobIds?.length ||
        providerServiceContracts.syncMetadata.blocked ||
        providerServiceContracts.mailchimpReporting.status === "attention" ||
        lifecycleControlState.kernelOwnerBindings.status === "blocked" ||
        authorizationReporting.status === "review-required"
        ? "attention"
        : "ready",
      latestLifecycleWatermark: providerServiceContracts.syncMetadata.latestLifecycleWatermark,
      mailchimpProviderStatus: providerServiceContracts.mailchimpReporting.status,
      mailchimpNextActions: providerServiceContracts.mailchimpReporting.nextActions,
      latestEventAt: timeline.at(-1)?.at || null,
      exportReady: owners.length > 0 && timeline.length > 0,
      proofCoverage: {
        expectedRecords: owners.length + events.length + lifecycleControlState.pendingCommands.length + privilegedJobs.length + providerServiceContracts.providers.length,
        uniqueProofRefs: proofReferences.size,
        complete: proofReferences.size >= owners.length + events.length &&
          ownerIdentityRegistry?.status !== "blocked" &&
          lifecycleControlState.kernelOwnerBindings.status !== "blocked"
      }
    }
  };
}

function buildExportSummary({ now, owners, events, evidence, analytics, snapshots, lifecycleControlState, ownerTransferState, providerServiceContracts, workspaceBoundaryState, ownerIdentityRegistry, privilegedJobAuthorizationState, operationalHealth, restartRecovery }) {
  const timelineRows = events
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at) || a.eventId.localeCompare(b.eventId))
    .map((event, index) => ({
      sequence: index + 1,
      at: event.at,
      type: event.type,
      ownerId: event.ownerId,
      kernelId: event.kernelId,
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      proofRef: event.proofRef
    }));
  const ownerRows = owners.map((owner) => ({
    ownerId: owner.ownerId,
    displayName: owner.displayName,
    verified: owner.verified,
    verifiedAt: owner.verifiedAt,
    tenantId: owner.tenantId,
    workspaceId: owner.workspaceId,
    roles: owner.roles,
    permissions: owner.effectivePermissions,
    proofRef: owner.proofRef
  }));
  const commandRows = lifecycleControlState.pendingCommands.map((command) => ({
    commandId: command.commandId,
    type: command.type,
    status: command.status,
    ownerId: command.ownerId,
    actorId: command.authorization?.actorId || command.actor || command.ownerId,
    actorSubjectType: command.authorization?.subjectType || "owner",
    authorizationSource: command.requestAuthorization?.source || command.authorization?.authorizationSource || "unknown",
    requestId: command.requestAuthorization?.requestId || null,
    sessionId: command.requestAuthorization?.sessionId || null,
    adoptedClientAuthorization: Boolean(command.requestAuthorization?.adopted),
    delegatedActor: Boolean(command.authorization?.delegated),
    requiredPermission: command.requiredPermission,
    permissionGranted: Boolean(command.authorization?.permissionGranted),
    kernelId: command.kernelId,
    tenantId: command.tenantId,
    workspaceId: command.workspaceId,
    kernelOwnerBindingStatus: command.boundary?.kernelOwnerBinding?.status || "unbound",
    kernelOwnerBindingErrors: command.boundary?.kernelOwnerBinding?.bindingErrors || [],
    scheduleAt: command.scheduleAt,
    errors: command.errors,
    warnings: command.warnings,
    proofRef: command.proofRef,
    authorizationProofRef: command.authorization?.proofRef || null
  }));
  const jobHealthById = new Map((operationalHealth?.actionableErrors || [])
    .filter((issue) => issue.scope === "privileged-job" && issue.jobId)
    .map((issue) => [issue.jobId, issue]));
  const privilegedJobRows = (privilegedJobAuthorizationState?.jobs || []).map((job) => ({
    jobId: job.jobId,
    type: job.type,
    status: job.status,
    ownerId: job.ownerId,
    actorId: job.actorId,
    actorSubjectType: job.actorSubjectType,
    authorizationSource: job.requestAuthorization?.source || job.authorization?.authorizationSource || "unknown",
    requestId: job.requestAuthorization?.requestId || null,
    sessionId: job.requestAuthorization?.sessionId || null,
    adoptedClientAuthorization: Boolean(job.requestAuthorization?.adopted),
    delegatedActor: job.delegatedActor,
    requiredPermission: job.requiredPermission,
    permissionGranted: job.permissionGranted,
    kernelId: job.kernelId,
    tenantId: job.tenantId,
    workspaceId: job.workspaceId,
    requestedAt: job.requestedAt,
    idempotencyKey: job.idempotencyKey,
    restartSafety: job.restartSafety || null,
    errors: job.errors,
    warnings: job.warnings,
    failureState: jobHealthById.get(job.jobId)?.failureState || null,
    retryable: Boolean(jobHealthById.get(job.jobId)?.retryable),
    retryAfter: jobHealthById.get(job.jobId)?.retryAfter || null,
    retryAttempts: jobHealthById.get(job.jobId)?.retry?.attempts || 0,
    retryAttemptsRemaining: jobHealthById.get(job.jobId)?.retry?.attemptsRemaining || null,
    retryDisposition: jobHealthById.get(job.jobId)?.retryDisposition || null,
    remediation: jobHealthById.get(job.jobId)?.remediation || null,
    proofRef: job.proofRef,
    authorizationProofRef: job.authorization?.proofRef || null
  }));
  const kernelOwnerBindingRows = lifecycleControlState.kernelOwnerBindings.bindings.map((binding) => ({
    bindingId: binding.bindingId,
    kernelId: binding.kernelId,
    ownerId: binding.ownerId,
    ownerDisplayName: binding.ownerDisplayName,
    ownerVerified: binding.ownerVerified,
    status: binding.status,
    kernelState: binding.kernelState,
    tenantId: binding.tenantId,
    workspaceId: binding.workspaceId,
    bindingErrors: binding.bindingErrors,
    proofRefs: binding.proofRefs
  }));
  const authorizationRows = analytics.authorizationReporting.exportRows.map((row) => ({
    source: row.source,
    decisionId: row.decisionId,
    type: row.type,
    status: row.status,
    decision: row.decision,
    ownerId: row.ownerId,
    actorId: row.actorId,
    actorSubjectType: row.actorSubjectType,
    authorizationSource: row.authorizationSource,
    requestId: row.requestId,
    sessionId: row.sessionId,
    adoptedClientAuthorization: row.adoptedClientAuthorization,
    delegatedActor: row.delegatedActor,
    requiredPermission: row.requiredPermission,
    permissionGranted: row.permissionGranted,
    kernelId: row.kernelId,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    failureCodes: row.failureCodes,
    warningCodes: row.warningCodes,
    proofRef: row.proofRef,
    authorizationProofRef: row.authorizationProofRef
  }));
  const mailchimpProviderRows = providerServiceContracts.mailchimpReporting.rows.map((row) => ({
    providerId: row.providerId,
    displayName: row.displayName,
    status: row.status,
    readiness: row.readiness,
    nextAction: row.nextAction,
    accountRef: row.accountRef,
    webhookReady: row.webhookReady,
    callbackEndpoint: row.callbackEndpoint,
    handoffMode: row.handoffMode,
    externalHandoffState: row.externalHandoffState,
    externalHandoffCommandCount: row.externalHandoffCommandCount,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    acceptanceBoundaryStatus: row.acceptanceBoundary.boundaryStatus,
    acceptanceBoundaryAccepted: row.acceptanceBoundary.acceptedForPreview,
    acceptanceBoundaryBlockers: row.acceptanceBoundary.blockers,
    acceptanceBoundaryNextAction: row.acceptanceBoundary.nextAction,
    grantedCapabilities: row.grantedCapabilities,
    missingCapabilities: row.missingCapabilities,
    contractIssues: row.contractIssues,
    syncCursor: row.syncCursor,
    lastSyncedAt: row.lastSyncedAt,
    syncStale: row.syncStale,
    syncLagSeconds: row.syncLagSeconds,
    proofRef: row.proofRef
  }));
  return {
    exportVersion: "owner-identity.analytics.v1",
    generatedAt: now,
    surfaceId,
    subject: "hosted-kernel-owner-identity",
    recordCounts: {
      owners: owners.length,
      lifecycleEvents: events.length,
      lifecycleCommands: commandRows.length,
      privilegedJobs: privilegedJobRows.length,
      authorizationDecisions: authorizationRows.length,
      kernelOwnerBindings: kernelOwnerBindingRows.length,
      mailchimpProviderRows: mailchimpProviderRows.length,
      snapshots: snapshots.length,
      evidence: evidence.length,
      providerContracts: providerServiceContracts.providers.length
    },
    ownerTransfer: {
      status: ownerTransferState.audit.status,
      requestedTransfers: ownerTransferState.summary.requestedTransfers,
      readyTransfers: ownerTransferState.summary.readyTransfers,
      blockedTransfers: ownerTransferState.summary.blockedTransfers,
      observedTransferEvents: ownerTransferState.summary.observedTransferEvents,
      nextHandoffCommandId: ownerTransferState.nextHandoff?.commandId || null,
      auditRoute: ownerTransferState.audit.route
    },
    ownerIdentityRegistry: ownerIdentityRegistry
      ? {
          status: ownerIdentityRegistry.status,
          uniqueOwners: ownerIdentityRegistry.ownerMap.size,
          duplicateClaimGroups: ownerIdentityRegistry.duplicateClaimGroups.length,
          ambiguousOwnerIds: ownerIdentityRegistry.ambiguousOwnerIds,
          integrityErrors: ownerIdentityRegistry.integrityErrors.length,
          auditRoute: ownerIdentityRegistry.audit.route
        }
      : null,
    workspaceBoundary: {
      tenantId: workspaceBoundaryState.scope.tenantId,
      workspaceId: workspaceBoundaryState.scope.workspaceId,
      status: workspaceBoundaryState.isolation.status,
      violations: workspaceBoundaryState.violations.length,
      evaluations: workspaceBoundaryState.evaluations.length,
      auditRoute: workspaceBoundaryState.auditHandoff.route,
      violationSubjects: workspaceBoundaryState.auditHandoff.violationSubjects
    },
    counters: analytics.counters,
    authorizationReporting: {
      status: analytics.authorizationReporting.status,
      counters: analytics.authorizationReporting.counters,
      byRequiredPermission: analytics.authorizationReporting.byRequiredPermission,
      byActorSubjectType: analytics.authorizationReporting.byActorSubjectType,
      byDecision: analytics.authorizationReporting.byDecision,
      deniedDecisionIds: analytics.authorizationReporting.deniedDecisionIds,
      delegatedDecisionIds: analytics.authorizationReporting.delegatedDecisionIds,
      failureCodeSummary: analytics.authorizationReporting.failureCodeSummary,
      auditRoute: analytics.authorizationReporting.audit.route
    },
    rates: {
      verificationRate: analytics.verificationRate,
      hostedKernelRate: analytics.hostedKernelRate,
      commandAcceptanceRate: analytics.commandAcceptanceRate
    },
    latestSnapshotId: snapshots.at(-1)?.snapshotId || null,
    latestKernelStates: snapshots.at(-1)?.kernels || [],
    timelineBuckets: analytics.timelineBuckets,
    reportingState: analytics.reportingState,
    providerSync: providerServiceContracts.syncMetadata,
    mailchimpProviders: {
      status: providerServiceContracts.mailchimpReporting.status,
      counters: providerServiceContracts.mailchimpReporting.counters,
      readyProviderIds: providerServiceContracts.mailchimpReporting.readyProviderIds,
      blockedProviderIds: providerServiceContracts.mailchimpReporting.blockedProviderIds,
      webhookBlockedProviderIds: providerServiceContracts.mailchimpReporting.webhookBlockedProviderIds,
      syncStaleProviderIds: providerServiceContracts.mailchimpReporting.syncStaleProviderIds,
      nextActions: providerServiceContracts.mailchimpReporting.nextActions,
      exportContract: providerServiceContracts.mailchimpReporting.exportContract
    },
    restartRecovery: restartRecovery
      ? {
          status: restartRecovery.status,
          bootId: restartRecovery.bootId,
          storageKey: restartRecovery.storageKey,
          replayedCommands: restartRecovery.replayedCommandIds.length,
          blockedAfterRecovery: restartRecovery.blockedAfterRecoveryCommandIds.length,
          newCommands: restartRecovery.newCommandIds.length,
          completedPrivilegedJobs: privilegedJobAuthorizationState?.completedFromRecoveryJobIds?.length || 0,
          blockedPrivilegedJobsAfterRecovery: privilegedJobAuthorizationState?.restartRecovery?.blockedAfterRecoveryJobIds?.length || 0,
          newPrivilegedJobs: privilegedJobAuthorizationState?.restartRecovery?.newJobIds?.length || 0,
          recoveryWatermark: restartRecovery.recoveryWatermark,
          durableProjectionStatus: restartRecovery.durableStateProjection?.status || null,
          durableSnapshotId: restartRecovery.durableStateProjection?.snapshotId || null,
          durableWriteMode: restartRecovery.durableStateProjection?.writeMode || null
        }
      : null,
    operationalHealth: operationalHealth
      ? {
          status: operationalHealth.status,
          mode: operationalHealth.mode,
          errorCount: operationalHealth.counters.errors,
          retryableFailures: operationalHealth.counters.retryable,
          nextRetryAt: operationalHealth.retryPlan.nextRetryAt,
          degradedCapabilities: operationalHealth.degradedMode.degradedCapabilities
        }
      : null,
    exports: {
      ownersJson: ownerRows,
      timelineJson: timelineRows,
      lifecycleCommandsJson: commandRows,
      privilegedJobsJson: privilegedJobRows,
      authorizationDecisionsJson: authorizationRows,
      kernelOwnerBindingsJson: kernelOwnerBindingRows,
      mailchimpProvidersJson: mailchimpProviderRows,
      ownerTransfersJson: ownerTransferState.transfers,
      snapshotJson: snapshots,
      csvReady: true,
      csvRowCount: timelineRows.length
    },
    csvColumns: [
      "sequence",
      "at",
      "type",
      "ownerId",
      "kernelId",
      "tenantId",
      "workspaceId",
      "proofRef"
    ]
  };
}

function buildAnalyticsExportManifest({ now, exportSummary, analytics, snapshots, lifecycleControlState, ownerTransferState, providerServiceContracts, workspaceBoundaryState, ownerIdentityRegistry }) {
  const latestSnapshot = snapshots.at(-1) || null;
  const readyCommandIds = lifecycleControlState.pendingCommands
    .filter((command) => command.status === "ready")
    .map((command) => command.commandId);
  const blockedCommandIds = lifecycleControlState.pendingCommands
    .filter((command) => command.status === "blocked")
    .map((command) => command.commandId);
  const replayedCommandIds = lifecycleControlState.pendingCommands
    .filter((command) => command.status === "replayed")
    .map((command) => command.commandId);
  const sectionManifests = [
    {
      sectionId: "owners",
      route: `${surfaceGroup}/${surfaceName}/export-rows/owners`,
      format: "json",
      rows: exportSummary.exports.ownersJson.length,
      proofRefs: exportSummary.exports.ownersJson.map((owner) => owner.proofRef)
    },
    {
      sectionId: "timeline",
      route: `${surfaceGroup}/${surfaceName}/export-rows/timeline`,
      format: "json,csv",
      rows: exportSummary.exports.timelineJson.length,
      proofRefs: exportSummary.exports.timelineJson.map((event) => event.proofRef)
    },
    {
      sectionId: "lifecycle-commands",
      route: `${surfaceGroup}/${surfaceName}/export-rows/lifecycle-commands`,
      format: "json",
      rows: exportSummary.exports.lifecycleCommandsJson.length,
      proofRefs: exportSummary.exports.lifecycleCommandsJson.flatMap((command) =>
        [command.proofRef, command.authorizationProofRef].filter(Boolean)
      )
    },
    {
      sectionId: "privileged-jobs",
      route: `${surfaceGroup}/${surfaceName}/export-rows/privileged-jobs`,
      format: "json",
      rows: exportSummary.exports.privilegedJobsJson.length,
      proofRefs: exportSummary.exports.privilegedJobsJson.flatMap((job) =>
        [job.proofRef, job.authorizationProofRef].filter(Boolean)
      )
    },
    {
      sectionId: "authorization-decisions",
      route: `${surfaceGroup}/${surfaceName}/export-rows/authorization-decisions`,
      format: "json,csv",
      rows: exportSummary.exports.authorizationDecisionsJson.length,
      proofRefs: exportSummary.exports.authorizationDecisionsJson.flatMap((decision) =>
        [decision.proofRef, decision.authorizationProofRef].filter(Boolean)
      )
    },
    {
      sectionId: "kernel-owner-bindings",
      route: `${surfaceGroup}/${surfaceName}/export-rows/kernel-owner-bindings`,
      format: "json",
      rows: exportSummary.exports.kernelOwnerBindingsJson.length,
      proofRefs: exportSummary.exports.kernelOwnerBindingsJson.flatMap((binding) => binding.proofRefs)
    },
    {
      sectionId: "mailchimp-providers",
      route: providerServiceContracts.mailchimpReporting.exportContract.route,
      format: providerServiceContracts.mailchimpReporting.exportContract.format,
      rows: exportSummary.exports.mailchimpProvidersJson.length,
      proofRefs: providerServiceContracts.mailchimpReporting.exportContract.proofRefs
    },
    {
      sectionId: "history-snapshots",
      route: `${surfaceGroup}/${surfaceName}/history-snapshots`,
      format: "json",
      rows: snapshots.length,
      proofRefs: snapshots.flatMap((snapshot) => snapshot.kernels.map((kernel) => kernel.lastProofRef))
    },
    {
      sectionId: "owner-transfers",
      route: `${surfaceGroup}/${surfaceName}/owner-transfer-report`,
      format: "json",
      rows: ownerTransferState.transfers.length,
      proofRefs: ownerTransferState.transfers.flatMap((transfer) => transfer.proofRefs)
    }
  ];
  const uniqueProofRefs = Array.from(new Set(sectionManifests.flatMap((section) => section.proofRefs).filter(Boolean))).sort();
  const attentionReasons = [
    ...(analytics.reportingState.status === "attention" ? ["analytics-reporting-attention"] : []),
    ...(blockedCommandIds.length ? ["blocked-lifecycle-commands"] : []),
    ...(providerServiceContracts.syncMetadata.blocked ? ["blocked-provider-contracts"] : []),
    ...(providerServiceContracts.mailchimpReporting.status === "attention" ? ["mailchimp-provider-reporting-attention"] : []),
    ...(workspaceBoundaryState.violations.length ? ["workspace-boundary-violations"] : []),
    ...(ownerIdentityRegistry?.status === "blocked" ? ["owner-identity-registry-conflicts"] : []),
    ...(lifecycleControlState.kernelOwnerBindings.status === "blocked" ? ["kernel-owner-binding-blocked"] : []),
    ...(analytics.authorizationReporting.status === "review-required" ? ["authorization-decisions-denied"] : []),
    ...(ownerTransferState.summary.blockedTransfers ? ["blocked-owner-transfers"] : []),
    ...(exportSummary.recordCounts.owners ? [] : ["export-missing-owner-rows"]),
    ...(exportSummary.recordCounts.lifecycleEvents ? [] : ["export-missing-lifecycle-event-rows"])
  ];

  return {
    contractVersion: "hosted-kernel-owner-identity.analytics-export-manifest.v1",
    manifestId: `owner-identity-export:${exportSummary.generatedAt}`,
    generatedAt: now,
    exportVersion: exportSummary.exportVersion,
    status: attentionReasons.length ? "review-required" : "ready",
    attentionReasons: Array.from(new Set(attentionReasons)),
    rowCounts: {
      owners: exportSummary.recordCounts.owners,
      lifecycleEvents: exportSummary.recordCounts.lifecycleEvents,
      lifecycleCommands: exportSummary.recordCounts.lifecycleCommands,
      privilegedJobs: exportSummary.recordCounts.privilegedJobs,
      authorizationDecisions: exportSummary.recordCounts.authorizationDecisions,
      kernelOwnerBindings: exportSummary.recordCounts.kernelOwnerBindings,
      mailchimpProviders: exportSummary.recordCounts.mailchimpProviderRows,
      historySnapshots: exportSummary.recordCounts.snapshots,
      ownerTransfers: ownerTransferState.transfers.length,
      providerContracts: exportSummary.recordCounts.providerContracts,
      csvRows: exportSummary.exports.csvRowCount
    },
    commandLedger: {
      readyCommandIds,
      blockedCommandIds,
      replayedCommandIds,
      dueNowCommandIds: lifecycleControlState.queueControls.queueBuckets.dueNowCommandIds,
      scheduledCommandIds: lifecycleControlState.queueControls.queueBuckets.scheduledCommandIds,
      nextCommandId: lifecycleControlState.nextAction.commandId || null
    },
    timelineReport: {
      latestSnapshotId: latestSnapshot?.snapshotId || null,
      latestSnapshotAt: latestSnapshot?.capturedAt || null,
      latestEventAt: analytics.reportingState.latestEventAt,
      bucketCount: analytics.timelineBuckets.length,
      buckets: analytics.timelineBuckets.map((bucket) => ({
        day: bucket.day,
        events: bucket.events,
        hosted: bucket.hosted,
        suspended: bucket.suspended,
        retired: bucket.retired,
        ownerTransfers: bucket.ownerTransfers
      }))
    },
    sections: sectionManifests.map((section) => ({
      sectionId: section.sectionId,
      route: section.route,
      format: section.format,
      rows: section.rows,
      proofRefCount: Array.from(new Set(section.proofRefs.filter(Boolean))).length,
      ready: section.rows > 0
    })),
    counters: analytics.counters,
    rates: exportSummary.rates,
    audit: {
      proofRefs: uniqueProofRefs,
      proofRefCount: uniqueProofRefs.length,
      complete: analytics.reportingState.proofCoverage.complete &&
        !attentionReasons.includes("export-missing-owner-rows") &&
        ownerIdentityRegistry?.status !== "blocked",
      route: `${surfaceGroup}/${surfaceName}/analytics-export-manifest`
    }
  };
}

function addMinutes(timestamp, minutes) {
  const base = new Date(timestamp).getTime();
  return new Date(base + minutes * 60000).toISOString();
}

function retryTelemetryForIssue(issue, operationalTelemetry) {
  if (issue.commandId) return operationalTelemetry.commandAttempts[issue.commandId] || null;
  if (issue.jobId) return operationalTelemetry.jobAttempts[issue.jobId] || null;
  if (issue.providerId) return operationalTelemetry.providerAttempts[issue.providerId] || null;
  return null;
}

function retryWindowForIssue({ issue, classification, index, now, operationalTelemetry }) {
  const telemetry = retryTelemetryForIssue(issue, operationalTelemetry);
  const attempts = telemetry?.attempts || 0;
  const exhausted = attempts >= operationalTelemetry.maxRetryAttempts;
  const retryable = classification.retryable && !exhausted;
  if (!retryable) {
    return {
      retryable: false,
      retryAfter: null,
      attempts,
      attemptsRemaining: Math.max(0, operationalTelemetry.maxRetryAttempts - attempts),
      exhausted,
      lastFailureAt: telemetry?.lastFailureAt || null,
      lastFailureCode: telemetry?.lastFailureCode || null
    };
  }
  const exponentialDelay = operationalTelemetry.baseRetryDelayMinutes * 2 ** Math.min(attempts + index, 5);
  const retryDelayMinutes = Math.min(operationalTelemetry.maxRetryDelayMinutes, exponentialDelay);
  return {
    retryable: true,
    retryAfter: addMinutes(now, retryDelayMinutes),
    attempts,
    attemptsRemaining: Math.max(0, operationalTelemetry.maxRetryAttempts - attempts),
    exhausted: false,
    lastFailureAt: telemetry?.lastFailureAt || null,
    lastFailureCode: telemetry?.lastFailureCode || null
  };
}

function classifyOperationalIssue(code) {
  if (code.includes("privileged-job") || code.includes("job-")) {
    return { severity: "error", retryable: false, category: "authorization" };
  }
  if (code.includes("kernel-owner-binding") || code.includes("command-owner-does-not-match-kernel-owner")) {
    return { severity: "critical", retryable: false, category: "owner-identity-integrity" };
  }
  if (code.includes("owner-identity-conflict") || code.includes("conflicting-owner-identity")) {
    return { severity: "critical", retryable: false, category: "owner-identity-integrity" };
  }
  if (code.includes("provider-health-down") || code.includes("provider-circuit-open")) {
    return { severity: "error", retryable: true, category: "provider-runtime-health" };
  }
  if (code.includes("provider-health-degraded") || code.includes("provider-sync-stale")) {
    return { severity: "warning", retryable: true, category: "provider-runtime-health" };
  }
  if (code.includes("boundary") || code.includes("workspace-scope")) {
    return { severity: "critical", retryable: false, category: "workspace-boundary" };
  }
  if (code.includes("permission") || code.includes("capabilities")) {
    return { severity: "error", retryable: false, category: "authorization" };
  }
  if (code.includes("actor-") || code.includes("authorization")) {
    return { severity: "error", retryable: false, category: "authorization" };
  }
  if (code.includes("verified") || code.includes("missing-owner") || code.includes("no-verified-owner")) {
    return { severity: "error", retryable: true, category: "owner-verification" };
  }
  if (code.includes("schedule") || code.includes("queue-truncated")) {
    return { severity: "warning", retryable: true, category: "lifecycle-scheduling" };
  }
  if (code.includes("retired")) {
    return { severity: "error", retryable: false, category: "terminal-kernel-state" };
  }
  return { severity: "warning", retryable: true, category: "hosted-kernel-health" };
}

function privilegedJobRetryDisposition(job) {
  const retryableCauseCodes = job.errors.filter((code) =>
    code === "job-owner-claim-missing" ||
    code === "job-owner-unverified" ||
    code === "owner-not-verified" ||
    code === "unknown-owner" ||
    code.includes("sync-stale")
  );
  const manualCauseCodes = job.errors.filter((code) =>
    code.includes("permission") ||
    code.includes("proof") ||
    code.includes("boundary") ||
    code.includes("workspace-scope") ||
    code.includes("conflict") ||
    code.includes("actor-") ||
    code.includes("authorization")
  );
  const onlyRetryableCauses = job.errors.length > 0 &&
    retryableCauseCodes.length === job.errors.length &&
    manualCauseCodes.length === 0;
  if (onlyRetryableCauses) {
    return {
      retryEligible: true,
      retryableCauseCodes,
      manualCauseCodes: [],
      reason: "privileged-job-waits-for-owner-claim-or-verification"
    };
  }
  return {
    retryEligible: false,
    retryableCauseCodes,
    manualCauseCodes: manualCauseCodes.length ? manualCauseCodes : job.errors,
    reason: manualCauseCodes.length
      ? "privileged-job-requires-authorization-repair"
      : "privileged-job-blocked-by-nonretryable-policy"
  };
}

function remediationForIssue(issue) {
  if (issue.scope === "kernel-owner-binding") {
    return {
      action: "resolve-kernel-owner-binding",
      route: `${surfaceGroup}/${surfaceName}/kernel-owner-bindings`,
      label: issue.kernelId ? `Resolve kernel ${issue.kernelId}` : "Resolve kernel owner binding"
    };
  }
  if (issue.scope === "owner-claim") {
    return {
      action: "resolve-owner-identity-conflict",
      route: `${surfaceGroup}/${surfaceName}/owner-identity-registry`,
      label: issue.ownerId ? `Resolve owner ${issue.ownerId}` : "Resolve owner identity conflict"
    };
  }
  if (issue.scope === "provider-contract") {
    if (issue.product === "mailchimp" || issue.code?.startsWith("mailchimp-")) {
      return {
        action: issue.retryEligible ? "retry-mailchimp-provider-sync" : "repair-mailchimp-provider-contract",
        route: `${surfaceGroup}/${surfaceName}/provider-contracts/${issue.providerId || "mailchimp"}/health`,
        label: issue.providerId ? `Repair Mailchimp provider ${issue.providerId}` : "Repair Mailchimp provider"
      };
    }
    return {
      action: "renegotiate-provider-contract",
      route: `${surfaceGroup}/${surfaceName}/provider-contracts`,
      label: issue.providerId ? `Update provider ${issue.providerId}` : "Update provider contract"
    };
  }
  if (issue.scope === "lifecycle-command") {
    return {
      action: "repair-lifecycle-command",
      route: `${surfaceGroup}/${surfaceName}/lifecycle-controls`,
      label: issue.commandId ? `Repair command ${issue.commandId}` : "Repair lifecycle command"
    };
  }
  if (issue.scope === "privileged-job") {
    const retryDisposition = issue.retryDisposition || null;
    return {
      action: retryDisposition?.retryEligible
        ? "retry-privileged-job-after-owner-state-refresh"
        : "repair-privileged-job-authorization",
      route: `${surfaceGroup}/${surfaceName}/privileged-job-authorization`,
      label: issue.jobId
        ? retryDisposition?.retryEligible
          ? `Retry job ${issue.jobId}`
          : `Repair job ${issue.jobId}`
        : "Repair privileged job authorization"
    };
  }
  if (issue.scope?.includes("boundary") || issue.code?.includes("workspace-boundary")) {
    return {
      action: "repair-workspace-boundary",
      route: `${surfaceGroup}/${surfaceName}/workspace-boundary`,
      label: "Repair workspace boundary"
    };
  }
  return {
    action: "review-owner-identity-health",
    route: `${surfaceGroup}/${surfaceName}/operational-health`,
    label: "Review owner identity health"
  };
}

function failureStateForIssue(issue) {
  if (!issue.retryable) return issue.retry.exhausted ? "retry-exhausted" : "blocked-manual-action";
  if (issue.severity === "critical") return "fail-closed";
  if (issue.retry.attempts > 0) return "retrying";
  return "pending-first-retry";
}

function buildExecutionGuards({ issues, degradedCapabilities, lifecycleControlState, providerServiceContracts }) {
  const blockedCommandIds = issues
    .filter((issue) => issue.scope === "lifecycle-command" && issue.severity !== "warning")
    .map((issue) => issue.commandId)
    .filter(Boolean);
  const blockedPrivilegedJobIds = issues
    .filter((issue) => issue.scope === "privileged-job" && issue.severity !== "warning")
    .map((issue) => issue.jobId)
    .filter(Boolean);
  const quarantinedProviderIds = issues
    .filter((issue) => issue.scope === "provider-contract" && issue.severity !== "warning")
    .map((issue) => issue.providerId)
    .filter(Boolean);
  return {
    contractVersion: "hosted-kernel-owner-identity.execution-guards.v1",
    allowLifecycleMutation: !degradedCapabilities.includes("kernel.lifecycle.command") && blockedCommandIds.length === 0,
    allowPrivilegedJobExecution: blockedPrivilegedJobIds.length === 0,
    allowProviderHandoff: !degradedCapabilities.includes("kernel.lifecycle.handoff") && quarantinedProviderIds.length === 0,
    allowOwnerClaimMutation: !degradedCapabilities.includes("owner.claim.write"),
    readOnlyRoutes: degradedCapabilities.length
      ? [`${surfaceGroup}/${surfaceName}/analytics-export`, `${surfaceGroup}/${surfaceName}/readiness`, `${surfaceGroup}/${surfaceName}/audit-handoff`]
      : [],
    blockedCommandIds,
    blockedPrivilegedJobIds,
    quarantinedProviderIds,
    readyCommandIds: lifecycleControlState.pendingCommands
      .filter((command) => command.status === "ready")
      .map((command) => command.commandId),
    readyProviderIds: providerServiceContracts.externalHandoffState.readyProviderIds
  };
}

function buildRetryQueues(issues) {
  const retryable = issues.filter((issue) => issue.retryable);
  const manual = issues.filter((issue) => !issue.retryable);
  return {
    readyForRetry: retryable
      .filter((issue) => issue.retry.retryAfter)
      .sort((a, b) => a.retry.retryAfter.localeCompare(b.retry.retryAfter))
      .map((issue) => ({
        issueId: issue.issueId,
        scope: issue.scope,
        code: issue.code,
        retryAfter: issue.retry.retryAfter,
        commandId: issue.commandId,
        jobId: issue.jobId,
        providerId: issue.providerId,
        attemptsRemaining: issue.retry.attemptsRemaining
      })),
    manualIntervention: manual.map((issue) => ({
      issueId: issue.issueId,
      scope: issue.scope,
      code: issue.code,
      failureState: issue.failureState,
      remediation: issue.remediation,
      commandId: issue.commandId,
      jobId: issue.jobId,
      providerId: issue.providerId
    }))
  };
}

function buildProviderRuntimeHealthFailures(providerServiceContracts, operationalTelemetry) {
  const staleProviderFailures = providerServiceContracts.providers
    .filter((contract) => contract.sync.stale)
    .map((contract) => ({
      scope: "provider-contract",
      code: "provider-sync-stale",
      providerId: contract.providerId,
      causeCodes: ["provider-sync-stale"],
      syncLagSeconds: contract.sync.lagSeconds,
      retryEligible: true
    }));
  const runtimeFailures = providerServiceContracts.providers.flatMap((contract) => {
    const signal = operationalTelemetry.providerHealth[contract.providerId];
    if (!signal || signal.status === "healthy") return [];
    const circuitOpen = signal.circuitState === "open";
    const code = circuitOpen
      ? "provider-circuit-open"
      : signal.status === "down"
        ? "provider-health-down"
        : "provider-health-degraded";
    return [{
      scope: "provider-contract",
      code,
      providerId: contract.providerId,
      causeCodes: Array.from(new Set([
        code,
        signal.failureCode,
        `provider-health-status:${signal.status}`,
        `provider-circuit-state:${signal.circuitState}`
      ].filter(Boolean))),
      retryEligible: signal.retryEligible,
      health: signal
    }];
  });
  const mailchimpFailures = providerServiceContracts.providers.flatMap((contract) => {
    if (!contract.mailchimp) return [];
    const signal = operationalTelemetry.providerHealth[contract.providerId] || null;
    const issues = [];
    if (contract.mailchimp.readiness !== "handoff-ready") {
      issues.push({
        scope: "provider-contract",
        product: "mailchimp",
        code: `mailchimp-${contract.mailchimp.readiness}`,
        providerId: contract.providerId,
        causeCodes: [
          contract.mailchimp.readiness,
          ...contract.mailchimp.missingCapabilities,
          ...(contract.mailchimp.webhookReady ? [] : ["mailchimp-webhook-not-ready"])
        ],
        retryEligible: contract.mailchimp.readiness === "webhook-contract-required",
        mailchimp: contract.mailchimp,
        health: signal
      });
    }
    if (signal && signal.status !== "healthy") {
      const retryEligible = signal.retryEligible ||
        mailchimpRetryableFailureCodes.has(signal.failureCode) ||
        signal.status === "degraded";
      issues.push({
        scope: "provider-contract",
        product: "mailchimp",
        code: signal.status === "down" ? "mailchimp-provider-down" : "mailchimp-provider-degraded",
        providerId: contract.providerId,
        causeCodes: Array.from(new Set([
          signal.failureCode,
          `mailchimp-health-status:${signal.status}`,
          `mailchimp-circuit-state:${signal.circuitState}`
        ].filter(Boolean))),
        retryEligible,
        mailchimp: contract.mailchimp,
        health: signal
      });
    }
    return issues;
  });
  return [...staleProviderFailures, ...runtimeFailures, ...mailchimpFailures];
}

function buildProviderFailoverPlan({ providerServiceContracts, operationalTelemetry, issues, now }) {
  const providerIssues = issues.filter((issue) => issue.providerId);
  return providerServiceContracts.providers.map((contract) => {
    const signal = operationalTelemetry.providerHealth[contract.providerId] || null;
    const issueCodes = providerIssues
      .filter((issue) => issue.providerId === contract.providerId)
      .map((issue) => issue.code);
    const availableForHandoff = contract.externalHandoff.state === "ready" &&
      !issueCodes.includes("provider-health-down") &&
      !issueCodes.includes("provider-circuit-open");
    return {
      providerId: contract.providerId,
      product: contract.mailchimp?.product || "generic-provider",
      status: availableForHandoff
        ? "primary-ready"
        : issueCodes.length
          ? "quarantined"
          : contract.externalHandoff.state === "ready"
            ? "standby-ready"
            : "not-eligible",
      healthStatus: signal?.status || "unreported",
      circuitState: signal?.circuitState || "unreported",
      observedAt: signal?.observedAt || now,
      handoffState: contract.externalHandoff.state,
      issueCodes,
      impactedCapabilities: signal?.impactedCapabilities || [],
      productReadiness: contract.mailchimp?.readiness || null,
      productNextAction: contract.mailchimp?.nextAction || null,
      nextAttemptAt: providerIssues
        .filter((issue) => issue.providerId === contract.providerId)
        .map((issue) => issue.retry.retryAfter)
        .filter(Boolean)
        .sort()[0] || null,
      route: availableForHandoff
        ? contract.endpoint
        : `${surfaceGroup}/${surfaceName}/provider-contracts/${contract.providerId}/health`
    };
  });
}

function buildOperationalHealthState({ now, lifecycleControlState, providerServiceContracts, workspaceBoundaryState, previewAcceptance, operationalTelemetry, ownerIdentityRegistry, privilegedJobAuthorizationState }) {
  const validationSummary = previewAcceptance.validationSummary;
  const validationIssues = [
    ...validationSummary.errors,
    ...validationSummary.warnings.map((warning) => ({ ...warning, warning: true }))
  ];
  const commandFailures = lifecycleControlState.pendingCommands
    .filter((command) => command.status === "blocked")
    .map((command) => ({
      scope: "lifecycle-command",
      code: "blocked-lifecycle-command",
      commandId: command.commandId,
      ownerId: command.ownerId,
      kernelId: command.kernelId,
      causeCodes: command.errors
    }));
  const providerFailures = providerServiceContracts.providers
    .filter((contract) => contract.status === "blocked")
    .map((contract) => ({
      scope: "provider-contract",
      code: "blocked-provider-contract",
      providerId: contract.providerId,
      causeCodes: contract.missingRequiredCapabilities.length
        ? contract.missingRequiredCapabilities
        : [contract.boundary.reason]
    }));
  const jobFailures = (privilegedJobAuthorizationState?.jobs || [])
    .filter((job) => job.status === "blocked")
    .map((job) => {
      const retryDisposition = privilegedJobRetryDisposition(job);
      return {
        scope: "privileged-job",
        code: "blocked-privileged-job",
        jobId: job.jobId,
        ownerId: job.ownerId,
        kernelId: job.kernelId,
        causeCodes: job.errors,
        retryEligible: retryDisposition.retryEligible,
        retryDisposition
      };
    });
  const providerRuntimeFailures = buildProviderRuntimeHealthFailures(providerServiceContracts, operationalTelemetry);
  const boundaryFailures = workspaceBoundaryState.violations.map((violation) => ({
    scope: "workspace-boundary",
    code: violation.code,
    ownerId: violation.ownerId,
    commandId: violation.commandId,
    providerId: violation.providerId,
    eventId: violation.eventId
  }));
  const ownerIdentityFailures = ownerIdentityRegistry?.integrityErrors || [];
  const kernelOwnerBindingFailures = lifecycleControlState.kernelOwnerBindings.bindingErrors;
  const rawIssues = [
    ...ownerIdentityFailures,
    ...kernelOwnerBindingFailures,
    ...validationIssues,
    ...commandFailures,
    ...jobFailures,
    ...providerFailures,
    ...providerRuntimeFailures,
    ...boundaryFailures
  ];
  const issues = rawIssues.map((issue, index) => {
    const primaryCode = issue.code || issue.causeCodes?.[0] || "unknown-operational-issue";
    const classification = classifyOperationalIssue(primaryCode);
    const effectiveClassification = {
      ...classification,
      retryable: typeof issue.retryEligible === "boolean" ? issue.retryEligible : classification.retryable
    };
    const retry = retryWindowForIssue({ issue, classification: effectiveClassification, index, now, operationalTelemetry });
    const enrichedIssue = {
      issueId: `owner-identity-health:${index + 1}`,
      scope: issue.scope || "owner-identity",
      code: primaryCode,
      severity: issue.warning ? "warning" : effectiveClassification.severity,
      category: effectiveClassification.category,
      retryable: retry.retryable,
      retryAfter: retry.retryAfter,
      retry,
      causeCodes: issue.causeCodes || [primaryCode],
      ownerId: issue.ownerId || null,
      kernelId: issue.kernelId || null,
      commandId: issue.commandId || null,
      jobId: issue.jobId || null,
      providerId: issue.providerId || null,
      product: issue.product || null,
      eventId: issue.eventId || null,
      mailchimp: issue.mailchimp || null,
      health: issue.health || null,
      retryDisposition: issue.retryDisposition || null,
      remediation: remediationForIssue(issue)
    };
    return {
      ...enrichedIssue,
      failureState: failureStateForIssue(enrichedIssue)
    };
  });
  const retryableIssues = issues.filter((issue) => issue.retryable);
  const criticalIssues = issues.filter((issue) => issue.severity === "critical");
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const blockedPrivilegedJobIssues = issues.filter((issue) => issue.scope === "privileged-job");
  const degradedCapabilities = [
    ...(lifecycleControlState.queue.blocked ? ["kernel.lifecycle.command"] : []),
    ...(providerServiceContracts.externalHandoffState.blockedProviderIds.length ? ["kernel.lifecycle.handoff"] : []),
    ...(providerRuntimeFailures.some((failure) => failure.code === "provider-health-down" || failure.code === "provider-circuit-open")
      ? ["kernel.lifecycle.handoff"]
      : []),
    ...(providerRuntimeFailures.some((failure) => failure.product === "mailchimp")
      ? ["kernel.lifecycle.handoff", "audit.proof.read"]
      : []),
    ...(workspaceBoundaryState.violations.length ? ["owner.claim.write", "kernel.lifecycle.command"] : []),
    ...(ownerIdentityRegistry?.status === "blocked" ? ["owner.claim.write", "kernel.lifecycle.command", "kernel.lifecycle.handoff"] : []),
    ...(lifecycleControlState.kernelOwnerBindings.status === "blocked" ? ["kernel.lifecycle.command", "kernel.lifecycle.handoff"] : []),
    ...(previewAcceptance.readiness.status === "blocked" ? ["preview.acceptance"] : [])
  ];
  const uniqueDegradedCapabilities = Array.from(new Set(degradedCapabilities)).sort();
  const retryQueues = buildRetryQueues(issues);
  const providerFailoverPlan = buildProviderFailoverPlan({
    providerServiceContracts,
    operationalTelemetry,
    issues,
    now
  });
  const executionGuards = buildExecutionGuards({
    issues,
    degradedCapabilities: uniqueDegradedCapabilities,
    lifecycleControlState,
    providerServiceContracts
  });

  return {
    contractVersion: "hosted-kernel-owner-identity.operational-health.v1",
    generatedAt: now,
    status: criticalIssues.length ? "failed" : errorIssues.length ? "degraded" : issues.length ? "attention" : "healthy",
    mode: criticalIssues.length
      ? "fail-closed"
      : degradedCapabilities.length
        ? "degraded-readonly"
        : "normal",
    counters: {
      issues: issues.length,
      errors: errorIssues.length + criticalIssues.length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      retryable: retryableIssues.length,
      blockedCommands: lifecycleControlState.queue.blocked,
      blockedPrivilegedJobs: privilegedJobAuthorizationState?.blockedJobIds?.length || 0,
      retryableBlockedPrivilegedJobs: blockedPrivilegedJobIssues.filter((issue) => issue.retryable).length,
      manualBlockedPrivilegedJobs: blockedPrivilegedJobIssues.filter((issue) => !issue.retryable).length,
      blockedProviders: providerServiceContracts.externalHandoffState.blockedProviderIds.length,
      unhealthyProviders: providerFailoverPlan.filter((provider) =>
        provider.status === "quarantined" || provider.healthStatus === "degraded"
      ).length,
      ownerIdentityConflicts: ownerIdentityRegistry?.ambiguousOwnerIds?.length || 0,
      blockedKernelOwnerBindings: lifecycleControlState.kernelOwnerBindings.blockedKernelIds.length,
      boundaryViolations: workspaceBoundaryState.violations.length
    },
    retryPlan: {
      strategy: "bounded-exponential-backoff",
      baseDelayMinutes: operationalTelemetry.baseRetryDelayMinutes,
      maxDelayMinutes: operationalTelemetry.maxRetryDelayMinutes,
      maxAttempts: operationalTelemetry.maxRetryAttempts,
      nextRetryAt: retryableIssues
        .map((issue) => issue.retry.retryAfter)
        .filter(Boolean)
        .sort()[0] || null,
      retryableIssueIds: retryableIssues.map((issue) => issue.issueId),
      blockedIssueIds: issues.filter((issue) => !issue.retryable).map((issue) => issue.issueId),
      queues: retryQueues
    },
    degradedMode: {
      enabled: uniqueDegradedCapabilities.length > 0,
      reason: uniqueDegradedCapabilities.length ? "operational-issues-restrict-hosted-kernel-owner-controls" : "all-owner-identity-controls-available",
      degradedCapabilities: uniqueDegradedCapabilities,
      preservedCapabilities: ["owner.claim.read", "kernel.lifecycle.read", "audit.proof.read"],
      providerFailoverPlan,
      executionGuards
    },
    executionGuards,
    actionableErrors: issues
  };
}

function summarizeValidation({ owners, timeline, lifecycleControlState, providerServiceContracts, workspaceBoundaryState, ownerIdentityRegistry, privilegedJobAuthorizationState }) {
  const settingsValidation = lifecycleControlState.settingsControlState.validation;
  const settingsErrors = settingsValidation.errors.map((error) => ({
    scope: "lifecycle-settings",
    code: error
  }));
  const settingsWarnings = settingsValidation.warnings.map((warning) => ({
    scope: "lifecycle-settings",
    code: warning
  }));
  const commandErrors = lifecycleControlState.pendingCommands.flatMap((command) =>
    command.errors.map((error) => ({
      scope: "lifecycle-command",
      code: error,
      commandId: command.commandId,
      ownerId: command.ownerId,
      kernelId: command.kernelId
    }))
  );
  const commandWarnings = lifecycleControlState.pendingCommands.flatMap((command) =>
    command.warnings.map((warning) => ({
      scope: "lifecycle-command",
      code: warning,
      commandId: command.commandId,
      ownerId: command.ownerId,
      kernelId: command.kernelId
    }))
  );
  const jobErrors = (privilegedJobAuthorizationState?.jobs || []).flatMap((job) =>
    job.errors.map((error) => ({
      scope: "privileged-job",
      code: error,
      jobId: job.jobId,
      ownerId: job.ownerId,
      kernelId: job.kernelId
    }))
  );
  const jobWarnings = (privilegedJobAuthorizationState?.jobs || []).flatMap((job) =>
    job.warnings.map((warning) => ({
      scope: "privileged-job",
      code: warning,
      jobId: job.jobId,
      ownerId: job.ownerId,
      kernelId: job.kernelId
    }))
  );
  const structuralErrors = [
    ...settingsErrors,
    ...(owners.length ? [] : [{ scope: "owner-identity", code: "missing-owner-claims" }]),
    ...(timeline.length ? [] : [{ scope: "kernel-lifecycle", code: "missing-lifecycle-events" }]),
    ...(owners.some((owner) => owner.verified)
      ? []
      : [{ scope: "owner-identity", code: "no-verified-owner" }]),
    ...(ownerIdentityRegistry?.integrityErrors || []),
    ...lifecycleControlState.kernelOwnerBindings.bindingErrors,
    ...providerServiceContracts.providers
      .filter((contract) => contract.status === "blocked")
      .map((contract) => ({
        scope: "provider-contract",
        code: "missing-required-capabilities",
        providerId: contract.providerId,
        missingRequiredCapabilities: contract.missingRequiredCapabilities
      })),
    ...workspaceBoundaryState.violations.map((violation) => ({
      ...violation,
      code: `workspace-boundary:${violation.code}`
    }))
  ];
  const warnings = [
    ...settingsWarnings,
    ...commandWarnings,
    ...(lifecycleControlState.queue.truncated
      ? [{
          scope: "lifecycle-command",
          code: "lifecycle-command-queue-truncated",
          truncated: lifecycleControlState.queue.truncated
        }]
      : [])
  ];

  return {
    status: structuralErrors.length || commandErrors.length || jobErrors.length ? "invalid" : warnings.length || jobWarnings.length ? "valid-with-warnings" : "valid",
    errors: [...structuralErrors, ...commandErrors, ...jobErrors],
    warnings: [...warnings, ...jobWarnings],
    counts: {
      errors: structuralErrors.length + commandErrors.length + jobErrors.length,
      warnings: warnings.length + jobWarnings.length,
      lifecycleSettingsErrors: settingsErrors.length,
      lifecycleSettingsWarnings: settingsWarnings.length,
      readyCommands: lifecycleControlState.queue.accepted,
      blockedCommands: lifecycleControlState.queue.blocked,
      blockedPrivilegedJobs: privilegedJobAuthorizationState?.blockedJobIds?.length || 0,
      dueCommands: lifecycleControlState.queue.dueNow,
      scheduledCommands: lifecycleControlState.queue.scheduled,
      queueConflicts: lifecycleControlState.queue.conflicts,
      blockedProviderContracts: providerServiceContracts.externalHandoffState.blockedProviderIds.length,
      ownerIdentityConflicts: ownerIdentityRegistry?.ambiguousOwnerIds?.length || 0,
      blockedKernelOwnerBindings: lifecycleControlState.kernelOwnerBindings.blockedKernelIds.length,
      workspaceBoundaryViolations: workspaceBoundaryState.violations.length
    }
  };
}

function buildPreviewAcceptanceContract({ now, owners, timeline, lifecycleControlState, providerServiceContracts, workspaceBoundaryState, ownerIdentityRegistry, privilegedJobAuthorizationState }) {
  const latestKernelStates = Array.from(getLatestKernelStates(timeline).values());
  const verifiedOwners = owners.filter((owner) => owner.verified);
  const activeKernels = latestKernelStates.filter((kernel) => kernel.state === "hosted");
  const blockedCommands = lifecycleControlState.pendingCommands.filter((command) => command.status === "blocked");
  const readyCommands = lifecycleControlState.pendingCommands.filter((command) => command.status === "ready");
  const acceptedPrivilegedJobs = (privilegedJobAuthorizationState?.authorizedJobIds?.length || 0) +
    (privilegedJobAuthorizationState?.completedFromRecoveryJobIds?.length || 0);
  const validationSummary = summarizeValidation({
    owners,
    timeline,
    lifecycleControlState,
    providerServiceContracts,
    workspaceBoundaryState,
    ownerIdentityRegistry,
    privilegedJobAuthorizationState
  });
  const acceptanceGates = [
    {
      gateId: "owner-identity.registry",
      label: "Owner identity registry",
      status: ownerIdentityRegistry?.status === "blocked" ? "blocked" : "accepted",
      evidenceRefs: ownerIdentityRegistry?.audit?.proofRefs || owners.map((owner) => owner.proofRef),
      detail: ownerIdentityRegistry?.status === "blocked"
        ? `${ownerIdentityRegistry.ambiguousOwnerIds.length} owner identit${ownerIdentityRegistry.ambiguousOwnerIds.length === 1 ? "y has" : "ies have"} conflicting claims`
        : `${ownerIdentityRegistry?.ownerMap?.size || owners.length} owner identit${(ownerIdentityRegistry?.ownerMap?.size || owners.length) === 1 ? "y" : "ies"} resolved`
    },
    {
      gateId: "workspace-boundary.enforced",
      label: "Workspace boundary enforced",
      status: workspaceBoundaryState.isolation.status === "blocked" ? "blocked" : "accepted",
      evidenceRefs: [workspaceBoundaryState.scope.proofRef],
      detail: workspaceBoundaryState.isolation.status === "blocked"
        ? `${workspaceBoundaryState.violations.length} scoped record${workspaceBoundaryState.violations.length === 1 ? "" : "s"} outside the allowed tenant/workspace boundary`
        : `Tenant ${workspaceBoundaryState.scope.tenantId} and workspace ${workspaceBoundaryState.scope.workspaceId} are isolated`
    },
    {
      gateId: "kernel-owner-binding.resolved",
      label: "Kernel owner binding",
      status: lifecycleControlState.kernelOwnerBindings.status === "blocked" ? "blocked" : "accepted",
      evidenceRefs: lifecycleControlState.kernelOwnerBindings.audit.proofRefs,
      detail: lifecycleControlState.kernelOwnerBindings.status === "blocked"
        ? `${lifecycleControlState.kernelOwnerBindings.blockedKernelIds.length} kernel owner binding${lifecycleControlState.kernelOwnerBindings.blockedKernelIds.length === 1 ? "" : "s"} cannot be resolved`
        : `${lifecycleControlState.kernelOwnerBindings.bindings.length} kernel owner binding${lifecycleControlState.kernelOwnerBindings.bindings.length === 1 ? "" : "s"} resolved`
    },
    {
      gateId: "owner-identity.verified",
      label: "Verified owner identity",
      status: verifiedOwners.length ? "accepted" : "blocked",
      evidenceRefs: verifiedOwners.map((owner) => owner.proofRef),
      detail: verifiedOwners.length
        ? `${verifiedOwners.length} verified owner claim${verifiedOwners.length === 1 ? "" : "s"} available`
        : "At least one verified owner claim is required before hosted-kernel controls can be accepted"
    },
    {
      gateId: "kernel-lifecycle.hosted",
      label: "Hosted kernel lifecycle observed",
      status: activeKernels.length ? "accepted" : latestKernelStates.length ? "attention" : "blocked",
      evidenceRefs: latestKernelStates.map((kernel) => kernel.lastProofRef),
      detail: activeKernels.length
        ? `${activeKernels.length} hosted kernel${activeKernels.length === 1 ? "" : "s"} ready for owner-scoped control`
        : "No hosted kernel state is currently ready for owner-scoped control"
    },
    {
      gateId: "lifecycle-command.acceptance",
      label: "Lifecycle command acceptance",
      status: blockedCommands.length ? "blocked" : readyCommands.length ? "accepted" : "attention",
      evidenceRefs: lifecycleControlState.pendingCommands.map((command) => command.proofRef),
      detail: blockedCommands.length
        ? `${blockedCommands.length} lifecycle command${blockedCommands.length === 1 ? "" : "s"} blocked by policy`
        : readyCommands.length
          ? `${readyCommands.length} lifecycle command${readyCommands.length === 1 ? "" : "s"} ready`
          : "No lifecycle command is queued for acceptance"
    },
    {
      gateId: "privileged-job.authorization",
      label: "Privileged job authorization",
      status: privilegedJobAuthorizationState?.blockedJobIds?.length
        ? "blocked"
        : privilegedJobAuthorizationState?.jobs?.length
          ? "accepted"
          : "attention",
      evidenceRefs: privilegedJobAuthorizationState?.audit?.proofRefs || [],
      detail: privilegedJobAuthorizationState?.blockedJobIds?.length
        ? `${privilegedJobAuthorizationState.blockedJobIds.length} privileged job${privilegedJobAuthorizationState.blockedJobIds.length === 1 ? "" : "s"} blocked by owner authorization`
        : privilegedJobAuthorizationState?.jobs?.length
          ? `${acceptedPrivilegedJobs} privileged job${acceptedPrivilegedJobs === 1 ? "" : "s"} authorized or recovered`
          : "No privileged jobs are queued for owner-scoped authorization"
    },
    {
      gateId: "provider-handoff.ready",
      label: "Provider handoff readiness",
      status: providerServiceContracts.externalHandoffState.blockedProviderIds.length
        ? "blocked"
        : providerServiceContracts.externalHandoffState.readyProviderIds.length
          ? "accepted"
          : "attention",
      evidenceRefs: providerServiceContracts.providers.map((contract) => contract.externalHandoff.proofRef),
      detail: providerServiceContracts.externalHandoffState.blockedProviderIds.length
        ? "One or more provider contracts are missing required capabilities"
        : providerServiceContracts.externalHandoffState.readyProviderIds.length
          ? "Provider handoff is ready for accepted lifecycle commands"
          : "Provider handoff is idle until a ready lifecycle command exists"
    }
  ];
  const blockedGateIds = acceptanceGates.filter((gate) => gate.status === "blocked").map((gate) => gate.gateId);
  const readiness = {
    status: blockedGateIds.length
      ? "blocked"
      : acceptanceGates.some((gate) => gate.status === "attention") || validationSummary.status === "valid-with-warnings"
        ? "attention"
        : "ready",
    blockedGateIds,
    acceptedGateIds: acceptanceGates.filter((gate) => gate.status === "accepted").map((gate) => gate.gateId),
    reviewedAt: now
  };
  const nextSteps = [
    ...(!verifiedOwners.length
      ? [{
          action: "verify-owner-claim",
          label: "Verify an owner claim",
          reason: "Hosted-kernel lifecycle controls require a verified owner identity",
          route: `${surfaceGroup}/${surfaceName}/owner-claims`
        }]
      : []),
    ...(blockedCommands.length
      ? blockedCommands.map((command) => ({
          action: "resolve-lifecycle-command",
          label: `Resolve ${command.type}`,
          reason: command.errors.join(", ") || "Lifecycle command is blocked",
          commandId: command.commandId,
          route: `${surfaceGroup}/${surfaceName}/lifecycle-controls`
        }))
      : []),
    ...(providerServiceContracts.externalHandoffState.blockedProviderIds.length
      ? providerServiceContracts.externalHandoffState.blockedProviderIds.map((providerId) => ({
          action: "resolve-provider-contract",
          label: `Resolve provider ${providerId}`,
          reason: "Provider contract is missing required capabilities",
          providerId,
          route: `${surfaceGroup}/${surfaceName}/provider-contracts`
        }))
      : []),
    ...(workspaceBoundaryState.violations.length
      ? [{
          action: "resolve-workspace-boundary",
          label: "Resolve workspace boundary",
          reason: "One or more owner, lifecycle, command, or provider records are outside the configured tenant/workspace scope",
          route: `${surfaceGroup}/${surfaceName}/workspace-boundary`
        }]
      : []),
    ...(ownerIdentityRegistry?.status === "blocked"
      ? ownerIdentityRegistry.integrityErrors.map((error) => ({
          action: "resolve-owner-identity-conflict",
          label: error.ownerId ? `Resolve owner ${error.ownerId}` : "Resolve owner identity",
          reason: error.causeCodes.join(", ") || error.code,
          ownerId: error.ownerId || null,
          route: `${surfaceGroup}/${surfaceName}/owner-identity-registry`
        }))
      : []),
    ...(lifecycleControlState.kernelOwnerBindings.status === "blocked"
      ? lifecycleControlState.kernelOwnerBindings.bindingErrors.map((error) => ({
          action: "resolve-kernel-owner-binding",
          label: error.kernelId ? `Resolve kernel ${error.kernelId}` : "Resolve kernel owner binding",
          reason: error.code,
          kernelId: error.kernelId || null,
          ownerId: error.ownerId || null,
          route: `${surfaceGroup}/${surfaceName}/kernel-owner-bindings`
        }))
      : [])
  ];

  return {
    contractVersion: "hosted-kernel-owner-identity.preview-acceptance.v1",
    generatedAt: now,
    preview: {
      title: "Hosted kernel owner identity",
      summary: `${verifiedOwners.length}/${owners.length} owners verified; ${activeKernels.length}/${latestKernelStates.length} kernels hosted; ${readyCommands.length} commands ready`,
      cards: [
        { cardId: "owners", label: "Verified owners", value: verifiedOwners.length, total: owners.length },
        { cardId: "kernels", label: "Hosted kernels", value: activeKernels.length, total: latestKernelStates.length },
        { cardId: "commands", label: "Ready commands", value: readyCommands.length, total: lifecycleControlState.pendingCommands.length },
        { cardId: "providers", label: "Ready providers", value: providerServiceContracts.externalHandoffState.readyProviderIds.length, total: providerServiceContracts.providers.length }
      ]
    },
    acceptanceGates,
    readiness,
    validationSummary,
    nextSteps: nextSteps.length
      ? nextSteps
      : [{
          action: lifecycleControlState.nextAction.action,
          label: lifecycleControlState.nextAction.action === "await-lifecycle-command" ? "Await lifecycle command" : "Execute next lifecycle action",
          reason: readiness.status === "ready" ? "All acceptance gates are satisfied" : "Review attention gates before accepting",
          route: `${surfaceGroup}/${surfaceName}/next-action`
        }]
  };
}

function routeStatusForReadiness(status) {
  if (status === "ready") return "accept-enabled";
  if (status === "attention") return "review-enabled";
  return "blocked";
}

function previewSeverityForGate(gate) {
  if (gate.status === "blocked") return "error";
  if (gate.status === "attention") return "warning";
  return "success";
}

function nextStepInputHints(step) {
  if (step.commandId) return ["commandId", "reason"];
  if (step.providerId) return ["providerId", "capabilities"];
  if (step.action === "verify-owner-claim") return ["ownerId", "proofRef"];
  if (step.action === "resolve-owner-identity-conflict") return ["ownerId", "canonicalProofRef"];
  if (step.action === "resolve-kernel-owner-binding") return ["kernelId", "ownerId", "proofRef"];
  if (step.action === "resolve-workspace-boundary") return ["tenantId", "workspaceId"];
  return ["acknowledgedAt"];
}

function buildPreviewAcceptanceClientContract({ previewAcceptance, lifecycleControlState, providerServiceContracts, workspaceBoundaryState, now }) {
  const readiness = previewAcceptance.readiness;
  const routeStatus = routeStatusForReadiness(readiness.status);
  const readyCommandIds = lifecycleControlState.pendingCommands
    .filter((command) => command.status === "ready")
    .map((command) => command.commandId);
  const blockedCommandIds = lifecycleControlState.pendingCommands
    .filter((command) => command.status === "blocked")
    .map((command) => command.commandId);
  const validationCounts = previewAcceptance.validationSummary.counts;
  const acceptanceDisabledReasons = [
    ...readiness.blockedGateIds.map((gateId) => `blocked-gate:${gateId}`),
    ...(validationCounts.errors ? ["validation-errors-present"] : []),
    ...(validationCounts.ownerIdentityConflicts ? ["owner-identity-conflicts-present"] : []),
    ...(validationCounts.blockedKernelOwnerBindings ? ["kernel-owner-bindings-blocked"] : []),
    ...(workspaceBoundaryState.violations.length ? ["workspace-boundary-violations-present"] : []),
    ...(providerServiceContracts.externalHandoffState.blockedProviderIds.length ? ["provider-contracts-blocked"] : []),
    ...(blockedCommandIds.length ? ["lifecycle-commands-blocked"] : [])
  ];
  const nextStepContracts = previewAcceptance.nextSteps.map((step, index) => ({
    stepId: `owner-identity-next-step:${index + 1}`,
    action: step.action,
    label: step.label,
    reason: step.reason,
    route: step.route,
    method: step.action === "await-lifecycle-command" ? "GET" : "POST",
    commandId: step.commandId || null,
    providerId: step.providerId || null,
    inputHints: nextStepInputHints(step),
    acceptAfterComplete: !readiness.blockedGateIds.length && validationCounts.errors === 0
  }));

  return {
    contractVersion: "hosted-kernel-owner-identity.preview-client.v1",
    generatedAt: now,
    surfaceId,
    route: `${surfaceGroup}/${surfaceName}/preview-acceptance`,
    readinessRoute: `${surfaceGroup}/${surfaceName}/readiness`,
    validationRoute: `${surfaceGroup}/${surfaceName}/validation-summary`,
    nextStepsRoute: `${surfaceGroup}/${surfaceName}/next-steps`,
    acceptanceRoute: `${surfaceGroup}/${surfaceName}/acceptance`,
    status: routeStatus,
    canAccept: routeStatus !== "blocked" && acceptanceDisabledReasons.length === 0,
    canReviewWithWarnings: routeStatus === "review-enabled" && validationCounts.errors === 0,
    disabledReasons: Array.from(new Set(acceptanceDisabledReasons)),
    previewCards: previewAcceptance.preview.cards.map((card) => ({
      ...card,
      status: card.total === 0
        ? "empty"
        : card.value === card.total
          ? "complete"
          : card.value > 0
            ? "partial"
            : "missing"
    })),
    gates: previewAcceptance.acceptanceGates.map((gate) => ({
      gateId: gate.gateId,
      label: gate.label,
      status: gate.status,
      severity: previewSeverityForGate(gate),
      detail: gate.detail,
      evidenceRefs: gate.evidenceRefs
    })),
    commandPreview: {
      readyCommandIds,
      blockedCommandIds,
      dueNowCommandIds: lifecycleControlState.queueControls.queueBuckets.dueNowCommandIds,
      nextCommandId: lifecycleControlState.nextAction.commandId || null,
      nextAction: lifecycleControlState.nextAction.action,
      expectedState: lifecycleControlState.nextAction.expectedState || null
    },
    acceptancePayload: {
      contractVersion: "hosted-kernel-owner-identity.acceptance-request.v1",
      requiredFields: ["acceptedBy", "acceptedAt", "readinessStatus", "acceptedGateIds"],
      optionalFields: ["warningAcknowledgements", "blockedOverrideReason"],
      defaults: {
        acceptedAt: now,
        readinessStatus: readiness.status,
        acceptedGateIds: readiness.acceptedGateIds,
        readyCommandIds
      }
    },
    validationBadges: {
      status: previewAcceptance.validationSummary.status,
      errors: validationCounts.errors,
      warnings: validationCounts.warnings,
      blockedCommands: validationCounts.blockedCommands,
      blockedProviders: validationCounts.blockedProviderContracts,
      ownerIdentityConflicts: validationCounts.ownerIdentityConflicts,
      boundaryViolations: validationCounts.workspaceBoundaryViolations
    },
    nextStepContracts,
    audit: {
      proofRefs: Array.from(new Set(previewAcceptance.acceptanceGates.flatMap((gate) => gate.evidenceRefs))),
      generatedAt: now,
      routeStatus,
      acceptanceRequiresWarningReview: previewAcceptance.validationSummary.status === "valid-with-warnings"
    }
  };
}

function authorizationReviewStatusForRecord(record) {
  if (record.status === "ready" || record.status === "authorized") return "accepted";
  if (record.status === "replayed" || record.status === "completed-from-recovery") return "accepted-from-recovery";
  if (record.authorization?.permissionGranted === false || record.permissionGranted === false) return "blocked";
  return record.status === "blocked" ? "blocked" : "review";
}

function authorizationReviewActionForRecord(record, source) {
  const errors = authorizationFailureCodes(record);
  if (record.status === "ready" || record.status === "authorized") {
    return source === "lifecycle-command" ? "accept-lifecycle-command" : "accept-privileged-job";
  }
  if (errors.some((code) => code.includes("proof"))) return "attach-authorization-proof";
  if (errors.some((code) => code.includes("permission"))) return "grant-required-permission";
  if (errors.some((code) => code.includes("boundary") || code.includes("workspace-scope"))) return "repair-workspace-boundary";
  if (errors.some((code) => code.includes("owner-identity") || code.includes("owner-claim") || code.includes("kernel-owner"))) {
    return "resolve-owner-identity";
  }
  return source === "lifecycle-command" ? "repair-lifecycle-command" : "repair-privileged-job";
}

function authorizationReviewRouteForAction(action) {
  if (action === "attach-authorization-proof" || action === "grant-required-permission") {
    return `${surfaceGroup}/${surfaceName}/authorization-reporting`;
  }
  if (action === "repair-workspace-boundary") return `${surfaceGroup}/${surfaceName}/workspace-boundary`;
  if (action === "resolve-owner-identity") return `${surfaceGroup}/${surfaceName}/owner-identity-registry`;
  if (action === "repair-privileged-job" || action === "accept-privileged-job") {
    return `${surfaceGroup}/${surfaceName}/privileged-job-authorization`;
  }
  return `${surfaceGroup}/${surfaceName}/lifecycle-controls`;
}

function authorizationReviewItem(record, source) {
  const authorization = record.authorization || {};
  const decisionId = source === "lifecycle-command" ? record.commandId : record.jobId;
  const errors = authorizationFailureCodes(record);
  const warnings = Array.isArray(record.warnings) ? record.warnings : [];
  const status = authorizationReviewStatusForRecord(record);
  const action = authorizationReviewActionForRecord(record, source);
  return {
    reviewId: `owner-identity-authorization-review:${source}:${decisionId}`,
    source,
    decisionId,
    type: record.type,
    status,
    action,
    route: authorizationReviewRouteForAction(action),
    ownerId: record.ownerId,
    actorId: authorization.actorId || record.actorId || record.actor || record.ownerId,
    actorSubjectType: authorization.subjectType || record.actorSubjectType || "owner",
    authorizationSource: record.requestAuthorization?.source || authorization.authorizationSource || "unknown",
    requestId: record.requestAuthorization?.requestId || null,
    sessionId: record.requestAuthorization?.sessionId || null,
    adoptedClientAuthorization: Boolean(record.requestAuthorization?.adopted),
    delegatedActor: Boolean(authorization.delegated ?? record.delegatedActor),
    requiredPermission: record.requiredPermission,
    permissionGranted: Boolean(authorization.permissionGranted ?? record.permissionGranted),
    proofProvided: Boolean(authorization.proofProvided),
    proofRequired: Boolean(authorization.delegated && !authorization.proofProvided),
    kernelId: record.kernelId,
    tenantId: record.tenantId,
    workspaceId: record.workspaceId,
    scheduledAt: record.scheduleAt || record.requestedAt || null,
    failureCodes: errors,
    warningCodes: warnings,
    userVisibleReason: errors[0] || warnings[0] || (status === "accepted" ? "authorization-ready" : "authorization-review-required"),
    proofRefs: Array.from(new Set([
      record.proofRef,
      authorization.proofRef
    ].filter(Boolean)))
  };
}

function buildAuthorizationReviewContract({ lifecycleControlState, privilegedJobAuthorizationState, previewAcceptance, now }) {
  const commandItems = lifecycleControlState.pendingCommands.map((command) =>
    authorizationReviewItem(command, "lifecycle-command")
  );
  const jobItems = (privilegedJobAuthorizationState?.jobs || []).map((job) =>
    authorizationReviewItem(job, "privileged-job")
  );
  const items = [...commandItems, ...jobItems].sort((a, b) =>
    a.status.localeCompare(b.status) ||
    a.requiredPermission.localeCompare(b.requiredPermission) ||
    a.decisionId.localeCompare(b.decisionId)
  );
  const blocked = items.filter((item) => item.status === "blocked");
  const accepted = items.filter((item) => item.status === "accepted" || item.status === "accepted-from-recovery");
  const delegated = items.filter((item) => item.delegatedActor);
  const proofRequired = items.filter((item) => item.proofRequired);
  const nextReviewTarget = blocked[0] || proofRequired[0] || items.find((item) => item.status === "review") || null;

  return {
    contractVersion: "hosted-kernel-owner-identity.authorization-review.v1",
    generatedAt: now,
    status: blocked.length
      ? "blocked"
      : proofRequired.length
        ? "proof-review-required"
        : items.length
          ? "ready"
          : "idle",
    summary: {
      authorizationItems: items.length,
      accepted: accepted.length,
      blocked: blocked.length,
      delegatedActors: delegated.length,
      proofRequired: proofRequired.length,
      lifecycleCommands: commandItems.length,
      privilegedJobs: jobItems.length,
      readinessStatus: previewAcceptance.readiness.status
    },
    byRequiredPermission: countBy(items, (item) => item.requiredPermission),
    byActorSubjectType: countBy(items, (item) => item.actorSubjectType),
    proofReviewQueue: proofRequired.map((item) => ({
      reviewId: item.reviewId,
      decisionId: item.decisionId,
      source: item.source,
      actorId: item.actorId,
      requiredPermission: item.requiredPermission,
      route: item.route
    })),
    items,
    nextReviewTarget,
    audit: {
      route: `${surfaceGroup}/${surfaceName}/authorization-review`,
      proofRefs: Array.from(new Set(items.flatMap((item) => item.proofRefs))).sort()
    }
  };
}

function normalizeAcceptanceSubmission(input = {}, now) {
  const source = input.acceptanceSubmission || input.acceptanceRequest || input.acceptance || {};
  const submitted = Object.keys(source).length > 0;
  const warningAcknowledgements = normalizeStringList(
    source.warningAcknowledgements || source.acknowledgedWarnings || source.warningCodes
  );
  return {
    contractVersion: "hosted-kernel-owner-identity.acceptance-submission.v1",
    submitted,
    acceptanceId: stableText(source.acceptanceId || source.id, `owner-identity-acceptance:${now}`),
    acceptedBy: stableText(source.acceptedBy || source.actor || source.ownerId, ""),
    acceptedAt: normalizeTimestamp(source.acceptedAt || source.at, now),
    readinessStatus: ["ready", "attention", "blocked"].includes(source.readinessStatus)
      ? source.readinessStatus
      : "",
    acceptedGateIds: normalizeStringList(source.acceptedGateIds || source.gates),
    warningAcknowledgements,
    blockedOverrideReason: stableText(source.blockedOverrideReason || source.overrideReason, ""),
    clientRequestId: stableText(source.clientRequestId || source.requestId, ""),
    proofRef: stableText(source.proofRef || source.proof, `acceptance-submission:${now}`)
  };
}

function acceptanceGateDigest(gates, acceptedGateIds) {
  const accepted = new Set(acceptedGateIds);
  return gates.map((gate) => ({
    gateId: gate.gateId,
    status: gate.status,
    accepted: accepted.has(gate.gateId),
    required: gate.status !== "attention",
    missingAcceptance: gate.status === "accepted" && !accepted.has(gate.gateId),
    evidenceRefs: gate.evidenceRefs
  }));
}

function buildAcceptanceDecisionContract({
  acceptanceSubmission,
  previewAcceptance,
  previewClientContract,
  lifecycleControlState,
  workspaceBoundaryState,
  now
}) {
  const validationSummary = previewAcceptance.validationSummary;
  const warningCodes = validationSummary.warnings.map((warning) => warning.code);
  const acknowledgedWarnings = new Set(acceptanceSubmission.warningAcknowledgements);
  const unacknowledgedWarnings = warningCodes.filter((code) => !acknowledgedWarnings.has(code));
  const gateDigest = acceptanceGateDigest(
    previewAcceptance.acceptanceGates,
    acceptanceSubmission.acceptedGateIds
  );
  const missingAcceptedGateIds = gateDigest
    .filter((gate) => gate.missingAcceptance)
    .map((gate) => gate.gateId);
  const readyCommandIds = lifecycleControlState.pendingCommands
    .filter((command) => command.status === "ready")
    .map((command) => command.commandId);
  const blockedCommandIds = lifecycleControlState.pendingCommands
    .filter((command) => command.status === "blocked")
    .map((command) => command.commandId);
  const blockingReasons = acceptanceSubmission.submitted ? [
    ...(acceptanceSubmission.acceptedBy ? [] : ["acceptance-missing-actor"]),
    ...(acceptanceSubmission.readinessStatus && acceptanceSubmission.readinessStatus !== previewAcceptance.readiness.status
      ? ["acceptance-readiness-status-stale"]
      : []),
    ...(previewClientContract.canAccept ? [] : previewClientContract.disabledReasons),
    ...(missingAcceptedGateIds.length ? ["accepted-gates-incomplete"] : []),
    ...(validationSummary.counts.errors ? ["validation-errors-present"] : []),
    ...(workspaceBoundaryState.violations.length ? ["workspace-boundary-violations-present"] : []),
    ...(previewAcceptance.readiness.status === "blocked" && !acceptanceSubmission.blockedOverrideReason
      ? ["blocked-readiness-requires-override-reason"]
      : [])
  ] : [];
  const warningReasons = [
    ...(unacknowledgedWarnings.length ? ["validation-warnings-unacknowledged"] : []),
    ...(previewAcceptance.readiness.status === "attention" ? ["readiness-attention"] : []),
    ...(blockedCommandIds.length ? ["blocked-commands-remain"] : [])
  ];
  const decisionStatus = !acceptanceSubmission.submitted
    ? "pending"
    : blockingReasons.length
    ? "rejected"
    : warningReasons.length
      ? "accepted-with-review"
      : "accepted";

  return {
    contractVersion: "hosted-kernel-owner-identity.acceptance-decision.v1",
    generatedAt: now,
    acceptanceId: acceptanceSubmission.acceptanceId,
    submitted: acceptanceSubmission.submitted,
    status: decisionStatus,
    accepted: decisionStatus === "accepted" || decisionStatus === "accepted-with-review",
    acceptedBy: acceptanceSubmission.acceptedBy || null,
    acceptedAt: acceptanceSubmission.acceptedAt,
    readinessStatus: previewAcceptance.readiness.status,
    submittedReadinessStatus: acceptanceSubmission.readinessStatus || null,
    routeStatus: previewClientContract.status,
    blockingReasons: Array.from(new Set(blockingReasons)),
    warningReasons: Array.from(new Set(warningReasons)),
    gateDigest,
    commandAcceptance: {
      readyCommandIds,
      blockedCommandIds,
      dueNowCommandIds: lifecycleControlState.queueControls.queueBuckets.dueNowCommandIds,
      acceptedForExecutionCommandIds: decisionStatus === "accepted" || decisionStatus === "accepted-with-review"
        ? readyCommandIds
        : [],
      nextCommandId: lifecycleControlState.nextAction.commandId || null
    },
    validationAcknowledgement: {
      status: validationSummary.status,
      acknowledgedWarningCodes: acceptanceSubmission.warningAcknowledgements,
      unacknowledgedWarningCodes: unacknowledgedWarnings,
      errorCount: validationSummary.counts.errors,
      warningCount: validationSummary.counts.warnings
    },
    nextStep: decisionStatus === "pending"
      ? {
          action: previewClientContract.canAccept ? "submit-owner-identity-acceptance" : "review-preview-acceptance",
          label: previewClientContract.canAccept ? "Submit owner identity acceptance" : "Review preview acceptance",
          reason: previewClientContract.canAccept
            ? "Preview acceptance is ready for an acceptance submission"
            : "Acceptance is pending until preview gates are ready",
          route: previewClientContract.canAccept
            ? `${surfaceGroup}/${surfaceName}/acceptance`
            : `${surfaceGroup}/${surfaceName}/preview-acceptance`
        }
      : decisionStatus === "rejected"
      ? previewAcceptance.nextSteps[0] || {
          action: "review-preview-acceptance",
          label: "Review preview acceptance",
          reason: "Acceptance is blocked until required gates and validation errors are resolved",
          route: `${surfaceGroup}/${surfaceName}/preview-acceptance`
        }
      : {
          action: readyCommandIds.length ? "execute-accepted-lifecycle-command" : "record-owner-identity-acceptance",
          label: readyCommandIds.length ? "Execute accepted lifecycle command" : "Record owner identity acceptance",
          reason: decisionStatus === "accepted-with-review"
            ? "Acceptance is recorded with warnings requiring review"
            : "Acceptance gates and validation checks are satisfied",
          route: readyCommandIds.length
            ? `${surfaceGroup}/${surfaceName}/lifecycle-controls`
            : `${surfaceGroup}/${surfaceName}/acceptance`
        },
    audit: {
      proofRefs: Array.from(new Set([
        acceptanceSubmission.proofRef,
        ...previewAcceptance.acceptanceGates.flatMap((gate) => gate.evidenceRefs),
        ...lifecycleControlState.pendingCommands.map((command) => command.proofRef)
      ].filter(Boolean))),
      route: `${surfaceGroup}/${surfaceName}/acceptance-decision`,
      clientRequestId: acceptanceSubmission.clientRequestId || null,
      blockedOverrideReason: acceptanceSubmission.blockedOverrideReason || null
    }
  };
}

function normalizeMailchimpScopeReceiptRows(providerAcknowledgements = {}, submittedReceipts = [], now) {
  const receiptContract = providerAcknowledgements.receiptContract &&
    typeof providerAcknowledgements.receiptContract === "object"
    ? providerAcknowledgements.receiptContract
    : {};
  const contractRows = Array.isArray(receiptContract.rows) ? receiptContract.rows : [];
  const rows = [...contractRows, ...submittedReceipts]
    .filter((receipt) => receipt && typeof receipt === "object")
    .map((receipt, index) => {
      const providerId = stableText(receipt.providerId || receipt.provider, "");
      const requestedScope = stableText(receipt.requestedScope || receipt.scope, "");
      const idempotencyKey = stableText(receipt.idempotencyKey || receipt.key, "");
      const receiptId = stableText(receipt.receiptId || receipt.id || receipt.submittedReceiptId, "");
      const rawState = stableText(receipt.state || receipt.status || receipt.receiptStatus, "pending");
      const accepted = receipt.accepted === true || ["accepted", "completed", "acknowledged"].includes(rawState);
      const failed = receipt.failed === true || ["failed", "rejected", "blocked"].includes(rawState);
      const inheritedBlockers = normalizeStringList(receipt.blockers);
      const blockers = [
        ...(providerId ? [] : ["mailchimp-scope-receipt-provider-missing"]),
        ...(requestedScope ? [] : ["mailchimp-scope-receipt-scope-missing"]),
        ...(receiptId || idempotencyKey ? [] : ["mailchimp-scope-receipt-identity-missing"]),
        ...(failed ? inheritedBlockers.length ? inheritedBlockers : ["mailchimp-scope-receipt-rejected"] : [])
      ];

      return {
        contractVersion: "hosted-kernel-owner-identity.mailchimp-scope-receipt-row.v1",
        index,
        providerId,
        providerContractId: stableText(receipt.providerContractId || receipt.contractId, ""),
        requestedScope,
        receiptId,
        idempotencyKey,
        state: accepted && blockers.length === 0 ? "accepted" : failed || blockers.length ? "blocked" : "pending",
        accepted: accepted && blockers.length === 0,
        failed: failed || blockers.length > 0,
        receivedAt: normalizeTimestamp(receipt.receivedAt || receipt.at || receipt.timestamp, now),
        proofRef: stableText(
          receipt.proofRef || receipt.proof || receipt.suppliedReceiptProofRef,
          `mailchimp-scope-receipt:${providerId || "provider"}:${requestedScope || index}:${now}`
        ),
        source: contractRows.includes(receipt) ? "scope-matcher-receipt-contract" : "submitted-receipt",
        blockers: Array.from(new Set(blockers)).sort(),
        matchKeys: [
          [providerId, requestedScope, idempotencyKey].join("|"),
          [providerId, requestedScope, receiptId].join("|")
        ].filter((key) => !key.endsWith("|"))
      };
    });

  return {
    contractVersion: "hosted-kernel-owner-identity.mailchimp-scope-receipt-ledger.v1",
    supplied: rows.length > 0,
    status: rows.some((row) => row.state === "blocked")
      ? "blocked"
      : rows.some((row) => row.state === "pending")
        ? "pending"
        : rows.some((row) => row.state === "accepted")
          ? "accepted"
          : "not-supplied",
    acceptedCount: rows.filter((row) => row.accepted).length,
    pendingCount: rows.filter((row) => row.state === "pending").length,
    blockedCount: rows.filter((row) => row.state === "blocked").length,
    blockers: Array.from(new Set(rows.flatMap((row) => row.blockers))).sort(),
    rows
  };
}

function normalizeMailchimpScopeAcknowledgement(input = {}, source = {}, now) {
  const clientState = input.clientState && typeof input.clientState === "object" ? input.clientState : {};
  const scopeMatcher = input.scopeMatcher && typeof input.scopeMatcher === "object"
    ? input.scopeMatcher
    : clientState.scopeMatcher && typeof clientState.scopeMatcher === "object"
      ? clientState.scopeMatcher
      : {};
  const bridge = scopeMatcher.mailchimpClientAdoptionBridge ||
    input.mailchimpClientAdoptionBridge ||
    source.mailchimpClientAdoptionBridge ||
    source.mailchimpScopeAcknowledgement ||
    {};
  const providerAcknowledgements = bridge.providerAcknowledgements ||
    input.mailchimpProviderAcknowledgements ||
    source.mailchimpProviderAcknowledgements ||
    source.providerAcknowledgements ||
    {};
  const rawRows = Array.isArray(providerAcknowledgements.rows)
    ? providerAcknowledgements.rows
    : Array.isArray(providerAcknowledgements.route?.rows)
      ? providerAcknowledgements.route.rows
      : Array.isArray(input.mailchimpScopeAcknowledgements)
        ? input.mailchimpScopeAcknowledgements
      : Array.isArray(source.mailchimpScopeAcknowledgements)
        ? source.mailchimpScopeAcknowledgements
        : [];
  const submittedReceipts = Array.isArray(source.mailchimpScopeReceipts)
    ? source.mailchimpScopeReceipts
    : Array.isArray(input.mailchimpScopeReceipts)
      ? input.mailchimpScopeReceipts
    : Array.isArray(source.providerAcknowledgementReceipts)
      ? source.providerAcknowledgementReceipts
      : [];
  const receiptLedger = normalizeMailchimpScopeReceiptRows(providerAcknowledgements, submittedReceipts, now);
  const receiptByKey = new Map(receiptLedger.rows.flatMap((receipt) =>
    receipt.matchKeys.map((key) => [key, receipt])
  ));
  const rows = rawRows
    .filter((row) => row && typeof row === "object")
    .map((row, index) => {
      const expectedReceipt = row.expectedReceipt && typeof row.expectedReceipt === "object"
        ? row.expectedReceipt
        : {};
      const providerId = stableText(row.providerId || expectedReceipt.providerId, "");
      const requestedScope = stableText(row.requestedScope || expectedReceipt.requestedScope, "");
      const idempotencyKey = stableText(row.idempotencyKey || expectedReceipt.idempotencyKey, `mailchimp-scope-ack:${index + 1}`);
      const receipt = receiptByKey.get([providerId, requestedScope, idempotencyKey].join("|")) ||
        receiptByKey.get([providerId, requestedScope, expectedReceipt.receiptId || row.receiptId || ""].join("|")) ||
        {};
      const rawState = stableText(receipt.state || row.dispatchState, "pending");
      const accepted = receipt.accepted === true || ["accepted", "completed", "acknowledged"].includes(rawState);
      const failed = receipt.failed === true || ["failed", "rejected", "blocked"].includes(rawState);
      const expectedProviderMismatch = Boolean(receipt.providerId && providerId && receipt.providerId !== providerId);
      const expectedScopeMismatch = Boolean(receipt.requestedScope && requestedScope && receipt.requestedScope !== requestedScope);
      const expectedIdMismatch = Boolean(
        receipt.idempotencyKey &&
          expectedReceipt.idempotencyKey &&
          receipt.idempotencyKey !== expectedReceipt.idempotencyKey
      );
      const rowBlockers = Array.from(new Set([
        ...normalizeStringList(row.blockers),
        ...normalizeStringList(receipt.blockers),
        ...(expectedProviderMismatch ? ["mailchimp-scope-ack-provider-mismatch"] : []),
        ...(expectedScopeMismatch ? ["mailchimp-scope-ack-scope-mismatch"] : []),
        ...(expectedIdMismatch ? ["mailchimp-scope-ack-idempotency-mismatch"] : [])
      ])).sort();
      const rowAccepted = accepted && rowBlockers.length === 0;
      const rowFailed = failed || rowBlockers.length > 0;

      return {
        contractVersion: "hosted-kernel-owner-identity.mailchimp-scope-acknowledgement-row.v1",
        providerId,
        providerContractId: stableText(row.providerContractId || expectedReceipt.providerContractId, ""),
        requestedScope,
        requiredEvents: normalizeStringList(row.requiredEvents || expectedReceipt.requiredEvents),
        receiptRoute: stableText(row.receiptRoute || providerAcknowledgements.route?.route, ""),
        receiptId: stableText(receipt.receiptId || expectedReceipt.receiptId || row.receiptId, ""),
        state: rowAccepted ? "accepted" : rowFailed ? "blocked" : rawState === "ready" ? "pending" : rawState,
        accepted: rowAccepted,
        failed: rowFailed,
        supplied: Object.keys(receipt).length > 0,
        idempotencyKey,
        receiptStatus: receipt.state || "missing",
        receiptReceivedAt: receipt.receivedAt || null,
        expectedReceiptId: stableText(expectedReceipt.receiptId, ""),
        proofRef: stableText(
          receipt.proofRef || receipt.proof || expectedReceipt.proofRef || row.proofRef,
          `mailchimp-scope-ack:${providerId || "provider"}:${requestedScope || index}:${now}`
        ),
        blockers: rowBlockers,
        nextAction: rowAccepted
          ? "continue-mailchimp-lifecycle-handoff"
          : rowFailed
            ? "repair-mailchimp-scope-acknowledgement"
            : "submit-mailchimp-scope-acknowledgement"
      };
    });
  const required = providerAcknowledgements.required === true || rows.length > 0;
  const missingRows = rows.filter((row) => !row.accepted && !row.failed);
  const failedRows = rows.filter((row) => row.failed);
  const blockers = Array.from(new Set([
    ...failedRows.flatMap((row) => row.blockers.length ? row.blockers : ["mailchimp-scope-acknowledgement-failed"]),
    ...(missingRows.length ? ["mailchimp-scope-acknowledgement-pending"] : [])
  ])).sort();

  return {
    contractVersion: "hosted-kernel-owner-identity.mailchimp-scope-acknowledgement.v1",
    supplied: Object.keys(providerAcknowledgements).length > 0 || rawRows.length > 0 || receiptLedger.supplied,
    required,
    status: !required
      ? "not-required"
      : failedRows.length
        ? "blocked"
        : missingRows.length
          ? "pending"
          : "accepted",
    acceptedCount: rows.filter((row) => row.accepted).length,
    pendingCount: missingRows.length,
    blockedCount: failedRows.length,
    receiptDigest: rows
      .map((row) => [row.providerId, row.requestedScope, row.receiptId || row.idempotencyKey, row.state].join(":"))
      .sort()
      .join("|"),
    receiptLedger,
    blockers,
    nextAction: failedRows.length
      ? "repair-mailchimp-scope-acknowledgement"
      : missingRows.length
        ? "submit-mailchimp-scope-acknowledgement"
        : required
          ? "continue-mailchimp-lifecycle-handoff"
          : "none",
    rows
  };
}

function normalizeClientRequestState(input = {}, now, workspaceScope) {
  const source = input.clientRequest || input.request || input.clientState || {};
  const actorSource = source.authorizationSubject || source.actorIdentity || source.principal || source.actorSubject || {};
  const hasActorObject = actorSource && typeof actorSource === "object" && !Array.isArray(actorSource);
  const actorSubject = hasActorObject ? actorSource : {};
  const rawActorType = stableText(actorSubject.type || actorSubject.subjectType || source.actorType, "owner");
  const actorId = stableText(
    actorSubject.actorId || actorSubject.subjectId || actorSubject.id || source.actorId || source.actor,
    ""
  );
  const actorOwnerId = stableText(
    actorSubject.ownerId || actorSubject.owner || source.actorOwnerId || source.ownerId || source.owner,
    ""
  );
  const actorPermissions = normalizePermissionList(
    actorSubject.permissions || actorSubject.capabilities || source.actorPermissions || source.actorCapabilities
  );
  const actorRoles = normalizeRoleList(actorSubject.roles || actorSubject.role || source.actorRoles || source.actorRole);
  const actorProofRef = stableText(
    actorSubject.proofRef || actorSubject.proof || source.actorProofRef || source.authorizationProofRef,
    ""
  );
  const preferredWorkflow = [
    "preview",
    "lifecycle-command",
    "owner-transfer",
    "provider-handoff",
    "audit-review",
    "operational-health"
  ].includes(source.preferredWorkflow || source.workflow)
    ? source.preferredWorkflow || source.workflow
    : "preview";
  const rawCapabilities = normalizeStringList(source.clientCapabilities || source.capabilities);
  const mailchimpScopeAcknowledgement = normalizeMailchimpScopeAcknowledgement(input, source, now);
  return {
    contractVersion: "hosted-kernel-owner-identity.client-request.v1",
    requestId: stableText(source.requestId || source.id, `owner-identity-request:${now}`),
    sessionId: stableText(source.sessionId || source.session, `owner-identity-session:${workspaceScope.workspaceId}`),
    actorOwnerId,
    actorIdentity: actorId || actorOwnerId
      ? {
          actorId: actorId || actorOwnerId,
          subjectType: authorizationSubjectTypes.has(rawActorType) ? rawActorType : "owner",
          ownerId: actorOwnerId || actorId,
          displayName: stableText(actorSubject.displayName || actorSubject.name || source.actorDisplayName, actorId || actorOwnerId),
          tenantId: scopedText(actorSubject.tenantId || actorSubject.tenant || source.actorTenantId, workspaceScope.tenantId),
          workspaceId: scopedText(actorSubject.workspaceId || actorSubject.workspace || source.actorWorkspaceId, workspaceScope.workspaceId),
          roles: actorRoles,
          permissions: actorPermissions,
          proofProvided: Boolean(actorProofRef),
          proofRef: actorProofRef || `client-request-actor:${actorId || actorOwnerId}:${now}`,
          authorizationSource: "client-request"
        }
      : null,
    selectedKernelId: stableText(source.selectedKernelId || source.kernelId || source.kernel, ""),
    selectedCommandId: stableText(source.selectedCommandId || source.commandId || source.command, ""),
    preferredWorkflow,
    returnRoute: stableText(source.returnRoute || source.returnTo, `${surfaceGroup}/${surfaceName}/preview-acceptance`),
    locale: stableText(source.locale, "en-US"),
    tenantId: scopedText(source.tenantId || source.tenant, workspaceScope.tenantId),
    workspaceId: scopedText(source.workspaceId || source.workspace, workspaceScope.workspaceId),
    requestedCapabilities: rawCapabilities.filter((capability) => ownerIdentityCapabilities.has(capability)),
    rejectedCapabilities: rawCapabilities.filter((capability) => !ownerIdentityCapabilities.has(capability)),
    mailchimpScopeAcknowledgement,
    requestedAt: normalizeTimestamp(source.requestedAt || source.at, now),
    proofRef: stableText(source.proofRef || source.proof, `client-request:${workspaceScope.tenantId}:${workspaceScope.workspaceId}:${now}`)
  };
}

function routeForClientWorkflow(workflow, fallbackRoute) {
  if (workflow === "lifecycle-command") return `${surfaceGroup}/${surfaceName}/lifecycle-controls`;
  if (workflow === "owner-transfer") return `${surfaceGroup}/${surfaceName}/owner-transfer-handoff`;
  if (workflow === "provider-handoff") return `${surfaceGroup}/${surfaceName}/external-handoff`;
  if (workflow === "audit-review") return `${surfaceGroup}/${surfaceName}/audit-handoff`;
  if (workflow === "operational-health") return `${surfaceGroup}/${surfaceName}/operational-health`;
  return fallbackRoute;
}

function buildClientRuntimeHandoff({
  clientRequestState,
  owners,
  lifecycleControlState,
  ownerTransferState,
  providerServiceContracts,
  previewClientContract,
  operationalHealth,
  workspaceScope,
  now
}) {
  const selectedCommand = lifecycleControlState.pendingCommands.find((command) =>
    command.commandId === clientRequestState.selectedCommandId
  ) || lifecycleControlState.pendingCommands.find((command) =>
    command.status === "ready" && (!clientRequestState.selectedKernelId || command.kernelId === clientRequestState.selectedKernelId)
  ) || null;
  const selectedOwner = owners.find((owner) => owner.ownerId === clientRequestState.actorOwnerId) ||
    owners.find((owner) => owner.verified) ||
    owners[0] ||
    null;
  const selectedTransfer = selectedCommand
    ? ownerTransferState.transfers.find((transfer) => transfer.commandId === selectedCommand.commandId) || null
    : ownerTransferState.nextHandoff;
  const readyProviders = providerServiceContracts.providers.filter((contract) =>
    providerServiceContracts.externalHandoffState.readyProviderIds.includes(contract.providerId)
  );
  const mailchimpScopeAcknowledgement = clientRequestState.mailchimpScopeAcknowledgement || {
    status: "not-required",
    required: false,
    rows: []
  };
  const requestInScope = workspaceScope.boundaryMode === "permissive" ||
    (workspaceScope.allowedTenantIds.includes(clientRequestState.tenantId) &&
      workspaceScope.allowedWorkspaceIds.includes(clientRequestState.workspaceId));
  const blockedReasons = [
    ...(requestInScope ? [] : ["client-request-outside-workspace-boundary"]),
    ...(clientRequestState.rejectedCapabilities.length ? ["client-requested-unknown-capabilities"] : []),
    ...(selectedCommand?.status === "blocked" ? selectedCommand.errors : []),
    ...(previewClientContract.disabledReasons || []),
    ...(operationalHealth.executionGuards.allowProviderHandoff ? [] : ["provider-handoff-guard-blocked"])
  ];
  const preferredRoute = routeForClientWorkflow(clientRequestState.preferredWorkflow, previewClientContract.route);
  const recommendedRoute = blockedReasons.length
    ? `${surfaceGroup}/${surfaceName}/next-steps`
    : selectedTransfer?.status === "ready-for-handoff"
      ? `${surfaceGroup}/${surfaceName}/owner-transfer-handoff`
      : selectedCommand
        ? `${surfaceGroup}/${surfaceName}/lifecycle-controls`
        : readyProviders.length
          ? `${surfaceGroup}/${surfaceName}/external-handoff`
          : preferredRoute;

  return {
    contractVersion: "hosted-kernel-owner-identity.client-runtime-handoff.v1",
    generatedAt: now,
    request: clientRequestState,
    requestAdoption: {
      status: blockedReasons.length ? "blocked" : selectedCommand || selectedTransfer || readyProviders.length ? "adopted" : "idle",
      route: recommendedRoute,
      preferredRoute,
      returnRoute: clientRequestState.returnRoute,
      blockedReasons: Array.from(new Set(blockedReasons)),
      acceptedCapabilities: clientRequestState.requestedCapabilities,
      rejectedCapabilities: clientRequestState.rejectedCapabilities
    },
    visibleContext: {
      ownerId: selectedOwner?.ownerId || null,
      ownerDisplayName: selectedOwner?.displayName || null,
      ownerVerified: Boolean(selectedOwner?.verified),
      kernelId: selectedCommand?.kernelId || selectedTransfer?.kernelId || clientRequestState.selectedKernelId || null,
      commandId: selectedCommand?.commandId || selectedTransfer?.commandId || null,
      commandStatus: selectedCommand?.status || null,
      actorId: selectedCommand?.authorization?.actorId || clientRequestState.actorOwnerId || null,
      actorSubjectType: selectedCommand?.authorization?.subjectType || null,
      authorizationSource: selectedCommand?.requestAuthorization?.source || clientRequestState.actorIdentity?.authorizationSource || null,
      adoptedClientAuthorization: Boolean(selectedCommand?.requestAuthorization?.adopted),
      requestId: selectedCommand?.requestAuthorization?.requestId || clientRequestState.requestId,
      sessionId: selectedCommand?.requestAuthorization?.sessionId || clientRequestState.sessionId,
      actorDelegated: Boolean(selectedCommand?.authorization?.delegated),
      mailchimpScopeAcknowledgementStatus: mailchimpScopeAcknowledgement.status,
      mailchimpScopeAcknowledgementRequired: mailchimpScopeAcknowledgement.required,
      mailchimpScopeAcknowledgementAcceptedCount: mailchimpScopeAcknowledgement.acceptedCount || 0,
      mailchimpScopeAcknowledgementPendingCount: mailchimpScopeAcknowledgement.pendingCount || 0,
      nextAction: lifecycleControlState.nextAction.action,
      readinessStatus: previewClientContract.status,
      operationalMode: operationalHealth.mode
    },
    handoffActions: [
      ...(selectedCommand
        ? [{
            action: selectedCommand.status === "ready" ? "execute-lifecycle-command" : "repair-lifecycle-command",
            route: `${surfaceGroup}/${surfaceName}/lifecycle-controls`,
            commandId: selectedCommand.commandId,
            kernelId: selectedCommand.kernelId,
            method: "POST",
            disabled: selectedCommand.status !== "ready" || !operationalHealth.executionGuards.allowLifecycleMutation,
            authorization: selectedCommand.authorization
              ? {
                  actorId: selectedCommand.authorization.actorId,
                  subjectType: selectedCommand.authorization.subjectType,
                  delegated: selectedCommand.authorization.delegated,
                  requiredPermission: selectedCommand.authorization.requiredPermission,
                  permissionGranted: selectedCommand.authorization.permissionGranted,
                  authorizationSource: selectedCommand.requestAuthorization?.source || selectedCommand.authorization.authorizationSource,
                  requestId: selectedCommand.requestAuthorization?.requestId || null,
                  sessionId: selectedCommand.requestAuthorization?.sessionId || null,
                  adoptedClientAuthorization: Boolean(selectedCommand.requestAuthorization?.adopted),
                  proofRef: selectedCommand.authorization.proofRef
                }
              : null,
            proofRef: selectedCommand.proofRef
          }]
        : []),
      ...(selectedTransfer
        ? [{
            action: "handoff-owner-transfer",
            route: `${surfaceGroup}/${surfaceName}/owner-transfer-handoff`,
            commandId: selectedTransfer.commandId,
            kernelId: selectedTransfer.kernelId,
            method: "POST",
            disabled: selectedTransfer.status !== "ready-for-handoff" || !operationalHealth.executionGuards.allowProviderHandoff,
            proofRefs: selectedTransfer.proofRefs
          }]
        : []),
      ...readyProviders.map((provider) => ({
        action: "sync-provider-handoff",
        route: provider.endpoint,
        providerId: provider.providerId,
        method: "POST",
        disabled: !operationalHealth.executionGuards.allowProviderHandoff,
        proofRef: provider.externalHandoff.proofRef
      })),
      ...(mailchimpScopeAcknowledgement.required
        ? [{
            action: mailchimpScopeAcknowledgement.status === "accepted"
              ? "continue-mailchimp-lifecycle-handoff"
              : "submit-mailchimp-scope-acknowledgement",
            route: `${surfaceGroup}/${surfaceName}/mailchimp-lifecycle-handoff`,
            method: "POST",
            disabled: mailchimpScopeAcknowledgement.status === "blocked",
            status: mailchimpScopeAcknowledgement.status,
            nextAction: mailchimpScopeAcknowledgement.nextAction,
            acceptedCount: mailchimpScopeAcknowledgement.acceptedCount,
            pendingCount: mailchimpScopeAcknowledgement.pendingCount,
            blockedCount: mailchimpScopeAcknowledgement.blockedCount,
            receiptDigest: mailchimpScopeAcknowledgement.receiptDigest,
            rows: mailchimpScopeAcknowledgement.rows.map((row) => ({
              providerId: row.providerId,
              requestedScope: row.requestedScope,
              receiptId: row.receiptId,
              state: row.state,
              nextAction: row.nextAction
            }))
          }]
        : [])
    ],
    audit: {
      proofRefs: Array.from(new Set([
        clientRequestState.proofRef,
        selectedOwner?.proofRef,
        selectedCommand?.proofRef,
        ...(selectedTransfer?.proofRefs || []),
        ...readyProviders.map((provider) => provider.externalHandoff.proofRef),
        ...mailchimpScopeAcknowledgement.rows.map((row) => row.proofRef)
      ].filter(Boolean))),
      workspace: {
        tenantId: workspaceScope.tenantId,
        workspaceId: workspaceScope.workspaceId,
        boundaryMode: workspaceScope.boundaryMode
      }
    }
  };
}

export function describeOwnerIdentitySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const ownerClaims = Array.isArray(input.ownerClaims) ? input.ownerClaims : [];
  const lifecycleEvents = Array.isArray(input.lifecycleEvents) ? input.lifecycleEvents : [];
  const lifecycleCommands = Array.isArray(input.lifecycleCommands) ? input.lifecycleCommands : [];
  const privilegedJobInputs = Array.isArray(input.privilegedJobs)
    ? input.privilegedJobs
    : Array.isArray(input.jobs)
      ? input.jobs
      : Array.isArray(input.jobQueue)
        ? input.jobQueue
        : [];
  const providerContracts = Array.isArray(input.providerContracts)
    ? input.providerContracts
    : Array.isArray(input.integrationProviders)
      ? input.integrationProviders
      : [];
  const lifecycleSettings = normalizeLifecycleSettings(input.lifecycleSettings || input.settings || {});
  const workspaceScope = normalizeWorkspaceScope(input.workspaceScope || input.tenantBoundary || input.workspace || {}, now);
  const clientRequestState = normalizeClientRequestState(input, now, workspaceScope);
  const acceptanceSubmission = normalizeAcceptanceSubmission(input, now);
  const operationalTelemetry = normalizeOperationalTelemetry(input.operationalTelemetry || input.healthTelemetry || {}, now);
  const persistedRuntimeState = normalizePersistedOwnerIdentityState(input, now, workspaceScope);
  const owners = ownerClaims.map((claim, index) => normalizeOwnerClaim(claim, index, now, workspaceScope));
  const events = lifecycleEvents.map((event, index) => normalizeLifecycleEvent(event, index, now, workspaceScope));
  const commands = lifecycleCommands.map((command, index) =>
    normalizeLifecycleCommand(command, index, now, workspaceScope, clientRequestState)
  );
  const privilegedJobs = privilegedJobInputs.map((job, index) =>
    normalizePrivilegedJob(job, index, now, workspaceScope, clientRequestState)
  );
  const providers = providerContracts.map((provider, index) => normalizeProviderContract(provider, index, now, workspaceScope));
  const ownerIdentityRegistry = buildOwnerIdentityRegistry(owners, workspaceScope, now);
  const basePrivilegedJobAuthorizationState = buildPrivilegedJobAuthorizationState({
    jobs: privilegedJobs,
    ownerIdentityRegistry,
    workspaceScope,
    now
  });
  const privilegedJobAuthorizationState = buildRestartSafePrivilegedJobAuthorizationState({
    privilegedJobAuthorizationState: basePrivilegedJobAuthorizationState,
    persistedRuntimeState,
    now
  });
  const timeline = buildTimeline(events);
  const historySnapshots = buildHistorySnapshots(events, owners, now);
  const baseLifecycleControlState = buildLifecycleControlState({
    commands,
    owners,
    timeline,
    settings: lifecycleSettings,
    workspaceScope,
    now,
    persistedRuntimeState,
    ownerIdentityRegistry
  });
  const lifecycleControlState = buildRestartSafeLifecycleState({
    lifecycleControlState: baseLifecycleControlState,
    privilegedJobAuthorizationState,
    persistedRuntimeState,
    now
  });
  const ownerTransferState = buildOwnerTransferContract({
    owners,
    lifecycleControlState,
    timeline,
    workspaceScope,
    now
  });
  const providerServiceContracts = buildProviderServiceContractState({
    providers,
    owners,
    timeline,
    lifecycleControlState,
    workspaceScope,
    now
  });
  const mailchimpLifecycleHandoffControl = buildMailchimpLifecycleHandoffControl({
    providerServiceContracts,
    lifecycleControlState,
    clientRequestState,
    now
  });
  const workspaceBoundaryState = buildWorkspaceBoundaryState({
    workspaceScope,
    owners,
    events,
    commands,
    providers,
    lifecycleControlState,
    providerServiceContracts,
    ownerIdentityRegistry,
    privilegedJobAuthorizationState,
    now
  });
  const analytics = buildAnalytics({
    events,
    owners,
    evidence,
    timeline,
    lifecycleControlState,
    ownerTransferState,
    providerServiceContracts,
    workspaceBoundaryState,
    ownerIdentityRegistry,
    privilegedJobAuthorizationState,
    now
  });
  const previewAcceptance = buildPreviewAcceptanceContract({
    now,
    owners,
    timeline,
    lifecycleControlState,
    providerServiceContracts,
    workspaceBoundaryState,
    ownerIdentityRegistry,
    privilegedJobAuthorizationState
  });
  const previewClientContract = buildPreviewAcceptanceClientContract({
    previewAcceptance,
    lifecycleControlState,
    providerServiceContracts,
    workspaceBoundaryState,
    now
  });
  const authorizationReview = buildAuthorizationReviewContract({
    lifecycleControlState,
    privilegedJobAuthorizationState,
    previewAcceptance,
    now
  });
  const acceptanceDecision = buildAcceptanceDecisionContract({
    acceptanceSubmission,
    previewAcceptance,
    previewClientContract,
    lifecycleControlState,
    workspaceBoundaryState,
    now
  });
  const operationalHealth = buildOperationalHealthState({
    now,
    lifecycleControlState,
    providerServiceContracts,
    workspaceBoundaryState,
    previewAcceptance,
    operationalTelemetry,
    ownerIdentityRegistry,
    privilegedJobAuthorizationState
  });
  const clientRuntimeHandoff = buildClientRuntimeHandoff({
    clientRequestState,
    owners,
    lifecycleControlState,
    ownerTransferState,
    providerServiceContracts,
    previewClientContract,
    operationalHealth,
    workspaceScope,
    now
  });
  const exportSummary = buildExportSummary({
    now,
    owners,
    events,
    evidence,
    analytics,
    snapshots: historySnapshots,
    lifecycleControlState,
    ownerTransferState,
    providerServiceContracts,
    workspaceBoundaryState,
    ownerIdentityRegistry,
    privilegedJobAuthorizationState,
    operationalHealth,
    restartRecovery: lifecycleControlState.restartRecovery
  });
  const analyticsExportManifest = buildAnalyticsExportManifest({
    now,
    exportSummary,
    analytics,
    snapshots: historySnapshots,
    lifecycleControlState,
    ownerTransferState,
    providerServiceContracts,
    workspaceBoundaryState,
    ownerIdentityRegistry
  });
  const durableStateProjection = lifecycleControlState.durableStateProjection;

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel-owner-identity.analytics.v1',
    dataContract: {
      ownerClaims: "OwnerClaim[]",
      lifecycleEvents: "KernelLifecycleOwnerEvent[]",
      lifecycleCommands: "KernelLifecycleCommand[]",
      lifecycleSettings: "KernelLifecycleOwnerSettings",
      ownerIdentityRegistry: "HostedKernelOwnerIdentityRegistry",
      ownerIdentityClaimConflict: "HostedKernelOwnerIdentityClaimConflict[]",
      kernelOwnerBindings: "HostedKernelOwnerIdentityKernelOwnerBindings",
      kernelOwnerBinding: "HostedKernelOwnerIdentityKernelOwnerBinding",
      lifecycleSettingsControlState: "HostedKernelOwnerLifecycleSettingsControlState",
      lifecycleQueueControls: "HostedKernelOwnerLifecycleQueueControls",
      lifecycleQueueConflict: "HostedKernelOwnerLifecycleQueueConflict",
      ownerTransferState: "HostedKernelOwnerTransferState",
      ownerTransferHandoff: "HostedKernelOwnerTransferHandoff",
      workspaceScope: "HostedKernelOwnerWorkspaceScope",
      workspaceBoundaryState: "HostedKernelOwnerWorkspaceBoundaryState",
      workspaceBoundaryEvaluation: "HostedKernelOwnerWorkspaceBoundaryEvaluation",
      boundaryAuditHandoff: "HostedKernelOwnerBoundaryAuditHandoff",
      lifecycleControlState: "KernelLifecycleControlState",
      lifecycleAuthorizationMetadata: "HostedKernelOwnerLifecycleAuthorizationMetadata",
      requestAuthorizationAdoption: "HostedKernelOwnerIdentityRequestAuthorizationAdoption",
      authorizationReporting: "HostedKernelOwnerIdentityAuthorizationReporting",
      authorizationDecisionRows: "HostedKernelOwnerIdentityAuthorizationDecisionRow[]",
      authorizationReview: "HostedKernelOwnerIdentityAuthorizationReview",
      authorizationReviewItem: "HostedKernelOwnerIdentityAuthorizationReviewItem",
      privilegedJobs: "HostedKernelOwnerPrivilegedJob[]",
      privilegedJobAuthorizationState: "HostedKernelOwnerPrivilegedJobAuthorizationState",
      privilegedJobAuthorization: "HostedKernelOwnerPrivilegedJobAuthorization",
      privilegedJobRestartRecovery: "HostedKernelOwnerPrivilegedJobRestartRecovery",
      providerContracts: "HostedKernelOwnerProviderContract[]",
      providerServiceContracts: "HostedKernelOwnerProviderContractState",
      mailchimpProviderReporting: "HostedKernelOwnerIdentityMailchimpProviderReporting",
      mailchimpProviderRows: "HostedKernelOwnerIdentityMailchimpProviderRow[]",
      mailchimpProviderAcceptanceBoundary: "HostedKernelOwnerIdentityMailchimpProviderAcceptanceBoundary",
      mailchimpLifecycleHandoffControl: "HostedKernelOwnerIdentityMailchimpLifecycleHandoffControl",
      mailchimpLifecycleHandoffProviderPayload: "HostedKernelOwnerIdentityMailchimpLifecycleHandoffProviderPayload[]",
      mailchimpScopeAcknowledgement: "HostedKernelOwnerIdentityMailchimpScopeAcknowledgement",
      mailchimpScopeAcknowledgementRows: "HostedKernelOwnerIdentityMailchimpScopeAcknowledgementRow[]",
      previewAcceptance: "HostedKernelOwnerIdentityPreviewAcceptance",
      previewClientContract: "HostedKernelOwnerIdentityPreviewClientContract",
      clientRequestState: "HostedKernelOwnerIdentityClientRequest",
      clientRuntimeHandoff: "HostedKernelOwnerIdentityClientRuntimeHandoff",
      acceptancePayload: "HostedKernelOwnerIdentityAcceptanceRequest",
      acceptanceSubmission: "HostedKernelOwnerIdentityAcceptanceSubmission",
      acceptanceDecision: "HostedKernelOwnerIdentityAcceptanceDecision",
      acceptanceGateDigest: "HostedKernelOwnerIdentityAcceptanceGateDigest[]",
      validationBadges: "HostedKernelOwnerIdentityValidationBadges",
      readiness: "HostedKernelOwnerIdentityReadiness",
      validationSummary: "HostedKernelOwnerIdentityValidationSummary",
      operationalHealth: "HostedKernelOwnerIdentityOperationalHealth",
      operationalTelemetry: "HostedKernelOwnerIdentityOperationalTelemetry",
      providerRuntimeHealth: "HostedKernelOwnerProviderRuntimeHealth",
      providerFailoverPlan: "HostedKernelOwnerProviderFailoverPlan[]",
      persistedRuntimeState: "HostedKernelOwnerIdentityPersistedRuntimeState",
      recoveredKernelState: "HostedKernelOwnerIdentityRecoveredKernelState",
      durableStateProjection: "HostedKernelOwnerIdentityDurableStateProjection",
      durableCommandReceiptWrite: "HostedKernelOwnerIdentityDurableCommandReceiptWrite",
      durablePrivilegedJobReceiptWrite: "HostedKernelOwnerIdentityDurablePrivilegedJobReceiptWrite",
      commandReceipt: "HostedKernelOwnerIdentityCommandReceipt",
      privilegedJobReceipt: "HostedKernelOwnerIdentityPrivilegedJobReceipt",
      restartRecovery: "HostedKernelOwnerIdentityRestartRecovery",
      restartSafeCommand: "HostedKernelOwnerIdentityRestartSafeCommand",
      actionableErrors: "HostedKernelOwnerIdentityActionableError[]",
      retryPlan: "HostedKernelOwnerIdentityRetryPlan",
      degradedMode: "HostedKernelOwnerIdentityDegradedMode",
      executionGuards: "HostedKernelOwnerIdentityExecutionGuards",
      nextSteps: "HostedKernelOwnerIdentityNextStep[]",
      analytics: "HostedKernelOwnerIdentityAnalyticsReport",
      analyticsCounters: "HostedKernelOwnerIdentityAnalyticsCounters",
      timelineBuckets: "HostedKernelOwnerIdentityTimelineBucket[]",
      reportingState: "HostedKernelOwnerIdentityReportingState",
      exportRows: "HostedKernelOwnerIdentityExportRows",
      historySnapshots: "OwnerIdentityHistorySnapshot[]",
      exportSummary: "OwnerIdentityAnalyticsExport",
      analyticsExportManifest: "HostedKernelOwnerIdentityAnalyticsExportManifest",
      exportManifestSection: "HostedKernelOwnerIdentityExportManifestSection",
      commandLedger: "HostedKernelOwnerIdentityExportCommandLedger",
      timelineReport: "HostedKernelOwnerIdentityTimelineReport"
    },
    analytics,
    ownerIdentityRegistry,
    ownerClaims: owners,
    lifecycleEvents: events,
    lifecycleCommands: commands,
    lifecycleSettings,
    lifecycleSettingsControlState: lifecycleControlState.settingsControlState,
    lifecycleQueueControls: lifecycleControlState.queueControls,
    recoveredKernelState: lifecycleControlState.recoveredKernelState,
    kernelOwnerBindings: lifecycleControlState.kernelOwnerBindings,
    ownerTransferState,
    workspaceScope,
    workspaceBoundaryState,
    lifecycleControlState,
    privilegedJobs,
    privilegedJobAuthorizationState,
    privilegedJobRestartRecovery: privilegedJobAuthorizationState.restartRecovery,
    providerContracts: providers,
    providerServiceContracts,
    mailchimpLifecycleHandoffControl,
    previewAcceptance,
    previewClientContract,
    authorizationReview,
    clientRequestState,
    clientRuntimeHandoff,
    acceptanceSubmission,
    acceptanceDecision,
    readiness: previewAcceptance.readiness,
    validationSummary: previewAcceptance.validationSummary,
    operationalHealth,
    operationalTelemetry,
    persistedRuntimeState,
    durableStateProjection,
    restartRecovery: lifecycleControlState.restartRecovery,
    actionableErrors: operationalHealth.actionableErrors,
    retryPlan: operationalHealth.retryPlan,
    degradedMode: operationalHealth.degradedMode,
    executionGuards: operationalHealth.executionGuards,
    nextSteps: previewAcceptance.nextSteps,
    authorizationReporting: analytics.authorizationReporting,
    timeline,
    historySnapshots,
    exportSummary,
    analyticsExportManifest,
    auditProof: {
      generatedAt: now,
      proofRefs: analyticsExportManifest.audit.proofRefCount + exportSummary.recordCounts.evidence,
      complete: owners.length > 0 && timeline.length > 0 && analyticsExportManifest.audit.complete,
      warnings: [
        ...(owners.length ? [] : ["missing-owner-claims"]),
        ...(ownerIdentityRegistry.status === "blocked" ? ["owner-identity-registry-conflicts"] : []),
        ...(lifecycleControlState.kernelOwnerBindings.status === "blocked" ? ["kernel-owner-bindings-blocked"] : []),
        ...(lifecycleControlState.kernelOwnerBindings.status === "review" ? ["kernel-owner-bindings-review"] : []),
        ...(timeline.length ? [] : ["missing-lifecycle-events"]),
        ...(analytics.counters.verifiedOwners ? [] : ["no-verified-owner"]),
        ...(lifecycleControlState.queue.blocked ? ["blocked-lifecycle-commands"] : []),
        ...(privilegedJobAuthorizationState.blockedJobIds.length ? ["blocked-privileged-jobs"] : []),
        ...(lifecycleControlState.queue.conflicts ? ["lifecycle-command-queue-conflicts"] : []),
        ...(lifecycleControlState.queue.truncated ? ["lifecycle-command-queue-truncated"] : []),
        ...(ownerTransferState.summary.blockedTransfers ? ["blocked-owner-transfers"] : []),
        ...(ownerTransferState.audit.status === "ready" ? ["owner-transfer-handoff-ready"] : []),
        ...(providerServiceContracts.externalHandoffState.blockedProviderIds.length ? ["blocked-provider-contracts"] : []),
        ...(mailchimpLifecycleHandoffControl.status === "blocked" ? ["mailchimp-lifecycle-handoff-blocked"] : []),
        ...(mailchimpLifecycleHandoffControl.status === "dispatch-ready" ? ["mailchimp-lifecycle-handoff-dispatch-ready"] : []),
        ...(mailchimpLifecycleHandoffControl.scopeAcknowledgement?.status === "pending" ? ["mailchimp-scope-acknowledgement-pending"] : []),
        ...(mailchimpLifecycleHandoffControl.scopeAcknowledgement?.status === "blocked" ? ["mailchimp-scope-acknowledgement-blocked"] : []),
        ...(workspaceBoundaryState.violations.length ? ["workspace-boundary-violations"] : []),
        ...(previewAcceptance.readiness.status === "blocked" ? ["preview-acceptance-blocked"] : []),
        ...(previewClientContract.status === "review-enabled" ? ["preview-acceptance-review-required"] : []),
        ...(acceptanceDecision.submitted && acceptanceDecision.status === "rejected" ? ["acceptance-decision-rejected"] : []),
        ...(acceptanceDecision.status === "accepted-with-review" ? ["acceptance-decision-warning-review"] : []),
        ...(authorizationReview.status === "blocked" ? ["authorization-review-blocked"] : []),
        ...(authorizationReview.status === "proof-review-required" ? ["authorization-proof-review-required"] : []),
        ...(operationalHealth.status === "failed" ? ["operational-health-failed"] : []),
        ...(operationalHealth.status === "degraded" ? ["operational-health-degraded"] : []),
        ...(operationalHealth.retryPlan.nextRetryAt ? ["retry-plan-pending"] : []),
        ...(analytics.authorizationReporting.status === "review-required" ? ["authorization-reporting-review-required"] : []),
        ...(lifecycleControlState.restartRecovery.status === "recovered-idempotent" ? ["restart-recovered-idempotent-commands"] : []),
        ...(lifecycleControlState.restartRecovery.status === "recovered-with-blockers" ? ["restart-recovery-blocked-commands"] : []),
        ...(clientRuntimeHandoff.requestAdoption.status === "blocked" ? ["client-runtime-handoff-blocked"] : []),
        ...(analyticsExportManifest.status === "review-required" ? ["analytics-export-manifest-review-required"] : [])
      ],
      ownerIdentityRegistry: {
        status: ownerIdentityRegistry.status,
        ambiguousOwnerIds: ownerIdentityRegistry.ambiguousOwnerIds,
        duplicateClaimGroups: ownerIdentityRegistry.duplicateClaimGroups.length,
        proofRefs: ownerIdentityRegistry.audit.proofRefs
      },
      handoff: workspaceBoundaryState.auditHandoff,
      boundaryEvaluations: {
        evaluatedSubjects: workspaceBoundaryState.evaluations.length,
        violationSubjects: workspaceBoundaryState.auditHandoff.violationSubjects.length,
        proofRefs: workspaceBoundaryState.auditHandoff.evaluationProofRefs
      },
      analyticsExportManifest: {
        manifestId: analyticsExportManifest.manifestId,
        status: analyticsExportManifest.status,
        route: analyticsExportManifest.audit.route,
        proofRefCount: analyticsExportManifest.audit.proofRefCount
      },
      mailchimpLifecycleHandoff: {
        status: mailchimpLifecycleHandoffControl.status,
        providerCount: mailchimpLifecycleHandoffControl.providerCount,
        commandCount: mailchimpLifecycleHandoffControl.commandCount,
        blockers: mailchimpLifecycleHandoffControl.blockers,
        nextActions: mailchimpLifecycleHandoffControl.nextActions,
        route: mailchimpLifecycleHandoffControl.routePayload.route,
        scopeAcknowledgement: {
          status: mailchimpLifecycleHandoffControl.scopeAcknowledgement.status,
          required: mailchimpLifecycleHandoffControl.scopeAcknowledgement.required,
          acceptedCount: mailchimpLifecycleHandoffControl.scopeAcknowledgement.acceptedCount,
          blockedCount: mailchimpLifecycleHandoffControl.scopeAcknowledgement.blockedCount,
          missingProviderIds: mailchimpLifecycleHandoffControl.scopeAcknowledgement.missingProviderIds
        },
        proofRefs: mailchimpLifecycleHandoffControl.exportContract.proofRefs
      },
      restartRecovery: {
        status: lifecycleControlState.restartRecovery.status,
        storageKey: lifecycleControlState.restartRecovery.storageKey,
        proofRefs: lifecycleControlState.restartRecovery.proofRefs,
        durableSnapshotId: durableStateProjection.snapshotId,
        durableProjectionStatus: durableStateProjection.status,
        durableWriteMode: durableStateProjection.writeMode
      }
    },
    integrationPoints: {
      accepts: ["ownerClaims", "lifecycleEvents", "lifecycleCommands", "privilegedJobs", "jobs", "jobQueue", "lifecycleSettings", "workspaceScope", "tenantBoundary", "providerContracts", "integrationProviders", "operationalTelemetry", "healthTelemetry", "providerHealth", "providerRuntimeHealth", "providerStatus", "persistedState", "recoveredState", "previousState", "durableState", "clientRequest", "request", "clientState", "acceptanceSubmission", "acceptanceRequest", "acceptance", "evidence"],
      emits: ["analytics", "analytics.counters", "analytics.authorizationReporting", "analytics.authorizationReporting.exportRows", "analytics.timelineBuckets", "analytics.reportingState", "ownerIdentityRegistry", "ownerIdentityRegistry.duplicateClaimGroups", "ownerIdentityRegistry.integrityErrors", "kernelOwnerBindings", "kernelOwnerBindings.bindings", "kernelOwnerBindings.bindingErrors", "timeline", "historySnapshots", "workspaceBoundaryState", "workspaceBoundaryState.evaluations", "workspaceBoundaryState.auditHandoff", "lifecycleControlState", "lifecycleControlState.pendingCommands.authorization", "lifecycleControlState.pendingCommands.requestAuthorization", "lifecycleControlState.pendingCommands.boundary.kernelOwnerBinding", "privilegedJobs", "privilegedJobAuthorizationState", "privilegedJobAuthorizationState.jobs", "privilegedJobAuthorizationState.jobs.requestAuthorization", "privilegedJobAuthorizationState.authorizationErrors", "lifecycleSettingsControlState", "lifecycleQueueControls", "recoveredKernelState", "ownerTransferState", "ownerTransferState.transfers", "providerServiceContracts", "providerServiceContracts.providers.boundary.evaluation", "providerServiceContracts.mailchimpReporting", "mailchimpLifecycleHandoffControl", "mailchimpLifecycleHandoffControl.providerPayloads", "mailchimpLifecycleHandoffControl.routePayload", "previewAcceptance", "previewClientContract", "authorizationReview", "authorizationReview.items", "authorizationReview.nextReviewTarget", "clientRequestState", "clientRuntimeHandoff", "clientRuntimeHandoff.handoffActions", "previewClientContract.acceptancePayload", "acceptanceSubmission", "acceptanceDecision", "acceptanceDecision.gateDigest", "acceptanceDecision.commandAcceptance", "previewClientContract.validationBadges", "readiness", "validationSummary", "operationalHealth", "operationalTelemetry", "operationalTelemetry.providerHealth", "degradedMode.providerFailoverPlan", "persistedRuntimeState", "durableStateProjection", "durableStateProjection.commandReceiptWrites", "restartRecovery", "actionableErrors", "retryPlan", "degradedMode", "executionGuards", "nextSteps", "exportSummary", "exportSummary.exports", "exportSummary.exports.lifecycleCommandsJson", "exportSummary.exports.privilegedJobsJson", "exportSummary.exports.authorizationDecisionsJson", "exportSummary.exports.kernelOwnerBindingsJson", "exportSummary.exports.mailchimpProvidersJson", "analyticsExportManifest", "analyticsExportManifest.sections", "analyticsExportManifest.commandLedger", "analyticsExportManifest.timelineReport", "auditProof"],
      routes: {
        analyticsExport: `${surfaceGroup}/${surfaceName}/analytics-export`,
        analyticsExportManifest: `${surfaceGroup}/${surfaceName}/analytics-export-manifest`,
        analyticsCounters: `${surfaceGroup}/${surfaceName}/analytics-counters`,
        authorizationReporting: `${surfaceGroup}/${surfaceName}/authorization-reporting`,
        authorizationReview: `${surfaceGroup}/${surfaceName}/authorization-review`,
        timelineReport: `${surfaceGroup}/${surfaceName}/timeline-report`,
        ownerIdentityRegistry: `${surfaceGroup}/${surfaceName}/owner-identity-registry`,
        kernelOwnerBindings: `${surfaceGroup}/${surfaceName}/kernel-owner-bindings`,
        exportRows: `${surfaceGroup}/${surfaceName}/export-rows`,
        ownerRows: `${surfaceGroup}/${surfaceName}/export-rows/owners`,
        timelineRows: `${surfaceGroup}/${surfaceName}/export-rows/timeline`,
        lifecycleCommandRows: `${surfaceGroup}/${surfaceName}/export-rows/lifecycle-commands`,
        privilegedJobAuthorization: `${surfaceGroup}/${surfaceName}/privileged-job-authorization`,
        privilegedJobRows: `${surfaceGroup}/${surfaceName}/export-rows/privileged-jobs`,
        authorizationDecisionRows: `${surfaceGroup}/${surfaceName}/export-rows/authorization-decisions`,
        kernelOwnerBindingRows: `${surfaceGroup}/${surfaceName}/export-rows/kernel-owner-bindings`,
        ownerTransferReport: `${surfaceGroup}/${surfaceName}/owner-transfer-report`,
        lifecycleControls: `${surfaceGroup}/${surfaceName}/lifecycle-controls`,
        lifecycleSettingsControls: `${surfaceGroup}/${surfaceName}/lifecycle-settings-controls`,
        lifecycleQueueControls: `${surfaceGroup}/${surfaceName}/lifecycle-queue-controls`,
        ownerTransferHandoff: `${surfaceGroup}/${surfaceName}/owner-transfer-handoff`,
        providerContracts: `${surfaceGroup}/${surfaceName}/provider-contracts`,
        mailchimpProviderReporting: `${surfaceGroup}/${surfaceName}/mailchimp-provider-reporting`,
        mailchimpProviderRows: `${surfaceGroup}/${surfaceName}/export-rows/mailchimp-providers`,
        mailchimpLifecycleHandoff: mailchimpLifecycleHandoffControl.routePayload.route,
        mailchimpLifecycleHandoffRows: mailchimpLifecycleHandoffControl.exportContract.route,
        externalHandoff: `${surfaceGroup}/${surfaceName}/external-handoff`,
        workspaceBoundary: `${surfaceGroup}/${surfaceName}/workspace-boundary`,
        workspaceBoundaryEvaluations: `${surfaceGroup}/${surfaceName}/workspace-boundary/evaluations`,
        boundaryAuditHandoff: workspaceScope.auditChannel,
        auditHandoff: workspaceScope.auditChannel,
        previewAcceptance: `${surfaceGroup}/${surfaceName}/preview-acceptance`,
        previewClientContract: `${surfaceGroup}/${surfaceName}/preview-client-contract`,
        clientRuntimeHandoff: `${surfaceGroup}/${surfaceName}/client-runtime-handoff`,
        acceptance: `${surfaceGroup}/${surfaceName}/acceptance`,
        acceptanceDecision: `${surfaceGroup}/${surfaceName}/acceptance-decision`,
        readiness: `${surfaceGroup}/${surfaceName}/readiness`,
        validationSummary: `${surfaceGroup}/${surfaceName}/validation-summary`,
        operationalHealth: `${surfaceGroup}/${surfaceName}/operational-health`,
        persistedRuntimeState: `${surfaceGroup}/${surfaceName}/persisted-runtime-state`,
        durableStateProjection: `${surfaceGroup}/${surfaceName}/durable-state-projection`,
        recoveredKernelState: `${surfaceGroup}/${surfaceName}/recovered-kernel-state`,
        restartRecovery: `${surfaceGroup}/${surfaceName}/restart-recovery`,
        actionableErrors: `${surfaceGroup}/${surfaceName}/actionable-errors`,
        retryPlan: `${surfaceGroup}/${surfaceName}/retry-plan`,
        degradedMode: `${surfaceGroup}/${surfaceName}/degraded-mode`,
        providerFailoverPlan: `${surfaceGroup}/${surfaceName}/provider-failover-plan`,
        executionGuards: `${surfaceGroup}/${surfaceName}/execution-guards`,
        nextSteps: `${surfaceGroup}/${surfaceName}/next-steps`,
        nextAction: `${surfaceGroup}/${surfaceName}/next-action`
      },
      route: `${surfaceGroup}/${surfaceName}/analytics-export`
    },
    evidence
  };
}

export default describeOwnerIdentitySurface;
