function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(normalizeToken).filter(Boolean))].sort();
}

const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze(["campaign.schedule", "campaign.write", "audit.write"]),
  admin: Object.freeze(["campaign.schedule", "campaign.write", "audit.write"]),
  marketer: Object.freeze(["campaign.schedule", "campaign.write"]),
  analyst: Object.freeze(["campaign.read"]),
  viewer: Object.freeze(["campaign.read"])
});

function normalizeRuntimeBoundary(intent = {}) {
  const runtime = intent.runtime ?? {};
  const tenantId = normalizeString(intent.tenantId ?? runtime.tenantId);
  const workspaceId = normalizeString(intent.workspaceId ?? runtime.workspaceId);
  const actorId = normalizeString(intent.actorId ?? runtime.actorId);
  const role = normalizeToken(intent.role ?? runtime.role);
  const permissions = normalizeList(intent.permissions ?? runtime.permissions);
  const rolePermissions = ROLE_PERMISSIONS[role] ?? [];
  const effectivePermissions = normalizeList([...rolePermissions, ...permissions]);
  const requiredPermissions = ["campaign.schedule", "campaign.write"];
  const missing = requiredPermissions.filter((permission) => !effectivePermissions.includes(permission));

  return {
    tenantId,
    workspaceId,
    actorId,
    role,
    permissions: effectivePermissions,
    requiredPermissions,
    missingPermissions: missing,
    isolationKey: [
      "mailchimp",
      normalizeToken(tenantId) || "tenant",
      normalizeToken(workspaceId) || "workspace"
    ].join("."),
    status:
      tenantId && workspaceId && actorId && missing.length === 0
        ? "ready"
        : missing.length > 0
          ? "blocked"
          : "needs_scope"
  };
}

