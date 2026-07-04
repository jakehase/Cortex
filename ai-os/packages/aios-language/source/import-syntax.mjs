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

const IMPORT_ROLE_PERMISSIONS = Object.freeze({
  campaign_operator: Object.freeze({
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.campaign.plan', 'kernel.status.write']),
    permissions: Object.freeze(['campaign:read', 'campaign:plan', 'status:write'])
  }),
  audience_operator: Object.freeze({
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.audience.segment', 'kernel.status.write']),
    permissions: Object.freeze(['audience:read', 'audience:segment', 'status:write'])
  }),
  auditor: Object.freeze({
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.webhook.inspect']),
    permissions: Object.freeze(['audit:read', 'webhook:read'])
  }),
  workflow_owner: Object.freeze({
    capabilities: Object.freeze([
      'mailchimp.read',
      'mailchimp.campaign.plan',
      'mailchimp.audience.segment',
      'mailchimp.webhook.inspect',
      'kernel.status.write'
    ]),
    permissions: Object.freeze(['campaign:read', 'campaign:plan', 'audience:segment', 'webhook:read', 'audit:write', 'status:write'])
  })
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

export function buildImportProviderSyncPublication(input = {}, options = {}) {
  const checkpoint = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && input.exportSummary?.title === 'mailchimp_import_provider_sync_checkpoint'
    ? input
    : buildImportProviderSyncCheckpoint(input, options);
  const previous = normalizeImportProviderSyncPublication(options.previousPublication ?? options.previousImportProviderSyncPublication ?? input.previousPublication);
  const maxAgeMs = toPositiveInteger(options.maxPublicationAgeMs ?? input.maxPublicationAgeMs, 120000);
  const stale = previous.checkpointFingerprint
    && previous.checkpointFingerprint === checkpoint.fingerprint
    && previous.ageMs > maxAgeMs;
  const rows = (checkpoint.rows ?? []).map((row) => ({
    alias: row.alias,
    specifier: row.specifier,
    status: row.status,
    restartSafe: row.status === 'ready' && row.externalHandoff?.ready === true,
    publish: row.status !== 'ready' || row.sync?.pending === true || row.sync?.profileCursorChanged === true,
    missingCapabilities: row.capabilities?.missing ?? [],
    pendingSync: row.sync?.pending === true,
    nextAction: row.nextAction ?? null
  }));
  const status = checkpoint.status === 'blocked' || rows.some((row) => row.status === 'blocked')
    ? 'blocked'
    : checkpoint.status === 'degraded' || rows.some((row) => row.status === 'degraded' || row.pendingSync) || stale
      ? 'degraded'
      : 'ready';
  const fingerprint = importProviderSyncPublicationFingerprint({
    status,
    checkpointFingerprint: checkpoint.fingerprint,
    profileCursor: checkpoint.profileSyncIntent?.cursor,
    rows,
    stale
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = changed ? previous.sequence + 1 : previous.sequence;
  const diagnostics = [
    ...(checkpoint.diagnostics ?? []),
    ...(stale ? [{ level: 'warning', code: 'import_provider_sync_publication_stale', subject: String(previous.ageMs) }] : [])
  ];
  const nextAction = status === 'blocked'
    ? 'publish_import_provider_sync_blocked'
    : status === 'degraded'
      ? 'publish_import_provider_sync_degraded'
      : changed
        ? 'publish_import_provider_sync_ready'
        : 'reuse_import_provider_sync_publication';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_provider_sync_publication',
    status,
    restartSafe: status === 'ready' && checkpoint.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    stale,
    profileSyncIntent: checkpoint.profileSyncIntent,
    rows,
    counters: {
      providers: rows.length,
      publishRows: rows.filter((row) => row.publish).length,
      blockedProviders: rows.filter((row) => row.status === 'blocked').length,
      degradedProviders: rows.filter((row) => row.status === 'degraded').length,
      pendingSyncs: rows.filter((row) => row.pendingSync).length,
      missingCapabilities: rows.reduce((count, row) => count + row.missingCapabilities.length, 0),
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    publication: {
      target: 'kernel.status.mailchimp.import-provider-sync',
      statusChannel: checkpoint.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      publish: changed || status !== 'ready' || stale,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeCheckpoint: true,
      includeRows: rows.some((row) => row.publish),
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_provider_sync_publication',
      status,
      restartSafe: status === 'ready' && checkpoint.restartSafe === true,
      sequence,
      fingerprint,
      checkpointFingerprint: checkpoint.fingerprint,
      changed,
      stale,
      profileCursor: checkpoint.profileSyncIntent?.cursor ?? null,
      publishProviders: rows.filter((row) => row.publish).map((row) => row.alias).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportProviderSyncBridge(input = {}, options = {}) {
  const checkpoint = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && input.exportSummary?.title === 'mailchimp_import_provider_sync_checkpoint'
    ? input
    : buildImportProviderSyncCheckpoint(input, options);
  const publication = options.publication ?? options.importProviderSyncPublication ?? buildImportProviderSyncPublication(checkpoint, {
    ...options,
    previousPublication: options.previousPublication ?? options.previousImportProviderSyncPublication
  });
  const previous = normalizeImportProviderSyncBridge(options.previousBridge ?? options.previousImportProviderSyncBridge ?? input.previousBridge);
  const profileIntent = normalizeProfileSyncBridgeIntent(options.profileProviderSyncIntent ?? checkpoint.profileSyncIntent);
  const requiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases);
  const acceptedAliases = normalizeList(options.acceptedAliases ?? options.acceptedImportAliases ?? options.bridgeAcceptance?.acceptedAliases);
  const requireExplicitAcceptance = options.requireExplicitBridgeAcceptance === true
    || options.bridgeAcceptance?.requireExplicitAcceptance === true;
  const maxPublicationAgeMs = toPositiveInteger(options.maxPublicationAgeMs ?? options.bridgeMaxPublicationAgeMs, 120000);
  const publicationAgeMs = toNonNegativeInteger(options.publicationAgeMs ?? publication.ageMs, 0);
  const stalePublication = publicationAgeMs > maxPublicationAgeMs;
  const rows = (checkpoint.rows ?? []).map((row) => {
    const required = requiredAliases.length === 0
      || requiredAliases.includes(row.alias)
      || requiredAliases.includes(row.specifier);
    const accepted = acceptedAliases.includes(row.alias) || acceptedAliases.includes(row.specifier);
    const publicationRow = (publication.rows ?? []).find((item) => (
      item.alias === row.alias || item.specifier === row.specifier
    )) ?? {};
    const cursorMatches = clean(row.sync?.profileCursor) === clean(profileIntent.cursor)
      || (!row.sync?.profileCursor && !profileIntent.cursor);
    const missingCapabilities = normalizeList(row.capabilities?.missing);
    const blocked = required && (
      row.status === 'blocked'
      || missingCapabilities.length > 0
      || profileIntent.status === 'blocked'
      || (requireExplicitAcceptance && accepted !== true)
    );
    const degraded = blocked !== true && (
      row.status === 'degraded'
      || publicationRow.status === 'degraded'
      || publication.status === 'degraded'
      || stalePublication
      || cursorMatches !== true
      || row.sync?.pending === true
      || row.externalHandoff?.ready !== true
      || (required && accepted !== true)
    );
    const status = blocked ? 'blocked' : degraded ? 'degraded' : 'ready';

    return {
      alias: row.alias,
      specifier: row.specifier,
      provider: row.provider,
      service: row.service,
      kind: row.kind,
      required,
      accepted,
      status,
      restartSafe: status === 'ready'
        && row.externalHandoff?.ready === true
        && publicationRow.restartSafe !== false
        && checkpoint.restartSafe !== false,
      profileCursor: clean(row.sync?.profileCursor) || null,
      cursorMatches,
      pendingSync: row.sync?.pending === true,
      publication: {
        status: publicationRow.status ?? publication.status ?? 'unknown',
        publish: publicationRow.publish === true || publication.publication?.publish === true,
        stale: stalePublication
      },
      capabilities: {
        requested: normalizeList(row.capabilities?.requested),
        missing: missingCapabilities
      },
      externalHandoff: {
        target: row.externalHandoff?.target ?? null,
        statusChannel: row.externalHandoff?.statusChannel ?? null,
        ready: row.externalHandoff?.ready === true
      },
      nextAction: blocked
        ? missingCapabilities.length > 0
          ? 'repair_import_provider_sync_bridge_capabilities'
          : profileIntent.status === 'blocked'
            ? 'repair_profile_sync_intent_before_bridge'
            : requireExplicitAcceptance && accepted !== true
              ? 'accept_import_provider_sync_bridge'
              : 'resolve_import_provider_sync_bridge_blocker'
        : row.externalHandoff?.ready !== true
          ? 'route_import_provider_sync_bridge_to_kernel'
          : cursorMatches !== true
            ? 'publish_profile_cursor_bridge_delta'
            : stalePublication
              ? 'refresh_import_provider_sync_publication'
              : row.sync?.pending === true
                ? 'wait_for_import_provider_sync_bridge_window'
                : publicationRow.publish === true
                  ? 'publish_import_provider_sync_bridge_delta'
                  : 'reuse_import_provider_sync_bridge'
    };
  });
  const missingRequiredAliases = requiredAliases
    .filter((alias) => !rows.some((row) => row.alias === alias || row.specifier === alias))
    .map((alias) => ({
      alias,
      specifier: null,
      provider: 'mailchimp',
      service: null,
      kind: 'missing_import',
      required: true,
      accepted: false,
      status: 'blocked',
      restartSafe: false,
      profileCursor: profileIntent.cursor ?? null,
      cursorMatches: false,
      pendingSync: false,
      publication: {
        status: 'missing',
        publish: true,
        stale: stalePublication
      },
      capabilities: {
        requested: [],
        missing: []
      },
      externalHandoff: {
        target: null,
        statusChannel: 'kernel.status.mailchimp',
        ready: false
      },
      nextAction: 'add_required_import_for_provider_sync_bridge'
    }));
  const bridgeRows = [...rows, ...missingRequiredAliases].sort((left, right) => (
    `${left.alias}:${left.specifier ?? ''}`.localeCompare(`${right.alias}:${right.specifier ?? ''}`)
  ));
  const blockedRows = bridgeRows.filter((row) => row.status === 'blocked');
  const degradedRows = bridgeRows.filter((row) => row.status === 'degraded');
  const fingerprint = importProviderSyncBridgeFingerprint({
    checkpoint,
    publication,
    profileIntent,
    rows: bridgeRows,
    stalePublication,
    requireExplicitAcceptance
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(checkpoint.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(publication.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(profileIntent.status === 'blocked' ? [{
      level: 'error',
      code: 'import_provider_sync_bridge_profile_intent_blocked',
      subject: profileIntent.profileName ?? 'mailchimp.default'
    }] : []),
    ...missingRequiredAliases.map((row) => ({
      level: 'error',
      code: 'import_provider_sync_bridge_required_alias_missing',
      subject: row.alias
    })),
    ...blockedRows.flatMap((row) => row.capabilities.missing.map((capability) => ({
      level: 'error',
      code: 'import_provider_sync_bridge_capability_missing',
      subject: `${row.alias}:${capability}`
    }))),
    ...(requireExplicitAcceptance
      ? bridgeRows
        .filter((row) => row.required && row.accepted !== true)
        .map((row) => ({
          level: 'error',
          code: 'import_provider_sync_bridge_acceptance_missing',
          subject: row.alias
        }))
      : bridgeRows
        .filter((row) => row.required && row.accepted !== true)
        .map((row) => ({
          level: 'warning',
          code: 'import_provider_sync_bridge_acceptance_pending',
          subject: row.alias
        }))),
    ...degradedRows
      .filter((row) => row.cursorMatches !== true)
      .map((row) => ({
        level: 'warning',
        code: 'import_provider_sync_bridge_cursor_mismatch',
        subject: row.alias
      })),
    ...(stalePublication ? [{
      level: 'warning',
      code: 'import_provider_sync_bridge_publication_stale',
      subject: String(publicationAgeMs)
    }] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_import_provider_sync_bridge_blockers'
    : status === 'degraded'
      ? 'publish_import_provider_sync_bridge_advisory'
      : changed
        ? 'publish_import_provider_sync_bridge_ready'
        : 'reuse_import_provider_sync_bridge';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_provider_sync_bridge',
    status,
    restartSafe: status === 'ready' && checkpoint.restartSafe === true && publication.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    profileSyncIntent: profileIntent,
    rows: bridgeRows,
    validationSummary: {
      totalProviders: bridgeRows.length,
      requiredProviders: bridgeRows.filter((row) => row.required).length,
      blockedProviders: blockedRows.length,
      degradedProviders: degradedRows.length,
      pendingAcceptance: bridgeRows.filter((row) => row.required && row.accepted !== true).length,
      cursorMismatches: bridgeRows.filter((row) => row.cursorMatches !== true).length,
      stalePublication: stalePublication ? 1 : 0,
      pendingSyncs: bridgeRows.filter((row) => row.pendingSync).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.alias),
        ...(profileIntent.status === 'blocked' ? ['profile_provider_sync_intent'] : [])
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.alias),
        ...(stalePublication ? ['stale_publication'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-provider-sync-bridge',
      statusChannel: bridgeRows.every((row) => row.externalHandoff.ready !== false)
        ? 'kernel.status.mailchimp'
        : 'local.status.import-provider-sync-bridge',
      publish: changed || status !== 'ready' || stalePublication,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || changed,
      includePublication: publication.publication?.publish === true || stalePublication,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_provider_sync_bridge',
      status,
      restartSafe: status === 'ready' && checkpoint.restartSafe === true && publication.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      profileCursor: profileIntent.cursor ?? null,
      blockedProviders: blockedRows.map((row) => row.alias).sort(),
      degradedProviders: degradedRows.map((row) => row.alias).sort(),
      pendingAcceptance: bridgeRows.filter((row) => row.required && row.accepted !== true).map((row) => row.alias).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportProviderLaunchGate(input = {}, options = {}) {
  const bridge = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && input.title === 'mailchimp_import_provider_sync_bridge'
    ? input
    : buildImportProviderSyncBridge(input, options);
  const publication = options.publication ?? options.importProviderSyncPublication ?? {};
  const checkpoint = options.checkpoint ?? options.importProviderSyncCheckpoint ?? {};
  const previous = normalizeImportProviderLaunchGate(options.previousGate ?? options.previousImportProviderLaunchGate ?? input.previousGate);
  const now = clean(options.now ?? options.timestamp) || null;
  const requiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases);
  const waivedAliases = normalizeList(options.waivedAliases ?? options.importProviderLaunchWaivers ?? options.launchWaivers);
  const allowDegradedLaunch = options.allowDegradedLaunch === true;
  const requirePublication = options.requireProviderSyncPublication !== false;
  const requireKernelHandoff = options.requireKernelHandoff !== false;
  const rows = (bridge.rows ?? []).map((row) => {
    const required = row.required === true
      || requiredAliases.length === 0
      || requiredAliases.includes(row.alias)
      || requiredAliases.includes(row.specifier);
    const waived = waivedAliases.includes(row.alias) || waivedAliases.includes(row.specifier);
    const publicationReady = requirePublication !== true
      || row.publication?.publish === true
      || row.publication?.status === 'ready'
      || publication.status === 'ready';
    const kernelHandoffReady = requireKernelHandoff !== true
      || row.externalHandoff?.ready === true
      || row.externalHandoff?.statusChannel === 'kernel.status.mailchimp';
    const capabilityReady = normalizeList(row.capabilities?.missing).length === 0;
    const syncReady = row.pendingSync !== true && row.cursorMatches !== false;
    const accepted = row.accepted === true || waived === true;
    const blocked = required && waived !== true && (
      row.status === 'blocked'
      || capabilityReady !== true
      || accepted !== true
      || (requirePublication && publicationReady !== true)
    );
    const degraded = blocked !== true && (
      row.status === 'degraded'
      || kernelHandoffReady !== true
      || syncReady !== true
      || (required && row.accepted !== true)
      || bridge.status === 'degraded'
    );

    return {
      alias: row.alias,
      specifier: row.specifier,
      provider: row.provider,
      service: row.service,
      required,
      waived,
      accepted,
      status: blocked ? 'blocked' : degraded ? 'degraded' : 'ready',
      restartSafe: blocked !== true
        && degraded !== true
        && row.restartSafe !== false
        && bridge.restartSafe !== false,
      controls: {
        capabilityReady,
        syncReady,
        publicationReady,
        kernelHandoffReady,
        cursor: row.profileCursor ?? bridge.profileSyncIntent?.cursor ?? null
      },
      reasons: unique([
        ...(capabilityReady ? [] : ['missing_capabilities']),
        ...(accepted ? [] : ['acceptance_pending']),
        ...(publicationReady ? [] : ['sync_publication_pending']),
        ...(kernelHandoffReady ? [] : ['kernel_handoff_pending']),
        ...(syncReady ? [] : ['sync_window_pending'])
      ]),
      nextAction: blocked
        ? capabilityReady !== true
          ? 'repair_import_provider_launch_capabilities'
          : accepted !== true
            ? 'accept_import_provider_launch_gate'
            : publicationReady !== true
              ? 'publish_import_provider_sync_before_launch'
              : 'resolve_import_provider_launch_blocker'
        : degraded
          ? kernelHandoffReady !== true
            ? 'route_import_provider_launch_to_kernel'
            : syncReady !== true
              ? 'wait_for_import_provider_launch_sync'
              : 'publish_import_provider_launch_advisory'
          : 'release_import_provider_launch'
    };
  });
  const missingRequiredAliases = requiredAliases
    .filter((alias) => !rows.some((row) => row.alias === alias || row.specifier === alias))
    .map((alias) => ({
      alias,
      specifier: null,
      provider: 'mailchimp',
      service: null,
      required: true,
      waived: waivedAliases.includes(alias),
      accepted: false,
      status: waivedAliases.includes(alias) ? 'degraded' : 'blocked',
      restartSafe: false,
      controls: {
        capabilityReady: false,
        syncReady: false,
        publicationReady: false,
        kernelHandoffReady: false,
        cursor: bridge.profileSyncIntent?.cursor ?? null
      },
      reasons: ['required_import_missing'],
      nextAction: waivedAliases.includes(alias)
        ? 'publish_import_provider_launch_waiver'
        : 'add_required_import_provider_before_launch'
    }));
  const gateRows = [...rows, ...missingRequiredAliases].sort((left, right) => (
    `${left.alias}:${left.specifier ?? ''}`.localeCompare(`${right.alias}:${right.specifier ?? ''}`)
  ));
  const blockedRows = gateRows.filter((row) => row.status === 'blocked');
  const degradedRows = gateRows.filter((row) => row.status === 'degraded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : degradedRows.length > 0
      ? allowDegradedLaunch ? 'degraded' : 'blocked'
      : 'ready';
  const fingerprint = importProviderLaunchGateFingerprint({
    bridge,
    publication,
    checkpoint,
    rows: gateRows,
    status,
    allowDegradedLaunch,
    requirePublication,
    requireKernelHandoff
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(bridge.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...missingRequiredAliases
      .filter((row) => row.waived !== true)
      .map((row) => ({
        level: 'error',
        code: 'import_provider_launch_required_alias_missing',
        subject: row.alias
      })),
    ...blockedRows.flatMap((row) => row.reasons.map((reason) => ({
      level: 'error',
      code: `import_provider_launch_${reason}`,
      subject: row.alias
    }))),
    ...degradedRows.flatMap((row) => row.reasons.map((reason) => ({
      level: allowDegradedLaunch ? 'warning' : 'error',
      code: `import_provider_launch_${reason}`,
      subject: row.alias
    })))
  ];
  const nextAction = status === 'blocked'
    ? 'resolve_import_provider_launch_blockers'
    : status === 'degraded'
      ? 'publish_import_provider_launch_degraded'
      : changed
        ? 'publish_import_provider_launch_ready'
        : 'reuse_import_provider_launch_gate';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_provider_launch_gate',
    status,
    restartSafe: status === 'ready'
      && bridge.restartSafe === true
      && gateRows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    policy: {
      allowDegradedLaunch,
      requirePublication,
      requireKernelHandoff,
      waivedAliases
    },
    rows: gateRows,
    validationSummary: {
      totalProviders: gateRows.length,
      requiredProviders: gateRows.filter((row) => row.required).length,
      blockedProviders: blockedRows.length,
      degradedProviders: degradedRows.length,
      waivedProviders: gateRows.filter((row) => row.waived).length,
      pendingPublication: gateRows.filter((row) => row.controls.publicationReady !== true).length,
      pendingKernelHandoff: gateRows.filter((row) => row.controls.kernelHandoffReady !== true).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique(blockedRows.flatMap((row) => row.reasons.map((reason) => `${row.alias}:${reason}`))),
      degradedReasons: unique(degradedRows.flatMap((row) => row.reasons.map((reason) => `${row.alias}:${reason}`))),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-provider-launch',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.import-provider-launch',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || changed,
      includeBridge: bridge.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_provider_launch_gate',
      status,
      restartSafe: status === 'ready'
        && bridge.restartSafe === true
        && gateRows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedProviders: blockedRows.map((row) => row.alias).sort(),
      degradedProviders: degradedRows.map((row) => row.alias).sort(),
      waivedProviders: gateRows.filter((row) => row.waived).map((row) => row.alias).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportTenantAuditReadinessContract(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const scope = normalizeImportBoundaryScope(options.scope ?? input.scope ?? options);
  const requestedCapabilities = options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs;
  const boundaryAcceptance = buildImportTenantBoundaryAcceptance(resolved, {
    ...options,
    health,
    requestedCapabilities,
    importScopes: options.importScopes,
    acceptance: options.acceptance ?? options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    scope
  });
  const provider = buildImportProviderContract(resolved, {
    ...options,
    health,
    requestedCapabilities
  });
  const previous = normalizeImportTenantAuditReadiness(options.previousReadiness ?? options.previousImportTenantAuditReadiness ?? input.previousReadiness);
  const now = clean(options.now ?? options.timestamp) || null;
  const importScopes = normalizeImportScopeCatalog(options.importScopes ?? input.importScopes);
  const rows = (resolved.imports ?? []).map((item) => {
    const boundaryRow = (boundaryAcceptance.rows ?? []).find((row) => row.alias === item.alias || row.specifier === item.specifier) ?? {};
    const providerRow = (provider.providers ?? []).find((row) => row.alias === item.alias || row.specifier === item.specifier) ?? {};
    const scopeRow = importScopes[item.alias] ?? importScopes[item.specifier] ?? {};
    const missingCapabilities = normalizeList(providerRow.capabilities?.missing);
    const tenantMismatch = clean(scopeRow.tenantId ?? scope.tenantId) !== scope.tenantId;
    const workspaceMismatch = scope.requestedWorkspaceId
      && clean(scopeRow.workspaceId ?? scope.workspaceId) !== scope.requestedWorkspaceId;
    const auditReady = item.statusChannel === 'kernel.status.mailchimp'
      && item.handoffSafe === true
      && providerRow.externalHandoff?.ready !== false;
    const blocked = boundaryRow.status === 'blocked'
      || missingCapabilities.length > 0
      || tenantMismatch;
    const guarded = blocked !== true && (
      boundaryRow.status === 'guarded'
      || boundaryRow.status === 'degraded'
      || workspaceMismatch
      || auditReady !== true
      || health.status === 'degraded'
    );
    const status = blocked ? 'blocked' : guarded ? 'guarded' : 'ready';

    return {
      alias: item.alias,
      specifier: item.specifier,
      kind: item.kind,
      status,
      tenantId: clean(scopeRow.tenantId) || scope.tenantId,
      workspaceId: clean(scopeRow.workspaceId) || scope.workspaceId,
      restartSafe: status === 'ready' && auditReady && health.restartSafe === true,
      audit: {
        subject: `import:${scope.tenantId}:${scope.workspaceId}:${item.alias}`,
        statusChannel: item.statusChannel,
        handoffSafe: auditReady
      },
      boundaries: {
        tenantMismatch,
        workspaceMismatch,
        permissionMode: scope.permissionMode,
        role: scope.role
      },
      capabilities: {
        requested: normalizeList(providerRow.capabilities?.requested),
        missing: missingCapabilities
      },
      nextAction: blocked
        ? missingCapabilities.length > 0
          ? 'repair_import_tenant_capabilities'
          : tenantMismatch
            ? 'reject_cross_tenant_import'
            : 'resolve_import_tenant_boundary'
        : auditReady !== true
          ? 'route_import_audit_to_kernel_status'
          : workspaceMismatch
            ? 'publish_import_workspace_boundary_advisory'
            : 'publish_import_tenant_audit_ready'
    };
  });
  const missingRequiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases)
    .filter((alias) => !rows.some((row) => row.alias === alias || row.specifier === alias))
    .map((alias) => ({
      alias,
      specifier: null,
      kind: 'missing_import',
      status: 'blocked',
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      restartSafe: false,
      audit: {
        subject: `import:${scope.tenantId}:${scope.workspaceId}:${alias}`,
        statusChannel: 'kernel.status.mailchimp',
        handoffSafe: false
      },
      boundaries: {
        tenantMismatch: false,
        workspaceMismatch: false,
        permissionMode: scope.permissionMode,
        role: scope.role
      },
      capabilities: {
        requested: [],
        missing: []
      },
      nextAction: 'add_required_import_before_tenant_handoff'
    }));
  const auditRows = [...rows, ...missingRequiredAliases].sort((left, right) => left.alias.localeCompare(right.alias));
  const blockedRows = auditRows.filter((row) => row.status === 'blocked');
  const guardedRows = auditRows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = importTenantAuditReadinessFingerprint({
    status,
    scope,
    health,
    provider,
    boundaryAcceptance,
    rows: auditRows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(resolved.diagnostics ?? []),
    ...(boundaryAcceptance.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeImportBoundaryWarnings === true),
    ...(provider.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...missingRequiredAliases.map((row) => ({
      level: 'error',
      code: 'import_tenant_audit_required_alias_missing',
      subject: row.alias
    })),
    ...blockedRows
      .filter((row) => row.boundaries.tenantMismatch)
      .map((row) => ({
        level: 'error',
        code: 'import_tenant_audit_cross_tenant_blocked',
        subject: row.alias
      })),
    ...guardedRows
      .filter((row) => row.audit.handoffSafe !== true)
      .map((row) => ({
        level: 'warning',
        code: 'import_tenant_audit_handoff_guarded',
        subject: row.alias
      }))
  ];

  return {
    ok: status !== 'blocked' && !diagnostics.some((item) => item.level === 'error'),
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_tenant_audit_readiness',
    status,
    restartSafe: status === 'ready' && health.restartSafe === true && auditRows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    scope,
    rows: auditRows,
    validationSummary: {
      totalImports: auditRows.length,
      blockedImports: blockedRows.length,
      guardedImports: guardedRows.length,
      crossTenantBlocks: auditRows.filter((row) => row.boundaries.tenantMismatch).length,
      workspaceAdvisories: auditRows.filter((row) => row.boundaries.workspaceMismatch).length,
      unsafeAuditHandoffs: auditRows.filter((row) => row.audit.handoffSafe !== true).length,
      missingCapabilities: auditRows.reduce((count, row) => count + row.capabilities.missing.length, 0),
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.alias)),
      guardedReasons: unique(guardedRows.map((row) => row.alias)),
      nextAction: status === 'blocked'
        ? 'resolve_import_tenant_audit_blockers'
        : status === 'guarded'
          ? 'publish_import_tenant_audit_guarded'
          : changed
            ? 'publish_import_tenant_audit_ready'
            : 'reuse_import_tenant_audit_readiness'
    },
    auditHandoff: {
      target: 'kernel.status.mailchimp.import-tenant-audit',
      statusChannel: auditRows.every((row) => row.audit.handoffSafe)
        ? 'kernel.status.mailchimp'
        : 'local.status.import-tenant-audit',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      subjects: auditRows.map((row) => row.audit.subject).sort(),
      nextAction: status === 'ready' ? 'publish_import_tenant_audit_ready' : 'review_import_tenant_audit'
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_tenant_audit_readiness',
      status,
      restartSafe: status === 'ready' && auditRows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      blockedImports: blockedRows.map((row) => row.alias).sort(),
      guardedImports: guardedRows.map((row) => row.alias).sort(),
      nextAction: status === 'ready' ? 'publish_import_tenant_audit_ready' : 'review_import_tenant_audit'
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

export function buildImportProviderOperationalBrief(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const provider = buildImportProviderContract(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const readiness = buildImportProviderReadinessPlan(provider, {
    ...options,
    previousReadinessPlan: options.previousReadinessPlan ?? options.previousImportProviderReadiness,
    acceptance: options.acceptance ?? options.importProviderReadinessAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    now: options.now ?? options.timestamp
  });
  const previous = normalizeImportProviderOperationalBrief(options.previousBrief ?? options.previousImportProviderOperationalBrief ?? input.previousBrief);
  const rows = provider.providers.map((item) => {
    const readinessRow = (readiness.rows ?? []).find((row) => row.alias === item.alias || row.specifier === item.specifier) ?? {};
    const blocked = (item.capabilities?.missing ?? []).length > 0 || readinessRow.status === 'blocked';
    const guarded = !blocked && (
      item.handoffSafe !== true
      || item.externalHandoff?.ready !== true
      || readinessRow.status === 'degraded'
      || item.sync?.nextSyncAfterMs !== null
    );
    const status = blocked ? 'blocked' : guarded ? 'guarded' : 'ready';
    return {
      alias: item.alias,
      specifier: item.specifier,
      provider: item.provider,
      service: item.service,
      kind: item.kind,
      status,
      restartSafe: status === 'ready' && item.handoffSafe === true,
      syncMode: item.sync?.mode ?? 'manual',
      nextSyncAfterMs: item.sync?.nextSyncAfterMs ?? null,
      capabilityNegotiation: item.capabilities?.negotiation ?? 'unknown',
      missingCapabilities: item.capabilities?.missing ?? [],
      statusChannel: item.statusChannel,
      externalHandoffReady: item.externalHandoff?.ready === true,
      nextAction: clean(readinessRow.nextAction) || (
        blocked ? 'repair_import_provider_capabilities' : guarded ? 'publish_import_provider_guarded' : 'publish_import_provider_ready'
      )
    };
  });
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0 || provider.status === 'blocked' || health.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || provider.status === 'degraded' || health.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const fingerprint = importProviderOperationalBriefFingerprint({
    status,
    rows,
    health,
    provider
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_import_provider_brief_blockers'
    : status === 'guarded'
      ? guardedRows[0]?.nextAction ?? 'publish_import_provider_brief_guarded'
      : changed
        ? 'publish_import_provider_brief_ready'
        : 'reuse_import_provider_brief';
  const diagnostics = [
    ...provider.diagnostics,
    ...readiness.diagnostics.filter((item) => item.level === 'error' || item.level === 'warning')
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_provider_operational_brief',
    status,
    restartSafe: status === 'ready' && health.restartSafe === true && provider.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows,
    capabilityNegotiation: provider.capabilityNegotiation,
    syncMetadata: provider.syncMetadata,
    externalHandoff: provider.externalHandoff,
    validationSummary: {
      totalProviders: rows.length,
      blockedProviders: blockedRows.map((row) => row.alias).sort(),
      guardedProviders: guardedRows.map((row) => row.alias).sort(),
      missingCapabilities: unique(rows.flatMap((row) => row.missingCapabilities)),
      pendingSyncs: rows.filter((row) => row.nextSyncAfterMs !== null).map((row) => row.alias).sort(),
      unsafeHandoffs: rows.filter((row) => row.externalHandoffReady !== true).map((row) => row.alias).sort(),
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-provider-brief',
      statusChannel: status === 'ready' && health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-provider-brief',
      publish: changed || status !== 'ready' || rows.some((row) => row.nextSyncAfterMs !== null),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_provider_operational_brief',
      status,
      restartSafe: status === 'ready' && health.restartSafe === true && provider.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedProviders: blockedRows.map((row) => row.alias).sort(),
      guardedProviders: guardedRows.map((row) => row.alias).sort(),
      missingCapabilities: unique(rows.flatMap((row) => row.missingCapabilities)),
      nextAction
    },
    diagnostics
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

export function buildImportStatusJournal(input = {}, options = {}) {
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
  const timelineReport = options.timelineReport ?? buildImportTimelineReport(resolved, {
    ...options,
    health,
    analytics,
    historyExport,
    previousTimelineReport: options.previousTimelineReport ?? input.previousTimelineReport
  });
  const lifecycle = options.lifecycle ?? buildImportLifecycleControlState(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? input.previousLifecycle,
    command: options.command ?? input.command,
    settings: options.settings ?? input.settings
  });
  const previous = normalizeImportStatusJournal(options.previousStatusJournal ?? input.previousStatusJournal);
  const now = clean(options.now ?? options.timestamp) || null;
  const commandKey = clean(options.journalCommandKey ?? options.commandKey ?? input.journalCommandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...(options.appliedJournalCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const repeatedCommand = commandKey && seenCommands.has(commandKey);
  const rows = buildImportJournalRows({
    resolved,
    health,
    analytics,
    historyExport,
    timelineReport,
    lifecycle
  });
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded');
  const status = health.status === 'blocked'
    || historyExport.status === 'blocked'
    || timelineReport.status === 'blocked'
    || lifecycle.status === 'disabled'
    || blockedRows.length > 0
    ? 'blocked'
    : health.status === 'degraded'
      || historyExport.status === 'degraded'
      || timelineReport.status === 'degraded'
      || lifecycle.status === 'paused'
      || lifecycle.status === 'retry_scheduled'
      || degradedRows.length > 0
      || repeatedCommand
        ? 'degraded'
        : 'ready';
  const counters = {
    rows: rows.length,
    blockedRows: blockedRows.length,
    degradedRows: degradedRows.length,
    imports: resolved.imports.length,
    capabilities: resolved.capabilityRefs.length,
    unsafeHandoffs: analytics.counters?.unsafeHandoffs ?? 0,
    changedImports: historyExport.counters?.changedImports ?? 0,
    addedImports: historyExport.counters?.addedImports ?? 0,
    removedImports: historyExport.counters?.removedImports ?? 0,
    lifecycleRetries: lifecycle.schedule?.scheduledRetryCount ?? 0,
    timelineEvents: timelineReport.history?.timeline?.length ?? 0,
    diagnosticErrors: rows.reduce((count, row) => count + row.diagnosticErrors, 0),
    diagnosticWarnings: rows.reduce((count, row) => count + row.diagnosticWarnings, 0)
  };
  const diagnostics = [
    ...health.diagnostics,
    ...historyExport.diagnostics.filter((item) => item.level === 'error'),
    ...timelineReport.diagnostics.filter((item) => item.level === 'error'),
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...(repeatedCommand ? [{
      level: 'info',
      code: 'import_status_journal_command_already_applied',
      subject: commandKey
    }] : []),
    ...(previous.schemaVersion && previous.schemaVersion !== IMPORT_SYNTAX_SCHEMA_VERSION
      ? [{
        level: 'warning',
        code: 'import_status_journal_schema_mismatch',
        subject: previous.schemaVersion
      }]
      : [])
  ];
  const fingerprint = importStatusJournalFingerprint({
    status,
    rows,
    health,
    historyExport,
    timelineReport,
    lifecycle
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: now,
    status,
    fingerprint,
    restartSafe: status === 'ready'
      && health.restartSafe === true
      && historyExport.restartSafe === true
      && timelineReport.restartSafe === true
      && lifecycle.ok === true,
    blockedRows: counters.blockedRows,
    degradedRows: counters.degradedRows,
    unsafeHandoffs: counters.unsafeHandoffs,
    changedImports: counters.changedImports,
    commandKey: commandKey || null,
    repeatedCommand: Boolean(repeatedCommand)
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 || repeatedCommand ? [event] : [])
  ].slice(-toPositiveInteger(options.journalHistoryLimit ?? options.historyLimit, 20));
  const statusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const restartSafe = event.restartSafe;
  const nextAction = status === 'blocked'
    ? 'resolve_import_status_journal_blockers'
    : status === 'degraded'
      ? repeatedCommand
        ? 'reuse_import_status_journal_command'
        : 'publish_import_status_journal_degraded'
      : changed
        ? 'publish_import_status_journal'
        : 'reuse_import_status_journal';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_status_journal',
    status,
    restartSafe,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    rows,
    counters,
    history: {
      sequence,
      timeline,
      statusCounts,
      importHistoryTimeline: historyExport.history?.timeline ?? [],
      importTimelineReport: timelineReport.history?.timeline ?? []
    },
    journal: {
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint ?? null,
      replaySafe: status !== 'blocked' && repeatedCommand !== true,
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-journal',
      blockedSubjects: blockedRows.map((row) => row.subject).sort(),
      degradedSubjects: degradedRows.map((row) => row.subject).sort()
    },
    idempotency: {
      commandKey: commandKey || null,
      repeated: Boolean(repeatedCommand),
      applied: Boolean(commandKey) && !repeatedCommand && diagnostics.every((item) => item.level !== 'error'),
      appliedCommandKeys: commandKey && !repeatedCommand && diagnostics.every((item) => item.level !== 'error')
        ? [...seenCommands, commandKey].sort()
        : [...seenCommands].sort()
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-journal',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-journal',
      publish: changed || status !== 'ready' || repeatedCommand,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || changed,
      includeHistory: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_status_journal',
      status,
      restartSafe,
      sequence,
      fingerprint,
      changed,
      importCount: resolved.imports.length,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      degradedRows: degradedRows.map((row) => row.id).sort(),
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-journal',
      nextAction
    },
    diagnostics
  };
}

export function buildImportAnalyticsRecoveryDigest(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const analytics = options.analytics ?? buildImportAnalyticsSnapshot(resolved, {
    ...options,
    health,
    previousAnalytics: options.previousAnalytics ?? options.previousImportAnalytics
  });
  const historyExport = options.historyExport ?? buildImportHistoryExport(resolved, {
    ...options,
    health,
    previousAnalytics: options.previousAnalytics ?? options.previousImportAnalytics,
    previousHistoryExport: options.previousHistoryExport ?? options.previousImportHistoryExport,
    historyLimit: options.historyLimit ?? options.importHistoryLimit,
    now: options.now ?? options.timestamp
  });
  const timelineReport = options.timelineReport ?? buildImportTimelineReport(resolved, {
    ...options,
    health,
    analytics,
    historyExport,
    previousTimelineReport: options.previousTimelineReport ?? options.previousImportTimelineReport,
    timelineLimit: options.timelineLimit ?? options.importTimelineLimit ?? options.historyLimit,
    now: options.now ?? options.timestamp
  });
  const statusJournal = options.statusJournal ?? buildImportStatusJournal(resolved, {
    ...options,
    health,
    analytics,
    historyExport,
    timelineReport,
    previousStatusJournal: options.previousStatusJournal ?? options.previousImportStatusJournal,
    journalCommandKey: options.journalCommandKey ?? options.importStatusJournalCommandKey,
    journalHistoryLimit: options.journalHistoryLimit ?? options.importStatusJournalHistoryLimit ?? options.historyLimit,
    now: options.now ?? options.timestamp
  });
  const previous = normalizeImportAnalyticsRecoveryDigest(
    options.previousDigest ?? options.previousImportAnalyticsRecoveryDigest ?? input.previousDigest
  );
  const commandKey = clean(options.commandKey ?? options.digestCommandKey ?? input.commandKey);
  const seenCommands = new Set([
    ...previous.appliedCommandKeys,
    ...normalizeList(options.appliedCommandKeys ?? options.appliedDigestCommandKeys)
  ]);
  const repeatedCommand = Boolean(commandKey && seenCommands.has(commandKey));
  const rows = [
    importAnalyticsRecoveryRow('health', health, true, {
      fingerprint: [
        health.status,
        health.restartSafe ? 'restart_safe' : 'restart_guarded',
        health.nextRetry?.attempt ?? 'no_retry'
      ].map(clean).filter(Boolean).join(':'),
      nextAction: health.status === 'blocked'
        ? 'resolve_import_health_blockers'
        : health.status === 'degraded'
          ? 'publish_import_health_degraded'
          : 'reuse_import_health',
      evidence: {
        nextRetry: health.nextRetry,
        degradedMode: health.degradedMode,
        statusChannelReady: health.statusChannelReady === true
      }
    }),
    importAnalyticsRecoveryRow('analytics_snapshot', analytics, true, {
      fingerprint: analytics.fingerprint,
      nextAction: analytics.status === 'blocked'
        ? 'rebuild_import_analytics_snapshot'
        : analytics.changed === false
          ? 'reuse_import_analytics_snapshot'
          : 'publish_import_analytics_snapshot',
      evidence: {
        counters: analytics.counters,
        changed: analytics.changed === true
      }
    }),
    importAnalyticsRecoveryRow('history_export', historyExport, true, {
      fingerprint: historyExport.fingerprint,
      nextAction: historyExport.status === 'blocked'
        ? 'repair_import_history_export'
        : historyExport.changed === false
          ? 'reuse_import_history_export'
          : 'publish_import_history_export',
      evidence: {
        rows: historyExport.rows?.length ?? historyExport.exportSummary?.rows ?? 0,
        sequence: historyExport.sequence,
        changed: historyExport.changed === true
      }
    }),
    importAnalyticsRecoveryRow('timeline_report', timelineReport, true, {
      fingerprint: timelineReport.fingerprint,
      nextAction: timelineReport.status === 'blocked'
        ? 'repair_import_timeline_report'
        : timelineReport.changed === false
          ? 'reuse_import_timeline_report'
          : 'publish_import_timeline_report',
      evidence: {
        events: timelineReport.timeline?.length ?? timelineReport.exportSummary?.events ?? 0,
        sequence: timelineReport.sequence,
        changed: timelineReport.changed === true
      }
    }),
    importAnalyticsRecoveryRow('status_journal', statusJournal, true, {
      fingerprint: statusJournal.fingerprint,
      nextAction: statusJournal.status === 'blocked'
        ? 'repair_import_status_journal'
        : statusJournal.changed === false
          ? 'reuse_import_status_journal'
          : 'publish_import_status_journal',
      evidence: {
        sequence: statusJournal.sequence,
        changed: statusJournal.changed === true,
        publishRows: statusJournal.exportSummary?.publishRows ?? []
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe !== true);
  const diagnostics = [
    ...(resolved.diagnostics ?? []),
    ...(health.diagnostics ?? []),
    ...(analytics.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(historyExport.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(timelineReport.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(statusJournal.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(repeatedCommand ? [{ level: 'info', code: 'import_analytics_recovery_digest_command_replayed', subject: commandKey }] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = importAnalyticsRecoveryDigestFingerprint({
    status,
    rows,
    commandKey,
    importCount: resolved.imports?.length ?? 0
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_import_analytics_recovery_blockers'
    : status === 'guarded'
      ? 'publish_import_analytics_recovery_guarded'
      : changed
        ? 'publish_import_analytics_recovery_ready'
        : 'reuse_import_analytics_recovery_digest';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_analytics_recovery_digest',
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    generatedAt: clean(options.now ?? options.timestamp) || null,
    rows,
    counters: {
      imports: resolved.imports?.length ?? 0,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length,
      timelineEvents: timelineReport.timeline?.length ?? timelineReport.exportSummary?.events ?? 0,
      journalRows: statusJournal.rows?.length ?? 0
    },
    idempotency: {
      commandKey: commandKey || null,
      repeated: repeatedCommand,
      applied: Boolean(commandKey) && repeatedCommand !== true && status !== 'blocked',
      appliedCommandKeys: commandKey && repeatedCommand !== true && status !== 'blocked'
        ? unique([...seenCommands, commandKey])
        : unique([...seenCommands])
    },
    recovery: {
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint,
      replaySafe: status !== 'blocked' && repeatedCommand !== true,
      nextRetry: health.nextRetry,
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-analytics-recovery',
      statusChannel: resolved.statusChannels?.includes('kernel.status.mailchimp')
        ? 'kernel.status.mailchimp'
        : 'local.status.import-analytics-recovery',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || changed,
      includeTimeline: timelineReport.status !== 'ready',
      includeJournal: statusJournal.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_analytics_recovery_digest',
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      timelineEvents: timelineReport.timeline?.length ?? timelineReport.exportSummary?.events ?? 0,
      nextAction
    },
    diagnostics
  };
}

export function buildImportOperationalEscalationEnvelope(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const recovery = options.recoveryDigest ?? options.importAnalyticsRecovery ?? buildImportAnalyticsRecoveryDigest(resolved, {
    ...options,
    health,
    previousDigest: options.previousDigest ?? options.previousImportAnalyticsRecoveryDigest
  });
  const provider = options.providerContract ?? buildImportProviderContract(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const readiness = options.providerReadiness ?? buildImportProviderReadinessPlan(provider, {
    ...options,
    previousReadinessPlan: options.previousReadinessPlan ?? options.previousImportProviderReadiness,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases
  });
  const previous = normalizeImportOperationalEscalation(options.previousEscalation ?? options.previousImportEscalation ?? input.previousEscalation);
  const owners = normalizeImportEscalationOwners(options.owners ?? options.importEscalationOwners);
  const thresholds = normalizeImportEscalationThresholds(options.thresholds ?? options.importEscalationThresholds);
  const rows = dedupeImportEscalationRows([
    ...importEscalationRowsFromHealth(health, owners),
    ...importEscalationRowsFromRecovery(recovery, owners),
    ...importEscalationRowsFromProviderReadiness(readiness, owners),
    ...importEscalationRowsFromDiagnostics([
      ...(resolved.diagnostics ?? []),
      ...(provider.diagnostics ?? []),
      ...(readiness.diagnostics ?? [])
    ], owners)
  ]).map((row) => ({
    ...row,
    deadlineMs: row.severity === 'error' ? thresholds.errorMs : row.severity === 'warning' ? thresholds.warningMs : thresholds.infoMs,
    publish: row.severity !== 'info' || recovery.handoff?.publish === true || readiness.handoff?.publish === true
  }));
  const errorRows = rows.filter((row) => row.severity === 'error');
  const warningRows = rows.filter((row) => row.severity === 'warning');
  const status = errorRows.length > 0 || health.status === 'blocked' || provider.status === 'blocked' || readiness.status === 'blocked'
    ? 'blocked'
    : warningRows.length > 0 || health.status === 'degraded' || provider.status === 'degraded' || readiness.status === 'degraded' || recovery.status === 'guarded'
      ? 'degraded'
      : 'ready';
  const fingerprint = importOperationalEscalationFingerprint({
    status,
    rows,
    recovery,
    provider,
    readiness,
    importCount: resolved.imports?.length ?? 0
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextRetry = health.nextRetry ?? recovery.recovery?.nextRetry ?? null;
  const nextAction = status === 'blocked'
    ? 'page_import_operational_owner'
    : status === 'degraded'
      ? nextRetry
        ? 'schedule_import_retry_and_publish_warning'
        : 'publish_import_degraded_escalation'
      : changed
        ? 'publish_import_escalation_clear'
        : 'reuse_import_escalation';
  const diagnostics = [
    ...(health.diagnostics ?? []),
    ...(recovery.diagnostics ?? []),
    ...(provider.diagnostics ?? []),
    ...(readiness.diagnostics ?? [])
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_operational_escalation',
    status,
    restartSafe: status === 'ready' && health.restartSafe === true && provider.restartSafe !== false && readiness.restartSafe !== false,
    sequence,
    fingerprint,
    changed,
    generatedAt: clean(options.now ?? options.timestamp) || null,
    rows,
    counters: {
      imports: resolved.imports?.length ?? 0,
      rows: rows.length,
      errors: errorRows.length,
      warnings: warningRows.length,
      publishRows: rows.filter((row) => row.publish).length,
      missingCapabilities: provider.capabilityNegotiation?.missingCapabilities?.length ?? 0,
      unsafeHandoffs: provider.externalHandoff?.unsafeSpecifiers?.length ?? 0,
      retryScheduled: nextRetry ? 1 : 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    retry: nextRetry,
    escalation: {
      owner: errorRows[0]?.owner ?? warningRows[0]?.owner ?? owners.defaultOwner,
      deadlineMs: errorRows[0]?.deadlineMs ?? warningRows[0]?.deadlineMs ?? thresholds.infoMs,
      nextAction,
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-escalation',
      statusChannel: resolved.statusChannels?.includes('kernel.status.mailchimp')
        ? 'kernel.status.mailchimp'
        : 'local.status.import-escalation',
      publish: changed || status !== 'ready' || rows.some((row) => row.publish),
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: rows.length > 0,
      includeRetry: Boolean(nextRetry),
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_operational_escalation',
      status,
      restartSafe: status === 'ready' && health.restartSafe === true && provider.restartSafe !== false && readiness.restartSafe !== false,
      sequence,
      fingerprint,
      changed,
      owner: errorRows[0]?.owner ?? warningRows[0]?.owner ?? owners.defaultOwner,
      publishRows: rows.filter((row) => row.publish).map((row) => row.id).sort(),
      missingCapabilities: provider.capabilityNegotiation?.missingCapabilities ?? [],
      unsafeHandoffs: provider.externalHandoff?.unsafeSpecifiers ?? [],
      nextRetry,
      nextAction
    },
    diagnostics
  };
}

export function buildImportAnalyticsPublicationLedger(input = {}, options = {}) {
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
  const timelineReport = options.timelineReport ?? buildImportTimelineReport(resolved, {
    ...options,
    health,
    analytics,
    historyExport,
    previousTimelineReport: options.previousTimelineReport ?? input.previousTimelineReport
  });
  const statusJournal = options.statusJournal ?? buildImportStatusJournal(resolved, {
    ...options,
    health,
    analytics,
    historyExport,
    timelineReport,
    previousStatusJournal: options.previousStatusJournal ?? input.previousStatusJournal,
    command: options.journalCommand ?? options.command
  });
  const previous = normalizeImportAnalyticsPublicationLedger(options.previousPublicationLedger ?? input.previousPublicationLedger);
  const commandKey = clean(options.publicationCommandKey ?? options.commandKey ?? input.publicationCommandKey);
  const seenCommands = new Set([
    ...previous.appliedCommandKeys,
    ...(statusJournal.idempotency?.appliedCommandKeys ?? []),
    ...(options.appliedPublicationCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const repeatedCommand = commandKey && seenCommands.has(commandKey);
  const now = clean(options.now ?? options.timestamp) || null;
  const rows = [
    {
      id: 'analytics_snapshot',
      source: 'import_analytics',
      status: analytics.exportSummary?.status ?? health.status,
      restartSafe: analytics.exportSummary?.restartSafe === true,
      sequence: analytics.history?.sequence ?? 0,
      fingerprint: analytics.exportSummary?.fingerprint ?? null,
      publish: true,
      counters: {
        imports: analytics.counters?.totalImports ?? resolved.imports.length,
        diagnostics: analytics.counters?.diagnostics ?? { errors: 0, warnings: 0, info: 0 },
        unsafeHandoffs: analytics.counters?.unsafeHandoffs ?? 0
      },
      nextAction: analytics.exportSummary?.nextRetry ? 'publish_import_analytics_retry_state' : 'publish_import_analytics_snapshot'
    },
    {
      id: 'history_export',
      source: 'import_history',
      status: historyExport.status,
      restartSafe: historyExport.restartSafe === true,
      sequence: historyExport.sequence ?? 0,
      fingerprint: historyExport.fingerprint ?? null,
      publish: historyExport.handoff?.publish !== false,
      counters: {
        addedImports: historyExport.counters?.addedImports ?? 0,
        removedImports: historyExport.counters?.removedImports ?? 0,
        changedImports: historyExport.counters?.changedImports ?? 0
      },
      nextAction: historyExport.handoff?.nextAction ?? historyExport.exportSummary?.nextAction ?? 'publish_import_history'
    },
    {
      id: 'timeline_report',
      source: 'import_timeline',
      status: timelineReport.status,
      restartSafe: timelineReport.restartSafe === true,
      sequence: timelineReport.sequence ?? 0,
      fingerprint: timelineReport.fingerprint ?? null,
      publish: timelineReport.handoff?.publish !== false,
      counters: {
        blockedImports: timelineReport.counters?.blockedImports ?? 0,
        degradedImports: timelineReport.counters?.degradedImports ?? 0,
        retainedTimelineEvents: timelineReport.counters?.retainedTimelineEvents ?? 0
      },
      nextAction: timelineReport.handoff?.nextAction ?? timelineReport.exportSummary?.nextAction ?? 'publish_import_timeline'
    },
    {
      id: 'status_journal',
      source: 'import_journal',
      status: statusJournal.status,
      restartSafe: statusJournal.restartSafe === true,
      sequence: statusJournal.sequence ?? 0,
      fingerprint: statusJournal.fingerprint ?? null,
      publish: statusJournal.handoff?.publish !== false || repeatedCommand,
      counters: {
        rows: statusJournal.counters?.rows ?? 0,
        blockedRows: statusJournal.counters?.blockedRows ?? 0,
        degradedRows: statusJournal.counters?.degradedRows ?? 0
      },
      nextAction: repeatedCommand
        ? 'reuse_import_analytics_publication_command'
        : statusJournal.handoff?.nextAction ?? statusJournal.exportSummary?.nextAction ?? 'publish_import_journal'
    }
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded' || row.restartSafe === false);
  const publishRows = rows.filter((row) => row.publish);
  const diagnostics = [
    ...health.diagnostics,
    ...(historyExport.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(timelineReport.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(statusJournal.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(previous.schemaVersion && previous.schemaVersion !== IMPORT_SYNTAX_SCHEMA_VERSION
      ? [{
        level: 'warning',
        code: 'import_analytics_publication_schema_mismatch',
        subject: previous.schemaVersion
      }]
      : []),
    ...(repeatedCommand ? [{
      level: 'info',
      code: 'import_analytics_publication_command_already_applied',
      subject: commandKey
    }] : []),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'import_analytics_publication_row_blocked',
      subject: row.id
    })),
    ...degradedRows
      .filter((row) => row.status !== 'blocked')
      .map((row) => ({
        level: 'warning',
        code: 'import_analytics_publication_row_guarded',
        subject: row.id
      }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : degradedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';
  const fingerprint = importAnalyticsPublicationLedgerFingerprint({
    status,
    rows,
    statusChannels: resolved.statusChannels,
    commandKey: repeatedCommand ? commandKey : null
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const appliedCommandKeys = commandKey && !repeatedCommand && diagnostics.every((item) => item.level !== 'error')
    ? unique([...previous.appliedCommandKeys, commandKey])
    : previous.appliedCommandKeys;
  const event = {
    sequence,
    timestamp: now,
    status,
    fingerprint,
    changed,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    publishedRows: publishRows.map((row) => row.id).sort(),
    commandKey: commandKey || null,
    repeatedCommand: Boolean(repeatedCommand)
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 || repeatedCommand ? [event] : [])
  ].slice(-toPositiveInteger(options.publicationHistoryLimit ?? options.historyLimit, 16));
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_import_analytics_publication_blockers'
    : status === 'degraded'
      ? 'publish_import_analytics_publication_guarded'
      : changed
        ? 'publish_import_analytics_publication_ready'
        : 'reuse_import_analytics_publication';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_analytics_publication_ledger',
    status,
    restartSafe: event.restartSafe,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    rows,
    counters: {
      rows: rows.length,
      publishRows: publishRows.length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      imports: resolved.imports.length,
      capabilities: resolved.capabilityRefs.length,
      statusChannels: resolved.statusChannels.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    history: {
      sequence,
      timeline,
      analyticsTimeline: analytics.history?.timeline ?? [],
      publicationStatusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    idempotency: {
      commandKey: commandKey || null,
      repeated: Boolean(repeatedCommand),
      applied: Boolean(commandKey) && !repeatedCommand && diagnostics.every((item) => item.level !== 'error'),
      appliedCommandKeys
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-analytics-publication',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-analytics-publication',
      publish: changed || status !== 'ready' || repeatedCommand || publishRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: publishRows.length > 0,
      includeHistory: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_analytics_publication_ledger',
      status,
      restartSafe: event.restartSafe,
      sequence,
      fingerprint,
      changed,
      publishedRows: event.publishedRows,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      degradedRows: degradedRows.map((row) => row.id).sort(),
      statusChannels: resolved.statusChannels,
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

export function buildImportLifecycleCommandSurface(input = {}, options = {}) {
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
  const gatePlan = buildImportGateLifecycleControlPlan(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings,
    featureBoundary: options.featureBoundary ?? options.featureGateBoundary,
    gateControlSettings: options.gateControlSettings ?? options.importGateControlSettings
  });
  const requiredAliases = unique(normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases));
  const missingRequiredAliases = requiredAliases.filter((alias) => !resolved.imports.some((item) => item.alias === alias || item.specifier === alias));
  const rows = [
    {
      id: 'settings',
      status: lifecycle.diagnostics.some((item) => item.code === 'invalid_import_lifecycle_setting') ? 'blocked' : 'ready',
      required: true,
      enabled: lifecycle.enabled === true,
      nextAction: lifecycle.diagnostics.some((item) => item.code === 'invalid_import_lifecycle_setting')
        ? 'repair_import_lifecycle_settings'
        : 'retain_import_lifecycle_settings',
      evidence: {
        scheduleMode: lifecycle.settings?.scheduleMode ?? null,
        retryWindowMs: lifecycle.settings?.retryWindowMs ?? null,
        maxScheduledRetries: lifecycle.settings?.maxScheduledRetries ?? null
      }
    },
    {
      id: 'commands',
      status: lifecycle.ok ? lifecycle.status === 'paused' || lifecycle.status === 'retry_scheduled' ? 'guarded' : 'ready' : 'blocked',
      required: true,
      enabled: lifecycle.enabled === true,
      nextAction: lifecycle.nextAction,
      evidence: {
        controls: lifecycle.controls,
        appliedCommandKeys: lifecycle.idempotency?.appliedCommandKeys ?? []
      }
    },
    {
      id: 'gate_alignment',
      status: gatePlan.status === 'blocked' ? 'blocked' : gatePlan.status === 'degraded' ? 'guarded' : 'ready',
      required: true,
      enabled: gatePlan.status !== 'blocked',
      nextAction: gatePlan.nextAction,
      evidence: {
        blockedImports: gatePlan.exportSummary?.blockedImports ?? [],
        degradedImports: gatePlan.exportSummary?.degradedImports ?? [],
        controls: gatePlan.controls
      }
    },
    {
      id: 'required_aliases',
      status: missingRequiredAliases.length > 0 ? 'blocked' : 'ready',
      required: requiredAliases.length > 0,
      enabled: missingRequiredAliases.length === 0,
      nextAction: missingRequiredAliases.length > 0 ? 'declare_required_import_aliases' : 'retain_required_import_aliases',
      evidence: {
        requiredAliases,
        missingRequiredAliases
      }
    },
    {
      id: 'health_handoff',
      status: health.status === 'blocked' ? 'blocked' : health.status === 'degraded' || health.statusChannelReady !== true ? 'guarded' : 'ready',
      required: true,
      enabled: health.status !== 'blocked',
      nextAction: health.statusChannelReady === true ? 'publish_import_lifecycle_to_kernel' : 'route_import_lifecycle_status_to_kernel',
      evidence: {
        statusChannelReady: health.statusChannelReady === true,
        nextRetry: health.nextRetry ?? null,
        degradedMode: health.degradedMode ?? null
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.required && row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const diagnostics = [
    ...health.diagnostics,
    ...lifecycle.diagnostics.filter((item) => item.level === 'error' || options.includeImportLifecycleSurfaceWarnings === true),
    ...gatePlan.diagnostics.filter((item) => item.level === 'error'),
    ...missingRequiredAliases.map((alias) => ({ level: 'error', code: 'import_lifecycle_required_alias_missing', subject: alias })),
    ...blockedRows.map((row) => ({ level: 'error', code: 'import_lifecycle_command_surface_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'import_lifecycle_command_surface_guarded', subject: row.id }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = [
    'import_lifecycle_command_surface',
    status,
    lifecycle.fingerprint,
    gatePlan.exportSummary?.status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.enabled ? 'enabled' : 'disabled',
      row.nextAction,
      ...(row.evidence.missingRequiredAliases ?? []),
      ...(row.evidence.blockedImports ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
  const nextAction = status === 'blocked'
    ? 'resolve_import_lifecycle_command_surface'
    : status === 'guarded'
      ? 'publish_import_lifecycle_command_surface_guarded'
      : lifecycle.nextAction;

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_lifecycle_command_surface',
    status,
    restartSafe: status === 'ready' && lifecycle.ok && gatePlan.restartSafe === true && health.restartSafe === true,
    fingerprint,
    rows,
    settings: lifecycle.settings,
    controls: {
      ...lifecycle.controls,
      canEnableAllImports: gatePlan.controls?.canEnableAll === true && blockedRows.length === 0,
      canResumeAllImports: gatePlan.controls?.canResumeAll === true && status !== 'blocked',
      publishKernelStatus: health.statusChannelReady === true
    },
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      requiredAliases: requiredAliases.length,
      missingRequiredAliases: missingRequiredAliases.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    nextAction,
    handoff: {
      target: 'kernel.status.mailchimp.import-lifecycle-controls',
      statusChannel: status === 'ready' && health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-lifecycle-controls',
      publish: status !== 'ready' || lifecycle.handoff?.publish === true,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_lifecycle_command_surface',
      status,
      restartSafe: status === 'ready' && lifecycle.ok && gatePlan.restartSafe === true && health.restartSafe === true,
      fingerprint,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
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

export function buildImportWorkspaceBoundaryManifest(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
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
    acceptance: options.acceptance ?? options.boundaryAcceptance ?? options.importBoundaryAcceptance
  });
  const previous = normalizeImportWorkspaceBoundaryManifest(
    options.previousManifest ?? options.previousImportWorkspaceBoundaryManifest
  );
  const scope = normalizeImportBoundaryScope(options.scope ?? boundary.scope ?? options);
  const importScopes = normalizeImportScopeCatalog(options.importScopes ?? input.importScopes);
  const requestedCapabilities = unique([
    ...normalizeList(options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs),
    ...resolved.capabilityRefs
  ]);
  const requestedPermissions = unique(normalizeList(options.requestedPermissions ?? options.importRequestedPermissions));
  const rows = (boundary.preview?.rows ?? []).map((row) => {
    const declared = importScopes[row.alias] ?? importScopes[row.specifier] ?? {};
    const role = clean(declared.role ?? row.role ?? scope.role);
    const roleContract = IMPORT_ROLE_PERMISSIONS[role] ?? IMPORT_ROLE_PERMISSIONS.campaign_operator;
    const allowedCapabilities = unique([
      ...roleContract.capabilities,
      ...normalizeList(declared.capabilities)
    ]);
    const allowedPermissions = unique([
      ...roleContract.permissions,
      ...normalizeList(declared.permissions)
    ]);
    const missingCapabilities = requestedCapabilities
      .filter((capability) => capability.startsWith('mailchimp.') || capability.startsWith('kernel.'))
      .filter((capability) => !allowedCapabilities.includes(capability));
    const missingPermissions = requestedPermissions.filter((permission) => !allowedPermissions.includes(permission));
    const tenantMismatch = Boolean(row.requestedTenantId && row.requestedTenantId !== row.tenantId);
    const workspaceMismatch = Boolean(row.requestedWorkspaceId && row.requestedWorkspaceId !== row.workspaceId);
    const permissionBlocked = missingCapabilities.length > 0 || missingPermissions.length > 0;
    const status = row.status === 'blocked' || tenantMismatch || permissionBlocked
      ? 'blocked'
      : row.status === 'degraded' || workspaceMismatch || row.accepted !== true
        ? 'guarded'
        : 'ready';

    return {
      id: `import_boundary:${row.alias}`,
      alias: row.alias,
      specifier: row.specifier,
      kind: row.kind,
      status,
      required: true,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      requestedTenantId: row.requestedTenantId,
      requestedWorkspaceId: row.requestedWorkspaceId,
      role,
      permissionMode: clean(declared.permissionMode ?? row.permissionMode ?? scope.permissionMode),
      accepted: row.accepted === true,
      restartSafe: status === 'ready' && row.isolation?.handoffSafe === true,
      permissions: {
        requested: requestedPermissions,
        allowed: allowedPermissions,
        missing: missingPermissions,
        mode: clean(declared.permissionMode ?? row.permissionMode ?? scope.permissionMode)
      },
      capabilities: {
        requested: requestedCapabilities,
        allowed: allowedCapabilities,
        missing: missingCapabilities
      },
      isolation: {
        tenant: tenantMismatch ? 'blocked' : row.isolation?.tenant ?? 'enforced',
        workspace: workspaceMismatch ? 'guarded' : row.isolation?.workspace ?? 'enforced',
        statusChannel: row.provider?.statusChannel ?? null,
        auditSubject: `${row.tenantId}/${row.workspaceId}/${row.alias}`
      },
      nextAction: tenantMismatch
        ? 'block_cross_tenant_import'
        : permissionBlocked
          ? 'repair_import_role_permissions'
          : row.isolation?.handoffSafe !== true
            ? 'route_import_boundary_status_to_kernel'
            : row.accepted !== true
              ? 'accept_import_workspace_boundary'
              : 'publish_import_workspace_boundary_ready'
    };
  });
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const acceptedRows = rows.filter((row) => row.accepted === true);
  const fingerprint = importWorkspaceBoundaryManifestFingerprint({ scope, rows });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0 || boundary.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const diagnostics = [
    ...(boundary.diagnostics ?? []),
    ...blockedRows.flatMap((row) => [
      ...row.capabilities.missing.map((capability) => ({
        level: 'error',
        code: 'import_workspace_boundary_capability_denied',
        subject: `${row.alias}:${capability}`
      })),
      ...row.permissions.missing.map((permission) => ({
        level: 'error',
        code: 'import_workspace_boundary_permission_denied',
        subject: `${row.alias}:${permission}`
      }))
    ]),
    ...rows
      .filter((row) => row.isolation.tenant === 'blocked')
      .map((row) => ({
        level: 'error',
        code: 'import_workspace_boundary_tenant_mismatch',
        subject: `${row.requestedTenantId}->${row.tenantId}:${row.alias}`
      })),
    ...guardedRows
      .filter((row) => row.accepted !== true)
      .map((row) => ({
        level: 'warning',
        code: 'import_workspace_boundary_acceptance_pending',
        subject: row.alias
      }))
  ];
  const nextAction = blockedRows[0]?.nextAction
    ?? guardedRows[0]?.nextAction
    ?? (changed ? 'publish_import_workspace_boundary_manifest' : 'reuse_import_workspace_boundary_manifest');

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_workspace_boundary_manifest',
    status,
    restartSafe: status === 'ready' && boundary.restartSafe === true && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    scope: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      requestedTenantId: scope.requestedTenantId || null,
      requestedWorkspaceId: scope.requestedWorkspaceId || null,
      role: scope.role,
      permissionMode: scope.permissionMode
    },
    rows,
    validationSummary: {
      totalImports: rows.length,
      blockedImports: blockedRows.length,
      guardedImports: guardedRows.length,
      acceptedImports: acceptedRows.length,
      missingCapabilities: rows.reduce((count, row) => count + row.capabilities.missing.length, 0),
      missingPermissions: rows.reduce((count, row) => count + row.permissions.missing.length, 0),
      tenantMismatches: rows.filter((row) => row.isolation.tenant === 'blocked').length,
      workspaceAdvisories: rows.filter((row) => row.isolation.workspace === 'guarded' || row.isolation.workspace === 'advisory').length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    auditHandoff: {
      target: 'kernel.audit.mailchimp.import-workspace-boundary',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.import-workspace-boundary',
      subject: `${scope.tenantId}/${scope.workspaceId}/import-workspace-boundary`,
      publish: changed || status !== 'ready',
      includeRows: true,
      includeDeniedPermissions: blockedRows.some((row) => row.permissions.missing.length > 0),
      nextAction
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.alias),
        ...blockedRows.flatMap((row) => row.capabilities.missing.map((capability) => `capability:${capability}`)),
        ...blockedRows.flatMap((row) => row.permissions.missing.map((permission) => `permission:${permission}`))
      ]),
      guardedReasons: unique([
        ...guardedRows.map((row) => row.alias),
        ...guardedRows.filter((row) => row.accepted !== true).map((row) => `acceptance:${row.alias}`)
      ]),
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_workspace_boundary_manifest',
      status,
      restartSafe: status === 'ready' && boundary.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedImports: blockedRows.map((row) => row.alias).sort(),
      guardedImports: guardedRows.map((row) => row.alias).sort(),
      acceptedImports: acceptedRows.map((row) => row.alias).sort(),
      auditSubject: `${scope.tenantId}/${scope.workspaceId}/import-workspace-boundary`,
      nextAction
    },
    diagnostics
  };
}

export function buildImportBoundaryReleaseDecision(input = {}, options = {}) {
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
    acceptance: options.acceptance ?? options.boundaryAcceptance ?? options.importBoundaryAcceptance
  });
  const provider = buildImportProviderContract(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const releasePolicy = normalizeImportBoundaryReleasePolicy(options.releasePolicy ?? input.releasePolicy);
  const boundaryRows = boundary.preview.rows.map((row) => {
    const blocked = row.status === 'blocked';
    const guarded = row.status === 'degraded'
      || (releasePolicy.requireExplicitAcceptance && row.accepted !== true);
    return {
      id: `import:${row.alias}`,
      alias: row.alias,
      specifier: row.specifier,
      source: 'import_boundary',
      status: blocked ? 'blocked' : guarded ? 'guarded' : 'released',
      required: boundary.preview.requiredImports.includes(row.alias) || boundary.preview.requiredImports.includes(row.specifier),
      evidence: {
        tenantId: row.tenantId,
        workspaceId: row.workspaceId,
        accepted: row.accepted,
        isolation: row.isolation,
        provider: row.provider
      },
      nextAction: row.status === 'ready' && (!releasePolicy.requireExplicitAcceptance || row.accepted)
        ? 'release_import_boundary_row'
        : row.nextStep
    };
  });
  const providerRows = provider.providers.map((row) => ({
    id: `provider:${row.alias}`,
    alias: row.alias,
    specifier: row.specifier,
    source: 'import_provider',
    status: row.capabilities.missing.length > 0
      ? 'blocked'
      : row.handoffSafe === true
        ? 'released'
        : 'guarded',
    required: true,
    evidence: {
      missingCapabilities: row.capabilities.missing,
      statusChannel: row.statusChannel,
      handoffSafe: row.handoffSafe,
      syncMode: row.sync.mode
    },
    nextAction: row.capabilities.missing.length > 0
      ? 'repair_import_provider_capability_gap'
      : row.handoffSafe === true
        ? 'release_import_provider_handoff'
        : 'route_import_provider_handoff_to_kernel'
  }));
  const lifecycleRow = {
    id: 'import_lifecycle',
    source: 'import_lifecycle',
    status: ['disabled', 'blocked'].includes(lifecycle.status)
      ? 'blocked'
      : ['paused', 'retry_scheduled', 'enabled_degraded'].includes(lifecycle.status)
        ? 'guarded'
        : 'released',
    required: releasePolicy.requireEnabledLifecycle,
    evidence: {
      status: lifecycle.status,
      enabled: lifecycle.enabled,
      schedule: lifecycle.schedule,
      controls: lifecycle.controls
    },
    nextAction: lifecycle.nextAction
  };
  const rows = [...boundaryRows, ...providerRows, lifecycleRow].sort((left, right) => left.id.localeCompare(right.id));
  const blockedRows = rows.filter((row) => row.status === 'blocked' && row.required !== false);
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const hardBlockers = unique([
    ...boundary.readiness.blockingReasons,
    ...(health.status === 'blocked' ? ['import_health'] : []),
    ...(provider.status === 'blocked' ? ['import_provider'] : []),
    ...(releasePolicy.requireEnabledLifecycle && lifecycleRow.status === 'blocked' ? ['import_lifecycle'] : []),
    ...blockedRows.map((row) => row.id)
  ]);
  const guardedReasons = unique([
    ...boundary.readiness.degradedReasons,
    ...(health.status === 'degraded' ? ['import_health'] : []),
    ...(provider.status === 'degraded' ? ['import_provider'] : []),
    ...guardedRows.map((row) => row.id)
  ]);
  const status = hardBlockers.length > 0
    ? 'blocked'
    : guardedReasons.length > 0
      ? 'guarded'
      : 'released';
  const diagnostics = [
    ...boundary.diagnostics,
    ...provider.diagnostics.filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({ level: 'error', code: 'import_boundary_release_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'import_boundary_release_guarded', subject: row.id }))
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    status,
    restartSafe: status === 'released'
      && health.restartSafe === true
      && boundary.restartSafe === true
      && provider.restartSafe === true
      && lifecycleRow.status === 'released',
    releasePolicy,
    scope: boundary.scope,
    rows,
    readiness: {
      blockingReasons: hardBlockers,
      guardedReasons,
      nextAction: status === 'blocked'
        ? firstImportBoundaryReleaseAction(blockedRows, 'resolve_import_boundary_release_blockers')
        : status === 'guarded'
          ? firstImportBoundaryReleaseAction(guardedRows, 'publish_import_boundary_release_advisory')
          : 'publish_import_boundary_release'
    },
    auditHandoff: {
      target: 'kernel.audit.mailchimp.import-boundary-release',
      subject: `${boundary.scope.tenantId}/${boundary.scope.workspaceId}/imports`,
      decision: status,
      includeRows: status !== 'released',
      includeProviderCapabilityGaps: provider.capabilityNegotiation.missingCapabilities.length > 0
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_boundary_release_decision',
      status,
      restartSafe: status === 'released' && boundary.restartSafe === true,
      tenantId: boundary.scope.tenantId,
      workspaceId: boundary.scope.workspaceId,
      importCount: resolved.imports.length,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      nextAction: status === 'released' ? 'publish_import_boundary_release' : 'review_import_boundary_release'
    },
    diagnostics
  };
}

export function buildImportTenantHandoffBoundaryPacket(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const release = buildImportBoundaryReleaseDecision(resolved, {
    ...options,
    health,
    releasePolicy: options.releasePolicy ?? options.importBoundaryReleasePolicy,
    acceptance: options.acceptance ?? options.importBoundaryHandoffAcceptance ?? options.importBoundaryReleaseAcceptance
  });
  const previous = normalizeImportTenantHandoffBoundary(options.previousPacket ?? options.previousImportTenantHandoffBoundary);
  const now = clean(options.now ?? options.timestamp) || null;
  const importRows = resolved.imports.map((item) => ({
    id: `import_handoff:${item.alias}`,
    source: 'import_status_handoff',
    status: item.handoffSafe ? 'released' : 'guarded',
    required: true,
    nextAction: item.handoffSafe ? 'publish_import_kernel_status_handoff' : 'route_import_status_to_kernel',
    evidence: {
      alias: item.alias,
      specifier: item.specifier,
      statusChannel: item.statusChannel,
      handoffSafe: item.handoffSafe
    }
  }));
  const rows = [
    {
      id: 'import_boundary_release',
      source: 'import_boundary_release',
      status: release.status === 'released' ? 'released' : release.status === 'guarded' ? 'guarded' : 'blocked',
      required: true,
      nextAction: release.readiness?.nextAction ?? release.exportSummary?.nextAction ?? 'review_import_boundary_release',
      evidence: {
        restartSafe: release.restartSafe === true,
        importCount: release.exportSummary?.importCount ?? resolved.imports.length,
        blockedRows: release.exportSummary?.blockedRows ?? [],
        guardedRows: release.exportSummary?.guardedRows ?? []
      }
    },
    {
      id: 'import_health',
      source: 'import_operational_health',
      status: health.status === 'blocked' ? 'blocked' : health.status === 'degraded' ? 'guarded' : 'released',
      required: true,
      nextAction: health.status === 'ready' ? 'publish_import_health_ready' : 'resolve_import_operational_health',
      evidence: {
        healthStatus: health.status,
        restartSafe: health.restartSafe === true,
        nextRetry: health.nextRetry ?? null,
        degradedMode: health.degradedMode ?? null
      }
    },
    ...importRows
  ].sort((left, right) => left.id.localeCompare(right.id));
  const blockedRows = rows.filter((row) => row.status === 'blocked' && row.required !== false);
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'released';
  const fingerprint = importTenantHandoffBoundaryFingerprint({ status, rows });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...release.diagnostics,
    ...health.diagnostics.filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({ level: 'error', code: 'import_tenant_handoff_boundary_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'import_tenant_handoff_boundary_guarded', subject: row.id }))
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_tenant_handoff_boundary',
    status,
    restartSafe: status === 'released' && release.restartSafe === true && health.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    scope: release.scope,
    rows,
    handoff: {
      target: 'kernel.status.mailchimp.import-boundary',
      statusChannel: status === 'released' ? 'kernel.status.mailchimp' : 'local.status.import-boundary',
      publish: changed || status !== 'released',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      nextAction: status === 'blocked'
        ? 'resolve_import_tenant_handoff_boundary'
        : status === 'guarded'
          ? 'publish_import_tenant_handoff_guarded'
          : 'publish_import_tenant_handoff_boundary'
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_tenant_handoff_boundary',
      status,
      restartSafe: status === 'released' && release.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      tenantId: release.scope?.tenantId ?? null,
      workspaceId: release.scope?.workspaceId ?? null,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      importCount: resolved.imports.length,
      nextAction: status === 'released' ? 'publish_import_tenant_handoff_boundary' : 'review_import_tenant_handoff_boundary'
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

export function buildImportProviderSyncStateEnvelope(input = {}, options = {}) {
  const checkpoint = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && input.exportSummary?.title === 'mailchimp_import_provider_sync_checkpoint'
    ? input
    : buildImportProviderSyncCheckpoint(input, options);
  const publication = options.publication ?? options.importProviderSyncPublication ?? buildImportProviderSyncPublication(checkpoint, {
    ...options,
    previousPublication: options.previousPublication ?? options.previousImportProviderSyncPublication
  });
  const bridge = options.bridge ?? options.importProviderSyncBridge ?? buildImportProviderSyncBridge(checkpoint, {
    ...options,
    publication,
    profileProviderSyncIntent: options.profileProviderSyncIntent ?? checkpoint.profileSyncIntent,
    previousBridge: options.previousBridge ?? options.previousImportProviderSyncBridge,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    acceptedAliases: options.acceptedAliases ?? options.importProviderSyncBridgeAcceptedAliases,
    bridgeAcceptance: options.bridgeAcceptance ?? options.importProviderSyncBridgeAcceptance,
    requireExplicitBridgeAcceptance: options.requireExplicitBridgeAcceptance ?? options.requireImportProviderSyncBridgeAcceptance
  });
  const launchGate = options.launchGate ?? options.importProviderLaunchGate ?? buildImportProviderLaunchGate(bridge, {
    ...options,
    publication,
    checkpoint,
    previousGate: options.previousLaunchGate ?? options.previousImportProviderLaunchGate,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    waivedAliases: options.waivedAliases ?? options.importProviderLaunchWaivers
  });
  const previous = normalizeImportProviderSyncStateEnvelope(options.previousEnvelope ?? options.previousImportProviderSyncState ?? input.previousEnvelope);
  const now = clean(options.now ?? options.timestamp) || null;
  const commandKey = clean(options.commandKey ?? options.stateCommandKey ?? options.importProviderSyncStateCommandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...(options.appliedCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const repeatedCommand = commandKey && seenCommands.has(commandKey);
  const rows = (bridge.rows ?? checkpoint.rows ?? []).map((row) => {
    const launchRow = (launchGate.rows ?? []).find((item) => item.alias === row.alias || item.specifier === row.specifier) ?? {};
    const checkpointRow = (checkpoint.rows ?? []).find((item) => item.alias === row.alias || item.specifier === row.specifier) ?? {};
    const status = launchRow.status ?? row.status ?? checkpointRow.status ?? 'ready';
    const blocked = status === 'blocked';
    const degraded = !blocked && status !== 'ready';
    return {
      alias: row.alias,
      specifier: row.specifier,
      provider: row.provider ?? checkpointRow.provider ?? 'mailchimp',
      service: row.service ?? checkpointRow.service ?? null,
      status: blocked ? 'blocked' : degraded ? 'degraded' : 'ready',
      restartSafe: blocked !== true
        && degraded !== true
        && row.restartSafe !== false
        && checkpointRow.externalHandoff?.ready !== false,
      cursor: clean(row.profileCursor ?? checkpointRow.sync?.profileCursor ?? checkpoint.profileSyncIntent?.cursor) || null,
      checkpointKey: clean(checkpointRow.checkpointKey) || null,
      changed: checkpoint.changed === true || publication.changed === true || bridge.changed === true || launchGate.changed === true,
      publication: {
        status: row.publication?.status ?? publication.status ?? 'unknown',
        stale: row.publication?.stale === true || publication.stale === true,
        publish: row.publication?.publish === true || publication.publication?.publish === true
      },
      handoff: {
        target: row.externalHandoff?.target ?? checkpointRow.externalHandoff?.target ?? null,
        statusChannel: row.externalHandoff?.statusChannel ?? checkpointRow.externalHandoff?.statusChannel ?? null,
        ready: row.externalHandoff?.ready === true || checkpointRow.externalHandoff?.ready === true
      },
      nextAction: launchRow.nextAction ?? row.nextAction ?? checkpointRow.nextAction ?? null
    };
  });
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded' || row.restartSafe === false || row.publication.stale === true);
  const status = launchGate.status === 'blocked' || bridge.status === 'blocked' || checkpoint.status === 'blocked' || blockedRows.length > 0
    ? 'blocked'
    : launchGate.status === 'degraded' || bridge.status === 'degraded' || publication.status === 'degraded' || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = importProviderSyncStateEnvelopeFingerprint({
    status,
    checkpoint,
    publication,
    bridge,
    launchGate,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(checkpoint.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(bridge.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(launchGate.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(repeatedCommand ? [{ level: 'info', code: 'import_provider_sync_state_command_already_applied', subject: commandKey }] : []),
    ...blockedRows.map((row) => ({ level: 'error', code: 'import_provider_sync_state_blocked', subject: row.alias })),
    ...degradedRows
      .filter((row) => row.publication.stale)
      .map((row) => ({ level: 'warning', code: 'import_provider_sync_state_publication_stale', subject: row.alias }))
  ];
  const nextAction = status === 'blocked'
    ? 'resolve_import_provider_sync_state_blockers'
    : status === 'degraded'
      ? 'publish_import_provider_sync_state_advisory'
      : changed
        ? 'persist_import_provider_sync_state'
        : 'reuse_import_provider_sync_state';
  const applied = Boolean(commandKey) && !repeatedCommand && diagnostics.every((item) => item.level !== 'error');

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_provider_sync_state',
    status,
    restartSafe: status === 'ready'
      && checkpoint.restartSafe === true
      && bridge.restartSafe === true
      && launchGate.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    rows,
    persistedState: {
      profileCursor: checkpoint.profileSyncIntent?.cursor ?? bridge.profileSyncIntent?.cursor ?? null,
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint ?? null,
      checkpointFingerprint: checkpoint.fingerprint ?? null,
      bridgeFingerprint: bridge.fingerprint ?? null,
      launchFingerprint: launchGate.fingerprint ?? null,
      replaySafe: status !== 'blocked' && repeatedCommand !== true
    },
    idempotency: {
      commandKey: commandKey || null,
      repeated: Boolean(repeatedCommand),
      applied,
      appliedCommandKeys: applied
        ? [...seenCommands, commandKey].sort()
        : [...seenCommands].sort()
    },
    validationSummary: {
      totalProviders: rows.length,
      blockedProviders: blockedRows.length,
      degradedProviders: degradedRows.length,
      stalePublications: rows.filter((row) => row.publication.stale).length,
      changedProviders: rows.filter((row) => row.changed).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.alias)),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.alias),
        ...(repeatedCommand ? ['idempotent_command_replay'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-provider-sync-state',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.import-provider-sync-state',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || changed,
      includePersistedState: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_provider_sync_state',
      status,
      restartSafe: status === 'ready'
        && checkpoint.restartSafe === true
        && bridge.restartSafe === true
        && launchGate.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      profileCursor: checkpoint.profileSyncIntent?.cursor ?? null,
      blockedProviders: blockedRows.map((row) => row.alias).sort(),
      degradedProviders: degradedRows.map((row) => row.alias).sort(),
      nextAction
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

export function buildImportRuntimeClientContract(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const enforcedRequiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases);
  const requestedCapabilities = normalizeList(options.requestedCapabilities ?? options.importRequestedCapabilities);
  const implicitAcceptedAliases = resolved.imports.map((item) => item.alias);
  const clientAcceptance = options.acceptance ?? options.importAcceptance ?? (
    enforcedRequiredAliases.length === 0 ? { accepted: implicitAcceptedAliases } : {}
  );
  const boundaryAcceptance = options.boundaryAcceptance ?? options.importBoundaryAcceptance ?? (
    enforcedRequiredAliases.length === 0 ? { accepted: implicitAcceptedAliases } : {}
  );
  const providerAcceptance = options.providerReadinessAcceptance ?? options.importProviderReadinessAcceptance ?? (
    enforcedRequiredAliases.length === 0 ? { acceptedProviders: implicitAcceptedAliases } : {}
  );
  const lifecycle = buildImportLifecycleControlState(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings
  });
  const client = buildImportClientWorkflowHandoff(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings,
    acceptance: clientAcceptance,
    boundaryAcceptance,
    requiredAliases: enforcedRequiredAliases,
    requestedCapabilities
  });
  const adoption = buildImportRuntimeAdoptionHandoff(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    previousAdoption: options.previousAdoption ?? options.previousImportRuntimeAdoption,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings,
    acceptance: clientAcceptance,
    boundaryAcceptance,
    requiredAliases: enforcedRequiredAliases,
    requestedCapabilities
  });
  const providerReadiness = buildImportProviderReadinessPlan(resolved, {
    ...options,
    health,
    acceptance: providerAcceptance,
    requiredAliases: enforcedRequiredAliases,
    requestedCapabilities
  });
  const previous = normalizeImportRuntimeClientContract(options.previousClientContract ?? options.previousImportRuntimeClientContract ?? input.previousClientContract);
  const clientRowsById = new Map((client.rows ?? []).map((row) => [row.id, row]));
  const adoptionRowsByAlias = new Map((adoption.rows ?? []).map((row) => [row.alias, row]));
  const readinessRowsByAlias = new Map((providerReadiness.rows ?? []).map((row) => [row.alias, row]));
  const importRows = resolved.imports.map((item) => {
    const adoptionRow = adoptionRowsByAlias.get(item.alias) ?? {};
    const readinessRow = readinessRowsByAlias.get(item.alias) ?? {};
    const required = enforcedRequiredAliases.length === 0
      || enforcedRequiredAliases.includes(item.alias)
      || enforcedRequiredAliases.includes(item.specifier);
    const status = adoptionRow.status === 'blocked' || readinessRow.status === 'blocked'
      ? 'blocked'
      : adoptionRow.status === 'degraded' || readinessRow.status === 'degraded' || adoptionRow.status === 'paused' || adoptionRow.status === 'disabled'
        ? 'degraded'
        : 'ready';
    return {
      alias: item.alias,
      specifier: item.specifier,
      kind: item.kind,
      required,
      status,
      adopted: adoptionRow.adopted === true,
      statusChannel: adoptionRow.statusChannel ?? item.statusChannel,
      runtimeTarget: adoptionRow.runtimeTarget ?? `kernel.provider.${item.alias}`,
      missingCapabilities: adoptionRow.capabilities?.missing ?? readinessRow.capabilities?.missing ?? [],
      pendingSync: readinessRow.sync?.pending === true || adoptionRow.sync?.nextSyncAfterMs !== null,
      nextAction: status === 'blocked'
        ? 'repair_import_runtime_client_row'
        : status === 'degraded'
          ? adoptionRow.nextAction ?? readinessRow.nextAction ?? 'publish_import_runtime_client_advisory'
          : adoptionRow.nextAction ?? 'adopt_import_runtime'
    };
  });
  const controlRows = [
    {
      key: 'client_workflow',
      status: client.status,
      required: true,
      restartSafe: client.restartSafe === true,
      nextAction: client.handoff?.nextAction ?? client.exportSummary?.nextAction,
      evidence: {
        blockingRows: client.exportSummary?.blockingRows ?? [],
        degradedRows: client.exportSummary?.degradedRows ?? [],
        statusChannels: client.exportSummary?.statusChannels ?? []
      }
    },
    {
      key: 'lifecycle_controls',
      status: lifecycle.status,
      required: true,
      restartSafe: lifecycle.ok === true && lifecycle.status !== 'disabled' && lifecycle.status !== 'paused',
      nextAction: lifecycle.nextAction,
      evidence: {
        controls: lifecycle.controls,
        schedule: lifecycle.schedule
      }
    },
    {
      key: 'runtime_adoption',
      status: adoption.status,
      required: true,
      restartSafe: adoption.restartSafe === true,
      nextAction: adoption.readiness?.nextAction ?? adoption.handoff?.nextAction,
      evidence: {
        sequence: adoption.sequence,
        changed: adoption.changed,
        blockedImports: adoption.exportSummary?.blockedImports ?? [],
        degradedImports: adoption.exportSummary?.degradedImports ?? []
      }
    },
    {
      key: 'provider_readiness',
      status: providerReadiness.status,
      required: options.requireProviderReadiness !== false,
      restartSafe: providerReadiness.restartSafe === true,
      nextAction: providerReadiness.readiness?.nextAction ?? providerReadiness.handoff?.nextAction,
      evidence: {
        validationSummary: providerReadiness.validationSummary,
        blockedProviders: providerReadiness.exportSummary?.blockedProviders ?? [],
        degradedProviders: providerReadiness.exportSummary?.degradedProviders ?? []
      }
    }
  ];
  const requiredControlRows = controlRows.filter((row) => row.required);
  const requiredImportRows = importRows.filter((row) => row.required);
  const blockedControls = requiredControlRows.filter((row) => row.status === 'blocked');
  const degradedControls = requiredControlRows.filter((row) => (
    !blockedControls.includes(row)
    && (row.status === 'degraded' || row.status === 'paused' || row.status === 'disabled' || row.restartSafe === false)
  ));
  const blockedImports = requiredImportRows.filter((row) => row.status === 'blocked');
  const degradedImports = requiredImportRows.filter((row) => row.status === 'degraded');
  const diagnostics = [
    ...health.diagnostics,
    ...client.diagnostics.filter((item) => item.level === 'error'),
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...adoption.diagnostics.filter((item) => item.level === 'error'),
    ...providerReadiness.diagnostics.filter((item) => item.level === 'error'),
    ...blockedImports.flatMap((row) => row.missingCapabilities.map((capability) => ({
      level: 'error',
      code: 'import_runtime_client_capability_missing',
      subject: `${row.alias}:${capability}`
    })))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedControls.length > 0 || blockedImports.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedControls.length > 0 || degradedImports.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = importRuntimeClientContractFingerprint({
    status,
    controlRows,
    importRows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_import_runtime_client_contract'
    : status === 'degraded'
      ? 'publish_import_runtime_client_degraded'
      : changed
        ? 'publish_import_runtime_client_ready'
        : 'reuse_import_runtime_client_contract';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_runtime_client_contract',
    status,
    restartSafe: status === 'ready' && requiredControlRows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    controls: controlRows,
    imports: importRows,
    validationSummary: {
      totalControls: controlRows.length,
      blockedControls: blockedControls.length,
      degradedControls: degradedControls.length,
      totalImports: importRows.length,
      requiredImports: requiredImportRows.length,
      blockedImports: blockedImports.length,
      degradedImports: degradedImports.length,
      pendingSyncs: requiredImportRows.filter((row) => row.pendingSync).length,
      missingCapabilities: blockedImports.reduce((count, row) => count + row.missingCapabilities.length, 0),
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique([
        ...blockedControls.map((row) => row.key),
        ...blockedImports.map((row) => row.alias)
      ]),
      degradedReasons: unique([
        ...degradedControls.map((row) => row.key),
        ...degradedImports.map((row) => row.alias),
        ...(requiredImportRows.some((row) => row.pendingSync) ? ['pending_provider_sync'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-runtime-client',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-runtime-client',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeControls: true,
      includeImports: status !== 'ready' || changed,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_runtime_client_contract',
      status,
      restartSafe: status === 'ready' && requiredControlRows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedControls: blockedControls.map((row) => row.key).sort(),
      degradedControls: degradedControls.map((row) => row.key).sort(),
      blockedImports: blockedImports.map((row) => row.alias).sort(),
      degradedImports: degradedImports.map((row) => row.alias).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportRuntimeResumeEnvelope(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const runtime = buildImportRuntimeClientContract(resolved, {
    ...options,
    health,
    previousClientContract: options.previousClientContract ?? options.previousImportRuntimeClientContract,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    previousAdoption: options.previousAdoption ?? options.previousImportRuntimeAdoption,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    providerReadinessAcceptance: options.providerReadinessAcceptance ?? options.importProviderReadinessAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities
  });
  const providerReadiness = buildImportProviderReadinessPlan(resolved, {
    ...options,
    health,
    acceptance: options.providerReadinessAcceptance ?? options.importProviderReadinessAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities
  });
  const recovery = buildImportRecoveryHandoff(resolved, {
    ...options,
    health
  });
  const previous = normalizeImportRuntimeClientContract(options.previousResumeEnvelope ?? options.previousImportRuntimeResumeEnvelope ?? input.previousResumeEnvelope);
  const requiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases);
  const requiredImportRows = runtime.imports.filter((row) => (
    requiredAliases.length === 0
      || requiredAliases.includes(row.alias)
      || requiredAliases.includes(row.specifier)
  ));
  const blockedImports = requiredImportRows.filter((row) => row.status === 'blocked');
  const guardedImports = requiredImportRows.filter((row) => row.status === 'degraded' || row.pendingSync === true);
  const blockedControls = runtime.controls.filter((row) => row.required && row.status === 'blocked');
  const guardedControls = runtime.controls.filter((row) => (
    row.required
    && row.status !== 'blocked'
    && (row.status !== 'ready' || row.restartSafe !== true)
  ));
  const retryReady = health.nextRetry !== null && health.status !== 'blocked';
  const diagnostics = [
    ...health.diagnostics,
    ...runtime.diagnostics.filter((item) => item.level === 'error' || options.includeImportResumeWarnings === true),
    ...providerReadiness.diagnostics.filter((item) => item.level === 'error'),
    ...recovery.diagnostics.filter((item) => item.level === 'error')
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedImports.length > 0 || blockedControls.length > 0 || recovery.health?.status === 'blocked'
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedImports.length > 0 || guardedControls.length > 0 || retryReady
      ? 'guarded'
      : 'ready';
  const fingerprint = [
    'import_runtime_resume',
    status,
    runtime.fingerprint,
    providerReadiness.fingerprint,
    recovery.health?.status,
    ...blockedImports.map((row) => row.alias).sort(),
    ...guardedImports.map((row) => row.alias).sort()
  ].map(clean).filter(Boolean).join('|');
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const restartSafe = status === 'ready'
    && health.restartSafe === true
    && runtime.restartSafe === true
    && providerReadiness.restartSafe === true
    && recovery.handoff?.restartSafe === true;

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_runtime_resume',
    status,
    restartSafe,
    sequence,
    fingerprint,
    changed,
    imports: requiredImportRows.map((row) => ({
      alias: row.alias,
      specifier: row.specifier,
      status: row.status,
      adopted: row.adopted,
      pendingSync: row.pendingSync,
      statusChannel: row.statusChannel,
      nextAction: row.nextAction
    })),
    recovery: {
      healthStatus: health.status,
      degradedMode: health.degradedMode,
      nextRetry: health.nextRetry,
      missingImports: recovery.handoff?.missingImports ?? [],
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint ?? null
    },
    readiness: {
      blockingReasons: unique([
        ...blockedControls.map((row) => `control:${row.key}`),
        ...blockedImports.map((row) => `import:${row.alias}`),
        ...(recovery.handoff?.missingImports ?? []).map((specifier) => `missing:${specifier}`)
      ]),
      guardedReasons: unique([
        ...guardedControls.map((row) => `control:${row.key}`),
        ...guardedImports.map((row) => `import:${row.alias}`),
        ...(retryReady ? ['import_retry_scheduled'] : [])
      ]),
      nextAction: status === 'blocked'
        ? 'resolve_import_runtime_resume_blockers'
        : status === 'guarded'
          ? 'publish_import_runtime_resume_guarded'
          : changed
            ? 'publish_import_runtime_resume_ready'
            : 'reuse_import_runtime_resume'
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-runtime-resume',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-runtime-resume',
      publish: changed || status !== 'ready' || retryReady,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeImports: true,
      includeRetry: retryReady,
      nextAction: status === 'ready' ? 'publish_import_runtime_resume_ready' : 'review_import_runtime_resume'
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_runtime_resume',
      status,
      restartSafe,
      sequence,
      fingerprint,
      changed,
      blockedImports: blockedImports.map((row) => row.alias).sort(),
      guardedImports: guardedImports.map((row) => row.alias).sort(),
      blockedControls: blockedControls.map((row) => row.key).sort(),
      guardedControls: guardedControls.map((row) => row.key).sort(),
      nextRetry: health.nextRetry,
      nextAction: status === 'ready' ? 'publish_import_runtime_resume_ready' : 'review_import_runtime_resume'
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

export function buildImportClientPreviewDigest(input = {}, options = {}) {
  const brief = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && input.title === 'mailchimp_import_client_readiness_brief'
    ? input
    : buildImportClientReadinessBrief(input, options);
  const previous = normalizeImportClientPreviewDigest(options.previousDigest ?? options.previousImportClientPreviewDigest ?? input.previousDigest);
  const requireAcceptance = options.requireExplicitAcceptance === true
    || options.requireImportPreviewAcceptance === true;
  const rows = (brief.rows ?? []).map((row) => {
    const blocked = row.status === 'blocked' || row.rejected === true;
    const guarded = blocked !== true && (
      row.status === 'degraded'
      || row.handoffSafe !== true
      || row.required === true && requireAcceptance && row.accepted !== true
    );
    const status = blocked ? 'blocked' : guarded ? 'guarded' : 'ready';
    return {
      alias: row.alias,
      specifier: row.specifier,
      kind: row.kind,
      status,
      required: row.required === true,
      accepted: row.accepted === true,
      rejected: row.rejected === true,
      handoffSafe: row.handoffSafe === true,
      previewReady: row.previewReady === true && blocked !== true,
      exportKey: row.exportKey,
      nextStep: blocked
        ? 'resolve_import_preview_blocker'
        : row.handoffSafe !== true
          ? 'route_import_preview_status_to_kernel'
          : row.required === true && requireAcceptance && row.accepted !== true
            ? 'accept_import_preview'
            : row.nextStep ?? 'include_import_preview'
    };
  });
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const awaitingAcceptance = rows.filter((row) => row.required && row.accepted !== true && row.rejected !== true);
  const status = blockedRows.length > 0 || brief.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || brief.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const fingerprint = importClientPreviewDigestFingerprint({
    status,
    rows,
    briefFingerprint: brief.fingerprint,
    requireAcceptance
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(brief.diagnostics ?? []),
    ...(requireAcceptance
      ? awaitingAcceptance.map((row) => ({
        level: 'error',
        code: 'import_client_preview_acceptance_missing',
        subject: row.alias
      }))
      : awaitingAcceptance.map((row) => ({
        level: 'warning',
        code: 'import_client_preview_acceptance_pending',
        subject: row.alias
      })))
  ];
  const finalStatus = diagnostics.some((item) => item.level === 'error') || status === 'blocked'
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || status === 'guarded'
      ? 'guarded'
      : 'ready';
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(options.now ?? options.timestamp) || null,
      status: finalStatus,
      fingerprint,
      blocked: blockedRows.length,
      guarded: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      changed
    }] : [])
  ].slice(-toPositiveInteger(options.digestHistoryLimit ?? options.historyLimit, 12));
  const nextAction = finalStatus === 'blocked'
    ? 'resolve_import_client_preview_blockers'
    : finalStatus === 'guarded'
      ? 'publish_import_client_preview_guarded'
      : changed
        ? 'publish_import_client_preview_ready'
        : 'reuse_import_client_preview_digest';

  return {
    ok: finalStatus !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_client_preview_digest',
    status: finalStatus,
    restartSafe: finalStatus === 'ready' && brief.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows,
    counters: {
      imports: rows.length,
      blocked: blockedRows.length,
      guarded: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      accepted: rows.filter((row) => row.accepted).length,
      rejected: rows.filter((row) => row.rejected).length,
      unsafeHandoffs: rows.filter((row) => row.handoffSafe !== true).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    validationSummary: {
      ...brief.validationSummary,
      blockedPreviewRows: blockedRows.length,
      guardedPreviewRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      requireAcceptance
    },
    readiness: {
      status: finalStatus,
      blockingReasons: unique([
        ...blockedRows.map((row) => row.alias),
        ...(finalStatus === 'blocked' && requireAcceptance ? awaitingAcceptance.map((row) => `acceptance:${row.alias}`) : [])
      ]),
      guardedReasons: unique([
        ...guardedRows.map((row) => row.alias),
        ...(!requireAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
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
      target: 'kernel.status.mailchimp.imports.preview-digest',
      statusChannel: brief.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      publish: changed || finalStatus !== 'ready' || awaitingAcceptance.length > 0,
      severity: finalStatus === 'blocked' ? 'error' : finalStatus === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeClientReadiness: brief.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_client_preview_digest',
      status: finalStatus,
      restartSafe: finalStatus === 'ready' && brief.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedImports: blockedRows.map((row) => row.alias).sort(),
      guardedImports: guardedRows.map((row) => row.alias).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.alias).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportClientEvidenceManifest(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const readiness = options.readinessBrief ?? options.importClientReadiness ?? buildImportClientReadinessBrief(resolved, {
    ...options,
    health,
    previousBrief: options.previousBrief ?? options.previousImportClientReadinessBrief,
    previousHistoryExport: options.previousHistoryExport ?? options.previousImportHistoryExport,
    previousAnalytics: options.previousAnalytics ?? options.previousImportAnalytics,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const preview = options.previewDigest ?? options.importClientPreviewDigest ?? buildImportClientPreviewDigest(readiness, {
    ...options,
    previousDigest: options.previousDigest ?? options.previousImportClientPreviewDigest,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true
      || options.requireImportPreviewAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const resolution = options.resolutionBrief ?? options.importClientResolutionBrief ?? null;
  const previous = normalizeImportClientEvidenceManifest(options.previousManifest ?? options.previousImportClientEvidenceManifest ?? input.previousManifest);
  const now = clean(options.now ?? options.timestamp) || null;
  const requiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases);
  const rows = [
    ...(readiness.rows ?? []).map((row) => ({
      id: `readiness:${row.alias}`,
      source: 'import_readiness',
      subject: row.alias,
      specifier: row.specifier,
      status: row.status === 'blocked' ? 'blocked' : row.status === 'degraded' ? 'guarded' : 'ready',
      required: row.required === true,
      accepted: row.accepted === true,
      restartSafe: readiness.restartSafe === true && row.handoffSafe === true && row.status !== 'blocked',
      publish: row.status !== 'ready' || row.accepted !== true && row.required === true,
      nextAction: row.nextStep ?? readiness.readiness?.nextAction ?? 'include_import_readiness',
      evidence: {
        kind: row.kind,
        rejected: row.rejected === true,
        handoffSafe: row.handoffSafe === true,
        exportKey: row.exportKey
      }
    })),
    ...(preview.rows ?? []).map((row) => ({
      id: `preview:${row.alias}`,
      source: 'import_preview',
      subject: row.alias,
      specifier: row.specifier,
      status: row.status,
      required: row.required === true,
      accepted: row.accepted === true,
      restartSafe: preview.restartSafe === true && row.handoffSafe === true && row.status === 'ready',
      publish: row.status !== 'ready' || row.accepted !== true && row.required === true,
      nextAction: row.nextStep ?? preview.readiness?.nextAction ?? 'include_import_preview',
      evidence: {
        kind: row.kind,
        rejected: row.rejected === true,
        previewReady: row.previewReady === true,
        handoffSafe: row.handoffSafe === true,
        exportKey: row.exportKey
      }
    })),
    {
      id: 'health:status',
      source: 'import_health',
      subject: health.status,
      specifier: null,
      status: health.status === 'blocked' ? 'blocked' : health.status === 'degraded' ? 'guarded' : 'ready',
      required: true,
      accepted: true,
      restartSafe: health.restartSafe === true,
      publish: health.status !== 'ready' || health.statusChannelReady !== true,
      nextAction: health.status === 'blocked'
        ? 'resolve_import_health_blockers'
        : health.status === 'degraded' || health.statusChannelReady !== true
          ? 'publish_import_health_guarded'
          : 'include_import_health',
      evidence: {
        statusChannelReady: health.statusChannelReady === true,
        retryable: health.retryable === true,
        nextRetry: health.nextRetry,
        degradedMode: health.degradedMode
      }
    },
    ...(resolution ? [{
      id: 'resolution:brief',
      source: 'import_resolution',
      subject: resolution.fingerprint ?? resolution.exportSummary?.fingerprint ?? 'import_resolution',
      specifier: null,
      status: resolution.status === 'blocked' ? 'blocked' : resolution.status === 'guarded' ? 'guarded' : 'ready',
      required: options.requireResolutionBrief !== false,
      accepted: true,
      restartSafe: resolution.restartSafe === true,
      publish: resolution.changed === true || resolution.status !== 'ready',
      nextAction: resolution.readiness?.nextAction ?? resolution.handoff?.nextAction ?? 'include_import_resolution_brief',
      evidence: {
        sequence: resolution.sequence ?? resolution.exportSummary?.sequence ?? 0,
        actionRows: resolution.validationSummary?.actionRows ?? 0,
        clientVisibleRows: resolution.validationSummary?.clientVisibleRows ?? 0
      }
    }] : [])
  ];
  const missingRequiredAliases = requiredAliases.filter((alias) => !resolved.imports.some((item) => (
    item.alias === alias || item.specifier === alias
  )));
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const guardedRows = requiredRows.filter((row) => row.status === 'guarded');
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true);
  const publishRows = rows.filter((row) => row.publish);
  const diagnostics = [
    ...(readiness.diagnostics ?? []),
    ...(preview.diagnostics ?? []),
    ...((resolution?.diagnostics ?? []).filter((item) => item.level === 'error')),
    ...missingRequiredAliases.map((alias) => ({
      level: 'error',
      code: 'import_client_evidence_required_alias_missing',
      subject: alias
    })),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'import_client_evidence_blocked',
      subject: row.id
    })),
    ...guardedRows.map((row) => ({
      level: 'warning',
      code: 'import_client_evidence_guarded',
      subject: row.id
    }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = importClientEvidenceManifestFingerprint({
    status,
    rows,
    readiness,
    preview,
    health,
    resolution
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_import_client_evidence_blockers'
    : status === 'guarded'
      ? 'publish_import_client_evidence_guarded'
      : changed
        ? 'publish_import_client_evidence_manifest'
        : 'reuse_import_client_evidence_manifest';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_client_evidence_manifest',
    status,
    restartSafe: status === 'ready' && health.restartSafe === true && readiness.restartSafe === true && preview.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    rows,
    validationSummary: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      publishRows: publishRows.length,
      missingRequiredAliases: missingRequiredAliases.length,
      unsafeHandoffs: rows.filter((row) => row.evidence?.handoffSafe === false).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique([
        ...missingRequiredAliases.map((alias) => `missing:${alias}`),
        ...blockedRows.map((row) => row.id)
      ]),
      guardedReasons: unique(guardedRows.map((row) => row.id)),
      nextAction
    },
    history: {
      sequence,
      timeline: [
        ...previous.timeline,
        ...(changed || previous.timeline.length === 0 ? [{
          sequence,
          timestamp: now,
          status,
          fingerprint,
          blocked: blockedRows.length,
          guarded: guardedRows.length,
          awaitingAcceptance: awaitingAcceptance.length,
          publishRows: publishRows.length
        }] : [])
      ].slice(-toPositiveInteger(options.manifestHistoryLimit ?? options.historyLimit, 12))
    },
    handoff: {
      target: 'kernel.status.mailchimp.imports.client-evidence',
      statusChannel: status === 'ready' && health.statusChannelReady
        ? 'kernel.status.mailchimp'
        : 'local.status.import-client-evidence',
      publish: changed || status !== 'ready' || publishRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: publishRows.length > 0,
      includePreviewDigest: preview.status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_client_evidence_manifest',
      status,
      restartSafe: status === 'ready' && health.restartSafe === true && readiness.restartSafe === true && preview.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.id).sort(),
      publishRows: publishRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportClientResolutionBrief(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const readiness = buildImportClientReadinessBrief(resolved, {
    ...options,
    health,
    previousBrief: options.previousBrief ?? options.previousImportClientReadinessBrief,
    previousHistoryExport: options.previousHistoryExport ?? options.previousImportHistoryExport,
    previousAnalytics: options.previousAnalytics ?? options.previousImportAnalytics,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const preview = buildImportClientPreviewDigest(readiness, {
    ...options,
    previousDigest: options.previousDigest ?? options.previousImportClientPreviewDigest,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true
      || options.requireImportPreviewAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const recovery = buildImportRecoveryHandoff(resolved, {
    ...options,
    health
  });
  const previous = normalizeImportClientResolutionBrief(options.previousResolutionBrief ?? options.previousImportClientResolutionBrief ?? input.previousResolutionBrief);
  const readinessRows = (readiness.rows ?? [])
    .filter((row) => row.status !== 'ready' || row.handoffSafe !== true || row.accepted !== true && row.required === true)
    .map((row) => ({
      id: `readiness:${row.alias}`,
      source: 'import_readiness',
      subject: row.alias,
      status: row.status === 'degraded' ? 'guarded' : row.status,
      severity: row.status === 'blocked' ? 'error' : row.status === 'ready' ? 'info' : 'warning',
      clientVisible: true,
      nextAction: row.nextStep ?? readiness.readiness?.nextAction ?? 'review_import_readiness',
      evidence: {
        specifier: row.specifier,
        kind: row.kind,
        accepted: row.accepted,
        rejected: row.rejected,
        handoffSafe: row.handoffSafe,
        exportKey: row.exportKey
      }
    }));
  const previewRows = (preview.rows ?? [])
    .filter((row) => row.status !== 'ready' || row.accepted !== true && row.required === true)
    .map((row) => ({
      id: `preview:${row.alias}`,
      source: 'import_preview',
      subject: row.alias,
      status: row.status,
      severity: row.status === 'blocked' ? 'error' : row.status === 'guarded' ? 'warning' : 'info',
      clientVisible: true,
      nextAction: row.nextStep ?? preview.readiness?.nextAction ?? 'review_import_preview',
      evidence: {
        specifier: row.specifier,
        kind: row.kind,
        accepted: row.accepted,
        rejected: row.rejected,
        previewReady: row.previewReady,
        handoffSafe: row.handoffSafe
      }
    }));
  const healthRows = [
    ...(health.status === 'ready' ? [] : [{
      id: 'health:status',
      source: 'import_health',
      subject: health.status,
      status: health.status === 'degraded' ? 'guarded' : health.status,
      severity: health.status === 'blocked' ? 'error' : 'warning',
      clientVisible: true,
      nextAction: health.status === 'blocked' ? 'resolve_import_health_blockers' : 'publish_import_health_guarded',
      evidence: {
        restartSafe: health.restartSafe,
        retryable: health.retryable,
        nextRetry: health.nextRetry,
        degradedMode: health.degradedMode
      }
    }]),
    ...(health.statusChannelReady ? [] : [{
      id: 'health:status_channel',
      source: 'import_health',
      subject: 'kernel.status.mailchimp',
      status: 'guarded',
      severity: 'warning',
      clientVisible: true,
      nextAction: 'route_import_status_to_kernel',
      evidence: {
        statusChannels: resolved.statusChannels,
        recoveryAdapter: recovery.handoff?.adapter ?? 'local'
      }
    }])
  ];
  const rows = dedupeImportClientResolutionRows([
    ...readinessRows,
    ...previewRows,
    ...healthRows
  ]).sort((left, right) => (
    importClientActionRank(right.severity) - importClientActionRank(left.severity)
    || importClientActionStatusRank(right.status) - importClientActionStatusRank(left.status)
    || left.source.localeCompare(right.source)
    || left.subject.localeCompare(right.subject)
  ));
  const blockingRows = rows.filter((row) => row.status === 'blocked' || row.severity === 'error');
  const guardedRows = rows.filter((row) => row.status !== 'blocked' && row.severity !== 'error');
  const status = blockingRows.length > 0 || readiness.status === 'blocked' || preview.status === 'blocked' || health.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || readiness.status === 'degraded' || preview.status === 'guarded' || health.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const fingerprint = importClientResolutionFingerprint({
    status,
    readiness,
    preview,
    health,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(options.now ?? options.timestamp) || null,
      status,
      fingerprint,
      imports: resolved.imports.length,
      blocked: blockingRows.length,
      guarded: guardedRows.length,
      restartSafe: status === 'ready' && readiness.restartSafe === true && preview.restartSafe === true && health.restartSafe === true
    }] : [])
  ].slice(-toPositiveInteger(options.resolutionBriefHistoryLimit ?? options.historyLimit, 12));
  const nextAction = status === 'blocked'
    ? 'resolve_import_client_resolution_blockers'
    : status === 'guarded'
      ? 'publish_import_client_resolution_guarded'
      : changed
        ? 'publish_import_client_resolution_ready'
        : 'reuse_import_client_resolution';
  const diagnostics = [
    ...(readiness.diagnostics ?? []),
    ...(preview.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(health.diagnostics ?? []).filter((item) => item.level === 'error')
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_client_resolution_brief',
    status,
    restartSafe: status === 'ready' && readiness.restartSafe === true && preview.restartSafe === true && health.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockingRows: blockingRows.length,
      guardedRows: guardedRows.length,
      readinessRows: readinessRows.length,
      previewRows: previewRows.length,
      healthRows: healthRows.length,
      missingImports: recovery.handoff?.missingImports?.length ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: unique(blockingRows.map((row) => row.subject)),
      guardedReasons: unique(guardedRows.map((row) => row.subject)),
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
      target: 'mailchimp.client.workflow.import-resolution',
      statusChannel: health.statusChannelReady ? 'kernel.status.mailchimp' : 'local.status.import-resolution',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: rows.length > 0,
      includeRecovery: status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_client_resolution_brief',
      status,
      restartSafe: status === 'ready' && health.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedRows: blockingRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportClientActionQueue(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const readiness = buildImportClientReadinessBrief(resolved, {
    ...options,
    health,
    previousBrief: options.previousBrief ?? options.previousImportClientReadinessBrief,
    previousHistoryExport: options.previousHistoryExport ?? options.previousImportHistoryExport,
    previousAnalytics: options.previousAnalytics ?? options.previousImportAnalytics,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const preview = buildImportClientPreviewDigest(readiness, {
    ...options,
    previousDigest: options.previousDigest ?? options.previousImportClientPreviewDigest,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true
      || options.requireImportPreviewAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const requiredAliases = normalizeList(options.requiredAliases ?? options.requiredImportAliases);
  const readinessRows = (readiness.rows ?? []).map((row) => ({
    id: `import:${row.alias}`,
    source: 'import_readiness',
    subject: row.alias,
    status: row.status,
    severity: row.status === 'blocked'
      ? 'error'
      : row.status === 'degraded' || row.handoffSafe !== true
        ? 'warning'
        : 'info',
    clientVisible: row.required === true || row.status !== 'ready' || row.accepted !== true,
    required: row.required === true,
    nextAction: row.nextStep,
    evidence: {
      specifier: row.specifier,
      kind: row.kind,
      accepted: row.accepted,
      rejected: row.rejected,
      handoffSafe: row.handoffSafe,
      exportKey: row.exportKey
    }
  }));
  const previewRows = (preview.rows ?? []).map((row) => ({
    id: `import_preview:${row.alias}`,
    source: 'import_preview',
    subject: row.alias,
    status: row.status,
    severity: row.status === 'blocked' ? 'error' : row.status === 'guarded' ? 'warning' : 'info',
    clientVisible: row.status !== 'ready' || row.required === true && row.accepted !== true,
    required: row.required === true,
    nextAction: row.nextStep,
    evidence: {
      specifier: row.specifier,
      kind: row.kind,
      accepted: row.accepted,
      rejected: row.rejected,
      handoffSafe: row.handoffSafe,
      previewReady: row.previewReady,
      exportKey: row.exportKey
    }
  }));
  const healthRows = [
    ...(health.status === 'blocked' || health.status === 'degraded' ? [{
      id: 'import_health:status',
      source: 'import_health',
      subject: health.status,
      status: health.status,
      severity: health.status === 'blocked' ? 'error' : 'warning',
      clientVisible: true,
      required: true,
      nextAction: health.status === 'blocked'
        ? 'resolve_import_health_blockers'
        : 'publish_import_health_degraded',
      evidence: {
        restartSafe: health.restartSafe,
        statusChannelReady: health.statusChannelReady,
        nextRetry: health.nextRetry ?? null
      }
    }] : []),
    ...(health.statusChannelReady ? [] : [{
      id: 'import_health:status_channel',
      source: 'import_health',
      subject: 'kernel.status.mailchimp',
      status: 'degraded',
      severity: 'warning',
      clientVisible: true,
      required: true,
      nextAction: 'route_import_status_to_kernel',
      evidence: {
        statusChannels: resolved.statusChannels,
        degradedMode: health.degradedMode
      }
    }])
  ];
  const rows = dedupeImportClientActions([
    ...healthRows,
    ...readinessRows,
    ...previewRows
  ]).sort((left, right) => (
    importClientActionRank(right.severity) - importClientActionRank(left.severity)
    || importClientActionStatusRank(right.status) - importClientActionStatusRank(left.status)
    || left.id.localeCompare(right.id)
  ));
  const blockingRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'degraded' || row.status === 'guarded');
  const awaitingAcceptance = rows.filter((row) => row.required && row.evidence?.accepted !== true && row.evidence?.rejected !== true);
  const visibleRows = rows.filter((row) => row.clientVisible);
  const diagnostics = [
    ...readiness.diagnostics,
    ...preview.diagnostics,
    ...health.diagnostics
  ];
  const status = blockingRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = importClientActionQueueFingerprint({
    status,
    rows,
    readiness,
    preview
  });

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_client_action_queue',
    status,
    restartSafe: status === 'ready' && readiness.restartSafe === true && preview.restartSafe === true && health.restartSafe === true,
    fingerprint,
    rows,
    validationSummary: {
      totalRows: rows.length,
      visibleRows: visibleRows.length,
      blockingRows: blockingRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      requiredAliases: requiredAliases.length,
      unsafeHandoffs: rows.filter((row) => row.evidence?.handoffSafe === false).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: blockingRows.map((row) => row.subject).sort(),
      guardedReasons: guardedRows.map((row) => row.subject).sort(),
      nextAction: status === 'blocked'
        ? 'resolve_import_client_action_blockers'
        : status === 'guarded'
          ? 'publish_import_client_action_guarded'
          : 'publish_import_client_action_ready'
    },
    handoff: {
      target: 'mailchimp.client.workflow.import-actions',
      statusChannel: readiness.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      publish: status !== 'ready' || visibleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: visibleRows.length > 0,
      nextAction: status === 'ready' ? 'publish_import_client_action_ready' : 'review_import_client_action_queue'
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_client_action_queue',
      status,
      restartSafe: status === 'ready' && readiness.restartSafe === true && preview.restartSafe === true && health.restartSafe === true,
      fingerprint,
      visibleActions: visibleRows.map((row) => row.id).sort(),
      blockingActions: blockingRows.map((row) => row.id).sort(),
      guardedActions: guardedRows.map((row) => row.id).sort(),
      nextAction: status === 'ready' ? 'publish_import_client_action_ready' : 'review_import_client_action_queue'
    },
    diagnostics
  };
}

export function buildImportOperationalLedger(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const analytics = buildImportAnalyticsSnapshot(resolved, {
    ...options,
    health,
    previousAnalytics: options.previousAnalytics ?? options.previousImportAnalytics ?? input.previousAnalytics,
    now: options.now ?? options.timestamp
  });
  const providerContract = buildImportProviderContract(resolved, {
    ...options,
    health,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const readiness = buildImportProviderReadinessPlan(providerContract, {
    ...options,
    previousReadinessPlan: options.previousReadinessPlan ?? options.previousImportProviderReadiness ?? input.previousReadinessPlan,
    acceptance: options.providerReadinessAcceptance ?? options.importProviderReadinessAcceptance ?? input.providerReadinessAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases ?? input.requiredAliases,
    now: options.now ?? options.timestamp
  });
  const manifest = buildImportKernelHandoffManifest(resolved, {
    ...options,
    health,
    requestedCapabilities: providerContract.requestedCapabilities
  });
  const previous = normalizeImportOperationalLedger(options.previousLedger ?? options.previousImportOperationalLedger ?? input.previousLedger);
  const now = clean(options.now ?? options.timestamp) || null;
  const rows = [
    importOperationalLedgerRow('resolution_health', health, true, {
      status: health.status,
      restartSafe: health.restartSafe,
      nextAction: health.status === 'blocked'
        ? 'resolve_import_resolution_health'
        : health.status === 'degraded'
          ? 'publish_import_resolution_degraded'
          : 'publish_import_resolution_ready',
      diagnosticCount: (health.diagnostics ?? []).length,
      evidence: {
        statusChannelReady: health.statusChannelReady,
        degradedMode: health.degradedMode,
        nextRetry: health.nextRetry,
        actionableErrorCount: health.actionableErrors?.length ?? 0
      }
    }),
    importOperationalLedgerRow('analytics', analytics, false, {
      status: analytics.exportSummary?.status,
      restartSafe: analytics.exportSummary?.restartSafe,
      nextAction: analytics.exportSummary?.status === 'healthy'
        ? 'publish_import_analytics_snapshot'
        : 'publish_import_analytics_advisory',
      diagnosticCount: (analytics.diagnostics ?? []).length,
      evidence: {
        totalImports: analytics.exportSummary?.totalImports ?? 0,
        unsafeHandoffs: analytics.exportSummary?.unsafeHandoffs ?? 0,
        unresolvedImports: analytics.exportSummary?.unresolvedImports ?? 0,
        statusChannels: analytics.exportSummary?.statusChannels ?? []
      }
    }),
    importOperationalLedgerRow('provider_contract', providerContract, true, {
      status: providerContract.status,
      restartSafe: providerContract.restartSafe,
      nextAction: providerContract.status === 'blocked'
        ? 'repair_import_provider_contract'
        : providerContract.status === 'degraded'
          ? 'publish_import_provider_contract_degraded'
          : 'publish_import_provider_contract',
      diagnosticCount: (providerContract.diagnostics ?? []).length,
      evidence: {
        requestedCapabilities: providerContract.requestedCapabilities ?? [],
        missingCapabilities: providerContract.capabilityNegotiation?.missingCapabilities ?? [],
        unsafeSpecifiers: providerContract.externalHandoff?.unsafeSpecifiers ?? [],
        syncModes: providerContract.syncMetadata?.modes ?? []
      }
    }),
    importOperationalLedgerRow('provider_readiness', readiness, true, {
      status: readiness.status,
      restartSafe: readiness.restartSafe,
      nextAction: readiness.readiness?.nextAction ?? readiness.exportSummary?.nextAction,
      diagnosticCount: (readiness.diagnostics ?? []).length,
      evidence: {
        blockedProviders: readiness.exportSummary?.blockedProviders ?? [],
        degradedProviders: readiness.exportSummary?.degradedProviders ?? [],
        pendingSyncs: readiness.exportSummary?.pendingSyncs ?? [],
        fingerprint: readiness.fingerprint
      }
    }),
    importOperationalLedgerRow('kernel_manifest', manifest, true, {
      status: manifest.status,
      restartSafe: manifest.restartSafe,
      nextAction: manifest.handoff?.nextAction,
      diagnosticCount: (manifest.diagnostics ?? []).length,
      evidence: {
        blockedRows: manifest.summary?.blockedRows ?? [],
        degradedRows: manifest.summary?.degradedRows ?? [],
        statusChannelReady: manifest.summary?.statusChannelReady === true,
        statusChannel: manifest.handoff?.statusChannel
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded' || row.status === 'guarded');
  const diagnostics = [
    ...(health.diagnostics ?? []),
    ...(providerContract.diagnostics ?? []),
    ...(readiness.diagnostics ?? []),
    ...(manifest.diagnostics ?? [])
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : degradedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';
  const fingerprint = importOperationalLedgerFingerprint({
    status,
    rows,
    health,
    providerContract,
    readiness,
    manifest
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_import_operational_ledger_blockers'
    : status === 'degraded'
      ? 'publish_import_operational_ledger_degraded'
      : changed
        ? 'publish_import_operational_ledger'
        : 'reuse_import_operational_ledger';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_operational_ledger',
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    rows,
    counters: {
      rows: rows.length,
      blocked: blockedRows.length,
      degraded: degradedRows.length,
      imports: resolved.imports.length,
      capabilities: resolved.capabilityRefs.length,
      missingCapabilities: providerContract.capabilityNegotiation?.missingCapabilities?.length ?? 0,
      unsafeHandoffs: providerContract.externalHandoff?.unsafeSpecifiers?.length ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    history: {
      sequence,
      timeline: [
        ...previous.timeline,
        ...(changed || previous.timeline.length === 0 ? [{
          sequence,
          timestamp: now,
          status,
          fingerprint,
          blockedRows: blockedRows.map((row) => row.id),
          degradedRows: degradedRows.map((row) => row.id),
          missingCapabilities: providerContract.capabilityNegotiation?.missingCapabilities ?? []
        }] : [])
      ].slice(-toPositiveInteger(options.ledgerHistoryLimit ?? options.historyLimit, 12))
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-operational-ledger',
      statusChannel: manifest.handoff?.statusChannel === 'kernel.status.mailchimp'
        && providerContract.externalHandoff?.status === 'ready'
        ? 'kernel.status.mailchimp'
        : 'local.status.import-operational-ledger',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_operational_ledger',
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      degradedRows: degradedRows.map((row) => row.id).sort(),
      missingCapabilities: providerContract.capabilityNegotiation?.missingCapabilities ?? [],
      unsafeHandoffs: providerContract.externalHandoff?.unsafeSpecifiers ?? [],
      nextAction
    },
    diagnostics
  };
}

export function buildImportClientLaunchReadinessLedger(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const operationalLedger = options.operationalLedger ?? input.operationalLedger ?? buildImportOperationalLedger(resolved, options);
  const previewDigest = options.previewDigest ?? options.importClientPreviewDigest ?? input.previewDigest ?? buildImportClientPreviewDigest(resolved, {
    ...options,
    previousDigest: options.previousImportClientPreviewDigest,
    requireExplicitAcceptance: options.requireImportPreviewAcceptance === true
      || options.requireImportClientAcceptance === true
  });
  const providerLaunchGate = options.providerLaunchGate ?? options.importProviderLaunchGate ?? input.providerLaunchGate ?? {};
  const previous = normalizeImportClientLaunchReadinessLedger(options.previousLedger ?? options.previousImportClientLaunchReadinessLedger ?? input.previousLedger);
  const now = clean(options.now ?? options.timestamp) || null;
  const rows = [
    importClientLaunchReadinessRow('import_operational_ledger', operationalLedger, true, {
      source: 'imports',
      status: operationalLedger.status,
      restartSafe: operationalLedger.restartSafe,
      clientVisible: operationalLedger.status !== 'ready' || (operationalLedger.counters?.blocked ?? 0) > 0,
      fingerprint: operationalLedger.fingerprint ?? operationalLedger.exportSummary?.fingerprint,
      nextAction: operationalLedger.readiness?.nextAction ?? operationalLedger.handoff?.nextAction ?? operationalLedger.exportSummary?.nextAction,
      evidence: {
        blockedRows: operationalLedger.exportSummary?.blockedRows ?? [],
        guardedRows: operationalLedger.exportSummary?.degradedRows ?? [],
        missingCapabilities: operationalLedger.exportSummary?.missingCapabilities ?? [],
        unsafeHandoffs: operationalLedger.exportSummary?.unsafeHandoffs ?? []
      }
    }),
    importClientLaunchReadinessRow('import_client_preview', previewDigest, true, {
      source: 'imports',
      status: previewDigest.status,
      restartSafe: previewDigest.restartSafe,
      clientVisible: previewDigest.status !== 'ready' || (previewDigest.exportSummary?.awaitingAcceptance ?? []).length > 0,
      fingerprint: previewDigest.fingerprint ?? previewDigest.exportSummary?.fingerprint,
      nextAction: previewDigest.readiness?.nextAction ?? previewDigest.handoff?.nextAction ?? previewDigest.exportSummary?.nextAction,
      evidence: {
        awaitingAcceptance: previewDigest.exportSummary?.awaitingAcceptance ?? [],
        blockedRows: previewDigest.exportSummary?.blockedRows ?? [],
        guardedRows: previewDigest.exportSummary?.guardedRows ?? []
      }
    }),
    importClientLaunchReadinessRow('import_provider_launch_gate', providerLaunchGate, true, {
      source: 'imports',
      status: providerLaunchGate.status ?? (providerLaunchGate.ok === false ? 'blocked' : 'ready'),
      restartSafe: providerLaunchGate.restartSafe,
      clientVisible: providerLaunchGate.status !== 'ready',
      fingerprint: providerLaunchGate.fingerprint ?? providerLaunchGate.exportSummary?.fingerprint,
      nextAction: providerLaunchGate.readiness?.nextAction ?? providerLaunchGate.handoff?.nextAction ?? providerLaunchGate.exportSummary?.nextAction,
      evidence: {
        blockedProviders: providerLaunchGate.exportSummary?.blockedProviders ?? [],
        guardedProviders: providerLaunchGate.exportSummary?.guardedProviders ?? providerLaunchGate.exportSummary?.degradedProviders ?? [],
        waivers: providerLaunchGate.exportSummary?.waivers ?? []
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const diagnostics = [
    ...(operationalLedger.diagnostics ?? []),
    ...(previewDigest.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(providerLaunchGate.diagnostics ?? []).filter((item) => item.level === 'error')
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = [
    status,
    resolved.capabilityRefs.join(','),
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.clientVisible ? 'visible' : 'hidden',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_import_launch_readiness_blockers'
    : status === 'guarded'
      ? 'publish_import_launch_readiness_guarded'
      : changed
        ? 'publish_import_launch_readiness_ready'
        : 'reuse_import_launch_readiness';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_launch_readiness_ledger',
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      clientVisibleRows: rows.filter((row) => row.clientVisible).length,
      imports: resolved.imports.length,
      capabilities: resolved.capabilityRefs.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    history: {
      sequence,
      timeline: [
        ...previous.timeline,
        ...(changed || previous.timeline.length === 0 ? [{
          sequence,
          timestamp: now,
          status,
          fingerprint,
          blockedRows: blockedRows.map((row) => row.id).sort(),
          guardedRows: guardedRows.map((row) => row.id).sort(),
          imports: resolved.imports.length
        }] : [])
      ].slice(-toPositiveInteger(options.importLaunchReadinessHistoryLimit ?? options.historyLimit, 12))
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-launch-readiness',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.import-launch-readiness',
      publish: changed || status !== 'ready' || rows.some((row) => row.clientVisible),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_launch_readiness_ledger',
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      clientVisibleRows: rows.filter((row) => row.clientVisible).map((row) => row.id).sort(),
      imports: resolved.imports.map((item) => item.alias).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportClientPreviewRouteContract(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const readiness = options.readinessBrief ?? options.importClientReadiness ?? buildImportClientReadinessBrief(resolved, {
    ...options,
    previousBrief: options.previousBrief ?? options.previousImportClientReadinessBrief,
    previousHistoryExport: options.previousHistoryExport ?? options.previousImportHistoryExport,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities,
    now: options.now ?? options.timestamp
  });
  const preview = options.previewDigest ?? options.importClientPreviewDigest ?? buildImportClientPreviewDigest(readiness, {
    ...options,
    previousDigest: options.previousDigest ?? options.previousImportClientPreviewDigest,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true
      || options.requireImportPreviewAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const resolution = options.resolutionBrief ?? options.importClientResolutionBrief ?? buildImportClientResolutionBrief(resolved, {
    ...options,
    previousResolutionBrief: options.previousResolutionBrief ?? options.previousImportClientResolutionBrief,
    previousBrief: options.previousBrief ?? options.previousImportClientReadinessBrief,
    previousDigest: options.previousDigest ?? options.previousImportClientPreviewDigest,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true
      || options.requireImportPreviewAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const evidence = options.evidenceManifest ?? options.importClientEvidenceManifest ?? buildImportClientEvidenceManifest(resolved, {
    ...options,
    readinessBrief: readiness,
    previewDigest: preview,
    resolutionBrief: resolution,
    previousManifest: options.previousManifest ?? options.previousImportClientEvidenceManifest,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true
      || options.requireImportPreviewAcceptance === true,
    now: options.now ?? options.timestamp
  });
  const actionQueue = options.actionQueue ?? options.importClientActionQueue ?? buildImportClientActionQueue(resolved, {
    ...options,
    previousBrief: options.previousBrief ?? options.previousImportClientReadinessBrief,
    previousDigest: options.previousDigest ?? options.previousImportClientPreviewDigest,
    previousHistoryExport: options.previousHistoryExport ?? options.previousImportHistoryExport,
    previousAnalytics: options.previousAnalytics ?? options.previousImportAnalytics,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true
      || options.requireImportPreviewAcceptance === true
  });
  const previous = normalizeImportClientPreviewRoute(options.previousRoute ?? options.previousImportClientPreviewRoute ?? input.previousRoute);
  const now = clean(options.now ?? options.timestamp) || null;
  const rows = [
    importClientPreviewRouteRow('readiness', readiness, true, {
      visible: true,
      nextAction: readiness.readiness?.nextAction ?? readiness.handoff?.nextAction
    }),
    importClientPreviewRouteRow('preview_acceptance', preview, true, {
      visible: true,
      nextAction: preview.readiness?.nextAction ?? preview.handoff?.nextAction,
      awaitingAcceptance: preview.exportSummary?.awaitingAcceptance ?? []
    }),
    importClientPreviewRouteRow('evidence_manifest', evidence, options.includeEvidenceManifest !== false, {
      visible: evidence.handoff?.includePreviewDigest === true || evidence.status !== 'ready',
      nextAction: evidence.readiness?.nextAction ?? evidence.handoff?.nextAction,
      awaitingAcceptance: evidence.exportSummary?.awaitingAcceptance ?? []
    }),
    importClientPreviewRouteRow('resolution_brief', resolution, options.includeResolutionBrief !== false, {
      visible: resolution.status !== 'ready' || (resolution.rows ?? []).length > 0,
      nextAction: resolution.readiness?.nextAction ?? resolution.handoff?.nextAction
    }),
    importClientPreviewRouteRow('action_queue', actionQueue, options.includeActionQueue !== false, {
      visible: actionQueue.status !== 'ready' || (actionQueue.rows ?? []).length > 0,
      nextAction: actionQueue.handoff?.nextAction ?? actionQueue.exportSummary?.nextAction
    })
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const guardedRows = requiredRows.filter((row) => row.status === 'guarded' || row.restartSafe !== true);
  const awaitingAcceptance = unique(rows.flatMap((row) => row.awaitingAcceptance));
  const diagnostics = [
    ...(readiness.diagnostics ?? []),
    ...(preview.diagnostics ?? []),
    ...(evidence.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeEvidenceWarnings === true),
    ...(resolution.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeResolutionWarnings === true),
    ...(actionQueue.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeActionWarnings === true),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'import_client_preview_route_blocked',
      subject: row.id
    })),
    ...guardedRows.map((row) => ({
      level: 'warning',
      code: 'import_client_preview_route_guarded',
      subject: row.id
    }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = importClientPreviewRouteFingerprint({ status, rows, awaitingAcceptance });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_import_preview_route_blockers'
    : status === 'guarded'
      ? 'publish_import_preview_route_guarded'
      : awaitingAcceptance.length > 0
        ? 'request_import_preview_acceptance'
        : changed
          ? 'publish_import_preview_route'
          : 'reuse_import_preview_route';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_client_preview_route',
    status,
    restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    rows,
    routeState: {
      previewVisible: rows.some((row) => row.visibleToClient),
      acceptEnabled: status !== 'blocked' && awaitingAcceptance.length > 0,
      readyEnabled: status === 'ready' && awaitingAcceptance.length === 0,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance
    },
    validationSummary: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      visibleRows: rows.filter((row) => row.visibleToClient).length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      importCount: resolved.imports?.length ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    explanation: {
      headline: status === 'ready'
        ? 'mailchimp_import_preview_route_ready'
        : status === 'guarded'
          ? 'mailchimp_import_preview_route_guarded'
          : 'mailchimp_import_preview_route_blocked',
      nextSteps: unique(rows
        .filter((row) => row.status !== 'ready' || row.awaitingAcceptance.length > 0 || row.visibleToClient)
        .map((row) => row.nextAction))
    },
    handoff: {
      target: 'client.route.mailchimp.import-preview',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.import-preview-route',
      publish: changed || status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeRouteState: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_client_preview_route',
      status,
      restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance,
      visibleRows: rows.filter((row) => row.visibleToClient).map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportTenantScopedPreviewRoute(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const scope = normalizeImportBoundaryScope(options.scope ?? {
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    requestedTenantId: options.requestedTenantId ?? options.requestTenantId,
    requestedWorkspaceId: options.requestedWorkspaceId ?? options.requestWorkspaceId,
    role: options.role,
    permissionMode: options.permissionMode
  });
  const route = buildImportClientPreviewRouteContract(resolved, {
    ...options,
    previousRoute: options.previousRoute ?? options.previousImportClientPreviewRoute,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases
  });
  const audit = buildImportTenantAuditReadinessContract(resolved, {
    ...options,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs,
    importScopes: options.importScopes,
    previousAuditReadiness: options.previousAuditReadiness ?? options.previousImportTenantAuditReadiness,
    acceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    scope
  });
  const previous = normalizeImportTenantScopedPreviewRoute(
    options.previousScopedRoute ?? options.previousImportTenantScopedPreviewRoute
  );
  const boundaryBlocked = audit.status === 'blocked'
    || audit.tenantIsolation === 'blocked'
    || audit.workspaceIsolation === 'blocked';
  const boundaryGuarded = boundaryBlocked !== true && (
    audit.status === 'degraded'
    || audit.status === 'guarded'
    || audit.workspaceIsolation === 'advisory'
    || route.restartSafe !== true
  );
  const rows = dedupeImportTenantScopedPreviewRows([
    importTenantScopedPreviewRow('import_preview_route', route, true, {
      visible: route.routeState?.previewVisible === true || route.status !== 'ready',
      nextAction: route.handoff?.nextAction ?? route.exportSummary?.nextAction,
      evidence: {
        blockedRows: route.exportSummary?.blockedRows ?? [],
        guardedRows: route.exportSummary?.guardedRows ?? [],
        awaitingAcceptance: route.exportSummary?.awaitingAcceptance ?? []
      }
    }),
    importTenantScopedPreviewRow('tenant_audit_boundary', audit, true, {
      status: boundaryBlocked ? 'blocked' : boundaryGuarded ? 'guarded' : 'ready',
      visible: boundaryBlocked || boundaryGuarded || audit.handoff?.publish === true,
      nextAction: audit.handoff?.nextAction ?? audit.exportSummary?.nextAction,
      evidence: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        requestedTenantId: scope.requestedTenantId || null,
        requestedWorkspaceId: scope.requestedWorkspaceId || null,
        role: scope.role,
        permissionMode: scope.permissionMode,
        deniedCapabilities: audit.exportSummary?.deniedCapabilities ?? audit.deniedCapabilities ?? [],
        auditSubject: audit.auditHandoff?.subject ?? audit.exportSummary?.auditSubject ?? null
      }
    })
  ]);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0 ? 'blocked' : guardedRows.length > 0 ? 'guarded' : 'ready';
  const fingerprint = importTenantScopedPreviewRouteFingerprint({
    status,
    scope,
    rows,
    route,
    audit
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(route.diagnostics ?? []),
    ...(audit.diagnostics ?? []),
    ...blockedRows.map((row) => ({ level: 'error', code: 'import_tenant_scoped_preview_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'import_tenant_scoped_preview_guarded', subject: row.id }))
  ];
  const nextAction = blockedRows[0]?.nextAction
    ?? guardedRows[0]?.nextAction
    ?? (changed ? 'publish_import_tenant_scoped_preview_route' : 'reuse_import_tenant_scoped_preview_route');

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_tenant_scoped_preview_route',
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    scope: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      requestedTenantId: scope.requestedTenantId || null,
      requestedWorkspaceId: scope.requestedWorkspaceId || null,
      role: scope.role,
      permissionMode: scope.permissionMode
    },
    rows,
    routeState: {
      ...route.routeState,
      tenantBoundaryClear: boundaryBlocked !== true,
      auditReady: audit.status === 'ready',
      previewVisible: route.routeState?.previewVisible === true || rows.some((row) => row.visibleToClient),
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort()
    },
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      visibleRows: rows.filter((row) => row.visibleToClient).length,
      deniedCapabilities: audit.exportSummary?.deniedCapabilities?.length ?? audit.deniedCapabilities?.length ?? 0,
      awaitingAcceptance: route.validationSummary?.awaitingAcceptance ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    handoff: {
      target: 'client.route.mailchimp.import-preview.tenant-scoped',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.import-tenant-preview',
      publish: changed || status !== 'ready' || rows.some((row) => row.visibleToClient),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRouteState: true,
      includeAuditBoundary: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_tenant_scoped_preview_route',
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      visibleRows: rows.filter((row) => row.visibleToClient).map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function selfCheckImportSyntax() {
  return resolveImportSyntax('import profile from "@mailchimp/profile"\nimport gates from "@mailchimp/gates"');
}

function normalizeImportTenantScopedPreviewRoute(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function importTenantScopedPreviewRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' ? 'guarded' : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && status !== 'ready';
  return {
    id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required: required === true,
    restartSafe: blocked !== true && guarded !== true && source.restartSafe !== false,
    visibleToClient: fallback.visible === true || blocked || guarded,
    fingerprint: clean(source.fingerprint ?? source.exportSummary?.fingerprint),
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (blocked ? `resolve_${id}` : guarded ? `review_${id}` : `publish_${id}`),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function dedupeImportTenantScopedPreviewRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object' && clean(row.id))
    .filter((row) => {
      const key = [row.id, row.status, row.nextAction].map(clean).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      importEscalationSeverityRank(right.status === 'blocked' ? 'error' : right.status === 'guarded' ? 'warning' : 'info')
      - importEscalationSeverityRank(left.status === 'blocked' ? 'error' : left.status === 'guarded' ? 'warning' : 'info')
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function importTenantScopedPreviewRouteFingerprint({
  status,
  scope,
  rows,
  route,
  audit
}) {
  return [
    'import_tenant_scoped_preview_route',
    status,
    scope.tenantId,
    scope.workspaceId,
    scope.requestedTenantId,
    scope.requestedWorkspaceId,
    scope.role,
    scope.permissionMode,
    route.fingerprint ?? route.exportSummary?.fingerprint ?? '',
    audit.fingerprint ?? audit.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.visibleToClient ? 'visible' : 'hidden',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeImportInput(input) {
  if (input?.imports) return { ...input, diagnostics: input.diagnostics ?? [] };
  return { imports: [], diagnostics: [] };
}

function normalizeImportClientPreviewDigest(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function importClientPreviewDigestFingerprint({
  status,
  rows,
  briefFingerprint,
  requireAcceptance
}) {
  return [
    status,
    briefFingerprint,
    requireAcceptance ? 'explicit_acceptance' : 'implicit_acceptance',
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.rejected ? 'rejected' : 'not_rejected',
      row.handoffSafe ? 'handoff_safe' : 'handoff_guarded',
      row.previewReady ? 'preview_ready' : 'preview_guarded',
      row.nextStep ?? 'no_next_step'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeImportAnalyticsHistory(input) {
  const history = input?.history ?? input;
  return {
    sequence: toNonNegativeInteger(history?.sequence, 0),
    timeline: Array.isArray(history?.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function normalizeImportAnalyticsPublicationLedger(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : {};
  return {
    schemaVersion: clean(value.schemaVersion),
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline)
      ? history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : [],
    appliedCommandKeys: Array.isArray(value.appliedCommandKeys)
      ? value.appliedCommandKeys.map(clean).filter(Boolean)
      : Array.isArray(value.idempotency?.appliedCommandKeys)
        ? value.idempotency.appliedCommandKeys.map(clean).filter(Boolean)
        : []
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

function normalizeImportStatusJournal(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    schemaVersion: clean(value.schemaVersion),
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    lastStableFingerprint: clean(value.journal?.lastStableFingerprint ?? value.lastStableFingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : [],
    appliedCommandKeys: normalizeList(value.idempotency?.appliedCommandKeys ?? value.appliedCommandKeys)
  };
}

function buildImportJournalRows({
  resolved,
  health,
  analytics,
  historyExport,
  timelineReport,
  lifecycle
}) {
  const importRows = resolved.imports.map((item) => {
    const timelineRow = (timelineReport.report?.rows ?? []).find((row) => (
      row.alias === item.alias || row.specifier === item.specifier
    )) ?? {};
    const historyRow = (historyExport.snapshot?.imports ?? []).find((row) => (
      row.alias === item.alias || row.specifier === item.specifier
    )) ?? {};
    const diagnosticRows = health.diagnostics.filter((diagnostic) => (
      diagnostic.subject === item.alias || diagnostic.subject === item.specifier
    ));
    const status = timelineRow.status === 'blocked' || item.handoffSafe !== true
      ? 'blocked'
      : timelineRow.status === 'degraded' || historyRow.handoffSafe === false
        ? 'degraded'
        : 'ready';
    return {
      id: `import:${item.alias}`,
      source: 'import',
      subject: item.specifier,
      alias: item.alias,
      status,
      restartSafe: status === 'ready' && item.handoffSafe === true,
      diagnosticErrors: diagnosticRows.filter((diagnostic) => diagnostic.level === 'error').length,
      diagnosticWarnings: diagnosticRows.filter((diagnostic) => diagnostic.level === 'warning').length,
      evidence: {
        kind: item.kind,
        capabilityRefs: item.capabilities,
        statusChannel: item.statusChannel,
        handoffSafe: item.handoffSafe,
        delta: timelineRow.delta ?? 'unchanged'
      },
      nextAction: status === 'blocked'
        ? item.handoffSafe !== true
          ? 'route_import_journal_status_to_kernel'
          : 'resolve_import_journal_import_blocker'
        : status === 'degraded'
          ? 'publish_import_journal_import_advisory'
          : 'include_import_journal_row'
    };
  });
  const aggregateRows = [
    {
      id: 'health',
      source: 'import_health',
      subject: health.status,
      status: health.status === 'blocked' ? 'blocked' : health.status === 'degraded' ? 'degraded' : 'ready',
      restartSafe: health.restartSafe === true,
      diagnosticErrors: health.diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: health.diagnostics.filter((item) => item.level === 'warning').length,
      evidence: {
        retryable: health.retryable,
        nextRetry: health.nextRetry,
        statusChannelReady: health.statusChannelReady,
        actionableErrorCount: health.actionableErrors?.length ?? 0
      },
      nextAction: health.status === 'blocked'
        ? 'resolve_import_health_blockers'
        : health.status === 'degraded'
          ? 'publish_import_health_advisory'
          : 'include_import_health'
    },
    {
      id: 'history',
      source: 'import_history',
      subject: historyExport.fingerprint ?? 'history',
      status: historyExport.status === 'blocked' ? 'blocked' : historyExport.status === 'degraded' ? 'degraded' : 'ready',
      restartSafe: historyExport.restartSafe === true,
      diagnosticErrors: historyExport.diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: historyExport.diagnostics.filter((item) => item.level === 'warning').length,
      evidence: {
        sequence: historyExport.sequence,
        changed: historyExport.deltas?.changed === true,
        addedImports: historyExport.counters?.addedImports ?? 0,
        removedImports: historyExport.counters?.removedImports ?? 0,
        changedImports: historyExport.counters?.changedImports ?? 0
      },
      nextAction: historyExport.exportSummary?.nextAction ?? 'include_import_history'
    },
    {
      id: 'timeline',
      source: 'import_timeline',
      subject: timelineReport.fingerprint ?? 'timeline',
      status: timelineReport.status === 'blocked' ? 'blocked' : timelineReport.status === 'degraded' ? 'degraded' : 'ready',
      restartSafe: timelineReport.restartSafe === true,
      diagnosticErrors: timelineReport.diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: timelineReport.diagnostics.filter((item) => item.level === 'warning').length,
      evidence: {
        sequence: timelineReport.sequence,
        changed: timelineReport.changed === true,
        blockedImports: timelineReport.counters?.blockedImports ?? 0,
        degradedImports: timelineReport.counters?.degradedImports ?? 0
      },
      nextAction: timelineReport.exportSummary?.nextAction ?? 'include_import_timeline'
    },
    {
      id: 'lifecycle',
      source: 'import_lifecycle',
      subject: lifecycle.status,
      status: lifecycle.status === 'disabled' || lifecycle.status === 'operator_review'
        ? 'blocked'
        : lifecycle.status === 'paused' || lifecycle.status === 'retry_scheduled'
          ? 'degraded'
          : 'ready',
      restartSafe: lifecycle.ok === true && lifecycle.status !== 'disabled',
      diagnosticErrors: lifecycle.diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: lifecycle.diagnostics.filter((item) => item.level === 'warning').length,
      evidence: {
        generation: lifecycle.generation,
        enabled: lifecycle.enabled,
        nextAction: lifecycle.nextAction,
        scheduledRetryCount: lifecycle.schedule?.scheduledRetryCount ?? 0
      },
      nextAction: lifecycle.nextAction ?? 'include_import_lifecycle'
    }
  ];
  return [...aggregateRows, ...importRows].sort((left, right) => (
    importJournalStatusRank(right.status) - importJournalStatusRank(left.status)
    || left.id.localeCompare(right.id)
  ));
}

function importJournalStatusRank(status) {
  if (status === 'blocked') return 3;
  if (status === 'degraded') return 2;
  return 1;
}

function normalizeImportClientEvidenceManifest(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function importClientEvidenceManifestFingerprint({
  status,
  rows,
  readiness,
  preview,
  health,
  resolution
}) {
  return [
    status,
    readiness.fingerprint ?? readiness.exportSummary?.fingerprint ?? '',
    preview.fingerprint ?? preview.exportSummary?.fingerprint ?? '',
    health.status ?? 'unknown',
    health.statusChannelReady ? 'kernel_status' : 'local_status',
    resolution?.fingerprint ?? resolution?.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.publish ? 'publish' : 'hold',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importStatusJournalFingerprint({
  status,
  rows,
  health,
  historyExport,
  timelineReport,
  lifecycle
}) {
  return [
    status,
    health.status,
    historyExport.fingerprint,
    timelineReport.fingerprint,
    lifecycle.fingerprint,
    lifecycle.status,
    ...rows.map((row) => [
      row.id,
      row.source,
      row.subject,
      row.status,
      row.restartSafe ? 'safe' : 'guarded',
      row.diagnosticErrors,
      row.diagnosticWarnings,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function importAnalyticsPublicationLedgerFingerprint({
  status,
  rows,
  statusChannels,
  commandKey
}) {
  return [
    status,
    commandKey ? `command:${commandKey}` : 'no_command_replay',
    ...normalizeList(statusChannels).map((channel) => `channel:${channel}`),
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.sequence ?? 0,
      row.fingerprint ?? 'no_fingerprint',
      row.publish ? 'publish' : 'hold',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
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

function normalizeImportProviderSyncPublication(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    checkpointFingerprint: clean(value.checkpointFingerprint ?? value.exportSummary?.checkpointFingerprint),
    ageMs: toNonNegativeInteger(value.ageMs ?? value.publicationAgeMs, 0)
  };
}

function normalizeImportProviderSyncBridge(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeImportProviderLaunchGate(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeImportProviderSyncStateEnvelope(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    lastStableFingerprint: clean(value.persistedState?.lastStableFingerprint ?? value.lastStableFingerprint),
    appliedCommandKeys: Array.isArray(value.idempotency?.appliedCommandKeys)
      ? value.idempotency.appliedCommandKeys
      : []
  };
}

function normalizeProfileSyncBridgeIntent(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    status: clean(value.status ?? value.profileSyncIntent?.status) || 'unknown',
    profileName: clean(value.profileName ?? value.profileSyncIntent?.profileName) || null,
    operation: clean(value.operation ?? value.profileSyncIntent?.operation) || null,
    cursor: clean(value.cursor ?? value.sync?.cursor ?? value.profileSyncIntent?.cursor) || null,
    fingerprint: clean(value.fingerprint ?? value.profileSyncIntent?.fingerprint) || null,
    restartSafe: value.restartSafe !== false
  };
}

function normalizeImportRuntimeClientContract(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function importRuntimeClientContractFingerprint({
  status,
  controlRows,
  importRows
}) {
  return [
    status,
    ...controlRows.map((row) => [
      'control',
      row.key,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.evidence?.sequence ?? '',
      row.evidence?.changed === true ? 'changed' : '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort(),
    ...importRows.map((row) => [
      'import',
      row.alias,
      row.specifier,
      row.status,
      row.required ? 'required' : 'optional',
      row.adopted ? 'adopted' : 'pending',
      row.pendingSync ? 'pending_sync' : 'sync_clear',
      row.statusChannel,
      row.runtimeTarget,
      ...(row.missingCapabilities ?? []).map((capability) => `missing:${capability}`),
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importProviderSyncPublicationFingerprint({
  status,
  checkpointFingerprint,
  profileCursor,
  rows,
  stale
}) {
  return [
    status,
    checkpointFingerprint,
    profileCursor || 'no_profile_cursor',
    stale ? 'stale' : 'fresh',
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.restartSafe ? 'safe' : 'guarded',
      row.pendingSync ? 'pending_sync' : 'sync_clear',
      row.publish ? 'publish' : 'silent',
      ...(row.missingCapabilities ?? []).map((capability) => `missing:${capability}`),
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importProviderSyncBridgeFingerprint({
  checkpoint,
  publication,
  profileIntent,
  rows,
  stalePublication,
  requireExplicitAcceptance
}) {
  return [
    checkpoint.fingerprint,
    publication.fingerprint,
    profileIntent.fingerprint,
    profileIntent.cursor || 'no_profile_cursor',
    stalePublication ? 'publication_stale' : 'publication_fresh',
    requireExplicitAcceptance ? 'explicit_acceptance' : 'implicit_acceptance',
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending_acceptance',
      row.cursorMatches ? 'cursor_match' : 'cursor_mismatch',
      row.pendingSync ? 'pending_sync' : 'sync_clear',
      row.publication?.status,
      row.publication?.publish ? 'publish' : 'silent',
      row.externalHandoff?.ready ? 'handoff_ready' : 'handoff_guarded',
      ...(row.capabilities?.missing ?? []).map((capability) => `missing:${capability}`)
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importProviderLaunchGateFingerprint({
  bridge,
  publication,
  checkpoint,
  rows,
  status,
  allowDegradedLaunch,
  requirePublication,
  requireKernelHandoff
}) {
  return [
    status,
    bridge.fingerprint ?? bridge.exportSummary?.fingerprint ?? '',
    publication.fingerprint ?? publication.exportSummary?.fingerprint ?? '',
    checkpoint.fingerprint ?? checkpoint.exportSummary?.fingerprint ?? '',
    allowDegradedLaunch ? 'degraded_allowed' : 'degraded_blocks',
    requirePublication ? 'publication_required' : 'publication_optional',
    requireKernelHandoff ? 'kernel_handoff_required' : 'kernel_handoff_optional',
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.required ? 'required' : 'optional',
      row.waived ? 'waived' : 'not_waived',
      row.accepted ? 'accepted' : 'pending_acceptance',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      ...(row.reasons ?? []).map((reason) => `reason:${reason}`),
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importProviderSyncStateEnvelopeFingerprint({
  status,
  checkpoint,
  publication,
  bridge,
  launchGate,
  rows
}) {
  return [
    status,
    checkpoint.fingerprint ?? checkpoint.exportSummary?.fingerprint ?? '',
    publication.fingerprint ?? publication.exportSummary?.fingerprint ?? '',
    bridge.fingerprint ?? bridge.exportSummary?.fingerprint ?? '',
    launchGate.fingerprint ?? launchGate.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.cursor ?? 'no_cursor',
      row.checkpointKey ?? '',
      row.changed ? 'changed' : 'stable',
      row.publication?.status ?? '',
      row.publication?.stale ? 'stale' : 'fresh',
      row.handoff?.ready ? 'handoff_ready' : 'handoff_guarded',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
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

function normalizeImportBoundaryReleasePolicy(input) {
  const policy = input && typeof input === 'object' ? input : {};
  return {
    requireEnabledLifecycle: policy.requireEnabledLifecycle !== false,
    requireExplicitAcceptance: policy.requireExplicitAcceptance === true
  };
}

function normalizeImportWorkspaceBoundaryManifest(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function importWorkspaceBoundaryManifestFingerprint({ scope, rows }) {
  return [
    'import_workspace_boundary_manifest',
    scope.tenantId,
    scope.workspaceId,
    scope.requestedTenantId,
    scope.requestedWorkspaceId,
    scope.role,
    scope.permissionMode,
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.tenantId,
      row.workspaceId,
      row.role,
      row.permissionMode,
      row.accepted ? 'accepted' : 'pending',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      ...(row.capabilities?.missing ?? []),
      ...(row.permissions?.missing ?? []),
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeImportTenantHandoffBoundary(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function importTenantHandoffBoundaryFingerprint({ status, rows }) {
  return [
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.evidence?.alias ?? '',
      row.evidence?.specifier ?? '',
      row.evidence?.statusChannel ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function firstImportBoundaryReleaseAction(rows, fallback) {
  return clean(rows[0]?.nextAction) || fallback;
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

export function buildImportRuntimeHandoffState(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const providerReadiness = buildImportProviderReadinessPlan(resolved, {
    ...options,
    health,
    acceptance: options.providerReadinessAcceptance ?? options.importProviderReadinessAcceptance
  });
  const runtimeClient = buildImportRuntimeClientContract(resolved, {
    ...options,
    health,
    providerReadinessAcceptance: options.providerReadinessAcceptance ?? options.importProviderReadinessAcceptance,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance
  });
  const syncCheckpoint = buildImportProviderSyncCheckpoint(resolved, {
    ...options,
    health,
    readinessPlan: providerReadiness,
    providerReadinessAcceptance: options.providerReadinessAcceptance ?? options.importProviderReadinessAcceptance
  });
  const ledger = buildImportOperationalLedger(resolved, {
    ...options,
    health,
    importProviderReadiness: providerReadiness,
    importProviderSyncCheckpoint: syncCheckpoint
  });
  const rows = [
    importRuntimeHandoffRow('resolution', resolved, true, {
      status: resolved.ok ? 'ready' : 'blocked',
      restartSafe: resolved.ok && health.restartSafe,
      nextAction: resolved.ok ? 'include_resolved_imports' : 'resolve_import_syntax',
      evidence: {
        aliases: resolved.imports.map((item) => item.alias).sort(),
        capabilityRefs: resolved.capabilityRefs,
        statusChannels: resolved.statusChannels
      }
    }),
    importRuntimeHandoffRow('provider_readiness', providerReadiness, true, {
      status: providerReadiness.status,
      restartSafe: providerReadiness.restartSafe,
      nextAction: providerReadiness.readiness?.nextAction ?? providerReadiness.exportSummary?.nextAction,
      evidence: {
        blockedProviders: providerReadiness.exportSummary?.blockedProviders ?? [],
        degradedProviders: providerReadiness.exportSummary?.degradedProviders ?? [],
        missingCapabilities: providerReadiness.exportSummary?.missingCapabilities ?? [],
        unsafeHandoffs: providerReadiness.exportSummary?.unsafeHandoffs ?? []
      }
    }),
    importRuntimeHandoffRow('runtime_client', runtimeClient, true, {
      status: runtimeClient.status,
      restartSafe: runtimeClient.restartSafe,
      nextAction: runtimeClient.readiness?.nextAction ?? runtimeClient.exportSummary?.nextAction,
      evidence: {
        blockedRows: runtimeClient.exportSummary?.blockedRows ?? [],
        degradedRows: runtimeClient.exportSummary?.degradedRows ?? [],
        requestKey: runtimeClient.exportSummary?.requestKey ?? null,
        requiredAliases: runtimeClient.exportSummary?.requiredAliases ?? []
      }
    }),
    importRuntimeHandoffRow('provider_sync', syncCheckpoint, false, {
      status: syncCheckpoint.status,
      restartSafe: syncCheckpoint.restartSafe,
      nextAction: syncCheckpoint.handoff?.nextAction ?? syncCheckpoint.exportSummary?.nextAction,
      evidence: {
        blockedProviders: syncCheckpoint.exportSummary?.blockedProviders ?? [],
        degradedProviders: syncCheckpoint.exportSummary?.degradedProviders ?? [],
        profileSyncIntent: syncCheckpoint.profileSyncIntent ?? null,
        checkpointKey: syncCheckpoint.checkpoint?.key ?? null
      }
    }),
    importRuntimeHandoffRow('operational_ledger', ledger, false, {
      status: ledger.status,
      restartSafe: ledger.restartSafe,
      nextAction: ledger.handoff?.nextAction ?? ledger.exportSummary?.nextAction,
      evidence: {
        blockedRows: ledger.exportSummary?.blockedRows ?? [],
        degradedRows: ledger.exportSummary?.degradedRows ?? [],
        fingerprint: ledger.fingerprint ?? ledger.exportSummary?.fingerprint
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.status === 'degraded');
  const diagnostics = [
    ...(resolved.diagnostics ?? []),
    ...(providerReadiness.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(runtimeClient.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(syncCheckpoint.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(ledger.diagnostics ?? []).filter((item) => item.level === 'error')
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_import_runtime_handoff_blockers'
    : status === 'guarded'
      ? 'publish_import_runtime_handoff_guarded'
      : 'publish_import_runtime_handoff_ready';
  const fingerprint = importRuntimeHandoffFingerprint({
    status,
    rows,
    providerReadiness,
    runtimeClient,
    syncCheckpoint
  });

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_runtime_handoff',
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    fingerprint,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      missingCapabilities: providerReadiness.exportSummary?.missingCapabilities?.length ?? 0,
      unsafeHandoffs: providerReadiness.exportSummary?.unsafeHandoffs?.length ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-runtime-handoff',
      statusChannel: status === 'ready' && resolved.statusChannels.includes('kernel.status.mailchimp')
        ? 'kernel.status.mailchimp'
        : 'local.status.import-runtime-handoff',
      publish: status !== 'ready' || rows.some((row) => row.nextAction),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_runtime_handoff',
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      fingerprint,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportRuntimeClientControlPacket(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const runtimeHandoff = buildImportRuntimeHandoffState(resolved, {
    ...options,
    health,
    providerReadinessAcceptance: options.providerReadinessAcceptance ?? options.importProviderReadinessAcceptance,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance
  });
  const previewRoute = buildImportClientPreviewRouteContract(resolved, {
    ...options,
    health,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true || options.requireImportPreviewAcceptance === true
  });
  const resumeEnvelope = buildImportRuntimeResumeEnvelope(resolved, {
    ...options,
    health,
    previousResumeEnvelope: options.previousResumeEnvelope ?? options.previousImportRuntimeResumeEnvelope,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    previousRuntimeClientContract: options.previousRuntimeClientContract ?? options.previousImportRuntimeClientContract,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const rows = dedupeImportRuntimeClientControlRows([
    ...importRuntimeClientControlRowsFromHandoff(runtimeHandoff),
    importRuntimeClientControlRow('preview_route', previewRoute, {
      source: 'import_preview_route',
      clientVisible: previewRoute.routeState?.previewVisible === true || previewRoute.status !== 'ready',
      accepted: (previewRoute.exportSummary?.awaitingAcceptance ?? []).length === 0,
      nextAction: previewRoute.handoff?.nextAction ?? previewRoute.exportSummary?.nextAction,
      evidence: {
        awaitingAcceptance: previewRoute.exportSummary?.awaitingAcceptance ?? [],
        blockedRows: previewRoute.exportSummary?.blockedRows ?? [],
        guardedRows: previewRoute.exportSummary?.guardedRows ?? [],
        target: previewRoute.routeState?.target ?? null
      }
    }),
    importRuntimeClientControlRow('runtime_resume', resumeEnvelope, {
      source: 'import_runtime_resume',
      clientVisible: resumeEnvelope.status !== 'ready' || resumeEnvelope.handoff?.publish === true,
      accepted: resumeEnvelope.status === 'ready',
      nextAction: resumeEnvelope.handoff?.nextAction ?? resumeEnvelope.exportSummary?.nextAction,
      evidence: {
        blockedRows: resumeEnvelope.exportSummary?.blockedRows ?? [],
        guardedRows: resumeEnvelope.exportSummary?.guardedRows ?? [],
        requestKey: resumeEnvelope.exportSummary?.requestKey ?? null,
        resumeToken: resumeEnvelope.exportSummary?.resumeToken ?? null
      }
    })
  ]);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const visibleRows = rows.filter((row) => row.clientVisible);
  const diagnostics = [
    ...(runtimeHandoff.diagnostics ?? []),
    ...(previewRoute.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(resumeEnvelope.diagnostics ?? []).filter((item) => item.level === 'error')
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = importRuntimeClientControlPacketFingerprint({
    status,
    rows,
    runtimeHandoff,
    previewRoute,
    resumeEnvelope
  });
  const nextAction = status === 'blocked'
    ? 'resolve_import_runtime_client_control_blockers'
    : status === 'guarded'
      ? 'publish_import_runtime_client_controls_guarded'
      : 'publish_import_runtime_client_controls_ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_runtime_client_controls',
    status,
    restartSafe: status === 'ready' && runtimeHandoff.restartSafe === true && resumeEnvelope.restartSafe !== false,
    fingerprint,
    rows,
    validationSummary: {
      totalRows: rows.length,
      visibleRows: visibleRows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: rows.filter((row) => row.required && row.accepted !== true).length,
      unsafeHandoffs: runtimeHandoff.validationSummary?.unsafeHandoffs ?? 0,
      missingCapabilities: runtimeHandoff.validationSummary?.missingCapabilities ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    handoff: {
      target: 'mailchimp.client.workflow.import-runtime-controls',
      statusChannel: runtimeHandoff.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      publish: status !== 'ready' || visibleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: visibleRows.length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_runtime_client_controls',
      status,
      restartSafe: status === 'ready' && runtimeHandoff.restartSafe === true && resumeEnvelope.restartSafe !== false,
      fingerprint,
      visibleRows: visibleRows.map((row) => row.id).sort(),
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

function importRuntimeClientControlRowsFromHandoff(handoff = {}) {
  return (handoff.rows ?? []).map((row) => importRuntimeClientControlRow(`handoff:${row.id}`, row, {
    source: 'import_runtime_handoff',
    clientVisible: row.status !== 'ready' || row.required === true,
    accepted: row.status === 'ready',
    nextAction: row.nextAction,
    evidence: row.evidence
  }));
}

function importRuntimeClientControlRow(id, source = {}, fallback = {}) {
  const rawStatus = clean(source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || source.restartSafe === false
      ? 'guarded'
      : 'ready';
  return {
    id: clean(id),
    source: clean(fallback.source) || 'import_runtime',
    status,
    required: fallback.required !== false,
    accepted: fallback.accepted === true,
    restartSafe: status === 'ready' && source.restartSafe !== false,
    clientVisible: fallback.clientVisible === true || status !== 'ready',
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (status === 'blocked' ? `resolve_${clean(id)}` : status === 'guarded' ? `review_${clean(id)}` : `publish_${clean(id)}`),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function dedupeImportRuntimeClientControlRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object' && clean(row.id))
    .filter((row) => {
      const key = [row.id, row.status, row.nextAction].map(clean).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      importRuntimeClientControlRank(right.status) - importRuntimeClientControlRank(left.status)
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function importRuntimeClientControlRank(status) {
  if (status === 'blocked') return 3;
  if (status === 'guarded') return 2;
  return 1;
}

function importRuntimeClientControlPacketFingerprint({
  status,
  rows,
  runtimeHandoff,
  previewRoute,
  resumeEnvelope
}) {
  return [
    'import_runtime_client_controls',
    status,
    runtimeHandoff.fingerprint ?? runtimeHandoff.exportSummary?.fingerprint ?? '',
    previewRoute.fingerprint ?? previewRoute.exportSummary?.fingerprint ?? '',
    resumeEnvelope.fingerprint ?? resumeEnvelope.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.accepted ? 'accepted' : 'pending',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

export function buildImportProviderLaunchStateEnvelope(input = {}, options = {}) {
  const bridge = options.providerSyncBridge ?? options.importProviderSyncBridge ?? buildImportProviderSyncBridge(input, {
    ...options,
    profileProviderSyncIntent: options.profileProviderSyncIntent ?? options.profileLaunchHandoff?.launchHandoff
  });
  const profileLaunch = normalizeProfileProviderLaunchForImport(options.profileLaunchHandoff ?? options.profileProviderLaunchHandoff ?? input.profileLaunchHandoff);
  const previous = normalizeImportProviderLaunchState(options.previousEnvelope ?? options.previousImportProviderLaunchState ?? input.previousEnvelope);
  const commandKey = clean(options.launchCommandKey ?? options.importProviderLaunchCommandKey ?? options.commandKey ?? input.launchCommandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...normalizeList(options.appliedLaunchCommandKeys)
  ].map(clean).filter(Boolean));
  const repeatedCommand = Boolean(commandKey && seenCommands.has(commandKey));
  const rows = (bridge.rows ?? []).map((row) => {
    const profileBlocked = profileLaunch.status === 'blocked';
    const profileGuarded = profileLaunch.status === 'guarded' || profileLaunch.status === 'degraded';
    const blocked = row.status === 'blocked' || profileBlocked;
    const guarded = blocked !== true && (
      row.status === 'degraded'
      || row.restartSafe === false
      || profileGuarded
      || row.pendingSync === true
      || row.externalHandoff?.ready !== true
    );
    const status = blocked ? 'blocked' : guarded ? 'guarded' : 'ready';
    return {
      alias: row.alias,
      specifier: row.specifier,
      provider: row.provider ?? profileLaunch.provider,
      service: row.service ?? profileLaunch.service,
      required: row.required === true,
      accepted: row.accepted === true,
      status,
      restartSafe: status === 'ready' && row.restartSafe !== false && profileLaunch.restartSafe !== false,
      checkpointKey: [
        row.alias,
        row.specifier,
        row.profileCursor ?? profileLaunch.cursor ?? 'no_cursor',
        row.externalHandoff?.statusChannel ?? profileLaunch.statusChannel
      ].map(clean).filter(Boolean).join(':'),
      profileLaunch: {
        status: profileLaunch.status,
        sequence: profileLaunch.sequence,
        fingerprint: profileLaunch.fingerprint,
        cursor: profileLaunch.cursor,
        statusChannel: profileLaunch.statusChannel
      },
      externalHandoff: {
        target: row.externalHandoff?.target ?? profileLaunch.target,
        statusChannel: row.externalHandoff?.statusChannel ?? profileLaunch.statusChannel,
        ready: row.externalHandoff?.ready === true && profileLaunch.statusChannel === 'kernel.status.mailchimp'
      },
      nextAction: blocked
        ? profileBlocked
          ? 'repair_profile_provider_launch_before_import'
          : row.nextAction ?? 'resolve_import_provider_launch_blocker'
        : guarded
          ? row.externalHandoff?.ready !== true
            ? 'route_import_provider_launch_to_kernel'
            : profileGuarded
              ? 'publish_profile_provider_launch_guarded'
              : row.pendingSync === true
                ? 'wait_for_import_provider_launch_sync'
                : 'publish_import_provider_launch_guarded'
          : repeatedCommand
            ? 'reuse_import_provider_launch_state'
            : 'persist_import_provider_launch_state'
    };
  });
  const missingBridgeRows = rows.length === 0;
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const diagnostics = [
    ...(bridge.diagnostics ?? []),
    ...(profileLaunch.diagnostics ?? []),
    ...(missingBridgeRows ? [{ level: 'error', code: 'import_provider_launch_bridge_missing', subject: 'providerSyncBridge' }] : []),
    ...(profileLaunch.status === 'blocked'
      ? [{ level: 'error', code: 'import_provider_launch_profile_blocked', subject: profileLaunch.fingerprint || 'profileLaunchHandoff' }]
      : []),
    ...blockedRows.map((row) => ({ level: 'error', code: 'import_provider_launch_row_blocked', subject: row.alias })),
    ...guardedRows
      .filter((row) => row.status !== 'blocked')
      .map((row) => ({ level: 'warning', code: 'import_provider_launch_row_guarded', subject: row.alias })),
    ...(repeatedCommand ? [{ level: 'info', code: 'import_provider_launch_command_already_applied', subject: commandKey }] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = importProviderLaunchStateFingerprint({
    status,
    rows,
    profileLaunch,
    bridge,
    commandKey
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const appliedCommandKeys = commandKey && !repeatedCommand && status !== 'blocked'
    ? [...seenCommands, commandKey].sort()
    : [...seenCommands].sort();
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_import_provider_launch_state'
    : status === 'guarded'
      ? 'publish_import_provider_launch_guarded'
      : changed
        ? 'publish_import_provider_launch_state'
        : 'reuse_import_provider_launch_state';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_provider_launch_state',
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    rows,
    idempotency: {
      commandKey: commandKey || null,
      repeated: repeatedCommand,
      applied: Boolean(commandKey) && !repeatedCommand && status !== 'blocked',
      appliedCommandKeys
    },
    persistedState: {
      key: ['mailchimp_import_provider_launch', profileLaunch.cursor || 'no_cursor', fingerprint].map(clean).join(':'),
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint ?? null,
      checkpointKeys: rows.map((row) => row.checkpointKey).sort(),
      replaySafe: status !== 'blocked' && repeatedCommand !== true
    },
    recovery: {
      resumeAllowed: status === 'ready',
      restartAction: status === 'blocked'
        ? 'operator_import_provider_launch_review'
        : status === 'guarded'
          ? 'resume_import_provider_launch_with_guard'
          : 'resume_import_provider_launch',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.import-provider-launch'
    },
    handoff: {
      target: 'kernel.status.mailchimp.import-provider-launch',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.import-provider-launch',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_provider_launch_state',
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.alias).sort(),
      guardedRows: guardedRows.map((row) => row.alias).sort(),
      checkpointKeys: rows.map((row) => row.checkpointKey).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildImportRuntimeRequestAdoptionCheckpoint(input = {}, options = {}) {
  const resolved = input?.schemaVersion === IMPORT_SYNTAX_SCHEMA_VERSION && Array.isArray(input.imports)
    ? input
    : resolveImportSyntax(input, options);
  const health = options.health ?? assessImportOperationalHealth(resolved, options);
  const runtimeClient = buildImportRuntimeClientContract(resolved, {
    ...options,
    health,
    previousLifecycle: options.previousLifecycle ?? options.previousImportLifecycle,
    previousAdoption: options.previousAdoption ?? options.previousImportRuntimeAdoption,
    previousClientContract: options.previousClientContract ?? options.previousImportRuntimeClientContract,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    providerReadinessAcceptance: options.providerReadinessAcceptance ?? options.importProviderReadinessAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const runtimeControls = buildImportRuntimeClientControlPacket(resolved, {
    ...options,
    health,
    previousRuntimeClientContract: options.previousClientContract ?? options.previousImportRuntimeClientContract,
    previousRuntimeClientControls: options.previousRuntimeClientControls ?? options.previousImportRuntimeClientControls,
    command: options.command ?? options.importCommand,
    settings: options.settings ?? options.importSettings,
    acceptance: options.acceptance ?? options.importAcceptance,
    boundaryAcceptance: options.boundaryAcceptance ?? options.importBoundaryAcceptance,
    providerReadinessAcceptance: options.providerReadinessAcceptance ?? options.importProviderReadinessAcceptance,
    requiredAliases: options.requiredAliases ?? options.requiredImportAliases,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs
  });
  const providerSync = options.providerSyncCheckpoint ?? options.importProviderSyncCheckpoint ?? buildImportProviderSyncCheckpoint(resolved, {
    ...options,
    health,
    previousCheckpoint: options.previousProviderSyncCheckpoint ?? options.previousImportProviderSyncCheckpoint,
    requestedCapabilities: options.requestedCapabilities ?? options.importRequestedCapabilities ?? resolved.capabilityRefs,
    syncCommandKey: options.syncCommandKey ?? options.importProviderSyncCommandKey
  });
  const previous = normalizeImportRuntimeRequestAdoptionCheckpoint(
    options.previousCheckpoint ?? options.previousImportRuntimeRequestAdoption ?? input.previousCheckpoint
  );
  const requestState = normalizeImportRuntimeRequestState(options.request ?? input.request ?? {});
  const requestKey = clean(requestState.requestKey ?? options.requestKey ?? runtimeClient.request?.requestKey)
    || 'mailchimp.import.request';
  const acceptedAliases = unique([
    ...normalizeList(requestState.acceptedAliases),
    ...normalizeList(options.acceptedAliases ?? options.importAcceptedAliases),
    ...normalizeList(options.acceptedImports ?? options.importAcceptedImports)
  ]);
  const requiredAliases = unique([
    ...normalizeList(options.requiredAliases ?? options.requiredImportAliases),
    ...normalizeList(requestState.requiredAliases)
  ]);
  const rows = resolved.imports.map((item) => {
    const runtimeRow = (runtimeClient.rows ?? []).find((row) => (
      row.alias === item.alias || row.specifier === item.specifier || row.id === item.alias
    )) ?? {};
    const controlRow = (runtimeControls.rows ?? []).find((row) => (
      row.id.endsWith(`:${item.alias}`) || row.evidence?.requiredAliases?.includes?.(item.alias)
    )) ?? {};
    const syncRow = (providerSync.rows ?? []).find((row) => row.alias === item.alias || row.specifier === item.specifier) ?? {};
    const required = requiredAliases.length === 0 || requiredAliases.includes(item.alias) || requiredAliases.includes(item.specifier);
    const accepted = acceptedAliases.includes(item.alias) || acceptedAliases.includes(item.specifier);
    const missingCapabilities = unique([
      ...(runtimeRow.capabilities?.missing ?? []),
      ...(syncRow.capabilities?.missing ?? [])
    ]);
    const blocked = required && (missingCapabilities.length > 0 || item.handoffSafe !== true || runtimeRow.status === 'blocked' || syncRow.status === 'blocked');
    const guarded = blocked !== true && (
      runtimeClient.status === 'guarded'
      || runtimeControls.status === 'guarded'
      || providerSync.status === 'degraded'
      || syncRow.status === 'degraded'
      || (required && accepted !== true)
    );
    const status = blocked ? 'blocked' : guarded ? 'guarded' : 'ready';
    return {
      alias: item.alias,
      specifier: item.specifier,
      kind: item.kind,
      required,
      accepted,
      status,
      restartSafe: status === 'ready' && item.handoffSafe === true && syncRow.externalHandoff?.ready !== false,
      requestBinding: {
        requestKey,
        claimKey: `${requestKey}.${item.alias}`,
        clientVisible: required || status !== 'ready' || controlRow.clientVisible === true
      },
      capabilities: {
        offered: item.capabilities,
        missing: missingCapabilities
      },
      providerSync: {
        status: syncRow.status ?? providerSync.status ?? 'unknown',
        checkpointKey: syncRow.checkpointKey ?? null,
        pending: syncRow.sync?.pending === true,
        profileCursor: syncRow.sync?.profileCursor ?? providerSync.profileSyncIntent?.cursor ?? null
      },
      nextAction: blocked
        ? 'repair_import_request_adoption_blocker'
        : accepted !== true && required
          ? 'accept_import_request_binding'
          : syncRow.sync?.pending === true
            ? 'wait_for_import_request_provider_sync'
            : 'publish_import_request_adoption_ready'
    };
  });
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const awaitingAcceptance = rows.filter((row) => row.required && row.accepted !== true);
  const diagnostics = [
    ...(resolved.diagnostics ?? []),
    ...(runtimeClient.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(runtimeControls.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(providerSync.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'import_runtime_request_adoption_blocked',
      subject: row.alias
    })),
    ...awaitingAcceptance.map((row) => ({
      level: options.requireImportRequestAcceptance === true ? 'error' : 'warning',
      code: options.requireImportRequestAcceptance === true
        ? 'import_runtime_request_acceptance_missing'
        : 'import_runtime_request_acceptance_pending',
      subject: row.alias
    }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = importRuntimeRequestAdoptionCheckpointFingerprint({
    status,
    requestKey,
    rows,
    providerSync
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_import_request_adoption_blockers'
    : status === 'guarded'
      ? 'publish_import_request_adoption_guarded'
      : changed
        ? 'publish_import_request_adoption_checkpoint'
        : 'reuse_import_request_adoption_checkpoint';

  return {
    ok: status !== 'blocked',
    schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
    title: 'mailchimp_import_runtime_request_adoption',
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    request: {
      requestKey,
      acceptedAliases,
      requiredAliases,
      visibleAliases: rows.filter((row) => row.requestBinding.clientVisible).map((row) => row.alias).sort()
    },
    rows,
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.alias)),
      guardedReasons: unique(guardedRows.map((row) => row.alias)),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.alias).sort(),
      nextAction
    },
    handoff: {
      target: 'mailchimp.client.workflow.import-request-adoption',
      statusChannel: status === 'ready' && resolved.statusChannels.includes('kernel.status.mailchimp')
        ? 'kernel.status.mailchimp'
        : 'local.status.import-request-adoption',
      publish: changed || status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeRequest: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: IMPORT_SYNTAX_SCHEMA_VERSION,
      title: 'mailchimp_import_runtime_request_adoption',
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      requestKey,
      blockedRows: blockedRows.map((row) => row.alias).sort(),
      guardedRows: guardedRows.map((row) => row.alias).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.alias).sort(),
      nextAction
    },
    diagnostics
  };
}

function dedupeImportClientActions(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const normalized = {
      ...row,
      id: clean(row.id),
      source: clean(row.source),
      subject: clean(row.subject),
      status: clean(row.status) || 'ready',
      severity: clean(row.severity) || 'info',
      nextAction: clean(row.nextAction) || null,
      clientVisible: row.clientVisible === true,
      required: row.required === true,
      evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
    };
    const key = [normalized.id, normalized.source, normalized.subject, normalized.nextAction].map(clean).join('|');
    if (!normalized.id || seen.has(key)) return false;
    seen.add(key);
    Object.assign(row, normalized);
    return true;
  });
}

function importClientActionQueueFingerprint({
  status,
  rows,
  readiness,
  preview
}) {
  return [
    status,
    readiness.fingerprint ?? readiness.exportSummary?.fingerprint ?? '',
    preview.fingerprint ?? preview.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.severity,
      row.clientVisible ? 'visible' : 'hidden',
      row.required ? 'required' : 'optional',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importClientActionRank(severity) {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

function importClientActionStatusRank(status) {
  if (status === 'blocked') return 4;
  if (status === 'guarded' || status === 'degraded') return 3;
  if (status === 'awaiting_acceptance') return 2;
  return 1;
}

function normalizeImportClientResolutionBrief(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function normalizeImportOperationalLedger(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
      : []
  };
}

function normalizeImportClientLaunchReadinessLedger(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function normalizeImportTenantAuditReadiness(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function importTenantAuditReadinessFingerprint({
  status,
  scope,
  health,
  provider,
  boundaryAcceptance,
  rows
}) {
  return [
    status,
    scope.tenantId,
    scope.workspaceId,
    scope.role,
    scope.permissionMode,
    health.status ?? 'unknown',
    provider.status ?? 'unknown',
    boundaryAcceptance.status ?? 'unknown',
    ...rows.map((row) => [
      row.alias,
      row.specifier ?? '',
      row.status,
      row.audit?.handoffSafe ? 'audit_safe' : 'audit_guarded',
      row.boundaries?.tenantMismatch ? 'tenant_mismatch' : '',
      row.boundaries?.workspaceMismatch ? 'workspace_mismatch' : '',
      ...normalizeList(row.capabilities?.missing),
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importClientLaunchReadinessRow(id, source, required, fallback = {}) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' || rawStatus === 'paused' || rawStatus === 'disabled'
    ? 'guarded'
    : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && status !== 'ready';
  return {
    id,
    source: clean(fallback.source) || 'imports',
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    restartSafe: fallback.restartSafe === true && blocked !== true,
    clientVisible: fallback.clientVisible === true || blocked || guarded,
    required,
    fingerprint: clean(fallback.fingerprint ?? source.fingerprint ?? source.exportSummary?.fingerprint),
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_${id}_blockers` : guarded ? `publish_${id}_guarded` : `publish_${id}`
    ),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function importOperationalLedgerRow(id, source, required, fallback) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'healthy' ? 'ready' : rawStatus;
  const blocked = status === 'blocked';
  const degraded = !blocked && (status === 'degraded' || status === 'guarded');
  return {
    id,
    status: blocked ? 'blocked' : degraded ? 'degraded' : 'ready',
    required,
    restartSafe: fallback.restartSafe === true && blocked !== true,
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_import_${id}` : degraded ? `publish_import_${id}_advisory` : `publish_import_${id}`
    ),
    diagnostics: toNonNegativeInteger(fallback.diagnosticCount, 0),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function importOperationalLedgerFingerprint({
  status,
  rows,
  health,
  providerContract,
  readiness,
  manifest
}) {
  return [
    status,
    health.status ?? 'unknown',
    health.nextRetry?.attempt ?? 'no_retry',
    providerContract.status ?? 'unknown',
    readiness.fingerprint ?? readiness.exportSummary?.fingerprint ?? '',
    manifest.status ?? 'unknown',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.nextAction,
      row.evidence?.fingerprint ?? ''
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function importRuntimeHandoffRow(id, source, required, fallback) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'healthy' || rawStatus === 'accepted' ? 'ready' : rawStatus === 'degraded' ? 'guarded' : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && (status === 'guarded' || status === 'paused' || status === 'disabled');
  return {
    id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required,
    restartSafe: fallback.restartSafe !== false && blocked !== true,
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_import_${id}` : guarded ? `publish_import_${id}_guarded` : `publish_import_${id}`
    ),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function importRuntimeHandoffFingerprint({
  status,
  rows,
  providerReadiness,
  runtimeClient,
  syncCheckpoint
}) {
  return [
    status,
    providerReadiness.fingerprint ?? providerReadiness.exportSummary?.fingerprint ?? '',
    runtimeClient.fingerprint ?? runtimeClient.exportSummary?.fingerprint ?? '',
    syncCheckpoint.fingerprint ?? syncCheckpoint.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.evidence?.fingerprint ?? row.evidence?.checkpointKey ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function dedupeImportClientResolutionRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const normalized = {
      ...row,
      id: clean(row.id),
      source: clean(row.source),
      subject: clean(row.subject),
      status: clean(row.status) || 'ready',
      severity: clean(row.severity) || 'info',
      nextAction: clean(row.nextAction) || null,
      clientVisible: row.clientVisible === true,
      evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
    };
    const key = [normalized.id, normalized.source, normalized.subject, normalized.nextAction].map(clean).join('|');
    if (!normalized.id || !normalized.source || seen.has(key)) return false;
    seen.add(key);
    Object.assign(row, normalized);
    return true;
  });
}

function importClientResolutionFingerprint({
  status,
  readiness,
  preview,
  health,
  rows
}) {
  return [
    status,
    readiness.fingerprint ?? readiness.exportSummary?.fingerprint ?? '',
    preview.fingerprint ?? preview.exportSummary?.fingerprint ?? '',
    health.status ?? 'unknown',
    health.nextRetry?.attempt ?? 'no_retry',
    health.statusChannelReady ? 'kernel_status' : 'local_status',
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.severity,
      row.clientVisible ? 'visible' : 'hidden',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeImportAnalyticsRecoveryDigest(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    lastStableFingerprint: clean(value.recovery?.lastStableFingerprint ?? value.lastStableFingerprint) || null,
    appliedCommandKeys: unique(normalizeList(value.idempotency?.appliedCommandKeys ?? value.appliedCommandKeys))
  };
}

function importAnalyticsRecoveryRow(id, source, required, fallback = {}) {
  const rawStatus = clean(source.status ?? source.exportSummary?.status) || 'ready';
  const blocked = rawStatus === 'blocked';
  const guarded = !blocked && (
    rawStatus === 'degraded'
    || rawStatus === 'guarded'
    || source.restartSafe === false
    || fallback.restartSafe === false
  );
  return {
    id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required: required === true,
    restartSafe: blocked !== true && guarded !== true && source.restartSafe !== false,
    fingerprint: clean(fallback.fingerprint ?? source.fingerprint ?? source.exportSummary?.fingerprint),
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_import_${id}` : guarded ? `publish_import_${id}_guarded` : `publish_import_${id}`
    ),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function importAnalyticsRecoveryDigestFingerprint({
  status,
  rows,
  commandKey,
  importCount
}) {
  return [
    'import_analytics_recovery',
    status,
    String(importCount),
    commandKey || 'no_command',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeImportOperationalEscalation(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    lastStableFingerprint: clean(value.escalation?.lastStableFingerprint ?? value.lastStableFingerprint) || null
  };
}

function normalizeImportProviderOperationalBrief(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function importProviderOperationalBriefFingerprint({
  status,
  rows,
  health,
  provider
}) {
  return [
    'import_provider_operational_brief',
    status,
    health.status ?? 'unknown_health',
    provider.capabilityNegotiation?.status ?? 'unknown_capability_negotiation',
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.syncMode,
      row.nextSyncAfterMs ?? '',
      row.capabilityNegotiation,
      row.statusChannel,
      row.externalHandoffReady ? 'handoff_ready' : 'handoff_guarded',
      row.nextAction,
      ...row.missingCapabilities
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeImportEscalationOwners(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    defaultOwner: clean(value.defaultOwner) || 'mailchimp.operations',
    imports: clean(value.imports) || clean(value.importOwner) || 'mailchimp.imports',
    provider: clean(value.provider) || clean(value.providerOwner) || 'mailchimp.provider',
    handoff: clean(value.handoff) || clean(value.handoffOwner) || 'mailchimp.status-handoff'
  };
}

function normalizeImportEscalationThresholds(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    errorMs: toPositiveInteger(value.errorMs, 300000),
    warningMs: toPositiveInteger(value.warningMs, 900000),
    infoMs: toPositiveInteger(value.infoMs, 3600000)
  };
}

function importEscalationRowsFromHealth(health = {}, owners = {}) {
  const rows = [];
  if (health.status === 'blocked' || health.status === 'degraded') {
    rows.push({
      id: `health:${health.status}`,
      source: 'import_health',
      subject: health.status,
      severity: health.status === 'blocked' ? 'error' : 'warning',
      owner: owners.imports,
      reason: health.status === 'blocked' ? 'import_health_blocked' : 'import_health_degraded',
      action: health.status === 'blocked' ? 'resolve_import_health_blockers' : 'review_import_health_degradation',
      evidence: {
        nextRetry: health.nextRetry ?? null,
        degradedMode: health.degradedMode ?? null,
        statusChannelReady: health.statusChannelReady === true
      }
    });
  }
  if (health.statusChannelReady === false) {
    rows.push({
      id: 'handoff:status_channel',
      source: 'import_health',
      subject: 'kernel.status.mailchimp',
      severity: health.status === 'blocked' ? 'error' : 'warning',
      owner: owners.handoff,
      reason: 'import_status_channel_not_ready',
      action: 'route_import_status_to_kernel',
      evidence: { degradedMode: health.degradedMode ?? null }
    });
  }
  return rows;
}

function importEscalationRowsFromRecovery(recovery = {}, owners = {}) {
  return (recovery.rows ?? [])
    .filter((row) => row && typeof row === 'object')
    .filter((row) => row.status === 'blocked' || row.status === 'guarded' || row.restartSafe === false)
    .map((row) => ({
      id: `recovery:${clean(row.id)}`,
      source: 'import_recovery',
      subject: clean(row.id),
      severity: row.status === 'blocked' ? 'error' : 'warning',
      owner: clean(row.id).includes('journal') ? owners.handoff : owners.imports,
      reason: row.status === 'blocked' ? 'import_recovery_blocked' : 'import_recovery_guarded',
      action: clean(row.nextAction) || (row.status === 'blocked' ? 'resolve_import_recovery_row' : 'publish_import_recovery_guarded'),
      evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
    }));
}

function importEscalationRowsFromProviderReadiness(readiness = {}, owners = {}) {
  return (readiness.rows ?? [])
    .filter((row) => row && typeof row === 'object')
    .filter((row) => row.status === 'blocked' || row.status === 'degraded' || row.externalHandoff?.ready === false)
    .map((row) => ({
      id: `provider:${clean(row.alias) || clean(row.specifier)}`,
      source: 'import_provider_readiness',
      subject: clean(row.alias) || clean(row.specifier),
      severity: row.status === 'blocked' ? 'error' : 'warning',
      owner: row.externalHandoff?.ready === false ? owners.handoff : owners.provider,
      reason: row.status === 'blocked'
        ? 'import_provider_readiness_blocked'
        : row.externalHandoff?.ready === false
          ? 'import_provider_handoff_guarded'
          : 'import_provider_readiness_degraded',
      action: clean(row.nextAction) || (row.status === 'blocked' ? 'repair_import_provider_readiness' : 'publish_import_provider_degraded'),
      evidence: {
        missingCapabilities: row.capabilities?.missing ?? [],
        pendingSync: row.sync?.pending === true,
        statusChannel: row.externalHandoff?.statusChannel ?? null
      }
    }));
}

function importEscalationRowsFromDiagnostics(diagnostics = [], owners = {}) {
  return diagnostics
    .filter((item) => item && typeof item === 'object')
    .filter((item) => item.level === 'error' || item.level === 'warning')
    .map((item) => ({
      id: `diagnostic:${clean(item.code)}:${clean(item.subject)}`,
      source: 'import_diagnostic',
      subject: clean(item.subject) || clean(item.code),
      severity: item.level === 'error' ? 'error' : 'warning',
      owner: clean(item.code).includes('handoff') ? owners.handoff : owners.imports,
      reason: clean(item.code) || 'import_diagnostic',
      action: item.level === 'error' ? 'repair_import_diagnostic_error' : 'review_import_diagnostic_warning',
      evidence: { code: clean(item.code), level: clean(item.level) }
    }));
}

function dedupeImportEscalationRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object')
    .filter((row) => {
      const key = [row.id, row.severity, row.action].map(clean).join('|');
      if (!clean(row.id) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      importEscalationSeverityRank(right.severity) - importEscalationSeverityRank(left.severity)
      || clean(left.owner).localeCompare(clean(right.owner))
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function importEscalationSeverityRank(severity) {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

function importOperationalEscalationFingerprint({
  status,
  rows,
  recovery,
  provider,
  readiness,
  importCount
}) {
  return [
    'import_operational_escalation',
    status,
    String(importCount),
    recovery.fingerprint ?? recovery.exportSummary?.fingerprint ?? '',
    provider.status ?? 'unknown_provider',
    readiness.fingerprint ?? readiness.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.severity,
      row.owner,
      row.deadlineMs,
      row.publish ? 'publish' : 'silent',
      row.action
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeImportClientPreviewRoute(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeImportRuntimeRequestAdoptionCheckpoint(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeImportRuntimeRequestState(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    requestKey: clean(value.requestKey ?? value.key),
    acceptedAliases: normalizeList(value.acceptedAliases ?? value.acceptedImports),
    requiredAliases: normalizeList(value.requiredAliases ?? value.requiredImports)
  };
}

function normalizeProfileProviderLaunchForImport(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const summary = value.exportSummary && typeof value.exportSummary === 'object' ? value.exportSummary : {};
  const handoff = value.launchHandoff && typeof value.launchHandoff === 'object' ? value.launchHandoff : {};
  return {
    status: clean(value.status ?? summary.status) || 'ready',
    restartSafe: value.restartSafe !== false && summary.restartSafe !== false,
    sequence: toNonNegativeInteger(value.sequence ?? summary.sequence, 0),
    fingerprint: clean(value.fingerprint ?? summary.fingerprint),
    provider: clean(handoff.provider ?? value.provider) || 'mailchimp',
    service: clean(handoff.service ?? value.service) || 'marketing-api',
    cursor: clean(handoff.cursor ?? value.cursor),
    target: clean(handoff.target ?? value.handoff?.target) || 'kernel.status.mailchimp.profile-provider-launch',
    statusChannel: clean(handoff.statusChannel ?? value.handoff?.statusChannel) || 'kernel.status.mailchimp',
    diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics : []
  };
}

function normalizeImportProviderLaunchState(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    lastStableFingerprint: clean(value.persistedState?.lastStableFingerprint ?? value.lastStableFingerprint) || null,
    appliedCommandKeys: unique(normalizeList(value.idempotency?.appliedCommandKeys ?? value.appliedCommandKeys))
  };
}

function importProviderLaunchStateFingerprint({
  status,
  rows,
  profileLaunch,
  bridge,
  commandKey
}) {
  return [
    'import_provider_launch_state',
    status,
    profileLaunch.fingerprint,
    profileLaunch.cursor,
    bridge.fingerprint ?? bridge.exportSummary?.fingerprint ?? '',
    commandKey,
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.checkpointKey,
      row.profileLaunch?.status,
      row.externalHandoff?.statusChannel,
      row.externalHandoff?.ready ? 'handoff_ready' : 'handoff_guarded',
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function importRuntimeRequestAdoptionCheckpointFingerprint({
  status,
  requestKey,
  rows,
  providerSync
}) {
  return [
    'import_runtime_request_adoption',
    status,
    requestKey,
    providerSync.fingerprint ?? providerSync.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.alias,
      row.specifier,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.providerSync?.checkpointKey,
      row.providerSync?.profileCursor,
      row.nextAction,
      ...(row.capabilities?.missing ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function importClientPreviewRouteRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' || rawStatus === 'recovering' ? 'guarded' : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && (status === 'guarded' || source.restartSafe === false || source.exportSummary?.restartSafe === false);
  const awaitingAcceptance = normalizeList(fallback.awaitingAcceptance ?? source.exportSummary?.awaitingAcceptance);
  return {
    id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required: required === true,
    restartSafe: blocked !== true && guarded !== true,
    visibleToClient: fallback.visible === true || blocked || guarded || awaitingAcceptance.length > 0,
    fingerprint: clean(source.fingerprint ?? source.exportSummary?.fingerprint),
    awaitingAcceptance,
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (blocked ? `resolve_import_${id}` : guarded ? `publish_import_${id}_guarded` : `publish_import_${id}`)
  };
}

function importClientPreviewRouteFingerprint({
  status,
  rows,
  awaitingAcceptance
}) {
  return [
    'import_client_preview_route',
    status,
    `awaiting:${awaitingAcceptance.join(',')}`,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.visibleToClient ? 'visible' : 'hidden',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
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
