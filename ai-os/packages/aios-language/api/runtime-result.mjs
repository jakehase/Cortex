import {
  mergeTruthBoundaries,
  exportTruthBoundaryReport,
  normalizeOperationalHealth,
  normalizeTruthBoundary,
  summarizeOperationalHealth,
  summarizeTruthBoundary,
} from "./truth-boundary.mjs";

const RUNTIME_STATUSES = new Set(["queued", "running", "succeeded", "failed", "rolled-back", "needs-operator"]);

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function event(kind, message, details = {}) {
  return {
    kind,
    message,
    details,
    at: details.at ?? null,
  };
}

function normalizeAdapterReceipt(receipt = {}) {
  return {
    adapter: cleanText(receipt.adapter) || "local",
    status: cleanText(receipt.status) || "accepted",
    receiptId: cleanText(receipt.receiptId ?? receipt.id) || null,
    externalWrite: Boolean(receipt.externalWrite),
    externalReferences: asArray(receipt.externalReferences ?? receipt.externalReference).map(cleanText).filter(Boolean),
    tenantId: cleanText(receipt.tenantId ?? receipt.tenant) || null,
    workspaceId: cleanText(receipt.workspaceId ?? receipt.workspace) || null,
    role: cleanText(receipt.role) || null,
    permissions: asArray(receipt.permissions ?? receipt.permission).map(cleanText).filter(Boolean),
  };
}

function normalizeRollbackState(rollback = {}) {
  const attempted = Boolean(rollback.attempted);
  const completed = Boolean(rollback.completed);
  return {
    required: rollback.required !== false,
    attempted,
    completed,
    status: completed ? "completed" : attempted ? "attempted" : rollback.required === false ? "not-required" : "pending",
    action: cleanText(rollback.action) || null,
    reason: cleanText(rollback.reason) || null,
  };
}

function normalizeRuntimeEvent(raw, index) {
  if (typeof raw === "string") return event("info", raw, { index });
  return {
    kind: cleanText(raw?.kind) || "info",
    message: cleanText(raw?.message ?? raw?.text) || `runtime event ${index + 1}`,
    details: raw?.details && typeof raw.details === "object" ? { ...raw.details } : {},
    at: raw?.at ?? null,
  };
}

function normalizeCommandOutcome(raw, index) {
  if (typeof raw === "string") {
    return {
      id: `command-${index + 1}`,
      idempotencyKey: cleanText(raw),
      status: "succeeded",
      replayed: false,
      recoverable: true,
      message: null,
    };
  }
  return {
    id: cleanText(raw?.id) || `command-${index + 1}`,
    idempotencyKey: cleanText(raw?.idempotencyKey ?? raw?.idempotency) || cleanText(raw?.id) || `command-${index + 1}`,
    status: cleanText(raw?.status) || "pending",
    replayed: Boolean(raw?.replayed),
    recoverable: raw?.recoverable !== false,
    message: cleanText(raw?.message) || null,
  };
}

function findCompileJob(compileResult, jobId) {
  const jobs = asArray(compileResult?.jobs);
  if (jobId) {
    const matched = jobs.find((job) => job.id === jobId);
    if (matched) return matched;
  }
  return jobs[0] ?? null;
}

function findStatusHandoff(input = {}, compileResult = null, jobId = null) {
  const explicit = input.statusHandoff ?? input.handoffStatus ?? null;
  if (explicit) return explicit;
  const handoffs = asArray(compileResult?.statusHandoffs);
  if (jobId) {
    const matched = handoffs.find((handoff) => handoff?.jobId === jobId);
    if (matched) return matched;
  }
  return handoffs[0] ?? null;
}

function normalizeStatusHandoff(handoff = {}, compileJob = null) {
  const request = compileJob?.requestContract ?? {};
  const policy = compileJob?.accessPolicy ?? {};
  const persisted = compileJob?.persistedState ?? {};
  const compiledManifest = compileJob?.scopeAuditManifest ?? null;
  return {
    handoffKind: cleanText(handoff?.handoffKind) || "aios.compile.status-handoff.v1",
    handoffId: cleanText(handoff?.handoffId ?? handoff?.id) || `${request.idempotencyKey ?? "runtime"}:${compileJob?.id ?? "job"}:status`,
    jobId: cleanText(handoff?.jobId) || compileJob?.id || null,
    expectedAdapter: cleanText(handoff?.expectedAdapter ?? handoff?.adapter) || compileJob?.adapter || "local",
    status: cleanText(handoff?.status) || "ready",
    statusOnFailure: cleanText(handoff?.statusOnFailure) || compileJob?.recovery?.statusOnFailure || "needs-operator",
    tenantId: cleanText(handoff?.tenantId) || request.tenantId || "local",
    workspaceId: cleanText(handoff?.workspaceId) || request.workspaceId || "default",
    scopeKey: cleanText(handoff?.scopeKey) || policy.scopeKey || `${request.tenantId ?? "local"}:${request.workspaceId ?? "default"}`,
    idempotencyKey: cleanText(handoff?.idempotencyKey) || request.idempotencyKey || null,
    resumeCursor: cleanText(handoff?.resumeCursor) || persisted.resumeCursor || null,
    restartToken: cleanText(handoff?.restartToken) || persisted.restartToken || null,
    restartFingerprint: cleanText(handoff?.restartFingerprint) || persisted.restartFingerprint || null,
    boundaryMode: cleanText(handoff?.boundaryMode) || policy.boundaryMode || "local-only",
    localOnly: handoff?.localOnly ?? policy.localOnly ?? true,
    auditRequired: handoff?.auditRequired ?? policy.audit?.required ?? true,
    auditTarget: cleanText(handoff?.auditTarget) || policy.audit?.handoff || null,
    requiredRole: cleanText(handoff?.requiredRole) || policy.defaultRole || null,
    requiredPermissions: asArray(handoff?.requiredPermissions ?? handoff?.permissions ?? policy.permissions).map(cleanText).filter(Boolean),
    capabilityManifest: asArray(handoff?.capabilityManifest ?? compileJob?.capabilities?.map((capability) => capability.name)).map(cleanText).filter(Boolean),
    requiredRuntimeReceipts: asArray(handoff?.requiredRuntimeReceipts ?? handoff?.receipts).map(cleanText).filter(Boolean),
    readiness: handoff?.readiness && typeof handoff.readiness === "object" ? { ...handoff.readiness } : {},
    scopeAuditManifest: handoff?.scopeAuditManifest && typeof handoff.scopeAuditManifest === "object"
      ? { ...handoff.scopeAuditManifest }
      : compiledManifest
        ? {
            manifestId: compiledManifest.manifestId,
            restartDecision: compiledManifest.restartDecision,
            readyForRuntime: compiledManifest.readyForRuntime,
            commandCount: compiledManifest.counters.commandCount,
            openRequiredCheckpointCount: compiledManifest.counters.openRequiredCheckpointCount,
            requiredReceiptCount: compiledManifest.counters.requiredReceiptCount,
          }
        : null,
    permissionBoundaryManifest: handoff?.permissionBoundaryManifest && typeof handoff.permissionBoundaryManifest === "object"
      ? { ...handoff.permissionBoundaryManifest }
      : compileJob?.permissionBoundaryManifest
        ? {
            manifestId: compileJob.permissionBoundaryManifest.manifestId,
            decisionState: compileJob.permissionBoundaryManifest.decision.state,
            decisionReason: compileJob.permissionBoundaryManifest.decision.reason,
            nextAction: compileJob.permissionBoundaryManifest.decision.nextAction,
            readyForRuntime: compileJob.permissionBoundaryManifest.readyForRuntime,
          }
        : null,
    truth: handoff?.truth && typeof handoff.truth === "object" ? { ...handoff.truth } : {},
    health: handoff?.health && typeof handoff.health === "object" ? { ...handoff.health } : {},
  };
}

