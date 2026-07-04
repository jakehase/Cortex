export const surfaceId = "aios_memory-manager_supersession_048";
export const surfaceGroup = "memory-manager";
export const surfaceName = "supersession";

const ACCEPTABLE_STATES = new Set(["draft", "preview", "accepted", "rejected"]);
const REQUEST_ORIGINS = new Set(["client", "kernel", "scheduler", "import"]);
const TERMINAL_PERSISTED_STATUSES = new Set(["accepted", "rejected"]);
const RECOVERABLE_PERSISTED_STATUSES = new Set(["draft", "preview", "needs_validation", "recovery_conflict"]);
const COMMAND_ACTIONS = new Set(["preview", "accept", "reject", "recover"]);
const LIFECYCLE_MODES = new Set(["manual", "scheduled", "automatic"]);
const SCHEDULING_POLICIES = new Set(["disabled", "next_window", "immediate"]);
const CLIENT_HANDOFF_MODES = new Set(["inline", "modal", "route", "background"]);
const CLIENT_RESUME_STRATEGIES = new Set(["preserve_view", "open_handoff", "return_to_origin"]);
const CHECKPOINT_HASH_ALGORITHM = "aios-supersession-fnv1a-v1";
const COMMAND_JOURNAL_LIMIT = 20;
const ANALYTICS_HISTORY_LIMIT = 12;
const ANALYTICS_TREND_WINDOW = 5;
const ANALYTICS_EXPORT_FORMATS = new Set(["json", "jsonl", "csv"]);
const PROVIDER_CAPABILITY_REQUIREMENTS = {
  state: ["memory.supersession.state.write", "memory.supersession.state.read"],
  memory: ["memory.record.activate", "memory.record.supersede"],
  audit: ["memory.supersession.audit.publish"],
  schedule: ["memory.supersession.schedule.enqueue"],
  handoff: ["kernel.workflow.handoff.resume"]
};
const PROVIDER_SERVICE_OPERATION_REQUIREMENTS = {
  state: {
    operation: "persist_supersession_state",
    method: "PUT",
    idempotent: true,
    requiredWhen: "always"
  },
  memory: {
    operation: "apply_memory_supersession",
    method: "POST",
    idempotent: true,
    requiredWhen: "accepted"
  },
  audit: {
    operation: "publish_supersession_proof",
    method: "POST",
    idempotent: true,
    requiredWhen: "proof_required"
  },
  schedule: {
    operation: "enqueue_supersession_lifecycle",
    method: "POST",
    idempotent: true,
    requiredWhen: "scheduled"
  },
  handoff: {
    operation: "resume_client_workflow",
    method: "POST",
    idempotent: true,
    requiredWhen: "always"
  }
};
const OPERATIONAL_SEVERITY_RANK = {
  info: 0,
  warning: 1,
  degraded: 2,
  error: 3
};
const ROLE_PERMISSION_GRANTS = {
  owner: ["preview", "accept", "reject", "recover", "audit"],
  admin: ["preview", "accept", "reject", "recover", "audit"],
  editor: ["preview", "recover"],
  auditor: ["preview", "audit"],
  viewer: ["preview"],
  kernel: ["preview", "accept", "reject", "recover", "audit"]
};
const ACTION_PERMISSION = {
  preview: "preview",
  accept: "accept",
  reject: "reject",
  recover: "recover"
};
const WORKSPACE_PRIVILEGED_ROLES = new Set(["owner", "admin", "kernel"]);
const MAILCHIMP_SUPERSESSION_EVENT_KINDS = new Set(["audience-sync", "campaign-sync", "segment-sync", "automation-sync"]);
const MAILCHIMP_SUPERSESSION_REQUIRED_IDENTIFIERS = ["audienceId"];

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMemoryRecord(value, fallbackId) {
  const record = asObject(value);
  const scope = asObject(record.scope);
  const facts = asArray(record.facts).filter((fact) => typeof fact === "string" && fact.trim());
  const tags = asArray(record.tags).filter((tag) => typeof tag === "string" && tag.trim());

  return {
    id: cleanString(record.id) || fallbackId,
    title: cleanString(record.title) || fallbackId,
    sourceUri: typeof record.sourceUri === "string" ? record.sourceUri : null,
    tenantId: cleanString(record.tenantId) || cleanString(scope.tenantId),
    workspaceId: cleanString(record.workspaceId) || cleanString(scope.workspaceId),
    version: Number.isFinite(record.version) ? record.version : null,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    confidence: Number.isFinite(record.confidence) ? Math.max(0, Math.min(1, record.confidence)) : null,
    supersedes: cleanString(record.supersedes),
    facts,
    tags
  };
}

function normalizeRequestContext(value) {
  const context = asObject(value);
  const client = asObject(context.client);
  const route = asObject(context.route);
  const workflow = asObject(context.workflow);
  const sessionId =
    typeof context.sessionId === "string" && context.sessionId.trim()
      ? context.sessionId.trim()
      : typeof client.sessionId === "string" && client.sessionId.trim()
        ? client.sessionId.trim()
        : null;
  const requestId =
    typeof context.requestId === "string" && context.requestId.trim()
      ? context.requestId.trim()
      : typeof client.requestId === "string" && client.requestId.trim()
        ? client.requestId.trim()
        : null;
  const origin = REQUEST_ORIGINS.has(context.origin) ? context.origin : "client";

  return {
    requestId,
    sessionId,
    origin,
    client: {
      id: typeof client.id === "string" && client.id.trim() ? client.id.trim() : "hosted-kernel-client",
      view:
        typeof client.view === "string" && client.view.trim()
          ? client.view.trim()
          : "memory-supersession",
      capability:
        typeof client.capability === "string" && client.capability.trim()
          ? client.capability.trim()
          : "memory.supersession"
    },
    route: {
      current:
        typeof route.current === "string" && route.current.trim()
          ? route.current.trim()
          : "memory-manager/supersession/preview",
      returnTo: typeof route.returnTo === "string" && route.returnTo.trim() ? route.returnTo.trim() : null
    },
    workflow: {
      id:
        typeof workflow.id === "string" && workflow.id.trim()
          ? workflow.id.trim()
          : `supersession:${requestId || sessionId || "anonymous"}`,
      step:
        typeof workflow.step === "string" && workflow.step.trim()
          ? workflow.step.trim()
          : "preview",
      handoffLabel:
        typeof workflow.handoffLabel === "string" && workflow.handoffLabel.trim()
          ? workflow.handoffLabel.trim()
          : "Review memory replacement"
    }
  };
}

function normalizePermissionList(value) {
  return new Set(asArray(value).filter((permission) => cleanString(permission)).map((permission) => permission.trim()));
}

function normalizeWorkspaceGrant(value, index) {
  const grant = asObject(value);
  const actions = normalizePermissionList(grant.actions || grant.permissions);

  return {
    id: cleanString(grant.id) || `workspace-grant-${index + 1}`,
    tenantId: cleanString(grant.tenantId) || null,
    workspaceId: cleanString(grant.workspaceId) || cleanString(grant.id) || null,
    actions: actions.size > 0 ? [...actions].sort() : ["preview"],
    source: cleanString(grant.source) || "boundary"
  };
}

function normalizeWorkspaceGrantList(value) {
  return asArray(value)
    .map((grant, index) =>
      typeof grant === "string" && grant.trim()
        ? {
            id: `workspace-grant-${index + 1}`,
            tenantId: null,
            workspaceId: grant.trim(),
            actions: ["preview"],
            source: "boundary"
          }
        : normalizeWorkspaceGrant(grant, index)
    )
    .filter((grant) => grant.workspaceId);
}

function uniqueCleanStrings(values) {
  return [...new Set(asArray(values).map(cleanString).filter(Boolean))].sort();
}

function normalizeMailchimpSupersessionContext(input, current, candidate, now) {
  const source = asObject(input.mailchimp || input.mailchimpSync || asObject(input.integration).mailchimp);
  const identifiers = asObject(source.identifiers);
  const audienceId = cleanString(source.audienceId) || cleanString(source.listId) || cleanString(identifiers.audienceId);
  const campaignId = cleanString(source.campaignId) || cleanString(identifiers.campaignId);
  const segmentId = cleanString(source.segmentId) || cleanString(identifiers.segmentId);
  const automationId = cleanString(source.automationId) || cleanString(identifiers.automationId);
  const requestedEventKinds = uniqueCleanStrings(source.eventKinds || source.events)
    .map((eventKind) => eventKind.toLowerCase());
  const currentTags = uniqueCleanStrings(current.tags).map((tag) => tag.toLowerCase());
  const candidateTags = uniqueCleanStrings(candidate.tags).map((tag) => tag.toLowerCase());
  const recordTagged = [...currentTags, ...candidateTags].some((tag) => tag.startsWith("mailchimp"));
  const eventKinds = requestedEventKinds.length > 0
    ? requestedEventKinds.filter((eventKind) => MAILCHIMP_SUPERSESSION_EVENT_KINDS.has(eventKind))
    : recordTagged
      ? ["audience-sync"]
      : [];
  const unsupportedEventKinds = requestedEventKinds.filter((eventKind) => !MAILCHIMP_SUPERSESSION_EVENT_KINDS.has(eventKind));
  const requestedMode = cleanString(source.syncMode) || cleanString(source.mode) || "delta";
  const syncMode = ["delta", "snapshot", "webhook"].includes(requestedMode) ? requestedMode : "delta";
  const externalRevision = cleanString(source.externalRevision) || cleanString(source.revision);
  const missingRequiredIdentifiers = MAILCHIMP_SUPERSESSION_REQUIRED_IDENTIFIERS.filter((identifier) => {
    if (identifier === "audienceId") return !audienceId;
    return false;
  });
  const subjectKey = [
    "mailchimp",
    audienceId || "audience-unbound",
    campaignId || segmentId || automationId || "workspace"
  ].join(":");
  const ready = missingRequiredIdentifiers.length === 0 && eventKinds.length > 0;

  return {
    schemaVersion: 1,
    provider: "mailchimp",
    generatedAt: now,
    subjectKey,
    ready,
    identifiers: {
      audienceId,
      campaignId,
      segmentId,
      automationId,
      missingRequiredIdentifiers
    },
    sync: {
      mode: syncMode,
      eventKinds,
      unsupportedEventKinds,
      externalRevision,
      lastSyncedAt: cleanString(source.lastSyncedAt) || cleanString(source.syncedAt)
    },
    recordSignals: {
      currentTagged: currentTags.some((tag) => tag.startsWith("mailchimp")),
      candidateTagged: candidateTags.some((tag) => tag.startsWith("mailchimp")),
      currentTags,
      candidateTags
    },
    validationIssues: [
      ...missingRequiredIdentifiers.map((identifier) => ({
        code: "mailchimp_required_identifier_missing",
        severity: "warning",
        field: `mailchimp.${identifier}`,
        message: `Mailchimp ${identifier} is required before supersession can externalize sync state.`
      })),
      ...unsupportedEventKinds.map((eventKind) => ({
        code: "mailchimp_event_kind_unsupported",
        severity: "warning",
        field: "mailchimp.eventKinds",
        value: eventKind,
        allowed: [...MAILCHIMP_SUPERSESSION_EVENT_KINDS].sort()
      })),
      ...(requestedMode === syncMode ? [] : [{
        code: "mailchimp_sync_mode_normalized",
        severity: "warning",
        field: "mailchimp.syncMode",
        value: requestedMode,
        normalizedValue: syncMode
      }])
    ],
    proofKey: hashStablePayload({
      surfaceId,
      provider: "mailchimp",
      subjectKey,
      currentMemoryId: current.id,
      candidateMemoryId: candidate.id,
      eventKinds,
      syncMode,
      externalRevision,
      ready
    })
  };
}

function resolveBoundaryScopeValue({ explicitValue, recordValues, fieldName, fallbackValue = null }) {
  const explicit = cleanString(explicitValue);
  const candidates = uniqueCleanStrings(recordValues);
  const recordRequired = candidates.length > 0;
  const ambiguous = candidates.length > 1;
  const mismatched = Boolean(explicit && recordRequired && !candidates.includes(explicit));
  const inferred = !explicit && candidates.length === 1 ? candidates[0] : null;
  const value = explicit || inferred || fallbackValue;
  const source = explicit
    ? "explicit_boundary"
    : inferred
      ? "memory_pair_inferred"
      : recordRequired
        ? "unresolved"
        : fallbackValue
          ? "fallback"
          : "global";

  return {
    field: fieldName,
    value,
    source,
    required: recordRequired,
    candidates,
    ambiguous,
    mismatched,
    ok: !ambiguous && !mismatched && (!recordRequired || Boolean(value)),
    reason: ambiguous
      ? `Multiple ${fieldName} values were found on the memory pair; an explicit boundary is required.`
      : mismatched
        ? `Explicit ${fieldName} ${explicit} does not match memory pair scope ${candidates.join(", ")}.`
        : value
          ? `${fieldName} resolved from ${source}.`
          : `${fieldName} is not required for this memory pair.`
  };
}

function resolveEffectiveBoundaryScope({ input, boundaryInput, current, candidate }) {
  const tenantResolution = resolveBoundaryScopeValue({
    explicitValue: boundaryInput.tenantId || input.tenantId,
    recordValues: [current.tenantId, candidate.tenantId],
    fieldName: "tenantId"
  });
  const workspaceResolution = resolveBoundaryScopeValue({
    explicitValue: boundaryInput.workspaceId || input.workspaceId,
    recordValues: [current.workspaceId, candidate.workspaceId],
    fieldName: "workspaceId"
  });
  const scopeLevel = workspaceResolution.value
    ? "workspace"
    : tenantResolution.value
      ? "tenant"
      : tenantResolution.required || workspaceResolution.required
        ? "unresolved"
        : "global";
  const issues = [tenantResolution, workspaceResolution]
    .filter((resolution) => !resolution.ok)
    .map((resolution) => ({
      code:
        resolution.field === "tenantId"
          ? resolution.ambiguous
            ? "ambiguous_tenant_boundary"
            : "tenant_boundary_mismatch"
          : resolution.ambiguous
            ? "ambiguous_workspace_boundary"
            : "workspace_boundary_mismatch",
      field: resolution.field,
      severity: "blocker",
      route: "memory-manager/supersession/scope",
      message: resolution.reason,
      candidates: resolution.candidates
    }));

  return {
    schemaVersion: 1,
    scopeLevel,
    tenant: tenantResolution,
    workspace: workspaceResolution,
    issues,
    ok: issues.length === 0
  };
}

function buildWorkspaceAuthorization({ role, permissions, grants, tenantId, workspaceId, requiredPermission }) {
  const workspaceScoped = Boolean(workspaceId);
  const roleBypass = WORKSPACE_PRIVILEGED_ROLES.has(role);
  const permissionTokens = [
    workspaceId ? `workspace:${workspaceId}` : null,
    workspaceId ? `workspace:${workspaceId}:${requiredPermission}` : null,
    tenantId && workspaceId ? `tenant:${tenantId}:workspace:${workspaceId}:${requiredPermission}` : null,
    "workspace:*",
    "workspace:*:*",
    "memory.supersession.workspace.write"
  ].filter(Boolean);
  const explicitPermission = permissionTokens.some((permission) => permissions.has(permission));
  const matchingGrant = grants.find((grant) => {
    const tenantMatches = !grant.tenantId || Boolean(tenantId && grant.tenantId === tenantId);
    const workspaceMatches = grant.workspaceId === workspaceId || grant.workspaceId === "*";
    const actionMatches = grant.actions.includes(requiredPermission) || grant.actions.includes("*");

    return tenantMatches && workspaceMatches && actionMatches;
  });
  const allowed = !workspaceScoped || roleBypass || explicitPermission || Boolean(matchingGrant);

  return {
    required: workspaceScoped,
    allowed,
    reason: allowed
      ? workspaceScoped
        ? `Workspace ${workspaceId} authorizes ${requiredPermission} for actor role ${role}.`
        : "No workspace-scoped write is required for this supersession command."
      : `Workspace ${workspaceId} requires a scoped ${requiredPermission} grant inside tenant ${tenantId || "unknown"} before state or memory writes can commit.`,
    source: !workspaceScoped
      ? "not_required"
      : roleBypass
        ? "role"
        : explicitPermission
          ? "permission"
          : matchingGrant
            ? "workspace_grant"
            : "missing",
    matchingGrantId: matchingGrant?.id || null,
    grantCount: grants.length
  };
}

function normalizeBoundaryContext(input, { requestContext, command, current, candidate }) {
  const boundaryInput = asObject(input.boundary || input.security || input.access);
  const actorInput = asObject(boundaryInput.actor || input.actor || requestContext.client);
  const role = cleanString(actorInput.role) || (requestContext.origin === "kernel" ? "kernel" : "viewer");
  const rolePermissions = ROLE_PERMISSION_GRANTS[role] || ROLE_PERMISSION_GRANTS.viewer;
  const explicitPermissions = normalizePermissionList(actorInput.permissions || boundaryInput.permissions);
  const permissions = new Set([...rolePermissions, ...explicitPermissions]);
  const requiredPermission = ACTION_PERMISSION[command.action] || "preview";
  const scopeResolution = resolveEffectiveBoundaryScope({ input, boundaryInput, current, candidate });
  const tenantId = scopeResolution.tenant.value;
  const workspaceId = scopeResolution.workspace.value;
  const workspaceGrants = normalizeWorkspaceGrantList(
    actorInput.workspaceGrants ||
      actorInput.workspacePermissions ||
      boundaryInput.workspaceGrants ||
      boundaryInput.workspacePermissions ||
      input.workspaceGrants ||
      input.workspacePermissions
  );
  const workspaceAuthorization = buildWorkspaceAuthorization({
    role,
    permissions,
    grants: workspaceGrants,
    tenantId,
    workspaceId,
    requiredPermission
  });

  return {
    tenantId,
    workspaceId,
    actor: {
      id: cleanString(actorInput.id) || requestContext.client.id,
      role,
      permissions: [...permissions].sort(),
      workspaceGrants
    },
    scopeResolution,
    requiredPermission,
    workspaceAuthorization,
    decision: {
      allowed: permissions.has(requiredPermission),
      reason: permissions.has(requiredPermission)
        ? `Actor role ${role} grants ${requiredPermission} for this supersession command.`
        : `Actor role ${role} does not grant ${requiredPermission} for this supersession command.`
    }
  };
}

function buildScopeHandoffContract({ current, candidate, boundary, requestContext, command }) {
  const currentHasTenant = Boolean(current.tenantId);
  const candidateHasTenant = Boolean(candidate.tenantId);
  const currentHasWorkspace = Boolean(current.workspaceId);
  const candidateHasWorkspace = Boolean(candidate.workspaceId);
  const memoryTenantIds = [current.tenantId, candidate.tenantId].filter(Boolean);
  const memoryWorkspaceIds = [current.workspaceId, candidate.workspaceId].filter(Boolean);
  const sameTenant =
    currentHasTenant === candidateHasTenant && (memoryTenantIds.length === 0 || current.tenantId === candidate.tenantId);
  const sameWorkspace =
    currentHasWorkspace === candidateHasWorkspace &&
    (memoryWorkspaceIds.length === 0 || current.workspaceId === candidate.workspaceId);
  const tenantInScope =
    memoryTenantIds.length === 0 || Boolean(boundary.tenantId && memoryTenantIds.every((tenantId) => tenantId === boundary.tenantId));
  const workspaceInScope =
    memoryWorkspaceIds.length === 0 ||
    Boolean(boundary.workspaceId && memoryWorkspaceIds.every((workspaceId) => workspaceId === boundary.workspaceId));
  const tenantViolation = !sameTenant
    ? "cross_tenant_memory_pair"
    : !tenantInScope
      ? "tenant_boundary_missing_or_mismatched"
      : null;
  const workspaceViolation = !sameWorkspace
    ? "cross_workspace_memory_pair"
    : !workspaceInScope
      ? "workspace_boundary_missing_or_mismatched"
      : null;
  const violations = [
    ...boundary.scopeResolution.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      route: issue.route,
      message: issue.message,
      field: issue.field,
      candidates: issue.candidates
    })),
    tenantViolation
      ? {
          code: tenantViolation,
          severity: "blocker",
          route: "memory-manager/supersession/scope",
          message: "Current and candidate memory records must remain inside the same tenant boundary."
        }
      : null,
    workspaceViolation
      ? {
          code: workspaceViolation,
          severity: "blocker",
          route: "memory-manager/supersession/scope",
          message: "Current and candidate memory records must remain inside the same workspace boundary."
        }
      : null
  ].filter(Boolean);
  const scopeLevel = boundary.workspaceId
    ? "workspace"
    : boundary.tenantId
      ? "tenant"
      : currentHasTenant || candidateHasTenant || currentHasWorkspace || candidateHasWorkspace
        ? "unresolved"
        : "global";
  const workspaceWriteAuthorized =
    scopeLevel !== "workspace" || command.action === "preview" || boundary.workspaceAuthorization.allowed;
  const isolationKey =
    scopeLevel === "workspace"
      ? `tenant:${boundary.tenantId || "unknown"}:workspace:${boundary.workspaceId}`
      : scopeLevel === "tenant"
        ? `tenant:${boundary.tenantId}`
        : scopeLevel === "global"
          ? "global:memory"
          : "unresolved:memory-supersession-scope";
  const allowScopedWrite = violations.length === 0 && boundary.decision.allowed && workspaceWriteAuthorized;

  return {
    schemaVersion: 1,
    isolationKey,
    scopeLevel,
    request: {
      workflowId: requestContext.workflow.id,
      commandId: command.id,
      action: command.action,
      origin: requestContext.origin
    },
    effectiveScope: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      tenantSource: boundary.scopeResolution.tenant.source,
      workspaceSource: boundary.scopeResolution.workspace.source,
      actorId: boundary.actor.id,
      actorRole: boundary.actor.role,
      workspaceAuthorizationSource: boundary.workspaceAuthorization.source
    },
    scopeResolution: boundary.scopeResolution,
    recordScopes: {
      current: {
        memoryId: current.id,
        tenantId: current.tenantId,
        workspaceId: current.workspaceId
      },
      candidate: {
        memoryId: candidate.id,
        tenantId: candidate.tenantId,
        workspaceId: candidate.workspaceId
      }
    },
    checks: {
      sameTenant,
      sameWorkspace,
      tenantInScope,
      workspaceInScope,
      tenantRequired: currentHasTenant || candidateHasTenant,
      workspaceRequired: currentHasWorkspace || candidateHasWorkspace
    },
    workspaceAuthorization: {
      required: scopeLevel === "workspace" && command.action !== "preview",
      allowed: workspaceWriteAuthorized,
      reason: workspaceWriteAuthorized
        ? boundary.workspaceAuthorization.reason
        : boundary.workspaceAuthorization.reason,
      source: boundary.workspaceAuthorization.source,
      matchingGrantId: boundary.workspaceAuthorization.matchingGrantId,
      grantCount: boundary.workspaceAuthorization.grantCount
    },
    violations,
    writePolicy: {
      allowPreview: sameTenant && sameWorkspace,
      allowStateWrite: allowScopedWrite,
      allowMemoryActivation: allowScopedWrite && command.action === "accept",
      deniedReason:
        violations[0]?.message ||
        (boundary.decision.allowed
          ? workspaceWriteAuthorized
            ? null
            : boundary.workspaceAuthorization.reason
          : boundary.decision.reason)
    },
    auditHandoff: {
      route: "memory-manager/audit/events",
      scopeSubject: isolationKey,
      proofPartition: `${surfaceId}:${isolationKey}`,
      includeBoundaryProof: true,
      boundaryProof: {
        tenantSource: boundary.scopeResolution.tenant.source,
        workspaceSource: boundary.scopeResolution.workspace.source,
        issueCodes: boundary.scopeResolution.issues.map((issue) => issue.code),
        writeAllowed: allowScopedWrite
      }
    }
  };
}

