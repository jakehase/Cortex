import { TOKEN_TYPES, createDiagnostic, tokenLabel } from "./tokens.mjs";
import {
  advanceTokenStream,
  createTokenCheckpoint,
  createTokenStreamAnalyticsReport,
  createTokenStreamAdapterStatusPacket,
  createTokenStreamCommand,
  createTokenStreamCommandAuditReport,
  createTokenStreamHealthReport,
  createTokenStreamMailchimpAdoptionPacket,
  createTokenStreamProviderAcceptanceSummary,
  createTokenStreamProviderServiceContract,
  currentToken,
  describeTokenWindow,
  expectToken,
  matchToken,
} from "./token-stream.mjs";

function normalizeFailureSeverity(diagnostics) {
  return diagnostics.some((diagnostic) => diagnostic.severity !== "warning") ? "error" : "warning";
}

function classifyParserFailure(diagnostics, stream, label = "parser") {
  const current = currentToken(stream);
  const codes = Array.from(diagnostics ?? []).map((diagnostic) => diagnostic.code ?? "UNKNOWN");
  const expected = codes.some((code) => code.includes("EXPECTED") || code === "COMBINATOR_NO_CHOICE");
  const stalled = codes.includes("COMBINATOR_STALLED");
  const recovered = codes.includes("COMBINATOR_RECOVERED");
  const eof = current.type === TOKEN_TYPES.EOF;
  const severity = normalizeFailureSeverity(diagnostics);
  const retryable = eof || recovered || severity === "warning";
  const degraded = recovered || severity === "warning";
  const retryAfterMs = stalled ? 250 : eof ? 0 : degraded ? 100 : 500;

  return Object.freeze({
    schema: "aios.parser.failure.v1",
    label,
    status: stalled
      ? "stalled"
      : eof
        ? "awaiting-source"
        : degraded
          ? "degraded"
          : "blocked",
    retryable,
    degraded,
    retryAfterMs,
    severity,
    codes: Object.freeze(codes),
    tokenWindow: describeTokenWindow(stream, 2),
    recoveryCommand: createTokenStreamCommand(stream, eof ? "noop" : "advance", {
      distance: expected && !eof ? 1 : 0,
      reason: `parser-${label}-recovery`,
    }),
    nextAction: stalled
      ? "inspect-parser-progress"
      : eof
        ? "resume-after-source-update"
        : degraded
          ? "continue-with-degraded-parse"
          : "surface-parser-error",
  });
}

function diagnosticCounters(diagnostics) {
  const counters = {
    error: 0,
    warning: 0,
    info: 0,
    byCode: {},
  };

  for (const diagnostic of diagnostics ?? []) {
    const severity = diagnostic?.severity ?? "error";
    counters[severity] = (counters[severity] ?? 0) + 1;
    const code = diagnostic?.code ?? "UNKNOWN";
    counters.byCode[code] = (counters.byCode[code] ?? 0) + 1;
  }

  return Object.freeze({
    error: counters.error,
    warning: counters.warning,
    info: counters.info,
    byCode: Object.freeze(Object.fromEntries(Object.entries(counters.byCode).sort(([left], [right]) => left.localeCompare(right)))),
  });
}

function parserHistoryEvent(result, label = "parser") {
  const stream = result?.stream;
  const diagnostics = Object.freeze(Array.from(result?.diagnostics ?? []));
  const failure = result?.ok ? null : result?.meta?.failure ?? classifyParserFailure(diagnostics, stream, label);

  return Object.freeze({
    schema: "aios.parser.history-event.v1",
    label,
    ok: Boolean(result?.ok),
    combinator: result?.meta?.combinator ?? label,
    cursor: Number.isInteger(stream?.cursor) ? stream.cursor : 0,
    diagnosticCount: diagnostics.length,
    counters: diagnosticCounters(diagnostics),
    status: result?.ok ? "ok" : failure.status,
    retryable: result?.ok ? false : failure.retryable,
    degraded: result?.ok ? false : failure.degraded,
    tokenWindow: describeTokenWindow(stream, 2),
    recoveryCommand: result?.ok ? null : failure.recoveryCommand,
    nextAction: result?.ok ? "continue" : failure.nextAction,
  });
}

