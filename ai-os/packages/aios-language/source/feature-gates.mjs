export const FEATURE_GATES_SCHEMA_VERSION = 'aios.feature-gates.v1';

export const MAILCHIMP_OPERATION_GATES = Object.freeze({
  'campaign.sync': Object.freeze({
    required: Object.freeze(['mailchimpRead', 'campaignPlanning']),
    effects: Object.freeze(['mailchimp.read', 'mailchimp.plan'])
  }),
  'audience.segment': Object.freeze({
    required: Object.freeze(['mailchimpRead', 'audienceSegmentation']),
    effects: Object.freeze(['mailchimp.read', 'mailchimp.segment'])
  }),
  'webhook.audit': Object.freeze({
    required: Object.freeze(['mailchimpRead', 'webhookAudit']),
    effects: Object.freeze(['mailchimp.read', 'mailchimp.audit'])
  })
});

export const DEFAULT_FEATURE_GATES = Object.freeze({
  mailchimpRead: true,
  campaignPlanning: true,
  audienceSegmentation: true,
  webhookAudit: true,
  externalWrite: false,
  rollbackRequired: true,
  strictClaims: true,
  adapterStatusHandoff: true
});

const FEATURE_GATE_COMMANDS = Object.freeze({
  enable: true,
  disable: false
});

export function parseFeatureGateSource(source = '', options = {}) {
  const diagnostics = [];
  const gates = {};
  String(source ?? '').split(/\r?\n/).forEach((rawLine, offset) => {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) return;
    const match = line.match(/^gate\s+([a-z][a-z0-9.-]*)\s*=\s*(on|off|true|false)$/i);
    if (!match) {
      diagnostics.push({ level: 'error', code: 'invalid_feature_gate_declaration', subject: `line:${offset + 1}` });
      return;
    }
    gates[match[1]] = ['on', 'true'].includes(match[2].toLowerCase());
  });
  return {
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    sourceName: clean(options.sourceName) || 'inline.gates.aios',
    gates,
    diagnostics
  };
}

export function normalizeFeatureGates(input = {}, options = {}) {
  const parsed = typeof input === 'string' ? parseFeatureGateSource(input, options) : objectGateInput(input);
  const gates = { ...DEFAULT_FEATURE_GATES, ...knownGateEntries(parsed.gates ?? parsed) };
  const diagnostics = [
    ...(parsed.diagnostics ?? []),
    ...(gates.externalWrite && !gates.rollbackRequired
      ? [{ level: 'error', code: 'external_write_requires_rollback', subject: 'rollbackRequired' }]
      : []),
    ...Object.keys(parsed.gates ?? parsed)
      .filter((key) => !(key in DEFAULT_FEATURE_GATES))
      .map((key) => ({ level: 'warning', code: 'unknown_feature_gate_ignored', subject: key }))
  ];

  return {
    ok: !diagnostics.some((item) => item.level === 'error'),
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    gates,
    enabled: Object.keys(gates).filter((key) => gates[key] === true).sort(),
    disabled: Object.keys(gates).filter((key) => gates[key] === false).sort(),
    diagnostics
  };
}

export function evaluateFeatureGateContract({ operation, requestedEffects = [], gates = {} } = {}) {
  const normalized = normalizeFeatureGates(gates);
  const operationGate = MAILCHIMP_OPERATION_GATES[operation] ?? { required: [], effects: [] };
  const missingRequired = operationGate.required.filter((gate) => normalized.gates[gate] !== true);
  const requested = Array.isArray(requestedEffects) ? requestedEffects : String(requestedEffects ?? '').split(',');
  const externalWriteRequested = requested.map(clean).includes('mailchimp.write');
  const deniedEffects = [
    ...missingRequired.map((gate) => `gate:${gate}`),
    ...(externalWriteRequested && normalized.gates.externalWrite !== true ? ['mailchimp.write'] : [])
  ].sort();
  const diagnostics = [
    ...normalized.diagnostics,
    ...missingRequired.map((gate) => ({ level: 'error', code: 'required_feature_gate_disabled', subject: gate })),
    ...(externalWriteRequested && normalized.gates.externalWrite !== true
      ? [{ level: 'error', code: 'external_write_gate_disabled', subject: operation }]
      : []),
    ...(normalized.gates.strictClaims ? [] : [{ level: 'warning', code: 'strict_claims_gate_disabled', subject: operation }]),
    ...(normalized.gates.adapterStatusHandoff ? [] : [{ level: 'warning', code: 'adapter_status_handoff_disabled', subject: operation }])
  ];

  return {
    ok: !diagnostics.some((item) => item.level === 'error'),
    operation,
    requiredGates: operationGate.required,
    allowedEffects: operationGate.effects.filter((effect) => !deniedEffects.includes(effect)),
    deniedEffects,
    policy: {
      externalWrite: externalWriteRequested && normalized.gates.externalWrite === true,
      rollbackRequired: normalized.gates.rollbackRequired,
      verifierMode: normalized.gates.strictClaims ? 'strict' : 'advisory',
      statusHandoff: normalized.gates.adapterStatusHandoff ? 'kernel_status_channel' : 'local_only'
    },
    diagnostics
  };
}

export function deriveFeatureGateRecovery(input = {}) {
  const contract = evaluateFeatureGateContract(input);
  const hasErrors = contract.diagnostics.some((item) => item.level === 'error');
  const hasWarnings = contract.diagnostics.some((item) => item.level === 'warning');
  return {
    status: hasErrors ? 'blocked' : hasWarnings ? 'degraded' : 'ready',
    resumeAction: hasErrors ? 'operator_review' : hasWarnings ? 'resume_with_gate_checks' : 'resume',
    restartSafe: !hasErrors,
    diagnostics: contract.diagnostics
  };
}