function buildBoundaryValidationChecks(current, candidate, boundary, scopeContract) {
  const scope = scopeContract || buildScopeHandoffContract({
    current,
    candidate,
    boundary,
    requestContext: { workflow: { id: "unknown" }, origin: "client" },
    command: { id: "unknown", action: "preview" }
  });
  const currentHasTenant = Boolean(current.tenantId);
  const candidateHasTenant = Boolean(candidate.tenantId);
  const currentHasWorkspace = Boolean(current.workspaceId);
  const candidateHasWorkspace = Boolean(candidate.workspaceId);
  const memoryTenantIds = [current.tenantId, candidate.tenantId].filter(Boolean);
  const memoryWorkspaceIds = [current.workspaceId, candidate.workspaceId].filter(Boolean);
  const sameTenant = scope.checks.sameTenant;
  const sameWorkspace = scope.checks.sameWorkspace;
  const tenantInScope = scope.checks.tenantInScope;
  const workspaceInScope = scope.checks.workspaceInScope;

  return [
    {
      id: "tenant-boundary-matches-memory-pair",
      ok: sameTenant && tenantInScope,
      severity: "blocker",
      message: boundary.tenantId
        ? `Supersession is scoped to tenant ${boundary.tenantId}.`
        : "Tenant boundary is required when memory records carry tenant scope."
    },
    {
      id: "workspace-boundary-matches-memory-pair",
      ok: sameWorkspace && workspaceInScope,
      severity: "blocker",
      message: boundary.workspaceId
        ? `Supersession is scoped to workspace ${boundary.workspaceId}.`
        : "Workspace boundary is required when memory records carry workspace scope."
    },
    {
      id: "actor-can-run-command",
      ok: boundary.decision.allowed,
      severity: "blocker",
      message: boundary.decision.reason
    },
    {
      id: "tenant-boundary-resolved",
      ok: boundary.scopeResolution.tenant.ok,
      severity: "blocker",
      message: boundary.scopeResolution.tenant.reason
    },
    {
      id: "workspace-boundary-resolved",
      ok: boundary.scopeResolution.workspace.ok,
      severity: "blocker",
      message: boundary.scopeResolution.workspace.reason
    },
    {
      id: "scope-contract-allows-state-write",
      ok: scope.writePolicy.allowStateWrite,
      severity: "blocker",
      message: scope.writePolicy.allowStateWrite
        ? `Scoped writes use isolation key ${scope.isolationKey}.`
        : scope.writePolicy.deniedReason || "Supersession state writes require an explicit tenant/workspace boundary."
    },
    {
      id: "workspace-write-authorized",
      ok: scope.workspaceAuthorization.allowed,
      severity: "blocker",
      message: scope.workspaceAuthorization.reason
    }
  ];
}

function buildValidationChecks(current, candidate, evidence, boundary, scopeContract, lifecycleChecks = []) {
  const evidenceCount = evidence.length;
  const retainedFacts = candidate.facts.filter((fact) => current.facts.includes(fact));
  const introducedFacts = candidate.facts.filter((fact) => !current.facts.includes(fact));
  const removedFacts = current.facts.filter((fact) => !candidate.facts.includes(fact));

  return {
    checks: [
      {
        id: "candidate-identifies-current",
        ok: Boolean(candidate.supersedes && candidate.supersedes === current.id),
        severity: "blocker",
        message: candidate.supersedes
          ? `Candidate declares supersedes=${candidate.supersedes}.`
          : "Candidate does not declare the memory it supersedes."
      },
      {
        id: "candidate-has-source",
        ok: Boolean(candidate.sourceUri || evidenceCount > 0),
        severity: "warning",
        message: "Supersession should be backed by a candidate source URI or evidence attachment."
      },
      {
        id: "candidate-adds-or-retains-facts",
        ok: retainedFacts.length > 0 || introducedFacts.length > 0,
        severity: "blocker",
        message: "Candidate must retain or introduce at least one user-visible fact."
      },
      {
        id: "candidate-confidence-present",
        ok: candidate.confidence !== null,
        severity: "warning",
        message: "Candidate confidence is recommended for explainable acceptance."
      },
      ...buildBoundaryValidationChecks(current, candidate, boundary, scopeContract),
      ...lifecycleChecks
    ],
    retainedFacts,
    introducedFacts,
    removedFacts
  };
}

function summarizeValidation(validation) {
  const blockerFailures = validation.checks.filter((check) => !check.ok && check.severity === "blocker");
  const warningFailures = validation.checks.filter((check) => !check.ok && check.severity === "warning");

  return {
    ok: blockerFailures.length === 0,
    passed: validation.checks.filter((check) => check.ok).length,
    failed: validation.checks.filter((check) => !check.ok).length,
    blockerFailures: blockerFailures.map((check) => check.id),
    warnings: warningFailures.map((check) => check.id)
  };
}

function buildReadiness(validationSummary, requestedState) {
  if (requestedState === "rejected") {
    return {
      status: "blocked",
      score: 0,
      reason: "Supersession was explicitly rejected by the caller."
    };
  }

  if (!validationSummary.ok) {
    return {
      status: "needs_validation",
      score: Math.max(0, validationSummary.passed - validationSummary.failed),
      reason: "Blocking validation checks must pass before acceptance."
    };
  }

  if (validationSummary.warnings.length > 0) {
    return {
      status: "ready_with_warnings",
      score: validationSummary.passed,
      reason: "Acceptable for preview, but warnings should be reviewed."
    };
  }

  return {
    status: "ready",
    score: validationSummary.passed,
    reason: "Candidate passes all supersession readiness checks."
  };
}

function makeAcceptToken(current, candidate) {
  return `${surfaceName}:${current.id}->${candidate.id}`;
}

function normalizeLifecycleSettings(value, { requestContext }) {
  const settings = asObject(value);
  const scheduling = asObject(settings.scheduling);
  const commands = asObject(settings.commands);
  const audit = asObject(settings.audit);
  const enabled = settings.enabled === false ? false : true;
  const mode = LIFECYCLE_MODES.has(settings.mode) ? settings.mode : "manual";
  const schedulingPolicy = SCHEDULING_POLICIES.has(scheduling.policy)
    ? scheduling.policy
    : mode === "scheduled"
      ? "next_window"
      : "disabled";

  return {
    schemaVersion: 1,
    enabled,
    mode,
    disabledReason: enabled ? null : cleanString(settings.disabledReason) || "Supersession lifecycle is disabled by settings.",
    commands: {
      preview: commands.preview === false ? false : true,
      accept: commands.accept === false ? false : true,
      reject: commands.reject === false ? false : true,
      recover: commands.recover === false ? false : true
    },
    scheduling: {
      policy: schedulingPolicy,
      windowOpensAt: cleanString(scheduling.windowOpensAt),
      windowClosesAt: cleanString(scheduling.windowClosesAt),
      timezone: cleanString(scheduling.timezone) || "UTC",
      queueName: cleanString(scheduling.queueName) || "memory-supersession",
      requestedBy: cleanString(scheduling.requestedBy) || requestContext.client.id,
      requireWindowForDecision: scheduling.requireWindowForDecision === true,
      allowPreviewOutsideWindow: scheduling.allowPreviewOutsideWindow === false ? false : true,
      maxDeferredMinutes:
        Number.isInteger(scheduling.maxDeferredMinutes) && scheduling.maxDeferredMinutes > 0
          ? Math.min(scheduling.maxDeferredMinutes, 10080)
          : 1440
    },
    audit: {
      requireProof: audit.requireProof === false ? false : true,
      proofRoute: cleanString(audit.proofRoute) || "memory-manager/audit/events",
      includeFactDeltas: audit.includeFactDeltas === false ? false : true
    }
  };
}

function compareIsoTime(left, right) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return null;
  }

  return leftTime - rightTime;
}

function readIsoTime(value) {
  if (!value) {
    return { value: null, millis: null, valid: true };
  }

  const millis = Date.parse(value);

  return {
    value,
    millis: Number.isFinite(millis) ? millis : null,
    valid: Number.isFinite(millis)
  };
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function hashStablePayload(value) {
  const text = stableJson(value);
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildCheckpointDigestPayload({
  stateKey,
  revision,
  status,
  workflowId,
  acceptToken,
  currentMemoryId,
  candidateMemoryId
}) {
  return {
    surfaceId,
    stateKey,
    revision,
    status,
    workflowId,
    acceptToken,
    currentMemoryId,
    candidateMemoryId
  };
}

function normalizeCommandJournalEntry(value, index) {
  const entry = asObject(value);
  const result = asObject(entry.result);
  const idempotencyKey = cleanString(entry.idempotencyKey) || cleanString(entry.key);

  return idempotencyKey
    ? {
        sequence: Number.isInteger(entry.sequence) && entry.sequence >= 0 ? entry.sequence : index + 1,
        commandId: cleanString(entry.commandId) || cleanString(entry.id) || `journal-command-${index + 1}`,
        action: COMMAND_ACTIONS.has(entry.action) ? entry.action : cleanString(entry.action) || "preview",
        idempotencyKey,
        status: cleanString(entry.status) || cleanString(result.status) || "unknown",
        effect: cleanString(entry.effect) || cleanString(result.effect) || "unknown",
        revision: Number.isInteger(entry.revision) && entry.revision >= 0 ? entry.revision : null,
        handledAt: cleanString(entry.handledAt) || cleanString(entry.at),
        stateKey: cleanString(entry.stateKey)
      }
    : null;
}

function normalizeCommandJournal(value) {
  return asArray(value)
    .map(normalizeCommandJournalEntry)
    .filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-COMMAND_JOURNAL_LIMIT);
}

function buildSchedulingDecision(settings, command, now) {
  const nowTime = readIsoTime(now);
  const opensAt = readIsoTime(settings.scheduling.windowOpensAt);
  const closesAt = readIsoTime(settings.scheduling.windowClosesAt);
  const enabledBySettings = settings.enabled && settings.scheduling.policy !== "disabled";
  const decisionCommand = command.action === "accept" || command.action === "reject";
  const previewBypass =
    (command.action === "preview" || command.action === "recover") &&
    settings.scheduling.allowPreviewOutsideWindow;
  const windowOrderValid =
    opensAt.valid &&
    closesAt.valid &&
    (!opensAt.millis || !closesAt.millis || opensAt.millis < closesAt.millis);
  const timestampsValid = nowTime.valid && opensAt.valid && closesAt.valid;
  const missingRequiredWindow =
    settings.scheduling.requireWindowForDecision && decisionCommand && !opensAt.value && !closesAt.value;
  const windowOpened = !opensAt.millis || !nowTime.millis || nowTime.millis >= opensAt.millis;
  const windowClosed = Boolean(closesAt.millis && nowTime.millis && nowTime.millis > closesAt.millis);
  const deferredMinutes =
    opensAt.millis && nowTime.millis && opensAt.millis > nowTime.millis
      ? Math.ceil((opensAt.millis - nowTime.millis) / 60000)
      : 0;
  const deferLimitExceeded = deferredMinutes > settings.scheduling.maxDeferredMinutes;

  let state = "disabled";
  let reason = "Scheduling is disabled by lifecycle settings.";

  if (!settings.enabled) {
    state = "lifecycle_disabled";
    reason = settings.disabledReason;
  } else if (previewBypass) {
    state = "preview_bypass";
    reason = "Preview and recovery commands may run outside scheduling windows.";
  } else if (!enabledBySettings) {
    state = "disabled";
    reason = "No scheduling queue is configured for lifecycle decisions.";
  } else if (!timestampsValid || !windowOrderValid) {
    state = "invalid_window";
    reason = "Scheduling window timestamps must be valid ISO dates and close after they open.";
  } else if (missingRequiredWindow) {
    state = "window_required";
    reason = "Decision commands require an explicit scheduling window.";
  } else if (windowClosed) {
    state = "window_expired";
    reason = "The configured scheduling window has already closed.";
  } else if (!windowOpened) {
    state = deferLimitExceeded ? "defer_limit_exceeded" : "waiting_for_window";
    reason = deferLimitExceeded
      ? `Window opens in ${deferredMinutes} minute(s), beyond the ${settings.scheduling.maxDeferredMinutes} minute deferral limit.`
      : `Window opens in ${deferredMinutes} minute(s).`;
  } else {
    state = settings.scheduling.policy === "immediate" ? "ready_immediately" : "ready_for_window";
    reason = `Scheduling can enqueue on ${settings.scheduling.queueName}.`;
  }

  const readyToEnqueue = state === "ready_immediately" || state === "ready_for_window";

  return {
    schemaVersion: 1,
    state,
    reason,
    readyToEnqueue,
    enabledBySettings,
    decisionCommand,
    policy: settings.scheduling.policy,
    queueName: settings.scheduling.queueName,
    requestedBy: settings.scheduling.requestedBy,
    window: {
      opensAt: opensAt.value,
      closesAt: closesAt.value,
      timezone: settings.scheduling.timezone,
      timestampsValid,
      orderValid: windowOrderValid,
      opened: windowOpened,
      closed: windowClosed,
      deferredMinutes,
      maxDeferredMinutes: settings.scheduling.maxDeferredMinutes,
      requireWindowForDecision: settings.scheduling.requireWindowForDecision
    },
    controls: {
      allowPreviewOutsideWindow: settings.scheduling.allowPreviewOutsideWindow,
      holdUntil: state === "waiting_for_window" ? opensAt.value : null,
      expiresAt: closesAt.value,
      deferLimitExceeded
    }
  };
}

function buildLifecycleSettingsControlPlane({ settings, command, schedulingDecision, validationSummary }) {
  const issues = [];
  const commandToggles = Object.entries(settings.commands).map(([action, enabled]) => ({
    action,
    enabled,
    route: `memory-manager/supersession/${action}`,
    settingPath: `commands.${action}`,
    decisionCommand: action === "accept" || action === "reject"
  }));
  const decisionCommandsEnabled = commandToggles.filter((toggle) => toggle.decisionCommand && toggle.enabled);
  const patch = (settingPath, value, reason) => ({ settingPath, value, reason });

  if (!settings.enabled) {
    issues.push({
      code: "lifecycle_disabled",
      severity: "blocker",
      route: "memory-manager/supersession/settings",
      message: settings.disabledReason,
      affectedCommands: commandToggles.map((toggle) => toggle.action),
      suggestedPatch: patch("enabled", true, "Enable lifecycle controls before supersession commands can commit.")
    });
  }

  if (decisionCommandsEnabled.length === 0) {
    issues.push({
      code: "decision_commands_disabled",
      severity: "blocker",
      route: "memory-manager/supersession/settings",
      message: "At least one decision command must remain enabled so the workflow can finish.",
      affectedCommands: ["accept", "reject"],
      suggestedPatch: patch("commands.accept", true, "Re-enable accept or reject to avoid a terminally stuck workflow.")
    });
  }

  if (settings.mode === "scheduled" && settings.scheduling.policy === "disabled") {
    issues.push({
      code: "scheduled_mode_without_queue",
      severity: "blocker",
      route: "memory-manager/supersession/schedule",
      message: "Scheduled lifecycle mode requires a non-disabled scheduling policy.",
      affectedCommands: ["accept", "reject"],
      suggestedPatch: patch("scheduling.policy", "next_window", "Use the next scheduling window for decision commands.")
    });
  }

  if (settings.mode === "automatic" && settings.commands.accept === false) {
    issues.push({
      code: "automatic_accept_disabled",
      severity: "blocker",
      route: "memory-manager/supersession/settings",
      message: "Automatic lifecycle mode cannot commit if accept is disabled.",
      affectedCommands: ["accept"],
      suggestedPatch: patch("commands.accept", true, "Allow automatic mode to accept validated candidates.")
    });
  }

  if (
    settings.scheduling.requireWindowForDecision &&
    !settings.scheduling.windowOpensAt &&
    !settings.scheduling.windowClosesAt
  ) {
    issues.push({
      code: "decision_window_missing",
      severity: "blocker",
      route: "memory-manager/supersession/schedule",
      message: "Decision commands require an explicit scheduling window.",
      affectedCommands: ["accept", "reject"],
      suggestedPatch: patch("scheduling.windowOpensAt", "next-hosted-kernel-window", "Attach a concrete ISO window before commit.")
    });
  }

  if (!schedulingDecision.window.timestampsValid || !schedulingDecision.window.orderValid) {
    issues.push({
      code: "invalid_scheduling_window",
      severity: "warning",
      route: "memory-manager/supersession/schedule",
      message: schedulingDecision.reason,
      affectedCommands: ["accept", "reject"],
      suggestedPatch: patch("scheduling.windowClosesAt", null, "Clear or replace invalid scheduling timestamps.")
    });
  }

  if (settings.mode === "automatic" && !settings.audit.requireProof) {
    issues.push({
      code: "automatic_audit_proof_disabled",
      severity: "warning",
      route: "memory-manager/supersession/settings",
      message: "Automatic supersession should publish proof so hosted-kernel clients can explain the commit.",
      affectedCommands: ["accept"],
      suggestedPatch: patch("audit.requireProof", true, "Require proof for automatic lifecycle decisions.")
    });
  }

  const blockerIssues = issues.filter((issue) => issue.severity === "blocker");
  const modeCanCommit =
    blockerIssues.length === 0 &&
    settings.enabled &&
    (settings.mode !== "scheduled" || schedulingDecision.readyToEnqueue);
  const selectedCommandToggle = commandToggles.find((toggle) => toggle.action === command.action);

  return {
    schemaVersion: 1,
    status: blockerIssues.length > 0 ? "settings_blocked" : issues.length > 0 ? "settings_warn" : "settings_ready",
    selectedCommand: {
      action: command.action,
      enabledByToggle: selectedCommandToggle ? selectedCommandToggle.enabled : false,
      commitEligible:
        Boolean(selectedCommandToggle?.enabled) &&
        modeCanCommit &&
        validationSummary.blockerFailures.length === 0,
      blockedBy: blockerIssues
        .filter((issue) => issue.affectedCommands.includes(command.action))
        .map((issue) => issue.code)
    },
    issues,
    commandToggles,
    recommendedPatches: issues.map((issue) => issue.suggestedPatch).filter(Boolean),
    settingsRoutes: {
      enableDisable: "memory-manager/supersession/settings",
      scheduling: "memory-manager/supersession/schedule",
      audit: settings.audit.proofRoute
    }
  };
}

function buildLifecycleValidationChecks(settings, command, now) {
  const commandEnabled = settings.commands[command.action] !== false;
  const schedulingEnabled = settings.scheduling.policy !== "disabled";
  const schedulingDecision = buildSchedulingDecision(settings, command, now);
  const opensDelta = settings.scheduling.windowOpensAt ? compareIsoTime(now, settings.scheduling.windowOpensAt) : null;
  const closesDelta = settings.scheduling.windowClosesAt ? compareIsoTime(now, settings.scheduling.windowClosesAt) : null;
  const windowOrderDelta =
    settings.scheduling.windowOpensAt && settings.scheduling.windowClosesAt
      ? compareIsoTime(settings.scheduling.windowOpensAt, settings.scheduling.windowClosesAt)
      : null;
  const hasValidWindowOrder = windowOrderDelta === null || windowOrderDelta < 0;
  const windowOpen = !settings.scheduling.windowOpensAt || opensDelta === null || opensDelta >= 0;
  const windowNotClosed = !settings.scheduling.windowClosesAt || closesDelta === null || closesDelta <= 0;
  const scheduledDecisionAllowed =
    settings.mode !== "scheduled" ||
    command.action === "preview" ||
    command.action === "recover" ||
    schedulingEnabled;
  const scheduleReadyForDecision =
    settings.mode !== "scheduled" ||
    command.action === "preview" ||
    command.action === "recover" ||
    schedulingDecision.readyToEnqueue;

  return [
    {
      id: "lifecycle-enabled",
      ok: settings.enabled,
      severity: "blocker",
      message: settings.enabled ? "Supersession lifecycle controls are enabled." : settings.disabledReason
    },
    {
      id: "lifecycle-command-enabled",
      ok: commandEnabled,
      severity: "blocker",
      message: commandEnabled
        ? `Lifecycle settings allow ${command.action}.`
        : `Lifecycle settings disable ${command.action} for this workflow.`
    },
    {
      id: "lifecycle-schedule-policy-valid",
      ok: scheduledDecisionAllowed,
      severity: "blocker",
      message: schedulingEnabled
        ? `Scheduling uses ${settings.scheduling.policy} on ${settings.scheduling.queueName}.`
        : "Scheduled decisions require an enabled scheduling policy."
    },
    {
      id: "lifecycle-schedule-window-valid",
      ok:
        hasValidWindowOrder &&
        schedulingDecision.window.timestampsValid &&
        schedulingDecision.window.orderValid &&
        windowNotClosed,
      severity: "warning",
      message: hasValidWindowOrder
        ? `Schedule window ${settings.scheduling.windowOpensAt || "now"} to ${settings.scheduling.windowClosesAt || "open-ended"} is usable.`
        : "Schedule window closes before it opens."
    },
    {
      id: "lifecycle-schedule-ready-for-command",
      ok: scheduleReadyForDecision,
      severity: "blocker",
      message: scheduleReadyForDecision
        ? schedulingDecision.reason
        : `Scheduled ${command.action} is not ready: ${schedulingDecision.reason}`
    }
  ];
}

function normalizePersistedSupersessionState(value) {
  const state = asObject(value);
  const decision = asObject(state.decision);
  const command = asObject(state.lastCommand);
  const recovery = asObject(state.recovery);
  const writeCheckpoint = asObject(state.writeCheckpoint);
  const mailchimp = asObject(state.mailchimpSync || state.mailchimpContinuity || state.providerContinuity?.mailchimp);
  const commandJournal = normalizeCommandJournal(
    state.commandJournal || state.commandLedger || writeCheckpoint.commandJournal
  );
  const stateKey =
    typeof state.stateKey === "string" && state.stateKey.trim()
      ? state.stateKey.trim()
      : typeof writeCheckpoint.stateKey === "string" && writeCheckpoint.stateKey.trim()
        ? writeCheckpoint.stateKey.trim()
        : null;

  return {
    found: Object.keys(state).length > 0,
    schemaVersion: state.schemaVersion === 1 ? 1 : null,
    stateKey,
    surfaceId: typeof state.surfaceId === "string" && state.surfaceId.trim() ? state.surfaceId.trim() : null,
    workflowId: typeof state.workflowId === "string" && state.workflowId.trim() ? state.workflowId.trim() : null,
    acceptToken: typeof state.acceptToken === "string" && state.acceptToken.trim() ? state.acceptToken.trim() : null,
    status:
      typeof state.status === "string" && state.status.trim()
        ? state.status.trim()
        : typeof decision.status === "string" && decision.status.trim()
          ? decision.status.trim()
          : null,
    revision: Number.isInteger(state.revision) && state.revision >= 0 ? state.revision : 0,
    currentMemoryId:
      typeof state.currentMemoryId === "string" && state.currentMemoryId.trim()
        ? state.currentMemoryId.trim()
        : null,
    candidateMemoryId:
      typeof state.candidateMemoryId === "string" && state.candidateMemoryId.trim()
        ? state.candidateMemoryId.trim()
        : null,
    decidedAt:
      typeof decision.decidedAt === "string" && decision.decidedAt.trim()
        ? decision.decidedAt.trim()
        : typeof state.decidedAt === "string" && state.decidedAt.trim()
          ? state.decidedAt.trim()
          : null,
    decidedBy:
      typeof decision.decidedBy === "string" && decision.decidedBy.trim()
        ? decision.decidedBy.trim()
        : null,
    lastCommandId:
      typeof command.id === "string" && command.id.trim()
        ? command.id.trim()
        : typeof state.lastCommandId === "string" && state.lastCommandId.trim()
          ? state.lastCommandId.trim()
          : null,
    lastIdempotencyKey:
      typeof command.idempotencyKey === "string" && command.idempotencyKey.trim()
        ? command.idempotencyKey.trim()
        : typeof state.lastIdempotencyKey === "string" && state.lastIdempotencyKey.trim()
          ? state.lastIdempotencyKey.trim()
          : null,
    recoveryStatus:
      typeof recovery.status === "string" && recovery.status.trim()
        ? recovery.status.trim()
        : null,
    recoveryRoute:
      typeof recovery.route === "string" && recovery.route.trim()
        ? recovery.route.trim()
        : null,
    restartSafe:
      typeof recovery.restartSafe === "boolean"
        ? recovery.restartSafe
        : typeof state.restartSafe === "boolean"
          ? state.restartSafe
          : null,
    checkpointRevision:
      Number.isInteger(writeCheckpoint.revision) && writeCheckpoint.revision >= 0
        ? writeCheckpoint.revision
        : null,
    checkpointHash:
      typeof writeCheckpoint.hash === "string" && writeCheckpoint.hash.trim()
        ? writeCheckpoint.hash.trim()
        : null,
    checkpointHashAlgorithm:
      typeof writeCheckpoint.hashAlgorithm === "string" && writeCheckpoint.hashAlgorithm.trim()
        ? writeCheckpoint.hashAlgorithm.trim()
        : null,
    commandJournal,
    mailchimpContinuity: {
      schemaVersion: mailchimp.schemaVersion === 1 ? 1 : null,
      status: cleanString(mailchimp.status),
      subjectKey: cleanString(mailchimp.subjectKey),
      checkpointKey: cleanString(mailchimp.checkpointKey) || cleanString(mailchimp.payloadRef),
      payloadRef: cleanString(mailchimp.payloadRef),
      externalRevision: cleanString(mailchimp.externalRevision),
      acceptedAt: cleanString(mailchimp.acceptedAt),
      replaySafe:
        typeof mailchimp.replaySafe === "boolean"
          ? mailchimp.replaySafe
          : typeof mailchimp.restartSafe === "boolean"
            ? mailchimp.restartSafe
            : null,
      blockerCount: Number.isInteger(mailchimp.blockerCount) && mailchimp.blockerCount >= 0
        ? mailchimp.blockerCount
        : null,
      proofKey: cleanString(mailchimp.proofKey) || cleanString(mailchimp.proof)
    }
  };
}

function normalizeSupersessionCommand(value, { requestContext, requestedState, acceptToken }) {
  const command = asObject(value);
  const requestedAction =
    typeof command.action === "string" && COMMAND_ACTIONS.has(command.action)
      ? command.action
      : requestedState === "accepted"
        ? "accept"
        : requestedState === "rejected"
          ? "reject"
          : "preview";
  const id =
    typeof command.id === "string" && command.id.trim()
      ? command.id.trim()
      : `${requestContext.workflow.id}:${requestedAction}`;
  const idempotencyKey =
    typeof command.idempotencyKey === "string" && command.idempotencyKey.trim()
      ? command.idempotencyKey.trim()
      : `${surfaceId}:${requestContext.workflow.id}:${acceptToken}:${requestedAction}`;

  return {
    id,
    action: requestedAction,
    idempotencyKey,
    reason:
      typeof command.reason === "string" && command.reason.trim() ? command.reason.trim() : null,
    issuedBy:
      typeof command.issuedBy === "string" && command.issuedBy.trim()
        ? command.issuedBy.trim()
        : requestContext.client.id
  };
}

function buildRecoveryStatus({ persistedState, requestContext, current, candidate, acceptToken, validationSummary }) {
  const matchesSurface = persistedState.surfaceId === surfaceId;
  const matchesWorkflow = persistedState.workflowId === requestContext.workflow.id;
  const matchesPair =
    persistedState.acceptToken === acceptToken ||
    (persistedState.currentMemoryId === current.id && persistedState.candidateMemoryId === candidate.id);
  const terminal = TERMINAL_PERSISTED_STATUSES.has(persistedState.status);

  if (!persistedState.found) {
    return {
      status: "initializing",
      restartSafe: true,
      recovered: false,
      route: "memory-manager/supersession/preview",
      reason: "No persisted supersession state was provided; initialize a new preview snapshot."
    };
  }

  if (!matchesSurface || !matchesWorkflow) {
    return {
      status: "foreign_state_ignored",
      restartSafe: true,
      recovered: false,
      route: "memory-manager/supersession/preview",
      reason: "Persisted state belongs to a different surface or workflow and must not drive this preview."
    };
  }

  if (!matchesPair) {
    return {
      status: "recovery_conflict",
      restartSafe: false,
      recovered: false,
      route: "memory-manager/supersession/resolve-conflict",
      reason: "Persisted workflow points at a different memory pair; require operator conflict resolution."
    };
  }

  if (terminal) {
    return {
      status: `already_${persistedState.status}`,
      restartSafe: true,
      recovered: true,
      route: "memory-manager/supersession/status",
      reason: `Persisted terminal decision ${persistedState.status} is authoritative after restart.`
    };
  }

  if (!validationSummary.ok) {
    return {
      status: "resume_validation",
      restartSafe: true,
      recovered: true,
      route: "memory-manager/supersession/validate",
      reason: "Persisted non-terminal workflow resumes at validation because blockers remain."
    };
  }

  return {
    status: "resume_decision",
    restartSafe: true,
    recovered: true,
    route: "memory-manager/supersession/accept",
    reason: "Persisted non-terminal workflow resumes at the accept/reject decision."
  };
}

function buildCommandJournalProjection({ persistedState, command, stateKey, nextRevision, now }) {
  const journal = persistedState.commandJournal || [];
  const replayedEntry = journal.find((entry) => entry.idempotencyKey === command.idempotencyKey);
  const latestSequence = journal.reduce((max, entry) => Math.max(max, entry.sequence), 0);
  const currentEntry = {
    sequence: latestSequence + 1,
    commandId: command.id,
    action: command.action,
    idempotencyKey: command.idempotencyKey,
    status: "projected",
    effect: "pending",
    revision: nextRevision,
    handledAt: now,
    stateKey
  };

  return {
    schemaVersion: 1,
    replayed: Boolean(replayedEntry),
    replaySource: replayedEntry ? "command_journal" : "new_command",
    replayedEntry: replayedEntry || null,
    currentEntry,
    nextJournal: replayedEntry
      ? journal
      : [...journal, currentEntry].sort((left, right) => left.sequence - right.sequence).slice(-COMMAND_JOURNAL_LIMIT),
    retention: {
      limit: COMMAND_JOURNAL_LIMIT,
      previousCount: journal.length,
      nextCount: replayedEntry ? journal.length : Math.min(COMMAND_JOURNAL_LIMIT, journal.length + 1)
    }
  };
}

function buildRestartStateContract({ now, persistedState, recoveryStatus, command, current, candidate, acceptToken }) {
  const stateKey = `${surfaceId}:${acceptToken}`;
  const projectedNextRevision = persistedState.found ? persistedState.revision + 1 : 1;
  const commandJournal = buildCommandJournalProjection({
    persistedState,
    command,
    stateKey,
    nextRevision: projectedNextRevision,
    now
  });
  const duplicateCommand =
    (Boolean(persistedState.lastIdempotencyKey) && persistedState.lastIdempotencyKey === command.idempotencyKey) ||
    commandJournal.replayed;
  const terminalStatus = TERMINAL_PERSISTED_STATUSES.has(persistedState.status);
  const recoverableStatus = RECOVERABLE_PERSISTED_STATUSES.has(persistedState.status);
  const invalidSchema = persistedState.found && persistedState.schemaVersion !== 1;
  const staleCheckpoint =
    persistedState.checkpointRevision !== null && persistedState.checkpointRevision !== persistedState.revision;
  const stateKeyMismatch = Boolean(persistedState.stateKey && persistedState.stateKey !== stateKey);
  const expectedCheckpointHash =
    persistedState.found && persistedState.checkpointHashAlgorithm === CHECKPOINT_HASH_ALGORITHM
      ? hashStablePayload(
          buildCheckpointDigestPayload({
            stateKey: persistedState.stateKey || stateKey,
            revision: persistedState.revision,
            status: persistedState.status,
            workflowId: persistedState.workflowId,
            acceptToken: persistedState.acceptToken,
            currentMemoryId: persistedState.currentMemoryId,
            candidateMemoryId: persistedState.candidateMemoryId
          })
        )
      : null;
  const checkpointHashMismatch =
    Boolean(expectedCheckpointHash && persistedState.checkpointHash) &&
    expectedCheckpointHash !== persistedState.checkpointHash;
  const mustHalt = recoveryStatus.status === "recovery_conflict" || invalidSchema || staleCheckpoint || stateKeyMismatch;
  const digestUnsafe = checkpointHashMismatch && !duplicateCommand;
  const mustRecover = mustHalt || digestUnsafe;
  const replayDisposition = duplicateCommand
    ? "duplicate_noop"
    : terminalStatus
      ? "terminal_replay"
      : mustRecover
        ? "manual_recovery_required"
        : recoverableStatus || !persistedState.found
          ? "resume_or_initialize"
          : "normalize_unknown_status";

  return {
    schemaVersion: 1,
    stateKey,
    pairKey: `${current.id}->${candidate.id}`,
    replayDisposition,
    restartSafe: recoveryStatus.restartSafe && !mustRecover,
    duplicateCommand,
    commandJournal,
    terminalStatus,
    recoverableStatus,
    health: {
      ok: !mustRecover,
      invalidSchema,
      staleCheckpoint,
      stateKeyMismatch,
      checkpointHashMismatch,
      checkpointHashVerified: Boolean(expectedCheckpointHash && persistedState.checkpointHash),
      unknownStatus:
        Boolean(persistedState.status) &&
        !terminalStatus &&
        !recoverableStatus &&
        persistedState.status !== null
    },
    writePrecondition: {
      mode: persistedState.found ? "compare_revision" : "insert_if_absent",
      expectedRevision: persistedState.found ? persistedState.revision : 0,
      expectedStateKey: persistedState.stateKey || stateKey,
      idempotencyKey: command.idempotencyKey
    },
    recoveryCommand: {
      action: mustRecover ? "halt_for_operator" : duplicateCommand ? "return_cached_result" : "apply_projection",
      route: mustRecover ? "memory-manager/supersession/recover" : recoveryStatus.route,
      reason: mustRecover
        ? "Persisted checkpoint metadata is inconsistent with this memory pair or schema."
        : recoveryStatus.reason
    }
  };
}

function buildPersistedStateShape({
  now,
  requestedState,
  requestContext,
  current,
  candidate,
  readiness,
  validationSummary,
  acceptToken,
  command,
  boundary,
  scopeContract,
  lifecycleSettings,
  persistedState,
  recoveryStatus,
  restartStateContract
}) {
  const terminalFromStore = recoveryStatus.recovered && TERMINAL_PERSISTED_STATUSES.has(persistedState.status);
  const haltForRecovery = restartStateContract && restartStateContract.recoveryCommand.action === "halt_for_operator";
  const duplicateReplay = restartStateContract && restartStateContract.replayDisposition === "duplicate_noop";
  const nextStatus = terminalFromStore
    ? persistedState.status
    : haltForRecovery || recoveryStatus.status === "recovery_conflict"
      ? "recovery_conflict"
      : requestedState === "accepted" && validationSummary.ok
      ? "accepted"
      : requestedState === "rejected" && validationSummary.ok
        ? "rejected"
        : readiness.status === "needs_validation"
          ? "needs_validation"
          : "preview";
  const decidedAt =
    nextStatus === "accepted" || nextStatus === "rejected"
      ? persistedState.decidedAt || now
      : null;
  const nextRevision = persistedState.found
    ? persistedState.revision + (terminalFromStore || duplicateReplay ? 0 : 1)
    : 1;
  const checkpointPayload = buildCheckpointDigestPayload({
    stateKey: restartStateContract ? restartStateContract.stateKey : `${surfaceId}:${acceptToken}`,
    revision: nextRevision,
    status: nextStatus,
    workflowId: requestContext.workflow.id,
    acceptToken,
    currentMemoryId: current.id,
    candidateMemoryId: candidate.id
  });

  return {
    schemaVersion: 1,
    surfaceId,
    stateKey: restartStateContract ? restartStateContract.stateKey : `${surfaceId}:${acceptToken}`,
    workflowId: requestContext.workflow.id,
    acceptToken,
    status: nextStatus,
    revision: nextRevision,
    currentMemoryId: current.id,
    candidateMemoryId: candidate.id,
    previousMailchimpContinuity: persistedState.mailchimpContinuity,
    mailchimpContinuity: persistedState.mailchimpContinuity,
    boundary: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      tenantSource: scopeContract.effectiveScope.tenantSource,
      workspaceSource: scopeContract.effectiveScope.workspaceSource,
      scopeResolutionOk: boundary.scopeResolution.ok,
      scopeResolutionIssues: boundary.scopeResolution.issues.map((issue) => issue.code),
      actorId: boundary.actor.id,
      actorRole: boundary.actor.role,
      permission: boundary.requiredPermission,
      allowed: boundary.decision.allowed,
      workspaceAuthorization: scopeContract.workspaceAuthorization,
      isolationKey: scopeContract.isolationKey,
      scopeLevel: scopeContract.scopeLevel,
      scopeWriteAllowed: scopeContract.writePolicy.allowStateWrite
    },
    lifecycle: {
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      disabledReason: lifecycleSettings.disabledReason,
      commands: lifecycleSettings.commands,
      scheduling: lifecycleSettings.scheduling,
      schedulingDecision: buildSchedulingDecision(lifecycleSettings, command, now),
      settingsControlPlane: lifecycleSettings
        ? buildLifecycleSettingsControlPlane({
            settings: lifecycleSettings,
            command,
            schedulingDecision: buildSchedulingDecision(lifecycleSettings, command, now),
            validationSummary
          })
        : null,
      audit: lifecycleSettings.audit
    },
    validation: {
      ok: validationSummary.ok,
      passed: validationSummary.passed,
      failed: validationSummary.failed,
      blockerFailures: validationSummary.blockerFailures,
      warnings: validationSummary.warnings
    },
    decision: {
      status: nextStatus,
      decidedAt,
      decidedBy: decidedAt ? command.issuedBy : null,
      reason: nextStatus === "rejected" ? command.reason : null
    },
    lastCommand: {
      id: command.id,
      action: command.action,
      idempotencyKey: command.idempotencyKey,
      handledAt: now
    },
    commandJournal: restartStateContract ? restartStateContract.commandJournal.nextJournal : [],
    recovery: {
      status: recoveryStatus.status,
      restartSafe: restartStateContract ? restartStateContract.restartSafe : recoveryStatus.restartSafe,
      route: recoveryStatus.route,
      replayDisposition: restartStateContract ? restartStateContract.replayDisposition : null,
      health: restartStateContract ? restartStateContract.health : null
    },
    writeCheckpoint: {
      stateKey: restartStateContract ? restartStateContract.stateKey : `${surfaceId}:${acceptToken}`,
      revision: persistedState.found ? persistedState.revision : 0,
      nextRevision,
      precondition: restartStateContract ? restartStateContract.writePrecondition : null,
      replayDisposition: restartStateContract ? restartStateContract.replayDisposition : null,
      hashAlgorithm: CHECKPOINT_HASH_ALGORITHM,
      hash: hashStablePayload(checkpointPayload),
      digestPayload: checkpointPayload,
      commandJournalRetention: restartStateContract ? restartStateContract.commandJournal.retention : null
    },
    statusSemantics: {
      terminal: TERMINAL_PERSISTED_STATUSES.has(nextStatus),
      recoverable: RECOVERABLE_PERSISTED_STATUSES.has(nextStatus),
      duplicateReplay,
      writeRequired: !terminalFromStore && !duplicateReplay && !haltForRecovery,
      restartSafe:
        Boolean(restartStateContract?.restartSafe) &&
        !haltForRecovery &&
        (TERMINAL_PERSISTED_STATUSES.has(nextStatus) || RECOVERABLE_PERSISTED_STATUSES.has(nextStatus)),
      resumeRoute:
        terminalFromStore || TERMINAL_PERSISTED_STATUSES.has(nextStatus)
          ? "memory-manager/supersession/status"
          : haltForRecovery
            ? "memory-manager/supersession/recover"
            : recoveryStatus.route
    }
  };
}