function schedulerJobId(intent) {
  const parts = [
    "mailchimp",
    normalizeString(intent.tenantId || "tenant"),
    normalizeString(intent.workspaceId || "workspace"),
    normalizeString(intent.campaignId || intent.campaignName || "campaign"),
    normalizeString(intent.sendAt || "draft")
  ];
  return parts
    .join(".")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeInteger(value, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function stableCommandToken(parts) {
  return parts
    .map((part) => normalizeString(part) || "none")
    .join(".")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-");
}

function normalizePersistenceInput(input = {}) {
  const snapshot = input.memorySnapshot ?? input.snapshot ?? {};
  const recovery = input.memoryRecovery ?? input.recoveryState ?? {};
  const persistCommand = snapshot.persistCommand ?? {};
  const resumeCommand = recovery.resumeCommand ?? {};

  return {
    memoryKey: normalizeString(snapshot.memoryKey ?? recovery.memoryKey ?? input.memoryKey),
    continuationKey: normalizeString(
      snapshot.continuationKey ?? recovery.continuationKey ?? input.continuationKey
    ),
    checksum: normalizeString(snapshot.checksum ?? recovery.checksum ?? input.checksum),
    sequence: normalizeInteger(snapshot.sequence ?? recovery.sequence),
    snapshotStatus: normalizeToken(snapshot.status),
    recoveryStatus: normalizeToken(recovery.status),
    persistCommandId: normalizeString(persistCommand.id ?? input.persistCommandId),
    resumeCommandId: normalizeString(resumeCommand.id ?? input.resumeCommandId),
    missingCampaignFacts: snapshot.missing ?? input.missingCampaignFacts ?? [],
    missingClientState:
      snapshot.restartSafeStatus?.missingClientState ??
      recovery.recovery?.filter((entry) => entry.field).map((entry) => entry.field) ??
      [],
    canResume:
      recovery.resumeCommand?.status === "ready_to_resume" ||
      snapshot.restartSafeStatus?.mayResume === true ||
      recovery.status === "resume_ready"
  };
}

function deriveSchedulerHealth(intent = {}, persistence = {}) {
  const failures = [];
  const degraded = [];

  if (!normalizeDate(intent.sendAt)) {
    failures.push({
      code: "missing_send_at",
      severity: "error",
      action: "keep-campaign-as-draft"
    });
  }

  if (!persistence.memoryKey) {
    failures.push({
      code: "missing_memory_snapshot",
      severity: "error",
      action: "persist-memory-snapshot-before-scheduler-handoff"
    });
  }

  if (persistence.memoryKey && !persistence.checksum) {
    degraded.push({
      code: "missing_memory_checksum",
      severity: "warning",
      action: "recompute-or-refresh-memory-snapshot-before-resume"
    });
  }

  if (persistence.snapshotStatus === "needs_input") {
    failures.push({
      code: "memory_snapshot_needs_input",
      severity: "error",
      action: "collect-missing-memory-fields-before-scheduling",
      missingCampaignFacts: persistence.missingCampaignFacts,
      missingClientState: persistence.missingClientState
    });
  }

  if (persistence.recoveryStatus === "needs_client_state") {
    failures.push({
      code: "memory_recovery_needs_client_state",
      severity: "error",
      action: "bind-client-runtime-state-before-resuming-scheduler"
    });
  }

  return {
    status:
      failures.length === 0 && degraded.length === 0
        ? "healthy"
        : failures.length === 0
          ? "degraded"
          : "blocked",
    failures,
    degraded,
    actionableErrors: [...failures, ...degraded]
  };
}

function normalizeArtifactPersistenceInput(input = {}) {
  const artifactState =
    input.artifactPersistence ??
    input.artifactManifest ??
    input.artifactWriteSet?.persistence ??
    {};
  const commands = Array.isArray(artifactState.commands) ? artifactState.commands : [];
  const manifestEntries = Array.isArray(artifactState.manifestEntries)
    ? artifactState.manifestEntries
    : Array.isArray(artifactState.entries)
      ? artifactState.entries
      : [];
  const counters = artifactState.counters ?? {};

  return {
    manifestVersion: normalizeString(artifactState.manifestVersion) || "aios.mailchimp.artifact-manifest.v1",
    status: normalizeToken(artifactState.status),
    boundaryId: normalizeString(artifactState.boundaryId ?? input.boundaryId),
    writeSetId: normalizeString(artifactState.writeSetId),
    previousWriteSetId: normalizeString(artifactState.previousWriteSetId),
    restartSafe: artifactState.restartSafe === true,
    commandCount: normalizeInteger(counters.commandCount ?? commands.length),
    readyToWrite: normalizeInteger(
      counters.readyToWrite ??
        commands.filter((command) => normalizeToken(command.status) === "ready_to_write").length
    ),
    alreadyWritten: normalizeInteger(
      counters.alreadyWritten ??
        commands.filter((command) => normalizeToken(command.status) === "already_written").length
    ),
    staleEntryCount: normalizeInteger(counters.staleEntryCount),
    paths: manifestEntries
      .map((entry) => normalizeString(entry.path))
      .filter(Boolean)
      .sort(),
    pendingCommandIds: commands
      .filter((command) => normalizeToken(command.status) !== "already_written")
      .map((command) => normalizeString(command.id))
      .filter(Boolean)
      .sort(),
  };
}

function normalizeCapabilityHandoffInput(input = {}) {
  const state =
    input.capabilityHandoff ??
    input.capabilitySnapshot ??
    input.capabilityState?.handoff ??
    input.persistedCapabilityState?.handoff ??
    {};
  const grants = Array.isArray(state.grants)
    ? state.grants
    : Array.isArray(input.persistedCapabilityState?.grants)
      ? input.persistedCapabilityState.grants
      : [];
  const requiredScopes = normalizeList(
    state.requiredScopes ??
      input.requiredScopes ??
      grants.map((grant) => grant.scope)
  );
  const grantedScopes = normalizeList(
    state.grantedScopes ??
      grants
        .filter((grant) => grant.granted === true || normalizeToken(grant.status) === "granted")
        .map((grant) => grant.scope)
  );
  const deniedScopes = normalizeList(
    state.deniedScopes ??
      grants.filter((grant) => normalizeToken(grant.status) === "denied").map((grant) => grant.scope)
  );
  const missingScopes = normalizeList(
    state.missingScopes ??
      requiredScopes.filter((scope) => !grantedScopes.includes(scope))
  );
  const pendingScopes = normalizeList(
    state.pendingScopes ??
      missingScopes.filter((scope) => !deniedScopes.includes(scope))
  );
  const status = normalizeToken(state.status) || (missingScopes.length === 0 ? "ready" : "needs_grant");
  const checkpointId = normalizeString(state.checkpointId ?? input.capabilityCheckpointId);

  return {
    snapshotVersion: normalizeString(state.snapshotVersion) || "aios.mailchimp.capability-handoff.v1",
    checkpointId,
    status,
    canHandoff:
      state.canHandoff === true ||
      (status === "ready" && requiredScopes.length > 0 && missingScopes.length === 0),
    requiredScopes,
    grantedScopes,
    missingScopes,
    deniedScopes,
    pendingScopes,
    grants: grants
      .map((grant) => ({
        scope: normalizeToken(grant.scope),
        status: normalizeToken(grant.status) || (grant.granted ? "granted" : "unknown"),
        granted: grant.granted === true || normalizeToken(grant.status) === "granted",
        stateKey: normalizeString(grant.stateKey),
        idempotencyKey: normalizeString(grant.idempotencyKey)
      }))
      .filter((grant) => grant.scope),
    recovery: Array.isArray(state.recovery) ? state.recovery : []
  };
}

function normalizePackageControlInput(input = {}) {
  const state =
    input.packageSchedulerControlHandoff ??
    input.schedulerControlHandoff ??
    input.packageControlHandoff ??
    input.packageControl ??
    input.controlSurface ??
    {};
  const validation = state.validation ?? {};
  const schedule = state.schedule ?? {};
  const command = state.command ?? {};
  const approval = state.approval ?? {};
  const tenantBoundary = state.tenantBoundary ?? {};
  const settings = state.settings ?? {};
  const blockedReasons = normalizeList(
    validation.blockedReasons ??
      state.blockedReasons ??
      [state.disabledReason].filter(Boolean)
  );
  const status = normalizeToken(
    state.status ??
      (!state.kind && Object.keys(state).length === 0
        ? "not_provided"
        : blockedReasons.length === 0 && state.ready === true
          ? "ready"
          : "blocked")
  );
  const scheduleMode = normalizeToken(schedule.mode ?? settings.scheduleMode ?? "manual");
  const commandReady = command.ready === true || state.maySchedule === true;
  const ready = (
    state.ready === true ||
    state.maySchedule === true ||
    (status === "ready" && commandReady)
  ) && blockedReasons.length === 0;

  return {
    handoffVersion: normalizeString(state.kind) || "aios.package.scheduler-control-handoff",
    apiVersion: normalizeString(state.apiVersion) || "aios.language/v1",
    handoffId: normalizeString(state.handoffId ?? state.id),
    packageName: normalizeString(state.package?.name ?? state.packageName),
    packageVersion: normalizeString(state.package?.version ?? state.packageVersion),
    jobId: normalizeString(state.jobId),
    status,
    ready,
    maySchedule: ready && commandReady,
    nextAction: normalizeString(state.nextAction ?? command.command ?? "package.scheduler-control.provide"),
    disabledReason: normalizeString(state.disabledReason ?? blockedReasons[0]),
    schedule: {
      mode: ["manual", "interval", "disabled"].includes(scheduleMode) ? scheduleMode : "manual",
      startsAt: normalizeString(schedule.startsAt ?? "logical:0"),
      intervalMinutes: Number.isFinite(schedule.intervalMinutes) ? schedule.intervalMinutes : null,
      ready: schedule.ready !== false && scheduleMode !== "disabled",
      blockedReasons: normalizeList(schedule.blockedReasons)
    },
    approval: {
      required: approval.required === true || settings.requireApproval === true,
      accepted: approval.accepted === true,
      acceptedBy: normalizeString(approval.acceptedBy),
      acceptedAt: normalizeString(approval.acceptedAt),
      command: normalizeString(approval.command ?? "package.preview.accept")
    },
    command: {
      id: normalizeString(command.id ?? command.commandId),
      command: normalizeString(command.command ?? state.nextAction),
      ready: commandReady,
      reason: normalizeString(command.reason),
      idempotencyKey: normalizeString(command.idempotencyKey ?? command.id),
      externalWrites: command.externalWrites === true,
      requiresVerifier: command.requiresVerifier !== false
    },
    tenantBoundary: {
      tenantId: normalizeString(tenantBoundary.tenantId),
      workspaceId: normalizeString(tenantBoundary.workspaceId),
      isolationMode: normalizeToken(tenantBoundary.isolationMode),
      boundarySatisfied: tenantBoundary.boundarySatisfied !== false
    },
    settings: {
      enabled: settings.enabled !== false,
      dryRun: settings.dryRun !== false,
      requireApproval: settings.requireApproval === true,
      scheduleMode,
      exportMode: normalizeToken(settings.exportMode),
      localOnlyExport: settings.localOnlyExport !== false
    },
    blockedReasons,
    warnings: normalizeList(validation.warnings),
    truthBoundary: {
      externalWrites: state.truthBoundary?.externalWrites === true,
      localOnly: state.truthBoundary?.localOnly !== false,
      verifierRequiredBeforeAdapter: state.truthBoundary?.verifierRequiredBeforeAdapter !== false,
      evidenceSubject: normalizeString(state.truthBoundary?.evidenceSubject)
    }
  };
}

function derivePackageControlRecovery(packageControl) {
  if (packageControl.status === "not_provided") {
    return [];
  }
  if (packageControl.ready) {
    return [];
  }

  return [
    {
      code:
        packageControl.status === "disabled"
          ? "package_control_disabled"
          : packageControl.status === "paused"
            ? "package_schedule_paused"
            : packageControl.status === "awaiting-approval"
              ? "package_approval_required"
              : "package_control_blocked",
      action: packageControl.nextAction || "package.controls.repair",
      disabledReason: packageControl.disabledReason || packageControl.blockedReasons[0] || null,
      blockedReasons: packageControl.blockedReasons
    }
  ];
}

function packageControlAllowsHandoff(packageControl) {
  return packageControl.status === "not_provided" || (
    packageControl.ready === true &&
    packageControl.maySchedule === true &&
    packageControl.command.externalWrites === false &&
    packageControl.command.requiresVerifier === true &&
    packageControl.truthBoundary.localOnly === true &&
    packageControl.truthBoundary.verifierRequiredBeforeAdapter === true
  );
}

function buildAdapterHandoffEnvelope(job, persistence, artifactPersistence, capabilityHandoff, packageControl) {
  const blockers = [
    ...job.schedulerHealth.failures.map((entry) => ({
      source: "scheduler-health",
      code: entry.code,
      action: entry.action
    })),
    ...(!job.memory.restartSafe
      ? [
          {
            source: "memory",
            code: "memory_not_restart_safe",
            action: "persist-memory-snapshot-and-continuation-before-adapter-handoff"
          }
        ]
      : []),
    ...(!capabilityHandoff.canHandoff
      ? capabilityHandoff.missingScopes.map((scope) => ({
          source: "capabilities",
          code: capabilityHandoff.deniedScopes.includes(scope)
            ? "capability_denied"
            : "capability_grant_required",
          scope,
          action: capabilityHandoff.deniedScopes.includes(scope)
            ? "surface-denied-scope-and-keep-job-blocked"
            : "request-idempotent-mailchimp-scope-grant"
        }))
      : []),
    ...(artifactPersistence.pendingCommandIds.length > 0
      ? [
          {
            source: "artifacts",
            code: "artifact_writes_pending",
            action: "persist-local-artifact-write-set-before-adapter-handoff",
            pendingArtifactCommandIds: artifactPersistence.pendingCommandIds
          }
        ]
      : []),
    ...(!packageControlAllowsHandoff(packageControl)
      ? derivePackageControlRecovery(packageControl).map((entry) => ({
          source: "package-controls",
          code: entry.code,
          action: entry.action,
          blockedReasons: entry.blockedReasons
        }))
      : [])
  ];
  const status =
    blockers.length > 0
      ? "blocked"
      : job.schedulerHealth.status === "degraded"
        ? "degraded"
        : "ready";

  return {
    envelopeVersion: "aios.mailchimp.adapter-handoff.v1",
    status,
    mayCallAdapter: status === "ready",
    jobId: job.id,
    commandId: job.idempotency.commandId,
    adapter: "mailchimp",
    operation: job.operation,
    tenantIsolationKey: job.runtimeScope.isolationKey,
    memory: {
      memoryKey: persistence.memoryKey,
      continuationKey: persistence.continuationKey,
      checksum: persistence.checksum,
      sequence: persistence.sequence,
      restartSafe: job.memory.restartSafe,
      persistCommandId: persistence.persistCommandId || null,
      resumeCommandId: persistence.resumeCommandId || null
    },
    capabilities: {
      snapshotVersion: capabilityHandoff.snapshotVersion,
      checkpointId: capabilityHandoff.checkpointId || null,
      status: capabilityHandoff.status,
      requiredScopes: capabilityHandoff.requiredScopes,
      grantedScopes: capabilityHandoff.grantedScopes,
      missingScopes: capabilityHandoff.missingScopes,
      deniedScopes: capabilityHandoff.deniedScopes,
      canHandoff: capabilityHandoff.canHandoff
    },
    artifacts: {
      manifestVersion: artifactPersistence.manifestVersion,
      boundaryId: artifactPersistence.boundaryId || null,
      writeSetId: artifactPersistence.writeSetId || null,
      restartSafe: artifactPersistence.restartSafe || !artifactPersistence.writeSetId,
      pendingCommandIds: artifactPersistence.pendingCommandIds,
      alreadyWritten: artifactPersistence.alreadyWritten
    },
    packageControls: {
      handoffId: packageControl.handoffId || null,
      status: packageControl.status,
      ready: packageControl.ready,
      maySchedule: packageControl.maySchedule,
      nextAction: packageControl.nextAction,
      disabledReason: packageControl.disabledReason || null,
      commandId: packageControl.command.id || null,
      command: packageControl.command.command || null,
      scheduleMode: packageControl.schedule.mode,
      approvalRequired: packageControl.approval.required,
      approvalAccepted: packageControl.approval.accepted,
      blockedReasons: packageControl.blockedReasons
    },
    blockers,
    recovery: [
      ...blockers.map((blocker) => ({
        code: blocker.code,
        source: blocker.source,
        action: blocker.action,
        scope: blocker.scope,
        pendingArtifactCommandIds: blocker.pendingArtifactCommandIds
      })),
      ...capabilityHandoff.recovery
    ],
    truthBoundary: {
      source: "deterministic-scheduler-handoff-envelope",
      externalWrites: false,
      adapterWillWriteExternally: true,
      externalWritePermittedAfterVerification: status === "ready"
    }
  };
}

function normalizePreflightChecklistItem(item = {}, index = 0) {
  const id = normalizeToken(item.id ?? item.check ?? `check-${index + 1}`);
  const status = normalizeToken(item.status ?? (item.passed === false ? "blocked" : "passed"));
  const severity = normalizeToken(item.severity ?? (status === "passed" ? "info" : "error"));

  return {
    id,
    status: ["passed", "warning", "blocked"].includes(status) ? status : "blocked",
    severity: ["info", "warning", "error"].includes(severity) ? severity : "error",
    action: normalizeString(item.action ?? item.recovery ?? "operator-review"),
    evidence: normalizeString(item.evidence ?? item.subject ?? id),
    source: normalizeString(item.source ?? "scheduler-preflight")
  };
}

function createPreflightChecklistItem(id, passed, details = {}) {
  return normalizePreflightChecklistItem({
    id,
    status: passed ? "passed" : details.warning ? "warning" : "blocked",
    severity: passed ? "info" : details.warning ? "warning" : "error",
    action: passed ? "none" : details.action,
    evidence: details.evidence ?? id,
    source: details.source
  });
}

function derivePreflightStatus(checklist, adapterHandoff) {
  if (checklist.some((item) => item.status === "blocked")) {
    return "blocked";
  }
  if (adapterHandoff.status === "degraded" || checklist.some((item) => item.status === "warning")) {
    return "degraded";
  }
  return "ready";
}

function buildSchedulerPreflightRecord(job, persistence, artifactPersistence, capabilityHandoff, packageControl) {
  const adapterHandoff = job.adapterHandoff ?? {};
  const checklist = [
    createPreflightChecklistItem("runtime-scope-bound", job.runtimeScope?.missingPermissions?.length === 0, {
      action: "bind-runtime-scope-and-required-permissions",
      evidence: job.runtimeScope?.isolationKey
    }),
    createPreflightChecklistItem("memory-restart-safe", job.memory?.restartSafe === true, {
      action: "persist-memory-snapshot-and-continuation-before-handoff",
      evidence: persistence.memoryKey
    }),
    createPreflightChecklistItem("memory-checksum-bound", Boolean(persistence.checksum), {
      warning: Boolean(persistence.memoryKey),
      action: "refresh-memory-checksum-before-runtime-resume",
      evidence: persistence.checksum
    }),
    createPreflightChecklistItem("capabilities-granted", capabilityHandoff.canHandoff === true, {
      action: "request-idempotent-capability-grants",
      evidence: capabilityHandoff.checkpointId
    }),
    createPreflightChecklistItem("local-artifacts-persisted", artifactPersistence.pendingCommandIds.length === 0, {
      action: "persist-local-artifact-write-set-before-adapter-handoff",
      evidence: artifactPersistence.writeSetId
    }),
    createPreflightChecklistItem("package-controls-ready", packageControlAllowsHandoff(packageControl), {
      action: packageControl.nextAction || "package.controls.repair",
      evidence: packageControl.handoffId || packageControl.status
    }),
    createPreflightChecklistItem("adapter-handoff-envelope-ready", adapterHandoff.mayCallAdapter === true, {
      action: "repair-adapter-handoff-envelope-before-verifier",
      evidence: adapterHandoff.commandId
    })
  ];
  const status = derivePreflightStatus(checklist, adapterHandoff);
  const blockedReasons = checklist
    .filter((item) => item.status === "blocked")
    .map((item) => item.action)
    .filter(Boolean)
    .sort();
  const warningReasons = checklist
    .filter((item) => item.status === "warning")
    .map((item) => item.action)
    .filter(Boolean)
    .sort();
  const commandId = stableCommandToken([
    "mailchimp.scheduler.preflight",
    job.id,
    job.idempotency?.commandId,
    status,
    blockedReasons.join("|"),
    warningReasons.join("|")
  ]);

  return {
    preflightVersion: "aios.mailchimp.scheduler-preflight.v1",
    status,
    ready: status === "ready",
    mayCallAdapter: status === "ready" && adapterHandoff.mayCallAdapter === true,
    jobId: job.id,
    commandId,
    adapterCommandId: adapterHandoff.commandId ?? null,
    isolationKey: job.runtimeScope?.isolationKey ?? null,
    checklist,
    blockedReasons,
    warningReasons,
    requiredEvidence: checklist.map((item) => `preflight:${item.id}:${item.evidence || "pending"}`),
    recovery: checklist
      .filter((item) => item.status !== "passed")
      .map((item) => ({
        check: item.id,
        code: item.status === "warning" ? "preflight_warning" : "preflight_blocked",
        severity: item.severity,
        action: item.action,
        retryable: item.status === "warning" || item.id !== "adapter-handoff-envelope-ready"
      })),
    truthBoundary: {
      source: "deterministic-scheduler-preflight",
      externalWrites: false,
      adapterWillWriteExternally: true,
      externalWritePermittedAfterVerification: status === "ready"
    }
  };
}

function normalizeClientRuntimeInput(input = {}) {
  const client =
    input.clientRuntime ??
    input.clientState ??
    input.runtimeClientState ??
    input.packageRuntimeAdoption?.clientState ??
    {};
  const persisted =
    input.persistedRuntimeState ??
    input.runtimeState?.persisted ??
    input.packageRuntimeAdoption?.runtimeState?.persisted ??
    {};
  const visible =
    client.visibleStatus ??
    client.statusBadge ??
    client.status ??
    persisted.status ??
    "pending";
  const bindings = client.bindings && typeof client.bindings === "object" ? client.bindings : {};
  const requiredBindings = normalizeList(
    client.requiredBindings ??
      ["campaignId", "campaignName", "listId", "subjectLine", "sendAt", "memoryKey", "continuationKey"]
  );
  const boundFields = normalizeList(
    client.boundFields ??
      Object.entries({
        campaignId: input.campaignId,
        campaignName: input.campaignName,
        listId: input.listId,
        subjectLine: input.subjectLine,
        sendAt: input.sendAt,
        memoryKey: input.memoryKey ?? input.memorySnapshot?.memoryKey,
        continuationKey: input.continuationKey ?? input.memorySnapshot?.continuationKey,
        ...bindings
      })
        .filter(([, value]) => normalizeString(value))
        .map(([field]) => field)
  );
  const missingBindings = normalizeList(
    client.missingBindings ??
      requiredBindings.filter((field) => !boundFields.includes(field))
  );

  return {
    status: normalizeToken(visible),
    ready: client.ready === true || (missingBindings.length === 0 && normalizeToken(visible) === "ready"),
    command: normalizeString(client.command ?? client.primaryAction ?? "runtime.client-state.bind"),
    route: normalizeString(client.route ?? client.returnTo ?? "mailchimp.scheduler.handoff"),
    idempotencyKey: normalizeString(client.idempotencyKey ?? persisted.idempotencyKey),
    requiredBindings,
    boundFields,
    missingBindings,
    disabledReason: normalizeString(client.disabledReason),
    summary: normalizeString(client.summary?.message ?? client.message)
  };
}

function buildClientRuntimeHandoff(job, persistence, artifactPersistence, capabilityHandoff, clientRuntime) {
  const preflight = job.preflight ?? {};
  const adapterHandoff = job.adapterHandoff ?? {};
  const blockerCodes = [
    ...job.recovery.map((entry) => entry.code).filter(Boolean),
    ...clientRuntime.missingBindings.map((field) => `missing_client_binding:${field}`)
  ].sort();
  const restartSafe =
    job.idempotency.restartSafe &&
    preflight.ready === true &&
    clientRuntime.ready === true &&
    Boolean(persistence.memoryKey && persistence.continuationKey && persistence.checksum);
  const status =
    restartSafe && adapterHandoff.mayCallAdapter === true
      ? "ready"
      : clientRuntime.missingBindings.length > 0
        ? "needs_client_state"
        : preflight.status === "degraded" || job.schedulerHealth.status === "degraded"
          ? "degraded"
          : "blocked";
  const adoptionKey = stableCommandToken([
    "mailchimp.scheduler.client-runtime",
    job.id,
    preflight.commandId,
    persistence.memoryKey,
    persistence.continuationKey,
    persistence.checksum,
    capabilityHandoff.checkpointId,
    artifactPersistence.writeSetId,
    clientRuntime.idempotencyKey,
    status
  ]);
  const nextAction =
    status === "ready"
      ? "verifier.verify-and-handoff"
      : clientRuntime.missingBindings.length > 0
        ? clientRuntime.command
        : preflight.recovery[0]?.action ?? adapterHandoff.recovery?.[0]?.action ?? "scheduler.handoff.repair";

  return {
    handoffVersion: "aios.mailchimp.scheduler-client-runtime-handoff.v1",
    adoptionKey,
    status,
    ready: status === "ready",
    restartSafe,
    mayCallAdapterAfterVerifier: status === "ready" && adapterHandoff.mayCallAdapter === true,
    jobId: job.id,
    schedulerCommandId: job.idempotency.commandId,
    preflightCommandId: preflight.commandId ?? null,
    adapterCommandId: adapterHandoff.commandId ?? null,
    isolationKey: job.runtimeScope?.isolationKey ?? null,
    visible: {
      badge:
        status === "ready"
          ? "ready"
          : status === "degraded"
            ? "needs-attention"
            : "blocked",
      status,
      primaryAction: nextAction,
      disabledReason:
        status === "ready"
          ? null
          : clientRuntime.disabledReason ||
            clientRuntime.missingBindings[0] ||
            job.recovery[0]?.action ||
            "scheduler handoff is not ready",
      route: clientRuntime.route,
      summary:
        clientRuntime.summary ||
        (status === "ready"
          ? "scheduler handoff is restart-safe and ready for verifier"
          : `scheduler handoff blocked by ${blockerCodes[0] ?? "unknown blocker"}`)
    },
    clientState: {
      ready: clientRuntime.ready,
      command: clientRuntime.command,
      idempotencyKey: clientRuntime.idempotencyKey || adoptionKey,
      requiredBindings: clientRuntime.requiredBindings,
      boundFields: clientRuntime.boundFields,
      missingBindings: clientRuntime.missingBindings
    },
    persistedState: {
      memoryKey: persistence.memoryKey,
      continuationKey: persistence.continuationKey,
      checksum: persistence.checksum,
      sequence: persistence.sequence,
      restartToken: stableCommandToken([
        job.id,
        persistence.memoryKey,
        persistence.continuationKey,
        persistence.checksum,
        preflight.commandId
      ]),
      persistCommandId: persistence.persistCommandId || null,
      resumeCommandId: persistence.resumeCommandId || null
    },
    blockers: blockerCodes.map((code) => ({
      code,
      action: code.startsWith("missing_client_binding:")
        ? "bind-client-runtime-state-before-resume"
        : job.recovery.find((entry) => entry.code === code)?.action ?? "repair-scheduler-state"
    })),
    recovery: [
      ...clientRuntime.missingBindings.map((field) => ({
        code: "missing_client_runtime_binding",
        field,
        action: "bind-client-runtime-state-before-resume",
        retryable: true
      })),
      ...preflight.recovery
    ],
    truthBoundary: {
      source: "deterministic-client-runtime-handoff",
      externalWrites: false,
      adapterWillWriteExternally: true,
      externalWritePermittedAfterVerification: status === "ready"
    }
  };
}

function normalizeRestartLedgerHistory(input = {}) {
  const entries =
    input.schedulerRestartHistory ??
    input.restartLedger?.history ??
    input.restartLedgerHistory ??
    input.recoveryState?.restartHistory ??
    [];

  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry, index) => ({
      index,
      at: normalizeString(entry.at ?? entry.timestamp ?? `history:${index}`),
      jobId: normalizeString(entry.jobId),
      commandId: normalizeString(entry.commandId ?? entry.schedulerCommandId),
      adoptionKey: normalizeString(entry.adoptionKey ?? entry.clientRuntimeAdoptionKey),
      restartToken: normalizeString(entry.restartToken ?? entry.resumeToken),
      memoryKey: normalizeString(entry.memoryKey),
      continuationKey: normalizeString(entry.continuationKey),
      checksum: normalizeString(entry.checksum),
      status: normalizeToken(entry.status ?? entry.commandStatus ?? "unknown"),
      outcome: normalizeToken(entry.outcome ?? entry.result ?? "unknown"),
      adapterCallObserved: entry.adapterCallObserved === true,
      externalWrites: entry.externalWrites === true
    }))
    .filter((entry) => entry.commandId || entry.adoptionKey || entry.restartToken)
    .slice(-12);
}

