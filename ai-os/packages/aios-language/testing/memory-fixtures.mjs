import {
  compileMailchimpMemoryMounts,
  compileRollbackMemoryPlan
} from "../compiler/memory-mount-compiler.mjs";

export const MAILCHIMP_CAMPAIGN_MEMORY_FIXTURE_SOURCE = Object.freeze({
  mounts: [
    {
      name: "campaignDraft",
      mode: "readwrite",
      conflictPolicy: "local-draft-wins",
      lastSyncedAt: "2026-07-03T00:00:00.000Z"
    },
    {
      name: "audienceSnapshot",
      mode: "readonly",
      conflictPolicy: "remote-wins",
      lastSyncedAt: "2026-07-03T00:05:00.000Z"
    },
    {
      name: "verifierEvidence",
      mode: "append",
      syncDirection: "local-only"
    },
    {
      name: "rollbackJournal",
      mode: "append",
      syncDirection: "local-only"
    }
  ]
});

export const MAILCHIMP_CAMPAIGN_MEMORY_FIXTURE_OPTIONS = Object.freeze({
  localOnly: true,
  lifecycle: {
    enabled: true,
    command: "sync-before-dispatch",
    scheduleMode: "provider-window",
    maxStalenessMinutes: 30,
    allowDisableProviderSync: true
  }
});

function mountByName(contract, name) {
  return (contract?.mounts || []).find((mount) => mount.name === name) || null;
}