function buildCommandResult({ command, persistedState, recoveryStatus, validationSummary, acceptToken, restartStateContract }) {
  const duplicateCommand =
    persistedState.lastIdempotencyKey && persistedState.lastIdempotencyKey === command.idempotencyKey;
  const terminalReplay =
    recoveryStatus.recovered &&
    TERMINAL_PERSISTED_STATUSES.has(persistedState.status) &&
    persistedState.acceptToken === acceptToken;

  if (restartStateContract && restartStateContract.recoveryCommand.action === "halt_for_operator") {
    return {
      effect: "blocked",
      idempotent: false,
      status: "restart_recovery_required",
      reason: restartStateContract.recoveryCommand.reason
    };
  }

  if (duplicateCommand || terminalReplay) {
    return {
      effect: "noop",
      idempotent: true,
      status: recoveryStatus.status,
      reason: "Command has already been applied for this supersession token."
    };
  }

  if (recoveryStatus.status === "recovery_conflict") {
    return {
      effect: "blocked",
      idempotent: false,
      status: "conflict",
      reason: recoveryStatus.reason
    };
  }

  if ((command.action === "accept" || command.action === "reject") && !validationSummary.ok) {
    return {
      effect: "blocked",
      idempotent: true,
      status: "validation_required",
      reason: "Decision command is restart-safe but blocked until validation and boundary failures are resolved."
    };
  }

  return {
    effect: command.action === "preview" || command.action === "recover" ? "snapshot" : "persist_decision",
    idempotent: true,
    status: command.action,
    reason: "Command can be safely retried with the same idempotency key."
  };
}

function buildRetryBackoff({ input, commandResult, restartStateContract }) {
  const retryInput = asObject(asObject(input.operationalHealth || input.health).retry);
  const attempt = Number.isInteger(retryInput.attempt) && retryInput.attempt >= 0 ? Math.min(retryInput.attempt, 8) : 0;
  const baseDelayMs =
    Number.isInteger(retryInput.baseDelayMs) && retryInput.baseDelayMs > 0
      ? Math.min(retryInput.baseDelayMs, 30000)
      : 250;
  const maxDelayMs =
    Number.isInteger(retryInput.maxDelayMs) && retryInput.maxDelayMs > 0
      ? Math.min(retryInput.maxDelayMs, 300000)
      : 30000;
  const retryable =
    commandResult.idempotent &&
    restartStateContract.recoveryCommand.action !== "halt_for_operator" &&
    commandResult.status !== "validation_required";
  const delayMs = retryable ? Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) : null;

  return {
    strategy: "bounded_exponential_backoff",
    safeToRetry: commandResult.idempotent,
    retryable,
    attempt,
    nextAttempt: retryable ? attempt + 1 : null,
    delayMs,
    maxDelayMs,
    idempotentTerminalBehavior: "return_cached_result"
  };
}

function buildActionableError(code, severity, route, message, recoveryAction, payload = {}) {
  return {
    code,
    severity,
    route,
    message,
    recoveryAction,
    payload
  };
}

function buildOperationalHealthContract({
  now,
  input,
  command,
  commandResult,
  recoveryStatus,
  restartStateContract,
  validationSummary,
  boundary,
  scopeContract,
  lifecycleControls,
  acceptToken
}) {
  const retry = buildRetryBackoff({ input, commandResult, restartStateContract });
  const errors = [];

  if (restartStateContract.recoveryCommand.action === "halt_for_operator") {
    errors.push(
      buildActionableError(
        "SUPERCESSION_RESTART_CHECKPOINT_UNSAFE",
        "error",
        restartStateContract.recoveryCommand.route,
        restartStateContract.recoveryCommand.reason,
        "inspect_persisted_checkpoint",
        {
          stateKey: restartStateContract.stateKey,
          replayDisposition: restartStateContract.replayDisposition,
          health: restartStateContract.health
        }
      )
    );
  }

  if (recoveryStatus.status === "recovery_conflict") {
    errors.push(
      buildActionableError(
        "SUPERCESSION_MEMORY_PAIR_CONFLICT",
        "error",
        recoveryStatus.route,
        recoveryStatus.reason,
        "resolve_memory_pair_conflict",
        { acceptToken }
      )
    );
  }

  if (!boundary.decision.allowed) {
    errors.push(
      buildActionableError(
        "SUPERCESSION_PERMISSION_DENIED",
        "error",
        "memory-manager/supersession/permissions",
        boundary.decision.reason,
        "request_authorized_actor",
        { requiredPermission: boundary.requiredPermission, actorRole: boundary.actor.role }
      )
    );
  }

  if (!scopeContract.workspaceAuthorization.allowed) {
    errors.push(
      buildActionableError(
        "SUPERCESSION_WORKSPACE_PERMISSION_DENIED",
        "error",
        "memory-manager/supersession/permissions",
        scopeContract.workspaceAuthorization.reason,
        "attach_workspace_scoped_grant",
        {
          tenantId: boundary.tenantId,
          workspaceId: boundary.workspaceId,
          requiredPermission: boundary.requiredPermission,
          actorRole: boundary.actor.role,
          grantCount: scopeContract.workspaceAuthorization.grantCount,
          source: scopeContract.workspaceAuthorization.source
        }
      )
    );
  }

  for (const violation of scopeContract.violations) {
    errors.push(
      buildActionableError(
        `SUPERCESSION_SCOPE_${violation.code.toUpperCase()}`,
        "error",
        violation.route,
        violation.message,
        "reselect_memory_pair_or_scope",
        {
          isolationKey: scopeContract.isolationKey,
          scopeLevel: scopeContract.scopeLevel,
          currentScope: scopeContract.recordScopes.current,
          candidateScope: scopeContract.recordScopes.candidate
        }
      )
    );
  }

  for (const failure of validationSummary.blockerFailures.filter((failure) => failure !== "actor-can-run-command")) {
    errors.push(
      buildActionableError(
        `SUPERCESSION_VALIDATION_${failure.toUpperCase().replaceAll("-", "_")}`,
        "degraded",
        failure.startsWith("lifecycle-")
          ? "memory-manager/supersession/settings"
          : "memory-manager/supersession/validate",
        `Resolve ${failure} before this supersession command can commit.`,
        failure.startsWith("lifecycle-") ? "adjust_lifecycle_settings" : "resolve_validation_failure",
        { failure }
      )
    );
  }

  if (!lifecycleControls.settings.enabled) {
    errors.push(
      buildActionableError(
        "SUPERCESSION_LIFECYCLE_DISABLED",
        "degraded",
        "memory-manager/supersession/settings",
        lifecycleControls.settings.disabledReason,
        "enable_lifecycle_or_keep_preview_only",
        { mode: lifecycleControls.settings.mode }
      )
    );
  }

  const topSeverity = errors.reduce(
    (severity, error) =>
      OPERATIONAL_SEVERITY_RANK[error.severity] > OPERATIONAL_SEVERITY_RANK[severity] ? error.severity : severity,
    "info"
  );
  const status = topSeverity === "error" ? "failed" : topSeverity === "degraded" ? "degraded" : "healthy";
  const previewOnly = status !== "healthy" || commandResult.effect === "blocked";

  return {
    schemaVersion: 1,
    generatedAt: now,
    status,
    healthScore: Math.max(0, 100 - errors.reduce((score, error) => score + (error.severity === "error" ? 35 : 15), 0)),
    degradedMode: {
      enabled: previewOnly,
      mode: previewOnly ? "preview_only" : "full_decision",
      writable: !previewOnly && commandResult.effect !== "noop",
      allowedCapabilities: previewOnly
        ? ["preview_memory_delta", "publish_hold_audit", "resume_workflow"]
        : ["preview_memory_delta", "persist_supersession_state", "activate_candidate_memory", "publish_supersession_audit"]
    },
    retry,
    actionableErrors: errors,
    commandHealth: {
      commandId: command.id,
      resultStatus: commandResult.status,
      effect: commandResult.effect,
      recoveryRoute: recoveryStatus.route,
      restartSafe: restartStateContract.restartSafe,
      replayDisposition: restartStateContract.replayDisposition
    }
  };
}

