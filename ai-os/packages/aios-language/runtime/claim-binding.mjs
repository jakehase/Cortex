import { stableContractDigest } from "./provider-contract-binding.mjs";
import { evaluateMailchimpVerifierBinding } from "./verifier-binding.mjs";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))].sort();
}

function normalizeClaimSource(input = {}) {
  const workspaceBinding = input.kind === "aios.workspace.boundary_binding" ? input : null;
  const providerJob = workspaceBinding?.providerJob ?? input.providerJob ?? input.job ?? {};
  const artifactPlan = workspaceBinding?.artifactPlan ?? input.artifactPlan ?? [];
  const operatorControlState = workspaceBinding?.operatorControlState ?? input.operatorControlState ?? {};
  const continuationPacket = workspaceBinding?.continuationPacket ?? input.continuationPacket ?? {};
  const analyticsExport = workspaceBinding?.analyticsExport ?? input.analyticsExport ?? {};
  const previewApproval = providerJob.previewApproval
    ?? providerJob.adapterHandoff?.previewApproval
    ?? continuationPacket.approvalHandoff
    ?? continuationPacket.clientWorkflow?.approvalContract
    ?? input.previewApproval
    ?? {};
  const clientResumeCheckpoint = providerJob.previewApproval?.clientResumeCheckpoint
    ?? providerJob.adapterHandoff?.previewApproval?.clientResumeCheckpoint
    ?? continuationPacket.clientWorkflow?.clientResumeCheckpoint
    ?? input.clientResumeCheckpoint
    ?? {};
  const capabilityNegotiation = providerJob.capabilityNegotiation
    ?? providerJob.adapterHandoff?.capabilityNegotiation
    ?? input.capabilityNegotiation
    ?? {};
  const runtimePersistence = providerJob.runtimePersistence
    ?? providerJob.adapterHandoff?.runtimePersistence
    ?? continuationPacket.clientWorkflow?.providerRuntimePersistence
    ?? input.runtimePersistence
    ?? {};
  const runtimeBoundaryAuthorization = providerJob.runtimeBoundary?.authorization
    ?? providerJob.adapterHandoff?.runtimeBoundaryAuthorization
    ?? providerJob.adapterHandoff?.runtimeBoundary?.authorization
    ?? continuationPacket.clientWorkflow?.runtimeBoundaryAuthorization
    ?? input.runtimeBoundaryAuthorization
    ?? {};
  const workspaceAuthorizationPosture = workspaceBinding?.workspaceAuthorizationPosture
    ?? input.workspaceAuthorizationPosture
    ?? continuationPacket.clientWorkflow?.workspaceAuthorizationPosture
    ?? providerJob.workspaceAuthorizationPosture
    ?? providerJob.adapterHandoff?.workspaceAuthorizationPosture
    ?? {};
  const workspaceBoundaryId = workspaceBinding?.boundaryId ?? input.workspaceBoundaryId ?? null;
  const verifierReport = input.verifierReport?.kind === "aios.verifier.execution_report"
    ? input.verifierReport
    : evaluateMailchimpVerifierBinding(workspaceBinding ?? input);
  const issues = [
    ...asArray(providerJob.issues),
    ...asArray(workspaceBinding?.issues ?? input.issues),
  ];

  return {
    workspaceBinding,
    providerJob,
    artifactPlan,
    operatorControlState,
    continuationPacket,
    analyticsExport,
    previewApproval,
    clientResumeCheckpoint,
    capabilityNegotiation,
    runtimePersistence,
    runtimeBoundaryAuthorization,
    workspaceAuthorizationPosture,
    workspaceBoundaryId,
    verifierReport,
    issues,
  };
}

function claimStatusFromVerifier(verifierReport) {
  if (verifierReport.status === "failed") {
    return "blocked";
  }

  if (verifierReport.status === "degraded") {
    return "degraded";
  }

  return "asserted";
}

function buildArtifactClaims(source) {
  return asArray(source.artifactPlan).map((artifact) => ({
    claim: `artifact.${artifact.logicalName}.local`,
    status: typeof artifact.path === "string"
      && (artifact.path.startsWith("workspace://") || artifact.path.startsWith("memory://"))
      ? "asserted"
      : "blocked",
    evidence: {
      logicalName: artifact.logicalName,
      path: artifact.path,
      mediaType: artifact.mediaType,
      writeMode: artifact.writeMode,
    },
  }));
}