function stableLifecycleId(label, settings) {
  const parts = [
    "parser-lifecycle",
    label,
    settings.enabled ? "enabled" : "disabled",
    settings.mode,
    settings.schedule,
    settings.maxAttempts,
    settings.retryAfterMs,
  ];
  return parts.map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function normalizeParserLifecycleSettings(settings = {}) {
  const enabled = settings.enabled !== false;
  const mode = ["strict", "recover", "degraded"].includes(settings.mode) ? settings.mode : "recover";
  const schedule = ["immediate", "on-source-update", "manual", "disabled"].includes(settings.schedule)
    ? settings.schedule
    : enabled ? "immediate" : "disabled";
  const maxAttempts = Number.isInteger(settings.maxAttempts)
    ? Math.min(Math.max(0, settings.maxAttempts), 10)
    : mode === "strict" ? 0 : 2;
  const retryAfterMs = Number.isInteger(settings.retryAfterMs)
    ? Math.min(Math.max(0, settings.retryAfterMs), 60000)
    : schedule === "immediate" ? 0 : 250;

  return Object.freeze({
    enabled,
    mode,
    schedule: enabled ? schedule : "disabled",
    maxAttempts: enabled ? maxAttempts : 0,
    retryAfterMs: enabled ? retryAfterMs : null,
    auditChannel: settings.auditChannel ?? null,
    label: settings.label ?? "parser",
  });
}

function validateParserLifecycleSettings(settings) {
  const diagnostics = [];

  if (!settings.enabled && settings.schedule !== "disabled") {
    diagnostics.push(createDiagnostic(
      "PARSER_LIFECYCLE_DISABLED_SCHEDULE",
      "Disabled parser lifecycle must use disabled scheduling.",
      { line: 1, column: 1, offset: 0 },
      "warning",
    ));
  }

  if (settings.mode === "strict" && settings.maxAttempts > 0) {
    diagnostics.push(createDiagnostic(
      "PARSER_LIFECYCLE_STRICT_RETRY",
      "Strict parser lifecycle should not retry failed parses.",
      { line: 1, column: 1, offset: 0 },
      "warning",
    ));
  }

  if (settings.schedule === "manual" && settings.retryAfterMs !== null && settings.retryAfterMs > 0) {
    diagnostics.push(createDiagnostic(
      "PARSER_LIFECYCLE_MANUAL_BACKOFF",
      "Manual parser lifecycle ignores retry backoff until an operator resumes it.",
      { line: 1, column: 1, offset: 0 },
      "info",
    ));
  }

  return Object.freeze(diagnostics);
}

function lifecycleNextAction(settings, diagnostics) {
  if (!settings.enabled) {
    return "enable-parser-lifecycle";
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "correct-parser-lifecycle-settings";
  }

  if (settings.schedule === "manual") {
    return "wait-for-parser-resume-command";
  }

  if (settings.schedule === "on-source-update") {
    return "wait-for-source-update";
  }

  return "run-parser";
}

function providerOperation(adapter) {
  const parts = String(adapter ?? "").split(".");
  return parts.length > 1 ? parts.slice(1).join(".") : parts[0] || "run";
}

function providerName(adapter) {
  return String(adapter ?? "").split(".")[0] || "runtime";
}

function providerCapabilityProfile(adapter, options = {}) {
  const provider = providerName(adapter);
  const operation = providerOperation(adapter);
  const requested = Object.freeze(Array.from(options.requestedCapabilities ?? []));

  if (provider !== "mailchimp") {
    return Object.freeze({
      schema: "aios.parser.provider-capability-profile.v1",
      provider,
      operation,
      supportedCapabilities: Object.freeze(["status", "retry", "checkpoint"]),
      requiredPermissions: Object.freeze([]),
      requestedCapabilities: requested,
      mutatesProvider: false,
    });
  }

  const mutating = ["syncAudience", "upsertCampaign", "createCampaign", "scheduleCampaign"].includes(operation);
  const reads = ["fetchAudience", "syncAudience"].includes(operation);

  return Object.freeze({
    schema: "aios.parser.provider-capability-profile.v1",
    provider,
    operation,
    supportedCapabilities: Object.freeze([
      "audience-read",
      "status",
      "audit",
      "retry",
      "checkpoint",
      mutating ? "idempotency" : null,
      mutating ? "provider-write" : null,
    ].filter(Boolean)),
    requiredPermissions: Object.freeze([
      reads ? "mailchimp.read" : null,
      mutating ? "mailchimp.write" : null,
    ].filter(Boolean)),
    requestedCapabilities: requested,
    mutatesProvider: mutating,
  });
}

function normalizeGrantedPermissions(stream, options = {}) {
  return Object.freeze([...new Set(Array.from(
    options.permissions
      ?? stream?.metadata?.permissions
      ?? stream?.metadata?.boundary?.permissions
      ?? [],
  ).map((permission) => String(permission ?? "").trim()).filter(Boolean))].sort());
}

function negotiateProviderCapabilities(profile, grantedPermissions) {
  const granted = new Set(grantedPermissions);
  const supported = new Set(profile.supportedCapabilities);
  const requested = profile.requestedCapabilities.length > 0
    ? profile.requestedCapabilities
    : profile.supportedCapabilities;
  const unsupportedCapabilities = Object.freeze(requested.filter((capability) => !supported.has(capability)));
  const missingPermissions = Object.freeze(profile.requiredPermissions.filter((permission) => !granted.has(permission)));
  const accepted = unsupportedCapabilities.length === 0 && missingPermissions.length === 0;

  return Object.freeze({
    schema: "aios.parser.provider-negotiation.v1",
    accepted,
    supportedCapabilities: profile.supportedCapabilities,
    requestedCapabilities: Object.freeze(requested),
    unsupportedCapabilities,
    grantedPermissions,
    requiredPermissions: profile.requiredPermissions,
    missingPermissions,
    status: accepted
      ? "accepted"
      : missingPermissions.length > 0
        ? "permission-review"
        : "capability-review",
    nextAction: accepted
      ? "handoff-provider"
      : missingPermissions.length > 0
        ? "align-provider-permissions"
        : "choose-supported-provider-capability",
  });
}

function providerSyncMetadata(adapter, stream, health, analytics, options = {}) {
  const provider = providerName(adapter);
  const operation = providerOperation(adapter);
  const syncKey = [
    "provider-sync",
    provider,
    operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    stream?.metadata?.workspace ?? stream?.metadata?.boundary?.workspace ?? "workspace",
    stream?.metadata?.tenant ?? stream?.metadata?.boundary?.tenant ?? "tenant",
  ].map((part) => String(part).trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.parser.provider-sync-metadata.v1",
    syncKey,
    provider,
    operation,
    sourceId: stream?.metadata?.sourceId ?? null,
    cursor: Number.isInteger(stream?.cursor) ? stream.cursor : 0,
    healthStatus: health.status,
    analyticsStatus: analytics.status,
    checkpointCursor: analytics.history.checkpoint.cursor,
    commandCount: analytics.counters.commandCount,
    externalTraceId: options.externalTraceId ?? syncKey,
    statusChannel: options.statusChannel ?? stream?.metadata?.auditChannel ?? null,
  });
}

