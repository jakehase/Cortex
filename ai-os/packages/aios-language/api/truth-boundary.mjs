const TRUST_LEVELS = new Set(["observed", "declared", "inferred", "external", "unknown"]);
const DEFAULT_BOUNDARY = Object.freeze({
  level: "unknown",
  claims: Object.freeze([]),
  assumptions: Object.freeze([]),
  externalReferences: Object.freeze([]),
  localOnly: true,
  truthDebt: 0,
});
const HEALTH_STATUSES = new Set(["healthy", "degraded", "failed", "unknown"]);
const FAILURE_STATES = new Set(["none", "retryable", "terminal", "operator-required"]);
const TIMELINE_KINDS = new Set(["claim", "assumption", "external-reference", "health", "runtime", "audit", "recovery"]);
const LIFECYCLE_COMMANDS = new Set(["start", "pause", "resume", "retry", "rollback", "enable", "disable", "schedule", "cancel", "acknowledge"]);
const LIFECYCLE_MODES = new Set(["enabled", "disabled", "maintenance", "read-only"]);
const SCHEDULE_STRATEGIES = new Set(["immediate", "manual", "interval", "cron", "window"]);
const NEXT_ACTION_TYPES = new Set(["none", "run", "wait", "retry", "rollback", "enable", "disable", "operator-review"]);
const PROVIDER_HANDOFF_STATES = new Set(["local", "prepared", "ready", "syncing", "recovering", "blocked", "failed"]);

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function stableUnique(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function normalizeNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function normalizeTimelineEntry(entry, index = 0) {
  const kind = TIMELINE_KINDS.has(entry?.kind) ? entry.kind : "runtime";
  return {
    id: cleanText(entry?.id) || `timeline-${index + 1}`,
    kind,
    title: cleanText(entry?.title ?? entry?.message ?? entry?.text) || kind,
    status: cleanText(entry?.status) || null,
    at: cleanText(entry?.at ?? entry?.observedAt) || null,
    source: cleanText(entry?.source) || null,
    debtDelta: normalizeNumber(entry?.debtDelta, 0, { min: -Number.MAX_SAFE_INTEGER }),
  };
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const cleaned = value.trim().toLowerCase();
    if (["true", "yes", "on", "enabled"].includes(cleaned)) return true;
    if (["false", "no", "off", "disabled"].includes(cleaned)) return false;
  }
  return fallback;
}

function summarizeTimeline(timeline) {
  const byKind = {};
  const bySource = {};
  let debtDeltaTotal = 0;
  let first = null;
  let latest = null;

  for (const entry of timeline) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    const source = entry.source || "unspecified";
    bySource[source] = (bySource[source] ?? 0) + 1;
    debtDeltaTotal += entry.debtDelta;
    if (!first) first = entry;
    latest = entry;
  }

  return {
    eventCount: timeline.length,
    byKind,
    bySource,
    firstEventId: first?.id ?? null,
    latestEventId: latest?.id ?? null,
    latestStatus: latest?.status ?? null,
    latestTitle: latest?.title ?? null,
    debtDeltaTotal,
    hasExternalHistory: timeline.some((entry) => entry.kind === "external-reference"),
    hasRecoveryHistory: timeline.some((entry) => entry.kind === "recovery"),
  };
}

function buildExportHistorySnapshots(timeline, options = {}) {
  const limit = normalizeNumber(options.historyLimit ?? options.snapshotLimit, 8, { min: 1, max: 50 });
  const selected = timeline.slice(-limit);
  return selected.map((entry, index) => ({
    snapshotId: `${entry.id}:history-${index + 1}`,
    entryId: entry.id,
    kind: entry.kind,
    status: entry.status,
    title: entry.title,
    source: entry.source,
    at: entry.at,
    debtDelta: entry.debtDelta,
  }));
}

function inferSettingType(value) {
  if (Array.isArray(value)) return "array";
  if (value == null) return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "object") return "object";
  return "string";
}

function normalizeSettingValue(value, type) {
  if (type === "boolean") return normalizeBoolean(value, false);
  if (type === "number") return Number.isFinite(Number(value)) ? Number(value) : null;
  if (type === "array") return asArray(value).map(cleanText).filter(Boolean);
  if (type === "object") return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  return cleanText(value);
}

