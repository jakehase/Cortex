import { compileMailchimpAdapterHandoff } from "../runtime/adapter-handoff.mjs";
import {
  MAILCHIMP_CAPABILITY_GOLDEN,
  assertMailchimpCapabilityFixture,
  buildMailchimpCapabilityFixture
} from "./capability-fixtures.mjs";
import {
  MAILCHIMP_MEMORY_GOLDEN,
  assertMailchimpMemoryFixture,
  buildMailchimpMemoryFixture
} from "./memory-fixtures.mjs";

export const MAILCHIMP_RUNTIME_GOLDEN_SOURCE = Object.freeze({
  adapter: "mailchimp",
  action: "campaign.schedule",
  requestId: "mailchimp-runtime-golden-001",
  tenant: "tenant-mailchimp-golden",
  workspace: "workspace-mailchimp-golden",
  truth: "operator-approved-draft",
  dryRun: false,
  idempotencyKey: "mailchimp-runtime-golden-001:schedule",
  capabilities: [
    "campaign.read",
    "audience.read",
    "audience.segment.read",
    "campaign.update",
    "campaign.schedule",
    "report.read"
  ],
  providerContract: {
    provider: "mailchimp",
    service: "mailchimp-marketing",
    accountId: "acct-golden",
    dataCenter: "us20",
    serviceState: "online",
    mode: "linked",
    externalRequestId: "ext-golden-001",
    requestedCapabilities: ["campaign.schedule", "campaign.update"],
    advertisedCapabilities: [
      "audience.read",
      "audience.segment.read",
      "campaign.read",
      "campaign.schedule",
      "campaign.update",
      "external.write",
      "mailchimp.campaign.schedule",
      "report.read"
    ],
    sync: {
      cursor: "cursor-golden-001",
      resource: "campaigns",
      lastSyncedAt: "2026-07-03T00:10:00.000Z",
      batchId: "batch-golden-001"
    },
    lease: {
      owner: "aios-runtime",
      token: "lease-golden-001",
      expiresAt: "2026-07-03T01:10:00.000Z",
      renewable: true
    }
  },
  lifecycle: {
    enabled: true,
    command: "dispatch",
    schedule: {
      mode: "scheduled",
      runAt: "2026-07-03T02:00:00.000Z",
      timezone: "UTC"
    },
    controls: {
      allowExternalWrite: true,
      requireVerifierBeforeDispatch: true,
      maxDispatches: 1,
      retryLimit: 2
    }
  },
  boundary: {
    tenant: "tenant-mailchimp-golden",
    workspace: "workspace-mailchimp-golden",
    roles: ["campaign-operator"],
    grants: [
      "mailchimp.campaign.write",
      "mailchimp.campaign.schedule",
      "mailchimp.audience.read",
      "external.write"
    ]
  },
  verifier: {
    evidence: [
      {
        id: "evidence-subject-present",
        claim: "campaign.subject.present",
        passed: true
      },
      {
        id: "evidence-audience-selected",
        claim: "campaign.audience.selected",
        passed: true
      }
    ]
  }
});

export const MAILCHIMP_RUNTIME_GOLDEN_HISTORY = Object.freeze([
  {
    at: "2026-07-03T00:00:00.000Z",
    state: "queued",
    code: "mailchimp.runtime.queued",
    message: "Runtime handoff queued.",
    truth: "operator-approved-draft"
  },
  {
    at: "2026-07-03T00:02:00.000Z",
    state: "waiting_for_verifier",
    code: "mailchimp.status.verifier_ready",
    message: "Verifier evidence is attached.",
    truth: "verifier-evidence"
  },
  {
    at: "2026-07-03T00:04:00.000Z",
    state: "running",
    code: "mailchimp.runtime.provider_handoff_linked",
    message: "Provider handoff is linked to Mailchimp.",
    truth: "provider-contract"
  }
]);

