import { createMailchimpClaimFixture } from "./claim-fixtures.mjs";

const FIXTURE_PROTOCOL = "aios.testing.mailchimp-approval-fixture.v1";

function compactString(value) {
  return String(value ?? "").trim();
}

function stableIssue(code, severity, message, field = "") {
  return {
    code: compactString(code),
    severity: compactString(severity || "warning"),
    field: compactString(field),
    message: compactString(message),
  };
}

function buildPersistedApprovalState(claimFixture, options = {}) {
  const decision = compactString(options.decision || "pending");
  const allowedDecision = ["pending", "approved", "rejected"].includes(decision) ? decision : "pending";
  const preview = claimFixture.previewAcceptance;
  const status = allowedDecision === "approved"
    ? "approved_restart_safe"
    : allowedDecision === "rejected"
      ? "rejected_restart_safe"
      : preview.readiness.ready
        ? "awaiting_operator_approval"
        : "awaiting_readiness";

  return {
    protocol: "aios.state.mailchimp.approval.v1",
    stateId: `approval:${claimFixture.providerJob.jobId}`,
    status,
    decision: allowedDecision,
    restartSafe: true,
    idempotencyKey: claimFixture.statusHandoff.runtime.idempotencyKey,
    persistedAt: "deterministic-fixture-clock",
    storage: {
      snapshot: "aios:local:marketing:claim-fixture",
      key: `approval:${claimFixture.providerJob.jobId}:${claimFixture.statusHandoff.runtime.idempotencyKey}`,
      writeMode: "compare-and-swap",
    },
    gates: {
      previewReady: preview.readiness.ready,
      verifierPassed: claimFixture.verifierReport.status === "passed",
      providerResumeAllowed: claimFixture.providerContract.externalHandoff.resumeAllowed,
    },
  };
}

function buildApprovalCommands(claimFixture, approvalState) {
  const canApprove = approvalState.decision === "pending" && Object.values(approvalState.gates).every(Boolean);
  const canReject = approvalState.decision === "pending";
  const commandBase = `approval:${claimFixture.providerJob.jobId}`;

  return {
    protocol: "aios.command.mailchimp.approval.v1",
    commandSetId: commandBase,
    commands: [
      {
        name: "approve_mailchimp_preview",
        enabled: canApprove,
        idempotencyKey: `${approvalState.idempotencyKey}:approve`,
        persistsState: "approved_restart_safe",
        nextClientStep: claimFixture.providerJob.commitMode === "external-write" ? "commit-provider-draft" : "commit-local-draft",
      },
      {
        name: "reject_mailchimp_preview",
        enabled: canReject,
        idempotencyKey: `${approvalState.idempotencyKey}:reject`,
        persistsState: "rejected_restart_safe",
        nextClientStep: "return-to-campaign-builder",
      },
      {
        name: "resume_approval_after_restart",
        enabled: approvalState.restartSafe,
        idempotencyKey: `${approvalState.idempotencyKey}:resume-approval`,
        persistsState: approvalState.status,
        nextClientStep: approvalState.status,
      },
    ],
  };
}

function buildApprovalRecoveryPath(claimFixture, approvalState, commandSet) {
  const enabledCommandNames = commandSet.commands.filter((command) => command.enabled).map((command) => command.name);

  return {
    protocol: "aios.recovery.mailchimp.approval.v1",
    recoverable: true,
    statusAfterRestart: approvalState.status,
    restoreFrom: approvalState.storage.key,
    nextStep: enabledCommandNames.includes("approve_mailchimp_preview")
      ? "approve_mailchimp_preview"
      : enabledCommandNames.includes("reject_mailchimp_preview")
        ? "reject_mailchimp_preview"
        : "resume_approval_after_restart",
    visibleSummary: {
      ready: approvalState.gates.previewReady && approvalState.gates.providerResumeAllowed,
      validationSummary: claimFixture.previewAcceptance.readiness.validationSummary,
      issueCodes: claimFixture.validation.issueCodes,
    },
  };
}

function validateApprovalFixture(approvalFixture) {
  const issues = [];
  const commandKeys = approvalFixture.commandSet.commands.map((command) => command.idempotencyKey);
  const uniqueCommandKeys = new Set(commandKeys);

  if (approvalFixture.approvalState.restartSafe !== true) {
    issues.push(stableIssue("mailchimp.approval.not_restart_safe", "error", "Approval state must be restart safe.", "approvalState.restartSafe"));
  }
  if (uniqueCommandKeys.size !== commandKeys.length) {
    issues.push(stableIssue("mailchimp.approval.duplicate_command_key", "error", "Approval commands must have distinct idempotency keys.", "commandSet.commands"));
  }
  if (!approvalFixture.recoveryPath.restoreFrom.includes(approvalFixture.approvalState.idempotencyKey)) {
    issues.push(stableIssue("mailchimp.approval.restore_key_drift", "error", "Approval recovery path must restore from the persisted idempotent approval state.", "recoveryPath.restoreFrom"));
  }
  if (approvalFixture.approvalState.decision === "approved" && approvalFixture.commandSet.commands.some((command) => command.name === "approve_mailchimp_preview" && command.enabled)) {
    issues.push(stableIssue("mailchimp.approval.reapprove_enabled", "error", "Approved state must not enable a second approval command.", "commandSet.commands"));
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issueCodes: [...new Set(issues.map((issue) => issue.code))].sort(),
    status: approvalFixture.approvalState.status,
    nextStep: approvalFixture.recoveryPath.nextStep,
    issues,
  };
}

export function createMailchimpApprovalFixture(options = {}) {
  const claimFixture = createMailchimpClaimFixture(options);
  const approvalState = buildPersistedApprovalState(claimFixture, options);
  const commandSet = buildApprovalCommands(claimFixture, approvalState);
  const recoveryPath = buildApprovalRecoveryPath(claimFixture, approvalState, commandSet);
  const validation = validateApprovalFixture({ claimFixture, approvalState, commandSet, recoveryPath });

  return {
    protocol: FIXTURE_PROTOCOL,
    claimFixture,
    approvalState,
    commandSet,
    recoveryPath,
    validation,
  };
}

export function createMailchimpApprovalFixtureMatrix() {
  return {
    pendingReady: createMailchimpApprovalFixture(),
    pendingBlocked: createMailchimpApprovalFixture({ blocked: true }),
    approved: createMailchimpApprovalFixture({ decision: "approved" }),
    rejected: createMailchimpApprovalFixture({ decision: "rejected" }),
  };
}

export function selfCheckMailchimpApprovalFixtures() {
  const matrix = createMailchimpApprovalFixtureMatrix();
  const entries = Object.entries(matrix).map(([name, fixture]) => ({
    name,
    ok: fixture.validation.ok,
    status: fixture.validation.status,
    nextStep: fixture.validation.nextStep,
    issueCodes: fixture.validation.issueCodes,
  }));
  const failures = entries.filter((entry) => !entry.ok);

  return {
    protocol: `${FIXTURE_PROTOCOL}.self-check`,
    ok: failures.length === 0,
    checked: entries.length,
    failures: failures.map((failure) => failure.name),
    entries,
  };
}

export const MAILCHIMP_APPROVAL_FIXTURE_PROTOCOL = FIXTURE_PROTOCOL;
