function normalize(value) {
  return String(value ?? "").trim();
}

function hasValue(value) {
  return normalize(value).length > 0;
}

function makeFailure(name, code, recovery, extra = {}) {
  return {
    name,
    passed: false,
    code,
    recovery,
    severity: extra.severity ?? "error",
    retryable: extra.retryable ?? false,
    ...extra
  };
}

function makePass(name, extra = {}) {
  return {
    name,
    passed: true,
    code: "ok",
    recovery: null,
    severity: "info",
    retryable: false,
    ...extra
  };
}

function checkScheduleWindow(job, options = {}) {
  const sendAt = job.payload?.sendAt ? new Date(job.payload.sendAt) : null;
  if (!sendAt || Number.isNaN(sendAt.getTime())) {
    return makeFailure(
      "schedule-window",
      "invalid_send_at",
      "Keep the campaign as a draft until a valid sendAt timestamp is supplied.",
      { retryable: true, retryAfterSeconds: 0 }
    );
  }

  const now = options.now ? new Date(options.now) : new Date(0);
  const minLeadMinutes = Number.isFinite(options.minLeadMinutes) ? options.minLeadMinutes : 15;
  const earliest = new Date(now.getTime() + minLeadMinutes * 60 * 1000);
  const passed = sendAt.getTime() >= earliest.getTime();

  return passed
    ? makePass("schedule-window", { sendAt: sendAt.toISOString(), minLeadMinutes })
    : makeFailure(
        "schedule-window",
        "send_at_too_soon",
        `Schedule at least ${minLeadMinutes} minutes after the verifier clock.`,
        { retryable: true, retryAfterSeconds: Math.ceil((earliest.getTime() - sendAt.getTime()) / 1000) }
      );
}

function checkMemory(job, memoryContract) {
  const payload = job.payload ?? {};
  const required = job.memory?.required ?? ["campaignName", "listId", "subjectLine"];
  const missing = required.filter((field) => !hasValue(payload[field]));
  const contractMissing = memoryContract?.records?.flatMap((record) => record.missing ?? []) ?? [];
  const allMissing = [...new Set([...missing, ...contractMissing])];

  return allMissing.length === 0
    ? makePass("memory", { missing: [] })
    : makeFailure("memory", "missing_memory_facts", "Bind missing campaign facts before runtime adapter handoff.", {
        missing: allMissing,
        retryable: true,
        retryAfterSeconds: 0
      });
}

function checkTruthBoundary(job) {
  const boundary = job.truthBoundary ?? {};
  const passed =
    boundary.externalWrites === false &&
    job.runtimeAdapter?.mode === "deferred-handoff" &&
    job.runtimeAdapter?.externalWritePermittedAfterVerification === true;

  return passed
    ? makePass("truth-boundary")
    : makeFailure(
        "truth-boundary",
        "unsafe_truth_boundary",
        "Compile the job with local-only preparation and deferred adapter handoff.",
        { retryable: false }
      );
}

function checkCapabilities(job, capabilityValidation) {
  if (capabilityValidation) {
    return capabilityValidation.allowed === true
      ? makePass("capabilities", { missing: [] })
      : makeFailure("capabilities", "capabilities_not_granted", "Grant missing Mailchimp capabilities before scheduling.", {
          missing: capabilityValidation.missing ?? [],
          retryable: true,
          retryAfterSeconds: 0
        });
  }

  const required = job.capabilities?.map((capability) => capability.scope).filter(Boolean) ?? [];
  return required.length > 0
    ? makePass("capabilities", { missing: [] })
    : makeFailure("capabilities", "missing_capability_contract", "Attach a capability contract to the job descriptor.", {
        missing: ["campaigns:schedule", "campaigns:write", "lists:read"],
        retryable: false
      });
}

function checkRuntimeScope(job) {
  const scope = job.runtimeScope ?? {};
  const missing = ["tenantId", "workspaceId", "actorId"].filter((field) => !hasValue(scope[field]));
  const missingPermissions = scope.missingPermissions ?? [];
  if (missing.length === 0 && missingPermissions.length === 0) {
    return makePass("runtime-scope", {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      isolationKey: scope.isolationKey
    });
  }

  return makeFailure("runtime-scope", "unsafe_or_incomplete_runtime_scope", "Bind tenant, workspace, actor, and scheduler permissions before adapter handoff.", {
    missing,
    missingPermissions,
    retryable: true,
    retryAfterSeconds: 0
  });
}

function checkAdapterHealth(context = {}) {
  const health = context.adapterHealth ?? {};
  const status = normalize(health.status || "unknown").toLowerCase();
  if (status === "ok" || status === "healthy") {
    return makePass("adapter-health", {
      status: "healthy",
      checkedAt: normalize(health.checkedAt) || null
    });
  }

  if (status === "degraded") {
    return makeFailure("adapter-health", "adapter_degraded", "Keep the job queued and retry adapter handoff after the backoff window.", {
      severity: "warning",
      retryable: true,
      retryAfterSeconds: Number.isFinite(health.retryAfterSeconds) ? health.retryAfterSeconds : 60,
      degradedMode: true
    });
  }

  return makeFailure("adapter-health", "adapter_health_unknown", "Verify Mailchimp adapter health before external write handoff.", {
    severity: "warning",
    retryable: true,
    retryAfterSeconds: Number.isFinite(health.retryAfterSeconds) ? health.retryAfterSeconds : 30,
    degradedMode: true
  });
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => normalize(entry).toLowerCase()).filter(Boolean))].sort()
    : [];
}

function compareLists(left, right) {
  const normalizedLeft = normalizeStringList(left);
  const normalizedRight = normalizeStringList(right);
  return {
    left: normalizedLeft,
    right: normalizedRight,
    equal:
      normalizedLeft.length === normalizedRight.length &&
      normalizedLeft.every((entry, index) => entry === normalizedRight[index])
  };
}

function checkAdapterHandoffEnvelope(job) {
  const envelope = job.adapterHandoff ?? {};
  if (!envelope.envelopeVersion) {
    return makeFailure(
      "adapter-handoff-envelope",
      "missing_adapter_handoff_envelope",
      "Compile the scheduler job with a deterministic adapter handoff envelope before verification.",
      {
        retryable: true,
        retryAfterSeconds: 0,
        missing: ["adapterHandoff"]
      }
    );
  }

  const requiredScopes = job.capabilities?.map((capability) => capability.scope).filter(Boolean) ?? [];
  const envelopeScopes = envelope.capabilities?.requiredScopes ?? [];
  const scopeComparison = compareLists(requiredScopes, envelopeScopes);
  const blockers = Array.isArray(envelope.blockers) ? envelope.blockers : [];
  const memory = envelope.memory ?? {};
  const capabilities = envelope.capabilities ?? {};
  const artifacts = envelope.artifacts ?? {};
  const missing = [
    ...(!hasValue(envelope.jobId) ? ["jobId"] : []),
    ...(!hasValue(envelope.commandId) ? ["commandId"] : []),
    ...(!hasValue(memory.memoryKey) ? ["memory.memoryKey"] : []),
    ...(!hasValue(memory.continuationKey) ? ["memory.continuationKey"] : []),
    ...(!hasValue(memory.checksum) ? ["memory.checksum"] : []),
    ...(!hasValue(capabilities.checkpointId) ? ["capabilities.checkpointId"] : [])
  ];
  const pendingArtifactCommands = normalizeStringList(artifacts.pendingCommandIds);
  const deniedScopes = normalizeStringList(capabilities.deniedScopes);
  const missingScopes = normalizeStringList(capabilities.missingScopes);
  const invalid = [
    ...(!scopeComparison.equal ? ["required_capability_scope_mismatch"] : []),
    ...(envelope.status === "ready" && envelope.mayCallAdapter !== true
      ? ["ready_envelope_without_adapter_permission"]
      : []),
    ...(envelope.mayCallAdapter === true && blockers.length > 0
      ? ["adapter_handoff_has_blockers"]
      : []),
    ...(memory.restartSafe !== true ? ["memory_not_restart_safe"] : []),
    ...(capabilities.canHandoff !== true ? ["capabilities_not_ready_for_handoff"] : []),
    ...(pendingArtifactCommands.length > 0 ? ["artifact_commands_pending"] : []),
    ...(deniedScopes.length > 0 ? ["capability_denied"] : []),
    ...(missingScopes.length > 0 ? ["capability_grant_required"] : [])
  ];

  if (missing.length === 0 && invalid.length === 0) {
    return makePass("adapter-handoff-envelope", {
      envelopeVersion: envelope.envelopeVersion,
      status: envelope.status,
      checkpointId: capabilities.checkpointId,
      commandId: envelope.commandId
    });
  }

  return makeFailure(
    "adapter-handoff-envelope",
    "adapter_handoff_not_ready",
    "Repair scheduler handoff envelope state before verifier permits the Mailchimp adapter call.",
    {
      retryable: true,
      retryAfterSeconds: 0,
      missing,
      invalid,
      blockers: blockers.map((blocker) => ({
        source: normalize(blocker.source || "unknown"),
        code: normalize(blocker.code || "unknown"),
        action: normalize(blocker.action)
      })),
      requiredScopes: scopeComparison.left,
      envelopeScopes: scopeComparison.right,
      pendingArtifactCommands,
      deniedScopes,
      missingScopes
    }
  );
}

function normalizePreflightItem(item = {}, index = 0) {
  const id = normalize(item.id || item.check || `check-${index + 1}`).toLowerCase();
  const status = normalize(item.status || (item.passed === false ? "blocked" : "passed")).toLowerCase();
  const severity = normalize(item.severity || (status === "passed" ? "info" : "error")).toLowerCase();

  return {
    id,
    status,
    severity,
    action: normalize(item.action || item.recovery || "operator-review"),
    evidence: normalize(item.evidence || item.subject || id),
    source: normalize(item.source || "scheduler-preflight")
  };
}

