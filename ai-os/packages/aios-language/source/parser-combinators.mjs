import { TOKEN_TYPES, createDiagnostic, tokenLabel } from "./tokens.mjs";
import {
  advanceTokenStream,
  createTokenCheckpoint,
  createTokenStreamAnalyticsReport,
  createTokenStreamAdapterStatusPacket,
  createTokenStreamBoundaryEscalationPacket,
  createTokenStreamBoundaryIncidentReport,
  createTokenStreamTenantBoundaryReadiness,
  createTokenStreamClientHandoffPacket,
  createTokenStreamCommand,
  createTokenStreamCommandAuditReport,
  createTokenStreamExecutionBoundaryControl,
  createTokenStreamHandoffEvidencePacket,
  createTokenStreamHealthReport,
  createTokenStreamExecutionIntentPacket,
  createTokenStreamExternalProviderStatusReceipt,
  createTokenStreamProviderHandoffReceipt,
  createTokenStreamMailchimpAdoptionPacket,
  createTokenStreamClientRuntimeAdoptionSnapshot,
  createTokenStreamMailchimpHandoffDecision,
  createTokenStreamMailchimpExportLedger,
  createTokenStreamMailchimpReadinessLedger,
  createTokenStreamMailchimpRecoveryEnvelope,
  createTokenStreamMailchimpOperatorGate,
  createTokenStreamMailchimpControlPlane,
  createTokenStreamNextActionQueue,
  createTokenStreamOperatorDecisionLane,
  createTokenStreamOperationsPacket,
  createTokenStreamExportReadinessManifest,
  createTokenStreamProviderLifecycleManifest,
  createTokenStreamProviderAcceptanceSummary,
  createTokenStreamProviderServiceContract,
  createTokenStreamResumptionManifest,
  createTokenStreamResumptionStatusEnvelope,
  createTokenStreamRestartJournal,
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

function createParserProviderClientState(adapter, stream, serviceContract, lifecycle = null, adoptionPacket = null, operatorGate = null) {
  const boundary = serviceContract.boundary;
  const acceptance = serviceContract.acceptance;
  const disabledByLifecycle = lifecycle?.status === "disabled" || lifecycle?.settings?.schedule === "disabled";
  const waitingOnManualLifecycle = lifecycle?.settings?.schedule === "manual" && !acceptance.accepted;
  const adoptionReady = !adoptionPacket || adoptionPacket.ready || serviceContract.service.provider !== "mailchimp";
  const operatorReady = !operatorGate || operatorGate.accepted || serviceContract.service.provider !== "mailchimp";
  const ready = acceptance.accepted && adoptionReady && operatorReady && !disabledByLifecycle && !waitingOnManualLifecycle;

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
    operatorGate: operatorGate
      ? Object.freeze({
          gateId: operatorGate.gateId,
          status: operatorGate.status,
          accepted: operatorGate.accepted,
          mode: operatorGate.mode,
          missing: operatorGate.validationSummary.missing,
          nextAction: operatorGate.nextAction,
        })
      : null,
    controls: Object.freeze({
      ...acceptance.controls,
      canRunNow: ready && (!lifecycle || lifecycle.controls.canRunNow),
      canSchedule: acceptance.controls.canSchedule && (!lifecycle || lifecycle.settings.schedule !== "disabled"),
      canDisable: acceptance.controls.canDisable || Boolean(lifecycle?.controls.canDisable),
      canResume: Boolean(lifecycle?.controls.canResume),
      canAdoptMailchimp: Boolean(adoptionPacket?.ready),
      canPassOperatorGate: operatorReady,
    }),
    ready,
    status: disabledByLifecycle
      ? "lifecycle-disabled"
      : waitingOnManualLifecycle
        ? "manual-acceptance"
        : adoptionPacket && !adoptionReady
          ? adoptionPacket.status
        : operatorGate && !operatorReady
          ? operatorGate.status
        : acceptance.status,
    nextAction: ready
      ? "run-provider-handoff"
      : disabledByLifecycle
        ? "enable-parser-lifecycle"
        : waitingOnManualLifecycle
        ? "accept-provider-preview"
        : adoptionPacket && !adoptionReady
          ? adoptionPacket.nextAction
        : operatorGate && !operatorReady
          ? operatorGate.nextAction
        : acceptance.nextAction,
  });
}

