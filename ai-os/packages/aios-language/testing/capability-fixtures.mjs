import {
  compileMailchimpCapabilities,
  summarizeCapabilityLifecycle,
  summarizeCapabilityRisk
} from "../compiler/capability-compiler.mjs";

export const MAILCHIMP_CAMPAIGN_CAPABILITY_FIXTURE_SOURCE = Object.freeze({
  capabilities: [
    {
      action: "campaign.read",
      reason: "Hydrate the existing campaign before generating a deterministic draft patch.",
      maxInvocations: 2
    },
    {
      action: "audience.read",
      reason: "Load audience metadata used by verifier claims.",
      mode: "readonly"
    },
    {
      action: "audience.segment.read",
      reason: "Resolve the segment targeted by the campaign schedule.",
      scheduleWindow: "preflight"
    },
    {
      action: "campaign.update",
      reason: "Stage a local draft update before provider handoff.",
      scheduleWindow: "operator-approved",
      expiresAfterMinutes: 20
    },
    {
      action: "campaign.schedule",
      reason: "Schedule only after verifier evidence and human approval are present.",
      enabled: false,
      scheduleWindow: "manual-approval",
      expiresAfterMinutes: 10
    },
    {
      action: "report.read",
      reason: "Collect post-run delivery evidence after runtime handoff.",
      scheduleWindow: "post-run"
    }
  ]
});

export const MAILCHIMP_CAMPAIGN_CAPABILITY_FIXTURE_OPTIONS = Object.freeze({
  localOnly: true,
  requireHumanApproval: true,
  lifecycleDefaults: {
    maxInvocations: 1
  }
});

function listCapabilityActions(contract) {
  return (contract?.capabilities || []).map((capability) => capability.action).sort();
}

function listProviderOperations(contract) {
  return (contract?.capabilities || [])
    .map((capability) => ({
      action: capability.action,
      serviceOperation: capability.providerOperation?.serviceOperation || null,
      handoffState: capability.providerOperation?.handoffState || null,
      runtimeEnablement: capability.providerOperation?.runtimeEnablement || null,
      externalWrite: capability.providerOperation?.externalWrite === true,
      requiredMemory: [...(capability.providerOperation?.requiredMemory || [])].sort()
    }))
    .sort((left, right) => left.action.localeCompare(right.action));
}

function buildCapabilityApprovalMatrix(contract) {
  return (contract?.capabilities || [])
    .map((capability) => ({
      action: capability.action,
      enabled: capability.lifecycle?.enabled !== false,
      risk: capability.risk || "low",
      scheduleWindow: capability.lifecycle?.scheduleWindow || "runtime",
      requiresApproval: capability.lifecycle?.controls?.requiresApprovalBeforeEnable === true,
      runtimeEnablement: capability.providerOperation?.runtimeEnablement || "enabled"
    }))
    .sort((left, right) => left.action.localeCompare(right.action));
}

