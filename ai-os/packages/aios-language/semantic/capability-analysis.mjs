import { inferAiosTypeHints } from "./type-hints.mjs";

const WRITE_ACTION_PATTERN = /create|update|schedule|send|delete|archive/i;

function compactString(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function freezeArray(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
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

function stableContractToken(prefix, parts) {
  const body = parts.map(compactString).filter(Boolean).join(":");
  return `${prefix}:${body || "anonymous"}`;
}

function normalizePermission(value) {
  return compactString(value).toLowerCase();
}

function inferMailchimpScopes(action) {
  if (action.startsWith("campaign.")) return action.includes("read")
    ? ["mailchimp:campaigns:read"]
    : action.includes("schedule")
      ? ["mailchimp:campaigns:schedule"]
      : ["mailchimp:campaigns:write"];
  if (action.startsWith("audience.segment.")) return ["mailchimp:segments:read"];
  if (action.startsWith("audience.")) return ["mailchimp:lists:read"];
  if (action.startsWith("template.")) return ["mailchimp:templates:read"];
  if (action.startsWith("report.")) return ["mailchimp:reports:read"];
  return [];
}

function requiredPermissionForAction(action) {
  if (action.startsWith("campaign.") && /schedule|send/.test(action)) return "mailchimp.campaigns.approve_send";
  if (action.startsWith("campaign.") && WRITE_ACTION_PATTERN.test(action)) return "mailchimp.campaigns.write";
  if (action.startsWith("campaign.")) return "mailchimp.campaigns.read";
  if (action.startsWith("audience.segment.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.segments.write" : "mailchimp.segments.read";
  if (action.startsWith("audience.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.lists.write" : "mailchimp.lists.read";
  if (action.startsWith("template.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.templates.write" : "mailchimp.templates.read";
  if (action.startsWith("report.")) return "mailchimp.reports.read";
  return "";
}

function normalizeRuntimePrincipal(job = {}, typeJob = {}) {
  const persistedState = typeJob.persistedState || {};
  const tenantBoundary = typeJob.tenantBoundary || {};
  const boundaryHealth = typeJob.boundaryHealth || {};
  const runtimeReadiness = typeJob.runtimeReadiness || typeJob.contract?.runtimeReadiness || {};
  const clientWorkflow = typeJob.clientRuntimeAdoption?.workflow || {};
  const permissionBoundary = typeJob.scope?.permissionBoundary || {};
  const runtimeScope = typeJob.scope?.runtimeScope || {};
  const clientState = job.clientState || job.requestState || {};
  const roles = [
    ...toArray(job.roles),
    ...toArray(clientState.roles),
    ...toArray(job.actor?.roles),
    ...toArray(tenantBoundary.roles),
  ].map(normalizePermission).filter(Boolean).sort();
  const permissions = [
    ...toArray(job.permissions),
    ...toArray(clientState.permissions),
    ...toArray(job.actor?.permissions),
    ...toArray(tenantBoundary.permissions),
  ].map(normalizePermission).filter(Boolean).sort();

  return Object.freeze({
    tenantId: firstString(clientState.tenantId, job.tenantId, tenantBoundary.tenantId, persistedState.tenantId, runtimeScope.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, tenantBoundary.workspaceId, persistedState.workspaceId, runtimeScope.workspaceId),
    actorId: firstString(clientState.userId, clientState.actorId, job.actor?.id, job.userId, tenantBoundary.actorId),
    requestId: firstString(clientState.requestId, job.requestId, persistedState.requestId),
    roles: freezeArray([...new Set(roles)]),
    permissions: freezeArray([...new Set(permissions)]),
    acceptedActions: freezeArray(toArray(clientState.acceptedActions || job.acceptedActions).map(compactString).filter(Boolean).sort()),
    rejectedActions: freezeArray(toArray(clientState.rejectedActions || job.rejectedActions).map(compactString).filter(Boolean).sort()),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, tenantBoundary.statusChannel, persistedState.statusChannel),
    restartToken: compactString(persistedState.restartToken),
    statusSnapshotKey: compactString(persistedState.statusSnapshotKey),
    tenantBoundaryStatus: tenantBoundary.violations?.length > 0 ? "violated" : "ready",
    adapterStatusReadiness: typeJob.adapterStatusReadiness || typeJob.contract?.adapterStatusReadiness || {},
    clientWorkflow: Object.freeze({
      state: compactString(clientWorkflow.clientWorkflowState || "not-provided"),
      commands: freezeArray(toArray(clientWorkflow.clientWorkflowCommands)),
      blockedCommands: freezeArray(toArray(clientWorkflow.blockedWorkflowCommands)),
      readyCommands: freezeArray(toArray(clientWorkflow.readyWorkflowCommands)),
    }),
    permissionBoundary,
    boundaryHealth,
    runtimeReadiness,
  });
}

function workflowCommandsForAction(action, principal = {}, usageRecord = { steps: new Set() }) {
  const rawSteps = usageRecord.steps instanceof Set ? [...usageRecord.steps] : toArray(usageRecord.steps);
  const steps = new Set(rawSteps.map(compactString).filter(Boolean));
  return toArray(principal.clientWorkflow?.commands).filter((command) => {
    const capability = compactString(command.capability);
    const stepName = compactString(command.stepName);
    return capability === action || (stepName && steps.has(stepName));
  });
}

function createCapabilityWorkflowGate(action, principal = {}, usageRecord = { steps: new Set() }) {
  const commands = workflowCommandsForAction(action, principal, usageRecord);
  const globalBlocked = toArray(principal.clientWorkflow?.blockedCommands).filter((command) => {
    const capability = compactString(command.capability);
    const stepName = compactString(command.stepName);
    return !capability && !stepName;
  });
  const relevant = commands.length > 0 ? commands : globalBlocked;
  const blocked = relevant.filter((command) => command.state === "blocked" || command.state === "needs-input" || command.userVisible?.blocking === true);
  const ready = relevant.filter((command) => command.state === "ready" || command.state === "runnable");
  const state = blocked.length > 0
    ? "blocked"
    : ready.length > 0
      ? "ready"
      : principal.clientWorkflow?.state === "blocked"
        ? "blocked-global"
        : "not-required";

  return Object.freeze({
    protocol: "aios.capability.client-workflow-gate.v1",
    action,
    state,
    acceptedForAdapter: state === "ready" || state === "not-required",
    commands: freezeArray(relevant.map((command) => ({
      command: compactString(command.command),
      commandId: compactString(command.commandId),
      phase: compactString(command.phase),
      state: compactString(command.state),
      nextCommand: compactString(command.nextCommand || command.command),
      reason: compactString(command.reason),
      statusChannel: compactString(command.statusChannel),
      statusSnapshotKey: compactString(command.statusSnapshotKey),
      idempotencyKey: compactString(command.idempotencyKey),
    }))),
    blockedCommands: freezeArray(blocked.map((command) => ({
      command: compactString(command.command),
      nextCommand: compactString(command.nextCommand || command.command),
      reason: compactString(command.reason),
    }))),
    readyCommands: freezeArray(ready.map((command) => ({
      command: compactString(command.command),
      commandId: compactString(command.commandId),
      nextCommand: compactString(command.nextCommand || command.command),
    }))),
    nextCommand: blocked[0]?.nextCommand || ready[0]?.nextCommand || "observe",
  });
}

function findScopeBoundaryCapability(action, principal = {}) {
  return toArray(principal.permissionBoundary?.capabilities)
    .find((capability) => compactString(capability.action) === action) || null;
}

function findAdapterStatusForAction(action, principal = {}, usageRecord = { steps: new Set() }) {
  const latest = toArray(principal.adapterStatusReadiness?.latestByCapability);
  const steps = new Set([...usageRecord.steps].map(compactString).filter(Boolean));
  return latest.find((row) => compactString(row.capability) === action)
    || latest.find((row) => steps.has(compactString(row.stepName)))
    || null;
}

function createCapabilityStatusReconciliation(action, principal = {}, usageRecord = { steps: new Set() }) {
  const readiness = principal.adapterStatusReadiness || {};
  const row = findAdapterStatusForAction(action, principal, usageRecord);
  const failures = toArray(readiness.failures).filter((failure) => {
    return compactString(failure.capability) === action || usageRecord.steps?.has?.(compactString(failure.stepName));
  });
  const state = failures.length > 0
    ? compactString(failures[0].state || "failed")
    : row?.state === "succeeded"
      ? "succeeded"
      : row?.state === "pending"
        ? "pending"
        : readiness.state === "needs-status-snapshot"
          ? "missing-status"
          : readiness.state === "waiting-adapter"
            ? "pending"
            : readiness.state === "blocked"
              ? "failed"
              : row
                ? compactString(row.state || "unknown")
                : "unobserved";
  const terminal = ["succeeded", "failed", "timed-out", "cancelled"].includes(state);

  return Object.freeze({
    protocol: "aios.capability.status-reconciliation.v1",
    action,
    state,
    terminal,
    acceptedForRetry: ["failed", "timed-out", "missing-status", "unobserved"].includes(state),
    acceptedForAdapter: !["failed", "timed-out", "cancelled", "missing-status"].includes(state),
    statusChannel: compactString(readiness.statusChannel || principal.statusChannel),
    statusSnapshotKey: compactString(row?.statusSnapshotKey || readiness.statusSnapshotKey || principal.statusSnapshotKey),
    providerRequestId: compactString(row?.providerRequestId),
    idempotencyKey: compactString(row?.idempotencyKey),
    retryAfterMs: Number.isFinite(Number(row?.retryAfterMs)) ? Number(row.retryAfterMs) : 0,
    message: compactString(failures[0]?.message || row?.message),
    nextCommand: failures[0]?.nextCommand
      || (state === "missing-status" ? "load_adapter_status_snapshot" : "")
      || (state === "pending" ? "poll_adapter_status_channel" : "")
      || (state === "failed" ? "inspect_adapter_failure" : "")
      || (state === "unobserved" && readiness.counters?.expected > 0 ? "load_adapter_status_snapshot" : "observe"),
  });
}

function createBoundaryDecision(action, provider, principal, capability = {}) {
  const scopedBoundary = findScopeBoundaryCapability(action, principal);
  if (scopedBoundary) {
    return Object.freeze({
      requiredPermission: compactString(scopedBoundary.requiredPermission),
      permissionKnown: Boolean(scopedBoundary.requiredPermission),
      permissionGranted: !toArray(scopedBoundary.reasons).some((reason) => compactString(reason).startsWith("missing-permission:")),
      tenantIsolated: !toArray(scopedBoundary.reasons).some((reason) => [
        "missing-tenant",
        "missing-workspace",
        "tenant-mismatch",
        "workspace-mismatch",
      ].includes(compactString(reason))),
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      actorId: principal.actorId,
      decision: scopedBoundary.decision === "allow" ? "allow" : "hold",
      reasons: freezeArray(toArray(scopedBoundary.reasons).map(compactString).filter(Boolean)),
      source: "scope-permission-boundary",
    });
  }

  const requiredPermission = compactString(capability.permission || capability.requiredPermission || requiredPermissionForAction(action));
  const explicitGrant = toArray(capability.grants || capability.permissions).map(normalizePermission).filter(Boolean);
  const available = new Set([
    ...principal.permissions,
    ...explicitGrant,
    ...principal.roles.map((role) => `role:${role}`),
  ]);
  const sameTenant = firstString(capability.tenantId, principal.tenantId) === principal.tenantId;
  const sameWorkspace = firstString(capability.workspaceId, principal.workspaceId) === principal.workspaceId;
  const permissionKnown = Boolean(requiredPermission) && (principal.permissions.length > 0 || explicitGrant.length > 0 || principal.roles.length > 0);
  const permissionGranted = !permissionKnown || available.has(normalizePermission(requiredPermission)) || available.has("mailchimp.*") || available.has("admin");
  const tenantIsolated = provider !== "mailchimp" || (Boolean(principal.tenantId) && Boolean(principal.workspaceId) && sameTenant && sameWorkspace);

  return Object.freeze({
    requiredPermission,
    permissionKnown,
    permissionGranted,
    tenantIsolated,
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    actorId: principal.actorId,
    decision: tenantIsolated && permissionGranted ? "allow" : "hold",
    reasons: freezeArray([
      !tenantIsolated && "tenant-workspace-boundary-missing",
      permissionKnown && !permissionGranted && requiredPermission && `missing-permission:${requiredPermission}`,
    ].filter(Boolean)),
    source: "capability-analysis",
  });
}

function collectStepUsage(job = {}) {
  const usage = new Map();
  for (const step of toArray(job.steps)) {
    const stepName = compactString(step.name || step.id || "step");
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString).filter(Boolean);
    for (const capabilityName of capabilityRefs) {
      const current = usage.get(capabilityName) || { reads: new Set(), writes: new Set(), steps: new Set() };
      for (const memoryName of toArray(step.memoryReads || step.reads)) current.reads.add(compactString(memoryName));
      for (const memoryName of toArray(step.memoryWrites || step.writes || step.output)) current.writes.add(compactString(memoryName));
      current.steps.add(stepName);
      usage.set(capabilityName, current);
    }
  }
  return usage;
}

function createCapabilityAcceptanceState(capability = {}, action, principal = {}, requiresApproval = false) {
  const acceptance = capability.acceptance || capability.approval || capability.operatorApproval || {};
  const acceptedActions = new Set(toArray(principal.acceptedActions).map(compactString).filter(Boolean));
  const rejectedActions = new Set(toArray(principal.rejectedActions).map(compactString).filter(Boolean));
  const evidenceRefs = toArray(
    acceptance.evidence
      || acceptance.evidenceRefs
      || capability.evidence
      || capability.verifierEvidence
  ).map(compactString).filter(Boolean).sort();
  const acceptedBy = firstString(acceptance.acceptedBy, acceptance.approvedBy, capability.acceptedBy, capability.approvedBy);
  const acceptedAt = firstString(acceptance.acceptedAt, acceptance.approvedAt, capability.acceptedAt, capability.approvedAt);
  const rejectedBy = firstString(acceptance.rejectedBy, capability.rejectedBy);
  const rejectedAt = firstString(acceptance.rejectedAt, capability.rejectedAt);
  const expiresAt = firstString(acceptance.expiresAt, capability.acceptanceExpiresAt);
  const explicitState = compactString(acceptance.state || capability.acceptanceState).toLowerCase();
  const token = firstString(
    acceptance.token,
    acceptance.acceptanceToken,
    capability.acceptanceToken,
    requiresApproval ? stableContractToken("accept", [principal.tenantId, principal.workspaceId, principal.requestId, action]) : ""
  );
  const rejected = explicitState === "rejected" || acceptance.rejected === true || rejectedActions.has(action);
  const accepted = !rejected && (
    explicitState === "accepted"
      || acceptance.accepted === true
      || acceptance.approved === true
      || acceptedActions.has(action)
      || (Boolean(acceptedBy) && Boolean(acceptedAt))
  );
  const missing = [
    requiresApproval && !accepted && !rejected && !acceptedBy && "acceptedBy",
    requiresApproval && !accepted && !rejected && !acceptedAt && "acceptedAt",
    requiresApproval && !accepted && !rejected && evidenceRefs.length === 0 && "evidence",
  ].filter(Boolean);
  const state = !requiresApproval
    ? "not-required"
    : rejected
      ? "rejected"
      : accepted
        ? "accepted"
        : "pending";

  return Object.freeze({
    protocol: "aios.capability.operator-acceptance.v1",
    required: requiresApproval,
    state,
    accepted: state === "accepted" || state === "not-required",
    token,
    acceptedBy,
    acceptedAt,
    rejectedBy,
    rejectedAt,
    expiresAt,
    evidenceRefs: freezeArray(evidenceRefs),
    missing: freezeArray(missing),
    nextCommand: state === "rejected"
      ? "revise_or_cancel_provider_action"
      : state === "pending"
        ? "collect_verifier_evidence"
        : "observe",
    userVisible: Object.freeze({
      label: state === "not-required"
        ? "No operator approval required"
        : state === "accepted"
          ? "Operator approval accepted"
          : state === "rejected"
            ? "Operator approval rejected"
            : "Operator approval required",
      blocking: state === "pending" || state === "rejected",
      evidenceRequired: requiresApproval && evidenceRefs.length === 0,
    }),
  });
}

function createCapabilityHealthProfile(action, provider, principal, boundaryDecision, effects, requiresApproval, acceptance = null, statusReconciliation = null, workflowGate = null) {
  const held = boundaryDecision.decision === "hold";
  const externalWrite = effects.externalWrite;
  const hasStatusSnapshot = Boolean(principal.statusSnapshotKey);
  const retryable = !held && externalWrite;
  const backoffSeed = action.includes("schedule") || action.includes("send") ? 5000 : 1000;
  const approvalPending = requiresApproval && acceptance?.state === "pending";
  const approvalRejected = requiresApproval && acceptance?.state === "rejected";
  const providerFailed = ["failed", "timed-out", "cancelled"].includes(statusReconciliation?.state);
  const providerMissing = statusReconciliation?.state === "missing-status";
  const workflowBlocked = workflowGate?.state === "blocked" || workflowGate?.state === "blocked-global";

  return Object.freeze({
    protocol: "aios.capability.health-profile.v1",
    state: held || approvalRejected || providerFailed || workflowBlocked
      ? "blocked"
      : providerMissing
        ? "degraded-status-missing"
      : approvalPending
        ? "waiting-for-approval"
        : externalWrite
          ? hasStatusSnapshot ? "adapter-ready" : "degraded-no-status-snapshot"
          : "healthy",
    degradedMode: held || approvalRejected || providerFailed || workflowBlocked
      ? "boundary-review"
      : providerMissing
        ? "adapter-status-reconciliation"
      : externalWrite && !hasStatusSnapshot
        ? "status-snapshot-required"
        : "none",
    statusSnapshotKey: principal.statusSnapshotKey,
    retry: Object.freeze({
      retryable,
      strategy: held ? "manual-resolution" : retryable ? "exponential-backoff" : "none",
      baseDelayMs: retryable ? backoffSeed : 0,
      maxDelayMs: retryable ? Math.max(backoffSeed * 6, 30000) : 0,
      retryableStatuses: freezeArray(retryable ? ["429", "500", "502", "503", "504", "adapter-timeout"] : []),
    }),
    actionableError: workflowBlocked
      ? Object.freeze({
        code: "aios.capability.workflow_handoff_blocked",
        message: `Capability "${action}" is waiting on client workflow handoff command "${workflowGate.nextCommand}".`,
        nextCommand: workflowGate.nextCommand || "resolve_runtime_readiness",
        reasons: freezeArray(workflowGate.blockedCommands?.map((command) => command.reason || command.command).filter(Boolean) || ["client-workflow-blocked"]),
      })
      : providerFailed
      ? Object.freeze({
        code: "aios.capability.adapter_status_failed",
        message: `Capability "${action}" has a terminal adapter status of "${statusReconciliation.state}".`,
        nextCommand: statusReconciliation.nextCommand || "inspect_adapter_failure",
        reasons: freezeArray([statusReconciliation.message || statusReconciliation.state].filter(Boolean)),
      })
      : held
      ? Object.freeze({
        code: "aios.capability.boundary_hold",
        message: `Capability "${action}" is held by tenant/workspace or permission boundary checks.`,
        nextCommand: "resolve_boundary_hold",
        reasons: boundaryDecision.reasons,
      })
      : approvalRejected
        ? Object.freeze({
          code: "aios.capability.operator_rejected",
          message: `Capability "${action}" was rejected by operator acceptance controls.`,
          nextCommand: "revise_or_cancel_provider_action",
          reasons: freezeArray(["operator-acceptance-rejected"]),
        })
      : externalWrite && !hasStatusSnapshot
        ? Object.freeze({
          code: "aios.capability.status_snapshot_missing",
          message: `Capability "${action}" needs a status snapshot key before adapter handoff can be restart-safe.`,
          nextCommand: "attach_status_snapshot_store",
          reasons: freezeArray(["missing-status-snapshot-key"]),
        })
        : null,
  });
}

function createCapabilityLifecycleControls(capability = {}, action, provider, principal, boundaryDecision, health, effects, acceptance = null, statusReconciliation = null, workflowGate = null) {
  const schedule = capability.schedule || capability.scheduling || {};
  const requestedMode = compactString(capability.mode || capability.lifecycleMode || "enabled");
  const externalWrite = effects.externalWrite === true;
  const hold = boundaryDecision.decision === "hold";
  const approvalBlocked = acceptance?.state === "pending" || acceptance?.state === "rejected";
  const scheduleRequested = action.includes("schedule") || Boolean(schedule.at || schedule.window || schedule.cron);
  const scheduleWindow = compactString(schedule.window || capability.scheduleWindow || "");
  const scheduleAt = compactString(schedule.at || capability.scheduleAt || "");
  const disableReasons = [
    requestedMode === "disabled" && "capability-disabled",
    hold && "boundary-hold",
    acceptance?.state === "rejected" && "operator-acceptance-rejected",
    ["failed", "timed-out", "cancelled"].includes(statusReconciliation?.state) && "adapter-status-terminal",
    statusReconciliation?.state === "missing-status" && "adapter-status-missing",
    workflowGate?.acceptedForAdapter === false && "client-workflow-blocked",
    externalWrite && !principal.statusChannel && "missing-status-channel",
    externalWrite && !principal.requestId && "missing-request-id",
    scheduleRequested && !scheduleAt && !scheduleWindow && "missing-schedule-window",
  ].filter(Boolean);
  const enableAdapter = provider === "mailchimp"
    && disableReasons.length === 0
    && approvalBlocked === false
    && health.degradedMode === "none"
    && (externalWrite ? Boolean(principal.statusSnapshotKey) : true);

  return Object.freeze({
    protocol: "aios.capability.lifecycle-controls.v1",
    mode: requestedMode === "disabled" ? "disabled" : disableReasons.length > 0 ? "disabled" : "enabled",
    controls: Object.freeze({
      enableRuntime: disableReasons.length === 0,
      enablePreview: true,
      enableAdapterHandoff: enableAdapter,
      enableRetry: health.retry?.retryable === true && !hold,
      enableScheduling: scheduleRequested && disableReasons.length === 0,
      requireOperatorApproval: effects.operatorApprovalRequired === true,
      operatorAcceptanceSatisfied: acceptance?.accepted === true,
      requireBoundaryResolution: hold,
    }),
    settingsValidation: freezeArray(disableReasons.map((reason) => ({
      setting: reason.startsWith("missing-schedule") ? "schedule" : reason.startsWith("missing-status") ? "statusChannel" : reason.startsWith("missing-request") ? "requestId" : reason.startsWith("operator") ? "operatorAcceptance" : "boundary",
      reason,
      severity: reason === "capability-disabled" ? "info" : "error",
    }))),
    scheduling: Object.freeze({
      requested: scheduleRequested,
      at: scheduleAt,
      window: scheduleWindow,
      timezone: compactString(schedule.timezone || capability.timezone || "UTC"),
      nextAction: !scheduleRequested
        ? "observe"
        : disableReasons.length > 0
        ? "repair_scheduling_settings"
          : effects.operatorApprovalRequired
            ? "collect_verifier_evidence"
            : "queue_provider_schedule",
    }),
    nextAction: hold
      ? "resolve_boundary_hold"
      : ["failed", "timed-out", "cancelled"].includes(statusReconciliation?.state)
        ? statusReconciliation.nextCommand || "inspect_adapter_failure"
      : statusReconciliation?.state === "missing-status"
          ? "load_adapter_status_snapshot"
          : workflowGate?.acceptedForAdapter === false
            ? workflowGate.nextCommand || "resolve_runtime_readiness"
          : disableReasons.length > 0
            ? "repair_capability_settings"
            : acceptance?.state === "rejected"
              ? "revise_or_cancel_provider_action"
              : effects.operatorApprovalRequired
                ? "hold_for_operator"
                : externalWrite
                  ? "queue_adapter_handoff"
                  : "observe",
  });
}

function normalizeProviderSyncResources(capability = {}, action) {
  const explicit = toArray(capability.syncResources || capability.providerResources || capability.resources)
    .map((resource) => {
      if (typeof resource === "string") {
        return Object.freeze({
          type: resource.includes(":") ? resource.split(":")[0] : "resource",
          id: resource.includes(":") ? resource.split(":").slice(1).join(":") : resource,
        });
      }
      return Object.freeze({
        type: compactString(resource.type || resource.kind || resource.name || "resource"),
        id: compactString(resource.id || resource.resourceId || resource.externalId || resource.name || ""),
      });
    })
    .filter((resource) => resource.type || resource.id);

  if (explicit.length > 0) return explicit;
  if (action.startsWith("campaign.")) return [Object.freeze({ type: "campaign", id: compactString(capability.campaignId || capability.externalId) })];
  if (action.startsWith("audience.segment.")) return [Object.freeze({ type: "segment", id: compactString(capability.segmentId || capability.externalId) })];
  if (action.startsWith("audience.")) return [Object.freeze({ type: "audience", id: compactString(capability.audienceId || capability.listId || capability.externalId) })];
  if (action.startsWith("template.")) return [Object.freeze({ type: "template", id: compactString(capability.templateId || capability.externalId) })];
  if (action.startsWith("report.")) return [Object.freeze({ type: "report", id: compactString(capability.reportId || capability.externalId) })];
  return [];
}

function createCapabilityProviderSyncContract(capability = {}, action, provider, principal, lifecycle, health, effects) {
  const sync = capability.sync || capability.providerSync || capability.syncMetadata || {};
  const providerManaged = provider === "mailchimp";
  const externalWrite = effects.externalWrite === true;
  const resources = normalizeProviderSyncResources(capability, action);
  const resourceFingerprint = resources
    .map((resource) => `${resource.type}:${resource.id || "pending"}`)
    .sort()
    .join("|");
  const baseToken = stableContractToken("sync", [
    provider,
    principal.tenantId,
    principal.workspaceId,
    principal.requestId,
    action,
    resourceFingerprint,
  ]);
  const watermarkKey = firstString(sync.watermarkKey, capability.watermarkKey, providerManaged ? `${baseToken}:watermark` : "");
  const checkpointKey = firstString(sync.checkpointKey, capability.checkpointKey, providerManaged ? `${baseToken}:checkpoint` : "");
  const cursor = firstString(sync.cursor, sync.nextCursor, capability.cursor);
  const objectRef = firstString(
    sync.objectRef,
    sync.externalObjectRef,
    capability.externalObjectRef,
    resources.length === 1 && resources[0].id ? `${resources[0].type}:${resources[0].id}` : ""
  );
  const direction = compactString(sync.direction || capability.syncDirection || (externalWrite ? "push-pull" : "pull"));
  const requestedMode = compactString(sync.mode || capability.syncMode || (providerManaged ? "watermarked" : "none"));
  const validation = [
    providerManaged && !principal.tenantId && "missing-tenant",
    providerManaged && !principal.workspaceId && "missing-workspace",
    providerManaged && externalWrite && !principal.requestId && "missing-request-id",
    providerManaged && externalWrite && !watermarkKey && "missing-watermark-key",
    providerManaged && externalWrite && !checkpointKey && "missing-checkpoint-key",
    providerManaged && resources.some((resource) => !resource.id) && "pending-provider-resource-id",
    providerManaged && lifecycle?.controls?.enableAdapterHandoff === false && "adapter-handoff-disabled",
  ].filter(Boolean);
  const state = !providerManaged
    ? "not-applicable"
    : validation.some((reason) => reason !== "pending-provider-resource-id")
      ? "blocked"
      : resources.some((resource) => !resource.id) || !cursor
        ? "needs-provider-confirmation"
        : externalWrite
          ? "checkpoint-ready"
          : "watermark-ready";

  return Object.freeze({
    protocol: "aios.capability.provider-sync.v1",
    provider,
    action,
    mode: providerManaged ? requestedMode : "none",
    direction,
    state,
    externalWrite,
    resources: freezeArray(resources.map((resource) => ({
      type: resource.type,
      id: resource.id,
      stableRef: `${resource.type}:${resource.id || "pending"}`,
    }))),
    metadata: Object.freeze({
      watermarkKey,
      checkpointKey,
      cursor,
      objectRef,
      statusSnapshotKey: principal.statusSnapshotKey,
      statusChannel: principal.statusChannel,
      requestId: principal.requestId,
      lastSyncedAt: firstString(sync.lastSyncedAt, capability.lastSyncedAt),
    }),
    validation: freezeArray(validation.map((reason) => ({
      reason,
      severity: reason === "pending-provider-resource-id" ? "warning" : "error",
    }))),
    nextCommand: state === "blocked"
      ? "repair_provider_sync_metadata"
      : state === "needs-provider-confirmation"
        ? "confirm_provider_resource_state"
        : externalWrite
          ? "persist_provider_checkpoint"
          : "observe",
    health: Object.freeze({
      restartSafe: !providerManaged || (!externalWrite || (Boolean(watermarkKey) && Boolean(checkpointKey))),
      adapterAccepted: lifecycle?.controls?.enableAdapterHandoff === true && health?.state !== "blocked",
      degradedMode: validation.length > 0 ? "provider-sync-validation" : "none",
    }),
  });
}

function createCapabilityContract(capability = {}, usage, principal) {
  const action = compactString(capability.name || capability.scope || "capability");
  const boundary = compactString(capability.boundary || "internal");
  const provider = action.startsWith("campaign.") || action.startsWith("audience.") || action.startsWith("template.") || action.startsWith("report.")
    ? "mailchimp"
    : compactString(capability.provider || "local");
  const scopes = toArray(capability.scopes || capability.serviceScopes || inferMailchimpScopes(action)).map(compactString).filter(Boolean).sort();
  const writesExternal = boundary === "external" || WRITE_ACTION_PATTERN.test(action);
  const requiresApproval = writesExternal && WRITE_ACTION_PATTERN.test(action);
  const acceptance = createCapabilityAcceptanceState(capability, action, principal, requiresApproval);
  const usageRecord = usage.get(action) || { reads: new Set(), writes: new Set(), steps: new Set() };
  const boundaryDecision = createBoundaryDecision(action, provider, principal, capability);
  const statusReconciliation = createCapabilityStatusReconciliation(action, principal, usageRecord);
  const workflowGate = createCapabilityWorkflowGate(action, principal, usageRecord);
  const effects = Object.freeze({
    externalWrite: writesExternal,
    requiredApproval: requiresApproval && acceptance.accepted !== true,
    operatorApprovalRequired: requiresApproval && acceptance.accepted !== true,
    operatorAcceptanceState: acceptance.state,
    operatorAcceptanceToken: acceptance.token,
    reads: freezeArray([...usageRecord.reads].filter(Boolean).sort()),
    writes: freezeArray([...usageRecord.writes].filter(Boolean).sort()),
    steps: freezeArray([...usageRecord.steps].sort()),
  });
  const health = createCapabilityHealthProfile(action, provider, principal, boundaryDecision, effects, requiresApproval, acceptance, statusReconciliation, workflowGate);
  const lifecycle = createCapabilityLifecycleControls(capability, action, provider, principal, boundaryDecision, health, effects, acceptance, statusReconciliation, workflowGate);
  const statusState = boundaryDecision.decision === "hold"
    ? "held-for-boundary-review"
    : acceptance.state === "rejected"
      ? "operator-rejected"
    : ["failed", "timed-out", "cancelled"].includes(statusReconciliation.state)
      ? "adapter-status-failed"
    : statusReconciliation.state === "missing-status"
      ? "adapter-status-missing"
    : effects.operatorApprovalRequired
      ? "awaiting-operator-approval"
      : writesExternal
        ? "ready-for-provider-handoff"
        : "local-ready";
  const providerSync = createCapabilityProviderSyncContract(capability, action, provider, principal, lifecycle, health, effects);

  return Object.freeze({
    action,
    provider,
    boundary,
    serviceScopes: freezeArray(scopes),
    risk: requiresApproval ? action.includes("schedule") || action.includes("send") ? "high" : "medium" : "low",
    effects,
    boundaryDecision,
    statusReconciliation,
    acceptance,
    health,
    lifecycle,
    workflowGate,
    providerSync,
    audit: Object.freeze({
      event: provider === "mailchimp" ? "mailchimp.capability.boundary_decision" : "runtime.capability.boundary_decision",
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      actorId: principal.actorId,
      requestId: principal.requestId,
      statusChannel: principal.statusChannel,
      statusSnapshotKey: principal.statusSnapshotKey,
      adapterStatusState: statusReconciliation.state,
      adapterStatusNextCommand: statusReconciliation.nextCommand,
      requiredPermission: boundaryDecision.requiredPermission,
      decision: boundaryDecision.decision,
      reasons: boundaryDecision.reasons,
      decisionSource: boundaryDecision.source,
      lifecycleMode: lifecycle.mode,
      lifecycleNextAction: lifecycle.nextAction,
      operatorAcceptanceState: acceptance.state,
      operatorAcceptanceToken: acceptance.token,
      syncState: providerSync.state,
      syncWatermarkKey: providerSync.metadata.watermarkKey,
      syncCheckpointKey: providerSync.metadata.checkpointKey,
      workflowState: workflowGate.state,
      workflowNextCommand: workflowGate.nextCommand,
    }),
    handoff: Object.freeze({
      adapter: provider === "mailchimp" ? "mailchimp.campaignRuntimeAdapter" : "runtime",
      statusState,
      recoveryCommand: statusReconciliation.nextCommand && statusReconciliation.nextCommand !== "observe"
        ? statusReconciliation.nextCommand
        : lifecycle.nextAction === "queue_adapter_handoff" ? "retry_same_idempotency_key" : lifecycle.nextAction,
      retry: health.retry,
      statusReconciliation,
      operatorAcceptance: acceptance,
      workflowGate,
      providerSync,
    }),
  });
}

function createCapabilityOperationalReport(contracts = [], diagnostics = []) {
  const blocked = contracts.filter((contract) => contract.health.state === "blocked");
  const degraded = contracts.filter((contract) => contract.health.degradedMode !== "none" && contract.health.state !== "blocked");
  const retryable = contracts.filter((contract) => contract.health.retry.retryable);
  const disabled = contracts.filter((contract) => contract.lifecycle?.mode === "disabled");
  const pendingAcceptance = contracts.filter((contract) => contract.acceptance?.state === "pending");
  const rejectedAcceptance = contracts.filter((contract) => contract.acceptance?.state === "rejected");
  const syncBlocked = contracts.filter((contract) => contract.providerSync?.state === "blocked");
  const syncPending = contracts.filter((contract) => contract.providerSync?.state === "needs-provider-confirmation");
  const workflowBlocked = contracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false);
  const workflowReady = contracts.filter((contract) => contract.workflowGate?.state === "ready");
  const statusFailures = contracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state));
  const statusMissing = contracts.filter((contract) => contract.statusReconciliation?.state === "missing-status");

  return Object.freeze({
    protocol: "aios.capability.operational-report.v1",
    state: blocked.length > 0 ? "blocked" : degraded.length > 0 ? "degraded" : "healthy",
    acceptedForAdapter: blocked.length === 0
      && degraded.length === 0
      && pendingAcceptance.length === 0
      && rejectedAcceptance.length === 0
      && diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    acceptedForPreview: true,
    acceptance: Object.freeze({
      pending: freezeArray(pendingAcceptance.map((contract) => ({
        action: contract.action,
        token: contract.acceptance.token,
        missing: contract.acceptance.missing,
        nextCommand: contract.acceptance.nextCommand,
      }))),
      rejected: freezeArray(rejectedAcceptance.map((contract) => ({
        action: contract.action,
        token: contract.acceptance.token,
        rejectedBy: contract.acceptance.rejectedBy,
        rejectedAt: contract.acceptance.rejectedAt,
        nextCommand: contract.acceptance.nextCommand,
      }))),
    }),
    blockedCapabilities: freezeArray(blocked.map((contract) => ({
      action: contract.action,
      nextCommand: contract.health.actionableError?.nextCommand || "resolve_actionable_errors",
      reasons: contract.boundaryDecision.reasons,
    }))),
    degradedCapabilities: freezeArray(degraded.map((contract) => ({
      action: contract.action,
      mode: contract.health.degradedMode,
      nextCommand: contract.lifecycle?.nextAction || contract.health.actionableError?.nextCommand || "observe",
    }))),
    disabledCapabilities: freezeArray(disabled.map((contract) => ({
      action: contract.action,
      nextAction: contract.lifecycle?.nextAction || "repair_capability_settings",
      settingsValidation: contract.lifecycle?.settingsValidation || freezeArray([]),
      scheduling: contract.lifecycle?.scheduling || null,
    }))),
    retryBackoff: freezeArray(retryable.map((contract) => ({
      action: contract.action,
      strategy: contract.health.retry.strategy,
      baseDelayMs: contract.health.retry.baseDelayMs,
      maxDelayMs: contract.health.retry.maxDelayMs,
      statuses: contract.health.retry.retryableStatuses,
    }))),
    providerSync: Object.freeze({
      blocked: freezeArray(syncBlocked.map((contract) => ({
        action: contract.action,
        nextCommand: contract.providerSync.nextCommand,
        validation: contract.providerSync.validation,
      }))),
      needsConfirmation: freezeArray(syncPending.map((contract) => ({
        action: contract.action,
        resources: contract.providerSync.resources,
        nextCommand: contract.providerSync.nextCommand,
      }))),
      checkpointKeys: freezeArray([...new Set(contracts.map((contract) => contract.providerSync?.metadata?.checkpointKey).filter(Boolean))]),
      watermarkKeys: freezeArray([...new Set(contracts.map((contract) => contract.providerSync?.metadata?.watermarkKey).filter(Boolean))]),
    }),
    clientWorkflow: Object.freeze({
      blocked: freezeArray(workflowBlocked.map((contract) => ({
        action: contract.action,
        state: contract.workflowGate.state,
        nextCommand: contract.workflowGate.nextCommand,
        blockedCommands: contract.workflowGate.blockedCommands,
      }))),
      ready: freezeArray(workflowReady.map((contract) => ({
        action: contract.action,
        nextCommand: contract.workflowGate.nextCommand,
        readyCommands: contract.workflowGate.readyCommands,
      }))),
    }),
    adapterStatus: Object.freeze({
      failures: freezeArray(statusFailures.map((contract) => ({
        action: contract.action,
        state: contract.statusReconciliation.state,
        message: contract.statusReconciliation.message,
        nextCommand: contract.statusReconciliation.nextCommand,
      }))),
      missing: freezeArray(statusMissing.map((contract) => ({
        action: contract.action,
        statusSnapshotKey: contract.statusReconciliation.statusSnapshotKey,
        nextCommand: contract.statusReconciliation.nextCommand,
      }))),
    }),
    operatorActionQueue: createCapabilityOperatorActionQueue(contracts, diagnostics),
  });
}

function createCapabilityOperatorActionQueue(contracts = [], diagnostics = []) {
  const rows = [];
  const pushRow = (contract, lane, state, nextCommand, detail, priority, extra = {}) => {
    rows.push(Object.freeze({
      action: contract.action,
      provider: contract.provider,
      lane,
      state,
      priority,
      nextCommand,
      detail,
      idempotencyKey: compactString(extra.idempotencyKey || contract.effects?.operatorAcceptanceToken || ""),
      statusChannel: compactString(extra.statusChannel || contract.audit?.statusChannel || ""),
      statusSnapshotKey: compactString(extra.statusSnapshotKey || contract.audit?.statusSnapshotKey || ""),
      requiredPermission: compactString(contract.boundaryDecision?.requiredPermission || ""),
      acceptanceToken: compactString(contract.acceptance?.token || ""),
      retry: extra.retry || null,
      sync: extra.sync || null,
    }));
  };

  for (const contract of toArray(contracts)) {
    if (contract.boundaryDecision?.decision === "hold") {
      pushRow(
        contract,
        "boundary",
        "blocked",
        contract.health?.actionableError?.nextCommand || "resolve_boundary_hold",
        toArray(contract.boundaryDecision?.reasons).join(", ") || "boundary hold",
        10
      );
      continue;
    }

    if (contract.acceptance?.state === "rejected") {
      pushRow(
        contract,
        "acceptance",
        "blocked",
        "revise_or_cancel_provider_action",
        "operator acceptance rejected",
        9
      );
      continue;
    }

    if (contract.acceptance?.state === "pending") {
      pushRow(
        contract,
        "acceptance",
        "waiting",
        contract.acceptance.nextCommand || "collect_verifier_evidence",
        toArray(contract.acceptance.missing).join(", ") || "operator acceptance pending",
        8
      );
    }

    if (contract.lifecycle?.mode === "disabled") {
      pushRow(
        contract,
        ["failed", "timed-out", "cancelled", "missing-status"].includes(contract.statusReconciliation?.state) ? "adapter-status" : "lifecycle",
        "blocked",
        contract.lifecycle.nextAction || "repair_capability_settings",
        contract.statusReconciliation?.message
          || toArray(contract.lifecycle.settingsValidation).map((item) => item.reason).join(", ")
          || "lifecycle disabled",
        7
      );
    }

    if (contract.providerSync?.state === "blocked") {
      pushRow(
        contract,
        "provider-sync",
        "blocked",
        contract.providerSync.nextCommand || "repair_provider_sync_metadata",
        toArray(contract.providerSync.validation).map((item) => item.reason).join(", ") || "provider sync metadata blocked",
        6,
        {
          sync: Object.freeze({
            state: contract.providerSync.state,
            checkpointKey: contract.providerSync.metadata?.checkpointKey || "",
            watermarkKey: contract.providerSync.metadata?.watermarkKey || "",
          }),
        }
      );
    } else if (contract.providerSync?.state === "needs-provider-confirmation") {
      pushRow(
        contract,
        "provider-sync",
        "waiting",
        contract.providerSync.nextCommand || "confirm_provider_resource_state",
        "provider resource identity needs confirmation",
        4,
        {
          sync: Object.freeze({
            state: contract.providerSync.state,
            resources: contract.providerSync.resources,
          }),
        }
      );
    }

    if (contract.workflowGate?.acceptedForAdapter === false) {
      pushRow(
        contract,
        "client-workflow",
        "blocked",
        contract.workflowGate.nextCommand || "resolve_runtime_readiness",
        toArray(contract.workflowGate.blockedCommands).map((command) => command.reason || command.command).join(", ") || "client workflow handoff blocked",
        8
      );
    }

    if (contract.health?.state === "degraded-no-status-snapshot") {
      pushRow(
        contract,
        "status",
        "degraded",
        "attach_status_snapshot_store",
        "status snapshot key is required for restart-safe adapter handoff",
        5
      );
    }

    if (contract.lifecycle?.controls?.enableAdapterHandoff === true) {
      pushRow(
        contract,
        "handoff",
        "ready",
        "queue_adapter_handoff",
        contract.providerSync?.state === "checkpoint-ready" ? "provider checkpoint ready" : "adapter handoff ready",
        1,
        {
          idempotencyKey: contract.effects?.operatorAcceptanceToken,
          retry: contract.health?.retry || null,
          sync: Object.freeze({
            state: contract.providerSync?.state || "not-applicable",
            checkpointKey: contract.providerSync?.metadata?.checkpointKey || "",
            watermarkKey: contract.providerSync?.metadata?.watermarkKey || "",
          }),
        }
      );
    } else if (contract.health?.retry?.retryable === true) {
      pushRow(
        contract,
        "retry",
        "ready",
        "retry_same_idempotency_key",
        "retryable provider operation",
        3,
        { retry: contract.health.retry }
      );
    }
  }

  const diagnosticRows = toArray(diagnostics)
    .filter((diagnostic) => diagnostic.level === "error")
    .map((diagnostic, index) => Object.freeze({
      action: compactString(diagnostic.capabilityName || diagnostic.code || `diagnostic:${index + 1}`),
      provider: "diagnostic",
      lane: "diagnostic",
      state: "blocked",
      priority: 11,
      nextCommand: compactString(diagnostic.nextCommand || "resolve_capability_diagnostic"),
      detail: compactString(diagnostic.message),
      idempotencyKey: "",
      statusChannel: "",
      statusSnapshotKey: "",
      requiredPermission: "",
      acceptanceToken: "",
      retry: null,
      sync: null,
    }));
  const queue = [...rows, ...diagnosticRows]
    .sort((left, right) => right.priority - left.priority || left.action.localeCompare(right.action) || left.lane.localeCompare(right.lane));
  const blocked = queue.filter((row) => row.state === "blocked");
  const waiting = queue.filter((row) => row.state === "waiting");
  const ready = queue.filter((row) => row.state === "ready");

  return Object.freeze({
    protocol: "aios.capability.operator-action-queue.v1",
    state: blocked.length > 0 ? "blocked" : waiting.length > 0 ? "waiting" : ready.length > 0 ? "ready" : "empty",
    acceptedForAdapter: blocked.length === 0 && waiting.length === 0,
    nextCommand: blocked[0]?.nextCommand || waiting[0]?.nextCommand || ready[0]?.nextCommand || "observe",
    rows: freezeArray(queue),
    summary: Object.freeze({
      total: queue.length,
      blocked: blocked.length,
      waiting: waiting.length,
      ready: ready.length,
      degraded: queue.filter((row) => row.state === "degraded").length,
      mailchimpRows: queue.filter((row) => row.provider === "mailchimp").length,
    }),
  });
}

function createCapabilityAnalyticsSnapshot(jobName, principal = {}, contracts = [], diagnostics = []) {
  const mailchimpContracts = contracts.filter((contract) => contract.provider === "mailchimp");
  const byDecision = mailchimpContracts.reduce((counts, contract) => {
    const decision = contract.boundaryDecision?.decision || "unknown";
    counts[decision] = (counts[decision] || 0) + 1;
    return counts;
  }, {});
  const byRisk = contracts.reduce((counts, contract) => {
    const risk = contract.risk || "unknown";
    counts[risk] = (counts[risk] || 0) + 1;
    return counts;
  }, {});
  const holdReasons = new Map();

  for (const contract of mailchimpContracts) {
    for (const reason of toArray(contract.boundaryDecision?.reasons)) {
      const key = compactString(reason);
      if (key) holdReasons.set(key, (holdReasons.get(key) || 0) + 1);
    }
  }

  return Object.freeze({
    protocol: "aios.capability.analytics-snapshot.v1",
    jobName: compactString(jobName || "anonymous"),
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    actorId: principal.actorId,
    state: diagnostics.some((diagnostic) => diagnostic.level === "error")
      ? "blocked"
      : mailchimpContracts.some((contract) => contract.health?.degradedMode !== "none")
        ? "degraded"
        : "healthy",
    counters: Object.freeze({
      totalCapabilities: contracts.length,
      mailchimpCapabilities: mailchimpContracts.length,
      externalWrites: contracts.filter((contract) => contract.effects.externalWrite).length,
      approvals: contracts.filter((contract) => contract.effects.requiredApproval).length,
      held: mailchimpContracts.filter((contract) => contract.boundaryDecision?.decision === "hold").length,
      scopeSourcedDecisions: mailchimpContracts.filter((contract) => contract.boundaryDecision?.source === "scope-permission-boundary").length,
      degraded: contracts.filter((contract) => contract.health?.degradedMode !== "none").length,
      retryable: contracts.filter((contract) => contract.health?.retry?.retryable).length,
      syncBlocked: mailchimpContracts.filter((contract) => contract.providerSync?.state === "blocked").length,
      syncPending: mailchimpContracts.filter((contract) => contract.providerSync?.state === "needs-provider-confirmation").length,
      syncCheckpointReady: mailchimpContracts.filter((contract) => contract.providerSync?.state === "checkpoint-ready").length,
      adapterStatusFailures: mailchimpContracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state)).length,
      adapterStatusMissing: mailchimpContracts.filter((contract) => contract.statusReconciliation?.state === "missing-status").length,
      adapterStatusSucceeded: mailchimpContracts.filter((contract) => contract.statusReconciliation?.state === "succeeded").length,
      workflowBlocked: mailchimpContracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false).length,
      workflowReady: mailchimpContracts.filter((contract) => contract.workflowGate?.state === "ready").length,
      errors: diagnostics.filter((diagnostic) => diagnostic.level === "error").length,
      warnings: diagnostics.filter((diagnostic) => diagnostic.level === "warning").length,
    }),
    decisions: Object.freeze(byDecision),
    risk: Object.freeze(byRisk),
    holdReasons: freezeArray([...holdReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))),
    timeline: freezeArray(mailchimpContracts.map((contract, index) => ({
      index,
      action: contract.action,
      decision: contract.boundaryDecision?.decision || "unknown",
      source: contract.boundaryDecision?.source || "unknown",
      risk: contract.risk,
      health: contract.health?.state || "unknown",
      statusState: contract.handoff?.statusState || "",
      adapterStatusState: contract.statusReconciliation?.state || "unobserved",
      adapterStatusNextCommand: contract.statusReconciliation?.nextCommand || "observe",
      workflowState: contract.workflowGate?.state || "not-required",
      workflowNextCommand: contract.workflowGate?.nextCommand || "observe",
      syncState: contract.providerSync?.state || "not-applicable",
      syncCheckpointKey: contract.providerSync?.metadata?.checkpointKey || "",
      nextCommand: contract.handoff?.recoveryCommand || contract.health?.actionableError?.nextCommand || "observe",
      requiredPermission: contract.boundaryDecision?.requiredPermission || "",
      reasons: contract.boundaryDecision?.reasons || freezeArray([]),
    }))),
    runtimeReadiness: Object.freeze({
      state: compactString(principal.runtimeReadiness?.state || "not-provided"),
      acceptedForAdapter: principal.runtimeReadiness?.acceptedForAdapter === true,
      nextCommand: compactString(principal.runtimeReadiness?.nextStep?.command || ""),
    }),
  });
}