function buildRuntimeSource(capabilityFixture, memoryFixture, overrides = {}) {
  const writeActions = capabilityFixture.expected.externalWriteActions || [];
  const requiredMemory = Array.from(new Set(
    (capabilityFixture.expected.providerOperations || [])
      .filter((operation) => writeActions.includes(operation.action))
      .flatMap((operation) => operation.requiredMemory)
  )).sort();
  return {
    ...MAILCHIMP_RUNTIME_GOLDEN_SOURCE,
    ...overrides,
    capabilityContract: capabilityFixture.contract,
    memoryContract: memoryFixture.contract,
    runtimeExpectations: {
      requiredMemory,
      writeActions,
      providerSyncMounts: memoryFixture.expected.providerSyncMounts,
      approvalGateCount: capabilityFixture.expected.lifecycle.approvalGateCount
    }
  };
}

function normalizeRuntimeHistory(history) {
  return [...history]
    .map((event, index) => ({
      index,
      at: String(event.at || event.time || `event:${index}`).trim(),
      state: String(event.state || "queued").trim().toLowerCase().replaceAll("-", "_"),
      code: String(event.code || "mailchimp.runtime.event").trim(),
      message: String(event.message || "").trim(),
      truth: String(event.truth || event.truthBoundary || "").trim()
    }))
    .filter((event) => event.code || event.message);
}

function latestRuntimeEvent(events) {
  return events[events.length - 1] || {
    index: 0,
    at: "event:0",
    state: "queued",
    code: "mailchimp.runtime.queued",
    message: "",
    truth: ""
  };
}

function buildDeterministicStatusSnapshot(adapterDescriptor, history) {
  const events = normalizeRuntimeHistory(history);
  const latest = latestRuntimeEvent(events);
  const providerContract = adapterDescriptor.providerContract || {};
  const externalHandoff = adapterDescriptor.externalHandoff || providerContract.externalHandoff || {};
  const diagnostics = adapterDescriptor.diagnostics || [];
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const providerReady = providerContract.serviceState === "online"
    && providerContract.capabilityNegotiation?.satisfied !== false
    && providerContract.sync?.ready !== false
    && externalHandoff.state === "linked";

  return {
    protocol: "aios.testing.status-handoff.mailchimp.v1",
    requestId: adapterDescriptor.requestId,
    tenant: adapterDescriptor.tenant,
    action: adapterDescriptor.action,
    state: latest.state,
    terminal: ["succeeded", "failed", "rolled_back", "cancelled"].includes(latest.state),
    events,
    diagnostics,
    provider: {
      state: providerContract.serviceState || "unknown",
      capabilitySatisfied: providerContract.capabilityNegotiation?.satisfied !== false,
      syncReady: providerContract.sync?.ready !== false,
      syncStale: providerContract.sync?.stale === true,
      externalHandoffState: externalHandoff.state || "local_only",
      externalRequestId: externalHandoff.requestId || "",
      restartSafe: providerContract.lease?.restartSafe !== false
    },
    readiness: {
      ready: errorCount === 0 && providerReady,
      nextStep: errorCount > 0
        ? "repair-runtime-descriptor"
        : providerReady
          ? "dispatch-provider-handoff"
          : "refresh-provider-handoff",
      validationSummary: {
        errors: errorCount,
        warnings: warningCount,
        events: events.length,
        providerReady
      }
    },
    truthBoundary: {
      source: "runtime-goldens",
      deterministic: true,
      externalWritesAllowed: adapterDescriptor.truthBoundary?.externalWritesAllowed === true,
      evidenceRequired: adapterDescriptor.truthBoundary?.evidenceRequired || []
    }
  };
}

function summarizeDeterministicStatus(statusSnapshot) {
  return {
    ok: statusSnapshot.readiness.ready === true && statusSnapshot.state !== "failed",
    requestId: statusSnapshot.requestId,
    state: statusSnapshot.state,
    terminal: statusSnapshot.terminal,
    blockers: statusSnapshot.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "warning")
      .map((diagnostic) => diagnostic.code),
    provider: statusSnapshot.provider,
    readiness: statusSnapshot.readiness,
    truthBoundary: statusSnapshot.truthBoundary
  };
}