function buildSchedulerRestartLedger(job, persistence, artifactPersistence, capabilityHandoff, clientRuntime, input = {}) {
  const history = normalizeRestartLedgerHistory(input);
  const restartToken = stableCommandToken([
    job.id,
    persistence.memoryKey,
    persistence.continuationKey,
    persistence.checksum,
    job.preflight?.commandId
  ]);
  const matchingHistory = history.find((entry) => (
    (entry.commandId && entry.commandId === job.idempotency.commandId) ||
    (entry.restartToken && entry.restartToken === restartToken) ||
    (entry.adoptionKey && entry.adoptionKey === job.clientRuntimeHandoff?.adoptionKey)
  ));
  const completedReplay = Boolean(
    matchingHistory &&
      [matchingHistory.status, matchingHistory.outcome].some((value) =>
        ["completed", "already_completed", "adapter_handoff_recorded"].includes(value)
      )
  );
  const restartSafe =
    job.clientRuntimeHandoff?.restartSafe === true &&
    job.preflight?.ready === true &&
    job.idempotency.restartSafe === true &&
    Boolean(persistence.memoryKey && persistence.continuationKey && persistence.checksum);
  const blockers = completedReplay ? [] : uniqueSchedulerRestartBlockers([
    ...(restartSafe ? [] : ["restart ledger requires restart-safe scheduler state"]),
    ...(clientRuntime.ready ? [] : clientRuntime.missingBindings.map((field) => `missing client binding ${field}`)),
    ...(artifactPersistence.pendingCommandIds.length === 0
      ? []
      : [`artifact write commands pending: ${artifactPersistence.pendingCommandIds.join(",")}`]),
    ...(capabilityHandoff.canHandoff ? [] : capabilityHandoff.missingScopes.map((scope) => `capability ${scope} not granted`)),
    ...derivePackageControlRecovery(job.packageControl ?? {}).map((entry) => (
      entry.disabledReason || entry.action || entry.code
    )),
    ...job.schedulerHealth.failures.map((failure) => failure.action),
    ...job.runtimeScope.missingPermissions.map((permission) => `missing permission ${permission}`)
  ]);
  const status = completedReplay
    ? "already_completed"
    : blockers.length === 0
      ? "ready_to_resume"
      : job.schedulerHealth.status === "degraded"
        ? "resume_degraded"
        : "blocked";
  const commandId = stableCommandToken([
    "mailchimp.scheduler.restart-ledger",
    job.id,
    job.idempotency.commandId,
    restartToken,
    status
  ]);

  return {
    ledgerVersion: "aios.mailchimp.scheduler-restart-ledger.v1",
    status,
    restartSafe,
    idempotentReplay: Boolean(completedReplay),
    jobId: job.id,
    schedulerCommandId: job.idempotency.commandId,
    preflightCommandId: job.preflight?.commandId ?? null,
    clientRuntimeAdoptionKey: job.clientRuntimeHandoff?.adoptionKey ?? null,
    isolationKey: job.runtimeScope?.isolationKey ?? null,
    command: {
      id: commandId,
      idempotencyKey: commandId,
      type:
        status === "already_completed"
          ? "return-existing-scheduler-command-status"
          : status === "ready_to_resume"
            ? "resume-scheduler-handoff"
            : "repair-scheduler-restart-state",
      status:
        status === "already_completed"
          ? "already_completed"
          : status === "ready_to_resume"
            ? "ready_to_resume"
            : "blocked",
      externalWrites: false,
      mayCallAdapterAfterVerifier: status === "ready_to_resume" && job.clientRuntimeHandoff?.mayCallAdapterAfterVerifier === true
    },
    persistedState: {
      memoryKey: persistence.memoryKey,
      continuationKey: persistence.continuationKey,
      checksum: persistence.checksum,
      sequence: persistence.sequence,
      restartToken,
      persistCommandId: persistence.persistCommandId || null,
      resumeCommandId: persistence.resumeCommandId || null
    },
    capabilityCheckpointId: capabilityHandoff.checkpointId || null,
    artifactWriteSetId: artifactPersistence.writeSetId || null,
    blockers,
    recovery: blockers.map((reason) => ({
      code: reason.startsWith("missing client binding")
        ? "missing_client_runtime_binding"
        : reason.startsWith("capability")
          ? "capability_grant_required"
          : reason.startsWith("artifact")
            ? "artifact_writes_pending"
            : "restart_ledger_blocked",
      action: reason,
      retryable: !reason.includes("permission")
    })),
    history,
    counters: {
      historyEntries: history.length,
      replayMatches: matchingHistory ? 1 : 0,
      blockedReasons: blockers.length,
      adapterCallsObserved: history.filter((entry) => entry.adapterCallObserved).length,
      externalWriteViolations: history.filter((entry) => entry.externalWrites).length
    },
    truthBoundary: {
      source: "deterministic-scheduler-restart-ledger",
      externalWrites: false,
      adapterCallRecordedLocally: Boolean(matchingHistory?.adapterCallObserved),
      externalWritePermittedAfterVerification: status === "ready_to_resume"
    }
  };
}

