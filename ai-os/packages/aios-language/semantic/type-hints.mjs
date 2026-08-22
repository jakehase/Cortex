import { resolveAiosScopes } from "./scope-resolution.mjs";

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

function inferCapabilityType(capability = {}) {
  const boundary = compactString(capability.boundary || "internal");
  const name = compactString(capability.name || capability.scope || "capability");
  const provider = name.startsWith("campaign.") || name.startsWith("audience.") || name.startsWith("template.") || name.startsWith("report.")
    ? "mailchimp"
    : compactString(capability.provider || "local");

  return Object.freeze({
    kind: "capability",
    name,
    type: boundary === "external" || provider === "mailchimp" ? "ProviderCapability" : "LocalCapability",
    provider,
    boundary,
    runtimeShape: Object.freeze({
      scope: compactString(capability.scope || name),
      requiresLease: boundary === "external",
      requiresApproval: boundary === "external" && /create|update|schedule|delete|send/.test(name),
    }),
  });
}

function inferMemoryType(memory = {}) {
  const mode = compactString(memory.mode || "ephemeral");
  const name = compactString(memory.name || "memory");
  const durable = mode === "persistent" || mode === "durable";

  return Object.freeze({
    kind: "memory",
    name,
    type: durable ? "DurableMemoryMount" : "RuntimeMemoryMount",
    mode,
    runtimeShape: Object.freeze({
      retention: durable ? "explicit" : "runtime",
      readable: memory.readable !== false,
      writable: memory.writable !== false,
      providerSync: memory.providerSync === true || name === "campaignDraft" || name === "audienceSnapshot",
    }),
  });
}

function inferStepType(step = {}, runtimeScope = {}) {
  const name = compactString(step.name || step.id || "step");
  const adapter = compactString(step.adapter || "runtime");
  const reads = toArray(step.memoryReads || step.reads).map(compactString).filter(Boolean);
  const writes = toArray(step.memoryWrites || step.writes || step.output).map(compactString).filter(Boolean);
  const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString).filter(Boolean);
  const external = adapter.includes("mailchimp") || capabilityRefs.some((capability) => /create|update|schedule|send/.test(capability));
  const idempotencyKey = firstString(step.idempotencyKey, runtimeScope.idempotencyKey);

  return Object.freeze({
    kind: "step",
    name,
    type: external ? "AdapterEffectStep" : "PureRuntimeStep",
    adapter,
    runtimeShape: Object.freeze({
      reads: freezeArray(reads),
      writes: freezeArray(writes),
      capabilityRefs: freezeArray(capabilityRefs),
      returns: writes.length > 0 ? "MemoryPatch" : "RuntimeObservation",
      statusHandoff: external ? "requires-adapter-status" : "local-status",
      idempotencyKey,
      restartSafe: !external || Boolean(idempotencyKey),
    }),
  });
}

function inferVerifierType(verifier = {}) {
  const name = compactString(verifier.name || verifier.expression || "verifier");
  const expression = compactString(verifier.expression || verifier.claim || name);
  return Object.freeze({
    kind: "verifier",
    name,
    type: expression.includes("approval") || expression.includes("evidence") ? "EvidenceVerifier" : "ClaimVerifier",
    runtimeShape: Object.freeze({
      expression,
      blocking: verifier.blocking !== false,
      evidenceRequired: expression.includes("evidence") || expression.includes("approval"),
    }),
  });
}

function createTenantBoundaryShape(job = {}, scope = {}, hints = []) {
  const runtimeScope = scope?.runtimeScope || {};
  const persistedRuntime = scope?.persistedRuntime || {};
  const clientState = job.clientState || job.requestState || {};
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.provider === "mailchimp");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const roles = [
    ...toArray(job.roles),
    ...toArray(job.actor?.roles),
    ...toArray(clientState.roles),
  ].map(compactString).filter(Boolean).sort();
  const permissions = [
    ...toArray(job.permissions),
    ...toArray(job.actor?.permissions),
    ...toArray(clientState.permissions),
  ].map(compactString).filter(Boolean).sort();
  const tenantId = firstString(clientState.tenantId, job.tenantId, runtimeScope.tenantId);
  const workspaceId = firstString(clientState.workspaceId, job.workspaceId, runtimeScope.workspaceId);
  const tenantScoped = providerCapabilities.length === 0 || (Boolean(tenantId) && Boolean(workspaceId));
  const actorScoped = adapterSteps.length === 0 || Boolean(firstString(clientState.userId, clientState.actorId, job.actor?.id, job.userId));
  const permissionDeclared = providerCapabilities.length === 0
    || permissions.length > 0
    || roles.length > 0
    || providerCapabilities.every((hint) => hint.runtimeShape.requiresApproval === false);

  return Object.freeze({
    protocol: "aios.type-hints.tenant-boundary.v1",
    tenantId,
    workspaceId,
    actorId: firstString(clientState.userId, clientState.actorId, job.actor?.id, job.userId),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, runtimeScope.statusChannel),
    restartToken: firstString(runtimeScope.restartToken, persistedRuntime.restartToken),
    tenantScoped,
    actorScoped,
    permissionDeclared,
    roles: freezeArray([...new Set(roles)]),
    permissions: freezeArray([...new Set(permissions)]),
    requiredAuditEvents: freezeArray([
      providerCapabilities.length > 0 && "mailchimp.type.boundary",
      adapterSteps.length > 0 && "aios.type.adapter_status",
      persistedRuntime.commands?.length > 0 && "aios.type.restart_commands",
    ].filter(Boolean)),
    violations: freezeArray([
      !tenantScoped && "tenant-workspace-required-for-mailchimp",
      !actorScoped && "actor-required-for-adapter-step",
      !permissionDeclared && "permission-or-role-required-for-provider-capability",
    ].filter(Boolean)),
  });
}

function createBoundaryHealthContract(scope = {}, tenantBoundary = {}) {
  const permissionBoundary = scope?.permissionBoundary || {};
  const permissionPosture = scope?.permissionPosture || {};
  const heldCapabilities = toArray(permissionBoundary.heldCapabilities);
  const postureRows = toArray(permissionPosture.rows);
  const postureBlocked = toArray(permissionPosture.blockedRows);
  const matrix = toArray(permissionBoundary.capabilities);
  const missingPermissionHolds = heldCapabilities.filter((capability) => {
    return toArray(capability.reasons).some((reason) => compactString(reason).startsWith("missing-permission:"));
  });
  const missingIdentityHolds = heldCapabilities.filter((capability) => {
    const reasons = toArray(capability.reasons).map(compactString);
    return reasons.includes("missing-tenant") || reasons.includes("missing-workspace") || reasons.includes("missing-actor");
  });
  const missingRuntimeHolds = heldCapabilities.filter((capability) => {
    const reasons = toArray(capability.reasons).map(compactString);
    return reasons.includes("missing-idempotency-key") || reasons.includes("missing-status-channel");
  });
  const leaseHolds = heldCapabilities.filter((capability) => {
    return toArray(capability.reasons).some((reason) => compactString(reason).includes("permission-lease"));
  });
  const postureGrantBlocked = postureBlocked.filter((row) => row.state === "grant-blocked");
  const postureLeaseBlocked = postureBlocked.filter((row) => row.state === "lease-blocked");
  const postureIdentityBlocked = postureBlocked.filter((row) => row.state === "identity-blocked");
  const postureHandoffBlocked = postureBlocked.filter((row) => row.state === "handoff-blocked");
  const degraded = tenantBoundary.violations?.length > 0 || heldCapabilities.length > 0 || postureBlocked.length > 0;

  return Object.freeze({
    protocol: "aios.type-hints.boundary-health.v1",
    state: heldCapabilities.length > 0
      ? "blocked"
      : degraded
        ? "degraded"
        : matrix.length > 0
          ? "healthy"
          : "not-applicable",
    permissionMatrixStatus: compactString(permissionBoundary.status || "not-applicable"),
    acceptedForAdapter: permissionBoundary.auditHandoff?.acceptedForAdapter !== false
      && permissionPosture.acceptedForAdapter !== false
      && heldCapabilities.length === 0
      && postureBlocked.length === 0,
    tenantScoped: tenantBoundary.tenantScoped === true,
    actorScoped: tenantBoundary.actorScoped === true,
    permissionDeclared: tenantBoundary.permissionDeclared === true,
    counters: Object.freeze({
      mailchimpCapabilities: matrix.length,
      heldCapabilities: heldCapabilities.length,
      missingPermissionHolds: missingPermissionHolds.length,
      missingIdentityHolds: missingIdentityHolds.length,
      missingRuntimeHolds: missingRuntimeHolds.length,
      permissionLeaseHolds: leaseHolds.length,
      tenantViolations: tenantBoundary.violations?.length ?? 0,
      permissionPostureRows: postureRows.length,
      permissionPostureBlocked: postureBlocked.length,
      permissionPostureCovered: permissionPosture.counters?.covered ?? 0,
      permissionPostureGrantBlocked: postureGrantBlocked.length,
      permissionPostureLeaseBlocked: postureLeaseBlocked.length,
      permissionPostureIdentityBlocked: postureIdentityBlocked.length,
      permissionPostureHandoffBlocked: postureHandoffBlocked.length,
    }),
    nextActions: freezeArray([
      postureIdentityBlocked.length > 0 && Object.freeze({
        command: "attach_client_runtime_request",
        reason: "Mailchimp tenant permission posture has identity or workspace mismatches.",
        actions: freezeArray(postureIdentityBlocked.map((row) => row.action)),
      }),
      postureGrantBlocked.length > 0 && Object.freeze({
        command: "grant_mailchimp_permission",
        reason: "Mailchimp tenant permission posture is missing required grants.",
        requiredPermissions: freezeArray([...new Set(postureGrantBlocked.flatMap((row) => row.missingPermissions || []))]),
        actions: freezeArray(postureGrantBlocked.map((row) => row.action)),
      }),
      postureLeaseBlocked.length > 0 && Object.freeze({
        command: "refresh_mailchimp_permission_lease",
        reason: "Mailchimp tenant permission posture has blocked or stale permission leases.",
        leaseTokens: freezeArray([...new Set(postureLeaseBlocked.map((row) => row.leaseToken).filter(Boolean))]),
        actions: freezeArray(postureLeaseBlocked.map((row) => row.action)),
      }),
      postureHandoffBlocked.length > 0 && Object.freeze({
        command: "attach_recovery_status_handoff",
        reason: "Mailchimp permission posture is covered but runtime handoff metadata is incomplete.",
        actions: freezeArray(postureHandoffBlocked.map((row) => row.action)),
      }),
      missingIdentityHolds.length > 0 && Object.freeze({
        command: "attach_client_runtime_request",
        reason: "tenant/workspace/actor state is required before Mailchimp adapter handoff",
      }),
      missingPermissionHolds.length > 0 && Object.freeze({
        command: "grant_mailchimp_permission",
        reason: "actor permissions or capability grants do not satisfy required Mailchimp scopes",
        requiredPermissions: freezeArray([...new Set(missingPermissionHolds.map((capability) => capability.requiredPermission).filter(Boolean))]),
      }),
      missingRuntimeHolds.length > 0 && Object.freeze({
        command: "attach_recovery_status_handoff",
        reason: "external Mailchimp writes need idempotency and status channel state",
      }),
      leaseHolds.length > 0 && Object.freeze({
        command: "refresh_mailchimp_permission_lease",
        reason: "active tenant/workspace permission leases are required before Mailchimp adapter handoff",
        leaseTokens: freezeArray([...new Set(leaseHolds.map((capability) => capability.permissionLease?.token).filter(Boolean))]),
        actions: freezeArray(leaseHolds.map((capability) => capability.action)),
      }),
    ].filter(Boolean)),
    heldCapabilities: freezeArray(heldCapabilities.map((capability) => ({
      action: capability.action,
      requiredPermission: capability.requiredPermission,
      permissionLease: capability.permissionLease,
      reasons: capability.reasons,
    }))),
    permissionPosture: Object.freeze({
      state: compactString(permissionPosture.state || "not-applicable"),
      fingerprint: compactString(permissionPosture.fingerprint),
      nextCommand: compactString(permissionPosture.nextStep?.command || "observe"),
      blockedRows: freezeArray(postureBlocked.map((row) => ({
        action: row.action,
        state: row.state,
        requiredPermission: row.requiredPermission,
        leaseState: row.leaseState,
        nextCommand: row.nextCommand,
      }))),
    }),
  });
}

function createAdapterStatusReadiness(scope = {}, hints = []) {
  const ledger = scope?.adapterStatusLedger || {};
  const snapshot = scope?.adapterStatusSnapshot || {};
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const failures = toArray(ledger.failures);
  const missing = toArray(ledger.missing);
  const latest = toArray(ledger.latestByCapability);
  const pending = latest.filter((row) => compactString(row.state) === "pending");
  const succeeded = latest.filter((row) => compactString(row.state) === "succeeded");
  const blockedSnapshotRows = toArray(snapshot.blockedRows);
  const needsStatus = adapterSteps.length > 0 && (ledger.state === "missing-status" || ledger.state === "unobserved");
  const state = failures.length > 0
    ? "blocked"
    : blockedSnapshotRows.length > 0
      ? "needs-status-materialization"
    : needsStatus
      ? "needs-status-snapshot"
      : pending.length > 0 || ledger.state === "pending"
        ? "waiting-adapter"
        : ledger.state === "unknown"
          ? "needs-status-reconciliation"
          : adapterSteps.length > 0 || providerCapabilities.length > 0
            ? "status-ready"
            : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.adapter-status-readiness.v1",
    state,
    acceptedForReplay: failures.length === 0 && missing.length === 0 && blockedSnapshotRows.length === 0,
    acceptedForAdapter: ["status-ready", "not-required"].includes(state) && snapshot.acceptedForAdapter !== false,
    statusChannel: compactString(snapshot.statusChannel || ledger.statusChannel || scope?.runtimeScope?.statusChannel),
    statusSnapshotKey: compactString(snapshot.statusSnapshotKey || ledger.statusSnapshotKey || scope?.persistedRuntime?.statusSnapshotKey),
    restartToken: compactString(ledger.restartToken || scope?.runtimeScope?.restartToken),
    counters: Object.freeze({
      adapterSteps: adapterSteps.length,
      providerCapabilities: providerCapabilities.length,
      expected: ledger.counters?.expected ?? 0,
      events: ledger.counters?.events ?? 0,
      missing: missing.length,
      failures: failures.length,
      pending: pending.length,
      succeeded: succeeded.length,
      snapshotRows: snapshot.counters?.rows ?? 0,
      snapshotBlockedRows: blockedSnapshotRows.length,
      snapshotMaterializedRows: snapshot.counters?.materialized ?? 0,
    }),
    latestByCapability: freezeArray(latest.map((row) => ({
      capability: compactString(row.capability),
      state: compactString(row.state || "unknown"),
      stepName: compactString(row.stepName),
      providerRequestId: compactString(row.providerRequestId),
      idempotencyKey: compactString(row.idempotencyKey),
      statusSnapshotKey: compactString(row.statusSnapshotKey),
      retryAfterMs: Number.isFinite(Number(row.retryAfterMs)) ? Number(row.retryAfterMs) : 0,
      message: compactString(row.message),
    }))),
    failures: freezeArray(failures.map((failure) => ({
      capability: compactString(failure.capability),
      stepName: compactString(failure.stepName),
      state: compactString(failure.state),
      message: compactString(failure.message),
      nextCommand: compactString(failure.nextCommand || "inspect_adapter_failure"),
    }))),
    statusSnapshot: Object.freeze({
      state: compactString(snapshot.state || "not-required"),
      acceptedForReplay: snapshot.acceptedForReplay !== false,
      acceptedForAdapter: snapshot.acceptedForAdapter === true,
      rows: snapshot.rows || freezeArray([]),
      blockedRows: freezeArray(blockedSnapshotRows),
      nextCommand: compactString(snapshot.nextCommand || "observe"),
    }),
    nextAction: Object.freeze({
      command: failures[0]?.nextCommand
        || (blockedSnapshotRows.length > 0 ? snapshot.nextCommand || "materialize_adapter_status_snapshot" : "")
        || (missing.length > 0 ? "load_adapter_status_snapshot" : "")
        || (pending.length > 0 ? "poll_adapter_status_channel" : "")
        || (state === "needs-status-reconciliation" ? "reconcile_adapter_status" : "observe"),
      reason: failures.length > 0
        ? "Adapter status contains terminal failure records."
        : blockedSnapshotRows.length > 0
          ? "Adapter status rows must be materialized into the restart snapshot."
        : missing.length > 0
          ? "Adapter status snapshot must be loaded before replay."
          : pending.length > 0
            ? "Adapter status is still pending."
            : "Adapter status is reconciled for typed handoff.",
    }),
  });
}

function createProviderSyncReadiness(scope = {}, persistedState = {}) {
  const contract = scope?.providerSyncContract || {};
  const rows = toArray(contract.rows);
  const blocked = rows.filter((row) => row.state === "blocked");
  const needsCursor = rows.filter((row) => row.state === "needs-provider-cursor");
  const checkpointReady = rows.filter((row) => row.state === "checkpoint-scoped");
  const watermarkReady = rows.filter((row) => row.state === "watermark-scoped");
  const missing = [...new Set(blocked.flatMap((row) => toArray(row.missing)).map(compactString).filter(Boolean))].sort();
  const state = blocked.length > 0
    ? "blocked"
    : needsCursor.length > 0
      ? "needs-provider-confirmation"
      : rows.length > 0
        ? "sync-ready"
        : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.provider-sync-readiness.v1",
    state,
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: rows.length === 0 || (blocked.length === 0 && needsCursor.length === 0),
    restartToken: firstString(contract.restartToken, persistedState.restartToken),
    statusChannel: firstString(contract.statusChannel, persistedState.statusChannel),
    statusSnapshotKey: persistedState.statusSnapshotKey || "",
    missing: freezeArray(missing),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      needsProviderCursor: needsCursor.length,
      checkpointReady: checkpointReady.length,
      watermarkReady: watermarkReady.length,
    }),
    rows: freezeArray(rows.map((row) => ({
      action: compactString(row.action),
      state: compactString(row.state),
      direction: compactString(row.direction),
      checkpointKey: compactString(row.checkpointKey),
      watermarkKey: compactString(row.watermarkKey),
      cursor: compactString(row.cursor),
      objectRef: compactString(row.objectRef),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: "aios.types.provider_sync_scope_blocked",
        severity: "error",
        message: `Provider sync for "${row.action}" is missing ${toArray(row.missing).join(", ") || "required state"}.`,
        nextCommand: row.nextCommand || "repair_provider_sync_scope",
      })),
      ...needsCursor.map((row) => ({
        code: "aios.types.provider_sync_cursor_missing",
        severity: "warning",
        message: `Provider sync for "${row.action}" needs Mailchimp cursor confirmation before adapter handoff.`,
        nextCommand: row.nextCommand || "confirm_provider_resource_state",
      })),
    ]),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand
        || needsCursor[0]?.nextCommand
        || (rows.length > 0 ? "publish_provider_sync_readiness" : "observe"),
      reason: blocked.length > 0
        ? "Provider sync scope is missing restart-safe checkpoint metadata."
        : needsCursor.length > 0
          ? "Provider resource cursor should be confirmed before Mailchimp adapter handoff."
          : rows.length > 0
            ? "Provider sync metadata is ready for typed handoff."
            : "No provider sync handoff is required.",
    }),
  });
}

function createSegmentSyncReceiptReadiness(scope = {}) {
  const ledger = scope?.segmentSyncReceipts || {};
  const rows = toArray(ledger.rows);
  const blocked = toArray(ledger.blockedRows);
  const pending = toArray(ledger.pendingRows);
  const state = blocked.length > 0
    ? "blocked"
    : pending.length > 0
      ? "pending-provider-confirmation"
      : rows.length > 0
        ? "accepted"
        : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.segment-sync-receipt-readiness.v1",
    state,
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: ledger.acceptedForAdapter !== false && blocked.length === 0 && pending.length === 0,
    statusChannel: compactString(ledger.statusChannel || scope?.runtimeScope?.statusChannel),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      state: compactString(row.state),
      audienceId: compactString(row.audienceId),
      segmentId: compactString(row.segmentId),
      receiptToken: compactString(row.receiptToken),
      providerRequestId: compactString(row.providerRequestId),
      checkpointKey: compactString(row.checkpointKey),
      cursor: compactString(row.cursor),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      action: compactString(row.action),
      segmentId: compactString(row.segmentId),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "attach_segment_sync_receipt"),
    }))),
    pendingRows: freezeArray(pending.map((row) => ({
      action: compactString(row.action),
      segmentId: compactString(row.segmentId),
      receiptToken: compactString(row.receiptToken),
      nextCommand: compactString(row.nextCommand || "poll_segment_sync_receipt"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      pending: pending.length,
      accepted: ledger.counters?.accepted ?? rows.filter((row) => row.state === "accepted").length,
    }),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: "aios.types.segment_sync_receipt_blocked",
        severity: "error",
        message: `Segment sync receipt for "${row.action}" is missing or rejected.`,
        nextCommand: row.nextCommand || "attach_segment_sync_receipt",
      })),
      ...pending.map((row) => ({
        code: "aios.types.segment_sync_receipt_pending",
        severity: "warning",
        message: `Segment sync receipt for "${row.action}" is pending provider confirmation.`,
        nextCommand: row.nextCommand || "poll_segment_sync_receipt",
      })),
    ]),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || pending[0]?.nextCommand || "observe",
      reason: blocked.length > 0
        ? "Mailchimp segment sync receipts must be accepted before adapter handoff."
        : pending.length > 0
          ? "Mailchimp segment sync receipts are waiting on provider confirmation."
          : rows.length > 0
            ? "Mailchimp segment sync receipts are accepted for handoff."
            : "No Mailchimp segment sync receipt is required.",
    }),
  });
}

function createProviderBudgetReadiness(scope = {}) {
  const budget = scope?.providerBudget || {};
  const rows = toArray(budget.rows);
  const blocked = toArray(budget.blockedRows);
  const degraded = toArray(budget.degradedRows);
  const retryAfterMs = Math.max(0, ...rows.map((row) => Number(row.retryAfterMs) || 0));
  const state = blocked.length > 0
    ? "blocked"
    : degraded.length > 0
      ? "throttled"
      : rows.length > 0
        ? "budget-ready"
        : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.provider-budget-readiness.v1",
    state,
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: budget.acceptedForAdapter !== false && blocked.length === 0,
    provider: compactString(budget.provider || "mailchimp"),
    retryAfterMs,
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      state: compactString(row.state),
      budgetId: compactString(row.budgetId),
      remaining: row.remaining ?? null,
      resetAt: compactString(row.resetAt),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      action: compactString(row.action),
      budgetId: compactString(row.budgetId),
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      nextCommand: compactString(row.nextCommand || "attach_provider_budget_state"),
    }))),
    degradedRows: freezeArray(degraded.map((row) => ({
      action: compactString(row.action),
      budgetId: compactString(row.budgetId),
      remaining: row.remaining ?? null,
      retryAfterMs: Number(row.retryAfterMs) || 0,
      nextCommand: compactString(row.nextCommand || "throttle_provider_handoff"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      degraded: degraded.length,
      exhausted: budget.counters?.exhausted ?? 0,
      unmetered: budget.counters?.unmetered ?? rows.filter((row) => row.state === "unmetered").length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || degraded[0]?.nextCommand || budget.nextStep?.command || "observe",
      retryAfterMs: blocked[0]?.retryAfterMs || degraded[0]?.retryAfterMs || retryAfterMs,
      reason: blocked.length > 0
        ? "Provider budget is exhausted or missing for Mailchimp adapter handoff."
        : degraded.length > 0
          ? "Provider budget is low; handoff should be throttled."
          : "Provider budget is ready for typed handoff.",
    }),
  });
}

function createSettingsAdoptionReadiness(scope = {}) {
  const adoption = scope?.settingsAdoption || {};
  const rows = toArray(adoption.rows);
  const blocked = toArray(adoption.blockedRows);
  const patchRows = toArray(adoption.patchRows);
  const disabledRows = toArray(adoption.disabledRows);
  const missing = [...new Set(blocked.flatMap((row) => toArray(row.missing)).map(compactString).filter(Boolean))].sort();
  const state = blocked.length > 0
    ? "blocked"
    : disabledRows.length > 0
      ? "disabled"
      : patchRows.length > 0
        ? "patch-required"
        : rows.length > 0
          ? "adopted"
          : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.settings-adoption-readiness.v1",
    state,
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: adoption.acceptedForAdapter !== false && blocked.length === 0 && disabledRows.length === 0,
    missing: freezeArray(missing),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      state: compactString(row.state),
      source: compactString(row.source),
      revision: compactString(row.revision),
      changedFields: freezeArray(toArray(row.changedFields).map(compactString).filter(Boolean)),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
      statusChannel: compactString(row.statusChannel || scope?.runtimeScope?.statusChannel),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      action: compactString(row.action),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "repair_mailchimp_settings"),
    }))),
    patchRows: freezeArray(patchRows.map((row) => ({
      action: compactString(row.action),
      changedFields: freezeArray(toArray(row.changedFields).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "apply_mailchimp_settings_patch"),
    }))),
    disabledRows: freezeArray(disabledRows.map((row) => ({
      action: compactString(row.action),
      archiveOnDisable: row.desired?.archiveOnDisable === true,
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      patchRequired: patchRows.length,
      disabled: disabledRows.length,
      adopted: rows.filter((row) => row.state === "adopted").length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || patchRows[0]?.nextCommand || disabledRows[0]?.nextCommand || adoption.nextStep?.command || "observe",
      reason: blocked.length > 0
        ? "Mailchimp settings adoption is missing required provider fields."
        : patchRows.length > 0
          ? "Mailchimp settings adoption has pending provider patch fields."
          : disabledRows.length > 0
            ? "Mailchimp settings disabled one or more provider capabilities."
            : "Mailchimp settings are ready for typed handoff.",
    }),
  });
}