function normalizeRuntimeScope(input = {}, compileJob = null, adapterReceipt = {}) {
  const request = compileJob?.requestContract ?? {};
  const accessPolicy = compileJob?.accessPolicy ?? {};
  const tenantId = cleanText(input.tenantId ?? input.tenant ?? adapterReceipt.tenantId ?? request.tenantId) || "local";
  const workspaceId = cleanText(input.workspaceId ?? input.workspace ?? adapterReceipt.workspaceId ?? request.workspaceId) || "default";
  const role = cleanText(input.role ?? adapterReceipt.role) || accessPolicy.defaultRole || "runtime-adapter";
  const permissions = asArray(input.permissions ?? input.permission ?? adapterReceipt.permissions)
    .map(cleanText)
    .filter(Boolean);
  const allowedCapabilities = asArray(compileJob?.capabilities).map((capability) => capability.name);
  const policyPermissions = asArray(accessPolicy.permissions).map(cleanText).filter(Boolean);
  const requestedPermissions = permissions.length > 0
    ? permissions
    : policyPermissions.length > 0
      ? policyPermissions
      : allowedCapabilities;

  return {
    tenantId,
    workspaceId,
    role,
    permissions: requestedPermissions,
    allowedCapabilities,
    allowedRoles: asArray(accessPolicy.roles).map(cleanText).filter(Boolean),
    policyPermissions,
    boundaryMode: cleanText(accessPolicy.boundaryMode) || (compileJob?.memory?.localOnly === false ? "external-reviewed" : "local-only"),
    auditRequired: accessPolicy.audit?.required !== false,
    auditTarget: cleanText(accessPolicy.audit?.handoff) || null,
    scopeKey: cleanText(accessPolicy.scopeKey) || `${tenantId}:${workspaceId}`,
    tenantIsolation: accessPolicy.tenantIsolation !== false,
    workspaceIsolation: accessPolicy.workspaceIsolation !== false,
    localOnly: compileJob?.memory?.localOnly !== false,
  };
}

function boundaryError(code, message, details = {}) {
  return {
    code,
    message,
    recoverable: false,
    boundary: true,
    details,
  };
}

function validateStatusHandoff(statusHandoff, runtimeScope, adapterReceipt, compileJob) {
  const errors = [];
  if (!statusHandoff) return errors;

  if (compileJob?.id && statusHandoff.jobId && compileJob.id !== statusHandoff.jobId) {
    errors.push(boundaryError("AIOS_STATUS_HANDOFF_JOB_MISMATCH", "Runtime status handoff job does not match the compiled job.", {
      expected: compileJob.id,
      actual: statusHandoff.jobId,
    }));
  }
  if (statusHandoff.expectedAdapter && adapterReceipt.adapter !== statusHandoff.expectedAdapter) {
    errors.push(boundaryError("AIOS_STATUS_HANDOFF_ADAPTER_MISMATCH", "Runtime adapter receipt does not match the compiled status handoff adapter.", {
      expected: statusHandoff.expectedAdapter,
      actual: adapterReceipt.adapter,
    }));
  }
  if (statusHandoff.tenantId && statusHandoff.tenantId !== runtimeScope.tenantId) {
    errors.push(boundaryError("AIOS_STATUS_HANDOFF_TENANT_MISMATCH", "Runtime tenant does not match the compiled status handoff tenant.", {
      expected: statusHandoff.tenantId,
      actual: runtimeScope.tenantId,
    }));
  }
  if (statusHandoff.workspaceId && statusHandoff.workspaceId !== runtimeScope.workspaceId) {
    errors.push(boundaryError("AIOS_STATUS_HANDOFF_WORKSPACE_MISMATCH", "Runtime workspace does not match the compiled status handoff workspace.", {
      expected: statusHandoff.workspaceId,
      actual: runtimeScope.workspaceId,
    }));
  }
  if (statusHandoff.localOnly && adapterReceipt.externalWrite) {
    errors.push(boundaryError("AIOS_STATUS_HANDOFF_EXTERNAL_WRITE", "Runtime adapter performed an external write for a local-only status handoff.", {
      adapter: adapterReceipt.adapter,
      handoffId: statusHandoff.handoffId,
    }));
  }
  if (statusHandoff.status === "needs-review" && !statusHandoff.requiredRuntimeReceipts.includes("truth-review")) {
    errors.push({
      code: "AIOS_STATUS_HANDOFF_REVIEW_UNCLASSIFIED",
      message: "Status handoff needs review without a required runtime review receipt.",
      recoverable: true,
      boundary: false,
      details: { handoffId: statusHandoff.handoffId },
    });
  }
  return errors;
}

