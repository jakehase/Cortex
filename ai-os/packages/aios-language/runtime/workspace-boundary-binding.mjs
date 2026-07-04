import { buildMailchimpClaimPacket } from "./claim-binding.mjs";
import { compileMailchimpProviderJob, normalizeMailchimpProviderContract, stableContractDigest } from "./provider-contract-binding.mjs";
import { evaluateMailchimpVerifierBinding } from "./verifier-binding.mjs";

const DEFAULT_WORKSPACE_ROOT = "workspace://local";

function cleanSegment(value, fallback) {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "-"))
    .join("/");
}

function cleanArray(values) {
  return Array.isArray(values)
    ? values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
    : [];
}

function normalizeWorkspace(input = {}) {
  const workspace = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const workspaceId = cleanSegment(workspace.workspaceId ?? workspace.id, "default");
  const artifactRoot = cleanSegment(workspace.artifactRoot, `artifacts/mailchimp/${workspaceId}`);

  return {
    root: typeof workspace.root === "string" && workspace.root.trim() ? workspace.root.trim() : DEFAULT_WORKSPACE_ROOT,
    workspaceId,
    artifactRoot,
    allowedSchemes: cleanArray(workspace.allowedSchemes).length ? cleanArray(workspace.allowedSchemes) : ["workspace", "memory"],
    localOnly: workspace.localOnly !== false,
  };
}

function makeArtifactPath(workspace, audienceId, fileName) {
  const safeAudience = cleanSegment(audienceId, "unbound");
  return `${workspace.root}/${workspace.artifactRoot}/${safeAudience}/${fileName}`;
}

function runtimeBoundaryAuthorizationFromJob(job) {
  return job.runtimeBoundary?.authorization
    ?? job.adapterHandoff?.runtimeBoundaryAuthorization
    ?? job.adapterHandoff?.runtimeBoundary?.authorization
    ?? null;
}

function buildBoundaryAuthorizationPosture(workspace, job, boundaryIssues) {
  const authorization = runtimeBoundaryAuthorizationFromJob(job);
  const lifecycle = job.lifecycleState ?? {};
  const scope = authorization?.scope ?? {};
  const permissionMatrix = Array.isArray(authorization?.permissionMatrix)
    ? authorization.permissionMatrix
    : [];
  const deniedActions = Array.isArray(authorization?.deniedActions)
    ? authorization.deniedActions
    : [];
  const missingPermissions = Array.isArray(authorization?.missingPermissions)
    ? authorization.missingPermissions
    : permissionMatrix
        .filter((entry) => entry.allowed === false && typeof entry.permission === "string")
        .map((entry) => entry.permission);
  const requiredPermissions = permissionMatrix
    .map((entry) => entry.permission)
    .filter((permission) => typeof permission === "string" && permission);
  const localIssues = boundaryIssues.filter((issue) => issue.code?.startsWith("workspace."));
  const auditChain = authorization?.auditChain ?? {};
  const safeForPreview = authorization?.handoff?.safeForPreview
    ?? authorization?.controls?.previewAllowed
    ?? false;
  const safeForCommit = authorization?.handoff?.safeForCommit
    ?? authorization?.controls?.commitAllowed
    ?? false;
  const commitRequested = job.commitMode === "adapter-mediated"
    || lifecycle.controls?.commitAllowed === true
    || lifecycle.transitionPlan?.requestedCommand === "sync.commit";
  const workspaceMatches = !scope.workspace
    || workspace.workspaceId === "default"
    || scope.workspace === workspace.workspaceId;
  const auditReady = auditChain.appendOnly === true && auditChain.restartSafe === true;
  const blockedReasons = [
    ...(authorization ? [] : ["authorization_missing"]),
    ...(authorization?.status === "denied" ? ["authorization_denied"] : []),
    ...(workspaceMatches ? [] : ["workspace_scope_mismatch"]),
    ...(missingPermissions.length ? ["permission_gap"] : []),
    ...(auditReady ? [] : ["audit_handoff_not_restart_safe"]),
    ...(commitRequested && safeForCommit !== true ? ["commit_not_authorized"] : []),
    ...localIssues.filter((issue) => issue.severity === "error").map((issue) => issue.code),
  ];
  const status = blockedReasons.length
    ? "blocked"
    : safeForCommit
      ? "commit-scoped"
      : safeForPreview
        ? "preview-scoped"
        : "audit-only";
  const postureDigest = stableContractDigest({
    workspaceId: workspace.workspaceId,
    authorizationDigest: authorization?.decisionDigest ?? null,
    authorizationStatus: authorization?.status ?? null,
    scope,
    requiredPermissions,
    missingPermissions,
    deniedActions,
    auditReady,
    safeForPreview,
    safeForCommit,
    blockedReasons,
  });

  return {
    kind: "aios.workspace.authorization_posture",
    version: "mailchimp.workspace-authorization-posture.v1",
    postureId: `workspace-auth:${workspace.workspaceId}:${postureDigest.slice(-8)}`,
    status,
    digest: postureDigest,
    workspaceId: workspace.workspaceId,
    providerJobId: job.jobId,
    authorizationStatus: authorization?.status ?? "missing",
    authorizationDigest: authorization?.decisionDigest ?? null,
    isolationKey: authorization?.isolationKey ?? null,
    scope: {
      tenant: scope.tenant ?? null,
      workspace: scope.workspace ?? null,
      actorId: scope.actorId ?? null,
      leaseId: scope.leaseId ?? null,
      policyVersion: scope.policyVersion ?? null,
    },
    permissions: {
      required: requiredPermissions,
      missing: missingPermissions,
      deniedActions,
      matrix: permissionMatrix,
    },
    gates: {
      workspaceMatches,
      auditReady,
      safeForPreview,
      safeForCommit,
      localOnly: workspace.localOnly,
      commitRequested,
    },
    auditHandoff: {
      sink: auditChain.sink ?? authorization?.auditSink ?? null,
      appendOnly: auditChain.appendOnly === true,
      restartSafe: auditChain.restartSafe === true,
      eventType: auditChain.eventType ?? "mailchimp.workspace.authorization.posture",
      requiredFields: auditChain.requiredFields ?? [
        "tenant",
        "workspace",
        "actorId",
        "decisionDigest",
        "status",
      ],
    },
    blockedReasons,
    nextAction: blockedReasons.includes("authorization_missing") || blockedReasons.includes("authorization_denied")
      ? "bind-runtime-boundary"
      : blockedReasons.includes("permission_gap")
        ? "repair-runtime-permissions"
        : blockedReasons.includes("audit_handoff_not_restart_safe")
          ? "repair-audit-handoff"
          : safeForCommit
            ? "sync.commit"
            : safeForPreview
              ? "sync.preview"
              : "operator.review",
  };
}