function createLifecycleGateReadiness(scope = {}) {
  const gates = scope?.lifecycleGates || {};
  const rows = toArray(gates.rows);
  const blocked = toArray(gates.blockedRows);
  const gated = toArray(gates.gatedRows);
  const scheduled = rows.filter((row) => row.scheduling?.requested === true);
  const sendLocked = rows.filter((row) => row.sendLock?.locked === true);
  const overrideRequired = rows.filter((row) => row.overrideReceipt?.required === true);
  const overrideBlocked = overrideRequired.filter((row) => {
    return ["missing", "pending", "rejected", "revoked", "expired"].includes(compactString(row.overrideReceipt?.state))
      || row.overrideReceipt?.expired === true;
  });
  const consentRequired = rows.filter((row) => row.marketingConsent?.required === true);
  const consentBlocked = consentRequired.filter((row) => {
    return row.marketingConsent?.state !== "granted" || row.marketingConsent?.expired === true;
  });
  const state = blocked.length > 0
    ? "blocked"
    : gated.length > 0
      ? "gated"
      : rows.length > 0
        ? "open"
        : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.lifecycle-gate-readiness.v1",
    state,
    acceptedForPreview: gates.acceptedForPreview !== false,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: gates.acceptedForAdapter !== false && blocked.length === 0,
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      state: compactString(row.state),
      mode: compactString(row.mode || "enabled"),
      acceptedForAdapter: row.acceptedForAdapter === true,
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
      statusChannel: compactString(row.statusChannel || scope?.runtimeScope?.statusChannel),
      sendLock: Object.freeze({
        locked: row.sendLock?.locked === true,
        token: compactString(row.sendLock?.token),
        reason: compactString(row.sendLock?.reason),
      }),
      scheduling: Object.freeze({
        requested: row.scheduling?.requested === true,
        at: compactString(row.scheduling?.at),
        window: compactString(row.scheduling?.window),
        timezone: compactString(row.scheduling?.timezone || "UTC"),
        quietUntil: compactString(row.scheduling?.quietUntil),
        quietActive: row.scheduling?.quietActive === true,
      }),
      overrideReceipt: Object.freeze({
        required: row.overrideReceipt?.required === true,
        command: compactString(row.overrideReceipt?.command),
        state: compactString(row.overrideReceipt?.state || "not-required"),
        receiptToken: compactString(row.overrideReceipt?.receiptToken),
        acceptedBy: compactString(row.overrideReceipt?.acceptedBy),
        acceptedAt: compactString(row.overrideReceipt?.acceptedAt),
        expiresAt: compactString(row.overrideReceipt?.expiresAt),
        expired: row.overrideReceipt?.expired === true,
        statusChannel: compactString(row.overrideReceipt?.statusChannel || scope?.runtimeScope?.statusChannel),
        source: compactString(row.overrideReceipt?.source),
        nextCommand: compactString(row.overrideReceipt?.nextCommand || "observe"),
      }),
      marketingConsent: Object.freeze({
        required: row.marketingConsent?.required === true,
        state: compactString(row.marketingConsent?.state || "not-required"),
        consentId: compactString(row.marketingConsent?.consentId),
        audienceId: compactString(row.marketingConsent?.audienceId),
        segmentId: compactString(row.marketingConsent?.segmentId),
        source: compactString(row.marketingConsent?.source),
        grantedAt: compactString(row.marketingConsent?.grantedAt),
        expiresAt: compactString(row.marketingConsent?.expiresAt),
        expired: row.marketingConsent?.expired === true,
        statusChannel: compactString(row.marketingConsent?.statusChannel || scope?.runtimeScope?.statusChannel),
        nextCommand: compactString(row.marketingConsent?.nextCommand || "observe"),
      }),
      linkedState: Object.freeze({
        settings: compactString(row.linkedState?.settings || "not-required"),
        providerBudget: compactString(row.linkedState?.providerBudget || "not-required"),
        providerMaintenance: compactString(row.linkedState?.providerMaintenance || "not-required"),
      }),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      action: compactString(row.action),
      state: compactString(row.state),
      mode: compactString(row.mode || "enabled"),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "repair_mailchimp_lifecycle_controls"),
      overrideReceipt: row.overrideReceipt ? Object.freeze({
        required: row.overrideReceipt.required === true,
        command: compactString(row.overrideReceipt.command),
        state: compactString(row.overrideReceipt.state || "not-required"),
        receiptToken: compactString(row.overrideReceipt.receiptToken),
        expired: row.overrideReceipt.expired === true,
        nextCommand: compactString(row.overrideReceipt.nextCommand || row.nextCommand || "attach_mailchimp_lifecycle_command_receipt"),
      }) : null,
    }))),
    gatedRows: freezeArray(gated.map((row) => ({
      action: compactString(row.action),
      nextCommand: compactString(row.nextCommand || "queue_provider_schedule"),
      scheduling: row.scheduling || Object.freeze({}),
      sendLock: row.sendLock || Object.freeze({}),
      overrideReceipt: row.overrideReceipt || Object.freeze({ required: false, state: "not-required" }),
      marketingConsent: row.marketingConsent || Object.freeze({ required: false, state: "not-required" }),
    }))),
    overrideReceiptRows: freezeArray(overrideRequired.map((row) => ({
      action: compactString(row.action),
      command: compactString(row.overrideReceipt?.command),
      state: compactString(row.overrideReceipt?.state || "missing"),
      receiptToken: compactString(row.overrideReceipt?.receiptToken),
      expired: row.overrideReceipt?.expired === true,
      nextCommand: compactString(row.overrideReceipt?.nextCommand || row.nextCommand || "attach_mailchimp_lifecycle_command_receipt"),
    }))),
    blockedOverrideReceiptRows: freezeArray(overrideBlocked.map((row) => ({
      action: compactString(row.action),
      command: compactString(row.overrideReceipt?.command),
      state: compactString(row.overrideReceipt?.state || "missing"),
      receiptToken: compactString(row.overrideReceipt?.receiptToken),
      expired: row.overrideReceipt?.expired === true,
      missing: freezeArray(toArray(row.missing).filter((item) => compactString(item).startsWith("lifecycleCommand"))),
      nextCommand: compactString(row.overrideReceipt?.nextCommand || row.nextCommand || "attach_mailchimp_lifecycle_command_receipt"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.filter((row) => row.state === "blocked").length,
      disabled: blocked.filter((row) => row.state === "disabled").length,
      gated: gated.length,
      scheduled: scheduled.length,
      sendLocked: sendLocked.length,
      overrideReceiptsRequired: overrideRequired.length,
      overrideReceiptsBlocked: overrideBlocked.length,
      overrideReceiptsRejected: overrideBlocked.filter((row) => ["rejected", "revoked"].includes(compactString(row.overrideReceipt?.state))).length,
      overrideReceiptsExpired: overrideBlocked.filter((row) => row.overrideReceipt?.expired === true || compactString(row.overrideReceipt?.state) === "expired").length,
      consentRequired: consentRequired.length,
      consentBlocked: consentBlocked.length,
      consentExpired: consentRequired.filter((row) => row.marketingConsent?.expired === true).length,
    }),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: toArray(row.missing).some((item) => compactString(item).startsWith("lifecycleCommand"))
          ? "aios.types.lifecycle_command_receipt_blocked"
          : toArray(row.missing).some((item) => compactString(item).startsWith("marketingConsent"))
          ? "aios.types.lifecycle_marketing_consent_blocked"
          : "aios.types.lifecycle_gate_blocked",
        severity: "error",
        message: toArray(row.missing).some((item) => compactString(item).startsWith("lifecycleCommand"))
          ? `Lifecycle command receipt controls block Mailchimp handoff for "${row.action}".`
          : toArray(row.missing).some((item) => compactString(item).startsWith("marketingConsent"))
          ? `Marketing consent controls block Mailchimp handoff for "${row.action}".`
          : `Lifecycle controls block Mailchimp handoff for "${row.action}".`,
        nextCommand: row.nextCommand || (toArray(row.missing).some((item) => compactString(item).startsWith("lifecycleCommand"))
          ? "attach_mailchimp_lifecycle_command_receipt"
          : toArray(row.missing).some((item) => compactString(item).startsWith("marketingConsent")) ? "collect_marketing_consent" : "repair_mailchimp_lifecycle_controls"),
      })),
      ...gated.map((row) => ({
        code: "aios.types.lifecycle_gate_requires_action",
        severity: "warning",
        message: `Lifecycle controls require "${row.nextCommand || "observe"}" before Mailchimp handoff for "${row.action}".`,
        nextCommand: row.nextCommand || "observe",
      })),
    ]),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || gated[0]?.nextCommand || gates.nextStep?.command || "observe",
      reason: blocked.length > 0
        ? "Lifecycle gates have blocking enablement, send lock, or schedule control state."
        : overrideBlocked.length > 0
          ? "Lifecycle command receipts must be accepted before adapter handoff."
        : gated.length > 0
          ? "Lifecycle gates require a schedule or settings command before adapter handoff."
          : "Lifecycle gates are ready for typed handoff.",
    }),
  });
}

function createProviderExportBoundaryReadiness(scope = {}) {
  const rows = toArray(scope?.exportRows);
  const publication = scope?.publicationManifest || {};
  const providerRows = rows.filter((row) => compactString(row.provider) === "mailchimp");
  const blocked = providerRows.filter((row) => {
    return row.exportable !== true
      || toArray(row.blockedBy).length > 0
      || row.providerExportBoundary?.state === "blocked";
  });
  const stale = toArray(scope?.exportHistory?.staleRows);
  const destinations = toArray(scope?.exportHistory?.destinations);
  const publicationDestinations = toArray(publication.destinations);
  const publicationBlockedRows = toArray(publication.blockedRows);
  const publicationReadyRows = toArray(publication.publishableRows);
  const publicationBlockedDestinations = publicationDestinations.filter((destination) => compactString(destination.state) === "blocked");
  const disabledDestinations = destinations.filter((destination) => destination.enabled === false);
  const retryable = blocked.filter((row) => {
    return toArray(row.blockedBy).some((reason) => [
      "permission-lease-refresh",
      "provider-callback-pending",
      "provider-sync-scope",
      "adapter-status-terminal",
    ].includes(compactString(reason)));
  });
  const laneKeys = [...new Set(providerRows.map((row) => compactString(row.laneKey)).filter(Boolean))].sort();
  const fingerprints = [...new Set(providerRows.map((row) => compactString(row.boundaryFingerprint)).filter(Boolean))].sort();
  const state = blocked.length > 0
    ? "blocked"
    : publicationBlockedRows.length > 0 || publicationBlockedDestinations.length > 0 || publication.state === "blocked"
      ? "publication-blocked"
    : stale.length > 0
      ? "stale"
      : disabledDestinations.length > 0
        ? "destination-disabled"
        : publicationReadyRows.length > 0 || publication.state === "publish-ready"
          ? "publication-ready"
        : providerRows.length > 0
          ? "export-ready"
          : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.provider-export-boundary-readiness.v1",
    state,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && stale.length === 0 && disabledDestinations.length === 0 && publicationBlockedRows.length === 0 && publicationBlockedDestinations.length === 0,
    acceptedForAnalyticsExport: blocked.length === 0 && stale.length === 0 && disabledDestinations.length === 0 && publication.acceptedForExport !== false,
    acceptedForPublication: publication.acceptedForExport === true && publicationBlockedRows.length === 0 && publicationBlockedDestinations.length === 0,
    publicationId: compactString(publication.publicationId),
    laneKeys: freezeArray(laneKeys),
    boundaryFingerprints: freezeArray(fingerprints),
    rows: freezeArray(providerRows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      laneKey: compactString(row.laneKey),
      state: compactString(row.state),
      exportable: row.exportable === true,
      boundaryFingerprint: compactString(row.boundaryFingerprint),
      permissionLeaseState: compactString(row.permissionLeaseState || "not-required"),
      providerSyncState: compactString(row.providerSyncState || "not-applicable"),
      settingsAdoptionState: compactString(row.settingsAdoptionState || "not-required"),
      providerCallbackState: compactString(row.providerCallbackState || "not-required"),
      publicationState: compactString(publication.state || "not-provided"),
      publicationId: compactString(publication.publicationId),
      statusChannel: compactString(row.statusChannel),
      statusSnapshotKey: compactString(row.statusSnapshotKey),
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || row.providerExportBoundary?.nextCommand || "observe"),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      laneKey: compactString(row.laneKey),
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      missing: freezeArray(toArray(row.providerExportBoundary?.missing).map(compactString).filter(Boolean)),
      retryable: retryable.includes(row),
      nextCommand: compactString(row.nextCommand || row.providerExportBoundary?.nextCommand || "repair_provider_export_boundary"),
    }))),
    publication: Object.freeze({
      state: compactString(publication.state || "not-required"),
      publicationId: compactString(publication.publicationId),
      acceptedForExport: publication.acceptedForExport === true,
      acceptedForProviderHandoff: publication.acceptedForProviderHandoff !== false,
      laneKeys: publication.laneKeys || freezeArray([]),
      publishableRows: freezeArray(publicationReadyRows.map((row) => ({
        rowId: compactString(row.rowId),
        action: compactString(row.action),
        provider: compactString(row.provider),
        laneKey: compactString(row.laneKey),
        boundaryFingerprint: compactString(row.boundaryFingerprint),
        nextCommand: compactString(row.nextCommand || "publish_scope_analytics_export"),
      }))),
      blockedRows: freezeArray(publicationBlockedRows.map((row) => ({
        rowId: compactString(row.rowId),
        action: compactString(row.action),
        provider: compactString(row.provider),
        laneKey: compactString(row.laneKey),
        blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
        nextCommand: compactString(row.nextCommand || "repair_scope_analytics_export"),
      }))),
      destinations: freezeArray(publicationDestinations.map((destination) => ({
        destinationId: compactString(destination.destinationId),
        name: compactString(destination.name),
        format: compactString(destination.format),
        state: compactString(destination.state),
        manifestKey: compactString(destination.manifestKey),
        missing: freezeArray(toArray(destination.missing).map(compactString).filter(Boolean)),
        nextCommand: compactString(destination.nextCommand || "publish_scope_analytics_export"),
      }))),
      nextStep: publication.nextStep || Object.freeze({
        command: "observe",
        reason: "No scope analytics publication manifest was provided.",
      }),
    }),
    retryPolicy: Object.freeze({
      strategy: retryable.length > 0 ? "bounded-provider-export-repair" : blocked.length > 0 ? "manual-provider-export-repair" : "none",
      maxAttempts: retryable.length > 0 ? 3 : 0,
      baseDelayMs: retryable.length > 0 ? 2000 : 0,
      maxDelayMs: retryable.length > 0 ? 60000 : 0,
      retryableRows: freezeArray(retryable.map((row) => compactString(row.rowId))),
      retryableActions: freezeArray(retryable.map((row) => compactString(row.action))),
    }),
    counters: Object.freeze({
      rows: providerRows.length,
      blocked: blocked.length,
      retryable: retryable.length,
      stale: stale.length,
      destinations: destinations.length,
      disabledDestinations: disabledDestinations.length,
      publicationRows: publication.counters?.rows ?? publicationReadyRows.length + publicationBlockedRows.length,
      publicationReadyRows: publicationReadyRows.length,
      publicationBlockedRows: publicationBlockedRows.length,
      publicationBlockedDestinations: publicationBlockedDestinations.length,
      lanes: laneKeys.length,
      fingerprints: fingerprints.length,
    }),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: "aios.types.provider_export_boundary_blocked",
        severity: "error",
        message: `Provider export boundary for "${row.action}" is not exportable for Mailchimp handoff.`,
        nextCommand: row.nextCommand || row.providerExportBoundary?.nextCommand || "repair_provider_export_boundary",
      })),
      ...stale.map((row) => ({
        code: "aios.types.provider_export_boundary_stale",
        severity: "warning",
        message: `Provider export boundary snapshot for "${row.jobName}" is stale.`,
        nextCommand: row.nextCommand || "refresh_scope_analytics_snapshot",
      })),
      ...disabledDestinations.map((destination) => ({
        code: "aios.types.provider_export_destination_disabled",
        severity: "warning",
        message: `Provider export destination "${destination.name}" is disabled.`,
        nextCommand: destination.nextCommand || "enable_scope_export_destination",
      })),
      ...publicationBlockedRows.map((row) => ({
        code: "aios.types.provider_export_publication_blocked",
        severity: "error",
        message: `Provider export publication row "${row.action}" is blocked before analytics publication.`,
        nextCommand: row.nextCommand || "repair_scope_analytics_export",
      })),
      ...publicationBlockedDestinations.map((destination) => ({
        code: "aios.types.provider_export_publication_destination_blocked",
        severity: "error",
        message: `Provider export publication destination "${destination.name}" is blocked.`,
        nextCommand: destination.nextCommand || "repair_scope_analytics_export",
      })),
    ]),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand
        || publicationBlockedRows[0]?.nextCommand
        || publicationBlockedDestinations[0]?.nextCommand
        || stale[0]?.nextCommand
        || disabledDestinations[0]?.nextCommand
        || publication.nextStep?.command
        || scope?.exportHistory?.nextCommand
        || (providerRows.length > 0 ? "publish_provider_export_boundary" : "observe"),
      reason: blocked.length > 0
        ? "Provider export boundaries contain blocked Mailchimp lanes."
        : publicationBlockedRows.length > 0 || publicationBlockedDestinations.length > 0
          ? "Provider export publication manifest has blocked rows or destinations."
        : stale.length > 0
          ? "Provider export boundary snapshots should be refreshed before analytics export."
        : disabledDestinations.length > 0
          ? "A provider export destination must be enabled before publication."
        : publicationReadyRows.length > 0
          ? "Provider export publication manifest is ready for analytics publication."
            : "Provider export boundaries are ready for typed analytics handoff.",
    }),
  });
}

function createPublicationReceiptReadiness(scope = {}) {
  const ledger = scope?.publicationReceipts || {};
  const rows = toArray(ledger.rows);
  const accepted = toArray(ledger.acceptedRows);
  const pending = toArray(ledger.pendingRows);
  const blocked = toArray(ledger.blockedRows);
  const publication = scope?.publicationManifest || {};
  const missing = [...new Set(blocked.flatMap((row) => toArray(row.missing)).map(compactString).filter(Boolean))].sort();
  const state = blocked.length > 0
    ? "blocked"
    : pending.length > 0
      ? "pending-receipt"
      : accepted.length > 0
        ? "accepted"
        : publication.acceptedForExport === true
          ? "needs-receipt"
          : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.publication-receipt-readiness.v1",
    state,
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: ledger.acceptedForProviderHandoff === true && blocked.length === 0 && pending.length === 0,
    acceptedForProviderHandoff: ledger.acceptedForProviderHandoff === true,
    publicationId: compactString(ledger.publicationId || publication.publicationId),
    observedAt: compactString(ledger.observedAt),
    missing: freezeArray(missing),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      publicationId: compactString(row.publicationId),
      destinationId: compactString(row.destinationId),
      destinationName: compactString(row.destinationName),
      format: compactString(row.format),
      manifestKey: compactString(row.manifestKey),
      state: compactString(row.state),
      accepted: row.accepted === true,
      receiptId: compactString(row.receiptId),
      acceptedAt: compactString(row.acceptedAt),
      acceptedBy: compactString(row.acceptedBy),
      providerAckId: compactString(row.providerAckId),
      publishableRows: Number(row.publishableRows) || 0,
      blockedRows: Number(row.blockedRows) || 0,
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      statusChannel: compactString(row.statusChannel || scope?.runtimeScope?.statusChannel),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    acceptedRows: freezeArray(accepted.map((row) => ({
      rowId: compactString(row.rowId),
      destinationId: compactString(row.destinationId),
      receiptId: compactString(row.receiptId),
      acceptedAt: compactString(row.acceptedAt),
      providerAckId: compactString(row.providerAckId),
    }))),
    pendingRows: freezeArray(pending.map((row) => ({
      rowId: compactString(row.rowId),
      destinationId: compactString(row.destinationId),
      manifestKey: compactString(row.manifestKey),
      nextCommand: compactString(row.nextCommand || "attach_scope_publication_receipt"),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      rowId: compactString(row.rowId),
      destinationId: compactString(row.destinationId),
      state: compactString(row.state),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "repair_scope_publication_receipt"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      accepted: accepted.length,
      pending: pending.length,
      blocked: blocked.length,
      destinations: ledger.counters?.destinations ?? rows.length,
      publishableRows: ledger.counters?.publishableRows ?? 0,
      providedReceipts: ledger.counters?.providedReceipts ?? accepted.length,
    }),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: "aios.types.publication_receipt_blocked",
        severity: "error",
        message: `Publication receipt for destination "${row.destinationId || row.destinationName || "unknown"}" is blocked.`,
        nextCommand: row.nextCommand || "repair_scope_publication_receipt",
      })),
      ...pending.map((row) => ({
        code: "aios.types.publication_receipt_pending",
        severity: "warning",
        message: `Publication receipt for destination "${row.destinationId || row.destinationName || "unknown"}" must be attached before provider handoff.`,
        nextCommand: row.nextCommand || "attach_scope_publication_receipt",
      })),
    ]),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || pending[0]?.nextCommand || ledger.nextStep?.command || "observe",
      reason: blocked.length > 0
        ? "Publication receipt rows are blocked or rejected."
        : pending.length > 0
          ? "Publication receipt rows are pending client/provider acknowledgement."
          : accepted.length > 0
            ? "Publication receipt rows are accepted for typed provider handoff."
            : "No publication receipts are required.",
    }),
  });
}

function createProviderCallbackReadiness(scope = {}) {
  const callback = scope?.providerCallback || {};
  const rows = toArray(callback.rows);
  const blocked = toArray(callback.blockedRows);
  const pending = toArray(callback.pendingRows);
  const verified = rows.filter((row) => row.state === "verified");
  const state = blocked.length > 0
    ? "blocked"
    : pending.length > 0
      ? "pending-verification"
      : rows.some((row) => row.required)
        ? "callback-ready"
        : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.provider-callback-readiness.v1",
    state,
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: callback.acceptedForAdapter !== false && blocked.length === 0 && pending.length === 0,
    statusChannel: compactString(callback.rows?.[0]?.statusChannel || scope?.runtimeScope?.statusChannel),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      provider: compactString(row.provider),
      required: row.required === true,
      state: compactString(row.state),
      callbackId: compactString(row.callbackId),
      endpointUrl: compactString(row.endpointUrl),
      verificationState: compactString(row.verificationState),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      action: compactString(row.action),
      callbackId: compactString(row.callbackId),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "attach_provider_callback_endpoint"),
    }))),
    pendingRows: freezeArray(pending.map((row) => ({
      action: compactString(row.action),
      callbackId: compactString(row.callbackId),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      nextCommand: compactString(row.nextCommand || "verify_provider_callback_endpoint"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      required: rows.filter((row) => row.required).length,
      verified: verified.length,
      pending: pending.length,
      blocked: blocked.length,
    }),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: "aios.types.provider_callback_blocked",
        severity: "error",
        message: `Provider callback for "${row.action}" is missing ${toArray(row.missing).join(", ") || "verification state"}.`,
        nextCommand: row.nextCommand || "attach_provider_callback_endpoint",
      })),
      ...pending.map((row) => ({
        code: "aios.types.provider_callback_pending",
        severity: "warning",
        message: `Provider callback for "${row.action}" is waiting for Mailchimp endpoint verification.`,
        nextCommand: row.nextCommand || "verify_provider_callback_endpoint",
      })),
    ]),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || pending[0]?.nextCommand || callback.nextStep?.command || "observe",
      retryAfterMs: blocked[0]?.retryAfterMs || pending[0]?.retryAfterMs || callback.nextStep?.retryAfterMs || 0,
      reason: blocked.length > 0
        ? "Provider callback endpoint state is incomplete for typed handoff."
        : pending.length > 0
          ? "Provider callback endpoint verification is pending."
          : "Provider callback endpoint state is ready for typed handoff.",
    }),
  });
}

function createProviderEventSubscriptionReadiness(scope = {}) {
  const contract = scope?.providerEventSubscriptions || {};
  const rows = toArray(contract.rows);
  const blocked = toArray(contract.blockedRows);
  const pending = toArray(contract.pendingRows);
  const subscribed = rows.filter((row) => row.state === "subscribed");
  const missingEvents = [...new Set(blocked.flatMap((row) => toArray(row.missingEvents)).map(compactString).filter(Boolean))].sort();
  const state = blocked.length > 0
    ? "blocked"
    : pending.length > 0
      ? "pending"
      : rows.some((row) => row.required)
        ? "subscribed"
        : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.provider-event-subscription-readiness.v1",
    state,
    acceptedForPreview: contract.acceptedForPreview !== false,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: contract.acceptedForAdapter !== false && blocked.length === 0 && pending.length === 0,
    statusChannel: compactString(rows[0]?.statusChannel || scope?.runtimeScope?.statusChannel),
    missingEvents: freezeArray(missingEvents),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      provider: compactString(row.provider),
      required: row.required === true,
      state: compactString(row.state),
      subscriptionId: compactString(row.subscriptionId),
      callbackId: compactString(row.callbackId),
      callbackState: compactString(row.callbackState || "not-required"),
      requiredEvents: freezeArray(toArray(row.requiredEvents).map(compactString).filter(Boolean)),
      subscribedEvents: freezeArray(toArray(row.subscribedEvents).map(compactString).filter(Boolean)),
      missingEvents: freezeArray(toArray(row.missingEvents).map(compactString).filter(Boolean)),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      action: compactString(row.action),
      subscriptionId: compactString(row.subscriptionId),
      callbackId: compactString(row.callbackId),
      callbackState: compactString(row.callbackState || "not-required"),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      missingEvents: freezeArray(toArray(row.missingEvents).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "subscribe_provider_events"),
    }))),
    pendingRows: freezeArray(pending.map((row) => ({
      action: compactString(row.action),
      subscriptionId: compactString(row.subscriptionId),
      callbackId: compactString(row.callbackId),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      nextCommand: compactString(row.nextCommand || "poll_provider_event_subscription"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      required: rows.filter((row) => row.required).length,
      subscribed: subscribed.length,
      pending: pending.length,
      blocked: blocked.length,
      missingEvents: rows.reduce((count, row) => count + toArray(row.missingEvents).length, 0),
    }),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: "aios.types.provider_event_subscription_blocked",
        severity: "error",
        message: `Provider event subscription for "${row.action}" is missing ${toArray(row.missingEvents).join(", ") || toArray(row.missing).join(", ") || "required event state"}.`,
        nextCommand: row.nextCommand || "subscribe_provider_events",
      })),
      ...pending.map((row) => ({
        code: "aios.types.provider_event_subscription_pending",
        severity: "warning",
        message: `Provider event subscription for "${row.action}" is waiting for Mailchimp confirmation.`,
        nextCommand: row.nextCommand || "poll_provider_event_subscription",
      })),
    ]),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || pending[0]?.nextCommand || contract.nextStep?.command || "observe",
      retryAfterMs: blocked[0]?.retryAfterMs || pending[0]?.retryAfterMs || contract.nextStep?.retryAfterMs || 0,
      reason: blocked.length > 0
        ? "Provider event subscriptions are incomplete for typed Mailchimp handoff."
        : pending.length > 0
          ? "Provider event subscription registration is pending."
          : "Provider event subscriptions are ready for typed handoff.",
    }),
  });
}

function createProviderMaintenanceReadiness(scope = {}) {
  const maintenance = scope?.providerMaintenance || {};
  const rows = toArray(maintenance.rows);
  const blocked = toArray(maintenance.blockedRows);
  const degraded = toArray(maintenance.degradedRows);
  const retryAfterMs = Math.max(0, ...rows.map((row) => Number(row.retryAfterMs) || 0));
  const state = blocked.length > 0
    ? "blocked"
    : degraded.length > 0
      ? "degraded"
      : rows.some((row) => row.state === "clear")
        ? "clear"
        : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.provider-maintenance-readiness.v1",
    state,
    acceptedForPreview: maintenance.acceptedForPreview !== false,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: maintenance.acceptedForAdapter !== false && blocked.length === 0,
    retryAfterMs,
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      provider: compactString(row.provider),
      state: compactString(row.state),
      windowId: compactString(row.windowId),
      startsAt: compactString(row.startsAt),
      endsAt: compactString(row.endsAt),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      allowPreview: row.allowPreview !== false,
      serviceWindow: row.serviceWindow ? Object.freeze({
        serviceWindowId: compactString(row.serviceWindow.serviceWindowId),
        state: compactString(row.serviceWindow.state || "available"),
        severity: compactString(row.serviceWindow.severity),
        startsAt: compactString(row.serviceWindow.startsAt),
        endsAt: compactString(row.serviceWindow.endsAt),
        blocksReads: row.serviceWindow.blocksReads === true,
        blocksWrites: row.serviceWindow.blocksWrites === true,
        reason: compactString(row.serviceWindow.reason),
        nextCommand: compactString(row.serviceWindow.nextCommand || row.nextCommand || "observe"),
      }) : null,
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      action: compactString(row.action),
      windowId: compactString(row.windowId),
      serviceWindowId: compactString(row.serviceWindow?.serviceWindowId),
      serviceState: compactString(row.serviceWindow?.state || "available"),
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      nextCommand: compactString(row.nextCommand || "wait_for_provider_maintenance_window"),
    }))),
    degradedRows: freezeArray(degraded.map((row) => ({
      action: compactString(row.action),
      windowId: compactString(row.windowId),
      serviceWindowId: compactString(row.serviceWindow?.serviceWindowId),
      serviceState: compactString(row.serviceWindow?.state || "available"),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      nextCommand: compactString(row.nextCommand || "defer_provider_handoff"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      degraded: degraded.length,
      active: maintenance.counters?.active ?? 0,
      scheduled: maintenance.counters?.scheduled ?? 0,
      serviceOutages: maintenance.counters?.serviceOutages ?? rows.filter((row) => row.serviceWindow?.state === "outage").length,
      serviceDegraded: maintenance.counters?.serviceDegraded ?? rows.filter((row) => row.serviceWindow?.state === "degraded").length,
      serviceWriteUnavailable: maintenance.counters?.serviceWriteUnavailable ?? rows.filter((row) => toArray(row.blockedBy).includes("provider-service-write-unavailable")).length,
    }),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: row.serviceWindow?.state === "outage"
          ? "aios.types.provider_service_outage"
          : "aios.types.provider_maintenance_blocked",
        severity: "error",
        message: row.serviceWindow?.state === "outage"
          ? `Provider service outage blocks Mailchimp handoff for "${row.action}".`
          : `Provider maintenance window blocks Mailchimp handoff for "${row.action}".`,
        nextCommand: row.nextCommand || row.serviceWindow?.nextCommand || "wait_for_provider_maintenance_window",
      })),
      ...degraded.map((row) => ({
        code: row.serviceWindow?.state === "degraded"
          ? "aios.types.provider_service_degraded"
          : "aios.types.provider_maintenance_degraded",
        severity: "warning",
        message: row.serviceWindow?.state === "degraded"
          ? `Provider service degradation should defer or throttle Mailchimp handoff for "${row.action}".`
          : `Provider maintenance window should defer Mailchimp handoff for "${row.action}".`,
        nextCommand: row.nextCommand || row.serviceWindow?.nextCommand || "defer_provider_handoff",
      })),
    ]),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || degraded[0]?.nextCommand || maintenance.nextStep?.command || "observe",
      retryAfterMs: blocked[0]?.retryAfterMs || degraded[0]?.retryAfterMs || retryAfterMs,
      reason: blocked.length > 0
        ? "Provider maintenance blocks typed Mailchimp adapter handoff."
        : degraded.length > 0
          ? "Provider maintenance is scheduled or active in degraded mode."
          : "Provider maintenance does not block typed handoff.",
    }),
  });
}