function createCapabilityAnalyticsExport(jobAnalyses = [], diagnostics = []) {
  const snapshots = toArray(jobAnalyses).map((job) => job.analyticsSnapshot).filter(Boolean);
  const contracts = toArray(jobAnalyses).flatMap((job) => job.contracts || []);
  const held = contracts.filter((contract) => contract.boundaryDecision?.decision === "hold");
  const statusFailures = contracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state));
  const statusMissing = contracts.filter((contract) => contract.statusReconciliation?.state === "missing-status");
  const workflowBlocked = contracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false);
  const actionQueues = toArray(jobAnalyses).map((job) => job.operationalReport?.operatorActionQueue).filter(Boolean);

  return Object.freeze({
    protocol: "aios.capability.analytics-export.v1",
    state: diagnostics.some((diagnostic) => diagnostic.level === "error")
      ? "blocked"
      : contracts.some((contract) => contract.health?.degradedMode !== "none")
        ? "degraded"
        : "healthy",
    exportReady: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    snapshots: freezeArray(snapshots),
    counters: Object.freeze({
      jobs: snapshots.length,
      capabilities: contracts.length,
      mailchimpCapabilities: contracts.filter((contract) => contract.provider === "mailchimp").length,
      heldCapabilities: held.length,
      scopeSourcedDecisions: contracts.filter((contract) => contract.boundaryDecision?.source === "scope-permission-boundary").length,
      degradedCapabilities: contracts.filter((contract) => contract.health?.degradedMode !== "none").length,
      retryableCapabilities: contracts.filter((contract) => contract.health?.retry?.retryable).length,
      adapterStatusFailures: contracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state)).length,
      adapterStatusMissing: contracts.filter((contract) => contract.statusReconciliation?.state === "missing-status").length,
      operatorQueueRows: actionQueues.reduce((count, queue) => count + (queue.summary?.total ?? 0), 0),
      operatorQueueBlocked: actionQueues.reduce((count, queue) => count + (queue.summary?.blocked ?? 0), 0),
      workflowBlocked: workflowBlocked.length,
      workflowReady: contracts.filter((contract) => contract.workflowGate?.state === "ready").length,
      diagnostics: diagnostics.length,
    }),
    heldCapabilities: freezeArray(held.map((contract) => ({
      action: contract.action,
      provider: contract.provider,
      requiredPermission: contract.boundaryDecision?.requiredPermission || "",
      reasons: contract.boundaryDecision?.reasons || freezeArray([]),
      nextCommand: contract.health?.actionableError?.nextCommand || contract.handoff?.recoveryCommand || "resolve_boundary_hold",
    }))),
    adapterStatus: Object.freeze({
      failures: freezeArray(statusFailures.map((contract) => ({
        action: contract.action,
        state: contract.statusReconciliation.state,
        message: contract.statusReconciliation.message,
        nextCommand: contract.statusReconciliation.nextCommand,
      }))),
      missing: freezeArray(statusMissing.map((contract) => ({
        action: contract.action,
        statusSnapshotKey: contract.statusReconciliation.statusSnapshotKey,
        nextCommand: contract.statusReconciliation.nextCommand,
      }))),
    }),
    clientWorkflow: Object.freeze({
      blocked: freezeArray(workflowBlocked.map((contract) => ({
        action: contract.action,
        nextCommand: contract.workflowGate.nextCommand,
        blockedCommands: contract.workflowGate.blockedCommands,
      }))),
      ready: freezeArray(contracts
        .filter((contract) => contract.workflowGate?.state === "ready")
        .map((contract) => ({
          action: contract.action,
          nextCommand: contract.workflowGate.nextCommand,
          readyCommands: contract.workflowGate.readyCommands,
        }))),
    }),
    timeline: freezeArray(snapshots
      .flatMap((snapshot) => snapshot.timeline.map((event) => ({ ...event, jobName: snapshot.jobName })))
      .sort((left, right) => left.jobName.localeCompare(right.jobName) || left.index - right.index)),
    operatorActionQueues: freezeArray(actionQueues.map((queue, index) => ({
      index,
      state: queue.state,
      nextCommand: queue.nextCommand,
      summary: queue.summary,
    }))),
  });
}

