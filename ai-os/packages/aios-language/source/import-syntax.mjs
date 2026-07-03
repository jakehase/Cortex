export const IMPORT_SYNTAX_SCHEMA_VERSION = 'aios.import-syntax.v1';

const BUILTIN_IMPORTS = Object.freeze({
  '@mailchimp/profile': Object.freeze({
    kind: 'profile',
    capabilities: Object.freeze(['mailchimp.read']),
    statusChannel: 'kernel.status.mailchimp'
  }),
  '@mailchimp/gates': Object.freeze({
    kind: 'feature-gates',
    capabilities: Object.freeze([]),
    statusChannel: 'kernel.status.mailchimp'
  }),
  '@mailchimp/recovery': Object.freeze({
    kind: 'recovery',
    capabilities: Object.freeze(['kernel.status.write']),
    statusChannel: 'kernel.status.mailchimp'
  })
});

const IMPORT_HEALTH_DEFAULTS = Object.freeze({
  maxAttempts: 3,
  baseBackoffMs: 500,
  maxBackoffMs: 8000,
  degradedMode: 'local_status_only'
});

const IMPORT_LIFECYCLE_COMMANDS = Object.freeze({
  enable: 'enabled',
  disable: 'disabled',
  retry: 'retry_scheduled',
  pause: 'paused',
  resume: 'enabled'
});

const IMPORT_LIFECYCLE_DEFAULTS = Object.freeze({
  enabled: true,
  scheduleMode: 'immediate',
  retryWindowMs: 30000,
  maxScheduledRetries: 3
});

export function parseImportSyntaxSource(source = '', options = {}) {
  const diagnostics = [];
  const imports = [];
  String(source ?? '').split(/\r?\n/).forEach((rawLine, offset) => {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) return;
    const match = line.match(/^import\s+([a-z][a-z0-9_-]*)\s+from\s+["']([^"']+)["']$/i);
    if (!match) {
      diagnostics.push({ level: 'error', code: 'invalid_import_syntax', subject: `line:${offset + 1}` });
      return;
    }
    imports.push({ alias: match[1], specifier: match[2], line: offset + 1 });
  });
  return {
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    sourceName: clean(options.sourceName) || 'inline.imports.aios',
    imports,
    diagnostics
  };
}

export function resolveImportSyntax(input = {}, options = {}) {
  const parsed = typeof input === 'string' ? parseImportSyntaxSource(input, options) : normalizeImportInput(input);
  const seenAliases = new Set();
  const resolved = [];
  const diagnostics = [...(parsed.diagnostics ?? [])];

  for (const declaration of parsed.imports ?? []) {
    if (seenAliases.has(declaration.alias)) {
      diagnostics.push({ level: 'error', code: 'duplicate_import_alias', subject: declaration.alias });
      continue;
    }
    seenAliases.add(declaration.alias);
    const target = BUILTIN_IMPORTS[declaration.specifier] ?? options.importMap?.[declaration.specifier];
    if (!target) {
      diagnostics.push({ level: 'error', code: 'unresolved_import_specifier', subject: declaration.specifier });
      continue;
    }
    resolved.push({
      alias: declaration.alias,
      specifier: declaration.specifier,
      kind: target.kind,
      capabilities: [...target.capabilities].sort(),
      statusChannel: target.statusChannel,
      handoffSafe: target.statusChannel === 'kernel.status.mailchimp'
    });
  }

  return {
    ok: !diagnostics.some((item) => item.level === 'error'),
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    imports: resolved.sort((left, right) => left.alias.localeCompare(right.alias)),
    capabilityRefs: unique(resolved.flatMap((item) => item.capabilities)),
    statusChannels: unique(resolved.map((item) => item.statusChannel)),
    diagnostics
  };
}

export function buildImportRecoveryHandoff(input = {}, options = {}) {
  const resolved = resolveImportSyntax(input, options);
  const health = assessImportOperationalHealth(resolved, options);
  const analytics = buildImportAnalyticsSnapshot(resolved, {
    ...options,
    health
  });
  const lifecycle = buildImportLifecycleControlState(resolved, {
    ...options,
    health
  });
  return {
    ok: resolved.ok,
    handoff: {
      statusChannels: resolved.statusChannels,
      adapter: health.statusChannelReady ? 'mailchimp' : 'local',
      restartSafe: resolved.ok && health.restartSafe,
      degradedMode: health.degradedMode,
      nextRetry: health.nextRetry,
      lifecycleStatus: lifecycle.status,
      nextAction: lifecycle.nextAction,
      missingImports: resolved.diagnostics
        .filter((item) => item.code === 'unresolved_import_specifier')
        .map((item) => item.subject)
        .sort()
    },
    health,
    analytics,
    lifecycle,
    diagnostics: health.diagnostics
  };
}

export function buildImportProviderContract(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const requestedCapabilities = unique([
    ...normalizeList(options.requestedCapabilities ?? input.requestedCapabilities),
    ...normalizeList(options.requestedEffects ?? input.requestedEffects)
  ]);
  const providerCatalog = normalizeProviderCatalog(options.providerCatalog ?? input.providerCatalog);
  const syncWindowMs = toPositiveInteger(options.syncWindowMs ?? input.syncWindowMs, 60000);
  const now = clean(options.now ?? options.timestamp) || null;
  const providers = resolved.imports.map((item) => {
    const provider = providerCatalog[item.specifier] ?? {};
    const offeredCapabilities = unique([
      ...item.capabilities,
      ...normalizeList(provider.capabilities)
    ]);
    const requiredCapabilities = requestedCapabilities.filter((capability) => (
      capability.startsWith('mailchimp.')
    ));
    const missingCapabilities = requiredCapabilities.filter((capability) => !offeredCapabilities.includes(capability));
    const statusChannel = clean(provider.statusChannel) || item.statusChannel;
    const syncMode = clean(provider.syncMode) || providerSyncModeForKind(item.kind);
    const externalHandoff = normalizeExternalHandoff(provider.externalHandoff, {
      statusChannel,
      specifier: item.specifier,
      handoffSafe: item.handoffSafe
    });

    return {
      alias: item.alias,
      specifier: item.specifier,
      kind: item.kind,
      service: clean(provider.service) || item.kind,
      provider: clean(provider.provider) || 'mailchimp',
      syncMode,
      sync: {
        mode: syncMode,
        windowMs: syncWindowMs,
        lastSyncedAt: clean(provider.lastSyncedAt) || null,
        nextSyncAfterMs: syncMode === 'manual' ? null : syncWindowMs
      },
      capabilities: {
        offered: offeredCapabilities,
        requested: requiredCapabilities,
        missing: missingCapabilities,
        negotiation: missingCapabilities.length > 0 ? 'capability_gap' : 'satisfied'
      },
      externalHandoff,
      statusChannel,
      handoffSafe: item.handoffSafe && externalHandoff.ready
    };
  });
  const providedCapabilities = unique(providers.flatMap((item) => item.capabilities.offered));
  const missingCapabilities = requestedCapabilities
    .filter((capability) => capability.startsWith('mailchimp.'))
    .filter((capability) => !providedCapabilities.includes(capability));
  const unsafeHandoffs = providers.filter((item) => item.handoffSafe !== true);
  const diagnostics = [
    ...health.diagnostics,
    ...missingCapabilities.map((capability) => ({
      level: 'error',
      code: 'import_provider_capability_missing',
      subject: capability
    })),
    ...unsafeHandoffs.map((item) => ({
      level: health.status === 'blocked' ? 'error' : 'warning',
      code: 'import_provider_handoff_not_ready',
      subject: item.specifier
    }))
  ];
  const status = diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    generatedAt: now,
    restartSafe: status === 'ready' && health.restartSafe,
    requestedCapabilities,
    providers,
    capabilityNegotiation: {
      status: missingCapabilities.length > 0 ? 'missing_capabilities' : 'satisfied',
      missingCapabilities,
      providedCapabilities
    },
    syncMetadata: {
      syncWindowMs,
      modes: unique(providers.map((item) => item.sync.mode)),
      pendingSyncs: providers
        .filter((item) => item.sync.mode !== 'manual')
        .map((item) => ({
          alias: item.alias,
          nextSyncAfterMs: item.sync.nextSyncAfterMs
        }))
    },
    externalHandoff: {
      status: unsafeHandoffs.length > 0 ? 'degraded' : 'ready',
      targets: providers.map((item) => ({
        alias: item.alias,
        target: item.externalHandoff.target,
        statusChannel: item.externalHandoff.statusChannel,
        ready: item.externalHandoff.ready
      })),
      unsafeSpecifiers: unsafeHandoffs.map((item) => item.specifier).sort()
    },
    diagnostics
  };
}

