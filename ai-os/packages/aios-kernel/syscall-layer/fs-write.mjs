export const surfaceId = "aios_syscall-layer_fs-write_023";
export const surfaceGroup = "syscall-layer";
export const surfaceName = "fs-write";

const DEFAULT_PROVIDER = {
  id: "hosted-kernel.fs-write.provider",
  protocol: "aios.fs.write.v1",
  durability: "hosted-kernel-journal",
  capabilities: [
    "fs.write",
    "fs.write.atomic",
    "fs.write.artifact",
    "fs.write.audit",
    "fs.write.external-handoff",
    "fs.write.product",
    "fs.write.workspace",
    "fs.write.sync-metadata"
  ]
};

const WRITE_CONTRACT_VERSION = "aios.fs-write.contract.v1";
const DEFAULT_REQUESTED_CAPABILITIES = ["fs.write", "fs.write.audit", "fs.write.sync-metadata"];
const EXTERNAL_HANDOFF_STATES = new Set(["not-required", "ready", "deferred", "blocked"]);
const LIFECYCLE_COMMANDS = new Set(["prepare", "validate", "commit", "pause", "resume", "disable", "enable", "cancel"]);
const WRITE_MODES = new Set(["enabled", "disabled", "paused", "drain"]);
const SCHEDULE_POLICIES = new Set(["immediate", "queued", "maintenance-window"]);
const PROVIDER_SERVICE_LEVELS = new Set(["standard", "interactive", "bulk", "read-only"]);
const PROVIDER_WRITE_MODES = new Set(["read-write", "append-only", "read-only"]);
const PRODUCT_SYNC_AUTHORITIES = new Set(["provider", "client-workflow", "product-registry"]);
const PRODUCT_SYNC_CONFLICT_STRATEGIES = new Set(["provider-lock", "optimistic-revision", "workflow-ack"]);
const CLIENT_SURFACES = new Set(["command-palette", "file-editor", "agent-runner", "settings-panel", "api-client"]);
const WORKFLOW_HANDOFF_CHANNELS = new Set(["client", "integration", "platform", "scheduler"]);
const ACCEPTANCE_DECISIONS = new Set(["pending", "accepted", "rejected"]);
const HANDOFF_ACK_STATES = new Set(["not-required", "pending", "accepted", "rejected", "expired"]);
const HANDOFF_DELIVERY_GUARANTEES = new Set(["at-most-once", "at-least-once", "exactly-once"]);
const TENANT_ISOLATION_MODES = new Set(["strict", "workspace-bound", "delegated"]);
const CONTENT_HASH_ALGORITHMS = new Set(["sha256", "sha384", "sha512", "blake3", "etag", "unknown"]);
const CONTENT_ENCODINGS = new Set(["utf8", "base64", "binary", "opaque"]);
const WRITE_TARGET_KINDS = new Set(["artifact", "product", "workspace"]);
const TARGET_CAPABILITY_REQUIREMENTS = {
  artifact: ["fs.write.artifact"],
  product: ["fs.write.product", "fs.write.sync-metadata"],
  workspace: ["fs.write.workspace"]
};
const TARGET_PERMISSION_REQUIREMENTS = {
  artifact: ["fs.write.artifact"],
  product: ["fs.write.product"],
  workspace: ["fs.write.workspace"]
};
const HEALTH_CIRCUIT_STATES = new Set(["closed", "open", "half-open"]);
const DEGRADED_MODE_CAPABILITIES = new Set([
  "queue-only",
  "metadata-only",
  "audit-delayed",
  "external-handoff-only"
]);
const PERSISTED_STATE_PHASES = new Set([
  "new",
  "prepared",
  "queued",
  "committing",
  "committed",
  "failed",
  "cancelled",
  "recovered"
]);
const PERSISTED_STATE_REPLAYABLE_PHASES = new Set(["prepared", "queued", "committing", "failed", "recovered"]);
const PERSISTED_STATE_TERMINAL_PHASES = new Set(["committed", "cancelled"]);
const PERSISTED_COMMAND_TARGET_PHASE = {
  prepare: "prepared",
  validate: "prepared",
  commit: "committing",
  pause: "queued",
  resume: "queued",
  disable: "cancelled",
  enable: "prepared",
  cancel: "cancelled"
};
const PERSISTED_PHASE_STABILITY = {
  new: "volatile",
  prepared: "stable",
  queued: "stable",
  committing: "in-flight",
  committed: "terminal",
  failed: "operator-review",
  cancelled: "terminal",
  recovered: "stable"
};
const PERSISTED_RECOVERY_ROUTES = {
  "already-committed": "fs.write.acknowledge-committed",
  cancelled: "fs.write.acknowledge-cancelled",
  current: "fs.write.continue",
  "manual-review": "fs.write.recovery.review",
  recoverable: "fs.write.recover",
  "stale-fingerprint": "fs.write.retarget-or-reset"
};
const DEFAULT_WORKSPACE_ROOT = "/workspace";
const DEFAULT_MAX_WRITE_BYTES = 10 * 1024 * 1024;
const ROLE_PERMISSIONS = {
  "tenant-admin": [
    "fs.write",
    "fs.append",
    "fs.write.audit",
    "fs.write.external-handoff",
    "fs.write.artifact",
    "fs.write.product",
    "fs.write.workspace"
  ],
  "workspace-owner": [
    "fs.write",
    "fs.append",
    "fs.write.audit",
    "fs.write.external-handoff",
    "fs.write.artifact",
    "fs.write.product",
    "fs.write.workspace"
  ],
  "workspace-editor": ["fs.write", "fs.append", "fs.write.audit", "fs.write.product", "fs.write.workspace"],
  "service-writer": ["fs.write", "fs.append", "fs.write.audit", "fs.write.artifact", "fs.write.workspace"],
  "workspace-viewer": ["fs.read"]
};
const USER_FIXABLE_VIOLATIONS = new Set([
  "path.required",
  "path.invalid_null_byte",
  "path.workspace_escape",
  "path.outside_workspace",
  "path.outside_allowed_prefix",
  "tenant.required",
  "tenant.mismatch",
  "tenant.untrusted",
  "tenant.delegation_required",
  "workspace.required",
  "workspace.not_allowed",
  "bytes.invalid",
  "contentHash.invalid_contract",
  "contentManifest.digest.invalid_contract",
  "contentManifest.byteLength.invalid",
  "contentManifest.byteLength.mismatch",
  "contentManifest.digest.mismatch",
  "contentManifest.chunk.invalid",
  "targetKind.invalid",
  "artifact.digest.required",
  "artifact.append.disabled",
  "product.revision.required",
  "productSync.product_mismatch",
  "productSync.schema.required",
  "productSync.provider_lock.required",
  "productSync.provider_lock.expired",
  "productWorkflow.ack_required",
  "productWorkflow.product_mismatch",
  "settings.command.invalid",
  "settings.mode.invalid",
  "settings.schedulePolicy.invalid",
  "settings.scheduleAt.invalid",
  "settings.scheduleWindow.invalid",
  "settings.lifecycleTransition.invalid",
  "settings.maxByteLength.invalid",
  "settings.maxByteLength.exceeded",
  "settings.append.disabled",
  "providerContract.maxWriteBytes.exceeded"
]);
const TRANSIENT_FAILURES = new Set([
  "provider.unavailable",
  "provider.timeout",
  "journal.locked",
  "journal.backpressure",
  "health.circuit_half_open",
  "externalHandoff.deferred"
]);
const DEGRADED_FAILURES = new Set([
  "capability.missing.fs.write.audit",
  "capability.missing.fs.write.sync-metadata",
  "journal.backpressure",
  "externalHandoff.deferred",
  "health.circuit_half_open",
  "health.degraded_queue_only"
]);
const NON_RETRYABLE_FAILURES = new Set([
  "path.required",
  "path.invalid_null_byte",
  "path.workspace_escape",
  "path.outside_workspace",
  "path.outside_allowed_prefix",
  "tenant.required",
  "tenant.mismatch",
  "tenant.untrusted",
  "tenant.delegation_required",
  "workspace.required",
  "workspace.not_allowed",
  "bytes.invalid",
  "contentHash.invalid_contract",
  "contentManifest.digest.invalid_contract",
  "contentManifest.byteLength.invalid",
  "contentManifest.byteLength.mismatch",
  "contentManifest.digest.mismatch",
  "contentManifest.chunk.invalid",
  "targetKind.invalid",
  "artifact.digest.required",
  "artifact.append.disabled",
  "product.revision.required",
  "productSync.product_mismatch",
  "productSync.schema.required",
  "productSync.provider_lock.required",
  "productSync.provider_lock.expired",
  "productWorkflow.product_mismatch",
  "fsWrite.disabled",
  "fsWrite.cancelled",
  "settings.command.invalid",
  "settings.mode.invalid",
  "settings.schedulePolicy.invalid",
  "settings.scheduleAt.invalid",
  "settings.scheduleWindow.invalid",
  "settings.lifecycleTransition.invalid",
  "settings.maxByteLength.invalid",
  "settings.maxByteLength.exceeded",
  "settings.append.disabled",
  "providerContract.inactive",
  "providerContract.expired",
  "providerContract.read_only",
  "providerContract.append_only",
  "providerContract.lease_required",
  "providerContract.maxWriteBytes.exceeded",
  "persistedState.cancelled_terminal",
  "persistedState.stale_fingerprint",
  "persistedState.terminal_command_rejected",
  "persistedState.manual_review_required",
  "permission.missing.fs.write",
  "permission.missing.fs.append",
  "capability.missing.fs.write",
  "externalHandoff.blocked",
  "health.circuit_open",
  "health.retry_budget_exhausted"
]);
const ACTIONABLE_ERROR_CATALOG = {
  "provider.unavailable": {
    code: "FS_WRITE_PROVIDER_UNAVAILABLE",
    owner: "platform",
    action: "provider.failover",
    message: "The hosted-kernel write provider is unavailable. Fail over to a healthy provider or retry after backoff."
  },
  "provider.timeout": {
    code: "FS_WRITE_PROVIDER_TIMEOUT",
    owner: "platform",
    action: "fs.write.retry",
    message: "The hosted-kernel write provider timed out. Retry with the generated backoff schedule."
  },
  "journal.locked": {
    code: "FS_WRITE_JOURNAL_LOCKED",
    owner: "platform",
    action: "journal.unlock-or-retry",
    message: "The durability journal is locked. Release the lock or retry after the lock window."
  },
  "journal.backpressure": {
    code: "FS_WRITE_JOURNAL_BACKPRESSURE",
    owner: "platform",
    action: "fs.write.queue",
    message: "The durability journal is under backpressure. Queue the write and retry with backoff."
  },
  "health.circuit_open": {
    code: "FS_WRITE_HEALTH_CIRCUIT_OPEN",
    owner: "platform",
    action: "fs.write.health.reset-circuit",
    message: "The fs-write health circuit is open. Wait for the next probe window or reset the circuit after provider health is restored."
  },
  "health.circuit_half_open": {
    code: "FS_WRITE_HEALTH_CIRCUIT_PROBING",
    owner: "platform",
    action: "fs.write.health.probe",
    message: "The fs-write health circuit is half-open. Allow a bounded probe write before resuming normal commit flow."
  },
  "health.retry_budget_exhausted": {
    code: "FS_WRITE_RETRY_BUDGET_EXHAUSTED",
    owner: "platform",
    action: "fs.write.escalate",
    message: "The retry budget for this write has been exhausted. Escalate to operator review before retrying."
  },
  "health.degraded_queue_only": {
    code: "FS_WRITE_DEGRADED_QUEUE_ONLY",
    owner: "platform",
    action: "fs.write.queue",
    message: "The surface is in queue-only degraded mode. Queue the write until the provider returns to normal commit mode."
  },
  "externalHandoff.deferred": {
    code: "FS_WRITE_HANDOFF_DEFERRED",
    owner: "integration",
    action: "fs.write.external-handoff.resume",
    message: "External write handoff is deferred. Resume the handoff consumer before commit."
  },
  "externalHandoff.blocked": {
    code: "FS_WRITE_HANDOFF_BLOCKED",
    owner: "integration",
    action: "fs.write.external-handoff.unblock",
    message: "External write handoff is blocked by provider capability or policy."
  },
  "externalHandoff.ack_required": {
    code: "FS_WRITE_HANDOFF_ACK_REQUIRED",
    owner: "integration",
    action: "fs.write.external-handoff.acknowledge",
    message: "The provider handoff requires an acknowledgement before the write can commit."
  },
  "capability.missing.fs.write.audit": {
    code: "FS_WRITE_AUDIT_DEGRADED",
    owner: "platform",
    action: "provider.select",
    message: "The provider cannot emit fs.write audit records. Select an audit-capable provider for full proof."
  },
  "capability.missing.fs.write.sync-metadata": {
    code: "FS_WRITE_SYNC_METADATA_DEGRADED",
    owner: "platform",
    action: "provider.select",
    message: "The provider cannot sync write metadata. Select a provider that supports sync metadata."
  },
  "providerContract.inactive": {
    code: "FS_WRITE_PROVIDER_CONTRACT_INACTIVE",
    owner: "platform",
    action: "provider.contract.activate",
    message: "The provider service contract is inactive. Activate or replace the contract before committing writes."
  },
  "providerContract.expired": {
    code: "FS_WRITE_PROVIDER_CONTRACT_EXPIRED",
    owner: "platform",
    action: "provider.contract.renew",
    message: "The provider service contract has expired. Renew the contract or select another provider."
  },
  "providerContract.read_only": {
    code: "FS_WRITE_PROVIDER_READ_ONLY",
    owner: "platform",
    action: "provider.select",
    message: "The selected provider contract is read-only and cannot accept filesystem writes."
  },
  "providerContract.append_only": {
    code: "FS_WRITE_PROVIDER_APPEND_ONLY",
    owner: "requester",
    action: "fs.write.change-operation",
    message: "The provider contract only accepts append operations. Change the request to append or select another provider."
  },
  "providerContract.lease_required": {
    code: "FS_WRITE_PROVIDER_LEASE_REQUIRED",
    owner: "integration",
    action: "provider.lease.attach",
    message: "The provider requires a write lease token before it will accept this handoff."
  },
  "providerContract.maxWriteBytes.exceeded": {
    code: "FS_WRITE_PROVIDER_QUOTA_EXCEEDED",
    owner: "requester",
    action: "fs.write.reduce-payload",
    message: "The write exceeds the provider contract byte limit. Reduce the payload or select a higher-capacity provider."
  },
  "tenant.mismatch": {
    code: "FS_WRITE_TENANT_MISMATCH",
    owner: "requester",
    action: "tenant.select",
    message: "The actor tenant does not match the selected workspace tenant."
  },
  "tenant.untrusted": {
    code: "FS_WRITE_TENANT_UNTRUSTED",
    owner: "requester",
    action: "tenant.permission.request",
    message: "The selected tenant is not in the trusted tenant boundary for this write request."
  },
  "tenant.delegation_required": {
    code: "FS_WRITE_TENANT_DELEGATION_REQUIRED",
    owner: "requester",
    action: "tenant.delegation.attach",
    message: "Delegated tenant isolation requires an explicit delegation authority before writes can commit."
  },
  "workspace.not_allowed": {
    code: "FS_WRITE_WORKSPACE_NOT_ALLOWED",
    owner: "requester",
    action: "workspace.select",
    message: "The selected workspace is outside the actor's allowed workspace boundary."
  },
  "settings.lifecycleTransition.invalid": {
    code: "FS_WRITE_LIFECYCLE_TRANSITION_INVALID",
    owner: "requester",
    action: "fs.write.lifecycle.change-command",
    message: "The requested lifecycle command cannot be applied from the current fs-write mode."
  },
  "settings.scheduleWindow.invalid": {
    code: "FS_WRITE_SCHEDULE_WINDOW_INVALID",
    owner: "requester",
    action: "fs.write.schedule.edit",
    message: "The maintenance schedule window is invalid. Provide a future start and an end after the start."
  },
  "targetKind.invalid": {
    code: "FS_WRITE_TARGET_KIND_INVALID",
    owner: "requester",
    action: "fs.write.retarget",
    message: "The write target kind must be artifact, product, or workspace."
  },
  "artifact.digest.required": {
    code: "FS_WRITE_ARTIFACT_DIGEST_REQUIRED",
    owner: "requester",
    action: "fs.write.attach-content-digest",
    message: "Artifact writes require a content digest so the artifact can be audited and replayed."
  },
  "artifact.append.disabled": {
    code: "FS_WRITE_ARTIFACT_APPEND_DISABLED",
    owner: "requester",
    action: "fs.write.change-operation",
    message: "Artifact targets are immutable. Use a write operation with a new digest instead of append."
  },
  "product.revision.required": {
    code: "FS_WRITE_PRODUCT_REVISION_REQUIRED",
    owner: "requester",
    action: "fs.write.attach-sync-revision",
    message: "Product writes require a sync revision or previous revision for concurrency control."
  },
  "productSync.product_mismatch": {
    code: "FS_WRITE_PRODUCT_SYNC_MISMATCH",
    owner: "requester",
    action: "fs.write.product-sync.select",
    message: "The provider product sync contract is bound to a different product. Select the matching product sync context before commit."
  },
  "productSync.schema.required": {
    code: "FS_WRITE_PRODUCT_SYNC_SCHEMA_REQUIRED",
    owner: "requester",
    action: "fs.write.product-sync.attach-schema",
    message: "Product writes require a product sync schema version so the provider can apply metadata safely."
  },
  "productSync.provider_lock.required": {
    code: "FS_WRITE_PRODUCT_SYNC_LOCK_REQUIRED",
    owner: "integration",
    action: "fs.write.product-sync.attach-lock",
    message: "The provider product sync contract requires a product lock token before commit."
  },
  "productSync.provider_lock.expired": {
    code: "FS_WRITE_PRODUCT_SYNC_LOCK_EXPIRED",
    owner: "integration",
    action: "fs.write.product-sync.renew-lock",
    message: "The provider product sync lock has expired. Renew the lock before committing the product write."
  },
  "productWorkflow.ack_required": {
    code: "FS_WRITE_PRODUCT_WORKFLOW_ACK_REQUIRED",
    owner: "requester",
    action: "fs.write.product-workflow.acknowledge",
    message: "The active product editing workflow must acknowledge the write handoff before commit."
  },
  "productWorkflow.product_mismatch": {
    code: "FS_WRITE_PRODUCT_WORKFLOW_MISMATCH",
    owner: "requester",
    action: "fs.write.product-workflow.select",
    message: "The active client product does not match the product write target. Select the matching product workflow before continuing."
  },
  "persistedState.stale_fingerprint": {
    code: "FS_WRITE_STALE_PERSISTED_FINGERPRINT",
    owner: "platform",
    action: "fs.write.retarget-or-reset",
    message: "The persisted write fingerprint differs from the current request. Retarget the request or reset the persisted write state before continuing."
  },
  "persistedState.cancelled_terminal": {
    code: "FS_WRITE_CANCELLED_TERMINAL_STATE",
    owner: "requester",
    action: "fs.write.lifecycle.enable",
    message: "The persisted write is cancelled. Start a new write lifecycle before attempting another commit."
  },
  "persistedState.terminal_command_rejected": {
    code: "FS_WRITE_TERMINAL_COMMAND_REJECTED",
    owner: "platform",
    action: "fs.write.recovery.review",
    message: "The requested command cannot be applied to the persisted terminal write state. Review the persisted command ledger before continuing."
  },
  "persistedState.manual_review_required": {
    code: "FS_WRITE_PERSISTED_REVIEW_REQUIRED",
    owner: "platform",
    action: "fs.write.recovery.review",
    message: "The persisted write state is not restart-safe. Review the journal checkpoint before replaying or committing."
  }
};

function asIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return new Date().toISOString();
}

function uniqueStrings(values, fallback = []) {
  const source = Array.isArray(values) && values.length > 0 ? values : fallback;
  return [...new Set(source.filter((value) => typeof value === "string" && value.trim()))];
}

function normalizePathSegments(path) {
  const absolute = path.startsWith("/");
  const parts = [];
  let escapedRoot = false;

  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > 0) {
        parts.pop();
      } else {
        escapedRoot = true;
      }
      continue;
    }
    parts.push(segment);
  }

  return {
    normalizedPath: `${absolute ? "/" : ""}${parts.join("/")}` || (absolute ? "/" : "."),
    escapedRoot
  };
}

function isPathInsideRoot(path, rootPath) {
  if (!path || !rootPath || path === ".") return false;
  if (path === rootPath) return true;
  return path.startsWith(`${rootPath}/`);
}

function normalizeAllowedPrefix(prefix, rootPath) {
  const normalized = normalizePathSegments(prefix.trim()).normalizedPath;
  return prefix.trim().startsWith("/")
    ? normalized
    : normalizePathSegments(`${rootPath}/${normalized}`).normalizedPath;
}

function normalizeTenantPermissionBoundary(scope, workspace, actor, input) {
  const tenantId =
    typeof scope.tenantId === "string" && scope.tenantId.trim()
      ? scope.tenantId.trim()
      : typeof workspace.tenantId === "string" && workspace.tenantId.trim()
        ? workspace.tenantId.trim()
        : typeof input.tenantId === "string" && input.tenantId.trim()
          ? input.tenantId.trim()
          : null;
  const workspaceId =
    typeof workspace.id === "string" && workspace.id.trim()
      ? workspace.id.trim()
      : typeof scope.workspaceId === "string" && scope.workspaceId.trim()
        ? scope.workspaceId.trim()
        : null;
  const actorTenantId =
    typeof actor.tenantId === "string" && actor.tenantId.trim()
      ? actor.tenantId.trim()
      : typeof scope.actorTenantId === "string" && scope.actorTenantId.trim()
        ? scope.actorTenantId.trim()
        : tenantId;
  const isolationInput =
    typeof scope.isolationMode === "string" && scope.isolationMode.trim()
      ? scope.isolationMode.trim()
      : typeof workspace.isolationMode === "string" && workspace.isolationMode.trim()
        ? workspace.isolationMode.trim()
        : "strict";
  const isolationMode = TENANT_ISOLATION_MODES.has(isolationInput) ? isolationInput : "strict";
  const trustedTenantIds = uniqueStrings(
    scope.trustedTenantIds || workspace.trustedTenantIds || actor.trustedTenantIds,
    tenantId ? [tenantId] : []
  );
  const allowedWorkspaceIds = uniqueStrings(
    scope.allowedWorkspaceIds || actor.allowedWorkspaceIds || input.allowedWorkspaceIds,
    workspaceId ? [workspaceId] : []
  );
  const delegatedBy =
    typeof scope.delegatedBy === "string" && scope.delegatedBy.trim()
      ? scope.delegatedBy.trim()
      : typeof actor.delegatedBy === "string" && actor.delegatedBy.trim()
        ? actor.delegatedBy.trim()
        : null;

  return {
    version: "aios.fs-write.tenant-permission-boundary.v1",
    isolationMode,
    tenantId,
    workspaceId,
    actorTenantId,
    delegatedBy,
    trustedTenantIds,
    allowedWorkspaceIds,
    actorTenantMatches: !tenantId || !actorTenantId || actorTenantId === tenantId,
    tenantTrusted: !tenantId || trustedTenantIds.length === 0 || trustedTenantIds.includes(tenantId),
    workspaceAllowed:
      !workspaceId || allowedWorkspaceIds.length === 0 || allowedWorkspaceIds.includes(workspaceId),
    delegationAccepted: isolationMode !== "delegated" || Boolean(delegatedBy),
    auditSubject: [
      tenantId || "tenant:unselected",
      workspaceId || "workspace:unselected",
      actorTenantId || "actor-tenant:unselected"
    ].join("|")
  };
}

function normalizeWorkspaceScope(input, request) {
  const scope = input.scope && typeof input.scope === "object" ? input.scope : {};
  const workspace = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const actor = input.actor && typeof input.actor === "object" ? input.actor : {};
  const tenantBoundary = normalizeTenantPermissionBoundary(scope, workspace, actor, input);
  const rootInput =
    typeof scope.rootPath === "string" && scope.rootPath.trim()
      ? scope.rootPath
      : typeof workspace.rootPath === "string" && workspace.rootPath.trim()
        ? workspace.rootPath
        : DEFAULT_WORKSPACE_ROOT;
  const root = normalizePathSegments(rootInput.trim());
  const path = normalizePathSegments(request.path);
  const roles = uniqueStrings(actor.roles || scope.roles || input.roles, ["workspace-editor"]);
  const explicitGrants = uniqueStrings(scope.grants || input.grants, []);
  const roleGrants = roles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const grantedPermissions = uniqueStrings([...roleGrants, ...explicitGrants], []);
  const requestedPermission = request.operation === "append" ? "fs.append" : "fs.write";
  const scopedPath = request.path.startsWith("/")
    ? path.normalizedPath
    : normalizePathSegments(`${root.normalizedPath}/${path.normalizedPath}`).normalizedPath;
  const allowedPrefixInputs = uniqueStrings(scope.allowedPrefixes || workspace.allowedPrefixes, []);
  const allowedPrefixes =
    allowedPrefixInputs.length > 0
      ? allowedPrefixInputs.map((prefix) => normalizeAllowedPrefix(prefix, root.normalizedPath))
      : [root.normalizedPath];
  const insideAllowedPrefix = allowedPrefixes.some((prefix) => isPathInsideRoot(scopedPath, prefix));

  return {
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    tenantBoundary,
    rootPath: root.normalizedPath,
    requestedPermission,
    roles,
    grantedPermissions,
    path: {
      requested: request.path || null,
      normalized: path.normalizedPath,
      scoped: scopedPath,
      escapedRoot: path.escapedRoot,
      insideWorkspace: isPathInsideRoot(scopedPath, root.normalizedPath),
      allowedPrefixes,
      insideAllowedPrefix
    }
  };
}

function evaluateWorkspaceBoundary(request, workspaceScope) {
  const violations = [];
  const granted = new Set(workspaceScope.grantedPermissions);

  if (!workspaceScope.tenantId) violations.push("tenant.required");
  if (!workspaceScope.workspaceId) violations.push("workspace.required");
  if (workspaceScope.tenantBoundary && !workspaceScope.tenantBoundary.actorTenantMatches) {
    violations.push("tenant.mismatch");
  }
  if (workspaceScope.tenantBoundary && !workspaceScope.tenantBoundary.tenantTrusted) {
    violations.push("tenant.untrusted");
  }
  if (workspaceScope.tenantBoundary && !workspaceScope.tenantBoundary.workspaceAllowed) {
    violations.push("workspace.not_allowed");
  }
  if (workspaceScope.tenantBoundary && !workspaceScope.tenantBoundary.delegationAccepted) {
    violations.push("tenant.delegation_required");
  }
  if (!granted.has(workspaceScope.requestedPermission)) {
    violations.push(`permission.missing.${workspaceScope.requestedPermission}`);
  }
  if (request.path && workspaceScope.path.escapedRoot) violations.push("path.workspace_escape");
  if (request.path && !workspaceScope.path.insideWorkspace) violations.push("path.outside_workspace");
  if (request.path && workspaceScope.path.insideWorkspace && !workspaceScope.path.insideAllowedPrefix) {
    violations.push("path.outside_allowed_prefix");
  }

  return {
    accepted: violations.length === 0,
    violations,
    boundary: {
      tenantId: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      rootPath: workspaceScope.rootPath,
      scopedPath: workspaceScope.path.scoped,
      insideWorkspace: workspaceScope.path.insideWorkspace,
      allowedPrefixes: workspaceScope.path.allowedPrefixes,
      insideAllowedPrefix: workspaceScope.path.insideAllowedPrefix,
      tenantIsolation: workspaceScope.tenantBoundary
        ? {
            mode: workspaceScope.tenantBoundary.isolationMode,
            actorTenantId: workspaceScope.tenantBoundary.actorTenantId,
            actorTenantMatches: workspaceScope.tenantBoundary.actorTenantMatches,
            tenantTrusted: workspaceScope.tenantBoundary.tenantTrusted,
            workspaceAllowed: workspaceScope.tenantBoundary.workspaceAllowed,
            delegatedBy: workspaceScope.tenantBoundary.delegatedBy,
            delegationAccepted: workspaceScope.tenantBoundary.delegationAccepted,
            auditSubject: workspaceScope.tenantBoundary.auditSubject
          }
        : null
    },
    permission: {
      requested: workspaceScope.requestedPermission,
      granted: workspaceScope.grantedPermissions.includes(workspaceScope.requestedPermission),
      roles: workspaceScope.roles,
      grants: workspaceScope.grantedPermissions
    }
  };
}

function normalizeProvider(provider = {}) {
  return {
    id: typeof provider.id === "string" && provider.id.trim() ? provider.id : DEFAULT_PROVIDER.id,
    protocol:
      typeof provider.protocol === "string" && provider.protocol.trim()
        ? provider.protocol
        : DEFAULT_PROVIDER.protocol,
    durability:
      typeof provider.durability === "string" && provider.durability.trim()
        ? provider.durability
        : DEFAULT_PROVIDER.durability,
    capabilities: uniqueStrings(provider.capabilities, DEFAULT_PROVIDER.capabilities)
  };
}