function analyzeJobCapabilities(job = {}, typeJob) {
  const usage = collectStepUsage(job);
  const principal = normalizeRuntimePrincipal(job, typeJob);
  const contracts = toArray(job.capabilities)
    .map((capability) => createCapabilityContract(capability, usage, principal))
    .sort((left, right) => left.action.localeCompare(right.action));
  const diagnostics = [];
  const referenced = new Set([...usage.keys()]);
  const declared = new Set(contracts.map((contract) => contract.action));

  for (const capabilityName of referenced) {
    if (!declared.has(capabilityName)) {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "aios.capability.reference_missing_contract",
        message: `Capability "${capabilityName}" is referenced by a step but has no contract.`,
        jobName: job.name,
        capabilityName,
      }));
    }
  }

  for (const contract of contracts) {
    if (contract.provider === "mailchimp" && contract.serviceScopes.length === 0) {
      diagnostics.push(Object.freeze({
        level: "warning",
        code: "aios.capability.mailchimp_scope_inferred_empty",
        message: `Mailchimp capability "${contract.action}" has no service scope mapping.`,
        jobName: job.name,
        capabilityName: contract.action,
      }));
    }

    if (contract.boundaryDecision.decision === "hold") {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "aios.capability.boundary_hold",
        message: `Capability "${contract.action}" is held by tenant/workspace or permission boundary checks.`,
        jobName: job.name,
        capabilityName: contract.action,
        reasons: contract.boundaryDecision.reasons,
      }));
    }

    if (contract.health.actionableError && contract.health.actionableError.code !== "aios.capability.boundary_hold") {
      diagnostics.push(Object.freeze({
        level: "warning",
        code: contract.health.actionableError.code,
        message: contract.health.actionableError.message,
        jobName: job.name,
        capabilityName: contract.action,
        nextCommand: contract.health.actionableError.nextCommand,
      }));
    }

    for (const setting of toArray(contract.lifecycle?.settingsValidation)) {
      if (setting.severity === "error") {
        diagnostics.push(Object.freeze({
          level: "error",
          code: "aios.capability.lifecycle_setting_invalid",
          message: `Capability "${contract.action}" has invalid lifecycle setting "${setting.setting}": ${setting.reason}.`,
          jobName: job.name,
          capabilityName: contract.action,
          setting: setting.setting,
          reason: setting.reason,
          nextCommand: contract.lifecycle?.nextAction || "repair_capability_settings",
        }));
      }
    }

    for (const validation of toArray(contract.providerSync?.validation)) {
      if (validation.severity === "error") {
        diagnostics.push(Object.freeze({
          level: "error",
          code: "aios.capability.provider_sync_invalid",
          message: `Capability "${contract.action}" has invalid provider sync metadata: ${validation.reason}.`,
          jobName: job.name,
          capabilityName: contract.action,
          reason: validation.reason,
          nextCommand: contract.providerSync?.nextCommand || "repair_provider_sync_metadata",
        }));
      }
    }
  }

  return Object.freeze({
    jobName: compactString(job.name || typeJob?.jobName || "anonymous"),
    principal,
    status: diagnostics.some((diagnostic) => diagnostic.level === "error") ? "invalid" : "analyzed",
    contracts: freezeArray(contracts),
    auditHandoff: createCapabilityAuditHandoff(contracts, principal),
    operationalReport: createCapabilityOperationalReport(contracts, diagnostics),
    analyticsSnapshot: createCapabilityAnalyticsSnapshot(job.name || typeJob?.jobName, principal, contracts, diagnostics),
    diagnostics: freezeArray(diagnostics),
    summary: summarizeCapabilityContracts(contracts, diagnostics),
  });
}