function createProviderOperationalIncidentReadiness(scope = {}) {
  const incident = scope?.providerOperationalIncidents || {};
  const rows = toArray(incident.rows);
  const blocked = toArray(incident.blockedRows);
  const degraded = toArray(incident.degradedRows);
  const retryAfterMs = Math.max(0, ...rows.map((row) => Number(row.retryAfterMs) || 0));
  const sources = [...new Set(rows.map((row) => compactString(row.source)).filter(Boolean))].sort();
  const blockedActions = [...new Set(blocked.map((row) => compactString(row.action)).filter(Boolean))].sort();
  const degradedActions = [...new Set(degraded.map((row) => compactString(row.action)).filter(Boolean))].sort();
  const state = blocked.length > 0
    ? "blocked"
    : degraded.length > 0
      ? "degraded"
      : rows.length > 0 || incident.state === "clear"
        ? "clear"
        : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.provider-operational-incident-readiness.v1",
    state,
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: incident.acceptedForAdapter !== false && blocked.length === 0,
    statusChannel: compactString(incident.statusChannel || scope?.runtimeScope?.statusChannel),
    observedAt: compactString(incident.observedAt),
    retryAfterMs,
    sources: freezeArray(sources),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      provider: compactString(row.provider || "mailchimp"),
      source: compactString(row.source),
      state: compactString(row.state),
      severity: compactString(row.severity),
      reason: compactString(row.reason),
      externalHandoff: compactString(row.externalHandoff || "defer"),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      nextCommand: compactString(row.nextCommand || "observe"),
      refs: Object.freeze({
        windowId: compactString(row.refs?.windowId),
        serviceWindowId: compactString(row.refs?.serviceWindowId),
        budgetId: compactString(row.refs?.budgetId),
        callbackId: compactString(row.refs?.callbackId),
        subscriptionId: compactString(row.refs?.subscriptionId),
        leaseToken: compactString(row.refs?.leaseToken),
      }),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      action: compactString(row.action),
      source: compactString(row.source),
      severity: compactString(row.severity),
      reason: compactString(row.reason),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      nextCommand: compactString(row.nextCommand || "resolve_provider_operational_incident"),
    }))),
    degradedRows: freezeArray(degraded.map((row) => ({
      action: compactString(row.action),
      source: compactString(row.source),
      severity: compactString(row.severity),
      reason: compactString(row.reason),
      retryAfterMs: Number(row.retryAfterMs) || 0,
      nextCommand: compactString(row.nextCommand || "defer_provider_handoff"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      degraded: degraded.length,
      critical: incident.counters?.critical ?? rows.filter((row) => row.severity === "critical").length,
      retryable: incident.counters?.retryable ?? rows.filter((row) => Number(row.retryAfterMs) > 0).length,
      sources: sources.length,
      blockedActions: blockedActions.length,
      degradedActions: degradedActions.length,
      maintenance: incident.counters?.maintenance ?? rows.filter((row) => row.source === "provider-maintenance").length,
      budget: incident.counters?.budget ?? rows.filter((row) => row.source === "provider-budget").length,
      callback: incident.counters?.callback ?? rows.filter((row) => row.source === "provider-callback").length,
      eventSubscriptions: incident.counters?.eventSubscriptions ?? rows.filter((row) => row.source === "provider-event-subscription").length,
      permissionLeases: incident.counters?.permissionLeases ?? rows.filter((row) => row.source === "permission-lease").length,
    }),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: "aios.types.provider_operational_incident_blocked",
        severity: row.severity === "critical" ? "error" : "error",
        message: `Provider operational incident "${row.source}" blocks Mailchimp handoff for "${row.action}".`,
        nextCommand: row.nextCommand || "resolve_provider_operational_incident",
      })),
      ...degraded.map((row) => ({
        code: "aios.types.provider_operational_incident_degraded",
        severity: "warning",
        message: `Provider operational incident "${row.source}" should defer or throttle Mailchimp handoff for "${row.action}".`,
        nextCommand: row.nextCommand || "defer_provider_handoff",
      })),
    ]),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || degraded[0]?.nextCommand || incident.nextStep?.command || "observe",
      retryAfterMs: blocked[0]?.retryAfterMs || degraded[0]?.retryAfterMs || retryAfterMs,
      reason: blocked.length > 0
        ? "Provider operational incidents block typed Mailchimp adapter handoff."
        : degraded.length > 0
          ? "Provider operational incidents require deferred or throttled typed handoff."
          : "Provider operational incidents are clear for typed handoff.",
    }),
    exportSummary: Object.freeze({
      blockedActions: freezeArray(blockedActions),
      degradedActions: freezeArray(degradedActions),
      sources: freezeArray(sources),
      nextCommand: blocked[0]?.nextCommand || degraded[0]?.nextCommand || "observe",
      retryAfterMs,
    }),
  });
}

function createAdapterHandoffReadiness(scope = {}, hints = [], persistedState = {}) {
  const manifest = scope?.adapterHandoffManifest || {};
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const rows = toArray(manifest.rows);
  const blocked = toArray(manifest.blockedRows);
  const waiting = toArray(manifest.waitingRows);
  const queueable = toArray(manifest.queueableRows);
  const restartManifest = persistedState.restartCommandManifest || {};
  const restartBlocked = toArray(restartManifest.blockedCommands);
  const state = blocked.length > 0 || restartBlocked.length > 0
    ? "blocked"
    : waiting.length > 0
      ? "waiting"
      : queueable.length > 0
        ? "queueable"
        : providerCapabilities.length > 0 || adapterSteps.length > 0
          ? "needs-handoff-manifest"
          : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.adapter-handoff-readiness.v1",
    state,
    acceptedForPreview: true,
    acceptedForRuntime: state !== "blocked",
    acceptedForAdapter: state === "queueable" && manifest.acceptedForAdapter === true && restartBlocked.length === 0,
    statusChannel: firstString(manifest.statusChannel, persistedState.statusChannel, scope?.runtimeScope?.statusChannel),
    restartToken: firstString(manifest.restartToken, persistedState.restartToken, scope?.runtimeScope?.restartToken),
    statusSnapshotKey: firstString(manifest.statusSnapshotKey, persistedState.statusSnapshotKey),
    counters: Object.freeze({
      providerCapabilities: providerCapabilities.length,
      adapterSteps: adapterSteps.length,
      rows: rows.length,
      blocked: blocked.length,
      waiting: waiting.length,
      queueable: queueable.length,
      restartBlocked: restartBlocked.length,
      leaseBlocked: manifest.counters?.leaseBlocked ?? 0,
      statusBlocked: manifest.counters?.statusBlocked ?? 0,
      providerSyncBlocked: manifest.counters?.providerSyncBlocked ?? 0,
    }),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      jobName: compactString(row.jobName),
      action: compactString(row.action),
      provider: compactString(row.provider),
      state: compactString(row.state),
      queueable: row.queueable === true,
      command: compactString(row.command),
      commandId: compactString(row.commandId),
      runtime: row.runtime || Object.freeze({}),
      guards: row.guards || Object.freeze({}),
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
    }))),
    blockedRows: freezeArray([
      ...blocked.map((row) => ({
        rowId: compactString(row.rowId),
        action: compactString(row.action),
        command: compactString(row.command),
        blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      })),
      ...restartBlocked.map((command) => ({
        rowId: compactString(command.command || command.commandId),
        action: compactString(command.capability || command.stepName || command.command),
        command: compactString(command.nextCommand || "attach_recovery_status_handoff"),
        blockedBy: freezeArray(toArray(command.missing).map((missing) => `missing:${missing}`)),
      })),
    ]),
    queueableRows: freezeArray(queueable.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      command: compactString(row.command),
      commandId: compactString(row.commandId),
      runtime: row.runtime || Object.freeze({}),
    }))),
    nextStep: Object.freeze({
      command: blocked[0]?.command
        || restartBlocked[0]?.nextCommand
        || waiting[0]?.command
        || queueable[0]?.command
        || manifest.nextStep?.command
        || "observe",
      reason: blocked.length > 0 || restartBlocked.length > 0
        ? "Typed adapter handoff is blocked by scope or restart command guards."
        : waiting.length > 0
          ? "Typed adapter handoff is waiting on provider status or sync confirmation."
          : queueable.length > 0
            ? "Typed adapter handoff rows are queueable."
            : "No adapter handoff is required for typed runtime adoption.",
    }),
  });
}

function createAdapterHandoffReceiptReadiness(scope = {}, adapterHandoffReadiness = {}) {
  const ledger = scope?.adapterHandoffReceipts || {};
  const rows = toArray(ledger.rows);
  const blocked = toArray(ledger.blockedRows);
  const accepted = toArray(ledger.acceptedRows);
  const queueable = toArray(ledger.queueableRows);
  const adapterRows = toArray(adapterHandoffReadiness.rows);
  const adapterQueueable = toArray(adapterHandoffReadiness.queueableRows);
  const state = blocked.length > 0
    ? "blocked"
    : accepted.length > 0
      ? "accepted"
      : queueable.length > 0 || adapterQueueable.length > 0
        ? "queueable"
        : adapterRows.length > 0
          ? "not-required"
          : "not-applicable";

  return Object.freeze({
    protocol: "aios.type-hints.adapter-handoff-receipts.v1",
    state,
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && adapterHandoffReadiness.acceptedForAdapter !== false,
    required: ledger.required === true,
    restartToken: firstString(ledger.restartToken, adapterHandoffReadiness.restartToken, scope?.runtimeScope?.restartToken),
    statusChannel: firstString(ledger.statusChannel, adapterHandoffReadiness.statusChannel, scope?.runtimeScope?.statusChannel),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      provider: compactString(row.provider || "mailchimp"),
      command: compactString(row.command),
      commandId: compactString(row.commandId),
      state: compactString(row.state),
      required: row.required === true,
      receiptToken: compactString(row.receiptToken),
      receiptStatus: compactString(row.receiptStatus || "missing"),
      providerRequestId: compactString(row.providerRequestId),
      statusSnapshotKey: compactString(row.statusSnapshotKey),
      idempotencyKey: compactString(row.idempotencyKey),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      action: compactString(row.action),
      command: compactString(row.command),
      commandId: compactString(row.commandId),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "attach_adapter_handoff_receipt"),
    }))),
    acceptedRows: freezeArray(accepted.map((row) => ({
      action: compactString(row.action),
      commandId: compactString(row.commandId),
      receiptToken: compactString(row.receiptToken),
      providerRequestId: compactString(row.providerRequestId),
      statusSnapshotKey: compactString(row.statusSnapshotKey),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      accepted: accepted.length,
      queueable: queueable.length,
      adapterRows: adapterRows.length,
      adapterQueueable: adapterQueueable.length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || queueable[0]?.command || adapterHandoffReadiness.nextStep?.command || "observe",
      reason: blocked.length > 0
        ? "Adapter handoff receipt rows must be repaired before typed Mailchimp status handoff."
        : accepted.length > 0
          ? "Adapter handoff receipts are accepted for typed runtime recovery."
          : queueable.length > 0 || adapterQueueable.length > 0
            ? "Adapter handoff receipt tracking is ready for queued Mailchimp work."
            : "No adapter handoff receipt tracking is required.",
    }),
  });
}

function createWorkspaceBoundaryReadiness(scope = {}) {
  const boundary = scope?.workspaceBoundary || {};
  const rows = toArray(boundary.rows);
  const quarantined = toArray(boundary.quarantinedRows);
  const transfers = toArray(boundary.transferRows);
  const approvedTransfers = transfers.filter((row) => row.state === "approved-transfer");
  return Object.freeze({
    protocol: "aios.type-hints.workspace-boundary-readiness.v1",
    state: quarantined.length > 0
      ? "quarantined"
      : approvedTransfers.length > 0
        ? "audit-required"
        : rows.length > 0
          ? "same-workspace"
          : "not-required",
    acceptedForPreview: true,
    acceptedForRuntime: quarantined.length === 0,
    acceptedForAdapter: boundary.acceptedForAdapter !== false && quarantined.length === 0,
    acceptedForAudit: boundary.acceptedForAudit === true || (rows.length > 0 && quarantined.length === 0),
    tenantId: compactString(boundary.tenantId || scope?.runtimeScope?.tenantId),
    workspaceId: compactString(boundary.workspaceId || scope?.runtimeScope?.workspaceId),
    statusChannel: compactString(boundary.auditHandoff?.statusChannel || scope?.runtimeScope?.statusChannel),
    restartToken: compactString(boundary.auditHandoff?.restartToken || scope?.runtimeScope?.restartToken),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      state: compactString(row.state),
      transferRequested: row.transferRequested === true,
      transferToken: compactString(row.transferToken),
      sourceTenantId: compactString(row.sourceTenantId),
      sourceWorkspaceId: compactString(row.sourceWorkspaceId),
      targetTenantId: compactString(row.targetTenantId),
      targetWorkspaceId: compactString(row.targetWorkspaceId),
      approvalState: compactString(row.approval?.state || "not-required"),
      approvalToken: compactString(row.approval?.token),
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    quarantinedRows: freezeArray(quarantined.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      transferToken: compactString(row.transferToken),
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "collect_workspace_boundary_approval"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      transfers: transfers.length,
      approvedTransfers: approvedTransfers.length,
      quarantined: quarantined.length,
    }),
    nextStep: Object.freeze({
      command: quarantined[0]?.nextCommand
        || approvedTransfers[0]?.nextCommand
        || boundary.nextStep?.command
        || "observe",
      reason: quarantined.length > 0
        ? "Workspace boundary is quarantined until tenant/workspace approval evidence is attached."
        : approvedTransfers.length > 0
          ? "Approved workspace transfer should be recorded in the typed audit handoff."
          : "Workspace boundary is ready for typed handoff.",
    }),
  });
}

function createRecoveryCommandGraph(job = {}, hints = [], scope = {}, persistedState = {}, boundaryHealth = {}, adapterStatusReadiness = {}, providerSyncReadiness = {}, adapterHandoffReadiness = {}) {
  const jobName = compactString(job.name || scope?.jobName || "anonymous");
  const runtimeScope = scope?.runtimeScope || {};
  const scopeLedger = scope?.recoveryPlan?.persistedRecoveryLedger || {};
  const restartToken = firstString(persistedState.restartToken, runtimeScope.restartToken);
  const commandKey = firstString(persistedState.commandKey, persistedState.restartCommandManifest?.commandKey);
  const statusChannel = firstString(persistedState.statusChannel, runtimeScope.statusChannel);
  const statusSnapshotKey = firstString(persistedState.statusSnapshotKey, scope?.persistedRuntime?.statusSnapshotKey);
  const rows = [];
  const workspaceBoundaryReadiness = scope?.workspaceBoundaryReadiness || createWorkspaceBoundaryReadiness(scope);
  const pushRow = (row = {}) => {
    const command = compactString(row.command || row.nextCommand);
    if (!command || command === "observe") return;
    const capability = compactString(row.capability || row.action);
    const stepName = compactString(row.stepName || row.step);
    const phase = compactString(row.phase || "recover");
    const dedupeKey = [
      command,
      phase,
      capability,
      stepName,
      compactString(row.reason),
    ].join("|");
    if (rows.some((existing) => existing.dedupeKey === dedupeKey)) return;

    rows.push(Object.freeze({
      dedupeKey,
      command,
      commandId: firstString(row.commandId, `${restartToken || "restart:missing"}:${commandKey || "commands"}:${phase}:${command}:${capability || stepName || "job"}`),
      phase,
      jobName,
      capability,
      stepName,
      state: compactString(row.state || (row.blocking ? "blocked" : "ready")),
      blocking: row.blocking === true,
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 5,
      reason: compactString(row.reason || "Runtime recovery command is required before adapter handoff."),
      nextCommand: compactString(row.nextCommand || command),
      retryAfterMs: Number.isFinite(Number(row.retryAfterMs)) ? Number(row.retryAfterMs) : 0,
      statusChannel: firstString(row.statusChannel, statusChannel),
      statusSnapshotKey: firstString(row.statusSnapshotKey, statusSnapshotKey),
      restartToken,
      idempotencyKey: firstString(row.idempotencyKey, persistedState.idempotencyKey, runtimeScope.idempotencyKey),
      replayKey: compactString(row.replayKey),
      replayPolicy: compactString(row.replayPolicy || "dedupe-by-command-id"),
      safeToReplay: row.safeToReplay === true,
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean).sort()),
      userVisible: Object.freeze({
        label: compactString(row.label || command.replace(/_/g, " ")),
        blocking: row.blocking === true,
        handoff: compactString(row.handoff || (phase.includes("adapter") || capability ? "adapter" : "runtime")),
      }),
    }));
  };

  for (const action of toArray(boundaryHealth.nextActions)) {
    const command = compactString(action.command);
    const requiredPermissions = toArray(action.requiredPermissions);
    const leaseTokens = toArray(action.leaseTokens);
    pushRow({
      command,
      phase: command === "refresh_mailchimp_permission_lease" ? "permission-lease" : "boundary",
      state: "blocked",
      blocking: true,
      priority: command === "attach_client_runtime_request" ? 12 : command === "refresh_mailchimp_permission_lease" ? 11 : 10,
      reason: action.reason,
      retryAfterMs: command === "refresh_mailchimp_permission_lease" ? 1000 : 0,
      blockedBy: [
        ...requiredPermissions.map((permission) => `missing-permission:${permission}`),
        ...leaseTokens.map((token) => `lease:${token}`),
        command,
      ],
    });
  }

  for (const row of toArray(workspaceBoundaryReadiness.quarantinedRows)) {
    pushRow({
      command: row.nextCommand || workspaceBoundaryReadiness.nextStep?.command || "collect_workspace_boundary_approval",
      phase: "workspace-boundary",
      capability: row.action,
      state: "blocked",
      blocking: true,
      priority: 12,
      reason: "Mailchimp capability crosses a tenant/workspace boundary without complete approval evidence.",
      blockedBy: [
        "workspace-boundary-quarantined",
        ...toArray(row.blockedBy),
        row.transferToken && `transfer:${row.transferToken}`,
      ].filter(Boolean),
    });
  }

  for (const command of toArray(scopeLedger.commands)) {
    pushRow({
      command: command.command,
      commandId: command.commandId,
      phase: command.phase || "scope-ledger",
      capability: command.capability,
      stepName: command.stepName,
      state: command.state,
      blocking: command.blocking === true,
      priority: command.priority ?? 9,
      reason: command.reason || "Scope recovery command ledger requires this command before restart-safe handoff.",
      nextCommand: command.nextCommand,
      retryAfterMs: command.retryAfterMs,
      statusChannel: command.statusChannel,
      statusSnapshotKey: command.statusSnapshotKey,
      idempotencyKey: command.idempotencyKey,
      replayKey: command.replayKey,
      replayPolicy: command.replayPolicy,
      safeToReplay: command.safeToReplay,
      blockedBy: command.blockedBy,
      source: "scope-persisted-recovery-ledger",
    });
  }

  for (const row of toArray(adapterStatusReadiness.failures)) {
    pushRow({
      command: row.nextCommand || "inspect_adapter_failure",
      phase: "adapter-status",
      capability: row.capability,
      stepName: row.stepName,
      state: "blocked",
      blocking: true,
      priority: 13,
      reason: row.message || `Adapter status for "${row.capability || row.stepName}" is terminal.`,
      blockedBy: [row.state || "adapter-status-failed"],
    });
  }

  for (const row of toArray(adapterStatusReadiness.statusSnapshot?.blockedRows)) {
    pushRow({
      command: row.nextCommand || adapterStatusReadiness.statusSnapshot?.nextCommand || "materialize_adapter_status_snapshot",
      phase: "adapter-status",
      capability: row.capability,
      stepName: row.stepName,
      state: "blocked",
      blocking: true,
      priority: 9,
      reason: "Adapter status snapshot rows must be materialized before replay-safe handoff.",
      blockedBy: toArray(row.missing).map((missing) => `missing:${missing}`),
    });
  }

  if (adapterStatusReadiness.state === "needs-status-snapshot") {
    pushRow({
      command: adapterStatusReadiness.nextAction?.command || "load_adapter_status_snapshot",
      phase: "adapter-status",
      state: "blocked",
      blocking: true,
      priority: 8,
      reason: adapterStatusReadiness.nextAction?.reason || "Adapter status snapshot must be loaded before replay.",
      blockedBy: ["adapter-status-snapshot-missing"],
    });
  } else if (adapterStatusReadiness.state === "waiting-adapter") {
    pushRow({
      command: adapterStatusReadiness.nextAction?.command || "poll_adapter_status_channel",
      phase: "adapter-status",
      state: "waiting",
      priority: 4,
      reason: adapterStatusReadiness.nextAction?.reason || "Adapter status is pending.",
      retryAfterMs: 1000,
      blockedBy: ["adapter-status-pending"],
    });
  }

  for (const row of toArray(providerSyncReadiness.rows)) {
    if (row.state !== "blocked" && row.state !== "needs-provider-cursor") continue;
    pushRow({
      command: row.nextCommand || providerSyncReadiness.nextStep?.command || "repair_provider_sync_scope",
      phase: "provider-sync",
      capability: row.action,
      state: row.state === "blocked" ? "blocked" : "waiting",
      blocking: row.state === "blocked",
      priority: row.state === "blocked" ? 7 : 3,
      reason: row.state === "blocked"
        ? `Provider sync for "${row.action}" is missing restart-safe metadata.`
        : `Provider sync for "${row.action}" needs provider cursor confirmation.`,
      blockedBy: toArray(row.missing).map((missing) => `missing:${missing}`),
    });
  }

  for (const row of toArray(adapterHandoffReadiness.blockedRows)) {
    pushRow({
      command: row.command || adapterHandoffReadiness.nextStep?.command || "resolve_adapter_handoff_manifest",
      phase: "adapter-handoff",
      capability: row.action,
      state: "blocked",
      blocking: true,
      priority: 6,
      reason: "Adapter handoff manifest row is blocked by scope, status, sync, or restart guards.",
      blockedBy: row.blockedBy,
    });
  }

  for (const row of toArray(adapterHandoffReadiness.queueableRows)) {
    pushRow({
      command: row.command || "queue_adapter_handoff",
      commandId: row.commandId,
      phase: "adapter-handoff",
      capability: row.action,
      state: "ready",
      priority: 1,
      reason: `Adapter handoff row for "${row.action}" is queueable.`,
      idempotencyKey: row.runtime?.idempotencyKey,
      statusChannel: row.runtime?.statusChannel,
      statusSnapshotKey: row.runtime?.statusSnapshotKey,
    });
  }

  for (const command of toArray(persistedState.restartCommandManifest?.blockedCommands)) {
    pushRow({
      command: command.nextCommand || "attach_recovery_status_handoff",
      phase: command.phase || "restart",
      capability: command.capability,
      stepName: command.stepName,
      state: "blocked",
      blocking: true,
      priority: 10,
      reason: `Restart command "${command.command}" is missing persisted recovery state.`,
      blockedBy: toArray(command.missing).map((missing) => `missing:${missing}`),
    });
  }

  for (const command of toArray(persistedState.restartCommandManifest?.runnableCommands)) {
    pushRow({
      command: command.phase === "resume" ? "resume_adapter_step" : command.command,
      commandId: command.commandId,
      phase: command.phase || "restart",
      capability: command.capability,
      stepName: command.stepName,
      state: "ready",
      priority: 2,
      reason: `Restart command "${command.command}" is ready to run with persisted status state.`,
      idempotencyKey: command.idempotencyKey,
    });
  }

  const commands = rows
    .sort((left, right) => {
      if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;
      if (left.priority !== right.priority) return right.priority - left.priority;
      return left.command.localeCompare(right.command) || left.capability.localeCompare(right.capability) || left.stepName.localeCompare(right.stepName);
    })
    .map(({ dedupeKey, ...row }) => Object.freeze(row));
  const blocked = commands.filter((row) => row.blocking || row.state === "blocked");
  const ready = commands.filter((row) => row.state === "ready" && !row.blocking);
  const waiting = commands.filter((row) => row.state === "waiting");

  return Object.freeze({
    protocol: "aios.type-hints.recovery-command-graph.v1",
    jobName,
    state: blocked.length > 0
      ? "blocked"
      : ready.length > 0
        ? "ready"
        : waiting.length > 0
          ? "waiting"
          : "not-required",
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && (ready.some((row) => row.phase === "adapter-handoff") || adapterHandoffReadiness.acceptedForAdapter === true),
    restartToken,
    statusChannel,
    statusSnapshotKey,
    commands: freezeArray(commands),
    blockedCommands: freezeArray(blocked),
    readyCommands: freezeArray(ready),
    waitingCommands: freezeArray(waiting),
    persistedRecoveryLedger: scopeLedger.commands ? Object.freeze({
      protocol: "aios.type-hints.persisted-recovery-ledger-view.v1",
      state: compactString(scopeLedger.state || "not-required"),
      acceptedForReplay: scopeLedger.acceptedForReplay === true,
      commandLedgerKey: compactString(scopeLedger.commandLedgerKey),
      replayableCommands: freezeArray(toArray(scopeLedger.replayableCommands).map((command) => ({
        commandId: compactString(command.commandId),
        replayKey: compactString(command.replayKey),
        command: compactString(command.command),
        phase: compactString(command.phase),
        capability: compactString(command.capability),
        stepName: compactString(command.stepName),
        replayPolicy: compactString(command.replayPolicy),
        safeToReplay: command.safeToReplay === true,
      }))),
      counters: scopeLedger.counters || Object.freeze({
        commands: 0,
        blocked: 0,
        waiting: 0,
        ready: 0,
        replayable: 0,
      }),
    }) : null,
    counters: Object.freeze({
      commands: commands.length,
      blocked: blocked.length,
      ready: ready.length,
      waiting: waiting.length,
      persistedLedgerCommands: scopeLedger.counters?.commands ?? 0,
      persistedLedgerBlocked: scopeLedger.counters?.blocked ?? 0,
      persistedLedgerReplayable: scopeLedger.counters?.replayable ?? 0,
      adapterStatus: commands.filter((row) => row.phase === "adapter-status").length,
      providerSync: commands.filter((row) => row.phase === "provider-sync").length,
      permissionLease: commands.filter((row) => row.phase === "permission-lease").length,
      adapterHandoff: commands.filter((row) => row.phase === "adapter-handoff").length,
      restart: commands.filter((row) => row.phase === "restart" || row.phase === "resume").length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand
        || waiting[0]?.nextCommand
        || ready[0]?.nextCommand
        || "observe",
      reason: blocked.length > 0
        ? blocked[0].reason
        : waiting.length > 0
          ? waiting[0].reason
          : ready.length > 0
            ? ready[0].reason
            : "No recovery command is required.",
    }),
  });
}