function normalizeProviderServiceContract(input, provider, request, generatedAt) {
  const providerInput = input.provider && typeof input.provider === "object" ? input.provider : {};
  const contractInput =
    providerInput.serviceContract && typeof providerInput.serviceContract === "object"
      ? providerInput.serviceContract
      : input.serviceContract && typeof input.serviceContract === "object"
        ? input.serviceContract
        : {};
  const serviceLevelInput =
    typeof contractInput.serviceLevel === "string" && contractInput.serviceLevel.trim()
      ? contractInput.serviceLevel.trim()
      : "standard";
  const writeModeInput =
    typeof contractInput.writeMode === "string" && contractInput.writeMode.trim()
      ? contractInput.writeMode.trim()
      : serviceLevelInput === "read-only"
        ? "read-only"
        : "read-write";
  const serviceLevel = PROVIDER_SERVICE_LEVELS.has(serviceLevelInput) ? serviceLevelInput : "standard";
  const writeMode = PROVIDER_WRITE_MODES.has(writeModeInput) ? writeModeInput : "read-write";
  const maxWriteBytes =
    Number.isInteger(contractInput.maxWriteBytes) && contractInput.maxWriteBytes > 0
      ? contractInput.maxWriteBytes
      : serviceLevel === "bulk"
        ? DEFAULT_MAX_WRITE_BYTES * 10
        : serviceLevel === "interactive"
          ? 2 * 1024 * 1024
          : DEFAULT_MAX_WRITE_BYTES;
  const expiresAt =
    typeof contractInput.expiresAt === "string" && contractInput.expiresAt.trim()
      ? contractInput.expiresAt.trim()
      : null;
  const expired = expiresAt ? Date.parse(expiresAt) <= Date.parse(generatedAt) : false;
  const leaseRequired = contractInput.leaseRequired === true;
  const leaseToken =
    typeof contractInput.leaseToken === "string" && contractInput.leaseToken.trim()
      ? contractInput.leaseToken.trim()
      : null;
  const active = contractInput.active !== false;
  const requiredCapabilities = uniqueStrings(contractInput.requiredCapabilities, ["fs.write"]);
  const disabledCapabilities = uniqueStrings(contractInput.disabledCapabilities, []);
  const productSyncInput =
    contractInput.productSync && typeof contractInput.productSync === "object"
      ? contractInput.productSync
      : {};
  const violations = [];
  const warnings = [];

  if (!active) violations.push("providerContract.inactive");
  if (expired) violations.push("providerContract.expired");
  if (writeMode === "read-only") violations.push("providerContract.read_only");
  if (writeMode === "append-only" && request.operation !== "append") violations.push("providerContract.append_only");
  if (leaseRequired && !leaseToken) violations.push("providerContract.lease_required");
  if (request.byteLength > maxWriteBytes) violations.push("providerContract.maxWriteBytes.exceeded");
  if (serviceLevel === "interactive" && request.byteLength > 1024 * 1024) warnings.push("providerContract.interactive_large_write");

  return {
    version: "aios.fs-write.provider-service-contract.v1",
    serviceId:
      typeof contractInput.serviceId === "string" && contractInput.serviceId.trim()
        ? contractInput.serviceId.trim()
        : `${provider.id}:service`,
    providerId: provider.id,
    protocol: provider.protocol,
    serviceLevel,
    writeMode,
    active,
    expiresAt,
    lease: {
      required: leaseRequired,
      tokenPresent: Boolean(leaseToken)
    },
    quota: {
      maxWriteBytes,
      requestedBytes: request.byteLength,
      remainingBytes: Math.max(0, maxWriteBytes - request.byteLength)
    },
    handoffRequired: contractInput.handoffRequired === true,
    syncMetadataRequired: contractInput.syncMetadataRequired !== false,
    auditRequired: contractInput.auditRequired !== false,
    productSync: {
      enabled: productSyncInput.enabled !== false,
      required: productSyncInput.required === true,
      authority:
        typeof productSyncInput.authority === "string" && PRODUCT_SYNC_AUTHORITIES.has(productSyncInput.authority)
          ? productSyncInput.authority
          : "provider",
      conflictStrategy:
        typeof productSyncInput.conflictStrategy === "string" &&
          PRODUCT_SYNC_CONFLICT_STRATEGIES.has(productSyncInput.conflictStrategy)
          ? productSyncInput.conflictStrategy
          : "optimistic-revision",
      serviceProductId:
        typeof productSyncInput.productId === "string" && productSyncInput.productId.trim()
          ? productSyncInput.productId.trim()
          : null,
      schemaVersion:
        typeof productSyncInput.schemaVersion === "string" && productSyncInput.schemaVersion.trim()
          ? productSyncInput.schemaVersion.trim()
          : null,
      lockRequired: productSyncInput.lockRequired === true,
      requiredCapabilities: uniqueStrings(productSyncInput.requiredCapabilities, [])
    },
    requiredCapabilities,
    disabledCapabilities,
    violations,
    warnings
  };
}

function parseFutureIso(value, generatedAt) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "invalid";
  return new Date(Math.max(parsed, Date.parse(generatedAt))).toISOString();
}

function normalizeScheduleWindow(source, generatedAt) {
  const windowInput = source.scheduleWindow && typeof source.scheduleWindow === "object"
    ? source.scheduleWindow
    : source.window && typeof source.window === "object"
      ? source.window
      : {};
  const startsAt = parseFutureIso(windowInput.startsAt || windowInput.startAt, generatedAt);
  const endsAt = parseFutureIso(windowInput.endsAt || windowInput.endAt, generatedAt);
  const invalid =
    startsAt === "invalid" ||
    endsAt === "invalid" ||
    Boolean(startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt));

  return {
    startsAt: startsAt === "invalid" ? null : startsAt,
    endsAt: endsAt === "invalid" ? null : endsAt,
    valid: !invalid,
    active:
      !invalid &&
      Boolean(startsAt && endsAt) &&
      Date.parse(startsAt) <= Date.parse(generatedAt) &&
      Date.parse(generatedAt) < Date.parse(endsAt),
    durationMs:
      !invalid && startsAt && endsAt
        ? Date.parse(endsAt) - Date.parse(startsAt)
        : null
  };
}

function lifecycleTargetMode(command, requestedMode) {
  if (command === "enable" || command === "resume") return "enabled";
  if (command === "disable" || command === "cancel") return "disabled";
  if (command === "pause") return "paused";
  if (command === "commit") return requestedMode === "drain" ? "drain" : "enabled";
  return requestedMode;
}

function buildLifecycleCommandPlan({
  command,
  requestedMode,
  sourceMode,
  schedulePolicy,
  scheduleAt,
  scheduleWindow,
  queue,
  generatedAt
}) {
  const targetMode = lifecycleTargetMode(command, requestedMode);
  const transitionTable = {
    enabled: ["prepare", "validate", "commit", "pause", "disable", "cancel", "enable"],
    disabled: ["prepare", "validate", "enable", "disable", "cancel"],
    paused: ["prepare", "validate", "resume", "disable", "cancel", "pause"],
    drain: ["validate", "commit", "enable", "disable", "cancel"]
  };
  const allowedCommands = transitionTable[sourceMode] || transitionTable.enabled;
  const transitionAllowed = allowedCommands.includes(command);
  const idempotent =
    sourceMode === targetMode &&
    (command === "enable" || command === "disable" || command === "pause" || command === "resume");
  const schedulerGate =
    schedulePolicy === "maintenance-window"
      ? scheduleWindow.valid && (scheduleWindow.active || Boolean(scheduleWindow.startsAt))
      : schedulePolicy === "queued"
        ? true
        : !scheduleAt || Date.parse(scheduleAt) <= Date.parse(generatedAt);
  const blockedReason = !transitionAllowed
    ? "settings.lifecycleTransition.invalid"
    : !schedulerGate
      ? "settings.scheduleWindow.invalid"
      : null;

  return {
    version: "aios.fs-write.lifecycle-command-plan.v1",
    command,
    sourceMode,
    targetMode,
    transitionAllowed,
    idempotent,
    schedulerGate,
    blockedReason,
    route:
      blockedReason
        ? "fs.write.lifecycle.resolve"
        : command === "commit"
          ? "fs.write.commit"
          : command === "pause"
            ? "fs.write.lifecycle.pause"
            : command === "resume"
              ? "fs.write.lifecycle.resume"
              : command === "disable"
                ? "fs.write.lifecycle.disable"
                : command === "enable"
                  ? "fs.write.lifecycle.enable"
                  : command === "cancel"
                    ? "fs.write.lifecycle.cancel"
                    : "fs.write.lifecycle.prepare",
    requiredBeforeCommand: uniqueStrings([
      blockedReason || "",
      schedulePolicy === "maintenance-window" && !scheduleWindow.active ? "fs.write.schedule.await-window" : "",
      schedulePolicy === "queued" ? "fs.write.queue.persist" : ""
    ], []),
    statePatch: {
      mode: targetMode,
      command,
      queue,
      scheduledAt: scheduleAt,
      scheduleWindow,
      updatedAt: generatedAt
    }
  };
}

function normalizeLifecycleSettings(input, request, generatedAt) {
  const settingsInput = input.settings && typeof input.settings === "object" ? input.settings : {};
  const fsWriteSettings =
    settingsInput.fsWrite && typeof settingsInput.fsWrite === "object"
      ? settingsInput.fsWrite
      : input.fsWriteSettings && typeof input.fsWriteSettings === "object"
        ? input.fsWriteSettings
        : {};
  const lifecycleInput = input.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : {};
  const commandInput =
    typeof lifecycleInput.command === "string" && lifecycleInput.command.trim()
      ? lifecycleInput.command.trim()
      : typeof fsWriteSettings.command === "string" && fsWriteSettings.command.trim()
        ? fsWriteSettings.command.trim()
        : "prepare";
  const modeInput =
    typeof fsWriteSettings.mode === "string" && fsWriteSettings.mode.trim()
      ? fsWriteSettings.mode.trim()
      : fsWriteSettings.enabled === false
        ? "disabled"
        : "enabled";
  const schedulePolicyInput =
    typeof fsWriteSettings.schedulePolicy === "string" && fsWriteSettings.schedulePolicy.trim()
      ? fsWriteSettings.schedulePolicy.trim()
      : typeof lifecycleInput.schedulePolicy === "string" && lifecycleInput.schedulePolicy.trim()
        ? lifecycleInput.schedulePolicy.trim()
        : "immediate";
  const scheduleAt = parseFutureIso(fsWriteSettings.scheduleAt || lifecycleInput.scheduleAt, generatedAt);
  const scheduleWindow = normalizeScheduleWindow(
    Object.keys(fsWriteSettings).length > 0 ? fsWriteSettings : lifecycleInput,
    generatedAt
  );
  const queue =
    typeof fsWriteSettings.queue === "string" && fsWriteSettings.queue.trim()
      ? fsWriteSettings.queue.trim()
      : typeof lifecycleInput.queue === "string" && lifecycleInput.queue.trim()
        ? lifecycleInput.queue.trim()
        : "hosted-kernel.fs-write.default";
  const maxByteLength =
    Number.isInteger(fsWriteSettings.maxByteLength) && fsWriteSettings.maxByteLength > 0
      ? fsWriteSettings.maxByteLength
      : DEFAULT_MAX_WRITE_BYTES;
  const command = LIFECYCLE_COMMANDS.has(commandInput) ? commandInput : "prepare";
  const mode = WRITE_MODES.has(modeInput) ? modeInput : "enabled";
  const sourceModeInput =
    typeof lifecycleInput.currentMode === "string" && lifecycleInput.currentMode.trim()
      ? lifecycleInput.currentMode.trim()
      : typeof fsWriteSettings.currentMode === "string" && fsWriteSettings.currentMode.trim()
        ? fsWriteSettings.currentMode.trim()
        : mode;
  const sourceMode = WRITE_MODES.has(sourceModeInput) ? sourceModeInput : mode;
  const schedulePolicy = SCHEDULE_POLICIES.has(schedulePolicyInput) ? schedulePolicyInput : "immediate";
  const commandPlan = buildLifecycleCommandPlan({
    command,
    requestedMode: mode,
    sourceMode,
    schedulePolicy,
    scheduleAt: scheduleAt === "invalid" ? null : scheduleAt,
    scheduleWindow,
    queue,
    generatedAt
  });
  const scheduleDue =
    schedulePolicy === "queued"
      ? false
      : schedulePolicy === "maintenance-window"
        ? scheduleWindow.active
        : !scheduleAt || scheduleAt === "invalid" || Date.parse(scheduleAt) <= Date.parse(generatedAt);
  const violations = [];
  const warnings = [];

  if (!LIFECYCLE_COMMANDS.has(commandInput)) violations.push("settings.command.invalid");
  if (!WRITE_MODES.has(modeInput)) violations.push("settings.mode.invalid");
  if (!SCHEDULE_POLICIES.has(schedulePolicyInput)) violations.push("settings.schedulePolicy.invalid");
  if (scheduleAt === "invalid") violations.push("settings.scheduleAt.invalid");
  if (schedulePolicy === "maintenance-window" && (!scheduleWindow.valid || !scheduleWindow.startsAt || !scheduleWindow.endsAt)) {
    violations.push("settings.scheduleWindow.invalid");
  }
  if (!commandPlan.transitionAllowed) violations.push("settings.lifecycleTransition.invalid");
  if ("maxByteLength" in fsWriteSettings && (!Number.isInteger(fsWriteSettings.maxByteLength) || fsWriteSettings.maxByteLength <= 0)) {
    violations.push("settings.maxByteLength.invalid");
  }
  if (request.byteLength > maxByteLength) violations.push("settings.maxByteLength.exceeded");
  if (request.operation === "append" && fsWriteSettings.allowAppend === false) violations.push("settings.append.disabled");
  if (modeInput === "disabled" || commandInput === "disable") violations.push("fsWrite.disabled");
  if (commandInput === "cancel") violations.push("fsWrite.cancelled");
  if (modeInput === "paused" || commandInput === "pause") warnings.push("fsWrite.paused");
  if (schedulePolicyInput !== "immediate" || scheduleAt) warnings.push("fsWrite.scheduled");

  return {
    version: "aios.fs-write.lifecycle.v1",
    command,
    mode,
    sourceMode,
    enabled: modeInput !== "disabled" && commandInput !== "disable" && commandInput !== "cancel",
    maxByteLength,
    allowAppend: fsWriteSettings.allowAppend !== false,
    schedule: {
      policy: schedulePolicy,
      scheduledAt: scheduleAt === "invalid" ? null : scheduleAt,
      due: scheduleDue,
      queue,
      maintenanceWindow: scheduleWindow
    },
    controls: {
      canEnable: modeInput === "disabled" || commandInput === "disable",
      canDisable: modeInput !== "disabled",
      canPause: modeInput === "enabled",
      canResume: modeInput === "paused" || commandInput === "pause",
      canSchedule:
        schedulePolicy !== "maintenance-window" ||
        (scheduleWindow.valid && Boolean(scheduleWindow.startsAt && scheduleWindow.endsAt)),
      canCommitCommand: command === "commit" ? commandPlan.transitionAllowed && commandPlan.schedulerGate : true
    },
    commandPlan,
    violations,
    warnings
  };
}

function normalizeWriteRequest(input) {
  const request = input.request && typeof input.request === "object" ? input.request : input;
  const byteLength =
    Number.isInteger(request.byteLength) && request.byteLength >= 0
      ? request.byteLength
      : Number.isInteger(request.bytes) && request.bytes >= 0
        ? request.bytes
        : 0;

  return {
    operation: request.operation === "append" ? "append" : "write",
    path: typeof request.path === "string" ? request.path.trim() : "",
    byteLength,
    contentHash: typeof request.contentHash === "string" ? request.contentHash.trim() : "",
    actor: typeof request.actor === "string" && request.actor.trim() ? request.actor : "kernel",
    correlationId:
      typeof request.correlationId === "string" && request.correlationId.trim()
        ? request.correlationId
        : `fsw-${byteLength}-${Math.abs((request.path || "").length)}`
  };
}

function validateWriteRequest(request) {
  const violations = [];
  if (!request.path) violations.push("path.required");
  if (request.path.includes("\0")) violations.push("path.invalid_null_byte");
  if (request.path.startsWith("/proc/") || request.path === "/proc") violations.push("path.protected_proc");
  if (request.path.startsWith("/sys/") || request.path === "/sys") violations.push("path.protected_sys");
  if (!Number.isInteger(request.byteLength) || request.byteLength < 0) violations.push("bytes.invalid");
  if (request.contentHash && !/^[a-z0-9:_-]{8,160}$/i.test(request.contentHash)) {
    violations.push("contentHash.invalid_contract");
  }
  return violations;
}

function splitDigest(value) {
  if (typeof value !== "string" || !value.trim()) {
    return { algorithm: "unknown", digest: null };
  }
  const trimmed = value.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    return { algorithm: "unknown", digest: trimmed };
  }
  const algorithm = trimmed.slice(0, separator).toLowerCase();
  const digest = trimmed.slice(separator + 1).trim();
  return {
    algorithm: CONTENT_HASH_ALGORITHMS.has(algorithm) ? algorithm : "unknown",
    digest: digest || null
  };
}

function normalizeContentIntegrity(input, request, generatedAt) {
  const contentInput =
    input.contentManifest && typeof input.contentManifest === "object"
      ? input.contentManifest
      : input.content && typeof input.content === "object"
        ? input.content
        : {};
  const requestDigest = splitDigest(request.contentHash);
  const manifestDigest = splitDigest(contentInput.digest || contentInput.hash || request.contentHash);
  const algorithm =
    typeof contentInput.algorithm === "string" && CONTENT_HASH_ALGORITHMS.has(contentInput.algorithm.toLowerCase())
      ? contentInput.algorithm.toLowerCase()
      : manifestDigest.algorithm !== "unknown"
        ? manifestDigest.algorithm
        : requestDigest.algorithm;
  const declaredByteLength =
    Number.isInteger(contentInput.byteLength) && contentInput.byteLength >= 0
      ? contentInput.byteLength
      : null;
  const encoding =
    typeof contentInput.encoding === "string" && CONTENT_ENCODINGS.has(contentInput.encoding)
      ? contentInput.encoding
      : "opaque";
  const rawChunks = Array.isArray(contentInput.chunks) ? contentInput.chunks.slice(0, 64) : [];
  const chunks = rawChunks
    .filter((chunk) => chunk && typeof chunk === "object")
    .map((chunk, index) => ({
      index: Number.isInteger(chunk.index) && chunk.index >= 0 ? chunk.index : index,
      byteLength:
        Number.isInteger(chunk.byteLength) && chunk.byteLength >= 0
          ? chunk.byteLength
          : Number.isInteger(chunk.bytes) && chunk.bytes >= 0
            ? chunk.bytes
            : null,
      digest: splitDigest(chunk.digest || chunk.hash).digest
    }));
  const chunkBytes = chunks.reduce((total, chunk) => total + (chunk.byteLength || 0), 0);
  const invalidChunks = chunks.filter((chunk) => chunk.byteLength === null || !chunk.digest);
  const digest = manifestDigest.digest || requestDigest.digest;
  const requestDigestValue = requestDigest.digest;
  const digestMatchesRequest =
    !requestDigestValue || !digest || requestDigestValue.toLowerCase() === digest.toLowerCase();
  const violations = [];
  const warnings = [];

  if (digest && !/^[a-z0-9:_-]{8,160}$/i.test(`${algorithm}:${digest}`)) {
    violations.push("contentManifest.digest.invalid_contract");
  }
  if ("byteLength" in contentInput && declaredByteLength === null) violations.push("contentManifest.byteLength.invalid");
  if (declaredByteLength !== null && declaredByteLength !== request.byteLength) {
    violations.push("contentManifest.byteLength.mismatch");
  }
  if (!digestMatchesRequest) violations.push("contentManifest.digest.mismatch");
  if (invalidChunks.length > 0) violations.push("contentManifest.chunk.invalid");
  if (request.byteLength > 0 && !digest) warnings.push("contentManifest.digest.missing");
  if (chunks.length > 0 && chunkBytes !== request.byteLength) warnings.push("contentManifest.chunkBytes.mismatch");

  return {
    version: "aios.fs-write.content-integrity.v1",
    generatedAt,
    algorithm,
    digest,
    requestContentHash: request.contentHash || null,
    digestMatchesRequest,
    byteLength: declaredByteLength === null ? request.byteLength : declaredByteLength,
    requestByteLength: request.byteLength,
    byteLengthMatchesRequest: declaredByteLength === null || declaredByteLength === request.byteLength,
    encoding,
    integrityLevel:
      request.byteLength === 0
        ? "empty-write"
        : digest
          ? chunks.length > 0
            ? "digest-and-chunks"
            : "digest-bound"
          : chunks.length > 0
            ? "chunked-without-root-digest"
            : "unverified",
    chunks: {
      count: chunks.length,
      declaredBytes: chunkBytes,
      invalidCount: invalidChunks.length,
      sample: chunks.slice(0, 3)
    },
    violations,
    warnings
  };
}

function inferWriteTargetKind(input, request, workspaceScope) {
  const targetInput =
    input.target && typeof input.target === "object"
      ? input.target
      : input.writeTarget && typeof input.writeTarget === "object"
        ? input.writeTarget
        : {};
  const explicitKind =
    typeof targetInput.kind === "string" && targetInput.kind.trim()
      ? targetInput.kind.trim()
      : typeof targetInput.type === "string" && targetInput.type.trim()
        ? targetInput.type.trim()
        : null;
  const scopedPath = workspaceScope.path.scoped || "";
  const relativePath = request.path.startsWith("/")
    ? scopedPath.slice(workspaceScope.rootPath.length).replace(/^\/+/, "")
    : request.path;
  const topLevel = relativePath.split("/").filter(Boolean)[0] || "";
  const inferredKind =
    explicitKind && WRITE_TARGET_KINDS.has(explicitKind)
      ? explicitKind
      : topLevel === "artifacts" || topLevel === ".artifacts"
        ? "artifact"
        : topLevel === "products" || topLevel === "product"
          ? "product"
          : "workspace";
  const namespace =
    typeof targetInput.namespace === "string" && targetInput.namespace.trim()
      ? targetInput.namespace.trim()
      : inferredKind === "artifact"
        ? "workspace-artifacts"
        : inferredKind === "product"
          ? "workspace-products"
          : "workspace-files";
  const productId =
    typeof targetInput.productId === "string" && targetInput.productId.trim()
      ? targetInput.productId.trim()
      : inferredKind === "product" && relativePath
        ? relativePath.split("/").filter(Boolean)[1] || null
        : null;
  const artifactId =
    typeof targetInput.artifactId === "string" && targetInput.artifactId.trim()
      ? targetInput.artifactId.trim()
      : inferredKind === "artifact" && relativePath
        ? relativePath.split("/").filter(Boolean)[1] || null
        : null;
  const requiredCapabilities = uniqueStrings(
    targetInput.requiredCapabilities,
    TARGET_CAPABILITY_REQUIREMENTS[inferredKind] || []
  );
  const requiredPermissions = uniqueStrings(
    targetInput.requiredPermissions,
    TARGET_PERMISSION_REQUIREMENTS[inferredKind] || []
  );

  return {
    version: "aios.fs-write.target-classification.v1",
    kind: inferredKind,
    explicitKind,
    explicitKindAccepted: !explicitKind || WRITE_TARGET_KINDS.has(explicitKind),
    namespace,
    productId,
    artifactId,
    scopedPath,
    relativePath,
    topLevel: topLevel || null,
    immutable: inferredKind === "artifact",
    requiresDigest: inferredKind === "artifact",
    requiresRevision: inferredKind === "product",
    requiredCapabilities,
    requiredPermissions,
    auditSubject: [
      inferredKind,
      namespace,
      productId || artifactId || relativePath || "unresolved"
    ].join("|")
  };
}

function evaluateTargetPolicy(
  request,
  syncMetadata,
  contentIntegrity,
  targetClassification,
  workspaceScope,
  negotiation
) {
  const violations = [];
  const warnings = [];
  const grants = new Set(workspaceScope.grantedPermissions);
  const missingPermissions = targetClassification.requiredPermissions.filter(
    (permission) => !grants.has(permission)
  );
  const missingCapabilities = targetClassification.requiredCapabilities.filter(
    (capability) => negotiation && negotiation.missing.includes(capability)
  );
  const capabilityProofState =
    missingCapabilities.length > 0
      ? "missing"
      : targetClassification.requiredCapabilities.length > 0
        ? "satisfied"
        : "not-required";
  const permissionProofState =
    missingPermissions.length > 0
      ? "missing"
      : targetClassification.requiredPermissions.length > 0
        ? "satisfied"
        : "not-required";

  if (!targetClassification.explicitKindAccepted) violations.push("targetKind.invalid");
  for (const permission of missingPermissions) violations.push(`permission.missing.${permission}`);
  for (const capability of missingCapabilities) violations.push(`capability.missing.${capability}`);
  if (targetClassification.kind === "artifact" && !contentIntegrity.digest) {
    violations.push("artifact.digest.required");
  }
  if (targetClassification.kind === "artifact" && request.operation === "append") {
    violations.push("artifact.append.disabled");
  }
  if (
    targetClassification.kind === "product" &&
    !syncMetadata.previousRevision &&
    !syncMetadata.revision
  ) {
    violations.push("product.revision.required");
  }
  if (targetClassification.kind === "workspace" && contentIntegrity.integrityLevel === "unverified") {
    warnings.push("workspace.integrity.unverified");
  }

  return {
    version: "aios.fs-write.target-policy.v1",
    accepted: violations.length === 0,
    targetKind: targetClassification.kind,
    namespace: targetClassification.namespace,
    immutable: targetClassification.immutable,
    requiresDigest: targetClassification.requiresDigest,
    requiresRevision: targetClassification.requiresRevision,
    requiredCapabilities: targetClassification.requiredCapabilities,
    missingCapabilities,
    requiredPermissions: targetClassification.requiredPermissions,
    missingPermissions,
    capabilityProofState,
    permissionProofState,
    effectivePermissionGrants: targetClassification.requiredPermissions.filter((permission) => grants.has(permission)),
    auditSubject: targetClassification.auditSubject,
    auditHandoff: {
      version: "aios.fs-write.target-boundary-audit.v1",
      subject: targetClassification.auditSubject,
      kind: targetClassification.kind,
      scopedPath: targetClassification.scopedPath,
      tenantId: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      capabilityProofState,
      permissionProofState,
      requiredCapabilities: targetClassification.requiredCapabilities,
      missingCapabilities,
      requiredPermissions: targetClassification.requiredPermissions,
      missingPermissions
    },
    violations,
    warnings,
    route:
      violations.length > 0
        ? "fs.write.target.resolve"
        : targetClassification.kind === "artifact"
          ? "fs.write.artifact.commit"
          : targetClassification.kind === "product"
            ? "fs.write.product.commit"
            : "fs.write.workspace.commit"
  };
}

function summarizeValidation(
  violations,
  negotiation,
  externalHandoff,
  lifecycleSettings,
  providerServiceContract,
  contentIntegrity,
  providerHandoffContract,
  targetPolicy,
  persistedStateTruth
) {
  const contractRequiredMissing = negotiation.missing.filter((capability) => {
    if (!providerServiceContract) return false;
    if (providerServiceContract.requiredCapabilities.includes(capability)) return true;
    if (capability === "fs.write.audit" && providerServiceContract.auditRequired) return true;
    if (capability === "fs.write.sync-metadata" && providerServiceContract.syncMetadataRequired) return true;
    return false;
  });
  const blocking = [
    ...violations,
    ...negotiation.missing
      .filter((capability) => capability === "fs.write")
      .map((capability) => `capability.missing.${capability}`),
    ...contractRequiredMissing.map((capability) => `capability.missing.${capability}`),
    ...(externalHandoff.state === "blocked" ? ["externalHandoff.blocked"] : [])
  ];
  const blockingSet = new Set(blocking);
  const warning = [
    ...(lifecycleSettings ? lifecycleSettings.warnings : []),
    ...(providerServiceContract ? providerServiceContract.warnings : []),
    ...(contentIntegrity ? contentIntegrity.warnings : []),
    ...(targetPolicy ? targetPolicy.warnings : []),
    ...(persistedStateTruth ? persistedStateTruth.warnings : []),
    ...negotiation.missing
      .filter((capability) => capability !== "fs.write")
      .filter((capability) => !blockingSet.has(`capability.missing.${capability}`))
      .map((capability) => `capability.missing.${capability}`),
    ...(externalHandoff.state === "deferred" ? ["externalHandoff.deferred"] : [])
  ];
  const userFixable = violations.filter(
    (violation) => USER_FIXABLE_VIOLATIONS.has(violation) || violation.startsWith("permission.missing.")
  );
  const systemFixable = blocking.filter((issue) => !USER_FIXABLE_VIOLATIONS.has(issue));

  return {
    status: blocking.length > 0 ? "blocked" : warning.length > 0 ? "ready-with-warnings" : "ready",
    blocking,
    warning,
    userFixable,
    systemFixable,
    counts: {
      blocking: blocking.length,
      warning: warning.length,
      userFixable: userFixable.length,
      systemFixable: systemFixable.length
    }
  };
}