function normalizeRuntimeReceiptSet(input = {}, adapterReceipt, auditHandoff = null) {
  const explicit = asArray(input.runtimeReceipts ?? input.receipts ?? input.receiptTypes).map(cleanText).filter(Boolean);
  const receipts = new Set(explicit);
  if (adapterReceipt.receiptId || adapterReceipt.status) receipts.add("adapter-receipt");
  if (auditHandoff?.auditId) receipts.add("audit-handoff");
  if (asArray(input.commandOutcomes ?? input.commands ?? input.command).length > 0) receipts.add("command-ledger");
  if (input.truthReview || input.truthReviewed) receipts.add("truth-review");
  return [...receipts];
}

function compareList(expected = [], actual = []) {
  const actualSet = new Set(actual.map((value) => value.toLowerCase()));
  return expected.filter((value) => !actualSet.has(value.toLowerCase()));
}

function validateScopeAuditManifest({
  compileJob,
  statusHandoff,
  runtimeScope,
  commandRecovery,
  runtimeReceipts,
}) {
  const errors = [];
  const manifest = compileJob?.scopeAuditManifest ?? null;
  const handoffManifest = statusHandoff?.scopeAuditManifest ?? null;
  if (!manifest) {
    return {
      manifest: null,
      runtimeReceipts,
      missingReceipts: [],
      missingPermissions: [],
      restartMatches: true,
      ready: true,
      errors,
    };
  }

  if (handoffManifest?.manifestId && handoffManifest.manifestId !== manifest.manifestId) {
    errors.push(boundaryError(
      "AIOS_SCOPE_AUDIT_MANIFEST_ID_MISMATCH",
      "Runtime status handoff references a different scope audit manifest than the compiled job.",
      { expected: manifest.manifestId, actual: handoffManifest.manifestId },
    ));
  }
  if (manifest.tenantId !== runtimeScope.tenantId) {
    errors.push(boundaryError(
      "AIOS_SCOPE_AUDIT_TENANT_MISMATCH",
      "Runtime tenant does not match the compiled scope audit manifest.",
      { expected: manifest.tenantId, actual: runtimeScope.tenantId },
    ));
  }
  if (manifest.workspaceId !== runtimeScope.workspaceId) {
    errors.push(boundaryError(
      "AIOS_SCOPE_AUDIT_WORKSPACE_MISMATCH",
      "Runtime workspace does not match the compiled scope audit manifest.",
      { expected: manifest.workspaceId, actual: runtimeScope.workspaceId },
    ));
  }
  if (manifest.restartToken && commandRecovery.restartToken && manifest.restartToken !== commandRecovery.restartToken) {
    errors.push(boundaryError(
      "AIOS_SCOPE_AUDIT_RESTART_TOKEN_MISMATCH",
      "Runtime restart token does not match the compiled scope audit manifest.",
      { expected: manifest.restartToken, actual: commandRecovery.restartToken },
    ));
  }
  if (manifest.restartFingerprint && commandRecovery.restartFingerprint && manifest.restartFingerprint !== commandRecovery.restartFingerprint) {
    errors.push(boundaryError(
      "AIOS_SCOPE_AUDIT_FINGERPRINT_MISMATCH",
      "Runtime restart fingerprint does not match the compiled scope audit manifest.",
      { expected: manifest.restartFingerprint, actual: commandRecovery.restartFingerprint },
    ));
  }

  const expectedReceipts = manifest.requiredRuntimeReceipts.filter((receipt) => receipt.required).map((receipt) => receipt.receipt);
  const missingReceipts = compareList(expectedReceipts, runtimeReceipts);
  for (const receipt of missingReceipts) {
    errors.push({
      code: "AIOS_SCOPE_AUDIT_RECEIPT_MISSING",
      message: `Runtime did not provide required receipt "${receipt}" for the compiled scope audit manifest.`,
      recoverable: receipt !== "adapter-receipt",
      boundary: false,
      details: { manifestId: manifest.manifestId, receipt },
    });
  }

  const missingPermissions = compareList(manifest.requiredPermissions, runtimeScope.permissions);
  for (const permission of missingPermissions) {
    errors.push(boundaryError(
      "AIOS_SCOPE_AUDIT_PERMISSION_MISSING",
      `Runtime scope is missing permission "${permission}" required by the compiled scope audit manifest.`,
      { manifestId: manifest.manifestId, permission },
    ));
  }

  const manifestCommandCount = Number(manifest.counters?.commandCount ?? manifest.commands?.length ?? 0);
  if (manifestCommandCount !== commandRecovery.summary.commandCount) {
    errors.push({
      code: "AIOS_SCOPE_AUDIT_COMMAND_LEDGER_MISMATCH",
      message: "Runtime command ledger count does not match the compiled scope audit manifest.",
      recoverable: true,
      boundary: false,
      details: {
        manifestId: manifest.manifestId,
        expected: manifestCommandCount,
        actual: commandRecovery.summary.commandCount,
      },
    });
  }

  const restartMatches = errors.every((error) => ![
    "AIOS_SCOPE_AUDIT_RESTART_TOKEN_MISMATCH",
    "AIOS_SCOPE_AUDIT_FINGERPRINT_MISMATCH",
    "AIOS_SCOPE_AUDIT_TENANT_MISMATCH",
    "AIOS_SCOPE_AUDIT_WORKSPACE_MISMATCH",
  ].includes(error.code));

  return {
    manifest: {
      manifestId: manifest.manifestId,
      restartDecision: manifest.restartDecision,
      readyForRuntime: manifest.readyForRuntime,
      statusOnRestart: manifest.statusOnRestart,
      statusOnFailure: manifest.statusOnFailure,
    },
    runtimeReceipts,
    missingReceipts,
    missingPermissions,
    restartMatches,
    ready: manifest.readyForRuntime && missingReceipts.length === 0 && missingPermissions.length === 0 && restartMatches,
    errors,
  };
}

