export const surfaceId = "aios_capability-security_privileged-kernel-change_018";
export const surfaceGroup = "capability-security";
export const surfaceName = "privileged-kernel-change";

const STATE_SCHEMA_VERSION = 1;
const HISTORY_SNAPSHOT_LIMIT = 12;
const TIMELINE_EVENT_LIMIT = 50;
const EXPORT_SCHEMA = "privileged-kernel-change.analytics-export.v1";
const PROVIDER_CONTRACT_SCHEMA = "privileged-kernel-change.provider-contract.v1";
const EXTERNAL_HANDOFF_SCHEMA = "privileged-kernel-change.external-handoff.v1";
const PREVIEW_SCHEMA = "privileged-kernel-change.operator-preview.v1";
const ACCEPTANCE_SCHEMA = "privileged-kernel-change.acceptance-contract.v1";
const READINESS_SCHEMA = "privileged-kernel-change.readiness-summary.v1";
const VALIDATION_SCHEMA = "privileged-kernel-change.validation-summary.v1";
const EXPLAINABLE_NEXT_STEP_SCHEMA = "privileged-kernel-change.explainable-next-step.v1";
const OPERATIONAL_HEALTH_SCHEMA = "privileged-kernel-change.operational-health.v1";
const APPLY_RECOVERY_SCHEMA = "privileged-kernel-change.apply-recovery.v1";
const MUTATION_PLAN_SCHEMA = "privileged-kernel-change.mutation-plan.v1";
const CLIENT_RUNTIME_HANDOFF_SCHEMA = "privileged-kernel-change.client-runtime-handoff.v1";
const CLIENT_WORKFLOW_HANDOFF_SCHEMA = "privileged-kernel-change.client-workflow-handoff.v1";
const ACCESS_DECISION_SCHEMA = "privileged-kernel-change.access-decision.v1";
const ANALYTICS_HISTORY_REPORT_SCHEMA = "privileged-kernel-change.analytics-history-report.v1";
const REPORTING_TIMELINE_SCHEMA = "privileged-kernel-change.reporting-timeline.v1";
const SCOPE_EXPORT_SCHEMA = "privileged-kernel-change.scope-export-summary.v1";
const SCHEDULE_CONTROL_SCHEMA = "privileged-kernel-change.schedule-control.v1";
const COMMAND_RECEIPT_SCHEMA = "privileged-kernel-change.command-receipt.v1";
const COMMAND_RECOVERY_SCHEMA = "privileged-kernel-change.command-recovery.v1";
const WORKSPACE_AUDIT_MANIFEST_SCHEMA = "privileged-kernel-change.workspace-audit-manifest.v1";
const PROVIDER_CAPABILITY_OBLIGATION_SCHEMA = "privileged-kernel-change.provider-capability-obligation.v1";
const ACTIVE_STATES = new Set(["pending", "approved", "applying"]);
const TERMINAL_STATES = new Set(["applied", "rejected", "failed", "superseded"]);
const LIFECYCLE_GATE_SCHEMA = "privileged-kernel-change.lifecycle-gate.v1";
const KERNEL_MUTATION_ACTIONS = new Set(["install-module", "remove-module", "update-setting", "rotate-secret", "sync-policy", "restart-service"]);
const KERNEL_MUTATION_RISKS = new Set(["low", "medium", "high", "critical"]);
const CHANGE_COMMANDS = new Set([
  "request-change",
  "approve-change",
  "reject-change",
  "begin-apply",
  "record-applied",
  "record-failed",
  "supersede-change",
  "schedule-change",
  "record-external-handoff"
]);
const DEFAULT_TENANT_ID = "hosted-kernel";
const DEFAULT_WORKSPACE_ID = "kernel-control-plane";
const DEFAULT_LIFECYCLE_SETTINGS = {
  enabled: true,
  approvalMode: "single-approval",
  applyMode: "manual",
  maxActiveChanges: 20,
  maintenanceWindow: null
};
const APPROVAL_MODES = new Set(["single-approval", "two-person"]);
const APPLY_MODES = new Set(["manual", "scheduled-window"]);
const KNOWN_COMMANDS = new Set([
  "request-change",
  "approve-change",
  "reject-change",
  "begin-apply",
  "record-applied",
  "record-failed",
  "supersede-change",
  "schedule-change",
  "configure-lifecycle-settings",
  "enable-lifecycle-controls",
  "disable-lifecycle-controls",
  "negotiate-provider-contract",
  "record-external-handoff"
]);
const COMMAND_PERMISSIONS = {
  "request-change": "kernel-change:request",
  "approve-change": "kernel-change:approve",
  "reject-change": "kernel-change:reject",
  "begin-apply": "kernel-change:apply",
  "record-applied": "kernel-change:audit",
  "record-failed": "kernel-change:audit",
  "supersede-change": "kernel-change:supersede",
  "schedule-change": "kernel-change:schedule",
  "configure-lifecycle-settings": "kernel-change:settings",
  "enable-lifecycle-controls": "kernel-change:settings",
  "disable-lifecycle-controls": "kernel-change:settings",
  "negotiate-provider-contract": "kernel-change:settings",
  "record-external-handoff": "kernel-change:audit"
};
const HOSTED_KERNEL_CAPABILITIES = [
  "audit-ledger.append",
  "change-state.sync",
  "evidence.digest",
  "external-handoff.track",
  "lifecycle-controls.enforce",
  "provider-contract.negotiate"
];
const ROLE_PERMISSIONS = {
  "tenant-admin": ["kernel-change:request", "kernel-change:approve", "kernel-change:reject", "kernel-change:supersede", "kernel-change:schedule", "kernel-change:settings"],
  "workspace-owner": ["kernel-change:request", "kernel-change:approve", "kernel-change:reject"],
  "kernel-operator": ["kernel-change:apply", "kernel-change:audit", "kernel-change:schedule"],
  "audit-writer": ["kernel-change:audit"]
};

function isoNow(input) {
  return typeof input?.now === "string" && input.now ? input.now : new Date().toISOString();
}

function stableString(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableString(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function proofHash(value) {
  const text = stableString(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function emptyMap() {
  return Object.create(null);
}

function isSafeStorageKey(value) {
  return typeof value === "string" && value && !["__proto__", "constructor", "prototype"].includes(value);
}

function isSafeBoundarySegment(value) {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value) && isSafeStorageKey(value);
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value)));
}

function safeLabel(value, fallback, maxLength = 120) {
  return typeof value === "string" && value ? value.slice(0, maxLength) : fallback;
}

function normalizeBoundary(value = {}) {
  const record = asRecord(value);
  const tenantId = isSafeBoundarySegment(record.tenantId) ? record.tenantId : DEFAULT_TENANT_ID;
  const workspaceId = isSafeBoundarySegment(record.workspaceId) ? record.workspaceId : DEFAULT_WORKSPACE_ID;
  return {
    tenantId,
    workspaceId,
    scopeKey: `${tenantId}/${workspaceId}`
  };
}

function boundaryFromCommand(command) {
  return normalizeBoundary({
    tenantId: command.tenantId,
    workspaceId: command.workspaceId
  });
}

function normalizePrincipal(value = {}, fallbackId = "unknown-principal") {
  const record = asRecord(value);
  const roles = uniqueStrings(record.roles);
  const explicitPermissions = uniqueStrings(record.permissions);
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const tenantId = isSafeBoundarySegment(record.tenantId) ? record.tenantId : null;
  const workspaceIds = uniqueStrings(record.workspaceIds).filter(isSafeBoundarySegment);
  const explicitGrants = explicitPermissions.map((permission) => ({
    permission,
    tenantId,
    workspaceId: null,
    source: "principal-permission",
    expiresAt: null
  }));
  const roleGrants = roles.flatMap((role) => (ROLE_PERMISSIONS[role] || []).map((permission) => ({
    permission,
    tenantId,
    workspaceId: null,
    source: `role:${role}`,
    expiresAt: null
  })));
  const workspaceGrants = [...explicitGrants, ...roleGrants].flatMap((grant) => (
    workspaceIds.length
      ? workspaceIds.map((workspaceId) => ({ ...grant, workspaceId }))
      : [grant]
  ));
  const delegatedGrants = normalizePermissionGrants(record.permissionGrants || record.boundaryGrants);
  return {
    principalId: typeof record.principalId === "string" && record.principalId ? record.principalId : fallbackId,
    tenantId,
    workspaceIds,
    roles,
    permissions: Array.from(new Set([...explicitPermissions, ...rolePermissions, ...delegatedGrants.map((grant) => grant.permission)])).sort(),
    permissionGrants: dedupePermissionGrants([...workspaceGrants, ...delegatedGrants])
  };
}

function commandPrincipal(command) {
  const fallbackId = command.approvedBy || command.rejectedBy || command.appliedBy || command.requestedBy || "unknown-principal";
  return normalizePrincipal(command.principal, fallbackId);
}

function normalizePermissionGrants(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const grant = asRecord(entry);
      const tenantId = grant.tenantId === "*" ? "*" : isSafeBoundarySegment(grant.tenantId) ? grant.tenantId : null;
      const workspaceId = grant.workspaceId === "*" ? "*" : isSafeBoundarySegment(grant.workspaceId) ? grant.workspaceId : null;
      return {
        permission: typeof grant.permission === "string" && grant.permission ? grant.permission : null,
        tenantId,
        workspaceId,
        source: typeof grant.source === "string" && grant.source ? grant.source.slice(0, 80) : "delegated-grant",
        expiresAt: typeof grant.expiresAt === "string" && grant.expiresAt ? grant.expiresAt : null
      };
    })
    .filter((grant) => grant.permission);
}