function checkSchedulerPreflight(job) {
  const preflight = job.preflight ?? {};
  if (!preflight.preflightVersion) {
    return makeFailure(
      "scheduler-preflight",
      "missing_scheduler_preflight",
      "Compile the scheduler job with a deterministic preflight record before verifier handoff.",
      {
        retryable: true,
        retryAfterSeconds: 0,
        missing: ["preflight"]
      }
    );
  }

  const checklist = normalizeList(preflight.checklist).map(normalizePreflightItem);
  const blocked = checklist.filter((item) => item.status === "blocked");
  const warnings = checklist.filter((item) => item.status === "warning");
  const unsupportedStatuses = checklist
    .filter((item) => !["passed", "warning", "blocked"].includes(item.status))
    .map((item) => item.id);
  const missing = [
    ...(!hasValue(preflight.jobId) ? ["jobId"] : []),
    ...(!hasValue(preflight.commandId) ? ["commandId"] : []),
    ...(checklist.length === 0 ? ["checklist"] : []),
    ...(preflight.jobId && job.id && preflight.jobId !== job.id ? ["jobId:mismatch"] : []),
    ...(preflight.adapterCommandId &&
      job.adapterHandoff?.commandId &&
      preflight.adapterCommandId !== job.adapterHandoff.commandId
      ? ["adapterCommandId:mismatch"]
      : [])
  ];
  const invalid = [
    ...(unsupportedStatuses.length > 0 ? ["unsupported_preflight_status"] : []),
    ...(preflight.status === "ready" && blocked.length > 0 ? ["ready_preflight_has_blockers"] : []),
    ...(preflight.ready === true && preflight.status !== "ready" ? ["ready_flag_without_ready_status"] : []),
    ...(preflight.mayCallAdapter === true && preflight.status !== "ready"
      ? ["adapter_allowed_without_ready_preflight"]
      : []),
    ...(preflight.mayCallAdapter === true && job.adapterHandoff?.mayCallAdapter !== true
      ? ["preflight_adapter_permission_mismatch"]
      : []),
    ...(preflight.truthBoundary?.externalWrites !== false ? ["preflight_truth_boundary_allows_writes"] : [])
  ];

  if (missing.length === 0 && invalid.length === 0 && blocked.length === 0) {
    return warnings.length === 0
      ? makePass("scheduler-preflight", {
          status: preflight.status,
          commandId: preflight.commandId,
          checklistCount: checklist.length
        })
      : makeFailure(
          "scheduler-preflight",
          "scheduler_preflight_degraded",
          "Refresh warning preflight checks before external adapter handoff when possible.",
          {
            severity: "warning",
            retryable: true,
            retryAfterSeconds: 0,
            warnings: warnings.map((item) => ({
              check: item.id,
              action: item.action,
              evidence: item.evidence
            })),
            degradedMode: true
          }
        );
  }

  return makeFailure(
    "scheduler-preflight",
    "scheduler_preflight_not_ready",
    "Repair scheduler preflight state before verifier permits the Mailchimp adapter call.",
    {
      retryable: true,
      retryAfterSeconds: 0,
      missing,
      invalid,
      unsupportedStatuses,
      blocked: blocked.map((item) => ({
        check: item.id,
        action: item.action,
        evidence: item.evidence,
        source: item.source
      })),
      warnings: warnings.map((item) => ({
        check: item.id,
        action: item.action,
        evidence: item.evidence
      }))
    }
  );
}

function normalizeClientRuntimeHandoff(handoff = {}) {
  const clientState = handoff.clientState ?? {};
  const persistedState = handoff.persistedState ?? {};
  const visible = handoff.visible ?? {};
  return {
    version: normalize(handoff.handoffVersion),
    adoptionKey: normalize(handoff.adoptionKey),
    status: normalize(handoff.status || "missing").toLowerCase(),
    ready: handoff.ready === true,
    restartSafe: handoff.restartSafe === true,
    mayCallAdapterAfterVerifier: handoff.mayCallAdapterAfterVerifier === true,
    jobId: normalize(handoff.jobId),
    schedulerCommandId: normalize(handoff.schedulerCommandId),
    preflightCommandId: normalize(handoff.preflightCommandId),
    adapterCommandId: normalize(handoff.adapterCommandId),
    isolationKey: normalize(handoff.isolationKey),
    clientState: {
      ready: clientState.ready === true,
      command: normalize(clientState.command),
      idempotencyKey: normalize(clientState.idempotencyKey),
      requiredBindings: normalizeStringList(clientState.requiredBindings),
      boundFields: normalizeStringList(clientState.boundFields),
      missingBindings: normalizeStringList(clientState.missingBindings)
    },
    persistedState: {
      memoryKey: normalize(persistedState.memoryKey),
      continuationKey: normalize(persistedState.continuationKey),
      checksum: normalize(persistedState.checksum),
      restartToken: normalize(persistedState.restartToken),
      persistCommandId: normalize(persistedState.persistCommandId),
      resumeCommandId: normalize(persistedState.resumeCommandId)
    },
    visible: {
      status: normalize(visible.status || handoff.status).toLowerCase(),
      primaryAction: normalize(visible.primaryAction),
      disabledReason: normalize(visible.disabledReason),
      route: normalize(visible.route)
    },
    blockers: normalizeList(handoff.blockers).map((blocker) => ({
      code: normalize(blocker.code || "client_runtime_blocker"),
      action: normalize(blocker.action || "bind-client-runtime-state-before-resume")
    }))
  };
}

function checkClientRuntimeHandoff(job) {
  const handoff = normalizeClientRuntimeHandoff(job.clientRuntimeHandoff ?? {});
  if (!handoff.version) {
    return makeFailure(
      "client-runtime-handoff",
      "missing_client_runtime_handoff",
      "Compile scheduler output with a restart-safe client runtime handoff contract.",
      {
        retryable: true,
        retryAfterSeconds: 0,
        missing: ["clientRuntimeHandoff"]
      }
    );
  }

  const missing = [
    ...(!hasValue(handoff.adoptionKey) ? ["adoptionKey"] : []),
    ...(!hasValue(handoff.jobId) ? ["jobId"] : []),
    ...(!hasValue(handoff.schedulerCommandId) ? ["schedulerCommandId"] : []),
    ...(!hasValue(handoff.preflightCommandId) ? ["preflightCommandId"] : []),
    ...(!hasValue(handoff.persistedState.memoryKey) ? ["persistedState.memoryKey"] : []),
    ...(!hasValue(handoff.persistedState.continuationKey) ? ["persistedState.continuationKey"] : []),
    ...(!hasValue(handoff.persistedState.checksum) ? ["persistedState.checksum"] : []),
    ...(!hasValue(handoff.persistedState.restartToken) ? ["persistedState.restartToken"] : []),
    ...(!hasValue(handoff.clientState.idempotencyKey) ? ["clientState.idempotencyKey"] : [])
  ];
  const invalid = [
    ...(handoff.jobId && job.id && handoff.jobId !== job.id ? ["jobId:mismatch"] : []),
    ...(handoff.preflightCommandId &&
      job.preflight?.commandId &&
      handoff.preflightCommandId !== job.preflight.commandId
      ? ["preflightCommandId:mismatch"]
      : []),
    ...(handoff.adapterCommandId &&
      job.adapterHandoff?.commandId &&
      handoff.adapterCommandId !== job.adapterHandoff.commandId
      ? ["adapterCommandId:mismatch"]
      : []),
    ...(handoff.status === "ready" && handoff.ready !== true ? ["ready_status_without_ready_flag"] : []),
    ...(handoff.ready === true && handoff.status !== "ready" ? ["ready_flag_without_ready_status"] : []),
    ...(handoff.restartSafe !== true ? ["client_handoff_not_restart_safe"] : []),
    ...(handoff.clientState.ready !== true ? ["client_state_not_ready"] : []),
    ...(handoff.clientState.missingBindings.length > 0 ? ["client_bindings_missing"] : []),
    ...(handoff.mayCallAdapterAfterVerifier === true && job.adapterHandoff?.mayCallAdapter !== true
      ? ["client_adapter_permission_mismatch"]
      : []),
    ...(handoff.mayCallAdapterAfterVerifier === true && handoff.status !== "ready"
      ? ["adapter_allowed_without_ready_client_handoff"]
      : [])
  ];

  if (missing.length === 0 && invalid.length === 0) {
    return makePass("client-runtime-handoff", {
      adoptionKey: handoff.adoptionKey,
      status: handoff.status,
      primaryAction: handoff.visible.primaryAction,
      restartToken: handoff.persistedState.restartToken
    });
  }

  return makeFailure(
    "client-runtime-handoff",
    handoff.clientState.missingBindings.length > 0
      ? "client_runtime_state_required"
      : "client_runtime_handoff_not_ready",
    "Bind restart-safe client runtime state before verifier permits Mailchimp adapter handoff.",
    {
      retryable: true,
      retryAfterSeconds: 0,
      missing,
      invalid,
      missingBindings: handoff.clientState.missingBindings,
      blockers: handoff.blockers,
      primaryAction: handoff.visible.primaryAction || "runtime.client-state.bind",
      disabledReason: handoff.visible.disabledReason || null
    }
  );
}

function normalizeSchedulerRestartLedger(ledger = {}) {
  const command = ledger.command ?? {};
  const persistedState = ledger.persistedState ?? {};
  const counters = ledger.counters ?? {};

  return {
    version: normalize(ledger.ledgerVersion),
    status: normalize(ledger.status || "missing").toLowerCase(),
    restartSafe: ledger.restartSafe === true,
    idempotentReplay: ledger.idempotentReplay === true,
    jobId: normalize(ledger.jobId),
    schedulerCommandId: normalize(ledger.schedulerCommandId),
    preflightCommandId: normalize(ledger.preflightCommandId),
    clientRuntimeAdoptionKey: normalize(ledger.clientRuntimeAdoptionKey),
    command: {
      id: normalize(command.id),
      idempotencyKey: normalize(command.idempotencyKey),
      type: normalize(command.type),
      status: normalize(command.status || "blocked").toLowerCase(),
      externalWrites: command.externalWrites === true,
      mayCallAdapterAfterVerifier: command.mayCallAdapterAfterVerifier === true
    },
    persistedState: {
      memoryKey: normalize(persistedState.memoryKey),
      continuationKey: normalize(persistedState.continuationKey),
      checksum: normalize(persistedState.checksum),
      restartToken: normalize(persistedState.restartToken)
    },
    blockers: normalizeList(ledger.blockers).map((blocker) => normalize(blocker)).filter(Boolean),
    recovery: normalizeList(ledger.recovery).map((entry) => ({
      code: normalize(entry.code || "restart_ledger_blocked"),
      action: normalize(entry.action || "repair-scheduler-restart-state"),
      retryable: entry.retryable === true
    })),
    counters: {
      historyEntries: Number.isFinite(counters.historyEntries) ? counters.historyEntries : 0,
      replayMatches: Number.isFinite(counters.replayMatches) ? counters.replayMatches : 0,
      blockedReasons: Number.isFinite(counters.blockedReasons) ? counters.blockedReasons : 0,
      adapterCallsObserved: Number.isFinite(counters.adapterCallsObserved) ? counters.adapterCallsObserved : 0,
      externalWriteViolations: Number.isFinite(counters.externalWriteViolations)
        ? counters.externalWriteViolations
        : 0
    },
    truthBoundary: ledger.truthBoundary ?? {}
  };
}