function validateRuntimeBoundary(scope, compileJob, adapterReceipt) {
  const errors = [];
  const request = compileJob?.requestContract ?? {};
  if (scope.tenantIsolation && request.tenantId && request.tenantId !== scope.tenantId) {
    errors.push(boundaryError("AIOS_TENANT_SCOPE_MISMATCH", "Runtime tenant does not match the compiled request tenant.", {
      expected: request.tenantId,
      actual: scope.tenantId,
    }));
  }
  if (scope.workspaceIsolation && request.workspaceId && request.workspaceId !== scope.workspaceId) {
    errors.push(boundaryError("AIOS_WORKSPACE_SCOPE_MISMATCH", "Runtime workspace does not match the compiled request workspace.", {
      expected: request.workspaceId,
      actual: scope.workspaceId,
    }));
  }
  if (adapterReceipt.externalWrite && scope.localOnly) {
    errors.push(boundaryError("AIOS_EXTERNAL_WRITE_BLOCKED", "Runtime adapter attempted an external write for a local-only job.", {
      adapter: adapterReceipt.adapter,
    }));
  }
  if (scope.allowedRoles.length > 0 && !scope.allowedRoles.some((role) => role.toLowerCase() === scope.role.toLowerCase())) {
    errors.push(boundaryError("AIOS_ROLE_NOT_ALLOWED", `Runtime role "${scope.role}" is not allowed for this compiled job.`, {
      role: scope.role,
      allowedRoles: scope.allowedRoles,
    }));
  }

  const allowed = new Set(scope.allowedCapabilities.map((capability) => capability.toLowerCase()));
  const policyAllowed = new Set(scope.policyPermissions.map((permission) => permission.toLowerCase()));
  for (const permission of scope.permissions) {
    if (policyAllowed.size > 0 && !policyAllowed.has(permission.toLowerCase())) {
      errors.push(boundaryError("AIOS_PERMISSION_NOT_ALLOWED_BY_POLICY", `Runtime permission "${permission}" is outside the compiled access policy.`, {
        permission,
      }));
      continue;
    }
    if (allowed.size > 0 && !allowed.has(permission.toLowerCase())) {
      errors.push(boundaryError("AIOS_PERMISSION_OUTSIDE_CAPABILITY", `Runtime permission "${permission}" is outside the compiled capability manifest.`, {
        permission,
      }));
    }
  }
  return errors;
}

function validatePermissionBoundaryManifest({
  compileJob,
  statusHandoff,
  runtimeScope,
  adapterReceipt,
  runtimeReceipts,
}) {
  const manifest = compileJob?.permissionBoundaryManifest ?? null;
  const handoffManifest = statusHandoff?.permissionBoundaryManifest ?? null;
  const errors = [];
  if (!manifest) {
    return {
      manifest: null,
      decision: { state: "unavailable", reason: "manifest-not-compiled", nextAction: "operator-review" },
      accepted: true,
      missingReceipts: [],
      missingPermissions: [],
      roleAccepted: true,
      scopeAccepted: true,
      externalWriteAccepted: !adapterReceipt.externalWrite,
      errors,
    };
  }

  if (handoffManifest?.manifestId && handoffManifest.manifestId !== manifest.manifestId) {
    errors.push(boundaryError(
      "AIOS_PERMISSION_BOUNDARY_MANIFEST_ID_MISMATCH",
      "Runtime status handoff references a different permission boundary manifest than the compiled job.",
      { expected: manifest.manifestId, actual: handoffManifest.manifestId },
    ));
  }

  const roleAccepted = manifest.allowedRoles.length === 0
    || manifest.allowedRoles.some((role) => role.toLowerCase() === runtimeScope.role.toLowerCase());
  if (!roleAccepted) {
    errors.push(boundaryError(
      "AIOS_PERMISSION_BOUNDARY_ROLE_REJECTED",
      `Runtime role "${runtimeScope.role}" is outside the compiled permission boundary.`,
      { role: runtimeScope.role, allowedRoles: manifest.allowedRoles },
    ));
  }

  const missingPermissions = compareList(manifest.requiredPermissions, runtimeScope.permissions);
  for (const permission of missingPermissions) {
    errors.push(boundaryError(
      "AIOS_PERMISSION_BOUNDARY_PERMISSION_MISSING",
      `Runtime permission boundary is missing required permission "${permission}".`,
      { manifestId: manifest.manifestId, permission },
    ));
  }

  const missingReceipts = compareList(manifest.audit.requiredReceipts, runtimeReceipts);
  for (const receipt of missingReceipts) {
    errors.push({
      code: "AIOS_PERMISSION_BOUNDARY_RECEIPT_MISSING",
      message: `Runtime permission boundary did not provide required receipt "${receipt}".`,
      recoverable: receipt !== "adapter-receipt",
      boundary: false,
      details: { manifestId: manifest.manifestId, receipt },
    });
  }

  const scopeAccepted = (!manifest.isolation.tenant || manifest.tenantId === runtimeScope.tenantId)
    && (!manifest.isolation.workspace || manifest.workspaceId === runtimeScope.workspaceId);
  if (!scopeAccepted) {
    errors.push(boundaryError(
      "AIOS_PERMISSION_BOUNDARY_SCOPE_REJECTED",
      "Runtime tenant/workspace scope is outside the compiled permission boundary.",
      {
        expectedTenantId: manifest.tenantId,
        actualTenantId: runtimeScope.tenantId,
        expectedWorkspaceId: manifest.workspaceId,
        actualWorkspaceId: runtimeScope.workspaceId,
      },
    ));
  }

  const externalWriteAccepted = !adapterReceipt.externalWrite || !manifest.isolation.localOnly;
  if (!externalWriteAccepted) {
    errors.push(boundaryError(
      "AIOS_PERMISSION_BOUNDARY_EXTERNAL_WRITE_REJECTED",
      "Runtime adapter external write is outside the compiled local-only permission boundary.",
      { adapter: adapterReceipt.adapter, manifestId: manifest.manifestId },
    ));
  }

  const decision = errors.some((error) => error.boundary)
    ? { state: "blocked", reason: "runtime-boundary-violation", nextAction: "operator-review" }
    : missingReceipts.length > 0 || manifest.decision.state === "review"
      ? { state: "review", reason: missingReceipts.length > 0 ? "receipt-review" : manifest.decision.reason, nextAction: "audit-review" }
      : manifest.decision;

  return {
    manifest: {
      manifestId: manifest.manifestId,
      tenantId: manifest.tenantId,
      workspaceId: manifest.workspaceId,
      scopeKey: manifest.scopeKey,
      decisionState: manifest.decision.state,
      decisionReason: manifest.decision.reason,
      readyForRuntime: manifest.readyForRuntime,
    },
    decision,
    accepted: decision.state !== "blocked",
    missingReceipts,
    missingPermissions,
    roleAccepted,
    scopeAccepted,
    externalWriteAccepted,
    errors,
  };
}

