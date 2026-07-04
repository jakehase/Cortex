import {
  buildMailchimpClaimOperationalHealth,
  buildMailchimpClaimReadinessPreview,
  buildMailchimpClaimStatusHandoff,
  compileMailchimpClaimContract,
  validateMailchimpClaimContract,
} from "./claims.mjs";

const APPROVAL_PROTOCOL = "aios.mailchimp.approval-contract.v1";
const ACCEPTANCE_RECEIPT_PROTOCOL = "aios.mailchimp.acceptance-receipt.v1";
const CLIENT_RUNTIME_ADOPTION_PROTOCOL = "aios.mailchimp.client-runtime-adoption.v1";

const APPROVAL_RULES = Object.freeze({
  campaign_send: Object.freeze({
    approvalId: "send",
    reason: "External Mailchimp send requires an operator approval before adapter handoff.",
    requiredForExternalWrite: true
  }),
  schedule_change: Object.freeze({
    approvalId: "schedule",
    reason: "Scheduling or rescheduling a Mailchimp campaign requires approval.",
    requiredForExternalWrite: true
  }),
  content_change: Object.freeze({
    approvalId: "content",
    reason: "Content changes must be approved before Mailchimp write handoff.",
    requiredForExternalWrite: true
  })
});

function compactString(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return compactString(value).toLowerCase().replaceAll("-", "_");
}

function stableList(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : String(value).split(",");
  return [...new Set(list.map(compactString).filter(Boolean))].sort();
}

function approvalKey(rule, source) {
  const tenantId = compactString(source.tenantId) || "tenant";
  const workspaceId = compactString(source.workspaceId) || "workspace";
  const requestId = compactString(source.requestId || source.sourceId || source.campaignId) || "request";
  return ["mailchimp.approval", tenantId, workspaceId, requestId, rule.approvalId].map(normalizeToken).join(".");
}

function normalizeApprovalRecord(record = {}) {
  const status = normalizeToken(record.status || (record.approved ? "approved" : ""));
  return {
    key: compactString(record.key || record.id),
    approvalId: normalizeToken(record.approvalId || record.kind || record.type),
    status: status || "unknown",
    approved: record.approved === true || status === "approved",
    approvedBy: compactString(record.approvedBy || record.actorId || record.user),
    approvedAt: compactString(record.approvedAt || record.timestamp)
  };
}

function inferApprovalKinds(source = {}) {
  const explicit = stableList(source.approvalKinds);
  if (explicit.length > 0) return explicit.map(normalizeToken);

  const kinds = new Set();
  const kind = normalizeToken(source.kind);
  if (kind === "campaign_send" || kind === "campaign_send_now" || source.externalWrite === true) {
    kinds.add("campaign_send");
  }
  if (source.sendAt || source.payload?.sendAt || source.scheduleChanged === true) {
    kinds.add("schedule_change");
  }
  if (source.templateId || source.payload?.templateId || source.contentChanged === true) {
    kinds.add("content_change");
  }
  return [...kinds].sort();
}

export function compileMailchimpApprovalContract(source = {}, options = {}) {
  const claimContract =
    source.claimContract?.protocol === "aios.mailchimp.claim-contract.v1"
      ? source.claimContract
      : compileMailchimpClaimContract(source, options.claimOptions ?? {});
  const claimValidation = validateMailchimpClaimContract(claimContract, source.runtime ?? {});
  const records = (source.approvals ?? source.approvalRecords ?? []).map(normalizeApprovalRecord);
  const byId = new Map(records.map((record) => [record.approvalId, record]));
  const requestedKinds = inferApprovalKinds(source);
  const approvals = requestedKinds.map((kind) => {
    const rule = APPROVAL_RULES[kind] ?? {
      approvalId: kind,
      reason: "Mailchimp adapter handoff requires approval for this operation.",
      requiredForExternalWrite: true
    };
    const record = byId.get(rule.approvalId) ?? byId.get(kind) ?? {};
    const key = compactString(record.key) || approvalKey(rule, {
      tenantId: claimContract.tenantId || source.tenantId,
      workspaceId: claimContract.workspaceId || source.workspaceId,
      requestId: claimContract.sourceId || source.requestId,
      campaignId: claimContract.campaignId || source.campaignId
    });
    return {
      key,
      approvalId: rule.approvalId,
      kind,
      status: record.approved ? "approved" : record.status === "denied" ? "denied" : "pending",
      approved: record.approved === true,
      approvedBy: record.approvedBy || "",
      approvedAt: record.approvedAt || "",
      requiredForExternalWrite: rule.requiredForExternalWrite,
      reason: rule.reason,
      restartSafe: record.approved === true
    };
  });
  const pending = approvals.filter((approval) => approval.status === "pending");
  const denied = approvals.filter((approval) => approval.status === "denied");
  const claimBlocked = claimValidation.passed !== true;

  return {
    protocol: APPROVAL_PROTOCOL,
    adapter: "mailchimp",
    tenantId: claimContract.tenantId,
    workspaceId: claimContract.workspaceId,
    sourceId: claimContract.sourceId,
    approvals,
    status:
      denied.length > 0
        ? "denied"
        : claimBlocked
          ? "waiting_for_claims"
          : pending.length > 0
            ? "pending_approval"
            : "approved",
    restartSafe: denied.length === 0 && pending.length === 0 && !claimBlocked,
    blockedByClaims: claimBlocked,
    pendingApprovals: pending.map((approval) => approval.key),
    deniedApprovals: denied.map((approval) => approval.key),
    recovery: [
      ...claimValidation.recovery,
      ...pending.map((approval) => ({
        code: "mailchimp.approval.pending",
        approvalKey: approval.key,
        approvalId: approval.approvalId,
        action: "request-operator-approval"
      })),
      ...denied.map((approval) => ({
        code: "mailchimp.approval.denied",
        approvalKey: approval.key,
        approvalId: approval.approvalId,
        action: "hold-for-operator"
      }))
    ],
    truthBoundary: {
      source: "mailchimp-approval-stdlib",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: APPROVAL_PROTOCOL
    }
  };
}

export function buildMailchimpApprovalCommands(contract = {}) {
  const approvals = Array.isArray(contract.approvals) ? contract.approvals : [];
  return {
    protocol: "aios.mailchimp.approval-command-plan.v1",
    adapter: "mailchimp",
    commands: approvals
      .filter((approval) => approval.status === "pending")
      .map((approval) => ({
        id: approval.key,
        type: "request-operator-approval",
        adapter: "mailchimp",
        approvalId: approval.approvalId,
        reason: approval.reason,
        idempotent: true,
        status: "pending_operator"
      }))
  };
}