function checkSchedulerRestartLedger(job) {
  const ledger = normalizeSchedulerRestartLedger(job.restartLedger ?? {});
  if (!ledger.version) {
    return makeFailure(
      "scheduler-restart-ledger",
      "missing_scheduler_restart_ledger",
      "Compile scheduler output with a deterministic restart ledger before verifier handoff.",
      {
        retryable: true,
        retryAfterSeconds: 0,
        missing: ["restartLedger"]
      }
    );
  }

  const allowedStatuses = ["ready_to_resume", "resume_degraded", "blocked", "already_completed"];
  const missing = [
    ...(!hasValue(ledger.jobId) ? ["jobId"] : []),
    ...(!hasValue(ledger.schedulerCommandId) ? ["schedulerCommandId"] : []),
    ...(!hasValue(ledger.preflightCommandId) ? ["preflightCommandId"] : []),
    ...(!hasValue(ledger.clientRuntimeAdoptionKey) ? ["clientRuntimeAdoptionKey"] : []),
    ...(!hasValue(ledger.command.id) ? ["command.id"] : []),
    ...(!hasValue(ledger.command.idempotencyKey) ? ["command.idempotencyKey"] : []),
    ...(!hasValue(ledger.persistedState.memoryKey) ? ["persistedState.memoryKey"] : []),
    ...(!hasValue(ledger.persistedState.continuationKey) ? ["persistedState.continuationKey"] : []),
    ...(!hasValue(ledger.persistedState.checksum) ? ["persistedState.checksum"] : []),
    ...(!hasValue(ledger.persistedState.restartToken) ? ["persistedState.restartToken"] : [])
  ];
  const invalid = [
    ...(!allowedStatuses.includes(ledger.status) ? ["unsupported_restart_ledger_status"] : []),
    ...(ledger.jobId && job.id && ledger.jobId !== job.id ? ["jobId:mismatch"] : []),
    ...(ledger.schedulerCommandId &&
      job.idempotency?.commandId &&
      ledger.schedulerCommandId !== job.idempotency.commandId
      ? ["schedulerCommandId:mismatch"]
      : []),
    ...(ledger.preflightCommandId &&
      job.preflight?.commandId &&
      ledger.preflightCommandId !== job.preflight.commandId
      ? ["preflightCommandId:mismatch"]
      : []),
    ...(ledger.clientRuntimeAdoptionKey &&
      job.clientRuntimeHandoff?.adoptionKey &&
      ledger.clientRuntimeAdoptionKey !== job.clientRuntimeHandoff.adoptionKey
      ? ["clientRuntimeAdoptionKey:mismatch"]
      : []),
    ...(ledger.command.idempotencyKey && ledger.command.id && ledger.command.idempotencyKey !== ledger.command.id
      ? ["restart_command_idempotency_mismatch"]
      : []),
    ...(ledger.command.externalWrites === true ? ["restart_command_external_write"] : []),
    ...(ledger.truthBoundary?.externalWrites !== false ? ["restart_ledger_truth_boundary_allows_writes"] : []),
    ...(ledger.counters.externalWriteViolations > 0 ? ["restart_history_external_write_violation"] : []),
    ...(ledger.status === "ready_to_resume" && ledger.restartSafe !== true ? ["ready_restart_ledger_not_restart_safe"] : []),
    ...(ledger.status === "ready_to_resume" && ledger.command.status !== "ready_to_resume"
      ? ["ready_restart_ledger_command_not_ready"]
      : []),
    ...(ledger.status === "already_completed" && ledger.idempotentReplay !== true
      ? ["completed_restart_without_replay_match"]
      : []),
    ...(ledger.idempotentReplay === true && ledger.command.type !== "return-existing-scheduler-command-status"
      ? ["replay_does_not_return_existing_status"]
      : []),
    ...(ledger.command.mayCallAdapterAfterVerifier === true && job.clientRuntimeHandoff?.mayCallAdapterAfterVerifier !== true
      ? ["restart_adapter_permission_mismatch"]
      : [])
  ];

  if (missing.length === 0 && invalid.length === 0 && ledger.blockers.length === 0) {
    return makePass("scheduler-restart-ledger", {
      status: ledger.status,
      commandId: ledger.command.id,
      restartToken: ledger.persistedState.restartToken,
      idempotentReplay: ledger.idempotentReplay
    });
  }

  return makeFailure(
    "scheduler-restart-ledger",
    ledger.status === "already_completed" && invalid.length === 0
      ? "scheduler_restart_replay_completed"
      : "scheduler_restart_ledger_not_ready",
    "Repair restart ledger state or return the existing scheduler command status before Mailchimp adapter handoff.",
    {
      severity: ledger.status === "already_completed" && invalid.length === 0 ? "warning" : "error",
      retryable: ledger.status !== "already_completed",
      retryAfterSeconds: ledger.status === "resume_degraded" ? 60 : 0,
      missing,
      invalid,
      blockers: ledger.blockers,
      recovery: ledger.recovery,
      idempotentReplay: ledger.idempotentReplay,
      commandStatus: ledger.command.status
    }
  );
}

function normalizePackageControlHandoff(control = {}) {
  const schedule = control.schedule ?? {};
  const approval = control.approval ?? {};
  const command = control.command ?? {};
  const tenantBoundary = control.tenantBoundary ?? {};
  const validation = control.validation ?? {};
  const truthBoundary = control.truthBoundary ?? {};

  return {
    version: normalize(control.handoffVersion || control.kind),
    apiVersion: normalize(control.apiVersion),
    handoffId: normalize(control.handoffId),
    jobId: normalize(control.jobId),
    status: normalize(control.status || "missing").toLowerCase(),
    ready: control.ready === true,
    maySchedule: control.maySchedule === true,
    nextAction: normalize(control.nextAction),
    disabledReason: normalize(control.disabledReason),
    schedule: {
      mode: normalize(schedule.mode || "manual").toLowerCase(),
      startsAt: normalize(schedule.startsAt),
      intervalMinutes: Number.isFinite(schedule.intervalMinutes) ? schedule.intervalMinutes : null,
      ready: schedule.ready !== false,
      blockedReasons: normalizeStringList(schedule.blockedReasons)
    },
    approval: {
      required: approval.required === true,
      accepted: approval.accepted === true,
      acceptedBy: normalize(approval.acceptedBy),
      acceptedAt: normalize(approval.acceptedAt),
      command: normalize(approval.command || "package.preview.accept")
    },
    command: {
      id: normalize(command.id || command.commandId),
      command: normalize(command.command),
      ready: command.ready === true,
      reason: normalize(command.reason),
      idempotencyKey: normalize(command.idempotencyKey || command.id),
      externalWrites: command.externalWrites === true,
      requiresVerifier: command.requiresVerifier !== false
    },
    tenantBoundary: {
      tenantId: normalize(tenantBoundary.tenantId),
      workspaceId: normalize(tenantBoundary.workspaceId),
      isolationMode: normalize(tenantBoundary.isolationMode),
      boundarySatisfied: tenantBoundary.boundarySatisfied !== false
    },
    blockedReasons: normalizeStringList(validation.blockedReasons ?? control.blockedReasons),
    warnings: normalizeStringList(validation.warnings),
    truthBoundary: {
      externalWrites: truthBoundary.externalWrites === true,
      localOnly: truthBoundary.localOnly !== false,
      verifierRequiredBeforeAdapter: truthBoundary.verifierRequiredBeforeAdapter !== false,
      evidenceSubject: normalize(truthBoundary.evidenceSubject)
    }
  };
}

function checkPackageControlHandoff(job) {
  const control = normalizePackageControlHandoff(job.packageControl ?? job.packageSchedulerControlHandoff ?? {});
  if (!control.version && control.status === "missing") {
    return makePass("package-control-handoff", {
      status: "not_provided",
      mode: "legacy-scheduler-job"
    });
  }

  const scope = job.runtimeScope ?? {};
  const missing = [
    ...(!hasValue(control.handoffId) ? ["handoffId"] : []),
    ...(!hasValue(control.jobId) ? ["jobId"] : []),
    ...(!hasValue(control.command.id) ? ["command.id"] : []),
    ...(!hasValue(control.command.idempotencyKey) ? ["command.idempotencyKey"] : []),
    ...(!hasValue(control.nextAction) ? ["nextAction"] : []),
    ...(control.approval.required && control.approval.accepted && !hasValue(control.approval.acceptedAt)
      ? ["approval.acceptedAt"]
      : [])
  ];
  const invalid = [
    ...(control.jobId && job.id && control.jobId !== job.id ? ["jobId:mismatch"] : []),
    ...(!["ready", "disabled", "paused", "awaiting-approval", "blocked"].includes(control.status)
      ? ["unsupported_package_control_status"]
      : []),
    ...(control.ready === true && control.status !== "ready" ? ["ready_flag_without_ready_status"] : []),
    ...(control.status === "ready" && control.ready !== true ? ["ready_status_without_ready_flag"] : []),
    ...(control.maySchedule === true && control.ready !== true ? ["may_schedule_without_ready_control"] : []),
    ...(control.command.ready === true && control.command.idempotencyKey !== control.command.id
      ? ["command_idempotency_mismatch"]
      : []),
    ...(control.command.externalWrites === true ? ["package_control_command_external_write"] : []),
    ...(control.command.requiresVerifier !== true ? ["package_control_skips_verifier"] : []),
    ...(control.truthBoundary.externalWrites === true ? ["package_control_truth_boundary_allows_writes"] : []),
    ...(control.truthBoundary.localOnly !== true ? ["package_control_not_local_only"] : []),
    ...(control.truthBoundary.verifierRequiredBeforeAdapter !== true
      ? ["package_control_missing_verifier_gate"]
      : []),
    ...(control.schedule.mode === "disabled" && control.status === "ready" ? ["ready_control_has_disabled_schedule"] : []),
    ...(control.approval.required && !control.approval.accepted ? ["package_control_approval_pending"] : []),
    ...(control.tenantBoundary.boundarySatisfied !== true ? ["package_control_tenant_boundary_violation"] : []),
    ...(control.tenantBoundary.tenantId &&
      scope.tenantId &&
      control.tenantBoundary.tenantId !== scope.tenantId
      ? ["tenantId:mismatch"]
      : []),
    ...(control.tenantBoundary.workspaceId &&
      scope.workspaceId &&
      control.tenantBoundary.workspaceId !== scope.workspaceId
      ? ["workspaceId:mismatch"]
      : [])
  ];
  const blockers = [
    ...control.blockedReasons,
    ...control.schedule.blockedReasons,
    ...(control.disabledReason ? [control.disabledReason] : [])
  ];

  if (missing.length === 0 && invalid.length === 0 && blockers.length === 0 && control.ready && control.maySchedule) {
    return makePass("package-control-handoff", {
      handoffId: control.handoffId,
      status: control.status,
      commandId: control.command.id,
      scheduleMode: control.schedule.mode
    });
  }

  return makeFailure(
    "package-control-handoff",
    control.status === "awaiting-approval" || invalid.includes("package_control_approval_pending")
      ? "package_control_approval_required"
      : control.status === "disabled"
        ? "package_control_disabled"
        : control.status === "paused"
          ? "package_schedule_paused"
          : "package_control_not_ready",
    "Resolve package lifecycle controls before verifier permits scheduler adapter handoff.",
    {
      retryable: control.status !== "disabled",
      retryAfterSeconds: control.status === "paused" ? 60 : 0,
      missing,
      invalid,
      blockers,
      nextAction: control.nextAction || "package.controls.repair",
      scheduleMode: control.schedule.mode,
      approvalRequired: control.approval.required,
      approvalAccepted: control.approval.accepted
    }
  );
}

