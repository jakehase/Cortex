import {
  createAuditExportSnapshot,
  createEvidence,
  createProviderSyncEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
} from "../stdlib/audit.mjs";
import {
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";

export const artifactAuditJobSource = `# deterministic Mailchimp artifact audit export job
use mailchimp:campaign.read
use memory:campaign.local
use verifier:evidence.record
use audit:truth-boundary.write
use status:timeline.write
recover rollback=snapshot retry=1
step collect-artifact-index input=campaignId output=artifactIndex verify.intent=read-only
step fetch-artifact-metadata input=artifactIndex output=artifactMetadata verify.source=mailchimp
step verify-artifact-boundary input=artifactMetadata output=auditClaim verify.truth=local-only
step export-artifact-audit input=auditClaim output=statusEvent verify.boundary=no-external-write
`;

export function buildArtifactAuditProgram(options = {}) {
  return compilePackageSource(artifactAuditJobSource, {
    name: options.name ?? "mailchimp-artifact-audit-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp artifact audit job that exports local truth-boundary evidence.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      artifactAudit: "./examples/artifact-audit-job.mjs#buildArtifactAuditContract",
      selfCheck: "./examples/artifact-audit-job.mjs#selfCheckArtifactAuditJob",
    },
  }, {
    name: "mailchimp-artifact-audit-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: true,
      requireApproval: options.requireApproval ?? false,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 12,
    },
  });
}