export function buildMailchimpApprovalPreviewSummary(contract = {}, runtime = {}) {
  const normalized = contract.protocol === APPROVAL_PROTOCOL
    ? contract
    : compileMailchimpApprovalContract(contract, runtime.compileOptions ?? {});
  const validation = validateMailchimpApprovals(normalized);
  const commands = buildMailchimpApprovalCommands(normalized);
  const claimHealth = buildMailchimpClaimOperationalHealth(
    runtime.claimContract ?? contract.claimContract ?? normalized.claimContract ?? {
      protocol: "aios.mailchimp.claim-contract.v1",
      adapter: "mailchimp",
      tenantId: normalized.tenantId,
      workspaceId: normalized.workspaceId,
      sourceId: normalized.sourceId,
      claims: [],
      status: normalized.blockedByClaims ? "blocked" : "satisfied",
      restartSafe: !normalized.blockedByClaims,
      externalWritePermittedAfterVerification: false,
      blockedClaims: [],
      recovery: [],
      truthBoundary: {
        source: "mailchimp-approval-preview",
        externalWrites: false,
        requiresRuntimeAdapter: true,
        evaluatedAgainst: "aios.mailchimp.claim-contract.v1"
      }
    },
    runtime,
  );
  const claimPreview = buildMailchimpClaimReadinessPreview(
    runtime.claimContract ?? contract.claimContract ?? normalized.claimContract ?? {
      protocol: "aios.mailchimp.claim-contract.v1",
      adapter: "mailchimp",
      tenantId: normalized.tenantId,
      workspaceId: normalized.workspaceId,
      sourceId: normalized.sourceId,
      claims: [],
      status: normalized.blockedByClaims ? "blocked" : "satisfied",
      restartSafe: !normalized.blockedByClaims,
      externalWritePermittedAfterVerification: false,
      blockedClaims: [],
      recovery: [],
      truthBoundary: {
        source: "mailchimp-approval-preview",
        externalWrites: false,
        requiresRuntimeAdapter: true,
        evaluatedAgainst: "aios.mailchimp.claim-contract.v1"
      }
    },
    runtime,
  );
  const approvals = Array.isArray(normalized.approvals) ? normalized.approvals : [];
  const approved = approvals.filter((approval) => approval.status === "approved");
  const pending = approvals.filter((approval) => approval.status === "pending");
  const denied = approvals.filter((approval) => approval.status === "denied");
  const externalWriteApprovals = approvals.filter((approval) => approval.requiredForExternalWrite);
  const blockers = uniqueSorted([
    ...(normalized.blockedByClaims ? ["Mailchimp claims must be satisfied before approval handoff"] : []),
    ...pending.map((approval) => `approval pending: ${approval.approvalId}`),
    ...denied.map((approval) => `approval denied: ${approval.approvalId}`),
  ]);
  const acceptedRecords = approved.map((approval) => ({
    key: approval.key,
    approvalId: approval.approvalId,
    kind: approval.kind,
    approvedBy: approval.approvedBy || "operator",
    approvedAt: approval.approvedAt || "logical:accepted",
    restartSafe: approval.restartSafe === true,
  }));
  const visibleRows = approvals.map((approval) => {
    const command = commands.commands.find((item) => item.approvalId === approval.approvalId);
    return {
      key: approval.key,
      approvalId: approval.approvalId,
      kind: approval.kind,
      status: approval.status,
      badge: approval.status === "approved"
        ? "accepted"
        : approval.status === "denied" ? "blocked" : "review",
      reason: approval.reason,
      command: approval.status === "pending"
        ? "package.approval.request"
        : approval.status === "denied" ? "process.inspect" : null,
      commandId: command?.id ?? null,
      requiredForExternalWrite: approval.requiredForExternalWrite,
      restartSafe: approval.restartSafe,
    };
  });
  const nextAction = denied.length > 0
    ? "process.inspect"
    : normalized.blockedByClaims
      ? "process.verify"
      : pending.length > 0
        ? "package.approval.request"
        : "process.start";
  const status = validation.passed
    ? "accepted"
    : denied.length > 0
      ? "denied"
      : normalized.blockedByClaims
        ? "waiting_for_claims"
      : "awaiting_operator";
  const adoptionPlan = buildMailchimpApprovalAdoptionPlan({
    normalized,
    validation,
    claimPreview,
    pending,
    denied,
    approved,
    blockers,
    nextAction,
    status,
    commands,
    runtime,
  });
  const acceptanceReceipt = buildMailchimpAcceptanceReceipt(normalized, {
    validation,
    claimPreview,
    adoptionPlan,
    commands,
    blockers,
    nextAction,
    status,
    runtime,
  });
  const approvalAnalytics = buildMailchimpApprovalAnalyticsSnapshot({
    normalized,
    validation,
    claimPreview,
    claimHealth,
    commands,
    approvals,
    approved,
    pending,
    denied,
    blockers,
    nextAction,
    status,
    adoptionPlan,
    acceptanceReceipt,
    runtime,
  });

  return {
    protocol: "aios.mailchimp.approval-preview-summary.v1",
    adapter: "mailchimp",
    previewId: `mailchimp_preview_${stableId([
      normalized.tenantId,
      normalized.workspaceId,
      normalized.sourceId,
      approvals.map((approval) => `${approval.approvalId}:${approval.status}`).join("|"),
    ])}`,
    contractProtocol: normalized.protocol,
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
    status,
    ready: validation.passed,
    nextAction,
    message: blockers.length > 0
      ? blockers.join("; ")
      : "Mailchimp approval preview is accepted for local adapter handoff.",
    counters: {
      required: approvals.length,
      approved: approved.length,
      pending: pending.length,
      denied: denied.length,
      externalWriteApprovals: externalWriteApprovals.length,
      acceptedRecords: acceptedRecords.length,
      commandCount: commands.commands.length,
      blockerCount: blockers.length,
      adoptionSteps: adoptionPlan.steps.length,
      adoptionReadySteps: adoptionPlan.steps.filter((step) => step.ready).length,
      timelineEvents: approvalAnalytics.timeline.length,
      exportSnapshots: approvalAnalytics.historySnapshots.length,
      healthErrors: claimHealth.actionableErrors.length,
    },
    approvalAnalytics,
    claimPreview,
    claimHealth,
    acceptance: {
      required: approvals.length > 0,
      accepted: validation.passed,
      acceptedBy: acceptedRecords.map((record) => record.approvedBy).filter(Boolean).sort()[0] ?? null,
      acceptedAt: acceptedRecords.map((record) => record.approvedAt).filter(Boolean).sort().at(-1) ?? null,
      command: validation.passed ? null : nextAction,
      records: acceptedRecords,
    },
    rows: visibleRows,
    exportSummary: {
      localOnly: true,
      readyForExport: validation.passed,
      redaction: runtime.redaction ?? "receipt-subjects",
      subjects: approvals.map((approval) => approval.approvalId),
      blockedReasons: blockers,
      exportId: approvalAnalytics.exportReadySummary.exportId,
      timelineEvents: approvalAnalytics.timeline.length,
      historySnapshotCount: approvalAnalytics.historySnapshots.length,
      healthMode: claimHealth.mode,
    },
    adoptionPlan,
    acceptanceReceipt,
    nextSteps: blockers.length === 0
      ? [{
        action: "process.start",
        label: "Start Mailchimp handoff",
        reason: "approval and claim contracts are satisfied",
      }]
      : blockers.map((reason) => ({
        action: nextAction,
        label: reason.startsWith("approval denied")
          ? "Inspect denied approval"
          : reason.startsWith("approval pending")
            ? "Request operator approval"
            : "Resolve claim blocker",
        reason,
      })),
  };
}