function uniqueSchedulerRestartBlockers(values) {
  return [...new Set(values.map(normalizeString).filter(Boolean))].sort();
}

function schedulerTimelineEvent(order, type, status, detail = {}) {
  return {
    order,
    type,
    status,
    detail,
  };
}

function buildSchedulerAnalyticsSnapshot(job, persistence, artifactPersistence) {
  const blocked = job.status === "blocked";
  const degraded = job.schedulerHealth.status === "degraded";
  const pendingArtifactWrites = artifactPersistence.readyToWrite;
  const missingPersistence = !persistence.memoryKey || !persistence.continuationKey;
  const restartLedger = job.restartLedger ?? {};

  return {
    snapshotVersion: "aios.mailchimp.scheduler-analytics-snapshot.v1",
    jobId: job.id,
    status: job.status,
    schedulerHealthStatus: job.schedulerHealth.status,
    isolationKey: job.runtimeScope?.isolationKey ?? null,
    counters: {
      recoveryActionCount: Array.isArray(job.recovery) ? job.recovery.length : 0,
      actionableErrorCount: job.schedulerHealth.actionableErrors.length,
      degradedWarningCount: job.schedulerHealth.degraded.length,
      blockingFailureCount: job.schedulerHealth.failures.length,
      pendingArtifactWrites,
      persistedArtifactCount: artifactPersistence.alreadyWritten,
      staleArtifactEntryCount: artifactPersistence.staleEntryCount,
      restartHistoryEntries: restartLedger.counters?.historyEntries ?? 0,
      restartReplayMatches: restartLedger.counters?.replayMatches ?? 0,
      restartBlockedReasons: restartLedger.counters?.blockedReasons ?? 0,
      packageControlBlockedReasons: job.packageControl?.blockedReasons?.length ?? 0,
    },
    exportFlags: {
      blocked,
      degraded,
      missingPersistence,
      artifactWritesPending: pendingArtifactWrites > 0,
      restartLedgerReady: restartLedger.status === "ready_to_resume",
      idempotentReplay: restartLedger.idempotentReplay === true,
      packageControlReady: packageControlAllowsHandoff(job.packageControl ?? {}),
      restartSafe:
        job.idempotency.restartSafe &&
        artifactPersistence.restartSafe &&
        artifactPersistence.pendingCommandIds.length === 0 &&
        packageControlAllowsHandoff(job.packageControl ?? {}) &&
        restartLedger.restartSafe === true,
    },
  };
}

function buildSchedulerTimeline(job, persistence, artifactPersistence) {
  const events = [
    schedulerTimelineEvent(1, "memory-snapshot", persistence.memoryKey ? "bound" : "missing", {
      memoryKey: persistence.memoryKey || null,
      continuationKey: persistence.continuationKey || null,
      checksum: persistence.checksum || null,
      sequence: persistence.sequence,
    }),
    schedulerTimelineEvent(2, "artifact-manifest", artifactPersistence.status || "unknown", {
      writeSetId: artifactPersistence.writeSetId || null,
      readyToWrite: artifactPersistence.readyToWrite,
      alreadyWritten: artifactPersistence.alreadyWritten,
      pendingCommandIds: artifactPersistence.pendingCommandIds,
    }),
    schedulerTimelineEvent(3, "scheduler-health", job.schedulerHealth.status, {
      failures: job.schedulerHealth.failures.map((entry) => entry.code),
      degraded: job.schedulerHealth.degraded.map((entry) => entry.code),
    }),
    schedulerTimelineEvent(4, "adapter-handoff", job.status === "blocked" ? "blocked" : "pending-verifier", {
      auditEvent: job.audit?.event ?? null,
      commandId: job.idempotency.commandId,
      externalWrites: false,
    }),
    schedulerTimelineEvent(5, "package-controls", job.packageControl?.status ?? "not_provided", {
      handoffId: job.packageControl?.handoffId || null,
      commandId: job.packageControl?.command?.id || null,
      nextAction: job.packageControl?.nextAction || null,
      blockedReasons: job.packageControl?.blockedReasons ?? [],
    }),
    schedulerTimelineEvent(6, "restart-ledger", job.restartLedger?.status ?? "missing", {
      commandId: job.restartLedger?.command?.id ?? null,
      restartToken: job.restartLedger?.persistedState?.restartToken ?? null,
      idempotentReplay: job.restartLedger?.idempotentReplay === true,
      blockers: job.restartLedger?.blockers ?? []
    }),
  ];

  return events.map((event) => ({
    ...event,
    restartSafeAtStep:
      event.type === "memory-snapshot"
        ? Boolean(persistence.memoryKey && persistence.continuationKey)
        : event.type === "artifact-manifest"
          ? artifactPersistence.restartSafe
          : event.type === "restart-ledger"
            ? job.restartLedger?.restartSafe === true
          : job.idempotency.restartSafe,
  }));
}

function normalizeSchedulerBackoffPolicy(policy = {}) {
  const baseSeconds = Number.isFinite(policy.baseSeconds) ? Math.max(1, Math.floor(policy.baseSeconds)) : 30;
  const maxSeconds = Number.isFinite(policy.maxSeconds) ? Math.max(baseSeconds, Math.floor(policy.maxSeconds)) : 300;
  const attempt = Number.isFinite(policy.attempt) ? Math.max(0, Math.floor(policy.attempt)) : 0;
  const mode = normalizeToken(policy.mode ?? "deterministic-linear");

  return {
    mode: ["none", "deterministic-linear", "deterministic-exponential"].includes(mode)
      ? mode
      : "deterministic-linear",
    attempt,
    baseSeconds,
    maxSeconds
  };
}