function normalizeSchedulerAnalyticsExportControl(control = {}) {
  const policy = control.policy ?? {};
  const command = control.command ?? {};
  const readiness = control.readiness ?? {};
  const latest = control.latest ?? {};
  const counters = control.counters ?? {};
  const truthBoundary = control.truthBoundary ?? {};

  return {
    version: normalize(control.controlVersion || control.kind),
    status: normalize(control.status || readiness.status || "missing").toLowerCase(),
    ready: control.ready === true || readiness.ready === true,
    jobId: normalize(control.jobId || latest.jobId),
    command: {
      id: normalize(command.id || command.commandId),
      idempotencyKey: normalize(command.idempotencyKey || command.id),
      command: normalize(command.command),
      ready: command.ready === true,
      externalWrites: command.externalWrites === true,
      requiresVerifier: command.requiresVerifier !== false,
      reason: normalize(command.reason)
    },
    policy: {
      mode: normalize(policy.mode || "status-summary").toLowerCase(),
      format: normalize(policy.format || "json.analytics").toLowerCase(),
      localOnly: policy.localOnly !== false,
      requireVerifier: policy.requireVerifier !== false,
      includeTimeline: policy.includeTimeline !== false,
      includeHistory: policy.includeHistory !== false,
      retentionSnapshots: Number.isFinite(policy.retentionSnapshots) ? policy.retentionSnapshots : 12
    },
    counters: {
      snapshots: Number.isFinite(counters.snapshots) ? counters.snapshots : 0,
      blockedSnapshots: Number.isFinite(counters.blockedSnapshots) ? counters.blockedSnapshots : 0,
      degradedSnapshots: Number.isFinite(counters.degradedSnapshots) ? counters.degradedSnapshots : 0,
      exportedSnapshots: Number.isFinite(counters.exportedSnapshots) ? counters.exportedSnapshots : 0,
      pendingArtifactCommands: Number.isFinite(counters.pendingArtifactCommands) ? counters.pendingArtifactCommands : 0,
      deniedCapabilities: Number.isFinite(counters.deniedCapabilities) ? counters.deniedCapabilities : 0,
      packageControlBlockers: Number.isFinite(counters.packageControlBlockers) ? counters.packageControlBlockers : 0,
      warnings: Number.isFinite(counters.warnings) ? counters.warnings : 0,
      blockers: Number.isFinite(counters.blockers) ? counters.blockers : 0
    },
    latest: {
      at: normalize(latest.at),
      status: normalize(latest.status || "unknown").toLowerCase(),
      exportStatus: normalize(latest.exportStatus || "unknown").toLowerCase(),
      preflightStatus: normalize(latest.preflightStatus),
      operationalHandoffStatus: normalize(latest.operationalHandoffStatus),
      restartLedgerStatus: normalize(latest.restartLedgerStatus),
      commandId: normalize(latest.commandId),
      exportCommandId: normalize(latest.exportCommandId)
    },
    historyCount: normalizeList(control.history).length,
    timelineCount: normalizeList(control.timeline).length,
    blockedReasons: normalizeStringList(readiness.blockedReasons),
    warnings: normalizeStringList(readiness.warnings),
    nextAction: normalize(readiness.nextAction),
    truthBoundary: {
      externalWrites: truthBoundary.externalWrites === true,
      localOnly: truthBoundary.localOnly !== false,
      verifierRequiredBeforeAdapter: truthBoundary.verifierRequiredBeforeAdapter !== false,
      evidenceSubject: normalize(truthBoundary.evidenceSubject)
    }
  };
}

function checkSchedulerAnalyticsExportControl(job) {
  const control = normalizeSchedulerAnalyticsExportControl(job.analyticsExportControl ?? {});
  if (!control.version && control.status === "missing") {
    return makeFailure(
      "scheduler-analytics-export-control",
      "missing_scheduler_analytics_export_control",
      "Compile scheduler output with analytics export control state before verifier handoff.",
      {
        retryable: true,
        retryAfterSeconds: 0,
        missing: ["analyticsExportControl"]
      }
    );
  }

  const missing = [
    ...(!hasValue(control.jobId) ? ["jobId"] : []),
    ...(!hasValue(control.command.id) ? ["command.id"] : []),
    ...(!hasValue(control.command.idempotencyKey) ? ["command.idempotencyKey"] : []),
    ...(!hasValue(control.nextAction) ? ["readiness.nextAction"] : []),
    ...(control.policy.includeHistory && control.historyCount === 0 ? ["history"] : []),
    ...(control.policy.includeTimeline && control.timelineCount === 0 ? ["timeline"] : [])
  ];
  const invalid = [
    ...(control.jobId && job.id && control.jobId !== job.id ? ["jobId:mismatch"] : []),
    ...(!["ready", "degraded_ready", "blocked"].includes(control.status)
      ? ["unsupported_scheduler_analytics_export_status"]
      : []),
    ...(control.ready === true && !["ready", "degraded_ready"].includes(control.status)
      ? ["ready_flag_without_ready_export_status"]
      : []),
    ...(control.status === "ready" && control.ready !== true ? ["ready_status_without_ready_flag"] : []),
    ...(control.command.ready === true && control.command.idempotencyKey !== control.command.id
      ? ["analytics_export_command_idempotency_mismatch"]
      : []),
    ...(control.command.externalWrites === true ? ["analytics_export_command_external_write"] : []),
    ...(control.command.requiresVerifier !== true ? ["analytics_export_skips_verifier"] : []),
    ...(control.policy.localOnly !== true ? ["analytics_export_not_local_only"] : []),
    ...(control.policy.requireVerifier !== true ? ["analytics_export_policy_skips_verifier"] : []),
    ...(control.policy.mode === "disabled" && control.ready === true ? ["disabled_export_marked_ready"] : []),
    ...(control.counters.pendingArtifactCommands > 0 ? ["analytics_export_artifact_commands_pending"] : []),
    ...(control.counters.deniedCapabilities > 0 ? ["analytics_export_denied_capabilities"] : []),
    ...(control.counters.blockers > 0 && control.ready === true ? ["analytics_export_ready_with_blockers"] : []),
    ...(control.truthBoundary.externalWrites === true ? ["analytics_export_truth_boundary_allows_writes"] : []),
    ...(control.truthBoundary.localOnly !== true ? ["analytics_export_truth_boundary_not_local_only"] : []),
    ...(control.truthBoundary.verifierRequiredBeforeAdapter !== true
      ? ["analytics_export_missing_verifier_gate"]
      : [])
  ];
  const blockers = [
    ...control.blockedReasons,
    ...(control.command.reason && !control.ready ? [control.command.reason] : [])
  ];

  if (missing.length === 0 && invalid.length === 0 && blockers.length === 0 && control.ready) {
    return control.status === "degraded_ready" || control.counters.warnings > 0
      ? makeFailure(
          "scheduler-analytics-export-control",
          "scheduler_analytics_export_degraded",
          "Scheduler analytics export is verifier-gated but should be reviewed for degraded snapshots.",
          {
            severity: "warning",
            retryable: true,
            retryAfterSeconds: 0,
            commandId: control.command.id,
            warnings: control.warnings,
            counters: control.counters,
            degradedMode: true
          }
        )
      : makePass("scheduler-analytics-export-control", {
          status: control.status,
          commandId: control.command.id,
          snapshots: control.counters.snapshots,
          format: control.policy.format
        });
  }

  return makeFailure(
    "scheduler-analytics-export-control",
    "scheduler_analytics_export_not_ready",
    "Repair scheduler analytics export control before verifier permits status handoff.",
    {
      retryable: true,
      retryAfterSeconds: 0,
      missing,
      invalid,
      blockers,
      nextAction: control.nextAction || "scheduler.analytics.repair",
      counters: control.counters,
      policy: control.policy
    }
  );
}