function negotiateCapabilities(provider, requestedCapabilities, providerServiceContract, targetClassification, productSyncContract) {
  const contractRequested = providerServiceContract
    ? [
        ...DEFAULT_REQUESTED_CAPABILITIES,
        ...providerServiceContract.requiredCapabilities,
        ...(targetClassification ? targetClassification.requiredCapabilities : []),
        ...(productSyncContract ? productSyncContract.requiredCapabilities : []),
        ...(providerServiceContract.auditRequired ? ["fs.write.audit"] : []),
        ...(providerServiceContract.syncMetadataRequired ? ["fs.write.sync-metadata"] : []),
        ...(providerServiceContract.handoffRequired ? ["fs.write.external-handoff"] : [])
      ]
    : [
        ...DEFAULT_REQUESTED_CAPABILITIES,
        ...(targetClassification ? targetClassification.requiredCapabilities : []),
        ...(productSyncContract ? productSyncContract.requiredCapabilities : [])
      ];
  const requested = uniqueStrings([
    ...contractRequested,
    ...(Array.isArray(requestedCapabilities) ? requestedCapabilities : [])
  ], contractRequested);
  const disabledCapabilities = new Set(providerServiceContract ? providerServiceContract.disabledCapabilities : []);
  const providerCapabilities = new Set(provider.capabilities.filter((capability) => !disabledCapabilities.has(capability)));
  const granted = requested.filter((capability) => providerCapabilities.has(capability));
  const missing = requested.filter((capability) => !providerCapabilities.has(capability));
  const requiredMissing = missing.filter((capability) => capability === "fs.write");

  return {
    requested,
    granted,
    missing,
    accepted: requiredMissing.length === 0,
    providerProtocol: provider.protocol,
    effectiveProviderCapabilities: [...providerCapabilities],
    serviceContract: providerServiceContract
      ? {
          serviceId: providerServiceContract.serviceId,
          serviceLevel: providerServiceContract.serviceLevel,
          writeMode: providerServiceContract.writeMode,
          disabledCapabilities: providerServiceContract.disabledCapabilities,
          requiredCapabilities: providerServiceContract.requiredCapabilities,
          productSyncRequired: productSyncContract ? productSyncContract.required : false
        }
      : null
  };
}

function buildSyncMetadata(input, request, provider, generatedAt) {
  const sync = input.sync && typeof input.sync === "object" ? input.sync : {};
  const previousRevision =
    typeof sync.previousRevision === "string" && sync.previousRevision.trim()
      ? sync.previousRevision
      : null;
  const revision =
    typeof sync.revision === "string" && sync.revision.trim()
      ? sync.revision
      : `${request.correlationId}:${request.byteLength}:${generatedAt}`;

  return {
    revision,
    previousRevision,
    syncScope: typeof sync.scope === "string" && sync.scope.trim() ? sync.scope : "hosted-kernel",
    durability: provider.durability,
    conflictPolicy:
      sync.conflictPolicy === "fail-if-changed" || sync.conflictPolicy === "last-writer-wins"
        ? sync.conflictPolicy
        : "fail-if-changed",
    observedAt: generatedAt
  };
}

function buildProductSyncContract(input, targetClassification, syncMetadata, providerServiceContract, generatedAt) {
  const productSyncInput =
    input.productSync && typeof input.productSync === "object"
      ? input.productSync
      : input.sync && input.sync.product && typeof input.sync.product === "object"
        ? input.sync.product
        : {};
  const providerSync = providerServiceContract.productSync || {};
  const targetProductId = targetClassification.kind === "product" ? targetClassification.productId : null;
  const requestedProductId =
    typeof productSyncInput.productId === "string" && productSyncInput.productId.trim()
      ? productSyncInput.productId.trim()
      : targetProductId;
  const serviceProductId = providerSync.serviceProductId || null;
  const schemaVersion =
    typeof productSyncInput.schemaVersion === "string" && productSyncInput.schemaVersion.trim()
      ? productSyncInput.schemaVersion.trim()
      : providerSync.schemaVersion;
  const lockInput = productSyncInput.lock && typeof productSyncInput.lock === "object"
    ? productSyncInput.lock
    : {};
  const lockToken =
    typeof lockInput.token === "string" && lockInput.token.trim()
      ? lockInput.token.trim()
      : typeof productSyncInput.lockToken === "string" && productSyncInput.lockToken.trim()
        ? productSyncInput.lockToken.trim()
        : null;
  const lockExpiresAt =
    typeof lockInput.expiresAt === "string" && lockInput.expiresAt.trim()
      ? lockInput.expiresAt.trim()
      : typeof productSyncInput.lockExpiresAt === "string" && productSyncInput.lockExpiresAt.trim()
        ? productSyncInput.lockExpiresAt.trim()
        : null;
  const lockExpired = Boolean(lockExpiresAt && Date.parse(lockExpiresAt) <= Date.parse(generatedAt));
  const required =
    targetClassification.kind === "product" &&
    providerSync.enabled !== false &&
    (providerSync.required || providerServiceContract.syncMetadataRequired);
  const productMatches =
    !required ||
    !serviceProductId ||
    !requestedProductId ||
    serviceProductId === requestedProductId;
  const lockRequired = required && providerSync.lockRequired;
  const violations = uniqueStrings([
    required && !productMatches ? "productSync.product_mismatch" : "",
    required && !schemaVersion ? "productSync.schema.required" : "",
    lockRequired && !lockToken ? "productSync.provider_lock.required" : "",
    lockRequired && lockExpired ? "productSync.provider_lock.expired" : ""
  ], []);
  const requiredCapabilities = required
    ? uniqueStrings(
        [
          "fs.write.product",
          "fs.write.sync-metadata",
          ...providerSync.requiredCapabilities
        ],
        []
      )
    : [];

  return {
    version: "aios.fs-write.product-sync-contract.v1",
    required,
    state:
      targetClassification.kind !== "product"
        ? "not-required"
        : violations.length > 0
          ? "blocked"
          : required
            ? "ready"
            : "optional",
    authority: providerSync.authority || "provider",
    conflictStrategy: providerSync.conflictStrategy || syncMetadata.conflictPolicy,
    targetProductId,
    requestedProductId,
    serviceProductId,
    productMatches,
    schemaVersion,
    revision: syncMetadata.revision,
    previousRevision: syncMetadata.previousRevision,
    lock: {
      required: lockRequired,
      tokenPresent: Boolean(lockToken),
      expiresAt: lockExpiresAt,
      expired: lockExpired
    },
    requiredCapabilities,
    requiredBeforeCommit: violations,
    auditSubject: [
      "product-sync",
      targetProductId || requestedProductId || "unresolved",
      schemaVersion || "schema:missing",
      syncMetadata.revision
    ].join("|"),
    statePatch: {
      productId: targetProductId || requestedProductId,
      syncAuthority: providerSync.authority || "provider",
      conflictStrategy: providerSync.conflictStrategy || syncMetadata.conflictPolicy,
      schemaVersion,
      revision: syncMetadata.revision,
      previousRevision: syncMetadata.previousRevision,
      lockTokenPresent: Boolean(lockToken),
      lockExpiresAt,
      productSyncState: violations.length > 0 ? "blocked" : required ? "ready" : "optional",
      updatedAt: generatedAt
    }
  };
}

function buildExternalHandoff(input, request, negotiation, providerServiceContract) {
  const handoff = input.externalHandoff && typeof input.externalHandoff === "object" ? input.externalHandoff : {};
  const required = handoff.required === true || (providerServiceContract && providerServiceContract.handoffRequired);
  const wanted = required || negotiation.granted.includes("fs.write.external-handoff");
  const state = typeof handoff.state === "string" && EXTERNAL_HANDOFF_STATES.has(handoff.state)
    ? handoff.state
    : required && !negotiation.granted.includes("fs.write.external-handoff")
      ? "blocked"
    : wanted
      ? "ready"
      : "not-required";

  return {
    state,
    required,
    target:
      typeof handoff.target === "string" && handoff.target.trim()
        ? handoff.target
        : "hosted-kernel.write-queue",
    token:
      typeof handoff.token === "string" && handoff.token.trim()
        ? handoff.token
        : `${request.correlationId}:handoff`,
    reason:
      state === "blocked"
        ? required
          ? "provider_contract_requires_handoff_capability"
          : "provider_capability_or_policy_block"
        : state === "deferred"
          ? "awaiting_external_consumer"
      : "write_contract_ready"
  };
}

function buildProviderHandoffContract({
  input,
  request,
  provider,
  workspaceScope,
  syncMetadata,
  contentIntegrity,
  externalHandoff,
  providerServiceContract,
  generatedAt
}) {
  const handoff = input.externalHandoff && typeof input.externalHandoff === "object" ? input.externalHandoff : {};
  const acknowledgement =
    handoff.acknowledgement && typeof handoff.acknowledgement === "object"
      ? handoff.acknowledgement
      : handoff.ack && typeof handoff.ack === "object"
        ? handoff.ack
        : {};
  const requireAcknowledgement =
    handoff.requireAcknowledgement === true ||
    acknowledgement.required === true ||
    (providerServiceContract && providerServiceContract.handoffRequired);
  const deliveryInput =
    typeof handoff.deliveryGuarantee === "string" && handoff.deliveryGuarantee.trim()
      ? handoff.deliveryGuarantee.trim()
      : requireAcknowledgement
        ? "at-least-once"
        : "at-most-once";
  const deliveryGuarantee = HANDOFF_DELIVERY_GUARANTEES.has(deliveryInput)
    ? deliveryInput
    : "at-most-once";
  const deadlineInput =
    typeof acknowledgement.deadlineAt === "string" && acknowledgement.deadlineAt.trim()
      ? acknowledgement.deadlineAt.trim()
      : typeof handoff.deadlineAt === "string" && handoff.deadlineAt.trim()
        ? handoff.deadlineAt.trim()
        : null;
  const deadlineMs = deadlineInput ? Date.parse(deadlineInput) : NaN;
  const deadlineAt = Number.isFinite(deadlineMs) ? new Date(deadlineMs).toISOString() : null;
  const deadlineExpired = Boolean(deadlineAt && deadlineMs <= Date.parse(generatedAt));
  const expectedAckToken =
    typeof acknowledgement.expectedToken === "string" && acknowledgement.expectedToken.trim()
      ? acknowledgement.expectedToken.trim()
      : `${externalHandoff.token}:ack`;
  const submittedAckToken =
    typeof acknowledgement.token === "string" && acknowledgement.token.trim()
      ? acknowledgement.token.trim()
      : typeof acknowledgement.ackToken === "string" && acknowledgement.ackToken.trim()
        ? acknowledgement.ackToken.trim()
        : null;
  const ackTokenValid = !requireAcknowledgement || submittedAckToken === expectedAckToken;
  const acknowledgedAt =
    typeof acknowledgement.acceptedAt === "string" && acknowledgement.acceptedAt.trim()
      ? acknowledgement.acceptedAt.trim()
      : typeof acknowledgement.acknowledgedAt === "string" && acknowledgement.acknowledgedAt.trim()
        ? acknowledgement.acknowledgedAt.trim()
        : null;
  const submittedAckState =
    typeof acknowledgement.state === "string" && HANDOFF_ACK_STATES.has(acknowledgement.state)
      ? acknowledgement.state
      : null;
  const acknowledgementState = !requireAcknowledgement
    ? "not-required"
    : deadlineExpired && !acknowledgedAt
      ? "expired"
      : submittedAckState === "rejected"
        ? "rejected"
        : ackTokenValid && acknowledgedAt
          ? "accepted"
          : "pending";
  const commitBarrier = requireAcknowledgement && acknowledgementState !== "accepted";
  const state = externalHandoff.state === "blocked"
    ? "blocked"
    : externalHandoff.state === "deferred" || commitBarrier
      ? "deferred"
      : externalHandoff.state;

  return {
    version: "aios.fs-write.provider-handoff-contract.v1",
    state,
    transferId:
      typeof handoff.transferId === "string" && handoff.transferId.trim()
        ? handoff.transferId.trim()
        : `${request.correlationId}:transfer:${provider.id}`,
    providerId: provider.id,
    serviceId: providerServiceContract ? providerServiceContract.serviceId : `${provider.id}:service`,
    target: externalHandoff.target,
    token: externalHandoff.token,
    delivery: {
      guarantee: deliveryGuarantee,
      queue:
        typeof handoff.queue === "string" && handoff.queue.trim()
          ? handoff.queue.trim()
          : externalHandoff.target,
      deadlineAt,
      deadlineExpired
    },
    acknowledgement: {
      required: requireAcknowledgement,
      state: acknowledgementState,
      expectedToken: expectedAckToken,
      tokenPresent: Boolean(submittedAckToken),
      tokenValid: ackTokenValid,
      acceptedAt: acknowledgementState === "accepted" ? acknowledgedAt || generatedAt : null
    },
    payload: {
      operation: request.operation,
      scopedPath: workspaceScope.path.scoped,
      tenantId: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      byteLength: request.byteLength,
      contentDigest: contentIntegrity.digest,
      contentIntegrityLevel: contentIntegrity.integrityLevel,
      syncRevision: syncMetadata.revision,
      previousRevision: syncMetadata.previousRevision
    },
    commitBarrier,
    requiredBeforeCommit: commitBarrier ? ["externalHandoff.ack_required"] : [],
    statePatch: {
      correlationId: request.correlationId,
      transferId:
        typeof handoff.transferId === "string" && handoff.transferId.trim()
          ? handoff.transferId.trim()
          : `${request.correlationId}:transfer:${provider.id}`,
      providerId: provider.id,
      handoffState: state,
      acknowledgementState,
      acknowledgementToken: expectedAckToken,
      deadlineAt
    }
  };
}

function buildAuditProof(
  input,
  request,
  provider,
  negotiation,
  syncMetadata,
  contentIntegrity,
  generatedAt,
  violations,
  workspaceScope,
  boundaryEvaluation,
  lifecycleSettings,
  persistedState,
  providerServiceContract,
  clientDraft,
  providerHandoffContract,
  productWorkflowHandoff,
  productSyncContract,
  targetClassification,
  targetPolicy,
  readiness,
  persistedStateTruth
) {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  return {
    auditEvent: {
      type: "syscall.fs.write.contract.evaluated",
      surfaceId,
      at: generatedAt,
      actor: request.actor,
      correlationId: request.correlationId,
      providerId: provider.id,
      operation: request.operation,
      path: request.path,
      scopedPath: workspaceScope.path.scoped,
      tenantId: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      targetKind: targetClassification.kind,
      targetNamespace: targetClassification.namespace,
      byteLength: request.byteLength,
      accepted: readiness
        ? readiness.readyToCommit
        : violations.length === 0 && negotiation.accepted && boundaryEvaluation.accepted
    },
    proof: {
      contractVersion: WRITE_CONTRACT_VERSION,
      requiredCapabilities: ["fs.write"],
      grantedCapabilities: negotiation.granted,
      missingCapabilities: negotiation.missing,
      providerServiceContract: providerServiceContract
        ? {
            serviceId: providerServiceContract.serviceId,
            serviceLevel: providerServiceContract.serviceLevel,
            writeMode: providerServiceContract.writeMode,
            active: providerServiceContract.active,
            expiresAt: providerServiceContract.expiresAt,
            quota: providerServiceContract.quota,
            leaseRequired: providerServiceContract.lease.required,
            leaseTokenPresent: providerServiceContract.lease.tokenPresent,
            violations: providerServiceContract.violations,
            warnings: providerServiceContract.warnings
        }
        : null,
      providerHandoff: providerHandoffContract
        ? {
            version: providerHandoffContract.version,
            state: providerHandoffContract.state,
            transferId: providerHandoffContract.transferId,
            target: providerHandoffContract.target,
            deliveryGuarantee: providerHandoffContract.delivery.guarantee,
            acknowledgementState: providerHandoffContract.acknowledgement.state,
            acknowledgementRequired: providerHandoffContract.acknowledgement.required,
            commitBarrier: providerHandoffContract.commitBarrier,
            requiredBeforeCommit: providerHandoffContract.requiredBeforeCommit
          }
        : null,
      requiredPermission: workspaceScope.requestedPermission,
      permissionGranted: boundaryEvaluation.permission.granted,
      tenantBoundary: boundaryEvaluation.boundary,
      tenantPermissionBoundary: {
        version: workspaceScope.tenantBoundary.version,
        isolationMode: workspaceScope.tenantBoundary.isolationMode,
        tenantId: workspaceScope.tenantBoundary.tenantId,
        workspaceId: workspaceScope.tenantBoundary.workspaceId,
        actorTenantId: workspaceScope.tenantBoundary.actorTenantId,
        trustedTenantIds: workspaceScope.tenantBoundary.trustedTenantIds,
        allowedWorkspaceIds: workspaceScope.tenantBoundary.allowedWorkspaceIds,
        actorTenantMatches: workspaceScope.tenantBoundary.actorTenantMatches,
        tenantTrusted: workspaceScope.tenantBoundary.tenantTrusted,
        workspaceAllowed: workspaceScope.tenantBoundary.workspaceAllowed,
        delegationAccepted: workspaceScope.tenantBoundary.delegationAccepted,
        delegatedBy: workspaceScope.tenantBoundary.delegatedBy,
        auditSubject: workspaceScope.tenantBoundary.auditSubject
      },
      lifecycle: lifecycleSettings
        ? {
            command: lifecycleSettings.command,
            mode: lifecycleSettings.mode,
            sourceMode: lifecycleSettings.sourceMode,
            enabled: lifecycleSettings.enabled,
            schedulePolicy: lifecycleSettings.schedule.policy,
            scheduledAt: lifecycleSettings.schedule.scheduledAt,
            scheduleDue: lifecycleSettings.schedule.due,
            maintenanceWindow: lifecycleSettings.schedule.maintenanceWindow,
            maxByteLength: lifecycleSettings.maxByteLength,
            commandPlan: lifecycleSettings.commandPlan
          }
        : null,
      persistedState: persistedState
        ? {
            version: persistedState.version,
            phase: persistedState.phase,
            idempotencyKey: persistedState.idempotencyKey,
            fingerprintMatches: persistedState.fingerprintMatches,
            restartSafe: persistedState.restartSafe,
            restoredFromJournal: persistedState.restoredFromJournal,
            journalSequence: persistedState.journal.sequence,
            command: persistedState.command,
            recovery: persistedState.recovery,
            restartPlan: {
              status: persistedState.restartPlan.status,
              route: persistedState.restartPlan.route,
              stablePhase: persistedState.restartPlan.stablePhase,
              checkpointRequired: persistedState.restartPlan.checkpointRequired,
              requiredBeforeRestartSafe: persistedState.restartPlan.requiredBeforeRestartSafe
            },
            commandLedger: {
              token: persistedState.commandLedger.token,
              outcome: persistedState.commandLedger.outcome,
              accepted: persistedState.commandLedger.accepted,
              idempotent: persistedState.commandLedger.idempotent,
              replaySafe: persistedState.commandLedger.replaySafe
            }
          }
        : null,
      persistedStateTruth: persistedStateTruth
        ? {
            version: persistedStateTruth.version,
            accepted: persistedStateTruth.accepted,
            phase: persistedStateTruth.phase,
            fingerprintMatches: persistedStateTruth.fingerprintMatches,
            terminalAcknowledgement: persistedStateTruth.terminalAcknowledgement,
            recoveryRequired: persistedStateTruth.recoveryRequired,
            commitAllowed: persistedStateTruth.commitAllowed,
            route: persistedStateTruth.route,
            commandOutcome: persistedStateTruth.commandOutcome,
            restartStatus: persistedStateTruth.restartStatus,
            violations: persistedStateTruth.violations,
            warnings: persistedStateTruth.warnings,
            requiredBeforeCommit: persistedStateTruth.requiredBeforeCommit
          }
        : null,
      clientDraft: clientDraft
        ? {
            version: clientDraft.version,
            draftId: clientDraft.draftId,
            source: clientDraft.source,
            adoptionState: clientDraft.adoptionState,
            dirty: clientDraft.dirty,
            matchesRequest: clientDraft.matchesRequest,
            scopedPath: clientDraft.scopedPath,
            pendingBytes: clientDraft.pendingBytes,
            warnings: clientDraft.warnings
          }
        : null,
      productWorkflowHandoff: productWorkflowHandoff
        ? {
            version: productWorkflowHandoff.version,
            required: productWorkflowHandoff.required,
            state: productWorkflowHandoff.state,
            targetProductId: productWorkflowHandoff.targetProductId,
            activeProductId: productWorkflowHandoff.activeProductId,
            productMatches: productWorkflowHandoff.productMatches,
            revision: productWorkflowHandoff.revision,
            acknowledgementState: productWorkflowHandoff.acknowledgement.state,
            tokenPresent: productWorkflowHandoff.acknowledgement.tokenPresent,
            tokenValid: productWorkflowHandoff.acknowledgement.tokenValid,
            requiredBeforeCommit: productWorkflowHandoff.requiredBeforeCommit
        }
        : null,
      productSyncContract: productSyncContract
        ? {
            version: productSyncContract.version,
            required: productSyncContract.required,
            state: productSyncContract.state,
            authority: productSyncContract.authority,
            conflictStrategy: productSyncContract.conflictStrategy,
            targetProductId: productSyncContract.targetProductId,
            requestedProductId: productSyncContract.requestedProductId,
            serviceProductId: productSyncContract.serviceProductId,
            productMatches: productSyncContract.productMatches,
            schemaVersion: productSyncContract.schemaVersion,
            revision: productSyncContract.revision,
            previousRevision: productSyncContract.previousRevision,
            lock: productSyncContract.lock,
            requiredCapabilities: productSyncContract.requiredCapabilities,
            requiredBeforeCommit: productSyncContract.requiredBeforeCommit,
            auditSubject: productSyncContract.auditSubject
          }
        : null,
      targetClassification: {
        version: targetClassification.version,
        kind: targetClassification.kind,
        namespace: targetClassification.namespace,
        productId: targetClassification.productId,
        artifactId: targetClassification.artifactId,
        immutable: targetClassification.immutable,
        requiresDigest: targetClassification.requiresDigest,
        requiresRevision: targetClassification.requiresRevision,
        requiredCapabilities: targetClassification.requiredCapabilities,
        requiredPermissions: targetClassification.requiredPermissions,
        auditSubject: targetClassification.auditSubject
      },
      targetPolicy: {
        version: targetPolicy.version,
        accepted: targetPolicy.accepted,
        route: targetPolicy.route,
        requiredCapabilities: targetPolicy.requiredCapabilities,
        missingCapabilities: targetPolicy.missingCapabilities,
        requiredPermissions: targetPolicy.requiredPermissions,
        missingPermissions: targetPolicy.missingPermissions,
        capabilityProofState: targetPolicy.capabilityProofState,
        permissionProofState: targetPolicy.permissionProofState,
        auditHandoff: targetPolicy.auditHandoff,
        violations: targetPolicy.violations,
        warnings: targetPolicy.warnings
      },
      commitGateAudit: readiness
        ? readiness.commitGateAudit
        : null,
      syncRevision: syncMetadata.revision,
      contentHash: request.contentHash || null,
      contentDigest: contentIntegrity.digest,
      contentIntegrityLevel: contentIntegrity.integrityLevel,
      evidenceCount: evidence.length
    },
    contentIntegrity: {
      version: contentIntegrity.version,
      algorithm: contentIntegrity.algorithm,
      digest: contentIntegrity.digest,
      digestMatchesRequest: contentIntegrity.digestMatchesRequest,
      byteLength: contentIntegrity.byteLength,
      byteLengthMatchesRequest: contentIntegrity.byteLengthMatchesRequest,
      integrityLevel: contentIntegrity.integrityLevel,
      chunkCount: contentIntegrity.chunks.count,
      violations: contentIntegrity.violations,
      warnings: contentIntegrity.warnings
    },
    evidence
  };
}

function buildWritePreview(
  request,
  provider,
  syncMetadata,
  contentIntegrity,
  externalHandoff,
  validationSummary,
  workspaceScope,
  targetClassification,
  targetPolicy,
  productSyncContract
) {
  const targetKind = request.path.startsWith("/")
    ? "absolute-path"
    : request.path
      ? "relative-path"
      : "unresolved-path";
  const impact = request.operation === "append" ? "append-bytes" : "replace-or-create";

  return {
    title: request.path ? `${request.operation} ${request.path}` : "write target required",
    impact,
    target: {
      path: request.path || null,
      kind: targetKind,
      scopedPath: workspaceScope.path.scoped,
      workspaceRoot: workspaceScope.rootPath,
      insideWorkspace: workspaceScope.path.insideWorkspace,
      allowedPrefixes: workspaceScope.path.allowedPrefixes,
      insideAllowedPrefix: workspaceScope.path.insideAllowedPrefix,
      classification: {
        kind: targetClassification.kind,
        namespace: targetClassification.namespace,
        productId: targetClassification.productId,
        artifactId: targetClassification.artifactId,
        immutable: targetClassification.immutable,
        auditSubject: targetClassification.auditSubject
      },
      policy: {
        accepted: targetPolicy.accepted,
        route: targetPolicy.route,
        requiredCapabilities: targetPolicy.requiredCapabilities,
        missingCapabilities: targetPolicy.missingCapabilities,
        requiredPermissions: targetPolicy.requiredPermissions,
        missingPermissions: targetPolicy.missingPermissions,
        capabilityProofState: targetPolicy.capabilityProofState,
        permissionProofState: targetPolicy.permissionProofState,
        issues: [...targetPolicy.violations, ...targetPolicy.warnings]
      }
    },
    productSync: productSyncContract
      ? {
          required: productSyncContract.required,
          state: productSyncContract.state,
          authority: productSyncContract.authority,
          conflictStrategy: productSyncContract.conflictStrategy,
          targetProductId: productSyncContract.targetProductId,
          requestedProductId: productSyncContract.requestedProductId,
          serviceProductId: productSyncContract.serviceProductId,
          productMatches: productSyncContract.productMatches,
          schemaVersion: productSyncContract.schemaVersion,
          revision: productSyncContract.revision,
          previousRevision: productSyncContract.previousRevision,
          lockRequired: productSyncContract.lock.required,
          lockTokenPresent: productSyncContract.lock.tokenPresent,
          lockExpired: productSyncContract.lock.expired,
          requiredBeforeCommit: productSyncContract.requiredBeforeCommit,
          route:
            productSyncContract.state === "blocked"
              ? "fs.write.product-sync.resolve"
              : productSyncContract.required
                ? "fs.write.product-sync.ready"
                : "fs.write.product-sync.optional"
        }
      : null,
    byteLength: request.byteLength,
    durability: provider.durability,
    tenant: {
      id: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      permission: workspaceScope.requestedPermission,
      roles: workspaceScope.roles,
      isolationMode: workspaceScope.tenantBoundary.isolationMode,
      actorTenantId: workspaceScope.tenantBoundary.actorTenantId,
      actorTenantMatches: workspaceScope.tenantBoundary.actorTenantMatches,
      workspaceAllowed: workspaceScope.tenantBoundary.workspaceAllowed
    },
    sync: {
      revision: syncMetadata.revision,
      previousRevision: syncMetadata.previousRevision,
      conflictPolicy: syncMetadata.conflictPolicy
    },
    integrity: {
      level: contentIntegrity.integrityLevel,
      algorithm: contentIntegrity.algorithm,
      digestPresent: Boolean(contentIntegrity.digest),
      byteLengthMatchesRequest: contentIntegrity.byteLengthMatchesRequest,
      digestMatchesRequest: contentIntegrity.digestMatchesRequest
    },
    externalHandoff: {
      state: externalHandoff.state,
      target: externalHandoff.target
    },
    disclosure: {
      destructive: request.operation === "write" && request.byteLength > 0,
      requiresAcceptance: validationSummary.status === "ready-with-warnings",
      canAutoCommit: validationSummary.status === "ready" && targetPolicy.accepted
    }
  };
}

function buildAcceptanceContract(input, request, validationSummary, negotiation, generatedAt) {
  const mode = validationSummary.status === "ready" ? "auto-acceptable" : "explicit-review";
  const blocked = validationSummary.status === "blocked";
  const requiredAcknowledgements = [];
  if (request.operation === "write") requiredAcknowledgements.push("write.may_replace_existing_content");
  if (negotiation.missing.length > 0) requiredAcknowledgements.push("capability.partial_grant_reviewed");
  if (validationSummary.warning.length > 0) requiredAcknowledgements.push("warnings.reviewed");
  const generatedToken = blocked
    ? null
    : `${request.correlationId}:accept:${request.operation}:${request.byteLength}`;
  const acceptanceInput =
    input.acceptance && typeof input.acceptance === "object"
      ? input.acceptance
      : input.clientAcceptance && typeof input.clientAcceptance === "object"
        ? input.clientAcceptance
        : {};
  const submittedDecision =
    typeof acceptanceInput.decision === "string" && ACCEPTANCE_DECISIONS.has(acceptanceInput.decision)
      ? acceptanceInput.decision
      : "pending";
  const submittedAcknowledgements = uniqueStrings(
    acceptanceInput.acknowledgements || acceptanceInput.acknowledged,
    []
  );
  const submittedToken =
    typeof acceptanceInput.token === "string" && acceptanceInput.token.trim()
      ? acceptanceInput.token.trim()
      : typeof acceptanceInput.acceptanceToken === "string" && acceptanceInput.acceptanceToken.trim()
        ? acceptanceInput.acceptanceToken.trim()
        : null;
  const tokenValid = !generatedToken || submittedToken === generatedToken;
  const missingAcknowledgements = requiredAcknowledgements.filter(
    (acknowledgement) => !submittedAcknowledgements.includes(acknowledgement)
  );
  const accepted =
    !blocked &&
    submittedDecision === "accepted" &&
    tokenValid &&
    missingAcknowledgements.length === 0;
  const rejected = blocked || submittedDecision === "rejected";
  const decision = rejected ? "rejected" : accepted ? "accepted" : "pending";
  const rejectedReason = blocked
    ? validationSummary.blocking[0] || "validation_blocked"
    : submittedDecision === "rejected"
      ? "user_rejected"
      : !tokenValid
        ? "acceptance_token_mismatch"
        : missingAcknowledgements[0] || null;

  return {
    version: "aios.fs-write.acceptance.v1",
    decision,
    mode,
    accepted,
    acceptedAt:
      accepted && typeof acceptanceInput.acceptedAt === "string" && acceptanceInput.acceptedAt.trim()
        ? acceptanceInput.acceptedAt.trim()
        : accepted
          ? generatedAt
          : null,
    rejectedReason,
    actor: request.actor,
    correlationId: request.correlationId,
    generatedAt,
    requiredAcknowledgements,
    missingAcknowledgements,
    acceptanceToken: generatedToken,
    submission: {
      decision: submittedDecision,
      tokenPresent: Boolean(submittedToken),
      tokenValid,
      acknowledgements: submittedAcknowledgements,
      missingAcknowledgements,
      canResubmit: !blocked && (!tokenValid || missingAcknowledgements.length > 0 || submittedDecision !== "accepted")
    },
    routeCommand:
      decision === "accepted"
        ? "fs.write.acceptance.accepted"
        : decision === "rejected"
          ? "fs.write.acceptance.rejected"
          : "fs.write.acceptance.request"
  };
}