function createParserProviderClientState(adapter, stream, serviceContract, lifecycle = null, adoptionPacket = null) {
  const boundary = serviceContract.boundary;
  const acceptance = serviceContract.acceptance;
  const disabledByLifecycle = lifecycle?.status === "disabled" || lifecycle?.settings?.schedule === "disabled";
  const waitingOnManualLifecycle = lifecycle?.settings?.schedule === "manual" && !acceptance.accepted;
  const adoptionReady = !adoptionPacket || adoptionPacket.ready || serviceContract.service.provider !== "mailchimp";
  const ready = acceptance.accepted && adoptionReady && !disabledByLifecycle && !waitingOnManualLifecycle;

  return Object.freeze({
    schema: "aios.parser.provider-client-state.v1",
    adapter: serviceContract.service.adapter ?? adapter ?? null,
    provider: serviceContract.service.provider,
    operation: serviceContract.service.operation,
    sourceId: stream?.metadata?.sourceId ?? null,
    boundary: Object.freeze({
      workspace: boundary.workspace,
      tenant: boundary.tenant,
      role: boundary.role,
    }),
    lifecycle: lifecycle
      ? Object.freeze({
          id: lifecycle.id,
          status: lifecycle.status,
          schedule: lifecycle.settings.schedule,
          controls: lifecycle.controls,
          nextAction: lifecycle.nextAction,
        })
      : null,
    preview: Object.freeze({
      syncKey: serviceContract.sync.syncKey,
      tokenWindow: serviceContract.preview.tokenWindow,
      missingPermissions: serviceContract.preview.missingPermissions,
      statusChannel: serviceContract.acceptance.statusChannel,
      audit: serviceContract.acceptance.audit,
    }),
    adoption: adoptionPacket
      ? Object.freeze({
          status: adoptionPacket.status,
          ready: adoptionPacket.ready,
          syncKey: adoptionPacket.sync.syncKey,
          command: adoptionPacket.clientState.command,
          missing: adoptionPacket.validationSummary.missing,
          nextAction: adoptionPacket.nextAction,
        })
      : null,
    controls: Object.freeze({
      ...acceptance.controls,
      canRunNow: ready && (!lifecycle || lifecycle.controls.canRunNow),
      canSchedule: acceptance.controls.canSchedule && (!lifecycle || lifecycle.settings.schedule !== "disabled"),
      canDisable: acceptance.controls.canDisable || Boolean(lifecycle?.controls.canDisable),
      canResume: Boolean(lifecycle?.controls.canResume),
      canAdoptMailchimp: Boolean(adoptionPacket?.ready),
    }),
    ready,
    status: disabledByLifecycle
      ? "lifecycle-disabled"
      : waitingOnManualLifecycle
        ? "manual-acceptance"
        : adoptionPacket && !adoptionReady
          ? adoptionPacket.status
        : acceptance.status,
    nextAction: ready
      ? "run-provider-handoff"
      : disabledByLifecycle
        ? "enable-parser-lifecycle"
        : waitingOnManualLifecycle
          ? "accept-provider-preview"
          : adoptionPacket && !adoptionReady
            ? adoptionPacket.nextAction
          : acceptance.nextAction,
  });
}

function createPersistedProviderHandoffState(adapter, stream, profile, negotiation, serviceContract, health, lifecycle = null, adoptionPacket = null) {
  const mutating = profile.mutatesProvider;
  const hasIdempotency = serviceContract.negotiation.supportedCapabilities.includes("idempotency")
    && (!mutating || serviceContract.negotiation.requestedCapabilities.includes("idempotency"));
  const checkpointReady = Boolean(health.checkpoint?.restartSafe);
  const lifecycleRestartable = !lifecycle || lifecycle.status !== "disabled";
  const statusReady = Boolean(serviceContract.sync.statusChannel);
  const auditReady = !serviceContract.acceptance.audit.required || serviceContract.acceptance.audit.status === "audit-ready";
  const missing = Object.freeze([
    adapter ? null : "adapter",
    checkpointReady ? null : "restart-safe-token-checkpoint",
    negotiation.accepted ? null : "provider-capability-negotiation",
    statusReady ? null : "external-status-channel",
    auditReady ? null : "audit-channel",
    lifecycleRestartable ? null : "enabled-parser-lifecycle",
    mutating && !hasIdempotency ? "idempotency-capability" : null,
    adoptionPacket && !adoptionPacket.ready ? "mailchimp-adoption-packet" : null,
  ].filter(Boolean));
  const stateKey = [
    "parser-provider-state",
    serviceContract.service.provider,
    serviceContract.service.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    serviceContract.boundary.workspace ?? "workspace",
    serviceContract.boundary.tenant ?? "tenant",
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.parser.persisted-provider-handoff-state.v1",
    stateKey,
    adapter: adapter ?? null,
    provider: serviceContract.service.provider,
    operation: serviceContract.service.operation,
    sourceId: stream?.metadata?.sourceId ?? null,
    syncKey: serviceContract.sync.syncKey,
    boundary: Object.freeze({
      workspace: serviceContract.boundary.workspace,
      tenant: serviceContract.boundary.tenant,
      role: serviceContract.boundary.role,
    }),
    checkpoint: Object.freeze({
      cursor: serviceContract.sync.checkpointCursor,
      restartSafe: checkpointReady,
      restoreCommand: health.checkpoint?.restoreCommand ?? null,
    }),
    command: Object.freeze({
      id: `${stateKey}:handoff`,
      idempotent: !mutating || hasIdempotency,
      writesProvider: mutating,
      statusChannel: serviceContract.sync.statusChannel,
      auditChannel: serviceContract.sync.auditChannel,
    }),
    lifecycle: lifecycle
      ? Object.freeze({
          id: lifecycle.id,
          status: lifecycle.status,
          schedule: lifecycle.settings.schedule,
          retryAfterMs: lifecycle.scheduling.retryAfterMs,
          attemptsRemaining: lifecycle.scheduling.attemptsRemaining,
        })
      : null,
    adoption: adoptionPacket
      ? Object.freeze({
          status: adoptionPacket.status,
          ready: adoptionPacket.ready,
          syncKey: adoptionPacket.sync.syncKey,
          command: adoptionPacket.restartPlan.command,
          missing: adoptionPacket.validationSummary.missing,
        })
      : null,
    missing,
    restartSafe: missing.length === 0,
    status: missing.length === 0
      ? "restart-safe"
      : missing.includes("restart-safe-token-checkpoint")
          ? "checkpoint-review"
        : missing.includes("mailchimp-adoption-packet")
          ? adoptionPacket.status
        : missing.includes("idempotency-capability")
          ? "idempotency-review"
          : missing.includes("external-status-channel")
            ? "status-review"
            : "handoff-review",
    nextAction: missing.length === 0
      ? "persist-provider-handoff-state"
      : missing.includes("restart-safe-token-checkpoint")
        ? "reload-token-checkpoint"
        : missing.includes("provider-capability-negotiation")
          ? negotiation.nextAction
          : missing.includes("external-status-channel")
            ? "declare-status-channel"
            : missing.includes("audit-channel")
              ? "declare-audit-channel"
              : missing.includes("enabled-parser-lifecycle")
                ? "enable-parser-lifecycle"
                : missing.includes("mailchimp-adoption-packet")
                  ? adoptionPacket.nextAction
                : "request-idempotency-capability",
  });
}

