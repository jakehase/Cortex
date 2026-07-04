import { compileMailchimpWorkflowActionPacket } from "./capabilities.mjs";

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function artifactDigest(text) {
  let hash = 5381;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }

  return `djb2:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function findArtifact(boundary, logicalName) {
  return boundary?.artifactPlan?.find((artifact) => artifact.logicalName === logicalName) ?? null;
}

function localArtifactRecord(artifact, body, extra = {}) {
  const content = typeof body === "string" ? body : stableJson(body);

  return {
    kind: "aios.stdlib.artifact_record",
    logicalName: artifact.logicalName,
    path: artifact.path,
    mediaType: artifact.mediaType,
    writeMode: artifact.writeMode,
    bytes: byteLength(content),
    digest: artifactDigest(content),
    content,
    externalWrite: false,
    ...extra,
  };
}

function validatePreviewMembers(members, allowedFields) {
  const allowed = new Set(Array.isArray(allowedFields) ? allowedFields : []);
  const rows = Array.isArray(members) ? members : [];

  return rows.flatMap((member, index) => {
    const issues = [];

    if (!member || typeof member !== "object") {
      issues.push({
        code: "preview.member_shape",
        severity: "error",
        message: "Preview member rows must be objects.",
        path: `members[${index}]`,
      });
      return issues;
    }

    if (typeof member.email_address !== "string" || !member.email_address.includes("@")) {
      issues.push({
        code: "preview.email_required",
        severity: "error",
        message: "Preview member row requires an email_address.",
        path: `members[${index}].email_address`,
      });
    }

    for (const field of Object.keys(member)) {
      if (allowed.size && !allowed.has(field)) {
        issues.push({
          code: "preview.field_not_allowed",
          severity: "warning",
          message: `Field ${field} is not in the Mailchimp allowed member field contract.`,
          path: `members[${index}].${field}`,
        });
      }
    }

    return issues;
  });
}

function buildPreviewRows(boundary, members) {
  return members.map((member, index) => ({
    index,
    operation: "mailchimp.member.upsert.preview",
    audienceId: boundary?.providerJob?.adapterHandoff?.audience?.audienceId ?? null,
    email_address: member?.email_address ?? null,
    status_if_new: member?.status_if_new ?? "subscribed",
    mergeFieldKeys: member?.merge_fields && typeof member.merge_fields === "object"
      ? Object.keys(member.merge_fields).sort()
      : [],
    tags: Array.isArray(member?.tags) ? [...member.tags].sort() : [],
    acceptanceKey: artifactDigest(stableJson({
      email_address: member?.email_address ?? null,
      merge_fields: member?.merge_fields ?? null,
      tags: Array.isArray(member?.tags) ? [...member.tags].sort() : [],
    })),
  }));
}

function normalizeAcceptanceDecision(options = {}) {
  const acceptedKeys = new Set(Array.isArray(options.acceptedKeys) ? options.acceptedKeys : []);
  const rejectedKeys = new Set(Array.isArray(options.rejectedKeys) ? options.rejectedKeys : []);
  const acceptedAll = options.acceptedAll === true || options.acceptance === true;
  const validationAccepted = options.validationAccepted === true || options.acceptValidationSummary === true;
  const actor = String(options.acceptedBy ?? options.operatorId ?? options.actor ?? "").trim() || null;
  const decidedAt = String(options.acceptedAt ?? options.decidedAt ?? "").trim() || null;

  return {
    acceptedKeys,
    rejectedKeys,
    acceptedAll,
    validationAccepted,
    actor,
    decidedAt,
    note: String(options.acceptanceNote ?? options.note ?? "").trim() || null,
  };
}

function buildAcceptanceReceipt(boundary, previewRows, acceptance, decision, validationIssues) {
  const rowKeys = new Set(previewRows.map((row) => row.acceptanceKey));
  const unknownAcceptedKeys = [...decision.acceptedKeys].filter((key) => !rowKeys.has(key)).sort();
  const unknownRejectedKeys = [...decision.rejectedKeys].filter((key) => !rowKeys.has(key)).sort();
  const issueDigest = artifactDigest(stableJson(validationIssues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    path: issue.path,
  }))));
  const receiptBody = {
    boundaryId: boundary?.boundaryId ?? null,
    providerJobId: boundary?.providerJob?.jobId ?? null,
    status: acceptance.status,
    acceptedKeys: acceptance.acceptedKeys,
    rejectedKeys: acceptance.rejectedKeys,
    pendingKeys: acceptance.pendingKeys,
    validationAccepted: acceptance.validationAccepted,
    issueDigest,
  };

  return {
    kind: "aios.stdlib.artifact_acceptance_receipt",
    receiptId: artifactDigest(stableJson(receiptBody)),
    boundaryId: receiptBody.boundaryId,
    providerJobId: receiptBody.providerJobId,
    status: acceptance.status,
    actor: decision.actor,
    decidedAt: decision.decidedAt,
    note: decision.note,
    issueDigest,
    acceptedKeys: acceptance.acceptedKeys,
    rejectedKeys: acceptance.rejectedKeys,
    pendingKeys: acceptance.pendingKeys,
    unknownAcceptedKeys,
    unknownRejectedKeys,
    validationAccepted: acceptance.validationAccepted,
    restartSafe: acceptance.status === "ready" || acceptance.status === "needs_acceptance",
    nextAction: acceptance.nextStep,
  };
}

function buildAcceptanceContract(boundary, previewRows, validationIssues, options) {
  const errors = validationIssues.filter((issue) => issue.severity === "error");
  const acceptanceRequired = boundary?.providerJob?.lifecycleState?.controls?.acceptanceRequired !== false;
  const acceptanceMode = boundary?.providerJob?.lifecycleState?.settings?.acceptanceMode ?? "per-row";
  const decision = normalizeAcceptanceDecision(options);
  const acceptedKeys = decision.acceptedAll
    ? new Set(previewRows.map((row) => row.acceptanceKey))
    : decision.acceptedKeys;
  const rejectedRows = previewRows.filter((row) => decision.rejectedKeys.has(row.acceptanceKey));
  const unacceptedRows = acceptanceRequired
    ? previewRows.filter((row) => !acceptedKeys.has(row.acceptanceKey))
    : [];
  const allOrNonePending = acceptanceRequired && acceptanceMode === "all-or-none" && unacceptedRows.length > 0
    ? previewRows
    : unacceptedRows;
  const status = errors.length
    ? "blocked"
    : rejectedRows.length
      ? "rejected"
      : allOrNonePending.length
      ? "needs_acceptance"
      : acceptanceRequired && !decision.validationAccepted
        ? "needs_validation_ack"
      : "ready";
  const acceptedRowKeys = previewRows
    .filter((row) => acceptedKeys.has(row.acceptanceKey))
    .map((row) => row.acceptanceKey);

  return {
    kind: "aios.stdlib.artifact_acceptance_contract",
    status,
    acceptanceRequired,
    acceptanceMode,
    acceptedCount: acceptedRowKeys.length,
    rejectedCount: rejectedRows.length,
    pendingCount: allOrNonePending.length,
    acceptedKeys: acceptedRowKeys,
    rejectedKeys: rejectedRows.map((row) => row.acceptanceKey),
    pendingKeys: allOrNonePending.map((row) => row.acceptanceKey),
    validationAccepted: decision.validationAccepted,
    decisionStatus: decision.acceptedAll
      ? "accepted_all"
      : acceptedRowKeys.length || rejectedRows.length || decision.validationAccepted
        ? "partial_decision"
        : "not_started",
    nextStep: status === "ready"
      ? "write.local_artifacts"
      : status === "needs_acceptance" || status === "needs_validation_ack"
        ? "client.collect_acceptance"
        : status === "rejected"
          ? "client.revise_preview_rows"
        : "client.fix_preview_rows",
  };
}

function buildClientWorkflowHandoff(boundary, records, previewRows, acceptance, issues) {
  const lifecycle = boundary?.providerJob?.lifecycleState ?? {};
  const operatorState = boundary?.operatorControlState ?? {};
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const availableCommands = Array.isArray(operatorState.availableCommands)
    ? operatorState.availableCommands
    : Array.isArray(lifecycle.commandQueue)
      ? lifecycle.commandQueue.filter((entry) => entry.status === "ready").map((entry) => entry.command)
      : [];

  return {
    kind: "aios.stdlib.client_workflow_handoff",
    status: errors.length ? "blocked" : acceptance.status,
    boundaryId: boundary?.boundaryId ?? null,
    providerJobId: boundary?.providerJob?.jobId ?? null,
    nextAction: errors.length
      ? "client.fix_preview_rows"
      : acceptance.status === "needs_acceptance" || acceptance.status === "needs_validation_ack"
        ? "client.collect_acceptance"
        : acceptance.status === "rejected"
          ? "client.revise_preview_rows"
        : operatorState.nextAction ?? lifecycle.nextAction ?? "operator.review",
    availableCommands,
    settings: {
      revision: lifecycle.settingsRevision ?? null,
      acceptanceMode: acceptance.acceptanceMode,
      maxPreviewRows: lifecycle.settings?.maxPreviewRows ?? previewRows.length,
      validationSummaryRequired: lifecycle.settings?.requireValidationSummary !== false,
    },
    preview: {
      rowCount: previewRows.length,
      acceptedCount: acceptance.acceptedCount,
      rejectedCount: acceptance.rejectedCount,
      pendingCount: acceptance.pendingCount,
      validationAccepted: acceptance.validationAccepted,
      pendingKeys: acceptance.pendingKeys,
    },
    validationSummary: {
      status: errors.length ? "blocked" : "ready",
      errorTotal: errors.length,
      warningTotal: warnings.length,
      issueCodes: [...new Set(issues.map((issue) => issue.code))].sort(),
    },
    localArtifacts: records.map((record) => ({
      logicalName: record.logicalName,
      path: record.path,
      digest: record.digest,
      bytes: record.bytes,
    })),
  };
}

function buildReadinessSummary(boundary, records, acceptance, issues) {
  const errorTotal = issues.filter((issue) => issue.severity === "error").length;
  const warningTotal = issues.filter((issue) => issue.severity === "warning").length;
  const lifecycleNextAction = boundary?.providerJob?.lifecycleState?.nextAction
    ?? boundary?.analyticsExport?.exportSummary?.nextAction
    ?? "operator.review";

  return {
    kind: "aios.stdlib.artifact_readiness_summary",
    status: errorTotal ? "blocked" : acceptance.status,
    nextStep: errorTotal ? "client.fix_artifact_plan" : acceptance.nextStep,
    lifecycleNextAction,
    recordCount: records.length,
    totalBytes: records.reduce((sum, record) => sum + (Number.isInteger(record.bytes) ? record.bytes : 0), 0),
    validation: {
      errorTotal,
      warningTotal,
      issueCodes: [...new Set(issues.map((issue) => issue.code))].sort(),
    },
    preview: {
      acceptanceRequired: acceptance.acceptanceRequired,
      acceptanceMode: acceptance.acceptanceMode,
      acceptedCount: acceptance.acceptedCount,
      rejectedCount: acceptance.rejectedCount,
      pendingCount: acceptance.pendingCount,
      validationAccepted: acceptance.validationAccepted,
    },
  };
}

function normalizeCapabilityGate(boundary) {
  const negotiation = boundary?.providerJob?.capabilityNegotiation
    ?? boundary?.providerJob?.adapterHandoff?.capabilityNegotiation
    ?? boundary?.capabilityNegotiation
    ?? {};
  const missing = Array.isArray(negotiation.missing)
    ? negotiation.missing
    : Array.isArray(negotiation.missingScopes)
      ? negotiation.missingScopes
      : [];
  const denied = Array.isArray(negotiation.denied)
    ? negotiation.denied
    : Array.isArray(negotiation.deniedScopes)
      ? negotiation.deniedScopes
      : [];
  const required = Array.isArray(negotiation.required)
    ? negotiation.required
    : Array.isArray(negotiation.requiredScopes)
      ? negotiation.requiredScopes
      : [];
  const granted = Array.isArray(negotiation.granted)
    ? negotiation.granted
    : Array.isArray(negotiation.grantedScopes)
      ? negotiation.grantedScopes
      : [];

  return {
    status: String(negotiation.status ?? "").trim() || (missing.length || denied.length ? "blocked" : "unknown"),
    canHandoff: negotiation.canHandoff === true || negotiation.allowed === true,
    requiredScopes: [...new Set(required.map((scope) => String(scope ?? "").trim()).filter(Boolean))].sort(),
    grantedScopes: [...new Set(granted.map((scope) => String(scope ?? "").trim()).filter(Boolean))].sort(),
    missingScopes: [...new Set(missing.map((scope) => String(scope ?? "").trim()).filter(Boolean))].sort(),
    deniedScopes: [...new Set(denied.map((scope) => String(scope ?? "").trim()).filter(Boolean))].sort(),
  };
}

function buildAdapterCommitGate(boundary, records, acceptance, acceptanceReceipt, issues, persistence) {
  const commitMode = boundary?.providerJob?.commitMode ?? "dry-run";
  const lifecycle = boundary?.providerJob?.lifecycleState ?? {};
  const controls = lifecycle.controls ?? {};
  const capabilityGate = normalizeCapabilityGate(boundary);
  const errors = issues.filter((issue) => issue.severity === "error");
  const pendingLocalWrites = persistence?.counters?.readyToWrite ?? records.length;
  const missingArtifacts = ["contract", "truth-boundary", "adapter-preview", "analytics-export", "operator-control-state"]
    .filter((logicalName) => !records.some((record) => record.logicalName === logicalName));
  const blockers = [
    ...errors.map((issue) => ({
      code: issue.code,
      field: issue.path,
      action: "repair-artifact-validation-before-adapter-commit",
    })),
    ...missingArtifacts.map((logicalName) => ({
      code: "commit_gate_missing_artifact",
      field: logicalName,
      action: "rebuild-local-artifact-write-set",
    })),
    ...(acceptance.pendingCount > 0
      ? [{
          code: "commit_gate_preview_acceptance_pending",
          field: "acceptance.pendingKeys",
          action: "collect-preview-acceptance-before-adapter-commit",
        }]
      : []),
    ...(acceptance.rejectedCount > 0
      ? [{
          code: "commit_gate_preview_rejected",
          field: "acceptance.rejectedKeys",
          action: "revise-preview-rows-before-adapter-commit",
        }]
      : []),
    ...(acceptance.acceptanceRequired && acceptance.validationAccepted !== true
      ? [{
          code: "commit_gate_validation_ack_required",
          field: "acceptance.validationAccepted",
          action: "acknowledge-validation-summary-before-adapter-commit",
        }]
      : []),
    ...(commitMode !== "adapter-mediated"
      ? [{
          code: "commit_gate_dry_run_mode",
          field: "providerJob.commitMode",
          action: "switch-to-adapter-mediated-commit-mode-before-external-write",
        }]
      : []),
    ...(controls.commitAllowed === false
      ? [{
          code: "commit_gate_commit_disabled",
          field: "providerJob.lifecycleState.controls.commitAllowed",
          action: "enable-commit-control-before-adapter-commit",
        }]
      : []),
    ...(pendingLocalWrites > 0
      ? [{
          code: "commit_gate_local_artifacts_pending",
          field: "artifactWriteSet.persistence.commands",
          action: "persist-local-artifacts-before-adapter-commit",
        }]
      : []),
    ...capabilityGate.missingScopes.map((scope) => ({
      code: "commit_gate_capability_missing",
      field: scope,
      action: "grant-mailchimp-scope-before-adapter-commit",
    })),
    ...capabilityGate.deniedScopes.map((scope) => ({
      code: "commit_gate_capability_denied",
      field: scope,
      action: "surface-denied-scope-and-keep-commit-blocked",
    })),
  ];
  const status = blockers.length
    ? "blocked"
    : commitMode === "adapter-mediated"
      ? "ready"
      : "dry_run_only";

  return {
    contractVersion: "aios.mailchimp.adapter-commit-gate.v1",
    status,
    canCommit: status === "ready",
    commitMode,
    boundaryId: boundary?.boundaryId ?? null,
    providerJobId: boundary?.providerJob?.jobId ?? null,
    writeSetId: persistence?.writeSetId ?? null,
    receiptId: acceptanceReceipt.receiptId ?? null,
    preview: {
      acceptedCount: acceptance.acceptedCount,
      rejectedCount: acceptance.rejectedCount,
      pendingCount: acceptance.pendingCount,
      validationAccepted: acceptance.validationAccepted,
    },
    localArtifacts: {
      recordCount: records.length,
      pendingWriteCount: pendingLocalWrites,
      alreadyWrittenCount: persistence?.counters?.alreadyWritten ?? 0,
      missingArtifacts,
    },
    capabilityGate,
    blockers,
    nextAction: blockers.length
      ? blockers[0].action
      : "adapter.commit-mailchimp-batch",
    restartSafe: true,
    truthBoundary: {
      source: "deterministic-local-adapter-commit-gate",
      externalWrites: false,
    },
  };
}

function buildExternalReviewBundle(boundary, records, previewRows, acceptance, acceptanceReceipt, readiness, persistence, adapterCommitGate, operatorReport, workflowActionPacket, issues) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const previewRecord = records.find((record) => record.logicalName === "adapter-preview");
  const analyticsRecord = records.find((record) => record.logicalName === "analytics-export");
  const contractRecord = records.find((record) => record.logicalName === "contract");
  const truthRecord = records.find((record) => record.logicalName === "truth-boundary");
  const operatorRecord = records.find((record) => record.logicalName === "operator-control-state");
  const artifactDigestMap = Object.fromEntries(
    records.map((record) => [
      record.logicalName,
      {
        path: record.path,
        digest: record.digest,
        bytes: record.bytes,
        mediaType: record.mediaType,
      },
    ]),
  );
  const blockingActions = [
    ...errors.map((issue) => ({
      source: "validation",
      code: issue.code,
      field: issue.path,
      action: "repair-review-bundle-validation",
    })),
    ...adapterCommitGate.blockers.map((blocker) => ({
      source: "adapterCommitGate",
      code: blocker.code,
      field: blocker.field,
      action: blocker.action,
    })),
    ...operatorReport.blockingSections.map((section) => ({
      source: "operatorReport",
      code: `operator_report:${section.name}`,
      field: section.name,
      action: section.nextAction,
    })),
  ];
  const readinessStatus = errors.length
    ? "blocked"
    : adapterCommitGate.canCommit
      ? "ready_for_external_handoff"
      : acceptance.pendingCount > 0 || acceptance.validationAccepted !== true
        ? "needs_operator_acceptance"
        : persistence.counters.readyToWrite > 0
          ? "needs_local_persistence"
          : "needs_adapter_gate";
  const bundleSeed = {
    boundaryId: boundary?.boundaryId ?? null,
    providerJobId: boundary?.providerJob?.jobId ?? null,
    writeSetId: persistence.writeSetId,
    receiptId: acceptanceReceipt.receiptId,
    readinessStatus,
    artifactDigests: Object.fromEntries(
      Object.entries(artifactDigestMap).map(([name, record]) => [name, record.digest]),
    ),
    workflowActionPacketId: workflowActionPacket.packetId,
    blockerCodes: blockingActions.map((entry) => entry.code).sort(),
  };

  return {
    contractVersion: "aios.mailchimp.external-review-bundle.v1",
    bundleId: artifactDigest(stableJson(bundleSeed)),
    status: readinessStatus,
    provider: "mailchimp",
    boundaryId: bundleSeed.boundaryId,
    providerJobId: bundleSeed.providerJobId,
    writeSetId: persistence.writeSetId,
    receiptId: acceptanceReceipt.receiptId,
    nextAction: adapterCommitGate.canCommit
      ? "adapter.commit-mailchimp-batch"
      : blockingActions[0]?.action
        ?? (persistence.counters.readyToWrite > 0 ? "persist-local-artifacts" : readiness.nextStep),
    userVisibleSummary: {
      previewRows: previewRows.length,
      acceptedRows: acceptance.acceptedCount,
      rejectedRows: acceptance.rejectedCount,
      pendingRows: acceptance.pendingCount,
      validationAccepted: acceptance.validationAccepted,
      validationErrors: errors.length,
      validationWarnings: warnings.length,
      externalWriteMode: adapterCommitGate.commitMode,
    },
    artifactReferences: {
      contract: contractRecord ? artifactDigestMap[contractRecord.logicalName] : null,
      truthBoundary: truthRecord ? artifactDigestMap[truthRecord.logicalName] : null,
      preview: previewRecord ? artifactDigestMap[previewRecord.logicalName] : null,
      analytics: analyticsRecord ? artifactDigestMap[analyticsRecord.logicalName] : null,
      operatorControlState: operatorRecord ? artifactDigestMap[operatorRecord.logicalName] : null,
    },
    persistence: {
      status: persistence.status,
      readyCommandCount: persistence.counters.readyToWrite,
      alreadyWrittenCount: persistence.counters.alreadyWritten,
      staleEntryCount: persistence.counters.staleEntryCount,
      commandIds: persistence.commands.map((command) => command.id),
    },
    adapterCommit: {
      status: adapterCommitGate.status,
      canCommit: adapterCommitGate.canCommit,
      commitMode: adapterCommitGate.commitMode,
      blockerCodes: adapterCommitGate.blockers.map((blocker) => blocker.code),
      capabilityStatus: adapterCommitGate.capabilityGate.status,
      missingScopes: adapterCommitGate.capabilityGate.missingScopes,
      deniedScopes: adapterCommitGate.capabilityGate.deniedScopes,
    },
    operatorReport: {
      reportId: operatorReport.reportId,
      status: operatorReport.status,
      nextAction: operatorReport.nextAction,
      blockingSections: operatorReport.blockingSections.map((section) => section.name),
      counters: operatorReport.counters,
    },
    workflowAction: {
      packetId: workflowActionPacket.packetId,
      status: workflowActionPacket.status,
      primaryAction: workflowActionPacket.primaryAction,
      activeStepId: workflowActionPacket.activeStepId,
      blockingCodes: workflowActionPacket.issueSummary.blockingCodes,
    },
    blockingActions,
    restartSafe: persistence.restartSafe === true && operatorReport.restartSafe !== false && workflowActionPacket.restartSafe !== false,
    truthBoundary: {
      source: "deterministic-local-external-review-bundle",
      externalWrites: false,
    },
  };
}

function buildClientReviewEnvelope(boundary, previewRows, acceptance, acceptanceReceipt, readiness, clientWorkflowHandoff, persistence, adapterCommitGate, workflowActionPacket, externalReviewBundle, issues) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const lifecycle = boundary?.providerJob?.lifecycleState ?? {};
  const requiredAcknowledgements = [
    ...(acceptance.acceptanceRequired && acceptance.pendingCount > 0
      ? [{
          id: "preview-row-acceptance",
          status: "pending",
          count: acceptance.pendingCount,
          action: "collect-preview-acceptance",
        }]
      : []),
    ...(acceptance.acceptanceRequired && acceptance.validationAccepted !== true
      ? [{
          id: "validation-summary-ack",
          status: "pending",
          count: errors.length + warnings.length,
          action: "acknowledge-validation-summary-before-adapter-commit",
        }]
      : []),
    ...(persistence.counters.readyToWrite > 0
      ? [{
          id: "local-artifact-persistence",
          status: "pending",
          count: persistence.counters.readyToWrite,
          action: "persist-local-artifacts",
        }]
      : []),
  ];
  const blockingExplanations = [
    ...errors.map((issue) => ({
      source: "validation",
      code: issue.code,
      field: issue.path,
      action: "repair-preview-validation",
    })),
    ...adapterCommitGate.blockers.map((blocker) => ({
      source: "adapterCommitGate",
      code: blocker.code,
      field: blocker.field,
      action: blocker.action,
    })),
    ...externalReviewBundle.blockingActions.map((entry) => ({
      source: entry.source,
      code: entry.code,
      field: entry.field,
      action: entry.action,
    })),
  ];
  const status = errors.length
    ? "blocked"
    : acceptance.rejectedCount > 0
      ? "needs_preview_revision"
      : requiredAcknowledgements.length
        ? "needs_operator_acceptance"
        : adapterCommitGate.canCommit
          ? "ready_for_adapter_commit"
          : "ready_for_review";
  const nextAction = status === "blocked"
    ? "repair-preview-validation"
    : status === "needs_preview_revision"
      ? "revise-preview-rows"
      : requiredAcknowledgements[0]?.action
        ?? (adapterCommitGate.canCommit ? "adapter.commit-mailchimp-batch" : workflowActionPacket.primaryAction);
  const envelopeSeed = {
    boundaryId: boundary?.boundaryId ?? null,
    providerJobId: boundary?.providerJob?.jobId ?? null,
    writeSetId: persistence.writeSetId,
    receiptId: acceptanceReceipt.receiptId,
    status,
    nextAction,
    pendingKeys: acceptance.pendingKeys,
    blockingCodes: blockingExplanations.map((entry) => entry.code).sort(),
  };

  return {
    contractVersion: "aios.mailchimp.client-review-envelope.v1",
    envelopeId: artifactDigest(stableJson(envelopeSeed)),
    status,
    nextAction,
    boundaryId: envelopeSeed.boundaryId,
    providerJobId: envelopeSeed.providerJobId,
    writeSetId: persistence.writeSetId,
    receiptId: acceptanceReceipt.receiptId,
    reviewMode: lifecycle.settings?.reviewMode ?? "operator-preview",
    preview: {
      rowCount: previewRows.length,
      sampleRows: previewRows.slice(0, 5).map((row) => ({
        index: row.index,
        email_address: row.email_address,
        status_if_new: row.status_if_new,
        mergeFieldKeys: row.mergeFieldKeys,
        tagCount: row.tags.length,
        acceptanceKey: row.acceptanceKey,
        accepted: acceptance.acceptedKeys.includes(row.acceptanceKey),
        rejected: acceptance.rejectedKeys.includes(row.acceptanceKey),
        pending: acceptance.pendingKeys.includes(row.acceptanceKey),
      })),
      truncated: previewRows.length > 5,
    },
    acceptance: {
      required: acceptance.acceptanceRequired,
      mode: acceptance.acceptanceMode,
      status: acceptance.status,
      acceptedCount: acceptance.acceptedCount,
      rejectedCount: acceptance.rejectedCount,
      pendingCount: acceptance.pendingCount,
      validationAccepted: acceptance.validationAccepted,
      pendingKeys: acceptance.pendingKeys,
    },
    validationSummary: {
      status: errors.length ? "blocked" : "ready",
      errorTotal: errors.length,
      warningTotal: warnings.length,
      issueCodes: [...new Set(issues.map((issue) => issue.code))].sort(),
      errors: errors.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
      warnings: warnings.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
    },
    readiness: {
      artifactStatus: readiness.status,
      artifactNextStep: readiness.nextStep,
      clientNextAction: clientWorkflowHandoff.nextAction,
      workflowStatus: workflowActionPacket.status,
      workflowPrimaryAction: workflowActionPacket.primaryAction,
      activeStepId: workflowActionPacket.activeStepId,
      adapterCommitStatus: adapterCommitGate.status,
      adapterCommitAllowed: adapterCommitGate.canCommit,
      externalReviewStatus: externalReviewBundle.status,
      externalReviewBundleId: externalReviewBundle.bundleId,
    },
    requiredAcknowledgements,
    blockingExplanations,
    restartSafe: persistence.restartSafe === true && workflowActionPacket.restartSafe !== false,
    truthBoundary: {
      source: "deterministic-local-client-review-envelope",
      externalWrites: false,
    },
  };
}

function normalizeReadinessAction(entry, fallbackSource = "commitReadiness") {
  const source = entry && typeof entry === "object" ? entry : {};
  const code = String(source.code ?? source.id ?? source.field ?? entry ?? "").trim();

  return {
    source: String(source.source ?? fallbackSource).trim() || fallbackSource,
    code: code || "commit_readiness_action",
    field: String(source.field ?? "").trim() || null,
    action: String(source.action ?? source.nextAction ?? "").trim() || "operator.review",
    commandId: String(source.commandId ?? source.id ?? "").trim() || null,
  };
}

function commitReadinessCommandId(boundaryId, writeSetId, action, index) {
  return [
    "mailchimp.commit-readiness",
    String(boundaryId ?? "").trim() || "boundary",
    String(writeSetId ?? "").trim() || "write-set",
    String(action.code ?? action.action ?? index).trim() || "action",
    String(index),
  ]
    .join(".")
    .toLowerCase()
    .replace(/[^a-z0-9.:/_-]+/g, "-")
    .replace(/-+/g, "-");
}

function buildCommitReadinessCapsule(boundary, acceptance, persistence, adapterCommitGate, workflowActionPacket, externalReviewBundle, clientReviewEnvelope, operatorReport, issues) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const validationActions = errors.map((issue) => normalizeReadinessAction({
    source: "validation",
    code: issue.code,
    field: issue.path,
    action: "repair-preview-validation-before-commit",
  }));
  const acknowledgementActions = [
    ...(Array.isArray(clientReviewEnvelope.requiredAcknowledgements)
      ? clientReviewEnvelope.requiredAcknowledgements.map((entry) => normalizeReadinessAction({
          source: "clientReview",
          code: `ack:${entry.id}`,
          field: entry.id,
          action: entry.action,
        }))
      : []),
    ...(acceptance.rejectedCount > 0
      ? [normalizeReadinessAction({
          source: "preview",
          code: "preview_rows_rejected",
          field: "acceptance.rejectedKeys",
          action: "revise-preview-rows-before-commit",
        })]
      : []),
  ];
  const persistenceActions = persistence.counters.readyToWrite > 0
    ? persistence.commands
        .filter((command) => command.status === "ready_to_write")
        .map((command) => normalizeReadinessAction({
          source: "localPersistence",
          code: "local_artifact_write_pending",
          field: command.logicalName,
          action: "persist-local-artifacts-before-adapter-commit",
          commandId: command.id,
        }))
    : [];
  const gateActions = [
    ...(Array.isArray(adapterCommitGate.blockers)
      ? adapterCommitGate.blockers.map((blocker) => normalizeReadinessAction({
          source: "adapterCommitGate",
          code: blocker.code,
          field: blocker.field,
          action: blocker.action,
        }))
      : []),
    ...(Array.isArray(externalReviewBundle.blockingActions)
      ? externalReviewBundle.blockingActions.map((entry) => normalizeReadinessAction(entry, "externalReview"))
      : []),
    ...(Array.isArray(clientReviewEnvelope.blockingExplanations)
      ? clientReviewEnvelope.blockingExplanations.map((entry) => normalizeReadinessAction(entry, "clientReview"))
      : []),
    ...(Array.isArray(operatorReport.blockingSections)
      ? operatorReport.blockingSections.map((section) => normalizeReadinessAction({
          source: "operatorReport",
          code: `operator_report:${section.name}`,
          field: section.name,
          action: section.nextAction,
        }))
      : []),
    ...(Array.isArray(workflowActionPacket.issueSummary?.blockingCodes)
      ? workflowActionPacket.issueSummary.blockingCodes.map((code) => normalizeReadinessAction({
          source: "workflowAction",
          code,
          action: workflowActionPacket.primaryAction || "repair-mailchimp-workflow-action-before-commit",
        }))
      : []),
  ];
  const seen = new Set();
  const actions = [
    ...validationActions,
    ...acknowledgementActions,
    ...persistenceActions,
    ...gateActions,
  ].filter((action) => {
    const key = stableJson([action.source, action.code, action.field, action.action, action.commandId]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const writeSetId = persistence.writeSetId ?? adapterCommitGate.writeSetId ?? null;
  const status = adapterCommitGate.canCommit === true && actions.length === 0
    ? "ready_for_adapter_commit"
    : errors.length
      ? "blocked"
      : acknowledgementActions.length
        ? "needs_operator_acceptance"
        : persistenceActions.length
          ? "needs_local_persistence"
          : adapterCommitGate.capabilityGate?.missingScopes?.length || adapterCommitGate.capabilityGate?.deniedScopes?.length
            ? "needs_capability_resolution"
            : "needs_adapter_gate";
  const nextAction = status === "ready_for_adapter_commit"
    ? "adapter.commit-mailchimp-batch"
    : actions[0]?.action ?? adapterCommitGate.nextAction ?? clientReviewEnvelope.nextAction ?? "operator.review";
  const capsuleSeed = {
    boundaryId: boundary?.boundaryId ?? null,
    providerJobId: boundary?.providerJob?.jobId ?? null,
    writeSetId,
    status,
    nextAction,
    actions: actions.map((action) => ({
      source: action.source,
      code: action.code,
      field: action.field,
      action: action.action,
      commandId: action.commandId,
    })),
  };

  return {
    contractVersion: "aios.mailchimp.commit-readiness-capsule.v1",
    capsuleId: artifactDigest(stableJson(capsuleSeed)),
    status,
    canCommit: status === "ready_for_adapter_commit",
    provider: "mailchimp",
    boundaryId: capsuleSeed.boundaryId,
    providerJobId: capsuleSeed.providerJobId,
    writeSetId,
    receiptId: clientReviewEnvelope.receiptId ?? adapterCommitGate.receiptId ?? null,
    nextAction,
    userVisibleState: {
      reviewStatus: clientReviewEnvelope.status,
      reviewNextAction: clientReviewEnvelope.nextAction,
      workflowStatus: workflowActionPacket.status,
      workflowPrimaryAction: workflowActionPacket.primaryAction,
      externalReviewStatus: externalReviewBundle.status,
      adapterCommitStatus: adapterCommitGate.status,
      pendingPreviewRows: acceptance.pendingCount,
      rejectedPreviewRows: acceptance.rejectedCount,
      pendingArtifactWrites: persistence.counters.readyToWrite,
      validationErrors: errors.length,
    },
    gates: {
      validation: {
        status: errors.length ? "blocked" : "ready",
        blockingCodes: errors.map((issue) => issue.code).sort(),
      },
      operatorAcceptance: {
        status: acknowledgementActions.length ? "pending" : "satisfied",
        requiredAcknowledgements: Array.isArray(clientReviewEnvelope.requiredAcknowledgements)
          ? clientReviewEnvelope.requiredAcknowledgements.map((entry) => entry.id).sort()
          : [],
      },
      localPersistence: {
        status: persistence.counters.readyToWrite > 0 ? "pending" : "satisfied",
        writeSetId,
        readyCommandCount: persistence.counters.readyToWrite,
        alreadyWrittenCount: persistence.counters.alreadyWritten,
      },
      capabilities: {
        status: adapterCommitGate.capabilityGate?.status ?? "unknown",
        missingScopes: adapterCommitGate.capabilityGate?.missingScopes ?? [],
        deniedScopes: adapterCommitGate.capabilityGate?.deniedScopes ?? [],
      },
      adapterCommit: {
        status: adapterCommitGate.status,
        canCommit: adapterCommitGate.canCommit === true,
        commitMode: adapterCommitGate.commitMode,
        blockerCodes: adapterCommitGate.blockers.map((blocker) => blocker.code),
      },
    },
    actions: actions.map((action, index) => ({
      ...action,
      order: index + 1,
      status: action.commandId ? "ready" : "waiting",
      idempotencyKey: action.commandId ?? commitReadinessCommandId(capsuleSeed.boundaryId, writeSetId, action, index),
    })),
    resume: {
      allowed: status !== "blocked",
      mode: status === "ready_for_adapter_commit"
        ? "commit_from_verified_local_state"
        : status === "needs_local_persistence"
          ? "resume_local_artifact_writes"
          : "resume_operator_review",
      cursor: writeSetId,
      restartSafe: persistence.restartSafe === true
        && externalReviewBundle.restartSafe !== false
        && clientReviewEnvelope.restartSafe !== false
        && workflowActionPacket.restartSafe !== false,
    },
    truthBoundary: {
      source: "deterministic-local-commit-readiness-capsule",
      externalWrites: false,
    },
  };
}

function normalizeAnalyticsSnapshot(snapshot = {}, index = 0) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const counters = source.counters && typeof source.counters === "object" ? source.counters : {};
  const blockedReasons = Array.isArray(source.blockedReasons)
    ? [...new Set(source.blockedReasons.map((reason) => String(reason ?? "").trim()).filter(Boolean))].sort()
    : [];
  const digest = String(source.digest ?? source.exportDigest ?? "").trim() || artifactDigest(stableJson({
    index,
    status: source.status ?? "unknown",
    nextAction: source.nextAction ?? "operator.review",
    counters,
    blockedReasons,
  }));

  return {
    version: String(source.version ?? "").trim() || "mailchimp.provider-analytics-history-entry.v1",
    index,
    digest,
    status: String(source.status ?? "").trim() || "unknown",
    nextAction: String(source.nextAction ?? "").trim() || "operator.review",
    stateKey: String(source.stateKey ?? "").trim() || null,
    settingsRevision: String(source.settingsRevision ?? "").trim() || null,
    providerJobId: String(source.providerJobId ?? "").trim() || null,
    exportedAt: String(source.exportedAt ?? "").trim() || null,
    counters: {
      issueTotal: Number.isInteger(counters.issueTotal) ? Math.max(0, counters.issueTotal) : 0,
      blockingIssueTotal: Number.isInteger(counters.blockingIssueTotal) ? Math.max(0, counters.blockingIssueTotal) : 0,
      warningIssueTotal: Number.isInteger(counters.warningIssueTotal) ? Math.max(0, counters.warningIssueTotal) : 0,
      previewRows: Number.isInteger(counters.previewRows) ? Math.max(0, counters.previewRows) : 0,
      acceptedRows: Number.isInteger(counters.acceptedRows) ? Math.max(0, counters.acceptedRows) : 0,
      pendingRows: Number.isInteger(counters.pendingRows) ? Math.max(0, counters.pendingRows) : 0,
    },
    blockedReasons,
  };
}

function buildAnalyticsArtifactBody(boundary, previewRows, acceptance, acceptanceReceipt, issues) {
  const exportSource = boundary?.analyticsExport && typeof boundary.analyticsExport === "object"
    ? boundary.analyticsExport
    : boundary?.providerJob?.analyticsExport && typeof boundary.providerJob.analyticsExport === "object"
      ? boundary.providerJob.analyticsExport
      : boundary?.providerJob?.adapterHandoff?.analyticsExport && typeof boundary.providerJob.adapterHandoff.analyticsExport === "object"
        ? boundary.providerJob.adapterHandoff.analyticsExport
        : {};
  const history = Array.isArray(exportSource.historySnapshots)
    ? exportSource.historySnapshots.map(normalizeAnalyticsSnapshot)
    : [];
  const validationCounters = issues.reduce((counts, issue) => {
    const severity = String(issue.severity ?? "unknown").trim() || "unknown";
    counts[severity] = (counts[severity] ?? 0) + 1;
    return counts;
  }, {});
  const previewCounters = {
    rowCount: previewRows.length,
    acceptedCount: acceptance.acceptedCount,
    rejectedCount: acceptance.rejectedCount,
    pendingCount: acceptance.pendingCount,
    validationAccepted: acceptance.validationAccepted === true,
  };
  const exportSummary = exportSource.exportSummary && typeof exportSource.exportSummary === "object"
    ? exportSource.exportSummary
    : {};
  const currentSnapshot = normalizeAnalyticsSnapshot({
    digest: exportSource.exportDigest,
    status: exportSource.status ?? acceptance.status,
    nextAction: exportSummary.nextAction ?? acceptance.nextStep,
    stateKey: exportSummary.stateKey,
    settingsRevision: exportSummary.settingsRevision,
    providerJobId: boundary?.providerJob?.jobId,
    counters: {
      issueTotal: issues.length,
      blockingIssueTotal: validationCounters.error ?? 0,
      warningIssueTotal: validationCounters.warning ?? 0,
      previewRows: previewRows.length,
      acceptedRows: acceptance.acceptedCount,
      pendingRows: acceptance.pendingCount,
    },
    blockedReasons: Array.isArray(exportSummary.blockedReasons)
      ? exportSummary.blockedReasons
      : issues.filter((issue) => issue.severity === "error").map((issue) => issue.code),
  }, history.length);
  const ledger = [...history, currentSnapshot].slice(-12).map((entry, index) => ({
    ...entry,
    index,
  }));
  const timeline = Array.isArray(exportSource.timeline)
    ? exportSource.timeline.map((entry, index) => ({
        index,
        phase: String(entry.phase ?? "").trim() || "analytics",
        status: String(entry.status ?? "").trim() || "unknown",
        action: String(entry.action ?? "").trim() || "operator.review",
        code: String(entry.code ?? "").trim() || null,
        restartSafe: entry.restartSafe !== false,
        digest: String(entry.digest ?? "").trim() || artifactDigest(stableJson(entry)),
      }))
    : [];

  return {
    kind: "aios.stdlib.analytics_export_artifact",
    version: "mailchimp.artifact-analytics-export.v1",
    providerJobId: boundary?.providerJob?.jobId ?? null,
    boundaryId: boundary?.boundaryId ?? null,
    exportDigest: exportSource.exportDigest ?? currentSnapshot.digest,
    exportSummary: {
      status: exportSummary.status ?? currentSnapshot.status,
      nextAction: exportSummary.nextAction ?? currentSnapshot.nextAction,
      commitMode: exportSummary.commitMode ?? boundary?.providerJob?.commitMode ?? "dry-run",
      settingsRevision: exportSummary.settingsRevision ?? currentSnapshot.settingsRevision,
      stateKey: exportSummary.stateKey ?? currentSnapshot.stateKey,
      sequence: exportSummary.sequence ?? null,
      restartSafe: exportSummary.restartSafe !== false && timeline.every((entry) => entry.restartSafe !== false),
      blockedReasons: currentSnapshot.blockedReasons,
    },
    counters: {
      ...(exportSource.counters && typeof exportSource.counters === "object" ? exportSource.counters : {}),
      preview: previewCounters,
      validation: validationCounters,
      historySnapshotTotal: ledger.length,
      timelineEventTotal: timeline.length,
    },
    preview: {
      rowCount: previewRows.length,
      acceptedCount: acceptance.acceptedCount,
      rejectedCount: acceptance.rejectedCount,
      pendingCount: acceptance.pendingCount,
      validationAccepted: acceptance.validationAccepted,
      acceptanceReceiptId: acceptanceReceipt.receiptId,
    },
    historySnapshots: ledger,
    timeline,
    report: exportSource.report ?? null,
    truthBoundary: {
      source: "deterministic-local-analytics-artifact",
      externalWrites: false,
    },
  };
}

function normalizeReportSection(section = {}, fallbackStatus = "unknown") {
  const source = section && typeof section === "object" ? section : {};
  const counters = source.counters && typeof source.counters === "object" ? source.counters : {};
  const issueCodes = Array.isArray(source.issueCodes)
    ? source.issueCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
    : [];

  return {
    status: String(source.status ?? "").trim() || fallbackStatus,
    nextAction: String(source.nextAction ?? source.nextStep ?? "").trim() || "operator.review",
    digest: String(source.digest ?? "").trim() || null,
    counters: Object.fromEntries(
      Object.entries(counters)
        .filter(([, value]) => Number.isFinite(value))
        .map(([key, value]) => [key, Math.max(0, Math.floor(value))]),
    ),
    issueCodes,
  };
}

function buildOperatorReportEnvelope(boundary, records, acceptance, readiness, persistence, adapterCommitGate, analyticsBody, issues) {
  const analyticsRecord = records.find((record) => record.logicalName === "analytics-export");
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const timeline = Array.isArray(analyticsBody.timeline) ? analyticsBody.timeline : [];
  const latestSnapshot = Array.isArray(analyticsBody.historySnapshots)
    ? analyticsBody.historySnapshots.at(-1) ?? null
    : null;
  const sections = {
    preview: normalizeReportSection({
      status: acceptance.status,
      nextAction: acceptance.nextStep,
      counters: {
        acceptedRows: acceptance.acceptedCount,
        rejectedRows: acceptance.rejectedCount,
        pendingRows: acceptance.pendingCount,
      },
      issueCodes: issues.map((issue) => issue.code),
    }, acceptance.status),
    localArtifacts: normalizeReportSection({
      status: persistence.status,
      nextAction: persistence.counters.readyToWrite > 0 ? "persist-local-artifacts" : "observe-local-artifacts",
      digest: persistence.writeSetId,
      counters: {
        records: records.length,
        readyToWrite: persistence.counters.readyToWrite,
        alreadyWritten: persistence.counters.alreadyWritten,
        staleEntries: persistence.counters.staleEntryCount,
      },
    }, persistence.status),
    adapterCommit: normalizeReportSection({
      status: adapterCommitGate.status,
      nextAction: adapterCommitGate.nextAction,
      digest: adapterCommitGate.writeSetId,
      counters: {
        blockers: adapterCommitGate.blockers.length,
        missingScopes: adapterCommitGate.capabilityGate.missingScopes.length,
        deniedScopes: adapterCommitGate.capabilityGate.deniedScopes.length,
      },
      issueCodes: adapterCommitGate.blockers.map((blocker) => blocker.code),
    }, adapterCommitGate.status),
    analytics: normalizeReportSection({
      status: analyticsBody.exportSummary.status,
      nextAction: analyticsBody.exportSummary.nextAction,
      digest: analyticsBody.exportDigest,
      counters: {
        historySnapshots: analyticsBody.counters.historySnapshotTotal,
        timelineEvents: analyticsBody.counters.timelineEventTotal,
        blockingIssues: errors.length,
        warningIssues: warnings.length,
      },
      issueCodes: analyticsBody.exportSummary.blockedReasons,
    }, analyticsBody.exportSummary.status),
  };
  const blockingSections = Object.entries(sections)
    .filter(([, section]) => ["blocked", "rejected", "needs_acceptance", "needs_validation_ack"].includes(section.status))
    .map(([name, section]) => ({
      name,
      status: section.status,
      nextAction: section.nextAction,
      issueCodes: section.issueCodes,
    }));
  const reportBody = {
    boundaryId: boundary?.boundaryId ?? null,
    providerJobId: boundary?.providerJob?.jobId ?? null,
    writeSetId: persistence.writeSetId,
    analyticsDigest: analyticsBody.exportDigest,
    sections,
    blockingSections,
  };

  return {
    kind: "aios.stdlib.operator_report_envelope",
    version: "mailchimp.operator-report.v1",
    reportId: artifactDigest(stableJson(reportBody)),
    boundaryId: reportBody.boundaryId,
    providerJobId: reportBody.providerJobId,
    writeSetId: persistence.writeSetId,
    status: errors.length
      ? "blocked"
      : blockingSections.length
        ? "needs_operator_action"
        : adapterCommitGate.canCommit
          ? "ready_for_adapter_commit"
          : readiness.status,
    nextAction: blockingSections[0]?.nextAction
      ?? (adapterCommitGate.canCommit ? "adapter.commit-mailchimp-batch" : readiness.nextStep),
    sections,
    latestSnapshot: latestSnapshot
      ? {
          digest: latestSnapshot.digest,
          status: latestSnapshot.status,
          nextAction: latestSnapshot.nextAction,
          index: latestSnapshot.index,
        }
      : null,
    timeline: timeline.slice(-8).map((entry) => ({
      index: entry.index,
      phase: entry.phase,
      status: entry.status,
      action: entry.action,
      restartSafe: entry.restartSafe !== false,
    })),
    counters: {
      issueTotal: issues.length,
      blockingIssueTotal: errors.length,
      warningIssueTotal: warnings.length,
      artifactRecordTotal: records.length,
      totalBytes: records.reduce((sum, record) => sum + (Number.isInteger(record.bytes) ? record.bytes : 0), 0),
      historySnapshotTotal: analyticsBody.counters.historySnapshotTotal,
      timelineEventTotal: analyticsBody.counters.timelineEventTotal,
    },
    artifacts: records.map((record) => ({
      logicalName: record.logicalName,
      path: record.path,
      digest: record.digest,
      bytes: record.bytes,
    })),
    analyticsArtifact: analyticsRecord
      ? {
          path: analyticsRecord.path,
          digest: analyticsRecord.digest,
          bytes: analyticsRecord.bytes,
        }
      : null,
    blockingSections,
    restartSafe: true,
    truthBoundary: {
      source: "deterministic-local-operator-report",
      externalWrites: false,
    },
  };
}

function normalizeArtifactStateEntry(entry = {}) {
  return {
    path: String(entry.path ?? "").trim(),
    logicalName: String(entry.logicalName ?? "").trim(),
    digest: String(entry.digest ?? "").trim(),
    bytes: Number.isInteger(entry.bytes) ? Math.max(0, entry.bytes) : 0,
    status: String(entry.status ?? "").trim() || "unknown",
    writtenAt: String(entry.writtenAt ?? "").trim() || null,
    commandId: String(entry.commandId ?? entry.id ?? "").trim(),
  };
}

function normalizeArtifactPersistenceState(state = {}) {
  const entries = Array.isArray(state.entries)
    ? state.entries
    : Array.isArray(state.records)
      ? state.records
      : [];

  return {
    manifestVersion: String(state.manifestVersion ?? "").trim() || "aios.mailchimp.artifact-manifest.v1",
    boundaryId: String(state.boundaryId ?? "").trim(),
    writeSetId: String(state.writeSetId ?? "").trim(),
    committedAt: String(state.committedAt ?? "").trim() || null,
    entries: entries.map(normalizeArtifactStateEntry).filter((entry) => entry.path || entry.logicalName),
  };
}

function artifactWriteCommandId(boundaryId, path, digest) {
  return [
    "mailchimp.artifact.write",
    String(boundaryId ?? "").trim() || "boundary",
    String(path ?? "").trim() || "path",
    String(digest ?? "").trim() || "digest",
  ]
    .join(".")
    .toLowerCase()
    .replace(/[^a-z0-9.:/_-]+/g, "-")
    .replace(/-+/g, "-");
}

function artifactWriteSetId(boundaryId, records) {
  return artifactDigest(stableJson({
    boundaryId: boundaryId ?? null,
    records: records.map((record) => ({
      logicalName: record.logicalName,
      path: record.path,
      digest: record.digest,
    })),
  }));
}

function buildArtifactPersistencePlan(boundary, records, previousState = {}) {
  const persisted = normalizeArtifactPersistenceState(previousState);
  const previousByPath = new Map(persisted.entries.map((entry) => [entry.path, entry]));
  const boundaryId = boundary?.boundaryId ?? persisted.boundaryId ?? null;
  const writeSetId = artifactWriteSetId(boundaryId, records);
  const commands = records.map((record) => {
    const previous = previousByPath.get(record.path);
    const alreadyPersisted = previous?.digest === record.digest && previous.status === "written";
    const commandId = artifactWriteCommandId(boundaryId, record.path, record.digest);

    return {
      commandVersion: "aios.mailchimp.artifact-command.v1",
      id: commandId,
      type: "write-local-artifact",
      logicalName: record.logicalName,
      path: record.path,
      digest: record.digest,
      bytes: record.bytes,
      mediaType: record.mediaType,
      writeMode: record.writeMode,
      idempotencyKey: commandId,
      expectedPreviousDigest: previous?.digest ?? null,
      status: alreadyPersisted ? "already_written" : "ready_to_write",
      externalWrites: false,
    };
  });
  const staleEntries = persisted.entries.filter(
    (entry) => entry.path && !records.some((record) => record.path === entry.path),
  );
  const readyCount = commands.filter((command) => command.status === "ready_to_write").length;
  const alreadyWrittenCount = commands.length - readyCount;

  return {
    manifestVersion: "aios.mailchimp.artifact-manifest.v1",
    status: readyCount === 0 ? "already_persisted" : "ready_to_persist",
    boundaryId,
    writeSetId,
    previousWriteSetId: persisted.writeSetId || null,
    restartSafe: true,
    commands,
    manifestEntries: commands.map((command) => ({
      logicalName: command.logicalName,
      path: command.path,
      digest: command.digest,
      bytes: command.bytes,
      status: command.status === "already_written" ? "written" : "pending_write",
      commandId: command.id,
    })),
    counters: {
      commandCount: commands.length,
      readyToWrite: readyCount,
      alreadyWritten: alreadyWrittenCount,
      staleEntryCount: staleEntries.length,
    },
    recovery: [
      ...commands
        .filter((command) => command.status === "ready_to_write" && command.expectedPreviousDigest)
        .map((command) => ({
          code: "artifact_digest_changed",
          path: command.path,
          logicalName: command.logicalName,
          previousDigest: command.expectedPreviousDigest,
          nextDigest: command.digest,
          action: "rewrite-local-artifact-with-idempotent-command",
        })),
      ...staleEntries.map((entry) => ({
        code: "artifact_manifest_stale_entry",
        path: entry.path,
        logicalName: entry.logicalName,
        previousDigest: entry.digest,
        action: "drop-stale-local-manifest-entry-after-new-write-set-commits",
      })),
    ],
    rollback: {
      supported: true,
      strategy: "restore-previous-artifact-manifest-or-delete-new-local-files",
      writeSetId,
      previousWriteSetId: persisted.writeSetId || null,
      commandIds: commands.map((command) => command.id),
    },
    truthBoundary: {
      source: "deterministic-local-artifact-persistence-plan",
      externalWrites: false,
    },
  };
}

function normalizeBoundaryToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeBoundaryList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(normalizeBoundaryToken).filter(Boolean))].sort();
}

function deriveArtifactBoundaryAssurance(boundary = {}, options = {}) {
  const providerJob = boundary?.providerJob && typeof boundary.providerJob === "object" ? boundary.providerJob : {};
  const lifecycle = providerJob.lifecycleState && typeof providerJob.lifecycleState === "object"
    ? providerJob.lifecycleState
    : {};
  const runtimeBoundary = providerJob.runtimeBoundary && typeof providerJob.runtimeBoundary === "object"
    ? providerJob.runtimeBoundary
    : providerJob.adapterHandoff?.runtimeBoundary && typeof providerJob.adapterHandoff.runtimeBoundary === "object"
      ? providerJob.adapterHandoff.runtimeBoundary
      : {};
  const operatorState = boundary?.operatorControlState && typeof boundary.operatorControlState === "object"
    ? boundary.operatorControlState
    : {};
  const tenantId = String(
    boundary?.tenantId
      ?? runtimeBoundary.tenant
      ?? runtimeBoundary.tenantId
      ?? operatorState.tenantId
      ?? options.tenantId
      ?? ""
  ).trim();
  const workspaceId = String(
    boundary?.workspaceId
      ?? runtimeBoundary.workspace
      ?? runtimeBoundary.workspaceId
      ?? operatorState.workspaceId
      ?? options.workspaceId
      ?? ""
  ).trim();
  const actorId = String(
    boundary?.actorId
      ?? runtimeBoundary.actorId
      ?? runtimeBoundary.actor
      ?? operatorState.actorId
      ?? options.actorId
      ?? ""
  ).trim();
  const requiredPermissions = normalizeBoundaryList(
    options.requiredPermissions
      ?? runtimeBoundary.requiredPermissions
      ?? lifecycle.requiredPermissions
      ?? ["artifact.preview", "artifact.write", "audit.write"]
  );
  const grantedPermissions = normalizeBoundaryList(
    options.permissions
      ?? runtimeBoundary.permissions
      ?? runtimeBoundary.grantedPermissions
      ?? operatorState.permissions
      ?? []
  );
  const missingPermissions = requiredPermissions.filter((permission) => !grantedPermissions.includes(permission));
  const leaseState = normalizeBoundaryToken(runtimeBoundary.leaseState ?? runtimeBoundary.state ?? "observed").replaceAll("-", "_");
  const auditSink = String(
    runtimeBoundary.auditSink
      ?? runtimeBoundary.auditHandoff?.sink
      ?? boundary?.truthBoundary?.auditSink
      ?? "local-artifact-audit"
  ).trim();
  const isolationKey = [
    "mailchimp.artifact",
    normalizeBoundaryToken(tenantId) || "tenant",
    normalizeBoundaryToken(workspaceId) || "workspace",
  ].join(".");
  const blockers = [
    ...(!tenantId
      ? [{
          code: "artifact_boundary_missing_tenant",
          field: "tenantId",
          action: "bind-tenant-before-artifact-write-set",
        }]
      : []),
    ...(!workspaceId
      ? [{
          code: "artifact_boundary_missing_workspace",
          field: "workspaceId",
          action: "bind-workspace-before-artifact-write-set",
        }]
      : []),
    ...(!actorId
      ? [{
          code: "artifact_boundary_missing_actor",
          field: "actorId",
          action: "bind-actor-before-artifact-write-set",
        }]
      : []),
    ...missingPermissions.map((permission) => ({
      code: "artifact_boundary_permission_missing",
      field: permission,
      action: "refresh-artifact-boundary-permissions",
    })),
    ...(["expired", "revoked", "blocked"].includes(leaseState)
      ? [{
          code: "artifact_boundary_lease_inactive",
          field: "leaseState",
          action: "refresh-artifact-boundary-lease",
        }]
      : []),
  ];
  const status = blockers.length
    ? "blocked"
    : auditSink
      ? "ready"
      : "needs_audit_sink";
  const assuranceSeed = {
    tenantId,
    workspaceId,
    actorId,
    requiredPermissions,
    grantedPermissions,
    missingPermissions,
    leaseState,
    auditSink,
    status,
  };

  return {
    contractVersion: "aios.mailchimp.artifact-boundary-assurance.v1",
    assuranceId: artifactDigest(stableJson(assuranceSeed)),
    status,
    tenantId,
    workspaceId,
    actorId,
    isolationKey,
    leaseState,
    requiredPermissions,
    grantedPermissions,
    missingPermissions,
    auditHandoff: {
      sink: auditSink || "local-artifact-audit",
      eventType: "mailchimp.artifact.boundary.assured",
      subject: boundary?.boundaryId ?? null,
      tenantId,
      workspaceId,
      actorId,
      assuranceDigest: artifactDigest(stableJson(assuranceSeed)),
      requiredBeforeAdapter: true,
    },
    canWriteLocalArtifacts: status === "ready",
    canExposePreview: status === "ready" || missingPermissions.every((permission) => permission === "audit.write"),
    blockers,
    nextAction: blockers[0]?.action ?? (status === "ready" ? "plan-local-artifact-write-set" : "bind-artifact-audit-sink"),
    truthBoundary: {
      source: "deterministic-local-artifact-boundary-assurance",
      externalWrites: false,
    },
  };
}

export function planMailchimpArtifactWriteSet(boundary, options = {}) {
  const issues = [];

  if (!boundary || boundary.kind !== "aios.workspace.boundary_binding") {
    issues.push({
      code: "artifact.boundary_required",
      severity: "error",
      message: "Artifact planning requires an aios.workspace.boundary_binding.",
      path: "boundary.kind",
    });
  }

  const contractArtifact = findArtifact(boundary, "contract");
  const truthArtifact = findArtifact(boundary, "truth-boundary");
  const previewArtifact = findArtifact(boundary, "adapter-preview");
  const analyticsArtifact = findArtifact(boundary, "analytics-export");
  const operatorArtifact = findArtifact(boundary, "operator-control-state");

  for (const [name, artifact] of Object.entries({ contractArtifact, truthArtifact, previewArtifact, analyticsArtifact, operatorArtifact })) {
    if (!artifact) {
      issues.push({
        code: "artifact.plan_missing",
        severity: "error",
        message: `Missing ${name} in Mailchimp boundary artifact plan.`,
        path: "boundary.artifactPlan",
      });
    }
  }

  const members = Array.isArray(options.members) ? options.members : [];
  const maxPreviewRows = boundary?.providerJob?.lifecycleState?.settings?.maxPreviewRows ?? members.length;
  const visibleMembers = members.slice(0, maxPreviewRows);
  if (members.length > visibleMembers.length) {
    issues.push({
      code: "preview.window_truncated",
      severity: "warning",
      message: `Preview window is limited to ${visibleMembers.length} Mailchimp member rows by lifecycle settings.`,
      path: "lifecycle.settings.maxPreviewRows",
    });
  }
  const previewValidationIssues = validatePreviewMembers(
    visibleMembers,
    boundary?.providerJob?.adapterHandoff?.audience?.allowedMemberFields,
  );
  issues.push(...previewValidationIssues);
  const previewRows = buildPreviewRows(boundary, visibleMembers);
  const acceptance = buildAcceptanceContract(boundary, previewRows, previewValidationIssues, options);
  const acceptanceDecision = normalizeAcceptanceDecision(options);
  const boundaryAssurance = deriveArtifactBoundaryAssurance(boundary, options);
  issues.push(...boundaryAssurance.blockers.map((blocker) => ({
    code: blocker.code,
    severity: "error",
    message: `Artifact boundary assurance failed for ${blocker.field}.`,
    path: `boundaryAssurance.${blocker.field}`,
  })));
  const acceptanceReceipt = buildAcceptanceReceipt(
    boundary,
    previewRows,
    acceptance,
    acceptanceDecision,
    previewValidationIssues,
  );
  const records = [];

  if (contractArtifact) {
    records.push(localArtifactRecord(contractArtifact, {
      providerJob: boundary.providerJob,
      verifierContracts: boundary.verifierContracts,
      memoryContract: boundary.memoryContract,
    }));
  }

  if (truthArtifact) {
    records.push(localArtifactRecord(truthArtifact, {
      ...(boundary?.truthBoundary && typeof boundary.truthBoundary === "object" ? boundary.truthBoundary : {}),
      artifactBoundaryAssurance: boundaryAssurance,
    }));
  }

  if (previewArtifact) {
    const previewLines = previewRows.map((row) => stableJson(row));

    records.push(localArtifactRecord(previewArtifact, previewLines.join("\n"), {
      rows: previewLines.length,
      previewContract: {
        validationIssueCount: previewValidationIssues.length,
        acceptanceRequired: acceptance.acceptanceRequired,
        acceptedKeys: acceptance.acceptedKeys,
        rejectedKeys: acceptance.rejectedKeys,
        pendingAcceptanceKeys: acceptance.pendingKeys,
        validationAccepted: acceptance.validationAccepted,
      },
    }));
  }

  if (analyticsArtifact) {
    records.push(localArtifactRecord(
      analyticsArtifact,
      buildAnalyticsArtifactBody(boundary, previewRows, acceptance, acceptanceReceipt, issues),
    ));
  }

  if (operatorArtifact) {
    records.push(localArtifactRecord(operatorArtifact, {
      operatorControlState: boundary?.operatorControlState ?? null,
      boundaryAssurance,
      settingsValidation: boundary?.operatorControlState?.settingsValidation
        ?? boundary?.providerJob?.lifecycleState?.settingsValidation
        ?? null,
      schedulingControls: boundary?.operatorControlState?.schedulingControls
        ?? boundary?.providerJob?.lifecycleState?.schedulingControls
        ?? null,
    }));
  }

  const clientWorkflowHandoff = buildClientWorkflowHandoff(boundary, records, previewRows, acceptance, issues);
  const readiness = buildReadinessSummary(boundary, records, acceptance, issues);
  const persistence = buildArtifactPersistencePlan(boundary, records, options.persistedArtifactState);
  const adapterCommitGate = buildAdapterCommitGate(boundary, records, acceptance, acceptanceReceipt, issues, persistence);
  const analyticsRecord = records.find((record) => record.logicalName === "analytics-export");
  const analyticsBody = analyticsRecord ? JSON.parse(analyticsRecord.content) : buildAnalyticsArtifactBody(
    boundary,
    previewRows,
    acceptance,
    acceptanceReceipt,
    issues,
  );
  const operatorReport = buildOperatorReportEnvelope(
    boundary,
    records,
    acceptance,
    readiness,
    persistence,
    adapterCommitGate,
    analyticsBody,
    issues,
  );
  const workflowActionPacket = compileMailchimpWorkflowActionPacket({
    providerJob: boundary?.providerJob,
    operatorControlState: boundary?.operatorControlState,
    boundaryId: boundary?.boundaryId,
    artifactWriteSet: {
      status: readiness.status,
      boundaryId: boundary?.boundaryId ?? null,
      acceptance,
      clientWorkflowHandoff,
      readiness,
      persistence,
      adapterCommitGate,
      operatorReport,
    },
    previewAcceptance: acceptance,
    clientWorkflowHandoff,
    readiness,
    persistence,
    adapterCommitGate,
    operatorReport,
    boundaryAssurance,
    capabilityGate: adapterCommitGate.capabilityGate,
    blockingIssueCodes: issues.filter((issue) => issue.severity === "error").map((issue) => issue.code),
  });
  const externalReviewBundle = buildExternalReviewBundle(
    boundary,
    records,
    previewRows,
    acceptance,
    acceptanceReceipt,
    readiness,
    persistence,
    adapterCommitGate,
    operatorReport,
    workflowActionPacket,
    issues,
  );
  const clientReviewEnvelope = buildClientReviewEnvelope(
    boundary,
    previewRows,
    acceptance,
    acceptanceReceipt,
    readiness,
    clientWorkflowHandoff,
    persistence,
    adapterCommitGate,
    workflowActionPacket,
    externalReviewBundle,
    issues,
  );
  const commitReadinessCapsule = buildCommitReadinessCapsule(
    boundary,
    acceptance,
    persistence,
    adapterCommitGate,
    workflowActionPacket,
    externalReviewBundle,
    clientReviewEnvelope,
    operatorReport,
    issues,
  );

  return {
    kind: "aios.stdlib.artifact_write_set",
    status: readiness.status,
    boundaryId: boundary?.boundaryId ?? null,
    records,
    previewRows,
    acceptance,
    acceptanceReceipt,
    clientWorkflowHandoff,
    readiness,
    persistence,
    adapterCommitGate,
    operatorReport,
    workflowActionPacket,
    externalReviewBundle,
    clientReviewEnvelope,
    commitReadinessCapsule,
    boundaryAssurance,
    rollback: {
      mode: "delete-created-local-artifacts",
      paths: records.map((record) => record.path),
      artifactManifest: persistence.rollback,
    },
    truthBoundary: boundary?.truthBoundary ?? null,
    issues,
  };
}

export function summarizeMailchimpArtifactWriteSet(writeSet) {
  const records = Array.isArray(writeSet?.records) ? writeSet.records : [];

  return {
    status: writeSet?.status ?? "blocked",
    boundaryId: writeSet?.boundaryId ?? null,
    recordCount: records.length,
    totalBytes: records.reduce((sum, record) => sum + (Number.isInteger(record.bytes) ? record.bytes : 0), 0),
    readinessStatus: writeSet?.readiness?.status ?? writeSet?.status ?? "blocked",
    nextStep: writeSet?.readiness?.nextStep ?? null,
    clientNextAction: writeSet?.clientWorkflowHandoff?.nextAction ?? null,
    pendingAcceptanceCount: writeSet?.acceptance?.pendingCount ?? 0,
    rejectedAcceptanceCount: writeSet?.acceptance?.rejectedCount ?? 0,
    validationAccepted: writeSet?.acceptance?.validationAccepted === true,
    acceptanceReceiptId: writeSet?.acceptanceReceipt?.receiptId ?? null,
    persistenceStatus: writeSet?.persistence?.status ?? null,
    adapterCommitStatus: writeSet?.adapterCommitGate?.status ?? null,
    adapterCommitAllowed: writeSet?.adapterCommitGate?.canCommit === true,
    adapterCommitNextAction: writeSet?.adapterCommitGate?.nextAction ?? null,
    adapterCommitBlockers: Array.isArray(writeSet?.adapterCommitGate?.blockers)
      ? writeSet.adapterCommitGate.blockers.map((blocker) => blocker.code)
      : [],
    operatorReportId: writeSet?.operatorReport?.reportId ?? null,
    operatorReportStatus: writeSet?.operatorReport?.status ?? null,
    operatorReportNextAction: writeSet?.operatorReport?.nextAction ?? null,
    operatorReportBlockingSections: Array.isArray(writeSet?.operatorReport?.blockingSections)
      ? writeSet.operatorReport.blockingSections.map((section) => section.name)
      : [],
    operatorReportCounters: writeSet?.operatorReport?.counters ?? null,
    workflowActionPacketId: writeSet?.workflowActionPacket?.packetId ?? null,
    workflowActionStatus: writeSet?.workflowActionPacket?.status ?? null,
    workflowPrimaryAction: writeSet?.workflowActionPacket?.primaryAction ?? null,
    workflowActiveStepId: writeSet?.workflowActionPacket?.activeStepId ?? null,
    workflowIssueCodes: Array.isArray(writeSet?.workflowActionPacket?.issueSummary?.blockingCodes)
      ? writeSet.workflowActionPacket.issueSummary.blockingCodes
      : [],
    externalReviewBundleId: writeSet?.externalReviewBundle?.bundleId ?? null,
    externalReviewStatus: writeSet?.externalReviewBundle?.status ?? null,
    externalReviewNextAction: writeSet?.externalReviewBundle?.nextAction ?? null,
    externalReviewRestartSafe: writeSet?.externalReviewBundle?.restartSafe === true,
    externalReviewBlockingActions: Array.isArray(writeSet?.externalReviewBundle?.blockingActions)
      ? writeSet.externalReviewBundle.blockingActions.map((entry) => entry.code)
      : [],
    writeSetId: writeSet?.persistence?.writeSetId ?? null,
    readyArtifactCommandCount: writeSet?.persistence?.counters?.readyToWrite ?? 0,
    alreadyWrittenArtifactCount: writeSet?.persistence?.counters?.alreadyWritten ?? 0,
    analyticsExportDigest: records.find((record) => record.logicalName === "analytics-export")?.digest ?? null,
    analyticsExportBytes: records.find((record) => record.logicalName === "analytics-export")?.bytes ?? 0,
    clientReviewEnvelopeId: writeSet?.clientReviewEnvelope?.envelopeId ?? null,
    clientReviewStatus: writeSet?.clientReviewEnvelope?.status ?? null,
    clientReviewNextAction: writeSet?.clientReviewEnvelope?.nextAction ?? null,
    clientReviewRequiredAcknowledgements: Array.isArray(writeSet?.clientReviewEnvelope?.requiredAcknowledgements)
      ? writeSet.clientReviewEnvelope.requiredAcknowledgements.map((entry) => entry.id)
      : [],
    clientReviewBlockingCodes: Array.isArray(writeSet?.clientReviewEnvelope?.blockingExplanations)
      ? writeSet.clientReviewEnvelope.blockingExplanations.map((entry) => entry.code)
      : [],
    commitReadinessCapsuleId: writeSet?.commitReadinessCapsule?.capsuleId ?? null,
    commitReadinessStatus: writeSet?.commitReadinessCapsule?.status ?? null,
    commitReadinessNextAction: writeSet?.commitReadinessCapsule?.nextAction ?? null,
    commitReadinessCanCommit: writeSet?.commitReadinessCapsule?.canCommit === true,
    commitReadinessResumeMode: writeSet?.commitReadinessCapsule?.resume?.mode ?? null,
    commitReadinessActionCodes: Array.isArray(writeSet?.commitReadinessCapsule?.actions)
      ? writeSet.commitReadinessCapsule.actions.map((entry) => entry.code)
      : [],
    commitReadinessGates: writeSet?.commitReadinessCapsule?.gates ?? null,
    boundaryAssuranceStatus: writeSet?.boundaryAssurance?.status ?? null,
    boundaryAssuranceId: writeSet?.boundaryAssurance?.assuranceId ?? null,
    boundaryIsolationKey: writeSet?.boundaryAssurance?.isolationKey ?? null,
    boundaryAuditEvent: writeSet?.boundaryAssurance?.auditHandoff?.eventType ?? null,
    boundaryMissingPermissions: Array.isArray(writeSet?.boundaryAssurance?.missingPermissions)
      ? writeSet.boundaryAssurance.missingPermissions
      : [],
    boundaryNextAction: writeSet?.boundaryAssurance?.nextAction ?? null,
    paths: records.map((record) => record.path),
    digests: records.map((record) => record.digest),
    issueCodes: Array.isArray(writeSet?.issues) ? writeSet.issues.map((issue) => issue.code) : [],
  };
}

export function recoverMailchimpArtifactWriteSet(writeSet = {}, persistedArtifactState = {}) {
  const records = Array.isArray(writeSet.records) ? writeSet.records : [];
  const persisted = normalizeArtifactPersistenceState(persistedArtifactState);
  const persistence = buildArtifactPersistencePlan(
    { boundaryId: writeSet.boundaryId ?? persisted.boundaryId },
    records,
    persisted,
  );
  const missingWrites = persistence.commands.filter((command) => command.status !== "already_written");
  const digestMismatches = persistence.recovery.filter((entry) => entry.code === "artifact_digest_changed");
  const status =
    records.length === 0
      ? "blocked"
      : missingWrites.length === 0 && digestMismatches.length === 0
        ? "recovered"
        : "resume_writes";

  return {
    recoveryVersion: "aios.mailchimp.artifact-recovery.v1",
    status,
    boundaryId: writeSet.boundaryId ?? persisted.boundaryId ?? null,
    writeSetId: persistence.writeSetId,
    restartSafe: true,
    missingWriteCount: missingWrites.length,
    digestMismatchCount: digestMismatches.length,
    resumeCommands: missingWrites.map((command) => ({
      ...command,
      status: "ready_to_resume_write",
    })),
    commitReadiness: writeSet.commitReadinessCapsule
      ? {
          capsuleId: writeSet.commitReadinessCapsule.capsuleId,
          status: writeSet.commitReadinessCapsule.status,
          nextAction: writeSet.commitReadinessCapsule.nextAction,
          canCommit: writeSet.commitReadinessCapsule.canCommit === true,
          resumeMode: writeSet.commitReadinessCapsule.resume?.mode ?? null,
          pendingActionCodes: Array.isArray(writeSet.commitReadinessCapsule.actions)
            ? writeSet.commitReadinessCapsule.actions.map((entry) => entry.code)
            : [],
        }
      : null,
    recovery: [
      ...persistence.recovery,
      ...(writeSet.commitReadinessCapsule?.resume?.allowed === false
        ? [{
            code: "commit_readiness_resume_blocked",
            action: writeSet.commitReadinessCapsule.nextAction ?? "repair-commit-readiness-before-recovery",
          }]
        : []),
      ...(records.length === 0
        ? [
            {
              code: "artifact_write_set_empty",
              action: "rebuild-artifact-write-set-before-recovery",
            },
          ]
        : []),
    ],
    rollback: persistence.rollback,
    truthBoundary: {
      source: "persisted-local-artifact-manifest",
      externalWrites: false,
    },
  };
}
