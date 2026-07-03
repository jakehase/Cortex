import {
  buildMailchimpHandoffIdentity,
  compileMailchimpAdapterHandoff,
} from '../runtime/adapter-handoff.mjs';

const DEFAULT_CACHE_LIMIT = 128;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CACHE_LIFECYCLE_COMMANDS = new Set(['observe', 'enable', 'disable', 'refresh', 'evict_stale', 'export', 'hold']);
const CACHE_SCHEDULE_MODES = new Set(['manual', 'automatic', 'scheduled']);
const SYNC_CHECKPOINT_STATES = new Set(['ready', 'missing_cursor', 'stale', 'external_unlinked', 'local_only']);
const COMPILE_CACHE_FAILURE_ACTIONS = Object.freeze({
  none: 'observe',
  stale_cache_entry: 'refresh_compile_cache',
  provider_sync_not_restart_safe: 'refresh_provider_sync_before_replay',
  export_not_ready: 'review_compile_cache_export',
  replay_barrier_closed: 'open_compile_cache_replay_barrier',
  retry_budget_exhausted: 'hold_for_operator',
  persisted_replay_not_restart_safe: 'rebuild_persisted_replay_state',
  lifecycle_controls_blocked: 'repair_compile_cache_lifecycle_settings',
});

function compactString(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function nowFrom(options = {}) {
  const value = Number(options.now ?? options.nowMs);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : Date.now();
}

function stableList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(list.map(compactString).filter(Boolean))].sort();
}

function cloneContract(value) {
  if (Array.isArray(value)) return value.map(cloneContract);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((next, key) => {
    if (value[key] !== undefined) next[key] = cloneContract(value[key]);
    return next;
  }, {});
}

function normalizeBoundaryScope(source = {}) {
  const boundary = source.boundaryContract && typeof source.boundaryContract === 'object'
    ? source.boundaryContract
    : source.truthBoundary?.tenantBoundary && typeof source.truthBoundary.tenantBoundary === 'object'
      ? source.truthBoundary.tenantBoundary
      : source.boundaryScope && typeof source.boundaryScope === 'object'
        ? source.boundaryScope
        : {};
  const audit = boundary.audit && typeof boundary.audit === 'object' ? boundary.audit : {};
  return {
    protocol: 'aios.compile-cache-boundary-scope.mailchimp.v1',
    tenant: compactString(boundary.tenant || source.tenant),
    scope: compactString(boundary.scope || 'tenant') || 'tenant',
    workspace: compactString(boundary.workspace || source.workspace || source.workspaceId),
    allowedWorkspaces: stableList(boundary.allowedWorkspaces),
    roles: stableList(boundary.roles),
    requiredGrants: stableList(boundary.requiredGrants),
    grants: stableList(boundary.grants),
    denied: stableList(boundary.denied),
    allowed: boundary.allowed !== false,
    blockedReasons: stableList(boundary.blockedReasons),
    audit: {
      channel: compactString(audit.channel || 'compile-cache'),
      handoffKey: compactString(audit.handoffKey),
      decision: compactString(audit.decision || (boundary.allowed === false ? 'block' : 'allow')),
      externalWriteSuppressed: audit.externalWriteSuppressed === true,
    },
  };
}

function boundaryMatches(entryBoundary = {}, requestedBoundary = {}) {
  const tenant = compactString(requestedBoundary.tenant);
  const workspace = compactString(requestedBoundary.workspace || requestedBoundary.workspaceId);
  const grants = stableList(requestedBoundary.grants || requestedBoundary.permissions);
  const tenantMatches = !tenant || !entryBoundary.tenant || tenant === entryBoundary.tenant;
  const workspaceMatches = !workspace
    || !entryBoundary.workspace
    || workspace === entryBoundary.workspace
    || (Array.isArray(entryBoundary.allowedWorkspaces) && entryBoundary.allowedWorkspaces.includes(workspace));
  const grantsCover = entryBoundary.requiredGrants.length === 0
    || grants.length === 0
    || entryBoundary.requiredGrants.every((grant) => grants.includes(grant));
  const blockedReasons = stableList([
    ...(tenantMatches ? [] : ['tenant_mismatch']),
    ...(workspaceMatches ? [] : ['workspace_mismatch']),
    ...(grantsCover ? [] : ['permission_scope_mismatch']),
    ...(entryBoundary.allowed === false ? ['cached_boundary_denied'] : []),
  ]);
  return { ok: blockedReasons.length === 0, blockedReasons };
}

function normalizeProviderSyncSource(source = {}) {
  const providerContract = source.providerContract && typeof source.providerContract === 'object'
    ? source.providerContract
    : {};
  const externalHandoff = source.externalHandoff && typeof source.externalHandoff === 'object'
    ? source.externalHandoff
    : providerContract.externalHandoff && typeof providerContract.externalHandoff === 'object'
      ? providerContract.externalHandoff
      : {};
  const sync = source.sync && typeof source.sync === 'object'
    ? source.sync
    : providerContract.sync && typeof providerContract.sync === 'object'
      ? providerContract.sync
      : {};
  const capabilityNegotiation = providerContract.capabilityNegotiation && typeof providerContract.capabilityNegotiation === 'object'
    ? providerContract.capabilityNegotiation
    : source.capabilityNegotiation && typeof source.capabilityNegotiation === 'object'
      ? source.capabilityNegotiation
      : {};

  return {
    provider: compactString(providerContract.provider || source.provider || 'mailchimp') || 'mailchimp',
    service: compactString(providerContract.service || source.service || 'mailchimp-marketing') || 'mailchimp-marketing',
    externalState: compactString(
      externalHandoff.state
        || source.externalHandoffState
        || (externalHandoff.requestId ? 'linked' : 'local_only'),
    ).toLowerCase().replaceAll('-', '_') || 'local_only',
    externalRequestId: compactString(externalHandoff.requestId || source.externalRequestId || source.providerRequestId),
    cursor: compactString(sync.cursor || source.syncCursor || source.cursor),
    lastSyncedAt: compactString(sync.lastSyncedAt || source.lastSyncedAt || source.syncedAt),
    resource: compactString(sync.resource || source.syncResource || 'mailchimp') || 'mailchimp',
    batchId: compactString(sync.batchId || source.syncBatchId),
    requiredForExternalWrite: sync.requiredForExternalWrite === true
      || capabilityNegotiation.writeCapabilityRequested === true
      || (Array.isArray(source.capabilities) && source.capabilities.includes('external.write')),
    syncReady: sync.ready !== false,
    capabilitySatisfied: capabilityNegotiation.satisfied !== false,
  };
}

export function buildMailchimpCompileCacheProviderSyncCheckpoint(source = {}, runtime = {}) {
  const compiled = normalizeProviderSyncSource(source);
  const observed = normalizeProviderSyncSource({
    providerContract: runtime.providerContract || source.providerContract,
    externalHandoff: runtime.externalHandoff || source.externalHandoff,
    sync: runtime.sync,
    provider: runtime.provider,
    service: runtime.service,
    externalHandoffState: runtime.externalHandoffState,
    externalRequestId: runtime.externalRequestId,
    providerRequestId: runtime.providerRequestId,
    syncCursor: runtime.syncCursor,
    cursor: runtime.cursor,
    lastSyncedAt: runtime.lastSyncedAt,
    syncedAt: runtime.syncedAt,
    syncResource: runtime.syncResource,
    syncBatchId: runtime.syncBatchId,
    capabilityNegotiation: runtime.capabilityNegotiation,
    capabilities: runtime.capabilities,
  });
  const externalState = observed.externalState !== 'local_only' ? observed.externalState : compiled.externalState;
  const externalRequestId = observed.externalRequestId || compiled.externalRequestId;
  const cursor = observed.cursor || compiled.cursor;
  const lastSyncedAt = observed.lastSyncedAt || compiled.lastSyncedAt;
  const requiredForExternalWrite = observed.requiredForExternalWrite || compiled.requiredForExternalWrite;
  const capabilitySatisfied = observed.capabilitySatisfied !== false && compiled.capabilitySatisfied !== false;
  const linked = externalState !== 'local_only';
  const cursorRequired = requiredForExternalWrite || linked;
  const state = !linked && !cursorRequired
    ? 'local_only'
    : linked && !externalRequestId
      ? 'external_unlinked'
      : cursorRequired && !cursor
        ? 'missing_cursor'
        : observed.syncReady === false || compiled.syncReady === false
          ? 'stale'
          : 'ready';
  const restartSafe = state === 'ready' || state === 'local_only';

  return {
    protocol: 'aios.compile-cache-provider-sync.mailchimp.v1',
    provider: observed.provider || compiled.provider,
    service: observed.service || compiled.service,
    resource: observed.resource || compiled.resource,
    state: SYNC_CHECKPOINT_STATES.has(state) ? state : 'stale',
    restartSafe,
    externalHandoffState: externalState,
    externalRequestId,
    cursor,
    cursorRequired,
    lastSyncedAt,
    batchId: observed.batchId || compiled.batchId,
    capabilitySatisfied,
    requiredForExternalWrite,
    replayPolicy: restartSafe
      ? 'reuse_checkpoint'
      : state === 'external_unlinked'
        ? 'relink_external_handoff'
        : state === 'missing_cursor'
          ? 'refresh_provider_contract'
          : 'refresh_provider_sync_before_replay',
    blockedReasons: [
      ...(!capabilitySatisfied ? ['provider_capability_missing'] : []),
      ...(linked && !externalRequestId ? ['external_request_missing'] : []),
      ...(cursorRequired && !cursor ? ['sync_cursor_missing'] : []),
      ...(state === 'stale' ? ['sync_checkpoint_stale'] : []),
    ].sort(),
  };
}

function normalizeCacheOptions(options = {}) {
  const ttlMs = positiveInteger(options.ttlMs ?? options.ttl ?? DEFAULT_TTL_MS, DEFAULT_TTL_MS);
  const maxEntries = positiveInteger(options.maxEntries ?? options.limit ?? DEFAULT_CACHE_LIMIT, DEFAULT_CACHE_LIMIT);
  const namespace = compactString(options.namespace || 'mailchimp');
  const tags = stableList(options.tags || options.cacheTags);
  return {
    ttlMs,
    maxEntries: Math.max(1, maxEntries),
    namespace,
    tags,
    freezeDescriptors: options.freezeDescriptors !== false,
  };
}

function makeEntry(identity, descriptor, options, now) {
  const diagnostics = Array.isArray(descriptor.diagnostics) ? descriptor.diagnostics : [];
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const expiresAt = options.ttlMs > 0 ? now + options.ttlMs : null;
  const providerSyncCheckpoint = buildMailchimpCompileCacheProviderSyncCheckpoint(descriptor);
  const boundaryScope = normalizeBoundaryScope(descriptor);
  return {
    protocol: 'aios.compile-cache-entry.mailchimp.v1',
    key: identity.cacheKey,
    namespace: options.namespace,
    tags: options.tags,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    expiresAt,
    hits: 0,
    stale: false,
    identity: {
      protocol: identity.protocol,
      adapter: identity.adapter,
      language: identity.language,
      sourceKind: identity.sourceKind,
      sourceHash: identity.sourceHash,
      optionsHash: identity.optionsHash,
      contractHash: identity.contractHash,
      requestKey: identity.requestKey,
    },
    diagnostics: {
      total: diagnostics.length,
      errors: errorCount,
      warnings: warningCount,
    },
    providerSyncCheckpoint,
    boundaryScope,
    descriptor: options.freezeDescriptors ? Object.freeze(cloneContract(descriptor)) : cloneContract(descriptor),
  };
}

function isExpired(entry, now) {
  return entry.expiresAt != null && now >= entry.expiresAt;
}

function summarizeEntry(entry, now) {
  return {
    key: entry.key,
    namespace: entry.namespace,
    tags: entry.tags,
    sourceHash: entry.identity.sourceHash,
    optionsHash: entry.identity.optionsHash,
    contractHash: entry.identity.contractHash,
    requestKey: entry.identity.requestKey,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastAccessedAt: entry.lastAccessedAt,
    expiresAt: entry.expiresAt,
    ageMs: Math.max(0, now - entry.createdAt),
    ttlRemainingMs: entry.expiresAt == null ? null : Math.max(0, entry.expiresAt - now),
    hits: entry.hits,
    stale: entry.stale || isExpired(entry, now),
    diagnostics: entry.diagnostics,
    providerSyncCheckpoint: cloneContract(entry.providerSyncCheckpoint),
    boundaryScope: cloneContract(entry.boundaryScope || normalizeBoundaryScope(entry.descriptor)),
  };
}

function normalizeCacheEvent(event = {}, index = 0) {
  return {
    index,
    at: positiveInteger(event.at ?? event.time ?? event.timestamp, index),
    kind: compactString(event.kind || event.type || 'observed'),
    key: compactString(event.key),
    namespace: compactString(event.namespace),
    status: compactString(event.status || 'observed'),
    reason: compactString(event.reason),
    requestKey: compactString(event.requestKey),
    sourceHash: compactString(event.sourceHash),
    contractHash: compactString(event.contractHash),
  };
}

function summarizeCacheTimeline(events = []) {
  const normalized = events.map(normalizeCacheEvent);
  const latest = normalized[normalized.length - 1] || null;
  const first = normalized[0] || null;
  const byKind = normalized.reduce((counts, event) => {
    counts[event.kind] = (counts[event.kind] || 0) + 1;
    return counts;
  }, {});
  const byStatus = normalized.reduce((counts, event) => {
    counts[event.status] = (counts[event.status] || 0) + 1;
    return counts;
  }, {});

  return {
    totalEvents: normalized.length,
    firstAt: first?.at ?? null,
    latestAt: latest?.at ?? null,
    latestKind: latest?.kind || null,
    latestStatus: latest?.status || null,
    eventsByKind: byKind,
    eventsByStatus: byStatus,
    events: normalized,
  };
}

function normalizeAnalyticsCounters(counters = {}) {
  return {
    entries: positiveInteger(counters.entries, 0),
    staleEntries: positiveInteger(counters.staleEntries, 0),
    expiredEntries: positiveInteger(counters.expiredEntries, 0),
    totalEntryHits: positiveInteger(counters.totalEntryHits, 0),
    lookupEvents: positiveInteger(counters.lookupEvents, 0),
    hitEvents: positiveInteger(counters.hitEvents, 0),
    missEvents: positiveInteger(counters.missEvents, 0),
    storeEvents: positiveInteger(counters.storeEvents, 0),
    evictionEvents: positiveInteger(counters.evictionEvents, counters.evictEvents || 0),
    invalidationEvents: positiveInteger(counters.invalidationEvents, counters.invalidateEvents || 0),
    diagnosticErrors: positiveInteger(counters.diagnosticErrors, counters.errorEntries || 0),
    diagnosticWarnings: positiveInteger(counters.diagnosticWarnings, 0),
    diagnosticsTotal: positiveInteger(counters.diagnosticsTotal, 0),
    boundaryBlockedEntries: positiveInteger(counters.boundaryBlockedEntries, 0),
    providerBlockedEntries: positiveInteger(counters.providerBlockedEntries, 0),
  };
}