function createPreviewDecisionReadiness(scope = {}, tenantBoundary = {}, persistedState = {}) {
  const preview = scope?.previewAcceptance || {};
  const matrix = preview.previewDecisionMatrix || {};
  const rows = toArray(matrix.rows);
  const blocked = toArray(matrix.blockedRows);
  const acceptance = toArray(matrix.acceptanceRows);
  const missingClientState = [
    ...toArray(matrix.missingClientState),
    ...toArray(preview.clientRuntimeRequirements?.missing),
  ].map(compactString).filter(Boolean);
  const uniqueMissing = [...new Set(missingClientState)].sort();
  const state = blocked.length > 0 || matrix.state === "blocked"
    ? "blocked"
    : uniqueMissing.length > 0 || matrix.state === "needs-client-runtime"
      ? "needs-client-runtime"
      : acceptance.length > 0 || matrix.state === "ready-for-acceptance"
        ? "ready-for-acceptance"
        : rows.length > 0 || preview.state
          ? "accepted"
          : "not-provided";

  return Object.freeze({
    protocol: "aios.type-hints.preview-decision-readiness.v1",
    state,
    acceptedForPreview: preview.acceptedForPreview !== false,
    acceptedForRuntime: blocked.length === 0 && uniqueMissing.length === 0,
    acceptedForAdapter: matrix.acceptedForAdapter === true
      && blocked.length === 0
      && uniqueMissing.length === 0
      && tenantBoundary.tenantScoped === true
      && tenantBoundary.actorScoped === true,
    statusChannel: firstString(matrix.rows?.[0]?.runtime?.statusChannel, persistedState.statusChannel, scope?.runtimeScope?.statusChannel),
    restartToken: firstString(matrix.rows?.[0]?.runtime?.restartToken, persistedState.restartToken, scope?.runtimeScope?.restartToken),
    statusSnapshotKey: firstString(matrix.rows?.[0]?.runtime?.statusSnapshotKey, persistedState.statusSnapshotKey, scope?.persistedRuntime?.statusSnapshotKey),
    missingClientState: freezeArray(uniqueMissing),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      kind: compactString(row.kind),
      name: compactString(row.name),
      state: compactString(row.state),
      lane: compactString(row.lane),
      command: compactString(row.command),
      nextCommand: compactString(row.nextCommand || "observe"),
      acceptanceToken: compactString(row.acceptanceToken),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      userVisible: row.userVisible || Object.freeze({
        label: compactString(row.name),
        blocking: row.state === "blocked",
        summary: "",
      }),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      rowId: compactString(row.rowId),
      kind: compactString(row.kind),
      name: compactString(row.name),
      lane: compactString(row.lane),
      nextCommand: compactString(row.nextCommand || row.command || "resolve_scope_preview"),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
    }))),
    acceptanceRows: freezeArray(acceptance.map((row) => ({
      rowId: compactString(row.rowId),
      kind: compactString(row.kind),
      name: compactString(row.name),
      lane: compactString(row.lane),
      acceptanceToken: compactString(row.acceptanceToken),
      nextCommand: compactString(row.nextCommand || "queue_scope_runtime_handoff"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      readyForAcceptance: acceptance.length,
      missingClientState: uniqueMissing.length,
      accepted: rows.filter((row) => compactString(row.state) === "accepted").length,
    }),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: "aios.types.preview_decision_blocked",
        severity: "error",
        message: `Preview row "${row.name}" is blocked before runtime handoff.`,
        nextCommand: row.nextCommand || row.command || "resolve_scope_preview",
      })),
      uniqueMissing.length > 0 && {
        code: "aios.types.preview_client_runtime_missing",
        severity: "warning",
        message: `Preview acceptance needs client runtime fields: ${uniqueMissing.join(", ")}.`,
        nextCommand: "attach_client_runtime_request",
      },
    ].filter(Boolean)),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand
        || (uniqueMissing.length > 0 ? "attach_client_runtime_request" : "")
        || acceptance[0]?.nextCommand
        || matrix.nextStep?.command
        || preview.nextStep?.command
        || "observe",
      reason: blocked.length > 0
        ? "Preview decision rows are blocked by diagnostics or boundary holds."
        : uniqueMissing.length > 0
          ? "Client runtime state is required before preview rows can be adopted."
          : acceptance.length > 0
            ? "Preview decision rows are ready to accept into runtime handoff."
            : "Preview decision rows are accepted for typed runtime adoption.",
    }),
  });
}

function createPreviewAcceptanceReceiptReadiness(scope = {}, tenantBoundary = {}, persistedState = {}) {
  const preview = scope?.previewAcceptance || {};
  const receipts = preview.acceptanceReceipts || {};
  const rows = toArray(receipts.rows);
  const missingRows = toArray(receipts.missingRows);
  const rejectedRows = toArray(receipts.rejectedRows);
  const expiredRows = toArray(receipts.expiredRows);
  const acceptedRows = toArray(receipts.acceptedRows);
  const blockedRows = [...rejectedRows, ...expiredRows];
  const waitingRows = missingRows.filter((row) => compactString(row.state) !== "missing" || !toArray(row.missing).includes("receipt"));
  const state = blockedRows.length > 0
    ? "blocked"
    : missingRows.length > 0
      ? "needs-acceptance"
      : rows.length > 0
        ? "accepted"
        : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.preview-acceptance-receipts-readiness.v1",
    state,
    acceptedForPreview: true,
    acceptedForRuntime: blockedRows.length === 0,
    acceptedForAdapter: receipts.acceptedForAdapter === true
      && blockedRows.length === 0
      && missingRows.length === 0
      && tenantBoundary.tenantScoped === true
      && tenantBoundary.actorScoped === true,
    statusChannel: firstString(rows[0]?.statusChannel, persistedState.statusChannel, scope?.runtimeScope?.statusChannel),
    restartToken: firstString(scope?.runtimeScope?.restartToken, persistedState.restartToken),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      kind: compactString(row.kind),
      name: compactString(row.name),
      state: compactString(row.state),
      acceptanceToken: compactString(row.acceptanceToken),
      receiptToken: compactString(row.receiptToken),
      acceptedBy: compactString(row.acceptedBy),
      acceptedAt: compactString(row.acceptedAt),
      expiresAt: compactString(row.expiresAt),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    blockedRows: freezeArray(blockedRows.map((row) => ({
      rowId: compactString(row.rowId),
      kind: compactString(row.kind),
      name: compactString(row.name),
      state: compactString(row.state),
      receiptToken: compactString(row.receiptToken),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "refresh_scope_preview_acceptance"),
    }))),
    missingRows: freezeArray(missingRows.map((row) => ({
      rowId: compactString(row.rowId),
      kind: compactString(row.kind),
      name: compactString(row.name),
      acceptanceToken: compactString(row.acceptanceToken),
      receiptToken: compactString(row.receiptToken),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "accept_scope_preview_row"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      accepted: acceptedRows.length,
      missing: missingRows.length,
      rejected: rejectedRows.length,
      expired: expiredRows.length,
      waiting: waitingRows.length,
    }),
    validationItems: freezeArray([
      ...blockedRows.map((row) => ({
        code: "aios.types.preview_acceptance_receipt_blocked",
        severity: "error",
        message: `Preview acceptance receipt for "${row.name}" is ${row.state}.`,
        nextCommand: row.nextCommand || "refresh_scope_preview_acceptance",
      })),
      ...missingRows.map((row) => ({
        code: "aios.types.preview_acceptance_receipt_missing",
        severity: "warning",
        message: `Preview row "${row.name}" needs a client acceptance receipt before Mailchimp adapter handoff.`,
        nextCommand: row.nextCommand || "accept_scope_preview_row",
      })),
    ]),
    nextStep: Object.freeze({
      command: blockedRows[0]?.nextCommand
        || missingRows[0]?.nextCommand
        || receipts.nextStep?.command
        || "observe",
      reason: blockedRows.length > 0
        ? "Preview acceptance receipts contain rejected or expired rows."
        : missingRows.length > 0
          ? "Mailchimp adapter preview rows need client acceptance receipts."
          : rows.length > 0
            ? "Preview acceptance receipts are ready for typed runtime adoption."
            : "No preview acceptance receipt is required.",
    }),
  });
}

function createClientCommandReceiptReadiness(scope = {}, persistedState = {}, tenantBoundary = {}) {
  const ledger = scope?.clientCommandReceipts || {};
  const rows = toArray(ledger.rows);
  const blocked = toArray(ledger.blockedRows);
  const accepted = toArray(ledger.acceptedRows);
  const state = blocked.length > 0
    ? "blocked"
    : rows.length > 0
      ? "accepted"
      : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.client-command-receipt-readiness.v1",
    state,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: ledger.acceptedForAdapter !== false
      && blocked.length === 0
      && tenantBoundary.tenantScoped !== false
      && tenantBoundary.actorScoped !== false,
    restartToken: firstString(ledger.restartToken, persistedState.restartToken, scope?.runtimeScope?.restartToken),
    statusChannel: firstString(ledger.statusChannel, persistedState.statusChannel, scope?.runtimeScope?.statusChannel),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      command: compactString(row.command),
      commandId: compactString(row.commandId),
      phase: compactString(row.phase),
      capability: compactString(row.capability),
      stepName: compactString(row.stepName),
      required: row.required === true,
      state: compactString(row.state),
      receiptToken: compactString(row.receiptToken),
      receiptStatus: compactString(row.receiptStatus),
      tenantId: compactString(row.tenantId),
      workspaceId: compactString(row.workspaceId),
      requestId: compactString(row.requestId),
      actorId: compactString(row.actorId),
      acceptedAt: compactString(row.acceptedAt),
      expiresAt: compactString(row.expiresAt),
      statusChannel: compactString(row.statusChannel),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      rowId: compactString(row.rowId),
      command: compactString(row.command),
      commandId: compactString(row.commandId),
      phase: compactString(row.phase),
      capability: compactString(row.capability),
      stepName: compactString(row.stepName),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "attach_client_command_receipt"),
    }))),
    acceptedRows: freezeArray(accepted.map((row) => ({
      command: compactString(row.command),
      commandId: compactString(row.commandId),
      capability: compactString(row.capability),
      receiptToken: compactString(row.receiptToken),
      acceptedAt: compactString(row.acceptedAt),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      accepted: accepted.length,
      blocked: blocked.length,
      missing: ledger.counters?.missing ?? blocked.filter((row) => toArray(row.missing).includes("receipt")).length,
      mismatched: ledger.counters?.mismatched ?? blocked.filter((row) => toArray(row.missing).includes("runtimeIdentity")).length,
      expired: ledger.counters?.expired ?? blocked.filter((row) => toArray(row.missing).includes("expiresAt")).length,
    }),
    validationItems: freezeArray(blocked.map((row) => ({
      code: "aios.types.client_command_receipt_blocked",
      severity: "error",
      message: `Client command receipt for "${row.command}" is required before Mailchimp runtime handoff.`,
      nextCommand: row.nextCommand || "attach_client_command_receipt",
    }))),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || ledger.nextStep?.command || "observe",
      reason: blocked.length > 0
        ? "Client command receipts are missing, stale, or scoped to the wrong runtime identity."
        : rows.length > 0
          ? "Client command receipts are accepted for typed runtime adoption."
          : "No client command receipt is required.",
    }),
  });
}

function createPreviewActionPlanReadiness(scope = {}, persistedState = {}, tenantBoundary = {}) {
  const plan = scope?.previewActionPlan || {};
  const rows = toArray(plan.rows);
  const blocked = toArray(plan.blockedRows).length > 0
    ? toArray(plan.blockedRows)
    : rows.filter((row) => ["blocked", "adapter-blocked", "rejected", "expired"].includes(compactString(row.state)));
  const acceptance = toArray(plan.acceptanceRows).length > 0
    ? toArray(plan.acceptanceRows)
    : rows.filter((row) => compactString(row.state) === "needs-acceptance");
  const ready = toArray(plan.readyRows).length > 0
    ? toArray(plan.readyRows)
    : rows.filter((row) => compactString(row.state) === "accepted");
  const identityMissing = rows.filter((row) => {
    const missing = toArray(row.missing).map(compactString);
    return missing.includes("tenantId") || missing.includes("workspaceId") || missing.includes("requestId") || missing.includes("statusChannel");
  });
  const restartMissing = rows.filter((row) => toArray(row.missing).map(compactString).includes("idempotencyKey"));
  const state = blocked.length > 0
    ? "blocked"
    : acceptance.length > 0
      ? "needs-acceptance"
      : ready.length > 0
        ? "accepted"
        : rows.length > 0
          ? "preview-only"
          : "not-required";
  const acceptedForRuntime = blocked.length === 0
    && identityMissing.length === 0
    && restartMissing.length === 0;
  const acceptedForAdapter = acceptedForRuntime
    && acceptance.length === 0
    && plan.acceptedForAdapter !== false;

  return Object.freeze({
    protocol: "aios.type-hints.preview-action-plan-readiness.v1",
    state,
    acceptedForPreview: plan.acceptedForPreview !== false,
    acceptedForRuntime,
    acceptedForAdapter,
    tenantId: firstString(tenantBoundary.tenantId, scope?.runtimeScope?.tenantId, persistedState.tenantId),
    workspaceId: firstString(tenantBoundary.workspaceId, scope?.runtimeScope?.workspaceId, persistedState.workspaceId),
    statusChannel: firstString(plan.statusChannel, persistedState.statusChannel, scope?.runtimeScope?.statusChannel),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      jobName: compactString(row.jobName || scope?.jobName),
      kind: compactString(row.kind),
      name: compactString(row.name),
      lane: compactString(row.lane),
      state: compactString(row.state),
      command: compactString(row.command || row.nextCommand),
      acceptanceToken: compactString(row.acceptanceToken),
      receiptToken: compactString(row.receiptToken),
      commandId: compactString(row.commandId),
      acceptedForRuntime: row.acceptedForRuntime === true,
      acceptedForAdapter: row.acceptedForAdapter === true,
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      userVisible: row.userVisible || Object.freeze({
        label: compactString(row.name || "preview"),
        severity: compactString(row.state) === "accepted" ? "info" : "warning",
        blocking: compactString(row.state) !== "accepted",
        summary: "",
      }),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      rowId: compactString(row.rowId),
      name: compactString(row.name),
      state: compactString(row.state),
      command: compactString(row.command || row.nextCommand || "resolve_scope_preview"),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      userVisible: row.userVisible || null,
    }))),
    acceptanceRows: freezeArray(acceptance.map((row) => ({
      rowId: compactString(row.rowId),
      name: compactString(row.name),
      acceptanceToken: compactString(row.acceptanceToken),
      command: compactString(row.command || row.nextCommand || "accept_scope_preview_row"),
      userVisible: row.userVisible || null,
    }))),
    readyRows: freezeArray(ready.map((row) => ({
      rowId: compactString(row.rowId),
      name: compactString(row.name),
      commandId: compactString(row.commandId),
      command: compactString(row.command || row.nextCommand || "queue_scope_runtime_handoff"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      needsAcceptance: acceptance.length,
      accepted: ready.length,
      identityMissing: identityMissing.length,
      restartMissing: restartMissing.length,
    }),
    validationItems: freezeArray([
      ...blocked.map((row) => ({
        code: "aios.types.preview_action_plan_blocked",
        severity: "error",
        message: `Preview action "${compactString(row.name)}" is blocked before runtime handoff.`,
        nextCommand: row.command || row.nextCommand || "resolve_scope_preview",
      })),
      ...acceptance.map((row) => ({
        code: "aios.types.preview_action_plan_acceptance_required",
        severity: "warning",
        message: `Preview action "${compactString(row.name)}" needs client acceptance before Mailchimp adapter handoff.`,
        nextCommand: row.command || row.nextCommand || "accept_scope_preview_row",
      })),
      ...identityMissing.map((row) => ({
        code: "aios.types.preview_action_plan_runtime_identity_missing",
        severity: "error",
        message: `Preview action "${compactString(row.name)}" is missing runtime identity for typed handoff.`,
        nextCommand: "attach_client_runtime_request",
      })),
      ...restartMissing.map((row) => ({
        code: "aios.types.preview_action_plan_idempotency_missing",
        severity: "error",
        message: `Preview action "${compactString(row.name)}" is missing an idempotency key for restart-safe handoff.`,
        nextCommand: "attach_recovery_status_handoff",
      })),
    ]),
    nextStep: Object.freeze({
      command: blocked[0]?.command
        || acceptance[0]?.command
        || identityMissing[0]?.command
        || restartMissing[0]?.command
        || ready[0]?.command
        || plan.nextStep?.command
        || "observe",
      reason: blocked.length > 0
        ? "Preview action plan has blocked rows that must be repaired before typed runtime adoption."
        : acceptance.length > 0
          ? "Preview action plan is waiting for explicit client acceptance."
          : identityMissing.length > 0
            ? "Preview action plan needs tenant, workspace, request, and status channel identity."
            : restartMissing.length > 0
              ? "Preview action plan needs restart-safe idempotency metadata."
              : ready.length > 0
                ? "Preview action plan is accepted for typed runtime handoff."
                : "No preview action plan is required.",
    }),
  });
}

function createClientRuntimeAdoptionContract(job = {}, hints = [], scope = {}, persistedState = {}, tenantBoundary = {}, boundaryHealth = {}) {
  const preview = scope?.previewAcceptance || {};
  const operatorReview = preview.operatorReview || {};
  const runtimeScope = scope?.runtimeScope || {};
  const persistedRuntime = scope?.persistedRuntime || {};
  const runtimeHandoff = scope?.runtimeHandoff || {};
  const clientWorkflowHandoff = scope?.clientWorkflowHandoff || {};
  const adapterStatusReadiness = createAdapterStatusReadiness(scope, hints);
  const providerSyncReadiness = createProviderSyncReadiness(scope, persistedState);
  const segmentSyncReceiptReadiness = createSegmentSyncReceiptReadiness(scope);
  const providerBudgetReadiness = createProviderBudgetReadiness(scope);
  const settingsAdoptionReadiness = createSettingsAdoptionReadiness(scope);
  const lifecycleGateReadiness = createLifecycleGateReadiness(scope);
  const providerMaintenanceReadiness = createProviderMaintenanceReadiness(scope);
  const adapterHandoffReadiness = createAdapterHandoffReadiness(scope, hints, persistedState);
  const workspaceBoundaryReadiness = createWorkspaceBoundaryReadiness(scope);
  const previewDecisionReadiness = createPreviewDecisionReadiness(scope, tenantBoundary, persistedState);
  const previewAcceptanceReceiptReadiness = createPreviewAcceptanceReceiptReadiness(scope, tenantBoundary, persistedState);
  const previewActionPlanReadiness = createPreviewActionPlanReadiness(scope, persistedState, tenantBoundary);
  const clientCommandReceiptReadiness = createClientCommandReceiptReadiness(scope, persistedState, tenantBoundary);
  const recoveryCommandGraph = createRecoveryCommandGraph(job, hints, scope, persistedState, boundaryHealth, adapterStatusReadiness, providerSyncReadiness, adapterHandoffReadiness);
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const durableMemory = hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount");
  const missingClientState = [
    ...toArray(preview.clientRuntimeRequirements?.missing),
    providerCapabilities.length > 0 && !tenantBoundary.tenantId && "tenantId",
    providerCapabilities.length > 0 && !tenantBoundary.workspaceId && "workspaceId",
    adapterSteps.length > 0 && !tenantBoundary.actorId && "actorId",
    adapterSteps.length > 0 && !persistedState.statusChannel && "statusChannel",
    adapterSteps.length > 0 && !persistedState.idempotencyKey && "idempotencyKey",
  ].map(compactString).filter(Boolean);
  const uniqueMissing = [...new Set(missingClientState)].sort();
  const validationItems = [
    ...toArray(preview.validationItems).map((item) => ({
      code: compactString(item.code || "aios.types.scope_preview_validation"),
      severity: compactString(item.severity || "warning"),
      message: compactString(item.message),
      nextCommand: compactString(item.nextCommand || preview.nextStep?.command || "resolve_scope_preview"),
    })),
    ...toArray(boundaryHealth.nextActions).map((action) => ({
      code: `aios.types.${compactString(action.command || "boundary_next_action")}`,
      severity: boundaryHealth.state === "blocked" ? "error" : "warning",
      message: compactString(action.reason),
      nextCommand: compactString(action.command),
    })),
    adapterStatusReadiness.state === "blocked" && {
      code: "aios.types.adapter_status_failed",
      severity: "error",
      message: "Adapter status contains failed provider records.",
      nextCommand: adapterStatusReadiness.nextAction.command,
    },
    adapterStatusReadiness.state === "needs-status-snapshot" && {
      code: "aios.types.adapter_status_snapshot_missing",
      severity: "warning",
      message: "Adapter status snapshot is required before replay-safe handoff.",
      nextCommand: adapterStatusReadiness.nextAction.command,
    },
    adapterHandoffReadiness.state === "blocked" && {
      code: "aios.types.adapter_handoff_blocked",
      severity: "error",
      message: "Adapter handoff manifest has blocking scope, restart, or provider guards.",
      nextCommand: adapterHandoffReadiness.nextStep.command,
    },
    ...toArray(clientCommandReceiptReadiness.validationItems),
    workspaceBoundaryReadiness.state === "quarantined" && {
      code: "aios.types.workspace_boundary_quarantined",
      severity: "error",
      message: "Workspace boundary transfer must be approved before adapter handoff.",
      nextCommand: workspaceBoundaryReadiness.nextStep.command,
    },
    ...toArray(previewDecisionReadiness.validationItems),
    ...toArray(previewAcceptanceReceiptReadiness.validationItems),
    ...toArray(previewActionPlanReadiness.validationItems),
    ...toArray(providerSyncReadiness.validationItems),
    ...toArray(lifecycleGateReadiness.validationItems),
    ...toArray(providerMaintenanceReadiness.validationItems),
    ...toArray(clientWorkflowHandoff.blockedCommands).map((command) => ({
      code: `aios.types.workflow.${compactString(command.command || "blocked")}`,
      severity: "error",
      message: compactString(command.reason || "Client workflow command is blocked."),
      nextCommand: compactString(command.nextCommand || command.command || "resolve_runtime_readiness"),
    })),
  ].filter(Boolean);
  const blockingValidation = validationItems.filter((item) => item.severity === "error");
  const state = blockingValidation.length > 0 || boundaryHealth.state === "blocked" || preview.state === "blocked"
    ? "blocked"
    : uniqueMissing.length > 0
      || previewDecisionReadiness.state === "needs-client-runtime"
      || previewAcceptanceReceiptReadiness.state === "needs-acceptance"
      || previewActionPlanReadiness.state === "needs-acceptance"
      || preview.state === "preview-only"
      || boundaryHealth.state === "degraded"
      ? "needs-client-state"
      : adapterSteps.length > 0 || providerCapabilities.length > 0
        ? "ready-for-adapter"
        : "local-ready";
  const restartSafe = persistedState.restartStatus !== "restart-blocked"
    && adapterSteps.every((hint) => hint.runtimeShape.restartSafe !== false);

  return Object.freeze({
    protocol: "aios.type-hints.client-runtime-adoption.v1",
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    state,
    acceptedForPreview: preview.acceptedForPreview !== false,
    acceptedForRuntime: state === "local-ready" || state === "ready-for-adapter",
    acceptedForAdapter: state === "ready-for-adapter"
      && boundaryHealth.acceptedForAdapter === true
      && preview.acceptedForAdapter !== false
      && previewDecisionReadiness.acceptedForRuntime === true
      && previewAcceptanceReceiptReadiness.acceptedForAdapter === true
      && previewActionPlanReadiness.acceptedForAdapter === true
      && clientCommandReceiptReadiness.acceptedForAdapter === true
      && providerSyncReadiness.acceptedForAdapter === true
      && lifecycleGateReadiness.acceptedForAdapter === true
      && providerMaintenanceReadiness.acceptedForAdapter === true
      && restartSafe,
    runtimeIdentity: Object.freeze({
      tenantId: firstString(tenantBoundary.tenantId, runtimeScope.tenantId),
      workspaceId: firstString(tenantBoundary.workspaceId, runtimeScope.workspaceId),
      actorId: firstString(tenantBoundary.actorId, runtimeScope.userId),
      requestId: firstString(runtimeScope.requestId, runtimeHandoff.requestId),
      statusChannel: firstString(persistedState.statusChannel, runtimeScope.statusChannel),
      idempotencyKey: firstString(persistedState.idempotencyKey, runtimeScope.idempotencyKey),
      restartToken: firstString(persistedState.restartToken, runtimeScope.restartToken),
    }),
    persistedKeys: Object.freeze({
      storageKey: firstString(persistedState.storageKey, persistedRuntime.storageKey),
      commandKey: firstString(persistedState.commandKey, persistedRuntime.commandLedgerKey),
      resumeCursorKey: firstString(persistedState.resumeCursorKey, persistedRuntime.resumeCursorKey),
      statusSnapshotKey: firstString(persistedState.statusSnapshotKey, persistedRuntime.statusSnapshotKey),
    }),
    workflow: Object.freeze({
      missingClientState: freezeArray(uniqueMissing),
      validationItems: freezeArray(validationItems),
      restartSafe,
      clientWorkflowState: compactString(clientWorkflowHandoff.state || "not-provided"),
      clientWorkflowCommands: clientWorkflowHandoff.commands || freezeArray([]),
      blockedWorkflowCommands: clientWorkflowHandoff.blockedCommands || freezeArray([]),
      readyWorkflowCommands: clientWorkflowHandoff.readyCommands || freezeArray([]),
      restartCommandManifest: persistedState.restartCommandManifest || null,
      requiredAuditEvents: tenantBoundary.requiredAuditEvents || freezeArray([]),
      adapterStatusReadiness,
      providerSyncReadiness,
      lifecycleGateReadiness,
      providerMaintenanceReadiness,
      adapterHandoffReadiness,
      workspaceBoundaryReadiness,
      previewDecisionReadiness,
      previewAcceptanceReceiptReadiness,
      previewActionPlanReadiness,
      clientCommandReceiptReadiness,
      recoveryCommandGraph,
      requiredRuntimeShapes: freezeArray([
        ...providerCapabilities.map((hint) => `${hint.name}:ProviderCapability`),
        ...adapterSteps.map((hint) => `${hint.name}:AdapterEffectStep`),
        ...durableMemory.map((hint) => `${hint.name}:DurableMemoryMount`),
      ]),
      operatorReview: Object.freeze({
        state: compactString(operatorReview.state || "not-provided"),
        acceptedForClientRuntime: operatorReview.acceptedForClientRuntime === true,
        acceptedForAdapter: operatorReview.acceptedForAdapter === true,
        nextCommand: compactString(operatorReview.nextStep?.command || ""),
        lanes: freezeArray(toArray(operatorReview.lanes).map((lane) => ({
          lane: compactString(lane.lane),
          state: compactString(lane.state),
          count: Number.isInteger(lane.count) ? lane.count : 0,
          nextCommand: compactString(lane.nextCommand),
        }))),
      }),
      previewDecision: Object.freeze({
        state: previewDecisionReadiness.state,
        acceptedForRuntime: previewDecisionReadiness.acceptedForRuntime,
        acceptedForAdapter: previewDecisionReadiness.acceptedForAdapter,
        blockedRows: previewDecisionReadiness.blockedRows,
        acceptanceRows: previewDecisionReadiness.acceptanceRows,
        nextCommand: previewDecisionReadiness.nextStep.command,
      }),
      previewAcceptanceReceipts: Object.freeze({
        state: previewAcceptanceReceiptReadiness.state,
        acceptedForRuntime: previewAcceptanceReceiptReadiness.acceptedForRuntime,
        acceptedForAdapter: previewAcceptanceReceiptReadiness.acceptedForAdapter,
        rows: previewAcceptanceReceiptReadiness.rows,
        blockedRows: previewAcceptanceReceiptReadiness.blockedRows,
        missingRows: previewAcceptanceReceiptReadiness.missingRows,
        counters: previewAcceptanceReceiptReadiness.counters,
        nextCommand: previewAcceptanceReceiptReadiness.nextStep.command,
      }),
      previewActionPlan: Object.freeze({
        state: previewActionPlanReadiness.state,
        acceptedForRuntime: previewActionPlanReadiness.acceptedForRuntime,
        acceptedForAdapter: previewActionPlanReadiness.acceptedForAdapter,
        rows: previewActionPlanReadiness.rows,
        blockedRows: previewActionPlanReadiness.blockedRows,
        acceptanceRows: previewActionPlanReadiness.acceptanceRows,
        counters: previewActionPlanReadiness.counters,
        nextCommand: previewActionPlanReadiness.nextStep.command,
      }),
      clientCommandReceipts: Object.freeze({
        state: clientCommandReceiptReadiness.state,
        acceptedForRuntime: clientCommandReceiptReadiness.acceptedForRuntime,
        acceptedForAdapter: clientCommandReceiptReadiness.acceptedForAdapter,
        rows: clientCommandReceiptReadiness.rows,
        blockedRows: clientCommandReceiptReadiness.blockedRows,
        counters: clientCommandReceiptReadiness.counters,
        nextCommand: clientCommandReceiptReadiness.nextStep.command,
      }),
    }),
    preview: Object.freeze({
      state: compactString(preview.state || "not-provided"),
      title: compactString(preview.title || job.name || "AI OS type preview"),
      cards: preview.cards || freezeArray([]),
      validationSummary: preview.validationSummary || Object.freeze({
        errors: blockingValidation.length,
        warnings: validationItems.filter((item) => item.severity === "warning").length,
      }),
    }),
    nextStep: Object.freeze({
      command: blockingValidation[0]?.nextCommand
        || (previewDecisionReadiness.state === "blocked" ? previewDecisionReadiness.nextStep.command : "")
        || (previewAcceptanceReceiptReadiness.state === "blocked" || previewAcceptanceReceiptReadiness.state === "needs-acceptance" ? previewAcceptanceReceiptReadiness.nextStep.command : "")
        || (previewActionPlanReadiness.state === "blocked" || previewActionPlanReadiness.state === "needs-acceptance" ? previewActionPlanReadiness.nextStep.command : "")
        || (clientCommandReceiptReadiness.state === "blocked" ? clientCommandReceiptReadiness.nextStep.command : "")
        || (recoveryCommandGraph.state === "blocked" ? recoveryCommandGraph.nextStep.command : "")
        || clientWorkflowHandoff.nextStep?.command
        || (adapterHandoffReadiness.state === "waiting" ? adapterHandoffReadiness.nextStep.command : "")
        || (workspaceBoundaryReadiness.state === "audit-required" ? workspaceBoundaryReadiness.nextStep.command : "")
        || (providerMaintenanceReadiness.state === "blocked" ? providerMaintenanceReadiness.nextStep.command : "")
        || (lifecycleGateReadiness.state === "blocked" ? lifecycleGateReadiness.nextStep.command : "")
        || (providerSyncReadiness.state === "needs-provider-confirmation" ? providerSyncReadiness.nextStep.command : "")
        || (uniqueMissing.length > 0 ? "attach_client_runtime_request" : "")
        || preview.nextStep?.command
        || (state === "ready-for-adapter" ? "queue_adapter_handoff" : "observe"),
      reason: blockingValidation.length > 0
        ? "Type adoption is blocked by scope or boundary validation."
        : previewDecisionReadiness.state === "blocked"
          ? previewDecisionReadiness.nextStep.reason
        : previewAcceptanceReceiptReadiness.state === "blocked" || previewAcceptanceReceiptReadiness.state === "needs-acceptance"
          ? previewAcceptanceReceiptReadiness.nextStep.reason
        : previewActionPlanReadiness.state === "blocked" || previewActionPlanReadiness.state === "needs-acceptance"
          ? previewActionPlanReadiness.nextStep.reason
        : clientCommandReceiptReadiness.state === "blocked"
          ? clientCommandReceiptReadiness.nextStep.reason
        : recoveryCommandGraph.state === "blocked"
          ? recoveryCommandGraph.nextStep.reason
        : clientWorkflowHandoff.nextStep?.reason
          ? clientWorkflowHandoff.nextStep.reason
        : adapterHandoffReadiness.state === "waiting"
          ? adapterHandoffReadiness.nextStep.reason
        : workspaceBoundaryReadiness.state === "audit-required"
          ? workspaceBoundaryReadiness.nextStep.reason
        : providerMaintenanceReadiness.state === "blocked"
          ? providerMaintenanceReadiness.nextStep.reason
        : lifecycleGateReadiness.state === "blocked"
          ? lifecycleGateReadiness.nextStep.reason
        : providerSyncReadiness.state === "needs-provider-confirmation"
          ? providerSyncReadiness.nextStep.reason
        : uniqueMissing.length > 0
          ? "Client runtime state must be attached before adapter handoff."
          : state === "ready-for-adapter"
            ? "Typed runtime shapes are ready for Mailchimp adapter handoff."
            : "Typed runtime shapes are ready for local execution.",
    }),
  });
}