export function parserOk(value, stream, meta = {}) {
  return Object.freeze({
    ok: true,
    value,
    stream,
    diagnostics: Object.freeze([]),
    meta: Object.freeze(meta),
  });
}

export function createParserLifecycleController(settings = {}, latestResult = null) {
  const normalized = normalizeParserLifecycleSettings(settings);
  const validationDiagnostics = validateParserLifecycleSettings(normalized);
  const latestSummary = latestResult ? summarizeParserResult(latestResult, normalized.label) : null;
  const failed = latestSummary && !latestSummary.ok;
  const attemptsUsed = Number.isInteger(settings.attemptsUsed) ? Math.max(0, settings.attemptsUsed) : 0;
  const attemptsRemaining = Math.max(0, normalized.maxAttempts - attemptsUsed);
  const retryReady = normalized.enabled
    && failed
    && latestSummary.retryable
    && attemptsRemaining > 0
    && normalized.schedule !== "manual"
    && normalized.schedule !== "disabled";
  const paused = !normalized.enabled || normalized.schedule === "manual";
  const status = !normalized.enabled
    ? "disabled"
    : validationDiagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? "invalid-settings"
      : retryReady
        ? "retry-scheduled"
        : failed
          ? latestSummary.degraded && normalized.mode !== "strict" ? "degraded" : "blocked"
          : paused
            ? "paused"
            : "ready";

  return Object.freeze({
    schema: "aios.parser.lifecycle-controller.v1",
    id: stableLifecycleId(normalized.label, normalized),
    settings: normalized,
    validation: Object.freeze({
      ok: validationDiagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      diagnostics: validationDiagnostics,
    }),
    controls: Object.freeze({
      canEnable: !normalized.enabled,
      canDisable: normalized.enabled,
      canRunNow: normalized.enabled && normalized.schedule !== "disabled" && !retryReady,
      canRetry: retryReady,
      canPause: normalized.enabled && normalized.schedule !== "manual",
      canResume: normalized.enabled && normalized.schedule === "manual",
    }),
    scheduling: Object.freeze({
      schedule: normalized.schedule,
      retryAfterMs: retryReady ? normalized.retryAfterMs : null,
      attemptsUsed,
      attemptsRemaining,
      maxAttempts: normalized.maxAttempts,
    }),
    latest: latestSummary,
    status,
    nextAction: retryReady
      ? "schedule-parser-retry"
      : failed
        ? latestSummary.nextAction
        : lifecycleNextAction(normalized, validationDiagnostics),
  });
}

export function applyParserLifecycleCommand(controller, command = {}) {
  const kind = command.kind ?? "noop";
  const settings = controller?.settings ?? normalizeParserLifecycleSettings();
  const nextSettings = kind === "enable"
    ? { ...settings, enabled: true, schedule: command.schedule ?? "immediate" }
    : kind === "disable"
      ? { ...settings, enabled: false, schedule: "disabled" }
      : kind === "pause"
        ? { ...settings, schedule: "manual" }
        : kind === "resume"
          ? { ...settings, enabled: true, schedule: command.schedule ?? "immediate" }
          : kind === "set-schedule"
            ? { ...settings, schedule: command.schedule }
            : kind === "set-mode"
              ? { ...settings, mode: command.mode }
              : settings;
  const next = createParserLifecycleController(nextSettings, command.latestResult ?? controller?.latest?.result ?? null);
  const unsupported = !["noop", "enable", "disable", "pause", "resume", "set-schedule", "set-mode"].includes(kind);

  return Object.freeze({
    schema: "aios.parser.lifecycle-command-result.v1",
    ok: !unsupported,
    command: Object.freeze({
      kind,
      schedule: command.schedule ?? null,
      mode: command.mode ?? null,
    }),
    previousStatus: controller?.status ?? "uninitialized",
    controller: next,
    diagnostic: unsupported
      ? createDiagnostic(
          "PARSER_LIFECYCLE_UNKNOWN_COMMAND",
          `Unsupported parser lifecycle command '${kind}'.`,
          { line: 1, column: 1, offset: 0 },
        )
      : null,
    nextAction: unsupported ? "choose-supported-parser-lifecycle-command" : next.nextAction,
  });
}