function computeSchedulerBackoffSeconds(policy, failureCount) {
  if (policy.mode === "none" || failureCount === 0) {
    return null;
  }

  const multiplier =
    policy.mode === "deterministic-exponential"
      ? 2 ** Math.min(policy.attempt, 6)
      : policy.attempt + 1;
  return Math.min(policy.maxSeconds, policy.baseSeconds * multiplier);
}

function normalizeSchedulerFailureState(job, persistence, artifactPersistence, capabilityHandoff, packageControl) {
  const restartLedger = job.restartLedger ?? {};
  const preflight = job.preflight ?? {};
  const clientRuntimeHandoff = job.clientRuntimeHandoff ?? {};
  const adapterHandoff = job.adapterHandoff ?? {};
  const schedulerFailures = job.schedulerHealth?.failures ?? [];
  const schedulerWarnings = job.schedulerHealth?.degraded ?? [];
  const missingState = [
    ...(!persistence.memoryKey ? ["memoryKey"] : []),
    ...(!persistence.continuationKey ? ["continuationKey"] : []),
    ...(!persistence.checksum ? ["checksum"] : []),
    ...(!capabilityHandoff.checkpointId ? ["capabilityCheckpointId"] : []),
    ...(!preflight.commandId ? ["preflightCommandId"] : []),
    ...(!clientRuntimeHandoff.adoptionKey ? ["clientRuntimeAdoptionKey"] : []),
    ...(!restartLedger.command?.id ? ["restartLedgerCommandId"] : [])
  ].sort();
  const blockers = uniqueSchedulerRestartBlockers([
    ...schedulerFailures.map((entry) => entry.action || entry.code),
    ...(adapterHandoff.blockers?.map((entry) => entry.action || entry.code) ?? []),
    ...(preflight.blockedReasons ?? []),
    ...(clientRuntimeHandoff.blockers?.map((entry) => entry.action || entry.code) ?? []),
    ...(restartLedger.blockers ?? []),
    ...(artifactPersistence.pendingCommandIds ?? []).map((id) => `persist artifact command ${id}`),
    ...(capabilityHandoff.pendingScopes ?? []).map((scope) => `grant capability ${scope}`),
    ...derivePackageControlRecovery(packageControl).map((entry) => entry.action || entry.code),
    ...(job.runtimeScope?.missingPermissions ?? []).map((permission) => `grant scheduler permission ${permission}`)
  ]);
  const warnings = uniqueSchedulerRestartBlockers([
    ...schedulerWarnings.map((entry) => entry.action || entry.code),
    ...(preflight.warningReasons ?? []),
    ...(restartLedger.status === "resume_degraded" ? ["restart ledger is degraded"] : []),
    ...(artifactPersistence.staleEntryCount > 0 ? ["artifact manifest has stale entries"] : []),
    ...(packageControl.status === "not_provided" ? ["package control handoff not provided"] : [])
  ]);

  return {
    status:
      blockers.length === 0 && missingState.length === 0
        ? warnings.length === 0
          ? "clear"
          : "degraded"
        : "blocked",
    blockers,
    warnings,
    missingState,
    retryableBlockers: blockers.filter((reason) => (
      !reason.includes("permission") &&
      !reason.includes("denied") &&
      !reason.includes("disabled")
    )),
    nonRetryableBlockers: blockers.filter((reason) => (
      reason.includes("permission") ||
      reason.includes("denied") ||
      reason.includes("disabled")
    ))
  };
}

function deriveSchedulerOperationalNextAction(failureState, job) {
  if (failureState.missingState.includes("memoryKey") || failureState.missingState.includes("continuationKey")) {
    return "memory.snapshot.persist";
  }
  if (failureState.missingState.includes("checksum")) {
    return "memory.snapshot.refresh-checksum";
  }
  if (job.clientRuntimeHandoff?.status === "needs_client_state") {
    return job.clientRuntimeHandoff.visible?.primaryAction || "runtime.client-state.bind";
  }
  if (job.packageControl?.status === "awaiting-approval") {
    return job.packageControl.approval?.command || "package.preview.accept";
  }
  if (job.packageControl?.status === "disabled" || job.packageControl?.status === "paused") {
    return job.packageControl.nextAction || "package.schedule.update";
  }
  if (job.capabilityHandoff?.pendingScopes?.length > 0) {
    return "capability.grant.request";
  }
  if (job.artifactPersistence?.pendingCommandIds?.length > 0) {
    return "artifact.write-set.persist";
  }
  if (job.restartLedger?.status === "already_completed") {
    return "scheduler.command.return-existing-status";
  }
  if (failureState.status === "degraded") {
    return "scheduler.retry-after-backoff";
  }
  if (failureState.status === "clear") {
    return "verifier.verify-and-handoff";
  }
  return "scheduler.state.repair";
}

function buildSchedulerOperationalHandoffStatus(
  job,
  persistence,
  artifactPersistence,
  capabilityHandoff,
  packageControl,
  options = {}
) {
  const failureState = normalizeSchedulerFailureState(
    job,
    persistence,
    artifactPersistence,
    capabilityHandoff,
    packageControl
  );
  const backoffPolicy = normalizeSchedulerBackoffPolicy(options.backoffPolicy ?? options.retry ?? {});
  const retryable =
    failureState.retryableBlockers.length > 0 ||
    failureState.status === "degraded" ||
    job.schedulerHealth?.status === "degraded" ||
    job.restartLedger?.status === "resume_degraded";
  const backoffSeconds = computeSchedulerBackoffSeconds(
    backoffPolicy,
    failureState.retryableBlockers.length + failureState.warnings.length
  );
  const status =
    job.restartLedger?.status === "already_completed"
      ? "already_completed"
      : failureState.status === "clear" && job.preflight?.mayCallAdapter === true
        ? "ready_for_verifier"
        : failureState.status === "degraded" || retryable
          ? "degraded_retryable"
          : "blocked";
  const nextAction = deriveSchedulerOperationalNextAction(failureState, job);

  return {
    statusVersion: "aios.mailchimp.scheduler-operational-handoff.v1",
    status,
    jobId: job.id,
    commandId: job.idempotency.commandId,
    preflightCommandId: job.preflight?.commandId ?? null,
    restartLedgerCommandId: job.restartLedger?.command?.id ?? null,
    clientRuntimeAdoptionKey: job.clientRuntimeHandoff?.adoptionKey ?? null,
    mayRunVerifier: status === "ready_for_verifier" || status === "already_completed",
    mayCallAdapter: status === "ready_for_verifier" && job.adapterHandoff?.mayCallAdapter === true,
    degradedMode: status === "degraded_retryable",
    retry: {
      retryable,
      backoffSeconds: retryable ? backoffSeconds ?? backoffPolicy.baseSeconds : null,
      policy: backoffPolicy,
      retryCommand: retryable
        ? stableCommandToken([
            "mailchimp.scheduler.retry",
            job.id,
            job.idempotency.commandId,
            backoffPolicy.attempt,
            nextAction
          ])
        : null
    },
    failureState,
    nextAction,
    visible: {
      badge:
        status === "ready_for_verifier" || status === "already_completed"
          ? "ready"
          : status === "degraded_retryable"
            ? "degraded"
            : "blocked",
      primaryAction: nextAction,
      disabledReason:
        status === "ready_for_verifier" || status === "already_completed"
          ? null
          : failureState.blockers[0] ?? failureState.missingState[0] ?? failureState.warnings[0] ?? "scheduler not ready",
      summary:
        status === "ready_for_verifier"
          ? "scheduler handoff is ready for verifier"
          : status === "already_completed"
            ? "scheduler command already completed; return existing status"
            : status === "degraded_retryable"
              ? "scheduler handoff can retry after deterministic backoff"
              : "scheduler handoff is blocked until required state is repaired"
    },
    handoffState: {
      memoryKey: persistence.memoryKey || null,
      continuationKey: persistence.continuationKey || null,
      checksum: persistence.checksum || null,
      artifactWriteSetId: artifactPersistence.writeSetId || null,
      capabilityCheckpointId: capabilityHandoff.checkpointId || null,
      packageControlHandoffId: packageControl.handoffId || null,
      tenantIsolationKey: job.runtimeScope?.isolationKey ?? null
    },
    truthBoundary: {
      source: "deterministic-scheduler-operational-handoff",
      externalWrites: false,
      adapterWillWriteExternally: true,
      externalWritePermittedAfterVerification: status === "ready_for_verifier"
    }
  };
}

function normalizeSchedulerAnalyticsExportPolicy(policy = {}) {
  const mode = normalizeToken(policy.mode ?? "status-summary");
  const format = normalizeToken(policy.format ?? "json.analytics");
  const retention = Number.isFinite(policy.retentionSnapshots)
    ? Math.max(1, Math.min(48, Math.floor(policy.retentionSnapshots)))
    : 12;
  const includeTimeline = policy.includeTimeline !== false;
  const includeHistory = policy.includeHistory !== false;

  return {
    mode: ["disabled", "status-summary", "operator-download", "verifier-handoff"].includes(mode)
      ? mode
      : "status-summary",
    format: ["json.summary", "json.analytics", "json.timeline"].includes(format)
      ? format
      : "json.analytics",
    retentionSnapshots: retention,
    includeTimeline,
    includeHistory,
    localOnly: policy.localOnly !== false,
    requireVerifier: policy.requireVerifier !== false
  };
}

function normalizeSchedulerAnalyticsHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((entry, index) => ({
      index,
      at: normalizeString(entry.at ?? entry.generatedAt ?? entry.timestamp ?? `history:${index}`),
      jobId: normalizeString(entry.jobId),
      status: normalizeToken(entry.status ?? entry.schedulerStatus ?? "unknown"),
      exportStatus: normalizeToken(entry.exportStatus ?? entry.status ?? "unknown"),
      preflightStatus: normalizeToken(entry.preflightStatus),
      operationalHandoffStatus: normalizeToken(entry.operationalHandoffStatus),
      restartLedgerStatus: normalizeToken(entry.restartLedgerStatus),
      blocked: entry.blocked === true || normalizeToken(entry.status) === "blocked",
      degraded: entry.degraded === true || normalizeToken(entry.status) === "degraded",
      exported: entry.exported === true || normalizeToken(entry.exportStatus) === "exported",
      commandId: normalizeString(entry.commandId),
      exportCommandId: normalizeString(entry.exportCommandId)
    }))
    .filter((entry) => entry.jobId || entry.commandId || entry.exportCommandId)
    .slice(-48);
}