function buildDeterministicRecoveryPlan(statusSnapshot, settings = {}) {
  const readiness = statusSnapshot.readiness || {};
  const provider = statusSnapshot.provider || {};
  const blocked = readiness.ready !== true;
  const nextAction = blocked
    ? readiness.nextStep || "repair-runtime-descriptor"
    : settings.command || "resume_provider_handoff";

  return {
    protocol: "aios.testing.recovery-plan.mailchimp.v1",
    requestId: statusSnapshot.requestId,
    tenant: statusSnapshot.tenant,
    action: statusSnapshot.action,
    recoverable: statusSnapshot.terminal !== true,
    blocked,
    nextAction,
    recovery: {
      command: nextAction,
      maxAttempts: settings.maxAttempts || 2,
      backoffSeconds: settings.backoffSeconds || 30,
      resumeToken: `${statusSnapshot.requestId}:runtime-golden:${statusSnapshot.events.length}`,
      requiresProviderRefresh: provider.syncReady === false || provider.externalHandoffState !== "linked",
      requiresDescriptorRepair: statusSnapshot.diagnostics.some((diagnostic) => diagnostic.severity === "error")
    },
    statusHandoff: {
      state: statusSnapshot.state,
      visibleStatus: blocked ? "needs-operator-action" : "ready",
      ackRequired: blocked,
      nextAction
    }
  };
}

function grantForRuntimeAction(action) {
  if (action === "campaign.schedule") return "mailchimp.campaign.schedule";
  if (action === "campaign.update") return "mailchimp.campaign.write";
  if (action.startsWith("audience.")) return "mailchimp.audience.read";
  if (action.startsWith("report.")) return "mailchimp.report.read";
  return `mailchimp.${action}`;
}

function buildRuntimeBoundaryEnvelope(source, adapterDescriptor, capabilityFixture, memoryFixture) {
  const boundary = source.boundary || {};
  const descriptorBoundary = adapterDescriptor.truthBoundary?.tenantBoundary || {};
  const capabilityAnalytics = capabilityFixture.expected?.analytics || {};
  const memoryLifecycle = memoryFixture.expected?.lifecycleControls || {};
  const writeActions = capabilityFixture.expected?.externalWriteActions || [];
  const grants = new Set(boundary.grants || []);
  const roles = new Set(boundary.roles || []);
  const requiredGrants = Array.from(new Set(writeActions.map(grantForRuntimeAction))).sort();
  const missingGrants = requiredGrants.filter((grant) => !grants.has(grant));
  const tenantMatches = boundary.tenant === adapterDescriptor.tenant
    && descriptorBoundary.allowed === true;
  const workspaceMatches = boundary.workspace === descriptorBoundary.workspace;
  const hasRuntimeRole = roles.has("campaign-operator") || roles.has("workspace-admin");
  const memoryBlockedMounts = memoryLifecycle.blockedMounts || [];
  const dispatchableActions = (capabilityAnalytics.timeline || [])
    .filter((entry) => writeActions.includes(entry.action))
    .map((entry) => ({
      action: entry.action,
      grant: grantForRuntimeAction(entry.action),
      enabled: entry.enabled,
      auditEvent: entry.externalWrite
        ? "mailchimp.runtime.external_write_boundary"
        : "mailchimp.runtime.read_boundary",
      requiresApproval: entry.gate === "operator_approval",
      requiredMemory: entry.requiredMemory || []
    }));
  const blockedReasons = [
    ...missingGrants.map((grant) => `missing-grant:${grant}`),
    ...(tenantMatches ? [] : ["tenant-boundary-mismatch"]),
    ...(workspaceMatches ? [] : ["workspace-boundary-mismatch"]),
    ...(hasRuntimeRole ? [] : ["missing-runtime-role"]),
    ...memoryBlockedMounts.map((mount) => `memory-blocked:${mount}`),
    ...(memoryLifecycle.invalidSettings || []).map((setting) => `memory-setting:${setting}`)
  ].sort();
  const auditHandoff = {
    protocol: "aios.testing.runtime-boundary-audit.mailchimp.v1",
    tenant: boundary.tenant || adapterDescriptor.tenant,
    workspace: boundary.workspace || descriptorBoundary.workspace || null,
    requestId: adapterDescriptor.requestId,
    action: adapterDescriptor.action,
    auditEvents: Array.from(new Set([
      "mailchimp.runtime.tenant_boundary_checked",
      "mailchimp.runtime.workspace_boundary_checked",
      ...dispatchableActions.map((entry) => entry.auditEvent),
      ...(memoryLifecycle.controls || []).map((control) => control.auditEvent)
    ])).sort(),
    blockedReasons,
    status: blockedReasons.length === 0 ? "accepted" : "blocked"
  };

  return {
    protocol: "aios.testing.runtime-boundary.mailchimp.v1",
    tenant: boundary.tenant || null,
    workspace: boundary.workspace || null,
    descriptorTenant: adapterDescriptor.tenant || null,
    descriptorWorkspace: descriptorBoundary.workspace || null,
    tenantMatches,
    workspaceMatches,
    roles: [...roles].sort(),
    grants: [...grants].sort(),
    requiredGrants,
    missingGrants,
    hasRuntimeRole,
    memoryLifecycleReady: memoryLifecycle.dispatchAllowed === true,
    dispatchableActions,
    blockedReasons,
    allowed: blockedReasons.length === 0,
    nextAction: blockedReasons.length === 0
      ? "dispatch-provider-handoff"
      : missingGrants.length > 0
        ? "request-runtime-grants"
        : memoryBlockedMounts.length > 0
          ? "refresh-memory-before-dispatch"
          : "repair-runtime-boundary",
    auditHandoff
  };
}