function requestFingerprint(request, workspaceScope, syncMetadata, contentIntegrity) {
  return [
    workspaceScope.tenantId || "tenant:unselected",
    workspaceScope.workspaceId || "workspace:unselected",
    workspaceScope.path.scoped || "path:unresolved",
    request.operation,
    request.byteLength,
    contentIntegrity && contentIntegrity.digest
      ? `${contentIntegrity.algorithm}:${contentIntegrity.digest}`
      : request.contentHash || "content:unknown",
    syncMetadata.previousRevision || "previous:none"
  ].join("|");
}

function normalizePersistedCommandJournal(source, command, fingerprint, generatedAt) {
  const journalInput = source.journal && typeof source.journal === "object" ? source.journal : {};
  const commandInput = source.command && typeof source.command === "object" ? source.command : {};
  const historyInput = Array.isArray(source.commandHistory)
    ? source.commandHistory
    : Array.isArray(commandInput.history)
      ? commandInput.history
      : [];
  const history = historyInput
    .filter((entry) => entry && typeof entry === "object")
    .slice(-8)
    .map((entry, index) => ({
      command:
        typeof entry.command === "string" && LIFECYCLE_COMMANDS.has(entry.command)
          ? entry.command
          : "prepare",
      token:
        typeof entry.token === "string" && entry.token.trim()
          ? entry.token.trim()
          : `${command}:${fingerprint}:${index}`,
      phase:
        typeof entry.phase === "string" && PERSISTED_STATE_PHASES.has(entry.phase)
          ? entry.phase
          : null,
      acceptedAt:
        typeof entry.acceptedAt === "string" && entry.acceptedAt.trim()
          ? entry.acceptedAt.trim()
          : null
    }));
  const requestedToken =
    typeof commandInput.token === "string" && commandInput.token.trim()
      ? commandInput.token.trim()
      : typeof source.commandToken === "string" && source.commandToken.trim()
        ? source.commandToken.trim()
        : `${command}:${fingerprint}`;
  const lastMatchingCommand = [...history].reverse().find((entry) => entry.token === requestedToken);

  return {
    provider:
      typeof journalInput.provider === "string" && journalInput.provider.trim()
        ? journalInput.provider.trim()
        : "hosted-kernel-journal",
    sequence:
      Number.isInteger(journalInput.sequence) && journalInput.sequence >= 0
        ? journalInput.sequence
        : null,
    checkpoint:
      typeof journalInput.checkpoint === "string" && journalInput.checkpoint.trim()
        ? journalInput.checkpoint.trim()
        : null,
    restored: journalInput.restored === true,
    lastFlushedAt:
      typeof journalInput.lastFlushedAt === "string" && journalInput.lastFlushedAt.trim()
        ? journalInput.lastFlushedAt.trim()
        : null,
    command: {
      requested: command,
      token: requestedToken,
      replayed: Boolean(lastMatchingCommand),
      historyCount: history.length,
      lastAcceptedAt: lastMatchingCommand ? lastMatchingCommand.acceptedAt || generatedAt : null
    },
    history
  };
}

function buildPersistedCommandLedger({ command, phase, targetPhase, commandJournal, fingerprintMatches, terminal, generatedAt }) {
  const alreadyApplied =
    fingerprintMatches &&
    (commandJournal.command.replayed ||
      phase === targetPhase ||
      (phase === "committed" && command === "commit") ||
      (phase === "cancelled" && (command === "cancel" || command === "disable")));
  const accepted = fingerprintMatches && !terminal && !alreadyApplied;
  const rejected = !fingerprintMatches || (terminal && !alreadyApplied);
  const outcome = alreadyApplied
    ? "already-applied"
    : accepted
      ? "accepted"
      : !fingerprintMatches
        ? "rejected-stale-fingerprint"
        : "rejected-terminal-state";

  return {
    version: "aios.fs-write.persisted-command-ledger.v1",
    token: commandJournal.command.token,
    idempotencyKey: `fs-write:${commandJournal.command.token}`,
    requested: command,
    targetPhase,
    accepted,
    idempotent: alreadyApplied,
    rejected,
    outcome,
    replayed: commandJournal.command.replayed,
    replaySafe: fingerprintMatches && (alreadyApplied || accepted),
    acceptedAt: accepted ? generatedAt : commandJournal.command.lastAcceptedAt,
    ledgerAppend: accepted
      ? {
          command,
          token: commandJournal.command.token,
          phase: targetPhase,
          acceptedAt: generatedAt
        }
      : null
  };
}

function buildRestartPlan({ phase, commandLedger, journalRecoverable, recoveryStatus, restartSafe, commandJournal, generatedAt }) {
  const route = PERSISTED_RECOVERY_ROUTES[recoveryStatus] || "fs.write.recovery.review";
  const needsJournalFlush =
    commandLedger.accepted &&
    !commandJournal.command.replayed &&
    commandJournal.sequence === null &&
    !commandJournal.checkpoint;
  const checkpointRequired =
    (phase === "queued" || phase === "committing" || commandLedger.accepted) &&
    !PERSISTED_STATE_TERMINAL_PHASES.has(phase);
  const canAutoResume =
    restartSafe &&
    recoveryStatus === "recoverable" &&
    (journalRecoverable || commandJournal.command.replayed);

  return {
    version: "aios.fs-write.restart-plan.v1",
    status: recoveryStatus,
    route,
    stablePhase: PERSISTED_PHASE_STABILITY[phase] || "unknown",
    restartSafe,
    canAutoResume,
    needsJournalFlush,
    checkpointRequired,
    expectedJournalSequence: commandJournal.sequence,
    checkpoint: commandJournal.checkpoint,
    resumeAfter:
      recoveryStatus === "recoverable"
        ? commandJournal.lastFlushedAt || generatedAt
        : null,
    requiredBeforeRestartSafe: [
      ...(needsJournalFlush ? ["journal.flush-command-ledger"] : []),
      ...(checkpointRequired && !commandJournal.checkpoint ? ["journal.persist-checkpoint"] : []),
      ...(recoveryStatus === "manual-review" ? ["operator.review-persisted-state"] : [])
    ],
    resumeCommand:
      canAutoResume
        ? phase === "committing"
          ? "fs.write.commit.resume"
          : "fs.write.journal.replay"
        : route
  };
}

function normalizePersistedWriteState(
  input,
  request,
  workspaceScope,
  syncMetadata,
  contentIntegrity,
  lifecycleSettings,
  generatedAt
) {
  const source =
    input.persistedState && typeof input.persistedState === "object"
      ? input.persistedState
      : input.state && typeof input.state === "object"
        ? input.state
        : {};
  const fingerprint = requestFingerprint(request, workspaceScope, syncMetadata, contentIntegrity);
  const phase = typeof source.phase === "string" && PERSISTED_STATE_PHASES.has(source.phase)
    ? source.phase
    : source.committedAt
      ? "committed"
      : source.enqueuedAt
        ? "queued"
        : "new";
  const storedFingerprint =
    typeof source.fingerprint === "string" && source.fingerprint.trim()
      ? source.fingerprint.trim()
      : null;
  const command = lifecycleSettings && LIFECYCLE_COMMANDS.has(lifecycleSettings.command)
    ? lifecycleSettings.command
    : "prepare";
  const commandJournal = normalizePersistedCommandJournal(source, command, fingerprint, generatedAt);
  const replayCount =
    Number.isInteger(source.replayCount) && source.replayCount >= 0
      ? Math.min(source.replayCount, 50)
      : 0;
  const recoveryCount =
    Number.isInteger(source.recoveryCount) && source.recoveryCount >= 0
      ? Math.min(source.recoveryCount, 50)
      : 0;
  const fingerprintMatches = !storedFingerprint || storedFingerprint === fingerprint;
  const terminal = PERSISTED_STATE_TERMINAL_PHASES.has(phase);
  const targetPhase = PERSISTED_COMMAND_TARGET_PHASE[command] || "prepared";
  const commandLedger = buildPersistedCommandLedger({
    command,
    phase,
    targetPhase,
    commandJournal,
    fingerprintMatches,
    terminal,
    generatedAt
  });
  const journalRecoverable =
    fingerprintMatches &&
    (commandJournal.restored || commandJournal.sequence !== null || Boolean(commandJournal.checkpoint)) &&
    PERSISTED_STATE_REPLAYABLE_PHASES.has(phase);
  const recoveryRequired =
    fingerprintMatches &&
    (phase === "queued" || phase === "committing" || phase === "failed" || commandJournal.restored);
  const recoveryStatus = !fingerprintMatches
    ? "stale-fingerprint"
    : phase === "committed"
      ? "already-committed"
      : phase === "cancelled"
        ? "cancelled"
        : recoveryRequired && journalRecoverable
          ? "recoverable"
          : recoveryRequired
            ? "manual-review"
            : "current";
  const restartSafe =
    fingerprintMatches &&
    phase !== "failed" &&
    (terminal || phase === "new" || phase === "prepared" || journalRecoverable);
  const restartPlan = buildRestartPlan({
    phase,
    commandLedger,
    journalRecoverable,
    recoveryStatus,
    restartSafe,
    commandJournal,
    generatedAt
  });

  return {
    version: "aios.fs-write.persisted-state.v1",
    phase,
    fingerprint,
    fingerprintMatches,
    commandToken: commandJournal.command.token,
    idempotencyKey: commandLedger.idempotencyKey,
    replayCount,
    recoveryCount,
    terminal,
    stablePhase: restartPlan.stablePhase,
    restartSafe,
    restoredFromJournal: commandJournal.restored || replayCount > 0 || recoveryCount > 0,
    command: {
      requested: command,
      targetPhase,
      idempotent: commandLedger.idempotent,
      replayed: commandJournal.command.replayed,
      token: commandJournal.command.token,
      lastAcceptedAt: commandJournal.command.lastAcceptedAt,
      result:
        commandLedger.idempotent
          ? "noop"
          : terminal
            ? "terminal-state"
            : fingerprintMatches
              ? "accepted"
              : "rejected-stale-fingerprint"
    },
    recovery: {
      required: recoveryRequired,
      status: recoveryStatus,
      safeToReplay: restartSafe || journalRecoverable,
      strategy:
        recoveryStatus === "recoverable"
          ? phase === "committing"
            ? "resume-provider-commit"
            : "replay-journal-command"
          : recoveryStatus === "manual-review"
            ? "operator-review"
            : recoveryStatus,
      nextPhase:
        recoveryStatus === "recoverable"
          ? phase === "failed"
            ? "queued"
            : phase
          : phase,
      reason:
        !fingerprintMatches
          ? "stored_fingerprint_differs_from_request"
          : recoveryRequired
            ? `persisted_phase_${phase}`
            : "no_recovery_required"
    },
    commandLedger,
    restartPlan,
    lastKnownDecision:
      typeof source.lastKnownDecision === "string" && source.lastKnownDecision.trim()
        ? source.lastKnownDecision.trim()
        : null,
    committedAt:
      typeof source.committedAt === "string" && source.committedAt.trim()
        ? source.committedAt.trim()
        : null,
    enqueuedAt:
      typeof source.enqueuedAt === "string" && source.enqueuedAt.trim()
        ? source.enqueuedAt.trim()
        : null,
    updatedAt:
      typeof source.updatedAt === "string" && source.updatedAt.trim()
        ? source.updatedAt.trim()
        : generatedAt,
    journal: {
      provider: commandJournal.provider,
      sequence: commandJournal.sequence,
      checkpoint: commandJournal.checkpoint,
      restored: commandJournal.restored,
      lastFlushedAt: commandJournal.lastFlushedAt,
      commandHistoryCount: commandJournal.command.historyCount
    },
    statePatch: {
      version: "aios.fs-write.persisted-state-patch.v1",
      correlationId: request.correlationId,
      fingerprint,
      phase: commandLedger.idempotent || terminal ? phase : targetPhase,
      command,
      commandToken: commandJournal.command.token,
      idempotencyKey: commandLedger.idempotencyKey,
      journalProvider: commandJournal.provider,
      expectedPreviousSequence: commandJournal.sequence,
      commandLedgerAppend: commandLedger.ledgerAppend,
      restartPlan: {
        status: restartPlan.status,
        route: restartPlan.route,
        checkpointRequired: restartPlan.checkpointRequired,
        requiredBeforeRestartSafe: restartPlan.requiredBeforeRestartSafe
      },
      restartSafe,
      recoveryStatus,
      updatedAt: generatedAt
    }
  };
}

function evaluatePersistedStateTruth(persistedState) {
  const violations = [];
  const warnings = [];
  const facts = [];

  if (!persistedState.fingerprintMatches) {
    violations.push("persistedState.stale_fingerprint");
    facts.push("fingerprint-mismatch");
  }
  if (persistedState.phase === "cancelled") {
    violations.push("persistedState.cancelled_terminal");
    facts.push("terminal-cancelled");
  }
  if (
    persistedState.commandLedger.rejected &&
    persistedState.fingerprintMatches &&
    persistedState.phase !== "cancelled"
  ) {
    violations.push("persistedState.terminal_command_rejected");
    facts.push("command-rejected");
  }
  if (persistedState.recovery.status === "manual-review") {
    violations.push("persistedState.manual_review_required");
    facts.push("manual-review-required");
  }
  if (persistedState.phase === "committed" && persistedState.fingerprintMatches) {
    warnings.push("persistedState.already_committed");
    facts.push("already-committed");
  }
  if (persistedState.recovery.status === "recoverable") {
    warnings.push("persistedState.recovery_required");
    facts.push("recoverable-state");
  }
  if (persistedState.restartPlan.checkpointRequired) {
    warnings.push("persistedState.checkpoint_required");
    facts.push("checkpoint-required");
  }
  if (persistedState.restartPlan.needsJournalFlush) {
    warnings.push("persistedState.journal_flush_required");
    facts.push("journal-flush-required");
  }

  const terminalAcknowledgement =
    persistedState.phase === "committed" &&
    persistedState.fingerprintMatches &&
    persistedState.commandLedger.idempotent;
  const recoveryRequired =
    persistedState.recovery.required &&
    persistedState.recovery.status !== "cancelled" &&
    persistedState.recovery.status !== "stale-fingerprint";
  const commitAllowed =
    violations.length === 0 &&
    !terminalAcknowledgement &&
    !recoveryRequired &&
    persistedState.commandLedger.replaySafe;
  const route = violations.length > 0
    ? persistedState.restartPlan.route || "fs.write.recovery.review"
    : terminalAcknowledgement
      ? "fs.write.acknowledge-committed"
      : recoveryRequired
        ? persistedState.restartPlan.resumeCommand || persistedState.restartPlan.route
        : persistedState.commandLedger.accepted
          ? "journal.flush-command-ledger"
          : "fs.write.continue";

  return {
    version: "aios.fs-write.persisted-state-truth.v1",
    accepted: violations.length === 0,
    phase: persistedState.phase,
    fingerprintMatches: persistedState.fingerprintMatches,
    terminalAcknowledgement,
    recoveryRequired,
    commitAllowed,
    replaySafe: persistedState.commandLedger.replaySafe,
    idempotentCommand: persistedState.commandLedger.idempotent,
    commandOutcome: persistedState.commandLedger.outcome,
    restartStatus: persistedState.recovery.status,
    restartSafe: persistedState.restartSafe,
    route,
    violations,
    warnings,
    facts,
    ledger: {
      token: persistedState.commandLedger.token,
      idempotencyKey: persistedState.idempotencyKey,
      accepted: persistedState.commandLedger.accepted,
      rejected: persistedState.commandLedger.rejected,
      replayed: persistedState.commandLedger.replayed,
      acceptedAt: persistedState.commandLedger.acceptedAt
    },
    requiredBeforeCommit: uniqueStrings([
      ...violations,
      recoveryRequired ? "persistedState.recovery_required" : "",
      persistedState.restartPlan.needsJournalFlush ? "persistedState.journal_flush_required" : "",
      persistedState.restartPlan.checkpointRequired ? "persistedState.checkpoint_required" : ""
    ], []),
    statePatch: {
      correlationId: persistedState.statePatch.correlationId,
      idempotencyKey: persistedState.idempotencyKey,
      phase: persistedState.statePatch.phase,
      route,
      restartStatus: persistedState.recovery.status,
      commitAllowed,
      updatedAt: persistedState.updatedAt
    }
  };
}

function buildRestartPersistenceEnvelope({
  request,
  workspaceScope,
  lifecycle,
  persistedState,
  persistedStateTruth,
  operationalHealth,
  providerHandoffContract,
  productWorkflowHandoff,
  generatedAt
}) {
  const checkpointState =
    persistedState.phase === "committed" || persistedState.phase === "cancelled"
      ? "terminal"
      : persistedState.restartSafe && persistedStateTruth.commitAllowed
        ? "commit-ready"
        : persistedState.restartSafe
          ? "restart-safe"
          : persistedState.recovery.status === "manual-review"
            ? "review-required"
            : "checkpoint-required";
  const durablePhase =
    persistedState.commandLedger.idempotent || persistedState.terminal
      ? persistedState.phase
      : persistedState.statePatch.phase;
  const providerBarrier =
    providerHandoffContract && providerHandoffContract.commitBarrier
      ? providerHandoffContract.requiredBeforeCommit[0] || "externalHandoff.ack_required"
      : null;
  const productBarrier =
    productWorkflowHandoff && productWorkflowHandoff.requiredBeforeCommit.length > 0
      ? productWorkflowHandoff.requiredBeforeCommit[0]
      : null;
  const restartBlockers = uniqueStrings([
    ...persistedStateTruth.requiredBeforeCommit,
    ...persistedState.restartPlan.requiredBeforeRestartSafe,
    providerBarrier || "",
    productBarrier || "",
    operationalHealth.directCommitBlocked ? "health.direct_commit_blocked" : "",
    lifecycle.schedule && !lifecycle.schedule.due ? "fsWrite.scheduled" : ""
  ], []);
  const snapshot = {
    version: "aios.fs-write.restart-checkpoint.v1",
    generatedAt,
    correlationId: request.correlationId,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    scopedPath: workspaceScope.path.scoped,
    fingerprint: persistedState.fingerprint,
    phase: durablePhase,
    previousPhase: persistedState.phase,
    checkpointState,
    stablePhase: persistedState.stablePhase,
    restartSafe: persistedState.restartSafe,
    restartStatus: persistedState.recovery.status,
    route: persistedStateTruth.route,
    idempotencyKey: persistedState.idempotencyKey,
    commandToken: persistedState.commandLedger.token,
    commandOutcome: persistedState.commandLedger.outcome,
    journal: {
      provider: persistedState.journal.provider,
      expectedPreviousSequence: persistedState.journal.sequence,
      checkpoint: persistedState.journal.checkpoint,
      restored: persistedState.journal.restored,
      commandHistoryCount: persistedState.journal.commandHistoryCount
    },
    providerHandoffState: providerHandoffContract ? providerHandoffContract.state : "not-required",
    productWorkflowState: productWorkflowHandoff ? productWorkflowHandoff.state : "not-required",
    requiredBeforeRestartSafe: restartBlockers
  };
  const commandBase = {
    correlationId: request.correlationId,
    idempotencyKey: persistedState.idempotencyKey,
    commandToken: persistedState.commandLedger.token,
    expectedFingerprint: persistedState.fingerprint,
    expectedPhase: persistedState.phase
  };
  const commands = [
    {
      id: "persist-restart-checkpoint",
      action: "journal.persist-checkpoint",
      idempotent: true,
      enabled: persistedState.restartPlan.checkpointRequired || !persistedState.restartSafe,
      replayPolicy: "same-token-noop",
      payload: {
        ...commandBase,
        checkpointState,
        phase: durablePhase,
        expectedPreviousSequence: persistedState.journal.sequence,
        snapshot
      }
    },
    {
      id: "flush-command-ledger",
      action: "journal.flush-command-ledger",
      idempotent: true,
      enabled: persistedState.restartPlan.needsJournalFlush,
      replayPolicy: "append-once-by-command-token",
      payload: {
        ...commandBase,
        append: persistedState.commandLedger.ledgerAppend,
        expectedPreviousSequence: persistedState.journal.sequence
      }
    },
    {
      id: "resume-after-restart",
      action: persistedState.restartPlan.resumeCommand,
      idempotent: persistedState.commandLedger.replaySafe,
      enabled: persistedState.restartPlan.canAutoResume && restartBlockers.length === 0,
      replayPolicy: "resume-only-when-fingerprint-matches",
      payload: {
        ...commandBase,
        route: persistedState.restartPlan.route,
        recoveryStatus: persistedState.recovery.status,
        nextPhase: persistedState.recovery.nextPhase
      }
    }
  ];

  return {
    version: "aios.fs-write.restart-persistence-envelope.v1",
    generatedAt,
    status: checkpointState,
    restartSafe: persistedState.restartSafe && restartBlockers.length === 0,
    commitAllowedAfterRestore:
      persistedStateTruth.commitAllowed &&
      restartBlockers.length === 0 &&
      !operationalHealth.directCommitBlocked,
    restoreMode:
      persistedStateTruth.terminalAcknowledgement
        ? "acknowledge-terminal"
        : persistedStateTruth.recoveryRequired
          ? "recover"
          : persistedState.commandLedger.idempotent
            ? "replay-noop"
            : "continue",
    snapshot,
    commands,
    statusSemantics: {
      terminalAcknowledgement: persistedStateTruth.terminalAcknowledgement,
      replaySafe: persistedStateTruth.replaySafe,
      idempotentCommand: persistedStateTruth.idempotentCommand,
      staleFingerprint: !persistedState.fingerprintMatches,
      manualReviewRequired: persistedState.recovery.status === "manual-review",
      requiredBeforeRestartSafe: restartBlockers
    }
  };
}

function buildReadinessContract(
  validationSummary,
  negotiation,
  externalHandoff,
  boundaryEvaluation,
  lifecycleSettings,
  providerServiceContract,
  acceptance,
  providerHandoffContract,
  persistedStateTruth,
  targetPolicy,
  productWorkflowHandoff,
  productSyncContract
) {
  const providerContractAccepted = !providerServiceContract || providerServiceContract.violations.length === 0;
  const acceptanceRequired =
    acceptance.mode !== "auto-acceptable" || acceptance.requiredAcknowledgements.length > 0;
  const acceptanceSatisfied = !acceptanceRequired || acceptance.accepted;
  const handoffReady = externalHandoff.state === "ready" || externalHandoff.state === "not-required";
  const providerHandoffAccepted = !providerHandoffContract || !providerHandoffContract.commitBarrier;
  const persistedStateCommitAllowed = !persistedStateTruth || persistedStateTruth.commitAllowed;
  const targetAccepted = !targetPolicy || targetPolicy.accepted;
  const productWorkflowAccepted =
    !productWorkflowHandoff ||
    productWorkflowHandoff.state === "not-required" ||
    productWorkflowHandoff.state === "ready";
  const productSyncAccepted =
    !productSyncContract ||
    productSyncContract.state === "not-required" ||
    productSyncContract.state === "optional" ||
    productSyncContract.state === "ready";
  const lifecycleEnabled = lifecycleSettings.enabled;
  const lifecycleActive = lifecycleSettings.mode !== "paused";
  const scheduleDue = lifecycleSettings.schedule.due;
  const commitGates = [
    {
      id: "request-validation",
      passed: validationSummary.status !== "blocked",
      severity: "error",
      route: "fs.write.edit-request",
      blockers: validationSummary.blocking,
      warnings: validationSummary.warning,
      auditSubject: "request"
    },
    {
      id: "capability-negotiation",
      passed: negotiation.accepted,
      severity: "error",
      route: "provider.select",
      blockers: negotiation.accepted
        ? []
        : negotiation.missing.map((capability) => `capability.missing.${capability}`),
      warnings: negotiation.accepted
        ? negotiation.missing.map((capability) => `capability.missing.${capability}`)
        : [],
      auditSubject: negotiation.providerProtocol
    },
    {
      id: "tenant-permission-boundary",
      passed: boundaryEvaluation.accepted,
      severity: "error",
      route: "tenant.permission.request",
      blockers: boundaryEvaluation.violations,
      warnings: [],
      auditSubject: boundaryEvaluation.boundary.tenantIsolation
        ? boundaryEvaluation.boundary.tenantIsolation.auditSubject
        : "tenant-boundary"
    },
    {
      id: "target-policy",
      passed: targetAccepted,
      severity: "error",
      route: targetPolicy ? targetPolicy.route : "fs.write.target.resolve",
      blockers: targetPolicy ? targetPolicy.violations : [],
      warnings: targetPolicy ? targetPolicy.warnings : [],
      auditSubject: targetPolicy ? targetPolicy.auditSubject : "target-policy"
    },
    {
      id: "product-workflow",
      passed: productWorkflowAccepted,
      severity: productWorkflowHandoff && productWorkflowHandoff.required ? "error" : "info",
      route: productWorkflowHandoff
        ? productWorkflowHandoff.destination.action
        : "fs.write.product-workflow.acknowledge",
      blockers: productWorkflowHandoff ? productWorkflowHandoff.requiredBeforeCommit : [],
      warnings:
        productWorkflowHandoff && productWorkflowHandoff.required && productWorkflowHandoff.state === "awaiting-user"
          ? ["productWorkflow.ack_required"]
          : [],
      auditSubject:
        productWorkflowHandoff && productWorkflowHandoff.targetProductId
          ? `product|${productWorkflowHandoff.targetProductId}|${productWorkflowHandoff.revision}`
          : "product-workflow"
    },
    {
      id: "product-sync-contract",
      passed: productSyncAccepted,
      severity: productSyncContract && productSyncContract.required ? "error" : "info",
      route: "fs.write.product-sync.resolve",
      blockers: productSyncContract ? productSyncContract.requiredBeforeCommit : [],
      warnings:
        productSyncContract && productSyncContract.state === "optional"
          ? ["productSync.optional"]
          : [],
      auditSubject: productSyncContract ? productSyncContract.auditSubject : "product-sync"
    },
    {
      id: "provider-service-contract",
      passed: providerContractAccepted,
      severity: "error",
      route: "provider.contract.resolve",
      blockers: providerServiceContract ? providerServiceContract.violations : [],
      warnings: providerServiceContract ? providerServiceContract.warnings : [],
      auditSubject: providerServiceContract ? providerServiceContract.serviceId : "provider-service"
    },
    {
      id: "acceptance",
      passed: acceptanceSatisfied,
      severity: acceptanceRequired ? "error" : "info",
      route: acceptance.routeCommand,
      blockers: acceptanceSatisfied
        ? []
        : uniqueStrings([
            ...acceptance.missingAcknowledgements.map((acknowledgement) => `acceptance.missing.${acknowledgement}`),
            acceptance.submission.tokenValid ? "" : "acceptance.token.invalid",
            acceptance.decision === "rejected" ? "acceptance.rejected" : ""
          ], []),
      warnings: acceptanceRequired && !acceptance.accepted ? ["acceptance.pending"] : [],
      auditSubject: acceptance.acceptanceToken || acceptance.correlationId
    },
    {
      id: "external-handoff",
      passed: handoffReady && providerHandoffAccepted,
      severity: providerHandoffContract && providerHandoffContract.commitBarrier ? "error" : "warning",
      route: "fs.write.external-handoff.resume",
      blockers: uniqueStrings([
        externalHandoff.state === "blocked" ? "externalHandoff.blocked" : "",
        externalHandoff.state === "deferred" ? "externalHandoff.deferred" : "",
        providerHandoffContract && providerHandoffContract.commitBarrier
          ? providerHandoffContract.requiredBeforeCommit[0] || "externalHandoff.ack_required"
          : ""
      ], []),
      warnings: externalHandoff.state === "deferred" ? ["externalHandoff.deferred"] : [],
      auditSubject: providerHandoffContract ? providerHandoffContract.transferId : externalHandoff.token
    },
    {
      id: "persisted-state",
      passed: persistedStateCommitAllowed,
      severity: "error",
      route: persistedStateTruth ? persistedStateTruth.route : "fs.write.continue",
      blockers: persistedStateTruth ? persistedStateTruth.requiredBeforeCommit : [],
      warnings: persistedStateTruth ? persistedStateTruth.warnings : [],
      auditSubject: persistedStateTruth && persistedStateTruth.ledger
        ? persistedStateTruth.ledger.idempotencyKey
        : "persisted-state"
    },
    {
      id: "lifecycle",
      passed:
        lifecycleEnabled &&
        lifecycleActive &&
        scheduleDue &&
        lifecycleSettings.commandPlan.transitionAllowed &&
        lifecycleSettings.commandPlan.schedulerGate,
      severity: "error",
      route: lifecycleSettings.commandPlan.route,
      blockers: uniqueStrings([
        lifecycleEnabled ? "" : "fsWrite.disabled",
        lifecycleActive ? "" : "fsWrite.paused",
        scheduleDue ? "" : "fsWrite.scheduled",
        lifecycleSettings.commandPlan.transitionAllowed ? "" : "settings.lifecycleTransition.invalid",
        lifecycleSettings.commandPlan.schedulerGate ? "" : "settings.scheduleWindow.invalid"
      ], []),
      warnings: lifecycleSettings.warnings,
      auditSubject: `${lifecycleSettings.command}:${lifecycleSettings.commandPlan.targetMode}`
    }
  ];
  const failedGates = commitGates.filter((gate) => !gate.passed);
  const readyToCommit = failedGates.length === 0;
  const requiredBeforeCommit = uniqueStrings(
    failedGates.flatMap((gate) => gate.blockers.length > 0 ? gate.blockers : [`gate.${gate.id}.blocked`]),
    []
  );

  return {
    state: readyToCommit
      ? "commit-ready"
      : validationSummary.status === "blocked"
        ? "blocked"
        : !acceptanceSatisfied
          ? "acceptance-required"
        : !lifecycleSettings.enabled
          ? "disabled"
          : lifecycleSettings.mode === "paused"
            ? "paused"
        : !lifecycleSettings.schedule.due
          ? "scheduled"
          : persistedStateTruth && persistedStateTruth.terminalAcknowledgement
            ? "idempotent-acknowledgement"
          : persistedStateTruth && persistedStateTruth.recoveryRequired
            ? "recovery-required"
          : "review-ready",
    readyToCommit,
    requiredBeforeCommit,
    optionalBeforeCommit: validationSummary.warning,
    commitGateAudit: {
      version: "aios.fs-write.commit-gate-audit.v1",
      state: readyToCommit ? "all-gates-passed" : "blocked-by-gates",
      gateCount: commitGates.length,
      failedGateCount: failedGates.length,
      failedGateIds: failedGates.map((gate) => gate.id),
      requiredBeforeCommit,
      warningGateIds: commitGates
        .filter((gate) => gate.warnings.length > 0)
        .map((gate) => gate.id),
      gates: commitGates.map((gate) => ({
        id: gate.id,
        passed: gate.passed,
        severity: gate.severity,
        route: gate.route,
        blockers: gate.blockers,
        warnings: gate.warnings,
        auditSubject: gate.auditSubject
      }))
    },
    gates: {
      requestValid: validationSummary.blocking.every((issue) => !issue.includes(".required") && !issue.includes(".invalid")),
      capabilityAccepted: negotiation.accepted,
      providerContractAccepted,
      targetPolicyAccepted: targetAccepted,
      acceptanceRequired,
      acceptanceSatisfied,
      acceptanceTokenValid: acceptance.submission.tokenValid,
      tenantBoundaryAccepted: boundaryEvaluation.accepted,
      tenantIsolationAccepted:
        !boundaryEvaluation.boundary.tenantIsolation ||
        (
          boundaryEvaluation.boundary.tenantIsolation.actorTenantMatches &&
          boundaryEvaluation.boundary.tenantIsolation.tenantTrusted &&
          boundaryEvaluation.boundary.tenantIsolation.workspaceAllowed &&
          boundaryEvaluation.boundary.tenantIsolation.delegationAccepted
        ),
      permissionAccepted: boundaryEvaluation.permission.granted,
      handoffReady,
      providerHandoffAccepted,
      productSyncAccepted,
      productSyncState: productSyncContract ? productSyncContract.state : "not-required",
      productWorkflowAccepted,
      productWorkflowState: productWorkflowHandoff ? productWorkflowHandoff.state : "not-required",
      persistedStateAccepted: !persistedStateTruth || persistedStateTruth.accepted,
      persistedStateCommitAllowed,
      persistedStateRoute: persistedStateTruth ? persistedStateTruth.route : null,
      lifecycleEnabled,
      lifecycleCommandAccepted: lifecycleSettings.commandPlan.transitionAllowed,
      scheduleDue
    }
  };
}