export function buildImportProviderReadinessPlan(input = {}, options = {}) {
  const provider = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.providers)
    ? input
    : buildImportProviderContract(input, options);
  const previous = normalizeImportProviderReadinessState(options.previousReadinessPlan ?? options.previousProviderReadiness ?? input.previousReadinessPlan);
  const now = clean(options.now ?? options.timestamp) || null;
  const requiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases);
  const acceptance = normalizeImportProviderReadinessAcceptance(options.acceptance ?? options.providerReadinessAcceptance ?? input.providerReadinessAcceptance);
  const rows = (provider.providers ?? []).map((item) => {
    const required = requiredAliases.length === 0
      || requiredAliases.includes(item.alias)
      || requiredAliases.includes(item.specifier);
    const accepted = acceptance.acceptedProviders.includes(item.alias)
      || acceptance.acceptedProviders.includes(item.specifier);
    const missingCapabilities = item.capabilities?.missing ?? [];
    const pendingSync = item.sync?.mode !== 'manual' && item.sync?.nextSyncAfterMs !== null;
    const blocked = required && missingCapabilities.length > 0;
    const degraded = !blocked && (
      item.handoffSafe !== true
      || item.externalHandoff?.ready !== true
      || pendingSync
      || (required && acceptance.requireExplicitAcceptance && accepted !== true)
    );
    const status = blocked ? 'blocked' : degraded ? 'degraded' : 'ready';
    return {
      alias: item.alias,
      specifier: item.specifier,
      provider: item.provider,
      service: item.service,
      kind: item.kind,
      required,
      accepted,
      status,
      capabilities: {
        requested: item.capabilities?.requested ?? [],
        offered: item.capabilities?.offered ?? [],
        missing: missingCapabilities
      },
      sync: {
        mode: item.sync?.mode ?? null,
        pending: pendingSync,
        nextSyncAfterMs: item.sync?.nextSyncAfterMs ?? null,
        lastSyncedAt: item.sync?.lastSyncedAt ?? null
      },
      externalHandoff: {
        target: item.externalHandoff?.target ?? null,
        statusChannel: item.externalHandoff?.statusChannel ?? item.statusChannel,
        ready: item.externalHandoff?.ready === true && item.handoffSafe === true,
        publishFailures: item.externalHandoff?.publishFailures !== false
      },
      nextAction: blocked
        ? 'repair_import_provider_capability_gap'
        : item.handoffSafe !== true || item.externalHandoff?.ready !== true
          ? 'route_import_provider_handoff_to_kernel'
          : required && acceptance.requireExplicitAcceptance && accepted !== true
            ? 'accept_import_provider_readiness'
            : pendingSync
              ? 'wait_for_import_provider_sync_window'
              : 'publish_import_provider_ready'
    };
  });
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const degradedRows = requiredRows.filter((row) => row.status === 'degraded');
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true);
  const fingerprint = importProviderReadinessFingerprint({
    provider,
    rows,
    acceptance
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(provider.diagnostics ?? []),
    ...blockedRows.flatMap((row) => row.capabilities.missing.map((capability) => ({
      level: 'error',
      code: 'import_provider_readiness_capability_missing',
      subject: `${row.alias}:${capability}`
    }))),
    ...degradedRows
      .filter((row) => row.externalHandoff.ready !== true)
      .map((row) => ({
        level: 'warning',
        code: 'import_provider_readiness_handoff_guarded',
        subject: row.alias
      })),
    ...degradedRows
      .filter((row) => row.sync.pending)
      .map((row) => ({
        level: 'warning',
        code: 'import_provider_readiness_sync_pending',
        subject: row.alias
      })),
    ...(acceptance.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => ({
        level: 'error',
        code: 'import_provider_readiness_acceptance_missing',
        subject: row.alias
      }))
      : awaitingAcceptance.map((row) => ({
        level: 'warning',
        code: 'import_provider_readiness_acceptance_pending',
        subject: row.alias
      })))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_import_provider_readiness_blockers'
    : status === 'degraded'
      ? 'publish_import_provider_readiness_degraded'
      : changed
        ? 'publish_import_provider_readiness_delta'
        : 'reuse_import_provider_readiness';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready' && provider.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    rows,
    validationSummary: {
      totalProviders: rows.length,
      requiredProviders: requiredRows.length,
      blockedProviders: blockedRows.length,
      degradedProviders: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      missingCapabilities: requiredRows.reduce((count, row) => count + row.capabilities.missing.length, 0),
      unsafeHandoffs: requiredRows.filter((row) => row.externalHandoff.ready !== true).length,
      pendingSyncs: requiredRows.filter((row) => row.sync.pending).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.alias),
        ...blockedRows.flatMap((row) => row.capabilities.missing.map((capability) => `missing:${row.alias}:${capability}`))
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.alias),
        ...(!acceptance.requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-provider-readiness',
      statusChannel: provider.externalHandoff?.status === 'ready'
        ? 'kernel.status.mailchimp'
        : 'local.status.import-provider-readiness',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeProviderContract: provider.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_provider_readiness',
      status,
      restartSafe: status === 'ready' && provider.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedProviders: blockedRows.map((row) => row.alias).sort(),
      degradedProviders: degradedRows.map((row) => row.alias).sort(),
      missingCapabilities: unique(blockedRows.flatMap((row) => row.capabilities.missing)),
      unsafeHandoffs: requiredRows
        .filter((row) => row.externalHandoff.ready !== true)
        .map((row) => row.alias)
        .sort(),
      pendingSyncs: requiredRows
        .filter((row) => row.sync.pending)
        .map((row) => row.alias)
        .sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportProviderSyncCheckpoint(input = {}, options = {}) {
  const provider = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.providers)
    ? input
    : buildImportProviderContract(input, options);
  const readiness = options.readinessPlan ?? options.importProviderReadiness ?? buildImportProviderReadinessPlan(provider, {
    ...options,
    acceptance: options.providerReadinessAcceptance ?? options.acceptance
  });
  const adoption = options.providerAdoption ?? options.importProviderAdoption ?? {};
  const profileIntent = normalizeProfileProviderSyncIntent(options.profileProviderSyncIntent ?? options.profileSyncIntent);
  const previous = normalizeImportProviderSyncCheckpoint(options.previousCheckpoint ?? options.previousImportProviderSyncCheckpoint ?? input.previousCheckpoint);
  const now = clean(options.now ?? options.timestamp) || null;
  const commandKey = clean(options.syncCommandKey ?? options.commandKey ?? input.syncCommandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...(options.appliedSyncCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const repeatedCommand = commandKey && seenCommands.has(commandKey);
  const requestedCapabilities = unique([
    ...(provider.requestedCapabilities ?? []),
    ...(profileIntent.capabilityNegotiation?.requestedCapabilities ?? []),
    ...normalizeList(options.requestedCapabilities ?? input.requestedCapabilities)
  ]);
  const profileCursor = clean(profileIntent.sync?.cursor);
  const previousProfileCursor = clean(previous.profileCursor);
  const profileCursorChanged = Boolean(previousProfileCursor && profileCursor && previousProfileCursor !== profileCursor);
  const providerRows = (provider.providers ?? []).map((item) => {
    const readinessRow = (readiness.rows ?? []).find((row) => row.alias === item.alias || row.specifier === item.specifier) ?? {};
    const adoptionRow = (adoption.rows ?? []).find?.((row) => row.alias === item.alias || row.specifier === item.specifier) ?? {};
    const requiredCapabilities = requestedCapabilities.filter((capability) => capability.startsWith('mailchimp.'));
    const missingCapabilities = unique([
      ...(item.capabilities?.missing ?? []),
      ...requiredCapabilities.filter((capability) => !(item.capabilities?.offered ?? []).includes(capability))
    ]);
    const externalReady = item.handoffSafe === true
      && item.externalHandoff?.ready === true
      && (item.externalHandoff?.statusChannel ?? item.statusChannel) === 'kernel.status.mailchimp';
    const pendingSync = item.sync?.mode !== 'manual' && item.sync?.nextSyncAfterMs !== null;
    const adoptionBlocked = adoptionRow.status === 'blocked' || adoption.status === 'blocked';
    const blocked = missingCapabilities.length > 0 || adoptionBlocked;
    const degraded = blocked !== true && (
      readinessRow.status === 'degraded'
      || adoptionRow.status === 'degraded'
      || externalReady !== true
      || pendingSync
      || profileCursorChanged
    );
    const status = blocked ? 'blocked' : degraded ? 'degraded' : 'ready';
    return {
      alias: item.alias,
      specifier: item.specifier,
      provider: item.provider,
      service: item.service,
      kind: item.kind,
      status,
      readinessStatus: readinessRow.status ?? readiness.status ?? provider.status,
      adoptionStatus: adoptionRow.status ?? adoption.status ?? 'unknown',
      capabilities: {
        requested: requiredCapabilities,
        offered: item.capabilities?.offered ?? [],
        missing: missingCapabilities
      },
      sync: {
        mode: item.sync?.mode ?? null,
        lastSyncedAt: item.sync?.lastSyncedAt ?? null,
        nextSyncAfterMs: item.sync?.nextSyncAfterMs ?? null,
        pending: pendingSync,
        profileCursor: profileCursor || null,
        profileCursorChanged
      },
      externalHandoff: {
        target: item.externalHandoff?.target ?? null,
        statusChannel: item.externalHandoff?.statusChannel ?? item.statusChannel,
        ready: externalReady
      },
      checkpointKey: [item.alias, item.specifier, profileCursor || 'no_cursor'].map(clean).join(':'),
      nextAction: blocked
        ? 'repair_import_provider_sync_capabilities'
        : externalReady !== true
          ? 'route_import_provider_sync_to_kernel'
          : pendingSync
            ? 'wait_for_import_provider_sync_window'
            : profileCursorChanged
              ? 'publish_import_provider_profile_cursor_delta'
              : 'publish_import_provider_sync_checkpoint'
    };
  });
  const blockedRows = providerRows.filter((row) => row.status === 'blocked');
  const degradedRows = providerRows.filter((row) => row.status === 'degraded');
  const fingerprint = importProviderSyncCheckpointFingerprint({
    provider,
    readiness,
    adoption,
    profileIntent,
    providerRows,
    requestedCapabilities
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(provider.diagnostics ?? []),
    ...(readiness.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...((adoption.diagnostics ?? []).filter?.((item) => item.level === 'error') ?? []),
    ...(profileIntent.status === 'blocked' ? [{
      level: 'error',
      code: 'import_provider_sync_profile_intent_blocked',
      subject: profileIntent.profileName ?? 'mailchimp.default'
    }] : []),
    ...blockedRows.flatMap((row) => row.capabilities.missing.map((capability) => ({
      level: 'error',
      code: 'import_provider_sync_capability_missing',
      subject: `${row.alias}:${capability}`
    }))),
    ...degradedRows
      .filter((row) => row.externalHandoff.ready !== true)
      .map((row) => ({
        level: 'warning',
        code: 'import_provider_sync_handoff_guarded',
        subject: row.alias
      })),
    ...(profileCursorChanged ? [{
      level: 'warning',
      code: 'import_provider_sync_profile_cursor_changed',
      subject: `${previousProfileCursor}->${profileCursor}`
    }] : []),
    ...(repeatedCommand ? [{
      level: 'info',
      code: 'import_provider_sync_command_already_applied',
      subject: commandKey
    }] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_import_provider_sync_checkpoint_blockers'
    : status === 'degraded'
      ? 'publish_import_provider_sync_checkpoint_degraded'
      : changed
        ? 'publish_import_provider_sync_checkpoint'
        : 'reuse_import_provider_sync_checkpoint';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready'
      && provider.restartSafe === true
      && readiness.restartSafe !== false
      && profileIntent.restartSafe !== false,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    profileSyncIntent: {
      status: profileIntent.status ?? 'unknown',
      profileName: profileIntent.profileName ?? null,
      operation: profileIntent.operation ?? null,
      cursor: profileCursor || null,
      fingerprint: profileIntent.fingerprint ?? null
    },
    rows: providerRows,
    validationSummary: {
      totalProviders: providerRows.length,
      blockedProviders: blockedRows.length,
      degradedProviders: degradedRows.length,
      missingCapabilities: blockedRows.reduce((count, row) => count + row.capabilities.missing.length, 0),
      unsafeHandoffs: providerRows.filter((row) => row.externalHandoff.ready !== true).length,
      pendingSyncs: providerRows.filter((row) => row.sync.pending).length,
      profileCursorChanged: profileCursorChanged ? 1 : 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    checkpoint: {
      key: [profileIntent.profileName ?? 'mailchimp.default', profileCursor || 'no_cursor', fingerprint].map(clean).join(':'),
      providerKeys: providerRows.map((row) => row.checkpointKey).sort(),
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint ?? null,
      replaySafe: status !== 'blocked' && repeatedCommand !== true
    },
    idempotency: {
      commandKey: commandKey || null,
      repeated: Boolean(repeatedCommand),
      applied: Boolean(commandKey) && !repeatedCommand && diagnostics.every((item) => item.level !== 'error'),
      appliedCommandKeys: commandKey && !repeatedCommand && diagnostics.every((item) => item.level !== 'error')
        ? [...seenCommands, commandKey].sort()
        : [...seenCommands].sort()
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.alias),
        ...(profileIntent.status === 'blocked' ? ['profile_provider_sync_intent'] : [])
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.alias),
        ...(profileCursorChanged ? ['profile_cursor_changed'] : []),
        ...(repeatedCommand ? ['idempotent_command'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-provider-sync',
      statusChannel: provider.externalHandoff?.status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.import-provider-sync',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeCheckpoint: true,
      includeRows: status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_provider_sync_checkpoint',
      status,
      restartSafe: status === 'ready' && provider.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedProviders: blockedRows.map((row) => row.alias).sort(),
      degradedProviders: degradedRows.map((row) => row.alias).sort(),
      profileCursor: profileCursor || null,
      nextAction
    },
    diagnostics
  };
}

export function buildImportKernelHandoffManifest(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const provider = options.providerContract ?? buildImportProviderContract(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const readiness = options.providerReadiness ?? options.importProviderReadiness ?? buildImportProviderReadinessPlan(provider, {
    ...options,
    acceptance: options.providerReadinessAcceptance ?? options.acceptance
  });
  const requiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases);
  const providerRowsByAlias = new Map((readiness.rows ?? []).map((row) => [row.alias, row]));
  const importRows = (resolved.imports ?? []).map((item) => {
    const providerRow = providerRowsByAlias.get(item.alias) ?? {};
    const required = requiredAliases.length === 0
      || requiredAliases.includes(item.alias)
      || requiredAliases.includes(item.specifier);
    const statusChannelReady = item.statusChannel === 'kernel.status.mailchimp' && item.handoffSafe === true;
    const providerReady = providerRow.status
      ? providerRow.status === 'ready'
      : statusChannelReady;
    const missingCapabilities = normalizeList(providerRow.capabilities?.missing);
    const blocked = required && (missingCapabilities.length > 0 || health.status === 'blocked');
    const degraded = blocked !== true && (
      statusChannelReady !== true
      || providerReady !== true
      || providerRow.sync?.pending === true
      || health.status === 'degraded'
    );
    const status = blocked ? 'blocked' : degraded ? 'degraded' : 'ready';

    return {
      id: `import:${item.alias}`,
      kind: item.kind,
      alias: item.alias,
      specifier: item.specifier,
      required,
      status,
      restartSafe: status === 'ready' && statusChannelReady && providerReady,
      statusChannel: item.statusChannel,
      capabilities: {
        offered: item.capabilities,
        missing: missingCapabilities
      },
      provider: {
        status: providerRow.status ?? provider.status ?? 'unknown',
        accepted: providerRow.accepted === true,
        syncPending: providerRow.sync?.pending === true,
        handoffReady: providerRow.externalHandoff?.ready === true || statusChannelReady
      },
      nextAction: blocked
        ? 'repair_import_kernel_manifest_blockers'
        : statusChannelReady !== true
          ? 'route_import_status_to_kernel'
          : providerRow.sync?.pending === true
            ? 'wait_for_import_provider_sync_window'
            : providerReady !== true
              ? 'publish_import_provider_readiness_advisory'
              : 'include_import_kernel_handoff'
    };
  });
  const missingRequiredAliases = requiredAliases
    .filter((alias) => !importRows.some((row) => row.alias === alias || row.specifier === alias))
    .map((alias) => ({
      id: `missing:${alias}`,
      kind: 'missing_import',
      alias,
      specifier: null,
      required: true,
      status: 'blocked',
      restartSafe: false,
      statusChannel: 'kernel.status.mailchimp',
      capabilities: {
        offered: [],
        missing: []
      },
      provider: {
        status: 'missing',
        accepted: false,
        syncPending: false,
        handoffReady: false
      },
      nextAction: 'add_required_import_declaration'
    }));
  const rows = [...importRows, ...missingRequiredAliases].sort((left, right) => left.id.localeCompare(right.id));
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded');
  const statusChannels = unique(rows.map((row) => row.statusChannel));
  const diagnostics = [
    ...health.diagnostics,
    ...(provider.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(readiness.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...missingRequiredAliases.map((row) => ({
      level: 'error',
      code: 'import_kernel_manifest_required_alias_missing',
      subject: row.alias
    })),
    ...blockedRows
      .filter((row) => row.kind !== 'missing_import')
      .map((row) => ({
        level: 'error',
        code: 'import_kernel_manifest_blocked',
        subject: row.alias
      })),
    ...degradedRows.map((row) => ({
      level: 'warning',
      code: 'import_kernel_manifest_degraded',
      subject: row.alias
    }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const restartSafe = status === 'ready'
    && health.restartSafe === true
    && provider.restartSafe === true
    && readiness.restartSafe !== false
    && rows.every((row) => row.restartSafe !== false);

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe,
    sourceName: clean(options.sourceName ?? input.sourceName) || 'inline.imports.aios',
    statusChannels,
    rows,
    summary: {
      importCount: rows.length,
      requiredAliases,
      blockedImports: blockedRows.map((row) => row.alias).sort(),
      degradedImports: degradedRows.map((row) => row.alias).sort(),
      missingCapabilities: unique(rows.flatMap((row) => row.capabilities.missing)),
      statusChannelReady: statusChannels.includes('kernel.status.mailchimp')
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-manifest',
      statusChannel: statusChannels.includes('kernel.status.mailchimp')
        ? 'kernel.status.mailchimp'
        : 'local.status.import-manifest',
      publish: status !== 'ready' || rows.some((row) => row.provider.syncPending),
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      nextAction: status === 'blocked'
        ? 'resolve_import_kernel_manifest_blockers'
        : status === 'degraded'
          ? 'publish_import_kernel_manifest_advisory'
          : 'publish_import_kernel_manifest_ready'
    },
    diagnostics
  };
}

export function assessImportOperationalHealth(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const attempt = toNonNegativeInteger(options.attempt ?? input.attempt, 0);
  const maxAttempts = toPositiveInteger(options.maxAttempts, IMPORT_HEALTH_DEFAULTS.maxAttempts);
  const baseBackoffMs = toPositiveInteger(options.baseBackoffMs, IMPORT_HEALTH_DEFAULTS.baseBackoffMs);
  const maxBackoffMs = toPositiveInteger(options.maxBackoffMs, IMPORT_HEALTH_DEFAULTS.maxBackoffMs);
  const unsafeImports = resolved.imports.filter((item) => item.handoffSafe !== true);
  const missingImports = resolved.diagnostics
    .filter((item) => item.code === 'unresolved_import_specifier')
    .map((item) => item.subject)
    .sort();
  const duplicateAliases = resolved.diagnostics
    .filter((item) => item.code === 'duplicate_import_alias')
    .map((item) => item.subject)
    .sort();
  const parseFailures = resolved.diagnostics
    .filter((item) => item.code === 'invalid_import_syntax')
    .map((item) => item.subject)
    .sort();
  const statusChannelReady = resolved.statusChannels.includes('kernel.status.mailchimp');
  const retryable = missingImports.length > 0 || unsafeImports.length > 0;
  const exhausted = retryable && attempt >= maxAttempts;
  const blocking = duplicateAliases.length > 0 || parseFailures.length > 0 || exhausted;
  const degraded = retryable && !blocking;
  const diagnostics = [
    ...resolved.diagnostics,
    ...unsafeImports.map((item) => ({
      level: 'warning',
      code: 'import_status_handoff_not_kernel_safe',
      subject: item.specifier
    })),
    ...(statusChannelReady ? [] : [{
      level: resolved.ok ? 'warning' : 'error',
      code: 'mailchimp_status_channel_missing',
      subject: 'kernel.status.mailchimp'
    }]),
    ...(exhausted ? [{
      level: 'error',
      code: 'import_retry_budget_exhausted',
      subject: String(attempt)
    }] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : degraded
      ? 'degraded'
      : 'healthy';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    statusChannelReady,
    restartSafe: status === 'healthy' && resolved.imports.every((item) => item.handoffSafe),
    degradedMode: status === 'degraded' ? IMPORT_HEALTH_DEFAULTS.degradedMode : null,
    retryable,
    nextRetry: retryable && !exhausted ? {
      attempt: attempt + 1,
      maxAttempts,
      delayMs: Math.min(maxBackoffMs, baseBackoffMs * (2 ** attempt)),
      reason: missingImports.length > 0
        ? 'resolve_missing_imports'
        : unsafeImports.length > 0
          ? 'wait_for_kernel_status_handoff'
          : 'none'
    } : null,
    actionableErrors: buildImportActionableErrors({
      missingImports,
      duplicateAliases,
      parseFailures,
      unsafeImports,
      exhausted,
      statusChannelReady
    }),
    imports: resolved.imports,
    capabilityRefs: resolved.capabilityRefs,
    statusChannels: resolved.statusChannels,
    diagnostics
  };
}

export function buildImportAnalyticsSnapshot(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const previous = normalizeImportAnalyticsHistory(options.previousAnalytics ?? options.previousState ?? input.previousAnalytics);
  const sourceName = clean(options.sourceName ?? input.sourceName) || 'inline.imports.aios';
  const now = clean(options.now ?? options.timestamp) || null;
  const counters = buildImportCounters(resolved, health);
  const event = {
    sequence: toNonNegativeInteger(previous.sequence, 0) + 1,
    timestamp: now,
    sourceName,
    status: health.status,
    importCount: resolved.imports.length,
    capabilityCount: resolved.capabilityRefs.length,
    diagnosticCount: health.diagnostics.length,
    retryAttempt: health.nextRetry?.attempt ?? toNonNegativeInteger(options.attempt ?? input.attempt, 0),
    restartSafe: health.restartSafe
  };
  const timeline = [...previous.timeline, event].slice(-toPositiveInteger(options.historyLimit, 10));
  const statusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const summary = {
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    sourceName,
    status: health.status,
    restartSafe: health.restartSafe,
    degradedMode: health.degradedMode,
    totalImports: counters.totalImports,
    builtinImports: counters.builtinImports,
    customImports: counters.customImports,
    unresolvedImports: counters.unresolvedImports,
    duplicateAliases: counters.duplicateAliases,
    unsafeHandoffs: counters.unsafeHandoffs,
    statusChannels: resolved.statusChannels,
    topCapabilities: rankImportCapabilities(resolved.imports),
    actionableErrorCount: health.actionableErrors.length,
    nextRetry: health.nextRetry
  };

  return {
    ok: health.ok,
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    counters,
    history: {
      sequence: event.sequence,
      timeline,
      statusCounts
    },
    exportSummary: summary,
    report: {
      title: 'mailchimp_import_resolution',
      status: health.status,
      rows: resolved.imports.map((item) => ({
        alias: item.alias,
        specifier: item.specifier,
        kind: item.kind,
        capabilities: item.capabilities.length,
        statusChannel: item.statusChannel,
        handoffSafe: item.handoffSafe
      })),
      actionableErrors: health.actionableErrors
    },
    diagnostics: health.diagnostics
  };
}

export function buildImportHistoryExport(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const analytics = buildImportAnalyticsSnapshot(resolved, {
    ...options,
    health,
    previousAnalytics: options.previousAnalytics ?? input.previousAnalytics
  });
  const previous = normalizeImportHistoryExport(options.previousHistoryExport ?? options.previousExport ?? input.previousHistoryExport);
  const historyLimit = toPositiveInteger(options.historyLimit ?? options.exportHistoryLimit, 12);
  const now = clean(options.now ?? options.timestamp) || null;
  const currentRows = resolved.imports.map((item) => ({
    alias: item.alias,
    specifier: item.specifier,
    kind: item.kind,
    capabilityRefs: [...item.capabilities].sort(),
    statusChannel: item.statusChannel,
    handoffSafe: item.handoffSafe,
    exportKey: `${item.alias}:${item.specifier}`
  }));
  const currentIndex = indexImportExportRows(currentRows);
  const previousIndex = indexImportExportRows(previous.snapshot.imports);
  const addedImports = currentRows
    .filter((row) => !previousIndex[row.exportKey])
    .map((row) => row.exportKey)
    .sort();
  const removedImports = previous.snapshot.imports
    .filter((row) => !currentIndex[row.exportKey])
    .map((row) => row.exportKey)
    .sort();
  const changedImports = currentRows
    .filter((row) => {
      const prior = previousIndex[row.exportKey];
      return prior && importExportRowFingerprint(prior) !== importExportRowFingerprint(row);
    })
    .map((row) => ({
      exportKey: row.exportKey,
      from: previousIndex[row.exportKey] ? {
        capabilityRefs: previousIndex[row.exportKey].capabilityRefs,
        statusChannel: previousIndex[row.exportKey].statusChannel,
        handoffSafe: previousIndex[row.exportKey].handoffSafe
      } : null,
      to: {
        capabilityRefs: row.capabilityRefs,
        statusChannel: row.statusChannel,
        handoffSafe: row.handoffSafe
      }
    }))
    .sort((left, right) => left.exportKey.localeCompare(right.exportKey));
  const fingerprint = importHistoryFingerprint({
    rows: currentRows,
    status: health.status,
    restartSafe: health.restartSafe,
    diagnosticErrors: analytics.counters.diagnostics.errors,
    diagnosticWarnings: analytics.counters.diagnostics.warnings
  });
  const previousFingerprint = clean(previous.fingerprint);
  const changed = previousFingerprint ? previousFingerprint !== fingerprint : currentRows.length > 0 || health.diagnostics.length > 0;
  const sequence = toNonNegativeInteger(previous.sequence, 0) + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: now,
    status: health.status,
    fingerprint,
    importCount: currentRows.length,
    addedImports: addedImports.length,
    removedImports: removedImports.length,
    changedImports: changedImports.length,
    unsafeHandoffs: analytics.counters.unsafeHandoffs,
    diagnosticErrors: analytics.counters.diagnostics.errors,
    restartSafe: health.restartSafe,
    changed
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-historyLimit);
  const timelineStatusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const firstRetainedSequence = timeline[0]?.sequence ?? sequence;
  const diagnostics = [
    ...health.diagnostics,
    ...(previous.schemaVersion && previous.schemaVersion !== IMPORT_SYNTAX_SCHEMA_VERSION
      ? [{
        level: 'warning',
        code: 'import_history_export_schema_mismatch',
        subject: previous.schemaVersion
      }]
      : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : health.status === 'degraded' || changedImports.some((item) => item.to.handoffSafe !== true)
      ? 'degraded'
      : health.status;
  const nextAction = status === 'blocked'
    ? 'operator_import_history_review'
    : status === 'degraded'
      ? 'publish_import_history_degraded_status'
      : changed
        ? 'publish_import_history_delta'
        : 'reuse_import_history_export';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'healthy' && health.restartSafe,
    sequence,
    fingerprint,
    snapshot: {
      generatedAt: now,
      sourceName: analytics.exportSummary.sourceName,
      imports: currentRows,
      capabilityRefs: resolved.capabilityRefs,
      statusChannels: resolved.statusChannels,
      health: {
        status: health.status,
        restartSafe: health.restartSafe,
        degradedMode: health.degradedMode,
        nextRetry: health.nextRetry
      }
    },
    deltas: {
      changed,
      previousFingerprint: previousFingerprint || null,
      addedImports,
      removedImports,
      changedImports,
      unsafeHandoffAliases: currentRows
        .filter((row) => row.handoffSafe !== true)
        .map((row) => row.alias)
        .sort()
    },
    counters: {
      ...analytics.counters,
      addedImports: addedImports.length,
      removedImports: removedImports.length,
      changedImports: changedImports.length,
      retainedTimelineEvents: timeline.length,
      compactedBeforeSequence: firstRetainedSequence > 1 ? firstRetainedSequence - 1 : 0
    },
    history: {
      sequence,
      timeline,
      statusCounts: timelineStatusCounts,
      analyticsTimeline: analytics.history.timeline
    },
    report: {
      title: 'mailchimp_import_history_export',
      status,
      rows: currentRows.map((row) => ({
        alias: row.alias,
        specifier: row.specifier,
        kind: row.kind,
        capabilityCount: row.capabilityRefs.length,
        statusChannel: row.statusChannel,
        handoffSafe: row.handoffSafe,
        delta: addedImports.includes(row.exportKey)
          ? 'added'
          : changedImports.some((item) => item.exportKey === row.exportKey)
            ? 'changed'
            : 'unchanged'
      })),
      removedImports,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_history_export',
      status,
      restartSafe: status === 'healthy' && health.restartSafe,
      sequence,
      fingerprint,
      importCount: currentRows.length,
      capabilityCount: resolved.capabilityRefs.length,
      statusChannels: resolved.statusChannels,
      addedImports: addedImports.length,
      removedImports: removedImports.length,
      changedImports: changedImports.length,
      unsafeHandoffs: analytics.counters.unsafeHandoffs,
      diagnosticErrors: analytics.counters.diagnostics.errors,
      diagnosticWarnings: analytics.counters.diagnostics.warnings,
      nextRetry: health.nextRetry,
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-history',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-history',
      publish: changed || status !== 'healthy',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeDeltas: addedImports.length + removedImports.length + changedImports.length > 0,
      includeTimeline: true,
      nextAction
    },
    diagnostics
  };
}

export function buildImportTimelineReport(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const analytics = options.analytics ?? buildImportAnalyticsSnapshot(resolved, {
    ...options,
    health,
    previousAnalytics: options.previousAnalytics ?? input.previousAnalytics
  });
  const historyExport = options.historyExport ?? buildImportHistoryExport(resolved, {
    ...options,
    health,
    previousAnalytics: options.previousAnalytics ?? input.previousAnalytics,
    previousHistoryExport: options.previousHistoryExport ?? input.previousHistoryExport
  });
  const lifecycle = options.lifecycle ?? buildImportLifecycleControlState(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? input.previousLifecycle,
    command: options.command ?? input.command,
    settings: options.settings ?? input.settings
  });
  const providerReadiness = options.providerReadiness ?? options.importProviderReadiness ?? null;
  const providerSyncCheckpoint = options.providerSyncCheckpoint ?? options.importProviderSyncCheckpoint ?? null;
  const previous = normalizeImportTimelineReportHistory(options.previousTimelineReport ?? input.previousTimelineReport);
  const historyLimit = toPositiveInteger(options.timelineLimit ?? options.historyLimit, 16);
  const now = clean(options.now ?? options.timestamp) || null;
  const providerStatus = clean(providerReadiness?.status) || 'not_evaluated';
  const providerSyncStatus = clean(providerSyncCheckpoint?.status) || 'not_evaluated';
  const reportRows = resolved.imports.map((item) => {
    const historyRow = (historyExport.snapshot?.imports ?? []).find((row) => row.alias === item.alias) ?? {};
    const providerRow = (providerReadiness?.rows ?? []).find((row) => row.alias === item.alias || row.specifier === item.specifier) ?? {};
    const syncRow = (providerSyncCheckpoint?.rows ?? []).find((row) => row.alias === item.alias || row.specifier === item.specifier) ?? {};
    const diagnosticSubjects = health.diagnostics
      .filter((diagnostic) => diagnostic.subject === item.alias || diagnostic.subject === item.specifier)
      .map((diagnostic) => diagnostic.code);
    const blocked = item.handoffSafe !== true
      || providerRow.status === 'blocked'
      || syncRow.status === 'blocked'
      || diagnosticSubjects.some((code) => code.includes('duplicate') || code.includes('unresolved'));
    const degraded = blocked !== true && (
      health.status === 'degraded'
      || providerRow.status === 'degraded'
      || syncRow.status === 'degraded'
      || lifecycle.status === 'retry_scheduled'
      || lifecycle.status === 'paused'
    );

    return {
      alias: item.alias,
      specifier: item.specifier,
      kind: item.kind,
      status: blocked ? 'blocked' : degraded ? 'degraded' : 'ready',
      capabilities: item.capabilities,
      capabilityCount: item.capabilities.length,
      statusChannel: item.statusChannel,
      handoffSafe: item.handoffSafe,
      delta: historyExport.deltas?.addedImports?.includes(historyRow.exportKey)
        ? 'added'
        : (historyExport.deltas?.changedImports ?? []).some((change) => change.exportKey === historyRow.exportKey)
          ? 'changed'
          : 'unchanged',
      providerStatus: providerRow.status ?? providerStatus,
      providerSyncStatus: syncRow.status ?? providerSyncStatus,
      diagnostics: diagnosticSubjects,
      nextAction: blocked
        ? item.handoffSafe !== true
          ? 'route_import_timeline_status_to_kernel'
          : 'resolve_import_timeline_blocker'
        : degraded
          ? 'publish_import_timeline_degraded_status'
          : historyExport.deltas?.changed === true
            ? 'publish_import_timeline_delta'
            : 'reuse_import_timeline'
    };
  });
  const blockedRows = reportRows.filter((row) => row.status === 'blocked');
  const degradedRows = reportRows.filter((row) => row.status === 'degraded');
  const status = health.status === 'blocked' || historyExport.status === 'blocked' || blockedRows.length > 0
    ? 'blocked'
    : health.status === 'degraded' || historyExport.status === 'degraded' || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = importTimelineReportFingerprint({
    resolved,
    health,
    historyExport,
    lifecycle,
    providerStatus,
    providerSyncStatus,
    reportRows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = toNonNegativeInteger(previous.sequence, 0) + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: now,
    status,
    fingerprint,
    importCount: reportRows.length,
    blockedImports: blockedRows.length,
    degradedImports: degradedRows.length,
    changedImports: historyExport.counters?.changedImports ?? 0,
    unsafeHandoffs: analytics.counters?.unsafeHandoffs ?? 0,
    providerStatus,
    providerSyncStatus,
    restartSafe: status === 'ready' && health.restartSafe === true && historyExport.restartSafe === true
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-historyLimit);
  const statusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const diagnostics = [
    ...health.diagnostics,
    ...historyExport.diagnostics.filter((item) => item.level === 'error'),
    ...(providerReadiness?.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(providerSyncCheckpoint?.diagnostics ?? []).filter((item) => item.level === 'error')
  ];
  const nextAction = status === 'blocked'
    ? 'resolve_import_timeline_report_blockers'
    : status === 'degraded'
      ? 'publish_import_timeline_report_degraded'
      : changed
        ? 'publish_import_timeline_report_delta'
        : 'reuse_import_timeline_report';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready' && health.restartSafe === true && historyExport.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    counters: {
      imports: reportRows.length,
      blockedImports: blockedRows.length,
      degradedImports: degradedRows.length,
      changedImports: historyExport.counters?.changedImports ?? 0,
      addedImports: historyExport.counters?.addedImports ?? 0,
      removedImports: historyExport.counters?.removedImports ?? 0,
      unsafeHandoffs: analytics.counters?.unsafeHandoffs ?? 0,
      diagnostics: analytics.counters?.diagnostics ?? { errors: 0, warnings: 0, info: 0 },
      retainedTimelineEvents: timeline.length
    },
    history: {
      sequence,
      timeline,
      statusCounts,
      importHistoryTimeline: historyExport.history?.timeline ?? [],
      analyticsTimeline: analytics.history?.timeline ?? []
    },
    report: {
      title: 'mailchimp_import_timeline_report',
      status,
      rows: reportRows,
      blockedImports: blockedRows.map((row) => row.alias).sort(),
      degradedImports: degradedRows.map((row) => row.alias).sort(),
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_timeline_report',
      status,
      restartSafe: status === 'ready' && health.restartSafe === true && historyExport.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      importCount: reportRows.length,
      statusChannels: resolved.statusChannels,
      capabilityRefs: resolved.capabilityRefs,
      blockedImports: blockedRows.map((row) => row.alias).sort(),
      degradedImports: degradedRows.map((row) => row.alias).sort(),
      providerStatus,
      providerSyncStatus,
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-timeline',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-timeline',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || changed,
      includeHistory: true,
      nextAction
    },
    diagnostics
  };
}

export function buildImportLifecycleControlState(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const previous = normalizeImportLifecycleState(options.previousLifecycle ?? options.previousState ?? input.previousLifecycle);
  const settings = normalizeImportLifecycleSettings(options.settings ?? input.settings ?? options);
  const command = normalizeImportLifecycleCommand(options.command ?? input.command);
  const commandKey = clean(command.commandKey ?? options.commandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...(options.appliedCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const repeatedCommand = commandKey && seenCommands.has(commandKey);
  const settingDiagnostics = validateImportLifecycleSettings(settings);
  const commandDiagnostics = validateImportLifecycleCommand(command, {
    health,
    settings,
    previous,
    repeatedCommand
  });
  const diagnostics = [
    ...health.diagnostics,
    ...settingDiagnostics,
    ...commandDiagnostics,
    ...(previous.scheduledRetryCount >= settings.maxScheduledRetries && clean(command.action).toLowerCase() === 'retry'
      ? [{
        level: 'error',
        code: 'import_lifecycle_retry_budget_exhausted',
        subject: String(settings.maxScheduledRetries)
      }]
      : []),
    ...(repeatedCommand ? [{
      level: 'info',
      code: 'import_lifecycle_command_already_applied',
      subject: commandKey
    }] : [])
  ];
  const hasErrors = diagnostics.some((item) => item.level === 'error');
  const transition = deriveImportLifecycleTransition({
    command,
    health,
    previous,
    settings,
    repeatedCommand,
    hasErrors
  });
  const generation = previous.fingerprint === transition.fingerprint
    ? toNonNegativeInteger(previous.generation, 0)
    : toNonNegativeInteger(previous.generation, 0) + 1;

  return {
    ok: !hasErrors,
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status: transition.status,
    enabled: transition.enabled,
    schedule: transition.schedule,
    generation,
    fingerprint: transition.fingerprint,
    settings,
    nextAction: transition.nextAction,
    controls: {
      canEnable: transition.status === 'disabled' || transition.status === 'paused',
      canDisable: transition.status !== 'disabled',
      canRetry: health.retryable === true && health.nextRetry !== null && settings.enabled === true,
      canPause: transition.status === 'enabled' || transition.status === 'retry_scheduled',
      canResume: transition.status === 'paused',
      automaticRetriesRemaining: Math.max(0, settings.maxScheduledRetries - transition.scheduledRetryCount)
    },
    idempotency: {
      commandKey: commandKey || null,
      repeated: Boolean(repeatedCommand),
      applied: Boolean(commandKey) && !repeatedCommand && !hasErrors,
      appliedCommandKeys: commandKey && !repeatedCommand && !hasErrors
        ? [...seenCommands, commandKey].sort()
        : [...seenCommands].sort()
    },
    handoff: {
      target: 'kernel.status.mailchimp.imports',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.imports',
      publish: transition.status !== 'disabled',
      includeActionableErrors: health.actionableErrors.length > 0,
      includeNextRetry: Boolean(health.nextRetry)
    },
    diagnostics
  };
}

export function buildImportGateLifecycleControlPlan(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const lifecycle = buildImportLifecycleControlState(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? input.previousLifecycle,
    command: options.command ?? input.command,
    settings: options.settings ?? input.settings
  });
  const settings = normalizeImportGateControlSettings(options.gateControlSettings ?? options.settings ?? input.gateControlSettings);
  const featureBoundary = normalizeFeatureBoundaryControl(options.featureBoundary ?? options.featureGateBoundary ?? input.featureBoundary);
  const requiredGateByKind = {
    profile: 'mailchimpRead',
    'feature-gates': 'adapterStatusHandoff',
    recovery: 'adapterStatusHandoff'
  };
  const rows = resolved.imports.map((item) => {
    const requiredGate = clean(options.requiredGateBySpecifier?.[item.specifier]) || requiredGateByKind[item.kind] || 'mailchimpRead';
    const gateEnabled = featureBoundary.gates[requiredGate] !== false;
    const boundaryBlocked = featureBoundary.blockedRows.some((row) => (
      row === `gate:${requiredGate}`
      || row === `import:${item.alias}`
      || row === item.specifier
      || row === item.alias
    ));
    const boundaryDegraded = featureBoundary.degradedRows.some((row) => (
      row === `gate:${requiredGate}`
      || row === `import:${item.alias}`
      || row === item.specifier
      || row === item.alias
    ));
    const disabledByLifecycle = lifecycle.enabled !== true;
    const blocked = boundaryBlocked || !gateEnabled || disabledByLifecycle && settings.allowDisabledImports !== true;
    const degraded = !blocked && (
      boundaryDegraded
      || health.status === 'degraded'
      || lifecycle.status === 'retry_scheduled'
      || lifecycle.status === 'paused'
      || item.handoffSafe !== true
    );
    return {
      alias: item.alias,
      specifier: item.specifier,
      kind: item.kind,
      requiredGate,
      gateEnabled,
      lifecycleStatus: lifecycle.status,
      status: blocked ? 'blocked' : degraded ? 'degraded' : 'ready',
      controls: {
        canEnable: lifecycle.controls.canEnable && gateEnabled && boundaryBlocked !== true,
        canDisable: lifecycle.controls.canDisable,
        canRetry: lifecycle.controls.canRetry && gateEnabled,
        canPause: lifecycle.controls.canPause,
        canResume: lifecycle.controls.canResume && (settings.allowDegradedGateResume === true || boundaryDegraded !== true)
      },
      nextAction: blocked
        ? !gateEnabled
          ? `enable_feature_gate:${requiredGate}`
          : disabledByLifecycle
            ? 'enable_import_lifecycle'
            : 'resolve_import_gate_boundary'
        : degraded
          ? item.handoffSafe !== true
            ? 'route_import_status_to_kernel'
            : 'publish_import_gate_degraded_status'
          : 'include_import_gate_control'
    };
  });
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded');
  const diagnostics = [
    ...health.diagnostics,
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...(settings.requireGateAlignment && featureBoundary.status === 'missing'
      ? [{ level: 'error', code: 'import_gate_boundary_missing', subject: 'featureBoundary' }]
      : []),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'import_gate_lifecycle_blocked',
      subject: `${row.alias}:${row.requiredGate}`
    })),
    ...degradedRows.map((row) => ({
      level: 'warning',
      code: 'import_gate_lifecycle_degraded',
      subject: `${row.alias}:${row.requiredGate}`
    }))
  ];
  const status = diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_import_gate_lifecycle_blockers'
    : status === 'degraded'
      ? 'publish_import_gate_lifecycle_advisory'
      : lifecycle.nextAction;

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready' && health.restartSafe && lifecycle.ok && featureBoundary.restartSafe !== false,
    settings,
    lifecycle: {
      status: lifecycle.status,
      enabled: lifecycle.enabled,
      generation: lifecycle.generation,
      fingerprint: lifecycle.fingerprint,
      nextAction: lifecycle.nextAction,
      controls: lifecycle.controls,
      schedule: lifecycle.schedule
    },
    featureBoundary: {
      status: featureBoundary.status,
      restartSafe: featureBoundary.restartSafe,
      blockedRows: featureBoundary.blockedRows,
      degradedRows: featureBoundary.degradedRows
    },
    rows,
    controls: {
      canEnableAll: rows.every((row) => row.controls.canEnable),
      canDisableAny: rows.some((row) => row.controls.canDisable),
      canRetryAny: rows.some((row) => row.controls.canRetry),
      canResumeAll: rows.every((row) => row.controls.canResume || row.status === 'ready')
    },
    validationSummary: {
      totalImports: rows.length,
      blockedImports: blockedRows.length,
      degradedImports: degradedRows.length,
      disabledByLifecycle: rows.filter((row) => row.lifecycleStatus === 'disabled').length,
      missingGateAlignment: rows.filter((row) => row.gateEnabled !== true).length,
      unsafeHandoffs: resolved.imports.filter((item) => item.handoffSafe !== true).length
    },
    nextAction,
    handoff: {
      target: 'kernel.status.mailchimp.import-gate-lifecycle',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-gates',
      publish: status !== 'ready' || lifecycle.handoff.publish,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_gate_lifecycle_controls',
      status,
      restartSafe: status === 'ready' && health.restartSafe,
      blockedImports: blockedRows.map((row) => row.alias),
      degradedImports: degradedRows.map((row) => row.alias),
      nextAction
    },
    diagnostics
  };
}

export function buildImportPreviewAcceptanceState(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const analytics = buildImportAnalyticsSnapshot(resolved, {
    ...options,
    health,
    previousAnalytics: options.previousAnalytics ?? input.previousAnalytics
  });
  const lifecycle = buildImportLifecycleControlState(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? input.previousLifecycle,
    command: options.lifecycleCommand ?? options.command,
    settings: options.lifecycleSettings ?? options.settings
  });
  const acceptance = normalizeImportAcceptance(options.acceptance ?? input.acceptance);
  const requiredAliases = normalizeList(options.requiredAliases ?? input.requiredAliases);
  const acceptedAliases = acceptance.acceptedAliases;
  const rejectedAliases = acceptance.rejectedAliases;
  const previewRows = resolved.imports.map((item) => {
    const required = requiredAliases.length === 0 || requiredAliases.includes(item.alias);
    const accepted = acceptedAliases.includes(item.alias);
    const rejected = rejectedAliases.includes(item.alias);
    const healthIssue = health.actionableErrors.find((error) => error.subject === item.specifier || error.subject === item.alias);
    return {
      alias: item.alias,
      specifier: item.specifier,
      kind: item.kind,
      required,
      accepted,
      rejected,
      statusChannel: item.statusChannel,
      handoffSafe: item.handoffSafe,
      capabilities: item.capabilities,
      previewStatus: rejected
        ? 'rejected'
        : !item.handoffSafe
          ? 'needs_status_handoff'
          : required && !accepted
            ? 'awaiting_acceptance'
            : healthIssue
              ? 'needs_attention'
              : 'ready',
      nextStep: rejected
        ? 'remove_or_reaccept_import'
        : !item.handoffSafe
          ? 'route_import_status_to_kernel'
          : required && !accepted
            ? 'accept_import_preview'
            : healthIssue
              ? healthIssue.action
              : 'include_in_export'
    };
  });
  const requiredRows = previewRows.filter((row) => row.required);
  const missingAcceptance = requiredRows.filter((row) => row.accepted !== true && row.rejected !== true);
  const rejectedRequired = requiredRows.filter((row) => row.rejected === true);
  const unsafeRequired = requiredRows.filter((row) => row.handoffSafe !== true);
  const validationSummary = {
    totalImports: previewRows.length,
    requiredImports: requiredRows.length,
    acceptedRequired: requiredRows.filter((row) => row.accepted).length,
    rejectedRequired: rejectedRequired.length,
    awaitingAcceptance: missingAcceptance.length,
    unsafeRequiredHandoffs: unsafeRequired.length,
    actionableErrors: health.actionableErrors.length,
    lifecycleStatus: lifecycle.status,
    diagnosticErrors: health.diagnostics.filter((item) => item.level === 'error').length,
    diagnosticWarnings: health.diagnostics.filter((item) => item.level === 'warning').length
  };
  const acceptanceStatus = deriveImportAcceptanceStatus({
    health,
    lifecycle,
    validationSummary,
    requireExplicitAcceptance: acceptance.requireExplicitAcceptance
  });
  const diagnostics = [
    ...health.diagnostics,
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...rejectedRequired.map((row) => ({
      level: 'error',
      code: 'required_import_preview_rejected',
      subject: row.alias
    })),
    ...missingAcceptance.map((row) => ({
      level: acceptance.requireExplicitAcceptance ? 'error' : 'warning',
      code: 'required_import_preview_not_accepted',
      subject: row.alias
    }))
  ];

  return {
    ok: acceptanceStatus.status !== 'blocked' && !diagnostics.some((item) => item.level === 'error'),
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    sourceName: clean(options.sourceName ?? input.sourceName) || 'inline.imports.aios',
    status: diagnostics.some((item) => item.level === 'error') ? 'blocked' : acceptanceStatus.status,
    preview: {
      rows: previewRows,
      requiredAliases: requiredAliases.length > 0 ? requiredAliases : previewRows.map((row) => row.alias),
      acceptedAliases,
      rejectedAliases
    },
    validationSummary,
    readiness: {
      ...acceptanceStatus,
      acceptedAt: acceptance.acceptedAt,
      acceptedBy: acceptance.acceptedBy,
      requireExplicitAcceptance: acceptance.requireExplicitAcceptance
    },
    explanation: {
      headline: acceptanceStatus.status === 'ready'
        ? 'mailchimp_import_preview_ready'
        : acceptanceStatus.status === 'degraded'
          ? 'mailchimp_import_preview_needs_attention'
          : 'mailchimp_import_preview_blocked',
      nextSteps: unique(previewRows
        .filter((row) => row.previewStatus !== 'ready')
        .map((row) => row.nextStep)
        .concat(acceptanceStatus.nextAction))
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      status: diagnostics.some((item) => item.level === 'error') ? 'blocked' : acceptanceStatus.status,
      importCount: previewRows.length,
      acceptedRequired: validationSummary.acceptedRequired,
      requiredImports: validationSummary.requiredImports,
      awaitingAcceptance: validationSummary.awaitingAcceptance,
      unsafeRequiredHandoffs: validationSummary.unsafeRequiredHandoffs,
      lifecycleStatus: lifecycle.status,
      restartSafe: health.restartSafe && lifecycle.ok && acceptanceStatus.status === 'ready',
      statusChannels: resolved.statusChannels,
      nextAction: acceptanceStatus.nextAction,
      analytics: analytics.exportSummary
    },
    diagnostics
  };
}

export function buildImportTenantBoundaryAcceptance(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const providerContract = buildImportProviderContract(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? input.requestedCapabilities
  });
  const acceptance = normalizeImportBoundaryAcceptance(options.acceptance ?? input.boundaryAcceptance ?? input.acceptance);
  const scope = normalizeImportBoundaryScope(options.scope ?? input.scope ?? options);
  const importScopes = normalizeImportScopeCatalog(options.importScopes ?? input.importScopes);
  const rows = resolved.imports.map((item) => {
    const declared = importScopes[item.alias] ?? importScopes[item.specifier] ?? {};
    const tenantId = clean(declared.tenantId ?? declared.tenant ?? scope.tenantId);
    const workspaceId = clean(declared.workspaceId ?? declared.workspace ?? scope.workspaceId);
    const role = clean(declared.role ?? scope.role);
    const permissionMode = clean(declared.permissionMode ?? scope.permissionMode);
    const requestedTenantId = clean(declared.requestedTenantId ?? scope.requestedTenantId);
    const requestedWorkspaceId = clean(declared.requestedWorkspaceId ?? scope.requestedWorkspaceId);
    const accepted = acceptance.acceptedImports.includes(item.alias) || acceptance.acceptedImports.includes(item.specifier);
    const crossTenant = requestedTenantId && requestedTenantId !== tenantId;
    const crossWorkspace = requestedWorkspaceId && requestedWorkspaceId !== workspaceId;
    const provider = providerContract.providers.find((entry) => entry.alias === item.alias);
    const providerMissing = provider?.capabilities?.missing ?? [];
    const status = crossTenant || providerMissing.length > 0
      ? 'blocked'
      : crossWorkspace || item.handoffSafe !== true || provider?.handoffSafe === false
        ? 'degraded'
        : 'ready';

    return {
      alias: item.alias,
      specifier: item.specifier,
      kind: item.kind,
      tenantId,
      workspaceId,
      role,
      permissionMode,
      requestedTenantId: requestedTenantId || null,
      requestedWorkspaceId: requestedWorkspaceId || null,
      accepted,
      status,
      isolation: {
        tenant: crossTenant ? 'blocked' : 'enforced',
        workspace: crossWorkspace ? 'advisory' : 'enforced',
        handoffSafe: item.handoffSafe === true && provider?.handoffSafe !== false
      },
      provider: {
        status: provider?.capabilities?.negotiation ?? 'unknown',
        missingCapabilities: providerMissing,
        statusChannel: provider?.statusChannel ?? item.statusChannel,
        handoffTarget: provider?.externalHandoff?.target ?? null
      },
      nextStep: crossTenant
        ? 'block_cross_tenant_import'
        : providerMissing.length > 0
          ? 'repair_import_provider_capabilities'
          : item.handoffSafe !== true || provider?.handoffSafe === false
            ? 'route_import_handoff_to_kernel'
            : acceptance.requireExplicitAcceptance && !accepted
              ? 'accept_import_boundary'
              : 'include_import_boundary'
    };
  });
  const requiredRows = rows.filter((row) => acceptance.requiredImports.length === 0
    || acceptance.requiredImports.includes(row.alias)
    || acceptance.requiredImports.includes(row.specifier));
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const degradedRows = requiredRows.filter((row) => row.status === 'degraded');
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true);
  const crossTenantRows = requiredRows.filter((row) => row.isolation.tenant === 'blocked');
  const diagnostics = [
    ...health.diagnostics,
    ...providerContract.diagnostics.filter((item) => item.level === 'error'),
    ...crossTenantRows.map((row) => ({
      level: 'error',
      code: 'import_boundary_cross_tenant_blocked',
      subject: `${row.requestedTenantId}->${row.tenantId}:${row.alias}`
    })),
    ...degradedRows
      .filter((row) => row.isolation.workspace === 'advisory')
      .map((row) => ({
        level: 'warning',
        code: 'import_boundary_workspace_advisory',
        subject: `${row.requestedWorkspaceId}->${row.workspaceId}:${row.alias}`
      })),
    ...(acceptance.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => ({
        level: 'error',
        code: 'import_boundary_acceptance_missing',
        subject: row.alias
      }))
      : awaitingAcceptance.map((row) => ({
        level: 'warning',
        code: 'import_boundary_acceptance_pending',
        subject: row.alias
      })))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready' && health.restartSafe && providerContract.restartSafe,
    scope: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      requestedTenantId: scope.requestedTenantId || null,
      requestedWorkspaceId: scope.requestedWorkspaceId || null,
      role: scope.role,
      permissionMode: scope.permissionMode
    },
    preview: {
      rows,
      requiredImports: acceptance.requiredImports.length > 0
        ? acceptance.requiredImports
        : rows.map((row) => row.alias),
      acceptedImports: acceptance.acceptedImports,
      acceptedAt: acceptance.acceptedAt,
      acceptedBy: acceptance.acceptedBy,
      requireExplicitAcceptance: acceptance.requireExplicitAcceptance
    },
    validationSummary: {
      totalImports: rows.length,
      requiredImports: requiredRows.length,
      blockedImports: blockedRows.length,
      degradedImports: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      crossTenantBlocked: crossTenantRows.length,
      providerCapabilityGaps: requiredRows.reduce((count, row) => count + row.provider.missingCapabilities.length, 0),
      unsafeHandoffs: requiredRows.filter((row) => row.isolation.handoffSafe !== true).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: unique([
        ...blockedRows.map((row) => row.alias),
        ...crossTenantRows.map((row) => `cross_tenant:${row.alias}`)
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.alias),
        ...(!acceptance.requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction: status === 'blocked'
        ? 'resolve_import_boundary_blockers'
        : status === 'degraded'
          ? 'publish_import_boundary_degraded_status'
          : 'publish_import_boundary_ready'
    },
    auditHandoff: {
      target: 'kernel.audit.mailchimp.import-boundary',
      subject: `${scope.tenantId}/${scope.workspaceId}/imports`,
      decision: status,
      includeRows: true,
      includeProviderCapabilityGaps: providerContract.capabilityNegotiation?.missingCapabilities?.length > 0,
      includeAcceptance: awaitingAcceptance.length > 0
    },
    explanation: {
      headline: status === 'ready'
        ? 'mailchimp_import_boundary_ready'
        : status === 'degraded'
          ? 'mailchimp_import_boundary_needs_attention'
          : 'mailchimp_import_boundary_blocked',
      nextSteps: unique(rows
        .filter((row) => row.status !== 'ready' || row.accepted !== true)
        .map((row) => row.nextStep))
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      status,
      restartSafe: status === 'ready' && providerContract.restartSafe,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      awaitingAcceptance: awaitingAcceptance.map((row) => row.alias),
      blockedImports: blockedRows.map((row) => row.alias),
      degradedImports: degradedRows.map((row) => row.alias),
      auditSubject: `${scope.tenantId}/${scope.workspaceId}/imports`,
      nextAction: status === 'ready' ? 'publish_import_boundary_ready' : 'review_import_boundary'
    },
    diagnostics
  };
}

export function buildImportClientWorkflowHandoff(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const lifecycle = buildImportLifecycleControlState(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings
  });
  const preview = buildImportPreviewAcceptanceState(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    lifecycleCommand: options.command ?? options.importCommand,
    lifecycleSettings: options.settings ?? options.importSettings,
    acceptance: options.acceptance ?? options.importAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases
  });
  const boundary = buildImportTenantBoundaryAcceptance(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs,
    importScopes: options.importScopes,
    scope: options.scope ?? {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    },
    acceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance
  });
  const provider = buildImportProviderContract(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const analytics = buildImportAnalyticsSnapshot(resolved, {
    ...options,
    health,
    previousAnalytics: options.previousAnalytics ?? options.previousImportAnalytics
  });
  const rows = [
    {
      id: 'import_resolution',
      label: 'Import resolution',
      status: health.status,
      visibleToClient: health.status !== 'healthy' || health.actionableErrors.length > 0,
      nextAction: health.status === 'blocked'
        ? 'operator_import_resolution_review'
        : health.status === 'degraded'
          ? 'publish_import_resolution_degraded'
          : 'include_import_resolution',
      evidence: {
        importCount: resolved.imports.length,
        missingImports: health.actionableErrors
          .filter((item) => item.code === 'install_or_map_import')
          .map((item) => item.subject),
        nextRetry: health.nextRetry
      }
    },
    {
      id: 'import_lifecycle',
      label: 'Import lifecycle',
      status: lifecycle.status,
      visibleToClient: lifecycle.handoff.publish !== false,
      nextAction: lifecycle.nextAction,
      evidence: {
        controls: lifecycle.controls,
        schedule: lifecycle.schedule
      }
    },
    {
      id: 'import_preview',
      label: 'Import preview',
      status: preview.status,
      visibleToClient: preview.status !== 'ready' || preview.validationSummary.awaitingAcceptance > 0,
      nextAction: preview.readiness.nextAction,
      evidence: {
        awaitingAcceptance: preview.validationSummary.awaitingAcceptance,
        unsafeRequiredHandoffs: preview.validationSummary.unsafeRequiredHandoffs,
        acceptedRequired: preview.validationSummary.acceptedRequired
      }
    },
    {
      id: 'import_boundary',
      label: 'Import boundary',
      status: boundary.status,
      visibleToClient: boundary.status !== 'ready' || boundary.validationSummary.awaitingAcceptance > 0,
      nextAction: boundary.readiness.nextAction,
      evidence: {
        tenantId: boundary.scope.tenantId,
        workspaceId: boundary.scope.workspaceId,
        crossTenantBlocked: boundary.validationSummary.crossTenantBlocked,
        auditSubject: boundary.auditHandoff.subject
      }
    },
    {
      id: 'import_provider',
      label: 'Import provider',
      status: provider.status,
      visibleToClient: provider.status !== 'ready',
      nextAction: provider.status === 'blocked'
        ? 'repair_import_provider_contract'
        : provider.status === 'degraded'
          ? 'publish_import_provider_degraded_status'
          : 'include_import_provider_contract',
      evidence: {
        missingCapabilities: provider.capabilityNegotiation.missingCapabilities,
        unsafeSpecifiers: provider.externalHandoff.unsafeSpecifiers,
        pendingSyncs: provider.syncMetadata.pendingSyncs
      }
    }
  ];
  const blockingRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => (
    row.status === 'degraded'
    || row.status === 'enabled_degraded'
    || row.status === 'retry_scheduled'
    || row.status === 'paused'
    || row.status === 'disabled'
  ));
  const diagnostics = [
    ...health.diagnostics,
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...preview.diagnostics.filter((item) => item.level === 'error'),
    ...boundary.diagnostics.filter((item) => item.level === 'error'),
    ...provider.diagnostics.filter((item) => item.level === 'error')
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockingRows.length > 0
    ? 'blocked'
    : degradedRows.length > 0
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready'
      && health.restartSafe
      && lifecycle.ok
      && preview.exportSummary.restartSafe
      && boundary.restartSafe
      && provider.restartSafe,
    rows,
    handoff: {
      target: 'kernel.status.mailchimp.imports',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.imports',
      publish: status !== 'ready' || rows.some((row) => row.visibleToClient),
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      nextAction: status === 'blocked'
        ? 'resolve_import_client_handoff_blockers'
        : status === 'degraded'
          ? 'publish_import_client_degraded_status'
          : 'publish_import_client_ready'
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      status,
      restartSafe: status === 'ready' && health.restartSafe,
      importCount: resolved.imports.length,
      blockingRows: blockingRows.map((row) => row.id),
      degradedRows: degradedRows.map((row) => row.id),
      statusChannels: resolved.statusChannels,
      actionableErrorCount: analytics.exportSummary.actionableErrorCount,
      nextRetry: health.nextRetry,
      nextAction: status === 'ready' ? 'publish_import_client_ready' : 'review_import_client_handoff'
    },
    diagnostics
  };
}

export function buildImportRuntimeAdoptionHandoff(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const lifecycle = buildImportLifecycleControlState(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings
  });
  const provider = buildImportProviderContract(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const client = buildImportClientWorkflowHandoff(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance
  });
  const previous = normalizeImportRuntimeAdoptionState(options.previousAdoption ?? options.previousRuntimeAdoption ?? input.previousAdoption);
  const requiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases);
  const rows = resolved.imports.map((item) => {
    const providerRow = provider.providers.find((entry) => entry.alias === item.alias);
    const required = requiredAliases.length === 0 || requiredAliases.includes(item.alias) || requiredAliases.includes(item.specifier);
    const providerMissing = providerRow?.capabilities?.missing ?? [];
    const status = providerMissing.length > 0
      ? 'blocked'
      : item.handoffSafe !== true || providerRow?.handoffSafe === false
        ? 'degraded'
        : lifecycle.status === 'disabled' || lifecycle.status === 'paused'
          ? lifecycle.status
          : 'ready';

    return {
      alias: item.alias,
      specifier: item.specifier,
      kind: item.kind,
      required,
      status,
      adopted: status === 'ready' && lifecycle.enabled === true,
      statusChannel: providerRow?.statusChannel ?? item.statusChannel,
      runtimeTarget: providerRow?.externalHandoff?.target ?? `kernel.provider.${item.alias}`,
      capabilities: {
        offered: providerRow?.capabilities?.offered ?? item.capabilities,
        missing: providerMissing
      },
      sync: providerRow?.sync ?? null,
      nextAction: providerMissing.length > 0
        ? 'repair_import_runtime_capabilities'
        : item.handoffSafe !== true || providerRow?.handoffSafe === false
          ? 'route_import_runtime_handoff_to_kernel'
          : lifecycle.status === 'disabled'
            ? 'enable_import_runtime'
            : lifecycle.status === 'paused'
              ? 'resume_import_runtime'
              : 'adopt_import_runtime'
    };
  });
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const degradedRows = requiredRows.filter((row) => row.status === 'degraded' || row.status === 'paused' || row.status === 'disabled');
  const fingerprint = importRuntimeAdoptionFingerprint({
    lifecycle,
    provider,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = toNonNegativeInteger(previous.sequence, 0) + (changed ? 1 : 0);
  const diagnostics = [
    ...health.diagnostics,
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...provider.diagnostics.filter((item) => item.level === 'error'),
    ...blockedRows.flatMap((row) => row.capabilities.missing.map((capability) => ({
      level: 'error',
      code: 'import_runtime_adoption_capability_missing',
      subject: `${row.alias}:${capability}`
    }))),
    ...degradedRows.map((row) => ({
      level: 'warning',
      code: 'import_runtime_adoption_guarded',
      subject: `${row.alias}:${row.status}`
    }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0 || health.status === 'degraded'
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_import_runtime_adoption_blockers'
    : lifecycle.status === 'retry_scheduled'
      ? 'dispatch_import_runtime_retry'
      : lifecycle.status === 'disabled'
        ? 'enable_import_runtime'
        : lifecycle.status === 'paused'
          ? 'resume_import_runtime'
          : status === 'degraded'
            ? 'publish_import_runtime_adoption_degraded_status'
            : changed
              ? 'publish_import_runtime_adoption_delta'
              : 'reuse_import_runtime_adoption';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready' && health.restartSafe && lifecycle.ok === true && provider.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows,
    lifecycle: {
      status: lifecycle.status,
      enabled: lifecycle.enabled,
      controls: lifecycle.controls,
      schedule: lifecycle.schedule,
      nextAction: lifecycle.nextAction
    },
    provider: {
      status: provider.status,
      capabilityNegotiation: provider.capabilityNegotiation,
      syncMetadata: provider.syncMetadata,
      externalHandoff: provider.externalHandoff
    },
    clientWorkflow: {
      status: client.status,
      restartSafe: client.restartSafe,
      nextAction: client.handoff?.nextAction ?? client.exportSummary?.nextAction,
      blockingRows: client.exportSummary?.blockingRows ?? [],
      degradedRows: client.exportSummary?.degradedRows ?? []
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.alias),
        ...(client.exportSummary?.blockingRows ?? []).map((row) => `client:${row}`)
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => `${row.alias}:${row.status}`),
        ...(client.exportSummary?.degradedRows ?? []).map((row) => `client:${row}`)
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-runtime',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-runtime',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeClientWorkflow: client.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      status,
      restartSafe: status === 'ready' && provider.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      adoptedImports: rows.filter((row) => row.adopted).map((row) => row.alias).sort(),
      blockedImports: blockedRows.map((row) => row.alias).sort(),
      degradedImports: degradedRows.map((row) => row.alias).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportClientAcceptancePackage(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const preview = buildImportPreviewAcceptanceState(resolved, {
    ...options,
    health,
    acceptance: options.acceptance ?? options.importAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    lifecycleCommand: options.command ?? options.importCommand,
    lifecycleSettings: options.settings ?? options.importSettings
  });
  const boundary = buildImportTenantBoundaryAcceptance(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs,
    importScopes: options.importScopes,
    scope: options.scope ?? {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
      requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
      role: options.role,
      permissionMode: options.permissionMode
    },
    acceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance
  });
  const runtime = buildImportRuntimeAdoptionHandoff(resolved, {
    ...options,
    health,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const acceptance = normalizeImportAcceptance(options.acceptance ?? options.importAcceptance ?? input.acceptance);
  const requiredAliases = preview.preview.requiredAliases;
  const rows = resolved.imports.map((item) => {
    const previewRow = preview.preview.rows.find((row) => row.alias === item.alias);
    const boundaryRow = boundary.preview.rows.find((row) => row.alias === item.alias);
    const runtimeRow = runtime.rows?.find((row) => row.alias === item.alias);
    const required = requiredAliases.includes(item.alias) || requiredAliases.includes(item.specifier);
    const accepted = acceptance.acceptedAliases.includes(item.alias) || acceptance.acceptedAliases.includes(item.specifier);
    const rejected = acceptance.rejectedAliases.includes(item.alias) || acceptance.rejectedAliases.includes(item.specifier);
    const status = rejected
      ? 'blocked'
      : boundaryRow?.status === 'blocked' || runtimeRow?.status === 'blocked' || previewRow?.previewStatus === 'needs_attention'
        ? 'blocked'
        : boundaryRow?.status === 'degraded' || runtimeRow?.status === 'degraded' || previewRow?.previewStatus === 'needs_status_handoff'
          ? 'degraded'
          : required && accepted !== true
            ? 'awaiting_acceptance'
            : 'ready';

    return {
      key: item.alias,
      label: item.specifier,
      required,
      accepted,
      rejected,
      status,
      kind: item.kind,
      nextStep: rejected
        ? 'remove_or_reaccept_import'
        : status === 'blocked'
          ? runtimeRow?.nextAction ?? boundaryRow?.nextStep ?? previewRow?.nextStep ?? 'repair_import_acceptance'
          : status === 'degraded'
            ? runtimeRow?.nextAction ?? boundaryRow?.nextStep ?? previewRow?.nextStep ?? 'publish_import_acceptance_degraded'
            : required && accepted !== true
              ? 'accept_import_client_package'
              : 'include_import_client_package',
      evidence: {
        specifier: item.specifier,
        statusChannel: item.statusChannel,
        handoffSafe: item.handoffSafe,
        tenantId: boundaryRow?.tenantId ?? boundary.scope.tenantId,
        workspaceId: boundaryRow?.workspaceId ?? boundary.scope.workspaceId,
        runtimeTarget: runtimeRow?.runtimeTarget ?? null,
        missingCapabilities: runtimeRow?.capabilities?.missing ?? boundaryRow?.provider?.missingCapabilities ?? []
      }
    };
  });
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const degradedRows = requiredRows.filter((row) => row.status === 'degraded');
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true && row.rejected !== true);
  const diagnostics = [
    ...preview.diagnostics.filter((item) => item.level === 'error'),
    ...boundary.diagnostics.filter((item) => item.level === 'error'),
    ...runtime.diagnostics.filter((item) => item.level === 'error'),
    ...(acceptance.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => ({
        level: 'error',
        code: 'import_client_acceptance_missing',
        subject: row.key
      }))
      : awaitingAcceptance.map((row) => ({
        level: 'warning',
        code: 'import_client_acceptance_pending',
        subject: row.key
      })))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready'
      && preview.exportSummary.restartSafe === true
      && boundary.restartSafe === true
      && runtime.restartSafe === true,
    package: {
      title: 'mailchimp_import_client_acceptance',
      rows,
      acceptedAliases: acceptance.acceptedAliases,
      rejectedAliases: acceptance.rejectedAliases,
      acceptedAt: acceptance.acceptedAt,
      acceptedBy: acceptance.acceptedBy,
      requireExplicitAcceptance: acceptance.requireExplicitAcceptance
    },
    validationSummary: {
      totalImports: rows.length,
      requiredImports: requiredRows.length,
      blockedImports: blockedRows.length,
      degradedImports: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      rejectedRequired: requiredRows.filter((row) => row.rejected).length,
      crossTenantBlocked: boundary.validationSummary.crossTenantBlocked,
      unsafeHandoffs: boundary.validationSummary.unsafeHandoffs + preview.validationSummary.unsafeRequiredHandoffs,
      runtimeBlocked: runtime.readiness?.blockingReasons?.length ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: unique([
        ...blockedRows.map((row) => row.key),
        ...(runtime.readiness?.blockingReasons ?? []),
        ...(boundary.readiness?.blockingReasons ?? [])
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.key),
        ...(runtime.readiness?.degradedReasons ?? []),
        ...(boundary.readiness?.degradedReasons ?? []),
        ...(!acceptance.requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction: status === 'blocked'
        ? 'resolve_import_client_acceptance_blockers'
        : status === 'degraded'
          ? 'publish_import_client_acceptance_degraded'
          : 'publish_import_client_acceptance_ready'
    },
    handoff: {
      target: 'kernel.status.mailchimp.imports.acceptance',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.imports',
      publish: status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includePackage: true,
      includeBoundaryAudit: boundary.auditHandoff?.includeRows === true,
      nextAction: status === 'ready' ? 'publish_import_client_acceptance_ready' : 'review_import_client_acceptance'
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_client_acceptance',
      status,
      restartSafe: status === 'ready' && runtime.restartSafe === true,
      importCount: rows.length,
      blockedImports: blockedRows.map((row) => row.key),
      degradedImports: degradedRows.map((row) => row.key),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key),
      tenantId: boundary.scope.tenantId,
      workspaceId: boundary.scope.workspaceId,
      nextAction: status === 'ready' ? 'publish_import_client_acceptance_ready' : 'review_import_client_acceptance'
    },
    diagnostics
  };
}

export function buildImportProviderAdoptionContract(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const provider = buildImportProviderContract(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const runtimeAdoption = buildImportRuntimeAdoptionHandoff(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs,
    previousAdoption: options.previousRuntimeAdoption ?? options.previousImportRuntimeAdoption,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings
  });
  const previous = normalizeImportProviderAdoptionState(options.previousProviderAdoption ?? options.previousImportProviderAdoption ?? input.previousProviderAdoption);
  const acceptance = normalizeImportProviderAdoptionAcceptance(options.acceptance ?? options.providerAdoptionAcceptance ?? input.providerAdoptionAcceptance);
  const requiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases);
  const rows = provider.providers.map((item) => {
    const runtimeRow = runtimeAdoption.rows.find((row) => row.alias === item.alias);
    const required = requiredAliases.length === 0 || requiredAliases.includes(item.alias) || requiredAliases.includes(item.specifier);
    const accepted = acceptance.acceptedProviders.includes(item.alias) || acceptance.acceptedProviders.includes(item.specifier);
    const missingCapabilities = item.capabilities?.missing ?? [];
    const syncChanged = importProviderSyncChanged(previous.providers[item.alias] ?? previous.providers[item.specifier], item.sync);
    const status = missingCapabilities.length > 0
      ? 'blocked'
      : item.handoffSafe !== true || runtimeRow?.status === 'degraded'
        ? 'degraded'
        : runtimeRow?.status === 'disabled' || runtimeRow?.status === 'paused'
          ? runtimeRow.status
          : syncChanged
            ? 'degraded'
            : 'ready';

    return {
      alias: item.alias,
      specifier: item.specifier,
      kind: item.kind,
      required,
      accepted,
      status,
      provider: item.provider,
      service: item.service,
      statusChannel: item.statusChannel,
      externalTarget: item.externalHandoff?.target ?? null,
      handoffSafe: item.handoffSafe === true,
      capabilities: {
        offered: item.capabilities?.offered ?? [],
        requested: item.capabilities?.requested ?? [],
        missing: missingCapabilities
      },
      sync: {
        ...item.sync,
        changed: syncChanged
      },
      runtime: {
        status: runtimeRow?.status ?? 'unknown',
        adopted: runtimeRow?.adopted === true,
        target: runtimeRow?.runtimeTarget ?? null
      },
      nextAction: missingCapabilities.length > 0
        ? 'repair_import_provider_adoption_capabilities'
        : item.handoffSafe !== true
          ? 'route_import_provider_adoption_to_kernel'
          : runtimeRow?.status === 'disabled'
            ? 'enable_import_runtime'
            : runtimeRow?.status === 'paused'
              ? 'resume_import_runtime'
              : acceptance.requireExplicitAcceptance && required && !accepted
                ? 'accept_import_provider_adoption'
                : syncChanged
                  ? 'publish_import_provider_sync_delta'
                  : 'adopt_import_provider'
    };
  });
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const degradedRows = requiredRows.filter((row) => (
    row.status === 'degraded'
    || row.status === 'disabled'
    || row.status === 'paused'
  ));
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true);
  const fingerprint = importProviderAdoptionFingerprint({
    provider,
    runtimeAdoption,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = toNonNegativeInteger(previous.sequence, 0) + (changed ? 1 : 0);
  const diagnostics = [
    ...health.diagnostics,
    ...provider.diagnostics.filter((item) => item.level === 'error'),
    ...runtimeAdoption.diagnostics.filter((item) => item.level === 'error'),
    ...blockedRows.flatMap((row) => row.capabilities.missing.map((capability) => ({
      level: 'error',
      code: 'import_provider_adoption_capability_missing',
      subject: `${row.alias}:${capability}`
    }))),
    ...degradedRows.map((row) => ({
      level: 'warning',
      code: 'import_provider_adoption_guarded',
      subject: `${row.alias}:${row.status}`
    })),
    ...(acceptance.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => ({
        level: 'error',
        code: 'import_provider_adoption_acceptance_missing',
        subject: row.alias
      }))
      : awaitingAcceptance.map((row) => ({
        level: 'warning',
        code: 'import_provider_adoption_acceptance_pending',
        subject: row.alias
      })))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_import_provider_adoption_blockers'
    : runtimeAdoption.lifecycle?.status === 'retry_scheduled'
      ? 'dispatch_import_runtime_retry'
      : status === 'degraded'
        ? 'publish_import_provider_adoption_degraded_status'
        : changed
          ? 'publish_import_provider_adoption_delta'
          : 'reuse_import_provider_adoption';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'ready' && provider.restartSafe === true && runtimeAdoption.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows,
    capabilityNegotiation: provider.capabilityNegotiation,
    syncMetadata: {
      ...provider.syncMetadata,
      changedProviders: rows.filter((row) => row.sync.changed).map((row) => row.alias).sort()
    },
    externalHandoff: provider.externalHandoff,
    runtimeAdoption: {
      status: runtimeAdoption.status,
      restartSafe: runtimeAdoption.restartSafe,
      adoptedImports: runtimeAdoption.exportSummary?.adoptedImports ?? [],
      blockedImports: runtimeAdoption.exportSummary?.blockedImports ?? [],
      degradedImports: runtimeAdoption.exportSummary?.degradedImports ?? []
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.alias),
        ...(runtimeAdoption.readiness?.blockingReasons ?? []).map((item) => `runtime:${item}`)
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => `${row.alias}:${row.status}`),
        ...(!acceptance.requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-provider-adoption',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-provider-adoption',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeRuntimeAdoption: runtimeAdoption.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      status,
      restartSafe: status === 'ready' && provider.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      adoptedProviders: rows.filter((row) => row.status === 'ready' && row.accepted === true).map((row) => row.alias).sort(),
      blockedProviders: blockedRows.map((row) => row.alias).sort(),
      degradedProviders: degradedRows.map((row) => row.alias).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.alias).sort(),
      changedProviders: rows.filter((row) => row.sync.changed).map((row) => row.alias).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportClientReadinessBrief(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const acceptance = buildImportClientAcceptancePackage(resolved, {
    ...options,
    health,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const history = buildImportHistoryExport(resolved, {
    ...options,
    health,
    previousHistoryExport: options.previousHistoryExport ?? options.previousImportHistoryExport,
    previousAnalytics: options.previousAnalytics ?? options.previousImportAnalytics
  });
  const previous = normalizeImportClientReadinessBrief(options.previousBrief ?? options.previousImportClientReadinessBrief ?? input.previousBrief);
  const rows = acceptance.package.rows.map((row) => {
    const historyRow = history.snapshot.imports.find((item) => item.alias === row.key);
    return {
      alias: row.key,
      specifier: row.label,
      kind: row.kind,
      required: row.required,
      accepted: row.accepted,
      rejected: row.rejected,
      status: row.status,
      previewReady: row.status === 'ready' || row.status === 'awaiting_acceptance',
      exportKey: historyRow?.exportKey ?? `${row.key}:${row.label}`,
      handoffSafe: row.evidence.handoffSafe === true,
      nextStep: row.nextStep,
      evidence: row.evidence
    };
  });
  const blockedRows = rows.filter((row) => row.status === 'blocked' || row.rejected === true);
  const degradedRows = rows.filter((row) => row.status === 'degraded' || row.handoffSafe !== true);
  const awaitingAcceptance = rows.filter((row) => row.required && row.accepted !== true && row.rejected !== true);
  const status = acceptance.status === 'blocked' || history.status === 'blocked' || blockedRows.length > 0
    ? 'blocked'
    : acceptance.status === 'degraded' || history.status === 'degraded' || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const counters = {
    imports: rows.length,
    required: rows.filter((row) => row.required).length,
    accepted: rows.filter((row) => row.accepted).length,
    rejected: rows.filter((row) => row.rejected).length,
    blocked: blockedRows.length,
    degraded: degradedRows.length,
    awaitingAcceptance: awaitingAcceptance.length,
    unsafeHandoffs: rows.filter((row) => row.handoffSafe !== true).length,
    changedImports: history.deltas.changedImports.length,
    addedImports: history.deltas.addedImports.length,
    removedImports: history.deltas.removedImports.length,
    diagnosticErrors: acceptance.validationSummary.diagnosticErrors + history.exportSummary.diagnosticErrors,
    diagnosticWarnings: acceptance.validationSummary.diagnosticWarnings + history.exportSummary.diagnosticWarnings
  };
  const fingerprint = importClientReadinessBriefFingerprint({
    status,
    rows,
    historyFingerprint: history.fingerprint,
    counters
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(options.now ?? options.timestamp) || null,
    status,
    fingerprint,
    importCount: counters.imports,
    blocked: counters.blocked,
    degraded: counters.degraded,
    awaitingAcceptance: counters.awaitingAcceptance,
    changed
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(options.briefHistoryLimit ?? options.historyLimit, 12));
  const nextAction = status === 'blocked'
    ? 'resolve_import_client_readiness_blockers'
    : status === 'degraded'
      ? 'publish_import_client_readiness_degraded'
      : changed
        ? 'publish_import_client_readiness_delta'
        : 'reuse_import_client_readiness_brief';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_client_readiness_brief',
    status,
    restartSafe: status === 'ready' && acceptance.restartSafe === true && history.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows,
    counters,
    validationSummary: {
      ...acceptance.validationSummary,
      changedImports: counters.changedImports,
      addedImports: counters.addedImports,
      removedImports: counters.removedImports
    },
    readiness: {
      status,
      blockingReasons: unique([
        ...blockedRows.map((row) => row.alias),
        ...(acceptance.readiness.blockingReasons ?? [])
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.alias),
        ...(acceptance.readiness.degradedReasons ?? []),
        ...(history.status === 'degraded' ? ['import_history_degraded'] : [])
      ]),
      nextAction
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'kernel.status.mailchimp.imports.client-readiness',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.imports',
      publish: changed || status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeHistory: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_client_readiness_brief',
      status,
      restartSafe: status === 'ready' && acceptance.restartSafe === true && history.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      counters,
      blockedImports: blockedRows.map((row) => row.alias).sort(),
      degradedImports: degradedRows.map((row) => row.alias).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.alias).sort(),
      nextAction
    },
    diagnostics: [
      ...acceptance.diagnostics,
      ...history.diagnostics
    ]
  };
}

export function selfCheckImportSyntax() {
  return resolveImportSyntax('import profile from "@mailchimp/profile"\nimport gates from "@mailchimp/gates"');
}

function normalizeImportInput(input) {
  if (input?.imports) return { ...input, diagnostics: input.diagnostics ?? [] };
  return { imports: [], diagnostics: [] };
}

function normalizeImportAnalyticsHistory(input) {
  const history = input?.history ?? input;
  return {
    sequence: toNonNegativeInteger(history?.sequence, 0),
    timeline: Array.isArray(history?.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function normalizeImportHistoryExport(input) {
  const value = input && typeof input === 'object' ? input : {};
  const snapshot = value.snapshot && typeof value.snapshot === 'object' ? value.snapshot : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    schemaVersion: clean(value.schemaVersion),
    sequence: toNonNegativeInteger(value.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    snapshot: {
      imports: Array.isArray(snapshot.imports)
        ? snapshot.imports.map(normalizeImportHistoryRow).filter((row) => row.exportKey)
        : []
    },
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function normalizeImportTimelineReportHistory(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function normalizeImportHistoryRow(input) {
  const row = input && typeof input === 'object' ? input : {};
  const alias = clean(row.alias);
  const specifier = clean(row.specifier);
  return {
    alias,
    specifier,
    kind: clean(row.kind),
    capabilityRefs: unique(normalizeList(row.capabilityRefs ?? row.capabilities)),
    statusChannel: clean(row.statusChannel),
    handoffSafe: row.handoffSafe === true,
    exportKey: clean(row.exportKey) || (alias && specifier ? `${alias}:${specifier}` : '')
  };
}

function indexImportExportRows(rows) {
  return rows.reduce((index, row) => {
    if (row.exportKey) index[row.exportKey] = normalizeImportHistoryRow(row);
    return index;
  }, {});
}

function importExportRowFingerprint(row) {
  const normalized = normalizeImportHistoryRow(row);
  return [
    normalized.alias,
    normalized.specifier,
    normalized.kind,
    normalized.statusChannel,
    normalized.handoffSafe ? 'safe' : 'unsafe',
    ...normalized.capabilityRefs
  ].join('|');
}

function importHistoryFingerprint({ rows, status, restartSafe, diagnosticErrors, diagnosticWarnings }) {
  return [
    status,
    restartSafe ? 'restart_safe' : 'restart_guarded',
    `errors:${toNonNegativeInteger(diagnosticErrors, 0)}`,
    `warnings:${toNonNegativeInteger(diagnosticWarnings, 0)}`,
    ...rows.map(importExportRowFingerprint).sort()
  ].join('||');
}

function importTimelineReportFingerprint({
  resolved,
  health,
  historyExport,
  lifecycle,
  providerStatus,
  providerSyncStatus,
  reportRows
}) {
  return [
    resolved.schemaVersion,
    health.status,
    historyExport.fingerprint,
    lifecycle.status,
    providerStatus,
    providerSyncStatus,
    ...reportRows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.delta,
      row.handoffSafe ? 'handoff_safe' : 'handoff_guarded',
      row.providerStatus,
      row.providerSyncStatus,
      ...row.capabilities,
      ...row.diagnostics
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeImportLifecycleState(input) {
  const state = input && typeof input === 'object' ? input : {};
  return {
    status: clean(state.status) || (state.enabled === false ? 'disabled' : 'enabled'),
    enabled: state.enabled !== false,
    generation: toNonNegativeInteger(state.generation, 0),
    fingerprint: clean(state.fingerprint),
    scheduledRetryCount: toNonNegativeInteger(state.schedule?.scheduledRetryCount ?? state.scheduledRetryCount, 0),
    appliedCommandKeys: Array.isArray(state.appliedCommandKeys)
      ? state.appliedCommandKeys
      : Array.isArray(state.idempotency?.appliedCommandKeys)
        ? state.idempotency.appliedCommandKeys
        : []
  };
}

function normalizeImportLifecycleSettings(input) {
  const settings = input && typeof input === 'object' ? input : {};
  return {
    enabled: settings.enabled !== false,
    scheduleMode: clean(settings.scheduleMode) || IMPORT_LIFECYCLE_DEFAULTS.scheduleMode,
    retryWindowMs: toPositiveInteger(settings.retryWindowMs, IMPORT_LIFECYCLE_DEFAULTS.retryWindowMs),
    maxScheduledRetries: toPositiveInteger(settings.maxScheduledRetries, IMPORT_LIFECYCLE_DEFAULTS.maxScheduledRetries),
    allowDegradedMode: settings.allowDegradedMode !== false
  };
}

function normalizeImportLifecycleCommand(input) {
  return input && typeof input === 'object' ? input : {};
}

function validateImportLifecycleSettings(settings) {
  const allowedScheduleModes = ['immediate', 'manual', 'backoff'];
  return [
    ...(allowedScheduleModes.includes(settings.scheduleMode)
      ? []
      : [{ level: 'error', code: 'invalid_import_schedule_mode', subject: settings.scheduleMode }]),
    ...(settings.maxScheduledRetries < 1
      ? [{ level: 'error', code: 'invalid_import_retry_limit', subject: String(settings.maxScheduledRetries) }]
      : []),
    ...(settings.retryWindowMs < 100
      ? [{ level: 'warning', code: 'import_retry_window_too_short', subject: String(settings.retryWindowMs) }]
      : [])
  ];
}

function validateImportLifecycleCommand(command, { health, settings, repeatedCommand }) {
  const action = clean(command.action).toLowerCase();
  if (!action || repeatedCommand) return [];
  return [
    ...(Object.prototype.hasOwnProperty.call(IMPORT_LIFECYCLE_COMMANDS, action)
      ? []
      : [{ level: 'error', code: 'unsupported_import_lifecycle_command', subject: action }]),
    ...(action === 'retry' && health.retryable !== true
      ? [{ level: 'warning', code: 'import_retry_requested_without_retryable_failure', subject: health.status }]
      : []),
    ...(action === 'retry' && settings.enabled !== true
      ? [{ level: 'error', code: 'import_retry_blocked_while_disabled', subject: 'disabled' }]
      : [])
  ];
}

function deriveImportLifecycleTransition({
  command,
  health,
  previous,
  settings,
  repeatedCommand,
  hasErrors
}) {
  const action = repeatedCommand ? '' : clean(command.action).toLowerCase();
  const commandedStatus = IMPORT_LIFECYCLE_COMMANDS[action];
  const baseEnabled = settings.enabled && previous.enabled !== false;
  const enabled = commandedStatus === 'disabled'
    ? false
    : commandedStatus === 'enabled'
      ? true
      : baseEnabled;
  const scheduledRetryCount = action === 'retry'
    ? previous.scheduledRetryCount + 1
    : health.status === 'healthy'
      ? 0
      : previous.scheduledRetryCount;
  const retryBudgetExceeded = scheduledRetryCount > settings.maxScheduledRetries;
  const status = hasErrors || retryBudgetExceeded
    ? 'blocked'
    : !enabled
      ? 'disabled'
      : commandedStatus === 'paused'
        ? 'paused'
        : commandedStatus === 'retry_scheduled'
          ? 'retry_scheduled'
          : health.status === 'degraded' && settings.allowDegradedMode
            ? 'enabled_degraded'
            : health.status === 'blocked'
              ? 'blocked'
              : 'enabled';
  const nextRetryAt = status === 'retry_scheduled' && health.nextRetry
    ? health.nextRetry.delayMs + settings.retryWindowMs
    : null;
  const nextAction = status === 'blocked'
    ? 'operator_import_lifecycle_review'
    : status === 'disabled'
      ? 'wait_for_enable_command'
      : status === 'paused'
        ? 'wait_for_resume_command'
        : status === 'retry_scheduled'
          ? 'dispatch_import_retry'
          : status === 'enabled_degraded'
            ? 'publish_degraded_import_status'
            : 'publish_import_ready';
  const fingerprint = [
    status,
    enabled ? 'enabled' : 'disabled',
    settings.scheduleMode,
    String(scheduledRetryCount),
    health.status,
    health.nextRetry?.reason ?? 'no_retry'
  ].join('|');

  return {
    status,
    enabled,
    fingerprint,
    scheduledRetryCount,
    nextAction,
    schedule: {
      mode: settings.scheduleMode,
      scheduledRetryCount,
      retryBudgetExceeded,
      nextRetry: health.nextRetry,
      nextRetryAt
    }
  };
}

function buildImportCounters(resolved, health) {
  const unresolved = health.diagnostics.filter((item) => item.code === 'unresolved_import_specifier');
  const duplicateAliases = health.diagnostics.filter((item) => item.code === 'duplicate_import_alias');
  const unsafe = resolved.imports.filter((item) => item.handoffSafe !== true);
  return {
    totalImports: resolved.imports.length,
    builtinImports: resolved.imports.filter((item) => Object.prototype.hasOwnProperty.call(BUILTIN_IMPORTS, item.specifier)).length,
    customImports: resolved.imports.filter((item) => !Object.prototype.hasOwnProperty.call(BUILTIN_IMPORTS, item.specifier)).length,
    capabilityRefs: resolved.capabilityRefs.length,
    statusChannels: resolved.statusChannels.length,
    unresolvedImports: unresolved.length,
    duplicateAliases: duplicateAliases.length,
    unsafeHandoffs: unsafe.length,
    diagnostics: {
      errors: health.diagnostics.filter((item) => item.level === 'error').length,
      warnings: health.diagnostics.filter((item) => item.level === 'warning').length,
      info: health.diagnostics.filter((item) => item.level === 'info').length
    }
  };
}

function rankImportCapabilities(imports) {
  const counts = imports.reduce((index, item) => {
    for (const capability of item.capabilities) index[capability] = (index[capability] ?? 0) + 1;
    return index;
  }, {});
  return Object.entries(counts)
    .map(([capability, count]) => ({ capability, count }))
    .sort((left, right) => right.count - left.count || left.capability.localeCompare(right.capability));
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value ?? '').split(',').map(clean).filter(Boolean);
}

function normalizeImportAcceptance(input) {
  const acceptance = input && typeof input === 'object' ? input : {};
  return {
    acceptedAliases: normalizeList(acceptance.acceptedAliases ?? acceptance.accepted),
    rejectedAliases: normalizeList(acceptance.rejectedAliases ?? acceptance.rejected),
    acceptedAt: clean(acceptance.acceptedAt ?? acceptance.timestamp) || null,
    acceptedBy: clean(acceptance.acceptedBy ?? acceptance.operator) || null,
    requireExplicitAcceptance: acceptance.requireExplicitAcceptance !== false
  };
}

function normalizeImportRuntimeAdoptionState(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeImportProviderAdoptionState(input) {
  const value = input && typeof input === 'object' ? input : {};
  const rows = Array.isArray(value.rows)
    ? value.rows
    : Array.isArray(value.providers)
      ? value.providers
      : [];
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    providers: rows.reduce((index, row) => {
      const alias = clean(row.alias);
      const specifier = clean(row.specifier);
      const sync = row.sync && typeof row.sync === 'object' ? row.sync : {};
      const normalized = {
        mode: clean(sync.mode),
        lastSyncedAt: clean(sync.lastSyncedAt),
        nextSyncAfterMs: sync.nextSyncAfterMs ?? null
      };
      if (alias) index[alias] = normalized;
      if (specifier) index[specifier] = normalized;
      return index;
    }, {})
  };
}

function normalizeImportProviderAdoptionAcceptance(input) {
  const acceptance = input && typeof input === 'object' ? input : {};
  return {
    acceptedProviders: normalizeList(acceptance.acceptedProviders ?? acceptance.acceptedAliases ?? acceptance.accepted),
    requireExplicitAcceptance: acceptance.requireExplicitAcceptance === true
  };
}

function normalizeImportGateControlSettings(input) {
  const settings = input && typeof input === 'object' ? input : {};
  return {
    requireGateAlignment: settings.requireGateAlignment !== false,
    allowDisabledImports: settings.allowDisabledImports === true,
    allowDegradedGateResume: settings.allowDegradedGateResume === true,
    scheduleMode: clean(settings.scheduleMode ?? IMPORT_LIFECYCLE_DEFAULTS.scheduleMode),
    retryWindowMs: toPositiveInteger(settings.retryWindowMs, IMPORT_LIFECYCLE_DEFAULTS.retryWindowMs)
  };
}

function normalizeFeatureBoundaryControl(input) {
  const boundary = input && typeof input === 'object' ? input : {};
  const exportSummary = boundary.exportSummary && typeof boundary.exportSummary === 'object'
    ? boundary.exportSummary
    : {};
  const gates = boundary.gates && typeof boundary.gates === 'object'
    ? boundary.gates
    : boundary.featureState?.gates && typeof boundary.featureState.gates === 'object'
      ? boundary.featureState.gates
      : {};
  return {
    status: clean(boundary.status ?? exportSummary.status) || (Object.keys(boundary).length > 0 ? 'ready' : 'missing'),
    restartSafe: boundary.restartSafe ?? exportSummary.restartSafe ?? null,
    gates,
    blockedRows: normalizeList(boundary.blockedRows ?? exportSummary.blockedRows),
    degradedRows: normalizeList(boundary.degradedRows ?? exportSummary.degradedRows)
  };
}

function importProviderSyncChanged(previous, current) {
  if (!previous || typeof previous !== 'object') return false;
  const previousMode = clean(previous.mode);
  const currentMode = clean(current?.mode);
  const previousLastSyncedAt = clean(previous.lastSyncedAt);
  const currentLastSyncedAt = clean(current?.lastSyncedAt);
  return Boolean(
    previousMode && currentMode && previousMode !== currentMode
    || previousLastSyncedAt && currentLastSyncedAt && previousLastSyncedAt !== currentLastSyncedAt
  );
}

function normalizeImportClientReadinessBrief(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    sequence: toNonNegativeInteger(value.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function importClientReadinessBriefFingerprint({
  status,
  rows,
  historyFingerprint,
  counters
}) {
  return [
    status,
    historyFingerprint,
    `blocked:${toNonNegativeInteger(counters.blocked, 0)}`,
    `degraded:${toNonNegativeInteger(counters.degraded, 0)}`,
    `awaiting:${toNonNegativeInteger(counters.awaitingAcceptance, 0)}`,
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.rejected ? 'rejected' : 'not_rejected',
      row.handoffSafe ? 'handoff_safe' : 'handoff_guarded',
      row.exportKey,
      row.nextStep
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importProviderAdoptionFingerprint({ provider, runtimeAdoption, rows }) {
  return [
    provider.status,
    provider.capabilityNegotiation?.status,
    runtimeAdoption.status,
    ...(provider.capabilityNegotiation?.missingCapabilities ?? []).map((capability) => `missing:${capability}`),
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.accepted ? 'accepted' : 'pending',
      row.handoffSafe ? 'handoff_safe' : 'handoff_guarded',
      row.runtime?.status,
      row.sync?.mode,
      row.sync?.lastSyncedAt,
      ...(row.capabilities?.missing ?? []).map((capability) => `missing:${capability}`)
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importRuntimeAdoptionFingerprint({ lifecycle, provider, rows }) {
  return [
    lifecycle.status,
    lifecycle.enabled ? 'enabled' : 'disabled',
    provider.status,
    provider.capabilityNegotiation?.status ?? 'unknown',
    ...(provider.capabilityNegotiation?.missingCapabilities ?? []).map((capability) => `missing:${capability}`),
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.adopted ? 'adopted' : 'pending',
      row.statusChannel,
      row.runtimeTarget,
      ...(row.capabilities.missing ?? []).map((capability) => `missing:${capability}`)
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function deriveImportAcceptanceStatus({
  health,
  lifecycle,
  validationSummary,
  requireExplicitAcceptance
}) {
  const blockingReasons = unique([
    ...(health.status === 'blocked' ? ['import_health'] : []),
    ...(lifecycle.status === 'blocked' ? ['import_lifecycle'] : []),
    ...(lifecycle.status === 'disabled' ? ['import_lifecycle_disabled'] : []),
    ...(validationSummary.rejectedRequired > 0 ? ['required_import_rejected'] : []),
    ...(requireExplicitAcceptance && validationSummary.awaitingAcceptance > 0 ? ['required_import_acceptance_missing'] : []),
    ...(validationSummary.diagnosticErrors > 0 ? ['import_diagnostics'] : [])
  ]);
  const degradedReasons = unique([
    ...(health.status === 'degraded' ? ['import_health'] : []),
    ...(!requireExplicitAcceptance && validationSummary.awaitingAcceptance > 0 ? ['required_import_acceptance_pending'] : []),
    ...(['paused', 'retry_scheduled', 'enabled_degraded'].includes(lifecycle.status)
      ? [`import_lifecycle:${lifecycle.status}`]
      : []),
    ...(validationSummary.unsafeRequiredHandoffs > 0 ? ['unsafe_required_handoff'] : []),
    ...(validationSummary.diagnosticWarnings > 0 ? ['import_warnings'] : [])
  ]);
  const status = blockingReasons.length > 0
    ? 'blocked'
    : degradedReasons.length > 0
      ? 'degraded'
      : 'ready';

  return {
    status,
    blockingReasons,
    degradedReasons,
    nextAction: status === 'blocked'
      ? 'resolve_import_preview_blockers'
      : status === 'degraded'
        ? 'publish_import_preview_degraded_status'
        : 'accept_import_preview_for_export'
  };
}

function normalizeProviderCatalog(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function normalizeImportProviderReadinessState(input) {
  const state = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(state.sequence ?? state.history?.sequence, 0),
    fingerprint: clean(state.fingerprint ?? state.exportSummary?.fingerprint)
  };
}

function normalizeImportProviderReadinessAcceptance(input) {
  const acceptance = input && typeof input === 'object' ? input : {};
  return {
    acceptedProviders: normalizeList(acceptance.acceptedProviders ?? acceptance.acceptedAliases ?? acceptance.accepted),
    acceptedAt: clean(acceptance.acceptedAt ?? acceptance.timestamp) || null,
    acceptedBy: clean(acceptance.acceptedBy ?? acceptance.operator) || null,
    requireExplicitAcceptance: acceptance.requireExplicitAcceptance === true
  };
}

function normalizeProfileProviderSyncIntent(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    profileName: clean(value.profileName ?? value.exportSummary?.profileName),
    operation: clean(value.operation ?? value.exportSummary?.operation),
    status: clean(value.status ?? value.exportSummary?.status) || 'unknown',
    restartSafe: value.restartSafe === true || value.exportSummary?.restartSafe === true,
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    sync: {
      cursor: clean(value.sync?.cursor ?? value.exportSummary?.syncCursor),
      mode: clean(value.sync?.mode),
      nextSyncAfterMs: value.sync?.nextSyncAfterMs ?? null
    },
    capabilityNegotiation: {
      requestedCapabilities: normalizeList(value.capabilityNegotiation?.requestedCapabilities),
      missingCapabilities: normalizeList(value.capabilityNegotiation?.missingCapabilities),
      status: clean(value.capabilityNegotiation?.status) || 'unknown'
    }
  };
}

function normalizeImportProviderSyncCheckpoint(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    lastStableFingerprint: clean(value.checkpoint?.lastStableFingerprint ?? value.lastStableFingerprint),
    profileCursor: clean(value.profileSyncIntent?.cursor ?? value.exportSummary?.profileCursor),
    appliedCommandKeys: Array.isArray(value.idempotency?.appliedCommandKeys)
      ? value.idempotency.appliedCommandKeys
      : []
  };
}

function importProviderSyncCheckpointFingerprint({
  provider,
  readiness,
  adoption,
  profileIntent,
  providerRows,
  requestedCapabilities
}) {
  return [
    provider.status,
    readiness.status,
    adoption.status,
    profileIntent.status,
    profileIntent.fingerprint,
    profileIntent.sync?.cursor || 'no_profile_cursor',
    provider.capabilityNegotiation?.status,
    ...requestedCapabilities.map((capability) => `requested:${capability}`),
    ...providerRows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.readinessStatus,
      row.adoptionStatus,
      row.sync?.mode,
      row.sync?.pending ? 'sync_pending' : 'sync_clear',
      row.sync?.profileCursorChanged ? 'profile_cursor_changed' : 'profile_cursor_stable',
      row.externalHandoff?.ready ? 'handoff_ready' : 'handoff_guarded',
      ...(row.capabilities?.missing ?? []).map((capability) => `missing:${capability}`)
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importProviderReadinessFingerprint({ provider, rows, acceptance }) {
  return [
    provider.status,
    provider.capabilityNegotiation?.status,
    provider.externalHandoff?.status,
    acceptance.requireExplicitAcceptance ? 'explicit_acceptance' : 'implicit_acceptance',
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.accepted ? 'accepted' : 'pending',
      row.sync?.mode,
      row.sync?.pending ? 'sync_pending' : 'sync_clear',
      row.externalHandoff?.ready ? 'handoff_ready' : 'handoff_guarded',
      ...(row.capabilities?.missing ?? []).map((capability) => `missing:${capability}`)
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeImportBoundaryScope(input) {
  const scope = input && typeof input === 'object' ? input : {};
  return {
    tenantId: clean(scope.tenantId ?? scope.tenant ?? 'mailchimp.default'),
    workspaceId: clean(scope.workspaceId ?? scope.workspace ?? 'mailchimp.workspace.default'),
    requestedTenantId: clean(scope.requestedTenantId ?? scope.requestTenantId),
    requestedWorkspaceId: clean(scope.requestedWorkspaceId ?? scope.requestWorkspaceId),
    role: clean(scope.role ?? 'campaign_operator'),
    permissionMode: clean(scope.permissionMode ?? 'least_privilege')
  };
}

function normalizeImportBoundaryAcceptance(input) {
  const acceptance = input && typeof input === 'object' ? input : {};
  return {
    requiredImports: normalizeList(acceptance.requiredImports ?? acceptance.requiredAliases ?? acceptance.required),
    acceptedImports: normalizeList(acceptance.acceptedImports ?? acceptance.acceptedAliases ?? acceptance.accepted),
    acceptedAt: clean(acceptance.acceptedAt ?? acceptance.timestamp) || null,
    acceptedBy: clean(acceptance.acceptedBy ?? acceptance.operator) || null,
    requireExplicitAcceptance: acceptance.requireExplicitAcceptance === true
  };
}

function normalizeImportScopeCatalog(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function providerSyncModeForKind(kind) {
  if (kind === 'feature-gates') return 'snapshot';
  if (kind === 'recovery') return 'event';
  return 'poll';
}

function normalizeExternalHandoff(input, fallback) {
  const handoff = input && typeof input === 'object' ? input : {};
  const statusChannel = clean(handoff.statusChannel) || fallback.statusChannel;
  const target = clean(handoff.target) || `kernel.provider.${fallback.specifier.replace(/[^a-z0-9]+/gi, '.').replace(/^\.+|\.+$/g, '')}`;
  return {
    target,
    statusChannel,
    ready: handoff.ready === false ? false : fallback.handoffSafe && statusChannel === 'kernel.status.mailchimp',
    publishFailures: handoff.publishFailures !== false
  };
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))].sort();
}

function buildImportActionableErrors({
  missingImports,
  duplicateAliases,
  parseFailures,
  unsafeImports,
  exhausted,
  statusChannelReady
}) {
  return [
    ...missingImports.map((specifier) => ({
      code: 'install_or_map_import',
      subject: specifier,
      action: `Add ${specifier} to importMap or replace it with a built-in Mailchimp import.`
    })),
    ...duplicateAliases.map((alias) => ({
      code: 'rename_import_alias',
      subject: alias,
      action: `Use a unique alias for ${alias}.`
    })),
    ...parseFailures.map((line) => ({
      code: 'fix_import_declaration',
      subject: line,
      action: 'Use import <alias> from "<specifier>" syntax.'
    })),
    ...unsafeImports.map((item) => ({
      code: 'route_import_status_to_kernel',
      subject: item.specifier,
      action: `Set ${item.specifier} statusChannel to kernel.status.mailchimp before restart-safe handoff.`
    })),
    ...(statusChannelReady ? [] : [{
      code: 'add_mailchimp_status_import',
      subject: 'kernel.status.mailchimp',
      action: 'Import @mailchimp/profile, @mailchimp/gates, or @mailchimp/recovery to publish Mailchimp status.'
    }]),
    ...(exhausted ? [{
      code: 'operator_import_review',
      subject: 'retry_budget',
      action: 'Stop automatic retries and request operator review for import resolution.'
    }] : [])
  ];
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function toNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function clean(value) {
  return String(value ?? '').trim();
}
