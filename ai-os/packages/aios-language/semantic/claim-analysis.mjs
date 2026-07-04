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

function normalizeClaimLifecycleSettings(descriptor = {}, source = {}, options = {}) {
  const raw = options.lifecycleSettings
    || descriptor.lifecycleSettings
    || descriptor.claimLifecycle
    || source.claimLifecycle
    || source.lifecycleSettings
    || {};
  const mode = raw.mode || options.mode || "review-gated";
  const requestedInterval = Number(raw.scheduleEverySeconds ?? raw.scheduleIntervalSeconds ?? 0);
  const scheduleEverySeconds = Number.isFinite(requestedInterval) && requestedInterval > 0
    ? Math.max(60, Math.floor(requestedInterval))
    : null;
  const maxCommandsPerTick = Math.max(1, Math.floor(Number(raw.maxCommandsPerTick || 2)));
  const disabledCommands = new Set(asArray(raw.disabledCommands).map(String).filter(Boolean));
  const enabledCommands = new Set(asArray(raw.enabledCommands).map(String).filter(Boolean));
  const diagnostics = [];

  if (!["review-gated", "automatic", "disabled"].includes(mode)) {
    diagnostics.push({
      level: "error",
      code: "claim.lifecycle.mode.invalid",
      field: "claimLifecycle.mode",
      mode,
    });
  }
  if (scheduleEverySeconds != null && scheduleEverySeconds < 60) {
    diagnostics.push({
      level: "warning",
      code: "claim.lifecycle.schedule.too-frequent",
      minimumSeconds: 60,
    });
  }
  if (mode === "automatic" && raw.requireAcceptanceForRuntime === false) {
    diagnostics.push({
      level: "warning",
      code: "claim.lifecycle.automatic-without-acceptance-gate",
      field: "claimLifecycle.requireAcceptanceForRuntime",
    });
  }

  return {
    mode,
    enabled: raw.enabled !== false && mode !== "disabled" && options.enabled !== false,
    autoAcceptReview: raw.autoAcceptReview === true || options.autoAcceptReview === true,
    autoReleaseRuntime: raw.autoReleaseRuntime === true || options.autoReleaseRuntime === true,
    requireAcceptanceForRuntime: raw.requireAcceptanceForRuntime !== false,
    requireTenantBoundary: raw.requireTenantBoundary !== false,
    requireMemoryProviderReady: raw.requireMemoryProviderReady !== false,
    scheduleEverySeconds,
    maxCommandsPerTick,
    disabledCommands: [...disabledCommands].sort(),
    enabledCommands: [...enabledCommands].sort(),
    diagnostics,
    commandEnabled(command) {
      if (raw.enabled === false || mode === "disabled" || disabledCommands.has(command)) return false;
      return enabledCommands.size === 0 || enabledCommands.has(command);
    },
  };
}