function buildRuntimeOperationalHealth(statusSummary, recoveryPlan, boundaryEnvelope, capabilityFixture, memoryFixture) {
  const capabilityLifecycle = capabilityFixture.expected?.lifecycleControls || {};
  const memoryLifecycle = memoryFixture.expected?.lifecycleControls || {};
  const memoryProvider = memoryFixture.expected?.providerServiceContract || {};
  const recovery = recoveryPlan.recovery || {};
  const provider = statusSummary.provider || {};
  const capabilityBlocks = capabilityLifecycle.policyBlockedActions || [];
  const memoryBlocks = memoryLifecycle.blockedMounts || [];
  const missingProviderCapabilities = memoryProvider.capabilityNegotiation?.missing || [];
  const providerReady = provider.state === "online"
    && provider.externalHandoffState === "linked"
    && provider.capabilitySatisfied !== false
    && provider.syncReady !== false
    && memoryProvider.externalHandoff?.state === "linked";
  const degradedReasons = [
    ...(statusSummary.ok === true ? [] : ["status-not-ready"]),
    ...(boundaryEnvelope.allowed === true ? [] : boundaryEnvelope.blockedReasons || ["boundary-blocked"]),
    ...capabilityBlocks.map((action) => `capability-blocked:${action}`),
    ...memoryBlocks.map((mount) => `memory-blocked:${mount}`),
    ...missingProviderCapabilities.map((capability) => `provider-capability-missing:${capability}`),
    ...(providerReady ? [] : ["provider-handoff-not-ready"])
  ].sort();
  const validationFailures = [
    ...(capabilityLifecycle.invalidSettings || []).map((setting) => ({
      code: "mailchimp.runtime.capability_lifecycle_invalid",
      target: setting,
      nextAction: "repair-capability-lifecycle-settings"
    })),
    ...(memoryLifecycle.invalidSettings || []).map((setting) => ({
      code: "mailchimp.runtime.memory_lifecycle_invalid",
      target: setting,
      nextAction: "repair-memory-lifecycle-settings"
    })),
    ...missingProviderCapabilities.map((capability) => ({
      code: "mailchimp.runtime.provider_capability_missing",
      target: capability,
      nextAction: "renegotiate-provider-capabilities"
    }))
  ];
  const failureState = validationFailures.length > 0
    ? "failed_validation"
    : boundaryEnvelope.allowed !== true
      ? "blocked_by_boundary"
      : memoryBlocks.length > 0
        ? "blocked_by_memory_sync"
        : capabilityBlocks.length > 0
          ? "blocked_by_capability_lifecycle"
          : providerReady
            ? "healthy"
            : "provider_handoff_degraded";
  const retryable = degradedReasons.length > 0
    && validationFailures.length === 0
    && boundaryEnvelope.allowed === true
    && recoveryPlan.recoverable === true;
  const backoffSeconds = retryable
    ? Math.max(recovery.backoffSeconds || 30, memoryBlocks.length > 0 ? 45 : 15)
    : 0;
  const actionableErrors = [
    ...validationFailures,
    ...(boundaryEnvelope.blockedReasons || []).map((reason) => ({
      code: "mailchimp.runtime.boundary_blocked",
      target: reason,
      nextAction: boundaryEnvelope.nextAction || "repair-runtime-boundary"
    })),
    ...memoryBlocks.map((mount) => ({
      code: "mailchimp.runtime.memory_blocked",
      target: mount,
      nextAction: "refresh-memory-before-dispatch"
    })),
    ...capabilityBlocks.map((action) => ({
      code: "mailchimp.runtime.capability_blocked",
      target: action,
      nextAction: "resolve-capability-lifecycle-blocks"
    }))
  ];

  return {
    protocol: "aios.testing.runtime-operational-health.mailchimp.v1",
    status: degradedReasons.length === 0 ? "healthy" : "degraded",
    failureState,
    retryable,
    backoffSeconds,
    maxAttempts: recovery.maxAttempts || 0,
    degradedMode: {
      enabled: degradedReasons.length > 0,
      readOnlyRecoveryAllowed: validationFailures.length === 0,
      externalWritesAllowed: degradedReasons.length === 0 && boundaryEnvelope.allowed === true,
      visibleStatus: degradedReasons.length > 0 ? "needs-operator-action" : "ready"
    },
    provider: {
      ready: providerReady,
      runtimeState: provider.state || "unknown",
      runtimeHandoffState: provider.externalHandoffState || "unknown",
      memoryHandoffState: memoryProvider.externalHandoff?.state || "unknown",
      memoryNextAction: memoryProvider.externalHandoff?.nextAction || null
    },
    validationFailures,
    degradedReasons,
    actionableErrors,
    counters: {
      degradedReasons: degradedReasons.length,
      validationFailures: validationFailures.length,
      capabilityBlocks: capabilityBlocks.length,
      memoryBlocks: memoryBlocks.length,
      missingProviderCapabilities: missingProviderCapabilities.length
    },
    nextAction: degradedReasons.length === 0
      ? "dispatch-provider-handoff"
      : actionableErrors[0]?.nextAction
        || memoryProvider.externalHandoff?.nextAction
        || recovery.command
        || "repair-runtime-health"
  };
}