function createRuntimeReadinessPacket(job = {}, hints = [], scope = {}, persistedState = {}, tenantBoundary = {}, boundaryHealth = {}, clientRuntimeAdoption = {}) {
  const jobName = compactString(job.name || scope?.jobName || "anonymous");
  const preview = scope?.previewAcceptance || {};
  const operatorReview = preview.operatorReview || {};
  const manifest = persistedState.restartCommandManifest || {};
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const durableMemory = hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount");
  const blockedCommands = toArray(manifest.blockedCommands);
  const blockedWorkflowCommands = toArray(clientRuntimeAdoption.workflow?.blockedWorkflowCommands);
  const readyWorkflowCommands = toArray(clientRuntimeAdoption.workflow?.readyWorkflowCommands);
  const missingClientState = toArray(clientRuntimeAdoption.workflow?.missingClientState);
  const reviewLanes = toArray(operatorReview.lanes);
  const auditEvents = toArray(tenantBoundary.requiredAuditEvents);
  const adapterStatusReadiness = createAdapterStatusReadiness(scope, hints);
  const providerSyncReadiness = createProviderSyncReadiness(scope, persistedState);
  const providerBudgetReadiness = createProviderBudgetReadiness(scope);
  const providerCallbackReadiness = createProviderCallbackReadiness(scope);
  const providerMaintenanceReadiness = createProviderMaintenanceReadiness(scope);
  const lifecycleGateReadiness = clientRuntimeAdoption.workflow?.lifecycleGateReadiness || createLifecycleGateReadiness(scope);
  const adapterHandoffReadiness = createAdapterHandoffReadiness(scope, hints, persistedState);
  const workspaceBoundaryReadiness = clientRuntimeAdoption.workflow?.workspaceBoundaryReadiness || createWorkspaceBoundaryReadiness(scope);
  const previewDecisionReadiness = clientRuntimeAdoption.workflow?.previewDecisionReadiness
    || createPreviewDecisionReadiness(scope, tenantBoundary, persistedState);
  const previewAcceptanceReceiptReadiness = clientRuntimeAdoption.workflow?.previewAcceptanceReceiptReadiness
    || createPreviewAcceptanceReceiptReadiness(scope, tenantBoundary, persistedState);
  const previewActionPlanReadiness = clientRuntimeAdoption.workflow?.previewActionPlanReadiness
    || createPreviewActionPlanReadiness(scope, persistedState, tenantBoundary);
  const clientCommandReceiptReadiness = clientRuntimeAdoption.workflow?.clientCommandReceiptReadiness
    || createClientCommandReceiptReadiness(scope, persistedState, tenantBoundary);
  const recoveryCommandGraph = clientRuntimeAdoption.workflow?.recoveryCommandGraph
    || createRecoveryCommandGraph(job, hints, scope, persistedState, boundaryHealth, adapterStatusReadiness, providerSyncReadiness, adapterHandoffReadiness);
  const blockingReasons = [
    clientRuntimeAdoption.state === "blocked" && "client-runtime-blocked",
    boundaryHealth.state === "blocked" && "boundary-health-blocked",
    adapterStatusReadiness.state === "blocked" && "adapter-status-failed",
    providerSyncReadiness.state === "blocked" && "provider-sync-blocked",
    providerCallbackReadiness.state === "blocked" && "provider-callback-blocked",
    providerMaintenanceReadiness.state === "blocked" && "provider-maintenance-blocked",
    lifecycleGateReadiness.state === "blocked" && "lifecycle-gate-blocked",
    adapterHandoffReadiness.state === "blocked" && "adapter-handoff-blocked",
    workspaceBoundaryReadiness.state === "quarantined" && "workspace-boundary-quarantined",
    previewDecisionReadiness.state === "blocked" && "preview-decision-blocked",
    previewAcceptanceReceiptReadiness.state === "blocked" && "preview-acceptance-receipt-blocked",
    previewAcceptanceReceiptReadiness.state === "needs-acceptance" && "preview-acceptance-receipt-missing",
    previewActionPlanReadiness.state === "blocked" && "preview-action-plan-blocked",
    previewActionPlanReadiness.state === "needs-acceptance" && "preview-action-plan-needs-acceptance",
    clientCommandReceiptReadiness.state === "blocked" && "client-command-receipt-blocked",
    recoveryCommandGraph.state === "blocked" && "recovery-command-graph-blocked",
    operatorReview.state === "blocked" && "scope-preview-blocked",
    manifest.state === "blocked" && "restart-command-manifest-blocked",
    blockedWorkflowCommands.length > 0 && "client-workflow-command-blocked",
    tenantBoundary.violations?.length > 0 && "tenant-boundary-violations",
    missingClientState.length > 0 && "missing-client-runtime-state",
  ].filter(Boolean);
  const acceptanceState = blockingReasons.length > 0
    ? "blocked"
    : clientRuntimeAdoption.acceptedForAdapter === true && operatorReview.acceptedForAdapter === true
      ? "adapter-ready"
      : clientRuntimeAdoption.acceptedForRuntime === true
        ? "runtime-ready"
        : "preview-only";

  return Object.freeze({
    protocol: "aios.type-hints.runtime-readiness-packet.v1",
    jobName,
    state: acceptanceState,
    acceptedForPreview: preview.acceptedForPreview !== false,
    acceptedForRuntime: blockingReasons.length === 0 && clientRuntimeAdoption.acceptedForRuntime === true,
    acceptedForAdapter: acceptanceState === "adapter-ready",
    tenantId: firstString(tenantBoundary.tenantId, persistedState.tenantId),
    workspaceId: firstString(tenantBoundary.workspaceId, persistedState.workspaceId),
    actorId: tenantBoundary.actorId || "",
    statusChannel: firstString(persistedState.statusChannel, scope?.runtimeScope?.statusChannel),
    restartToken: firstString(persistedState.restartToken, scope?.runtimeScope?.restartToken),
    statusSnapshotKey: persistedState.statusSnapshotKey || "",
    counters: Object.freeze({
      providerCapabilities: providerCapabilities.length,
      adapterSteps: adapterSteps.length,
      durableMemoryMounts: durableMemory.length,
      auditEvents: auditEvents.length,
      reviewLanes: reviewLanes.length,
      blockedRestartCommands: blockedCommands.length,
      blockedWorkflowCommands: blockedWorkflowCommands.length,
      readyWorkflowCommands: readyWorkflowCommands.length,
      missingClientState: missingClientState.length,
      boundaryViolations: tenantBoundary.violations?.length ?? 0,
      heldCapabilities: boundaryHealth.counters?.heldCapabilities ?? 0,
      adapterStatusEvents: adapterStatusReadiness.counters.events,
      adapterStatusFailures: adapterStatusReadiness.counters.failures,
      adapterStatusMissing: adapterStatusReadiness.counters.missing,
      providerSyncRows: providerSyncReadiness.counters.rows,
      providerSyncBlocked: providerSyncReadiness.counters.blocked,
      providerSyncNeedsCursor: providerSyncReadiness.counters.needsProviderCursor,
      providerCallbackRows: providerCallbackReadiness.counters.rows,
      providerCallbackBlocked: providerCallbackReadiness.counters.blocked,
      providerCallbackPending: providerCallbackReadiness.counters.pending,
      providerMaintenanceRows: providerMaintenanceReadiness.counters.rows,
      providerMaintenanceBlocked: providerMaintenanceReadiness.counters.blocked,
      providerMaintenanceDegraded: providerMaintenanceReadiness.counters.degraded,
      lifecycleGateRows: lifecycleGateReadiness.counters.rows,
      lifecycleGateBlocked: lifecycleGateReadiness.counters.blocked,
      lifecycleGateDisabled: lifecycleGateReadiness.counters.disabled,
      lifecycleGateGated: lifecycleGateReadiness.counters.gated,
      lifecycleGateScheduled: lifecycleGateReadiness.counters.scheduled,
      adapterHandoffRows: adapterHandoffReadiness.counters.rows,
      adapterHandoffBlocked: adapterHandoffReadiness.counters.blocked,
      adapterHandoffQueueable: adapterHandoffReadiness.counters.queueable,
      workspaceBoundaryRows: workspaceBoundaryReadiness.counters.rows,
      workspaceBoundaryTransfers: workspaceBoundaryReadiness.counters.transfers,
      workspaceBoundaryQuarantined: workspaceBoundaryReadiness.counters.quarantined,
      previewDecisionRows: previewDecisionReadiness.counters.rows,
      previewDecisionBlocked: previewDecisionReadiness.counters.blocked,
      previewDecisionAcceptanceRows: previewDecisionReadiness.counters.readyForAcceptance,
      previewAcceptanceReceiptRows: previewAcceptanceReceiptReadiness.counters.rows,
      missingPreviewAcceptanceReceipts: previewAcceptanceReceiptReadiness.counters.missing,
      rejectedPreviewAcceptanceReceipts: previewAcceptanceReceiptReadiness.counters.rejected,
      expiredPreviewAcceptanceReceipts: previewAcceptanceReceiptReadiness.counters.expired,
      previewActionPlanRows: previewActionPlanReadiness.counters.rows,
      previewActionPlanBlocked: previewActionPlanReadiness.counters.blocked,
      previewActionPlanNeedsAcceptance: previewActionPlanReadiness.counters.needsAcceptance,
      previewActionPlanAccepted: previewActionPlanReadiness.counters.accepted,
      clientCommandReceiptRows: clientCommandReceiptReadiness.counters.rows,
      blockedClientCommandReceipts: clientCommandReceiptReadiness.counters.blocked,
      missingClientCommandReceipts: clientCommandReceiptReadiness.counters.missing,
      recoveryCommands: recoveryCommandGraph.counters.commands,
      blockedRecoveryCommands: recoveryCommandGraph.counters.blocked,
      readyRecoveryCommands: recoveryCommandGraph.counters.ready,
    }),
    handoff: Object.freeze({
      adapter: providerCapabilities.length > 0 ? "mailchimp" : "local",
      queueable: acceptanceState === "adapter-ready",
      command: acceptanceState === "adapter-ready"
        ? "queue_adapter_handoff"
        : blockingReasons.length > 0
          ? clientRuntimeAdoption.nextStep?.command || operatorReview.nextStep?.command || "resolve_runtime_readiness"
          : "observe",
      auditEvents: freezeArray(auditEvents),
      restartManifestState: compactString(manifest.state || "not-required"),
      adapterStatusState: adapterStatusReadiness.state,
      adapterStatusNextCommand: adapterStatusReadiness.nextAction.command,
      providerSyncState: providerSyncReadiness.state,
      providerSyncNextCommand: providerSyncReadiness.nextStep.command,
      providerCallbackState: providerCallbackReadiness.state,
      providerCallbackNextCommand: providerCallbackReadiness.nextStep.command,
      providerMaintenanceState: providerMaintenanceReadiness.state,
      providerMaintenanceNextCommand: providerMaintenanceReadiness.nextStep.command,
      providerMaintenanceRetryAfterMs: providerMaintenanceReadiness.nextStep.retryAfterMs,
      lifecycleGateState: lifecycleGateReadiness.state,
      lifecycleGateNextCommand: lifecycleGateReadiness.nextStep.command,
      adapterHandoffState: adapterHandoffReadiness.state,
      adapterHandoffNextCommand: adapterHandoffReadiness.nextStep.command,
      workspaceBoundaryState: workspaceBoundaryReadiness.state,
      workspaceBoundaryNextCommand: workspaceBoundaryReadiness.nextStep.command,
      previewDecisionState: previewDecisionReadiness.state,
      previewDecisionNextCommand: previewDecisionReadiness.nextStep.command,
      previewAcceptanceReceiptState: previewAcceptanceReceiptReadiness.state,
      previewAcceptanceReceiptNextCommand: previewAcceptanceReceiptReadiness.nextStep.command,
      previewActionPlanState: previewActionPlanReadiness.state,
      previewActionPlanNextCommand: previewActionPlanReadiness.nextStep.command,
      clientCommandReceiptState: clientCommandReceiptReadiness.state,
      clientCommandReceiptNextCommand: clientCommandReceiptReadiness.nextStep.command,
      recoveryCommandState: recoveryCommandGraph.state,
      recoveryNextCommand: recoveryCommandGraph.nextStep.command,
      workflowState: compactString(clientRuntimeAdoption.workflow?.clientWorkflowState || "not-provided"),
      workflowNextCommand: blockedWorkflowCommands[0]?.nextCommand || readyWorkflowCommands[0]?.nextCommand || "",
    }),
    blockingReasons: freezeArray(blockingReasons),
    reviewLanes: freezeArray(reviewLanes.map((lane) => ({
      lane: compactString(lane.lane),
      state: compactString(lane.state),
      count: Number.isInteger(lane.count) ? lane.count : 0,
      nextCommand: compactString(lane.nextCommand),
    }))),
    previewDecision: Object.freeze({
      state: previewDecisionReadiness.state,
      acceptedForRuntime: previewDecisionReadiness.acceptedForRuntime,
      acceptedForAdapter: previewDecisionReadiness.acceptedForAdapter,
      rows: previewDecisionReadiness.rows,
      blockedRows: previewDecisionReadiness.blockedRows,
      acceptanceRows: previewDecisionReadiness.acceptanceRows,
      nextStep: previewDecisionReadiness.nextStep,
    }),
    previewAcceptanceReceipts: Object.freeze({
      state: previewAcceptanceReceiptReadiness.state,
      acceptedForRuntime: previewAcceptanceReceiptReadiness.acceptedForRuntime,
      acceptedForAdapter: previewAcceptanceReceiptReadiness.acceptedForAdapter,
      rows: previewAcceptanceReceiptReadiness.rows,
      blockedRows: previewAcceptanceReceiptReadiness.blockedRows,
      missingRows: previewAcceptanceReceiptReadiness.missingRows,
      counters: previewAcceptanceReceiptReadiness.counters,
      nextStep: previewAcceptanceReceiptReadiness.nextStep,
    }),
    previewActionPlan: Object.freeze({
      state: previewActionPlanReadiness.state,
      acceptedForRuntime: previewActionPlanReadiness.acceptedForRuntime,
      acceptedForAdapter: previewActionPlanReadiness.acceptedForAdapter,
      rows: previewActionPlanReadiness.rows,
      blockedRows: previewActionPlanReadiness.blockedRows,
      acceptanceRows: previewActionPlanReadiness.acceptanceRows,
      counters: previewActionPlanReadiness.counters,
      nextStep: previewActionPlanReadiness.nextStep,
    }),
    nextStep: Object.freeze({
      command: blockingReasons.length > 0
        ? providerSyncReadiness.state === "blocked"
        ? providerSyncReadiness.nextStep.command
        : providerCallbackReadiness.state === "blocked"
          ? providerCallbackReadiness.nextStep.command
        : providerMaintenanceReadiness.state === "blocked"
        ? providerMaintenanceReadiness.nextStep.command
        : lifecycleGateReadiness.state === "blocked"
          ? lifecycleGateReadiness.nextStep.command
        : adapterHandoffReadiness.state === "blocked"
          ? adapterHandoffReadiness.nextStep.command
          : workspaceBoundaryReadiness.state === "quarantined"
            ? workspaceBoundaryReadiness.nextStep.command
          : previewDecisionReadiness.state === "blocked"
            ? previewDecisionReadiness.nextStep.command
          : previewAcceptanceReceiptReadiness.state === "blocked" || previewAcceptanceReceiptReadiness.state === "needs-acceptance"
            ? previewAcceptanceReceiptReadiness.nextStep.command
          : previewActionPlanReadiness.state === "blocked" || previewActionPlanReadiness.state === "needs-acceptance"
            ? previewActionPlanReadiness.nextStep.command
          : clientCommandReceiptReadiness.state === "blocked"
            ? clientCommandReceiptReadiness.nextStep.command
          : recoveryCommandGraph.state === "blocked"
            ? recoveryCommandGraph.nextStep.command
          : blockedWorkflowCommands[0]?.nextCommand || clientRuntimeAdoption.nextStep?.command || operatorReview.nextStep?.command || "resolve_runtime_readiness"
        : acceptanceState === "adapter-ready"
          ? "queue_adapter_handoff"
          : clientRuntimeAdoption.nextStep?.command || "observe",
      reason: blockingReasons.length > 0
        ? "Typed runtime contracts are waiting on scope preview, boundary, or restart readiness."
        : acceptanceState === "adapter-ready"
          ? "Typed runtime contracts satisfy Mailchimp adapter handoff requirements."
          : "Typed runtime contracts are available for local runtime execution.",
    }),
  });
}

function createTypeHintHistorySnapshot(job = {}, hints = [], scope = {}, tenantBoundary = {}, boundaryHealth = {}, diagnostics = [], persistedState = {}) {
  const recoveryPlan = scope?.recoveryPlan || {};
  const persistedRuntime = scope?.persistedRuntime || {};
  const restartCommandManifest = persistedState.restartCommandManifest || persistedRuntime.restartCommandManifest || {};
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const durableMemory = hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount");
  const blockingDiagnostics = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const warningDiagnostics = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning");
  const adapterStatusReadiness = createAdapterStatusReadiness(scope, hints);
  const providerSyncReadiness = createProviderSyncReadiness(scope, persistedState);
  const providerBudgetReadiness = createProviderBudgetReadiness(scope);
  const providerCallbackReadiness = createProviderCallbackReadiness(scope);
  const providerMaintenanceReadiness = createProviderMaintenanceReadiness(scope);
  const publicationReceiptReadiness = createPublicationReceiptReadiness(scope);
  const adapterHandoffReadiness = createAdapterHandoffReadiness(scope, hints, persistedState);
  const recoveryCommandGraph = createRecoveryCommandGraph(job, hints, scope, persistedState, boundaryHealth, adapterStatusReadiness, providerSyncReadiness, adapterHandoffReadiness);

  return Object.freeze({
    protocol: "aios.type-hints.history-snapshot.v1",
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    state: blockingDiagnostics.length > 0 || recoveryPlan.state === "blocked" || boundaryHealth.state === "blocked"
      ? "blocked"
      : recoveryPlan.state === "degraded" || boundaryHealth.state === "degraded"
        ? "degraded"
        : adapterSteps.length > 0
          ? "adapter-typed"
          : "typed",
    tenantId: tenantBoundary.tenantId || scope?.runtimeScope?.tenantId || "",
    workspaceId: tenantBoundary.workspaceId || scope?.runtimeScope?.workspaceId || "",
    statusChannel: tenantBoundary.statusChannel || scope?.runtimeScope?.statusChannel || "",
    restartToken: tenantBoundary.restartToken || scope?.runtimeScope?.restartToken || "",
    statusSnapshotKey: persistedRuntime.statusSnapshotKey || "",
    restartCommandManifestState: restartCommandManifest.state || "not-required",
    counters: Object.freeze({
      hints: hints.length,
      providerCapabilities: providerCapabilities.length,
      adapterSteps: adapterSteps.length,
      durableMemoryMounts: durableMemory.length,
      boundaryViolations: tenantBoundary.violations?.length ?? 0,
      boundaryHolds: boundaryHealth.counters?.heldCapabilities ?? 0,
      permissionLeaseHolds: boundaryHealth.counters?.permissionLeaseHolds ?? 0,
      actionableErrors: recoveryPlan.actionableErrors?.length ?? 0,
      restartManifestCommands: restartCommandManifest.commands?.length ?? 0,
      restartManifestBlocked: restartCommandManifest.blockedCommands?.length ?? 0,
      adapterStatusEvents: adapterStatusReadiness.counters.events,
      adapterStatusFailures: adapterStatusReadiness.counters.failures,
      adapterStatusMissing: adapterStatusReadiness.counters.missing,
      providerBudgetRows: providerBudgetReadiness.counters.rows,
      providerBudgetBlocked: providerBudgetReadiness.counters.blocked,
      providerBudgetDegraded: providerBudgetReadiness.counters.degraded,
      providerBudgetExhausted: providerBudgetReadiness.counters.exhausted,
      providerCallbackRows: providerCallbackReadiness.counters.rows,
      providerCallbackBlocked: providerCallbackReadiness.counters.blocked,
      providerCallbackPending: providerCallbackReadiness.counters.pending,
      providerCallbackVerified: providerCallbackReadiness.counters.verified,
      providerMaintenanceRows: providerMaintenanceReadiness.counters.rows,
      providerMaintenanceBlocked: providerMaintenanceReadiness.counters.blocked,
      providerMaintenanceDegraded: providerMaintenanceReadiness.counters.degraded,
      providerMaintenanceActive: providerMaintenanceReadiness.counters.active,
      publicationReceiptRows: publicationReceiptReadiness.counters.rows,
      publicationReceiptAccepted: publicationReceiptReadiness.counters.accepted,
      publicationReceiptPending: publicationReceiptReadiness.counters.pending,
      publicationReceiptBlocked: publicationReceiptReadiness.counters.blocked,
      recoveryCommands: recoveryCommandGraph.counters.commands,
      blockedRecoveryCommands: recoveryCommandGraph.counters.blocked,
      readyRecoveryCommands: recoveryCommandGraph.counters.ready,
      diagnostics: diagnostics.length,
      errors: blockingDiagnostics.length,
      warnings: warningDiagnostics.length,
    }),
    timeline: freezeArray([
      ...providerCapabilities.map((hint, index) => ({
        index,
        event: "provider-capability",
        name: hint.name,
        provider: hint.provider,
        state: boundaryHealth.acceptedForAdapter ? "accepted" : "held",
        nextCommand: recoveryPlan.nextCommand || "observe",
      })),
      ...adapterSteps.map((hint, index) => ({
        index: providerCapabilities.length + index,
        event: "adapter-step",
        name: hint.name,
        provider: hint.adapter,
        state: hint.runtimeShape.restartSafe ? "restart-safe" : "restart-blocked",
        nextCommand: hint.runtimeShape.restartSafe ? "observe" : "attach_recovery_status_handoff",
      })),
      ...toArray(restartCommandManifest.commands).map((command, index) => ({
        index: providerCapabilities.length + adapterSteps.length + index,
        event: "restart-command",
        name: command.command,
        provider: command.userVisible?.handoff || "runtime",
        state: command.state,
        nextCommand: command.nextCommand,
      })),
      ...adapterStatusReadiness.failures.map((failure, index) => ({
        index: providerCapabilities.length + adapterSteps.length + toArray(restartCommandManifest.commands).length + index,
        event: "adapter-status-failure",
        name: failure.capability || failure.stepName,
        provider: "mailchimp",
        state: failure.state,
        nextCommand: failure.nextCommand,
      })),
      ...recoveryCommandGraph.commands.map((command, index) => ({
        index: providerCapabilities.length
          + adapterSteps.length
          + toArray(restartCommandManifest.commands).length
          + adapterStatusReadiness.failures.length
          + index,
        event: "recovery-command",
        name: command.command,
        provider: command.userVisible?.handoff || "runtime",
        state: command.state,
        nextCommand: command.nextCommand,
      })),
      ...providerBudgetReadiness.rows.map((row, index) => ({
        index: providerCapabilities.length
          + adapterSteps.length
          + toArray(restartCommandManifest.commands).length
          + adapterStatusReadiness.failures.length
          + recoveryCommandGraph.commands.length
          + index,
        event: "provider-budget",
        name: row.action,
        provider: "mailchimp",
        state: row.state,
        nextCommand: row.nextCommand,
      })),
      ...providerCallbackReadiness.rows.map((row, index) => ({
        index: providerCapabilities.length
          + adapterSteps.length
          + toArray(restartCommandManifest.commands).length
          + adapterStatusReadiness.failures.length
          + recoveryCommandGraph.commands.length
          + providerBudgetReadiness.rows.length
          + index,
        event: "provider-callback",
        name: row.action,
        provider: row.provider || "mailchimp",
        state: row.state,
        nextCommand: row.nextCommand,
      })),
      ...providerMaintenanceReadiness.rows.map((row, index) => ({
        index: providerCapabilities.length
          + adapterSteps.length
          + toArray(restartCommandManifest.commands).length
          + adapterStatusReadiness.failures.length
          + recoveryCommandGraph.commands.length
          + providerBudgetReadiness.rows.length
          + providerCallbackReadiness.rows.length
          + index,
        event: "provider-maintenance",
        name: row.action,
        provider: row.provider || "mailchimp",
        state: row.state,
        nextCommand: row.nextCommand,
      })),
      ...durableMemory.map((hint, index) => ({
        index: providerCapabilities.length
          + adapterSteps.length
          + toArray(restartCommandManifest.commands).length
          + adapterStatusReadiness.failures.length
          + recoveryCommandGraph.commands.length
          + providerBudgetReadiness.rows.length
          + providerCallbackReadiness.rows.length
          + providerMaintenanceReadiness.rows.length
          + index,
        event: "durable-memory",
        name: hint.name,
        provider: hint.runtimeShape.providerSync ? "provider-sync" : "runtime",
        state: "persisted",
        nextCommand: "observe",
      })),
    ]),
  });
}