function buildCapabilityAnalytics(contract, approvalMatrix, providerOperations) {
  const lifecycle = contract?.lifecycle || {};
  const diagnostics = contract?.diagnostics || [];
  const riskOrder = ["low", "medium", "high", "critical"];
  const counters = {
    totalActions: approvalMatrix.length,
    enabledActions: approvalMatrix.filter((entry) => entry.enabled).length,
    disabledActions: approvalMatrix.filter((entry) => !entry.enabled).length,
    approvalRequired: approvalMatrix.filter((entry) => entry.requiresApproval).length,
    externalWriteActions: providerOperations.filter((operation) => operation.externalWrite).length,
    providerReadActions: providerOperations.filter((operation) => !operation.externalWrite).length,
    diagnosticErrors: diagnostics.filter((diagnostic) => diagnostic.level === "error").length,
    diagnosticWarnings: diagnostics.filter((diagnostic) => diagnostic.level === "warning").length
  };
  const riskCounters = approvalMatrix.reduce((memo, entry) => {
    const risk = riskOrder.includes(entry.risk) ? entry.risk : "low";
    memo[risk] += 1;
    return memo;
  }, {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0
  });
  const timeline = approvalMatrix.map((entry, index) => {
    const operation = providerOperations.find((candidate) => candidate.action === entry.action) || {};
    const gate = entry.requiresApproval
      ? "operator_approval"
      : operation.externalWrite
        ? "provider_handoff"
        : "runtime_preflight";
    return {
      sequence: index + 1,
      action: entry.action,
      scheduleWindow: entry.scheduleWindow,
      gate,
      enabled: entry.enabled,
      risk: entry.risk,
      externalWrite: operation.externalWrite === true,
      requiredMemory: operation.requiredMemory || [],
      runtimeEnablement: entry.runtimeEnablement
    };
  });
  const snapshots = timeline.map((entry) => ({
    id: `mailchimp.capability.${entry.sequence}.${entry.action}`,
    action: entry.action,
    state: entry.enabled ? "enabled" : "held",
    auditEvent: entry.externalWrite
      ? "mailchimp.capability.external_write_gate"
      : "mailchimp.capability.runtime_gate",
    nextAction: entry.enabled
      ? "monitor-runtime-usage"
      : entry.requiresApproval
        ? "collect-operator-approval"
        : "enable-runtime-control"
  }));
  const exportSummary = {
    protocol: "aios.testing.capability-analytics.mailchimp.v1",
    provider: contract?.provider || "mailchimp",
    providerService: contract?.providerServiceContract?.providerService || "mailchimp-marketing-api",
    lifecyclePolicy: lifecycle.policy || "runtime",
    actionCount: counters.totalActions,
    externalWriteCount: counters.externalWriteActions,
    approvalGateCount: counters.approvalRequired,
    highestRisk: [...approvalMatrix]
      .map((entry) => entry.risk)
      .sort((left, right) => riskOrder.indexOf(right) - riskOrder.indexOf(left))[0] || "low",
    disabledActions: snapshots
      .filter((snapshot) => snapshot.state === "held")
      .map((snapshot) => snapshot.action),
    auditEvents: Array.from(new Set(snapshots.map((snapshot) => snapshot.auditEvent))).sort()
  };

  return {
    counters,
    riskCounters,
    timeline,
    snapshots,
    exportSummary
  };
}

function buildCapabilityLifecycleControls(contract, approvalMatrix, providerOperations, options = {}) {
  const lifecycleOptions = {
    command: "prepare-dispatch",
    scheduleMode: "approval-gated",
    enablement: {},
    maxEnabledExternalWrites: 1,
    requireApprovalForExternalWrites: true,
    ...(options.capabilityLifecycle || {})
  };
  const validCommands = ["prepare-dispatch", "enable-after-approval", "disable-external-writes", "observe-only"];
  const validScheduleModes = ["approval-gated", "manual", "provider-window", "immediate"];
  const invalidSettings = [];
  if (!validCommands.includes(lifecycleOptions.command)) {
    invalidSettings.push("capabilityLifecycle.command");
  }
  if (!validScheduleModes.includes(lifecycleOptions.scheduleMode)) {
    invalidSettings.push("capabilityLifecycle.scheduleMode");
  }
  if (!Number.isInteger(lifecycleOptions.maxEnabledExternalWrites)
    || lifecycleOptions.maxEnabledExternalWrites < 0) {
    invalidSettings.push("capabilityLifecycle.maxEnabledExternalWrites");
  }

  const operationByAction = new Map(providerOperations.map((operation) => [operation.action, operation]));
  const externalWriteActions = providerOperations
    .filter((operation) => operation.externalWrite)
    .map((operation) => operation.action)
    .sort();
  const controls = approvalMatrix.map((entry) => {
    const operation = operationByAction.get(entry.action) || {};
    const override = lifecycleOptions.enablement[entry.action];
    const externalWrite = operation.externalWrite === true;
    const approvalBlocked = externalWrite
      && lifecycleOptions.requireApprovalForExternalWrites === true
      && entry.requiresApproval === true
      && override !== true;
    const observeOnly = lifecycleOptions.command === "observe-only";
    const disableExternalWrites = lifecycleOptions.command === "disable-external-writes" && externalWrite;
    const enabled = observeOnly || disableExternalWrites
      ? false
      : override === true
        ? true
        : override === false
          ? false
          : entry.enabled === true && approvalBlocked === false;
    const state = enabled
      ? "enabled"
      : approvalBlocked
        ? "waiting_for_approval"
        : disableExternalWrites
          ? "disabled_by_policy"
          : observeOnly
            ? "observe_only"
            : "disabled";
    return {
      action: entry.action,
      command: enabled ? "capability.enable" : "capability.hold",
      state,
      enabled,
      externalWrite,
      scheduleMode: externalWrite ? lifecycleOptions.scheduleMode : "runtime-preflight",
      requiresApproval: entry.requiresApproval,
      requiredMemory: operation.requiredMemory || [],
      runtimeEnablement: entry.runtimeEnablement,
      blocksDispatch: externalWrite && enabled === false && approvalBlocked === false,
      nextAction: enabled
        ? "monitor-capability-usage"
        : approvalBlocked
          ? "collect-operator-approval"
          : disableExternalWrites
            ? "enable-external-write-policy"
            : observeOnly
              ? "switch-capability-command"
              : "enable-runtime-control",
      auditEvent: externalWrite
        ? "mailchimp.capability.lifecycle_external_write"
        : "mailchimp.capability.lifecycle_read"
    };
  });
  const enabledExternalWrites = controls.filter((control) => control.externalWrite && control.enabled);
  const policyBlockedActions = [
    ...controls
      .filter((control) => control.blocksDispatch)
      .map((control) => control.action),
    ...(enabledExternalWrites.length > lifecycleOptions.maxEnabledExternalWrites
      ? enabledExternalWrites
        .slice(lifecycleOptions.maxEnabledExternalWrites)
        .map((control) => control.action)
      : [])
  ].sort();

  return {
    protocol: "aios.testing.capability-lifecycle-controls.mailchimp.v1",
    command: lifecycleOptions.command,
    scheduleMode: lifecycleOptions.scheduleMode,
    valid: invalidSettings.length === 0,
    invalidSettings,
    controls,
    enabledActions: controls.filter((control) => control.enabled).map((control) => control.action).sort(),
    heldActions: controls.filter((control) => !control.enabled).map((control) => control.action).sort(),
    externalWriteActions,
    enabledExternalWriteActions: enabledExternalWrites.map((control) => control.action).sort(),
    policyBlockedActions,
    dispatchAllowed: invalidSettings.length === 0 && policyBlockedActions.length === 0,
    nextAction: invalidSettings.length > 0
      ? "repair-capability-lifecycle-settings"
      : policyBlockedActions.length > 0
        ? "resolve-capability-lifecycle-blocks"
        : "dispatch-runtime-handoff"
  };
}