function buildRuntimeAcceptance(adapterDescriptor, statusSummary, recoveryPlan, capabilityCheck, memoryCheck, boundaryEnvelope) {
  const runtimeExpectations = adapterDescriptor.runtimeExpectations || {};
  const provider = statusSummary.provider || {};
  const recovery = recoveryPlan.recovery || {};
  return {
    requestId: adapterDescriptor.requestId,
    statusState: statusSummary.state,
    providerState: provider.state,
    externalHandoffState: provider.externalHandoffState,
    capabilitySatisfied: provider.capabilitySatisfied,
    restartSafe: provider.restartSafe,
    recoveryCommand: recovery.command || recoveryPlan.nextAction || null,
    acceptedForRuntime: capabilityCheck.ok === true
      && memoryCheck.ok === true
      && statusSummary.ok === true
      && boundaryEnvelope.allowed === true
      && provider.capabilitySatisfied !== false
      && provider.syncReady !== false,
    boundaryAccepted: boundaryEnvelope.allowed === true,
    auditHandoffStatus: boundaryEnvelope.auditHandoff?.status || "unknown",
    boundaryNextAction: boundaryEnvelope.nextAction,
    requiredMemory: runtimeExpectations.requiredMemory || [],
    providerSyncMounts: runtimeExpectations.providerSyncMounts || [],
    writeActions: runtimeExpectations.writeActions || [],
    nextStep: statusSummary.readiness?.nextStep || recovery.command || "observe"
  };
}