function normalizeLifecycleSetting(setting, index = 0) {
  const key = cleanText(setting?.key ?? setting?.name ?? setting?.id) || `setting-${index + 1}`;
  const type = cleanText(setting?.type) || inferSettingType(setting?.value);
  const value = normalizeSettingValue(setting?.value ?? setting?.defaultValue, type);
  const required = normalizeBoolean(setting?.required, false);
  const enabled = normalizeBoolean(setting?.enabled, true);
  const mutable = normalizeBoolean(setting?.mutable, true);
  const violations = [];

  if (!key || key.startsWith("setting-")) violations.push("missing-key");
  if (required && (value == null || value === "" || (Array.isArray(value) && value.length === 0))) violations.push("required-value-missing");
  if (!enabled && required) violations.push("required-setting-disabled");
  if (type === "number" && value == null) violations.push("invalid-number");
  if (type === "boolean" && typeof value !== "boolean") violations.push("invalid-boolean");

  return {
    key,
    type,
    value,
    required,
    enabled,
    mutable,
    source: cleanText(setting?.source) || "workflow",
    violations,
  };
}

function normalizeLifecycleSchedule(schedule = {}) {
  const strategy = SCHEDULE_STRATEGIES.has(schedule?.strategy) ? schedule.strategy : (
    schedule?.cron ? "cron" : schedule?.intervalMs ? "interval" : schedule?.window ? "window" : "manual"
  );
  const intervalMs = normalizeNumber(schedule?.intervalMs, 0, { min: 0 });
  const cron = cleanText(schedule?.cron);
  const window = cleanText(schedule?.window);
  const nextRunAt = cleanText(schedule?.nextRunAt ?? schedule?.at);
  const violations = [];

  if (strategy === "interval" && intervalMs <= 0) violations.push("interval-ms-required");
  if (strategy === "cron" && !cron) violations.push("cron-required");
  if (strategy === "window" && !window) violations.push("window-required");
  if (strategy === "immediate" && nextRunAt) violations.push("immediate-schedule-ignores-next-run");

  return {
    strategy,
    intervalMs,
    cron: cron || null,
    window: window || null,
    nextRunAt: nextRunAt || null,
    timezone: cleanText(schedule?.timezone) || "UTC",
    paused: normalizeBoolean(schedule?.paused, false),
    violations,
  };
}

function normalizeLifecycleCommand(command, index = 0) {
  const name = LIFECYCLE_COMMANDS.has(command?.name) ? command.name : (
    LIFECYCLE_COMMANDS.has(command) ? command : "acknowledge"
  );
  return {
    name,
    requested: normalizeBoolean(command?.requested, true),
    reason: cleanText(command?.reason) || null,
    requestedBy: cleanText(command?.requestedBy ?? command?.actor) || null,
    sequence: normalizeNumber(command?.sequence, index + 1, { min: 1 }),
  };
}

function normalizeLifecycleRecovery(recovery = {}) {
  return {
    rollbackPoint: cleanText(recovery?.rollbackPoint ?? recovery?.checkpoint) || null,
    rollbackAvailable: normalizeBoolean(recovery?.rollbackAvailable, Boolean(recovery?.rollbackPoint ?? recovery?.checkpoint)),
    retryLimit: normalizeNumber(recovery?.retryLimit ?? recovery?.maxAttempts, 0, { min: 0 }),
    retryAttempt: normalizeNumber(recovery?.retryAttempt ?? recovery?.attempt, 0, { min: 0 }),
    lastError: cleanText(recovery?.lastError ?? recovery?.error) || null,
    status: FAILURE_STATES.has(recovery?.status) ? recovery.status : "none",
  };
}

function normalizeProviderScopeSet(value) {
  return stableUnique(asArray(value).flatMap((item) => String(item ?? "").split(",")));
}