export function createCapabilityAuditHandoff(contracts = [], principal = {}) {
  const auditEvents = toArray(contracts).map((contract) => contract.audit);
  return Object.freeze({
    protocol: "aios.capability.audit-handoff.v1",
    tenantId: compactString(principal.tenantId),
    workspaceId: compactString(principal.workspaceId),
    actorId: compactString(principal.actorId),
    statusChannel: compactString(principal.statusChannel),
    acceptedForAdapter: toArray(contracts).every((contract) => {
      return contract.boundaryDecision?.decision === "allow" && contract.acceptance?.accepted !== false;
    }),
    statusSnapshotKeys: freezeArray([...new Set(toArray(contracts).map((contract) => contract.audit?.statusSnapshotKey).filter(Boolean))]),
    events: freezeArray(auditEvents),
    heldCapabilities: freezeArray(toArray(contracts)
      .filter((contract) => contract.boundaryDecision?.decision === "hold")
      .map((contract) => ({
        action: contract.action,
        reasons: contract.boundaryDecision.reasons,
        requiredPermission: contract.boundaryDecision.requiredPermission,
      }))),
  });
}

export function analyzeAiosCapabilities(input = {}) {
  const jobs = getJobs(input);
  const typeHints = input.typeHints || inferAiosTypeHints(input);
  const jobAnalyses = jobs.map((job, index) => analyzeJobCapabilities(job, typeHints.jobs?.[index]));
  const diagnostics = [
    ...(typeHints.diagnostics || []),
    ...jobAnalyses.flatMap((job) => job.diagnostics),
  ];

  return Object.freeze({
    protocol: "aios.semantic.capability-analysis.v1",
    status: diagnostics.some((diagnostic) => diagnostic.level === "error") ? "blocked" : "analyzed",
    typeHints,
    jobs: freezeArray(jobAnalyses),
    diagnostics: freezeArray(diagnostics),
    analyticsExport: createCapabilityAnalyticsExport(jobAnalyses, diagnostics),
    summary: summarizeAiosCapabilities(jobAnalyses, diagnostics),
  });
}