function collectBoundaryIssues(workspace, job) {
  const issues = [];
  const authorization = runtimeBoundaryAuthorizationFromJob(job);

  if (!workspace.localOnly) {
    issues.push({
      code: "workspace.local_only_disabled",
      severity: "error",
      message: "Workspace boundary binding requires localOnly workspace execution.",
      path: "workspace.localOnly",
    });
  }

  if (!workspace.root.startsWith("workspace://") && !workspace.root.startsWith("memory://")) {
    issues.push({
      code: "workspace.root_scheme",
      severity: "error",
      message: "Workspace root must use workspace:// or memory:// scheme.",
      path: "workspace.root",
    });
  }

  if (authorization?.status === "denied") {
    issues.push({
      code: "workspace.runtime_authorization_denied",
      severity: "error",
      message: "Workspace boundary cannot persist Mailchimp artifacts for a denied runtime authorization.",
      path: "providerJob.runtimeBoundary.authorization",
    });
  }

  if (authorization?.scope?.workspace && workspace.workspaceId !== "default" && authorization.scope.workspace !== workspace.workspaceId) {
    issues.push({
      code: "workspace.runtime_scope_mismatch",
      severity: "error",
      message: "Workspace id must match the Mailchimp runtime authorization workspace scope.",
      path: "workspace.workspaceId",
    });
  }

  if (authorization?.auditChain?.appendOnly !== true || authorization?.auditChain?.restartSafe !== true) {
    issues.push({
      code: "workspace.runtime_audit_handoff_unbound",
      severity: "warning",
      message: "Runtime authorization audit handoff must be append-only and restart-safe for workspace replay.",
      path: "providerJob.runtimeBoundary.authorization.auditChain",
    });
  }

  if (job.status === "blocked") {
    for (const issue of job.issues.filter((item) => item.severity === "error")) {
      issues.push({ ...issue, inheritedFrom: "provider-contract" });
    }
  }

  return issues;
}

function countSeverities(issues) {
  return issues.reduce(
    (counts, issue) => ({
      ...counts,
      [issue.severity ?? "unknown"]: (counts[issue.severity ?? "unknown"] ?? 0) + 1,
    }),
    {},
  );
}

function buildBoundaryHistorySnapshot({ workspace, job, artifacts, boundaryIssues, boundaryDigest, authorizationPosture }) {
  const issueCounts = countSeverities([...job.issues, ...boundaryIssues]);
  const writeCount = artifacts.filter((artifact) => artifact.writeMode === "replace").length;
  const appendCount = artifacts.filter((artifact) => artifact.writeMode === "append").length;
  const lifecycle = job.lifecycleState ?? {};

  return {
    kind: "aios.workspace.boundary_history_snapshot",
    snapshotId: `snapshot:${boundaryDigest.slice(-8)}`,
    workspaceId: workspace.workspaceId,
    providerJobId: job.jobId,
    status: boundaryIssues.some((issue) => issue.severity === "error") || job.status === "blocked" ? "blocked" : "ready",
    commitMode: job.commitMode,
    nextAction: lifecycle.nextAction ?? "operator.review",
    artifactTotals: {
      total: artifacts.length,
      replace: writeCount,
      append: appendCount,
      localOnly: true,
    },
    issueCounts,
    gates: {
      localOnly: workspace.localOnly,
      rootSchemeAllowed: workspace.root.startsWith("workspace://") || workspace.root.startsWith("memory://"),
      providerReady: job.status !== "blocked",
      authorizationScoped: authorizationPosture?.status === "preview-scoped" || authorizationPosture?.status === "commit-scoped",
      auditReady: authorizationPosture?.gates?.auditReady === true,
      previewAllowed: lifecycle.controls?.previewAllowed === true,
      commitAllowed: lifecycle.controls?.commitAllowed === true,
      settingsValidated: lifecycle.gates?.settingsValidated === true,
      scheduleOpen: lifecycle.gates?.scheduleOpen === true,
    },
    authorization: authorizationPosture
      ? {
          postureId: authorizationPosture.postureId,
          status: authorizationPosture.status,
          tenant: authorizationPosture.scope.tenant,
          workspace: authorizationPosture.scope.workspace,
          missingPermissions: authorizationPosture.permissions.missing,
          deniedActions: authorizationPosture.permissions.deniedActions,
          blockedReasons: authorizationPosture.blockedReasons,
        }
      : null,
  };
}