export function buildFeatureGateStateSnapshot(input = {}, options = {}) {
  const normalized = normalizeFeatureGates(input, options);
  const operation = clean(options.operation) || clean(input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const scope = normalizeGateScope(options.scope ?? input.scope ?? options);
  const contract = evaluateFeatureGateContract({
    operation,
    requestedEffects,
    gates: normalized.gates
  });
  const tenantPolicy = deriveFeatureGateTenantPolicy({
    operation,
    requestedEffects,
    gates: normalized.gates,
    scope
  });
  const recovery = deriveFeatureGateRecovery({
    operation,
    requestedEffects,
    gates: normalized.gates
  });
  const generation = toNonNegativeInteger(options.generation ?? input.generation, 0);
  const previous = normalizePreviousState(options.previousState ?? input.previousState);
  const fingerprint = gateFingerprint(normalized.gates);
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const status = contract.ok ? recovery.status : 'blocked';
  const diagnostics = [
    ...contract.diagnostics,
    ...tenantPolicy.diagnostics,
    ...(previous.schemaVersion && previous.schemaVersion !== FEATURE_GATES_SCHEMA_VERSION
      ? [{ level: 'warning', code: 'feature_gate_state_schema_mismatch', subject: previous.schemaVersion }]
      : [])
  ];

  return {
    ok: !diagnostics.some((item) => item.level === 'error'),
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    operation,
    scope: tenantPolicy.scope,
    generation: changed ? generation + 1 : generation,
    fingerprint,
    status: tenantPolicy.status === 'blocked' ? 'blocked' : status,
    restartSafe: recovery.restartSafe && normalized.gates.adapterStatusHandoff === true && tenantPolicy.restartSafe,
    gates: normalized.gates,
    enabled: normalized.enabled,
    disabled: normalized.disabled,
    deniedEffects: contract.deniedEffects,
    policy: contract.policy,
    tenantPolicy: tenantPolicy.policy,
    auditHandoff: tenantPolicy.auditHandoff,
    recovery: {
      resumeAction: recovery.resumeAction,
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint ?? null,
      pendingOperatorAction: tenantPolicy.status === 'blocked'
        ? 'review_tenant_feature_gate_boundary'
        : status === 'blocked'
        ? 'review_feature_gate_policy'
        : status === 'degraded'
          ? 'confirm_advisory_gate_resume'
          : null
    },
    idempotency: {
      commandKey: clean(options.commandKey) || null,
      applied: changed,
      previousFingerprint: previous.fingerprint ?? null
    },
    diagnostics
  };
}

export function buildFeatureGateAnalyticsReport(input = {}, options = {}) {
  const snapshot = buildFeatureGateStateSnapshot(input, options);
  const previous = normalizeFeatureGateAnalytics(options.previousAnalytics ?? input.previousAnalytics);
  const operationGate = MAILCHIMP_OPERATION_GATES[snapshot.operation] ?? { required: [], effects: [] };
  const gateRows = Object.keys(snapshot.gates).sort().map((gate) => {
    const value = snapshot.gates[gate] === true;
    const previousValue = previous.gates?.[gate];
    return {
      gate,
      enabled: value,
      changed: typeof previousValue === 'boolean' ? previousValue !== value : true,
      requiredForOperation: operationGate.required.includes(gate),
      blocksEffect: gate === 'externalWrite' && value !== true ? 'mailchimp.write' : null
    };
  });
  const counters = {
    total: gateRows.length,
    enabled: gateRows.filter((row) => row.enabled).length,
    disabled: gateRows.filter((row) => !row.enabled).length,
    changed: gateRows.filter((row) => row.changed).length,
    requiredDisabled: operationGate.required.filter((gate) => snapshot.gates[gate] !== true).length,
    deniedEffects: snapshot.deniedEffects.length,
    diagnostics: {
      errors: snapshot.diagnostics.filter((item) => item.level === 'error').length,
      warnings: snapshot.diagnostics.filter((item) => item.level === 'warning').length,
      info: snapshot.diagnostics.filter((item) => item.level === 'info').length
    }
  };
  const event = {
    sequence: toNonNegativeInteger(previous.sequence, 0) + 1,
    timestamp: clean(options.now ?? options.timestamp) || null,
    operation: snapshot.operation,
    status: snapshot.status,
    generation: snapshot.generation,
    fingerprint: snapshot.fingerprint,
    enabled: counters.enabled,
    disabled: counters.disabled,
    deniedEffects: counters.deniedEffects,
    restartSafe: snapshot.restartSafe
  };
  const timeline = [...previous.timeline, event].slice(-toPositiveInteger(options.historyLimit, 12));
  const statusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const changedGates = gateRows
    .filter((row) => row.changed)
    .map((row) => ({
      gate: row.gate,
      from: Object.prototype.hasOwnProperty.call(previous.gates, row.gate) ? previous.gates[row.gate] : null,
      to: row.enabled
    }));
  const riskLevel = snapshot.status === 'blocked'
    ? 'high'
    : snapshot.status === 'degraded' || counters.requiredDisabled > 0 || counters.deniedEffects > 0
      ? 'medium'
      : 'low';

  return {
    ok: snapshot.ok,
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    operation: snapshot.operation,
    counters,
    history: {
      sequence: event.sequence,
      timeline,
      statusCounts
    },
    changedGates,
    report: {
      title: 'mailchimp_feature_gate_report',
      status: snapshot.status,
      riskLevel,
      rows: gateRows,
      deniedEffects: snapshot.deniedEffects,
      pendingOperatorAction: snapshot.recovery.pendingOperatorAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      operation: snapshot.operation,
      status: snapshot.status,
      riskLevel,
      generation: snapshot.generation,
      fingerprint: snapshot.fingerprint,
      enabled: snapshot.enabled,
      disabled: snapshot.disabled,
      changedGateCount: counters.changed,
      requiredDisabled: counters.requiredDisabled,
      deniedEffects: snapshot.deniedEffects,
      restartSafe: snapshot.restartSafe,
      auditSubject: snapshot.auditHandoff.subject,
      nextAction: snapshot.recovery.pendingOperatorAction ?? snapshot.recovery.resumeAction
    },
    diagnostics: snapshot.diagnostics
  };
}

export function buildFeatureGateProviderPreviewAcceptance(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation: options.operation ?? input.operation,
    requestedEffects: options.requestedEffects ?? input.requestedEffects,
    previousState: options.previousGateState ?? input.previousGateState
  });
  const provider = normalizeProviderPreview(options.providerService ?? input.providerService ?? options.providerContract ?? input.providerContract);
  const acceptance = normalizeProviderPreviewAcceptance(options.acceptance ?? input.acceptance);
  const requireExplicitAcceptance = options.requireExplicitProviderAcceptance === true
    || acceptance.requireExplicitAcceptance === true;
  const requiredCapabilities = unique([
    ...normalizeList(provider.capabilities?.required),
    ...normalizeList(options.requiredProviderCapabilities ?? input.requiredProviderCapabilities)
  ]);
  const offeredCapabilities = unique(provider.capabilities?.offered ?? []);
  const missingCapabilities = requiredCapabilities.filter((capability) => !offeredCapabilities.includes(capability));
  const rows = [
    {
      key: 'feature_gates',
      label: 'Mailchimp feature gates',
      status: snapshot.status,
      accepted: acceptance.acceptedItems.includes('feature_gates'),
      required: true,
      nextStep: snapshot.status === 'blocked'
        ? 'resolve_feature_gate_blockers'
        : requireExplicitAcceptance && !acceptance.acceptedItems.includes('feature_gates')
          ? 'accept_feature_gate_preview'
          : 'include_feature_gate_state'
    },
    {
      key: 'provider_capabilities',
      label: 'Mailchimp provider capabilities',
      status: missingCapabilities.length > 0 ? 'blocked' : provider.status,
      accepted: acceptance.acceptedItems.includes('provider_capabilities'),
      required: true,
      nextStep: missingCapabilities.length > 0
        ? 'repair_provider_capability_contract'
        : requireExplicitAcceptance && !acceptance.acceptedItems.includes('provider_capabilities')
          ? 'accept_provider_capability_preview'
          : 'include_provider_capability_contract'
    },
    {
      key: 'external_handoff',
      label: 'Mailchimp external handoff',
      status: provider.externalState?.ready ? 'ready' : 'blocked',
      accepted: acceptance.acceptedItems.includes('external_handoff'),
      required: true,
      nextStep: provider.externalState?.ready
        ? requireExplicitAcceptance && !acceptance.acceptedItems.includes('external_handoff')
          ? 'accept_external_handoff_preview'
          : 'include_external_handoff_state'
        : 'route_provider_handoff_to_kernel_status'
    }
  ];
  const requiredRows = rows.filter((row) => row.required);
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const degradedRows = requiredRows.filter((row) => row.status === 'degraded');
  const diagnostics = [
    ...snapshot.diagnostics,
    ...missingCapabilities.map((capability) => ({
      level: 'error',
      code: 'provider_preview_capability_missing',
      subject: capability
    })),
    ...(provider.externalState?.ready
      ? []
      : [{
        level: 'error',
        code: 'provider_preview_external_handoff_not_ready',
        subject: provider.externalState?.statusChannel ?? 'missing_status_channel'
      }]),
    ...(requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => ({
        level: 'error',
        code: 'provider_preview_acceptance_missing',
        subject: row.key
      }))
      : awaitingAcceptance.map((row) => ({
        level: 'warning',
        code: 'provider_preview_acceptance_pending',
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
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    operation: snapshot.operation,
    status,
    restartSafe: status === 'ready' && snapshot.restartSafe && provider.externalState?.restartSafe === true,
    preview: {
      rows,
      acceptedItems: acceptance.acceptedItems,
      acceptedAt: acceptance.acceptedAt,
      acceptedBy: acceptance.acceptedBy,
      requireExplicitAcceptance
    },
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      missingCapabilities: missingCapabilities.length,
      deniedEffects: snapshot.deniedEffects.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: unique([
        ...(blockedRows.length > 0 ? blockedRows.map((row) => row.key) : []),
        ...missingCapabilities.map((capability) => `missing:${capability}`),
        ...(provider.externalState?.ready ? [] : ['external_handoff'])
      ]),
      degradedReasons: unique([
        ...(degradedRows.length > 0 ? degradedRows.map((row) => row.key) : []),
        ...(!requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction: status === 'blocked'
        ? 'resolve_provider_preview_blockers'
        : status === 'degraded'
          ? 'publish_provider_preview_degraded_status'
          : 'publish_provider_preview_ready'
    },
    explanation: {
      headline: status === 'ready'
        ? 'mailchimp_provider_preview_ready'
        : status === 'degraded'
          ? 'mailchimp_provider_preview_needs_attention'
          : 'mailchimp_provider_preview_blocked',
      nextSteps: unique(rows.filter((row) => row.status !== 'ready' || row.accepted !== true).map((row) => row.nextStep))
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      operation: snapshot.operation,
      status,
      restartSafe: status === 'ready' && snapshot.restartSafe && provider.externalState?.restartSafe === true,
      provider: provider.provider,
      service: provider.service,
      missingCapabilities,
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key),
      externalHandoff: provider.externalState ?? null,
      nextAction: status === 'ready' ? 'publish_provider_preview_ready' : 'review_provider_preview'
    },
    diagnostics
  };
}

export function buildFeatureGateProviderLaunchAcceptance(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousGateState ?? input.previousGateState
  });
  const profileLaunch = normalizeProviderLaunchContract(options.profileLaunchHandoff ?? input.profileLaunchHandoff);
  const importLaunch = normalizeProviderLaunchContract(options.importProviderLaunchState ?? input.importProviderLaunchState);
  const acceptance = normalizeProviderPreviewAcceptance(options.acceptance ?? options.providerLaunchAcceptance ?? input.acceptance);
  const requireExplicitAcceptance = options.requireExplicitProviderLaunchAcceptance === true
    || acceptance.requireExplicitAcceptance === true;
  const rows = [
    providerLaunchAcceptanceRow('feature_gates', snapshot, true, {
      label: 'Mailchimp feature gate state',
      accepted: acceptance.acceptedItems.includes('feature_gates'),
      nextAction: snapshot.status === 'blocked'
        ? 'resolve_feature_gate_launch_blockers'
        : requireExplicitAcceptance && !acceptance.acceptedItems.includes('feature_gates')
          ? 'accept_feature_gate_launch_preview'
          : 'include_feature_gate_launch_state',
      evidence: {
        fingerprint: snapshot.fingerprint,
        deniedEffects: snapshot.deniedEffects,
        disabledRequiredGates: (MAILCHIMP_OPERATION_GATES[operation]?.required ?? [])
          .filter((gate) => snapshot.gates[gate] !== true)
      }
    }),
    providerLaunchAcceptanceRow('profile_provider_launch', profileLaunch, true, {
      label: 'Profile provider launch handoff',
      accepted: acceptance.acceptedItems.includes('profile_provider_launch'),
      nextAction: profileLaunch.status === 'blocked'
        ? 'repair_profile_provider_launch_handoff'
        : requireExplicitAcceptance && !acceptance.acceptedItems.includes('profile_provider_launch')
          ? 'accept_profile_provider_launch_preview'
          : 'include_profile_provider_launch_handoff',
      evidence: {
        fingerprint: profileLaunch.fingerprint,
        blockedRows: profileLaunch.blockedRows,
        guardedRows: profileLaunch.guardedRows
      }
    }),
    providerLaunchAcceptanceRow('import_provider_launch', importLaunch, true, {
      label: 'Import provider launch state',
      accepted: acceptance.acceptedItems.includes('import_provider_launch'),
      nextAction: importLaunch.status === 'blocked'
        ? 'repair_import_provider_launch_state'
        : requireExplicitAcceptance && !acceptance.acceptedItems.includes('import_provider_launch')
          ? 'accept_import_provider_launch_preview'
          : 'include_import_provider_launch_state',
      evidence: {
        fingerprint: importLaunch.fingerprint,
        blockedRows: importLaunch.blockedRows,
        guardedRows: importLaunch.guardedRows,
        checkpointKeys: importLaunch.checkpointKeys
      }
    })
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const guardedRows = requiredRows.filter((row) => row.status === 'guarded');
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true);
  const diagnostics = [
    ...snapshot.diagnostics,
    ...profileLaunch.diagnostics,
    ...importLaunch.diagnostics,
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'provider_launch_acceptance_row_blocked',
      subject: row.key
    })),
    ...(requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => ({
        level: 'error',
        code: 'provider_launch_acceptance_missing',
        subject: row.key
      }))
      : awaitingAcceptance.map((row) => ({
        level: 'warning',
        code: 'provider_launch_acceptance_pending',
        subject: row.key
      })))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = providerLaunchAcceptanceFingerprint({
    operation,
    status,
    rows,
    snapshot,
    profileLaunch,
    importLaunch
  });
  const nextAction = status === 'blocked'
    ? 'resolve_provider_launch_acceptance_blockers'
    : status === 'guarded'
      ? 'publish_provider_launch_acceptance_guarded'
      : 'publish_provider_launch_acceptance_ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_provider_launch_acceptance',
    operation,
    status,
    restartSafe: status === 'ready' && snapshot.restartSafe === true && profileLaunch.restartSafe === true && importLaunch.restartSafe === true,
    fingerprint,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      deniedEffects: snapshot.deniedEffects.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.key)),
      guardedReasons: unique([
        ...guardedRows.map((row) => row.key),
        ...(!requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction
    },
    preview: {
      acceptedItems: acceptance.acceptedItems,
      acceptedAt: acceptance.acceptedAt,
      acceptedBy: acceptance.acceptedBy,
      requireExplicitAcceptance,
      visibleRows: rows.filter((row) => row.status !== 'ready' || row.accepted !== true).map((row) => row.key)
    },
    handoff: {
      target: 'mailchimp.client.workflow.provider-launch-preview',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.provider-launch-preview',
      publish: status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || awaitingAcceptance.length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_provider_launch_acceptance',
      operation,
      status,
      restartSafe: status === 'ready' && snapshot.restartSafe === true && profileLaunch.restartSafe === true && importLaunch.restartSafe === true,
      fingerprint,
      blockedRows: blockedRows.map((row) => row.key).sort(),
      guardedRows: guardedRows.map((row) => row.key).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildFeatureGatePublicationTimeline(input = {}, options = {}) {
  const analytics = input?.schemaVersion === FEATURE_GATES_SCHEMA_VERSION && input.report?.title === 'mailchimp_feature_gate_report'
    ? input
    : buildFeatureGateAnalyticsReport(input.gates ?? input, options);
  const previous = normalizeFeatureGatePublication(options.previousPublication ?? options.previousFeatureGatePublication ?? input.previousPublication);
  const now = clean(options.now ?? options.timestamp) || null;
  const publishChangedOnly = options.publishChangedOnly !== false;
  const changedRows = analytics.changedGates ?? [];
  const stale = previous.reportFingerprint
    && previous.reportFingerprint === analytics.exportSummary?.fingerprint
    && previous.ageMs > toPositiveInteger(options.maxPublicationAgeMs ?? input.maxPublicationAgeMs, 120000);
  const status = analytics.exportSummary?.status === 'blocked' || analytics.report?.riskLevel === 'high'
    ? 'blocked'
    : analytics.exportSummary?.status === 'degraded' || analytics.report?.riskLevel === 'medium' || stale
      ? 'degraded'
      : 'ready';
  const rows = (analytics.report?.rows ?? []).map((row) => ({
    gate: row.gate,
    enabled: row.enabled,
    changed: row.changed,
    requiredForOperation: row.requiredForOperation,
    publish: row.changed === true || row.requiredForOperation === true || publishChangedOnly !== true,
    blocksEffect: row.blocksEffect ?? null
  }));
  const fingerprint = featureGatePublicationFingerprint({
    operation: analytics.operation,
    status,
    reportFingerprint: analytics.exportSummary?.fingerprint,
    rows,
    stale
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = changed ? previous.sequence + 1 : previous.sequence;
  const diagnostics = [
    ...(analytics.diagnostics ?? []),
    ...(stale ? [{ level: 'warning', code: 'feature_gate_publication_stale', subject: String(previous.ageMs) }] : [])
  ];
  const nextAction = status === 'blocked'
    ? 'publish_feature_gate_policy_blocked'
    : status === 'degraded'
      ? 'publish_feature_gate_policy_degraded'
      : changed
        ? 'publish_feature_gate_policy_ready'
        : 'reuse_feature_gate_publication';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_publication_timeline',
    operation: analytics.operation,
    status,
    restartSafe: status === 'ready' && analytics.exportSummary?.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    stale,
    rows,
    counters: {
      gates: rows.length,
      publishRows: rows.filter((row) => row.publish).length,
      changedGates: changedRows.length,
      deniedEffects: analytics.counters?.deniedEffects ?? 0,
      requiredDisabled: analytics.counters?.requiredDisabled ?? 0,
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
          operation: analytics.operation,
          status,
          fingerprint,
          reportFingerprint: analytics.exportSummary?.fingerprint ?? null,
          changedGates: changedRows.length,
          deniedEffects: analytics.counters?.deniedEffects ?? 0,
          stale
        }] : [])
      ].slice(-toPositiveInteger(options.publicationHistoryLimit ?? options.historyLimit, 12))
    },
    publication: {
      target: 'kernel.status.mailchimp.feature-gates',
      statusChannel: analytics.exportSummary?.status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.feature-gates',
      publish: changed || status !== 'ready' || stale,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: rows.some((row) => row.publish),
      includeChangedGates: changedRows.length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_publication_timeline',
      operation: analytics.operation,
      status,
      restartSafe: status === 'ready' && analytics.exportSummary?.restartSafe === true,
      sequence,
      fingerprint,
      reportFingerprint: analytics.exportSummary?.fingerprint ?? null,
      changed,
      stale,
      publishRows: rows.filter((row) => row.publish).map((row) => row.gate).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildFeatureGateAnalyticsPublicationSummary(input = {}, options = {}) {
  const analytics = buildFeatureGateAnalyticsReport(input, {
    ...options,
    previousAnalytics: options.previousAnalytics ?? options.previousGateAnalytics
  });
  const previous = normalizeFeatureGateAnalyticsPublication(options.previousPublication ?? options.previousFeatureGateAnalyticsPublication ?? input.previousPublication);
  const rows = analytics.report.rows.map((row) => {
    const blocked = row.requiredForOperation && row.enabled !== true;
    const guarded = !blocked && (row.blocksEffect || row.changed);
    return {
      gate: row.gate,
      status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
      enabled: row.enabled,
      changed: row.changed,
      requiredForOperation: row.requiredForOperation,
      blocksEffect: row.blocksEffect,
      publish: blocked || guarded || analytics.report.riskLevel !== 'low',
      nextAction: blocked
        ? `enable_required_gate_${row.gate}`
        : guarded
          ? `publish_gate_${row.gate}_advisory`
          : `publish_gate_${row.gate}_ready`
    };
  });
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0 || analytics.report.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || analytics.report.riskLevel === 'medium'
      ? 'guarded'
      : 'ready';
  const fingerprint = featureGateAnalyticsPublicationFingerprint({
    operation: analytics.operation,
    status,
    rows,
    counters: analytics.counters
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(options.now ?? options.timestamp) || null,
    operation: analytics.operation,
    status,
    fingerprint,
    changedGateCount: analytics.counters.changed,
    publishRows: rows.filter((row) => row.publish).length
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(options.publicationHistoryLimit ?? options.historyLimit, 12));
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_feature_gate_analytics_blockers'
    : status === 'guarded'
      ? 'publish_feature_gate_analytics_guarded'
      : changed
        ? 'publish_feature_gate_analytics_ready'
        : 'reuse_feature_gate_analytics_publication';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_analytics_publication',
    operation: analytics.operation,
    status,
    restartSafe: status === 'ready' && analytics.exportSummary.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    counters: analytics.counters,
    rows,
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-gate-analytics',
      statusChannel: analytics.exportSummary.statusChannel ?? 'kernel.status.mailchimp',
      publish: changed || rows.some((row) => row.publish),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeTimeline: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_analytics_publication',
      operation: analytics.operation,
      status,
      restartSafe: status === 'ready' && analytics.exportSummary.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      publishRows: rows.filter((row) => row.publish).map((row) => row.gate).sort(),
      blockedRows: blockedRows.map((row) => row.gate).sort(),
      guardedRows: guardedRows.map((row) => row.gate).sort(),
      nextAction
    },
    diagnostics: analytics.diagnostics
  };
}

export function buildFeatureGateClientWorkflowHandoff(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const analytics = buildFeatureGateAnalyticsReport(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousAnalytics: options.previousAnalytics ?? options.previousGateAnalytics ?? input.previousAnalytics
  });
  const providerPreview = buildFeatureGateProviderPreviewAcceptance(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousGateState: options.previousState ?? options.previousGateState,
    providerService: options.providerService ?? input.providerService,
    acceptance: options.providerPreviewAcceptance ?? options.acceptance,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const requiredGates = MAILCHIMP_OPERATION_GATES[operation]?.required ?? [];
  const rows = [
    {
      id: 'feature_gate_policy',
      label: 'Feature gate policy',
      status: snapshot.status,
      visibleToClient: true,
      nextAction: snapshot.recovery.pendingOperatorAction ?? snapshot.recovery.resumeAction,
      evidence: {
        requiredGates,
        deniedEffects: snapshot.deniedEffects,
        verifierMode: snapshot.policy.verifierMode,
        statusHandoff: snapshot.policy.statusHandoff
      }
    },
    {
      id: 'feature_gate_scope',
      label: 'Tenant feature scope',
      status: snapshot.tenantPolicy?.tenantIsolation === 'blocked'
        ? 'blocked'
        : snapshot.tenantPolicy?.workspaceIsolation === 'advisory'
          ? 'degraded'
          : 'ready',
      visibleToClient: snapshot.tenantPolicy?.workspaceIsolation === 'advisory'
        || snapshot.tenantPolicy?.tenantIsolation === 'blocked',
      nextAction: snapshot.tenantPolicy?.tenantIsolation === 'blocked'
        ? 'review_tenant_feature_gate_boundary'
        : snapshot.tenantPolicy?.workspaceIsolation === 'advisory'
          ? 'publish_feature_gate_scope_advisory'
          : 'include_feature_gate_scope',
      evidence: {
        tenantId: snapshot.scope.tenantId,
        workspaceId: snapshot.scope.workspaceId,
        role: snapshot.scope.role,
        auditSubject: snapshot.auditHandoff.subject
      }
    },
    {
      id: 'feature_gate_provider_preview',
      label: 'Provider preview',
      status: providerPreview.status,
      visibleToClient: providerPreview.status !== 'ready' || providerPreview.validationSummary.awaitingAcceptance > 0,
      nextAction: providerPreview.readiness.nextAction,
      evidence: {
        missingCapabilities: providerPreview.exportSummary.missingCapabilities,
        awaitingAcceptance: providerPreview.exportSummary.awaitingAcceptance,
        externalHandoff: providerPreview.exportSummary.externalHandoff
      }
    },
    {
      id: 'feature_gate_analytics',
      label: 'Gate analytics',
      status: analytics.report.riskLevel === 'high'
        ? 'blocked'
        : analytics.report.riskLevel === 'medium'
          ? 'degraded'
          : 'ready',
      visibleToClient: analytics.counters.changed > 0 || analytics.counters.deniedEffects > 0,
      nextAction: analytics.exportSummary.nextAction,
      evidence: {
        generation: analytics.exportSummary.generation,
        changedGateCount: analytics.exportSummary.changedGateCount,
        riskLevel: analytics.report.riskLevel
      }
    }
  ];
  const blockingRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded');
  const diagnostics = [
    ...snapshot.diagnostics,
    ...providerPreview.diagnostics.filter((item) => item.level === 'error')
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockingRows.length > 0
    ? 'blocked'
    : degradedRows.length > 0
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    operation,
    status,
    restartSafe: status === 'ready' && snapshot.restartSafe && providerPreview.restartSafe,
    rows,
    scope: snapshot.scope,
    handoff: {
      target: 'kernel.status.mailchimp.feature-gates',
      statusChannel: snapshot.policy.statusHandoff === 'kernel_status_channel'
        ? 'kernel.status.mailchimp'
        : 'local.status.feature-gates',
      publish: status !== 'ready' || rows.some((row) => row.visibleToClient),
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      nextAction: status === 'blocked'
        ? 'resolve_feature_gate_client_handoff_blockers'
        : status === 'degraded'
          ? 'publish_feature_gate_client_degraded_status'
          : 'publish_feature_gate_client_ready'
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      operation,
      status,
      restartSafe: status === 'ready' && snapshot.restartSafe,
      generation: snapshot.generation,
      fingerprint: snapshot.fingerprint,
      blockingRows: blockingRows.map((row) => row.id),
      degradedRows: degradedRows.map((row) => row.id),
      deniedEffects: snapshot.deniedEffects,
      nextAction: status === 'ready' ? 'publish_feature_gate_client_ready' : 'review_feature_gate_client_handoff'
    },
    diagnostics
  };
}

export function buildFeatureGateClientAcceptancePackage(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const handoff = buildFeatureGateClientWorkflowHandoff(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    previousAnalytics: options.previousAnalytics ?? options.previousGateAnalytics ?? input.previousAnalytics,
    providerPreviewAcceptance: options.providerPreviewAcceptance ?? options.acceptance,
    providerService: options.providerService ?? input.providerService,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const acceptance = normalizeProviderPreviewAcceptance(options.acceptance ?? options.providerPreviewAcceptance ?? input.acceptance);
  const requireExplicitAcceptance = options.requireExplicitAcceptance === true
    || options.requireExplicitProviderAcceptance === true
    || acceptance.requireExplicitAcceptance === true;
  const requiredGateRows = (MAILCHIMP_OPERATION_GATES[operation]?.required ?? []).map((gate) => ({
    key: `gate:${gate}`,
    label: gate,
    required: true,
    accepted: acceptance.acceptedItems.includes(`gate:${gate}`) || acceptance.acceptedItems.includes(gate),
    status: snapshot.gates[gate] === true ? 'ready' : 'blocked',
    nextStep: snapshot.gates[gate] === true
      ? requireExplicitAcceptance && !acceptance.acceptedItems.includes(`gate:${gate}`) && !acceptance.acceptedItems.includes(gate)
        ? 'accept_required_feature_gate'
        : 'include_required_feature_gate'
      : 'enable_required_feature_gate',
    evidence: {
      gate,
      enabled: snapshot.gates[gate] === true,
      operation
    }
  }));
  const policyRows = [
    {
      key: 'effect_policy',
      label: 'Requested effects',
      required: true,
      accepted: acceptance.acceptedItems.includes('effect_policy'),
      status: snapshot.deniedEffects.length > 0 ? 'blocked' : 'ready',
      nextStep: snapshot.deniedEffects.length > 0
        ? 'remove_or_enable_denied_effects'
        : requireExplicitAcceptance && !acceptance.acceptedItems.includes('effect_policy')
          ? 'accept_feature_effect_policy'
          : 'include_feature_effect_policy',
      evidence: {
        requestedEffects: normalizeList(requestedEffects),
        deniedEffects: snapshot.deniedEffects,
        verifierMode: snapshot.policy.verifierMode
      }
    },
    {
      key: 'status_handoff',
      label: 'Feature gate status handoff',
      required: true,
      accepted: acceptance.acceptedItems.includes('status_handoff'),
      status: handoff.handoff.statusChannel === 'kernel.status.mailchimp' ? 'ready' : 'degraded',
      nextStep: handoff.handoff.statusChannel === 'kernel.status.mailchimp'
        ? requireExplicitAcceptance && !acceptance.acceptedItems.includes('status_handoff')
          ? 'accept_feature_status_handoff'
          : 'publish_feature_status_handoff'
        : 'route_feature_status_to_kernel',
      evidence: {
        target: handoff.handoff.target,
        statusChannel: handoff.handoff.statusChannel,
        publish: handoff.handoff.publish
      }
    }
  ];
  const rows = [...requiredGateRows, ...policyRows];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded');
  const awaitingAcceptance = rows.filter((row) => row.required && row.accepted !== true);
  const diagnostics = [
    ...handoff.diagnostics,
    ...(requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => ({
        level: 'error',
        code: 'feature_client_acceptance_missing',
        subject: row.key
      }))
      : awaitingAcceptance.map((row) => ({
        level: 'warning',
        code: 'feature_client_acceptance_pending',
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
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    operation,
    status,
    restartSafe: status === 'ready' && handoff.restartSafe === true && snapshot.restartSafe === true,
    package: {
      title: 'mailchimp_feature_gate_client_acceptance',
      rows,
      acceptedItems: acceptance.acceptedItems,
      acceptedAt: acceptance.acceptedAt,
      acceptedBy: acceptance.acceptedBy,
      requireExplicitAcceptance
    },
    validationSummary: {
      totalRows: rows.length,
      requiredRows: rows.filter((row) => row.required).length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      deniedEffects: snapshot.deniedEffects.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: unique([
        ...blockedRows.map((row) => row.key),
        ...snapshot.deniedEffects.map((effect) => `denied:${effect}`)
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.key),
        ...(!requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction: status === 'blocked'
        ? 'resolve_feature_client_acceptance_blockers'
        : status === 'degraded'
          ? 'publish_feature_client_acceptance_degraded'
          : 'publish_feature_client_acceptance_ready'
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-gates.acceptance',
      statusChannel: handoff.handoff.statusChannel,
      publish: status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includePackage: true,
      nextAction: status === 'ready' ? 'publish_feature_client_acceptance_ready' : 'review_feature_client_acceptance'
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_client_acceptance',
      operation,
      status,
      restartSafe: status === 'ready' && handoff.restartSafe === true,
      blockedRows: blockedRows.map((row) => row.key),
      degradedRows: degradedRows.map((row) => row.key),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key),
      deniedEffects: snapshot.deniedEffects,
      nextAction: status === 'ready' ? 'publish_feature_client_acceptance_ready' : 'review_feature_client_acceptance'
    },
    diagnostics
  };
}

export function buildFeatureGateClientActionQueue(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const handoff = buildFeatureGateClientWorkflowHandoff(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    previousAnalytics: options.previousAnalytics ?? options.previousGateAnalytics ?? input.previousAnalytics,
    providerService: options.providerService ?? input.providerService,
    providerPreviewAcceptance: options.providerPreviewAcceptance ?? options.acceptance,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const acceptance = buildFeatureGateClientAcceptancePackage(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    previousAnalytics: options.previousAnalytics ?? options.previousGateAnalytics ?? input.previousAnalytics,
    providerService: options.providerService ?? input.providerService,
    acceptance: options.acceptance ?? options.providerPreviewAcceptance ?? input.acceptance,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const requiredGates = MAILCHIMP_OPERATION_GATES[operation]?.required ?? [];
  const handoffRows = (handoff.rows ?? []).map((row) => ({
    id: `feature:${row.id}`,
    source: 'feature_workflow',
    subject: row.id,
    status: row.status,
    severity: row.status === 'blocked' ? 'error' : row.status === 'degraded' ? 'warning' : 'info',
    clientVisible: row.visibleToClient === true || row.status !== 'ready',
    required: true,
    nextAction: row.nextAction,
    evidence: row.evidence ?? {}
  }));
  const acceptanceRows = (acceptance.package?.rows ?? []).map((row) => ({
    id: `feature_acceptance:${row.key}`,
    source: 'feature_acceptance',
    subject: row.key,
    status: row.status === 'ready' && row.accepted !== true && row.required === true
      ? 'awaiting_acceptance'
      : row.status,
    severity: row.status === 'blocked'
      ? 'error'
      : row.accepted !== true && row.required === true
        ? 'warning'
        : row.status === 'degraded'
          ? 'warning'
          : 'info',
    clientVisible: row.required === true && (row.accepted !== true || row.status !== 'ready'),
    required: row.required === true,
    nextAction: row.nextStep,
    evidence: row.evidence ?? {}
  }));
  const deniedEffectRows = (acceptance.exportSummary?.deniedEffects ?? []).map((effect) => ({
    id: `feature_effect:${effect}`,
    source: 'feature_policy',
    subject: effect,
    status: 'blocked',
    severity: 'error',
    clientVisible: true,
    required: true,
    nextAction: 'remove_or_enable_denied_effect',
    evidence: {
      operation,
      requestedEffects: normalizeList(requestedEffects),
      requiredGates
    }
  }));
  const rows = dedupeFeatureClientActions([
    ...deniedEffectRows,
    ...handoffRows,
    ...acceptanceRows
  ]).sort((left, right) => (
    featureClientActionRank(right.severity) - featureClientActionRank(left.severity)
    || featureClientActionStatusRank(right.status) - featureClientActionStatusRank(left.status)
    || left.id.localeCompare(right.id)
  ));
  const blockingRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'degraded' || row.status === 'awaiting_acceptance');
  const visibleRows = rows.filter((row) => row.clientVisible);
  const diagnostics = [
    ...handoff.diagnostics,
    ...acceptance.diagnostics
  ];
  const status = blockingRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = featureClientActionQueueFingerprint({
    operation,
    status,
    rows,
    handoff,
    acceptance
  });

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_client_action_queue',
    operation,
    status,
    restartSafe: status === 'ready' && handoff.restartSafe === true && acceptance.restartSafe === true,
    fingerprint,
    rows,
    validationSummary: {
      totalRows: rows.length,
      visibleRows: visibleRows.length,
      blockingRows: blockingRows.length,
      guardedRows: guardedRows.length,
      requiredGates: requiredGates.length,
      deniedEffects: acceptance.exportSummary?.deniedEffects?.length ?? 0,
      awaitingAcceptance: acceptance.exportSummary?.awaitingAcceptance?.length ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: blockingRows.map((row) => row.subject).sort(),
      guardedReasons: guardedRows.map((row) => row.subject).sort(),
      nextAction: status === 'blocked'
        ? 'resolve_feature_client_action_blockers'
        : status === 'guarded'
          ? 'publish_feature_client_action_guarded'
          : 'publish_feature_client_action_ready'
    },
    handoff: {
      target: 'mailchimp.client.workflow.feature-actions',
      statusChannel: handoff.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      publish: status !== 'ready' || visibleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: visibleRows.length > 0,
      nextAction: status === 'ready' ? 'publish_feature_client_action_ready' : 'review_feature_client_action_queue'
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_client_action_queue',
      operation,
      status,
      restartSafe: status === 'ready' && handoff.restartSafe === true && acceptance.restartSafe === true,
      fingerprint,
      visibleActions: visibleRows.map((row) => row.id).sort(),
      blockingActions: blockingRows.map((row) => row.id).sort(),
      guardedActions: guardedRows.map((row) => row.id).sort(),
      nextAction: status === 'ready' ? 'publish_feature_client_action_ready' : 'review_feature_client_action_queue'
    },
    diagnostics
  };
}

export function buildFeatureGateClientNextStepDigest(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const clientAcceptance = buildFeatureGateClientAcceptancePackage(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    acceptance: options.acceptance ?? options.featureAcceptance ?? input.acceptance,
    providerService: options.providerService ?? input.providerService,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const actionQueue = buildFeatureGateClientActionQueue(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    acceptance: options.acceptance ?? options.featureAcceptance ?? input.acceptance,
    providerPreviewAcceptance: options.providerPreviewAcceptance ?? options.acceptance,
    providerService: options.providerService ?? input.providerService,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const launchPreview = options.launchPreview?.title === 'mailchimp_feature_launch_preview'
    ? options.launchPreview
    : buildFeatureGateLaunchPreviewContract(gatesInput, {
      ...options,
      operation,
      requestedEffects,
      acceptance: options.acceptance ?? options.featureAcceptance ?? input.acceptance,
      launchAcceptance: options.launchAcceptance ?? options.featureLaunchPreviewAcceptance,
      providerService: options.providerService ?? input.providerService,
      providerSyncHandoff: options.providerSyncHandoff ?? input.providerSyncHandoff,
      requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
    });
  const acceptanceRows = (clientAcceptance.package?.rows ?? []).map((row) => ({
    key: `acceptance:${row.key}`,
    source: 'feature_acceptance',
    status: row.status === 'blocked'
      ? 'blocked'
      : row.status === 'degraded' || (row.required === true && row.accepted !== true)
        ? 'guarded'
        : 'ready',
    clientVisible: row.required === true && (row.accepted !== true || row.status !== 'ready'),
    accepted: row.accepted === true,
    required: row.required === true,
    nextAction: row.nextStep,
    evidence: row.evidence ?? {}
  }));
  const actionRows = (actionQueue.rows ?? [])
    .filter((row) => row.clientVisible === true || row.status !== 'ready')
    .map((row) => ({
      key: `action:${row.subject}`,
      source: row.source || 'feature_action',
      status: row.status === 'blocked'
        ? 'blocked'
        : row.status === 'degraded' || row.status === 'awaiting_acceptance'
          ? 'guarded'
          : 'ready',
      clientVisible: true,
      accepted: row.status !== 'awaiting_acceptance',
      required: row.required === true,
      nextAction: row.nextAction,
      evidence: row.evidence ?? {}
    }));
  const launchRows = (launchPreview.preview?.rows ?? [])
    .filter((row) => row.clientVisible === true || row.status !== 'ready')
    .map((row) => ({
      key: `launch:${row.key}`,
      source: 'feature_launch_preview',
      status: row.status === 'blocked'
        ? 'blocked'
        : row.status === 'degraded' || row.restartSafe === false || (row.required === true && row.accepted !== true)
          ? 'guarded'
          : 'ready',
      clientVisible: true,
      accepted: row.accepted === true,
      required: row.required === true,
      nextAction: row.nextStep,
      evidence: row.evidence ?? {}
    }));
  const rows = dedupeFeatureClientNextStepRows([
    ...acceptanceRows,
    ...actionRows,
    ...launchRows
  ]);
  const blockingRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const awaitingAcceptance = rows.filter((row) => row.required && row.accepted !== true);
  const status = blockingRows.length > 0 || clientAcceptance.status === 'blocked' || actionQueue.status === 'blocked' || launchPreview.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || clientAcceptance.status === 'degraded' || actionQueue.status === 'guarded' || launchPreview.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const nextActions = unique([
    ...blockingRows.map((row) => row.nextAction),
    ...guardedRows.map((row) => row.nextAction),
    ...(status === 'ready' ? [
      clientAcceptance.readiness?.nextAction,
      actionQueue.readiness?.nextAction,
      launchPreview.readiness?.nextAction
    ] : [])
  ]);
  const fingerprint = [
    operation,
    status,
    ...rows.map((row) => [
      row.key,
      row.source,
      row.status,
      row.accepted ? 'accepted' : 'pending',
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_client_next_step_digest',
    operation,
    status,
    restartSafe: status === 'ready'
      && clientAcceptance.restartSafe === true
      && actionQueue.restartSafe === true
      && launchPreview.restartSafe === true,
    fingerprint,
    rows,
    validationSummary: {
      totalRows: rows.length,
      visibleRows: rows.filter((row) => row.clientVisible).length,
      blockingRows: blockingRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      deniedEffects: clientAcceptance.validationSummary?.deniedEffects ?? 0,
      requiredGates: actionQueue.validationSummary?.requiredGates ?? 0,
      launchPreviewRows: launchPreview.validationSummary?.totalRows ?? 0
    },
    readiness: {
      status,
      blockingReasons: blockingRows.map((row) => row.key).sort(),
      guardedReasons: guardedRows.map((row) => row.key).sort(),
      nextAction: status === 'blocked'
        ? 'resolve_feature_gate_client_next_steps'
        : status === 'guarded'
          ? 'publish_feature_gate_client_next_steps_guarded'
          : 'publish_feature_gate_client_next_steps_ready',
      nextActions
    },
    handoff: {
      target: 'mailchimp.client.workflow.feature-next-steps',
      statusChannel: actionQueue.handoff?.statusChannel ?? launchPreview.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      publish: status !== 'ready' || rows.some((row) => row.clientVisible),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: rows.some((row) => row.clientVisible),
      nextAction: status === 'ready' ? 'publish_feature_gate_client_next_steps_ready' : 'review_feature_gate_client_next_steps'
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_client_next_step_digest',
      operation,
      status,
      restartSafe: status === 'ready' && actionQueue.restartSafe === true && launchPreview.restartSafe === true,
      fingerprint,
      visibleRows: rows.filter((row) => row.clientVisible).map((row) => row.key).sort(),
      blockingRows: blockingRows.map((row) => row.key).sort(),
      guardedRows: guardedRows.map((row) => row.key).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key).sort(),
      deniedEffects: clientAcceptance.exportSummary?.deniedEffects ?? [],
      nextActions,
      nextAction: status === 'ready' ? 'publish_feature_gate_client_next_steps_ready' : 'review_feature_gate_client_next_steps'
    },
    diagnostics: [
      ...(clientAcceptance.diagnostics ?? []),
      ...(actionQueue.diagnostics ?? []).filter((item) => item.level === 'error'),
      ...(launchPreview.diagnostics ?? []).filter((item) => item.level === 'error')
    ]
  };
}

export function buildFeatureGateClientReadinessContract(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const acceptance = buildFeatureGateClientAcceptancePackage(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    acceptance: options.acceptance ?? options.featureClientAcceptance ?? input.acceptance,
    providerService: options.providerService ?? input.providerService,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true
      || options.requireFeatureClientAcceptance === true
  });
  const actionQueue = buildFeatureGateClientActionQueue(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    acceptance: options.acceptance ?? options.featureClientAcceptance ?? input.acceptance,
    providerPreviewAcceptance: options.providerPreviewAcceptance ?? options.acceptance,
    providerService: options.providerService ?? input.providerService,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const previous = normalizeFeatureGateClientReadiness(options.previousReadiness ?? options.previousFeatureClientReadiness ?? input.previousReadiness);
  const requiredGates = MAILCHIMP_OPERATION_GATES[operation]?.required ?? [];
  const rows = [
    ...requiredGates.map((gate) => ({
      id: `gate:${gate}`,
      source: 'required_gate',
      status: snapshot.gates[gate] === true ? 'ready' : 'blocked',
      clientVisible: snapshot.gates[gate] !== true,
      restartSafe: snapshot.gates[gate] === true,
      nextAction: snapshot.gates[gate] === true ? 'include_required_feature_gate' : 'enable_required_feature_gate',
      evidence: { gate, enabled: snapshot.gates[gate] === true }
    })),
    ...snapshot.deniedEffects.map((effect) => ({
      id: `effect:${effect}`,
      source: 'effect_policy',
      status: 'blocked',
      clientVisible: true,
      restartSafe: false,
      nextAction: 'remove_or_enable_denied_effect',
      evidence: { effect, requestedEffects: normalizeList(requestedEffects) }
    })),
    ...(actionQueue.rows ?? [])
      .filter((row) => row.clientVisible || row.status !== 'ready')
      .map((row) => ({
        id: `action:${row.id}`,
        source: row.source,
        status: row.status === 'awaiting_acceptance' ? 'guarded' : row.status,
        clientVisible: row.clientVisible === true,
        restartSafe: row.status === 'ready' && actionQueue.restartSafe === true,
        nextAction: row.nextAction,
        evidence: row.evidence ?? {}
      })),
    ...(acceptance.package?.rows ?? [])
      .filter((row) => row.required && (row.accepted !== true || row.status !== 'ready'))
      .map((row) => ({
        id: `acceptance:${row.key}`,
        source: 'feature_acceptance',
        status: row.status === 'blocked' ? 'blocked' : 'guarded',
        clientVisible: true,
        restartSafe: false,
        nextAction: row.nextStep,
        evidence: {
          accepted: row.accepted === true,
          required: row.required === true
        }
      }))
  ];
  const dedupedRows = dedupeFeatureClientReadinessRows(rows);
  const blockedRows = dedupedRows.filter((row) => row.status === 'blocked');
  const guardedRows = dedupedRows.filter((row) => row.status === 'guarded' || row.status === 'degraded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = featureGateClientReadinessFingerprint({
    operation,
    status,
    snapshot,
    acceptance,
    actionQueue,
    rows: dedupedRows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...snapshot.diagnostics,
    ...acceptance.diagnostics.filter((item) => item.level === 'error' || options.includeFeatureReadinessWarnings === true),
    ...actionQueue.diagnostics.filter((item) => item.level === 'error')
  ];

  return {
    ok: status !== 'blocked' && !diagnostics.some((item) => item.level === 'error'),
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_client_readiness',
    operation,
    status,
    restartSafe: status === 'ready' && snapshot.restartSafe === true && acceptance.restartSafe === true && actionQueue.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows: dedupedRows,
    validationSummary: {
      totalRows: dedupedRows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      visibleRows: dedupedRows.filter((row) => row.clientVisible).length,
      requiredGates: requiredGates.length,
      deniedEffects: snapshot.deniedEffects.length,
      awaitingAcceptance: acceptance.exportSummary?.awaitingAcceptance?.length ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: blockedRows.map((row) => row.id).sort(),
      guardedReasons: guardedRows.map((row) => row.id).sort(),
      nextAction: status === 'blocked'
        ? 'resolve_feature_client_readiness_blockers'
        : status === 'guarded'
          ? 'publish_feature_client_readiness_guarded'
          : changed
            ? 'publish_feature_client_readiness_ready'
            : 'reuse_feature_client_readiness'
    },
    handoff: {
      target: 'mailchimp.client.workflow.feature-readiness',
      statusChannel: actionQueue.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      publish: changed || status !== 'ready' || dedupedRows.some((row) => row.clientVisible),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: dedupedRows.length > 0,
      nextAction: status === 'ready' ? 'publish_feature_client_readiness_ready' : 'review_feature_client_readiness'
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_client_readiness',
      operation,
      status,
      restartSafe: status === 'ready' && snapshot.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction: status === 'ready' ? 'publish_feature_client_readiness_ready' : 'review_feature_client_readiness'
    },
    diagnostics
  };
}

export function buildFeatureGateRuntimeCheckpoint(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const readiness = buildFeatureGateClientReadinessContract(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousReadiness: options.previousReadiness ?? options.previousFeatureClientReadiness,
    previousState: options.previousState ?? options.previousGateState,
    previousAnalytics: options.previousAnalytics ?? options.previousGateAnalytics,
    providerService: options.providerService ?? input.providerService,
    acceptance: options.acceptance ?? options.featureClientAcceptance,
    providerPreviewAcceptance: options.providerPreviewAcceptance,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true
      || options.requireFeatureClientAcceptance === true
  });
  const resume = buildFeatureGateResumeStateEnvelope(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousResumeState: options.previousResumeState ?? options.previousFeatureGateResumeState,
    previousState: options.previousState ?? options.previousGateState,
    previousPlan: options.previousPlan ?? options.previousFeatureGateCommandPlan,
    previousReadiness: options.previousReadiness ?? options.previousFeatureClientReadiness,
    commands: options.commands ?? options.featureGateCommands ?? options.gateCommands
  });
  const commandPlan = buildFeatureGateLifecycleCommandPlan(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState,
    previousPlan: options.previousPlan ?? options.previousFeatureGateCommandPlan,
    generation: options.generation ?? options.gateGeneration,
    commands: options.commands ?? options.featureGateCommands ?? options.gateCommands,
    now: options.now ?? options.timestamp
  });
  const previous = normalizeFeatureGateRuntimeCheckpoint(
    options.previousCheckpoint ?? options.previousFeatureGateRuntimeCheckpoint ?? input.previousCheckpoint
  );
  const acceptance = normalizeFeatureGateRuntimeCheckpointAcceptance(
    options.checkpointAcceptance ?? options.featureGateRuntimeCheckpointAcceptance ?? options.acceptance
  );
  const requiredGates = MAILCHIMP_OPERATION_GATES[operation]?.required ?? [];
  const disabledRequiredGates = requiredGates.filter((gate) => snapshot.gates[gate] !== true);
  const statusChannel = snapshot.policy?.statusHandoff === 'kernel_status_channel'
    ? 'kernel.status.mailchimp'
    : 'local.status.feature-gates';
  const rows = dedupeFeatureGateRuntimeCheckpointRows([
    featureGateRuntimeCheckpointRow('gate_snapshot', {
      status: snapshot.status === 'blocked' ? 'blocked' : snapshot.status === 'degraded' ? 'guarded' : 'ready',
      restartSafe: snapshot.restartSafe === true,
      clientVisible: snapshot.status !== 'ready' || snapshot.changed === true,
      nextAction: snapshot.recovery?.pendingOperatorAction ?? snapshot.recovery?.resumeAction,
      evidence: {
        generation: snapshot.generation,
        fingerprint: snapshot.fingerprint,
        changed: snapshot.idempotency?.applied === true,
        disabledRequiredGates,
        deniedEffects: snapshot.deniedEffects ?? []
      }
    }),
    featureGateRuntimeCheckpointRow('client_readiness', {
      status: readiness.status,
      restartSafe: readiness.restartSafe === true,
      clientVisible: readiness.status !== 'ready' || readiness.changed === true,
      nextAction: readiness.readiness?.nextAction ?? readiness.handoff?.nextAction,
      evidence: {
        sequence: readiness.sequence,
        fingerprint: readiness.fingerprint,
        blockedRows: readiness.exportSummary?.blockedRows ?? [],
        guardedRows: readiness.exportSummary?.guardedRows ?? [],
        awaitingAcceptance: readiness.exportSummary?.awaitingAcceptance ?? []
      }
    }),
    featureGateRuntimeCheckpointRow('resume_state', {
      status: resume.status === 'guarded' ? 'guarded' : resume.status,
      restartSafe: resume.restartSafe === true,
      clientVisible: resume.status !== 'ready' || resume.changed === true,
      nextAction: resume.readiness?.nextAction ?? resume.handoff?.nextAction,
      evidence: {
        generation: resume.generation,
        fingerprint: resume.fingerprint,
        missingCommands: resume.exportSummary?.rejectedCommands ?? [],
        appliedCommandKeys: resume.idempotency?.appliedCommandKeys ?? []
      }
    }),
    featureGateRuntimeCheckpointRow('lifecycle_commands', {
      status: commandPlan.status === 'degraded' ? 'guarded' : commandPlan.status,
      restartSafe: commandPlan.restartSafe === true,
      clientVisible: commandPlan.status !== 'ready' || commandPlan.changed === true,
      nextAction: commandPlan.readiness?.nextAction ?? commandPlan.handoff?.nextAction,
      evidence: {
        fingerprint: commandPlan.fingerprint,
        changed: commandPlan.changed === true,
        appliedCommands: commandPlan.exportSummary?.appliedCommands ?? [],
        rejectedCommands: commandPlan.exportSummary?.rejectedCommands ?? []
      }
    }),
    featureGateRuntimeCheckpointRow('status_handoff', {
      status: statusChannel === 'kernel.status.mailchimp' ? 'ready' : 'guarded',
      restartSafe: statusChannel === 'kernel.status.mailchimp' && snapshot.restartSafe === true,
      clientVisible: statusChannel !== 'kernel.status.mailchimp',
      nextAction: statusChannel === 'kernel.status.mailchimp'
        ? 'publish_feature_checkpoint_to_kernel_status'
        : 'publish_feature_checkpoint_local_status_advisory',
      evidence: {
        statusChannel,
        statusHandoff: snapshot.policy?.statusHandoff ?? 'local_only',
        auditSubject: snapshot.auditHandoff?.subject ?? null
      }
    })
  ]);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const awaitingAcceptance = rows.filter((row) => row.clientVisible && !acceptance.acceptedRows.includes(row.id));
  const diagnostics = [
    ...snapshot.diagnostics,
    ...readiness.diagnostics.filter((item) => item.level === 'error' || options.includeFeatureCheckpointWarnings === true),
    ...resume.diagnostics.filter((item) => item.level === 'error'),
    ...commandPlan.diagnostics.filter((item) => item.level === 'error'),
    ...(acceptance.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => ({ level: 'error', code: 'feature_runtime_checkpoint_acceptance_missing', subject: row.id }))
      : awaitingAcceptance.map((row) => ({ level: 'warning', code: 'feature_runtime_checkpoint_acceptance_pending', subject: row.id })))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = featureGateRuntimeCheckpointFingerprint({
    operation,
    status,
    statusChannel,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_feature_runtime_checkpoint_blockers'
    : status === 'guarded'
      ? 'publish_feature_runtime_checkpoint_guarded'
      : changed
        ? 'publish_feature_runtime_checkpoint_ready'
        : 'reuse_feature_runtime_checkpoint';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_runtime_checkpoint',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      visibleRows: rows.filter((row) => row.clientVisible).length,
      awaitingAcceptance: awaitingAcceptance.length,
      disabledRequiredGates: disabledRequiredGates.length,
      deniedEffects: snapshot.deniedEffects.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.id)),
      guardedReasons: unique(guardedRows.map((row) => row.id)),
      nextAction
    },
    handoff: {
      target: 'mailchimp.client.workflow.feature-runtime-checkpoint',
      statusChannel,
      publish: changed || status !== 'ready' || rows.some((row) => row.clientVisible),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_runtime_checkpoint',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      statusChannel,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.id).sort(),
      deniedEffects: snapshot.deniedEffects,
      nextAction
    },
    diagnostics
  };
}

export function buildFeatureGateResumeStateEnvelope(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const readiness = buildFeatureGateClientReadinessContract(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousReadiness: options.previousReadiness ?? options.previousFeatureClientReadiness,
    previousState: options.previousState ?? options.previousGateState,
    previousAnalytics: options.previousAnalytics ?? options.previousGateAnalytics,
    providerService: options.providerService ?? input.providerService,
    acceptance: options.acceptance ?? options.featureClientAcceptance,
    providerPreviewAcceptance: options.providerPreviewAcceptance,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities,
    requireExplicitAcceptance: options.requireExplicitAcceptance === true
      || options.requireFeatureClientAcceptance === true
  });
  const commandPlan = buildFeatureGateLifecycleCommandPlan(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState,
    previousPlan: options.previousPlan ?? options.previousFeatureGateCommandPlan,
    generation: options.generation ?? options.gateGeneration,
    commands: options.commands ?? options.featureGateCommands ?? options.gateCommands,
    now: options.now ?? options.timestamp
  });
  const previous = normalizePreviousState(options.previousResumeState ?? options.previousFeatureGateResumeState ?? input.previousResumeState);
  const commandKeys = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...(commandPlan.idempotency?.appliedCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const requiredGateRows = readiness.rows.filter((row) => row.source === 'required_gate');
  const effectRows = readiness.rows.filter((row) => row.source === 'effect_policy');
  const blockedRows = readiness.rows.filter((row) => row.status === 'blocked');
  const guardedRows = readiness.rows.filter((row) => row.status === 'guarded' || row.status === 'degraded');
  const lifecycleBlocked = commandPlan.status === 'blocked';
  const lifecycleGuarded = commandPlan.status === 'degraded' || commandPlan.changed === true;
  const diagnostics = [
    ...snapshot.diagnostics,
    ...readiness.diagnostics.filter((item) => item.level === 'error' || options.includeFeatureResumeWarnings === true),
    ...commandPlan.diagnostics.filter((item) => item.level === 'error')
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0 || lifecycleBlocked
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0 || lifecycleGuarded
      ? 'guarded'
      : 'ready';
  const fingerprint = [
    'feature_resume_state',
    operation,
    status,
    snapshot.fingerprint,
    readiness.fingerprint,
    commandPlan.fingerprint,
    ...blockedRows.map((row) => row.id).sort(),
    ...guardedRows.map((row) => row.id).sort()
  ].map(clean).filter(Boolean).join('|');
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const generation = previous.generation + (changed ? 1 : 0);
  const restartSafe = status === 'ready'
    && snapshot.restartSafe === true
    && readiness.restartSafe === true
    && commandPlan.restartSafe === true;

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_resume_state',
    operation,
    status,
    restartSafe,
    generation,
    fingerprint,
    changed,
    gates: snapshot.gates,
    state: {
      snapshotGeneration: snapshot.generation,
      stateFingerprint: snapshot.fingerprint,
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint ?? null,
      requiredGates: requiredGateRows.map((row) => row.evidence.gate).sort(),
      deniedEffects: effectRows.map((row) => row.evidence.effect).sort(),
      appliedCommandKeys: [...commandKeys].sort()
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.id),
        ...(lifecycleBlocked ? ['feature_gate_lifecycle_command_plan'] : [])
      ]),
      guardedReasons: unique([
        ...guardedRows.map((row) => row.id),
        ...(lifecycleGuarded ? ['feature_gate_lifecycle_delta_pending'] : [])
      ]),
      nextAction: status === 'blocked'
        ? 'resolve_feature_gate_resume_blockers'
        : status === 'guarded'
          ? 'publish_feature_gate_resume_guarded'
          : changed
            ? 'publish_feature_gate_resume_ready'
            : 'reuse_feature_gate_resume_state'
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-gate-resume',
      statusChannel: snapshot.policy.statusHandoff === 'kernel_status_channel'
        ? 'kernel.status.mailchimp'
        : 'local.status.feature-gate-resume',
      publish: changed || status !== 'ready' || commandPlan.changed === true,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeGateState: true,
      includeCommandPlan: commandPlan.changed === true || status !== 'ready',
      nextAction: status === 'ready' ? 'publish_feature_gate_resume_ready' : 'review_feature_gate_resume'
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_resume_state',
      operation,
      status,
      restartSafe,
      generation,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      deniedEffects: snapshot.deniedEffects,
      nextAction: status === 'ready' ? 'publish_feature_gate_resume_ready' : 'review_feature_gate_resume'
    },
    diagnostics
  };
}

export function buildFeatureGateLaunchPreviewContract(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const providerSyncHandoff = normalizeFeatureProviderSyncHandoff(options.providerSyncHandoff ?? input.providerSyncHandoff);
  const clientAcceptance = buildFeatureGateClientAcceptancePackage(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    acceptance: options.acceptance ?? options.featureAcceptance ?? input.acceptance,
    providerService: options.providerService ?? input.providerService,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const actionQueue = buildFeatureGateClientActionQueue(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    acceptance: options.acceptance ?? options.featureAcceptance ?? input.acceptance,
    providerService: options.providerService ?? input.providerService,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const previous = normalizeFeatureGateLaunchPreview(options.previousPreview ?? options.previousFeatureLaunchPreview ?? input.previousPreview);
  const acceptance = normalizeProviderPreviewAcceptance(options.launchAcceptance ?? options.acceptance ?? input.launchAcceptance);
  const requireExplicitAcceptance = options.requireLaunchPreviewAcceptance === true
    || options.requireExplicitAcceptance === true
    || acceptance.requireExplicitAcceptance === true;
  const rows = [
    {
      key: 'feature_acceptance',
      label: 'Feature gate acceptance',
      status: clientAcceptance.status ?? 'blocked',
      required: true,
      accepted: acceptance.acceptedItems.includes('feature_acceptance'),
      clientVisible: true,
      restartSafe: clientAcceptance.restartSafe === true,
      nextStep: clientAcceptance.readiness?.nextAction ?? clientAcceptance.handoff?.nextAction ?? 'review_feature_client_acceptance',
      evidence: {
        awaitingAcceptance: clientAcceptance.validationSummary?.awaitingAcceptance ?? 0,
        deniedEffects: clientAcceptance.validationSummary?.deniedEffects ?? 0,
        blockedRows: clientAcceptance.exportSummary?.blockedRows ?? []
      }
    },
    {
      key: 'client_action_queue',
      label: 'Client action queue',
      status: actionQueue.status ?? 'ready',
      required: true,
      accepted: acceptance.acceptedItems.includes('client_action_queue'),
      clientVisible: (actionQueue.rows ?? []).some((row) => row.clientVisible),
      restartSafe: actionQueue.restartSafe !== false,
      nextStep: actionQueue.exportSummary?.nextAction ?? actionQueue.handoff?.nextAction ?? 'publish_feature_client_actions',
      evidence: {
        actionCount: actionQueue.exportSummary?.actionCount ?? actionQueue.rows?.length ?? 0,
        visibleActionCount: actionQueue.exportSummary?.visibleActionCount ?? 0,
        blockingRows: actionQueue.exportSummary?.blockingRows ?? []
      }
    },
    {
      key: 'provider_sync_handoff',
      label: 'Provider sync handoff',
      status: providerSyncHandoff.status,
      required: providerSyncHandoff.present,
      accepted: acceptance.acceptedItems.includes('provider_sync_handoff'),
      clientVisible: providerSyncHandoff.present && providerSyncHandoff.status !== 'ready',
      restartSafe: providerSyncHandoff.restartSafe,
      nextStep: providerSyncHandoff.nextAction ?? (
        providerSyncHandoff.status === 'ready'
          ? 'include_provider_sync_handoff'
          : 'review_provider_sync_handoff'
      ),
      evidence: {
        fingerprint: providerSyncHandoff.fingerprint,
        blockedRows: providerSyncHandoff.blockedRows,
        degradedRows: providerSyncHandoff.degradedRows,
        syncCursor: providerSyncHandoff.syncCursor
      }
    }
  ].filter((row) => row.required || options.includeOptionalPreviewRows === true);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded' || row.restartSafe === false);
  const awaitingAcceptance = rows.filter((row) => row.required && row.accepted !== true);
  const diagnostics = [
    ...(clientAcceptance.diagnostics ?? []),
    ...(actionQueue.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(providerSyncHandoff.present && providerSyncHandoff.status === 'blocked'
      ? [{ level: 'error', code: 'feature_launch_provider_sync_handoff_blocked', subject: providerSyncHandoff.fingerprint ?? operation }]
      : []),
    ...(requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => ({ level: 'error', code: 'feature_launch_preview_acceptance_missing', subject: row.key }))
      : awaitingAcceptance.map((row) => ({ level: 'warning', code: 'feature_launch_preview_acceptance_pending', subject: row.key })))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = featureGateLaunchPreviewFingerprint({
    operation,
    status,
    rows,
    acceptedItems: acceptance.acceptedItems
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_feature_launch_preview_blockers'
    : status === 'degraded'
      ? 'publish_feature_launch_preview_degraded'
      : changed
        ? 'publish_feature_launch_preview_ready'
        : 'reuse_feature_launch_preview';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_launch_preview',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    preview: {
      rows,
      acceptedItems: acceptance.acceptedItems,
      acceptedAt: acceptance.acceptedAt,
      acceptedBy: acceptance.acceptedBy,
      requireExplicitAcceptance
    },
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      visibleRows: rows.filter((row) => row.clientVisible).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: unique(blockedRows.map((row) => row.key)),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.key),
        ...(!requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-launch-preview',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.feature-launch-preview',
      publish: changed || status !== 'ready' || rows.some((row) => row.clientVisible),
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includePreview: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_launch_preview',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.key).sort(),
      degradedRows: degradedRows.map((row) => row.key).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key).sort(),
      visibleRows: rows.filter((row) => row.clientVisible).map((row) => row.key).sort(),
      nextAction
    },
    diagnostics
  };
}

export function deriveFeatureGateTenantPolicy(input = {}) {
  const normalized = normalizeFeatureGates(input.gates ?? input);
  const scope = normalizeGateScope(input.scope ?? input);
  const operation = clean(input.operation) || 'campaign.sync';
  const requestedEffects = Array.isArray(input.requestedEffects)
    ? input.requestedEffects.map(clean).filter(Boolean)
    : String(input.requestedEffects ?? '').split(',').map(clean).filter(Boolean);
  const externalWriteRequested = requestedEffects.includes('mailchimp.write');
  const workspaceTenantMismatch = scope.requestedTenantId && scope.requestedTenantId !== scope.tenantId;
  const workspaceMismatch = scope.requestedWorkspaceId && scope.requestedWorkspaceId !== scope.workspaceId;
  const role = scope.role || 'campaign_operator';
  const roleAllowsWrite = ['admin', 'workflow_owner'].includes(role);
  const diagnostics = [
    ...(scope.tenantId ? [] : [{ level: 'error', code: 'feature_gate_tenant_missing', subject: operation }]),
    ...(scope.workspaceId ? [] : [{ level: 'error', code: 'feature_gate_workspace_missing', subject: operation }]),
    ...(workspaceTenantMismatch ? [{
      level: 'error',
      code: 'feature_gate_cross_tenant_request_blocked',
      subject: `${scope.requestedTenantId}->${scope.tenantId}`
    }] : []),
    ...(workspaceMismatch ? [{
      level: 'warning',
      code: 'feature_gate_workspace_scope_mismatch',
      subject: `${scope.requestedWorkspaceId}->${scope.workspaceId}`
    }] : []),
    ...(externalWriteRequested && normalized.gates.externalWrite === true && !roleAllowsWrite ? [{
      level: 'error',
      code: 'feature_gate_role_cannot_enable_external_write',
      subject: role || 'missing_role'
    }] : []),
    ...(scope.permissionMode === 'permissive' && normalized.gates.strictClaims !== true ? [{
      level: 'warning',
      code: 'feature_gate_permissive_scope_advisory_claims',
      subject: scope.workspaceId
    }] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    status,
    restartSafe: status === 'ready' && normalized.gates.adapterStatusHandoff === true,
    scope,
    policy: {
      tenantIsolation: workspaceTenantMismatch ? 'blocked' : 'enforced',
      workspaceIsolation: workspaceMismatch ? 'advisory' : 'enforced',
      permissionMode: scope.permissionMode,
      role,
      externalWriteRole: externalWriteRequested ? (roleAllowsWrite ? 'allowed' : 'blocked') : 'not_requested'
    },
    auditHandoff: {
      target: 'kernel.audit.mailchimp.feature-gates',
      subject: `${scope.tenantId}/${scope.workspaceId}/${operation}`,
      includeGateState: true,
      includeRequestedEffects: requestedEffects.length > 0,
      decision: status
    },
    diagnostics
  };
}

export function buildFeatureGateProviderSyncAcceptance(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const launchPreview = options.launchPreview ?? buildFeatureGateLaunchPreviewContract(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    providerSyncHandoff: options.providerSyncHandoff ?? input.providerSyncHandoff,
    acceptance: options.launchAcceptance ?? options.acceptance ?? input.acceptance
  });
  const providerSyncHandoff = normalizeFeatureProviderSyncHandoff(
    options.providerSyncHandoff ?? input.providerSyncHandoff ?? launchPreview.preview?.rows?.find((row) => row.key === 'provider_sync_handoff')?.evidence
  );
  const acceptance = normalizeProviderPreviewAcceptance(options.syncAcceptance ?? options.acceptance ?? input.syncAcceptance);
  const requireExplicitAcceptance = options.requireProviderSyncAcceptance === true
    || options.requireExplicitAcceptance === true
    || acceptance.requireExplicitAcceptance === true;
  const requiredItems = unique([
    'provider_sync_handoff',
    ...normalizeList(options.requiredSyncItems ?? input.requiredSyncItems)
  ]);
  const rows = [
    {
      key: 'provider_sync_handoff',
      label: 'Mailchimp provider sync handoff',
      status: providerSyncHandoff.status,
      required: true,
      accepted: acceptance.acceptedItems.includes('provider_sync_handoff'),
      clientVisible: providerSyncHandoff.present,
      restartSafe: providerSyncHandoff.restartSafe === true,
      nextStep: providerSyncHandoff.nextAction ?? (
        providerSyncHandoff.status === 'ready'
          ? 'include_provider_sync_handoff'
          : 'review_provider_sync_handoff'
      ),
      evidence: {
        fingerprint: providerSyncHandoff.fingerprint,
        syncCursor: providerSyncHandoff.syncCursor,
        blockedRows: providerSyncHandoff.blockedRows,
        degradedRows: providerSyncHandoff.degradedRows
      }
    },
    {
      key: 'sync_launch_preview',
      label: 'Provider sync launch preview',
      status: launchPreview.status ?? 'blocked',
      required: requiredItems.includes('sync_launch_preview'),
      accepted: acceptance.acceptedItems.includes('sync_launch_preview'),
      clientVisible: launchPreview.status !== 'ready',
      restartSafe: launchPreview.restartSafe === true,
      nextStep: launchPreview.readiness?.nextAction ?? launchPreview.handoff?.nextAction ?? 'review_feature_launch_preview',
      evidence: {
        sequence: launchPreview.sequence ?? 0,
        fingerprint: launchPreview.fingerprint ?? null,
        blockedRows: launchPreview.exportSummary?.blockedRows ?? [],
        degradedRows: launchPreview.exportSummary?.degradedRows ?? []
      }
    },
    {
      key: 'kernel_status_route',
      label: 'Kernel status route',
      status: providerSyncHandoff.statusChannel === 'kernel.status.mailchimp' ? 'ready' : 'degraded',
      required: requiredItems.includes('kernel_status_route'),
      accepted: acceptance.acceptedItems.includes('kernel_status_route'),
      clientVisible: providerSyncHandoff.statusChannel !== 'kernel.status.mailchimp',
      restartSafe: providerSyncHandoff.statusChannel === 'kernel.status.mailchimp',
      nextStep: providerSyncHandoff.statusChannel === 'kernel.status.mailchimp'
        ? 'publish_provider_sync_kernel_status'
        : 'route_provider_sync_to_kernel_status',
      evidence: {
        statusChannel: providerSyncHandoff.statusChannel,
        target: providerSyncHandoff.target
      }
    }
  ].filter((row) => row.required || row.clientVisible || options.includeOptionalSyncAcceptanceRows === true);
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded' || row.restartSafe === false);
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true);
  const diagnostics = [
    ...(launchPreview.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(providerSyncHandoff.present
      ? []
      : [{ level: 'warning', code: 'feature_provider_sync_handoff_missing', subject: operation }]),
    ...(providerSyncHandoff.present && providerSyncHandoff.status === 'blocked'
      ? [{ level: 'error', code: 'feature_provider_sync_acceptance_blocked', subject: providerSyncHandoff.fingerprint ?? operation }]
      : []),
    ...(requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => ({ level: 'error', code: 'feature_provider_sync_acceptance_missing', subject: row.key }))
      : awaitingAcceptance.map((row) => ({ level: 'warning', code: 'feature_provider_sync_acceptance_pending', subject: row.key })))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = featureProviderSyncAcceptanceFingerprint({
    operation,
    status,
    rows,
    acceptedItems: acceptance.acceptedItems,
    providerSyncHandoff
  });
  const nextAction = status === 'blocked'
    ? 'resolve_feature_provider_sync_acceptance'
    : status === 'degraded'
      ? 'publish_feature_provider_sync_acceptance_advisory'
      : 'publish_feature_provider_sync_acceptance_ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_provider_sync_acceptance',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    fingerprint,
    rows,
    acceptance: {
      acceptedItems: acceptance.acceptedItems,
      acceptedAt: acceptance.acceptedAt,
      acceptedBy: acceptance.acceptedBy,
      requireExplicitAcceptance
    },
    validationSummary: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.key)),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.key),
        ...(!requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-provider-sync-acceptance',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.feature-provider-sync',
      publish: status !== 'ready' || rows.some((row) => row.clientVisible),
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_provider_sync_acceptance',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      fingerprint,
      acceptedItems: acceptance.acceptedItems,
      blockedRows: blockedRows.map((row) => row.key).sort(),
      degradedRows: degradedRows.map((row) => row.key).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key).sort(),
      syncCursor: providerSyncHandoff.syncCursor,
      nextAction
    },
    diagnostics
  };
}

