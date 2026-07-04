import {
  assertAiosCliCheckContractReady,
  buildAiosCliCheckContract,
} from "./cli-check.mjs";
import {
  assertAiosMailchimpLanguageServerModelReady,
  buildAiosMailchimpLanguageServerModel,
} from "./language-server-model.mjs";
import {
  assertAiosMailchimpManifestReady,
  buildAiosMailchimpManifest,
} from "./manifest-writer.mjs";
import {
  assertAiosMailchimpPackageScaffoldReady,
  buildAiosMailchimpPackageScaffold,
} from "./package-scaffold.mjs";

export const CLI_DOCTOR_PROTOCOL = "aios.language.mailchimp-cli-doctor.v1";

function diagnostic(severity, code, message, path = "$", nextAction = "") {
  return Object.freeze({ severity, code, message, path, ...(nextAction ? { nextAction } : {}) });
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function stableHash(value) {
  const source = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function summarizeReadiness(id, readiness, path, required = true) {
  return Object.freeze({
    id,
    path,
    required,
    passed: readiness.ok === true,
    status: readiness.ok === true ? "passed" : required ? "failed" : "advisory",
    diagnosticCount: readiness.diagnostics.length,
    nextAction: readiness.nextAction,
  });
}

function createPersistedState(status, remediation, contracts, options = {}) {
  const analytics = contracts.languageServer.analytics;
  const recoveryToken = cleanText(contracts.manifest.manifest.recovery.resumeToken)
    || cleanText(contracts.scaffold.recoveryHandoff.resumeToken)
    || stableHash(contracts.manifest.manifestHash);
  const commandKey = stableHash([
    "doctor",
    contracts.manifest.manifestHash,
    contracts.scaffold.status.state,
    contracts.languageServer.status,
    remediation.actions.map((action) => action.id).join(","),
  ].join(":"));
  const checkpoint = Object.freeze({
    protocol: "aios.language.mailchimp-cli-doctor-checkpoint.v1",
    checkpointId: stableHash(`${commandKey}:${analytics?.snapshotId ?? "no-analytics"}`),
    command: "doctor",
    idempotencyKey: cleanText(options.idempotencyKey) || commandKey,
    sourceHash: contracts.manifest.manifest.sourceHash,
    manifestHash: contracts.manifest.manifestHash,
    packageName: contracts.manifest.packageName,
    state: status.state,
    failureState: status.failureState,
    recoveryToken,
    analyticsSnapshotId: analytics?.snapshotId ?? "missing",
  });
  const restartPlan = Object.freeze({
    protocol: "aios.language.mailchimp-cli-doctor-restart-plan.v1",
    restartSafe: status.state !== "blocked" || remediation.actionCount > 0,
    resumeToken: recoveryToken,
    idempotentCommand: "aios mailchimp doctor --resume",
    idempotencyKey: checkpoint.idempotencyKey,
    expectedState: status.state,
    replayGuards: Object.freeze([
      Object.freeze({
        id: "manifest-hash-match",
        path: "$.manifestHash",
        expected: contracts.manifest.manifestHash,
      }),
      Object.freeze({
        id: "analytics-snapshot-match",
        path: "$.analytics.snapshotId",
        expected: analytics?.snapshotId ?? "missing",
      }),
      Object.freeze({
        id: "scaffold-file-count-match",
        path: "$.contracts.scaffoldFiles",
        expected: contracts.scaffold.files.length,
      }),
    ]),
    nextAction: status.state === "blocked"
      ? remediation.nextAction
      : status.state === "degraded"
        ? "resume-mailchimp-cli-doctor-degraded"
        : "resume-mailchimp-cli-doctor-healthy",
  });
  const statusSnapshot = Object.freeze({
    protocol: "aios.language.mailchimp-cli-doctor-status-snapshot.v1",
    snapshotId: stableHash(`${checkpoint.checkpointId}:${status.state}:${status.nextAction}`),
    state: status.state,
    failureState: status.failureState,
    providerState: status.providerState,
    manifestState: status.manifestState,
    scaffoldState: status.scaffoldState,
    languageServerStatus: status.languageServerStatus,
    tenantState: contracts.manifest.manifest.tenantBoundary?.state ?? "unknown",
    healthState: contracts.scaffold.operationalHealth?.state ?? "unknown",
    exportReady: analytics?.exportSummary?.ready === true,
    counters: analytics?.counters ?? Object.freeze({}),
    nextAction: status.nextAction,
  });

  return Object.freeze({
    protocol: "aios.language.mailchimp-cli-doctor-persisted-state.v1",
    checkpoint,
    statusSnapshot,
    restartPlan,
    recoveryPath: Object.freeze({
      state: status.state === "blocked" ? "repair" : status.state === "degraded" ? "resume-degraded" : "resume-ready",
      remediationActions: remediation.actions.map((action) => action.id),
      retryPlan: contracts.scaffold.operationalHealth?.retry ?? Object.freeze({ retryable: false }),
      timeline: analytics?.timeline ?? Object.freeze([]),
      nextAction: restartPlan.nextAction,
    }),
  });
}

function createDoctorStatus(checks, contracts) {
  const failed = checks.filter((check) => check.required && !check.passed);
  const advisory = checks.filter((check) => !check.required && !check.passed);
  const providerBlocked = contracts.manifest.manifest.mailchimp.missingScopes.length > 0
    || contracts.manifest.status.state === "provider-blocked";
  const state = failed.length > 0 ? "blocked" : advisory.length > 0 ? "degraded" : "healthy";
  const failureState = providerBlocked
    ? "mailchimp-provider-blocked"
    : contracts.manifest.manifest.tenantBoundary?.state === "blocked"
      ? "mailchimp-tenant-boundary-blocked"
    : contracts.scaffold.operationalHealth?.state === "unhealthy"
      ? "mailchimp-package-health-blocked"
    : failed[0]?.id ?? "none";
  return Object.freeze({
    protocol: "aios.language.mailchimp-cli-doctor-status.v1",
    state,
    failureState,
    requiredPassed: failed.length === 0,
    advisoryCount: advisory.length,
    providerState: contracts.manifest.manifest.mailchimp.state,
    providerSyncState: contracts.manifest.manifest.mailchimp.syncChannel ? contracts.check.statusHandoff.mailchimpSyncState : "unknown",
    manifestState: contracts.manifest.status.state,
    scaffoldState: contracts.scaffold.status.state,
    packageHealthState: contracts.scaffold.operationalHealth?.state ?? "unknown",
    tenantState: contracts.manifest.manifest.tenantBoundary?.state ?? "unknown",
    languageServerStatus: contracts.languageServer.status,
    analyticsSnapshotId: contracts.languageServer.analytics?.snapshotId ?? "missing",
    nextAction: failed[0]?.nextAction
      || advisory[0]?.nextAction
      || contracts.languageServer.statusHandoff.nextAction
      || "publish-mailchimp-runtime-package",
  });
}

function createDoctorRemediation(status, contracts) {
  const missingScopes = contracts.manifest.manifest.mailchimp.missingScopes;
  const tenantBoundary = contracts.manifest.manifest.tenantBoundary;
  const health = contracts.scaffold.operationalHealth;
  const actions = [
    ...(missingScopes.length > 0
      ? [Object.freeze({
        id: "negotiate-mailchimp-scopes",
        command: "aios.mailchimp.negotiateCapabilities",
        reason: "Compiled Mailchimp scopes are not accepted by the provider contract.",
        data: Object.freeze({ missingScopes }),
      })]
      : []),
    ...(!contracts.manifest.manifest.mailchimp.audienceId && !contracts.manifest.manifest.mailchimp.campaignId
      ? [Object.freeze({
        id: "configure-mailchimp-identity",
        command: "aios.mailchimp.configureIdentity",
        reason: "Mailchimp handoff is deterministic only when an audience or campaign identity is present.",
        data: Object.freeze({ packageName: contracts.manifest.packageName }),
      })]
      : []),
    ...(tenantBoundary?.state === "blocked"
      ? [Object.freeze({
        id: "repair-mailchimp-tenant-boundary",
        command: "aios.mailchimp.repairTenantBoundary",
        reason: "Tenant identity or permission envelope prevents safe package handoff.",
        data: Object.freeze({
          tenantId: tenantBoundary.tenantId,
          workspaceId: tenantBoundary.workspaceId,
          deniedPermissions: tenantBoundary.deniedPermissions,
        }),
      })]
      : []),
    ...(health?.state === "unhealthy"
      ? [Object.freeze({
        id: "repair-package-health",
        command: "aios.mailchimp.repairPackageHealth",
        reason: "Package scaffold operational health is blocked before restart-safe handoff.",
        data: Object.freeze({
          state: health.state,
          failureCodes: health.failureCodes,
          retryable: health.retry.retryable,
          nextBackoffMs: health.retry.nextBackoffMs,
        }),
      })]
      : []),
    Object.freeze({
      id: "preview-scaffold",
      command: "aios.mailchimp.packageScaffold",
      reason: "Review the generated package manifest, adapter, and recovery files before write handoff.",
      data: Object.freeze({
        packageName: contracts.scaffold.packageName,
        plannedFileCount: contracts.scaffold.files.length,
        writeEnabled: contracts.scaffold.status.writeEnabled,
      }),
    }),
  ];
  return Object.freeze({
    protocol: "aios.language.mailchimp-cli-doctor-remediation.v1",
    status: status.state,
    actionCount: actions.length,
    actions: Object.freeze(actions),
    nextAction: actions[0]?.id || status.nextAction,
  });
}

function createDoctorBoundaryGate(status, remediation, contracts, options = {}) {
  const tenantBoundary = contracts.manifest.manifest.tenantBoundary;
  const manifestHealth = contracts.manifest.manifest.operationalHealth;
  const lifecycle = contracts.languageServer.lifecycle;
  const requestedWorkspace = cleanText(options.workspaceId || options.workspace || tenantBoundary?.workspaceId);
  const requestedRole = cleanText(options.role || tenantBoundary?.role || "preview-operator");
  const allowedRoles = Object.freeze(["runtime-publisher", "preview-operator", "reader"]);
  const role = allowedRoles.includes(requestedRole) ? requestedRole : "preview-operator";
  const requestedPermissions = Object.freeze([
    ...new Set([
      ...(tenantBoundary?.requestedPermissions ?? []),
      ...((Array.isArray(options.permissions) ? options.permissions : []).map(cleanText).filter(Boolean)),
    ]),
  ].sort());
  const deniedPermissions = Object.freeze([
    ...new Set([
      ...(tenantBoundary?.deniedPermissions ?? []),
      ...(role === "reader" ? ["mailchimp:package:write", "mailchimp:runtime:publish"] : []),
      ...(!requestedWorkspace ? ["mailchimp:workspace:identity"] : []),
    ]),
  ].sort());
  const allowedPermissions = Object.freeze(requestedPermissions
    .filter((permission) => !deniedPermissions.includes(permission))
    .sort());
  const writeRequested = contracts.scaffold.status.writeEnabled || lifecycle?.settings?.mode === "write";
  const publishRequested = writeRequested && contracts.manifest.status.runtimeReady;
  const gateFailures = Object.freeze([
    ...(tenantBoundary?.state === "blocked" ? ["tenant-boundary-blocked"] : []),
    ...(deniedPermissions.length > 0 ? ["permission-denied"] : []),
    ...(requestedWorkspace && tenantBoundary?.workspaceId && requestedWorkspace !== tenantBoundary.workspaceId ? ["workspace-mismatch"] : []),
    ...(publishRequested && tenantBoundary?.safeBoundary?.canPublishRuntime !== true ? ["runtime-publish-denied"] : []),
    ...(writeRequested && tenantBoundary?.safeBoundary?.canWritePackage !== true ? ["package-write-denied"] : []),
  ]);
  const gateState = gateFailures.length > 0
    ? "blocked"
    : status.state === "healthy" && manifestHealth?.state !== "unhealthy"
      ? "clear"
      : "degraded";
  const auditQueue = Object.freeze([
    Object.freeze({
      id: "doctor-boundary-evaluated",
      level: gateState === "blocked" ? "error" : gateState === "degraded" ? "warn" : "info",
      workspaceId: requestedWorkspace || "unknown",
      tenantId: tenantBoundary?.tenantId ?? "unknown",
      role,
      state: gateState,
    }),
    Object.freeze({
      id: "doctor-permissions-evaluated",
      level: deniedPermissions.length > 0 ? "warn" : "info",
      requested: requestedPermissions.length,
      allowed: allowedPermissions.length,
      denied: deniedPermissions.length,
    }),
    Object.freeze({
      id: "doctor-lifecycle-evaluated",
      level: lifecycle?.state === "disabled" ? "warn" : "info",
      lifecycleState: lifecycle?.state ?? "unknown",
      schedulerEnabled: lifecycle?.scheduler?.enabled === true,
      nextAction: lifecycle?.nextAction ?? contracts.languageServer.statusHandoff.nextAction,
    }),
  ]);
  const handoff = Object.freeze({
    protocol: "aios.language.mailchimp-cli-doctor-boundary-gate.v1",
    state: gateState,
    workspaceId: requestedWorkspace || tenantBoundary?.workspaceId || "unknown",
    tenantId: tenantBoundary?.tenantId ?? "unknown",
    role,
    isolationKey: tenantBoundary?.isolationKey ?? "missing",
    requestedPermissions,
    allowedPermissions,
    deniedPermissions,
    gateFailures,
    safeBoundary: Object.freeze({
      canPreviewRuntime: gateState !== "blocked" && tenantBoundary?.safeBoundary?.canPreviewRuntime === true,
      canWritePackage: gateState !== "blocked" && tenantBoundary?.safeBoundary?.canWritePackage === true && role !== "reader",
      canPublishRuntime: gateState === "clear" && tenantBoundary?.safeBoundary?.canPublishRuntime === true && role === "runtime-publisher",
      restartSafe: gateState !== "blocked" && contracts.languageServer.status !== "blocked",
    }),
    audit: Object.freeze({
      protocol: "aios.language.mailchimp-cli-doctor-boundary-audit.v1",
      correlationId: contracts.manifest.manifest.mailchimp.correlationId,
      queueHash: stableHash(auditQueue.map((event) => `${event.id}:${event.level}:${event.state ?? ""}`).join("|")),
      events: auditQueue,
      nextAction: gateState === "blocked" ? "repair-mailchimp-doctor-boundary-gate" : "record-mailchimp-doctor-boundary-audit",
    }),
    nextAction: gateState === "blocked"
      ? remediation.actions.find((action) => action.id.includes("tenant") || action.id.includes("scope"))?.id
        || "repair-mailchimp-doctor-boundary-gate"
      : lifecycle?.nextAction || status.nextAction,
  });

  return handoff;
}

function createDoctorAnalyticsExport(status, remediation, boundaryGate, persistedState, contracts, options = {}) {
  const manifestLifecycle = contracts.manifest.manifest.lifecycleControls;
  const providerContract = contracts.manifest.manifest.providerContract;
  const languageAnalytics = contracts.languageServer.analytics;
  const scaffoldHealth = contracts.scaffold.operationalHealth;
  const priorHistory = Array.isArray(options.doctorHistory)
    ? options.doctorHistory
    : Array.isArray(options.history)
      ? options.history
      : [];
  const generatedAt = cleanText(options.generatedAt) || "logical:doctor-analytics";
  const readinessCounts = Object.freeze({
    passed: Number(options.readinessPassed ?? 0),
    failed: status.requiredPassed ? 0 : 1,
    advisory: status.advisoryCount,
  });
  const counters = Object.freeze({
    diagnostics: Number(options.diagnosticCount ?? 0),
    remediationActions: remediation.actionCount,
    deniedPermissions: boundaryGate.deniedPermissions.length,
    allowedPermissions: boundaryGate.allowedPermissions.length,
    scaffoldFiles: contracts.scaffold.files.length,
    languageServerDocuments: contracts.languageServer.workspace.documents.length,
    lifecycleBlocked: manifestLifecycle?.state === "blocked" ? 1 : 0,
    lifecycleScheduled: manifestLifecycle?.scheduler?.enabled === true ? 1 : 0,
    providerBlocked: providerContract?.state === "blocked" ? 1 : 0,
    providerNegotiationPending: providerContract?.capabilityNegotiation?.state === "pending" ? 1 : 0,
    retryable: scaffoldHealth?.retry?.retryable === true || contracts.manifest.manifest.operationalHealth?.retry?.retryable === true ? 1 : 0,
    exportReady: languageAnalytics?.exportSummary?.ready === true && manifestLifecycle?.validation?.ready !== false ? 1 : 0,
  });
  const readinessVector = Object.freeze([
    Object.freeze({ id: "status", state: status.state, healthy: status.state === "healthy" }),
    Object.freeze({ id: "boundary", state: boundaryGate.state, healthy: boundaryGate.state !== "blocked" }),
    Object.freeze({ id: "manifestLifecycle", state: manifestLifecycle?.state ?? "missing", healthy: manifestLifecycle?.validation?.ready === true }),
    Object.freeze({ id: "providerContract", state: providerContract?.state ?? "missing", healthy: providerContract?.validation?.ready === true }),
    Object.freeze({ id: "scaffoldHealth", state: scaffoldHealth?.state ?? "unknown", healthy: scaffoldHealth?.state !== "unhealthy" }),
    Object.freeze({ id: "languageServer", state: contracts.languageServer.status, healthy: contracts.languageServer.status !== "blocked" }),
  ]);
  const blockedSignals = Object.freeze([
    ...(status.state === "blocked" ? [status.failureState] : []),
    ...boundaryGate.gateFailures.map((failure) => `boundary:${failure}`),
    ...((manifestLifecycle?.validation?.blockers ?? []).map((blocker) => `lifecycle:${blocker}`)),
    ...((providerContract?.validation?.blockers ?? []).map((blocker) => `provider:${blocker}`)),
    ...((contracts.manifest.manifest.operationalHealth?.failureSignals ?? []).map((signal) => `manifest:${signal}`)),
    ...((scaffoldHealth?.failureCodes ?? []).map((code) => `scaffold:${code}`)),
  ]);
  const current = Object.freeze({
    cursor: `${contracts.manifest.packageName}:doctor:${persistedState.checkpoint.checkpointId}`,
    generatedAt,
    state: status.state,
    failureState: status.failureState,
    boundaryState: boundaryGate.state,
    lifecycleState: manifestLifecycle?.state ?? "missing",
    providerState: providerContract?.state ?? "missing",
    providerNegotiationState: providerContract?.capabilityNegotiation?.state ?? "missing",
    lifecycleNextAction: manifestLifecycle?.nextAction ?? contracts.manifest.statusHandoff.nextAction,
    remediationCount: remediation.actionCount,
    blockedCount: blockedSignals.length,
    exportReady: counters.exportReady === 1,
    checkpointId: persistedState.checkpoint.checkpointId,
  });
  const history = Object.freeze([...priorHistory, current].slice(-12));
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const trend = previous === null
    ? "new"
    : previous.state === current.state && previous.blockedCount === current.blockedCount
      ? "unchanged"
      : current.blockedCount < previous.blockedCount
        ? "improving"
        : current.blockedCount > previous.blockedCount
          ? "regressed"
          : "state-changed";
  const timeline = Object.freeze(history.map((entry, index) => Object.freeze({
    index,
    at: entry.generatedAt,
    event: entry.exportReady
      ? "doctor-export-ready"
      : entry.blockedCount > 0
        ? "doctor-blocked"
        : "doctor-review",
    state: entry.state,
    boundaryState: entry.boundaryState,
    lifecycleState: entry.lifecycleState,
    providerState: entry.providerState,
    blockedCount: entry.blockedCount,
    checkpointId: entry.checkpointId,
  })));
  const exportId = stableHash([
    contracts.manifest.manifestHash,
    persistedState.checkpoint.checkpointId,
    current.state,
    current.boundaryState,
    current.lifecycleState,
    current.providerState,
    current.blockedCount,
  ].join(":"));
  const readyForExport = blockedSignals.length === 0
    && boundaryGate.state !== "blocked"
    && manifestLifecycle?.validation?.ready === true
    && providerContract?.validation?.ready === true;

  return Object.freeze({
    protocol: "aios.language.mailchimp-cli-doctor-analytics-export.v1",
    exportId,
    generatedAt,
    readyForExport,
    counters,
    readinessCounts,
    readinessVector,
    blockedSignals,
    history: Object.freeze({
      cursor: current.cursor,
      entries: history,
      trend,
      snapshotCount: history.length,
      latest: current,
    }),
    timeline,
    report: Object.freeze({
      title: "Mailchimp CLI doctor runtime adoption report",
      packageName: contracts.manifest.packageName,
      manifestHash: contracts.manifest.manifestHash,
      checkpointId: persistedState.checkpoint.checkpointId,
      status: status.state,
      boundaryState: boundaryGate.state,
      lifecycleState: manifestLifecycle?.state ?? "missing",
      providerState: providerContract?.state ?? "missing",
      nextAction: readyForExport
        ? "export-mailchimp-cli-doctor-summary"
        : blockedSignals[0]?.startsWith("lifecycle:")
          ? manifestLifecycle.nextAction
          : blockedSignals[0]?.startsWith("provider:")
            ? providerContract.externalHandoff.nextAction
          : boundaryGate.nextAction,
      rows: Object.freeze([
        Object.freeze({ key: "remediation", value: remediation.actionCount, status: remediation.actionCount === 0 ? "ready" : "review" }),
        Object.freeze({ key: "permissions", value: boundaryGate.deniedPermissions.length, status: boundaryGate.deniedPermissions.length === 0 ? "ready" : "blocked" }),
        Object.freeze({ key: "lifecycle", value: manifestLifecycle?.state ?? "missing", status: manifestLifecycle?.validation?.ready === true ? "ready" : "blocked" }),
        Object.freeze({ key: "provider", value: providerContract?.state ?? "missing", status: providerContract?.validation?.ready === true ? "ready" : "review" }),
        Object.freeze({ key: "exports", value: counters.exportReady, status: counters.exportReady === 1 ? "ready" : "review" }),
      ]),
    }),
  });
}

function createDoctorProviderLifecycle(status, remediation, boundaryGate, persistedState, contracts, options = {}) {
  const providerContract = contracts.manifest.manifest.providerContract;
  const lifecycleControls = contracts.manifest.manifest.lifecycleControls;
  const generatedAt = cleanText(options.providerDoctorGeneratedAt || options.generatedAt) || "logical:doctor-provider";
  const disabledByOperator = options.providerDisabled === true || options.disableProvider === true;
  const requestedEnable = options.providerEnabled === true || options.enableProvider === true;
  const providerMissing = !providerContract?.contractId;
  const negotiationBlocked = providerContract?.capabilityNegotiation?.state === "blocked";
  const syncBlocked = providerContract?.syncMetadata?.state === "missing-channel";
  const lifecycleBlocked = lifecycleControls?.state === "blocked";
  const boundaryBlocked = boundaryGate.state === "blocked";
  const blockers = Object.freeze([
    ...(providerMissing ? ["provider contract is missing from manifest"] : []),
    ...(negotiationBlocked ? providerContract.capabilityNegotiation.missingScopes.map((scope) => `mailchimp provider scope missing: ${scope}`) : []),
    ...(syncBlocked ? ["mailchimp provider sync channel is missing"] : []),
    ...(lifecycleBlocked ? ["mailchimp provider lifecycle controls are blocked"] : []),
    ...(boundaryBlocked ? ["mailchimp doctor boundary gate is blocked"] : []),
    ...(disabledByOperator && requestedEnable ? ["provider lifecycle cannot be disabled and enabled in the same command"] : []),
  ]);
  const state = disabledByOperator
    ? "disabled"
    : blockers.length > 0
      ? "blocked"
      : providerContract.state === "ready" && boundaryGate.safeBoundary.canPublishRuntime
        ? "ready"
        : providerContract.state === "preview" || status.state === "degraded"
          ? "preview"
          : "pending";
  const commandSeed = stableHash([
    providerContract?.contractId ?? "missing-provider",
    persistedState.checkpoint.checkpointId,
    boundaryGate.audit.queueHash,
    state,
  ].join(":"));
  const nextAction = state === "ready"
    ? "acknowledge-mailchimp-provider-handoff"
    : state === "preview"
      ? "sync-mailchimp-provider-preview"
      : state === "disabled"
        ? "enable-mailchimp-provider-lifecycle"
        : negotiationBlocked
          ? "negotiate-mailchimp-provider-capabilities"
          : syncBlocked
            ? "repair-mailchimp-provider-sync"
            : boundaryGate.nextAction;
  const commands = Object.freeze({
    negotiate: Object.freeze({
      idempotent: true,
      idempotencyKey: `${commandSeed}:negotiate`,
      command: providerContract?.commands?.negotiate?.command ?? "aios.mailchimp.provider.negotiateCapabilities",
      enabled: state === "blocked" && negotiationBlocked,
      nextAction: "negotiate-mailchimp-provider-capabilities",
    }),
    sync: Object.freeze({
      idempotent: true,
      idempotencyKey: `${commandSeed}:sync`,
      command: providerContract?.commands?.sync?.command ?? "aios.mailchimp.provider.syncManifest",
      enabled: state === "ready" || state === "preview",
      nextAction: "sync-mailchimp-provider-preview",
    }),
    acknowledge: Object.freeze({
      idempotent: true,
      idempotencyKey: `${commandSeed}:acknowledge`,
      command: providerContract?.commands?.acknowledge?.command ?? "aios.mailchimp.provider.previewRuntimeHandoff",
      enabled: state === "ready",
      nextAction: "acknowledge-mailchimp-provider-handoff",
    }),
    enable: Object.freeze({
      idempotent: true,
      idempotencyKey: `${commandSeed}:enable`,
      command: "aios.mailchimp.provider.enableLifecycle",
      enabled: state === "disabled" || requestedEnable,
      nextAction: "enable-mailchimp-provider-lifecycle",
    }),
    disable: Object.freeze({
      idempotent: true,
      idempotencyKey: `${commandSeed}:disable`,
      command: "aios.mailchimp.provider.disableLifecycle",
      enabled: state !== "disabled",
      nextAction: "disable-mailchimp-provider-lifecycle",
    }),
  });
  const statusSnapshot = Object.freeze({
    protocol: "aios.language.mailchimp-cli-doctor-provider-status.v1",
    snapshotId: stableHash(`${commandSeed}:${nextAction}:${providerContract?.syncMetadata?.checkpoint ?? "no-sync"}`),
    generatedAt,
    state,
    providerState: providerContract?.state ?? "missing",
    negotiationState: providerContract?.capabilityNegotiation?.state ?? "missing",
    syncState: providerContract?.syncMetadata?.state ?? "missing",
    lifecycleState: lifecycleControls?.state ?? "missing",
    boundaryState: boundaryGate.state,
    handoffToken: providerContract?.externalHandoff?.handoffToken ?? null,
    nextAction,
  });

  return Object.freeze({
    protocol: "aios.language.mailchimp-cli-doctor-provider-lifecycle.v1",
    state,
    generatedAt,
    providerContractId: providerContract?.contractId ?? null,
    statusSnapshot,
    blockers,
    commands,
    nextAction,
    recoveryPath: Object.freeze({
      state: state === "blocked" ? "repair-provider" : state === "disabled" ? "enable-provider" : "resume-provider",
      resumeToken: contracts.manifest.recoveryHandoff.resumeToken,
      checkpointId: persistedState.checkpoint.checkpointId,
      idempotencyKey: commands.sync.idempotencyKey,
      expectedProviderState: providerContract?.state ?? "missing",
    }),
    validation: Object.freeze({
      ready: blockers.length === 0 && state !== "disabled",
      canSync: commands.sync.enabled,
      canAcknowledge: commands.acknowledge.enabled,
    }),
  });
}

export function buildAiosCliDoctorReport(source = "", options = {}) {
  const check = buildAiosCliCheckContract(source, options);
  const manifest = buildAiosMailchimpManifest(source, options);
  const scaffold = buildAiosMailchimpPackageScaffold(manifest, options);
  const languageServer = buildAiosMailchimpLanguageServerModel(source, {
    ...options,
    manifestContract: manifest,
    scaffoldContract: scaffold,
  });
  const checkReady = assertAiosCliCheckContractReady(check);
  const manifestReady = assertAiosMailchimpManifestReady(manifest);
  const scaffoldReady = assertAiosMailchimpPackageScaffoldReady(scaffold);
  const languageServerReady = assertAiosMailchimpLanguageServerModelReady(languageServer);
  const readinessChecks = Object.freeze([
    summarizeReadiness("cli-check", checkReady, "$.check"),
    summarizeReadiness("manifest", manifestReady, "$.manifest"),
    summarizeReadiness("package-scaffold", scaffoldReady, "$.scaffold"),
    summarizeReadiness("language-server-model", languageServerReady, "$.languageServer"),
  ]);
  const contracts = { check, manifest, scaffold, languageServer };
  const status = createDoctorStatus(readinessChecks, contracts);
  const remediation = createDoctorRemediation(status, contracts);
  const boundaryGate = createDoctorBoundaryGate(status, remediation, contracts, options);
  const persistedState = createPersistedState(status, remediation, contracts, options);
  const providerLifecycle = createDoctorProviderLifecycle(
    status,
    remediation,
    boundaryGate,
    persistedState,
    contracts,
    options,
  );
  const analyticsExport = createDoctorAnalyticsExport(
    status,
    remediation,
    boundaryGate,
    persistedState,
    contracts,
    {
      ...options,
      readinessPassed: readinessChecks.filter((check) => check.passed).length,
      diagnosticCount: checkReady.diagnostics.length
        + manifestReady.diagnostics.length
        + scaffoldReady.diagnostics.length
        + languageServerReady.diagnostics.length,
    },
  );
  const diagnostics = Object.freeze([
    ...checkReady.diagnostics,
    ...manifestReady.diagnostics,
    ...scaffoldReady.diagnostics,
    ...languageServerReady.diagnostics,
    ...(status.state === "blocked"
      ? [diagnostic("error", "AIOS_DOCTOR_BLOCKED", "Mailchimp CLI doctor found blocking contract readiness issues.", "$.readinessChecks", status.nextAction)]
      : []),
    ...(boundaryGate.state === "blocked"
      ? [diagnostic("error", "AIOS_DOCTOR_BOUNDARY_GATE_BLOCKED", "Mailchimp CLI doctor boundary gate blocked unsafe tenant, workspace, or permission handoff.", "$.boundaryGate", boundaryGate.nextAction)]
      : []),
    ...(analyticsExport.readyForExport
      ? []
      : [diagnostic("warning", "AIOS_DOCTOR_ANALYTICS_EXPORT_NOT_READY", "CLI doctor analytics export requires clear boundary and lifecycle controls.", "$.analyticsExport", analyticsExport.report.nextAction)]),
    ...(providerLifecycle.validation.ready
      ? []
      : [diagnostic("warning", "AIOS_DOCTOR_PROVIDER_LIFECYCLE_REVIEW", "CLI doctor provider lifecycle requires capability negotiation, sync repair, or enablement before handoff.", "$.providerLifecycle", providerLifecycle.nextAction)]),
  ]);

  return Object.freeze({
    protocol: CLI_DOCTOR_PROTOCOL,
    command: "doctor",
    sourceHash: manifest.manifest.sourceHash,
    packageName: manifest.packageName,
    status,
    readinessChecks,
    diagnostics,
    remediation,
    boundaryGate,
    providerLifecycle,
    analyticsExport,
    contracts: Object.freeze({
      checkStatus: check.status,
      manifestHash: manifest.manifestHash,
      boundaryGate: Object.freeze({
        state: boundaryGate.state,
        workspaceId: boundaryGate.workspaceId,
        tenantId: boundaryGate.tenantId,
        role: boundaryGate.role,
        deniedPermissions: boundaryGate.deniedPermissions,
      }),
      scaffoldFiles: scaffold.files.map((file) => Object.freeze({
        path: file.path,
        kind: file.kind,
        contentHash: file.contentHash,
      })),
      languageServerDocuments: languageServer.workspace.documents,
      lifecycleControls: Object.freeze({
        state: manifest.manifest.lifecycleControls.state,
        nextAction: manifest.manifest.lifecycleControls.nextAction,
        scheduleEnabled: manifest.manifest.lifecycleControls.scheduler.enabled,
      }),
      providerContract: Object.freeze({
        state: manifest.manifest.providerContract.state,
        contractId: manifest.manifest.providerContract.contractId,
        negotiationState: manifest.manifest.providerContract.capabilityNegotiation.state,
        syncState: manifest.manifest.providerContract.syncMetadata.state,
      }),
    }),
    statusHandoff: Object.freeze({
      ...languageServer.statusHandoff,
      doctorState: status.state,
      failureState: status.failureState,
      remediationCount: remediation.actionCount,
      checkpointId: persistedState.checkpoint.checkpointId,
      idempotencyKey: persistedState.checkpoint.idempotencyKey,
      boundaryGateState: boundaryGate.state,
      boundaryAuditHash: boundaryGate.audit.queueHash,
      analyticsExportId: analyticsExport.exportId,
      analyticsTrend: analyticsExport.history.trend,
      lifecycleState: manifest.manifest.lifecycleControls.state,
      providerLifecycleState: providerLifecycle.state,
      providerLifecycleNextAction: providerLifecycle.nextAction,
      providerStatusSnapshotId: providerLifecycle.statusSnapshot.snapshotId,
      nextAction: boundaryGate.nextAction,
    }),
    recoveryHandoff: Object.freeze({
      ...languageServer.recoveryHandoff,
      doctorState: status.state,
      remediationActions: remediation.actions.map((action) => action.id),
      boundaryGate: Object.freeze({
        state: boundaryGate.state,
        safeBoundary: boundaryGate.safeBoundary,
        deniedPermissions: boundaryGate.deniedPermissions,
        audit: boundaryGate.audit,
      }),
      persistedState: Object.freeze({
        checkpointId: persistedState.checkpoint.checkpointId,
        restartSafe: persistedState.restartPlan.restartSafe,
        recoveryPath: persistedState.recoveryPath.state,
        nextAction: persistedState.recoveryPath.nextAction,
      }),
      analyticsExport: Object.freeze({
        exportId: analyticsExport.exportId,
        readyForExport: analyticsExport.readyForExport,
        counters: analyticsExport.counters,
        latest: analyticsExport.history.latest,
        nextAction: analyticsExport.report.nextAction,
      }),
      providerLifecycle: Object.freeze({
        state: providerLifecycle.state,
        statusSnapshot: providerLifecycle.statusSnapshot,
        recoveryPath: providerLifecycle.recoveryPath,
        commands: providerLifecycle.commands,
        blockers: providerLifecycle.blockers,
        nextAction: providerLifecycle.nextAction,
      }),
      nextAction: boundaryGate.state === "blocked" ? boundaryGate.nextAction : remediation.nextAction,
    }),
    persistedState,
  });
}

export function assertAiosCliDoctorReady(contract) {
  const diagnostics = [];
  if (contract?.protocol !== CLI_DOCTOR_PROTOCOL) {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_PROTOCOL_INVALID", "CLI doctor protocol is missing or unsupported."));
  }
  if ((contract?.readinessChecks?.length ?? 0) < 4) {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_CHECKS_REQUIRED", "CLI doctor must evaluate check, manifest, scaffold, and language-server readiness.", "$.readinessChecks"));
  }
  if (!contract?.statusHandoff?.nextAction) {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_NEXT_ACTION_REQUIRED", "CLI doctor must expose a deterministic next action.", "$.statusHandoff.nextAction"));
  }
  if (!contract?.recoveryHandoff?.remediationActions) {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_REMEDIATION_REQUIRED", "CLI doctor must expose recovery remediation actions.", "$.recoveryHandoff.remediationActions"));
  }
  if (!contract?.persistedState?.checkpoint?.idempotencyKey) {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_PERSISTED_STATE_REQUIRED", "CLI doctor must expose restart-safe persisted state with an idempotency key.", "$.persistedState.checkpoint.idempotencyKey"));
  }
  if (!contract?.persistedState?.statusSnapshot?.snapshotId) {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_STATUS_SNAPSHOT_REQUIRED", "CLI doctor must expose a deterministic status snapshot for recovery.", "$.persistedState.statusSnapshot.snapshotId"));
  }
  if (!contract?.boundaryGate?.audit?.queueHash) {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_BOUNDARY_GATE_REQUIRED", "CLI doctor must expose tenant, workspace, permission, and audit boundary gate state.", "$.boundaryGate"));
  }
  if (!contract?.analyticsExport?.exportId) {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_ANALYTICS_EXPORT_REQUIRED", "CLI doctor must expose export-ready analytics counters, history, and timeline state.", "$.analyticsExport"));
  }
  if (!contract?.analyticsExport?.history?.latest?.checkpointId) {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_ANALYTICS_HISTORY_REQUIRED", "CLI doctor analytics export must include restart-safe history snapshots.", "$.analyticsExport.history.latest"));
  }
  if (!contract?.providerLifecycle?.statusSnapshot?.snapshotId) {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_PROVIDER_LIFECYCLE_REQUIRED", "CLI doctor must expose Mailchimp provider lifecycle status and restart-safe command state.", "$.providerLifecycle"));
  }
  if (contract?.providerLifecycle?.validation?.ready === false) {
    diagnostics.push(diagnostic("warning", "AIOS_DOCTOR_PROVIDER_LIFECYCLE_REVIEW", "CLI doctor provider lifecycle requires negotiation, sync repair, or enablement.", "$.providerLifecycle.blockers", contract.providerLifecycle.nextAction));
  }
  if (contract?.boundaryGate?.state === "blocked") {
    diagnostics.push(diagnostic("error", "AIOS_DOCTOR_BOUNDARY_GATE_BLOCKED", "CLI doctor boundary gate blocked unsafe tenant, workspace, or permission handoff.", "$.boundaryGate", contract.boundaryGate.nextAction));
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.code || contract?.statusHandoff?.nextAction || "repair-mailchimp-cli-doctor",
  });
}