function normalizeProviderSyncMetadata(input = {}) {
  const cursor = cleanText(input?.cursor ?? input?.checkpoint ?? input?.pageToken);
  const lastSync = cleanText(input?.lastSync ?? input?.lastSyncedAt ?? input?.observedAt);
  const audience = cleanText(input?.audience ?? input?.list ?? input?.segment);
  const statusField = cleanText(input?.statusField) || "status";
  const required = stableUnique([
    ...asArray(input?.required),
    ...(input?.requiresCursor === false ? [] : ["cursor"]),
    ...(input?.requiresLastSync === false ? [] : ["lastSync"]),
  ]);
  const present = new Set([
    cursor ? "cursor" : null,
    lastSync ? "lastSync" : null,
    audience ? "audience" : null,
  ].filter(Boolean));

  return {
    cursor: cursor || null,
    lastSync: lastSync || null,
    audience: audience || null,
    statusField,
    required,
    missing: required.filter((field) => !present.has(field)),
    restartToken: [audience || "audience", cursor || "cursor", lastSync || "lastSync"].join(":"),
  };
}

function deriveProviderHandoffState({ enabled, missingSettings, missingScopes, syncMetadata, health }) {
  if (!enabled) return "blocked";
  if (health.status === "failed" || health.failureState === "terminal") return "failed";
  if (missingSettings.length > 0 || missingScopes.length > 0 || syncMetadata.missing.length > 0) return "blocked";
  if (health.status === "degraded" || health.failureState === "retryable") return "recovering";
  if (syncMetadata.cursor && syncMetadata.lastSync) return "ready";
  return "prepared";
}

export function normalizeProviderServiceContract(input = {}) {
  const provider = cleanText(input?.provider) || "unknown-provider";
  const service = cleanText(input?.service) || "unknown-service";
  const expectedService = cleanText(input?.expectedService) || service;
  const requiredScopes = normalizeProviderScopeSet(input?.requiredScopes ?? input?.scopesRequired ?? input?.scope);
  const acceptedScopes = normalizeProviderScopeSet(input?.acceptedScopes ?? input?.grantedScopes ?? input?.acceptedScope);
  const acceptedSet = new Set(acceptedScopes.map((scope) => scope.toLowerCase()));
  const missingScopes = requiredScopes.filter((scope) => !acceptedSet.has(scope.toLowerCase()));
  const coveredRequiredScopes = requiredScopes.filter((scope) => acceptedSet.has(scope.toLowerCase()));
  const settings = asArray(input?.settings ?? input?.setting).map(normalizeLifecycleSetting);
  const missingSettings = settings
    .filter((setting) => setting.required && (setting.value == null || setting.value === "" || (Array.isArray(setting.value) && setting.value.length === 0)))
    .map((setting) => setting.key);
  const syncMetadata = normalizeProviderSyncMetadata(input?.syncMetadata ?? input?.sync ?? input);
  const health = normalizeOperationalHealth(input?.health ?? input?.operationalHealth ?? {});
  const enabled = normalizeBoolean(input?.enabled, true);
  const handoffState = PROVIDER_HANDOFF_STATES.has(input?.handoffState)
    ? input.handoffState
    : deriveProviderHandoffState({ enabled, missingSettings, missingScopes, syncMetadata, health });
  const serviceMatched = service === expectedService;
  const restartSafe = handoffState === "ready" && syncMetadata.missing.length === 0 && health.failureState !== "terminal";
  const command = restartSafe
    ? "resume-external-sync"
    : handoffState === "recovering"
      ? "retry-provider-sync"
      : missingScopes.length > 0
        ? "negotiate-provider-scopes"
        : syncMetadata.missing.length > 0
          ? "collect-sync-metadata"
          : "prepare-provider-handoff";

  return {
    kind: "aios.truth-boundary.provider-service-contract.v1",
    provider,
    service,
    expectedService,
    enabled,
    requiredScopes,
    acceptedScopes,
    missingScopes,
    missingSettings,
    syncMetadata,
    health,
    negotiation: {
      ready: enabled && serviceMatched && missingScopes.length === 0 && missingSettings.length === 0 && syncMetadata.missing.length === 0,
      serviceMatched,
      capabilityCoverage: requiredScopes.length === 0 ? 1 : coveredRequiredScopes.length / requiredScopes.length,
    },
    externalHandoff: {
      state: handoffState,
      restartSafe,
      statusField: syncMetadata.statusField,
      statusValue: cleanText(input?.statusValue) || handoffState,
      canResume: restartSafe,
      command,
      idempotencyKey: [provider, service, syncMetadata.restartToken, command].join(":"),
    },
  };
}