function buildRuntimeClaims(source) {
  const providerJob = source.providerJob ?? {};
  const lifecycle = providerJob.lifecycleState ?? providerJob.adapterHandoff?.lifecycle ?? {};
  const transitionPlan = lifecycle.transitionPlan
    ?? providerJob.adapterHandoff?.lifecycleTransition
    ?? source.operatorControlState?.lifecycleTransition
    ?? source.continuationPacket?.clientWorkflow?.lifecycleTransition
    ?? {};
  const operationalHealth = providerJob.operationalHealth ?? providerJob.adapterHandoff?.operationalHealth ?? {};
  const previewAcceptance = providerJob.previewAcceptance ?? providerJob.adapterHandoff?.previewAcceptance ?? {};
  const previewApproval = source.previewApproval ?? {};
  const clientResumeCheckpoint = source.clientResumeCheckpoint ?? {};
  const capabilityNegotiation = source.capabilityNegotiation ?? {};
  const runtimePersistence = source.runtimePersistence ?? {};
  const runtimeBoundaryAuthorization = source.runtimeBoundaryAuthorization ?? {};
  const workspaceAuthorizationPosture = source.workspaceAuthorizationPosture ?? {};
  const operatorState = source.operatorControlState ?? {};
  const continuation = source.continuationPacket ?? {};
  const providerRuntimeStatus = runtimePersistence.status ?? continuation.clientWorkflow?.providerRuntimePersistence?.status ?? null;
  const providerRuntimeResumeStatus = runtimePersistence.resumeCommand?.status
    ?? runtimePersistence.resumeStatus
    ?? continuation.clientWorkflow?.providerRuntimePersistence?.resumeStatus
    ?? null;
  const providerRuntimeRecovery = asArray(runtimePersistence.recovery ?? continuation.clientWorkflow?.providerRuntimePersistence?.recoveryActions);

  return [
    {
      claim: "provider.mailchimp.job.normalized",
      status: providerJob.status === "blocked" ? "blocked" : "asserted",
      evidence: {
        providerJobId: providerJob.jobId ?? null,
        provider: providerJob.provider ?? "mailchimp",
        commitMode: providerJob.commitMode ?? null,
      },
    },
    {
      claim: "provider.mailchimp.capability_negotiation.bound",
      status: (capabilityNegotiation.missingRequiredCapabilities ?? []).length > 0 ? "blocked" : "asserted",
      evidence: {
        status: capabilityNegotiation.status ?? null,
        digest: capabilityNegotiation.digest ?? null,
        requiredCapabilities: capabilityNegotiation.requiredCapabilities ?? [],
        negotiatedCapabilities: capabilityNegotiation.negotiatedCapabilities ?? [],
        missingRequiredCapabilities: capabilityNegotiation.missingRequiredCapabilities ?? [],
        externalHandoffStatus: capabilityNegotiation.externalHandoff?.status ?? null,
        nextAction: capabilityNegotiation.externalHandoff?.nextAction ?? null,
      },
    },
    {
      claim: "runtime.boundary.authorization.bound",
      status: runtimeBoundaryAuthorization.status === "denied"
        ? "blocked"
        : runtimeBoundaryAuthorization.decisionDigest || runtimeBoundaryAuthorization.status
          ? "asserted"
          : "degraded",
      evidence: {
        status: runtimeBoundaryAuthorization.status ?? null,
        decisionDigest: runtimeBoundaryAuthorization.decisionDigest ?? null,
        isolationKey: runtimeBoundaryAuthorization.isolationKey ?? null,
        tenant: runtimeBoundaryAuthorization.scope?.tenant ?? runtimeBoundaryAuthorization.tenant ?? null,
        workspace: runtimeBoundaryAuthorization.scope?.workspace ?? runtimeBoundaryAuthorization.workspace ?? null,
        actorId: runtimeBoundaryAuthorization.scope?.actorId ?? runtimeBoundaryAuthorization.actorId ?? null,
        safeForPreview: runtimeBoundaryAuthorization.handoff?.safeForPreview
          ?? runtimeBoundaryAuthorization.safeForPreview
          ?? null,
        safeForCommit: runtimeBoundaryAuthorization.handoff?.safeForCommit
          ?? runtimeBoundaryAuthorization.safeForCommit
          ?? null,
        deniedReasons: runtimeBoundaryAuthorization.deniedReasons ?? [],
        deniedActions: runtimeBoundaryAuthorization.deniedActions ?? [],
        auditSink: runtimeBoundaryAuthorization.auditChain?.sink
          ?? runtimeBoundaryAuthorization.auditSink
          ?? null,
        auditRestartSafe: runtimeBoundaryAuthorization.auditChain?.restartSafe
          ?? runtimeBoundaryAuthorization.auditRestartSafe
          ?? null,
      },
    },
    {
      claim: "workspace.authorization.posture_exported",
      status: workspaceAuthorizationPosture.status === "blocked"
        ? "blocked"
        : workspaceAuthorizationPosture.postureId || workspaceAuthorizationPosture.digest
          ? "asserted"
          : "degraded",
      evidence: {
        postureId: workspaceAuthorizationPosture.postureId ?? null,
        status: workspaceAuthorizationPosture.status ?? null,
        digest: workspaceAuthorizationPosture.digest ?? null,
        nextAction: workspaceAuthorizationPosture.nextAction ?? null,
        tenant: workspaceAuthorizationPosture.scope?.tenant ?? null,
        workspace: workspaceAuthorizationPosture.scope?.workspace ?? null,
        auditReady: workspaceAuthorizationPosture.gates?.auditReady ?? null,
        safeForPreview: workspaceAuthorizationPosture.gates?.safeForPreview ?? null,
        safeForCommit: workspaceAuthorizationPosture.gates?.safeForCommit ?? null,
        missingPermissions: workspaceAuthorizationPosture.permissions?.missing ?? [],
        deniedActions: workspaceAuthorizationPosture.permissions?.deniedActions ?? [],
        blockedReasons: workspaceAuthorizationPosture.blockedReasons ?? [],
      },
    },
    {
      claim: "runtime.lifecycle.next_action_handoff",
      status: lifecycle.nextAction ? "asserted" : "blocked",
      evidence: {
        nextAction: transitionPlan.handoff?.nextAction ?? lifecycle.nextAction ?? continuation.nextClientStep ?? "operator.review",
        requestedCommand: transitionPlan.requestedCommand ?? operatorState.requestedCommand ?? continuation.clientWorkflow?.requestedCommand ?? null,
        transitionStatus: transitionPlan.status ?? operatorState.transitionStatus ?? continuation.clientWorkflow?.transitionStatus ?? null,
        availableCommands: operatorState.availableCommands ?? [],
        blockedCommands: operatorState.blockedCommands ?? [],
      },
    },
    {
      claim: "runtime.lifecycle.transition_gates_bound",
      status: transitionPlan.status === "unsupported" || transitionPlan.blockers?.length > 0 ? "degraded" : "asserted",
      evidence: {
        requestedCommand: transitionPlan.requestedCommand ?? null,
        allowed: transitionPlan.allowed ?? null,
        gateResults: transitionPlan.gateResults ?? [],
        blockers: transitionPlan.blockers ?? [],
        resumeToken: transitionPlan.resume?.token ?? null,
        idempotencyKey: transitionPlan.resume?.idempotencyKey ?? null,
      },
    },
    {
      claim: "runtime.lifecycle.command_queue_requested",
      status: (lifecycle.commandQueue ?? []).some((command) => command.requested === true) ? "asserted" : "degraded",
      evidence: {
        requestedCommand: transitionPlan.requestedCommand ?? null,
        commands: (lifecycle.commandQueue ?? []).map((command) => ({
          command: command.command,
          status: command.status,
          requested: command.requested === true,
        })),
      },
    },
    {
      claim: "adapter.recovery.status_handoff",
      status: operationalHealth.failureState?.terminal ? "blocked" : "asserted",
      evidence: {
        healthStatus: operationalHealth.status ?? continuation.status ?? "unknown",
        retryMode: operationalHealth.retryPlan?.mode ?? continuation.retryBackoff?.mode ?? null,
        statusOnFailure: operationalHealth.failureState?.statusOnFailure ?? null,
        resumable: continuation.resumable?.allowed ?? null,
      },
    },
    {
      claim: "preview.acceptance.gate_exposed",
      status: previewAcceptance.acceptanceGate?.status === "blocked" ? "blocked" : "asserted",
      evidence: {
        required: previewAcceptance.acceptanceGate?.required ?? null,
        mode: previewAcceptance.acceptanceGate?.mode ?? null,
        status: previewAcceptance.acceptanceGate?.status ?? null,
        maxRows: previewAcceptance.previewWindow?.maxRows ?? null,
      },
    },
    {
      claim: "preview.approval.ticket_bound",
      status: previewApproval.approvalId || previewApproval.approvalHandoff?.approvalId ? "asserted" : "degraded",
      evidence: {
        approvalId: previewApproval.approvalId ?? previewApproval.approvalHandoff?.approvalId ?? null,
        status: previewApproval.status ?? null,
        approvalRequired: previewApproval.readiness?.approvalRequired ?? previewApproval.approvalRequired ?? null,
        awaitingAcceptance: previewApproval.readiness?.awaitingAcceptance ?? previewApproval.awaitingAcceptance ?? null,
        nextAction: previewApproval.handoff?.nextAction ?? previewApproval.nextAction ?? previewApproval.nextStep?.id ?? null,
        reportId: previewApproval.handoff?.reportId ?? previewApproval.reportId ?? previewApproval.reporting?.reportId ?? null,
        exportReady: previewApproval.handoff?.exportReady ?? previewApproval.exportReady ?? null,
      },
    },
    {
      claim: "preview.approval.client_resume_checkpoint",
      status: clientResumeCheckpoint.checkpointKey && clientResumeCheckpoint.restartSafe !== false
        ? "asserted"
        : previewApproval.approvalId
          ? "degraded"
          : "blocked",
      evidence: {
        checkpointKey: clientResumeCheckpoint.checkpointKey ?? previewApproval.handoff?.checkpointKey ?? null,
        status: clientResumeCheckpoint.status ?? previewApproval.handoff?.checkpointStatus ?? null,
        restartSafe: clientResumeCheckpoint.restartSafe ?? null,
        checksum: clientResumeCheckpoint.checksum ?? null,
        persistCommandId: clientResumeCheckpoint.commands?.persist?.id
          ?? clientResumeCheckpoint.persistCommandId
          ?? previewApproval.handoff?.checkpointCommandId
          ?? null,
        resumeCommandId: clientResumeCheckpoint.commands?.resume?.id
          ?? clientResumeCheckpoint.resumeCommandId
          ?? previewApproval.handoff?.resumeCommandId
          ?? null,
        nextClientAction: clientResumeCheckpoint.clientStatus?.nextClientAction
          ?? clientResumeCheckpoint.nextClientAction
          ?? previewApproval.handoff?.nextClientAction
          ?? null,
        artifactPath: clientResumeCheckpoint.artifactPath ?? previewApproval.checkpointPath ?? null,
      },
    },
    {
      claim: "provider.runtime.persistence.restart_safe",
      status: runtimePersistence.stateKey && runtimePersistence.checksum && runtimePersistence.restartSafe !== false
        ? providerRuntimeResumeStatus === "blocked" || providerRuntimeRecovery.length > 0
          ? "degraded"
          : "asserted"
        : "blocked",
      evidence: {
        stateKey: runtimePersistence.stateKey
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.stateKey
          ?? null,
        status: providerRuntimeStatus,
        checksum: runtimePersistence.checksum
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.checksum
          ?? null,
        sequence: runtimePersistence.sequence
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.sequence
          ?? null,
        restartSafe: runtimePersistence.restartSafe
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.restartSafe
          ?? null,
        alreadyPersisted: runtimePersistence.alreadyPersisted
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.alreadyPersisted
          ?? null,
        persistCommandId: runtimePersistence.persistCommand?.id
          ?? runtimePersistence.persistCommandId
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.persistCommandId
          ?? null,
        persistStatus: runtimePersistence.persistCommand?.status
          ?? runtimePersistence.persistStatus
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.persistStatus
          ?? null,
        resumeCommandId: runtimePersistence.resumeCommand?.id
          ?? runtimePersistence.resumeCommandId
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.resumeCommandId
          ?? null,
        resumeStatus: providerRuntimeResumeStatus,
        approvalReplayManifestId: runtimePersistence.approvalReplay?.replayManifestId
          ?? runtimePersistence.approvalReplayManifestId
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.approvalReplayManifestId
          ?? clientResumeCheckpoint.replayManifest?.manifestId
          ?? previewApproval.handoff?.replayManifestId
          ?? null,
        approvalReplayStatus: runtimePersistence.approvalReplay?.replayStatus
          ?? runtimePersistence.approvalReplayStatus
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.approvalReplayStatus
          ?? clientResumeCheckpoint.replayManifest?.status
          ?? previewApproval.handoff?.replayStatus
          ?? null,
        artifactPath: runtimePersistence.artifactPath
          ?? continuation.clientWorkflow?.providerRuntimePersistence?.artifactPath
          ?? null,
        recoveryActions: providerRuntimeRecovery.map((entry) => ({
          code: entry.code,
          action: entry.action,
        })),
      },
    },
  ];
}