function buildOperatorControlState({ workspace, job, artifacts, boundaryIssues, boundaryDigest }) {
  const lifecycle = job.lifecycleState ?? {};
  const transitionPlan = lifecycle.transitionPlan ?? job.adapterHandoff?.lifecycleTransition ?? null;
  const commandQueue = Array.isArray(lifecycle.commandQueue) ? lifecycle.commandQueue : [];
  const blockingIssueCodes = [...job.issues, ...boundaryIssues]
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
  const availableCommands = commandQueue.filter((entry) => entry.status === "ready").map((entry) => entry.command);
  const blockedCommands = commandQueue.filter((entry) => entry.status !== "ready").map((entry) => ({
    command: entry.command,
    reason: entry.reason,
  }));

  return {
    kind: "aios.workspace.operator_control_state",
    stateId: `operator:${workspace.workspaceId}:${boundaryDigest.slice(-8)}`,
    status: blockingIssueCodes.length ? "blocked" : "ready",
    workspaceId: workspace.workspaceId,
    providerJobId: job.jobId,
    settingsRevision: lifecycle.settingsRevision ?? null,
    settingsValidation: lifecycle.settingsValidation ?? {
      status: blockingIssueCodes.length ? "blocked" : "ready",
      checkedFields: [],
      issueCodes: blockingIssueCodes,
    },
    lifecycleTransition: transitionPlan,
    schedulingControls: lifecycle.schedulingControls ?? {
      cadence: lifecycle.schedule?.cadence ?? "manual",
      paused: lifecycle.schedule?.paused === true,
      manualRunAllowed: lifecycle.controls?.previewAllowed === true,
      nextScheduledAction: lifecycle.nextAction ?? "operator.review",
    },
    enablementControls: {
      enabled: lifecycle.enabled === true,
      enableAllowed: lifecycle.controls?.enableAllowed === true,
      disableAllowed: lifecycle.controls?.disableAllowed === true,
      previewAllowed: lifecycle.controls?.previewAllowed === true,
      commitAllowed: lifecycle.controls?.commitAllowed === true,
      acceptanceRequired: lifecycle.controls?.acceptanceRequired !== false,
    },
    commandQueue,
    availableCommands,
    blockedCommands,
    nextAction: transitionPlan?.handoff?.nextAction ?? lifecycle.nextAction ?? "operator.review",
    requestedCommand: transitionPlan?.requestedCommand ?? null,
    transitionStatus: transitionPlan?.status ?? null,
    transitionBlockers: transitionPlan?.blockers ?? [],
    artifacts: artifacts.map((artifact) => ({
      logicalName: artifact.logicalName,
      path: artifact.path,
      writeMode: artifact.writeMode,
    })),
    blockingIssueCodes,
  };
}