export function createMailchimpApprovalStatusHandoff(contract = {}, runtime = {}) {
  const normalized = contract.protocol === APPROVAL_PROTOCOL
    ? contract
    : compileMailchimpApprovalContract(contract, runtime.compileOptions ?? {});
  const claimHandoff = buildMailchimpClaimStatusHandoff(
    runtime.claimContract ?? {
      protocol: "aios.mailchimp.claim-contract.v1",
      adapter: "mailchimp",
      tenantId: normalized.tenantId,
      workspaceId: normalized.workspaceId,
      sourceId: normalized.sourceId,
      claims: [],
      status: normalized.blockedByClaims ? "blocked" : "satisfied",
      restartSafe: !normalized.blockedByClaims,
      externalWritePermittedAfterVerification: false,
      blockedClaims: [],
      recovery: [],
      truthBoundary: {
        source: "mailchimp-approval-status-handoff",
        externalWrites: false,
        requiresRuntimeAdapter: true,
        evaluatedAgainst: "aios.mailchimp.claim-contract.v1"
      }
    },
    runtime,
  );
  const validation = validateMailchimpApprovals(normalized);
  const commands = buildMailchimpApprovalCommands(normalized);
  const previewSummary = buildMailchimpApprovalPreviewSummary(normalized, runtime);
  const pending = normalized.approvals.filter((approval) => approval.status === "pending");
  const denied = normalized.approvals.filter((approval) => approval.status === "denied");
  const approved = normalized.approvals.filter((approval) => approval.status === "approved");
  const status = denied.length > 0
    ? "approval_denied"
    : normalized.blockedByClaims
      ? "waiting_for_claims"
      : pending.length > 0
        ? "approval_required"
        : "approval_ready";
  const nextAction = denied.length > 0
    ? "process.inspect"
    : normalized.blockedByClaims
      ? claimHandoff.nextAction
      : pending.length > 0
        ? "package.approval.request"
        : "process.start";
  const blockers = uniqueSorted([
    ...claimHandoff.blockedReasons,
    ...pending.map((approval) => `approval pending: ${approval.approvalId}`),
    ...denied.map((approval) => `approval denied: ${approval.approvalId}`),
  ]);
  const externalHandoff = createMailchimpExternalHandoffState({
    normalized,
    validation,
    previewSummary,
    claimHandoff,
    status,
    nextAction,
    blockers,
    approved,
    pending,
    denied,
    runtime,
  });
  const clientRuntimeAdoption = createMailchimpClientRuntimeAdoptionReceipt({
    normalized,
    validation,
    previewSummary,
    claimHandoff,
    externalHandoff,
    status,
    nextAction,
    blockers,
    runtime,
  });

  return {
    protocol: "aios.mailchimp.approval-status-handoff.v1",
    adapter: "mailchimp",
    contractProtocol: normalized.protocol,
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
    status,
    ready: validation.passed,
    restartSafe: validation.passed && normalized.restartSafe,
    adapterStatus: validation.passed ? "adapter-approval-ready" : "adapter-approval-blocked",
    nextAction,
    counts: {
      required: normalized.approvals.length,
      approved: approved.length,
      pending: pending.length,
      denied: denied.length,
      commandCount: commands.commands.length,
      previewBlockers: previewSummary.counters.blockerCount,
      acceptedRecords: previewSummary.counters.acceptedRecords,
    },
    preview: previewSummary,
    approvalAnalytics: previewSummary.approvalAnalytics,
    adoptionPlan: previewSummary.adoptionPlan,
    acceptanceReceipt: previewSummary.acceptanceReceipt,
    clientRuntimeAdoption,
    approvals: normalized.approvals.map((approval) => ({
      key: approval.key,
      approvalId: approval.approvalId,
      kind: approval.kind,
      status: approval.status,
      approved: approval.approved,
      requiredForExternalWrite: approval.requiredForExternalWrite,
      restartSafe: approval.restartSafe,
    })),
    claimHandoff: {
      status: claimHandoff.status,
      ready: claimHandoff.ready,
      nextAction: claimHandoff.nextAction,
      blockedReasons: claimHandoff.blockedReasons,
      missingFacts: claimHandoff.verifier.missingFacts,
      missingEvidence: claimHandoff.verifier.missingEvidence,
      preview: previewSummary.claimPreview,
      health: previewSummary.claimHealth,
    },
    externalHandoff,
    commands: commands.commands,
    blockedReasons: blockers,
    recovery: [
      ...claimHandoff.recovery,
      ...pending.map((approval) => ({
        code: "mailchimp.approval.pending",
        approvalKey: approval.key,
        approvalId: approval.approvalId,
        command: "package.approval.request",
        restartSafe: false,
        action: "request-operator-approval",
      })),
      ...denied.map((approval) => ({
        code: "mailchimp.approval.denied",
        approvalKey: approval.key,
        approvalId: approval.approvalId,
        command: "process.inspect",
        restartSafe: false,
        action: "hold-for-operator",
      })),
    ],
    truthBoundary: {
      localOnly: true,
      externalWritesPermitted: validation.passed,
      externalWritesObserved: [],
      evaluatedAgainst: normalized.truthBoundary.evaluatedAgainst,
    },
  };
}