function createTypeHintAnalyticsExport(jobHints = [], diagnostics = []) {
  const snapshots = toArray(jobHints).map((job) => job.historySnapshot).filter(Boolean);
  const counters = snapshots.reduce((totals, snapshot) => {
    totals.hints += snapshot.counters?.hints ?? 0;
    totals.providerCapabilities += snapshot.counters?.providerCapabilities ?? 0;
    totals.adapterSteps += snapshot.counters?.adapterSteps ?? 0;
    totals.durableMemoryMounts += snapshot.counters?.durableMemoryMounts ?? 0;
    totals.boundaryViolations += snapshot.counters?.boundaryViolations ?? 0;
    totals.boundaryHolds += snapshot.counters?.boundaryHolds ?? 0;
    totals.permissionLeaseHolds += snapshot.counters?.permissionLeaseHolds ?? 0;
    totals.actionableErrors += snapshot.counters?.actionableErrors ?? 0;
    totals.restartManifestCommands += snapshot.counters?.restartManifestCommands ?? 0;
    totals.restartManifestBlocked += snapshot.counters?.restartManifestBlocked ?? 0;
    totals.adapterStatusEvents += snapshot.counters?.adapterStatusEvents ?? 0;
    totals.adapterStatusFailures += snapshot.counters?.adapterStatusFailures ?? 0;
    totals.adapterStatusMissing += snapshot.counters?.adapterStatusMissing ?? 0;
    totals.providerBudgetRows += snapshot.counters?.providerBudgetRows ?? 0;
    totals.providerBudgetBlocked += snapshot.counters?.providerBudgetBlocked ?? 0;
    totals.providerBudgetDegraded += snapshot.counters?.providerBudgetDegraded ?? 0;
    totals.providerBudgetExhausted += snapshot.counters?.providerBudgetExhausted ?? 0;
    totals.providerCallbackRows += snapshot.counters?.providerCallbackRows ?? 0;
    totals.providerCallbackBlocked += snapshot.counters?.providerCallbackBlocked ?? 0;
    totals.providerCallbackPending += snapshot.counters?.providerCallbackPending ?? 0;
    totals.providerCallbackVerified += snapshot.counters?.providerCallbackVerified ?? 0;
    totals.providerMaintenanceRows += snapshot.counters?.providerMaintenanceRows ?? 0;
    totals.providerMaintenanceBlocked += snapshot.counters?.providerMaintenanceBlocked ?? 0;
    totals.providerMaintenanceDegraded += snapshot.counters?.providerMaintenanceDegraded ?? 0;
    totals.providerMaintenanceActive += snapshot.counters?.providerMaintenanceActive ?? 0;
    totals.publicationReceiptRows += snapshot.counters?.publicationReceiptRows ?? 0;
    totals.publicationReceiptAccepted += snapshot.counters?.publicationReceiptAccepted ?? 0;
    totals.publicationReceiptPending += snapshot.counters?.publicationReceiptPending ?? 0;
    totals.publicationReceiptBlocked += snapshot.counters?.publicationReceiptBlocked ?? 0;
    return totals;
  }, {
    jobs: snapshots.length,
    hints: 0,
    providerCapabilities: 0,
    adapterSteps: 0,
    durableMemoryMounts: 0,
    boundaryViolations: 0,
    boundaryHolds: 0,
    permissionLeaseHolds: 0,
    actionableErrors: 0,
    restartManifestCommands: 0,
    restartManifestBlocked: 0,
    adapterStatusEvents: 0,
    adapterStatusFailures: 0,
    adapterStatusMissing: 0,
    providerBudgetRows: 0,
    providerBudgetBlocked: 0,
    providerBudgetDegraded: 0,
    providerBudgetExhausted: 0,
    providerCallbackRows: 0,
    providerCallbackBlocked: 0,
    providerCallbackPending: 0,
    providerCallbackVerified: 0,
    providerMaintenanceRows: 0,
    providerMaintenanceBlocked: 0,
    providerMaintenanceDegraded: 0,
    providerMaintenanceActive: 0,
    publicationReceiptRows: 0,
    publicationReceiptAccepted: 0,
    publicationReceiptPending: 0,
    publicationReceiptBlocked: 0,
  });
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");

  return Object.freeze({
    protocol: "aios.type-hints.analytics-export.v1",
    state: errors.length > 0 || snapshots.some((snapshot) => snapshot.state === "blocked")
      ? "blocked"
      : snapshots.some((snapshot) => snapshot.state === "degraded")
        ? "degraded"
        : "ready",
    exportReady: errors.length === 0,
    counters: Object.freeze({
      ...counters,
      diagnostics: diagnostics.length,
      errors: errors.length,
      warnings: toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning").length,
    }),
    snapshots: freezeArray(snapshots),
    timeline: freezeArray(snapshots
      .flatMap((snapshot) => snapshot.timeline.map((event) => ({ ...event, jobName: snapshot.jobName })))
      .sort((left, right) => left.jobName.localeCompare(right.jobName) || left.index - right.index)),
    report: Object.freeze({
      statusChannels: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.statusChannel).filter(Boolean))]),
      statusSnapshotKeys: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.statusSnapshotKey).filter(Boolean))]),
      restartTokens: freezeArray([...new Set(snapshots.map((snapshot) => snapshot.restartToken).filter(Boolean))]),
      nextCommands: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.timeline.map((event) => event.nextCommand)).filter(Boolean))]),
      clientRuntimeStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.clientRuntimeAdoption?.state).filter(Boolean))]),
      clientRuntimeNextSteps: freezeArray([...new Set(toArray(jobHints).map((job) => job.clientRuntimeAdoption?.nextStep?.command).filter(Boolean))]),
      clientWorkflowStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.clientRuntimeAdoption?.workflow?.clientWorkflowState).filter(Boolean))]),
      blockedWorkflowCommands: toArray(jobHints).reduce((count, job) => count + (job.clientRuntimeAdoption?.workflow?.blockedWorkflowCommands?.length ?? 0), 0),
      readyWorkflowCommands: toArray(jobHints).reduce((count, job) => count + (job.clientRuntimeAdoption?.workflow?.readyWorkflowCommands?.length ?? 0), 0),
      providerLeaseStates: freezeArray([...new Set(toArray(jobHints)
        .flatMap((job) => job.persistedState?.providerLeases || [])
        .map((lease) => lease.leaseState)
        .filter(Boolean))]),
      blockedProviderLeases: toArray(jobHints)
        .flatMap((job) => job.persistedState?.providerLeases || [])
        .filter((lease) => lease.leaseState === "blocked").length,
      runtimeReadinessStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.runtimeReadiness?.state).filter(Boolean))]),
      runtimeReadinessNextSteps: freezeArray([...new Set(toArray(jobHints).map((job) => job.runtimeReadiness?.nextStep?.command).filter(Boolean))]),
      previewDecisionStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.clientRuntimeAdoption?.workflow?.previewDecisionReadiness?.state).filter(Boolean))]),
      blockedPreviewDecisionRows: toArray(jobHints).reduce((count, job) => count + (job.clientRuntimeAdoption?.workflow?.previewDecisionReadiness?.blockedRows?.length ?? 0), 0),
      previewDecisionAcceptanceRows: toArray(jobHints).reduce((count, job) => count + (job.clientRuntimeAdoption?.workflow?.previewDecisionReadiness?.acceptanceRows?.length ?? 0), 0),
      adapterStatusStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.adapterStatusReadiness?.state).filter(Boolean))]),
      adapterStatusNextSteps: freezeArray([...new Set(toArray(jobHints).map((job) => job.adapterStatusReadiness?.nextAction?.command).filter(Boolean))]),
      adapterHandoffStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.adapterHandoffReadiness?.state).filter(Boolean))]),
      adapterHandoffNextSteps: freezeArray([...new Set(toArray(jobHints).map((job) => job.adapterHandoffReadiness?.nextStep?.command).filter(Boolean))]),
      publicationReceiptStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.publicationReceiptReadiness?.state).filter(Boolean))]),
      publicationReceiptNextSteps: freezeArray([...new Set(toArray(jobHints).map((job) => job.publicationReceiptReadiness?.nextStep?.command).filter(Boolean))]),
      publicationReceiptBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.publicationReceiptReadiness?.counters?.blocked ?? 0), 0),
      operationIdentityStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.operationIdentityRegistry?.state).filter(Boolean))]),
      operationIdentityNextSteps: freezeArray([...new Set(toArray(jobHints).map((job) => job.operationIdentityRegistry?.nextStep?.command).filter(Boolean))]),
      blockedOperationIdentities: toArray(jobHints).reduce((count, job) => count + (job.operationIdentityRegistry?.blockedRows?.length ?? 0), 0),
      restartManifestStates: freezeArray([...new Set(toArray(jobHints).map((job) => job.persistedState?.restartCommandManifest?.state).filter(Boolean))]),
      restartWorkflowCommands: freezeArray([...new Set(toArray(jobHints).flatMap((job) => job.persistedState?.restartCommandManifest?.commands || []).map((command) => command.nextCommand).filter(Boolean))]),
    }),
  });
}

function createPreviewRuntimeHandoffReadiness(scope = {}, persistedState = {}) {
  const handoff = scope?.previewRuntimeHandoff || {};
  const rows = toArray(handoff.rows);
  const blocked = toArray(handoff.blockedRows);
  const ready = toArray(handoff.readyRows);
  const previewOnly = toArray(handoff.previewOnlyRows);
  const missing = [...new Set(blocked.flatMap((row) => toArray(row.missing)).map(compactString).filter(Boolean))].sort();
  const state = blocked.length > 0
    ? "blocked"
    : ready.length > 0
      ? "ready"
      : previewOnly.length > 0
        ? "preview-only"
        : "not-required";

  return Object.freeze({
    protocol: "aios.type-hints.preview-runtime-handoff-readiness.v1",
    state,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: state === "ready" && handoff.acceptedForAdapter !== false,
    statusChannel: firstString(handoff.statusChannel, persistedState.statusChannel, scope?.runtimeScope?.statusChannel),
    restartToken: firstString(handoff.restartToken, persistedState.restartToken, scope?.runtimeScope?.restartToken),
    missing: freezeArray(missing),
    rows: freezeArray(rows.map((row) => ({
      rowId: compactString(row.rowId),
      kind: compactString(row.kind),
      name: compactString(row.name),
      lane: compactString(row.lane),
      state: compactString(row.state),
      acceptedForRuntime: row.acceptedForRuntime === true,
      acceptedForAdapter: row.acceptedForAdapter === true,
      commandId: compactString(row.commandId),
      acceptanceToken: compactString(row.acceptanceToken),
      receiptToken: compactString(row.receiptToken),
      statusChannel: compactString(row.runtime?.statusChannel || handoff.statusChannel || persistedState.statusChannel),
      idempotencyKey: compactString(row.runtime?.idempotencyKey || persistedState.idempotencyKey),
      statusSnapshotKey: compactString(row.runtime?.statusSnapshotKey || persistedState.statusSnapshotKey),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "observe"),
    }))),
    blockedRows: freezeArray(blocked.map((row) => ({
      rowId: compactString(row.rowId),
      name: compactString(row.name),
      state: compactString(row.state),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "accept_scope_preview_row"),
    }))),
    readyRows: freezeArray(ready.map((row) => ({
      rowId: compactString(row.rowId),
      name: compactString(row.name),
      commandId: compactString(row.commandId),
      receiptToken: compactString(row.receiptToken),
      nextCommand: compactString(row.nextCommand || "queue_scope_runtime_handoff"),
    }))),
    counters: Object.freeze({
      rows: rows.length,
      ready: ready.length,
      blocked: blocked.length,
      previewOnly: previewOnly.length,
      missingReceipts: handoff.counters?.missingReceipts ?? rows.filter((row) => toArray(row.missing).includes("previewAcceptanceReceipt")).length,
      adapterBlocked: handoff.counters?.adapterBlocked ?? blocked.filter((row) => row.state === "adapter-blocked").length,
    }),
    validationItems: freezeArray(blocked.map((row) => ({
      code: "aios.types.preview_runtime_handoff_blocked",
      severity: "error",
      message: `Preview runtime handoff for "${row.name}" is missing ${toArray(row.missing).join(", ") || "required state"}.`,
      nextCommand: row.nextCommand || "accept_scope_preview_row",
    }))),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || ready[0]?.nextCommand || previewOnly[0]?.nextCommand || handoff.nextStep?.command || "observe",
      reason: blocked.length > 0
        ? "Preview runtime handoff has blocked acceptance, identity, or adapter guard rows."
        : ready.length > 0
          ? "Preview runtime handoff rows are typed and ready for adapter adoption."
          : previewOnly.length > 0
            ? "Preview runtime handoff can render but still needs adapter acceptance."
            : "No preview runtime handoff is required.",
    }),
  });
}

function createPersistedStateContract(job = {}, hints = [], scope = {}) {
  const runtimeScope = scope?.runtimeScope || {};
  const persistedRuntime = scope?.persistedRuntime || {};
  const adapterStatusSnapshot = scope?.adapterStatusSnapshot || {};
  const clientWorkflowHandoff = scope?.clientWorkflowHandoff || {};
  const clientCommandReceipts = scope?.clientCommandReceipts || {};
  const previewRuntimeHandoff = scope?.previewRuntimeHandoff || {};
  const recoveryCheckpointManifest = scope?.recoveryCheckpointManifest || {};
  const persistedRecoveryLedger = scope?.recoveryPlan?.persistedRecoveryLedger || {};
  const resumptionJournal = scope?.persistedRuntime?.resumptionJournal || {};
  const durableMemory = hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount");
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const restartToken = firstString(runtimeScope.restartToken, persistedRuntime.restartToken, scope?.runtimeHandoff?.restartToken);
  const statusChannel = firstString(runtimeScope.statusChannel, scope?.runtimeHandoff?.statusChannel);
  const requiresResumeCursor = adapterSteps.length > 0 || durableMemory.some((hint) => hint.runtimeShape.providerSync);

  const persistedState = Object.freeze({
    contract: "aios.type-hints.persisted-state.v1",
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    tenantId: compactString(runtimeScope.tenantId),
    workspaceId: compactString(runtimeScope.workspaceId),
    requestId: compactString(runtimeScope.requestId),
    restartToken,
    statusChannel,
    idempotencyKey: compactString(runtimeScope.idempotencyKey),
    storageKey: firstString(persistedRuntime.storageKey, restartToken ? `${restartToken}:state` : ""),
    commandKey: firstString(persistedRuntime.commandLedgerKey, restartToken ? `${restartToken}:commands` : ""),
    resumeCursorKey: firstString(persistedRuntime.resumeCursorKey, requiresResumeCursor && restartToken ? `${restartToken}:cursor` : ""),
    statusSnapshotKey: firstString(persistedRuntime.statusSnapshotKey, restartToken ? `${restartToken}:status` : ""),
    adapterStatusSnapshotState: compactString(adapterStatusSnapshot.state || "not-required"),
    adapterStatusSnapshotRows: adapterStatusSnapshot.rows || freezeArray([]),
    blockedAdapterStatusSnapshotRows: adapterStatusSnapshot.blockedRows || freezeArray([]),
    restartCommands: persistedRuntime.commands || freezeArray([]),
    resumptionJournal: resumptionJournal.rows ? Object.freeze({
      protocol: compactString(resumptionJournal.protocol || "aios.scope.runtime-resumption-journal.v1"),
      state: compactString(resumptionJournal.state || "not-required"),
      acceptedForRestart: resumptionJournal.acceptedForRestart === true,
      acceptedForAdapterReplay: resumptionJournal.acceptedForAdapterReplay === true,
      restartToken: compactString(resumptionJournal.restartToken || restartToken),
      statusChannel: compactString(resumptionJournal.statusChannel || statusChannel),
      statusSnapshotKey: compactString(resumptionJournal.statusSnapshotKey || persistedRuntime.statusSnapshotKey),
      commandLedgerKey: compactString(resumptionJournal.commandLedgerKey || persistedRuntime.commandLedgerKey),
      rows: freezeArray(toArray(resumptionJournal.rows).map((row) => ({
        rowId: compactString(row.rowId),
        commandId: compactString(row.commandId),
        command: compactString(row.command),
        phase: compactString(row.phase),
        stepName: compactString(row.stepName),
        capability: compactString(row.capability),
        state: compactString(row.state),
        safeToReplay: row.safeToReplay === true,
        replayKey: compactString(row.replayKey),
        resumeCursorKey: compactString(row.resumeCursorKey),
        storageKey: compactString(row.storageKey),
        idempotencyKey: compactString(row.idempotencyKey),
        statusChannel: compactString(row.statusChannel || resumptionJournal.statusChannel || statusChannel),
        statusSnapshotKey: compactString(row.statusSnapshotKey || resumptionJournal.statusSnapshotKey || persistedRuntime.statusSnapshotKey),
        missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
        nextCommand: compactString(row.nextCommand || "observe"),
      }))),
      blockedRows: freezeArray(toArray(resumptionJournal.blockedRows).map((row) => ({
        rowId: compactString(row.rowId),
        command: compactString(row.command),
        stepName: compactString(row.stepName),
        capability: compactString(row.capability),
        missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
        nextCommand: compactString(row.nextCommand || "attach_recovery_status_handoff"),
      }))),
      replayableRows: freezeArray(toArray(resumptionJournal.replayableRows).map((row) => ({
        rowId: compactString(row.rowId),
        commandId: compactString(row.commandId),
        replayKey: compactString(row.replayKey),
        command: compactString(row.command),
        stepName: compactString(row.stepName),
        capability: compactString(row.capability),
        nextCommand: compactString(row.nextCommand || "resume_adapter_step"),
      }))),
      counters: resumptionJournal.counters || Object.freeze({
        rows: 0,
        commands: 0,
        memorySlots: 0,
        replaySegments: 0,
        blocked: 0,
        replayable: 0,
      }),
      nextStep: resumptionJournal.nextStep || Object.freeze({
        command: "observe",
        reason: "Runtime resumption journal is not required.",
      }),
    }) : null,
    persistedRecoveryLedger: persistedRecoveryLedger.commands ? Object.freeze({
      state: compactString(persistedRecoveryLedger.state || "not-required"),
      acceptedForReplay: persistedRecoveryLedger.acceptedForReplay === true,
      commandLedgerKey: compactString(persistedRecoveryLedger.commandLedgerKey),
      statusSnapshotKey: compactString(persistedRecoveryLedger.statusSnapshotKey),
      commands: freezeArray(toArray(persistedRecoveryLedger.commands).map((command) => ({
        commandId: compactString(command.commandId),
        replayKey: compactString(command.replayKey),
        command: compactString(command.command),
        phase: compactString(command.phase),
        capability: compactString(command.capability),
        stepName: compactString(command.stepName),
        state: compactString(command.state),
        safeToReplay: command.safeToReplay === true,
        replayPolicy: compactString(command.replayPolicy),
        commandLedgerKey: compactString(command.commandLedgerKey),
        statusChannel: compactString(command.statusChannel),
        statusSnapshotKey: compactString(command.statusSnapshotKey),
        idempotencyKey: compactString(command.idempotencyKey),
        nextCommand: compactString(command.nextCommand || command.command),
        blockedBy: freezeArray(toArray(command.blockedBy).map(compactString).filter(Boolean)),
      }))),
      replayableCommands: freezeArray(toArray(persistedRecoveryLedger.replayableCommands).map((command) => ({
        commandId: compactString(command.commandId),
        replayKey: compactString(command.replayKey),
        command: compactString(command.command),
        phase: compactString(command.phase),
        capability: compactString(command.capability),
        stepName: compactString(command.stepName),
      }))),
      counters: persistedRecoveryLedger.counters || Object.freeze({
        commands: 0,
        blocked: 0,
        waiting: 0,
        ready: 0,
        replayable: 0,
      }),
    }) : null,
    workflowCommands: clientWorkflowHandoff.commands || freezeArray([]),
    blockedWorkflowCommands: clientWorkflowHandoff.blockedCommands || freezeArray([]),
    readyWorkflowCommands: clientWorkflowHandoff.readyCommands || freezeArray([]),
    clientCommandReceipts: clientCommandReceipts.rows || freezeArray([]),
    blockedClientCommandReceipts: clientCommandReceipts.blockedRows || freezeArray([]),
    acceptedClientCommandReceipts: clientCommandReceipts.acceptedRows || freezeArray([]),
    previewRuntimeHandoffRows: previewRuntimeHandoff.rows || freezeArray([]),
    blockedPreviewRuntimeHandoffRows: previewRuntimeHandoff.blockedRows || freezeArray([]),
    readyPreviewRuntimeHandoffRows: previewRuntimeHandoff.readyRows || freezeArray([]),
    recoveryCheckpointManifest: recoveryCheckpointManifest.rows ? Object.freeze({
      protocol: compactString(recoveryCheckpointManifest.protocol || "aios.scope.recovery-checkpoint-manifest.v1"),
      state: compactString(recoveryCheckpointManifest.state || "not-required"),
      acceptedForRestart: recoveryCheckpointManifest.acceptedForRestart === true,
      acceptedForAdapterReplay: recoveryCheckpointManifest.acceptedForAdapterReplay === true,
      restartToken: compactString(recoveryCheckpointManifest.restartToken || restartToken),
      commandLedgerKey: compactString(recoveryCheckpointManifest.commandLedgerKey || persistedRuntime.commandLedgerKey),
      statusChannel: compactString(recoveryCheckpointManifest.statusChannel || statusChannel),
      statusSnapshotKey: compactString(recoveryCheckpointManifest.statusSnapshotKey || persistedRuntime.statusSnapshotKey),
      rows: freezeArray(toArray(recoveryCheckpointManifest.rows).map((row) => ({
        rowId: compactString(row.rowId),
        replayKey: compactString(row.replayKey),
        action: compactString(row.action),
        operationId: compactString(row.operationId),
        commandId: compactString(row.commandId),
        command: compactString(row.command),
        state: compactString(row.state),
        safeToReplay: row.safeToReplay === true,
        statusSnapshotRowKey: compactString(row.statusSnapshotRowKey),
        idempotencyKey: compactString(row.idempotencyKey),
        permissionLeaseToken: compactString(row.permissionLeaseToken),
        missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
        nextCommand: compactString(row.nextCommand || "observe"),
      }))),
      blockedRows: freezeArray(toArray(recoveryCheckpointManifest.blockedRows).map((row) => ({
        rowId: compactString(row.rowId),
        action: compactString(row.action),
        operationId: compactString(row.operationId),
        commandId: compactString(row.commandId),
        missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
        nextCommand: compactString(row.nextCommand || "attach_recovery_status_handoff"),
      }))),
      waitingRows: freezeArray(toArray(recoveryCheckpointManifest.waitingRows).map((row) => ({
        rowId: compactString(row.rowId),
        action: compactString(row.action),
        state: compactString(row.state),
        nextCommand: compactString(row.nextCommand || "poll_adapter_status_channel"),
      }))),
      replayableRows: freezeArray(toArray(recoveryCheckpointManifest.replayableRows).map((row) => ({
        rowId: compactString(row.rowId),
        replayKey: compactString(row.replayKey),
        action: compactString(row.action),
        commandId: compactString(row.commandId),
        nextCommand: compactString(row.nextCommand || "resume_adapter_step"),
      }))),
      counters: recoveryCheckpointManifest.counters || Object.freeze({
        rows: 0,
        blocked: 0,
        waiting: 0,
        replayable: 0,
      }),
      nextStep: recoveryCheckpointManifest.nextStep || Object.freeze({
        command: "observe",
        reason: "Recovery checkpoints are not required.",
      }),
    }) : null,
    recoveryCheckpointRows: recoveryCheckpointManifest.rows || freezeArray([]),
    blockedRecoveryCheckpointRows: recoveryCheckpointManifest.blockedRows || freezeArray([]),
    replayableRecoveryCheckpointRows: recoveryCheckpointManifest.replayableRows || freezeArray([]),
    stateSlots: persistedRuntime.stateSlots || freezeArray([]),
    persistedMounts: freezeArray(durableMemory.map((hint) => ({
      name: hint.name,
      retention: hint.runtimeShape.retention,
      providerSync: hint.runtimeShape.providerSync,
    }))),
    idempotentCommands: freezeArray(adapterSteps.map((hint) => ({
      step: hint.name,
      adapter: hint.adapter,
      idempotencyKey: firstString(hint.runtimeShape.idempotencyKey, runtimeScope.idempotencyKey),
      statusHandoff: hint.runtimeShape.statusHandoff,
      restartSafe: hint.runtimeShape.restartSafe,
    }))),
    providerLeases: freezeArray(providerCapabilities.map((hint) => ({
      capability: hint.name,
      provider: hint.provider,
      requiresLease: hint.runtimeShape.requiresLease,
      requiresApproval: hint.runtimeShape.requiresApproval,
      lease: toArray(scope?.permissionBoundary?.capabilities)
        .find((capability) => capability.action === hint.name)?.permissionLease || null,
      leaseState: toArray(scope?.permissionBoundary?.heldCapabilities)
        .some((capability) => capability.action === hint.name && toArray(capability.reasons).some((reason) => compactString(reason).includes("permission-lease")))
        ? "blocked"
        : hint.runtimeShape.requiresLease
          ? "ready"
          : "not-required",
      nextCommand: toArray(scope?.permissionBoundary?.heldCapabilities)
        .some((capability) => capability.action === hint.name && toArray(capability.reasons).some((reason) => compactString(reason).includes("permission-lease")))
        ? "refresh_mailchimp_permission_lease"
        : "observe",
    }))),
    restartStatus: !restartToken
      ? "missing-restart-token"
      : adapterSteps.some((hint) => hint.runtimeShape.restartSafe === false) || resumptionJournal.state === "blocked"
        ? "restart-blocked"
        : requiresResumeCursor
          ? "restart-resumable"
          : "stateless",
  });

  return Object.freeze({
    ...persistedState,
    restartCommandManifest: createRestartCommandManifest(job, hints, scope, persistedState),
  });
}

