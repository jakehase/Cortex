import { createMailchimpClaimFixture } from "./claim-fixtures.mjs";

const FIXTURE_PROTOCOL = "aios.testing.mailchimp-recovery-fixture.v1";

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

function buildRecoveryStatusView(claimFixture) {
  const blocked = claimFixture.statusHandoff.lifecycle.controls.operatorHold;
  const stale = claimFixture.statusHandoff.provider.syncStale;
  const preview = claimFixture.previewAcceptance;
  const recovery = claimFixture.recoveryHandoff;

  return {
    protocol: "aios.client.mailchimp.recovery-status.v1",
    jobId: claimFixture.providerJob.jobId,
    visibleState: blocked ? "waiting_for_operator" : stale ? "refresh_required" : "ready_to_resume",
    banner: {
      tone: blocked ? "error" : stale ? "warning" : "success",
      text: blocked
        ? "Verifier evidence is required before Mailchimp recovery can continue."
        : stale
          ? "Mailchimp sync is stale; refresh before replaying the draft command."
          : "Recovery is ready to resume using the saved idempotency key.",
    },
    readiness: {
      ready: recovery.recoverable && !blocked,
      previewReady: preview.readiness.ready,
      validationSummary: preview.readiness.validationSummary,
      nextStep: recovery.settings.command,
    },
    handoff: {
      statusUrl: claimFixture.providerContract.externalHandoff.statusUrl,
      nextAction: claimFixture.statusHandoff.lifecycle.nextAction,
      recoveryCommand: recovery.settings.command,
      resumeAllowed: claimFixture.providerContract.externalHandoff.resumeAllowed,
    },
  };
}

function buildRecoveryActionPlan(claimFixture) {
  const recovery = claimFixture.recoveryHandoff;
  const status = buildRecoveryStatusView(claimFixture);
  const idempotencyKey = claimFixture.statusHandoff.runtime.idempotencyKey;
  const checkpointKey = claimFixture.providerContract.sync.metadata.checkpointKey;

  return {
    protocol: "aios.command.mailchimp.recovery-plan.v1",
    commandId: `recovery:${claimFixture.providerJob.jobId}:${recovery.settings.command}`,
    idempotencyKey,
    checkpointKey,
    restartSafe: claimFixture.statusHandoff.provider.restartSafe,
    selectedCommand: recovery.settings.command,
    commands: [
      {
        name: "collect_verifier_evidence",
        enabled: status.visibleState === "waiting_for_operator",
        idempotent: true,
        persists: ["verifier-report", "operator-note"],
      },
      {
        name: "refresh_provider_sync_before_replay",
        enabled: status.visibleState === "refresh_required",
        idempotent: true,
        persists: ["provider-sync-cursor", "status-timeline"],
      },
      {
        name: "retry_same_idempotency_key",
        enabled: status.visibleState === "ready_to_resume",
        idempotent: true,
        persists: ["runtime-receipt", "status-timeline"],
      },
    ],
    audit: {
      required: true,
      evidence: recovery.steps.map((step) => step.evidence),
      statusOnFailure: claimFixture.providerJob.operationalHealth.failureState.statusOnFailure,
    },
  };
}

function validateRecoveryFixture(recoveryFixture) {
  const issues = [];
  const enabledCommands = recoveryFixture.actionPlan.commands.filter((command) => command.enabled);

  if (!recoveryFixture.statusView.readiness.nextStep) {
    issues.push(stableIssue("mailchimp.recovery.missing_next_step", "error", "Recovery status must expose the next step for clients.", "statusView.readiness.nextStep"));
  }
  if (enabledCommands.length !== 1) {
    issues.push(stableIssue("mailchimp.recovery.command_selection_ambiguous", "error", "Exactly one recovery command should be enabled for the current state.", "actionPlan.commands"));
  }
  if (recoveryFixture.actionPlan.idempotencyKey !== recoveryFixture.claimFixture.statusHandoff.runtime.idempotencyKey) {
    issues.push(stableIssue("mailchimp.recovery.idempotency_drift", "error", "Recovery command must reuse runtime idempotency key.", "actionPlan.idempotencyKey"));
  }
  if (recoveryFixture.statusView.handoff.resumeAllowed && recoveryFixture.statusView.visibleState === "waiting_for_operator") {
    issues.push(stableIssue("mailchimp.recovery.resume_while_blocked", "error", "Blocked operator recovery must not be resumable.", "statusView.handoff.resumeAllowed"));
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issueCodes: [...new Set(issues.map((issue) => issue.code))].sort(),
    selectedCommand: enabledCommands[0]?.name ?? "",
    issues,
  };
}

export function createMailchimpRecoveryFixture(options = {}) {
  const claimFixture = createMailchimpClaimFixture(options);
  const statusView = buildRecoveryStatusView(claimFixture);
  const actionPlan = buildRecoveryActionPlan(claimFixture);
  const validation = validateRecoveryFixture({ claimFixture, statusView, actionPlan });

  return {
    protocol: FIXTURE_PROTOCOL,
    claimFixture,
    statusView,
    actionPlan,
    validation,
  };
}

export function createMailchimpRecoveryFixtureMatrix() {
  return {
    ready: createMailchimpRecoveryFixture(),
    refreshRequired: createMailchimpRecoveryFixture({ degraded: true }),
    operatorBlocked: createMailchimpRecoveryFixture({ blocked: true }),
  };
}

export function selfCheckMailchimpRecoveryFixtures() {
  const matrix = createMailchimpRecoveryFixtureMatrix();
  const entries = Object.entries(matrix).map(([name, fixture]) => ({
    name,
    ok: fixture.validation.ok,
    state: fixture.statusView.visibleState,
    selectedCommand: fixture.validation.selectedCommand,
    issueCodes: fixture.validation.issueCodes,
    nextStep: fixture.statusView.readiness.nextStep,
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

export const MAILCHIMP_RECOVERY_FIXTURE_PROTOCOL = FIXTURE_PROTOCOL;