function buildVerifierClaims(source) {
  return source.verifierReport.checks.map((check) => ({
    claim: `verifier.${check.name}`,
    status: check.status === "passed" ? "asserted" : check.required ? "blocked" : "degraded",
    evidence: {
      required: check.required,
      checkStatus: check.status,
      issueCodes: check.issueCodes,
    },
  }));
}

function summarizeClaims(claims) {
  const blocked = claims.filter((claim) => claim.status === "blocked");
  const degraded = claims.filter((claim) => claim.status === "degraded");

  return {
    status: blocked.length ? "blocked" : degraded.length ? "degraded" : "asserted",
    total: claims.length,
    asserted: claims.filter((claim) => claim.status === "asserted").length,
    degraded: degraded.length,
    blocked: blocked.length,
    blockedClaims: blocked.map((claim) => claim.claim),
  };
}

function countClaimsByPrefix(claims) {
  return claims.reduce((counts, claim) => {
    const prefix = typeof claim.claim === "string" && claim.claim.includes(".")
      ? claim.claim.split(".").slice(0, 2).join(".")
      : "claim.unknown";

    return {
      ...counts,
      [prefix]: (counts[prefix] ?? 0) + 1,
    };
  }, {});
}

function buildClaimAnalyticsExport(source, claims, claimSummary, issueCodes, digest, previewReadiness) {
  const analyticsExport = source.analyticsExport ?? {};
  const timeline = Array.isArray(analyticsExport.timeline) ? analyticsExport.timeline : [];
  const history = Array.isArray(analyticsExport.history) ? analyticsExport.history : [];
  const workspaceAuthorizationPosture = source.workspaceAuthorizationPosture ?? {};
  const verifierChecks = Array.isArray(source.verifierReport?.checks) ? source.verifierReport.checks : [];
  const statusCounts = claims.reduce((counts, claim) => ({
    ...counts,
    [claim.status]: (counts[claim.status] ?? 0) + 1,
  }), {});
  const blockedIssueCodes = uniqueSorted([
    ...issueCodes.filter((code) => typeof code === "string" && (
      code.includes("blocked")
      || code.includes("missing")
      || code.includes("denied")
      || code.includes("failed")
      || code.includes("required")
    )),
    ...(workspaceAuthorizationPosture.status === "blocked"
      ? ["workspace_authorization_posture.blocked"]
      : []),
  ]);
  const exportDigest = stableContractDigest({
    claimDigest: digest,
    claimSummary,
    issueCodes,
    readiness: previewReadiness.status,
    workspaceAuthorizationPostureDigest: workspaceAuthorizationPosture.digest ?? null,
    timelineSteps: timeline.map((entry) => entry.step),
  });

  return {
    kind: "aios.claim.analytics_export",
    version: "mailchimp.claim-analytics.v1",
    exportId: `claim-analytics:${exportDigest.slice(-8)}`,
    digest: exportDigest,
    status: claimSummary.status,
    counters: {
      claimTotal: claimSummary.total,
      asserted: statusCounts.asserted ?? 0,
      degraded: statusCounts.degraded ?? 0,
      blocked: statusCounts.blocked ?? 0,
      verifierChecks: verifierChecks.length,
      verifierRequiredFailed: source.verifierReport?.summary?.requiredFailed ?? 0,
      artifactClaims: claims.filter((claim) => claim.claim?.startsWith("artifact.")).length,
      runtimeClaims: claims.filter((claim) => claim.claim?.startsWith("runtime.") || claim.claim?.startsWith("provider.")).length,
      workspaceAuthorizationBlocked: workspaceAuthorizationPosture.status === "blocked" ? 1 : 0,
      missingPermissionTotal: workspaceAuthorizationPosture.permissions?.missing?.length ?? 0,
      deniedActionTotal: workspaceAuthorizationPosture.permissions?.deniedActions?.length ?? 0,
      issueTotal: issueCodes.length,
      blockedIssueTotal: blockedIssueCodes.length,
    },
    claimGroups: countClaimsByPrefix(claims),
    history: [
      ...history,
      {
        snapshotId: `claim-snapshot:${exportDigest.slice(-8)}`,
        status: claimSummary.status,
        providerJobId: source.providerJob?.jobId ?? null,
        workspaceBoundaryId: source.workspaceBoundaryId,
        verifierReportId: source.verifierReport?.reportId ?? null,
        previewReadinessStatus: previewReadiness.status,
        nextAction: previewReadiness.nextAction,
        claimSummary,
        issueCodes,
        workspaceAuthorizationPosture: workspaceAuthorizationPosture.postureId
          ? {
              postureId: workspaceAuthorizationPosture.postureId,
              status: workspaceAuthorizationPosture.status,
              nextAction: workspaceAuthorizationPosture.nextAction,
              blockedReasons: workspaceAuthorizationPosture.blockedReasons ?? [],
            }
          : null,
      },
    ],
    timeline: [
      ...timeline,
      {
        step: "claim-packet.analytics-exported",
        status: claimSummary.status,
        evidence: [
          source.verifierReport?.reportId ?? "no-verifier-report",
          previewReadiness.status,
          workspaceAuthorizationPosture.postureId ?? "no-authorization-posture",
        ],
      },
    ],
    exportSummary: {
      providerJobId: source.providerJob?.jobId ?? null,
      workspaceBoundaryId: source.workspaceBoundaryId,
      verifierReportId: source.verifierReport?.reportId ?? null,
      readinessStatus: previewReadiness.status,
      nextAction: previewReadiness.nextAction,
      blockedClaims: claimSummary.blockedClaims,
      blockedIssueCodes,
      exportReady: claimSummary.status !== "blocked" || previewReadiness.readiness?.previewEnabled === true,
    },
  };
}