function buildMailchimpApprovalAnalyticsSnapshot(context) {
  const {
    normalized,
    validation,
    claimPreview,
    claimHealth,
    commands,
    approvals,
    approved,
    pending,
    denied,
    blockers,
    nextAction,
    status,
    adoptionPlan,
    acceptanceReceipt,
    runtime,
  } = context;
  const generatedAt = compactString(runtime.generatedAt ?? runtime.checkedAt) || "logical:approval.analytics";
  const scope = {
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
  };
  const counters = {
    required: approvals.length,
    approved: approved.length,
    pending: pending.length,
    denied: denied.length,
    commands: commands.commands.length,
    blockers: blockers.length,
    claimRows: claimPreview.rows?.length ?? 0,
    claimReadyRows: claimPreview.rows?.filter((row) => row.status === "ready").length ?? 0,
    claimHealthErrors: claimHealth.actionableErrors.length,
    adoptionSteps: adoptionPlan.steps?.length ?? 0,
    adoptionReadySteps: adoptionPlan.steps?.filter((step) => step.ready).length ?? 0,
    acceptanceRecords: acceptanceReceipt.acceptedRecords?.length ?? 0,
  };
  const timeline = [
    {
      sequence: 1,
      at: generatedAt,
      source: "claim-health",
      status: claimHealth.mode,
      action: claimHealth.primaryAction,
      message: claimHealth.actionableErrors[0]?.message ?? "claim operational health evaluated",
    },
    {
      sequence: 2,
      at: "logical:approval.validation",
      source: "approval-validation",
      status: validation.status,
      action: validation.passed ? "process.start" : nextAction,
      message: blockers[0] ?? "approval validation accepted",
    },
    ...approvals.map((approval, index) => ({
      sequence: index + 3,
      at: approval.approvedAt || `logical:approval.${approval.approvalId}`,
      source: "operator-approval",
      status: approval.status,
      action: approval.status === "approved"
        ? "accepted"
        : approval.status === "denied"
          ? "process.inspect"
          : "package.approval.request",
      approvalId: approval.approvalId,
      approvalKey: approval.key,
      message: approval.status === "approved"
        ? `approval accepted: ${approval.approvalId}`
        : `approval ${approval.status}: ${approval.approvalId}`,
    })),
    {
      sequence: approvals.length + 3,
      at: "logical:approval.adoption",
      source: "runtime-adoption",
      status: adoptionPlan.status,
      action: adoptionPlan.nextAction,
      message: adoptionPlan.blockedReasons?.[0] ?? "approval runtime adoption evaluated",
    },
  ];
  const exportId = `mailchimp_approval_export_${stableId([
    normalized.tenantId,
    normalized.workspaceId,
    normalized.sourceId,
    status,
    JSON.stringify(counters),
    blockers.join("|"),
  ])}`;
  const historySnapshots = timeline.map((event) => ({
    key: `mailchimp_approval_history_${stableId([
      exportId,
      event.sequence,
      event.source,
      event.status,
    ])}`,
    sequence: event.sequence,
    at: event.at,
    status: event.status,
    source: event.source,
    approvalId: event.approvalId ?? null,
    approvalKey: event.approvalKey ?? null,
    ready: validation.passed === true && blockers.length === 0,
    restartSafe: normalized.restartSafe === true,
  }));

  return {
    protocol: "aios.mailchimp.approval-analytics-snapshot.v1",
    adapter: "mailchimp",
    scope,
    generatedAt,
    status,
    ready: validation.passed === true && blockers.length === 0,
    nextAction,
    counters,
    timeline,
    historySnapshots,
    exportReadySummary: {
      exportId,
      localOnly: true,
      readyForExport: validation.passed === true,
      redaction: runtime.redaction ?? "receipt-subjects",
      subjects: approvals.map((approval) => approval.approvalId),
      blockedReasons: blockers,
      healthMode: claimHealth.mode,
      acceptanceReceiptId: acceptanceReceipt.receiptId ?? null,
    },
    truthBoundary: {
      source: "mailchimp-approval-analytics-snapshot",
      externalWrites: false,
      requiresRuntimeAdapter: false,
      evaluatedAgainst: normalized.truthBoundary.evaluatedAgainst,
    },
  };
}

export function buildMailchimpExternalHandoffState(handoffOrContract = {}, runtime = {}) {
  if (handoffOrContract.protocol === "aios.mailchimp.approval-status-handoff.v1") {
    return normalizeMailchimpExternalHandoffState(handoffOrContract.externalHandoff, handoffOrContract, runtime);
  }

  const normalized = handoffOrContract.protocol === APPROVAL_PROTOCOL
    ? handoffOrContract
    : compileMailchimpApprovalContract(handoffOrContract, runtime.compileOptions ?? {});
  const validation = validateMailchimpApprovals(normalized);
  const previewSummary = buildMailchimpApprovalPreviewSummary(normalized, runtime);
  const claimHandoff = buildMailchimpClaimStatusHandoff(
    runtime.claimContract ?? {
      protocol: "aios.mailchimp.claim-contract.v1",
      adapter: "mailchimp",
      tenantId: normalized.tenantId,
      workspaceId: normalized.workspaceId,
      sourceId: normalized.sourceId,
      claims: [],
      status: normalized.blockedByClaims ? "blocked" : "satisfied",
      restartSafe: !normalized.blockedByClaims,
      externalWritePermittedAfterVerification: false,
      blockedClaims: [],
      recovery: [],
      truthBoundary: {
        source: "mailchimp-external-handoff-state",
        externalWrites: false,
        requiresRuntimeAdapter: true,
        evaluatedAgainst: "aios.mailchimp.claim-contract.v1"
      }
    },
    runtime,
  );
  const pending = normalized.approvals.filter((approval) => approval.status === "pending");
  const denied = normalized.approvals.filter((approval) => approval.status === "denied");
  const approved = normalized.approvals.filter((approval) => approval.status === "approved");
  const status = denied.length > 0
    ? "approval_denied"
    : normalized.blockedByClaims
      ? "waiting_for_claims"
      : pending.length > 0
        ? "approval_required"
        : "approval_ready";
  const nextAction = denied.length > 0
    ? "process.inspect"
    : normalized.blockedByClaims
      ? claimHandoff.nextAction
      : pending.length > 0
        ? "package.approval.request"
        : "process.start";
  const blockers = uniqueSorted([
    ...claimHandoff.blockedReasons,
    ...pending.map((approval) => `approval pending: ${approval.approvalId}`),
    ...denied.map((approval) => `approval denied: ${approval.approvalId}`),
  ]);

  return createMailchimpExternalHandoffState({
    normalized,
    validation,
    previewSummary,
    claimHandoff,
    status,
    nextAction,
    blockers,
    approved,
    pending,
    denied,
    runtime,
  });
}

export function buildMailchimpClientRuntimeAdoptionReceipt(handoffOrContract = {}, runtime = {}) {
  if (handoffOrContract.protocol === "aios.mailchimp.approval-status-handoff.v1") {
    return normalizeMailchimpClientRuntimeAdoptionReceipt(
      handoffOrContract.clientRuntimeAdoption,
      handoffOrContract,
      runtime,
    );
  }

  const handoff = createMailchimpApprovalStatusHandoff(handoffOrContract, runtime);
  return normalizeMailchimpClientRuntimeAdoptionReceipt(handoff.clientRuntimeAdoption, handoff, runtime);
}