function buildLifecycleControls({
  now,
  current,
  candidate,
  settings,
  command,
  validationSummary,
  readiness,
  recoveryStatus,
  acceptToken
}) {
  const lifecycleFailures = validationSummary.blockerFailures.filter((failure) => failure.startsWith("lifecycle-"));
  const schedulingDecision = buildSchedulingDecision(settings, command, now);
  const settingsControlPlane = buildLifecycleSettingsControlPlane({
    settings,
    command,
    schedulingDecision,
    validationSummary
  });
  const waitForScheduleWindow = schedulingDecision.state === "waiting_for_window";
  const lifecycleSettingsFailures = lifecycleFailures.filter(
    (failure) => failure !== "lifecycle-schedule-ready-for-command" || !waitForScheduleWindow
  );
  const canSchedule =
    settings.enabled &&
    settings.scheduling.policy !== "disabled" &&
    validationSummary.ok &&
    schedulingDecision.readyToEnqueue &&
    !TERMINAL_PERSISTED_STATUSES.has(recoveryStatus.status.replace("already_", ""));
  const commandAvailability = Object.fromEntries(
    Object.entries(settings.commands).map(([action, enabled]) => {
      const actionSchedulingDecision = buildSchedulingDecision(settings, { ...command, action }, now);
      const actionScheduleReady =
        action === "preview" ||
        action === "recover" ||
        settings.mode !== "scheduled" ||
        actionSchedulingDecision.readyToEnqueue;
      const settingBlocker = settingsControlPlane.issues.find(
        (issue) => issue.severity === "blocker" && issue.affectedCommands.includes(action)
      );

      return [
        action,
        {
          enabled: Boolean(enabled && settings.enabled && actionScheduleReady && !settingBlocker),
          route: `memory-manager/supersession/${action}`,
          blockedReason: !settings.enabled
            ? settings.disabledReason
            : !enabled
              ? `Command ${action} is disabled by lifecycle settings.`
              : settingBlocker
                ? settingBlocker.message
              : !actionScheduleReady
                ? actionSchedulingDecision.reason
                : null,
          schedulingState: actionSchedulingDecision.state,
          settingsStatus: settingBlocker ? "blocked_by_settings" : "allowed_by_settings"
        }
      ];
    })
  );
  const nextAction =
    settingsControlPlane.status === "settings_blocked"
      ? {
          action: "repair_lifecycle_settings",
          route: "memory-manager/supersession/settings",
          enabled: false,
          reason: settingsControlPlane.issues.find((issue) => issue.severity === "blocker")?.message,
          payload: {
            status: settingsControlPlane.status,
            issueCodes: settingsControlPlane.issues.map((issue) => issue.code),
            recommendedPatches: settingsControlPlane.recommendedPatches
          }
        }
      : lifecycleSettingsFailures.length > 0
      ? {
          action: "adjust_lifecycle_settings",
          route: "memory-manager/supersession/settings",
          enabled: false,
          reason: `Resolve ${lifecycleSettingsFailures[0]} before command execution.`,
          payload: {
            issueCodes: settingsControlPlane.issues.map((issue) => issue.code),
            recommendedPatches: settingsControlPlane.recommendedPatches
          }
        }
      : canSchedule && settings.mode === "scheduled" && command.action !== "preview"
        ? {
            action: "enqueue_supersession_decision",
            route: "memory-manager/supersession/schedule",
            enabled: true,
            reason: "Decision is valid and should be enqueued for the configured lifecycle window.",
            payload: {
              scheduleToken: `${surfaceId}:${acceptToken}:schedule`,
              queueName: settings.scheduling.queueName,
              policy: settings.scheduling.policy,
              holdUntil: schedulingDecision.controls.holdUntil,
              expiresAt: schedulingDecision.controls.expiresAt
            }
          }
        : settings.mode === "scheduled" &&
            (command.action === "accept" || command.action === "reject") &&
            !schedulingDecision.readyToEnqueue
          ? {
              action: "hold_for_schedule_window",
              route: "memory-manager/supersession/schedule",
              enabled: false,
              reason: schedulingDecision.reason,
              payload: {
                schedulingState: schedulingDecision.state,
                holdUntil: schedulingDecision.controls.holdUntil,
                expiresAt: schedulingDecision.controls.expiresAt
              }
            }
        : readiness.status === "ready" || readiness.status === "ready_with_warnings"
          ? {
              action: "accept_supersession",
              route: "memory-manager/supersession/accept",
              enabled: commandAvailability.accept.enabled,
              reason: commandAvailability.accept.enabled
                ? "Candidate is ready for an accept/reject decision."
                : commandAvailability.accept.blockedReason,
              payload: {
                acceptToken,
                currentMemoryId: current.id,
                candidateMemoryId: candidate.id
              }
            }
          : {
              action: "review_supersession",
              route: "memory-manager/supersession/preview",
              enabled: commandAvailability.preview.enabled,
              reason: "Continue review until validation and lifecycle requirements are satisfied.",
              payload: {
                currentMemoryId: current.id,
                candidateMemoryId: candidate.id,
                lifecycleStatus: settingsControlPlane.status
              }
            };

  return {
    schemaVersion: 1,
    generatedAt: now,
    settings,
    settingsControlPlane,
    commandAvailability,
    scheduling: {
      enabled: canSchedule,
      policy: settings.scheduling.policy,
      queueName: settings.scheduling.queueName,
      timezone: settings.scheduling.timezone,
      windowOpensAt: settings.scheduling.windowOpensAt,
      windowClosesAt: settings.scheduling.windowClosesAt,
      decision: schedulingDecision,
      scheduleToken: canSchedule ? `${surfaceId}:${acceptToken}:schedule` : null,
      payload: canSchedule
        ? {
            currentMemoryId: current.id,
            candidateMemoryId: candidate.id,
            acceptToken,
            requestedBy: settings.scheduling.requestedBy,
            queueName: settings.scheduling.queueName,
            policy: settings.scheduling.policy,
            holdUntil: schedulingDecision.controls.holdUntil,
            expiresAt: schedulingDecision.controls.expiresAt,
            schedulingState: schedulingDecision.state
          }
        : null
    },
    nextAction
  };
}

function buildNextSteps({ current, candidate, validationSummary, readiness, acceptToken, boundary, lifecycleControls }) {
  if (!validationSummary.ok) {
    return validationSummary.blockerFailures.map((failure) => ({
      action:
        failure === "actor-can-run-command"
          ? "request_authorized_actor"
          : failure === "lifecycle-schedule-ready-for-command" &&
              lifecycleControls.nextAction.action === "hold_for_schedule_window"
            ? "hold_for_schedule_window"
          : failure.startsWith("lifecycle-")
            ? "adjust_lifecycle_settings"
            : "resolve_validation_failure",
      route:
        failure === "actor-can-run-command"
          ? "memory-manager/supersession/permissions"
          : failure === "lifecycle-schedule-ready-for-command" &&
              lifecycleControls.nextAction.action === "hold_for_schedule_window"
            ? "memory-manager/supersession/schedule"
          : failure.startsWith("lifecycle-")
            ? "memory-manager/supersession/settings"
          : "memory-manager/supersession/validate",
      payload: {
        failure,
        currentMemoryId: current.id,
        candidateMemoryId: candidate.id,
        schedulingState:
          failure === "lifecycle-schedule-ready-for-command"
            ? lifecycleControls.scheduling.decision.state
            : null,
        holdUntil:
          failure === "lifecycle-schedule-ready-for-command"
            ? lifecycleControls.scheduling.decision.controls.holdUntil
            : null
      },
      explanation:
        failure === "actor-can-run-command"
          ? `Switch to an actor with ${boundary.requiredPermission} permission before this command can proceed.`
          : failure === "lifecycle-schedule-ready-for-command" &&
              lifecycleControls.nextAction.action === "hold_for_schedule_window"
            ? lifecycleControls.nextAction.reason
          : failure.startsWith("lifecycle-")
            ? `Update lifecycle settings before the ${lifecycleControls.nextAction.action} control can proceed.`
          : `Resolve ${failure} before the supersession can be accepted.`
    }));
  }

  if (lifecycleControls.scheduling.enabled && lifecycleControls.settings.mode === "scheduled") {
    return [
      {
        action: "enqueue_supersession_decision",
        route: "memory-manager/supersession/schedule",
        payload: lifecycleControls.scheduling.payload,
        explanation: "Queue the validated decision for the configured lifecycle scheduling window."
      }
    ];
  }

  if (readiness.status === "ready" || readiness.status === "ready_with_warnings") {
    return [
      {
        action: "accept_supersession",
        route: "memory-manager/supersession/accept",
        payload: { acceptToken, currentMemoryId: current.id, candidateMemoryId: candidate.id },
        explanation: "Persist the candidate as the active memory and mark the current memory superseded."
      },
      {
        action: "publish_audit_event",
        route: "memory-manager/audit/events",
        payload: { surfaceId, acceptToken },
        explanation: "Record a proof event so hosted-kernel clients can explain why the replacement happened."
      }
    ];
  }

  return [
    {
      action: "review_supersession",
      route: "memory-manager/supersession/preview",
      payload: { currentMemoryId: current.id, candidateMemoryId: candidate.id },
      explanation: "Review the preview before choosing accept or reject."
    }
  ];
}

function normalizeClientHandoffPreferences(input, requestContext) {
  const runtime = asObject(input.clientRuntime || input.clientState || input.runtime);
  const handoff = asObject(runtime.handoff || asObject(requestContext.client).handoff);
  const view = asObject(runtime.view);
  const mode = CLIENT_HANDOFF_MODES.has(handoff.mode) ? handoff.mode : "route";
  const resumeStrategy = CLIENT_RESUME_STRATEGIES.has(handoff.resumeStrategy)
    ? handoff.resumeStrategy
    : requestContext.route.returnTo
      ? "return_to_origin"
      : "open_handoff";
  const visibleFactLimit =
    Number.isInteger(view.visibleFactLimit) && view.visibleFactLimit > 0
      ? Math.min(view.visibleFactLimit, 25)
      : 8;

  return {
    schemaVersion: 1,
    mode,
    resumeStrategy,
    mountId:
      cleanString(runtime.mountId) ||
      cleanString(handoff.mountId) ||
      `${surfaceId}:${requestContext.workflow.id}:client`,
    stateNamespace:
      cleanString(runtime.stateNamespace) ||
      cleanString(handoff.stateNamespace) ||
      "memory.supersession.client",
    requestedRoute: cleanString(handoff.route) || requestContext.route.current,
    returnTo: cleanString(handoff.returnTo) || requestContext.route.returnTo,
    view: {
      density: cleanString(view.density) || "standard",
      visibleFactLimit,
      showEvidenceDrawer: view.showEvidenceDrawer === false ? false : true,
      requireRemovedFactConfirmation: view.requireRemovedFactConfirmation === false ? false : true
    }
  };
}

function buildClientDisabledControls({
  validationSummary,
  readiness,
  boundary,
  scopeContract,
  lifecycleControls,
  providerServiceContracts,
  commandResult
}) {
  const controls = [];

  if (!boundary.decision.allowed) {
    controls.push({
      control: "accept",
      reason: boundary.decision.reason,
      route: "memory-manager/supersession/permissions"
    });
    controls.push({
      control: "reject",
      reason: boundary.decision.reason,
      route: "memory-manager/supersession/permissions"
    });
  }

  if (!scopeContract.writePolicy.allowStateWrite) {
    controls.push({
      control: "commit",
      reason: scopeContract.writePolicy.deniedReason,
      route: "memory-manager/supersession/scope",
      isolationKey: scopeContract.isolationKey,
      violations: scopeContract.violations.map((violation) => violation.code)
    });
  }

  if (!validationSummary.ok) {
    controls.push({
      control: "accept",
      reason: "Blocking validation checks must pass before acceptance.",
      route: "memory-manager/supersession/validate",
      blockerFailures: validationSummary.blockerFailures
    });
  }

  if (!lifecycleControls.commandAvailability.accept.enabled) {
    controls.push({
      control: "accept",
      reason: lifecycleControls.commandAvailability.accept.blockedReason,
      route: lifecycleControls.commandAvailability.accept.route,
      schedulingState: lifecycleControls.commandAvailability.accept.schedulingState
    });
  }

  if (!lifecycleControls.commandAvailability.reject.enabled) {
    controls.push({
      control: "reject",
      reason: lifecycleControls.commandAvailability.reject.blockedReason,
      route: lifecycleControls.commandAvailability.reject.route,
      schedulingState: lifecycleControls.commandAvailability.reject.schedulingState
    });
  }

  if (!providerServiceContracts.acceptanceReady) {
    controls.push({
      control: "accept",
      reason: `Required provider service(s) unavailable: ${providerServiceContracts.unavailableRequiredServices.join(", ")}.`,
      route: "memory-manager/supersession/integrations",
      unavailableServices: providerServiceContracts.unavailableRequiredServices
    });
  }

  if (readiness.status === "blocked" || commandResult.effect === "blocked") {
    controls.push({
      control: "commit",
      reason: commandResult.reason,
      route: "memory-manager/supersession/preview"
    });
  }

  return controls;
}

function buildPreviewAcceptancePanel({
  current,
  candidate,
  validation,
  validationSummary,
  readiness,
  acceptToken,
  boundary,
  scopeContract,
  lifecycleControls,
  providerServiceContracts,
  operationalHealth,
  commandResult,
  nextSteps,
  disabledControls,
  persistedStateShape
}) {
  const warningChecks = validation.checks.filter((check) => !check.ok && check.severity === "warning");
  const blockerChecks = validation.checks.filter((check) => !check.ok && check.severity === "blocker");
  const nextStep = nextSteps[0] || lifecycleControls.nextAction;
  const terminal = TERMINAL_PERSISTED_STATUSES.has(persistedStateShape.status);
  const acceptDisabled = disabledControls.find((control) => control.control === "accept");
  const rejectDisabled = disabledControls.find((control) => control.control === "reject");
  const commitDisabled = disabledControls.find((control) => control.control === "commit");
  const canRenderDecision =
    operationalHealth.status !== "failed" &&
    !terminal &&
    commandResult.effect !== "blocked" &&
    providerServiceContracts.acceptanceReady;

  return {
    schemaVersion: 1,
    component: "memory-supersession-preview-acceptance-panel",
    route: validationSummary.ok
      ? "memory-manager/supersession/accept"
      : "memory-manager/supersession/validate",
    status: {
      persisted: persistedStateShape.status,
      readiness: readiness.status,
      health: operationalHealth.status,
      decisionEnabled: canRenderDecision && disabledControls.length === 0,
      explanation:
        disabledControls[0]?.reason ||
        (terminal
          ? `Supersession is already ${persistedStateShape.status}.`
          : readiness.reason)
    },
    previewCards: [
      {
        role: "current",
        memoryId: current.id,
        title: current.title,
        subtitle: current.sourceUri || "Stored memory",
        badge: "Will be superseded",
        factCount: current.facts.length,
        scope: {
          tenantId: current.tenantId,
          workspaceId: current.workspaceId
        }
      },
      {
        role: "candidate",
        memoryId: candidate.id,
        title: candidate.title,
        subtitle: candidate.sourceUri || "Candidate memory",
        badge: candidate.confidence === null ? "Needs confidence" : `Confidence ${Math.round(candidate.confidence * 100)}%`,
        factCount: candidate.facts.length,
        scope: {
          tenantId: candidate.tenantId,
          workspaceId: candidate.workspaceId
        }
      }
    ],
    validationSummary: {
      ok: validationSummary.ok,
      passed: validationSummary.passed,
      failed: validationSummary.failed,
      blockers: blockerChecks.map((check) => ({
        id: check.id,
        route: check.id.startsWith("lifecycle-")
          ? "memory-manager/supersession/settings"
          : check.id.includes("boundary") || check.id.includes("scope")
            ? "memory-manager/supersession/scope"
            : "memory-manager/supersession/validate",
        message: check.message
      })),
      warnings: warningChecks.map((check) => ({
        id: check.id,
        route: check.id.startsWith("lifecycle-")
          ? "memory-manager/supersession/settings"
          : "memory-manager/supersession/validate",
        message: check.message
      }))
    },
    factReview: {
      retained: validation.retainedFacts.map((fact) => ({ fact, disposition: "retained", reviewRequired: false })),
      introduced: validation.introducedFacts.map((fact) => ({ fact, disposition: "introduced", reviewRequired: false })),
      removed: validation.removedFacts.map((fact) => ({
        fact,
        disposition: "removed",
        reviewRequired: true,
        confirmationKey: `${acceptToken}:removed:${fact}`
      }))
    },
    acceptanceGate: {
      acceptToken: canRenderDecision && !acceptDisabled ? acceptToken : null,
      accept: {
        enabled: canRenderDecision && !acceptDisabled && validationSummary.ok,
        route: "memory-manager/supersession/accept",
        disabledReason: acceptDisabled?.reason || null
      },
      reject: {
        enabled: canRenderDecision && !rejectDisabled && validationSummary.ok,
        route: "memory-manager/supersession/reject",
        disabledReason: rejectDisabled?.reason || null
      },
      commit: {
        enabled: canRenderDecision && !commitDisabled && scopeContract.writePolicy.allowStateWrite,
        route: "memory-manager/supersession/state",
        disabledReason: commitDisabled?.reason || scopeContract.writePolicy.deniedReason || null
      },
      requiredServices: providerServiceContracts.requiredServices,
      unavailableServices: providerServiceContracts.unavailableRequiredServices,
      permission: {
        actorId: boundary.actor.id,
        actorRole: boundary.actor.role,
        required: boundary.requiredPermission,
        allowed: boundary.decision.allowed,
        workspaceAuthorized: scopeContract.workspaceAuthorization.allowed,
        workspaceAuthorizationSource: scopeContract.workspaceAuthorization.source
      }
    },
    nextStep: {
      action: nextStep.action,
      route: nextStep.route,
      enabled: operationalHealth.status !== "failed" && (nextStep.enabled !== false),
      payload: nextStep.payload || lifecycleControls.nextAction.payload || null,
      explanation: nextStep.explanation || nextStep.reason || readiness.reason
    }
  };
}

function buildRoutePreviewAcceptanceContract({
  now,
  requestContext,
  current,
  candidate,
  validation,
  validationSummary,
  readiness,
  acceptToken,
  boundary,
  scopeContract,
  lifecycleControls,
  providerServiceContracts,
  operationalHealth,
  command,
  commandResult,
  nextSteps,
  disabledControls,
  persistedStateShape
}) {
  const terminal = TERMINAL_PERSISTED_STATUSES.has(persistedStateShape.status);
  const blockerDetails = validation.checks
    .filter((check) => !check.ok && check.severity === "blocker")
    .map((check) => ({
      id: check.id,
      message: check.message,
      route: check.id.startsWith("lifecycle-")
        ? "memory-manager/supersession/settings"
        : check.id.includes("boundary") || check.id.includes("scope")
          ? "memory-manager/supersession/scope"
          : "memory-manager/supersession/validate"
    }));
  const warningDetails = validation.checks
    .filter((check) => !check.ok && check.severity === "warning")
    .map((check) => ({
      id: check.id,
      message: check.message,
      route: check.id.startsWith("lifecycle-")
        ? "memory-manager/supersession/settings"
        : "memory-manager/supersession/validate"
    }));
  const removedFactAcknowledgements = validation.removedFacts.map((fact, index) => ({
    key: `${acceptToken}:removed:${index + 1}`,
    fact,
    required: true,
    label: "Confirm removed memory fact"
  }));
  const acceptDisabled = disabledControls.find((control) => control.control === "accept");
  const rejectDisabled = disabledControls.find((control) => control.control === "reject");
  const canCommit =
    validationSummary.ok &&
    boundary.decision.allowed &&
    scopeContract.writePolicy.allowStateWrite &&
    providerServiceContracts.acceptanceReady &&
    lifecycleControls.commandAvailability.accept.enabled &&
    operationalHealth.status !== "failed" &&
    commandResult.effect !== "blocked" &&
    !terminal;
  const nextStepRequests = nextSteps.map((step, index) => ({
    sequence: index + 1,
    action: step.action,
    route: step.route,
    method: step.action === "review_supersession" || step.action === "hold_for_schedule_window" ? "GET" : "POST",
    enabled: index === 0 && operationalHealth.status !== "failed" && commandResult.effect !== "blocked",
    payload: {
      workflowId: requestContext.workflow.id,
      requestId: requestContext.requestId,
      currentMemoryId: current.id,
      candidateMemoryId: candidate.id,
      acceptToken: step.action === "accept_supersession" || step.action === "enqueue_supersession_decision" ? acceptToken : null,
      isolationKey: scopeContract.isolationKey,
      ...asObject(step.payload)
    },
    explanation: step.explanation
  }));

  return {
    schemaVersion: 1,
    contract: "memory-supersession-route-preview-acceptance",
    generatedAt: now,
    workflowId: requestContext.workflow.id,
    status: {
      persisted: persistedStateShape.status,
      readiness: readiness.status,
      validation: validationSummary.ok ? "valid" : "blocked",
      operationalHealth: operationalHealth.status,
      terminal,
      explanation:
        disabledControls[0]?.reason ||
        blockerDetails[0]?.message ||
        (terminal ? `Supersession is already ${persistedStateShape.status}.` : readiness.reason)
    },
    routes: {
      preview: {
        route: "memory-manager/supersession/preview",
        method: "GET",
        enabled: true,
        cacheKey: `${surfaceId}:${requestContext.workflow.id}:${acceptToken}:preview`
      },
      validate: {
        route: "memory-manager/supersession/validate",
        method: "POST",
        enabled: blockerDetails.length > 0 || warningDetails.length > 0,
        failureCount: validationSummary.failed
      },
      readiness: {
        route: "memory-manager/supersession/readiness",
        method: "GET",
        enabled: true,
        score: readiness.score
      },
      accept: {
        route: "memory-manager/supersession/accept",
        method: "POST",
        enabled: canCommit && !acceptDisabled,
        disabledReason: acceptDisabled?.reason || (!canCommit ? readiness.reason : null)
      },
      reject: {
        route: "memory-manager/supersession/reject",
        method: "POST",
        enabled:
          validationSummary.ok &&
          boundary.decision.allowed &&
          providerServiceContracts.acceptanceReady &&
          lifecycleControls.commandAvailability.reject.enabled &&
          operationalHealth.status !== "failed" &&
          !terminal &&
          !rejectDisabled,
        disabledReason: rejectDisabled?.reason || null
      }
    },
    previewSummary: {
      headline: `Replace ${current.title} with ${candidate.title}`,
      currentMemoryId: current.id,
      candidateMemoryId: candidate.id,
      facts: {
        retainedCount: validation.retainedFacts.length,
        introducedCount: validation.introducedFacts.length,
        removedCount: validation.removedFacts.length,
        removedFactAcknowledgements
      },
      scope: {
        isolationKey: scopeContract.isolationKey,
        scopeLevel: scopeContract.scopeLevel,
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        tenantSource: scopeContract.effectiveScope.tenantSource,
        workspaceSource: scopeContract.effectiveScope.workspaceSource,
        scopeResolutionOk: boundary.scopeResolution.ok,
        scopeResolutionIssues: boundary.scopeResolution.issues.map((issue) => issue.code),
        workspaceAuthorization: scopeContract.workspaceAuthorization
      }
    },
    validationSummary: {
      ok: validationSummary.ok,
      passed: validationSummary.passed,
      failed: validationSummary.failed,
      blockerCount: blockerDetails.length,
      warningCount: warningDetails.length,
      blockers: blockerDetails,
      warnings: warningDetails
    },
    acceptanceRequest: {
      acceptToken: canCommit ? acceptToken : null,
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      requiredAcknowledgements: removedFactAcknowledgements.map((ack) => ack.key),
      payloadShape: {
        acceptToken,
        currentMemoryId: current.id,
        candidateMemoryId: candidate.id,
        workflowId: requestContext.workflow.id,
        actorId: boundary.actor.id,
        isolationKey: scopeContract.isolationKey,
      workspaceAuthorizationSource: scopeContract.workspaceAuthorization.source,
      tenantSource: scopeContract.effectiveScope.tenantSource,
      workspaceSource: scopeContract.effectiveScope.workspaceSource,
      scopeResolutionOk: boundary.scopeResolution.ok,
      idempotencyKey: command.idempotencyKey
      }
    },
    nextStepRequests
  };
}