export function buildMailchimpCapabilityFixture(source = MAILCHIMP_CAMPAIGN_CAPABILITY_FIXTURE_SOURCE, options = {}) {
  const compileOptions = {
    ...MAILCHIMP_CAMPAIGN_CAPABILITY_FIXTURE_OPTIONS,
    ...options
  };
  const contract = compileMailchimpCapabilities(source, compileOptions);
  const lifecycle = summarizeCapabilityLifecycle(contract);
  const risk = summarizeCapabilityRisk(contract);
  const providerOperations = listProviderOperations(contract);
  const approvalMatrix = buildCapabilityApprovalMatrix(contract);
  const actions = listCapabilityActions(contract);
  const analytics = buildCapabilityAnalytics(contract, approvalMatrix, providerOperations);
  const lifecycleControls = buildCapabilityLifecycleControls(
    contract,
    approvalMatrix,
    providerOperations,
    compileOptions
  );
  const disabledActions = lifecycle.disabledActions || [];
  const externalWriteActions = providerOperations
    .filter((operation) => operation.externalWrite)
    .map((operation) => operation.action);

  return {
    kind: "aios.testing.mailchimpCapabilityFixture",
    provider: "mailchimp",
    contract,
    expected: {
      actions,
      lifecycle,
      risk,
      providerOperations,
      approvalMatrix,
      analytics,
      lifecycleControls,
      externalWriteActions,
      disabledActions,
      requiresHumanApproval: risk.requiresApproval === true,
      scheduleCapability: approvalMatrix.find((entry) => entry.action === "campaign.schedule") || null,
      providerService: contract.providerServiceContract?.providerService || "mailchimp-marketing-api"
    }
  };
}