function createRestartCommandManifest(job = {}, hints = [], scope = {}, persistedState = {}) {
  const runtimeScope = scope?.runtimeScope || {};
  const persistedRuntime = scope?.persistedRuntime || {};
  const runtimeHandoff = scope?.runtimeHandoff || {};
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const restartToken = firstString(persistedState.restartToken, runtimeScope.restartToken);
  const commandKey = firstString(persistedState.commandKey, persistedRuntime.commandLedgerKey);
  const statusChannel = firstString(persistedState.statusChannel, runtimeScope.statusChannel);
  const statusSnapshotKey = firstString(persistedState.statusSnapshotKey, persistedRuntime.statusSnapshotKey);
  const resumeCursorKey = firstString(persistedState.resumeCursorKey, persistedRuntime.resumeCursorKey);
  const explicitCommands = [
    ...toArray(persistedState.restartCommands || persistedRuntime.commands),
    ...toArray(persistedState.workflowCommands || scope?.clientWorkflowHandoff?.commands),
  ];
  const providerLeaseByCapability = new Map(toArray(persistedState.providerLeases).map((lease) => [lease.capability, lease]));
  const rows = [];
  const pushCommand = (row = {}) => {
    const command = compactString(row.command || row.name);
    if (!command) return;
    const phase = compactString(row.phase || "resume");
    const stepName = compactString(row.step || row.stepName || "");
    const capability = compactString(row.capability || row.action || "");
    const idempotencyKey = firstString(row.idempotencyKey, persistedState.idempotencyKey, runtimeScope.idempotencyKey);
    const workflowState = compactString(row.state);
    const providerLease = capability ? providerLeaseByCapability.get(capability) : null;
    const missing = [
      !restartToken && "restartToken",
      (phase === "resume" || phase === "dedupe" || phase === "adapter") && !idempotencyKey && "idempotencyKey",
      (phase === "resume" || phase === "adapter") && !statusChannel && "statusChannel",
      (phase === "resume" || phase === "adapter-status") && !statusSnapshotKey && "statusSnapshotKey",
      phase === "restore" && providerLease?.requiresLease && providerLease.leaseState === "blocked" && "permissionLease",
      phase === "restore" && providerLease?.requiresLease && !providerLease.lease?.token && "permissionLeaseToken",
      workflowState === "blocked" && "workflowCommandBlocked",
    ].filter(Boolean);

    rows.push(Object.freeze({
      command,
      commandId: firstString(row.commandId, `${restartToken || "restart:missing"}:${commandKey || "commands"}:${command}`),
      phase,
      jobName: compactString(row.jobName || job.name || scope?.jobName || "anonymous"),
      stepName,
      capability,
      idempotencyKey,
      restartToken,
      statusChannel,
      statusSnapshotKey,
      resumeCursorKey,
      permissionLeaseToken: compactString(providerLease?.lease?.token),
      permissionLeaseState: compactString(providerLease?.leaseState),
      replayPolicy: compactString(row.replayPolicy || (phase === "resume" ? "resume-before-retry" : "dedupe-by-command-id")),
      required: row.required !== false,
      state: missing.length > 0
        ? "blocked"
        : workflowState === "ready" || phase === "resume" || phase === "adapter"
          ? "runnable"
          : "ready",
      missing: freezeArray(missing),
      nextCommand: missing.length > 0
        ? compactString(row.nextCommand || (missing.includes("permissionLease") || missing.includes("permissionLeaseToken") ? "refresh_mailchimp_permission_lease" : "attach_recovery_status_handoff"))
        : phase === "resume"
          ? "resume_adapter_step"
          : phase === "adapter"
            ? "queue_adapter_handoff"
            : phase === "adapter-status"
              ? "load_adapter_status_snapshot"
          : phase === "dedupe"
            ? "dedupe_external_write"
            : phase === "verify"
              ? "replay_verifier_status"
              : "restore_client_runtime_state",
      userVisible: Object.freeze({
        label: stepName ? `Resume ${stepName}` : capability ? `Resume ${capability}` : command.replace(/_/g, " "),
        blocking: missing.length > 0 && row.required !== false,
        handoff: phase === "resume" ? "adapter" : "runtime",
      }),
    }));
  };

  for (const command of explicitCommands) pushCommand(command);

  for (const hint of adapterSteps) {
    const command = `resume_${hint.name}`.replace(/[^a-z0-9_.:-]+/gi, "_").toLowerCase();
    if (rows.some((row) => row.command === command || row.stepName === hint.name)) continue;
    pushCommand({
      command,
      phase: "resume",
      step: hint.name,
      idempotencyKey: hint.runtimeShape.idempotencyKey,
      replayPolicy: hint.runtimeShape.restartSafe ? "resume-before-retry" : "manual-resolution",
    });
  }

  for (const hint of providerCapabilities) {
    const command = `lease_${hint.name}`.replace(/[^a-z0-9_.:-]+/gi, "_").toLowerCase();
    if (rows.some((row) => row.command === command || row.capability === hint.name)) continue;
    pushCommand({
      command,
      phase: hint.runtimeShape.requiresLease ? "restore" : "verify",
      capability: hint.name,
      replayPolicy: hint.runtimeShape.requiresLease ? "restore-provider-lease" : "latest-status-wins",
      required: hint.runtimeShape.requiresLease,
      nextCommand: "refresh_mailchimp_permission_lease",
    });
  }

  const commands = rows.sort((left, right) => left.phase.localeCompare(right.phase) || left.command.localeCompare(right.command));
  const blocked = commands.filter((row) => row.state === "blocked" && row.required !== false);
  const runnable = commands.filter((row) => row.state === "runnable");

  return Object.freeze({
    protocol: "aios.type-hints.restart-command-manifest.v1",
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    state: blocked.length > 0 ? "blocked" : runnable.length > 0 ? "resume-ready" : commands.length > 0 ? "restore-ready" : "not-required",
    commandKey,
    restartToken,
    statusChannel,
    statusSnapshotKey,
    resumeCursorKey,
    acceptedForReplay: blocked.length === 0,
    commands: freezeArray(commands),
    blockedCommands: freezeArray(blocked.map((row) => ({
      command: row.command,
      phase: row.phase,
      stepName: row.stepName,
      capability: row.capability,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }))),
    runnableCommands: freezeArray(runnable.map((row) => ({
      command: row.command,
      commandId: row.commandId,
      phase: row.phase,
      stepName: row.stepName,
      capability: row.capability,
      replayPolicy: row.replayPolicy,
      idempotencyKey: row.idempotencyKey,
      permissionLeaseToken: row.permissionLeaseToken,
    }))),
    userWorkflow: Object.freeze({
      nextCommand: blocked[0]?.nextCommand || runnable[0]?.nextCommand || runtimeHandoff.nextCommand || "observe",
      labels: freezeArray(commands.map((row) => row.userVisible.label)),
      blockingLabels: freezeArray(blocked.map((row) => row.userVisible.label)),
    }),
  });
}

function createOperationIdentityRegistry(job = {}, hints = [], scope = {}, persistedState = {}) {
  const operationIdentity = scope?.operationIdentity || {};
  const operationRows = toArray(operationIdentity.rows);
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const capabilityNames = new Set(providerCapabilities.map((hint) => hint.name));
  const stepNames = new Set(adapterSteps.map((hint) => hint.name));
  const rows = operationRows.map((row) => {
    const declaredCapability = capabilityNames.has(compactString(row.action));
    const declaredStep = toArray(row.stepNames).some((stepName) => stepNames.has(compactString(stepName)));
    const missing = [
      ...toArray(row.missing).map(compactString).filter(Boolean),
      !declaredCapability && "capabilityHint",
      adapterSteps.length > 0 && !declaredStep && "adapterStepHint",
      persistedState.restartStatus === "restart-blocked" && "restartStatus",
    ].filter(Boolean);

    return Object.freeze({
      operationId: compactString(row.operationId),
      operationKey: compactString(row.operationKey),
      action: compactString(row.action),
      provider: compactString(row.provider || "mailchimp"),
      state: missing.length > 0 ? "blocked" : compactString(row.state || "restart-safe"),
      declaredCapability,
      declaredStep,
      restartToken: firstString(row.restartToken, persistedState.restartToken),
      commandId: compactString(row.commandId),
      commandKey: firstString(row.commandKey, persistedState.commandKey),
      idempotencyKey: firstString(row.idempotencyKey, persistedState.idempotencyKey),
      statusChannel: firstString(row.statusChannel, persistedState.statusChannel),
      statusSnapshotKey: firstString(row.statusSnapshotKey, persistedState.statusSnapshotKey),
      checkpointKey: compactString(row.checkpointKey),
      watermarkKey: compactString(row.watermarkKey),
      permissionLeaseToken: compactString(row.permissionLeaseToken),
      permissionLeaseState: compactString(row.permissionLeaseState || "not-required"),
      missing: freezeArray([...new Set(missing)].sort()),
      nextCommand: missing.length > 0
        ? compactString(row.nextCommand || "attach_recovery_status_handoff")
        : compactString(row.nextCommand || "observe"),
    });
  }).sort((left, right) => left.action.localeCompare(right.action));
  const blocked = rows.filter((row) => row.state === "blocked" || row.missing.length > 0);
  const waiting = rows.filter((row) => row.state === "waiting-adapter-status");

  return Object.freeze({
    protocol: "aios.type-hints.operation-identity-registry.v1",
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    state: blocked.length > 0 ? "blocked" : waiting.length > 0 ? "waiting" : rows.length > 0 ? "ready" : "not-required",
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && providerCapabilities.length === rows.length,
    restartToken: firstString(operationIdentity.restartToken, persistedState.restartToken),
    commandKey: firstString(operationIdentity.commandKey, persistedState.commandKey),
    statusChannel: firstString(operationIdentity.statusChannel, persistedState.statusChannel),
    statusSnapshotKey: firstString(operationIdentity.statusSnapshotKey, persistedState.statusSnapshotKey),
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
      providerCapabilities: providerCapabilities.length,
      adapterSteps: adapterSteps.length,
      missingCapabilityHints: blocked.filter((row) => row.missing.includes("capabilityHint")).length,
      missingAdapterStepHints: blocked.filter((row) => row.missing.includes("adapterStepHint")).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand || waiting[0]?.nextCommand || "observe",
      reason: blocked.length > 0
        ? "Operation identity registry is missing typed restart or adapter handoff state."
        : waiting.length > 0
          ? "Operation identity registry is waiting on adapter status."
          : "Operation identities are typed for restart-safe handoff.",
    }),
  });
}

function createRecoveryCheckpointReadiness(job = {}, persistedState = {}, tenantBoundary = {}) {
  const manifest = persistedState.recoveryCheckpointManifest || {};
  const rows = toArray(manifest.rows || persistedState.recoveryCheckpointRows);
  const blocked = toArray(manifest.blockedRows || persistedState.blockedRecoveryCheckpointRows);
  const waiting = toArray(manifest.waitingRows);
  const replayable = toArray(manifest.replayableRows || persistedState.replayableRecoveryCheckpointRows);
  const tenantScopedBlocked = rows.filter((row) => {
    return compactString(row.state) !== "observed"
      && (!tenantBoundary.tenantId || !tenantBoundary.workspaceId || !tenantBoundary.actorId);
  });
  const missingAudit = rows.filter((row) => {
    return compactString(row.state) !== "observed"
      && (!persistedState.statusChannel || !persistedState.statusSnapshotKey || !persistedState.commandKey);
  });
  const allBlocked = [
    ...blocked,
    ...tenantScopedBlocked.map((row) => ({
      ...row,
      missing: freezeArray([...new Set([...toArray(row.missing), "tenantAuditScope"])].sort()),
      nextCommand: "attach_client_runtime_request",
    })),
    ...missingAudit.map((row) => ({
      ...row,
      missing: freezeArray([...new Set([...toArray(row.missing), "auditHandoff"])].sort()),
      nextCommand: "attach_recovery_status_handoff",
    })),
  ];
  const dedupedBlocked = allBlocked.filter((row, index) => {
    const key = `${compactString(row.rowId)}:${compactString(row.action)}:${compactString(row.nextCommand)}`;
    return allBlocked.findIndex((candidate) => {
      return `${compactString(candidate.rowId)}:${compactString(candidate.action)}:${compactString(candidate.nextCommand)}` === key;
    }) === index;
  });

  return Object.freeze({
    protocol: "aios.type-hints.recovery-checkpoint-readiness.v1",
    jobName: compactString(job.name || persistedState.jobName || "anonymous"),
    state: dedupedBlocked.length > 0
      ? "blocked"
      : waiting.length > 0
        ? "waiting-adapter"
        : replayable.length > 0
          ? "replay-ready"
          : rows.length > 0
            ? "observed"
            : "not-required",
    acceptedForRuntime: dedupedBlocked.length === 0,
    acceptedForAdapterReplay: dedupedBlocked.length === 0 && waiting.length === 0,
    restartToken: compactString(manifest.restartToken || persistedState.restartToken),
    commandKey: compactString(manifest.commandLedgerKey || persistedState.commandKey),
    statusChannel: compactString(manifest.statusChannel || persistedState.statusChannel),
    statusSnapshotKey: compactString(manifest.statusSnapshotKey || persistedState.statusSnapshotKey),
    rows: freezeArray(rows),
    blockedRows: freezeArray(dedupedBlocked.map((row) => ({
      rowId: compactString(row.rowId),
      action: compactString(row.action),
      commandId: compactString(row.commandId),
      missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(row.nextCommand || "attach_recovery_status_handoff"),
    }))),
    replayableRows: freezeArray(replayable),
    counters: Object.freeze({
      rows: rows.length,
      blocked: dedupedBlocked.length,
      waiting: waiting.length,
      replayable: replayable.length,
      tenantScopeBlocked: tenantScopedBlocked.length,
      auditHandoffBlocked: missingAudit.length,
    }),
    nextStep: Object.freeze({
      command: dedupedBlocked[0]?.nextCommand || waiting[0]?.nextCommand || replayable[0]?.nextCommand || manifest.nextStep?.command || "observe",
      reason: dedupedBlocked.length > 0
        ? "Typed recovery checkpoints need tenant audit scope and persisted handoff keys before replay."
        : waiting.length > 0
          ? "Typed recovery checkpoints are waiting on adapter status."
          : replayable.length > 0
            ? "Typed recovery checkpoints are ready for restart-safe replay."
            : "No typed recovery checkpoints are required.",
    }),
  });
}

function createJobHints(job = {}, scope) {
  const runtimeScope = scope?.runtimeScope || {};
  const hints = [
    ...toArray(job.capabilities).map(inferCapabilityType),
    ...toArray(job.memory).map(inferMemoryType),
    ...toArray(job.steps).map((step) => inferStepType(step, runtimeScope)),
    ...toArray(job.verifiers).map(inferVerifierType),
  ].sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
  const diagnostics = [];

  for (const hint of hints) {
    if (hint.kind === "step" && hint.runtimeShape.statusHandoff === "requires-adapter-status" && hint.runtimeShape.capabilityRefs.length === 0) {
      diagnostics.push(Object.freeze({
        level: "warning",
        code: "aios.types.adapter_step_missing_capability",
        message: `Step "${hint.name}" uses an adapter-like effect without an explicit capability reference.`,
        jobName: job.name,
        stepName: hint.name,
      }));
    }

    if (hint.kind === "step" && hint.type === "AdapterEffectStep" && hint.runtimeShape.restartSafe === false) {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "aios.types.adapter_step_not_restart_safe",
        message: `Step "${hint.name}" requires adapter status but has no idempotency key for restart recovery.`,
        jobName: job.name,
        stepName: hint.name,
      }));
    }
  }

  const persistedState = createPersistedStateContract(job, hints, scope);
  const operationIdentityRegistry = createOperationIdentityRegistry(job, hints, scope, persistedState);
  const tenantBoundary = createTenantBoundaryShape(job, scope, hints);
  const recoveryCheckpointReadiness = createRecoveryCheckpointReadiness(job, persistedState, tenantBoundary);
  const boundaryHealth = createBoundaryHealthContract(scope, tenantBoundary);
  const workspaceBoundaryReadiness = createWorkspaceBoundaryReadiness(scope);
  const adapterStatusReadiness = createAdapterStatusReadiness(scope, hints);
  const providerSyncReadiness = createProviderSyncReadiness(scope, persistedState);
  const providerBudgetReadiness = createProviderBudgetReadiness(scope);
  const settingsAdoptionReadiness = createSettingsAdoptionReadiness(scope);
  const lifecycleGateReadiness = createLifecycleGateReadiness(scope);
  const providerExportBoundaryReadiness = createProviderExportBoundaryReadiness(scope);
  const publicationReceiptReadiness = createPublicationReceiptReadiness(scope);
  const providerCallbackReadiness = createProviderCallbackReadiness(scope);
  const providerEventSubscriptionReadiness = createProviderEventSubscriptionReadiness(scope);
  const providerMaintenanceReadiness = createProviderMaintenanceReadiness(scope);
  const providerOperationalIncidentReadiness = createProviderOperationalIncidentReadiness(scope);
  const adapterHandoffReadiness = createAdapterHandoffReadiness(scope, hints, persistedState);
  const adapterHandoffReceiptReadiness = createAdapterHandoffReceiptReadiness(scope, adapterHandoffReadiness);
  const previewRuntimeHandoffReadiness = createPreviewRuntimeHandoffReadiness(scope, persistedState);
  const clientRuntimeAdoption = createClientRuntimeAdoptionContract(job, hints, scope, persistedState, tenantBoundary, boundaryHealth);
  const previewAcceptanceReceiptReadiness = clientRuntimeAdoption.workflow?.previewAcceptanceReceiptReadiness
    || createPreviewAcceptanceReceiptReadiness(scope, tenantBoundary, persistedState);
  const previewActionPlanReadiness = clientRuntimeAdoption.workflow?.previewActionPlanReadiness
    || createPreviewActionPlanReadiness(scope, persistedState, tenantBoundary);
  const clientCommandReceiptReadiness = clientRuntimeAdoption.workflow?.clientCommandReceiptReadiness
    || createClientCommandReceiptReadiness(scope, persistedState, tenantBoundary);
  const runtimeReadiness = createRuntimeReadinessPacket(job, hints, scope, persistedState, tenantBoundary, boundaryHealth, clientRuntimeAdoption);
  const recoveryCommandGraph = clientRuntimeAdoption.workflow?.recoveryCommandGraph
    || createRecoveryCommandGraph(job, hints, scope, persistedState, boundaryHealth, adapterStatusReadiness, providerSyncReadiness, adapterHandoffReadiness);

  for (const violation of tenantBoundary.violations) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.tenant_boundary_violation",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" violates tenant boundary rule "${violation}".`,
      jobName: job.name,
      violation,
    }));
  }
  for (const row of operationIdentityRegistry.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.operation_identity_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" cannot type operation "${row.action}" as restart-safe.`,
      jobName: job.name,
      capabilityName: row.action,
      operationId: row.operationId,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of recoveryCheckpointReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.recovery_checkpoint_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has a recovery checkpoint for "${row.action}" that is not typed for restart-safe replay.`,
      jobName: job.name,
      capabilityName: row.action,
      commandId: row.commandId,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of workspaceBoundaryReadiness.quarantinedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.workspace_boundary_quarantined",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has quarantined workspace boundary state for "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      transferToken: row.transferToken,
      blockedBy: row.blockedBy,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of settingsAdoptionReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.settings_adoption_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has incomplete Mailchimp settings for "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of lifecycleGateReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.lifecycle_gate_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has lifecycle controls blocking "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      state: row.state,
      mode: row.mode,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of providerCallbackReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.provider_callback_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has incomplete Mailchimp callback endpoint state for "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      callbackId: row.callbackId,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of providerEventSubscriptionReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.provider_event_subscription_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has incomplete Mailchimp event subscriptions for "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      subscriptionId: row.subscriptionId,
      callbackId: row.callbackId,
      missing: row.missing,
      missingEvents: row.missingEvents,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of providerMaintenanceReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.provider_maintenance_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has provider maintenance blocking "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      windowId: row.windowId,
      blockedBy: row.blockedBy,
      retryAfterMs: row.retryAfterMs,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of providerOperationalIncidentReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.provider_operational_incident_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has provider operational incident "${row.source}" blocking "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      source: row.source,
      severity: row.severity,
      reason: row.reason,
      retryAfterMs: row.retryAfterMs,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of segmentSyncReceiptReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.segment_sync_receipt_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has blocked Mailchimp segment sync receipt state for "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      segmentId: row.segmentId,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of providerExportBoundaryReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.provider_export_boundary_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has blocked provider export boundary lane for "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      laneKey: row.laneKey,
      blockedBy: row.blockedBy,
      missing: row.missing,
      retryable: row.retryable,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of adapterHandoffReceiptReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.adapter_handoff_receipt_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has blocked adapter handoff receipt state for "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      commandId: row.commandId,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of publicationReceiptReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.publication_receipt_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has blocked publication receipt state for destination "${row.destinationId}".`,
      jobName: job.name,
      destinationId: row.destinationId,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of clientCommandReceiptReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.client_command_receipt_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" is missing accepted client receipt for command "${row.command}".`,
      jobName: job.name,
      command: row.command,
      commandId: row.commandId,
      capabilityName: row.capability,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of previewRuntimeHandoffReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.preview_runtime_handoff_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has blocked preview runtime handoff for "${row.name}".`,
      jobName: job.name,
      capabilityName: row.name,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }));
  }
  for (const row of previewActionPlanReadiness.blockedRows) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.preview_action_plan_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has blocked preview action "${row.name}".`,
      jobName: job.name,
      capabilityName: row.name,
      state: row.state,
      missing: row.missing,
      nextCommand: row.command,
    }));
  }
  for (const row of toArray(boundaryHealth.permissionPosture?.blockedRows)) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.types.permission_posture_blocked",
      message: `Job "${compactString(job.name || scope?.jobName || "anonymous")}" has blocked Mailchimp tenant permission posture for "${row.action}".`,
      jobName: job.name,
      capabilityName: row.action,
      state: row.state,
      requiredPermission: row.requiredPermission,
      leaseState: row.leaseState,
      nextCommand: row.nextCommand,
    }));
  }
  const historySnapshot = createTypeHintHistorySnapshot(job, hints, scope, tenantBoundary, boundaryHealth, diagnostics, persistedState);

  return Object.freeze({
    jobName: compactString(job.name || scope?.jobName || "anonymous"),
    scope,
    status: scope?.status === "invalid" ? "blocked-by-scope" : diagnostics.some((diagnostic) => diagnostic.level === "error") ? "invalid" : "typed",
    hints: freezeArray(hints),
    persistedState,
    tenantBoundary,
    boundaryHealth,
    permissionPosture: boundaryHealth.permissionPosture,
    workspaceBoundaryReadiness,
    adapterStatusReadiness,
    providerSyncReadiness,
    segmentSyncReceiptReadiness,
    providerBudgetReadiness,
    providerCallbackReadiness,
    providerEventSubscriptionReadiness,
    providerMaintenanceReadiness,
    providerOperationalIncidentReadiness,
    settingsAdoptionReadiness,
    lifecycleGateReadiness,
    providerExportBoundaryReadiness,
    publicationReceiptReadiness,
    adapterHandoffReadiness,
    adapterHandoffReceiptReadiness,
    previewRuntimeHandoffReadiness,
    previewAcceptanceReceiptReadiness,
    previewActionPlanReadiness,
    clientCommandReceiptReadiness,
    operationIdentityRegistry,
    recoveryCheckpointReadiness,
    recoveryCommandGraph,
    clientRuntimeAdoption,
    runtimeReadiness,
    historySnapshot,
    diagnostics: freezeArray(diagnostics),
    contract: createTypeHintContract(hints, scope, persistedState, tenantBoundary, boundaryHealth, clientRuntimeAdoption, runtimeReadiness, adapterStatusReadiness, providerSyncReadiness, segmentSyncReceiptReadiness, adapterHandoffReadiness, recoveryCommandGraph, workspaceBoundaryReadiness, providerBudgetReadiness, settingsAdoptionReadiness, providerCallbackReadiness, providerExportBoundaryReadiness, providerMaintenanceReadiness, providerEventSubscriptionReadiness, providerOperationalIncidentReadiness, previewRuntimeHandoffReadiness, adapterHandoffReceiptReadiness, previewActionPlanReadiness),
  });
}

export function createTypeHintContract(
  hints = [],
  scope = {},
  persistedState = createPersistedStateContract({}, hints, scope),
  tenantBoundary = createTenantBoundaryShape({}, scope, hints),
  boundaryHealth = createBoundaryHealthContract(scope, tenantBoundary),
  clientRuntimeAdoption = createClientRuntimeAdoptionContract({}, hints, scope, persistedState, tenantBoundary, boundaryHealth),
  runtimeReadiness = createRuntimeReadinessPacket({}, hints, scope, persistedState, tenantBoundary, boundaryHealth, clientRuntimeAdoption),
  adapterStatusReadiness = createAdapterStatusReadiness(scope, hints),
  providerSyncReadiness = createProviderSyncReadiness(scope, persistedState),
  segmentSyncReceiptReadiness = createSegmentSyncReceiptReadiness(scope),
  adapterHandoffReadiness = createAdapterHandoffReadiness(scope, hints, persistedState),
  recoveryCommandGraph = createRecoveryCommandGraph({}, hints, scope, persistedState, boundaryHealth, adapterStatusReadiness, providerSyncReadiness, adapterHandoffReadiness),
  workspaceBoundaryReadiness = createWorkspaceBoundaryReadiness(scope),
  providerBudgetReadiness = createProviderBudgetReadiness(scope),
  settingsAdoptionReadiness = createSettingsAdoptionReadiness(scope),
  providerCallbackReadiness = createProviderCallbackReadiness(scope),
  providerExportBoundaryReadiness = createProviderExportBoundaryReadiness(scope),
  providerMaintenanceReadiness = createProviderMaintenanceReadiness(scope),
  providerEventSubscriptionReadiness = createProviderEventSubscriptionReadiness(scope),
  providerOperationalIncidentReadiness = createProviderOperationalIncidentReadiness(scope),
  previewRuntimeHandoffReadiness = createPreviewRuntimeHandoffReadiness(scope, persistedState),
  adapterHandoffReceiptReadiness = createAdapterHandoffReceiptReadiness(scope, adapterHandoffReadiness),
  previewActionPlanReadiness = createPreviewActionPlanReadiness(scope, persistedState, tenantBoundary)
) {
  const providerCapabilities = hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability");
  const durableMemory = hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount");
  const adapterSteps = hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep");
  const permissionPosture = scope?.permissionPosture || boundaryHealth.permissionPosture || {};

  return Object.freeze({
    provider: providerCapabilities.some((hint) => hint.provider === "mailchimp") ? "mailchimp" : "local",
    requiresAdapterStatus: adapterSteps.length > 0,
    requiresRecoveryPlan: providerCapabilities.some((hint) => hint.runtimeShape.requiresApproval),
    restartStatus: persistedState.restartStatus,
    restartCommandManifest: persistedState.restartCommandManifest,
    statusChannel: persistedState.statusChannel,
    storageKey: persistedState.storageKey,
    commandKey: persistedState.commandKey,
    statusSnapshotKey: persistedState.statusSnapshotKey,
    tenantScoped: tenantBoundary.tenantScoped,
    actorScoped: tenantBoundary.actorScoped,
    permissionDeclared: tenantBoundary.permissionDeclared,
    boundaryHealth,
    permissionPosture,
    workspaceBoundaryReadiness,
    adapterStatusReadiness,
    providerSyncReadiness,
    segmentSyncReceiptReadiness,
    providerBudgetReadiness,
    settingsAdoptionReadiness,
    providerCallbackReadiness,
    providerEventSubscriptionReadiness,
    providerMaintenanceReadiness,
    providerOperationalIncidentReadiness,
    providerExportBoundaryReadiness,
    adapterHandoffReadiness,
    adapterHandoffReceiptReadiness,
    previewRuntimeHandoffReadiness,
    previewActionPlanReadiness,
    recoveryCommandGraph,
    clientRuntimeAdoption,
    runtimeReadiness,
    auditEvents: tenantBoundary.requiredAuditEvents,
    requiredRuntimeShapes: freezeArray([
      ...providerCapabilities.map((hint) => `${hint.name}:ProviderCapability`),
      ...durableMemory.map((hint) => `${hint.name}:DurableMemoryMount`),
      ...adapterSteps.map((hint) => `${hint.name}:AdapterEffectStep`),
      ...(persistedState.storageKey ? [`${persistedState.storageKey}:PersistedRuntimeState`] : []),
      ...(persistedState.statusSnapshotKey ? [`${persistedState.statusSnapshotKey}:StatusSnapshot`] : []),
    ]),
    scopeReady: scope?.status !== "invalid"
      && tenantBoundary.violations.length === 0
      && boundaryHealth.acceptedForAdapter
      && permissionPosture.acceptedForAdapter !== false
      && providerOperationalIncidentReadiness.acceptedForAdapter === true,
    workspaceBoundaryReady: workspaceBoundaryReadiness.acceptedForAdapter === true,
    clientRuntimeReady: clientRuntimeAdoption.acceptedForRuntime === true,
    runtimeReadinessReady: runtimeReadiness.acceptedForAdapter === true,
    adapterStatusReady: adapterStatusReadiness.acceptedForAdapter === true,
    providerSyncReady: providerSyncReadiness.acceptedForAdapter === true,
    segmentSyncReceiptsReady: segmentSyncReceiptReadiness.acceptedForAdapter === true,
    providerBudgetReady: providerBudgetReadiness.acceptedForAdapter === true,
    settingsAdoptionReady: settingsAdoptionReadiness.acceptedForAdapter === true,
    providerCallbackReady: providerCallbackReadiness.acceptedForAdapter === true,
    providerEventSubscriptionsReady: providerEventSubscriptionReadiness.acceptedForAdapter === true,
    providerMaintenanceReady: providerMaintenanceReadiness.acceptedForAdapter === true,
    providerOperationalIncidentsReady: providerOperationalIncidentReadiness.acceptedForAdapter === true,
    providerExportBoundaryReady: providerExportBoundaryReadiness.acceptedForAdapter === true,
    adapterHandoffReady: adapterHandoffReadiness.acceptedForAdapter === true,
    adapterHandoffReceiptsReady: adapterHandoffReceiptReadiness.acceptedForAdapter === true,
    previewRuntimeHandoffReady: previewRuntimeHandoffReadiness.acceptedForAdapter === true,
    previewActionPlanReady: previewActionPlanReadiness.acceptedForAdapter === true,
    recoveryGraphReady: recoveryCommandGraph.acceptedForRuntime === true,
    nextCommand: adapterHandoffReceiptReadiness.state === "blocked"
      ? adapterHandoffReceiptReadiness.nextStep.command
      : providerOperationalIncidentReadiness.state === "blocked"
      ? providerOperationalIncidentReadiness.nextStep.command
      : previewRuntimeHandoffReadiness.state === "blocked"
      ? previewRuntimeHandoffReadiness.nextStep.command
      : previewActionPlanReadiness.state === "blocked" || previewActionPlanReadiness.state === "needs-acceptance"
      ? previewActionPlanReadiness.nextStep.command
      : recoveryCommandGraph.nextStep?.command || runtimeReadiness.nextStep?.command || clientRuntimeAdoption.nextStep?.command || "observe",
  });
}