function normalizeOperationalSignals(input) {
  const health = input.health && typeof input.health === "object" ? input.health : {};
  const rawFailures = uniqueStrings(health.failures || input.failures, []);
  const providerState =
    health.providerState === "unavailable" ||
    health.providerState === "timeout" ||
    health.providerState === "degraded"
      ? health.providerState
      : "healthy";
  const journalState =
    health.journalState === "locked" ||
    health.journalState === "backpressure" ||
    health.journalState === "degraded"
      ? health.journalState
      : "healthy";
  const failures = [...rawFailures];

  if (providerState === "unavailable") failures.push("provider.unavailable");
  if (providerState === "timeout") failures.push("provider.timeout");
  if (journalState === "locked") failures.push("journal.locked");
  if (journalState === "backpressure") failures.push("journal.backpressure");

  return {
    providerState,
    journalState,
    failures: uniqueStrings(failures, []),
    lastHealthyAt: typeof health.lastHealthyAt === "string" && health.lastHealthyAt.trim() ? health.lastHealthyAt : null,
    attempt:
      Number.isInteger(health.attempt) && health.attempt > 0
        ? Math.min(health.attempt, 12)
        : Number.isInteger(input.attempt) && input.attempt > 0
          ? Math.min(input.attempt, 12)
          : 1
  };
}

function normalizeHealthPolicy(input, signals, failures, generatedAt) {
  const health = input.health && typeof input.health === "object" ? input.health : {};
  const policyInput =
    health.policy && typeof health.policy === "object"
      ? health.policy
      : input.healthPolicy && typeof input.healthPolicy === "object"
        ? input.healthPolicy
        : {};
  const circuitInput = policyInput.circuitBreaker && typeof policyInput.circuitBreaker === "object"
    ? policyInput.circuitBreaker
    : {};
  const degradedInput = policyInput.degradedMode && typeof policyInput.degradedMode === "object"
    ? policyInput.degradedMode
    : health.degradedMode && typeof health.degradedMode === "object"
      ? health.degradedMode
      : {};
  const transientFailureCount = failures.filter((failure) => TRANSIENT_FAILURES.has(failure)).length;
  const failureCount =
    Number.isInteger(circuitInput.failureCount) && circuitInput.failureCount >= 0
      ? Math.min(circuitInput.failureCount, 100)
      : transientFailureCount;
  const threshold =
    Number.isInteger(circuitInput.threshold) && circuitInput.threshold > 0
      ? Math.min(circuitInput.threshold, 20)
      : 3;
  const stateInput =
    typeof circuitInput.state === "string" && circuitInput.state.trim()
      ? circuitInput.state.trim()
      : failureCount >= threshold
        ? "open"
        : "closed";
  const state = HEALTH_CIRCUIT_STATES.has(stateInput) ? stateInput : "closed";
  const cooldownMs =
    Number.isInteger(circuitInput.cooldownMs) && circuitInput.cooldownMs > 0
      ? Math.min(circuitInput.cooldownMs, 300000)
      : 60000;
  const openedAt =
    typeof circuitInput.openedAt === "string" && circuitInput.openedAt.trim()
      ? circuitInput.openedAt.trim()
      : state === "open"
        ? generatedAt
        : null;
  const lastProbeAt =
    typeof circuitInput.lastProbeAt === "string" && circuitInput.lastProbeAt.trim()
      ? circuitInput.lastProbeAt.trim()
      : null;
  const nextProbeAt = state === "open"
    ? new Date(Date.parse(openedAt || generatedAt) + cooldownMs).toISOString()
    : state === "half-open"
      ? generatedAt
      : null;
  const requestedCapabilities = uniqueStrings(degradedInput.capabilities, []);
  const capabilities = requestedCapabilities.filter((capability) => DEGRADED_MODE_CAPABILITIES.has(capability));
  const queueOnly = degradedInput.queueOnly === true || capabilities.includes("queue-only");
  const enabled =
    degradedInput.enabled === true ||
    queueOnly ||
    capabilities.length > 0 ||
    signals.providerState === "degraded" ||
    signals.journalState === "degraded";
  const maxAttempts =
    Number.isInteger(policyInput.maxAttempts) && policyInput.maxAttempts > 0
      ? Math.min(policyInput.maxAttempts, 12)
      : 6;
  const retryBudgetRemaining = Math.max(0, maxAttempts - signals.attempt);
  const policyFailures = [
    ...(state === "open" ? ["health.circuit_open"] : []),
    ...(state === "half-open" ? ["health.circuit_half_open"] : []),
    ...(enabled && queueOnly ? ["health.degraded_queue_only"] : []),
    ...(transientFailureCount > 0 && retryBudgetRemaining === 0 ? ["health.retry_budget_exhausted"] : [])
  ];

  return {
    version: "aios.fs-write.health-policy.v1",
    circuitBreaker: {
      state,
      threshold,
      failureCount,
      openedAt,
      lastProbeAt,
      cooldownMs,
      nextProbeAt,
      allowsProbe: state === "half-open",
      blocksCommit: state === "open"
    },
    degradedMode: {
      enabled,
      queueOnly,
      capabilities,
      commitMode: enabled && queueOnly ? "queue-only" : enabled ? "limited" : "normal",
      allowedActions: enabled
        ? uniqueStrings([
            queueOnly ? "fs.write.queue" : "fs.write.commit",
            capabilities.includes("metadata-only") ? "fs.write.sync-metadata" : "",
            capabilities.includes("audit-delayed") ? "fs.write.audit.defer" : "",
            capabilities.includes("external-handoff-only") ? "fs.write.external-handoff.resume" : ""
          ], [])
        : ["fs.write.commit"]
    },
    retryBudget: {
      maxAttempts,
      attempt: signals.attempt,
      remaining: retryBudgetRemaining,
      exhausted: retryBudgetRemaining === 0 && transientFailureCount > 0
    },
    policyFailures
  };
}

function retryPlanForFailure(failures, attempt, generatedAt, healthPolicy) {
  const retryable = failures.filter((failure) => TRANSIENT_FAILURES.has(failure));
  const blockedByContract = failures.some((failure) => NON_RETRYABLE_FAILURES.has(failure));
  const cappedAttempt = Math.max(1, Math.min(attempt, 12));
  const maxAttempts = healthPolicy ? healthPolicy.retryBudget.maxAttempts : 6;
  const retryBudgetExhausted = healthPolicy ? healthPolicy.retryBudget.exhausted : cappedAttempt >= maxAttempts;
  const baseDelayMs = 250;
  const delayMs = Math.min(30000, baseDelayMs * 2 ** (cappedAttempt - 1));
  const jitterMs = Math.min(750, 37 * cappedAttempt);
  const retryAt = new Date(Date.parse(generatedAt) + delayMs + jitterMs).toISOString();

  return {
    retryable: retryable.length > 0 && !blockedByContract && !retryBudgetExhausted,
    attempt: cappedAttempt,
    maxAttempts,
    budgetRemaining: healthPolicy ? healthPolicy.retryBudget.remaining : Math.max(0, maxAttempts - cappedAttempt),
    budgetExhausted: retryBudgetExhausted,
    backoff: {
      strategy: "exponential-with-bounded-jitter",
      delayMs,
      jitterMs,
      retryAt
    },
    retryableFailures: retryable,
    nonRetryableFailures: failures.filter((failure) => !TRANSIENT_FAILURES.has(failure))
  };
}

function buildHealthRecoveryEnvelope({
  request,
  targetClassification,
  validationSummary,
  readiness,
  externalHandoff,
  failures,
  retry,
  healthPolicy,
  degradedReasons,
  blockedReasons,
  generatedAt
}) {
  const targetKind = targetClassification ? targetClassification.kind : "workspace";
  const retryableFailure = retry.retryableFailures[0] || null;
  const primaryBlockedReason = blockedReasons[0] || null;
  const primaryDegradedReason = degradedReasons[0] || null;
  const queueName =
    targetKind === "product"
      ? "hosted-kernel.fs-write.product-degraded"
      : targetKind === "artifact"
        ? "hosted-kernel.fs-write.artifact-degraded"
        : "hosted-kernel.fs-write.workspace-degraded";
  const shouldQueue =
    healthPolicy.degradedMode.queueOnly ||
    failures.includes("journal.backpressure") ||
    externalHandoff.state === "deferred" ||
    (retry.retryable && request.operation === "append");
  const retryRoute = retry.retryable
    ? healthPolicy.circuitBreaker.state === "half-open"
      ? "fs.write.health.probe"
      : "fs.write.retry"
    : null;
  const recoveryRoute = primaryBlockedReason
    ? describeActionableError(primaryBlockedReason, "health").action
    : shouldQueue
      ? "fs.write.queue"
      : retryRoute ||
        (primaryDegradedReason ? describeActionableError(primaryDegradedReason, "health").action : null) ||
        (readiness.readyToCommit ? "fs.write.commit" : "fs.write.resolve");
  const failureClass = primaryBlockedReason
    ? "operator-action-required"
    : retry.retryable
      ? "transient-retry"
      : primaryDegradedReason
        ? "degraded-service"
        : validationSummary.status === "blocked"
          ? "contract-blocked"
          : readiness.readyToCommit
            ? "commit-ready"
            : "waiting-for-gates";
  const commitSafety =
    healthPolicy.circuitBreaker.blocksCommit || healthPolicy.degradedMode.queueOnly || retry.budgetExhausted
      ? "direct-commit-blocked"
      : blockedReasons.length > 0
        ? "blocked-by-contract"
        : retry.retryable
          ? "retry-before-commit"
          : readiness.readyToCommit
            ? "direct-commit-allowed"
            : "await-readiness";
  const queuePolicy = {
    enabled: shouldQueue,
    queue: shouldQueue ? queueName : null,
    reason:
      healthPolicy.degradedMode.queueOnly
        ? "health.degraded_queue_only"
        : failures.includes("journal.backpressure")
          ? "journal.backpressure"
          : externalHandoff.state === "deferred"
            ? "externalHandoff.deferred"
            : retry.retryable && request.operation === "append"
              ? retryableFailure || "transient_append_retry"
              : null,
    preservesOrder: targetKind === "product" || request.operation === "append",
    requiresDigestBeforeDequeue: targetKind === "artifact",
    maxDelayMs:
      shouldQueue && retry.retryable
        ? retry.backoff.delayMs + retry.backoff.jitterMs
        : shouldQueue
          ? healthPolicy.circuitBreaker.cooldownMs
          : 0
  };
  const operatorActions = uniqueStrings([
    primaryBlockedReason ? describeActionableError(primaryBlockedReason, "health").action : "",
    retry.budgetExhausted ? "fs.write.escalate" : "",
    healthPolicy.circuitBreaker.state === "open" ? "fs.write.health.reset-circuit" : "",
    externalHandoff.state === "blocked" ? "fs.write.external-handoff.unblock" : "",
    validationSummary.systemFixable[0]
      ? describeActionableError(validationSummary.systemFixable[0], "blocking").action
      : ""
  ], []);

  return {
    version: "aios.fs-write.health-recovery-envelope.v1",
    generatedAt,
    failureClass,
    commitSafety,
    route: recoveryRoute,
    targetKind,
    operation: request.operation,
    correlationId: request.correlationId,
    primaryFailure: primaryBlockedReason || retryableFailure || primaryDegradedReason,
    retryAfter: retry.retryable ? retry.backoff.retryAt : null,
    nextProbeAt: healthPolicy.circuitBreaker.nextProbeAt,
    queuePolicy,
    operatorActions,
    clientMessageKey:
      primaryBlockedReason
        ? "fs_write_health_blocked"
        : retry.retryable
          ? "fs_write_retry_scheduled"
          : queuePolicy.enabled
            ? "fs_write_queued_degraded"
            : readiness.readyToCommit
              ? "fs_write_health_ready"
              : "fs_write_waiting_for_readiness",
    auditLabels: uniqueStrings([
      `health:${failureClass}`,
      `target:${targetKind}`,
      `operation:${request.operation}`,
      queuePolicy.enabled ? "route:queue" : "",
      retry.retryable ? "route:retry" : "",
      healthPolicy.circuitBreaker.state !== "closed" ? `circuit:${healthPolicy.circuitBreaker.state}` : "",
      healthPolicy.degradedMode.enabled ? `degraded:${healthPolicy.degradedMode.commitMode}` : ""
    ], [])
  };
}

function describeActionableError(issue, source) {
  const catalogEntry = ACTIONABLE_ERROR_CATALOG[issue];
  const permissionIssue = issue.startsWith("permission.missing.");
  const capabilityIssue = issue.startsWith("capability.missing.");
  const boundaryIssue =
    issue === "path.workspace_escape" ||
    issue === "path.outside_workspace" ||
    issue === "path.outside_allowed_prefix";
  const fallback = {
    code: issue.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
    owner: USER_FIXABLE_VIOLATIONS.has(issue) || permissionIssue || boundaryIssue ? "requester" : "platform",
    action: permissionIssue
      ? "tenant.permission.request"
      : capabilityIssue
        ? "provider.select"
        : boundaryIssue
          ? "fs.write.retarget-workspace-path"
          : "fs.write.edit-request",
    message: permissionIssue
      ? "The actor does not have the required workspace write permission."
      : boundaryIssue
        ? "The write path is outside the accepted workspace boundary."
        : "The write request cannot be committed until this issue is resolved."
  };
  const detail = catalogEntry || fallback;

  return {
    issue,
    source,
    code: detail.code,
    owner: detail.owner,
    severity: NON_RETRYABLE_FAILURES.has(issue) || source === "blocking" ? "error" : "warning",
    action: detail.action,
    message: detail.message
  };
}

function buildOperationalHealth(
  input,
  request,
  targetClassification,
  validationSummary,
  readiness,
  externalHandoff,
  generatedAt
) {
  const signals = normalizeOperationalSignals(input);
  const contractFailures = [
    ...validationSummary.blocking,
    ...readiness.requiredBeforeCommit,
    ...validationSummary.warning,
    ...(externalHandoff.state === "deferred" ? ["externalHandoff.deferred"] : []),
    ...(externalHandoff.state === "blocked" ? ["externalHandoff.blocked"] : [])
  ];
  const baseFailures = uniqueStrings([...signals.failures, ...contractFailures], []);
  const healthPolicy = normalizeHealthPolicy(input, signals, baseFailures, generatedAt);
  const failures = uniqueStrings([...baseFailures, ...healthPolicy.policyFailures], []);
  const retry = retryPlanForFailure(failures, signals.attempt, generatedAt, healthPolicy);
  const degradedReasons = failures.filter((failure) => DEGRADED_FAILURES.has(failure));
  const blockedReasons = failures.filter((failure) => NON_RETRYABLE_FAILURES.has(failure));
  const directCommitBlocked =
    healthPolicy.circuitBreaker.blocksCommit ||
    healthPolicy.degradedMode.queueOnly ||
    retry.budgetExhausted;
  const state = blockedReasons.length > 0
    ? "failed"
    : degradedReasons.length > 0 || signals.providerState === "degraded" || signals.journalState === "degraded"
      ? "degraded"
      : retry.retryable
        ? "recovering"
        : readiness.readyToCommit
        ? "healthy"
        : "attention-required";
  const recovery = buildHealthRecoveryEnvelope({
    request,
    targetClassification,
    validationSummary,
    readiness,
    externalHandoff,
    failures,
    retry,
    healthPolicy,
    degradedReasons,
    blockedReasons,
    generatedAt
  });

  return {
    state,
    mode: state === "degraded" ? "degraded-mode" : state === "failed" ? "failure-state" : "normal",
    commitAllowed: readiness.readyToCommit && state !== "failed" && !retry.retryable && !directCommitBlocked,
    providerState: signals.providerState,
    journalState: signals.journalState,
    lastHealthyAt: signals.lastHealthyAt,
    failures,
    degradedReasons,
    blockedReasons,
    healthPolicy,
    directCommitBlocked,
    queueAllowed:
      healthPolicy.degradedMode.queueOnly ||
      retry.retryable ||
      failures.includes("journal.backpressure") ||
      externalHandoff.state === "deferred",
    retry,
    recovery,
    actionableErrors: failures.map((failure) => describeActionableError(
      failure,
      validationSummary.blocking.includes(failure) ? "blocking" : "health"
    ))
  };
}

function lifecycleControlEnabled(command, lifecycleSettings) {
  if (!LIFECYCLE_COMMANDS.has(command)) return false;
  if (command === "enable") return lifecycleSettings.controls.canEnable;
  if (command === "disable") return lifecycleSettings.controls.canDisable;
  if (command === "pause") return lifecycleSettings.controls.canPause;
  if (command === "resume") return lifecycleSettings.controls.canResume;
  if (command === "commit") return lifecycleSettings.controls.canCommitCommand;
  if (command === "validate") return lifecycleSettings.enabled;
  if (command === "cancel") return lifecycleSettings.mode !== "disabled";
  return true;
}

function lifecycleCommandReason(command, lifecycleSettings, readiness, operationalHealth) {
  if (!lifecycleControlEnabled(command, lifecycleSettings)) {
    if (command === "enable") return "lifecycle_enable_not_available";
    if (command === "pause") return "lifecycle_pause_requires_enabled_mode";
    if (command === "resume") return "lifecycle_resume_requires_paused_mode";
    if (command === "commit" && lifecycleSettings.commandPlan.blockedReason) {
      return lifecycleSettings.commandPlan.blockedReason;
    }
    return "lifecycle_command_not_available";
  }
  if (command === "commit" && !readiness.readyToCommit) return readiness.requiredBeforeCommit[0] || readiness.state;
  if (command === "commit" && operationalHealth && !operationalHealth.commitAllowed) {
    return operationalHealth.blockedReasons[0] ||
      operationalHealth.retry.retryableFailures[0] ||
      "health_commit_not_allowed";
  }
  if (command === "commit") return "commit_gates_passed";
  if (command === lifecycleSettings.command && lifecycleSettings.commandPlan.idempotent) {
    return "lifecycle_command_idempotent";
  }
  return `lifecycle_${command}_available`;
}

function buildLifecycleNextActionState(lifecycleSettings, readiness, operationalHealth) {
  const health = operationalHealth || {
    commitAllowed: false,
    directCommitBlocked: false,
    blockedReasons: [],
    retry: {
      retryable: false,
      retryableFailures: []
    },
    recovery: null
  };
  const blockedReason = lifecycleSettings.commandPlan.blockedReason;
  const scheduled =
    lifecycleSettings.schedule.policy !== "immediate" || Boolean(lifecycleSettings.schedule.scheduledAt);
  const awaitingSchedule = scheduled && !lifecycleSettings.schedule.due;
  const healthRoute = health.recovery && health.recovery.route
      ? health.recovery.route
      : null;
  const action = readiness.readyToCommit && health.commitAllowed
    ? "fs.write.commit"
    : blockedReason
      ? lifecycleSettings.commandPlan.route
      : !lifecycleSettings.enabled
        ? "fs.write.lifecycle.enable"
        : lifecycleSettings.mode === "paused"
          ? "fs.write.lifecycle.resume"
          : awaitingSchedule
            ? lifecycleSettings.schedule.policy === "queued"
              ? "fs.write.queue"
              : "fs.write.schedule.await"
            : readiness.state === "acceptance-required"
              ? "fs.write.acceptance.accept"
              : health.retry.retryable
                ? "fs.write.retry"
                : health.directCommitBlocked && healthRoute
                  ? healthRoute
                  : readiness.state === "review-ready"
                    ? "fs.write.review"
                    : "fs.write.resolve";
  const reason = blockedReason ||
    (!lifecycleSettings.enabled
      ? "fsWrite.disabled"
      : lifecycleSettings.mode === "paused"
        ? "fsWrite.paused"
          : awaitingSchedule
            ? lifecycleSettings.schedule.policy === "maintenance-window"
              ? "fsWrite.awaiting_maintenance_window"
              : lifecycleSettings.schedule.policy === "queued"
                ? "fsWrite.queued"
                : "fsWrite.scheduled"
          : health.retry.retryable
            ? health.retry.retryableFailures[0] || "health.retryable"
            : health.directCommitBlocked
              ? health.blockedReasons[0] || "health.direct_commit_blocked"
              : readiness.readyToCommit
                ? "ready_to_commit"
                : readiness.state);
  const requiredBeforeAction = uniqueStrings([
    ...lifecycleSettings.commandPlan.requiredBeforeCommand,
    ...(readiness.readyToCommit ? [] : readiness.requiredBeforeCommit),
    awaitingSchedule ? "fs.write.schedule.due" : "",
    health.directCommitBlocked ? "health.direct_commit_blocked" : ""
  ], []);
  const commandControls = [...LIFECYCLE_COMMANDS].map((command) => ({
    command,
    action: command === "commit" ? "fs.write.commit" : `fs.write.lifecycle.${command}`,
    enabled: lifecycleControlEnabled(command, lifecycleSettings),
    selected: command === lifecycleSettings.command,
    targetMode: lifecycleTargetMode(command, lifecycleSettings.mode),
    reason: lifecycleCommandReason(command, lifecycleSettings, readiness, operationalHealth)
  }));

  return {
    version: "aios.fs-write.lifecycle-next-action.v1",
    action,
    reason,
    actionable: action !== "fs.write.schedule.await" && !blockedReason,
    owner:
      action === "fs.write.queue" || action === "fs.write.schedule.await"
        ? "scheduler"
        : action.startsWith("fs.write.lifecycle") ||
            action === "fs.write.acceptance.accept" ||
            action === "fs.write.review"
          ? "requester"
          : action === "fs.write.retry" || action.startsWith("fs.write.health")
            ? "platform"
            : "runtime",
    requiredBeforeAction,
    commandControls,
    scheduleControl: {
      policy: lifecycleSettings.schedule.policy,
      due: lifecycleSettings.schedule.due,
      queued: lifecycleSettings.schedule.policy === "queued",
      queue: lifecycleSettings.schedule.queue,
      scheduledAt: lifecycleSettings.schedule.scheduledAt,
      maintenanceWindow: lifecycleSettings.schedule.maintenanceWindow,
      canReschedule: lifecycleSettings.controls.canSchedule,
      awaitAction: lifecycleSettings.schedule.policy === "queued" ? "fs.write.queue" : "fs.write.schedule.await"
    },
    statePatch: {
      mode: lifecycleSettings.commandPlan.targetMode,
      command: lifecycleSettings.command,
      nextAction: action,
      nextActionReason: reason,
      scheduleDue: lifecycleSettings.schedule.due,
      queue: lifecycleSettings.schedule.queue,
      requiredBeforeAction
    }
  };
}

function buildLifecycleState(lifecycleSettings, readiness, operationalHealth) {
  const nextActionState = buildLifecycleNextActionState(lifecycleSettings, readiness, operationalHealth);
  const nextAction = nextActionState.action;

  return {
    ...lifecycleSettings,
    nextAction,
    nextActionState,
    actionable: nextActionState.actionable,
    commitCommandAccepted:
      lifecycleSettings.command !== "commit" ||
      (readiness.readyToCommit && lifecycleSettings.commandPlan.transitionAllowed),
    auditFlags: {
      lifecycleCommand: lifecycleSettings.command,
      disabledBySettings: !lifecycleSettings.enabled,
      scheduledWrite: lifecycleSettings.schedule.policy !== "immediate" || Boolean(lifecycleSettings.schedule.scheduledAt),
      transitionAllowed: lifecycleSettings.commandPlan.transitionAllowed,
      lifecycleTargetMode: lifecycleSettings.commandPlan.targetMode,
      nextActionReason: nextActionState.reason,
      nextActionOwner: nextActionState.owner,
      requiredBeforeAction: nextActionState.requiredBeforeAction
    }
  };
}

