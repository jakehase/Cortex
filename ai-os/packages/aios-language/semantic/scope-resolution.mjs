const DECLARATION_KINDS = new Set(["capability", "memory", "step", "verifier", "truthBoundary", "rollback"]);
const MAILCHIMP_ACTION_PATTERN = /^(campaign|audience|template|report)\./;
const WRITE_ACTION_PATTERN = /create|update|schedule|send|delete|archive/i;
const ROLE_PERMISSION_GRANTS = Object.freeze({
  "mailchimp.admin": Object.freeze(["mailchimp.*"]),
  "mailchimp.marketer": Object.freeze([
    "mailchimp.campaigns.read",
    "mailchimp.campaigns.write",
    "mailchimp.templates.read",
    "mailchimp.lists.read",
    "mailchimp.segments.read",
    "mailchimp.reports.read",
  ]),
  "mailchimp.viewer": Object.freeze([
    "mailchimp.campaigns.read",
    "mailchimp.templates.read",
    "mailchimp.lists.read",
    "mailchimp.segments.read",
    "mailchimp.reports.read",
  ]),
  "mailchimp.sender": Object.freeze(["mailchimp.campaigns.approve_send"]),
});

function compactString(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableSortByName(left, right) {
  return left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind);
}

function freezeArray(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

function createDiagnostic(code, message, context = {}, level = "error") {
  return Object.freeze({
    level,
    code,
    message,
    ...context,
  });
}

function getJobs(input = {}) {
  if (Array.isArray(input.jobs)) return input.jobs;
  if (Array.isArray(input.ast?.jobs)) return input.ast.jobs;
  return [];
}

function firstString(...values) {
  for (const value of values) {
    const text = compactString(value);
    if (text) return text;
  }
  return "";
}

function stableToken(prefix, parts) {
  const body = parts.map(compactString).filter(Boolean).join(":");
  return `${prefix}:${body || "anonymous"}`;
}

function stableFingerprint(values = []) {
  return toArray(values)
    .map(compactString)
    .filter(Boolean)
    .sort()
    .join("|");
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function millisecondsBetween(later, earlier) {
  const laterMs = Date.parse(compactString(later));
  const earlierMs = Date.parse(compactString(earlier));
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs) || laterMs < earlierMs) return 0;
  return laterMs - earlierMs;
}

function normalizeCommandName(value, fallback) {
  return compactString(value || fallback).replace(/[^a-z0-9_.:-]+/gi, "_").toLowerCase();
}

function normalizePermission(value) {
  return compactString(value).toLowerCase();
}

function inferCapabilityProvider(capability = {}) {
  const action = compactString(capability.name || capability.scope);
  const provider = compactString(capability.provider).toLowerCase();
  return provider || (MAILCHIMP_ACTION_PATTERN.test(action) ? "mailchimp" : "local");
}

function requiredMailchimpPermission(action) {
  if (action.startsWith("campaign.") && /schedule|send/.test(action)) return "mailchimp.campaigns.approve_send";
  if (action.startsWith("campaign.") && WRITE_ACTION_PATTERN.test(action)) return "mailchimp.campaigns.write";
  if (action.startsWith("campaign.")) return "mailchimp.campaigns.read";
  if (action.startsWith("audience.segment.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.segments.write" : "mailchimp.segments.read";
  if (action.startsWith("audience.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.lists.write" : "mailchimp.lists.read";
  if (action.startsWith("template.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.templates.write" : "mailchimp.templates.read";
  if (action.startsWith("report.")) return "mailchimp.reports.read";
  return "";
}

function normalizePermissionLease(value = {}, fallback = {}) {
  const action = firstString(value.action, value.capability, value.scope, fallback.action);
  const permission = normalizePermission(firstString(value.permission, value.requiredPermission, fallback.requiredPermission));
  const tenantId = firstString(value.tenantId, fallback.tenantId);
  const workspaceId = firstString(value.workspaceId, fallback.workspaceId);
  const actorId = firstString(value.actorId, value.userId, fallback.actorId);
  const token = firstString(value.token, value.leaseToken, value.id, stableToken("lease", [
    tenantId,
    workspaceId,
    actorId,
    action,
    permission,
  ]));
  const status = compactString(value.status || value.state || "active").toLowerCase();

  return Object.freeze({
    token,
    action,
    permission,
    tenantId,
    workspaceId,
    actorId,
    status,
    issuedAt: firstString(value.issuedAt, value.createdAt),
    expiresAt: firstString(value.expiresAt, value.validUntil, value.expiry),
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    source: compactString(value.source || fallback.source || "runtime"),
    retryAfterMs: positiveInteger(value.retryAfterMs ?? value.retryAfter, 0),
    refreshCommand: normalizeCommandName(value.refreshCommand || value.nextCommand || fallback.refreshCommand || "refresh_mailchimp_permission_lease"),
  });
}

function collectPermissionLeaseInputs(job = {}, requestState = {}, capability = {}, action = "", requiredPermission = "", actor = {}) {
  return [
    ...toArray(requestState.permissionLeases),
    ...toArray(job.permissionLeases || job.leases),
    ...toArray(job.clientState?.permissionLeases || job.requestState?.permissionLeases),
    ...toArray(capability.permissionLeases || capability.leases),
    capability.permissionLease,
    capability.lease,
  ]
    .filter(Boolean)
    .map((lease) => normalizePermissionLease(lease, {
      action,
      requiredPermission,
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      actorId: actor.actorId,
      statusChannel: requestState.statusChannel,
      source: "capability-boundary",
    }));
}

function selectPermissionLease(leases = [], action = "", requiredPermission = "", actor = {}, observedAt = "") {
  const matching = toArray(leases).filter((lease) => {
    const actionMatches = !lease.action || lease.action === action;
    const permissionMatches = !lease.permission || lease.permission === requiredPermission;
    const tenantMatches = !lease.tenantId || lease.tenantId === actor.tenantId;
    const workspaceMatches = !lease.workspaceId || lease.workspaceId === actor.workspaceId;
    const actorMatches = !lease.actorId || lease.actorId === actor.actorId;
    return actionMatches && permissionMatches && tenantMatches && workspaceMatches && actorMatches;
  });
  const lease = matching[0] || null;
  const expired = Boolean(lease?.expiresAt && observedAt && lease.expiresAt <= observedAt);
  const invalid = lease && lease.status && !["active", "granted", "ready"].includes(lease.status);

  return Object.freeze({
    lease,
    missing: matching.length === 0,
    expired,
    invalid,
    missingExpiry: Boolean(lease && !lease.expiresAt),
    mismatched: matching.length === 0 && toArray(leases).length > 0,
  });
}

function createPermissionLeaseRecovery(action, requiredPermission, leaseDecision = {}, runtimeScope = {}) {
  const lease = leaseDecision.lease || null;
  const blockedReasons = [
    leaseDecision.missing && "missing",
    leaseDecision.mismatched && "scope-mismatch",
    leaseDecision.invalid && "inactive",
    leaseDecision.expired && "expired",
    leaseDecision.missingExpiry && "missing-expiry",
  ].filter(Boolean);
  const ready = blockedReasons.length === 0 && Boolean(lease);
  const retryAfterMs = lease?.retryAfterMs
    || (leaseDecision.expired ? 0 : leaseDecision.invalid ? 30000 : leaseDecision.missing ? 1000 : 5000);
  const command = ready
    ? "observe"
    : lease?.refreshCommand || "refresh_mailchimp_permission_lease";

  return Object.freeze({
    protocol: "aios.scope.permission-lease-recovery.v1",
    action,
    requiredPermission,
    state: ready ? "ready" : "blocked",
    ready,
    reasons: freezeArray(blockedReasons),
    nextCommand: command,
    retryAfterMs: ready ? 0 : retryAfterMs,
    backoff: Object.freeze({
      strategy: ready ? "none" : leaseDecision.expired ? "immediate-refresh" : "bounded-refresh",
      baseDelayMs: ready ? 0 : retryAfterMs,
      maxDelayMs: ready ? 0 : Math.max(retryAfterMs, 60000),
      jitter: !ready && !leaseDecision.expired,
    }),
    handoff: Object.freeze({
      statusChannel: compactString(lease?.statusChannel || runtimeScope.statusChannel),
      leaseToken: compactString(lease?.token),
      expiresAt: compactString(lease?.expiresAt),
      refreshCommand: command,
    }),
  });
}

function expandRolePermissions(roles = []) {
  return roles.flatMap((role) => ROLE_PERMISSION_GRANTS[role] || []);
}

function hasMailchimpRuntimeBoundary(job = {}) {
  return toArray(job.capabilities).some((capability) => {
    const name = compactString(capability.name || capability.scope);
    const provider = compactString(capability.provider);
    const boundary = compactString(capability.boundary);
    return provider === "mailchimp" || MAILCHIMP_ACTION_PATTERN.test(name) || boundary === "external";
  });
}

function collectActorBoundaryState(job = {}, requestState = {}) {
  const clientState = job.clientState || job.requestState || {};
  const actor = job.actor || {};
  const roles = [
    ...toArray(requestState.roles),
    ...toArray(clientState.roles),
    ...toArray(job.roles),
    ...toArray(actor.roles),
  ].map(normalizePermission).filter(Boolean).sort();
  const permissions = [
    ...toArray(requestState.permissions),
    ...toArray(clientState.permissions),
    ...toArray(job.permissions),
    ...toArray(actor.permissions),
    ...expandRolePermissions(roles),
  ].map(normalizePermission).filter(Boolean).sort();

  return Object.freeze({
    tenantId: firstString(clientState.tenantId, job.tenantId, requestState.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId),
    actorId: firstString(clientState.userId, clientState.actorId, actor.id, job.userId, requestState.userId),
    roles: freezeArray([...new Set(roles)]),
    permissions: freezeArray([...new Set(permissions)]),
  });
}

function createPermissionBoundaryMatrix(job = {}, requestState = normalizeRequestState(), runtimeScope = {}) {
  const actor = collectActorBoundaryState(job, requestState);
  const available = new Set(actor.permissions);
  const observedAt = compactString(requestState.observedAt);
  const capabilities = toArray(job.capabilities)
    .map((capability, index) => {
      const action = compactString(capability.name || capability.scope || `capability:${index + 1}`);
      const provider = inferCapabilityProvider(capability);
      const capabilityTenant = firstString(capability.tenantId, actor.tenantId);
      const capabilityWorkspace = firstString(capability.workspaceId, actor.workspaceId);
      const requiredPermission = provider === "mailchimp"
        ? normalizePermission(capability.permission || capability.requiredPermission || requiredMailchimpPermission(action))
        : "";
      const explicitGrants = toArray(capability.grants || capability.permissions).map(normalizePermission).filter(Boolean);
      const grantSet = new Set([...available, ...explicitGrants]);
      const sameTenant = provider !== "mailchimp" || (Boolean(actor.tenantId) && capabilityTenant === actor.tenantId);
      const sameWorkspace = provider !== "mailchimp" || (Boolean(actor.workspaceId) && capabilityWorkspace === actor.workspaceId);
      const permissionGranted = !requiredPermission
        || grantSet.has(requiredPermission)
        || grantSet.has("mailchimp.*")
        || grantSet.has("admin")
        || grantSet.has("role:admin");
      const writeBoundary = provider === "mailchimp" && WRITE_ACTION_PATTERN.test(action);
      const leaseRequired = provider === "mailchimp"
        && (writeBoundary || capability.requiresLease === true || capability.leaseRequired === true)
        && capability.requiresLease !== false
        && capability.leaseRequired !== false;
      const leaseInputs = collectPermissionLeaseInputs(job, requestState, capability, action, requiredPermission, actor);
      const leaseDecision = selectPermissionLease(leaseInputs, action, requiredPermission, actor, observedAt);
      const leaseRecovery = leaseRequired
        ? createPermissionLeaseRecovery(action, requiredPermission, leaseDecision, runtimeScope)
        : null;
      const reasons = [
        provider === "mailchimp" && !actor.tenantId && "missing-tenant",
        provider === "mailchimp" && !actor.workspaceId && "missing-workspace",
        provider === "mailchimp" && !actor.actorId && "missing-actor",
        !sameTenant && "tenant-mismatch",
        !sameWorkspace && "workspace-mismatch",
        requiredPermission && !permissionGranted && `missing-permission:${requiredPermission}`,
        leaseRequired && leaseDecision.missing && "missing-permission-lease",
        leaseRequired && leaseDecision.mismatched && "permission-lease-scope-mismatch",
        leaseRequired && leaseDecision.invalid && "permission-lease-inactive",
        leaseRequired && leaseDecision.expired && "permission-lease-expired",
        leaseRequired && leaseDecision.missingExpiry && "missing-permission-lease-expiry",
        writeBoundary && !runtimeScope.idempotencyKey && "missing-idempotency-key",
        writeBoundary && !runtimeScope.statusChannel && "missing-status-channel",
      ].filter(Boolean);

      return Object.freeze({
        action,
        provider,
        boundary: compactString(capability.boundary || (provider === "mailchimp" ? "external" : "internal")),
        tenantId: capabilityTenant,
        workspaceId: capabilityWorkspace,
        actorId: actor.actorId,
        requiredPermission,
        explicitGrants: freezeArray(explicitGrants),
        writeBoundary,
        leaseRequired,
        permissionLease: leaseDecision.lease ? Object.freeze({
          token: leaseDecision.lease.token,
          action: leaseDecision.lease.action,
          permission: leaseDecision.lease.permission,
          tenantId: leaseDecision.lease.tenantId,
          workspaceId: leaseDecision.lease.workspaceId,
          actorId: leaseDecision.lease.actorId,
          status: leaseDecision.lease.status,
          expiresAt: leaseDecision.lease.expiresAt,
          statusChannel: leaseDecision.lease.statusChannel,
          source: leaseDecision.lease.source,
          retryAfterMs: leaseDecision.lease.retryAfterMs,
          refreshCommand: leaseDecision.lease.refreshCommand,
        }) : null,
        leaseRecovery,
        statusChannel: runtimeScope.statusChannel,
        idempotencyKey: runtimeScope.idempotencyKey,
        decision: reasons.length === 0 ? "allow" : "hold",
        reasons: freezeArray(reasons),
      });
    })
    .filter((entry) => entry.provider === "mailchimp")
    .sort((left, right) => left.action.localeCompare(right.action));
  const held = capabilities.filter((capability) => capability.decision === "hold");

  return Object.freeze({
    protocol: "aios.scope.mailchimp-permission-boundary.v1",
    tenantId: actor.tenantId,
    workspaceId: actor.workspaceId,
    actorId: actor.actorId,
    roles: actor.roles,
    permissions: actor.permissions,
    status: held.length > 0 ? "held" : capabilities.length > 0 ? "allow" : "not-applicable",
    capabilities: freezeArray(capabilities),
    heldCapabilities: freezeArray(held.map((capability) => ({
      action: capability.action,
      requiredPermission: capability.requiredPermission,
      permissionLease: capability.permissionLease,
      leaseRecovery: capability.leaseRecovery,
      reasons: capability.reasons,
    }))),
    auditHandoff: Object.freeze({
      event: "mailchimp.scope.permission_boundary",
      statusChannel: runtimeScope.statusChannel,
      restartToken: runtimeScope.restartToken,
      acceptedForAdapter: held.length === 0,
      heldActions: freezeArray(held.map((capability) => capability.action)),
    }),
  });
}

function createTenantPermissionPosture(job = {}, permissionBoundary = {}, runtimeScope = {}, requestState = normalizeRequestState()) {
  const jobName = compactString(job.name || "anonymous");
  const capabilities = toArray(permissionBoundary.capabilities);
  const held = toArray(permissionBoundary.heldCapabilities);
  const permissionRows = capabilities.map((capability) => {
    const reasons = toArray(capability.reasons).map(compactString).filter(Boolean);
    const missingPermissions = reasons
      .filter((reason) => reason.startsWith("missing-permission:"))
      .map((reason) => reason.replace(/^missing-permission:/, ""))
      .filter(Boolean);
    const identityMissing = reasons.filter((reason) => ["missing-tenant", "missing-workspace", "missing-actor"].includes(reason));
    const workspaceMismatch = reasons.filter((reason) => reason === "tenant-mismatch" || reason === "workspace-mismatch");
    const leaseReasons = reasons.filter((reason) => reason.includes("permission-lease"));
    const handoffMissing = reasons.filter((reason) => reason === "missing-idempotency-key" || reason === "missing-status-channel");
    const state = identityMissing.length > 0 || workspaceMismatch.length > 0
      ? "identity-blocked"
      : missingPermissions.length > 0
        ? "grant-blocked"
      : leaseReasons.length > 0
        ? "lease-blocked"
        : handoffMissing.length > 0
          ? "handoff-blocked"
          : capability.decision === "allow"
            ? "covered"
            : "blocked";

    return Object.freeze({
      rowId: stableToken("tenant-permission-posture", [jobName, capability.action]),
      jobName,
      action: compactString(capability.action),
      provider: compactString(capability.provider || "mailchimp"),
      state,
      decision: compactString(capability.decision || "unknown"),
      tenantId: compactString(capability.tenantId || permissionBoundary.tenantId),
      workspaceId: compactString(capability.workspaceId || permissionBoundary.workspaceId),
      actorId: compactString(capability.actorId || permissionBoundary.actorId),
      requiredPermission: compactString(capability.requiredPermission),
      grantedByRole: toArray(permissionBoundary.roles).some((role) => ROLE_PERMISSION_GRANTS[role]?.includes(capability.requiredPermission)
        || ROLE_PERMISSION_GRANTS[role]?.includes("mailchimp.*")),
      explicitGrant: toArray(capability.explicitGrants).includes(capability.requiredPermission)
        || toArray(permissionBoundary.permissions).includes(capability.requiredPermission)
        || toArray(permissionBoundary.permissions).includes("mailchimp.*"),
      leaseRequired: capability.leaseRequired === true,
      leaseState: compactString(capability.leaseRecovery?.state || (capability.leaseRequired ? "blocked" : "not-required")),
      leaseToken: compactString(capability.permissionLease?.token),
      leaseExpiresAt: compactString(capability.permissionLease?.expiresAt),
      missingPermissions: freezeArray(missingPermissions),
      identityMissing: freezeArray(identityMissing),
      workspaceMismatch: freezeArray(workspaceMismatch),
      leaseReasons: freezeArray(leaseReasons),
      handoffMissing: freezeArray(handoffMissing),
      nextCommand: state === "covered"
        ? "observe"
        : identityMissing.length > 0 || workspaceMismatch.length > 0
          ? "attach_client_runtime_request"
        : missingPermissions.length > 0
          ? "grant_mailchimp_permission"
        : leaseReasons.length > 0
          ? capability.leaseRecovery?.nextCommand || "refresh_mailchimp_permission_lease"
        : handoffMissing.length > 0
          ? "attach_recovery_status_handoff"
        : "resolve_boundary_hold",
    });
  }).sort((left, right) => left.state.localeCompare(right.state) || left.action.localeCompare(right.action));
  const blocked = permissionRows.filter((row) => row.state !== "covered");
  const covered = permissionRows.filter((row) => row.state === "covered");
  const leaseBlocked = permissionRows.filter((row) => row.state === "lease-blocked");
  const grantBlocked = permissionRows.filter((row) => row.state === "grant-blocked");
  const identityBlocked = permissionRows.filter((row) => row.state === "identity-blocked");
  const handoffBlocked = permissionRows.filter((row) => row.state === "handoff-blocked");
  const tenantFingerprint = stableFingerprint([
    permissionBoundary.tenantId,
    permissionBoundary.workspaceId,
    permissionBoundary.actorId,
    ...permissionRows.map((row) => `${row.action}:${row.state}:${row.requiredPermission}:${row.leaseState}`),
  ]);

  return Object.freeze({
    protocol: "aios.scope.tenant-permission-posture.v1",
    jobName,
    state: blocked.length > 0 ? "blocked" : permissionRows.length > 0 ? "covered" : "not-applicable",
    acceptedForAdapter: blocked.length === 0,
    tenantId: compactString(permissionBoundary.tenantId || runtimeScope.tenantId),
    workspaceId: compactString(permissionBoundary.workspaceId || runtimeScope.workspaceId),
    actorId: compactString(permissionBoundary.actorId || requestState.userId),
    fingerprint: tenantFingerprint,
    roles: permissionBoundary.roles || freezeArray([]),
    permissions: permissionBoundary.permissions || freezeArray([]),
    rows: freezeArray(permissionRows),
    coveredRows: freezeArray(covered),
    blockedRows: freezeArray(blocked),
    counters: Object.freeze({
      rows: permissionRows.length,
      covered: covered.length,
      blocked: blocked.length,
      heldCapabilities: held.length,
      identityBlocked: identityBlocked.length,
      grantBlocked: grantBlocked.length,
      leaseBlocked: leaseBlocked.length,
      handoffBlocked: handoffBlocked.length,
      uniqueRequiredPermissions: new Set(permissionRows.map((row) => row.requiredPermission).filter(Boolean)).size,
      expiringLeaseRows: permissionRows.filter((row) => row.leaseRequired && row.leaseExpiresAt && requestState.observedAt && row.leaseExpiresAt <= requestState.observedAt).length,
    }),
    auditHandoff: Object.freeze({
      event: "mailchimp.scope.tenant_permission_posture",
      fingerprint: tenantFingerprint,
      acceptedForAdapter: blocked.length === 0,
      statusChannel: compactString(runtimeScope.statusChannel),
      observedAt: compactString(requestState.observedAt),
      blockedActions: freezeArray(blocked.map((row) => row.action)),
    }),
    nextStep: Object.freeze({
      command: identityBlocked[0]?.nextCommand
        || grantBlocked[0]?.nextCommand
        || leaseBlocked[0]?.nextCommand
        || handoffBlocked[0]?.nextCommand
        || "observe",
      reason: identityBlocked.length > 0
        ? "Tenant, workspace, and actor identity must match Mailchimp capability boundaries."
        : grantBlocked.length > 0
          ? "Mailchimp permission grants do not cover all required capability actions."
        : leaseBlocked.length > 0
          ? "Mailchimp permission leases must be active and scoped to the tenant workspace."
        : handoffBlocked.length > 0
          ? "Permission posture is covered, but runtime status handoff metadata is incomplete."
        : permissionRows.length > 0
          ? "Mailchimp tenant permission posture is covered for adapter handoff."
          : "No Mailchimp tenant permission posture is required.",
    }),
  });
}

function normalizeWorkspaceBoundaryIntent(value = {}, fallback = {}) {
  const action = firstString(value.action, value.capability, value.scope, fallback.action);
  const sourceTenantId = firstString(value.sourceTenantId, value.fromTenantId, value.tenantId, fallback.tenantId);
  const sourceWorkspaceId = firstString(value.sourceWorkspaceId, value.fromWorkspaceId, value.workspaceId, fallback.workspaceId);
  const targetTenantId = firstString(value.targetTenantId, value.toTenantId, value.tenantId, fallback.tenantId);
  const targetWorkspaceId = firstString(value.targetWorkspaceId, value.toWorkspaceId, value.workspaceId, fallback.workspaceId);
  const mode = compactString(value.mode || value.boundaryMode || fallback.mode || "same-workspace").toLowerCase();
  const approval = value.approval || value.workspaceApproval || {};
  const approvalState = compactString(approval.state || value.approvalState || (approval.accepted === true ? "accepted" : "missing")).toLowerCase();
  const approvalToken = firstString(
    approval.token,
    approval.approvalToken,
    value.approvalToken,
    mode !== "same-workspace" ? stableToken("workspace-approval", [sourceTenantId, sourceWorkspaceId, targetTenantId, targetWorkspaceId, action]) : ""
  );
  const transferToken = firstString(
    value.transferToken,
    value.boundaryToken,
    value.token,
    stableToken("workspace-boundary", [sourceTenantId, sourceWorkspaceId, targetTenantId, targetWorkspaceId, action, mode])
  );

  return Object.freeze({
    action,
    mode,
    sourceTenantId,
    sourceWorkspaceId,
    targetTenantId,
    targetWorkspaceId,
    transferToken,
    approvalState,
    approvalToken,
    approvedBy: firstString(approval.approvedBy, value.approvedBy),
    approvedAt: firstString(approval.approvedAt, value.approvedAt),
    reason: compactString(value.reason || fallback.reason),
  });
}

function normalizeProviderBudgetInput(value = {}, fallback = {}) {
  const provider = compactString(value.provider || fallback.provider || "mailchimp").toLowerCase();
  const action = firstString(value.action, value.capability, value.scope, fallback.action);
  const limit = positiveInteger(value.limit ?? value.capacity ?? fallback.limit, 0);
  const remainingRaw = Number(value.remaining ?? value.available ?? fallback.remaining);
  const remaining = Number.isFinite(remainingRaw) && remainingRaw >= 0 ? Math.floor(remainingRaw) : null;
  const resetAt = firstString(value.resetAt, value.resetsAt, value.windowResetAt, fallback.resetAt);
  const retryAfterMs = positiveInteger(value.retryAfterMs ?? value.retryAfter ?? fallback.retryAfterMs, 0);
  const safetyFloor = positiveInteger(value.safetyFloor ?? value.minRemaining ?? fallback.safetyFloor, 1);

  return Object.freeze({
    provider,
    action,
    budgetId: firstString(value.budgetId, value.id, stableToken("provider-budget", [
      provider,
      fallback.tenantId,
      fallback.workspaceId,
      action || "global",
    ])),
    limit,
    remaining,
    resetAt,
    retryAfterMs,
    safetyFloor,
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    source: compactString(value.source || fallback.source || "runtime"),
  });
}

function collectProviderBudgetInputs(job = {}, requestState = normalizeRequestState()) {
  const clientState = job.clientState || job.requestState || {};
  const fallback = {
    provider: "mailchimp",
    tenantId: firstString(clientState.tenantId, job.tenantId, requestState.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, requestState.statusChannel),
  };
  return [
    ...toArray(requestState.providerBudgets),
    ...toArray(clientState.providerBudgets || clientState.rateLimits || clientState.mailchimpBudgets),
    ...toArray(job.providerBudgets || job.rateLimits || job.mailchimpBudgets),
    job.providerBudget,
    job.rateLimit,
  ]
    .filter(Boolean)
    .map((budget) => normalizeProviderBudgetInput(budget, fallback));
}

function createProviderBudgetContract(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, permissionBoundary = {}) {
  const jobName = compactString(job.name || "anonymous");
  const budgets = collectProviderBudgetInputs(job, requestState);
  const observedAt = compactString(requestState.observedAt);
  const rows = toArray(permissionBoundary.capabilities).map((capability) => {
    const action = compactString(capability.action);
    const matching = budgets.find((budget) => {
      return budget.provider === capability.provider && (!budget.action || budget.action === action);
    }) || null;
    const externalWrite = capability.writeBoundary === true;
    const remaining = matching?.remaining;
    const exhausted = remaining != null && remaining <= 0;
    const belowSafetyFloor = remaining != null && remaining > 0 && remaining <= matching.safetyFloor;
    const resetKnown = Boolean(matching?.resetAt || matching?.retryAfterMs);
    const resetPending = Boolean(matching?.resetAt && observedAt && matching.resetAt > observedAt);
    const retryAfterMs = matching?.retryAfterMs || (exhausted || resetPending ? 60000 : belowSafetyFloor ? 15000 : 0);
    const blockedBy = [
      exhausted && "provider-budget-exhausted",
      (exhausted || resetPending) && !resetKnown && "missing-budget-reset",
      belowSafetyFloor && "provider-budget-below-safety-floor",
      externalWrite && !runtimeScope.statusChannel && "missing-status-channel",
    ].filter(Boolean);
    const state = exhausted
      ? "blocked"
      : belowSafetyFloor || resetPending
        ? "degraded"
        : matching
          ? "ready"
          : "unmetered";

    return Object.freeze({
      rowId: stableToken("provider-budget-row", [jobName, capability.provider, action]),
      action,
      provider: capability.provider,
      state,
      budgetId: compactString(matching?.budgetId),
      limit: matching?.limit ?? 0,
      remaining: remaining ?? null,
      safetyFloor: matching?.safetyFloor ?? 1,
      resetAt: compactString(matching?.resetAt),
      retryAfterMs,
      statusChannel: firstString(matching?.statusChannel, runtimeScope.statusChannel),
      source: compactString(matching?.source || "not-provided"),
      blockedBy: freezeArray(blockedBy),
      nextCommand: state === "blocked"
        ? exhausted
          ? "wait_for_provider_budget_reset"
          : "attach_provider_budget_state"
        : state === "degraded"
          ? "throttle_provider_handoff"
          : "observe",
    });
  }).sort((left, right) => left.action.localeCompare(right.action) || left.rowId.localeCompare(right.rowId));
  const blocked = rows.filter((row) => row.state === "blocked");
  const degraded = rows.filter((row) => row.state === "degraded");

  return Object.freeze({
    protocol: "aios.scope.provider-budget.v1",
    jobName,
    provider: rows.some((row) => row.provider === "mailchimp") ? "mailchimp" : "local",
    state: blocked.length > 0
      ? "blocked"
      : degraded.length > 0
        ? "degraded"
        : rows.length > 0
          ? "ready"
          : "not-required",
    acceptedForPreview: true,
    acceptedForAdapter: blocked.length === 0,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    degradedRows: freezeArray(degraded),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      degraded: degraded.length,
      exhausted: rows.filter((row) => row.blockedBy.includes("provider-budget-exhausted")).length,
      unmetered: rows.filter((row) => row.state === "unmetered").length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || degraded[0]?.nextCommand || "observe",
      retryAfterMs: blocked[0]?.retryAfterMs || degraded[0]?.retryAfterMs || 0,
      reason: blocked.length > 0
        ? "Mailchimp provider budget state blocks adapter handoff until reset or budget state is attached."
        : degraded.length > 0
          ? "Mailchimp provider budget is below safety floor; handoff should be throttled."
          : "Provider budget allows adapter handoff.",
    }),
  });
}

function normalizeMailchimpSettings(value = {}) {
  const settings = value.settings || value.mailchimpSettings || value.lifecycleSettings || value.providerSettings || {};
  const campaign = value.campaign || value.campaignSettings || {};
  const audience = value.audience || value.audienceSettings || {};
  const schedule = value.schedule || value.scheduling || {};

  return Object.freeze({
    enabled: value.enabled !== false && value.disabled !== true && compactString(value.mode || value.lifecycleMode) !== "disabled",
    listId: firstString(settings.listId, settings.audienceId, audience.listId, value.listId, value.audienceId),
    templateId: firstString(settings.templateId, campaign.templateId, value.templateId),
    subjectLine: firstString(settings.subjectLine, settings.subject, campaign.subjectLine, campaign.subject, value.subjectLine),
    fromName: firstString(settings.fromName, campaign.fromName, value.fromName),
    replyTo: firstString(settings.replyTo, settings.replyToEmail, campaign.replyTo, value.replyTo),
    segmentId: firstString(settings.segmentId, audience.segmentId, value.segmentId),
    scheduleAt: firstString(schedule.at, value.scheduleAt, settings.scheduleAt),
    scheduleWindow: firstString(schedule.window, value.scheduleWindow, settings.scheduleWindow),
    timezone: firstString(schedule.timezone, value.timezone, settings.timezone, "UTC"),
    archiveOnDisable: value.archiveOnDisable === true || settings.archiveOnDisable === true,
    preserveProviderDraft: value.preserveProviderDraft !== false && settings.preserveProviderDraft !== false,
  });
}

function collectMailchimpSettingsInputs(job = {}, requestState = normalizeRequestState()) {
  const clientState = job.clientState || job.requestState || {};
  const rows = [
    ...toArray(requestState.capabilitySettings),
    ...toArray(requestState.mailchimpSettings),
    ...toArray(clientState.capabilitySettings || clientState.mailchimpSettings),
    ...toArray(job.capabilitySettings || job.mailchimpSettings),
  ].filter(Boolean);

  return rows.map((row) => Object.freeze({
    action: firstString(row.action, row.capability, row.scope),
    current: normalizeMailchimpSettings(row.current || row.currentSettings || row.provider || {}),
    desired: normalizeMailchimpSettings(row.desired || row.desiredSettings || row.settings || row),
    source: compactString(row.source || "client-runtime"),
    revision: firstString(row.revision, row.settingsRevision, row.etag),
  }));
}

function normalizeMarketingConsentInput(value = {}, fallback = {}) {
  const action = firstString(value.action, value.capability, value.scope, fallback.action);
  const status = compactString(value.status || value.state || (value.granted === true ? "granted" : "")).toLowerCase();
  const source = compactString(value.source || fallback.source || "client-runtime");
  const granted = value.granted === true || ["granted", "subscribed", "accepted", "ready"].includes(status);
  const revoked = value.revoked === true || ["revoked", "unsubscribed", "rejected", "denied"].includes(status);
  const consentId = firstString(value.consentId, value.id, value.token, stableToken("marketing-consent", [
    fallback.tenantId,
    fallback.workspaceId,
    action || "global",
    firstString(value.audienceId, value.listId, fallback.audienceId),
    firstString(value.segmentId, fallback.segmentId),
  ]));

  return Object.freeze({
    action,
    consentId,
    tenantId: firstString(value.tenantId, fallback.tenantId),
    workspaceId: firstString(value.workspaceId, fallback.workspaceId),
    audienceId: firstString(value.audienceId, value.listId, fallback.audienceId),
    segmentId: firstString(value.segmentId, fallback.segmentId),
    source,
    state: revoked ? "revoked" : granted ? "granted" : status || "missing",
    granted,
    grantedBy: firstString(value.grantedBy, value.acceptedBy, value.actorId, fallback.actorId),
    grantedAt: firstString(value.grantedAt, value.acceptedAt, value.createdAt),
    expiresAt: firstString(value.expiresAt, value.validUntil),
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    refreshCommand: normalizeCommandName(value.refreshCommand || value.nextCommand || fallback.refreshCommand || "collect_marketing_consent"),
  });
}

function collectMarketingConsentInputs(job = {}, requestState = normalizeRequestState()) {
  const clientState = job.clientState || job.requestState || {};
  const actor = job.actor || {};
  const fallback = {
    tenantId: firstString(clientState.tenantId, job.tenantId, requestState.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId),
    actorId: firstString(clientState.userId, clientState.actorId, actor.id, job.userId, requestState.userId),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, requestState.statusChannel),
    source: "client-runtime",
  };
  return [
    ...toArray(requestState.marketingConsents),
    ...toArray(requestState.mailchimpConsents),
    ...toArray(clientState.marketingConsents || clientState.mailchimpConsents || clientState.consentReceipts),
    ...toArray(job.marketingConsents || job.mailchimpConsents || job.consentReceipts),
    job.marketingConsent,
    job.mailchimpConsent,
  ]
    .filter(Boolean)
    .map((consent) => normalizeMarketingConsentInput(consent, fallback));
}

function normalizeLifecycleCommandReceipt(value = {}, fallback = {}) {
  const action = firstString(value.action, value.capability, value.scope, fallback.action);
  const command = normalizeCommandName(value.command || value.name || fallback.command || "mailchimp_lifecycle_override");
  const mode = compactString(value.mode || value.lifecycleMode || fallback.mode || "").toLowerCase();
  const stateText = compactString(value.state || value.status || (value.accepted === true ? "accepted" : "")).toLowerCase();
  const state = ["accepted", "rejected", "expired", "revoked", "pending"].includes(stateText)
    ? stateText
    : value.rejected === true || value.revoked === true
      ? "rejected"
      : value.accepted === true || value.acceptedAt || value.approvedAt
        ? "accepted"
        : "pending";
  const tenantId = firstString(value.tenantId, fallback.tenantId);
  const workspaceId = firstString(value.workspaceId, fallback.workspaceId);
  const actorId = firstString(value.actorId, value.userId, value.acceptedBy, fallback.actorId);
  const requestId = firstString(value.requestId, fallback.requestId);
  const receiptToken = firstString(value.receiptToken, value.token, value.id, stableToken("lifecycle-receipt", [
    tenantId,
    workspaceId,
    requestId,
    action || "global",
    command,
    mode,
  ]));

  return Object.freeze({
    receiptToken,
    action,
    command,
    mode,
    state,
    tenantId,
    workspaceId,
    actorId,
    requestId,
    acceptedBy: firstString(value.acceptedBy, value.approvedBy, actorId),
    acceptedAt: firstString(value.acceptedAt, value.approvedAt, value.createdAt),
    expiresAt: firstString(value.expiresAt, value.validUntil),
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    source: compactString(value.source || fallback.source || "client-runtime"),
    reason: compactString(value.reason || value.message),
    nextCommand: normalizeCommandName(value.nextCommand || fallback.nextCommand || command),
  });
}

function collectLifecycleCommandReceipts(job = {}, requestState = normalizeRequestState()) {
  const clientState = job.clientState || job.requestState || {};
  const actor = job.actor || {};
  const fallback = {
    tenantId: firstString(clientState.tenantId, job.tenantId, requestState.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId),
    actorId: firstString(clientState.userId, clientState.actorId, actor.id, job.userId, requestState.userId),
    requestId: firstString(clientState.requestId, job.requestId, requestState.requestId),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, requestState.statusChannel),
  };

  return [
    ...toArray(requestState.lifecycleCommandReceipts),
    ...toArray(requestState.mailchimpLifecycleReceipts),
    ...toArray(clientState.lifecycleCommandReceipts || clientState.mailchimpLifecycleReceipts || clientState.lifecycleReceipts),
    ...toArray(job.lifecycleCommandReceipts || job.mailchimpLifecycleReceipts || job.lifecycleReceipts),
    job.lifecycleCommandReceipt,
    job.mailchimpLifecycleReceipt,
  ]
    .filter(Boolean)
    .map((receipt) => normalizeLifecycleCommandReceipt(receipt, fallback));
}

function createMailchimpSettingsAdoptionContract(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, permissionBoundary = {}) {
  const jobName = compactString(job.name || "anonymous");
  const inputs = collectMailchimpSettingsInputs(job, requestState);
  const capabilities = toArray(permissionBoundary.capabilities);
  const rows = capabilities.map((capability) => {
    const action = compactString(capability.action);
    const declared = toArray(job.capabilities).find((item) => compactString(item.name || item.scope) === action) || {};
    const input = inputs.find((item) => !item.action || item.action === action) || null;
    const desired = input?.desired || normalizeMailchimpSettings(declared);
    const current = input?.current || normalizeMailchimpSettings({});
    const externalWrite = capability.writeBoundary === true;
    const scheduleRequested = action.includes("schedule") || Boolean(desired.scheduleAt || desired.scheduleWindow);
    const missing = [
      action.startsWith("campaign.") && !desired.listId && "listId",
      action.startsWith("campaign.") && externalWrite && !desired.templateId && "templateId",
      action.startsWith("campaign.") && externalWrite && !desired.subjectLine && "subjectLine",
      action.startsWith("campaign.") && externalWrite && !desired.fromName && "fromName",
      action.startsWith("campaign.") && externalWrite && !desired.replyTo && "replyTo",
      action.startsWith("audience.segment.") && !desired.segmentId && "segmentId",
      scheduleRequested && !desired.scheduleAt && !desired.scheduleWindow && "scheduleWindow",
      scheduleRequested && !desired.timezone && "timezone",
      externalWrite && !runtimeScope.statusChannel && "statusChannel",
    ].filter(Boolean);
    const changed = [
      desired.enabled !== current.enabled && "enabled",
      desired.listId && desired.listId !== current.listId && "listId",
      desired.templateId && desired.templateId !== current.templateId && "templateId",
      desired.subjectLine && desired.subjectLine !== current.subjectLine && "subjectLine",
      desired.fromName && desired.fromName !== current.fromName && "fromName",
      desired.replyTo && desired.replyTo !== current.replyTo && "replyTo",
      desired.segmentId && desired.segmentId !== current.segmentId && "segmentId",
      desired.scheduleAt && desired.scheduleAt !== current.scheduleAt && "scheduleAt",
      desired.scheduleWindow && desired.scheduleWindow !== current.scheduleWindow && "scheduleWindow",
      desired.timezone && desired.timezone !== current.timezone && "timezone",
    ].filter(Boolean);
    const state = missing.length > 0
      ? "blocked"
      : desired.enabled === false
        ? "disabled"
        : changed.length > 0
          ? "patch-required"
          : "adopted";

    return Object.freeze({
      rowId: stableToken("settings-adoption-row", [jobName, action]),
      action,
      provider: capability.provider,
      state,
      acceptedForPreview: true,
      acceptedForAdapter: state === "adopted" || state === "patch-required",
      source: input?.source || "capability-declaration",
      revision: input?.revision || "",
      desired,
      current,
      changedFields: freezeArray(changed),
      missing: freezeArray(missing),
      nextCommand: state === "blocked"
        ? "repair_mailchimp_settings"
        : state === "disabled"
          ? desired.archiveOnDisable ? "archive_provider_draft" : "observe"
          : changed.length > 0
            ? "apply_mailchimp_settings_patch"
            : "observe",
      statusChannel: runtimeScope.statusChannel,
    });
  }).sort((left, right) => left.action.localeCompare(right.action));
  const blocked = rows.filter((row) => row.state === "blocked");
  const patchRequired = rows.filter((row) => row.state === "patch-required");
  const disabled = rows.filter((row) => row.state === "disabled");

  return Object.freeze({
    protocol: "aios.scope.mailchimp-settings-adoption.v1",
    jobName,
    state: blocked.length > 0
      ? "blocked"
      : patchRequired.length > 0
        ? "patch-required"
        : disabled.length > 0
          ? "disabled"
          : rows.length > 0
            ? "adopted"
            : "not-required",
    acceptedForPreview: true,
    acceptedForAdapter: blocked.length === 0 && disabled.length === 0,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    patchRows: freezeArray(patchRequired),
    disabledRows: freezeArray(disabled),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      patchRequired: patchRequired.length,
      disabled: disabled.length,
      adopted: rows.filter((row) => row.state === "adopted").length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || patchRequired[0]?.nextCommand || disabled[0]?.nextCommand || "observe",
      reason: blocked.length > 0
        ? "Mailchimp campaign settings are missing required fields before adapter handoff."
        : patchRequired.length > 0
          ? "Mailchimp provider settings need a deterministic patch before handoff."
          : disabled.length > 0
            ? "Mailchimp capability is disabled by settings and should not be handed off."
            : "Mailchimp settings are adopted for runtime handoff.",
    }),
  });
}

function collectWorkspaceBoundaryInputs(job = {}, requestState = normalizeRequestState()) {
  const clientState = job.clientState || job.requestState || {};
  const fallback = {
    tenantId: firstString(clientState.tenantId, job.tenantId, requestState.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId),
  };
  return [
    ...toArray(requestState.workspaceBoundaries),
    ...toArray(requestState.workspaceTransfers),
    ...toArray(clientState.workspaceBoundaries || clientState.workspaceTransfers),
    ...toArray(job.workspaceBoundaries || job.workspaceTransfers || job.tenantBoundaries),
  ]
    .filter(Boolean)
    .map((boundary) => normalizeWorkspaceBoundaryIntent(boundary, fallback));
}

function createWorkspaceBoundaryContract(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, permissionBoundary = {}) {
  const jobName = compactString(job.name || "anonymous");
  const clientState = job.clientState || job.requestState || {};
  const tenantId = firstString(clientState.tenantId, job.tenantId, requestState.tenantId, runtimeScope.tenantId);
  const workspaceId = firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId, runtimeScope.workspaceId);
  const capabilityRows = toArray(permissionBoundary.capabilities);
  const intents = collectWorkspaceBoundaryInputs(job, requestState);
  const rows = capabilityRows.map((capability) => {
    const action = compactString(capability.action);
    const explicit = intents.find((intent) => !intent.action || intent.action === action) || null;
    const targetTenantId = firstString(explicit?.targetTenantId, capability.tenantId, tenantId);
    const targetWorkspaceId = firstString(explicit?.targetWorkspaceId, capability.workspaceId, workspaceId);
    const sourceTenantId = firstString(explicit?.sourceTenantId, tenantId);
    const sourceWorkspaceId = firstString(explicit?.sourceWorkspaceId, workspaceId);
    const crossTenant = Boolean(sourceTenantId && targetTenantId && sourceTenantId !== targetTenantId);
    const crossWorkspace = Boolean(sourceWorkspaceId && targetWorkspaceId && sourceWorkspaceId !== targetWorkspaceId);
    const transferRequested = crossTenant || crossWorkspace || explicit?.mode === "transfer" || explicit?.mode === "cross-workspace";
    const approvalAccepted = explicit?.approvalState === "accepted" || (Boolean(explicit?.approvedBy) && Boolean(explicit?.approvedAt));
    const missing = [
      !sourceTenantId && "sourceTenantId",
      !sourceWorkspaceId && "sourceWorkspaceId",
      !targetTenantId && "targetTenantId",
      !targetWorkspaceId && "targetWorkspaceId",
      transferRequested && !approvalAccepted && "workspaceApproval",
      transferRequested && !runtimeScope.statusChannel && "statusChannel",
    ].filter(Boolean);
    const blockedBy = [
      crossTenant && "cross-tenant",
      crossWorkspace && "cross-workspace",
      ...missing.map((item) => `missing:${item}`),
    ].filter(Boolean);
    const state = missing.length > 0
      ? "quarantined"
      : transferRequested
        ? "approved-transfer"
        : "same-workspace";

    return Object.freeze({
      rowId: stableToken("workspace-boundary-row", [jobName, action, sourceTenantId, sourceWorkspaceId, targetTenantId, targetWorkspaceId]),
      action,
      provider: compactString(capability.provider || "mailchimp"),
      state,
      transferRequested,
      tenantId: targetTenantId,
      workspaceId: targetWorkspaceId,
      sourceTenantId,
      sourceWorkspaceId,
      targetTenantId,
      targetWorkspaceId,
      transferToken: compactString(explicit?.transferToken || stableToken("workspace-boundary", [sourceTenantId, sourceWorkspaceId, targetTenantId, targetWorkspaceId, action])),
      approval: Object.freeze({
        state: transferRequested ? explicit?.approvalState || (approvalAccepted ? "accepted" : "missing") : "not-required",
        token: compactString(explicit?.approvalToken),
        approvedBy: compactString(explicit?.approvedBy),
        approvedAt: compactString(explicit?.approvedAt),
      }),
      blockedBy: freezeArray(blockedBy),
      nextCommand: missing.length > 0
        ? transferRequested && !approvalAccepted
          ? "collect_workspace_boundary_approval"
          : "attach_client_runtime_request"
        : transferRequested
          ? "record_workspace_boundary_audit"
          : "observe",
    });
  }).sort((left, right) => left.action.localeCompare(right.action) || left.rowId.localeCompare(right.rowId));
  const quarantined = rows.filter((row) => row.state === "quarantined");
  const transfers = rows.filter((row) => row.transferRequested);

  return Object.freeze({
    protocol: "aios.scope.workspace-boundary-contract.v1",
    jobName,
    tenantId,
    workspaceId,
    state: quarantined.length > 0
      ? "quarantined"
      : transfers.length > 0
        ? "transfer-audit-required"
        : rows.length > 0
          ? "same-workspace"
          : "not-applicable",
    acceptedForAdapter: quarantined.length === 0,
    acceptedForAudit: quarantined.length === 0 && rows.length > 0,
    rows: freezeArray(rows),
    quarantinedRows: freezeArray(quarantined),
    transferRows: freezeArray(transfers),
    counters: Object.freeze({
      rows: rows.length,
      transfers: transfers.length,
      quarantined: quarantined.length,
      sameWorkspace: rows.filter((row) => row.state === "same-workspace").length,
      approvedTransfers: rows.filter((row) => row.state === "approved-transfer").length,
    }),
    auditHandoff: Object.freeze({
      event: "mailchimp.scope.workspace_boundary",
      statusChannel: runtimeScope.statusChannel,
      restartToken: runtimeScope.restartToken,
      acceptedForAdapter: quarantined.length === 0,
      transferTokens: freezeArray(transfers.map((row) => row.transferToken).filter(Boolean)),
      quarantinedActions: freezeArray(quarantined.map((row) => row.action)),
    }),
    nextStep: Object.freeze({
      command: quarantined[0]?.nextCommand || transfers[0]?.nextCommand || "observe",
      reason: quarantined.length > 0
        ? "Workspace boundary transfer must be approved and audited before Mailchimp adapter handoff."
        : transfers.length > 0
          ? "Workspace transfer is approved and should be recorded in the audit handoff."
          : "Mailchimp capabilities remain inside the active tenant workspace.",
    }),
  });
}

function createMailchimpLifecycleGateContract(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, permissionBoundary = {}, settingsAdoption = {}, providerBudget = {}, providerMaintenance = {}) {
  const jobName = compactString(job.name || "anonymous");
  const controls = job.lifecycleControls || job.mailchimpLifecycle || job.providerLifecycle || {};
  const clientState = job.clientState || job.requestState || {};
  const disabledActions = new Set(toArray(controls.disabledActions || controls.disable || clientState.disabledActions).map(compactString).filter(Boolean));
  const enabledActions = new Set(toArray(controls.enabledActions || controls.enable || clientState.enabledActions).map(compactString).filter(Boolean));
  const sendLock = controls.sendLock || controls.approvalLock || clientState.sendLock || {};
  const scheduling = controls.scheduling || controls.scheduleControls || clientState.scheduling || {};
  const consentPolicy = controls.consent || controls.marketingConsent || clientState.consentPolicy || {};
  const marketingConsents = collectMarketingConsentInputs(job, requestState);
  const lifecycleReceipts = collectLifecycleCommandReceipts(job, requestState);
  const now = compactString(requestState.observedAt);
  const quietUntil = firstString(scheduling.quietUntil, controls.quietUntil, clientState.quietUntil);
  const quietActive = Boolean(quietUntil && (!now || quietUntil > now));
  const globalMode = compactString(controls.mode || controls.state || (controls.enabled === false ? "disabled" : "enabled")).toLowerCase();
  const rows = toArray(permissionBoundary.capabilities).map((capability) => {
    const action = compactString(capability.action);
    const declared = toArray(job.capabilities).find((item) => compactString(item.name || item.scope) === action) || {};
    const settingsRow = toArray(settingsAdoption.rows).find((row) => compactString(row.action) === action) || null;
    const budgetRow = toArray(providerBudget.rows).find((row) => compactString(row.action) === action) || null;
    const maintenanceRow = toArray(providerMaintenance.rows).find((row) => compactString(row.action) === action) || null;
    const actionMode = compactString(declared.lifecycleMode || declared.mode || (disabledActions.has(action) ? "disabled" : enabledActions.has(action) ? "enabled" : globalMode)).toLowerCase();
    const schedule = declared.schedule || declared.scheduling || {};
    const requestedScheduleAt = firstString(schedule.at, declared.scheduleAt, settingsRow?.desired?.scheduleAt, scheduling.at, scheduling.scheduleAt);
    const requestedScheduleWindow = firstString(schedule.window, declared.scheduleWindow, settingsRow?.desired?.scheduleWindow, scheduling.window, scheduling.scheduleWindow);
    const scheduleRequested = action.includes("schedule") || Boolean(requestedScheduleAt || requestedScheduleWindow);
    const audienceId = firstString(declared.audienceId, declared.listId, settingsRow?.desired?.listId);
    const segmentId = firstString(declared.segmentId, settingsRow?.desired?.segmentId);
    const consentRequired = capability.writeBoundary === true
      && (/campaign\.(send|schedule|create|update)/.test(action) || declared.requiresMarketingConsent === true || consentPolicy.required === true)
      && declared.requiresMarketingConsent !== false
      && consentPolicy.required !== false;
    const consent = marketingConsents.find((row) => {
      const actionMatches = !row.action || row.action === action;
      const tenantMatches = !row.tenantId || row.tenantId === runtimeScope.tenantId;
      const workspaceMatches = !row.workspaceId || row.workspaceId === runtimeScope.workspaceId;
      const audienceMatches = !row.audienceId || !audienceId || row.audienceId === audienceId;
      const segmentMatches = !row.segmentId || !segmentId || row.segmentId === segmentId;
      return actionMatches && tenantMatches && workspaceMatches && audienceMatches && segmentMatches;
    }) || null;
    const consentExpired = Boolean(consent?.expiresAt && now && consent.expiresAt <= now);
    const consentMissing = consentRequired && !consent;
    const consentNotGranted = consentRequired && Boolean(consent) && (!consent.granted || consent.state !== "granted");
    const sendLocked = Boolean(sendLock.locked || sendLock.enabled === false || sendLock.state === "locked")
      && (/send|schedule/.test(action) || declared.requiresSendLock !== false);
    const overrideCommand = actionMode === "disabled" || disabledActions.has(action)
      ? "enable_mailchimp_lifecycle_control"
      : sendLocked
        ? "release_mailchimp_send_lock"
        : quietActive || scheduleRequested
          ? "approve_mailchimp_schedule_override"
          : settingsRow?.state === "patch-required"
            ? "apply_mailchimp_settings_patch"
            : "";
    const overrideRequired = Boolean(overrideCommand)
      && declared.lifecycleReceiptRequired !== false
      && controls.requireCommandReceipt !== false
      && (actionMode === "disabled"
        || disabledActions.has(action)
        || sendLocked
        || quietActive
        || settingsRow?.state === "patch-required"
        || declared.requireLifecycleReceipt === true
        || controls.requireCommandReceipt === true);
    const overrideReceipt = lifecycleReceipts.find((receipt) => {
      const actionMatches = !receipt.action || receipt.action === action;
      const commandMatches = !receipt.command || receipt.command === overrideCommand;
      const tenantMatches = !receipt.tenantId || receipt.tenantId === runtimeScope.tenantId;
      const workspaceMatches = !receipt.workspaceId || receipt.workspaceId === runtimeScope.workspaceId;
      return actionMatches && commandMatches && tenantMatches && workspaceMatches;
    }) || null;
    const overrideReceiptExpired = Boolean(overrideReceipt?.expiresAt && now && overrideReceipt.expiresAt <= now);
    const overrideReceiptAccepted = overrideReceipt?.state === "accepted" && !overrideReceiptExpired;
    const overrideReceiptRejected = ["rejected", "revoked"].includes(compactString(overrideReceipt?.state));
    const missing = [
      actionMode === "disabled" && "enablement",
      consentMissing && "marketingConsent",
      consentNotGranted && "marketingConsentGrant",
      consentRequired && consentExpired && "marketingConsentExpiry",
      scheduleRequested && !requestedScheduleAt && !requestedScheduleWindow && "scheduleWindow",
      scheduleRequested && !firstString(schedule.timezone, declared.timezone, settingsRow?.desired?.timezone, scheduling.timezone) && "timezone",
      sendLocked && !firstString(sendLock.releaseToken, sendLock.token, declared.sendReleaseToken) && "sendReleaseToken",
      quietActive && !firstString(scheduling.overrideToken, declared.scheduleOverrideToken) && "scheduleOverrideToken",
      overrideRequired && !overrideReceipt && "lifecycleCommandReceipt",
      overrideRequired && overrideReceiptRejected && "lifecycleCommandRejected",
      overrideRequired && overrideReceiptExpired && "lifecycleCommandExpired",
      overrideRequired && overrideReceipt && !overrideReceiptAccepted && !overrideReceiptRejected && !overrideReceiptExpired && "lifecycleCommandPending",
      settingsRow?.state === "blocked" && "mailchimpSettings",
      budgetRow?.state === "blocked" && "providerBudget",
      maintenanceRow?.state === "blocked" && "providerMaintenance",
    ].filter(Boolean);
    const state = missing.length > 0
      ? actionMode === "disabled" || disabledActions.has(action) ? "disabled" : "blocked"
      : scheduleRequested || sendLocked || settingsRow?.state === "patch-required" ? "gated" : "open";
    const nextCommand = state === "disabled"
      ? "enable_mailchimp_lifecycle_control"
      : missing.includes("sendReleaseToken")
        ? "release_mailchimp_send_lock"
        : missing.includes("marketingConsent") || missing.includes("marketingConsentGrant")
          ? consent?.refreshCommand || "collect_marketing_consent"
        : missing.includes("marketingConsentExpiry")
          ? consent?.refreshCommand || "refresh_marketing_consent"
        : missing.includes("lifecycleCommandReceipt") || missing.includes("lifecycleCommandPending")
          ? overrideCommand || "attach_mailchimp_lifecycle_command_receipt"
        : missing.includes("lifecycleCommandRejected")
          ? "revise_mailchimp_lifecycle_command"
        : missing.includes("lifecycleCommandExpired")
          ? "refresh_mailchimp_lifecycle_command_receipt"
        : missing.includes("scheduleOverrideToken") || missing.includes("scheduleWindow") || missing.includes("timezone")
          ? "repair_mailchimp_schedule_controls"
          : missing.includes("mailchimpSettings")
            ? settingsRow?.nextCommand || "repair_mailchimp_settings"
            : missing.includes("providerBudget")
              ? budgetRow?.nextCommand || "wait_for_provider_budget_reset"
              : missing.includes("providerMaintenance")
                ? maintenanceRow?.nextCommand || "wait_for_provider_maintenance_window"
                : settingsRow?.state === "patch-required"
                  ? settingsRow.nextCommand || "apply_mailchimp_settings_patch"
                  : scheduleRequested
                    ? "queue_provider_schedule"
                    : "observe";

    return Object.freeze({
      rowId: stableToken("lifecycle-gate-row", [jobName, action]),
      action,
      provider: capability.provider,
      state,
      mode: actionMode === "disabled" ? "disabled" : "enabled",
      acceptedForPreview: true,
      acceptedForAdapter: state === "open" || state === "gated",
      sendLock: Object.freeze({
        locked: sendLocked,
        token: firstString(sendLock.releaseToken, sendLock.token, declared.sendReleaseToken),
        reason: compactString(sendLock.reason || declared.sendLockReason),
      }),
      scheduling: Object.freeze({
        requested: scheduleRequested,
        at: requestedScheduleAt,
        window: requestedScheduleWindow,
        timezone: firstString(schedule.timezone, declared.timezone, settingsRow?.desired?.timezone, scheduling.timezone, "UTC"),
        quietUntil,
        quietActive,
      }),
      overrideReceipt: Object.freeze({
        required: overrideRequired,
        command: overrideCommand,
        state: overrideRequired ? compactString(overrideReceipt?.state || "missing") : "not-required",
        receiptToken: compactString(overrideReceipt?.receiptToken),
        acceptedBy: compactString(overrideReceipt?.acceptedBy),
        acceptedAt: compactString(overrideReceipt?.acceptedAt),
        expiresAt: compactString(overrideReceipt?.expiresAt),
        expired: overrideReceiptExpired,
        statusChannel: compactString(overrideReceipt?.statusChannel || runtimeScope.statusChannel),
        source: compactString(overrideReceipt?.source || "not-provided"),
        nextCommand: overrideRequired
          ? overrideReceiptRejected
            ? "revise_mailchimp_lifecycle_command"
            : overrideReceiptExpired
              ? "refresh_mailchimp_lifecycle_command_receipt"
              : overrideReceiptAccepted
                ? "observe"
                : overrideCommand || "attach_mailchimp_lifecycle_command_receipt"
          : "observe",
      }),
      marketingConsent: Object.freeze({
        required: consentRequired,
        state: consentRequired ? compactString(consent?.state || "missing") : "not-required",
        consentId: compactString(consent?.consentId),
        audienceId,
        segmentId,
        source: compactString(consent?.source || "not-provided"),
        grantedAt: compactString(consent?.grantedAt),
        expiresAt: compactString(consent?.expiresAt),
        expired: consentExpired,
        statusChannel: compactString(consent?.statusChannel || runtimeScope.statusChannel),
        nextCommand: consentRequired
          ? consentMissing || consentNotGranted
            ? consent?.refreshCommand || "collect_marketing_consent"
            : consentExpired
              ? consent?.refreshCommand || "refresh_marketing_consent"
              : "observe"
          : "observe",
      }),
      linkedState: Object.freeze({
        settings: compactString(settingsRow?.state || "not-required"),
        providerBudget: compactString(budgetRow?.state || "not-required"),
        providerMaintenance: compactString(maintenanceRow?.state || "not-required"),
      }),
      missing: freezeArray(missing),
      nextCommand,
      statusChannel: runtimeScope.statusChannel,
    });
  }).sort((left, right) => left.action.localeCompare(right.action) || left.rowId.localeCompare(right.rowId));
  const blocked = rows.filter((row) => row.state === "blocked" || row.state === "disabled");
  const gated = rows.filter((row) => row.state === "gated");

  return Object.freeze({
    protocol: "aios.scope.mailchimp-lifecycle-gates.v1",
    jobName,
    state: blocked.length > 0 ? "blocked" : gated.length > 0 ? "gated" : rows.length > 0 ? "open" : "not-required",
    acceptedForPreview: true,
    acceptedForAdapter: blocked.length === 0,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    gatedRows: freezeArray(gated),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.filter((row) => row.state === "blocked").length,
      disabled: blocked.filter((row) => row.state === "disabled").length,
      gated: gated.length,
      scheduled: rows.filter((row) => row.scheduling.requested).length,
      sendLocked: rows.filter((row) => row.sendLock.locked).length,
      overrideReceiptsRequired: rows.filter((row) => row.overrideReceipt.required).length,
      overrideReceiptsMissing: rows.filter((row) => row.overrideReceipt.required && ["missing", "pending"].includes(row.overrideReceipt.state)).length,
      overrideReceiptsRejected: rows.filter((row) => row.overrideReceipt.required && ["rejected", "revoked"].includes(row.overrideReceipt.state)).length,
      overrideReceiptsExpired: rows.filter((row) => row.overrideReceipt.expired).length,
      consentRequired: rows.filter((row) => row.marketingConsent.required).length,
      consentBlocked: rows.filter((row) => row.marketingConsent.required && row.marketingConsent.state !== "granted").length,
      consentExpired: rows.filter((row) => row.marketingConsent.expired).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || gated[0]?.nextCommand || "observe",
      reason: blocked.length > 0
        ? "Mailchimp lifecycle controls block adapter handoff until enablement, send lock, or schedule state is repaired."
        : gated.length > 0
          ? "Mailchimp lifecycle controls require an explicit schedule or settings command before handoff."
          : "Mailchimp lifecycle controls allow provider handoff.",
    }),
  });
}

function hasExternalWriteBoundary(job = {}) {
  return toArray(job.capabilities).some((capability) => {
    const name = compactString(capability.name || capability.scope);
    const boundary = compactString(capability.boundary);
    return boundary === "external" || WRITE_ACTION_PATTERN.test(name);
  });
}

function normalizePreviewAcceptanceReceipt(value = {}, fallback = {}) {
  const jobName = firstString(value.jobName, value.job, fallback.jobName);
  const rowId = firstString(value.rowId, value.previewRowId, value.symbolId, fallback.rowId);
  const name = firstString(value.name, value.symbol, value.capability, value.action, fallback.name);
  const kind = firstString(value.kind, value.symbolKind, fallback.kind);
  const tenantId = firstString(value.tenantId, fallback.tenantId);
  const workspaceId = firstString(value.workspaceId, fallback.workspaceId);
  const actorId = firstString(value.actorId, value.userId, value.acceptedBy, fallback.actorId);
  const requestId = firstString(value.requestId, value.request, fallback.requestId);
  const acceptanceToken = firstString(value.acceptanceToken, value.token, value.previewAcceptanceToken, fallback.acceptanceToken);
  const receiptToken = firstString(value.receiptToken, value.receiptId, stableToken("preview-receipt", [
    tenantId,
    workspaceId,
    requestId,
    jobName,
    rowId || `${kind}:${name}`,
    acceptanceToken,
  ]));
  const explicitState = compactString(value.state || value.status || (value.accepted === true ? "accepted" : "")).toLowerCase();
  const state = ["accepted", "rejected", "revoked", "expired"].includes(explicitState)
    ? explicitState
    : value.rejected === true || value.revoked === true
      ? "rejected"
      : value.accepted === true || value.acceptedAt || value.acceptedBy
        ? "accepted"
        : "pending";

  return Object.freeze({
    receiptToken,
    acceptanceToken,
    rowId,
    jobName,
    kind,
    name,
    state,
    tenantId,
    workspaceId,
    actorId,
    requestId,
    acceptedBy: firstString(value.acceptedBy, value.approvedBy, actorId),
    acceptedAt: firstString(value.acceptedAt, value.approvedAt, value.createdAt),
    expiresAt: firstString(value.expiresAt, value.validUntil),
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    source: compactString(value.source || fallback.source || "client-runtime"),
    reason: compactString(value.reason || value.message),
  });
}

function normalizeRequestState(input = {}) {
  const request = input.request || input.clientRequest || input.runtimeRequest || {};
  const client = input.client || request.client || {};
  const runtime = input.runtime || request.runtime || {};
  const tenantId = firstString(request.tenantId, request.tenant, client.tenantId, input.tenantId, runtime.tenantId);
  const workspaceId = firstString(request.workspaceId, request.workspace, client.workspaceId, input.workspaceId, runtime.workspaceId);
  const userId = firstString(request.userId, request.actorId, client.userId, input.userId);
  const requestId = firstString(request.requestId, request.id, runtime.requestId, input.requestId);
  const observedAt = firstString(request.observedAt, request.now, runtime.observedAt, runtime.now, input.observedAt, input.now);
  const statusChannel = firstString(
    request.statusChannel,
    request.statusTopic,
    runtime.statusChannel,
    tenantId && workspaceId ? `tenant:${tenantId}:workspace:${workspaceId}:aios-status` : ""
  );
  const idempotencyKey = firstString(
    request.idempotencyKey,
    runtime.idempotencyKey,
    requestId && tenantId && workspaceId ? `aios:${tenantId}:${workspaceId}:${requestId}` : ""
  );

  return Object.freeze({
    tenantId,
    workspaceId,
    userId,
    requestId,
    roles: freezeArray(toArray(request.roles || client.roles || input.roles).map(normalizePermission).filter(Boolean).sort()),
    permissions: freezeArray(toArray(request.permissions || client.permissions || input.permissions).map(normalizePermission).filter(Boolean).sort()),
    permissionLeases: freezeArray(toArray(request.permissionLeases || request.leases || client.permissionLeases || input.permissionLeases || input.leases)
      .map((lease) => normalizePermissionLease(lease, { tenantId, workspaceId, actorId: userId, statusChannel }))
      .sort((left, right) => left.action.localeCompare(right.action) || left.permission.localeCompare(right.permission) || left.token.localeCompare(right.token))),
    providerBudgets: freezeArray(toArray(request.providerBudgets || request.rateLimits || client.providerBudgets || client.rateLimits || input.providerBudgets || input.rateLimits)
      .map((budget) => normalizeProviderBudgetInput(budget, { tenantId, workspaceId, statusChannel, provider: "mailchimp" }))
      .sort((left, right) => left.provider.localeCompare(right.provider) || left.action.localeCompare(right.action) || left.budgetId.localeCompare(right.budgetId))),
    providerMaintenanceWindows: freezeArray(toArray(request.providerMaintenanceWindows || request.maintenanceWindows || request.mailchimpMaintenance || client.providerMaintenanceWindows || client.maintenanceWindows || input.providerMaintenanceWindows || input.maintenanceWindows)
      .map((window) => normalizeMaintenanceWindowInput(window, { tenantId, workspaceId, statusChannel, provider: "mailchimp" }))
      .sort((left, right) => left.provider.localeCompare(right.provider) || left.action.localeCompare(right.action) || left.windowId.localeCompare(right.windowId))),
    providerServiceWindows: freezeArray(toArray(request.providerServiceWindows || request.serviceWindows || request.mailchimpServiceWindows || request.providerIncidents || client.providerServiceWindows || client.serviceWindows || client.mailchimpServiceWindows || input.providerServiceWindows || input.serviceWindows || input.mailchimpServiceWindows || input.providerIncidents)
      .map((window) => normalizeProviderServiceWindowInput(window, { tenantId, workspaceId, statusChannel, provider: "mailchimp" }))
      .sort((left, right) => left.provider.localeCompare(right.provider) || left.action.localeCompare(right.action) || left.serviceWindowId.localeCompare(right.serviceWindowId))),
    providerEventSubscriptions: freezeArray(toArray(request.providerEventSubscriptions || request.mailchimpEventSubscriptions || request.webhookSubscriptions || client.providerEventSubscriptions || client.mailchimpEventSubscriptions || client.webhookSubscriptions || input.providerEventSubscriptions || input.mailchimpEventSubscriptions || input.webhookSubscriptions)
      .map((subscription) => normalizeProviderEventSubscription(subscription, { tenantId, workspaceId, statusChannel, provider: "mailchimp" }))
      .sort((left, right) => left.provider.localeCompare(right.provider) || left.action.localeCompare(right.action) || left.subscriptionId.localeCompare(right.subscriptionId))),
    mailchimpEventSubscriptions: freezeArray(toArray(request.mailchimpEventSubscriptions || client.mailchimpEventSubscriptions || input.mailchimpEventSubscriptions)
      .map((subscription) => normalizeProviderEventSubscription(subscription, { tenantId, workspaceId, statusChannel, provider: "mailchimp" }))
      .sort((left, right) => left.action.localeCompare(right.action) || left.subscriptionId.localeCompare(right.subscriptionId))),
    marketingConsents: freezeArray(toArray(request.marketingConsents || request.mailchimpConsents || request.consentReceipts || client.marketingConsents || client.mailchimpConsents || client.consentReceipts || input.marketingConsents || input.mailchimpConsents || input.consentReceipts)
      .map((consent) => normalizeMarketingConsentInput(consent, { tenantId, workspaceId, actorId: userId, statusChannel }))
      .sort((left, right) => left.action.localeCompare(right.action) || left.consentId.localeCompare(right.consentId))),
    mailchimpConsents: freezeArray(toArray(request.mailchimpConsents || client.mailchimpConsents || input.mailchimpConsents)
      .map((consent) => normalizeMarketingConsentInput(consent, { tenantId, workspaceId, actorId: userId, statusChannel }))
      .sort((left, right) => left.action.localeCompare(right.action) || left.consentId.localeCompare(right.consentId))),
    lifecycleCommandReceipts: freezeArray(toArray(request.lifecycleCommandReceipts || request.mailchimpLifecycleReceipts || request.lifecycleReceipts || client.lifecycleCommandReceipts || client.mailchimpLifecycleReceipts || client.lifecycleReceipts || input.lifecycleCommandReceipts || input.mailchimpLifecycleReceipts || input.lifecycleReceipts)
      .map((receipt) => normalizeLifecycleCommandReceipt(receipt, { tenantId, workspaceId, actorId: userId, requestId, statusChannel }))
      .sort((left, right) => left.action.localeCompare(right.action) || left.command.localeCompare(right.command) || left.receiptToken.localeCompare(right.receiptToken))),
    mailchimpLifecycleReceipts: freezeArray(toArray(request.mailchimpLifecycleReceipts || client.mailchimpLifecycleReceipts || input.mailchimpLifecycleReceipts)
      .map((receipt) => normalizeLifecycleCommandReceipt(receipt, { tenantId, workspaceId, actorId: userId, requestId, statusChannel }))
      .sort((left, right) => left.action.localeCompare(right.action) || left.command.localeCompare(right.command) || left.receiptToken.localeCompare(right.receiptToken))),
    segmentSyncReceipts: freezeArray(toArray(request.segmentSyncReceipts || request.mailchimpSegmentSyncReceipts || client.segmentSyncReceipts || client.mailchimpSegmentSyncReceipts || input.segmentSyncReceipts || input.mailchimpSegmentSyncReceipts)
      .map((receipt) => normalizeSegmentSyncReceipt(receipt, { tenantId, workspaceId, statusChannel }))
      .sort((left, right) => left.action.localeCompare(right.action) || left.receiptToken.localeCompare(right.receiptToken))),
    mailchimpSegmentSyncReceipts: freezeArray(toArray(request.mailchimpSegmentSyncReceipts || client.mailchimpSegmentSyncReceipts || input.mailchimpSegmentSyncReceipts)
      .map((receipt) => normalizeSegmentSyncReceipt(receipt, { tenantId, workspaceId, statusChannel }))
      .sort((left, right) => left.action.localeCompare(right.action) || left.receiptToken.localeCompare(right.receiptToken))),
    workspaceBoundaries: freezeArray(toArray(request.workspaceBoundaries || request.workspaceTransfers || client.workspaceBoundaries || client.workspaceTransfers || input.workspaceBoundaries || input.workspaceTransfers)
      .map((boundary) => normalizeWorkspaceBoundaryIntent(boundary, { tenantId, workspaceId }))
      .sort((left, right) => left.action.localeCompare(right.action) || left.transferToken.localeCompare(right.transferToken))),
    workspaceTransfers: freezeArray(toArray(request.workspaceTransfers || client.workspaceTransfers || input.workspaceTransfers)
      .map((boundary) => normalizeWorkspaceBoundaryIntent(boundary, { tenantId, workspaceId, mode: "transfer" }))
      .sort((left, right) => left.action.localeCompare(right.action) || left.transferToken.localeCompare(right.transferToken))),
    analyticsExports: freezeArray(toArray(request.analyticsExports || request.exportDestinations || client.analyticsExports || input.analyticsExports || input.exportDestinations)
      .map((destination) => normalizeExportDestination(destination, { tenantId, workspaceId, statusChannel }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.format.localeCompare(right.format))),
    exportDestinations: freezeArray(toArray(request.exportDestinations || client.exportDestinations || input.exportDestinations)
      .map((destination) => normalizeExportDestination(destination, { tenantId, workspaceId, statusChannel }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.format.localeCompare(right.format))),
    publicationReceipts: freezeArray(toArray(request.publicationReceipts || request.exportReceipts || request.analyticsExportReceipts || client.publicationReceipts || client.exportReceipts || input.publicationReceipts || input.exportReceipts || input.analyticsExportReceipts)),
    exportFreshnessMs: positiveInteger(request.exportFreshnessMs ?? request.analyticsFreshnessMs ?? client.exportFreshnessMs ?? input.exportFreshnessMs, 300000),
    previewAcceptanceReceipts: freezeArray(toArray(
      request.previewAcceptanceReceipts
        || request.previewReceipts
        || request.acceptedPreviewRows
        || client.previewAcceptanceReceipts
        || client.previewReceipts
        || input.previewAcceptanceReceipts
        || input.previewReceipts
        || input.acceptedPreviewRows
    )
      .map((receipt) => normalizePreviewAcceptanceReceipt(receipt, {
        tenantId,
        workspaceId,
        actorId: userId,
        requestId,
        statusChannel,
      }))
      .sort((left, right) => left.jobName.localeCompare(right.jobName)
        || left.rowId.localeCompare(right.rowId)
        || left.receiptToken.localeCompare(right.receiptToken))),
    adapterHandoffReceipts: freezeArray(toArray(
      request.adapterHandoffReceipts
        || request.adapterReceipts
        || request.handoffReceipts
        || client.adapterHandoffReceipts
        || client.adapterReceipts
        || input.adapterHandoffReceipts
        || input.adapterReceipts
        || input.handoffReceipts
    )),
    requireAdapterHandoffReceipt: request.requireAdapterHandoffReceipt === true
      || client.requireAdapterHandoffReceipt === true
      || input.requireAdapterHandoffReceipt === true,
    statusChannel,
    idempotencyKey,
    observedAt,
    origin: compactString(request.origin || client.origin || "client-runtime"),
    restartToken: stableToken("restart", [tenantId, workspaceId, requestId || idempotencyKey]),
  });
}

function normalizeDeclaration(kind, value = {}, index, jobName) {
  const fallbackName = `${kind}:${index + 1}`;
  const name = compactString(value.name || value.id || value.scope || value.expression || fallbackName);
  return {
    kind,
    name,
    jobName,
    index,
    sourceRange: value.start != null || value.end != null
      ? Object.freeze({ start: value.start ?? null, end: value.end ?? null })
      : null,
    value,
  };
}

function collectJobDeclarations(job = {}) {
  const declarations = [
    ...toArray(job.capabilities).map((value, index) => normalizeDeclaration("capability", value, index, job.name)),
    ...toArray(job.memory).map((value, index) => normalizeDeclaration("memory", value, index, job.name)),
    ...toArray(job.steps).map((value, index) => normalizeDeclaration("step", value, index, job.name)),
    ...toArray(job.verifiers).map((value, index) => normalizeDeclaration("verifier", value, index, job.name)),
    ...toArray(job.truthBoundaries).map((value, index) => normalizeDeclaration("truthBoundary", value, index, job.name)),
  ];

  if (job.rollback) declarations.push(normalizeDeclaration("rollback", job.rollback, 0, job.name));
  return declarations;
}

function buildDeclarationIndex(declarations) {
  const byKind = Object.fromEntries([...DECLARATION_KINDS].map((kind) => [kind, new Map()]));
  const diagnostics = [];

  for (const declaration of declarations) {
    const bucket = byKind[declaration.kind];
    const existing = bucket.get(declaration.name);
    if (existing) {
      diagnostics.push(createDiagnostic(
        "aios.scope.duplicate_symbol",
        `Duplicate ${declaration.kind} symbol "${declaration.name}" in job "${declaration.jobName}".`,
        {
          jobName: declaration.jobName,
          kind: declaration.kind,
          symbol: declaration.name,
          firstIndex: existing.index,
          duplicateIndex: declaration.index,
        }
      ));
      continue;
    }
    bucket.set(declaration.name, declaration);
  }

  return { byKind, diagnostics };
}

function resolveMemoryReferences(job = {}, byKind, diagnostics) {
  const memoryNames = byKind.memory;
  const references = [];

  for (const step of toArray(job.steps)) {
    const stepName = compactString(step.name || step.id || "step");
    const reads = toArray(step.memoryReads || step.reads);
    const writes = toArray(step.memoryWrites || step.writes || step.output).filter(Boolean);

    for (const memoryName of reads) {
      const name = compactString(memoryName);
      const resolved = memoryNames.has(name);
      references.push(Object.freeze({ source: stepName, target: name, relation: "reads", resolved }));
      if (!resolved) {
        diagnostics.push(createDiagnostic(
          "aios.scope.unresolved_memory_read",
          `Step "${stepName}" reads undeclared memory "${name}".`,
          { jobName: job.name, stepName, memoryName: name }
        ));
      }
    }

    for (const memoryName of writes) {
      const name = compactString(memoryName);
      const resolved = memoryNames.has(name);
      references.push(Object.freeze({ source: stepName, target: name, relation: "writes", resolved }));
      if (!resolved) {
        diagnostics.push(createDiagnostic(
          "aios.scope.unresolved_memory_write",
          `Step "${stepName}" writes undeclared memory "${name}".`,
          { jobName: job.name, stepName, memoryName: name }
        ));
      }
    }
  }

  return references;
}

function resolveVerifierReferences(job = {}, byKind, diagnostics) {
  const truthNames = byKind.truthBoundary;
  const references = [];

  for (const boundary of toArray(job.truthBoundaries)) {
    const name = compactString(boundary.name || boundary.source);
    const source = compactString(boundary.source);
    references.push(Object.freeze({
      source: name,
      target: source,
      relation: "claims",
      resolved: Boolean(source),
    }));
  }

  for (const verifier of toArray(job.verifiers)) {
    const verifierName = compactString(verifier.name || verifier.expression || "verifier");
    const requiredTruth = toArray(verifier.truth || verifier.truthBoundaries || verifier.boundaries);
    for (const truthName of requiredTruth) {
      const name = compactString(truthName);
      const resolved = truthNames.has(name);
      references.push(Object.freeze({ source: verifierName, target: name, relation: "requiresTruth", resolved }));
      if (!resolved) {
        diagnostics.push(createDiagnostic(
          "aios.scope.unresolved_truth_boundary",
          `Verifier "${verifierName}" references undeclared truth boundary "${name}".`,
          { jobName: job.name, verifierName, truthBoundary: name }
        ));
      }
    }
  }

  return references;
}

function resolveCapabilityReferences(job = {}, byKind, diagnostics) {
  const capabilityNames = byKind.capability;
  const references = [];

  for (const step of toArray(job.steps)) {
    const stepName = compactString(step.name || step.id || "step");
    const requested = toArray(step.capability || step.capabilities || step.requiresCapability);
    for (const capabilityName of requested) {
      const name = compactString(capabilityName);
      const resolved = capabilityNames.has(name);
      references.push(Object.freeze({ source: stepName, target: name, relation: "requiresCapability", resolved }));
      if (!resolved) {
        diagnostics.push(createDiagnostic(
          "aios.scope.unresolved_capability",
          `Step "${stepName}" references undeclared capability "${name}".`,
          { jobName: job.name, stepName, capabilityName: name }
        ));
      }
    }
  }

  return references;
}

function createClientRuntimeScope(job = {}, requestState) {
  const jobName = compactString(job.name || "anonymous");
  const usesMailchimp = hasMailchimpRuntimeBoundary(job);
  const writesExternal = hasExternalWriteBoundary(job);
  const clientState = job.clientState || job.requestState || {};
  const tenantId = firstString(clientState.tenantId, job.tenantId, requestState.tenantId);
  const workspaceId = firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId);
  const requestId = firstString(clientState.requestId, job.requestId, requestState.requestId);
  const statusChannel = firstString(clientState.statusChannel, job.statusChannel, requestState.statusChannel);
  const idempotencyKey = firstString(
    clientState.idempotencyKey,
    job.idempotencyKey,
    requestState.idempotencyKey,
    writesExternal ? stableToken("aios", [tenantId, workspaceId, requestId, jobName]) : ""
  );
  const diagnostics = [];

  if (usesMailchimp && (!tenantId || !workspaceId)) {
    diagnostics.push(createDiagnostic(
      "aios.scope.client_boundary_missing",
      `Job "${jobName}" uses a Mailchimp runtime boundary without tenant and workspace state.`,
      { jobName, missing: freezeArray([!tenantId && "tenantId", !workspaceId && "workspaceId"].filter(Boolean)) }
    ));
  }

  if (writesExternal && !idempotencyKey) {
    diagnostics.push(createDiagnostic(
      "aios.scope.idempotency_key_missing",
      `Job "${jobName}" performs an external write without a deterministic idempotency key.`,
      { jobName }
    ));
  }

  if (usesMailchimp && !statusChannel) {
    diagnostics.push(createDiagnostic(
      "aios.scope.status_channel_missing",
      `Job "${jobName}" uses an adapter boundary without a status handoff channel.`,
      { jobName },
      "warning"
    ));
  }

  return Object.freeze({
    tenantId,
    workspaceId,
    requestId,
    statusChannel,
    idempotencyKey,
    origin: requestState.origin,
    observedAt: requestState.observedAt,
    restartToken: stableToken("restart", [tenantId, workspaceId, requestId || idempotencyKey, jobName]),
    requiresClientState: usesMailchimp,
    requiresIdempotency: writesExternal,
    diagnostics: freezeArray(diagnostics),
  });
}

function normalizeClientCommandReceipt(value = {}, fallback = {}) {
  const command = normalizeCommandName(value.command || value.nextCommand || fallback.command || "observe");
  const commandId = firstString(value.commandId, value.id, fallback.commandId, stableToken("client-command", [
    fallback.restartToken,
    command,
    fallback.capability,
    fallback.stepName,
  ]));
  const status = compactString(value.status || value.state || (value.accepted === true ? "accepted" : "")).toLowerCase();

  return Object.freeze({
    command,
    commandId,
    receiptToken: firstString(value.receiptToken, value.token, stableToken("client-receipt", [
      fallback.tenantId,
      fallback.workspaceId,
      fallback.requestId,
      commandId,
    ])),
    capability: firstString(value.capability, value.action, fallback.capability),
    stepName: firstString(value.stepName, value.step, fallback.stepName),
    tenantId: firstString(value.tenantId, fallback.tenantId),
    workspaceId: firstString(value.workspaceId, fallback.workspaceId),
    requestId: firstString(value.requestId, fallback.requestId),
    actorId: firstString(value.actorId, value.userId, fallback.actorId),
    status: status || "missing",
    acceptedAt: firstString(value.acceptedAt, value.completedAt, value.createdAt),
    expiresAt: firstString(value.expiresAt, value.validUntil),
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    nextCommand: normalizeCommandName(value.nextCommand || fallback.nextCommand || "attach_client_command_receipt"),
    source: compactString(value.source || fallback.source || "client-runtime"),
  });
}

function collectClientCommandReceipts(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, permissionBoundary = {}, recoveryPlan = {}) {
  const clientState = job.clientState || job.requestState || {};
  const explicitReceipts = [
    ...toArray(requestState.clientCommandReceipts || requestState.commandReceipts || requestState.workflowReceipts),
    ...toArray(clientState.clientCommandReceipts || clientState.commandReceipts || clientState.workflowReceipts),
    ...toArray(job.clientCommandReceipts || job.commandReceipts || job.workflowReceipts),
    job.clientCommandReceipt,
  ].filter(Boolean);
  const actorId = firstString(clientState.userId, clientState.actorId, job.actor?.id, job.userId, permissionBoundary.actorId);
  const fallback = {
    tenantId: runtimeScope.tenantId,
    workspaceId: runtimeScope.workspaceId,
    requestId: runtimeScope.requestId,
    actorId,
    statusChannel: runtimeScope.statusChannel,
    restartToken: runtimeScope.restartToken,
    source: "client-runtime",
  };

  return explicitReceipts.map((receipt) => normalizeClientCommandReceipt(receipt, fallback));
}

function createClientCommandReceiptLedger(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, permissionBoundary = {}, recoveryPlan = {}, clientWorkflowHandoff = {}) {
  const jobName = compactString(job.name || "anonymous");
  const receipts = collectClientCommandReceipts(job, requestState, runtimeScope, permissionBoundary, recoveryPlan);
  const receiptByCommandId = new Map(receipts.map((receipt) => [receipt.commandId, receipt]));
  const receiptByCommand = new Map(receipts.map((receipt) => [receipt.command, receipt]));
  const commandRows = [
    ...toArray(clientWorkflowHandoff.commands),
    ...toArray(recoveryPlan.persistedRecoveryLedger?.commands),
  ].filter((command) => {
    const phase = compactString(command.phase);
    const handoff = compactString(command.userVisible?.handoff);
    return command.blocking === true
      || command.state === "ready"
      || phase === "adapter-handoff"
      || handoff === "adapter"
      || compactString(command.capability).startsWith("campaign.")
      || compactString(command.capability).startsWith("audience.")
      || compactString(command.capability).startsWith("template.")
      || compactString(command.capability).startsWith("report.");
  });
  const rows = commandRows.map((command, index) => {
    const commandName = normalizeCommandName(command.command || command.nextCommand || "observe");
    const commandId = firstString(command.commandId, stableToken("client-command", [
      runtimeScope.restartToken,
      commandName,
      command.capability,
      command.stepName,
      index,
    ]));
    const receipt = receiptByCommandId.get(commandId) || receiptByCommand.get(commandName) || null;
    const accepted = ["accepted", "acknowledged", "completed", "ready"].includes(compactString(receipt?.status));
    const expired = Boolean(receipt?.expiresAt && runtimeScope.observedAt && receipt.expiresAt <= runtimeScope.observedAt);
    const mismatched = Boolean(receipt && (
      (receipt.tenantId && runtimeScope.tenantId && receipt.tenantId !== runtimeScope.tenantId)
      || (receipt.workspaceId && runtimeScope.workspaceId && receipt.workspaceId !== runtimeScope.workspaceId)
      || (receipt.requestId && runtimeScope.requestId && receipt.requestId !== runtimeScope.requestId)
    ));
    const required = command.blocking === true
      || command.state === "ready"
      || compactString(command.phase) === "adapter-handoff"
      || compactString(command.userVisible?.handoff) === "adapter";
    const missing = [
      required && !receipt && "receipt",
      receipt && !accepted && "acceptedStatus",
      expired && "expiresAt",
      mismatched && "runtimeIdentity",
      required && !runtimeScope.statusChannel && "statusChannel",
    ].filter(Boolean);
    const state = missing.length > 0
      ? "blocked"
      : receipt
        ? "accepted"
        : "not-required";

    return Object.freeze({
      rowId: stableToken("client-command-receipt", [runtimeScope.restartToken, commandId, commandName]),
      jobName,
      command: commandName,
      commandId,
      phase: compactString(command.phase || "runtime-handoff"),
      capability: compactString(command.capability || command.action),
      stepName: compactString(command.stepName || command.step),
      required,
      state,
      receiptToken: compactString(receipt?.receiptToken),
      receiptStatus: compactString(receipt?.status || "missing"),
      tenantId: compactString(receipt?.tenantId || runtimeScope.tenantId),
      workspaceId: compactString(receipt?.workspaceId || runtimeScope.workspaceId),
      requestId: compactString(receipt?.requestId || runtimeScope.requestId),
      actorId: compactString(receipt?.actorId || permissionBoundary.actorId),
      acceptedAt: compactString(receipt?.acceptedAt),
      expiresAt: compactString(receipt?.expiresAt),
      statusChannel: compactString(receipt?.statusChannel || runtimeScope.statusChannel),
      missing: freezeArray(missing),
      nextCommand: state === "blocked"
        ? receipt && !accepted
          ? "refresh_client_command_receipt"
          : "attach_client_command_receipt"
        : command.nextCommand || command.command || "observe",
    });
  }).sort((left, right) => left.command.localeCompare(right.command) || left.commandId.localeCompare(right.commandId));
  const blocked = rows.filter((row) => row.state === "blocked");
  const accepted = rows.filter((row) => row.state === "accepted");

  return Object.freeze({
    protocol: "aios.scope.client-command-receipts.v1",
    jobName,
    state: blocked.length > 0 ? "blocked" : rows.length > 0 ? "accepted" : "not-required",
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0,
    restartToken: compactString(runtimeScope.restartToken),
    statusChannel: compactString(runtimeScope.statusChannel),
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    acceptedRows: freezeArray(accepted),
    counters: Object.freeze({
      rows: rows.length,
      accepted: accepted.length,
      blocked: blocked.length,
      missing: blocked.filter((row) => row.missing.includes("receipt")).length,
      mismatched: blocked.filter((row) => row.missing.includes("runtimeIdentity")).length,
      expired: blocked.filter((row) => row.missing.includes("expiresAt")).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || "observe",
      reason: blocked.length > 0
        ? "Client command receipts must acknowledge runtime workflow commands before Mailchimp adapter handoff."
        : rows.length > 0
          ? "Client command receipts are accepted for runtime handoff."
          : "No client command receipt is required.",
    }),
  });
}

function normalizeAdapterHandoffReceipt(value = {}, fallback = {}) {
  const action = firstString(value.action, value.capability, fallback.action);
  const command = normalizeCommandName(value.command || value.nextCommand || fallback.command || "queue_adapter_handoff");
  const commandId = firstString(value.commandId, value.id, fallback.commandId, stableToken("adapter-handoff-command", [
    fallback.restartToken,
    action,
    command,
  ]));
  const status = compactString(value.status || value.state || (value.accepted === true ? "accepted" : "")).toLowerCase();

  return Object.freeze({
    action,
    command,
    commandId,
    receiptToken: firstString(value.receiptToken, value.token, stableToken("adapter-handoff-receipt", [
      fallback.tenantId,
      fallback.workspaceId,
      fallback.requestId,
      commandId,
    ])),
    tenantId: firstString(value.tenantId, fallback.tenantId),
    workspaceId: firstString(value.workspaceId, fallback.workspaceId),
    requestId: firstString(value.requestId, fallback.requestId),
    actorId: firstString(value.actorId, value.userId, fallback.actorId),
    status: status || "missing",
    providerRequestId: firstString(value.providerRequestId, value.requestRef),
    statusSnapshotKey: firstString(value.statusSnapshotKey, fallback.statusSnapshotKey),
    acceptedAt: firstString(value.acceptedAt, value.queuedAt, value.completedAt, value.createdAt),
    expiresAt: firstString(value.expiresAt, value.validUntil),
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    source: compactString(value.source || fallback.source || "client-runtime"),
    nextCommand: normalizeCommandName(value.nextCommand || fallback.nextCommand || "attach_adapter_handoff_receipt"),
  });
}

function createAdapterHandoffReceiptLedger(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, permissionBoundary = {}, adapterHandoffManifest = {}) {
  const jobName = compactString(job.name || "anonymous");
  const clientState = job.clientState || job.requestState || {};
  const actorId = firstString(clientState.userId, clientState.actorId, job.actor?.id, job.userId, permissionBoundary.actorId);
  const fallback = {
    tenantId: runtimeScope.tenantId,
    workspaceId: runtimeScope.workspaceId,
    requestId: runtimeScope.requestId,
    actorId,
    statusChannel: runtimeScope.statusChannel,
    restartToken: runtimeScope.restartToken,
    statusSnapshotKey: runtimeScope.statusSnapshotKey,
    source: "client-runtime",
  };
  const receipts = [
    ...toArray(requestState.adapterHandoffReceipts),
    ...toArray(clientState.adapterHandoffReceipts || clientState.adapterReceipts || clientState.handoffReceipts),
    ...toArray(job.adapterHandoffReceipts || job.adapterReceipts || job.handoffReceipts),
    job.adapterHandoffReceipt,
  ].filter(Boolean).map((receipt) => normalizeAdapterHandoffReceipt(receipt, fallback));
  const receiptByCommandId = new Map(receipts.map((receipt) => [receipt.commandId, receipt]));
  const receiptByAction = new Map(receipts.map((receipt) => [receipt.action, receipt]));
  const requireReceipt = requestState.requireAdapterHandoffReceipt === true
    || job.requireAdapterHandoffReceipt === true
    || clientState.requireAdapterHandoffReceipt === true;
  const manifestRows = toArray(adapterHandoffManifest.rows).filter((row) => {
    return row.provider === "mailchimp" && (row.queueable === true || row.state === "queueable" || receiptByAction.has(row.action));
  });
  const rows = manifestRows.map((row) => {
    const receipt = receiptByCommandId.get(compactString(row.commandId)) || receiptByAction.get(compactString(row.action)) || null;
    const accepted = ["accepted", "acknowledged", "queued", "completed", "ready"].includes(compactString(receipt?.status));
    const expired = Boolean(receipt?.expiresAt && runtimeScope.observedAt && receipt.expiresAt <= runtimeScope.observedAt);
    const mismatched = Boolean(receipt && (
      (receipt.tenantId && runtimeScope.tenantId && receipt.tenantId !== runtimeScope.tenantId)
      || (receipt.workspaceId && runtimeScope.workspaceId && receipt.workspaceId !== runtimeScope.workspaceId)
      || (receipt.requestId && runtimeScope.requestId && receipt.requestId !== runtimeScope.requestId)
    ));
    const required = requireReceipt || Boolean(receipt);
    const missing = [
      required && !receipt && "receipt",
      receipt && !accepted && "acceptedStatus",
      expired && "expiresAt",
      mismatched && "runtimeIdentity",
      required && !runtimeScope.statusChannel && "statusChannel",
      required && !runtimeScope.idempotencyKey && "idempotencyKey",
    ].filter(Boolean);
    const state = missing.length > 0
      ? "blocked"
      : receipt
        ? "accepted"
        : row.queueable === true
          ? "queueable"
          : "not-required";

    return Object.freeze({
      rowId: stableToken("adapter-handoff-receipt", [runtimeScope.restartToken, row.action, row.commandId]),
      jobName,
      action: compactString(row.action),
      provider: compactString(row.provider || "mailchimp"),
      command: normalizeCommandName(row.command || "queue_adapter_handoff"),
      commandId: compactString(row.commandId),
      required,
      state,
      receiptToken: compactString(receipt?.receiptToken),
      receiptStatus: compactString(receipt?.status || "missing"),
      providerRequestId: compactString(receipt?.providerRequestId),
      tenantId: compactString(receipt?.tenantId || runtimeScope.tenantId),
      workspaceId: compactString(receipt?.workspaceId || runtimeScope.workspaceId),
      requestId: compactString(receipt?.requestId || runtimeScope.requestId),
      actorId: compactString(receipt?.actorId || actorId),
      acceptedAt: compactString(receipt?.acceptedAt),
      expiresAt: compactString(receipt?.expiresAt),
      statusChannel: compactString(receipt?.statusChannel || runtimeScope.statusChannel),
      statusSnapshotKey: compactString(receipt?.statusSnapshotKey || row.runtime?.statusSnapshotKey || runtimeScope.statusSnapshotKey),
      idempotencyKey: compactString(row.runtime?.idempotencyKey || runtimeScope.idempotencyKey),
      missing: freezeArray(missing),
      nextCommand: state === "blocked"
        ? receipt && !accepted
          ? "refresh_adapter_handoff_receipt"
          : "attach_adapter_handoff_receipt"
        : row.command || "observe",
    });
  }).sort((left, right) => left.action.localeCompare(right.action) || left.commandId.localeCompare(right.commandId));
  const blocked = rows.filter((row) => row.state === "blocked");
  const accepted = rows.filter((row) => row.state === "accepted");
  const queueable = rows.filter((row) => row.state === "queueable");

  return Object.freeze({
    protocol: "aios.scope.adapter-handoff-receipts.v1",
    jobName,
    state: blocked.length > 0 ? "blocked" : accepted.length > 0 ? "accepted" : queueable.length > 0 ? "queueable" : "not-required",
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0,
    required: requireReceipt,
    restartToken: compactString(runtimeScope.restartToken),
    statusChannel: compactString(runtimeScope.statusChannel),
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    acceptedRows: freezeArray(accepted),
    queueableRows: freezeArray(queueable),
    counters: Object.freeze({
      rows: rows.length,
      accepted: accepted.length,
      queueable: queueable.length,
      blocked: blocked.length,
      missing: blocked.filter((row) => row.missing.includes("receipt")).length,
      mismatched: blocked.filter((row) => row.missing.includes("runtimeIdentity")).length,
      expired: blocked.filter((row) => row.missing.includes("expiresAt")).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || queueable[0]?.command || "observe",
      reason: blocked.length > 0
        ? "Adapter handoff receipt must acknowledge queued Mailchimp work with matching runtime identity."
        : accepted.length > 0
          ? "Adapter handoff receipt is accepted for restart-safe Mailchimp status handoff."
          : queueable.length > 0
            ? "Adapter handoff can be queued; no receipt has been required yet."
            : "No adapter handoff receipt is required.",
    }),
  });
}

function createRestartCommandLedger(job = {}, runtimeScope = {}) {
  const jobName = compactString(job.name || "anonymous");
  const restartToken = compactString(runtimeScope.restartToken);
  const statusChannel = compactString(runtimeScope.statusChannel);
  const commands = [];
  const appendCommand = (name, phase, reason, extra = {}) => {
    const command = normalizeCommandName(name, phase);
    commands.push(Object.freeze({
      command,
      commandId: stableToken("cmd", [restartToken, jobName, command]),
      jobName,
      phase,
      reason,
      restartToken,
      statusChannel,
      idempotencyKey: compactString(extra.idempotencyKey || runtimeScope.idempotencyKey),
      replayPolicy: extra.replayPolicy || "dedupe-by-command-id",
      required: extra.required !== false,
    }));
  };

  if (runtimeScope.requiresClientState) {
    appendCommand("restore_client_runtime_state", "restore", "Mailchimp adapter work needs tenant/workspace state before resume.");
  }

  if (runtimeScope.requiresIdempotency) {
    appendCommand("dedupe_external_write", "dedupe", "External writes must replay with the same idempotency identity.");
  }

  for (const step of toArray(job.steps)) {
    const stepName = compactString(step.name || step.id || "step");
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability)
      .map(compactString)
      .filter(Boolean);
    const writesExternal = capabilityRefs.some((capability) => WRITE_ACTION_PATTERN.test(capability));
    if (writesExternal || compactString(step.adapter).includes("mailchimp")) {
      appendCommand(
        step.resumeCommand || `resume_${stepName}`,
        "resume",
        `Resume adapter step "${stepName}" from persisted status before issuing provider calls.`,
        {
          idempotencyKey: firstString(step.idempotencyKey, runtimeScope.idempotencyKey),
          replayPolicy: "resume-before-retry",
        }
      );
    }
  }

  if (toArray(job.verifiers).length > 0) {
    appendCommand("replay_verifier_status", "verify", "Verifier status is replayed so approval evidence remains restart-safe.", {
      replayPolicy: "latest-status-wins",
      required: runtimeScope.requiresIdempotency,
    });
  }

  return freezeArray(commands.sort((left, right) => left.phase.localeCompare(right.phase) || left.command.localeCompare(right.command)));
}

function createRestartReplaySegments(job = {}, runtimeScope = {}, ledger = [], externalSteps = [], memoryMounts = []) {
  const jobName = compactString(job.name || "anonymous");
  const restartToken = compactString(runtimeScope.restartToken);
  const statusChannel = compactString(runtimeScope.statusChannel);
  const commandByStep = new Map();
  for (const command of toArray(ledger)) {
    const normalized = normalizeCommandName(command.command);
    if (command.phase === "resume" && normalized.startsWith("resume_")) {
      commandByStep.set(normalized.replace(/^resume_/, ""), command);
    }
  }

  const durableMemorySegments = memoryMounts.map((memory, index) => {
    const name = compactString(memory.name || `memory:${index + 1}`);
    const key = restartToken ? `${restartToken}:memory:${name}` : "";
    return Object.freeze({
      segmentId: stableToken("segment", [restartToken, jobName, "memory", name]),
      kind: "memory",
      name,
      key,
      replayOrder: index,
      status: key ? "trackable" : "missing-restart-token",
      nextCommand: key ? "restore_memory_slot" : "repair_restart_command_ledger",
      blocking: !key,
      replayPolicy: memory.providerSync ? "restore-provider-snapshot" : "restore-runtime-snapshot",
      statusChannel,
      commandId: "",
    });
  });

  const adapterStepSegments = externalSteps.map((step, index) => {
    const stepName = compactString(step.name || step.id || `step:${index + 1}`);
    const command = commandByStep.get(normalizeCommandName(stepName)) || null;
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability)
      .map(compactString)
      .filter(Boolean)
      .sort();
    const idempotencyKey = firstString(step.idempotencyKey, command?.idempotencyKey, runtimeScope.idempotencyKey);
    const missing = [
      !restartToken && "restartToken",
      !statusChannel && "statusChannel",
      !idempotencyKey && "idempotencyKey",
      !command?.commandId && "restartCommand",
    ].filter(Boolean);

    return Object.freeze({
      segmentId: stableToken("segment", [restartToken, jobName, "adapter-step", stepName]),
      kind: "adapter-step",
      name: stepName,
      key: restartToken ? `${restartToken}:step:${stepName}` : "",
      replayOrder: durableMemorySegments.length + index,
      status: missing.length > 0 ? "blocked" : "replay-ready",
      nextCommand: missing.length > 0 ? "attach_recovery_status_handoff" : "resume_adapter_step",
      blocking: missing.length > 0,
      replayPolicy: command?.replayPolicy || "resume-before-retry",
      statusChannel,
      commandId: compactString(command?.commandId),
      idempotencyKey,
      capabilities: freezeArray(capabilityRefs),
      missing: freezeArray(missing),
    });
  });

  const verifierSegments = toArray(ledger)
    .filter((command) => command.phase === "verify")
    .map((command, index) => Object.freeze({
      segmentId: stableToken("segment", [restartToken, jobName, "verify", command.command]),
      kind: "verifier",
      name: command.command,
      key: restartToken ? `${restartToken}:verify:${command.command}` : "",
      replayOrder: durableMemorySegments.length + adapterStepSegments.length + index,
      status: command.required === false || restartToken ? "trackable" : "blocked",
      nextCommand: command.required === false || restartToken ? "replay_verifier_status" : "repair_restart_command_ledger",
      blocking: command.required !== false && !restartToken,
      replayPolicy: command.replayPolicy || "latest-status-wins",
      statusChannel,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      missing: freezeArray([command.required !== false && !restartToken && "restartToken"].filter(Boolean)),
    }));

  return freezeArray([...durableMemorySegments, ...adapterStepSegments, ...verifierSegments]
    .sort((left, right) => left.replayOrder - right.replayOrder || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name)));
}

function createRestartReplayReport(segments = [], runtimeScope = {}) {
  const blocked = toArray(segments).filter((segment) => segment.blocking);
  const adapter = toArray(segments).filter((segment) => segment.kind === "adapter-step");
  const memory = toArray(segments).filter((segment) => segment.kind === "memory");
  const verifier = toArray(segments).filter((segment) => segment.kind === "verifier");

  return Object.freeze({
    protocol: "aios.scope.restart-replay-report.v1",
    state: blocked.length > 0
      ? "blocked"
      : adapter.length > 0
        ? "adapter-replay-ready"
        : segments.length > 0
          ? "runtime-replay-ready"
          : "not-required",
    acceptedForReplay: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && adapter.length > 0,
    restartToken: compactString(runtimeScope.restartToken),
    statusChannel: compactString(runtimeScope.statusChannel),
    counters: Object.freeze({
      segments: segments.length,
      adapterSteps: adapter.length,
      memorySlots: memory.length,
      verifierSegments: verifier.length,
      blocked: blocked.length,
      replayReady: toArray(segments).filter((segment) => segment.status === "replay-ready").length,
      trackable: toArray(segments).filter((segment) => segment.status === "trackable").length,
    }),
    blockedSegments: freezeArray(blocked.map((segment) => ({
      segmentId: segment.segmentId,
      kind: segment.kind,
      name: segment.name,
      missing: segment.missing || freezeArray([]),
      nextCommand: segment.nextCommand,
    }))),
    nextCommand: blocked[0]?.nextCommand
      || adapter[0]?.nextCommand
      || memory[0]?.nextCommand
      || verifier[0]?.nextCommand
      || "observe",
  });
}

function createPersistedRuntimeShape(job = {}, runtimeScope = {}) {
  const restartToken = compactString(runtimeScope.restartToken);
  const ledger = createRestartCommandLedger(job, runtimeScope);
  const externalSteps = toArray(job.steps).filter((step) => {
    const adapter = compactString(step.adapter);
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString);
    return adapter.includes("mailchimp") || capabilityRefs.some((capability) => WRITE_ACTION_PATTERN.test(capability));
  });
  const memoryMounts = toArray(job.memory)
    .map((memory) => ({
      name: compactString(memory.name || memory.id || "memory"),
      mode: compactString(memory.mode || "ephemeral"),
      providerSync: memory.providerSync === true || ["campaignDraft", "audienceSnapshot"].includes(compactString(memory.name)),
    }))
    .filter((memory) => memory.mode === "persistent" || memory.mode === "durable" || memory.providerSync);
  const replaySegments = createRestartReplaySegments(job, runtimeScope, ledger, externalSteps, memoryMounts);
  const replayReport = createRestartReplayReport(replaySegments, runtimeScope);
  const resumptionJournal = createRuntimeResumptionJournal(job, runtimeScope, ledger, externalSteps, memoryMounts, replaySegments);

  return Object.freeze({
    protocol: "aios.scope.persisted-runtime-shape.v1",
    jobName: compactString(job.name || "anonymous"),
    restartToken,
    storageKey: restartToken ? `${restartToken}:state` : "",
    commandLedgerKey: restartToken ? `${restartToken}:commands` : "",
    statusSnapshotKey: restartToken ? `${restartToken}:status` : "",
    resumeCursorKey: restartToken && externalSteps.length > 0 ? `${restartToken}:cursor` : "",
    restartSafe: Boolean(restartToken)
      && ledger.every((command) => command.idempotencyKey || command.phase !== "dedupe")
      && replayReport.acceptedForReplay,
    commands: ledger,
    replaySegments,
    replayReport,
    resumptionJournal,
    stateSlots: freezeArray([
      ...memoryMounts.map((memory) => ({
        name: memory.name,
        mode: memory.mode,
        key: restartToken ? `${restartToken}:memory:${memory.name}` : "",
        providerSync: memory.providerSync,
      })),
      ...externalSteps.map((step) => {
        const stepName = compactString(step.name || step.id || "step");
        return {
          name: `step:${stepName}`,
          mode: "adapter-status",
          key: restartToken ? `${restartToken}:step:${stepName}` : "",
          providerSync: true,
        };
      }),
    ]),
  });
}

function createRuntimeResumptionJournal(job = {}, runtimeScope = {}, ledger = [], externalSteps = [], memoryMounts = [], replaySegments = []) {
  const jobName = compactString(job.name || "anonymous");
  const restartToken = compactString(runtimeScope.restartToken);
  const commandLedgerKey = restartToken ? `${restartToken}:commands` : "";
  const statusSnapshotKey = restartToken ? `${restartToken}:status` : "";
  const statusChannel = compactString(runtimeScope.statusChannel);
  const idempotencyKey = compactString(runtimeScope.idempotencyKey);
  const stepNames = new Set(externalSteps.map((step) => compactString(step.name || step.id || "step")).filter(Boolean));
  const commandRows = toArray(ledger).map((command, index) => {
    const phase = compactString(command.phase || "resume");
    const stepName = compactString(command.stepName || command.step || "");
    const capability = compactString(command.capability || command.action || "");
    const commandId = firstString(command.commandId, stableToken("resumption-command", [
      restartToken,
      jobName,
      phase,
      stepName,
      capability,
      index + 1,
    ]));
    const missing = [
      !restartToken && "restart-token",
      (phase === "dedupe" || phase === "resume" || phase === "adapter") && !firstString(command.idempotencyKey, idempotencyKey) && "idempotency-key",
      (phase === "resume" || phase === "adapter" || phase === "adapter-status") && !statusChannel && "status-channel",
      (phase === "resume" || phase === "adapter-status") && !statusSnapshotKey && "status-snapshot-key",
    ].filter(Boolean);

    return Object.freeze({
      rowId: stableToken("resumption-row", [restartToken, jobName, commandId]),
      commandId,
      command: normalizeCommandName(command.command || command.name || phase, `resume_${jobName}`),
      phase,
      jobName,
      stepName,
      capability,
      state: missing.length > 0 ? "blocked" : stepNames.has(stepName) || phase === "resume" || phase === "adapter" ? "replayable" : "ready",
      safeToReplay: missing.length === 0 && (phase !== "dedupe" || Boolean(firstString(command.idempotencyKey, idempotencyKey))),
      idempotencyKey: firstString(command.idempotencyKey, idempotencyKey),
      statusChannel,
      statusSnapshotKey,
      commandLedgerKey,
      replayKey: stableToken("replay", [restartToken, commandId, firstString(command.idempotencyKey, idempotencyKey)]),
      resumeCursorKey: restartToken && stepNames.has(stepName) ? `${restartToken}:cursor:${stepName}` : "",
      missing: freezeArray(missing),
      nextCommand: missing.length > 0
        ? "attach_recovery_status_handoff"
        : phase === "adapter-status"
          ? "load_adapter_status_snapshot"
          : phase === "dedupe"
            ? "dedupe_external_write"
            : phase === "adapter"
              ? "queue_adapter_handoff"
              : "resume_adapter_step",
    });
  });
  const memoryRows = memoryMounts.map((memory) => {
    const name = compactString(memory.name);
    const missing = [
      !restartToken && "restart-token",
      !name && "memory-name",
    ].filter(Boolean);

    return Object.freeze({
      rowId: stableToken("resumption-memory", [restartToken, jobName, name]),
      name,
      mode: compactString(memory.mode || "persistent"),
      state: missing.length > 0 ? "blocked" : memory.providerSync ? "provider-sync-required" : "restorable",
      storageKey: restartToken && name ? `${restartToken}:memory:${name}` : "",
      providerSync: memory.providerSync === true,
      missing: freezeArray(missing),
      nextCommand: missing.length > 0 ? "attach_recovery_status_handoff" : memory.providerSync ? "restore_provider_synced_memory" : "restore_runtime_memory",
    });
  });
  const segmentRows = toArray(replaySegments).map((segment, index) => {
    const segmentId = firstString(segment.segmentId, segment.id, stableToken("segment", [jobName, index + 1]));
    const blocking = segment.blocking === true || toArray(segment.missing).length > 0;

    return Object.freeze({
      rowId: stableToken("resumption-segment", [restartToken, segmentId]),
      segmentId,
      state: blocking ? "blocked" : segment.replayable === false ? "waiting" : "replayable",
      stepName: compactString(segment.stepName || segment.step),
      capability: compactString(segment.capability || segment.action),
      missing: freezeArray(toArray(segment.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(segment.nextCommand || (blocking ? "repair_restart_command_ledger" : "resume_replay_segment")),
    });
  });
  const rows = [...commandRows, ...memoryRows, ...segmentRows];
  const blocked = rows.filter((row) => row.state === "blocked");
  const replayable = rows.filter((row) => row.state === "replayable" || row.safeToReplay === true);

  return Object.freeze({
    protocol: "aios.scope.runtime-resumption-journal.v1",
    jobName,
    restartToken,
    statusChannel,
    statusSnapshotKey,
    commandLedgerKey,
    state: blocked.length > 0 ? "blocked" : replayable.length > 0 ? "replayable" : rows.length > 0 ? "ready" : "not-required",
    acceptedForRestart: blocked.length === 0,
    acceptedForAdapterReplay: blocked.length === 0 && commandRows.every((row) => row.safeToReplay !== false),
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    replayableRows: freezeArray(replayable),
    counters: Object.freeze({
      rows: rows.length,
      commands: commandRows.length,
      memorySlots: memoryRows.length,
      replaySegments: segmentRows.length,
      blocked: blocked.length,
      replayable: replayable.length,
      missingStatusChannels: rows.filter((row) => toArray(row.missing).includes("status-channel")).length,
      missingIdempotencyKeys: rows.filter((row) => toArray(row.missing).includes("idempotency-key")).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || replayable[0]?.nextCommand || "observe",
      reason: blocked.length > 0
        ? "Runtime resumption journal is missing restart-safe status or idempotency state."
        : replayable.length > 0
          ? "Runtime resumption journal has replayable adapter work."
          : "Runtime resumption journal is reconciled.",
    }),
  });
}

function normalizeProviderSyncResource(value = {}, action = "") {
  if (typeof value === "string") {
    const [type, ...idParts] = value.split(":");
    return Object.freeze({
      type: compactString(idParts.length > 0 ? type : "resource"),
      id: compactString(idParts.length > 0 ? idParts.join(":") : value),
    });
  }

  return Object.freeze({
    type: firstString(value.type, value.kind, value.name, action.startsWith("campaign.") && "campaign", "resource"),
    id: firstString(value.id, value.resourceId, value.externalId, value.campaignId, value.audienceId, value.listId, value.segmentId, value.templateId),
  });
}

function inferProviderSyncResources(capability = {}, action = "") {
  const explicit = toArray(capability.syncResources || capability.providerResources || capability.resources)
    .map((resource) => normalizeProviderSyncResource(resource, action))
    .filter((resource) => resource.type || resource.id);

  if (explicit.length > 0) return explicit;
  if (action.startsWith("campaign.")) {
    return [normalizeProviderSyncResource({
      type: "campaign",
      id: firstString(capability.campaignId, capability.externalId),
    }, action)];
  }
  if (action.startsWith("audience.segment.")) {
    return [normalizeProviderSyncResource({
      type: "segment",
      id: firstString(capability.segmentId, capability.externalId),
    }, action)];
  }
  if (action.startsWith("audience.")) {
    return [normalizeProviderSyncResource({
      type: "audience",
      id: firstString(capability.audienceId, capability.listId, capability.externalId),
    }, action)];
  }
  if (action.startsWith("template.")) {
    return [normalizeProviderSyncResource({
      type: "template",
      id: firstString(capability.templateId, capability.externalId),
    }, action)];
  }
  if (action.startsWith("report.")) {
    return [normalizeProviderSyncResource({
      type: "report",
      id: firstString(capability.reportId, capability.externalId),
    }, action)];
  }
  return [];
}

function createProviderSyncScopeContract(job = {}, runtimeScope = {}, persistedRuntime = {}, adapterStatusLedger = {}) {
  const jobName = compactString(job.name || "anonymous");
  const rows = toArray(job.capabilities)
    .map((capability, index) => {
      const action = compactString(capability.name || capability.scope || `capability:${index + 1}`);
      const provider = inferCapabilityProvider(capability);
      if (provider !== "mailchimp") return null;

      const sync = capability.sync || capability.providerSync || capability.syncMetadata || {};
      const writeBoundary = WRITE_ACTION_PATTERN.test(action) || compactString(capability.boundary) === "external";
      const resources = inferProviderSyncResources(capability, action);
      const resourceFingerprint = resources
        .map((resource) => `${resource.type}:${resource.id || "pending"}`)
        .sort()
        .join("|");
      const baseKey = stableToken("provider-sync", [
        runtimeScope.restartToken,
        jobName,
        action,
        resourceFingerprint,
      ]);
      const checkpointKey = firstString(sync.checkpointKey, capability.checkpointKey, writeBoundary ? `${baseKey}:checkpoint` : "");
      const watermarkKey = firstString(sync.watermarkKey, capability.watermarkKey, `${baseKey}:watermark`);
      const cursor = firstString(sync.cursor, sync.nextCursor, capability.cursor);
      const statusRow = toArray(adapterStatusLedger.latestByCapability)
        .find((row) => compactString(row.capability) === action) || null;
      const missing = [
        !runtimeScope.restartToken && "restartToken",
        writeBoundary && !runtimeScope.idempotencyKey && "idempotencyKey",
        writeBoundary && !checkpointKey && "checkpointKey",
        !watermarkKey && "watermarkKey",
        resources.some((resource) => !resource.id) && "providerResourceId",
      ].filter(Boolean);

      return Object.freeze({
        action,
        provider,
        mode: compactString(sync.mode || capability.syncMode || "watermarked"),
        direction: compactString(sync.direction || capability.syncDirection || (writeBoundary ? "push-pull" : "pull")),
        writeBoundary,
        state: missing.length > 0
          ? "blocked"
          : !cursor && resources.some((resource) => resource.id)
            ? "needs-provider-cursor"
            : writeBoundary
              ? "checkpoint-scoped"
              : "watermark-scoped",
        restartToken: runtimeScope.restartToken,
        statusChannel: runtimeScope.statusChannel,
        statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
        checkpointKey,
        watermarkKey,
        cursor,
        objectRef: firstString(sync.objectRef, capability.externalObjectRef, resources.length === 1 && resources[0].id ? `${resources[0].type}:${resources[0].id}` : ""),
        resources: freezeArray(resources.map((resource) => ({
          type: resource.type,
          id: resource.id,
          stableRef: `${resource.type}:${resource.id || "pending"}`,
        }))),
        adapterStatus: Object.freeze({
          state: compactString(statusRow?.state || "unobserved"),
          providerRequestId: compactString(statusRow?.providerRequestId),
          nextCommand: statusRow ? "observe" : "load_adapter_status_snapshot",
        }),
        missing: freezeArray(missing),
        nextCommand: missing.length > 0
          ? "repair_provider_sync_scope"
          : !cursor && resources.some((resource) => resource.id)
            ? "confirm_provider_resource_state"
            : writeBoundary
              ? "persist_provider_checkpoint"
              : "refresh_provider_watermark",
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.action.localeCompare(right.action));
  const blocked = rows.filter((row) => row.state === "blocked");
  const needsCursor = rows.filter((row) => row.state === "needs-provider-cursor");

  return Object.freeze({
    protocol: "aios.scope.provider-sync-contract.v1",
    provider: rows.length > 0 ? "mailchimp" : "local",
    jobName,
    state: blocked.length > 0
      ? "blocked"
      : needsCursor.length > 0
        ? "needs-provider-confirmation"
        : rows.length > 0
          ? "scoped"
          : "not-applicable",
    acceptedForCapabilityAnalysis: blocked.length === 0,
    restartToken: runtimeScope.restartToken,
    statusChannel: runtimeScope.statusChannel,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked.map((row) => ({
      action: row.action,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      needsProviderCursor: needsCursor.length,
      writeBoundaries: rows.filter((row) => row.writeBoundary).length,
      checkpointRows: rows.filter((row) => row.checkpointKey).length,
      watermarkRows: rows.filter((row) => row.watermarkKey).length,
    }),
    nextCommand: blocked[0]?.nextCommand || needsCursor[0]?.nextCommand || "observe",
  });
}

function normalizeSegmentSyncReceipt(value = {}, fallback = {}) {
  const action = firstString(value.action, value.capability, value.scope, fallback.action);
  const audienceId = firstString(value.audienceId, value.listId, fallback.audienceId);
  const segmentId = firstString(value.segmentId, value.externalId, fallback.segmentId);
  const statusText = compactString(value.state || value.status || (value.accepted === true ? "accepted" : "")).toLowerCase();
  const state = ["accepted", "applied", "rejected", "expired", "pending"].includes(statusText)
    ? statusText
    : value.rejected === true
      ? "rejected"
      : value.accepted === true || value.appliedAt
        ? "accepted"
        : "pending";
  const receiptToken = firstString(value.receiptToken, value.token, value.id, stableToken("segment-sync-receipt", [
    fallback.tenantId,
    fallback.workspaceId,
    action || "audience.segment.sync",
    audienceId,
    segmentId,
  ]));

  return Object.freeze({
    receiptToken,
    action,
    audienceId,
    segmentId,
    state,
    tenantId: firstString(value.tenantId, fallback.tenantId),
    workspaceId: firstString(value.workspaceId, fallback.workspaceId),
    providerRequestId: firstString(value.providerRequestId, value.requestId, fallback.providerRequestId),
    checkpointKey: firstString(value.checkpointKey, fallback.checkpointKey),
    cursor: firstString(value.cursor, value.nextCursor, fallback.cursor),
    appliedAt: firstString(value.appliedAt, value.acceptedAt, value.updatedAt),
    expiresAt: firstString(value.expiresAt, value.validUntil),
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    source: compactString(value.source || fallback.source || "client-runtime"),
    nextCommand: normalizeCommandName(value.nextCommand || fallback.nextCommand || "attach_segment_sync_receipt"),
  });
}

function collectSegmentSyncReceipts(job = {}, requestState = normalizeRequestState()) {
  const clientState = job.clientState || job.requestState || {};
  const fallback = {
    tenantId: firstString(clientState.tenantId, job.tenantId, requestState.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, requestState.statusChannel),
  };

  return [
    ...toArray(requestState.segmentSyncReceipts),
    ...toArray(requestState.mailchimpSegmentSyncReceipts),
    ...toArray(clientState.segmentSyncReceipts || clientState.mailchimpSegmentSyncReceipts),
    ...toArray(job.segmentSyncReceipts || job.mailchimpSegmentSyncReceipts),
    job.segmentSyncReceipt,
  ]
    .filter(Boolean)
    .map((receipt) => normalizeSegmentSyncReceipt(receipt, fallback));
}

function createSegmentSyncReceiptLedger(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, providerSyncContract = {}) {
  const jobName = compactString(job.name || "anonymous");
  const observedAt = compactString(requestState.observedAt || runtimeScope.observedAt);
  const receipts = collectSegmentSyncReceipts(job, requestState);
  const segmentRows = toArray(providerSyncContract.rows)
    .filter((row) => row.action.startsWith("audience.segment.") && row.writeBoundary === true);
  const rows = segmentRows.map((syncRow) => {
    const segmentResource = toArray(syncRow.resources).find((resource) => resource.type === "segment") || {};
    const audienceResource = toArray(syncRow.resources).find((resource) => resource.type === "audience") || {};
    const receipt = receipts.find((candidate) => {
      const actionMatches = !candidate.action || candidate.action === syncRow.action;
      const segmentMatches = !candidate.segmentId || !segmentResource.id || candidate.segmentId === segmentResource.id;
      const tenantMatches = !candidate.tenantId || candidate.tenantId === runtimeScope.tenantId;
      const workspaceMatches = !candidate.workspaceId || candidate.workspaceId === runtimeScope.workspaceId;
      return actionMatches && segmentMatches && tenantMatches && workspaceMatches;
    }) || null;
    const expired = Boolean(receipt?.expiresAt && observedAt && receipt.expiresAt <= observedAt);
    const missing = [
      !receipt && "segmentSyncReceipt",
      receipt && !receipt.providerRequestId && "providerRequestId",
      receipt && !receipt.checkpointKey && "checkpointKey",
      receipt && !receipt.cursor && "cursor",
      expired && "receiptExpiry",
      receipt?.state === "rejected" && "receiptRejected",
    ].filter(Boolean);
    const blocked = !receipt || receipt.state === "rejected" || receipt.state === "expired" || expired;
    const pending = Boolean(receipt && (receipt.state === "pending" || missing.length > 0));

    return Object.freeze({
      rowId: stableToken("segment-sync-receipt-row", [jobName, syncRow.action, segmentResource.id || "pending"]),
      action: syncRow.action,
      provider: "mailchimp",
      state: blocked ? "blocked" : pending ? "pending" : "accepted",
      audienceId: compactString(audienceResource.id),
      segmentId: compactString(segmentResource.id),
      receiptToken: compactString(receipt?.receiptToken),
      providerRequestId: compactString(receipt?.providerRequestId || syncRow.adapterStatus?.providerRequestId),
      checkpointKey: compactString(receipt?.checkpointKey || syncRow.checkpointKey),
      cursor: compactString(receipt?.cursor || syncRow.cursor),
      expiresAt: compactString(receipt?.expiresAt),
      statusChannel: firstString(receipt?.statusChannel, syncRow.statusChannel, runtimeScope.statusChannel),
      missing: freezeArray(missing),
      nextCommand: blocked
        ? receipt?.state === "rejected"
          ? "revise_segment_sync"
          : expired
            ? "refresh_segment_sync_receipt"
            : "attach_segment_sync_receipt"
        : pending
          ? receipt?.nextCommand || "poll_segment_sync_receipt"
          : "observe",
    });
  }).sort((left, right) => left.action.localeCompare(right.action) || left.rowId.localeCompare(right.rowId));
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const pendingRows = rows.filter((row) => row.state === "pending");

  return Object.freeze({
    protocol: "aios.scope.mailchimp-segment-sync-receipts.v1",
    jobName,
    provider: rows.length > 0 ? "mailchimp" : "local",
    state: blockedRows.length > 0 ? "blocked" : pendingRows.length > 0 ? "pending" : rows.length > 0 ? "accepted" : "not-required",
    acceptedForPreview: true,
    acceptedForAdapter: blockedRows.length === 0 && pendingRows.length === 0,
    statusChannel: firstString(runtimeScope.statusChannel, providerSyncContract.statusChannel),
    rows: freezeArray(rows),
    blockedRows: freezeArray(blockedRows),
    pendingRows: freezeArray(pendingRows),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      accepted: rows.filter((row) => row.state === "accepted").length,
    }),
    nextStep: Object.freeze({
      command: blockedRows[0]?.nextCommand || pendingRows[0]?.nextCommand || "observe",
      reason: blockedRows.length > 0
        ? "Mailchimp audience segment sync receipts must be attached before adapter handoff."
        : pendingRows.length > 0
          ? "Mailchimp audience segment sync receipt is still pending provider confirmation."
          : "Mailchimp audience segment sync receipts are accepted for adapter handoff.",
    }),
  });
}

function normalizeProviderCallbackInput(value = {}, fallback = {}) {
  const provider = compactString(value.provider || fallback.provider || "mailchimp").toLowerCase();
  const action = firstString(value.action, value.capability, value.scope, fallback.action);
  const endpointUrl = firstString(value.endpointUrl, value.url, value.callbackUrl, value.webhookUrl, fallback.endpointUrl);
  const signingSecretRef = firstString(value.signingSecretRef, value.secretRef, value.signingSecret, value.webhookSecretRef, fallback.signingSecretRef);
  const verificationState = compactString(
    value.verificationState
      || value.state
      || value.status
      || (value.verified === true ? "verified" : "")
      || fallback.verificationState
      || "missing"
  ).toLowerCase();

  return Object.freeze({
    provider,
    action,
    callbackId: firstString(value.callbackId, value.id, stableToken("provider-callback", [
      provider,
      fallback.tenantId,
      fallback.workspaceId,
      action || "global",
      endpointUrl,
    ])),
    endpointUrl,
    signingSecretRef,
    verificationState,
    verifiedAt: firstString(value.verifiedAt, value.updatedAt),
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    retryAfterMs: positiveInteger(value.retryAfterMs ?? value.retryAfter, 0),
    source: compactString(value.source || fallback.source || "runtime"),
    nextCommand: normalizeCommandName(value.nextCommand || fallback.nextCommand || "verify_provider_callback_endpoint"),
  });
}

function collectProviderCallbackInputs(job = {}, requestState = normalizeRequestState()) {
  const clientState = job.clientState || job.requestState || {};
  const fallback = {
    provider: "mailchimp",
    tenantId: firstString(clientState.tenantId, job.tenantId, requestState.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, requestState.statusChannel),
    source: "client-runtime",
  };
  return [
    ...toArray(requestState.providerCallbacks),
    ...toArray(requestState.mailchimpCallbacks),
    ...toArray(requestState.webhookEndpoints),
    ...toArray(clientState.providerCallbacks || clientState.mailchimpCallbacks || clientState.webhookEndpoints),
    ...toArray(job.providerCallbacks || job.mailchimpCallbacks || job.webhookEndpoints),
    job.providerCallback,
    job.mailchimpCallback,
  ]
    .filter(Boolean)
    .map((callback) => normalizeProviderCallbackInput(callback, fallback));
}

function createProviderCallbackContract(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, permissionBoundary = {}) {
  const jobName = compactString(job.name || "anonymous");
  const callbacks = collectProviderCallbackInputs(job, requestState);
  const rows = toArray(permissionBoundary.capabilities).map((capability) => {
    const action = compactString(capability.action);
    const declared = toArray(job.capabilities).find((item) => compactString(item.name || item.scope) === action) || {};
    const callback = declared.callback || declared.providerCallback || declared.webhook || {};
    const required = capability.provider === "mailchimp"
      && capability.writeBoundary === true
      && declared.callbackRequired !== false
      && declared.webhookRequired !== false;
    const matching = callbacks.find((item) => {
      return item.provider === capability.provider && (!item.action || item.action === action);
    }) || normalizeProviderCallbackInput(callback, {
      provider: capability.provider,
      action,
      tenantId: runtimeScope.tenantId,
      workspaceId: runtimeScope.workspaceId,
      statusChannel: runtimeScope.statusChannel,
      source: "capability-declaration",
    });
    const verified = ["verified", "active", "ready"].includes(matching.verificationState);
    const pending = ["pending", "registered", "challenge-sent", "unverified"].includes(matching.verificationState);
    const missing = [
      required && !matching.endpointUrl && "endpointUrl",
      required && !matching.signingSecretRef && "signingSecretRef",
      required && !runtimeScope.statusChannel && "statusChannel",
      required && !runtimeScope.tenantId && "tenantId",
      required && !runtimeScope.workspaceId && "workspaceId",
    ].filter(Boolean);
    const state = !required
      ? "not-required"
      : missing.length > 0
        ? "blocked"
        : verified
          ? "verified"
          : pending
            ? "pending-verification"
            : "blocked";

    return Object.freeze({
      rowId: stableToken("provider-callback-row", [jobName, capability.provider, action]),
      action,
      provider: capability.provider,
      required,
      state,
      callbackId: matching.callbackId,
      endpointUrl: matching.endpointUrl,
      signingSecretRef: matching.signingSecretRef,
      verificationState: matching.verificationState,
      verifiedAt: matching.verifiedAt,
      statusChannel: firstString(matching.statusChannel, runtimeScope.statusChannel),
      retryAfterMs: matching.retryAfterMs || (state === "pending-verification" ? 15000 : 0),
      source: matching.source,
      missing: freezeArray(missing),
      nextCommand: state === "blocked"
        ? missing.length > 0
          ? "attach_provider_callback_endpoint"
          : matching.nextCommand
        : state === "pending-verification"
          ? matching.nextCommand
          : "observe",
    });
  }).sort((left, right) => left.action.localeCompare(right.action) || left.rowId.localeCompare(right.rowId));
  const blocked = rows.filter((row) => row.state === "blocked");
  const pending = rows.filter((row) => row.state === "pending-verification");

  return Object.freeze({
    protocol: "aios.scope.provider-callback.v1",
    jobName,
    provider: rows.some((row) => row.provider === "mailchimp") ? "mailchimp" : "local",
    state: blocked.length > 0
      ? "blocked"
      : pending.length > 0
        ? "pending-verification"
        : rows.some((row) => row.required)
          ? "verified"
          : "not-required",
    acceptedForPreview: true,
    acceptedForAdapter: blocked.length === 0 && pending.length === 0,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    pendingRows: freezeArray(pending),
    counters: Object.freeze({
      rows: rows.length,
      required: rows.filter((row) => row.required).length,
      verified: rows.filter((row) => row.state === "verified").length,
      pending: pending.length,
      blocked: blocked.length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || pending[0]?.nextCommand || "observe",
      retryAfterMs: blocked[0]?.retryAfterMs || pending[0]?.retryAfterMs || 0,
      reason: blocked.length > 0
        ? "Mailchimp callback endpoint state is incomplete for external handoff."
        : pending.length > 0
          ? "Mailchimp callback endpoint verification is pending before external handoff."
          : "Provider callback endpoint state is ready.",
    }),
  });
}

function defaultProviderEventsForAction(action) {
  if (action.startsWith("campaign.") && /send|schedule/.test(action)) {
    return ["campaign.sent", "campaign.opened", "campaign.clicked"];
  }
  if (action.startsWith("campaign.") && WRITE_ACTION_PATTERN.test(action)) {
    return ["campaign.updated"];
  }
  if (action.startsWith("audience.segment.")) {
    return WRITE_ACTION_PATTERN.test(action) ? ["segment.created", "segment.updated"] : ["segment.updated"];
  }
  if (action.startsWith("audience.")) {
    return WRITE_ACTION_PATTERN.test(action) ? ["list.created", "list.updated", "subscribe", "unsubscribe"] : ["subscribe", "unsubscribe"];
  }
  if (action.startsWith("template.")) {
    return WRITE_ACTION_PATTERN.test(action) ? ["template.created", "template.updated"] : ["template.updated"];
  }
  if (action.startsWith("report.")) return ["campaign.sent", "campaign.opened", "campaign.clicked"];
  return [];
}

function normalizeProviderEventSubscription(value = {}, fallback = {}) {
  const provider = compactString(value.provider || fallback.provider || "mailchimp").toLowerCase();
  const action = firstString(value.action, value.capability, value.scope, fallback.action);
  const callbackId = firstString(value.callbackId, value.providerCallbackId, value.webhookId, fallback.callbackId);
  const events = toArray(value.events || value.eventTypes || value.webhookEvents || fallback.events)
    .map(compactString)
    .filter(Boolean)
    .sort();
  const state = compactString(
    value.state
      || value.status
      || (value.subscribed === true ? "subscribed" : "")
      || fallback.state
      || "missing"
  ).toLowerCase();

  return Object.freeze({
    provider,
    action,
    subscriptionId: firstString(value.subscriptionId, value.id, stableToken("provider-event-subscription", [
      provider,
      fallback.tenantId,
      fallback.workspaceId,
      action || "global",
      callbackId,
      stableFingerprint(events),
    ])),
    callbackId,
    events: freezeArray([...new Set(events)]),
    state,
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    revision: firstString(value.revision, value.etag, value.updatedAt),
    retryAfterMs: positiveInteger(value.retryAfterMs ?? value.retryAfter, 0),
    source: compactString(value.source || fallback.source || "runtime"),
    nextCommand: normalizeCommandName(value.nextCommand || fallback.nextCommand || "subscribe_provider_events"),
  });
}

function collectProviderEventSubscriptionInputs(job = {}, requestState = normalizeRequestState()) {
  const clientState = job.clientState || job.requestState || {};
  const fallback = {
    provider: "mailchimp",
    tenantId: firstString(clientState.tenantId, job.tenantId, requestState.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, requestState.statusChannel),
    source: "client-runtime",
  };
  return [
    ...toArray(requestState.providerEventSubscriptions),
    ...toArray(requestState.mailchimpEventSubscriptions),
    ...toArray(clientState.providerEventSubscriptions || clientState.mailchimpEventSubscriptions || clientState.webhookSubscriptions),
    ...toArray(job.providerEventSubscriptions || job.mailchimpEventSubscriptions || job.webhookSubscriptions),
    job.providerEventSubscription,
    job.mailchimpEventSubscription,
  ]
    .filter(Boolean)
    .map((subscription) => normalizeProviderEventSubscription(subscription, fallback));
}

function createProviderEventSubscriptionContract(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, permissionBoundary = {}, providerCallback = {}) {
  const jobName = compactString(job.name || "anonymous");
  const subscriptions = collectProviderEventSubscriptionInputs(job, requestState);
  const callbackRows = toArray(providerCallback.rows);
  const rows = toArray(permissionBoundary.capabilities).map((capability) => {
    const action = compactString(capability.action);
    const declared = toArray(job.capabilities).find((item) => compactString(item.name || item.scope) === action) || {};
    const declaredEvents = toArray(
      declared.events
        || declared.eventTypes
        || declared.webhookEvents
        || declared.providerEvents
    ).map(compactString).filter(Boolean);
    const requiredEvents = freezeArray([...new Set([
      ...declaredEvents,
      ...defaultProviderEventsForAction(action),
    ])].sort());
    const callback = callbackRows.find((row) => row.action === action)
      || callbackRows.find((row) => row.required && row.state !== "not-required")
      || null;
    const matching = subscriptions.find((subscription) => {
      return subscription.provider === capability.provider
        && (!subscription.action || subscription.action === action)
        && (!subscription.callbackId || !callback?.callbackId || subscription.callbackId === callback.callbackId);
    }) || null;
    const subscribedEvents = new Set(toArray(matching?.events).map(compactString).filter(Boolean));
    const missingEvents = requiredEvents.filter((event) => !subscribedEvents.has(event));
    const required = capability.provider === "mailchimp"
      && (capability.writeBoundary === true || action.startsWith("report."))
      && requiredEvents.length > 0
      && declared.eventsRequired !== false
      && declared.webhookEventsRequired !== false;
    const callbackReady = !required
      || (callback && callback.state === "verified" && Boolean(callback.callbackId));
    const missing = [
      required && !callback?.callbackId && "callbackId",
      required && callback?.state === "blocked" && "providerCallback",
      required && callback?.state === "pending-verification" && "providerCallbackVerification",
      required && missingEvents.length > 0 && "events",
      required && !runtimeScope.statusChannel && "statusChannel",
    ].filter(Boolean);
    const pending = ["pending", "registering", "syncing"].includes(compactString(matching?.state));
    const subscribed = ["subscribed", "active", "ready"].includes(compactString(matching?.state));
    const state = !required
      ? "not-required"
      : missing.length > 0
        ? "blocked"
        : pending
          ? "pending"
          : subscribed
            ? "subscribed"
            : callbackReady
              ? "missing-subscription"
              : "blocked";

    return Object.freeze({
      rowId: stableToken("provider-event-subscription-row", [jobName, capability.provider, action, callback?.callbackId || "callback"]),
      action,
      provider: capability.provider,
      required,
      state,
      subscriptionId: compactString(matching?.subscriptionId),
      callbackId: compactString(callback?.callbackId || matching?.callbackId),
      callbackState: compactString(callback?.state || "not-required"),
      requiredEvents,
      subscribedEvents: freezeArray([...subscribedEvents].sort()),
      missingEvents: freezeArray(missingEvents),
      statusChannel: firstString(matching?.statusChannel, runtimeScope.statusChannel),
      revision: compactString(matching?.revision),
      retryAfterMs: matching?.retryAfterMs || (pending ? 15000 : 0),
      source: compactString(matching?.source || "not-provided"),
      missing: freezeArray(missing),
      nextCommand: state === "blocked"
        ? missing.includes("providerCallback") || missing.includes("callbackId")
          ? "attach_provider_callback_endpoint"
          : missing.includes("providerCallbackVerification")
            ? "verify_provider_callback_endpoint"
            : "subscribe_provider_events"
        : state === "pending"
          ? matching?.nextCommand || "poll_provider_event_subscription"
          : state === "missing-subscription"
            ? "subscribe_provider_events"
            : "observe",
    });
  }).sort((left, right) => left.action.localeCompare(right.action) || left.rowId.localeCompare(right.rowId));
  const blocked = rows.filter((row) => row.state === "blocked" || row.state === "missing-subscription");
  const pending = rows.filter((row) => row.state === "pending");

  return Object.freeze({
    protocol: "aios.scope.provider-event-subscriptions.v1",
    jobName,
    provider: rows.some((row) => row.provider === "mailchimp") ? "mailchimp" : "local",
    state: blocked.length > 0
      ? "blocked"
      : pending.length > 0
        ? "pending"
        : rows.some((row) => row.required)
          ? "subscribed"
          : "not-required",
    acceptedForPreview: true,
    acceptedForAdapter: blocked.length === 0 && pending.length === 0,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    pendingRows: freezeArray(pending),
    counters: Object.freeze({
      rows: rows.length,
      required: rows.filter((row) => row.required).length,
      subscribed: rows.filter((row) => row.state === "subscribed").length,
      pending: pending.length,
      blocked: blocked.length,
      missingEvents: rows.reduce((count, row) => count + row.missingEvents.length, 0),
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || pending[0]?.nextCommand || "observe",
      retryAfterMs: blocked[0]?.retryAfterMs || pending[0]?.retryAfterMs || 0,
      reason: blocked.length > 0
        ? "Mailchimp event subscriptions must be attached to the verified callback before adapter handoff."
        : pending.length > 0
          ? "Mailchimp event subscription registration is pending provider confirmation."
          : "Provider event subscriptions are ready.",
    }),
  });
}

function normalizeMaintenanceWindowInput(value = {}, fallback = {}) {
  const provider = compactString(value.provider || fallback.provider || "mailchimp").toLowerCase();
  const action = firstString(value.action, value.capability, value.scope, fallback.action);
  const state = compactString(value.state || value.status || (value.active === true ? "active" : "scheduled")).toLowerCase();
  const retryAfterMs = positiveInteger(value.retryAfterMs ?? value.retryAfter ?? fallback.retryAfterMs, 0);
  const startsAt = firstString(value.startsAt, value.startAt, value.from, value.windowStart, fallback.startsAt);
  const endsAt = firstString(value.endsAt, value.endAt, value.until, value.windowEnd, fallback.endsAt);

  return Object.freeze({
    provider,
    action,
    windowId: firstString(value.windowId, value.id, stableToken("provider-maintenance", [
      provider,
      fallback.tenantId,
      fallback.workspaceId,
      action || "global",
      startsAt,
      endsAt,
    ])),
    state,
    startsAt,
    endsAt,
    retryAfterMs,
    allowReads: value.allowReads === true || fallback.allowReads === true,
    allowPreview: value.allowPreview !== false && fallback.allowPreview !== false,
    reason: compactString(value.reason || value.message || fallback.reason || "provider-maintenance-window"),
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    source: compactString(value.source || fallback.source || "runtime"),
    nextCommand: normalizeCommandName(value.nextCommand || fallback.nextCommand || "wait_for_provider_maintenance_window"),
  });
}

function normalizeProviderServiceWindowInput(value = {}, fallback = {}) {
  const provider = compactString(value.provider || fallback.provider || "mailchimp").toLowerCase();
  const action = firstString(value.action, value.capability, value.scope, fallback.action);
  const rawState = compactString(value.state || value.status || value.health || "available").toLowerCase();
  const state = ["down", "outage", "unavailable", "incident"].includes(rawState)
    ? "outage"
    : ["slow", "degraded", "partial", "rate-limited"].includes(rawState)
      ? "degraded"
      : ["maintenance", "scheduled"].includes(rawState)
        ? "maintenance"
        : "available";
  const retryAfterMs = positiveInteger(value.retryAfterMs ?? value.retryAfter ?? fallback.retryAfterMs, 0);
  const startsAt = firstString(value.startsAt, value.startAt, value.from, value.windowStart, fallback.startsAt);
  const endsAt = firstString(value.endsAt, value.endAt, value.until, value.windowEnd, fallback.endsAt);
  const blocksWrites = value.blocksWrites !== false && value.allowWrites !== true && state !== "available";
  const blocksReads = value.blocksReads === true || (state === "outage" && value.allowReads !== true);

  return Object.freeze({
    provider,
    action,
    serviceWindowId: firstString(value.serviceWindowId, value.windowId, value.incidentId, value.id, stableToken("provider-service-window", [
      provider,
      fallback.tenantId,
      fallback.workspaceId,
      action || "global",
      state,
      startsAt,
      endsAt,
    ])),
    state,
    startsAt,
    endsAt,
    retryAfterMs,
    blocksReads,
    blocksWrites,
    allowPreview: value.allowPreview !== false,
    severity: compactString(value.severity || (state === "outage" ? "critical" : state === "degraded" ? "warning" : "info")),
    reason: compactString(value.reason || value.message || fallback.reason || `provider-service-${state}`),
    statusChannel: firstString(value.statusChannel, fallback.statusChannel),
    source: compactString(value.source || fallback.source || "runtime"),
    nextCommand: normalizeCommandName(value.nextCommand || fallback.nextCommand || (
      state === "outage" ? "wait_for_provider_service_recovery" : "defer_provider_handoff"
    )),
  });
}

function collectProviderMaintenanceInputs(job = {}, requestState = normalizeRequestState()) {
  const clientState = job.clientState || job.requestState || {};
  const fallback = {
    provider: "mailchimp",
    tenantId: firstString(clientState.tenantId, job.tenantId, requestState.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, requestState.workspaceId),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, requestState.statusChannel),
    source: "client-runtime",
  };
  return [
    ...toArray(requestState.providerMaintenanceWindows),
    ...toArray(requestState.maintenanceWindows),
    ...toArray(requestState.mailchimpMaintenance),
    ...toArray(clientState.providerMaintenanceWindows || clientState.maintenanceWindows || clientState.mailchimpMaintenance),
    ...toArray(job.providerMaintenanceWindows || job.maintenanceWindows || job.mailchimpMaintenance),
    job.providerMaintenance,
    job.maintenanceWindow,
  ]
    .filter(Boolean)
    .map((window) => normalizeMaintenanceWindowInput(window, fallback));
}

function createProviderMaintenanceContract(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, permissionBoundary = {}) {
  const jobName = compactString(job.name || "anonymous");
  const observedAt = compactString(requestState.observedAt || runtimeScope.observedAt);
  const windows = collectProviderMaintenanceInputs(job, requestState);
  const serviceWindows = [
    ...toArray(requestState.providerServiceWindows),
    ...toArray(job.clientState?.providerServiceWindows || job.requestState?.providerServiceWindows || job.clientState?.mailchimpServiceWindows || job.requestState?.mailchimpServiceWindows),
    ...toArray(job.providerServiceWindows || job.mailchimpServiceWindows || job.providerIncidents),
  ]
    .filter(Boolean)
    .map((window) => normalizeProviderServiceWindowInput(window, {
      tenantId: firstString(job.clientState?.tenantId, job.requestState?.tenantId, job.tenantId, requestState.tenantId),
      workspaceId: firstString(job.clientState?.workspaceId, job.requestState?.workspaceId, job.workspaceId, requestState.workspaceId),
      statusChannel: firstString(job.clientState?.statusChannel, job.requestState?.statusChannel, job.statusChannel, requestState.statusChannel),
      provider: "mailchimp",
    }));
  const rows = toArray(permissionBoundary.capabilities).map((capability) => {
    const action = compactString(capability.action);
    const matching = windows.find((window) => {
      return window.provider === capability.provider && (!window.action || window.action === action);
    }) || null;
    const serviceWindow = serviceWindows.find((window) => {
      return window.provider === capability.provider && (!window.action || window.action === action);
    }) || null;
    const activeByTime = Boolean(matching?.startsAt && matching?.endsAt && observedAt && matching.startsAt <= observedAt && observedAt < matching.endsAt);
    const serviceActiveByTime = Boolean(serviceWindow?.startsAt && serviceWindow?.endsAt && observedAt && serviceWindow.startsAt <= observedAt && observedAt < serviceWindow.endsAt);
    const scheduledFuture = Boolean(matching?.startsAt && observedAt && matching.startsAt > observedAt);
    const active = Boolean(matching && (matching.state === "active" || matching.state === "in-progress" || activeByTime));
    const scheduled = Boolean(matching && !active && (matching.state === "scheduled" || scheduledFuture));
    const serviceBlocking = Boolean(serviceWindow && (serviceWindow.state === "outage" || serviceWindow.state === "maintenance" || serviceActiveByTime));
    const serviceDegraded = Boolean(serviceWindow && serviceWindow.state === "degraded" && !serviceBlocking);
    const retryAfterMs = matching?.retryAfterMs
      || serviceWindow?.retryAfterMs
      || (active && matching?.endsAt && observedAt ? millisecondsBetween(matching.endsAt, observedAt) : 0)
      || (serviceBlocking && serviceWindow?.endsAt && observedAt ? millisecondsBetween(serviceWindow.endsAt, observedAt) : 0);
    const externalWrite = capability.writeBoundary === true;
    const blockedBy = [
      active && externalWrite && "provider-maintenance-active",
      scheduled && externalWrite && "provider-maintenance-scheduled",
      active && !matching.allowReads && !externalWrite && "provider-maintenance-read-hold",
      serviceBlocking && externalWrite && serviceWindow.blocksWrites && "provider-service-write-unavailable",
      serviceBlocking && !externalWrite && serviceWindow.blocksReads && "provider-service-read-unavailable",
      serviceWindow?.state === "outage" && "provider-service-outage",
      active && !runtimeScope.statusChannel && "missing-status-channel",
    ].filter(Boolean);
    const state = !matching
      && !serviceWindow
      ? "not-required"
      : blockedBy.length > 0
        ? "blocked"
        : active || scheduled || serviceDegraded
          ? "degraded"
          : "clear";

    return Object.freeze({
      rowId: stableToken("provider-maintenance-row", [jobName, capability.provider, action, matching?.windowId || "none"]),
      action,
      provider: capability.provider,
      state,
      windowId: compactString(matching?.windowId),
      startsAt: compactString(matching?.startsAt),
      endsAt: compactString(matching?.endsAt),
      retryAfterMs,
      serviceWindow: serviceWindow ? Object.freeze({
        serviceWindowId: serviceWindow.serviceWindowId,
        state: serviceWindow.state,
        severity: serviceWindow.severity,
        startsAt: serviceWindow.startsAt,
        endsAt: serviceWindow.endsAt,
        blocksReads: serviceWindow.blocksReads,
        blocksWrites: serviceWindow.blocksWrites,
        reason: serviceWindow.reason,
        nextCommand: serviceWindow.nextCommand,
      }) : null,
      allowReads: matching?.allowReads === true,
      allowPreview: matching?.allowPreview !== false && serviceWindow?.allowPreview !== false,
      reason: compactString(serviceWindow?.reason || matching?.reason),
      statusChannel: firstString(serviceWindow?.statusChannel, matching?.statusChannel, runtimeScope.statusChannel),
      source: compactString(serviceWindow?.source || matching?.source || "not-provided"),
      blockedBy: freezeArray(blockedBy),
      nextCommand: state === "blocked"
        ? serviceWindow?.nextCommand || matching?.nextCommand || "wait_for_provider_maintenance_window"
        : state === "degraded"
          ? serviceWindow?.nextCommand || "defer_provider_handoff"
          : "observe",
    });
  }).sort((left, right) => left.action.localeCompare(right.action) || left.rowId.localeCompare(right.rowId));
  const blocked = rows.filter((row) => row.state === "blocked");
  const degraded = rows.filter((row) => row.state === "degraded");

  return Object.freeze({
    protocol: "aios.scope.provider-maintenance.v1",
    jobName,
    provider: rows.some((row) => row.provider === "mailchimp") ? "mailchimp" : "local",
    state: blocked.length > 0
      ? "blocked"
      : degraded.length > 0
        ? "degraded"
        : rows.some((row) => row.state === "clear")
          ? "clear"
          : "not-required",
    acceptedForPreview: blocked.every((row) => row.allowPreview),
    acceptedForAdapter: blocked.length === 0,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    degradedRows: freezeArray(degraded),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      degraded: degraded.length,
      active: rows.filter((row) => row.blockedBy.includes("provider-maintenance-active")).length,
      scheduled: rows.filter((row) => row.blockedBy.includes("provider-maintenance-scheduled")).length,
      serviceOutages: rows.filter((row) => row.serviceWindow?.state === "outage").length,
      serviceDegraded: rows.filter((row) => row.serviceWindow?.state === "degraded").length,
      serviceWriteUnavailable: rows.filter((row) => row.blockedBy.includes("provider-service-write-unavailable")).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || degraded[0]?.nextCommand || "observe",
      retryAfterMs: blocked[0]?.retryAfterMs || degraded[0]?.retryAfterMs || 0,
      reason: blocked.length > 0
        ? "Mailchimp provider maintenance window blocks adapter handoff until the window clears."
        : degraded.length > 0
          ? "Mailchimp provider maintenance is scheduled; adapter handoff should be deferred or confirmed."
          : "Provider maintenance does not block adapter handoff.",
    }),
  });
}

function createProviderOperationalIncidentContract(job = {}, requestState = normalizeRequestState(), runtimeScope = {}, providerBudget = {}, providerCallback = {}, providerMaintenance = {}, providerEventSubscriptions = {}, permissionPosture = {}) {
  const jobName = compactString(job.name || "anonymous");
  const observedAt = compactString(requestState.observedAt || runtimeScope.observedAt);
  const statusChannel = firstString(runtimeScope.statusChannel, requestState.statusChannel);
  const incidentRows = [
    ...toArray(providerMaintenance.blockedRows).map((row) => ({
      source: "provider-maintenance",
      action: row.action,
      provider: row.provider || "mailchimp",
      state: "blocked",
      severity: toArray(row.blockedBy).some((reason) => compactString(reason).includes("outage") || compactString(reason).includes("unavailable"))
        ? "critical"
        : "error",
      reason: toArray(row.blockedBy).join(", ") || row.reason || "provider-maintenance-blocked",
      nextCommand: row.nextCommand || "wait_for_provider_maintenance_window",
      retryAfterMs: row.retryAfterMs,
      windowId: row.windowId,
      serviceWindowId: row.serviceWindow?.serviceWindowId,
      statusChannel: row.statusChannel,
      externalHandoff: "blocked",
    })),
    ...toArray(providerMaintenance.degradedRows).map((row) => ({
      source: "provider-maintenance",
      action: row.action,
      provider: row.provider || "mailchimp",
      state: "degraded",
      severity: row.serviceWindow?.state === "degraded" ? "warning" : "info",
      reason: row.reason || row.serviceWindow?.reason || "provider-maintenance-degraded",
      nextCommand: row.nextCommand || "defer_provider_handoff",
      retryAfterMs: row.retryAfterMs,
      windowId: row.windowId,
      serviceWindowId: row.serviceWindow?.serviceWindowId,
      statusChannel: row.statusChannel,
      externalHandoff: "defer",
    })),
    ...toArray(providerBudget.blockedRows).map((row) => ({
      source: "provider-budget",
      action: row.action,
      provider: providerBudget.provider || "mailchimp",
      state: "blocked",
      severity: "error",
      reason: toArray(row.blockedBy).join(", ") || "provider-budget-blocked",
      nextCommand: row.nextCommand || "wait_for_provider_budget_reset",
      retryAfterMs: row.retryAfterMs,
      budgetId: row.budgetId,
      statusChannel,
      externalHandoff: "blocked",
    })),
    ...toArray(providerBudget.degradedRows).map((row) => ({
      source: "provider-budget",
      action: row.action,
      provider: providerBudget.provider || "mailchimp",
      state: "degraded",
      severity: "warning",
      reason: "provider-budget-below-safety-floor",
      nextCommand: row.nextCommand || "throttle_provider_handoff",
      retryAfterMs: row.retryAfterMs,
      budgetId: row.budgetId,
      statusChannel,
      externalHandoff: "throttle",
    })),
    ...toArray(providerCallback.blockedRows).map((row) => ({
      source: "provider-callback",
      action: row.action,
      provider: row.provider || "mailchimp",
      state: "blocked",
      severity: "error",
      reason: toArray(row.missing).join(", ") || "provider-callback-blocked",
      nextCommand: row.nextCommand || "attach_provider_callback_endpoint",
      retryAfterMs: row.retryAfterMs,
      callbackId: row.callbackId,
      statusChannel: row.statusChannel || statusChannel,
      externalHandoff: "blocked",
    })),
    ...toArray(providerCallback.pendingRows).map((row) => ({
      source: "provider-callback",
      action: row.action,
      provider: row.provider || "mailchimp",
      state: "pending",
      severity: "warning",
      reason: "provider-callback-verification-pending",
      nextCommand: row.nextCommand || "verify_provider_callback_endpoint",
      retryAfterMs: row.retryAfterMs,
      callbackId: row.callbackId,
      statusChannel: row.statusChannel || statusChannel,
      externalHandoff: "defer",
    })),
    ...toArray(providerEventSubscriptions.blockedRows).map((row) => ({
      source: "provider-event-subscription",
      action: row.action,
      provider: row.provider || "mailchimp",
      state: "blocked",
      severity: "error",
      reason: toArray(row.missingEvents || row.missing).join(", ") || "provider-event-subscription-blocked",
      nextCommand: row.nextCommand || "subscribe_provider_events",
      retryAfterMs: row.retryAfterMs,
      subscriptionId: row.subscriptionId,
      callbackId: row.callbackId,
      statusChannel: statusChannel,
      externalHandoff: "blocked",
    })),
    ...toArray(providerEventSubscriptions.pendingRows).map((row) => ({
      source: "provider-event-subscription",
      action: row.action,
      provider: row.provider || "mailchimp",
      state: "pending",
      severity: "warning",
      reason: "provider-event-subscription-pending",
      nextCommand: row.nextCommand || "poll_provider_event_subscription",
      retryAfterMs: row.retryAfterMs,
      subscriptionId: row.subscriptionId,
      callbackId: row.callbackId,
      statusChannel,
      externalHandoff: "defer",
    })),
    ...toArray(permissionPosture.blockedRows)
      .filter((row) => row.state === "lease-blocked")
      .map((row) => ({
        source: "permission-lease",
        action: row.action,
        provider: row.provider || "mailchimp",
        state: "blocked",
        severity: "error",
        reason: toArray(row.leaseReasons).join(", ") || row.leaseState || "permission-lease-blocked",
        nextCommand: row.nextCommand || "refresh_mailchimp_permission_lease",
        retryAfterMs: 0,
        leaseToken: row.leaseToken,
        statusChannel,
        externalHandoff: "blocked",
      })),
  ].filter((row) => compactString(row.action));

  const rows = incidentRows.map((row, index) => Object.freeze({
    rowId: stableToken("provider-incident", [jobName, row.source, row.action, row.windowId || row.budgetId || row.callbackId || row.subscriptionId || row.leaseToken || index + 1]),
    jobName,
    action: compactString(row.action),
    provider: compactString(row.provider || "mailchimp"),
    source: compactString(row.source),
    state: compactString(row.state),
    severity: compactString(row.severity || "warning"),
    reason: compactString(row.reason),
    observedAt,
    retryAfterMs: Number(row.retryAfterMs) || 0,
    nextCommand: normalizeCommandName(row.nextCommand || "observe"),
    statusChannel: firstString(row.statusChannel, statusChannel),
    externalHandoff: compactString(row.externalHandoff || "defer"),
    refs: Object.freeze({
      windowId: compactString(row.windowId),
      serviceWindowId: compactString(row.serviceWindowId),
      budgetId: compactString(row.budgetId),
      callbackId: compactString(row.callbackId),
      subscriptionId: compactString(row.subscriptionId),
      leaseToken: compactString(row.leaseToken),
    }),
  })).sort((left, right) => {
    const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
    return (severityOrder[left.severity] ?? 4) - (severityOrder[right.severity] ?? 4)
      || left.action.localeCompare(right.action)
      || left.source.localeCompare(right.source);
  });
  const blocked = rows.filter((row) => row.state === "blocked");
  const degraded = rows.filter((row) => row.state === "degraded" || row.state === "pending");
  const retryAfterMs = Math.max(0, ...rows.map((row) => row.retryAfterMs));
  const blockedActions = [...new Set(blocked.map((row) => row.action))].sort();
  const degradedActions = [...new Set(degraded.map((row) => row.action))].sort();

  return Object.freeze({
    protocol: "aios.scope.provider-operational-incidents.v1",
    jobName,
    provider: rows.some((row) => row.provider === "mailchimp") ? "mailchimp" : "local",
    state: blocked.length > 0 ? "blocked" : degraded.length > 0 ? "degraded" : "clear",
    acceptedForPreview: true,
    acceptedForAdapter: blocked.length === 0,
    observedAt,
    statusChannel,
    retryAfterMs,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    degradedRows: freezeArray(degraded),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      degraded: degraded.length,
      critical: rows.filter((row) => row.severity === "critical").length,
      retryable: rows.filter((row) => row.retryAfterMs > 0).length,
      maintenance: rows.filter((row) => row.source === "provider-maintenance").length,
      budget: rows.filter((row) => row.source === "provider-budget").length,
      callback: rows.filter((row) => row.source === "provider-callback").length,
      eventSubscriptions: rows.filter((row) => row.source === "provider-event-subscription").length,
      permissionLeases: rows.filter((row) => row.source === "permission-lease").length,
    }),
    handoff: Object.freeze({
      state: blocked.length > 0 ? "hold-adapter" : degraded.length > 0 ? "degraded-adapter" : "ready",
      statusChannel,
      blockedActions: freezeArray(blockedActions),
      degradedActions: freezeArray(degradedActions),
      retryAfterMs,
      nextCommand: blocked[0]?.nextCommand || degraded[0]?.nextCommand || "observe",
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || degraded[0]?.nextCommand || "observe",
      retryAfterMs,
      reason: blocked.length > 0
        ? "Mailchimp provider operational state blocks adapter handoff."
        : degraded.length > 0
          ? "Mailchimp provider operational state is degraded; runtime should defer or throttle handoff."
          : "No Mailchimp provider operational incident is active.",
    }),
  });
}

function normalizeAdapterStatusState(value) {
  const state = compactString(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  if (["ok", "done", "success", "succeeded", "complete", "completed"].includes(state)) return "succeeded";
  if (["fail", "failed", "error", "errored", "rejected"].includes(state)) return "failed";
  if (["timeout", "timed-out", "expired"].includes(state)) return "timed-out";
  if (["running", "processing", "queued", "pending", "in-flight"].includes(state)) return "pending";
  if (["cancel", "cancelled", "canceled"].includes(state)) return "cancelled";
  return state || "unknown";
}

function normalizeAdapterStatusEvent(event = {}, index = 0, runtimeScope = {}, persistedRuntime = {}) {
  const capability = compactString(event.capability || event.action || event.scope);
  const stepName = compactString(event.step || event.stepName || event.command || "");
  const idempotencyKey = firstString(event.idempotencyKey, runtimeScope.idempotencyKey);
  const statusSnapshotKey = firstString(event.statusSnapshotKey, persistedRuntime.statusSnapshotKey);
  const providerRequestId = firstString(event.providerRequestId, event.requestId, event.id);
  const observedAt = firstString(event.observedAt, event.updatedAt, event.createdAt, event.timestamp);
  const state = normalizeAdapterStatusState(event.state || event.status || event.phase);

  return Object.freeze({
    index,
    capability,
    stepName,
    provider: compactString(event.provider || (capability.match(MAILCHIMP_ACTION_PATTERN) ? "mailchimp" : "")),
    state,
    statusCode: compactString(event.statusCode || event.code),
    message: compactString(event.message || event.reason || event.error),
    idempotencyKey,
    providerRequestId,
    statusChannel: firstString(event.statusChannel, runtimeScope.statusChannel),
    statusSnapshotKey,
    resumeCursor: firstString(event.resumeCursor, event.cursor),
    retryAfterMs: Number.isFinite(Number(event.retryAfterMs)) ? Number(event.retryAfterMs) : 0,
    observedAt,
    terminal: ["succeeded", "failed", "timed-out", "cancelled"].includes(state),
  });
}

function collectAdapterStatusInput(job = {}) {
  const clientState = job.clientState || job.requestState || {};
  return [
    ...toArray(job.adapterStatus),
    ...toArray(job.adapterStatuses),
    ...toArray(job.statusEvents),
    ...toArray(job.providerStatus),
    ...toArray(clientState.adapterStatus),
    ...toArray(clientState.statusEvents),
  ];
}

function createAdapterStatusLedger(job = {}, runtimeScope = {}, persistedRuntime = {}) {
  const jobName = compactString(job.name || "anonymous");
  const externalSteps = toArray(job.steps).filter((step) => {
    const adapter = compactString(step.adapter);
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString);
    return adapter.includes("mailchimp") || capabilityRefs.some((capability) => WRITE_ACTION_PATTERN.test(capability));
  });
  const expected = externalSteps.flatMap((step) => {
    const stepName = compactString(step.name || step.id || "step");
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString).filter(Boolean);
    return (capabilityRefs.length > 0 ? capabilityRefs : [`step:${stepName}`]).map((capability) => Object.freeze({
      stepName,
      capability,
      idempotencyKey: firstString(step.idempotencyKey, runtimeScope.idempotencyKey),
      statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    }));
  });
  const events = collectAdapterStatusInput(job)
    .map((event, index) => normalizeAdapterStatusEvent(event, index, runtimeScope, persistedRuntime))
    .filter((event) => event.capability || event.stepName || event.providerRequestId)
    .sort((left, right) => {
      return left.capability.localeCompare(right.capability)
        || left.stepName.localeCompare(right.stepName)
        || left.index - right.index;
    });
  const latestByCapability = new Map();
  for (const event of events) {
    const key = event.capability || `step:${event.stepName}`;
    latestByCapability.set(key, event);
  }
  const missing = expected.filter((row) => !latestByCapability.has(row.capability) && !latestByCapability.has(`step:${row.stepName}`));
  const failed = events.filter((event) => ["failed", "timed-out", "cancelled"].includes(event.state));
  const pending = events.filter((event) => event.state === "pending");
  const unknown = events.filter((event) => event.state === "unknown");

  return Object.freeze({
    protocol: "aios.scope.adapter-status-ledger.v1",
    jobName,
    statusChannel: runtimeScope.statusChannel,
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    restartToken: runtimeScope.restartToken,
    expected: freezeArray(expected),
    events: freezeArray(events),
    latestByCapability: freezeArray([...latestByCapability.entries()].map(([capability, event]) => ({
      capability,
      state: event.state,
      stepName: event.stepName,
      providerRequestId: event.providerRequestId,
      idempotencyKey: event.idempotencyKey,
      statusSnapshotKey: event.statusSnapshotKey,
      retryAfterMs: event.retryAfterMs,
      message: event.message,
    }))),
    state: failed.length > 0
      ? "failed"
      : missing.length > 0 && expected.length > 0
        ? "missing-status"
        : pending.length > 0
          ? "pending"
          : unknown.length > 0
            ? "unknown"
            : events.length > 0
              ? "settled"
              : expected.length > 0
                ? "unobserved"
                : "not-required",
    counters: Object.freeze({
      expected: expected.length,
      events: events.length,
      missing: missing.length,
      failed: failed.length,
      pending: pending.length,
      unknown: unknown.length,
      succeeded: events.filter((event) => event.state === "succeeded").length,
    }),
    missing: freezeArray(missing),
    failures: freezeArray(failed.map((event) => ({
      capability: event.capability,
      stepName: event.stepName,
      state: event.state,
      statusCode: event.statusCode,
      message: event.message,
      nextCommand: event.state === "timed-out" ? "retry_same_idempotency_key" : "inspect_adapter_failure",
    }))),
    nextCommand: failed.length > 0
      ? failed[0].state === "timed-out" ? "retry_same_idempotency_key" : "inspect_adapter_failure"
      : missing.length > 0
        ? "load_adapter_status_snapshot"
        : pending.length > 0
          ? "poll_adapter_status_channel"
          : "observe",
  });
}

function createAdapterStatusSnapshotContract(job = {}, adapterStatusLedger = {}, runtimeScope = {}, persistedRuntime = {}) {
  const jobName = compactString(job.name || adapterStatusLedger.jobName || "anonymous");
  const statusSnapshotKey = firstString(adapterStatusLedger.statusSnapshotKey, persistedRuntime.statusSnapshotKey);
  const statusChannel = firstString(adapterStatusLedger.statusChannel, runtimeScope.statusChannel);
  const restartToken = firstString(adapterStatusLedger.restartToken, runtimeScope.restartToken);
  const latest = toArray(adapterStatusLedger.latestByCapability);
  const failures = toArray(adapterStatusLedger.failures);
  const missing = toArray(adapterStatusLedger.missing);
  const externalExpected = toArray(adapterStatusLedger.expected);
  const rows = latest
    .map((row, index) => {
      const capability = compactString(row.capability || `row:${index + 1}`);
      const state = normalizeAdapterStatusState(row.state);
      const terminal = ["succeeded", "failed", "timed-out", "cancelled"].includes(state);
      const rowKey = statusSnapshotKey ? `${statusSnapshotKey}:capability:${capability}` : "";
      const rowMissing = [
        !statusSnapshotKey && "statusSnapshotKey",
        !statusChannel && "statusChannel",
        !compactString(row.idempotencyKey) && "idempotencyKey",
        !capability && "capability",
      ].filter(Boolean);

      return Object.freeze({
        index,
        capability,
        stepName: compactString(row.stepName),
        state,
        terminal,
        providerRequestId: compactString(row.providerRequestId),
        idempotencyKey: compactString(row.idempotencyKey),
        statusSnapshotKey,
        rowKey,
        retryAfterMs: Number.isFinite(Number(row.retryAfterMs)) ? Number(row.retryAfterMs) : 0,
        message: compactString(row.message),
        persisted: rowMissing.length === 0,
        missing: freezeArray(rowMissing),
        nextCommand: rowMissing.length > 0
          ? "materialize_adapter_status_snapshot"
          : terminal
            ? "persist_adapter_terminal_status"
            : state === "pending"
              ? "poll_adapter_status_channel"
              : "observe",
      });
    })
    .sort((left, right) => left.capability.localeCompare(right.capability) || left.stepName.localeCompare(right.stepName));
  const missingRows = missing.map((row, index) => Object.freeze({
    index,
    capability: compactString(row.capability),
    stepName: compactString(row.stepName),
    state: "missing",
    idempotencyKey: compactString(row.idempotencyKey),
    statusSnapshotKey: compactString(row.statusSnapshotKey || statusSnapshotKey),
    rowKey: statusSnapshotKey ? `${statusSnapshotKey}:capability:${compactString(row.capability || row.stepName || `missing:${index + 1}`)}` : "",
    persisted: false,
    missing: freezeArray([
      !statusSnapshotKey && "statusSnapshotKey",
      !compactString(row.idempotencyKey) && "idempotencyKey",
      "adapterStatusEvent",
    ].filter(Boolean)),
    nextCommand: "load_adapter_status_snapshot",
  }));
  const blockedRows = [...rows, ...missingRows].filter((row) => row.persisted === false || row.missing.length > 0);
  const failedRows = rows.filter((row) => ["failed", "timed-out", "cancelled"].includes(row.state));
  const pendingRows = rows.filter((row) => row.state === "pending");

  return Object.freeze({
    protocol: "aios.scope.adapter-status-snapshot.v1",
    jobName,
    state: failures.length > 0 || failedRows.length > 0
      ? "terminal-failure"
      : blockedRows.length > 0
        ? "materialization-blocked"
        : pendingRows.length > 0
          ? "pending"
          : rows.length > 0
            ? "materialized"
            : externalExpected.length > 0
              ? "empty-required"
              : "not-required",
    acceptedForReplay: blockedRows.length === 0 && failures.length === 0,
    acceptedForAdapter: blockedRows.length === 0 && failures.length === 0 && pendingRows.length === 0,
    statusSnapshotKey,
    statusChannel,
    restartToken,
    rows: freezeArray(rows),
    missingRows: freezeArray(missingRows),
    blockedRows: freezeArray(blockedRows.map((row) => ({
      capability: row.capability,
      stepName: row.stepName,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }))),
    counters: Object.freeze({
      expected: externalExpected.length,
      rows: rows.length,
      materialized: rows.filter((row) => row.persisted).length,
      missingRows: missingRows.length,
      blockedRows: blockedRows.length,
      failedRows: failedRows.length,
      pendingRows: pendingRows.length,
    }),
    nextCommand: failedRows[0]?.nextCommand
      || blockedRows[0]?.nextCommand
      || pendingRows[0]?.nextCommand
      || "observe",
  });
}

function createOperationIdentityIndex(job = {}, runtimeScope = {}, persistedRuntime = {}, permissionBoundary = {}, adapterStatusLedger = {}, providerSyncContract = {}) {
  const jobName = compactString(job.name || "anonymous");
  const restartToken = compactString(runtimeScope.restartToken);
  const statusChannel = compactString(runtimeScope.statusChannel);
  const statusSnapshotKey = compactString(persistedRuntime.statusSnapshotKey);
  const commandKey = compactString(persistedRuntime.commandLedgerKey);
  const commandRows = toArray(persistedRuntime.commands);
  const statusRows = toArray(adapterStatusLedger.latestByCapability);
  const syncRows = toArray(providerSyncContract.rows);
  const boundaryRows = toArray(permissionBoundary.capabilities);
  const stepByCapability = new Map();

  for (const step of toArray(job.steps)) {
    const stepName = compactString(step.name || step.id || "step");
    for (const capability of toArray(step.capability || step.capabilities || step.requiresCapability)) {
      const action = compactString(capability);
      if (!action) continue;
      const current = stepByCapability.get(action) || [];
      current.push(Object.freeze({
        stepName,
        adapter: compactString(step.adapter || "runtime"),
        explicitIdempotencyKey: compactString(step.idempotencyKey),
      }));
      stepByCapability.set(action, current);
    }
  }

  const rows = toArray(job.capabilities)
    .map((capability, index) => {
      const action = compactString(capability.name || capability.scope || `capability:${index + 1}`);
      const provider = inferCapabilityProvider(capability);
      if (provider !== "mailchimp") return null;

      const boundary = boundaryRows.find((row) => row.action === action) || {};
      const sync = syncRows.find((row) => row.action === action) || {};
      const status = statusRows.find((row) => row.capability === action) || {};
      const steps = stepByCapability.get(action) || [];
      const primaryStep = steps[0] || {};
      const writeBoundary = WRITE_ACTION_PATTERN.test(action) || boundary.writeBoundary === true || compactString(capability.boundary) === "external";
      const resources = toArray(sync.resources).map((resource) => resource.stableRef || `${resource.type}:${resource.id || "pending"}`);
      const idempotencyKey = firstString(
        capability.idempotencyKey,
        primaryStep.explicitIdempotencyKey,
        boundary.idempotencyKey,
        status.idempotencyKey,
        runtimeScope.idempotencyKey
      );
      const resumeCommand = commandRows.find((command) => {
        return command.capability === action
          || steps.some((step) => step.stepName && command.command === normalizeCommandName(`resume_${step.stepName}`));
      });
      const operationId = stableToken("op", [
        restartToken,
        jobName,
        action,
        stableFingerprint(steps.map((step) => step.stepName)),
        stableFingerprint(resources),
      ]);
      const missing = [
        !restartToken && "restartToken",
        writeBoundary && !idempotencyKey && "idempotencyKey",
        writeBoundary && !statusChannel && "statusChannel",
        writeBoundary && !statusSnapshotKey && "statusSnapshotKey",
        writeBoundary && !resumeCommand?.commandId && "restartCommand",
        sync.writeBoundary && !sync.checkpointKey && "checkpointKey",
        boundary.leaseRequired && boundary.leaseRecovery?.ready === false && "permissionLease",
      ].filter(Boolean);

      return Object.freeze({
        operationId,
        operationKey: restartToken ? `${restartToken}:operation:${action}` : "",
        action,
        provider,
        jobName,
        stepNames: freezeArray(steps.map((step) => step.stepName).filter(Boolean).sort()),
        writeBoundary,
        state: missing.length > 0
          ? "blocked"
          : status.state === "pending"
            ? "waiting-adapter-status"
            : status.state && status.state !== "succeeded"
              ? "status-observed"
              : "restart-safe",
        restartToken,
        commandKey,
        commandId: compactString(resumeCommand?.commandId),
        idempotencyKey,
        statusChannel,
        statusSnapshotKey,
        checkpointKey: compactString(sync.checkpointKey),
        watermarkKey: compactString(sync.watermarkKey),
        providerRequestId: compactString(status.providerRequestId),
        permissionLeaseToken: compactString(boundary.permissionLease?.token),
        permissionLeaseState: compactString(boundary.leaseRecovery?.state || (boundary.leaseRequired ? "ready" : "not-required")),
        missing: freezeArray(missing),
        nextCommand: missing.includes("permissionLease")
          ? boundary.leaseRecovery?.nextCommand || "refresh_mailchimp_permission_lease"
          : missing.includes("checkpointKey")
            ? sync.nextCommand || "repair_provider_sync_scope"
            : missing.length > 0
              ? "attach_recovery_status_handoff"
              : status.state === "pending"
                ? "poll_adapter_status_channel"
                : "observe",
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.action.localeCompare(right.action));
  const blocked = rows.filter((row) => row.state === "blocked");
  const waiting = rows.filter((row) => row.state === "waiting-adapter-status");

  return Object.freeze({
    protocol: "aios.scope.operation-identity-index.v1",
    jobName,
    state: blocked.length > 0 ? "blocked" : waiting.length > 0 ? "waiting" : rows.length > 0 ? "ready" : "not-required",
    acceptedForReplay: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && rows.length > 0,
    restartToken,
    commandKey,
    statusChannel,
    statusSnapshotKey,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked.map((row) => ({
      operationId: row.operationId,
      action: row.action,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      waiting: waiting.length,
      restartSafe: rows.filter((row) => row.state === "restart-safe").length,
      missingIdempotency: blocked.filter((row) => row.missing.includes("idempotencyKey")).length,
      missingStatusSnapshot: blocked.filter((row) => row.missing.includes("statusSnapshotKey")).length,
    }),
    nextCommand: blocked[0]?.nextCommand || waiting[0]?.nextCommand || "observe",
  });
}

function createRecoveryCheckpointManifest(job = {}, runtimeScope = {}, persistedRuntime = {}, adapterStatusSnapshot = {}, operationIdentity = {}, recoveryPlan = {}) {
  const jobName = compactString(job.name || "anonymous");
  const restartToken = firstString(runtimeScope.restartToken, persistedRuntime.restartToken);
  const commandLedgerKey = firstString(persistedRuntime.commandLedgerKey, recoveryPlan.persistedRecoveryLedger?.commandLedgerKey);
  const statusSnapshotKey = firstString(persistedRuntime.statusSnapshotKey, adapterStatusSnapshot.statusSnapshotKey);
  const statusChannel = firstString(runtimeScope.statusChannel, recoveryPlan.statusChannel);
  const recoveryCommands = toArray(recoveryPlan.persistedRecoveryLedger?.commands);
  const operationRows = toArray(operationIdentity.rows);
  const snapshotRows = [
    ...toArray(adapterStatusSnapshot.rows),
    ...toArray(adapterStatusSnapshot.missingRows),
  ];
  const commandByCapability = new Map();
  const snapshotByCapability = new Map();

  for (const command of recoveryCommands) {
    const capability = compactString(command.capability);
    if (capability && !commandByCapability.has(capability)) commandByCapability.set(capability, command);
  }
  for (const row of snapshotRows) {
    const capability = compactString(row.capability);
    if (capability && !snapshotByCapability.has(capability)) snapshotByCapability.set(capability, row);
  }

  const rows = operationRows.map((operation, index) => {
    const action = compactString(operation.action || `operation:${index + 1}`);
    const command = commandByCapability.get(action) || recoveryCommands.find((candidate) => {
      return toArray(operation.stepNames).some((stepName) => compactString(candidate.stepName) === compactString(stepName));
    }) || null;
    const snapshot = snapshotByCapability.get(action) || snapshotRows.find((candidate) => {
      return toArray(operation.stepNames).some((stepName) => compactString(candidate.stepName) === compactString(stepName));
    }) || null;
    const writeBoundary = operation.writeBoundary === true;
    const idempotencyKey = firstString(operation.idempotencyKey, command?.idempotencyKey, snapshot?.idempotencyKey, runtimeScope.idempotencyKey);
    const missing = [
      !restartToken && "restartToken",
      !commandLedgerKey && "commandLedgerKey",
      writeBoundary && !idempotencyKey && "idempotencyKey",
      writeBoundary && !statusChannel && "statusChannel",
      writeBoundary && !statusSnapshotKey && "statusSnapshotKey",
      writeBoundary && !command?.commandId && "recoveryCommand",
      writeBoundary && !snapshot?.rowKey && "statusSnapshotRow",
      operation.state === "blocked" && "operationIdentity",
      command?.state === "blocked" && "recoveryCommandBlocked",
      snapshot?.persisted === false && "statusSnapshotMaterialization",
    ].filter(Boolean);
    const replayKey = stableToken("checkpoint-replay", [
      restartToken,
      statusSnapshotKey,
      action,
      command?.commandId,
      snapshot?.rowKey,
    ]);

    return Object.freeze({
      rowId: stableToken("checkpoint", [restartToken, jobName, action]),
      replayKey,
      jobName,
      action,
      provider: compactString(operation.provider || "mailchimp"),
      operationId: compactString(operation.operationId),
      commandId: compactString(command?.commandId),
      command: compactString(command?.command || operation.nextCommand || "observe"),
      stepNames: freezeArray(toArray(operation.stepNames).map(compactString).filter(Boolean).sort()),
      state: missing.length > 0
        ? "blocked"
        : snapshot?.state === "pending" || operation.state === "waiting-adapter-status"
          ? "waiting-adapter"
          : writeBoundary
            ? "replayable"
            : "observed",
      restartToken,
      commandLedgerKey,
      statusChannel,
      statusSnapshotKey,
      statusSnapshotRowKey: compactString(snapshot?.rowKey),
      providerRequestId: compactString(snapshot?.providerRequestId),
      idempotencyKey,
      permissionLeaseToken: compactString(operation.permissionLeaseToken),
      missing: freezeArray([...new Set(missing)].sort()),
      safeToReplay: missing.length === 0 && (!writeBoundary || Boolean(idempotencyKey && statusSnapshotKey && command?.commandId)),
      nextCommand: missing.includes("statusSnapshotMaterialization") || missing.includes("statusSnapshotRow")
        ? snapshot?.nextCommand || "materialize_adapter_status_snapshot"
        : missing.includes("recoveryCommand") || missing.includes("recoveryCommandBlocked")
          ? command?.nextCommand || "repair_restart_command_ledger"
          : missing.length > 0
            ? operation.nextCommand || "attach_recovery_status_handoff"
            : snapshot?.state === "pending"
              ? "poll_adapter_status_channel"
              : "resume_adapter_step",
    });
  }).sort((left, right) => left.action.localeCompare(right.action) || left.rowId.localeCompare(right.rowId));
  const blocked = rows.filter((row) => row.state === "blocked");
  const waiting = rows.filter((row) => row.state === "waiting-adapter");
  const replayable = rows.filter((row) => row.safeToReplay);

  return Object.freeze({
    protocol: "aios.scope.recovery-checkpoint-manifest.v1",
    jobName,
    state: blocked.length > 0 ? "blocked" : waiting.length > 0 ? "waiting" : rows.length > 0 ? "ready" : "not-required",
    acceptedForRestart: blocked.length === 0,
    acceptedForAdapterReplay: blocked.length === 0 && waiting.length === 0,
    restartToken,
    commandLedgerKey,
    statusChannel,
    statusSnapshotKey,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    waitingRows: freezeArray(waiting),
    replayableRows: freezeArray(replayable),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      waiting: waiting.length,
      replayable: replayable.length,
      missingStatusSnapshots: blocked.filter((row) => row.missing.includes("statusSnapshotRow") || row.missing.includes("statusSnapshotKey")).length,
      missingRecoveryCommands: blocked.filter((row) => row.missing.includes("recoveryCommand") || row.missing.includes("commandLedgerKey")).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || waiting[0]?.nextCommand || replayable[0]?.nextCommand || "observe",
      reason: blocked.length > 0
        ? "Recovery checkpoints are missing persisted command or status snapshot state."
        : waiting.length > 0
          ? "Recovery checkpoints are waiting on adapter status before replay."
          : rows.length > 0
            ? "Recovery checkpoints are restart-safe and replayable."
            : "No provider recovery checkpoints are required.",
    }),
  });
}

function createScopeActionableError(code, message, nextCommand, context = {}) {
  return Object.freeze({
    code,
    message,
    nextCommand,
    ...context,
  });
}

function createPersistedRecoveryCommandLedger(job = {}, runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}, adapterStatusSnapshot = {}) {
  const jobName = compactString(job.name || "anonymous");
  const restartToken = compactString(runtimeScope.restartToken || persistedRuntime.restartToken);
  const commandLedgerKey = compactString(persistedRuntime.commandLedgerKey || (restartToken ? `${restartToken}:commands` : ""));
  const statusSnapshotKey = compactString(persistedRuntime.statusSnapshotKey || adapterStatusSnapshot.statusSnapshotKey);
  const rows = [];
  const pushCommand = (row = {}) => {
    const command = normalizeCommandName(row.command || row.nextCommand, "observe");
    if (!command || command === "observe") return;
    const phase = compactString(row.phase || "recover");
    const capability = compactString(row.capability || row.action);
    const stepName = compactString(row.stepName || row.step);
    const blockedBy = toArray(row.blockedBy || row.missing).map(compactString).filter(Boolean).sort();
    const idempotencyKey = firstString(row.idempotencyKey, runtimeScope.idempotencyKey);
    const statusChannel = firstString(row.statusChannel, runtimeScope.statusChannel);
    const commandId = firstString(row.commandId, stableToken("recovery-command", [
      restartToken,
      commandLedgerKey,
      phase,
      command,
      capability,
      stepName,
      idempotencyKey,
    ]));
    const replayKey = stableToken("replay", [
      restartToken,
      statusSnapshotKey,
      commandId,
      capability,
      stepName,
    ]);
    const dedupeKey = stableFingerprint([
      phase,
      command,
      capability,
      stepName,
      compactString(row.reason),
      ...blockedBy,
    ]);
    if (rows.some((existing) => existing.dedupeKey === dedupeKey)) return;
    const blocking = row.blocking === true || row.state === "blocked" || blockedBy.length > 0;
    const missing = [
      !restartToken && "restartToken",
      !commandLedgerKey && "commandLedgerKey",
      row.requiresStatus !== false && !statusChannel && "statusChannel",
      row.requiresSnapshot === true && !statusSnapshotKey && "statusSnapshotKey",
      row.requiresIdempotency === true && !idempotencyKey && "idempotencyKey",
    ].filter(Boolean);
    const state = missing.length > 0 || blocking
      ? "blocked"
      : compactString(row.state) === "waiting"
        ? "waiting"
        : "ready";

    rows.push(Object.freeze({
      dedupeKey,
      commandId,
      replayKey,
      command,
      phase,
      jobName,
      capability,
      stepName,
      state,
      blocking: state === "blocked",
      reason: compactString(row.reason || "Persisted recovery command is required before Mailchimp adapter handoff."),
      nextCommand: compactString(row.nextCommand || command),
      retryAfterMs: positiveInteger(row.retryAfterMs, 0),
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : state === "blocked" ? 10 : 1,
      restartToken,
      commandLedgerKey,
      statusChannel,
      statusSnapshotKey,
      idempotencyKey,
      blockedBy: freezeArray([...new Set([...blockedBy, ...missing.map((item) => `missing:${item}`)])]),
      replayPolicy: compactString(row.replayPolicy || (idempotencyKey ? "dedupe-by-idempotency-key" : "dedupe-by-command-id")),
      safeToReplay: state !== "blocked" && (row.externalWrite !== true || Boolean(idempotencyKey && statusSnapshotKey)),
      source: compactString(row.source || "scope-recovery"),
    }));
  };

  for (const capability of toArray(permissionBoundary.heldCapabilities)) {
    const reasons = toArray(capability.reasons).map(compactString);
    if (reasons.some((reason) => reason.includes("permission-lease"))) {
      pushCommand({
        command: capability.leaseRecovery?.nextCommand || "refresh_mailchimp_permission_lease",
        phase: "permission-lease",
        capability: capability.action,
        state: "blocked",
        blocking: true,
        priority: 14,
        reason: `Permission lease for "${capability.action}" must be refreshed before adapter handoff.`,
        retryAfterMs: capability.leaseRecovery?.retryAfterMs ?? capability.permissionLease?.retryAfterMs ?? 1000,
        blockedBy: reasons.filter((reason) => reason.includes("lease")),
        requiresSnapshot: false,
        requiresIdempotency: false,
      });
    }
    if (reasons.includes("missing-idempotency-key") || reasons.includes("missing-status-channel")) {
      pushCommand({
        command: "attach_recovery_status_handoff",
        phase: "runtime-handoff",
        capability: capability.action,
        state: "blocked",
        blocking: true,
        priority: 13,
        reason: `Capability "${capability.action}" needs idempotency and status channel state before replay.`,
        blockedBy: reasons.filter((reason) => reason === "missing-idempotency-key" || reason === "missing-status-channel"),
        requiresSnapshot: capability.writeBoundary === true,
        requiresIdempotency: capability.writeBoundary === true,
      });
    }
    if (reasons.some((reason) => reason.startsWith("missing-permission:"))) {
      pushCommand({
        command: "grant_mailchimp_permission",
        phase: "permission-grant",
        capability: capability.action,
        state: "blocked",
        blocking: true,
        priority: 12,
        reason: `Capability "${capability.action}" is missing required Mailchimp permission "${capability.requiredPermission}".`,
        blockedBy: reasons.filter((reason) => reason.startsWith("missing-permission:")),
        requiresSnapshot: false,
        requiresIdempotency: false,
      });
    }
  }

  for (const segment of toArray(persistedRuntime.replaySegments)) {
    const stepName = compactString(segment.stepName || segment.step);
    pushCommand({
      command: segment.nextCommand || (segment.blocking ? "repair_restart_command_ledger" : "resume_adapter_step"),
      commandId: segment.commandId,
      phase: compactString(segment.phase || "resume"),
      capability: segment.capability,
      stepName,
      state: segment.blocking ? "blocked" : "ready",
      blocking: segment.blocking === true,
      priority: segment.blocking ? 11 : 3,
      reason: segment.blocking
        ? `Replay segment "${segment.segmentId || stepName || segment.capability}" is missing persisted recovery state.`
        : `Replay segment "${segment.segmentId || stepName || segment.capability}" can resume from persisted state.`,
      blockedBy: segment.missing,
      idempotencyKey: segment.idempotencyKey,
      requiresSnapshot: true,
      requiresIdempotency: true,
      externalWrite: true,
      source: "persisted-replay-segment",
    });
  }

  for (const row of toArray(adapterStatusSnapshot.blockedRows)) {
    pushCommand({
      command: row.nextCommand || adapterStatusSnapshot.nextCommand || "materialize_adapter_status_snapshot",
      phase: "status-snapshot",
      capability: row.capability,
      stepName: row.stepName,
      state: "blocked",
      blocking: true,
      priority: 11,
      reason: "Adapter status snapshot row must be materialized before restart-safe replay.",
      blockedBy: toArray(row.missing).map((missing) => `missing:${missing}`),
      idempotencyKey: row.idempotencyKey,
      requiresSnapshot: false,
      requiresIdempotency: false,
      source: "adapter-status-snapshot",
    });
  }

  const commands = rows
    .sort((left, right) => {
      if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;
      if (left.priority !== right.priority) return right.priority - left.priority;
      return left.command.localeCompare(right.command) || left.capability.localeCompare(right.capability) || left.stepName.localeCompare(right.stepName);
    })
    .map(({ dedupeKey, ...row }) => Object.freeze(row));
  const blocked = commands.filter((command) => command.state === "blocked");
  const waiting = commands.filter((command) => command.state === "waiting");
  const ready = commands.filter((command) => command.state === "ready");
  const replayable = commands.filter((command) => command.safeToReplay);

  return Object.freeze({
    protocol: "aios.scope.persisted-recovery-command-ledger.v1",
    jobName,
    state: blocked.length > 0
      ? "blocked"
      : waiting.length > 0
        ? "waiting"
        : commands.length > 0
          ? "ready"
          : "not-required",
    acceptedForReplay: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && waiting.length === 0,
    restartToken,
    commandLedgerKey,
    statusChannel: compactString(runtimeScope.statusChannel),
    statusSnapshotKey,
    commands: freezeArray(commands),
    blockedCommands: freezeArray(blocked),
    readyCommands: freezeArray(ready),
    waitingCommands: freezeArray(waiting),
    replayableCommands: freezeArray(replayable),
    counters: Object.freeze({
      commands: commands.length,
      blocked: blocked.length,
      waiting: waiting.length,
      ready: ready.length,
      replayable: replayable.length,
      missingState: blocked.filter((command) => command.blockedBy.some((reason) => reason.startsWith("missing:"))).length,
      permissionLeaseRefresh: commands.filter((command) => command.phase === "permission-lease").length,
    }),
    nextCommand: blocked[0]?.nextCommand || waiting[0]?.nextCommand || ready[0]?.nextCommand || "observe",
  });
}

function createScopeRecoveryPlan(job = {}, runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}, adapterStatusSnapshot = {}) {
  const jobName = compactString(job.name || "anonymous");
  const persistedRecoveryLedger = createPersistedRecoveryCommandLedger(job, runtimeScope, permissionBoundary, persistedRuntime, adapterStatusSnapshot);
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const runtimeDiagnostics = toArray(runtimeScope.diagnostics);
  const missingIdentity = heldCapabilities.filter((capability) => {
    const reasons = toArray(capability.reasons).map(compactString);
    return reasons.includes("missing-tenant") || reasons.includes("missing-workspace") || reasons.includes("missing-actor");
  });
  const missingPermissions = heldCapabilities.filter((capability) => {
    return toArray(capability.reasons).some((reason) => compactString(reason).startsWith("missing-permission:"));
  });
  const missingHandoff = heldCapabilities.filter((capability) => {
    const reasons = toArray(capability.reasons).map(compactString);
    return reasons.includes("missing-idempotency-key") || reasons.includes("missing-status-channel");
  });
  const leaseHolds = heldCapabilities.filter((capability) => {
    const reasons = toArray(capability.reasons).map(compactString);
    return reasons.includes("missing-permission-lease")
      || reasons.includes("permission-lease-scope-mismatch")
      || reasons.includes("permission-lease-inactive")
      || reasons.includes("permission-lease-expired")
      || reasons.includes("missing-permission-lease-expiry");
  });
  const restartBlocked = persistedRuntime.restartSafe === false;
  const blockedReplaySegments = toArray(persistedRuntime.replaySegments).filter((segment) => segment.blocking);
  const blockedSnapshotRows = toArray(adapterStatusSnapshot.blockedRows);
  const actionableErrors = [
    missingIdentity.length > 0 && createScopeActionableError(
      "aios.scope.mailchimp_identity_missing",
      `Job "${jobName}" needs tenant, workspace, and actor state before Mailchimp adapter handoff.`,
      "attach_client_runtime_request",
      {
        jobName,
        heldActions: freezeArray(missingIdentity.map((capability) => capability.action)),
      }
    ),
    missingPermissions.length > 0 && createScopeActionableError(
      "aios.scope.mailchimp_permission_missing",
      `Job "${jobName}" has Mailchimp capabilities held by missing permission grants.`,
      "grant_mailchimp_permission",
      {
        jobName,
        requiredPermissions: freezeArray([...new Set(missingPermissions.map((capability) => capability.requiredPermission).filter(Boolean))]),
        heldActions: freezeArray(missingPermissions.map((capability) => capability.action)),
      }
    ),
    missingHandoff.length > 0 && createScopeActionableError(
      "aios.scope.mailchimp_status_handoff_missing",
      `Job "${jobName}" needs idempotency and status-channel state for restart-safe Mailchimp writes.`,
      "attach_recovery_status_handoff",
      {
        jobName,
        heldActions: freezeArray(missingHandoff.map((capability) => capability.action)),
      }
    ),
    leaseHolds.length > 0 && createScopeActionableError(
      "aios.scope.mailchimp_permission_lease_invalid",
      `Job "${jobName}" needs active workspace-scoped Mailchimp permission leases before adapter handoff.`,
      "refresh_mailchimp_permission_lease",
      {
        jobName,
        heldActions: freezeArray(leaseHolds.map((capability) => capability.action)),
        leaseTokens: freezeArray(leaseHolds.map((capability) => capability.permissionLease?.token).filter(Boolean)),
        reasons: freezeArray([...new Set(leaseHolds.flatMap((capability) => toArray(capability.reasons)).filter((reason) => compactString(reason).includes("lease")))]),
      }
    ),
    restartBlocked && createScopeActionableError(
      "aios.scope.restart_replay_blocked",
      `Job "${jobName}" cannot replay all external-write commands deterministically.`,
      "repair_restart_command_ledger",
      {
        jobName,
        commandLedgerKey: persistedRuntime.commandLedgerKey || "",
        blockedSegments: freezeArray(blockedReplaySegments.map((segment) => segment.segmentId)),
      }
    ),
    blockedSnapshotRows.length > 0 && createScopeActionableError(
      "aios.scope.adapter_status_snapshot_blocked",
      `Job "${jobName}" needs materialized adapter status snapshot rows before restart-safe replay.`,
      adapterStatusSnapshot.nextCommand || "materialize_adapter_status_snapshot",
      {
        jobName,
        statusSnapshotKey: adapterStatusSnapshot.statusSnapshotKey || "",
        blockedRows: freezeArray(blockedSnapshotRows),
      }
    ),
  ].filter(Boolean);
  const warnings = runtimeDiagnostics.filter((diagnostic) => diagnostic.level === "warning");
  const externalCommands = toArray(persistedRuntime.commands)
    .filter((command) => ["dedupe", "resume", "verify"].includes(compactString(command.phase)));
  const degradedMode = actionableErrors.length > 0
    ? "blocked"
    : warnings.length > 0 || permissionBoundary.status === "held"
      ? "preview-only"
      : "none";

  return Object.freeze({
    protocol: "aios.scope.recovery-plan.v1",
    jobName,
    state: actionableErrors.length > 0
      ? "blocked"
      : degradedMode === "preview-only"
        ? "degraded"
        : runtimeScope.requiresClientState || runtimeScope.requiresIdempotency
          ? "handoff-ready"
          : "local",
    degradedMode,
    acceptedForAdapter: actionableErrors.length === 0 && permissionBoundary.auditHandoff?.acceptedForAdapter !== false,
    acceptedForPreview: true,
    statusChannel: runtimeScope.statusChannel,
    restartToken: runtimeScope.restartToken,
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    persistedRecoveryLedger,
    actionableErrors: freezeArray(actionableErrors),
    retryBackoff: Object.freeze({
      strategy: externalCommands.length > 0 && actionableErrors.length === 0 ? "resume-before-retry" : "manual-resolution",
      baseDelayMs: externalCommands.some((command) => compactString(command.phase) === "resume") ? 5000 : 1000,
      maxDelayMs: externalCommands.length > 0 ? 30000 : 0,
      retryableCommands: freezeArray(externalCommands.map((command) => command.command)),
    }),
    nextCommand: actionableErrors[0]?.nextCommand
      || (degradedMode === "preview-only" ? "continue_preview_and_resolve_warnings" : "observe"),
    failureState: Object.freeze({
      missingIdentity: missingIdentity.length,
      missingPermissions: missingPermissions.length,
      missingHandoff: missingHandoff.length,
      permissionLeaseHolds: leaseHolds.length,
      restartBlocked,
      blockedReplaySegments: blockedReplaySegments.length,
      adapterStatusSnapshotRows: adapterStatusSnapshot.counters?.rows ?? 0,
      adapterStatusSnapshotBlocked: blockedSnapshotRows.length,
      persistedRecoveryCommands: persistedRecoveryLedger.counters.commands,
      blockedRecoveryCommands: persistedRecoveryLedger.counters.blocked,
      replayableRecoveryCommands: persistedRecoveryLedger.counters.replayable,
      warnings: warnings.length,
    }),
  });
}

function createClientWorkflowHandoff(job = {}, runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}, adapterStatusLedger = {}, recoveryPlan = {}) {
  const jobName = compactString(job.name || "anonymous");
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const statusFailures = toArray(adapterStatusLedger.failures);
  const statusMissing = toArray(adapterStatusLedger.missing);
  const commands = [];
  const pushCommand = (command, phase, state, reason, extra = {}) => {
    const normalized = normalizeCommandName(command, phase);
    const blocking = state === "blocked" || state === "needs-input";
    commands.push(Object.freeze({
      command: normalized,
      commandId: stableToken("workflow", [
        runtimeScope.restartToken,
        persistedRuntime.commandLedgerKey,
        phase,
        normalized,
        extra.capability || extra.stepName || jobName,
      ]),
      phase,
      state,
      reason,
      jobName,
      capability: compactString(extra.capability),
      stepName: compactString(extra.stepName),
      tenantId: runtimeScope.tenantId,
      workspaceId: runtimeScope.workspaceId,
      requestId: runtimeScope.requestId,
      statusChannel: runtimeScope.statusChannel,
      statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
      restartToken: runtimeScope.restartToken,
      idempotencyKey: compactString(extra.idempotencyKey || runtimeScope.idempotencyKey),
      nextCommand: compactString(extra.nextCommand || normalized),
      replayPolicy: compactString(extra.replayPolicy || "dedupe-by-command-id"),
      userVisible: Object.freeze({
        label: compactString(extra.label || normalized.replace(/_/g, " ")),
        blocking,
        handoff: compactString(extra.handoff || (phase === "adapter" ? "adapter" : "runtime")),
      }),
    }));
  };

  if (runtimeScope.requiresClientState && (!runtimeScope.tenantId || !runtimeScope.workspaceId || !permissionBoundary.actorId)) {
    pushCommand(
      "attach_client_runtime_request",
      "identity",
      "needs-input",
      "Tenant, workspace, and actor state are required before Mailchimp adapter handoff.",
      { label: "Attach runtime identity", replayPolicy: "replace-client-state" }
    );
  }

  for (const capability of heldCapabilities) {
    const reasons = toArray(capability.reasons).map(compactString);
    const missingPermission = reasons.find((reason) => reason.startsWith("missing-permission:"));
    const leaseReason = reasons.find((reason) => reason.includes("permission-lease"));
    pushCommand(
      leaseReason ? "refresh_mailchimp_permission_lease" : missingPermission ? "grant_mailchimp_permission" : "resolve_boundary_hold",
      "boundary",
      "blocked",
      leaseReason || missingPermission || reasons[0] || "Mailchimp capability boundary is held.",
      {
        capability: capability.action,
        label: leaseReason ? `Refresh lease for ${capability.action}` : missingPermission ? `Grant ${capability.requiredPermission}` : `Resolve ${capability.action}`,
        nextCommand: leaseReason ? "refresh_mailchimp_permission_lease" : missingPermission ? "grant_mailchimp_permission" : "resolve_boundary_hold",
        replayPolicy: "manual-resolution",
      }
    );
  }

  if (runtimeScope.requiresIdempotency && !runtimeScope.idempotencyKey) {
    pushCommand(
      "attach_recovery_status_handoff",
      "recovery",
      "blocked",
      "External Mailchimp writes require a stable idempotency key before replay.",
      { label: "Attach idempotency key", replayPolicy: "replace-client-state" }
    );
  }

  if (runtimeScope.requiresClientState && !runtimeScope.statusChannel) {
    pushCommand(
      "attach_recovery_status_handoff",
      "recovery",
      "blocked",
      "Mailchimp adapter handoff requires a client-visible status channel.",
      { label: "Attach status channel", replayPolicy: "replace-client-state" }
    );
  }

  for (const failure of statusFailures) {
    pushCommand(
      failure.nextCommand || "inspect_adapter_failure",
      "adapter-status",
      "blocked",
      failure.message || failure.state || "Adapter status is terminal.",
      {
        capability: failure.capability,
        stepName: failure.stepName,
        label: `Inspect ${failure.capability || failure.stepName}`,
        replayPolicy: failure.state === "timed-out" ? "retry-same-idempotency-key" : "manual-resolution",
      }
    );
  }

  for (const missing of statusMissing) {
    pushCommand(
      "load_adapter_status_snapshot",
      "adapter-status",
      "needs-input",
      "Adapter status snapshot must be loaded before replay-safe handoff.",
      {
        capability: missing.capability,
        stepName: missing.stepName,
        label: `Load status for ${missing.capability || missing.stepName}`,
        replayPolicy: "load-before-retry",
      }
    );
  }

  if (persistedRuntime.restartSafe === false) {
    pushCommand(
      "repair_restart_command_ledger",
      "restart",
      "blocked",
      "Restart command ledger is not replay-safe for all external writes.",
      { label: "Repair restart commands", replayPolicy: "manual-resolution" }
    );
  }

  const adapterReady = recoveryPlan.acceptedForAdapter === true
    && permissionBoundary.status !== "held"
    && persistedRuntime.restartSafe === true
    && statusFailures.length === 0
    && statusMissing.length === 0;
  if (adapterReady && runtimeScope.requiresClientState) {
    pushCommand(
      "queue_scope_runtime_handoff",
      "adapter",
      "ready",
      "Scope, identity, permissions, and restart metadata are ready for Mailchimp adapter handoff.",
      {
        label: "Queue Mailchimp handoff",
        handoff: "adapter",
        replayPolicy: "resume-before-retry",
      }
    );
  } else if (commands.length === 0) {
    pushCommand(
      "start_runtime",
      "runtime",
      "ready",
      "Scope contracts are ready for local runtime execution.",
      { label: "Start runtime", handoff: "runtime", replayPolicy: "not-required" }
    );
  }

  const sorted = commands.sort((left, right) => {
    return left.phase.localeCompare(right.phase)
      || left.state.localeCompare(right.state)
      || left.command.localeCompare(right.command)
      || left.capability.localeCompare(right.capability);
  });
  const blocked = sorted.filter((command) => command.userVisible.blocking);
  const ready = sorted.filter((command) => command.state === "ready");

  return Object.freeze({
    protocol: "aios.scope.client-workflow-handoff.v1",
    jobName,
    state: blocked.length > 0 ? "blocked" : ready.some((command) => command.phase === "adapter") ? "adapter-ready" : "runtime-ready",
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && ready.some((command) => command.phase === "adapter"),
    commandKey: persistedRuntime.commandLedgerKey || "",
    statusChannel: runtimeScope.statusChannel,
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    restartToken: runtimeScope.restartToken,
    commands: freezeArray(sorted),
    blockedCommands: freezeArray(blocked),
    readyCommands: freezeArray(ready),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || ready[0]?.nextCommand || recoveryPlan.nextCommand || "observe",
      reason: blocked[0]?.reason
        || ready[0]?.reason
        || "Client workflow handoff is waiting for semantic recovery state.",
    }),
  });
}

function createScopeHistorySnapshot(job = {}, declarations = [], references = [], runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}, recoveryPlan = {}, diagnostics = [], adapterStatusLedger = {}, providerSyncContract = {}, segmentSyncReceipts = {}, providerBudget = {}, providerCallback = {}, adapterStatusSnapshot = {}, providerMaintenance = {}, permissionPosture = {}) {
  const jobName = compactString(job.name || "anonymous");
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const warnings = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning");
  const unresolved = references.filter((reference) => reference.resolved === false);
  const externalCommands = toArray(persistedRuntime.commands)
    .filter((command) => ["dedupe", "resume", "verify"].includes(compactString(command.phase)));
  const replaySegments = toArray(persistedRuntime.replaySegments);
  const blockedReplaySegments = replaySegments.filter((segment) => segment.blocking);
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const leaseHolds = heldCapabilities.filter((capability) => toArray(capability.reasons).some((reason) => compactString(reason).includes("permission-lease")));
  const providerSyncRows = toArray(providerSyncContract.rows);
  const providerSyncBlocked = toArray(providerSyncContract.blockedRows);
  const segmentReceiptRows = toArray(segmentSyncReceipts.rows);
  const segmentReceiptBlocked = toArray(segmentSyncReceipts.blockedRows);
  const segmentReceiptPending = toArray(segmentSyncReceipts.pendingRows);
  const providerBudgetRows = toArray(providerBudget.rows);
  const providerBudgetBlocked = toArray(providerBudget.blockedRows);
  const providerBudgetDegraded = toArray(providerBudget.degradedRows);
  const providerCallbackRows = toArray(providerCallback.rows);
  const providerCallbackBlocked = toArray(providerCallback.blockedRows);
  const providerCallbackPending = toArray(providerCallback.pendingRows);
  const providerMaintenanceRows = toArray(providerMaintenance.rows);
  const providerMaintenanceBlocked = toArray(providerMaintenance.blockedRows);
  const providerMaintenanceDegraded = toArray(providerMaintenance.degradedRows);
  const postureRows = toArray(permissionPosture.rows);
  const postureBlocked = toArray(permissionPosture.blockedRows);
  const state = errors.length > 0 || recoveryPlan.state === "blocked"
    ? "blocked"
    : recoveryPlan.state === "degraded" || warnings.length > 0
      ? "degraded"
      : runtimeScope.requiresClientState || runtimeScope.requiresIdempotency
        ? "handoff-ready"
        : "resolved";

  return Object.freeze({
    protocol: "aios.scope.history-snapshot.v1",
    jobName,
    state,
    exportReady: errors.length === 0,
    tenantId: runtimeScope.tenantId,
    workspaceId: runtimeScope.workspaceId,
    requestId: runtimeScope.requestId,
    capturedAt: runtimeScope.observedAt || "",
    statusChannel: runtimeScope.statusChannel,
    restartToken: runtimeScope.restartToken,
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    counters: Object.freeze({
      declarations: declarations.length,
      capabilities: declarations.filter((declaration) => declaration.kind === "capability").length,
      memory: declarations.filter((declaration) => declaration.kind === "memory").length,
      steps: declarations.filter((declaration) => declaration.kind === "step").length,
      verifiers: declarations.filter((declaration) => declaration.kind === "verifier").length,
      references: references.length,
      unresolved: unresolved.length,
      mailchimpCapabilities: toArray(permissionBoundary.capabilities).length,
      heldCapabilities: heldCapabilities.length,
      permissionPostureRows: postureRows.length,
      permissionPostureBlocked: postureBlocked.length,
      permissionPostureCovered: permissionPosture.counters?.covered ?? 0,
      permissionPostureGrantBlocked: permissionPosture.counters?.grantBlocked ?? 0,
      permissionPostureLeaseBlocked: permissionPosture.counters?.leaseBlocked ?? 0,
      permissionPostureIdentityBlocked: permissionPosture.counters?.identityBlocked ?? 0,
      permissionPostureHandoffBlocked: permissionPosture.counters?.handoffBlocked ?? 0,
      permissionLeaseHolds: leaseHolds.length,
      restartCommands: toArray(persistedRuntime.commands).length,
      replaySegments: replaySegments.length,
      blockedReplaySegments: blockedReplaySegments.length,
      stateSlots: toArray(persistedRuntime.stateSlots).length,
      adapterStatusEvents: adapterStatusLedger.counters?.events ?? 0,
      providerSyncRows: providerSyncRows.length,
      providerSyncBlocked: providerSyncBlocked.length,
      providerSyncNeedsCursor: providerSyncContract.counters?.needsProviderCursor ?? 0,
      segmentSyncReceiptRows: segmentReceiptRows.length,
      segmentSyncReceiptBlocked: segmentReceiptBlocked.length,
      segmentSyncReceiptPending: segmentReceiptPending.length,
      providerBudgetRows: providerBudgetRows.length,
      providerBudgetBlocked: providerBudgetBlocked.length,
      providerBudgetDegraded: providerBudgetDegraded.length,
      providerBudgetExhausted: providerBudget.counters?.exhausted ?? 0,
      providerCallbackRows: providerCallbackRows.length,
      providerCallbackBlocked: providerCallbackBlocked.length,
      providerCallbackPending: providerCallbackPending.length,
      providerCallbackVerified: providerCallback.counters?.verified ?? 0,
      providerMaintenanceRows: providerMaintenanceRows.length,
      providerMaintenanceBlocked: providerMaintenanceBlocked.length,
      providerMaintenanceDegraded: providerMaintenanceDegraded.length,
      providerMaintenanceActive: providerMaintenance.counters?.active ?? 0,
      adapterStatusMissing: adapterStatusLedger.counters?.missing ?? 0,
      adapterStatusFailures: adapterStatusLedger.counters?.failed ?? 0,
      adapterStatusSnapshotRows: adapterStatusSnapshot.counters?.rows ?? 0,
      adapterStatusSnapshotBlocked: adapterStatusSnapshot.counters?.blockedRows ?? 0,
      adapterStatusSnapshotMaterialized: adapterStatusSnapshot.counters?.materialized ?? 0,
      actionableErrors: toArray(recoveryPlan.actionableErrors).length,
      diagnostics: diagnostics.length,
      errors: errors.length,
      warnings: warnings.length,
    }),
    timeline: freezeArray([
      ...heldCapabilities.map((capability, index) => ({
        index,
        event: "permission-boundary-hold",
        name: capability.action,
        state: "blocked",
        nextCommand: recoveryPlan.nextCommand || "resolve_boundary_hold",
        detail: capability.requiredPermission || capability.reasons?.[0] || "",
      })),
      ...postureBlocked.map((row, index) => ({
        index: heldCapabilities.length + index,
        event: "tenant-permission-posture",
        name: row.action,
        state: row.state,
        nextCommand: row.nextCommand,
        detail: row.requiredPermission || row.leaseState || row.identityMissing?.[0] || "",
      })),
      ...externalCommands.map((command, index) => ({
        index: heldCapabilities.length + postureBlocked.length + index,
        event: `restart-${command.phase}`,
        name: command.command,
        state: persistedRuntime.restartSafe ? "restart-safe" : "restart-blocked",
        nextCommand: persistedRuntime.restartSafe ? "observe" : "repair_restart_command_ledger",
        detail: command.replayPolicy || "",
      })),
      ...replaySegments.map((segment, index) => ({
        index: heldCapabilities.length + postureBlocked.length + externalCommands.length + index,
        event: `replay-${segment.kind}`,
        name: segment.name,
        state: segment.status,
        nextCommand: segment.nextCommand,
        detail: segment.key || segment.segmentId,
      })),
      ...toArray(adapterStatusLedger.failures).map((failure, index) => ({
        index: heldCapabilities.length + postureBlocked.length + externalCommands.length + replaySegments.length + index,
        event: "adapter-status-failure",
        name: failure.capability || failure.stepName,
        state: failure.state,
        nextCommand: failure.nextCommand,
        detail: failure.message || failure.statusCode || "",
      })),
      ...toArray(adapterStatusLedger.missing).map((missing, index) => ({
        index: heldCapabilities.length + postureBlocked.length + externalCommands.length + replaySegments.length + toArray(adapterStatusLedger.failures).length + index,
        event: "adapter-status-missing",
        name: missing.capability || missing.stepName,
        state: "missing-status",
        nextCommand: "load_adapter_status_snapshot",
        detail: missing.statusSnapshotKey || "",
      })),
      ...toArray(adapterStatusSnapshot.blockedRows).map((row, index) => ({
        index: heldCapabilities.length
          + postureBlocked.length
          + externalCommands.length
          + replaySegments.length
          + toArray(adapterStatusLedger.failures).length
          + toArray(adapterStatusLedger.missing).length
          + index,
        event: "adapter-status-snapshot-blocked",
        name: row.capability || row.stepName,
        state: "blocked",
        nextCommand: row.nextCommand,
        detail: toArray(row.missing).join(", "),
      })),
      ...providerSyncRows.map((row, index) => ({
        index: heldCapabilities.length
          + postureBlocked.length
          + externalCommands.length
          + replaySegments.length
          + toArray(adapterStatusLedger.failures).length
          + toArray(adapterStatusLedger.missing).length
          + toArray(adapterStatusSnapshot.blockedRows).length
          + index,
        event: "provider-sync-scope",
        name: row.action,
        state: row.state,
        nextCommand: row.nextCommand,
        detail: row.checkpointKey || row.watermarkKey || toArray(row.missing).join(", "),
      })),
      ...providerBudgetRows.map((row, index) => ({
        index: heldCapabilities.length
          + postureBlocked.length
          + externalCommands.length
          + replaySegments.length
          + toArray(adapterStatusLedger.failures).length
          + toArray(adapterStatusLedger.missing).length
          + toArray(adapterStatusSnapshot.blockedRows).length
          + providerSyncRows.length
          + index,
        event: "provider-budget",
        name: row.action,
        state: row.state,
        nextCommand: row.nextCommand,
        detail: row.budgetId || toArray(row.blockedBy).join(", "),
      })),
      ...providerMaintenanceRows.map((row, index) => ({
        index: heldCapabilities.length
          + postureBlocked.length
          + externalCommands.length
          + replaySegments.length
          + toArray(adapterStatusLedger.failures).length
          + toArray(adapterStatusLedger.missing).length
          + toArray(adapterStatusSnapshot.blockedRows).length
          + providerSyncRows.length
          + providerBudgetRows.length
          + index,
        event: "provider-maintenance",
        name: row.action,
        state: row.state,
        nextCommand: row.nextCommand,
        detail: row.windowId || toArray(row.blockedBy).join(", "),
      })),
      ...unresolved.map((reference, index) => ({
        index: heldCapabilities.length
          + postureBlocked.length
          + externalCommands.length
          + replaySegments.length
          + toArray(adapterStatusLedger.failures).length
          + toArray(adapterStatusLedger.missing).length
          + toArray(adapterStatusSnapshot.blockedRows).length
          + providerSyncRows.length
          + providerBudgetRows.length
          + providerMaintenanceRows.length
          + index,
        event: "unresolved-reference",
        name: reference.source,
        state: "blocked",
        nextCommand: "declare_missing_symbol",
        detail: `${reference.relation}:${reference.target}`,
      })),
    ]),
    report: Object.freeze({
      acceptedForPreview: true,
      acceptedForAdapter: recoveryPlan.acceptedForAdapter === true && errors.length === 0,
      nextCommand: recoveryPlan.nextCommand || (unresolved.length > 0 ? "declare_missing_symbol" : "observe"),
      permissionPostureState: permissionPosture.state || "not-applicable",
      permissionPostureFingerprint: permissionPosture.fingerprint || "",
      permissionPostureNextCommand: permissionPosture.nextStep?.command || "observe",
      permissionPostureBlockedActions: freezeArray(postureBlocked.map((row) => row.action)),
      restartSafe: persistedRuntime.restartSafe === true,
      replayReport: persistedRuntime.replayReport || createRestartReplayReport([], runtimeScope),
      adapterStatusState: adapterStatusLedger.state || "not-required",
      adapterStatusNextCommand: adapterStatusLedger.nextCommand || "observe",
      adapterStatusSnapshotState: adapterStatusSnapshot.state || "not-required",
      adapterStatusSnapshotNextCommand: adapterStatusSnapshot.nextCommand || "observe",
      adapterStatusSnapshotKey: adapterStatusSnapshot.statusSnapshotKey || "",
      providerSyncState: providerSyncContract.state || "not-applicable",
      providerSyncNextCommand: providerSyncContract.nextCommand || "observe",
      providerSyncCheckpointKeys: freezeArray([...new Set(providerSyncRows.map((row) => row.checkpointKey).filter(Boolean))]),
      providerSyncWatermarkKeys: freezeArray([...new Set(providerSyncRows.map((row) => row.watermarkKey).filter(Boolean))]),
      providerBudgetState: providerBudget.state || "not-required",
      providerBudgetNextCommand: providerBudget.nextStep?.command || "observe",
      providerBudgetRetryAfterMs: providerBudget.nextStep?.retryAfterMs || 0,
      providerBudgetBlockedActions: freezeArray(providerBudgetBlocked.map((row) => row.action)),
      providerBudgetDegradedActions: freezeArray(providerBudgetDegraded.map((row) => row.action)),
      providerMaintenanceState: providerMaintenance.state || "not-required",
      providerMaintenanceNextCommand: providerMaintenance.nextStep?.command || "observe",
      providerMaintenanceRetryAfterMs: providerMaintenance.nextStep?.retryAfterMs || 0,
      providerMaintenanceBlockedActions: freezeArray(providerMaintenanceBlocked.map((row) => row.action)),
      providerMaintenanceDegradedActions: freezeArray(providerMaintenanceDegraded.map((row) => row.action)),
      requiredStatusChannels: freezeArray(runtimeScope.statusChannel ? [runtimeScope.statusChannel] : []),
      requiredRestartTokens: freezeArray(runtimeScope.restartToken ? [runtimeScope.restartToken] : []),
      heldActions: freezeArray(heldCapabilities.map((capability) => capability.action)),
      leaseHeldActions: freezeArray(leaseHolds.map((capability) => capability.action)),
    }),
  });
}

function createProviderExportBoundaryHandoff(row = {}, runtimeScope = {}, recoveryPlan = {}) {
  const blockedBy = toArray(row.blockedBy).map(compactString).filter(Boolean);
  const tenantId = compactString(row.tenantId || runtimeScope.tenantId);
  const workspaceId = compactString(row.workspaceId || runtimeScope.workspaceId);
  const statusChannel = compactString(row.statusChannel || runtimeScope.statusChannel);
  const restartToken = compactString(row.restartToken || runtimeScope.restartToken);
  const boundaryToken = stableToken("provider-export-boundary", [
    tenantId,
    workspaceId,
    row.provider,
    row.action,
    row.boundaryFingerprint,
  ]);
  const missing = [
    row.provider === "mailchimp" && !tenantId && "tenantId",
    row.provider === "mailchimp" && !workspaceId && "workspaceId",
    row.provider === "mailchimp" && !statusChannel && "statusChannel",
    row.provider === "mailchimp" && row.restartSafe !== true && row.action !== "runtime.scope" && "restartSafe",
    row.exportable !== true && "exportable",
  ].filter(Boolean);
  const state = blockedBy.length > 0 || missing.length > 0
    ? "blocked"
    : row.provider === "mailchimp"
      ? "ready"
      : "local";

  return Object.freeze({
    protocol: "aios.scope.provider-export-boundary.v1",
    boundaryToken,
    laneKey: compactString(row.laneKey),
    action: compactString(row.action),
    provider: compactString(row.provider),
    state,
    exportable: state !== "blocked" && row.exportable === true,
    tenantId,
    workspaceId,
    statusChannel,
    restartToken,
    statusSnapshotKey: compactString(row.statusSnapshotKey),
    boundaryFingerprint: compactString(row.boundaryFingerprint),
    missing: freezeArray(missing),
    blockedBy: freezeArray(blockedBy),
    nextCommand: state === "blocked"
      ? compactString(row.nextCommand || recoveryPlan.nextCommand || "repair_provider_export_boundary")
      : "publish_provider_export_boundary",
  });
}

function createScopeExportRows(scope = {}) {
  const snapshot = scope.historySnapshot || {};
  const boundary = scope.permissionBoundary || {};
  const runtimeScope = scope.runtimeScope || {};
  const persistedRuntime = scope.persistedRuntime || {};
  const adapterStatusLedger = scope.adapterStatusLedger || {};
  const adapterStatusSnapshot = scope.adapterStatusSnapshot || {};
  const providerSyncContract = scope.providerSyncContract || {};
  const settingsAdoption = scope.settingsAdoption || {};
  const providerCallback = scope.providerCallback || {};
  const providerMaintenance = scope.providerMaintenance || {};
  const recoveryPlan = scope.recoveryPlan || {};
  const capabilityRows = toArray(boundary.capabilities).map((capability, index) => {
    const statusRow = toArray(adapterStatusLedger.latestByCapability)
      .find((row) => compactString(row.capability) === compactString(capability.action));
    const snapshotRow = toArray(adapterStatusSnapshot.rows)
      .find((row) => compactString(row.capability) === compactString(capability.action));
    const providerSyncRow = toArray(providerSyncContract.rows)
      .find((row) => compactString(row.action) === compactString(capability.action));
    const settingsRow = toArray(settingsAdoption.rows)
      .find((row) => compactString(row.action) === compactString(capability.action));
    const callbackRow = toArray(providerCallback.rows)
      .find((row) => compactString(row.action) === compactString(capability.action));
    const maintenanceRow = toArray(providerMaintenance.rows)
      .find((row) => compactString(row.action) === compactString(capability.action));
    const leaseBlocked = toArray(capability.reasons)
      .some((reason) => compactString(reason).includes("permission-lease"));
    const rowState = capability.decision === "hold"
      ? "blocked"
      : statusRow?.state === "pending"
        ? "waiting-adapter"
        : statusRow?.terminal && statusRow.state !== "succeeded"
          ? "adapter-terminal"
          : persistedRuntime.restartSafe === false && capability.writeBoundary
            ? "restart-blocked"
          : "export-ready";
    const tenantId = firstString(capability.tenantId, runtimeScope.tenantId);
    const workspaceId = firstString(capability.workspaceId, runtimeScope.workspaceId);
    const statusChannel = capability.statusChannel || runtimeScope.statusChannel || "";
    const statusSnapshotKey = snapshotRow?.statusSnapshotKey || adapterStatusSnapshot.statusSnapshotKey || persistedRuntime.statusSnapshotKey || "";
    const blockedBy = [
      ...toArray(capability.reasons),
      leaseBlocked && "permission-lease-refresh",
      rowState === "restart-blocked" && "restart-runtime-state",
      rowState === "adapter-terminal" && "adapter-status-terminal",
      providerSyncRow?.state === "blocked" && "provider-sync-scope",
      settingsRow?.state === "blocked" && "mailchimp-settings-blocked",
      settingsRow?.state === "disabled" && "mailchimp-settings-disabled",
      callbackRow?.state === "blocked" && "provider-callback-blocked",
      callbackRow?.state === "pending-verification" && "provider-callback-pending",
      maintenanceRow?.state === "blocked" && "provider-maintenance-blocked",
      maintenanceRow?.state === "degraded" && "provider-maintenance-degraded",
    ].filter(Boolean).map(compactString);
    const boundaryFingerprint = stableFingerprint([
      capability.action,
      capability.decision,
      capability.requiredPermission,
      capability.leaseRecovery?.state,
      tenantId,
      workspaceId,
      statusChannel,
      statusSnapshotKey,
      providerSyncRow?.state,
      settingsRow?.state,
      callbackRow?.state,
      maintenanceRow?.state,
      ...blockedBy,
    ]);
    const exportable = capability.decision === "allow"
      && (persistedRuntime.restartSafe === true || capability.writeBoundary !== true)
      && providerSyncRow?.state !== "blocked"
      && settingsRow?.state !== "blocked"
      && settingsRow?.state !== "disabled"
      && callbackRow?.state !== "blocked"
      && callbackRow?.state !== "pending-verification"
      && maintenanceRow?.state !== "blocked";
    const nextCommand = capability.decision === "hold"
      ? leaseBlocked ? capability.leaseRecovery?.nextCommand || "refresh_mailchimp_permission_lease" : "resolve_boundary_hold"
      : providerSyncRow?.state === "blocked" || providerSyncRow?.state === "needs-provider-cursor"
        ? providerSyncRow.nextCommand
      : settingsRow?.state === "blocked" || settingsRow?.state === "patch-required" || settingsRow?.state === "disabled"
        ? settingsRow.nextCommand
      : callbackRow?.state === "blocked" || callbackRow?.state === "pending-verification"
        ? callbackRow.nextCommand
      : maintenanceRow?.state === "blocked" || maintenanceRow?.state === "degraded"
        ? maintenanceRow.nextCommand
      : rowState === "restart-blocked"
        ? "repair_restart_command_ledger"
        : statusRow?.nextCommand && statusRow.nextCommand !== "observe"
          ? statusRow.nextCommand
          : recoveryPlan.nextCommand || "observe";
    const baseRow = {
      laneKey: stableToken("provider-export-lane", [tenantId, workspaceId, capability.provider, capability.action]),
      boundaryFingerprint,
      exportable,
      blockedBy: freezeArray(blockedBy),
      nextCommand,
      tenantId,
      workspaceId,
      statusChannel,
      statusSnapshotKey,
    };

    return Object.freeze({
      rowId: stableToken("scope-export-row", [snapshot.jobName, capability.action, index]),
      jobName: compactString(snapshot.jobName || scope.jobName || "anonymous"),
      action: capability.action,
      provider: capability.provider,
      state: rowState,
      decision: capability.decision,
      requiredPermission: capability.requiredPermission,
      permissionLeaseState: capability.leaseRequired ? capability.leaseRecovery?.state || "blocked" : "not-required",
      permissionLeaseToken: capability.permissionLease?.token || "",
      permissionLeaseNextCommand: capability.leaseRecovery?.nextCommand || "",
      tenantId,
      workspaceId,
      actorId: firstString(capability.actorId, boundary.actorId),
      restartToken: runtimeScope.restartToken || "",
      statusChannel,
      statusSnapshotKey,
      adapterStatusState: statusRow?.state || "unobserved",
      adapterStatusNextCommand: statusRow?.nextCommand || adapterStatusLedger.nextCommand || "observe",
      providerSyncState: providerSyncRow?.state || "not-applicable",
      providerSyncNextCommand: providerSyncRow?.nextCommand || "observe",
      settingsAdoptionState: settingsRow?.state || "not-required",
      settingsAdoptionNextCommand: settingsRow?.nextCommand || "observe",
      providerCallbackState: callbackRow?.state || "not-required",
      providerCallbackId: callbackRow?.callbackId || "",
      providerCallbackNextCommand: callbackRow?.nextCommand || "observe",
      providerMaintenanceState: maintenanceRow?.state || "not-required",
      providerMaintenanceWindowId: maintenanceRow?.windowId || "",
      providerMaintenanceRetryAfterMs: maintenanceRow?.retryAfterMs ?? 0,
      providerMaintenanceNextCommand: maintenanceRow?.nextCommand || "observe",
      providerSyncCheckpointKey: providerSyncRow?.checkpointKey || "",
      providerSyncWatermarkKey: providerSyncRow?.watermarkKey || "",
      providerObjectRef: providerSyncRow?.objectRef || "",
      restartSafe: persistedRuntime.restartSafe === true,
      laneKey: baseRow.laneKey,
      boundaryFingerprint: baseRow.boundaryFingerprint,
      exportable: baseRow.exportable,
      blockedBy: baseRow.blockedBy,
      nextCommand: baseRow.nextCommand,
      providerExportBoundary: createProviderExportBoundaryHandoff({
        ...baseRow,
        action: capability.action,
        provider: capability.provider,
        restartToken: runtimeScope.restartToken || "",
        restartSafe: persistedRuntime.restartSafe === true,
      }, runtimeScope, recoveryPlan),
    });
  });
  const runtimeBlockedBy = toArray(scope.diagnostics)
    .filter((diagnostic) => diagnostic.level === "error")
    .map((diagnostic) => diagnostic.code || "diagnostic:error");
  const runtimeBoundaryFingerprint = stableFingerprint([
    snapshot.jobName || scope.jobName,
    snapshot.state || scope.status,
    runtimeScope.tenantId,
    runtimeScope.workspaceId,
    runtimeScope.statusChannel,
    runtimeScope.restartToken,
    persistedRuntime.statusSnapshotKey,
    adapterStatusLedger.state,
    providerSyncContract.state,
    ...runtimeBlockedBy,
  ]);
  const runtimeRow = Object.freeze({
    rowId: stableToken("scope-export-row", [snapshot.jobName, "runtime"]),
    jobName: compactString(snapshot.jobName || scope.jobName || "anonymous"),
    action: "runtime.scope",
    provider: "aios",
    state: snapshot.state || scope.status || "unknown",
    decision: snapshot.exportReady === false ? "hold" : "allow",
    requiredPermission: "",
    permissionLeaseState: "not-required",
    permissionLeaseToken: "",
    permissionLeaseNextCommand: "",
    tenantId: runtimeScope.tenantId || "",
    workspaceId: runtimeScope.workspaceId || "",
    actorId: boundary.actorId || "",
    restartToken: runtimeScope.restartToken || "",
    statusChannel: runtimeScope.statusChannel || "",
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    adapterStatusState: adapterStatusLedger.state || "not-required",
    adapterStatusNextCommand: adapterStatusLedger.nextCommand || "observe",
    providerSyncState: providerSyncContract.state || "not-applicable",
    providerSyncNextCommand: providerSyncContract.nextCommand || "observe",
    providerSyncCheckpointKey: "",
    providerSyncWatermarkKey: "",
    providerObjectRef: "",
    restartSafe: persistedRuntime.restartSafe === true,
    laneKey: stableToken("provider-export-lane", [runtimeScope.tenantId, runtimeScope.workspaceId, "aios", "runtime.scope"]),
    boundaryFingerprint: runtimeBoundaryFingerprint,
    exportable: snapshot.exportReady !== false,
    blockedBy: freezeArray(runtimeBlockedBy),
    nextCommand: recoveryPlan.nextCommand || "observe",
    providerExportBoundary: createProviderExportBoundaryHandoff({
      action: "runtime.scope",
      provider: "aios",
      laneKey: stableToken("provider-export-lane", [runtimeScope.tenantId, runtimeScope.workspaceId, "aios", "runtime.scope"]),
      boundaryFingerprint: runtimeBoundaryFingerprint,
      tenantId: runtimeScope.tenantId || "",
      workspaceId: runtimeScope.workspaceId || "",
      statusChannel: runtimeScope.statusChannel || "",
      restartToken: runtimeScope.restartToken || "",
      statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
      restartSafe: persistedRuntime.restartSafe === true,
      exportable: snapshot.exportReady !== false,
      blockedBy: runtimeBlockedBy,
      nextCommand: recoveryPlan.nextCommand || "observe",
    }, runtimeScope, recoveryPlan),
  });

  return freezeArray([runtimeRow, ...capabilityRows]
    .sort((left, right) => left.jobName.localeCompare(right.jobName) || left.provider.localeCompare(right.provider) || left.action.localeCompare(right.action)));
}

function normalizeExportDestination(value = {}, fallback = {}) {
  const name = compactString(value.name || value.destination || value.sink || fallback.name || "mailchimp.analytics");
  const format = compactString(value.format || value.type || fallback.format || "jsonl");
  const channel = firstString(value.statusChannel, fallback.statusChannel);
  const enabled = value.enabled !== false;

  return Object.freeze({
    destinationId: firstString(value.destinationId, value.id, stableToken("scope-export-destination", [
      fallback.tenantId,
      fallback.workspaceId,
      name,
      format,
    ])),
    name,
    format,
    enabled,
    tenantId: firstString(value.tenantId, fallback.tenantId),
    workspaceId: firstString(value.workspaceId, fallback.workspaceId),
    statusChannel: channel,
    requireFreshSnapshot: value.requireFreshSnapshot !== false,
    maxAgeMs: positiveInteger(value.maxAgeMs ?? value.freshnessMs ?? fallback.maxAgeMs, 300000),
    nextCommand: enabled ? "publish_scope_analytics_export" : "enable_scope_export_destination",
  });
}

function collectExportDestinations(scopes = [], requestState = normalizeRequestState()) {
  const explicit = [
    ...toArray(requestState.analyticsExports),
    ...toArray(requestState.exportDestinations),
    ...toArray(requestState.destinations),
  ].filter(Boolean);
  const statusChannel = requestState.statusChannel
    || scopes.find((scope) => scope.runtimeScope?.statusChannel)?.runtimeScope?.statusChannel
    || "";
  const fallback = {
    tenantId: requestState.tenantId || scopes.find((scope) => scope.runtimeScope?.tenantId)?.runtimeScope?.tenantId || "",
    workspaceId: requestState.workspaceId || scopes.find((scope) => scope.runtimeScope?.workspaceId)?.runtimeScope?.workspaceId || "",
    statusChannel,
    maxAgeMs: requestState.exportFreshnessMs,
  };
  const destinations = (explicit.length > 0 ? explicit : [{
    name: "mailchimp.analytics",
    format: "jsonl",
    statusChannel,
  }])
    .map((destination) => normalizeExportDestination(destination, fallback))
    .sort((left, right) => left.name.localeCompare(right.name) || left.format.localeCompare(right.format));

  return freezeArray(destinations);
}

function createScopeExportHistoryState(scopes = [], exportRows = [], diagnostics = [], requestState = normalizeRequestState()) {
  const destinations = collectExportDestinations(scopes, requestState);
  const snapshots = toArray(scopes).map((scope) => scope.historySnapshot).filter(Boolean);
  const observedAt = compactString(requestState.observedAt);
  const rowsByJob = new Map();
  for (const row of toArray(exportRows)) {
    const jobName = compactString(row.jobName || "anonymous");
    rowsByJob.set(jobName, [...(rowsByJob.get(jobName) || []), row]);
  }
  const historyRows = snapshots.map((snapshot, index) => {
    const jobName = compactString(snapshot.jobName || `job:${index + 1}`);
    const rows = rowsByJob.get(jobName) || [];
    const blocked = rows.filter((row) => row.exportable === false || toArray(row.blockedBy).length > 0);
    const adapterReady = rows.filter((row) => row.provider === "mailchimp" && row.exportable === true);
    const fingerprint = stableFingerprint([
      jobName,
      snapshot.state,
      snapshot.report?.adapterStatusState,
      snapshot.report?.providerSyncState,
      snapshot.report?.providerBudgetState,
      ...rows.map((row) => `${row.action}:${row.state}:${row.exportable}`),
      ...toArray(snapshot.report?.heldActions),
      ...toArray(snapshot.report?.leaseHeldActions),
    ]);
    const capturedAt = firstString(snapshot.capturedAt, snapshot.report?.observedAt, requestState.observedAt);
    const maxAgeMs = Math.max(0, ...destinations.map((destination) => destination.maxAgeMs));
    const observedMs = Date.parse(observedAt);
    const capturedMs = Date.parse(capturedAt);
    const ageMs = Number.isFinite(observedMs) && Number.isFinite(capturedMs) && observedMs >= capturedMs
      ? observedMs - capturedMs
      : 0;
    const stale = Boolean(observedAt && capturedAt && maxAgeMs > 0 && ageMs > maxAgeMs);

    return Object.freeze({
      rowId: stableToken("scope-history", [jobName, fingerprint]),
      jobName,
      state: blocked.length > 0 || snapshot.state === "blocked"
        ? "blocked"
        : stale
          ? "stale"
          : adapterReady.length > 0
            ? "export-ready"
            : "tracked",
      fingerprint,
      capturedAt,
      observedAt,
      ageMs,
      stale,
      exportRows: rows.length,
      exportableRows: rows.filter((row) => row.exportable === true).length,
      blockedRows: blocked.length,
      adapterReadyRows: adapterReady.length,
      statusChannels: freezeArray([...new Set(rows.map((row) => row.statusChannel).filter(Boolean))]),
      statusSnapshotKeys: freezeArray([...new Set(rows.map((row) => row.statusSnapshotKey).filter(Boolean))]),
      nextCommand: blocked[0]?.nextCommand
        || (stale ? "refresh_scope_analytics_snapshot" : "")
        || snapshot.report?.nextCommand
        || "observe",
    });
  });
  const blockedRows = historyRows.filter((row) => row.state === "blocked");
  const staleRows = historyRows.filter((row) => row.state === "stale");
  const disabledDestinations = destinations.filter((destination) => destination.enabled === false);
  const errorDiagnostics = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");

  return Object.freeze({
    protocol: "aios.scope.export-history.v1",
    state: errorDiagnostics.length > 0 || blockedRows.length > 0
      ? "blocked"
      : staleRows.length > 0
        ? "stale"
        : disabledDestinations.length > 0
          ? "destination-disabled"
          : historyRows.length > 0
            ? "export-ready"
            : "empty",
    acceptedForExport: errorDiagnostics.length === 0 && blockedRows.length === 0 && staleRows.length === 0 && disabledDestinations.length === 0,
    observedAt,
    destinations,
    rows: freezeArray(historyRows),
    blockedRows: freezeArray(blockedRows),
    staleRows: freezeArray(staleRows),
    counters: Object.freeze({
      jobs: historyRows.length,
      rows: historyRows.length,
      destinations: destinations.length,
      disabledDestinations: disabledDestinations.length,
      blockedRows: blockedRows.length,
      staleRows: staleRows.length,
      exportRows: exportRows.length,
      exportableRows: toArray(exportRows).filter((row) => row.exportable === true).length,
      diagnostics: diagnostics.length,
      errors: errorDiagnostics.length,
    }),
    nextCommand: blockedRows[0]?.nextCommand
      || staleRows[0]?.nextCommand
      || disabledDestinations[0]?.nextCommand
      || (historyRows.length > 0 ? "publish_scope_analytics_export" : "observe"),
  });
}

function createScopePublicationManifest(scopes = [], exportRows = [], exportHistory = {}, diagnostics = [], requestState = normalizeRequestState()) {
  const rows = toArray(exportRows);
  const destinations = toArray(exportHistory.destinations);
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const blockedRows = rows.filter((row) => row.exportable !== true || toArray(row.blockedBy).length > 0);
  const publishableRows = rows.filter((row) => row.exportable === true && toArray(row.blockedBy).length === 0);
  const staleRows = toArray(exportHistory.staleRows);
  const disabledDestinations = destinations.filter((destination) => destination.enabled === false);
  const destinationRows = destinations.map((destination) => {
    const missing = [
      !destination.name && "name",
      !destination.format && "format",
      destination.enabled === false && "enabled",
      destination.requireFreshSnapshot !== false && staleRows.length > 0 && "freshSnapshot",
      errors.length > 0 && "diagnostics",
      blockedRows.length > 0 && "exportRows",
    ].filter(Boolean);
    const rowFingerprint = stableFingerprint([
      destination.destinationId,
      destination.name,
      destination.format,
      destination.tenantId,
      destination.workspaceId,
      ...publishableRows.map((row) => `${row.rowId}:${row.boundaryFingerprint}`),
    ]);

    return Object.freeze({
      destinationId: compactString(destination.destinationId),
      name: compactString(destination.name),
      format: compactString(destination.format),
      state: missing.length > 0 ? "blocked" : publishableRows.length > 0 ? "publish-ready" : "empty",
      enabled: destination.enabled !== false,
      tenantId: compactString(destination.tenantId),
      workspaceId: compactString(destination.workspaceId),
      statusChannel: compactString(destination.statusChannel || requestState.statusChannel),
      manifestKey: stableToken("scope-publication", [destination.destinationId, rowFingerprint]),
      rowFingerprint,
      publishableRows: publishableRows.length,
      blockedRows: blockedRows.length,
      missing: freezeArray(missing),
      nextCommand: missing.length > 0
        ? destination.enabled === false
          ? "enable_scope_export_destination"
          : staleRows.length > 0
            ? "refresh_scope_analytics_snapshot"
            : blockedRows[0]?.nextCommand || "repair_scope_analytics_export"
        : publishableRows.length > 0
          ? destination.nextCommand || "publish_scope_analytics_export"
          : "observe",
    });
  }).sort((left, right) => left.name.localeCompare(right.name) || left.format.localeCompare(right.format));
  const blockedDestinations = destinationRows.filter((row) => row.state === "blocked");
  const readyDestinations = destinationRows.filter((row) => row.state === "publish-ready");
  const lanes = [...new Set(rows.map((row) => compactString(row.laneKey)).filter(Boolean))].sort();

  return Object.freeze({
    protocol: "aios.scope.publication-manifest.v1",
    state: errors.length > 0 || blockedRows.length > 0 || blockedDestinations.length > 0
      ? "blocked"
      : readyDestinations.length > 0
        ? "publish-ready"
        : rows.length > 0
          ? "empty"
          : "not-required",
    acceptedForExport: errors.length === 0 && blockedRows.length === 0 && blockedDestinations.length === 0 && readyDestinations.length > 0,
    acceptedForProviderHandoff: errors.length === 0 && blockedRows.length === 0,
    observedAt: compactString(exportHistory.observedAt || requestState.observedAt),
    publicationId: stableToken("scope-publication-manifest", [
      requestState.tenantId,
      requestState.workspaceId,
      exportHistory.state,
      stableFingerprint(rows.map((row) => row.boundaryFingerprint)),
    ]),
    laneKeys: freezeArray(lanes),
    destinations: freezeArray(destinationRows),
    publishableRows: freezeArray(publishableRows.map((row) => ({
      rowId: row.rowId,
      jobName: row.jobName,
      action: row.action,
      provider: row.provider,
      laneKey: row.laneKey,
      boundaryFingerprint: row.boundaryFingerprint,
      statusChannel: row.statusChannel,
      statusSnapshotKey: row.statusSnapshotKey,
      nextCommand: row.nextCommand,
    }))),
    blockedRows: freezeArray(blockedRows.map((row) => ({
      rowId: row.rowId,
      jobName: row.jobName,
      action: row.action,
      provider: row.provider,
      laneKey: row.laneKey,
      blockedBy: row.blockedBy,
      nextCommand: row.nextCommand,
    }))),
    historyRows: freezeArray(toArray(exportHistory.rows).map((row) => ({
      rowId: row.rowId,
      jobName: row.jobName,
      state: row.state,
      fingerprint: row.fingerprint,
      stale: row.stale === true,
      nextCommand: row.nextCommand,
    }))),
    counters: Object.freeze({
      jobs: toArray(scopes).length,
      rows: rows.length,
      publishableRows: publishableRows.length,
      blockedRows: blockedRows.length,
      destinations: destinationRows.length,
      blockedDestinations: blockedDestinations.length,
      readyDestinations: readyDestinations.length,
      disabledDestinations: disabledDestinations.length,
      staleHistoryRows: staleRows.length,
      lanes: lanes.length,
      errors: errors.length,
    }),
    nextStep: Object.freeze({
      command: blockedRows[0]?.nextCommand
        || blockedDestinations[0]?.nextCommand
        || readyDestinations[0]?.nextCommand
        || exportHistory.nextCommand
        || "observe",
      reason: blockedRows.length > 0
        ? "Scope analytics export rows must be repaired before publication."
        : blockedDestinations.length > 0
          ? "A scope analytics export destination is blocked or stale."
          : readyDestinations.length > 0
            ? "Scope analytics rows are ready to publish to configured destinations."
            : "No scope analytics publication rows are ready.",
    }),
  });
}

function createScopePublicationReceiptLedger(publicationManifest = {}, exportHistory = {}, requestState = normalizeRequestState()) {
  const destinations = toArray(publicationManifest.destinations);
  const publishableRows = toArray(publicationManifest.publishableRows);
  const blockedPublicationRows = toArray(publicationManifest.blockedRows);
  const acceptedReceipts = toArray(requestState.publicationReceipts || requestState.exportReceipts || requestState.analyticsExportReceipts)
    .map((receipt) => Object.freeze({
      receiptId: firstString(receipt.receiptId, receipt.id, receipt.token),
      destinationId: firstString(receipt.destinationId, receipt.destination, receipt.sink),
      publicationId: firstString(receipt.publicationId, publicationManifest.publicationId),
      manifestKey: firstString(receipt.manifestKey, receipt.key),
      state: compactString(receipt.state || receipt.status || (receipt.accepted === true ? "accepted" : "")).toLowerCase(),
      acceptedAt: firstString(receipt.acceptedAt, receipt.publishedAt, receipt.createdAt),
      acceptedBy: firstString(receipt.acceptedBy, receipt.actorId, requestState.userId),
      providerAckId: firstString(receipt.providerAckId, receipt.providerRequestId, receipt.ackId),
      message: compactString(receipt.message),
    }));
  const receiptsByDestination = new Map(acceptedReceipts.map((receipt) => [receipt.destinationId, receipt]));
  const rows = destinations.map((destination) => {
    const receipt = receiptsByDestination.get(destination.destinationId) || null;
    const destinationBlocked = compactString(destination.state) === "blocked";
    const receiptState = compactString(receipt?.state);
    const accepted = ["accepted", "published", "delivered", "ready"].includes(receiptState);
    const rejected = ["rejected", "failed", "expired", "cancelled"].includes(receiptState);
    const missing = [
      !destination.destinationId && "destinationId",
      destinationBlocked && "destination",
      publicationManifest.acceptedForExport !== true && "publication",
      publishableRows.length === 0 && "publishableRows",
      !receipt && "receipt",
      receipt && !receipt.receiptId && "receiptId",
      receipt && !receipt.acceptedAt && accepted && "acceptedAt",
      receipt && rejected && "acceptedReceipt",
    ].filter(Boolean);
    const state = missing.length > 0
      ? rejected
        ? "rejected"
        : "blocked"
      : accepted
        ? "accepted"
        : "pending";

    return Object.freeze({
      rowId: stableToken("scope-publication-receipt", [
        publicationManifest.publicationId,
        destination.destinationId,
        destination.manifestKey,
      ]),
      publicationId: compactString(publicationManifest.publicationId),
      destinationId: compactString(destination.destinationId),
      destinationName: compactString(destination.name),
      format: compactString(destination.format),
      manifestKey: compactString(destination.manifestKey),
      state,
      accepted,
      receiptId: compactString(receipt?.receiptId),
      acceptedAt: compactString(receipt?.acceptedAt),
      acceptedBy: compactString(receipt?.acceptedBy),
      providerAckId: compactString(receipt?.providerAckId),
      publishableRows: publishableRows.length,
      blockedRows: blockedPublicationRows.length,
      missing: freezeArray(missing),
      statusChannel: compactString(destination.statusChannel || requestState.statusChannel),
      nextCommand: state === "accepted"
        ? "observe"
        : rejected
          ? "repair_scope_publication_receipt"
          : receipt
            ? "confirm_scope_publication_receipt"
            : "attach_scope_publication_receipt",
    });
  }).sort((left, right) => left.destinationName.localeCompare(right.destinationName) || left.format.localeCompare(right.format));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.state === "rejected");
  const pendingRows = rows.filter((row) => row.state === "pending");
  const acceptedRows = rows.filter((row) => row.state === "accepted");

  return Object.freeze({
    protocol: "aios.scope.publication-receipts.v1",
    state: blockedRows.length > 0
      ? "blocked"
      : pendingRows.length > 0
        ? "pending"
        : acceptedRows.length > 0
          ? "accepted"
          : "not-required",
    acceptedForProviderHandoff: blockedRows.length === 0 && pendingRows.length === 0 && publicationManifest.acceptedForExport === true,
    publicationId: compactString(publicationManifest.publicationId),
    observedAt: compactString(exportHistory.observedAt || requestState.observedAt),
    rows: freezeArray(rows),
    acceptedRows: freezeArray(acceptedRows),
    pendingRows: freezeArray(pendingRows),
    blockedRows: freezeArray(blockedRows),
    counters: Object.freeze({
      rows: rows.length,
      accepted: acceptedRows.length,
      pending: pendingRows.length,
      blocked: blockedRows.length,
      destinations: destinations.length,
      publishableRows: publishableRows.length,
      providedReceipts: acceptedReceipts.length,
    }),
    nextStep: Object.freeze({
      command: blockedRows[0]?.nextCommand || pendingRows[0]?.nextCommand || (acceptedRows.length > 0 ? "publish_provider_export_handoff" : "observe"),
      reason: blockedRows.length > 0
        ? "Scope analytics publication receipts are blocked or rejected."
        : pendingRows.length > 0
          ? "Scope analytics publication receipts must be attached before provider export handoff."
          : acceptedRows.length > 0
            ? "Publication receipts are accepted for provider handoff."
            : "No publication receipt rows are required.",
    }),
  });
}

function createScopeAdapterHandoffManifest(scope = {}) {
  const jobName = compactString(scope.jobName || scope.historySnapshot?.jobName || "anonymous");
  const runtimeScope = scope.runtimeScope || {};
  const persistedRuntime = scope.persistedRuntime || {};
  const permissionBoundary = scope.permissionBoundary || {};
  const clientWorkflowHandoff = scope.clientWorkflowHandoff || {};
  const adapterStatusLedger = scope.adapterStatusLedger || {};
  const adapterStatusSnapshot = scope.adapterStatusSnapshot || {};
  const providerSyncContract = scope.providerSyncContract || {};
  const segmentSyncReceipts = scope.segmentSyncReceipts || {};
  const providerCallback = scope.providerCallback || {};
  const providerMaintenance = scope.providerMaintenance || {};
  const recoveryPlan = scope.recoveryPlan || {};
  const workflowByCapability = new Map(toArray(clientWorkflowHandoff.commands)
    .filter((command) => compactString(command.capability))
    .map((command) => [compactString(command.capability), command]));
  const statusByCapability = new Map(toArray(adapterStatusLedger.latestByCapability)
    .map((row) => [compactString(row.capability), row]));
  const snapshotByCapability = new Map(toArray(adapterStatusSnapshot.rows)
    .map((row) => [compactString(row.capability), row]));
  const syncByCapability = new Map(toArray(providerSyncContract.rows)
    .map((row) => [compactString(row.action), row]));
  const segmentReceiptByCapability = new Map(toArray(segmentSyncReceipts.rows)
    .map((row) => [compactString(row.action), row]));
  const callbackByCapability = new Map(toArray(providerCallback.rows)
    .map((row) => [compactString(row.action), row]));
  const maintenanceByCapability = new Map(toArray(providerMaintenance.rows)
    .map((row) => [compactString(row.action), row]));
  const rows = toArray(permissionBoundary.capabilities).map((capability, index) => {
    const action = compactString(capability.action);
    const workflow = workflowByCapability.get(action) || null;
    const status = statusByCapability.get(action) || null;
    const snapshot = snapshotByCapability.get(action) || null;
    const sync = syncByCapability.get(action) || null;
    const segmentReceipt = segmentReceiptByCapability.get(action) || null;
    const callback = callbackByCapability.get(action) || null;
    const maintenance = maintenanceByCapability.get(action) || null;
    const blockedBy = [
      ...toArray(capability.reasons).map(compactString).filter(Boolean),
      workflow?.userVisible?.blocking === true && "workflow-command-blocked",
      adapterStatusLedger.state === "failed" && "adapter-status-failed",
      status?.state === "pending" && "adapter-status-pending",
      adapterStatusLedger.state === "missing-status" && !status && "adapter-status-missing",
      snapshot?.persisted === false && "adapter-status-snapshot-unpersisted",
      sync?.state === "blocked" && "provider-sync-blocked",
      sync?.state === "needs-provider-cursor" && "provider-sync-needs-cursor",
      segmentReceipt?.state === "blocked" && "segment-sync-receipt-blocked",
      segmentReceipt?.state === "pending" && "segment-sync-receipt-pending",
      callback?.state === "blocked" && "provider-callback-blocked",
      callback?.state === "pending-verification" && "provider-callback-pending",
      maintenance?.state === "blocked" && "provider-maintenance-blocked",
      maintenance?.state === "degraded" && "provider-maintenance-degraded",
      persistedRuntime.restartSafe === false && capability.writeBoundary && "restart-runtime-state",
    ].filter(Boolean);
    const queueable = blockedBy.length === 0
      && capability.decision === "allow"
      && (capability.writeBoundary ? persistedRuntime.restartSafe === true : true)
      && (!sync || sync.state === "checkpoint-scoped" || sync.state === "watermark-scoped")
      && (!segmentReceipt || segmentReceipt.state === "accepted")
      && (!callback || callback.state === "verified" || callback.state === "not-required")
      && (!maintenance || maintenance.state === "clear" || maintenance.state === "not-required");

    return Object.freeze({
      rowId: stableToken("adapter-handoff", [jobName, action, index]),
      jobName,
      action,
      provider: capability.provider,
      state: queueable
        ? "queueable"
        : blockedBy.some((reason) => reason.includes("pending") || reason.includes("needs-cursor"))
          ? "waiting"
          : "blocked",
      queueable,
      command: queueable
        ? "queue_adapter_handoff"
        : workflow?.nextCommand
          || capability.leaseRecovery?.nextCommand
          || sync?.nextCommand
          || segmentReceipt?.nextCommand
          || callback?.nextCommand
          || maintenance?.nextCommand
          || status?.nextCommand
          || recoveryPlan.nextCommand
          || "resolve_boundary_hold",
      commandId: stableToken("handoff-cmd", [runtimeScope.restartToken, action, workflow?.commandId]),
      runtime: Object.freeze({
        tenantId: runtimeScope.tenantId || "",
        workspaceId: runtimeScope.workspaceId || "",
        actorId: permissionBoundary.actorId || capability.actorId || "",
        requestId: runtimeScope.requestId || "",
        statusChannel: capability.statusChannel || runtimeScope.statusChannel || "",
        idempotencyKey: capability.idempotencyKey || runtimeScope.idempotencyKey || "",
        restartToken: runtimeScope.restartToken || "",
        statusSnapshotKey: snapshot?.statusSnapshotKey || adapterStatusSnapshot.statusSnapshotKey || persistedRuntime.statusSnapshotKey || "",
      }),
      guards: Object.freeze({
        requiredPermission: capability.requiredPermission || "",
        permissionLeaseState: capability.leaseRequired ? capability.leaseRecovery?.state || "blocked" : "not-required",
        permissionLeaseToken: capability.permissionLease?.token || "",
        adapterStatusState: status?.state || adapterStatusLedger.state || "unobserved",
        providerSyncState: sync?.state || "not-applicable",
        segmentSyncReceiptState: segmentReceipt?.state || "not-required",
        segmentSyncReceiptToken: segmentReceipt?.receiptToken || "",
        providerMaintenanceState: maintenance?.state || "not-required",
        providerMaintenanceWindowId: maintenance?.windowId || "",
        providerMaintenanceRetryAfterMs: maintenance?.retryAfterMs ?? 0,
        restartSafe: persistedRuntime.restartSafe === true,
      }),
      blockedBy: freezeArray([...new Set(blockedBy)].sort()),
    });
  }).sort((left, right) => {
    if (left.state !== right.state) return left.state.localeCompare(right.state);
    return left.action.localeCompare(right.action);
  });
  const blocked = rows.filter((row) => row.state === "blocked");
  const waiting = rows.filter((row) => row.state === "waiting");
  const queueable = rows.filter((row) => row.queueable);

  return Object.freeze({
    protocol: "aios.scope.adapter-handoff-manifest.v1",
    jobName,
    state: blocked.length > 0 ? "blocked" : waiting.length > 0 ? "waiting" : queueable.length > 0 ? "queueable" : "not-required",
    acceptedForAdapter: blocked.length === 0 && waiting.length === 0 && queueable.length > 0,
    acceptedForPreview: true,
    statusChannel: runtimeScope.statusChannel || "",
    restartToken: runtimeScope.restartToken || "",
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    waitingRows: freezeArray(waiting),
    queueableRows: freezeArray(queueable),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      waiting: waiting.length,
      queueable: queueable.length,
      leaseBlocked: rows.filter((row) => row.blockedBy.some((reason) => reason.includes("permission-lease"))).length,
      statusBlocked: rows.filter((row) => row.blockedBy.some((reason) => reason.includes("adapter-status"))).length,
      providerSyncBlocked: rows.filter((row) => row.blockedBy.some((reason) => reason.includes("provider-sync"))).length,
      providerMaintenanceBlocked: rows.filter((row) => row.blockedBy.some((reason) => reason.includes("provider-maintenance"))).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.command || waiting[0]?.command || queueable[0]?.command || "observe",
      reason: blocked.length > 0
        ? "Mailchimp adapter handoff has blocking scope, lease, status, or restart guards."
        : waiting.length > 0
          ? "Mailchimp adapter handoff is waiting on provider status or sync confirmation."
          : queueable.length > 0
            ? "Mailchimp adapter handoff rows are queueable from scope resolution."
            : "No Mailchimp adapter handoff rows were produced.",
    }),
  });
}

function createScopePreviewCard(declaration = {}, references = [], permissionBoundary = {}) {
  const unresolvedRefs = references
    .filter((reference) => reference.source === declaration.name && reference.resolved === false)
    .map((reference) => `${reference.relation}:${reference.target}`);
  const heldCapability = declaration.kind === "capability"
    ? toArray(permissionBoundary.heldCapabilities).find((capability) => capability.action === declaration.name)
    : null;
  const leaseHold = heldCapability
    ? toArray(heldCapability.reasons).some((reason) => compactString(reason).includes("permission-lease"))
    : false;

  return Object.freeze({
    kind: declaration.kind,
    name: declaration.name,
    index: declaration.index,
    previewState: unresolvedRefs.length > 0 || heldCapability
      ? "blocked"
      : declaration.kind === "capability" && toArray(permissionBoundary.capabilities).some((capability) => capability.action === declaration.name)
        ? "adapter-boundary"
        : "ready",
    sourceRange: declaration.sourceRange,
    unresolvedReferences: freezeArray(unresolvedRefs),
    boundaryHold: heldCapability ? Object.freeze({
      action: heldCapability.action,
      requiredPermission: heldCapability.requiredPermission,
      permissionLease: heldCapability.permissionLease,
      reasons: heldCapability.reasons,
    }) : null,
    nextCommand: unresolvedRefs.length > 0
      ? "declare_missing_symbol"
      : heldCapability
        ? leaseHold ? "refresh_mailchimp_permission_lease" : "resolve_boundary_hold"
        : "observe",
  });
}

function receiptMatchesPreviewRow(receipt = {}, row = {}) {
  return Boolean(
    (receipt.acceptanceToken && receipt.acceptanceToken === row.acceptanceToken)
      || (receipt.rowId && receipt.rowId === row.rowId)
      || (receipt.jobName === row.jobName && receipt.kind === row.kind && receipt.name === row.name)
      || (!receipt.jobName && receipt.kind === row.kind && receipt.name === row.name)
  );
}

function createScopePreviewAcceptanceReceipts(job = {}, previewDecisionMatrix = {}, requestState = normalizeRequestState(), runtimeScope = {}) {
  const jobName = compactString(job.name || "anonymous");
  const clientState = job.clientState || job.requestState || {};
  const fallback = {
    jobName,
    tenantId: runtimeScope.tenantId,
    workspaceId: runtimeScope.workspaceId,
    actorId: firstString(clientState.userId, clientState.actorId, job.actor?.id, job.userId, requestState.userId),
    requestId: runtimeScope.requestId,
    statusChannel: runtimeScope.statusChannel,
  };
  const receipts = [
    ...toArray(requestState.previewAcceptanceReceipts),
    ...toArray(clientState.previewAcceptanceReceipts || clientState.previewReceipts || clientState.acceptedPreviewRows),
    ...toArray(job.previewAcceptanceReceipts || job.previewReceipts || job.acceptedPreviewRows),
  ].map((receipt) => normalizePreviewAcceptanceReceipt(receipt, fallback));
  const rows = toArray(previewDecisionMatrix.acceptanceRows);
  const observedAtMs = Date.parse(compactString(requestState.observedAt));
  const receiptRows = rows.map((row) => {
    const matching = receipts.find((receipt) => receiptMatchesPreviewRow(receipt, row)) || null;
    const missingIdentity = [
      !runtimeScope.tenantId && "tenantId",
      !runtimeScope.workspaceId && "workspaceId",
      !runtimeScope.requestId && "requestId",
      !runtimeScope.statusChannel && "statusChannel",
      !runtimeScope.idempotencyKey && "idempotencyKey",
    ].filter(Boolean);
    const expiresAtMs = Date.parse(compactString(matching?.expiresAt));
    const expired = Boolean(matching?.expiresAt && Number.isFinite(observedAtMs) && Number.isFinite(expiresAtMs) && expiresAtMs <= observedAtMs);
    const rejected = ["rejected", "revoked", "expired"].includes(compactString(matching?.state));
    const missing = [
      !matching && "receipt",
      ...missingIdentity,
      matching?.tenantId && runtimeScope.tenantId && matching.tenantId !== runtimeScope.tenantId && "tenantId",
      matching?.workspaceId && runtimeScope.workspaceId && matching.workspaceId !== runtimeScope.workspaceId && "workspaceId",
      matching?.requestId && runtimeScope.requestId && matching.requestId !== runtimeScope.requestId && "requestId",
      expired && "expiresAt",
      rejected && "state",
    ].filter(Boolean);
    const receiptState = missing.length > 0
      ? rejected
        ? "rejected"
        : expired
          ? "expired"
          : "missing"
      : matching.state === "accepted"
        ? "accepted"
        : "pending";

    return Object.freeze({
      rowId: row.rowId,
      jobName,
      kind: row.kind,
      name: row.name,
      state: receiptState,
      acceptanceToken: row.acceptanceToken,
      receiptToken: compactString(matching?.receiptToken || stableToken("preview-receipt", [
        runtimeScope.tenantId,
        runtimeScope.workspaceId,
        runtimeScope.requestId,
        row.rowId,
        row.acceptanceToken,
      ])),
      acceptedBy: compactString(matching?.acceptedBy),
      acceptedAt: compactString(matching?.acceptedAt),
      expiresAt: compactString(matching?.expiresAt),
      statusChannel: firstString(matching?.statusChannel, runtimeScope.statusChannel),
      missing: freezeArray([...new Set(missing)].sort()),
      nextCommand: receiptState === "accepted"
        ? "queue_scope_runtime_handoff"
        : receiptState === "rejected"
          ? "revise_scope_preview"
          : receiptState === "expired"
            ? "refresh_scope_preview_acceptance"
            : "accept_scope_preview_row",
    });
  }).sort((left, right) => left.state.localeCompare(right.state) || left.name.localeCompare(right.name));
  const missingRows = receiptRows.filter((row) => ["missing", "pending"].includes(row.state));
  const rejectedRows = receiptRows.filter((row) => row.state === "rejected");
  const expiredRows = receiptRows.filter((row) => row.state === "expired");
  const acceptedRows = receiptRows.filter((row) => row.state === "accepted");
  const state = rejectedRows.length > 0
    ? "rejected"
    : expiredRows.length > 0
      ? "expired"
      : missingRows.length > 0
        ? "needs-acceptance"
        : receiptRows.length > 0
          ? "accepted"
          : "not-required";

  return Object.freeze({
    protocol: "aios.scope.preview-acceptance-receipts.v1",
    jobName,
    state,
    acceptedForRuntime: !["rejected", "expired"].includes(state),
    acceptedForAdapter: state === "accepted" || state === "not-required",
    rows: freezeArray(receiptRows),
    acceptedRows: freezeArray(acceptedRows),
    missingRows: freezeArray(missingRows),
    rejectedRows: freezeArray(rejectedRows),
    expiredRows: freezeArray(expiredRows),
    counters: Object.freeze({
      rows: receiptRows.length,
      accepted: acceptedRows.length,
      missing: missingRows.length,
      rejected: rejectedRows.length,
      expired: expiredRows.length,
    }),
    nextStep: Object.freeze({
      command: rejectedRows[0]?.nextCommand
        || expiredRows[0]?.nextCommand
        || missingRows[0]?.nextCommand
        || (acceptedRows.length > 0 ? "queue_scope_runtime_handoff" : "observe"),
      reason: rejectedRows.length > 0
        ? "A preview acceptance receipt was rejected or revoked by client runtime."
        : expiredRows.length > 0
          ? "A preview acceptance receipt expired and must be refreshed before adapter handoff."
          : missingRows.length > 0
            ? "Mailchimp adapter preview rows need explicit client acceptance receipts."
            : receiptRows.length > 0
              ? "Preview acceptance receipts are ready for adapter handoff."
              : "No preview acceptance receipt is required.",
    }),
  });
}

function createScopePreviewAcceptance(job = {}, declarations = [], references = [], runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}, recoveryPlan = {}, diagnostics = [], requestState = normalizeRequestState()) {
  const jobName = compactString(job.name || "anonymous");
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const warnings = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning");
  const cards = declarations
    .map((declaration) => createScopePreviewCard(declaration, references, permissionBoundary))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.index - right.index || left.name.localeCompare(right.name));
  const blockedCards = cards.filter((card) => card.previewState === "blocked");
  const adapterCards = cards.filter((card) => card.previewState === "adapter-boundary");
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const leaseHolds = heldCapabilities.filter((capability) => toArray(capability.reasons).some((reason) => compactString(reason).includes("permission-lease")));
  const recoveryErrors = toArray(recoveryPlan.actionableErrors);
  const state = errors.length > 0 || blockedCards.length > 0 || recoveryPlan.state === "blocked"
    ? "blocked"
    : warnings.length > 0 || recoveryPlan.state === "degraded"
      ? "preview-only"
      : adapterCards.length > 0 || runtimeScope.requiresClientState || runtimeScope.requiresIdempotency
        ? "handoff-ready"
        : "ready";
  const validationItems = [
    ...errors.map((diagnostic) => ({
      code: diagnostic.code,
      severity: "error",
      message: diagnostic.message,
      nextCommand: diagnostic.nextCommand || "resolve_scope_diagnostic",
    })),
    ...warnings.map((diagnostic) => ({
      code: diagnostic.code,
      severity: "warning",
      message: diagnostic.message,
      nextCommand: diagnostic.nextCommand || "continue_preview_and_resolve_warnings",
    })),
    ...recoveryErrors.map((error) => ({
      code: error.code,
      severity: "error",
      message: error.message,
      nextCommand: error.nextCommand,
    })),
  ];
  const clientStateRequirements = [
    runtimeScope.requiresClientState && !runtimeScope.tenantId && "tenantId",
    runtimeScope.requiresClientState && !runtimeScope.workspaceId && "workspaceId",
    runtimeScope.requiresClientState && !permissionBoundary.actorId && "actorId",
    runtimeScope.requiresIdempotency && !runtimeScope.idempotencyKey && "idempotencyKey",
    runtimeScope.requiresClientState && !runtimeScope.statusChannel && "statusChannel",
  ].filter(Boolean);
  const nextCommand = recoveryPlan.nextCommand
    || validationItems.find((item) => item.severity === "error")?.nextCommand
    || (clientStateRequirements.length > 0 ? "attach_client_runtime_request" : "")
    || (state === "handoff-ready" ? "queue_scope_runtime_handoff" : "observe");
  const operatorReview = createScopeOperatorReviewPacket(
    job,
    cards,
    validationItems,
    clientStateRequirements,
    runtimeScope,
    permissionBoundary,
    persistedRuntime,
    recoveryPlan,
    state,
    nextCommand
  );
  const previewDecisionMatrix = createScopePreviewDecisionMatrix(
    job,
    cards,
    validationItems,
    clientStateRequirements,
    runtimeScope,
    persistedRuntime,
    operatorReview,
    state,
    nextCommand
  );
  const acceptanceReceipts = createScopePreviewAcceptanceReceipts(
    job,
    previewDecisionMatrix,
    requestState,
    runtimeScope
  );

  return Object.freeze({
    protocol: "aios.scope.preview-acceptance.v1",
    jobName,
    state,
    acceptedForPreview: true,
    acceptedForClientRuntime: state === "ready" || state === "handoff-ready",
    acceptedForAdapter: recoveryPlan.acceptedForAdapter === true
      && errors.length === 0
      && heldCapabilities.length === 0
      && acceptanceReceipts.acceptedForAdapter === true,
    title: compactString(job.previewTitle || job.title || jobName),
    cards: freezeArray(cards),
    validationSummary: Object.freeze({
      errors: errors.length,
      warnings: warnings.length,
      blockedSymbols: blockedCards.length,
      adapterBoundarySymbols: adapterCards.length,
      heldCapabilities: heldCapabilities.length,
      permissionLeaseHolds: leaseHolds.length,
      recoveryErrors: recoveryErrors.length,
      clientStateRequirements: clientStateRequirements.length,
      acceptanceReceipts: acceptanceReceipts.counters.rows,
      acceptedReceipts: acceptanceReceipts.counters.accepted,
      missingAcceptanceReceipts: acceptanceReceipts.counters.missing,
      rejectedAcceptanceReceipts: acceptanceReceipts.counters.rejected,
      expiredAcceptanceReceipts: acceptanceReceipts.counters.expired,
      restartSafe: persistedRuntime.restartSafe === true,
    }),
    clientRuntimeRequirements: Object.freeze({
      tenantId: runtimeScope.tenantId,
      workspaceId: runtimeScope.workspaceId,
      requestId: runtimeScope.requestId,
      statusChannel: runtimeScope.statusChannel,
      idempotencyKey: runtimeScope.idempotencyKey,
      restartToken: runtimeScope.restartToken,
      missing: freezeArray(clientStateRequirements),
      persistedKeys: Object.freeze({
        storageKey: persistedRuntime.storageKey || "",
        commandLedgerKey: persistedRuntime.commandLedgerKey || "",
        statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
        resumeCursorKey: persistedRuntime.resumeCursorKey || "",
      }),
    }),
    validationItems: freezeArray(validationItems),
    previewDecisionMatrix,
    acceptanceReceipts,
    nextStep: Object.freeze({
      command: acceptanceReceipts.state !== "accepted" && acceptanceReceipts.state !== "not-required"
        ? acceptanceReceipts.nextStep.command
        : nextCommand,
      reason: state === "blocked"
        ? "Scope diagnostics or recovery holds must be resolved before runtime adoption."
        : acceptanceReceipts.state !== "accepted" && acceptanceReceipts.state !== "not-required"
          ? acceptanceReceipts.nextStep.reason
        : state === "preview-only"
          ? "Preview can render while warnings or degraded recovery state are repaired."
          : state === "handoff-ready"
            ? "Scope is ready to hand client runtime state to downstream semantic passes."
            : "Scope is resolved for local runtime execution.",
    }),
    operatorReview,
  });
}

function createScopePreviewRuntimeHandoff(job = {}, previewAcceptance = {}, runtimeScope = {}, persistedRuntime = {}, adapterHandoffManifest = {}, clientWorkflowHandoff = {}, requestState = normalizeRequestState()) {
  const jobName = compactString(job.name || previewAcceptance.jobName || "anonymous");
  const decisionRows = [
    ...toArray(previewAcceptance.previewDecisionMatrix?.acceptanceRows),
    ...toArray(previewAcceptance.previewDecisionMatrix?.blockedRows),
  ];
  const receiptByRow = new Map(toArray(previewAcceptance.acceptanceReceipts?.rows).map((row) => [row.rowId, row]));
  const handoffByAction = new Map(toArray(adapterHandoffManifest.rows).map((row) => [row.action, row]));
  const commandByCapability = new Map(toArray(clientWorkflowHandoff.commands).map((command) => [
    compactString(command.capability || command.name || command.stepName),
    command,
  ]));
  const rows = decisionRows.map((row) => {
    const receipt = receiptByRow.get(row.rowId) || null;
    const action = compactString(row.name);
    const handoff = handoffByAction.get(action) || null;
    const workflowCommand = commandByCapability.get(action) || null;
    const accepted = receipt?.state === "accepted" || row.state === "ready";
    const adapterBlocked = handoff?.state === "blocked" || handoff?.queueable === false;
    const missing = [
      !runtimeScope.tenantId && "tenantId",
      !runtimeScope.workspaceId && "workspaceId",
      !runtimeScope.requestId && "requestId",
      !runtimeScope.statusChannel && "statusChannel",
      !runtimeScope.idempotencyKey && "idempotencyKey",
      row.state === "blocked" && "previewDecision",
      receipt && receipt.state !== "accepted" && "previewAcceptanceReceipt",
      !receipt && row.requiresAcceptance === true && "previewAcceptanceReceipt",
      adapterBlocked && "adapterHandoff",
    ].filter(Boolean);
    const state = missing.length > 0
      ? receipt?.state === "rejected"
        ? "rejected"
        : receipt?.state === "expired"
          ? "expired"
          : adapterBlocked
            ? "adapter-blocked"
            : "blocked"
      : accepted
        ? "ready"
        : "preview-only";

    return Object.freeze({
      rowId: row.rowId,
      jobName,
      kind: compactString(row.kind),
      name: action,
      lane: compactString(row.lane || "preview"),
      state,
      acceptedForRuntime: ["ready", "preview-only"].includes(state),
      acceptedForAdapter: state === "ready" && (!handoff || handoff.queueable === true),
      acceptanceToken: compactString(row.acceptanceToken),
      receiptToken: compactString(receipt?.receiptToken),
      commandId: firstString(workflowCommand?.commandId, handoff?.commandId, stableToken("preview-runtime", [
        runtimeScope.restartToken,
        runtimeScope.requestId,
        row.rowId,
      ])),
      runtime: Object.freeze({
        tenantId: runtimeScope.tenantId || "",
        workspaceId: runtimeScope.workspaceId || "",
        requestId: runtimeScope.requestId || "",
        statusChannel: runtimeScope.statusChannel || "",
        idempotencyKey: runtimeScope.idempotencyKey || "",
        restartToken: runtimeScope.restartToken || "",
        statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
      }),
      audit: Object.freeze({
        event: "aios.scope.preview_runtime_handoff",
        observedAt: compactString(requestState.observedAt),
        acceptedBy: compactString(receipt?.acceptedBy),
        acceptedAt: compactString(receipt?.acceptedAt),
        expiresAt: compactString(receipt?.expiresAt),
      }),
      missing: freezeArray([...new Set(missing)].sort()),
      nextCommand: state === "ready"
        ? handoff?.command || workflowCommand?.nextCommand || "queue_scope_runtime_handoff"
        : receipt?.nextCommand
          || row.nextCommand
          || handoff?.command
          || "accept_scope_preview_row",
    });
  }).sort((left, right) => left.state.localeCompare(right.state) || left.name.localeCompare(right.name));
  const blockedRows = rows.filter((row) => ["blocked", "adapter-blocked", "rejected", "expired"].includes(row.state));
  const readyRows = rows.filter((row) => row.state === "ready");
  const previewOnlyRows = rows.filter((row) => row.state === "preview-only");

  return Object.freeze({
    protocol: "aios.scope.preview-runtime-handoff.v1",
    jobName,
    state: blockedRows.length > 0
      ? "blocked"
      : readyRows.length > 0
        ? "ready"
        : previewOnlyRows.length > 0
          ? "preview-only"
          : "not-required",
    acceptedForRuntime: blockedRows.length === 0,
    acceptedForAdapter: blockedRows.length === 0 && previewOnlyRows.length === 0,
    statusChannel: runtimeScope.statusChannel || "",
    restartToken: runtimeScope.restartToken || "",
    rows: freezeArray(rows),
    readyRows: freezeArray(readyRows),
    blockedRows: freezeArray(blockedRows),
    previewOnlyRows: freezeArray(previewOnlyRows),
    counters: Object.freeze({
      rows: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      previewOnly: previewOnlyRows.length,
      missingReceipts: rows.filter((row) => row.missing.includes("previewAcceptanceReceipt")).length,
      adapterBlocked: rows.filter((row) => row.state === "adapter-blocked").length,
    }),
    nextStep: Object.freeze({
      command: blockedRows[0]?.nextCommand || previewOnlyRows[0]?.nextCommand || readyRows[0]?.nextCommand || "observe",
      reason: blockedRows.length > 0
        ? "Preview runtime handoff is blocked until acceptance receipts and adapter guards are satisfied."
        : previewOnlyRows.length > 0
          ? "Preview rows can render, but adapter handoff still needs explicit acceptance."
          : readyRows.length > 0
            ? "Preview rows are accepted and ready for runtime handoff."
            : "No preview runtime handoff rows are required.",
    }),
  });
}

function createScopePreviewActionPlan(job = {}, previewAcceptance = {}, previewRuntimeHandoff = {}, runtimeScope = {}, requestState = normalizeRequestState()) {
  const jobName = compactString(job.name || previewAcceptance.jobName || previewRuntimeHandoff.jobName || "anonymous");
  const decisionRows = [
    ...toArray(previewAcceptance.previewDecisionMatrix?.blockedRows),
    ...toArray(previewAcceptance.previewDecisionMatrix?.acceptanceRows),
  ];
  const receiptRows = toArray(previewAcceptance.acceptanceReceipts?.rows);
  const runtimeRows = [
    ...toArray(previewRuntimeHandoff.blockedRows),
    ...toArray(previewRuntimeHandoff.previewOnlyRows),
    ...toArray(previewRuntimeHandoff.readyRows),
  ];
  const receiptByRow = new Map(receiptRows.map((row) => [compactString(row.rowId), row]));
  const runtimeByRow = new Map(runtimeRows.map((row) => [compactString(row.rowId), row]));
  const fallbackRows = decisionRows.length > 0 ? decisionRows : runtimeRows;
  const rows = fallbackRows.map((row, index) => {
    const rowId = compactString(row.rowId || stableToken("preview-plan-row", [jobName, row.name, index]));
    const receipt = receiptByRow.get(rowId) || null;
    const runtime = runtimeByRow.get(rowId) || null;
    const missing = [
      ...toArray(row.missing),
      ...toArray(receipt?.missing),
      ...toArray(runtime?.missing),
      !runtimeScope.tenantId && "tenantId",
      !runtimeScope.workspaceId && "workspaceId",
      !runtimeScope.requestId && "requestId",
      !runtimeScope.statusChannel && "statusChannel",
      !runtimeScope.idempotencyKey && "idempotencyKey",
    ].map(compactString).filter(Boolean);
    const uniqueMissing = [...new Set(missing)].sort();
    const rejected = receipt?.state === "rejected" || runtime?.state === "rejected";
    const expired = receipt?.state === "expired" || runtime?.state === "expired";
    const adapterBlocked = runtime?.state === "adapter-blocked";
    const accepted = receipt?.state === "accepted" || runtime?.acceptedForAdapter === true;
    const state = rejected
      ? "rejected"
      : expired
        ? "expired"
        : adapterBlocked
          ? "adapter-blocked"
          : uniqueMissing.length > 0 || row.state === "blocked" || runtime?.state === "blocked"
            ? "blocked"
            : accepted || row.state === "ready"
              ? "accepted"
              : "needs-acceptance";
    const command = state === "accepted"
      ? runtime?.nextCommand || "queue_scope_runtime_handoff"
      : state === "rejected"
        ? receipt?.nextCommand || "revise_scope_preview"
        : state === "expired"
          ? receipt?.nextCommand || "refresh_scope_preview_acceptance"
        : adapterBlocked
          ? runtime?.nextCommand || "repair_adapter_handoff_manifest"
          : receipt?.nextCommand || row.nextCommand || runtime?.nextCommand || "accept_scope_preview_row";

    return Object.freeze({
      rowId,
      jobName,
      kind: compactString(row.kind || runtime?.kind || "preview"),
      name: compactString(row.name || runtime?.name || "preview"),
      lane: compactString(row.lane || runtime?.lane || "preview"),
      state,
      command,
      acceptanceToken: compactString(row.acceptanceToken || runtime?.acceptanceToken),
      receiptToken: compactString(receipt?.receiptToken || runtime?.receiptToken),
      commandId: compactString(runtime?.commandId),
      acceptedForPreview: !["rejected", "expired"].includes(state),
      acceptedForRuntime: ["accepted", "needs-acceptance"].includes(state) && !uniqueMissing.includes("tenantId") && !uniqueMissing.includes("workspaceId"),
      acceptedForAdapter: state === "accepted" && runtime?.acceptedForAdapter !== false,
      statusChannel: firstString(runtime?.runtime?.statusChannel, receipt?.statusChannel, runtimeScope.statusChannel),
      missing: freezeArray(uniqueMissing),
      userVisible: Object.freeze({
        label: compactString(row.userVisible?.label || row.name || runtime?.name || jobName),
        severity: ["rejected", "expired", "adapter-blocked", "blocked"].includes(state)
          ? "error"
          : state === "needs-acceptance"
            ? "warning"
            : "info",
        blocking: !["accepted"].includes(state),
        summary: state === "accepted"
          ? "Preview acceptance is recorded and ready for runtime handoff."
          : state === "needs-acceptance"
            ? "Review and accept this Mailchimp preview row before adapter handoff."
            : state === "adapter-blocked"
              ? "Adapter handoff metadata must be repaired before this accepted preview can run."
              : state === "expired"
                ? "Preview acceptance expired and needs a fresh receipt."
                : state === "rejected"
                  ? "Preview acceptance was rejected and the plan must be revised."
                  : "Preview row is blocked by missing runtime state or validation.",
      }),
    });
  }).sort((left, right) => left.state.localeCompare(right.state) || left.name.localeCompare(right.name));
  const blockedRows = rows.filter((row) => ["blocked", "adapter-blocked", "rejected", "expired"].includes(row.state));
  const acceptanceRows = rows.filter((row) => row.state === "needs-acceptance");
  const readyRows = rows.filter((row) => row.state === "accepted");

  return Object.freeze({
    protocol: "aios.scope.preview-action-plan.v1",
    jobName,
    state: blockedRows.length > 0
      ? "blocked"
      : acceptanceRows.length > 0
        ? "needs-acceptance"
        : readyRows.length > 0
          ? "accepted"
          : "not-required",
    acceptedForPreview: true,
    acceptedForRuntime: blockedRows.every((row) => row.state === "adapter-blocked") && acceptanceRows.length === 0,
    acceptedForAdapter: blockedRows.length === 0 && acceptanceRows.length === 0,
    observedAt: compactString(requestState.observedAt),
    statusChannel: runtimeScope.statusChannel || "",
    rows: freezeArray(rows),
    blockedRows: freezeArray(blockedRows),
    acceptanceRows: freezeArray(acceptanceRows),
    readyRows: freezeArray(readyRows),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blockedRows.length,
      needsAcceptance: acceptanceRows.length,
      accepted: readyRows.length,
      missingRuntimeState: rows.filter((row) => row.missing.length > 0).length,
    }),
    nextStep: Object.freeze({
      command: blockedRows[0]?.command || acceptanceRows[0]?.command || readyRows[0]?.command || "observe",
      reason: blockedRows.length > 0
        ? "Preview action plan has blocked, rejected, expired, or adapter-blocked rows."
        : acceptanceRows.length > 0
          ? "Preview action plan is waiting for explicit client acceptance."
          : readyRows.length > 0
            ? "Preview action plan is accepted for runtime handoff."
            : "No preview action plan is required.",
    }),
  });
}

function createScopeOperatorReviewPacket(job = {}, cards = [], validationItems = [], clientStateRequirements = [], runtimeScope = {}, permissionBoundary = {}, persistedRuntime = {}, recoveryPlan = {}, state = "ready", nextCommand = "observe") {
  const jobName = compactString(job.name || "anonymous");
  const blockedCards = toArray(cards).filter((card) => card.previewState === "blocked");
  const adapterCards = toArray(cards).filter((card) => card.previewState === "adapter-boundary");
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const leaseHolds = heldCapabilities.filter((capability) => toArray(capability.reasons).some((reason) => compactString(reason).includes("permission-lease")));
  const actionableErrors = toArray(recoveryPlan.actionableErrors);
  const errorItems = toArray(validationItems).filter((item) => item.severity === "error");
  const warningItems = toArray(validationItems).filter((item) => item.severity === "warning");
  const lanes = [
    blockedCards.length > 0 && Object.freeze({
      lane: "symbols",
      state: "blocked",
      title: "Resolve symbols",
      count: blockedCards.length,
      nextCommand: "declare_missing_symbol",
      items: freezeArray(blockedCards.map((card) => ({
        name: card.name,
        kind: card.kind,
        detail: card.unresolvedReferences[0] || card.boundaryHold?.reasons?.[0] || "",
      }))),
    }),
    heldCapabilities.length > 0 && Object.freeze({
      lane: "permissions",
      state: "blocked",
      title: "Resolve Mailchimp permissions",
      count: heldCapabilities.length,
      nextCommand: leaseHolds.length > 0 ? "refresh_mailchimp_permission_lease" : "resolve_boundary_hold",
      items: freezeArray(heldCapabilities.map((capability) => ({
        name: capability.action,
        kind: "capability",
        detail: capability.permissionLease?.token || capability.requiredPermission || capability.reasons?.[0] || "",
      }))),
    }),
    clientStateRequirements.length > 0 && Object.freeze({
      lane: "client-runtime",
      state: "needs-input",
      title: "Attach runtime identity",
      count: clientStateRequirements.length,
      nextCommand: "attach_client_runtime_request",
      items: freezeArray(clientStateRequirements.map((field) => ({
        name: field,
        kind: "runtime-field",
        detail: `Missing ${field}`,
      }))),
    }),
    adapterCards.length > 0 && Object.freeze({
      lane: "adapter-handoff",
      state: recoveryPlan.acceptedForAdapter ? "ready" : "waiting",
      title: "Mailchimp adapter handoff",
      count: adapterCards.length,
      nextCommand: recoveryPlan.acceptedForAdapter ? "queue_scope_runtime_handoff" : recoveryPlan.nextCommand || "resolve_boundary_hold",
      items: freezeArray(adapterCards.map((card) => ({
        name: card.name,
        kind: card.kind,
        detail: runtimeScope.statusChannel || persistedRuntime.statusSnapshotKey || "adapter boundary",
      }))),
    }),
    warningItems.length > 0 && Object.freeze({
      lane: "warnings",
      state: "review",
      title: "Review warnings",
      count: warningItems.length,
      nextCommand: "continue_preview_and_resolve_warnings",
      items: freezeArray(warningItems.map((item) => ({
        name: item.code,
        kind: "diagnostic",
        detail: item.message,
      }))),
    }),
  ].filter(Boolean);
  const blockingLanes = lanes.filter((lane) => lane.state === "blocked");
  const readyLanes = lanes.filter((lane) => lane.state === "ready");
  const reviewState = blockingLanes.length > 0 || errorItems.length > 0
    ? "blocked"
    : state === "handoff-ready" || readyLanes.length > 0
      ? "ready-for-handoff"
      : lanes.length > 0
        ? "needs-review"
        : "ready";

  return Object.freeze({
    protocol: "aios.scope.operator-review-packet.v1",
    jobName,
    state: reviewState,
    acceptedForPreview: true,
    acceptedForClientRuntime: reviewState !== "blocked" && clientStateRequirements.length === 0,
    acceptedForAdapter: reviewState === "ready-for-handoff"
      && recoveryPlan.acceptedForAdapter === true
      && heldCapabilities.length === 0
      && persistedRuntime.restartSafe === true,
    statusChannel: runtimeScope.statusChannel,
    restartToken: runtimeScope.restartToken,
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    lanes: freezeArray(lanes),
    validationSummary: Object.freeze({
      errors: errorItems.length,
      warnings: warningItems.length,
      blockedLanes: blockingLanes.length,
      actionableErrors: actionableErrors.length,
      permissionLeaseHolds: leaseHolds.length,
      missingClientState: clientStateRequirements.length,
      adapterSymbols: adapterCards.length,
      restartSafe: persistedRuntime.restartSafe === true,
    }),
    nextStep: Object.freeze({
      command: blockingLanes[0]?.nextCommand
        || actionableErrors[0]?.nextCommand
        || (clientStateRequirements.length > 0 ? "attach_client_runtime_request" : "")
        || nextCommand
        || "observe",
      reason: blockingLanes.length > 0
        ? "Preview contains blocking symbols or Mailchimp boundary holds."
        : clientStateRequirements.length > 0
          ? "Runtime identity fields are required before adapter handoff."
          : reviewState === "ready-for-handoff"
            ? "Scope preview can be accepted and handed to semantic runtime contracts."
            : "Scope preview can continue while non-blocking items are reviewed.",
    }),
  });
}

function previewDecisionState(card = {}) {
  if (card.previewState === "blocked") return "blocked";
  if (card.previewState === "adapter-boundary") return "ready-for-acceptance";
  return "accepted";
}

function createScopePreviewDecisionMatrix(job = {}, cards = [], validationItems = [], clientStateRequirements = [], runtimeScope = {}, persistedRuntime = {}, operatorReview = {}, state = "ready", nextCommand = "observe") {
  const jobName = compactString(job.name || "anonymous");
  const reviewLanes = toArray(operatorReview.lanes);
  const laneByItem = new Map();
  for (const lane of reviewLanes) {
    for (const item of toArray(lane.items)) {
      const key = `${compactString(item.kind)}:${compactString(item.name)}`;
      if (key !== ":") laneByItem.set(key, lane);
    }
  }
  const rows = toArray(cards).map((card) => {
    const lane = laneByItem.get(`${card.kind}:${card.name}`) || null;
    const decisionState = previewDecisionState(card);
    const missing = [
      ...toArray(card.unresolvedReferences),
      ...toArray(card.boundaryHold?.reasons),
      card.kind === "capability" && state === "handoff-ready" && !persistedRuntime.statusSnapshotKey && "statusSnapshotKey",
    ].map(compactString).filter(Boolean);
    const acceptanceToken = stableToken("preview-acceptance", [
      runtimeScope.tenantId,
      runtimeScope.workspaceId,
      runtimeScope.requestId,
      jobName,
      card.kind,
      card.name,
    ]);

    return Object.freeze({
      rowId: stableToken("preview-row", [jobName, card.kind, card.name, card.index]),
      jobName,
      kind: card.kind,
      name: card.name,
      state: missing.length > 0 || decisionState === "blocked" ? "blocked" : decisionState,
      previewState: card.previewState,
      acceptanceToken,
      lane: compactString(lane?.lane || (card.previewState === "adapter-boundary" ? "adapter-handoff" : "preview")),
      userVisible: Object.freeze({
        label: compactString(card.name),
        blocking: missing.length > 0 || card.previewState === "blocked",
        summary: missing.length > 0
          ? `Resolve ${missing[0]} before accepting preview row "${card.name}".`
          : card.previewState === "adapter-boundary"
            ? `Accept Mailchimp adapter preview row "${card.name}" for runtime handoff.`
            : `Preview row "${card.name}" is accepted for local runtime.`,
      }),
      command: missing.length > 0
        ? compactString(lane?.nextCommand || card.nextCommand || "resolve_scope_preview")
        : card.previewState === "adapter-boundary"
          ? "accept_scope_preview_row"
          : "observe",
      nextCommand: missing.length > 0
        ? compactString(lane?.nextCommand || card.nextCommand || "resolve_scope_preview")
        : card.previewState === "adapter-boundary"
          ? "queue_scope_runtime_handoff"
          : "observe",
      missing: freezeArray([...new Set(missing)].sort()),
      runtime: Object.freeze({
        tenantId: compactString(runtimeScope.tenantId),
        workspaceId: compactString(runtimeScope.workspaceId),
        requestId: compactString(runtimeScope.requestId),
        statusChannel: compactString(runtimeScope.statusChannel),
        restartToken: compactString(runtimeScope.restartToken),
        statusSnapshotKey: compactString(persistedRuntime.statusSnapshotKey),
        idempotencyKey: compactString(runtimeScope.idempotencyKey),
      }),
    });
  }).sort((left, right) => {
    if (left.state !== right.state) return left.state.localeCompare(right.state);
    return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
  });
  const blocked = rows.filter((row) => row.state === "blocked");
  const acceptance = rows.filter((row) => row.state === "ready-for-acceptance");
  const accepted = rows.filter((row) => row.state === "accepted");
  const errorItems = toArray(validationItems).filter((item) => item.severity === "error");
  const warningItems = toArray(validationItems).filter((item) => item.severity === "warning");
  const missingClientState = [...new Set(toArray(clientStateRequirements).map(compactString).filter(Boolean))].sort();

  return Object.freeze({
    protocol: "aios.scope.preview-decision-matrix.v1",
    jobName,
    state: blocked.length > 0 || errorItems.length > 0
      ? "blocked"
      : missingClientState.length > 0
        ? "needs-client-runtime"
        : acceptance.length > 0
          ? "ready-for-acceptance"
          : rows.length > 0
            ? "accepted"
            : "empty",
    acceptedForPreview: true,
    acceptedForClientRuntime: blocked.length === 0 && errorItems.length === 0 && missingClientState.length === 0,
    acceptedForAdapter: blocked.length === 0
      && errorItems.length === 0
      && missingClientState.length === 0
      && acceptance.length > 0
      && operatorReview.acceptedForAdapter === true,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    acceptanceRows: freezeArray(acceptance),
    acceptedRows: freezeArray(accepted),
    missingClientState: freezeArray(missingClientState),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      readyForAcceptance: acceptance.length,
      accepted: accepted.length,
      errors: errorItems.length,
      warnings: warningItems.length,
      missingClientState: missingClientState.length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand
        || (missingClientState.length > 0 ? "attach_client_runtime_request" : "")
        || acceptance[0]?.nextCommand
        || nextCommand
        || "observe",
      reason: blocked.length > 0
        ? "Preview rows have blocking diagnostics or boundary holds."
        : missingClientState.length > 0
          ? "Preview acceptance needs client runtime identity before handoff."
          : acceptance.length > 0
            ? "Preview rows can be accepted into runtime handoff."
            : "Preview rows are accepted for local runtime.",
    }),
  });
}

function createScopeAnalyticsExport(jobScopes = [], diagnostics = [], requestState = normalizeRequestState()) {
  const scopes = toArray(jobScopes);
  const snapshots = scopes.map((scope) => scope.historySnapshot).filter(Boolean);
  const exportRows = scopes.flatMap((scope) => createScopeExportRows(scope));
  const exportHistory = createScopeExportHistoryState(scopes, exportRows, diagnostics, requestState);
  const publicationManifest = createScopePublicationManifest(scopes, exportRows, exportHistory, diagnostics, requestState);
  const blockedRows = exportRows.filter((row) => row.blockedBy.length > 0 || row.exportable === false);
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const warnings = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning");
  const workflowHandoffs = scopes.map((scope) => scope.clientWorkflowHandoff).filter(Boolean);
  const counters = snapshots.reduce((totals, snapshot) => {
    totals.declarations += snapshot.counters?.declarations ?? 0;
    totals.references += snapshot.counters?.references ?? 0;
    totals.unresolved += snapshot.counters?.unresolved ?? 0;
    totals.mailchimpCapabilities += snapshot.counters?.mailchimpCapabilities ?? 0;
    totals.heldCapabilities += snapshot.counters?.heldCapabilities ?? 0;
    totals.permissionPostureRows += snapshot.counters?.permissionPostureRows ?? 0;
    totals.permissionPostureBlocked += snapshot.counters?.permissionPostureBlocked ?? 0;
    totals.permissionPostureCovered += snapshot.counters?.permissionPostureCovered ?? 0;
    totals.permissionPostureGrantBlocked += snapshot.counters?.permissionPostureGrantBlocked ?? 0;
    totals.permissionPostureLeaseBlocked += snapshot.counters?.permissionPostureLeaseBlocked ?? 0;
    totals.permissionLeaseHolds += snapshot.counters?.permissionLeaseHolds ?? 0;
    totals.restartCommands += snapshot.counters?.restartCommands ?? 0;
    totals.stateSlots += snapshot.counters?.stateSlots ?? 0;
    totals.adapterStatusEvents += snapshot.counters?.adapterStatusEvents ?? 0;
    totals.adapterStatusMissing += snapshot.counters?.adapterStatusMissing ?? 0;
    totals.adapterStatusFailures += snapshot.counters?.adapterStatusFailures ?? 0;
    totals.adapterStatusSnapshotRows += snapshot.counters?.adapterStatusSnapshotRows ?? 0;
    totals.adapterStatusSnapshotBlocked += snapshot.counters?.adapterStatusSnapshotBlocked ?? 0;
    totals.adapterStatusSnapshotMaterialized += snapshot.counters?.adapterStatusSnapshotMaterialized ?? 0;
    totals.actionableErrors += snapshot.counters?.actionableErrors ?? 0;
    return totals;
  }, {
    jobs: snapshots.length,
    declarations: 0,
    references: 0,
    unresolved: 0,
    mailchimpCapabilities: 0,
    heldCapabilities: 0,
    permissionPostureRows: 0,
    permissionPostureBlocked: 0,
    permissionPostureCovered: 0,
    permissionPostureGrantBlocked: 0,
    permissionPostureLeaseBlocked: 0,
    permissionLeaseHolds: 0,
    restartCommands: 0,
    stateSlots: 0,
    adapterStatusEvents: 0,
    adapterStatusMissing: 0,
    adapterStatusFailures: 0,
    adapterStatusSnapshotRows: 0,
    adapterStatusSnapshotBlocked: 0,
    adapterStatusSnapshotMaterialized: 0,
    actionableErrors: 0,
  });

  return Object.freeze({
    protocol: "aios.scope.analytics-export.v1",
    state: errors.length > 0 || exportHistory.state === "blocked" || snapshots.some((snapshot) => snapshot.state === "blocked")
      ? "blocked"
      : exportHistory.state === "stale"
        ? "stale"
      : snapshots.some((snapshot) => snapshot.state === "degraded")
        ? "degraded"
        : "ready",
    exportReady: errors.length === 0 && exportHistory.acceptedForExport === true,
    counters: Object.freeze({
      ...counters,
      exportHistoryRows: exportHistory.counters.rows,
      staleHistoryRows: exportHistory.counters.staleRows,
      disabledExportDestinations: exportHistory.counters.disabledDestinations,
      publicationRows: publicationManifest.counters.rows,
      publicationReadyRows: publicationManifest.counters.publishableRows,
      publicationBlockedRows: publicationManifest.counters.blockedRows,
      publicationReadyDestinations: publicationManifest.counters.readyDestinations,
      diagnostics: diagnostics.length,
      errors: errors.length,
      warnings: warnings.length,
    }),
    snapshots: freezeArray(snapshots),
    exportHistory,
    publicationManifest,
    exportRows: freezeArray(exportRows),
    timeline: freezeArray(snapshots
      .flatMap((snapshot) => snapshot.timeline.map((event) => ({ ...event, jobName: snapshot.jobName })))
      .sort((left, right) => left.jobName.localeCompare(right.jobName) || left.index - right.index)),
    report: Object.freeze({
      exportRows: exportRows.length,
      blockedExportRows: blockedRows.length,
      exportableRows: exportRows.filter((row) => row.exportable).length,
      statusChannels: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.report.requiredStatusChannels))]),
      restartTokens: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.report.requiredRestartTokens))]),
      adapterStatusStates: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.adapterStatusState).filter(Boolean))]),
      adapterStatusNextCommands: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.adapterStatusNextCommand).filter(Boolean))]),
      adapterStatusSnapshotStates: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.adapterStatusSnapshotState).filter(Boolean))]),
      adapterStatusSnapshotNextCommands: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.adapterStatusSnapshotNextCommand).filter(Boolean))]),
      adapterStatusSnapshotKeys: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.adapterStatusSnapshotKey).filter(Boolean))]),
      heldActions: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.report.heldActions))]),
      leaseHeldActions: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.report.leaseHeldActions || []))]),
      permissionPostureStates: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.permissionPostureState).filter(Boolean))]),
      permissionPostureFingerprints: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.permissionPostureFingerprint).filter(Boolean))]),
      permissionPostureNextCommands: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.permissionPostureNextCommand).filter(Boolean))]),
      permissionPostureBlockedActions: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.report.permissionPostureBlockedActions || []))]),
      nextCommands: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.report.nextCommand).filter(Boolean))]),
      adapterReadyJobs: snapshots.filter((snapshot) => snapshot.report.acceptedForAdapter).length,
      previewReadyJobs: snapshots.filter((snapshot) => snapshot.report.acceptedForPreview).length,
      clientRuntimeAcceptedJobs: scopes.filter((scope) => scope.previewAcceptance?.acceptedForClientRuntime).length,
      adapterAcceptedPreviewJobs: scopes.filter((scope) => scope.previewAcceptance?.acceptedForAdapter).length,
      operatorReviewStates: freezeArray([...new Set(scopes.map((scope) => scope.previewAcceptance?.operatorReview?.state).filter(Boolean))]),
      operatorReviewNextCommands: freezeArray([...new Set(scopes.map((scope) => scope.previewAcceptance?.operatorReview?.nextStep?.command).filter(Boolean))]),
      previewDecisionStates: freezeArray([...new Set(scopes.map((scope) => scope.previewAcceptance?.previewDecisionMatrix?.state).filter(Boolean))]),
      previewDecisionNextCommands: freezeArray([...new Set(scopes.map((scope) => scope.previewAcceptance?.previewDecisionMatrix?.nextStep?.command).filter(Boolean))]),
      blockedPreviewDecisionRows: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.previewDecisionMatrix?.blockedRows?.length ?? 0), 0),
      previewAcceptanceRows: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.previewDecisionMatrix?.acceptanceRows?.length ?? 0), 0),
      previewAcceptanceReceiptRows: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.rows ?? 0), 0),
      missingPreviewAcceptanceReceipts: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.missing ?? 0), 0),
      rejectedPreviewAcceptanceReceipts: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.rejected ?? 0), 0),
      expiredPreviewAcceptanceReceipts: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.expired ?? 0), 0),
      clientWorkflowStates: freezeArray([...new Set(workflowHandoffs.map((handoff) => handoff.state).filter(Boolean))]),
      clientWorkflowNextCommands: freezeArray([...new Set(workflowHandoffs.map((handoff) => handoff.nextStep?.command).filter(Boolean))]),
      blockedWorkflowCommands: workflowHandoffs.reduce((count, handoff) => count + (handoff.blockedCommands?.length ?? 0), 0),
      blockedBy: freezeArray([...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort()),
      exportHistoryState: exportHistory.state,
      exportHistoryNextCommand: exportHistory.nextCommand,
      exportDestinations: exportHistory.destinations,
      publicationState: publicationManifest.state,
      publicationId: publicationManifest.publicationId,
      publicationNextCommand: publicationManifest.nextStep.command,
      publicationLaneKeys: publicationManifest.laneKeys,
      nextExportCommand: blockedRows[0]?.nextCommand || publicationManifest.nextStep.command || exportHistory.nextCommand || "publish_scope_analytics_export",
    }),
  });
}

function createJobScope(job = {}, requestState = normalizeRequestState()) {
  const declarations = collectJobDeclarations(job);
  const { byKind, diagnostics } = buildDeclarationIndex(declarations);
  const references = [
    ...resolveCapabilityReferences(job, byKind, diagnostics),
    ...resolveMemoryReferences(job, byKind, diagnostics),
    ...resolveVerifierReferences(job, byKind, diagnostics),
  ];
  const runtimeScope = createClientRuntimeScope(job, requestState);
  const persistedRuntime = createPersistedRuntimeShape(job, runtimeScope);
  const adapterStatusLedger = createAdapterStatusLedger(job, runtimeScope, persistedRuntime);
  const providerSyncContract = createProviderSyncScopeContract(job, runtimeScope, persistedRuntime, adapterStatusLedger);
  const segmentSyncReceipts = createSegmentSyncReceiptLedger(job, requestState, runtimeScope, providerSyncContract);
  const permissionBoundary = createPermissionBoundaryMatrix(job, requestState, runtimeScope);
  const permissionPosture = createTenantPermissionPosture(job, permissionBoundary, runtimeScope, requestState);
  const providerBudget = createProviderBudgetContract(job, requestState, runtimeScope, permissionBoundary);
  const settingsAdoption = createMailchimpSettingsAdoptionContract(job, requestState, runtimeScope, permissionBoundary);
  const providerCallback = createProviderCallbackContract(job, requestState, runtimeScope, permissionBoundary);
  const providerMaintenance = createProviderMaintenanceContract(job, requestState, runtimeScope, permissionBoundary);
  const providerEventSubscriptions = createProviderEventSubscriptionContract(job, requestState, runtimeScope, permissionBoundary, providerCallback);
  const providerOperationalIncidents = createProviderOperationalIncidentContract(
    job,
    requestState,
    runtimeScope,
    providerBudget,
    providerCallback,
    providerMaintenance,
    providerEventSubscriptions,
    permissionPosture
  );
  const lifecycleGates = createMailchimpLifecycleGateContract(job, requestState, runtimeScope, permissionBoundary, settingsAdoption, providerBudget, providerMaintenance);
  const workspaceBoundary = createWorkspaceBoundaryContract(job, requestState, runtimeScope, permissionBoundary);
  const adapterStatusSnapshot = createAdapterStatusSnapshotContract(job, adapterStatusLedger, runtimeScope, persistedRuntime);
  const operationIdentity = createOperationIdentityIndex(job, runtimeScope, persistedRuntime, permissionBoundary, adapterStatusLedger, providerSyncContract);
  const recoveryPlan = createScopeRecoveryPlan(job, runtimeScope, permissionBoundary, persistedRuntime, adapterStatusSnapshot);
  const recoveryCheckpointManifest = createRecoveryCheckpointManifest(job, runtimeScope, persistedRuntime, adapterStatusSnapshot, operationIdentity, recoveryPlan);
  const clientWorkflowHandoff = createClientWorkflowHandoff(
    job,
    runtimeScope,
    permissionBoundary,
    persistedRuntime,
    adapterStatusLedger,
    recoveryPlan
  );
  const clientCommandReceipts = createClientCommandReceiptLedger(
    job,
    requestState,
    runtimeScope,
    permissionBoundary,
    recoveryPlan,
    clientWorkflowHandoff
  );
  diagnostics.push(...runtimeScope.diagnostics);
  for (const held of permissionBoundary.heldCapabilities) {
    diagnostics.push(createDiagnostic(
      "aios.scope.mailchimp_permission_boundary_hold",
      `Mailchimp capability "${held.action}" is held by scope permission boundaries.`,
      {
        jobName: job.name,
        capabilityName: held.action,
        requiredPermission: held.requiredPermission,
        reasons: held.reasons,
      }
    ));
  }
  for (const row of workspaceBoundary.quarantinedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.workspace_boundary_quarantined",
      `Mailchimp capability "${row.action}" crosses a tenant or workspace boundary without complete approval handoff.`,
      {
        jobName: job.name,
        capabilityName: row.action,
        transferToken: row.transferToken,
        sourceTenantId: row.sourceTenantId,
        sourceWorkspaceId: row.sourceWorkspaceId,
        targetTenantId: row.targetTenantId,
        targetWorkspaceId: row.targetWorkspaceId,
        blockedBy: row.blockedBy,
        nextCommand: row.nextCommand,
      }
    ));
  }
  for (const row of providerBudget.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.provider_budget_blocked",
      `Mailchimp capability "${row.action}" cannot be handed off until provider budget state recovers.`,
      {
        jobName: job.name,
        capabilityName: row.action,
        budgetId: row.budgetId,
        blockedBy: row.blockedBy,
        retryAfterMs: row.retryAfterMs,
        nextCommand: row.nextCommand,
      }
    ));
  }
  for (const row of settingsAdoption.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.mailchimp_settings_blocked",
      `Mailchimp capability "${row.action}" has incomplete provider settings for adapter handoff.`,
      {
        jobName: job.name,
        capabilityName: row.action,
        missing: row.missing,
        changedFields: row.changedFields,
        nextCommand: row.nextCommand,
      }
    ));
  }
  for (const row of lifecycleGates.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.mailchimp_lifecycle_gate_blocked",
      `Mailchimp capability "${row.action}" is blocked by lifecycle controls.`,
      {
        jobName: job.name,
        capabilityName: row.action,
        state: row.state,
        mode: row.mode,
        missing: row.missing,
        nextCommand: row.nextCommand,
      }
    ));
  }
  for (const row of providerCallback.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.provider_callback_blocked",
      `Mailchimp capability "${row.action}" needs a verified callback endpoint before adapter handoff.`,
      {
        jobName: job.name,
        capabilityName: row.action,
        callbackId: row.callbackId,
        missing: row.missing,
        nextCommand: row.nextCommand,
      }
    ));
  }
  for (const row of providerEventSubscriptions.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.provider_event_subscription_blocked",
      `Mailchimp capability "${row.action}" needs provider event subscriptions before adapter handoff.`,
      {
        jobName: job.name,
        capabilityName: row.action,
        subscriptionId: row.subscriptionId,
        callbackId: row.callbackId,
        callbackState: row.callbackState,
        missing: row.missing,
        missingEvents: row.missingEvents,
        nextCommand: row.nextCommand,
      }
    ));
  }
  for (const row of providerMaintenance.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.provider_maintenance_blocked",
      `Mailchimp capability "${row.action}" is blocked by provider maintenance window "${row.windowId || "unknown"}".`,
      {
        jobName: job.name,
        capabilityName: row.action,
        windowId: row.windowId,
        blockedBy: row.blockedBy,
        retryAfterMs: row.retryAfterMs,
        nextCommand: row.nextCommand,
      }
    ));
  }
  for (const row of providerOperationalIncidents.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.provider_operational_incident_blocked",
      `Mailchimp operational incident "${row.source}" blocks capability "${row.action}".`,
      {
        jobName: job.name,
        capabilityName: row.action,
        source: row.source,
        severity: row.severity,
        reason: row.reason,
        refs: row.refs,
        retryAfterMs: row.retryAfterMs,
        nextCommand: row.nextCommand,
      }
    ));
  }
  for (const row of segmentSyncReceipts.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.segment_sync_receipt_blocked",
      `Mailchimp audience segment sync receipt for "${row.action}" is required before adapter handoff.`,
      {
        jobName: job.name,
        capabilityName: row.action,
        segmentId: row.segmentId,
        missing: row.missing,
        nextCommand: row.nextCommand,
      }
    ));
  }
  for (const row of clientCommandReceipts.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.client_command_receipt_blocked",
      `Client command receipt for "${row.command}" is required before Mailchimp runtime handoff.`,
      {
        jobName: job.name,
        command: row.command,
        commandId: row.commandId,
        capabilityName: row.capability,
        missing: row.missing,
        nextCommand: row.nextCommand,
      }
    ));
  }
  for (const row of recoveryCheckpointManifest.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.recovery_checkpoint_blocked",
      `Recovery checkpoint for Mailchimp capability "${row.action}" is missing restart-safe persisted state.`,
      {
        jobName: job.name,
        capabilityName: row.action,
        operationId: row.operationId,
        commandId: row.commandId,
        missing: row.missing,
        nextCommand: row.nextCommand,
      }
    ));
  }
  const declarationsByKind = Object.fromEntries(
    [...DECLARATION_KINDS].map((kind) => [
      kind,
      freezeArray([...byKind[kind].values()].sort(stableSortByName).map((declaration) => ({
        kind: declaration.kind,
        name: declaration.name,
        index: declaration.index,
        sourceRange: declaration.sourceRange,
      }))),
    ])
  );
  const unresolved = references.filter((reference) => !reference.resolved);
  const historySnapshot = createScopeHistorySnapshot(
    job,
    declarations,
    references,
    runtimeScope,
    permissionBoundary,
    persistedRuntime,
    recoveryPlan,
    diagnostics,
    adapterStatusLedger,
    providerSyncContract,
    segmentSyncReceipts,
    providerBudget,
    providerCallback,
    adapterStatusSnapshot,
    providerMaintenance,
    permissionPosture
  );
  const previewAcceptance = createScopePreviewAcceptance(
    job,
    declarations,
    references,
    runtimeScope,
    permissionBoundary,
    persistedRuntime,
    recoveryPlan,
    diagnostics,
    requestState
  );
  const adapterHandoffManifest = createScopeAdapterHandoffManifest({
    jobName: compactString(job.name || "anonymous"),
    historySnapshot,
    runtimeScope,
    persistedRuntime,
    adapterStatusLedger,
    providerSyncContract,
    segmentSyncReceipts,
    providerBudget,
    settingsAdoption,
    lifecycleGates,
    providerCallback,
    providerMaintenance,
    providerOperationalIncidents,
    providerEventSubscriptions,
    clientCommandReceipts,
    adapterStatusSnapshot,
    workspaceBoundary,
    operationIdentity,
    recoveryCheckpointManifest,
    permissionBoundary,
    permissionPosture,
    recoveryPlan,
    clientWorkflowHandoff,
  });
  const adapterHandoffReceipts = createAdapterHandoffReceiptLedger(
    job,
    requestState,
    runtimeScope,
    permissionBoundary,
    adapterHandoffManifest
  );
  for (const row of adapterHandoffReceipts.blockedRows) {
    diagnostics.push(createDiagnostic(
      "aios.scope.adapter_handoff_receipt_blocked",
      `Adapter handoff receipt for Mailchimp capability "${row.action}" is required before status handoff can be considered restart-safe.`,
      {
        jobName: job.name,
        capabilityName: row.action,
        command: row.command,
        commandId: row.commandId,
        missing: row.missing,
        nextCommand: row.nextCommand,
      }
    ));
  }
  const scopeExportContext = {
    jobName: compactString(job.name || "anonymous"),
    historySnapshot,
    runtimeScope,
    persistedRuntime,
    adapterStatusLedger,
    providerSyncContract,
    segmentSyncReceipts,
    providerBudget,
    settingsAdoption,
    lifecycleGates,
    providerCallback,
    providerMaintenance,
    providerOperationalIncidents,
    providerEventSubscriptions,
    clientCommandReceipts,
    adapterStatusSnapshot,
    workspaceBoundary,
    operationIdentity,
    recoveryCheckpointManifest,
    permissionBoundary,
    permissionPosture,
    recoveryPlan,
    adapterHandoffReceipts,
    diagnostics,
  };
  const exportRows = createScopeExportRows(scopeExportContext);
  const exportHistory = createScopeExportHistoryState([scopeExportContext], exportRows, diagnostics, requestState);
  const publicationManifest = createScopePublicationManifest([scopeExportContext], exportRows, exportHistory, diagnostics, requestState);
  const publicationReceipts = createScopePublicationReceiptLedger(publicationManifest, exportHistory, requestState);
  const previewRuntimeHandoff = createScopePreviewRuntimeHandoff(
    job,
    previewAcceptance,
    runtimeScope,
    persistedRuntime,
    adapterHandoffManifest,
    clientWorkflowHandoff,
    requestState
  );
  const previewActionPlan = createScopePreviewActionPlan(
    job,
    previewAcceptance,
    previewRuntimeHandoff,
    runtimeScope,
    requestState
  );

  return Object.freeze({
    jobName: compactString(job.name || "anonymous"),
    declarations: freezeArray(declarations.sort(stableSortByName).map((declaration) => ({
      kind: declaration.kind,
      name: declaration.name,
      index: declaration.index,
      sourceRange: declaration.sourceRange,
    }))),
    declarationsByKind: Object.freeze(declarationsByKind),
    references: freezeArray(references),
    runtimeScope,
    persistedRuntime,
    adapterStatusLedger,
    providerSyncContract,
    segmentSyncReceipts,
    providerBudget,
    settingsAdoption,
    lifecycleGates,
    providerCallback,
    providerMaintenance,
    providerOperationalIncidents,
    providerEventSubscriptions,
    adapterStatusSnapshot,
    workspaceBoundary,
    operationIdentity,
    recoveryCheckpointManifest,
    permissionBoundary,
    permissionPosture,
    recoveryPlan,
    clientWorkflowHandoff,
    adapterHandoffManifest,
    adapterHandoffReceipts,
    historySnapshot,
    exportRows,
    exportHistory,
    publicationManifest,
    publicationReceipts,
    previewAcceptance,
    previewRuntimeHandoff,
    previewActionPlan,
    diagnostics: freezeArray(diagnostics),
    status: diagnostics.some((diagnostic) => diagnostic.level === "error") ? "invalid" : "resolved",
    counts: Object.freeze({
      declarations: declarations.length,
      references: references.length,
      unresolved: unresolved.length,
    }),
  });
}

export function createScopePreviewActionPlanSummary(jobScopes = []) {
  const scopes = toArray(jobScopes);
  const plans = scopes.map((scope) => scope.previewActionPlan).filter(Boolean);
  const rows = plans.flatMap((plan) => toArray(plan.rows));
  const blockedRows = rows.filter((row) => ["blocked", "adapter-blocked", "rejected", "expired"].includes(row.state));
  const acceptanceRows = rows.filter((row) => row.state === "needs-acceptance");
  const readyRows = rows.filter((row) => row.state === "accepted");
  const commands = [...new Set(rows.map((row) => row.command).filter(Boolean))].sort();

  return Object.freeze({
    protocol: "aios.scope.preview-action-plan-summary.v1",
    state: blockedRows.length > 0
      ? "blocked"
      : acceptanceRows.length > 0
        ? "needs-acceptance"
        : readyRows.length > 0
          ? "accepted"
          : "not-required",
    acceptedForPreview: true,
    acceptedForRuntime: blockedRows.length === 0 || blockedRows.every((row) => row.state === "adapter-blocked"),
    acceptedForAdapter: blockedRows.length === 0 && acceptanceRows.length === 0,
    counters: Object.freeze({
      jobs: plans.length,
      rows: rows.length,
      blocked: blockedRows.length,
      needsAcceptance: acceptanceRows.length,
      accepted: readyRows.length,
      commands: commands.length,
    }),
    commands: freezeArray(commands),
    blockedRows: freezeArray(blockedRows.map((row) => ({
      jobName: row.jobName,
      name: row.name,
      state: row.state,
      command: row.command,
      missing: row.missing,
    }))),
    acceptanceRows: freezeArray(acceptanceRows.map((row) => ({
      jobName: row.jobName,
      name: row.name,
      acceptanceToken: row.acceptanceToken,
      command: row.command,
      userVisible: row.userVisible,
    }))),
    nextStep: Object.freeze({
      command: blockedRows[0]?.command || acceptanceRows[0]?.command || readyRows[0]?.command || "observe",
      reason: blockedRows.length > 0
        ? "One or more preview action rows are blocked before runtime handoff."
        : acceptanceRows.length > 0
          ? "One or more preview action rows need client acceptance."
          : readyRows.length > 0
            ? "Preview action rows are accepted for runtime handoff."
            : "No preview action rows are required.",
    }),
  });
}

export function resolveAiosScopes(input = {}) {
  const jobs = getJobs(input);
  const requestState = normalizeRequestState(input);
  const jobScopes = jobs.map((job) => createJobScope(job, requestState));
  const diagnostics = jobScopes.flatMap((scope) => scope.diagnostics);
  const status = diagnostics.some((diagnostic) => diagnostic.level === "error") ? "blocked" : "resolved";
  const previewActionPlan = createScopePreviewActionPlanSummary(jobScopes);

  return Object.freeze({
    protocol: "aios.semantic.scope-resolution.v1",
    status,
    requestState,
    jobs: freezeArray(jobScopes),
    diagnostics: freezeArray(diagnostics),
    runtimeHandoff: createScopeRuntimeHandoff(jobScopes, requestState, diagnostics),
    previewActionPlan,
    analyticsExport: createScopeAnalyticsExport(jobScopes, diagnostics, requestState),
    summary: summarizeScopeResolution(jobScopes, diagnostics),
  });
}

export function createScopeRuntimeHandoff(jobScopes = [], requestState = normalizeRequestState(), diagnostics = []) {
  const scopes = toArray(jobScopes);
  const clientBoundJobs = scopes.filter((scope) => scope.runtimeScope?.requiresClientState);
  const idempotentJobs = scopes.filter((scope) => scope.runtimeScope?.requiresIdempotency);
  const blockedRecovery = scopes.filter((scope) => scope.recoveryPlan?.state === "blocked");
  const degradedRecovery = scopes.filter((scope) => scope.recoveryPlan?.state === "degraded");
  const previews = scopes.map((scope) => scope.previewAcceptance).filter(Boolean);
  const blockedPreviews = previews.filter((preview) => preview.state === "blocked");
  const previewOnly = previews.filter((preview) => preview.state === "preview-only");
  const missingClientState = previews.flatMap((preview) => preview.clientRuntimeRequirements?.missing || []);
  const workflowHandoffs = scopes.map((scope) => scope.clientWorkflowHandoff).filter(Boolean);
  const workflowBlocked = workflowHandoffs.flatMap((handoff) => handoff.blockedCommands || []);
  const workflowReady = workflowHandoffs.flatMap((handoff) => handoff.readyCommands || []);
  const operationalIncidents = scopes.map((scope) => scope.providerOperationalIncidents).filter(Boolean);
  const blockedOperationalIncidents = operationalIncidents.flatMap((incident) => incident.blockedRows || []);
  const degradedOperationalIncidents = operationalIncidents.flatMap((incident) => incident.degradedRows || []);
  return Object.freeze({
    stateContract: "aios.client-runtime.scope.v1",
    tenantId: requestState.tenantId,
    workspaceId: requestState.workspaceId,
    requestId: requestState.requestId,
    restartToken: requestState.restartToken,
    statusChannel: requestState.statusChannel,
    acceptedForClientRuntime: diagnostics.every((diagnostic) => diagnostic.level !== "error")
      && blockedRecovery.length === 0
      && blockedPreviews.length === 0,
    acceptedForPreview: true,
    state: blockedRecovery.length > 0
      || blockedPreviews.length > 0
      ? "blocked"
      : degradedRecovery.length > 0 || previewOnly.length > 0
        ? "degraded"
        : "ready",
    nextCommand: blockedRecovery[0]?.recoveryPlan?.nextCommand
      || workflowBlocked[0]?.nextCommand
      || blockedPreviews[0]?.nextStep?.command
      || degradedRecovery[0]?.recoveryPlan?.nextCommand
      || previewOnly[0]?.nextStep?.command
      || workflowReady[0]?.nextCommand
      || "observe",
    clientWorkflowHandoff: Object.freeze({
      protocol: "aios.client-runtime.workflow-handoff.v1",
      state: workflowBlocked.length > 0
        ? "blocked"
        : workflowReady.some((command) => command.phase === "adapter")
          ? "adapter-ready"
          : "runtime-ready",
      acceptedForRuntime: workflowBlocked.length === 0,
      acceptedForAdapter: workflowBlocked.length === 0 && workflowReady.some((command) => command.phase === "adapter"),
      commands: freezeArray(workflowHandoffs.flatMap((handoff) => handoff.commands || [])),
      blockedCommands: freezeArray(workflowBlocked),
      readyCommands: freezeArray(workflowReady),
      nextStep: Object.freeze({
        command: workflowBlocked[0]?.nextCommand || workflowReady[0]?.nextCommand || "observe",
        reason: workflowBlocked[0]?.reason || workflowReady[0]?.reason || "Client workflow handoff is reconciled.",
      }),
    }),
    providerOperationalIncidents: Object.freeze({
      protocol: "aios.client-runtime.provider-operational-incidents.v1",
      state: blockedOperationalIncidents.length > 0
        ? "blocked"
        : degradedOperationalIncidents.length > 0
          ? "degraded"
          : "clear",
      acceptedForAdapter: blockedOperationalIncidents.length === 0,
      blockedRows: freezeArray(blockedOperationalIncidents.map((row) => ({
        jobName: row.jobName,
        action: row.action,
        source: row.source,
        severity: row.severity,
        reason: row.reason,
        retryAfterMs: row.retryAfterMs,
        nextCommand: row.nextCommand,
      }))),
      degradedRows: freezeArray(degradedOperationalIncidents.map((row) => ({
        jobName: row.jobName,
        action: row.action,
        source: row.source,
        severity: row.severity,
        reason: row.reason,
        retryAfterMs: row.retryAfterMs,
        nextCommand: row.nextCommand,
      }))),
      counters: Object.freeze({
        jobs: operationalIncidents.length,
        blocked: blockedOperationalIncidents.length,
        degraded: degradedOperationalIncidents.length,
        retryable: [...blockedOperationalIncidents, ...degradedOperationalIncidents].filter((row) => row.retryAfterMs > 0).length,
      }),
      nextStep: Object.freeze({
        command: blockedOperationalIncidents[0]?.nextCommand || degradedOperationalIncidents[0]?.nextCommand || "observe",
        retryAfterMs: blockedOperationalIncidents[0]?.retryAfterMs || degradedOperationalIncidents[0]?.retryAfterMs || 0,
        reason: blockedOperationalIncidents.length > 0
          ? "Provider operational incidents block at least one Mailchimp adapter handoff."
          : degradedOperationalIncidents.length > 0
            ? "Provider operational incidents require deferred or throttled Mailchimp adapter handoff."
            : "Provider operational incidents are clear.",
      }),
    }),
    previewAcceptance: Object.freeze({
      protocol: "aios.client-runtime.scope-preview-acceptance.v1",
      acceptedJobs: previews.filter((preview) => preview.acceptedForClientRuntime).length,
      adapterAcceptedJobs: previews.filter((preview) => preview.acceptedForAdapter).length,
      blockedJobs: blockedPreviews.length,
      previewOnlyJobs: previewOnly.length,
      missingClientState: freezeArray([...new Set(missingClientState)].sort()),
      nextSteps: freezeArray([...new Map(previews
        .map((preview) => preview.nextStep)
        .filter((nextStep) => nextStep?.command)
        .map((nextStep) => [nextStep.command, nextStep])).values()]),
    }),
    jobs: freezeArray(scopes.map((scope) => ({
      jobName: scope.jobName,
      tenantId: scope.runtimeScope?.tenantId || "",
      workspaceId: scope.runtimeScope?.workspaceId || "",
      requestId: scope.runtimeScope?.requestId || "",
      idempotencyKey: scope.runtimeScope?.idempotencyKey || "",
      statusChannel: scope.runtimeScope?.statusChannel || "",
      restartToken: scope.runtimeScope?.restartToken || "",
      requiresClientState: scope.runtimeScope?.requiresClientState === true,
      requiresIdempotency: scope.runtimeScope?.requiresIdempotency === true,
      permissionBoundary: scope.permissionBoundary || null,
      permissionPosture: scope.permissionPosture || null,
      persistedRuntime: scope.persistedRuntime || null,
      adapterStatusLedger: scope.adapterStatusLedger || null,
      adapterStatusSnapshot: scope.adapterStatusSnapshot || null,
      providerCallback: scope.providerCallback || null,
      providerMaintenance: scope.providerMaintenance || null,
      workspaceBoundary: scope.workspaceBoundary || null,
      operationIdentity: scope.operationIdentity || null,
      recoveryPlan: scope.recoveryPlan || null,
      clientWorkflowHandoff: scope.clientWorkflowHandoff || null,
      adapterHandoffManifest: scope.adapterHandoffManifest || null,
      previewAcceptance: scope.previewAcceptance || null,
    }))),
    summary: Object.freeze({
      clientBoundJobs: clientBoundJobs.length,
      idempotentJobs: idempotentJobs.length,
      missingRuntimeState: scopes.filter((scope) => scope.runtimeScope?.diagnostics?.some((diagnostic) => diagnostic.level === "error")).length,
      restartSafeJobs: scopes.filter((scope) => scope.persistedRuntime?.restartSafe).length,
      persistedStateSlots: scopes.reduce((count, scope) => count + (scope.persistedRuntime?.stateSlots?.length ?? 0), 0),
      restartCommands: scopes.reduce((count, scope) => count + (scope.persistedRuntime?.commands?.length ?? 0), 0),
      resumptionJournalRows: scopes.reduce((count, scope) => count + (scope.persistedRuntime?.resumptionJournal?.counters?.rows ?? 0), 0),
      resumptionJournalBlocked: scopes.reduce((count, scope) => count + (scope.persistedRuntime?.resumptionJournal?.counters?.blocked ?? 0), 0),
      resumptionJournalReplayable: scopes.reduce((count, scope) => count + (scope.persistedRuntime?.resumptionJournal?.counters?.replayable ?? 0), 0),
      adapterStatusEvents: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.events ?? 0), 0),
      adapterStatusMissing: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.missing ?? 0), 0),
      adapterStatusFailures: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.failed ?? 0), 0),
      adapterStatusSnapshotRows: scopes.reduce((count, scope) => count + (scope.adapterStatusSnapshot?.counters?.rows ?? 0), 0),
      providerSyncRows: scopes.reduce((count, scope) => count + (scope.providerSyncContract?.counters?.rows ?? 0), 0),
      providerSyncBlocked: scopes.reduce((count, scope) => count + (scope.providerSyncContract?.counters?.blocked ?? 0), 0),
      providerSyncNeedsCursor: scopes.reduce((count, scope) => count + (scope.providerSyncContract?.counters?.needsProviderCursor ?? 0), 0),
      providerCallbackRows: scopes.reduce((count, scope) => count + (scope.providerCallback?.counters?.rows ?? 0), 0),
      providerCallbackBlocked: scopes.reduce((count, scope) => count + (scope.providerCallback?.counters?.blocked ?? 0), 0),
      providerCallbackPending: scopes.reduce((count, scope) => count + (scope.providerCallback?.counters?.pending ?? 0), 0),
      providerCallbackRows: scopes.reduce((count, scope) => count + (scope.providerCallback?.counters?.rows ?? 0), 0),
      providerCallbackBlocked: scopes.reduce((count, scope) => count + (scope.providerCallback?.counters?.blocked ?? 0), 0),
      providerCallbackPending: scopes.reduce((count, scope) => count + (scope.providerCallback?.counters?.pending ?? 0), 0),
      providerMaintenanceRows: scopes.reduce((count, scope) => count + (scope.providerMaintenance?.counters?.rows ?? 0), 0),
      providerMaintenanceBlocked: scopes.reduce((count, scope) => count + (scope.providerMaintenance?.counters?.blocked ?? 0), 0),
      providerMaintenanceDegraded: scopes.reduce((count, scope) => count + (scope.providerMaintenance?.counters?.degraded ?? 0), 0),
      providerOperationalIncidentRows: scopes.reduce((count, scope) => count + (scope.providerOperationalIncidents?.counters?.rows ?? 0), 0),
      providerOperationalIncidentBlocked: scopes.reduce((count, scope) => count + (scope.providerOperationalIncidents?.counters?.blocked ?? 0), 0),
      providerOperationalIncidentDegraded: scopes.reduce((count, scope) => count + (scope.providerOperationalIncidents?.counters?.degraded ?? 0), 0),
      providerOperationalIncidentRetryable: scopes.reduce((count, scope) => count + (scope.providerOperationalIncidents?.counters?.retryable ?? 0), 0),
      providerEventSubscriptionRows: scopes.reduce((count, scope) => count + (scope.providerEventSubscriptions?.counters?.rows ?? 0), 0),
      providerEventSubscriptionBlocked: scopes.reduce((count, scope) => count + (scope.providerEventSubscriptions?.counters?.blocked ?? 0), 0),
      providerEventSubscriptionPending: scopes.reduce((count, scope) => count + (scope.providerEventSubscriptions?.counters?.pending ?? 0), 0),
      providerEventSubscriptionMissingEvents: scopes.reduce((count, scope) => count + (scope.providerEventSubscriptions?.counters?.missingEvents ?? 0), 0),
      providerBudgetRows: scopes.reduce((count, scope) => count + (scope.providerBudget?.counters?.rows ?? 0), 0),
      providerBudgetBlocked: scopes.reduce((count, scope) => count + (scope.providerBudget?.counters?.blocked ?? 0), 0),
      providerBudgetDegraded: scopes.reduce((count, scope) => count + (scope.providerBudget?.counters?.degraded ?? 0), 0),
      settingsAdoptionRows: scopes.reduce((count, scope) => count + (scope.settingsAdoption?.counters?.rows ?? 0), 0),
      settingsAdoptionBlocked: scopes.reduce((count, scope) => count + (scope.settingsAdoption?.counters?.blocked ?? 0), 0),
      settingsAdoptionPatchRequired: scopes.reduce((count, scope) => count + (scope.settingsAdoption?.counters?.patchRequired ?? 0), 0),
      lifecycleGateRows: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.rows ?? 0), 0),
      lifecycleGateBlocked: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.blocked ?? 0), 0),
      lifecycleGateDisabled: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.disabled ?? 0), 0),
      lifecycleGateGated: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.gated ?? 0), 0),
      lifecycleCommandReceiptBlocked: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.overrideReceiptsMissing ?? 0) + (scope.lifecycleGates?.counters?.overrideReceiptsRejected ?? 0) + (scope.lifecycleGates?.counters?.overrideReceiptsExpired ?? 0), 0),
      marketingConsentRequired: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.consentRequired ?? 0), 0),
      marketingConsentBlocked: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.consentBlocked ?? 0), 0),
      marketingConsentExpired: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.consentExpired ?? 0), 0),
      workspaceBoundaryRows: scopes.reduce((count, scope) => count + (scope.workspaceBoundary?.counters?.rows ?? 0), 0),
      workspaceBoundaryTransfers: scopes.reduce((count, scope) => count + (scope.workspaceBoundary?.counters?.transfers ?? 0), 0),
      workspaceBoundaryQuarantined: scopes.reduce((count, scope) => count + (scope.workspaceBoundary?.counters?.quarantined ?? 0), 0),
      operationIdentityRows: scopes.reduce((count, scope) => count + (scope.operationIdentity?.counters?.rows ?? 0), 0),
      operationIdentityBlocked: scopes.reduce((count, scope) => count + (scope.operationIdentity?.counters?.blocked ?? 0), 0),
      recoveryCheckpointRows: scopes.reduce((count, scope) => count + (scope.recoveryCheckpointManifest?.counters?.rows ?? 0), 0),
      recoveryCheckpointBlocked: scopes.reduce((count, scope) => count + (scope.recoveryCheckpointManifest?.counters?.blocked ?? 0), 0),
      recoveryCheckpointReplayable: scopes.reduce((count, scope) => count + (scope.recoveryCheckpointManifest?.counters?.replayable ?? 0), 0),
      adapterStatusSnapshotBlocked: scopes.reduce((count, scope) => count + (scope.adapterStatusSnapshot?.counters?.blockedRows ?? 0), 0),
      adapterStatusSnapshotMaterialized: scopes.reduce((count, scope) => count + (scope.adapterStatusSnapshot?.counters?.materialized ?? 0), 0),
      mailchimpBoundaryHolds: scopes.reduce((count, scope) => count + (scope.permissionBoundary?.heldCapabilities?.length ?? 0), 0),
      permissionPostureRows: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.rows ?? 0), 0),
      permissionPostureBlocked: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.blocked ?? 0), 0),
      permissionPostureCovered: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.covered ?? 0), 0),
      permissionPostureGrantBlocked: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.grantBlocked ?? 0), 0),
      permissionPostureLeaseBlocked: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.leaseBlocked ?? 0), 0),
      permissionPostureIdentityBlocked: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.identityBlocked ?? 0), 0),
      mailchimpPermissionLeaseHolds: scopes.reduce((count, scope) => {
        return count + toArray(scope.permissionBoundary?.heldCapabilities)
          .filter((capability) => toArray(capability.reasons).some((reason) => compactString(reason).includes("permission-lease"))).length;
      }, 0),
      blockedRecoveryPlans: blockedRecovery.length,
      degradedRecoveryPlans: degradedRecovery.length,
      blockedPreviews: blockedPreviews.length,
      previewOnlyJobs: previewOnly.length,
      clientRuntimeAcceptedJobs: previews.filter((preview) => preview.acceptedForClientRuntime).length,
      adapterAcceptedPreviewJobs: previews.filter((preview) => preview.acceptedForAdapter).length,
      previewAcceptanceReceiptRows: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.rows ?? 0), 0),
      missingPreviewAcceptanceReceipts: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.missing ?? 0), 0),
      rejectedPreviewAcceptanceReceipts: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.rejected ?? 0), 0),
      expiredPreviewAcceptanceReceipts: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.expired ?? 0), 0),
      workflowBlockedCommands: workflowBlocked.length,
      workflowReadyCommands: workflowReady.length,
      adapterHandoffRows: scopes.reduce((count, scope) => count + (scope.adapterHandoffManifest?.counters?.rows ?? 0), 0),
      adapterHandoffQueueableRows: scopes.reduce((count, scope) => count + (scope.adapterHandoffManifest?.counters?.queueable ?? 0), 0),
      adapterHandoffReceiptRows: scopes.reduce((count, scope) => count + (scope.adapterHandoffReceipts?.counters?.rows ?? 0), 0),
      adapterHandoffReceiptBlocked: scopes.reduce((count, scope) => count + (scope.adapterHandoffReceipts?.counters?.blocked ?? 0), 0),
      adapterHandoffReceiptAccepted: scopes.reduce((count, scope) => count + (scope.adapterHandoffReceipts?.counters?.accepted ?? 0), 0),
      actionableErrors: scopes.reduce((count, scope) => count + (scope.recoveryPlan?.actionableErrors?.length ?? 0), 0),
    }),
  });
}

export function summarizeScopeResolution(jobScopes = [], diagnostics = []) {
  const scopes = toArray(jobScopes);
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  return Object.freeze({
    jobs: scopes.length,
    declarations: scopes.reduce((count, scope) => count + (scope.counts?.declarations ?? 0), 0),
    references: scopes.reduce((count, scope) => count + (scope.counts?.references ?? 0), 0),
    unresolved: scopes.reduce((count, scope) => count + (scope.counts?.unresolved ?? 0), 0),
    clientBoundJobs: scopes.filter((scope) => scope.runtimeScope?.requiresClientState).length,
    idempotentJobs: scopes.filter((scope) => scope.runtimeScope?.requiresIdempotency).length,
    mailchimpPermissionBoundaries: scopes.filter((scope) => scope.permissionBoundary?.capabilities?.length > 0).length,
    mailchimpBoundaryHolds: scopes.reduce((count, scope) => count + (scope.permissionBoundary?.heldCapabilities?.length ?? 0), 0),
    permissionPostureRows: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.rows ?? 0), 0),
    permissionPostureBlocked: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.blocked ?? 0), 0),
    permissionPostureCovered: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.covered ?? 0), 0),
    permissionPostureGrantBlocked: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.grantBlocked ?? 0), 0),
    permissionPostureLeaseBlocked: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.leaseBlocked ?? 0), 0),
    permissionPostureIdentityBlocked: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.identityBlocked ?? 0), 0),
    permissionPostureHandoffBlocked: scopes.reduce((count, scope) => count + (scope.permissionPosture?.counters?.handoffBlocked ?? 0), 0),
    mailchimpPermissionLeaseHolds: scopes.reduce((count, scope) => {
      return count + toArray(scope.permissionBoundary?.heldCapabilities)
        .filter((capability) => toArray(capability.reasons).some((reason) => compactString(reason).includes("permission-lease"))).length;
    }, 0),
    resumptionJournalRows: scopes.reduce((count, scope) => count + (scope.persistedRuntime?.resumptionJournal?.counters?.rows ?? 0), 0),
    resumptionJournalBlocked: scopes.reduce((count, scope) => count + (scope.persistedRuntime?.resumptionJournal?.counters?.blocked ?? 0), 0),
    resumptionJournalReplayable: scopes.reduce((count, scope) => count + (scope.persistedRuntime?.resumptionJournal?.counters?.replayable ?? 0), 0),
    adapterStatusEvents: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.events ?? 0), 0),
    adapterStatusMissing: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.missing ?? 0), 0),
    adapterStatusFailures: scopes.reduce((count, scope) => count + (scope.adapterStatusLedger?.counters?.failed ?? 0), 0),
    providerSyncRows: scopes.reduce((count, scope) => count + (scope.providerSyncContract?.counters?.rows ?? 0), 0),
    providerSyncBlocked: scopes.reduce((count, scope) => count + (scope.providerSyncContract?.counters?.blocked ?? 0), 0),
    providerSyncNeedsCursor: scopes.reduce((count, scope) => count + (scope.providerSyncContract?.counters?.needsProviderCursor ?? 0), 0),
    providerCallbackRows: scopes.reduce((count, scope) => count + (scope.providerCallback?.counters?.rows ?? 0), 0),
    providerCallbackBlocked: scopes.reduce((count, scope) => count + (scope.providerCallback?.counters?.blocked ?? 0), 0),
    providerCallbackPending: scopes.reduce((count, scope) => count + (scope.providerCallback?.counters?.pending ?? 0), 0),
    providerMaintenanceRows: scopes.reduce((count, scope) => count + (scope.providerMaintenance?.counters?.rows ?? 0), 0),
    providerMaintenanceBlocked: scopes.reduce((count, scope) => count + (scope.providerMaintenance?.counters?.blocked ?? 0), 0),
    providerMaintenanceDegraded: scopes.reduce((count, scope) => count + (scope.providerMaintenance?.counters?.degraded ?? 0), 0),
    providerOperationalIncidentRows: scopes.reduce((count, scope) => count + (scope.providerOperationalIncidents?.counters?.rows ?? 0), 0),
    providerOperationalIncidentBlocked: scopes.reduce((count, scope) => count + (scope.providerOperationalIncidents?.counters?.blocked ?? 0), 0),
    providerOperationalIncidentDegraded: scopes.reduce((count, scope) => count + (scope.providerOperationalIncidents?.counters?.degraded ?? 0), 0),
    providerOperationalIncidentRetryable: scopes.reduce((count, scope) => count + (scope.providerOperationalIncidents?.counters?.retryable ?? 0), 0),
    providerEventSubscriptionRows: scopes.reduce((count, scope) => count + (scope.providerEventSubscriptions?.counters?.rows ?? 0), 0),
    providerEventSubscriptionBlocked: scopes.reduce((count, scope) => count + (scope.providerEventSubscriptions?.counters?.blocked ?? 0), 0),
    providerEventSubscriptionPending: scopes.reduce((count, scope) => count + (scope.providerEventSubscriptions?.counters?.pending ?? 0), 0),
    providerEventSubscriptionMissingEvents: scopes.reduce((count, scope) => count + (scope.providerEventSubscriptions?.counters?.missingEvents ?? 0), 0),
    providerBudgetRows: scopes.reduce((count, scope) => count + (scope.providerBudget?.counters?.rows ?? 0), 0),
    providerBudgetBlocked: scopes.reduce((count, scope) => count + (scope.providerBudget?.counters?.blocked ?? 0), 0),
    providerBudgetDegraded: scopes.reduce((count, scope) => count + (scope.providerBudget?.counters?.degraded ?? 0), 0),
    settingsAdoptionRows: scopes.reduce((count, scope) => count + (scope.settingsAdoption?.counters?.rows ?? 0), 0),
    settingsAdoptionBlocked: scopes.reduce((count, scope) => count + (scope.settingsAdoption?.counters?.blocked ?? 0), 0),
    settingsAdoptionPatchRequired: scopes.reduce((count, scope) => count + (scope.settingsAdoption?.counters?.patchRequired ?? 0), 0),
    lifecycleGateRows: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.rows ?? 0), 0),
    lifecycleGateBlocked: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.blocked ?? 0), 0),
    lifecycleGateDisabled: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.disabled ?? 0), 0),
    lifecycleGateGated: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.gated ?? 0), 0),
    lifecycleCommandReceiptBlocked: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.overrideReceiptsMissing ?? 0) + (scope.lifecycleGates?.counters?.overrideReceiptsRejected ?? 0) + (scope.lifecycleGates?.counters?.overrideReceiptsExpired ?? 0), 0),
    marketingConsentRequired: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.consentRequired ?? 0), 0),
    marketingConsentBlocked: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.consentBlocked ?? 0), 0),
    marketingConsentExpired: scopes.reduce((count, scope) => count + (scope.lifecycleGates?.counters?.consentExpired ?? 0), 0),
    workspaceBoundaryRows: scopes.reduce((count, scope) => count + (scope.workspaceBoundary?.counters?.rows ?? 0), 0),
    workspaceBoundaryTransfers: scopes.reduce((count, scope) => count + (scope.workspaceBoundary?.counters?.transfers ?? 0), 0),
    workspaceBoundaryQuarantined: scopes.reduce((count, scope) => count + (scope.workspaceBoundary?.counters?.quarantined ?? 0), 0),
    operationIdentityRows: scopes.reduce((count, scope) => count + (scope.operationIdentity?.counters?.rows ?? 0), 0),
    operationIdentityBlocked: scopes.reduce((count, scope) => count + (scope.operationIdentity?.counters?.blocked ?? 0), 0),
    recoveryCheckpointRows: scopes.reduce((count, scope) => count + (scope.recoveryCheckpointManifest?.counters?.rows ?? 0), 0),
    recoveryCheckpointBlocked: scopes.reduce((count, scope) => count + (scope.recoveryCheckpointManifest?.counters?.blocked ?? 0), 0),
    recoveryCheckpointReplayable: scopes.reduce((count, scope) => count + (scope.recoveryCheckpointManifest?.counters?.replayable ?? 0), 0),
    blockedRecoveryPlans: scopes.filter((scope) => scope.recoveryPlan?.state === "blocked").length,
    degradedRecoveryPlans: scopes.filter((scope) => scope.recoveryPlan?.state === "degraded").length,
    actionableErrors: scopes.reduce((count, scope) => count + (scope.recoveryPlan?.actionableErrors?.length ?? 0), 0),
    previewAcceptedJobs: scopes.filter((scope) => scope.previewAcceptance?.acceptedForPreview).length,
    clientRuntimeAcceptedJobs: scopes.filter((scope) => scope.previewAcceptance?.acceptedForClientRuntime).length,
    adapterAcceptedPreviewJobs: scopes.filter((scope) => scope.previewAcceptance?.acceptedForAdapter).length,
    previewAcceptanceReceiptRows: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.rows ?? 0), 0),
    missingPreviewAcceptanceReceipts: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.missing ?? 0), 0),
    rejectedPreviewAcceptanceReceipts: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.rejected ?? 0), 0),
    expiredPreviewAcceptanceReceipts: scopes.reduce((count, scope) => count + (scope.previewAcceptance?.acceptanceReceipts?.counters?.expired ?? 0), 0),
    previewRuntimeHandoffRows: scopes.reduce((count, scope) => count + (scope.previewRuntimeHandoff?.counters?.rows ?? 0), 0),
    previewRuntimeHandoffBlocked: scopes.reduce((count, scope) => count + (scope.previewRuntimeHandoff?.counters?.blocked ?? 0), 0),
    previewRuntimeHandoffReady: scopes.reduce((count, scope) => count + (scope.previewRuntimeHandoff?.counters?.ready ?? 0), 0),
    previewActionPlanRows: scopes.reduce((count, scope) => count + (scope.previewActionPlan?.counters?.rows ?? 0), 0),
    previewActionPlanBlocked: scopes.reduce((count, scope) => count + (scope.previewActionPlan?.counters?.blocked ?? 0), 0),
    previewActionPlanNeedsAcceptance: scopes.reduce((count, scope) => count + (scope.previewActionPlan?.counters?.needsAcceptance ?? 0), 0),
    previewActionPlanAccepted: scopes.reduce((count, scope) => count + (scope.previewActionPlan?.counters?.accepted ?? 0), 0),
    workflowBlockedCommands: scopes.reduce((count, scope) => count + (scope.clientWorkflowHandoff?.blockedCommands?.length ?? 0), 0),
    workflowReadyCommands: scopes.reduce((count, scope) => count + (scope.clientWorkflowHandoff?.readyCommands?.length ?? 0), 0),
    workflowAdapterReadyJobs: scopes.filter((scope) => scope.clientWorkflowHandoff?.acceptedForAdapter).length,
    adapterHandoffReceiptRows: scopes.reduce((count, scope) => count + (scope.adapterHandoffReceipts?.counters?.rows ?? 0), 0),
    adapterHandoffReceiptBlocked: scopes.reduce((count, scope) => count + (scope.adapterHandoffReceipts?.counters?.blocked ?? 0), 0),
    adapterHandoffReceiptAccepted: scopes.reduce((count, scope) => count + (scope.adapterHandoffReceipts?.counters?.accepted ?? 0), 0),
    historySnapshots: scopes.filter((scope) => scope.historySnapshot).length,
    exportReady: errors.length === 0,
    errors: errors.length,
    readyForTypeHints: errors.length === 0,
  });
}

export function selfCheckScopeResolution() {
  const sample = {
    request: {
      tenantId: "tenant_123",
      workspaceId: "workspace_456",
      userId: "user_abc",
      requestId: "request_789",
      permissions: ["mailchimp.campaigns.write"],
      statusChannel: "tenant:tenant_123:workspace:workspace_456:aios-status",
      observedAt: "2026-01-01T00:00:00Z",
      permissionLeases: [{
        action: "campaign.update",
        permission: "mailchimp.campaigns.write",
        token: "lease_campaign_update",
        expiresAt: "2026-01-01T01:00:00Z",
      }],
    },
    jobs: [{
      name: "mailchimpCampaign",
      capabilities: [{ name: "campaign.update", boundary: "external" }],
      memory: [{ name: "campaignDraft", mode: "persistent" }],
      steps: [{ name: "patchCampaign", capability: "campaign.update", memoryReads: ["campaignDraft"], output: "campaignDraft" }],
      verifiers: [{ name: "approvalEvidence", truth: ["operatorApproval"] }],
      truthBoundaries: [{ name: "operatorApproval", source: "operator" }],
    }],
  };
  const resolved = resolveAiosScopes(sample);
  return Object.freeze({
    ok: resolved.status === "resolved" && resolved.summary.unresolved === 0,
    status: resolved.status,
    summary: resolved.summary,
  });
}