function buildClientWorkflowHandoffEnvelope({
  preferences,
  requestContext,
  current,
  candidate,
  validation,
  validationSummary,
  readiness,
  acceptToken,
  boundary,
  scopeContract,
  lifecycleControls,
  providerServiceContracts,
  operationalHealth,
  commandResult,
  nextSteps,
  disabledControls,
  persistedStateShape
}) {
  const stateKey = `${preferences.stateNamespace}:${requestContext.workflow.id}:${acceptToken}`;
  const terminal = TERMINAL_PERSISTED_STATUSES.has(persistedStateShape.status);
  const nextStep = nextSteps[0] || lifecycleControls.nextAction;
  const removedFactAcknowledgements = validation.removedFacts.map((fact, index) => ({
    key: `${stateKey}:removed-fact:${index + 1}`,
    statePath: `acknowledgements.removedFacts.${index}`,
    fact,
    required: preferences.view.requireRemovedFactConfirmation,
    route: "memory-manager/supersession/preview"
  }));
  const pendingAcknowledgements = removedFactAcknowledgements.filter((acknowledgement) => acknowledgement.required);
  const blockedByControls = disabledControls.map((control) => ({
    control: control.control,
    route: control.route,
    reason: control.reason,
    schedulingState: control.schedulingState || null,
    unavailableServices: control.unavailableServices || []
  }));
  const canCommitFromClient =
    validationSummary.ok &&
    boundary.decision.allowed &&
    scopeContract.writePolicy.allowStateWrite &&
    providerServiceContracts.acceptanceReady &&
    operationalHealth.status !== "failed" &&
    commandResult.effect !== "blocked" &&
    !terminal &&
    pendingAcknowledgements.length === 0;
  const resumeRoute =
    operationalHealth.status === "failed"
      ? "memory-manager/supersession/health"
      : blockedByControls.length > 0 || !validationSummary.ok
        ? "memory-manager/supersession/validate"
        : lifecycleControls.nextAction.route || nextStep.route || preferences.requestedRoute;
  const commandIntents = nextSteps.map((step, index) => ({
    id: `${stateKey}:intent:${index + 1}`,
    sequence: index + 1,
    action: step.action,
    route: step.route,
    method: step.action === "review_supersession" || step.action === "hold_for_schedule_window" ? "GET" : "POST",
    enabled:
      index === 0 &&
      operationalHealth.status !== "failed" &&
      commandResult.effect !== "blocked" &&
      (step.action !== "accept_supersession" || canCommitFromClient),
    disabledReason:
      index === 0
        ? blockedByControls[0]?.reason ||
          (pendingAcknowledgements.length > 0
            ? "Removed facts must be acknowledged before the accept command is enabled."
            : null)
        : "Only the next workflow handoff action is enabled.",
    payload: {
      workflowId: requestContext.workflow.id,
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      currentMemoryId: current.id,
      candidateMemoryId: candidate.id,
      acceptToken: step.action === "accept_supersession" || step.action === "enqueue_supersession_decision" ? acceptToken : null,
      stateKey,
      isolationKey: scopeContract.isolationKey,
      ...asObject(step.payload)
    }
  }));

  return {
    schemaVersion: 1,
    contract: "memory-supersession-client-workflow-handoff",
    envelopeId: `${stateKey}:handoff`,
    mode: preferences.mode,
    resumeStrategy: preferences.resumeStrategy,
    stateKey,
    status: {
      persisted: persistedStateShape.status,
      readiness: readiness.status,
      validation: validationSummary.ok ? "valid" : "blocked",
      operationalHealth: operationalHealth.status,
      terminal,
      canCommitFromClient,
      blockedBy: blockedByControls.map((control) => control.control)
    },
    resumeTarget: {
      route: resumeRoute,
      requestedRoute: preferences.requestedRoute,
      returnTo: preferences.returnTo,
      mountId: preferences.mountId,
      replaceHistory: preferences.resumeStrategy === "open_handoff",
      preserveOriginView: preferences.resumeStrategy === "preserve_view"
    },
    userVisible: {
      headline: `Replace ${current.title} with ${candidate.title}`,
      statusText:
        operationalHealth.status === "failed"
          ? "Action required before this replacement can continue."
          : pendingAcknowledgements.length > 0
            ? "Review removed facts before accepting this replacement."
            : blockedByControls[0]?.reason || readiness.reason,
      primaryAction: {
        action: nextStep.action || "review_supersession",
        route: resumeRoute,
        enabled: canCommitFromClient || nextStep.action !== "accept_supersession",
        disabledReason: blockedByControls[0]?.reason || null
      }
    },
    acknowledgements: {
      requiredCount: pendingAcknowledgements.length,
      removedFacts: removedFactAcknowledgements
    },
    commandIntents,
    blockedControls: blockedByControls,
    providerHandoff: {
      negotiation: providerServiceContracts.negotiation,
      requiredServices: providerServiceContracts.requiredServices,
      unavailableRequiredServices: providerServiceContracts.unavailableRequiredServices
    },
    statePatch: {
      namespace: preferences.stateNamespace,
      mountId: preferences.mountId,
      revision: persistedStateShape.revision,
      status: persistedStateShape.status,
      selectedMemoryIds: {
        current: current.id,
        candidate: candidate.id
      },
      pendingAcknowledgementKeys: pendingAcknowledgements.map((acknowledgement) => acknowledgement.key)
    },
    proof: {
      proofSubject: `${current.id}->${candidate.id}`,
      proofPartition: scopeContract.auditHandoff.proofPartition,
      isolationKey: scopeContract.isolationKey,
      actorId: boundary.actor.id,
      permissionAllowed: boundary.decision.allowed,
      workspaceAuthorized: scopeContract.workspaceAuthorization.allowed,
      workspaceAuthorizationSource: scopeContract.workspaceAuthorization.source
    }
  };
}

function buildClientRuntimeState({
  input,
  requestContext,
  current,
  candidate,
  validation,
  readiness,
  validationSummary,
  acceptToken,
  boundary,
  scopeContract,
  lifecycleControls,
  providerServiceContracts,
  commandResult,
  operationalHealth,
  nextSteps,
  persistedStateShape,
  mailchimpSupersessionRuntime
}) {
  const preferences = normalizeClientHandoffPreferences(input, requestContext);
  const blocked = !validationSummary.ok || readiness.status === "blocked";
  const primaryAction = blocked
    ? "resolve_validation"
    : readiness.status === "ready" || readiness.status === "ready_with_warnings"
      ? "accept_supersession"
      : "review_supersession";
  const resumeRoute = blocked
    ? "memory-manager/supersession/validate"
    : primaryAction === "accept_supersession"
      ? "memory-manager/supersession/accept"
      : "memory-manager/supersession/preview";
  const disabledControls = buildClientDisabledControls({
    validationSummary,
    readiness,
    boundary,
    scopeContract,
    lifecycleControls,
    providerServiceContracts,
    commandResult
  });
  const nextClientStep = nextSteps[0] || lifecycleControls.nextAction;
  const handoffQueue = nextSteps.map((step, index) => ({
    sequence: index + 1,
    action: step.action,
    route: step.route,
    enabled: index === 0 && operationalHealth.status !== "failed",
    payload: step.payload,
    explanation: step.explanation
  }));
  const factDeltaCounts = {
    retained: candidate.facts.filter((fact) => current.facts.includes(fact)).length,
    introduced: candidate.facts.filter((fact) => !current.facts.includes(fact)).length,
    removed: current.facts.filter((fact) => !candidate.facts.includes(fact)).length
  };
  const previewAcceptancePanel = buildPreviewAcceptancePanel({
    current,
    candidate,
    validation,
    validationSummary,
    readiness,
    acceptToken,
    boundary,
    scopeContract,
    lifecycleControls,
    providerServiceContracts,
    operationalHealth,
    commandResult,
    nextSteps,
    disabledControls,
    persistedStateShape
  });
  const workflowHandoffEnvelope = buildClientWorkflowHandoffEnvelope({
    preferences,
    requestContext,
    current,
    candidate,
    validation,
    validationSummary,
    readiness,
    acceptToken,
    boundary,
    scopeContract,
    lifecycleControls,
    providerServiceContracts,
    operationalHealth,
    commandResult,
    nextSteps,
    disabledControls,
    persistedStateShape
  });

  return {
    schemaVersion: 1,
    clientId: requestContext.client.id,
    capability: requestContext.client.capability,
    sessionId: requestContext.sessionId,
    requestId: requestContext.requestId,
    route: requestContext.route.current,
    stateContract: {
      namespace: preferences.stateNamespace,
      mountId: preferences.mountId,
      stateKey: `${preferences.stateNamespace}:${requestContext.workflow.id}:${acceptToken}`,
      cacheTags: [
        `memory:${current.id}`,
        `memory:${candidate.id}`,
        `workflow:${requestContext.workflow.id}`,
        `supersession:${persistedStateShape.status}`,
        `mailchimp:${mailchimpSupersessionRuntime.context.subjectKey}`
      ],
      revision: persistedStateShape.revision,
      status: persistedStateShape.status,
      optimisticUpdatesAllowed:
        operationalHealth.status === "healthy" &&
        commandResult.effect !== "blocked" &&
        providerServiceContracts.acceptanceReady
    },
    workflow: {
      id: requestContext.workflow.id,
      step: primaryAction,
      status: readiness.status,
      label: requestContext.workflow.handoffLabel
    },
    selectedMemoryIds: {
      current: current.id,
      candidate: candidate.id
    },
    viewModel: {
      mode: preferences.mode,
      density: preferences.view.density,
      headline: `Replace ${current.title} with ${candidate.title}`,
      statusBadge:
        operationalHealth.status === "failed"
          ? "Action required"
          : blocked
            ? "Validation required"
            : readiness.status === "ready_with_warnings"
              ? "Ready with warnings"
              : "Ready",
      primaryCta: {
        action: workflowHandoffEnvelope.userVisible.primaryAction.action || nextClientStep.action || primaryAction,
        route: workflowHandoffEnvelope.userVisible.primaryAction.route || nextClientStep.route || resumeRoute,
        enabled: workflowHandoffEnvelope.userVisible.primaryAction.enabled,
        disabledReason: workflowHandoffEnvelope.userVisible.primaryAction.disabledReason
      },
      factDeltaCounts,
      evidenceDrawerVisible: preferences.view.showEvidenceDrawer,
      removedFactConfirmationRequired:
        preferences.view.requireRemovedFactConfirmation && factDeltaCounts.removed > 0,
      visibleFactLimit: preferences.view.visibleFactLimit
    },
    previewAcceptancePanel,
    workflowHandoffEnvelope,
    pendingDecision: {
      required: readiness.status !== "blocked",
      action: lifecycleControls.nextAction.action || primaryAction,
      acceptToken: readiness.status === "blocked" ? null : acceptToken,
      warningIds: validationSummary.warnings
    },
    lifecycle: {
      mode: lifecycleControls.settings.mode,
      enabled: lifecycleControls.settings.enabled,
      nextAction: lifecycleControls.nextAction,
      commandAvailability: lifecycleControls.commandAvailability,
      scheduling: lifecycleControls.scheduling
    },
    boundary: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      tenantSource: scopeContract.effectiveScope.tenantSource,
      workspaceSource: scopeContract.effectiveScope.workspaceSource,
      actorId: boundary.actor.id,
      actorRole: boundary.actor.role,
      requiredPermission: boundary.requiredPermission,
      allowed: boundary.decision.allowed,
      isolationKey: scopeContract.isolationKey,
      scopeLevel: scopeContract.scopeLevel,
      workspaceAuthorization: scopeContract.workspaceAuthorization,
      scopeResolution: {
        ok: boundary.scopeResolution.ok,
        tenantSource: scopeContract.effectiveScope.tenantSource,
        workspaceSource: scopeContract.effectiveScope.workspaceSource,
        issueCodes: boundary.scopeResolution.issues.map((issue) => issue.code)
      },
      writePolicy: scopeContract.writePolicy
    },
    controls: {
      disabled: disabledControls,
      handoffQueue,
      commandIntents: workflowHandoffEnvelope.commandIntents,
      degradedMode: operationalHealth.degradedMode,
      retry: operationalHealth.retry
    },
    mailchimpSync: {
      state: mailchimpSupersessionRuntime.state,
      ready: mailchimpSupersessionRuntime.ready,
      required: mailchimpSupersessionRuntime.required,
      subjectKey: mailchimpSupersessionRuntime.context.subjectKey,
      providerBinding: mailchimpSupersessionRuntime.providerBinding,
      runtimeStatePatch: mailchimpSupersessionRuntime.runtimeStatePatch,
      externalHandoff: mailchimpSupersessionRuntime.externalHandoff,
      validationSummary: mailchimpSupersessionRuntime.validationSummary,
      nextAction: mailchimpSupersessionRuntime.nextAction,
      proofKey: mailchimpSupersessionRuntime.proofKey
    },
    resume: {
      route: resumeRoute,
      mode: preferences.mode,
      strategy: preferences.resumeStrategy,
      requestedRoute: preferences.requestedRoute,
      payload: {
        workflowId: requestContext.workflow.id,
        currentMemoryId: current.id,
        candidateMemoryId: candidate.id,
        acceptToken: readiness.status === "blocked" ? null : acceptToken,
        stateKey: `${preferences.stateNamespace}:${requestContext.workflow.id}:${acceptToken}`,
        handoffEnvelopeId: workflowHandoffEnvelope.envelopeId,
        status: persistedStateShape.status,
        isolationKey: scopeContract.isolationKey,
        mailchimpSyncState: mailchimpSupersessionRuntime.state,
        mailchimpSubjectKey: mailchimpSupersessionRuntime.context.subjectKey,
        mailchimpHandoffRef: mailchimpSupersessionRuntime.externalHandoff.payloadRef
      },
      returnTo: preferences.returnTo
    }
  };
}

function buildWorkflowHandoff({
  requestContext,
  current,
  candidate,
  readiness,
  validationSummary,
  acceptToken,
  boundary,
  scopeContract,
  lifecycleControls
}) {
  const handoffKind = !validationSummary.ok
    ? "validation"
    : readiness.status === "ready" || readiness.status === "ready_with_warnings"
      ? "decision"
      : "preview";
  const route = handoffKind === "validation"
    ? "memory-manager/supersession/validate"
    : handoffKind === "decision"
      ? "memory-manager/supersession/accept"
      : "memory-manager/supersession/preview";

  return {
    handoffKind,
    route,
    label: requestContext.workflow.handoffLabel,
    proofSubject: `${current.id}->${candidate.id}`,
    clientInstruction:
      handoffKind === "validation"
        ? "Show failed checks and keep the accept action disabled until blockers are resolved."
        : handoffKind === "decision"
          ? "Show the accept/reject decision with retained, introduced, and removed facts."
          : "Show a read-only preview and preserve the workflow resume payload.",
    payload: {
      workflowId: requestContext.workflow.id,
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      currentMemoryId: current.id,
      candidateMemoryId: candidate.id,
      acceptToken: handoffKind === "decision" ? acceptToken : null,
      blockerFailures: validationSummary.blockerFailures,
      warnings: validationSummary.warnings,
      lifecycleNextAction: lifecycleControls.nextAction.action,
      schedulingToken: lifecycleControls.scheduling.scheduleToken,
      isolationKey: scopeContract.isolationKey,
      scopeLevel: scopeContract.scopeLevel,
      tenantSource: scopeContract.effectiveScope.tenantSource,
      workspaceSource: scopeContract.effectiveScope.workspaceSource,
      scopeResolutionIssues: boundary.scopeResolution.issues.map((issue) => issue.code)
    },
    auditScope: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      actorId: boundary.actor.id,
      requiredPermission: boundary.requiredPermission,
      permissionAllowed: boundary.decision.allowed,
      workspaceAuthorization: scopeContract.workspaceAuthorization,
      isolationKey: scopeContract.isolationKey,
      proofPartition: scopeContract.auditHandoff.proofPartition,
      boundaryProof: scopeContract.auditHandoff.boundaryProof,
      writePolicy: scopeContract.writePolicy
    }
  };
}

function normalizeHistorySnapshots(value) {
  return asArray(value)
    .map((snapshot, index) => {
      const entry = asObject(snapshot);
      const counters = asObject(entry.counters);

      return {
        sequence: Number.isInteger(entry.sequence) && entry.sequence >= 0 ? entry.sequence : index + 1,
        capturedAt: cleanString(entry.capturedAt),
        status: cleanString(entry.status) || "unknown",
        route: cleanString(entry.route),
        revision: Number.isInteger(entry.revision) && entry.revision >= 0 ? entry.revision : 0,
        counters: {
          blockers: Number.isInteger(counters.blockers) && counters.blockers >= 0 ? counters.blockers : 0,
          warnings: Number.isInteger(counters.warnings) && counters.warnings >= 0 ? counters.warnings : 0,
          introducedFacts:
            Number.isInteger(counters.introducedFacts) && counters.introducedFacts >= 0
              ? counters.introducedFacts
              : 0,
          removedFacts:
            Number.isInteger(counters.removedFacts) && counters.removedFacts >= 0 ? counters.removedFacts : 0,
          evidenceItems:
            Number.isInteger(counters.evidenceItems) && counters.evidenceItems >= 0 ? counters.evidenceItems : 0,
          mailchimpRequired:
            Number.isInteger(counters.mailchimpRequired) && counters.mailchimpRequired >= 0
              ? counters.mailchimpRequired
              : 0,
          mailchimpReady:
            Number.isInteger(counters.mailchimpReady) && counters.mailchimpReady >= 0
              ? counters.mailchimpReady
              : 0,
          mailchimpBlockers:
            Number.isInteger(counters.mailchimpBlockers) && counters.mailchimpBlockers >= 0
              ? counters.mailchimpBlockers
              : 0,
          mailchimpContinuityReplaySafe:
            Number.isInteger(counters.mailchimpContinuityReplaySafe) && counters.mailchimpContinuityReplaySafe >= 0
              ? counters.mailchimpContinuityReplaySafe
              : 0
        }
      };
    })
    .filter((snapshot) => snapshot.capturedAt || snapshot.revision > 0 || snapshot.status !== "unknown")
    .slice(-(ANALYTICS_HISTORY_LIMIT - 1));
}

function sumHistoryCounters(snapshots) {
  return snapshots.reduce(
    (totals, snapshot) => ({
      blockers: totals.blockers + snapshot.counters.blockers,
      warnings: totals.warnings + snapshot.counters.warnings,
      introducedFacts: totals.introducedFacts + snapshot.counters.introducedFacts,
      removedFacts: totals.removedFacts + snapshot.counters.removedFacts,
      evidenceItems: totals.evidenceItems + snapshot.counters.evidenceItems,
      mailchimpRequired: totals.mailchimpRequired + snapshot.counters.mailchimpRequired,
      mailchimpReady: totals.mailchimpReady + snapshot.counters.mailchimpReady,
      mailchimpBlockers: totals.mailchimpBlockers + snapshot.counters.mailchimpBlockers,
      mailchimpContinuityReplaySafe:
        totals.mailchimpContinuityReplaySafe + snapshot.counters.mailchimpContinuityReplaySafe
    }),
    {
      blockers: 0,
      warnings: 0,
      introducedFacts: 0,
      removedFacts: 0,
      evidenceItems: 0,
      mailchimpRequired: 0,
      mailchimpReady: 0,
      mailchimpBlockers: 0,
      mailchimpContinuityReplaySafe: 0
    }
  );
}