function normalizeProviderSyncManifest(manifest = {}) {
  const provider = manifest.provider ?? {};
  const sync = manifest.sync ?? {};
  const persistence = manifest.persistence ?? {};
  const command = manifest.command ?? {};
  const validation = manifest.validation ?? {};
  const truthBoundary = manifest.truthBoundary ?? {};

  return {
    version: normalize(manifest.kind || manifest.manifestVersion),
    apiVersion: normalize(manifest.apiVersion),
    manifestId: normalize(manifest.manifestId),
    jobId: normalize(manifest.jobId),
    status: normalize(manifest.status || "missing").toLowerCase(),
    ready: manifest.ready === true,
    nextAction: normalize(manifest.nextAction),
    disabledReason: normalize(manifest.disabledReason),
    provider: {
      name: normalize(provider.name || "mailchimp"),
      adapter: normalize(provider.adapter),
      mode: normalize(provider.mode),
      checkpoint: normalize(provider.checkpoint),
      cursor: normalize(provider.cursor),
      scopes: normalizeStringList(provider.scopes),
      deniedCapabilities: normalizeList(provider.deniedCapabilities).map((entry) => ({
        capability: normalize(entry.capability),
        reason: normalize(entry.reason || "provider capability denied")
      }))
    },
    sync: {
      direction: normalize(sync.direction),
      source: normalize(sync.source),
      destination: normalize(sync.destination),
      providerResource: normalize(sync.providerResource),
      localNamespace: normalize(sync.localNamespace),
      memoryWritePolicy: normalize(sync.memoryWritePolicy),
      externalHandoff: normalize(sync.externalHandoff || "none"),
      observedStatus: normalize(sync.observedStatus || "not-observed").toLowerCase(),
      observedCheckpoint: normalize(sync.observedCheckpoint),
      checkpointMatched: sync.checkpointMatched === true
    },
    persistence: {
      stateKey: normalize(persistence.stateKey),
      restartToken: normalize(persistence.restartToken),
      checksum: normalize(persistence.checksum),
      namespace: normalize(persistence.namespace),
      localOnly: persistence.localOnly === true,
      writePolicy: normalize(persistence.writePolicy),
      restartSafe: persistence.restartSafe === true,
      previousCheckpoint: normalize(persistence.previousCheckpoint),
      replayToken: normalize(persistence.replayToken)
    },
    command: {
      id: normalize(command.id || command.commandId),
      command: normalize(command.command),
      ready: command.ready === true,
      idempotencyKey: normalize(command.idempotencyKey || command.id),
      reason: normalize(command.reason),
      requiresVerifier: command.requiresVerifier !== false,
      externalWrites: command.externalWrites === true,
      writes: normalizeStringList(command.writes)
    },
    blockedReasons: normalizeStringList(validation.blockedReasons ?? manifest.blockedReasons),
    truthBoundary: {
      externalWrites: truthBoundary.externalWrites === true,
      localOnly: truthBoundary.localOnly !== false,
      verifierRequiredBeforeAdapter: truthBoundary.verifierRequiredBeforeAdapter !== false,
      evidenceSubject: normalize(truthBoundary.evidenceSubject)
    }
  };
}

function checkProviderSyncManifest(job) {
  const manifest = normalizeProviderSyncManifest(job.providerSyncManifest ?? job.providerSync ?? {});
  if (!manifest.version && manifest.status === "missing") {
    return makePass("provider-sync-manifest", {
      status: "not_provided",
      mode: "legacy-provider-contract"
    });
  }

  const requiredProviderScopes = normalizeStringList(
    job.capabilities
      ?.map((capability) => capability.providerScope || capability.scope)
      .filter((scope) => typeof scope === "string" && scope.includes(":read"))
      ?? []
  );
  const knownStatuses = ["ready", "stale", "checkpoint-mismatch", "persistence-required", "blocked"];
  const missing = [
    ...(!hasValue(manifest.manifestId) ? ["manifestId"] : []),
    ...(!hasValue(manifest.jobId) ? ["jobId"] : []),
    ...(!hasValue(manifest.provider.checkpoint) ? ["provider.checkpoint"] : []),
    ...(!hasValue(manifest.sync.localNamespace) ? ["sync.localNamespace"] : []),
    ...(!hasValue(manifest.persistence.stateKey) ? ["persistence.stateKey"] : []),
    ...(!hasValue(manifest.persistence.restartToken) ? ["persistence.restartToken"] : []),
    ...(!hasValue(manifest.persistence.checksum) ? ["persistence.checksum"] : []),
    ...(!hasValue(manifest.command.id) ? ["command.id"] : []),
    ...(!hasValue(manifest.command.idempotencyKey) ? ["command.idempotencyKey"] : []),
    ...(!hasValue(manifest.nextAction) ? ["nextAction"] : [])
  ];
  const invalid = [
    ...(!knownStatuses.includes(manifest.status) ? ["unsupported_provider_sync_status"] : []),
    ...(manifest.jobId && job.id && manifest.jobId !== job.id ? ["jobId:mismatch"] : []),
    ...(manifest.provider.name !== "mailchimp" ? ["provider_sync_not_mailchimp"] : []),
    ...(manifest.ready === true && manifest.status !== "ready" ? ["ready_flag_without_ready_provider_sync"] : []),
    ...(manifest.status === "ready" && manifest.ready !== true ? ["ready_status_without_ready_provider_sync_flag"] : []),
    ...(manifest.command.ready === true && manifest.command.idempotencyKey !== manifest.command.id
      ? ["provider_sync_command_idempotency_mismatch"]
      : []),
    ...(manifest.command.externalWrites === true ? ["provider_sync_command_external_write"] : []),
    ...(manifest.command.requiresVerifier !== true ? ["provider_sync_skips_verifier"] : []),
    ...(manifest.sync.memoryWritePolicy !== "local-only" ? ["provider_sync_not_local_only_memory"] : []),
    ...(manifest.sync.externalHandoff !== "none" ? ["provider_sync_external_handoff_before_verifier"] : []),
    ...(manifest.sync.checkpointMatched !== true && manifest.status === "ready" ? ["ready_provider_sync_checkpoint_unmatched"] : []),
    ...(manifest.persistence.localOnly !== true ? ["provider_sync_persistence_not_local_only"] : []),
    ...(manifest.persistence.restartSafe !== true ? ["provider_sync_persistence_not_restart_safe"] : []),
    ...(manifest.persistence.namespace &&
      job.memory?.namespace &&
      manifest.persistence.namespace !== job.memory.namespace
      ? ["provider_sync_namespace_mismatch"]
      : []),
    ...(manifest.truthBoundary.externalWrites === true ? ["provider_sync_truth_boundary_allows_writes"] : []),
    ...(manifest.truthBoundary.localOnly !== true ? ["provider_sync_truth_boundary_not_local_only"] : []),
    ...(manifest.truthBoundary.verifierRequiredBeforeAdapter !== true
      ? ["provider_sync_missing_verifier_gate"]
      : []),
    ...(requiredProviderScopes.length > 0 &&
      !requiredProviderScopes.every((scope) => manifest.provider.scopes.includes(scope))
      ? ["provider_sync_scope_mismatch"]
      : []),
    ...(manifest.provider.deniedCapabilities.length > 0 ? ["provider_sync_denied_capabilities"] : [])
  ];

  if (missing.length === 0 && invalid.length === 0 && manifest.blockedReasons.length === 0 && manifest.ready) {
    return makePass("provider-sync-manifest", {
      manifestId: manifest.manifestId,
      status: manifest.status,
      checkpoint: manifest.provider.checkpoint,
      commandId: manifest.command.id,
      restartToken: manifest.persistence.restartToken
    });
  }

  return makeFailure(
    "provider-sync-manifest",
    manifest.status === "checkpoint-mismatch"
      ? "provider_sync_checkpoint_mismatch"
      : manifest.status === "stale"
        ? "provider_sync_stale"
        : "provider_sync_manifest_not_ready",
    "Refresh Mailchimp provider sync metadata and local restart state before adapter handoff.",
    {
      retryable: true,
      retryAfterSeconds: manifest.status === "stale" ? 60 : 0,
      missing,
      invalid,
      blockers: manifest.blockedReasons,
      nextAction: manifest.nextAction || "provider.sync.review",
      checkpoint: manifest.provider.checkpoint,
      observedCheckpoint: manifest.sync.observedCheckpoint
    }
  );
}