function normalizeNextActionLabel(action) {
  if (action === "settings.fix") return "Fix provider settings";
  if (action === "provider.enable") return "Enable Mailchimp provider";
  if (action === "negotiate-provider-capabilities") return "Reconnect Mailchimp capabilities";
  if (action === "preview.accept") return "Accept preview";
  if (action === "sync.preview") return "Build preview";
  if (action === "sync.commit") return "Commit through adapter";
  if (action === "repair-provider-health") return "Repair provider health";
  return "Review provider state";
}

function buildClaimPreviewReadiness(source, claimSummary, issueCodes) {
  const providerJob = source.providerJob ?? {};
  const previewAcceptance = providerJob.previewAcceptance ?? providerJob.adapterHandoff?.previewAcceptance ?? {};
  const previewApproval = source.previewApproval ?? {};
  const clientResumeCheckpoint = source.clientResumeCheckpoint ?? {};
  const clientPreviewSurface = providerJob.clientPreviewSurface ?? providerJob.adapterHandoff?.clientPreviewSurface ?? {};
  const operationalHealth = providerJob.operationalHealth ?? providerJob.adapterHandoff?.operationalHealth ?? {};
  const lifecycle = providerJob.lifecycleState ?? providerJob.adapterHandoff?.lifecycle ?? {};
  const capabilityNegotiation = source.capabilityNegotiation ?? {};
  const runtimePersistence = source.runtimePersistence ?? {};
  const runtimeBoundaryAuthorization = source.runtimeBoundaryAuthorization ?? {};
  const validationSummary = previewAcceptance.validationSummary ?? {};
  const acceptanceGate = previewAcceptance.acceptanceGate ?? {};
  const blockingIssueCodes = uniqueSorted([
    ...asArray(validationSummary.blockingIssueCodes),
    ...issueCodes.filter((code) => typeof code === "string" && (
      code.includes("missing")
      || code.includes("blocked")
      || code.includes("auth_failed")
      || code.includes("required")
      || code.includes("authorization_denied")
    )),
    ...(runtimeBoundaryAuthorization.status === "denied" ? ["runtime_boundary.authorization_denied"] : []),
  ]);
  const warningIssueCodes = uniqueSorted(issueCodes.filter((code) => !blockingIssueCodes.includes(code)));
  const capabilityMissing = asArray(capabilityNegotiation.missingRequiredCapabilities);
  const previewEnabled = clientPreviewSurface.readiness?.previewEnabled
    ?? (lifecycle.controls?.previewAllowed === true && blockingIssueCodes.length === 0 && capabilityMissing.length === 0);
  const commitEnabled = clientPreviewSurface.readiness?.commitEnabled
    ?? (lifecycle.controls?.commitAllowed === true && acceptanceGate.status !== "blocked" && capabilityMissing.length === 0);
  const readinessStatus = claimSummary.status === "blocked"
    ? "blocked"
    : capabilityMissing.length
      ? "needs_capability_negotiation"
      : blockingIssueCodes.length
        ? "needs_settings_repair"
        : operationalHealth.failureState?.terminal
          ? "needs_provider_repair"
          : commitEnabled
            ? "commit_ready"
            : previewEnabled
              ? "preview_ready"
              : "needs_operator_action";
  const nextAction = capabilityMissing.length
    ? "negotiate-provider-capabilities"
    : blockingIssueCodes.length
      ? "settings.fix"
      : operationalHealth.failureState?.terminal
        ? "repair-provider-health"
        : acceptanceGate.status === "awaiting-operator-acceptance"
          ? "preview.accept"
          : commitEnabled
            ? "sync.commit"
            : previewEnabled
              ? "sync.preview"
              : lifecycle.nextAction ?? "operator.review";
  const nextSteps = [
    ...(capabilityMissing.length
      ? [{
          id: "negotiate-provider-capabilities",
          label: normalizeNextActionLabel("negotiate-provider-capabilities"),
          enabled: true,
          reason: `Missing Mailchimp capabilities: ${capabilityMissing.join(", ")}.`,
        }]
      : []),
    ...(blockingIssueCodes.length
      ? [{
          id: "settings.fix",
          label: normalizeNextActionLabel("settings.fix"),
          enabled: true,
          reason: "Provider validation has blocking issue codes that must be resolved before handoff.",
        }]
      : []),
    ...(acceptanceGate.required
      ? [{
          id: "preview.accept",
          label: normalizeNextActionLabel("preview.accept"),
          enabled: previewEnabled && blockingIssueCodes.length === 0,
          reason: acceptanceGate.status === "awaiting-operator-acceptance"
            ? "Preview acceptance is required before commit can be exposed."
            : "Preview acceptance state is recorded for audit.",
        }]
      : []),
    {
      id: commitEnabled ? "sync.commit" : previewEnabled ? "sync.preview" : nextAction,
      label: normalizeNextActionLabel(commitEnabled ? "sync.commit" : previewEnabled ? "sync.preview" : nextAction),
      enabled: blockingIssueCodes.length === 0 && capabilityMissing.length === 0,
      reason: commitEnabled
        ? "Claim packet shows commit readiness through the Mailchimp adapter."
        : previewEnabled
          ? "Claim packet shows preview readiness with local artifacts."
          : "Runtime requires operator action before preview or commit.",
    },
  ];

  return {
    kind: "aios.claim.preview_readiness",
    version: "mailchimp.claim-preview-readiness.v1",
    status: readinessStatus,
    userVisible: clientPreviewSurface.userVisible !== false,
    providerJobId: providerJob.jobId ?? null,
    readiness: {
      previewEnabled,
      commitEnabled,
      degraded: operationalHealth.degraded === true || clientPreviewSurface.readiness?.degraded === true,
      healthStatus: operationalHealth.status ?? clientPreviewSurface.readiness?.status ?? "unknown",
      runtimeBoundaryAuthorized: runtimeBoundaryAuthorization.status
        ? runtimeBoundaryAuthorization.status !== "denied"
        : null,
      runtimeBoundaryStatus: runtimeBoundaryAuthorization.status ?? null,
      runtimeBoundaryIsolationKey: runtimeBoundaryAuthorization.isolationKey ?? null,
      blockingIssueCodes,
      warningIssueCodes,
      claimBlockedCount: claimSummary.blocked,
      claimDegradedCount: claimSummary.degraded,
    },
    validationSummary: {
      status: validationSummary.status ?? (blockingIssueCodes.length ? "blocked" : "ready"),
      issueCodes,
      checkedFields: asArray(validationSummary.checkedFields),
      requiredMergeFields: asArray(validationSummary.requiredMergeFields),
      allowedMemberFields: asArray(validationSummary.allowedMemberFields),
      capabilityNegotiation: {
        status: capabilityNegotiation.status ?? validationSummary.capabilityNegotiation?.status ?? null,
        requiredCapabilities: capabilityNegotiation.requiredCapabilities ?? validationSummary.capabilityNegotiation?.requiredCapabilities ?? [],
        negotiatedCapabilities: capabilityNegotiation.negotiatedCapabilities ?? validationSummary.capabilityNegotiation?.negotiatedCapabilities ?? [],
        missingRequiredCapabilities: capabilityMissing,
      },
    },
    acceptance: {
      required: acceptanceGate.required ?? null,
      mode: acceptanceGate.mode ?? null,
      status: acceptanceGate.status ?? null,
      requiredActions: asArray(acceptanceGate.requiredActions),
    },
    approval: {
      approvalId: previewApproval.approvalId ?? null,
      status: previewApproval.status ?? null,
      approvalRequired: previewApproval.readiness?.approvalRequired ?? previewApproval.approvalRequired ?? null,
      awaitingAcceptance: previewApproval.readiness?.awaitingAcceptance ?? previewApproval.awaitingAcceptance ?? null,
      nextAction: previewApproval.handoff?.nextAction ?? previewApproval.nextAction ?? previewApproval.nextStep?.id ?? null,
      reportId: previewApproval.handoff?.reportId ?? previewApproval.reportId ?? previewApproval.reporting?.reportId ?? null,
      exportReady: previewApproval.handoff?.exportReady ?? previewApproval.exportReady ?? null,
      artifactPath: previewApproval.artifactPath ?? null,
    },
    clientResumeCheckpoint: {
      checkpointKey: clientResumeCheckpoint.checkpointKey ?? previewApproval.handoff?.checkpointKey ?? null,
      status: clientResumeCheckpoint.status ?? previewApproval.handoff?.checkpointStatus ?? null,
      restartSafe: clientResumeCheckpoint.restartSafe ?? null,
      checksum: clientResumeCheckpoint.checksum ?? null,
      replayManifestId: clientResumeCheckpoint.replayManifest?.manifestId ?? previewApproval.handoff?.replayManifestId ?? null,
      replayStatus: clientResumeCheckpoint.replayManifest?.status ?? previewApproval.handoff?.replayStatus ?? null,
      replayChecksum: clientResumeCheckpoint.replayManifest?.checksum ?? previewApproval.handoff?.replayChecksum ?? null,
      nextClientAction: clientResumeCheckpoint.clientStatus?.nextClientAction
        ?? clientResumeCheckpoint.nextClientAction
        ?? previewApproval.handoff?.nextClientAction
        ?? null,
      persistCommandId: clientResumeCheckpoint.commands?.persist?.id
        ?? clientResumeCheckpoint.persistCommandId
        ?? previewApproval.handoff?.checkpointCommandId
        ?? null,
      resumeCommandId: clientResumeCheckpoint.commands?.resume?.id
        ?? clientResumeCheckpoint.resumeCommandId
        ?? previewApproval.handoff?.resumeCommandId
        ?? null,
      artifactPath: clientResumeCheckpoint.artifactPath ?? previewApproval.checkpointPath ?? null,
    },
    providerRuntimePersistence: {
      stateKey: runtimePersistence.stateKey ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.stateKey ?? null,
      status: runtimePersistence.status ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.status ?? null,
      checksum: runtimePersistence.checksum ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.checksum ?? null,
      sequence: runtimePersistence.sequence ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.sequence ?? null,
      restartSafe: runtimePersistence.restartSafe ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.restartSafe ?? null,
      persistCommandId: runtimePersistence.persistCommand?.id
        ?? runtimePersistence.persistCommandId
        ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.persistCommandId
        ?? null,
      resumeCommandId: runtimePersistence.resumeCommand?.id
        ?? runtimePersistence.resumeCommandId
        ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.resumeCommandId
        ?? null,
      resumeStatus: runtimePersistence.resumeCommand?.status
        ?? runtimePersistence.resumeStatus
        ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.resumeStatus
        ?? null,
      approvalReplayManifestId: runtimePersistence.approvalReplay?.replayManifestId
        ?? runtimePersistence.approvalReplayManifestId
        ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.approvalReplayManifestId
        ?? null,
      artifactPath: runtimePersistence.artifactPath
        ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.artifactPath
        ?? null,
    },
    runtimeBoundaryAuthorization: {
      status: runtimeBoundaryAuthorization.status ?? null,
      decisionDigest: runtimeBoundaryAuthorization.decisionDigest ?? null,
      isolationKey: runtimeBoundaryAuthorization.isolationKey ?? null,
      tenant: runtimeBoundaryAuthorization.scope?.tenant ?? runtimeBoundaryAuthorization.tenant ?? null,
      workspace: runtimeBoundaryAuthorization.scope?.workspace ?? runtimeBoundaryAuthorization.workspace ?? null,
      actorId: runtimeBoundaryAuthorization.scope?.actorId ?? runtimeBoundaryAuthorization.actorId ?? null,
      deniedReasons: runtimeBoundaryAuthorization.deniedReasons ?? [],
      deniedActions: runtimeBoundaryAuthorization.deniedActions ?? [],
      auditSink: runtimeBoundaryAuthorization.auditChain?.sink
        ?? runtimeBoundaryAuthorization.auditSink
        ?? null,
      auditRestartSafe: runtimeBoundaryAuthorization.auditChain?.restartSafe
        ?? runtimeBoundaryAuthorization.auditRestartSafe
        ?? null,
      artifactPath: runtimeBoundaryAuthorization.artifactPath ?? null,
    },
    nextAction,
    nextActionLabel: normalizeNextActionLabel(nextAction),
    nextSteps,
  };
}