function buildCommandRecoveryState(compileJob, input = {}) {
  const persisted = compileJob?.persistedState ?? {};
  const expectedCommands = asArray(persisted.commands);
  const expectedByKey = new Map(expectedCommands.map((command) => [command.idempotencyKey.toLowerCase(), command]));
  const outcomes = asArray(input.commandOutcomes ?? input.commands ?? input.command).map(normalizeCommandOutcome);
  const outcomeByKey = new Map(outcomes.map((outcome) => [outcome.idempotencyKey.toLowerCase(), outcome]));
  const commands = expectedCommands.map((command) => {
    const outcome = outcomeByKey.get(command.idempotencyKey.toLowerCase());
    const status = outcome?.status || command.status || "pending";
    return {
      id: command.id,
      name: command.name,
      idempotencyKey: command.idempotencyKey,
      expectedStatus: command.status,
      status,
      replayable: command.replayable,
      replayed: Boolean(outcome?.replayed),
      recoverable: outcome?.recoverable !== false && command.replayable !== false,
      checkpoint: command.checkpoint,
      message: outcome?.message || null,
    };
  });
  for (const outcome of outcomes) {
    if (!expectedByKey.has(outcome.idempotencyKey.toLowerCase())) {
      commands.push({
        id: outcome.id,
        name: "adapter-reported-command",
        idempotencyKey: outcome.idempotencyKey,
        expectedStatus: "unplanned",
        status: outcome.status,
        replayable: false,
        replayed: outcome.replayed,
        recoverable: false,
        checkpoint: null,
        message: outcome.message,
      });
    }
  }

  const failed = commands.filter((command) => command.status === "failed");
  const pending = commands.filter((command) => command.status === "pending" || command.status === "queued");
  const replayablePending = pending.filter((command) => command.replayable && command.recoverable);
  const checkpointKeys = new Set(commands.filter((command) => command.status === "succeeded" || command.status === "completed").map((command) => command.checkpoint).filter(Boolean));
  const checkpoints = asArray(persisted.checkpoints).map((checkpoint) => ({
    ...checkpoint,
    runtimeStatus: checkpointKeys.has(checkpoint.key) ? "completed" : checkpoint.status,
  }));
  const requiredOpen = checkpoints.filter((checkpoint) => checkpoint.required && checkpoint.runtimeStatus !== "completed" && checkpoint.runtimeStatus !== "succeeded");
  const restartSafe = persisted.restartSafe !== false && commands.every((command) => command.replayable || command.status === "succeeded" || command.status === "completed");

  return {
    snapshotKey: persisted.snapshotKey ?? null,
    restartToken: persisted.restartToken ?? null,
    resumeCursor: cleanText(input.resumeCursor ?? persisted.resumeCursor) || null,
    restartFingerprint: persisted.restartFingerprint ?? null,
    restartSafe,
    resumeMode: persisted.resumeMode ?? "idempotent-replay",
    statusOnRestart: persisted.statusOnRestart ?? compileJob?.recovery?.statusOnFailure ?? "needs-operator",
    commands,
    checkpoints,
    nextReplayCommands: replayablePending.map((command) => ({
      id: command.id,
      name: command.name,
      idempotencyKey: command.idempotencyKey,
      checkpoint: command.checkpoint,
    })),
    summary: {
      commandCount: commands.length,
      failedCommandCount: failed.length,
      pendingCommandCount: pending.length,
      replayablePendingCount: replayablePending.length,
      openRequiredCheckpointCount: requiredOpen.length,
      restartSafe,
      replayRecommended: restartSafe && replayablePending.length > 0 && failed.length === 0,
    },
  };
}