export function createProviderHandoffContract(adapterOrHead, stream, options = {}) {
  const adapter = typeof adapterOrHead === "string" ? adapterOrHead : adapterOrHead?.adapter;
  const profile = providerCapabilityProfile(adapter, options);
  const grantedPermissions = normalizeGrantedPermissions(stream, options);
  const lifecycle = options.lifecycleController
    ?? (options.lifecycleSettings ? createParserLifecycleController(options.lifecycleSettings, options.latestResult ?? null) : null);
  const health = createTokenStreamHealthReport(stream, {
    ...options,
    requiredPermissions: profile.requiredPermissions,
    reason: options.reason ?? "provider-handoff",
  });
  const analytics = createTokenStreamAnalyticsReport(stream, {
    ...options,
    requiredPermissions: profile.requiredPermissions,
    reason: options.reason ?? "provider-handoff",
  });
  const negotiation = negotiateProviderCapabilities(profile, grantedPermissions);
  const sync = providerSyncMetadata(adapter, stream, health, analytics, options);
  const serviceContract = createTokenStreamProviderServiceContract(stream, {
    ...options,
    adapter,
    provider: profile.provider,
    operation: profile.operation,
    permissions: grantedPermissions,
    requiredPermissions: profile.requiredPermissions,
    requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    enabled: lifecycle?.settings?.enabled ?? options.enabled,
    scheduledAt: options.scheduledAt,
    acceptedBy: options.acceptedBy,
    reason: options.reason ?? "provider-handoff-service",
  });
  const previewAcceptance = createTokenStreamProviderAcceptanceSummary(stream, {
    ...options,
    adapter,
    provider: profile.provider,
    operation: profile.operation,
    permissions: grantedPermissions,
    requiredPermissions: profile.requiredPermissions,
    requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    enabled: lifecycle?.settings?.enabled ?? options.enabled,
    scheduledAt: options.scheduledAt,
    acceptedBy: options.acceptedBy,
    reason: options.reason ?? "parser-provider-preview-acceptance",
  });
  const mailchimpAdoption = profile.provider === "mailchimp"
    ? createTokenStreamMailchimpAdoptionPacket(stream, {
        ...options,
        adapter,
        provider: profile.provider,
        operation: profile.operation,
        permissions: grantedPermissions,
        requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
        auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
        statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
        enabled: lifecycle?.settings?.enabled ?? options.enabled,
        scheduledAt: options.scheduledAt,
        acceptedBy: options.acceptedBy,
        acceptanceSummary: previewAcceptance,
        reason: options.reason ?? "parser-provider-mailchimp-adoption",
      })
    : null;
  const adapterStatus = createTokenStreamAdapterStatusPacket(stream, {
    ...options,
    adapter,
    provider: profile.provider,
    operation: profile.operation,
    permissions: grantedPermissions,
    requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    enabled: lifecycle?.settings?.enabled ?? options.enabled,
    acceptedBy: options.acceptedBy,
    reason: options.reason ?? "parser-provider-adapter-status",
  });
  const clientState = createParserProviderClientState(adapter, stream, serviceContract, lifecycle, mailchimpAdoption);
  const persistedHandoffState = createPersistedProviderHandoffState(
    adapter,
    stream,
    profile,
    negotiation,
    serviceContract,
    health,
    lifecycle,
    mailchimpAdoption,
  );
  const streamReady = health.ok && analytics.ok;
  const accepted = Boolean(adapter)
    && streamReady
    && negotiation.accepted
    && serviceContract.acceptance.accepted
    && adapterStatus.parserHandoff.accepted
    && clientState.ready
    && persistedHandoffState.restartSafe;

  return Object.freeze({
    schema: "aios.parser.provider-handoff.contract.v1",
    adapter: adapter ?? null,
    provider: profile.provider,
    operation: profile.operation,
    profile,
    negotiation,
    serviceContract,
    streamHealth: Object.freeze({
      ok: health.ok,
      status: health.status,
      cursor: health.cursor,
      boundary: health.boundary,
      retry: health.retry,
      nextAction: health.nextAction,
    }),
    analytics: analytics.exportSummary,
    sync,
    adapterStatus,
    clientState,
    previewAcceptance,
    mailchimpAdoption,
    persistedHandoffState,
    externalHandoff: Object.freeze({
      accepted,
      status: accepted
        ? "ready"
        : !adapter
          ? "missing-adapter"
          : clientState.status === "lifecycle-disabled"
            ? "lifecycle-disabled"
          : !streamReady
            ? "stream-review"
            : !adapterStatus.parserHandoff.accepted
              ? adapterStatus.parserHandoff.status
            : !persistedHandoffState.restartSafe
              ? persistedHandoffState.status
            : !serviceContract.acceptance.accepted
              ? serviceContract.acceptance.status
            : negotiation.status,
      retryable: !accepted && health.retry.maxAttempts > 0,
      retryAfterMs: !accepted ? health.retry.retryAfterMs : null,
      nextAction: accepted
        ? "handoff-provider"
        : !adapter
        ? "declare-provider-adapter"
        : clientState.status === "lifecycle-disabled"
          ? clientState.nextAction
        : !streamReady
          ? health.nextAction
          : !adapterStatus.parserHandoff.accepted
            ? adapterStatus.nextAction
          : !persistedHandoffState.restartSafe
            ? persistedHandoffState.nextAction
          : !serviceContract.acceptance.accepted
            ? serviceContract.acceptance.nextAction
          : negotiation.nextAction,
    }),
    acceptanceSummary: Object.freeze({
      accepted: previewAcceptance.accepted,
      status: previewAcceptance.status,
      validationSummary: previewAcceptance.validationSummary,
      controls: previewAcceptance.controls,
      nextStep: previewAcceptance.explanation.nextStep,
      nextAction: previewAcceptance.nextAction,
    }),
    nextAction: accepted
      ? "handoff-provider"
      : !adapter
        ? "declare-provider-adapter"
        : clientState.status === "lifecycle-disabled"
        ? clientState.nextAction
        : !streamReady
          ? health.nextAction
          : !adapterStatus.parserHandoff.accepted
            ? adapterStatus.nextAction
          : !persistedHandoffState.restartSafe
            ? persistedHandoffState.nextAction
          : !serviceContract.acceptance.accepted
            ? serviceContract.acceptance.nextAction
          : negotiation.nextAction,
  });
}