function buildAnalyticsHistoryRollup(historySnapshots) {
  const previous = historySnapshots.slice(0, -1);
  const current = historySnapshots.at(-1) || null;
  const trendWindow = historySnapshots.slice(-ANALYTICS_TREND_WINDOW);
  const previousSnapshot = previous.at(-1) || null;
  const totals = sumHistoryCounters(historySnapshots);
  const trendTotals = sumHistoryCounters(trendWindow);
  const statusCounts = historySnapshots.reduce((counts, snapshot) => {
    counts[snapshot.status] = (counts[snapshot.status] || 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 1,
    retention: {
      limit: ANALYTICS_HISTORY_LIMIT,
      retained: historySnapshots.length,
      droppedFromInput: Math.max(0, previous.length + 1 - ANALYTICS_HISTORY_LIMIT)
    },
    current: current
      ? {
          sequence: current.sequence,
          capturedAt: current.capturedAt,
          status: current.status,
          revision: current.revision,
          route: current.route
        }
      : null,
    deltasFromPrevious: previousSnapshot && current
      ? {
          blockers: current.counters.blockers - previousSnapshot.counters.blockers,
          warnings: current.counters.warnings - previousSnapshot.counters.warnings,
          introducedFacts: current.counters.introducedFacts - previousSnapshot.counters.introducedFacts,
          removedFacts: current.counters.removedFacts - previousSnapshot.counters.removedFacts,
          evidenceItems: current.counters.evidenceItems - previousSnapshot.counters.evidenceItems,
          mailchimpRequired: current.counters.mailchimpRequired - previousSnapshot.counters.mailchimpRequired,
          mailchimpReady: current.counters.mailchimpReady - previousSnapshot.counters.mailchimpReady,
          mailchimpBlockers: current.counters.mailchimpBlockers - previousSnapshot.counters.mailchimpBlockers,
          mailchimpContinuityReplaySafe:
            current.counters.mailchimpContinuityReplaySafe - previousSnapshot.counters.mailchimpContinuityReplaySafe,
          revision: current.revision - previousSnapshot.revision
        }
      : null,
    totals,
    trendWindow: {
      size: trendWindow.length,
      firstSequence: trendWindow[0]?.sequence || null,
      lastSequence: trendWindow.at(-1)?.sequence || null,
      totals: trendTotals,
      blockerRate: trendWindow.length > 0 ? trendTotals.blockers / trendWindow.length : 0,
      warningRate: trendWindow.length > 0 ? trendTotals.warnings / trendWindow.length : 0,
      statusCounts
    }
  };
}

function normalizeAnalyticsExportPreferences(value) {
  const preferences = asObject(value);
  const requestedFormats = asArray(preferences.formats || preferences.format)
    .map(cleanString)
    .filter((format) => ANALYTICS_EXPORT_FORMATS.has(format));
  const formats = requestedFormats.length > 0 ? [...new Set(requestedFormats)].sort() : ["json"];

  return {
    schemaVersion: 1,
    formats,
    includeRows: preferences.includeRows === false ? false : true,
    includeTimeline: preferences.includeTimeline === false ? false : true,
    includeHistory: preferences.includeHistory === false ? false : true,
    destination:
      cleanString(preferences.destination) ||
      cleanString(preferences.route) ||
      "memory-manager/supersession/analytics/export",
    requestedBy: cleanString(preferences.requestedBy),
    retentionLabel: cleanString(preferences.retentionLabel) || `last-${ANALYTICS_HISTORY_LIMIT}-snapshots`
  };
}

function buildAnalyticsExportManifest({ now, requestContext, acceptToken, preferences, exportRows, timeline, historyRollup }) {
  const rowKinds = [...new Set(exportRows.map((row) => row.kind))].sort();
  const manifestId = `${surfaceId}:${requestContext.workflow.id}:${acceptToken}:analytics-export`;
  const partitions = preferences.formats.map((format) => ({
    format,
    route: `${preferences.destination}.${format}`,
    contentType:
      format === "csv"
        ? "text/csv"
        : format === "jsonl"
          ? "application/x-ndjson"
          : "application/json",
    rowCount: preferences.includeRows ? exportRows.length : 0,
    timelineEvents: preferences.includeTimeline ? timeline.length : 0,
    historySnapshots: preferences.includeHistory ? historyRollup.retention.retained : 0
  }));

  return {
    schemaVersion: 1,
    manifestId,
    generatedAt: now,
    destination: preferences.destination,
    requestedBy: preferences.requestedBy || requestContext.client.id,
    retentionLabel: preferences.retentionLabel,
    rowKinds,
    partitions,
    proof: {
      proofKey: `${manifestId}:proof`,
      hashAlgorithm: CHECKPOINT_HASH_ALGORITHM,
      hash: hashStablePayload({
        manifestId,
        workflowId: requestContext.workflow.id,
        acceptToken,
        rowKinds,
        rowCount: exportRows.length,
        timelineCount: timeline.length,
        historyRetained: historyRollup.retention.retained
      })
    }
  };
}

function buildSupersessionAnalytics({
  now,
  input,
  requestedState,
  requestContext,
  current,
  candidate,
  validation,
  validationSummary,
  readiness,
  boundary,
  scopeContract,
  evidence,
  command,
  commandResult,
  recoveryStatus,
  persistedStateShape,
  lifecycleControls,
  acceptToken,
  mailchimpSupersessionRuntime
}) {
  const persistedAnalytics = asObject(asObject(input.persistedState).analytics);
  const analyticsInput = asObject(input.analytics || input.analyticsExport || persistedAnalytics.exportPreferences);
  const historyInput = asArray(input.history).length > 0 ? input.history : persistedAnalytics.historySnapshots;
  const exportPreferences = normalizeAnalyticsExportPreferences(analyticsInput);
  const previousSnapshots = normalizeHistorySnapshots(historyInput);
  const mailchimpRuntime = asObject(mailchimpSupersessionRuntime);
  const mailchimpContext = asObject(mailchimpRuntime.context);
  const mailchimpValidation = asObject(mailchimpRuntime.validationSummary);
  const mailchimpContinuity = asObject(mailchimpRuntime.continuity);
  const mailchimpExternalHandoff = asObject(mailchimpRuntime.externalHandoff);
  const mailchimpBlockers = asArray(mailchimpValidation.blockers);
  const mailchimpIssues = asArray(mailchimpValidation.issues);
  const mailchimpSubjectKey = cleanString(mailchimpContext.subjectKey) || "mailchimp:unbound";
  const mailchimpContinuityStatus = cleanString(mailchimpContinuity.status) || "not_applicable";
  const mailchimpRequired = mailchimpRuntime.required === true;
  const mailchimpReady = mailchimpRuntime.ready === true;
  const counters = {
    validationChecks: validation.checks.length,
    validationPassed: validationSummary.passed,
    validationFailed: validationSummary.failed,
    blockerFailures: validationSummary.blockerFailures.length,
    warnings: validationSummary.warnings.length,
    retainedFacts: validation.retainedFacts.length,
    introducedFacts: validation.introducedFacts.length,
    removedFacts: validation.removedFacts.length,
    evidenceItems: evidence.length,
    permissionAllowed: boundary.decision.allowed ? 1 : 0,
    workspaceAuthorizationRequired: scopeContract.workspaceAuthorization.required ? 1 : 0,
    workspaceAuthorized: scopeContract.workspaceAuthorization.allowed ? 1 : 0,
    workspaceGrantCount: scopeContract.workspaceAuthorization.grantCount,
    recoveryRecovered: recoveryStatus.recovered ? 1 : 0,
    commandNoop: commandResult.effect === "noop" ? 1 : 0,
    commandBlocked: commandResult.effect === "blocked" ? 1 : 0,
    decisionProjected: TERMINAL_PERSISTED_STATUSES.has(persistedStateShape.status) ? 1 : 0,
    lifecycleEnabled: lifecycleControls.settings.enabled ? 1 : 0,
    schedulingEnabled: lifecycleControls.scheduling.enabled ? 1 : 0,
    lifecycleSettingIssues: lifecycleControls.settingsControlPlane.issues.length,
    lifecycleSettingBlockers: lifecycleControls.settingsControlPlane.issues.filter(
      (issue) => issue.severity === "blocker"
    ).length,
    scopeResolutionIssues: boundary.scopeResolution.issues.length,
    tenantScopeInferred: scopeContract.effectiveScope.tenantSource === "memory_pair_inferred" ? 1 : 0,
    workspaceScopeInferred: scopeContract.effectiveScope.workspaceSource === "memory_pair_inferred" ? 1 : 0,
    scopeViolations: scopeContract.violations.length,
    scopedWriteAllowed: scopeContract.writePolicy.allowStateWrite ? 1 : 0,
    mailchimpRequired: mailchimpRequired ? 1 : 0,
    mailchimpReady: mailchimpReady ? 1 : 0,
    mailchimpBlocked: mailchimpRequired && !mailchimpReady ? 1 : 0,
    mailchimpBlockers: mailchimpBlockers.length,
    mailchimpValidationIssues: mailchimpIssues.length,
    mailchimpContinuityReplaySafe: mailchimpContinuity.replaySafe === true ? 1 : 0,
    mailchimpPayloadReady: mailchimpExternalHandoff.payload ? 1 : 0,
    mailchimpEventKinds: asArray(asObject(mailchimpContext.sync).eventKinds).length,
    historySnapshotsRetained: previousSnapshots.length + 1,
    exportFormatsRequested: exportPreferences.formats.length
  };
  const currentSnapshot = {
    sequence: previousSnapshots.reduce((max, snapshot) => Math.max(max, snapshot.sequence), 0) + 1,
    capturedAt: now,
    status: persistedStateShape.status,
    route: recoveryStatus.route,
    revision: persistedStateShape.revision,
    workflowId: requestContext.workflow.id,
    acceptToken,
    counters: {
      blockers: counters.blockerFailures,
      warnings: counters.warnings,
      introducedFacts: counters.introducedFacts,
      removedFacts: counters.removedFacts,
      evidenceItems: counters.evidenceItems,
      mailchimpRequired: counters.mailchimpRequired,
      mailchimpReady: counters.mailchimpReady,
      mailchimpBlockers: counters.mailchimpBlockers,
      mailchimpContinuityReplaySafe: counters.mailchimpContinuityReplaySafe
    }
  };
  const historySnapshots = [...previousSnapshots, currentSnapshot].slice(-ANALYTICS_HISTORY_LIMIT);
  const historyRollup = buildAnalyticsHistoryRollup(historySnapshots);
  const timeline = [
    {
      at: now,
      event: "command_received",
      status: command.action,
      route: requestContext.route.current,
      actorId: boundary.actor.id
    },
    {
      at: now,
      event: "boundary_evaluated",
      status: boundary.decision.allowed ? "allowed" : "denied",
      route: "memory-manager/supersession/permissions",
      actorRole: boundary.actor.role,
      requiredPermission: boundary.requiredPermission,
      isolationKey: scopeContract.isolationKey,
      tenantSource: scopeContract.effectiveScope.tenantSource,
      workspaceSource: scopeContract.effectiveScope.workspaceSource,
      scopeResolutionOk: boundary.scopeResolution.ok,
      scopeResolutionIssues: boundary.scopeResolution.issues.map((issue) => issue.code),
      workspaceAuthorizationSource: scopeContract.workspaceAuthorization.source
    },
    {
      at: now,
      event: "scope_contract_evaluated",
      status: scopeContract.writePolicy.allowStateWrite ? "write_allowed" : "write_blocked",
      route: "memory-manager/supersession/scope",
      isolationKey: scopeContract.isolationKey,
      scopeLevel: scopeContract.scopeLevel,
      workspaceAuthorized: scopeContract.workspaceAuthorization.allowed,
      tenantSource: scopeContract.effectiveScope.tenantSource,
      workspaceSource: scopeContract.effectiveScope.workspaceSource,
      scopeResolutionOk: boundary.scopeResolution.ok,
      violations: scopeContract.violations.map((violation) => violation.code)
    },
    {
      at: now,
      event: "validation_summarized",
      status: validationSummary.ok ? "passed" : "failed",
      route: validationSummary.ok ? "memory-manager/supersession/preview" : "memory-manager/supersession/validate",
      passed: validationSummary.passed,
      failed: validationSummary.failed
    },
    {
      at: now,
      event: "recovery_resolved",
      status: recoveryStatus.status,
      route: recoveryStatus.route,
      restartSafe: recoveryStatus.restartSafe
    },
    {
      at: now,
      event: "state_projected",
      status: persistedStateShape.status,
      route: TERMINAL_PERSISTED_STATUSES.has(persistedStateShape.status)
        ? "memory-manager/supersession/status"
        : recoveryStatus.route,
      revision: persistedStateShape.revision
    },
    {
      at: now,
      event: "lifecycle_controls_projected",
      status: lifecycleControls.nextAction.action,
      route: lifecycleControls.nextAction.route,
      mode: lifecycleControls.settings.mode,
      schedulingPolicy: lifecycleControls.settings.scheduling.policy
    },
    {
      at: now,
      event: "mailchimp_supersession_sync_evaluated",
      status: mailchimpRequired ? (mailchimpReady ? "ready" : "blocked") : "not_required",
      route: mailchimpReady
        ? mailchimpExternalHandoff.route || "memory-manager/supersession/provider/mailchimp/accept"
        : "memory-manager/supersession/provider/mailchimp",
      subjectKey: mailchimpSubjectKey,
      required: mailchimpRequired,
      ready: mailchimpReady,
      continuityStatus: mailchimpContinuityStatus,
      replaySafe: mailchimpContinuity.replaySafe === true,
      payloadRef: cleanString(mailchimpExternalHandoff.payloadRef),
      blockers: mailchimpBlockers,
      issueCount: mailchimpIssues.length
    },
    {
      at: now,
      event: "analytics_export_projected",
      status: exportPreferences.formats.join("+"),
      route: exportPreferences.destination,
      manifestId: `${surfaceId}:${requestContext.workflow.id}:${acceptToken}:analytics-export`,
      rowCount: "pending",
      includeRows: exportPreferences.includeRows,
      includeTimeline: exportPreferences.includeTimeline,
      includeHistory: exportPreferences.includeHistory
    }
  ];
  const exportRows = [
    {
      kind: "supersession_summary",
      workflowId: requestContext.workflow.id,
      currentMemoryId: current.id,
      candidateMemoryId: candidate.id,
      requestedState,
      projectedStatus: persistedStateShape.status,
      readinessStatus: readiness.status,
      canRetryCommand: commandResult.idempotent,
      lifecycleMode: lifecycleControls.settings.mode,
      nextAction: lifecycleControls.nextAction.action,
      isolationKey: scopeContract.isolationKey,
      scopedWriteAllowed: scopeContract.writePolicy.allowStateWrite,
      tenantSource: scopeContract.effectiveScope.tenantSource,
      workspaceSource: scopeContract.effectiveScope.workspaceSource,
      scopeResolutionOk: boundary.scopeResolution.ok,
      workspaceAuthorizationRequired: scopeContract.workspaceAuthorization.required,
      workspaceAuthorized: scopeContract.workspaceAuthorization.allowed,
      workspaceAuthorizationSource: scopeContract.workspaceAuthorization.source,
      historySnapshotsRetained: historyRollup.retention.retained,
      exportFormats: exportPreferences.formats,
      mailchimpSyncRequired: mailchimpRequired,
      mailchimpSyncReady: mailchimpReady,
      mailchimpSubjectKey,
      mailchimpContinuityStatus,
      mailchimpBlockerCount: mailchimpBlockers.length
    },
    {
      kind: "analytics_history_rollup",
      workflowId: requestContext.workflow.id,
      retainedSnapshots: historyRollup.retention.retained,
      retentionLimit: historyRollup.retention.limit,
      currentStatus: historyRollup.current?.status || persistedStateShape.status,
      currentRevision: historyRollup.current?.revision || persistedStateShape.revision,
      totalBlockers: historyRollup.totals.blockers,
      totalWarnings: historyRollup.totals.warnings,
      totalIntroducedFacts: historyRollup.totals.introducedFacts,
      totalRemovedFacts: historyRollup.totals.removedFacts,
      trendBlockerRate: historyRollup.trendWindow.blockerRate,
      trendWarningRate: historyRollup.trendWindow.warningRate,
      totalMailchimpRequired: historyRollup.totals.mailchimpRequired,
      totalMailchimpReady: historyRollup.totals.mailchimpReady,
      totalMailchimpBlockers: historyRollup.totals.mailchimpBlockers,
      totalMailchimpReplaySafe: historyRollup.totals.mailchimpContinuityReplaySafe
    },
    {
      kind: "analytics_export_manifest",
      workflowId: requestContext.workflow.id,
      destination: exportPreferences.destination,
      formats: exportPreferences.formats,
      includeRows: exportPreferences.includeRows,
      includeTimeline: exportPreferences.includeTimeline,
      includeHistory: exportPreferences.includeHistory,
      retentionLabel: exportPreferences.retentionLabel
    },
    {
      kind: "workspace_authorization",
      workflowId: requestContext.workflow.id,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      actorId: boundary.actor.id,
      actorRole: boundary.actor.role,
      requiredPermission: boundary.requiredPermission,
      required: scopeContract.workspaceAuthorization.required,
      allowed: scopeContract.workspaceAuthorization.allowed,
      source: scopeContract.workspaceAuthorization.source,
      tenantSource: scopeContract.effectiveScope.tenantSource,
      workspaceSource: scopeContract.effectiveScope.workspaceSource,
      scopeResolutionOk: boundary.scopeResolution.ok,
      matchingGrantId: scopeContract.workspaceAuthorization.matchingGrantId,
      grantCount: scopeContract.workspaceAuthorization.grantCount,
      reason: scopeContract.workspaceAuthorization.reason
    },
    {
      kind: "mailchimp_supersession_sync",
      workflowId: requestContext.workflow.id,
      subjectKey: mailchimpSubjectKey,
      required: mailchimpRequired,
      ready: mailchimpReady,
      state: cleanString(mailchimpRuntime.state) || "not_applicable",
      providerReady: asObject(mailchimpRuntime.providerBinding).providerReady === true,
      route: mailchimpExternalHandoff.route || null,
      payloadRef: cleanString(mailchimpExternalHandoff.payloadRef),
      continuityStatus: mailchimpContinuityStatus,
      continuityCheckpointKey: cleanString(mailchimpContinuity.checkpointKey),
      replaySafe: mailchimpContinuity.replaySafe === true,
      externalRevision: cleanString(asObject(mailchimpContext.sync).externalRevision),
      eventKinds: asArray(asObject(mailchimpContext.sync).eventKinds),
      syncMode: cleanString(asObject(mailchimpContext.sync).mode),
      blockerCount: mailchimpBlockers.length,
      blockers: mailchimpBlockers,
      issueCount: mailchimpIssues.length,
      proofKey: cleanString(mailchimpRuntime.proofKey)
    },
    ...mailchimpBlockers.map((blocker) => ({
      kind: "mailchimp_sync_blocker",
      workflowId: requestContext.workflow.id,
      subjectKey: mailchimpSubjectKey,
      blocker,
      route: "memory-manager/supersession/provider/mailchimp",
      continuityStatus: mailchimpContinuityStatus
    })),
    ...mailchimpIssues.map((issue) => ({
      kind: "mailchimp_sync_issue",
      workflowId: requestContext.workflow.id,
      subjectKey: mailchimpSubjectKey,
      severity: issue.severity || "warning",
      field: issue.field || "mailchimp",
      message: issue.message || issue.code || "Mailchimp supersession sync requires review.",
      allowed: issue.allowed || null
    })),
    ...boundary.scopeResolution.issues.map((issue) => ({
      kind: "scope_resolution_issue",
      workflowId: requestContext.workflow.id,
      code: issue.code,
      field: issue.field,
      severity: issue.severity,
      route: issue.route,
      message: issue.message,
      candidates: issue.candidates
    })),
    {
      kind: "lifecycle_controls",
      workflowId: requestContext.workflow.id,
      enabled: lifecycleControls.settings.enabled,
      mode: lifecycleControls.settings.mode,
      nextAction: lifecycleControls.nextAction.action,
      schedulingEnabled: lifecycleControls.scheduling.enabled,
      schedulingPolicy: lifecycleControls.scheduling.policy,
      settingsStatus: lifecycleControls.settingsControlPlane.status,
      settingIssueCount: lifecycleControls.settingsControlPlane.issues.length
    },
    ...lifecycleControls.settingsControlPlane.issues.map((issue) => ({
      kind: "lifecycle_setting_issue",
      workflowId: requestContext.workflow.id,
      code: issue.code,
      severity: issue.severity,
      route: issue.route,
      message: issue.message,
      affectedCommands: issue.affectedCommands
    })),
    ...validation.checks.map((check) => ({
      kind: "validation_check",
      workflowId: requestContext.workflow.id,
      checkId: check.id,
      ok: check.ok,
      severity: check.severity,
      message: check.message
    })),
    ...validation.introducedFacts.map((fact) => ({
      kind: "fact_delta",
      workflowId: requestContext.workflow.id,
      delta: "introduced",
      fact
    })),
    ...validation.removedFacts.map((fact) => ({
      kind: "fact_delta",
      workflowId: requestContext.workflow.id,
      delta: "removed",
      fact
    })),
    ...scopeContract.violations.map((violation) => ({
      kind: "scope_violation",
      workflowId: requestContext.workflow.id,
      isolationKey: scopeContract.isolationKey,
      code: violation.code,
      severity: violation.severity,
      message: violation.message
    }))
  ];
  const exportManifest = buildAnalyticsExportManifest({
    now,
    requestContext,
    acceptToken,
    preferences: exportPreferences,
    exportRows,
    timeline: timeline.map((event) =>
      event.event === "analytics_export_projected" ? { ...event, rowCount: exportRows.length } : event
    ),
    historyRollup
  });
  const finalizedTimeline = timeline.map((event) =>
    event.event === "analytics_export_projected"
      ? {
          ...event,
          rowCount: exportRows.length,
          partitionCount: exportManifest.partitions.length,
          proofKey: exportManifest.proof.proofKey
        }
      : event
  );

  return {
    schemaVersion: 1,
    counters,
    historySnapshots,
    historyRollup,
    timeline: finalizedTimeline,
    report: {
      title: `Supersession ${current.id} -> ${candidate.id}`,
      generatedAt: now,
      status: persistedStateShape.status,
      readiness: readiness.status,
      riskLevel:
        counters.blockerFailures > 0
          ? "blocked"
          : counters.warnings > 0 || counters.removedFacts > 0
            ? "review"
            : "clear",
      summary:
        `${counters.introducedFacts} introduced fact(s), ${counters.removedFacts} removed fact(s), ` +
        `${counters.blockerFailures} blocker(s), ${counters.warnings} warning(s), ` +
        `${counters.scopeViolations} scope violation(s), ` +
        `${counters.mailchimpBlockers} Mailchimp sync blocker(s).`,
      mailchimp: {
        required: mailchimpRequired,
        ready: mailchimpReady,
        subjectKey: mailchimpSubjectKey,
        continuityStatus: mailchimpContinuityStatus,
        blockerCount: mailchimpBlockers.length,
        payloadRef: cleanString(mailchimpExternalHandoff.payloadRef)
      },
      trend:
        historyRollup.deltasFromPrevious
          ? {
              blockerDelta: historyRollup.deltasFromPrevious.blockers,
              warningDelta: historyRollup.deltasFromPrevious.warnings,
              removedFactDelta: historyRollup.deltasFromPrevious.removedFacts,
              mailchimpBlockerDelta: historyRollup.deltasFromPrevious.mailchimpBlockers,
              revisionDelta: historyRollup.deltasFromPrevious.revision
            }
          : null
    },
    exportSummary: {
      schemaVersion: 1,
      exportKind: "memory-supersession-analytics",
      generatedAt: now,
      proofKey: `${surfaceId}:${requestContext.workflow.id}:${acceptToken}:analytics`,
      manifest: exportManifest,
      formats: exportPreferences.formats,
      destination: exportPreferences.destination,
      rowCount: exportRows.length,
      rows: exportPreferences.includeRows ? exportRows : []
    }
  };
}

function normalizeCapabilitySet(value) {
  return new Set(asArray(value).map((capability) => cleanString(capability)).filter(Boolean));
}

function normalizeProviderContract(value, fallback) {
  const provider = asObject(value);
  const sync = asObject(provider.sync);
  const handoff = asObject(provider.handoff);
  const health = asObject(provider.health);
  const capabilities = normalizeCapabilitySet(provider.capabilities || provider.supportedCapabilities);
  const status = cleanString(provider.status) || cleanString(health.status) || fallback.status;

  return {
    id: cleanString(provider.id) || fallback.id,
    service: cleanString(provider.service) || fallback.service,
    status,
    endpoint: cleanString(provider.endpoint) || cleanString(provider.route) || fallback.endpoint,
    capabilities,
    sync: {
      cursor: cleanString(sync.cursor) || cleanString(provider.syncCursor),
      revision: Number.isInteger(sync.revision) && sync.revision >= 0 ? sync.revision : null,
      watermark: cleanString(sync.watermark) || cleanString(provider.watermark),
      lastSyncedAt: cleanString(sync.lastSyncedAt) || cleanString(provider.lastSyncedAt)
    },
    handoff: {
      route: cleanString(handoff.route) || fallback.handoffRoute,
      mode: cleanString(handoff.mode) || fallback.handoffMode,
      externalRef: cleanString(handoff.externalRef) || cleanString(provider.externalRef)
    },
    latencyMs:
      Number.isInteger(health.latencyMs) && health.latencyMs >= 0
        ? health.latencyMs
        : Number.isInteger(provider.latencyMs) && provider.latencyMs >= 0
          ? provider.latencyMs
          : null
  };
}

function findProviderInput(input, service) {
  const providers = [
    ...asArray(input.integrationProviders),
    ...asArray(input.providers),
    ...asArray(asObject(input.hostedKernel).providers)
  ];

  return providers.find((provider) => cleanString(asObject(provider).service) === service) || {};
}

function buildProviderServiceIntent({
  provider,
  service,
  command,
  lifecycleControls,
  workflowHandoff,
  acceptToken,
  requiredCapabilities,
  missingCapabilities,
  capabilityMode
}) {
  const operation = PROVIDER_SERVICE_OPERATION_REQUIREMENTS[service] || {
    operation: `invoke_${service}`,
    method: "POST",
    idempotent: true,
    requiredWhen: "optional"
  };
  const serviceRequired =
    operation.requiredWhen === "always" ||
    (operation.requiredWhen === "accepted" && command.action === "accept") ||
    (operation.requiredWhen === "proof_required" && lifecycleControls.settings.audit.requireProof) ||
    (operation.requiredWhen === "scheduled" && lifecycleControls.scheduling.enabled);
  const syncCursor = provider.sync.cursor || `${surfaceId}:${acceptToken}:${service}:initial`;
  const expectedRevision =
    Number.isInteger(provider.sync.revision) && provider.sync.revision >= 0
      ? provider.sync.revision + (serviceRequired ? 1 : 0)
      : null;
  const handoffRequired = service === "handoff" || provider.handoff.mode === "external";
  const handoffState =
    provider.handoff.mode === "external" && !provider.handoff.externalRef
      ? "awaiting_external_reference"
      : handoffRequired
        ? "ready"
        : "not_required";
  const negotiationStatus =
    capabilityMode === "explicit" && missingCapabilities.length > 0
      ? "capability_blocked"
      : handoffState === "awaiting_external_reference"
        ? "handoff_blocked"
        : serviceRequired && provider.status !== "ready" && provider.status !== "optional" && provider.status !== "degraded"
          ? "status_blocked"
          : "ready";

  return {
    schemaVersion: 1,
    service,
    operation: operation.operation,
    method: operation.method,
    idempotent: operation.idempotent,
    requiredForCommand: serviceRequired,
    route: provider.endpoint,
    commandEnvelope: {
      commandId: command.id,
      action: command.action,
      idempotencyKey: `${command.idempotencyKey}:${service}`,
      acceptToken
    },
    capabilityNegotiation: {
      status: negotiationStatus,
      mode: capabilityMode,
      required: requiredCapabilities,
      advertised: [...provider.capabilities].sort(),
      missing: capabilityMode === "explicit" ? missingCapabilities : []
    },
    syncCheckpoint: {
      cursor: syncCursor,
      revision: provider.sync.revision,
      expectedRevision,
      watermark: provider.sync.watermark,
      lastSyncedAt: provider.sync.lastSyncedAt,
      checkpointKey: `${surfaceId}:${acceptToken}:${service}:sync`,
      conflictPolicy: service === "state" ? "compare_revision" : "append_with_idempotency_key"
    },
    externalHandoffState: {
      required: handoffRequired,
      route: provider.handoff.route || workflowHandoff.route,
      mode: provider.handoff.mode,
      externalRef: provider.handoff.externalRef,
      state: handoffState,
      resumeRoute: workflowHandoff.route,
      workflowKind: workflowHandoff.handoffKind
    }
  };
}

function buildProviderServiceContracts({ input, command, lifecycleControls, workflowHandoff, acceptToken }) {
  const defaults = [
    {
      service: "state",
      id: "hosted-kernel-supersession-state",
      status: "ready",
      endpoint: "memory-manager/supersession/state",
      handoffRoute: "memory-manager/supersession/state",
      handoffMode: "internal"
    },
    {
      service: "memory",
      id: "hosted-kernel-memory-store",
      status: "ready",
      endpoint: "memory-manager/memories/activate",
      handoffRoute: "memory-manager/memories/supersession-preview",
      handoffMode: "internal"
    },
    {
      service: "audit",
      id: "hosted-kernel-audit-ledger",
      status: "ready",
      endpoint: lifecycleControls.settings.audit.proofRoute,
      handoffRoute: lifecycleControls.settings.audit.proofRoute,
      handoffMode: "internal"
    },
    {
      service: "schedule",
      id: "hosted-kernel-scheduler",
      status: lifecycleControls.settings.scheduling.policy === "disabled" ? "optional" : "ready",
      endpoint: "memory-manager/supersession/schedule",
      handoffRoute: "memory-manager/supersession/schedule",
      handoffMode: "internal"
    },
    {
      service: "handoff",
      id: "hosted-kernel-workflow-handoff",
      status: "ready",
      endpoint: workflowHandoff.route,
      handoffRoute: workflowHandoff.route,
      handoffMode: "client"
    }
  ];
  const providers = defaults.map((fallback) => {
    const provider = normalizeProviderContract(findProviderInput(input, fallback.service), fallback);
    const requiredCapabilities = PROVIDER_CAPABILITY_REQUIREMENTS[fallback.service] || [];
    const missingCapabilities = requiredCapabilities.filter((capability) => !provider.capabilities.has(capability));
    const capabilityMode = provider.capabilities.size === 0 ? "assumed_by_hosted_kernel_default" : "explicit";
    const serviceIntent = buildProviderServiceIntent({
      provider,
      service: fallback.service,
      command,
      lifecycleControls,
      workflowHandoff,
      acceptToken,
      requiredCapabilities,
      missingCapabilities,
      capabilityMode
    });
    const available =
      provider.status === "ready" ||
      provider.status === "optional" ||
      (provider.status === "degraded" && fallback.service !== "memory");
    const handoffReady = serviceIntent.externalHandoffState.state !== "awaiting_external_reference";
    const capabilityReady =
      capabilityMode !== "explicit" || serviceIntent.capabilityNegotiation.missing.length === 0;

    return {
      service: fallback.service,
      providerId: provider.id,
      endpoint: provider.endpoint,
      status: provider.status,
      capabilityMode,
      requiredCapabilities,
      advertisedCapabilities: [...provider.capabilities].sort(),
      missingCapabilities: capabilityMode === "explicit" ? missingCapabilities : [],
      available: available && capabilityReady && handoffReady,
      serviceIntent,
      sync: provider.sync,
      externalHandoff: {
        required: serviceIntent.externalHandoffState.required,
        route: serviceIntent.externalHandoffState.route,
        mode: provider.handoff.mode,
        externalRef: provider.handoff.externalRef,
        state: serviceIntent.externalHandoffState.state,
        acceptToken,
        commandId: command.id
      },
      latencyMs: provider.latencyMs
    };
  });
  const requiredServices = ["state", "memory", "audit", "handoff"].concat(
    lifecycleControls.scheduling.enabled ? ["schedule"] : []
  );
  const unavailableRequiredServices = providers
    .filter((provider) => requiredServices.includes(provider.service) && !provider.available)
    .map((provider) => provider.service);
  const providerActionSummary = buildProviderActionSummary({
    providers,
    requiredServices,
    command,
    lifecycleControls,
    workflowHandoff,
    acceptToken
  });

  return {
    schemaVersion: 1,
    negotiation: unavailableRequiredServices.length === 0 ? "ready" : "blocked",
    acceptanceReady: unavailableRequiredServices.length === 0,
    requiredServices,
    unavailableRequiredServices,
    providers,
    serviceIntents: providers.map((provider) => provider.serviceIntent),
    providerActionSummary,
    negotiationMatrix: Object.fromEntries(
      providers.map((provider) => [
        provider.service,
        {
          providerId: provider.providerId,
          status: provider.serviceIntent.capabilityNegotiation.status,
          requiredForCommand: provider.serviceIntent.requiredForCommand,
          capabilityMode: provider.capabilityMode,
          missingCapabilities: provider.missingCapabilities,
          externalHandoffState: provider.serviceIntent.externalHandoffState.state
        }
      ])
    ),
    syncMetadata: Object.fromEntries(
      providers.map((provider) => [
        provider.service,
        {
          providerId: provider.providerId,
          cursor: provider.serviceIntent.syncCheckpoint.cursor,
          revision: provider.serviceIntent.syncCheckpoint.revision,
          expectedRevision: provider.serviceIntent.syncCheckpoint.expectedRevision,
          watermark: provider.serviceIntent.syncCheckpoint.watermark,
          lastSyncedAt: provider.serviceIntent.syncCheckpoint.lastSyncedAt,
          checkpointKey: provider.serviceIntent.syncCheckpoint.checkpointKey,
          conflictPolicy: provider.serviceIntent.syncCheckpoint.conflictPolicy
        }
      ])
    )
  };
}

function buildMailchimpSupersessionRuntime({
  input,
  now,
  current,
  candidate,
  command,
  acceptToken,
  boundary,
  scopeContract,
  lifecycleControls,
  providerServiceContracts,
  workflowHandoff,
  persistedStateShape
}) {
  const context = normalizeMailchimpSupersessionContext(input, current, candidate, now);
  const auditProvider = providerServiceContracts.providers.find((provider) => provider.service === "audit");
  const handoffProvider = providerServiceContracts.providers.find((provider) => provider.service === "handoff");
  const stateProvider = providerServiceContracts.providers.find((provider) => provider.service === "state");
  const requiresExternalSync = context.ready || context.recordSignals.currentTagged || context.recordSignals.candidateTagged;
  const providerReady = providerServiceContracts.acceptanceReady;
  const continuity = buildMailchimpSupersessionContinuity({
    now,
    context,
    command,
    acceptToken,
    boundary,
    scopeContract,
    persistedStateShape
  });
  const blockers = [
    ...context.identifiers.missingRequiredIdentifiers.map((identifier) => `missing-${identifier}`),
    context.sync.eventKinds.length === 0 && requiresExternalSync ? "mailchimp-event-kind-missing" : null,
    !providerReady ? "provider-services-not-ready" : null,
    !boundary.decision.allowed ? "actor-permission-denied" : null,
    !scopeContract.writePolicy.allowStateWrite ? "scope-write-blocked" : null,
    !lifecycleControls.settings.enabled ? "lifecycle-disabled" : null,
    command.action === "accept" && !lifecycleControls.commandAvailability.accept.enabled ? "accept-command-disabled" : null,
    persistedStateShape.status === "recovery_conflict" ? "supersession-recovery-conflict" : null,
    ...continuity.blockers
  ].filter(Boolean);
  const ready = requiresExternalSync && blockers.length === 0;
  const route = auditProvider?.endpoint || auditProvider?.externalHandoff.route || workflowHandoff.route;
  const payload = {
    provider: "mailchimp",
    subjectKey: context.subjectKey,
    acceptToken,
    commandId: command.id,
    idempotencyKey: `${command.idempotencyKey}:mailchimp`,
    currentMemoryId: current.id,
    candidateMemoryId: candidate.id,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    isolationKey: scopeContract.isolationKey,
    audienceId: context.identifiers.audienceId,
    campaignId: context.identifiers.campaignId,
    segmentId: context.identifiers.segmentId,
    automationId: context.identifiers.automationId,
    eventKinds: context.sync.eventKinds,
    syncMode: context.sync.mode,
    externalRevision: context.sync.externalRevision,
    stateCheckpointKey: stateProvider?.sync.checkpointKey || null,
    auditCheckpointKey: auditProvider?.sync.checkpointKey || null,
    handoffProviderId: handoffProvider?.providerId || null
  };

  return {
    schemaVersion: 1,
    generatedAt: now,
    state: !requiresExternalSync ? "not_applicable" : ready ? "ready" : "blocked",
    ready,
    required: requiresExternalSync,
    context,
    providerBinding: {
      providerReady,
      auditProviderId: auditProvider?.providerId || null,
      handoffProviderId: handoffProvider?.providerId || null,
      route,
      unavailableRequiredServices: providerServiceContracts.unavailableRequiredServices,
      negotiation: providerServiceContracts.negotiation
    },
    runtimeStatePatch: {
      namespace: "memory.supersession.mailchimp",
      key: `${surfaceId}:${acceptToken}:mailchimp`,
      status: ready ? "ready" : requiresExternalSync ? "blocked" : "not_applicable",
      subjectKey: context.subjectKey,
      acceptToken: ready ? acceptToken : null,
      checkpointKey: continuity.checkpointKey,
      continuityStatus: continuity.status,
      externalRevision: context.sync.externalRevision,
      blockerCount: blockers.length
    },
    continuity,
    externalHandoff: {
      required: requiresExternalSync,
      state: ready ? "ready" : requiresExternalSync ? "blocked" : "not_required",
      route,
      payloadRef: continuity.payloadRef,
      payload: ready ? payload : null
    },
    validationSummary: {
      ok: blockers.length === 0,
      blockers,
      issues: context.validationIssues
    },
    nextAction: ready
      ? {
          action: "publish_mailchimp_supersession_sync",
          route,
          payload
        }
      : {
          action: requiresExternalSync ? "repair_mailchimp_supersession_sync" : "continue_without_mailchimp_sync",
          route: requiresExternalSync ? "memory-manager/supersession/provider/mailchimp" : workflowHandoff.route,
          blockers
        },
    proofKey: hashStablePayload({
      surfaceId,
      acceptToken,
      contextProof: context.proofKey,
      state: requiresExternalSync ? (ready ? "ready" : "blocked") : "not_applicable",
      providerReady,
      blockers,
      isolationKey: scopeContract.isolationKey,
      continuityProof: continuity.proofKey
    })
  };
}

function buildMailchimpSupersessionContinuity({
  now,
  context,
  command,
  acceptToken,
  boundary,
  scopeContract,
  persistedStateShape
}) {
  const previous = persistedStateShape.previousMailchimpContinuity || {};
  const subjectMismatch = Boolean(previous.subjectKey && previous.subjectKey !== context.subjectKey);
  const externalRevisionMismatch = Boolean(
    previous.externalRevision &&
    context.sync.externalRevision &&
    previous.externalRevision !== context.sync.externalRevision
  );
  const unsafeReplay = previous.replaySafe === false && previous.status && previous.status !== "not_applicable";
  const staleCheckpoint = Boolean(
    previous.checkpointKey &&
    previous.status === "ready" &&
    (subjectMismatch || externalRevisionMismatch)
  );
  const blockers = [
    subjectMismatch ? "mailchimp-subject-changed-after-restart" : null,
    externalRevisionMismatch ? "mailchimp-external-revision-changed-after-restart" : null,
    unsafeReplay ? "mailchimp-previous-handoff-not-replay-safe" : null,
    staleCheckpoint ? "mailchimp-checkpoint-stale" : null
  ].filter(Boolean);
  const checkpointKey = hashStablePayload({
    surfaceId,
    provider: "mailchimp",
    acceptToken,
    commandId: command.id,
    idempotencyKey: command.idempotencyKey,
    subjectKey: context.subjectKey,
    previousCheckpointKey: subjectMismatch ? null : previous.checkpointKey || null,
    isolationKey: scopeContract.isolationKey,
    externalRevision: context.sync.externalRevision,
    eventKinds: context.sync.eventKinds
  });
  const payloadRef = hashStablePayload({
    checkpointKey,
    route: "memory-manager/supersession/provider/mailchimp",
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    commandId: command.id
  });
  const status = blockers.length > 0
    ? "recovery_required"
    : context.ready
      ? "ready"
      : "needs_input";

  return {
    schemaVersion: 1,
    provider: "mailchimp",
    status,
    checkpointKey,
    payloadRef,
    replaySafe: blockers.length === 0,
    subjectKey: context.subjectKey,
    previous: {
      status: previous.status || null,
      subjectKey: previous.subjectKey || null,
      checkpointKey: previous.checkpointKey || null,
      payloadRef: previous.payloadRef || null,
      externalRevision: previous.externalRevision || null,
      replaySafe: previous.replaySafe
    },
    restart: {
      subjectMismatch,
      externalRevisionMismatch,
      unsafeReplay,
      staleCheckpoint,
      blockers,
      resumeRoute: blockers.length > 0
        ? "memory-manager/supersession/provider/mailchimp/recover"
        : context.ready
          ? "memory-manager/supersession/provider/mailchimp/accept"
          : "memory-manager/supersession/provider/mailchimp/scope"
    },
    writePatch: {
      namespace: "memory.supersession.mailchimp",
      key: `${surfaceId}:${acceptToken}:mailchimp`,
      status,
      subjectKey: context.subjectKey,
      checkpointKey,
      payloadRef,
      externalRevision: context.sync.externalRevision,
      acceptedAt: status === "ready" ? now : null,
      replaySafe: blockers.length === 0,
      blockerCount: blockers.length,
      proofKey: hashStablePayload({
        checkpointKey,
        status,
        blockers,
        previousCheckpointKey: previous.checkpointKey || null
      })
    },
    blockers,
    proofKey: hashStablePayload({
      surfaceId,
      "mailchimp-continuity": checkpointKey,
      status,
      previousCheckpointKey: previous.checkpointKey || null,
      previousExternalRevision: previous.externalRevision || null,
      blockers,
      isolationKey: scopeContract.isolationKey
    })
  };
}

function buildMailchimpSupersessionWorkflowContract({
  requestContext,
  mailchimpSupersessionRuntime,
  persistedStateShape,
  readiness,
  validationSummary,
  acceptToken,
  command
}) {
  const routeBase = "memory-manager/supersession/provider/mailchimp";
  const runtime = mailchimpSupersessionRuntime || {};
  const blocked = runtime.required && !runtime.ready;
  const terminal = TERMINAL_PERSISTED_STATUSES.has(persistedStateShape.status);
  const canAcceptMailchimp = runtime.ready
    && validationSummary.ok
    && (readiness.status === "ready" || readiness.status === "ready_with_warnings")
    && !terminal;
  const acceptanceToken = stableProofId([
    surfaceId,
    "mailchimp-supersession-acceptance",
    requestContext.workflow.id,
    acceptToken,
    runtime.context?.subjectKey,
    runtime.externalHandoff?.payloadRef,
    persistedStateShape.status,
    command.idempotencyKey
  ]);
  const validationIssues = asArray(runtime.validationSummary?.issues);
  const blockers = asArray(runtime.validationSummary?.blockers);

  return {
    schemaVersion: 1,
    contract: "memory-supersession-mailchimp-workflow",
    routeBase,
    state: !runtime.required ? "not_applicable" : canAcceptMailchimp ? "ready_for_acceptance" : "needs_review",
    required: Boolean(runtime.required),
    ready: Boolean(runtime.ready),
    request: {
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      workflowId: requestContext.workflow.id,
      commandId: command.id,
      commandAction: command.action
    },
    persistence: {
      stateKey: persistedStateShape.stateKey,
      status: persistedStateShape.status,
      revision: persistedStateShape.revision,
      restartSafe: persistedStateShape.statusSemantics.restartSafe,
      terminal,
      mailchimpContinuity: {
        status: runtime.continuity?.status || null,
        checkpointKey: runtime.continuity?.checkpointKey || null,
        payloadRef: runtime.continuity?.payloadRef || null,
        externalRevision: runtime.continuity?.writePatch?.externalRevision || null,
        replaySafe: runtime.continuity?.replaySafe ?? null,
        resumeRoute: runtime.continuity?.restart?.resumeRoute || null,
        blockers: runtime.continuity?.blockers || []
      }
    },
    preview: {
      route: `${routeBase}/preview`,
      subjectKey: runtime.context?.subjectKey || null,
      currentTagged: Boolean(runtime.context?.recordSignals?.currentTagged),
      candidateTagged: Boolean(runtime.context?.recordSignals?.candidateTagged),
      eventKinds: runtime.context?.sync?.eventKinds || [],
      syncMode: runtime.context?.sync?.mode || null,
      externalRevision: runtime.context?.sync?.externalRevision || null,
      externalHandoffState: runtime.externalHandoff?.state || "not_required",
      payloadRef: runtime.externalHandoff?.payloadRef || null
    },
    acceptance: {
      route: `${routeBase}/accept`,
      method: "POST",
      required: Boolean(runtime.required),
      enabled: canAcceptMailchimp,
      token: canAcceptMailchimp ? acceptanceToken : null,
      blockedReason: canAcceptMailchimp
        ? null
        : terminal
          ? "supersession_already_terminal"
          : blockers[0] || (!validationSummary.ok ? "supersession_validation_blocked" : readiness.reason),
      body: canAcceptMailchimp
        ? {
            acceptToken,
            token: acceptanceToken,
            commandId: command.id,
            idempotencyKey: `${command.idempotencyKey}:mailchimp-workflow`,
            subjectKey: runtime.context?.subjectKey || null,
            payloadRef: runtime.externalHandoff?.payloadRef || null,
            expectedStateKey: persistedStateShape.stateKey,
            expectedRevision: persistedStateShape.revision
          }
        : null
    },
    validationSummary: {
      route: `${routeBase}/validation`,
      ok: !blocked,
      blockers,
      issueCount: validationIssues.length,
      issues: validationIssues.map((issue) => ({
        severity: issue.severity || "warning",
        field: issue.field || "mailchimp",
        message: issue.message || issue.code || "Mailchimp supersession sync requires review."
      }))
    },
    nextSteps: canAcceptMailchimp
      ? [{
          action: "publish_mailchimp_supersession_sync",
          route: `${routeBase}/accept`,
          token: acceptanceToken
        }]
      : blocked
        ? [{
            action: "repair_mailchimp_supersession_sync",
            route: `${routeBase}/validation`,
            blockers
          }]
        : [{
            action: "continue_without_mailchimp_sync",
            route: requestContext.route.current
          }],
    proofKey: stableProofId([
      surfaceId,
      "mailchimp-supersession-workflow",
      acceptToken,
      runtime.proofKey,
      persistedStateShape.status,
      readiness.status,
      validationSummary.ok ? "valid" : "blocked",
      acceptanceToken
    ])
  };
}

function buildProviderActionSummary({
  providers,
  requiredServices,
  command,
  lifecycleControls,
  workflowHandoff,
  acceptToken
}) {
  const serviceActions = providers.map((provider) => {
    const required = requiredServices.includes(provider.service);
    const intent = provider.serviceIntent;
    const missingCapabilities = provider.missingCapabilities;
    const handoffBlocked = provider.externalHandoff.required && provider.externalHandoff.state !== "ready";
    const statusBlocked =
      required &&
      !["ready", "optional"].includes(provider.status) &&
      !(provider.status === "degraded" && provider.service !== "memory");
    const blockers = [
      ...(missingCapabilities.length > 0 ? ["capability_missing"] : []),
      ...(handoffBlocked ? ["external_handoff_reference_missing"] : []),
      ...(statusBlocked ? ["provider_status_blocked"] : []),
      ...(!provider.available && required ? ["required_service_unavailable"] : [])
    ];
    const nextAction =
      missingCapabilities.length > 0
        ? "negotiate_provider_capabilities"
        : handoffBlocked
          ? "attach_external_handoff_reference"
          : statusBlocked
            ? "restore_provider_service"
            : intent.requiredForCommand
              ? "invoke_provider_operation"
              : "monitor_optional_provider";
    const route =
      nextAction === "attach_external_handoff_reference"
        ? provider.externalHandoff.route
        : provider.endpoint || provider.externalHandoff.route || workflowHandoff.route;

    return {
      service: provider.service,
      providerId: provider.providerId,
      required,
      requiredForCommand: intent.requiredForCommand,
      ready: blockers.length === 0,
      status: provider.status,
      nextAction,
      route,
      operation: intent.operation,
      method: intent.method,
      idempotencyKey: intent.commandEnvelope.idempotencyKey,
      blockers,
      capabilityNegotiation: {
        status: intent.capabilityNegotiation.status,
        mode: provider.capabilityMode,
        missing: missingCapabilities,
        required: provider.requiredCapabilities,
        advertised: provider.advertisedCapabilities
      },
      syncCheckpoint: intent.syncCheckpoint,
      externalHandoff: provider.externalHandoff,
      proofKey: stableProofId([
        surfaceId,
        "provider-action",
        provider.service,
        provider.providerId,
        nextAction,
        blockers.join(","),
        intent.syncCheckpoint.cursor,
        intent.syncCheckpoint.expectedRevision
      ])
    };
  });
  const requiredBlocked = serviceActions
    .filter((action) => action.required && !action.ready)
    .map((action) => action.service);
  const externalHandoffActions = serviceActions.filter((action) => action.externalHandoff.required);
  const syncWatermarks = Object.fromEntries(serviceActions.map((action) => [
    action.service,
    {
      providerId: action.providerId,
      cursor: action.syncCheckpoint.cursor,
      revision: action.syncCheckpoint.revision,
      expectedRevision: action.syncCheckpoint.expectedRevision,
      watermark: action.syncCheckpoint.watermark,
      checkpointKey: action.syncCheckpoint.checkpointKey
    }
  ]));
  const primaryAction = serviceActions.find((action) => action.required && !action.ready)
    || serviceActions.find((action) => action.requiredForCommand)
    || serviceActions[0]
    || null;
  const exportReady = requiredBlocked.length === 0
    && serviceActions.every((action) => action.capabilityNegotiation.status !== "capability_blocked");

  return {
    schemaVersion: 1,
    generatedForCommand: {
      commandId: command.id,
      action: command.action,
      idempotencyKey: command.idempotencyKey,
      acceptToken
    },
    lifecycle: {
      mode: lifecycleControls.settings.mode,
      schedulingEnabled: lifecycleControls.scheduling.enabled,
      nextAction: lifecycleControls.nextAction.action
    },
    status: requiredBlocked.length === 0 ? "ready" : "blocked",
    exportReady,
    requiredBlocked,
    primaryAction,
    serviceActions,
    externalHandoffQueue: externalHandoffActions.map((action) => ({
      service: action.service,
      providerId: action.providerId,
      route: action.externalHandoff.route,
      mode: action.externalHandoff.mode,
      state: action.externalHandoff.state,
      externalRef: action.externalHandoff.externalRef,
      required: action.externalHandoff.required,
      commandId: command.id,
      acceptToken,
      proofKey: action.proofKey
    })),
    syncWatermarks,
    providerExportSummary: {
      serviceCount: serviceActions.length,
      readyServices: serviceActions.filter((action) => action.ready).length,
      requiredServices: requiredServices.length,
      blockedServices: requiredBlocked.length,
      capabilityBlockedServices: serviceActions
        .filter((action) => action.capabilityNegotiation.status === "capability_blocked")
        .map((action) => action.service),
      handoffBlockedServices: serviceActions
        .filter((action) => action.externalHandoff.required && action.externalHandoff.state !== "ready")
        .map((action) => action.service)
    },
    proofKey: stableProofId([
      surfaceId,
      "provider-action-summary",
      command.id,
      command.action,
      requiredBlocked.join(","),
      serviceActions.map((action) => `${action.service}:${action.nextAction}:${action.proofKey}`).join("|")
    ])
  };
}

function buildProviderOperationalFindings(providerServiceContracts) {
  return providerServiceContracts.providers
    .map((provider) => {
      const required = providerServiceContracts.requiredServices.includes(provider.service);
      const externalHandoffBlocked =
        provider.externalHandoff.required && provider.externalHandoff.state !== "ready";
      const latencyDegraded = provider.latencyMs !== null && provider.latencyMs > 5000;
      const capabilityBlocked = provider.missingCapabilities.length > 0;
      const unavailable = required && !provider.available;
      const severity =
        unavailable || externalHandoffBlocked || capabilityBlocked
          ? "error"
          : provider.status === "degraded" || latencyDegraded
            ? "degraded"
            : null;

      if (!severity) {
        return null;
      }

      const reason = unavailable
        ? `Required ${provider.service} provider ${provider.providerId} is not available for supersession commit.`
        : externalHandoffBlocked
          ? `Provider ${provider.providerId} requires an external handoff reference before workflow resume.`
          : capabilityBlocked
            ? `Provider ${provider.providerId} is missing required capability ${provider.missingCapabilities[0]}.`
            : latencyDegraded
              ? `Provider ${provider.providerId} latency ${provider.latencyMs}ms exceeds the hosted-kernel health budget.`
              : `Provider ${provider.providerId} reports degraded status.`;

      return {
        service: provider.service,
        providerId: provider.providerId,
        severity,
        required,
        route: provider.endpoint || provider.externalHandoff.route || "memory-manager/supersession/integrations",
        recoveryAction:
          unavailable || capabilityBlocked
            ? "restore_provider_capabilities"
            : externalHandoffBlocked
              ? "attach_external_handoff_reference"
              : "monitor_or_route_around_degraded_provider",
        reason,
        status: provider.status,
        latencyMs: provider.latencyMs,
        missingCapabilities: provider.missingCapabilities,
        externalHandoff: provider.externalHandoff
      };
    })
    .filter(Boolean);
}

function mergeOperationalHealthWithProviderContracts({
  now,
  operationalHealth,
  providerServiceContracts,
  commandResult
}) {
  const providerFindings = buildProviderOperationalFindings(providerServiceContracts);
  const providerErrors = providerFindings.map((finding) =>
    buildActionableError(
      `SUPERCESSION_PROVIDER_${finding.service.toUpperCase()}_${finding.severity === "error" ? "UNAVAILABLE" : "DEGRADED"}`,
      finding.severity,
      "memory-manager/supersession/integrations",
      finding.reason,
      finding.recoveryAction,
      {
        service: finding.service,
        providerId: finding.providerId,
        required: finding.required,
        endpoint: finding.route,
        status: finding.status,
        latencyMs: finding.latencyMs,
        missingCapabilities: finding.missingCapabilities,
        handoffRoute: finding.externalHandoff.route,
        handoffState: finding.externalHandoff.state
      }
    )
  );
  const actionableErrors = [...operationalHealth.actionableErrors, ...providerErrors];
  const topSeverity = actionableErrors.reduce(
    (severity, error) =>
      OPERATIONAL_SEVERITY_RANK[error.severity] > OPERATIONAL_SEVERITY_RANK[severity] ? error.severity : severity,
    "info"
  );
  const status = topSeverity === "error" ? "failed" : topSeverity === "degraded" ? "degraded" : "healthy";
  const requiredProviderBlocked = providerFindings.some((finding) => finding.required && finding.severity === "error");
  const degradedEnabled = status !== "healthy" || commandResult.effect === "blocked";
  const allowedCapabilities = requiredProviderBlocked
    ? ["preview_memory_delta", "publish_hold_audit", "resume_workflow"]
    : degradedEnabled
      ? operationalHealth.degradedMode.allowedCapabilities.filter((capability) => capability !== "activate_candidate_memory")
      : operationalHealth.degradedMode.allowedCapabilities;

  return {
    ...operationalHealth,
    generatedAt: now,
    status,
    healthScore: Math.max(
      0,
      100 - actionableErrors.reduce((score, error) => score + (error.severity === "error" ? 35 : 15), 0)
    ),
    degradedMode: {
      ...operationalHealth.degradedMode,
      enabled: degradedEnabled,
      mode: degradedEnabled ? (requiredProviderBlocked ? "provider_recovery_preview_only" : "degraded_decision_guard") : "full_decision",
      writable:
        operationalHealth.degradedMode.writable &&
        !requiredProviderBlocked &&
        providerServiceContracts.acceptanceReady,
      allowedCapabilities
    },
    retry: {
      ...operationalHealth.retry,
      retryable:
        operationalHealth.retry.retryable &&
        !providerFindings.some((finding) => finding.recoveryAction === "restore_provider_capabilities"),
      blockedByProviderServices: providerFindings
        .filter((finding) => finding.severity === "error")
        .map((finding) => finding.service)
    },
    actionableErrors,
    providerHealth: {
      negotiation: providerServiceContracts.negotiation,
      acceptanceReady: providerServiceContracts.acceptanceReady,
      requiredServices: providerServiceContracts.requiredServices,
      unavailableRequiredServices: providerServiceContracts.unavailableRequiredServices,
      findings: providerFindings
    }
  };
}

function buildHostedKernelIntegration({
  now,
  requestContext,
  current,
  candidate,
  validation,
  validationSummary,
  readiness,
  evidence,
  command,
  commandResult,
  boundary,
  scopeContract,
  persistedStateShape,
  restartStateContract,
  operationalHealth,
  lifecycleControls,
  workflowHandoff,
  analytics,
  providerServiceContracts,
  acceptToken
}) {
  const terminalDecision = TERMINAL_PERSISTED_STATUSES.has(persistedStateShape.status);
  const accepted = persistedStateShape.status === "accepted";
  const rejected = persistedStateShape.status === "rejected";
  const proofRequired = lifecycleControls.settings.audit.requireProof;
  const factDeltaIncluded = lifecycleControls.settings.audit.includeFactDeltas;
  const writeDisposition =
    commandResult.effect === "noop"
      ? "dedupe"
      : commandResult.effect === "blocked"
        ? "blocked"
        : terminalDecision
          ? "commit"
          : "preview";
  const providerIntentByService = Object.fromEntries(
    providerServiceContracts.serviceIntents.map((intent) => [intent.service, intent])
  );
  const providerCallFor = (service) => {
    const intent = providerIntentByService[service];

    return intent
      ? {
          service,
          providerId:
            providerServiceContracts.providers.find((provider) => provider.service === service)?.providerId || null,
          operation: intent.operation,
          method: intent.method,
          route: intent.route,
          requiredForCommand: intent.requiredForCommand,
          idempotencyKey: intent.commandEnvelope.idempotencyKey,
          negotiationStatus: intent.capabilityNegotiation.status,
          syncCheckpoint: intent.syncCheckpoint,
          externalHandoffState: intent.externalHandoffState
        }
      : null;
  };
  const baseOperation = {
    workflowId: requestContext.workflow.id,
    acceptToken,
    idempotencyKey: command.idempotencyKey,
    currentMemoryId: current.id,
    candidateMemoryId: candidate.id,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    tenantSource: scopeContract.effectiveScope.tenantSource,
    workspaceSource: scopeContract.effectiveScope.workspaceSource,
    isolationKey: scopeContract.isolationKey,
    scopeLevel: scopeContract.scopeLevel,
    scopeResolution: {
      ok: boundary.scopeResolution.ok,
      issueCodes: boundary.scopeResolution.issues.map((issue) => issue.code)
    },
    workspaceAuthorization: scopeContract.workspaceAuthorization
  };
  const operations = [
    {
      id: `${command.id}:state`,
      kind: "persist_supersession_state",
      route: providerIntentByService.state?.route || "memory-manager/supersession/state",
      required: commandResult.effect !== "noop",
      disposition: writeDisposition,
      providerCall: providerCallFor("state"),
      payload: {
        ...baseOperation,
        status: persistedStateShape.status,
        revision: persistedStateShape.revision,
        restartSafe: persistedStateShape.recovery.restartSafe,
        stateKey: persistedStateShape.stateKey,
        writePrecondition: persistedStateShape.writeCheckpoint.precondition,
        replayDisposition: persistedStateShape.writeCheckpoint.replayDisposition,
        checkpointHash: persistedStateShape.writeCheckpoint.hash,
        checkpointHashAlgorithm: persistedStateShape.writeCheckpoint.hashAlgorithm,
        commandJournal: persistedStateShape.commandJournal,
        statusSemantics: persistedStateShape.statusSemantics
      }
    },
    {
      id: `${command.id}:memory`,
      kind: accepted ? "activate_candidate_memory" : rejected ? "record_rejected_candidate" : "preview_memory_delta",
      route:
        providerIntentByService.memory?.route ||
        (accepted ? "memory-manager/memories/activate" : "memory-manager/memories/supersession-preview"),
      required: accepted,
      disposition: accepted ? "commit" : terminalDecision ? "decision_record" : "preview",
      providerCall: providerCallFor("memory"),
      payload: {
        ...baseOperation,
        candidateSourceUri: candidate.sourceUri,
        currentSupersededBy: accepted ? candidate.id : null,
        factDeltaCounts: {
          retained: validation.retainedFacts.length,
          introduced: validation.introducedFacts.length,
          removed: validation.removedFacts.length
        }
      }
    },
    {
      id: `${command.id}:audit`,
      kind: "publish_supersession_audit",
      route: providerIntentByService.audit?.route || lifecycleControls.settings.audit.proofRoute,
      required: proofRequired,
      disposition: proofRequired && validationSummary.ok ? "publish" : "hold",
      providerCall: providerCallFor("audit"),
      payload: {
        ...baseOperation,
        proofKey: `${surfaceId}:${requestContext.workflow.id}:${acceptToken}:audit`,
        proofType: terminalDecision ? "memory-supersession-decision" : "memory-supersession-preview",
        actorId: boundary.actor.id,
        actorRole: boundary.actor.role,
        permission: boundary.requiredPermission,
        permissionAllowed: boundary.decision.allowed,
        workspaceAuthorization: scopeContract.workspaceAuthorization,
        boundaryProof: scopeContract.auditHandoff.boundaryProof,
        scopeWriteAllowed: scopeContract.writePolicy.allowStateWrite,
        scopeViolations: scopeContract.violations.map((violation) => violation.code),
        proofPartition: scopeContract.auditHandoff.proofPartition,
        readinessStatus: readiness.status,
        validationPassed: validationSummary.passed,
        validationFailed: validationSummary.failed,
        lifecycleSettingsStatus: lifecycleControls.settingsControlPlane.status,
        lifecycleSettingIssues: lifecycleControls.settingsControlPlane.issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          route: issue.route,
          affectedCommands: issue.affectedCommands
        })),
        lifecycleRecommendedPatches: lifecycleControls.settingsControlPlane.recommendedPatches,
        analyticsProofKey: analytics.exportSummary.proofKey,
        factDeltas: factDeltaIncluded
          ? {
              retained: validation.retainedFacts,
              introduced: validation.introducedFacts,
              removed: validation.removedFacts
            }
          : null,
        evidenceRefs: evidence.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          sourceUri: entry.sourceUri
        })),
        providerId: providerServiceContracts.providers.find((provider) => provider.service === "audit")?.providerId || null
      }
    },
    {
      id: `${command.id}:analytics-export`,
      kind: "publish_supersession_analytics_export",
      route: analytics.exportSummary.destination,
      required: false,
      disposition: analytics.exportSummary.rows.length > 0 ? "publish" : "manifest_only",
      payload: {
        ...baseOperation,
        exportKind: analytics.exportSummary.exportKind,
        proofKey: analytics.exportSummary.proofKey,
        manifestId: analytics.exportSummary.manifest.manifestId,
        manifestProofKey: analytics.exportSummary.manifest.proof.proofKey,
        manifestHash: analytics.exportSummary.manifest.proof.hash,
        formats: analytics.exportSummary.formats,
        rowCount: analytics.exportSummary.rowCount,
        partitions: analytics.exportSummary.manifest.partitions,
        history: {
          retainedSnapshots: analytics.historyRollup.retention.retained,
          retentionLimit: analytics.historyRollup.retention.limit,
          current: analytics.historyRollup.current,
          deltasFromPrevious: analytics.historyRollup.deltasFromPrevious
        },
        timelineEventCount: analytics.timeline.length,
        rowKinds: analytics.exportSummary.manifest.rowKinds
      }
    }
  ];

  if (lifecycleControls.scheduling.enabled) {
    operations.push({
      id: `${command.id}:schedule`,
      kind: "enqueue_supersession_decision",
      route: providerIntentByService.schedule?.route || "memory-manager/supersession/schedule",
      required: lifecycleControls.settings.mode === "scheduled",
      disposition: "enqueue",
      providerCall: providerCallFor("schedule"),
      payload: lifecycleControls.scheduling.payload
    });
  }

  if (operationalHealth.actionableErrors.length > 0) {
    operations.push({
      id: `${command.id}:health`,
      kind: "publish_supersession_operational_health",
      route: "memory-manager/supersession/health",
      required: operationalHealth.status === "failed",
      disposition: operationalHealth.status === "failed" ? "escalate" : "publish",
      payload: {
        ...baseOperation,
        status: operationalHealth.status,
        healthScore: operationalHealth.healthScore,
        degradedMode: operationalHealth.degradedMode,
        retry: operationalHealth.retry,
        actionableErrors: operationalHealth.actionableErrors
      }
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: now,
    contract: "hosted-kernel memory supersession integration outbox",
    status: persistedStateShape.status,
    writeDisposition,
    proofRequired,
    operations,
    providers: providerServiceContracts,
    providerExecutionPlan: {
      negotiation: providerServiceContracts.negotiation,
      serviceIntents: providerServiceContracts.serviceIntents,
      syncMetadata: providerServiceContracts.syncMetadata,
      actionSummary: providerServiceContracts.providerActionSummary,
      externalHandoffs: providerServiceContracts.serviceIntents
        .filter((intent) => intent.externalHandoffState.required)
        .map((intent) => ({
          service: intent.service,
          route: intent.externalHandoffState.route,
          mode: intent.externalHandoffState.mode,
          state: intent.externalHandoffState.state,
          externalRef: intent.externalHandoffState.externalRef,
          resumeRoute: intent.externalHandoffState.resumeRoute
        }))
    },
    invalidation: {
      channels: [
        `memory:${current.id}`,
        `memory:${candidate.id}`,
        `workflow:${requestContext.workflow.id}`,
        scopeContract.isolationKey,
        boundary.workspaceId ? `workspace:${boundary.workspaceId}:memory` : "workspace:global:memory"
      ],
      reason: terminalDecision ? "supersession_decision_projected" : "supersession_preview_projected"
    },
    handoff: {
      route: workflowHandoff.route,
      kind: workflowHandoff.handoffKind,
      payload: workflowHandoff.payload,
      auditScope: workflowHandoff.auditScope
    },
    restartRecovery: {
      stateKey: restartStateContract.stateKey,
      replayDisposition: restartStateContract.replayDisposition,
      restartSafe: restartStateContract.restartSafe,
      health: restartStateContract.health,
      commandJournal: {
        replayed: restartStateContract.commandJournal.replayed,
        replaySource: restartStateContract.commandJournal.replaySource,
        retention: restartStateContract.commandJournal.retention
      },
      recoveryCommand: restartStateContract.recoveryCommand,
      writePrecondition: restartStateContract.writePrecondition
    },
    operationalHealth: {
      status: operationalHealth.status,
      healthScore: operationalHealth.healthScore,
      degradedMode: operationalHealth.degradedMode,
      retry: operationalHealth.retry,
      actionableErrors: operationalHealth.actionableErrors
    },
    nextProviderAction: providerServiceContracts.providerActionSummary.primaryAction
  };
}

export function describeSupersessionSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const requestedState = ACCEPTABLE_STATES.has(input.state) ? input.state : "preview";
  const requestContext = normalizeRequestContext(input.requestContext);
  const current = normalizeMemoryRecord(input.currentMemory, "current-memory");
  const candidate = normalizeMemoryRecord(input.candidateMemory, "candidate-memory");
  const acceptToken = makeAcceptToken(current, candidate);
  const persistedState = normalizePersistedSupersessionState(input.persistedState);
  const command = normalizeSupersessionCommand(input.command, { requestContext, requestedState, acceptToken });
  const boundary = normalizeBoundaryContext(input, { requestContext, command, current, candidate });
  const scopeContract = buildScopeHandoffContract({ current, candidate, boundary, requestContext, command });
  const lifecycleSettings = normalizeLifecycleSettings(input.lifecycleSettings || input.settings, { requestContext });
  const lifecycleChecks = buildLifecycleValidationChecks(lifecycleSettings, command, now);
  const evidence = asArray(input.evidence).map((entry, index) => ({
    id: asObject(entry).id || `evidence-${index + 1}`,
    kind: asObject(entry).kind || "attachment",
    sourceUri: asObject(entry).sourceUri || null,
    summary: asObject(entry).summary || null
  }));
  const validation = buildValidationChecks(current, candidate, evidence, boundary, scopeContract, lifecycleChecks);
  const validationSummary = summarizeValidation(validation);
  const readiness = buildReadiness(validationSummary, requestedState);
  const recoveryStatus = buildRecoveryStatus({
    persistedState,
    requestContext,
    current,
    candidate,
    acceptToken,
    validationSummary
  });
  const restartStateContract = buildRestartStateContract({
    now,
    persistedState,
    recoveryStatus,
    command,
    current,
    candidate,
    acceptToken
  });
  const commandResult = buildCommandResult({
    command,
    persistedState,
    recoveryStatus,
    validationSummary,
    acceptToken,
    restartStateContract
  });
  const lifecycleControls = buildLifecycleControls({
    now,
    current,
    candidate,
    settings: lifecycleSettings,
    command,
    validationSummary,
    readiness,
    recoveryStatus,
    acceptToken
  });
  let operationalHealth = buildOperationalHealthContract({
    now,
    input,
    command,
    commandResult,
    recoveryStatus,
    restartStateContract,
    validationSummary,
    boundary,
    scopeContract,
    lifecycleControls,
    acceptToken
  });
  const persistedStateShape = buildPersistedStateShape({
    now,
    requestedState,
    requestContext,
    current,
    candidate,
    readiness,
    validationSummary,
    acceptToken,
    command,
    boundary,
    scopeContract,
    lifecycleSettings,
    persistedState,
    recoveryStatus,
    restartStateContract
  });
  const nextSteps = buildNextSteps({
    current,
    candidate,
    validationSummary,
    readiness,
    acceptToken,
    boundary,
    scopeContract,
    lifecycleControls
  });
  const workflowHandoff = buildWorkflowHandoff({
    requestContext,
    current,
    candidate,
    readiness,
    validationSummary,
    acceptToken,
    boundary,
    scopeContract,
    lifecycleControls
  });
  const providerServiceContracts = buildProviderServiceContracts({
    input,
    command,
    lifecycleControls,
    workflowHandoff,
    acceptToken
  });
  const mailchimpSupersessionRuntime = buildMailchimpSupersessionRuntime({
    input,
    now,
    current,
    candidate,
    command,
    acceptToken,
    boundary,
    scopeContract,
    lifecycleControls,
    providerServiceContracts,
    workflowHandoff,
    persistedStateShape
  });
  persistedStateShape.mailchimpContinuity = mailchimpSupersessionRuntime.continuity.writePatch;
  const mailchimpSupersessionWorkflow = buildMailchimpSupersessionWorkflowContract({
    requestContext,
    mailchimpSupersessionRuntime,
    persistedStateShape,
    readiness,
    validationSummary,
    acceptToken,
    command
  });
  operationalHealth = mergeOperationalHealthWithProviderContracts({
    now,
    operationalHealth,
    providerServiceContracts,
    commandResult
  });
  const routeDisabledControls = buildClientDisabledControls({
    validationSummary,
    readiness,
    boundary,
    scopeContract,
    lifecycleControls,
    providerServiceContracts,
    commandResult
  });
  const routePreviewAcceptance = buildRoutePreviewAcceptanceContract({
    now,
    requestContext,
    current,
    candidate,
    validation,
    validationSummary,
    readiness,
    acceptToken,
    boundary,
    scopeContract,
    lifecycleControls,
    providerServiceContracts,
    operationalHealth,
    command,
    commandResult,
    nextSteps,
    disabledControls: routeDisabledControls,
    persistedStateShape
  });
  const clientRuntimeState = buildClientRuntimeState({
    input,
    requestContext,
    current,
    candidate,
    validation,
    readiness,
    validationSummary,
    acceptToken,
    boundary,
    scopeContract,
    lifecycleControls,
    providerServiceContracts,
    commandResult,
    operationalHealth,
    nextSteps,
    persistedStateShape,
    mailchimpSupersessionRuntime
  });
  const analytics = buildSupersessionAnalytics({
    now,
    input,
    requestedState,
    requestContext,
    current,
    candidate,
    validation,
    validationSummary,
    readiness,
    boundary,
    scopeContract,
    evidence,
    command,
    commandResult,
    recoveryStatus,
    persistedStateShape,
    lifecycleControls,
    acceptToken,
    mailchimpSupersessionRuntime
  });
  const hostedKernelIntegration = buildHostedKernelIntegration({
    now,
    requestContext,
    current,
    candidate,
    validation,
    validationSummary,
    readiness,
    evidence,
    command,
    commandResult,
    boundary,
    scopeContract,
    persistedStateShape,
    restartStateContract,
    operationalHealth,
    lifecycleControls,
    workflowHandoff,
    analytics,
    providerServiceContracts,
    acceptToken
  });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel memory supersession preview and acceptance contract",
    state: requestedState,
    requestContext,
    clientRuntimeState,
    routePreviewAcceptance,
    preview: {
      headline: `Replace ${current.title} with ${candidate.title}`,
      currentMemory: current,
      candidateMemory: candidate,
      retainedFacts: validation.retainedFacts,
      introducedFacts: validation.introducedFacts,
      removedFacts: validation.removedFacts,
      userVisibleImpact:
        validation.removedFacts.length === 0
          ? "No current facts are removed by this candidate."
          : `${validation.removedFacts.length} current fact(s) are removed and should be reviewed.`
    },
    acceptance: {
      canAccept:
        validationSummary.ok &&
        boundary.decision.allowed &&
        scopeContract.writePolicy.allowStateWrite &&
        requestedState !== "rejected" &&
        recoveryStatus.status !== "recovery_conflict" &&
        recoveryStatus.status !== "already_accepted" &&
        persistedStateShape.status !== "rejected" &&
        lifecycleControls.commandAvailability.accept.enabled &&
        providerServiceContracts.acceptanceReady,
      canReject:
        validationSummary.ok &&
        boundary.decision.allowed &&
        scopeContract.writePolicy.allowStateWrite &&
        recoveryStatus.status !== "recovery_conflict" &&
        !TERMINAL_PERSISTED_STATUSES.has(persistedStateShape.status) &&
        lifecycleControls.commandAvailability.reject.enabled &&
        providerServiceContracts.acceptanceReady,
      acceptToken,
      requiredPayload: {
        acceptToken,
        currentMemoryId: current.id,
        candidateMemoryId: candidate.id,
        acceptedAt: now,
        commandId: command.id,
        idempotencyKey: command.idempotencyKey,
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        tenantSource: scopeContract.effectiveScope.tenantSource,
        workspaceSource: scopeContract.effectiveScope.workspaceSource,
        isolationKey: scopeContract.isolationKey,
        actorId: boundary.actor.id,
        scopeResolutionIssues: boundary.scopeResolution.issues.map((issue) => issue.code),
        workspaceAuthorization: scopeContract.workspaceAuthorization
      },
      rejectionPayload: {
        currentMemoryId: current.id,
        candidateMemoryId: candidate.id,
        rejectedAt: now,
        reasonRequired: true,
        commandId: command.id,
        idempotencyKey: command.idempotencyKey,
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        tenantSource: scopeContract.effectiveScope.tenantSource,
        workspaceSource: scopeContract.effectiveScope.workspaceSource,
        isolationKey: scopeContract.isolationKey,
        actorId: boundary.actor.id,
        scopeResolutionIssues: boundary.scopeResolution.issues.map((issue) => issue.code),
        workspaceAuthorization: scopeContract.workspaceAuthorization
      }
    },
    persistence: {
      status: persistedStateShape.status,
      restartSafe: persistedStateShape.statusSemantics.restartSafe,
      recovered: recoveryStatus.recovered,
      recoveryStatus,
      previousState: {
        found: persistedState.found,
        schemaVersion: persistedState.schemaVersion,
        stateKey: persistedState.stateKey,
        status: persistedState.status,
        revision: persistedState.revision,
        workflowId: persistedState.workflowId,
        acceptToken: persistedState.acceptToken,
        lastCommandId: persistedState.lastCommandId,
        lastIdempotencyKey: persistedState.lastIdempotencyKey,
        checkpointRevision: persistedState.checkpointRevision,
        checkpointHash: persistedState.checkpointHash,
        checkpointHashAlgorithm: persistedState.checkpointHashAlgorithm,
        commandJournalCount: persistedState.commandJournal.length
      },
      nextState: persistedStateShape,
      restartStateContract
    },
    command: {
      ...command,
      result: commandResult,
      retryContract: {
        key: command.idempotencyKey,
        safeToRetry: commandResult.idempotent,
        duplicateEffect: "noop",
        backoff: operationalHealth.retry
      }
    },
    readiness,
    lifecycleControls,
    providerServiceContracts,
    mailchimpSupersessionRuntime,
    mailchimpSupersessionWorkflow,
    operationalHealth,
    hostedKernelIntegration,
    validationSummary,
    validationChecks: validation.checks,
    nextSteps,
    boundary,
    scopeContract,
    workflowHandoff,
    analytics,
    auditProof: {
      proofType: "memory-supersession-preview",
      proofKey: `${surfaceId}:${requestContext.workflow.id}:${acceptToken}:${validationSummary.passed}/${validationSummary.failed}`,
      requestId: requestContext.requestId,
      sessionId: requestContext.sessionId,
      workflowId: requestContext.workflow.id,
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      tenantSource: scopeContract.effectiveScope.tenantSource,
      workspaceSource: scopeContract.effectiveScope.workspaceSource,
      isolationKey: scopeContract.isolationKey,
      scopeLevel: scopeContract.scopeLevel,
      scopeWriteAllowed: scopeContract.writePolicy.allowStateWrite,
      scopeResolutionOk: boundary.scopeResolution.ok,
      scopeResolutionIssues: boundary.scopeResolution.issues.map((issue) => ({
        code: issue.code,
        field: issue.field,
        candidates: issue.candidates
      })),
      actorId: boundary.actor.id,
      actorRole: boundary.actor.role,
      permission: boundary.requiredPermission,
      permissionAllowed: boundary.decision.allowed,
      workspaceAuthorization: scopeContract.workspaceAuthorization,
      boundaryProof: scopeContract.auditHandoff.boundaryProof,
      persistedRevision: persistedStateShape.revision,
      recoveryStatus: recoveryStatus.status,
      lifecycleMode: lifecycleControls.settings.mode,
      lifecycleEnabled: lifecycleControls.settings.enabled,
      lifecycleNextAction: lifecycleControls.nextAction.action,
      lifecycleSettingsStatus: lifecycleControls.settingsControlPlane.status,
      lifecycleSettingIssues: lifecycleControls.settingsControlPlane.issues.map((issue) => issue.code),
      lifecycleRecommendedPatches: lifecycleControls.settingsControlPlane.recommendedPatches,
      schedulingPolicy: lifecycleControls.settings.scheduling.policy,
      schedulingEnabled: lifecycleControls.scheduling.enabled,
      schedulingToken: lifecycleControls.scheduling.scheduleToken,
      analyticsProofKey: analytics.exportSummary.proofKey,
      analyticsExportManifestId: analytics.exportSummary.manifest.manifestId,
      analyticsExportManifestProofKey: analytics.exportSummary.manifest.proof.proofKey,
      analyticsExportFormats: analytics.exportSummary.formats,
      analyticsRows: analytics.exportSummary.rowCount,
      mailchimpSyncState: mailchimpSupersessionRuntime.state,
      mailchimpSyncReady: mailchimpSupersessionRuntime.ready,
      mailchimpSubjectKey: mailchimpSupersessionRuntime.context.subjectKey,
      mailchimpHandoffPayloadRef: mailchimpSupersessionRuntime.externalHandoff.payloadRef,
      mailchimpRuntimeProofKey: mailchimpSupersessionRuntime.proofKey,
      historySnapshotCount: analytics.historySnapshots.length,
      historyTrend: analytics.report.trend,
      evidenceCount: evidence.length,
      generatedAt: now
    },
    evidence
  };
}

export default describeSupersessionSurface;