export function createProviderContractHandoff(input = {}, options = {}) {
  const contract = normalizeProviderServiceContract(input);
  const boundary = normalizeTruthBoundary(options.boundary ?? input.boundary ?? {
    claims: [
      {
        id: `${contract.provider}-${contract.service}-service`,
        text: `${contract.provider} ${contract.service} provider contract`,
        level: contract.negotiation.ready ? "observed" : "declared",
        source: contract.provider,
        verified: contract.negotiation.ready,
      },
    ],
    externalReferences: [contract.provider],
  });
  const truthHandoff = createTruthBoundaryHandoff(boundary, {
    id: options.id,
    reviewer: options.reviewer,
    acceptedStatus: contract.externalHandoff.statusValue,
    blockedStatus: "provider-contract-review",
  });

  return {
    kind: "aios.truth-boundary.provider-handoff.v1",
    provider: contract.provider,
    service: contract.service,
    ready: contract.negotiation.ready && truthHandoff.exportReady,
    command: contract.externalHandoff.command,
    idempotencyKey: contract.externalHandoff.idempotencyKey,
    missing: {
      settings: contract.missingSettings,
      scopes: contract.missingScopes,
      syncMetadata: contract.syncMetadata.missing,
      review: truthHandoff.requiredReview.map((item) => item.reason),
    },
    externalHandoff: contract.externalHandoff,
    truth: truthHandoff,
  };
}

function deriveLifecycleNextAction({ enabled, mode, schedule, recovery, settings, commands }) {
  const hasSettingViolation = settings.some((setting) => setting.violations.length > 0);
  const hasScheduleViolation = schedule.violations.length > 0;
  const requested = new Set(commands.filter((command) => command.requested).map((command) => command.name));

  if (hasSettingViolation || hasScheduleViolation) {
    return { type: "operator-review", command: "acknowledge", reason: "validation-blocked" };
  }
  if (!enabled || mode === "disabled") {
    return requested.has("enable")
      ? { type: "enable", command: "enable", reason: "enable-requested" }
      : { type: "none", command: null, reason: "workflow-disabled" };
  }
  if (requested.has("disable")) return { type: "disable", command: "disable", reason: "disable-requested" };
  if (requested.has("rollback") && recovery.rollbackAvailable) return { type: "rollback", command: "rollback", reason: "rollback-available" };
  if (requested.has("retry") && recovery.retryAttempt < recovery.retryLimit) return { type: "retry", command: "retry", reason: "retry-budget-available" };
  if (schedule.paused || mode === "maintenance" || mode === "read-only") return { type: "wait", command: "resume", reason: "workflow-paused" };
  if (schedule.strategy === "manual" && !requested.has("start") && !requested.has("resume")) return { type: "wait", command: "start", reason: "manual-start-required" };
  return { type: "run", command: requested.has("resume") ? "resume" : "start", reason: schedule.strategy };
}

function normalizeClaim(claim, index = 0) {
  if (typeof claim === "string") {
    return {
      id: `claim-${index + 1}`,
      text: cleanText(claim),
      level: "declared",
      source: "source",
      verified: false,
    };
  }

  const text = cleanText(claim?.text ?? claim?.claim ?? claim?.description);
  const level = TRUST_LEVELS.has(claim?.level) ? claim.level : "unknown";
  return {
    id: cleanText(claim?.id) || `claim-${index + 1}`,
    text,
    level,
    source: cleanText(claim?.source) || (level === "external" ? "adapter" : "source"),
    verified: Boolean(claim?.verified),
  };
}

function claimDebt(claim) {
  if (!claim.text) return 2;
  if (claim.verified || claim.level === "observed") return 0;
  if (claim.level === "declared") return 1;
  if (claim.level === "inferred") return 2;
  if (claim.level === "external") return 3;
  return 2;
}