function buildContinuationPacket({ workspace, job, artifacts, boundaryIssues, boundaryDigest, authorizationPosture }) {
  const allIssues = [...job.issues, ...boundaryIssues];
  const blockingIssues = allIssues.filter((issue) => issue.severity === "error");
  const warningIssues = allIssues.filter((issue) => issue.severity === "warning");
  const lifecycle = job.lifecycleState ?? {};
  const authorization = runtimeBoundaryAuthorizationFromJob(job);
  const transitionPlan = lifecycle.transitionPlan ?? job.adapterHandoff?.lifecycleTransition ?? null;
  const previewAcceptance = job.previewAcceptance ?? job.adapterHandoff?.previewAcceptance ?? null;
  const previewApproval = job.previewApproval ?? job.adapterHandoff?.previewApproval ?? null;
  const clientResumeCheckpoint = previewApproval?.clientResumeCheckpoint ?? null;
  const runtimePersistence = job.runtimePersistence ?? job.adapterHandoff?.runtimePersistence ?? null;
  const operationalHealth = job.operationalHealth ?? job.adapterHandoff?.operationalHealth ?? null;
  const canRetry = blockingIssues.length === 0 && operationalHealth?.retryPlan?.mode !== "do-not-retry-until-settings-change";
  const artifactIndex = Object.fromEntries(artifacts.map((artifact) => [artifact.logicalName, artifact.path]));
  const nextClientStep = blockingIssues.length
    ? "settings.fix"
    : transitionPlan?.allowed === false && transitionPlan.blockers?.[0]?.action
      ? transitionPlan.blockers[0].action
    : previewAcceptance?.acceptanceGate?.status === "awaiting-operator-acceptance"
      ? "preview.accept"
      : transitionPlan?.handoff?.nextAction ?? lifecycle.nextAction ?? "operator.review";

  return {
    kind: "aios.workspace.continuation_packet",
    packetId: `continuation:${workspace.workspaceId}:${boundaryDigest.slice(-8)}`,
    workspaceId: workspace.workspaceId,
    providerJobId: job.jobId,
    status: blockingIssues.length ? "blocked" : operationalHealth?.status ?? "ready",
    nextClientStep,
    resumable: {
      allowed: canRetry,
      cursor: `${job.jobId}:${boundaryDigest.slice(-8)}`,
      reason: canRetry
        ? "Runtime may replay local artifacts and retry adapter handoff."
        : "Resolve blocking provider or workspace issues before retry.",
      providerStateKey: runtimePersistence?.stateKey ?? null,
      providerChecksum: runtimePersistence?.checksum ?? null,
      providerResumeCommandId: runtimePersistence?.resumeCommand?.id ?? null,
      providerRuntimeStatePath: artifactIndex["provider-runtime-state"] ?? null,
    },
    degradedMode: {
      active: warningIssues.length > 0 || operationalHealth?.degraded === true,
      localPreviewOnly: job.commitMode !== "adapter-mediated" || lifecycle.controls?.commitAllowed !== true,
      reasons: [
        ...(operationalHealth?.degradedReasons ?? []),
        ...warningIssues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          action: "review-workspace-boundary",
          message: issue.message,
        })),
      ],
    },
    retryBackoff: operationalHealth?.retryPlan ?? {
      mode: blockingIssues.length ? "do-not-retry-until-settings-change" : "bounded-workspace-replay",
      limit: 1,
      backoff: blockingIssues.length ? "none" : "linear",
      retryableIssueCodes: warningIssues.map((issue) => issue.code),
    },
    clientWorkflow: {
      previewContract: previewAcceptance,
      approvalContract: previewApproval
        ? {
            approvalId: previewApproval.approvalId,
            status: previewApproval.status,
            approvalRequired: previewApproval.readiness?.approvalRequired ?? null,
            awaitingAcceptance: previewApproval.readiness?.awaitingAcceptance ?? null,
            nextAction: previewApproval.handoff?.nextAction ?? previewApproval.nextStep?.id ?? null,
            reportId: previewApproval.handoff?.reportId ?? previewApproval.reporting?.reportId ?? null,
            checkpointKey: clientResumeCheckpoint?.checkpointKey ?? previewApproval.handoff?.checkpointKey ?? null,
            checkpointStatus: clientResumeCheckpoint?.status ?? previewApproval.handoff?.checkpointStatus ?? null,
            nextClientAction: clientResumeCheckpoint?.clientStatus?.nextClientAction ?? previewApproval.handoff?.nextClientAction ?? null,
            artifactPath: artifactIndex["approval-preview"] ?? null,
            checkpointPath: artifactIndex["client-resume-checkpoint"] ?? null,
          }
        : null,
      clientResumeCheckpoint: clientResumeCheckpoint
        ? {
            checkpointKey: clientResumeCheckpoint.checkpointKey,
            status: clientResumeCheckpoint.status,
            restartSafe: clientResumeCheckpoint.restartSafe,
            checksum: clientResumeCheckpoint.checksum,
            replayManifestId: clientResumeCheckpoint.replayManifest?.manifestId ?? null,
            replayStatus: clientResumeCheckpoint.replayManifest?.status ?? null,
            replayChecksum: clientResumeCheckpoint.replayManifest?.checksum ?? clientResumeCheckpoint.checksum ?? null,
            nextClientAction: clientResumeCheckpoint.clientStatus?.nextClientAction ?? null,
            visibleState: clientResumeCheckpoint.clientStatus?.visibleState ?? null,
            persistCommandId: clientResumeCheckpoint.commands?.persist?.id ?? null,
            resumeCommandId: clientResumeCheckpoint.commands?.resume?.id ?? null,
            recoveryStatusOnFailure: clientResumeCheckpoint.recovery?.statusOnFailure ?? null,
            artifactPath: artifactIndex["client-resume-checkpoint"] ?? null,
          }
        : null,
      providerRuntimePersistence: runtimePersistence
        ? {
            stateKey: runtimePersistence.stateKey,
            status: runtimePersistence.status,
            sequence: runtimePersistence.sequence,
            checksum: runtimePersistence.checksum,
            restartSafe: runtimePersistence.restartSafe,
            alreadyPersisted: runtimePersistence.alreadyPersisted,
            persistCommandId: runtimePersistence.persistCommand?.id ?? null,
            persistStatus: runtimePersistence.persistCommand?.status ?? null,
            resumeCommandId: runtimePersistence.resumeCommand?.id ?? null,
            resumeStatus: runtimePersistence.resumeCommand?.status ?? null,
            approvalReplayManifestId: runtimePersistence.approvalReplay?.replayManifestId ?? null,
            approvalReplayStatus: runtimePersistence.approvalReplay?.replayStatus ?? null,
            artifactPath: artifactIndex["provider-runtime-state"] ?? null,
            recoveryActions: (runtimePersistence.recovery ?? []).map((entry) => ({
              code: entry.code,
              action: entry.action,
            })),
          }
        : null,
      runtimeBoundaryAuthorization: authorization
        ? {
            status: authorization.status,
            decisionDigest: authorization.decisionDigest,
            isolationKey: authorization.isolationKey,
            tenant: authorization.scope?.tenant ?? null,
            workspace: authorization.scope?.workspace ?? null,
            actorId: authorization.scope?.actorId ?? null,
            deniedReasons: authorization.deniedReasons ?? [],
            deniedActions: authorization.deniedActions ?? [],
            safeForPreview: authorization.handoff?.safeForPreview ?? null,
            safeForCommit: authorization.handoff?.safeForCommit ?? null,
            auditSink: authorization.auditChain?.sink ?? null,
            auditRestartSafe: authorization.auditChain?.restartSafe ?? null,
            artifactPath: artifactIndex["runtime-boundary-authorization"] ?? null,
          }
        : null,
      workspaceAuthorizationPosture: authorizationPosture
        ? {
            postureId: authorizationPosture.postureId,
            status: authorizationPosture.status,
            digest: authorizationPosture.digest,
            nextAction: authorizationPosture.nextAction,
            blockedReasons: authorizationPosture.blockedReasons,
            gates: authorizationPosture.gates,
            auditHandoff: authorizationPosture.auditHandoff,
            artifactPath: artifactIndex["workspace-authorization-posture"] ?? null,
          }
        : null,
      settingsValidation: lifecycle.settingsValidation ?? null,
      lifecycleTransition: transitionPlan,
      commandQueue: lifecycle.commandQueue ?? [],
      availableCommands: (lifecycle.commandQueue ?? []).filter((entry) => entry.status === "ready").map((entry) => entry.command),
      blockedCommands: (lifecycle.commandQueue ?? []).filter((entry) => entry.status !== "ready").map((entry) => ({
        command: entry.command,
        reason: entry.reason,
      })),
      requestedCommand: transitionPlan?.requestedCommand ?? null,
      transitionStatus: transitionPlan?.status ?? null,
      transitionResumeToken: transitionPlan?.resume?.token ?? null,
    },
    artifactIndex,
    approvalHandoff: previewApproval
      ? {
          approvalId: previewApproval.approvalId,
          status: previewApproval.status,
          nextAction: previewApproval.handoff?.nextAction ?? previewApproval.nextStep?.id ?? null,
          receiptStatus: previewApproval.handoff?.receiptStatus ?? previewApproval.statusContract?.receipt?.status ?? null,
          adapterStatus: previewApproval.handoff?.adapterStatus ?? previewApproval.statusContract?.adapter?.status ?? null,
          reportId: previewApproval.handoff?.reportId ?? previewApproval.reporting?.reportId ?? null,
          exportReady: previewApproval.handoff?.exportReady ?? previewApproval.reporting?.exportReady ?? false,
          checkpointKey: clientResumeCheckpoint?.checkpointKey ?? previewApproval.handoff?.checkpointKey ?? null,
          checkpointStatus: clientResumeCheckpoint?.status ?? previewApproval.handoff?.checkpointStatus ?? null,
          resumeCommandId: clientResumeCheckpoint?.commands?.resume?.id ?? previewApproval.handoff?.resumeCommandId ?? null,
          replayManifestId: clientResumeCheckpoint?.replayManifest?.manifestId ?? previewApproval.handoff?.replayManifestId ?? null,
          replayStatus: clientResumeCheckpoint?.replayManifest?.status ?? previewApproval.handoff?.replayStatus ?? null,
          nextClientAction: clientResumeCheckpoint?.clientStatus?.nextClientAction ?? previewApproval.handoff?.nextClientAction ?? null,
          artifactPath: artifactIndex["approval-preview"] ?? null,
          checkpointPath: artifactIndex["client-resume-checkpoint"] ?? null,
        }
      : null,
    issueSummary: {
      errors: blockingIssues.map((issue) => issue.code),
      warnings: warningIssues.map((issue) => issue.code),
      total: allIssues.length,
    },
  };
}