export function createParserExportBundle(results = [], options = {}) {
  const timeline = createParserTimelineSnapshot(results, {
    label: options.label ?? "parser-export",
    reason: options.reason ?? "parser-export-bundle",
  });
  const latestStream = Array.from(results ?? []).findLast?.((result) => result?.stream)?.stream
    ?? Array.from(results ?? []).reverse().find((result) => result?.stream)?.stream
    ?? options.stream
    ?? null;
  const health = latestStream
    ? createTokenStreamHealthReport(latestStream, {
        ...options,
        reason: options.reason ?? "parser-export-bundle",
      })
    : null;
  const analytics = latestStream
    ? createTokenStreamAnalyticsReport(latestStream, {
        ...options,
        reason: options.reason ?? "parser-export-bundle",
      })
    : null;
  const provider = latestStream && options.adapter
    ? createProviderHandoffContract(options.adapter, latestStream, {
        ...options,
        reason: options.reason ?? "parser-export-provider",
      })
    : null;
  const recoveryCommands = Object.freeze(timeline.events
    .map((event) => event.recoveryCommand)
    .filter(Boolean));
  const commandAudit = latestStream
    ? createTokenStreamCommandAuditReport(latestStream, recoveryCommands, {
        ...options,
        reason: options.reason ?? "parser-export-command-audit",
        requiredPermissions: provider?.profile?.requiredPermissions ?? options.requiredPermissions ?? [],
      })
    : null;
  const failed = timeline.events.filter((event) => !event.ok);
  const ready = timeline.ok
    && (!health || health.ok)
    && (!analytics || analytics.ok)
    && (!provider || provider.externalHandoff.accepted)
    && (!commandAudit || commandAudit.ok);
  const firstBlocker = !timeline.ok
    ? timeline.events.find((event) => !event.ok)
    : health && !health.ok
      ? health
      : provider && !provider.externalHandoff.accepted
        ? provider.externalHandoff
        : commandAudit && !commandAudit.ok
          ? commandAudit
          : null;

  return Object.freeze({
    schema: "aios.parser.export-bundle.v1",
    label: options.label ?? "parser-export",
    ready,
    status: ready
      ? "export-ready"
      : !timeline.ok
        ? timeline.status
        : health && !health.ok
          ? health.status
          : provider && !provider.externalHandoff.accepted
            ? provider.externalHandoff.status
            : commandAudit?.status ?? "review",
    counters: Object.freeze({
      eventCount: timeline.eventCount,
      failedCount: failed.length,
      diagnosticCount: timeline.counters.diagnostics,
      recoveryCommandCount: recoveryCommands.length,
      commandAuditBlockedCount: commandAudit?.exportSummary.blockedCount ?? 0,
    }),
    timeline,
    health: health
      ? Object.freeze({
          ok: health.ok,
          status: health.status,
          cursor: health.cursor,
          nextAction: health.nextAction,
        })
      : null,
    analytics: analytics?.exportSummary ?? null,
    provider: provider
      ? Object.freeze({
          adapter: provider.adapter,
          status: provider.externalHandoff.status,
          accepted: provider.externalHandoff.accepted,
          adapterStatus: provider.adapterStatus.status,
          adapterStatusReady: provider.adapterStatus.parserHandoff.accepted,
          stateKey: provider.persistedHandoffState.stateKey,
          nextAction: provider.nextAction,
        })
      : null,
    commandAudit: commandAudit?.exportSummary ?? null,
    controls: Object.freeze({
      canExport: ready,
      canRetryParser: failed.some((event) => event.retryable),
      canReplayRecoveryCommands: Boolean(commandAudit?.controls.canApply),
      canHandoffProvider: Boolean(provider?.externalHandoff.accepted),
    }),
    exportSummary: Object.freeze({
      label: options.label ?? "parser-export",
      status: ready ? "export-ready" : "export-review",
      cursor: latestStream?.cursor ?? 0,
      failedCount: failed.length,
      providerStatus: provider?.externalHandoff.status ?? "not-required",
      nextAction: ready ? "publish-parser-export" : firstBlocker?.nextAction ?? "review-parser-export",
    }),
    nextAction: ready ? "publish-parser-export" : firstBlocker?.nextAction ?? "review-parser-export",
  });
}

export function parserProviderHandoffSummary(adapterOrHead, stream, options = {}) {
  const contract = createProviderHandoffContract(adapterOrHead, stream, options);

  return Object.freeze({
    schema: "aios.parser.provider-handoff.summary.v1",
    adapter: contract.adapter,
    provider: contract.provider,
    operation: contract.operation,
    ok: contract.externalHandoff.accepted,
    status: contract.externalHandoff.status,
    missingPermissions: contract.negotiation.missingPermissions,
    unsupportedCapabilities: contract.negotiation.unsupportedCapabilities,
    syncKey: contract.sync.syncKey,
    serviceSyncKey: contract.serviceContract.sync.syncKey,
    stateKey: contract.persistedHandoffState.stateKey,
    restartSafe: contract.persistedHandoffState.restartSafe,
    acceptance: contract.serviceContract.acceptance.status,
    previewAcceptance: contract.previewAcceptance.status,
    mailchimpAdoption: contract.mailchimpAdoption?.status ?? "not-required",
    adapterStatus: contract.adapterStatus.status,
    adapterStatusReady: contract.adapterStatus.parserHandoff.accepted,
    adapterBlockedGate: contract.adapterStatus.parserHandoff.blockedGate,
    controls: contract.clientState.controls,
    health: contract.streamHealth.status,
    analytics: contract.analytics.status,
    nextAction: contract.nextAction,
  });
}