export function normalizeTruthBoundary(input = {}) {
  if (input == null || input === false) return { ...DEFAULT_BOUNDARY, claims: [], assumptions: [], externalReferences: [] };

  const rawClaims = asArray(input.claims ?? input.claim ?? input.truthClaims);
  const claims = rawClaims.map(normalizeClaim).filter((claim) => claim.text);
  const assumptions = stableUnique([
    ...asArray(input.assumptions),
    ...asArray(input.assumption),
  ]);
  const externalReferences = stableUnique([
    ...asArray(input.externalReferences),
    ...asArray(input.externalReference),
    ...claims.filter((claim) => claim.level === "external").map((claim) => claim.source),
  ]);

  const hasExternal = externalReferences.length > 0 || claims.some((claim) => claim.level === "external");
  const explicitLevel = TRUST_LEVELS.has(input.level) ? input.level : null;
  const level = explicitLevel ?? (
    claims.some((claim) => claim.level === "observed" && claim.verified) ? "observed"
      : hasExternal ? "external"
        : claims.some((claim) => claim.level === "inferred") ? "inferred"
          : claims.length ? "declared"
            : "unknown"
  );

  const baseDebt = claims.reduce((total, claim) => total + claimDebt(claim), 0);
  const assumptionDebt = assumptions.length;
  const referenceDebt = hasExternal ? externalReferences.length : 0;
  const truthDebt = Number.isFinite(input.truthDebt)
    ? Math.max(0, Math.trunc(input.truthDebt))
    : baseDebt + assumptionDebt + referenceDebt;

  return {
    level,
    claims,
    assumptions,
    externalReferences,
    localOnly: input.localOnly === false ? false : !hasExternal,
    truthDebt,
  };
}