export function inferAiosTypeHints(input = {}) {
  const jobs = getJobs(input);
  const scopeResolution = input.scopeResolution || resolveAiosScopes(input);
  const jobHints = jobs.map((job, index) => createJobHints(job, scopeResolution.jobs?.[index]));
  const diagnostics = [
    ...(scopeResolution.diagnostics || []),
    ...jobHints.flatMap((job) => job.diagnostics),
  ];
  const errors = diagnostics.filter((diagnostic) => diagnostic.level === "error");

  return Object.freeze({
    protocol: "aios.semantic.type-hints.v1",
    status: errors.length > 0 ? "blocked" : "typed",
    scopeResolution,
    jobs: freezeArray(jobHints),
    diagnostics: freezeArray(diagnostics),
    analyticsExport: createTypeHintAnalyticsExport(jobHints, diagnostics),
    summary: summarizeAiosTypeHints(jobHints, diagnostics),
  });
}

export function summarizeAiosTypeHints(jobHints = [], diagnostics = []) {
  const hints = toArray(jobHints).flatMap((job) => job.hints || []);
  return Object.freeze({
    jobs: jobHints.length,
    hints: hints.length,
    providerCapabilities: hints.filter((hint) => hint.kind === "capability" && hint.type === "ProviderCapability").length,
    adapterSteps: hints.filter((hint) => hint.kind === "step" && hint.type === "AdapterEffectStep").length,
    durableMemoryMounts: hints.filter((hint) => hint.kind === "memory" && hint.type === "DurableMemoryMount").length,
    restartResumableJobs: toArray(jobHints).filter((job) => job.persistedState?.restartStatus === "restart-resumable").length,
    restartBlockedJobs: toArray(jobHints).filter((job) => job.persistedState?.restartStatus === "restart-blocked").length,
    restartCommandManifestBlockedJobs: toArray(jobHints).filter((job) => job.persistedState?.restartCommandManifest?.state === "blocked").length,
    restartCommandManifestCommands: toArray(jobHints).reduce((count, job) => count + (job.persistedState?.restartCommandManifest?.commands?.length ?? 0), 0),
    persistedRecoveryLedgerCommands: toArray(jobHints).reduce((count, job) => count + (job.persistedState?.persistedRecoveryLedger?.counters?.commands ?? 0), 0),
    persistedRecoveryLedgerBlocked: toArray(jobHints).reduce((count, job) => count + (job.persistedState?.persistedRecoveryLedger?.counters?.blocked ?? 0), 0),
    persistedRecoveryLedgerReplayable: toArray(jobHints).reduce((count, job) => count + (job.persistedState?.persistedRecoveryLedger?.counters?.replayable ?? 0), 0),
    recoveryCheckpointRows: toArray(jobHints).reduce((count, job) => count + (job.recoveryCheckpointReadiness?.counters?.rows ?? 0), 0),
    recoveryCheckpointBlocked: toArray(jobHints).reduce((count, job) => count + (job.recoveryCheckpointReadiness?.counters?.blocked ?? 0), 0),
    recoveryCheckpointReplayable: toArray(jobHints).reduce((count, job) => count + (job.recoveryCheckpointReadiness?.counters?.replayable ?? 0), 0),
    recoveryCheckpointBlockedJobs: toArray(jobHints).filter((job) => job.recoveryCheckpointReadiness?.state === "blocked").length,
    resumptionJournalRows: toArray(jobHints).reduce((count, job) => count + (job.persistedState?.resumptionJournal?.counters?.rows ?? 0), 0),
    resumptionJournalBlocked: toArray(jobHints).reduce((count, job) => count + (job.persistedState?.resumptionJournal?.counters?.blocked ?? 0), 0),
    resumptionJournalReplayable: toArray(jobHints).reduce((count, job) => count + (job.persistedState?.resumptionJournal?.counters?.replayable ?? 0), 0),
    tenantBoundaryViolations: toArray(jobHints).reduce((count, job) => count + (job.tenantBoundary?.violations?.length ?? 0), 0),
    mailchimpBoundaryHolds: toArray(jobHints).reduce((count, job) => count + (job.boundaryHealth?.counters?.heldCapabilities ?? 0), 0),
    permissionPostureRows: toArray(jobHints).reduce((count, job) => count + (job.boundaryHealth?.counters?.permissionPostureRows ?? 0), 0),
    permissionPostureBlocked: toArray(jobHints).reduce((count, job) => count + (job.boundaryHealth?.counters?.permissionPostureBlocked ?? 0), 0),
    permissionPostureCovered: toArray(jobHints).reduce((count, job) => count + (job.boundaryHealth?.counters?.permissionPostureCovered ?? 0), 0),
    permissionPostureGrantBlocked: toArray(jobHints).reduce((count, job) => count + (job.boundaryHealth?.counters?.permissionPostureGrantBlocked ?? 0), 0),
    permissionPostureLeaseBlocked: toArray(jobHints).reduce((count, job) => count + (job.boundaryHealth?.counters?.permissionPostureLeaseBlocked ?? 0), 0),
    permissionPostureIdentityBlocked: toArray(jobHints).reduce((count, job) => count + (job.boundaryHealth?.counters?.permissionPostureIdentityBlocked ?? 0), 0),
    mailchimpPermissionLeaseHolds: toArray(jobHints).reduce((count, job) => count + (job.boundaryHealth?.counters?.permissionLeaseHolds ?? 0), 0),
    providerLeaseBlockedJobs: toArray(jobHints).filter((job) => toArray(job.persistedState?.providerLeases).some((lease) => lease.leaseState === "blocked")).length,
    boundaryHealthBlocked: toArray(jobHints).filter((job) => job.boundaryHealth?.state === "blocked").length,
    clientRuntimeReadyJobs: toArray(jobHints).filter((job) => job.clientRuntimeAdoption?.acceptedForRuntime).length,
    adapterHandoffReadyJobs: toArray(jobHints).filter((job) => job.runtimeReadiness?.acceptedForAdapter).length,
    runtimeReadinessBlockedJobs: toArray(jobHints).filter((job) => job.runtimeReadiness?.state === "blocked").length,
    runtimeReadinessAdapterReadyJobs: toArray(jobHints).filter((job) => job.runtimeReadiness?.state === "adapter-ready").length,
    previewAcceptanceReceiptReadyJobs: toArray(jobHints).filter((job) => job.previewAcceptanceReceiptReadiness?.state === "accepted" || job.previewAcceptanceReceiptReadiness?.state === "not-required").length,
    previewAcceptanceReceiptBlockedJobs: toArray(jobHints).filter((job) => job.previewAcceptanceReceiptReadiness?.state === "blocked").length,
    previewAcceptanceReceiptMissingJobs: toArray(jobHints).filter((job) => job.previewAcceptanceReceiptReadiness?.state === "needs-acceptance").length,
    previewAcceptanceReceiptRows: toArray(jobHints).reduce((count, job) => count + (job.previewAcceptanceReceiptReadiness?.counters?.rows ?? 0), 0),
    missingPreviewAcceptanceReceipts: toArray(jobHints).reduce((count, job) => count + (job.previewAcceptanceReceiptReadiness?.counters?.missing ?? 0), 0),
    rejectedPreviewAcceptanceReceipts: toArray(jobHints).reduce((count, job) => count + (job.previewAcceptanceReceiptReadiness?.counters?.rejected ?? 0), 0),
    expiredPreviewAcceptanceReceipts: toArray(jobHints).reduce((count, job) => count + (job.previewAcceptanceReceiptReadiness?.counters?.expired ?? 0), 0),
    previewActionPlanReadyJobs: toArray(jobHints).filter((job) => job.previewActionPlanReadiness?.state === "accepted" || job.previewActionPlanReadiness?.state === "not-required").length,
    previewActionPlanBlockedJobs: toArray(jobHints).filter((job) => job.previewActionPlanReadiness?.state === "blocked").length,
    previewActionPlanNeedsAcceptanceJobs: toArray(jobHints).filter((job) => job.previewActionPlanReadiness?.state === "needs-acceptance").length,
    previewActionPlanRows: toArray(jobHints).reduce((count, job) => count + (job.previewActionPlanReadiness?.counters?.rows ?? 0), 0),
    previewActionPlanBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.previewActionPlanReadiness?.counters?.blocked ?? 0), 0),
    previewActionPlanNeedsAcceptanceRows: toArray(jobHints).reduce((count, job) => count + (job.previewActionPlanReadiness?.counters?.needsAcceptance ?? 0), 0),
    blockedWorkflowCommands: toArray(jobHints).reduce((count, job) => count + (job.clientRuntimeAdoption?.workflow?.blockedWorkflowCommands?.length ?? 0), 0),
    readyWorkflowCommands: toArray(jobHints).reduce((count, job) => count + (job.clientRuntimeAdoption?.workflow?.readyWorkflowCommands?.length ?? 0), 0),
    adapterStatusReadyJobs: toArray(jobHints).filter((job) => job.adapterStatusReadiness?.acceptedForAdapter).length,
    adapterStatusBlockedJobs: toArray(jobHints).filter((job) => job.adapterStatusReadiness?.state === "blocked").length,
    adapterStatusWaitingJobs: toArray(jobHints).filter((job) => job.adapterStatusReadiness?.state === "waiting-adapter").length,
    adapterStatusMaterializationJobs: toArray(jobHints).filter((job) => job.adapterStatusReadiness?.state === "needs-status-materialization").length,
    providerSyncReadyJobs: toArray(jobHints).filter((job) => job.providerSyncReadiness?.state === "sync-ready").length,
    providerSyncBlockedJobs: toArray(jobHints).filter((job) => job.providerSyncReadiness?.state === "blocked").length,
    providerSyncNeedsCursorJobs: toArray(jobHints).filter((job) => job.providerSyncReadiness?.state === "needs-provider-confirmation").length,
    providerSyncRows: toArray(jobHints).reduce((count, job) => count + (job.providerSyncReadiness?.counters?.rows ?? 0), 0),
    segmentSyncReceiptAcceptedJobs: toArray(jobHints).filter((job) => job.segmentSyncReceiptReadiness?.state === "accepted").length,
    segmentSyncReceiptBlockedJobs: toArray(jobHints).filter((job) => job.segmentSyncReceiptReadiness?.state === "blocked").length,
    segmentSyncReceiptPendingJobs: toArray(jobHints).filter((job) => job.segmentSyncReceiptReadiness?.state === "pending-provider-confirmation").length,
    segmentSyncReceiptRows: toArray(jobHints).reduce((count, job) => count + (job.segmentSyncReceiptReadiness?.counters?.rows ?? 0), 0),
    segmentSyncReceiptBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.segmentSyncReceiptReadiness?.counters?.blocked ?? 0), 0),
    providerBudgetReadyJobs: toArray(jobHints).filter((job) => job.providerBudgetReadiness?.state === "budget-ready").length,
    providerBudgetBlockedJobs: toArray(jobHints).filter((job) => job.providerBudgetReadiness?.state === "blocked").length,
    providerBudgetThrottledJobs: toArray(jobHints).filter((job) => job.providerBudgetReadiness?.state === "throttled").length,
    providerBudgetRows: toArray(jobHints).reduce((count, job) => count + (job.providerBudgetReadiness?.counters?.rows ?? 0), 0),
    providerBudgetBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.providerBudgetReadiness?.counters?.blocked ?? 0), 0),
    providerCallbackReadyJobs: toArray(jobHints).filter((job) => job.providerCallbackReadiness?.state === "callback-ready").length,
    providerCallbackBlockedJobs: toArray(jobHints).filter((job) => job.providerCallbackReadiness?.state === "blocked").length,
    providerCallbackPendingJobs: toArray(jobHints).filter((job) => job.providerCallbackReadiness?.state === "pending-verification").length,
    providerCallbackRows: toArray(jobHints).reduce((count, job) => count + (job.providerCallbackReadiness?.counters?.rows ?? 0), 0),
    providerCallbackBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.providerCallbackReadiness?.counters?.blocked ?? 0), 0),
    providerEventSubscriptionReadyJobs: toArray(jobHints).filter((job) => job.providerEventSubscriptionReadiness?.state === "subscribed").length,
    providerEventSubscriptionBlockedJobs: toArray(jobHints).filter((job) => job.providerEventSubscriptionReadiness?.state === "blocked").length,
    providerEventSubscriptionPendingJobs: toArray(jobHints).filter((job) => job.providerEventSubscriptionReadiness?.state === "pending").length,
    providerEventSubscriptionRows: toArray(jobHints).reduce((count, job) => count + (job.providerEventSubscriptionReadiness?.counters?.rows ?? 0), 0),
    providerEventSubscriptionBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.providerEventSubscriptionReadiness?.counters?.blocked ?? 0), 0),
    providerEventSubscriptionMissingEvents: toArray(jobHints).reduce((count, job) => count + (job.providerEventSubscriptionReadiness?.counters?.missingEvents ?? 0), 0),
    providerMaintenanceReadyJobs: toArray(jobHints).filter((job) => job.providerMaintenanceReadiness?.state === "clear" || job.providerMaintenanceReadiness?.state === "not-required").length,
    providerMaintenanceBlockedJobs: toArray(jobHints).filter((job) => job.providerMaintenanceReadiness?.state === "blocked").length,
    providerMaintenanceDegradedJobs: toArray(jobHints).filter((job) => job.providerMaintenanceReadiness?.state === "degraded").length,
    providerMaintenanceRows: toArray(jobHints).reduce((count, job) => count + (job.providerMaintenanceReadiness?.counters?.rows ?? 0), 0),
    providerMaintenanceBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.providerMaintenanceReadiness?.counters?.blocked ?? 0), 0),
    providerServiceOutages: toArray(jobHints).reduce((count, job) => count + (job.providerMaintenanceReadiness?.counters?.serviceOutages ?? 0), 0),
    providerServiceDegraded: toArray(jobHints).reduce((count, job) => count + (job.providerMaintenanceReadiness?.counters?.serviceDegraded ?? 0), 0),
    providerServiceWriteUnavailable: toArray(jobHints).reduce((count, job) => count + (job.providerMaintenanceReadiness?.counters?.serviceWriteUnavailable ?? 0), 0),
    providerOperationalIncidentClearJobs: toArray(jobHints).filter((job) => ["clear", "not-required"].includes(job.providerOperationalIncidentReadiness?.state)).length,
    providerOperationalIncidentBlockedJobs: toArray(jobHints).filter((job) => job.providerOperationalIncidentReadiness?.state === "blocked").length,
    providerOperationalIncidentDegradedJobs: toArray(jobHints).filter((job) => job.providerOperationalIncidentReadiness?.state === "degraded").length,
    providerOperationalIncidentRows: toArray(jobHints).reduce((count, job) => count + (job.providerOperationalIncidentReadiness?.counters?.rows ?? 0), 0),
    providerOperationalIncidentBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.providerOperationalIncidentReadiness?.counters?.blocked ?? 0), 0),
    providerOperationalIncidentDegradedRows: toArray(jobHints).reduce((count, job) => count + (job.providerOperationalIncidentReadiness?.counters?.degraded ?? 0), 0),
    providerOperationalIncidentRetryableRows: toArray(jobHints).reduce((count, job) => count + (job.providerOperationalIncidentReadiness?.counters?.retryable ?? 0), 0),
    providerOperationalIncidentSources: [...new Set(toArray(jobHints).flatMap((job) => job.providerOperationalIncidentReadiness?.sources || []))].length,
    providerExportBoundaryReadyJobs: toArray(jobHints).filter((job) => job.providerExportBoundaryReadiness?.state === "export-ready").length,
    providerExportBoundaryBlockedJobs: toArray(jobHints).filter((job) => job.providerExportBoundaryReadiness?.state === "blocked").length,
    providerExportBoundaryStaleJobs: toArray(jobHints).filter((job) => job.providerExportBoundaryReadiness?.state === "stale").length,
    providerExportBoundaryRows: toArray(jobHints).reduce((count, job) => count + (job.providerExportBoundaryReadiness?.counters?.rows ?? 0), 0),
    providerExportBoundaryBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.providerExportBoundaryReadiness?.counters?.blocked ?? 0), 0),
    providerExportBoundaryRetryableRows: toArray(jobHints).reduce((count, job) => count + (job.providerExportBoundaryReadiness?.counters?.retryable ?? 0), 0),
    providerExportBoundaryLanes: toArray(jobHints).reduce((count, job) => count + (job.providerExportBoundaryReadiness?.counters?.lanes ?? 0), 0),
    publicationReceiptAcceptedJobs: toArray(jobHints).filter((job) => job.publicationReceiptReadiness?.state === "accepted").length,
    publicationReceiptBlockedJobs: toArray(jobHints).filter((job) => job.publicationReceiptReadiness?.state === "blocked").length,
    publicationReceiptPendingJobs: toArray(jobHints).filter((job) => job.publicationReceiptReadiness?.state === "pending-receipt").length,
    publicationReceiptRows: toArray(jobHints).reduce((count, job) => count + (job.publicationReceiptReadiness?.counters?.rows ?? 0), 0),
    publicationReceiptBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.publicationReceiptReadiness?.counters?.blocked ?? 0), 0),
    publicationReceiptPendingRows: toArray(jobHints).reduce((count, job) => count + (job.publicationReceiptReadiness?.counters?.pending ?? 0), 0),
    settingsAdoptionReadyJobs: toArray(jobHints).filter((job) => job.settingsAdoptionReadiness?.state === "adopted").length,
    settingsAdoptionBlockedJobs: toArray(jobHints).filter((job) => job.settingsAdoptionReadiness?.state === "blocked").length,
    settingsAdoptionPatchJobs: toArray(jobHints).filter((job) => job.settingsAdoptionReadiness?.state === "patch-required").length,
    settingsAdoptionRows: toArray(jobHints).reduce((count, job) => count + (job.settingsAdoptionReadiness?.counters?.rows ?? 0), 0),
    settingsAdoptionBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.settingsAdoptionReadiness?.counters?.blocked ?? 0), 0),
    lifecycleGateOpenJobs: toArray(jobHints).filter((job) => job.lifecycleGateReadiness?.state === "open").length,
    lifecycleGateBlockedJobs: toArray(jobHints).filter((job) => job.lifecycleGateReadiness?.state === "blocked").length,
    lifecycleGateGatedJobs: toArray(jobHints).filter((job) => job.lifecycleGateReadiness?.state === "gated").length,
    lifecycleGateRows: toArray(jobHints).reduce((count, job) => count + (job.lifecycleGateReadiness?.counters?.rows ?? 0), 0),
    lifecycleGateBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.lifecycleGateReadiness?.counters?.blocked ?? 0), 0),
    lifecycleGateDisabledRows: toArray(jobHints).reduce((count, job) => count + (job.lifecycleGateReadiness?.counters?.disabled ?? 0), 0),
    lifecycleGateScheduledRows: toArray(jobHints).reduce((count, job) => count + (job.lifecycleGateReadiness?.counters?.scheduled ?? 0), 0),
    lifecycleCommandReceiptBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.lifecycleGateReadiness?.counters?.overrideReceiptsBlocked ?? 0), 0),
    marketingConsentRequiredRows: toArray(jobHints).reduce((count, job) => count + (job.lifecycleGateReadiness?.counters?.consentRequired ?? 0), 0),
    marketingConsentBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.lifecycleGateReadiness?.counters?.consentBlocked ?? 0), 0),
    marketingConsentExpiredRows: toArray(jobHints).reduce((count, job) => count + (job.lifecycleGateReadiness?.counters?.consentExpired ?? 0), 0),
    adapterHandoffQueueableJobs: toArray(jobHints).filter((job) => job.adapterHandoffReadiness?.state === "queueable").length,
    adapterHandoffBlockedJobs: toArray(jobHints).filter((job) => job.adapterHandoffReadiness?.state === "blocked").length,
    adapterHandoffRows: toArray(jobHints).reduce((count, job) => count + (job.adapterHandoffReadiness?.counters?.rows ?? 0), 0),
    adapterHandoffQueueableRows: toArray(jobHints).reduce((count, job) => count + (job.adapterHandoffReadiness?.counters?.queueable ?? 0), 0),
    adapterHandoffReceiptReadyJobs: toArray(jobHints).filter((job) => ["accepted", "queueable", "not-applicable"].includes(job.adapterHandoffReceiptReadiness?.state)).length,
    adapterHandoffReceiptBlockedJobs: toArray(jobHints).filter((job) => job.adapterHandoffReceiptReadiness?.state === "blocked").length,
    adapterHandoffReceiptRows: toArray(jobHints).reduce((count, job) => count + (job.adapterHandoffReceiptReadiness?.counters?.rows ?? 0), 0),
    adapterHandoffReceiptAcceptedRows: toArray(jobHints).reduce((count, job) => count + (job.adapterHandoffReceiptReadiness?.counters?.accepted ?? 0), 0),
    adapterHandoffReceiptBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.adapterHandoffReceiptReadiness?.counters?.blocked ?? 0), 0),
    operationIdentityRows: toArray(jobHints).reduce((count, job) => count + (job.operationIdentityRegistry?.counters?.rows ?? 0), 0),
    operationIdentityBlockedJobs: toArray(jobHints).filter((job) => job.operationIdentityRegistry?.state === "blocked").length,
    operationIdentityBlockedRows: toArray(jobHints).reduce((count, job) => count + (job.operationIdentityRegistry?.counters?.blocked ?? 0), 0),
    recoveryCommandGraphBlockedJobs: toArray(jobHints).filter((job) => job.recoveryCommandGraph?.state === "blocked").length,
    recoveryCommandGraphReadyJobs: toArray(jobHints).filter((job) => job.recoveryCommandGraph?.state === "ready").length,
    recoveryCommands: toArray(jobHints).reduce((count, job) => count + (job.recoveryCommandGraph?.counters?.commands ?? 0), 0),
    blockedRecoveryCommands: toArray(jobHints).reduce((count, job) => count + (job.recoveryCommandGraph?.counters?.blocked ?? 0), 0),
    readyRecoveryCommands: toArray(jobHints).reduce((count, job) => count + (job.recoveryCommandGraph?.counters?.ready ?? 0), 0),
    replayableRecoveryCommands: toArray(jobHints).reduce((count, job) => count + (job.recoveryCommandGraph?.counters?.persistedLedgerReplayable ?? 0), 0),
    adapterStatusSnapshotRows: toArray(jobHints).reduce((count, job) => count + (job.persistedState?.adapterStatusSnapshotRows?.length ?? 0), 0),
    blockedAdapterStatusSnapshotRows: toArray(jobHints).reduce((count, job) => count + (job.persistedState?.blockedAdapterStatusSnapshotRows?.length ?? 0), 0),
    clientRuntimeBlockedJobs: toArray(jobHints).filter((job) => job.clientRuntimeAdoption?.state === "blocked").length,
    actionableErrors: toArray(jobHints).reduce((count, job) => count + (job.historySnapshot?.counters?.actionableErrors ?? 0), 0),
    historySnapshots: toArray(jobHints).filter((job) => job.historySnapshot).length,
    auditReadyJobs: toArray(jobHints).filter((job) => job.tenantBoundary?.violations?.length === 0).length,
    diagnostics: diagnostics.length,
    readyForCapabilityAnalysis: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
  });
}

export function createAiosPersistedStateManifest(typeHintResult = {}) {
  const jobs = toArray(typeHintResult.jobs);
  return Object.freeze({
    protocol: "aios.semantic.persisted-state-manifest.v1",
    status: jobs.some((job) => job.persistedState?.restartStatus === "restart-blocked" || job.persistedState?.restartCommandManifest?.state === "blocked") ? "blocked" : "ready",
    jobs: freezeArray(jobs.map((job) => ({
      jobName: job.jobName,
      restartStatus: job.persistedState?.restartStatus || "unknown",
      storageKey: job.persistedState?.storageKey || "",
      commandKey: job.persistedState?.commandKey || "",
      resumeCursorKey: job.persistedState?.resumeCursorKey || "",
      statusSnapshotKey: job.persistedState?.statusSnapshotKey || "",
      adapterStatusSnapshotState: job.persistedState?.adapterStatusSnapshotState || "not-required",
      adapterStatusSnapshotRows: job.persistedState?.adapterStatusSnapshotRows || freezeArray([]),
      blockedAdapterStatusSnapshotRows: job.persistedState?.blockedAdapterStatusSnapshotRows || freezeArray([]),
      operationIdentityRegistry: job.operationIdentityRegistry || null,
      statusChannel: job.persistedState?.statusChannel || "",
      idempotentCommands: job.persistedState?.idempotentCommands || freezeArray([]),
      restartCommands: job.persistedState?.restartCommands || freezeArray([]),
      restartCommandManifest: job.persistedState?.restartCommandManifest || null,
      resumptionJournal: job.persistedState?.resumptionJournal || null,
      persistedRecoveryLedger: job.persistedState?.persistedRecoveryLedger || null,
      recoveryCheckpointManifest: job.persistedState?.recoveryCheckpointManifest || null,
      recoveryCheckpointReadiness: job.recoveryCheckpointReadiness || null,
      recoveryCheckpointRows: job.persistedState?.recoveryCheckpointRows || freezeArray([]),
      blockedRecoveryCheckpointRows: job.persistedState?.blockedRecoveryCheckpointRows || freezeArray([]),
      replayableRecoveryCheckpointRows: job.persistedState?.replayableRecoveryCheckpointRows || freezeArray([]),
      tenantBoundary: job.tenantBoundary || null,
      boundaryHealth: job.boundaryHealth || null,
      permissionPosture: job.permissionPosture || job.boundaryHealth?.permissionPosture || job.scope?.permissionPosture || null,
      adapterStatusReadiness: job.adapterStatusReadiness || null,
      providerSyncReadiness: job.providerSyncReadiness || null,
      adapterHandoffReadiness: job.adapterHandoffReadiness || null,
      adapterHandoffReceiptReadiness: job.adapterHandoffReceiptReadiness || null,
      adapterHandoffReceipts: job.scope?.adapterHandoffReceipts?.rows || freezeArray([]),
      blockedAdapterHandoffReceipts: job.scope?.adapterHandoffReceipts?.blockedRows || freezeArray([]),
      acceptedAdapterHandoffReceipts: job.scope?.adapterHandoffReceipts?.acceptedRows || freezeArray([]),
      providerCallbackReadiness: job.providerCallbackReadiness || null,
      providerEventSubscriptionReadiness: job.providerEventSubscriptionReadiness || null,
      providerMaintenanceReadiness: job.providerMaintenanceReadiness || null,
      providerOperationalIncidentReadiness: job.providerOperationalIncidentReadiness || null,
      settingsAdoptionReadiness: job.settingsAdoptionReadiness || null,
      providerExportBoundaryReadiness: job.providerExportBoundaryReadiness || null,
      providerLeases: job.persistedState?.providerLeases || freezeArray([]),
      clientRuntimeAdoption: job.clientRuntimeAdoption || null,
      runtimeReadiness: job.runtimeReadiness || null,
      previewAcceptanceReceiptReadiness: job.previewAcceptanceReceiptReadiness || null,
      previewActionPlanReadiness: job.previewActionPlanReadiness || null,
      recoveryCommandGraph: job.recoveryCommandGraph || null,
      clientCommandReceiptReadiness: job.clientCommandReceiptReadiness || null,
      clientCommandReceipts: job.persistedState?.clientCommandReceipts || freezeArray([]),
      blockedClientCommandReceipts: job.persistedState?.blockedClientCommandReceipts || freezeArray([]),
      acceptedClientCommandReceipts: job.persistedState?.acceptedClientCommandReceipts || freezeArray([]),
      clientWorkflowCommands: job.clientRuntimeAdoption?.workflow?.clientWorkflowCommands || freezeArray([]),
      blockedWorkflowCommands: job.clientRuntimeAdoption?.workflow?.blockedWorkflowCommands || freezeArray([]),
      readyWorkflowCommands: job.clientRuntimeAdoption?.workflow?.readyWorkflowCommands || freezeArray([]),
    }))),
  });
}