function buildSchedulerAnalyticsExportControl(
  job,
  persistence,
  artifactPersistence,
  capabilityHandoff,
  packageControl,
  options = {}
) {
  const policy = normalizeSchedulerAnalyticsExportPolicy(
    options.schedulerAnalyticsExportPolicy ??
      options.analyticsExportPolicy ??
      options.exportPolicy ??
      {}
  );
  const history = normalizeSchedulerAnalyticsHistory(
    options.schedulerAnalyticsHistory ??
      options.analyticsHistory ??
      options.exportHistory ??
      []
  ).slice(-policy.retentionSnapshots);
  const current = {
    at: normalizeString(options.generatedAt ?? "logical:scheduler-analytics"),
    jobId: job.id,
    status: job.status,
    exportStatus: job.operationalHandoff?.status ?? "unknown",
    preflightStatus: job.preflight?.status ?? "missing",
    operationalHandoffStatus: job.operationalHandoff?.status ?? "missing",
    restartLedgerStatus: job.restartLedger?.status ?? "missing",
    blocked: job.status === "blocked",
    degraded: job.schedulerHealth?.status === "degraded" || job.operationalHandoff?.degradedMode === true,
    exported: false,
    commandId: job.idempotency.commandId,
    exportCommandId: ""
  };
  const snapshots = [...history, current];
  const blockers = uniqueSchedulerRestartBlockers([
    ...(policy.mode === "disabled" ? ["scheduler analytics export is disabled"] : []),
    ...(policy.localOnly ? [] : ["scheduler analytics export must remain local-only"]),
    ...(policy.requireVerifier ? [] : ["scheduler analytics export must require verifier gate"]),
    ...(job.operationalHandoff?.mayRunVerifier ? [] : ["scheduler operational handoff is not verifier-ready"]),
    ...(job.preflight?.status === "blocked" ? ["scheduler preflight is blocked"] : []),
    ...(artifactPersistence.pendingCommandIds.length > 0
      ? [`artifact write commands pending: ${artifactPersistence.pendingCommandIds.join(",")}`]
      : []),
    ...(capabilityHandoff.deniedScopes ?? []).map((scope) => `capability denied: ${scope}`),
    ...derivePackageControlRecovery(packageControl).map((entry) => entry.disabledReason || entry.action || entry.code)
  ]);
  const warnings = uniqueSchedulerRestartBlockers([
    ...(job.schedulerHealth?.degraded ?? []).map((entry) => entry.action || entry.code),
    ...(job.preflight?.warningReasons ?? []),
    ...(job.restartLedger?.status === "resume_degraded" ? ["restart ledger is degraded"] : []),
    ...(snapshots.some((snapshot) => snapshot.degraded) ? ["history contains degraded scheduler snapshot"] : [])
  ]);
  const ready = blockers.length === 0;
  const status = ready ? (warnings.length > 0 ? "degraded_ready" : "ready") : "blocked";
  const exportCommandId = stableCommandToken([
    "mailchimp.scheduler.analytics.export",
    job.id,
    job.idempotency.commandId,
    job.preflight?.commandId,
    job.restartLedger?.command?.id,
    status,
    snapshots.length
  ]);

  current.exportCommandId = exportCommandId;

  return {
    controlVersion: "aios.mailchimp.scheduler-analytics-export-control.v1",
    status,
    ready,
    jobId: job.id,
    command: {
      id: exportCommandId,
      idempotencyKey: exportCommandId,
      command: ready ? "scheduler.analytics.export" : "scheduler.analytics.repair",
      ready,
      reason: ready
        ? "scheduler analytics export can be handed to verifier"
        : blockers[0] ?? "scheduler analytics export is blocked",
      externalWrites: false,
      requiresVerifier: policy.requireVerifier
    },
    policy,
    counters: {
      snapshots: snapshots.length,
      blockedSnapshots: snapshots.filter((snapshot) => snapshot.blocked).length,
      degradedSnapshots: snapshots.filter((snapshot) => snapshot.degraded).length,
      exportedSnapshots: snapshots.filter((snapshot) => snapshot.exported).length,
      pendingArtifactCommands: artifactPersistence.pendingCommandIds.length,
      deniedCapabilities: capabilityHandoff.deniedScopes.length,
      packageControlBlockers: packageControl.blockedReasons.length,
      warnings: warnings.length,
      blockers: blockers.length
    },
    latest: current,
    history: policy.includeHistory ? snapshots : [],
    timeline: policy.includeTimeline
      ? buildSchedulerTimeline(job, persistence, artifactPersistence).map((event) => ({
          order: event.order,
          type: event.type,
          status: event.status,
          restartSafeAtStep: event.restartSafeAtStep
        }))
      : [],
    readiness: {
      ready,
      status,
      blockedReasons: blockers,
      warnings,
      nextAction:
        ready
          ? "verifier.verify-scheduler-analytics-export"
          : blockers.some((reason) => reason.includes("disabled"))
            ? "package.export-policy.enable"
            : job.operationalHandoff?.nextAction ?? "scheduler.analytics.repair"
    },
    truthBoundary: {
      source: "deterministic-scheduler-analytics-export-control",
      externalWrites: false,
      localOnly: policy.localOnly,
      verifierRequiredBeforeAdapter: policy.requireVerifier,
      evidenceSubject: `scheduler-analytics-export:${exportCommandId}`
    }
  };
}

function normalizeSchedulerLifecycleSettings(settings = {}) {
  const mode = normalizeToken(settings.mode ?? settings.scheduleMode ?? "manual");
  const enabled = settings.enabled !== false;
  const dryRun = settings.dryRun !== false;
  const requireApproval = settings.requireApproval === true;
  const maxAttempts = Number.isFinite(settings.maxAttempts)
    ? Math.max(1, Math.min(10, Math.floor(settings.maxAttempts)))
    : 3;
  const intervalMinutes = Number.isFinite(settings.intervalMinutes)
    ? Math.max(1, Math.floor(settings.intervalMinutes))
    : null;
  const allowedModes = ["manual", "scheduled", "interval", "paused", "disabled"];
  const normalizedMode = allowedModes.includes(mode) ? mode : "manual";

  return {
    enabled,
    mode: normalizedMode,
    dryRun,
    requireApproval,
    maxAttempts,
    intervalMinutes,
    startsAt: normalizeDate(settings.startsAt) || normalizeString(settings.startsAt || "logical:0"),
    stopAfter: normalizeDate(settings.stopAfter),
    localOnlyExport: settings.localOnlyExport !== false,
    verifierRequired: settings.verifierRequired !== false,
  };
}

function normalizeSchedulerLifecycleCommand(input = {}, index = 0) {
  const command = input && typeof input === "object" ? input : {};
  const id = normalizeString(command.id ?? command.commandId) || stableCommandToken([
    "mailchimp.scheduler.lifecycle",
    command.command ?? command.type ?? `command-${index + 1}`,
    command.reason ?? command.status ?? "planned",
    index,
  ]);

  return {
    id,
    idempotencyKey: normalizeString(command.idempotencyKey ?? id) || id,
    command: normalizeString(command.command ?? command.type) || "scheduler.lifecycle.review",
    status: normalizeToken(command.status ?? "planned"),
    reason: normalizeString(command.reason),
    ready: command.ready === true,
    externalWrites: command.externalWrites === true,
    requiresVerifier: command.requiresVerifier !== false,
  };
}

function buildSchedulerLifecycleControlPlan(job, packageControl, clientRuntime, intent = {}) {
  const source =
    intent.schedulerLifecycle ??
    intent.lifecycleControls ??
    intent.schedulerControls ??
    {};
  const settings = normalizeSchedulerLifecycleSettings({
    ...(packageControl.settings ?? {}),
    ...(source.settings ?? {}),
    enabled: source.enabled ?? packageControl.settings?.enabled,
    scheduleMode: source.scheduleMode ?? packageControl.schedule?.mode ?? packageControl.settings?.scheduleMode,
    dryRun: source.dryRun ?? packageControl.settings?.dryRun,
    requireApproval: source.requireApproval ?? packageControl.approval?.required,
  });
  const suppliedCommands = Array.isArray(source.commands)
    ? source.commands.map(normalizeSchedulerLifecycleCommand)
    : [];
  const blockers = uniqueSchedulerRestartBlockers([
    ...(settings.enabled ? [] : ["scheduler lifecycle is disabled"]),
    ...(settings.mode === "disabled" ? ["scheduler lifecycle mode is disabled"] : []),
    ...(settings.mode === "paused" ? ["scheduler lifecycle is paused"] : []),
    ...(settings.mode === "interval" && !settings.intervalMinutes ? ["interval schedule requires intervalMinutes"] : []),
    ...(settings.requireApproval && packageControl.approval?.accepted !== true ? ["scheduler lifecycle approval required"] : []),
    ...(clientRuntime.missingBindings ?? []).map((field) => `missing client binding ${field}`),
    ...(job.runtimeScope?.missingPermissions ?? []).map((permission) => `missing permission ${permission}`),
  ]);
  const lifecycleCommandId = stableCommandToken([
    "mailchimp.scheduler.lifecycle",
    job.id,
    job.idempotency?.commandId,
    settings.mode,
    settings.enabled ? "enabled" : "disabled",
    blockers.join("|") || "ready",
  ]);
  const generatedCommands = [
    normalizeSchedulerLifecycleCommand({
      id: lifecycleCommandId,
      command:
        blockers.length
          ? "scheduler.lifecycle.repair"
          : settings.mode === "paused"
            ? "scheduler.lifecycle.resume"
            : "scheduler.lifecycle.enable",
      status: blockers.length ? "blocked" : "ready",
      ready: blockers.length === 0,
      reason: blockers[0] ?? "scheduler lifecycle controls are ready",
      externalWrites: false,
      requiresVerifier: true,
    }),
    ...(settings.requireApproval && packageControl.approval?.accepted !== true
      ? [normalizeSchedulerLifecycleCommand({
          command: packageControl.approval?.command || "package.preview.accept",
          status: "awaiting_approval",
          reason: "operator approval required before scheduling",
          ready: false,
          externalWrites: false,
          requiresVerifier: true,
        }, 1)]
      : []),
  ];
  const commands = [...suppliedCommands, ...generatedCommands];
  const ready = blockers.length === 0 && commands.some((command) => command.ready);
  const status = ready
    ? "ready"
    : blockers.some((reason) => reason.includes("disabled"))
      ? "disabled"
      : blockers.some((reason) => reason.includes("paused"))
        ? "paused"
        : "blocked";

  return {
    controlVersion: "aios.mailchimp.scheduler-lifecycle-control.v1",
    status,
    ready,
    jobId: job.id,
    settings,
    commandId: lifecycleCommandId,
    commands,
    enablement: {
      enabled: settings.enabled && settings.mode !== "disabled",
      mayPause: status === "ready",
      mayResume: status === "paused",
      mayDisable: status !== "disabled",
      dryRun: settings.dryRun,
    },
    scheduling: {
      mode: settings.mode,
      startsAt: settings.startsAt,
      intervalMinutes: settings.intervalMinutes,
      stopAfter: settings.stopAfter,
      nextRunAt:
        status === "ready" && settings.mode === "scheduled"
          ? normalizeDate(job.payload?.sendAt) || settings.startsAt
          : status === "ready" && settings.mode === "interval"
            ? settings.startsAt
            : null,
    },
    blockers,
    nextAction:
      status === "ready"
        ? "scheduler.preflight.run"
        : blockers.some((reason) => reason.includes("approval"))
          ? packageControl.approval?.command || "package.preview.accept"
          : blockers.some((reason) => reason.includes("client binding"))
            ? clientRuntime.command || "runtime.client-state.bind"
            : "scheduler.lifecycle.update-settings",
    truthBoundary: {
      source: "deterministic-scheduler-lifecycle-control",
      externalWrites: false,
      verifierRequiredBeforeAdapter: settings.verifierRequired,
      localOnly: settings.localOnlyExport,
      evidenceSubject: `scheduler-lifecycle:${lifecycleCommandId}`,
    },
  };
}