function deriveRetryDecision(health, commandRecovery, errors, compileJob, scopeAudit = null) {
  const retry = health.retry ?? {};
  const retryBudgetOpen = retry.allowed && retry.attempt < retry.maxAttempts;
  const recoverableErrors = errors.every((error) => error.recoverable);
  const retryLimit = Number.isFinite(compileJob?.recovery?.retryLimit) ? compileJob.recovery.retryLimit : 0;
  const commandReplay = commandRecovery.summary.replayRecommended;
  const scopeReady = !scopeAudit || scopeAudit.ready || scopeAudit.missingReceipts.length > 0;
  const restartMatches = !scopeAudit || scopeAudit.restartMatches;
  const allowed = (retryBudgetOpen || commandReplay || retryLimit > 0)
    && recoverableErrors
    && commandRecovery.restartSafe
    && scopeReady
    && restartMatches;
  return {
    allowed,
    reason: allowed
      ? (commandReplay ? "idempotent-command-replay" : "health-retry-budget")
      : scopeAudit && !scopeAudit.restartMatches
        ? "restart-manifest-mismatch"
        : errors.length
          ? "non-recoverable-or-boundary-error"
          : "not-needed",
    nextRetryAt: retry.nextRetryAt,
    backoffMs: retry.backoffMs,
    attempt: retry.attempt,
    maxAttempts: Math.max(retry.maxAttempts, retryLimit),
  };
}

function normalizeAuditHandoff(input = {}, scope, adapterReceipt, compileJob) {
  const idempotencyKey = cleanText(compileJob?.requestContract?.idempotencyKey) || cleanText(input.idempotencyKey) || "runtime";
  return {
    auditId: cleanText(input.auditId ?? input.id) || `${scope.tenantId}:${scope.workspaceId}:${idempotencyKey}`,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    actorRole: scope.role,
    adapter: adapterReceipt.adapter,
    receiptId: adapterReceipt.receiptId,
    permissionCount: scope.permissions.length,
    externalWrite: adapterReceipt.externalWrite,
    boundaryMode: scope.boundaryMode,
    auditTarget: scope.auditTarget,
  };
}

function buildRuntimeAnalytics(status, events, errors, commandRecovery, retryDecision, runtimeScope, scopeAudit, permissionBoundary) {
  const countsByKind = {};
  for (const entry of events) {
    countsByKind[entry.kind] = (countsByKind[entry.kind] ?? 0) + 1;
  }
  const recoverableErrorCount = errors.filter((error) => error.recoverable).length;
  const boundaryErrorCount = errors.filter((error) => error.boundary).length;
  return {
    counters: {
      eventCount: events.length,
      errorCount: errors.length,
      recoverableErrorCount,
      boundaryErrorCount,
      commandCount: commandRecovery.summary.commandCount,
      pendingCommandCount: commandRecovery.summary.pendingCommandCount,
      replayablePendingCount: commandRecovery.summary.replayablePendingCount,
      permissionCount: runtimeScope.permissions.length,
      missingReceiptCount: scopeAudit?.missingReceipts.length ?? 0,
      missingManifestPermissionCount: scopeAudit?.missingPermissions.length ?? 0,
      permissionBoundaryMissingReceiptCount: permissionBoundary?.missingReceipts.length ?? 0,
      permissionBoundaryMissingPermissionCount: permissionBoundary?.missingPermissions.length ?? 0,
    },
    eventsByKind: countsByKind,
    restart: {
      safe: commandRecovery.restartSafe,
      replayRecommended: commandRecovery.summary.replayRecommended,
      nextReplayCommandCount: commandRecovery.nextReplayCommands.length,
      retryAllowed: retryDecision.allowed,
      retryReason: retryDecision.reason,
      manifestId: scopeAudit?.manifest?.manifestId ?? null,
      manifestReady: scopeAudit?.ready ?? true,
      restartMatches: scopeAudit?.restartMatches ?? true,
    },
    scope: {
      tenantId: runtimeScope.tenantId,
      workspaceId: runtimeScope.workspaceId,
      role: runtimeScope.role,
      boundaryMode: runtimeScope.boundaryMode,
      auditRequired: runtimeScope.auditRequired,
    },
    permissionBoundary: {
      manifestId: permissionBoundary?.manifest?.manifestId ?? null,
      accepted: permissionBoundary?.accepted ?? true,
      decisionState: permissionBoundary?.decision?.state ?? "unavailable",
      decisionReason: permissionBoundary?.decision?.reason ?? "manifest-not-compiled",
      nextAction: permissionBoundary?.decision?.nextAction ?? "operator-review",
      roleAccepted: permissionBoundary?.roleAccepted ?? true,
      scopeAccepted: permissionBoundary?.scopeAccepted ?? true,
      externalWriteAccepted: permissionBoundary?.externalWriteAccepted ?? true,
    },
    statusClass: errors.length > 0 ? "attention" : status === "succeeded" ? "complete" : "active",
  };
}

function buildRuntimeHistorySnapshot(status, events, commandRecovery, runtimeScope) {
  const latestEvent = events[events.length - 1] ?? null;
  return {
    snapshotId: `${runtimeScope.scopeKey}:${commandRecovery.restartToken ?? "runtime"}:${events.length}`,
    status,
    tenantId: runtimeScope.tenantId,
    workspaceId: runtimeScope.workspaceId,
    resumeCursor: commandRecovery.resumeCursor,
    restartToken: commandRecovery.restartToken,
    restartFingerprint: commandRecovery.restartFingerprint,
    latestEventKind: latestEvent?.kind ?? null,
    latestEventMessage: latestEvent?.message ?? null,
    openRequiredCheckpointCount: commandRecovery.summary.openRequiredCheckpointCount,
    replayRecommended: commandRecovery.summary.replayRecommended,
  };
}