function buildHostedKernelWriteIntent({
  request,
  provider,
  workspaceScope,
  syncMetadata,
  externalHandoff,
  readiness,
  operationalHealth,
  lifecycle,
  acceptance,
  clientRuntime,
  clientDraft,
  persistedState,
  persistedStateTruth,
  validationSummary,
  providerServiceContract,
  providerHandoffContract,
  productWorkflowHandoff,
  productSyncContract,
  contentIntegrity,
  targetClassification,
  targetPolicy,
  generatedAt
}) {
  const clientDraftNeedsSync = clientDraft && clientDraft.adoptionState === "needs-client-sync";
  const productWorkflowNeedsHandoff =
    productWorkflowHandoff &&
    productWorkflowHandoff.required &&
    productWorkflowHandoff.state !== "ready";
  const productSyncBlocked =
    productSyncContract &&
    productSyncContract.required &&
    productSyncContract.state !== "ready";
  const canCommitNow =
    readiness.readyToCommit &&
    operationalHealth.commitAllowed &&
    persistedStateTruth.commitAllowed &&
    !clientDraftNeedsSync &&
    !productWorkflowNeedsHandoff &&
    !productSyncBlocked;
  const stalePersistedState = !persistedState.fingerprintMatches;
  const blocked = stalePersistedState || validationSummary.status === "blocked" || operationalHealth.state === "failed";
  const retryable = operationalHealth.retry.retryable;
  const scheduled = lifecycle.schedule && !lifecycle.schedule.due;
  const alreadyCommitted = persistedState.phase === "committed" && persistedState.fingerprintMatches;
  const restartRecovery =
    persistedStateTruth.recoveryRequired &&
    persistedState.recovery.status !== "stale-fingerprint" &&
    persistedState.recovery.status !== "cancelled";
  const awaitingReview =
    !blocked &&
    !retryable &&
    !scheduled &&
    (
      readiness.state === "review-ready" ||
      validationSummary.warning.length > 0 ||
      clientDraftNeedsSync ||
      productWorkflowNeedsHandoff ||
      productSyncBlocked
    );
  const decision = alreadyCommitted
    ? "noop-committed"
    : restartRecovery
      ? "recover"
      : canCommitNow
    ? "commit"
    : retryable
      ? "retry"
      : scheduled
        ? "queue"
        : blocked
          ? "deny"
          : awaitingReview
            ? "review"
            : "hold";
  const targetQueue =
    decision === "queue"
      ? lifecycle.schedule.queue
      : decision === "recover"
        ? "hosted-kernel.fs-write.recovery"
      : retryable
        ? "hosted-kernel.fs-write.retry"
        : providerHandoffContract && providerHandoffContract.state === "ready"
          ? providerHandoffContract.delivery.queue
          : externalHandoff.state === "ready"
            ? externalHandoff.target
          : null;
  const denialReasons = decision === "deny"
    ? uniqueStrings([
        ...validationSummary.blocking,
        ...operationalHealth.blockedReasons,
        ...(stalePersistedState ? ["persistedState.fingerprint_mismatch"] : [])
      ], [])
    : [];
  const holdReasons = decision === "hold" || decision === "review"
    ? uniqueStrings([
        ...validationSummary.warning,
        ...(clientDraftNeedsSync ? clientDraft.warnings : []),
        clientDraftNeedsSync ? "clientDraft.needs_sync" : "",
        productWorkflowNeedsHandoff ? productWorkflowHandoff.requiredBeforeCommit[0] : "",
        productSyncBlocked ? productSyncContract.requiredBeforeCommit[0] : "",
        !clientDraftNeedsSync && !productWorkflowNeedsHandoff && !productSyncBlocked ? readiness.state : ""
      ], [])
    : [];

  return {
    version: "aios.fs-write.hosted-kernel-intent.v1",
    generatedAt,
    decision,
    commitEligible: canCommitNow,
    idempotentReplay: alreadyCommitted,
    recoveryRequired: restartRecovery,
    idempotentCommand: persistedState.command.idempotent,
    restartStatus: persistedState.recovery.status,
    persistedTruth: {
      version: persistedStateTruth.version,
      accepted: persistedStateTruth.accepted,
      commitAllowed: persistedStateTruth.commitAllowed,
      route: persistedStateTruth.route,
      terminalAcknowledgement: persistedStateTruth.terminalAcknowledgement,
      recoveryRequired: persistedStateTruth.recoveryRequired,
      commandOutcome: persistedStateTruth.commandOutcome,
      requiredBeforeCommit: persistedStateTruth.requiredBeforeCommit
    },
    restartRoute: persistedState.restartPlan.route,
    restartAutoResume: persistedState.restartPlan.canAutoResume,
    checkpointRequired: persistedState.restartPlan.checkpointRequired,
    acceptanceRequired: readiness.gates.acceptanceRequired,
    acceptanceSatisfied: readiness.gates.acceptanceSatisfied,
    operation: {
      type: request.operation,
      byteLength: request.byteLength,
      contentHash: request.contentHash || null,
      contentDigest: contentIntegrity.digest,
      integrityLevel: contentIntegrity.integrityLevel,
      targetKind: targetClassification.kind,
      correlationId: request.correlationId
    },
    target: {
      scopedPath: workspaceScope.path.scoped,
      kind: targetClassification.kind,
      namespace: targetClassification.namespace,
      productId: targetClassification.productId,
      artifactId: targetClassification.artifactId,
      immutable: targetClassification.immutable,
      targetPolicyRoute: targetPolicy.route,
      targetPolicyAccepted: targetPolicy.accepted,
      requiredCapabilities: targetPolicy.requiredCapabilities,
      missingCapabilities: targetPolicy.missingCapabilities,
      requiredPermissions: targetPolicy.requiredPermissions,
      missingPermissions: targetPolicy.missingPermissions,
      capabilityProofState: targetPolicy.capabilityProofState,
      permissionProofState: targetPolicy.permissionProofState,
      auditHandoff: targetPolicy.auditHandoff,
      tenantId: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      permission: workspaceScope.requestedPermission,
      isolationMode: workspaceScope.tenantBoundary.isolationMode,
      actorTenantId: workspaceScope.tenantBoundary.actorTenantId,
      tenantBoundaryAccepted:
        workspaceScope.tenantBoundary.actorTenantMatches &&
        workspaceScope.tenantBoundary.tenantTrusted &&
        workspaceScope.tenantBoundary.workspaceAllowed &&
        workspaceScope.tenantBoundary.delegationAccepted,
      tenantBoundarySubject: workspaceScope.tenantBoundary.auditSubject
    },
    client: {
      runtimeId: clientRuntime.runtimeId,
      sessionId: clientRuntime.sessionId,
      surface: clientRuntime.surface,
      route: clientRuntime.route,
      requireExplicitCommit: clientRuntime.preferences.requireExplicitCommit,
      draft: clientDraft
        ? {
            present: clientDraft.present,
            draftId: clientDraft.draftId,
            adoptionState: clientDraft.adoptionState,
            dirty: clientDraft.dirty,
            pendingBytes: clientDraft.pendingBytes,
            lastEditedAt: clientDraft.lastEditedAt,
            warnings: clientDraft.warnings
          }
        : null
    },
    productWorkflow: productWorkflowHandoff
      ? {
          version: productWorkflowHandoff.version,
          required: productWorkflowHandoff.required,
          state: productWorkflowHandoff.state,
          targetProductId: productWorkflowHandoff.targetProductId,
          activeProductId: productWorkflowHandoff.activeProductId,
          productMatches: productWorkflowHandoff.productMatches,
          revision: productWorkflowHandoff.revision,
          acknowledgement: productWorkflowHandoff.acknowledgement,
          destination: productWorkflowHandoff.destination,
          requiredBeforeCommit: productWorkflowHandoff.requiredBeforeCommit,
          statePatch: productWorkflowHandoff.statePatch
        }
      : null,
    productSync: productSyncContract
      ? {
          version: productSyncContract.version,
          required: productSyncContract.required,
          state: productSyncContract.state,
          authority: productSyncContract.authority,
          conflictStrategy: productSyncContract.conflictStrategy,
          targetProductId: productSyncContract.targetProductId,
          requestedProductId: productSyncContract.requestedProductId,
          serviceProductId: productSyncContract.serviceProductId,
          productMatches: productSyncContract.productMatches,
          schemaVersion: productSyncContract.schemaVersion,
          lock: productSyncContract.lock,
          requiredCapabilities: productSyncContract.requiredCapabilities,
          requiredBeforeCommit: productSyncContract.requiredBeforeCommit,
          statePatch: productSyncContract.statePatch
        }
      : null,
    route: {
      providerId: provider.id,
      protocol: provider.protocol,
      durability: provider.durability,
      queue: targetQueue,
      handoffState: providerHandoffContract ? providerHandoffContract.state : externalHandoff.state,
      handoffToken: externalHandoff.state === "not-required" ? null : externalHandoff.token,
      transferId: providerHandoffContract ? providerHandoffContract.transferId : null,
      acknowledgementState: providerHandoffContract
        ? providerHandoffContract.acknowledgement.state
        : "not-required"
    },
    providerServiceContract: providerServiceContract
      ? {
          serviceId: providerServiceContract.serviceId,
          serviceLevel: providerServiceContract.serviceLevel,
          writeMode: providerServiceContract.writeMode,
          active: providerServiceContract.active,
          quota: providerServiceContract.quota,
          lease: providerServiceContract.lease,
          handoffRequired: providerServiceContract.handoffRequired,
          syncMetadataRequired: providerServiceContract.syncMetadataRequired,
          auditRequired: providerServiceContract.auditRequired,
          violations: providerServiceContract.violations,
          warnings: providerServiceContract.warnings
        }
      : null,
    providerHandoffContract: providerHandoffContract
      ? {
          version: providerHandoffContract.version,
          state: providerHandoffContract.state,
          transferId: providerHandoffContract.transferId,
          target: providerHandoffContract.target,
          delivery: providerHandoffContract.delivery,
          acknowledgement: providerHandoffContract.acknowledgement,
          commitBarrier: providerHandoffContract.commitBarrier,
          requiredBeforeCommit: providerHandoffContract.requiredBeforeCommit,
          statePatch: providerHandoffContract.statePatch
        }
      : null,
    persistedState: {
      version: persistedState.version,
      phase: persistedState.phase,
      idempotencyKey: persistedState.idempotencyKey,
      fingerprintMatches: persistedState.fingerprintMatches,
      restartSafe: persistedState.restartSafe,
      terminal: persistedState.terminal,
      stablePhase: persistedState.stablePhase,
      restoredFromJournal: persistedState.restoredFromJournal,
      replayCount: persistedState.replayCount,
      recoveryCount: persistedState.recoveryCount,
      command: persistedState.command,
      commandLedger: persistedState.commandLedger,
      recovery: persistedState.recovery,
      restartPlan: persistedState.restartPlan,
      journal: persistedState.journal,
      statePatch: persistedState.statePatch
    },
    persistedStateTruth,
    concurrency: {
      revision: syncMetadata.revision,
      previousRevision: syncMetadata.previousRevision,
      conflictPolicy: syncMetadata.conflictPolicy,
      syncScope: syncMetadata.syncScope
    },
    contentIntegrity: {
      version: contentIntegrity.version,
      algorithm: contentIntegrity.algorithm,
      digest: contentIntegrity.digest,
      digestMatchesRequest: contentIntegrity.digestMatchesRequest,
      byteLengthMatchesRequest: contentIntegrity.byteLengthMatchesRequest,
      integrityLevel: contentIntegrity.integrityLevel,
      chunks: contentIntegrity.chunks,
      violations: contentIntegrity.violations,
      warnings: contentIntegrity.warnings
    },
    schedule: {
      policy: lifecycle.schedule.policy,
      scheduledAt: lifecycle.schedule.scheduledAt,
      maintenanceWindow: lifecycle.schedule.maintenanceWindow,
      due: lifecycle.schedule.due,
      retryAt: retryable ? operationalHealth.retry.backoff.retryAt : null
    },
    lifecycleCommand: {
      command: lifecycle.command,
      sourceMode: lifecycle.sourceMode,
      targetMode: lifecycle.commandPlan.targetMode,
      nextAction: lifecycle.nextAction,
      nextActionState: lifecycle.nextActionState,
      route: lifecycle.commandPlan.route,
      transitionAllowed: lifecycle.commandPlan.transitionAllowed,
      idempotent: lifecycle.commandPlan.idempotent,
      schedulerGate: lifecycle.commandPlan.schedulerGate,
      requiredBeforeCommand: lifecycle.commandPlan.requiredBeforeCommand,
      statePatch: lifecycle.commandPlan.statePatch
    },
    failurePolicy: {
      retryable,
      retryAttempt: operationalHealth.retry.attempt,
      maxAttempts: operationalHealth.retry.maxAttempts,
      retryBudgetRemaining: operationalHealth.retry.budgetRemaining,
      retryBudgetExhausted: operationalHealth.retry.budgetExhausted,
      directCommitBlocked: operationalHealth.directCommitBlocked,
      queueAllowed: operationalHealth.queueAllowed,
      recoveryRoute: operationalHealth.recovery.route,
      failureClass: operationalHealth.recovery.failureClass,
      commitSafety: operationalHealth.recovery.commitSafety,
      queuePolicy: operationalHealth.recovery.queuePolicy,
      operatorActions: operationalHealth.recovery.operatorActions,
      circuitBreaker: operationalHealth.healthPolicy.circuitBreaker,
      degradedMode: operationalHealth.healthPolicy.degradedMode,
      denialReasons,
      holdReasons
    },
    acceptanceRoute: {
      command: acceptance.routeCommand,
      decision: acceptance.decision,
      acceptedAt: acceptance.acceptedAt,
      rejectedReason: acceptance.rejectedReason,
      tokenValid: acceptance.submission.tokenValid,
      missingAcknowledgements: acceptance.missingAcknowledgements
    },
    auditBinding: {
      eventType: "syscall.fs.write.contract.evaluated",
      lifecycleControlAudit: {
        version: lifecycle.nextActionState.version,
        action: lifecycle.nextActionState.action,
        reason: lifecycle.nextActionState.reason,
        owner: lifecycle.nextActionState.owner,
        actionable: lifecycle.nextActionState.actionable,
        requiredBeforeAction: lifecycle.nextActionState.requiredBeforeAction,
        enabledCommands: lifecycle.nextActionState.commandControls
          .filter((control) => control.enabled)
          .map((control) => control.command),
        disabledCommands: lifecycle.nextActionState.commandControls
          .filter((control) => !control.enabled)
          .map((control) => control.command),
        scheduleControl: lifecycle.nextActionState.scheduleControl
      },
      commitGateAudit: {
        version: readiness.commitGateAudit.version,
        state: readiness.commitGateAudit.state,
        failedGateIds: readiness.commitGateAudit.failedGateIds,
        requiredBeforeCommit: readiness.commitGateAudit.requiredBeforeCommit,
        warningGateIds: readiness.commitGateAudit.warningGateIds
      },
      requiredProofs: [
        "tenant-boundary",
        "tenant-permission-boundary",
        "permission-grant",
        "write-target-classification",
        "write-target-boundary",
        "sync-revision",
        "provider-capability",
        "content-integrity",
        ...(targetPolicy.requiredPermissions.length > 0 ? ["target-permission-grant"] : []),
        ...(targetPolicy.requiredCapabilities.length > 0 ? ["target-provider-capability"] : []),
        ...(targetClassification.kind === "artifact" ? ["artifact-digest"] : []),
        ...(targetClassification.kind === "product" ? ["product-sync-revision"] : []),
        ...(productSyncContract && productSyncContract.required
          ? ["product-sync-contract"]
          : []),
        ...(productWorkflowHandoff && productWorkflowHandoff.required
          ? ["product-workflow-handoff"]
          : []),
        ...(persistedState.restartPlan.checkpointRequired ? ["restart-checkpoint"] : []),
        ...(providerHandoffContract && providerHandoffContract.acknowledgement.required
          ? ["provider-handoff-ack"]
          : []),
        ...(lifecycle.nextActionState.requiredBeforeAction.length > 0
          ? ["lifecycle-next-action"]
          : []),
        ...(operationalHealth.healthPolicy.circuitBreaker.state !== "closed" ? ["health-circuit"] : []),
        ...(operationalHealth.healthPolicy.degradedMode.enabled ? ["degraded-mode-policy"] : []),
        ...(operationalHealth.retry.budgetExhausted ? ["retry-budget"] : [])
      ],
      proofSubjects: [
        workspaceScope.tenantBoundary.auditSubject,
        targetClassification.auditSubject,
        workspaceScope.path.scoped,
        syncMetadata.revision,
        contentIntegrity.digest || contentIntegrity.integrityLevel,
        provider.id,
        request.correlationId,
        targetPolicy.permissionProofState,
        targetPolicy.capabilityProofState,
        productWorkflowHandoff && productWorkflowHandoff.targetProductId
          ? `product:${productWorkflowHandoff.targetProductId}:${productWorkflowHandoff.state}`
          : "product:not-required",
        productSyncContract ? productSyncContract.auditSubject : "product-sync:not-required",
        operationalHealth.healthPolicy.circuitBreaker.state,
        operationalHealth.healthPolicy.degradedMode.commitMode,
        `retry:${operationalHealth.retry.attempt}/${operationalHealth.retry.maxAttempts}`,
        operationalHealth.recovery.route,
        operationalHealth.recovery.commitSafety,
        lifecycle.nextActionState.reason,
        lifecycle.nextActionState.owner
      ]
    }
  };
}

function buildNextSteps(
  request,
  validationSummary,
  readiness,
  externalHandoff,
  operationalHealth,
  lifecycleSettings,
  persistedState,
  clientDraft,
  providerHandoffContract,
  productWorkflowHandoff,
  productSyncContract
) {
  if (persistedState && persistedState.phase === "committed" && persistedState.fingerprintMatches) {
    return [
      {
        id: "acknowledge-idempotent-write",
        label: "Write already committed",
        action: "fs.write.acknowledge-committed",
        enabled: true,
        reason: "persisted_state_committed",
        idempotencyKey: persistedState.idempotencyKey
      }
    ];
  }

  if (
    readiness.readyToCommit &&
    (!operationalHealth || operationalHealth.commitAllowed) &&
    (!clientDraft || clientDraft.adoptionState !== "needs-client-sync")
  ) {
    return [
      {
        id: "commit-write",
        label: "Commit write",
        action: "fs.write.commit",
        enabled: true,
        reason: "request_validated_and_provider_ready"
      }
    ];
  }

  const steps = validationSummary.blocking.map((issue) => {
    const permissionIssue = issue.startsWith("permission.missing.");
    const scopeIssue = issue === "tenant.required" || issue === "workspace.required";
    const boundaryIssue =
      issue === "path.workspace_escape" ||
      issue === "path.outside_workspace" ||
      issue === "path.outside_allowed_prefix";
    const productWorkflowIssue = issue.startsWith("productWorkflow.");
    return {
      id: `resolve-${issue}`,
      label: issue.startsWith("capability.missing.")
        ? "Select compatible provider"
        : permissionIssue
          ? "Request workspace permission"
          : scopeIssue
            ? "Select tenant workspace"
            : boundaryIssue
              ? "Move path inside workspace"
              : productWorkflowIssue
                ? issue === "productWorkflow.product_mismatch"
                  ? "Select product workflow"
                  : "Acknowledge product write"
              : "Update write request",
      action: issue.startsWith("capability.missing.")
        ? "provider.select"
        : permissionIssue
          ? "tenant.permission.request"
          : scopeIssue
            ? "workspace.select"
            : boundaryIssue
              ? "fs.write.retarget-workspace-path"
              : productWorkflowIssue
                ? issue === "productWorkflow.product_mismatch"
                  ? "fs.write.product-workflow.select"
                  : "fs.write.product-workflow.acknowledge"
              : "fs.write.edit-request",
      enabled: true,
      reason: issue
    };
  });

  if (clientDraft && clientDraft.adoptionState === "needs-client-sync") {
    steps.push({
      id: "sync-client-draft",
      label: "Sync write draft",
      action: "fs.write.client-draft.sync",
      enabled: true,
      reason: clientDraft.warnings[0] || "client_draft_needs_sync",
      draftId: clientDraft.draftId,
      pendingBytes: clientDraft.pendingBytes
    });
  }

  if (readiness.state === "acceptance-required") {
    steps.push({
      id: "accept-write-preview",
      label: "Accept write preview",
      action: "fs.write.acceptance.accept",
      enabled: true,
      reason: "acceptance_required"
    });
  }

  if (productWorkflowHandoff && productWorkflowHandoff.state === "blocked") {
    steps.push({
      id: "select-product-workflow",
      label: "Select product workflow",
      action: "fs.write.product-workflow.select",
      enabled: true,
      reason: "productWorkflow.product_mismatch",
      targetProductId: productWorkflowHandoff.targetProductId,
      activeProductId: productWorkflowHandoff.activeProductId,
      route: productWorkflowHandoff.destination.route
    });
  }

  if (productWorkflowHandoff && productWorkflowHandoff.state === "awaiting-user") {
    steps.push({
      id: "acknowledge-product-workflow",
      label: "Acknowledge product write",
      action: "fs.write.product-workflow.acknowledge",
      enabled: true,
      reason: productWorkflowHandoff.requiredBeforeCommit[0] || "productWorkflow.ack_required",
      productId: productWorkflowHandoff.targetProductId,
      revision: productWorkflowHandoff.revision,
      acknowledgementToken: productWorkflowHandoff.acknowledgement.token,
      route: productWorkflowHandoff.destination.route
    });
  }

  if (productSyncContract && productSyncContract.state === "blocked") {
    const issue = productSyncContract.requiredBeforeCommit[0] || "productSync.blocked";
    steps.push({
      id: "resolve-product-sync-contract",
      label:
        issue === "productSync.provider_lock.required" || issue === "productSync.provider_lock.expired"
          ? "Update product sync lock"
          : issue === "productSync.schema.required"
            ? "Attach product sync schema"
            : "Select product sync context",
      action:
        issue === "productSync.provider_lock.required"
          ? "fs.write.product-sync.attach-lock"
          : issue === "productSync.provider_lock.expired"
            ? "fs.write.product-sync.renew-lock"
            : issue === "productSync.schema.required"
              ? "fs.write.product-sync.attach-schema"
              : "fs.write.product-sync.select",
      enabled: true,
      reason: issue,
      productId: productSyncContract.targetProductId || productSyncContract.requestedProductId,
      serviceProductId: productSyncContract.serviceProductId,
      schemaVersion: productSyncContract.schemaVersion,
      lockRequired: productSyncContract.lock.required,
      lockExpiresAt: productSyncContract.lock.expiresAt,
      statePatch: productSyncContract.statePatch
    });
  }

  if (lifecycleSettings && !lifecycleSettings.enabled) {
    steps.push({
      id: "enable-fs-write",
      label: "Enable writes",
      action: "fs.write.lifecycle.enable",
      enabled: lifecycleSettings.controls.canEnable,
      reason: lifecycleSettings.command === "cancel" ? "write_lifecycle_cancelled" : "write_lifecycle_disabled"
    });
  }

  if (lifecycleSettings && lifecycleSettings.mode === "paused") {
    steps.push({
      id: "resume-fs-write",
      label: "Resume writes",
      action: "fs.write.lifecycle.resume",
      enabled: lifecycleSettings.controls.canResume,
      reason: "write_lifecycle_paused"
    });
  }

  if (lifecycleSettings && !lifecycleSettings.schedule.due) {
    steps.push({
      id: "await-schedule",
      label: "Wait for schedule",
      action:
        lifecycleSettings.schedule.policy === "queued"
          ? "fs.write.queue"
          : "fs.write.schedule.await",
      enabled: lifecycleSettings.schedule.policy === "queued",
      reason:
        lifecycleSettings.schedule.policy === "maintenance-window"
          ? "write_awaiting_maintenance_window"
          : lifecycleSettings.schedule.policy === "queued"
            ? "write_queued_by_lifecycle_policy"
            : "write_scheduled_for_future",
      scheduledAt: lifecycleSettings.schedule.scheduledAt,
      maintenanceWindow: lifecycleSettings.schedule.maintenanceWindow,
      queue: lifecycleSettings.schedule.queue
    });
  }

  if (lifecycleSettings && lifecycleSettings.commandPlan.blockedReason) {
    steps.push({
      id: "fix-lifecycle-command",
      label: "Update lifecycle command",
      action: lifecycleSettings.commandPlan.route,
      enabled: true,
      reason: lifecycleSettings.commandPlan.blockedReason,
      sourceMode: lifecycleSettings.commandPlan.sourceMode,
      targetMode: lifecycleSettings.commandPlan.targetMode,
      requiredBeforeCommand: lifecycleSettings.commandPlan.requiredBeforeCommand
    });
  }

  if (
    persistedState &&
    persistedState.fingerprintMatches &&
    (persistedState.phase === "queued" ||
      persistedState.phase === "committing" ||
      persistedState.phase === "failed")
  ) {
    steps.push({
      id: "recover-persisted-write",
      label: "Recover write",
      action: persistedState.restartPlan.route,
      enabled: persistedState.restartPlan.canAutoResume || persistedState.phase === "failed",
      reason: `persisted_state_${persistedState.phase}`,
      idempotencyKey: persistedState.idempotencyKey,
      resumeCommand: persistedState.restartPlan.resumeCommand,
      requiredBeforeRestartSafe: persistedState.restartPlan.requiredBeforeRestartSafe
    });
  }

  if (persistedState && persistedState.restartPlan.needsJournalFlush) {
    steps.push({
      id: "flush-command-ledger",
      label: "Flush command ledger",
      action: "journal.flush-command-ledger",
      enabled: true,
      reason: "command_accepted_without_journal_sequence",
      idempotencyKey: persistedState.idempotencyKey,
      commandToken: persistedState.commandLedger.token
    });
  }

  if (persistedState && persistedState.restartPlan.checkpointRequired) {
    steps.push({
      id: "persist-restart-checkpoint",
      label: "Persist restart checkpoint",
      action: "journal.persist-checkpoint",
      enabled: true,
      reason: `persisted_phase_${persistedState.phase}_requires_checkpoint`,
      expectedPreviousSequence: persistedState.journal.sequence,
      stablePhase: persistedState.stablePhase
    });
  }

  if (externalHandoff.state === "deferred") {
    steps.push({
      id: "resume-handoff",
      label: "Resume external handoff",
      action: "fs.write.external-handoff.resume",
      enabled: true,
      reason: externalHandoff.reason
    });
  }

  if (providerHandoffContract && providerHandoffContract.commitBarrier) {
    steps.push({
      id: "acknowledge-provider-handoff",
      label: "Acknowledge provider handoff",
      action: "fs.write.external-handoff.acknowledge",
      enabled: providerHandoffContract.state !== "blocked",
      reason: providerHandoffContract.requiredBeforeCommit[0] || "externalHandoff.ack_required",
      transferId: providerHandoffContract.transferId,
      acknowledgementToken: providerHandoffContract.acknowledgement.expectedToken,
      deadlineAt: providerHandoffContract.delivery.deadlineAt
    });
  }

  if (operationalHealth) {
    if (operationalHealth.healthPolicy.circuitBreaker.state === "open") {
      steps.push({
        id: "reset-health-circuit",
        label: "Reset write health circuit",
        action: "fs.write.health.reset-circuit",
        enabled: false,
        reason: "health.circuit_open",
        nextProbeAt: operationalHealth.healthPolicy.circuitBreaker.nextProbeAt,
        failureCount: operationalHealth.healthPolicy.circuitBreaker.failureCount
      });
    }

    if (operationalHealth.healthPolicy.circuitBreaker.state === "half-open") {
      steps.push({
        id: "probe-health-circuit",
        label: "Probe write provider",
        action: "fs.write.health.probe",
        enabled: true,
        reason: "health.circuit_half_open",
        lastProbeAt: operationalHealth.healthPolicy.circuitBreaker.lastProbeAt
      });
    }

    if (operationalHealth.retry.budgetExhausted) {
      steps.push({
        id: "escalate-retry-budget",
        label: "Escalate exhausted retry budget",
        action: "fs.write.escalate",
        enabled: true,
        reason: "health.retry_budget_exhausted",
        attempt: operationalHealth.retry.attempt,
        maxAttempts: operationalHealth.retry.maxAttempts
      });
    }

    if (operationalHealth.healthPolicy.degradedMode.queueOnly && operationalHealth.queueAllowed) {
      steps.push({
        id: "queue-degraded-write",
        label: "Queue write",
        action: "fs.write.queue",
        enabled: true,
        reason: "health.degraded_queue_only",
        allowedActions: operationalHealth.healthPolicy.degradedMode.allowedActions
      });
    }

    if (operationalHealth.retry.retryable) {
      steps.push({
        id: "retry-write",
        label: "Retry write",
        action: "fs.write.retry",
        enabled: true,
        reason: operationalHealth.retry.retryableFailures[0] || "transient_failure",
        retryAt: operationalHealth.retry.backoff.retryAt
      });
    }

    for (const error of operationalHealth.actionableErrors) {
      if (steps.some((step) => step.action === error.action || step.reason === error.issue)) continue;
      steps.push({
        id: `recover-${error.issue}`,
        label:
          error.owner === "requester"
            ? "Fix request"
            : error.owner === "integration"
              ? "Restore integration"
              : "Restore platform health",
        action: error.action,
        enabled: error.severity === "error" || operationalHealth.state !== "healthy",
        reason: error.issue
      });
    }
  }

  if (steps.length === 0) {
    steps.push({
      id: "review-warnings",
      label: "Review warnings",
      action: "fs.write.review",
      enabled: true,
      reason: validationSummary.warning[0] || `awaiting_${readiness.state}`
    });
  }

  return steps;
}

function groupNextStepsForClient(nextSteps) {
  const buckets = {
    primary: [],
    requester: [],
    platform: [],
    integration: [],
    waiting: []
  };

  for (const step of nextSteps) {
    const target =
      step.action === "fs.write.commit" || step.action === "fs.write.review"
        || step.action === "fs.write.acceptance.accept"
        ? "primary"
        : step.action === "fs.write.schedule.await"
          ? "waiting"
          : step.action.startsWith("tenant.") ||
              step.action.startsWith("workspace.") ||
              step.action === "fs.write.edit-request" ||
              step.action === "fs.write.client-draft.sync" ||
              step.action.startsWith("fs.write.product-workflow") ||
              step.action.startsWith("fs.write.product-sync") ||
              step.action === "fs.write.retarget-workspace-path"
            ? "requester"
            : step.action.startsWith("fs.write.external-handoff")
              ? "integration"
              : "platform";
    buckets[target].push(step);
  }

  return Object.fromEntries(Object.entries(buckets).filter(([, steps]) => steps.length > 0));
}

function normalizeClientRuntimeState(input, request, workspaceScope, generatedAt) {
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const session = input.session && typeof input.session === "object" ? input.session : {};
  const surfaceInput =
    typeof client.surface === "string" && client.surface.trim()
      ? client.surface.trim()
      : typeof session.surface === "string" && session.surface.trim()
        ? session.surface.trim()
        : "api-client";
  const surface = CLIENT_SURFACES.has(surfaceInput) ? surfaceInput : "api-client";
  const requestedView =
    typeof client.view === "string" && client.view.trim()
      ? client.view.trim()
      : typeof session.view === "string" && session.view.trim()
        ? session.view.trim()
        : "fs-write";
  const routeBase =
    typeof client.route === "string" && client.route.trim()
      ? client.route.trim().replace(/\/+$/g, "")
      : `/workspaces/${workspaceScope.workspaceId || "unselected"}/fs-write`;
  const runtimeId =
    typeof client.runtimeId === "string" && client.runtimeId.trim()
      ? client.runtimeId.trim()
      : typeof session.runtimeId === "string" && session.runtimeId.trim()
        ? session.runtimeId.trim()
        : `${surface}:${request.correlationId}`;

  return {
    version: "aios.fs-write.client-runtime.v1",
    runtimeId,
    sessionId:
      typeof session.id === "string" && session.id.trim()
        ? session.id.trim()
        : `${workspaceScope.workspaceId || "workspace"}:${request.actor}`,
    surface,
    view: requestedView,
    routeBase,
    route: `${routeBase}?correlationId=${encodeURIComponent(request.correlationId)}`,
    actor: request.actor,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    lastSeenAt:
      typeof client.lastSeenAt === "string" && client.lastSeenAt.trim()
        ? client.lastSeenAt.trim()
        : generatedAt,
    capabilities: uniqueStrings(client.capabilities, ["workflow.handoff", "fs.write.preview"]),
    preferences: {
      autoOpenReview: client.autoOpenReview !== false,
      optimisticPreview: client.optimisticPreview === true,
      requireExplicitCommit: client.requireExplicitCommit === true
    }
  };
}