export function summarizeCapabilityContracts(contracts = [], diagnostics = []) {
  return Object.freeze({
    total: contracts.length,
    externalWrites: contracts.filter((contract) => contract.effects.externalWrite).length,
    approvalRequired: contracts.filter((contract) => contract.effects.requiredApproval).length,
    mailchimp: contracts.filter((contract) => contract.provider === "mailchimp").length,
    highRisk: contracts.filter((contract) => contract.risk === "high").length,
    heldByBoundary: contracts.filter((contract) => contract.boundaryDecision?.decision === "hold").length,
    scopeSourcedDecisions: contracts.filter((contract) => contract.boundaryDecision?.source === "scope-permission-boundary").length,
    degraded: contracts.filter((contract) => contract.health?.degradedMode !== "none").length,
    disabled: contracts.filter((contract) => contract.lifecycle?.mode === "disabled").length,
    schedulable: contracts.filter((contract) => contract.lifecycle?.controls?.enableScheduling).length,
    retryable: contracts.filter((contract) => contract.health?.retry?.retryable).length,
    adapterStatusFailures: contracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state)).length,
    adapterStatusMissing: contracts.filter((contract) => contract.statusReconciliation?.state === "missing-status").length,
    adapterStatusSucceeded: contracts.filter((contract) => contract.statusReconciliation?.state === "succeeded").length,
    syncBlocked: contracts.filter((contract) => contract.providerSync?.state === "blocked").length,
    syncPendingConfirmation: contracts.filter((contract) => contract.providerSync?.state === "needs-provider-confirmation").length,
    syncCheckpointReady: contracts.filter((contract) => contract.providerSync?.state === "checkpoint-ready").length,
    workflowBlocked: contracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false).length,
    workflowReady: contracts.filter((contract) => contract.workflowGate?.state === "ready").length,
    pendingAcceptance: contracts.filter((contract) => contract.acceptance?.state === "pending").length,
    rejectedAcceptance: contracts.filter((contract) => contract.acceptance?.state === "rejected").length,
    diagnostics: diagnostics.length,
  });
}