export function buildArtifactAuditReport(program = buildArtifactAuditProgram(), options = {}) {
  const missing = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missing.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.source") ? "mailchimp-read-receipt" : "runtime-local-receipt",
      subject,
      { example: "artifact-audit-job", artifactSet: options.artifactSet ?? "campaign-artifacts" },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "artifact audit queued" }),
      createStatusEvent("running", { at: "logical:1", message: "artifact metadata collected" }),
      createStatusEvent("verifying", { at: "logical:2", message: "artifact boundary verified" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "artifact audit export prepared",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildArtifactAuditContract(
  program = buildArtifactAuditProgram(),
  audit = buildArtifactAuditReport(program),
  options = {},
) {
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const providerContract = buildProviderServiceContract(program, {
    checkpoint: exportSnapshot.exportId,
    providerResource: "artifact-audit",
    supportedCapabilities: options.supportedCapabilities,
  });
  const providerSyncEvidence = createProviderSyncEvidence(audit, providerContract, {
    generatedAt: options.syncEvidenceAt ?? "logical:5",
  });
  const lifecycleControls = buildArtifactLifecycleControls(program, options);
  const integrationContract = buildArtifactProviderIntegrationContract(
    program,
    providerContract,
    providerSyncEvidence,
    exportSnapshot,
    options,
  );
  const artifactState = buildArtifactState(
    program,
    audit,
    exportSnapshot,
    providerSyncEvidence,
    lifecycleControls,
    integrationContract,
    options,
  );
  const previewAcceptance = buildArtifactPreviewAcceptance(
    program,
    audit,
    artifactState,
    lifecycleControls,
    integrationContract,
    options,
  );
  const clientRuntimeState = buildArtifactClientRuntimeState(
    program,
    artifactState,
    lifecycleControls,
    integrationContract,
    previewAcceptance,
    options,
  );
  const persistedState = buildArtifactPersistedState(
    program,
    audit,
    artifactState,
    lifecycleControls,
    integrationContract,
    previewAcceptance,
    clientRuntimeState,
    options,
  );
  const clientCommandEnvelope = buildArtifactClientCommandEnvelope(
    program,
    audit,
    artifactState,
    lifecycleControls,
    integrationContract,
    previewAcceptance,
    clientRuntimeState,
    persistedState,
    options,
  );

  return deepFreeze({
    kind: "mailchimp.artifact-audit.contract",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    artifactState,
    previewAcceptance,
    clientRuntimeState,
    persistedState,
    clientCommandEnvelope,
    lifecycleControls,
    integrationContract,
    audit: {
      report: audit,
      exportSnapshot,
      providerSyncEvidence,
    },
    provider: providerContract.provider,
    runtimeHandoff: {
      ready: previewAcceptance.readiness.ready,
      command: previewAcceptance.nextAction.command,
      handoffToken: previewAcceptance.readiness.ready ? providerContract.handoffState.handoffToken : null,
      clientRequestId: clientRuntimeState.request.requestId,
      restartKey: persistedState.snapshot.restartKey,
      idempotencyKey: persistedState.command.idempotencyKey,
      lifecycleControlCommand: lifecycleControls.controlIntent.nextAction.command,
      lifecycleControlIdempotencyKey: lifecycleControls.controlIntent.idempotencyKey,
      lifecycleSettingsChanged: lifecycleControls.settingsChange.changedFields,
      recoveryCommand: persistedState.recovery.nextCommand,
      commandEnvelopeKey: clientCommandEnvelope.envelopeKey,
      commandEnvelopeFingerprint: clientCommandEnvelope.fingerprint,
      commandEnvelopePrimary: clientCommandEnvelope.commands.primary.command,
      commandEnvelopeStatus: clientCommandEnvelope.status.phase,
      commandSubmissionDecision: clientCommandEnvelope.submissionGuard.decision,
      commandSubmissionCommand: clientCommandEnvelope.submissionGuard.command,
      commandSubmissionReplaySafe: clientCommandEnvelope.submissionGuard.replaySafe,
      blockedReasons: previewAcceptance.readiness.blockedReasons,
    },
    nextSteps: buildArtifactNextSteps(artifactState, previewAcceptance),
  });
}

export function describeArtifactAuditJob(options = {}) {
  const contract = buildArtifactAuditContract(undefined, undefined, options);
  return deepFreeze({
    jobId: contract.jobId,
    ready: contract.artifactState.ready,
    artifactSet: contract.artifactState.artifactSet,
    lifecycleControls: contract.lifecycleControls,
    clientRuntimeState: contract.clientRuntimeState.summary,
    persistedState: contract.persistedState.summary,
    clientCommandEnvelope: contract.clientCommandEnvelope.summary,
    commandSubmissionGuard: contract.clientCommandEnvelope.submissionGuard,
    integrationContract: contract.integrationContract.summary,
    previewAcceptance: contract.previewAcceptance.summary,
    exportId: contract.audit.exportSnapshot.exportId,
    blockedReasons: contract.previewAcceptance.readiness.blockedReasons,
    nextSteps: contract.nextSteps,
  });
}

export function selfCheckArtifactAuditJob(options = {}) {
  const contract = buildArtifactAuditContract(undefined, undefined, options);

  return deepFreeze({
    kind: "mailchimp.artifact-audit.self-check",
    apiVersion: "aios.example/v1",
    passed: contract.artifactState.ready,
    jobId: contract.jobId,
    commandEnvelopeReady: contract.clientCommandEnvelope.validation.ready,
    commandEnvelopePrimary: contract.clientCommandEnvelope.commands.primary.command,
    commandSubmissionGuarded: contract.clientCommandEnvelope.submissionGuard.externalWritesAllowed === false
      && contract.clientCommandEnvelope.submissionGuard.idempotent === true
      && contract.clientCommandEnvelope.submissionGuard.clientCanSubmit === contract.clientCommandEnvelope.commands.primary.enabled,
    blockedReasons: contract.artifactState.blockedReasons,
  });
}

function buildArtifactState(
  program,
  audit,
  exportSnapshot,
  providerSyncEvidence,
  lifecycleControls,
  integrationContract,
  options,
) {
  const artifactSet = String(options.artifactSet ?? "campaign-artifacts");
  const expectedKinds = uniqueSorted(options.expectedKinds ?? [
    "campaign",
    "report",
    "local-status",
  ]);
  const observedKinds = uniqueSorted(options.observedKinds ?? expectedKinds);
  const missingKinds = expectedKinds.filter((kind) => !observedKinds.includes(kind));
  const blockedReasons = uniqueSorted([
    ...(program.lifecycle.validation.valid ? [] : program.lifecycle.validation.errors),
    ...(audit.evidence.missing.length === 0 ? [] : audit.evidence.missing.map((subject) => `missing artifact evidence: ${subject}`)),
    ...(audit.boundary.externalWritesObserved.length === 0 ? [] : [`${audit.boundary.externalWritesObserved.length} external write violation(s) observed`]),
    ...(exportSnapshot.truthBoundary.readyForExport ? [] : [exportSnapshot.summary]),
    ...(providerSyncEvidence.readiness.ready ? [] : providerSyncEvidence.readiness.blockedReasons),
    ...lifecycleControls.blockedReasons,
    ...integrationContract.blockedReasons,
    ...missingKinds.map((kind) => `artifact kind missing from audit export: ${kind}`),
  ]);

  return {
    ready: blockedReasons.length === 0,
    artifactSet,
    expectedKinds,
    observedKinds,
    missingKinds,
    exportId: exportSnapshot.exportId,
    providerSyncReceipt: providerSyncEvidence.receipt,
    providerSync: integrationContract.summary,
    counters: exportSnapshot.counters,
    validationSummary: {
      expectedKindCount: expectedKinds.length,
      observedKindCount: observedKinds.length,
      missingKindCount: missingKinds.length,
      evidencePresent: audit.evidence.present.length,
      evidenceMissing: audit.evidence.missing.length,
      externalWrites: audit.boundary.externalWritesObserved.length,
      providerReady: providerSyncEvidence.readiness.ready && integrationContract.ready,
    },
    nextAction: lifecycleControls.nextAction,
    blockedReasons,
  };
}

function buildArtifactProviderIntegrationContract(program, providerContract, providerSyncEvidence, exportSnapshot, options) {
  const requiredCapabilities = uniqueSorted(options.requiredProviderCapabilities ?? [
    "mailchimp:campaign.read",
    "verifier:evidence.record",
    "status:timeline.write",
  ]);
  const grantedCapabilities = uniqueSorted(providerContract.negotiation.grantedCapabilities);
  const grantSet = new Set(grantedCapabilities);
  const missingCapabilities = requiredCapabilities.filter((capability) => !grantSet.has(capability));
  const providerStatus = normalizeProviderStatus(options.providerStatus ?? "connected");
  const syncMode = normalizeSyncMode(options.syncMode ?? "checkpoint");
  const externalHandoff = normalizeExternalHandoff(options.externalHandoff);
  const syncMetadata = {
    checkpoint: exportSnapshot.exportId,
    syncEvidenceId: providerSyncEvidence.receipt,
    generatedAt: String(options.syncEvidenceAt ?? "logical:5"),
    providerResource: "artifact-audit",
    mode: syncMode,
    cursor: options.syncCursor ? String(options.syncCursor) : null,
    lastSyncedAt: options.lastSyncedAt ? String(options.lastSyncedAt) : null,
  };
  const blockedReasons = uniqueSorted([
    ...(providerStatus === "connected" ? [] : [`artifact provider status is ${providerStatus}`]),
    ...(providerSyncEvidence.readiness.ready ? [] : providerSyncEvidence.readiness.blockedReasons),
    ...missingCapabilities.map((capability) => `artifact provider capability missing: ${capability}`),
    ...externalHandoff.blockedReasons,
    ...(syncMode === "realtime" && !grantedCapabilities.includes("status:timeline.write")
      ? ["realtime artifact sync requires status timeline capability"]
      : []),
  ]);
  const ready = blockedReasons.length === 0;
  const handoffCommand = ready
    ? externalHandoff.command
    : providerStatus === "connected"
      ? "artifact.provider.negotiate"
      : "artifact.provider.reconnect";

  return {
    ready,
    provider: providerContract.provider,
    negotiation: {
      requiredCapabilities,
      grantedCapabilities,
      missingCapabilities,
      fullyGranted: missingCapabilities.length === 0,
    },
    syncMetadata,
    externalHandoff: {
      ...externalHandoff,
      command: handoffCommand,
      token: ready ? providerContract.handoffState.handoffToken : null,
    },
    summary: {
      ready,
      providerStatus,
      syncMode,
      checkpoint: syncMetadata.checkpoint,
      missingCapabilityCount: missingCapabilities.length,
      handoffCommand,
    },
    blockedReasons,
  };
}

function buildArtifactLifecycleControls(program, options) {
  const enabled = Boolean(options.enabled ?? program.lifecycle.enabled);
  const requestedCommand = String(options.command ?? (enabled ? "artifact.audit.export" : "artifact.audit.enable")).trim();
  const schedule = normalizeAuditSchedule(options.schedule ?? program.lifecycle.schedule);
  const retentionDays = normalizeRetentionDays(options.retentionDays ?? 30);
  const settingsChange = normalizeArtifactSettingsChange(options.settingsChange, {
    enabled,
    schedule: schedule.value,
    retentionDays,
    exportFormat: options.exportFormat ?? "json.summary",
    requireApproval: options.requireApproval ?? program.lifecycle.requireApproval,
  });
  const controlIntent = buildArtifactLifecycleControlIntent(
    program,
    requestedCommand,
    enabled,
    schedule,
    retentionDays,
    settingsChange,
    options,
  );
  const allowedCommands = enabled
    ? [
      "artifact.audit.disable",
      "artifact.audit.export",
      "artifact.audit.reschedule",
      "artifact.audit.review",
      "artifact.audit.review-settings",
      "artifact.audit.approve-settings",
    ]
    : ["artifact.audit.enable", "artifact.audit.review", "artifact.audit.review-settings", "artifact.audit.approve-settings"];
  const commandAllowed = allowedCommands.includes(requestedCommand);
  const blockedReasons = uniqueSorted([
    ...(enabled ? [] : ["artifact audit workflow is disabled"]),
    ...(schedule.valid ? [] : schedule.errors),
    ...(commandAllowed ? [] : [`artifact audit command not allowed in current lifecycle: ${requestedCommand}`]),
    ...settingsChange.blockedReasons,
    ...controlIntent.blockedReasons,
  ]);
  const nextAction = blockedReasons.length === 0
    ? requestedCommand
    : controlIntent.blockedReasons.length > 0
      ? controlIntent.nextAction.command
    : !enabled
      ? "artifact.audit.enable"
      : schedule.valid
        ? "artifact.audit.review"
        : "artifact.audit.reschedule";

  return {
    enabled,
    requestedCommand,
    allowedCommands,
    commandAllowed,
    schedule: schedule.value,
    retentionDays,
    settings: {
      exportFormat: String(options.exportFormat ?? "json.summary"),
      requireApproval: Boolean(options.requireApproval ?? program.lifecycle.requireApproval),
      dryRun: Boolean(program.lifecycle.dryRun),
    },
    settingsChange,
    controlIntent,
    nextAction,
    blockedReasons,
  };
}

function normalizeArtifactSettingsChange(change = {}, current) {
  const patch = change && typeof change === "object" ? change : {};
  const hasEnabled = Object.prototype.hasOwnProperty.call(patch, "enabled");
  const hasSchedule = Object.prototype.hasOwnProperty.call(patch, "schedule");
  const hasRetention = Object.prototype.hasOwnProperty.call(patch, "retentionDays");
  const hasExportFormat = Object.prototype.hasOwnProperty.call(patch, "exportFormat");
  const hasApproval = Object.prototype.hasOwnProperty.call(patch, "requireApproval");
  const nextEnabled = hasEnabled ? Boolean(patch.enabled) : current.enabled;
  const nextSchedule = hasSchedule ? normalizeAuditSchedule(patch.schedule) : {
    valid: true,
    value: current.schedule,
    errors: [],
  };
  const nextRetentionDays = hasRetention
    ? normalizeRetentionDays(patch.retentionDays)
    : current.retentionDays;
  const nextExportFormat = String(patch.exportFormat ?? current.exportFormat).trim();
  const nextRequireApproval = hasApproval
    ? Boolean(patch.requireApproval)
    : Boolean(current.requireApproval);
  const invalidFields = uniqueSorted([
    ...(nextSchedule.valid ? [] : ["schedule"]),
    ...(nextExportFormat ? [] : ["exportFormat"]),
    ...(nextRetentionDays < 1 || nextRetentionDays > 365 ? ["retentionDays"] : []),
  ]);
  const changedFields = uniqueSorted([
    ...(hasEnabled && nextEnabled !== current.enabled ? ["enabled"] : []),
    ...(hasSchedule && JSON.stringify(nextSchedule.value) !== JSON.stringify(current.schedule) ? ["schedule"] : []),
    ...(hasRetention && nextRetentionDays !== current.retentionDays ? ["retentionDays"] : []),
    ...(hasExportFormat && nextExportFormat !== String(current.exportFormat) ? ["exportFormat"] : []),
    ...(hasApproval && nextRequireApproval !== Boolean(current.requireApproval) ? ["requireApproval"] : []),
  ]);
  const blockedReasons = uniqueSorted([
    ...nextSchedule.errors,
    ...invalidFields.map((field) => `artifact audit setting is invalid: ${field}`),
  ]);

  return {
    requested: Object.keys(patch).length > 0,
    valid: blockedReasons.length === 0,
    changedFields,
    invalidFields,
    nextSettings: {
      enabled: nextEnabled,
      schedule: nextSchedule.value,
      retentionDays: nextRetentionDays,
      exportFormat: nextExportFormat,
      requireApproval: nextRequireApproval,
    },
    blockedReasons,
  };
}

function buildArtifactLifecycleControlIntent(
  program,
  requestedCommand,
  enabled,
  schedule,
  retentionDays,
  settingsChange,
  options,
) {
  const mutationCommands = new Set([
    "artifact.audit.disable",
    "artifact.audit.enable",
    "artifact.audit.reschedule",
  ]);
  const isMutation = mutationCommands.has(requestedCommand) || settingsChange.requested;
  const requiresApproval = Boolean(options.requireApproval ?? program.lifecycle.requireApproval);
  const approved = !requiresApproval || Boolean(options.settingsApproved ?? options.accepted);
  const commandEffect = requestedCommand === "artifact.audit.enable"
    ? "enable"
    : requestedCommand === "artifact.audit.disable"
      ? "disable"
      : requestedCommand === "artifact.audit.reschedule" || settingsChange.changedFields.includes("schedule")
        ? "reschedule"
        : settingsChange.changedFields.includes("retentionDays")
          ? "retention"
          : "export";
  const targetEnabled = commandEffect === "enable"
    ? true
    : commandEffect === "disable"
      ? false
      : settingsChange.nextSettings.enabled;
  const retentionChanged = settingsChange.changedFields.includes("retentionDays");
  const blockedReasons = uniqueSorted([
    ...(schedule.valid ? [] : schedule.errors),
    ...(settingsChange.valid ? [] : settingsChange.blockedReasons),
    ...(isMutation && requiresApproval && !approved
      ? ["artifact audit lifecycle setting change requires approval"]
      : []),
    ...(commandEffect === "reschedule" && settingsChange.nextSettings.schedule.mode === "manual"
      ? ["artifact audit reschedule requires interval or cron schedule"]
      : []),
    ...(retentionChanged && settingsChange.nextSettings.retentionDays < retentionDays && !approved
      ? ["artifact audit retention reduction requires explicit operator approval"]
      : []),
  ]);
  const acceptedCommand = blockedReasons.length === 0
    ? requestedCommand
    : requiresApproval && !approved
      ? "artifact.audit.approve-settings"
      : commandEffect === "reschedule"
        ? "artifact.audit.reschedule"
        : "artifact.audit.review-settings";
  const settingsFingerprint = [
    targetEnabled,
    settingsChange.nextSettings.schedule.mode,
    settingsChange.nextSettings.schedule.everyMinutes ?? settingsChange.nextSettings.schedule.expression ?? "manual",
    settingsChange.nextSettings.retentionDays,
    settingsChange.nextSettings.exportFormat,
    settingsChange.nextSettings.requireApproval,
  ].join(":");

  return {
    kind: "mailchimp.artifact-audit.lifecycle-control-intent",
    apiVersion: "aios.example/v1",
    requestedCommand,
    effect: commandEffect,
    mutatesSettings: isMutation,
    approved,
    targetEnabled,
    targetSchedule: settingsChange.nextSettings.schedule,
    targetRetentionDays: settingsChange.nextSettings.retentionDays,
    changedFields: settingsChange.changedFields,
    idempotencyKey: `${program.job.id}:lifecycle:${acceptedCommand}:${settingsFingerprint}`,
    acceptedCommand,
    nextAction: {
      command: acceptedCommand,
      enabled: blockedReasons.length === 0 || acceptedCommand === "artifact.audit.approve-settings",
      reason: blockedReasons[0] ?? `artifact audit lifecycle ${commandEffect} accepted`,
    },
    blockedReasons,
  };
}

function buildArtifactPreviewAcceptance(program, audit, artifactState, lifecycleControls, integrationContract, options) {
  const accepted = Boolean(options.accepted ?? false);
  const acceptedBy = accepted ? String(options.acceptedBy ?? "operator") : null;
  const acceptedAt = accepted ? String(options.acceptedAt ?? "logical:acceptance") : null;
  const previewLimit = normalizePreviewLimit(options.previewLimit ?? 5);
  const artifactRows = normalizeArtifactPreviewRows(options.artifacts, artifactState.observedKinds, previewLimit);
  const visibleBlockedReasons = uniqueSorted([
    ...artifactState.blockedReasons,
    ...(accepted ? [] : ["artifact audit preview acceptance required before export handoff"]),
  ]);
  const readiness = {
    ready: artifactState.ready && accepted,
    artifactReady: artifactState.ready,
    accepted,
    providerReady: integrationContract.ready,
    lifecycleReady: lifecycleControls.blockedReasons.length === 0,
    validationReady: artifactState.validationSummary.missingKindCount === 0
      && artifactState.validationSummary.evidenceMissing === 0
      && artifactState.validationSummary.externalWrites === 0,
    blockedReasons: visibleBlockedReasons,
  };
  const validationCards = [
    {
      key: "artifact-kinds",
      label: "Artifact kinds",
      status: artifactState.missingKinds.length === 0 ? "ready" : "missing",
      detail: artifactState.missingKinds.length === 0
        ? `${artifactState.observedKinds.length} expected artifact kind(s) observed`
        : `Missing artifact kind(s): ${artifactState.missingKinds.join(", ")}`,
    },
    {
      key: "evidence",
      label: "Evidence receipts",
      status: audit.evidence.missing.length === 0 ? "ready" : "missing",
      detail: audit.evidence.missing.length === 0
        ? `${audit.evidence.present.length} evidence receipt(s) present`
        : `${audit.evidence.missing.length} evidence receipt(s) missing`,
    },
    {
      key: "provider-sync",
      label: "Provider sync",
      status: integrationContract.ready ? "ready" : "blocked",
      detail: integrationContract.ready
        ? `Sync checkpoint ${integrationContract.syncMetadata.checkpoint} is ready`
        : integrationContract.blockedReasons[0] ?? "Provider sync requires review",
    },
    {
      key: "truth-boundary",
      label: "Truth boundary",
      status: audit.boundary.externalWritesObserved.length === 0 ? "ready" : "blocked",
      detail: audit.boundary.externalWritesObserved.length === 0
        ? "No external write violations observed"
        : `${audit.boundary.externalWritesObserved.length} external write violation(s) observed`,
    },
  ];
  const nextAction = readiness.ready
    ? {
      command: lifecycleControls.requestedCommand,
      label: "Export accepted artifact audit",
      reason: "preview accepted and artifact audit is ready",
    }
    : !accepted
      ? {
        command: "artifact.audit.accept-preview",
        label: "Accept artifact audit preview",
        reason: "operator acceptance is required before export handoff",
      }
      : {
        command: artifactState.nextAction,
        label: "Resolve artifact audit blocker",
        reason: visibleBlockedReasons[0] ?? "artifact audit requires review",
      };

  return {
    summary: {
      ready: readiness.ready,
      accepted,
      artifactSet: artifactState.artifactSet,
      previewRowCount: artifactRows.length,
      validationCardCount: validationCards.length,
      nextAction: nextAction.command,
      blockedCount: visibleBlockedReasons.length,
    },
    preview: {
      title: `Mailchimp artifact audit: ${artifactState.artifactSet}`,
      exportId: artifactState.exportId,
      packageName: program.manifest.name,
      rows: artifactRows,
      validationCards,
      emptyState: artifactRows.length === 0
        ? "No artifact preview rows were supplied for this audit export"
        : null,
    },
    acceptance: {
      required: true,
      accepted,
      acceptedBy,
      acceptedAt,
      receipt: accepted ? `artifact-acceptance:${artifactState.exportId}:${acceptedBy}` : null,
      blockedReasons: accepted ? [] : ["artifact audit preview acceptance required before export handoff"],
    },
    readiness,
    nextAction,
    explainability: {
      providerStatus: integrationContract.summary.providerStatus,
      syncMode: integrationContract.summary.syncMode,
      missingKinds: artifactState.missingKinds,
      providerBlockedReasons: integrationContract.blockedReasons,
      lifecycleBlockedReasons: lifecycleControls.blockedReasons,
    },
  };
}

function buildArtifactClientRuntimeState(
  program,
  artifactState,
  lifecycleControls,
  integrationContract,
  previewAcceptance,
  options,
) {
  const request = normalizeArtifactClientRequest(options.clientRequest);
  const routeState = normalizeArtifactRouteState(options.routeState);
  const visibleActions = buildArtifactVisibleActions(
    artifactState,
    lifecycleControls,
    integrationContract,
    previewAcceptance,
  );
  const selectedAction = visibleActions.find((action) => action.command === previewAcceptance.nextAction.command)
    ?? visibleActions[0]
    ?? {
      command: previewAcceptance.nextAction.command,
      label: previewAcceptance.nextAction.label,
      disabled: !previewAcceptance.readiness.ready,
      disabledReason: previewAcceptance.nextAction.reason,
    };
  const blockedReasons = uniqueSorted([
    ...previewAcceptance.readiness.blockedReasons,
    ...(request.valid ? [] : request.errors),
    ...(routeState.valid ? [] : routeState.errors),
  ]);
  const ready = blockedReasons.length === 0 && previewAcceptance.readiness.ready;

  return {
    ready,
    request,
    routeState,
    visibleActions,
    selectedAction,
    summary: {
      ready,
      requestId: request.requestId,
      routeName: routeState.name,
      selectedCommand: selectedAction.command,
      visibleActionCount: visibleActions.length,
      blockedCount: blockedReasons.length,
      artifactSet: artifactState.artifactSet,
      packageName: program.manifest.name,
    },
    adoption: {
      mode: ready ? "commit" : "review",
      clientWritable: false,
      cacheKey: `${routeState.name}:${artifactState.exportId}:${request.requestId}`,
      statusChannel: `status:${program.job.id}`,
      handoffTarget: integrationContract.externalHandoff.target,
      handoffCommand: ready ? integrationContract.externalHandoff.command : selectedAction.command,
    },
    blockedReasons,
  };
}

function buildArtifactPersistedState(
  program,
  audit,
  artifactState,
  lifecycleControls,
  integrationContract,
  previewAcceptance,
  clientRuntimeState,
  options,
) {
  const priorSnapshot = normalizeArtifactPersistedSnapshot(options.persistedState);
  const command = normalizeArtifactCommandReceipt(
    options.commandReceipt,
    previewAcceptance.nextAction.command,
    clientRuntimeState.request.requestId,
  );
  const version = priorSnapshot.version + 1;
  const restartKey = [
    program.job.id,
    artifactState.exportId,
    clientRuntimeState.request.requestId,
    version,
  ].join(":");
  const status = previewAcceptance.readiness.ready
    ? "ready"
    : command.replayed
      ? "replayed"
      : priorSnapshot.status === "in-flight"
        ? "recovering"
        : "blocked";
  const blockedReasons = uniqueSorted([
    ...previewAcceptance.readiness.blockedReasons,
    ...clientRuntimeState.blockedReasons,
    ...command.blockedReasons,
    ...(priorSnapshot.exportId && priorSnapshot.exportId !== artifactState.exportId
      ? [`persisted artifact export changed from ${priorSnapshot.exportId} to ${artifactState.exportId}`]
      : []),
  ]);
  const recovery = buildArtifactRecoveryPlan(
    status,
    blockedReasons,
    command,
    lifecycleControls,
    integrationContract,
    previewAcceptance,
  );
  const snapshot = {
    schema: "mailchimp.artifact-audit.persisted-state/v1",
    version,
    restartKey,
    previousRestartKey: priorSnapshot.restartKey,
    jobId: program.job.id,
    exportId: artifactState.exportId,
    artifactSet: artifactState.artifactSet,
    requestId: clientRuntimeState.request.requestId,
    status,
    ready: blockedReasons.length === 0 && previewAcceptance.readiness.ready,
    accepted: previewAcceptance.acceptance.accepted,
    providerStatus: integrationContract.summary.providerStatus,
    handoffCommand: integrationContract.externalHandoff.command,
    selectedCommand: clientRuntimeState.selectedAction.command,
    commandIdempotencyKey: command.idempotencyKey,
    auditStatus: audit.status,
    counters: {
      evidencePresent: audit.evidence.present.length,
      evidenceMissing: audit.evidence.missing.length,
      externalWrites: audit.boundary.externalWritesObserved.length,
      missingKinds: artifactState.missingKinds.length,
      blockedReasons: blockedReasons.length,
    },
    savedAt: String(options.persistedAt ?? options.generatedAt ?? "logical:persisted"),
  };

  return {
    ready: snapshot.ready,
    snapshot,
    command,
    recovery,
    summary: {
      ready: snapshot.ready,
      status,
      version,
      restartKey,
      idempotencyKey: command.idempotencyKey,
      replayed: command.replayed,
      recoveryCommand: recovery.nextCommand,
      blockedCount: blockedReasons.length,
    },
    blockedReasons,
  };
}

function buildArtifactRecoveryPlan(
  status,
  blockedReasons,
  command,
  lifecycleControls,
  integrationContract,
  previewAcceptance,
) {
  const recoverable = status !== "ready" && !blockedReasons.some((reason) => (
    reason.includes("external write") || reason.includes("unsupported")
  ));
  const nextCommand = status === "ready"
    ? integrationContract.externalHandoff.command
    : command.replayed
      ? "artifact.audit.replay-status"
      : recoverable
        ? lifecycleControls.nextAction
        : "artifact.audit.manual-review";

  return {
    recoverable,
    nextCommand,
    statusEvent: status === "ready"
      ? "artifact-audit-ready"
      : recoverable
        ? "artifact-audit-recoverable"
        : "artifact-audit-blocked",
    resumeToken: recoverable
      ? `${command.idempotencyKey}:${previewAcceptance.acceptance.receipt ?? "pending"}`
      : null,
    blockedReasons,
  };
}

function buildArtifactVisibleActions(artifactState, lifecycleControls, integrationContract, previewAcceptance) {
  const baseActions = [
    {
      command: "artifact.audit.accept-preview",
      label: "Accept preview",
      disabled: previewAcceptance.acceptance.accepted,
      disabledReason: previewAcceptance.acceptance.accepted ? "artifact audit preview already accepted" : null,
    },
    {
      command: lifecycleControls.enabled ? "artifact.audit.disable" : "artifact.audit.enable",
      label: lifecycleControls.enabled ? "Disable audit" : "Enable audit",
      disabled: false,
      disabledReason: null,
    },
    {
      command: "artifact.audit.reschedule",
      label: "Reschedule audit",
      disabled: lifecycleControls.schedule.mode === "manual",
      disabledReason: lifecycleControls.schedule.mode === "manual"
        ? "manual artifact audits do not have a runtime schedule"
        : null,
    },
    {
      command: integrationContract.externalHandoff.command,
      label: "Sync provider",
      disabled: !integrationContract.ready,
      disabledReason: integrationContract.ready
        ? null
        : integrationContract.blockedReasons[0] ?? "provider sync requires review",
    },
    {
      command: artifactState.nextAction,
      label: previewAcceptance.nextAction.label,
      disabled: previewAcceptance.readiness.ready,
      disabledReason: previewAcceptance.readiness.ready
        ? "artifact audit handoff is ready"
        : previewAcceptance.nextAction.reason,
    },
  ];

  return baseActions.map((action) => ({
    ...action,
    primary: action.command === previewAcceptance.nextAction.command,
  }));
}

function buildArtifactClientCommandEnvelope(
  program,
  audit,
  artifactState,
  lifecycleControls,
  integrationContract,
  previewAcceptance,
  clientRuntimeState,
  persistedState,
  options,
) {
  const envelopeKey = String(
    options.commandEnvelopeKey
      ?? `${program.job.memory.namespace}:artifact-audit:command-envelope:${clientRuntimeState.request.requestId}`,
  );
  const replay = normalizeArtifactCommandReplay(options.commandReplay);
  const routeName = clientRuntimeState.routeState.name;
  const acceptanceCommand = "artifact.audit.accept-preview";
  const reviewCommand = "artifact.audit.review";
  const providerCommand = integrationContract.externalHandoff.command;
  const exportCommand = previewAcceptance.readiness.ready
    ? lifecycleControls.requestedCommand
    : previewAcceptance.nextAction.command;
  const commandOrder = uniqueSorted([
    acceptanceCommand,
    reviewCommand,
    lifecycleControls.nextAction,
    providerCommand,
    exportCommand,
    persistedState.recovery.nextCommand,
  ]);
  const blockers = uniqueSorted([
    ...(envelopeKey.startsWith(`${program.job.memory.namespace}:artifact-audit:command-envelope:`)
      ? []
      : ["artifact command envelope key must stay inside memory namespace"]),
    ...(clientRuntimeState.request.valid ? [] : clientRuntimeState.request.errors),
    ...(clientRuntimeState.routeState.valid ? [] : clientRuntimeState.routeState.errors),
    ...previewAcceptance.readiness.blockedReasons,
    ...persistedState.blockedReasons,
    ...replay.blockedReasons,
  ]);
  const ready = blockers.length === 0
    && previewAcceptance.readiness.ready
    && persistedState.ready
    && clientRuntimeState.ready;
  const phase = ready
    ? "ready_to_submit"
    : replay.detected
      ? "replay_review"
      : previewAcceptance.acceptance.accepted
        ? "accepted_blocked"
        : "awaiting_acceptance";
  const primaryCommand = ready
    ? providerCommand
    : !previewAcceptance.acceptance.accepted
      ? acceptanceCommand
      : persistedState.recovery.recoverable
        ? persistedState.recovery.nextCommand
        : reviewCommand;
  const fingerprint = deterministicArtifactFingerprint([
    envelopeKey,
    routeName,
    clientRuntimeState.request.requestId,
    artifactState.exportId,
    artifactState.artifactSet,
    previewAcceptance.acceptance.receipt,
    persistedState.snapshot.restartKey,
    persistedState.command.idempotencyKey,
    primaryCommand,
    commandOrder.join(","),
    blockers.join(","),
  ]);
  const commandBase = `${envelopeKey}:${fingerprint}`;
  const routePayload = {
    routeName,
    requestId: clientRuntimeState.request.requestId,
    actorId: clientRuntimeState.request.actorId,
    clientVersion: clientRuntimeState.request.clientVersion,
    statusChannel: clientRuntimeState.adoption.statusChannel,
    cacheKey: clientRuntimeState.adoption.cacheKey,
    exportId: artifactState.exportId,
    artifactSet: artifactState.artifactSet,
    previewToken: previewAcceptance.acceptance.receipt
      ?? `${program.job.id}:artifact-preview:${artifactState.exportId}`,
    restartKey: persistedState.snapshot.restartKey,
    providerTarget: integrationContract.externalHandoff.target,
    providerStatus: integrationContract.summary.providerStatus,
  };
  const commandSpecs = {
    primary: {
      command: primaryCommand,
      enabled: ready || primaryCommand === acceptanceCommand || persistedState.recovery.recoverable,
      reason: ready
        ? "artifact audit command envelope is ready for provider handoff"
        : blockers[0] ?? previewAcceptance.nextAction.reason,
    },
    acceptPreview: {
      command: acceptanceCommand,
      enabled: !previewAcceptance.acceptance.accepted && audit.evidence.missing.length === 0,
      reason: previewAcceptance.acceptance.accepted
        ? "artifact audit preview already accepted"
        : "operator acceptance records the preview decision",
    },
    recover: {
      command: persistedState.recovery.nextCommand,
      enabled: persistedState.recovery.recoverable,
      reason: persistedState.recovery.recoverable
        ? persistedState.recovery.statusEvent
        : persistedState.recovery.blockedReasons[0] ?? "artifact audit recovery is not available",
    },
    providerSync: {
      command: providerCommand,
      enabled: integrationContract.ready && previewAcceptance.readiness.ready,
      reason: integrationContract.ready
        ? "provider handoff target is negotiated"
        : integrationContract.blockedReasons[0] ?? "provider sync requires review",
    },
    review: {
      command: reviewCommand,
      enabled: true,
      reason: blockers[0] ?? "artifact audit can always be reviewed from the client route",
    },
  };
  const clientCommandState = normalizeArtifactClientCommandState(options.clientCommandState);
  const submissionBlockers = uniqueSorted([
    ...blockers,
    ...clientCommandState.blockedReasons,
    ...(commandSpecs.primary.enabled ? [] : ["artifact primary command is not enabled"]),
    ...(commandSpecs.primary.command === providerCommand && !integrationContract.ready
      ? ["artifact provider sync is not ready for primary command submission"]
      : []),
    ...(commandSpecs.primary.command === providerCommand && !previewAcceptance.acceptance.accepted
      ? ["artifact provider sync requires accepted preview receipt"]
      : []),
    ...(replay.detected && replay.lastIdempotencyKey !== persistedState.command.idempotencyKey
      ? ["artifact command replay idempotency key does not match persisted command"]
      : []),
    ...(clientCommandState.requestId === clientRuntimeState.request.requestId
      ? []
      : ["artifact command submission request id does not match runtime request"]),
  ]);
  const submissionDecision = submissionBlockers.length === 0 && ready
    ? "submit_primary"
    : replay.detected && replay.lastIdempotencyKey === persistedState.command.idempotencyKey
      ? "replay_status"
      : previewAcceptance.acceptance.accepted
        ? "recover_or_review"
        : "await_acceptance";
  const submissionCommand = submissionDecision === "submit_primary"
    ? commandSpecs.primary.command
    : submissionDecision === "replay_status"
      ? "artifact.audit.replay-status"
      : submissionDecision === "recover_or_review"
        ? persistedState.recovery.nextCommand
        : acceptanceCommand;

  return {
    kind: "mailchimp.artifact-audit.client-command-envelope",
    apiVersion: "aios.client/v1",
    envelopeKey,
    fingerprint,
    status: {
      ready,
      phase,
      replayed: replay.detected,
      accepted: previewAcceptance.acceptance.accepted,
      persistedVersion: persistedState.snapshot.version,
      blockedCount: blockers.length,
    },
    routePayload,
    commands: Object.fromEntries(Object.entries(commandSpecs).map(([name, spec]) => [
      name,
      {
        idempotent: true,
        idempotencyKey: `${commandBase}:${name}:${spec.command}`,
        command: spec.command,
        enabled: spec.enabled,
        reason: spec.reason,
      },
    ])),
    replayGuard: {
      detected: replay.detected,
      replayOf: replay.replayOf,
      lastIdempotencyKey: replay.lastIdempotencyKey,
      currentIdempotencyKey: persistedState.command.idempotencyKey,
      safeToReplay: replay.detected
        ? replay.lastIdempotencyKey === persistedState.command.idempotencyKey
        : true,
    },
    submissionGuard: {
      kind: "mailchimp.artifact-audit.command-submission-guard",
      apiVersion: "aios.client/v1",
      decision: submissionDecision,
      command: submissionCommand,
      idempotent: true,
      idempotencyKey: `${commandBase}:submission:${submissionDecision}:${submissionCommand}`,
      clientCanSubmit: submissionBlockers.length === 0 && commandSpecs.primary.enabled,
      replaySafe: replay.detected
        ? replay.lastIdempotencyKey === persistedState.command.idempotencyKey
        : true,
      externalWritesAllowed: false,
      request: {
        requestId: clientCommandState.requestId,
        routeName,
        actorId: clientRuntimeState.request.actorId,
        clientVersion: clientRuntimeState.request.clientVersion,
        lastSeenVersion: clientCommandState.lastSeenVersion,
      },
      provider: {
        target: integrationContract.externalHandoff.target,
        status: integrationContract.summary.providerStatus,
        handoffToken: submissionBlockers.length === 0 ? integrationContract.externalHandoff.token : null,
      },
      audit: {
        exportId: artifactState.exportId,
        artifactSet: artifactState.artifactSet,
        acceptedReceipt: previewAcceptance.acceptance.receipt,
        restartKey: persistedState.snapshot.restartKey,
      },
      blockedReasons: submissionBlockers,
      userVisibleStatus: {
        phase: submissionDecision,
        primaryAction: submissionCommand,
        message: submissionBlockers[0]
          ?? (submissionDecision === "submit_primary"
            ? "Artifact audit command is ready for deterministic provider handoff."
            : "Artifact audit command requires review before handoff."),
      },
    },
    visibleWorkflow: {
      title: previewAcceptance.preview.title,
      phase,
      primaryCommand,
      visibleActions: clientRuntimeState.visibleActions.map((action) => ({
        command: action.command,
        label: action.label,
        disabled: action.disabled,
        primary: action.command === primaryCommand || action.primary,
      })),
      validationCards: previewAcceptance.preview.validationCards,
      nextSteps: previewAcceptance.readiness.ready
        ? previewAcceptance.nextAction
        : previewAcceptance.readiness.blockedReasons.map((reason) => ({
          command: reason.includes("acceptance") ? acceptanceCommand : reviewCommand,
          reason,
        })),
    },
    summary: {
      ready,
      phase,
      routeName,
      primaryCommand,
      commandCount: Object.keys(commandSpecs).length,
      fingerprint,
      blockedCount: blockers.length,
      submissionDecision,
    },
    validation: {
      ready,
      blockers,
      routeMounted: clientRuntimeState.routeState.mounted,
      externalWritesAllowed: false,
      canSubmitPrimary: commandSpecs.primary.enabled && blockers.length === 0,
      submissionGuardReady: submissionBlockers.length === 0,
    },
  };
}

function normalizeArtifactCommandReplay(replay = {}) {
  const detected = Boolean(replay.detected ?? replay.replayed ?? false);
  const lastIdempotencyKey = replay.lastIdempotencyKey ? String(replay.lastIdempotencyKey) : null;
  const replayOf = replay.replayOf ? String(replay.replayOf) : null;
  const blockedReasons = uniqueSorted([
    ...(detected && !lastIdempotencyKey
      ? ["artifact command replay requires last idempotency key"]
      : []),
  ]);
  return {
    detected,
    lastIdempotencyKey,
    replayOf,
    blockedReasons,
  };
}

function normalizeArtifactClientCommandState(state = {}) {
  const requestId = String(state.requestId ?? state.id ?? "artifact-client:local").trim();
  const lastSeenVersion = Number(state.lastSeenVersion ?? state.version ?? 0);
  const online = state.online !== false;
  const errors = uniqueSorted([
    ...(requestId ? [] : ["artifact command state request id is required"]),
    ...(Number.isInteger(lastSeenVersion) && lastSeenVersion >= 0
      ? []
      : ["artifact command state lastSeenVersion must be a non-negative integer"]),
    ...(online ? [] : ["artifact command state is offline"]),
  ]);

  return {
    valid: errors.length === 0,
    requestId,
    lastSeenVersion: Number.isInteger(lastSeenVersion) && lastSeenVersion >= 0 ? lastSeenVersion : 0,
    online,
    blockedReasons: errors,
  };
}

function deterministicArtifactFingerprint(parts) {
  return parts
    .map((part) => String(part ?? "null").replaceAll("|", "%7C"))
    .join("|");
}

function buildArtifactNextSteps(artifactState, previewAcceptance) {
  if (previewAcceptance.readiness.ready) {
    return [{
      action: previewAcceptance.nextAction.command,
      label: previewAcceptance.nextAction.label,
      reason: previewAcceptance.nextAction.reason,
    }];
  }
  return previewAcceptance.readiness.blockedReasons.map((reason) => ({
    action: reason.includes("acceptance")
      ? "artifact.audit.accept-preview"
      : artifactState.nextAction,
    label: reason.includes("acceptance")
      ? "Accept artifact audit preview"
      : reason.includes("disabled")
        ? "Enable artifact audit workflow"
        : "Resolve artifact audit blocker",
    reason,
  }));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function normalizeAuditSchedule(schedule = { mode: "manual" }) {
  const mode = String(schedule.mode ?? "manual").trim().toLowerCase();
  const errors = [];
  if (!["manual", "interval", "cron"].includes(mode)) {
    errors.push(`unsupported artifact audit schedule mode: ${mode}`);
  }
  if (mode === "interval") {
    const everyMinutes = Number(schedule.everyMinutes);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 15) {
      errors.push("artifact audit interval schedule requires everyMinutes >= 15");
    }
    return {
      valid: errors.length === 0,
      value: { mode, everyMinutes: Number.isInteger(everyMinutes) ? everyMinutes : null },
      errors,
    };
  }
  if (mode === "cron") {
    const expression = String(schedule.expression ?? "").trim();
    if (expression.split(/\s+/).filter(Boolean).length < 5) {
      errors.push("artifact audit cron schedule requires a cron expression");
    }
    return {
      valid: errors.length === 0,
      value: { mode, expression: expression || null },
      errors,
    };
  }
  return {
    valid: errors.length === 0,
    value: { mode: "manual" },
    errors,
  };
}

function normalizeRetentionDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("retentionDays must be an integer between 1 and 365");
  }
  return days;
}

function normalizePreviewLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("previewLimit must be an integer between 1 and 25");
  }
  return limit;
}

function normalizeArtifactPreviewRows(artifacts = [], observedKinds, limit) {
  const sourceRows = Array.isArray(artifacts) && artifacts.length > 0
    ? artifacts
    : observedKinds.map((kind, index) => ({
      id: `artifact:${kind}:${index + 1}`,
      kind,
      name: `${kind} artifact`,
      status: "observed",
    }));
  return sourceRows.slice(0, limit).map((artifact, index) => {
    const kind = String(artifact.kind ?? artifact.type ?? "artifact").trim();
    const id = String(artifact.id ?? artifact.key ?? `${kind}:${index + 1}`).trim();
    const status = String(artifact.status ?? "observed").trim().toLowerCase();
    const warnings = uniqueSorted(artifact.warnings ?? []);
    return {
      id,
      kind,
      label: String(artifact.name ?? artifact.label ?? id),
      status,
      ready: !["missing", "blocked", "failed"].includes(status) && warnings.length === 0,
      source: String(artifact.source ?? "mailchimp"),
      lastSeenAt: artifact.lastSeenAt ? String(artifact.lastSeenAt) : null,
      warnings,
    };
  });
}

function normalizeProviderStatus(value) {
  const status = String(value ?? "connected").trim().toLowerCase();
  if (!["connected", "degraded", "offline"].includes(status)) {
    throw new Error(`unsupported artifact provider status: ${value}`);
  }
  return status;
}