function deriveCacheReportingState(parts = {}) {
  const counters = normalizeAnalyticsCounters(parts.counters);
  const blockedReasons = stableList(parts.blockedReasons);
  const latestStatus = compactString(parts.latestStatus);
  const latestKind = compactString(parts.latestKind);
  const exportReady = parts.exportReady === true && blockedReasons.length === 0;
  const hasLookupTraffic = counters.lookupEvents > 0;
  const hasFailures = counters.diagnosticErrors > 0
    || counters.staleEntries > 0
    || counters.boundaryBlockedEntries > 0
    || counters.providerBlockedEntries > 0
    || blockedReasons.length > 0;

  return {
    state: exportReady
      ? 'export_ready'
      : hasFailures
        ? 'needs_attention'
        : hasLookupTraffic
          ? 'warming'
          : 'observing',
    exportReady,
    hasLookupTraffic,
    hasFailures,
    latestStatus: latestStatus || null,
    latestKind: latestKind || null,
    nextAction: exportReady
      ? 'deliver_compile_cache_export'
      : counters.staleEntries > 0
        ? 'refresh_compile_cache'
        : counters.diagnosticErrors > 0
          ? 'repair_cached_descriptor'
          : counters.boundaryBlockedEntries > 0
            ? 'repair_tenant_permissions'
            : counters.providerBlockedEntries > 0
              ? 'refresh_provider_sync_before_replay'
              : blockedReasons.includes('operator_acceptance_missing')
                ? 'request_compile_cache_acceptance'
                : hasLookupTraffic
                  ? 'observe_compile_cache_trend'
                  : 'observe',
  };
}

function buildCacheHistorySnapshots(events = [], baseCounters = {}) {
  const running = normalizeAnalyticsCounters(baseCounters);
  Object.keys(running).forEach((key) => { running[key] = 0; });

  return events.map((event, index) => {
    if (event.kind === 'lookup') {
      running.lookupEvents += 1;
      if (event.status === 'hit') running.hitEvents += 1;
      if (event.status === 'miss') running.missEvents += 1;
    }
    if (event.kind === 'store') running.storeEvents += 1;
    if (event.kind === 'evict') running.evictionEvents += 1;
    if (event.kind === 'invalidate') running.invalidationEvents += 1;

    return {
      sequence: index,
      at: event.at,
      kind: event.kind,
      status: event.status,
      key: event.key,
      reason: event.reason,
      requestKey: event.requestKey,
      counters: {
        lookupEvents: running.lookupEvents,
        hitEvents: running.hitEvents,
        missEvents: running.missEvents,
        storeEvents: running.storeEvents,
        evictionEvents: running.evictionEvents,
        invalidationEvents: running.invalidationEvents,
      },
      ratios: {
        hitRate: running.lookupEvents === 0 ? null : Number((running.hitEvents / running.lookupEvents).toFixed(4)),
      },
    };
  });
}

export function buildMailchimpCompileCacheHistoryReport(source = {}, options = {}) {
  const now = nowFrom(options);
  const namespace = compactString(source.namespace || source.snapshot?.namespace || 'mailchimp');
  const entries = Array.isArray(source.entries)
    ? source.entries
    : Array.isArray(source.snapshot?.entries)
      ? source.snapshot.entries
      : [];
  const analytics = source.analytics && typeof source.analytics === 'object'
    ? source.analytics
    : source.snapshot?.analytics && typeof source.snapshot.analytics === 'object'
      ? source.snapshot.analytics
      : {};
  const rawEvents = Array.isArray(source.events)
    ? source.events
    : Array.isArray(source.history?.events)
      ? source.history.events
      : [];
  const timeline = summarizeCacheTimeline(rawEvents);
  const counters = normalizeAnalyticsCounters({
    ...(analytics.counters || {}),
    entries: entries.length,
    staleEntries: entries.filter((entry) => entry.stale === true).length,
    expiredEntries: entries.filter((entry) => entry.expiresAt != null && now >= entry.expiresAt).length,
    totalEntryHits: entries.reduce((total, entry) => total + positiveInteger(entry.hits, 0), 0),
    boundaryBlockedEntries: entries.filter((entry) => (
      entry.boundaryScope?.allowed === false || entry.boundaryScope?.blockedReasons?.length > 0
    )).length,
    providerBlockedEntries: entries.filter((entry) => (
      entry.providerSyncCheckpoint?.restartSafe === false
        || entry.providerSyncCheckpoint?.blockedReasons?.length > 0
    )).length,
  });
  const diagnosticEntries = entries.filter((entry) => (entry.diagnostics?.errors || 0) > 0);
  const blockedReasons = stableList([
    ...(counters.staleEntries > 0 ? ['stale_entries'] : []),
    ...(diagnosticEntries.length > 0 ? ['diagnostic_errors'] : []),
    ...(counters.boundaryBlockedEntries > 0 ? ['tenant_boundary_blocked'] : []),
    ...(counters.providerBlockedEntries > 0 ? ['provider_sync_not_restart_safe'] : []),
  ]);
  const exportReady = blockedReasons.length === 0;
  const snapshots = buildCacheHistorySnapshots(timeline.events, counters);
  const latestSnapshot = snapshots[snapshots.length - 1] || null;
  const reportingState = deriveCacheReportingState({
    counters,
    blockedReasons,
    exportReady,
    latestStatus: timeline.latestStatus,
    latestKind: timeline.latestKind,
  });

  return {
    protocol: 'aios.compile-cache-history.mailchimp.v1',
    namespace,
    generatedAt: now,
    exportReady,
    blockedReasons,
    counters,
    ratios: {
      hitRate: counters.lookupEvents === 0 ? null : Number((counters.hitEvents / counters.lookupEvents).toFixed(4)),
      staleEntryRate: counters.entries === 0 ? 0 : Number((counters.staleEntries / counters.entries).toFixed(4)),
      diagnosticEntryRate: counters.entries === 0 ? 0 : Number((diagnosticEntries.length / counters.entries).toFixed(4)),
    },
    timeline: {
      ...timeline,
      snapshotCount: snapshots.length,
      latestSnapshotAt: latestSnapshot?.at ?? null,
    },
    reportingState,
    snapshots,
    exportSummary: {
      ready: exportReady,
      nextAction: reportingState.nextAction,
      generatedAt: now,
      latestEventAt: timeline.latestAt,
      latestEventKind: timeline.latestKind,
      latestEventStatus: timeline.latestStatus,
      manifestEntryCount: entries.length,
    },
  };
}

function normalizeCacheLifecycleSettings(source = {}) {
  const controls = source.controls && typeof source.controls === 'object' ? source.controls : {};
  const schedule = source.schedule && typeof source.schedule === 'object' ? source.schedule : {};
  const rawCommand = compactString(
    source.command
      || source.nextCommand
      || controls.command
      || controls.nextCommand
      || 'observe',
  ).toLowerCase().replaceAll('-', '_');
  const rawMode = compactString(
    schedule.mode
      || source.scheduleMode
      || controls.scheduleMode
      || 'manual',
  ).toLowerCase().replaceAll('-', '_');

  return {
    enabled: source.enabled !== false && controls.enabled !== false,
    command: CACHE_LIFECYCLE_COMMANDS.has(rawCommand) ? rawCommand : rawCommand.replaceAll('_', '-'),
    schedule: {
      mode: CACHE_SCHEDULE_MODES.has(rawMode) ? rawMode : 'manual',
      runAt: compactString(schedule.runAt || schedule.nextRunAt || source.runAt || source.nextRunAt),
      timezone: compactString(schedule.timezone || source.timezone || 'UTC') || 'UTC',
      cooldownMs: positiveInteger(schedule.cooldownMs ?? source.cooldownMs ?? source.cooldown, 0),
    },
    controls: {
      allowRefresh: controls.allowRefresh !== false,
      allowEvictStale: controls.allowEvictStale !== false,
      allowExport: controls.allowExport !== false,
      requireCleanExport: controls.requireCleanExport !== false,
      operatorHold: controls.operatorHold === true || source.operatorHold === true,
    },
  };
}

function normalizeSnapshotForLifecycle(snapshot = {}, now = Date.now()) {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object' ? snapshot.analytics : {};
  const exportSummary = snapshot.exportSummary && typeof snapshot.exportSummary === 'object'
    ? snapshot.exportSummary
    : buildMailchimpCompileCacheExportSummary({
      protocol: snapshot.protocol || 'aios.compile-cache-snapshot.mailchimp.v1',
      namespace: snapshot.namespace || 'mailchimp',
      entries,
      analytics,
    });

  return {
    namespace: compactString(snapshot.namespace || 'mailchimp'),
    entries,
    analytics,
    exportSummary,
    now,
  };
}

function validateCacheLifecycleSettings(settings, snapshot) {
  const diagnostics = [];
  const scheduledAt = parseLifecycleScheduleTime(settings.schedule.runAt);
  if (!CACHE_LIFECYCLE_COMMANDS.has(settings.command)) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.unsupported_command',
      severity: 'error',
      field: 'compileCache.lifecycle.command',
      message: `Unsupported Mailchimp compile cache lifecycle command "${settings.command}".`,
    });
  }
  if (settings.schedule.mode === 'scheduled' && !settings.schedule.runAt) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.missing_schedule_time',
      severity: 'error',
      field: 'compileCache.lifecycle.schedule.runAt',
      message: 'Scheduled Mailchimp compile cache lifecycle commands require a runAt value.',
    });
  }
  if (settings.schedule.mode === 'scheduled' && settings.schedule.runAt && scheduledAt.valid === false) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.invalid_schedule_time',
      severity: 'error',
      field: 'compileCache.lifecycle.schedule.runAt',
      message: 'Scheduled Mailchimp compile cache lifecycle commands require a parseable runAt value.',
    });
  }
  if (settings.enabled === false && ['refresh', 'evict_stale', 'export'].includes(settings.command)) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.disabled_command_blocked',
      severity: 'warning',
      field: 'compileCache.lifecycle.enabled',
      message: `Compile cache command "${settings.command}" is held while cache lifecycle controls are disabled.`,
    });
  }
  if (settings.command === 'refresh' && settings.controls.allowRefresh === false) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.refresh_disabled',
      severity: 'error',
      field: 'compileCache.lifecycle.controls.allowRefresh',
      message: 'Compile cache refresh is disabled by lifecycle controls.',
    });
  }
  if (settings.command === 'evict_stale' && settings.controls.allowEvictStale === false) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.evict_stale_disabled',
      severity: 'error',
      field: 'compileCache.lifecycle.controls.allowEvictStale',
      message: 'Compile cache stale eviction is disabled by lifecycle controls.',
    });
  }
  if (settings.command === 'export' && settings.controls.allowExport === false) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.export_disabled',
      severity: 'error',
      field: 'compileCache.lifecycle.controls.allowExport',
      message: 'Compile cache export is disabled by lifecycle controls.',
    });
  }
  if (
    settings.command === 'export'
    && settings.controls.requireCleanExport
    && snapshot.exportSummary.exportReady === false
  ) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.export_not_clean',
      severity: 'warning',
      field: 'compileCache.lifecycle.controls.requireCleanExport',
      message: 'Compile cache export is waiting for stale entries or descriptor diagnostics to clear.',
    });
  }
  return diagnostics;
}

function parseLifecycleScheduleTime(value) {
  if (value == null || value === '') {
    return {
      raw: '',
      at: null,
      valid: true,
      source: 'empty',
    };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      raw: value,
      at: Math.max(0, Math.floor(value)),
      valid: true,
      source: 'epoch_ms',
    };
  }
  const raw = compactString(value);
  if (!raw) {
    return {
      raw,
      at: null,
      valid: true,
      source: 'empty',
    };
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return {
      raw,
      at: Math.max(0, Math.floor(numeric)),
      valid: true,
      source: 'epoch_ms',
    };
  }
  const parsed = Date.parse(raw);
  return {
    raw,
    at: Number.isFinite(parsed) ? parsed : null,
    valid: Number.isFinite(parsed),
    source: 'date_time',
  };
}

function latestLifecycleActivityAt(snapshot = {}) {
  const candidates = [
    snapshot.analytics?.timeline?.latestAt,
    snapshot.exportSummary?.timeline?.latestAt,
    snapshot.exportSummary?.generatedAt,
    ...snapshot.entries.map((entry) => entry.updatedAt),
    ...snapshot.entries.map((entry) => entry.lastAccessedAt),
  ]
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .map((value) => Math.max(0, Math.floor(value)));
  return candidates.length === 0 ? null : Math.max(...candidates);
}

function deriveLifecycleCandidateCommand(lifecycle, metrics) {
  if (lifecycle.command === 'observe' && lifecycle.schedule.mode === 'automatic') {
    if (metrics.diagnosticEntries.length > 0) return 'refresh';
    if (metrics.expiredEntries.length > 0) return 'evict_stale';
    if (metrics.staleEntries.length > 0) return 'refresh';
    if (metrics.exportReady && lifecycle.controls.allowExport) return 'export';
  }
  if (lifecycle.command === 'refresh' && lifecycle.controls.allowRefresh) return 'refresh';
  if (lifecycle.command === 'evict_stale' && lifecycle.controls.allowEvictStale) return 'evict_stale';
  if (lifecycle.command === 'export' && lifecycle.controls.allowExport) return 'export';
  return lifecycle.command;
}

function buildLifecycleExecutionPlan({
  lifecycle,
  snapshot,
  diagnostics,
  metrics,
  now,
}) {
  const scheduledAt = parseLifecycleScheduleTime(lifecycle.schedule.runAt);
  const latestActivityAt = latestLifecycleActivityAt(snapshot);
  const cooldownUntil = lifecycle.schedule.cooldownMs > 0 && latestActivityAt != null
    ? latestActivityAt + lifecycle.schedule.cooldownMs
    : null;
  const scheduleDue = lifecycle.schedule.mode === 'scheduled'
    ? scheduledAt.valid === true && scheduledAt.at != null && scheduledAt.at <= now
    : true;
  const cooldownDue = cooldownUntil == null || cooldownUntil <= now;
  const disabledForCommand = lifecycle.enabled === false;
  const operatorHold = lifecycle.controls.operatorHold === true;
  const settingsBlocked = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const cleanExportBlocked = lifecycle.command === 'export'
    && lifecycle.controls.requireCleanExport
    && metrics.exportReady === false;
  const blockedReasons = stableList([
    ...(settingsBlocked ? ['invalid_lifecycle_settings'] : []),
    ...(disabledForCommand ? ['lifecycle_disabled'] : []),
    ...(operatorHold ? ['operator_hold'] : []),
    ...(cleanExportBlocked ? ['export_not_clean'] : []),
  ]);
  const deferredReasons = stableList([
    ...(lifecycle.schedule.mode === 'scheduled' && scheduledAt.valid === true && scheduledAt.at != null && scheduledAt.at > now
      ? ['schedule_not_due']
      : []),
    ...(lifecycle.schedule.mode === 'automatic' && !cooldownDue ? ['cooldown_active'] : []),
  ]);
  const candidateCommand = deriveLifecycleCandidateCommand(lifecycle, metrics);
  const executable = blockedReasons.length === 0 && deferredReasons.length === 0;
  const commandAction = candidateCommand === 'hold'
    ? 'hold_compile_cache'
    : candidateCommand === 'disable'
      ? 'disable_compile_cache_lifecycle'
      : candidateCommand === 'enable'
        ? 'enable_compile_cache_lifecycle'
        : candidateCommand === 'refresh'
          ? 'refresh_compile_cache'
          : candidateCommand === 'evict_stale'
            ? 'evict_stale_compile_cache_entries'
            : candidateCommand === 'export'
              ? 'export_compile_cache_summary'
              : 'reuse_compile_cache';
  const nextEligibleAt = blockedReasons.length > 0
    ? null
    : lifecycle.schedule.mode === 'scheduled'
      ? scheduledAt.at
      : cooldownUntil;
  const delayMs = nextEligibleAt == null ? 0 : Math.max(0, nextEligibleAt - now);

  return {
    protocol: 'aios.compile-cache-lifecycle-execution-plan.mailchimp.v1',
    state: blockedReasons.length > 0
      ? 'blocked'
      : deferredReasons.length > 0
        ? 'deferred'
        : candidateCommand === 'observe'
          ? 'idle'
          : 'due',
    executable,
    requestedCommand: lifecycle.command,
    candidateCommand,
    commandAction,
    nextAction: executable ? commandAction : deferredReasons.length > 0 ? 'wait_for_compile_cache_schedule' : null,
    schedule: {
      mode: lifecycle.schedule.mode,
      runAt: lifecycle.schedule.runAt || null,
      scheduledAt: scheduledAt.at,
      scheduleTimeSource: scheduledAt.source,
      scheduleTimeValid: scheduledAt.valid,
      timezone: lifecycle.schedule.timezone,
      due: scheduleDue,
      nextEligibleAt,
      delayMs,
    },
    cooldown: {
      cooldownMs: lifecycle.schedule.cooldownMs,
      latestActivityAt,
      cooldownUntil,
      due: cooldownDue,
      remainingMs: cooldownUntil == null ? 0 : Math.max(0, cooldownUntil - now),
    },
    blockedReasons,
    deferredReasons,
    idempotencyParts: stableList([
      snapshot.namespace,
      lifecycle.command,
      candidateCommand,
      lifecycle.schedule.mode,
      scheduledAt.at == null ? '' : `scheduled:${scheduledAt.at}`,
      cooldownUntil == null ? '' : `cooldown:${cooldownUntil}`,
      `entries:${snapshot.entries.length}`,
    ]),
  };
}