export function summarizeAiosCapabilities(jobAnalyses = [], diagnostics = []) {
  const contracts = toArray(jobAnalyses).flatMap((job) => job.contracts || []);
  return Object.freeze({
    jobs: jobAnalyses.length,
    capabilities: contracts.length,
    mailchimpCapabilities: contracts.filter((contract) => contract.provider === "mailchimp").length,
    externalWrites: contracts.filter((contract) => contract.effects.externalWrite).length,
    approvals: contracts.filter((contract) => contract.effects.requiredApproval).length,
    acceptedApprovals: contracts.filter((contract) => contract.acceptance?.state === "accepted").length,
    pendingApprovals: contracts.filter((contract) => contract.acceptance?.state === "pending").length,
    rejectedApprovals: contracts.filter((contract) => contract.acceptance?.state === "rejected").length,
    heldByBoundary: contracts.filter((contract) => contract.boundaryDecision?.decision === "hold").length,
    scopeSourcedDecisions: contracts.filter((contract) => contract.boundaryDecision?.source === "scope-permission-boundary").length,
    degradedCapabilities: contracts.filter((contract) => contract.health?.degradedMode !== "none").length,
    disabledCapabilities: contracts.filter((contract) => contract.lifecycle?.mode === "disabled").length,
    schedulableCapabilities: contracts.filter((contract) => contract.lifecycle?.controls?.enableScheduling).length,
    retryableCapabilities: contracts.filter((contract) => contract.health?.retry?.retryable).length,
    adapterStatusFailures: contracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state)).length,
    adapterStatusMissing: contracts.filter((contract) => contract.statusReconciliation?.state === "missing-status").length,
    adapterStatusSucceeded: contracts.filter((contract) => contract.statusReconciliation?.state === "succeeded").length,
    providerSyncBlocked: contracts.filter((contract) => contract.providerSync?.state === "blocked").length,
    providerSyncPending: contracts.filter((contract) => contract.providerSync?.state === "needs-provider-confirmation").length,
    providerSyncCheckpointReady: contracts.filter((contract) => contract.providerSync?.state === "checkpoint-ready").length,
    workflowBlockedCapabilities: contracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false).length,
    workflowReadyCapabilities: contracts.filter((contract) => contract.workflowGate?.state === "ready").length,
    diagnostics: diagnostics.length,
    readyForEffectAnalysis: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
  });
}