function buildOperationalState(checks) {
  const failed = checks.filter((check) => !check.passed);
  const retryable = failed.filter((check) => check.retryable);
  const blocking = failed.filter((check) => check.severity !== "warning");
  const maxRetryAfter = retryable.reduce(
    (max, check) => Math.max(max, Number.isFinite(check.retryAfterSeconds) ? check.retryAfterSeconds : 0),
    0
  );

  return {
    status:
      failed.length === 0
        ? "healthy"
        : blocking.length === 0
          ? "degraded"
          : retryable.length === failed.length
            ? "recoverable_failure"
            : "blocked",
    retryable: retryable.length > 0,
    retryAfterSeconds: retryable.length > 0 ? maxRetryAfter : null,
    degradedMode: failed.some((check) => check.degradedMode),
    actionableErrors: failed.map((check) => ({
      check: check.name,
      code: check.code,
      severity: check.severity,
      retryable: check.retryable,
      action: check.recovery
    }))
  };
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeReportStatus(report = {}) {
  return normalize(report.status || "unknown").toLowerCase();
}

function reportTimestamp(report = {}, fallbackIndex = 0) {
  const candidate =
    report.checkedAt ??
    report.generatedAt ??
    report.timestamp ??
    report.operationalState?.checkedAt ??
    report.truthBoundary?.checkedAt;
  const date = candidate ? new Date(candidate) : null;
  if (date && !Number.isNaN(date.getTime())) {
    return date.toISOString();
  }
  return `sequence:${fallbackIndex}`;
}

function summarizeChecks(checks = []) {
  return normalizeList(checks).reduce(
    (summary, check) => {
      const name = normalize(check.name || "unknown");
      if (check.passed) {
        summary.passed += 1;
      } else {
        summary.failed += 1;
        summary.failedChecks.push(name);
      }
      if (check.retryable) {
        summary.retryable += 1;
      }
      if (normalize(check.severity).toLowerCase() === "warning") {
        summary.warnings += 1;
      }
      summary.byCheck[name] = {
        passed: check.passed === true,
        code: normalize(check.code || "unknown"),
        severity: normalize(check.severity || "info"),
        retryable: check.retryable === true
      };
      return summary;
    },
    {
      passed: 0,
      failed: 0,
      retryable: 0,
      warnings: 0,
      failedChecks: [],
      byCheck: {}
    }
  );
}

function normalizeHistoryEntry(entry = {}, index = 0) {
  const report = entry.report ?? entry;
  const checks = summarizeChecks(report.checks ?? []);
  const status = normalizeReportStatus(report);
  const operational = report.operationalState ?? {};
  const timestamp = reportTimestamp(report, index);

  return {
    index,
    timestamp,
    status,
    operationalStatus: normalize(operational.status || status),
    jobId: normalize(entry.jobId ?? report.jobId ?? report.job?.id),
    commandId: normalize(entry.commandId ?? report.commandId ?? report.command?.id),
    preflightCommandId: normalize(
      entry.preflightCommandId ?? report.preflightCommandId ?? report.job?.preflight?.commandId
    ),
    preflightStatus: normalize(entry.preflightStatus ?? report.preflightStatus ?? report.job?.preflight?.status),
    restartLedgerStatus: normalize(
      entry.restartLedgerStatus ?? report.restartLedgerStatus ?? report.job?.restartLedger?.status
    ),
    restartLedgerCommandId: normalize(
      entry.restartLedgerCommandId ?? report.restartLedgerCommandId ?? report.job?.restartLedger?.command?.id
    ),
    restartLedgerReplay: Boolean(
      entry.restartLedgerReplay ?? report.restartLedgerIdempotentReplay ?? report.job?.restartLedger?.idempotentReplay
    ),
    analyticsExportStatus: normalize(
      entry.analyticsExportStatus ??
        report.analyticsExportControlStatus ??
        report.job?.analyticsExportControl?.status
    ),
    analyticsExportCommandId: normalize(
      entry.analyticsExportCommandId ??
        report.analyticsExportCommandId ??
        report.job?.analyticsExportControl?.command?.id
    ),
    analyticsExportReady: Boolean(
      entry.analyticsExportReady ??
        report.analyticsExportReady ??
        report.job?.analyticsExportControl?.ready
    ),
    memoryKey: normalize(entry.memoryKey ?? report.memoryKey ?? report.job?.memory?.memoryKey),
    continuationKey: normalize(
      entry.continuationKey ?? report.continuationKey ?? report.job?.memory?.continuationKey
    ),
    checksum: normalize(entry.checksum ?? report.checksum ?? report.job?.memory?.checksum),
    checks,
    recoveryCount: normalizeList(report.recovery).length,
    retryable: operational.retryable === true || checks.retryable > 0,
    retryAfterSeconds: Number.isFinite(operational.retryAfterSeconds)
      ? operational.retryAfterSeconds
      : null,
    degradedMode: operational.degradedMode === true,
    mayHandoffToAdapter: status === "verified"
  };
}

function aggregateHistory(entries) {
  return entries.reduce(
    (analytics, entry) => {
      analytics.totalReports += 1;
      analytics.statusCounts[entry.status] = (analytics.statusCounts[entry.status] ?? 0) + 1;
      analytics.operationalStatusCounts[entry.operationalStatus] =
        (analytics.operationalStatusCounts[entry.operationalStatus] ?? 0) + 1;
      analytics.failedChecks += entry.checks.failed;
      analytics.passedChecks += entry.checks.passed;
      analytics.warningChecks += entry.checks.warnings;
      analytics.retryableFailures += entry.checks.retryable;
      analytics.recoveryActions += entry.recoveryCount;
      if (entry.retryAfterSeconds !== null) {
        analytics.maxRetryAfterSeconds = Math.max(analytics.maxRetryAfterSeconds, entry.retryAfterSeconds);
      }
      for (const failedCheck of entry.checks.failedChecks) {
        analytics.failedCheckCounts[failedCheck] = (analytics.failedCheckCounts[failedCheck] ?? 0) + 1;
      }
      if (entry.degradedMode) {
        analytics.degradedReports += 1;
      }
      if (entry.mayHandoffToAdapter) {
        analytics.handoffReadyReports += 1;
      }
      if (entry.restartLedgerReplay) {
        analytics.restartReplayReports += 1;
      }
      if (entry.restartLedgerStatus) {
        analytics.restartLedgerStatusCounts[entry.restartLedgerStatus] =
          (analytics.restartLedgerStatusCounts[entry.restartLedgerStatus] ?? 0) + 1;
      }
      if (entry.analyticsExportStatus) {
        analytics.analyticsExportStatusCounts[entry.analyticsExportStatus] =
          (analytics.analyticsExportStatusCounts[entry.analyticsExportStatus] ?? 0) + 1;
      }
      if (entry.analyticsExportReady) {
        analytics.analyticsExportReadyReports += 1;
      }
      return analytics;
    },
    {
      totalReports: 0,
      statusCounts: {},
      operationalStatusCounts: {},
      passedChecks: 0,
      failedChecks: 0,
      warningChecks: 0,
      retryableFailures: 0,
      recoveryActions: 0,
      degradedReports: 0,
      handoffReadyReports: 0,
      restartReplayReports: 0,
      restartLedgerStatusCounts: {},
      analyticsExportReadyReports: 0,
      analyticsExportStatusCounts: {},
      maxRetryAfterSeconds: 0,
      failedCheckCounts: {}
    }
  );
}

export function verifyMailchimpScheduleJob(job = {}, context = {}) {
  const checks = [
    checkCapabilities(job, context.capabilityValidation),
    checkMemory(job, context.memoryContract),
    checkScheduleWindow(job, context),
    checkTruthBoundary(job),
    checkRuntimeScope(job),
    checkPackageControlHandoff(job),
    checkProviderSyncManifest(job),
    checkSchedulerPreflight(job),
    checkClientRuntimeHandoff(job),
    checkSchedulerRestartLedger(job),
    checkSchedulerAnalyticsExportControl(job),
    checkAdapterHandoffEnvelope(job),
    checkAdapterHealth(context)
  ];
  const failed = checks.filter((check) => !check.passed);
  const operationalState = buildOperationalState(checks);

  return {
    reportVersion: "aios.mailchimp.verifier.v1",
    jobId: normalize(job.id),
    memoryKey: normalize(job.memory?.memoryKey),
    continuationKey: normalize(job.memory?.continuationKey),
    checksum: normalize(job.memory?.checksum),
    preflightCommandId: normalize(job.preflight?.commandId),
    preflightStatus: normalize(job.preflight?.status),
    packageControlHandoffId: normalize(job.packageControl?.handoffId),
    packageControlStatus: normalize(job.packageControl?.status),
    packageControlNextAction: normalize(job.packageControl?.nextAction),
    providerSyncManifestId: normalize(job.providerSyncManifest?.manifestId ?? job.providerSync?.manifestId),
    providerSyncStatus: normalize(job.providerSyncManifest?.status ?? job.providerSync?.status),
    providerSyncCheckpoint: normalize(job.providerSyncManifest?.provider?.checkpoint ?? job.providerSync?.provider?.checkpoint),
    clientRuntimeAdoptionKey: normalize(job.clientRuntimeHandoff?.adoptionKey),
    clientRuntimeStatus: normalize(job.clientRuntimeHandoff?.status),
    restartLedgerStatus: normalize(job.restartLedger?.status),
    restartLedgerCommandId: normalize(job.restartLedger?.command?.id),
    restartLedgerIdempotentReplay: job.restartLedger?.idempotentReplay === true,
    analyticsExportControlStatus: normalize(job.analyticsExportControl?.status),
    analyticsExportCommandId: normalize(job.analyticsExportControl?.command?.id),
    analyticsExportReady: job.analyticsExportControl?.ready === true,
    status: failed.length === 0 ? "verified" : operationalState.status === "degraded" ? "degraded" : "blocked",
    operationalState,
    checks,
    recovery: failed
      .filter((check) => check.recovery)
      .map((check) => ({
        check: check.name,
        code: check.code,
        retryable: check.retryable,
        retryAfterSeconds: check.retryAfterSeconds ?? null,
        action: check.recovery
      })),
    rollback: {
      required: failed.some((check) => check.severity !== "warning"),
      strategy:
        failed.some((check) => check.severity !== "warning")
          ? "do-not-call-mailchimp-adapter"
          : "adapter-may-register-cancellable-scheduled-send"
    },
    truthBoundary: {
      source: "deterministic-local-verifier",
      externalWrites: false,
      evidence: checks.map((check) => ({ name: check.name, passed: check.passed, code: check.code })),
      packageControlHandoffId: normalize(job.packageControl?.handoffId),
      preflightCommandId: normalize(job.preflight?.commandId),
      clientRuntimeAdoptionKey: normalize(job.clientRuntimeHandoff?.adoptionKey),
      restartLedgerCommandId: normalize(job.restartLedger?.command?.id),
      analyticsExportCommandId: normalize(job.analyticsExportControl?.command?.id)
    }
  };
}

export function summarizeMailchimpVerifierReport(report = {}) {
  const failed = (report.checks ?? []).filter((check) => !check.passed);
  return {
    status: report.status ?? (failed.length === 0 ? "verified" : "blocked"),
    failedChecks: failed.map((check) => check.name),
    recoveryCount: report.recovery?.length ?? failed.length,
    mayHandoffToAdapter: (report.status ?? "blocked") === "verified",
    operationalState: report.operationalState ?? {
      status: failed.length === 0 ? "healthy" : "blocked",
      retryable: failed.some((check) => check.retryable === true),
      retryAfterSeconds: null,
      degradedMode: false,
      actionableErrors: failed.map((check) => ({
        check: check.name,
        code: check.code,
        severity: check.severity ?? "error",
        retryable: check.retryable === true,
        action: check.recovery ?? null
      }))
    },
    truthBoundary: report.truthBoundary ?? {
      source: "unknown",
      externalWrites: false
    },
    preflight: {
      commandId: normalize(report.preflightCommandId),
      status: normalize(report.preflightStatus || "unknown"),
      checked: (report.checks ?? []).some((check) => check.name === "scheduler-preflight")
    },
    clientRuntime: {
      adoptionKey: normalize(report.clientRuntimeAdoptionKey),
      status: normalize(report.clientRuntimeStatus || "unknown"),
      checked: (report.checks ?? []).some((check) => check.name === "client-runtime-handoff")
    },
    restartLedger: {
      status: normalize(report.restartLedgerStatus || "unknown"),
      commandId: normalize(report.restartLedgerCommandId),
      idempotentReplay: report.restartLedgerIdempotentReplay === true,
      checked: (report.checks ?? []).some((check) => check.name === "scheduler-restart-ledger")
    },
    analyticsExport: {
      status: normalize(report.analyticsExportControlStatus || "unknown"),
      commandId: normalize(report.analyticsExportCommandId),
      ready: report.analyticsExportReady === true,
      checked: (report.checks ?? []).some((check) => check.name === "scheduler-analytics-export-control")
    }
  };
}

export function verifyMailchimpOperationalReadiness(job = {}, context = {}) {
  const report = verifyMailchimpScheduleJob(job, context);
  return {
    readinessVersion: "aios.mailchimp.operational-readiness.v1",
    status: report.status === "verified" ? "ready" : report.operationalState.status,
    mayHandoffToAdapter: report.status === "verified",
    retry: {
      retryable: report.operationalState.retryable,
      retryAfterSeconds: report.operationalState.retryAfterSeconds,
      degradedMode: report.operationalState.degradedMode
    },
    errors: report.operationalState.actionableErrors,
    recovery: report.recovery,
    preflight: {
      commandId: normalize(report.preflightCommandId),
      status: normalize(report.preflightStatus || "unknown"),
      checked: report.checks.some((check) => check.name === "scheduler-preflight")
    },
    restartLedger: {
      status: normalize(report.restartLedgerStatus || "unknown"),
      commandId: normalize(report.restartLedgerCommandId),
      idempotentReplay: report.restartLedgerIdempotentReplay === true,
      checked: report.checks.some((check) => check.name === "scheduler-restart-ledger")
    },
    analyticsExport: {
      status: normalize(report.analyticsExportControlStatus || "unknown"),
      commandId: normalize(report.analyticsExportCommandId),
      ready: report.analyticsExportReady === true,
      checked: report.checks.some((check) => check.name === "scheduler-analytics-export-control")
    },
    truthBoundary: report.truthBoundary
  };
}

export function buildMailchimpLifecycleControlPlan(job = {}, lifecycle = {}, context = {}) {
  const report = verifyMailchimpScheduleJob(job, context);
  const summary = summarizeMailchimpVerifierReport(report);
  const lifecycleEnabled = lifecycle.enabled !== false;
  const controls = lifecycle.controls ?? {};
  const schedule = normalizeScheduleState(lifecycle.schedule ?? {});
  const commandQueue = normalizeList(lifecycle.commandQueue);
  const blockedReasons = uniqueSorted([
    ...summary.operationalState.actionableErrors.map((error) => error.action || error.code),
    ...normalizeList(lifecycle.validation?.errors),
    ...schedule.blockedReasons
  ].filter(Boolean));
  const approvalCommand = commandQueue.find((command) => command.command === "package.approval.request");
  const runnableCommand = commandQueue.find((command) => (
    command.command === "package.preview" || command.command === "package.run"
  ));
  const verifierReady = summary.mayHandoffToAdapter && blockedReasons.length === 0;
  const commandPlan = buildLifecycleCommandPlan({
    lifecycleEnabled,
    controls,
    schedule,
    report,
    blockedReasons,
    approvalCommand,
    runnableCommand
  });

  return {
    controlPlanVersion: "aios.mailchimp.lifecycle-control-plan.v1",
    jobId: normalize(job.id),
    status: deriveControlPlanStatus(lifecycleEnabled, verifierReady, summary, schedule),
    verifier: {
      status: summary.status,
      mayHandoffToAdapter: summary.mayHandoffToAdapter,
      failedChecks: summary.failedChecks,
      retryable: summary.operationalState.retryable,
      retryAfterSeconds: summary.operationalState.retryAfterSeconds
    },
    lifecycle: {
      enabled: lifecycleEnabled,
      nextAction: normalize(lifecycle.nextAction || commandPlan.primaryAction),
      schedule,
      dryRun: lifecycle.dryRun !== false,
      validationValid: lifecycle.validation?.valid !== false,
      approvalRequired: Boolean(approvalCommand)
    },
    controls: commandPlan.controls,
    commandPlan: {
      primaryAction: commandPlan.primaryAction,
      commands: commandPlan.commands,
      blockedReasons,
      recoveryAction: blockedReasons.length > 0
        ? "resolve-lifecycle-or-verifier-blockers"
        : "continue-read-only-mailchimp-handoff"
    },
    nextActionState: {
      action: commandPlan.primaryAction,
      label: buildControlActionLabel(commandPlan.primaryAction),
      ready: verifierReady && commandPlan.commands.some((command) => command.ready),
      disabledReason: commandPlan.disabledReason,
      retryAfterSeconds: summary.operationalState.retryAfterSeconds,
      truthBoundary: report.truthBoundary
    }
  };
}

export function buildMailchimpVerifierHistory(reports = []) {
  const entries = normalizeList(reports).map(normalizeHistoryEntry);
  const analytics = aggregateHistory(entries);
  const last = entries[entries.length - 1] ?? null;

  return {
    historyVersion: "aios.mailchimp.verifier-history.v1",
    status:
      !last
        ? "empty"
        : last.mayHandoffToAdapter
          ? "ready"
          : last.retryable
            ? "recoverable"
            : "blocked",
    entries,
    analytics,
    latest: last,
    timeline: entries.map((entry) => ({
      timestamp: entry.timestamp,
      status: entry.status,
      operationalStatus: entry.operationalStatus,
      failedChecks: entry.checks.failedChecks,
      retryable: entry.retryable,
      retryAfterSeconds: entry.retryAfterSeconds,
      memoryKey: entry.memoryKey,
      continuationKey: entry.continuationKey,
      commandId: entry.commandId,
      preflightCommandId: entry.preflightCommandId,
      preflightStatus: entry.preflightStatus,
      restartLedgerStatus: entry.restartLedgerStatus,
      restartLedgerCommandId: entry.restartLedgerCommandId,
      restartLedgerReplay: entry.restartLedgerReplay,
      analyticsExportStatus: entry.analyticsExportStatus,
      analyticsExportCommandId: entry.analyticsExportCommandId,
      analyticsExportReady: entry.analyticsExportReady
    })),
    exportReady: true,
    truthBoundary: {
      source: "deterministic-local-verifier-history",
      externalWrites: false,
      reportCount: entries.length
    }
  };
}

function normalizeVerifierExportDestination(destination = {}) {
  const target = normalize(destination.target || destination.name || "local-verifier-health");
  const format = normalize(destination.format || "json.summary").toLowerCase();
  const allowedFormats = ["json.summary", "json.timeline", "json.analytics"];
  const retentionDays = Number.isFinite(destination.retentionDays)
    ? Math.max(1, Math.floor(destination.retentionDays))
    : 30;

  return {
    target,
    format: allowedFormats.includes(format) ? format : "json.summary",
    retentionDays,
    localOnly: destination.localOnly !== false,
    ready: target.length > 0 && destination.localOnly !== false,
    blockedReasons: [
      ...(target ? [] : ["export destination target is required"]),
      ...(destination.localOnly === false ? ["verifier exports must remain local-only before adapter handoff"] : [])
    ]
  };
}

function normalizeVerifierExportWindow(options = {}, history) {
  const entries = history.entries;
  const requestedLimit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : entries.length;
  const limit = entries.length === 0 ? 0 : Math.min(entries.length, requestedLimit || entries.length);
  const selected = limit > 0 ? entries.slice(-limit) : [];
  const first = selected[0] ?? null;
  const last = selected[selected.length - 1] ?? null;

  return {
    limit,
    from: normalize(options.from || first?.timestamp || "empty"),
    to: normalize(options.to || last?.timestamp || "empty"),
    selectedCount: selected.length,
    selectedIndexes: selected.map((entry) => entry.index)
  };
}

function buildVerifierExportCounters(history, selectedEntries) {
  const counters = selectedEntries.reduce(
    (summary, entry) => {
      summary.reports += 1;
      summary.passedChecks += entry.checks.passed;
      summary.failedChecks += entry.checks.failed;
      summary.warningChecks += entry.checks.warnings;
      summary.retryableFailures += entry.checks.retryable;
      summary.recoveryActions += entry.recoveryCount;
      if (entry.status === "verified") {
        summary.verifiedReports += 1;
      }
      if (entry.status === "blocked") {
        summary.blockedReports += 1;
      }
      if (entry.status === "degraded") {
        summary.degradedReports += 1;
      }
      if (entry.mayHandoffToAdapter) {
        summary.adapterReadyReports += 1;
      }
      if (entry.restartLedgerReplay) {
        summary.restartReplayReports += 1;
      }
      if (entry.retryAfterSeconds !== null) {
        summary.maxRetryAfterSeconds = Math.max(summary.maxRetryAfterSeconds, entry.retryAfterSeconds);
      }
      for (const checkName of entry.checks.failedChecks) {
        summary.failedCheckCounts[checkName] = (summary.failedCheckCounts[checkName] ?? 0) + 1;
      }
      if (entry.preflightStatus) {
        summary.preflightStatusCounts[entry.preflightStatus] =
          (summary.preflightStatusCounts[entry.preflightStatus] ?? 0) + 1;
      }
      if (entry.restartLedgerStatus) {
        summary.restartLedgerStatusCounts[entry.restartLedgerStatus] =
          (summary.restartLedgerStatusCounts[entry.restartLedgerStatus] ?? 0) + 1;
      }
      return summary;
    },
    {
      reports: 0,
      verifiedReports: 0,
      blockedReports: 0,
      degradedReports: 0,
      adapterReadyReports: 0,
      restartReplayReports: 0,
      passedChecks: 0,
      failedChecks: 0,
      warningChecks: 0,
      retryableFailures: 0,
      recoveryActions: 0,
      maxRetryAfterSeconds: 0,
      failedCheckCounts: {},
      preflightStatusCounts: {},
      restartLedgerStatusCounts: {}
    }
  );

  return {
    ...counters,
    allReports: history.analytics.totalReports,
    omittedReports: Math.max(0, history.analytics.totalReports - counters.reports),
    failureRate:
      counters.reports === 0
        ? 0
        : Number((counters.blockedReports / counters.reports).toFixed(4)),
    warningRate:
      counters.reports === 0
        ? 0
        : Number((counters.warningChecks / Math.max(1, counters.passedChecks + counters.failedChecks)).toFixed(4))
  };
}

function deriveVerifierExportReadiness(history, counters, destination) {
  const latest = history.latest;
  const blockedReasons = [
    ...destination.blockedReasons,
    ...(!latest ? ["no verifier reports available"] : []),
    ...(latest && latest.status === "blocked" && !latest.retryable ? ["latest verifier report is blocked"] : []),
    ...(counters.failedChecks > 0 && counters.retryableFailures === 0 ? ["failed checks require repair"] : [])
  ];
  const retryable = Boolean(
    latest?.retryable ||
    counters.retryableFailures > 0 ||
    latest?.operationalStatus === "recoverable_failure" ||
    latest?.operationalStatus === "degraded"
  );
  const ready = blockedReasons.length === 0 && destination.ready && Boolean(latest);

  return {
    ready,
    status:
      ready
        ? "ready"
        : retryable
          ? "retryable"
          : "blocked",
    retryable,
    retryAfterSeconds:
      retryable
        ? ((latest?.retryAfterSeconds ?? counters.maxRetryAfterSeconds) || 30)
        : null,
    blockedReasons,
    nextAction:
      ready
        ? "verifier.export.write-local-summary"
        : retryable
          ? "verifier.retry-after-backoff"
          : blockedReasons.includes("no verifier reports available")
            ? "verifier.run"
            : "verifier.repair"
  };
}

function buildVerifierExportTimeline(selectedEntries) {
  return selectedEntries.map((entry) => ({
    index: entry.index,
    timestamp: entry.timestamp,
    status: entry.status,
    operationalStatus: entry.operationalStatus,
    jobId: entry.jobId,
    commandId: entry.commandId,
    preflight: {
      commandId: entry.preflightCommandId,
      status: entry.preflightStatus
    },
      restartLedger: {
        status: entry.restartLedgerStatus,
        commandId: entry.restartLedgerCommandId,
        idempotentReplay: entry.restartLedgerReplay
      },
      analyticsExport: {
        status: entry.analyticsExportStatus,
        commandId: entry.analyticsExportCommandId,
        ready: entry.analyticsExportReady
      },
    checks: {
      passed: entry.checks.passed,
      failed: entry.checks.failed,
      warnings: entry.checks.warnings,
      failedChecks: entry.checks.failedChecks
    },
    retry: {
      retryable: entry.retryable,
      retryAfterSeconds: entry.retryAfterSeconds,
      degradedMode: entry.degradedMode
    },
    mayHandoffToAdapter: entry.mayHandoffToAdapter
  }));
}

export function createMailchimpVerifierExportSummary(reports = [], options = {}) {
  const reportList = Array.isArray(reports) ? reports : [reports];
  const history = buildMailchimpVerifierHistory(reportList);
  const destination = normalizeVerifierExportDestination(options.destination ?? options.export ?? {});
  const window = normalizeVerifierExportWindow(options.window ?? options, history);
  const selectedEntries = window.selectedIndexes.map((index) => history.entries[index]).filter(Boolean);
  const counters = buildVerifierExportCounters(history, selectedEntries);
  const readiness = deriveVerifierExportReadiness(history, counters, destination);
  const latest = history.latest;
  const exportId = [
    "verifier_export",
    normalize(latest?.jobId || "empty"),
    normalize(latest?.commandId || "no-command"),
    readiness.status,
    counters.reports,
    counters.failedChecks
  ]
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_");

  return {
    exportVersion: "aios.mailchimp.verifier-export-summary.v1",
    exportId,
    generatedAt: normalize(options.generatedAt || "logical:0"),
    status: readiness.status,
    destination,
    window,
    readiness,
    counters,
    latest: latest
      ? {
          timestamp: latest.timestamp,
          status: latest.status,
          operationalStatus: latest.operationalStatus,
          jobId: latest.jobId,
          commandId: latest.commandId,
          preflightCommandId: latest.preflightCommandId,
          preflightStatus: latest.preflightStatus,
          restartLedgerStatus: latest.restartLedgerStatus,
          restartLedgerCommandId: latest.restartLedgerCommandId,
          analyticsExportStatus: latest.analyticsExportStatus,
          analyticsExportCommandId: latest.analyticsExportCommandId,
          analyticsExportReady: latest.analyticsExportReady,
          failedChecks: latest.checks.failedChecks,
          retryable: latest.retryable,
          retryAfterSeconds: latest.retryAfterSeconds
        }
      : null,
    timeline: buildVerifierExportTimeline(selectedEntries),
    summary: {
      message:
        readiness.ready
          ? `verifier export ready with ${counters.reports} report(s)`
          : `verifier export ${readiness.status}: ${readiness.blockedReasons[0] ?? "retry pending"}`,
      failedChecks: Object.keys(counters.failedCheckCounts).sort(),
      dominantFailure:
        Object.entries(counters.failedCheckCounts)
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .at(0)?.[0] ?? null,
      nextAction: readiness.nextAction
    },
    truthBoundary: {
      source: "deterministic-local-verifier-export-summary",
      externalWrites: false,
      localOnly: destination.localOnly,
      reportCount: counters.reports,
      latestJobId: latest?.jobId ?? null
    }
  };
}

function normalizeScheduleState(schedule = {}) {
  const mode = normalize(schedule.mode || "manual").toLowerCase();
  const safeMode = ["manual", "disabled", "interval"].includes(mode) ? mode : "manual";
  const blockedReasons = [];
  if (safeMode === "disabled") {
    blockedReasons.push("schedule is disabled");
  }

  return {
    mode: safeMode,
    intervalMinutes: Number.isFinite(schedule.intervalMinutes) ? schedule.intervalMinutes : null,
    startsAt: normalize(schedule.startsAt || "logical:0"),
    blockedReasons
  };
}

function buildLifecycleCommandPlan(input) {
  const commands = [];
  const controls = {
    enable: normalizeControl(input.controls.enable, !input.lifecycleEnabled),
    disable: normalizeControl(input.controls.disable, input.lifecycleEnabled),
    runNow: normalizeControl(input.controls.runNow, input.lifecycleEnabled && input.schedule.mode !== "disabled"),
    approve: normalizeControl(input.controls.approve, Boolean(input.approvalCommand)),
    reschedule: normalizeControl(input.controls.reschedule, input.lifecycleEnabled)
  };

  if (!input.lifecycleEnabled) {
    commands.push({
      command: "package.enable",
      ready: controls.enable.allowed,
      reason: "enable lifecycle before verifier handoff"
    });
  } else if (input.schedule.mode === "disabled") {
    commands.push({
      command: "package.schedule.update",
      ready: controls.reschedule.allowed,
      reason: "choose manual or interval scheduling before verifier handoff"
    });
  } else if (input.report.status !== "verified") {
    for (const recovery of input.report.recovery) {
      commands.push({
        command: recovery.retryable ? "verifier.retry" : "verifier.repair",
        ready: recovery.retryable,
        reason: recovery.action,
        retryAfterSeconds: recovery.retryAfterSeconds
      });
    }
  } else if (input.approvalCommand) {
    commands.push({
      command: input.approvalCommand.command,
      ready: input.approvalCommand.ready,
      reason: input.approvalCommand.reason
    });
  } else if (input.runnableCommand) {
    commands.push({
      command: input.runnableCommand.command,
      ready: input.runnableCommand.ready && input.blockedReasons.length === 0,
      reason: input.runnableCommand.reason,
      jobId: input.runnableCommand.jobId
    });
  }

  const readyCommand = commands.find((command) => command.ready);
  const primaryAction = readyCommand?.command
    ?? commands[0]?.command
    ?? (input.report.status === "verified" ? "package.preview" : "verifier.repair");

  return {
    controls,
    commands,
    primaryAction,
    disabledReason: readyCommand ? null : commands[0]?.reason ?? null
  };
}

function normalizeControl(control = {}, fallbackAllowed = false) {
  return {
    allowed: Boolean(control.allowed ?? fallbackAllowed),
    command: normalize(control.command || "package.control"),
    disabledReason: control.disabledReason ? normalize(control.disabledReason) : null
  };
}

function deriveControlPlanStatus(lifecycleEnabled, verifierReady, summary, schedule) {
  if (!lifecycleEnabled) {
    return "disabled";
  }
  if (schedule.mode === "disabled") {
    return "schedule-paused";
  }
  if (verifierReady) {
    return "ready";
  }
  if (summary.operationalState.retryable) {
    return "recoverable";
  }
  return "blocked";
}

function buildControlActionLabel(action) {
  const labels = {
    "package.enable": "Enable package",
    "package.schedule.update": "Update schedule",
    "package.approval.request": "Request approval",
    "package.preview": "Preview local summary",
    "package.run": "Run local handoff",
    "verifier.retry": "Retry verifier",
    "verifier.repair": "Repair verifier blockers"
  };
  return labels[action] ?? "Continue";
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

export function exportMailchimpVerifierSummary(input = {}) {
  const history = input.historyVersion
    ? input
    : buildMailchimpVerifierHistory(input.reports ?? input.history ?? []);
  const latest = history.latest ?? null;
  const analytics = history.analytics ?? aggregateHistory([]);
  const blockedChecks = Object.entries(analytics.failedCheckCounts ?? {})
    .sort(([leftName, leftCount], [rightName, rightCount]) =>
      rightCount === leftCount ? leftName.localeCompare(rightName) : rightCount - leftCount
    )
    .map(([name, count]) => ({ name, count }));

  return {
    exportVersion: "aios.mailchimp.verifier-export.v1",
    status: history.status ?? "empty",
    generatedFrom: history.historyVersion ?? "aios.mailchimp.verifier-history.v1",
    counters: {
      totalReports: analytics.totalReports ?? 0,
      verified: analytics.statusCounts?.verified ?? 0,
      blocked: analytics.statusCounts?.blocked ?? 0,
      degraded: analytics.statusCounts?.degraded ?? 0,
      failedChecks: analytics.failedChecks ?? 0,
      warningChecks: analytics.warningChecks ?? 0,
      retryableFailures: analytics.retryableFailures ?? 0,
      recoveryActions: analytics.recoveryActions ?? 0,
      handoffReadyReports: analytics.handoffReadyReports ?? 0,
      restartReplayReports: analytics.restartReplayReports ?? 0,
      analyticsExportReadyReports: analytics.analyticsExportReadyReports ?? 0,
      analyticsExportStatusCounts: analytics.analyticsExportStatusCounts ?? {}
    },
    latest: latest
      ? {
          timestamp: latest.timestamp,
          status: latest.status,
          operationalStatus: latest.operationalStatus,
          jobId: latest.jobId,
          memoryKey: latest.memoryKey,
          continuationKey: latest.continuationKey,
          checksum: latest.checksum,
          preflightCommandId: latest.preflightCommandId,
          preflightStatus: latest.preflightStatus,
          restartLedgerStatus: latest.restartLedgerStatus,
          restartLedgerCommandId: latest.restartLedgerCommandId,
          restartLedgerReplay: latest.restartLedgerReplay,
          analyticsExportStatus: latest.analyticsExportStatus,
          analyticsExportCommandId: latest.analyticsExportCommandId,
          analyticsExportReady: latest.analyticsExportReady,
          failedChecks: latest.checks.failedChecks,
          retryable: latest.retryable,
          retryAfterSeconds: latest.retryAfterSeconds
        }
      : null,
    blockedChecks,
    timeline: history.timeline ?? [],
    nextAction:
      history.status === "ready"
        ? "handoff-to-runtime-adapter"
        : latest?.retryable
          ? "retry-after-backoff-or-refresh-runtime-state"
          : analytics.totalReports > 0
            ? "repair-blocking-verifier-checks"
            : "run-verifier-before-adapter-handoff",
    truthBoundary: {
      source: "deterministic-local-verifier-export",
      externalWrites: false,
      reportCount: analytics.totalReports ?? 0
    }
  };
}