function createPersistedProviderHandoffState(
  adapter,
  stream,
  profile,
  negotiation,
  serviceContract,
  health,
  lifecycle = null,
  adoptionPacket = null,
  restartJournal = null,
) {
  const mutating = profile.mutatesProvider;
  const hasIdempotency = serviceContract.negotiation.supportedCapabilities.includes("idempotency")
    && (!mutating || serviceContract.negotiation.requestedCapabilities.includes("idempotency"));
  const checkpointReady = Boolean(health.checkpoint?.restartSafe);
  const journalReady = !restartJournal || restartJournal.validation.restartSafe;
  const lifecycleRestartable = !lifecycle || lifecycle.status !== "disabled";
  const statusReady = Boolean(serviceContract.sync.statusChannel);
  const auditReady = !serviceContract.acceptance.audit.required || serviceContract.acceptance.audit.status === "audit-ready";
  const missing = Object.freeze([
    adapter ? null : "adapter",
    checkpointReady ? null : "restart-safe-token-checkpoint",
    journalReady ? null : "restart-journal",
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
    restartJournal: restartJournal
      ? Object.freeze({
          journalId: restartJournal.journalId,
          restartSafe: restartJournal.validation.restartSafe,
          entryCount: restartJournal.counters.total,
          blockedEntryIds: restartJournal.validation.blockedEntryIds,
          duplicateIds: restartJournal.validation.duplicateIds,
          audit: restartJournal.audit,
          nextAction: restartJournal.nextAction,
        })
      : null,
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
        : missing.includes("restart-journal")
          ? restartJournal?.exportSummary.status ?? "restart-journal-review"
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
        : missing.includes("restart-journal")
          ? restartJournal?.nextAction ?? "persist-restart-journal"
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

function createParserMailchimpReadinessGate(adapter, stream, profile, lifecycle, ledger, options = {}) {
  if (profile.provider !== "mailchimp") {
    return Object.freeze({
      schema: "aios.parser.mailchimp-readiness-gate.v1",
      required: false,
      accepted: true,
      status: "not-required",
      nextAction: "continue",
    });
  }

  const lifecycleReady = !lifecycle || (lifecycle.status !== "disabled" && lifecycle.settings.schedule !== "disabled");
  const missing = Object.freeze([
    ledger.accepted ? null : ledger.blockedGate?.label ?? "mailchimp-readiness-ledger",
    lifecycleReady ? null : "enabled-parser-lifecycle",
    options.idempotencyKey || !profile.mutatesProvider || ledger.idempotency.ready ? null : "idempotency-key",
  ].filter(Boolean));

  return Object.freeze({
    schema: "aios.parser.mailchimp-readiness-gate.v1",
    required: true,
    accepted: missing.length === 0,
    status: missing.length === 0
      ? "accepted"
      : missing.includes("enabled-parser-lifecycle")
        ? "lifecycle-disabled"
        : missing.includes("idempotency-key")
          ? "idempotency-review"
          : ledger.status,
    ledgerId: ledger.ledgerId,
    blockedGate: ledger.blockedGate,
    idempotency: ledger.idempotency,
    counters: ledger.counters,
    controls: Object.freeze({
      canHandoffProvider: missing.length === 0,
      canRetryAutomatically: ledger.controls.canRetryAutomatically && lifecycleReady,
      canExportAudit: ledger.controls.canExportAudit,
      canRunDegraded: ledger.controls.canRunDegraded && lifecycleReady,
    }),
    missing,
    nextAction: missing.length === 0
      ? "handoff-provider"
      : missing.includes("enabled-parser-lifecycle")
        ? "enable-parser-lifecycle"
        : missing.includes("idempotency-key")
          ? "declare-idempotency-key"
          : ledger.nextAction,
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
  const latestStream = latestResult?.stream ?? settings.stream ?? null;
  const boundaryIncident = latestStream
    ? createTokenStreamBoundaryIncidentReport(latestStream, {
        expectedWorkspace: settings.expectedWorkspace,
        expectedTenant: settings.expectedTenant,
        expectedRole: settings.expectedRole,
        permissions: settings.permissions,
        auditChannel: settings.auditChannel,
        requiredPermissions: settings.requiredPermissions ?? [],
      })
    : null;
  const tenantBoundaryReadiness = latestStream
    ? createTokenStreamTenantBoundaryReadiness(latestStream, {
        expectedWorkspace: settings.expectedWorkspace,
        expectedTenant: settings.expectedTenant,
        expectedRole: settings.expectedRole,
        permissions: settings.permissions,
        auditChannel: settings.auditChannel,
        requiredPermissions: settings.requiredPermissions ?? [],
      })
    : null;
  const boundaryEscalation = latestStream
    ? createTokenStreamBoundaryEscalationPacket(latestStream, {
        expectedWorkspace: settings.expectedWorkspace,
        expectedTenant: settings.expectedTenant,
        expectedRole: settings.expectedRole,
        permissions: settings.permissions,
        auditChannel: settings.auditChannel,
        requiredPermissions: settings.requiredPermissions ?? [],
        boundaryIncident,
        tenantBoundaryReadiness,
        reason: "parser-lifecycle-boundary-escalation",
      })
    : null;
  const executionBoundary = latestStream
    ? createTokenStreamExecutionBoundaryControl(latestStream, {
        expectedWorkspace: settings.expectedWorkspace,
        expectedTenant: settings.expectedTenant,
        expectedRole: settings.expectedRole,
        permissions: settings.permissions,
        auditChannel: settings.auditChannel,
        statusChannel: settings.statusChannel,
        requiredPermissions: settings.requiredPermissions ?? [],
        enabled: normalized.enabled,
        schedule: normalized.schedule,
        maxAttempts: normalized.maxAttempts,
        attemptsUsed: settings.attemptsUsed,
        retryAfterMs: normalized.retryAfterMs,
        allowDegraded: normalized.mode === "degraded",
        boundaryIncident,
        tenantBoundaryReadiness,
        boundaryEscalation,
        reason: "parser-lifecycle-execution-boundary",
      })
    : null;
  const failed = latestSummary && !latestSummary.ok;
  const attemptsUsed = Number.isInteger(settings.attemptsUsed) ? Math.max(0, settings.attemptsUsed) : 0;
  const attemptsRemaining = Math.max(0, normalized.maxAttempts - attemptsUsed);
  const retryReady = normalized.enabled
    && failed
    && latestSummary.retryable
    && boundaryIncident?.blocked !== true
    && tenantBoundaryReadiness?.accepted !== false
    && boundaryEscalation?.blocked !== true
    && executionBoundary?.phase !== "blocked"
    && attemptsRemaining > 0
    && normalized.schedule !== "manual"
    && normalized.schedule !== "disabled";
  const paused = !normalized.enabled || normalized.schedule === "manual";
  const status = !normalized.enabled
    ? "disabled"
    : validationDiagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? "invalid-settings"
      : executionBoundary?.phase === "blocked"
        ? executionBoundary.status
      : boundaryEscalation?.blocked
        ? boundaryEscalation.status
      : tenantBoundaryReadiness?.accepted === false
        ? tenantBoundaryReadiness.status
      : boundaryIncident?.blocked
        ? boundaryIncident.status
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
      canRunNow: normalized.enabled
        && normalized.schedule !== "disabled"
        && !retryReady
        && boundaryIncident?.blocked !== true
        && tenantBoundaryReadiness?.accepted !== false
        && boundaryEscalation?.blocked !== true
        && executionBoundary?.ready !== false,
      canEscalateBoundary: Boolean(boundaryEscalation?.blocked),
      canRetry: retryReady && executionBoundary?.retry.retryable !== false,
      canPause: normalized.enabled
        && normalized.schedule !== "manual"
        && boundaryIncident?.blocked !== true
        && tenantBoundaryReadiness?.accepted !== false
        && boundaryEscalation?.blocked !== true
        && executionBoundary?.phase !== "blocked",
      canResume: normalized.enabled
        && normalized.schedule === "manual"
        && boundaryIncident?.blocked !== true
        && tenantBoundaryReadiness?.accepted !== false
        && boundaryEscalation?.blocked !== true
        && executionBoundary?.controls.canResume !== false,
      canExportBoundaryIncident: Boolean(boundaryIncident?.audit.channel ?? tenantBoundaryReadiness?.audit.channel),
      canHandoffTenantBoundary: tenantBoundaryReadiness?.accepted !== false && boundaryEscalation?.blocked !== true,
      canHandoffExecutionBoundary: executionBoundary?.ready !== false,
      canEmitExecutionStatus: Boolean(executionBoundary?.statusChannel),
    }),
    scheduling: Object.freeze({
      schedule: normalized.schedule,
      retryAfterMs: boundaryIncident?.blocked ? null : retryReady ? executionBoundary?.retry.retryAfterMs ?? normalized.retryAfterMs : null,
      attemptsUsed,
      attemptsRemaining: boundaryIncident?.blocked || boundaryEscalation?.blocked || executionBoundary?.phase === "blocked"
        ? 0
        : attemptsRemaining,
      maxAttempts: normalized.maxAttempts,
    }),
    boundaryEscalation,
    boundaryIncident,
    tenantBoundaryReadiness,
    executionBoundary,
    latest: latestSummary,
    status,
    nextAction: executionBoundary?.phase === "blocked"
      ? executionBoundary.nextAction
      : boundaryEscalation?.blocked
      ? boundaryEscalation.nextAction
      : tenantBoundaryReadiness?.accepted === false
      ? tenantBoundaryReadiness.nextAction
      : boundaryIncident?.blocked
      ? boundaryIncident.nextAction
      : retryReady
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
  const boundaryBlocked = controller?.boundaryIncident?.blocked === true
    || controller?.tenantBoundaryReadiness?.accepted === false
    || controller?.boundaryEscalation?.blocked === true
    || controller?.executionBoundary?.phase === "blocked";
  const boundaryBlockedCommand = boundaryBlocked && ["enable", "resume", "set-schedule"].includes(kind);

  return Object.freeze({
    schema: "aios.parser.lifecycle-command-result.v1",
    ok: !unsupported && !boundaryBlockedCommand,
    command: Object.freeze({
      kind,
      schedule: command.schedule ?? null,
      mode: command.mode ?? null,
    }),
    previousStatus: controller?.status ?? "uninitialized",
    controller: boundaryBlockedCommand ? controller : next,
    diagnostic: unsupported
      ? createDiagnostic(
          "PARSER_LIFECYCLE_UNKNOWN_COMMAND",
          `Unsupported parser lifecycle command '${kind}'.`,
          { line: 1, column: 1, offset: 0 },
        )
      : boundaryBlockedCommand
        ? createDiagnostic(
          "PARSER_LIFECYCLE_BOUNDARY_BLOCKED",
            `Parser lifecycle command '${kind}' is blocked by ${controller.executionBoundary?.status ?? controller.boundaryEscalation?.status ?? controller.tenantBoundaryReadiness?.status ?? controller.boundaryIncident.status}.`,
            { line: 1, column: 1, offset: 0 },
          )
      : null,
    nextAction: unsupported
      ? "choose-supported-parser-lifecycle-command"
      : boundaryBlockedCommand
        ? controller.executionBoundary?.nextAction ?? controller.boundaryEscalation?.nextAction ?? controller.tenantBoundaryReadiness?.nextAction ?? controller.boundaryIncident.nextAction
        : next.nextAction,
  });
}

export function createProviderHandoffContract(adapterOrHead, stream, options = {}) {
  const adapter = typeof adapterOrHead === "string" ? adapterOrHead : adapterOrHead?.adapter;
  const profile = providerCapabilityProfile(adapter, options);
  const grantedPermissions = normalizeGrantedPermissions(stream, options);
  const lifecycle = options.lifecycleController
    ?? (options.lifecycleSettings ? createParserLifecycleController({
      ...options.lifecycleSettings,
      stream,
      permissions: options.lifecycleSettings.permissions ?? grantedPermissions,
      auditChannel: options.lifecycleSettings.auditChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
      requiredPermissions: options.lifecycleSettings.requiredPermissions ?? profile.requiredPermissions,
    }, options.latestResult ?? null) : null);
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
  const clientRuntimeAdoption = profile.provider === "mailchimp"
    ? createTokenStreamClientRuntimeAdoptionSnapshot(stream, {
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
        idempotencyKey: options.idempotencyKey,
        serviceContract,
        acceptanceSummary: previewAcceptance,
        mailchimpAdoption,
        clientRoute: options.clientRoute ?? "parser-provider-client-runtime-adoption",
        reason: options.reason ?? "parser-provider-client-runtime-adoption",
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
  const restartJournal = createTokenStreamRestartJournal(stream, {
    ...options,
    reason: options.reason ?? "parser-provider-restart-journal",
    permissions: grantedPermissions,
    requiredPermissions: profile.requiredPermissions,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    entries: [
      Object.freeze({
        kind: "provider-negotiation",
        cursor: stream?.cursor ?? 0,
        payload: Object.freeze({
          provider: profile.provider,
          operation: profile.operation,
          status: negotiation.status,
          missingPermissions: negotiation.missingPermissions.join(","),
        }),
        status: negotiation.accepted ? "accepted" : negotiation.status,
        nextAction: negotiation.nextAction,
      }),
      Object.freeze({
        kind: "provider-acceptance",
        cursor: stream?.cursor ?? 0,
        payload: Object.freeze({
          status: previewAcceptance.status,
          accepted: previewAcceptance.accepted,
          acceptedBy: options.acceptedBy ?? null,
        }),
        status: previewAcceptance.accepted ? "accepted" : previewAcceptance.status,
        nextAction: previewAcceptance.nextAction,
      }),
      Object.freeze({
        kind: "adapter-status",
        cursor: stream?.cursor ?? 0,
        payload: Object.freeze({
          status: adapterStatus.status,
          parserHandoff: adapterStatus.parserHandoff.status,
          blockedGate: adapterStatus.parserHandoff.blockedGate,
        }),
        status: adapterStatus.parserHandoff.accepted ? "accepted" : adapterStatus.parserHandoff.status,
        nextAction: adapterStatus.nextAction,
      }),
    ],
  });
  const handoffEvidence = createTokenStreamHandoffEvidencePacket(stream, {
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
    acceptedBy: options.acceptedBy,
    reason: options.reason ?? "parser-provider-handoff-evidence",
  });
  const mailchimpDecision = profile.provider === "mailchimp"
    ? createTokenStreamMailchimpHandoffDecision(stream, {
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
        acceptedBy: options.acceptedBy,
        adapterStatus,
        handoffEvidence,
        restartJournal,
        reason: options.reason ?? "parser-provider-mailchimp-decision",
      })
    : null;
  const mailchimpReadinessLedger = profile.provider === "mailchimp"
    ? createTokenStreamMailchimpReadinessLedger(stream, {
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
        acceptedBy: options.acceptedBy,
        idempotencyKey: options.idempotencyKey,
        serviceContract,
        acceptanceSummary: previewAcceptance,
        adapterStatus,
        handoffEvidence,
        mailchimpDecision,
        restartJournal,
        reason: options.reason ?? "parser-provider-mailchimp-readiness-ledger",
      })
    : null;
  const clientHandoffPacket = createTokenStreamClientHandoffPacket(stream, {
    ...options,
    adapter,
    provider: profile.provider,
    operation: profile.operation,
    permissions: grantedPermissions,
    requiredPermissions: profile.requiredPermissions,
    requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    acceptedBy: options.acceptedBy,
    enabled: lifecycle?.settings?.enabled ?? options.enabled,
    serviceContract,
    acceptanceSummary: previewAcceptance,
    adapterStatus,
    handoffEvidence,
    mailchimpDecision,
    restartJournal,
    reason: options.reason ?? "parser-provider-client-handoff-packet",
  });
  const executionIntent = createTokenStreamExecutionIntentPacket(stream, {
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
    acceptedBy: options.acceptedBy,
    serviceContract,
    restartJournal,
    idempotencyKey: options.idempotencyKey,
    clientRoute: options.clientRoute ?? "parser-provider-handoff",
    reason: options.reason ?? "parser-provider-execution-intent",
  });
  const handoffReceipt = createTokenStreamProviderHandoffReceipt(stream, {
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
    acceptedBy: options.acceptedBy,
    serviceContract,
    restartJournal,
    executionIntent,
    mailchimpDecision,
    reason: options.reason ?? "parser-provider-handoff-receipt",
  });
  const externalStatusReceipt = createTokenStreamExternalProviderStatusReceipt(stream, {
    ...options,
    adapter,
    provider: profile.provider,
    operation: profile.operation,
    permissions: grantedPermissions,
    requiredPermissions: profile.requiredPermissions,
    requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    handoffReceipt,
    statusEvents: options.externalStatusEvents,
    reason: options.reason ?? "parser-provider-external-status-receipt",
  });
  const resumptionManifest = createTokenStreamResumptionManifest(stream, {
    ...options,
    adapter,
    provider: profile.provider,
    operation: profile.operation,
    permissions: grantedPermissions,
    requiredPermissions: profile.requiredPermissions,
    requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    restartJournal,
    health,
    analytics,
    clientHandoffPacket,
    reason: options.reason ?? "parser-provider-resumption-manifest",
  });
  const lifecycleExportReadiness = createTokenStreamExportReadinessManifest(stream, {
    ...options,
    adapter,
    provider: profile.provider,
    operation: profile.operation,
    permissions: grantedPermissions,
    requiredPermissions: profile.requiredPermissions,
    requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    restartJournal,
    mailchimpReadinessLedger,
    reason: options.reason ?? "parser-provider-lifecycle-export-readiness",
  });
  const providerLifecycle = createTokenStreamProviderLifecycleManifest(stream, {
    ...options,
    adapter,
    provider: profile.provider,
    operation: profile.operation,
    permissions: grantedPermissions,
    requiredPermissions: profile.requiredPermissions,
    requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
    acceptedBy: options.acceptedBy,
    lifecycleEnabled: lifecycle?.settings?.enabled ?? options.enabled,
    lifecycleSchedule: lifecycle?.settings?.schedule ?? options.lifecycleSchedule ?? options.schedule,
    lifecycleMode: lifecycle?.settings?.mode ?? options.lifecycleMode ?? options.mode,
    maxAttempts: lifecycle?.settings?.maxAttempts ?? options.maxAttempts,
    retryAfterMs: lifecycle?.settings?.retryAfterMs ?? options.retryAfterMs,
    scheduledAt: options.scheduledAt,
    serviceContract,
    restartJournal,
    exportReadinessManifest: lifecycleExportReadiness,
    reason: options.reason ?? "parser-provider-lifecycle",
  });
  const mailchimpExportLedger = profile.provider === "mailchimp"
    ? createTokenStreamMailchimpExportLedger(stream, {
        ...options,
        adapter,
        provider: profile.provider,
        operation: profile.operation,
        permissions: grantedPermissions,
        requiredPermissions: profile.requiredPermissions,
        requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
        auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
        statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
        acceptedBy: options.acceptedBy,
        acceptanceSummary: previewAcceptance,
        restartJournal,
        exportReadinessManifest: lifecycleExportReadiness,
        reason: options.reason ?? "parser-provider-mailchimp-export-ledger",
      })
    : null;
  const mailchimpRecoveryEnvelope = profile.provider === "mailchimp"
    ? createTokenStreamMailchimpRecoveryEnvelope(stream, {
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
        acceptedBy: options.acceptedBy,
        idempotencyKey: options.idempotencyKey,
        health,
        analytics,
        restartJournal,
        resumptionManifest,
        exportReadinessManifest: lifecycleExportReadiness,
        mailchimpReadinessLedger,
        reason: options.reason ?? "parser-provider-mailchimp-recovery-envelope",
      })
    : null;
  const operatorGate = profile.provider === "mailchimp"
    ? createTokenStreamMailchimpOperatorGate(stream, {
        ...options,
        adapter,
        provider: profile.provider,
        operation: profile.operation,
        permissions: grantedPermissions,
        requiredPermissions: profile.requiredPermissions,
        auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
        statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
        acceptedBy: options.acceptedBy,
        enabled: lifecycle?.settings?.enabled ?? options.enabled,
        scheduledAt: options.scheduledAt,
        mode: lifecycle?.settings?.schedule === "disabled"
          ? "disabled"
          : lifecycle?.settings?.schedule === "manual"
            ? "manual"
            : options.scheduledAt
              ? "scheduled"
              : options.mode ?? "preview",
        dryRun: options.dryRun,
        allowMutatingSync: options.allowMutatingSync,
        idempotencyKey: options.idempotencyKey,
        acceptanceSummary: previewAcceptance,
        reason: options.reason ?? "parser-provider-mailchimp-operator-gate",
      })
    : null;
  const mailchimpControlPlane = profile.provider === "mailchimp"
    ? createTokenStreamMailchimpControlPlane(stream, {
        ...options,
        adapter,
        provider: profile.provider,
        operation: profile.operation,
        permissions: grantedPermissions,
        requiredPermissions: profile.requiredPermissions,
        requestedCapabilities: options.requestedCapabilities ?? profile.supportedCapabilities,
        auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
        statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
        acceptedBy: options.acceptedBy,
        enabled: lifecycle?.settings?.enabled ?? options.enabled,
        mailchimpEnabled: lifecycle?.settings?.enabled ?? options.enabled,
        mode: lifecycle?.settings?.schedule === "disabled"
          ? "disabled"
          : lifecycle?.settings?.schedule === "manual"
            ? "manual"
            : options.scheduledAt
              ? "scheduled"
              : options.mode ?? "preview",
        scheduledAt: options.scheduledAt,
        dryRun: options.dryRun,
        allowMutatingSync: options.allowMutatingSync,
        idempotencyKey: options.idempotencyKey,
        serviceContract,
        lifecycleManifest: providerLifecycle,
        operatorGate,
        acceptanceSummary: previewAcceptance,
        reason: options.reason ?? "parser-provider-mailchimp-control-plane",
      })
    : null;
  const clientState = createParserProviderClientState(adapter, stream, serviceContract, lifecycle, mailchimpAdoption, operatorGate);
  const boundaryIncident = createTokenStreamBoundaryIncidentReport(stream, {
    ...options,
    requiredPermissions: profile.requiredPermissions,
    permissions: grantedPermissions,
    auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
  });
  const persistedHandoffState = createPersistedProviderHandoffState(
    adapter,
    stream,
    profile,
    negotiation,
    serviceContract,
    health,
    lifecycle,
    mailchimpAdoption,
    restartJournal,
  );
  const mailchimpReadinessGate = createParserMailchimpReadinessGate(
    adapter,
    stream,
    profile,
    lifecycle,
    mailchimpReadinessLedger,
    options,
  );
  const streamReady = health.ok && analytics.ok;
  const accepted = Boolean(adapter)
    && streamReady
    && !boundaryIncident.blocked
    && negotiation.accepted
    && serviceContract.acceptance.accepted
    && adapterStatus.parserHandoff.accepted
    && clientState.ready
    && persistedHandoffState.restartSafe
    && handoffEvidence.accepted
    && clientHandoffPacket.accepted
    && executionIntent.accepted
    && handoffReceipt.accepted
    && externalStatusReceipt.accepted
    && resumptionManifest.ready
    && providerLifecycle.accepted
    && (!mailchimpExportLedger || mailchimpExportLedger.accepted)
    && (!clientRuntimeAdoption || clientRuntimeAdoption.accepted)
    && mailchimpReadinessGate.accepted
    && (!operatorGate || operatorGate.accepted)
    && (!mailchimpControlPlane || mailchimpControlPlane.accepted)
    && (!mailchimpRecoveryEnvelope || mailchimpRecoveryEnvelope.accepted || mailchimpRecoveryEnvelope.recovery.degradedAllowed)
    && (!mailchimpDecision || mailchimpDecision.accepted);

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
      boundaryIncident,
      retry: health.retry,
      nextAction: health.nextAction,
    }),
    analytics: analytics.exportSummary,
    sync,
    adapterStatus,
    restartJournal,
    handoffEvidence,
    mailchimpDecision,
    mailchimpReadinessLedger,
    mailchimpReadinessGate,
    operatorGate,
    mailchimpControlPlane,
    mailchimpRecoveryEnvelope,
    clientHandoffPacket,
    clientRuntimeAdoption,
    executionIntent,
    handoffReceipt,
    externalStatusReceipt,
    resumptionManifest,
    providerLifecycle,
    mailchimpExportLedger,
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
          : boundaryIncident.blocked
            ? boundaryIncident.status
          : !streamReady
            ? "stream-review"
            : !adapterStatus.parserHandoff.accepted
            ? adapterStatus.parserHandoff.status
            : !clientHandoffPacket.accepted
              ? clientHandoffPacket.status
            : mailchimpDecision && !mailchimpDecision.accepted
            ? mailchimpDecision.status
            : clientRuntimeAdoption && !clientRuntimeAdoption.accepted
            ? clientRuntimeAdoption.status
            : operatorGate && !operatorGate.accepted
            ? operatorGate.status
            : mailchimpControlPlane && !mailchimpControlPlane.accepted
            ? mailchimpControlPlane.status
            : !mailchimpReadinessGate.accepted
            ? mailchimpReadinessGate.status
            : mailchimpRecoveryEnvelope && !mailchimpRecoveryEnvelope.accepted && !mailchimpRecoveryEnvelope.recovery.degradedAllowed
            ? mailchimpRecoveryEnvelope.status
            : !executionIntent.accepted
              ? executionIntent.status
            : !handoffReceipt.accepted
              ? handoffReceipt.status
            : !externalStatusReceipt.accepted
              ? externalStatusReceipt.status
            : !resumptionManifest.ready
              ? resumptionManifest.status
            : !providerLifecycle.accepted
              ? providerLifecycle.status
            : mailchimpExportLedger && !mailchimpExportLedger.accepted
              ? mailchimpExportLedger.status
            : !handoffEvidence.accepted
              ? handoffEvidence.status
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
        : boundaryIncident.blocked
          ? boundaryIncident.nextAction
        : !streamReady
          ? health.nextAction
        : !adapterStatus.parserHandoff.accepted
          ? adapterStatus.nextAction
          : !clientHandoffPacket.accepted
            ? clientHandoffPacket.nextAction
          : mailchimpDecision && !mailchimpDecision.accepted
            ? mailchimpDecision.nextAction
          : clientRuntimeAdoption && !clientRuntimeAdoption.accepted
            ? clientRuntimeAdoption.nextAction
          : operatorGate && !operatorGate.accepted
            ? operatorGate.nextAction
          : mailchimpControlPlane && !mailchimpControlPlane.accepted
            ? mailchimpControlPlane.nextAction
          : !mailchimpReadinessGate.accepted
            ? mailchimpReadinessGate.nextAction
          : mailchimpRecoveryEnvelope && !mailchimpRecoveryEnvelope.accepted && !mailchimpRecoveryEnvelope.recovery.degradedAllowed
            ? mailchimpRecoveryEnvelope.nextAction
          : !executionIntent.accepted
            ? executionIntent.nextAction
          : !handoffReceipt.accepted
            ? handoffReceipt.nextAction
          : !externalStatusReceipt.accepted
            ? externalStatusReceipt.nextAction
            : !resumptionManifest.ready
              ? resumptionManifest.nextAction
          : !providerLifecycle.accepted
            ? providerLifecycle.nextAction
          : mailchimpExportLedger && !mailchimpExportLedger.accepted
            ? mailchimpExportLedger.nextAction
          : !handoffEvidence.accepted
            ? handoffEvidence.nextAction
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
        : boundaryIncident.blocked
          ? boundaryIncident.nextAction
        : !streamReady
          ? health.nextAction
          : !adapterStatus.parserHandoff.accepted
            ? adapterStatus.nextAction
          : !clientHandoffPacket.accepted
            ? clientHandoffPacket.nextAction
          : mailchimpDecision && !mailchimpDecision.accepted
            ? mailchimpDecision.nextAction
          : clientRuntimeAdoption && !clientRuntimeAdoption.accepted
            ? clientRuntimeAdoption.nextAction
          : operatorGate && !operatorGate.accepted
            ? operatorGate.nextAction
          : mailchimpControlPlane && !mailchimpControlPlane.accepted
            ? mailchimpControlPlane.nextAction
          : !mailchimpReadinessGate.accepted
            ? mailchimpReadinessGate.nextAction
          : mailchimpRecoveryEnvelope && !mailchimpRecoveryEnvelope.accepted && !mailchimpRecoveryEnvelope.recovery.degradedAllowed
            ? mailchimpRecoveryEnvelope.nextAction
          : !executionIntent.accepted
            ? executionIntent.nextAction
          : !handoffReceipt.accepted
            ? handoffReceipt.nextAction
          : !externalStatusReceipt.accepted
            ? externalStatusReceipt.nextAction
            : !resumptionManifest.ready
              ? resumptionManifest.nextAction
          : !providerLifecycle.accepted
            ? providerLifecycle.nextAction
          : mailchimpExportLedger && !mailchimpExportLedger.accepted
            ? mailchimpExportLedger.nextAction
          : !handoffEvidence.accepted
            ? handoffEvidence.nextAction
          : !persistedHandoffState.restartSafe
            ? persistedHandoffState.nextAction
          : !serviceContract.acceptance.accepted
            ? serviceContract.acceptance.nextAction
          : negotiation.nextAction,
  });
}

function previewStage(label, status, accepted, nextAction, details = {}) {
  return Object.freeze({
    schema: "aios.parser.provider-preview.stage.v1",
    label,
    accepted: Boolean(accepted),
    status,
    nextAction,
    details: Object.freeze(details),
  });
}

function firstPreviewBlocker(stages) {
  return Array.from(stages ?? []).find((stage) => !stage.accepted) ?? null;
}

export function createParserProviderPreviewEnvelope(adapterOrHead, stream, options = {}) {
  const handoff = options.providerHandoff ?? createProviderHandoffContract(adapterOrHead, stream, {
    ...options,
    reason: options.reason ?? "parser-provider-preview-envelope",
  });
  const readiness = handoff.serviceContract
    ? createTokenStreamProviderReadinessPreview(stream, {
        ...options,
        adapter: handoff.adapter,
        provider: handoff.provider,
        operation: handoff.operation,
        permissions: handoff.negotiation.grantedPermissions,
        requiredPermissions: handoff.profile.requiredPermissions,
        requestedCapabilities: handoff.profile.supportedCapabilities,
        auditChannel: options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
        statusChannel: options.statusChannel ?? options.auditChannel ?? stream?.metadata?.auditChannel ?? null,
        acceptedBy: options.acceptedBy,
        serviceContract: handoff.serviceContract,
        reason: options.reason ?? "parser-provider-preview-readiness",
      })
    : null;
  const acceptance = handoff.previewAcceptance
    ?? (readiness
      ? createTokenStreamProviderAcceptanceSummary(stream, {
          ...options,
          readinessPreview: readiness,
          reason: options.reason ?? "parser-provider-preview-acceptance",
        })
      : null);
  const stages = Object.freeze([
    previewStage("token-stream", handoff.streamHealth.status, handoff.streamHealth.ok, handoff.streamHealth.nextAction, {
      cursor: handoff.streamHealth.cursor,
      retry: handoff.streamHealth.retry,
      boundaryStatus: handoff.streamHealth.boundary?.status ?? null,
    }),
    previewStage("capability-negotiation", handoff.negotiation.status, handoff.negotiation.accepted, handoff.negotiation.nextAction, {
      requestedCapabilities: handoff.negotiation.requestedCapabilities,
      unsupportedCapabilities: handoff.negotiation.unsupportedCapabilities,
      missingPermissions: handoff.negotiation.missingPermissions,
    }),
    previewStage("acceptance", acceptance?.status ?? handoff.acceptanceSummary.status, acceptance?.accepted ?? handoff.acceptanceSummary.accepted, acceptance?.nextAction ?? handoff.acceptanceSummary.nextAction, {
      missing: acceptance?.validationSummary?.missing ?? handoff.acceptanceSummary.validationSummary.missing,
      controls: acceptance?.controls ?? handoff.acceptanceSummary.controls,
    }),
    previewStage("operator-gate", handoff.operatorGate?.status ?? "not-required", handoff.operatorGate ? handoff.operatorGate.accepted : true, handoff.operatorGate?.nextAction ?? "continue", {
      mode: handoff.operatorGate?.mode ?? null,
      missing: handoff.operatorGate?.validationSummary?.missing ?? Object.freeze([]),
    }),
    previewStage("resumption", handoff.resumptionManifest.status, handoff.resumptionManifest.ready, handoff.resumptionManifest.nextAction, {
      manifestId: handoff.resumptionManifest.manifestId,
      blockedGates: handoff.resumptionManifest.blockedGates,
    }),
    previewStage("external-handoff", handoff.externalHandoff.status, handoff.externalHandoff.accepted, handoff.externalHandoff.nextAction, {
      retryable: handoff.externalHandoff.retryable,
      retryAfterMs: handoff.externalHandoff.retryAfterMs,
    }),
  ]);
  const blocker = firstPreviewBlocker(stages);
  const missing = Object.freeze([...new Set([
    ...stages.filter((stage) => !stage.accepted).map((stage) => stage.label),
    ...Array.from(acceptance?.validationSummary?.missing ?? handoff.acceptanceSummary.validationSummary.missing ?? []),
    ...Array.from(handoff.persistedHandoffState?.missing ?? []),
    ...Array.from(handoff.mailchimpReadinessGate?.missing ?? []),
  ].filter(Boolean))].sort());
  const ready = !blocker && missing.length === 0 && handoff.externalHandoff.accepted;
  const envelopeId = [
    "parser-provider-preview",
    handoff.provider,
    handoff.operation,
    stream?.metadata?.sourceId ?? "anonymous-source",
    handoff.sync?.syncKey ?? "sync",
    ready ? "ready" : "review",
  ].map((part) => String(part ?? "none").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");

  return Object.freeze({
    schema: "aios.parser.provider-preview-envelope.v1",
    envelopeId,
    sourceId: stream?.metadata?.sourceId ?? null,
    provider: handoff.provider,
    operation: handoff.operation,
    adapter: handoff.adapter,
    ready,
    status: ready ? "provider-preview-ready" : blocker?.status ?? handoff.externalHandoff.status,
    preview: Object.freeze({
      tokenWindow: handoff.serviceContract.preview.tokenWindow,
      requiredPermissions: handoff.profile.requiredPermissions,
      missingPermissions: handoff.negotiation.missingPermissions,
      statusChannel: handoff.serviceContract.acceptance.statusChannel,
      audit: handoff.serviceContract.acceptance.audit,
      syncKey: handoff.sync.syncKey,
    }),
    stages,
    validationSummary: Object.freeze({
      tokenStreamReady: handoff.streamHealth.ok,
      capabilityReady: handoff.negotiation.accepted,
      acceptanceReady: acceptance?.accepted ?? handoff.acceptanceSummary.accepted,
      operatorReady: handoff.operatorGate ? handoff.operatorGate.accepted : true,
      resumptionReady: handoff.resumptionManifest.ready,
      externalHandoffReady: handoff.externalHandoff.accepted,
      missing,
      blockedStage: blocker?.label ?? null,
    }),
    controls: Object.freeze({
      canPreview: Boolean(handoff.adapter) && handoff.streamHealth.ok,
      canAccept: Boolean(acceptance?.controls?.canAccept ?? handoff.acceptanceSummary.controls.canAccept),
      canSchedule: Boolean(acceptance?.controls?.canSchedule ?? handoff.acceptanceSummary.controls.canSchedule),
      canHandoff: ready,
      canEmitStatus: Boolean(handoff.serviceContract.acceptance.statusChannel),
      canExportAudit: Boolean(handoff.serviceContract.acceptance.audit.channel),
    }),
    nextStep: Object.freeze({
      label: ready ? "provider-handoff" : blocker?.label ?? "provider-preview",
      action: ready ? "handoff-provider" : blocker?.nextAction ?? handoff.nextAction,
      requiresOperator: !ready && ["acceptance", "operator-gate"].includes(blocker?.label),
      retryable: !ready && (blocker?.label === "token-stream" || handoff.externalHandoff.retryable),
    }),
    exportSummary: Object.freeze({
      envelopeId,
      status: ready ? "provider-preview-ready" : "provider-preview-review",
      provider: handoff.provider,
      operation: handoff.operation,
      blockedStage: blocker?.label ?? null,
      missing,
      nextAction: ready ? "handoff-provider" : blocker?.nextAction ?? handoff.nextAction,
    }),
    providerHandoff: handoff,
    nextAction: ready ? "handoff-provider" : blocker?.nextAction ?? handoff.nextAction,
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
  const resumptionStatus = latestStream
    ? createTokenStreamResumptionStatusEnvelope(latestStream, {
        ...options,
        adapter: options.adapter ?? provider?.adapter ?? null,
        provider: provider?.provider ?? (options.adapter ? providerName(options.adapter) : "runtime"),
        operation: provider?.operation ?? (options.adapter ? providerOperation(options.adapter) : "run"),
        permissions: options.permissions ?? latestStream?.metadata?.permissions ?? [],
        requiredPermissions: provider?.profile?.requiredPermissions ?? options.requiredPermissions ?? [],
        auditChannel: options.auditChannel ?? latestStream?.metadata?.auditChannel ?? null,
        statusChannel: options.statusChannel ?? options.auditChannel ?? latestStream?.metadata?.auditChannel ?? null,
        restartJournal: provider?.restartJournal,
        health,
        analytics,
        resumptionManifest: provider?.resumptionManifest,
        reason: options.reason ?? "parser-export-resumption-status",
      })
    : null;
  const nextActionQueue = latestStream
    ? createTokenStreamNextActionQueue(latestStream, [
        Object.freeze({
          source: "parser-timeline",
          status: timeline.status,
          ok: timeline.ok,
          blocked: !timeline.ok,
          retryable: timeline.events.some((event) => event.retryable),
          nextAction: timeline.nextAction,
          cursor: timeline.exportSummary.cursor,
        }),
        health
          ? Object.freeze({
              source: "parser-token-health",
              status: health.status,
              ok: health.ok,
              blocked: !health.ok,
              retryable: health.retry.maxAttempts > 0,
              nextAction: health.nextAction,
              cursor: health.cursor,
              audit: health.boundary.audit,
              tenantBoundary: health.tenantBoundaryReadiness?.exportSummary ?? null,
            })
          : null,
        analytics
          ? Object.freeze({
              source: "parser-token-analytics",
              status: analytics.exportSummary.status,
              ok: analytics.ok,
              blocked: !analytics.ok,
              nextAction: analytics.nextAction,
              cursor: analytics.exportSummary.cursor,
            })
          : null,
        provider
          ? Object.freeze({
              source: "parser-provider-handoff",
              status: provider.externalHandoff.status,
              accepted: provider.externalHandoff.accepted,
              blocked: !provider.externalHandoff.accepted,
              retryable: provider.externalHandoff.retryable,
              nextAction: provider.externalHandoff.nextAction,
              cursor: provider.sync.cursor,
              audit: Object.freeze({
                channel: provider.sync.statusChannel,
              }),
            })
          : null,
        commandAudit
          ? Object.freeze({
              source: "parser-command-audit",
              status: commandAudit.status,
              ok: commandAudit.ok,
              blocked: !commandAudit.ok,
              retryable: commandAudit.controls.canRetryFromCheckpoint,
              nextAction: commandAudit.nextAction,
              cursor: commandAudit.checkpoint.cursor,
              audit: commandAudit.boundary.audit,
            })
          : null,
        resumptionStatus
          ? Object.freeze({
              source: "parser-resumption-status",
              status: resumptionStatus.status,
              accepted: resumptionStatus.ready,
              blocked: !resumptionStatus.ready,
              retryable: resumptionStatus.controls.canRetry,
              nextAction: resumptionStatus.nextAction,
              cursor: resumptionStatus.cursor.current,
              audit: Object.freeze({
                channel: resumptionStatus.channels.audit,
              }),
              references: Object.freeze({
                envelopeId: resumptionStatus.envelopeId,
                manifestId: resumptionStatus.restore.manifestId,
                journalId: resumptionStatus.restore.journalId,
              }),
            })
          : null,
      ].filter(Boolean), {
        ...options,
        reason: options.reason ?? "parser-export-next-action-queue",
        requiredPermissions: provider?.profile?.requiredPermissions ?? options.requiredPermissions ?? [],
      })
    : null;
  const failed = timeline.events.filter((event) => !event.ok);
  const operationsPacket = latestStream
    ? createTokenStreamOperationsPacket(latestStream, [
        Object.freeze({
          source: "parser-timeline",
          status: timeline.status,
          accepted: timeline.ok,
          blocked: !timeline.ok,
          retryable: timeline.events.some((event) => event.retryable),
          nextAction: timeline.nextAction,
          cursor: timeline.exportSummary.cursor,
          references: Object.freeze({
            failedCount: failed.length,
            diagnosticCount: timeline.counters.diagnostics,
          }),
        }),
        health
          ? Object.freeze({
              source: "parser-token-health",
              status: health.status,
              accepted: health.ok,
              blocked: !health.ok,
              retryable: health.retry.maxAttempts > 0,
              nextAction: health.nextAction,
              cursor: health.cursor,
              audit: health.boundary.audit,
            })
          : null,
        provider
          ? Object.freeze({
              source: "parser-provider-handoff",
              status: provider.externalHandoff.status,
              accepted: provider.externalHandoff.accepted,
              blocked: !provider.externalHandoff.accepted,
              retryable: provider.externalHandoff.retryable,
              nextAction: provider.externalHandoff.nextAction,
              cursor: provider.sync.cursor,
              audit: Object.freeze({
                channel: provider.sync.statusChannel,
              }),
              references: Object.freeze({
                provider: provider.provider,
                operation: provider.operation,
                stateKey: provider.persistedHandoffState.stateKey,
              }),
            })
          : null,
        commandAudit
          ? Object.freeze({
              source: "parser-command-audit",
              status: commandAudit.status,
              accepted: commandAudit.ok,
              blocked: !commandAudit.ok,
              retryable: commandAudit.controls.canRetryFromCheckpoint,
              nextAction: commandAudit.nextAction,
              cursor: commandAudit.checkpoint.cursor,
              audit: commandAudit.boundary.audit,
            })
          : null,
        resumptionStatus
          ? Object.freeze({
              source: "parser-resumption-status",
              status: resumptionStatus.status,
              accepted: resumptionStatus.ready,
              blocked: !resumptionStatus.ready,
              retryable: resumptionStatus.controls.canRetry,
              nextAction: resumptionStatus.nextAction,
              cursor: resumptionStatus.cursor.current,
              audit: Object.freeze({
                channel: resumptionStatus.channels.audit,
              }),
              references: Object.freeze({
                envelopeId: resumptionStatus.envelopeId,
                phase: resumptionStatus.phase,
                replaySafe: resumptionStatus.replaySafe,
              }),
            })
          : null,
      ].filter(Boolean), {
        ...options,
        reason: options.reason ?? "parser-export-operations-packet",
        requiredPermissions: provider?.profile?.requiredPermissions ?? options.requiredPermissions ?? [],
        health,
        analytics,
        restartJournal: provider?.restartJournal,
        nextActionQueue,
      })
    : null;
  const operatorDecisionLane = latestStream
    ? createTokenStreamOperatorDecisionLane(latestStream, [
        Object.freeze({
          source: "parser-timeline",
          status: timeline.status,
          accepted: timeline.ok,
          blocked: !timeline.ok,
          retryable: timeline.events.some((event) => event.retryable),
          nextAction: timeline.nextAction,
          cursor: timeline.exportSummary.cursor,
        }),
        health
          ? Object.freeze({
              source: "parser-token-health",
              status: health.status,
              accepted: health.ok,
              blocked: !health.ok,
              retryable: health.retry.maxAttempts > 0,
              nextAction: health.nextAction,
              cursor: health.cursor,
              audit: health.boundary.audit,
            })
          : null,
        provider
          ? Object.freeze({
              source: "parser-provider-handoff",
              status: provider.externalHandoff.status,
              accepted: provider.externalHandoff.accepted,
              blocked: !provider.externalHandoff.accepted,
              retryable: provider.externalHandoff.retryable,
              nextAction: provider.externalHandoff.nextAction,
              cursor: provider.sync.cursor,
              audit: Object.freeze({
                channel: provider.sync.statusChannel,
              }),
            })
          : null,
        commandAudit
          ? Object.freeze({
              source: "parser-command-audit",
              status: commandAudit.status,
              accepted: commandAudit.ok,
              blocked: !commandAudit.ok,
              retryable: commandAudit.controls.canRetryFromCheckpoint,
              nextAction: commandAudit.nextAction,
              cursor: commandAudit.checkpoint.cursor,
              audit: commandAudit.boundary.audit,
            })
          : null,
        resumptionStatus
          ? Object.freeze({
              source: "parser-resumption-status",
              status: resumptionStatus.status,
              accepted: resumptionStatus.ready,
              blocked: !resumptionStatus.ready,
              retryable: resumptionStatus.controls.canRetry,
              nextAction: resumptionStatus.nextAction,
              cursor: resumptionStatus.cursor.current,
              audit: Object.freeze({
                channel: resumptionStatus.channels.audit,
              }),
            })
          : null,
        operationsPacket
          ? Object.freeze({
              source: "parser-operations-packet",
              status: operationsPacket.status,
              accepted: operationsPacket.ready,
              blocked: !operationsPacket.ready,
              retryable: operationsPacket.counters.retryable > 0,
              nextAction: operationsPacket.nextAction,
              cursor: operationsPacket.recovery.checkpointCursor,
              audit: Object.freeze({
                channel: operationsPacket.audit.channels[0] ?? null,
              }),
            })
          : null,
      ].filter(Boolean), {
        ...options,
        adapter: options.adapter ?? provider?.adapter ?? "runtime.run",
        provider: provider?.provider ?? (options.adapter ? providerName(options.adapter) : "runtime"),
        operation: provider?.operation ?? (options.adapter ? providerOperation(options.adapter) : "run"),
        mode: provider ? "handoff" : "preview",
        acceptedBy: options.acceptedBy,
        enabled: options.enabled,
        statusChannel: options.statusChannel ?? provider?.sync.statusChannel ?? null,
        auditChannel: options.auditChannel ?? provider?.sync.statusChannel ?? null,
        scheduledAt: options.scheduledAt,
        nextActionQueue,
        reason: options.reason ?? "parser-export-operator-decision-lane",
      })
    : null;
  const ready = timeline.ok
    && (!health || health.ok)
    && (!analytics || analytics.ok)
    && (!provider || provider.externalHandoff.accepted)
    && (!commandAudit || commandAudit.ok)
    && (!resumptionStatus || resumptionStatus.ready)
    && (!nextActionQueue || nextActionQueue.ready)
    && (!operationsPacket || operationsPacket.ready)
    && (!operatorDecisionLane || operatorDecisionLane.ready);
  const firstBlocker = !timeline.ok
    ? timeline.events.find((event) => !event.ok)
    : health && !health.ok
      ? health
      : provider && !provider.externalHandoff.accepted
        ? provider.externalHandoff
        : commandAudit && !commandAudit.ok
          ? commandAudit
          : resumptionStatus && !resumptionStatus.ready
            ? resumptionStatus
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
            : commandAudit && !commandAudit.ok
              ? commandAudit.status
              : resumptionStatus && !resumptionStatus.ready
                ? resumptionStatus.status
                : "review",
    counters: Object.freeze({
      eventCount: timeline.eventCount,
      failedCount: failed.length,
      diagnosticCount: timeline.counters.diagnostics,
      recoveryCommandCount: recoveryCommands.length,
      commandAuditBlockedCount: commandAudit?.exportSummary.blockedCount ?? 0,
      resumptionBlockedCount: resumptionStatus?.counters.blockedGates ?? 0,
    }),
    timeline,
    health: health
      ? Object.freeze({
          ok: health.ok,
          status: health.status,
          cursor: health.cursor,
          tenantBoundaryReadiness: health.tenantBoundaryReadiness?.exportSummary ?? null,
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
          handoffEvidence: provider.handoffEvidence.exportSummary.status,
          handoffEvidenceReady: provider.handoffEvidence.accepted,
          handoffEvidenceId: provider.handoffEvidence.evidenceId,
          mailchimpDecision: provider.mailchimpDecision?.exportSummary.status ?? "not-required",
          mailchimpDecisionReady: provider.mailchimpDecision?.accepted ?? true,
          mailchimpDecisionId: provider.mailchimpDecision?.decisionId ?? null,
          mailchimpRecoveryEnvelope: provider.mailchimpRecoveryEnvelope?.exportSummary.status ?? "not-required",
          mailchimpRecoveryReady: provider.mailchimpRecoveryEnvelope?.accepted ?? true,
          mailchimpRecoveryEnvelopeId: provider.mailchimpRecoveryEnvelope?.envelopeId ?? null,
          mailchimpRecoveryDegraded: provider.mailchimpRecoveryEnvelope?.recovery.degradedAllowed ?? false,
          mailchimpOperatorGate: provider.operatorGate?.exportSummary.status ?? "not-required",
          mailchimpOperatorGateReady: provider.operatorGate?.accepted ?? true,
          mailchimpOperatorGateId: provider.operatorGate?.gateId ?? null,
          mailchimpControlPlane: provider.mailchimpControlPlane?.exportSummary.status ?? "not-required",
          mailchimpControlPlaneReady: provider.mailchimpControlPlane?.accepted ?? true,
          mailchimpControlPlaneId: provider.mailchimpControlPlane?.controlId ?? null,
          clientRuntimeAdoption: provider.clientRuntimeAdoption?.exportSummary.status ?? "not-required",
          clientRuntimeAdoptionReady: provider.clientRuntimeAdoption?.accepted ?? true,
          clientRuntimeAdoptionId: provider.clientRuntimeAdoption?.snapshotId ?? null,
          executionIntent: provider.executionIntent.exportSummary.status,
          executionIntentReady: provider.executionIntent.accepted,
          executionIntentId: provider.executionIntent.intentKey,
          handoffReceipt: provider.handoffReceipt.exportSummary.status,
          handoffReceiptReady: provider.handoffReceipt.accepted,
          handoffReceiptId: provider.handoffReceipt.receiptId,
          externalStatusReceipt: provider.externalStatusReceipt.exportSummary.status,
          externalStatusReceiptReady: provider.externalStatusReceipt.accepted,
          externalStatusReceiptId: provider.externalStatusReceipt.receiptId,
          externalStatusEventCount: provider.externalStatusReceipt.counters.total,
          externalStatusPendingCount: provider.externalStatusReceipt.counters.pending,
          resumptionManifest: provider.resumptionManifest.exportSummary.status,
          resumptionManifestReady: provider.resumptionManifest.ready,
          resumptionManifestId: provider.resumptionManifest.manifestId,
          mailchimpExportLedger: provider.mailchimpExportLedger?.exportSummary.status ?? "not-required",
          mailchimpExportLedgerReady: provider.mailchimpExportLedger?.accepted ?? true,
          mailchimpExportLedgerId: provider.mailchimpExportLedger?.ledgerId ?? null,
          stateKey: provider.persistedHandoffState.stateKey,
          nextAction: provider.nextAction,
        })
      : null,
    commandAudit: commandAudit?.exportSummary ?? null,
    resumptionStatus: resumptionStatus
      ? Object.freeze({
          envelopeId: resumptionStatus.envelopeId,
          status: resumptionStatus.status,
          phase: resumptionStatus.phase,
          ready: resumptionStatus.ready,
          replaySafe: resumptionStatus.replaySafe,
          cursor: resumptionStatus.cursor,
          restore: Object.freeze({
            journalId: resumptionStatus.restore.journalId,
            manifestId: resumptionStatus.restore.manifestId,
            restartSafe: resumptionStatus.restore.restartSafe,
            blockedEntryIds: resumptionStatus.restore.blockedEntryIds,
          }),
          channels: resumptionStatus.channels,
          counters: resumptionStatus.counters,
          controls: resumptionStatus.controls,
          exportSummary: resumptionStatus.exportSummary,
          nextAction: resumptionStatus.nextAction,
        })
      : null,
    nextActionQueue: nextActionQueue
      ? Object.freeze({
          status: nextActionQueue.status,
          ready: nextActionQueue.ready,
          counters: nextActionQueue.counters,
          items: nextActionQueue.items,
          exportSummary: nextActionQueue.exportSummary,
          nextAction: nextActionQueue.nextAction,
        })
      : null,
    operationsPacket: operationsPacket
      ? Object.freeze({
          packetId: operationsPacket.packetId,
          status: operationsPacket.status,
          ready: operationsPacket.ready,
          counters: operationsPacket.counters,
          recovery: operationsPacket.recovery,
          audit: operationsPacket.audit,
          exportSummary: operationsPacket.exportSummary,
          nextAction: operationsPacket.nextAction,
        })
      : null,
    operatorDecisionLane: operatorDecisionLane
      ? Object.freeze({
          status: operatorDecisionLane.status,
          ready: operatorDecisionLane.ready,
          mode: operatorDecisionLane.mode,
          decision: operatorDecisionLane.decision,
          lanes: operatorDecisionLane.lanes,
          exportSummary: operatorDecisionLane.exportSummary,
          nextAction: operatorDecisionLane.nextAction,
        })
      : null,
    controls: Object.freeze({
      canExport: ready,
      canRetryParser: failed.some((event) => event.retryable),
      canReplayRecoveryCommands: Boolean(commandAudit?.controls.canApply),
      canResumeFromStatusEnvelope: Boolean(resumptionStatus?.controls.canResume),
      canHandoffProvider: Boolean(provider?.externalHandoff.accepted),
      canRunNextAction: Boolean(nextActionQueue?.controls.canRunNext),
      canPublishOperationsPacket: Boolean(operationsPacket?.ready),
      canRunOperatorDecision: Boolean(operatorDecisionLane?.controls.canRunNow),
    }),
    exportSummary: Object.freeze({
      label: options.label ?? "parser-export",
      status: ready ? "export-ready" : "export-review",
      cursor: latestStream?.cursor ?? 0,
      failedCount: failed.length,
      providerStatus: provider?.externalHandoff.status ?? "not-required",
      resumptionStatus: resumptionStatus?.exportSummary.status ?? "not-required",
      operatorDecision: operatorDecisionLane?.exportSummary.status ?? "not-required",
      nextAction: ready ? "publish-parser-export" : operatorDecisionLane?.nextAction ?? operationsPacket?.nextAction ?? nextActionQueue?.nextAction ?? resumptionStatus?.nextAction ?? firstBlocker?.nextAction ?? "review-parser-export",
    }),
    nextAction: ready ? "publish-parser-export" : operatorDecisionLane?.nextAction ?? operationsPacket?.nextAction ?? nextActionQueue?.nextAction ?? resumptionStatus?.nextAction ?? firstBlocker?.nextAction ?? "review-parser-export",
  });
}

export function createParserUserVisibleExportReadiness(results = [], options = {}) {
  const bundle = createParserExportBundle(results, {
    ...options,
    reason: options.reason ?? "parser-user-visible-export-readiness",
  });
  const latestStream = Array.from(results ?? []).findLast?.((result) => result?.stream)?.stream
    ?? Array.from(results ?? []).reverse().find((result) => result?.stream)?.stream
    ?? options.stream
    ?? null;
  const tokenManifest = latestStream
    ? createTokenStreamExportReadinessManifest(latestStream, {
        ...options,
        adapter: options.adapter ?? bundle.provider?.adapter ?? "runtime.run",
        statusChannel: options.statusChannel ?? bundle.provider?.sync?.statusChannel ?? null,
        reason: options.reason ?? "parser-user-visible-export-readiness",
      })
    : null;
  const providerAccepted = !bundle.provider || bundle.provider.accepted;
  const tokenReady = !tokenManifest || tokenManifest.ready;
  const accepted = bundle.ready && providerAccepted && tokenReady;
  const missing = Object.freeze([
    bundle.ready ? null : "parser-export-bundle",
    providerAccepted ? null : "provider-handoff",
    tokenReady ? null : tokenManifest?.exportSummary.firstBlocked ?? "token-export-readiness",
  ].filter(Boolean));
  const validationSummary = Object.freeze({
    parserReady: bundle.ready,
    tokenExportReady: tokenReady,
    providerReady: providerAccepted,
    statusReady: Boolean(tokenManifest?.sync.statusChannel ?? bundle.provider?.statusChannel),
    auditReady: Boolean(tokenManifest?.sync.auditChannel) || tokenManifest?.controls.canExportAudit !== false,
    missing,
  });
  const nextStepAction = accepted
    ? "publish-parser-export"
    : missing.includes("token-export-readiness") || tokenManifest?.exportSummary.firstBlocked
      ? tokenManifest?.nextAction ?? "review-token-export-readiness"
      : bundle.nextAction;

  return Object.freeze({
    schema: "aios.parser.user-visible-export-readiness.v1",
    label: options.label ?? "parser-export",
    accepted,
    status: accepted
      ? "accepted"
      : !bundle.ready
        ? bundle.status
        : tokenManifest?.status ?? "export-review",
    preview: Object.freeze({
      label: bundle.exportSummary.label,
      cursor: bundle.exportSummary.cursor,
      providerStatus: bundle.exportSummary.providerStatus,
      tokenManifestId: tokenManifest?.manifestId ?? null,
      statusChannel: tokenManifest?.sync.statusChannel ?? null,
      auditChannel: tokenManifest?.sync.auditChannel ?? null,
      blockedGates: tokenManifest?.blockedGates ?? Object.freeze([]),
    }),
    validationSummary,
    bundle,
    tokenManifest,
    controls: Object.freeze({
      canPreview: Boolean(latestStream),
      canAccept: missing.length === 0 || missing.every((entry) => entry !== "provider-handoff"),
      canExport: accepted,
      canRetry: bundle.controls.canRetryParser || tokenManifest?.controls.canReplayRestart === true,
      canEmitStatus: tokenManifest?.controls.canEmitStatus === true,
    }),
    nextStep: Object.freeze({
      label: accepted ? "Publish parser export" : nextStepAction,
      action: nextStepAction,
      requiresOperator: !accepted,
      retryable: bundle.controls.canRetryParser || tokenManifest?.controls.canReplayRestart === true,
    }),
    exportSummary: Object.freeze({
      label: options.label ?? "parser-export",
      status: accepted ? "parser-export-accepted" : "parser-export-review",
      tokenManifestId: tokenManifest?.manifestId ?? null,
      missing,
      nextAction: nextStepAction,
    }),
    nextAction: nextStepAction,
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
    restartJournal: contract.restartJournal.exportSummary.status,
    restartJournalReady: contract.restartJournal.validation.restartSafe,
    handoffEvidence: contract.handoffEvidence.exportSummary.status,
    handoffEvidenceReady: contract.handoffEvidence.accepted,
    handoffEvidenceId: contract.handoffEvidence.evidenceId,
    clientHandoff: contract.clientHandoffPacket.exportSummary.status,
    clientHandoffReady: contract.clientHandoffPacket.accepted,
    clientHandoffBlockedGate: contract.clientHandoffPacket.exportSummary.blockedGate,
    clientRuntimeAdoption: contract.clientRuntimeAdoption?.exportSummary.status ?? "not-required",
    clientRuntimeAdoptionReady: contract.clientRuntimeAdoption?.accepted ?? true,
    clientRuntimeAdoptionId: contract.clientRuntimeAdoption?.snapshotId ?? null,
    executionIntent: contract.executionIntent.exportSummary.status,
    executionIntentReady: contract.executionIntent.accepted,
    executionIntentId: contract.executionIntent.intentKey,
    handoffReceipt: contract.handoffReceipt.exportSummary.status,
    handoffReceiptReady: contract.handoffReceipt.accepted,
    handoffReceiptId: contract.handoffReceipt.receiptId,
    resumptionManifest: contract.resumptionManifest.exportSummary.status,
    resumptionManifestReady: contract.resumptionManifest.ready,
    resumptionManifestId: contract.resumptionManifest.manifestId,
    mailchimpDecision: contract.mailchimpDecision?.exportSummary.status ?? "not-required",
    mailchimpDecisionReady: contract.mailchimpDecision?.accepted ?? true,
    mailchimpDecisionId: contract.mailchimpDecision?.decisionId ?? null,
    mailchimpReadinessLedger: contract.mailchimpReadinessLedger?.exportSummary.status ?? "not-required",
    mailchimpReadinessLedgerReady: contract.mailchimpReadinessLedger?.accepted ?? true,
    mailchimpReadinessLedgerId: contract.mailchimpReadinessLedger?.ledgerId ?? null,
    mailchimpReadinessGate: contract.mailchimpReadinessGate.status,
    mailchimpReadinessGateReady: contract.mailchimpReadinessGate.accepted,
    mailchimpRecoveryEnvelope: contract.mailchimpRecoveryEnvelope?.exportSummary.status ?? "not-required",
    mailchimpRecoveryReady: contract.mailchimpRecoveryEnvelope?.accepted ?? true,
    mailchimpRecoveryEnvelopeId: contract.mailchimpRecoveryEnvelope?.envelopeId ?? null,
    mailchimpRecoveryDegraded: contract.mailchimpRecoveryEnvelope?.recovery.degradedAllowed ?? false,
    mailchimpControlPlane: contract.mailchimpControlPlane?.exportSummary.status ?? "not-required",
    mailchimpControlPlaneReady: contract.mailchimpControlPlane?.accepted ?? true,
    mailchimpControlPlaneId: contract.mailchimpControlPlane?.controlId ?? null,
    controls: contract.clientState.controls,
    health: contract.streamHealth.status,
    boundaryIncident: contract.streamHealth.boundaryIncident.status,
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