export function buildFeatureGateBoundaryControlPlan(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const tenantPolicy = deriveFeatureGateTenantPolicy({
    operation,
    requestedEffects,
    gates: snapshot.gates,
    scope: options.scope ?? input.scope ?? options
  });
  const requested = Array.isArray(requestedEffects)
    ? requestedEffects.map(clean).filter(Boolean)
    : String(requestedEffects ?? '').split(',').map(clean).filter(Boolean);
  const operationGate = MAILCHIMP_OPERATION_GATES[operation] ?? { required: [], effects: [] };
  const requiredRows = operationGate.required.map((gate) => ({
    id: `gate:${gate}`,
    gate,
    status: snapshot.gates[gate] === true ? 'ready' : 'blocked',
    required: true,
    tenantScoped: true,
    nextAction: snapshot.gates[gate] === true ? 'include_gate_boundary_evidence' : `enable_${gate}`,
    evidence: {
      enabled: snapshot.gates[gate] === true,
      operation,
      tenantId: tenantPolicy.scope.tenantId,
      workspaceId: tenantPolicy.scope.workspaceId
    }
  }));
  const effectRows = requested.map((effect) => {
    const denied = snapshot.deniedEffects.includes(effect);
    const externalWrite = effect === 'mailchimp.write';
    const roleDecision = externalWrite
      ? tenantPolicy.policy.externalWriteRole
      : 'not_required';
    return {
      id: `effect:${effect}`,
      effect,
      status: denied || roleDecision === 'blocked' ? 'blocked' : 'ready',
      required: externalWrite,
      tenantScoped: effect.startsWith('mailchimp.'),
      nextAction: denied
        ? 'enable_required_effect_gate'
        : roleDecision === 'blocked'
          ? 'escalate_external_write_role'
          : 'include_effect_boundary_evidence',
      evidence: {
        denied,
        externalWrite,
        role: tenantPolicy.policy.role,
        roleDecision
      }
    };
  });
  const scopeRows = [
    {
      id: 'tenant_scope',
      status: tenantPolicy.policy.tenantIsolation === 'blocked' ? 'blocked' : 'ready',
      required: true,
      nextAction: tenantPolicy.policy.tenantIsolation === 'blocked'
        ? 'review_cross_tenant_feature_request'
        : 'include_tenant_scope_evidence',
      evidence: {
        tenantId: tenantPolicy.scope.tenantId,
        requestedTenantId: tenantPolicy.scope.requestedTenantId || tenantPolicy.scope.tenantId
      }
    },
    {
      id: 'workspace_scope',
      status: tenantPolicy.policy.workspaceIsolation === 'advisory' ? 'degraded' : 'ready',
      required: false,
      nextAction: tenantPolicy.policy.workspaceIsolation === 'advisory'
        ? 'publish_workspace_scope_advisory'
        : 'include_workspace_scope_evidence',
      evidence: {
        workspaceId: tenantPolicy.scope.workspaceId,
        requestedWorkspaceId: tenantPolicy.scope.requestedWorkspaceId || tenantPolicy.scope.workspaceId
      }
    }
  ];
  const rows = [...requiredRows, ...effectRows, ...scopeRows];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded');
  const diagnostics = [
    ...snapshot.diagnostics,
    ...tenantPolicy.diagnostics,
    ...blockedRows
      .filter((row) => row.id.startsWith('effect:'))
      .map((row) => ({ level: 'error', code: 'feature_gate_boundary_effect_blocked', subject: row.effect })),
    ...degradedRows.map((row) => ({ level: 'warning', code: 'feature_gate_boundary_degraded', subject: row.id }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    operation,
    status,
    restartSafe: status === 'ready' && snapshot.restartSafe && tenantPolicy.restartSafe,
    scope: tenantPolicy.scope,
    rows,
    blockedRows: blockedRows.map((row) => row.id),
    degradedRows: degradedRows.map((row) => row.id),
    decisions: {
      tenantIsolation: tenantPolicy.policy.tenantIsolation,
      workspaceIsolation: tenantPolicy.policy.workspaceIsolation,
      externalWriteRole: tenantPolicy.policy.externalWriteRole,
      verifierMode: snapshot.policy.verifierMode,
      statusHandoff: snapshot.policy.statusHandoff
    },
    auditHandoff: {
      ...tenantPolicy.auditHandoff,
      target: 'kernel.audit.mailchimp.feature-boundary',
      includeBoundaryRows: true,
      blockedRows: blockedRows.map((row) => row.id),
      degradedRows: degradedRows.map((row) => row.id)
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_boundary_controls',
      operation,
      status,
      restartSafe: status === 'ready' && snapshot.restartSafe,
      tenantId: tenantPolicy.scope.tenantId,
      workspaceId: tenantPolicy.scope.workspaceId,
      blockedRows: blockedRows.map((row) => row.id),
      degradedRows: degradedRows.map((row) => row.id),
      deniedEffects: snapshot.deniedEffects,
      nextAction: status === 'blocked'
        ? 'resolve_feature_gate_boundary_blockers'
        : status === 'degraded'
          ? 'publish_feature_gate_boundary_advisory'
          : 'publish_feature_gate_boundary_ready'
    },
    diagnostics
  };
}

export function buildFeatureGateBoundaryReleaseDecision(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const controls = buildFeatureGateBoundaryControlPlan(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    scope: options.scope ?? input.scope ?? options
  });
  const lifecycle = buildFeatureGateLifecycleReadinessContract(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    featureBoundary: controls,
    readinessSettings: {
      requireProviderPreview: options.requireProviderPreview === true,
      ...(options.readinessSettings && typeof options.readinessSettings === 'object' ? options.readinessSettings : {})
    }
  });
  const releasePolicy = normalizeFeatureBoundaryReleasePolicy(options.releasePolicy ?? input.releasePolicy);
  const deniedEffects = normalizeList(controls.exportSummary?.deniedEffects);
  const externalWriteDenied = deniedEffects.includes('mailchimp.write');
  const hardBlockers = unique([
    ...(controls.blockedRows ?? []),
    ...(lifecycle.readiness?.blockingReasons ?? []),
    ...(externalWriteDenied && releasePolicy.allowDeniedExternalWrite !== true ? ['external_write_denied'] : []),
    ...(releasePolicy.requireKernelStatusHandoff && controls.decisions.statusHandoff !== 'kernel_status_channel'
      ? ['feature_gate_status_handoff']
      : [])
  ]);
  const guardedReasons = unique([
    ...(controls.degradedRows ?? []),
    ...(lifecycle.readiness?.degradedReasons ?? []),
    ...(deniedEffects.length > 0 ? deniedEffects.map((effect) => `denied_effect:${effect}`) : []),
    ...(controls.decisions.verifierMode === 'advisory' ? ['strict_claims_advisory'] : []),
    ...(controls.decisions.workspaceIsolation === 'advisory' ? ['workspace_boundary_advisory'] : [])
  ]);
  const status = hardBlockers.length > 0
    ? 'blocked'
    : guardedReasons.length > 0
      ? 'guarded'
      : 'released';
  const rows = [
    ...controls.rows.map((row) => ({
      id: row.id,
      source: 'feature_boundary_controls',
      status: row.status === 'ready' ? 'released' : row.status === 'degraded' ? 'guarded' : 'blocked',
      required: row.required !== false,
      evidence: row.evidence,
      nextAction: row.status === 'ready' ? 'release_feature_boundary_row' : row.nextAction
    })),
    {
      id: 'lifecycle_readiness',
      source: 'feature_lifecycle',
      status: lifecycle.status === 'ready' ? 'released' : lifecycle.status === 'degraded' ? 'guarded' : 'blocked',
      required: true,
      evidence: lifecycle.validationSummary,
      nextAction: lifecycle.readiness?.nextAction ?? 'resolve_feature_lifecycle_readiness'
    },
    {
      id: 'status_handoff',
      source: 'feature_gate_policy',
      status: controls.decisions.statusHandoff === 'kernel_status_channel' ? 'released' : 'guarded',
      required: releasePolicy.requireKernelStatusHandoff,
      evidence: {
        statusHandoff: controls.decisions.statusHandoff,
        verifierMode: controls.decisions.verifierMode
      },
      nextAction: controls.decisions.statusHandoff === 'kernel_status_channel'
        ? 'release_feature_gate_status_handoff'
        : 'route_feature_gate_status_to_kernel'
    }
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked' && row.required !== false);
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const diagnostics = [
    ...controls.diagnostics,
    ...(lifecycle.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({ level: 'error', code: 'feature_boundary_release_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'feature_boundary_release_guarded', subject: row.id }))
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    operation,
    status,
    restartSafe: status === 'released' && controls.restartSafe === true && lifecycle.restartSafe === true,
    releasePolicy,
    scope: controls.scope,
    rows,
    readiness: {
      blockingReasons: unique([...hardBlockers, ...blockedRows.map((row) => row.id)]),
      guardedReasons: unique([...guardedReasons, ...guardedRows.map((row) => row.id)]),
      nextAction: status === 'blocked'
        ? firstFeatureBoundaryReleaseAction(blockedRows, 'resolve_feature_boundary_release_blockers')
        : status === 'guarded'
          ? firstFeatureBoundaryReleaseAction(guardedRows, 'publish_feature_boundary_release_advisory')
          : 'publish_feature_boundary_release'
    },
    auditHandoff: {
      target: 'kernel.audit.mailchimp.feature-boundary-release',
      subject: `${controls.scope.tenantId}/${controls.scope.workspaceId}/${operation}`,
      decision: status,
      includeRows: status !== 'released',
      includeDeniedEffects: deniedEffects.length > 0
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_boundary_release_decision',
      operation,
      status,
      restartSafe: status === 'released' && controls.restartSafe === true,
      tenantId: controls.scope.tenantId,
      workspaceId: controls.scope.workspaceId,
      deniedEffects,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      nextAction: status === 'released' ? 'publish_feature_boundary_release' : 'review_feature_boundary_release'
    },
    diagnostics
  };
}

export function buildFeatureGateTenantHandoffBoundaryPacket(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const release = buildFeatureGateBoundaryReleaseDecision(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    releasePolicy: options.releasePolicy ?? options.featureBoundaryReleasePolicy
  });
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState
  });
  const previous = normalizeFeatureTenantHandoffBoundary(options.previousPacket ?? options.previousFeatureTenantHandoffBoundary);
  const now = clean(options.now ?? options.timestamp) || null;
  const requiredGateRows = (MAILCHIMP_OPERATION_GATES[operation]?.required ?? []).map((gate) => ({
    id: `required_gate:${gate}`,
    source: 'feature_gate_required_policy',
    status: snapshot.gates[gate] === true ? 'released' : 'blocked',
    required: true,
    nextAction: snapshot.gates[gate] === true ? 'publish_feature_required_gate' : `enable_${gate}`,
    evidence: {
      gate,
      enabled: snapshot.gates[gate] === true,
      operation
    }
  }));
  const rows = [
    {
      id: 'feature_boundary_release',
      source: 'feature_boundary_release',
      status: release.status === 'released' ? 'released' : release.status === 'guarded' ? 'guarded' : 'blocked',
      required: true,
      nextAction: release.readiness?.nextAction ?? release.exportSummary?.nextAction ?? 'review_feature_boundary_release',
      evidence: {
        restartSafe: release.restartSafe === true,
        deniedEffects: release.exportSummary?.deniedEffects ?? [],
        blockedRows: release.exportSummary?.blockedRows ?? [],
        guardedRows: release.exportSummary?.guardedRows ?? []
      }
    },
    ...requiredGateRows,
    {
      id: 'feature_status_handoff',
      source: 'feature_gate_policy',
      status: snapshot.policy.statusHandoff === 'kernel_status_channel' ? 'released' : 'guarded',
      required: true,
      nextAction: snapshot.policy.statusHandoff === 'kernel_status_channel'
        ? 'publish_feature_kernel_status_handoff'
        : 'route_feature_gate_status_to_kernel',
      evidence: {
        statusHandoff: snapshot.policy.statusHandoff,
        verifierMode: snapshot.policy.verifierMode,
        deniedEffects: snapshot.deniedEffects
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked' && row.required !== false);
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'released';
  const fingerprint = featureTenantHandoffBoundaryFingerprint({
    operation,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...release.diagnostics,
    ...snapshot.diagnostics.filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({ level: 'error', code: 'feature_tenant_handoff_boundary_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'feature_tenant_handoff_boundary_guarded', subject: row.id }))
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_tenant_handoff_boundary',
    operation,
    status,
    restartSafe: status === 'released' && release.restartSafe === true && snapshot.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    scope: release.scope,
    rows,
    handoff: {
      target: 'kernel.status.mailchimp.feature-boundary',
      statusChannel: status === 'released' ? 'kernel.status.mailchimp' : 'local.status.feature-boundary',
      publish: changed || status !== 'released',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      nextAction: status === 'blocked'
        ? 'resolve_feature_tenant_handoff_boundary'
        : status === 'guarded'
          ? 'publish_feature_tenant_handoff_guarded'
          : 'publish_feature_tenant_handoff_boundary'
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_tenant_handoff_boundary',
      operation,
      status,
      restartSafe: status === 'released' && release.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      tenantId: release.scope?.tenantId ?? null,
      workspaceId: release.scope?.workspaceId ?? null,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      deniedEffects: snapshot.deniedEffects,
      nextAction: status === 'released' ? 'publish_feature_tenant_handoff_boundary' : 'review_feature_tenant_handoff_boundary'
    },
    diagnostics
  };
}

export function applyFeatureGateCommand(state = {}, command = {}, options = {}) {
  const current = buildFeatureGateStateSnapshot(state.gates ? state : { gates: state }, {
    ...options,
    previousState: state,
    generation: state.generation
  });
  const gate = clean(command.gate);
  const action = clean(command.action).toLowerCase();
  const commandKey = clean(command.commandKey ?? options.commandKey);
  const seenCommands = new Set([...(state.appliedCommandKeys ?? []), ...(options.appliedCommandKeys ?? [])].map(clean).filter(Boolean));
  const diagnostics = [...current.diagnostics];

  if (!gate || !(gate in DEFAULT_FEATURE_GATES)) {
    diagnostics.push({ level: 'error', code: 'unknown_feature_gate_command_target', subject: gate || 'missing_gate' });
  }
  if (!(action in FEATURE_GATE_COMMANDS)) {
    diagnostics.push({ level: 'error', code: 'unsupported_feature_gate_command', subject: action || 'missing_action' });
  }
  if (commandKey && seenCommands.has(commandKey)) {
    return {
      ok: !current.diagnostics.some((item) => item.level === 'error'),
      idempotent: true,
      state: {
        ...current,
        appliedCommandKeys: [...seenCommands].sort()
      },
      diagnostics: [
        ...current.diagnostics,
        { level: 'info', code: 'feature_gate_command_already_applied', subject: commandKey }
      ]
    };
  }
  if (diagnostics.some((item) => item.level === 'error')) {
    return {
      ok: false,
      idempotent: false,
      state: current,
      diagnostics
    };
  }

  const nextGates = { ...current.gates, [gate]: FEATURE_GATE_COMMANDS[action] };
  const next = buildFeatureGateStateSnapshot(nextGates, {
    ...options,
    operation: options.operation ?? state.operation,
    requestedEffects: options.requestedEffects ?? state.requestedEffects,
    previousState: current,
    generation: current.generation,
    commandKey
  });
  return {
    ok: next.ok,
    idempotent: false,
    state: {
      ...next,
      appliedCommandKeys: commandKey ? [...seenCommands, commandKey].sort() : [...seenCommands].sort()
    },
    diagnostics: next.diagnostics
  };
}

function normalizeFeatureBoundaryReleasePolicy(input) {
  const policy = input && typeof input === 'object' ? input : {};
  return {
    requireKernelStatusHandoff: policy.requireKernelStatusHandoff !== false,
    allowDeniedExternalWrite: policy.allowDeniedExternalWrite === true
  };
}

function firstFeatureBoundaryReleaseAction(rows, fallback) {
  return clean(rows[0]?.nextAction) || fallback;
}

export function buildFeatureGateLifecycleCommandPlan(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const commands = normalizeGateCommandList(options.commands ?? input.commands ?? options.command ?? input.command);
  const previous = normalizeGateCommandPlan(options.previousPlan ?? options.previousFeatureGateCommandPlan ?? input.previousPlan);
  const applied = [];
  const rejected = [];
  let state = {
    ...snapshot,
    appliedCommandKeys: [...previous.appliedCommandKeys]
  };

  for (const command of commands) {
    const result = applyFeatureGateCommand(state, command, {
      ...options,
      operation,
      requestedEffects,
      appliedCommandKeys: state.appliedCommandKeys
    });
    const commandKey = clean(command.commandKey);
    const row = {
      gate: clean(command.gate) || 'missing_gate',
      action: clean(command.action).toLowerCase() || 'missing_action',
      commandKey: commandKey || null,
      idempotent: result.idempotent === true,
      ok: result.ok,
      status: result.ok ? (result.idempotent ? 'already_applied' : 'applied') : 'rejected',
      diagnostics: result.diagnostics.filter((item) => item.level === 'error' || item.level === 'warning'),
      nextAction: result.ok
        ? 'publish_feature_gate_command_state'
        : 'repair_feature_gate_command'
    };
    if (result.ok) {
      applied.push(row);
      state = result.state;
    } else {
      rejected.push(row);
    }
  }

  const status = rejected.length > 0 || state.status === 'blocked'
    ? 'blocked'
    : state.status === 'degraded' || applied.some((row) => row.idempotent)
      ? 'degraded'
      : 'ready';
  const counters = {
    commands: commands.length,
    applied: applied.filter((row) => row.idempotent !== true).length,
    idempotent: applied.filter((row) => row.idempotent).length,
    rejected: rejected.length,
    enabled: state.enabled.length,
    disabled: state.disabled.length,
    deniedEffects: state.deniedEffects.length,
    diagnosticErrors: [
      ...state.diagnostics,
      ...rejected.flatMap((row) => row.diagnostics)
    ].filter((item) => item.level === 'error').length,
    diagnosticWarnings: [
      ...state.diagnostics,
      ...applied.flatMap((row) => row.diagnostics),
      ...rejected.flatMap((row) => row.diagnostics)
    ].filter((item) => item.level === 'warning').length
  };
  const fingerprint = gateCommandPlanFingerprint({
    operation,
    status,
    gates: state.gates,
    applied,
    rejected,
    counters
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : commands.length > 0 || state.generation !== snapshot.generation;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(options.now ?? options.timestamp) || null,
    operation,
    status,
    fingerprint,
    applied: counters.applied,
    rejected: counters.rejected,
    deniedEffects: counters.deniedEffects,
    changed
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(options.commandHistoryLimit ?? options.historyLimit, 12));
  const nextAction = status === 'blocked'
    ? 'operator_feature_gate_command_review'
    : status === 'degraded'
      ? 'publish_feature_gate_command_degraded'
      : changed
        ? 'publish_feature_gate_command_delta'
        : 'reuse_feature_gate_command_plan';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_lifecycle_command_plan',
    operation,
    status,
    restartSafe: status === 'ready' && state.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    gates: state.gates,
    appliedCommands: applied,
    rejectedCommands: rejected,
    counters,
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    controls: {
      canEnable: state.disabled,
      canDisable: state.enabled,
      canRetry: status !== 'blocked' && state.recovery.resumeAction !== 'operator_review',
      requiresOperatorReview: status === 'blocked',
      pendingOperatorAction: status === 'blocked'
        ? 'review_feature_gate_lifecycle_commands'
        : state.recovery.pendingOperatorAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-gate-commands',
      statusChannel: state.policy.statusHandoff === 'kernel_status_channel'
        ? 'kernel.status.mailchimp'
        : 'local.status.feature-gates',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeCommands: true,
      includeTimeline: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_lifecycle_command_plan',
      operation,
      status,
      restartSafe: status === 'ready' && state.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      counters,
      rejectedCommands: rejected.map((row) => `${row.gate}:${row.action}`),
      deniedEffects: state.deniedEffects,
      nextAction
    },
    diagnostics: [
      ...state.diagnostics,
      ...applied.flatMap((row) => row.diagnostics),
      ...rejected.flatMap((row) => row.diagnostics)
    ]
  };
}

export function buildFeatureGateLifecycleReadinessContract(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const commandPlan = options.commandPlan ?? options.featureCommandPlan ?? input.commandPlan ?? buildFeatureGateLifecycleCommandPlan(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousPlan: options.previousPlan ?? options.previousFeatureGateCommandPlan ?? input.previousPlan,
    commands: options.commands ?? options.featureGateCommands ?? input.commands
  });
  const boundary = normalizeLifecyclePeer(options.featureBoundary ?? options.boundaryControls ?? input.featureBoundary, {
    id: 'feature_boundary',
    status: snapshot.tenantPolicy?.tenantIsolation === 'blocked' ? 'blocked' : snapshot.status,
    restartSafe: snapshot.restartSafe,
    nextAction: snapshot.recovery.pendingOperatorAction ?? snapshot.recovery.resumeAction
  });
  const profileLifecycle = normalizeLifecyclePeer(options.profileLifecycle ?? input.profileLifecycle, {
    id: 'profile_lifecycle',
    status: 'enabled',
    restartSafe: true,
    nextAction: 'include_profile_lifecycle'
  });
  const importLifecycle = normalizeLifecyclePeer(options.importLifecycle ?? input.importLifecycle, {
    id: 'import_lifecycle',
    status: 'enabled',
    restartSafe: true,
    nextAction: 'include_import_lifecycle'
  });
  const importGateLifecycle = normalizeLifecyclePeer(options.importGateLifecycle ?? input.importGateLifecycle, {
    id: 'import_gate_lifecycle',
    status: 'ready',
    restartSafe: true,
    nextAction: 'include_import_gate_lifecycle'
  });
  const providerPreview = normalizeLifecyclePeer(options.providerPreview ?? options.providerGatePreview ?? input.providerPreview, {
    id: 'provider_preview',
    status: 'ready',
    restartSafe: true,
    nextAction: 'include_provider_preview'
  });
  const previous = normalizeFeatureLifecycleReadiness(options.previousReadiness ?? options.previousFeatureLifecycleReadiness ?? input.previousReadiness);
  const requiredGates = MAILCHIMP_OPERATION_GATES[operation]?.required ?? [];
  const settings = normalizeFeatureLifecycleReadinessSettings(options.readinessSettings ?? input.readinessSettings ?? options);
  const gateRows = requiredGates.map((gate) => {
    const enabled = snapshot.gates[gate] === true;
    return {
      id: `required_gate:${gate}`,
      component: 'feature_gates',
      status: enabled ? 'ready' : 'blocked',
      required: true,
      restartSafe: enabled && snapshot.restartSafe,
      nextAction: enabled ? 'include_required_feature_gate' : `enable_feature_gate:${gate}`,
      evidence: {
        gate,
        enabled,
        operation
      }
    };
  });
  const peerRows = [
    lifecyclePeerRow('feature_boundary', boundary, {
      required: true,
      blockedStatuses: ['blocked', 'operator_review'],
      degradedStatuses: ['degraded', 'recovering'],
      fallbackAction: 'include_feature_boundary_controls'
    }),
    lifecyclePeerRow('feature_commands', normalizeLifecyclePeer(commandPlan, {
      id: 'feature_commands',
      status: commandPlan.status ?? 'ready',
      restartSafe: commandPlan.restartSafe !== false,
      nextAction: commandPlan.exportSummary?.nextAction ?? commandPlan.handoff?.nextAction ?? 'include_feature_command_plan'
    }), {
      required: settings.requireCommandPlan,
      blockedStatuses: ['blocked'],
      degradedStatuses: ['degraded'],
      fallbackAction: 'include_feature_command_plan'
    }),
    lifecyclePeerRow('profile_lifecycle', profileLifecycle, {
      required: true,
      blockedStatuses: ['blocked', 'disabled', 'paused', 'operator_review'],
      degradedStatuses: ['retry_scheduled', 'enabled_degraded', 'status_acknowledged'],
      fallbackAction: 'include_profile_lifecycle'
    }),
    lifecyclePeerRow('import_lifecycle', importLifecycle, {
      required: true,
      blockedStatuses: ['blocked', 'disabled', 'paused'],
      degradedStatuses: ['retry_scheduled', 'enabled_degraded'],
      fallbackAction: 'include_import_lifecycle'
    }),
    lifecyclePeerRow('import_gate_lifecycle', importGateLifecycle, {
      required: settings.requireImportGateAlignment,
      blockedStatuses: ['blocked'],
      degradedStatuses: ['degraded'],
      fallbackAction: 'include_import_gate_lifecycle'
    }),
    lifecyclePeerRow('provider_preview', providerPreview, {
      required: settings.requireProviderPreview,
      blockedStatuses: ['blocked'],
      degradedStatuses: ['degraded'],
      fallbackAction: 'include_provider_preview'
    })
  ];
  const effectRows = snapshot.deniedEffects.map((effect) => ({
    id: `denied_effect:${effect}`,
    component: 'requested_effects',
    status: 'blocked',
    required: true,
    restartSafe: false,
    nextAction: effect === 'mailchimp.write'
      ? 'enable_external_write_gate_or_remove_effect'
      : 'remove_denied_feature_effect',
    evidence: {
      effect,
      requestedEffects: normalizeList(requestedEffects)
    }
  }));
  const rows = [...gateRows, ...effectRows, ...peerRows];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const degradedRows = requiredRows.filter((row) => row.status === 'degraded');
  const disabledControls = requiredRows.filter((row) => (
    row.component.endsWith('lifecycle')
    && ['disabled', 'paused'].includes(clean(row.evidence?.rawStatus))
  ));
  const scheduleRows = [
    profileLifecycle,
    importLifecycle,
    importGateLifecycle
  ].filter((peer) => peer.schedule?.nextRetry || peer.status === 'retry_scheduled');
  const commandRejected = toNonNegativeInteger(commandPlan.counters?.rejected, 0);
  const commandDeniedEffects = toNonNegativeInteger(commandPlan.counters?.deniedEffects, snapshot.deniedEffects.length);
  const diagnostics = [
    ...snapshot.diagnostics,
    ...(commandPlan.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'feature_lifecycle_readiness_blocked',
      subject: row.id
    })),
    ...degradedRows.map((row) => ({
      level: 'warning',
      code: 'feature_lifecycle_readiness_degraded',
      subject: row.id
    })),
    ...(settings.requireCommandPlan && commandRejected > 0
      ? [{
        level: 'error',
        code: 'feature_lifecycle_readiness_command_rejected',
        subject: String(commandRejected)
      }]
      : []),
    ...(settings.allowDeniedEffects === true || commandDeniedEffects === 0
      ? []
      : [{
        level: 'error',
        code: 'feature_lifecycle_readiness_denied_effects',
        subject: String(commandDeniedEffects)
      }])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = featureLifecycleReadinessFingerprint({
    operation,
    status,
    rows,
    gateFingerprint: snapshot.fingerprint,
    commandFingerprint: commandPlan.fingerprint,
    schedules: scheduleRows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_feature_lifecycle_readiness_blockers'
    : disabledControls.length > 0
      ? 'enable_lifecycle_controls'
      : scheduleRows.length > 0
        ? 'dispatch_scheduled_lifecycle_retries'
        : status === 'degraded'
          ? 'publish_feature_lifecycle_readiness_advisory'
          : changed
            ? 'publish_feature_lifecycle_readiness_delta'
            : 'reuse_feature_lifecycle_readiness';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_lifecycle_readiness',
    operation,
    status,
    restartSafe: status === 'ready'
      && snapshot.restartSafe === true
      && commandPlan.restartSafe !== false
      && requiredRows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    settings,
    rows,
    controls: {
      canEnableProfile: profileLifecycle.controls?.canEnable === true,
      canEnableImports: importLifecycle.controls?.canEnable === true,
      canRetryFeatureCommands: commandPlan.controls?.canRetry === true,
      canResumeImports: importLifecycle.controls?.canResume === true || importGateLifecycle.controls?.canResumeAll === true,
      requiresOperatorReview: status === 'blocked',
      automaticRetriesPending: scheduleRows.length
    },
    schedule: {
      mode: scheduleRows.length > 0 ? 'scheduled_retry' : settings.scheduleMode,
      pending: scheduleRows.map((peer) => ({
        component: peer.id,
        status: peer.status,
        nextRetry: peer.schedule?.nextRetry ?? null,
        nextAction: peer.nextAction
      }))
    },
    validationSummary: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      disabledControls: disabledControls.length,
      deniedEffects: snapshot.deniedEffects.length,
      rejectedCommands: commandRejected,
      pendingSchedules: scheduleRows.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.id),
        ...snapshot.deniedEffects.map((effect) => `denied:${effect}`)
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.id),
        ...scheduleRows.map((peer) => `scheduled:${peer.id}`)
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-lifecycle-readiness',
      statusChannel: snapshot.policy.statusHandoff === 'kernel_status_channel'
        ? 'kernel.status.mailchimp'
        : 'local.status.feature-lifecycle',
      publish: changed || status !== 'ready' || scheduleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeControls: status !== 'ready' || disabledControls.length > 0,
      includeSchedule: scheduleRows.length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_lifecycle_readiness',
      operation,
      status,
      restartSafe: status === 'ready' && snapshot.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id),
      degradedRows: degradedRows.map((row) => row.id),
      disabledControls: disabledControls.map((row) => row.id),
      deniedEffects: snapshot.deniedEffects,
      rejectedCommands: commandRejected,
      pendingSchedules: scheduleRows.map((peer) => peer.id),
      nextAction
    },
    diagnostics
  };
}

export function buildFeatureGateReleaseEvidencePack(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const analytics = buildFeatureGateAnalyticsReport(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousAnalytics: options.previousAnalytics ?? options.previousGateAnalytics ?? input.previousAnalytics,
    now: options.now ?? options.timestamp
  });
  const commandPlan = options.commandPlan ?? options.featureCommandPlan ?? input.commandPlan ?? buildFeatureGateLifecycleCommandPlan(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousPlan: options.previousPlan ?? options.previousFeatureGateCommandPlan ?? input.previousPlan,
    commands: options.commands ?? options.featureGateCommands ?? input.commands
  });
  const lifecycleReadiness = options.lifecycleReadiness ?? options.featureLifecycleReadiness ?? input.lifecycleReadiness ?? buildFeatureGateLifecycleReadinessContract(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    commandPlan
  });
  const previous = normalizeFeatureGateReleaseEvidence(options.previousEvidencePack ?? options.previousFeatureGateReleaseEvidence ?? input.previousEvidencePack);
  const now = clean(options.now ?? options.timestamp) || null;
  const requiredGates = MAILCHIMP_OPERATION_GATES[operation]?.required ?? [];
  const rows = [
    ...requiredGates.map((gate) => ({
      id: `gate:${gate}`,
      source: 'feature_gate',
      subject: gate,
      status: snapshot.gates[gate] === true ? 'ready' : 'blocked',
      required: true,
      restartSafe: snapshot.restartSafe && snapshot.gates[gate] === true,
      publish: snapshot.gates[gate] !== true || analytics.changedGates.some((row) => row.gate === gate),
      nextAction: snapshot.gates[gate] === true ? 'include_required_gate_evidence' : `enable_feature_gate:${gate}`,
      evidence: {
        enabled: snapshot.gates[gate] === true,
        changed: analytics.changedGates.some((row) => row.gate === gate),
        operation
      }
    })),
    ...snapshot.deniedEffects.map((effect) => ({
      id: `effect:${effect}`,
      source: 'requested_effect',
      subject: effect,
      status: 'blocked',
      required: true,
      restartSafe: false,
      publish: true,
      nextAction: effect === 'mailchimp.write'
        ? 'enable_external_write_gate_or_remove_effect'
        : 'remove_denied_feature_effect',
      evidence: {
        effect,
        requestedEffects: normalizeList(requestedEffects),
        policy: snapshot.policy
      }
    })),
    {
      id: 'analytics:delta',
      source: 'feature_analytics',
      subject: analytics.exportSummary?.fingerprint ?? snapshot.fingerprint,
      status: analytics.report?.riskLevel === 'high' ? 'blocked' : analytics.report?.riskLevel === 'medium' ? 'guarded' : 'ready',
      required: false,
      restartSafe: analytics.exportSummary?.restartSafe === true,
      publish: analytics.changedGates.length > 0 || analytics.counters?.deniedEffects > 0,
      nextAction: analytics.exportSummary?.nextAction ?? 'include_feature_gate_analytics',
      evidence: {
        counters: analytics.counters,
        changedGates: analytics.changedGates,
        riskLevel: analytics.report?.riskLevel ?? 'low'
      }
    },
    {
      id: 'command:plan',
      source: 'feature_commands',
      subject: commandPlan.fingerprint ?? commandPlan.exportSummary?.fingerprint ?? 'feature_commands',
      status: commandPlan.status === 'blocked' ? 'blocked' : commandPlan.status === 'degraded' ? 'guarded' : 'ready',
      required: options.requireCommandPlan !== false,
      restartSafe: commandPlan.restartSafe !== false,
      publish: commandPlan.changed === true || commandPlan.status !== 'ready',
      nextAction: commandPlan.exportSummary?.nextAction ?? commandPlan.handoff?.nextAction ?? 'include_feature_gate_command_plan',
      evidence: {
        sequence: commandPlan.sequence ?? commandPlan.exportSummary?.sequence ?? 0,
        applied: commandPlan.counters?.applied ?? 0,
        rejected: commandPlan.counters?.rejected ?? 0
      }
    },
    {
      id: 'lifecycle:readiness',
      source: 'feature_lifecycle',
      subject: lifecycleReadiness.fingerprint ?? lifecycleReadiness.exportSummary?.fingerprint ?? 'feature_lifecycle',
      status: lifecycleReadiness.status === 'blocked' ? 'blocked' : lifecycleReadiness.status === 'degraded' ? 'guarded' : 'ready',
      required: true,
      restartSafe: lifecycleReadiness.restartSafe === true,
      publish: lifecycleReadiness.changed === true || lifecycleReadiness.status !== 'ready',
      nextAction: lifecycleReadiness.readiness?.nextAction ?? lifecycleReadiness.handoff?.nextAction ?? 'include_feature_lifecycle_readiness',
      evidence: {
        blockingReasons: lifecycleReadiness.readiness?.blockingReasons ?? [],
        degradedReasons: lifecycleReadiness.readiness?.degradedReasons ?? [],
        validationSummary: lifecycleReadiness.validationSummary ?? {}
      }
    }
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const guardedRows = requiredRows.filter((row) => row.status === 'guarded');
  const publishRows = rows.filter((row) => row.publish);
  const diagnostics = [
    ...snapshot.diagnostics,
    ...(commandPlan.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(lifecycleReadiness.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'feature_release_evidence_blocked',
      subject: row.id
    })),
    ...guardedRows.map((row) => ({
      level: 'warning',
      code: 'feature_release_evidence_guarded',
      subject: row.id
    }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = featureGateReleaseEvidenceFingerprint({
    operation,
    status,
    rows,
    snapshot,
    commandPlan,
    lifecycleReadiness
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_feature_gate_release_evidence_blockers'
    : status === 'guarded'
      ? 'publish_feature_gate_release_evidence_guarded'
      : changed
        ? 'publish_feature_gate_release_evidence'
        : 'reuse_feature_gate_release_evidence';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_release_evidence',
    operation,
    status,
    restartSafe: status === 'ready' && snapshot.restartSafe && commandPlan.restartSafe !== false && lifecycleReadiness.restartSafe === true,
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
      publishRows: publishRows.length,
      deniedEffects: snapshot.deniedEffects.length,
      changedGates: analytics.changedGates.length,
      rejectedCommands: commandPlan.counters?.rejected ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.id)),
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
          operation,
          status,
          fingerprint,
          blocked: blockedRows.length,
          guarded: guardedRows.length,
          publishRows: publishRows.length
        }] : [])
      ].slice(-toPositiveInteger(options.evidenceHistoryLimit ?? options.historyLimit, 12))
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-gates.release-evidence',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.feature-gates',
      publish: changed || status !== 'ready' || publishRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: publishRows.length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_release_evidence',
      operation,
      status,
      restartSafe: status === 'ready' && snapshot.restartSafe && commandPlan.restartSafe !== false && lifecycleReadiness.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      publishRows: publishRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildFeatureGateOperationalControlPacket(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState
  });
  const recovery = deriveFeatureGateRecovery({
    operation,
    requestedEffects,
    gates: snapshot.gates
  });
  const checkpoint = buildFeatureGateRuntimeCheckpoint(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousCheckpoint: options.previousCheckpoint ?? options.previousFeatureGateRuntimeCheckpoint,
    checkpointAcceptance: options.checkpointAcceptance ?? options.featureGateControlAcceptance
  });
  const attempt = toNonNegativeInteger(options.attempt ?? options.gateAttempt ?? input.attempt, 0);
  const maxAttempts = toPositiveInteger(options.maxAttempts ?? options.maxGateAttempts ?? input.maxAttempts, 3);
  const baseBackoffMs = toPositiveInteger(options.baseBackoffMs ?? input.baseBackoffMs, 750);
  const maxBackoffMs = toPositiveInteger(options.maxBackoffMs ?? input.maxBackoffMs, 12000);
  const retryable = snapshot.status !== 'blocked' && checkpoint.status !== 'blocked' && recovery.status !== 'ready';
  const exhausted = retryable && attempt >= maxAttempts;
  const rows = [
    {
      id: 'gate_policy',
      status: snapshot.status === 'blocked' ? 'blocked' : snapshot.status === 'degraded' ? 'guarded' : 'ready',
      required: true,
      restartSafe: snapshot.restartSafe === true,
      nextAction: snapshot.recovery?.pendingOperatorAction ?? snapshot.recovery?.resumeAction,
      evidence: {
        fingerprint: snapshot.fingerprint,
        deniedEffects: snapshot.deniedEffects ?? [],
        disabledRequiredGates: (MAILCHIMP_OPERATION_GATES[operation]?.required ?? []).filter((gate) => snapshot.gates[gate] !== true)
      }
    },
    {
      id: 'runtime_checkpoint',
      status: checkpoint.status === 'blocked' ? 'blocked' : checkpoint.status === 'guarded' ? 'guarded' : 'ready',
      required: true,
      restartSafe: checkpoint.restartSafe === true,
      nextAction: checkpoint.readiness?.nextAction ?? checkpoint.handoff?.nextAction,
      evidence: {
        fingerprint: checkpoint.fingerprint,
        blockedRows: checkpoint.exportSummary?.blockedRows ?? [],
        guardedRows: checkpoint.exportSummary?.guardedRows ?? []
      }
    },
    {
      id: 'recovery_budget',
      status: exhausted ? 'blocked' : retryable ? 'guarded' : 'ready',
      required: true,
      restartSafe: exhausted !== true,
      nextAction: exhausted ? 'operator_feature_gate_retry_review' : retryable ? 'schedule_feature_gate_recovery_retry' : 'retain_feature_gate_recovery_ready',
      evidence: {
        attempt,
        maxAttempts,
        nextRetry: retryable && !exhausted ? {
          attempt: attempt + 1,
          maxAttempts,
          delayMs: Math.min(maxBackoffMs, baseBackoffMs * (2 ** attempt)),
          reason: recovery.resumeAction
        } : null
      }
    },
    {
      id: 'status_handoff',
      status: snapshot.policy?.statusHandoff === 'kernel_status_channel' ? 'ready' : 'guarded',
      required: true,
      restartSafe: snapshot.policy?.statusHandoff === 'kernel_status_channel',
      nextAction: snapshot.policy?.statusHandoff === 'kernel_status_channel'
        ? 'publish_feature_gate_status_to_kernel'
        : 'route_feature_gate_status_to_kernel',
      evidence: {
        statusHandoff: snapshot.policy?.statusHandoff ?? 'local_only',
        auditSubject: snapshot.auditHandoff?.subject ?? null
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.required && row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const diagnostics = [
    ...snapshot.diagnostics,
    ...checkpoint.diagnostics.filter((item) => item.level === 'error' || options.includeFeatureGateControlWarnings === true),
    ...blockedRows.map((row) => ({ level: 'error', code: 'feature_gate_operational_control_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'feature_gate_operational_control_guarded', subject: row.id })),
    ...(exhausted ? [{ level: 'error', code: 'feature_gate_retry_budget_exhausted', subject: String(maxAttempts) }] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = [
    'feature_gate_operational_control',
    operation,
    status,
    snapshot.fingerprint,
    checkpoint.fingerprint,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.nextAction,
      ...(row.evidence.deniedEffects ?? []),
      ...(row.evidence.disabledRequiredGates ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
  const nextAction = status === 'blocked'
    ? 'resolve_feature_gate_operational_controls'
    : status === 'guarded'
      ? 'publish_feature_gate_operational_controls_guarded'
      : 'publish_feature_gate_operational_controls_ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_operational_controls',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    fingerprint,
    rows,
    validationSummary: {
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      deniedEffects: snapshot.deniedEffects.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length,
      retryable: retryable ? 1 : 0,
      exhausted: exhausted ? 1 : 0
    },
    recovery: {
      status: recovery.status,
      resumeAction: recovery.resumeAction,
      nextRetry: rows.find((row) => row.id === 'recovery_budget')?.evidence?.nextRetry ?? null
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-gate-controls',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.feature-gate-controls',
      publish: status !== 'ready' || checkpoint.changed === true,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_operational_controls',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      fingerprint,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      nextAction
    },
    diagnostics
  };
}

export function buildFeatureGateKernelHandoffManifest(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const contract = evaluateFeatureGateContract({
    operation,
    requestedEffects,
    gates: snapshot.gates
  });
  const requiredGates = MAILCHIMP_OPERATION_GATES[operation]?.required ?? [];
  const requiredRows = requiredGates.map((gate) => ({
    id: `gate:${gate}`,
    kind: 'required_gate',
    gate,
    status: snapshot.gates[gate] === true ? 'ready' : 'blocked',
    restartSafe: snapshot.gates[gate] === true,
    statusChannel: snapshot.policy.statusHandoff === 'kernel_status_channel'
      ? 'kernel.status.mailchimp'
      : 'local.status.feature-gates',
    nextAction: snapshot.gates[gate] === true
      ? 'include_required_gate_evidence'
      : 'enable_required_feature_gate',
    evidence: {
      operation,
      enabled: snapshot.gates[gate] === true,
      requiredForOperation: true
    }
  }));
  const deniedRows = snapshot.deniedEffects.map((effect) => ({
    id: `effect:${effect}`,
    kind: 'denied_effect',
    effect,
    status: 'blocked',
    restartSafe: false,
    statusChannel: 'kernel.status.mailchimp',
    nextAction: effect === 'mailchimp.write'
      ? 'enable_external_write_gate_with_rollback'
      : 'remove_denied_effect_from_module',
    evidence: {
      operation,
      requestedEffects: normalizeList(requestedEffects),
      rollbackRequired: snapshot.policy.rollbackRequired
    }
  }));
  const policyRows = [
    {
      id: 'policy:strictClaims',
      kind: 'verifier_policy',
      status: snapshot.policy.verifierMode === 'strict' ? 'ready' : 'degraded',
      restartSafe: true,
      statusChannel: 'kernel.status.mailchimp',
      nextAction: snapshot.policy.verifierMode === 'strict'
        ? 'include_strict_claim_policy'
        : 'publish_advisory_claim_policy',
      evidence: {
        verifierMode: snapshot.policy.verifierMode,
        gateEnabled: snapshot.gates.strictClaims === true
      }
    },
    {
      id: 'policy:adapterStatusHandoff',
      kind: 'status_policy',
      status: snapshot.policy.statusHandoff === 'kernel_status_channel' ? 'ready' : 'degraded',
      restartSafe: snapshot.policy.statusHandoff === 'kernel_status_channel',
      statusChannel: snapshot.policy.statusHandoff === 'kernel_status_channel'
        ? 'kernel.status.mailchimp'
        : 'local.status.feature-gates',
      nextAction: snapshot.policy.statusHandoff === 'kernel_status_channel'
        ? 'publish_feature_gate_kernel_status'
        : 'route_feature_gate_status_to_kernel',
      evidence: {
        statusHandoff: snapshot.policy.statusHandoff,
        gateEnabled: snapshot.gates.adapterStatusHandoff === true
      }
    }
  ];
  const rows = [...requiredRows, ...deniedRows, ...policyRows].sort((left, right) => left.id.localeCompare(right.id));
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded');
  const diagnostics = [
    ...snapshot.diagnostics,
    ...contract.diagnostics.filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => ({
      level: 'error',
      code: 'feature_gate_kernel_handoff_blocked',
      subject: row.id
    })),
    ...degradedRows.map((row) => ({
      level: 'warning',
      code: 'feature_gate_kernel_handoff_degraded',
      subject: row.id
    }))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const restartSafe = status === 'ready'
    && snapshot.restartSafe === true
    && rows.every((row) => row.restartSafe !== false);

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    operation,
    status,
    restartSafe,
    generation: snapshot.generation,
    fingerprint: snapshot.fingerprint,
    statusChannel: snapshot.policy.statusHandoff === 'kernel_status_channel'
      ? 'kernel.status.mailchimp'
      : 'local.status.feature-gates',
    rows,
    summary: {
      requiredGates,
      deniedEffects: snapshot.deniedEffects,
      blockedRows: blockedRows.map((row) => row.id),
      degradedRows: degradedRows.map((row) => row.id),
      verifierMode: snapshot.policy.verifierMode,
      rollbackRequired: snapshot.policy.rollbackRequired
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-gate-manifest',
      statusChannel: snapshot.policy.statusHandoff === 'kernel_status_channel'
        ? 'kernel.status.mailchimp'
        : 'local.status.feature-gates',
      publish: status !== 'ready' || snapshot.deniedEffects.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      nextAction: status === 'blocked'
        ? 'resolve_feature_gate_kernel_manifest_blockers'
        : status === 'degraded'
          ? 'publish_feature_gate_kernel_manifest_advisory'
          : 'publish_feature_gate_kernel_manifest_ready'
    },
    diagnostics
  };
}

export function buildFeatureGateOperationalLedger(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const analytics = buildFeatureGateAnalyticsReport(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousAnalytics: options.previousAnalytics ?? options.previousGateAnalytics ?? input.previousAnalytics,
    now: options.now ?? options.timestamp
  });
  const publication = buildFeatureGatePublicationTimeline(analytics, {
    ...options,
    previousPublication: options.previousPublication ?? options.previousFeatureGatePublication ?? input.previousPublication,
    now: options.now ?? options.timestamp
  });
  const manifest = buildFeatureGateKernelHandoffManifest(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const previous = normalizeFeatureOperationalLedger(options.previousLedger ?? options.previousFeatureGateOperationalLedger ?? input.previousLedger);
  const now = clean(options.now ?? options.timestamp) || null;
  const rows = [
    featureOperationalLedgerRow('analytics', analytics, true, {
      status: analytics.exportSummary?.status,
      restartSafe: analytics.exportSummary?.restartSafe,
      nextAction: analytics.exportSummary?.nextAction,
      diagnosticCount: (analytics.diagnostics ?? []).length,
      evidence: {
        riskLevel: analytics.exportSummary?.riskLevel,
        deniedEffects: analytics.exportSummary?.deniedEffects ?? [],
        changedGateCount: analytics.exportSummary?.changedGateCount ?? 0,
        requiredDisabled: analytics.exportSummary?.requiredDisabled ?? 0,
        fingerprint: analytics.exportSummary?.fingerprint
      }
    }),
    featureOperationalLedgerRow('publication', publication, true, {
      status: publication.status,
      restartSafe: publication.restartSafe,
      nextAction: publication.exportSummary?.nextAction ?? publication.publication?.nextAction,
      diagnosticCount: (publication.diagnostics ?? []).length,
      evidence: {
        changed: publication.changed === true,
        stale: publication.stale === true,
        publishRows: publication.exportSummary?.publishRows ?? [],
        statusChannel: publication.publication?.statusChannel,
        fingerprint: publication.fingerprint
      }
    }),
    featureOperationalLedgerRow('kernel_manifest', manifest, true, {
      status: manifest.status,
      restartSafe: manifest.restartSafe,
      nextAction: manifest.handoff?.nextAction,
      diagnosticCount: (manifest.diagnostics ?? []).length,
      evidence: {
        requiredGates: manifest.summary?.requiredGates ?? [],
        deniedEffects: manifest.summary?.deniedEffects ?? [],
        blockedRows: manifest.summary?.blockedRows ?? [],
        degradedRows: manifest.summary?.degradedRows ?? [],
        statusChannel: manifest.statusChannel,
        fingerprint: manifest.fingerprint
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded' || row.status === 'guarded');
  const diagnostics = [
    ...(analytics.diagnostics ?? []),
    ...(publication.diagnostics ?? []),
    ...(manifest.diagnostics ?? [])
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : degradedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';
  const fingerprint = featureOperationalLedgerFingerprint({
    operation,
    status,
    rows,
    analytics,
    publication,
    manifest
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_feature_gate_operational_ledger_blockers'
    : status === 'degraded'
      ? 'publish_feature_gate_operational_ledger_degraded'
      : changed
        ? 'publish_feature_gate_operational_ledger'
        : 'reuse_feature_gate_operational_ledger';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_operational_ledger',
    operation,
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
      deniedEffects: analytics.counters?.deniedEffects ?? manifest.summary?.deniedEffects?.length ?? 0,
      changedGates: analytics.counters?.changed ?? 0,
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
          operation,
          status,
          fingerprint,
          blockedRows: blockedRows.map((row) => row.id),
          degradedRows: degradedRows.map((row) => row.id)
        }] : [])
      ].slice(-toPositiveInteger(options.ledgerHistoryLimit ?? options.historyLimit, 12))
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-gate-operational-ledger',
      statusChannel: rows.every((row) => row.evidence?.statusChannel !== 'local.status.feature-gates')
        ? 'kernel.status.mailchimp'
        : 'local.status.feature-gates',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_operational_ledger',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      degradedRows: degradedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildFeatureGateLaunchReadinessLedger(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const operationalLedger = options.operationalLedger ?? input.operationalLedger ?? buildFeatureGateOperationalLedger(gatesInput, {
    ...options,
    operation,
    requestedEffects
  });
  const launchPreview = options.launchPreview ?? input.launchPreview ?? buildFeatureGateLaunchPreviewContract(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    acceptance: options.acceptance ?? input.acceptance,
    launchAcceptance: options.launchAcceptance ?? input.launchAcceptance
  });
  const nextStepDigest = options.nextStepDigest ?? input.nextStepDigest ?? buildFeatureGateClientNextStepDigest(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    launchPreview,
    acceptance: options.acceptance ?? input.acceptance,
    launchAcceptance: options.launchAcceptance ?? input.launchAcceptance
  });
  const previous = normalizeFeatureGateLaunchReadinessLedger(options.previousLedger ?? options.previousFeatureLaunchReadinessLedger ?? input.previousLedger);
  const now = clean(options.now ?? options.timestamp) || null;
  const rows = [
    featureLaunchReadinessRow('feature_operational_ledger', operationalLedger, true, {
      source: 'feature_gates',
      status: operationalLedger.status,
      restartSafe: operationalLedger.restartSafe,
      clientVisible: operationalLedger.status !== 'ready' || (operationalLedger.counters?.changedGates ?? 0) > 0,
      fingerprint: operationalLedger.fingerprint ?? operationalLedger.exportSummary?.fingerprint,
      nextAction: operationalLedger.readiness?.nextAction ?? operationalLedger.handoff?.nextAction ?? operationalLedger.exportSummary?.nextAction,
      evidence: {
        blockedRows: operationalLedger.exportSummary?.blockedRows ?? [],
        guardedRows: operationalLedger.exportSummary?.degradedRows ?? [],
        changed: operationalLedger.changed === true
      }
    }),
    featureLaunchReadinessRow('feature_launch_preview', launchPreview, true, {
      source: 'feature_gates',
      status: launchPreview.status,
      restartSafe: launchPreview.restartSafe,
      clientVisible: launchPreview.status !== 'ready' || (launchPreview.validationSummary?.awaitingAcceptance ?? 0) > 0,
      fingerprint: launchPreview.fingerprint ?? launchPreview.exportSummary?.fingerprint,
      nextAction: launchPreview.readiness?.nextAction ?? launchPreview.handoff?.nextAction ?? launchPreview.exportSummary?.nextAction,
      evidence: {
        blockedRows: launchPreview.exportSummary?.blockedRows ?? [],
        guardedRows: launchPreview.exportSummary?.guardedRows ?? [],
        awaitingAcceptance: launchPreview.validationSummary?.awaitingAcceptance ?? 0
      }
    }),
    featureLaunchReadinessRow('feature_next_steps', nextStepDigest, false, {
      source: 'feature_gates',
      status: nextStepDigest.status,
      restartSafe: nextStepDigest.restartSafe,
      clientVisible: nextStepDigest.status !== 'ready' || (nextStepDigest.exportSummary?.clientVisibleRows ?? []).length > 0,
      fingerprint: nextStepDigest.fingerprint ?? nextStepDigest.exportSummary?.fingerprint,
      nextAction: nextStepDigest.readiness?.nextAction ?? nextStepDigest.handoff?.nextAction ?? nextStepDigest.exportSummary?.nextAction,
      evidence: {
        clientVisibleRows: nextStepDigest.exportSummary?.clientVisibleRows ?? [],
        blockedRows: nextStepDigest.exportSummary?.blockedRows ?? [],
        guardedRows: nextStepDigest.exportSummary?.guardedRows ?? []
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const diagnostics = [
    ...(operationalLedger.diagnostics ?? []),
    ...(launchPreview.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(nextStepDigest.diagnostics ?? []).filter((item) => item.level === 'error')
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = [
    operation,
    status,
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
    ? 'resolve_feature_launch_readiness_blockers'
    : status === 'guarded'
      ? 'publish_feature_launch_readiness_guarded'
      : changed
        ? 'publish_feature_launch_readiness_ready'
        : 'reuse_feature_launch_readiness';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_launch_readiness_ledger',
    operation,
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
          operation,
          status,
          fingerprint,
          blockedRows: blockedRows.map((row) => row.id).sort(),
          guardedRows: guardedRows.map((row) => row.id).sort()
        }] : [])
      ].slice(-toPositiveInteger(options.featureLaunchReadinessHistoryLimit ?? options.historyLimit, 12))
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-launch-readiness',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.feature-launch-readiness',
      publish: changed || status !== 'ready' || rows.some((row) => row.clientVisible),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_launch_readiness_ledger',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      clientVisibleRows: rows.filter((row) => row.clientVisible).map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildFeatureGateProviderHandoffState(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const snapshot = buildFeatureGateStateSnapshot(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState ?? input.previousState,
    generation: options.generation ?? options.gateGeneration ?? input.generation
  });
  const providerPreview = buildFeatureGateProviderPreviewAcceptance(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousGateState: options.previousState ?? options.previousGateState,
    providerService: options.providerService ?? input.providerService,
    acceptance: options.providerPreviewAcceptance ?? options.acceptance,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const readiness = buildFeatureGateLifecycleReadinessContract(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState,
    previousReadiness: options.previousReadiness ?? options.previousFeatureLifecycleReadiness
  });
  const manifest = buildFeatureGateKernelHandoffManifest(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState,
    generation: options.generation ?? options.gateGeneration
  });
  const rows = [
    featureProviderHandoffRow('gate_policy', snapshot, true, {
      status: snapshot.status,
      restartSafe: snapshot.restartSafe,
      nextAction: snapshot.recovery?.pendingOperatorAction ?? snapshot.recovery?.resumeAction,
      evidence: {
        deniedEffects: snapshot.deniedEffects,
        enabled: snapshot.enabled,
        disabled: snapshot.disabled,
        verifierMode: snapshot.policy?.verifierMode,
        fingerprint: snapshot.fingerprint
      }
    }),
    featureProviderHandoffRow('provider_preview', providerPreview, true, {
      status: providerPreview.status,
      restartSafe: providerPreview.restartSafe,
      nextAction: providerPreview.readiness?.nextAction ?? providerPreview.exportSummary?.nextAction,
      evidence: {
        missingCapabilities: providerPreview.exportSummary?.missingCapabilities ?? [],
        awaitingAcceptance: providerPreview.exportSummary?.awaitingAcceptance ?? [],
        externalHandoff: providerPreview.exportSummary?.externalHandoff ?? null
      }
    }),
    featureProviderHandoffRow('lifecycle_readiness', readiness, true, {
      status: readiness.status,
      restartSafe: readiness.restartSafe,
      nextAction: readiness.readiness?.nextAction ?? readiness.exportSummary?.nextAction,
      evidence: {
        blockedRows: readiness.exportSummary?.blockedRows ?? [],
        guardedRows: readiness.exportSummary?.guardedRows ?? [],
        schedules: readiness.schedules ?? [],
        fingerprint: readiness.fingerprint ?? readiness.exportSummary?.fingerprint
      }
    }),
    featureProviderHandoffRow('kernel_manifest', manifest, true, {
      status: manifest.status,
      restartSafe: manifest.restartSafe,
      nextAction: manifest.handoff?.nextAction,
      evidence: {
        requiredGates: manifest.summary?.requiredGates ?? [],
        deniedEffects: manifest.summary?.deniedEffects ?? [],
        statusChannel: manifest.statusChannel,
        fingerprint: manifest.fingerprint
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.status === 'degraded');
  const diagnostics = [
    ...(snapshot.diagnostics ?? []),
    ...(providerPreview.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(readiness.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(manifest.diagnostics ?? []).filter((item) => item.level === 'error')
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_feature_provider_handoff_blockers'
    : status === 'guarded'
      ? 'publish_feature_provider_handoff_guarded'
      : 'publish_feature_provider_handoff_ready';
  const fingerprint = featureProviderHandoffFingerprint({
    operation,
    status,
    rows,
    snapshotFingerprint: snapshot.fingerprint
  });

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_provider_handoff',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    fingerprint,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      deniedEffects: snapshot.deniedEffects.length,
      missingCapabilities: providerPreview.exportSummary?.missingCapabilities?.length ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    handoff: {
      target: 'kernel.status.mailchimp.feature-provider-handoff',
      statusChannel: status === 'ready' && snapshot.policy?.statusHandoff === 'kernel_status_channel'
        ? 'kernel.status.mailchimp'
        : 'local.status.feature-provider-handoff',
      publish: status !== 'ready' || snapshot.deniedEffects.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_provider_handoff',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      fingerprint,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      deniedEffects: snapshot.deniedEffects,
      nextAction
    },
    diagnostics
  };
}

export function buildFeatureGateProviderControlPacket(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const handoff = buildFeatureGateProviderHandoffState(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState,
    previousReadiness: options.previousReadiness ?? options.previousFeatureLifecycleReadiness,
    providerPreviewAcceptance: options.providerPreviewAcceptance ?? options.acceptance
  });
  const preview = buildFeatureGateProviderPreviewAcceptance(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousGateState: options.previousState ?? options.previousGateState,
    providerService: options.providerService ?? input.providerService,
    acceptance: options.providerPreviewAcceptance ?? options.acceptance,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const syncAcceptance = buildFeatureGateProviderSyncAcceptance(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousState: options.previousState ?? options.previousGateState,
    providerSyncHandoff: options.providerSyncHandoff ?? input.providerSyncHandoff,
    acceptance: options.providerSyncAcceptance ?? options.acceptance,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? input.requiredProviderCapabilities
  });
  const rows = dedupeFeatureProviderControlRows([
    ...featureProviderControlRowsFromHandoff(handoff),
    featureProviderControlRow('provider_preview_acceptance', preview, {
      source: 'provider_preview',
      clientVisible: preview.status !== 'ready' || preview.validationSummary?.awaitingAcceptance > 0,
      accepted: preview.validationSummary?.awaitingAcceptance === 0,
      nextAction: preview.readiness?.nextAction ?? preview.exportSummary?.nextAction,
      evidence: {
        missingCapabilities: preview.exportSummary?.missingCapabilities ?? [],
        awaitingAcceptance: preview.exportSummary?.awaitingAcceptance ?? [],
        externalHandoff: preview.exportSummary?.externalHandoff ?? null
      }
    }),
    featureProviderControlRow('provider_sync_acceptance', syncAcceptance, {
      source: 'provider_sync',
      clientVisible: syncAcceptance.status !== 'ready' || syncAcceptance.validationSummary?.awaitingAcceptance > 0,
      accepted: syncAcceptance.validationSummary?.awaitingAcceptance === 0,
      nextAction: syncAcceptance.readiness?.nextAction ?? syncAcceptance.exportSummary?.nextAction,
      evidence: {
        missingCapabilities: syncAcceptance.exportSummary?.missingCapabilities ?? [],
        pendingAcceptance: syncAcceptance.exportSummary?.pendingAcceptance ?? [],
        degradedRows: syncAcceptance.exportSummary?.degradedRows ?? []
      }
    })
  ]);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const visibleRows = rows.filter((row) => row.clientVisible);
  const diagnostics = [
    ...(handoff.diagnostics ?? []),
    ...(preview.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(syncAcceptance.diagnostics ?? []).filter((item) => item.level === 'error')
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = featureProviderControlPacketFingerprint({
    operation,
    status,
    rows,
    handoff,
    preview,
    syncAcceptance
  });
  const nextAction = status === 'blocked'
    ? 'resolve_feature_provider_control_blockers'
    : status === 'guarded'
      ? 'publish_feature_provider_control_guarded'
      : 'publish_feature_provider_control_ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_provider_controls',
    operation,
    status,
    restartSafe: status === 'ready' && handoff.restartSafe === true && preview.restartSafe === true && syncAcceptance.restartSafe !== false,
    fingerprint,
    rows,
    validationSummary: {
      totalRows: rows.length,
      visibleRows: visibleRows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: rows.filter((row) => row.required && row.accepted !== true).length,
      deniedEffects: handoff.exportSummary?.deniedEffects?.length ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    handoff: {
      target: 'mailchimp.client.workflow.feature-provider-controls',
      statusChannel: handoff.handoff?.statusChannel ?? 'kernel.status.mailchimp',
      publish: status !== 'ready' || visibleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: visibleRows.length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_provider_controls',
      operation,
      status,
      restartSafe: status === 'ready' && handoff.restartSafe === true && preview.restartSafe === true,
      fingerprint,
      visibleRows: visibleRows.map((row) => row.id).sort(),
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      deniedEffects: handoff.exportSummary?.deniedEffects ?? [],
      nextAction
    },
    diagnostics
  };
}

export function selfCheckFeatureGates() {
  return evaluateFeatureGateContract({
    operation: 'campaign.sync',
    requestedEffects: ['mailchimp.read'],
    gates: 'gate mailchimpRead=on\ngate campaignPlanning=on'
  });
}

function featureProviderControlRowsFromHandoff(handoff = {}) {
  return (handoff.rows ?? []).map((row) => featureProviderControlRow(`handoff:${row.id}`, row, {
    source: 'feature_provider_handoff',
    clientVisible: row.status !== 'ready' || row.publish === true,
    accepted: row.status === 'ready',
    nextAction: row.nextAction,
    evidence: row.evidence
  }));
}

function featureProviderControlRow(id, source = {}, fallback = {}) {
  const rawStatus = clean(source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || source.restartSafe === false
      ? 'guarded'
      : 'ready';
  return {
    id: clean(id),
    source: clean(fallback.source) || 'feature_provider',
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

function dedupeFeatureProviderControlRows(rows = []) {
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
      featureProviderControlStatusRank(right.status) - featureProviderControlStatusRank(left.status)
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function featureProviderControlStatusRank(status) {
  if (status === 'blocked') return 3;
  if (status === 'guarded') return 2;
  return 1;
}

function featureProviderControlPacketFingerprint({
  operation,
  status,
  rows,
  handoff,
  preview,
  syncAcceptance
}) {
  return [
    'feature_provider_controls',
    operation,
    status,
    handoff.fingerprint ?? handoff.exportSummary?.fingerprint ?? '',
    preview.fingerprint ?? preview.exportSummary?.fingerprint ?? '',
    syncAcceptance.fingerprint ?? syncAcceptance.exportSummary?.fingerprint ?? '',
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

export function buildFeatureGateClientPreviewRouteContract(input = {}, options = {}) {
  const gatesInput = input.gates ?? input;
  const operation = clean(options.operation ?? input.operation) || 'campaign.sync';
  const requestedEffects = options.requestedEffects ?? input.requestedEffects ?? [];
  const readiness = buildFeatureGateClientReadinessContract(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousReadiness: options.previousReadiness ?? options.previousFeatureClientReadiness,
    acceptance: options.acceptance ?? options.featureClientAcceptance
  });
  const actionQueue = buildFeatureGateClientActionQueue(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousQueue: options.previousQueue ?? options.previousFeatureClientActionQueue,
    acceptance: options.acceptance ?? options.featureClientAcceptance
  });
  const launchPreview = buildFeatureGateLaunchPreviewContract(gatesInput, {
    ...options,
    operation,
    requestedEffects,
    previousPreview: options.previousLaunchPreview ?? options.previousFeatureLaunchPreview,
    acceptance: options.launchPreviewAcceptance ?? options.acceptance
  });
  const previous = normalizeFeatureGateClientPreviewRoute(options.previousRoute ?? options.previousFeatureClientPreviewRoute);
  const rows = dedupeFeatureGateClientPreviewRouteRows([
    featureGateClientPreviewRouteRow('feature_readiness', readiness, true, {
      visible: readiness.status !== 'ready' || readiness.validationSummary?.visibleRows > 0,
      nextAction: readiness.readiness?.nextAction ?? readiness.exportSummary?.nextAction,
      evidence: {
        blockedRows: readiness.exportSummary?.blockedRows ?? [],
        guardedRows: readiness.exportSummary?.guardedRows ?? [],
        deniedEffects: readiness.exportSummary?.deniedEffects ?? []
      }
    }),
    featureGateClientPreviewRouteRow('feature_actions', actionQueue, true, {
      status: actionQueue.status,
      visible: (actionQueue.actions ?? actionQueue.rows ?? []).some((row) => row.clientVisible === true || row.required === true),
      nextAction: actionQueue.exportSummary?.nextAction ?? actionQueue.handoff?.nextAction,
      evidence: {
        requiredActions: (actionQueue.actions ?? actionQueue.rows ?? []).filter((row) => row.required === true).map((row) => row.id),
        visibleActions: (actionQueue.actions ?? actionQueue.rows ?? []).filter((row) => row.clientVisible === true).map((row) => row.id)
      }
    }),
    featureGateClientPreviewRouteRow('feature_launch_preview', launchPreview, true, {
      visible: launchPreview.status !== 'ready' || (launchPreview.exportSummary?.awaitingAcceptance ?? []).length > 0,
      nextAction: launchPreview.readiness?.nextAction ?? launchPreview.exportSummary?.nextAction,
      awaitingAcceptance: launchPreview.exportSummary?.awaitingAcceptance,
      evidence: {
        previewRows: (launchPreview.preview?.rows ?? launchPreview.rows ?? []).map((row) => row.id ?? row.key).filter(Boolean),
        validationSummary: launchPreview.validationSummary ?? {}
      }
    })
  ]);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0 ? 'blocked' : guardedRows.length > 0 ? 'guarded' : 'ready';
  const fingerprint = featureGateClientPreviewRouteFingerprint({ operation, status, rows });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(readiness.diagnostics ?? []),
    ...(actionQueue.diagnostics ?? []),
    ...(launchPreview.diagnostics ?? []),
    ...blockedRows.map((row) => ({ level: 'error', code: 'feature_gate_client_preview_route_blocked', subject: row.id })),
    ...guardedRows.map((row) => ({ level: 'warning', code: 'feature_gate_client_preview_route_guarded', subject: row.id }))
  ];
  const nextAction = blockedRows[0]?.nextAction
    ?? guardedRows[0]?.nextAction
    ?? (changed ? 'publish_feature_gate_client_preview_route' : 'reuse_feature_gate_client_preview_route');

  return {
    ok: status !== 'blocked',
    schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
    title: 'mailchimp_feature_gate_client_preview_route',
    operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      visibleRows: rows.filter((row) => row.visibleToClient).length,
      awaitingAcceptance: rows.reduce((count, row) => count + row.awaitingAcceptance.length, 0),
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: blockedRows.map((row) => row.id),
      guardedReasons: guardedRows.map((row) => row.id),
      nextAction
    },
    handoff: {
      target: 'client.preview.mailchimp.feature-gates',
      statusChannel: status === 'ready' ? 'kernel.status.mailchimp' : 'local.status.feature-preview',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: rows.some((row) => row.visibleToClient),
      nextAction
    },
    exportSummary: {
      schemaVersion: FEATURE_GATES_SCHEMA_VERSION,
      title: 'mailchimp_feature_gate_client_preview_route',
      operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      visibleRows: rows.filter((row) => row.visibleToClient).map((row) => row.id),
      awaitingAcceptance: unique(rows.flatMap((row) => row.awaitingAcceptance)),
      nextAction
    },
    diagnostics
  };
}

function normalizeFeatureGateClientPreviewRoute(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function featureGateClientPreviewRouteRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' || rawStatus === 'awaiting_acceptance' ? 'guarded' : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && status !== 'ready';
  const awaitingAcceptance = normalizeList(fallback.awaitingAcceptance ?? source.exportSummary?.awaitingAcceptance);
  return {
    id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required: required === true,
    restartSafe: blocked !== true && guarded !== true && source.restartSafe !== false,
    visibleToClient: fallback.visible === true || blocked || guarded || awaitingAcceptance.length > 0,
    fingerprint: clean(source.fingerprint ?? source.exportSummary?.fingerprint),
    awaitingAcceptance,
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (blocked ? `resolve_${id}` : guarded ? `review_${id}` : `publish_${id}`),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function dedupeFeatureGateClientPreviewRouteRows(rows = []) {
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
      featureClientNextStepStatusRank(right.status) - featureClientNextStepStatusRank(left.status)
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function featureGateClientPreviewRouteFingerprint({ operation, status, rows }) {
  return [
    'feature_gate_client_preview_route',
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.visibleToClient ? 'visible' : 'hidden',
      row.fingerprint,
      row.nextAction,
      ...row.awaitingAcceptance
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function objectGateInput(input) {
  return input?.gates ? input : { gates: input, diagnostics: [] };
}

function knownGateEntries(input) {
  return Object.entries(input ?? {}).reduce((known, [key, value]) => {
    if (key in DEFAULT_FEATURE_GATES) known[key] = coerceBoolean(value);
    return known;
  }, {});
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['true', 'on', '1', 'yes'].includes(String(value ?? '').toLowerCase());
}

function normalizePreviousState(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeFeatureGateAnalytics(input) {
  const analytics = input && typeof input === 'object' ? input : {};
  const gates = analytics.gates && typeof analytics.gates === 'object'
    ? analytics.gates
    : analytics.snapshot?.gates && typeof analytics.snapshot.gates === 'object'
      ? analytics.snapshot.gates
      : {};
  const history = analytics.history && typeof analytics.history === 'object' ? analytics.history : analytics;
  return {
    sequence: toNonNegativeInteger(history.sequence, 0),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : [],
    gates
  };
}

function normalizeFeatureGatePublication(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    reportFingerprint: clean(value.reportFingerprint ?? value.exportSummary?.reportFingerprint),
    ageMs: toNonNegativeInteger(value.ageMs ?? value.publicationAgeMs, 0),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline
      : Array.isArray(value.timeline)
        ? value.timeline
        : []
  };
}

function normalizeFeatureOperationalLedger(input = {}) {
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

function normalizeFeatureGateLaunchReadinessLedger(input = {}) {
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

function featureLaunchReadinessRow(id, source, required, fallback = {}) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' || rawStatus === 'paused' || rawStatus === 'disabled'
    ? 'guarded'
    : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && status !== 'ready';
  return {
    id,
    source: clean(fallback.source) || 'feature_gates',
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

function featureProviderHandoffRow(id, source, required, fallback) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' ? 'guarded' : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && (status === 'guarded' || status === 'paused' || status === 'disabled');
  return {
    id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required,
    restartSafe: fallback.restartSafe !== false && blocked !== true,
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_feature_${id}` : guarded ? `publish_feature_${id}_guarded` : `publish_feature_${id}`
    ),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function featureProviderHandoffFingerprint({
  operation,
  status,
  rows,
  snapshotFingerprint
}) {
  return [
    operation,
    status,
    snapshotFingerprint,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.evidence?.fingerprint ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function featureOperationalLedgerRow(id, source, required, fallback) {
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
      blocked ? `resolve_feature_${id}` : degraded ? `publish_feature_${id}_advisory` : `publish_feature_${id}`
    ),
    diagnostics: toNonNegativeInteger(fallback.diagnosticCount, 0),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function featureOperationalLedgerFingerprint({
  operation,
  status,
  rows,
  analytics,
  publication,
  manifest
}) {
  return [
    operation,
    status,
    analytics.exportSummary?.fingerprint ?? '',
    publication.fingerprint ?? publication.exportSummary?.fingerprint ?? '',
    manifest.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.nextAction,
      row.evidence?.fingerprint ?? ''
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function featureGatePublicationFingerprint({
  operation,
  status,
  reportFingerprint,
  rows,
  stale
}) {
  return [
    operation,
    status,
    reportFingerprint,
    stale ? 'stale' : 'fresh',
    ...rows.map((row) => [
      row.gate,
      row.enabled ? 'enabled' : 'disabled',
      row.changed ? 'changed' : 'stable',
      row.requiredForOperation ? 'required' : 'optional',
      row.publish ? 'publish' : 'silent',
      row.blocksEffect ?? ''
    ].map(clean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeProviderPreview(input) {
  const provider = input?.contract && typeof input.contract === 'object' ? input.contract : input;
  const value = provider && typeof provider === 'object' ? provider : {};
  const statusChannel = clean(value.externalState?.statusChannel ?? value.statusChannel) || 'kernel.status.mailchimp';
  const explicitlyReady = value.externalState?.ready;
  return {
    provider: clean(value.provider) || 'mailchimp',
    service: clean(value.service) || 'marketing-api',
    status: clean(value.status) || 'ready',
    capabilities: {
      required: normalizeList(value.capabilities?.required ?? value.requiredCapabilities),
      offered: normalizeList(value.capabilities?.offered ?? value.offeredCapabilities)
    },
    externalState: {
      target: clean(value.externalState?.target ?? value.target) || 'kernel.provider.mailchimp',
      statusChannel,
      ready: explicitlyReady === false ? false : explicitlyReady === true || statusChannel === 'kernel.status.mailchimp',
      restartSafe: value.externalState?.restartSafe === true
    }
  };
}

function normalizeProviderPreviewAcceptance(input) {
  const acceptance = input && typeof input === 'object' ? input : {};
  return {
    acceptedItems: normalizeList(acceptance.acceptedItems ?? acceptance.accepted),
    acceptedAt: clean(acceptance.acceptedAt ?? acceptance.timestamp) || null,
    acceptedBy: clean(acceptance.acceptedBy ?? acceptance.operator) || null,
    requireExplicitAcceptance: acceptance.requireExplicitAcceptance === true
  };
}

function normalizeFeatureProviderSyncHandoff(input) {
  const value = input && typeof input === 'object' ? input : {};
  const summary = value.exportSummary ?? {};
  return {
    present: Boolean(value.schemaVersion || value.status || summary.status),
    status: clean(value.status ?? summary.status) || 'ready',
    restartSafe: value.restartSafe === true || summary.restartSafe === true,
    fingerprint: clean(value.fingerprint ?? summary.fingerprint) || null,
    blockedRows: Array.isArray(summary.blockedRows) ? summary.blockedRows.map(clean).filter(Boolean) : [],
    degradedRows: Array.isArray(summary.degradedRows) ? summary.degradedRows.map(clean).filter(Boolean) : [],
    syncCursor: clean(summary.syncCursor ?? value.sync?.cursor) || null,
    statusChannel: clean(value.handoff?.statusChannel ?? summary.statusChannel) || null,
    target: clean(value.handoff?.target ?? summary.target) || null,
    nextAction: clean(value.readiness?.nextAction ?? value.handoff?.nextAction ?? summary.nextAction) || null
  };
}

function normalizeFeatureGateLaunchPreview(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function featureGateLaunchPreviewFingerprint({
  operation,
  status,
  rows,
  acceptedItems
}) {
  return [
    operation,
    status,
    ...acceptedItems.map((item) => `accepted:${item}`).sort(),
    ...rows.map((row) => [
      row.key,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.clientVisible ? 'visible' : 'hidden',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.evidence?.fingerprint ?? '',
      row.nextStep ?? ''
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function featureProviderSyncAcceptanceFingerprint({
  operation,
  status,
  rows,
  acceptedItems,
  providerSyncHandoff
}) {
  return [
    operation,
    status,
    providerSyncHandoff.fingerprint ?? '',
    providerSyncHandoff.syncCursor ?? '',
    providerSyncHandoff.statusChannel ?? '',
    ...acceptedItems.map((item) => `accepted:${item}`).sort(),
    ...rows.map((row) => [
      row.key,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.evidence?.fingerprint ?? row.evidence?.statusChannel ?? '',
      row.nextStep ?? ''
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeGateCommandList(input) {
  const values = Array.isArray(input) ? input : input && typeof input === 'object' ? [input] : [];
  return values.map((item) => (item && typeof item === 'object' ? item : {}));
}

function normalizeGateCommandPlan(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    sequence: toNonNegativeInteger(value.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : [],
    appliedCommandKeys: normalizeList(value.appliedCommandKeys ?? value.commandKeys)
  };
}

function normalizeFeatureLifecycleReadiness(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeFeatureLifecycleReadinessSettings(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    scheduleMode: clean(value.scheduleMode) || 'immediate',
    requireCommandPlan: value.requireCommandPlan !== false,
    requireImportGateAlignment: value.requireImportGateAlignment !== false,
    requireProviderPreview: value.requireProviderPreview === true,
    allowDeniedEffects: value.allowDeniedEffects === true
  };
}

function normalizeFeatureTenantHandoffBoundary(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function featureTenantHandoffBoundaryFingerprint({
  operation,
  status,
  rows
}) {
  return [
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.evidence?.gate ?? '',
      row.evidence?.statusHandoff ?? '',
      normalizeList(row.evidence?.deniedEffects).join(',')
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeLifecyclePeer(input, fallback) {
  const value = input && typeof input === 'object' ? input : {};
  const summary = value.exportSummary && typeof value.exportSummary === 'object' ? value.exportSummary : {};
  const readiness = value.readiness && typeof value.readiness === 'object' ? value.readiness : {};
  return {
    id: clean(fallback.id),
    status: clean(value.status ?? summary.status ?? fallback.status) || 'ready',
    restartSafe: value.restartSafe === false || summary.restartSafe === false ? false : fallback.restartSafe !== false,
    nextAction: clean(readiness.nextAction ?? value.nextAction ?? value.handoff?.nextAction ?? summary.nextAction ?? fallback.nextAction) || null,
    controls: value.controls && typeof value.controls === 'object' ? value.controls : {},
    schedule: value.schedule && typeof value.schedule === 'object' ? value.schedule : {},
    validationSummary: value.validationSummary && typeof value.validationSummary === 'object' ? value.validationSummary : {},
    exportSummary: summary
  };
}

function lifecyclePeerRow(component, peer, {
  required,
  blockedStatuses,
  degradedStatuses,
  fallbackAction
}) {
  const rawStatus = clean(peer.status) || 'ready';
  const blocked = blockedStatuses.includes(rawStatus) || peer.restartSafe === false && required === true;
  const degraded = !blocked && (degradedStatuses.includes(rawStatus) || peer.restartSafe === false);
  return {
    id: component,
    component,
    status: blocked ? 'blocked' : degraded ? 'degraded' : 'ready',
    required,
    restartSafe: peer.restartSafe !== false && blocked !== true,
    nextAction: blocked
      ? peer.nextAction || `resolve_${component}`
      : degraded
        ? peer.nextAction || `publish_${component}_advisory`
        : peer.nextAction || fallbackAction,
    evidence: {
      rawStatus,
      restartSafe: peer.restartSafe,
      controls: peer.controls,
      schedule: peer.schedule,
      validationSummary: peer.validationSummary,
      exportSummary: peer.exportSummary
    }
  };
}

function featureLifecycleReadinessFingerprint({
  operation,
  status,
  rows,
  gateFingerprint: gateStateFingerprint,
  commandFingerprint,
  schedules
}) {
  return [
    operation,
    status,
    gateStateFingerprint,
    commandFingerprint,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe === false ? 'guarded' : 'safe',
      row.nextAction
    ].map(clean).join(':')).sort(),
    ...schedules.map((peer) => [
      'schedule',
      peer.id,
      peer.status,
      peer.schedule?.nextRetry?.attempt ?? '',
      peer.nextAction
    ].map(clean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeFeatureGateReleaseEvidence(input = {}) {
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

function featureGateReleaseEvidenceFingerprint({
  operation,
  status,
  rows,
  snapshot,
  commandPlan,
  lifecycleReadiness
}) {
  return [
    operation,
    status,
    snapshot.fingerprint,
    commandPlan.fingerprint ?? commandPlan.exportSummary?.fingerprint ?? '',
    lifecycleReadiness.fingerprint ?? lifecycleReadiness.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.publish ? 'publish' : 'hold',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function gateCommandPlanFingerprint({
  operation,
  status,
  gates,
  applied,
  rejected,
  counters
}) {
  return [
    operation,
    status,
    gateFingerprint(gates),
    `applied:${toNonNegativeInteger(counters.applied, 0)}`,
    `rejected:${toNonNegativeInteger(counters.rejected, 0)}`,
    ...applied.map((row) => [
      'applied',
      row.gate,
      row.action,
      row.commandKey ?? '',
      row.idempotent ? 'idempotent' : 'new'
    ].map(clean).join(':')).sort(),
    ...rejected.map((row) => [
      'rejected',
      row.gate,
      row.action,
      row.commandKey ?? '',
      row.diagnostics.map((item) => item.code).sort().join(',')
    ].map(clean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function dedupeFeatureClientActions(rows) {
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

function dedupeFeatureClientReadinessRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const normalized = {
      ...row,
      id: clean(row.id),
      source: clean(row.source),
      status: clean(row.status) || 'ready',
      clientVisible: row.clientVisible === true,
      restartSafe: row.restartSafe === true,
      nextAction: clean(row.nextAction) || null,
      evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
    };
    const key = [normalized.id, normalized.source, normalized.nextAction].map(clean).join('|');
    if (!normalized.id || seen.has(key)) return false;
    seen.add(key);
    Object.assign(row, normalized);
    return true;
  }).sort((left, right) => (
    featureClientActionStatusRank(right.status) - featureClientActionStatusRank(left.status)
    || left.source.localeCompare(right.source)
    || left.id.localeCompare(right.id)
  ));
}

function normalizeFeatureGateClientReadiness(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function featureGateClientReadinessFingerprint({
  operation,
  status,
  snapshot,
  acceptance,
  actionQueue,
  rows
}) {
  return [
    operation,
    status,
    snapshot.fingerprint ?? '',
    acceptance.exportSummary?.status ?? acceptance.status ?? '',
    actionQueue.fingerprint ?? actionQueue.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.source,
      row.status,
      row.clientVisible ? 'visible' : 'hidden',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function dedupeFeatureClientNextStepRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const normalized = {
      ...row,
      key: clean(row.key),
      source: clean(row.source),
      status: clean(row.status) || 'ready',
      clientVisible: row.clientVisible === true,
      accepted: row.accepted === true,
      required: row.required === true,
      nextAction: clean(row.nextAction) || null,
      evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
    };
    const key = [normalized.key, normalized.source, normalized.nextAction].map(clean).join('|');
    if (!normalized.key || seen.has(key)) return false;
    seen.add(key);
    Object.assign(row, normalized);
    return true;
  }).sort((left, right) => (
    featureClientNextStepStatusRank(right.status) - featureClientNextStepStatusRank(left.status)
    || left.source.localeCompare(right.source)
    || left.key.localeCompare(right.key)
  ));
}

function featureClientNextStepStatusRank(status) {
  if (status === 'blocked') return 3;
  if (status === 'guarded' || status === 'degraded') return 2;
  return 1;
}

function featureClientActionQueueFingerprint({
  operation,
  status,
  rows,
  handoff,
  acceptance
}) {
  return [
    operation,
    status,
    handoff.exportSummary?.fingerprint ?? handoff.fingerprint ?? '',
    acceptance.exportSummary?.status ?? acceptance.status ?? '',
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

function featureClientActionRank(severity) {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

function featureClientActionStatusRank(status) {
  if (status === 'blocked') return 4;
  if (status === 'guarded' || status === 'degraded') return 3;
  if (status === 'awaiting_acceptance') return 2;
  return 1;
}

function normalizeFeatureGateRuntimeCheckpoint(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeFeatureGateAnalyticsPublication(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function featureGateAnalyticsPublicationFingerprint({
  operation,
  status,
  rows,
  counters
}) {
  return [
    'feature_gate_analytics_publication',
    operation,
    status,
    `changed:${counters.changed}`,
    `denied:${counters.deniedEffects}`,
    ...rows.map((row) => [
      row.gate,
      row.status,
      row.enabled ? 'enabled' : 'disabled',
      row.changed ? 'changed' : 'unchanged',
      row.requiredForOperation ? 'required' : 'optional',
      row.blocksEffect ?? '',
      row.publish ? 'publish' : 'silent',
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeFeatureGateRuntimeCheckpointAcceptance(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    requireExplicitAcceptance: value.requireExplicitAcceptance === true,
    acceptedRows: unique(normalizeList(value.acceptedRows ?? value.acceptedItems ?? value.rows))
  };
}

function normalizeProviderLaunchContract(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const summary = value.exportSummary && typeof value.exportSummary === 'object' ? value.exportSummary : {};
  return {
    status: clean(value.status ?? summary.status) || 'ready',
    restartSafe: value.restartSafe !== false && summary.restartSafe !== false,
    sequence: toNonNegativeInteger(value.sequence ?? summary.sequence, 0),
    fingerprint: clean(value.fingerprint ?? summary.fingerprint),
    blockedRows: normalizeList(summary.blockedRows ?? value.blockedRows),
    guardedRows: normalizeList(summary.guardedRows ?? value.guardedRows),
    checkpointKeys: normalizeList(summary.checkpointKeys ?? value.persistedState?.checkpointKeys),
    diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics : []
  };
}

function providerLaunchAcceptanceRow(key, source = {}, required, fallback = {}) {
  const rawStatus = clean(source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || source.restartSafe === false
      ? 'guarded'
      : 'ready';
  return {
    key,
    label: clean(fallback.label) || key,
    required: required === true,
    accepted: fallback.accepted === true,
    status,
    restartSafe: status === 'ready' && source.restartSafe !== false && source.exportSummary?.restartSafe !== false,
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (status === 'blocked' ? `resolve_${key}` : status === 'guarded' ? `review_${key}` : `publish_${key}`),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function providerLaunchAcceptanceFingerprint({
  operation,
  status,
  rows,
  snapshot,
  profileLaunch,
  importLaunch
}) {
  return [
    'provider_launch_acceptance',
    operation,
    status,
    snapshot.fingerprint ?? '',
    profileLaunch.fingerprint ?? '',
    importLaunch.fingerprint ?? '',
    ...rows.map((row) => [
      row.key,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.nextAction,
      ...(row.evidence?.blockedRows ?? []),
      ...(row.evidence?.guardedRows ?? []),
      ...(row.evidence?.checkpointKeys ?? []),
      ...(row.evidence?.deniedEffects ?? []),
      ...(row.evidence?.disabledRequiredGates ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function featureGateRuntimeCheckpointRow(id, row = {}) {
  const rawStatus = clean(row.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || rawStatus === 'paused' || rawStatus === 'disabled' || row.restartSafe === false
      ? 'guarded'
      : 'ready';
  return {
    id,
    status,
    restartSafe: status === 'ready' && row.restartSafe !== false,
    clientVisible: row.clientVisible === true || status !== 'ready',
    nextAction: clean(row.nextAction) || (
      status === 'blocked' ? `resolve_${id}` : status === 'guarded' ? `review_${id}` : `publish_${id}`
    ),
    evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
  };
}

function dedupeFeatureGateRuntimeCheckpointRows(rows = []) {
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
      featureClientNextStepStatusRank(right.status) - featureClientNextStepStatusRank(left.status)
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function featureGateRuntimeCheckpointFingerprint({
  operation,
  status,
  statusChannel,
  rows
}) {
  return [
    'feature_gate_runtime_checkpoint',
    operation,
    status,
    statusChannel,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.clientVisible ? 'client_visible' : 'client_hidden',
      row.nextAction,
      row.evidence?.fingerprint,
      ...(row.evidence?.disabledRequiredGates ?? []),
      ...(row.evidence?.deniedEffects ?? []),
      ...(row.evidence?.blockedRows ?? []),
      ...(row.evidence?.guardedRows ?? []),
      ...(row.evidence?.awaitingAcceptance ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value ?? '').split(',').map(clean).filter(Boolean);
}

function normalizeGateScope(input) {
  return {
    tenantId: clean(input.tenantId ?? input.tenant ?? 'mailchimp.default'),
    workspaceId: clean(input.workspaceId ?? input.workspace ?? 'mailchimp.workspace.default'),
    requestedTenantId: clean(input.requestedTenantId ?? input.requestTenantId),
    requestedWorkspaceId: clean(input.requestedWorkspaceId ?? input.requestWorkspaceId),
    role: clean(input.role ?? 'campaign_operator'),
    permissionMode: clean(input.permissionMode ?? 'least_privilege')
  };
}

function gateFingerprint(gates) {
  return Object.keys(gates)
    .sort()
    .map((key) => `${key}:${gates[key] === true ? '1' : '0'}`)
    .join('|');
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))].sort();
}

function toNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function clean(value) {
  return String(value ?? '').trim();
}