function buildProductWorkflowHandoff(input, request, clientRuntime, targetClassification, syncMetadata, generatedAt) {
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const session = input.session && typeof input.session === "object" ? input.session : {};
  const workflowInput =
    input.productWorkflow && typeof input.productWorkflow === "object"
      ? input.productWorkflow
      : client.productWorkflow && typeof client.productWorkflow === "object"
        ? client.productWorkflow
        : session.productWorkflow && typeof session.productWorkflow === "object"
          ? session.productWorkflow
          : {};
  const targetProductId = targetClassification.kind === "product" ? targetClassification.productId : null;
  const activeProductId =
    typeof workflowInput.productId === "string" && workflowInput.productId.trim()
      ? workflowInput.productId.trim()
      : typeof client.activeProductId === "string" && client.activeProductId.trim()
        ? client.activeProductId.trim()
        : typeof session.productId === "string" && session.productId.trim()
          ? session.productId.trim()
          : targetProductId;
  const requireAcknowledgement =
    targetClassification.kind === "product" &&
    (
      workflowInput.requireAcknowledgement === true ||
      clientRuntime.surface === "file-editor" ||
      clientRuntime.preferences.requireExplicitCommit
    );
  const acknowledgement = workflowInput.acknowledgement && typeof workflowInput.acknowledgement === "object"
    ? workflowInput.acknowledgement
    : workflowInput.ack && typeof workflowInput.ack === "object"
      ? workflowInput.ack
      : {};
  const acknowledgementToken =
    typeof acknowledgement.expectedToken === "string" && acknowledgement.expectedToken.trim()
      ? acknowledgement.expectedToken.trim()
      : `${request.correlationId}:product:${targetProductId || "unresolved"}:${syncMetadata.revision}:handoff`;
  const submittedToken =
    typeof acknowledgement.token === "string" && acknowledgement.token.trim()
      ? acknowledgement.token.trim()
      : typeof workflowInput.ackToken === "string" && workflowInput.ackToken.trim()
        ? workflowInput.ackToken.trim()
        : null;
  const acknowledgedAt =
    typeof acknowledgement.acceptedAt === "string" && acknowledgement.acceptedAt.trim()
      ? acknowledgement.acceptedAt.trim()
      : typeof workflowInput.acknowledgedAt === "string" && workflowInput.acknowledgedAt.trim()
        ? workflowInput.acknowledgedAt.trim()
        : null;
  const productMatches = !targetProductId || !activeProductId || activeProductId === targetProductId;
  const tokenValid = !requireAcknowledgement || submittedToken === acknowledgementToken;
  const acknowledged = requireAcknowledgement && productMatches && tokenValid && Boolean(acknowledgedAt);
  const state =
    targetClassification.kind !== "product"
      ? "not-required"
      : !productMatches
        ? "blocked"
        : !requireAcknowledgement
          ? "ready"
          : acknowledged
            ? "ready"
            : "awaiting-user";
  const requiredBeforeCommit = uniqueStrings([
    state === "blocked" ? "productWorkflow.product_mismatch" : "",
    state === "awaiting-user" ? "productWorkflow.ack_required" : ""
  ], []);

  return {
    version: "aios.fs-write.product-workflow-handoff.v1",
    required: targetClassification.kind === "product",
    state,
    targetProductId,
    activeProductId,
    productMatches,
    revision: syncMetadata.revision,
    previousRevision: syncMetadata.previousRevision,
    acknowledgement: {
      required: requireAcknowledgement,
      state:
        state === "not-required"
          ? "not-required"
          : !productMatches
            ? "rejected"
            : acknowledged
              ? "accepted"
              : requireAcknowledgement
                ? "pending"
                : "not-required",
      token: acknowledgementToken,
      tokenPresent: Boolean(submittedToken),
      tokenValid,
      acceptedAt: acknowledged ? acknowledgedAt || generatedAt : null
    },
    destination: {
      surface: clientRuntime.surface,
      route: `${clientRuntime.routeBase}/product/${encodeURIComponent(targetProductId || "unresolved")}?correlationId=${encodeURIComponent(request.correlationId)}`,
      action: state === "blocked" ? "fs.write.product-workflow.select" : "fs.write.product-workflow.acknowledge"
    },
    requiredBeforeCommit,
    statePatch: {
      runtimeId: clientRuntime.runtimeId,
      sessionId: clientRuntime.sessionId,
      correlationId: request.correlationId,
      productId: targetProductId,
      activeProductId,
      productWorkflowState: state,
      revision: syncMetadata.revision,
      acknowledgementState:
        acknowledged
          ? "accepted"
          : requireAcknowledgement
            ? "pending"
            : "not-required",
      acknowledgementToken,
      updatedAt: generatedAt
    }
  };
}

function normalizeClientDraftState(input, request, workspaceScope, contentIntegrity, generatedAt) {
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const session = input.session && typeof input.session === "object" ? input.session : {};
  const draftInput =
    client.draftWrite && typeof client.draftWrite === "object"
      ? client.draftWrite
      : client.draft && typeof client.draft === "object"
        ? client.draft
        : session.draftWrite && typeof session.draftWrite === "object"
          ? session.draftWrite
          : {};
  const hasDraft = Object.keys(draftInput).length > 0;
  const draftPath =
    typeof draftInput.path === "string" && draftInput.path.trim()
      ? draftInput.path.trim()
      : request.path;
  const normalizedDraftPath = normalizePathSegments(draftPath);
  const scopedPath = draftPath.startsWith("/")
    ? normalizedDraftPath.normalizedPath
    : normalizePathSegments(`${workspaceScope.rootPath}/${normalizedDraftPath.normalizedPath}`).normalizedPath;
  const pendingBytes =
    Number.isInteger(draftInput.byteLength) && draftInput.byteLength >= 0
      ? draftInput.byteLength
      : Number.isInteger(draftInput.bytes) && draftInput.bytes >= 0
        ? draftInput.bytes
        : request.byteLength;
  const draftDigest = splitDigest(draftInput.digest || draftInput.hash || draftInput.contentHash);
  const digest = draftDigest.digest || contentIntegrity.digest || null;
  const matchesPath = scopedPath === workspaceScope.path.scoped;
  const matchesBytes = pendingBytes === request.byteLength;
  const matchesDigest =
    !digest ||
    !contentIntegrity.digest ||
    digest.toLowerCase() === contentIntegrity.digest.toLowerCase();
  const dirty = draftInput.dirty === true || draftInput.unsaved === true || hasDraft && (!matchesPath || !matchesBytes || !matchesDigest);
  const warnings = [];

  if (hasDraft && !matchesPath) warnings.push("clientDraft.path.differs_from_request");
  if (hasDraft && !matchesBytes) warnings.push("clientDraft.byteLength.differs_from_request");
  if (hasDraft && !matchesDigest) warnings.push("clientDraft.digest.differs_from_request");
  if (dirty && !draftInput.lastEditedAt && !draftInput.updatedAt) warnings.push("clientDraft.lastEditedAt.missing");

  return {
    version: "aios.fs-write.client-draft.v1",
    present: hasDraft,
    draftId:
      typeof draftInput.id === "string" && draftInput.id.trim()
        ? draftInput.id.trim()
        : hasDraft
          ? `${request.correlationId}:draft`
          : null,
    source:
      typeof draftInput.source === "string" && draftInput.source.trim()
        ? draftInput.source.trim()
        : hasDraft
          ? "client-runtime"
          : "request-only",
    dirty,
    adoptionState: !hasDraft
      ? "request-only"
      : dirty || warnings.length > 0
        ? "needs-client-sync"
        : "adopted",
    path: draftPath || null,
    scopedPath,
    pendingBytes,
    digest,
    encoding:
      typeof draftInput.encoding === "string" && CONTENT_ENCODINGS.has(draftInput.encoding)
        ? draftInput.encoding
        : contentIntegrity.encoding,
    lastEditedAt:
      typeof draftInput.lastEditedAt === "string" && draftInput.lastEditedAt.trim()
        ? draftInput.lastEditedAt.trim()
        : typeof draftInput.updatedAt === "string" && draftInput.updatedAt.trim()
          ? draftInput.updatedAt.trim()
          : hasDraft
            ? generatedAt
            : null,
    matchesRequest: {
      path: matchesPath,
      byteLength: matchesBytes,
      digest: matchesDigest
    },
    warnings,
    handoffPatch: {
      draftId:
        typeof draftInput.id === "string" && draftInput.id.trim()
          ? draftInput.id.trim()
          : hasDraft
            ? `${request.correlationId}:draft`
            : null,
      adoptionState: !hasDraft
        ? "request-only"
        : dirty || warnings.length > 0
          ? "needs-client-sync"
          : "adopted",
      pendingBytes,
      lastEditedAt:
        typeof draftInput.lastEditedAt === "string" && draftInput.lastEditedAt.trim()
          ? draftInput.lastEditedAt.trim()
          : typeof draftInput.updatedAt === "string" && draftInput.updatedAt.trim()
            ? draftInput.updatedAt.trim()
            : null
    }
  };
}

function buildWorkflowHandoff({
  clientRuntime,
  clientDraft,
  request,
  preview,
  acceptance,
  readiness,
  operationalHealth,
  lifecycle,
  writeIntent,
  persistedState,
  persistedStateTruth,
  productWorkflowHandoff,
  nextSteps,
  generatedAt
}) {
  const primaryStep = nextSteps.find((step) => step.enabled) || nextSteps[0] || null;
  const channel = !lifecycle.schedule.due
    ? "scheduler"
    : writeIntent.route.handoffState === "ready" && writeIntent.route.queue
      ? "integration"
      : operationalHealth.state === "failed" || operationalHealth.retry.retryable
        ? "platform"
        : "client";
  const owner =
    channel === "integration"
      ? "integration"
      : channel === "platform"
        ? "platform"
        : channel === "scheduler"
          ? "scheduler"
          : "requester";
  const activeView =
    productWorkflowHandoff && productWorkflowHandoff.state === "awaiting-user"
      ? "product"
      : clientDraft && clientDraft.adoptionState === "needs-client-sync"
      ? "edit"
      : readiness.state === "commit-ready"
      ? "commit"
      : readiness.state === "acceptance-required"
        ? "review"
      : readiness.state === "review-ready"
        ? "review"
        : readiness.state === "scheduled"
          ? "scheduled"
          : "resolve";
  const handoffState =
    writeIntent.decision === "commit"
      ? "ready"
      : writeIntent.decision === "noop-committed"
        ? "ready"
      : writeIntent.decision === "deny"
        ? "blocked"
        : writeIntent.decision === "retry" || writeIntent.decision === "queue" || writeIntent.decision === "recover"
          ? "deferred"
          : "awaiting-user";

  return {
    version: "aios.fs-write.workflow-handoff.v1",
    generatedAt,
    state: handoffState,
    channel: WORKFLOW_HANDOFF_CHANNELS.has(channel) ? channel : "client",
    owner,
    resumable: handoffState !== "blocked",
    token: `${request.correlationId}:workflow:${activeView}`,
    destination: {
      surface: clientRuntime.surface,
      view: activeView,
      route: `${clientRuntime.routeBase}/${activeView}?correlationId=${encodeURIComponent(request.correlationId)}`,
      primaryAction: primaryStep ? primaryStep.action : lifecycle.nextAction
    },
    statePatch: {
      runtimeId: clientRuntime.runtimeId,
      sessionId: clientRuntime.sessionId,
      correlationId: request.correlationId,
      scopedPath: preview.target.scopedPath,
      readinessState: readiness.state,
      healthState: operationalHealth.state,
      decision: writeIntent.decision,
      persistedPhase: persistedState.phase,
      idempotencyKey: persistedState.idempotencyKey,
      stablePhase: persistedState.stablePhase,
      restartSafe: persistedState.restartSafe,
      restartStatus: persistedState.recovery.status,
      restartRoute: persistedState.restartPlan.route,
      requiredBeforeRestartSafe: persistedState.restartPlan.requiredBeforeRestartSafe,
      requiredBeforeCommit: readiness.requiredBeforeCommit,
      commitGateAudit: {
        state: readiness.commitGateAudit.state,
        failedGateIds: readiness.commitGateAudit.failedGateIds,
        requiredBeforeCommit: readiness.commitGateAudit.requiredBeforeCommit
      },
      idempotentCommand: persistedState.command.idempotent,
      commandLedger: persistedState.commandLedger,
      persistedStatePatch: persistedState.statePatch,
      persistedStateTruthPatch: persistedStateTruth.statePatch,
      transferId: writeIntent.route.transferId,
      providerHandoffState: writeIntent.route.handoffState,
      acknowledgementState: writeIntent.route.acknowledgementState,
      productWorkflowState: productWorkflowHandoff ? productWorkflowHandoff.state : "not-required",
      productWorkflowPatch: productWorkflowHandoff ? productWorkflowHandoff.statePatch : null,
      acceptanceToken: acceptance.acceptanceToken,
      retryAt: writeIntent.schedule.retryAt,
      scheduledAt: lifecycle.schedule.scheduledAt,
      lifecycleCommandPlan: lifecycle.commandPlan,
      lifecycleNextActionState: lifecycle.nextActionState,
      clientDraft: clientDraft ? clientDraft.handoffPatch : null
    },
    userVisible: {
      headline:
        productWorkflowHandoff && productWorkflowHandoff.state === "awaiting-user"
          ? "Product write needs workflow acknowledgement"
          : productWorkflowHandoff && productWorkflowHandoff.state === "blocked"
            ? "Product write is attached to a different workflow"
            : clientDraft && clientDraft.adoptionState === "needs-client-sync"
          ? "Write draft needs to sync with the request"
          : handoffState === "ready"
          ? writeIntent.decision === "noop-committed"
            ? "Write was already committed"
            : "Write is ready to commit"
          : handoffState === "blocked"
            ? "Write needs changes before it can continue"
            : handoffState === "deferred"
              ? writeIntent.decision === "recover"
                ? "Write is being recovered after restart"
                : "Write is waiting for runtime handoff"
              : "Write needs review",
      actionLabel: primaryStep ? primaryStep.label : "Review write",
      disabledReason: primaryStep && primaryStep.enabled ? null : readiness.state
    },
    telemetry: {
      event: "fs_write_workflow_handoff_prepared",
      labels: [
        clientRuntime.surface,
        readiness.state,
        writeIntent.decision,
        operationalHealth.state,
        persistedState.phase
      ],
      proofSubject: request.correlationId
    }
  };
}

function normalizeAnalyticsHistory(input) {
  const analyticsInput =
    input.analytics && typeof input.analytics === "object"
      ? input.analytics
      : input.reporting && typeof input.reporting === "object"
        ? input.reporting
        : {};
  const rawHistory = Array.isArray(analyticsInput.history)
    ? analyticsInput.history
    : Array.isArray(analyticsInput.snapshots)
      ? analyticsInput.snapshots
      : [];

  return rawHistory
    .filter((snapshot) => snapshot && typeof snapshot === "object")
    .slice(-9)
    .map((snapshot, index) => ({
      version: "aios.fs-write.analytics-snapshot.v1",
      sequence:
        Number.isInteger(snapshot.sequence) && snapshot.sequence >= 0
          ? snapshot.sequence
          : index + 1,
      capturedAt:
        typeof snapshot.capturedAt === "string" && snapshot.capturedAt.trim()
          ? snapshot.capturedAt.trim()
          : typeof snapshot.at === "string" && snapshot.at.trim()
            ? snapshot.at.trim()
            : null,
      correlationId:
        typeof snapshot.correlationId === "string" && snapshot.correlationId.trim()
          ? snapshot.correlationId.trim()
          : null,
      tenantId:
        typeof snapshot.tenantId === "string" && snapshot.tenantId.trim()
          ? snapshot.tenantId.trim()
          : null,
      workspaceId:
        typeof snapshot.workspaceId === "string" && snapshot.workspaceId.trim()
          ? snapshot.workspaceId.trim()
          : null,
      tenantIsolationMode:
        typeof snapshot.tenantIsolationMode === "string" && TENANT_ISOLATION_MODES.has(snapshot.tenantIsolationMode)
          ? snapshot.tenantIsolationMode
          : "strict",
      providerId:
        typeof snapshot.providerId === "string" && snapshot.providerId.trim()
          ? snapshot.providerId.trim()
          : "unknown-provider",
      operation: snapshot.operation === "append" ? "append" : "write",
      contentIntegrityLevel:
        typeof snapshot.contentIntegrityLevel === "string" && snapshot.contentIntegrityLevel.trim()
          ? snapshot.contentIntegrityLevel.trim()
          : "unknown",
      targetKind:
        typeof snapshot.targetKind === "string" && WRITE_TARGET_KINDS.has(snapshot.targetKind)
          ? snapshot.targetKind
          : "workspace",
      decision:
        typeof snapshot.decision === "string" && snapshot.decision.trim()
          ? snapshot.decision.trim()
          : "unknown",
      readinessState:
        typeof snapshot.readinessState === "string" && snapshot.readinessState.trim()
          ? snapshot.readinessState.trim()
          : "unknown",
      healthState:
        typeof snapshot.healthState === "string" && snapshot.healthState.trim()
          ? snapshot.healthState.trim()
          : "unknown",
      persistedPhase:
        typeof snapshot.persistedPhase === "string" && snapshot.persistedPhase.trim()
          ? snapshot.persistedPhase.trim()
          : "unknown",
      handoffChannel:
        typeof snapshot.handoffChannel === "string" && WORKFLOW_HANDOFF_CHANNELS.has(snapshot.handoffChannel)
          ? snapshot.handoffChannel
          : "client",
      providerHandoffState:
        typeof snapshot.providerHandoffState === "string" && snapshot.providerHandoffState.trim()
          ? snapshot.providerHandoffState.trim()
          : "not-required",
      acceptanceDecision:
        typeof snapshot.acceptanceDecision === "string" && ACCEPTANCE_DECISIONS.has(snapshot.acceptanceDecision)
          ? snapshot.acceptanceDecision
          : "pending",
      byteLength:
        Number.isInteger(snapshot.byteLength) && snapshot.byteLength >= 0
          ? snapshot.byteLength
          : 0,
      blockingCount:
        Number.isInteger(snapshot.blockingCount) && snapshot.blockingCount >= 0
          ? snapshot.blockingCount
          : 0,
      warningCount:
        Number.isInteger(snapshot.warningCount) && snapshot.warningCount >= 0
          ? snapshot.warningCount
          : 0,
      retryable: snapshot.retryable === true,
      commitAllowed: snapshot.commitAllowed === true
    }));
}