export function parserErr(stream, diagnostic, meta = {}) {
  const diagnostics = Object.freeze([diagnostic]);
  return Object.freeze({
    ok: false,
    value: null,
    stream,
    diagnostics,
    meta: Object.freeze({
      ...meta,
      failure: classifyParserFailure(diagnostics, stream, meta.label ?? meta.combinator ?? "parser"),
    }),
  });
}

export function parserFailureEnvelope(result, label = "parser") {
  if (result?.ok) {
    return Object.freeze({
      schema: "aios.parser.failure-envelope.v1",
      ok: true,
      status: "ok",
      nextAction: "continue",
      diagnostics: Object.freeze([]),
    });
  }

  const diagnostics = Object.freeze(Array.from(result?.diagnostics ?? []));
  const failure = result?.meta?.failure ?? classifyParserFailure(diagnostics, result?.stream, label);

  return Object.freeze({
    schema: "aios.parser.failure-envelope.v1",
    ok: false,
    status: failure.status,
    retryable: failure.retryable,
    degraded: failure.degraded,
    retryAfterMs: failure.retryAfterMs,
    diagnostics,
    failure,
    nextAction: failure.nextAction,
  });
}

export function createParserTimelineSnapshot(results = [], options = {}) {
  const entries = Object.freeze(Array.from(results ?? []).map((result, index) => parserHistoryEvent(
    result,
    result?.meta?.label ?? result?.meta?.combinator ?? `${options.label ?? "parser"}:${index}`,
  )));
  const failed = entries.filter((entry) => !entry.ok);
  const degraded = entries.filter((entry) => entry.degraded);
  const retryable = entries.filter((entry) => entry.retryable);
  const latestStream = Array.from(results ?? []).findLast?.((result) => result?.stream)?.stream
    ?? Array.from(results ?? []).reverse().find((result) => result?.stream)?.stream
    ?? null;
  const checkpoint = latestStream ? createTokenCheckpoint(latestStream, options.reason ?? "parser-timeline") : null;

  return Object.freeze({
    schema: "aios.parser.timeline.v1",
    label: options.label ?? "parser",
    eventCount: entries.length,
    ok: failed.length === 0,
    status: failed.length === 0
      ? "ok"
      : degraded.length === failed.length
        ? "degraded"
        : retryable.length > 0
          ? "retryable"
          : "blocked",
    counters: Object.freeze({
      ok: entries.length - failed.length,
      failed: failed.length,
      degraded: degraded.length,
      retryable: retryable.length,
      diagnostics: entries.reduce((total, entry) => total + entry.diagnosticCount, 0),
    }),
    checkpoint,
    events: entries,
    exportSummary: Object.freeze({
      label: options.label ?? "parser",
      status: failed.length === 0 ? "ok" : failed[0].status,
      cursor: latestStream?.cursor ?? 0,
      checkpointCursor: checkpoint?.cursor ?? null,
      nextAction: failed[0]?.nextAction ?? "continue",
    }),
    nextAction: failed.length === 0
      ? "continue"
      : failed.some((entry) => entry.nextAction === "surface-parser-error")
        ? "surface-parser-error"
        : failed[0].nextAction,
  });
}

export function summarizeParserResult(result, label = "parser") {
  const event = parserHistoryEvent(result, label);
  const envelope = parserFailureEnvelope(result, label);

  return Object.freeze({
    schema: "aios.parser.result-summary.v1",
    label,
    ok: Boolean(result?.ok),
    status: event.status,
    counters: event.counters,
    cursor: event.cursor,
    retryable: event.retryable,
    degraded: event.degraded,
    failure: envelope.ok ? null : envelope.failure,
    exportSummary: Object.freeze({
      label,
      status: event.status,
      diagnosticCount: event.diagnosticCount,
      nextAction: event.nextAction,
    }),
    nextAction: event.nextAction,
  });
}

export function literal(value) {
  return (stream) => {
    const result = expectToken(
      stream,
      typeof value === "string" ? TOKEN_TYPES.KEYWORD : value.type,
      typeof value === "string" ? value : value.value,
      "COMBINATOR_EXPECTED_LITERAL",
      `Expected ${typeof value === "string" ? value : value.value}.`,
    );

    return result.ok
      ? parserOk(result.token, result.stream, { combinator: "literal" })
      : parserErr(result.stream, result.diagnostic, { combinator: "literal" });
  };
}

export function symbol(value) {
  return (stream) => {
    const result = expectToken(stream, TOKEN_TYPES.SYMBOL, value, "COMBINATOR_EXPECTED_SYMBOL", `Expected symbol '${value}'.`);
    return result.ok
      ? parserOk(result.token, result.stream, { combinator: "symbol" })
      : parserErr(result.stream, result.diagnostic, { combinator: "symbol" });
  };
}

export function identifier(label = "identifier") {
  return (stream) => {
    const token = currentToken(stream);
    if (token.type === TOKEN_TYPES.IDENTIFIER || token.type === TOKEN_TYPES.KEYWORD) {
      return parserOk(token.value, advanceTokenStream(stream), { combinator: "identifier", label });
    }

    return parserErr(
      stream,
      createDiagnostic("COMBINATOR_EXPECTED_IDENTIFIER", `Expected ${label}. Found ${tokenLabel(token)}.`, token),
      { combinator: "identifier", label },
    );
  };
}