function normalizePreviewEntry(entry = {}) {
  const diagnostics = entry.diagnostics && typeof entry.diagnostics === 'object' ? entry.diagnostics : {};
  const providerSyncCheckpoint = entry.providerSyncCheckpoint && typeof entry.providerSyncCheckpoint === 'object'
    ? entry.providerSyncCheckpoint
    : {};
  const boundaryScope = entry.boundaryScope && typeof entry.boundaryScope === 'object'
    ? entry.boundaryScope
    : normalizeBoundaryScope(entry.descriptor || entry);

  return {
    key: compactString(entry.key || entry.cacheKey),
    requestKey: compactString(entry.requestKey || entry.identity?.requestKey),
    sourceHash: compactString(entry.sourceHash || entry.identity?.sourceHash),
    contractHash: compactString(entry.contractHash || entry.identity?.contractHash),
    stale: entry.stale === true,
    replayed: entry.replayed === true,
    ttlRemainingMs: entry.ttlRemainingMs ?? null,
    hits: positiveInteger(entry.hits, 0),
    diagnostics: {
      total: positiveInteger(diagnostics.total, 0),
      errors: positiveInteger(diagnostics.errors, 0),
      warnings: positiveInteger(diagnostics.warnings, 0),
    },
    providerSync: {
      state: compactString(providerSyncCheckpoint.state || 'unknown'),
      restartSafe: providerSyncCheckpoint.restartSafe === true,
      replayPolicy: compactString(providerSyncCheckpoint.replayPolicy),
      externalHandoffState: compactString(providerSyncCheckpoint.externalHandoffState || 'local_only'),
      cursorRequired: providerSyncCheckpoint.cursorRequired === true,
      cursorPresent: Boolean(providerSyncCheckpoint.cursor),
      capabilitySatisfied: providerSyncCheckpoint.capabilitySatisfied !== false,
      blockedReasons: stableList(providerSyncCheckpoint.blockedReasons),
    },
    boundaryScope: {
      tenant: compactString(boundaryScope.tenant),
      scope: compactString(boundaryScope.scope || 'tenant'),
      workspace: compactString(boundaryScope.workspace),
      allowed: boundaryScope.allowed !== false,
      blockedReasons: stableList(boundaryScope.blockedReasons),
      auditDecision: compactString(boundaryScope.audit?.decision),
    },
  };
}

function normalizeReplayBarrierSource(source = {}) {
  const handoff = source.uiHandoff && typeof source.uiHandoff === 'object' ? source.uiHandoff : {};
  const readiness = handoff.readiness && typeof handoff.readiness === 'object' ? handoff.readiness : {};
  const acceptance = handoff.acceptance && typeof handoff.acceptance === 'object' ? handoff.acceptance : {};
  const validationSummary = handoff.validationSummary && typeof handoff.validationSummary === 'object'
    ? handoff.validationSummary
    : {};
  const routeHints = handoff.routeHints && typeof handoff.routeHints === 'object' ? handoff.routeHints : {};
  const providerSyncCheckpoint = source.providerSyncCheckpoint && typeof source.providerSyncCheckpoint === 'object'
    ? source.providerSyncCheckpoint
    : handoff.preview?.providerSync && typeof handoff.preview.providerSync === 'object'
      ? handoff.preview.providerSync
      : {};
  const boundaryScope = source.boundaryScope && typeof source.boundaryScope === 'object'
    ? source.boundaryScope
    : handoff.preview?.boundaryScope && typeof handoff.preview.boundaryScope === 'object'
      ? handoff.preview.boundaryScope
      : {};
  const blockedReasons = stableList([
    ...(Array.isArray(validationSummary.blockedReasons) ? validationSummary.blockedReasons : []),
    ...(Array.isArray(providerSyncCheckpoint.blockedReasons) ? providerSyncCheckpoint.blockedReasons : []),
    ...(Array.isArray(boundaryScope.blockedReasons) ? boundaryScope.blockedReasons : []),
  ]);

  return {
    cacheKey: compactString(source.cacheKey || handoff.cacheKey),
    status: compactString(source.status || handoff.status || 'unknown'),
    replayed: source.replayed === true || handoff.replayed === true,
    readiness: {
      ready: readiness.ready === true,
      cacheReady: readiness.cacheReady === true,
      providerReady: readiness.providerReady === true,
      exportReady: readiness.exportReady === true,
      lifecycleReady: readiness.lifecycleReady === true,
      nextStep: compactString(readiness.nextStep || routeHints.primaryAction),
    },
    acceptance: {
      required: acceptance.required === true,
      accepted: acceptance.accepted !== false && acceptance.required !== true
        ? true
        : acceptance.accepted === true,
      acceptedBy: compactString(acceptance.acceptedBy),
      acceptedAt: compactString(acceptance.acceptedAt),
      reason: compactString(acceptance.reason),
    },
    providerSyncCheckpoint: {
      state: compactString(providerSyncCheckpoint.state || 'stale'),
      restartSafe: providerSyncCheckpoint.restartSafe === true,
      replayPolicy: compactString(providerSyncCheckpoint.replayPolicy || 'refresh_provider_sync_before_replay'),
      externalHandoffState: compactString(providerSyncCheckpoint.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerSyncCheckpoint.externalRequestId),
      cursorRequired: providerSyncCheckpoint.cursorRequired === true,
      cursorPresent: Boolean(providerSyncCheckpoint.cursor || providerSyncCheckpoint.cursorPresent),
      capabilitySatisfied: providerSyncCheckpoint.capabilitySatisfied !== false,
      blockedReasons,
    },
    boundaryScope: {
      tenant: compactString(boundaryScope.tenant),
      scope: compactString(boundaryScope.scope || 'tenant'),
      workspace: compactString(boundaryScope.workspace),
      allowed: boundaryScope.allowed !== false,
      blockedReasons: stableList(boundaryScope.blockedReasons),
    },
    routeHints: {
      primaryAction: compactString(routeHints.primaryAction),
      recoveryCommand: compactString(routeHints.recoveryCommand),
      statusRouteState: compactString(routeHints.statusRouteState),
      canReplayCachedDescriptor: routeHints.canReplayCachedDescriptor === true,
    },
  };
}

export function buildMailchimpCompileCacheReplayBarrier(source = {}, runtime = {}) {
  const normalized = normalizeReplayBarrierSource(source);
  const runtimeControls = runtime.compileCacheReplay && typeof runtime.compileCacheReplay === 'object'
    ? runtime.compileCacheReplay
    : runtime.replayControls && typeof runtime.replayControls === 'object'
      ? runtime.replayControls
      : {};
  const attempts = positiveInteger(runtimeControls.attempts ?? runtime.replayAttempts, 0);
  const maxAttempts = Math.max(1, positiveInteger(runtimeControls.maxAttempts ?? runtime.maxReplayAttempts, 1));
  const retryAfterMs = positiveInteger(runtimeControls.retryAfterMs ?? runtimeControls.backoffMs ?? runtime.retryAfterMs, 0);
  const command = compactString(runtimeControls.command || runtimeControls.nextCommand || normalized.routeHints.primaryAction);
  const providerSync = normalized.providerSyncCheckpoint;
  const boundaryBlocked = normalized.boundaryScope.allowed === false
    || normalized.boundaryScope.blockedReasons.length > 0;
  const acceptanceOpen = normalized.acceptance.required && !normalized.acceptance.accepted;
  const attemptBudgetExhausted = attempts >= maxAttempts;
  const providerBlocked = providerSync.restartSafe !== true
    || providerSync.capabilitySatisfied === false
    || providerSync.blockedReasons.length > 0;
  const readinessBlocked = normalized.readiness.ready !== true
    || normalized.readiness.cacheReady !== true
    || normalized.readiness.providerReady !== true
    || normalized.readiness.exportReady !== true
    || normalized.readiness.lifecycleReady !== true;
  const blockedReasons = stableList([
    ...(providerBlocked ? ['provider_sync_not_restart_safe'] : []),
    ...(boundaryBlocked ? ['tenant_boundary_not_replay_safe'] : []),
    ...(providerSync.capabilitySatisfied === false ? ['provider_capability_missing'] : []),
    ...providerSync.blockedReasons,
    ...normalized.boundaryScope.blockedReasons,
    ...(readinessBlocked ? ['handoff_readiness_not_satisfied'] : []),
    ...(normalized.readiness.cacheReady ? [] : ['compile_cache_not_ready']),
    ...(normalized.readiness.providerReady ? [] : ['provider_not_ready']),
    ...(normalized.readiness.exportReady ? [] : ['compile_cache_export_not_ready']),
    ...(normalized.readiness.lifecycleReady ? [] : ['compile_cache_lifecycle_not_ready']),
    ...(acceptanceOpen ? ['operator_acceptance_missing'] : []),
    ...(attemptBudgetExhausted ? ['replay_attempt_budget_exhausted'] : []),
  ]);
  const open = blockedReasons.length === 0;
  const nextAction = open
    ? normalized.replayed
      ? 'verify_cached_descriptor'
      : 'reuse_compile_cache'
    : acceptanceOpen
      ? 'request_compile_cache_acceptance'
      : attemptBudgetExhausted
        ? 'hold_for_operator'
        : providerBlocked
          ? providerSync.replayPolicy || 'refresh_provider_sync_before_replay'
          : normalized.readiness.nextStep || command || normalized.routeHints.recoveryCommand || 'refresh_compile_cache';

  return {
    protocol: 'aios.compile-cache-replay-barrier.mailchimp.v1',
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    open,
    restartSafe: open && providerSync.restartSafe === true,
    canReplayCachedDescriptor: open,
    blockedReasons,
    nextAction,
    recoveryCommand: open ? 'observe' : nextAction,
    providerSync: {
      state: providerSync.state,
      restartSafe: providerSync.restartSafe,
      replayPolicy: providerSync.replayPolicy,
      externalHandoffState: providerSync.externalHandoffState,
      externalRequestId: providerSync.externalRequestId,
      cursorRequired: providerSync.cursorRequired,
      cursorPresent: providerSync.cursorPresent,
      capabilitySatisfied: providerSync.capabilitySatisfied,
    },
    boundaryScope: normalized.boundaryScope,
    retry: {
      attempts,
      maxAttempts,
      retryAfterMs,
      exhausted: attemptBudgetExhausted,
      mode: retryAfterMs > 0 ? 'backoff' : 'immediate',
    },
    acceptance: normalized.acceptance,
    route: {
      statusRouteState: open ? 'ready' : 'blocked',
      primaryAction: nextAction,
      previousPrimaryAction: normalized.routeHints.primaryAction,
    },
  };
}

function normalizePersistedReplaySource(source = {}, runtime = {}) {
  const compileCache = source.compileCache && typeof source.compileCache === 'object'
    ? source.compileCache
    : source.protocol === 'aios.compile-cache-status.mailchimp.v1'
      ? source
      : {};
  const uiHandoff = source.uiHandoff && typeof source.uiHandoff === 'object'
    ? source.uiHandoff
    : compileCache.uiHandoff && typeof compileCache.uiHandoff === 'object'
      ? compileCache.uiHandoff
      : {};
  const replayBarrier = source.replayBarrier && typeof source.replayBarrier === 'object'
    ? source.replayBarrier
    : compileCache.replayBarrier && typeof compileCache.replayBarrier === 'object'
      ? compileCache.replayBarrier
      : buildMailchimpCompileCacheReplayBarrier({
        cacheKey: compileCache.cacheKey || source.cacheKey,
        status: compileCache.status || source.status,
        replayed: compileCache.replayed === true || source.replayed === true,
        providerSyncCheckpoint: compileCache.providerSyncCheckpoint || source.providerSyncCheckpoint,
        uiHandoff,
      }, runtime);
  const providerSyncCheckpoint = compileCache.providerSyncCheckpoint
    || source.providerSyncCheckpoint
    || replayBarrier.providerSync
    || uiHandoff.preview?.providerSync
    || {};
  const boundaryScope = compileCache.boundaryScope
    || source.boundaryScope
    || replayBarrier.boundaryScope
    || uiHandoff.preview?.boundaryScope
    || {};
  const runtimeReplay = runtime.compileCacheReplay && typeof runtime.compileCacheReplay === 'object'
    ? runtime.compileCacheReplay
    : runtime.replayControls && typeof runtime.replayControls === 'object'
      ? runtime.replayControls
      : {};
  const acceptance = uiHandoff.acceptance && typeof uiHandoff.acceptance === 'object'
    ? uiHandoff.acceptance
    : replayBarrier.acceptance && typeof replayBarrier.acceptance === 'object'
      ? replayBarrier.acceptance
      : {};
  const report = compileCache.report && typeof compileCache.report === 'object'
    ? compileCache.report
    : source.report && typeof source.report === 'object'
      ? source.report
      : {};

  return {
    namespace: compactString(compileCache.namespace || source.namespace || uiHandoff.namespace || 'mailchimp'),
    cacheKey: compactString(compileCache.cacheKey || source.cacheKey || uiHandoff.cacheKey || replayBarrier.cacheKey),
    requestKey: compactString(compileCache.requestKey || source.requestKey || runtime.requestKey),
    status: compactString(compileCache.status || source.status || uiHandoff.status || replayBarrier.status || 'unknown'),
    replayed: compileCache.replayed === true || source.replayed === true || uiHandoff.replayed === true,
    sourceHash: compactString(compileCache.sourceHash || source.sourceHash),
    optionsHash: compactString(compileCache.optionsHash || source.optionsHash),
    contractHash: compactString(compileCache.contractHash || source.contractHash),
    ttlRemainingMs: compileCache.ttlRemainingMs ?? source.ttlRemainingMs ?? null,
    stale: compileCache.stale === true || source.stale === true,
    exportReady: compileCache.exportReady !== false && report.exportReady !== false,
    providerSyncCheckpoint,
    boundaryScope,
    replayBarrier,
    uiHandoff,
    acceptance,
    runtimeReplay,
  };
}

