const DIRECTIVE_PREFIX = "@aios";
const DIRECTIVE_FIELDS = new Set(["capability", "claim", "disable", "enable", "handoff", "memory", "provider", "recover", "schedule", "service", "setting", "status", "sync", "truth", "verifier"]);
const EXPORT_FIELDS = new Set(["capability", "claim", "handoff", "memory", "provider", "service", "status", "sync", "truth", "verifier"]);
const LIFECYCLE_FIELDS = new Set(["disable", "enable", "recover", "schedule", "setting"]);
const PROVIDER_FIELDS = new Set(["handoff", "provider", "service", "sync"]);

function location(line = 1, column = 1, offset = 0) {
  return Object.freeze({ line, column, offset });
}

function commentDiagnostic(code, message, at, severity = "warning", recovery = "inspect_comment") {
  return Object.freeze({
    code,
    severity,
    message,
    line: at.line,
    column: at.column,
    offset: at.offset,
    recovery,
  });
}

function advancePosition(state, char) {
  state.offset += 1;
  if (char === "\n") {
    state.line += 1;
    state.column = 1;
  } else {
    state.column += 1;
  }
}

function readLineComment(source, state) {
  const start = location(state.line, state.column, state.offset);
  let raw = "";
  while (state.offset < source.length && source[state.offset] !== "\n") {
    raw += source[state.offset];
    advancePosition(state, source[state.offset]);
  }
  return {
    kind: "line",
    raw,
    text: raw.replace(/^\/\//, "").trim(),
    range: Object.freeze({ start, end: location(state.line, state.column, state.offset) }),
  };
}

function readBlockComment(source, state, diagnostics) {
  const start = location(state.line, state.column, state.offset);
  let raw = "";
  let closed = false;
  while (state.offset < source.length) {
    const char = source[state.offset];
    const next = source[state.offset + 1] ?? "";
    raw += char;
    advancePosition(state, char);
    if (char === "*" && next === "/") {
      raw += next;
      advancePosition(state, next);
      closed = true;
      break;
    }
  }
  if (!closed) {
    diagnostics.push(commentDiagnostic("AIOS_COMMENT_UNTERMINATED", "Unterminated block comment.", start, "error", "close_block_comment"));
  }
  return {
    kind: "block",
    raw,
    text: raw.replace(/^\/\*/, "").replace(/\*\/$/, "").trim(),
    range: Object.freeze({ start, end: location(state.line, state.column, state.offset) }),
  };
}

function parseDirective(comment, diagnostics) {
  const text = comment.text.replace(/^\*+/, "").trim();
  if (!text.startsWith(DIRECTIVE_PREFIX)) return null;

  const parts = text.split(/\s+/).filter(Boolean);
  const field = parts[1] ?? "";
  const value = parts.slice(2).join(" ").trim();
  if (!DIRECTIVE_FIELDS.has(field)) {
    diagnostics.push(commentDiagnostic(
      "AIOS_COMMENT_DIRECTIVE_FIELD",
      `Unsupported AI OS comment directive "${field || "<missing>"}".`,
      comment.range.start,
      "warning",
      "rename_comment_directive",
    ));
  }
  if (!value) {
    diagnostics.push(commentDiagnostic(
      "AIOS_COMMENT_DIRECTIVE_VALUE",
      `AI OS comment directive "${field || "<missing>"}" requires a value.`,
      comment.range.start,
      "warning",
      "add_comment_directive_value",
    ));
  }
  validateLifecycleDirective(field, value, comment.range.start, diagnostics);

  return Object.freeze({
    schema: "aios.comment.directive.v1",
    field: field || "unknown",
    value,
    raw: text,
    range: comment.range,
    contractRole: DIRECTIVE_FIELDS.has(field) ? field : "unknown",
  });
}

function parseSettingValue(value) {
  const [key, ...rest] = String(value ?? "").split("=");
  return Object.freeze({
    key: key.trim(),
    value: rest.join("=").trim(),
    valid: Boolean(key.trim() && rest.length > 0 && rest.join("=").trim()),
  });
}

function parseScheduleValue(value) {
  const text = String(value ?? "").trim();
  const interval = text.match(/^(every)\s+(\d+)(m|h|d)$/i);
  const atTime = text.match(/^(at)\s+([0-2]\d:[0-5]\d)$/i);
  return Object.freeze({
    raw: text,
    mode: interval ? "interval" : atTime ? "clock" : "manual",
    cadence: interval ? `${interval[2]}${interval[3].toLowerCase()}` : atTime ? atTime[2] : "",
    valid: Boolean(interval || atTime || text === "manual"),
  });
}

function parseKeyValueTokens(value) {
  return Object.freeze(String(value ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const [key, ...rest] = token.split("=");
      return Object.freeze({
        key: key.trim(),
        value: rest.join("=").trim(),
        hasValue: rest.length > 0,
      });
    }));
}

function providerValueFromTokens(value, fallbackKey = "service") {
  const tokens = parseKeyValueTokens(value);
  const named = Object.fromEntries(tokens
    .filter((token) => token.hasValue && token.key)
    .map((token) => [token.key, token.value]));
  const firstBare = tokens.find((token) => !token.hasValue)?.key ?? "";
  return Object.freeze({
    raw: String(value ?? "").trim(),
    fallbackKey,
    firstBare,
    named: Object.freeze(named),
    valid: Boolean(firstBare || Object.keys(named).length > 0),
  });
}