function incrementCounter(counters, bucket, key, amount = 1) {
  counters[bucket][key] = (counters[bucket][key] || 0) + amount;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function buildAnalyticsExportState({
  input,
  request,
  provider,
  providerServiceContract,
  workspaceScope,
  validationSummary,
  readiness,
  operationalHealth,
  writeIntent,
  workflowHandoff,
  persistedState,
  persistedStateTruth,
  acceptance,
  providerHandoffContract,
  contentIntegrity,
  targetClassification,
  targetPolicy,
  nextSteps,
  generatedAt
}) {
  const previousHistory = normalizeAnalyticsHistory(input);
  const currentSnapshot = {
    version: "aios.fs-write.analytics-snapshot.v1",
    sequence: previousHistory.length + 1,
    capturedAt: generatedAt,
    correlationId: request.correlationId,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    tenantIsolationMode: workspaceScope.tenantBoundary.isolationMode,
    tenantBoundaryAccepted:
      workspaceScope.tenantBoundary.actorTenantMatches &&
      workspaceScope.tenantBoundary.tenantTrusted &&
      workspaceScope.tenantBoundary.workspaceAllowed &&
      workspaceScope.tenantBoundary.delegationAccepted,
    actorTenantId: workspaceScope.tenantBoundary.actorTenantId,
    providerId: provider.id,
    serviceLevel: providerServiceContract.serviceLevel,
    operation: request.operation,
    byteLength: request.byteLength,
    targetKind: targetClassification.kind,
    targetNamespace: targetClassification.namespace,
    targetPolicyAccepted: targetPolicy.accepted,
    targetCapabilityProofState: targetPolicy.capabilityProofState,
    targetPermissionProofState: targetPolicy.permissionProofState,
    targetMissingCapabilityCount: targetPolicy.missingCapabilities.length,
    targetMissingPermissionCount: targetPolicy.missingPermissions.length,
    contentIntegrityLevel: contentIntegrity.integrityLevel,
    contentDigestPresent: Boolean(contentIntegrity.digest),
    decision: writeIntent.decision,
    readinessState: readiness.state,
    healthState: operationalHealth.state,
    persistedPhase: persistedState.phase,
    restartStatus: persistedState.restartPlan.status,
    persistedTruthRoute: persistedStateTruth.route,
    persistedTruthCommitAllowed: persistedStateTruth.commitAllowed,
    restartSafe: persistedState.restartSafe,
    idempotentCommand: persistedState.commandLedger.idempotent,
    handoffChannel: workflowHandoff.channel,
    providerHandoffState: providerHandoffContract ? providerHandoffContract.state : "not-required",
    handoffAcknowledgementState: providerHandoffContract
      ? providerHandoffContract.acknowledgement.state
      : "not-required",
    acceptanceDecision: acceptance.decision,
    blockingCount: validationSummary.counts.blocking,
    warningCount: validationSummary.counts.warning,
    retryable: operationalHealth.retry.retryable,
    commitAllowed: operationalHealth.commitAllowed
  };
  const history = [...previousHistory, currentSnapshot].slice(-10);
  const counters = {
    totals: {
      snapshots: history.length,
      bytesRequested: 0,
      blockingIssues: 0,
      warnings: 0,
      blockedSnapshots: 0,
      warningSnapshots: 0,
      retryableSnapshots: 0,
      commitAllowedSnapshots: 0
    },
    byDecision: {},
    byReadiness: {},
    byHealth: {},
    byPersistedPhase: {},
    byTenantIsolation: {},
    byTargetKind: {},
    byIntegrityLevel: {},
    byHandoffChannel: {},
    byProviderHandoffState: {},
    byAcceptanceDecision: {}
  };

  for (const snapshot of history) {
    counters.totals.bytesRequested += snapshot.byteLength;
    counters.totals.blockingIssues += snapshot.blockingCount;
    counters.totals.warnings += snapshot.warningCount;
    if (snapshot.blockingCount > 0) counters.totals.blockedSnapshots += 1;
    if (snapshot.warningCount > 0) counters.totals.warningSnapshots += 1;
    if (snapshot.retryable) counters.totals.retryableSnapshots += 1;
    if (snapshot.commitAllowed) counters.totals.commitAllowedSnapshots += 1;
    incrementCounter(counters, "byDecision", snapshot.decision || "unknown");
    incrementCounter(counters, "byReadiness", snapshot.readinessState || "unknown");
    incrementCounter(counters, "byHealth", snapshot.healthState || "unknown");
    incrementCounter(counters, "byPersistedPhase", snapshot.persistedPhase || "unknown");
    incrementCounter(counters, "byTenantIsolation", snapshot.tenantIsolationMode || "unknown");
    incrementCounter(counters, "byTargetKind", snapshot.targetKind || "workspace");
    incrementCounter(counters, "byIntegrityLevel", snapshot.contentIntegrityLevel || "unknown");
    incrementCounter(counters, "byHandoffChannel", snapshot.handoffChannel || "unknown");
    incrementCounter(counters, "byProviderHandoffState", snapshot.providerHandoffState || "unknown");
    incrementCounter(counters, "byAcceptanceDecision", snapshot.acceptanceDecision || "unknown");
  }

  const previousSnapshot = history.length > 1 ? history[history.length - 2] : null;
  const derivedMetrics = {
    averageBytesPerSnapshot: history.length > 0 ? Math.round(counters.totals.bytesRequested / history.length) : 0,
    commitAllowedRate: ratio(counters.totals.commitAllowedSnapshots, history.length),
    retryableRate: ratio(counters.totals.retryableSnapshots, history.length),
    blockedRate: ratio(counters.totals.blockedSnapshots, history.length),
    warningRate: ratio(counters.totals.warningSnapshots, history.length)
  };
  const trend = {
    basis: previousSnapshot ? "previous-snapshot" : "current-only",
    previousCorrelationId: previousSnapshot ? previousSnapshot.correlationId : null,
    decisionChanged: previousSnapshot ? previousSnapshot.decision !== currentSnapshot.decision : false,
    readinessChanged: previousSnapshot ? previousSnapshot.readinessState !== currentSnapshot.readinessState : false,
    healthChanged: previousSnapshot ? previousSnapshot.healthState !== currentSnapshot.healthState : false,
    persistedPhaseChanged: previousSnapshot ? previousSnapshot.persistedPhase !== currentSnapshot.persistedPhase : false,
    byteDelta: previousSnapshot ? currentSnapshot.byteLength - previousSnapshot.byteLength : 0,
    blockingDelta: previousSnapshot ? currentSnapshot.blockingCount - previousSnapshot.blockingCount : currentSnapshot.blockingCount,
    warningDelta: previousSnapshot ? currentSnapshot.warningCount - previousSnapshot.warningCount : currentSnapshot.warningCount
  };
  const timeline = [
    ...history.slice(0, -1).map((snapshot) => ({
      at: snapshot.capturedAt || generatedAt,
      type: "analytics.snapshot",
      label: snapshot.decision,
      state: snapshot.readinessState,
      correlationId: snapshot.correlationId,
      healthState: snapshot.healthState,
      persistedPhase: snapshot.persistedPhase,
      byteLength: snapshot.byteLength
    })),
    {
      at: generatedAt,
      type: "request.normalized",
      label: "Write request normalized",
      state: request.operation,
      subject: workspaceScope.path.scoped
    },
    {
      at: generatedAt,
      type: "validation.summarized",
      label: validationSummary.status,
      state: validationSummary.status,
      blockingCount: validationSummary.counts.blocking,
      warningCount: validationSummary.counts.warning
    },
    {
      at: generatedAt,
      type: "readiness.evaluated",
      label: readiness.state,
      state: readiness.state,
      readyToCommit: readiness.readyToCommit
    },
    {
      at: generatedAt,
      type: "intent.routed",
      label: writeIntent.decision,
      state: writeIntent.decision,
      queue: writeIntent.route.queue
    },
    {
      at: generatedAt,
      type: "workflow.handoff",
      label: workflowHandoff.channel,
      state: workflowHandoff.state,
      owner: workflowHandoff.owner
    }
  ];
  const exportRow = {
    surfaceId,
    generatedAt,
    correlationId: request.correlationId,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    tenantIsolationMode: workspaceScope.tenantBoundary.isolationMode,
    tenantBoundarySubject: workspaceScope.tenantBoundary.auditSubject,
    actorTenantId: workspaceScope.tenantBoundary.actorTenantId,
    trustedTenantCount: workspaceScope.tenantBoundary.trustedTenantIds.length,
    allowedWorkspaceCount: workspaceScope.tenantBoundary.allowedWorkspaceIds.length,
    scopedPath: workspaceScope.path.scoped,
    targetKind: targetClassification.kind,
    targetNamespace: targetClassification.namespace,
    targetAuditSubject: targetClassification.auditSubject,
    targetPolicyAccepted: targetPolicy.accepted,
    targetCapabilityProofState: targetPolicy.capabilityProofState,
    targetPermissionProofState: targetPolicy.permissionProofState,
    targetMissingCapabilities: targetPolicy.missingCapabilities,
    targetMissingPermissions: targetPolicy.missingPermissions,
    operation: request.operation,
    byteLength: request.byteLength,
    contentIntegrityLevel: contentIntegrity.integrityLevel,
    contentDigestPresent: Boolean(contentIntegrity.digest),
    providerId: provider.id,
    providerServiceLevel: providerServiceContract.serviceLevel,
    readinessState: readiness.state,
    healthState: operationalHealth.state,
    decision: writeIntent.decision,
    persistedPhase: persistedState.phase,
    restartStatus: persistedState.restartPlan.status,
    persistedTruthRoute: persistedStateTruth.route,
    persistedTruthCommitAllowed: persistedStateTruth.commitAllowed,
    restartSafe: persistedState.restartSafe,
    idempotentCommand: persistedState.commandLedger.idempotent,
    acceptanceDecision: acceptance.decision,
    handoffChannel: workflowHandoff.channel,
    providerHandoffState: providerHandoffContract ? providerHandoffContract.state : "not-required",
    handoffAcknowledgementState: providerHandoffContract
      ? providerHandoffContract.acknowledgement.state
      : "not-required",
    blockingCount: validationSummary.counts.blocking,
    warningCount: validationSummary.counts.warning,
    retryable: operationalHealth.retry.retryable,
    commitAllowed: operationalHealth.commitAllowed,
    nextAction: nextSteps[0] ? nextSteps[0].action : null
  };
  const historyRows = history.map((snapshot) => ({
    surfaceId,
    generatedAt: snapshot.capturedAt || generatedAt,
    correlationId: snapshot.correlationId,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId,
    providerId: snapshot.providerId,
    operation: snapshot.operation,
    byteLength: snapshot.byteLength,
    readinessState: snapshot.readinessState,
    healthState: snapshot.healthState,
    decision: snapshot.decision,
    persistedPhase: snapshot.persistedPhase,
    tenantIsolationMode: snapshot.tenantIsolationMode,
    contentIntegrityLevel: snapshot.contentIntegrityLevel,
    targetKind: snapshot.targetKind,
    handoffChannel: snapshot.handoffChannel,
    providerHandoffState: snapshot.providerHandoffState,
    acceptanceDecision: snapshot.acceptanceDecision,
    blockingCount: snapshot.blockingCount,
    warningCount: snapshot.warningCount,
    retryable: snapshot.retryable,
    commitAllowed: snapshot.commitAllowed
  }));

  return {
    version: "aios.fs-write.analytics-export.v1",
    generatedAt,
    currentSnapshot,
    history,
    counters,
    metrics: derivedMetrics,
    trend,
    timeline,
    reporting: {
      state:
        operationalHealth.state === "failed"
          ? "action-required"
          : validationSummary.status === "blocked"
            ? "blocked"
            : writeIntent.decision === "commit" || writeIntent.decision === "noop-committed"
              ? "commit-track"
              : "watch",
      rollupKey: [
        workspaceScope.tenantId || "tenant:unselected",
        workspaceScope.workspaceId || "workspace:unselected",
        targetClassification.kind,
        provider.id,
        request.operation
      ].join("|"),
      freshness: {
        latestSnapshotAt: generatedAt,
        snapshotCount: history.length,
        complete: Boolean(workspaceScope.tenantId && workspaceScope.workspaceId && request.path)
      },
      cards: [
        {
          id: "commit-readiness",
          label: "Commit readiness",
          value: readiness.state,
          metric: derivedMetrics.commitAllowedRate,
          delta: trend.readinessChanged ? "changed" : "stable"
        },
        {
          id: "runtime-health",
          label: "Runtime health",
          value: operationalHealth.state,
          metric: derivedMetrics.retryableRate,
          delta: trend.healthChanged ? "changed" : "stable"
        },
        {
          id: "restart-state",
          label: "Restart state",
          value: persistedState.restartPlan.status,
          metric: persistedState.restartSafe ? 1 : 0,
          delta: trend.persistedPhaseChanged ? "phase-changed" : "phase-stable"
        }
      ]
    },
    export: {
      format: "jsonl-ready",
      schema: Object.keys(exportRow),
      rows: [exportRow],
      historySchema: Object.keys(historyRows[0] || exportRow),
      historyRows,
      proofSubjects: writeIntent.auditBinding.proofSubjects,
      datasetId: `${surfaceId}:${workspaceScope.workspaceId || "workspace"}:${request.correlationId}`
    }
  };
}

function buildClientWriteContract({
  preview,
  acceptance,
  readiness,
  validationSummary,
  nextSteps,
  operationalHealth,
  lifecycle,
  writeIntent,
  clientRuntime,
  clientDraft,
  workflowHandoff,
  persistedState,
  persistedStateTruth,
  restartPersistence,
  audit,
  request,
  providerServiceContract,
  providerHandoffContract,
  productWorkflowHandoff,
  productSyncContract,
  analyticsExport,
  contentIntegrity,
  targetClassification,
  targetPolicy,
  generatedAt
}) {
  const blockingFields = new Set(validationSummary.blocking.map((issue) => issue.split(".")[0]));
  const primaryStep = nextSteps.find((step) => step.enabled) || nextSteps[0] || null;
  const submitDisabledReason =
    readiness.readyToCommit &&
    operationalHealth.commitAllowed &&
    persistedStateTruth.commitAllowed &&
    clientDraft.adoptionState !== "needs-client-sync" &&
    (!productWorkflowHandoff || productWorkflowHandoff.state === "not-required" || productWorkflowHandoff.state === "ready") &&
    (!productSyncContract || productSyncContract.state === "not-required" || productSyncContract.state === "optional" || productSyncContract.state === "ready")
      ? null
      : clientDraft.adoptionState === "needs-client-sync"
        ? "clientDraft.needs_sync"
        : productSyncContract && productSyncContract.state === "blocked"
          ? productSyncContract.requiredBeforeCommit[0] || "productSync.blocked"
        : productWorkflowHandoff && productWorkflowHandoff.state !== "not-required" && productWorkflowHandoff.state !== "ready"
          ? productWorkflowHandoff.requiredBeforeCommit[0] || "productWorkflow.ack_required"
          : validationSummary.blocking[0] ||
            operationalHealth.blockedReasons[0] ||
            operationalHealth.retry.retryableFailures[0] ||
            readiness.state;

  return {
    version: "aios.fs-write.client-contract.v1",
    generatedAt,
    correlationId: request.correlationId,
    runtime: {
      version: clientRuntime.version,
      runtimeId: clientRuntime.runtimeId,
      sessionId: clientRuntime.sessionId,
      surface: clientRuntime.surface,
      view: clientRuntime.view,
      route: clientRuntime.route,
      capabilities: clientRuntime.capabilities,
      preferences: clientRuntime.preferences
    },
    clientDraft: {
      version: clientDraft.version,
      present: clientDraft.present,
      draftId: clientDraft.draftId,
      source: clientDraft.source,
      dirty: clientDraft.dirty,
      adoptionState: clientDraft.adoptionState,
      path: clientDraft.path,
      scopedPath: clientDraft.scopedPath,
      pendingBytes: clientDraft.pendingBytes,
      digestPresent: Boolean(clientDraft.digest),
      lastEditedAt: clientDraft.lastEditedAt,
      matchesRequest: clientDraft.matchesRequest,
      warnings: clientDraft.warnings,
      syncAction:
        clientDraft.adoptionState === "needs-client-sync"
          ? "fs.write.client-draft.sync"
          : clientDraft.adoptionState === "adopted"
            ? "fs.write.client-draft.adopted"
            : "fs.write.client-draft.none"
    },
    previewCard: {
      heading: preview.title,
      impact: preview.impact,
      targetPath: preview.target.path,
      scopedPath: preview.target.scopedPath,
      targetKind: preview.target.classification.kind,
      targetNamespace: preview.target.classification.namespace,
      byteLength: preview.byteLength,
      durability: preview.durability,
      destructive: preview.disclosure.destructive,
      integrityLevel: preview.integrity.level,
      digestPresent: preview.integrity.digestPresent,
      status:
        readiness.state === "commit-ready"
          ? "Ready to commit"
          : readiness.state === "review-ready"
            ? "Needs review"
            : readiness.state === "scheduled"
              ? "Scheduled"
              : "Blocked"
    },
    validationPanel: {
      status: validationSummary.status,
      blockingCount: validationSummary.counts.blocking,
      warningCount: validationSummary.counts.warning,
      userFixableCount: validationSummary.counts.userFixable,
      systemFixableCount: validationSummary.counts.systemFixable,
      highlightedFields: [...blockingFields],
      messages: [...validationSummary.blocking, ...validationSummary.warning].map((issue) =>
        describeActionableError(
          issue,
          validationSummary.blocking.includes(issue) ? "blocking" : "warning"
        )
      )
    },
    tenantBoundaryPanel: {
      version: "aios.fs-write.client-tenant-boundary.v1",
      tenantId: preview.tenant.id,
      workspaceId: preview.tenant.workspaceId,
      actorTenantId: preview.tenant.actorTenantId,
      isolationMode: preview.tenant.isolationMode,
      permission: preview.tenant.permission,
      roles: preview.tenant.roles,
      accepted:
        preview.tenant.actorTenantMatches &&
        preview.tenant.workspaceAllowed &&
        audit.proof.tenantPermissionBoundary.tenantTrusted &&
        audit.proof.tenantPermissionBoundary.delegationAccepted,
      checks: {
        actorTenantMatches: preview.tenant.actorTenantMatches,
        tenantTrusted: audit.proof.tenantPermissionBoundary.tenantTrusted,
        workspaceAllowed: preview.tenant.workspaceAllowed,
        delegationAccepted: audit.proof.tenantPermissionBoundary.delegationAccepted
      },
      issues: validationSummary.blocking.filter(
        (issue) => issue.startsWith("tenant.") || issue.startsWith("workspace.")
      ),
      auditSubject: audit.proof.tenantPermissionBoundary.auditSubject
    },
    acceptanceForm: {
      mode: acceptance.mode,
      decision: acceptance.decision,
      token: acceptance.acceptanceToken,
      submitAction:
        readiness.readyToCommit
          ? "fs.write.commit"
          : readiness.state === "acceptance-required"
            ? "fs.write.acceptance.accept"
            : "fs.write.review",
      submitEnabled:
        readiness.readyToCommit &&
        operationalHealth.commitAllowed &&
        persistedStateTruth.commitAllowed &&
        clientDraft.adoptionState !== "needs-client-sync" &&
        (!productWorkflowHandoff || productWorkflowHandoff.state === "not-required" || productWorkflowHandoff.state === "ready") &&
        (!productSyncContract || productSyncContract.state === "not-required" || productSyncContract.state === "optional" || productSyncContract.state === "ready"),
      submitDisabledReason,
      requiredAcknowledgements: acceptance.requiredAcknowledgements.map((acknowledgement) => ({
        id: acknowledgement,
        required: true,
        checkedByDefault: false,
        satisfied: !acceptance.missingAcknowledgements.includes(acknowledgement)
      })),
      submission: {
        decision: acceptance.submission.decision,
        tokenPresent: acceptance.submission.tokenPresent,
        tokenValid: acceptance.submission.tokenValid,
        canResubmit: acceptance.submission.canResubmit,
        missingAcknowledgements: acceptance.submission.missingAcknowledgements,
        routeCommand: acceptance.routeCommand,
        rejectedReason: acceptance.rejectedReason
      }
    },
    readinessBanner: {
      state: readiness.state,
      readyToCommit: readiness.readyToCommit,
      commitAllowed: operationalHealth.commitAllowed,
      persistedCommitAllowed: persistedStateTruth.commitAllowed,
      requiredBeforeCommit: readiness.requiredBeforeCommit,
      commitGateAudit: readiness.commitGateAudit,
      lifecycleNextAction: lifecycle.nextAction,
      lifecycleNextActionState: lifecycle.nextActionState,
      gates: readiness.gates
    },
    lifecycleControls: {
      version: lifecycle.version,
      command: lifecycle.command,
      mode: lifecycle.mode,
      sourceMode: lifecycle.sourceMode,
      enabled: lifecycle.enabled,
      maxByteLength: lifecycle.maxByteLength,
      allowAppend: lifecycle.allowAppend,
      controls: lifecycle.controls,
      nextAction: lifecycle.nextAction,
      nextActionState: lifecycle.nextActionState,
      actionable: lifecycle.actionable,
      commandPlan: lifecycle.commandPlan,
      commandControls: lifecycle.nextActionState.commandControls,
      schedule: {
        policy: lifecycle.schedule.policy,
        scheduledAt: lifecycle.schedule.scheduledAt,
        due: lifecycle.schedule.due,
        queue: lifecycle.schedule.queue,
        maintenanceWindow: lifecycle.schedule.maintenanceWindow,
        control: lifecycle.nextActionState.scheduleControl
      },
      issues: [...lifecycle.violations, ...lifecycle.warnings]
    },
    healthPanel: {
      state: operationalHealth.state,
      mode: operationalHealth.mode,
      providerState: operationalHealth.providerState,
      journalState: operationalHealth.journalState,
      commitAllowed: operationalHealth.commitAllowed,
      directCommitBlocked: operationalHealth.directCommitBlocked,
      queueAllowed: operationalHealth.queueAllowed,
      circuitBreaker: {
        state: operationalHealth.healthPolicy.circuitBreaker.state,
        failureCount: operationalHealth.healthPolicy.circuitBreaker.failureCount,
        threshold: operationalHealth.healthPolicy.circuitBreaker.threshold,
        nextProbeAt: operationalHealth.healthPolicy.circuitBreaker.nextProbeAt,
        blocksCommit: operationalHealth.healthPolicy.circuitBreaker.blocksCommit
      },
      degradedMode: {
        enabled: operationalHealth.healthPolicy.degradedMode.enabled,
        commitMode: operationalHealth.healthPolicy.degradedMode.commitMode,
        allowedActions: operationalHealth.healthPolicy.degradedMode.allowedActions
      },
      retry: {
        retryable: operationalHealth.retry.retryable,
        attempt: operationalHealth.retry.attempt,
        maxAttempts: operationalHealth.retry.maxAttempts,
        budgetRemaining: operationalHealth.retry.budgetRemaining,
        budgetExhausted: operationalHealth.retry.budgetExhausted,
        retryAt: operationalHealth.retry.retryable ? operationalHealth.retry.backoff.retryAt : null
      },
      recovery: {
        version: operationalHealth.recovery.version,
        failureClass: operationalHealth.recovery.failureClass,
        commitSafety: operationalHealth.recovery.commitSafety,
        route: operationalHealth.recovery.route,
        primaryFailure: operationalHealth.recovery.primaryFailure,
        retryAfter: operationalHealth.recovery.retryAfter,
        nextProbeAt: operationalHealth.recovery.nextProbeAt,
        queuePolicy: operationalHealth.recovery.queuePolicy,
        operatorActions: operationalHealth.recovery.operatorActions,
        clientMessageKey: operationalHealth.recovery.clientMessageKey
      },
      issues: operationalHealth.actionableErrors
    },
    providerContractPanel: providerServiceContract
      ? {
          serviceId: providerServiceContract.serviceId,
          serviceLevel: providerServiceContract.serviceLevel,
          writeMode: providerServiceContract.writeMode,
          active: providerServiceContract.active,
          expiresAt: providerServiceContract.expiresAt,
          maxWriteBytes: providerServiceContract.quota.maxWriteBytes,
          remainingBytes: providerServiceContract.quota.remainingBytes,
          leaseRequired: providerServiceContract.lease.required,
          leaseTokenPresent: providerServiceContract.lease.tokenPresent,
          handoffRequired: providerServiceContract.handoffRequired,
          issues: [...providerServiceContract.violations, ...providerServiceContract.warnings]
        }
      : null,
    contentIntegrityPanel: {
      version: contentIntegrity.version,
      level: contentIntegrity.integrityLevel,
      algorithm: contentIntegrity.algorithm,
      digestPresent: Boolean(contentIntegrity.digest),
      digestMatchesRequest: contentIntegrity.digestMatchesRequest,
      byteLengthMatchesRequest: contentIntegrity.byteLengthMatchesRequest,
      chunkCount: contentIntegrity.chunks.count,
      issues: [...contentIntegrity.violations, ...contentIntegrity.warnings]
    },
    targetPolicyPanel: {
      version: targetPolicy.version,
      kind: targetClassification.kind,
      namespace: targetClassification.namespace,
      productId: targetClassification.productId,
      artifactId: targetClassification.artifactId,
      immutable: targetClassification.immutable,
      requiresDigest: targetClassification.requiresDigest,
      requiresRevision: targetClassification.requiresRevision,
      requiredCapabilities: targetPolicy.requiredCapabilities,
      missingCapabilities: targetPolicy.missingCapabilities,
      requiredPermissions: targetPolicy.requiredPermissions,
      missingPermissions: targetPolicy.missingPermissions,
      capabilityProofState: targetPolicy.capabilityProofState,
      permissionProofState: targetPolicy.permissionProofState,
      effectivePermissionGrants: targetPolicy.effectivePermissionGrants,
      accepted: targetPolicy.accepted,
      route: targetPolicy.route,
      auditSubject: targetClassification.auditSubject,
      auditHandoff: targetPolicy.auditHandoff,
      issues: [...targetPolicy.violations, ...targetPolicy.warnings]
    },
    productWorkflowPanel: productWorkflowHandoff
      ? {
          version: productWorkflowHandoff.version,
          required: productWorkflowHandoff.required,
          state: productWorkflowHandoff.state,
          targetProductId: productWorkflowHandoff.targetProductId,
          activeProductId: productWorkflowHandoff.activeProductId,
          productMatches: productWorkflowHandoff.productMatches,
          revision: productWorkflowHandoff.revision,
          previousRevision: productWorkflowHandoff.previousRevision,
          acknowledgementRequired: productWorkflowHandoff.acknowledgement.required,
          acknowledgementState: productWorkflowHandoff.acknowledgement.state,
          acknowledgementToken: productWorkflowHandoff.acknowledgement.token,
          tokenPresent: productWorkflowHandoff.acknowledgement.tokenPresent,
          tokenValid: productWorkflowHandoff.acknowledgement.tokenValid,
          destination: productWorkflowHandoff.destination,
          requiredBeforeCommit: productWorkflowHandoff.requiredBeforeCommit,
          statePatch: productWorkflowHandoff.statePatch
        }
      : null,
    productSyncPanel: productSyncContract
      ? {
          version: productSyncContract.version,
          required: productSyncContract.required,
          state: productSyncContract.state,
          authority: productSyncContract.authority,
          conflictStrategy: productSyncContract.conflictStrategy,
          targetProductId: productSyncContract.targetProductId,
          requestedProductId: productSyncContract.requestedProductId,
          serviceProductId: productSyncContract.serviceProductId,
          productMatches: productSyncContract.productMatches,
          schemaVersion: productSyncContract.schemaVersion,
          revision: productSyncContract.revision,
          previousRevision: productSyncContract.previousRevision,
          lock: productSyncContract.lock,
          requiredCapabilities: productSyncContract.requiredCapabilities,
          requiredBeforeCommit: productSyncContract.requiredBeforeCommit,
          auditSubject: productSyncContract.auditSubject,
          statePatch: productSyncContract.statePatch
        }
      : null,
    executionIntent: {
      decision: writeIntent.decision,
      commitEligible: writeIntent.commitEligible,
      idempotentReplay: writeIntent.idempotentReplay,
      recoveryRequired: writeIntent.recoveryRequired,
      idempotentCommand: writeIntent.idempotentCommand,
      restartStatus: writeIntent.restartStatus,
      restartRoute: writeIntent.restartRoute,
      restartAutoResume: writeIntent.restartAutoResume,
      checkpointRequired: writeIntent.checkpointRequired,
      queue: writeIntent.route.queue,
      transferId: writeIntent.route.transferId,
      providerHandoffState: writeIntent.route.handoffState,
      acknowledgementState: writeIntent.route.acknowledgementState,
      retryAt: writeIntent.schedule.retryAt,
      denialReasons: writeIntent.failurePolicy.denialReasons,
      holdReasons: writeIntent.failurePolicy.holdReasons,
      proofSubjects: writeIntent.auditBinding.proofSubjects
    },
    providerHandoffPanel: providerHandoffContract
      ? {
          version: providerHandoffContract.version,
          state: providerHandoffContract.state,
          transferId: providerHandoffContract.transferId,
          target: providerHandoffContract.target,
          deliveryGuarantee: providerHandoffContract.delivery.guarantee,
          queue: providerHandoffContract.delivery.queue,
          deadlineAt: providerHandoffContract.delivery.deadlineAt,
          acknowledgementRequired: providerHandoffContract.acknowledgement.required,
          acknowledgementState: providerHandoffContract.acknowledgement.state,
          acknowledgementToken: providerHandoffContract.acknowledgement.expectedToken,
          commitBarrier: providerHandoffContract.commitBarrier,
          issues: providerHandoffContract.requiredBeforeCommit
        }
      : null,
    restartStatus: {
      phase: persistedState.phase,
      stablePhase: persistedState.stablePhase,
      restartSafe: persistedState.restartSafe,
      fingerprintMatches: persistedState.fingerprintMatches,
      restoredFromJournal: persistedState.restoredFromJournal,
      idempotencyKey: persistedState.idempotencyKey,
      replayCount: persistedState.replayCount,
      recoveryCount: persistedState.recoveryCount,
      command: persistedState.command,
      commandLedger: persistedState.commandLedger,
      recovery: persistedState.recovery,
      restartPlan: persistedState.restartPlan,
      statePatch: persistedState.statePatch,
      truth: persistedStateTruth
    },
    restartPersistencePanel: {
      version: restartPersistence.version,
      status: restartPersistence.status,
      restoreMode: restartPersistence.restoreMode,
      restartSafe: restartPersistence.restartSafe,
      commitAllowedAfterRestore: restartPersistence.commitAllowedAfterRestore,
      checkpointState: restartPersistence.snapshot.checkpointState,
      checkpointPhase: restartPersistence.snapshot.phase,
      route: restartPersistence.snapshot.route,
      requiredBeforeRestartSafe: restartPersistence.statusSemantics.requiredBeforeRestartSafe,
      commands: restartPersistence.commands.map((command) => ({
        id: command.id,
        action: command.action,
        enabled: command.enabled,
        idempotent: command.idempotent,
        replayPolicy: command.replayPolicy,
        idempotencyKey: command.payload.idempotencyKey,
        commandToken: command.payload.commandToken,
        expectedPhase: command.payload.expectedPhase
      })),
      snapshot: restartPersistence.snapshot
    },
    workflowHandoff: {
      state: workflowHandoff.state,
      channel: workflowHandoff.channel,
      owner: workflowHandoff.owner,
      resumable: workflowHandoff.resumable,
      token: workflowHandoff.token,
      destination: workflowHandoff.destination,
      statePatch: workflowHandoff.statePatch,
      userVisible: workflowHandoff.userVisible,
      telemetry: workflowHandoff.telemetry
    },
    analyticsSummary: {
      version: analyticsExport.version,
      reportingState: analyticsExport.reporting.state,
      latestSnapshot: analyticsExport.currentSnapshot,
      counters: analyticsExport.counters,
      timeline: analyticsExport.timeline,
      exportDatasetId: analyticsExport.export.datasetId
    },
    nextStepGroups: groupNextStepsForClient(nextSteps),
    proofRefs: {
      auditEventType: audit.auditEvent.type,
      proofVersion: audit.proof.contractVersion,
      syncRevision: audit.proof.syncRevision,
      evidenceCount: audit.proof.evidenceCount
    }
  };
}

export function describeFsWriteSurface(input = {}) {
  const generatedAt = asIsoString(input.now);
  const provider = normalizeProvider(input.provider);
  const request = normalizeWriteRequest(input);
  const providerServiceContract = normalizeProviderServiceContract(input, provider, request, generatedAt);
  const workspaceScope = normalizeWorkspaceScope(input, request);
  const boundaryEvaluation = evaluateWorkspaceBoundary(request, workspaceScope);
  const syncMetadata = buildSyncMetadata(input, request, provider, generatedAt);
  const contentIntegrity = normalizeContentIntegrity(input, request, generatedAt);
  const targetClassification = inferWriteTargetKind(input, request, workspaceScope);
  const productSyncContract = buildProductSyncContract(
    input,
    targetClassification,
    syncMetadata,
    providerServiceContract,
    generatedAt
  );
  const negotiation = negotiateCapabilities(
    provider,
    input.requestedCapabilities,
    providerServiceContract,
    targetClassification,
    productSyncContract
  );
  const targetPolicy = evaluateTargetPolicy(
    request,
    syncMetadata,
    contentIntegrity,
    targetClassification,
    workspaceScope,
    negotiation
  );
  const clientRuntime = normalizeClientRuntimeState(input, request, workspaceScope, generatedAt);
  const productWorkflowHandoff = buildProductWorkflowHandoff(
    input,
    request,
    clientRuntime,
    targetClassification,
    syncMetadata,
    generatedAt
  );
  const clientDraft = normalizeClientDraftState(input, request, workspaceScope, contentIntegrity, generatedAt);
  const lifecycleSettings = normalizeLifecycleSettings(input, request, generatedAt);
  const persistedState = normalizePersistedWriteState(
    input,
    request,
    workspaceScope,
    syncMetadata,
    contentIntegrity,
    lifecycleSettings,
    generatedAt
  );
  const persistedStateTruth = evaluatePersistedStateTruth(persistedState);
  const externalHandoff = buildExternalHandoff(input, request, negotiation, providerServiceContract);
  const providerHandoffContract = buildProviderHandoffContract({
    input,
    request,
    provider,
    workspaceScope,
    syncMetadata,
    contentIntegrity,
    externalHandoff,
    providerServiceContract,
    generatedAt
  });
  const violations = [
    ...validateWriteRequest(request),
    ...contentIntegrity.violations,
    ...boundaryEvaluation.violations,
    ...targetPolicy.violations,
    ...lifecycleSettings.violations,
    ...providerServiceContract.violations,
    ...providerHandoffContract.requiredBeforeCommit,
    ...productWorkflowHandoff.requiredBeforeCommit,
    ...productSyncContract.requiredBeforeCommit,
    ...persistedStateTruth.violations
  ];
  const validationSummary = summarizeValidation(
    violations,
    negotiation,
    externalHandoff,
    lifecycleSettings,
    providerServiceContract,
    contentIntegrity,
    providerHandoffContract,
    targetPolicy,
    persistedStateTruth
  );
  const preview = buildWritePreview(
    request,
    provider,
    syncMetadata,
    contentIntegrity,
    externalHandoff,
    validationSummary,
    workspaceScope,
    targetClassification,
    targetPolicy,
    productSyncContract
  );
  const acceptance = buildAcceptanceContract(input, request, validationSummary, negotiation, generatedAt);
  const readiness = buildReadinessContract(
    validationSummary,
    negotiation,
    externalHandoff,
    boundaryEvaluation,
    lifecycleSettings,
    providerServiceContract,
    acceptance,
    providerHandoffContract,
    persistedStateTruth,
    targetPolicy,
    productWorkflowHandoff,
    productSyncContract
  );
  const audit = buildAuditProof(
    input,
    request,
    provider,
    negotiation,
    syncMetadata,
    contentIntegrity,
    generatedAt,
    violations,
    workspaceScope,
    boundaryEvaluation,
    lifecycleSettings,
    persistedState,
    providerServiceContract,
    clientDraft,
    providerHandoffContract,
    productWorkflowHandoff,
    productSyncContract,
    targetClassification,
    targetPolicy,
    readiness,
    persistedStateTruth
  );
  const operationalHealth = buildOperationalHealth(
    input,
    request,
    targetClassification,
    validationSummary,
    readiness,
    externalHandoff,
    generatedAt
  );
  const lifecycle = buildLifecycleState(lifecycleSettings, readiness, operationalHealth);
  const restartPersistence = buildRestartPersistenceEnvelope({
    request,
    workspaceScope,
    lifecycle,
    persistedState,
    persistedStateTruth,
    operationalHealth,
    providerHandoffContract,
    productWorkflowHandoff,
    generatedAt
  });
  const writeIntent = buildHostedKernelWriteIntent({
    request,
    provider,
    workspaceScope,
    syncMetadata,
    externalHandoff,
    readiness,
    operationalHealth,
    lifecycle,
    acceptance,
    clientRuntime,
    clientDraft,
    persistedState,
    persistedStateTruth,
    validationSummary,
    providerServiceContract,
    providerHandoffContract,
    productWorkflowHandoff,
    productSyncContract,
    contentIntegrity,
    targetClassification,
    targetPolicy,
    generatedAt
  });
  const nextSteps = buildNextSteps(
    request,
    validationSummary,
    readiness,
    externalHandoff,
    operationalHealth,
    lifecycleSettings,
    persistedState,
    clientDraft,
    providerHandoffContract,
    productWorkflowHandoff,
    productSyncContract
  );
  const workflowHandoff = buildWorkflowHandoff({
    clientRuntime,
    clientDraft,
    request,
    preview,
    acceptance,
    readiness,
    operationalHealth,
    lifecycle,
    writeIntent,
    persistedState,
    persistedStateTruth,
    productWorkflowHandoff,
    nextSteps,
    generatedAt
  });
  const analyticsExport = buildAnalyticsExportState({
    input,
    request,
    provider,
    providerServiceContract,
    workspaceScope,
    validationSummary,
    readiness,
    operationalHealth,
    writeIntent,
    workflowHandoff,
    persistedState,
    persistedStateTruth,
    acceptance,
    providerHandoffContract,
    contentIntegrity,
    targetClassification,
    targetPolicy,
    nextSteps,
    generatedAt
  });
  const clientContract = buildClientWriteContract({
    preview,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
    operationalHealth,
    lifecycle,
    writeIntent,
    clientRuntime,
    clientDraft,
    workflowHandoff,
    persistedState,
    persistedStateTruth,
    restartPersistence,
    audit,
    request,
    providerServiceContract,
    providerHandoffContract,
    productWorkflowHandoff,
    productSyncContract,
    analyticsExport,
    contentIntegrity,
    targetClassification,
    targetPolicy,
    generatedAt
  });
  const ok =
    violations.length === 0 &&
    negotiation.accepted &&
    boundaryEvaluation.accepted &&
    persistedState.fingerprintMatches &&
    clientDraft.adoptionState !== "needs-client-sync" &&
    externalHandoff.state !== "blocked" &&
    operationalHealth.commitAllowed;

  return {
    ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt,
    wave: "ai-os-wave1-hosted-kernel-boot-proof",
    contract: WRITE_CONTRACT_VERSION,
    provider,
    providerServiceContract,
    request,
    workspaceScope,
    boundaryEvaluation,
    capabilityNegotiation: negotiation,
    syncMetadata,
    contentIntegrity,
    targetClassification,
    targetPolicy,
    persistedState,
    persistedStateTruth,
    restartPersistence,
    externalHandoff,
    providerHandoffContract,
    productWorkflowHandoff,
    productSyncContract,
    lifecycle,
    preview,
    acceptance,
    readiness,
    operationalHealth,
    writeIntent,
    clientRuntime,
    clientDraft,
    workflowHandoff,
    analyticsExport,
    validationSummary,
    nextSteps,
    clientContract,
    audit: audit.auditEvent,
    proof: audit.proof,
    violations,
    evidence: audit.evidence
  };
}

export default describeFsWriteSurface;