export function buildMailchimpClaimPacket(input = {}) {
  const source = normalizeClaimSource(input);
  const claims = [
    ...buildRuntimeClaims(source),
    ...buildArtifactClaims(source),
    ...buildVerifierClaims(source),
  ];
  const claimSummary = summarizeClaims(claims);
  const verifierStatus = claimStatusFromVerifier(source.verifierReport);
  const issueCodes = uniqueSorted([
    ...source.issues.map((issue) => issue.code),
    ...source.verifierReport.summary.issueCodes,
  ]);
  const digest = stableContractDigest({
    providerJobId: source.providerJob?.jobId ?? null,
    verifierReportId: source.verifierReport.reportId,
    claims,
    issueCodes,
  });
  const previewReadiness = buildClaimPreviewReadiness(source, claimSummary, issueCodes);
  const claimAnalyticsExport = buildClaimAnalyticsExport(source, claims, claimSummary, issueCodes, digest, previewReadiness);

  return {
    kind: "aios.claim.packet",
    claimPacketId: `claim:${digest.slice(-8)}`,
    status: claimSummary.status === "asserted" ? verifierStatus : claimSummary.status,
    digest,
    subject: {
      provider: source.providerJob?.provider ?? "mailchimp",
      product: source.providerJob?.product ?? "Mailchimp",
      providerJobId: source.providerJob?.jobId ?? null,
      workspaceBoundaryId: source.workspaceBoundaryId,
    },
    verifier: {
      reportId: source.verifierReport.reportId,
      status: source.verifierReport.status,
      requiredFailed: source.verifierReport.summary.requiredFailed,
      issueCodes: source.verifierReport.summary.issueCodes,
    },
    claimSummary,
    claims,
    previewReadiness,
    claimAnalyticsExport,
    evidenceIndex: {
      artifacts: Object.fromEntries(asArray(source.artifactPlan).map((artifact) => [artifact.logicalName, artifact.path])),
      analyticsExportId: source.analyticsExport?.exportId ?? null,
      operatorControlStateId: source.operatorControlState?.stateId ?? null,
      continuationPacketId: source.continuationPacket?.packetId ?? null,
      approvalId: source.previewApproval?.approvalId ?? source.continuationPacket?.approvalHandoff?.approvalId ?? null,
      approvalReportId: source.previewApproval?.handoff?.reportId
        ?? source.previewApproval?.reportId
        ?? source.continuationPacket?.approvalHandoff?.reportId
        ?? null,
      approvalCheckpointKey: source.clientResumeCheckpoint?.checkpointKey
        ?? source.previewApproval?.handoff?.checkpointKey
        ?? source.continuationPacket?.clientWorkflow?.clientResumeCheckpoint?.checkpointKey
        ?? null,
      approvalCheckpointPath: source.clientResumeCheckpoint?.artifactPath
        ?? source.continuationPacket?.clientWorkflow?.clientResumeCheckpoint?.artifactPath
        ?? null,
      approvalReplayManifestId: source.clientResumeCheckpoint?.replayManifest?.manifestId
        ?? source.previewApproval?.handoff?.replayManifestId
        ?? source.continuationPacket?.clientWorkflow?.clientResumeCheckpoint?.replayManifestId
        ?? null,
      providerRuntimeStateKey: source.runtimePersistence?.stateKey
        ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.stateKey
        ?? null,
      providerRuntimeChecksum: source.runtimePersistence?.checksum
        ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.checksum
        ?? null,
      providerRuntimeStatePath: source.runtimePersistence?.artifactPath
        ?? source.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.artifactPath
        ?? null,
      capabilityNegotiationDigest: source.capabilityNegotiation?.digest ?? null,
      runtimeBoundaryAuthorizationDigest: source.runtimeBoundaryAuthorization?.decisionDigest
        ?? source.continuationPacket?.clientWorkflow?.runtimeBoundaryAuthorization?.decisionDigest
        ?? null,
      runtimeBoundaryAuthorizationPath: source.runtimeBoundaryAuthorization?.artifactPath
        ?? source.continuationPacket?.clientWorkflow?.runtimeBoundaryAuthorization?.artifactPath
        ?? null,
      workspaceAuthorizationPostureId: source.workspaceAuthorizationPosture?.postureId
        ?? source.continuationPacket?.clientWorkflow?.workspaceAuthorizationPosture?.postureId
        ?? null,
      workspaceAuthorizationPostureDigest: source.workspaceAuthorizationPosture?.digest
        ?? source.continuationPacket?.clientWorkflow?.workspaceAuthorizationPosture?.digest
        ?? null,
      workspaceAuthorizationPosturePath: source.continuationPacket?.clientWorkflow?.workspaceAuthorizationPosture?.artifactPath
        ?? null,
    },
    handoff: {
      nextAction: previewReadiness.nextAction
        ?? source.operatorControlState?.nextAction
        ?? source.continuationPacket?.nextClientStep
        ?? source.providerJob?.lifecycleState?.transitionPlan?.handoff?.nextAction
        ?? source.providerJob?.lifecycleState?.nextAction
        ?? "operator.review",
      requestedCommand: source.operatorControlState?.requestedCommand
        ?? source.continuationPacket?.clientWorkflow?.requestedCommand
        ?? source.providerJob?.lifecycleState?.transitionPlan?.requestedCommand
        ?? null,
      lifecycleTransitionStatus: source.operatorControlState?.transitionStatus
        ?? source.continuationPacket?.clientWorkflow?.transitionStatus
        ?? source.providerJob?.lifecycleState?.transitionPlan?.status
        ?? null,
      statusOnFailure: source.providerJob?.recovery?.statusOnAdapterFailure
        ?? source.continuationPacket?.resumable?.reason
        ?? "operator_review_required",
      retryMode: source.continuationPacket?.retryBackoff?.mode
        ?? source.providerJob?.operationalHealth?.retryPlan?.mode
        ?? null,
      issueCodes,
      previewReadinessStatus: previewReadiness.status,
      previewEnabled: previewReadiness.readiness.previewEnabled,
      commitEnabled: previewReadiness.readiness.commitEnabled,
      approvalId: previewReadiness.approval?.approvalId ?? null,
      approvalStatus: previewReadiness.approval?.status ?? null,
      approvalNextAction: previewReadiness.approval?.nextAction ?? null,
      approvalCheckpointKey: previewReadiness.clientResumeCheckpoint?.checkpointKey ?? null,
      approvalCheckpointStatus: previewReadiness.clientResumeCheckpoint?.status ?? null,
      approvalResumeCommandId: previewReadiness.clientResumeCheckpoint?.resumeCommandId ?? null,
      approvalCheckpointRestartSafe: previewReadiness.clientResumeCheckpoint?.restartSafe ?? null,
      approvalReplayManifestId: previewReadiness.clientResumeCheckpoint?.replayManifestId ?? null,
      approvalReplayStatus: previewReadiness.clientResumeCheckpoint?.replayStatus ?? null,
      providerRuntimeStateKey: previewReadiness.providerRuntimePersistence?.stateKey ?? null,
      providerRuntimeStatus: previewReadiness.providerRuntimePersistence?.status ?? null,
      providerRuntimeChecksum: previewReadiness.providerRuntimePersistence?.checksum ?? null,
      providerRuntimeResumeCommandId: previewReadiness.providerRuntimePersistence?.resumeCommandId ?? null,
      providerRuntimeResumeStatus: previewReadiness.providerRuntimePersistence?.resumeStatus ?? null,
      runtimeBoundaryAuthorizationStatus: previewReadiness.runtimeBoundaryAuthorization?.status ?? null,
      runtimeBoundaryAuthorizationDigest: previewReadiness.runtimeBoundaryAuthorization?.decisionDigest ?? null,
      runtimeBoundaryIsolationKey: previewReadiness.runtimeBoundaryAuthorization?.isolationKey ?? null,
      workspaceAuthorizationPostureId: claimAnalyticsExport.exportSummary.workspaceAuthorizationPostureId
        ?? source.workspaceAuthorizationPosture?.postureId
        ?? null,
      claimAnalyticsExportId: claimAnalyticsExport.exportId,
    },
  };
}