function parseCapabilities(value) {
  return Object.freeze(String(value ?? "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .sort());
}

function parseProviderDirective(field, value) {
  const parsed = providerValueFromTokens(value, field === "sync" ? "mode" : "service");
  if (field === "provider" || field === "service") {
    const service = parsed.named.service || parsed.named.name || parsed.firstBare;
    return Object.freeze({
      field,
      service,
      adapter: parsed.named.adapter || parsed.named.provider || service || "mailchimp",
      statusChannel: parsed.named.status || parsed.named.channel || "",
      capabilities: parseCapabilities(parsed.named.capabilities || parsed.named.capability || ""),
      raw: parsed.raw,
      valid: parsed.valid && Boolean(service),
    });
  }
  if (field === "sync") {
    const mode = parsed.named.mode || parsed.firstBare || "local";
    const external = parsed.named.external || parsed.named.write || "off";
    return Object.freeze({
      field,
      mode,
      externalWriteRequested: ["on", "true", "yes", "write", "external"].includes(external.toLowerCase()),
      checkpoint: parsed.named.checkpoint || parsed.named.cursor || "",
      raw: parsed.raw,
      valid: ["local", "manual", "deferred", "pull", "push", "provider"].includes(mode.toLowerCase()),
    });
  }
  const target = parsed.named.target || parsed.named.channel || parsed.firstBare;
  return Object.freeze({
    field,
    target,
    statusChannel: parsed.named.status || parsed.named.channel || target,
    adapter: parsed.named.adapter || "",
    raw: parsed.raw,
    valid: Boolean(target),
  });
}

function validateLifecycleDirective(field, value, at, diagnostics) {
  if (field === "setting") {
    const setting = parseSettingValue(value);
    if (!setting.valid) {
      diagnostics.push(commentDiagnostic(
        "AIOS_COMMENT_SETTING_VALUE",
        "AI OS setting directive requires key=value.",
        at,
        "warning",
        "repair_comment_setting",
      ));
    }
  }
  if (field === "schedule") {
    const schedule = parseScheduleValue(value);
    if (!schedule.valid) {
      diagnostics.push(commentDiagnostic(
        "AIOS_COMMENT_SCHEDULE_VALUE",
        "AI OS schedule directive requires 'every <number><m|h|d>', 'at HH:MM', or 'manual'.",
        at,
        "warning",
        "repair_comment_schedule",
      ));
    }
  }
  if (PROVIDER_FIELDS.has(field)) {
    const provider = parseProviderDirective(field, value);
    if (!provider.valid) {
      diagnostics.push(commentDiagnostic(
        "AIOS_COMMENT_PROVIDER_VALUE",
        "AI OS provider directives require a service, sync mode, or handoff target.",
        at,
        "warning",
        "repair_comment_provider_contract",
      ));
    }
  }
}

function deriveCommentContract(comment, directives) {
  const directive = directives.find((item) => item.range.start.offset === comment.range.start.offset);
  return Object.freeze({
    schema: "aios.comment.contract.v1",
    kind: comment.kind,
    text: comment.text,
    range: comment.range,
    directive: directive ?? null,
    exportsToKernel: Boolean(directive && EXPORT_FIELDS.has(directive.field)),
    lifecycleControl: Boolean(directive && LIFECYCLE_FIELDS.has(directive.field)),
    recoveryHint: directive?.field === "recover" ? directive.value : null,
  });
}

function buildCommentLifecycleState(directives, diagnostics) {
  const controls = directives.filter((directive) => LIFECYCLE_FIELDS.has(directive.field));
  const enabled = controls.filter((directive) => directive.field === "enable").map((directive) => directive.value);
  const disabled = controls.filter((directive) => directive.field === "disable").map((directive) => directive.value);
  const settings = Object.fromEntries(controls
    .filter((directive) => directive.field === "setting")
    .map((directive) => parseSettingValue(directive.value))
    .filter((setting) => setting.valid)
    .map((setting) => [setting.key, setting.value])
    .sort(([left], [right]) => left.localeCompare(right)));
  const schedules = controls
    .filter((directive) => directive.field === "schedule")
    .map((directive) => Object.freeze({
      value: directive.value,
      parsed: parseScheduleValue(directive.value),
      range: directive.range,
    }));
  const recoveries = controls.filter((directive) => directive.field === "recover").map((directive) => directive.value);
  const lifecycleWarnings = diagnostics.filter((item) => item.code === "AIOS_COMMENT_SETTING_VALUE" || item.code === "AIOS_COMMENT_SCHEDULE_VALUE");
  const disabledSet = new Set(disabled);
  return Object.freeze({
    schema: "aios.comment.lifecycle.v1",
    enabled: Object.freeze(enabled.filter((value) => !disabledSet.has(value))),
    disabled: Object.freeze(disabled),
    settings: Object.freeze(settings),
    schedules: Object.freeze(schedules),
    recoveryHints: Object.freeze(recoveries),
    controls: Object.freeze(controls),
    active: disabled.length === 0 || enabled.length > 0,
    valid: lifecycleWarnings.length === 0,
    nextAction: lifecycleWarnings[0]?.recovery ?? (schedules.length > 0 ? "schedule_comment_contracts" : enabled.length > 0 ? "enable_comment_contracts" : "attach_comment_contracts"),
  });
}

function buildCommentLifecycleReadiness(lifecycle, runtimeState, providerContract, diagnostics) {
  const disabled = new Set(lifecycle.disabled ?? []);
  const rows = Object.freeze((lifecycle.controls ?? []).map((directive, index) => {
    const command = (runtimeState.commands ?? []).find((item) => item.range?.start?.offset === directive.range.start.offset);
    const schedule = directive.field === "schedule" ? parseScheduleValue(directive.value) : null;
    const setting = directive.field === "setting" ? parseSettingValue(directive.value) : null;
    const suppressed = directive.field === "enable" && disabled.has(directive.value);
    const blockers = Object.freeze([
      ...(!directive.value ? ["missing_value"] : []),
      ...(schedule?.valid === false ? ["invalid_schedule"] : []),
      ...(setting?.valid === false ? ["invalid_setting"] : []),
      ...(command?.state === "blocked" ? ["runtime_command_blocked"] : []),
      ...(command?.restartSafe === false ? ["runtime_command_not_restart_safe"] : []),
    ].sort());
    const state = blockers.length > 0
      ? "blocked"
      : suppressed || command?.state === "skipped" ? "suppressed" : "ready";

    return Object.freeze({
      schema: "aios.comment.lifecycle-readiness-row.v1",
      order: index + 1,
      field: directive.field,
      value: directive.value,
      state,
      suppressed,
      commandId: command?.id ?? "",
      checkpoint: command?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: command?.statusChannel ?? runtimeState.statusChannel,
      idempotencyKey: command?.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-lifecycle-readiness", directive.field, directive.value),
      restartSafe: blockers.length === 0 && command?.restartSafe !== false,
      localOnly: command?.localOnly ?? providerContract.sync.localOnly,
      writesExternalSystem: command?.writesExternalSystem === true,
      schedule,
      setting,
      blockers,
      nextAction: blockers.includes("invalid_schedule")
        ? "repair_comment_schedule"
        : blockers.includes("invalid_setting")
          ? "repair_comment_setting"
          : blockers.length > 0
            ? command?.nextAction ?? lifecycle.nextAction
            : suppressed ? "retain_disabled_comment_lifecycle_control" : command?.nextAction ?? "apply_comment_lifecycle_control",
    });
  }));
  const diagnosticRows = Object.freeze(diagnostics
    .filter((item) => item.code === "AIOS_COMMENT_SETTING_VALUE" || item.code === "AIOS_COMMENT_SCHEDULE_VALUE")
    .map((item) => Object.freeze({
      schema: "aios.comment.lifecycle-readiness-diagnostic.v1",
      code: item.code,
      severity: item.severity,
      message: item.message,
      nextAction: item.recovery,
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const suppressedRows = rows.filter((row) => row.state === "suppressed");
  const reviewRows = diagnosticRows.filter((row) => row.severity === "warning");
  const ready = blockedRows.length === 0
    && lifecycle.valid !== false
    && runtimeState.persistedView?.restartSafe !== false;
  const nextAction = blockedRows[0]?.nextAction
    ?? diagnosticRows[0]?.nextAction
    ?? (rows.length > 0 ? "adopt_comment_lifecycle_readiness" : "attach_comment_lifecycle_control");

  return Object.freeze({
    schema: "aios.comment.lifecycle-readiness.v1",
    state: ready ? (reviewRows.length > 0 ? "review" : "ready") : "blocked",
    rows,
    diagnostics: diagnosticRows,
    counters: Object.freeze({
      rows: rows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      suppressed: suppressedRows.length,
      blocked: blockedRows.length,
      warnings: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `comment:${row.field}:${row.value}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `diagnostic:${row.code}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      localOnly: rows.every((row) => row.localOnly !== false),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildCommentProviderContract(directives, diagnostics) {
  const providerDirectives = directives.filter((directive) => PROVIDER_FIELDS.has(directive.field));
  const parsed = providerDirectives.map((directive) => Object.freeze({
    directive,
    parsed: parseProviderDirective(directive.field, directive.value),
  }));
  const provider = parsed.find((entry) => entry.directive.field === "provider")?.parsed;
  const service = parsed.find((entry) => entry.directive.field === "service")?.parsed;
  const sync = parsed.find((entry) => entry.directive.field === "sync")?.parsed;
  const handoff = parsed.find((entry) => entry.directive.field === "handoff")?.parsed;
  const capabilityDirectives = directives.filter((directive) => directive.field === "capability");
  const requestedCapabilities = Object.freeze(Array.from(new Set([
    ...capabilityDirectives.map((directive) => directive.value).filter(Boolean),
    ...(provider?.capabilities ?? []),
    ...(service?.capabilities ?? []),
  ])).sort());
  const serviceName = service?.service || provider?.service || "mailchimp";
  const adapter = handoff?.adapter || provider?.adapter || service?.adapter || serviceName;
  const statusChannel = handoff?.statusChannel || provider?.statusChannel || service?.statusChannel || "mailchimp.contract.status";
  const invalid = diagnostics.filter((item) => item.code === "AIOS_COMMENT_PROVIDER_VALUE");
  const syncMode = sync?.mode?.toLowerCase?.() || "local";
  const externalWriteRequested = sync?.externalWriteRequested === true;
  const externalWriteAllowed = externalWriteRequested && ["push", "provider"].includes(syncMode);

  return Object.freeze({
    schema: "aios.comment.provider-contract.v1",
    service: serviceName,
    adapter,
    statusChannel,
    requestedCapabilities,
    directives: Object.freeze(parsed),
    sync: Object.freeze({
      mode: syncMode,
      localOnly: !externalWriteAllowed,
      externalWriteRequested,
      externalWriteAllowed,
      checkpoint: sync?.checkpoint || `comment:${adapter}:${syncMode}`,
    }),
    handoff: Object.freeze({
      target: handoff?.target || statusChannel,
      ready: invalid.length === 0 && Boolean(serviceName && adapter),
      nextAction: invalid.length > 0
        ? "repair_comment_provider_contract"
        : externalWriteRequested && !externalWriteAllowed
          ? "confirm_comment_external_sync"
          : providerDirectives.length > 0 ? "handoff_comment_provider_status" : "attach_comment_provider",
    }),
  });
}

function stableStatePart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "none";
}

function stableCommentCommandId(...parts) {
  return parts.map(stableStatePart).join(":");
}

function directiveCommandType(directive) {
  if (directive.field === "capability") return "mailchimp.capability.request";
  if (directive.field === "handoff") return "mailchimp.status.handoff";
  if (directive.field === "provider" || directive.field === "service") return "mailchimp.provider.bind";
  if (directive.field === "sync") return "mailchimp.sync.configure";
  if (directive.field === "schedule") return "mailchimp.schedule.configure";
  if (directive.field === "setting") return "mailchimp.setting.apply";
  if (directive.field === "recover") return "aios.recovery.hint";
  if (directive.field === "status") return "mailchimp.status.channel";
  if (directive.field === "truth" || directive.field === "verifier" || directive.field === "claim") return "aios.verifier.claim";
  return `aios.comment.${stableStatePart(directive.field)}`;
}

function directiveCommandState(directive, providerContract, lifecycle) {
  if (!DIRECTIVE_FIELDS.has(directive.field)) {
    return Object.freeze({
      state: "blocked",
      restartSafe: false,
      nextAction: "rename_comment_directive",
      reason: "Unsupported directive field cannot be replayed.",
    });
  }
  if (!directive.value) {
    return Object.freeze({
      state: "blocked",
      restartSafe: false,
      nextAction: "add_comment_directive_value",
      reason: "Directive replay requires a deterministic value.",
    });
  }
  if (directive.field === "schedule") {
    const parsed = parseScheduleValue(directive.value);
    return Object.freeze({
      state: parsed.valid ? "ready" : "blocked",
      restartSafe: parsed.valid,
      nextAction: parsed.valid ? "schedule_comment_contracts" : "repair_comment_schedule",
      reason: parsed.valid ? "Schedule cadence can be replayed from persisted state." : "Schedule cadence is not recognized.",
    });
  }
  if (directive.field === "setting") {
    const parsed = parseSettingValue(directive.value);
    return Object.freeze({
      state: parsed.valid ? "ready" : "blocked",
      restartSafe: parsed.valid,
      nextAction: parsed.valid ? "apply_comment_setting" : "repair_comment_setting",
      reason: parsed.valid ? "Setting can be applied idempotently." : "Setting must use key=value.",
    });
  }
  if (PROVIDER_FIELDS.has(directive.field)) {
    return Object.freeze({
      state: providerContract.handoff.ready ? "ready" : "blocked",
      restartSafe: providerContract.handoff.ready,
      nextAction: providerContract.handoff.nextAction,
      reason: providerContract.handoff.ready ? "Provider handoff identity is complete." : "Provider handoff identity needs repair.",
    });
  }
  if (directive.field === "enable" || directive.field === "disable") {
    const disabled = new Set(lifecycle.disabled ?? []);
    const active = directive.field === "enable" ? !disabled.has(directive.value) : true;
    return Object.freeze({
      state: active ? "ready" : "skipped",
      restartSafe: true,
      nextAction: directive.field === "enable" ? "enable_comment_contract" : "disable_comment_contract",
      reason: active ? "Lifecycle control is deterministic." : "Enable directive is superseded by a matching disable directive.",
    });
  }
  return Object.freeze({
    state: "ready",
    restartSafe: true,
    nextAction: EXPORT_FIELDS.has(directive.field) ? "export_comment_contract" : "record_comment_directive",
    reason: EXPORT_FIELDS.has(directive.field) ? "Directive can be exported to kernel contract state." : "Directive can be retained as local runtime state.",
  });
}

function buildDirectiveRuntimeCommands(directives, providerContract, lifecycle) {
  return Object.freeze(directives.map((directive, index) => {
    const commandState = directiveCommandState(directive, providerContract, lifecycle);
    const checkpoint = providerContract.sync.checkpoint || `comment:${providerContract.adapter}:local`;
    const statusChannel = providerContract.statusChannel || "mailchimp.contract.status";
    const parsedProvider = PROVIDER_FIELDS.has(directive.field)
      ? parseProviderDirective(directive.field, directive.value)
      : null;
    return Object.freeze({
      schema: "aios.comment.runtime-command.v1",
      id: stableCommentCommandId("comment", checkpoint, index + 1, directive.field, directive.value),
      type: directiveCommandType(directive),
      field: directive.field,
      value: directive.value,
      checkpoint,
      statusChannel,
      idempotencyKey: stableCommentCommandId("idempotent", checkpoint, directive.field, directive.value),
      idempotent: true,
      restartSafe: commandState.restartSafe,
      state: commandState.state,
      nextAction: commandState.nextAction,
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: providerContract.sync.externalWriteAllowed && PROVIDER_FIELDS.has(directive.field),
      exportable: EXPORT_FIELDS.has(directive.field),
      lifecycleControl: LIFECYCLE_FIELDS.has(directive.field),
      parsed: parsedProvider,
      range: directive.range,
      statusPatch: Object.freeze({
        state: commandState.state === "ready" ? "queued" : commandState.state,
        nextAction: commandState.nextAction,
        message: commandState.reason,
      }),
    });
  }));
}

function summarizeCommentRuntimeCommands(commands) {
  const byField = {};
  const byState = {};
  for (const command of commands) {
    byField[command.field] = (byField[command.field] ?? 0) + 1;
    byState[command.state] = (byState[command.state] ?? 0) + 1;
  }
  return Object.freeze({
    total: commands.length,
    restartSafe: commands.filter((command) => command.restartSafe).length,
    exportable: commands.filter((command) => command.exportable).length,
    lifecycleControls: commands.filter((command) => command.lifecycleControl).length,
    externalWrites: commands.filter((command) => command.writesExternalSystem).length,
    blocked: commands.filter((command) => command.state === "blocked").length,
    byField: Object.freeze(Object.fromEntries(Object.entries(byField).sort())),
    byState: Object.freeze(Object.fromEntries(Object.entries(byState).sort())),
  });
}

function buildCommentStatusLedger(commands, replayState, checkpoint, statusChannel, diagnostics) {
  const rows = Object.freeze(commands.map((command, index) => {
    const persistedState = command.restartSafe === true
      ? command.state === "ready" ? "queued" : command.state
      : "blocked";
    const expectedState = command.state === "ready" ? "queued" : command.state;
    const drifted = persistedState !== expectedState || !command.idempotencyKey;
    return Object.freeze({
      schema: "aios.comment.status-ledger-row.v1",
      sequence: index + 1,
      rowId: stableCommentCommandId("comment-ledger", checkpoint, index + 1, command.field, command.value),
      commandId: command.id,
      field: command.field,
      value: command.value,
      checkpoint: command.checkpoint,
      statusChannel: command.statusChannel,
      expectedState,
      persistedState,
      drifted,
      restartSafe: command.restartSafe === true && !drifted,
      idempotencyKey: command.idempotencyKey,
      localOnly: command.localOnly !== false,
      writesExternalSystem: command.writesExternalSystem === true,
      nextAction: drifted ? "rebuild_comment_status_ledger" : command.nextAction,
    });
  }));
  const driftRows = rows.filter((row) => row.drifted || !row.restartSafe);
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const errors = diagnostics.filter((item) => item.severity === "error");
  const state = errors.length > 0 || driftRows.length > 0
    ? "blocked"
    : warnings.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";

  return Object.freeze({
    schema: "aios.comment.status-ledger.v1",
    revision: stableCommentCommandId(
      "comment-status-ledger",
      checkpoint,
      replayState,
      rows.length,
      driftRows.length,
      warnings.length,
      errors.length,
    ),
    state,
    replayState,
    checkpoint,
    statusChannel,
    rows,
    blockers: Object.freeze([
      ...driftRows.map((row) => `comment-ledger:${row.commandId}`),
      ...errors.map((item) => `diagnostic:${item.code}`),
    ].sort()),
    counters: Object.freeze({
      rows: rows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      drifted: driftRows.length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      warnings: warnings.length,
      errors: errors.length,
    }),
    handoff: Object.freeze({
      ready: driftRows.length === 0 && errors.length === 0,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction: driftRows[0]?.nextAction
        ?? errors[0]?.recovery
        ?? (rows.length > 0 ? "persist_comment_status_ledger" : "retain_empty_comment_status_ledger"),
    }),
  });
}

function buildCommentRuntimeState(directives, lifecycle, providerContract, diagnostics) {
  const commands = buildDirectiveRuntimeCommands(directives, providerContract, lifecycle);
  const blocked = commands.filter((command) => command.state === "blocked" || !command.restartSafe);
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const errors = diagnostics.filter((item) => item.severity === "error");
  const replayState = errors.length > 0 || blocked.length > 0
    ? "hold"
    : warnings.length > 0
      ? "review-ready"
      : commands.length > 0 ? "replay-ready" : "empty";
  const checkpoint = providerContract.sync.checkpoint || `comment:${providerContract.adapter}:local`;
  const revision = stableCommentCommandId(
    "comment-runtime",
    checkpoint,
    replayState,
    commands.length,
    warnings.length,
    errors.length,
  );
  const statusChannel = providerContract.statusChannel || "mailchimp.contract.status";
  const nextCommand = commands.find((command) => command.restartSafe && command.state !== "skipped");
  const statusLedger = buildCommentStatusLedger(commands, replayState, checkpoint, statusChannel, diagnostics);

  return Object.freeze({
    schema: "aios.comment.runtime-state.v1",
    revision,
    replayState,
    checkpoint,
    statusChannel,
    commands,
    statusLedger,
    commandSummary: summarizeCommentRuntimeCommands(commands),
    resume: Object.freeze({
      available: replayState !== "hold" && Boolean(checkpoint),
      fromCheckpoint: checkpoint,
      nextCommandId: nextCommand?.id ?? "",
      nextAction: blocked[0]?.nextAction
        ?? nextCommand?.nextAction
        ?? providerContract.handoff.nextAction
        ?? lifecycle.nextAction,
    }),
    clientHandoff: Object.freeze({
      ready: replayState === "replay-ready" || replayState === "review-ready",
      service: providerContract.service,
      adapter: providerContract.adapter,
      statusChannel,
      checkpoint,
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: providerContract.sync.externalWriteAllowed,
      userVisibleState: replayState === "hold" ? "needs-attention" : commands.length > 0 ? "queued" : "idle",
      nextAction: blocked[0]?.nextAction
        ?? (providerContract.handoff.ready ? providerContract.handoff.nextAction : "repair_comment_provider_contract"),
    }),
    persistedView: Object.freeze({
      key: revision,
      restartSafe: blocked.length === 0 && errors.length === 0 && statusLedger.handoff.ready === true,
      blockedCommandIds: Object.freeze(blocked.map((command) => command.id).sort()),
      idempotencyKeys: Object.freeze(commands.map((command) => command.idempotencyKey).filter(Boolean).sort()),
      statusLedgerRevision: statusLedger.revision,
      statusLedgerBlockers: statusLedger.blockers,
    }),
  });
}

function commentExportState(contract, runtimeState) {
  if (!contract.directive) return "local";
  const matchingCommand = runtimeState.commands.find((command) => command.range?.start?.offset === contract.range.start.offset);
  if (matchingCommand?.state === "blocked") return "blocked";
  if (contract.exportsToKernel) return "export-ready";
  if (contract.lifecycleControl) return "runtime-control";
  return "local";
}

function commentTimelineEvent(contract, runtimeState, index) {
  const state = commentExportState(contract, runtimeState);
  const directive = contract.directive;
  const command = directive
    ? runtimeState.commands.find((item) => item.range?.start?.offset === directive.range.start.offset)
    : null;
  return Object.freeze({
    sequence: index + 1,
    field: directive?.field ?? "comment",
    value: directive?.value ?? contract.text,
    state,
    line: contract.range.start.line,
    column: contract.range.start.column,
    exportable: contract.exportsToKernel,
    lifecycleControl: contract.lifecycleControl,
    nextAction: command?.nextAction
      ?? (state === "export-ready" ? "export_comment_contract" : state === "runtime-control" ? "apply_comment_runtime_control" : "retain_comment"),
  });
}

function summarizeCommentAnalytics(comments, directives, contracts, diagnostics, lifecycle, providerContract, runtimeState) {
  const byField = {};
  const byState = {};
  const byKind = {};
  const timeline = contracts.map((contract, index) => commentTimelineEvent(contract, runtimeState, index));
  for (const directive of directives) {
    byField[directive.field] = (byField[directive.field] ?? 0) + 1;
  }
  for (const event of timeline) {
    byState[event.state] = (byState[event.state] ?? 0) + 1;
  }
  for (const comment of comments) {
    byKind[comment.kind] = (byKind[comment.kind] ?? 0) + 1;
  }
  return Object.freeze({
    schema: "aios.comment.analytics.v1",
    counters: Object.freeze({
      comments: comments.length,
      directives: directives.length,
      exportable: contracts.filter((contract) => contract.exportsToKernel).length,
      lifecycleControls: lifecycle.controls.length,
      providerDirectives: providerContract.directives.length,
      runtimeCommands: runtimeState.commandSummary.total,
      blockedCommands: runtimeState.commandSummary.blocked,
      diagnostics: diagnostics.length,
      errors: diagnostics.filter((item) => item.severity === "error").length,
      warnings: diagnostics.filter((item) => item.severity === "warning").length,
    }),
    byField: Object.freeze(Object.fromEntries(Object.entries(byField).sort())),
    byState: Object.freeze(Object.fromEntries(Object.entries(byState).sort())),
    byKind: Object.freeze(Object.fromEntries(Object.entries(byKind).sort())),
  });
}

function buildCommentHistorySnapshot(contracts, diagnostics, runtimeState) {
  const timeline = contracts.map((contract, index) => commentTimelineEvent(contract, runtimeState, index));
  const blocked = timeline.filter((event) => event.state === "blocked");
  const exportable = timeline.filter((event) => event.state === "export-ready");
  const revision = stableCommentCommandId(
    "comment-history",
    contracts.length,
    diagnostics.length,
    exportable.length,
    runtimeState.replayState,
  );
  return Object.freeze({
    schema: "aios.comment.history.v1",
    revision,
    latestState: blocked.length > 0
      ? "blocked"
      : diagnostics.some((item) => item.severity === "warning")
        ? "review"
        : exportable.length > 0 ? "ready" : "local",
    snapshots: Object.freeze(timeline.map((event) => Object.freeze({
      field: event.field,
      value: event.value,
      state: event.state,
      nextAction: event.nextAction,
    }))),
    timeline: Object.freeze(timeline),
  });
}

function buildCommentExportSummary(contracts, diagnostics, lifecycle, providerContract, runtimeState, history) {
  const rows = contracts.map((contract) => {
    const state = commentExportState(contract, runtimeState);
    return Object.freeze({
      field: contract.directive?.field ?? "comment",
      value: contract.directive?.value ?? contract.text,
      state,
      exportsToKernel: contract.exportsToKernel,
      lifecycleControl: contract.lifecycleControl,
      line: contract.range.start.line,
      column: contract.range.start.column,
    });
  });
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const exportableRows = rows.filter((row) => row.state === "export-ready");
  const error = diagnostics.find((item) => item.severity === "error");
  const restartSafe = runtimeState.persistedView.restartSafe === true;
  const fallbackNextAction = providerContract.handoff.ready ? runtimeState.resume.nextAction : providerContract.handoff.nextAction;
  const blockedNextAction = blockedRows.length > 0 ? runtimeState.resume.nextAction : "";

  return Object.freeze({
    schema: "aios.comment.export-summary.v1",
    exportReady: blockedRows.length === 0 && !error && restartSafe,
    rows: Object.freeze(rows),
    exportableFields: Object.freeze(exportableRows.map((row) => row.field).sort()),
    blockedFields: Object.freeze(blockedRows.map((row) => row.field).sort()),
    status: Object.freeze({
      state: error || blockedRows.length > 0
        ? "blocked"
        : diagnostics.some((item) => item.severity === "warning") ? "review" : "ready",
      replayState: runtimeState.replayState,
      historyRevision: history.revision,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      restartSafe,
      providerHandoffReady: providerContract.handoff.ready,
      lifecycleActive: lifecycle.active,
    }),
    nextAction: (error?.recovery ?? blockedNextAction) || fallbackNextAction,
  });
}

function commentExportManifestRow(contract, providerContract, runtimeState, lifecycle) {
  const directive = contract.directive;
  const command = directive
    ? runtimeState.commands.find((item) => item.range?.start?.offset === directive.range.start.offset)
    : null;
  const state = commentExportState(contract, runtimeState);
  const disabled = new Set(lifecycle.disabled ?? []);
  const enabled = new Set(lifecycle.enabled ?? []);
  const lifecycleSuppressed = directive?.field === "enable" && disabled.has(directive.value);
  const publishable = state === "export-ready"
    && providerContract.handoff.ready === true
    && (command?.restartSafe ?? true)
    && command?.state !== "blocked"
    && !lifecycleSuppressed;

  return Object.freeze({
    schema: "aios.comment.export-manifest-row.v1",
    field: directive?.field ?? "comment",
    value: directive?.value ?? contract.text,
    state: publishable
      ? "publishable"
      : lifecycleSuppressed ? "suppressed" : state,
    line: contract.range.start.line,
    column: contract.range.start.column,
    exportable: contract.exportsToKernel,
    lifecycleControl: contract.lifecycleControl,
    provider: Object.freeze({
      service: providerContract.service,
      adapter: providerContract.adapter,
      statusChannel: providerContract.statusChannel,
      checkpoint: providerContract.sync.checkpoint,
      handoffReady: providerContract.handoff.ready,
      writesExternalSystem: providerContract.sync.externalWriteAllowed,
    }),
    runtime: Object.freeze({
      commandId: command?.id ?? "",
      restartSafe: command?.restartSafe !== false,
      state: command?.state ?? "local",
      idempotencyKey: command?.idempotencyKey ?? "",
    }),
    lifecycle: Object.freeze({
      active: lifecycle.active,
      enabled: enabled.has(directive?.value ?? ""),
      disabled: disabled.has(directive?.value ?? ""),
      suppressed: lifecycleSuppressed,
      nextAction: lifecycle.nextAction,
    }),
    nextAction: publishable
      ? "publish_comment_manifest_row"
      : lifecycleSuppressed
        ? "retain_disabled_comment_control"
        : command?.state === "blocked" || command?.restartSafe === false
          ? command.nextAction
          : providerContract.handoff.ready ? "retain_comment_manifest_row" : providerContract.handoff.nextAction,
  });
}

function buildCommentExportPackage(contracts, diagnostics, lifecycle, providerContract, runtimeState, history, exportSummary) {
  const manifest = Object.freeze(contracts.map((contract) => commentExportManifestRow(
    contract,
    providerContract,
    runtimeState,
    lifecycle,
  )));
  const publishableRows = manifest.filter((row) => row.state === "publishable");
  const suppressedRows = manifest.filter((row) => row.state === "suppressed");
  const blockedRows = manifest.filter((row) => row.state === "blocked" || row.runtime.restartSafe === false);
  const warningCount = diagnostics.filter((item) => item.severity === "warning").length;
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const revision = stableCommentCommandId(
    "comment-export-package",
    history.revision,
    runtimeState.revision,
    providerContract.sync.checkpoint,
    publishableRows.length,
    blockedRows.length,
    suppressedRows.length,
  );

  return Object.freeze({
    schema: "aios.comment.export-package.v1",
    revision,
    exportReady: exportSummary.exportReady
      && blockedRows.length === 0
      && errorCount === 0
      && runtimeState.persistedView.restartSafe === true,
    manifest,
    counters: Object.freeze({
      total: manifest.length,
      publishable: publishableRows.length,
      blocked: blockedRows.length,
      suppressed: suppressedRows.length,
      lifecycleControls: manifest.filter((row) => row.lifecycleControl).length,
      runtimeCommands: runtimeState.commandSummary.total,
      warnings: warningCount,
      errors: errorCount,
    }),
    status: Object.freeze({
      state: blockedRows.length > 0 || errorCount > 0
        ? "blocked"
        : warningCount > 0 ? "review" : publishableRows.length > 0 ? "ready" : "local",
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      historyRevision: history.revision,
      runtimeRevision: runtimeState.revision,
      providerHandoffReady: providerContract.handoff.ready,
      lifecycleActive: lifecycle.active,
      restartSafe: runtimeState.persistedView.restartSafe === true,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0
        && errorCount === 0
        && providerContract.handoff.ready === true
        && runtimeState.clientHandoff.ready === true,
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: providerContract.sync.externalWriteAllowed,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      nextAction: blockedRows[0]?.nextAction
        ?? (publishableRows.length > 0 ? "publish_comment_export_package" : exportSummary.nextAction),
    }),
  });
}

function normalizeCommentSurfaceText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueSortedCommentValues(values) {
  return Object.freeze(Array.from(new Set(Array.from(values ?? [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))).sort());
}

function buildCommentAdoptionSignature(providerContract, runtimeState, lifecycle, exportPackage) {
  const service = providerContract.service || "mailchimp";
  const adapter = providerContract.adapter || service;
  const capabilities = uniqueSortedCommentValues(providerContract.requestedCapabilities ?? []);
  const statusChannels = uniqueSortedCommentValues([
    providerContract.statusChannel,
    runtimeState.statusChannel,
    exportPackage.handoff?.statusChannel,
  ]);
  const checkpoints = uniqueSortedCommentValues([
    providerContract.sync?.checkpoint,
    runtimeState.checkpoint,
    exportPackage.handoff?.checkpoint,
  ]);
  const blockedReasons = [
    ...(!providerContract.handoff?.ready ? ["provider_handoff"] : []),
    ...(runtimeState.persistedView?.restartSafe === false ? ["runtime_restart"] : []),
    ...(exportPackage.handoff?.ready === false ? ["export_package"] : []),
    ...(lifecycle.valid === false ? ["lifecycle"] : []),
  ];
  const restartSafe = runtimeState.persistedView?.restartSafe === true;
  const externalWriteRequested = providerContract.sync?.externalWriteRequested === true;
  const externalWriteAllowed = providerContract.sync?.externalWriteAllowed === true;
  const revision = stableCommentCommandId(
    "comment-surface",
    service,
    adapter,
    providerContract.sync?.mode ?? "local",
    runtimeState.revision,
    exportPackage.revision,
    blockedReasons.length,
  );

  return Object.freeze({
    schema: "aios.comment.adoption-signature.v1",
    source: "comment",
    revision,
    service,
    adapter,
    capabilities,
    lifecycle: Object.freeze({
      active: lifecycle.active,
      enabled: uniqueSortedCommentValues(lifecycle.enabled ?? []),
      disabled: uniqueSortedCommentValues(lifecycle.disabled ?? []),
      scheduleCount: lifecycle.schedules?.length ?? 0,
    }),
    sync: Object.freeze({
      mode: providerContract.sync?.mode ?? "local",
      localOnly: providerContract.sync?.localOnly !== false,
      externalWriteRequested,
      externalWriteAllowed,
      checkpoints,
      statusChannels,
    }),
    replay: Object.freeze({
      state: runtimeState.replayState,
      commandCount: runtimeState.commandSummary?.total ?? 0,
      restartSafe,
      resumeAvailable: runtimeState.resume?.available === true,
      nextAction: runtimeState.resume?.nextAction ?? providerContract.handoff?.nextAction ?? lifecycle.nextAction,
    }),
    exports: Object.freeze({
      ready: exportPackage.handoff?.ready !== false,
      revision: exportPackage.revision,
      publishableRows: exportPackage.counters?.publishable ?? 0,
      blockedRows: exportPackage.counters?.blocked ?? 0,
    }),
    handoff: Object.freeze({
      ready: blockedReasons.length === 0,
      checkpoint: checkpoints[0] || "comment:local",
      statusChannel: statusChannels[0] || "mailchimp.contract.status",
      blockedReasons: Object.freeze(blockedReasons.sort()),
      nextAction: blockedReasons.length > 0
        ? providerContract.handoff?.nextAction ?? runtimeState.resume?.nextAction ?? lifecycle.nextAction
        : "adopt_comment_mailchimp_surface",
    }),
    fingerprint: stableCommentCommandId(
      "comment",
      service,
      adapter,
      capabilities.join("+"),
      statusChannels.join("+"),
      externalWriteAllowed ? "external" : "local",
    ),
  });
}

function buildCommentDeploymentIntent(providerContract, runtimeState, lifecycle, exportPackage, adoptionSignature) {
  const commands = runtimeState.commands ?? [];
  const disabled = new Set(lifecycle.disabled ?? []);
  const enabled = new Set(lifecycle.enabled ?? []);
  const controlRows = Object.freeze((lifecycle.controls ?? []).map((directive, index) => {
    const command = commands.find((item) => item.range?.start?.offset === directive.range.start.offset);
    const setting = directive.field === "setting" ? parseSettingValue(directive.value) : null;
    const schedule = directive.field === "schedule" ? parseScheduleValue(directive.value) : null;
    const disabledByControl = directive.field === "enable" && disabled.has(directive.value);
    const blocked = command?.state === "blocked"
      || command?.restartSafe === false
      || setting?.valid === false
      || schedule?.valid === false;
    const state = blocked
      ? "blocked"
      : disabledByControl || command?.state === "skipped" ? "suppressed" : "ready";
    return Object.freeze({
      schema: "aios.comment.deployment-control-row.v1",
      order: index + 1,
      field: directive.field,
      value: directive.value,
      state,
      commandId: command?.id ?? "",
      idempotencyKey: command?.idempotencyKey ?? stableCommentCommandId("comment-control", directive.field, directive.value),
      restartSafe: command?.restartSafe !== false && state !== "blocked",
      localOnly: command?.localOnly !== false,
      writesExternalSystem: command?.writesExternalSystem === true,
      setting,
      schedule,
      lifecycle: Object.freeze({
        enabled: enabled.has(directive.value),
        disabled: disabled.has(directive.value),
        active: lifecycle.active,
      }),
      nextAction: state === "blocked"
        ? command?.nextAction ?? lifecycle.nextAction
        : state === "suppressed"
          ? "retain_suppressed_comment_control"
          : command?.nextAction ?? "apply_comment_lifecycle_control",
    });
  }));
  const providerRows = Object.freeze((providerContract.directives ?? []).map((entry, index) => {
    const directive = entry.directive;
    const command = commands.find((item) => item.range?.start?.offset === directive.range.start.offset);
    const state = entry.parsed.valid && providerContract.handoff.ready && command?.state !== "blocked"
      ? "ready"
      : "blocked";
    return Object.freeze({
      schema: "aios.comment.deployment-provider-row.v1",
      order: index + 1,
      field: directive.field,
      value: directive.value,
      state,
      commandId: command?.id ?? "",
      restartSafe: command?.restartSafe !== false && state !== "blocked",
      service: providerContract.service,
      adapter: providerContract.adapter,
      statusChannel: providerContract.statusChannel,
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: providerContract.sync.externalWriteAllowed && command?.writesExternalSystem === true,
      nextAction: state === "ready" ? command?.nextAction ?? providerContract.handoff.nextAction : providerContract.handoff.nextAction,
    });
  }));
  const exportRows = Object.freeze((exportPackage.manifest ?? []).map((row, index) => Object.freeze({
    schema: "aios.comment.deployment-export-row.v1",
    order: index + 1,
    field: row.field,
    value: row.value,
    state: row.state,
    commandId: row.runtime.commandId,
    restartSafe: row.runtime.restartSafe,
    publishable: row.state === "publishable",
    lifecycleSuppressed: row.lifecycle.suppressed,
    nextAction: row.nextAction,
  })));
  const blockers = Object.freeze([
    ...controlRows.filter((row) => row.state === "blocked").map((row) => `control:${row.field}:${row.value}`),
    ...providerRows.filter((row) => row.state === "blocked" || row.restartSafe === false).map((row) => `provider:${row.field}:${row.value}`),
    ...exportRows.filter((row) => row.state === "blocked" || row.restartSafe === false).map((row) => `export:${row.field}:${row.value}`),
    ...(runtimeState.persistedView?.restartSafe === false ? (runtimeState.persistedView.blockedCommandIds ?? []).map((id) => `runtime:${id}`) : []),
    ...(adoptionSignature.handoff?.ready === false ? (adoptionSignature.handoff.blockedReasons ?? []).map((reason) => `adoption:${reason}`) : []),
  ].sort());
  const ready = blockers.length === 0
    && runtimeState.clientHandoff?.ready === true
    && providerContract.handoff.ready === true
    && lifecycle.valid !== false
    && exportPackage.handoff?.ready === true
    && adoptionSignature.handoff?.ready === true;

  return Object.freeze({
    schema: "aios.comment.deployment-intent.v1",
    revision: stableCommentCommandId(
      "comment-deployment",
      runtimeState.revision,
      exportPackage.revision,
      adoptionSignature.revision,
      blockers.length,
      controlRows.length,
      providerRows.length,
    ),
    ready,
    state: ready ? "ready" : blockers.some((blocker) => blocker.startsWith("control:schedule")) ? "needs-schedule-repair" : "blocked",
    checkpoint: runtimeState.checkpoint,
    statusChannel: runtimeState.statusChannel,
    controls: controlRows,
    providers: providerRows,
    exports: exportRows,
    counters: Object.freeze({
      controls: controlRows.length,
      providers: providerRows.length,
      exports: exportRows.length,
      readyControls: controlRows.filter((row) => row.state === "ready").length,
      suppressedControls: controlRows.filter((row) => row.state === "suppressed").length,
      blockedControls: controlRows.filter((row) => row.state === "blocked").length,
      publishableExports: exportRows.filter((row) => row.publishable).length,
      restartSafe: [...controlRows, ...providerRows, ...exportRows].filter((row) => row.restartSafe).length,
    }),
    blockers,
    handoff: Object.freeze({
      ready,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: providerContract.sync.externalWriteAllowed,
      nextAction: blockers.length > 0
        ? blockers[0].split(":").slice(1).join(":") || "repair_comment_deployment_intent"
        : "adopt_comment_deployment_intent",
    }),
  });
}

function buildCommentSyncPreview(providerContract, runtimeState, lifecycle, exportPackage, deploymentIntent, adoptionSignature) {
  const providerRows = Object.freeze((providerContract.directives ?? []).map((entry, index) => {
    const directive = entry.directive;
    const command = (runtimeState.commands ?? []).find((item) => item.range?.start?.offset === directive.range.start.offset);
    const parsed = entry.parsed;
    const state = !parsed.valid || providerContract.handoff.ready === false || command?.state === "blocked"
      ? "blocked"
      : providerContract.sync.externalWriteRequested && !providerContract.sync.externalWriteAllowed
        ? "review"
        : "ready";
    return Object.freeze({
      schema: "aios.comment.sync-preview-provider-row.v1",
      order: index + 1,
      field: directive.field,
      value: directive.value,
      state,
      commandId: command?.id ?? "",
      restartSafe: command?.restartSafe !== false && state !== "blocked",
      service: providerContract.service,
      adapter: providerContract.adapter,
      checkpoint: providerContract.sync.checkpoint,
      statusChannel: providerContract.statusChannel,
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: providerContract.sync.externalWriteAllowed && command?.writesExternalSystem === true,
      nextAction: state === "ready"
        ? command?.nextAction ?? providerContract.handoff.nextAction
        : command?.nextAction ?? providerContract.handoff.nextAction,
    });
  }));
  const lifecycleRows = Object.freeze((lifecycle.controls ?? []).map((directive, index) => {
    const command = (runtimeState.commands ?? []).find((item) => item.range?.start?.offset === directive.range.start.offset);
    const schedule = directive.field === "schedule" ? parseScheduleValue(directive.value) : null;
    const setting = directive.field === "setting" ? parseSettingValue(directive.value) : null;
    const blocked = command?.state === "blocked"
      || command?.restartSafe === false
      || schedule?.valid === false
      || setting?.valid === false;
    return Object.freeze({
      schema: "aios.comment.sync-preview-lifecycle-row.v1",
      order: index + 1,
      field: directive.field,
      value: directive.value,
      state: blocked ? "blocked" : command?.state === "skipped" ? "suppressed" : "ready",
      commandId: command?.id ?? "",
      restartSafe: command?.restartSafe !== false && !blocked,
      schedule,
      setting,
      nextAction: blocked
        ? command?.nextAction ?? lifecycle.nextAction
        : command?.nextAction ?? "apply_comment_lifecycle_control",
    });
  }));
  const exportRows = Object.freeze((exportPackage.manifest ?? []).map((row, index) => Object.freeze({
    schema: "aios.comment.sync-preview-export-row.v1",
    order: index + 1,
    field: row.field,
    value: row.value,
    state: row.state,
    publishable: row.state === "publishable",
    commandId: row.runtime.commandId,
    restartSafe: row.runtime.restartSafe,
    nextAction: row.nextAction,
  })));
  const blockers = Object.freeze([
    ...providerRows.filter((row) => row.state === "blocked" || !row.restartSafe).map((row) => `provider:${row.field}:${row.nextAction}`),
    ...lifecycleRows.filter((row) => row.state === "blocked" || !row.restartSafe).map((row) => `lifecycle:${row.field}:${row.nextAction}`),
    ...exportRows.filter((row) => row.state === "blocked" || !row.restartSafe).map((row) => `export:${row.field}:${row.nextAction}`),
    ...(runtimeState.persistedView?.restartSafe === false ? (runtimeState.persistedView.blockedCommandIds ?? []).map((id) => `runtime:${id}`) : []),
    ...(deploymentIntent.handoff?.ready === false ? [`deployment:${deploymentIntent.handoff.nextAction}`] : []),
    ...(adoptionSignature.handoff?.ready === false ? (adoptionSignature.handoff.blockedReasons ?? []).map((reason) => `adoption:${reason}`) : []),
  ].sort());
  const review = Object.freeze(providerRows
    .filter((row) => row.state === "review")
    .map((row) => `external-sync:${row.field}`));
  const previewStatus = blockers.length > 0 ? "blocked" : review.length > 0 ? "review" : "ready";
  const acceptedForRuntime = blockers.length === 0
    && runtimeState.clientHandoff?.ready === true
    && exportPackage.handoff?.ready !== false
    && deploymentIntent.handoff?.ready !== false;
  const nextAction = blockers.length > 0
    ? blockers[0].split(":").slice(2).join(":") || "repair_comment_sync_preview"
    : review.length > 0 ? "confirm_comment_external_sync" : "adopt_comment_sync_preview";

  return Object.freeze({
    schema: "aios.comment.sync-preview.v1",
    preview: Object.freeze({
      previewId: stableCommentCommandId("comment-sync-preview", runtimeState.revision, previewStatus),
      title: "Mailchimp comment sync",
      status: previewStatus,
      providerRows,
      lifecycleRows,
      exportRows,
      counters: Object.freeze({
        providers: providerRows.length,
        lifecycleControls: lifecycleRows.length,
        exports: exportRows.length,
        publishableExports: exportRows.filter((row) => row.publishable).length,
        blocked: blockers.length,
        review: review.length,
      }),
    }),
    acceptance: Object.freeze({
      required: blockers.length > 0 || providerContract.sync.externalWriteRequested,
      acceptedForRuntime,
      acceptedForExternalWrite: providerContract.sync.externalWriteAllowed,
      blockedBy: blockers,
      nextAction,
    }),
    readiness: Object.freeze({
      state: acceptedForRuntime ? "ready" : previewStatus,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      restartSafe: runtimeState.persistedView?.restartSafe === true,
      providerHandoffReady: providerContract.handoff.ready,
      deploymentReady: deploymentIntent.handoff?.ready === true,
    }),
    validationSummary: Object.freeze({
      blocked: blockers.length,
      review: review.length,
      runtimeCommands: runtimeState.commandSummary?.total ?? 0,
      publishableExports: exportPackage.counters?.publishable ?? 0,
      nextAction,
    }),
    nextSteps: Object.freeze([
      ...blockers.map((blocker, index) => Object.freeze({
        order: index + 1,
        action: blocker.split(":").slice(2).join(":") || "repair_comment_sync_preview",
        subject: blocker,
        restartSafe: false,
      })),
      ...(blockers.length === 0 ? [Object.freeze({
        order: 1,
        action: nextAction,
        subject: runtimeState.checkpoint,
        restartSafe: true,
      })] : []),
    ]),
    handoff: Object.freeze({
      ready: acceptedForRuntime,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: providerContract.sync.externalWriteAllowed,
      nextAction,
    }),
  });
}

function buildCommentProviderAcceptance(providerContract, runtimeState, lifecycle, syncPreview, clientActionQueueSeed = null) {
  const providerRows = Object.freeze((providerContract.directives ?? []).map((entry, index) => {
    const directive = entry.directive;
    const command = (runtimeState.commands ?? []).find((item) => item.range?.start?.offset === directive.range.start.offset);
    const previewRow = (syncPreview.preview?.providerRows ?? []).find((row) => row.field === directive.field && row.value === directive.value);
    const blockers = Object.freeze([
      ...(entry.parsed.valid ? [] : ["provider_value"]),
      ...(providerContract.handoff.ready ? [] : ["provider_handoff"]),
      ...(command?.restartSafe === false || command?.state === "blocked" ? ["runtime_command"] : []),
      ...(previewRow?.state === "blocked" ? ["sync_preview"] : []),
    ].sort());
    const review = Object.freeze([
      ...(providerContract.sync.externalWriteRequested && !providerContract.sync.externalWriteAllowed ? ["external_sync_confirmation"] : []),
      ...(previewRow?.state === "review" ? ["sync_preview_review"] : []),
    ].sort());
    const state = blockers.length > 0 ? "blocked" : review.length > 0 ? "review" : "accepted";

    return Object.freeze({
      schema: "aios.comment.provider-acceptance-row.v1",
      order: index + 1,
      field: directive.field,
      value: directive.value,
      state,
      service: providerContract.service,
      adapter: providerContract.adapter,
      checkpoint: providerContract.sync.checkpoint,
      statusChannel: providerContract.statusChannel,
      commandId: command?.id ?? "",
      idempotencyKey: command?.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-provider", directive.field, directive.value),
      restartSafe: blockers.length === 0 && command?.restartSafe !== false,
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: providerContract.sync.externalWriteAllowed && command?.writesExternalSystem === true,
      requestedCapabilities: providerContract.requestedCapabilities,
      blockers,
      review,
      nextAction: blockers.includes("runtime_command")
        ? command?.nextAction ?? "repair_comment_runtime_state"
        : blockers.length > 0
          ? providerContract.handoff.nextAction
          : review.length > 0 ? "confirm_comment_provider_acceptance" : "accept_comment_provider_handoff",
    });
  }));
  const lifecycleRows = Object.freeze((lifecycle.controls ?? []).map((directive, index) => {
    const command = (runtimeState.commands ?? []).find((item) => item.range?.start?.offset === directive.range.start.offset);
    const schedule = directive.field === "schedule" ? parseScheduleValue(directive.value) : null;
    const setting = directive.field === "setting" ? parseSettingValue(directive.value) : null;
    const blocked = command?.state === "blocked"
      || command?.restartSafe === false
      || schedule?.valid === false
      || setting?.valid === false;
    const state = blocked ? "blocked" : command?.state === "skipped" ? "suppressed" : "accepted";
    return Object.freeze({
      schema: "aios.comment.provider-acceptance-lifecycle-row.v1",
      order: index + 1,
      field: directive.field,
      value: directive.value,
      state,
      commandId: command?.id ?? "",
      restartSafe: command?.restartSafe !== false && !blocked,
      checkpoint: command?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: command?.statusChannel ?? runtimeState.statusChannel,
      schedule,
      setting,
      nextAction: blocked ? command?.nextAction ?? lifecycle.nextAction : command?.nextAction ?? "accept_comment_lifecycle_control",
    });
  }));
  const queueRows = Object.freeze((clientActionQueueSeed?.rows ?? []).map((row) => Object.freeze({
    source: row.source,
    subject: row.subject,
    state: row.state,
    restartSafe: row.restartSafe === true,
    nextAction: row.action,
  })));
  const blockers = Object.freeze([
    ...providerRows.flatMap((row) => row.blockers.map((blocker) => `provider:${row.field}:${blocker}`)),
    ...lifecycleRows.filter((row) => row.state === "blocked" || row.restartSafe === false).map((row) => `lifecycle:${row.field}:${row.nextAction}`),
    ...(syncPreview.acceptance?.blockedBy ?? []).map((blocker) => `sync:${blocker}`),
    ...queueRows.filter((row) => row.state === "blocked" || !row.restartSafe).map((row) => `client-action:${row.subject}`),
  ].sort());
  const review = Object.freeze([
    ...providerRows.flatMap((row) => row.review.map((item) => `provider:${row.field}:${item}`)),
    ...(syncPreview.acceptance?.required && syncPreview.handoff?.writesExternalSystem ? ["sync:external-write"] : []),
    ...queueRows.filter((row) => row.state === "review").map((row) => `client-action:${row.subject}`),
  ].sort());
  const ready = blockers.length === 0
    && providerContract.handoff.ready === true
    && runtimeState.persistedView?.restartSafe === true
    && syncPreview.handoff?.ready !== false;
  const nextAction = blockers.length > 0
    ? blockers[0].split(":").slice(2).join(":") || "repair_comment_provider_acceptance"
    : review.length > 0 ? "review_comment_provider_acceptance" : "accept_comment_provider_handoff";

  return Object.freeze({
    schema: "aios.comment.provider-acceptance.v1",
    state: ready ? (review.length > 0 ? "review" : "accepted") : "blocked",
    accepted: ready,
    preview: Object.freeze({
      previewId: stableCommentCommandId("comment-provider-acceptance", runtimeState.revision, blockers.length, review.length),
      title: "Mailchimp provider acceptance",
      providerRows,
      lifecycleRows,
      queueRows,
      counters: Object.freeze({
        providers: providerRows.length,
        lifecycleControls: lifecycleRows.length,
        queuedActions: queueRows.length,
        blocked: blockers.length,
        review: review.length,
      }),
    }),
    acceptance: Object.freeze({
      required: blockers.length > 0 || providerContract.sync.externalWriteRequested,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && providerContract.sync.externalWriteAllowed,
      blockedBy: blockers,
      review,
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      localOnly: providerContract.sync.localOnly,
      writesExternalSystem: ready && providerContract.sync.externalWriteAllowed,
      nextAction,
    }),
  });
}

function buildCommentProviderCommitWindow(providerAcceptance, providerContract, runtimeState, syncPreview) {
  const providerRows = Object.freeze((providerAcceptance.preview?.providerRows ?? []).map((row, index) => {
    const previewRow = (syncPreview.preview?.providerRows ?? []).find((item) => item.field === row.field && item.value === row.value);
    const externalRequested = providerContract.sync.externalWriteRequested === true || row.writesExternalSystem === true;
    const externalAllowed = providerContract.sync.externalWriteAllowed === true && row.writesExternalSystem === true;
    const blockers = Object.freeze([
      ...(row.blockers ?? []).map((blocker) => `provider:${blocker}`),
      ...(row.restartSafe === true ? [] : ["provider:restart_safety"]),
      ...(previewRow?.state === "blocked" ? ["sync:blocked"] : []),
      ...(externalRequested && !externalAllowed ? ["sync:external_confirmation"] : []),
    ].sort());
    const review = Object.freeze([
      ...(row.review ?? []).map((item) => `provider:${item}`),
      ...(previewRow?.state === "review" ? ["sync:review"] : []),
    ].sort());
    const state = blockers.length > 0 ? "held" : review.length > 0 ? "review" : externalAllowed ? "commit-ready" : "preview-ready";

    return Object.freeze({
      schema: "aios.comment.provider-commit-window-row.v1",
      order: index + 1,
      field: row.field,
      value: row.value,
      state,
      service: row.service || providerContract.service,
      adapter: row.adapter || providerContract.adapter,
      checkpoint: row.checkpoint || runtimeState.checkpoint,
      statusChannel: row.statusChannel || runtimeState.statusChannel,
      commandId: row.commandId,
      idempotencyKey: row.idempotencyKey,
      requestedCapabilities: row.requestedCapabilities ?? providerContract.requestedCapabilities,
      restartSafe: blockers.length === 0 && row.restartSafe === true,
      localOnly: !externalAllowed,
      writesExternalSystem: externalAllowed,
      blockers,
      review,
      nextAction: blockers.includes("sync:external_confirmation")
        ? "confirm_comment_provider_commit_window"
        : blockers.length > 0
          ? row.nextAction ?? "repair_comment_provider_commit_window"
          : review.length > 0 ? "review_comment_provider_commit_window" : "commit_comment_provider_status",
    });
  }));
  const lifecycleRows = Object.freeze((providerAcceptance.preview?.lifecycleRows ?? []).map((row, index) => {
    const blocked = row.state === "blocked" || row.restartSafe === false;
    return Object.freeze({
      schema: "aios.comment.provider-commit-window-lifecycle-row.v1",
      order: index + 1,
      field: row.field,
      value: row.value,
      state: blocked ? "held" : row.state === "suppressed" ? "suppressed" : "preview-ready",
      checkpoint: row.checkpoint || runtimeState.checkpoint,
      statusChannel: row.statusChannel || runtimeState.statusChannel,
      commandId: row.commandId,
      restartSafe: !blocked,
      nextAction: blocked ? row.nextAction : "retain_comment_lifecycle_preview",
    });
  }));
  const blockers = Object.freeze([
    ...(providerAcceptance.acceptance?.blockedBy ?? []).map((blocker) => `acceptance:${blocker}`),
    ...providerRows.filter((row) => row.state === "held" || row.restartSafe === false).map((row) => `provider:${row.field}:${row.nextAction}`),
    ...lifecycleRows.filter((row) => row.state === "held").map((row) => `lifecycle:${row.field}:${row.nextAction}`),
  ].sort());
  const review = Object.freeze([
    ...(providerAcceptance.acceptance?.review ?? []).map((item) => `acceptance:${item}`),
    ...providerRows.flatMap((row) => row.review.map((item) => `provider:${row.field}:${item}`)),
  ].sort());
  const externalRows = providerRows.filter((row) => row.writesExternalSystem);
  const state = blockers.length > 0
    ? "held"
    : review.length > 0 ? "review" : externalRows.length > 0 ? "commit-ready" : providerRows.length > 0 ? "preview-ready" : "empty";
  const nextAction = blockers.length > 0
    ? "repair_comment_provider_commit_window"
    : review.length > 0 ? "review_comment_provider_commit_window" : "handoff_comment_provider_commit_window";

  return Object.freeze({
    schema: "aios.comment.provider-commit-window.v1",
    revision: stableCommentCommandId("comment-provider-commit", providerAcceptance.preview?.previewId, state, blockers.length, review.length),
    state,
    providerRows,
    lifecycleRows,
    blockers,
    review,
    counters: Object.freeze({
      providers: providerRows.length,
      lifecycleControls: lifecycleRows.length,
      held: providerRows.filter((row) => row.state === "held").length + lifecycleRows.filter((row) => row.state === "held").length,
      review: providerRows.filter((row) => row.state === "review").length,
      commitReady: providerRows.filter((row) => row.state === "commit-ready").length,
      previewReady: providerRows.filter((row) => row.state === "preview-ready").length,
      externalWrites: externalRows.length,
    }),
    acceptance: Object.freeze({
      required: providerAcceptance.acceptance?.required === true || externalRows.length > 0,
      acceptedForRuntime: blockers.length === 0,
      acceptedForExternalWrite: blockers.length === 0 && externalRows.length > 0,
      blockedBy: blockers,
      review,
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockers.length === 0,
      checkpoint: providerAcceptance.handoff?.checkpoint || runtimeState.checkpoint,
      statusChannel: providerAcceptance.handoff?.statusChannel || runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function commentClientActionState(row) {
  if (row.state === "blocked" || row.restartSafe === false) return "blocked";
  if (row.state === "review") return "review";
  if (row.state === "suppressed" || row.state === "skipped") return "suppressed";
  return "queued";
}

function buildCommentClientActionQueue(providerContract, lifecycle, runtimeState, exportPackage, deploymentIntent, syncPreview) {
  const commandRows = (runtimeState.commands ?? []).map((command) => Object.freeze({
    source: "comment-runtime",
    subject: `${command.field}:${command.value}`,
    action: command.nextAction,
    commandId: command.id,
    checkpoint: command.checkpoint,
    statusChannel: command.statusChannel,
    idempotencyKey: command.idempotencyKey,
    state: commentClientActionState(command),
    restartSafe: command.restartSafe === true,
    localOnly: command.localOnly !== false,
    writesExternalSystem: command.writesExternalSystem === true,
    statusPatch: command.statusPatch,
  }));
  const lifecycleRows = (lifecycle.controls ?? []).map((directive) => {
    const command = (runtimeState.commands ?? []).find((item) => item.range?.start?.offset === directive.range.start.offset);
    const schedule = directive.field === "schedule" ? parseScheduleValue(directive.value) : null;
    const setting = directive.field === "setting" ? parseSettingValue(directive.value) : null;
    const blocked = schedule?.valid === false || setting?.valid === false || command?.state === "blocked" || command?.restartSafe === false;
    return Object.freeze({
      source: "comment-lifecycle",
      subject: `${directive.field}:${directive.value}`,
      action: blocked ? command?.nextAction ?? lifecycle.nextAction : command?.nextAction ?? "apply_comment_lifecycle_control",
      commandId: command?.id ?? "",
      checkpoint: command?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: command?.statusChannel ?? runtimeState.statusChannel,
      idempotencyKey: command?.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-lifecycle", directive.field, directive.value),
      state: blocked ? "blocked" : command?.state === "skipped" ? "suppressed" : "queued",
      restartSafe: !blocked,
      localOnly: command?.localOnly !== false,
      writesExternalSystem: command?.writesExternalSystem === true,
      statusPatch: Object.freeze({
        state: blocked ? "blocked" : "queued",
        nextAction: blocked ? command?.nextAction ?? lifecycle.nextAction : command?.nextAction ?? "apply_comment_lifecycle_control",
        message: blocked
          ? `Comment lifecycle control ${directive.field} needs repair before client replay.`
          : `Comment lifecycle control ${directive.field} is queued for client replay.`,
      }),
    });
  });
  const exportRows = (exportPackage.manifest ?? [])
    .filter((row) => row.state === "publishable" || row.state === "blocked" || row.runtime.restartSafe === false)
    .map((row) => Object.freeze({
      source: "comment-export-package",
      subject: `${row.field}:${row.value}`,
      action: row.nextAction,
      commandId: row.runtime.commandId,
      checkpoint: exportPackage.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: exportPackage.handoff?.statusChannel ?? runtimeState.statusChannel,
      idempotencyKey: row.runtime.idempotencyKey || stableCommentCommandId("idempotent", "comment-export", row.field, row.value),
      state: row.state === "publishable" ? "queued" : row.state,
      restartSafe: row.runtime.restartSafe === true && row.state !== "blocked",
      localOnly: exportPackage.handoff?.localOnly !== false,
      writesExternalSystem: exportPackage.handoff?.writesExternalSystem === true,
      statusPatch: Object.freeze({
        state: row.state === "publishable" ? "queued" : row.state,
        nextAction: row.nextAction,
        message: `Comment export ${row.field} is ${row.state}.`,
      }),
    }));
  const syncRows = (syncPreview.nextSteps ?? []).map((step) => Object.freeze({
    source: "comment-sync-preview",
    subject: step.subject,
    action: step.action,
    commandId: stableCommentCommandId("comment-sync-step", syncPreview.preview?.previewId, step.order, step.subject),
    checkpoint: syncPreview.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: syncPreview.handoff?.statusChannel ?? runtimeState.statusChannel,
    idempotencyKey: stableCommentCommandId("idempotent", "comment-sync-step", step.action, step.subject),
    state: step.restartSafe ? "queued" : "blocked",
    restartSafe: step.restartSafe === true,
    localOnly: syncPreview.handoff?.localOnly !== false,
    writesExternalSystem: syncPreview.handoff?.writesExternalSystem === true,
    statusPatch: Object.freeze({
      state: step.restartSafe ? "queued" : "blocked",
      nextAction: step.action,
      message: `Comment sync preview step ${step.subject} is ${syncPreview.preview?.status ?? "unknown"}.`,
    }),
  }));
  const rows = Object.freeze([...commandRows, ...lifecycleRows, ...exportRows, ...syncRows]
    .map((row, index) => Object.freeze({
      schema: "aios.comment.client-action-row.v1",
      order: index + 1,
      id: stableCommentCommandId("comment-client-action", index + 1, row.source, row.commandId || row.subject),
      ...row,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));
  const blockers = rows.filter((row) => row.state === "blocked" || !row.restartSafe);
  const review = rows.filter((row) => row.state === "review");
  const ready = blockers.length === 0
    && runtimeState.clientHandoff?.ready === true
    && deploymentIntent.handoff?.ready !== false
    && syncPreview.handoff?.ready !== false;

  return Object.freeze({
    schema: "aios.comment.client-action-queue.v1",
    revision: stableCommentCommandId("comment-client-actions", runtimeState.revision, exportPackage.revision, rows.length, blockers.length),
    rows,
    blockers: Object.freeze(blockers.map((row) => `${row.source}:${row.subject}`).sort()),
    review: Object.freeze(review.map((row) => `${row.source}:${row.subject}`).sort()),
    counters: Object.freeze({
      rows: rows.length,
      queued: rows.filter((row) => row.state === "queued").length,
      blocked: blockers.length,
      review: review.length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction: blockers[0]?.action
        ?? (review.length > 0 ? "review_comment_client_actions" : "adopt_comment_client_actions"),
    }),
  });
}

function buildCommentWorkflowHandoff(providerAcceptance, clientActionQueue, deploymentIntent, syncPreview, runtimeState) {
  const providerRows = (providerAcceptance.preview?.providerRows ?? []).map((row, index) => Object.freeze({
    source: "comment-provider-acceptance",
    order: index + 1,
    subject: `${row.field}:${row.value}`,
    state: row.state,
    checkpoint: row.checkpoint ?? providerAcceptance.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: row.statusChannel ?? providerAcceptance.handoff?.statusChannel ?? runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.nextAction ?? providerAcceptance.handoff?.nextAction ?? "repair_comment_provider_acceptance",
  }));
  const actionRows = (clientActionQueue.rows ?? []).map((row, index) => Object.freeze({
    source: row.source || "comment-client-action",
    order: providerRows.length + index + 1,
    subject: row.subject,
    state: row.state,
    checkpoint: row.checkpoint ?? clientActionQueue.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: row.statusChannel ?? clientActionQueue.handoff?.statusChannel ?? runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.action ?? row.nextAction ?? clientActionQueue.handoff?.nextAction ?? "adopt_comment_client_actions",
  }));
  const deploymentRows = [
    ...(deploymentIntent.controls ?? []).map((row) => Object.freeze({
      source: "comment-deployment-control",
      subject: `${row.field}:${row.value}`,
      state: row.state,
      checkpoint: deploymentIntent.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: deploymentIntent.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(deploymentIntent.providers ?? []).map((row) => Object.freeze({
      source: "comment-deployment-provider",
      subject: `${row.field}:${row.value}`,
      state: row.state,
      checkpoint: deploymentIntent.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: deploymentIntent.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
  ].map((row, index) => Object.freeze({ order: providerRows.length + actionRows.length + index + 1, ...row }));
  const rows = Object.freeze([...providerRows, ...actionRows, ...deploymentRows]
    .sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const ready = blockedRows.length === 0
    && providerAcceptance.handoff?.ready !== false
    && clientActionQueue.handoff?.ready !== false
    && deploymentIntent.handoff?.ready !== false
    && syncPreview.handoff?.ready !== false
    && runtimeState.persistedView?.restartSafe !== false;
  const checkpoint = clientActionQueue.handoff?.checkpoint
    ?? providerAcceptance.handoff?.checkpoint
    ?? deploymentIntent.handoff?.checkpoint
    ?? runtimeState.checkpoint;
  const statusChannel = clientActionQueue.handoff?.statusChannel
    ?? providerAcceptance.handoff?.statusChannel
    ?? deploymentIntent.handoff?.statusChannel
    ?? runtimeState.statusChannel;
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_comment_workflow_handoff" : "handoff_comment_workflow");

  return Object.freeze({
    schema: "aios.comment.workflow-handoff.v1",
    revision: stableCommentCommandId("comment-workflow-handoff", runtimeState.revision, checkpoint, rows.length, blockedRows.length),
    ready,
    state: ready ? "ready" : blockedRows.length > 0 ? "blocked" : "review",
    checkpoint,
    statusChannel,
    preview: Object.freeze({
      previewId: stableCommentCommandId("comment-workflow-preview", runtimeState.revision, rows.length, blockedRows.length),
      title: "Mailchimp comment workflow handoff",
      rows,
      counters: Object.freeze({
        rows: rows.length,
        blocked: blockedRows.length,
        review: reviewRows.length,
        queued: rows.filter((row) => row.state === "queued").length,
        ready: rows.filter((row) => row.state === "ready").length,
        externalWrites: rows.filter((row) => row.writesExternalSystem).length,
        restartSafe: rows.filter((row) => row.restartSafe).length,
      }),
    }),
    validationSummary: Object.freeze({
      state: ready ? "ready" : blockedRows.length > 0 ? "blocked" : "review",
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      restartSafe: blockedRows.length === 0,
      nextAction,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      nextAction,
    }),
    nextSteps: Object.freeze((blockedRows.length > 0 ? blockedRows : reviewRows).map((row, index) => Object.freeze({
      order: index + 1,
      action: row.nextAction,
      subject: row.subject,
      source: row.source,
      restartSafe: row.restartSafe,
    }))),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildCommentClientStatusAdoption(providerContract, runtimeState, clientActionQueue, workflowHandoff, syncPreview) {
  const queueRows = (clientActionQueue.rows ?? []).map((row, index) => Object.freeze({
    source: row.source || "comment-client-action",
    subject: row.subject,
    order: index + 1,
    state: row.state === "queued" ? "pending" : row.state,
    checkpoint: row.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableCommentCommandId("idempotent", "comment-status", row.source, row.subject),
    nextAction: row.action || row.nextAction || clientActionQueue.handoff?.nextAction || "adopt_comment_client_actions",
  }));
  const workflowRows = (workflowHandoff.preview?.rows ?? []).map((row, index) => Object.freeze({
    source: row.source || "comment-workflow-handoff",
    subject: row.subject,
    order: queueRows.length + index + 1,
    state: row.state === "queued" ? "pending" : row.state,
    checkpoint: row.checkpoint || workflowHandoff.handoff?.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || workflowHandoff.handoff?.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: stableCommentCommandId("idempotent", "comment-workflow-status", row.source, row.subject),
    nextAction: row.nextAction || workflowHandoff.handoff?.nextAction || "handoff_comment_workflow",
  }));
  const syncRows = (syncPreview.preview?.providerRows ?? []).map((row, index) => Object.freeze({
    source: "comment-sync-provider",
    subject: `${row.field ?? "provider"}:${row.value ?? row.service ?? providerContract.service}`,
    order: queueRows.length + workflowRows.length + index + 1,
    state: row.state === "ready" ? "accepted" : row.state,
    checkpoint: row.checkpoint || syncPreview.handoff?.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || syncPreview.handoff?.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: stableCommentCommandId("idempotent", "comment-sync-status", row.field, row.value),
    nextAction: row.nextAction || syncPreview.handoff?.nextAction || "handoff_comment_sync_preview",
  }));
  const rows = Object.freeze([...queueRows, ...workflowRows, ...syncRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.order}`.localeCompare(`${right.source}:${right.subject}:${right.order}`))
    .map((row, index) => Object.freeze({
      schema: "aios.comment.client-status-adoption-row.v1",
      rowId: stableCommentCommandId("comment-client-status", index + 1, row.source, row.subject, row.checkpoint),
      order: index + 1,
      ...row,
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const acceptedRows = rows.filter((row) => row.state === "accepted" || row.state === "ready" || row.state === "pending");
  const ready = blockedRows.length === 0
    && clientActionQueue.handoff?.ready !== false
    && workflowHandoff.handoff?.ready !== false
    && syncPreview.handoff?.ready !== false
    && runtimeState.persistedView?.restartSafe !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : ready ? "ready" : "warming";
  const checkpoint = workflowHandoff.handoff?.checkpoint || clientActionQueue.handoff?.checkpoint || runtimeState.checkpoint;
  const statusChannel = workflowHandoff.handoff?.statusChannel || clientActionQueue.handoff?.statusChannel || runtimeState.statusChannel;
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_comment_client_status_adoption" : "publish_comment_client_status_adoption");

  return Object.freeze({
    schema: "aios.comment.client-status-adoption.v1",
    revision: stableCommentCommandId("comment-client-status-adoption", runtimeState.revision, checkpoint, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || providerContract.sync.externalWriteRequested === true,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function recoveryStateFromStatusRow(row) {
  if (row.state === "blocked" || row.restartSafe === false) return "blocked";
  if (row.state === "review") return "review";
  if (row.state === "accepted" || row.state === "ready" || row.state === "pending") return "recoverable";
  return "observed";
}

function buildCommentRecoveryAdoption(providerContract, runtimeState, clientStatusAdoption, diagnostics) {
  const diagnosticRows = diagnostics.map((item, index) => Object.freeze({
    source: "comment-diagnostic",
    subject: item.code,
    order: index + 1,
    state: item.severity === "error" ? "blocked" : "review",
    checkpoint: runtimeState.checkpoint,
    statusChannel: runtimeState.statusChannel,
    restartSafe: item.severity !== "error",
    localOnly: true,
    writesExternalSystem: false,
    idempotencyKey: stableCommentCommandId("idempotent", "comment-recovery-diagnostic", item.code, item.offset ?? index),
    nextAction: item.recovery ?? "inspect_comment",
  }));
  const statusRows = (clientStatusAdoption.rows ?? []).map((row, index) => Object.freeze({
    source: "comment-client-status",
    subject: `${row.source}:${row.subject}`,
    order: diagnosticRows.length + index + 1,
    state: recoveryStateFromStatusRow(row),
    checkpoint: row.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: stableCommentCommandId("idempotent", "comment-recovery-status", row.rowId || row.subject),
    nextAction: row.state === "blocked" ? row.nextAction : "adopt_comment_recovery_status",
  }));
  const rows = Object.freeze([...diagnosticRows, ...statusRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.order}`.localeCompare(`${right.source}:${right.subject}:${right.order}`))
    .map((row, index) => Object.freeze({
      schema: "aios.comment.recovery-adoption-row.v1",
      rowId: stableCommentCommandId("comment-recovery-adoption", index + 1, row.source, row.subject, row.checkpoint),
      order: index + 1,
      ...row,
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const recoverableRows = rows.filter((row) => row.state === "recoverable");
  const checkpoint = clientStatusAdoption.handoff?.checkpoint || runtimeState.checkpoint;
  const statusChannel = clientStatusAdoption.handoff?.statusChannel || runtimeState.statusChannel;
  const ready = blockedRows.length === 0
    && runtimeState.persistedView?.restartSafe !== false
    && clientStatusAdoption.handoff?.ready !== false
    && providerContract.handoff?.ready !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : ready ? "ready" : "warming";
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_comment_recovery_adoption" : "publish_comment_recovery_adoption");

  return Object.freeze({
    schema: "aios.comment.recovery-adoption.v1",
    revision: stableCommentCommandId("comment-recovery-adoption", runtimeState.revision, checkpoint, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      recoverable: recoverableRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      diagnostics: diagnosticRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || providerContract.sync.externalWriteRequested === true,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    persistedView: Object.freeze({
      key: stableCommentCommandId("comment-recovery-view", checkpoint, rows.length, state),
      restartSafe: ready,
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      resumeFromCheckpoint: ready || reviewRows.length > 0,
      blockedRowIds: Object.freeze(blockedRows.map((row) => row.rowId).sort()),
    }),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildCommentOperationalReport(providerContract, runtimeState, exportPackage, providerAcceptance, clientStatusAdoption, recoveryAdoption, diagnostics) {
  const rows = Object.freeze([
    Object.freeze({
      source: "comment-runtime",
      subject: runtimeState.checkpoint,
      state: runtimeState.persistedView?.restartSafe === false ? "blocked" : runtimeState.replayState === "hold" ? "blocked" : "ready",
      checkpoint: runtimeState.checkpoint,
      statusChannel: runtimeState.statusChannel,
      restartSafe: runtimeState.persistedView?.restartSafe !== false,
      localOnly: runtimeState.clientHandoff?.localOnly !== false,
      writesExternalSystem: runtimeState.clientHandoff?.writesExternalSystem === true,
      nextAction: runtimeState.resume?.nextAction ?? "inspect_comment_runtime_state",
    }),
    Object.freeze({
      source: "comment-export-package",
      subject: exportPackage.revision,
      state: exportPackage.handoff?.ready === false ? "blocked" : exportPackage.status?.state ?? "ready",
      checkpoint: exportPackage.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: exportPackage.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: exportPackage.handoff?.ready !== false,
      localOnly: exportPackage.handoff?.localOnly !== false,
      writesExternalSystem: exportPackage.handoff?.writesExternalSystem === true,
      nextAction: exportPackage.handoff?.nextAction ?? "inspect_comment_export_package",
    }),
    Object.freeze({
      source: "comment-provider-acceptance",
      subject: providerContract.service,
      state: providerAcceptance.handoff?.ready === false ? "blocked" : providerAcceptance.state ?? "ready",
      checkpoint: providerAcceptance.handoff?.checkpoint ?? providerContract.sync.checkpoint,
      statusChannel: providerAcceptance.handoff?.statusChannel ?? providerContract.statusChannel,
      restartSafe: providerAcceptance.handoff?.ready !== false,
      localOnly: providerAcceptance.handoff?.localOnly !== false,
      writesExternalSystem: providerAcceptance.handoff?.writesExternalSystem === true,
      nextAction: providerAcceptance.handoff?.nextAction ?? providerContract.handoff.nextAction,
    }),
    Object.freeze({
      source: "comment-client-status",
      subject: clientStatusAdoption.revision,
      state: clientStatusAdoption.handoff?.ready === false ? "blocked" : clientStatusAdoption.state ?? "ready",
      checkpoint: clientStatusAdoption.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: clientStatusAdoption.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: clientStatusAdoption.handoff?.ready !== false,
      localOnly: clientStatusAdoption.handoff?.localOnly !== false,
      writesExternalSystem: clientStatusAdoption.handoff?.writesExternalSystem === true,
      nextAction: clientStatusAdoption.handoff?.nextAction ?? "inspect_comment_client_status_adoption",
    }),
    Object.freeze({
      source: "comment-recovery",
      subject: recoveryAdoption.revision,
      state: recoveryAdoption.handoff?.ready === false ? "blocked" : recoveryAdoption.state ?? "ready",
      checkpoint: recoveryAdoption.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: recoveryAdoption.handoff?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: recoveryAdoption.persistedView?.restartSafe !== false,
      localOnly: recoveryAdoption.handoff?.localOnly !== false,
      writesExternalSystem: recoveryAdoption.handoff?.writesExternalSystem === true,
      nextAction: recoveryAdoption.handoff?.nextAction ?? "inspect_comment_recovery_adoption",
    }),
  ].map((row, index) => Object.freeze({
    schema: "aios.comment.operational-report-row.v1",
    rowId: stableCommentCommandId("comment-operational", index + 1, row.source, row.subject, row.checkpoint),
    order: index + 1,
    ...row,
  })));
  const diagnosticRows = diagnostics.map((item) => Object.freeze({
    source: "comment-diagnostic",
    subject: item.code,
    state: item.severity === "error" ? "blocked" : "review",
    checkpoint: runtimeState.checkpoint,
    statusChannel: runtimeState.statusChannel,
    restartSafe: item.severity !== "error",
    nextAction: item.recovery ?? "inspect_comment",
  }));
  const allRows = Object.freeze([...rows, ...diagnosticRows]);
  const blockedRows = allRows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = allRows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : "ready";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? providerContract.handoff.nextAction;

  return Object.freeze({
    schema: "aios.comment.operational-report.v1",
    revision: stableCommentCommandId("comment-operational-report", runtimeState.revision, exportPackage.revision, providerAcceptance.revision, state),
    state,
    rows,
    diagnostics: Object.freeze(diagnosticRows),
    counters: Object.freeze({
      rows: rows.length,
      diagnostics: diagnostics.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: allRows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: providerContract.sync.checkpoint || runtimeState.checkpoint,
      statusChannel: providerContract.statusChannel || runtimeState.statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildCommentIncidentAnalytics(analytics, history, operationalReport, providerContract, runtimeState, diagnostics) {
  const operationalRows = Object.freeze([
    ...(operationalReport.rows ?? []),
    ...(operationalReport.diagnostics ?? []),
  ].map((row, index) => Object.freeze({
    schema: "aios.comment.incident-analytics-row.v1",
    order: index + 1,
    source: row.source,
    subject: row.subject,
    state: row.state,
    severity: row.state === "blocked" ? "major" : row.state === "review" ? "minor" : "info",
    checkpoint: row.checkpoint ?? runtimeState.checkpoint,
    statusChannel: row.statusChannel ?? runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.nextAction ?? operationalReport.handoff?.nextAction ?? "inspect_comment_incident",
  })));
  const historyRows = Object.freeze((history.timeline ?? []).map((event, index) => Object.freeze({
    schema: "aios.comment.incident-analytics-row.v1",
    order: operationalRows.length + index + 1,
    source: "comment-history",
    subject: `${event.field}:${event.value}`,
    state: event.state === "blocked" ? "blocked" : event.state === "export-ready" ? "ready" : "review",
    severity: event.state === "blocked" ? "major" : event.diagnosticCount > 0 ? "minor" : "info",
    checkpoint: runtimeState.checkpoint,
    statusChannel: runtimeState.statusChannel,
    restartSafe: event.state !== "blocked",
    localOnly: true,
    writesExternalSystem: false,
    nextAction: event.nextAction,
  })));
  const rows = Object.freeze([...operationalRows, ...historyRows]
    .sort((left, right) => `${left.severity}:${left.source}:${left.subject}`.localeCompare(`${right.severity}:${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const exportReady = blockedRows.length === 0 && operationalReport.handoff?.ready !== false;
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "export_comment_incident_analytics" : "retain_empty_comment_incident_analytics");

  return Object.freeze({
    schema: "aios.comment.incident-analytics.v1",
    revision: stableCommentCommandId(
      "comment-incident-analytics",
      analytics.counters?.directives ?? 0,
      history.revision,
      operationalReport.revision,
      blockedRows.length,
      reviewRows.length,
    ),
    state: blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty",
    rows,
    counters: Object.freeze({
      rows: rows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      warnings: diagnostics.filter((item) => item.severity === "warning").length,
      errors: diagnostics.filter((item) => item.severity === "error").length,
      directives: analytics.counters?.directives ?? 0,
      exportable: analytics.counters?.exportable ?? 0,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    exportSummary: Object.freeze({
      exportReady,
      fields: Object.freeze(Object.keys(analytics.byField ?? {}).sort()),
      timelineRevision: history.revision,
      blockedSubjects: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}`).sort()),
      reviewSubjects: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: exportReady,
      checkpoint: operationalReport.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: operationalReport.handoff?.statusChannel ?? providerContract.statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildCommentClientResumeEnvelope(providerContract, runtimeState, clientStatusAdoption, recoveryAdoption, operationalReport) {
  const statusRows = Object.freeze((clientStatusAdoption.rows ?? []).map((row) => Object.freeze({
    source: "comment-client-status",
    subject: `${row.source}:${row.subject}`,
    state: row.state,
    checkpoint: row.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableCommentCommandId("idempotent", "comment-resume-status", row.rowId ?? row.subject),
    nextAction: row.nextAction || clientStatusAdoption.handoff?.nextAction || "publish_comment_client_status_adoption",
  })));
  const recoveryRows = Object.freeze((recoveryAdoption.rows ?? []).map((row) => Object.freeze({
    source: "comment-recovery",
    subject: `${row.source}:${row.subject}`,
    state: row.state,
    checkpoint: row.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableCommentCommandId("idempotent", "comment-resume-recovery", row.rowId ?? row.subject),
    nextAction: row.nextAction || recoveryAdoption.handoff?.nextAction || "publish_comment_recovery_adoption",
  })));
  const operationalRows = Object.freeze((operationalReport.rows ?? []).map((row) => Object.freeze({
    source: "comment-operational",
    subject: `${row.source}:${row.subject}`,
    state: row.state,
    checkpoint: row.checkpoint || runtimeState.checkpoint,
    statusChannel: row.statusChannel || runtimeState.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: stableCommentCommandId("idempotent", "comment-resume-operational", row.rowId ?? row.subject),
    nextAction: row.nextAction || operationalReport.handoff?.nextAction || "publish_comment_operational_report",
  })));
  const rows = Object.freeze([...statusRows, ...recoveryRows, ...operationalRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.idempotencyKey}`.localeCompare(`${right.source}:${right.subject}:${right.idempotencyKey}`))
    .map((row, index) => Object.freeze({
      schema: "aios.comment.client-resume-envelope-row.v1",
      order: index + 1,
      rowId: stableCommentCommandId("comment-client-resume", index + 1, row.source, row.subject, row.checkpoint),
      ...row,
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const checkpoint = clientStatusAdoption.handoff?.checkpoint
    || recoveryAdoption.handoff?.checkpoint
    || operationalReport.handoff?.checkpoint
    || runtimeState.checkpoint;
  const statusChannel = clientStatusAdoption.handoff?.statusChannel
    || recoveryAdoption.handoff?.statusChannel
    || operationalReport.handoff?.statusChannel
    || runtimeState.statusChannel;
  const hydrated = Boolean(checkpoint && statusChannel && runtimeState.persistedView?.restartSafe !== false);
  const ready = hydrated
    && blockedRows.length === 0
    && clientStatusAdoption.handoff?.ready !== false
    && recoveryAdoption.handoff?.ready !== false
    && operationalReport.handoff?.ready !== false
    && providerContract.handoff?.ready !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : ready ? "ready" : "warming";
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_comment_client_resume_envelope" : "resume_comment_client_runtime");

  return Object.freeze({
    schema: "aios.comment.client-resume-envelope.v1",
    revision: stableCommentCommandId("comment-client-resume", runtimeState.revision, checkpoint, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      statusRows: statusRows.length,
      recoveryRows: recoveryRows.length,
      operationalRows: operationalRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    clientState: Object.freeze({
      requiredKeys: Object.freeze(["requestId", "workflowId", "checkpoint", "statusChannel", "resumeToken"]),
      hydrated,
      checkpoint,
      statusChannel,
      resumeToken: stableCommentCommandId("resume", checkpoint, runtimeState.revision, recoveryAdoption.revision),
      persistenceRevision: runtimeState.revision,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || providerContract.sync?.externalWriteRequested === true,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function analyticsReportRow(source, subject, state, checkpoint, statusChannel, nextAction, extras = {}) {
  return Object.freeze({
    schema: "aios.comment.analytics-report-row.v1",
    source,
    subject: String(subject ?? "").trim() || source,
    state,
    checkpoint,
    statusChannel,
    restartSafe: extras.restartSafe !== false,
    localOnly: extras.localOnly !== false,
    writesExternalSystem: extras.writesExternalSystem === true,
    exportReady: extras.exportReady === true,
    idempotencyKey: extras.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-analytics-report", source, subject),
    nextAction,
    detail: Object.freeze(extras.detail ?? {}),
  });
}

function buildCommentAnalyticsReport({
  comments,
  directives,
  contracts,
  diagnostics,
  analytics,
  history,
  exportSummary,
  exportPackage,
  providerContract,
  lifecycle,
  lifecycleReadiness,
  runtimeState,
  clientResumeEnvelope,
}) {
  const checkpoint = clientResumeEnvelope.handoff?.checkpoint
    || providerContract.sync?.checkpoint
    || runtimeState.checkpoint;
  const statusChannel = clientResumeEnvelope.handoff?.statusChannel
    || providerContract.statusChannel
    || runtimeState.statusChannel;
  const directiveRows = directives.map((directive, index) => {
    const command = (runtimeState.commands ?? []).find((item) => item.range?.start?.offset === directive.range.start.offset);
    const state = !directive.value
      ? "blocked"
      : command?.state === "blocked"
        ? "blocked"
        : EXPORT_FIELDS.has(directive.field) ? "export-ready" : "observed";
    return analyticsReportRow(
      "directive",
      `${directive.field}:${directive.value || index + 1}`,
      state,
      command?.checkpoint ?? checkpoint,
      command?.statusChannel ?? statusChannel,
      state === "blocked"
        ? command?.nextAction ?? "repair_comment_directive"
        : EXPORT_FIELDS.has(directive.field) ? "export_comment_analytics_row" : "record_comment_analytics_row",
      {
        restartSafe: command?.restartSafe !== false && state !== "blocked",
        localOnly: command?.localOnly ?? providerContract.sync?.localOnly,
        writesExternalSystem: command?.writesExternalSystem === true,
        exportReady: state === "export-ready",
        idempotencyKey: command?.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-analytics-directive", directive.field, directive.value),
        detail: {
          field: directive.field,
          contractRole: directive.contractRole,
          line: directive.range.start.line,
          column: directive.range.start.column,
        },
      },
    );
  });
  const exportRows = (exportPackage.manifest ?? []).map((row) => analyticsReportRow(
    "export-package",
    `${row.field}:${row.value}`,
    row.state === "publishable" ? "export-ready" : row.state,
    row.checkpoint ?? checkpoint,
    row.statusChannel ?? statusChannel,
    row.nextAction ?? "inspect_comment_export_package",
    {
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      exportReady: row.state === "publishable",
      idempotencyKey: stableCommentCommandId("idempotent", "comment-analytics-export", row.field, row.value),
      detail: {
        field: row.field,
        exportable: row.exportable,
        lifecycleControl: row.lifecycleControl,
      },
    },
  ));
  const lifecycleRows = (lifecycleReadiness.rows ?? []).map((row) => analyticsReportRow(
    "lifecycle-readiness",
    `${row.field}:${row.value}`,
    row.state === "ready" ? "ready" : row.state,
    row.checkpoint ?? checkpoint,
    row.statusChannel ?? statusChannel,
    row.nextAction ?? lifecycle.nextAction,
    {
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      exportReady: row.state === "ready" && EXPORT_FIELDS.has(row.field),
      idempotencyKey: row.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-analytics-lifecycle", row.field, row.value),
      detail: {
        suppressed: row.suppressed,
        blockers: row.blockers ?? [],
      },
    },
  ));
  const diagnosticRows = diagnostics.map((item) => analyticsReportRow(
    "diagnostic",
    item.code,
    item.severity === "error" ? "blocked" : "review",
    checkpoint,
    statusChannel,
    item.recovery ?? "inspect_comment_diagnostic",
    {
      restartSafe: item.severity !== "error",
      localOnly: true,
      writesExternalSystem: false,
      exportReady: false,
      idempotencyKey: stableCommentCommandId("idempotent", "comment-analytics-diagnostic", item.code, item.offset ?? 0),
      detail: {
        severity: item.severity,
        message: item.message,
        line: item.line,
        column: item.column,
      },
    },
  ));
  const rows = Object.freeze([...directiveRows, ...exportRows, ...lifecycleRows, ...diagnosticRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.idempotencyKey}`.localeCompare(`${right.source}:${right.subject}:${right.idempotencyKey}`))
    .map((row, index) => Object.freeze({
      ...row,
      order: index + 1,
      rowId: stableCommentCommandId("comment-analytics-report", index + 1, row.source, row.subject, checkpoint),
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const exportReadyRows = rows.filter((row) => row.exportReady);
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (exportReadyRows.length > 0 ? "publish_comment_analytics_report" : "retain_comment_analytics_report");

  return Object.freeze({
    schema: "aios.comment.analytics-report.v1",
    revision: stableCommentCommandId(
      "comment-analytics-report",
      history.revision,
      runtimeState.revision,
      exportPackage.revision,
      state,
      rows.length,
      blockedRows.length,
    ),
    state,
    rows,
    timeline: Object.freeze(rows.map((row) => Object.freeze({
      sequence: row.order,
      source: `comment-analytics:${row.source}`,
      label: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      nextAction: row.nextAction,
    }))),
    counters: Object.freeze({
      rows: rows.length,
      comments: comments.length,
      directives: directives.length,
      contracts: contracts.length,
      exportReady: exportReadyRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      diagnostics: diagnostics.length,
      warnings: analytics.counters?.warnings ?? 0,
      errors: analytics.counters?.errors ?? 0,
      lifecycleControls: lifecycle.controls?.length ?? 0,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    exportSummary: Object.freeze({
      ready: exportSummary.exportReady === true && blockedRows.length === 0,
      exportableFields: exportSummary.exportableFields ?? [],
      publishableRows: Object.freeze(exportReadyRows.map((row) => row.rowId).sort()),
      blockedRows: Object.freeze(blockedRows.map((row) => row.rowId).sort()),
      historyRevision: history.revision,
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0 && clientResumeEnvelope.handoff?.ready !== false,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildCommentLifecycleCommandCenter({
  lifecycle,
  lifecycleReadiness,
  providerContract,
  runtimeState,
  deploymentIntent,
  syncPreview,
  providerCommitWindow,
  analyticsReport,
}) {
  const checkpoint = lifecycleReadiness.handoff?.checkpoint
    || runtimeState.checkpoint
    || providerContract.sync?.checkpoint
    || "comment:lifecycle";
  const statusChannel = lifecycleReadiness.handoff?.statusChannel
    || runtimeState.statusChannel
    || providerContract.statusChannel
    || "mailchimp.contract.status";
  const commandRows = Object.freeze((lifecycle.controls ?? []).map((directive, index) => {
    const readinessRow = (lifecycleReadiness.rows ?? []).find((row) => row.field === directive.field && row.value === directive.value);
    const runtimeCommand = (runtimeState.commands ?? []).find((command) => command.range?.start?.offset === directive.range.start.offset);
    const deploymentRow = (deploymentIntent.controls ?? []).find((row) => row.field === directive.field && row.value === directive.value);
    const syncRow = (syncPreview.preview?.lifecycleRows ?? []).find((row) => row.field === directive.field && row.value === directive.value);
    const blockers = Object.freeze([
      ...(readinessRow?.blockers ?? []),
      ...(runtimeCommand?.state === "blocked" ? ["runtime_command_blocked"] : []),
      ...(runtimeCommand?.restartSafe === false ? ["runtime_command_not_restart_safe"] : []),
      ...(deploymentRow?.state === "blocked" ? ["deployment_blocked"] : []),
      ...(syncRow?.state === "blocked" ? ["sync_preview_blocked"] : []),
    ].sort());
    const review = Object.freeze([
      ...(readinessRow?.state === "suppressed" ? ["suppressed_by_disable"] : []),
      ...(syncRow?.state === "review" ? ["sync_preview_review"] : []),
    ].sort());
    const state = blockers.length > 0
      ? "blocked"
      : review.length > 0 ? "review" : readinessRow?.state === "suppressed" ? "suppressed" : "ready";
    return Object.freeze({
      schema: "aios.comment.lifecycle-command-center-row.v1",
      order: index + 1,
      field: directive.field,
      value: directive.value,
      state,
      commandId: runtimeCommand?.id ?? "",
      checkpoint: readinessRow?.checkpoint ?? runtimeCommand?.checkpoint ?? checkpoint,
      statusChannel: readinessRow?.statusChannel ?? runtimeCommand?.statusChannel ?? statusChannel,
      idempotencyKey: runtimeCommand?.idempotencyKey ?? readinessRow?.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-lifecycle-center", directive.field, directive.value),
      restartSafe: blockers.length === 0 && runtimeCommand?.restartSafe !== false && readinessRow?.restartSafe !== false,
      localOnly: runtimeCommand?.localOnly ?? readinessRow?.localOnly ?? providerContract.sync.localOnly,
      writesExternalSystem: runtimeCommand?.writesExternalSystem === true || readinessRow?.writesExternalSystem === true,
      schedule: directive.field === "schedule" ? parseScheduleValue(directive.value) : null,
      setting: directive.field === "setting" ? parseSettingValue(directive.value) : null,
      blockers,
      review,
      nextAction: blockers.includes("invalid_schedule")
        ? "repair_comment_schedule"
        : blockers.includes("invalid_setting")
          ? "repair_comment_setting"
          : blockers.length > 0
            ? runtimeCommand?.nextAction ?? readinessRow?.nextAction ?? lifecycle.nextAction
            : review.length > 0 ? "review_comment_lifecycle_command" : runtimeCommand?.nextAction ?? "apply_comment_lifecycle_command",
    });
  }));
  const providerRows = Object.freeze((providerCommitWindow.providerRows ?? []).map((row, index) => Object.freeze({
    schema: "aios.comment.lifecycle-command-center-provider-row.v1",
    order: index + 1,
    field: row.field,
    value: row.value,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.nextAction,
  })));
  const analyticsRows = Object.freeze((analyticsReport.rows ?? [])
    .filter((row) => row.source === "lifecycle-readiness" || row.source === "directive")
    .map((row) => Object.freeze({
      source: row.source,
      subject: row.subject,
      state: row.state,
      restartSafe: row.restartSafe === true,
      exportReady: row.exportReady === true,
      nextAction: row.nextAction,
    })));
  const blockers = Object.freeze([
    ...commandRows.flatMap((row) => row.blockers.map((blocker) => `command:${row.field}:${blocker}`)),
    ...providerRows.filter((row) => row.state === "held" || row.state === "blocked" || !row.restartSafe).map((row) => `provider:${row.field}:${row.nextAction}`),
    ...analyticsRows.filter((row) => row.state === "blocked" || !row.restartSafe).map((row) => `analytics:${row.subject}:${row.nextAction}`),
  ].sort());
  const review = Object.freeze([
    ...commandRows.flatMap((row) => row.review.map((item) => `command:${row.field}:${item}`)),
    ...providerRows.filter((row) => row.state === "review").map((row) => `provider:${row.field}`),
    ...analyticsRows.filter((row) => row.state === "review").map((row) => `analytics:${row.subject}`),
  ].sort());
  const state = blockers.length > 0
    ? "blocked"
    : review.length > 0 ? "review" : commandRows.length > 0 ? "ready" : "empty";
  const nextAction = blockers[0]?.split(":").slice(2).join(":")
    || (review.length > 0 ? "review_comment_lifecycle_command_center" : "apply_comment_lifecycle_command_center");

  return Object.freeze({
    schema: "aios.comment.lifecycle-command-center.v1",
    revision: stableCommentCommandId("comment-lifecycle-command-center", runtimeState.revision, state, commandRows.length, blockers.length),
    state,
    commandRows,
    providerRows,
    analyticsRows,
    counters: Object.freeze({
      commands: commandRows.length,
      ready: commandRows.filter((row) => row.state === "ready").length,
      suppressed: commandRows.filter((row) => row.state === "suppressed").length,
      blocked: blockers.length,
      review: review.length,
      providerRows: providerRows.length,
      analyticsRows: analyticsRows.length,
      restartSafe: commandRows.filter((row) => row.restartSafe).length,
      externalWrites: commandRows.filter((row) => row.writesExternalSystem).length + providerRows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockers.length === 0,
      acceptedForExternalWrite: blockers.length === 0 && [...commandRows, ...providerRows].some((row) => row.writesExternalSystem),
      blockedBy: blockers,
      review,
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockers.length === 0,
      checkpoint,
      statusChannel,
      localOnly: [...commandRows, ...providerRows].every((row) => !row.writesExternalSystem),
      writesExternalSystem: [...commandRows, ...providerRows].some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildCommentProviderHandoffPanel(providerContract, providerAcceptance, providerCommitWindow, lifecycleCommandCenter, clientResumeEnvelope, analyticsReport) {
  const providerRows = Object.freeze((providerAcceptance.preview?.providerRows ?? providerCommitWindow.providerRows ?? []).map((row, index) => Object.freeze({
    schema: "aios.comment.provider-handoff-panel-row.v1",
    order: index + 1,
    source: "provider",
    subject: `${row.field ?? "provider"}:${row.value ?? providerContract.service}`,
    state: row.state ?? "unknown",
    service: providerContract.service,
    adapter: providerContract.adapter,
    checkpoint: row.checkpoint ?? providerContract.sync?.checkpoint ?? "",
    statusChannel: row.statusChannel ?? providerContract.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly ?? providerContract.sync?.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    accepted: row.accepted === true || row.state === "ready",
    nextAction: row.nextAction ?? providerContract.handoff?.nextAction ?? "handoff_comment_provider_status",
  })));
  const lifecycleRows = Object.freeze((lifecycleCommandCenter.commandRows ?? []).map((row, index) => Object.freeze({
    schema: "aios.comment.provider-handoff-panel-row.v1",
    order: providerRows.length + index + 1,
    source: "lifecycle",
    subject: `${row.field}:${row.value}`,
    state: row.state,
    service: providerContract.service,
    adapter: providerContract.adapter,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    accepted: row.state === "ready" || row.state === "suppressed",
    nextAction: row.nextAction,
  })));
  const analyticsRows = Object.freeze((analyticsReport.rows ?? []).filter((row) => row.state === "blocked" || row.state === "review").map((row, index) => Object.freeze({
    schema: "aios.comment.provider-handoff-panel-row.v1",
    order: providerRows.length + lifecycleRows.length + index + 1,
    source: "analytics",
    subject: `${row.source}:${row.subject}`,
    state: row.state,
    service: providerContract.service,
    adapter: providerContract.adapter,
    checkpoint: analyticsReport.handoff?.checkpoint ?? providerContract.sync?.checkpoint ?? "",
    statusChannel: analyticsReport.handoff?.statusChannel ?? providerContract.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    accepted: row.state !== "blocked",
    nextAction: row.nextAction,
  })));
  const rows = Object.freeze([...providerRows, ...lifecycleRows, ...analyticsRows]);
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0
    ? "blocked"
    : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "handoff_comment_provider_panel" : "attach_comment_provider");

  return Object.freeze({
    schema: "aios.comment.provider-handoff-panel.v1",
    revision: stableCommentCommandId("comment-provider-panel", providerContract.sync?.checkpoint, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      providerRows: providerRows.length,
      lifecycleRows: lifecycleRows.length,
      analyticsRows: analyticsRows.length,
      accepted: rows.filter((row) => row.accepted).length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0 && clientResumeEnvelope.clientState?.hydrated !== false,
      acceptedForExternalWrite: blockedRows.length === 0 && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: clientResumeEnvelope.handoff?.checkpoint ?? providerContract.sync?.checkpoint ?? "",
      statusChannel: clientResumeEnvelope.handoff?.statusChannel ?? providerContract.statusChannel,
      localOnly: rows.every((row) => row.localOnly !== false),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildCommentControlIntent(lifecycle, lifecycleCommandCenter, providerContract, providerHandoffPanel, runtimeState) {
  const settingRows = Object.freeze(Object.entries(lifecycle.settings ?? {}).map(([key, value], index) => {
    const commandRow = (lifecycleCommandCenter.commandRows ?? []).find((row) => row.field === "setting" && row.value.startsWith(`${key}=`));
    const state = commandRow?.state ?? "ready";
    return Object.freeze({
      schema: "aios.comment.control-intent-row.v1",
      order: index + 1,
      source: "setting",
      subject: key,
      value,
      state,
      enabled: state !== "blocked",
      checkpoint: commandRow?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: commandRow?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: commandRow?.restartSafe !== false,
      localOnly: commandRow?.localOnly !== false,
      writesExternalSystem: commandRow?.writesExternalSystem === true,
      idempotencyKey: commandRow?.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-control-setting", key),
      nextAction: commandRow?.nextAction ?? "apply_comment_setting",
    });
  }));
  const scheduleRows = Object.freeze((lifecycle.schedules ?? []).map((schedule, index) => {
    const commandRow = (lifecycleCommandCenter.commandRows ?? []).find((row) => row.field === "schedule" && row.value === schedule.value);
    const state = schedule.parsed?.valid === false ? "blocked" : commandRow?.state ?? "ready";
    return Object.freeze({
      schema: "aios.comment.control-intent-row.v1",
      order: settingRows.length + index + 1,
      source: "schedule",
      subject: schedule.value,
      value: schedule.value,
      state,
      enabled: state !== "blocked",
      checkpoint: commandRow?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: commandRow?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: commandRow?.restartSafe !== false && schedule.parsed?.valid !== false,
      localOnly: commandRow?.localOnly !== false,
      writesExternalSystem: commandRow?.writesExternalSystem === true,
      idempotencyKey: commandRow?.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-control-schedule", schedule.value),
      nextAction: schedule.parsed?.valid === false ? "repair_comment_schedule" : commandRow?.nextAction ?? "schedule_comment_contracts",
    });
  }));
  const toggleRows = Object.freeze((lifecycle.controls ?? [])
    .filter((directive) => directive.field === "enable" || directive.field === "disable")
    .map((directive, index) => {
      const commandRow = (lifecycleCommandCenter.commandRows ?? []).find((row) => row.field === directive.field && row.value === directive.value);
      const disabled = (lifecycle.disabled ?? []).includes(directive.value);
      const state = commandRow?.state ?? (directive.field === "enable" && disabled ? "suppressed" : "ready");
      return Object.freeze({
        schema: "aios.comment.control-intent-row.v1",
        order: settingRows.length + scheduleRows.length + index + 1,
        source: directive.field,
        subject: directive.value,
        value: directive.value,
        state,
        enabled: directive.field === "enable" && !disabled && state !== "blocked",
        checkpoint: commandRow?.checkpoint ?? runtimeState.checkpoint,
        statusChannel: commandRow?.statusChannel ?? runtimeState.statusChannel,
        restartSafe: commandRow?.restartSafe !== false,
        localOnly: commandRow?.localOnly !== false,
        writesExternalSystem: commandRow?.writesExternalSystem === true,
        idempotencyKey: commandRow?.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-control-toggle", directive.field, directive.value),
        nextAction: state === "suppressed" ? "retain_disabled_comment_control" : commandRow?.nextAction ?? `${directive.field}_comment_contract`,
      });
    }));
  const providerRows = Object.freeze((providerHandoffPanel.rows ?? [])
    .filter((row) => row.source === "provider")
    .map((row, index) => Object.freeze({
      schema: "aios.comment.control-intent-row.v1",
      order: settingRows.length + scheduleRows.length + toggleRows.length + index + 1,
      source: "provider-sync",
      subject: row.subject,
      value: providerContract.sync?.mode ?? "local",
      state: row.state,
      enabled: row.accepted === true && row.state !== "blocked",
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: stableCommentCommandId("idempotent", "comment-control-provider", row.subject),
      nextAction: row.nextAction,
    })));
  const rows = Object.freeze([...settingRows, ...scheduleRows, ...toggleRows, ...providerRows]
    .sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`))
    .map((row, index) => Object.freeze({ ...row, order: index + 1 })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "adopt_comment_control_intent" : "attach_comment_control_intent");

  return Object.freeze({
    schema: "aios.comment.control-intent.v1",
    revision: stableCommentCommandId("comment-control-intent", runtimeState.revision, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      settings: settingRows.length,
      schedules: scheduleRows.length,
      toggles: toggleRows.length,
      providers: providerRows.length,
      enabled: rows.filter((row) => row.enabled).length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: rows[0]?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: rows[0]?.statusChannel ?? runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildCommentExternalHandoffState(providerContract, providerHandoffPanel, providerCommitWindow, lifecycleCommandCenter, clientResumeEnvelope, analyticsReport, controlIntent = null) {
  const panelRows = (providerHandoffPanel.rows ?? []).map((row, index) => Object.freeze({
    source: `comment-panel:${row.source}`,
    subject: row.subject,
    order: index + 1,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: stableCommentCommandId("idempotent", "comment-panel", row.source, row.subject),
    nextAction: row.nextAction,
  }));
  const commitRows = (providerCommitWindow.providerRows ?? []).map((row, index) => Object.freeze({
    source: "comment-provider-commit",
    subject: `${row.field}:${row.value}`,
    order: panelRows.length + index + 1,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableCommentCommandId("idempotent", "comment-provider-commit", row.field, row.value),
    nextAction: row.nextAction,
  }));
  const lifecycleRows = (lifecycleCommandCenter.commandRows ?? []).map((row, index) => Object.freeze({
    source: "comment-lifecycle-command",
    subject: `${row.field}:${row.value}`,
    order: panelRows.length + commitRows.length + index + 1,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableCommentCommandId("idempotent", "comment-lifecycle-command", row.field, row.value),
    nextAction: row.nextAction,
  }));
  const resumeRows = (clientResumeEnvelope.rows ?? []).map((row, index) => Object.freeze({
    source: "comment-client-resume",
    subject: `${row.source}:${row.subject}`,
    order: panelRows.length + commitRows.length + lifecycleRows.length + index + 1,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableCommentCommandId("idempotent", "comment-client-resume", row.source, row.subject),
    nextAction: row.nextAction,
  }));
  const analyticsReviewRows = (analyticsReport.rows ?? [])
    .filter((row) => row.state === "blocked" || row.state === "review")
    .map((row, index) => Object.freeze({
      source: "comment-analytics-review",
      subject: `${row.source}:${row.subject}`,
      order: panelRows.length + commitRows.length + lifecycleRows.length + resumeRows.length + index + 1,
      state: row.state,
      checkpoint: analyticsReport.handoff?.checkpoint ?? providerContract.sync?.checkpoint ?? "",
      statusChannel: analyticsReport.handoff?.statusChannel ?? providerContract.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: stableCommentCommandId("idempotent", "comment-analytics-review", row.source, row.subject),
      nextAction: row.nextAction,
    }));
  const controlIntentRows = (controlIntent?.rows ?? []).map((row, index) => Object.freeze({
    source: `comment-control-intent:${row.source}`,
    subject: row.subject,
    order: panelRows.length + commitRows.length + lifecycleRows.length + resumeRows.length + analyticsReviewRows.length + index + 1,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey || stableCommentCommandId("idempotent", "comment-control-intent", row.source, row.subject),
    nextAction: row.nextAction,
  }));
  const rows = Object.freeze([...panelRows, ...commitRows, ...lifecycleRows, ...resumeRows, ...analyticsReviewRows, ...controlIntentRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.order}`.localeCompare(`${right.source}:${right.subject}:${right.order}`))
    .map((row, index) => Object.freeze({
      schema: "aios.comment.external-handoff-row.v1",
      rowId: stableCommentCommandId("comment-external-handoff", index + 1, row.source, row.subject, row.checkpoint),
      order: index + 1,
      ...row,
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.state === "held" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const checkpoints = Object.freeze(Array.from(new Set([
    providerContract.sync?.checkpoint,
    providerHandoffPanel.handoff?.checkpoint,
    providerCommitWindow.handoff?.checkpoint,
    lifecycleCommandCenter.handoff?.checkpoint,
    clientResumeEnvelope.handoff?.checkpoint,
    analyticsReport.handoff?.checkpoint,
    ...rows.map((row) => row.checkpoint),
  ].filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    providerContract.statusChannel,
    providerHandoffPanel.handoff?.statusChannel,
    providerCommitWindow.handoff?.statusChannel,
    lifecycleCommandCenter.handoff?.statusChannel,
    clientResumeEnvelope.handoff?.statusChannel,
    analyticsReport.handoff?.statusChannel,
    ...rows.map((row) => row.statusChannel),
  ].filter(Boolean))).sort());
  const externalRequested = providerContract.sync?.externalWriteRequested === true
    || rows.some((row) => row.writesExternalSystem);
  const externalAllowed = providerContract.sync?.externalWriteAllowed === true
    && blockedRows.length === 0
    && rows.every((row) => row.restartSafe !== false && row.idempotencyKey);
  const ready = blockedRows.length === 0
    && providerContract.handoff?.ready !== false
    && providerHandoffPanel.handoff?.ready !== false
    && providerCommitWindow.handoff?.ready !== false
    && lifecycleCommandCenter.handoff?.ready !== false
    && clientResumeEnvelope.handoff?.ready !== false
    && analyticsReport.handoff?.ready !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : ready ? "ready" : "warming";
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_comment_external_handoff" : "publish_comment_external_handoff");

  return Object.freeze({
    schema: "aios.comment.external-handoff-state.v1",
    revision: stableCommentCommandId("comment-external-handoff", providerContract.sync?.checkpoint, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      panelRows: panelRows.length,
      commitRows: commitRows.length,
      lifecycleRows: lifecycleRows.length,
      resumeRows: resumeRows.length,
      analyticsReviewRows: analyticsReviewRows.length,
      controlIntentRows: controlIntentRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && externalAllowed,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    sync: Object.freeze({
      externalWriteRequested: externalRequested,
      externalWriteAllowed: externalAllowed,
      localOnly: !externalAllowed,
      checkpoints,
      statusChannels,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: checkpoints[0] || providerContract.sync?.checkpoint || "",
      statusChannel: statusChannels[0] || providerContract.statusChannel,
      localOnly: !externalAllowed,
      writesExternalSystem: externalAllowed,
      nextAction,
    }),
  });
}

function buildCommentClientPreviewAcceptance({
  contracts,
  directives,
  diagnostics,
  lifecycleReadiness,
  syncPreview,
  providerAcceptance,
  clientActionQueue,
  workflowHandoff,
  clientStatusAdoption,
  recoveryAdoption,
  operationalReport,
  clientResumeEnvelope,
  analyticsReport,
  lifecycleCommandCenter,
  providerHandoffPanel,
  externalHandoffState,
  runtimeState,
  providerContract,
}) {
  const directiveRows = directives.map((directive, index) => {
    const command = (runtimeState.commands ?? []).find((item) => item.range?.start?.offset === directive.range.start.offset);
    const contract = contracts.find((item) => item.directive?.range?.start?.offset === directive.range.start.offset);
    const state = !directive.value
      ? "blocked"
      : command?.state === "blocked" || command?.restartSafe === false
        ? "blocked"
        : contract?.exportsToKernel ? "ready" : contract?.lifecycleControl ? "queued" : "observed";
    return Object.freeze({
      schema: "aios.comment.client-preview-acceptance-row.v1",
      source: "directive",
      subject: `${directive.field}:${directive.value || index + 1}`,
      state,
      checkpoint: command?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: command?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: command?.restartSafe !== false && state !== "blocked",
      localOnly: command?.localOnly !== false,
      writesExternalSystem: command?.writesExternalSystem === true,
      idempotencyKey: command?.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-preview-directive", directive.field, directive.value),
      previewLabel: contract?.exportsToKernel
        ? `Export ${directive.field}`
        : contract?.lifecycleControl ? `Apply ${directive.field}` : `Observe ${directive.field}`,
      nextAction: state === "blocked"
        ? command?.nextAction ?? "repair_comment_directive"
        : contract?.exportsToKernel ? "accept_comment_export_preview" : command?.nextAction ?? "accept_comment_directive_preview",
    });
  });
  const lifecycleRows = (lifecycleReadiness.rows ?? []).map((row) => Object.freeze({
    schema: "aios.comment.client-preview-acceptance-row.v1",
    source: "lifecycle-readiness",
    subject: `${row.field}:${row.value}`,
    state: row.state === "ready" ? "ready" : row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-preview-lifecycle", row.field, row.value),
    previewLabel: `Lifecycle ${row.field}`,
    nextAction: row.nextAction,
  }));
  const handoffRows = [
    ["sync-preview", syncPreview],
    ["provider-acceptance", providerAcceptance],
    ["client-action-queue", clientActionQueue],
    ["workflow-handoff", workflowHandoff],
    ["client-status-adoption", clientStatusAdoption],
    ["recovery-adoption", recoveryAdoption],
    ["operational-report", operationalReport],
    ["client-resume-envelope", clientResumeEnvelope],
    ["analytics-report", analyticsReport],
    ["lifecycle-command-center", lifecycleCommandCenter],
    ["provider-handoff-panel", providerHandoffPanel],
    ["external-handoff", externalHandoffState],
  ].map(([source, item], index) => {
    const handoff = item?.handoff ?? {};
    const state = handoff.ready === false
      ? "blocked"
      : item?.state === "review" || item?.preview?.status === "review" ? "review" : "ready";
    return Object.freeze({
      schema: "aios.comment.client-preview-acceptance-row.v1",
      source,
      subject: item?.revision ?? item?.preview?.previewId ?? handoff.checkpoint ?? runtimeState.checkpoint,
      state,
      checkpoint: handoff.checkpoint ?? runtimeState.checkpoint,
      statusChannel: handoff.statusChannel ?? runtimeState.statusChannel,
      restartSafe: handoff.ready !== false,
      localOnly: handoff.localOnly !== false,
      writesExternalSystem: handoff.writesExternalSystem === true,
      idempotencyKey: stableCommentCommandId("idempotent", "comment-preview-handoff", source, index + 1, handoff.checkpoint),
      previewLabel: source,
      nextAction: handoff.nextAction ?? "accept_comment_preview_handoff",
    });
  });
  const diagnosticRows = diagnostics.map((item) => Object.freeze({
    schema: "aios.comment.client-preview-acceptance-row.v1",
    source: "diagnostic",
    subject: item.code,
    state: item.severity === "error" ? "blocked" : "review",
    checkpoint: runtimeState.checkpoint,
    statusChannel: runtimeState.statusChannel,
    restartSafe: item.severity !== "error",
    localOnly: true,
    writesExternalSystem: false,
    idempotencyKey: stableCommentCommandId("idempotent", "comment-preview-diagnostic", item.code, item.offset ?? 0),
    previewLabel: item.message,
    nextAction: item.recovery ?? "inspect_comment_diagnostic",
  }));
  const rows = Object.freeze([...directiveRows, ...lifecycleRows, ...handoffRows, ...diagnosticRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.idempotencyKey}`.localeCompare(`${right.source}:${right.subject}:${right.idempotencyKey}`))
    .map((row, index) => Object.freeze({
      ...row,
      order: index + 1,
      rowId: stableCommentCommandId("comment-preview-acceptance", index + 1, row.source, row.subject, row.checkpoint),
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "accept_comment_client_preview" : "attach_comment_client_preview");

  return Object.freeze({
    schema: "aios.comment.client-preview-acceptance.v1",
    revision: stableCommentCommandId("comment-preview-acceptance", runtimeState.revision, state, rows.length, blockedRows.length),
    state,
    rows,
    validationSummary: Object.freeze({
      state,
      rows: rows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      diagnostics: diagnosticRows.length,
      directiveRows: directiveRows.length,
      lifecycleRows: lifecycleRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      providerReady: providerContract.handoff?.ready !== false,
      nextAction,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || providerContract.sync?.externalWriteRequested === true,
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    nextSteps: Object.freeze((blockedRows.length > 0 ? blockedRows : reviewRows).map((row, index) => Object.freeze({
      order: index + 1,
      action: row.nextAction,
      subject: row.subject,
      source: row.source,
      restartSafe: row.restartSafe,
    }))),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: externalHandoffState.handoff?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: externalHandoffState.handoff?.statusChannel ?? runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildCommentClientRequestResumeDecision({
  rows,
  blockedRows,
  reviewRows,
  externalRows,
  checkpoints,
  statusChannels,
  capabilityRows,
  clientStateMissingKeys,
  acceptedForRuntime,
  acceptedForExternalWrite,
}) {
  const replayableRows = rows.filter((row) => row.restartSafe && row.idempotencyKey && row.state !== "blocked");
  const blockedSubjects = Object.freeze([
    ...blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`),
    ...clientStateMissingKeys.map((key) => `client-state:${key}`),
  ].sort());
  const reviewSubjects = Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort());
  const resumeMode = blockedSubjects.length > 0
    ? "hold"
    : reviewSubjects.length > 0 ? "review" : externalRows.length > 0 ? "handoff" : "local-replay";
  const nextAction = blockedSubjects.length > 0
    ? blockedRows[0]?.nextAction ?? "hydrate_comment_client_request_state"
    : reviewSubjects.length > 0
      ? reviewRows[0]?.nextAction ?? "review_comment_client_request_resume"
      : externalRows.length > 0 ? "handoff_comment_client_request_resume" : "resume_comment_client_request";

  return Object.freeze({
    schema: "aios.comment.client-request-resume-decision.v1",
    resumeMode,
    replayable: acceptedForRuntime && replayableRows.length === rows.length,
    checkpoint: checkpoints[0] ?? "",
    statusChannel: statusChannels[0] ?? "mailchimp.contract.status",
    capabilities: capabilityRows,
    rows: Object.freeze(rows.map((row, index) => Object.freeze({
      schema: "aios.comment.client-request-resume-row.v1",
      order: index + 1,
      source: row.source,
      subject: row.subject,
      field: row.field ?? "",
      value: row.value ?? "",
      state: row.state,
      replayState: row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey
        ? "held"
        : row.state === "review" ? "review" : "replayable",
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      idempotencyKey: row.idempotencyKey,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey
        ? row.nextAction
        : row.state === "review" ? "review_comment_client_request_resume" : "replay_comment_client_request_row",
    }))),
    counters: Object.freeze({
      rows: rows.length,
      replayable: replayableRows.length,
      held: blockedRows.length + clientStateMissingKeys.length,
      review: reviewRows.length,
      externalWrites: externalRows.length,
      capabilities: capabilityRows.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime,
      acceptedForExternalWrite,
      blockedBy: blockedSubjects,
      review: reviewSubjects,
      nextAction,
    }),
    handoff: Object.freeze({
      ready: acceptedForRuntime,
      checkpoint: checkpoints[0] ?? "",
      statusChannel: statusChannels[0] ?? "mailchimp.contract.status",
      localOnly: !acceptedForExternalWrite,
      writesExternalSystem: acceptedForExternalWrite,
      nextAction,
    }),
  });
}

function buildCommentClientRequestSnapshot({
  directives,
  providerContract,
  runtimeState,
  lifecycleReadiness,
  clientPreviewAcceptance,
  externalHandoffState,
  clientResumeEnvelope,
}) {
  const capabilityRows = Object.freeze(Array.from(new Set([
    ...(providerContract.requestedCapabilities ?? []),
    ...directives.filter((directive) => directive.field === "capability").map((directive) => directive.value),
  ].map((item) => String(item ?? "").trim()).filter(Boolean))).sort());
  const directiveRows = Object.freeze(directives.map((directive, index) => {
    const command = (runtimeState.commands ?? []).find((item) => item.range?.start?.offset === directive.range.start.offset);
    const lifecycleRow = (lifecycleReadiness.rows ?? []).find((row) => row.field === directive.field && row.value === directive.value);
    const blockers = Object.freeze([
      ...(!directive.value ? ["missing_value"] : []),
      ...(command?.state === "blocked" ? ["runtime_command_blocked"] : []),
      ...(command?.restartSafe === false ? ["restart_safety"] : []),
      ...(lifecycleRow?.state === "blocked" ? ["lifecycle_blocked"] : []),
      ...(PROVIDER_FIELDS.has(directive.field) && providerContract.handoff.ready === false ? ["provider_handoff"] : []),
      ...(PROVIDER_FIELDS.has(directive.field) && providerContract.sync.externalWriteRequested && !providerContract.sync.externalWriteAllowed ? ["external_write_confirmation"] : []),
    ].sort());
    const state = blockers.length > 0
      ? "blocked"
      : command?.state === "skipped" ? "suppressed" : providerContract.sync.externalWriteRequested && PROVIDER_FIELDS.has(directive.field) ? "review" : "ready";
    return Object.freeze({
      schema: "aios.comment.client-request-directive-row.v1",
      order: index + 1,
      source: "comment-directive",
      subject: `${directive.field}:${directive.value}`,
      field: directive.field,
      value: directive.value,
      state,
      checkpoint: command?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: command?.statusChannel ?? runtimeState.statusChannel,
      restartSafe: blockers.length === 0 && command?.restartSafe !== false,
      localOnly: command?.localOnly ?? providerContract.sync.localOnly,
      writesExternalSystem: command?.writesExternalSystem === true && providerContract.sync.externalWriteAllowed === true,
      idempotencyKey: command?.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-request", directive.field, directive.value),
      blockers,
      nextAction: blockers.includes("external_write_confirmation")
        ? "confirm_comment_request_external_write"
        : blockers.includes("missing_value")
          ? "add_comment_directive_value"
          : blockers.length > 0 ? command?.nextAction ?? lifecycleRow?.nextAction ?? providerContract.handoff.nextAction : command?.nextAction ?? "adopt_comment_client_request",
    });
  }));
  const previewRows = Object.freeze((clientPreviewAcceptance.rows ?? []).filter((row) => row.state === "blocked" || row.state === "review").map((row, index) => Object.freeze({
    schema: "aios.comment.client-request-preview-row.v1",
    order: directiveRows.length + index + 1,
    source: `preview:${row.source}`,
    subject: row.subject,
    state: row.state,
    checkpoint: row.checkpoint ?? clientPreviewAcceptance.handoff?.checkpoint ?? runtimeState.checkpoint,
    statusChannel: row.statusChannel ?? clientPreviewAcceptance.handoff?.statusChannel ?? runtimeState.statusChannel,
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey ?? stableCommentCommandId("idempotent", "comment-request-preview", row.source, row.subject),
    blockers: Object.freeze(row.state === "blocked" ? ["preview_blocked"] : []),
    nextAction: row.nextAction,
  })));
  const rows = Object.freeze([...directiveRows, ...previewRows]
    .sort((left, right) => `${left.source}:${left.subject}:${left.idempotencyKey}`.localeCompare(`${right.source}:${right.subject}:${right.idempotencyKey}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const checkpoints = Object.freeze(Array.from(new Set([
    runtimeState.checkpoint,
    providerContract.sync?.checkpoint,
    externalHandoffState.handoff?.checkpoint,
    clientResumeEnvelope.handoff?.checkpoint,
    ...rows.map((row) => row.checkpoint),
  ].filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    runtimeState.statusChannel,
    providerContract.statusChannel,
    externalHandoffState.handoff?.statusChannel,
    clientResumeEnvelope.handoff?.statusChannel,
    ...rows.map((row) => row.statusChannel),
  ].filter(Boolean))).sort());
  const acceptedForRuntime = blockedRows.length === 0
    && runtimeState.persistedView?.restartSafe === true
    && providerContract.handoff.ready === true
    && clientPreviewAcceptance.handoff?.ready !== false
    && externalHandoffState.handoff?.ready !== false;
  const acceptedForExternalWrite = acceptedForRuntime && externalRows.length > 0;
  const requiredClientKeys = Object.freeze(["requestId", "service", "adapter", "checkpoint", "statusChannel"].sort());
  const clientStateMissingKeys = Object.freeze([
    ...(!providerContract.service ? ["service"] : []),
    ...(!providerContract.adapter ? ["adapter"] : []),
    ...(!checkpoints[0] ? ["checkpoint"] : []),
    ...(!statusChannels[0] ? ["statusChannel"] : []),
  ].sort());
  const requestResumeDecision = buildCommentClientRequestResumeDecision({
    rows,
    blockedRows,
    reviewRows,
    externalRows,
    checkpoints,
    statusChannels,
    capabilityRows,
    clientStateMissingKeys,
    acceptedForRuntime,
    acceptedForExternalWrite,
  });
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "adopt_comment_client_request_snapshot" : "attach_comment_client_request_snapshot");

  return Object.freeze({
    schema: "aios.comment.client-request-snapshot.v1",
    requestId: stableCommentCommandId("comment-request", runtimeState.checkpoint, rows.length, blockedRows.length, reviewRows.length),
    state: blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty",
    service: providerContract.service,
    adapter: providerContract.adapter,
    capabilities: capabilityRows,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      directives: directiveRows.length,
      previewRows: previewRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      resumeReplayable: requestResumeDecision.counters.replayable,
      resumeHeld: requestResumeDecision.counters.held,
    }),
    requestResumeDecision,
    clientState: Object.freeze({
      requiredKeys: requiredClientKeys,
      missingKeys: clientStateMissingKeys,
      checkpoint: checkpoints[0] ?? "",
      statusChannel: statusChannels[0] ?? "mailchimp.contract.status",
    }),
    acceptance: Object.freeze({
      acceptedForRuntime,
      acceptedForExternalWrite,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: acceptedForRuntime,
      checkpoint: checkpoints[0] ?? "",
      statusChannel: statusChannels[0] ?? "mailchimp.contract.status",
      localOnly: !acceptedForExternalWrite,
      writesExternalSystem: acceptedForExternalWrite,
      userVisibleState: blockedRows.length > 0 ? "needs-attention" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "queued" : "idle",
      nextAction,
    }),
  });
}

function providerFreshnessSeconds(mode, externalWriteRequested) {
  const normalized = stableStatePart(mode || "local");
  if (normalized === "push" || normalized === "provider") return 60;
  if (normalized === "deferred") return 900;
  if (normalized === "pull") return 300;
  return externalWriteRequested ? 300 : 0;
}

function commentProviderSlaTargetSeconds(row) {
  if (row.state === "blocked" || row.restartSafe === false) return 0;
  if (row.writesExternalSystem) return 120;
  if (row.freshnessSeconds > 0) return Math.max(300, row.freshnessSeconds);
  return 0;
}

function buildCommentProviderHandoffSla(rows, providerContract, runtimeState) {
  const slaRows = Object.freeze(rows.map((row, index) => {
    const targetSeconds = commentProviderSlaTargetSeconds(row);
    const stale = targetSeconds > 0 && row.freshnessSeconds > targetSeconds;
    const blocked = row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey;
    const state = blocked ? "blocked" : stale ? "stale" : targetSeconds > 0 ? "within-sla" : "local";
    return Object.freeze({
      schema: "aios.comment.provider-handoff-sla-row.v1",
      order: index + 1,
      source: row.source,
      subject: row.subject,
      state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      freshnessSeconds: row.freshnessSeconds,
      targetSeconds,
      breach: blocked || stale,
      restartSafe: row.restartSafe === true && !blocked,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: stableCommentCommandId("idempotent", "comment-provider-sla", row.source, row.subject, row.checkpoint),
      nextAction: blocked
        ? row.nextAction
        : stale
          ? "refresh_comment_provider_handoff_sla"
          : targetSeconds > 0 ? "monitor_comment_provider_handoff_sla" : "retain_local_comment_provider_handoff_sla",
    });
  }));
  const blockedRows = slaRows.filter((row) => row.state === "blocked");
  const staleRows = slaRows.filter((row) => row.state === "stale");
  const externalRows = slaRows.filter((row) => row.writesExternalSystem);
  const nextAction = blockedRows[0]?.nextAction
    ?? staleRows[0]?.nextAction
    ?? (slaRows.length > 0 ? "monitor_comment_provider_handoff_sla" : "attach_comment_provider_handoff_sla");

  return Object.freeze({
    schema: "aios.comment.provider-handoff-sla.v1",
    revision: stableCommentCommandId("comment-provider-sla", providerContract.service, providerContract.adapter, rows.length, blockedRows.length, staleRows.length),
    state: blockedRows.length > 0 ? "blocked" : staleRows.length > 0 ? "stale" : externalRows.length > 0 ? "within-sla" : "local",
    rows: slaRows,
    counters: Object.freeze({
      rows: slaRows.length,
      blocked: blockedRows.length,
      stale: staleRows.length,
      withinSla: slaRows.filter((row) => row.state === "within-sla").length,
      local: slaRows.filter((row) => row.state === "local").length,
      externalWrites: externalRows.length,
      maxFreshnessSeconds: Math.max(0, ...slaRows.map((row) => row.freshnessSeconds)),
      maxTargetSeconds: Math.max(0, ...slaRows.map((row) => row.targetSeconds)),
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && staleRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(staleRows.map((row) => `${row.source}:${row.subject}:stale`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0 && staleRows.length === 0,
      checkpoint: slaRows.find((row) => row.checkpoint)?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: slaRows.find((row) => row.statusChannel)?.statusChannel ?? runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildCommentProviderFreshnessContract(providerContract, runtimeState, clientRequestSnapshot, externalHandoffState) {
  const freshnessSeconds = providerFreshnessSeconds(providerContract.sync?.mode, providerContract.sync?.externalWriteRequested === true);
  const rows = Object.freeze([
    Object.freeze({
      schema: "aios.comment.provider-freshness-row.v1",
      source: "provider-contract",
      subject: providerContract.service || "mailchimp",
      state: providerContract.handoff?.ready === false ? "blocked" : freshnessSeconds > 0 ? "fresh" : "local",
      checkpoint: providerContract.sync?.checkpoint || runtimeState.checkpoint,
      statusChannel: providerContract.statusChannel || runtimeState.statusChannel,
      freshnessSeconds,
      restartSafe: providerContract.handoff?.ready !== false,
      localOnly: providerContract.sync?.localOnly !== false,
      writesExternalSystem: providerContract.sync?.externalWriteAllowed === true,
      idempotencyKey: stableCommentCommandId("idempotent", "comment-provider-freshness", providerContract.service, providerContract.sync?.checkpoint),
      nextAction: providerContract.handoff?.ready === false ? providerContract.handoff.nextAction : freshnessSeconds > 0 ? "publish_comment_provider_freshness" : "retain_local_comment_provider_freshness",
    }),
    Object.freeze({
      schema: "aios.comment.provider-freshness-row.v1",
      source: "client-request",
      subject: clientRequestSnapshot.requestId,
      state: clientRequestSnapshot.handoff?.ready === false ? "blocked" : clientRequestSnapshot.state,
      checkpoint: clientRequestSnapshot.handoff?.checkpoint || runtimeState.checkpoint,
      statusChannel: clientRequestSnapshot.handoff?.statusChannel || runtimeState.statusChannel,
      freshnessSeconds,
      restartSafe: clientRequestSnapshot.handoff?.ready !== false,
      localOnly: clientRequestSnapshot.handoff?.localOnly !== false,
      writesExternalSystem: clientRequestSnapshot.handoff?.writesExternalSystem === true,
      idempotencyKey: stableCommentCommandId("idempotent", "comment-client-freshness", clientRequestSnapshot.requestId),
      nextAction: clientRequestSnapshot.handoff?.nextAction ?? "adopt_comment_client_request_snapshot",
    }),
    Object.freeze({
      schema: "aios.comment.provider-freshness-row.v1",
      source: "external-handoff",
      subject: externalHandoffState.revision,
      state: externalHandoffState.handoff?.ready === false ? "blocked" : externalHandoffState.state,
      checkpoint: externalHandoffState.handoff?.checkpoint || runtimeState.checkpoint,
      statusChannel: externalHandoffState.handoff?.statusChannel || runtimeState.statusChannel,
      freshnessSeconds,
      restartSafe: externalHandoffState.handoff?.ready !== false,
      localOnly: externalHandoffState.handoff?.localOnly !== false,
      writesExternalSystem: externalHandoffState.handoff?.writesExternalSystem === true,
      idempotencyKey: stableCommentCommandId("idempotent", "comment-external-freshness", externalHandoffState.revision),
      nextAction: externalHandoffState.handoff?.nextAction ?? "publish_comment_external_handoff",
    }),
  ]);
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : externalRows.length > 0 ? "fresh" : "local";
  const nextAction = blockedRows[0]?.nextAction ?? reviewRows[0]?.nextAction ?? (externalRows.length > 0 ? "publish_comment_provider_freshness" : "retain_local_comment_provider_freshness");
  const sla = buildCommentProviderHandoffSla(rows, providerContract, runtimeState);

  return Object.freeze({
    schema: "aios.comment.provider-freshness.v1",
    revision: stableCommentCommandId("comment-provider-freshness", providerContract.service, providerContract.adapter, state, rows.length, blockedRows.length),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      externalWrites: externalRows.length,
      freshnessSeconds,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0 && sla.handoff.ready === true,
      checkpoint: rows.find((row) => row.checkpoint)?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: rows.find((row) => row.statusChannel)?.statusChannel ?? runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction: blockedRows[0]?.nextAction ?? sla.handoff.nextAction ?? nextAction,
    }),
    sla,
  });
}

function commentReviewPacketRow(source, subject, state, handoff = {}, extras = {}) {
  const checkpoint = String(handoff.checkpoint || extras.checkpoint || "").trim();
  const statusChannel = String(handoff.statusChannel || extras.statusChannel || "mailchimp.contract.status").trim();
  return Object.freeze({
    schema: "aios.comment.mailchimp-review-row.v1",
    source,
    subject: String(subject ?? "").trim(),
    state: String(state || "unknown").trim(),
    checkpoint,
    statusChannel,
    restartSafe: handoff.ready !== false && extras.restartSafe !== false,
    localOnly: handoff.localOnly !== false && extras.localOnly !== false,
    writesExternalSystem: handoff.writesExternalSystem === true || extras.writesExternalSystem === true,
    idempotencyKey: stableCommentCommandId("idempotent", "comment-review", source, subject, checkpoint || statusChannel),
    display: Object.freeze({
      title: String(extras.title || subject || source).trim(),
      detail: String(extras.detail || "").trim(),
      badge: String(extras.badge || state || "unknown").trim(),
    }),
    nextAction: String(extras.nextAction || handoff.nextAction || "review_comment_mailchimp_contract").trim(),
  });
}

function buildCommentMailchimpReviewPacket(context) {
  const {
    contracts,
    directives,
    diagnostics,
    lifecycleReadiness,
    clientPreviewAcceptance,
    clientRequestSnapshot,
    providerFreshness,
    providerHandoffPanel,
    externalHandoffState,
    lifecycleCommandCenter,
    runtimeState,
  } = context;
  const directiveRows = directives.map((directive) => commentReviewPacketRow(
    `comment-directive:${directive.field}`,
    directive.value || directive.raw,
    directive.value ? "ready" : "blocked",
    runtimeState.clientHandoff,
    {
      restartSafe: Boolean(directive.value),
      title: `${directive.field}:${directive.value || "missing"}`,
      detail: directive.value ? "Directive has a deterministic runtime value." : "Directive needs a value before runtime adoption.",
      badge: directive.contractRole,
      nextAction: directive.value ? "adopt_comment_directive" : "add_comment_directive_value",
    },
  ));
  const previewRows = (clientPreviewAcceptance.rows ?? []).map((row) => commentReviewPacketRow(
    `comment-preview:${row.source}`,
    row.subject,
    row.state,
    clientPreviewAcceptance.handoff,
    {
      restartSafe: row.restartSafe,
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      title: row.subject,
      detail: `Client preview acceptance from ${row.source}.`,
      badge: row.state,
      nextAction: row.nextAction,
    },
  ));
  const lifecycleRows = (lifecycleReadiness.rows ?? []).map((row) => commentReviewPacketRow(
    `comment-lifecycle:${row.field}`,
    row.value,
    row.state,
    lifecycleReadiness.handoff,
    {
      restartSafe: row.restartSafe,
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      title: `${row.field}:${row.value}`,
      detail: row.suppressed ? "Lifecycle row is intentionally suppressed." : "Lifecycle row is ready for replay review.",
      badge: row.state,
      nextAction: row.nextAction,
    },
  ));
  const commandRows = (lifecycleCommandCenter.commandRows ?? []).map((row) => commentReviewPacketRow(
    `comment-command:${row.field}`,
    row.value,
    row.state,
    lifecycleCommandCenter.handoff,
    {
      restartSafe: row.restartSafe,
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      title: `${row.field}:${row.value}`,
      detail: "Lifecycle command center row.",
      badge: row.state,
      nextAction: row.nextAction,
    },
  ));
  const providerRows = (providerHandoffPanel.rows ?? []).map((row) => commentReviewPacketRow(
    `comment-provider:${row.source}`,
    row.subject,
    row.state,
    providerHandoffPanel.handoff,
    {
      restartSafe: row.restartSafe,
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      title: row.subject,
      detail: "Provider handoff panel row.",
      badge: row.state,
      nextAction: row.nextAction,
    },
  ));
  const freshnessRows = (providerFreshness.rows ?? []).map((row) => commentReviewPacketRow(
    `comment-freshness:${row.source}`,
    row.subject,
    row.state,
    providerFreshness.handoff,
    {
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe,
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      title: row.subject,
      detail: `Provider freshness window ${row.freshnessSeconds ?? 0}s.`,
      badge: row.state,
      nextAction: row.nextAction,
    },
  ));
  const freshnessSlaRows = (providerFreshness.sla?.rows ?? []).map((row) => commentReviewPacketRow(
    `comment-freshness-sla:${row.source}`,
    row.subject,
    row.state === "within-sla" ? "ready" : row.state,
    providerFreshness.sla.handoff,
    {
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe,
      localOnly: row.localOnly,
      writesExternalSystem: row.writesExternalSystem,
      title: row.subject,
      detail: `Provider handoff SLA target ${row.targetSeconds}s with freshness ${row.freshnessSeconds}s.`,
      badge: row.state,
      nextAction: row.nextAction,
    },
  ));
  const contractRows = contracts
    .filter((contract) => contract.directive)
    .map((contract) => commentReviewPacketRow(
      `comment-contract:${contract.directive.field}`,
      contract.directive.value || contract.directive.raw,
      contract.exportsToKernel ? "ready" : "local",
      runtimeState.clientHandoff,
      {
        restartSafe: contract.directive.value !== "",
        title: `${contract.directive.field}:${contract.directive.value || "missing"}`,
        detail: contract.exportsToKernel ? "Comment contract exports to kernel state." : "Comment contract remains local lifecycle state.",
        badge: contract.directive.contractRole,
        nextAction: contract.exportsToKernel ? "export_comment_contract" : "retain_comment_contract",
      },
    ));
  const requestRow = commentReviewPacketRow(
    "comment-client-request",
    clientRequestSnapshot.requestId,
    clientRequestSnapshot.state,
    clientRequestSnapshot.handoff,
    {
      title: clientRequestSnapshot.requestId,
      detail: `Client request carries ${clientRequestSnapshot.capabilities?.length ?? 0} capability hints.`,
      badge: clientRequestSnapshot.clientState?.hydrated ? "hydrated" : "missing-state",
      nextAction: clientRequestSnapshot.handoff?.nextAction,
    },
  );
  const externalRow = commentReviewPacketRow(
    "comment-external-handoff",
    externalHandoffState.revision,
    externalHandoffState.state,
    externalHandoffState.handoff,
    {
      title: externalHandoffState.revision,
      detail: "External handoff state derived from comment directives.",
      badge: externalHandoffState.handoff?.writesExternalSystem ? "external" : "local",
      nextAction: externalHandoffState.handoff?.nextAction,
    },
  );
  const diagnosticRows = diagnostics
    .filter((item) => item.severity === "error" || item.severity === "warning")
    .map((item) => commentReviewPacketRow(
      "comment-diagnostic",
      item.code,
      item.severity === "error" ? "blocked" : "review",
      runtimeState.clientHandoff,
      {
        restartSafe: item.severity !== "error",
        title: item.code,
        detail: item.message,
        badge: item.severity,
        nextAction: item.recovery,
      },
    ));
  const rows = Object.freeze([
    ...directiveRows,
    ...previewRows,
    ...lifecycleRows,
    ...commandRows,
    ...providerRows,
    ...freshnessRows,
    ...freshnessSlaRows,
    ...contractRows,
    requestRow,
    externalRow,
    ...diagnosticRows,
  ].sort((left, right) => `${left.state}:${left.source}:${left.subject}`.localeCompare(`${right.state}:${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const ready = blockedRows.length === 0
    && clientPreviewAcceptance.handoff?.ready !== false
    && clientRequestSnapshot.handoff?.ready !== false
    && providerFreshness.handoff?.ready !== false
    && providerHandoffPanel.handoff?.ready !== false
    && externalHandoffState.handoff?.ready !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (ready ? "accept_comment_mailchimp_review_packet" : "prepare_comment_mailchimp_review_packet");

  return Object.freeze({
    schema: "aios.comment.mailchimp-review-packet.v1",
    revision: stableCommentCommandId("comment-review-packet", state, rows.length, blockedRows.length, providerFreshness.revision),
    state,
    rows,
    validationSummary: Object.freeze({
      state,
      rows: rows.length,
      directives: directives.length,
      contracts: contractRows.length,
      previewRows: previewRows.length,
      lifecycleRows: lifecycleRows.length,
      commandRows: commandRows.length,
      providerRows: providerRows.length,
      freshnessRows: freshnessRows.length,
      freshnessSlaRows: freshnessSlaRows.length,
      diagnostics: diagnosticRows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      nextAction,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || externalRows.length > 0,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    nextSteps: Object.freeze((blockedRows.length > 0 ? blockedRows : reviewRows).map((row, index) => Object.freeze({
      order: index + 1,
      action: row.nextAction,
      subject: `${row.source}:${row.subject}`,
      reason: row.display.detail,
      restartSafe: row.restartSafe,
    }))),
    handoff: Object.freeze({
      ready,
      checkpoint: rows.find((row) => row.checkpoint)?.checkpoint ?? runtimeState.checkpoint,
      statusChannel: rows.find((row) => row.statusChannel)?.statusChannel ?? runtimeState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

export function extractAiosComments(source) {
  const input = String(source ?? "");
  const state = { offset: 0, line: 1, column: 1 };
  const comments = [];
  const diagnostics = [];

  while (state.offset < input.length) {
    const char = input[state.offset];
    const next = input[state.offset + 1] ?? "";
    if (char === "/" && next === "/") {
      comments.push(readLineComment(input, state));
      continue;
    }
    if (char === "/" && next === "*") {
      comments.push(readBlockComment(input, state, diagnostics));
      continue;
    }
    advancePosition(state, char);
  }

  const directives = comments.map((comment) => parseDirective(comment, diagnostics)).filter(Boolean);
  const contracts = comments.map((comment) => deriveCommentContract(comment, directives));
  const exportable = contracts.filter((contract) => contract.exportsToKernel);
  const lifecycle = buildCommentLifecycleState(directives, diagnostics);
  const providerContract = buildCommentProviderContract(directives, diagnostics);
  const runtimeState = buildCommentRuntimeState(directives, lifecycle, providerContract, diagnostics);
  const lifecycleReadiness = buildCommentLifecycleReadiness(lifecycle, runtimeState, providerContract, diagnostics);
  const analytics = summarizeCommentAnalytics(comments, directives, contracts, diagnostics, lifecycle, providerContract, runtimeState);
  const history = buildCommentHistorySnapshot(contracts, diagnostics, runtimeState);
  const exportSummary = buildCommentExportSummary(contracts, diagnostics, lifecycle, providerContract, runtimeState, history);
  const exportPackage = buildCommentExportPackage(contracts, diagnostics, lifecycle, providerContract, runtimeState, history, exportSummary);
  const adoptionSignature = buildCommentAdoptionSignature(providerContract, runtimeState, lifecycle, exportPackage);
  const deploymentIntent = buildCommentDeploymentIntent(providerContract, runtimeState, lifecycle, exportPackage, adoptionSignature);
  const syncPreview = buildCommentSyncPreview(providerContract, runtimeState, lifecycle, exportPackage, deploymentIntent, adoptionSignature);
  const clientActionQueue = buildCommentClientActionQueue(providerContract, lifecycle, runtimeState, exportPackage, deploymentIntent, syncPreview);
  const providerAcceptance = buildCommentProviderAcceptance(providerContract, runtimeState, lifecycle, syncPreview, clientActionQueue);
  const providerCommitWindow = buildCommentProviderCommitWindow(providerAcceptance, providerContract, runtimeState, syncPreview);
  const workflowHandoff = buildCommentWorkflowHandoff(providerAcceptance, clientActionQueue, deploymentIntent, syncPreview, runtimeState);
  const clientStatusAdoption = buildCommentClientStatusAdoption(providerContract, runtimeState, clientActionQueue, workflowHandoff, syncPreview);
  const recoveryAdoption = buildCommentRecoveryAdoption(providerContract, runtimeState, clientStatusAdoption, diagnostics);
  const operationalReport = buildCommentOperationalReport(
    providerContract,
    runtimeState,
    exportPackage,
    providerAcceptance,
    clientStatusAdoption,
    recoveryAdoption,
    diagnostics,
  );
  const incidentAnalytics = buildCommentIncidentAnalytics(analytics, history, operationalReport, providerContract, runtimeState, diagnostics);
  const clientResumeEnvelope = buildCommentClientResumeEnvelope(
    providerContract,
    runtimeState,
    clientStatusAdoption,
    recoveryAdoption,
    operationalReport,
  );
  const analyticsReport = buildCommentAnalyticsReport({
    comments,
    directives,
    contracts,
    diagnostics,
    analytics,
    history,
    exportSummary,
    exportPackage,
    providerContract,
    lifecycle,
    lifecycleReadiness,
    runtimeState,
    clientResumeEnvelope,
  });
  const lifecycleCommandCenter = buildCommentLifecycleCommandCenter({
    lifecycle,
    lifecycleReadiness,
    providerContract,
    runtimeState,
    deploymentIntent,
    syncPreview,
    providerCommitWindow,
    analyticsReport,
  });
  const providerHandoffPanel = buildCommentProviderHandoffPanel(
    providerContract,
    providerAcceptance,
    providerCommitWindow,
    lifecycleCommandCenter,
    clientResumeEnvelope,
    analyticsReport,
  );
  const controlIntent = buildCommentControlIntent(
    lifecycle,
    lifecycleCommandCenter,
    providerContract,
    providerHandoffPanel,
    runtimeState,
  );
  const externalHandoffState = buildCommentExternalHandoffState(
    providerContract,
    providerHandoffPanel,
    providerCommitWindow,
    lifecycleCommandCenter,
    clientResumeEnvelope,
    analyticsReport,
    controlIntent,
  );
  const clientPreviewAcceptance = buildCommentClientPreviewAcceptance({
    contracts,
    directives,
    diagnostics,
    lifecycleReadiness,
    syncPreview,
    providerAcceptance,
    clientActionQueue,
    workflowHandoff,
    clientStatusAdoption,
    recoveryAdoption,
    operationalReport,
    incidentAnalytics,
    clientResumeEnvelope,
    analyticsReport,
    lifecycleCommandCenter,
    providerHandoffPanel,
    externalHandoffState,
    runtimeState,
    providerContract,
  });
  const clientRequestSnapshot = buildCommentClientRequestSnapshot({
    directives,
    providerContract,
    runtimeState,
    lifecycleReadiness,
    clientPreviewAcceptance,
    externalHandoffState,
    clientResumeEnvelope,
  });
  const providerFreshness = buildCommentProviderFreshnessContract(providerContract, runtimeState, clientRequestSnapshot, externalHandoffState);
  const mailchimpReviewPacket = buildCommentMailchimpReviewPacket({
    contracts,
    directives,
    diagnostics,
    lifecycleReadiness,
    clientPreviewAcceptance,
    clientRequestSnapshot,
    providerFreshness,
    providerHandoffPanel,
    externalHandoffState,
    lifecycleCommandCenter,
    runtimeState,
  });
  const ok = diagnostics.every((item) => item.severity !== "error");

  return Object.freeze({
    schema: "aios.comment.syntax.v1",
    ok,
    comments: Object.freeze(comments),
    directives: Object.freeze(directives),
    contracts: Object.freeze(contracts),
    lifecycle,
    lifecycleReadiness,
    providerContract,
    runtimeState,
    analytics,
    history,
    exportSummary,
    exportPackage,
    adoptionSignature,
    deploymentIntent,
    syncPreview,
    providerAcceptance,
    providerCommitWindow,
    clientActionQueue,
    workflowHandoff,
    clientStatusAdoption,
    recoveryAdoption,
    operationalReport,
    incidentAnalytics,
    clientResumeEnvelope,
    analyticsReport,
    lifecycleCommandCenter,
    providerHandoffPanel,
    controlIntent,
    externalHandoffState,
    clientPreviewAcceptance,
    clientRequestSnapshot,
    providerFreshness,
    mailchimpReviewPacket,
    diagnostics: Object.freeze(diagnostics),
    status: Object.freeze({
      state: ok ? "ready" : "blocked",
      nextAction: ok
        ? runtimeState.clientHandoff.ready
          ? runtimeState.clientHandoff.nextAction
          : providerContract.handoff.ready && providerContract.handoff.nextAction !== "attach_comment_provider"
            ? providerContract.handoff.nextAction
            : lifecycle.nextAction
        : diagnostics[0]?.recovery ?? "inspect_comment",
      exportableContracts: exportable.length,
      lifecycleControls: lifecycle.controls.length,
      lifecycleReadinessReady: lifecycleReadiness.handoff.ready,
      lifecycleReadinessBlocked: lifecycleReadiness.counters.blocked,
      providerDirectives: providerContract.directives.length,
      providerHandoffReady: providerContract.handoff.ready,
      runtimeReplayState: runtimeState.replayState,
      runtimeCommandCount: runtimeState.commandSummary.total,
      exportReady: exportSummary.exportReady,
      exportPackageReady: exportPackage.handoff.ready,
      adoptionReady: adoptionSignature.handoff.ready,
      deploymentReady: deploymentIntent.handoff.ready,
      syncPreviewReady: syncPreview.handoff.ready,
      providerAcceptanceReady: providerAcceptance.handoff.ready,
      providerCommitWindowReady: providerCommitWindow.handoff.ready,
      providerCommitWindowRows: providerCommitWindow.counters.providers,
      clientActionQueueReady: clientActionQueue.handoff.ready,
      clientActionQueueRows: clientActionQueue.counters.rows,
      workflowHandoffReady: workflowHandoff.handoff.ready,
      workflowHandoffRows: workflowHandoff.preview.counters.rows,
      clientStatusAdoptionReady: clientStatusAdoption.handoff.ready,
      clientStatusAdoptionRows: clientStatusAdoption.counters.rows,
      recoveryAdoptionReady: recoveryAdoption.handoff.ready,
      recoveryAdoptionRows: recoveryAdoption.counters.rows,
      operationalReportReady: operationalReport.handoff.ready,
      operationalReportRows: operationalReport.counters.rows,
      incidentAnalyticsReady: incidentAnalytics.handoff.ready,
      incidentAnalyticsRows: incidentAnalytics.counters.rows,
      clientResumeReady: clientResumeEnvelope.handoff.ready,
      clientResumeRows: clientResumeEnvelope.counters.rows,
      analyticsReportReady: analyticsReport.handoff.ready,
      analyticsReportRows: analyticsReport.counters.rows,
      analyticsReportExportReady: analyticsReport.counters.exportReady,
      providerHandoffPanelReady: providerHandoffPanel.handoff.ready,
      providerHandoffPanelRows: providerHandoffPanel.counters.rows,
      controlIntentReady: controlIntent.handoff.ready,
      controlIntentRows: controlIntent.counters.rows,
      externalHandoffReady: externalHandoffState.handoff.ready,
      externalHandoffRows: externalHandoffState.counters.rows,
      clientPreviewAcceptanceReady: clientPreviewAcceptance.handoff.ready,
      clientPreviewAcceptanceRows: clientPreviewAcceptance.validationSummary.rows,
      clientRequestReady: clientRequestSnapshot.handoff.ready,
      clientRequestRows: clientRequestSnapshot.counters.rows,
      providerFreshnessReady: providerFreshness.handoff.ready,
      providerFreshnessRows: providerFreshness.counters.rows,
      mailchimpReviewPacketReady: mailchimpReviewPacket.handoff.ready,
      mailchimpReviewPacketRows: mailchimpReviewPacket.validationSummary.rows,
      historyRevision: history.revision,
      restartSafe: ok && runtimeState.persistedView.restartSafe,
    }),
  });
}

export function buildCommentRuntimeHandoff(source) {
  const extracted = extractAiosComments(source);
  return Object.freeze({
    schema: "aios.comment.runtime-handoff.v1",
    ok: extracted.ok && extracted.runtimeState.clientHandoff.ready,
    status: extracted.status,
    lifecycle: extracted.lifecycle,
    lifecycleReadiness: extracted.lifecycleReadiness,
    providerContract: extracted.providerContract,
    runtimeState: extracted.runtimeState,
    analytics: extracted.analytics,
    history: extracted.history,
    exportSummary: extracted.exportSummary,
    exportPackage: extracted.exportPackage,
    adoptionSignature: extracted.adoptionSignature,
    deploymentIntent: extracted.deploymentIntent,
    syncPreview: extracted.syncPreview,
    providerAcceptance: extracted.providerAcceptance,
    providerCommitWindow: extracted.providerCommitWindow,
    clientActionQueue: extracted.clientActionQueue,
    workflowHandoff: extracted.workflowHandoff,
    clientStatusAdoption: extracted.clientStatusAdoption,
    recoveryAdoption: extracted.recoveryAdoption,
    operationalReport: extracted.operationalReport,
    incidentAnalytics: extracted.incidentAnalytics,
    clientResumeEnvelope: extracted.clientResumeEnvelope,
    analyticsReport: extracted.analyticsReport,
    lifecycleCommandCenter: extracted.lifecycleCommandCenter,
    providerHandoffPanel: extracted.providerHandoffPanel,
    controlIntent: extracted.controlIntent,
    externalHandoffState: extracted.externalHandoffState,
    clientPreviewAcceptance: extracted.clientPreviewAcceptance,
    clientRequestSnapshot: extracted.clientRequestSnapshot,
    providerFreshness: extracted.providerFreshness,
    mailchimpReviewPacket: extracted.mailchimpReviewPacket,
    exports: Object.freeze({
      commands: extracted.runtimeState.commands,
      checkpoint: extracted.runtimeState.checkpoint,
      statusChannel: extracted.runtimeState.statusChannel,
      idempotencyKeys: extracted.runtimeState.persistedView.idempotencyKeys,
      nextAction: extracted.runtimeState.resume.nextAction,
      summary: extracted.exportSummary,
      package: extracted.exportPackage,
      lifecycleReadiness: extracted.lifecycleReadiness,
      syncPreview: extracted.syncPreview,
      providerAcceptance: extracted.providerAcceptance,
      providerCommitWindow: extracted.providerCommitWindow,
      clientActionQueue: extracted.clientActionQueue,
      workflowHandoff: extracted.workflowHandoff,
      clientStatusAdoption: extracted.clientStatusAdoption,
      recoveryAdoption: extracted.recoveryAdoption,
      operationalReport: extracted.operationalReport,
      incidentAnalytics: extracted.incidentAnalytics,
      clientResumeEnvelope: extracted.clientResumeEnvelope,
      analyticsReport: extracted.analyticsReport,
      lifecycleCommandCenter: extracted.lifecycleCommandCenter,
      providerHandoffPanel: extracted.providerHandoffPanel,
      controlIntent: extracted.controlIntent,
      externalHandoffState: extracted.externalHandoffState,
      clientPreviewAcceptance: extracted.clientPreviewAcceptance,
      clientRequestSnapshot: extracted.clientRequestSnapshot,
      providerFreshness: extracted.providerFreshness,
      mailchimpReviewPacket: extracted.mailchimpReviewPacket,
    }),
  });
}

export function buildCommentContractIndex(source) {
  const extracted = extractAiosComments(source);
  const byField = new Map();
  for (const directive of extracted.directives) {
    const entries = byField.get(directive.field) ?? [];
    entries.push(directive);
    byField.set(directive.field, entries);
  }
  return Object.freeze({
    schema: "aios.comment.contract-index.v1",
    ok: extracted.ok,
    byField: Object.freeze(Object.fromEntries([...byField.entries()].map(([field, entries]) => [field, Object.freeze(entries)]).sort())),
    contracts: extracted.contracts,
    lifecycle: extracted.lifecycle,
    lifecycleReadiness: extracted.lifecycleReadiness,
    providerContract: extracted.providerContract,
    runtimeState: extracted.runtimeState,
    analytics: extracted.analytics,
    history: extracted.history,
    exportSummary: extracted.exportSummary,
    exportPackage: extracted.exportPackage,
    adoptionSignature: extracted.adoptionSignature,
    deploymentIntent: extracted.deploymentIntent,
    syncPreview: extracted.syncPreview,
    providerAcceptance: extracted.providerAcceptance,
    providerCommitWindow: extracted.providerCommitWindow,
    clientActionQueue: extracted.clientActionQueue,
    workflowHandoff: extracted.workflowHandoff,
    clientStatusAdoption: extracted.clientStatusAdoption,
    recoveryAdoption: extracted.recoveryAdoption,
    operationalReport: extracted.operationalReport,
    incidentAnalytics: extracted.incidentAnalytics,
    clientResumeEnvelope: extracted.clientResumeEnvelope,
    analyticsReport: extracted.analyticsReport,
    lifecycleCommandCenter: extracted.lifecycleCommandCenter,
    providerHandoffPanel: extracted.providerHandoffPanel,
    controlIntent: extracted.controlIntent,
    externalHandoffState: extracted.externalHandoffState,
    clientPreviewAcceptance: extracted.clientPreviewAcceptance,
    clientRequestSnapshot: extracted.clientRequestSnapshot,
    providerFreshness: extracted.providerFreshness,
    mailchimpReviewPacket: extracted.mailchimpReviewPacket,
    diagnostics: extracted.diagnostics,
    status: extracted.status,
  });
}

export function commentSyntaxSelfCheck() {
  const extracted = extractAiosComments("// @aios provider mailchimp adapter=api capabilities=mailchimp.campaign.write\n// @aios sync deferred\n// @aios capability mailchimp.campaign.write\n// @aios schedule every 15m\njob demo {}");
  return Object.freeze({
    ok: extracted.ok
      && extracted.directives.some((directive) => directive.field === "capability")
      && extracted.lifecycle.schedules[0]?.parsed.valid === true
      && extracted.providerContract.service === "mailchimp"
      && extracted.lifecycleReadiness.handoff.ready === true
      && extracted.lifecycleReadiness.counters.rows >= extracted.lifecycle.controls.length
      && extracted.runtimeState.resume.available === true
      && extracted.runtimeState.statusLedger.handoff.ready === true
      && extracted.runtimeState.statusLedger.counters.rows === extracted.runtimeState.commandSummary.total
      && extracted.runtimeState.commands.some((command) => command.type === "mailchimp.capability.request")
      && extracted.analytics.counters.exportable >= 1
      && extracted.exportSummary.exportReady === true
      && extracted.exportPackage.handoff.ready === true
      && extracted.adoptionSignature.handoff.ready === true
      && extracted.adoptionSignature.fingerprint.includes("comment")
      && extracted.exportPackage.counters.publishable >= 1
      && extracted.deploymentIntent.handoff.ready === true
      && extracted.syncPreview.handoff.ready === true
      && extracted.providerAcceptance.handoff.ready === true
      && extracted.providerCommitWindow.handoff.ready === true
      && extracted.providerCommitWindow.counters.providers >= 1
      && extracted.providerAcceptance.preview.providerRows.length >= 1
      && extracted.clientActionQueue.handoff.ready === true
      && extracted.workflowHandoff.handoff.ready === true
      && extracted.clientStatusAdoption.handoff.ready === true
      && extracted.recoveryAdoption.handoff.ready === true
      && extracted.operationalReport.handoff.ready === true
      && extracted.incidentAnalytics.handoff.ready === true
      && extracted.clientResumeEnvelope.handoff.ready === true
      && extracted.analyticsReport.handoff.ready === true
      && extracted.lifecycleCommandCenter.handoff.ready === true
      && extracted.providerHandoffPanel.handoff.ready === true
      && extracted.controlIntent.handoff.ready === true
      && extracted.controlIntent.counters.rows >= extracted.lifecycle.controls.length
      && extracted.externalHandoffState.handoff.ready === true
      && extracted.clientPreviewAcceptance.handoff.ready === true
      && extracted.clientRequestSnapshot.handoff.ready === true
      && extracted.providerFreshness.handoff.ready === true
      && extracted.providerFreshness.counters.rows === 3
      && extracted.mailchimpReviewPacket.handoff.ready === true
      && extracted.mailchimpReviewPacket.validationSummary.rows >= extracted.providerFreshness.counters.rows
      && extracted.clientRequestSnapshot.capabilities.includes("mailchimp.campaign.write")
      && extracted.clientPreviewAcceptance.validationSummary.rows >= extracted.directives.length
      && extracted.lifecycleCommandCenter.counters.commands >= extracted.lifecycle.controls.length
      && extracted.providerHandoffPanel.counters.rows >= extracted.providerAcceptance.preview.providerRows.length
      && extracted.externalHandoffState.counters.rows >= extracted.providerHandoffPanel.counters.rows
      && extracted.recoveryAdoption.persistedView.resumeFromCheckpoint === true
      && extracted.clientResumeEnvelope.clientState.hydrated === true
      && extracted.operationalReport.counters.rows >= 5
      && extracted.incidentAnalytics.counters.rows >= extracted.operationalReport.counters.rows
      && extracted.analyticsReport.counters.exportReady >= 1
      && extracted.analyticsReport.timeline.length === extracted.analyticsReport.counters.rows
      && extracted.clientResumeEnvelope.counters.rows >= extracted.clientStatusAdoption.counters.rows
      && extracted.clientStatusAdoption.counters.rows >= extracted.clientActionQueue.counters.rows
      && extracted.workflowHandoff.preview.counters.rows >= extracted.clientActionQueue.counters.rows
      && extracted.clientActionQueue.counters.rows >= extracted.runtimeState.commandSummary.total
      && extracted.syncPreview.preview.providerRows.length >= 1
      && extracted.deploymentIntent.controls.some((row) => row.field === "schedule" && row.state === "ready"),
    directives: extracted.directives.length,
    providerNextAction: extracted.providerContract.handoff.nextAction,
    runtimeReplayState: extracted.runtimeState.replayState,
    diagnostics: extracted.diagnostics,
  });
}