function buildPersistedCommandKey(parts) {
  return stableList(parts).join(':');
}

function normalizeHealthBlockedReasons(parts = {}) {
  return stableList([
    ...(parts.stale ? ['stale_entry'] : []),
    ...(parts.providerSyncCheckpoint?.restartSafe === false ? ['provider_sync_not_restart_safe'] : []),
    ...(parts.report?.exportReady === false ? ['compile_cache_export_not_ready'] : []),
    ...(parts.lifecycleDecision?.blocked === true ? ['compile_cache_lifecycle_blocked'] : []),
    ...(parts.lifecycleDecision?.refreshRecommended === true ? ['compile_cache_lifecycle_refresh_recommended'] : []),
    ...(parts.replayBarrier?.open === false ? ['compile_cache_replay_barrier_closed'] : []),
    ...(parts.persistedReplaySummary?.restartSafe === false ? ['compile_cache_persisted_replay_not_restart_safe'] : []),
    ...(parts.persistedReplaySummary?.retry?.exhausted === true || parts.replayBarrier?.retry?.exhausted === true
      ? ['replay_attempt_budget_exhausted']
      : []),
    ...(Array.isArray(parts.providerSyncCheckpoint?.blockedReasons) ? parts.providerSyncCheckpoint.blockedReasons : []),
    ...(Array.isArray(parts.report?.blockedReasons) ? parts.report.blockedReasons : []),
    ...(Array.isArray(parts.replayBarrier?.blockedReasons) ? parts.replayBarrier.blockedReasons : []),
    ...(Array.isArray(parts.persistedReplaySummary?.blockedReasons) ? parts.persistedReplaySummary.blockedReasons : []),
  ]);
}

export function buildMailchimpCompileCacheOperationalHealthReport(source = {}, runtime = {}) {
  const replayBarrier = source.replayBarrier && typeof source.replayBarrier === 'object' ? source.replayBarrier : {};
  const persistedReplaySummary = source.persistedReplaySummary && typeof source.persistedReplaySummary === 'object'
    ? source.persistedReplaySummary
    : source.persistedReplayState && typeof source.persistedReplayState === 'object'
      ? source.persistedReplayState
      : {};
  const providerSyncCheckpoint = source.providerSyncCheckpoint && typeof source.providerSyncCheckpoint === 'object'
    ? source.providerSyncCheckpoint
    : {};
  const report = source.report && typeof source.report === 'object' ? source.report : {};
  const lifecycleDecision = source.lifecycleDecision && typeof source.lifecycleDecision === 'object'
    ? source.lifecycleDecision
    : source.lifecycle && typeof source.lifecycle === 'object'
      ? source.lifecycle
      : {};
  const stale = source.stale === true;
  const retryControls = runtime.compileCacheReplay && typeof runtime.compileCacheReplay === 'object'
    ? runtime.compileCacheReplay
    : runtime.replayControls && typeof runtime.replayControls === 'object'
      ? runtime.replayControls
      : {};
  const attempts = positiveInteger(
    retryControls.attempts
      ?? source.retry?.attempts
      ?? persistedReplaySummary.retry?.attempts
      ?? replayBarrier.retry?.attempts,
    0,
  );
  const maxAttempts = Math.max(1, positiveInteger(
    retryControls.maxAttempts
      ?? source.retry?.maxAttempts
      ?? persistedReplaySummary.retry?.maxAttempts
      ?? replayBarrier.retry?.maxAttempts,
    1,
  ));
  const retryAfterMs = positiveInteger(
    retryControls.retryAfterMs
      ?? retryControls.backoffMs
      ?? source.retry?.retryAfterMs
      ?? persistedReplaySummary.retry?.retryAfterMs
      ?? replayBarrier.retry?.retryAfterMs,
    0,
  );
  const retryExhausted = attempts >= maxAttempts
    || persistedReplaySummary.retry?.exhausted === true
    || replayBarrier.retry?.exhausted === true;
  const blockedReasons = normalizeHealthBlockedReasons({
    stale,
    providerSyncCheckpoint,
    report,
    lifecycleDecision,
    replayBarrier,
    persistedReplaySummary,
  });
  const providerRestartSafe = providerSyncCheckpoint.restartSafe !== false;
  const persistedRestartSafe = persistedReplaySummary.restartSafe !== false;
  const replayOpen = replayBarrier.open !== false;
  const exportReady = report.exportReady !== false;
  const lifecycleBlocked = lifecycleDecision.blocked === true || lifecycleDecision.refreshRecommended === true;
  const failureState = retryExhausted
    ? 'retry_budget_exhausted'
    : stale
      ? 'stale_cache_entry'
      : !providerRestartSafe
        ? 'provider_sync_not_restart_safe'
        : !exportReady
          ? 'export_not_ready'
          : !replayOpen
            ? 'replay_barrier_closed'
            : !persistedRestartSafe
              ? 'persisted_replay_not_restart_safe'
              : lifecycleBlocked
                ? 'lifecycle_controls_blocked'
                : 'none';
  const nextAction = compactString(
    source.nextAction
      || persistedReplaySummary.nextAction
      || persistedReplaySummary.recovery?.command
      || replayBarrier.nextAction
      || lifecycleDecision.nextAction
      || COMPILE_CACHE_FAILURE_ACTIONS[failureState],
  );
  const degradedMode = failureState === 'none'
    ? 'normal'
    : retryExhausted
      ? 'operator_hold'
      : ['provider_sync_not_restart_safe', 'persisted_replay_not_restart_safe'].includes(failureState)
        ? 'restart_protected'
        : failureState === 'export_not_ready'
          ? 'reporting_only'
          : 'local_repair';

  return {
    protocol: 'aios.compile-cache-operational-health.mailchimp.v1',
    state: failureState === 'none' ? 'healthy' : retryExhausted ? 'failed' : 'degraded',
    healthy: failureState === 'none',
    degraded: failureState !== 'none' && !retryExhausted,
    failed: retryExhausted,
    degradedMode,
    failureState,
    retryable: failureState !== 'none' && !retryExhausted,
    nextAction: nextAction || 'observe',
    blockedReasons,
    retry: {
      attempts,
      maxAttempts,
      retryAfterMs,
      exhausted: retryExhausted,
      mode: retryAfterMs > 0 ? 'backoff' : 'immediate',
      backoff: retryAfterMs > 0 ? { mode: 'fixed', retryAfterMs } : null,
    },
    providerSync: {
      state: compactString(providerSyncCheckpoint.state || 'unknown'),
      restartSafe: providerRestartSafe,
      replayPolicy: compactString(providerSyncCheckpoint.replayPolicy || 'refresh_provider_sync_before_replay'),
      externalHandoffState: compactString(providerSyncCheckpoint.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerSyncCheckpoint.externalRequestId),
      cursorRequired: providerSyncCheckpoint.cursorRequired === true,
      cursorPresent: Boolean(providerSyncCheckpoint.cursor || providerSyncCheckpoint.cursorPresent),
      capabilitySatisfied: providerSyncCheckpoint.capabilitySatisfied !== false,
    },
    actionableErrors: blockedReasons.map((reason) => ({
      code: `mailchimp.compile_cache.${reason}`,
      severity: retryExhausted || reason === 'replay_attempt_budget_exhausted' ? 'error' : 'warning',
      reason,
      action: nextAction || COMPILE_CACHE_FAILURE_ACTIONS[failureState] || 'refresh_compile_cache',
    })),
  };
}

export function buildMailchimpCompileCachePersistedReplayState(source = {}, runtime = {}) {
  const normalized = normalizePersistedReplaySource(source, runtime);
  const providerSync = normalized.providerSyncCheckpoint || {};
  const boundaryScope = normalized.boundaryScope || {};
  const replayBarrier = normalized.replayBarrier || {};
  const uiHandoff = normalized.uiHandoff || {};
  const routeHints = uiHandoff.routeHints && typeof uiHandoff.routeHints === 'object' ? uiHandoff.routeHints : replayBarrier.route || {};
  const nextSteps = Array.isArray(uiHandoff.nextSteps) ? uiHandoff.nextSteps : [];
  const blockedReasons = stableList([
    ...(Array.isArray(uiHandoff.validationSummary?.blockedReasons) ? uiHandoff.validationSummary.blockedReasons : []),
    ...(Array.isArray(replayBarrier.blockedReasons) ? replayBarrier.blockedReasons : []),
    ...(Array.isArray(providerSync.blockedReasons) ? providerSync.blockedReasons : []),
    ...(normalized.stale ? ['stale_entry'] : []),
    ...(normalized.exportReady ? [] : ['compile_cache_export_not_ready']),
    ...(providerSync.restartSafe === false ? ['provider_sync_not_restart_safe'] : []),
    ...(boundaryScope.allowed === false ? ['tenant_boundary_not_replay_safe'] : []),
    ...(Array.isArray(boundaryScope.blockedReasons) ? boundaryScope.blockedReasons : []),
    ...(replayBarrier.open === false ? ['compile_cache_replay_barrier_closed'] : []),
    ...(replayBarrier.retry?.exhausted === true ? ['replay_attempt_budget_exhausted'] : []),
    ...(normalized.acceptance.required === true && normalized.acceptance.accepted !== true ? ['operator_acceptance_missing'] : []),
  ]);
  const attempts = positiveInteger(
    normalized.runtimeReplay.attempts
      ?? replayBarrier.retry?.attempts
      ?? runtime.replayAttempts,
    0,
  );
  const maxAttempts = Math.max(1, positiveInteger(
    normalized.runtimeReplay.maxAttempts
      ?? replayBarrier.retry?.maxAttempts
      ?? runtime.maxReplayAttempts,
    1,
  ));
  const retryAfterMs = positiveInteger(
    normalized.runtimeReplay.retryAfterMs
      ?? normalized.runtimeReplay.backoffMs
      ?? replayBarrier.retry?.retryAfterMs
      ?? runtime.retryAfterMs,
    0,
  );
  const attemptBudgetExhausted = attempts >= maxAttempts || replayBarrier.retry?.exhausted === true;
  const canReplay = replayBarrier.canReplayCachedDescriptor === true
    && replayBarrier.open === true
    && providerSync.restartSafe !== false
    && !normalized.stale
    && blockedReasons.length === 0
    && !attemptBudgetExhausted;
  const nextAction = canReplay
    ? normalized.replayed
      ? 'verify_cached_descriptor'
      : 'reuse_compile_cache'
    : attemptBudgetExhausted
      ? 'hold_for_operator'
      : replayBarrier.recoveryCommand
        || replayBarrier.nextAction
        || routeHints.recoveryCommand
        || routeHints.primaryAction
        || nextSteps[0]?.action
        || 'refresh_compile_cache';
  const state = canReplay
    ? 'replay_ready'
    : attemptBudgetExhausted
      ? 'retry_budget_hold'
      : normalized.acceptance.required === true && normalized.acceptance.accepted !== true
        ? 'waiting_for_acceptance'
        : providerSync.restartSafe === false
          ? 'waiting_for_provider_sync'
          : normalized.stale
            ? 'waiting_for_refresh'
            : replayBarrier.open === false
              ? 'waiting_for_replay_barrier'
              : 'persisted_hold';
  const commandKeyParts = [
    normalized.namespace,
    normalized.requestKey,
    normalized.cacheKey,
    normalized.contractHash,
    providerSync.externalRequestId || providerSync.externalHandoffState,
    nextAction,
  ];
  const commandKey = buildPersistedCommandKey(commandKeyParts);

  return {
    protocol: 'aios.compile-cache-persisted-replay-state.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    state,
    status: normalized.status,
    replayed: normalized.replayed,
    replaySafe: canReplay,
    restartSafe: canReplay || ['waiting_for_acceptance', 'persisted_hold', 'retry_budget_hold'].includes(state),
    command: {
      nextAction,
      idempotencyKey: commandKey,
      retryKey: buildPersistedCommandKey([...commandKeyParts, `attempt:${attempts}`]),
      replayKey: buildPersistedCommandKey([
        normalized.namespace,
        normalized.cacheKey,
        normalized.sourceHash,
        normalized.optionsHash,
        normalized.contractHash,
      ]),
      idempotent: Boolean(normalized.cacheKey || normalized.requestKey),
    },
    retry: {
      attempts,
      maxAttempts,
      retryAfterMs,
      exhausted: attemptBudgetExhausted,
      mode: retryAfterMs > 0 ? 'backoff' : 'immediate',
    },
    providerSync: {
      state: compactString(providerSync.state || 'stale'),
      restartSafe: providerSync.restartSafe === true,
      replayPolicy: compactString(providerSync.replayPolicy || 'refresh_provider_sync_before_replay'),
      externalHandoffState: compactString(providerSync.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerSync.externalRequestId),
      cursorRequired: providerSync.cursorRequired === true,
      cursorPresent: Boolean(providerSync.cursor || providerSync.cursorPresent),
      capabilitySatisfied: providerSync.capabilitySatisfied !== false,
      blockedReasons: stableList(providerSync.blockedReasons),
    },
    boundaryScope: {
      tenant: compactString(boundaryScope.tenant),
      scope: compactString(boundaryScope.scope || 'tenant'),
      workspace: compactString(boundaryScope.workspace),
      allowed: boundaryScope.allowed !== false,
      blockedReasons: stableList(boundaryScope.blockedReasons),
    },
    acceptance: {
      required: normalized.acceptance.required === true,
      accepted: normalized.acceptance.accepted === true || normalized.acceptance.required !== true,
      acceptedBy: compactString(normalized.acceptance.acceptedBy),
      acceptedAt: compactString(normalized.acceptance.acceptedAt),
      reason: compactString(normalized.acceptance.reason),
    },
    blockedReasons,
    recovery: {
      required: !canReplay,
      command: canReplay ? 'observe' : nextAction,
      resumeAfter: canReplay ? 'checkpoint_replay' : state,
      routeState: canReplay ? 'ready' : 'blocked',
    },
  };
}