function createMailchimpExternalHandoffState(context) {
  const {
    normalized,
    validation,
    previewSummary,
    claimHandoff,
    status,
    nextAction,
    blockers,
    approved,
    pending,
    denied,
    runtime,
  } = context;
  const adoptionPlan = previewSummary.adoptionPlan ?? {};
  const acceptanceReceipt = previewSummary.acceptanceReceipt
    ?? buildMailchimpAcceptanceReceipt(normalized, {
      validation,
      claimPreview: previewSummary.claimPreview,
      adoptionPlan,
      commands: { commands: [] },
      blockers,
      nextAction,
      status,
      runtime,
    });
  const acceptedRecords = previewSummary.acceptance?.records ?? [];
  const ready = validation.passed === true
    && adoptionPlan.ready === true
    && claimHandoff.ready === true
    && blockers.length === 0;
  const operator = compactString(
    runtime.operatorId
      ?? runtime.acceptedBy
      ?? runtime.actorId
      ?? acceptedRecords[0]?.approvedBy
  ) || null;
  const approvalFingerprint = stableId([
    normalized.tenantId,
    normalized.workspaceId,
    normalized.sourceId,
    normalized.approvals.map((approval) => [
      approval.approvalId,
      approval.status,
      approval.approvedBy,
      approval.approvedAt,
    ].join(":")).join("|"),
    claimHandoff.status,
  ]);
  const idempotencyKey = stableId([
    "mailchimp.external-handoff",
    normalized.tenantId,
    normalized.workspaceId,
    normalized.sourceId,
    approvalFingerprint,
  ]);
  const receiptId = `mailchimp_handoff_${stableId([
    normalized.tenantId,
    normalized.workspaceId,
    normalized.sourceId,
    idempotencyKey,
    status,
  ])}`;
  const command = ready ? "process.start" : nextAction;
  const persistedStatus = ready
    ? "ready_for_adapter"
    : denied.length > 0
      ? "blocked_denied"
      : pending.length > 0
        ? "blocked_pending_approval"
        : claimHandoff.ready !== true
          ? "blocked_claims"
          : "blocked";

  return {
    protocol: "aios.mailchimp.external-handoff-state.v1",
    adapter: "mailchimp",
    receiptId,
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
    status: persistedStatus,
    ready,
    command,
    nextAction: command,
    restartSafe: ready && normalized.restartSafe === true && adoptionPlan.handoff?.restartSafe === true,
    idempotencyKey,
    approvalFingerprint,
    operator,
    acceptedAt: acceptedRecords
      .map((record) => record.approvedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null,
    sync: {
      checkpoint: compactString(runtime.checkpoint ?? runtime.providerCheckpoint) || receiptId,
      cursor: compactString(runtime.cursor ?? runtime.providerCursor),
      mode: ready ? "external-write-armed" : "local-preview",
      externalWrite: {
        permitted: ready,
        observed: [],
        operation: "mailchimp.campaign.handoff",
      },
    },
    approvalState: {
      required: normalized.approvals.length,
      approved: approved.length,
      pending: pending.map((approval) => approval.approvalId),
      denied: denied.map((approval) => approval.approvalId),
      acceptedRecords,
      acceptanceReceiptId: acceptanceReceipt.receiptId,
    },
    acceptanceReceipt,
    claimState: {
      status: claimHandoff.status,
      ready: claimHandoff.ready,
      missingFacts: claimHandoff.verifier?.missingFacts ?? [],
      missingEvidence: claimHandoff.verifier?.missingEvidence ?? [],
    },
    persistence: {
      localOnly: true,
      stateKey: [
        normalized.tenantId || "tenant",
        normalized.workspaceId || "workspace",
        normalized.sourceId || "source",
        receiptId,
      ].join("/"),
      resumeToken: stableId([
        receiptId,
        idempotencyKey,
        persistedStatus,
        command,
      ]),
      command,
      blockedReasons: blockers,
    },
    nextSteps: ready
      ? [{
        action: "process.start",
        label: "Start Mailchimp adapter handoff",
        reason: "approval and claim contracts are accepted and restart-safe",
      }]
      : blockers.map((reason) => ({
        action: command,
        label: reason.startsWith("approval pending")
          ? "Request operator approval"
          : reason.startsWith("approval denied")
            ? "Inspect denied approval"
            : "Resolve claim blocker",
        reason,
      })),
    truthBoundary: {
      localOnly: true,
      externalWritesPermitted: ready,
      externalWritesObserved: [],
      evaluatedAgainst: normalized.truthBoundary.evaluatedAgainst,
    },
  };
}

function createMailchimpClientRuntimeAdoptionReceipt(context) {
  const {
    normalized,
    validation,
    previewSummary,
    claimHandoff,
    externalHandoff,
    status,
    nextAction,
    blockers,
    runtime,
  } = context;
  const acceptanceReceipt = previewSummary.acceptanceReceipt ?? externalHandoff.acceptanceReceipt ?? {};
  const adoptionPlan = previewSummary.adoptionPlan ?? {};
  const command = externalHandoff.command ?? (validation.passed ? "process.start" : nextAction);
  const blockedReasons = uniqueSorted([
    ...blockers,
    ...(acceptanceReceipt.validationSummary?.blockedReasons ?? []),
    ...(externalHandoff.persistence?.blockedReasons ?? []),
    ...(previewSummary.localOnly === false ? ["approval preview must remain local-only"] : []),
    ...(acceptanceReceipt.localOnly === false ? ["acceptance receipt must remain local-only"] : []),
    ...(externalHandoff.persistence?.localOnly === false ? ["external handoff persistence must remain local-only"] : []),
  ]);
  const ready = validation.passed === true
    && previewSummary.ready === true
    && claimHandoff.ready === true
    && adoptionPlan.ready === true
    && externalHandoff.ready === true
    && acceptanceReceipt.ready === true
    && blockedReasons.length === 0;
  const scope = {
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
  };
  const statusToken = stableId([
    normalized.tenantId,
    normalized.workspaceId,
    normalized.sourceId,
    previewSummary.previewId,
    acceptanceReceipt.receiptId,
    externalHandoff.receiptId,
    command,
    ready ? "ready" : status,
  ]);
  const receiptId = `mailchimp_client_adopt_${stableId([
    normalized.tenantId,
    normalized.workspaceId,
    normalized.sourceId,
    statusToken,
  ])}`;
  const resumeToken = stableId([
    receiptId,
    externalHandoff.idempotencyKey,
    acceptanceReceipt.idempotencyKey,
    statusToken,
  ]);

  return {
    protocol: CLIENT_RUNTIME_ADOPTION_PROTOCOL,
    adapter: "mailchimp",
    receiptId,
    scope,
    status: ready
      ? "adopted"
      : status === "approval_denied"
        ? "blocked_denied"
        : status === "approval_required"
          ? "awaiting_operator"
          : status === "waiting_for_claims"
            ? "waiting_for_claims"
            : "blocked",
    ready,
    restartSafe: ready
      && normalized.restartSafe === true
      && acceptanceReceipt.restartSafe === true
      && externalHandoff.restartSafe === true,
    localOnly: true,
    command: ready ? "process.start" : command,
    nextAction: ready ? "process.start" : nextAction,
    idempotencyKey: externalHandoff.idempotencyKey ?? acceptanceReceipt.idempotencyKey ?? resumeToken,
    statusToken,
    operator: externalHandoff.operator ?? acceptanceReceipt.operator ?? null,
    acceptedAt: externalHandoff.acceptedAt ?? acceptanceReceipt.acceptedAt ?? null,
    preview: {
      previewId: previewSummary.previewId,
      status: previewSummary.status,
      ready: previewSummary.ready === true,
      blockerCount: previewSummary.counters?.blockerCount ?? blockedReasons.length,
    },
    receipts: {
      acceptanceReceiptId: acceptanceReceipt.receiptId ?? null,
      externalHandoffReceiptId: externalHandoff.receiptId ?? null,
      approvalFingerprint: externalHandoff.approvalFingerprint ?? acceptanceReceipt.fingerprint ?? null,
    },
    clientState: {
      visibleStatus: ready ? "ready-to-start" : previewSummary.status,
      primaryCommand: ready ? "process.start" : nextAction,
      disabledReason: ready ? null : blockedReasons[0] ?? "Mailchimp runtime adoption is blocked",
      badge: ready ? "armed" : blockedReasons.length > 0 ? "blocked" : "review",
      resumeToken,
    },
    persistence: {
      localOnly: true,
      stateKey: [
        normalized.tenantId || "tenant",
        normalized.workspaceId || "workspace",
        normalized.sourceId || "source",
        receiptId,
      ].join("/"),
      resumeToken,
      command: ready ? "process.start" : nextAction,
      checkpoint: externalHandoff.sync?.checkpoint ?? compactString(runtime.checkpoint ?? runtime.providerCheckpoint),
      blockedReasons,
    },
    truthBoundary: {
      localOnly: true,
      externalWritesPermitted: ready,
      externalWritesObserved: [],
      evaluatedAgainst: normalized.truthBoundary?.evaluatedAgainst ?? APPROVAL_PROTOCOL,
    },
    validationSummary: {
      valid: ready,
      errors: blockedReasons,
      warnings: [],
      blockedReasons,
      checked: {
        previewReady: previewSummary.ready === true,
        claimsReady: claimHandoff.ready === true,
        adoptionReady: adoptionPlan.ready === true,
        acceptanceReady: acceptanceReceipt.ready === true,
        externalHandoffReady: externalHandoff.ready === true,
        command,
      },
    },
    nextSteps: ready
      ? [{
        action: "process.start",
        label: "Start Mailchimp adapter handoff",
        reason: "client runtime adoption is local, restart-safe, and idempotent",
      }]
      : blockedReasons.map((reason) => ({
        action: nextAction,
        label: reason.startsWith("approval pending")
          ? "Request operator approval"
          : reason.startsWith("approval denied")
            ? "Inspect denied approval"
            : "Resolve Mailchimp runtime adoption blocker",
        reason,
      })),
  };
}

function normalizeMailchimpClientRuntimeAdoptionReceipt(receipt, handoff, runtime) {
  const fallback = createMailchimpClientRuntimeAdoptionReceipt({
    normalized: {
      tenantId: handoff.tenantId,
      workspaceId: handoff.workspaceId,
      sourceId: handoff.sourceId,
      restartSafe: handoff.restartSafe === true,
      truthBoundary: handoff.truthBoundary ?? {},
    },
    validation: { passed: handoff.ready === true },
    previewSummary: handoff.preview ?? {
      previewId: null,
      status: handoff.status,
      ready: handoff.ready === true,
      counters: { blockerCount: handoff.blockedReasons?.length ?? 0 },
      adoptionPlan: handoff.adoptionPlan,
      acceptanceReceipt: handoff.acceptanceReceipt,
    },
    claimHandoff: handoff.claimHandoff ?? { ready: false },
    externalHandoff: handoff.externalHandoff ?? {},
    status: handoff.status,
    nextAction: handoff.nextAction,
    blockers: handoff.blockedReasons ?? [],
    runtime,
  });
  const blockedReasons = uniqueSorted([
    ...(receipt?.validationSummary?.blockedReasons ?? []),
    ...(receipt?.persistence?.blockedReasons ?? []),
    ...(handoff.blockedReasons ?? []),
  ]);
  const ready = receipt?.ready === true
    && handoff.ready === true
    && blockedReasons.length === 0;

  return {
    ...fallback,
    ...(receipt ?? {}),
    ready,
    restartSafe: ready && receipt?.restartSafe === true && handoff.restartSafe === true,
    localOnly: receipt?.localOnly !== false
      && receipt?.persistence?.localOnly !== false
      && receipt?.truthBoundary?.localOnly !== false,
    command: ready ? "process.start" : receipt?.command ?? handoff.nextAction,
    nextAction: ready ? "process.start" : receipt?.nextAction ?? handoff.nextAction,
    persistence: {
      ...fallback.persistence,
      ...(receipt?.persistence ?? {}),
      localOnly: receipt?.persistence?.localOnly !== false,
      blockedReasons,
    },
    truthBoundary: {
      ...fallback.truthBoundary,
      ...(receipt?.truthBoundary ?? {}),
      localOnly: receipt?.truthBoundary?.localOnly !== false,
      externalWritesPermitted: ready,
      externalWritesObserved: receipt?.truthBoundary?.externalWritesObserved ?? [],
    },
    validationSummary: {
      ...fallback.validationSummary,
      ...(receipt?.validationSummary ?? {}),
      valid: ready,
      errors: blockedReasons,
      blockedReasons,
    },
  };
}

export function buildMailchimpAcceptanceReceipt(contract = {}, context = {}) {
  const normalized = contract.protocol === APPROVAL_PROTOCOL
    ? contract
    : compileMailchimpApprovalContract(contract, context.runtime?.compileOptions ?? {});
  const approvals = Array.isArray(normalized.approvals) ? normalized.approvals : [];
  const approved = approvals.filter((approval) => approval.status === "approved");
  const pending = approvals.filter((approval) => approval.status === "pending");
  const denied = approvals.filter((approval) => approval.status === "denied");
  const claimPreview = context.claimPreview ?? buildMailchimpClaimReadinessPreview(
    context.runtime?.claimContract ?? {
      protocol: "aios.mailchimp.claim-contract.v1",
      adapter: "mailchimp",
      tenantId: normalized.tenantId,
      workspaceId: normalized.workspaceId,
      sourceId: normalized.sourceId,
      claims: [],
      status: normalized.blockedByClaims ? "blocked" : "satisfied",
      restartSafe: !normalized.blockedByClaims,
      externalWritePermittedAfterVerification: false,
      blockedClaims: [],
      recovery: [],
      truthBoundary: {
        source: "mailchimp-acceptance-receipt",
        externalWrites: false,
        requiresRuntimeAdapter: true,
        evaluatedAgainst: "aios.mailchimp.claim-contract.v1"
      }
    },
    context.runtime ?? {},
  );
  const validation = context.validation ?? validateMailchimpApprovals(normalized);
  const adoptionPlan = context.adoptionPlan ?? buildEmptyAcceptanceAdoptionPlan(normalized, context);
  const commandPlan = context.commands?.commands ?? buildMailchimpApprovalCommands(normalized).commands;
  const blockers = uniqueSorted([
    ...(context.blockers ?? []),
    ...(validation.validationSummary?.blockedReasons ?? []),
    ...(claimPreview.blockedReasons ?? claimPreview.validationSummary?.blockedReasons ?? []),
    ...(adoptionPlan.blockedReasons ?? []),
  ]);
  const acceptedRecords = approved.map((approval) => ({
    key: approval.key,
    approvalId: approval.approvalId,
    kind: approval.kind,
    acceptedBy: approval.approvedBy
      || compactString(context.runtime?.operatorId ?? context.runtime?.acceptedBy ?? context.runtime?.actorId)
      || "operator",
    acceptedAt: approval.approvedAt || compactString(context.runtime?.acceptedAt) || "logical:accepted",
    restartSafe: approval.restartSafe === true,
  }));
  const acceptedSubjects = acceptedRecords.map((record) => record.approvalId);
  const scope = {
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
  };
  const ready = validation.passed === true
    && claimPreview.ready === true
    && adoptionPlan.ready === true
    && blockers.length === 0;
  const nextAction = ready
    ? "process.start"
    : context.nextAction
      ?? (denied.length > 0 ? "process.inspect" : pending.length > 0 ? "package.approval.request" : claimPreview.nextAction);
  const fingerprint = stableId([
    normalized.tenantId,
    normalized.workspaceId,
    normalized.sourceId,
    approvals.map((approval) => [
      approval.approvalId,
      approval.status,
      approval.approvedBy,
      approval.approvedAt,
      approval.restartSafe ? "restart-safe" : "volatile",
    ].join(":")).join("|"),
    claimPreview.status,
    adoptionPlan.status,
    blockers.join("|"),
  ]);
  const receiptId = `mailchimp_accept_${stableId([
    normalized.tenantId,
    normalized.workspaceId,
    normalized.sourceId,
    fingerprint,
  ])}`;

  return {
    protocol: ACCEPTANCE_RECEIPT_PROTOCOL,
    adapter: "mailchimp",
    receiptId,
    scope,
    status: ready
      ? "accepted"
      : denied.length > 0
        ? "blocked_denied"
        : pending.length > 0
          ? "awaiting_operator"
          : claimPreview.ready !== true
            ? "waiting_for_claims"
            : "blocked",
    ready,
    restartSafe: ready && normalized.restartSafe === true && acceptedRecords.every((record) => record.restartSafe),
    localOnly: true,
    nextAction,
    idempotencyKey: stableId([
      "mailchimp.acceptance",
      normalized.tenantId,
      normalized.workspaceId,
      normalized.sourceId,
      fingerprint,
    ]),
    fingerprint,
    acceptedSubjects,
    acceptedRecords,
    operator: acceptedRecords.map((record) => record.acceptedBy).filter(Boolean).sort()[0] ?? null,
    acceptedAt: acceptedRecords.map((record) => record.acceptedAt).filter(Boolean).sort().at(-1) ?? null,
    counters: {
      required: approvals.length,
      approved: approved.length,
      pending: pending.length,
      denied: denied.length,
      claimRows: claimPreview.rows?.length ?? 0,
      commands: commandPlan.length,
      blockers: blockers.length,
    },
    validationSummary: {
      valid: ready,
      errors: blockers,
      warnings: validation.validationSummary?.duplicateKeys?.length > 0
        ? validation.validationSummary.duplicateKeys.map((key) => `duplicate approval key: ${key}`)
        : [],
      blockedReasons: blockers,
      checked: {
        claimPreviewReady: claimPreview.ready === true,
        adoptionPlanReady: adoptionPlan.ready === true,
        externalWriteApprovals: approvals.filter((approval) => approval.requiredForExternalWrite).length,
        acceptedRecords: acceptedRecords.length,
      },
    },
    auditHandoff: {
      localOnly: true,
      redaction: context.runtime?.redaction ?? "receipt-subjects",
      subjects: acceptedSubjects,
      command: ready ? "process.start" : nextAction,
      externalWritesPermitted: ready,
      evaluatedAgainst: normalized.truthBoundary?.evaluatedAgainst ?? APPROVAL_PROTOCOL,
    },
    nextSteps: ready
      ? [{
        action: "process.start",
        label: "Start Mailchimp adapter handoff",
        reason: "operator acceptance receipt is complete and restart-safe",
      }]
      : blockers.map((reason) => ({
        action: nextAction,
        label: reason.startsWith("approval denied")
          ? "Inspect denied approval"
          : reason.startsWith("approval pending") || reason.includes("awaiting")
            ? "Request operator approval"
            : "Resolve acceptance blocker",
        reason,
      })),
  };
}

function buildEmptyAcceptanceAdoptionPlan(normalized, context) {
  const blockers = uniqueSorted(context.blockers ?? []);
  return {
    protocol: "aios.mailchimp.approval-adoption-plan.v1",
    adapter: "mailchimp",
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
    status: blockers.length === 0 ? "ready_to_adopt" : "blocked",
    ready: blockers.length === 0,
    nextAction: context.nextAction ?? (blockers.length === 0 ? "process.start" : "process.inspect"),
    localOnly: true,
    blockedReasons: blockers,
    handoff: {
      externalWritesPermitted: blockers.length === 0,
      externalWritesObserved: [],
      evaluatedAgainst: normalized.truthBoundary?.evaluatedAgainst ?? APPROVAL_PROTOCOL,
      restartSafe: normalized.restartSafe === true,
    },
  };
}

function normalizeMailchimpExternalHandoffState(state, handoff, runtime) {
  if (state?.protocol === "aios.mailchimp.external-handoff-state.v1") {
    const blockedReasons = uniqueSorted([
      ...(state.persistence?.blockedReasons ?? []),
      ...(handoff.blockedReasons ?? []),
    ]);
    return {
      ...state,
      ready: state.ready === true && handoff.ready === true && blockedReasons.length === 0,
      restartSafe: state.restartSafe === true && handoff.restartSafe === true,
      command: state.command ?? handoff.nextAction,
      nextAction: state.nextAction ?? state.command ?? handoff.nextAction,
      persistence: {
        ...state.persistence,
        localOnly: state.persistence?.localOnly !== false,
        blockedReasons,
      },
      truthBoundary: {
        ...state.truthBoundary,
        localOnly: state.truthBoundary?.localOnly !== false,
        externalWritesPermitted: state.ready === true && handoff.ready === true && blockedReasons.length === 0,
        externalWritesObserved: state.truthBoundary?.externalWritesObserved ?? [],
      },
    };
  }
  return buildMailchimpExternalHandoffState(handoff.preview?.contract ?? {
    tenantId: handoff.tenantId,
    workspaceId: handoff.workspaceId,
    sourceId: handoff.sourceId,
    approvals: handoff.approvals,
  }, runtime);
}

function buildMailchimpApprovalAdoptionPlan({
  normalized,
  validation,
  claimPreview,
  pending,
  denied,
  approved,
  blockers,
  nextAction,
  status,
  commands,
  runtime,
}) {
  const operator = compactString(runtime.operatorId ?? runtime.acceptedBy ?? runtime.actorId) || null;
  const approvedRecords = approved.map((approval) => ({
    approvalId: approval.approvalId,
    key: approval.key,
    acceptedBy: approval.approvedBy || operator,
    acceptedAt: approval.approvedAt || "logical:accepted",
  }));
  const steps = [
    {
      id: "claims-ready",
      label: "Confirm Mailchimp claim readiness",
      command: claimPreview.nextAction,
      ready: claimPreview.ready === true,
      status: claimPreview.status,
      reason: claimPreview.message,
      localOnly: true,
    },
    {
      id: "operator-approvals",
      label: "Resolve operator approvals",
      command: pending.length > 0 ? "package.approval.request" : denied.length > 0 ? "process.inspect" : null,
      ready: pending.length === 0 && denied.length === 0,
      status: denied.length > 0 ? "denied" : pending.length > 0 ? "pending" : "accepted",
      reason: pending.length > 0
        ? `${pending.length} Mailchimp approval(s) pending`
        : denied.length > 0
          ? `${denied.length} Mailchimp approval(s) denied`
          : "operator approvals are accepted",
      localOnly: true,
    },
    {
      id: "runtime-handoff",
      label: "Adopt preview into runtime handoff",
      command: validation.passed ? "process.start" : nextAction,
      ready: validation.passed === true,
      status: validation.passed ? "ready" : status,
      reason: validation.passed
        ? "approval preview can be adopted by the local runtime"
        : blockers[0] ?? "approval preview adoption is blocked",
      localOnly: true,
    },
  ];
  const blockedSteps = steps.filter((step) => !step.ready);
  const ready = blockedSteps.length === 0
    && validation.passed === true
    && claimPreview.localOnly === true;

  return {
    protocol: "aios.mailchimp.approval-adoption-plan.v1",
    adapter: "mailchimp",
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
    status: ready ? "ready_to_adopt" : "blocked",
    ready,
    nextAction: ready ? "process.start" : blockedSteps[0]?.command ?? nextAction,
    localOnly: true,
    operator,
    acceptedRecords: approvedRecords,
    commandPlan: commands.commands.map((command) => ({
      id: command.id,
      command: "package.approval.request",
      type: command.type,
      approvalId: command.approvalId,
      status: command.status,
    })),
    steps,
    blockedReasons: uniqueSorted([
      ...blockers,
      ...(claimPreview.localOnly === true ? [] : ["claim readiness preview must remain local-only"]),
    ]),
    handoff: {
      externalWritesPermitted: ready,
      externalWritesObserved: [],
      evaluatedAgainst: normalized.truthBoundary.evaluatedAgainst,
      restartSafe: ready && normalized.restartSafe,
    },
  };
}

export function validateMailchimpApprovals(contract = {}) {
  const normalized = contract.protocol === APPROVAL_PROTOCOL ? contract : compileMailchimpApprovalContract(contract);
  const blocking = normalized.approvals.filter((approval) => approval.status !== "approved");
  const duplicateKeys = normalized.approvals
    .map((approval) => approval.key)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  const invalidExternalWriteApprovals = normalized.approvals.filter((approval) => (
    approval.requiredForExternalWrite && approval.status === "approved" && approval.restartSafe !== true
  ));
  return {
    protocol: "aios.mailchimp.approval-validation.v1",
    adapter: "mailchimp",
    passed: blocking.length === 0
      && normalized.blockedByClaims !== true
      && duplicateKeys.length === 0
      && invalidExternalWriteApprovals.length === 0,
    status: blocking.length === 0
      && normalized.blockedByClaims !== true
      && duplicateKeys.length === 0
      && invalidExternalWriteApprovals.length === 0
      ? "ready"
      : normalized.status,
    blockingApprovals: blocking.map((approval) => ({
      key: approval.key,
      approvalId: approval.approvalId,
      status: approval.status,
      action: approval.status === "denied" ? "hold-for-operator" : "request-operator-approval"
    })),
    validationSummary: {
      duplicateKeys: uniqueSorted(duplicateKeys),
      invalidExternalWriteApprovals: invalidExternalWriteApprovals.map((approval) => approval.key),
      blockedReasons: uniqueSorted([
        ...(normalized.blockedByClaims ? ["claims are not ready for approval"] : []),
        ...blocking.map((approval) => `approval ${approval.approvalId} is ${approval.status}`),
        ...duplicateKeys.map((key) => `duplicate approval key: ${key}`),
        ...invalidExternalWriteApprovals.map((approval) => (
          `external write approval is not restart-safe: ${approval.approvalId}`
        )),
      ]),
    },
    recovery: normalized.recovery
  };
}

export function mailchimpApprovalSelfCheck(source = {}) {
  const contract = compileMailchimpApprovalContract(source);
  const validation = validateMailchimpApprovals(contract);
  const commands = buildMailchimpApprovalCommands(contract);
  const preview = buildMailchimpApprovalPreviewSummary(contract);
  return {
    protocol: "aios.mailchimp.approval-self-check.v1",
    deterministic: true,
    importSideEffects: false,
    contractStatus: contract.status,
    validationStatus: validation.status,
    pendingCommandCount: commands.commands.length,
    previewStatus: preview.status,
    previewNextAction: preview.nextAction,
    previewReady: preview.ready,
    clientRuntimeAdoptionStatus: createMailchimpApprovalStatusHandoff(contract).clientRuntimeAdoption.status
  };
}

export const mailchimpApprovalProtocols = Object.freeze({
  contract: APPROVAL_PROTOCOL,
  commandPlan: "aios.mailchimp.approval-command-plan.v1",
  previewSummary: "aios.mailchimp.approval-preview-summary.v1",
  analyticsSnapshot: "aios.mailchimp.approval-analytics-snapshot.v1",
  acceptanceReceipt: ACCEPTANCE_RECEIPT_PROTOCOL,
  adoptionPlan: "aios.mailchimp.approval-adoption-plan.v1",
  statusHandoff: "aios.mailchimp.approval-status-handoff.v1",
  externalHandoffState: "aios.mailchimp.external-handoff-state.v1",
  clientRuntimeAdoption: CLIENT_RUNTIME_ADOPTION_PROTOCOL
});

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort();
}

function stableId(parts) {
  const text = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