export function parseMailchimpScheduleSource(source = "") {
  const lines = String(source)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const fields = {};
  for (const line of lines) {
    const match = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.+)$/);
    if (match) {
      fields[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  }

  return {
    astVersion: "aios.mailchimp.schedule-ast.v1",
    node: "MailchimpCampaignSchedule",
    fields,
    diagnostics: lines.length === 0 ? [{ code: "empty_schedule_source" }] : []
  };
}

export function compileMailchimpScheduleJob(intent = {}) {
  const sendAt = normalizeDate(intent.sendAt);
  const status = sendAt ? "scheduled" : "draft";
  const boundary = normalizeRuntimeBoundary(intent);
  const persistence = normalizePersistenceInput(intent);
  const artifactPersistence = normalizeArtifactPersistenceInput(intent);
  const capabilityHandoff = normalizeCapabilityHandoffInput(intent);
  const packageControl = normalizePackageControlInput(intent);
  const clientRuntime = normalizeClientRuntimeInput(intent);
  const schedulerHealth = deriveSchedulerHealth(intent, persistence);
  const healthAllowsHandoff = schedulerHealth.status !== "blocked";
  const artifactsAllowHandoff =
    !artifactPersistence.writeSetId || artifactPersistence.pendingCommandIds.length === 0;
  const packageControlsAllowHandoff = packageControlAllowsHandoff(packageControl);
  const job = {
    jobVersion: "aios.kernel.job.v1",
    id: schedulerJobId(intent),
    adapter: "mailchimp",
    operation: "campaign.schedule",
    status:
      boundary.status === "ready" &&
      healthAllowsHandoff &&
      artifactsAllowHandoff &&
      packageControlsAllowHandoff
        ? status
        : "blocked",
    payload: {
      campaignId: normalizeString(intent.campaignId),
      campaignName: normalizeString(intent.campaignName),
      listId: normalizeString(intent.listId),
      segmentId: normalizeString(intent.segmentId),
      templateId: normalizeString(intent.templateId),
      subjectLine: normalizeString(intent.subjectLine),
      sendAt
    },
    runtimeScope: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      actorId: boundary.actorId,
      role: boundary.role,
      isolationKey: boundary.isolationKey,
      permissions: boundary.permissions,
      requiredPermissions: boundary.requiredPermissions,
      missingPermissions: boundary.missingPermissions
    },
    capabilities: [
      { scope: "campaigns:schedule" },
      { scope: "campaigns:write" },
      { scope: "lists:read" }
    ],
    memory: {
      required: ["campaignName", "listId", "subjectLine"],
      checkpoint: "before-adapter-handoff",
      memoryKey: persistence.memoryKey,
      continuationKey: persistence.continuationKey,
      checksum: persistence.checksum,
      sequence: persistence.sequence,
      restartSafe: Boolean(persistence.memoryKey && persistence.continuationKey)
    },
    verifier: {
      checks: ["capabilities", "memory", "schedule-window", "truth-boundary", "package-control-handoff"]
    },
    runtimeAdapter: {
      name: "mailchimp",
      mode: "deferred-handoff",
      externalWritePermittedAfterVerification: true,
      tenantIsolationKey: boundary.isolationKey,
      auditEvent: "mailchimp.campaign.schedule.requested",
      resumeCommandId: persistence.resumeCommandId || null,
      persistCommandId: persistence.persistCommandId || null,
      capabilityCheckpointId: capabilityHandoff.checkpointId || null,
      artifactWriteSetId: artifactPersistence.writeSetId || null,
      pendingArtifactCommandIds: artifactPersistence.pendingCommandIds
    },
    schedulerHealth,
    artifactPersistence,
    capabilityHandoff,
    packageControl,
    idempotency: {
      commandId: stableCommandToken([
        "mailchimp.schedule",
        boundary.isolationKey,
        persistence.memoryKey || intent.campaignId || intent.campaignName,
        persistence.checksum || sendAt || "draft"
      ]),
      memoryChecksum: persistence.checksum,
      memorySequence: persistence.sequence,
      artifactWriteSetId: artifactPersistence.writeSetId || null,
      capabilityCheckpointId: capabilityHandoff.checkpointId || null,
      restartSafe:
        Boolean(persistence.memoryKey && persistence.continuationKey) &&
        (artifactPersistence.restartSafe || !artifactPersistence.writeSetId) &&
        capabilityHandoff.canHandoff &&
        packageControlsAllowHandoff,
      duplicatePolicy: "return-existing-scheduler-command-status"
    },
    audit: {
      event: "mailchimp.campaign.schedule.requested",
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      actorId: boundary.actorId,
      jobId: schedulerJobId(intent),
      writeSetId: artifactPersistence.writeSetId || null,
      externalWrites: false,
      handoff: "pending-verifier"
    },
    recovery: [
      ...(sendAt
        ? []
        : [
            {
              code: "missing_send_at",
              action: "keep-campaign-as-draft"
            }
          ]),
      ...(!boundary.tenantId
        ? [{ code: "missing_tenant_id", action: "bind-tenant-before-scheduling" }]
        : []),
      ...(!boundary.workspaceId
        ? [{ code: "missing_workspace_id", action: "bind-workspace-before-scheduling" }]
        : []),
      ...(!boundary.actorId
        ? [{ code: "missing_actor_id", action: "bind-actor-before-scheduling" }]
        : []),
      ...boundary.missingPermissions.map((permission) => ({
        code: "missing_scheduler_permission",
        permission,
        action: "request-role-or-permission-before-adapter-handoff"
      })),
      ...schedulerHealth.actionableErrors.map((entry) => ({
        code: entry.code,
        severity: entry.severity,
        action: entry.action,
        missingCampaignFacts: entry.missingCampaignFacts,
        missingClientState: entry.missingClientState
      })),
      ...(!artifactsAllowHandoff
        ? [
            {
              code: "artifact_writes_pending",
              action: "persist-local-artifact-write-set-before-adapter-handoff",
              pendingArtifactCommandIds: artifactPersistence.pendingCommandIds
            }
          ]
        : []),
      ...derivePackageControlRecovery(packageControl),
      ...(!capabilityHandoff.canHandoff
        ? capabilityHandoff.missingScopes.map((scope) => ({
            code: capabilityHandoff.deniedScopes.includes(scope)
              ? "capability_denied"
              : "capability_grant_required",
            scope,
            action: capabilityHandoff.deniedScopes.includes(scope)
              ? "surface-denied-scope-and-keep-job-blocked"
              : "request-idempotent-mailchimp-scope-grant"
          }))
        : [])
    ],
    rollback: {
      supported: true,
      strategy: "cancel-scheduled-send-if-adapter-confirms-job-id",
      auditEvent: "mailchimp.campaign.schedule.rollback"
    },
    truthBoundary: {
      source: "compiled-local-intent",
      externalWrites: false,
      adapterWillWriteExternally: true,
      tenantIsolationKey: boundary.isolationKey
    }
  };

  job.adapterHandoff = buildAdapterHandoffEnvelope(
    job,
    persistence,
    artifactPersistence,
    capabilityHandoff,
    packageControl
  );
  job.preflight = buildSchedulerPreflightRecord(
    job,
    persistence,
    artifactPersistence,
    capabilityHandoff,
    packageControl
  );
  job.clientRuntimeHandoff = buildClientRuntimeHandoff(
    job,
    persistence,
    artifactPersistence,
    capabilityHandoff,
    clientRuntime
  );
  job.status =
    job.clientRuntimeHandoff.ready && job.preflight.mayCallAdapter && boundary.status === "ready"
      ? status
      : "blocked";
  job.audit.handoff = job.clientRuntimeHandoff.ready ? "pending-verifier" : "blocked-before-verifier";
  job.runtimeAdapter.externalWritePermittedAfterVerification = job.clientRuntimeHandoff.ready;
  job.restartLedger = buildSchedulerRestartLedger(
    job,
    persistence,
    artifactPersistence,
    capabilityHandoff,
    clientRuntime,
    intent
  );
  job.runtimeAdapter.restartLedgerCommandId = job.restartLedger.command.id;
  job.audit.restartLedgerStatus = job.restartLedger.status;
  job.operationalHandoff = buildSchedulerOperationalHandoffStatus(
    job,
    persistence,
    artifactPersistence,
    capabilityHandoff,
    packageControl,
    intent
  );
  job.audit.operationalHandoffStatus = job.operationalHandoff.status;
  job.analyticsExportControl = buildSchedulerAnalyticsExportControl(
    job,
    persistence,
    artifactPersistence,
    capabilityHandoff,
    packageControl,
    intent
  );
  job.audit.analyticsExportControlStatus = job.analyticsExportControl.status;
  job.lifecycleControl = buildSchedulerLifecycleControlPlan(
    job,
    packageControl,
    clientRuntime,
    intent
  );
  job.audit.lifecycleControlStatus = job.lifecycleControl.status;
  if (!job.lifecycleControl.ready) {
    job.status = "blocked";
    job.recovery.push(...job.lifecycleControl.blockers.map((reason) => ({
      code: reason.includes("approval")
        ? "scheduler_lifecycle_approval_required"
        : reason.includes("disabled")
          ? "scheduler_lifecycle_disabled"
          : "scheduler_lifecycle_blocked",
      action: reason,
    })));
  }

  return job;
}