export function summarizeMailchimpClaimStatus(input = {}) {
  const packet = input.kind === "aios.claim.packet" ? input : buildMailchimpClaimPacket(input);

  return {
    claimPacketId: packet.claimPacketId,
    status: packet.status,
    providerJobId: packet.subject.providerJobId,
    workspaceBoundaryId: packet.subject.workspaceBoundaryId,
    verifierReportId: packet.verifier.reportId,
    totalClaims: packet.claimSummary.total,
    blockedClaims: packet.claimSummary.blockedClaims,
    previewReadinessStatus: packet.previewReadiness?.status ?? null,
    previewEnabled: packet.previewReadiness?.readiness?.previewEnabled ?? null,
    commitEnabled: packet.previewReadiness?.readiness?.commitEnabled ?? null,
    nextAction: packet.handoff.nextAction,
    nextActionLabel: packet.previewReadiness?.nextActionLabel ?? null,
    approvalId: packet.previewReadiness?.approval?.approvalId ?? null,
    approvalStatus: packet.previewReadiness?.approval?.status ?? null,
    approvalNextAction: packet.previewReadiness?.approval?.nextAction ?? null,
    approvalCheckpointKey: packet.previewReadiness?.clientResumeCheckpoint?.checkpointKey ?? null,
    approvalCheckpointStatus: packet.previewReadiness?.clientResumeCheckpoint?.status ?? null,
    approvalResumeCommandId: packet.previewReadiness?.clientResumeCheckpoint?.resumeCommandId ?? null,
    approvalReplayManifestId: packet.previewReadiness?.clientResumeCheckpoint?.replayManifestId ?? null,
    approvalReplayStatus: packet.previewReadiness?.clientResumeCheckpoint?.replayStatus ?? null,
    providerRuntimeStateKey: packet.previewReadiness?.providerRuntimePersistence?.stateKey ?? null,
    providerRuntimeStatus: packet.previewReadiness?.providerRuntimePersistence?.status ?? null,
    providerRuntimeResumeCommandId: packet.previewReadiness?.providerRuntimePersistence?.resumeCommandId ?? null,
    providerRuntimeResumeStatus: packet.previewReadiness?.providerRuntimePersistence?.resumeStatus ?? null,
    runtimeBoundaryAuthorizationStatus: packet.previewReadiness?.runtimeBoundaryAuthorization?.status ?? null,
    runtimeBoundaryAuthorizationDigest: packet.previewReadiness?.runtimeBoundaryAuthorization?.decisionDigest ?? null,
    runtimeBoundaryIsolationKey: packet.previewReadiness?.runtimeBoundaryAuthorization?.isolationKey ?? null,
    workspaceAuthorizationPostureId: packet.evidenceIndex?.workspaceAuthorizationPostureId ?? null,
    workspaceAuthorizationPostureDigest: packet.evidenceIndex?.workspaceAuthorizationPostureDigest ?? null,
    claimAnalyticsExportId: packet.claimAnalyticsExport?.exportId ?? null,
    claimAnalyticsStatus: packet.claimAnalyticsExport?.status ?? null,
    claimAnalyticsCounters: packet.claimAnalyticsExport?.counters ?? null,
    requestedCommand: packet.handoff.requestedCommand,
    lifecycleTransitionStatus: packet.handoff.lifecycleTransitionStatus,
    issueCodes: packet.handoff.issueCodes,
  };
}