function normalizeSyncMode(value) {
  const mode = String(value ?? "checkpoint").trim().toLowerCase();
  if (!["checkpoint", "incremental", "realtime"].includes(mode)) {
    throw new Error(`unsupported artifact sync mode: ${value}`);
  }
  return mode;
}

function normalizeExternalHandoff(handoff = {}) {
  const command = String(handoff.command ?? "artifact.provider.sync").trim();
  const target = String(handoff.target ?? "mailchimp.artifact-audit").trim();
  const blockedReasons = uniqueSorted([
    ...(command ? [] : ["artifact provider handoff command is required"]),
    ...(target ? [] : ["artifact provider handoff target is required"]),
  ]);
  return {
    command,
    target,
    correlationId: handoff.correlationId ? String(handoff.correlationId) : "artifact-sync:local",
    acceptedBy: handoff.acceptedBy ? String(handoff.acceptedBy) : null,
    blockedReasons,
  };
}

function normalizeArtifactPersistedSnapshot(snapshot = {}) {
  const version = Number(snapshot.version ?? 0);
  return {
    version: Number.isInteger(version) && version >= 0 ? version : 0,
    restartKey: snapshot.restartKey ? String(snapshot.restartKey) : null,
    exportId: snapshot.exportId ? String(snapshot.exportId) : null,
    requestId: snapshot.requestId ? String(snapshot.requestId) : null,
    status: snapshot.status ? String(snapshot.status).trim().toLowerCase() : "new",
  };
}