export function assertMailchimpCapabilityFixture(fixture = buildMailchimpCapabilityFixture()) {
  const contract = fixture.contract || {};
  const expected = fixture.expected || {};
  const diagnostics = contract.diagnostics || [];
  const scheduleCapability = expected.scheduleCapability || {};
  const operations = expected.providerOperations || [];
  const providerWriteActions = operations
    .filter((operation) => operation.externalWrite)
    .map((operation) => operation.action);
  const missingOperationMemory = operations
    .filter((operation) => operation.externalWrite && operation.requiredMemory.length === 0)
    .map((operation) => operation.action);
  const unsupportedDiagnostics = diagnostics
    .filter((diagnostic) => diagnostic.level === "error")
    .map((diagnostic) => diagnostic.code);
  const analytics = expected.analytics || {};
  const lifecycleControls = expected.lifecycleControls || {};
  const analyticsSummary = analytics.exportSummary || {};
  const timelineActions = (analytics.timeline || []).map((entry) => entry.action);
  const missingTimelineActions = (expected.actions || [])
    .filter((action) => !timelineActions.includes(action));
  const externalWritesMissingAudit = (analytics.snapshots || [])
    .filter((snapshot) => providerWriteActions.includes(snapshot.action)
      && snapshot.auditEvent !== "mailchimp.capability.external_write_gate")
    .map((snapshot) => snapshot.action);
  const lifecycleActionSet = new Set((lifecycleControls.controls || []).map((control) => control.action));
  const missingLifecycleActions = (expected.actions || [])
    .filter((action) => !lifecycleActionSet.has(action));
  const lifecycleMissingAudit = (lifecycleControls.controls || [])
    .filter((control) => !control.auditEvent)
    .map((control) => control.action);

  return {
    ok: contract.kind === "aios.capabilityContract"
      && contract.provider === "mailchimp"
      && expected.actions?.includes("campaign.update")
      && expected.actions?.includes("campaign.schedule")
      && scheduleCapability.enabled === false
      && scheduleCapability.requiresApproval === true
      && scheduleCapability.runtimeEnablement === "disabled-until-runtime-control"
      && expected.lifecycle?.approvalGateCount >= 1
      && expected.risk?.highestRisk === "high"
      && missingOperationMemory.length === 0
      && unsupportedDiagnostics.length === 0
      && analyticsSummary.protocol === "aios.testing.capability-analytics.mailchimp.v1"
      && analytics.counters?.totalActions === expected.actions?.length
      && analytics.counters?.externalWriteActions === providerWriteActions.length
      && missingTimelineActions.length === 0
      && externalWritesMissingAudit.length === 0
      && lifecycleControls.protocol === "aios.testing.capability-lifecycle-controls.mailchimp.v1"
      && lifecycleControls.valid === true
      && lifecycleControls.dispatchAllowed === true
      && missingLifecycleActions.length === 0
      && lifecycleMissingAudit.length === 0,
    analyticsOk: analyticsSummary.protocol === "aios.testing.capability-analytics.mailchimp.v1"
      && analytics.counters?.totalActions === expected.actions?.length
      && analytics.counters?.externalWriteActions === providerWriteActions.length
      && missingTimelineActions.length === 0
      && externalWritesMissingAudit.length === 0,
    lifecycleControlsOk: lifecycleControls.protocol === "aios.testing.capability-lifecycle-controls.mailchimp.v1"
      && lifecycleControls.valid === true
      && lifecycleControls.dispatchAllowed === true
      && missingLifecycleActions.length === 0
      && lifecycleMissingAudit.length === 0,
    actionCount: expected.actions?.length || 0,
    approvalGateCount: expected.lifecycle?.approvalGateCount || 0,
    disabledActions: expected.disabledActions || [],
    providerWriteActions,
    missingOperationMemory,
    unsupportedDiagnostics,
    missingTimelineActions,
    externalWritesMissingAudit,
    missingLifecycleActions,
    lifecycleMissingAudit,
    lifecycleBlockedActions: lifecycleControls.policyBlockedActions || [],
    capabilityLifecycleNextAction: lifecycleControls.nextAction || null,
    capabilityAnalytics: analyticsSummary,
    nextActionByCapability: (expected.approvalMatrix || []).map((entry) => ({
      action: entry.action,
      runtimeEnablement: entry.runtimeEnablement,
      requiresApproval: entry.requiresApproval
    }))
  };
}

export const MAILCHIMP_CAPABILITY_GOLDEN = buildMailchimpCapabilityFixture();
export const MAILCHIMP_CAPABILITY_GOLDEN_CHECK = assertMailchimpCapabilityFixture(MAILCHIMP_CAPABILITY_GOLDEN);