export function lowerMailchimpScheduleSource(source = "") {
  const ast = parseMailchimpScheduleSource(source);
  const job = compileMailchimpScheduleJob({
    campaignId: ast.fields.campaignId,
    campaignName: ast.fields.campaignName,
    listId: ast.fields.listId,
    segmentId: ast.fields.segmentId,
    templateId: ast.fields.templateId,
    subjectLine: ast.fields.subjectLine,
    sendAt: ast.fields.sendAt,
    tenantId: ast.fields.tenantId,
    workspaceId: ast.fields.workspaceId,
    actorId: ast.fields.actorId,
    role: ast.fields.role,
    permissions: ast.fields.permissions ? ast.fields.permissions.split(",") : []
  });

  return {
    compileVersion: "aios.mailchimp.lowering.v1",
    ast,
    job,
    diagnostics: [
      ...ast.diagnostics,
      ...job.recovery.map((entry) => ({ code: entry.code, severity: "warning" }))
    ]
  };
}

export function compileMailchimpSchedulerBoundary(intent = {}) {
  const boundary = normalizeRuntimeBoundary(intent);
  const persistence = normalizePersistenceInput(intent);
  const artifactPersistence = normalizeArtifactPersistenceInput(intent);
  const schedulerHealth = deriveSchedulerHealth(intent, persistence);
  return {
    contractVersion: "aios.mailchimp.scheduler-boundary.v1",
    status: boundary.status === "ready" ? schedulerHealth.status : boundary.status,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    actorId: boundary.actorId,
    role: boundary.role,
    isolationKey: boundary.isolationKey,
    requiredPermissions: boundary.requiredPermissions,
    grantedPermissions: boundary.permissions,
    missingPermissions: boundary.missingPermissions,
    auditHandoff: {
      event: "mailchimp.campaign.schedule.requested",
      externalWrites: false,
      requiredBeforeAdapter: true,
      memoryKey: persistence.memoryKey || null,
      continuationKey: persistence.continuationKey || null,
      checksum: persistence.checksum || null,
      artifactWriteSetId: artifactPersistence.writeSetId || null,
      pendingArtifactCommandIds: artifactPersistence.pendingCommandIds
    },
    restartLedger: compileMailchimpScheduleJob(intent).restartLedger,
    artifactPersistence,
    schedulerHealth,
    recovery: [
      ...(!boundary.tenantId
        ? [{ code: "missing_tenant_id", action: "bind-tenant-before-scheduling" }]
        : []),
      ...(!boundary.workspaceId
        ? [{ code: "missing_workspace_id", action: "bind-workspace-before-scheduling" }]
        : []),
      ...(!boundary.actorId
        ? [{ code: "missing_actor_id", action: "bind-actor-before-scheduling" }]
        : []),
      ...boundary.missingPermissions.map((permission) => ({
        code: "missing_scheduler_permission",
        permission,
        action: "request-role-or-permission-before-adapter-handoff"
      })),
      ...schedulerHealth.actionableErrors.map((entry) => ({
        code: entry.code,
        severity: entry.severity,
        action: entry.action
      }))
    ],
    truthBoundary: {
      source: "deterministic-scheduler-boundary",
      externalWrites: false,
      tenantIsolationKey: boundary.isolationKey
    }
  };
}

export function planMailchimpSchedulerRecovery(intent = {}) {
  const job = compileMailchimpScheduleJob(intent);
  const persistence = normalizePersistenceInput(intent);
  const artifactPersistence = normalizeArtifactPersistenceInput(intent);
  const restartLedger = job.restartLedger;
  const retryable = job.schedulerHealth.status === "degraded";
  const commandId = stableCommandToken([
    "mailchimp.scheduler.recover",
    job.runtimeScope?.isolationKey,
    persistence.continuationKey || job.id,
    persistence.checksum || "no-checksum"
  ]);

  return {
    recoveryPlanVersion: "aios.mailchimp.scheduler-recovery-plan.v1",
    status:
      job.status !== "blocked"
        ? "ready"
        : retryable
          ? "retry_after_backoff"
          : "blocked_until_state_is_repaired",
    jobId: job.id,
    command: {
      commandVersion: "aios.mailchimp.scheduler-command.v1",
      id: commandId,
      idempotencyKey: commandId,
      type: persistence.canResume ? "resume-scheduler-handoff" : "repair-scheduler-state",
      jobId: job.id,
      memoryKey: persistence.memoryKey,
      continuationKey: persistence.continuationKey,
      checksum: persistence.checksum,
      artifactWriteSetId: artifactPersistence.writeSetId || null,
      pendingArtifactCommandIds: artifactPersistence.pendingCommandIds,
      status: job.status === "blocked" ? "blocked" : "ready_to_enqueue",
      externalWrites: false
    },
    retry: {
      retryable,
      backoffSeconds: retryable ? 60 : null,
      degradedMode: job.schedulerHealth.status === "degraded"
    },
    restartLedger: {
      status: restartLedger.status,
      restartSafe: restartLedger.restartSafe,
      idempotentReplay: restartLedger.idempotentReplay,
      command: restartLedger.command,
      persistedState: restartLedger.persistedState,
      blockers: restartLedger.blockers,
    },
    operationalHandoff: job.operationalHandoff,
    lifecycleControl: job.lifecycleControl,
    actionableErrors: job.schedulerHealth.actionableErrors,
    artifactPersistence,
    rollback: {
      supported: true,
      strategy: "drop-local-scheduler-command-and-keep-memory-snapshot",
      commandId
    },
    truthBoundary: {
      source: "deterministic-scheduler-recovery-planner",
      externalWrites: false,
      tenantIsolationKey: job.runtimeScope?.isolationKey
    }
  };
}

export function createMailchimpSchedulerPreflight(intent = {}) {
  const job = compileMailchimpScheduleJob(intent);
  return {
    ...job.preflight,
    clientRuntimeHandoff: job.clientRuntimeHandoff,
    restartLedger: job.restartLedger,
    lifecycleControl: job.lifecycleControl,
    jobStatus: job.status,
    schedulerHealthStatus: job.schedulerHealth.status,
    adapterHandoffStatus: job.adapterHandoff.status,
    nextAction:
      job.clientRuntimeHandoff.status === "needs_client_state"
        ? job.clientRuntimeHandoff.visible.primaryAction
        : job.preflight.status === "ready"
        ? "run-verifier-before-adapter-handoff"
        : job.preflight.recovery[0]?.action ?? "repair-scheduler-preflight",
    auditEvent: {
      status: job.preflight.status === "ready" ? "verifying" : "queued",
      message:
        job.preflight.status === "ready"
          ? "scheduler preflight ready for verifier"
          : `scheduler preflight blocked: ${job.preflight.blockedReasons[0] ?? "unknown blocker"}`,
      actor: "scheduler-preflight"
    }
  };
}

export function summarizeMailchimpSchedulerAnalytics(intent = {}) {
  const job = compileMailchimpScheduleJob(intent);
  const persistence = normalizePersistenceInput(intent);
  const artifactPersistence = normalizeArtifactPersistenceInput(intent);
  const snapshot = buildSchedulerAnalyticsSnapshot(job, persistence, artifactPersistence);
  const timeline = buildSchedulerTimeline(job, persistence, artifactPersistence);
  const exportControl = job.analyticsExportControl;

  return {
    exportVersion: "aios.mailchimp.scheduler-analytics-export.v1",
    status:
      snapshot.exportFlags.blocked
        ? "blocked"
        : snapshot.exportFlags.artifactWritesPending
          ? "artifact_persistence_pending"
          : snapshot.exportFlags.degraded
            ? "degraded"
            : "ready",
    jobId: job.id,
    generatedFrom: "deterministic-local-scheduler-state",
    snapshot,
    timeline,
    exportControl,
    historySummary: {
      firstEvent: timeline[0]?.type ?? null,
      lastEvent: timeline[timeline.length - 1]?.type ?? null,
      eventCount: timeline.length,
      blockedEvents: timeline.filter((event) => event.status === "blocked" || event.status === "missing").length,
      restartSafeEvents: timeline.filter((event) => event.restartSafeAtStep).length,
      retainedExportSnapshots: exportControl.history.length,
      degradedExportSnapshots: exportControl.counters.degradedSnapshots,
    },
    exportReadySummary: {
      commandId: job.idempotency.commandId,
      analyticsExportCommandId: exportControl.command.id,
      analyticsExportStatus: exportControl.status,
      analyticsExportReady: exportControl.ready,
      preflightCommandId: job.preflight.commandId,
      preflightStatus: job.preflight.status,
      operationalHandoffStatus: job.operationalHandoff.status,
      operationalNextAction: job.operationalHandoff.nextAction,
      lifecycleControlStatus: job.lifecycleControl.status,
      lifecycleControlCommandId: job.lifecycleControl.commandId,
      lifecycleNextAction: job.lifecycleControl.nextAction,
      retryBackoffSeconds: job.operationalHandoff.retry.backoffSeconds,
      restartLedgerStatus: job.restartLedger.status,
      restartLedgerCommandId: job.restartLedger.command.id,
      memoryKey: persistence.memoryKey || null,
      continuationKey: persistence.continuationKey || null,
      artifactWriteSetId: artifactPersistence.writeSetId || null,
      pendingArtifactCommandIds: artifactPersistence.pendingCommandIds,
      nextAction:
        job.clientRuntimeHandoff.status === "needs_client_state"
          ? job.clientRuntimeHandoff.visible.primaryAction
          : !exportControl.ready
            ? exportControl.readiness.nextAction
          : job.preflight.status !== "ready"
            ? job.preflight.recovery[0]?.action ?? "repair-scheduler-preflight"
            : job.status === "blocked"
              ? "repair-scheduler-state-before-export"
              : artifactPersistence.pendingCommandIds.length > 0
                ? "persist-local-artifacts-before-adapter-handoff"
                : "export-scheduler-status-to-client",
    },
    truthBoundary: {
      source: "deterministic-scheduler-analytics-export",
      externalWrites: false,
      tenantIsolationKey: job.runtimeScope?.isolationKey
    }
  };
}