function normalizeArtifactCommandReceipt(receipt = {}, fallbackCommand, fallbackRequestId) {
  const command = String(receipt.command ?? fallbackCommand).trim();
  const requestId = String(receipt.requestId ?? fallbackRequestId).trim();
  const idempotencyKey = String(
    receipt.idempotencyKey ?? receipt.key ?? `artifact-command:${requestId}:${command}`,
  ).trim();
  const replayed = Boolean(receipt.replayed ?? false);
  const blockedReasons = uniqueSorted([
    ...(command ? [] : ["artifact command receipt command is required"]),
    ...(requestId ? [] : ["artifact command receipt request id is required"]),
    ...(idempotencyKey ? [] : ["artifact command receipt idempotency key is required"]),
  ]);
  return {
    command,
    requestId,
    idempotencyKey,
    replayed,
    receivedAt: receipt.receivedAt ? String(receipt.receivedAt) : null,
    blockedReasons,
  };
}

function normalizeArtifactClientRequest(request = {}) {
  const requestId = String(request.requestId ?? request.id ?? "artifact-client:local").trim();
  const actorId = String(request.actorId ?? request.operatorId ?? "operator:local").trim();
  const clientVersion = String(request.clientVersion ?? "aios-client/v1").trim();
  const source = String(request.source ?? "mailchimp-artifact-audit").trim();
  const errors = uniqueSorted([
    ...(requestId ? [] : ["artifact client request id is required"]),
    ...(actorId ? [] : ["artifact client actor id is required"]),
    ...(clientVersion ? [] : ["artifact client version is required"]),
    ...(source ? [] : ["artifact client source is required"]),
  ]);
  return {
    valid: errors.length === 0,
    requestId,
    actorId,
    clientVersion,
    source,
    errors,
  };
}

function normalizeArtifactRouteState(routeState = {}) {
  const name = String(routeState.name ?? routeState.routeName ?? "artifact-audit").trim();
  const mounted = Boolean(routeState.mounted ?? true);
  const hydration = String(routeState.hydration ?? "server").trim().toLowerCase();
  const errors = uniqueSorted([
    ...(name ? [] : ["artifact audit route name is required"]),
    ...(mounted ? [] : ["artifact audit route is not mounted"]),
    ...(["server", "client", "static"].includes(hydration)
      ? []
      : [`unsupported artifact audit hydration mode: ${hydration}`]),
  ]);
  return {
    valid: errors.length === 0,
    name,
    mounted,
    hydration,
    errors,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}