function buildAnalyticsExport({ workspace, job, artifacts, boundaryIssues, boundaryDigest, authorizationPosture }) {
  const historySnapshot = buildBoundaryHistorySnapshot({
    workspace,
    job,
    artifacts,
    boundaryIssues,
    boundaryDigest,
    authorizationPosture,
  });
  const allIssues = [...job.issues, ...boundaryIssues];
  const transitionPlan = job.lifecycleState?.transitionPlan ?? job.adapterHandoff?.lifecycleTransition ?? null;
  const issueCodes = [...new Set(allIssues.map((issue) => issue.code))].sort();
  const timeline = [
    {
      step: "provider-contract.normalized",
      status: job.issues.some((issue) => issue.severity === "error") ? "blocked" : "ready",
      evidence: job.verifierContracts.map((contract) => contract.name),
    },
    {
      step: "workspace-boundary.checked",
      status: boundaryIssues.some((issue) => issue.severity === "error") ? "blocked" : "ready",
      evidence: artifacts.map((artifact) => artifact.logicalName),
    },
    {
      step: "workspace-authorization.posture",
      status: authorizationPosture?.status ?? "missing",
      evidence: [
        authorizationPosture?.authorizationDigest ?? "no-authorization-digest",
        authorizationPosture?.scope?.tenant ?? "no-tenant",
        authorizationPosture?.scope?.workspace ?? "no-workspace",
        ...(authorizationPosture?.blockedReasons ?? []),
      ],
    },
    {
      step: "lifecycle-settings.controls-shaped",
      status: job.lifecycleState?.settingsValidation?.status ?? historySnapshot.status,
      evidence: [
        job.lifecycleState?.settingsRevision ?? "draft",
        job.lifecycleState?.schedulingControls?.nextScheduledAction ?? job.lifecycleState?.nextAction ?? "operator.review",
      ],
    },
    {
      step: "lifecycle-transition.evaluated",
      status: transitionPlan?.status ?? "unknown",
      evidence: [
        transitionPlan?.requestedCommand ?? "unbound",
        transitionPlan?.resume?.token ?? "no-resume-token",
        ...(transitionPlan?.blockers ?? []).map((blocker) => blocker.code),
      ],
    },
    {
      step: "provider-runtime-state.persisted",
      status: job.runtimePersistence?.persistCommand?.status ?? "unknown",
      evidence: [
        job.runtimePersistence?.stateKey ?? "no-state-key",
        job.runtimePersistence?.checksum ?? "no-checksum",
        job.runtimePersistence?.resumeCommand?.status ?? "no-resume-command",
      ],
    },
    {
      step: "artifact-export.prepared",
      status: historySnapshot.status,
      evidence: artifacts.map((artifact) => artifact.path),
    },
  ];

  return {
    kind: "aios.workspace.analytics_export",
    exportId: `analytics:${workspace.workspaceId}:${boundaryDigest.slice(-8)}`,
    digest: stableContractDigest({
      boundaryDigest,
      issueCodes,
      timeline,
      lifecycle: job.lifecycleState ?? null,
    }),
    counters: {
      artifactsPlanned: artifacts.length,
      verifierContracts: job.verifierContracts.length + 1,
      localWritablePaths: artifacts.length,
      externalWritablePaths: 0,
      issueTotal: allIssues.length,
      errorTotal: allIssues.filter((issue) => issue.severity === "error").length,
      warningTotal: allIssues.filter((issue) => issue.severity === "warning").length,
      missingPermissionTotal: authorizationPosture?.permissions?.missing?.length ?? 0,
      deniedActionTotal: authorizationPosture?.permissions?.deniedActions?.length ?? 0,
      auditHandoffReady: authorizationPosture?.gates?.auditReady === true ? 1 : 0,
    },
    history: [historySnapshot],
    timeline,
    exportSummary: {
      status: historySnapshot.status,
      provider: job.provider,
      product: job.product,
      workspaceId: workspace.workspaceId,
      providerJobId: job.jobId,
      commitMode: job.commitMode,
      nextAction: historySnapshot.nextAction,
      requestedCommand: transitionPlan?.requestedCommand ?? null,
      transitionStatus: transitionPlan?.status ?? null,
      transitionBlockers: transitionPlan?.blockers ?? [],
      issueCodes,
      authorizationPosture: authorizationPosture
        ? {
            postureId: authorizationPosture.postureId,
            status: authorizationPosture.status,
            nextAction: authorizationPosture.nextAction,
            blockedReasons: authorizationPosture.blockedReasons,
          }
        : null,
    },
  };
}