function normalizeCompileCacheUiSource(source = {}) {
  const snapshot = source.protocol === 'aios.compile-cache-snapshot.mailchimp.v1'
    ? source
    : source.snapshot && typeof source.snapshot === 'object'
      ? source.snapshot
      : {};
  const compileCache = source.compileCache && typeof source.compileCache === 'object'
    ? source.compileCache
    : source.protocol === 'aios.compile-cache-status.mailchimp.v1'
      ? source
      : {};
  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries
    : Array.isArray(source.entries)
      ? source.entries
      : compileCache.cacheKey || compileCache.key
        ? [compileCache]
        : [];
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object'
    ? snapshot.analytics
    : compileCache.report && typeof compileCache.report === 'object'
      ? { counters: compileCache.report.counters || {}, timeline: compileCache.report.timeline || {} }
      : source.analytics && typeof source.analytics === 'object'
        ? source.analytics
        : {};
  const exportSummary = snapshot.exportSummary && typeof snapshot.exportSummary === 'object'
    ? snapshot.exportSummary
    : compileCache.report && typeof compileCache.report === 'object'
      ? compileCache.report
      : source.exportSummary && typeof source.exportSummary === 'object'
        ? source.exportSummary
        : buildMailchimpCompileCacheExportSummary({
          protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        });
  const lifecycle = snapshot.lifecycle && typeof snapshot.lifecycle === 'object'
    ? snapshot.lifecycle
    : compileCache.lifecycle && typeof compileCache.lifecycle === 'object'
      ? compileCache.lifecycle
      : source.lifecycle && typeof source.lifecycle === 'object'
        ? source.lifecycle
        : buildMailchimpCompileCacheLifecycleDecision({
          protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
          exportSummary,
        }, source.lifecycleSettings || {});
  const history = snapshot.history && typeof snapshot.history === 'object'
    ? snapshot.history
    : compileCache.history && typeof compileCache.history === 'object'
      ? compileCache.history
      : source.history && typeof source.history === 'object'
        ? source.history
        : buildMailchimpCompileCacheHistoryReport({
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        }, { now: source.now ?? snapshot.generatedAt });
  const providerSyncCheckpoint = compileCache.providerSyncCheckpoint
    || source.providerSyncCheckpoint
    || entries.find((entry) => entry.providerSyncCheckpoint)?.providerSyncCheckpoint
    || {};
  const boundaryScope = compileCache.boundaryScope
    || source.boundaryScope
    || entries.find((entry) => entry.boundaryScope)?.boundaryScope
    || {};

  return {
    namespace: compactString(snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp'),
    cacheKey: compactString(compileCache.cacheKey || compileCache.key || entries[0]?.key),
    status: compactString(compileCache.status || source.cacheStatus || (entries.length > 0 ? 'compiled' : 'uncached')),
    replayed: compileCache.replayed === true || source.replayed === true,
    stale: compileCache.stale === true || entries.some((entry) => entry.stale === true),
    ttlRemainingMs: compileCache.ttlRemainingMs ?? entries[0]?.ttlRemainingMs ?? null,
    entries,
    analytics,
    exportSummary,
    lifecycle,
    history,
    providerSyncCheckpoint,
    boundaryScope,
  };
}

export function buildMailchimpCompileCacheUiHandoff(source = {}, runtime = {}) {
  const normalized = normalizeCompileCacheUiSource(source);
  const entries = normalized.entries.map(normalizePreviewEntry);
  const counters = {
    ...(normalized.analytics.counters || {}),
    ...(normalized.exportSummary.counters || {}),
  };
  const timeline = {
    ...(normalized.analytics.timeline || {}),
    ...(normalized.exportSummary.timeline || {}),
  };
  const providerSyncCheckpoint = normalized.providerSyncCheckpoint && normalized.providerSyncCheckpoint.protocol
    ? normalized.providerSyncCheckpoint
    : buildMailchimpCompileCacheProviderSyncCheckpoint(source, runtime);
  const providerBlockedReasons = stableList(providerSyncCheckpoint.blockedReasons);
  const boundaryScope = normalized.boundaryScope && normalized.boundaryScope.protocol
    ? normalized.boundaryScope
    : normalizeBoundaryScope(normalized.boundaryScope || {});
  const boundaryBlockedReasons = stableList(boundaryScope.blockedReasons);
  const lifecycleBlockedReasons = stableList(normalized.lifecycle.validationSummary?.blockedReasons);
  const exportBlockedReasons = stableList(normalized.exportSummary.blockedReasons);
  const diagnosticEntries = entries.filter((entry) => entry.diagnostics.errors > 0).map((entry) => entry.key).filter(Boolean);
  const staleEntries = entries.filter((entry) => entry.stale).map((entry) => entry.key).filter(Boolean);
  const providerReady = providerSyncCheckpoint.restartSafe === true
    && providerSyncCheckpoint.capabilitySatisfied !== false
    && providerBlockedReasons.length === 0;
  const boundaryReady = boundaryScope.allowed !== false && boundaryBlockedReasons.length === 0;
  const exportReady = normalized.exportSummary.exportReady === true
    && staleEntries.length === 0
    && diagnosticEntries.length === 0;
  const lifecycleReady = normalized.lifecycle.blocked !== true
    && normalized.lifecycle.refreshRecommended !== true;
  const acceptedBy = compactString(runtime.acceptance?.acceptedBy || runtime.operatorAcceptance?.acceptedBy);
  const acceptedAt = compactString(runtime.acceptance?.acceptedAt || runtime.operatorAcceptance?.acceptedAt);
  const acceptanceRequired = normalized.lifecycle.blocked === true
    || lifecycleBlockedReasons.includes('operator_hold')
    || providerSyncCheckpoint.restartSafe === false
    || exportReady === false;
  const accepted = runtime.acceptance?.accepted === true
    || runtime.operatorAcceptance?.accepted === true
    || Boolean(acceptedBy && acceptedAt);
  const ready = providerReady && boundaryReady && exportReady && lifecycleReady && (!acceptanceRequired || accepted);
  const nextSteps = [
    ...(boundaryReady ? [] : [{
      action: 'repair_tenant_permissions',
      reason: boundaryBlockedReasons[0] || 'tenant_boundary_not_replay_safe',
      owner: 'operator',
    }]),
    ...(providerReady ? [] : [{
      action: providerSyncCheckpoint.replayPolicy || 'refresh_provider_sync_before_replay',
      reason: providerBlockedReasons[0] || 'provider_sync_checkpoint_not_restart_safe',
      owner: 'provider',
    }]),
    ...(staleEntries.length > 0 ? [{
      action: 'refresh_compile_cache',
      reason: 'stale_entries',
      owner: 'compiler',
    }] : []),
    ...(diagnosticEntries.length > 0 ? [{
      action: 'repair_cached_descriptor',
      reason: 'diagnostic_errors',
      owner: 'compiler',
    }] : []),
    ...(!exportReady && staleEntries.length === 0 && diagnosticEntries.length === 0 ? [{
      action: 'review_compile_cache_export',
      reason: exportBlockedReasons[0] || 'export_not_ready',
      owner: 'operator',
    }] : []),
    ...(!lifecycleReady ? [{
      action: normalized.lifecycle.nextAction || 'review_compile_cache_lifecycle',
      reason: lifecycleBlockedReasons[0] || 'lifecycle_refresh_recommended',
      owner: normalized.lifecycle.controls?.operatorHold ? 'operator' : 'compiler',
    }] : []),
    ...(acceptanceRequired && !accepted ? [{
      action: 'request_compile_cache_acceptance',
      reason: 'operator_acceptance_required',
      owner: 'operator',
    }] : []),
  ];

  if (nextSteps.length === 0) {
    nextSteps.push({
      action: normalized.replayed ? 'verify_cached_descriptor' : 'reuse_compile_cache',
      reason: 'ready',
      owner: 'runtime',
    });
  }
  const replayBarrier = buildMailchimpCompileCacheReplayBarrier({
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    replayed: normalized.replayed,
    providerSyncCheckpoint,
    uiHandoff: {
      cacheKey: normalized.cacheKey,
      status: normalized.status,
      replayed: normalized.replayed,
      readiness: {
        ready,
        cacheReady: exportReady && lifecycleReady,
        providerReady,
        boundaryReady,
        exportReady,
        lifecycleReady,
        nextStep: nextSteps[0]?.action || 'reuse_compile_cache',
      },
      acceptance: {
        required: acceptanceRequired,
        accepted: !acceptanceRequired || accepted,
        acceptedBy,
        acceptedAt,
        reason: acceptanceRequired
          ? providerSyncCheckpoint.restartSafe === false
            ? 'Provider sync checkpoint must be accepted or refreshed before replay.'
            : exportReady === false
              ? 'Compile cache export needs review before user-visible handoff.'
              : 'Compile cache lifecycle requires operator acceptance.'
          : '',
      },
      validationSummary: {
        blockedReasons: stableList([
          ...providerBlockedReasons,
          ...boundaryBlockedReasons,
          ...lifecycleBlockedReasons,
          ...exportBlockedReasons,
          ...(providerReady ? [] : ['provider_sync_not_ready']),
          ...(boundaryReady ? [] : ['tenant_boundary_not_ready']),
          ...(exportReady ? [] : ['compile_cache_export_not_ready']),
          ...(lifecycleReady ? [] : ['compile_cache_lifecycle_not_ready']),
          ...(acceptanceRequired && !accepted ? ['operator_acceptance_missing'] : []),
        ]),
      },
      routeHints: {
        primaryAction: nextSteps[0]?.action || 'reuse_compile_cache',
        recoveryCommand: ready
          ? 'observe'
          : nextSteps[0]?.action === 'request_compile_cache_acceptance'
            ? 'hold_for_operator'
            : nextSteps[0]?.action || 'refresh_compile_cache',
        statusRouteState: ready ? 'ready' : 'needs_attention',
      },
    },
  }, runtime);

  return {
    protocol: 'aios.compile-cache-ui-handoff.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    replayed: normalized.replayed,
    preview: {
      title: `Mailchimp compile cache ${normalized.status || 'status'}`,
      cacheKey: normalized.cacheKey,
      namespace: normalized.namespace,
      entries: entries.slice(0, 5),
      totalEntries: positiveInteger(counters.entries, entries.length),
      staleEntries: positiveInteger(counters.staleEntries, staleEntries.length),
      errorEntries: positiveInteger(counters.errorEntries, diagnosticEntries.length),
      hitRate: normalized.analytics.ratios?.hitRate ?? normalized.exportSummary.ratios?.hitRate ?? null,
      latestAt: timeline.latestAt ?? null,
      latestKind: compactString(timeline.latestKind),
      latestStatus: compactString(timeline.latestStatus),
      reportingState: compactString(normalized.history.reportingState?.state),
      reportingNextAction: compactString(normalized.history.reportingState?.nextAction),
      historySnapshotCount: positiveInteger(normalized.history.timeline?.snapshotCount, 0),
      providerSync: {
        state: compactString(providerSyncCheckpoint.state || 'stale'),
        restartSafe: providerSyncCheckpoint.restartSafe === true,
        replayPolicy: compactString(providerSyncCheckpoint.replayPolicy),
        externalHandoffState: compactString(providerSyncCheckpoint.externalHandoffState || 'local_only'),
        externalRequestId: compactString(providerSyncCheckpoint.externalRequestId),
        cursorRequired: providerSyncCheckpoint.cursorRequired === true,
        cursorPresent: Boolean(providerSyncCheckpoint.cursor),
        capabilitySatisfied: providerSyncCheckpoint.capabilitySatisfied !== false,
      },
      boundaryScope: {
        tenant: boundaryScope.tenant,
        scope: boundaryScope.scope,
        workspace: boundaryScope.workspace,
        allowed: boundaryScope.allowed !== false,
        auditDecision: compactString(boundaryScope.audit?.decision),
        blockedReasons: boundaryBlockedReasons,
      },
    },
    readiness: {
      ready,
      cacheReady: exportReady && lifecycleReady,
      providerReady,
      boundaryReady,
      exportReady,
      lifecycleReady,
      nextStep: nextSteps[0]?.action || 'reuse_compile_cache',
    },
    lifecycleExecution: {
      state: compactString(normalized.lifecycle.executionPlan?.state || (lifecycleReady ? 'ready' : 'blocked')),
      executable: normalized.lifecycle.executionPlan?.executable === true,
      command: compactString(normalized.lifecycle.command),
      candidateCommand: compactString(normalized.lifecycle.executionPlan?.candidateCommand || normalized.lifecycle.command),
      nextAction: compactString(normalized.lifecycle.nextAction),
      scheduleMode: compactString(normalized.lifecycle.schedule?.mode || normalized.lifecycle.executionPlan?.schedule?.mode),
      scheduleDue: normalized.lifecycle.executionPlan?.schedule?.due !== false,
      nextEligibleAt: normalized.lifecycle.executionPlan?.schedule?.nextEligibleAt ?? null,
      delayMs: positiveInteger(normalized.lifecycle.executionPlan?.schedule?.delayMs, 0),
      deferredReasons: stableList(normalized.lifecycle.executionPlan?.deferredReasons),
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: !acceptanceRequired || accepted,
      acceptedBy,
      acceptedAt,
      reason: acceptanceRequired
        ? providerSyncCheckpoint.restartSafe === false
          ? 'Provider sync checkpoint must be accepted or refreshed before replay.'
          : exportReady === false
            ? 'Compile cache export needs review before user-visible handoff.'
            : 'Compile cache lifecycle requires operator acceptance.'
        : '',
    },
    validationSummary: {
      ready,
      blockedReasons: stableList([
        ...providerBlockedReasons,
        ...boundaryBlockedReasons,
        ...lifecycleBlockedReasons,
        ...exportBlockedReasons,
        ...(providerReady ? [] : ['provider_sync_not_ready']),
        ...(boundaryReady ? [] : ['tenant_boundary_not_ready']),
        ...(exportReady ? [] : ['compile_cache_export_not_ready']),
        ...(lifecycleReady ? [] : ['compile_cache_lifecycle_not_ready']),
        ...(acceptanceRequired && !accepted ? ['operator_acceptance_missing'] : []),
      ]),
      counters: {
        entries: positiveInteger(counters.entries, entries.length),
        staleEntries: staleEntries.length || positiveInteger(counters.staleEntries, 0),
        diagnosticEntries: diagnosticEntries.length || positiveInteger(counters.errorEntries, 0),
        lookupEvents: positiveInteger(counters.lookupEvents, 0),
        hitEvents: positiveInteger(counters.hitEvents, 0),
        missEvents: positiveInteger(counters.missEvents, 0),
      },
    },
    nextSteps,
    routeHints: {
      primaryAction: replayBarrier.route.primaryAction,
      statusRouteState: replayBarrier.route.statusRouteState,
      recoveryCommand: replayBarrier.recoveryCommand,
      canReplayCachedDescriptor: replayBarrier.canReplayCachedDescriptor,
    },
    replayBarrier,
  };
}

export function buildMailchimpCompileCacheLifecycleDecision(snapshot = {}, settings = {}) {
  const now = nowFrom(settings);
  const normalizedSnapshot = normalizeSnapshotForLifecycle(snapshot, now);
  const lifecycle = normalizeCacheLifecycleSettings(settings.lifecycle || settings.lifecycleSettings || settings);
  const diagnostics = validateCacheLifecycleSettings(lifecycle, normalizedSnapshot);
  const entries = normalizedSnapshot.entries;
  const staleEntries = entries.filter((entry) => entry.stale).map((entry) => entry.key).sort();
  const expiredEntries = entries
    .filter((entry) => entry.expiresAt != null && now >= entry.expiresAt)
    .map((entry) => entry.key)
    .sort();
  const diagnosticEntries = entries
    .filter((entry) => (entry.diagnostics?.errors || 0) > 0)
    .map((entry) => entry.key)
    .sort();
  const exportReady = normalizedSnapshot.exportSummary.exportReady === true
    && staleEntries.length === 0
    && diagnosticEntries.length === 0;
  const metrics = {
    staleEntries,
    expiredEntries,
    diagnosticEntries,
    exportReady,
  };
  const executionPlan = buildLifecycleExecutionPlan({
    lifecycle,
    snapshot: normalizedSnapshot,
    diagnostics,
    metrics,
    now,
  });
  const blocked = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    || lifecycle.enabled === false
    || lifecycle.controls.operatorHold === true
    || (lifecycle.command === 'export' && lifecycle.controls.requireCleanExport && !exportReady);
  const refreshRecommended = staleEntries.length > 0
    || expiredEntries.length > 0
    || diagnosticEntries.length > 0
    || exportReady === false;
  const nextAction = blocked
    ? lifecycle.controls.operatorHold
      ? 'await_compile_cache_operator_release'
      : lifecycle.enabled === false
        ? 'enable_compile_cache_lifecycle'
        : diagnostics.some((diagnostic) => diagnostic.severity === 'error')
          ? 'repair_compile_cache_lifecycle_settings'
          : 'review_compile_cache_export'
    : executionPlan.state === 'deferred'
      ? executionPlan.nextAction
    : executionPlan.candidateCommand !== 'observe'
      ? executionPlan.commandAction
    : lifecycle.command === 'hold'
      ? 'hold_compile_cache'
      : lifecycle.command === 'disable'
        ? 'disable_compile_cache_lifecycle'
        : lifecycle.command === 'enable'
          ? 'enable_compile_cache_lifecycle'
          : refreshRecommended && lifecycle.controls.allowRefresh
            ? 'refresh_compile_cache'
            : lifecycle.command === 'evict_stale' && lifecycle.controls.allowEvictStale
              ? 'evict_stale_compile_cache_entries'
              : lifecycle.command === 'export' && lifecycle.controls.allowExport
                ? 'export_compile_cache_summary'
                : 'reuse_compile_cache';

  return {
    protocol: 'aios.compile-cache-lifecycle.mailchimp.v1',
    namespace: normalizedSnapshot.namespace,
    enabled: lifecycle.enabled,
    command: lifecycle.command,
    nextAction,
    blocked,
    refreshRecommended,
    exportReady,
    schedule: {
      ...lifecycle.schedule,
      nextRunAt: lifecycle.schedule.runAt || null,
      scheduledAt: executionPlan.schedule.scheduledAt,
      due: executionPlan.schedule.due,
      nextEligibleAt: executionPlan.schedule.nextEligibleAt,
      delayMs: executionPlan.schedule.delayMs,
      cooldown: executionPlan.cooldown,
    },
    executionPlan,
    controls: {
      ...lifecycle.controls,
      canEnable: true,
      canDisable: lifecycle.enabled === true,
      canRefresh: !blocked && executionPlan.executable && lifecycle.controls.allowRefresh,
      canEvictStale: !blocked && executionPlan.executable && lifecycle.controls.allowEvictStale && staleEntries.length > 0,
      canExport: !blocked && executionPlan.executable && lifecycle.controls.allowExport && exportReady,
      canRunNow: !blocked && executionPlan.executable,
      deferred: executionPlan.state === 'deferred',
    },
    validationSummary: {
      totalEntries: entries.length,
      staleEntries: staleEntries.length,
      expiredEntries: expiredEntries.length,
      diagnosticEntries: diagnosticEntries.length,
      diagnostics: diagnostics.length,
      blockedReasons: [
        ...(lifecycle.enabled === false ? ['lifecycle_disabled'] : []),
        ...(lifecycle.controls.operatorHold ? ['operator_hold'] : []),
        ...(staleEntries.length > 0 ? ['stale_entries'] : []),
        ...(expiredEntries.length > 0 ? ['expired_entries'] : []),
        ...(diagnosticEntries.length > 0 ? ['diagnostic_errors'] : []),
        ...executionPlan.blockedReasons,
        ...executionPlan.deferredReasons,
        ...diagnostics.map((diagnostic) => diagnostic.code),
      ].sort(),
    },
    diagnostics,
    staleEntryKeys: staleEntries,
    expiredEntryKeys: expiredEntries,
    diagnosticEntryKeys: diagnosticEntries,
  };
}

function buildCacheAnalytics(entries, events, now) {
  const summaries = entries.map((entry) => summarizeEntry(entry, now));
  const timeline = summarizeCacheTimeline(events);
  const hitEvents = timeline.eventsByStatus.hit || 0;
  const missEvents = timeline.eventsByStatus.miss || 0;
  const lookupEvents = hitEvents + missEvents;
  const staleEntries = summaries.filter((entry) => entry.stale).length;
  const expiredEntries = entries.filter((entry) => isExpired(entry, now)).length;
  const diagnosticTotals = summaries.reduce((totals, entry) => {
    totals.errors += entry.diagnostics.errors || 0;
    totals.warnings += entry.diagnostics.warnings || 0;
    totals.total += entry.diagnostics.total || 0;
    return totals;
  }, { errors: 0, warnings: 0, total: 0 });

  return {
    protocol: 'aios.compile-cache-analytics.mailchimp.v1',
    counters: {
      entries: summaries.length,
      staleEntries,
      expiredEntries,
      totalEntryHits: summaries.reduce((total, entry) => total + entry.hits, 0),
      lookupEvents,
      hitEvents,
      missEvents,
      storeEvents: timeline.eventsByKind.store || 0,
      evictionEvents: timeline.eventsByKind.evict || 0,
      invalidationEvents: timeline.eventsByKind.invalidate || 0,
      diagnosticErrors: diagnosticTotals.errors,
      diagnosticWarnings: diagnosticTotals.warnings,
      diagnosticsTotal: diagnosticTotals.total,
    },
    ratios: {
      hitRate: lookupEvents === 0 ? null : Number((hitEvents / lookupEvents).toFixed(4)),
      staleEntryRate: summaries.length === 0 ? 0 : Number((staleEntries / summaries.length).toFixed(4)),
    },
    timeline: {
      totalEvents: timeline.totalEvents,
      firstAt: timeline.firstAt,
      latestAt: timeline.latestAt,
      latestKind: timeline.latestKind,
      latestStatus: timeline.latestStatus,
      eventsByKind: timeline.eventsByKind,
      eventsByStatus: timeline.eventsByStatus,
    },
  };
}

export function buildMailchimpCompileCacheExportSummary(snapshot = {}) {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const analytics = snapshot.analytics || {};
  const history = snapshot.history && typeof snapshot.history === 'object'
    ? snapshot.history
    : buildMailchimpCompileCacheHistoryReport(snapshot, { now: snapshot.now ?? snapshot.generatedAt });
  const counters = analytics.counters || {};
  const staleEntries = entries.filter((entry) => entry.stale).map((entry) => entry.key).sort();
  const errorEntries = entries
    .filter((entry) => (entry.diagnostics?.errors || 0) > 0)
    .map((entry) => entry.key)
    .sort();
  const boundaryBlockedEntries = entries
    .filter((entry) => entry.boundaryScope?.allowed === false || entry.boundaryScope?.blockedReasons?.length > 0)
    .map((entry) => entry.key)
    .sort();
  const exportReady = staleEntries.length === 0 && errorEntries.length === 0 && boundaryBlockedEntries.length === 0;

  return {
    protocol: 'aios.compile-cache-export.mailchimp.v1',
    namespace: compactString(snapshot.namespace || 'mailchimp'),
    generatedFrom: snapshot.protocol || 'aios.compile-cache-snapshot.mailchimp.v1',
    exportReady,
    blockedReasons: [
      ...(staleEntries.length > 0 ? ['stale_entries'] : []),
      ...(errorEntries.length > 0 ? ['diagnostic_errors'] : []),
      ...(boundaryBlockedEntries.length > 0 ? ['tenant_boundary_blocked'] : []),
    ],
    counters: {
      entries: entries.length,
      staleEntries: staleEntries.length,
      errorEntries: errorEntries.length,
      boundaryBlockedEntries: boundaryBlockedEntries.length,
      totalEntryHits: counters.totalEntryHits || 0,
      lookupEvents: counters.lookupEvents || 0,
      hitEvents: counters.hitEvents || 0,
      missEvents: counters.missEvents || 0,
      storeEvents: counters.storeEvents || 0,
      evictionEvents: counters.evictionEvents || 0,
      invalidationEvents: counters.invalidationEvents || 0,
      providerBlockedEntries: history.counters?.providerBlockedEntries || 0,
      boundaryBlockedEntries: boundaryBlockedEntries.length || history.counters?.boundaryBlockedEntries || 0,
    },
    timeline: {
      latestAt: history.timeline?.latestAt ?? analytics.timeline?.latestAt ?? null,
      latestKind: history.timeline?.latestKind || analytics.timeline?.latestKind || null,
      latestStatus: history.timeline?.latestStatus || analytics.timeline?.latestStatus || null,
      totalEvents: history.timeline?.totalEvents || analytics.timeline?.totalEvents || 0,
      snapshotCount: history.timeline?.snapshotCount || 0,
    },
    reportingState: {
      state: compactString(history.reportingState?.state || (exportReady ? 'export_ready' : 'needs_attention')),
      nextAction: compactString(history.reportingState?.nextAction || (exportReady ? 'deliver_compile_cache_export' : 'review_compile_cache_export')),
      hasLookupTraffic: history.reportingState?.hasLookupTraffic === true,
      hasFailures: history.reportingState?.hasFailures === true || !exportReady,
    },
    entries: entries.map((entry) => ({
      key: entry.key,
      requestKey: entry.requestKey,
      stale: entry.stale,
      hits: entry.hits,
      diagnostics: entry.diagnostics,
      ttlRemainingMs: entry.ttlRemainingMs,
      providerSyncCheckpoint: entry.providerSyncCheckpoint || null,
      boundaryScope: entry.boundaryScope || null,
    })),
  };
}

function normalizeExportPackageSource(source = {}) {
  const snapshot = source.protocol === 'aios.compile-cache-snapshot.mailchimp.v1'
    ? source
    : source.snapshot && typeof source.snapshot === 'object'
      ? source.snapshot
      : {};
  const compileCache = source.compileCache && typeof source.compileCache === 'object'
    ? source.compileCache
    : source.protocol === 'aios.compile-cache-status.mailchimp.v1'
      ? source
      : {};
  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries
    : Array.isArray(source.entries)
      ? source.entries
      : compileCache.cacheKey || compileCache.key
        ? [compileCache]
        : [];
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object'
    ? snapshot.analytics
    : compileCache.analytics && typeof compileCache.analytics === 'object'
      ? compileCache.analytics
      : source.analytics && typeof source.analytics === 'object'
        ? source.analytics
        : {};
  const exportSummary = snapshot.exportSummary && typeof snapshot.exportSummary === 'object'
    ? snapshot.exportSummary
    : compileCache.exportSummary && typeof compileCache.exportSummary === 'object'
      ? compileCache.exportSummary
      : source.exportSummary && typeof source.exportSummary === 'object'
        ? source.exportSummary
        : buildMailchimpCompileCacheExportSummary({
          protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        });
  const uiHandoff = compileCache.uiHandoff && typeof compileCache.uiHandoff === 'object'
    ? compileCache.uiHandoff
    : source.uiHandoff && typeof source.uiHandoff === 'object'
      ? source.uiHandoff
      : {};
  const lifecycle = snapshot.lifecycle && typeof snapshot.lifecycle === 'object'
    ? snapshot.lifecycle
    : compileCache.lifecycle && typeof compileCache.lifecycle === 'object'
      ? compileCache.lifecycle
      : source.lifecycle && typeof source.lifecycle === 'object'
        ? source.lifecycle
        : {};
  const history = snapshot.history && typeof snapshot.history === 'object'
    ? snapshot.history
    : compileCache.history && typeof compileCache.history === 'object'
      ? compileCache.history
      : source.history && typeof source.history === 'object'
        ? source.history
        : buildMailchimpCompileCacheHistoryReport({
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        }, { now: source.now ?? snapshot.generatedAt });

  return {
    namespace: compactString(snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp'),
    cacheKey: compactString(compileCache.cacheKey || compileCache.key || entries[0]?.key),
    status: compactString(compileCache.status || source.status || (entries.length > 0 ? 'compiled' : 'uncached')),
    replayed: compileCache.replayed === true || source.replayed === true,
    entries,
    analytics,
    exportSummary,
    history,
    uiHandoff,
    lifecycle,
  };
}

export function buildMailchimpCompileCacheExportPackage(source = {}, options = {}) {
  const normalized = normalizeExportPackageSource(source);
  const entries = normalized.entries.map(normalizePreviewEntry);
  const counters = {
    ...(normalized.analytics.counters || {}),
    ...(normalized.exportSummary.counters || {}),
    ...(normalized.history.counters || {}),
  };
  const timeline = summarizeCacheTimeline(
    Array.isArray(normalized.history.events)
      ? normalized.history.events
      : Array.isArray(normalized.history.timeline?.events)
        ? normalized.history.timeline.events
        : [],
  );
  const summaryTimeline = {
    ...(normalized.analytics.timeline || {}),
    ...(normalized.exportSummary.timeline || {}),
    ...(normalized.history.timeline || {}),
  };
  const acceptedBy = compactString(options.acceptance?.acceptedBy || normalized.uiHandoff.acceptance?.acceptedBy);
  const acceptedAt = compactString(options.acceptance?.acceptedAt || normalized.uiHandoff.acceptance?.acceptedAt);
  const acceptanceRequired = normalized.uiHandoff.acceptance?.required === true
    || normalized.exportSummary.exportReady === false
    || normalized.lifecycle.blocked === true;
  const accepted = options.acceptance?.accepted === true
    || normalized.uiHandoff.acceptance?.accepted === true
    || (!acceptanceRequired && normalized.uiHandoff.acceptance?.accepted !== false)
    || Boolean(acceptedBy && acceptedAt);
  const providerBlockedEntries = entries
    .filter((entry) => entry.providerSync.restartSafe !== true || entry.providerSync.blockedReasons.length > 0)
    .map((entry) => entry.key)
    .filter(Boolean)
    .sort();
  const boundaryBlockedEntries = entries
    .filter((entry) => entry.boundaryScope.allowed === false || entry.boundaryScope.blockedReasons.length > 0)
    .map((entry) => entry.key)
    .filter(Boolean)
    .sort();
  const staleEntries = entries.filter((entry) => entry.stale).map((entry) => entry.key).filter(Boolean).sort();
  const diagnosticEntries = entries
    .filter((entry) => entry.diagnostics.errors > 0)
    .map((entry) => entry.key)
    .filter(Boolean)
    .sort();
  const blockedReasons = stableList([
    ...(Array.isArray(normalized.exportSummary.blockedReasons) ? normalized.exportSummary.blockedReasons : []),
    ...(staleEntries.length > 0 ? ['stale_entries'] : []),
    ...(diagnosticEntries.length > 0 ? ['diagnostic_errors'] : []),
    ...(providerBlockedEntries.length > 0 ? ['provider_sync_not_restart_safe'] : []),
    ...(boundaryBlockedEntries.length > 0 ? ['tenant_boundary_blocked'] : []),
    ...(normalized.lifecycle.blocked === true ? ['compile_cache_lifecycle_blocked'] : []),
    ...(acceptanceRequired && !accepted ? ['operator_acceptance_missing'] : []),
  ]);
  const exportReady = normalized.exportSummary.exportReady === true
    && blockedReasons.length === 0
    && (!acceptanceRequired || accepted);
  const latestAt = summaryTimeline.latestAt ?? timeline.latestAt ?? null;
  const latestKind = compactString(summaryTimeline.latestKind || timeline.latestKind);
  const latestStatus = compactString(summaryTimeline.latestStatus || timeline.latestStatus);
  const packageIdParts = stableList([
    normalized.namespace,
    normalized.cacheKey,
    latestAt == null ? '' : `latest:${latestAt}`,
    `entries:${entries.length}`,
    `blocked:${blockedReasons.join('|')}`,
  ]);

  return {
    protocol: 'aios.compile-cache-export-package.mailchimp.v1',
    namespace: normalized.namespace,
    packageId: packageIdParts.join(':') || `${normalized.namespace}:empty`,
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    replayed: normalized.replayed,
    exportReady,
    format: 'json',
    redaction: 'descriptor-metadata',
    includesPayload: false,
    blockedReasons,
    nextAction: exportReady
      ? 'deliver_compile_cache_export'
      : acceptanceRequired && !accepted
        ? 'request_compile_cache_acceptance'
        : providerBlockedEntries.length > 0
          ? 'refresh_provider_sync_before_replay'
          : staleEntries.length > 0
            ? 'refresh_compile_cache'
            : diagnosticEntries.length > 0
              ? 'repair_cached_descriptor'
              : normalized.lifecycle.nextAction || 'review_compile_cache_export',
    counters: {
      entries: positiveInteger(counters.entries, entries.length),
      staleEntries: staleEntries.length || positiveInteger(counters.staleEntries, 0),
      diagnosticEntries: diagnosticEntries.length || positiveInteger(counters.errorEntries, 0),
      providerBlockedEntries: providerBlockedEntries.length,
      boundaryBlockedEntries: boundaryBlockedEntries.length,
      totalEntryHits: positiveInteger(counters.totalEntryHits, 0),
      lookupEvents: positiveInteger(counters.lookupEvents, 0),
      hitEvents: positiveInteger(counters.hitEvents, 0),
      missEvents: positiveInteger(counters.missEvents, 0),
      storeEvents: positiveInteger(counters.storeEvents, 0),
      evictionEvents: positiveInteger(counters.evictionEvents, 0),
      invalidationEvents: positiveInteger(counters.invalidationEvents, 0),
      historySnapshots: positiveInteger(normalized.history.timeline?.snapshotCount, normalized.history.snapshots?.length || 0),
    },
    timeline: {
      totalEvents: positiveInteger(summaryTimeline.totalEvents, timeline.totalEvents),
      firstAt: summaryTimeline.firstAt ?? timeline.firstAt ?? null,
      latestAt,
      latestKind,
      latestStatus,
      eventsByKind: timeline.eventsByKind,
      eventsByStatus: timeline.eventsByStatus,
      historySnapshotCount: positiveInteger(normalized.history.timeline?.snapshotCount, timeline.totalEvents),
    },
    reporting: {
      state: compactString(normalized.history.reportingState?.state || normalized.exportSummary.reportingState?.state || (exportReady ? 'export_ready' : 'needs_attention')),
      nextAction: compactString(normalized.history.reportingState?.nextAction || normalized.exportSummary.reportingState?.nextAction),
      exportReady: normalized.history.exportReady === true || exportReady,
      latestSnapshot: normalized.history.snapshots?.at(-1) || null,
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: !acceptanceRequired || accepted,
      acceptedBy,
      acceptedAt,
      reason: compactString(options.acceptance?.reason || normalized.uiHandoff.acceptance?.reason),
    },
    manifests: {
      entries: entries.map((entry) => ({
        key: entry.key,
        requestKey: entry.requestKey,
        sourceHash: entry.sourceHash,
        contractHash: entry.contractHash,
        stale: entry.stale,
        ttlRemainingMs: entry.ttlRemainingMs,
        hits: entry.hits,
        diagnostics: entry.diagnostics,
        providerSync: entry.providerSync,
        boundaryScope: entry.boundaryScope,
      })),
      staleEntryKeys: staleEntries,
      diagnosticEntryKeys: diagnosticEntries,
      providerBlockedEntryKeys: providerBlockedEntries,
      boundaryBlockedEntryKeys: boundaryBlockedEntries,
    },
  };
}

function normalizeStatusHandoffSource(source = {}) {
  const snapshot = source.protocol === 'aios.compile-cache-snapshot.mailchimp.v1'
    ? source
    : source.snapshot && typeof source.snapshot === 'object'
      ? source.snapshot
      : {};
  const compileCache = source.compileCache && typeof source.compileCache === 'object'
    ? source.compileCache
    : source.protocol === 'aios.compile-cache-status.mailchimp.v1'
      ? source
      : {};
  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries
    : Array.isArray(source.entries)
      ? source.entries
      : compileCache.cacheKey || compileCache.key
        ? [compileCache]
        : [];
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object'
    ? snapshot.analytics
    : compileCache.analytics && typeof compileCache.analytics === 'object'
      ? compileCache.analytics
      : source.analytics && typeof source.analytics === 'object'
        ? source.analytics
        : {};
  const exportSummary = snapshot.exportSummary && typeof snapshot.exportSummary === 'object'
    ? snapshot.exportSummary
    : compileCache.exportSummary && typeof compileCache.exportSummary === 'object'
      ? compileCache.exportSummary
      : source.exportSummary && typeof source.exportSummary === 'object'
        ? source.exportSummary
        : buildMailchimpCompileCacheExportSummary({
          protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        });
  const lifecycle = snapshot.lifecycle && typeof snapshot.lifecycle === 'object'
    ? snapshot.lifecycle
    : compileCache.lifecycle && typeof compileCache.lifecycle === 'object'
      ? compileCache.lifecycle
      : source.lifecycle && typeof source.lifecycle === 'object'
        ? source.lifecycle
        : {};
  const history = snapshot.history && typeof snapshot.history === 'object'
    ? snapshot.history
    : compileCache.history && typeof compileCache.history === 'object'
      ? compileCache.history
      : source.history && typeof source.history === 'object'
        ? source.history
        : buildMailchimpCompileCacheHistoryReport({
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        }, { now: source.now ?? snapshot.generatedAt });

  return {
    namespace: compactString(snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp'),
    cacheKey: compactString(compileCache.cacheKey || compileCache.key || entries[0]?.key),
    requestKey: compactString(compileCache.requestKey || compileCache.identity?.requestKey || source.requestKey),
    status: compactString(compileCache.status || source.status || (entries.length > 0 ? 'compiled' : 'uncached')),
    replayed: compileCache.replayed === true || source.replayed === true,
    stale: compileCache.stale === true || entries.some((entry) => entry.stale === true),
    sourceHash: compactString(compileCache.sourceHash || compileCache.identity?.sourceHash || source.sourceHash),
    optionsHash: compactString(compileCache.optionsHash || compileCache.identity?.optionsHash || source.optionsHash),
    contractHash: compactString(compileCache.contractHash || compileCache.identity?.contractHash || source.contractHash),
    ttlRemainingMs: compileCache.ttlRemainingMs ?? entries[0]?.ttlRemainingMs ?? null,
    entries,
    analytics,
    exportSummary,
    history,
    exportPackage: compileCache.exportPackage || source.exportPackage || null,
    lifecycle,
    uiHandoff: compileCache.uiHandoff || source.uiHandoff || null,
    replayBarrier: compileCache.replayBarrier || source.replayBarrier || null,
    persistedReplayState: compileCache.persistedReplayState || source.persistedReplayState || null,
    operationalHealth: compileCache.operationalHealth || source.operationalHealth || null,
    providerSyncCheckpoint: compileCache.providerSyncCheckpoint
      || source.providerSyncCheckpoint
      || entries.find((entry) => entry.providerSyncCheckpoint)?.providerSyncCheckpoint
      || {},
    boundaryScope: compileCache.boundaryScope
      || source.boundaryScope
      || entries.find((entry) => entry.boundaryScope)?.boundaryScope
      || {},
  };
}

export function buildMailchimpCompileCacheStatusHandoff(source = {}, runtime = {}) {
  const normalized = normalizeStatusHandoffSource(source);
  const baseSource = {
    protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
    namespace: normalized.namespace,
    entries: normalized.entries,
    analytics: normalized.analytics,
    exportSummary: normalized.exportSummary,
    history: normalized.history,
    lifecycle: normalized.lifecycle,
    compileCache: {
      cacheKey: normalized.cacheKey,
      requestKey: normalized.requestKey,
      status: normalized.status,
      replayed: normalized.replayed,
      stale: normalized.stale,
      sourceHash: normalized.sourceHash,
      optionsHash: normalized.optionsHash,
      contractHash: normalized.contractHash,
      ttlRemainingMs: normalized.ttlRemainingMs,
      providerSyncCheckpoint: normalized.providerSyncCheckpoint,
      boundaryScope: normalized.boundaryScope,
    },
  };
  const uiHandoff = normalized.uiHandoff && normalized.uiHandoff.protocol === 'aios.compile-cache-ui-handoff.mailchimp.v1'
    ? normalized.uiHandoff
    : buildMailchimpCompileCacheUiHandoff(baseSource, runtime);
  const replayBarrier = normalized.replayBarrier && normalized.replayBarrier.protocol === 'aios.compile-cache-replay-barrier.mailchimp.v1'
    ? normalized.replayBarrier
    : uiHandoff.replayBarrier || buildMailchimpCompileCacheReplayBarrier({
      cacheKey: normalized.cacheKey,
      status: normalized.status,
      replayed: normalized.replayed,
      providerSyncCheckpoint: normalized.providerSyncCheckpoint,
      boundaryScope: normalized.boundaryScope,
      uiHandoff,
    }, runtime);
  const persistedReplayState = normalized.persistedReplayState
    && normalized.persistedReplayState.protocol === 'aios.compile-cache-persisted-replay-state.mailchimp.v1'
    ? normalized.persistedReplayState
    : buildMailchimpCompileCachePersistedReplayState({
      ...baseSource,
      compileCache: {
        ...baseSource.compileCache,
        uiHandoff,
        replayBarrier,
        report: normalized.exportSummary,
        exportReady: normalized.exportSummary.exportReady,
      },
    }, runtime);
  const operationalHealth = normalized.operationalHealth
    && normalized.operationalHealth.protocol === 'aios.compile-cache-operational-health.mailchimp.v1'
    ? normalized.operationalHealth
    : buildMailchimpCompileCacheOperationalHealthReport({
      stale: normalized.stale,
      providerSyncCheckpoint: normalized.providerSyncCheckpoint,
      report: normalized.exportSummary,
      lifecycleDecision: normalized.lifecycle,
      replayBarrier,
      persistedReplaySummary: persistedReplayState,
    }, runtime);
  const exportPackage = normalized.exportPackage
    && normalized.exportPackage.protocol === 'aios.compile-cache-export-package.mailchimp.v1'
    ? normalized.exportPackage
    : buildMailchimpCompileCacheExportPackage({
      ...baseSource,
      compileCache: {
        ...baseSource.compileCache,
        uiHandoff,
        lifecycle: normalized.lifecycle,
        exportSummary: normalized.exportSummary,
      },
    }, runtime);
  const blockedReasons = stableList([
    ...(Array.isArray(uiHandoff.validationSummary?.blockedReasons) ? uiHandoff.validationSummary.blockedReasons : []),
    ...(Array.isArray(replayBarrier.blockedReasons) ? replayBarrier.blockedReasons : []),
    ...(Array.isArray(persistedReplayState.blockedReasons) ? persistedReplayState.blockedReasons : []),
    ...(Array.isArray(operationalHealth.blockedReasons) ? operationalHealth.blockedReasons : []),
    ...(Array.isArray(exportPackage.blockedReasons) ? exportPackage.blockedReasons : []),
  ]);
  const ready = uiHandoff.readiness?.ready === true
    && replayBarrier.open === true
    && persistedReplayState.restartSafe === true
    && operationalHealth.failed !== true
    && exportPackage.exportReady === true
    && blockedReasons.length === 0;
  const nextAction = ready
    ? normalized.replayed
      ? 'verify_cached_descriptor'
      : 'reuse_compile_cache'
    : operationalHealth.nextAction
      || persistedReplayState.recovery?.command
      || replayBarrier.recoveryCommand
      || uiHandoff.routeHints?.recoveryCommand
      || exportPackage.nextAction
      || 'refresh_compile_cache';

  return {
    protocol: 'aios.compile-cache-status-handoff.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    status: normalized.status,
    replayed: normalized.replayed,
    ready,
    statusRouteState: ready ? 'ready' : operationalHealth.failed ? 'failed' : 'needs_attention',
    nextAction,
    recoveryCommand: ready ? 'observe' : nextAction,
    blockedReasons,
    lifecycleExecution: {
      state: compactString(normalized.lifecycle.executionPlan?.state || (normalized.lifecycle.blocked ? 'blocked' : 'unknown')),
      executable: normalized.lifecycle.executionPlan?.executable === true,
      command: compactString(normalized.lifecycle.command),
      candidateCommand: compactString(normalized.lifecycle.executionPlan?.candidateCommand || normalized.lifecycle.command),
      nextAction: compactString(normalized.lifecycle.nextAction),
      scheduleMode: compactString(normalized.lifecycle.schedule?.mode || normalized.lifecycle.executionPlan?.schedule?.mode),
      scheduleDue: normalized.lifecycle.executionPlan?.schedule?.due !== false,
      nextEligibleAt: normalized.lifecycle.executionPlan?.schedule?.nextEligibleAt ?? null,
      delayMs: positiveInteger(normalized.lifecycle.executionPlan?.schedule?.delayMs, 0),
      deferredReasons: stableList(normalized.lifecycle.executionPlan?.deferredReasons),
      blockedReasons: stableList(normalized.lifecycle.executionPlan?.blockedReasons),
    },
    replaySafe: replayBarrier.canReplayCachedDescriptor === true && persistedReplayState.replaySafe === true,
    restartSafe: replayBarrier.restartSafe === true && persistedReplayState.restartSafe === true,
    exportReady: exportPackage.exportReady === true,
    degradedMode: operationalHealth.degradedMode,
    reporting: {
      state: compactString(normalized.history.reportingState?.state || normalized.exportSummary.reportingState?.state),
      nextAction: compactString(normalized.history.reportingState?.nextAction || normalized.exportSummary.reportingState?.nextAction),
      exportReady: normalized.history.exportReady === true || normalized.exportSummary.exportReady === true,
      snapshotCount: positiveInteger(normalized.history.timeline?.snapshotCount, 0),
      latestAt: normalized.history.timeline?.latestAt ?? normalized.exportSummary.timeline?.latestAt ?? null,
      latestKind: compactString(normalized.history.timeline?.latestKind || normalized.exportSummary.timeline?.latestKind),
      latestStatus: compactString(normalized.history.timeline?.latestStatus || normalized.exportSummary.timeline?.latestStatus),
    },
    uiHandoff,
    replayBarrier,
    persistedReplayState,
    operationalHealth,
    exportPackage,
    checkpoint: {
      providerState: compactString(normalized.providerSyncCheckpoint.state || 'unknown'),
      providerRestartSafe: normalized.providerSyncCheckpoint.restartSafe === true,
      boundaryAllowed: normalized.boundaryScope.allowed !== false,
      ttlRemainingMs: normalized.ttlRemainingMs,
      sourceHash: normalized.sourceHash,
      optionsHash: normalized.optionsHash,
      contractHash: normalized.contractHash,
    },
  };
}

function touchEntry(entry, now) {
  return {
    ...entry,
    hits: entry.hits + 1,
    lastAccessedAt: now,
    stale: isExpired(entry, now),
  };
}

function pruneEntries(entries, maxEntries, now) {
  const live = entries
    .filter((entry) => !isExpired(entry, now))
    .sort((left, right) => {
      if (left.lastAccessedAt !== right.lastAccessedAt) return right.lastAccessedAt - left.lastAccessedAt;
      return right.updatedAt - left.updatedAt;
    });
  return live.slice(0, maxEntries);
}

function normalizeInitialEntries(entries = [], now = Date.now()) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry?.protocol === 'aios.compile-cache-entry.mailchimp.v1' && entry.key)
    .map((entry) => ({
      ...entry,
      createdAt: positiveInteger(entry.createdAt, now),
      updatedAt: positiveInteger(entry.updatedAt, now),
      lastAccessedAt: positiveInteger(entry.lastAccessedAt, now),
      hits: positiveInteger(entry.hits, 0),
      stale: entry.stale === true || isExpired(entry, now),
      boundaryScope: entry.boundaryScope || normalizeBoundaryScope(entry.descriptor),
      descriptor: cloneContract(entry.descriptor),
    }));
}

export function createMailchimpCompileCache(initialEntries = [], options = {}) {
  const cacheOptions = normalizeCacheOptions(options);
  const now = nowFrom(options);
  const entries = new Map();
  const events = [];
  const record = (event) => {
    events.push(normalizeCacheEvent({
      at: event.at ?? nowFrom({ now }),
      namespace: cacheOptions.namespace,
      ...event,
    }, events.length));
  };
  for (const entry of pruneEntries(normalizeInitialEntries(initialEntries, now), cacheOptions.maxEntries, now)) {
    entries.set(entry.key, entry);
  }
  record({
    at: now,
    kind: 'initialize',
    status: entries.size > 0 ? 'restored' : 'empty',
    reason: entries.size > 0 ? 'initial_entries' : 'cold_start',
  });

  return {
    protocol: 'aios.compile-cache.mailchimp.v1',
    options: cacheOptions,
    get size() {
      return entries.size;
    },
    has(key, readOptions = {}) {
      const current = nowFrom(readOptions);
      const entry = entries.get(compactString(key));
      return Boolean(entry && !isExpired(entry, current));
    },
    get(key, readOptions = {}) {
      const current = nowFrom(readOptions);
      const normalizedKey = compactString(key);
      const entry = entries.get(normalizedKey);
      if (!entry) {
        record({ at: current, kind: 'lookup', status: 'miss', key: normalizedKey, reason: 'missing' });
        return null;
      }
      if (isExpired(entry, current)) {
        entries.delete(normalizedKey);
        record({
          at: current,
          kind: 'lookup',
          status: 'miss',
          key: normalizedKey,
          reason: 'expired',
          requestKey: entry.identity.requestKey,
          sourceHash: entry.identity.sourceHash,
          contractHash: entry.identity.contractHash,
        });
        return null;
      }
      const boundaryDecision = boundaryMatches(
        entry.boundaryScope || normalizeBoundaryScope(entry.descriptor),
        readOptions.boundary || readOptions.tenantBoundary || {},
      );
      if (!boundaryDecision.ok) {
        record({
          at: current,
          kind: 'lookup',
          status: 'miss',
          key: normalizedKey,
          reason: `boundary:${boundaryDecision.blockedReasons[0]}`,
          requestKey: entry.identity.requestKey,
          sourceHash: entry.identity.sourceHash,
          contractHash: entry.identity.contractHash,
        });
        return null;
      }
      const touched = touchEntry(entry, current);
      entries.set(normalizedKey, touched);
      record({
        at: current,
        kind: 'lookup',
        status: 'hit',
        key: normalizedKey,
        requestKey: touched.identity.requestKey,
        sourceHash: touched.identity.sourceHash,
        contractHash: touched.identity.contractHash,
      });
      return {
        descriptor: cloneContract(touched.descriptor),
        entry: summarizeEntry(touched, current),
      };
    },
    set(identity, descriptor, writeOptions = {}) {
      const current = nowFrom(writeOptions);
      const mergedOptions = normalizeCacheOptions({ ...cacheOptions, ...writeOptions });
      const entry = makeEntry(identity, descriptor, mergedOptions, current);
      entries.set(entry.key, entry);
      const prunedEntries = pruneEntries([...entries.values()], mergedOptions.maxEntries, current);
      for (const stale of prunedEntries) {
        entries.set(stale.key, stale);
      }
      for (const key of entries.keys()) {
        if (!prunedEntries.some((entryItem) => entryItem.key === key)) {
          entries.delete(key);
          record({ at: current, kind: 'evict', status: 'removed', key, reason: 'limit_or_expiry' });
        }
      }
      record({
        at: current,
        kind: 'store',
        status: 'stored',
        key: entry.key,
        requestKey: entry.identity.requestKey,
        sourceHash: entry.identity.sourceHash,
        contractHash: entry.identity.contractHash,
      });
      return summarizeEntry(entry, current);
    },
    invalidate(key, invalidateOptions = {}) {
      const current = nowFrom(invalidateOptions);
      const normalizedKey = compactString(key);
      const removed = entries.delete(normalizedKey);
      record({
        at: current,
        kind: 'invalidate',
        status: removed ? 'removed' : 'missing',
        key: normalizedKey,
        reason: removed ? 'manual' : 'not_found',
      });
      return removed;
    },
    snapshot(snapshotOptions = {}) {
      const current = nowFrom(snapshotOptions);
      const summaries = [...entries.values()].map((entry) => summarizeEntry(entry, current));
      const analytics = buildCacheAnalytics([...entries.values()], events, current);
      const sortedEntries = summaries.sort((left, right) => left.key.localeCompare(right.key));
      const history = buildMailchimpCompileCacheHistoryReport({
        namespace: cacheOptions.namespace,
        entries: sortedEntries,
        analytics,
        events,
      }, { now: current });
      const baseSnapshot = {
        protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
        namespace: cacheOptions.namespace,
        size: entries.size,
        limit: cacheOptions.maxEntries,
        ttlMs: cacheOptions.ttlMs,
        entries: sortedEntries,
        analytics,
        history,
      };
      const exportSummary = buildMailchimpCompileCacheExportSummary(baseSnapshot);
      return {
        ...baseSnapshot,
        exportSummary,
        exportPackage: buildMailchimpCompileCacheExportPackage({
          ...baseSnapshot,
          exportSummary,
        }, snapshotOptions),
        lifecycle: buildMailchimpCompileCacheLifecycleDecision({
          ...baseSnapshot,
          exportSummary,
        }, snapshotOptions),
      };
    },
    exportSummary(summaryOptions = {}) {
      return buildMailchimpCompileCacheExportSummary(this.snapshot(summaryOptions));
    },
    exportPackage(packageOptions = {}) {
      return buildMailchimpCompileCacheExportPackage(this.snapshot(packageOptions), packageOptions);
    },
    lifecycleDecision(lifecycleOptions = {}) {
      return buildMailchimpCompileCacheLifecycleDecision(this.snapshot(lifecycleOptions), lifecycleOptions);
    },
  };
}

export function compileMailchimpWithCompileCache(input = {}, options = {}) {
  const cache = options.cache?.protocol === 'aios.compile-cache.mailchimp.v1'
    ? options.cache
    : createMailchimpCompileCache(options.initialEntries || [], options.cacheOptions || options);
  const now = nowFrom(options);
  const compileOptions = {
    allowedActions: options.allowedActions,
  };
  const identity = buildMailchimpHandoffIdentity(input, compileOptions);
  const cached = cache.get(identity.cacheKey, { now, boundary: options.boundary || options.tenantBoundary });

  if (cached) {
    const cacheSnapshot = cache.snapshot({ now });
    const providerSyncCheckpoint = buildMailchimpCompileCacheProviderSyncCheckpoint(cached.descriptor, options.runtime || options);
    const uiHandoff = buildMailchimpCompileCacheUiHandoff({
      ...cacheSnapshot,
      compileCache: {
        ...cached.entry,
        status: 'hit',
        replayed: true,
        analytics: cacheSnapshot.analytics,
        exportSummary: cacheSnapshot.exportSummary,
        history: cacheSnapshot.history,
        providerSyncCheckpoint,
        boundaryScope: cached.entry.boundaryScope,
      },
    }, options.runtime || options);
    const exportPackage = buildMailchimpCompileCacheExportPackage({
      ...cacheSnapshot,
      compileCache: {
        ...cached.entry,
        status: 'hit',
        replayed: true,
        analytics: cacheSnapshot.analytics,
        exportSummary: cacheSnapshot.exportSummary,
        history: cacheSnapshot.history,
        uiHandoff,
      },
    }, options.runtime || options);
    const statusHandoff = buildMailchimpCompileCacheStatusHandoff({
      ...cacheSnapshot,
      compileCache: {
        ...cached.entry,
        status: 'hit',
        replayed: true,
        analytics: cacheSnapshot.analytics,
        exportSummary: cacheSnapshot.exportSummary,
        history: cacheSnapshot.history,
        lifecycle: cacheSnapshot.lifecycle,
        providerSyncCheckpoint,
        boundaryScope: cached.entry.boundaryScope,
        uiHandoff,
        exportPackage,
      },
    }, options.runtime || options);
    return {
      protocol: 'aios.compile-result.mailchimp.v1',
      cache,
      cacheStatus: 'hit',
    descriptor: {
      ...cached.descriptor,
      compileCache: {
        ...cached.entry,
        status: 'hit',
        replayed: true,
        analytics: cacheSnapshot.analytics,
        exportSummary: cacheSnapshot.exportSummary,
        history: cacheSnapshot.history,
        exportPackage,
        providerSyncCheckpoint,
        boundaryScope: cached.entry.boundaryScope,
        uiHandoff,
        replayBarrier: statusHandoff.replayBarrier,
        persistedReplayState: statusHandoff.persistedReplayState,
        operationalHealth: statusHandoff.operationalHealth,
        statusHandoff,
      },
    },
      identity,
      diagnostics: cached.descriptor.diagnostics || [],
    };
  }

  const descriptor = compileMailchimpAdapterHandoff(input, compileOptions);
  const providerSyncCheckpoint = buildMailchimpCompileCacheProviderSyncCheckpoint(descriptor, options.runtime || options);
  const boundaryScope = normalizeBoundaryScope(descriptor);
  const entry = cache.set(identity, {
    ...descriptor,
    compileCache: {
      key: identity.cacheKey,
      status: 'stored',
      replayed: false,
      sourceHash: identity.sourceHash,
      optionsHash: identity.optionsHash,
      contractHash: identity.contractHash,
      providerSyncCheckpoint,
      boundaryScope,
    },
  }, { now });
  const cacheSnapshot = cache.snapshot({ now });
  const uiHandoff = buildMailchimpCompileCacheUiHandoff({
    ...cacheSnapshot,
    compileCache: {
      ...entry,
      status: 'miss',
      replayed: false,
      analytics: cacheSnapshot.analytics,
      exportSummary: cacheSnapshot.exportSummary,
      history: cacheSnapshot.history,
      providerSyncCheckpoint,
      boundaryScope: entry.boundaryScope,
    },
  }, options.runtime || options);
  const exportPackage = buildMailchimpCompileCacheExportPackage({
    ...cacheSnapshot,
    compileCache: {
      ...entry,
      status: 'miss',
      replayed: false,
      analytics: cacheSnapshot.analytics,
      exportSummary: cacheSnapshot.exportSummary,
      history: cacheSnapshot.history,
      uiHandoff,
    },
  }, options.runtime || options);
  const statusHandoff = buildMailchimpCompileCacheStatusHandoff({
    ...cacheSnapshot,
    compileCache: {
      ...entry,
      status: 'miss',
      replayed: false,
      analytics: cacheSnapshot.analytics,
      exportSummary: cacheSnapshot.exportSummary,
      history: cacheSnapshot.history,
      lifecycle: cacheSnapshot.lifecycle,
      providerSyncCheckpoint,
      boundaryScope: entry.boundaryScope,
      uiHandoff,
      exportPackage,
    },
  }, options.runtime || options);

  return {
    protocol: 'aios.compile-result.mailchimp.v1',
    cache,
    cacheStatus: 'miss',
    descriptor: {
      ...descriptor,
      compileCache: {
        ...entry,
        status: 'miss',
        replayed: false,
        analytics: cacheSnapshot.analytics,
        exportSummary: cacheSnapshot.exportSummary,
        history: cacheSnapshot.history,
        exportPackage,
        providerSyncCheckpoint,
        boundaryScope: entry.boundaryScope,
        uiHandoff,
        replayBarrier: statusHandoff.replayBarrier,
        persistedReplayState: statusHandoff.persistedReplayState,
        operationalHealth: statusHandoff.operationalHealth,
        statusHandoff,
      },
    },
    identity,
    diagnostics: descriptor.diagnostics || [],
  };
}

export function assertMailchimpCompileCacheSelfCheck(options = {}) {
  const source = [
    'adapter: mailchimp',
    'action: campaign.draft',
    'tenant: demo',
    'truth: verified',
    'idempotencyKey: demo-draft-1',
    'verifier: preview',
  ].join('\n');
  const cache = createMailchimpCompileCache([], { now: 1, ttlMs: 1000, ...options });
  const first = compileMailchimpWithCompileCache(source, { cache, now: 1 });
  const second = compileMailchimpWithCompileCache(source, { cache, now: 2 });
  const exportSummary = cache.exportSummary({ now: 2 });
  const exportPackage = cache.exportPackage({ now: 2 });
  const lifecycle = cache.lifecycleDecision({ now: 2, command: 'export' });
  const statusHandoff = second.descriptor.compileCache.statusHandoff;
  const history = second.descriptor.compileCache.history;
  const ok = first.cacheStatus === 'miss'
    && second.cacheStatus === 'hit'
    && first.identity.cacheKey === second.identity.cacheKey
    && second.descriptor.compileCache.replayed === true
    && statusHandoff.protocol === 'aios.compile-cache-status-handoff.mailchimp.v1'
    && statusHandoff.ready === true
    && statusHandoff.statusRouteState === 'ready'
    && statusHandoff.nextAction === 'verify_cached_descriptor'
    && statusHandoff.operationalHealth.healthy === true
    && statusHandoff.persistedReplayState.restartSafe === true
    && second.descriptor.compileCache.analytics.counters.hitEvents === 1
    && second.descriptor.compileCache.analytics.counters.missEvents === 1
    && history.protocol === 'aios.compile-cache-history.mailchimp.v1'
    && history.reportingState.state === 'export_ready'
    && history.timeline.snapshotCount >= 3
    && statusHandoff.reporting.state === 'export_ready'
    && exportSummary.exportReady === true
    && exportSummary.reportingState.state === 'export_ready'
    && exportPackage.exportReady === true
    && exportPackage.reporting.state === 'export_ready'
    && exportPackage.counters.hitEvents === 1
    && lifecycle.nextAction === 'export_compile_cache_summary';
  return {
    protocol: 'aios.compile-cache-self-check.mailchimp.v1',
    ok,
    firstStatus: first.cacheStatus,
    secondStatus: second.cacheStatus,
    cacheKey: first.identity.cacheKey,
    size: cache.size,
    exportReady: exportSummary.exportReady,
    history,
    exportPackage,
    lifecycle,
    statusHandoff,
    counters: exportSummary.counters,
    diagnostics: ok ? [] : [{
      code: 'mailchimp.compile_cache.self_check_failed',
      severity: 'error',
      message: 'Mailchimp compile cache did not produce deterministic miss-then-hit analytics/export/status handoff behavior.',
    }],
  };
}

export { DEFAULT_CACHE_LIMIT, DEFAULT_TTL_MS };
