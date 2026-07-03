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

export function selfCheckFeatureGates() {
  return evaluateFeatureGateContract({
    operation: 'campaign.sync',
    requestedEffects: ['mailchimp.read'],
    gates: 'gate mailchimpRead=on\ngate campaignPlanning=on'
  });
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
