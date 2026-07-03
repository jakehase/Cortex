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

  return Object.freeze({
    schema: "aios.comment.runtime-state.v1",
    revision,
    replayState,
    checkpoint,
    statusChannel,
    commands,
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
      restartSafe: blocked.length === 0 && errors.length === 0,
      blockedCommandIds: Object.freeze(blocked.map((command) => command.id).sort()),
      idempotencyKeys: Object.freeze(commands.map((command) => command.idempotencyKey).filter(Boolean).sort()),
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
  const analytics = summarizeCommentAnalytics(comments, directives, contracts, diagnostics, lifecycle, providerContract, runtimeState);
  const history = buildCommentHistorySnapshot(contracts, diagnostics, runtimeState);
  const exportSummary = buildCommentExportSummary(contracts, diagnostics, lifecycle, providerContract, runtimeState, history);
  const exportPackage = buildCommentExportPackage(contracts, diagnostics, lifecycle, providerContract, runtimeState, history, exportSummary);
  const adoptionSignature = buildCommentAdoptionSignature(providerContract, runtimeState, lifecycle, exportPackage);
  const ok = diagnostics.every((item) => item.severity !== "error");

  return Object.freeze({
    schema: "aios.comment.syntax.v1",
    ok,
    comments: Object.freeze(comments),
    directives: Object.freeze(directives),
    contracts: Object.freeze(contracts),
    lifecycle,
    providerContract,
    runtimeState,
    analytics,
    history,
    exportSummary,
    exportPackage,
    adoptionSignature,
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
      providerDirectives: providerContract.directives.length,
      providerHandoffReady: providerContract.handoff.ready,
      runtimeReplayState: runtimeState.replayState,
      runtimeCommandCount: runtimeState.commandSummary.total,
      exportReady: exportSummary.exportReady,
      exportPackageReady: exportPackage.handoff.ready,
      adoptionReady: adoptionSignature.handoff.ready,
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
    providerContract: extracted.providerContract,
    runtimeState: extracted.runtimeState,
    analytics: extracted.analytics,
    history: extracted.history,
    exportSummary: extracted.exportSummary,
    exportPackage: extracted.exportPackage,
    adoptionSignature: extracted.adoptionSignature,
    exports: Object.freeze({
      commands: extracted.runtimeState.commands,
      checkpoint: extracted.runtimeState.checkpoint,
      statusChannel: extracted.runtimeState.statusChannel,
      idempotencyKeys: extracted.runtimeState.persistedView.idempotencyKeys,
      nextAction: extracted.runtimeState.resume.nextAction,
      summary: extracted.exportSummary,
      package: extracted.exportPackage,
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
    providerContract: extracted.providerContract,
    runtimeState: extracted.runtimeState,
    analytics: extracted.analytics,
    history: extracted.history,
    exportSummary: extracted.exportSummary,
    exportPackage: extracted.exportPackage,
    adoptionSignature: extracted.adoptionSignature,
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
      && extracted.runtimeState.resume.available === true
      && extracted.runtimeState.commands.some((command) => command.type === "mailchimp.capability.request")
      && extracted.analytics.counters.exportable >= 1
      && extracted.exportSummary.exportReady === true
      && extracted.exportPackage.handoff.ready === true
      && extracted.adoptionSignature.handoff.ready === true
      && extracted.adoptionSignature.fingerprint.includes("comment")
      && extracted.exportPackage.counters.publishable >= 1,
    directives: extracted.directives.length,
    providerNextAction: extracted.providerContract.handoff.nextAction,
    runtimeReplayState: extracted.runtimeState.replayState,
    diagnostics: extracted.diagnostics,
  });
}