function buildClaimLifecycleControlState(
  descriptor,
  source,
  options,
  previewState,
  acceptanceState,
  readinessSummary,
  clientRequestState,
  runtimeWorkflowHandoff,
  downstreamStatusPacket,
  operatorReviewDigest,
  upstreamMemoryProviderHandoff,
  upstreamMemoryAnalyticsExportState,
  releaseEvidenceLedger,
  tenantBoundaryState,
) {
  const settings = normalizeClaimLifecycleSettings(descriptor, source, options);
  const settingsErrors = settings.diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const settingsWarnings = settings.diagnostics.filter((diagnostic) => diagnostic.level === "warning");
  const tenantBlocked = settings.requireTenantBoundary && tenantBoundaryState.status === "blocked";
  const memoryBlocked = settings.requireMemoryProviderReady
    && upstreamMemoryProviderHandoff.present
    && upstreamMemoryProviderHandoff.acceptedForRuntime !== true;
  const memoryExportBlocked = settings.requireMemoryProviderReady
    && upstreamMemoryAnalyticsExportState.present
    && upstreamMemoryAnalyticsExportState.acceptedForClaimRuntime !== true;
  const acceptanceBlocked = settings.requireAcceptanceForRuntime
    && acceptanceState.required
    && acceptanceState.accepted !== true;
  const blockedBy = [
    ...settingsErrors.map((diagnostic) => diagnostic.code),
    ...asArray(readinessSummary.blockingReasons).map((reason) => `readiness:${reason}`),
    ...(clientRequestState.hydrated ? [] : clientRequestState.missingKeys.map((key) => `client-state:${key}`)),
    ...(tenantBlocked ? asArray(tenantBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`) : []),
    ...(memoryBlocked ? asArray(upstreamMemoryProviderHandoff.blockedBy).map((blocker) => `memory-provider:${blocker}`) : []),
    ...(memoryExportBlocked
      ? asArray(upstreamMemoryAnalyticsExportState.blockedBy).map((blocker) => `memory-export:${blocker}`)
      : []),
    ...asArray(releaseEvidenceLedger.blockedBy).map((blocker) => `release-ledger:${blocker}`),
  ].sort();
  const pendingBy = [
    ...settingsWarnings.map((diagnostic) => diagnostic.code),
    ...(acceptanceBlocked ? ["acceptance:claim-preview"] : []),
    ...asArray(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
    ...asArray(releaseEvidenceLedger.pendingBy).map((pending) => `release-ledger:${pending}`),
    ...(memoryBlocked && upstreamMemoryProviderHandoff.status === "pending" ? ["memory-provider:pending"] : []),
    ...(memoryExportBlocked && upstreamMemoryAnalyticsExportState.status === "pending" ? ["memory-export:pending"] : []),
  ].sort();
  const baseCommands = [
    {
      command: settings.enabled ? "disable-claim-lifecycle" : "enable-claim-lifecycle",
      enabled: true,
      subject: descriptor.id || "mailchimp-claim-gate",
      reason: settings.enabled ? "Pause claim lifecycle automation." : "Resume claim lifecycle automation.",
    },
    {
      command: "render-claim-preview",
      enabled: previewState.status !== "blocked",
      subject: previewState.previewId,
      reason: "Expose claim evidence and rule state.",
    },
    {
      command: "persist-claim-client-state",
      enabled: !clientRequestState.hydrated || readinessSummary.readyForReview,
      subject: clientRequestState.clientStateKey,
      reason: "Persist request, workflow, preview, and acceptance state.",
    },
    {
      command: "accept-claim-preview",
      enabled: acceptanceState.canAccept
        && !acceptanceState.accepted
        && (settings.autoAcceptReview || settings.mode === "automatic"),
      subject: acceptanceState.acceptanceId,
      reason: "Lifecycle settings permit claim preview acceptance.",
    },
    {
      command: "publish-claim-downstream-status",
      enabled: downstreamStatusPacket.status !== "blocked",
      subject: downstreamStatusPacket.packetId,
      reason: "Publish downstream claim status for runtime consumers.",
    },
    {
      command: "sync-claim-memory-analytics-export",
      enabled: upstreamMemoryAnalyticsExportState.present
        && upstreamMemoryAnalyticsExportState.blockedBy.length === 0,
      subject: upstreamMemoryAnalyticsExportState.bundleId,
      reason: "Adopt upstream memory analytics export status before runtime release.",
    },
    {
      command: "release-claim-runtime",
      enabled: runtimeWorkflowHandoff.acceptedForRuntime
        && downstreamStatusPacket.acceptedForDownstream === true
        && releaseEvidenceLedger.releaseReady === true
        && settings.autoReleaseRuntime,
      subject: runtimeWorkflowHandoff.handoffId,
      reason: "All lifecycle gates are ready for runtime release.",
    },
    {
      command: "schedule-claim-lifecycle-tick",
      enabled: settings.scheduleEverySeconds != null
        && settings.enabled
        && blockedBy.length === 0
        && (pendingBy.length > 0 || downstreamStatusPacket.status === "pending"),
      subject: descriptor.id || "mailchimp-claim-gate",
      reason: "Continue claim lifecycle on the configured cadence.",
      delaySeconds: settings.scheduleEverySeconds,
    },
  ].map((command) => ({
    ...command,
    enabled: command.enabled && settings.commandEnabled(command.command),
    idempotencyKey: `claim-lifecycle:${stableId("claim-lifecycle-command", [
      descriptor.id,
      command.command,
      command.subject,
      readinessSummary.status,
    ])}`,
  }));
  const selectedCommands = baseCommands
    .filter((command) => command.enabled)
    .slice(0, settings.maxCommandsPerTick);
  const status = settingsErrors.length
    ? "settings-invalid"
    : !settings.enabled
      ? "disabled"
      : blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : runtimeWorkflowHandoff.acceptedForRuntime
            ? "runtime-ready"
            : "review-ready";
  const nextAction = status === "settings-invalid"
    ? "repair-claim-lifecycle-settings"
    : status === "disabled"
      ? "enable-claim-lifecycle"
      : blockedBy.length
        ? blockedBy[0].startsWith("client-state:")
          ? "hydrate-client-runtime-state"
          : blockedBy[0].startsWith("tenant:")
            ? tenantBoundaryState.nextAction
          : blockedBy[0].startsWith("memory-provider:")
            ? upstreamMemoryProviderHandoff.nextAction
            : blockedBy[0].startsWith("memory-export:")
              ? upstreamMemoryAnalyticsExportState.nextAction
              : releaseEvidenceLedger.nextAction
        : pendingBy.includes("acceptance:claim-preview")
          ? "collect-claim-acceptance"
          : selectedCommands[0]?.command || operatorReviewDigest.nextAction;

  return {
    format: "aios.mailchimp.claim.lifecycleControl.v1",
    controlId: stableId("mailchimp-claim-lifecycle-control", [
      descriptor.id,
      previewState.previewId,
      downstreamStatusPacket.packetId,
      releaseEvidenceLedger.ledgerId,
      status,
    ]),
    status,
    settings: {
      mode: settings.mode,
      enabled: settings.enabled,
      autoAcceptReview: settings.autoAcceptReview,
      autoReleaseRuntime: settings.autoReleaseRuntime,
      requireAcceptanceForRuntime: settings.requireAcceptanceForRuntime,
      requireTenantBoundary: settings.requireTenantBoundary,
      requireMemoryProviderReady: settings.requireMemoryProviderReady,
      scheduleEverySeconds: settings.scheduleEverySeconds,
      maxCommandsPerTick: settings.maxCommandsPerTick,
      disabledCommands: settings.disabledCommands,
      enabledCommands: settings.enabledCommands,
    },
    diagnostics: settings.diagnostics,
    blockedBy,
    pendingBy,
    selectedCommands,
    commands: baseCommands,
    schedule: {
      enabled: baseCommands.some((command) => command.command === "schedule-claim-lifecycle-tick" && command.enabled),
      intervalSeconds: settings.scheduleEverySeconds,
      nextTickAction: selectedCommands[0]?.command || nextAction,
      statusChannel: "claim.lifecycle.mailchimp",
    },
    exportSummary: {
      exportKind: "mailchimp.claimLifecycle.controls",
      status,
      previewId: previewState.previewId,
      acceptanceId: acceptanceState.acceptanceId,
      downstreamPacketId: downstreamStatusPacket.packetId,
      upstreamMemoryAnalyticsExportBundleId: upstreamMemoryAnalyticsExportState.bundleId,
      releaseLedgerId: releaseEvidenceLedger.ledgerId,
      totals: {
        commands: baseCommands.length,
        enabledCommands: selectedCommands.length,
        blockers: blockedBy.length,
        pending: pendingBy.length,
      },
      blockedBy,
      pendingBy,
      nextAction,
    },
    nextAction,
  };
}

function buildClaimAnalyticsReportState(
  descriptor,
  previewState,
  acceptanceState,
  readinessSummary,
  clientRequestState,
  routeExportState,
  downstreamStatusPacket,
  operatorReviewDigest,
  upstreamRuntimeAdoptionState,
  upstreamVerifierRecoveryExportState,
  upstreamMemoryProviderHandoff,
  upstreamMemoryAnalyticsExportState,
  upstreamMemoryClaimEvidenceState,
  lifecycleControlState,
  releaseEvidenceLedger,
  tenantBoundaryState,
) {
  const statusSources = [
    {
      channel: "preview",
      status: previewState.status,
      subject: previewState.previewId,
      accepted: readinessSummary.readyForReview === true,
      restartSafe: true,
      blockedBy: asArray(readinessSummary.missingFacts).map((fact) => `missing-fact:${fact}`),
      pendingBy: [],
      counters: previewState.counters,
      nextAction: readinessSummary.nextAction,
    },
    {
      channel: "acceptance",
      status: acceptanceState.accepted ? "accepted" : acceptanceState.required ? "required" : "not-required",
      subject: acceptanceState.acceptanceId,
      accepted: acceptanceState.accepted === true || acceptanceState.required === false,
      restartSafe: acceptanceState.accepted === true || acceptanceState.required === false,
      blockedBy: asArray(acceptanceState.blockedBy),
      pendingBy: acceptanceState.required && !acceptanceState.accepted ? ["acceptance:claim-preview"] : [],
      counters: {
        required: acceptanceState.required ? 1 : 0,
        accepted: acceptanceState.accepted ? 1 : 0,
        blockers: asArray(acceptanceState.blockedBy).length,
      },
      nextAction: acceptanceState.nextAction,
    },
    {
      channel: "client-state",
      status: clientRequestState.hydrated ? "hydrated" : "needs-hydration",
      subject: clientRequestState.clientStateKey,
      accepted: clientRequestState.hydrated === true,
      restartSafe: clientRequestState.hydrated === true,
      blockedBy: asArray(clientRequestState.missingKeys).map((key) => `client-state:${key}`),
      pendingBy: [],
      counters: {
        requiredKeys: asArray(clientRequestState.requiredKeys).length,
        missingKeys: asArray(clientRequestState.missingKeys).length,
      },
      nextAction: clientRequestState.nextAction,
    },
    {
      channel: "tenant-boundary",
      status: tenantBoundaryState.status,
      subject: tenantBoundaryState.auditId,
      accepted: tenantBoundaryState.status !== "blocked",
      restartSafe: tenantBoundaryState.status !== "blocked",
      blockedBy: asArray(tenantBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`),
      pendingBy: [],
      counters: {
        blockers: asArray(tenantBoundaryState.tenantBlockedBy).length,
        scopedRoles: asArray(tenantBoundaryState.allowedRoles).length,
      },
      nextAction: tenantBoundaryState.nextAction,
    },
    {
      channel: "route-export",
      status: routeExportState.status,
      subject: routeExportState.routeExportId,
      accepted: routeExportState.status === "ready",
      restartSafe: routeExportState.status !== "blocked",
      blockedBy: asArray(routeExportState.exportSummary?.blockedBy).map((blocker) => `route:${blocker}`),
      pendingBy: asArray(routeExportState.exportSummary?.pendingBy).map((pending) => `route:${pending}`),
      counters: routeExportState.exportSummary?.totals || {},
      nextAction: routeExportState.nextAction,
    },
    {
      channel: "downstream-status",
      status: downstreamStatusPacket.status,
      subject: downstreamStatusPacket.packetId,
      accepted: downstreamStatusPacket.acceptedForDownstream === true,
      restartSafe: downstreamStatusPacket.restartSafe !== false,
      blockedBy: asArray(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
      pendingBy: asArray(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
      counters: {
        statusRows: asArray(downstreamStatusPacket.statusRows).length,
        ruleRows: asArray(downstreamStatusPacket.ruleRows).length,
      },
      nextAction: downstreamStatusPacket.nextAction,
    },
    {
      channel: "operator-review",
      status: operatorReviewDigest.status,
      subject: operatorReviewDigest.digestId,
      accepted: operatorReviewDigest.releaseReady === true,
      restartSafe: operatorReviewDigest.restartSafe !== false,
      blockedBy: asArray(operatorReviewDigest.blockedBy).map((blocker) => `operator:${blocker}`),
      pendingBy: asArray(operatorReviewDigest.pendingBy).map((pending) => `operator:${pending}`),
      counters: {
        reportCards: asArray(operatorReviewDigest.reportCards).length,
        publishControls: asArray(operatorReviewDigest.publishControls).length,
      },
      nextAction: operatorReviewDigest.nextAction,
    },
    {
      channel: "upstream-runtime",
      status: upstreamRuntimeAdoptionState.status,
      subject: upstreamRuntimeAdoptionState.adoptionId,
      accepted: upstreamRuntimeAdoptionState.acceptedForClaimRuntime === true,
      restartSafe: upstreamRuntimeAdoptionState.restartSafe !== false,
      blockedBy: asArray(upstreamRuntimeAdoptionState.blockedBy).map((blocker) => `upstream-runtime:${blocker}`),
      pendingBy: asArray(upstreamRuntimeAdoptionState.pendingBy).map((pending) => `upstream-runtime:${pending}`),
      counters: {
        commands: asArray(upstreamRuntimeAdoptionState.commands).length,
      },
      nextAction: upstreamRuntimeAdoptionState.nextAction,
    },
    {
      channel: "verifier-recovery-export",
      status: upstreamVerifierRecoveryExportState.status,
      subject: upstreamVerifierRecoveryExportState.envelopeId,
      accepted: upstreamVerifierRecoveryExportState.acceptedForClaimRuntime === true,
      restartSafe: upstreamVerifierRecoveryExportState.restartSafe !== false,
      blockedBy: asArray(upstreamVerifierRecoveryExportState.blockedBy).map((blocker) => (
        `verifier-recovery:${blocker}`
      )),
      pendingBy: asArray(upstreamVerifierRecoveryExportState.pendingBy).map((pending) => (
        `verifier-recovery:${pending}`
      )),
      counters: upstreamVerifierRecoveryExportState.analyticsCounters || {},
      nextAction: upstreamVerifierRecoveryExportState.nextAction,
    },
    {
      channel: "memory-provider",
      status: upstreamMemoryProviderHandoff.status,
      subject: upstreamMemoryProviderHandoff.packetId,
      accepted: upstreamMemoryProviderHandoff.acceptedForRuntime === true,
      restartSafe: upstreamMemoryProviderHandoff.restartSafe !== false,
      blockedBy: asArray(upstreamMemoryProviderHandoff.blockedBy).map((blocker) => `memory-provider:${blocker}`),
      pendingBy: asArray(upstreamMemoryProviderHandoff.pendingBy).map((pending) => `memory-provider:${pending}`),
      counters: {
        mountContracts: asArray(upstreamMemoryProviderHandoff.mountContracts).length,
        commands: asArray(upstreamMemoryProviderHandoff.commands).length,
      },
      nextAction: upstreamMemoryProviderHandoff.nextAction,
    },
    {
      channel: "memory-analytics-export",
      status: upstreamMemoryAnalyticsExportState.status,
      subject: upstreamMemoryAnalyticsExportState.bundleId,
      accepted: upstreamMemoryAnalyticsExportState.acceptedForClaimRuntime === true,
      restartSafe: upstreamMemoryAnalyticsExportState.restartSafe !== false,
      blockedBy: asArray(upstreamMemoryAnalyticsExportState.blockedBy).map((blocker) => `memory-export:${blocker}`),
      pendingBy: asArray(upstreamMemoryAnalyticsExportState.pendingBy).map((pending) => `memory-export:${pending}`),
      counters: upstreamMemoryAnalyticsExportState.analyticsCounters || {},
      nextAction: upstreamMemoryAnalyticsExportState.nextAction,
    },
    {
      channel: "memory-claim-runtime-analytics",
      status: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.status || "not-provided",
      subject: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.digestId || null,
      accepted: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.acceptedForClaimRuntime !== false,
      restartSafe: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.restartSafe !== false,
      blockedBy: asArray(upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.blockedBy).map((blocker) => (
        `memory-claim-runtime-analytics:${blocker}`
      )),
      pendingBy: asArray(upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.pendingBy).map((pending) => (
        `memory-claim-runtime-analytics:${pending}`
      )),
      counters: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.counters || {},
      nextAction: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.nextAction
        || upstreamMemoryAnalyticsExportState.nextAction,
    },
    {
      channel: "memory-claim-evidence",
      status: upstreamMemoryClaimEvidenceState.status,
      subject: upstreamMemoryClaimEvidenceState.manifestId,
      accepted: upstreamMemoryClaimEvidenceState.acceptedForClaimRuntime === true,
      restartSafe: upstreamMemoryClaimEvidenceState.restartSafe !== false,
      blockedBy: asArray(upstreamMemoryClaimEvidenceState.blockedBy).map((blocker) => (
        `memory-claim-evidence:${blocker}`
      )),
      pendingBy: asArray(upstreamMemoryClaimEvidenceState.pendingBy).map((pending) => (
        `memory-claim-evidence:${pending}`
      )),
      counters: upstreamMemoryClaimEvidenceState.counters || {},
      nextAction: upstreamMemoryClaimEvidenceState.nextAction,
    },
    {
      channel: "lifecycle-control",
      status: lifecycleControlState.status,
      subject: lifecycleControlState.controlId,
      accepted: lifecycleControlState.status !== "blocked" && lifecycleControlState.status !== "settings-invalid",
      restartSafe: lifecycleControlState.status !== "settings-invalid",
      blockedBy: asArray(lifecycleControlState.blockedBy).map((blocker) => `lifecycle:${blocker}`),
      pendingBy: asArray(lifecycleControlState.pendingBy).map((pending) => `lifecycle:${pending}`),
      counters: lifecycleControlState.exportSummary?.totals || {},
      nextAction: lifecycleControlState.nextAction,
    },
    {
      channel: "release-ledger",
      status: releaseEvidenceLedger.status,
      subject: releaseEvidenceLedger.ledgerId,
      accepted: releaseEvidenceLedger.releaseReady === true,
      restartSafe: releaseEvidenceLedger.restartSafe === true,
      blockedBy: asArray(releaseEvidenceLedger.blockedBy).map((blocker) => `release-ledger:${blocker}`),
      pendingBy: asArray(releaseEvidenceLedger.pendingBy).map((pending) => `release-ledger:${pending}`),
      counters: {
        releaseGates: asArray(releaseEvidenceLedger.releaseGates).length,
        commands: asArray(releaseEvidenceLedger.commands).length,
      },
      nextAction: releaseEvidenceLedger.nextAction,
    },
  ].map((source, index) => ({
    rowId: stableId("mailchimp-claim-analytics-row", [
      descriptor.id,
      source.channel,
      source.status,
      source.subject,
      index,
    ]),
    index,
    ...source,
    blockedBy: [...new Set(source.blockedBy)].sort(),
    pendingBy: [...new Set(source.pendingBy)].sort(),
  }));
  const blockedBy = statusSources.flatMap((row) => row.blockedBy).sort();
  const pendingBy = statusSources.flatMap((row) => row.pendingBy)
    .filter((pending, index, items) => items.indexOf(pending) === index)
    .sort();
  const unsafeChannels = statusSources
    .filter((row) => row.restartSafe === false)
    .map((row) => row.channel)
    .sort();
  const acceptedForExport = blockedBy.length === 0
    && statusSources.some((row) => row.channel === "route-export" && row.accepted)
    && statusSources.some((row) => row.channel === "downstream-status" && row.accepted);
  const acceptedForRuntimeReport = acceptedForExport
    && statusSources.some((row) => row.channel === "release-ledger" && row.accepted)
    && unsafeChannels.length === 0;
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForRuntimeReport
        ? "runtime-report-ready"
        : acceptedForExport
          ? "export-ready"
          : "waiting";
  const nextAction = blockedBy.length
    ? statusSources.find((row) => row.blockedBy.length)?.nextAction || "repair-claim-analytics-report"
    : pendingBy.length
      ? statusSources.find((row) => row.pendingBy.length)?.nextAction || "continue-claim-analytics-report"
      : acceptedForRuntimeReport
        ? "publish-claim-runtime-report"
        : acceptedForExport
          ? "publish-claim-analytics-export"
          : "hold-claim-analytics-report";
  const analyticsCounters = {
    rows: statusSources.length,
    acceptedRows: statusSources.filter((row) => row.accepted).length,
    blockedRows: statusSources.filter((row) => row.blockedBy.length).length,
    pendingRows: statusSources.filter((row) => row.pendingBy.length).length,
    restartSafeRows: statusSources.filter((row) => row.restartSafe !== false).length,
    rules: previewState.counters.rules,
    acceptedRules: previewState.counters.acceptedRules,
    blockedRules: previewState.counters.blockedRules,
    missingFacts: readinessSummary.missingFacts.length,
    lifecycleCommands: asArray(lifecycleControlState.commands).length,
    releaseGates: asArray(releaseEvidenceLedger.releaseGates).length,
    verifierRecoveryRows: asArray(upstreamVerifierRecoveryExportState.rows).length,
    verifierRecoveryBlocked: asArray(upstreamVerifierRecoveryExportState.blockedBy).length,
    verifierRecoveryPending: asArray(upstreamVerifierRecoveryExportState.pendingBy).length,
    memoryClaimRuntimeDigestRows: asArray(upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.rows).length,
    memoryClaimRuntimeDigestBlockers: asArray(
      upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.blockedBy,
    ).length,
    memoryEvidenceRows: asArray(upstreamMemoryClaimEvidenceState.evidenceRows).length,
    memoryEvidenceMissingFacts: asArray(upstreamMemoryClaimEvidenceState.missingClaimFacts).length,
  };

  return {
    format: "aios.mailchimp.claim.analyticsReport.v1",
    reportId: stableId("mailchimp-claim-analytics-report", [
      clientRequestState.requestId,
      routeExportState.routeExportId,
      downstreamStatusPacket.packetId,
      status,
    ]),
    status,
    acceptedForExport,
    acceptedForRuntimeReport,
    restartSafe: unsafeChannels.length === 0 && blockedBy.length === 0,
    statusChannel: acceptedForRuntimeReport
      ? "claim.analytics.mailchimp.runtime"
      : "claim.analytics.mailchimp.export",
    blockedBy,
    pendingBy,
    unsafeChannels,
    analyticsCounters,
    rows: statusSources,
    exportSummary: {
      exportKind: "mailchimp.claimAnalytics.report",
      status,
      reportId: stableId("mailchimp-claim-analytics-report-export", [
        clientRequestState.requestId,
        status,
      ]),
      requestId: clientRequestState.requestId,
      workflowId: clientRequestState.workflowId,
      routeExportId: routeExportState.routeExportId,
      downstreamPacketId: downstreamStatusPacket.packetId,
      lifecycleControlId: lifecycleControlState.controlId,
      releaseLedgerId: releaseEvidenceLedger.ledgerId,
      totals: analyticsCounters,
      blockedBy,
      pendingBy,
      nextAction,
    },
    historySnapshots: statusSources.map((row) => ({
      eventId: stableId("mailchimp-claim-analytics-history", [
        row.rowId,
        row.status,
        row.accepted,
      ]),
      phase: row.channel,
      status: row.status,
      subject: row.subject,
      counters: row.counters,
      nextAction: row.nextAction,
    })),
    commands: [
      {
        command: "persist-claim-analytics-report",
        enabled: true,
        idempotencyKey: `claim-analytics-report:${stableId("claim-analytics-report", [
          clientRequestState.clientStateKey,
          status,
        ])}`,
      },
      {
        command: "publish-claim-analytics-export",
        enabled: acceptedForExport,
        idempotencyKey: `claim-analytics-export:${routeExportState.routeExportId}`,
      },
      {
        command: "publish-claim-runtime-report",
        enabled: acceptedForRuntimeReport,
        idempotencyKey: `claim-runtime-report:${releaseEvidenceLedger.ledgerId}`,
      },
    ],
    nextAction,
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

function normalizeUpstreamMemoryAnalyticsExportState(
  source,
  options,
  clientRequestState,
  upstreamMemoryProviderHandoff,
) {
  const descriptor = typeof source === "object" ? source : {};
  const recovery = descriptor.recovery || {};
  const upstream = options.memoryAnalyticsExportBundle
    || options.upstreamMemoryAnalyticsExport
    || descriptor.memoryAnalyticsExportBundle
    || descriptor.upstreamMemoryAnalyticsExport
    || descriptor.memoryReportingBundle
    || descriptor.memoryProviderHandoff?.analyticsExportBundle
    || descriptor.upstreamMemoryProviderHandoff?.analyticsExportBundle
    || recovery.memoryAnalyticsExportBundle
    || recovery.upstreamMemoryAnalyticsExport
    || {};
  const packetRows = asArray(upstream.packetRows).map((row) => ({
    packet: row.packet || row.key || "memory-report",
    packetId: row.packetId || row.id || null,
    status: row.status || "unknown",
    accepted: row.accepted === true,
    blockedBy: asArray(row.blockedBy).sort(),
    pendingBy: asArray(row.pendingBy).sort(),
    nextAction: row.nextAction || upstream.nextAction || "review-memory-analytics-export",
  }));
  const exportRows = asArray(upstream.exportRows || upstream.rows).map((row) => ({
    mount: row.mount || row.name || null,
    path: row.path || null,
    status: row.status || "unknown",
    providerSyncRequired: row.providerSyncRequired === true || row.providerSyncEnabled === true,
    nextAction: row.nextAction || upstream.nextAction || "review-memory-export-row",
  }));
  const timelinePhases = asArray(upstream.timelineState?.phases || upstream.timeline).map((phase, index) => ({
    index: phase.index ?? index,
    phase: phase.phase || phase.packet || "memory-export",
    status: phase.status || "unknown",
    nextAction: phase.nextAction || upstream.nextAction || "review-memory-export-timeline",
  }));
  const claimRuntimeDigest = upstream.claimRuntimeAnalyticsDigest
    || upstream.claimRuntimeAnalytics
    || upstream.runtimeAnalyticsDigest
    || {};
  const digestRows = asArray(claimRuntimeDigest.rows).map((row) => ({
    channel: row.channel || row.key || "memory-claim-runtime",
    subject: row.subject || row.packetId || row.receiptId || null,
    status: row.status || "unknown",
    accepted: row.accepted === true,
    restartSafe: row.restartSafe !== false,
    counters: row.counters || {},
    blockedBy: asArray(row.blockedBy).sort(),
    pendingBy: asArray(row.pendingBy).sort(),
    nextAction: row.nextAction || claimRuntimeDigest.nextAction || "review-memory-claim-runtime-analytics",
  }));
  const digestPresent = Boolean(
    claimRuntimeDigest.digestId
      || claimRuntimeDigest.format
      || digestRows.length,
  );
  const digestBlockedBy = [
    ...asArray(claimRuntimeDigest.blockedBy).map((blocker) => `memory-claim-runtime:${blocker}`),
    ...digestRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.channel}:${blocker}`)),
    ...(digestPresent && claimRuntimeDigest.generatedDeterministically === false
      ? ["memory-claim-runtime:not-deterministic"]
      : []),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const digestPendingBy = [
    ...asArray(claimRuntimeDigest.pendingBy).map((pending) => `memory-claim-runtime:${pending}`),
    ...digestRows.flatMap((row) => row.pendingBy.map((pending) => `${row.channel}:${pending}`)),
    ...(digestPresent && claimRuntimeDigest.acceptedForClaimRuntime !== true && digestBlockedBy.length === 0
      ? ["memory-claim-runtime:not-released"]
      : []),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const blockedBy = [
    ...asArray(upstream.blockedBy).map((blocker) => `memory-export:${blocker}`),
    ...packetRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.packet}:${blocker}`)),
    ...exportRows
      .filter((row) => row.status === "blocked")
      .map((row) => `export-row:${row.mount || "unknown"}:blocked`),
    ...digestBlockedBy,
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingBy = [
    ...asArray(upstream.pendingBy).map((pending) => `memory-export:${pending}`),
    ...packetRows.flatMap((row) => row.pendingBy.map((pending) => `${row.packet}:${pending}`)),
    ...(upstream.exportReady === false && blockedBy.length === 0 ? ["memory-export:not-ready"] : []),
    ...digestPendingBy,
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const present = Boolean(
    upstream.bundleId
      || upstream.packetId
      || upstream.format
      || packetRows.length
      || exportRows.length
      || timelinePhases.length
      || digestPresent,
  );
  const acceptedForClaimRuntime = !present
    || (blockedBy.length === 0
      && pendingBy.length === 0
      && upstream.exportReady === true
      && packetRows.every((row) => row.accepted !== false || row.status === "not-required")
      && (!digestPresent || claimRuntimeDigest.acceptedForClaimRuntime === true));
  const restartSafe = upstream.restartSafe !== false
    && upstream.generatedDeterministically !== false
    && (!digestPresent || claimRuntimeDigest.restartSafe !== false)
    && upstreamMemoryProviderHandoff.restartSafe !== false;
  const status = !present
    ? "not-provided"
    : blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : acceptedForClaimRuntime
          ? "export-ready"
          : upstream.status || "observing";
  const bundleId = upstream.bundleId || upstream.packetId || stableId("mailchimp-claim-memory-analytics-export", [
    clientRequestState.requestId,
    upstreamMemoryProviderHandoff.packetId,
    status,
  ]);

  return {
    format: "aios.mailchimp.claim.memoryAnalyticsExportDependency.v1",
    present,
    bundleId,
    sourceFormat: upstream.format || null,
    status,
    exportReady: upstream.exportReady === true,
    acceptedForClaimRuntime,
    restartSafe,
    generatedDeterministically: upstream.generatedDeterministically !== false,
    upstreamMemoryProviderPacketId: upstreamMemoryProviderHandoff.packetId,
    exportManifestId: upstream.exportManifestId || null,
    downstreamStatusPacketId: upstream.downstreamStatusPacketId || null,
    operatorDigestId: upstream.operatorDigestId || null,
    releaseLedgerId: upstream.releaseLedgerId || null,
    syscallDispatchGateId: upstream.syscallDispatchGateId || null,
    statusChannel: upstream.statusChannel
      || upstream.timelineState?.reportChannels?.[0]
      || "claim.memory-analytics-export.mailchimp",
    counters: {
      packets: packetRows.length,
      acceptedPackets: packetRows.filter((row) => row.accepted).length,
      blockedPackets: packetRows.filter((row) => row.blockedBy.length).length,
      pendingPackets: packetRows.filter((row) => row.pendingBy.length).length,
      exportRows: exportRows.length,
      timelinePhases: timelinePhases.length,
      claimRuntimeDigestRows: digestRows.length,
      claimRuntimeDigestBlockedRows: digestRows.filter((row) => row.blockedBy.length).length,
      claimRuntimeDigestPendingRows: digestRows.filter((row) => row.pendingBy.length).length,
      upstreamCounters: upstream.counters || {},
    },
    packetRows,
    exportRows,
    claimRuntimeAnalyticsDigest: {
      present: digestPresent,
      digestId: claimRuntimeDigest.digestId || null,
      sourceFormat: claimRuntimeDigest.format || null,
      status: claimRuntimeDigest.status || (digestPresent ? "provided" : "not-provided"),
      acceptedForClaimRuntime: !digestPresent || claimRuntimeDigest.acceptedForClaimRuntime === true,
      acceptedForClaimProviderSync: !digestPresent || claimRuntimeDigest.acceptedForClaimProviderSync === true,
      restartSafe: !digestPresent || claimRuntimeDigest.restartSafe !== false,
      generatedDeterministically: claimRuntimeDigest.generatedDeterministically !== false,
      rows: digestRows,
      counters: claimRuntimeDigest.counters || {},
      blockedBy: digestBlockedBy,
      pendingBy: digestPendingBy,
      commands: asArray(claimRuntimeDigest.commands).map((command) => ({
        command: command.command || command.action || "memory-claim-runtime-analytics-command",
        enabled: command.enabled !== false,
        idempotencyKey: command.idempotencyKey || command.id || null,
      })),
      nextAction: digestBlockedBy.length
        ? digestRows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-claim-runtime-analytics"
        : digestPendingBy.length
          ? digestRows.find((row) => row.pendingBy.length)?.nextAction || "wait-for-memory-claim-runtime-analytics"
          : digestPresent
            ? "release-memory-claim-runtime-analytics"
            : "review-memory-claim-runtime-analytics",
    },
    timelineState: {
      currentPhase: upstream.timelineState?.currentPhase
        || timelinePhases.find((phase) => phase.status === "blocked")?.phase
        || timelinePhases.find((phase) => phase.status === "pending")?.phase
        || "memory-export",
      phases: timelinePhases,
      reportChannels: [
        ...new Set([
          ...asArray(upstream.timelineState?.reportChannels),
          upstream.statusChannel,
          "claim.memory-analytics-export.mailchimp",
        ].filter(Boolean)),
      ].sort(),
    },
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-claim-memory-analytics-export",
        enabled: present,
        idempotencyKey: `claim-memory-analytics-export:${clientRequestState.clientStateKey}`,
      },
      {
        command: "sync-claim-memory-analytics-export-status",
        enabled: present && blockedBy.length === 0,
        statusChannel: upstream.statusChannel || "claim.memory-analytics-export.mailchimp",
        idempotencyKey: `claim-memory-analytics-export-status:${bundleId}`,
      },
      {
        command: "release-claim-memory-analytics-export",
        enabled: acceptedForClaimRuntime && present,
        idempotencyKey: `claim-memory-analytics-export-release:${bundleId}`,
      },
      {
        command: "adopt-memory-claim-runtime-analytics-digest",
        enabled: digestPresent && digestBlockedBy.length === 0,
        idempotencyKey: `claim-memory-runtime-analytics:${claimRuntimeDigest.digestId || bundleId}`,
      },
    ],
    nextAction: blockedBy.length
      ? packetRows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-analytics-export"
      : pendingBy.length
        ? packetRows.find((row) => row.pendingBy.length)?.nextAction || "wait-for-memory-analytics-export"
        : acceptedForClaimRuntime
          ? "release-claim-memory-analytics-export"
          : upstream.nextAction || "review-memory-analytics-export",
  };
}

function normalizeUpstreamMemoryClaimEvidenceState(
  source,
  options,
  clientRequestState,
  upstreamMemoryAnalyticsExportState,
) {
  const descriptor = typeof source === "object" ? source : {};
  const recovery = descriptor.recovery || {};
  const upstream = options.memoryClaimEvidenceManifest
    || options.upstreamMemoryClaimEvidence
    || descriptor.memoryClaimEvidenceManifest
    || descriptor.upstreamMemoryClaimEvidence
    || descriptor.memoryAnalyticsExportBundle?.claimEvidenceManifest
    || descriptor.upstreamMemoryAnalyticsExport?.claimEvidenceManifest
    || descriptor.memoryProviderHandoff?.claimEvidenceManifest
    || recovery.memoryClaimEvidenceManifest
    || recovery.upstreamMemoryClaimEvidence
    || {};
  const evidenceRows = asArray(upstream.evidenceRows || upstream.rows).map((row) => ({
    evidence: row.evidence || row.gate || row.packet || "memory-evidence",
    packetId: row.packetId || row.id || null,
    status: row.status || "unknown",
    accepted: row.accepted === true,
    restartSafe: row.restartSafe !== false,
    blockedBy: asArray(row.blockedBy).sort(),
    pendingBy: asArray(row.pendingBy).sort(),
    counters: row.counters || {},
    nextAction: row.nextAction || upstream.nextAction || "review-memory-claim-evidence",
  }));
  const requiredClaimFacts = [...new Set(asArray(upstream.requiredClaimFacts))].sort();
  const observedClaimFacts = [...new Set(asArray(upstream.observedClaimFacts))].sort();
  const missingClaimFacts = requiredClaimFacts
    .filter((fact) => !observedClaimFacts.includes(fact))
    .sort();
  const blockedBy = [
    ...asArray(upstream.blockedBy).map((blocker) => `memory-claim-evidence:${blocker}`),
    ...evidenceRows.flatMap((row) => row.blockedBy.map((blocker) => `${row.evidence}:${blocker}`)),
    ...missingClaimFacts.map((fact) => `memory-claim-fact:${fact}`),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingBy = [
    ...asArray(upstream.pendingBy).map((pending) => `memory-claim-evidence:${pending}`),
    ...evidenceRows.flatMap((row) => row.pendingBy.map((pending) => `${row.evidence}:${pending}`)),
    ...(upstream.acceptedForClaimRuntime === false && blockedBy.length === 0
      ? ["memory-claim-evidence:not-accepted"]
      : []),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const present = Boolean(
    upstream.manifestId
      || upstream.packetId
      || upstream.format
      || evidenceRows.length
      || requiredClaimFacts.length
      || observedClaimFacts.length,
  );
  const acceptedForClaimRuntime = !present
    || (blockedBy.length === 0
      && pendingBy.length === 0
      && upstream.acceptedForClaimRuntime === true
      && evidenceRows.every((row) => row.accepted !== false));
  const restartSafe = upstream.restartSafe !== false
    && upstream.generatedDeterministically !== false
    && upstreamMemoryAnalyticsExportState.restartSafe !== false
    && evidenceRows.every((row) => row.restartSafe !== false);
  const status = !present
    ? "not-provided"
    : blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : acceptedForClaimRuntime
          ? "claim-evidence-ready"
          : upstream.status || "observing";
  const manifestId = upstream.manifestId || upstream.packetId || stableId("mailchimp-claim-memory-evidence", [
    clientRequestState.requestId,
    upstreamMemoryAnalyticsExportState.bundleId,
    status,
  ]);

  return {
    format: "aios.mailchimp.claim.memoryClaimEvidenceDependency.v1",
    present,
    manifestId,
    sourceFormat: upstream.format || null,
    status,
    acceptedForClaimRuntime,
    restartSafe,
    generatedDeterministically: upstream.generatedDeterministically !== false,
    upstreamMemoryAnalyticsExportBundleId: upstreamMemoryAnalyticsExportState.bundleId,
    analyticsExportReady: upstreamMemoryAnalyticsExportState.acceptedForClaimRuntime === true,
    requiredClaimFacts,
    observedClaimFacts,
    missingClaimFacts,
    evidenceRows,
    blockedBy,
    pendingBy,
    counters: {
      evidenceRows: evidenceRows.length,
      acceptedRows: evidenceRows.filter((row) => row.accepted).length,
      blockedRows: evidenceRows.filter((row) => row.blockedBy.length).length,
      pendingRows: evidenceRows.filter((row) => row.pendingBy.length).length,
      restartSafeRows: evidenceRows.filter((row) => row.restartSafe !== false).length,
      requiredClaimFacts: requiredClaimFacts.length,
      observedClaimFacts: observedClaimFacts.length,
      missingClaimFacts: missingClaimFacts.length,
      upstreamCounters: upstream.counters || {},
    },
    preview: {
      previewId: stableId("mailchimp-claim-memory-evidence-preview", [
        clientRequestState.requestId,
        manifestId,
        status,
      ]),
      title: "Mailchimp memory evidence for claim release",
      status: blockedBy.length ? "blocked" : pendingBy.length ? "needs-review" : "ready",
      rows: evidenceRows.map((row) => ({
        evidence: row.evidence,
        status: row.status,
        displayState: row.accepted
          ? "accepted"
          : row.blockedBy.length
            ? "blocked"
            : "requires-review",
        blockedBy: row.blockedBy,
        pendingBy: row.pendingBy,
        nextAction: row.nextAction,
      })),
      missingClaimFacts,
    },
    commands: [
      {
        command: "persist-claim-memory-evidence-dependency",
        enabled: present,
        idempotencyKey: `claim-memory-evidence:${clientRequestState.clientStateKey}`,
      },
      {
        command: "render-claim-memory-evidence-preview",
        enabled: present,
        previewId: stableId("mailchimp-claim-memory-evidence-preview", [
          clientRequestState.requestId,
          manifestId,
          status,
        ]),
      },
      {
        command: "release-claim-memory-evidence",
        enabled: acceptedForClaimRuntime && present,
        idempotencyKey: `claim-memory-evidence-release:${manifestId}`,
      },
    ],
    nextAction: blockedBy.length
      ? evidenceRows.find((row) => row.blockedBy.length)?.nextAction || "repair-memory-claim-evidence"
      : pendingBy.length
        ? evidenceRows.find((row) => row.pendingBy.length)?.nextAction || "wait-for-memory-claim-evidence"
        : acceptedForClaimRuntime
          ? "release-claim-memory-evidence"
          : upstream.nextAction || "review-memory-claim-evidence",
  };
}

function normalizeUpstreamRuntimeAdoptionState(source, options, clientRequestState) {
  const descriptor = typeof source === "object" ? source : {};
  const upstream = options.upstreamRuntimeAdoption
    || options.verifierSyscallAdoption
    || descriptor.upstreamRuntimeAdoption
    || descriptor.verifierSyscallAdoption
    || descriptor.syscallAdoptionPacket
    || descriptor.recovery?.upstreamRuntimeAdoption
    || {};
  const gates = asArray(upstream.gates).map((gate) => ({
    gate: gate.gate || gate.key || "unknown",
    status: gate.status || "unknown",
    accepted: gate.accepted === true,
    restartSafe: gate.restartSafe !== false,
    packetId: gate.packetId || gate.packageId || null,
    blockedBy: asArray(gate.blockedBy).sort(),
    pendingBy: asArray(gate.pendingBy).sort(),
    nextAction: gate.nextAction || upstream.nextAction || "review-upstream-runtime-gate",
  }));
  const blockedBy = [
    ...asArray(upstream.blockedBy).map((blocker) => `upstream:${blocker}`),
    ...gates.flatMap((gate) => gate.blockedBy.map((blocker) => `${gate.gate}:${blocker}`)),
  ].sort();
  const pendingBy = [
    ...asArray(upstream.pendingBy).map((pending) => `upstream:${pending}`),
    ...gates.flatMap((gate) => gate.pendingBy.map((pending) => `${gate.gate}:${pending}`)),
  ].sort();
  const present = Boolean(
    upstream.adoptionId
      || upstream.packetId
      || upstream.summaryId
      || upstream.format
      || gates.length,
  );
  const acceptedForClaimRuntime = !present
    || (blockedBy.length === 0 && pendingBy.length === 0 && upstream.releaseReady === true);
  const status = !present
    ? "not-provided"
    : blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : acceptedForClaimRuntime
          ? "runtime-ready"
          : upstream.status || "observing";

  return {
    format: "aios.mailchimp.claim.upstreamRuntimeAdoption.v1",
    present,
    adoptionId: upstream.adoptionId
      || upstream.packetId
      || stableId("mailchimp-claim-upstream-runtime", [
        clientRequestState.requestId,
        clientRequestState.continuationToken,
        status,
      ]),
    status,
    acceptedForClaimRuntime,
    releaseReady: acceptedForClaimRuntime && present,
    restartSafe: upstream.restartSafe !== false && gates.every((gate) => gate.restartSafe !== false),
    statusChannel: upstream.statusChannel || "claim.upstream-runtime.mailchimp",
    sourcePacketId: upstream.packetId || upstream.summaryId || null,
    gates,
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-claim-upstream-runtime-adoption",
        enabled: present,
        idempotencyKey: `claim-upstream-runtime:${clientRequestState.clientStateKey}`,
      },
      {
        command: "release-claim-upstream-runtime",
        enabled: acceptedForClaimRuntime && present,
        idempotencyKey: `claim-upstream-runtime-release:${upstream.adoptionId || clientRequestState.continuationToken}`,
      },
    ],
    nextAction: blockedBy.length
      ? gates.find((gate) => gate.blockedBy.length)?.nextAction || upstream.nextAction || "repair-upstream-runtime-adoption"
      : pendingBy.length
        ? gates.find((gate) => gate.pendingBy.length)?.nextAction || upstream.nextAction || "wait-for-upstream-runtime-adoption"
        : acceptedForClaimRuntime
          ? "release-claim-upstream-runtime"
          : upstream.nextAction || "review-upstream-runtime-adoption",
  };
}

function normalizeUpstreamVerifierRecoveryExportState(source, options, clientRequestState, upstreamRuntimeAdoptionState) {
  const descriptor = typeof source === "object" ? source : {};
  const upstream = options.verifierRecoveryExportEnvelope
    || options.upstreamVerifierRecoveryExport
    || descriptor.verifierRecoveryExportEnvelope
    || descriptor.upstreamVerifierRecoveryExport
    || descriptor.recoveryExportEnvelope
    || descriptor.recovery?.verifierRecoveryExportEnvelope
    || descriptor.recovery?.upstreamVerifierRecoveryExport
    || descriptor.verifier?.recoveryExportEnvelope
    || {};
  const rows = asArray(upstream.rows || upstream.exportSummary?.rows).map((row) => ({
    key: row.key || row.channel || "unknown",
    packetId: row.packetId || row.subject || null,
    status: row.status || "unknown",
    accepted: row.accepted === true,
    restartSafe: row.restartSafe !== false,
    blockedBy: asArray(row.blockedBy).sort(),
    pendingBy: asArray(row.pendingBy).sort(),
    nextAction: row.nextAction || upstream.nextAction || "review-verifier-recovery-export",
  }));
  const claimAdoptionSource = upstream.claimAdoptionReceipt
    || upstream.claimRuntimeAdoptionReceipt
    || upstream.claimAdoption
    || {};
  const claimAdoptionPresent = Boolean(
    claimAdoptionSource.format === "aios.mailchimp.verifier.claimAdoptionReceipt.v1"
      || claimAdoptionSource.receiptId,
  );
  const claimAdoptionRows = asArray(claimAdoptionSource.rows).map((row) => ({
    key: row.key || "unknown",
    status: row.status || "unknown",
    accepted: row.accepted === true,
    restartSafe: row.restartSafe !== false,
    blockedBy: asArray(row.blockedBy).sort(),
    pendingBy: asArray(row.pendingBy).sort(),
    nextAction: row.nextAction || claimAdoptionSource.nextAction || "review-verifier-claim-adoption",
  }));
  const claimAdoptionBlockedBy = [
    ...asArray(claimAdoptionSource.blockedBy).map((blocker) => `claim-adoption:${blocker}`),
    ...asArray(claimAdoptionSource.missingRuntimeKeys).map((key) => `claim-adoption:runtime-state:${key}`),
    ...claimAdoptionRows.flatMap((row) => row.blockedBy.map((blocker) => `claim-adoption:${row.key}:${blocker}`)),
    ...(claimAdoptionPresent && claimAdoptionSource.acceptedForClaimRuntime !== true
      ? ["claim-adoption:not-accepted"]
      : []),
    ...(claimAdoptionPresent && claimAdoptionSource.sourceEnvelopeId
      && upstream.envelopeId
      && claimAdoptionSource.sourceEnvelopeId !== upstream.envelopeId
      ? ["claim-adoption:source-envelope-mismatch"]
      : []),
  ].sort();
  const claimAdoptionPendingBy = [
    ...asArray(claimAdoptionSource.pendingBy).map((pending) => `claim-adoption:${pending}`),
    ...claimAdoptionRows.flatMap((row) => row.pendingBy.map((pending) => `claim-adoption:${row.key}:${pending}`)),
  ].sort();
  const present = Boolean(
    upstream.format === "aios.mailchimp.verifier.recoveryExportEnvelope.v1"
      || upstream.envelopeId
      || upstream.reportId
      || rows.length
      || claimAdoptionPresent,
  );
  const blockedBy = [
    ...asArray(upstream.blockedBy).map((blocker) => `verifier-export:${blocker}`),
    ...rows.flatMap((row) => row.blockedBy.map((blocker) => `${row.key}:${blocker}`)),
    ...claimAdoptionBlockedBy,
    ...(present && upstreamRuntimeAdoptionState.acceptedForClaimRuntime !== true
      ? ["upstream-runtime:not-accepted"]
      : []),
  ].sort();
  const pendingBy = [
    ...asArray(upstream.pendingBy).map((pending) => `verifier-export:${pending}`),
    ...rows.flatMap((row) => row.pendingBy.map((pending) => `${row.key}:${pending}`)),
    ...claimAdoptionPendingBy,
  ].sort();
  const acceptedForClaimRuntime = !present
    || (blockedBy.length === 0
      && pendingBy.length === 0
      && upstream.acceptedForClaimRuntime === true
      && upstreamRuntimeAdoptionState.acceptedForClaimRuntime === true
      && (!claimAdoptionPresent || claimAdoptionSource.acceptedForClaimRuntime === true));
  const restartSafe = !present
    || (upstream.restartSafe !== false
      && rows.every((row) => row.restartSafe !== false)
      && (!claimAdoptionPresent || claimAdoptionSource.restartSafe !== false)
      && upstreamRuntimeAdoptionState.restartSafe !== false);
  const status = !present
    ? "not-provided"
    : blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : acceptedForClaimRuntime
          ? "runtime-ready"
          : upstream.status || "observing";
  const envelopeId = upstream.envelopeId
    || upstream.reportId
    || stableId("mailchimp-claim-verifier-recovery-export", [
      clientRequestState.requestId,
      clientRequestState.continuationToken,
      status,
      rows.map((row) => [row.key, row.status]),
    ]);

  return {
    format: "aios.mailchimp.claim.upstreamVerifierRecoveryExport.v1",
    present,
    envelopeId,
    sourceEnvelopeId: upstream.envelopeId || null,
    status,
    acceptedForClaimRuntime,
    releaseReady: acceptedForClaimRuntime && present,
    restartSafe,
    statusChannel: upstream.statusChannel || "claim.verifier-recovery-export.mailchimp",
    rows,
    blockedBy,
    pendingBy,
    claimAdoptionReceipt: {
      present: claimAdoptionPresent,
      receiptId: claimAdoptionSource.receiptId || null,
      sourceEnvelopeId: claimAdoptionSource.sourceEnvelopeId || null,
      status: claimAdoptionSource.status || (claimAdoptionPresent ? "provided" : "not-provided"),
      acceptedForClaimRuntime: !claimAdoptionPresent
        || (claimAdoptionSource.acceptedForClaimRuntime === true && claimAdoptionBlockedBy.length === 0),
      restartSafe: !claimAdoptionPresent || claimAdoptionSource.restartSafe !== false,
      missingRuntimeKeys: asArray(claimAdoptionSource.missingRuntimeKeys),
      runtimeState: claimAdoptionSource.runtimeState || {},
      rows: claimAdoptionRows,
      blockedBy: claimAdoptionBlockedBy,
      pendingBy: claimAdoptionPendingBy,
      commands: asArray(claimAdoptionSource.commands).map((command) => ({
        command: command.command,
        enabled: command.enabled === true,
        idempotencyKey: command.idempotencyKey || null,
      })),
      nextAction: claimAdoptionSource.nextAction || "review-verifier-claim-adoption",
    },
    analyticsCounters: {
      rows: rows.length,
      acceptedRows: rows.filter((row) => row.accepted).length,
      blockedRows: rows.filter((row) => row.blockedBy.length).length,
      pendingRows: rows.filter((row) => row.pendingBy.length).length,
      restartSafeRows: rows.filter((row) => row.restartSafe !== false).length,
      claimAdoptionRows: claimAdoptionRows.length,
      claimAdoptionBlockers: claimAdoptionBlockedBy.length,
      claimAdoptionPending: claimAdoptionPendingBy.length,
    },
    exportSummary: {
      exportKind: "mailchimp.claimVerifierRecoveryExport.summary",
      status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : "ready",
      sourceEnvelopeId: upstream.envelopeId || null,
      rows: rows.map((row) => ({
        key: row.key,
        status: row.status,
        accepted: row.accepted,
        restartSafe: row.restartSafe,
        nextAction: row.nextAction,
      })),
      claimAdoptionReceiptId: claimAdoptionSource.receiptId || null,
    },
    commands: [
      {
        command: "persist-claim-verifier-recovery-export",
        enabled: present,
        idempotencyKey: `claim-verifier-recovery-export:${envelopeId}`,
      },
      {
        command: "release-claim-verifier-recovery-export",
        enabled: acceptedForClaimRuntime && present,
        idempotencyKey: `claim-verifier-recovery-export-release:${envelopeId}`,
      },
      {
        command: "wait-for-verifier-recovery-export",
        enabled: present && pendingBy.length > 0 && blockedBy.length === 0,
        idempotencyKey: `claim-verifier-recovery-export-wait:${stableId("claim-verifier-recovery-export-wait", [
          envelopeId,
          pendingBy,
        ])}`,
      },
      {
        command: "adopt-verifier-claim-adoption-receipt",
        enabled: claimAdoptionPresent && claimAdoptionBlockedBy.length === 0,
        receiptId: claimAdoptionSource.receiptId || null,
        idempotencyKey: `claim-verifier-adoption:${claimAdoptionSource.receiptId || envelopeId}`,
      },
    ],
    nextAction: blockedBy.length
      ? claimAdoptionBlockedBy.length
        ? claimAdoptionSource.nextAction || "repair-verifier-claim-adoption"
        : rows.find((row) => row.blockedBy.length)?.nextAction || upstream.nextAction || "repair-verifier-recovery-export"
      : pendingBy.length
        ? claimAdoptionPendingBy.length
          ? claimAdoptionSource.nextAction || "wait-for-verifier-claim-adoption"
          : rows.find((row) => row.pendingBy.length)?.nextAction || upstream.nextAction || "wait-for-verifier-recovery-export"
        : acceptedForClaimRuntime
          ? "release-claim-verifier-recovery-export"
          : upstream.nextAction || "review-verifier-recovery-export",
  };
}

function normalizeUpstreamMemoryProviderHandoff(source, options, clientRequestState) {
  const descriptor = typeof source === "object" ? source : {};
  const recovery = descriptor.recovery || {};
  const directClientWorkflow = options.memoryClientWorkflowHandoffPacket
    || options.memoryClientWorkflowHandoff
    || descriptor.memoryClientWorkflowHandoffPacket
    || descriptor.memoryClientWorkflowHandoff
    || descriptor.clientWorkflowHandoffPacket
    || descriptor.memoryAnalyticsExportBundle?.clientWorkflowHandoffPacket
    || descriptor.upstreamMemoryAnalyticsExport?.clientWorkflowHandoffPacket
    || recovery.memoryClientWorkflowHandoffPacket
    || null;
  const analyticsReceipt = options.memoryClaimAdoptionReceipt
    || descriptor.memoryClaimAdoptionReceipt
    || descriptor.memoryAnalyticsExportBundle?.claimRuntimeAdoptionReceipt
    || descriptor.upstreamMemoryAnalyticsExport?.claimRuntimeAdoptionReceipt
    || recovery.memoryClaimAdoptionReceipt
    || null;
  const upstream = directClientWorkflow
    || options.memoryProviderHandoff
    || options.upstreamMemoryProviderHandoff
    || descriptor.memoryProviderHandoff
    || descriptor.upstreamMemoryProviderHandoff
    || descriptor.memoryHandoffEnvelope
    || recovery.memoryProviderHandoff
    || recovery.upstreamMemoryProviderHandoff
    || {};
  const releaseReceipt = analyticsReceipt
    || upstream.claimRuntimeAdoptionReceipt
    || upstream.releaseReceipt
    || upstream.acceptanceReceipt
    || {};
  const healthSource = upstream.providerHealthHandoff
    || upstream.healthHandoff
    || upstream.providerServiceContract?.healthHandoff
    || upstream.syncMetadata?.healthHandoff
    || releaseReceipt.providerHealthHandoff
    || {};
  const mountContracts = asArray(upstream.mountContracts || upstream.mounts).map((mount) => ({
    mount: mount.mount || mount.name || "unknown",
    path: mount.path || null,
    status: mount.status || "unknown",
    selectedForProviderSync: mount.selectedForProviderSync === true,
    stagedWriteback: mount.stagedWriteback === true,
    restartSafe: mount.restartSafe !== false,
    statusChannel: mount.statusChannel || upstream.syncMetadata?.statusChannel || null,
    recoveryCursor: mount.recoveryCursor || null,
    blockedBy: asArray(mount.blockedBy).sort(),
    pendingBy: asArray(mount.pendingBy).sort(),
    nextAction: mount.nextAction || upstream.nextAction || "review-memory-provider-handoff",
  }));
  const gates = [
    ...asArray(upstream.gates),
    ...asArray(releaseReceipt.gateReceipts),
  ].map((gate) => ({
    gate: gate.gate || gate.key || "memory-provider",
    status: gate.status || "unknown",
    accepted: gate.accepted === true,
    restartSafe: gate.restartSafe !== false,
    packetId: gate.packetId || null,
    blockedBy: asArray(gate.blockedBy).sort(),
    pendingBy: asArray(gate.pendingBy).sort(),
    nextAction: gate.nextAction || upstream.nextAction || "review-memory-provider-gate",
  }));
  const healthRows = asArray(healthSource.mountHealthRows || healthSource.rows).map((row) => ({
    mount: row.mount || row.name || "unknown",
    status: row.status || "unknown",
    selectedForProviderSync: row.selectedForProviderSync === true,
    providerSyncHeld: row.providerSyncHeld === true,
    incidents: asArray(row.incidents).sort(),
    blockedBy: asArray(row.blockedBy).sort(),
    pendingBy: asArray(row.pendingBy).sort(),
    nextAction: row.nextAction || healthSource.nextAction || "review-memory-provider-health",
  }));
  const healthErrors = asArray(healthSource.actionableErrors).map((error) => ({
    code: error.code || "memory.health.unknown",
    severity: error.severity || error.level || "error",
    retryable: error.retryable === true,
    action: error.action || healthSource.nextAction || "review-memory-provider-health",
    mount: error.mount || null,
  }));
  const healthPresent = Boolean(
    healthSource.packetId
      || healthSource.healthId
      || healthSource.format
      || healthRows.length
      || healthErrors.length,
  );
  const healthBlockedBy = [
    ...asArray(healthSource.blockedBy).map((blocker) => `memory-health:${blocker}`),
    ...healthRows.flatMap((row) => row.blockedBy.map((blocker) => `health-row:${row.mount}:${blocker}`)),
    ...healthErrors
      .filter((error) => error.severity === "error" && error.retryable !== true)
      .map((error) => `health-error:${error.code}`),
    ...(healthSource.providerSyncHeld === true && healthSource.retryable !== true
      ? ["memory-health:provider-sync-held"]
      : []),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const healthPendingBy = [
    ...asArray(healthSource.pendingBy).map((pending) => `memory-health:${pending}`),
    ...healthRows.flatMap((row) => row.pendingBy.map((pending) => `health-row:${row.mount}:${pending}`)),
    ...healthErrors
      .filter((error) => error.retryable === true)
      .map((error) => `health-retry:${error.code}`),
    ...(healthSource.retryable === true ? ["memory-health:retry-scheduled"] : []),
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const healthAcceptedForRuntime = !healthPresent
    || healthSource.acceptedForRuntime === true
    || (healthBlockedBy.length === 0 && healthSource.acceptedForRuntime !== false);
  const healthAcceptedForProviderSync = !healthPresent
    || (healthSource.acceptedForProviderSync === true
      && healthBlockedBy.length === 0
      && healthPendingBy.length === 0);
  const blockedBy = [
    ...asArray(upstream.blockedBy).map((blocker) => `memory:${blocker}`),
    ...asArray(releaseReceipt.blockedBy).map((blocker) => `memory-receipt:${blocker}`),
    ...mountContracts.flatMap((mount) => mount.blockedBy.map((blocker) => `mount:${mount.mount}:${blocker}`)),
    ...gates.flatMap((gate) => gate.blockedBy.map((blocker) => `${gate.gate}:${blocker}`)),
    ...healthBlockedBy,
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const pendingBy = [
    ...asArray(upstream.pendingBy).map((pending) => `memory:${pending}`),
    ...asArray(releaseReceipt.pendingBy).map((pending) => `memory-receipt:${pending}`),
    ...mountContracts.flatMap((mount) => mount.pendingBy.map((pending) => `mount:${mount.mount}:${pending}`)),
    ...gates.flatMap((gate) => gate.pendingBy.map((pending) => `${gate.gate}:${pending}`)),
    ...healthPendingBy,
  ].filter((item, index, items) => items.indexOf(item) === index).sort();
  const present = Boolean(
    upstream.packetId
      || upstream.format
      || upstream.continuationId
      || upstream.controlPlaneId
      || releaseReceipt.receiptId
      || healthPresent
      || mountContracts.length
      || gates.length,
  );
  const acceptedForRuntime = !present
    || (blockedBy.length === 0
      && upstream.acceptedForRuntime !== false
      && releaseReceipt.acceptedForClaimRuntime !== false
      && releaseReceipt.acceptedForRuntime !== false
      && healthAcceptedForRuntime);
  const acceptedForProviderSync = !present
    || (blockedBy.length === 0
      && pendingBy.length === 0
      && healthAcceptedForProviderSync
      && (upstream.acceptedForProviderSync === true
        || upstream.releaseReady === true
        || releaseReceipt.acceptedForClaimProviderSync === true
        || releaseReceipt.acceptedForProviderSync === true));
  const restartSafe = upstream.restartSafe !== false
    && releaseReceipt.restartSafe !== false
    && healthSource.restartSafe !== false
    && mountContracts.every((mount) => mount.restartSafe !== false)
    && gates.every((gate) => gate.restartSafe !== false);
  const status = !present
    ? "not-provided"
    : blockedBy.length
      ? "blocked"
    : pendingBy.length
      ? "pending"
      : healthPresent && healthAcceptedForProviderSync !== true
        ? "health-held"
      : acceptedForProviderSync
        ? "provider-sync-ready"
      : acceptedForRuntime
        ? "runtime-ready"
            : upstream.status || "observing";
  const syncMetadata = upstream.syncMetadata || {};
  const stateKey = upstream.stateKey || releaseReceipt.stateKey || clientRequestState.clientStateKey;
  const packetId = upstream.packetId || stableId("mailchimp-claim-memory-provider", [
    clientRequestState.requestId,
    upstream.continuationId,
    releaseReceipt.receiptId,
    status,
  ]);

  return {
    format: "aios.mailchimp.claim.memoryProviderDependency.v1",
    present,
    packetId,
    sourceFormat: upstream.format || null,
    status,
    acceptedForRuntime,
    acceptedForProviderSync,
    releaseReady: acceptedForProviderSync && present,
    restartSafe,
    stateKey,
    continuationToken: upstream.continuationToken || releaseReceipt.continuationToken || clientRequestState.continuationToken,
    continuationId: upstream.continuationId || null,
    controlPlaneId: upstream.controlPlaneId || null,
    workflowControlPacketId: upstream.workflowControlPacketId || null,
    downstreamPacketId: upstream.downstreamPacketId || null,
    tenantAuditId: upstream.tenantAuditId || releaseReceipt.tenantAuditId || null,
    claimRuntimeAdoptionReceipt: {
      present: Boolean(releaseReceipt.receiptId || analyticsReceipt?.receiptId),
      receiptId: releaseReceipt.receiptId || null,
      sourcePacketId: releaseReceipt.sourcePacketId || upstream.packetId || null,
      acceptedForClaimRuntime: acceptedForRuntime,
      acceptedForClaimProviderSync: acceptedForProviderSync,
      restartSafe,
      blockedBy: asArray(releaseReceipt.blockedBy).sort(),
      pendingBy: asArray(releaseReceipt.pendingBy).sort(),
      nextAction: releaseReceipt.nextAction || upstream.nextAction || "review-memory-client-workflow-handoff",
    },
    statusChannel: syncMetadata.statusChannel || upstream.statusChannel || "claim.memory-provider.mailchimp",
    syncMetadata: {
      statusChannel: syncMetadata.statusChannel || upstream.statusChannel || null,
      cursorPaths: asArray(syncMetadata.cursorPaths).sort(),
      scheduleId: syncMetadata.scheduleId || null,
      intervalSeconds: syncMetadata.intervalSeconds ?? null,
      negotiatedCapabilities: asArray(syncMetadata.negotiatedCapabilities).sort(),
      missingCapabilities: asArray(syncMetadata.missingCapabilities).sort(),
      healthPacketId: healthSource.packetId || null,
      healthStatus: healthSource.status || null,
    },
    providerHealthHandoff: {
      present: healthPresent,
      packetId: healthSource.packetId || null,
      healthId: healthSource.healthId || null,
      status: healthSource.status || (healthPresent ? "provided" : "not-provided"),
      acceptedForRuntime: healthAcceptedForRuntime,
      acceptedForProviderSync: healthAcceptedForProviderSync,
      providerAvailable: healthSource.providerAvailable !== false,
      adapterHealthy: healthSource.adapterHealthy !== false,
      providerSyncHeld: healthSource.providerSyncHeld === true,
      degradedMode: healthSource.degradedMode === true,
      retryable: healthSource.retryable === true,
      attempts: Math.max(0, Math.floor(Number(healthSource.attempts || 0))),
      maxAttempts: Math.max(0, Math.floor(Number(healthSource.maxAttempts || 0))),
      nextDelaySeconds: healthSource.nextDelaySeconds ?? null,
      statusChannel: healthSource.statusChannel || syncMetadata.statusChannel || upstream.statusChannel || null,
      incidentSummary: healthSource.incidentSummary || {},
      actionableErrors: healthErrors,
      mountHealthRows: healthRows,
      blockedBy: healthBlockedBy,
      pendingBy: healthPendingBy,
      nextAction: healthPendingBy.length
        ? "wait-for-memory-provider-health"
        : healthBlockedBy.length
          ? healthErrors.find((error) => error.severity === "error")?.action || "repair-memory-provider-health"
          : healthAcceptedForProviderSync
            ? "release-claim-memory-provider-health"
            : healthSource.nextAction || "review-memory-provider-health",
    },
    mountContracts,
    gates,
    blockedBy,
    pendingBy,
    persistedState: {
      packetId,
      stateKey,
      continuationId: upstream.continuationId || null,
      claimRuntimeAdoptionReceiptId: releaseReceipt.receiptId || null,
      status,
      acceptedForRuntime,
      acceptedForProviderSync,
      restartSafe,
      providerHealthPacketId: healthSource.packetId || null,
      providerHealthStatus: healthSource.status || null,
      nextAction: blockedBy.length
        ? "repair-upstream-memory-provider-handoff"
      : pendingBy.length
        ? "wait-for-upstream-memory-provider-handoff"
          : acceptedForProviderSync
            ? "release-claim-memory-provider-dependency"
            : "review-upstream-memory-provider-handoff",
    },
    commands: [
      {
        command: "persist-claim-memory-provider-dependency",
        enabled: present,
        idempotencyKey: `claim-memory-provider:${stateKey}`,
      },
      {
        command: "sync-claim-memory-provider-status",
        enabled: present && blockedBy.length === 0,
        statusChannel: syncMetadata.statusChannel || upstream.statusChannel || "claim.memory-provider.mailchimp",
        idempotencyKey: `claim-memory-provider-status:${packetId}`,
      },
      {
        command: "release-claim-memory-provider-dependency",
        enabled: acceptedForProviderSync && present,
        continuationToken: upstream.continuationToken || releaseReceipt.continuationToken || clientRequestState.continuationToken,
        idempotencyKey: `claim-memory-provider-release:${packetId}`,
      },
      {
        command: "adopt-memory-client-workflow-receipt",
        enabled: Boolean(releaseReceipt.receiptId) && blockedBy.length === 0,
        receiptId: releaseReceipt.receiptId || null,
        idempotencyKey: `claim-memory-client-workflow-receipt:${releaseReceipt.receiptId || packetId}`,
      },
      {
        command: "sync-claim-memory-provider-health",
        enabled: healthPresent && healthBlockedBy.length === 0,
        statusChannel: healthSource.statusChannel || syncMetadata.statusChannel || "claim.memory-provider.health.mailchimp",
        idempotencyKey: `claim-memory-provider-health:${healthSource.packetId || packetId}`,
      },
      {
        command: "schedule-claim-memory-provider-health-retry",
        enabled: healthSource.retryable === true,
        delaySeconds: healthSource.nextDelaySeconds ?? 60,
        idempotencyKey: `claim-memory-provider-health-retry:${healthSource.packetId || packetId}`,
      },
    ],
    nextAction: blockedBy.length
      ? healthBlockedBy.length
        ? healthErrors.find((error) => error.severity === "error")?.action || "repair-memory-provider-health"
        : gates.find((gate) => gate.blockedBy.length)?.nextAction
          || mountContracts.find((mount) => mount.blockedBy.length)?.nextAction
          || "repair-upstream-memory-provider-handoff"
      : pendingBy.length
        ? healthPendingBy.length
          ? "wait-for-memory-provider-health"
          : gates.find((gate) => gate.pendingBy.length)?.nextAction
            || mountContracts.find((mount) => mount.pendingBy.length)?.nextAction
            || "wait-for-upstream-memory-provider-handoff"
        : acceptedForProviderSync
          ? "release-claim-memory-provider-dependency"
          : healthPresent && healthAcceptedForProviderSync !== true
            ? "review-memory-provider-health"
            : "review-upstream-memory-provider-handoff",
  };
}

function buildClaimReleaseEvidenceLedger(
  descriptor,
  clientRequestState,
  persistedRecoveryContract,
  routeExportState,
  downstreamStatusPacket,
  operatorReviewDigest,
  upstreamRuntimeAdoptionState,
  upstreamVerifierRecoveryExportState,
  upstreamMemoryProviderHandoff,
  upstreamMemoryAnalyticsExportState,
  upstreamMemoryClaimEvidenceState,
  tenantBoundaryState,
) {
  const releaseGates = [
    {
      gate: "client-runtime",
      packetId: clientRequestState.continuationToken,
      status: clientRequestState.hydrated ? "hydrated" : "needs-client-state",
      accepted: clientRequestState.hydrated === true,
      restartSafe: clientRequestState.hydrated === true,
      blockedBy: clientRequestState.missingKeys.map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRequestState.nextAction,
    },
    {
      gate: "recovery",
      packetId: persistedRecoveryContract.recoveryId,
      status: persistedRecoveryContract.status,
      accepted: persistedRecoveryContract.status !== "blocked",
      restartSafe: persistedRecoveryContract.restartSafe === true,
      blockedBy: asArray(persistedRecoveryContract.restartBlockedBy).map((blocker) => `recovery:${blocker}`),
      pendingBy: persistedRecoveryContract.restartSafe ? [] : ["recovery:restart-safe"],
      nextAction: persistedRecoveryContract.nextAction,
    },
    {
      gate: "route-export",
      packetId: routeExportState.routeExportId,
      status: routeExportState.status,
      accepted: routeExportState.status !== "blocked",
      restartSafe: routeExportState.status !== "blocked",
      blockedBy: asArray(routeExportState.exportSummary?.blockedBy).map((blocker) => `route:${blocker}`),
      pendingBy: asArray(routeExportState.exportSummary?.pendingBy).map((pending) => `route:${pending}`),
      nextAction: routeExportState.nextAction,
    },
    {
      gate: "downstream-status",
      packetId: downstreamStatusPacket.packetId,
      status: downstreamStatusPacket.status,
      accepted: downstreamStatusPacket.acceptedForReview === true,
      restartSafe: downstreamStatusPacket.restartSafe === true,
      blockedBy: asArray(downstreamStatusPacket.blockedBy).map((blocker) => `downstream:${blocker}`),
      pendingBy: asArray(downstreamStatusPacket.pendingBy).map((pending) => `downstream:${pending}`),
      nextAction: downstreamStatusPacket.nextAction,
    },
    {
      gate: "operator-review",
      packetId: operatorReviewDigest.digestId,
      status: operatorReviewDigest.status,
      accepted: operatorReviewDigest.releaseReady === true || downstreamStatusPacket.acceptedForReview === true,
      restartSafe: operatorReviewDigest.status !== "blocked",
      blockedBy: asArray(operatorReviewDigest.blockedBy).map((blocker) => `digest:${blocker}`),
      pendingBy: asArray(operatorReviewDigest.pendingBy).map((pending) => `digest:${pending}`),
      nextAction: operatorReviewDigest.nextAction,
    },
    {
      gate: "upstream-runtime",
      packetId: upstreamRuntimeAdoptionState.adoptionId,
      status: upstreamRuntimeAdoptionState.status,
      accepted: upstreamRuntimeAdoptionState.acceptedForClaimRuntime === true,
      restartSafe: upstreamRuntimeAdoptionState.restartSafe === true,
      blockedBy: asArray(upstreamRuntimeAdoptionState.blockedBy).map((blocker) => `upstream-runtime:${blocker}`),
      pendingBy: asArray(upstreamRuntimeAdoptionState.pendingBy).map((pending) => `upstream-runtime:${pending}`),
      nextAction: upstreamRuntimeAdoptionState.nextAction,
    },
    {
      gate: "verifier-recovery-export",
      packetId: upstreamVerifierRecoveryExportState.envelopeId,
      status: upstreamVerifierRecoveryExportState.status,
      accepted: upstreamVerifierRecoveryExportState.acceptedForClaimRuntime === true,
      restartSafe: upstreamVerifierRecoveryExportState.restartSafe === true,
      blockedBy: asArray(upstreamVerifierRecoveryExportState.blockedBy).map((blocker) => (
        `verifier-recovery:${blocker}`
      )),
      pendingBy: asArray(upstreamVerifierRecoveryExportState.pendingBy).map((pending) => (
        `verifier-recovery:${pending}`
      )),
      nextAction: upstreamVerifierRecoveryExportState.nextAction,
    },
    {
      gate: "memory-provider",
      packetId: upstreamMemoryProviderHandoff.packetId,
      status: upstreamMemoryProviderHandoff.status,
      accepted: upstreamMemoryProviderHandoff.acceptedForRuntime === true,
      restartSafe: upstreamMemoryProviderHandoff.restartSafe === true,
      blockedBy: asArray(upstreamMemoryProviderHandoff.blockedBy).map((blocker) => `memory-provider:${blocker}`),
      pendingBy: asArray(upstreamMemoryProviderHandoff.pendingBy).map((pending) => `memory-provider:${pending}`),
      nextAction: upstreamMemoryProviderHandoff.nextAction,
    },
    {
      gate: "memory-analytics-export",
      packetId: upstreamMemoryAnalyticsExportState.bundleId,
      status: upstreamMemoryAnalyticsExportState.status,
      accepted: upstreamMemoryAnalyticsExportState.acceptedForClaimRuntime === true,
      restartSafe: upstreamMemoryAnalyticsExportState.restartSafe === true,
      blockedBy: asArray(upstreamMemoryAnalyticsExportState.blockedBy).map((blocker) => `memory-export:${blocker}`),
      pendingBy: asArray(upstreamMemoryAnalyticsExportState.pendingBy).map((pending) => `memory-export:${pending}`),
      nextAction: upstreamMemoryAnalyticsExportState.nextAction,
    },
    {
      gate: "memory-claim-runtime-analytics",
      packetId: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.digestId || null,
      status: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.status || "not-provided",
      accepted: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.acceptedForClaimRuntime !== false,
      restartSafe: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.restartSafe !== false,
      blockedBy: asArray(upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.blockedBy).map((blocker) => (
        `memory-claim-runtime-analytics:${blocker}`
      )),
      pendingBy: asArray(upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.pendingBy).map((pending) => (
        `memory-claim-runtime-analytics:${pending}`
      )),
      nextAction: upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.nextAction
        || upstreamMemoryAnalyticsExportState.nextAction,
    },
    {
      gate: "memory-claim-evidence",
      packetId: upstreamMemoryClaimEvidenceState.manifestId,
      status: upstreamMemoryClaimEvidenceState.status,
      accepted: upstreamMemoryClaimEvidenceState.acceptedForClaimRuntime === true,
      restartSafe: upstreamMemoryClaimEvidenceState.restartSafe === true,
      blockedBy: asArray(upstreamMemoryClaimEvidenceState.blockedBy).map((blocker) => (
        `memory-claim-evidence:${blocker}`
      )),
      pendingBy: asArray(upstreamMemoryClaimEvidenceState.pendingBy).map((pending) => (
        `memory-claim-evidence:${pending}`
      )),
      nextAction: upstreamMemoryClaimEvidenceState.nextAction,
    },
    {
      gate: "tenant-boundary",
      packetId: tenantBoundaryState.auditId,
      status: tenantBoundaryState.status,
      accepted: tenantBoundaryState.status === "ready",
      restartSafe: tenantBoundaryState.status !== "blocked",
      blockedBy: asArray(tenantBoundaryState.tenantBlockedBy).map((blocker) => `tenant:${blocker}`),
      pendingBy: [],
      nextAction: tenantBoundaryState.nextAction,
    },
  ];
  const blockedBy = [...new Set(releaseGates.flatMap((gate) => gate.blockedBy))].sort();
  const pendingBy = [...new Set(releaseGates.flatMap((gate) => gate.pendingBy))].sort();
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && downstreamStatusPacket.acceptedForDownstream === true
    && upstreamRuntimeAdoptionState.acceptedForClaimRuntime === true
    && upstreamVerifierRecoveryExportState.acceptedForClaimRuntime === true
    && upstreamMemoryProviderHandoff.acceptedForRuntime === true
    && upstreamMemoryAnalyticsExportState.acceptedForClaimRuntime === true
    && upstreamMemoryClaimEvidenceState.acceptedForClaimRuntime === true;
  const replayCursors = [
    clientRequestState.continuationToken,
    persistedRecoveryContract.resumeFrom,
    upstreamMemoryProviderHandoff.continuationToken,
    ...asArray(upstreamMemoryProviderHandoff.syncMetadata?.cursorPaths),
  ].filter((cursor, index, cursors) => cursor && cursors.indexOf(cursor) === index).sort();
  const releaseCommands = [
    ...asArray(routeExportState.routeCommands),
    ...asArray(downstreamStatusPacket.commands),
    ...asArray(operatorReviewDigest.publishControls),
    ...asArray(upstreamRuntimeAdoptionState.commands),
    ...asArray(upstreamVerifierRecoveryExportState.commands),
    ...asArray(upstreamMemoryProviderHandoff.commands),
    ...asArray(upstreamMemoryAnalyticsExportState.commands),
    ...asArray(upstreamMemoryClaimEvidenceState.commands),
    ...asArray(persistedRecoveryContract.idempotentCommands),
  ].map((command) => ({
    command: command.command,
    enabled: command.enabled === true,
    idempotencyKey: command.idempotencyKey || null,
    statusChannel: command.statusChannel || null,
  }));
  const nextGate = releaseGates.find((gate) => gate.blockedBy.length)
    || releaseGates.find((gate) => gate.pendingBy.length)
    || releaseGates.find((gate) => gate.accepted !== true)
    || releaseGates.at(-1);
  const status = blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "release-ready" : "review-ready";

  return {
    format: "aios.mailchimp.claim.releaseEvidenceLedger.v1",
    ledgerId: stableId("mailchimp-claim-release-ledger", [
      descriptor.id,
      routeExportState.routeExportId,
      downstreamStatusPacket.packetId,
      status,
    ]),
    provider: "mailchimp",
    status,
    releaseReady,
    restartSafe: releaseGates.every((gate) => gate.restartSafe !== false),
    routeExportId: routeExportState.routeExportId,
    downstreamPacketId: downstreamStatusPacket.packetId,
    operatorDigestId: operatorReviewDigest.digestId,
    upstreamRuntimeAdoptionId: upstreamRuntimeAdoptionState.adoptionId,
    upstreamMemoryProviderPacketId: upstreamMemoryProviderHandoff.packetId,
    upstreamMemoryAnalyticsExportBundleId: upstreamMemoryAnalyticsExportState.bundleId,
    upstreamMemoryClaimEvidenceManifestId: upstreamMemoryClaimEvidenceState.manifestId,
    replayCursors,
    releaseGates,
    counters: {
      gates: releaseGates.length,
      blockedGates: releaseGates.filter((gate) => gate.blockedBy.length).length,
      pendingGates: releaseGates.filter((gate) => gate.pendingBy.length).length,
      replayCursors: replayCursors.length,
      idempotentCommands: releaseCommands.filter((command) => command.idempotencyKey).length,
      routeRows: routeExportState.exportSummary?.rows?.length || 0,
      downstreamRows: downstreamStatusPacket.statusRows.length,
      memoryEvidenceRows: asArray(upstreamMemoryClaimEvidenceState.evidenceRows).length,
    },
    persistedState: {
      ledgerStateId: stableId("mailchimp-claim-release-ledger-state", [
        clientRequestState.clientStateKey,
        routeExportState.routeExportId,
        downstreamStatusPacket.packetId,
      ]),
      clientStateKey: clientRequestState.clientStateKey,
      continuationToken: clientRequestState.continuationToken,
      status,
      restartSafe: releaseGates.every((gate) => gate.restartSafe !== false),
      nextAction: releaseReady ? "release-claim-runtime-from-ledger" : nextGate?.nextAction,
    },
    commands: [
      {
        command: "persist-claim-release-ledger",
        enabled: true,
        idempotencyKey: `claim-release-ledger:${routeExportState.routeExportId}`,
      },
      {
        command: "publish-claim-release-evidence",
        enabled: blockedBy.length === 0,
        idempotencyKey: `claim-release-evidence:${downstreamStatusPacket.packetId}`,
      },
      {
        command: "release-claim-runtime-from-ledger",
        enabled: releaseReady,
        idempotencyKey: `claim-release-ledger-runtime:${downstreamStatusPacket.packetId}`,
      },
    ],
    blockedBy,
    pendingBy,
    nextAction: releaseReady ? "release-claim-runtime-from-ledger" : nextGate?.nextAction,
  };
}

function buildClaimAnalyticsEvidenceSnapshot(
  descriptor,
  routeExportState,
  downstreamStatusPacket,
  releaseEvidenceLedger,
  analyticsReportState,
  upstreamVerifierRecoveryExportState,
  upstreamMemoryAnalyticsExportState,
  upstreamMemoryClaimEvidenceState,
) {
  const evidenceRows = [
    {
      source: "route-export",
      artifactId: routeExportState.routeExportId,
      status: routeExportState.status,
      accepted: routeExportState.status === "ready",
      restartSafe: routeExportState.status !== "blocked",
      counters: routeExportState.exportSummary?.totals || {},
      blockedBy: asArray(routeExportState.exportSummary?.blockedBy),
      pendingBy: asArray(routeExportState.exportSummary?.pendingBy),
      nextAction: routeExportState.nextAction,
    },
    {
      source: "downstream-status",
      artifactId: downstreamStatusPacket.packetId,
      status: downstreamStatusPacket.status,
      accepted: downstreamStatusPacket.acceptedForDownstream === true,
      restartSafe: downstreamStatusPacket.restartSafe !== false,
      counters: {
        statusRows: downstreamStatusPacket.statusRows.length,
        ruleRows: downstreamStatusPacket.ruleRows.length,
      },
      blockedBy: asArray(downstreamStatusPacket.blockedBy),
      pendingBy: asArray(downstreamStatusPacket.pendingBy),
      nextAction: downstreamStatusPacket.nextAction,
    },
    {
      source: "release-ledger",
      artifactId: releaseEvidenceLedger.ledgerId,
      status: releaseEvidenceLedger.status,
      accepted: releaseEvidenceLedger.releaseReady === true,
      restartSafe: releaseEvidenceLedger.restartSafe !== false,
      counters: releaseEvidenceLedger.counters || {},
      blockedBy: asArray(releaseEvidenceLedger.blockedBy),
      pendingBy: asArray(releaseEvidenceLedger.pendingBy),
      nextAction: releaseEvidenceLedger.nextAction,
    },
    {
      source: "verifier-recovery-export",
      artifactId: upstreamVerifierRecoveryExportState.envelopeId,
      status: upstreamVerifierRecoveryExportState.status,
      accepted: upstreamVerifierRecoveryExportState.acceptedForClaimRuntime === true,
      restartSafe: upstreamVerifierRecoveryExportState.restartSafe !== false,
      counters: upstreamVerifierRecoveryExportState.counters || {},
      blockedBy: asArray(upstreamVerifierRecoveryExportState.blockedBy),
      pendingBy: asArray(upstreamVerifierRecoveryExportState.pendingBy),
      nextAction: upstreamVerifierRecoveryExportState.nextAction,
    },
    {
      source: "memory-analytics-export",
      artifactId: upstreamMemoryAnalyticsExportState.bundleId,
      status: upstreamMemoryAnalyticsExportState.status,
      accepted: upstreamMemoryAnalyticsExportState.acceptedForClaimRuntime === true,
      restartSafe: upstreamMemoryAnalyticsExportState.restartSafe !== false,
      counters: upstreamMemoryAnalyticsExportState.counters || {},
      blockedBy: asArray(upstreamMemoryAnalyticsExportState.blockedBy),
      pendingBy: asArray(upstreamMemoryAnalyticsExportState.pendingBy),
      nextAction: upstreamMemoryAnalyticsExportState.nextAction,
    },
    {
      source: "memory-claim-evidence",
      artifactId: upstreamMemoryClaimEvidenceState.manifestId,
      status: upstreamMemoryClaimEvidenceState.status,
      accepted: upstreamMemoryClaimEvidenceState.acceptedForClaimRuntime === true,
      restartSafe: upstreamMemoryClaimEvidenceState.restartSafe !== false,
      counters: {
        evidenceRows: asArray(upstreamMemoryClaimEvidenceState.evidenceRows).length,
        missingClaimFacts: asArray(upstreamMemoryClaimEvidenceState.missingClaimFacts).length,
      },
      blockedBy: asArray(upstreamMemoryClaimEvidenceState.blockedBy),
      pendingBy: asArray(upstreamMemoryClaimEvidenceState.pendingBy),
      nextAction: upstreamMemoryClaimEvidenceState.nextAction,
    },
    {
      source: "claim-analytics-report",
      artifactId: analyticsReportState.reportId,
      status: analyticsReportState.status,
      accepted: analyticsReportState.acceptedForExport === true,
      restartSafe: analyticsReportState.restartSafe !== false,
      counters: analyticsReportState.totals || analyticsReportState.counters || {},
      blockedBy: asArray(analyticsReportState.blockedBy),
      pendingBy: asArray(analyticsReportState.pendingBy),
      nextAction: analyticsReportState.nextAction,
    },
  ];
  const blockedBy = evidenceRows
    .flatMap((row) => row.blockedBy.map((blocker) => `${row.source}:${blocker}`))
    .sort();
  const pendingBy = evidenceRows
    .flatMap((row) => row.pendingBy.map((pending) => `${row.source}:${pending}`))
    .sort();
  const exportReady = blockedBy.length === 0
    && pendingBy.length === 0
    && evidenceRows.every((row) => row.accepted && row.restartSafe !== false);
  const snapshotId = stableId("mailchimp-claim-analytics-evidence", [
    descriptor.id,
    routeExportState.routeExportId,
    analyticsReportState.reportId,
    releaseEvidenceLedger.ledgerId,
    evidenceRows.map((row) => [row.source, row.status, row.artifactId]),
  ]);

  return {
    format: "aios.mailchimp.claim.analyticsEvidenceSnapshot.v1",
    snapshotId,
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : exportReady ? "export-ready" : "waiting",
    acceptedForExport: exportReady,
    acceptedForRuntimeReport: exportReady && analyticsReportState.acceptedForRuntimeReport === true,
    restartSafe: evidenceRows.every((row) => row.restartSafe !== false),
    blockedBy,
    pendingBy,
    evidenceRows,
    exportSummary: {
      exportKind: "mailchimp.claimAnalytics.evidenceSnapshot",
      snapshotId,
      status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : exportReady ? "export-ready" : "waiting",
      rows: evidenceRows.map((row) => ({
        source: row.source,
        artifactId: row.artifactId,
        status: row.status,
        accepted: row.accepted,
        restartSafe: row.restartSafe,
        nextAction: row.nextAction,
      })),
      totals: {
        sources: evidenceRows.length,
        acceptedSources: evidenceRows.filter((row) => row.accepted).length,
        blockedSources: evidenceRows.filter((row) => row.blockedBy.length).length,
        pendingSources: evidenceRows.filter((row) => row.pendingBy.length).length,
        restartUnsafeSources: evidenceRows.filter((row) => row.restartSafe === false).length,
      },
      blockedBy,
      pendingBy,
    },
    commands: [
      {
        command: "persist-claim-analytics-evidence-snapshot",
        enabled: true,
        idempotencyKey: `claim-analytics-evidence:${snapshotId}`,
      },
      {
        command: "publish-claim-analytics-evidence-export",
        enabled: exportReady,
        idempotencyKey: `claim-analytics-evidence-export:${snapshotId}`,
      },
    ],
    nextAction: blockedBy.length
      ? evidenceRows.find((row) => row.blockedBy.length)?.nextAction || "repair-claim-analytics-evidence"
      : pendingBy.length
        ? evidenceRows.find((row) => row.pendingBy.length)?.nextAction || "wait-claim-analytics-evidence"
        : exportReady
          ? "publish-claim-analytics-evidence-export"
          : analyticsReportState.nextAction,
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
  const upstreamRuntimeAdoptionState = normalizeUpstreamRuntimeAdoptionState(
    source,
    options,
    clientRequestState,
  );
  const upstreamVerifierRecoveryExportState = normalizeUpstreamVerifierRecoveryExportState(
    source,
    options,
    clientRequestState,
    upstreamRuntimeAdoptionState,
  );
  const upstreamMemoryProviderHandoff = normalizeUpstreamMemoryProviderHandoff(
    source,
    options,
    clientRequestState,
  );
  const upstreamMemoryAnalyticsExportState = normalizeUpstreamMemoryAnalyticsExportState(
    source,
    options,
    clientRequestState,
    upstreamMemoryProviderHandoff,
  );
  const upstreamMemoryClaimEvidenceState = normalizeUpstreamMemoryClaimEvidenceState(
    source,
    options,
    clientRequestState,
    upstreamMemoryAnalyticsExportState,
  );
  const releaseEvidenceLedger = buildClaimReleaseEvidenceLedger(
    descriptor,
    clientRequestState,
    persistedRecoveryContract,
    routeExportState,
    downstreamStatusPacket,
    operatorReviewDigest,
    upstreamRuntimeAdoptionState,
    upstreamVerifierRecoveryExportState,
    upstreamMemoryProviderHandoff,
    upstreamMemoryAnalyticsExportState,
    upstreamMemoryClaimEvidenceState,
    tenantBoundaryState,
  );
  const lifecycleControlState = buildClaimLifecycleControlState(
    descriptor,
    typeof source === "object" ? source : {},
    options,
    previewState,
    acceptanceState,
    readinessSummary,
    clientRequestState,
    runtimeWorkflowHandoff,
    downstreamStatusPacket,
    operatorReviewDigest,
    upstreamMemoryProviderHandoff,
    upstreamMemoryAnalyticsExportState,
    releaseEvidenceLedger,
    tenantBoundaryState,
  );
  const analyticsReportState = buildClaimAnalyticsReportState(
    descriptor,
    previewState,
    acceptanceState,
    readinessSummary,
    clientRequestState,
    routeExportState,
    downstreamStatusPacket,
    operatorReviewDigest,
    upstreamRuntimeAdoptionState,
    upstreamVerifierRecoveryExportState,
    upstreamMemoryProviderHandoff,
    upstreamMemoryAnalyticsExportState,
    upstreamMemoryClaimEvidenceState,
    lifecycleControlState,
    releaseEvidenceLedger,
    tenantBoundaryState,
  );
  const analyticsEvidenceSnapshot = buildClaimAnalyticsEvidenceSnapshot(
    descriptor,
    routeExportState,
    downstreamStatusPacket,
    releaseEvidenceLedger,
    analyticsReportState,
    upstreamVerifierRecoveryExportState,
    upstreamMemoryAnalyticsExportState,
    upstreamMemoryClaimEvidenceState,
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
    upstreamRuntimeAdoptionState,
    upstreamVerifierRecoveryExportState,
    upstreamMemoryProviderHandoff,
    upstreamMemoryAnalyticsExportState,
    upstreamMemoryClaimEvidenceState,
    lifecycleControlState,
    releaseEvidenceLedger,
    analyticsReportState,
    analyticsEvidenceSnapshot,
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
      upstreamRuntimeAdoptionState,
      upstreamVerifierRecoveryExportState,
      upstreamMemoryProviderHandoff,
      upstreamMemoryAnalyticsExportState,
      upstreamMemoryClaimEvidenceState,
      lifecycleControlState,
      releaseEvidenceLedger,
      analyticsReportState,
      analyticsEvidenceSnapshot,
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
      upstreamRuntimeAdoptionId: upstreamRuntimeAdoptionState.adoptionId,
      upstreamVerifierRecoveryExportEnvelopeId: upstreamVerifierRecoveryExportState.envelopeId,
      upstreamMemoryProviderPacketId: upstreamMemoryProviderHandoff.packetId,
      upstreamMemoryAnalyticsExportBundleId: upstreamMemoryAnalyticsExportState.bundleId,
      upstreamMemoryClaimRuntimeAnalyticsDigestId:
        upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.digestId || null,
      upstreamMemoryClaimEvidenceManifestId: upstreamMemoryClaimEvidenceState.manifestId,
      lifecycleControlId: lifecycleControlState.controlId,
      releaseEvidenceLedgerId: releaseEvidenceLedger.ledgerId,
      analyticsReportId: analyticsReportState.reportId,
      analyticsEvidenceSnapshotId: analyticsEvidenceSnapshot.snapshotId,
      tenantAuditId: tenantBoundaryState.auditId,
      previewId: previewState.previewId,
      acceptanceId: acceptanceState.acceptanceId,
      nextAction: tenantBoundaryState.status === "blocked"
        ? tenantBoundaryState.nextAction
        : upstreamMemoryProviderHandoff.status === "blocked" || upstreamMemoryProviderHandoff.status === "pending"
          ? upstreamMemoryProviderHandoff.nextAction
        : upstreamMemoryAnalyticsExportState.status === "blocked" || upstreamMemoryAnalyticsExportState.status === "pending"
          ? upstreamMemoryAnalyticsExportState.nextAction
        : upstreamMemoryClaimEvidenceState.status === "blocked" || upstreamMemoryClaimEvidenceState.status === "pending"
          ? upstreamMemoryClaimEvidenceState.nextAction
        : upstreamVerifierRecoveryExportState.status === "blocked" || upstreamVerifierRecoveryExportState.status === "pending"
          ? upstreamVerifierRecoveryExportState.nextAction
        : upstreamRuntimeAdoptionState.status === "blocked" || upstreamRuntimeAdoptionState.status === "pending"
          ? upstreamRuntimeAdoptionState.nextAction
        : lifecycleControlState.status === "blocked" || lifecycleControlState.status === "settings-invalid"
          ? lifecycleControlState.nextAction
        : runtimeWorkflowHandoff.nextAction,
    },
    recovery: {
      restartSafe: persistedRecoveryContract.restartSafe,
      resumeFrom: persistedRecoveryContract.resumeFrom,
      clientStateKey: persistedRecoveryContract.clientStateKey,
      tenantAudit: tenantBoundaryState,
      idempotentCommands: persistedRecoveryContract.idempotentCommands,
      analyticsEvidenceSnapshot,
      routeExportCommands: routeExportState.routeCommands,
      downstreamStatusCommands: downstreamStatusPacket.commands,
      operatorReviewCommands: operatorReviewDigest.publishControls,
      upstreamRuntimeCommands: upstreamRuntimeAdoptionState.commands,
      upstreamVerifierRecoveryExportCommands: upstreamVerifierRecoveryExportState.commands,
      upstreamVerifierClaimAdoptionCommands: upstreamVerifierRecoveryExportState.claimAdoptionReceipt?.commands || [],
      upstreamMemoryProviderCommands: upstreamMemoryProviderHandoff.commands,
      upstreamMemoryAnalyticsExportCommands: upstreamMemoryAnalyticsExportState.commands,
      upstreamMemoryClaimRuntimeAnalyticsCommands:
        upstreamMemoryAnalyticsExportState.claimRuntimeAnalyticsDigest?.commands || [],
      upstreamMemoryClaimEvidenceCommands: upstreamMemoryClaimEvidenceState.commands,
      lifecycleControlCommands: lifecycleControlState.commands,
      releaseEvidenceCommands: releaseEvidenceLedger.commands,
      analyticsReportCommands: analyticsReportState.commands,
      recoveryPaths: persistedRecoveryContract.recoveryPaths,
      persistedState: persistedRecoveryContract.persistedState,
      sourceRecoveryHandoff,
      upstreamRuntimeAdoptionState,
      upstreamVerifierRecoveryExportState,
      upstreamMemoryProviderHandoff,
      upstreamMemoryAnalyticsExportState,
      upstreamMemoryClaimEvidenceState,
      lifecycleControlState,
      releaseEvidenceLedger,
      analyticsReportState,
      nextAction: runtimeWorkflowHandoff.acceptedForRuntime
        ? upstreamMemoryProviderHandoff.acceptedForRuntime
          ? upstreamMemoryAnalyticsExportState.acceptedForClaimRuntime
            ? upstreamMemoryClaimEvidenceState.acceptedForClaimRuntime
              ? upstreamRuntimeAdoptionState.acceptedForClaimRuntime
                ? upstreamVerifierRecoveryExportState.acceptedForClaimRuntime
                  ? lifecycleControlState.status === "blocked" || lifecycleControlState.status === "settings-invalid"
                    ? lifecycleControlState.nextAction
                    : persistedRecoveryContract.nextAction
                  : upstreamVerifierRecoveryExportState.nextAction
                : upstreamRuntimeAdoptionState.nextAction
              : upstreamMemoryClaimEvidenceState.nextAction
            : upstreamMemoryAnalyticsExportState.nextAction
          : upstreamMemoryProviderHandoff.nextAction
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
  if (!analysis?.lifecycleControlState?.controlId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.lifecycle-control.missing" });
  }
  if (analysis?.lifecycleControlState?.status === "settings-invalid"
    && !analysis?.lifecycleControlState?.diagnostics?.some((diagnostic) => diagnostic.level === "error")) {
    diagnostics.push({ level: "error", code: "claim.analysis.lifecycle-control-invalid-without-error" });
  }
  if (analysis?.lifecycleControlState?.status === "blocked"
    && !analysis?.lifecycleControlState?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.lifecycle-control-blocked-without-reason" });
  }
  if (analysis?.lifecycleControlState?.schedule?.enabled
    && analysis?.lifecycleControlState?.schedule?.intervalSeconds == null) {
    diagnostics.push({ level: "error", code: "claim.analysis.lifecycle-schedule-without-interval" });
  }
  if (analysis?.lifecycleControlState?.selectedCommands?.length
    > analysis?.lifecycleControlState?.settings?.maxCommandsPerTick) {
    diagnostics.push({ level: "error", code: "claim.analysis.lifecycle-command-budget.exceeded" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime
    && analysis?.lifecycleControlState?.status === "blocked") {
    diagnostics.push({ level: "error", code: "claim.analysis.runtime-accepted-with-blocked-lifecycle" });
  }
  if (!analysis?.upstreamMemoryProviderHandoff?.packetId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.memory-provider-handoff.missing" });
  }
  if (analysis?.upstreamMemoryProviderHandoff?.present
    && analysis?.upstreamMemoryProviderHandoff?.acceptedForProviderSync
    && analysis?.upstreamMemoryProviderHandoff?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-provider-accepted-with-blockers" });
  }
  if (analysis?.upstreamMemoryProviderHandoff?.present
    && analysis?.upstreamMemoryProviderHandoff?.restartSafe
    && analysis?.upstreamMemoryProviderHandoff?.mountContracts?.some((mount) => mount.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-provider-restart-safe-with-unsafe-mount" });
  }
  if (analysis?.upstreamMemoryProviderHandoff?.present
    && !analysis?.recovery?.upstreamMemoryProviderCommands?.some((command) => (
      command.command === "persist-claim-memory-provider-dependency"
    ))) {
    diagnostics.push({ level: "warning", code: "claim.analysis.memory-provider-persist-command.missing" });
  }
  if (!analysis?.upstreamVerifierRecoveryExportState?.envelopeId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.verifier-recovery-export.missing" });
  }
  if (analysis?.upstreamVerifierRecoveryExportState?.present
    && analysis?.upstreamVerifierRecoveryExportState?.acceptedForClaimRuntime
    && analysis?.upstreamVerifierRecoveryExportState?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.verifier-recovery-export-accepted-with-blockers" });
  }
  if (analysis?.upstreamVerifierRecoveryExportState?.present
    && analysis?.upstreamVerifierRecoveryExportState?.restartSafe
    && analysis?.upstreamRuntimeAdoptionState?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "claim.analysis.verifier-recovery-export-restart-with-unsafe-runtime" });
  }
  if (analysis?.upstreamVerifierRecoveryExportState?.present
    && !analysis?.recovery?.upstreamVerifierRecoveryExportCommands?.some((command) => (
      command.command === "persist-claim-verifier-recovery-export"
    ))) {
    diagnostics.push({ level: "warning", code: "claim.analysis.verifier-recovery-export-persist-command.missing" });
  }
  if (analysis?.upstreamVerifierRecoveryExportState?.claimAdoptionReceipt?.present
    && !analysis?.recovery?.upstreamVerifierClaimAdoptionCommands?.some((command) => (
      command.command === "persist-verifier-claim-adoption-receipt"
        || command.command === "adopt-verifier-claim-adoption-receipt"
    ))) {
    diagnostics.push({ level: "warning", code: "claim.analysis.verifier-claim-adoption-command.missing" });
  }
  if (analysis?.upstreamVerifierRecoveryExportState?.claimAdoptionReceipt?.acceptedForClaimRuntime
    && analysis?.upstreamVerifierRecoveryExportState?.claimAdoptionReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.verifier-claim-adoption-accepted-with-blockers" });
  }
  if (analysis?.upstreamVerifierRecoveryExportState?.claimAdoptionReceipt?.restartSafe
    && analysis?.upstreamVerifierRecoveryExportState?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "claim.analysis.verifier-claim-adoption-restart-with-unsafe-export" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime
    && analysis?.upstreamVerifierRecoveryExportState?.claimAdoptionReceipt?.present
    && analysis?.upstreamVerifierRecoveryExportState?.claimAdoptionReceipt?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.runtime-accepted-with-verifier-claim-adoption-blocker" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime
    && analysis?.upstreamVerifierRecoveryExportState?.present
    && analysis?.upstreamVerifierRecoveryExportState?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.runtime-accepted-with-verifier-recovery-blocker" });
  }
  if (analysis?.upstreamMemoryProviderHandoff?.claimRuntimeAdoptionReceipt?.present
    && !analysis?.recovery?.upstreamMemoryProviderCommands?.some((command) => (
      command.command === "adopt-memory-client-workflow-receipt"
    ))) {
    diagnostics.push({ level: "warning", code: "claim.analysis.memory-client-workflow-receipt-command.missing" });
  }
  if (analysis?.upstreamMemoryProviderHandoff?.claimRuntimeAdoptionReceipt?.acceptedForClaimProviderSync
    && analysis?.upstreamMemoryProviderHandoff?.acceptedForProviderSync !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-client-workflow-receipt-provider-sync.inconsistent" });
  }
  if (analysis?.upstreamMemoryProviderHandoff?.claimRuntimeAdoptionReceipt?.restartSafe
    && analysis?.upstreamMemoryProviderHandoff?.claimRuntimeAdoptionReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-client-workflow-receipt-restart-safe-with-blockers" });
  }
  if (analysis?.upstreamMemoryProviderHandoff?.claimRuntimeAdoptionReceipt?.present
    && !analysis?.upstreamMemoryProviderHandoff?.claimRuntimeAdoptionReceipt?.sourcePacketId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.memory-client-workflow-receipt-source-packet.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime
    && analysis?.upstreamMemoryProviderHandoff?.present
    && analysis?.upstreamMemoryProviderHandoff?.acceptedForRuntime !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.runtime-accepted-with-memory-provider-blocker" });
  }
  if (!analysis?.upstreamMemoryAnalyticsExportState?.bundleId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.memory-analytics-export.missing" });
  }
  if (analysis?.upstreamMemoryAnalyticsExportState?.present
    && analysis?.upstreamMemoryAnalyticsExportState?.acceptedForClaimRuntime
    && analysis?.upstreamMemoryAnalyticsExportState?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-analytics-export-accepted-with-blockers" });
  }
  if (analysis?.upstreamMemoryAnalyticsExportState?.present
    && analysis?.upstreamMemoryAnalyticsExportState?.restartSafe
    && analysis?.upstreamMemoryProviderHandoff?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-analytics-export-restart-with-unsafe-provider" });
  }
  if (analysis?.upstreamMemoryAnalyticsExportState?.present
    && !analysis?.recovery?.upstreamMemoryAnalyticsExportCommands?.some((command) => (
      command.command === "persist-claim-memory-analytics-export"
    ))) {
    diagnostics.push({ level: "warning", code: "claim.analysis.memory-analytics-export-persist-command.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime
    && analysis?.upstreamMemoryAnalyticsExportState?.present
    && analysis?.upstreamMemoryAnalyticsExportState?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.runtime-accepted-with-memory-analytics-export-blocker" });
  }
  if (analysis?.upstreamMemoryAnalyticsExportState?.claimRuntimeAnalyticsDigest?.present
    && !analysis?.recovery?.upstreamMemoryClaimRuntimeAnalyticsCommands?.some((command) => (
      command.command === "adopt-memory-claim-runtime-analytics-digest"
    ))) {
    diagnostics.push({ level: "warning", code: "claim.analysis.memory-claim-runtime-analytics-command.missing" });
  }
  if (analysis?.upstreamMemoryAnalyticsExportState?.claimRuntimeAnalyticsDigest?.acceptedForClaimRuntime
    && analysis?.upstreamMemoryAnalyticsExportState?.claimRuntimeAnalyticsDigest?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-claim-runtime-analytics-accepted-with-blockers" });
  }
  if (analysis?.upstreamMemoryAnalyticsExportState?.claimRuntimeAnalyticsDigest?.restartSafe
    && analysis?.upstreamMemoryAnalyticsExportState?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-claim-runtime-analytics-restart-with-unsafe-export" });
  }
  if (analysis?.releaseEvidenceLedger?.releaseReady
    && analysis?.upstreamMemoryAnalyticsExportState?.claimRuntimeAnalyticsDigest?.present
    && analysis?.upstreamMemoryAnalyticsExportState?.claimRuntimeAnalyticsDigest?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.release-ledger-without-memory-runtime-analytics" });
  }
  if (!analysis?.upstreamMemoryClaimEvidenceState?.manifestId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.memory-claim-evidence.missing" });
  }
  if (analysis?.upstreamMemoryClaimEvidenceState?.present
    && analysis?.upstreamMemoryClaimEvidenceState?.acceptedForClaimRuntime
    && analysis?.upstreamMemoryClaimEvidenceState?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-claim-evidence-accepted-with-blockers" });
  }
  if (analysis?.upstreamMemoryClaimEvidenceState?.present
    && analysis?.upstreamMemoryClaimEvidenceState?.restartSafe
    && analysis?.upstreamMemoryAnalyticsExportState?.restartSafe === false) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-claim-evidence-restart-with-unsafe-export" });
  }
  if (analysis?.upstreamMemoryClaimEvidenceState?.present
    && analysis?.upstreamMemoryClaimEvidenceState?.missingClaimFacts?.length
    && analysis?.upstreamMemoryClaimEvidenceState?.acceptedForClaimRuntime) {
    diagnostics.push({ level: "error", code: "claim.analysis.memory-claim-evidence-accepted-with-missing-facts" });
  }
  if (analysis?.upstreamMemoryClaimEvidenceState?.present
    && !analysis?.recovery?.upstreamMemoryClaimEvidenceCommands?.some((command) => (
      command.command === "persist-claim-memory-evidence-dependency"
    ))) {
    diagnostics.push({ level: "warning", code: "claim.analysis.memory-claim-evidence-persist-command.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime
    && analysis?.upstreamMemoryClaimEvidenceState?.present
    && analysis?.upstreamMemoryClaimEvidenceState?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.runtime-accepted-with-memory-claim-evidence-blocker" });
  }
  if (!analysis?.releaseEvidenceLedger?.ledgerId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.release-ledger.missing" });
  }
  if (analysis?.releaseEvidenceLedger?.releaseReady
    && analysis?.releaseEvidenceLedger?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.release-ledger-ready-with-blockers" });
  }
  if (analysis?.releaseEvidenceLedger?.releaseReady
    && analysis?.downstreamStatusPacket?.acceptedForDownstream !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.release-ledger-without-downstream-runtime" });
  }
  if (analysis?.releaseEvidenceLedger?.releaseReady
    && analysis?.upstreamMemoryAnalyticsExportState?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.release-ledger-without-memory-analytics-export" });
  }
  if (analysis?.releaseEvidenceLedger?.releaseReady
    && analysis?.upstreamMemoryClaimEvidenceState?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.release-ledger-without-memory-claim-evidence" });
  }
  if (analysis?.releaseEvidenceLedger?.restartSafe
    && analysis?.releaseEvidenceLedger?.releaseGates?.some((gate) => gate.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "claim.analysis.release-ledger-restart-safe-with-unsafe-gate" });
  }
  if (!analysis?.releaseEvidenceLedger?.commands?.some((command) => command.command === "persist-claim-release-ledger")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.release-ledger-persist-command.missing" });
  }
  if (!analysis?.analyticsReportState?.reportId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.analytics-report.missing" });
  }
  if (analysis?.analyticsReportState?.acceptedForExport
    && analysis?.analyticsReportState?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.analytics-export-ready-with-blockers" });
  }
  if (analysis?.analyticsReportState?.acceptedForRuntimeReport
    && analysis?.releaseEvidenceLedger?.releaseReady !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.analytics-runtime-report-without-release-ledger" });
  }
  if (analysis?.analyticsReportState?.acceptedForRuntimeReport
    && analysis?.analyticsReportState?.unsafeChannels?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.analytics-runtime-report-unsafe" });
  }
  if (analysis?.analyticsReportState?.rows?.length < 10) {
    diagnostics.push({ level: "warning", code: "claim.analysis.analytics-report.rows-incomplete" });
  }
  if (!analysis?.analyticsReportState?.commands?.some((command) => command.command === "persist-claim-analytics-report")) {
    diagnostics.push({ level: "warning", code: "claim.analysis.analytics-report-persist-command.missing" });
  }
  if (!analysis?.analyticsEvidenceSnapshot?.snapshotId) {
    diagnostics.push({ level: "warning", code: "claim.analysis.analytics-evidence-snapshot.missing" });
  }
  if (analysis?.analyticsEvidenceSnapshot?.acceptedForExport
    && analysis?.analyticsEvidenceSnapshot?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "claim.analysis.analytics-evidence-export-ready-with-blockers" });
  }
  if (analysis?.analyticsEvidenceSnapshot?.acceptedForRuntimeReport
    && analysis?.analyticsReportState?.acceptedForRuntimeReport !== true) {
    diagnostics.push({ level: "error", code: "claim.analysis.analytics-evidence-runtime-without-report" });
  }
  if (analysis?.analyticsEvidenceSnapshot?.restartSafe
    && analysis?.analyticsEvidenceSnapshot?.evidenceRows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "claim.analysis.analytics-evidence-safe-with-unsafe-row" });
  }
  if (!analysis?.analyticsEvidenceSnapshot?.commands?.some((command) => (
    command.command === "persist-claim-analytics-evidence-snapshot"
  ))) {
    diagnostics.push({ level: "warning", code: "claim.analysis.analytics-evidence-persist-command.missing" });
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
    lifecycleControlState: analysis.lifecycleControlState,
    upstreamMemoryProviderHandoff: analysis.upstreamMemoryProviderHandoff,
    upstreamVerifierRecoveryExportState: analysis.upstreamVerifierRecoveryExportState,
    upstreamMemoryAnalyticsExportState: analysis.upstreamMemoryAnalyticsExportState,
    upstreamMemoryClaimEvidenceState: analysis.upstreamMemoryClaimEvidenceState,
    releaseEvidenceLedger: analysis.releaseEvidenceLedger,
    analyticsReportState: analysis.analyticsReportState,
    analyticsEvidenceSnapshot: analysis.analyticsEvidenceSnapshot,
    diagnostics: [...analysis.issues, ...validation.diagnostics],
  };
}