function buildRuntimeExportSummary(status, auditHandoff, runtimeScope, analytics, historySnapshot, truthSummary, healthSummary, scopeAudit) {
  return {
    exportKind: "aios.runtime.summary.v1",
    auditId: auditHandoff.auditId,
    auditTarget: runtimeScope.auditTarget,
    status,
    readyForExport: analytics.counters.boundaryErrorCount === 0
      && truthSummary.status !== "blocked"
      && (scopeAudit?.ready ?? true),
    tenantId: runtimeScope.tenantId,
    workspaceId: runtimeScope.workspaceId,
    role: runtimeScope.role,
    boundaryMode: runtimeScope.boundaryMode,
    counters: analytics.counters,
    restart: analytics.restart,
    historySnapshot,
    truthStatus: truthSummary.status,
    healthStatus: healthSummary.status,
    scopeAudit: {
      manifestId: scopeAudit?.manifest?.manifestId ?? null,
      ready: scopeAudit?.ready ?? true,
      missingReceipts: scopeAudit?.missingReceipts ?? [],
      missingPermissions: scopeAudit?.missingPermissions ?? [],
      restartMatches: scopeAudit?.restartMatches ?? true,
    },
    permissionBoundary: analytics.permissionBoundary,
  };
}

function buildStatusHandoffReceipt(statusHandoff, status, runtimeScope, adapterReceipt, commandRecovery, retryDecision) {
  return {
    receiptKind: "aios.runtime.status-handoff-receipt.v1",
    handoffId: statusHandoff?.handoffId ?? null,
    jobId: statusHandoff?.jobId ?? null,
    accepted: Boolean(statusHandoff) && statusHandoff.status !== "needs-review",
    status,
    adapter: adapterReceipt.adapter,
    receiptId: adapterReceipt.receiptId,
    tenantId: runtimeScope.tenantId,
    workspaceId: runtimeScope.workspaceId,
    restartToken: commandRecovery.restartToken ?? statusHandoff?.restartToken ?? null,
    resumeCursor: commandRecovery.resumeCursor ?? statusHandoff?.resumeCursor ?? null,
    restartFingerprint: commandRecovery.restartFingerprint ?? statusHandoff?.restartFingerprint ?? null,
    replayRecommended: commandRecovery.summary.replayRecommended,
    retryAllowed: retryDecision.allowed,
    requiredRuntimeReceipts: statusHandoff?.requiredRuntimeReceipts ?? [],
  };
}

function inferStatus({ requestedStatus, compileResult, adapterReceipt, errors, rollback }) {
  if (RUNTIME_STATUSES.has(requestedStatus)) return requestedStatus;
  if (compileResult && compileResult.ok === false) return "needs-operator";
  if (errors.length > 0 && rollback.completed) return "rolled-back";
  if (errors.length > 0) return rollback.required ? "needs-operator" : "failed";
  if (adapterReceipt.status === "accepted" || adapterReceipt.status === "queued") return "queued";
  if (adapterReceipt.status === "running") return "running";
  return "succeeded";
}