export function optional(parser, fallback = null) {
  return (stream) => {
    const result = parser(stream);
    return result.ok ? result : parserOk(fallback, stream, { combinator: "optional" });
  };
}

export function sequence(parsers, label = "sequence") {
  return (stream) => {
    let next = stream;
    const values = [];
    const diagnostics = [];

    for (const parser of parsers) {
      const result = parser(next);
      diagnostics.push(...result.diagnostics);
      if (!result.ok) {
        const resultDiagnostics = Object.freeze(diagnostics);
        const failure = classifyParserFailure(resultDiagnostics, result.stream, label);
        return Object.freeze({
          ok: false,
          value: Object.freeze(values),
          stream: result.stream,
          diagnostics: resultDiagnostics,
          meta: Object.freeze({ combinator: "sequence", label, failure }),
        });
      }
      values.push(result.value);
      next = result.stream;
    }

    return parserOk(Object.freeze(values), next, { combinator: "sequence", label });
  };
}

export function choice(parsers, label = "choice") {
  return (stream) => {
    const diagnostics = [];
    for (const parser of parsers) {
      const result = parser(stream);
      if (result.ok) {
        return parserOk(result.value, result.stream, { combinator: "choice", label });
      }
      diagnostics.push(...result.diagnostics);
    }

    const token = currentToken(stream);
    return Object.freeze({
      ok: false,
      value: null,
      stream,
      diagnostics: Object.freeze([
        createDiagnostic("COMBINATOR_NO_CHOICE", `No ${label} parser matched ${tokenLabel(token)}.`, token),
        ...diagnostics,
      ]),
      meta: Object.freeze({
        combinator: "choice",
        label,
        failure: classifyParserFailure([
          createDiagnostic("COMBINATOR_NO_CHOICE", `No ${label} parser matched ${tokenLabel(token)}.`, token),
          ...diagnostics,
        ], stream, label),
      }),
    });
  };
}

export function many(parser, options = {}) {
  return (stream) => {
    let next = stream;
    const values = [];
    const diagnostics = [];
    const limit = Number.isInteger(options.limit) ? options.limit : 1000;

    while (values.length < limit) {
      const before = next.cursor;
      const result = parser(next);
      if (!result.ok) {
        diagnostics.push(...result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning"));
        break;
      }
      values.push(result.value);
      next = result.stream;
      if (next.cursor === before) {
        diagnostics.push(createDiagnostic(
          "COMBINATOR_STALLED",
          "Parser combinator did not advance the token stream.",
          currentToken(next),
        ));
        break;
      }
    }

    return Object.freeze({
      ok: diagnostics.every((diagnostic) => diagnostic.severity === "warning"),
      value: Object.freeze(values),
      stream: next,
      diagnostics: Object.freeze(diagnostics),
      meta: Object.freeze({
        combinator: "many",
        count: values.length,
        failure: diagnostics.length > 0 ? classifyParserFailure(diagnostics, next, options.label ?? "many") : null,
      }),
    });
  };
}

export function recoverUntil(parser, stopValues = [";", "}"], label = "recovery") {
  return (stream) => {
    const result = parser(stream);
    if (result.ok) {
      return result;
    }

    let next = result.stream;
    while (currentToken(next).type !== TOKEN_TYPES.EOF && !stopValues.includes(currentToken(next).value)) {
      next = advanceTokenStream(next);
    }

    const stoppedOn = currentToken(next);
    const recoveredStream = stoppedOn.value === ";" ? advanceTokenStream(next) : next;
    return Object.freeze({
      ok: false,
      value: null,
      stream: recoveredStream,
      diagnostics: Object.freeze([
        ...result.diagnostics,
        createDiagnostic("COMBINATOR_RECOVERED", `Recovered ${label} at ${tokenLabel(stoppedOn)}.`, stoppedOn, "warning"),
      ]),
      meta: Object.freeze({
        combinator: "recoverUntil",
        label,
        failure: classifyParserFailure([
          ...result.diagnostics,
          createDiagnostic("COMBINATOR_RECOVERED", `Recovered ${label} at ${tokenLabel(stoppedOn)}.`, stoppedOn, "warning"),
        ], recoveredStream, label),
      }),
    });
  };
}

export function parseQualifiedIdentifier(stream) {
  const first = identifier("qualified identifier")(stream);
  if (!first.ok) {
    return first;
  }

  let next = first.stream;
  const parts = [first.value];
  while (matchToken(next, TOKEN_TYPES.SYMBOL, ".").matched) {
    next = advanceTokenStream(next);
    const part = identifier("qualified identifier part")(next);
    if (!part.ok) {
      return part;
    }
    parts.push(part.value);
    next = part.stream;
  }

  return parserOk(parts.join("."), next, { combinator: "qualifiedIdentifier" });
}

export function parseMailchimpHandoffHead(stream) {
  const parser = sequence([
    literal("handoff"),
    literal("adapter"),
    parseQualifiedIdentifier,
  ], "mailchimp handoff head");
  const result = parser(stream);
  if (!result.ok) {
    return result;
  }

  const adapter = result.value[2];
  const provider = String(adapter).split(".")[0];
  if (provider !== "mailchimp") {
    return parserErr(
      result.stream,
      createDiagnostic("COMBINATOR_MAILCHIMP_ADAPTER", `Expected Mailchimp adapter handoff, received '${adapter}'.`, currentToken(result.stream)),
      { combinator: "mailchimpHandoffHead" },
    );
  }

  return parserOk(Object.freeze({ adapter, provider }), result.stream, { combinator: "mailchimpHandoffHead" });
}
