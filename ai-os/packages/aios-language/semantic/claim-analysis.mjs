import { compileClaimGate } from "../compiler/claim-gate-compiler.mjs";

export const MAILCHIMP_CLAIM_ANALYSIS_VERSION = "aios.semantic.claim-analysis.v1";

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function severityOf(issue) {
  return issue?.severity || issue?.level || "info";
}

function summarizeIssues(issues) {
  const normalized = asArray(issues);
  const errors = normalized.filter((issue) => severityOf(issue) === "error");
  const warnings = normalized.filter((issue) => severityOf(issue) === "warning");
  return {
    total: normalized.length,
    errors: errors.length,
    warnings: warnings.length,
    blockingCodes: errors.map((issue) => issue.code).filter(Boolean).sort(),
    warningCodes: warnings.map((issue) => issue.code).filter(Boolean).sort(),
  };
}

function summarizeRules(rules) {
  return asArray(rules).map((rule) => ({
    id: rule.id,
    subject: rule.subject,
    operator: rule.operator,
    status: rule.status,
    requiredFacts: rule.values || [],
    missingFacts: rule.missing || [],
    admitted: rule.status !== "blocked",
    nextAction: rule.status === "blocked" ? "collect-claim-evidence" : "no-action",
  }));
}

function stableId(prefix, parts) {
  const input = JSON.stringify(parts);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildDefaultGate(source = {}) {
  return {
    name: source.name || "mailchimp-semantic-claim-gate",
    evidence: asArray(source.evidence || ["audience_id", "campaign_id", "segment_id", "template_id"]),
    rules: asArray(source.rules || [
      { subject: "mailchimp.audience", operator: "requires", values: ["audience_id"] },
      { subject: "mailchimp.campaign", operator: "requires", values: ["campaign_id", "template_id"] },
      { subject: "mailchimp.segment", operator: "observes", values: ["segment_id"] },
    ]),
    clientRuntime: {
      requestId: source.requestId || "mailchimp-semantic-request",
      workflowId: source.workflowId || "mailchimp-campaign-workflow",
      tenantId: source.tenantId || "mailchimp-tenant",
      workspaceId: source.workspaceId || "mailchimp-workspace",
      actorRole: source.actorRole || "operator",
      handoffMode: source.handoffMode || "approval",
    },
    tenantPolicy: {
      tenantId: source.tenantId || "mailchimp-tenant",
      workspaces: [{
        workspaceId: source.workspaceId || "mailchimp-workspace",
        allowedRoles: ["operator", "approver", "admin"],
        requiresApprovalForExternalWrite: true,
      }],
      rolePolicies: [
        { role: "operator", canApprove: false, canExecute: true },
        { role: "approver", canApprove: true, canExecute: true },
        { role: "admin", canApprove: true, canExecute: true },
      ],
    },
  };
}

function normalizeSource(source) {
  if (typeof source === "string") return source;
  if (source?.rules || source?.evidence || source?.clientRuntime || source?.tenantPolicy) return source;
  return buildDefaultGate(source);
}

function buildPreviewState(descriptor, rules, missingFacts, issueSummary) {
  const clientRuntime = descriptor.clientRuntime || {};
  const acceptedRules = rules.filter((rule) => rule.admitted);
  const blockedRules = rules.filter((rule) => !rule.admitted);
  return {
    previewId: stableId("mailchimp-claim-preview", [
      descriptor.id,
      clientRuntime.workflowId,
      rules.map((rule) => [rule.id, rule.status]),
      missingFacts,
    ]),
    title: descriptor.name || "Mailchimp claim gate",
    status: missingFacts.length || issueSummary.errors ? "needs-review" : "ready",
    facts: {
      required: descriptor.verifierContract?.requiredFacts || [],
      observed: descriptor.verifierContract?.evidenceFacts || [],
      missing: missingFacts,
    },
    ruleCards: rules.map((rule) => ({
      id: rule.id,
      subject: rule.subject,
      status: rule.status,
      admitted: rule.admitted,
      requiredFacts: rule.requiredFacts,
      missingFacts: rule.missingFacts,
      displayState: rule.admitted ? "accepted" : "requires-evidence",
      nextAction: rule.nextAction,
    })),
    counters: {
      rules: rules.length,
      acceptedRules: acceptedRules.length,
      blockedRules: blockedRules.length,
      missingFacts: missingFacts.length,
      issues: issueSummary.total,
    },
  };
}

function buildClaimTenantBoundaryState(descriptor, acceptanceInput = {}) {
  const clientRuntime = descriptor.clientRuntime || {};
  const tenantPolicy = descriptor.tenantPolicy || {};
  const activeBoundary = tenantPolicy.activeBoundary || {};
  const actorRole = acceptanceInput.actorRole
    || clientRuntime.actorRole
    || activeBoundary.actorRole
    || "operator";
  const tenantId = activeBoundary.tenantId
    || tenantPolicy.tenantId
    || clientRuntime.tenantId
    || null;
  const workspaceId = activeBoundary.workspaceId
    || clientRuntime.workspaceId
    || null;
  const allowedRoles = [
    ...asArray(activeBoundary.allowedRoles),
    ...asArray(tenantPolicy.allowedRoles),
    "operator",
    "approver",
    "admin",
  ];
  const uniqueAllowedRoles = [...new Set(allowedRoles)].sort();
  const rolePolicies = asArray(tenantPolicy.rolePolicies);
  const rolePolicy = rolePolicies.find((policy) => policy?.role === actorRole) || {};
  const canExecute = rolePolicy.canExecute !== false && uniqueAllowedRoles.includes(actorRole);
  const canApprove = rolePolicy.canApprove === true
    || actorRole === "approver"
    || actorRole === "admin";
  const externalWriteRequested = clientRuntime.handoffMode === "approval"
    || activeBoundary.requiresApprovalForExternalWrite === true
    || tenantPolicy.requiresApprovalForExternalWrite === true;
  const requiresApproval = activeBoundary.requiresApprovalForExternalWrite !== false
    && (tenantPolicy.requiresApprovalForExternalWrite !== false || externalWriteRequested);
  const tenantBlockedBy = [
    ...(tenantId ? [] : ["tenant:missing"]),
    ...(workspaceId ? [] : ["workspace:missing"]),
    ...(uniqueAllowedRoles.includes(actorRole) ? [] : [`role:${actorRole}:not-allowed`]),
    ...(!canExecute ? [`role:${actorRole}:cannot-execute-claim`] : []),
    ...(requiresApproval && acceptanceInput.accepted === true && !canApprove
      ? [`role:${actorRole}:cannot-approve-claim`]
      : []),
  ].sort();
  const auditEvents = [
    {
      event: "claim.preview.scoped",
      subject: descriptor.id || "mailchimp-claim-gate",
      status: tenantBlockedBy.length ? "blocked" : "scoped",
    },
    {
      event: "claim.acceptance.requested",
      subject: acceptanceInput.acceptedBy || actorRole,
      status: requiresApproval ? "approval-required" : "not-required",
    },
    {
      event: "claim.runtime-handoff.boundary",
      subject: clientRuntime.workflowId || "mailchimp-campaign-workflow",
      status: tenantBlockedBy.length ? "held" : "ready",
    },
  ];
  const auditId = stableId("mailchimp-claim-tenant-audit", [
    tenantId,
    workspaceId,
    actorRole,
    descriptor.id,
    tenantBlockedBy,
  ]);

  return {
    auditId,
    tenantId,
    workspaceId,
    actorRole,
    allowedRoles: uniqueAllowedRoles,
    canExecute,
    canApprove,
    requiresApproval,
    status: tenantBlockedBy.length ? "blocked" : "ready",
    tenantBlockedBy,
    auditEvents,
    commandPolicy: [
      {
        command: "render-claim-preview",
        enabled: tenantBlockedBy.length === 0,
        reason: tenantBlockedBy.length ? "tenant boundary must be repaired" : "claim preview is tenant-scoped",
      },
      {
        command: "accept-claim-preview",
        enabled: tenantBlockedBy.length === 0 && (!requiresApproval || canApprove),
        reason: requiresApproval && !canApprove
          ? "actor role cannot approve claim runtime handoff"
          : "acceptance is allowed by tenant policy",
      },
      {
        command: "handoff-claim-runtime",
        enabled: tenantBlockedBy.length === 0 && canExecute,
        reason: canExecute ? "actor can execute claim handoff" : "actor role cannot execute claim workflow",
      },
    ],
    persistedState: {
      auditId,
      tenantId,
      workspaceId,
      actorRole,
      status: tenantBlockedBy.length ? "blocked" : "ready",
      nextAction: tenantBlockedBy.length ? "repair-claim-tenant-boundary" : "persist-claim-tenant-audit",
    },
    nextAction: tenantBlockedBy.length ? "repair-claim-tenant-boundary" : "persist-claim-tenant-audit",
  };
}

function buildAcceptanceState(
  compiled,
  descriptor,
  admitted,
  reviewable,
  missingFacts,
  acceptanceInput = {},
  tenantBoundaryState = null,
) {
  const clientRuntime = descriptor.clientRuntime || {};
  const tenantBoundary = descriptor.tenantPolicy?.activeBoundary || null;
  const acceptance = compiled.acceptance || descriptor.acceptance || acceptanceInput || {};
  const acceptanceRequired = clientRuntime.handoffMode === "approval"
    || tenantBoundary?.requiresApprovalForExternalWrite === true;
  const tenantBlockedBy = asArray(tenantBoundaryState?.tenantBlockedBy);
  const accepted = admitted
    && tenantBlockedBy.length === 0
    && (!acceptanceRequired || acceptance.accepted === true);
  const canAccept = (admitted || reviewable)
    && tenantBlockedBy.length === 0
    && (!tenantBoundaryState?.requiresApproval || tenantBoundaryState.canApprove);
  return {
    acceptanceId: stableId("mailchimp-claim-acceptance", [
      descriptor.id,
      clientRuntime.requestId,
      missingFacts,
      acceptanceRequired,
    ]),
    required: acceptanceRequired,
    accepted,
    canAccept,
    acceptedBy: acceptance.acceptedBy || null,
    acceptedAt: acceptance.acceptedAt || null,
    blockedBy: [
      ...missingFacts.map((fact) => `missing-fact:${fact}`),
      ...tenantBlockedBy,
      ...asArray(compiled.issues)
        .filter((issue) => severityOf(issue) === "error")
        .map((issue) => `issue:${issue.code || issue.message || "unknown"}`),
    ].sort(),
    nextAction: accepted
      ? "handoff-to-runtime-adapter"
      : tenantBlockedBy.length
        ? "repair-claim-tenant-boundary"
      : missingFacts.length
        ? "collect-missing-claim-evidence"
        : acceptanceRequired
          ? "collect-claim-acceptance"
          : "handoff-to-runtime-adapter",
  };
}

function buildReadinessSummary(admitted, reviewable, issueSummary, missingFacts, acceptanceState) {
  const blockingReasons = [
    ...issueSummary.blockingCodes,
    ...missingFacts.map((fact) => `missing:${fact}`),
    ...asArray(acceptanceState.blockedBy)
      .filter((blocker) => !blocker.startsWith("missing-fact:")),
    ...(acceptanceState.required && !acceptanceState.accepted && missingFacts.length === 0
      ? ["acceptance:required"]
      : []),
  ].sort();
  return {
    status: admitted && acceptanceState.accepted
      ? "ready"
      : reviewable
        ? "needs-evidence"
        : blockingReasons.length
          ? "blocked"
          : "needs-acceptance",
    readyForRuntime: admitted && acceptanceState.accepted,
    readyForReview: admitted || reviewable,
    issueSummary,
    missingFacts,
    blockingReasons,
    nextAction: blockingReasons.length
      ? acceptanceState.nextAction
      : acceptanceState.accepted
        ? "handoff-to-runtime-adapter"
        : "collect-claim-acceptance",
  };
}

function buildExplainableNextSteps(rules, acceptanceState, readinessSummary) {
  const evidenceSteps = rules
    .filter((rule) => !rule.admitted)
    .map((rule) => ({
      action: "collect-claim-evidence",
      subject: rule.subject,
      facts: rule.missingFacts,
      reason: `Rule ${rule.id} is missing required evidence`,
    }));
  const acceptanceStep = acceptanceState.required && !acceptanceState.accepted && readinessSummary.missingFacts.length === 0
    ? [{
      action: "collect-claim-acceptance",
      subject: "operator-acceptance",
      facts: [],
      reason: "External write workflows require an accepted claim preview",
    }]
    : [];
  const handoffStep = readinessSummary.readyForRuntime
    ? [{
      action: "handoff-to-runtime-adapter",
      subject: "runtime",
      facts: [],
      reason: "All required claim facts are present and acceptance is satisfied",
    }]
    : [];
  return [...evidenceSteps, ...acceptanceStep, ...handoffStep];
}

function buildClientRequestState(descriptor, previewState, acceptanceState, readinessSummary, options = {}) {
  const clientRuntime = descriptor.clientRuntime || {};
  const persistedState = clientRuntime.persistedState || {};
  const stateShape = clientRuntime.stateShape || {};
  const requiredKeys = [
    "requestId",
    "workflowId",
    "tenantId",
    "workspaceId",
    ...asArray(stateShape.requiredKeys),
  ];
  const observedKeys = Object.keys(persistedState).sort();
  const missingKeys = requiredKeys
    .filter((key) => key && persistedState[key] == null && clientRuntime[key] == null)
    .sort();
  const requestId = clientRuntime.requestId || options.requestId || "mailchimp-semantic-request";
  return {
    requestId,
    workflowId: clientRuntime.workflowId || "mailchimp-campaign-workflow",
    tenantId: clientRuntime.tenantId || descriptor.tenantPolicy?.tenantId || null,
    workspaceId: clientRuntime.workspaceId || descriptor.tenantPolicy?.activeBoundary?.workspaceId || null,
    actorRole: clientRuntime.actorRole || "operator",
    clientStateKey: clientRuntime.clientStateKey || stableId("mailchimp-claim-client-state", [
      requestId,
      previewState.previewId,
      acceptanceState.acceptanceId,
    ]),
    continuationToken: clientRuntime.continuationToken || stableId("mailchimp-claim-continuation", [
      requestId,
      readinessSummary.status,
      readinessSummary.blockingReasons,
    ]),
    requiredKeys: [...new Set(requiredKeys)].sort(),
    observedKeys,
    missingKeys,
    hydrated: missingKeys.length === 0,
    persistedState: {
      ...persistedState,
      requestId,
      workflowId: clientRuntime.workflowId || persistedState.workflowId || "mailchimp-campaign-workflow",
      previewId: previewState.previewId,
      acceptanceId: acceptanceState.acceptanceId,
      readinessStatus: readinessSummary.status,
    },
    nextAction: missingKeys.length
      ? "hydrate-client-runtime-state"
      : readinessSummary.nextAction,
  };
}

function buildRuntimeWorkflowHandoff(descriptor, clientRequestState, previewState, acceptanceState, readinessSummary, nextSteps) {
  const workflowHandoff = descriptor.workflowHandoff || {};
  const tenantBoundary = descriptor.tenantPolicy?.activeBoundary || null;
  const acceptedForRuntime = readinessSummary.readyForRuntime && clientRequestState.hydrated;
  const commands = [
    {
      command: "render-claim-preview",
      enabled: true,
      previewId: previewState.previewId,
    },
    {
      command: "persist-claim-client-state",
      enabled: !clientRequestState.hydrated || readinessSummary.readyForReview,
      clientStateKey: clientRequestState.clientStateKey,
    },
    {
      command: "accept-claim-preview",
      enabled: acceptanceState.canAccept && !acceptanceState.accepted,
      acceptanceId: acceptanceState.acceptanceId,
    },
    {
      command: "handoff-claim-runtime",
      enabled: acceptedForRuntime,
      continuationToken: clientRequestState.continuationToken,
    },
  ];
  return {
    handoffId: stableId("mailchimp-claim-runtime-handoff", [
      clientRequestState.requestId,
      previewState.previewId,
      acceptanceState.acceptanceId,
      readinessSummary.status,
    ]),
    acceptedForRuntime,
    acceptedForReview: readinessSummary.readyForReview,
    routeName: workflowHandoff.routeName || "mailchimp.claims.runtime",
    clientStateKey: clientRequestState.clientStateKey,
    continuationToken: clientRequestState.continuationToken,
    tenantBoundary,
    commands,
    nextStepQueue: nextSteps.map((step, index) => ({
      index,
      action: step.action,
      subject: step.subject,
      facts: step.facts,
      blocked: step.action !== "handoff-to-runtime-adapter" && !acceptedForRuntime,
    })),
    nextAction: !clientRequestState.hydrated
      ? clientRequestState.nextAction
      : acceptedForRuntime
        ? "handoff-claim-runtime"
        : readinessSummary.nextAction,
  };
}

function normalizeSourceRecoveryHandoff(descriptor, clientRequestState) {
  const recovery = descriptor.recovery || {};
  const source = recovery.sourceRecoveryStatus
    || recovery.recoveryStatus
    || recovery.upstreamRecovery
    || descriptor.sourceRecoveryStatus
    || {};
  const handoff = source.clientHandoff || source.userVisibleWorkflow || source.handoff || {};
  const acceptance = handoff.acceptance || source.acceptance || {};
  const preview = handoff.preview || source.preview || {};
  const clientState = handoff.clientState || {};
  const blockedBy = [
    ...asArray(handoff.blockedBy),
    ...asArray(acceptance.blockedBy),
    ...asArray(source.blockedBy),
    ...asArray(clientState.missingKeys).map((key) => `source-recovery-client-state:${key}`),
  ].sort();
  const commands = [
    ...asArray(handoff.commands),
    ...asArray(source.commands),
    ...asArray(source.persistence?.commands),
  ];
  const enabledCommands = commands
    .filter((command) => command?.enabled !== false)
    .map((command) => ({
      command: command.command || command.type || command.action || "source-recovery-command",
      enabled: command.enabled !== false,
      idempotencyKey: command.idempotencyKey || command.id || null,
      restartSafe: command.restartSafe !== false,
      statusChannel: command.statusChannel || source.statusChannel || source.handoff?.statusChannel || null,
    }));
  const acceptedForRuntime = acceptance.acceptedForRuntime === true
    || handoff.acceptedForRuntime === true
    || source.handoff?.acceptedForRuntime === true;
  const sourceStatus = source.state
    || source.status
    || preview.status
    || (Object.keys(source).length ? "provided" : "not-provided");
  const resumeToken = source.resume?.resumeToken
    || source.resume?.fromCheckpoint
    || source.handoff?.resumeToken
    || source.persistence?.ledger?.resumeToken
    || recovery.resumeFrom
    || clientRequestState.continuationToken;

  return {
    present: Object.keys(source).length > 0,
    sourceRecoveryId: handoff.handoffId
      || source.handoff?.persistenceRevision
      || source.persistence?.revision
      || stableId("mailchimp-claim-source-recovery", [
        clientRequestState.requestId,
        sourceStatus,
        resumeToken,
      ]),
    status: sourceStatus,
    previewId: preview.previewId || null,
    routeName: handoff.routeName || source.handoff?.routeName || null,
    clientStateKey: handoff.clientStateKey || clientState.stateKey || source.handoff?.clientStateKey || null,
    resumeToken,
    acceptedForRuntime,
    restartSafe: source.restartSafe !== false
      && source.persistence?.ledger?.restartSafe !== false
      && blockedBy.length === 0,
    blockedBy,
    commands: enabledCommands,
    nextAction: blockedBy.length
      ? blockedBy[0].startsWith("source-recovery-client-state:")
        ? "hydrate-recovery-client-state"
        : source.nextAction || "resume-source-recovery"
      : acceptedForRuntime
        ? "adopt-source-recovery-handoff"
        : source.nextAction || handoff.nextAction || "continue-claim-recovery",
  };
}

function buildPersistedRecoveryContract(
  descriptor,
  clientRequestState,
  runtimeWorkflowHandoff,
  readinessSummary,
  nextSteps,
  sourceRecoveryHandoff,
) {
  const recovery = descriptor.recovery || {};
  const clientRuntime = descriptor.clientRuntime || {};
  const persistedState = clientRequestState.persistedState || {};
  const acceptedForRuntime = runtimeWorkflowHandoff.acceptedForRuntime;
  const recoveryPaths = [
    {
      path: "client-state",
      stateKey: clientRequestState.clientStateKey,
      status: clientRequestState.hydrated ? "hydrated" : "needs-hydration",
      nextAction: clientRequestState.hydrated ? "resume-claim-workflow" : "hydrate-client-runtime-state",
    },
    {
      path: "preview",
      stateKey: previewStateKey(descriptor, clientRequestState),
      status: persistedState.previewId ? "persisted" : "needs-persist",
      nextAction: persistedState.previewId ? "render-claim-preview" : "persist-claim-client-state",
    },
    {
      path: "acceptance",
      stateKey: persistedState.acceptanceId || runtimeWorkflowHandoff.commands
        .find((command) => command.command === "accept-claim-preview")?.acceptanceId || null,
      status: readinessSummary.readyForRuntime ? "accepted" : "pending",
      nextAction: readinessSummary.readyForRuntime ? "resume-runtime-handoff" : readinessSummary.nextAction,
    },
    ...(sourceRecoveryHandoff.present ? [{
      path: "source-recovery",
      stateKey: sourceRecoveryHandoff.clientStateKey || sourceRecoveryHandoff.sourceRecoveryId,
      status: sourceRecoveryHandoff.restartSafe ? "adopted" : "needs-recovery",
      nextAction: sourceRecoveryHandoff.nextAction,
    }] : []),
  ];
  const idempotentCommands = [
    {
      command: "persist-claim-client-state",
      idempotencyKey: `claim-state:${stableId("claim-state", [
        clientRequestState.clientStateKey,
        persistedState.previewId,
        persistedState.acceptanceId,
      ])}`,
      enabled: true,
    },
    {
      command: "render-claim-preview",
      idempotencyKey: `claim-preview:${persistedState.previewId || clientRequestState.continuationToken}`,
      enabled: true,
    },
    {
      command: "handoff-claim-runtime",
      idempotencyKey: `claim-runtime:${runtimeWorkflowHandoff.handoffId}`,
      enabled: acceptedForRuntime,
    },
    ...(sourceRecoveryHandoff.present ? [{
      command: "adopt-source-recovery-handoff",
      idempotencyKey: `claim-source-recovery:${sourceRecoveryHandoff.sourceRecoveryId}`,
      enabled: sourceRecoveryHandoff.restartSafe,
      resumeToken: sourceRecoveryHandoff.resumeToken,
    }] : []),
  ];
  const restartBlockedBy = [
    ...clientRequestState.missingKeys.map((key) => `client-state:${key}`),
    ...readinessSummary.blockingReasons,
    ...sourceRecoveryHandoff.blockedBy.map((blocker) => `source-recovery:${blocker}`),
    ...(sourceRecoveryHandoff.present && !sourceRecoveryHandoff.restartSafe
      ? ["source-recovery:not-restart-safe"]
      : []),
  ].sort();

  return {
    recoveryId: stableId("mailchimp-claim-persisted-recovery", [
      clientRequestState.requestId,
      clientRequestState.clientStateKey,
      runtimeWorkflowHandoff.handoffId,
      readinessSummary.status,
    ]),
    restartSafe: clientRequestState.hydrated && persistedState.previewId != null && restartBlockedBy.length === 0,
    resumeFrom: recovery.resumeFrom || clientRequestState.continuationToken,
    clientStateKey: recovery.clientStateKey || clientRequestState.clientStateKey,
    persistedState: {
      ...persistedState,
      restartSafe: clientRequestState.hydrated && persistedState.previewId != null && restartBlockedBy.length === 0,
      recoveryStatus: restartBlockedBy.length ? "blocked" : acceptedForRuntime ? "ready" : readinessSummary.status,
      recoveryId: stableId("mailchimp-claim-recovery-state", [
        clientRequestState.requestId,
        readinessSummary.status,
        restartBlockedBy,
      ]),
      routeName: runtimeWorkflowHandoff.routeName,
      actorRole: clientRuntime.actorRole || "operator",
      sourceRecoveryId: sourceRecoveryHandoff.present ? sourceRecoveryHandoff.sourceRecoveryId : null,
      sourceRecoveryStatus: sourceRecoveryHandoff.status,
      sourceRecoveryResumeToken: sourceRecoveryHandoff.resumeToken,
    },
    recoveryPaths: [
      ...recoveryPaths,
      ...asArray(recovery.recoveryPaths),
    ],
    idempotentCommands: [
      ...idempotentCommands,
      ...asArray(recovery.idempotentCommands),
    ],
    restartBlockedBy,
    sourceRecoveryHandoff,
    nextStepQueue: nextSteps.map((step, index) => ({
      index,
      action: step.action,
      subject: step.subject,
      restartSafe: step.action !== "handoff-to-runtime-adapter" || acceptedForRuntime,
    })).concat(sourceRecoveryHandoff.present ? [{
      index: nextSteps.length,
      action: sourceRecoveryHandoff.nextAction,
      subject: sourceRecoveryHandoff.sourceRecoveryId,
      restartSafe: sourceRecoveryHandoff.restartSafe,
    }] : []),
    status: restartBlockedBy.length
      ? "blocked"
      : acceptedForRuntime
        ? "ready"
        : "waiting",
    nextAction: restartBlockedBy.length
      ? restartBlockedBy[0].startsWith("client-state:")
        ? "hydrate-client-runtime-state"
        : readinessSummary.nextAction
      : acceptedForRuntime
        ? "resume-runtime-handoff"
        : runtimeWorkflowHandoff.nextAction,
  };
}

function previewStateKey(descriptor, clientRequestState) {
  return descriptor.previewStateKey || stableId("mailchimp-claim-preview-state", [
    clientRequestState.requestId,
    clientRequestState.clientStateKey,
  ]);
}

function buildClaimRouteExportState(
  descriptor,
  previewState,
  acceptanceState,
  readinessSummary,
  clientRequestState,
  runtimeWorkflowHandoff,
  persistedRecoveryContract,
  tenantBoundaryState,
  nextSteps,
) {
  const blockingReasons = asArray(readinessSummary.blockingReasons);
  const missingKeys = asArray(clientRequestState.missingKeys);
  const tenantBlockedBy = asArray(tenantBoundaryState.tenantBlockedBy);
  const recoveryBlockedBy = asArray(persistedRecoveryContract.restartBlockedBy);
  const failedChecks = [
    ...(blockingReasons.length ? ["claim-readiness-clear"] : []),
    ...(missingKeys.length ? ["client-state-hydrated"] : []),
    ...(tenantBlockedBy.length ? ["tenant-boundary-ready"] : []),
    ...(recoveryBlockedBy.length ? ["restart-recovery-clear"] : []),
  ];
  const pendingChecks = [
    ...(acceptanceState.required && !acceptanceState.accepted ? ["claim-acceptance-collected"] : []),
    ...(!persistedRecoveryContract.restartSafe ? ["claim-recovery-restart-safe"] : []),
  ].filter((check, index, checks) => checks.indexOf(check) === index);
  const routeStatus = failedChecks.length
    ? "blocked"
    : pendingChecks.length
      ? "pending"
      : runtimeWorkflowHandoff.acceptedForRuntime
        ? "ready"
        : "waiting";
  const timeline = [
    {
      phase: "preview",
      status: previewState.status,
      subject: previewState.previewId,
      counters: previewState.counters,
      nextAction: previewState.status === "ready" ? "review-claim-preview" : "collect-claim-evidence",
    },
    {
      phase: "acceptance",
      status: acceptanceState.accepted ? "accepted" : acceptanceState.required ? "required" : "not-required",
      subject: acceptanceState.acceptanceId,
      counters: {
        blockers: acceptanceState.blockedBy.length,
        required: acceptanceState.required ? 1 : 0,
        accepted: acceptanceState.accepted ? 1 : 0,
      },
      nextAction: acceptanceState.nextAction,
    },
    {
      phase: "client-state",
      status: clientRequestState.hydrated ? "hydrated" : "needs-hydration",
      subject: clientRequestState.clientStateKey,
      counters: {
        requiredKeys: clientRequestState.requiredKeys.length,
        missingKeys: missingKeys.length,
      },
      nextAction: clientRequestState.nextAction,
    },
    {
      phase: "tenant-boundary",
      status: tenantBoundaryState.status,
      subject: tenantBoundaryState.auditId,
      counters: {
        blockers: tenantBlockedBy.length,
        commands: tenantBoundaryState.commandPolicy.length,
      },
      nextAction: tenantBoundaryState.nextAction,
    },
    {
      phase: "runtime-handoff",
      status: runtimeWorkflowHandoff.acceptedForRuntime ? "ready" : readinessSummary.status,
      subject: runtimeWorkflowHandoff.handoffId,
      counters: {
        queuedSteps: runtimeWorkflowHandoff.nextStepQueue.length,
        enabledCommands: runtimeWorkflowHandoff.commands.filter((command) => command.enabled).length,
      },
      nextAction: runtimeWorkflowHandoff.nextAction,
    },
    {
      phase: "recovery",
      status: persistedRecoveryContract.status,
      subject: persistedRecoveryContract.recoveryId,
      counters: {
        recoveryPaths: persistedRecoveryContract.recoveryPaths.length,
        restartBlockers: recoveryBlockedBy.length,
        idempotentCommands: persistedRecoveryContract.idempotentCommands.length,
      },
      nextAction: persistedRecoveryContract.nextAction,
    },
  ].map((event, index) => ({
    eventId: stableId("mailchimp-claim-route-event", [
      descriptor.id,
      event.phase,
      event.status,
      event.subject,
      index,
    ]),
    index,
    ...event,
  }));
  const nextAction = failedChecks.length
    ? missingKeys.length
      ? "hydrate-client-runtime-state"
      : tenantBlockedBy.length
        ? tenantBoundaryState.nextAction
        : readinessSummary.nextAction
    : pendingChecks.length
      ? pendingChecks.includes("claim-acceptance-collected")
        ? "collect-claim-acceptance"
        : persistedRecoveryContract.nextAction
      : runtimeWorkflowHandoff.acceptedForRuntime
        ? "handoff-claim-runtime"
        : readinessSummary.nextAction;
  const exportRows = previewState.ruleCards.map((rule) => ({
    ruleId: rule.id,
    subject: rule.subject,
    displayState: rule.displayState,
    admitted: rule.admitted,
    missingFacts: rule.missingFacts,
    nextAction: rule.nextAction,
  }));

  return {
    routeExportId: stableId("mailchimp-claim-route-export", [
      clientRequestState.requestId,
      previewState.previewId,
      acceptanceState.acceptanceId,
      routeStatus,
    ]),
    status: routeStatus,
    generatedDeterministically: true,
    acceptanceReceipt: {
      receiptId: stableId("mailchimp-claim-acceptance-receipt", [
        acceptanceState.acceptanceId,
        acceptanceState.acceptedBy,
        acceptanceState.acceptedAt,
        acceptanceState.accepted,
      ]),
      accepted: acceptanceState.accepted,
      required: acceptanceState.required,
      acceptedBy: acceptanceState.acceptedBy,
      acceptedAt: acceptanceState.acceptedAt,
      tenantAuditId: tenantBoundaryState.auditId,
      previewId: previewState.previewId,
      blockedBy: acceptanceState.blockedBy,
      nextAction: acceptanceState.nextAction,
    },
    exportSummary: {
      exportKind: "mailchimp.claimRoute.acceptanceSummary",
      status: routeStatus,
      requestId: clientRequestState.requestId,
      workflowId: clientRequestState.workflowId,
      previewId: previewState.previewId,
      acceptanceId: acceptanceState.acceptanceId,
      handoffId: runtimeWorkflowHandoff.handoffId,
      recoveryId: persistedRecoveryContract.recoveryId,
      rows: exportRows,
      totals: {
        rules: previewState.counters.rules,
        acceptedRules: previewState.counters.acceptedRules,
        blockedRules: previewState.counters.blockedRules,
        missingFacts: readinessSummary.missingFacts.length,
        missingClientKeys: missingKeys.length,
        tenantBlockers: tenantBlockedBy.length,
        restartBlockers: recoveryBlockedBy.length,
        nextSteps: nextSteps.length,
      },
      blockedBy: [
        ...blockingReasons,
        ...missingKeys.map((key) => `client-state:${key}`),
        ...tenantBlockedBy,
        ...recoveryBlockedBy.map((blocker) => `recovery:${blocker}`),
      ].sort(),
      pendingBy: pendingChecks,
      nextAction,
    },
    historySnapshots: timeline,
    timelineState: {
      currentPhase: timeline.find((event) => event.status === "blocked")?.phase
        || timeline.find((event) => event.status === "needs-hydration")?.phase
        || timeline.find((event) => event.status === "required")?.phase
        || timeline.find((event) => event.status === "waiting")?.phase
        || timeline.at(-1)?.phase
        || "preview",
      phases: timeline.map((event) => ({
        index: event.index,
        phase: event.phase,
        status: event.status,
        nextAction: event.nextAction,
      })),
      reportChannels: ["claim.status.mailchimp", "claim.route.mailchimp"],
    },
    routeCommands: [
      {
        command: "publish-claim-route-export",
        enabled: routeStatus !== "blocked",
        exportId: stableId("mailchimp-claim-route-export-command", [
          clientRequestState.requestId,
          routeStatus,
          runtimeWorkflowHandoff.handoffId,
        ]),
      },
      {
        command: "persist-claim-acceptance-receipt",
        enabled: acceptanceState.accepted || acceptanceState.required,
        receiptId: stableId("mailchimp-claim-acceptance-receipt-command", [
          acceptanceState.acceptanceId,
          acceptanceState.accepted,
        ]),
      },
    ],
    nextAction,
  };
}

function buildClaimDownstreamStatusPacket(
  descriptor,
  previewState,
  acceptanceState,
  readinessSummary,
  clientRequestState,
  runtimeWorkflowHandoff,
  persistedRecoveryContract,
  routeExportState,
  tenantBoundaryState,
) {
  const missingClientState = asArray(clientRequestState.missingKeys).map((key) => `client-state:${key}`);
  const tenantBlockers = asArray(tenantBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`);
  const recoveryBlockers = asArray(persistedRecoveryContract.restartBlockedBy).map((blocker) => `recovery:${blocker}`);
  const routeBlockers = asArray(routeExportState.exportSummary?.blockedBy).map((blocker) => `route:${blocker}`);
  const blockedBy = [
    ...asArray(readinessSummary.blockingReasons).map((reason) => `readiness:${reason}`),
    ...asArray(acceptanceState.blockedBy).map((blocker) => `acceptance:${blocker}`),
    ...missingClientState,
    ...tenantBlockers,
    ...recoveryBlockers,
    ...routeBlockers,
  ].sort();
  const pendingBy = [
    ...(acceptanceState.required && !acceptanceState.accepted ? ["acceptance:claim-preview"] : []),
    ...asArray(routeExportState.exportSummary?.pendingBy).map((pending) => `route:${pending}`),
    ...(!persistedRecoveryContract.restartSafe ? ["recovery:restart-safe"] : []),
  ].filter((pending, index, pendingItems) => pendingItems.indexOf(pending) === index).sort();
  const acceptedForDownstream = blockedBy.length === 0
    && pendingBy.length === 0
    && runtimeWorkflowHandoff.acceptedForRuntime === true
    && clientRequestState.hydrated === true;
  const acceptedForReview = readinessSummary.readyForReview === true
    && tenantBoundaryState.status !== "blocked";
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForDownstream
        ? "runtime-ready"
        : acceptedForReview
          ? "review-ready"
          : "waiting";
  const statusRows = [
    {
      key: "claim-preview",
      status: previewState.status,
      accepted: readinessSummary.readyForReview === true,
      restartSafe: true,
      statusPath: previewState.previewId,
      blockedBy: readinessSummary.missingFacts.map((fact) => `missing-fact:${fact}`),
      pendingBy: [],
      nextAction: readinessSummary.nextAction,
    },
    {
      key: "claim-acceptance",
      status: acceptanceState.accepted ? "accepted" : acceptanceState.required ? "required" : "not-required",
      accepted: acceptanceState.accepted === true || acceptanceState.required === false,
      restartSafe: acceptanceState.accepted === true || acceptanceState.required === false,
      statusPath: acceptanceState.acceptanceId,
      blockedBy: asArray(acceptanceState.blockedBy).map((blocker) => `acceptance:${blocker}`),
      pendingBy: acceptanceState.required && !acceptanceState.accepted ? ["acceptance:claim-preview"] : [],
      nextAction: acceptanceState.nextAction,
    },
    {
      key: "client-runtime",
      status: clientRequestState.hydrated ? "hydrated" : "needs-client-state",
      accepted: clientRequestState.hydrated === true,
      restartSafe: clientRequestState.hydrated === true,
      statusPath: clientRequestState.clientStateKey,
      blockedBy: missingClientState,
      pendingBy: [],
      nextAction: clientRequestState.nextAction,
    },
    {
      key: "tenant-boundary",
      status: tenantBoundaryState.status,
      accepted: tenantBoundaryState.status === "ready",
      restartSafe: tenantBoundaryState.status === "ready",
      statusPath: tenantBoundaryState.auditId,
      blockedBy: tenantBlockers,
      pendingBy: [],
      nextAction: tenantBoundaryState.nextAction,
    },
    {
      key: "runtime-handoff",
      status: runtimeWorkflowHandoff.acceptedForRuntime ? "ready" : readinessSummary.status,
      accepted: runtimeWorkflowHandoff.acceptedForRuntime === true,
      restartSafe: persistedRecoveryContract.restartSafe === true,
      statusPath: runtimeWorkflowHandoff.handoffId,
      blockedBy: recoveryBlockers,
      pendingBy: persistedRecoveryContract.restartSafe ? [] : ["recovery:restart-safe"],
      nextAction: runtimeWorkflowHandoff.nextAction,
    },
    {
      key: "route-export",
      status: routeExportState.status,
      accepted: routeExportState.status === "ready",
      restartSafe: routeExportState.status !== "blocked",
      statusPath: routeExportState.routeExportId,
      blockedBy: routeBlockers,
      pendingBy: asArray(routeExportState.exportSummary?.pendingBy).map((pending) => `route:${pending}`),
      nextAction: routeExportState.nextAction,
    },
  ];
  const ruleRows = previewState.ruleCards.map((rule) => ({
    ruleId: rule.id,
    subject: rule.subject,
    status: rule.status,
    admitted: rule.admitted,
    missingFacts: rule.missingFacts,
    nextAction: rule.nextAction,
  }));
  const commands = [
    {
      command: "persist-claim-downstream-status",
      enabled: true,
      idempotencyKey: `claim-downstream-status:${stableId("claim-downstream-status", [
        clientRequestState.clientStateKey,
        routeExportState.routeExportId,
        status,
      ])}`,
    },
    {
      command: "release-claim-review",
      enabled: acceptedForReview,
      idempotencyKey: `claim-review-release:${routeExportState.routeExportId}`,
    },
    {
      command: "release-claim-runtime",
      enabled: acceptedForDownstream,
      idempotencyKey: `claim-runtime-release:${runtimeWorkflowHandoff.handoffId}`,
    },
    {
      command: "persist-claim-downstream-recovery",
      enabled: persistedRecoveryContract.restartSafe === true,
      idempotencyKey: `claim-downstream-recovery:${persistedRecoveryContract.recoveryId}`,
    },
  ];

  return {
    format: "aios.mailchimp.claim.downstreamStatus.v1",
    packetId: stableId("mailchimp-claim-downstream-status", [
      descriptor.id,
      previewState.previewId,
      acceptanceState.acceptanceId,
      runtimeWorkflowHandoff.handoffId,
      routeExportState.routeExportId,
      status,
    ]),
    provider: "mailchimp",
    status,
    acceptedForReview,
    acceptedForDownstream,
    restartSafe: status !== "blocked" && statusRows.every((row) => row.restartSafe !== false),
    retryable: false,
    nextDelaySeconds: null,
    statusChannel: acceptedForDownstream ? "claim.downstream.mailchimp.runtime" : "claim.downstream.mailchimp.review",
    previewId: previewState.previewId,
    acceptanceId: acceptanceState.acceptanceId,
    handoffId: runtimeWorkflowHandoff.handoffId,
    routeExportId: routeExportState.routeExportId,
    recoveryId: persistedRecoveryContract.recoveryId,
    stateKey: clientRequestState.clientStateKey,
    tenantAuditId: tenantBoundaryState.auditId,
    blockedBy,
    pendingBy,
    statusRows,
    ruleRows,
    commands,
    payloadShape: {
      packetId: "string",
      status: "string",
      acceptedForReview: "boolean",
      acceptedForDownstream: "boolean",
      statusRows: "array",
      ruleRows: "array",
      blockedBy: "array",
      pendingBy: "array",
      commands: "array",
    },
    nextAction: blockedBy.length
      ? missingClientState.length
        ? "hydrate-client-runtime-state"
        : tenantBlockers.length
          ? tenantBoundaryState.nextAction
          : routeExportState.nextAction
      : pendingBy.length
        ? pendingBy.includes("acceptance:claim-preview")
          ? "collect-claim-acceptance"
          : persistedRecoveryContract.nextAction
        : acceptedForDownstream
          ? "release-claim-runtime"
          : acceptedForReview
            ? "release-claim-review"
            : readinessSummary.nextAction,
  };
}

function buildClaimOperatorReviewDigest(
  descriptor,
  previewState,
  acceptanceState,
  readinessSummary,
  clientRequestState,
  runtimeWorkflowHandoff,
  persistedRecoveryContract,
  routeExportState,
  downstreamStatusPacket,
  tenantBoundaryState,
  nextSteps,
) {
  const routeBlockedBy = asArray(routeExportState.exportSummary?.blockedBy);
  const blockedBy = [
    ...asArray(downstreamStatusPacket.blockedBy),
    ...routeBlockedBy.map((blocker) => `route:${blocker}`),
    ...asArray(tenantBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingBy = [
    ...asArray(downstreamStatusPacket.pendingBy),
    ...asArray(routeExportState.exportSummary?.pendingBy).map((pending) => `route:${pending}`),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const missingFacts = asArray(readinessSummary.missingFacts);
  const reportCards = [
    {
      card: "claim-preview",
      status: previewState.status,
      primaryCount: previewState.counters.acceptedRules,
      secondaryCount: previewState.counters.blockedRules,
      label: "accepted rules",
      detail: `${missingFacts.length} missing facts`,
      nextAction: missingFacts.length ? "collect-claim-evidence" : "review-claim-preview",
    },
    {
      card: "acceptance",
      status: acceptanceState.accepted
        ? "accepted"
        : acceptanceState.required
          ? "required"
          : "not-required",
      primaryCount: acceptanceState.accepted ? 1 : 0,
      secondaryCount: acceptanceState.blockedBy.length,
      label: "acceptance",
      detail: acceptanceState.acceptedBy || "not accepted",
      nextAction: acceptanceState.nextAction,
    },
    {
      card: "client-state",
      status: clientRequestState.hydrated ? "hydrated" : "needs-hydration",
      primaryCount: clientRequestState.requiredKeys.length - clientRequestState.missingKeys.length,
      secondaryCount: clientRequestState.missingKeys.length,
      label: "hydrated keys",
      detail: clientRequestState.clientStateKey,
      nextAction: clientRequestState.nextAction,
    },
    {
      card: "recovery",
      status: persistedRecoveryContract.status,
      primaryCount: persistedRecoveryContract.recoveryPaths.length,
      secondaryCount: persistedRecoveryContract.restartBlockedBy.length,
      label: "recovery paths",
      detail: persistedRecoveryContract.restartSafe ? "restart safe" : "restart held",
      nextAction: persistedRecoveryContract.nextAction,
    },
    {
      card: "downstream",
      status: downstreamStatusPacket.status,
      primaryCount: downstreamStatusPacket.statusRows.length,
      secondaryCount: downstreamStatusPacket.ruleRows.length,
      label: "downstream rows",
      detail: downstreamStatusPacket.acceptedForDownstream
        ? "runtime release ready"
        : downstreamStatusPacket.acceptedForReview
          ? "review release ready"
          : "release held",
      nextAction: downstreamStatusPacket.nextAction,
    },
  ];
  const releaseReady = downstreamStatusPacket.acceptedForDownstream
    && runtimeWorkflowHandoff.acceptedForRuntime
    && blockedBy.length === 0
    && pendingBy.length === 0;
  const currentCard = reportCards.find((card) => card.status === "blocked")
    || reportCards.find((card) => card.status === "needs-hydration")
    || reportCards.find((card) => card.status === "required")
    || reportCards.find((card) => card.status === "pending")
    || reportCards.at(-1);
  const digestStatus = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : releaseReady
        ? "ready"
        : downstreamStatusPacket.acceptedForReview
          ? "review-ready"
          : "waiting";

  return {
    digestId: stableId("mailchimp-claim-operator-digest", [
      descriptor.id,
      routeExportState.routeExportId,
      downstreamStatusPacket.packetId,
      digestStatus,
    ]),
    format: "aios.mailchimp.claim.operatorDigest.v1",
    status: digestStatus,
    releaseReady,
    generatedDeterministically: true,
    currentCard: currentCard?.card || "claim-preview",
    counters: {
      rules: previewState.counters.rules,
      acceptedRules: previewState.counters.acceptedRules,
      blockedRules: previewState.counters.blockedRules,
      missingFacts: missingFacts.length,
      missingClientKeys: clientRequestState.missingKeys.length,
      acceptanceBlockers: acceptanceState.blockedBy.length,
      restartBlockers: persistedRecoveryContract.restartBlockedBy.length,
      downstreamRows: downstreamStatusPacket.statusRows.length,
      queuedNextSteps: nextSteps.length,
    },
    reportCards,
    timeline: routeExportState.timelineState.phases.map((phase) => ({
      phase: phase.phase,
      status: phase.status,
      nextAction: phase.nextAction,
    })),
    reviewRows: previewState.ruleCards.map((rule) => ({
      ruleId: rule.id,
      subject: rule.subject,
      displayState: rule.displayState,
      admitted: rule.admitted,
      missingFacts: rule.missingFacts,
      nextAction: rule.nextAction,
    })),
    publishControls: [
      {
        command: "publish-claim-operator-digest",
        enabled: releaseReady || downstreamStatusPacket.acceptedForReview,
        idempotencyKey: `claim-operator-digest:${routeExportState.routeExportId}`,
      },
      {
        command: "persist-claim-review-cards",
        enabled: true,
        idempotencyKey: `claim-review-cards:${previewState.previewId}`,
      },
      {
        command: "release-claim-runtime-from-digest",
        enabled: releaseReady,
        idempotencyKey: `claim-digest-runtime:${runtimeWorkflowHandoff.handoffId}`,
      },
    ],
    blockedBy,
    pendingBy,
    statusChannels: [
      ...new Set([
        downstreamStatusPacket.statusChannel,
        ...routeExportState.timelineState.reportChannels,
      ].filter(Boolean)),
    ].sort(),
    nextAction: blockedBy.length
      ? downstreamStatusPacket.nextAction
      : pendingBy.length
        ? pendingBy.includes("acceptance:claim-preview")
          ? "collect-claim-acceptance"
          : persistedRecoveryContract.nextAction
        : releaseReady
          ? "release-claim-runtime-from-digest"
          : currentCard?.nextAction || "review-claim-operator-digest",
  };
}

export function analyzeMailchimpClaims(source = {}, options = {}) {
  const compiled = compileClaimGate(normalizeSource(source), options);
  const descriptor = compiled.descriptor || {};
  const issueSummary = summarizeIssues(compiled.issues);
  const rules = summarizeRules(descriptor.rules);
  const missingFacts = [...new Set(rules.flatMap((rule) => rule.missingFacts))].sort();
  const admitted = compiled.valid && missingFacts.length === 0;
  const reviewable = compiled.valid && missingFacts.length > 0;
  const clientRuntime = descriptor.clientRuntime || {};
  const recovery = descriptor.recovery || {};
  const previewState = buildPreviewState(descriptor, rules, missingFacts, issueSummary);
  const acceptanceInput = options.acceptance || (typeof source === "object" ? source.acceptance : null);
  const tenantBoundaryState = buildClaimTenantBoundaryState(descriptor, acceptanceInput || {});
  const acceptanceState = buildAcceptanceState(
    compiled,
    descriptor,
    admitted,
    reviewable,
    missingFacts,
    acceptanceInput,
    tenantBoundaryState,
  );
  const readinessSummary = buildReadinessSummary(admitted, reviewable, issueSummary, missingFacts, acceptanceState);
  const nextSteps = buildExplainableNextSteps(rules, acceptanceState, readinessSummary);
  const clientRequestState = buildClientRequestState(
    descriptor,
    previewState,
    acceptanceState,
    readinessSummary,
    options,
  );
  const runtimeWorkflowHandoff = buildRuntimeWorkflowHandoff(
    descriptor,
    clientRequestState,
    previewState,
    acceptanceState,
    readinessSummary,
    nextSteps,
  );
  const sourceRecoveryHandoff = normalizeSourceRecoveryHandoff(descriptor, clientRequestState);
  const persistedRecoveryContract = buildPersistedRecoveryContract(
    descriptor,
    clientRequestState,
    runtimeWorkflowHandoff,
    readinessSummary,
    nextSteps,
    sourceRecoveryHandoff,
  );
  const routeExportState = buildClaimRouteExportState(
    descriptor,
    previewState,
    acceptanceState,
    readinessSummary,
    clientRequestState,
    runtimeWorkflowHandoff,
    persistedRecoveryContract,
    tenantBoundaryState,
    nextSteps,
  );
  const downstreamStatusPacket = buildClaimDownstreamStatusPacket(
    descriptor,
    previewState,
    acceptanceState,
    readinessSummary,
    clientRequestState,
    runtimeWorkflowHandoff,
    persistedRecoveryContract,
    routeExportState,
    tenantBoundaryState,
  );
  const operatorReviewDigest = buildClaimOperatorReviewDigest(
    descriptor,
    previewState,
    acceptanceState,
    readinessSummary,
    clientRequestState,
    runtimeWorkflowHandoff,
    persistedRecoveryContract,
    routeExportState,
    downstreamStatusPacket,
    tenantBoundaryState,
    nextSteps,
  );

  return {
    kind: "aios.semantic.claimAnalysis",
    version: MAILCHIMP_CLAIM_ANALYSIS_VERSION,
    provider: "mailchimp",
    status: readinessSummary.status,
    compiled,
    claimContract: {
      gateId: descriptor.id,
      gateName: descriptor.name,
      admission: descriptor.admission,
      requiredFacts: descriptor.verifierContract?.requiredFacts || [],
      evidenceFacts: descriptor.verifierContract?.evidenceFacts || [],
      missingFacts,
      rules,
    },
    previewState,
    acceptanceState,
    readinessSummary,
    nextSteps,
    clientRequestState,
    runtimeWorkflowHandoff,
    persistedRecoveryContract,
    routeExportState,
    acceptanceReceipt: routeExportState.acceptanceReceipt,
    exportSummary: routeExportState.exportSummary,
    historySnapshots: routeExportState.historySnapshots,
    timelineState: routeExportState.timelineState,
    downstreamStatusPacket,
    operatorReviewDigest,
    runtimeContract: {
      clientStateKey: clientRequestState.clientStateKey,
      continuationToken: clientRequestState.continuationToken,
      stateShape: clientRuntime.stateShape,
      persistedState: persistedRecoveryContract.persistedState,
      tenantBoundary: tenantBoundaryState,
      requiredClientKeys: clientRequestState.requiredKeys,
      missingClientKeys: clientRequestState.missingKeys,
      sourceRecovery: sourceRecoveryHandoff,
      downstreamStatusPacket,
      operatorReviewDigest,
    },
    adapterHandoff: {
      statusChannel: "claim.status.mailchimp",
      acceptedForRuntime: runtimeWorkflowHandoff.acceptedForRuntime,
      acceptedForReview: admitted || reviewable,
      workflowHandoff: descriptor.workflowHandoff || null,
      runtimeHandoffId: runtimeWorkflowHandoff.handoffId,
      routeExportId: routeExportState.routeExportId,
      downstreamStatusPacketId: downstreamStatusPacket.packetId,
      operatorReviewDigestId: operatorReviewDigest.digestId,
      tenantAuditId: tenantBoundaryState.auditId,
      previewId: previewState.previewId,
      acceptanceId: acceptanceState.acceptanceId,
      nextAction: tenantBoundaryState.status === "blocked"
        ? tenantBoundaryState.nextAction
        : runtimeWorkflowHandoff.nextAction,
    },
    recovery: {
      restartSafe: persistedRecoveryContract.restartSafe,
      resumeFrom: persistedRecoveryContract.resumeFrom,
      clientStateKey: persistedRecoveryContract.clientStateKey,
      tenantAudit: tenantBoundaryState,
      idempotentCommands: persistedRecoveryContract.idempotentCommands,
      routeExportCommands: routeExportState.routeCommands,
      downstreamStatusCommands: downstreamStatusPacket.commands,
      operatorReviewCommands: operatorReviewDigest.publishControls,
      recoveryPaths: persistedRecoveryContract.recoveryPaths,
      persistedState: persistedRecoveryContract.persistedState,
      sourceRecoveryHandoff,
      nextAction: runtimeWorkflowHandoff.acceptedForRuntime
        ? persistedRecoveryContract.nextAction
        : recovery.onBlocked || persistedRecoveryContract.nextAction,
    },
    tenantBoundaryState,
    issueSummary,
    issues: compiled.issues,
  };
}

export function validateMailchimpClaimAnalysis(analysis) {
  const diagnostics = [];
  if (analysis?.kind !== "aios.semantic.claimAnalysis") {
    diagnostics.push({ level: "error", code: "claim.analysis.kind.invalid" });
  }
  if (!analysis?.claimContract?.requiredFacts?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.required-facts.empty" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime && analysis.claimContract.missingFacts.length > 0) {
    diagnostics.push({ level: "error", code: "claim.analysis.admitted-with-missing-facts" });
  }
  if (!analysis?.runtimeContract?.clientStateKey) {
    diagnostics.push({ level: "warning", code: "claim.analysis.client-state-key.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime && analysis?.readinessSummary?.status !== "ready") {
    diagnostics.push({ level: "error", code: "claim.analysis.runtime-accepted-while-not-ready" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime && analysis?.tenantBoundaryState?.status === "blocked") {
    diagnostics.push({ level: "error", code: "claim.analysis.runtime-accepted-with-tenant-blocker" });
  }
  if (analysis?.tenantBoundaryState?.requiresApproval
    && analysis?.tenantBoundaryState?.canApprove === false
    && analysis?.acceptanceState?.accepted) {
    diagnostics.push({ level: "error", code: "claim.analysis.accepted-by-unapproved-role" });
  }
  if (!analysis?.tenantBoundaryState?.auditEvents?.some((event) => event.event === "claim.preview.scoped")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.tenant-audit-scope-event.missing" });
  }
  if (!analysis?.tenantBoundaryState?.commandPolicy?.some((policy) => policy.command === "handoff-claim-runtime")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.tenant-command-policy.missing" });
  }
  if (analysis?.acceptanceState?.accepted && analysis?.claimContract?.missingFacts?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.accepted-with-missing-facts" });
  }
  if (!analysis?.previewState?.ruleCards || analysis.previewState.ruleCards.length !== analysis.claimContract.rules.length) {
    diagnostics.push({ level: "warning", code: "claim.analysis.preview.rules-mismatch" });
  }
  if (!Array.isArray(analysis?.nextSteps)) {
    diagnostics.push({ level: "warning", code: "claim.analysis.next-steps.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime && !analysis?.clientRequestState?.hydrated) {
    diagnostics.push({ level: "error", code: "claim.analysis.runtime-handoff-without-client-state" });
  }
  if (analysis?.runtimeWorkflowHandoff?.acceptedForRuntime && analysis?.readinessSummary?.readyForRuntime !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.workflow-handoff-while-not-ready" });
  }
  if (!analysis?.runtimeWorkflowHandoff?.commands?.some((command) => command.command === "render-claim-preview")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.preview-command.missing" });
  }
  if (analysis?.clientRequestState?.missingKeys?.length && analysis?.runtimeContract?.missingClientKeys?.length === 0) {
    diagnostics.push({ level: "warning", code: "claim.analysis.client-missing-keys-not-exported" });
  }
  if (analysis?.recovery?.restartSafe && analysis?.persistedRecoveryContract?.restartBlockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.restart-safe-with-blockers" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime && !analysis?.recovery?.idempotentCommands?.some((command) => command.command === "handoff-claim-runtime")) {
    diagnostics.push({ level: "error", code: "claim.analysis.runtime-handoff-not-idempotent" });
  }
  if (analysis?.runtimeContract?.persistedState?.recoveryStatus === "ready" && !analysis?.persistedRecoveryContract?.restartSafe) {
    diagnostics.push({ level: "warning", code: "claim.analysis.ready-recovery-not-restart-safe" });
  }
  if (!analysis?.persistedRecoveryContract?.recoveryPaths?.some((path) => path.path === "client-state")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.client-state-recovery-path.missing" });
  }
  if (analysis?.runtimeContract?.sourceRecovery?.present
    && !analysis?.persistedRecoveryContract?.recoveryPaths?.some((path) => path.path === "source-recovery")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.source-recovery-path.missing" });
  }
  if (analysis?.runtimeContract?.sourceRecovery?.acceptedForRuntime
    && analysis?.runtimeContract?.sourceRecovery?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.source-recovery-accepted-with-blockers" });
  }
  if (analysis?.runtimeContract?.sourceRecovery?.present
    && !analysis?.recovery?.idempotentCommands?.some((command) => command.command === "adopt-source-recovery-handoff")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.source-recovery-command.missing" });
  }
  if (!analysis?.routeExportState?.routeExportId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.route-export.missing" });
  }
  if (analysis?.exportSummary?.status === "ready" && analysis?.exportSummary?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.export-ready-with-blockers" });
  }
  if (analysis?.acceptanceReceipt?.accepted && analysis?.acceptanceState?.accepted !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.acceptance-receipt-inconsistent" });
  }
  if (!analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "runtime-handoff")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.runtime-history.missing" });
  }
  if (!analysis?.timelineState?.reportChannels?.includes("claim.status.mailchimp")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.timeline-channel.missing" });
  }
  if (analysis?.routeExportState?.status !== "blocked"
    && !analysis?.routeExportState?.routeCommands?.some((command) => command.command === "publish-claim-route-export")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.route-export-command.missing" });
  }
  if (!analysis?.downstreamStatusPacket?.packetId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.downstream-status.missing" });
  }
  if (analysis?.downstreamStatusPacket?.acceptedForDownstream
    && analysis?.adapterHandoff?.acceptedForRuntime !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.downstream-runtime-without-adapter" });
  }
  if (analysis?.downstreamStatusPacket?.acceptedForDownstream
    && analysis?.downstreamStatusPacket?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.downstream-accepted-with-blockers" });
  }
  if (analysis?.downstreamStatusPacket?.statusRows?.length < 5) {
    diagnostics.push({ level: "warning", code: "claim.analysis.downstream-status-rows.incomplete" });
  }
  if (analysis?.downstreamStatusPacket?.acceptedForReview
    && analysis?.tenantBoundaryState?.status === "blocked") {
    diagnostics.push({ level: "error", code: "claim.analysis.downstream-review-with-tenant-blocker" });
  }
  if (!analysis?.operatorReviewDigest?.digestId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.operator-digest.missing" });
  }
  if (analysis?.operatorReviewDigest?.releaseReady
    && analysis?.operatorReviewDigest?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.operator-digest-ready-with-blockers" });
  }
  if (analysis?.operatorReviewDigest?.reportCards?.length < 5) {
    diagnostics.push({ level: "warning", code: "claim.analysis.operator-digest.cards-incomplete" });
  }
  if (analysis?.operatorReviewDigest?.releaseReady
    && !analysis?.operatorReviewDigest?.publishControls?.some((command) => (
      command.command === "release-claim-runtime-from-digest" && command.enabled === true
    ))) {
    diagnostics.push({ level: "error", code: "claim.analysis.operator-digest-release-command.missing" });
  }
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    diagnostics,
  };
}

export function selfCheckMailchimpClaimAnalysis() {
  const analysis = analyzeMailchimpClaims();
  const validation = validateMailchimpClaimAnalysis(analysis);
  return {
    ok: validation.ok && analysis.adapterHandoff.acceptedForReview && analysis.previewState.ruleCards.length > 0,
    status: analysis.status,
    requiredFacts: analysis.claimContract.requiredFacts,
    missingFacts: analysis.claimContract.missingFacts,
    readinessSummary: analysis.readinessSummary,
    exportSummary: analysis.exportSummary,
    downstreamStatus: analysis.downstreamStatusPacket,
    operatorReviewDigest: analysis.operatorReviewDigest,
    diagnostics: [...analysis.issues, ...validation.diagnostics],
  };
}