export function createRuntimeResult(input = {}) {
  const compileResult = input.compileResult ?? null;
  const requestedJobId = cleanText(input.jobId) || compileResult?.jobs?.[0]?.id || null;
  const compileJob = findCompileJob(compileResult, requestedJobId);
  const adapterReceipt = normalizeAdapterReceipt(input.adapterReceipt ?? input.receipt);
  const statusHandoff = normalizeStatusHandoff(findStatusHandoff(input, compileResult, requestedJobId), compileJob);
  const rollback = normalizeRollbackState(input.rollback);
  const runtimeScope = normalizeRuntimeScope(input.runtimeScope ?? input.scope, compileJob, adapterReceipt);
  const boundaryErrors = validateRuntimeBoundary(runtimeScope, compileJob, adapterReceipt);
  const statusHandoffErrors = validateStatusHandoff(statusHandoff, runtimeScope, adapterReceipt, compileJob);
  const commandRecovery = buildCommandRecoveryState(compileJob, input.persistence ?? input.persistedState ?? input);
  const auditHandoff = normalizeAuditHandoff(input.auditHandoff ?? input.audit, runtimeScope, adapterReceipt, compileJob);
  const runtimeReceipts = normalizeRuntimeReceiptSet(input, adapterReceipt, auditHandoff);
  const scopeAudit = validateScopeAuditManifest({
    compileJob,
    statusHandoff,
    runtimeScope,
    commandRecovery,
    runtimeReceipts,
  });
  const permissionBoundary = validatePermissionBoundaryManifest({
    compileJob,
    statusHandoff,
    runtimeScope,
    adapterReceipt,
    runtimeReceipts,
  });
  const errors = [
    ...asArray(input.errors ?? input.error).map((entry, index) => ({
    code: cleanText(entry?.code) || `RUNTIME_ERROR_${index + 1}`,
    message: cleanText(entry?.message ?? entry) || "Runtime adapter reported an error.",
    recoverable: entry?.recoverable !== false,
    details: entry?.details && typeof entry.details === "object" ? { ...entry.details } : {},
  })),
    ...boundaryErrors,
    ...statusHandoffErrors,
    ...scopeAudit.errors,
    ...permissionBoundary.errors,
  ];
  const status = inferStatus({
    requestedStatus: input.status,
    compileResult,
    adapterReceipt,
    errors,
    rollback,
  });

  const adapterBoundary = normalizeTruthBoundary({
    claims: adapterReceipt.externalReferences.map((reference) => ({
      text: `Runtime adapter referenced ${reference}`,
      level: "external",
      source: adapterReceipt.adapter,
    })),
    externalReferences: adapterReceipt.externalReferences,
    localOnly: !adapterReceipt.externalWrite,
  });
  const truthBoundary = mergeTruthBoundaries(
    compileResult?.truthBoundary,
    input.truthBoundary,
    adapterBoundary,
  );
  const operationalHealth = normalizeOperationalHealth(input.operationalHealth ?? input.health ?? compileJob?.operationalHealth);
  const retryDecision = deriveRetryDecision(operationalHealth, commandRecovery, errors, compileJob, scopeAudit);
  const events = [
    ...asArray(input.events).map(normalizeRuntimeEvent),
    event("adapter-receipt", `Adapter ${adapterReceipt.adapter} returned ${adapterReceipt.status}.`, { receiptId: adapterReceipt.receiptId }),
    event("status-handoff", `Status handoff ${statusHandoff.handoffId} consumed for ${statusHandoff.jobId ?? "runtime job"}.`, { handoffStatus: statusHandoff.status }),
    event("audit-handoff", `Audit handoff recorded for ${runtimeScope.tenantId}/${runtimeScope.workspaceId}.`, { auditId: auditHandoff.auditId }),
  ];
  if (boundaryErrors.length) events.push(event("boundary", `${boundaryErrors.length} runtime boundary violation(s) captured.`, { tenantId: runtimeScope.tenantId, workspaceId: runtimeScope.workspaceId }));
  if (commandRecovery.summary.commandCount) {
    events.push(event("recovery", `${commandRecovery.summary.pendingCommandCount} persisted command(s) pending replay.`, {
      restartToken: commandRecovery.restartToken,
      replayRecommended: commandRecovery.summary.replayRecommended,
    }));
  }
  if (scopeAudit.manifest && !scopeAudit.ready) {
    events.push(event("audit", `Scope audit manifest ${scopeAudit.manifest.manifestId} requires runtime attention.`, {
      missingReceipts: scopeAudit.missingReceipts,
      missingPermissions: scopeAudit.missingPermissions,
      restartMatches: scopeAudit.restartMatches,
    }));
  }
  if (permissionBoundary.manifest && !permissionBoundary.accepted) {
    events.push(event("boundary", `Permission boundary ${permissionBoundary.manifest.manifestId} rejected runtime scope.`, {
      decision: permissionBoundary.decision,
      missingReceipts: permissionBoundary.missingReceipts,
      missingPermissions: permissionBoundary.missingPermissions,
    }));
  } else if (permissionBoundary.manifest && permissionBoundary.decision.state === "review") {
    events.push(event("audit", `Permission boundary ${permissionBoundary.manifest.manifestId} requires audit review.`, {
      decision: permissionBoundary.decision,
      missingReceipts: permissionBoundary.missingReceipts,
    }));
  }
  if (rollback.attempted) events.push(event("rollback", `Rollback ${rollback.status}.`, { action: rollback.action, reason: rollback.reason }));
  if (errors.length) events.push(event("error", `${errors.length} runtime error(s) captured.`, { recoverable: errors.every((error) => error.recoverable) }));
  const truthSummary = summarizeTruthBoundary(truthBoundary);
  const operationalHealthSummary = summarizeOperationalHealth(operationalHealth);
  const analytics = buildRuntimeAnalytics(status, events, errors, commandRecovery, retryDecision, runtimeScope, scopeAudit, permissionBoundary);
  const historySnapshot = buildRuntimeHistorySnapshot(status, events, commandRecovery, runtimeScope);
  const exportSummary = buildRuntimeExportSummary(
    status,
    auditHandoff,
    runtimeScope,
    analytics,
    historySnapshot,
    truthSummary,
    operationalHealthSummary,
    scopeAudit,
  );
  const statusHandoffReceipt = buildStatusHandoffReceipt(statusHandoff, status, runtimeScope, adapterReceipt, commandRecovery, retryDecision);

  return {
    ok: status === "succeeded" || status === "queued" || status === "running",
    status,
    jobId: requestedJobId,
    adapterReceipt,
    statusHandoff,
    statusHandoffReceipt,
    runtimeScope,
    auditHandoff,
    outputs: input.outputs && typeof input.outputs === "object" ? { ...input.outputs } : {},
    events,
    errors,
    rollback,
    truthBoundary,
    truthSummary,
    truthReport: exportTruthBoundaryReport(truthBoundary, { id: auditHandoff.auditId, history: events }),
    operationalHealth,
    operationalHealthSummary,
    commandRecovery,
    scopeAudit,
    permissionBoundary,
    retryDecision,
    analytics,
    historySnapshot,
    exportSummary,
    recoveryStatus: errors.length === 0 && !commandRecovery.summary.replayRecommended ? "not-needed" : rollback.completed ? "rolled-back" : retryDecision.allowed ? "retry-scheduled" : "operator-review",
  };
}

export function summarizeRuntimeResult(result) {
  const normalized = createRuntimeResult(result);
  return {
    ok: normalized.ok,
    status: normalized.status,
    jobId: normalized.jobId,
    adapter: normalized.adapterReceipt.adapter,
    handoffId: normalized.statusHandoffReceipt.handoffId,
    errorCount: normalized.errors.length,
    rollbackStatus: normalized.rollback.status,
    truthStatus: normalized.truthSummary.status,
    healthStatus: normalized.operationalHealthSummary.status,
    tenantId: normalized.runtimeScope.tenantId,
    workspaceId: normalized.runtimeScope.workspaceId,
    recoveryStatus: normalized.recoveryStatus,
    retryAllowed: normalized.retryDecision.allowed,
    replayRecommended: normalized.commandRecovery.summary.replayRecommended,
    boundaryErrorCount: normalized.analytics.counters.boundaryErrorCount,
    eventCount: normalized.analytics.counters.eventCount,
    exportReady: normalized.exportSummary.readyForExport,
    scopeAuditReady: normalized.scopeAudit.ready,
    missingReceiptCount: normalized.scopeAudit.missingReceipts.length,
    permissionBoundaryAccepted: normalized.permissionBoundary.accepted,
    permissionBoundaryDecision: normalized.permissionBoundary.decision.state,
  };
}

export { RUNTIME_STATUSES };