export function buildMailchimpRuntimeGolden(options = {}) {
  const capabilityFixture = options.capabilityFixture || buildMailchimpCapabilityFixture();
  const memoryFixture = options.memoryFixture || buildMailchimpMemoryFixture();
  const source = buildRuntimeSource(capabilityFixture, memoryFixture, options.source || {});
  const adapterDescriptor = compileMailchimpAdapterHandoff(source);
  adapterDescriptor.runtimeExpectations = source.runtimeExpectations;
  const statusSnapshot = buildDeterministicStatusSnapshot(
    adapterDescriptor,
    options.history || MAILCHIMP_RUNTIME_GOLDEN_HISTORY
  );
  const statusSummary = summarizeDeterministicStatus(statusSnapshot);
  const recoveryPlan = buildDeterministicRecoveryPlan(statusSnapshot, {
    command: "resume_after_provider_refresh",
    maxAttempts: 2,
    backoffSeconds: 30
  });
  const capabilityCheck = assertMailchimpCapabilityFixture(capabilityFixture);
  const memoryCheck = assertMailchimpMemoryFixture(memoryFixture);
  const boundaryEnvelope = buildRuntimeBoundaryEnvelope(
    source,
    adapterDescriptor,
    capabilityFixture,
    memoryFixture
  );
  const operationalHealth = buildRuntimeOperationalHealth(
    statusSummary,
    recoveryPlan,
    boundaryEnvelope,
    capabilityFixture,
    memoryFixture
  );

  return {
    kind: "aios.testing.mailchimpRuntimeGolden",
    provider: "mailchimp",
    source,
    capabilityFixture,
    memoryFixture,
    adapterDescriptor,
    statusSnapshot,
    statusSummary,
    recoveryPlan,
    boundaryEnvelope,
    operationalHealth,
    expected: buildRuntimeAcceptance(
      adapterDescriptor,
      statusSummary,
      recoveryPlan,
      capabilityCheck,
      memoryCheck,
      boundaryEnvelope
    )
  };
}

export function assertMailchimpRuntimeGolden(golden = buildMailchimpRuntimeGolden()) {
  const expected = golden.expected || {};
  const descriptor = golden.adapterDescriptor || {};
  const statusSnapshot = golden.statusSnapshot || {};
  const recoveryPlan = golden.recoveryPlan || {};
  const requiredMemoryMissing = (expected.requiredMemory || [])
    .filter((name) => !(golden.memoryFixture?.expected?.mounts || []).some((mount) => mount.name === name));
  const writeActionMissing = (expected.writeActions || [])
    .filter((action) => !(golden.capabilityFixture?.expected?.actions || []).includes(action));
  const boundaryEnvelope = golden.boundaryEnvelope || {};
  const operationalHealth = golden.operationalHealth || {};

  return {
    ok: descriptor.type === "KernelJobDescriptor"
      && statusSnapshot.protocol === "aios.testing.status-handoff.mailchimp.v1"
      && recoveryPlan.protocol === "aios.testing.recovery-plan.mailchimp.v1"
      && boundaryEnvelope.protocol === "aios.testing.runtime-boundary.mailchimp.v1"
      && expected.acceptedForRuntime === true
      && expected.boundaryAccepted === true
      && expected.auditHandoffStatus === "accepted"
      && expected.externalHandoffState === "linked"
      && expected.providerState === "online"
      && expected.capabilitySatisfied !== false
      && operationalHealth.protocol === "aios.testing.runtime-operational-health.mailchimp.v1"
      && operationalHealth.status === "healthy"
      && operationalHealth.degradedMode?.externalWritesAllowed === true
      && operationalHealth.provider?.ready === true
      && requiredMemoryMissing.length === 0
      && writeActionMissing.length === 0,
    requestId: expected.requestId,
    statusState: expected.statusState,
    nextStep: expected.nextStep,
    recoveryCommand: expected.recoveryCommand,
    requiredMemoryMissing,
    writeActionMissing,
    boundaryBlockedReasons: boundaryEnvelope.blockedReasons || [],
    boundaryNextAction: expected.boundaryNextAction || null,
    auditHandoffStatus: expected.auditHandoffStatus || "unknown",
    operationalHealthStatus: operationalHealth.status || "unknown",
    operationalFailureState: operationalHealth.failureState || "unknown",
    operationalNextAction: operationalHealth.nextAction || null,
    operationalDegradedReasons: operationalHealth.degradedReasons || [],
    providerSyncMounts: expected.providerSyncMounts || [],
    writeActions: expected.writeActions || []
  };
}

export const MAILCHIMP_RUNTIME_GOLDEN = buildMailchimpRuntimeGolden({
  capabilityFixture: MAILCHIMP_CAPABILITY_GOLDEN,
  memoryFixture: MAILCHIMP_MEMORY_GOLDEN
});
export const MAILCHIMP_RUNTIME_GOLDEN_CHECK = assertMailchimpRuntimeGolden(MAILCHIMP_RUNTIME_GOLDEN);