export function buildTruthBoundaryAnalytics(boundary, options = {}) {
  const normalized = normalizeTruthBoundary(boundary);
  const claimsByLevel = Object.fromEntries([...TRUST_LEVELS].map((level) => [level, 0]));
  const claimsBySource = {};
  let verifiedClaimCount = 0;

  for (const claim of normalized.claims) {
    claimsByLevel[claim.level] = (claimsByLevel[claim.level] ?? 0) + 1;
    claimsBySource[claim.source] = (claimsBySource[claim.source] ?? 0) + 1;
    if (claim.verified || claim.level === "observed") verifiedClaimCount += 1;
  }

  const history = asArray(options.history ?? boundary?.history).map(normalizeTimelineEntry);
  const syntheticHistory = [
    ...normalized.claims.map((claim, index) => normalizeTimelineEntry({
      id: `claim-history-${index + 1}`,
      kind: "claim",
      title: claim.text,
      status: claim.verified || claim.level === "observed" ? "verified" : "unverified",
      source: claim.source,
      debtDelta: claimDebt(claim),
    }, index)),
    ...normalized.assumptions.map((assumption, index) => normalizeTimelineEntry({
      id: `assumption-history-${index + 1}`,
      kind: "assumption",
      title: assumption,
      status: "open",
      debtDelta: 1,
    }, index)),
    ...normalized.externalReferences.map((reference, index) => normalizeTimelineEntry({
      id: `external-history-${index + 1}`,
      kind: "external-reference",
      title: reference,
      status: "requires-review",
      source: reference,
      debtDelta: 1,
    }, index)),
  ];
  const timeline = [...history, ...syntheticHistory];
  const statusCounts = {};
  for (const entry of timeline) {
    const status = entry.status || "unspecified";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  const timelineSummary = summarizeTimeline(timeline);

  return {
    counters: {
      claimCount: normalized.claims.length,
      verifiedClaimCount,
      unverifiedClaimCount: normalized.claims.length - verifiedClaimCount,
      assumptionCount: normalized.assumptions.length,
      externalReferenceCount: normalized.externalReferences.length,
      truthDebt: normalized.truthDebt,
      localOnlyBoundaryCount: normalized.localOnly ? 1 : 0,
      externalBoundaryCount: normalized.localOnly ? 0 : 1,
    },
    claimsByLevel,
    claimsBySource,
    timeline,
    timelineSummary,
    historySnapshots: buildExportHistorySnapshots(timeline, options),
    statusCounts,
  };
}

export function snapshotTruthBoundary(boundary, options = {}) {
  const normalized = normalizeTruthBoundary(boundary);
  const analytics = buildTruthBoundaryAnalytics(normalized, options);
  return {
    id: cleanText(options.id) || `truth-snapshot:${normalized.level}:${normalized.truthDebt}:${analytics.counters.claimCount}`,
    label: cleanText(options.label) || "truth-boundary",
    createdAt: cleanText(options.createdAt) || null,
    summary: summarizeTruthBoundary(normalized),
    counters: analytics.counters,
    timelineLength: analytics.timeline.length,
    timelineSummary: analytics.timelineSummary,
    latestHistory: analytics.historySnapshots.at(-1) ?? null,
  };
}

export function exportTruthBoundaryReport(boundary, options = {}) {
  const normalized = normalizeTruthBoundary(boundary);
  const summary = summarizeTruthBoundary(normalized);
  const analytics = buildTruthBoundaryAnalytics(normalized, options);
  const snapshot = snapshotTruthBoundary(normalized, options);
  const lifecycleInput = options.lifecycle ?? boundary?.lifecycle ?? null;
  const lifecycle = lifecycleInput ? normalizeLifecycleControls(lifecycleInput) : null;

  return {
    format: cleanText(options.format) || "aios.truth-boundary.report.v1",
    snapshot,
    summary,
    counters: analytics.counters,
    claimsByLevel: analytics.claimsByLevel,
    claimsBySource: analytics.claimsBySource,
    timeline: analytics.timeline,
    timelineSummary: analytics.timelineSummary,
    historySnapshots: analytics.historySnapshots,
    exportReady: summary.status === "grounded" || (normalized.localOnly && analytics.counters.externalReferenceCount === 0),
    reviewRequired: summary.truthDebt > 0 || analytics.counters.externalReferenceCount > 0,
    lifecycle,
  };
}

export function mergeTruthBoundaries(...boundaries) {
  const normalized = boundaries.filter(Boolean).map(normalizeTruthBoundary);
  const claims = [];
  for (const boundary of normalized) claims.push(...boundary.claims);

  const assumptions = stableUnique(normalized.flatMap((boundary) => boundary.assumptions));
  const externalReferences = stableUnique(normalized.flatMap((boundary) => boundary.externalReferences));
  const hasExternal = externalReferences.length > 0 || normalized.some((boundary) => boundary.localOnly === false);
  const debt = normalized.reduce((total, boundary) => total + boundary.truthDebt, 0);

  return normalizeTruthBoundary({
    claims,
    assumptions,
    externalReferences,
    localOnly: !hasExternal,
    truthDebt: debt,
  });
}

export function classifyTruthClaim(text, options = {}) {
  const cleaned = cleanText(text);
  const level = TRUST_LEVELS.has(options.level) ? options.level : (
    options.observed ? "observed" : options.external ? "external" : options.inferred ? "inferred" : "declared"
  );

  return normalizeClaim({
    id: options.id,
    text: cleaned,
    level,
    source: options.source,
    verified: options.verified,
  });
}

export function summarizeTruthBoundary(boundary) {
  const normalized = normalizeTruthBoundary(boundary);
  const unverified = normalized.claims.filter((claim) => !claim.verified && claim.level !== "observed");
  const analytics = buildTruthBoundaryAnalytics(normalized);

  return {
    level: normalized.level,
    localOnly: normalized.localOnly,
    claimCount: normalized.claims.length,
    unverifiedClaimCount: unverified.length,
    assumptionCount: normalized.assumptions.length,
    externalReferenceCount: normalized.externalReferences.length,
    truthDebt: normalized.truthDebt,
    status: normalized.truthDebt === 0 ? "grounded" : normalized.localOnly ? "review" : "external-review",
    timelineEventCount: analytics.timeline.length,
    latestTimelineStatus: analytics.timelineSummary.latestStatus,
    debtDeltaTotal: analytics.timelineSummary.debtDeltaTotal,
  };
}

export function createTruthBoundaryHandoff(boundary, options = {}) {
  const normalized = normalizeTruthBoundary(boundary);
  const summary = summarizeTruthBoundary(normalized);
  const report = exportTruthBoundaryReport(normalized, options);
  const requiredReview = [];
  const evidence = [];

  for (const claim of normalized.claims) {
    const verified = claim.verified || claim.level === "observed";
    evidence.push({
      id: claim.id,
      type: "claim",
      level: claim.level,
      source: claim.source,
      verified,
      text: claim.text,
    });
    if (!verified) {
      requiredReview.push({
        id: claim.id,
        reason: `claim-${claim.level}-unverified`,
        source: claim.source,
      });
    }
  }

  normalized.assumptions.forEach((assumption, index) => {
    const id = `assumption-${index + 1}`;
    evidence.push({
      id,
      type: "assumption",
      level: "declared",
      source: "source",
      verified: false,
      text: assumption,
    });
    requiredReview.push({
      id,
      reason: "assumption-open",
      source: "source",
    });
  });

  normalized.externalReferences.forEach((reference, index) => {
    const id = `external-reference-${index + 1}`;
    evidence.push({
      id,
      type: "external-reference",
      level: "external",
      source: reference,
      verified: false,
      text: reference,
    });
    requiredReview.push({
      id,
      reason: "external-reference-review",
      source: reference,
    });
  });

  const reviewer = cleanText(options.reviewer ?? options.reviewTarget)
    || (requiredReview.length > 0 ? "operator" : "runtime");
  const acceptedStatus = cleanText(options.acceptedStatus) || "truth-boundary-accepted";
  const blockedStatus = cleanText(options.blockedStatus) || "truth-boundary-review";
  const exportReady = report.exportReady && requiredReview.length === 0;

  return {
    handoffKind: "aios.truth-boundary.handoff.v1",
    id: cleanText(options.id) || report.snapshot.id,
    reviewer,
    status: exportReady ? acceptedStatus : blockedStatus,
    exportReady,
    reviewRequired: requiredReview.length > 0,
    localOnly: normalized.localOnly,
    summary,
    counters: report.counters,
    requiredReview,
    evidence,
    snapshot: report.snapshot,
    timelineSummary: report.timelineSummary,
  };
}

export function normalizeLifecycleControls(input = {}) {
  const mode = LIFECYCLE_MODES.has(input?.mode) ? input.mode : (input?.enabled === false ? "disabled" : "enabled");
  const enabled = mode !== "disabled" && normalizeBoolean(input?.enabled, mode === "enabled");
  const settings = asArray(input?.settings ?? input?.setting).map(normalizeLifecycleSetting);
  const schedule = normalizeLifecycleSchedule(input?.schedule ?? input?.scheduling);
  const recovery = normalizeLifecycleRecovery(input?.recovery ?? input?.rollback);
  const commands = asArray(input?.commands ?? input?.command).map(normalizeLifecycleCommand);
  const blockedCommands = new Set(asArray(input?.blockedCommands ?? input?.blockedCommand).map(cleanText).filter((command) => LIFECYCLE_COMMANDS.has(command)));
  const allowedCommands = [];
  const commandViolations = [];

  for (const command of LIFECYCLE_COMMANDS) {
    if (blockedCommands.has(command)) continue;
    if (mode === "read-only" && !["acknowledge", "schedule"].includes(command)) continue;
    if (mode === "maintenance" && command === "start") continue;
    if (!enabled && !["enable", "acknowledge"].includes(command)) continue;
    allowedCommands.push(command);
  }

  for (const command of commands) {
    if (!allowedCommands.includes(command.name)) {
      commandViolations.push({
        command: command.name,
        reason: blockedCommands.has(command.name) ? "blocked-by-policy" : `not-allowed-in-${mode}`,
      });
    }
  }

  const validation = [
    ...settings.flatMap((setting) => setting.violations.map((violation) => ({
      scope: "setting",
      key: setting.key,
      violation,
    }))),
    ...schedule.violations.map((violation) => ({
      scope: "schedule",
      key: schedule.strategy,
      violation,
    })),
    ...commandViolations.map((violation) => ({
      scope: "command",
      key: violation.command,
      violation: violation.reason,
    })),
  ];
  const nextAction = deriveLifecycleNextAction({ enabled, mode, schedule, recovery, settings, commands });
  const normalizedNextAction = {
    type: NEXT_ACTION_TYPES.has(input?.nextAction?.type) ? input.nextAction.type : nextAction.type,
    command: cleanText(input?.nextAction?.command) || nextAction.command,
    reason: cleanText(input?.nextAction?.reason) || nextAction.reason,
  };

  return {
    id: cleanText(input?.id) || "lifecycle-controls",
    mode,
    enabled,
    settings,
    schedule,
    recovery,
    commands,
    allowedCommands,
    blockedCommands: [...blockedCommands],
    validation,
    valid: validation.length === 0,
    nextAction: normalizedNextAction,
  };
}

export function summarizeLifecycleControls(input = {}) {
  const normalized = normalizeLifecycleControls(input);
  return {
    id: normalized.id,
    mode: normalized.mode,
    enabled: normalized.enabled,
    valid: normalized.valid,
    settingCount: normalized.settings.length,
    requiredSettingCount: normalized.settings.filter((setting) => setting.required).length,
    disabledSettingCount: normalized.settings.filter((setting) => !setting.enabled).length,
    validationCount: normalized.validation.length,
    scheduleStrategy: normalized.schedule.strategy,
    schedulePaused: normalized.schedule.paused,
    allowedCommandCount: normalized.allowedCommands.length,
    requestedCommandCount: normalized.commands.filter((command) => command.requested).length,
    nextAction: normalized.nextAction,
  };
}

export function normalizeOperationalHealth(input = {}) {
  const status = HEALTH_STATUSES.has(input?.status) ? input.status : "unknown";
  const checks = asArray(input?.checks ?? input?.check).map((check, index) => {
    const checkStatus = HEALTH_STATUSES.has(check?.status) ? check.status : (check?.ok === true ? "healthy" : check?.ok === false ? "failed" : "unknown");
    return {
      id: cleanText(check?.id) || `health-check-${index + 1}`,
      name: cleanText(check?.name) || cleanText(check?.kind) || `check ${index + 1}`,
      status: checkStatus,
      message: cleanText(check?.message) || null,
      observedAt: cleanText(check?.observedAt ?? check?.at) || null,
    };
  });
  const actionableErrors = asArray(input?.actionableErrors ?? input?.errors ?? input?.error).map((error, index) => ({
    code: cleanText(error?.code) || `HEALTH_ERROR_${index + 1}`,
    message: cleanText(error?.message ?? error) || "Health check failed.",
    action: cleanText(error?.action ?? error?.resolution) || "retry",
  }));

  const inferredStatus = status !== "unknown" ? status
    : actionableErrors.length > 0 ? "failed"
      : checks.some((check) => check.status === "failed") ? "failed"
        : checks.some((check) => check.status === "degraded") ? "degraded"
          : checks.length > 0 && checks.every((check) => check.status === "healthy") ? "healthy"
            : "unknown";
  const failureState = FAILURE_STATES.has(input?.failureState) ? input.failureState : (
    inferredStatus === "failed" ? "operator-required" : inferredStatus === "degraded" ? "retryable" : "none"
  );
  const retry = {
    allowed: input?.retry?.allowed !== false && failureState !== "terminal",
    attempt: normalizeNumber(input?.retry?.attempt, 0),
    maxAttempts: normalizeNumber(input?.retry?.maxAttempts ?? input?.retryLimit, 0),
    backoffMs: normalizeNumber(input?.retry?.backoffMs ?? input?.backoffMs, 0),
    nextRetryAt: cleanText(input?.retry?.nextRetryAt) || null,
  };

  return {
    status: inferredStatus,
    failureState,
    degradedMode: Boolean(input?.degradedMode) || inferredStatus === "degraded",
    checks,
    retry,
    actionableErrors: actionableErrors.map((error) => ({
      ...error,
      action: error.action === "retry" && failureState === "operator-required" ? "operator-review" : error.action,
    })),
  };
}

export function summarizeOperationalHealth(health) {
  const normalized = normalizeOperationalHealth(health);
  return {
    status: normalized.status,
    failureState: normalized.failureState,
    degradedMode: normalized.degradedMode,
    checkCount: normalized.checks.length,
    failedCheckCount: normalized.checks.filter((check) => check.status === "failed").length,
    actionableErrorCount: normalized.actionableErrors.length,
    retryAllowed: normalized.retry.allowed && normalized.retry.attempt < normalized.retry.maxAttempts,
    nextRetryAt: normalized.retry.nextRetryAt,
  };
}

export { DEFAULT_BOUNDARY, FAILURE_STATES, HEALTH_STATUSES, LIFECYCLE_COMMANDS, LIFECYCLE_MODES, NEXT_ACTION_TYPES, PROVIDER_HANDOFF_STATES, SCHEDULE_STRATEGIES, TIMELINE_KINDS, TRUST_LEVELS };
