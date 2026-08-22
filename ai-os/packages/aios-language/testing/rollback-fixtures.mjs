import { createMailchimpClaimFixture } from "./claim-fixtures.mjs";

const FIXTURE_PROTOCOL = "aios.testing.mailchimp-rollback-fixture.v1";

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

function buildRollbackClientState(claimFixture, options = {}) {
  const forceRollback = options.forceRollback === true;
  const blocked = claimFixture.statusHandoff.lifecycle.controls.operatorHold;
  const accepted = claimFixture.previewAcceptance.readiness.ready && !forceRollback;
  const status = forceRollback ? "rollback_requested" : blocked ? "rollback_guarded" : accepted ? "rollback_available" : "rollback_pending";

  return {
    protocol: "aios.client.mailchimp.rollback-state.v1",
    jobId: claimFixture.providerJob.jobId,
    status,
    clientRequestId: claimFixture.compileResult.jobs?.[0]?.requestContract?.clientRequestId ?? "req-claim-fixture",
    idempotencyKey: claimFixture.statusHandoff.runtime.idempotencyKey,
    previewState: claimFixture.previewAcceptance.state,
    controls: {
      canRequestRollback: !blocked,
      requiresOperatorReason: blocked ? "verifier_hold" : "",
      canResumeAfterRollback: !forceRollback && claimFixture.providerContract.externalHandoff.resumeAllowed,
    },
    visibleMessages: [
      {
        slot: "primary",
        text: forceRollback
          ? "Rollback has been requested for the Mailchimp draft."
          : blocked
            ? "Rollback is guarded until verifier evidence is attached."
            : "Rollback is available for the local Mailchimp draft.",
      },
    ],
  };
}

function buildRollbackRuntimeContract(claimFixture, rollbackState, options = {}) {
  const externalWrite = claimFixture.providerJob.commitMode === "external-write";
  const command = externalWrite ? "mailchimp.campaign.archiveDraft" : "mailchimp.campaign.deleteDraft";

  return {
    protocol: "aios.runtime.mailchimp.rollback-contract.v1",
    rollbackId: `rollback:${claimFixture.providerJob.jobId}`,
    command,
    enabled: rollbackState.controls.canRequestRollback,
    idempotencyKey: `${rollbackState.idempotencyKey}:rollback`,
    target: {
      provider: "mailchimp",
      service: "campaigns",
      draftId: claimFixture.runtimeResult.adapterReceipt?.outputs?.campaignDraftId ?? "draft-claim-fixture",
      externalRequestId: claimFixture.providerContract.externalHandoff.externalRequestId,
    },
    persistence: {
      snapshot: "aios:local:marketing:claim-fixture",
      checkpointKey: claimFixture.providerContract.sync.metadata.checkpointKey,
      statusTimeline: claimFixture.providerContract.sync.localCursor,
      writeMode: options.dryRun ? "dry-run" : "append",
    },
    handoffAfterRollback: {
      status: rollbackState.status,
      nextClientStep: rollbackState.controls.canResumeAfterRollback ? "resume-local-preview" : "return-to-campaign-builder",
      recoveryCommand: claimFixture.recoveryHandoff.settings.command,
    },
  };
}

function validateRollbackFixture(rollbackFixture) {
  const issues = [];

  if (!rollbackFixture.clientState.clientRequestId) {
    issues.push(stableIssue("mailchimp.rollback.missing_client_request", "error", "Rollback state must retain the original client request id.", "clientState.clientRequestId"));
  }
  if (!rollbackFixture.runtimeContract.idempotencyKey.endsWith(":rollback")) {
    issues.push(stableIssue("mailchimp.rollback.idempotency_not_scoped", "error", "Rollback idempotency key must be scoped separately from draft creation.", "runtimeContract.idempotencyKey"));
  }
  if (rollbackFixture.runtimeContract.enabled && !rollbackFixture.clientState.controls.canRequestRollback) {
    issues.push(stableIssue("mailchimp.rollback.enabled_drift", "error", "Runtime rollback command cannot be enabled when client controls disable rollback.", "runtimeContract.enabled"));
  }
  if (rollbackFixture.runtimeContract.target.provider !== "mailchimp") {
    issues.push(stableIssue("mailchimp.rollback.provider_mismatch", "error", "Rollback target must remain on the Mailchimp provider.", "runtimeContract.target.provider"));
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issueCodes: [...new Set(issues.map((issue) => issue.code))].sort(),
    enabled: rollbackFixture.runtimeContract.enabled,
    command: rollbackFixture.runtimeContract.command,
    issues,
  };
}

export function createMailchimpRollbackFixture(options = {}) {
  const claimFixture = createMailchimpClaimFixture(options);
  const clientState = buildRollbackClientState(claimFixture, options);
  const runtimeContract = buildRollbackRuntimeContract(claimFixture, clientState, options);
  const validation = validateRollbackFixture({ claimFixture, clientState, runtimeContract });

  return {
    protocol: FIXTURE_PROTOCOL,
    claimFixture,
    clientState,
    runtimeContract,
    validation,
  };
}

export function createMailchimpRollbackFixtureMatrix() {
  return {
    localDraft: createMailchimpRollbackFixture(),
    externalLinked: createMailchimpRollbackFixture({ externalWrite: true }),
    verifierGuarded: createMailchimpRollbackFixture({ blocked: true }),
    requested: createMailchimpRollbackFixture({ forceRollback: true }),
  };
}

export function selfCheckMailchimpRollbackFixtures() {
  const matrix = createMailchimpRollbackFixtureMatrix();
  const entries = Object.entries(matrix).map(([name, fixture]) => ({
    name,
    ok: fixture.validation.ok,
    status: fixture.clientState.status,
    command: fixture.validation.command,
    enabled: fixture.validation.enabled,
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

export const MAILCHIMP_ROLLBACK_FIXTURE_PROTOCOL = FIXTURE_PROTOCOL;
