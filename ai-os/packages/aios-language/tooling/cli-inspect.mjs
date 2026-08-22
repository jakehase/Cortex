import { buildAiosCliCheckContract } from "./cli-check.mjs";
import { buildAiosCliCompileContract, summarizeAiosCliCompileContract } from "./cli-compile.mjs";
import { buildAiosCliExplainContract } from "./cli-explain.mjs";

const INSPECT_CONTRACT_PROTOCOL = "aios.language.cli-inspect-contract.v1";

function cleanText(value) {
  return String(value ?? "").trim();
}

function optionList(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function stableList(values) {
  const seen = new Set();
  const output = [];
  for (const value of values ?? []) {
    const text = cleanText(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return Object.freeze(output.sort());
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

function diagnostic(severity, code, message, path = "$") {
  return Object.freeze({ severity, code, message, path });
}

function createInspectSettings(options = {}) {
  const settings = options.inspectSettings ?? options.settings ?? {};
  const mode = cleanText(settings.mode) || "status";
  const schedule = cleanText(settings.schedule) || "manual";
  const enabled = settings.enabled !== false;
  const include = stableList(optionList(settings.include).length > 0
    ? optionList(settings.include)
    : ["lifecycle", "provider", "runtime", "external-handoff", "acceptance", "persistence"]);
  const validModes = new Set(["status", "handoff", "audit", "debug"]);
  const validSchedules = new Set(["manual", "on-change", "on-adapter-ready", "interval"]);
  const intervalMs = Number.isFinite(settings.intervalMs) ? Math.max(0, settings.intervalMs) : 0;
  const diagnostics = [];

  if (!validModes.has(mode)) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_MODE_INVALID", "Inspect mode must be status, handoff, audit, or debug.", "$.inspect.settings.mode"));
  }
  if (!validSchedules.has(schedule)) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_SCHEDULE_INVALID", "Inspect schedule must be manual, on-change, on-adapter-ready, or interval.", "$.inspect.settings.schedule"));
  }
  if (schedule === "interval" && intervalMs <= 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_INTERVAL_REQUIRED", "Interval inspect scheduling requires a positive intervalMs value.", "$.inspect.settings.intervalMs"));
  }

  return Object.freeze({
    valid: diagnostics.filter((entry) => entry.severity === "error").length === 0,
    diagnostics: Object.freeze(diagnostics),
    settings: Object.freeze({
      enabled,
      mode,
      schedule,
      include,
      intervalMs,
    }),
  });
}

function createInspectLifecycle(compileContract, checkContract, explainContract, settingsValidation) {
  const health = checkContract.operationalHealth;
  const providerReadiness = compileContract.statusHandoff.providerReadiness;
  const reviewGate = compileContract.reviewGate;
  const settings = settingsValidation.settings;
  const providerBlocked = providerReadiness?.state === "blocked";
  const adapterPending = providerReadiness?.state === "waiting" || providerReadiness?.state === "degraded";
  const enabled = settings.enabled
    && settingsValidation.valid
    && health.status !== "unhealthy"
    && providerBlocked !== true;
  const blockedBy = stableList([
    ...(!settings.enabled ? ["operator-disabled"] : []),
    ...(!settingsValidation.valid ? ["settings-invalid"] : []),
    ...(health.status === "unhealthy" ? [health.failureState] : []),
    ...(providerBlocked ? ["provider-blocked"] : []),
    ...(reviewGate?.controls?.canPreview === false ? ["preview-blocked"] : []),
  ]);
  const canSchedule = enabled && settings.schedule !== "manual";
  const resumeWhen = health.status === "unhealthy"
    ? health.failureState
    : providerReadiness?.required === true && providerReadiness.state !== "ready"
      ? "adapter-accepted"
      : reviewGate?.schedule?.queued
        ? "review-gate-ready"
        : "operator-request";
  const nextAction = enabled
    ? canSchedule
      ? settings.schedule === "on-adapter-ready"
        ? "schedule-inspect-after-adapter-acceptance"
        : settings.schedule === "interval"
          ? "schedule-inspect-interval"
          : "schedule-inspect-on-change"
      : settings.mode === "handoff"
        ? "inspect-runtime-handoff"
        : "show-inspect-status"
    : blockedBy.includes("settings-invalid")
      ? "repair-inspect-settings"
      : providerBlocked
        ? "repair-provider-handoff"
        : health.nextAction;

  return Object.freeze({
    protocol: "aios.language.cli-inspect-lifecycle.v1",
    settings,
    controls: Object.freeze({
      enabled,
      paused: settings.enabled && !enabled,
      canEnable: settingsValidation.valid && health.status !== "unhealthy" && providerBlocked !== true,
      canDisable: true,
      canSchedule,
      canInspectHandoff: enabled && explainContract.clientRuntime?.state !== "blocked",
      canInspectDebug: enabled && settings.mode === "debug",
    }),
    schedule: Object.freeze({
      mode: settings.schedule,
      queued: canSchedule,
      intervalMs: settings.schedule === "interval" ? settings.intervalMs : 0,
      resumeWhen,
      blockedBy,
    }),
    health: Object.freeze({
      status: health.status,
      failureState: health.failureState,
      degradedMode: health.degradedMode,
      adapterPending,
    }),
    nextAction,
  });
}

function createProviderInspection(compileContract, checkContract, explainContract, lifecycle) {
  const providerReadiness = compileContract.statusHandoff.providerReadiness;
  const service = explainContract.providerService;
  const mailchimpProvider = compileContract.mailchimpProvider;
  const provider = cleanText(compileContract.statusHandoff.provider) || "mailchimp";
  const requiredCapabilities = stableList([
    ...(service?.negotiation?.requiredCapabilities ?? []),
    ...(mailchimpProvider?.capabilityNegotiation?.requiredScopes ?? []),
  ]);
  const missingCapabilities = stableList([
    ...(service?.negotiation?.missingCapabilities ?? []),
    ...(mailchimpProvider?.capabilityNegotiation?.missingScopes ?? []),
  ]);
  const accepted = missingCapabilities.length === 0
    && providerReadiness?.failedProviders?.length === 0
    && providerReadiness?.state !== "blocked";
  const syncState = service?.sync?.state
    ?? providerReadiness?.handoff?.syncState
    ?? mailchimpProvider?.sync?.state
    ?? "unknown";
  const blockedReasons = stableList([
    ...missingCapabilities.map((capability) => `missing capability: ${capability}`),
    ...(providerReadiness?.failedProviders ?? []).map((entry) => `provider failed: ${entry}`),
    ...(service?.externalHandoff?.blocked ? ["external handoff blocked"] : []),
    ...(lifecycle.controls.enabled ? [] : ["inspect lifecycle disabled"]),
  ]);

  return Object.freeze({
    protocol: "aios.language.cli-inspect-provider.v1",
    provider,
    service: Object.freeze({
      target: service?.service?.target ?? compileContract.compileResult.target,
      command: "inspect",
      sourceHash: compileContract.source.sourceHash,
    }),
    negotiation: Object.freeze({
      state: accepted ? "accepted" : providerReadiness?.state === "degraded" ? "degraded" : "blocked",
      requiredCapabilities,
      missingCapabilities,
      providerCount: providerReadiness?.providers?.length ?? 0,
      acceptedProviders: Object.freeze(providerReadiness?.acceptedProviders ?? []),
      pendingProviders: Object.freeze(providerReadiness?.pendingProviders ?? []),
      degradedProviders: Object.freeze(providerReadiness?.degradedProviders ?? []),
      failedProviders: Object.freeze(providerReadiness?.failedProviders ?? []),
    }),
    sync: Object.freeze({
      state: syncState,
      required: providerReadiness?.required === true,
      canSync: lifecycle.controls.enabled && blockedReasons.length === 0,
      channel: service?.sync?.channel ?? providerReadiness?.handoff?.channel ?? null,
      correlationId: service?.sync?.correlationId ?? providerReadiness?.handoff?.correlationId ?? null,
      retryAfterMs: service?.sync?.retryAfterMs ?? providerReadiness?.retry?.retryAfterMs ?? null,
      backoff: service?.sync?.backoff ?? providerReadiness?.retry?.backoff ?? "none",
    }),
    checkPreview: Object.freeze({
      status: checkContract.mailchimpPreview?.status ?? "unknown",
      nextAction: checkContract.mailchimpPreview?.nextStep?.action ?? checkContract.nextAction,
    }),
    blockedReasons,
    nextAction: blockedReasons[0]
      ? "resolve-inspect-provider-blockers"
      : lifecycle.nextAction,
  });
}

function createRuntimeInspection(compileContract, checkContract, explainContract, lifecycle, providerInspection) {
  const clientRuntime = explainContract.clientRuntime;
  const persistence = explainContract.mailchimpPersistence;
  const ready = clientRuntime?.readyForRuntime === true
    && checkContract.ok === true
    && lifecycle.controls.enabled === true
    && providerInspection.blockedReasons.length === 0;
  const blockedReasons = stableList([
    ...(checkContract.ok ? [] : ["check-contract-not-passing"]),
    ...(lifecycle.controls.enabled ? [] : ["inspect-lifecycle-disabled"]),
    ...(providerInspection.blockedReasons.length > 0 ? ["provider-inspection-blocked"] : []),
    ...(clientRuntime?.readyForRuntime ? [] : ["client-runtime-not-ready"]),
    ...(persistence?.commands ? [] : ["mailchimp-persistence-missing"]),
  ]);

  return Object.freeze({
    protocol: "aios.language.cli-inspect-runtime.v1",
    state: ready ? "ready" : blockedReasons.length > 0 ? "blocked" : "preview",
    ready,
    request: Object.freeze({
      command: "inspect",
      sourceHash: compileContract.source.sourceHash,
      tenantId: compileContract.boundaryProfile?.tenantId ?? "local",
      workspaceId: compileContract.boundaryProfile?.workspaceId ?? "default",
      provider: providerInspection.provider,
      idempotencyKey: `${compileContract.source.sourceHash}:inspect:${providerInspection.negotiation.state}:${lifecycle.settings.mode}`,
    }),
    handoff: Object.freeze({
      runtimeCommand: ready ? "cli.inspect.runtime.adopt" : "cli.inspect.runtime.review",
      clientState: clientRuntime?.state ?? "unknown",
      statusState: compileContract.statusHandoff.state,
      persistenceState: persistence?.state ?? "unknown",
      resumeToken: persistence?.resumeToken ?? compileContract.recoveryHandoff.resumeToken,
      recoveryToken: compileContract.recoveryHandoff.resumeToken,
      restartSafe: persistence?.recovery?.restartSafe ?? compileContract.recoveryHandoff.recoverable,
    }),
    visibleState: Object.freeze({
      status: ready ? "Runtime inspection ready" : "Runtime inspection requires review",
      providerState: providerInspection.negotiation.state,
      healthState: checkContract.operationalHealth.status,
      lifecycleEnabled: lifecycle.controls.enabled,
      scheduleQueued: lifecycle.schedule.queued,
    }),
    blockedReasons,
    nextAction: ready ? "adopt-inspect-runtime-state" : blockedReasons[0] ? "review-inspect-runtime-state" : lifecycle.nextAction,
  });
}

function createExternalHandoffInspection(compileContract, explainContract, providerInspection, runtimeInspection, lifecycle, options = {}) {
  const supplied = options.externalProviderHandoff
    ?? compileContract.externalProviderHandoff
    ?? compileContract.runtimeHandoff?.externalProviderHandoff
    ?? explainContract.externalProviderHandoff
    ?? explainContract.clientRuntime?.externalProviderHandoff
    ?? null;
  const required = options.externalProviderHandoffRequired === true || Boolean(supplied);
  const queue = Object.freeze((supplied?.queue ?? []).map((entry, index) => Object.freeze({
    handoffId: cleanText(entry.handoffId) || `${compileContract.source.sourceHash}:external-handoff:${index + 1}`,
    processId: cleanText(entry.processId) || `process:${index + 1}`,
    command: cleanText(entry.command) || "provider.sync.review",
    provider: cleanText(entry.provider) || providerInspection.provider,
    serviceName: cleanText(entry.serviceName) || "mailchimp-provider-sync",
    capability: cleanText(entry.capability) || "mailchimp:unknown",
    state: cleanText(entry.state) || "unknown",
    idempotencyKey: cleanText(entry.idempotencyKey) || `${compileContract.source.sourceHash}:external:${index + 1}`,
    syncCursor: cleanText(entry.syncCursor) || providerInspection.sync.correlationId || compileContract.source.sourceHash,
    visibleLabel: cleanText(entry.visibleLabel) || cleanText(entry.processId) || `handoff ${index + 1}`,
  })));
  const readyEntries = queue.filter((entry) => entry.state === "ready");
  const blockedEntries = queue.filter((entry) => entry.state !== "ready");
  const suppliedState = cleanText(supplied?.state);
  const expectedCapabilities = stableList([
    ...providerInspection.negotiation.requiredCapabilities,
    ...queue.map((entry) => entry.capability),
  ]);
  const missingCapabilities = stableList([
    ...providerInspection.negotiation.missingCapabilities,
    ...queue
      .filter((entry) => entry.state === "waiting_for_capability")
      .map((entry) => entry.capability),
  ]);
  const blockedReasons = stableList([
    ...(required && queue.length === 0 ? ["external handoff queue is not attached"] : []),
    ...missingCapabilities.map((capability) => `external handoff missing capability: ${capability}`),
    ...blockedEntries.map((entry) => `external handoff ${entry.processId} is ${entry.state}`),
    ...(providerInspection.blockedReasons.length > 0 ? ["provider inspection blocks external handoff"] : []),
    ...(runtimeInspection.ready ? [] : ["runtime inspection is not ready for external handoff"]),
    ...(lifecycle.controls.enabled ? [] : ["inspect lifecycle disabled for external handoff"]),
  ]);
  const ready = blockedReasons.length === 0
    && (!required || queue.length > 0)
    && readyEntries.length === queue.length
    && (suppliedState === "" || suppliedState === "ready");

  return Object.freeze({
    protocol: "aios.language.cli-inspect-external-handoff.v1",
    state: ready ? (queue.length > 0 ? "ready" : "not_attached") : queue.length > 0 ? "review" : "missing",
    ready,
    required,
    provider: providerInspection.provider,
    queue,
    summary: Object.freeze({
      readyCount: readyEntries.length,
      blockedCount: blockedEntries.length,
      expectedCapabilities,
      missingCapabilities,
      syncState: providerInspection.sync.state,
      statusChannel: supplied?.statusChannel ?? providerInspection.sync.channel ?? "status:timeline.write",
      handoffToken: ready ? supplied?.handoffToken ?? null : null,
    }),
    preview: Object.freeze({
      title: "Mailchimp external handoff",
      status: ready ? "External handoff ready" : "External handoff requires review",
      rows: Object.freeze(queue.map((entry) => Object.freeze({
        name: entry.processId,
        value: `${entry.state}:${entry.capability}`,
      }))),
      nextAction: ready ? "resume-mailchimp-provider-sync" : "review-mailchimp-provider-sync",
    }),
    blockedReasons,
    nextAction: ready ? "resume-mailchimp-provider-sync" : "review-mailchimp-provider-sync",
  });
}

function createAcceptanceInspection(compileContract, runtimeInspection, externalHandoffInspection, options = {}) {
  const supplied = options.acceptancePacket
    ?? options.previewAcceptance
    ?? options.clientRuntimeHandoff
    ?? compileContract.runtimeHandoff?.previewAcceptance
    ?? compileContract.runtimeHandoff?.clientRuntimeHandoff
    ?? compileContract.previewAcceptance
    ?? compileContract.clientRuntimeHandoff
    ?? null;
  const preview = supplied?.preview ?? supplied?.visibleState ?? {};
  const acceptance = supplied?.acceptance ?? supplied?.acceptanceGate ?? {};
  const validation = supplied?.validation ?? {};
  const nextSteps = Object.freeze((supplied?.nextSteps ?? []).map((step, index) => Object.freeze({
    action: cleanText(step.action) || `acceptance-step-${index + 1}`,
    label: cleanText(step.label) || cleanText(step.action) || `Acceptance step ${index + 1}`,
    enabled: step.enabled !== false,
  })));
  const required = Boolean(supplied) || options.acceptanceRequired === true;
  const accepted = acceptance.accepted === true;
  const readyForAcceptance = validation.readyForAcceptance === true
    || acceptance.readyForAcceptance === true
    || validation.ready === true;
  const blockedReasons = stableList([
    ...(required && !supplied ? ["acceptance packet is not attached"] : []),
    ...(runtimeInspection.ready ? [] : ["runtime inspection is not ready for acceptance"]),
    ...(externalHandoffInspection.ready ? [] : ["external handoff is not ready for acceptance"]),
    ...(validation.blockers ?? []),
    ...(required && readyForAcceptance && !accepted && options.acceptanceRequired === true
      ? ["operator acceptance is required"]
      : []),
  ]);
  const ready = blockedReasons.length === 0 && (!required || readyForAcceptance);
  const claimRows = preview.claimRows ?? [];
  const processRows = preview.processRows ?? [];
  const joinRows = preview.joinRows ?? [];
  const rowCount = claimRows.length + processRows.length + joinRows.length;

  return Object.freeze({
    protocol: "aios.language.cli-inspect-acceptance.v1",
    state: !required && !supplied
      ? "not_attached"
      : ready
        ? accepted
          ? "accepted"
          : "ready_for_acceptance"
        : "review",
    ready,
    required,
    accepted,
    previewId: preview.previewId ?? supplied?.request?.requestId ?? null,
    acceptanceId: acceptance.acceptanceId ?? supplied?.request?.requestId ?? null,
    command: acceptance.command ?? supplied?.request?.command ?? runtimeInspection.handoff.runtimeCommand,
    idempotencyKey: acceptance.idempotencyKey ?? supplied?.request?.idempotencyKey ?? runtimeInspection.request.idempotencyKey,
    restartToken: acceptance.restartToken ?? runtimeInspection.handoff.recoveryToken,
    summary: Object.freeze({
      title: preview.title ?? "Runtime acceptance",
      phase: preview.phase ?? (ready ? "ready_for_acceptance" : "needs_review"),
      rowCount,
      nextActionCount: nextSteps.length,
      primaryAction: preview.primaryAction ?? acceptance.resumeCommand ?? runtimeInspection.nextAction,
      validationSummary: Object.freeze(preview.validationSummary ?? {}),
    }),
    nextSteps,
    blockedReasons,
    nextAction: ready
      ? accepted
        ? "resume-accepted-runtime"
        : "show-runtime-acceptance"
      : "review-runtime-acceptance",
  });
}

function createInspectionPanels(compileContract, checkContract, explainContract, lifecycle, providerInspection, runtimeInspection, externalHandoffInspection, acceptanceInspection) {
  const summary = summarizeAiosCliCompileContract(compileContract);
  const panels = [
    {
      id: "lifecycle",
      title: "Lifecycle controls",
      status: lifecycle.controls.enabled ? "enabled" : "paused",
      rows: [
        ["mode", lifecycle.settings.mode],
        ["schedule", lifecycle.schedule.mode],
        ["nextAction", lifecycle.nextAction],
      ],
    },
    {
      id: "provider",
      title: "Mailchimp provider",
      status: providerInspection.negotiation.state,
      rows: [
        ["sync", providerInspection.sync.state],
        ["requiredCapabilities", providerInspection.negotiation.requiredCapabilities.length],
        ["missingCapabilities", providerInspection.negotiation.missingCapabilities.length],
      ],
    },
    {
      id: "runtime",
      title: "Runtime handoff",
      status: runtimeInspection.state,
      rows: [
        ["status", runtimeInspection.handoff.statusState],
        ["client", runtimeInspection.handoff.clientState],
        ["persistence", runtimeInspection.handoff.persistenceState],
      ],
    },
    {
      id: "external-handoff",
      title: "External handoff",
      status: externalHandoffInspection.state,
      rows: [
        ["queue", externalHandoffInspection.queue.length],
        ["ready", externalHandoffInspection.summary.readyCount],
        ["blocked", externalHandoffInspection.summary.blockedCount],
      ],
    },
    {
      id: "acceptance",
      title: "Runtime acceptance",
      status: acceptanceInspection.state,
      rows: [
        ["accepted", acceptanceInspection.accepted],
        ["previewRows", acceptanceInspection.summary.rowCount],
        ["nextAction", acceptanceInspection.nextAction],
      ],
    },
    {
      id: "audit",
      title: "Audit boundary",
      status: compileContract.boundaryProfile?.state ?? "unknown",
      rows: [
        ["tenant", compileContract.boundaryProfile?.tenantId ?? "local"],
        ["workspace", compileContract.boundaryProfile?.workspaceId ?? "default"],
        ["report", checkContract.analytics?.exportSummary?.reportName ?? summary.reportName ?? "none"],
      ],
    },
  ];

  return Object.freeze(panels
    .filter((panel) => lifecycle.settings.include.includes(panel.id) || lifecycle.settings.mode === "debug")
    .map((panel) => Object.freeze({
      ...panel,
      rows: Object.freeze(panel.rows.map(([name, value]) => Object.freeze({ name, value: String(value) }))),
    })));
}

function createInspectPersistedState(compileContract, checkContract, lifecycle, providerInspection, runtimeInspection, externalHandoffInspection, acceptanceInspection, panels, options = {}) {
  const tenantId = cleanText(compileContract.boundaryProfile?.tenantId) || "local";
  const workspaceId = cleanText(compileContract.boundaryProfile?.workspaceId) || "default";
  const commandState = runtimeInspection.ready
    && externalHandoffInspection.ready
    && (!acceptanceInspection.required || acceptanceInspection.ready)
    ? "ready"
    : lifecycle.controls.enabled
      ? "review"
      : "paused";
  const pendingReasons = stableList([
    ...runtimeInspection.blockedReasons,
    ...externalHandoffInspection.blockedReasons,
    ...acceptanceInspection.blockedReasons,
    ...lifecycle.schedule.blockedBy,
  ]);
  const idempotencySeed = [
    "inspect",
    compileContract.source.sourceHash,
    tenantId,
    workspaceId,
    lifecycle.settings.mode,
    providerInspection.negotiation.state,
    externalHandoffInspection.state,
    acceptanceInspection.state,
  ].join(":");
  const idempotencyKey = cleanText(options.idempotencyKey)
    || cleanText(acceptanceInspection.idempotencyKey)
    || stableHash(idempotencySeed);
  const checkpoint = Object.freeze({
    protocol: "aios.language.cli-inspect-checkpoint.v1",
    checkpointId: stableHash(`${idempotencyKey}:${commandState}:${panels.length}`),
    command: "inspect",
    idempotencyKey,
    sourceHash: compileContract.source.sourceHash,
    tenantId,
    workspaceId,
    mode: lifecycle.settings.mode,
    schedule: lifecycle.schedule.mode,
    providerState: providerInspection.negotiation.state,
    runtimeState: runtimeInspection.state,
    externalHandoffState: externalHandoffInspection.state,
    acceptanceState: acceptanceInspection.state,
    recoveryToken: runtimeInspection.handoff.recoveryToken,
  });
  const statusSnapshot = Object.freeze({
    protocol: "aios.language.cli-inspect-status-snapshot.v1",
    snapshotId: stableHash([
      checkpoint.checkpointId,
      commandState,
      lifecycle.nextAction,
      runtimeInspection.nextAction,
      externalHandoffInspection.nextAction,
      acceptanceInspection.nextAction,
    ].join(":")),
    state: commandState,
    ready: commandState === "ready",
    inspectable: panels.length > 0,
    restartSafe: runtimeInspection.handoff.restartSafe === true
      && externalHandoffInspection.ready === true
      && (!acceptanceInspection.required || Boolean(acceptanceInspection.restartToken)),
    providerState: providerInspection.negotiation.state,
    providerSyncState: providerInspection.sync.state,
    runtimeState: runtimeInspection.state,
    externalHandoffState: externalHandoffInspection.state,
    acceptanceState: acceptanceInspection.state,
    acceptanceAccepted: acceptanceInspection.accepted,
    pendingReasonCount: pendingReasons.length,
    nextAction: commandState === "ready"
      ? acceptanceInspection.required ? acceptanceInspection.nextAction : runtimeInspection.nextAction
      : pendingReasons.length > 0
        ? "review-inspect-persisted-state"
        : lifecycle.nextAction,
  });
  const commandJournal = Object.freeze([
    Object.freeze({
      id: "inspect-command-shaped",
      state: commandState,
      command: "aios inspect",
      idempotencyKey,
      nextAction: statusSnapshot.nextAction,
    }),
    Object.freeze({
      id: "inspect-runtime-handoff-shaped",
      state: runtimeInspection.state,
      restartSafe: runtimeInspection.handoff.restartSafe,
      recoveryToken: runtimeInspection.handoff.recoveryToken,
      nextAction: runtimeInspection.nextAction,
    }),
    Object.freeze({
      id: "inspect-external-handoff-shaped",
      state: externalHandoffInspection.state,
      readyCount: externalHandoffInspection.summary.readyCount,
      blockedCount: externalHandoffInspection.summary.blockedCount,
      nextAction: externalHandoffInspection.nextAction,
    }),
    Object.freeze({
      id: "inspect-acceptance-shaped",
      state: acceptanceInspection.state,
      required: acceptanceInspection.required,
      accepted: acceptanceInspection.accepted,
      restartToken: acceptanceInspection.restartToken,
      nextAction: acceptanceInspection.nextAction,
    }),
  ]);

  return Object.freeze({
    protocol: "aios.language.cli-inspect-persisted-state.v1",
    checkpoint,
    statusSnapshot,
    restartPlan: Object.freeze({
      protocol: "aios.language.cli-inspect-restart-plan.v1",
      restartSafe: statusSnapshot.restartSafe,
      idempotentCommand: "aios inspect --resume",
      idempotencyKey,
      resumeToken: runtimeInspection.handoff.resumeToken,
      recoveryToken: runtimeInspection.handoff.recoveryToken,
      expectedState: commandState,
      replayGuards: Object.freeze([
        Object.freeze({
          id: "source-hash-match",
          path: "$.source.sourceHash",
          expected: compileContract.source.sourceHash,
        }),
        Object.freeze({
          id: "tenant-workspace-match",
          path: "$.statusHandoff.workspaceId",
          expected: workspaceId,
        }),
        Object.freeze({
          id: "provider-state-compatible",
          path: "$.providerInspection.negotiation.state",
          expected: providerInspection.negotiation.state,
        }),
      ]),
      nextAction: statusSnapshot.restartSafe
        ? statusSnapshot.nextAction
        : pendingReasons.length > 0
          ? "repair-inspect-restart-state"
          : lifecycle.nextAction,
    }),
    recoveryPath: Object.freeze({
      state: statusSnapshot.restartSafe
        ? "resume-ready"
        : commandState === "paused"
          ? "resume-paused"
          : "repair-before-resume",
      pendingReasons,
      providerRetry: Object.freeze({
        retryable: providerInspection.sync.retryAfterMs !== null && providerInspection.negotiation.state !== "blocked",
        retryAfterMs: providerInspection.sync.retryAfterMs,
        backoff: providerInspection.sync.backoff,
      }),
      journalHash: stableHash(commandJournal.map((entry) => `${entry.id}:${entry.state}:${entry.nextAction}`).join("|")),
      nextAction: statusSnapshot.nextAction,
    }),
    commandJournal,
  });
}

export function buildAiosCliInspectContract(source = "", options = {}) {
  const compileContract = options.compileContract ?? buildAiosCliCompileContract(source, options);
  const checkContract = options.checkContract ?? buildAiosCliCheckContract(source, {
    ...options,
    compileContract,
  });
  const explainContract = options.explainContract ?? buildAiosCliExplainContract(source, {
    ...options,
    compileContract,
    checkContract,
  });
  const settingsValidation = createInspectSettings(options);
  const lifecycle = createInspectLifecycle(compileContract, checkContract, explainContract, settingsValidation);
  const providerInspection = createProviderInspection(compileContract, checkContract, explainContract, lifecycle);
  const runtimeInspection = createRuntimeInspection(compileContract, checkContract, explainContract, lifecycle, providerInspection);
  const externalHandoffInspection = createExternalHandoffInspection(
    compileContract,
    explainContract,
    providerInspection,
    runtimeInspection,
    lifecycle,
    options,
  );
  const acceptanceInspection = createAcceptanceInspection(
    compileContract,
    runtimeInspection,
    externalHandoffInspection,
    options,
  );
  const panels = createInspectionPanels(
    compileContract,
    checkContract,
    explainContract,
    lifecycle,
    providerInspection,
    runtimeInspection,
    externalHandoffInspection,
    acceptanceInspection,
  );
  const persistedState = createInspectPersistedState(
    compileContract,
    checkContract,
    lifecycle,
    providerInspection,
    runtimeInspection,
    externalHandoffInspection,
    acceptanceInspection,
    panels,
    options,
  );
  const diagnostics = Object.freeze([
    ...checkContract.diagnostics,
    ...explainContract.diagnostics,
    ...settingsValidation.diagnostics,
    ...(panels.length === 0
      ? [diagnostic("error", "AIOS_CLI_INSPECT_PANELS_REQUIRED", "Inspect contract must expose at least one deterministic panel.", "$.panels")]
      : []),
    ...(providerInspection.blockedReasons.length > 0
      ? [diagnostic("warning", "AIOS_CLI_INSPECT_PROVIDER_BLOCKED", "Inspect provider negotiation requires review.", "$.providerInspection")]
      : []),
  ]);
  const blockingDiagnostics = diagnostics.filter((entry) => entry.severity === "error");
  const ready = blockingDiagnostics.length === 0
    && runtimeInspection.ready
    && externalHandoffInspection.ready
    && (!acceptanceInspection.required || acceptanceInspection.ready);

  return Object.freeze({
    protocol: INSPECT_CONTRACT_PROTOCOL,
    command: "inspect",
    source: compileContract.source,
    summary: summarizeAiosCliCompileContract(compileContract),
    lifecycle,
    providerInspection,
    runtimeInspection,
    externalHandoffInspection,
    acceptanceInspection,
    persistedState,
    panels,
    statusHandoff: Object.freeze({
      ...compileContract.statusHandoff,
      inspectable: panels.length > 0,
      inspectCheckpointId: persistedState.checkpoint.checkpointId,
      inspectStatusSnapshotId: persistedState.statusSnapshot.snapshotId,
      inspectIdempotencyKey: persistedState.checkpoint.idempotencyKey,
      inspectRestartSafe: persistedState.restartPlan.restartSafe,
      lifecycleEnabled: lifecycle.controls.enabled,
      scheduleQueued: lifecycle.schedule.queued,
      providerNegotiationState: providerInspection.negotiation.state,
      providerSyncState: providerInspection.sync.state,
      runtimeInspectState: runtimeInspection.state,
      runtimeReady: runtimeInspection.ready,
      externalHandoffState: externalHandoffInspection.state,
      externalHandoffReadyCount: externalHandoffInspection.summary.readyCount,
      acceptanceState: acceptanceInspection.state,
      acceptanceAccepted: acceptanceInspection.accepted,
      persistedInspectState: persistedState.statusSnapshot.state,
      nextInspectAction: runtimeInspection.nextAction,
    }),
    recoveryHandoff: Object.freeze({
      ...compileContract.recoveryHandoff,
      inspectRuntime: runtimeInspection.handoff,
      inspectProvider: providerInspection.sync,
      externalProviderHandoff: externalHandoffInspection,
      acceptance: acceptanceInspection,
      persistedInspectState: Object.freeze({
        checkpointId: persistedState.checkpoint.checkpointId,
        snapshotId: persistedState.statusSnapshot.snapshotId,
        restartSafe: persistedState.restartPlan.restartSafe,
        recoveryPath: persistedState.recoveryPath.state,
        journalHash: persistedState.recoveryPath.journalHash,
        nextAction: persistedState.recoveryPath.nextAction,
      }),
      lifecycleNextAction: lifecycle.nextAction,
      nextAction: acceptanceInspection.required && !acceptanceInspection.ready
        ? acceptanceInspection.nextAction
        : externalHandoffInspection.ready ? runtimeInspection.nextAction : externalHandoffInspection.nextAction,
    }),
    diagnostics,
    readiness: Object.freeze({
      ready,
      blockerCount: blockingDiagnostics.length + runtimeInspection.blockedReasons.length,
      blockedReasons: Object.freeze(stableList([
        ...blockingDiagnostics.map((entry) => entry.code),
        ...runtimeInspection.blockedReasons,
        ...externalHandoffInspection.blockedReasons,
        ...acceptanceInspection.blockedReasons,
      ])),
    }),
    nextAction: ready
      ? acceptanceInspection.required ? acceptanceInspection.nextAction : "show-cli-inspection"
      : acceptanceInspection.required && acceptanceInspection.blockedReasons.length > 0
        ? acceptanceInspection.nextAction
      : externalHandoffInspection.blockedReasons.length > 0
        ? externalHandoffInspection.nextAction
        : runtimeInspection.nextAction,
  });
}

export function assertAiosCliInspectContractReady(contract) {
  const diagnostics = [];
  if (contract?.protocol !== INSPECT_CONTRACT_PROTOCOL) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_PROTOCOL_INVALID", "Inspect contract protocol is missing or unsupported."));
  }
  if (!contract?.lifecycle?.controls) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_LIFECYCLE_REQUIRED", "Inspect contract requires lifecycle controls.", "$.lifecycle.controls"));
  }
  if (!contract?.providerInspection?.negotiation) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_PROVIDER_REQUIRED", "Inspect contract requires provider negotiation details.", "$.providerInspection.negotiation"));
  }
  if (!contract?.runtimeInspection?.handoff) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_RUNTIME_REQUIRED", "Inspect contract requires runtime handoff details.", "$.runtimeInspection.handoff"));
  }
  if (!contract?.externalHandoffInspection?.summary) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_EXTERNAL_HANDOFF_REQUIRED", "Inspect contract requires external handoff summary details.", "$.externalHandoffInspection.summary"));
  }
  if (contract?.acceptanceInspection?.required === true && !contract.acceptanceInspection.command) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_ACCEPTANCE_COMMAND_REQUIRED", "Required acceptance inspection needs a deterministic command.", "$.acceptanceInspection.command"));
  }
  if (!contract?.persistedState?.checkpoint?.idempotencyKey) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_PERSISTED_STATE_REQUIRED", "Inspect contract requires a deterministic persisted command checkpoint.", "$.persistedState.checkpoint.idempotencyKey"));
  }
  if (!contract?.persistedState?.statusSnapshot?.snapshotId) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_STATUS_SNAPSHOT_REQUIRED", "Inspect contract requires a restart-safe status snapshot.", "$.persistedState.statusSnapshot.snapshotId"));
  }
  if (!contract?.persistedState?.restartPlan?.resumeToken) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_RESUME_TOKEN_REQUIRED", "Inspect contract requires a resume token for restart recovery.", "$.persistedState.restartPlan.resumeToken"));
  }
  if (!Array.isArray(contract?.panels) || contract.panels.length === 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_PANELS_REQUIRED", "Inspect contract requires visible panels.", "$.panels"));
  }
  if (contract?.lifecycle?.settings?.schedule === "interval" && contract.lifecycle.settings.intervalMs <= 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_INSPECT_INTERVAL_REQUIRED", "Interval inspect scheduling requires a positive interval.", "$.lifecycle.settings.intervalMs"));
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.code || contract?.nextAction || "show-cli-inspection",
  });
}

export { INSPECT_CONTRACT_PROTOCOL };