function summarizeMounts(contract) {
  return (contract?.mounts || [])
    .map((mount) => ({
      name: mount.name,
      mode: mount.mode,
      path: mount.path,
      sensitivity: mount.sensitivity,
      retentionHours: mount.retentionHours,
      syncDirection: mount.providerContract?.syncDirection || "local-only",
      externalHandoff: mount.providerContract?.externalHandoff || "not-required",
      conflictPolicy: mount.providerContract?.syncMetadata?.conflictPolicy || null,
      requiredCapabilities: [...(mount.providerContract?.negotiatedCapabilities || [])].sort()
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildProviderSyncMatrix(contract) {
  return summarizeMounts(contract).map((mount) => ({
    mount: mount.name,
    providerSynced: mount.syncDirection !== "local-only",
    writebackStaged: mount.externalHandoff === "stage-local-before-provider-write",
    readonlySuppressed: mount.mode === "readonly" && mount.syncDirection === "pull-push",
    requiredCapabilities: mount.requiredCapabilities,
    nextStep: contract.previewAcceptance?.mounts?.find((preview) => preview.mount === mount.name)?.acceptance?.nextStep || null
  }));
}

function minutesSinceSync(lastSyncedAt, referenceTime) {
  const syncedAt = Date.parse(lastSyncedAt || "");
  const reference = Date.parse(referenceTime || "");
  if (!Number.isFinite(syncedAt) || !Number.isFinite(reference)) return null;
  return Math.max(0, Math.floor((reference - syncedAt) / 60000));
}

function buildMemoryLifecycleControls(contract, providerSyncMatrix, options = {}) {
  const lifecycle = {
    ...MAILCHIMP_CAMPAIGN_MEMORY_FIXTURE_OPTIONS.lifecycle,
    ...(options.lifecycle || {})
  };
  const referenceTime = options.referenceTime || "2026-07-03T00:20:00.000Z";
  const readiness = contract.previewAcceptance?.readiness || {};
  const mounts = summarizeMounts(contract);
  const commands = mounts.map((mount) => {
    const syncEntry = providerSyncMatrix.find((entry) => entry.mount === mount.name) || {};
    const sourceMount = (contract?.mounts || []).find((entry) => entry.name === mount.name) || {};
    const stalenessMinutes = minutesSinceSync(
      sourceMount.providerContract?.syncMetadata?.lastSyncedAt || sourceMount.lastSyncedAt,
      referenceTime
    );
    const providerSynced = syncEntry.providerSynced === true;
    const stale = providerSynced
      && stalenessMinutes !== null
      && stalenessMinutes > lifecycle.maxStalenessMinutes;
    const disabled = lifecycle.enabled !== true
      || (providerSynced && lifecycle.allowDisableProviderSync === false);
    const command = disabled
      ? "memory.disable"
      : stale
        ? "memory.refresh"
        : providerSynced
          ? "memory.sync"
          : "memory.pin-local";
    return {
      mount: mount.name,
      command,
      enabled: !disabled,
      providerSynced,
      scheduleMode: providerSynced ? lifecycle.scheduleMode : "local-only",
      stalenessMinutes,
      maxStalenessMinutes: lifecycle.maxStalenessMinutes,
      stale,
      nextAction: disabled
        ? "enable-memory-lifecycle"
        : stale
          ? "refresh-provider-memory"
          : syncEntry.nextStep || "ready-for-runtime",
      blocksDispatch: disabled || stale,
      auditEvent: providerSynced
        ? "mailchimp.memory.provider_sync_control"
        : "mailchimp.memory.local_control"
    };
  });
  const invalidSettings = [];
  if (!["sync-before-dispatch", "sync-after-dispatch", "pin-local"].includes(lifecycle.command)) {
    invalidSettings.push("lifecycle.command");
  }
  if (!["provider-window", "immediate", "manual", "local-only"].includes(lifecycle.scheduleMode)) {
    invalidSettings.push("lifecycle.scheduleMode");
  }
  if (!Number.isInteger(lifecycle.maxStalenessMinutes) || lifecycle.maxStalenessMinutes < 1) {
    invalidSettings.push("lifecycle.maxStalenessMinutes");
  }
  const blockedMounts = commands
    .filter((command) => command.blocksDispatch)
    .map((command) => command.mount);

  return {
    protocol: "aios.testing.memory-lifecycle.mailchimp.v1",
    enabled: lifecycle.enabled === true,
    referenceTime,
    command: lifecycle.command,
    scheduleMode: lifecycle.scheduleMode,
    maxStalenessMinutes: lifecycle.maxStalenessMinutes,
    controls: commands,
    invalidSettings,
    blockedMounts,
    dispatchAllowed: readiness.acceptedForRuntime === true
      && invalidSettings.length === 0
      && blockedMounts.length === 0,
    nextAction: invalidSettings.length > 0
      ? "repair-memory-lifecycle-settings"
      : blockedMounts.length > 0
        ? "refresh-memory-before-dispatch"
        : "dispatch-runtime-handoff"
  };
}

function buildMemoryProviderServiceContract(contract, providerSyncMatrix, lifecycleControls, options = {}) {
  const serviceOptions = {
    provider: "mailchimp",
    service: "mailchimp-marketing",
    accountId: "acct-golden",
    dataCenter: "us20",
    externalRequestId: "memory-sync-golden-001",
    requiredCapabilities: [],
    ...(options.providerService || {})
  };
  const mounts = summarizeMounts(contract);
  const requiredCapabilities = Array.from(new Set([
    ...serviceOptions.requiredCapabilities,
    ...mounts.flatMap((mount) => mount.requiredCapabilities || [])
  ])).sort();
  const negotiatedCapabilities = Array.from(new Set(
    mounts.flatMap((mount) => mount.requiredCapabilities || [])
  )).sort();
  const missingCapabilities = requiredCapabilities
    .filter((capability) => !negotiatedCapabilities.includes(capability));
  const providerSyncedMounts = providerSyncMatrix
    .filter((entry) => entry.providerSynced)
    .map((entry) => entry.mount)
    .sort();
  const localOnlyMounts = providerSyncMatrix
    .filter((entry) => !entry.providerSynced)
    .map((entry) => entry.mount)
    .sort();
  const syncMetadata = mounts.map((mount) => {
    const control = (lifecycleControls.controls || []).find((entry) => entry.mount === mount.name) || {};
    return {
      mount: mount.name,
      syncDirection: mount.syncDirection,
      providerSynced: providerSyncedMounts.includes(mount.name),
      conflictPolicy: mount.conflictPolicy,
      stalenessMinutes: control.stalenessMinutes ?? null,
      stale: control.stale === true,
      externalHandoff: mount.externalHandoff,
      nextAction: control.nextAction || "ready-for-runtime"
    };
  });
  const staleMounts = syncMetadata
    .filter((entry) => entry.stale)
    .map((entry) => entry.mount);
  const writebackMounts = syncMetadata
    .filter((entry) => entry.externalHandoff === "stage-local-before-provider-write")
    .map((entry) => entry.mount)
    .sort();
  const ready = lifecycleControls.dispatchAllowed === true
    && staleMounts.length === 0
    && missingCapabilities.length === 0;

  return {
    protocol: "aios.testing.memory-provider-service.mailchimp.v1",
    provider: serviceOptions.provider,
    service: serviceOptions.service,
    accountId: serviceOptions.accountId,
    dataCenter: serviceOptions.dataCenter,
    externalRequestId: serviceOptions.externalRequestId,
    capabilityNegotiation: {
      required: requiredCapabilities,
      negotiated: negotiatedCapabilities,
      missing: missingCapabilities,
      satisfied: missingCapabilities.length === 0
    },
    sync: {
      ready,
      mode: lifecycleControls.scheduleMode || "provider-window",
      providerSyncedMounts,
      localOnlyMounts,
      staleMounts,
      writebackMounts,
      metadata: syncMetadata
    },
    externalHandoff: {
      state: ready ? "linked" : "degraded",
      ready,
      requestId: serviceOptions.externalRequestId,
      nextAction: ready
        ? "dispatch-runtime-handoff"
        : missingCapabilities.length > 0
          ? "renegotiate-memory-capabilities"
          : staleMounts.length > 0
            ? "refresh-provider-memory"
            : lifecycleControls.nextAction || "repair-memory-provider-contract"
    },
    exportSummary: {
      providerSyncedCount: providerSyncedMounts.length,
      localOnlyCount: localOnlyMounts.length,
      writebackCount: writebackMounts.length,
      staleCount: staleMounts.length,
      missingCapabilityCount: missingCapabilities.length,
      ready
    }
  };
}

export function buildMailchimpMemoryFixture(source = MAILCHIMP_CAMPAIGN_MEMORY_FIXTURE_SOURCE, options = {}) {
  const compileOptions = {
    ...MAILCHIMP_CAMPAIGN_MEMORY_FIXTURE_OPTIONS,
    ...options
  };
  const contract = compileMailchimpMemoryMounts(source, compileOptions);
  const rollbackPlan = compileRollbackMemoryPlan("mailchimp.campaign-runtime-golden", contract);
  const mounts = summarizeMounts(contract);
  const providerSyncMatrix = buildProviderSyncMatrix(contract);
  const lifecycleControls = buildMemoryLifecycleControls(contract, providerSyncMatrix, compileOptions);
  const providerServiceContract = buildMemoryProviderServiceContract(
    contract,
    providerSyncMatrix,
    lifecycleControls,
    compileOptions
  );
  const campaignDraft = mountByName(contract, "campaignDraft");
  const verifierEvidence = mountByName(contract, "verifierEvidence");

  return {
    kind: "aios.testing.mailchimpMemoryFixture",
    provider: "mailchimp",
    contract,
    rollbackPlan,
    expected: {
      mounts,
      providerSyncMatrix,
      lifecycleControls,
      providerServiceContract,
      readiness: contract.previewAcceptance?.readiness || null,
      validationSummary: contract.previewAcceptance?.validationSummary || null,
      campaignDraftPath: campaignDraft?.path || null,
      verifierEvidencePath: verifierEvidence?.path || null,
      rollbackJournalPath: rollbackPlan.journalPath,
      providerSyncMounts: providerSyncMatrix
        .filter((entry) => entry.providerSynced)
        .map((entry) => entry.mount),
      localOnlyMounts: providerSyncMatrix
        .filter((entry) => !entry.providerSynced)
        .map((entry) => entry.mount)
    }
  };
}

export function assertMailchimpMemoryFixture(fixture = buildMailchimpMemoryFixture()) {
  const contract = fixture.contract || {};
  const expected = fixture.expected || {};
  const diagnostics = contract.diagnostics || [];
  const errorCodes = diagnostics
    .filter((diagnostic) => diagnostic.level === "error")
    .map((diagnostic) => diagnostic.code);
  const missingRequiredMounts = ["campaignDraft", "audienceSnapshot", "verifierEvidence", "rollbackJournal"]
    .filter((name) => !(expected.mounts || []).some((mount) => mount.name === name));
  const providerSyncWithoutCapabilities = (expected.providerSyncMatrix || [])
    .filter((entry) => entry.providerSynced && entry.requiredCapabilities.length === 0)
    .map((entry) => entry.mount);
  const localOnlyWithHandoff = (expected.mounts || [])
    .filter((mount) => mount.syncDirection === "local-only" && mount.externalHandoff !== "not-required")
    .map((mount) => mount.name);
  const lifecycleControls = expected.lifecycleControls || {};
  const providerServiceContract = expected.providerServiceContract || {};
  const lifecycleControlMounts = (lifecycleControls.controls || []).map((control) => control.mount);
  const missingLifecycleControls = (expected.mounts || [])
    .filter((mount) => !lifecycleControlMounts.includes(mount.name))
    .map((mount) => mount.name);
  const providerServiceMounts = providerServiceContract.sync?.metadata || [];
  const missingProviderServiceMounts = (expected.mounts || [])
    .filter((mount) => !providerServiceMounts.some((entry) => entry.mount === mount.name))
    .map((mount) => mount.name);
  const providerMissingCapabilities = providerServiceContract.capabilityNegotiation?.missing || [];

  return {
    ok: contract.kind === "aios.memoryContract"
      && contract.provider === "mailchimp"
      && expected.readiness?.acceptedForRuntime === true
      && expected.readiness?.acceptedForProviderSync === true
      && expected.campaignDraftPath === "memory://mailchimp/campaign-draft"
      && expected.verifierEvidencePath === "memory://mailchimp/verifier-evidence"
      && fixture.rollbackPlan?.canRollbackExternalWrite === false
      && missingRequiredMounts.length === 0
      && providerSyncWithoutCapabilities.length === 0
      && localOnlyWithHandoff.length === 0
      && errorCodes.length === 0
      && lifecycleControls.protocol === "aios.testing.memory-lifecycle.mailchimp.v1"
      && lifecycleControls.dispatchAllowed === true
      && missingLifecycleControls.length === 0
      && providerServiceContract.protocol === "aios.testing.memory-provider-service.mailchimp.v1"
      && providerServiceContract.capabilityNegotiation?.satisfied === true
      && providerServiceContract.sync?.ready === true
      && providerServiceContract.externalHandoff?.state === "linked"
      && missingProviderServiceMounts.length === 0,
    mountCount: expected.mounts?.length || 0,
    providerSyncMounts: expected.providerSyncMounts || [],
    localOnlyMounts: expected.localOnlyMounts || [],
    missingRequiredMounts,
    providerSyncWithoutCapabilities,
    localOnlyWithHandoff,
    errorCodes,
    missingLifecycleControls,
    missingProviderServiceMounts,
    providerMissingCapabilities,
    providerServiceReady: providerServiceContract.sync?.ready === true,
    providerServiceHandoffState: providerServiceContract.externalHandoff?.state || "unknown",
    lifecycleNextAction: lifecycleControls.nextAction || null,
    lifecycleBlockedMounts: lifecycleControls.blockedMounts || [],
    rollbackJournalPath: expected.rollbackJournalPath || null
  };
}

export const MAILCHIMP_MEMORY_GOLDEN = buildMailchimpMemoryFixture();
export const MAILCHIMP_MEMORY_GOLDEN_CHECK = assertMailchimpMemoryFixture(MAILCHIMP_MEMORY_GOLDEN);