function dedupePermissionGrants(grants) {
  const seen = new Set();
  const deduped = [];
  for (const grant of grants) {
    const key = `${grant.permission}|${grant.tenantId || ""}|${grant.workspaceId || ""}|${grant.source}|${grant.expiresAt || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(grant);
  }
  return deduped.sort((left, right) => `${left.permission}:${left.tenantId || ""}:${left.workspaceId || ""}:${left.source}`.localeCompare(
    `${right.permission}:${right.tenantId || ""}:${right.workspaceId || ""}:${right.source}`
  ));
}

function grantCoversBoundary(grant, requiredPermission, boundary, now) {
  if (grant.permission !== requiredPermission) return false;
  if (grant.expiresAt && now && grant.expiresAt <= now) return false;
  if (grant.tenantId && grant.tenantId !== "*" && grant.tenantId !== boundary.tenantId) return false;
  if (grant.workspaceId && grant.workspaceId !== "*" && grant.workspaceId !== boundary.workspaceId) return false;
  return true;
}

function buildAccessDecision(principal, requiredPermission, boundary, now) {
  const coveringGrants = principal.permissionGrants.filter((grant) => grantCoversBoundary(grant, requiredPermission, boundary, now));
  const hasExplicitBoundaryScope = coveringGrants.some((grant) => (
    grant.tenantId === "*" || grant.tenantId === boundary.tenantId || grant.workspaceId === "*" || grant.workspaceId === boundary.workspaceId
  ));
  const defaultScope = boundary.tenantId === DEFAULT_TENANT_ID && boundary.workspaceId === DEFAULT_WORKSPACE_ID;
  const scopeRequired = !defaultScope && !hasExplicitBoundaryScope;
  return {
    schema: ACCESS_DECISION_SCHEMA,
    principalId: principal.principalId,
    requiredPermission,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    scopeKey: boundary.scopeKey,
    authorized: coveringGrants.length > 0 && !scopeRequired,
    scopeRequired,
    matchedGrantCount: coveringGrants.length,
    matchedGrants: coveringGrants.map((grant) => ({
      permission: grant.permission,
      tenantId: grant.tenantId,
      workspaceId: grant.workspaceId,
      source: grant.source,
      expiresAt: grant.expiresAt
    })),
    digest: proofHash({
      principalId: principal.principalId,
      requiredPermission,
      boundary,
      grants: coveringGrants.map((grant) => [grant.permission, grant.tenantId, grant.workspaceId, grant.source, grant.expiresAt])
    })
  };
}

function validateBoundaryAccess(command, current, now) {
  const errors = [];
  const boundary = boundaryFromCommand(command);
  const principal = commandPrincipal(command);
  const requiredPermission = COMMAND_PERMISSIONS[command.type];
  const accessDecision = buildAccessDecision(principal, requiredPermission, boundary, now);

  if (!principal.permissions.includes(requiredPermission) || !accessDecision.matchedGrantCount) errors.push("principal-missing-permission");
  if (accessDecision.scopeRequired) errors.push("principal-boundary-scope-required");
  if (principal.tenantId && principal.tenantId !== boundary.tenantId) errors.push("principal-tenant-boundary-mismatch");
  if (principal.workspaceIds.length && !principal.workspaceIds.includes(boundary.workspaceId)) {
    errors.push("principal-workspace-boundary-mismatch");
  }
  if (current?.tenantId && current.tenantId !== boundary.tenantId) errors.push("change-tenant-boundary-mismatch");
  if (current?.workspaceId && current.workspaceId !== boundary.workspaceId) errors.push("change-workspace-boundary-mismatch");
  if (command.type === "approve-change" && current?.requestedBy === principal.principalId) {
    errors.push("requester-cannot-self-approve");
  }

  return { errors, boundary, principal, requiredPermission, accessDecision };
}

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => ({
      id: typeof entry.id === "string" && entry.id ? entry.id : `evidence-${index + 1}`,
      kind: typeof entry.kind === "string" && entry.kind ? entry.kind : "opaque",
      digest: typeof entry.digest === "string" && entry.digest ? entry.digest : proofHash(entry),
      recordedAt: typeof entry.recordedAt === "string" && entry.recordedAt ? entry.recordedAt : null
    }));
}

function normalizeFailureDetail(value = {}, now = null) {
  const record = asRecord(value);
  const retryable = record.retryable !== false;
  const retryCount = Number.isInteger(record.retryCount) && record.retryCount >= 0 ? record.retryCount : 0;
  const retryAfterSeconds = Number.isInteger(record.retryAfterSeconds) && record.retryAfterSeconds >= 0
    ? Math.min(record.retryAfterSeconds, 3600)
    : Math.min(60 * (2 ** Math.min(retryCount, 5)), 1800);
  return {
    code: typeof record.code === "string" && record.code ? record.code.slice(0, 80) : "apply-failed",
    message: typeof record.message === "string" && record.message ? record.message.slice(0, 240) : "Privileged kernel change failed",
    severity: ["warning", "error", "critical"].includes(record.severity) ? record.severity : "error",
    retryable,
    retryCount,
    retryAfterSeconds: retryable ? retryAfterSeconds : null,
    failedAt: typeof record.failedAt === "string" && record.failedAt ? record.failedAt : now,
    nextOperatorAction: retryable ? "supersede-or-request-retry-change" : "manual-kernel-reconciliation-required"
  };
}

function normalizeMutationAction(value) {
  return KERNEL_MUTATION_ACTIONS.has(value) ? value : "update-setting";
}

function normalizeMutationRisk(value) {
  return KERNEL_MUTATION_RISKS.has(value) ? value : "medium";
}

function normalizeMutationPlan(value = {}, changeId = null) {
  const record = asRecord(value);
  const rawMutations = Array.isArray(value)
    ? value
    : Array.isArray(record.mutations) ? record.mutations : Array.isArray(record.operations) ? record.operations : [];
  const mutations = rawMutations
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const mutation = asRecord(entry);
      const action = normalizeMutationAction(mutation.action);
      const target = typeof mutation.target === "string" && mutation.target
        ? mutation.target.slice(0, 160)
        : `${changeId || "kernel-change"}:target-${index + 1}`;
      const capability = typeof mutation.capability === "string" && mutation.capability
        ? mutation.capability.slice(0, 120)
        : "change-state.sync";
      const risk = normalizeMutationRisk(mutation.risk);
      return {
        mutationId: typeof mutation.mutationId === "string" && mutation.mutationId
          ? mutation.mutationId
          : proofHash({ changeId, index, action, target, capability }),
        action,
        target,
        capability,
        risk,
        requiresRestart: mutation.requiresRestart === true || risk === "critical",
        rollbackCommand: typeof mutation.rollbackCommand === "string" && mutation.rollbackCommand
          ? mutation.rollbackCommand.slice(0, 240)
          : null,
        expectedDigest: typeof mutation.expectedDigest === "string" && mutation.expectedDigest ? mutation.expectedDigest : null
      };
    });
  const riskOrder = { low: 1, medium: 2, high: 3, critical: 4 };
  const highestRisk = mutations.reduce((highest, mutation) => (
    riskOrder[mutation.risk] > riskOrder[highest] ? mutation.risk : highest
  ), "low");
  const restartRequired = mutations.some((mutation) => mutation.requiresRestart);
  const rollbackMissingCount = mutations.filter((mutation) => ["high", "critical"].includes(mutation.risk) && !mutation.rollbackCommand).length;
  return {
    schema: MUTATION_PLAN_SCHEMA,
    planId: typeof record.planId === "string" && record.planId ? record.planId : proofHash({ changeId, mutations }),
    mutationCount: mutations.length,
    highestRisk,
    restartRequired,
    rollbackComplete: rollbackMissingCount === 0,
    rollbackMissingCount,
    mutations,
    digest: proofHash({ schema: MUTATION_PLAN_SCHEMA, mutations })
  };
}

function normalizeProviderCapabilities(value) {
  const offered = uniqueStrings(value);
  return offered.filter((capability) => HOSTED_KERNEL_CAPABILITIES.includes(capability)).sort();
}

function normalizeSyncMetadata(value = {}, now = null) {
  const record = asRecord(value);
  return {
    cursor: typeof record.cursor === "string" && record.cursor ? record.cursor.slice(0, 160) : null,
    sequence: Number.isInteger(record.sequence) && record.sequence >= 0 ? record.sequence : 0,
    lastSyncedAt: typeof record.lastSyncedAt === "string" && record.lastSyncedAt ? record.lastSyncedAt : now,
    conflictPolicy: ["hosted-kernel-wins", "provider-wins", "manual-review"].includes(record.conflictPolicy)
      ? record.conflictPolicy
      : "hosted-kernel-wins"
  };
}

function normalizeProviderContract(value = {}, boundary = normalizeBoundary(), now = null) {
  const record = asRecord(value);
  const providerId = isSafeBoundarySegment(record.providerId) ? record.providerId : "hosted-kernel-provider";
  const requested = uniqueStrings(record.requestedCapabilities);
  const offered = normalizeProviderCapabilities(record.offeredCapabilities || record.capabilities);
  const accepted = offered.filter((capability) => !requested.length || requested.includes(capability));
  const missing = requested.filter((capability) => !accepted.includes(capability)).sort();
  return {
    schema: PROVIDER_CONTRACT_SCHEMA,
    contractId: `${boundary.scopeKey}/${providerId}`,
    providerId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    scopeKey: boundary.scopeKey,
    status: accepted.length && missing.length === 0 ? "accepted" : "needs-capability-review",
    requestedCapabilities: requested,
    offeredCapabilities: offered,
    acceptedCapabilities: accepted,
    missingCapabilities: missing,
    sync: normalizeSyncMetadata(record.sync, now),
    negotiatedAt: typeof record.negotiatedAt === "string" && record.negotiatedAt ? record.negotiatedAt : now,
    negotiatedBy: typeof record.negotiatedBy === "string" && record.negotiatedBy ? record.negotiatedBy : null
  };
}

function normalizeExternalHandoff(value = {}, boundary = normalizeBoundary(), now = null) {
  const record = asRecord(value);
  return {
    schema: EXTERNAL_HANDOFF_SCHEMA,
    handoffId: typeof record.handoffId === "string" && record.handoffId ? record.handoffId : proofHash({ boundary, now, record }),
    changeId: typeof record.changeId === "string" && record.changeId ? record.changeId : null,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    scopeKey: boundary.scopeKey,
    destination: typeof record.destination === "string" && record.destination ? record.destination.slice(0, 120) : "external-kernel-provider",
    state: normalizeHandoffState(record.state),
    sync: normalizeSyncMetadata(record.sync, now),
    evidence: normalizeEvidence(record.evidence),
    recordedAt: typeof record.recordedAt === "string" && record.recordedAt ? record.recordedAt : now,
    recordedBy: typeof record.recordedBy === "string" && record.recordedBy ? record.recordedBy : null
  };
}

function normalizeHandoffState(value) {
  return ["queued", "delivered", "acknowledged", "failed"].includes(value) ? value : "queued";
}

function providerContractForStateScope(state, scopeKey) {
  return Object.values(state.providerContracts)
    .filter((contract) => contract.scopeKey === scopeKey)
    .sort((left, right) => left.contractId.localeCompare(right.contractId))
    .at(-1) || null;
}

function mutationCapabilitiesForChange(change) {
  return Array.from(new Set((change?.mutationPlan?.mutations || [])
    .map((mutation) => mutation.capability)
    .filter((capability) => typeof capability === "string" && capability)))
    .sort();
}

function contractMissingRequiredCapabilities(contract, requiredCapabilities) {
  if (!contract || contract.status !== "accepted") return requiredCapabilities;
  return requiredCapabilities
    .filter((capability) => !contract.acceptedCapabilities.includes(capability))
    .sort();
}

function externalHandoffPolicyErrors(command, state, current, boundary) {
  if (command.type !== "record-external-handoff") return [];

  const errors = [];
  const handoffState = normalizeHandoffState(command.handoffState);
  const evidence = normalizeEvidence(command.evidence);
  const contract = providerContractForStateScope(state, boundary.scopeKey);
  const destination = typeof command.destination === "string" && command.destination
    ? command.destination.slice(0, 120)
    : "external-kernel-provider";

  if (!current) errors.push("unknown-change");
  if (current && current.scopeKey !== boundary.scopeKey) errors.push("handoff-change-boundary-mismatch");
  if (["queued", "delivered", "acknowledged"].includes(handoffState) && contract?.status !== "accepted") {
    errors.push("provider-contract-required-for-external-handoff");
  }
  if (contract?.status === "accepted" && destination !== contract.providerId) {
    errors.push("handoff-destination-provider-mismatch");
  }
  if (current) {
    const requiredCapabilities = mutationCapabilitiesForChange(current);
    const missingMutationCapabilities = contractMissingRequiredCapabilities(contract, requiredCapabilities);
    if (missingMutationCapabilities.length) errors.push("provider-contract-missing-mutation-capability");
  }
  if (["delivered", "acknowledged"].includes(handoffState) && evidence.length === 0) {
    errors.push("handoff-delivery-evidence-required");
  }
  if (handoffState === "acknowledged" && current && !["approved", "applying", "applied"].includes(current.status)) {
    errors.push("handoff-acknowledgement-invalid-change-state");
  }

  return errors;
}

function parseTimestampMillis(value) {
  if (typeof value !== "string" || !value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function isValidTimestamp(value) {
  return parseTimestampMillis(value) !== null;
}

function compareTimestamps(left, right) {
  const leftMillis = parseTimestampMillis(left);
  const rightMillis = parseTimestampMillis(right);
  if (leftMillis === null || rightMillis === null) return null;
  return leftMillis - rightMillis;
}

function analyzeMaintenanceWindow(value) {
  const record = asRecord(value);
  if (!record.enabled) return { window: null, errors: [] };

  const startsAt = typeof record.startsAt === "string" && record.startsAt ? record.startsAt : null;
  const endsAt = typeof record.endsAt === "string" && record.endsAt ? record.endsAt : null;
  const errors = [];
  if (!startsAt) errors.push("missing-maintenance-window-start");
  if (!endsAt) errors.push("missing-maintenance-window-end");
  if (startsAt && !isValidTimestamp(startsAt)) errors.push("invalid-maintenance-window-start");
  if (endsAt && !isValidTimestamp(endsAt)) errors.push("invalid-maintenance-window-end");
  if (startsAt && endsAt && isValidTimestamp(startsAt) && isValidTimestamp(endsAt) && compareTimestamps(startsAt, endsAt) >= 0) {
    errors.push("maintenance-window-start-after-end");
  }

  return {
    window: {
      enabled: errors.length === 0,
      startsAt,
      endsAt,
      label: typeof record.label === "string" && record.label ? record.label.slice(0, 80) : "hosted-kernel-maintenance",
      validation: {
        valid: errors.length === 0,
        errors
      }
    },
    errors
  };
}

function normalizeMaintenanceWindow(value) {
  return analyzeMaintenanceWindow(value).window;
}

function normalizeLifecycleSettings(value = {}, boundary = normalizeBoundary()) {
  const record = asRecord(value);
  const settings = asRecord(record.settings);
  const maxActiveChanges = Number.isInteger(settings.maxActiveChanges) ? settings.maxActiveChanges : record.maxActiveChanges;
  return {
    scopeKey: boundary.scopeKey,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_LIFECYCLE_SETTINGS.enabled,
    disabledReason: typeof record.disabledReason === "string" && record.disabledReason ? record.disabledReason : null,
    approvalMode: APPROVAL_MODES.has(record.approvalMode) ? record.approvalMode : DEFAULT_LIFECYCLE_SETTINGS.approvalMode,
    applyMode: APPLY_MODES.has(record.applyMode) ? record.applyMode : DEFAULT_LIFECYCLE_SETTINGS.applyMode,
    maxActiveChanges: Number.isInteger(maxActiveChanges) && maxActiveChanges >= 1 && maxActiveChanges <= 100
      ? maxActiveChanges
      : DEFAULT_LIFECYCLE_SETTINGS.maxActiveChanges,
    maintenanceWindow: normalizeMaintenanceWindow(record.maintenanceWindow),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : null,
    updatedBy: typeof record.updatedBy === "string" && record.updatedBy ? record.updatedBy : null
  };
}

function lifecycleSettingsFor(state, boundary) {
  const existing = state.lifecycleSettings[boundary.scopeKey];
  if (existing) return existing;
  const defaults = normalizeLifecycleSettings(DEFAULT_LIFECYCLE_SETTINGS, boundary);
  state.lifecycleSettings[boundary.scopeKey] = defaults;
  return defaults;
}

function validateLifecycleSettingsPatch(patch) {
  const record = asRecord(patch);
  const errors = [];
  if ("enabled" in record && typeof record.enabled !== "boolean") errors.push("invalid-lifecycle-enabled");
  if ("approvalMode" in record && !APPROVAL_MODES.has(record.approvalMode)) errors.push("invalid-approval-mode");
  if ("applyMode" in record && !APPLY_MODES.has(record.applyMode)) errors.push("invalid-apply-mode");
  if ("maxActiveChanges" in record && (!Number.isInteger(record.maxActiveChanges) || record.maxActiveChanges < 1 || record.maxActiveChanges > 100)) {
    errors.push("invalid-max-active-changes");
  }
  if ("maintenanceWindow" in record) {
    const analysis = analyzeMaintenanceWindow(record.maintenanceWindow);
    errors.push(...analysis.errors);
  }
  return errors;
}

function validateResolvedLifecycleSettings(settings) {
  const errors = [];
  if (settings.enabled && settings.applyMode === "scheduled-window" && !settings.maintenanceWindow?.enabled) {
    errors.push("scheduled-window-maintenance-window-required");
  }
  if (settings.enabled && settings.maintenanceWindow?.validation && !settings.maintenanceWindow.validation.valid) {
    errors.push(...settings.maintenanceWindow.validation.errors);
  }
  if (!settings.enabled && !settings.disabledReason) {
    errors.push("disabled-lifecycle-reason-required");
  }
  return Array.from(new Set(errors));
}

function normalizeHistorySnapshots(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((snapshot) => snapshot && typeof snapshot === "object")
    .slice(-HISTORY_SNAPSHOT_LIMIT)
    .map((snapshot, index) => {
      const counters = asRecord(snapshot.counters);
      const statusCounts = asRecord(counters.statusCounts);
      const commandOutcomes = asRecord(counters.commandOutcomes);
      const scopeActivity = Array.isArray(counters.scopeActivity) ? counters.scopeActivity : [];
      return {
        snapshotId: typeof snapshot.snapshotId === "string" && snapshot.snapshotId ? snapshot.snapshotId : `recovered-snapshot-${index + 1}`,
        generatedAt: typeof snapshot.generatedAt === "string" && snapshot.generatedAt ? snapshot.generatedAt : null,
        activeChangeCount: Number.isInteger(snapshot.activeChangeCount) && snapshot.activeChangeCount >= 0 ? snapshot.activeChangeCount : 0,
        terminalChangeCount: Number.isInteger(snapshot.terminalChangeCount) && snapshot.terminalChangeCount >= 0 ? snapshot.terminalChangeCount : 0,
        boundaryViolationCount: Number.isInteger(snapshot.boundaryViolationCount) && snapshot.boundaryViolationCount >= 0 ? snapshot.boundaryViolationCount : 0,
        rejectedCommandCount: Number.isInteger(snapshot.rejectedCommandCount) && snapshot.rejectedCommandCount >= 0 ? snapshot.rejectedCommandCount : 0,
        failureCount: Number.isInteger(snapshot.failureCount) && snapshot.failureCount >= 0 ? snapshot.failureCount : 0,
        exportReady: snapshot.exportReady === true,
        digest: typeof snapshot.digest === "string" && snapshot.digest ? snapshot.digest : proofHash(snapshot),
        counters: {
          statusCounts: Object.fromEntries(
            [...ACTIVE_STATES, ...TERMINAL_STATES].map((status) => [
              status,
              Number.isInteger(statusCounts[status]) && statusCounts[status] >= 0 ? statusCounts[status] : 0
            ])
          ),
          commandOutcomes: Object.fromEntries(
            Object.keys(commandOutcomes).sort().map((key) => [
              key,
              Number.isInteger(commandOutcomes[key]) && commandOutcomes[key] >= 0 ? commandOutcomes[key] : 0
            ])
          ),
          scopeActivity: scopeActivity
            .filter((scope) => scope && typeof scope === "object")
            .map((scope) => ({
              scopeKey: typeof scope.scopeKey === "string" && scope.scopeKey ? scope.scopeKey : "unknown/unknown",
              activeCount: Number.isInteger(scope.activeCount) && scope.activeCount >= 0 ? scope.activeCount : 0,
              terminalCount: Number.isInteger(scope.terminalCount) && scope.terminalCount >= 0 ? scope.terminalCount : 0,
              pendingApprovalCount: Number.isInteger(scope.pendingApprovalCount) && scope.pendingApprovalCount >= 0 ? scope.pendingApprovalCount : 0,
              failedCount: Number.isInteger(scope.failedCount) && scope.failedCount >= 0 ? scope.failedCount : 0
            }))
            .sort((left, right) => left.scopeKey.localeCompare(right.scopeKey))
        }
      };
    });
}

function normalizeApplyRecovery(value, change, now) {
  const record = asRecord(value);
  const status = ["none", "resume-required", "operator-reconciled"].includes(record.status) ? record.status : "none";
  if (change.status !== "applying" && status !== "operator-reconciled") return null;

  if (change.status === "applying") {
    const attempt = asRecord(record.attempt);
    const startedAt = typeof attempt.startedAt === "string" && attempt.startedAt ? attempt.startedAt : change.updatedAt;
    return {
      schema: APPLY_RECOVERY_SCHEMA,
      status: "resume-required",
      restartSafe: false,
      reason: typeof record.reason === "string" && record.reason ? record.reason : "persisted-applying-change",
      detectedAt: typeof record.detectedAt === "string" && record.detectedAt ? record.detectedAt : now,
      attempt: {
        attemptId: typeof attempt.attemptId === "string" && attempt.attemptId
          ? attempt.attemptId
          : proofHash({ changeId: change.changeId, startedAt, status: change.status }),
        startedAt,
        startedBy: typeof attempt.startedBy === "string" && attempt.startedBy ? attempt.startedBy : null,
        commandKey: typeof attempt.commandKey === "string" && attempt.commandKey ? attempt.commandKey : change.idempotencyKey
      },
      resolution: {
        required: true,
        acceptedCommands: ["record-applied", "record-failed"],
        requiredPermission: COMMAND_PERMISSIONS["record-applied"]
      }
    };
  }

  return {
    schema: APPLY_RECOVERY_SCHEMA,
    status: "operator-reconciled",
    restartSafe: true,
    reason: typeof record.reason === "string" && record.reason ? record.reason : "apply-attempt-reconciled",
    detectedAt: typeof record.detectedAt === "string" && record.detectedAt ? record.detectedAt : now,
    reconciledAt: typeof record.reconciledAt === "string" && record.reconciledAt ? record.reconciledAt : now,
    reconciledBy: typeof record.reconciledBy === "string" && record.reconciledBy ? record.reconciledBy : null
  };
}

function commandOutcomeKind(status) {
  if (status === "applied" || status === "accepted") return "state-mutating";
  if (status === "rejected") return "denied";
  if (typeof status === "string" && status.startsWith("ignored")) return "idempotent-noop";
  if (status === "needs-capability-review") return "attention-required";
  return "observed";
}

function normalizeCommandLedgerEntry(value = {}, ledgerKey = null, now = null) {
  const record = asRecord(value);
  const status = typeof record.status === "string" && record.status ? record.status : "unknown";
  const errors = uniqueStrings(record.errors);
  const commandType = KNOWN_COMMANDS.has(record.commandType) ? record.commandType : null;
  const changeId = typeof record.changeId === "string" && record.changeId ? record.changeId : null;
  const scopeKey = typeof record.scopeKey === "string" && record.scopeKey ? record.scopeKey : null;
  const receipt = {
    schema: COMMAND_RECEIPT_SCHEMA,
    idempotencyKey: typeof record.idempotencyKey === "string" && record.idempotencyKey ? record.idempotencyKey : ledgerKey,
    commandType,
    changeId,
    status,
    changeStatus: typeof record.changeStatus === "string" && record.changeStatus ? record.changeStatus : null,
    outcomeKind: typeof record.outcomeKind === "string" && record.outcomeKind ? record.outcomeKind : commandOutcomeKind(status),
    scopeKey,
    principalId: typeof record.principalId === "string" && record.principalId ? record.principalId : null,
    requiredPermission: typeof record.requiredPermission === "string" && record.requiredPermission ? record.requiredPermission : null,
    replaySafe: record.replaySafe !== false,
    errors,
    recordedAt: typeof record.recordedAt === "string" && record.recordedAt ? record.recordedAt : now,
    accessDecision: record.accessDecision && typeof record.accessDecision === "object" ? record.accessDecision : null
  };
  return {
    ...receipt,
    proofDigest: typeof record.proofDigest === "string" && record.proofDigest
      ? record.proofDigest
      : proofHash({
          schema: COMMAND_RECEIPT_SCHEMA,
          idempotencyKey: receipt.idempotencyKey,
          commandType: receipt.commandType,
          changeId: receipt.changeId,
          status: receipt.status,
          changeStatus: receipt.changeStatus,
          scopeKey: receipt.scopeKey,
          principalId: receipt.principalId,
          errors: receipt.errors
        })
  };
}

function recordCommandLedger(state, key, details, now) {
  const entry = normalizeCommandLedgerEntry({
    ...details,
    idempotencyKey: key,
    recordedAt: now
  }, key, now);
  state.commandLedger[key] = entry;
  return entry;
}

function replayAuditFromLedger(command, key, ledgerEntry, now) {
  return {
    event: "privileged-kernel-command-replayed",
    schema: COMMAND_RECEIPT_SCHEMA,
    idempotencyKey: key,
    commandType: ledgerEntry.commandType || command.type || null,
    changeId: ledgerEntry.changeId || command.changeId || null,
    status: ledgerEntry.status,
    changeStatus: ledgerEntry.changeStatus,
    outcomeKind: ledgerEntry.outcomeKind,
    replaySafe: ledgerEntry.replaySafe,
    originalRecordedAt: ledgerEntry.recordedAt,
    proofDigest: ledgerEntry.proofDigest,
    errors: ledgerEntry.errors,
    scopeKey: ledgerEntry.scopeKey,
    principalId: ledgerEntry.principalId,
    requiredPermission: ledgerEntry.requiredPermission,
    accessDecision: ledgerEntry.accessDecision,
    recordedAt: now
  };
}

function normalizeState(input = {}, now = null) {
  const persisted = asRecord(input.persistedState);
  const changes = asRecord(persisted.changes);
  const commandLedger = emptyMap();
  const lifecycleSettings = emptyMap();
  const providerContracts = emptyMap();
  const externalHandoffs = emptyMap();
  const recoveredFrom = [];
  const shapedChanges = emptyMap();

  for (const [ledgerKey, ledgerEntry] of Object.entries(asRecord(persisted.commandLedger))) {
    if (!isSafeStorageKey(ledgerKey)) {
      recoveredFrom.push({
        changeId: null,
        reason: "unsafe-command-ledger-key",
        previousStatus: null,
        recoveredStatus: "dropped"
      });
      continue;
    }

    commandLedger[ledgerKey] = normalizeCommandLedgerEntry(ledgerEntry, ledgerKey, now);
  }

  for (const [scopeKey, rawSettings] of Object.entries(asRecord(persisted.lifecycleSettings))) {
    if (!isSafeStorageKey(scopeKey) || !scopeKey.includes("/")) {
      recoveredFrom.push({
        changeId: null,
        reason: "unsafe-lifecycle-settings-key",
        previousStatus: null,
        recoveredStatus: "dropped"
      });
      continue;
    }
    const [tenantId, workspaceId] = scopeKey.split("/", 2);
    const boundary = normalizeBoundary({ tenantId, workspaceId });
    lifecycleSettings[boundary.scopeKey] = normalizeLifecycleSettings(rawSettings, boundary);
  }

  for (const [contractKey, rawContract] of Object.entries(asRecord(persisted.providerContracts))) {
    if (!isSafeStorageKey(contractKey) || !contractKey.includes("/")) {
      recoveredFrom.push({
        changeId: null,
        reason: "unsafe-provider-contract-key",
        previousStatus: null,
        recoveredStatus: "dropped"
      });
      continue;
    }
    const contract = asRecord(rawContract);
    const boundary = normalizeBoundary(contract);
    providerContracts[normalizeProviderContract(contract, boundary).contractId] = normalizeProviderContract(contract, boundary);
  }

  for (const [handoffKey, rawHandoff] of Object.entries(asRecord(persisted.externalHandoffs))) {
    if (!isSafeStorageKey(handoffKey)) {
      recoveredFrom.push({
        changeId: null,
        reason: "unsafe-external-handoff-key",
        previousStatus: null,
        recoveredStatus: "dropped"
      });
      continue;
    }
    const handoff = asRecord(rawHandoff);
    externalHandoffs[handoffKey] = normalizeExternalHandoff(handoff, normalizeBoundary(handoff));
  }

  for (const [changeId, rawChange] of Object.entries(changes)) {
    if (!isSafeStorageKey(changeId)) {
      recoveredFrom.push({
        changeId: null,
        reason: "unsafe-change-storage-key",
        previousStatus: null,
        recoveredStatus: "dropped"
      });
      continue;
    }

    const change = asRecord(rawChange);
    const status = typeof change.status === "string" ? change.status : "pending";
    const safeStatus = ACTIVE_STATES.has(status) || TERMINAL_STATES.has(status) ? status : "pending";
    const requestedAt = typeof change.requestedAt === "string" && change.requestedAt ? change.requestedAt : null;
    const updatedAt = typeof change.updatedAt === "string" && change.updatedAt ? change.updatedAt : requestedAt;
    const kernelScope = typeof change.kernelScope === "string" && change.kernelScope ? change.kernelScope : "hosted-kernel";
    const boundary = normalizeBoundary(change);

    if (status !== safeStatus || !requestedAt || !updatedAt) {
      recoveredFrom.push({
        changeId,
        reason: "malformed-persisted-change",
        previousStatus: status || null,
        recoveredStatus: safeStatus
      });
    }

    const shapedChange = {
      changeId,
      status: safeStatus,
      kernelScope,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      scopeKey: boundary.scopeKey,
      requestedBy: typeof change.requestedBy === "string" && change.requestedBy ? change.requestedBy : "unknown-principal",
      reason: typeof change.reason === "string" && change.reason ? change.reason : "unspecified",
      requestedAt,
      updatedAt,
      idempotencyKey: typeof change.idempotencyKey === "string" && change.idempotencyKey ? change.idempotencyKey : null,
      evidence: normalizeEvidence(change.evidence),
      mutationPlan: normalizeMutationPlan(change.mutationPlan || change.kernelMutations || change.operations, changeId),
      approvals: uniqueStrings(change.approvals),
      requiredPermissions: uniqueStrings(change.requiredPermissions),
      failure: change.failure && typeof change.failure === "object" ? normalizeFailureDetail(change.failure, updatedAt || now) : null,
      scheduledFor: typeof change.scheduledFor === "string" && change.scheduledFor ? change.scheduledFor : null,
      lifecycleBlockedReason: typeof change.lifecycleBlockedReason === "string" && change.lifecycleBlockedReason ? change.lifecycleBlockedReason : null
    };
    shapedChange.applyRecovery = normalizeApplyRecovery(change.applyRecovery, shapedChange, now);
    shapedChanges[changeId] = shapedChange;

    if (shapedChange.applyRecovery?.status === "resume-required") {
      recoveredFrom.push({
        changeId,
        reason: "applying-change-requires-recovery",
        previousStatus: status || null,
        recoveredStatus: safeStatus,
        recoveryStatus: shapedChange.applyRecovery.status
      });
    }
  }

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    changes: shapedChanges,
    commandLedger,
    lifecycleSettings,
    providerContracts,
    externalHandoffs,
    historySnapshots: normalizeHistorySnapshots(persisted.historySnapshots),
    recoveredFrom
  };
}

function commandKey(command) {
  if (typeof command.idempotencyKey === "string" && command.idempotencyKey) return command.idempotencyKey;
  const boundary = boundaryFromCommand(command);
  return proofHash({
    type: command.type,
    changeId: command.changeId,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    kernelScope: command.kernelScope,
    requestedBy: command.requestedBy,
    reason: command.reason,
    providerId: command.providerId,
    handoffId: command.handoffId,
    destination: command.destination,
    handoffState: command.handoffState
  });
}

function validateCommand(rawCommand) {
  const command = asRecord(rawCommand);
  const errors = [];
  if (!KNOWN_COMMANDS.has(command.type)) errors.push("unknown-command");
  if (CHANGE_COMMANDS.has(command.type) && (typeof command.changeId !== "string" || !command.changeId)) {
    errors.push("missing-change-id");
  } else if (typeof command.changeId === "string" && command.changeId && !isSafeStorageKey(command.changeId)) {
    errors.push("unsafe-change-id");
  }
  if (typeof command.idempotencyKey === "string" && command.idempotencyKey && !isSafeStorageKey(command.idempotencyKey)) {
    errors.push("unsafe-idempotency-key");
  }
  if (command.type === "request-change" && (typeof command.reason !== "string" || !command.reason)) {
    errors.push("missing-change-reason");
  }
  if (command.type === "approve-change" && (typeof command.approvedBy !== "string" || !command.approvedBy)) {
    errors.push("missing-approval-principal");
  }
  if (command.type === "schedule-change" && (typeof command.scheduledFor !== "string" || !command.scheduledFor)) {
    errors.push("missing-scheduled-for");
  } else if (command.type === "schedule-change" && !isValidTimestamp(command.scheduledFor)) {
    errors.push("invalid-scheduled-for");
  }
  if (command.type === "configure-lifecycle-settings") {
    errors.push(...validateLifecycleSettingsPatch(command.settings));
  }
  if (command.type === "negotiate-provider-contract" && !isSafeBoundarySegment(command.providerId)) {
    errors.push("missing-provider-id");
  }
  if (command.type === "record-external-handoff" && command.handoffId && !isSafeStorageKey(command.handoffId)) {
    errors.push("unsafe-handoff-id");
  }
  if (typeof command.tenantId === "string" && command.tenantId && !isSafeBoundarySegment(command.tenantId)) {
    errors.push("unsafe-tenant-id");
  }
  if (typeof command.workspaceId === "string" && command.workspaceId && !isSafeBoundarySegment(command.workspaceId)) {
    errors.push("unsafe-workspace-id");
  }
  return { command, errors };
}

function deriveScheduleControl(change, settings, now) {
  const scheduledFor = change?.scheduledFor || null;
  const window = settings.maintenanceWindow;
  const errors = [];
  const nowToSchedule = scheduledFor ? compareTimestamps(now, scheduledFor) : null;
  const scheduleToWindowStart = scheduledFor && window?.startsAt ? compareTimestamps(scheduledFor, window.startsAt) : null;
  const scheduleToWindowEnd = scheduledFor && window?.endsAt ? compareTimestamps(scheduledFor, window.endsAt) : null;
  const nowToWindowStart = window?.startsAt ? compareTimestamps(now, window.startsAt) : null;
  const nowToWindowEnd = window?.endsAt ? compareTimestamps(now, window.endsAt) : null;

  if (scheduledFor && !isValidTimestamp(scheduledFor)) errors.push("invalid-scheduled-for");
  if (settings.applyMode === "scheduled-window" && !scheduledFor) errors.push("change-not-scheduled");
  if (settings.applyMode === "scheduled-window" && !window?.enabled) errors.push("maintenance-window-required");
  if (window && window.validation && !window.validation.valid) errors.push(...window.validation.errors);
  if (scheduledFor && window?.enabled && (scheduleToWindowStart < 0 || scheduleToWindowEnd > 0)) {
    errors.push("scheduled-change-outside-maintenance-window");
  }
  if (settings.applyMode === "scheduled-window" && scheduledFor && nowToSchedule !== null && nowToSchedule < 0) {
    errors.push("scheduled-time-not-reached");
  }
  if (settings.applyMode === "scheduled-window" && window?.enabled && nowToWindowStart !== null && nowToWindowStart < 0) {
    errors.push("maintenance-window-not-open");
  }
  if (settings.applyMode === "scheduled-window" && window?.enabled && nowToWindowEnd !== null && nowToWindowEnd > 0) {
    errors.push("maintenance-window-expired");
  }

  const runnableNow = errors.every((error) => ![
    "invalid-scheduled-for",
    "change-not-scheduled",
    "maintenance-window-required",
    "scheduled-change-outside-maintenance-window",
    "maintenance-window-expired",
    "missing-maintenance-window-start",
    "missing-maintenance-window-end",
    "invalid-maintenance-window-start",
    "invalid-maintenance-window-end",
    "maintenance-window-start-after-end"
  ].includes(error)) && !errors.includes("scheduled-time-not-reached") && !errors.includes("maintenance-window-not-open");
  const waitReasons = errors.filter((error) => ["scheduled-time-not-reached", "maintenance-window-not-open"].includes(error));
  const blockingReasons = errors.filter((error) => !waitReasons.includes(error));
  return {
    schema: SCHEDULE_CONTROL_SCHEMA,
    applyMode: settings.applyMode,
    scheduledFor,
    maintenanceWindow: window
      ? {
          enabled: window.enabled,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          label: window.label,
          validation: window.validation || { valid: true, errors: [] }
        }
      : null,
    state: !scheduledFor
      ? "unscheduled"
      : blockingReasons.length ? "blocked"
        : waitReasons.length ? "waiting"
          : "runnable-now",
    runnableNow,
    waitReasons,
    blockingReasons,
    digest: proofHash({
      schema: SCHEDULE_CONTROL_SCHEMA,
      changeId: change?.changeId || null,
      scopeKey: settings.scopeKey,
      now,
      scheduledFor,
      window,
      errors
    })
  };
}

function lifecyclePolicyErrors(command, state, current, settings, now) {
  const errors = [];
  if (!settings.enabled && ["request-change", "approve-change", "begin-apply", "schedule-change"].includes(command.type)) {
    errors.push("lifecycle-controls-disabled");
  }
  if (command.type === "approve-change" && current?.status !== "pending") {
    errors.push("approval-requires-pending-change");
  }
  if (command.type === "reject-change" && current && !ACTIVE_STATES.has(current.status)) {
    errors.push("reject-requires-active-change");
  }
  if (command.type === "begin-apply" && current?.status !== "approved") {
    errors.push("apply-requires-approved-change");
  }
  if (command.type === "record-applied" && current?.status !== "applying") {
    errors.push("record-applied-requires-applying-change");
  }
  if (command.type === "record-failed" && current?.status !== "applying") {
    errors.push("record-failed-requires-applying-change");
  }
  if (command.type === "supersede-change" && current && !ACTIVE_STATES.has(current.status)) {
    errors.push("supersede-requires-active-change");
  }
  if (command.type === "schedule-change" && current && !["pending", "approved"].includes(current.status)) {
    errors.push("schedule-requires-pending-or-approved-change");
  }
  if (command.type === "schedule-change" && compareTimestamps(now, command.scheduledFor) > 0) {
    errors.push("scheduled-time-in-past");
  }
  if (command.type === "request-change") {
    const activeInScope = Object.values(state.changes).filter((change) => change.scopeKey === settings.scopeKey && ACTIVE_STATES.has(change.status));
    if (activeInScope.length >= settings.maxActiveChanges) errors.push("lifecycle-active-change-limit");
  }
  if (command.type === "approve-change" && settings.approvalMode === "two-person" && current?.approvals?.length) {
    const approver = commandPrincipal(command).principalId;
    if (current.approvals.includes(approver)) errors.push("duplicate-two-person-approval");
  }
  if (command.type === "begin-apply" && settings.applyMode === "scheduled-window") {
    const scheduleControl = deriveScheduleControl(current, settings, now);
    errors.push(...scheduleControl.blockingReasons, ...scheduleControl.waitReasons);
  }
  if (command.type === "begin-apply" && current?.mutationPlan?.highestRisk === "critical" && !current.mutationPlan.rollbackComplete) {
    errors.push("critical-mutation-rollback-required");
  }
  if (command.type === "schedule-change" && settings.applyMode === "scheduled-window" && settings.maintenanceWindow?.enabled) {
    const candidate = { ...(current || {}), scheduledFor: command.scheduledFor };
    const scheduleControl = deriveScheduleControl(candidate, settings, now);
    if (scheduleControl.blockingReasons.includes("scheduled-change-outside-maintenance-window")) {
      errors.push("schedule-outside-maintenance-window");
    }
    errors.push(...scheduleControl.blockingReasons.filter((error) => error !== "scheduled-change-outside-maintenance-window"));
  }
  return errors;
}

function applyCommand(state, rawCommand, now) {
  const { command, errors } = validateCommand(rawCommand);
  const key = commandKey(command);
  const existingLedgerEntry = state.commandLedger[key];

  if (existingLedgerEntry) {
    return {
      state,
      audit: replayAuditFromLedger(command, key, existingLedgerEntry, now)
    };
  }

  if (errors.length) {
    const ledgerEntry = recordCommandLedger(state, key, {
      status: "rejected",
      commandType: command.type,
      changeId: command.changeId || null,
      errors
    }, now);
    return {
      state,
      audit: {
        event: "privileged-kernel-command-rejected",
        idempotencyKey: key,
        proofDigest: ledgerEntry.proofDigest,
        changeId: command.changeId || null,
        errors,
        recordedAt: now
      }
    };
  }

  const current = state.changes[command.changeId];
  const boundaryAccess = validateBoundaryAccess(command, current, now);
  const lifecycleSettings = lifecycleSettingsFor(state, boundaryAccess.boundary);
  if (boundaryAccess.errors.length) {
    const ledgerEntry = recordCommandLedger(state, key, {
      status: "rejected",
      commandType: command.type,
      changeId: command.changeId || null,
      errors: boundaryAccess.errors,
      scopeKey: boundaryAccess.boundary.scopeKey,
      principalId: boundaryAccess.principal.principalId,
      requiredPermission: boundaryAccess.requiredPermission,
      accessDecision: boundaryAccess.accessDecision
    }, now);
    return {
      state,
      audit: {
        event: "privileged-kernel-command-rejected",
        idempotencyKey: key,
        proofDigest: ledgerEntry.proofDigest,
        changeId: command.changeId,
        errors: boundaryAccess.errors,
        tenantId: boundaryAccess.boundary.tenantId,
        workspaceId: boundaryAccess.boundary.workspaceId,
        principalId: boundaryAccess.principal.principalId,
        requiredPermission: boundaryAccess.requiredPermission,
        accessDecision: boundaryAccess.accessDecision,
        recordedAt: now
      }
    };
  }

  if (command.type === "configure-lifecycle-settings" || command.type === "enable-lifecycle-controls" || command.type === "disable-lifecycle-controls") {
    const patch = command.type === "configure-lifecycle-settings" ? asRecord(command.settings) : {};
    const nextSettings = normalizeLifecycleSettings({
      ...lifecycleSettings,
      ...patch,
      enabled: command.type === "enable-lifecycle-controls" ? true : command.type === "disable-lifecycle-controls" ? false : patch.enabled ?? lifecycleSettings.enabled,
      disabledReason: command.type === "disable-lifecycle-controls"
        ? (typeof command.reason === "string" && command.reason ? command.reason : "operator-disabled")
        : command.type === "enable-lifecycle-controls" ? null : patch.disabledReason ?? lifecycleSettings.disabledReason,
      updatedAt: now,
      updatedBy: boundaryAccess.principal.principalId
    }, boundaryAccess.boundary);
    const settingsErrors = validateResolvedLifecycleSettings(nextSettings);
    if (settingsErrors.length) {
      const ledgerEntry = recordCommandLedger(state, key, {
        status: "rejected",
        commandType: command.type,
        changeId: command.changeId || null,
        errors: settingsErrors,
        scopeKey: nextSettings.scopeKey,
        principalId: boundaryAccess.principal.principalId,
        requiredPermission: boundaryAccess.requiredPermission,
        accessDecision: boundaryAccess.accessDecision
      }, now);
      return {
        state,
        audit: {
          event: "privileged-kernel-command-rejected",
          idempotencyKey: key,
          proofDigest: ledgerEntry.proofDigest,
          commandType: command.type,
          errors: settingsErrors,
          tenantId: nextSettings.tenantId,
          workspaceId: nextSettings.workspaceId,
          principalId: boundaryAccess.principal.principalId,
          requiredPermission: boundaryAccess.requiredPermission,
          accessDecision: boundaryAccess.accessDecision,
          attemptedLifecycleSettings: nextSettings,
          recordedAt: now
        }
      };
    }
    state.lifecycleSettings[boundaryAccess.boundary.scopeKey] = nextSettings;
    const ledgerEntry = recordCommandLedger(state, key, {
      status: "applied",
      commandType: command.type,
      changeId: command.changeId || null,
      scopeKey: nextSettings.scopeKey,
      principalId: boundaryAccess.principal.principalId,
      requiredPermission: boundaryAccess.requiredPermission,
      accessDecision: boundaryAccess.accessDecision
    }, now);
    return {
      state,
      audit: {
        event: "privileged-kernel-lifecycle-settings-updated",
        idempotencyKey: key,
        proofDigest: ledgerEntry.proofDigest,
        commandType: command.type,
        tenantId: nextSettings.tenantId,
        workspaceId: nextSettings.workspaceId,
        principalId: boundaryAccess.principal.principalId,
        requiredPermission: boundaryAccess.requiredPermission,
        accessDecision: boundaryAccess.accessDecision,
        enabled: nextSettings.enabled,
        approvalMode: nextSettings.approvalMode,
        applyMode: nextSettings.applyMode,
        recordedAt: now
      }
    };
  }

  if (command.type === "negotiate-provider-contract") {
    const contract = normalizeProviderContract({
      providerId: command.providerId,
      requestedCapabilities: command.requestedCapabilities,
      offeredCapabilities: command.offeredCapabilities || command.capabilities,
      sync: command.sync,
      negotiatedAt: now,
      negotiatedBy: boundaryAccess.principal.principalId
    }, boundaryAccess.boundary, now);
    state.providerContracts[contract.contractId] = contract;
    const ledgerEntry = recordCommandLedger(state, key, {
      status: contract.status,
      commandType: command.type,
      changeId: command.changeId || null,
      scopeKey: contract.scopeKey,
      principalId: boundaryAccess.principal.principalId,
      requiredPermission: boundaryAccess.requiredPermission,
      accessDecision: boundaryAccess.accessDecision
    }, now);
    return {
      state,
      audit: {
        event: "privileged-kernel-provider-contract-negotiated",
        idempotencyKey: key,
        proofDigest: ledgerEntry.proofDigest,
        providerId: contract.providerId,
        contractId: contract.contractId,
        contractStatus: contract.status,
        tenantId: contract.tenantId,
        workspaceId: contract.workspaceId,
        acceptedCapabilities: contract.acceptedCapabilities,
        missingCapabilities: contract.missingCapabilities,
        principalId: boundaryAccess.principal.principalId,
        requiredPermission: boundaryAccess.requiredPermission,
        accessDecision: boundaryAccess.accessDecision,
        recordedAt: now
      }
    };
  }

  const terminal = current && TERMINAL_STATES.has(current.status);
  if (terminal && command.type !== "request-change" && command.type !== "record-external-handoff") {
    const ledgerEntry = recordCommandLedger(state, key, {
      status: "ignored-terminal-change",
      commandType: command.type,
      changeId: command.changeId,
      changeStatus: current.status,
      scopeKey: current.scopeKey
    }, now);
    return {
      state,
      audit: {
        event: "privileged-kernel-command-ignored",
        idempotencyKey: key,
        proofDigest: ledgerEntry.proofDigest,
        changeId: command.changeId,
        reason: "change-is-terminal",
        changeStatus: current.status,
        recordedAt: now
      }
    };
  }

  const lifecycleErrors = lifecyclePolicyErrors(command, state, current, lifecycleSettings, now);
  if (lifecycleErrors.length) {
    const ledgerEntry = recordCommandLedger(state, key, {
      status: "rejected",
      commandType: command.type,
      changeId: command.changeId || null,
      errors: lifecycleErrors,
      scopeKey: lifecycleSettings.scopeKey,
      principalId: boundaryAccess.principal.principalId,
      requiredPermission: boundaryAccess.requiredPermission,
      accessDecision: boundaryAccess.accessDecision
    }, now);
    return {
      state,
      audit: {
        event: "privileged-kernel-command-rejected",
        idempotencyKey: key,
        proofDigest: ledgerEntry.proofDigest,
        changeId: command.changeId,
        errors: lifecycleErrors,
        tenantId: lifecycleSettings.tenantId,
        workspaceId: lifecycleSettings.workspaceId,
        principalId: boundaryAccess.principal.principalId,
        requiredPermission: boundaryAccess.requiredPermission,
        accessDecision: boundaryAccess.accessDecision,
        lifecycleSettings,
        recordedAt: now
      }
    };
  }

  const handoffPolicyErrors = externalHandoffPolicyErrors(command, state, current, boundaryAccess.boundary);
  if (handoffPolicyErrors.length) {
    const ledgerEntry = recordCommandLedger(state, key, {
      status: "rejected",
      commandType: command.type,
      changeId: command.changeId || null,
      errors: handoffPolicyErrors,
      scopeKey: boundaryAccess.boundary.scopeKey,
      principalId: boundaryAccess.principal.principalId,
      requiredPermission: boundaryAccess.requiredPermission,
      accessDecision: boundaryAccess.accessDecision
    }, now);
    return {
      state,
      audit: {
        event: "privileged-kernel-command-rejected",
        idempotencyKey: key,
        proofDigest: ledgerEntry.proofDigest,
        changeId: command.changeId,
        errors: handoffPolicyErrors,
        tenantId: boundaryAccess.boundary.tenantId,
        workspaceId: boundaryAccess.boundary.workspaceId,
        principalId: boundaryAccess.principal.principalId,
        requiredPermission: boundaryAccess.requiredPermission,
        accessDecision: boundaryAccess.accessDecision,
        handoffState: normalizeHandoffState(command.handoffState),
        recordedAt: now
      }
    };
  }

  let next = current;
  if (command.type === "request-change") {
    if (current) {
      const ledgerEntry = recordCommandLedger(state, key, {
        status: "ignored-existing-change",
        commandType: command.type,
        changeId: command.changeId,
        changeStatus: current.status,
        scopeKey: current.scopeKey
      }, now);
      return {
        state,
        audit: {
          event: "privileged-kernel-command-ignored",
          idempotencyKey: key,
          proofDigest: ledgerEntry.proofDigest,
          changeId: command.changeId,
          reason: "change-already-exists",
          changeStatus: current.status,
          recordedAt: now
        }
      };
    }

    next = {
      changeId: command.changeId,
      status: "pending",
      kernelScope: typeof command.kernelScope === "string" && command.kernelScope ? command.kernelScope : "hosted-kernel",
      tenantId: boundaryAccess.boundary.tenantId,
      workspaceId: boundaryAccess.boundary.workspaceId,
      scopeKey: boundaryAccess.boundary.scopeKey,
      requestedBy: boundaryAccess.principal.principalId,
      reason: command.reason,
      requestedAt: now,
      updatedAt: now,
      idempotencyKey: key,
      evidence: normalizeEvidence(command.evidence),
      mutationPlan: normalizeMutationPlan(command.mutationPlan || command.kernelMutations || command.operations, command.changeId),
      approvals: [],
      requiredPermissions: [COMMAND_PERMISSIONS["approve-change"], COMMAND_PERMISSIONS["begin-apply"], COMMAND_PERMISSIONS["record-applied"]],
      failure: null,
      scheduledFor: typeof command.scheduledFor === "string" && command.scheduledFor ? command.scheduledFor : null,
      lifecycleBlockedReason: null
    };
  } else if (!next) {
    const ledgerEntry = recordCommandLedger(state, key, {
      status: "rejected",
      commandType: command.type,
      changeId: command.changeId,
      errors: ["unknown-change"]
    }, now);
    return {
      state,
      audit: {
        event: "privileged-kernel-command-rejected",
        idempotencyKey: key,
        proofDigest: ledgerEntry.proofDigest,
        changeId: command.changeId,
        errors: ["unknown-change"],
        recordedAt: now
      }
    };
  } else if (command.type === "approve-change") {
    const requiredApprovals = lifecycleSettings.approvalMode === "two-person" ? 2 : 1;
    const approvals = Array.from(new Set([...next.approvals, boundaryAccess.principal.principalId]));
    next = {
      ...next,
      status: next.status === "pending" && approvals.length >= requiredApprovals ? "approved" : next.status,
      approvals,
      updatedAt: now
    };
  } else if (command.type === "reject-change") {
    next = { ...next, status: "rejected", updatedAt: now };
  } else if (command.type === "begin-apply") {
    const applying = next.status === "approved";
    next = {
      ...next,
      status: applying ? "applying" : next.status,
      updatedAt: now,
      applyRecovery: applying
        ? {
            schema: APPLY_RECOVERY_SCHEMA,
            status: "resume-required",
            restartSafe: false,
            reason: "apply-attempt-open",
            detectedAt: now,
            attempt: {
              attemptId: proofHash({ changeId: next.changeId, commandKey: key, startedAt: now }),
              startedAt: now,
              startedBy: boundaryAccess.principal.principalId,
              commandKey: key
            },
            resolution: {
              required: true,
              acceptedCommands: ["record-applied", "record-failed"],
              requiredPermission: COMMAND_PERMISSIONS["record-applied"]
            }
          }
        : next.applyRecovery
    };
  } else if (command.type === "schedule-change") {
    next = { ...next, scheduledFor: command.scheduledFor, lifecycleBlockedReason: null, updatedAt: now };
  } else if (command.type === "record-applied") {
    next = {
      ...next,
      status: "applied",
      evidence: normalizeEvidence([...next.evidence, ...(command.evidence || [])]),
      updatedAt: now,
      applyRecovery: {
        ...(next.applyRecovery || { schema: APPLY_RECOVERY_SCHEMA }),
        schema: APPLY_RECOVERY_SCHEMA,
        status: "operator-reconciled",
        restartSafe: true,
        reason: "record-applied",
        reconciledAt: now,
        reconciledBy: boundaryAccess.principal.principalId
      }
    };
  } else if (command.type === "record-failed") {
    next = {
      ...next,
      status: "failed",
      failure: normalizeFailureDetail({
        code: command.code,
        message: command.message,
        severity: command.severity,
        retryable: command.retryable,
        retryCount: next.failure?.retryCount,
        retryAfterSeconds: command.retryAfterSeconds,
        failedAt: now
      }, now),
      updatedAt: now,
      applyRecovery: {
        ...(next.applyRecovery || { schema: APPLY_RECOVERY_SCHEMA }),
        schema: APPLY_RECOVERY_SCHEMA,
        status: "operator-reconciled",
        restartSafe: true,
        reason: "record-failed",
        reconciledAt: now,
        reconciledBy: boundaryAccess.principal.principalId
      }
    };
  } else if (command.type === "supersede-change") {
    next = { ...next, status: "superseded", updatedAt: now };
  } else if (command.type === "record-external-handoff") {
    const handoff = normalizeExternalHandoff({
      handoffId: command.handoffId,
      changeId: command.changeId,
      destination: command.destination,
      state: command.handoffState,
      sync: command.sync,
      evidence: command.evidence,
      recordedAt: now,
      recordedBy: boundaryAccess.principal.principalId
    }, boundaryAccess.boundary, now);
    state.externalHandoffs[handoff.handoffId] = handoff;
    next = {
      ...next,
      evidence: normalizeEvidence([...next.evidence, ...handoff.evidence]),
      updatedAt: now
    };
  }

  state.changes[command.changeId] = next;
  const ledgerEntry = recordCommandLedger(state, key, {
    status: "applied",
    commandType: command.type,
    changeId: command.changeId,
    changeStatus: next.status,
    scopeKey: next.scopeKey,
    principalId: boundaryAccess.principal.principalId,
    requiredPermission: boundaryAccess.requiredPermission,
    accessDecision: boundaryAccess.accessDecision
  }, now);
  return {
    state,
    audit: {
      event: "privileged-kernel-command-applied",
      idempotencyKey: key,
      proofDigest: ledgerEntry.proofDigest,
      changeId: command.changeId,
      commandType: command.type,
      changeStatus: next.status,
      tenantId: next.tenantId,
      workspaceId: next.workspaceId,
      principalId: boundaryAccess.principal.principalId,
      requiredPermission: boundaryAccess.requiredPermission,
      accessDecision: boundaryAccess.accessDecision,
      recordedAt: now
    }
  };
}

function deriveRestartSafeStatus(state) {
  const changes = Object.values(state.changes);
  const active = changes.filter((change) => ACTIVE_STATES.has(change.status));
  const applying = active.filter((change) => change.status === "applying");
  const recoveryRequired = changes.filter((change) => change.applyRecovery?.status === "resume-required");
  const unreplayableCommandKeys = Object.entries(state.commandLedger)
    .filter(([, entry]) => entry.replaySafe === false)
    .map(([key]) => key)
    .sort();
  return {
    restartSafe: applying.length === 0 && recoveryRequired.length === 0 && unreplayableCommandKeys.length === 0,
    activeChangeCount: active.length,
    applyingChangeIds: applying.map((change) => change.changeId).sort(),
    recoveryRequiredChangeIds: recoveryRequired.map((change) => change.changeId).sort(),
    unreplayableCommandKeys,
    terminalChangeCount: changes.filter((change) => TERMINAL_STATES.has(change.status)).length,
    recoveryAction: recoveryRequired.length
      ? "reconcile-persisted-apply-attempt"
      : applying.length ? "resume-or-mark-failed-before-next-boot"
        : unreplayableCommandKeys.length ? "repair-command-ledger-before-restart" : "none"
  };
}

function deriveCommandRecoverySummary(state, audit) {
  const entries = Object.entries(state.commandLedger)
    .map(([ledgerKey, entry]) => {
      const currentChange = entry.changeId ? state.changes[entry.changeId] : null;
      const orphaned = Boolean(entry.changeId && !currentChange);
      const staleChangeStatus = Boolean(currentChange && entry.changeStatus && entry.changeStatus !== currentChange.status);
      const needsAttention = entry.replaySafe === false || orphaned || staleChangeStatus || entry.outcomeKind === "attention-required";
      return {
        ledgerKey,
        schema: COMMAND_RECOVERY_SCHEMA,
        idempotencyKey: entry.idempotencyKey || ledgerKey,
        commandType: entry.commandType,
        changeId: entry.changeId,
        status: entry.status,
        outcomeKind: entry.outcomeKind,
        replaySafe: entry.replaySafe,
        originalRecordedAt: entry.recordedAt,
        scopeKey: entry.scopeKey,
        principalId: entry.principalId,
        requiredPermission: entry.requiredPermission,
        proofDigest: entry.proofDigest,
        currentChangeStatus: currentChange?.status || null,
        orphaned,
        staleChangeStatus,
        needsAttention,
        recoveryAction: orphaned
          ? "inspect-or-prune-orphaned-command-receipt"
          : staleChangeStatus ? "review-command-receipt-status-drift"
            : entry.replaySafe === false ? "repair-command-receipt-before-replay"
              : entry.outcomeKind === "attention-required" ? "complete-provider-capability-review" : "none"
      };
    })
    .sort((left, right) => `${left.scopeKey || ""}:${left.changeId || ""}:${left.ledgerKey}`.localeCompare(
      `${right.scopeKey || ""}:${right.changeId || ""}:${right.ledgerKey}`
    ));
  const replayedDigests = new Set(
    audit
      .filter((entry) => entry.event === "privileged-kernel-command-replayed" && entry.proofDigest)
      .map((entry) => entry.proofDigest)
  );
  return {
    schema: COMMAND_RECOVERY_SCHEMA,
    ledgerEntryCount: entries.length,
    replayedCommandCount: replayedDigests.size,
    replaySafeCount: entries.filter((entry) => entry.replaySafe).length,
    deniedCount: entries.filter((entry) => entry.outcomeKind === "denied").length,
    attentionRequiredCount: entries.filter((entry) => entry.needsAttention).length,
    orphanedReceiptCount: entries.filter((entry) => entry.orphaned).length,
    staleReceiptCount: entries.filter((entry) => entry.staleChangeStatus).length,
    replayedReceiptDigests: Array.from(replayedDigests).sort(),
    attentionReceipts: entries.filter((entry) => entry.needsAttention),
    digest: proofHash({ schema: COMMAND_RECOVERY_SCHEMA, entries })
  };
}

function deriveTenantWorkspaceBoundaries(state) {
  const scopes = emptyMap();
  for (const change of Object.values(state.changes)) {
    const scopeKey = change.scopeKey || `${change.tenantId}/${change.workspaceId}`;
    const current = scopes[scopeKey] || {
      tenantId: change.tenantId,
      workspaceId: change.workspaceId,
      activeChangeIds: [],
      terminalChangeIds: [],
      approvalsRequired: 0
    };
    if (ACTIVE_STATES.has(change.status)) current.activeChangeIds.push(change.changeId);
    if (TERMINAL_STATES.has(change.status)) current.terminalChangeIds.push(change.changeId);
    if (change.status === "pending") current.approvalsRequired += 1;
    scopes[scopeKey] = current;
  }

  return Object.keys(scopes).sort().map((scopeKey) => ({
    scopeKey,
    tenantId: scopes[scopeKey].tenantId,
    workspaceId: scopes[scopeKey].workspaceId,
    activeChangeIds: scopes[scopeKey].activeChangeIds.sort(),
    terminalChangeCount: scopes[scopeKey].terminalChangeIds.length,
    approvalsRequired: scopes[scopeKey].approvalsRequired
  }));
}

function ensureWorkspaceManifest(manifests, boundary) {
  const normalized = normalizeBoundary(boundary);
  const existing = manifests[normalized.scopeKey];
  if (existing) return existing;
  const manifest = {
    schema: WORKSPACE_AUDIT_MANIFEST_SCHEMA,
    scopeKey: normalized.scopeKey,
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    changeIds: [],
    activeChangeIds: [],
    commandReceiptDigests: [],
    deniedCommandReceiptDigests: [],
    externalHandoffIds: [],
    failedHandoffIds: [],
    providerContractIds: [],
    acceptedProviderContractIds: [],
    requiredPermissions: []
  };
  manifests[normalized.scopeKey] = manifest;
  return manifest;
}

function deriveWorkspaceAuditManifests(state) {
  const manifests = emptyMap();

  for (const settings of Object.values(state.lifecycleSettings)) {
    ensureWorkspaceManifest(manifests, settings);
  }

  for (const change of Object.values(state.changes)) {
    const manifest = ensureWorkspaceManifest(manifests, change);
    manifest.changeIds.push(change.changeId);
    if (ACTIVE_STATES.has(change.status)) manifest.activeChangeIds.push(change.changeId);
    manifest.requiredPermissions.push(...change.requiredPermissions);
  }

  for (const receipt of Object.values(state.commandLedger)) {
    if (!receipt.scopeKey || !receipt.proofDigest) continue;
    const [tenantId, workspaceId] = receipt.scopeKey.split("/", 2);
    const manifest = ensureWorkspaceManifest(manifests, { tenantId, workspaceId });
    manifest.commandReceiptDigests.push(receipt.proofDigest);
    if (receipt.outcomeKind === "denied" || receipt.status === "rejected") {
      manifest.deniedCommandReceiptDigests.push(receipt.proofDigest);
    }
    if (receipt.requiredPermission) manifest.requiredPermissions.push(receipt.requiredPermission);
  }

  for (const contract of Object.values(state.providerContracts)) {
    const manifest = ensureWorkspaceManifest(manifests, contract);
    manifest.providerContractIds.push(contract.contractId);
    if (contract.status === "accepted") manifest.acceptedProviderContractIds.push(contract.contractId);
  }

  for (const handoff of Object.values(state.externalHandoffs)) {
    const manifest = ensureWorkspaceManifest(manifests, handoff);
    manifest.externalHandoffIds.push(handoff.handoffId);
    if (handoff.state === "failed") manifest.failedHandoffIds.push(handoff.handoffId);
  }

  return Object.values(manifests)
    .map((manifest) => {
      const shaped = {
        ...manifest,
        changeIds: Array.from(new Set(manifest.changeIds)).sort(),
        activeChangeIds: Array.from(new Set(manifest.activeChangeIds)).sort(),
        commandReceiptDigests: Array.from(new Set(manifest.commandReceiptDigests)).sort(),
        deniedCommandReceiptDigests: Array.from(new Set(manifest.deniedCommandReceiptDigests)).sort(),
        externalHandoffIds: Array.from(new Set(manifest.externalHandoffIds)).sort(),
        failedHandoffIds: Array.from(new Set(manifest.failedHandoffIds)).sort(),
        providerContractIds: Array.from(new Set(manifest.providerContractIds)).sort(),
        acceptedProviderContractIds: Array.from(new Set(manifest.acceptedProviderContractIds)).sort(),
        requiredPermissions: Array.from(new Set(manifest.requiredPermissions)).sort()
      };
      return {
        ...shaped,
        handoffReady: shaped.activeChangeIds.length === 0 && shaped.failedHandoffIds.length === 0 && (
          shaped.providerContractIds.length === 0 || shaped.acceptedProviderContractIds.length > 0
        ),
        deniedCommandCount: shaped.deniedCommandReceiptDigests.length,
        digest: proofHash({ schema: WORKSPACE_AUDIT_MANIFEST_SCHEMA, manifest: shaped })
      };
    })
    .sort((left, right) => left.scopeKey.localeCompare(right.scopeKey));
}

function deriveLifecycleControlSummary(state) {
  const configuredScopes = Object.keys(state.lifecycleSettings).sort();
  return configuredScopes.map((scopeKey) => {
    const settings = state.lifecycleSettings[scopeKey];
    const changes = Object.values(state.changes).filter((change) => change.scopeKey === scopeKey);
    const activeChanges = changes.filter((change) => ACTIVE_STATES.has(change.status));
    const scheduledChanges = activeChanges.filter((change) => change.scheduledFor);
    const scheduleControls = activeChanges.map((change) => deriveScheduleControl(change, settings, null));
    const lifecycleGates = activeChanges.map((change) => deriveLifecycleGate(change, settings, null));
    const scheduleBlockedCount = scheduleControls.filter((control) => control.blockingReasons.length).length;
    const scheduleWaitingCount = scheduleControls.filter((control) => control.waitReasons.length).length;
    const gateCounts = lifecycleGates.reduce((counts, gate) => {
      counts[gate.state] = (counts[gate.state] || 0) + 1;
      return counts;
    }, emptyMap());
    return {
      scopeKey,
      tenantId: settings.tenantId,
      workspaceId: settings.workspaceId,
      enabled: settings.enabled,
      disabledReason: settings.disabledReason,
      approvalMode: settings.approvalMode,
      applyMode: settings.applyMode,
      maxActiveChanges: settings.maxActiveChanges,
      activeChangeCount: activeChanges.length,
      scheduledChangeCount: scheduledChanges.length,
      scheduleBlockedCount,
      scheduleWaitingCount,
      lifecycleGateCounts: Object.fromEntries(Object.keys(gateCounts).sort().map((key) => [key, gateCounts[key]])),
      pausedChangeIds: lifecycleGates
        .filter((gate) => gate.paused)
        .map((gate) => gate.changeId)
        .sort(),
      acceptsNewChanges: settings.enabled && activeChanges.length < settings.maxActiveChanges,
      maintenanceWindow: settings.maintenanceWindow,
      schedulingControls: {
        schema: SCHEDULE_CONTROL_SCHEMA,
        applyMode: settings.applyMode,
        maintenanceWindowValid: settings.maintenanceWindow?.validation?.valid ?? true,
        unscheduledApprovedChangeIds: activeChanges
          .filter((change) => change.status === "approved" && !change.scheduledFor)
          .map((change) => change.changeId)
          .sort(),
        blockedChangeIds: activeChanges
          .filter((change) => deriveScheduleControl(change, settings, null).blockingReasons.length)
          .map((change) => change.changeId)
          .sort(),
        scheduledChangeIds: scheduledChanges.map((change) => change.changeId).sort()
      }
    };
  });
}

function deriveProviderServiceContracts(state) {
  const contracts = Object.values(state.providerContracts).sort((left, right) => left.contractId.localeCompare(right.contractId));
  const obligationsByScope = emptyMap();
  for (const change of Object.values(state.changes)) {
    if (!ACTIVE_STATES.has(change.status)) continue;
    const requiredCapabilities = mutationCapabilitiesForChange(change);
    if (!requiredCapabilities.length) continue;
    const obligation = obligationsByScope[change.scopeKey] || {
      schema: PROVIDER_CAPABILITY_OBLIGATION_SCHEMA,
      scopeKey: change.scopeKey,
      tenantId: change.tenantId,
      workspaceId: change.workspaceId,
      activeChangeIds: [],
      requiredCapabilities: [],
      blockedChangeIds: []
    };
    obligation.activeChangeIds.push(change.changeId);
    obligation.requiredCapabilities.push(...requiredCapabilities);
    obligationsByScope[change.scopeKey] = obligation;
  }

  const capabilityObligations = Object.values(obligationsByScope)
    .map((obligation) => {
      const contract = contracts.find((candidate) => candidate.scopeKey === obligation.scopeKey) || null;
      const requiredCapabilities = Array.from(new Set(obligation.requiredCapabilities)).sort();
      const missingCapabilities = contractMissingRequiredCapabilities(contract, requiredCapabilities);
      const activeChangeIds = Array.from(new Set(obligation.activeChangeIds)).sort();
      const blockedChangeIds = Object.values(state.changes)
        .filter((change) => activeChangeIds.includes(change.changeId))
        .filter((change) => contractMissingRequiredCapabilities(contract, mutationCapabilitiesForChange(change)).length)
        .map((change) => change.changeId)
        .sort();
      return {
        ...obligation,
        activeChangeIds,
        requiredCapabilities,
        contractId: contract?.contractId || null,
        providerId: contract?.providerId || null,
        contractStatus: contract?.status || "missing",
        acceptedCapabilities: contract?.acceptedCapabilities || [],
        missingCapabilities,
        blockedChangeIds,
        satisfied: missingCapabilities.length === 0,
        digest: proofHash({
          schema: PROVIDER_CAPABILITY_OBLIGATION_SCHEMA,
          scopeKey: obligation.scopeKey,
          activeChangeIds,
          requiredCapabilities,
          contractId: contract?.contractId || null,
          missingCapabilities
        })
      };
    })
    .sort((left, right) => left.scopeKey.localeCompare(right.scopeKey));
  return {
    schema: "privileged-kernel-change.provider-service-contracts.v1",
    hostedKernelCapabilities: HOSTED_KERNEL_CAPABILITIES,
    contracts,
    capabilityObligations,
    acceptedContractCount: contracts.filter((contract) => contract.status === "accepted").length,
    reviewRequiredContractCount: contracts.filter((contract) => contract.status !== "accepted").length,
    unsatisfiedCapabilityObligationCount: capabilityObligations.filter((obligation) => !obligation.satisfied).length
  };
}

function deriveExternalHandoffState(state) {
  const handoffs = Object.values(state.externalHandoffs).sort((left, right) => left.handoffId.localeCompare(right.handoffId));
  return {
    schema: "privileged-kernel-change.external-handoff-state.v1",
    handoffs,
    queuedCount: handoffs.filter((handoff) => handoff.state === "queued").length,
    failedCount: handoffs.filter((handoff) => handoff.state === "failed").length,
    readyForProviderSync: handoffs.every((handoff) => ["delivered", "acknowledged"].includes(handoff.state))
  };
}

function backoffForAttentionItem(seed, currentRetryCount = 0) {
  const retryCount = Number.isInteger(currentRetryCount) && currentRetryCount >= 0 ? currentRetryCount : 0;
  return {
    retryToken: proofHash(seed),
    retryable: retryCount < 6,
    retryCount,
    retryAfterSeconds: Math.min(30 * (2 ** retryCount), 1800),
    maxRetryCount: 6
  };
}

function deriveOperationalHealth(state, audit, nextActions, providerServiceContracts, externalHandoffState) {
  const failedChanges = Object.values(state.changes).filter((change) => change.status === "failed");
  const recoveryRequired = Object.values(state.changes).filter((change) => change.applyRecovery?.status === "resume-required");
  const failedHandoffs = externalHandoffState.handoffs.filter((handoff) => handoff.state === "failed");
  const rejectedCommands = audit.filter((entry) => entry.event === "privileged-kernel-command-rejected");
  const missingProviderScopes = Array.from(new Set(
    Object.values(state.changes)
      .filter((change) => ACTIVE_STATES.has(change.status) && providerContractForScope(providerServiceContracts, change.scopeKey)?.status !== "accepted")
      .map((change) => change.scopeKey)
  )).sort();
  const unsatisfiedCapabilityObligations = providerServiceContracts.capabilityObligations
    .filter((obligation) => !obligation.satisfied);
  const blockedActions = nextActions.filter((action) => action.blocked);
  const actionableErrors = [
    ...recoveryRequired.map((change) => ({
      code: "apply-recovery-required",
      severity: "critical",
      changeId: change.changeId,
      scopeKey: change.scopeKey,
      message: "Persisted privileged kernel apply attempt must be reconciled before restart-safe operation.",
      operatorAction: "record-applied-or-record-failed",
      requiredPermission: COMMAND_PERMISSIONS["record-applied"],
      retry: backoffForAttentionItem({ changeId: change.changeId, reason: "apply-recovery-required" }, 0)
    })),
    ...failedChanges.map((change) => ({
      code: change.failure?.code || "failed-kernel-change",
      severity: change.failure?.severity || "error",
      changeId: change.changeId,
      scopeKey: change.scopeKey,
      message: change.failure?.message || "Privileged kernel change failed.",
      operatorAction: change.failure?.nextOperatorAction || "review-failed-change",
      requiredPermission: COMMAND_PERMISSIONS["supersede-change"],
      retry: {
        retryToken: proofHash({ changeId: change.changeId, failure: change.failure }),
        retryable: change.failure?.retryable === true,
        retryCount: change.failure?.retryCount || 0,
        retryAfterSeconds: change.failure?.retryAfterSeconds,
        maxRetryCount: 6
      }
    })),
    ...failedHandoffs.map((handoff) => ({
      code: "external-handoff-failed",
      severity: "error",
      changeId: handoff.changeId,
      scopeKey: handoff.scopeKey,
      handoffId: handoff.handoffId,
      message: `External provider handoff to ${handoff.destination} failed.`,
      operatorAction: "record-external-handoff",
      requiredPermission: COMMAND_PERMISSIONS["record-external-handoff"],
      retry: backoffForAttentionItem({ handoffId: handoff.handoffId, state: handoff.state }, handoff.sync.sequence)
    })),
    ...missingProviderScopes.map((scopeKey) => ({
      code: "provider-contract-not-accepted",
      severity: "warning",
      scopeKey,
      message: "Hosted-kernel provider contract is missing or awaiting capability review.",
      operatorAction: "negotiate-provider-contract",
      requiredPermission: COMMAND_PERMISSIONS["negotiate-provider-contract"],
      retry: backoffForAttentionItem({ scopeKey, reason: "provider-contract-not-accepted" }, 0)
    })),
    ...unsatisfiedCapabilityObligations.map((obligation) => ({
      code: "provider-contract-missing-mutation-capability",
      severity: "error",
      scopeKey: obligation.scopeKey,
      message: "Accepted provider contract does not cover required hosted-kernel mutation capabilities.",
      operatorAction: "negotiate-provider-contract",
      requiredPermission: COMMAND_PERMISSIONS["negotiate-provider-contract"],
      missingCapabilities: obligation.missingCapabilities,
      blockedChangeIds: obligation.blockedChangeIds,
      retry: backoffForAttentionItem({
        scopeKey: obligation.scopeKey,
        missingCapabilities: obligation.missingCapabilities,
        reason: "provider-contract-missing-mutation-capability"
      }, 0)
    })),
    ...blockedActions.map((action) => ({
      code: action.reason || "next-action-blocked",
      severity: "warning",
      changeId: action.changeId,
      scopeKey: action.scopeKey,
      message: `Next action ${action.action} is blocked for privileged kernel change ${action.changeId}.`,
      operatorAction: action.action,
      requiredPermission: action.requiredPermission || null,
      retry: backoffForAttentionItem({ changeId: action.changeId, action: action.action, reason: action.reason }, 0)
    }))
  ];
  const criticalCount = actionableErrors.filter((error) => error.severity === "critical").length;
  const errorCount = actionableErrors.filter((error) => error.severity === "error").length;
  const degraded = criticalCount > 0 || errorCount > 0 || externalHandoffState.queuedCount > 0 || missingProviderScopes.length > 0;
  return {
    schema: OPERATIONAL_HEALTH_SCHEMA,
    health: criticalCount ? "action-required" : degraded ? "degraded" : "healthy",
    degradedMode: degraded
      ? {
          enabled: true,
          reason: criticalCount ? "critical-kernel-change-attention-required" : "kernel-change-dependency-attention-required",
          allowedCommands: ["record-applied", "record-failed", "record-external-handoff", "negotiate-provider-contract", "supersede-change"]
        }
      : { enabled: false, reason: null, allowedCommands: [] },
    actionableErrorCount: actionableErrors.length,
    criticalCount,
    errorCount,
    warningCount: actionableErrors.filter((error) => error.severity === "warning").length,
    rejectedCommandCount: rejectedCommands.length,
    providerContractMissingScopeCount: missingProviderScopes.length,
    providerCapabilityObligationBlockedCount: unsatisfiedCapabilityObligations.length,
    queuedHandoffCount: externalHandoffState.queuedCount,
    actionableErrors,
    digest: proofHash({ schema: OPERATIONAL_HEALTH_SCHEMA, actionableErrors, rejectedCommandCount: rejectedCommands.length })
  };
}

function deriveAccessDecisionSummary(state, audit) {
  const decisions = [
    ...Object.values(state.commandLedger).map((entry) => entry.accessDecision).filter(Boolean),
    ...audit.map((entry) => entry.accessDecision).filter(Boolean)
  ];
  const unique = emptyMap();
  for (const decision of decisions) {
    unique[decision.digest] = decision;
  }
  const scopedDecisions = Object.values(unique).sort((left, right) => `${left.scopeKey}:${left.requiredPermission}`.localeCompare(
    `${right.scopeKey}:${right.requiredPermission}`
  ));
  const missingScope = scopedDecisions.filter((decision) => decision.scopeRequired);
  const denied = scopedDecisions.filter((decision) => !decision.authorized);
  return {
    schema: "privileged-kernel-change.access-decision-summary.v1",
    decisionCount: scopedDecisions.length,
    authorizedCount: scopedDecisions.filter((decision) => decision.authorized).length,
    deniedCount: denied.length,
    boundaryScopeRequiredCount: missingScope.length,
    decisions: scopedDecisions.map((decision) => ({
      principalId: decision.principalId,
      requiredPermission: decision.requiredPermission,
      scopeKey: decision.scopeKey,
      authorized: decision.authorized,
      matchedGrantCount: decision.matchedGrantCount,
      scopeRequired: decision.scopeRequired,
      matchedGrantSources: decision.matchedGrants.map((grant) => grant.source).sort(),
      digest: decision.digest
    })),
    deniedScopeKeys: Array.from(new Set(denied.map((decision) => decision.scopeKey))).sort(),
    digest: proofHash({ schema: "privileged-kernel-change.access-decision-summary.v1", decisions: scopedDecisions })
  };
}

function deriveMutationPlanSummary(state) {
  const plans = Object.values(state.changes).map((change) => change.mutationPlan || normalizeMutationPlan([], change.changeId));
  const riskCounts = Object.fromEntries(Array.from(KERNEL_MUTATION_RISKS).map((risk) => [risk, 0]));
  let mutationCount = 0;
  let restartRequiredCount = 0;
  let rollbackIncompleteCount = 0;

  for (const plan of plans) {
    mutationCount += plan.mutationCount;
    riskCounts[plan.highestRisk] = (riskCounts[plan.highestRisk] || 0) + 1;
    if (plan.restartRequired) restartRequiredCount += 1;
    if (!plan.rollbackComplete) rollbackIncompleteCount += 1;
  }

  return {
    schema: "privileged-kernel-change.mutation-plan-summary.v1",
    planCount: plans.length,
    mutationCount,
    restartRequiredCount,
    rollbackIncompleteCount,
    riskCounts,
    criticalChangeIds: Object.values(state.changes)
      .filter((change) => change.mutationPlan?.highestRisk === "critical")
      .map((change) => change.changeId)
      .sort()
  };
}

function commandForLifecycleGate(change, settings, scheduleControl) {
  if (!ACTIVE_STATES.has(change.status)) return null;
  if (!settings.enabled) return "enable-lifecycle-controls";
  if (change.applyRecovery?.status === "resume-required") return "record-applied-or-failed";
  if (change.status === "pending") return "approve-change";
  if (change.status === "approved" && settings.applyMode === "scheduled-window" && !change.scheduledFor) return "schedule-change";
  if (change.status === "approved" && scheduleControl.runnableNow) return "begin-apply";
  if (change.status === "approved") return "begin-apply";
  if (change.status === "applying") return "record-applied-or-failed";
  return null;
}

function deriveLifecycleGate(change, settings, now = null) {
  const scheduleControl = deriveScheduleControl(change, settings, now);
  const reasons = [];
  if (!settings.enabled) reasons.push(settings.disabledReason || "lifecycle-controls-disabled");
  if (change.applyRecovery?.status === "resume-required") reasons.push("persisted-apply-attempt-requires-reconciliation");
  if (change.mutationPlan?.highestRisk === "critical" && !change.mutationPlan.rollbackComplete) {
    reasons.push("critical-mutation-rollback-required");
  }
  reasons.push(...scheduleControl.blockingReasons, ...scheduleControl.waitReasons);

  const state = TERMINAL_STATES.has(change.status)
    ? "terminal"
    : !settings.enabled ? "paused"
      : change.applyRecovery?.status === "resume-required" ? "recovery-required"
        : change.status === "pending" ? "approval-required"
          : change.status === "approved" && settings.applyMode === "scheduled-window" && !change.scheduledFor ? "schedule-required"
            : change.status === "approved" && scheduleControl.state === "waiting" ? "waiting-for-schedule"
              : change.status === "approved" && scheduleControl.state === "blocked" ? "blocked"
                : change.status === "approved" ? "apply-ready"
                  : change.status === "applying" ? "apply-result-required" : "unknown";
  const nextCommand = commandForLifecycleGate(change, settings, scheduleControl);
  const uniqueReasons = Array.from(new Set(reasons.filter(Boolean)));
  return {
    schema: LIFECYCLE_GATE_SCHEMA,
    changeId: change.changeId,
    scopeKey: change.scopeKey,
    state,
    open: state === "apply-ready" || state === "approval-required" || state === "schedule-required" || state === "apply-result-required",
    paused: state === "paused",
    nextCommand,
    nextCommandPermission: nextCommand && COMMAND_PERMISSIONS[nextCommand] ? COMMAND_PERMISSIONS[nextCommand] : null,
    reasons: uniqueReasons,
    scheduleState: scheduleControl.state,
    scheduleControlDigest: scheduleControl.digest,
    settingsDigest: proofHash({
      scopeKey: settings.scopeKey,
      enabled: settings.enabled,
      approvalMode: settings.approvalMode,
      applyMode: settings.applyMode,
      maxActiveChanges: settings.maxActiveChanges,
      maintenanceWindow: settings.maintenanceWindow
    }),
    digest: proofHash({
      schema: LIFECYCLE_GATE_SCHEMA,
      changeId: change.changeId,
      status: change.status,
      state,
      reasons: uniqueReasons,
      scheduleControl
    })
  };
}

function nextActionForChange(change, settings, now = null) {
  const scheduleControl = deriveScheduleControl(change, settings, now);
  const lifecycleGate = deriveLifecycleGate(change, settings, now);
  if (!settings.enabled && ACTIVE_STATES.has(change.status)) {
    return {
      action: "enable-lifecycle-controls",
      blocked: true,
      reason: settings.disabledReason || "lifecycle-controls-disabled",
      lifecycleGate,
      scheduleControl,
      requiredPermission: COMMAND_PERMISSIONS["enable-lifecycle-controls"]
    };
  }
  if (change.status === "pending") {
    const requiredApprovalCount = settings.approvalMode === "two-person" ? 2 : 1;
    return {
      action: "approve-change",
      blocked: false,
      outstandingApprovalCount: Math.max(0, requiredApprovalCount - change.approvals.length),
      lifecycleGate,
      scheduleControl,
      requiredPermission: COMMAND_PERMISSIONS["approve-change"]
    };
  }
  if (change.status === "approved" && settings.applyMode === "scheduled-window" && !change.scheduledFor) {
    return {
      action: "schedule-change",
      blocked: false,
      reason: "scheduled-window-required",
      lifecycleGate,
      scheduleControl,
      requiredPermission: COMMAND_PERMISSIONS["schedule-change"]
    };
  }
  if (change.status === "approved") {
    if (change.mutationPlan?.highestRisk === "critical" && !change.mutationPlan.rollbackComplete) {
      return {
        action: "begin-apply",
        blocked: true,
        reason: "critical-mutation-rollback-required",
        lifecycleGate,
        scheduleControl,
        requiredPermission: COMMAND_PERMISSIONS["begin-apply"]
      };
    }
    if (settings.applyMode === "scheduled-window" && !scheduleControl.runnableNow) {
      const reason = scheduleControl.blockingReasons[0] || scheduleControl.waitReasons[0] || "scheduled-window-not-ready";
      return {
        action: "begin-apply",
        blocked: true,
        reason,
        actionState: scheduleControl.state === "waiting" ? "waiting-for-schedule" : "blocked-by-schedule",
        lifecycleGate,
        scheduleControl,
        requiredPermission: COMMAND_PERMISSIONS["begin-apply"]
      };
    }
    return {
      action: "begin-apply",
      blocked: settings.applyMode === "scheduled-window" && !settings.maintenanceWindow?.enabled,
      reason: settings.applyMode === "scheduled-window" && !settings.maintenanceWindow?.enabled ? "maintenance-window-required" : null,
      actionState: "ready",
      lifecycleGate,
      scheduleControl,
      requiredPermission: COMMAND_PERMISSIONS["begin-apply"]
    };
  }
  if (change.status === "applying") {
    if (change.applyRecovery?.status === "resume-required") {
      return {
        action: "record-applied-or-failed",
        blocked: true,
        reason: "persisted-apply-attempt-requires-reconciliation",
        recovery: change.applyRecovery,
        lifecycleGate,
        scheduleControl,
        requiredPermission: COMMAND_PERMISSIONS["record-applied"]
      };
    }
    return {
      action: "record-applied-or-failed",
      blocked: false,
      lifecycleGate,
      scheduleControl,
      requiredPermission: COMMAND_PERMISSIONS["record-applied"]
    };
  }
  return {
    action: "none",
    blocked: false,
    lifecycleGate,
    scheduleControl,
    terminal: TERMINAL_STATES.has(change.status)
  };
}

function deriveNextActions(state, now) {
  return Object.values(state.changes)
    .filter((change) => ACTIVE_STATES.has(change.status))
    .sort((left, right) => left.changeId.localeCompare(right.changeId))
    .map((change) => {
      const settings = lifecycleSettingsFor(state, normalizeBoundary(change));
      return {
        changeId: change.changeId,
        scopeKey: change.scopeKey,
        status: change.status,
        scheduledFor: change.scheduledFor,
        ...nextActionForChange(change, settings, now)
      };
    });
}

function providerContractForScope(providerServiceContracts, scopeKey) {
  return providerServiceContracts.contracts.find((contract) => contract.scopeKey === scopeKey) || null;
}

function providerCapabilityObligationForScope(providerServiceContracts, scopeKey) {
  return (providerServiceContracts.capabilityObligations || []).find((obligation) => obligation.scopeKey === scopeKey) || null;
}

function deriveHandoffProgressForChange(change, externalHandoffState) {
  const records = externalHandoffState.handoffs.filter((handoff) => handoff.changeId === change.changeId);
  const acknowledged = records.filter((handoff) => handoff.state === "acknowledged");
  const failed = records.filter((handoff) => handoff.state === "failed");
  const queued = records.filter((handoff) => handoff.state === "queued");
  const delivered = records.filter((handoff) => handoff.state === "delivered");
  return {
    handoffCount: records.length,
    acknowledgedCount: acknowledged.length,
    failedCount: failed.length,
    queuedCount: queued.length,
    deliveredCount: delivered.length,
    latestHandoffId: records.at(-1)?.handoffId || null,
    readyForRuntimeResume: failed.length === 0 && queued.length === 0,
    providerAcknowledged: acknowledged.length > 0
  };
}

function buildClientStatePatch(change, nextAction, settings, contract, handoffProgress) {
  const blocked = Boolean(nextAction.blocked || handoffProgress.failedCount);
  const providerContractStatus = contract?.status || "missing";
  const lifecycleGate = nextAction.lifecycleGate || deriveLifecycleGate(change, settings, null);
  const handoffStatus = handoffProgress.failedCount
    ? "failed"
    : handoffProgress.queuedCount ? "queued" : handoffProgress.providerAcknowledged ? "acknowledged" : "not-recorded";
  return {
    schema: CLIENT_RUNTIME_HANDOFF_SCHEMA,
    requestKey: proofHash({
      changeId: change.changeId,
      status: change.status,
      nextAction: nextAction.action,
      providerContractStatus,
      handoffStatus
    }),
    changeId: change.changeId,
    scope: {
      tenantId: change.tenantId,
      workspaceId: change.workspaceId,
      scopeKey: change.scopeKey
    },
    visibleStatus: blocked ? "blocked" : nextAction.action === "none" ? "complete" : "actionable",
    changeStatus: change.status,
    providerContractStatus,
    handoffStatus,
    lifecycleMode: {
      approvalMode: settings.approvalMode,
      applyMode: settings.applyMode
    },
    lifecycleGate,
    scheduleControl: nextAction.scheduleControl || deriveScheduleControl(change, settings, null),
    nextAction: nextAction.action,
    nextActionState: nextAction.actionState || lifecycleGate.state,
    requiredPermission: nextAction.requiredPermission || null,
    mutationPlanDigest: change.mutationPlan?.digest || null,
    proofDigest: proofHash({
      changeId: change.changeId,
      status: change.status,
      mutationPlan: change.mutationPlan,
      providerContractStatus,
      handoffProgress
    })
  };
}

function deriveClientRuntimeHandoff(state, nextActions, providerServiceContracts, externalHandoffState, now) {
  const nextActionByChange = Object.fromEntries(nextActions.map((action) => [action.changeId, action]));
  const entries = Object.values(state.changes)
    .filter((change) => ACTIVE_STATES.has(change.status))
    .sort((left, right) => `${left.scopeKey}:${left.changeId}`.localeCompare(`${right.scopeKey}:${right.changeId}`))
    .map((change) => {
      const settings = lifecycleSettingsFor(state, normalizeBoundary(change));
      const nextAction = nextActionByChange[change.changeId] || nextActionForChange(change, settings, now);
      const contract = providerContractForScope(providerServiceContracts, change.scopeKey);
      const capabilityObligation = providerCapabilityObligationForScope(providerServiceContracts, change.scopeKey);
      const handoffProgress = deriveHandoffProgressForChange(change, externalHandoffState);
      const needsProviderContract = !contract || contract.status !== "accepted";
      const missingMutationCapabilities = contractMissingRequiredCapabilities(contract, mutationCapabilitiesForChange(change));
      const shouldOfferExternalHandoff = ["approved", "applying"].includes(change.status)
        && !handoffProgress.providerAcknowledged
        && !handoffProgress.queuedCount
        && !handoffProgress.failedCount
        && !missingMutationCapabilities.length;
      const blockingReasons = [
        ...(nextAction.blocked ? [nextAction.reason || "next-action-blocked"] : []),
        ...(needsProviderContract ? ["provider-contract-not-accepted"] : []),
        ...(missingMutationCapabilities.length ? ["provider-contract-missing-mutation-capability"] : []),
        ...(handoffProgress.failedCount ? ["external-handoff-failed"] : [])
      ];
      const workflowCommands = [];
      if (needsProviderContract || missingMutationCapabilities.length) {
        workflowCommands.push({
          type: "negotiate-provider-contract",
          tenantId: change.tenantId,
          workspaceId: change.workspaceId,
          providerId: contract?.providerId || "hosted-kernel-provider",
          requestedCapabilities: Array.from(new Set([
            ...HOSTED_KERNEL_CAPABILITIES,
            ...mutationCapabilitiesForChange(change)
          ])).sort()
        });
      }
      if (shouldOfferExternalHandoff) {
        workflowCommands.push({
          type: "record-external-handoff",
          changeId: change.changeId,
          tenantId: change.tenantId,
          workspaceId: change.workspaceId,
          destination: contract?.providerId || "external-kernel-provider",
          handoffState: "queued"
        });
      }
      if (!blockingReasons.length && nextAction.action !== "none" && nextAction.action !== "record-applied-or-failed") {
        workflowCommands.push({
          type: nextAction.action,
          changeId: change.changeId,
          tenantId: change.tenantId,
          workspaceId: change.workspaceId
        });
      }
      return {
        schema: CLIENT_RUNTIME_HANDOFF_SCHEMA,
        handoffKey: proofHash({ changeId: change.changeId, nextAction, contract, handoffProgress }),
        changeId: change.changeId,
        scopeKey: change.scopeKey,
        clientStatePatch: buildClientStatePatch(change, nextAction, settings, contract, handoffProgress),
        blockingReasons,
        workflowCommands,
        handoffProgress,
        capabilityObligation,
        providerContract: contract
          ? {
              contractId: contract.contractId,
              providerId: contract.providerId,
              status: contract.status,
              acceptedCapabilities: contract.acceptedCapabilities,
              missingCapabilities: contract.missingCapabilities
            }
          : null
      };
    });
  return {
    schema: CLIENT_RUNTIME_HANDOFF_SCHEMA,
    entries,
    actionableCount: entries.filter((entry) => entry.workflowCommands.length && entry.blockingReasons.length === 0).length,
    blockedCount: entries.filter((entry) => entry.blockingReasons.length).length,
    providerContractRequiredCount: entries.filter((entry) => entry.blockingReasons.includes("provider-contract-not-accepted")).length,
    externalHandoffAttentionCount: entries.filter((entry) => entry.handoffProgress.failedCount || entry.handoffProgress.queuedCount).length,
    digest: proofHash({ schema: CLIENT_RUNTIME_HANDOFF_SCHEMA, entries })
  };
}

function normalizeClientRuntimeRequest(input = {}) {
  const source = asRecord(input.clientRuntimeState || input.requestContext || input.clientRequest);
  const boundary = normalizeBoundary(source);
  const visibleChangeIds = uniqueStrings(source.visibleChangeIds || source.openChangeIds).filter(isSafeStorageKey);
  const acknowledgedProofDigests = uniqueStrings(source.acknowledgedProofDigests || source.seenProofDigests);
  const selectedChangeId = isSafeStorageKey(source.selectedChangeId) ? source.selectedChangeId : visibleChangeIds[0] || null;
  const maxVisibleChanges = Number.isInteger(source.maxVisibleChanges) && source.maxVisibleChanges > 0
    ? Math.min(source.maxVisibleChanges, 25)
    : 10;
  return {
    schema: `${CLIENT_WORKFLOW_HANDOFF_SCHEMA}.request`,
    clientId: safeLabel(source.clientId, "anonymous-client", 100),
    routeId: safeLabel(source.routeId || source.route, "kernel-change-console", 100),
    surfaceMode: ["operator", "auditor", "provider"].includes(source.surfaceMode) ? source.surfaceMode : "operator",
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    scopeKey: boundary.scopeKey,
    selectedChangeId,
    visibleChangeIds,
    acknowledgedProofDigests,
    maxVisibleChanges
  };
}

function commandLabel(commandType) {
  const labels = {
    "approve-change": "Approve privileged change",
    "begin-apply": "Begin hosted-kernel apply",
    "schedule-change": "Schedule maintenance apply",
    "record-applied": "Record apply success",
    "record-failed": "Record apply failure",
    "record-external-handoff": "Queue provider handoff",
    "negotiate-provider-contract": "Negotiate provider contract",
    "enable-lifecycle-controls": "Enable lifecycle controls",
    "supersede-change": "Supersede blocked change",
    "reject-change": "Reject privileged change"
  };
  return labels[commandType] || `Run ${commandType}`;
}

function buildClientCommandQueueItem(entry, command, index) {
  const commandType = typeof command?.type === "string" ? command.type : "unknown-command";
  const changeId = command?.changeId || entry.changeId || null;
  const scopeKey = entry.scopeKey || (
    command?.tenantId && command?.workspaceId ? `${command.tenantId}/${command.workspaceId}` : null
  );
  return {
    schema: `${CLIENT_WORKFLOW_HANDOFF_SCHEMA}.command-queue-item`,
    queueKey: proofHash({ handoffKey: entry.handoffKey, command, index }),
    label: commandLabel(commandType),
    command,
    commandType,
    changeId,
    scopeKey,
    requiredPermission: COMMAND_PERMISSIONS[commandType] || null,
    blocked: entry.blockingReasons.length > 0,
    blockingReasons: entry.blockingReasons,
    proofDigest: proofHash({
      schema: `${CLIENT_WORKFLOW_HANDOFF_SCHEMA}.command-queue-item`,
      handoffKey: entry.handoffKey,
      command,
      blockingReasons: entry.blockingReasons
    })
  };
}

function deriveClientWorkflowHandoff(input, clientRuntimeHandoff, operatorPreview, now) {
  const request = normalizeClientRuntimeRequest(input);
  const entriesInScope = clientRuntimeHandoff.entries.filter((entry) => entry.clientStatePatch.scope.scopeKey === request.scopeKey);
  const requestedVisibleIds = new Set(request.visibleChangeIds);
  const visibleEntries = (requestedVisibleIds.size
    ? entriesInScope.filter((entry) => requestedVisibleIds.has(entry.changeId))
    : entriesInScope
  ).slice(0, request.maxVisibleChanges);
  const selectedEntry = visibleEntries.find((entry) => entry.changeId === request.selectedChangeId)
    || visibleEntries[0]
    || null;
  const currentProofDigests = visibleEntries
    .map((entry) => entry.clientStatePatch.proofDigest)
    .filter(Boolean)
    .sort();
  const acknowledged = new Set(request.acknowledgedProofDigests);
  const unacknowledgedProofDigests = currentProofDigests.filter((digest) => !acknowledged.has(digest));
  const staleAcknowledgementDigests = request.acknowledgedProofDigests
    .filter((digest) => !currentProofDigests.includes(digest))
    .sort();
  const commandQueue = visibleEntries.flatMap((entry) => (
    entry.workflowCommands.map((command, index) => buildClientCommandQueueItem(entry, command, index))
  )).sort((left, right) => `${left.blocked}:${left.scopeKey || ""}:${left.changeId || ""}:${left.commandType}`.localeCompare(
    `${right.blocked}:${right.scopeKey || ""}:${right.changeId || ""}:${right.commandType}`
  ));
  const previewByChange = Object.fromEntries(operatorPreview.cards.map((card) => [card.changeId, card]));
  const selectedPreview = selectedEntry ? previewByChange[selectedEntry.changeId] || null : null;
  const blockedVisibleEntries = visibleEntries.filter((entry) => entry.blockingReasons.length);
  const readyVisibleEntries = visibleEntries.filter((entry) => entry.workflowCommands.length && !entry.blockingReasons.length);
  const clientStatePatch = {
    schema: `${CLIENT_WORKFLOW_HANDOFF_SCHEMA}.client-state-patch`,
    clientId: request.clientId,
    routeId: request.routeId,
    surfaceMode: request.surfaceMode,
    scopeKey: request.scopeKey,
    selectedChangeId: selectedEntry?.changeId || null,
    visibleChangeIds: visibleEntries.map((entry) => entry.changeId),
    attentionBadgeCount: blockedVisibleEntries.length + unacknowledgedProofDigests.length,
    pendingCommandCount: commandQueue.filter((item) => !item.blocked).length,
    blockedCommandCount: commandQueue.filter((item) => item.blocked).length,
    staleAcknowledgementCount: staleAcknowledgementDigests.length,
    lastUpdatedAt: now,
    proofDigest: proofHash({
      schema: `${CLIENT_WORKFLOW_HANDOFF_SCHEMA}.client-state-patch`,
      request,
      visible: currentProofDigests,
      commandQueue: commandQueue.map((item) => item.proofDigest)
    })
  };
  return {
    schema: CLIENT_WORKFLOW_HANDOFF_SCHEMA,
    generatedAt: now,
    request,
    selectedChange: selectedEntry
      ? {
          changeId: selectedEntry.changeId,
          status: selectedEntry.clientStatePatch.changeStatus,
          visibleStatus: selectedEntry.clientStatePatch.visibleStatus,
          nextAction: selectedEntry.clientStatePatch.nextAction,
          nextActionState: selectedEntry.clientStatePatch.nextActionState,
          readinessFailedCount: selectedPreview?.acceptance?.explainableNextStep?.readinessFailedCount || 0,
          proofDigest: selectedEntry.clientStatePatch.proofDigest
        }
      : null,
    visibleEntryCount: visibleEntries.length,
    readyWorkflowCount: readyVisibleEntries.length,
    blockedWorkflowCount: blockedVisibleEntries.length,
    commandQueue,
    clientStatePatch,
    unacknowledgedProofDigests,
    staleAcknowledgementDigests,
    resumeMode: staleAcknowledgementDigests.length
      ? "refresh-client-cache"
      : unacknowledgedProofDigests.length ? "acknowledge-new-runtime-proof" : "resume-current-state",
    digest: proofHash({
      schema: CLIENT_WORKFLOW_HANDOFF_SCHEMA,
      request,
      selectedChangeId: selectedEntry?.changeId || null,
      visibleProofDigests: currentProofDigests,
      commandQueue: commandQueue.map((item) => item.proofDigest),
      staleAcknowledgementDigests
    })
  };
}

function readinessChecksForChange(change, settings, externalHandoffState, providerServiceContracts, now) {
  const checks = [];
  const requiredApprovalCount = settings.approvalMode === "two-person" ? 2 : 1;
  const scheduleControl = deriveScheduleControl(change, settings, now);
  const contract = providerContractForScope(providerServiceContracts, change.scopeKey);
  const requiredMutationCapabilities = mutationCapabilitiesForChange(change);
  const missingMutationCapabilities = contractMissingRequiredCapabilities(contract, requiredMutationCapabilities);
  checks.push({
    check: "lifecycle-controls-enabled",
    passed: settings.enabled,
    reason: settings.enabled ? null : settings.disabledReason || "lifecycle-controls-disabled"
  });
  checks.push({
    check: "approval-threshold-met",
    passed: change.approvals.length >= requiredApprovalCount,
    current: change.approvals.length,
    required: requiredApprovalCount
  });
  checks.push({
    check: "scheduled-window-satisfied",
    passed: settings.applyMode !== "scheduled-window" || scheduleControl.runnableNow,
    reason: settings.applyMode === "scheduled-window"
      ? scheduleControl.blockingReasons[0] || scheduleControl.waitReasons[0] || null
      : null,
    scheduleState: scheduleControl.state,
    scheduleControl
  });
  checks.push({
    check: "external-provider-sync-ready",
    passed: externalHandoffState.readyForProviderSync,
    queuedCount: externalHandoffState.queuedCount,
    failedCount: externalHandoffState.failedCount
  });
  checks.push({
    check: "provider-mutation-capabilities-ready",
    passed: missingMutationCapabilities.length === 0,
    providerId: contract?.providerId || null,
    contractStatus: contract?.status || "missing",
    requiredCapabilities: requiredMutationCapabilities,
    missingCapabilities: missingMutationCapabilities,
    reason: missingMutationCapabilities.length ? "provider-contract-missing-mutation-capability" : null
  });
  checks.push({
    check: "mutation-plan-present",
    passed: Boolean(change.mutationPlan?.mutationCount),
    mutationCount: change.mutationPlan?.mutationCount || 0,
    reason: change.mutationPlan?.mutationCount ? null : "missing-mutation-plan"
  });
  checks.push({
    check: "critical-mutation-rollback-ready",
    passed: change.mutationPlan?.highestRisk !== "critical" || change.mutationPlan.rollbackComplete,
    highestRisk: change.mutationPlan?.highestRisk || "low",
    rollbackMissingCount: change.mutationPlan?.rollbackMissingCount || 0,
    reason: change.mutationPlan?.highestRisk === "critical" && !change.mutationPlan.rollbackComplete
      ? "critical-mutation-rollback-required"
      : null
  });
  checks.push({
    check: "restart-recovery-clear",
    passed: change.applyRecovery?.status !== "resume-required",
    reason: change.applyRecovery?.status === "resume-required" ? "persisted-apply-attempt-requires-reconciliation" : null,
    recoveryStatus: change.applyRecovery?.status || "none"
  });
  return checks;
}

function commandForReadinessBlock(change, check, settings) {
  if (check.passed) return null;
  if (check.check === "lifecycle-controls-enabled") {
    return {
      type: "enable-lifecycle-controls",
      tenantId: change.tenantId,
      workspaceId: change.workspaceId
    };
  }
  if (check.check === "approval-threshold-met") {
    return {
      type: "approve-change",
      changeId: change.changeId,
      tenantId: change.tenantId,
      workspaceId: change.workspaceId
    };
  }
  if (check.check === "scheduled-window-satisfied" && settings.applyMode === "scheduled-window") {
    return {
      type: "schedule-change",
      changeId: change.changeId,
      tenantId: change.tenantId,
      workspaceId: change.workspaceId,
      scheduledFor: settings.maintenanceWindow?.startsAt || change.scheduledFor || null
    };
  }
  if (check.check === "provider-mutation-capabilities-ready") {
    return {
      type: "negotiate-provider-contract",
      tenantId: change.tenantId,
      workspaceId: change.workspaceId,
      providerId: check.providerId || "hosted-kernel-provider",
      requestedCapabilities: Array.from(new Set([
        ...HOSTED_KERNEL_CAPABILITIES,
        ...(check.requiredCapabilities || [])
      ])).sort()
    };
  }
  if (check.check === "restart-recovery-clear") {
    return {
      type: "record-failed",
      changeId: change.changeId,
      tenantId: change.tenantId,
      workspaceId: change.workspaceId,
      code: "operator-reconciled-after-restart"
    };
  }
  if (check.check === "critical-mutation-rollback-ready") {
    return {
      type: "supersede-change",
      changeId: change.changeId,
      tenantId: change.tenantId,
      workspaceId: change.workspaceId
    };
  }
  return null;
}

function phaseForReadinessCheck(check) {
  if (check.check.includes("provider") || check.check.includes("external")) return "provider-sync";
  if (check.check.includes("approval")) return "approval";
  if (check.check.includes("scheduled")) return "scheduling";
  if (check.check.includes("mutation") || check.check.includes("rollback")) return "mutation-plan";
  if (check.check.includes("recovery")) return "recovery";
  return "lifecycle";
}

function buildExplainableNextStep(change, nextAction, settings, checks) {
  const failedChecks = checks.filter((check) => !check.passed);
  const remediation = failedChecks.map((check) => {
    const command = commandForReadinessBlock(change, check, settings);
    return {
      phase: phaseForReadinessCheck(check),
      check: check.check,
      reason: check.reason || check.check,
      requiredPermission: command?.type ? COMMAND_PERMISSIONS[command.type] || null : null,
      command,
      displayHint: command
        ? `Resolve ${check.check} with ${command.type}`
        : `Resolve ${check.check} before accepting this privileged kernel change`
    };
  });
  const primaryRemediation = remediation.find((item) => item.command) || remediation[0] || null;
  const acceptanceCommand = nextAction.action && nextAction.action !== "none" && nextAction.action !== "record-applied-or-failed"
    ? {
        type: nextAction.action,
        changeId: change.changeId,
        tenantId: change.tenantId,
        workspaceId: change.workspaceId
      }
    : null;
  const blocked = Boolean(nextAction.blocked || failedChecks.length);
  return {
    schema: EXPLAINABLE_NEXT_STEP_SCHEMA,
    changeId: change.changeId,
    scopeKey: change.scopeKey,
    status: change.status,
    phase: blocked ? primaryRemediation?.phase || "blocked" : phaseForReadinessCheck({ check: nextAction.action || "complete" }),
    label: blocked
      ? `Resolve ${primaryRemediation?.reason || nextAction.reason || "blocked readiness"}`
      : nextAction.action === "none" ? "No next operator step" : `Continue with ${nextAction.action}`,
    state: blocked ? "blocked" : nextAction.action === "none" ? "complete" : "ready",
    explainableReasons: Array.from(new Set([
      ...(nextAction.reason ? [nextAction.reason] : []),
      ...failedChecks.map((check) => check.reason || check.check)
    ])).sort(),
    requiredPermission: blocked
      ? primaryRemediation?.requiredPermission || nextAction.requiredPermission || null
      : nextAction.requiredPermission || null,
    primaryCommand: blocked ? primaryRemediation?.command || null : acceptanceCommand,
    remediation,
    readinessPassedCount: checks.filter((check) => check.passed).length,
    readinessFailedCount: failedChecks.length,
    proofDigest: proofHash({
      schema: EXPLAINABLE_NEXT_STEP_SCHEMA,
      changeId: change.changeId,
      status: change.status,
      nextAction: nextAction.action,
      failedChecks: failedChecks.map((check) => [check.check, check.reason || null]),
      primaryCommand: blocked ? primaryRemediation?.command || null : acceptanceCommand
    })
  };
}

function buildAcceptanceContract(change, nextAction, settings, checks) {
  const blockingReasons = checks.filter((check) => !check.passed).map((check) => check.reason || check.check);
  const canAccept = ACTIVE_STATES.has(change.status) && !nextAction.blocked && blockingReasons.length === 0;
  const explainableNextStep = buildExplainableNextStep(change, nextAction, settings, checks);
  return {
    schema: ACCEPTANCE_SCHEMA,
    changeId: change.changeId,
    acceptLabel: nextAction.action === "none" ? "No operator action available" : `Accept ${nextAction.action}`,
    canAccept,
    blockingReasons,
    requiredPermission: nextAction.requiredPermission || null,
    mutationPlanDigest: change.mutationPlan?.digest || null,
    mutationRisk: change.mutationPlan?.highestRisk || "low",
    expectedCommand: canAccept && nextAction.action !== "record-applied-or-failed"
      ? {
          type: nextAction.action,
          changeId: change.changeId,
          tenantId: change.tenantId,
          workspaceId: change.workspaceId
        }
      : null,
    rejectCommand: ACTIVE_STATES.has(change.status)
      ? {
          type: "reject-change",
          changeId: change.changeId,
          tenantId: change.tenantId,
          workspaceId: change.workspaceId
        }
      : null,
    lifecycleMode: {
      approvalMode: settings.approvalMode,
      applyMode: settings.applyMode
    },
    explainableNextStep,
    acceptanceProofDigest: proofHash({
      schema: ACCEPTANCE_SCHEMA,
      changeId: change.changeId,
      canAccept,
      blockingReasons,
      expectedCommand: explainableNextStep.primaryCommand,
      nextStepDigest: explainableNextStep.proofDigest
    })
  };
}

function deriveOperatorPreview(state, nextActions, externalHandoffState, providerServiceContracts, now) {
  const nextActionByChange = Object.fromEntries(nextActions.map((action) => [action.changeId, action]));
  const cards = Object.values(state.changes)
    .sort((left, right) => `${left.scopeKey}:${left.changeId}`.localeCompare(`${right.scopeKey}:${right.changeId}`))
    .map((change) => {
      const settings = lifecycleSettingsFor(state, normalizeBoundary(change));
      const nextAction = nextActionByChange[change.changeId] || nextActionForChange(change, settings, now);
      const readinessChecks = readinessChecksForChange(change, settings, externalHandoffState, providerServiceContracts, now);
      const acceptance = buildAcceptanceContract(change, nextAction, settings, readinessChecks);
      return {
        schema: PREVIEW_SCHEMA,
        changeId: change.changeId,
        title: `${change.kernelScope} privileged change`,
        status: change.status,
        scopeKey: change.scopeKey,
        reason: change.reason,
        requestedBy: change.requestedBy,
        requestedAt: change.requestedAt,
        scheduledFor: change.scheduledFor,
        applyRecovery: change.applyRecovery,
        mutationPlan: change.mutationPlan,
        evidenceCount: change.evidence.length,
        readinessChecks,
        nextStep: nextAction,
        nextStepContract: acceptance.explainableNextStep,
        acceptance
      };
    });
  const nextStepContracts = cards.map((card) => card.nextStepContract);
  return {
    schema: PREVIEW_SCHEMA,
    cards,
    pendingAcceptanceCount: cards.filter((card) => card.acceptance.canAccept).length,
    blockedAcceptanceCount: cards.filter((card) => ACTIVE_STATES.has(card.status) && !card.acceptance.canAccept).length,
    nextStepContracts,
    nextStepStateCounts: {
      ready: nextStepContracts.filter((step) => step.state === "ready").length,
      blocked: nextStepContracts.filter((step) => step.state === "blocked").length,
      complete: nextStepContracts.filter((step) => step.state === "complete").length
    },
    nextStepProofDigest: proofHash({ schema: EXPLAINABLE_NEXT_STEP_SCHEMA, nextStepContracts })
  };
}

function deriveValidationSummary(state, audit, operatorPreview) {
  const rejectedErrors = audit.flatMap((entry) => Array.isArray(entry.errors) ? entry.errors : []);
  const blockedReasons = operatorPreview.cards.flatMap((card) => card.acceptance.blockingReasons);
  const missingEvidenceChangeIds = operatorPreview.cards
    .filter((card) => ACTIVE_STATES.has(card.status) && card.evidenceCount === 0)
    .map((card) => card.changeId);
  const failedHandoffIds = Object.values(state.externalHandoffs)
    .filter((handoff) => handoff.state === "failed")
    .map((handoff) => handoff.handoffId)
    .sort();
  const recoveryRequiredChangeIds = Object.values(state.changes)
    .filter((change) => change.applyRecovery?.status === "resume-required")
    .map((change) => change.changeId)
    .sort();
  const missingMutationPlanChangeIds = Object.values(state.changes)
    .filter((change) => ACTIVE_STATES.has(change.status) && !change.mutationPlan?.mutationCount)
    .map((change) => change.changeId)
    .sort();
  const rollbackBlockedChangeIds = Object.values(state.changes)
    .filter((change) => change.mutationPlan?.highestRisk === "critical" && !change.mutationPlan.rollbackComplete)
    .map((change) => change.changeId)
    .sort();
  const capabilityBlockedChangeIds = operatorPreview.cards
    .filter((card) => card.readinessChecks.some((check) => check.check === "provider-mutation-capabilities-ready" && !check.passed))
    .map((card) => card.changeId)
    .sort();
  const issues = [
    ...Array.from(new Set(rejectedErrors)).map((reason) => ({ severity: "error", reason })),
    ...Array.from(new Set(blockedReasons)).map((reason) => ({ severity: "warning", reason })),
    ...missingEvidenceChangeIds.map((changeId) => ({ severity: "warning", reason: "missing-change-evidence", changeId })),
    ...failedHandoffIds.map((handoffId) => ({ severity: "error", reason: "external-handoff-failed", handoffId })),
    ...missingMutationPlanChangeIds.map((changeId) => ({ severity: "warning", reason: "missing-mutation-plan", changeId })),
    ...rollbackBlockedChangeIds.map((changeId) => ({ severity: "error", reason: "critical-mutation-rollback-required", changeId })),
    ...capabilityBlockedChangeIds.map((changeId) => ({ severity: "error", reason: "provider-contract-missing-mutation-capability", changeId })),
    ...recoveryRequiredChangeIds.map((changeId) => ({
      severity: "error",
      reason: "persisted-apply-attempt-requires-reconciliation",
      changeId
    }))
  ];
  return {
    schema: VALIDATION_SCHEMA,
    valid: issues.filter((issue) => issue.severity === "error").length === 0,
    issueCount: issues.length,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    issues
  };
}

function deriveReadinessSummary(state, status, operatorPreview, validationSummary, providerServiceContracts, externalHandoffState) {
  const activeCards = operatorPreview.cards.filter((card) => ACTIVE_STATES.has(card.status));
  const acceptanceReadyChangeIds = activeCards
    .filter((card) => card.acceptance.canAccept)
    .map((card) => card.changeId)
    .sort();
  const activeNextSteps = activeCards.map((card) => card.nextStepContract).filter(Boolean);
  const blockedNextSteps = activeNextSteps.filter((step) => step.state === "blocked");
  const recommendedCommands = activeNextSteps
    .map((step) => ({
      changeId: step.changeId,
      scopeKey: step.scopeKey,
      state: step.state,
      phase: step.phase,
      reason: step.explainableReasons[0] || null,
      command: step.primaryCommand,
      requiredPermission: step.requiredPermission,
      proofDigest: step.proofDigest
    }))
    .filter((step) => step.command)
    .sort((left, right) => `${left.state}:${left.phase}:${left.changeId}`.localeCompare(`${right.state}:${right.phase}:${right.changeId}`));
  return {
    schema: READINESS_SCHEMA,
    restartSafe: status.restartSafe,
    validationReady: validationSummary.valid,
    acceptanceReadyChangeIds,
    nextStepReadyCount: activeNextSteps.filter((step) => step.state === "ready").length,
    nextStepBlockedCount: blockedNextSteps.length,
    blockedNextStepReasons: Array.from(new Set(blockedNextSteps.flatMap((step) => step.explainableReasons))).sort(),
    recommendedCommands,
    providerSyncReady: providerServiceContracts.reviewRequiredContractCount === 0
      && providerServiceContracts.unsatisfiedCapabilityObligationCount === 0
      && externalHandoffState.readyForProviderSync,
    exportReady: status.activeChangeCount === 0 && validationSummary.errorCount === 0,
    nextStepHint: acceptanceReadyChangeIds.length
      ? "operator-acceptance-available"
      : recommendedCommands.length ? "run-recommended-next-step-command"
        : validationSummary.errorCount ? "resolve-validation-errors" : status.restartSafe ? "ready" : status.recoveryAction,
    explainableNextStepDigest: proofHash({
      schema: EXPLAINABLE_NEXT_STEP_SCHEMA,
      activeNextSteps,
      recommendedCommands
    })
  };
}

function deriveAnalyticsCounters(state, audit) {
  const changes = Object.values(state.changes);
  const statusCounts = Object.fromEntries([...ACTIVE_STATES, ...TERMINAL_STATES].map((status) => [status, 0]));
  const commandOutcomes = emptyMap();
  const permissionUse = emptyMap();
  const scopeActivity = emptyMap();
  let evidenceAttachmentCount = 0;
  let failureCount = 0;
  let scheduledChangeCount = 0;
  let privilegedMutationCount = 0;
  let restartRequiredMutationPlanCount = 0;
  let rollbackIncompletePlanCount = 0;

  for (const change of changes) {
    statusCounts[change.status] = (statusCounts[change.status] || 0) + 1;
    evidenceAttachmentCount += change.evidence.length;
    if (change.failure) failureCount += 1;
    if (change.scheduledFor) scheduledChangeCount += 1;
    privilegedMutationCount += change.mutationPlan?.mutationCount || 0;
    if (change.mutationPlan?.restartRequired) restartRequiredMutationPlanCount += 1;
    if (change.mutationPlan && !change.mutationPlan.rollbackComplete) rollbackIncompletePlanCount += 1;

    const scopeKey = change.scopeKey || `${change.tenantId}/${change.workspaceId}`;
    const scope = scopeActivity[scopeKey] || {
      scopeKey,
      tenantId: change.tenantId,
      workspaceId: change.workspaceId,
      activeCount: 0,
      terminalCount: 0,
      pendingApprovalCount: 0,
      failedCount: 0
    };
    if (ACTIVE_STATES.has(change.status)) scope.activeCount += 1;
    if (TERMINAL_STATES.has(change.status)) scope.terminalCount += 1;
    if (change.status === "pending") scope.pendingApprovalCount += 1;
    if (change.status === "failed") scope.failedCount += 1;
    scopeActivity[scopeKey] = scope;
  }

  for (const ledgerEntry of Object.values(state.commandLedger)) {
    const outcome = typeof ledgerEntry.status === "string" && ledgerEntry.status ? ledgerEntry.status : "unknown";
    commandOutcomes[outcome] = (commandOutcomes[outcome] || 0) + 1;
    if (typeof ledgerEntry.requiredPermission === "string" && ledgerEntry.requiredPermission) {
      permissionUse[ledgerEntry.requiredPermission] = (permissionUse[ledgerEntry.requiredPermission] || 0) + 1;
    }
  }

  return {
    totalChangeCount: changes.length,
    activeChangeCount: changes.filter((change) => ACTIVE_STATES.has(change.status)).length,
    terminalChangeCount: changes.filter((change) => TERMINAL_STATES.has(change.status)).length,
    failureCount,
    scheduledChangeCount,
    privilegedMutationCount,
    restartRequiredMutationPlanCount,
    rollbackIncompletePlanCount,
    lifecycleDisabledScopeCount: Object.values(state.lifecycleSettings).filter((settings) => !settings.enabled).length,
    providerContractCount: Object.keys(state.providerContracts).length,
    externalHandoffCount: Object.keys(state.externalHandoffs).length,
    evidenceAttachmentCount,
    statusCounts,
    commandOutcomes: Object.fromEntries(Object.keys(commandOutcomes).sort().map((key) => [key, commandOutcomes[key]])),
    permissionUse: Object.fromEntries(Object.keys(permissionUse).sort().map((key) => [key, permissionUse[key]])),
    scopeActivity: Object.keys(scopeActivity).sort().map((scopeKey) => scopeActivity[scopeKey]),
    auditEventCount: audit.length,
    rejectedCommandCount: audit.filter((entry) => entry.event === "privileged-kernel-command-rejected").length,
    replayedCommandCount: audit.filter((entry) => entry.event === "privileged-kernel-command-replayed").length,
    boundaryViolationCount: audit.filter((entry) => Array.isArray(entry.errors) && entry.errors.some((error) => error.includes("boundary"))).length
  };
}

function buildTimeline(state, audit) {
  const changeEvents = Object.values(state.changes).flatMap((change) => [
    {
      at: change.requestedAt,
      event: "change-requested",
      changeId: change.changeId,
      status: "pending",
      scopeKey: change.scopeKey,
      actor: change.requestedBy
    },
    {
      at: change.updatedAt,
      event: `change-${change.status}`,
      changeId: change.changeId,
      status: change.status,
      scopeKey: change.scopeKey,
      actor: change.approvals.at(-1) || change.requestedBy
    }
  ]);
  const auditEvents = audit.map((entry) => ({
    at: entry.recordedAt || null,
    event: entry.event,
    changeId: entry.changeId || null,
    status: entry.changeStatus || entry.status || null,
    scopeKey: entry.tenantId && entry.workspaceId ? `${entry.tenantId}/${entry.workspaceId}` : null,
    actor: entry.principalId || null
  }));

  return [...changeEvents, ...auditEvents]
    .filter((entry) => entry.at)
    .sort((left, right) => `${left.at}:${left.event}:${left.changeId || ""}`.localeCompare(`${right.at}:${right.event}:${right.changeId || ""}`))
    .slice(-TIMELINE_EVENT_LIMIT);
}

function buildAnalyticsSnapshot(state, audit, now) {
  const counters = deriveAnalyticsCounters(state, audit);
  const digest = proofHash({ generatedAt: now, counters });
  return {
    snapshotId: digest,
    generatedAt: now,
    activeChangeCount: counters.activeChangeCount,
    terminalChangeCount: counters.terminalChangeCount,
    boundaryViolationCount: counters.boundaryViolationCount,
    rejectedCommandCount: counters.rejectedCommandCount,
    failureCount: counters.failureCount,
    exportReady: counters.activeChangeCount === 0 && counters.rejectedCommandCount === 0,
    digest,
    counters: {
      statusCounts: counters.statusCounts,
      commandOutcomes: counters.commandOutcomes,
      scopeActivity: counters.scopeActivity.map((scope) => ({
        scopeKey: scope.scopeKey,
        activeCount: scope.activeCount,
        terminalCount: scope.terminalCount,
        pendingApprovalCount: scope.pendingApprovalCount,
        failedCount: scope.failedCount
      }))
    }
  };
}

function numericDelta(current, previous, key) {
  const currentValue = Number.isInteger(current?.[key]) ? current[key] : 0;
  const previousValue = Number.isInteger(previous?.[key]) ? previous[key] : 0;
  return currentValue - previousValue;
}

function deriveScopeHistoryDeltas(currentSnapshot, previousSnapshot) {
  const currentScopes = Object.fromEntries((currentSnapshot.counters.scopeActivity || []).map((scope) => [scope.scopeKey, scope]));
  const previousScopes = Object.fromEntries((previousSnapshot?.counters?.scopeActivity || []).map((scope) => [scope.scopeKey, scope]));
  return Array.from(new Set([...Object.keys(currentScopes), ...Object.keys(previousScopes)]))
    .sort()
    .map((scopeKey) => {
      const current = currentScopes[scopeKey] || {};
      const previous = previousScopes[scopeKey] || {};
      return {
        scopeKey,
        activeDelta: numericDelta(current, previous, "activeCount"),
        terminalDelta: numericDelta(current, previous, "terminalCount"),
        pendingApprovalDelta: numericDelta(current, previous, "pendingApprovalCount"),
        failedDelta: numericDelta(current, previous, "failedCount"),
        currentlyBlocked: Boolean((current.pendingApprovalCount || 0) || (current.failedCount || 0))
      };
    })
    .filter((scope) => scope.activeDelta || scope.terminalDelta || scope.pendingApprovalDelta || scope.failedDelta || scope.currentlyBlocked);
}

function deriveAnalyticsHistoryReport(historySnapshots, currentSnapshot, now) {
  const snapshots = [...historySnapshots, currentSnapshot].slice(-HISTORY_SNAPSHOT_LIMIT);
  const previousSnapshot = snapshots.length > 1 ? snapshots.at(-2) : null;
  const statusDeltas = Object.fromEntries(
    [...ACTIVE_STATES, ...TERMINAL_STATES].map((status) => [
      status,
      numericDelta(currentSnapshot.counters.statusCounts, previousSnapshot?.counters?.statusCounts, status)
    ])
  );
  const commandOutcomeDeltas = Object.fromEntries(
    Array.from(new Set([
      ...Object.keys(currentSnapshot.counters.commandOutcomes || {}),
      ...Object.keys(previousSnapshot?.counters?.commandOutcomes || {})
    ])).sort().map((outcome) => [
      outcome,
      numericDelta(currentSnapshot.counters.commandOutcomes, previousSnapshot?.counters?.commandOutcomes, outcome)
    ])
  );
  const activeDelta = previousSnapshot ? currentSnapshot.activeChangeCount - previousSnapshot.activeChangeCount : currentSnapshot.activeChangeCount;
  const rejectedDelta = previousSnapshot ? currentSnapshot.rejectedCommandCount - previousSnapshot.rejectedCommandCount : currentSnapshot.rejectedCommandCount;
  const failureDelta = previousSnapshot ? currentSnapshot.failureCount - previousSnapshot.failureCount : currentSnapshot.failureCount;
  const boundaryViolationDelta = previousSnapshot
    ? currentSnapshot.boundaryViolationCount - previousSnapshot.boundaryViolationCount
    : currentSnapshot.boundaryViolationCount;
  const exportReadyStreak = snapshots.slice().reverse().findIndex((snapshot) => !snapshot.exportReady);
  return {
    schema: ANALYTICS_HISTORY_REPORT_SCHEMA,
    generatedAt: now,
    currentSnapshotId: currentSnapshot.snapshotId,
    previousSnapshotId: previousSnapshot?.snapshotId || null,
    snapshotCount: snapshots.length,
    exportReadySnapshotCount: snapshots.filter((snapshot) => snapshot.exportReady).length,
    exportReadyStreak: exportReadyStreak === -1 ? snapshots.length : exportReadyStreak,
    trend: activeDelta > 0 || rejectedDelta > 0 || failureDelta > 0 || boundaryViolationDelta > 0
      ? "attention-increased"
      : activeDelta < 0 && rejectedDelta <= 0 && failureDelta <= 0 ? "risk-decreased" : "stable",
    deltas: {
      activeChangeCount: activeDelta,
      terminalChangeCount: previousSnapshot ? currentSnapshot.terminalChangeCount - previousSnapshot.terminalChangeCount : currentSnapshot.terminalChangeCount,
      rejectedCommandCount: rejectedDelta,
      failureCount: failureDelta,
      boundaryViolationCount: boundaryViolationDelta,
      statusCounts: statusDeltas,
      commandOutcomes: commandOutcomeDeltas,
      scopeActivity: deriveScopeHistoryDeltas(currentSnapshot, previousSnapshot)
    },
    digest: proofHash({ schema: ANALYTICS_HISTORY_REPORT_SCHEMA, snapshots, currentSnapshot })
  };
}

function buildHistoryTrendSeries(historySnapshots, currentSnapshot) {
  const snapshots = [...historySnapshots, currentSnapshot].slice(-HISTORY_SNAPSHOT_LIMIT);
  return snapshots.map((snapshot, index) => {
    const previous = index > 0 ? snapshots[index - 1] : null;
    const activeDelta = previous ? snapshot.activeChangeCount - previous.activeChangeCount : snapshot.activeChangeCount;
    const rejectedDelta = previous ? snapshot.rejectedCommandCount - previous.rejectedCommandCount : snapshot.rejectedCommandCount;
    const failureDelta = previous ? snapshot.failureCount - previous.failureCount : snapshot.failureCount;
    const boundaryViolationDelta = previous
      ? snapshot.boundaryViolationCount - previous.boundaryViolationCount
      : snapshot.boundaryViolationCount;
    const attentionDelta = activeDelta + rejectedDelta + failureDelta + boundaryViolationDelta;
    return {
      snapshotId: snapshot.snapshotId,
      generatedAt: snapshot.generatedAt,
      exportReady: snapshot.exportReady,
      activeChangeCount: snapshot.activeChangeCount,
      rejectedCommandCount: snapshot.rejectedCommandCount,
      failureCount: snapshot.failureCount,
      boundaryViolationCount: snapshot.boundaryViolationCount,
      deltas: {
        activeChangeCount: activeDelta,
        rejectedCommandCount: rejectedDelta,
        failureCount: failureDelta,
        boundaryViolationCount: boundaryViolationDelta,
        attentionScore: attentionDelta
      },
      trend: attentionDelta > 0 ? "attention-increased" : attentionDelta < 0 ? "attention-decreased" : "unchanged",
      digest: proofHash({
        schema: `${ANALYTICS_HISTORY_REPORT_SCHEMA}.trend-sample`,
        snapshotId: snapshot.snapshotId,
        previousSnapshotId: previous?.snapshotId || null,
        activeDelta,
        rejectedDelta,
        failureDelta,
        boundaryViolationDelta
      })
    };
  });
}

function buildScopeExportSummaries(state, audit, analyticsCounters, operationalHealth) {
  const scopeKeys = new Set([
    ...analyticsCounters.scopeActivity.map((scope) => scope.scopeKey),
    ...Object.values(state.lifecycleSettings).map((settings) => settings.scopeKey),
    ...Object.values(state.providerContracts).map((contract) => contract.scopeKey),
    ...Object.values(state.externalHandoffs).map((handoff) => handoff.scopeKey)
  ]);
  const attentionByScope = operationalHealth.actionableErrors.reduce((map, error) => {
    const scopeKey = error.scopeKey || null;
    if (!scopeKey) return map;
    if (!map[scopeKey]) map[scopeKey] = [];
    map[scopeKey].push({
      code: error.code,
      severity: error.severity,
      changeId: error.changeId || null,
      handoffId: error.handoffId || null,
      operatorAction: error.operatorAction || null
    });
    return map;
  }, emptyMap());

  return Array.from(scopeKeys)
    .filter(Boolean)
    .sort()
    .map((scopeKey) => {
      const changes = Object.values(state.changes).filter((change) => change.scopeKey === scopeKey);
      const receipts = Object.values(state.commandLedger).filter((entry) => entry.scopeKey === scopeKey);
      const contracts = Object.values(state.providerContracts).filter((contract) => contract.scopeKey === scopeKey);
      const handoffs = Object.values(state.externalHandoffs).filter((handoff) => handoff.scopeKey === scopeKey);
      const auditEvents = audit.filter((entry) => (
        entry.tenantId && entry.workspaceId ? `${entry.tenantId}/${entry.workspaceId}` === scopeKey : entry.scopeKey === scopeKey
      ));
      const scopeActivity = analyticsCounters.scopeActivity.find((scope) => scope.scopeKey === scopeKey) || {
        activeCount: 0,
        terminalCount: 0,
        pendingApprovalCount: 0,
        failedCount: 0
      };
      const deniedReceiptDigests = receipts
        .filter((entry) => entry.outcomeKind === "denied" || entry.status === "rejected")
        .map((entry) => entry.proofDigest)
        .filter(Boolean)
        .sort();
      const attentionItems = (attentionByScope[scopeKey] || []).sort((left, right) => `${left.severity}:${left.code}`.localeCompare(`${right.severity}:${right.code}`));
      const readyForExport = scopeActivity.activeCount === 0
        && scopeActivity.pendingApprovalCount === 0
        && scopeActivity.failedCount === 0
        && deniedReceiptDigests.length === 0
        && attentionItems.filter((item) => item.severity !== "warning").length === 0;
      const [tenantId, workspaceId] = scopeKey.split("/", 2);
      const summary = {
        schema: SCOPE_EXPORT_SCHEMA,
        scopeKey,
        tenantId,
        workspaceId,
        readyForExport,
        changeIds: changes.map((change) => change.changeId).sort(),
        activeChangeIds: changes.filter((change) => ACTIVE_STATES.has(change.status)).map((change) => change.changeId).sort(),
        terminalChangeCount: changes.filter((change) => TERMINAL_STATES.has(change.status)).length,
        commandReceiptCount: receipts.length,
        deniedCommandReceiptDigests: deniedReceiptDigests,
        providerContractIds: contracts.map((contract) => contract.contractId).sort(),
        acceptedProviderContractCount: contracts.filter((contract) => contract.status === "accepted").length,
        externalHandoffIds: handoffs.map((handoff) => handoff.handoffId).sort(),
        failedExternalHandoffCount: handoffs.filter((handoff) => handoff.state === "failed").length,
        auditEventCount: auditEvents.length,
        attentionItems
      };
      return {
        ...summary,
        blockedReasons: [
          ...(scopeActivity.activeCount ? ["active-changes-present"] : []),
          ...(scopeActivity.pendingApprovalCount ? ["pending-approvals-present"] : []),
          ...(scopeActivity.failedCount ? ["failed-changes-present"] : []),
          ...(deniedReceiptDigests.length ? ["denied-command-receipts-present"] : []),
          ...(attentionItems.some((item) => item.severity !== "warning") ? ["actionable-errors-present"] : [])
        ],
        digest: proofHash({ schema: SCOPE_EXPORT_SCHEMA, summary })
      };
    });
}

function buildReportingTimelineState(timeline, analyticsSnapshot, operationalHealth, now) {
  const eventCounts = emptyMap();
  const scopeCounts = emptyMap();
  for (const entry of timeline) {
    eventCounts[entry.event] = (eventCounts[entry.event] || 0) + 1;
    if (entry.scopeKey) scopeCounts[entry.scopeKey] = (scopeCounts[entry.scopeKey] || 0) + 1;
  }
  const attentionEvents = timeline.filter((entry) => (
    entry.event.includes("rejected") || entry.event.includes("failed") || entry.status === "failed" || entry.status === "rejected"
  ));
  return {
    schema: REPORTING_TIMELINE_SCHEMA,
    generatedAt: now,
    cursor: proofHash({ first: timeline[0] || null, last: timeline.at(-1) || null, snapshotId: analyticsSnapshot.snapshotId }),
    firstEventAt: timeline[0]?.at || null,
    lastEventAt: timeline.at(-1)?.at || null,
    timelineWindowSize: timeline.length,
    attentionEventCount: attentionEvents.length,
    latestAttentionEvent: attentionEvents.at(-1) || null,
    eventCounts: Object.fromEntries(Object.keys(eventCounts).sort().map((key) => [key, eventCounts[key]])),
    scopeEventCounts: Object.fromEntries(Object.keys(scopeCounts).sort().map((key) => [key, scopeCounts[key]])),
    exportWatermark: {
      snapshotId: analyticsSnapshot.snapshotId,
      operationalHealth: operationalHealth.health,
      actionableErrorCount: operationalHealth.actionableErrorCount
    },
    digest: proofHash({ schema: REPORTING_TIMELINE_SCHEMA, timeline, analyticsSnapshot, operationalHealth })
  };
}

function buildExportSummary(state, auditHandoff, analytics, timeline, reportingTimeline, scopeExportSummaries, now) {
  const blockedScopes = analytics.counters.scopeActivity
    .filter((scope) => scope.pendingApprovalCount || scope.failedCount)
    .map((scope) => ({
      scopeKey: scope.scopeKey,
      pendingApprovalCount: scope.pendingApprovalCount,
      failedCount: scope.failedCount
    }));

  return {
    exportId: proofHash({ surfaceId, generatedAt: now, analyticsDigest: analytics.snapshot.digest, auditHandoffId: auditHandoff.handoffId }),
    schema: EXPORT_SCHEMA,
    generatedAt: now,
    destination: "hosted-kernel-reporting",
    recordCount: analytics.counters.totalChangeCount,
    timelineEventCount: timeline.length,
    reportingTimelineCursor: reportingTimeline.cursor,
    attentionEventCount: reportingTimeline.attentionEventCount,
    statusCounts: analytics.counters.statusCounts,
    commandOutcomes: analytics.counters.commandOutcomes,
    scheduledChangeCount: analytics.counters.scheduledChangeCount,
    lifecycleDisabledScopeCount: analytics.counters.lifecycleDisabledScopeCount,
    analyticsTrend: analytics.historyReport.trend,
    exportReadyStreak: analytics.historyReport.exportReadyStreak,
    blockedScopes,
    scopeExportSummaryCount: scopeExportSummaries.length,
    scopeReadyForExportCount: scopeExportSummaries.filter((scope) => scope.readyForExport).length,
    scopeBlockedForExportCount: scopeExportSummaries.filter((scope) => !scope.readyForExport).length,
    scopeExportDigests: scopeExportSummaries.map((scope) => scope.digest).sort(),
    auditHandoffId: auditHandoff.handoffId,
    readyForExport: blockedScopes.length === 0 && analytics.snapshot.exportReady && scopeExportSummaries.every((scope) => scope.readyForExport)
  };
}

function buildAuditHandoff(
  state,
  audit,
  now,
  operatorPreview = null,
  validationSummary = null,
  readinessSummary = null,
  clientRuntimeHandoff = null,
  accessDecisionSummary = null,
  operationalHealth = null,
  analyticsHistoryReport = null,
  reportingTimeline = null,
  scopeExportSummaries = null,
  commandRecovery = null,
  clientWorkflowHandoff = null
) {
  const appliedEvents = audit.filter((entry) => entry.event === "privileged-kernel-command-applied");
  const workspaceAuditManifests = deriveWorkspaceAuditManifests(state);
  return {
    handoffId: proofHash({ surfaceId, generatedAt: now, audit }),
    generatedAt: now,
    destination: "hosted-kernel-audit-ledger",
    schema: "privileged-kernel-change.audit-handoff.v1",
    tenantWorkspaceBoundaries: deriveTenantWorkspaceBoundaries(state),
    workspaceAuditManifests,
    lifecycleControls: deriveLifecycleControlSummary(state),
    mutationPlanSummary: deriveMutationPlanSummary(state),
    providerServiceContracts: deriveProviderServiceContracts(state),
    externalHandoffState: deriveExternalHandoffState(state),
    operatorPreview,
    validationSummary,
    readinessSummary,
    clientRuntimeHandoff,
    clientWorkflowHandoff,
    accessDecisionSummary,
    operationalHealth,
    analyticsHistoryReport,
    reportingTimeline,
    scopeExportSummaries,
    commandRecovery,
    appliedEventCount: appliedEvents.length,
    rejectedEventCount: audit.filter((entry) => entry.event === "privileged-kernel-command-rejected").length,
    boundaryViolationCount: audit.filter((entry) => Array.isArray(entry.errors) && entry.errors.some((error) => error.includes("boundary"))).length,
    workspaceManifestCount: workspaceAuditManifests.length,
    deniedWorkspaceCount: workspaceAuditManifests.filter((manifest) => manifest.deniedCommandCount > 0).length,
    handoffReadyWorkspaceCount: workspaceAuditManifests.filter((manifest) => manifest.handoffReady).length
  };
}

export function describePrivilegedKernelChangeSurface(input = {}) {
  const now = isoNow(input);
  const state = normalizeState(input, now);
  const audit = [];

  if (state.recoveredFrom.length) {
    audit.push({
      event: "privileged-kernel-state-recovered",
      recoveredCount: state.recoveredFrom.length,
      recoveredFrom: state.recoveredFrom,
      recordedAt: now
    });
  }

  const commands = Array.isArray(input.commands) ? input.commands : [];
  for (const command of commands) {
    const result = applyCommand(state, command, now);
    audit.push(result.audit);
  }

  const status = deriveRestartSafeStatus(state);
  const commandRecovery = deriveCommandRecoverySummary(state, audit);
  const nextActions = deriveNextActions(state, now);
  const lifecycleControls = deriveLifecycleControlSummary(state);
  const providerServiceContracts = deriveProviderServiceContracts(state);
  const externalHandoffState = deriveExternalHandoffState(state);
  const mutationPlanSummary = deriveMutationPlanSummary(state);
  const accessDecisionSummary = deriveAccessDecisionSummary(state, audit);
  const operatorPreview = deriveOperatorPreview(state, nextActions, externalHandoffState, providerServiceContracts, now);
  const validationSummary = deriveValidationSummary(state, audit, operatorPreview);
  const operationalHealth = deriveOperationalHealth(
    state,
    audit,
    nextActions,
    providerServiceContracts,
    externalHandoffState
  );
  const readinessSummary = deriveReadinessSummary(
    state,
    status,
    operatorPreview,
    validationSummary,
    providerServiceContracts,
    externalHandoffState
  );
  const clientRuntimeHandoff = deriveClientRuntimeHandoff(
    state,
    nextActions,
    providerServiceContracts,
    externalHandoffState,
    now
  );
  const clientWorkflowHandoff = deriveClientWorkflowHandoff(
    input,
    clientRuntimeHandoff,
    operatorPreview,
    now
  );
  const timeline = buildTimeline(state, audit);
  const analyticsSnapshot = buildAnalyticsSnapshot(state, audit, now);
  const historySnapshots = [...state.historySnapshots, analyticsSnapshot].slice(-HISTORY_SNAPSHOT_LIMIT);
  const historyReport = deriveAnalyticsHistoryReport(state.historySnapshots, analyticsSnapshot, now);
  const historyTrendSeries = buildHistoryTrendSeries(state.historySnapshots, analyticsSnapshot);
  const reportingTimeline = buildReportingTimelineState(timeline, analyticsSnapshot, operationalHealth, now);
  const analyticsCounters = deriveAnalyticsCounters(state, audit);
  const scopeExportSummaries = buildScopeExportSummaries(state, audit, analyticsCounters, operationalHealth);
  const auditHandoff = buildAuditHandoff(
    state,
    audit,
    now,
    operatorPreview,
    validationSummary,
    readinessSummary,
    clientRuntimeHandoff,
    accessDecisionSummary,
    operationalHealth,
    historyReport,
    reportingTimeline,
    scopeExportSummaries,
    commandRecovery,
    clientWorkflowHandoff
  );
  const analytics = {
    schema: "privileged-kernel-change.analytics.v1",
    generatedAt: now,
    counters: analyticsCounters,
    snapshot: analyticsSnapshot,
    history: historySnapshots,
    historyReport,
    historyTrendSeries,
    reportingTimeline,
    scopeExportSummaries
  };
  const exportSummary = buildExportSummary(state, auditHandoff, analytics, timeline, reportingTimeline, scopeExportSummaries, now);
  const proof = {
    surfaceId,
    schemaVersion: state.schemaVersion,
    generatedAt: now,
    stateDigest: proofHash({
      changes: state.changes,
      commandLedger: state.commandLedger,
      lifecycleSettings: state.lifecycleSettings,
      restartSafe: status.restartSafe,
      lifecycleControls,
      nextActions,
      operatorPreview,
      validationSummary,
      readinessSummary,
      mutationPlanSummary,
      providerServiceContracts,
      externalHandoffState,
      clientRuntimeHandoff,
      clientWorkflowHandoff,
      accessDecisionSummary,
      operationalHealth,
      commandRecovery,
      auditHandoff,
      analyticsSnapshot,
      historyReport,
      historyTrendSeries,
      reportingTimeline,
      scopeExportSummaries,
      exportSummary
    }),
    commandCount: commands.length,
    auditCount: audit.length,
    boundaryCount: auditHandoff.tenantWorkspaceBoundaries.length,
    analyticsDigest: analyticsSnapshot.digest,
    historyReportDigest: historyReport.digest,
    reportingTimelineDigest: reportingTimeline.digest,
    scopeExportDigest: proofHash({ schema: SCOPE_EXPORT_SCHEMA, scopeExportSummaries }),
    exportId: exportSummary.exportId
  };

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel privileged change state.v1",
    status,
    commandRecovery,
    lifecycleControls,
    nextActions,
    operatorPreview,
    clientRuntimeHandoff,
    clientWorkflowHandoff,
    operationalHealth,
    validationSummary,
    readinessSummary,
    mutationPlanSummary,
    accessDecisionSummary,
    persistedState: {
      schemaVersion: state.schemaVersion,
      changes: state.changes,
      commandLedger: state.commandLedger,
      lifecycleSettings: state.lifecycleSettings,
      providerContracts: state.providerContracts,
      externalHandoffs: state.externalHandoffs,
      historySnapshots
    },
    audit,
    auditHandoff,
    providerServiceContracts,
    externalHandoffState,
    analytics,
    timeline,
    exportSummary,
    proof,
    evidence: normalizeEvidence(input.evidence)
  };
}

export default describePrivilegedKernelChangeSurface;