export function bindMailchimpWorkspaceBoundary(input = {}) {
  const contract = normalizeMailchimpProviderContract(input.contract ?? input);
  const job = compileMailchimpProviderJob(contract);
  const workspace = normalizeWorkspace(input);
  const audienceId = contract.audience.audienceId || "unbound";
  const artifacts = [
    {
      logicalName: "contract",
      path: makeArtifactPath(workspace, audienceId, "contract.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "truth-boundary",
      path: makeArtifactPath(workspace, audienceId, "truth-boundary.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "adapter-preview",
      path: makeArtifactPath(workspace, audienceId, "adapter-preview.ndjson"),
      mediaType: "application/x-ndjson",
      writeMode: "append",
    },
    {
      logicalName: "analytics-export",
      path: makeArtifactPath(workspace, audienceId, "analytics-export.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "operator-control-state",
      path: makeArtifactPath(workspace, audienceId, "operator-control-state.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "continuation-packet",
      path: makeArtifactPath(workspace, audienceId, "continuation-packet.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "approval-preview",
      path: makeArtifactPath(workspace, audienceId, "approval-preview.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "client-resume-checkpoint",
      path: makeArtifactPath(workspace, audienceId, "client-resume-checkpoint.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "provider-runtime-state",
      path: makeArtifactPath(workspace, audienceId, "provider-runtime-state.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "runtime-boundary-authorization",
      path: makeArtifactPath(workspace, audienceId, "runtime-boundary-authorization.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "workspace-authorization-posture",
      path: makeArtifactPath(workspace, audienceId, "workspace-authorization-posture.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "verifier-report",
      path: makeArtifactPath(workspace, audienceId, "verifier-report.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
    {
      logicalName: "claim-packet",
      path: makeArtifactPath(workspace, audienceId, "claim-packet.json"),
      mediaType: "application/json",
      writeMode: "replace",
    },
  ];
  const boundaryIssues = collectBoundaryIssues(workspace, job);
  const authorizationPosture = buildBoundaryAuthorizationPosture(workspace, job, boundaryIssues);
  const boundaryDigest = stableContractDigest({
    workspace,
    jobId: job.jobId,
    artifacts,
    commitMode: job.commitMode,
    authorizationPostureDigest: authorizationPosture.digest,
  });
  const boundaryId = `workspace:${workspace.workspaceId}:${boundaryDigest.slice(-8)}`;
  const memoryContract = {
    localOnly: true,
    readable: artifacts.map((artifact) => artifact.path),
    writable: artifacts.map((artifact) => artifact.path),
    externalWritable: [],
  };
  const verifierContracts = [
    ...job.verifierContracts,
    {
      name: "workspace.local_no_external_write",
      required: true,
      allowedSchemes: workspace.allowedSchemes,
    },
  ];
  const analyticsExport = buildAnalyticsExport({
    workspace,
    job,
    artifacts,
    boundaryIssues,
    boundaryDigest,
    authorizationPosture,
  });
  const operatorControlState = buildOperatorControlState({
    workspace,
    job,
    artifacts,
    boundaryIssues,
    boundaryDigest,
  });
  const continuationPacket = buildContinuationPacket({
    workspace,
    job,
    artifacts,
    boundaryIssues,
    boundaryDigest,
    authorizationPosture,
  });
  const verifierExecution = evaluateMailchimpVerifierBinding({
    providerJob: job,
    artifactPlan: artifacts,
    memoryContract,
    verifierContracts,
    issues: boundaryIssues,
    workspaceAuthorizationPosture: authorizationPosture,
  });
  const claimPacket = buildMailchimpClaimPacket({
    workspaceBoundaryId: boundaryId,
    providerJob: job,
    artifactPlan: artifacts,
    memoryContract,
    verifierContracts,
    issues: boundaryIssues,
    analyticsExport,
    operatorControlState,
    continuationPacket,
    verifierReport: verifierExecution,
    workspaceAuthorizationPosture: authorizationPosture,
  });
  const finalStatus = boundaryIssues.some((issue) => issue.severity === "error") || verifierExecution.status === "failed" || claimPacket.status === "blocked"
    ? "blocked"
    : "ready";

  return {
    kind: "aios.workspace.boundary_binding",
    boundaryId,
    status: finalStatus,
    workspace,
    providerJob: job,
    artifactPlan: artifacts,
    memoryContract,
    verifierContracts,
    workspaceAuthorizationPosture: authorizationPosture,
    verifierExecution,
    claimPacket,
    runtimeHandoff: {
      adapter: "mailchimp",
      jobId: job.jobId,
      boundaryId,
      dryRun: job.commitMode === "dry-run",
      artifactRoot: `${workspace.root}/${workspace.artifactRoot}`,
      nextAction: job.lifecycleState?.nextAction ?? analyticsExport.exportSummary.nextAction,
      requestedCommand: job.lifecycleState?.transitionPlan?.requestedCommand ?? null,
      lifecycleTransitionStatus: job.lifecycleState?.transitionPlan?.status ?? null,
      lifecycleTransitionResumeToken: job.lifecycleState?.transitionPlan?.resume?.token ?? null,
      operatorControlStateId: operatorControlState.stateId,
      continuationPacketId: continuationPacket.packetId,
      approvalId: job.previewApproval?.approvalId ?? null,
      approvalReportId: job.previewApproval?.handoff?.reportId ?? job.previewApproval?.reporting?.reportId ?? null,
      approvalCheckpointKey: continuationPacket.clientWorkflow?.clientResumeCheckpoint?.checkpointKey ?? null,
      approvalCheckpointStatus: continuationPacket.clientWorkflow?.clientResumeCheckpoint?.status ?? null,
      approvalCheckpointPath: continuationPacket.clientWorkflow?.clientResumeCheckpoint?.artifactPath ?? null,
      approvalResumeCommandId: continuationPacket.clientWorkflow?.clientResumeCheckpoint?.resumeCommandId ?? null,
      approvalReplayManifestId: continuationPacket.clientWorkflow?.clientResumeCheckpoint?.replayManifestId ?? null,
      approvalReplayStatus: continuationPacket.clientWorkflow?.clientResumeCheckpoint?.replayStatus ?? null,
      providerRuntimeStateKey: continuationPacket.clientWorkflow?.providerRuntimePersistence?.stateKey ?? null,
      providerRuntimeStatePath: continuationPacket.clientWorkflow?.providerRuntimePersistence?.artifactPath ?? null,
      providerRuntimePersistCommandId: continuationPacket.clientWorkflow?.providerRuntimePersistence?.persistCommandId ?? null,
      providerRuntimeResumeCommandId: continuationPacket.clientWorkflow?.providerRuntimePersistence?.resumeCommandId ?? null,
      providerRuntimeResumeStatus: continuationPacket.clientWorkflow?.providerRuntimePersistence?.resumeStatus ?? null,
      runtimeBoundaryAuthorizationDigest: continuationPacket.clientWorkflow?.runtimeBoundaryAuthorization?.decisionDigest ?? null,
      runtimeBoundaryAuthorizationStatus: continuationPacket.clientWorkflow?.runtimeBoundaryAuthorization?.status ?? null,
      runtimeBoundaryAuthorizationPath: continuationPacket.clientWorkflow?.runtimeBoundaryAuthorization?.artifactPath ?? null,
      runtimeBoundaryIsolationKey: continuationPacket.clientWorkflow?.runtimeBoundaryAuthorization?.isolationKey ?? null,
      workspaceAuthorizationPostureId: authorizationPosture.postureId,
      workspaceAuthorizationPostureStatus: authorizationPosture.status,
      workspaceAuthorizationNextAction: authorizationPosture.nextAction,
      verifierReportId: verifierExecution.reportId,
      claimPacketId: claimPacket.claimPacketId,
      availableCommands: operatorControlState.availableCommands,
      healthStatus: continuationPacket.status,
      verifierStatus: verifierExecution.status,
      claimStatus: claimPacket.status,
      retryBackoff: continuationPacket.retryBackoff,
      lifecycleTransition: job.lifecycleState?.transitionPlan ?? null,
      approvalHandoff: continuationPacket.approvalHandoff,
    },
    recovery: {
      rollbackArtifacts: artifacts.map((artifact) => artifact.path),
      statusOnFailure: continuationPacket.resumable.allowed ? "workspace_replay_available" : "workspace_recovery_required",
      retryBackoff: continuationPacket.retryBackoff,
      degradedMode: continuationPacket.degradedMode,
      externalRollback: "not-applicable",
    },
    truthBoundary: {
      ...job.truthBoundary,
      workspaceDigest: boundaryDigest,
      localArtifactPaths: artifacts.map((artifact) => artifact.path),
      analyticsExportId: analyticsExport.exportId,
      operatorControlStateId: operatorControlState.stateId,
      continuationPacketId: continuationPacket.packetId,
      approvalPreviewPath: artifacts.find((artifact) => artifact.logicalName === "approval-preview")?.path ?? null,
      clientResumeCheckpointPath: artifacts.find((artifact) => artifact.logicalName === "client-resume-checkpoint")?.path ?? null,
      approvalCheckpointKey: continuationPacket.clientWorkflow?.clientResumeCheckpoint?.checkpointKey ?? null,
      approvalId: job.previewApproval?.approvalId ?? null,
      approvalReplayManifestId: continuationPacket.clientWorkflow?.clientResumeCheckpoint?.replayManifestId ?? null,
      providerRuntimeStatePath: artifacts.find((artifact) => artifact.logicalName === "provider-runtime-state")?.path ?? null,
      providerRuntimeStateKey: job.runtimePersistence?.stateKey ?? null,
      providerRuntimeChecksum: job.runtimePersistence?.checksum ?? null,
      runtimeBoundaryAuthorizationPath: artifacts.find((artifact) => artifact.logicalName === "runtime-boundary-authorization")?.path ?? null,
      runtimeBoundaryAuthorizationDigest: runtimeBoundaryAuthorizationFromJob(job)?.decisionDigest ?? null,
      runtimeBoundaryAuthorizationStatus: runtimeBoundaryAuthorizationFromJob(job)?.status ?? null,
      runtimeBoundaryIsolationKey: runtimeBoundaryAuthorizationFromJob(job)?.isolationKey ?? null,
      workspaceAuthorizationPostureId: authorizationPosture.postureId,
      workspaceAuthorizationPostureStatus: authorizationPosture.status,
      verifierReportId: verifierExecution.reportId,
      claimPacketId: claimPacket.claimPacketId,
    },
    operatorControlState,
    continuationPacket,
    analyticsExport,
    issues: boundaryIssues,
  };
}

export function summarizeWorkspaceBoundaryStatus(bindingInput = {}) {
  const binding = bindingInput.kind === "aios.workspace.boundary_binding"
    ? bindingInput
    : bindMailchimpWorkspaceBoundary(bindingInput);

  return {
    boundaryId: binding.boundaryId,
    status: binding.status,
    providerJobId: binding.providerJob.jobId,
    artifactCount: binding.artifactPlan.length,
    externalWritesAllowed: binding.memoryContract.externalWritable.length > 0,
    nextAction: binding.analyticsExport?.exportSummary?.nextAction ?? binding.providerJob.lifecycleState?.nextAction ?? "operator.review",
    requestedCommand: binding.operatorControlState?.requestedCommand
      ?? binding.providerJob.lifecycleState?.transitionPlan?.requestedCommand
      ?? null,
    lifecycleTransitionStatus: binding.operatorControlState?.transitionStatus
      ?? binding.providerJob.lifecycleState?.transitionPlan?.status
      ?? null,
    availableCommands: binding.operatorControlState?.availableCommands ?? [],
    settingsValidationStatus: binding.operatorControlState?.settingsValidation?.status ?? null,
    schedulePaused: binding.operatorControlState?.schedulingControls?.paused ?? null,
    analytics: {
      exportId: binding.analyticsExport?.exportId ?? null,
      issueTotal: binding.analyticsExport?.counters?.issueTotal ?? binding.issues.length,
      missingPermissionTotal: binding.analyticsExport?.counters?.missingPermissionTotal ?? null,
      auditHandoffReady: binding.analyticsExport?.counters?.auditHandoffReady ?? null,
      timelineSteps: binding.analyticsExport?.timeline?.map((entry) => entry.step) ?? [],
    },
    authorizationPosture: binding.workspaceAuthorizationPosture
      ? {
          postureId: binding.workspaceAuthorizationPosture.postureId,
          status: binding.workspaceAuthorizationPosture.status,
          nextAction: binding.workspaceAuthorizationPosture.nextAction,
          blockedReasons: binding.workspaceAuthorizationPosture.blockedReasons,
          missingPermissions: binding.workspaceAuthorizationPosture.permissions?.missing ?? [],
          auditReady: binding.workspaceAuthorizationPosture.gates?.auditReady ?? null,
        }
      : null,
    verifier: {
      reportId: binding.verifierExecution?.reportId ?? null,
      status: binding.verifierExecution?.status ?? null,
      requiredFailed: binding.verifierExecution?.summary?.requiredFailed ?? null,
      issueCodes: binding.verifierExecution?.summary?.issueCodes ?? [],
    },
    claims: {
      claimPacketId: binding.claimPacket?.claimPacketId ?? null,
      status: binding.claimPacket?.status ?? null,
      totalClaims: binding.claimPacket?.claimSummary?.total ?? null,
      blockedClaims: binding.claimPacket?.claimSummary?.blockedClaims ?? [],
    },
    continuation: {
      packetId: binding.continuationPacket?.packetId ?? null,
      status: binding.continuationPacket?.status ?? binding.status,
      nextClientStep: binding.continuationPacket?.nextClientStep ?? null,
      approvalId: binding.continuationPacket?.approvalHandoff?.approvalId ?? binding.providerJob?.previewApproval?.approvalId ?? null,
      approvalStatus: binding.continuationPacket?.approvalHandoff?.status ?? binding.providerJob?.previewApproval?.status ?? null,
      approvalNextAction: binding.continuationPacket?.approvalHandoff?.nextAction ?? binding.providerJob?.previewApproval?.handoff?.nextAction ?? null,
      approvalReportId: binding.continuationPacket?.approvalHandoff?.reportId ?? binding.providerJob?.previewApproval?.handoff?.reportId ?? null,
      approvalCheckpointKey: binding.continuationPacket?.clientWorkflow?.clientResumeCheckpoint?.checkpointKey
        ?? binding.providerJob?.previewApproval?.clientResumeCheckpoint?.checkpointKey
        ?? null,
      approvalCheckpointStatus: binding.continuationPacket?.clientWorkflow?.clientResumeCheckpoint?.status
        ?? binding.providerJob?.previewApproval?.clientResumeCheckpoint?.status
        ?? null,
      approvalResumeCommandId: binding.continuationPacket?.clientWorkflow?.clientResumeCheckpoint?.resumeCommandId
        ?? binding.providerJob?.previewApproval?.clientResumeCheckpoint?.commands?.resume?.id
        ?? null,
      approvalReplayManifestId: binding.continuationPacket?.clientWorkflow?.clientResumeCheckpoint?.replayManifestId
        ?? binding.providerJob?.previewApproval?.clientResumeCheckpoint?.replayManifest?.manifestId
        ?? null,
      approvalReplayStatus: binding.continuationPacket?.clientWorkflow?.clientResumeCheckpoint?.replayStatus
        ?? binding.providerJob?.previewApproval?.clientResumeCheckpoint?.replayManifest?.status
        ?? null,
      approvalNextClientAction: binding.continuationPacket?.clientWorkflow?.clientResumeCheckpoint?.nextClientAction
        ?? binding.providerJob?.previewApproval?.clientResumeCheckpoint?.clientStatus?.nextClientAction
        ?? null,
      providerRuntimeStateKey: binding.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.stateKey
        ?? binding.providerJob?.runtimePersistence?.stateKey
        ?? null,
      providerRuntimeStatus: binding.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.status
        ?? binding.providerJob?.runtimePersistence?.status
        ?? null,
      providerRuntimeChecksum: binding.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.checksum
        ?? binding.providerJob?.runtimePersistence?.checksum
        ?? null,
      providerRuntimePersistCommandId: binding.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.persistCommandId
        ?? binding.providerJob?.runtimePersistence?.persistCommand?.id
        ?? null,
      providerRuntimeResumeCommandId: binding.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.resumeCommandId
        ?? binding.providerJob?.runtimePersistence?.resumeCommand?.id
        ?? null,
      providerRuntimeStatePath: binding.continuationPacket?.clientWorkflow?.providerRuntimePersistence?.artifactPath
        ?? binding.artifactPlan.find((artifact) => artifact.logicalName === "provider-runtime-state")?.path
        ?? null,
      runtimeBoundaryAuthorizationStatus: binding.continuationPacket?.clientWorkflow?.runtimeBoundaryAuthorization?.status
        ?? binding.providerJob?.runtimeBoundary?.authorization?.status
        ?? null,
      runtimeBoundaryAuthorizationDigest: binding.continuationPacket?.clientWorkflow?.runtimeBoundaryAuthorization?.decisionDigest
        ?? binding.providerJob?.runtimeBoundary?.authorization?.decisionDigest
        ?? null,
      runtimeBoundaryIsolationKey: binding.continuationPacket?.clientWorkflow?.runtimeBoundaryAuthorization?.isolationKey
        ?? binding.providerJob?.runtimeBoundary?.authorization?.isolationKey
        ?? null,
      runtimeBoundaryAuthorizationPath: binding.continuationPacket?.clientWorkflow?.runtimeBoundaryAuthorization?.artifactPath
        ?? binding.artifactPlan.find((artifact) => artifact.logicalName === "runtime-boundary-authorization")?.path
        ?? null,
      requestedCommand: binding.continuationPacket?.clientWorkflow?.requestedCommand ?? null,
      transitionStatus: binding.continuationPacket?.clientWorkflow?.transitionStatus ?? null,
      retryMode: binding.continuationPacket?.retryBackoff?.mode ?? null,
      degraded: binding.continuationPacket?.degradedMode?.active ?? false,
    },
    issueCodes: binding.issues.map((issue) => issue.code),
  };
}

export function exportWorkspaceBoundaryTimeline(bindingInput = {}) {
  const binding = bindingInput.kind === "aios.workspace.boundary_binding"
    ? bindingInput
    : bindMailchimpWorkspaceBoundary(bindingInput);

  return {
    kind: "aios.workspace.timeline_report",
    boundaryId: binding.boundaryId,
    exportId: binding.analyticsExport?.exportId ?? null,
    status: binding.status,
    timeline: binding.analyticsExport?.timeline ?? [],
    latestSnapshot: binding.analyticsExport?.history?.at(-1) ?? null,
    verifierReportId: binding.verifierExecution?.reportId ?? null,
    claimPacketId: binding.claimPacket?.claimPacketId ?? null,
    counters: binding.analyticsExport?.counters ?? {
      artifactsPlanned: binding.artifactPlan.length,
      issueTotal: binding.issues.length,
    },
    authorizationPosture: binding.workspaceAuthorizationPosture ?? null,
  };
}
