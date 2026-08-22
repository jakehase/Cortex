import { buildMailchimpClaimPacket, summarizeMailchimpClaimStatus } from "../runtime/claim-binding.mjs";
import { compileAiosSource, handoffToRuntimeAdapter } from "../index.mjs";

const FIXTURE_PROTOCOL = "aios.testing.mailchimp-claim-fixture.v1";
const SOURCE_NAME = "mailchimp-claim-fixture.aios";

function compactString(value) {
  return String(value ?? "").trim();
}

function uniqueSorted(values) {
  return [...new Set(values.map(compactString).filter(Boolean))].sort();
}

function stableIssue(code, severity, message, field = "") {
  return {
    code: compactString(code),
    severity: compactString(severity || "warning"),
    field: compactString(field),
    message: compactString(message),
  };
}

function findJob(compileResult) {
  return compileResult?.jobs?.[0] ?? null;
}

function buildFixtureSource(overrides = {}) {
  const workflow = compactString(overrides.workflow || "mailchimp-claim-fixture");
  const tenantId = compactString(overrides.tenantId || "tenant-alpha");
  const workspaceId = compactString(overrides.workspaceId || "marketing");
  const idempotencyKey = compactString(overrides.idempotencyKey || "claim-fixture-campaign-001");
  const externalWrite = overrides.externalWrite === true;
  const capabilityMode = externalWrite ? "external-write" : "local-audience";

  return [
    "job mailchimp-claim-fixture",
    "adapter mailchimp",
    "action campaign.draft",
    `tenant ${tenantId}`,
    `workspace ${workspaceId}`,
    `request channel=mailchimp-ui workflow=${workflow} clientRequestId=req-claim-fixture idempotencyKey=${idempotencyKey}`,
    "role name=mailchimp-operator,mailchimp-runtime default=mailchimp-runtime",
    "permission allow=mailchimp.campaigns,status:timeline.write mode=local-only",
    "boundary mode=tenant-workspace tenantIsolation=true workspaceIsolation=true",
    "audit required=true handoff=claim-fixture-audit evidence=runtime-receipt",
    "client status=PreviewReady handoff=ClaimFixture visible=subject,audience,status persist=campaignDraft,claimPacket",
    "persist snapshot=aios:local:marketing:claim-fixture restart=claim-fixture:restart mode=idempotent-replay status=queued",
    "checkpoint key=claim-fixture:checkpoint:draft status=pending required=true",
    "command name=mailchimp.campaign.draft idempotency=claim-fixture:draft checkpoint=claim-fixture:checkpoint:draft replayable=true rollback=mailchimp.campaign.deleteDraft",
    "handoff title=ClaimFixture next=review-campaign message=preview-ready statusUrl=workspace://marketing/status/claim-fixture",
    "health status=healthy check=mailchimp-api retry=2 backoffMs=500",
    `capability mailchimp.campaigns write ${capabilityMode}`,
    "capability status:timeline.write use local-status",
    "memory read localAudience campaignTemplate",
    "memory write campaignDraft statusTimeline claimPacket",
    "memory scope marketing",
    "param audience=localAudience campaignType=regular subject=FixtureDigest",
    "truth declared campaign content is supplied by local memory",
    "verify campaignDraft.subject exists",
    "verify claimPacket.status asserted",
    "recover retry=2 status=operator_review_required",
    "rollback delete-draft",
  ].join("\n");
}

function buildVerifierReport({ blocked = false, degraded = false } = {}) {
  const checks = [
    {
      name: "campaignDraft.subject.exists",
      required: true,
      status: blocked ? "failed" : "passed",
      issueCodes: blocked ? ["mailchimp.fixture.subject_missing"] : [],
    },
    {
      name: "claimPacket.status.asserted",
      required: true,
      status: blocked ? "failed" : "passed",
      issueCodes: blocked ? ["mailchimp.fixture.claim_not_asserted"] : [],
    },
    {
      name: "adapterRecovery.status.handoff",
      required: false,
      status: degraded ? "failed" : "passed",
      issueCodes: degraded ? ["mailchimp.fixture.recovery_status_degraded"] : [],
    },
  ];
  const requiredFailed = checks.filter((check) => check.required && check.status !== "passed");
  const optionalFailed = checks.filter((check) => !check.required && check.status !== "passed");

  return {
    kind: "aios.verifier.execution_report",
    reportId: blocked ? "verifier:claim-fixture:blocked" : degraded ? "verifier:claim-fixture:degraded" : "verifier:claim-fixture:asserted",
    status: requiredFailed.length ? "failed" : optionalFailed.length ? "degraded" : "passed",
    checks,
    summary: {
      total: checks.length,
      requiredFailed: requiredFailed.length,
      optionalFailed: optionalFailed.length,
      issueCodes: uniqueSorted(checks.flatMap((check) => check.issueCodes)),
    },
  };
}

function buildStatusHandoff(job, runtimeResult, options = {}) {
  const degraded = options.degraded === true;
  const blocked = options.blocked === true;
  const nextAction = blocked ? "await_operator" : "review-campaign";

  return {
    protocol: "aios.status-handoff.mailchimp.fixture.v1",
    state: blocked ? "waiting_for_verifier" : degraded ? "recovering" : "queued",
    terminal: false,
    jobId: job?.id ?? null,
    adapter: job?.adapter ?? "mailchimp",
    workflow: job?.requestContract?.workflow ?? "mailchimp-claim-fixture",
    lifecycle: {
      nextAction,
      controls: {
        operatorHold: blocked,
        verifierRequired: true,
      },
    },
    provider: {
      capabilitySatisfied: !blocked,
      syncStale: degraded,
      syncReady: !degraded,
      restartSafe: !blocked,
      externalHandoffState: options.externalWrite ? "linked" : "local_only",
      externalRequestId: options.externalWrite ? "mailchimp-ext-claim-fixture" : "",
    },
    readiness: {
      ready: !blocked,
      nextStep: nextAction,
      validationSummary: blocked ? "verifier evidence required before Mailchimp resume" : "ready for operator preview",
    },
    runtime: {
      runtimeId: runtimeResult?.runtimeId ?? null,
      adapterStatus: runtimeResult?.adapterReceipt?.status ?? "accepted",
      idempotencyKey: job?.requestContract?.idempotencyKey ?? "claim-fixture-campaign-001",
    },
  };
}

function buildRecoveryHandoff(statusHandoff, options = {}) {
  const retryMode = statusHandoff.provider.syncStale ? "refresh_provider_sync_before_replay" : "retry_same_idempotency_key";
  const command = statusHandoff.readiness.ready ? retryMode : "collect_verifier_evidence";

  return {
    protocol: "aios.recovery-handoff.mailchimp.fixture.v1",
    recoverable: true,
    requiresRollback: options.requiresRollback === true,
    status: statusHandoff,
    settings: {
      enabled: true,
      command,
      maxAttempts: 2,
      backoffSeconds: statusHandoff.provider.syncStale ? 90 : 30,
      requireVerifierBeforeResume: true,
      operatorApprovalRequired: statusHandoff.lifecycle.controls.operatorHold,
    },
    steps: [
      {
        action: command,
        requiresOperator: statusHandoff.lifecycle.controls.operatorHold,
        evidence: statusHandoff.lifecycle.controls.operatorHold ? "verifier-report" : "idempotency-key",
      },
      {
        action: "resume_after_descriptor_repair",
        requiresOperator: false,
        evidence: "runtime-receipt",
      },
    ],
  };
}

function buildProviderJob(job, statusHandoff, recoveryHandoff, options = {}) {
  const blocked = statusHandoff.lifecycle.controls.operatorHold;
  const degraded = statusHandoff.provider.syncStale;

  return {
    kind: "aios.provider.job.mailchimp.fixture",
    jobId: job?.id ?? "aios-1-mailchimp-claim-fixture",
    provider: "mailchimp",
    product: "Mailchimp",
    status: blocked ? "blocked" : degraded ? "degraded" : "accepted",
    commitMode: options.externalWrite ? "external-write" : "local-draft",
    lifecycleState: statusHandoff.lifecycle,
    operationalHealth: {
      status: blocked ? "blocked" : degraded ? "degraded" : "healthy",
      retryPlan: {
        mode: recoveryHandoff.settings.command,
        maxAttempts: recoveryHandoff.settings.maxAttempts,
        backoffSeconds: recoveryHandoff.settings.backoffSeconds,
      },
      failureState: {
        terminal: false,
        statusOnFailure: "operator_review_required",
      },
    },
    previewAcceptance: {
      acceptanceGate: {
        required: true,
        mode: "operator-preview",
        status: blocked ? "blocked" : "ready",
      },
      previewWindow: {
        maxRows: 25,
      },
    },
    recovery: {
      statusOnAdapterFailure: "operator_review_required",
      handoffProtocol: recoveryHandoff.protocol,
      nextCommand: recoveryHandoff.settings.command,
    },
    issues: blocked
      ? [stableIssue("mailchimp.fixture.verifier_hold", "error", "Verifier evidence is required before Mailchimp resume.", "verifier")]
      : degraded
        ? [stableIssue("mailchimp.fixture.provider_sync_stale", "warning", "Provider sync must refresh before replay.", "provider.sync")]
        : [],
  };
}

function buildArtifactPlan() {
  return [
    {
      logicalName: "campaignDraft",
      path: "workspace://marketing/campaigns/claim-fixture/draft.json",
      mediaType: "application/json",
      writeMode: "local-only",
    },
    {
      logicalName: "statusTimeline",
      path: "memory://marketing/status/claim-fixture.timeline",
      mediaType: "application/x-ndjson",
      writeMode: "append",
    },
  ];
}

function buildProviderContract(job, statusHandoff, recoveryHandoff, options = {}) {
  const externalWrite = options.externalWrite === true;
  const blocked = statusHandoff.lifecycle.controls.operatorHold;
  const degraded = statusHandoff.provider.syncStale;
  const requestedCapabilities = uniqueSorted((job?.capabilities ?? []).map((capability) => capability.name));
  const grantedCapabilities = blocked
    ? requestedCapabilities.filter((capability) => capability !== "mailchimp.campaigns")
    : requestedCapabilities;
  const deniedCapabilities = requestedCapabilities.filter((capability) => !grantedCapabilities.includes(capability));
  const syncState = blocked ? "verifier_hold" : degraded ? "stale" : externalWrite ? "external_linked" : "local_ready";

  return {
    kind: "aios.provider.contract.mailchimp.fixture",
    provider: "mailchimp",
    service: "campaigns",
    contractId: `mailchimp:campaigns:${job?.requestContract?.workspaceId ?? "marketing"}:${externalWrite ? "external" : "local"}`,
    jobId: job?.id ?? null,
    tenantId: job?.requestContract?.tenantId ?? "tenant-alpha",
    workspaceId: job?.requestContract?.workspaceId ?? "marketing",
    negotiation: {
      status: deniedCapabilities.length ? "partial" : "accepted",
      requestedCapabilities,
      grantedCapabilities,
      deniedCapabilities,
      requiredBeforeCommit: [
        "mailchimp.campaigns",
        "status:timeline.write",
      ],
      commitMode: externalWrite ? "external-write" : "local-draft",
      fallbackMode: blocked ? "operator-verifier-hold" : "local-preview",
    },
    sync: {
      state: syncState,
      stale: degraded,
      localCursor: "memory://marketing/status/claim-fixture.timeline#latest",
      providerCursor: externalWrite ? "mailchimp://campaigns/draft-claim-fixture" : "",
      metadata: {
        audienceRef: job?.params?.audience ?? "localAudience",
        campaignType: job?.params?.campaignType ?? "regular",
        idempotencyKey: job?.requestContract?.idempotencyKey ?? "claim-fixture-campaign-001",
        checkpointKey: job?.persistedState?.checkpoints?.[0]?.key ?? "claim-fixture:checkpoint:draft",
      },
    },
    externalHandoff: {
      state: statusHandoff.provider.externalHandoffState,
      externalRequestId: statusHandoff.provider.externalRequestId,
      statusUrl: job?.workflowHandoff?.statusUrl ?? "workspace://marketing/status/claim-fixture",
      nextAction: statusHandoff.lifecycle.nextAction,
      recoveryCommand: recoveryHandoff.settings.command,
      resumeAllowed: statusHandoff.readiness.ready && !blocked,
    },
  };
}

function buildPreviewAcceptanceContract(job, statusHandoff, recoveryHandoff, providerContract, verifierReport, options = {}) {
  const blocked = statusHandoff.lifecycle.controls.operatorHold;
  const degraded = statusHandoff.provider.syncStale;
  const previewRows = [
    {
      label: "Subject",
      value: job?.params?.subject ?? "FixtureDigest",
      source: "campaignDraft.subject",
      accepted: !blocked,
    },
    {
      label: "Audience",
      value: job?.params?.audience ?? "localAudience",
      source: "memory.localAudience",
      accepted: !blocked,
    },
    {
      label: "Campaign type",
      value: job?.params?.campaignType ?? "regular",
      source: "request.param.campaignType",
      accepted: true,
    },
    {
      label: "Provider sync",
      value: providerContract.sync.state,
      source: "providerContract.sync.state",
      accepted: !degraded && !blocked,
    },
  ];
  const failedChecks = verifierReport.checks.filter((check) => check.status !== "passed");
  const nextStep = blocked
    ? "attach-verifier-evidence"
    : degraded
      ? "refresh-provider-sync"
      : options.externalWrite
        ? "open-mailchimp-linked-draft"
        : "accept-local-draft-preview";

  return {
    protocol: "aios.preview-acceptance.mailchimp.fixture.v1",
    previewId: `preview:mailchimp:${job?.requestContract?.workspaceId ?? "marketing"}:claim-fixture`,
    jobId: job?.id ?? null,
    visibleToClient: true,
    state: blocked ? "acceptance_blocked" : degraded ? "needs_sync_refresh" : "ready_for_acceptance",
    readiness: {
      ready: !blocked && !degraded,
      acceptsExternalCommit: options.externalWrite === true && !blocked && !degraded,
      localPreviewAvailable: true,
      validationSummary: failedChecks.length
        ? `${failedChecks.length} verifier check(s) need attention before acceptance`
        : "Preview is validated and ready for operator acceptance",
    },
    acceptance: {
      required: true,
      mode: options.externalWrite ? "provider-linked-preview" : "local-preview",
      command: nextStep,
      idempotencyKey: job?.requestContract?.idempotencyKey ?? "claim-fixture-campaign-001",
      acceptedArtifacts: previewRows.filter((row) => row.accepted).map((row) => row.source),
      blockedArtifacts: previewRows.filter((row) => !row.accepted).map((row) => row.source),
    },
    summary: {
      title: "Mailchimp campaign draft",
      subtitle: blocked
        ? "Verifier evidence is required before the draft can be accepted."
        : degraded
          ? "Provider sync should be refreshed before accepting the draft."
          : "Review and accept the Mailchimp draft preview.",
      rows: previewRows,
    },
    nextSteps: [
      {
        action: nextStep,
        label: blocked ? "Attach verifier evidence" : degraded ? "Refresh provider sync" : "Accept draft preview",
        enabled: !blocked,
        reason: blocked ? "blocked_by_verifier" : degraded ? "provider_sync_stale" : "ready",
      },
      {
        action: recoveryHandoff.settings.command,
        label: "Recovery command",
        enabled: recoveryHandoff.recoverable,
        reason: recoveryHandoff.settings.command,
      },
    ],
  };
}

function validateClaimFixture(fixture) {
  const issues = [];
  const job = findJob(fixture.compileResult);
  const packet = fixture.claimPacket;
  const providerContract = fixture.providerContract;
  const previewAcceptance = fixture.previewAcceptance;
  const diagnostics = Array.isArray(fixture.compileResult?.diagnostics) ? fixture.compileResult.diagnostics : [];
  const compileErrors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const reviewWarnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");

  if (!job) issues.push(stableIssue("mailchimp.fixture.missing_job", "error", "Fixture compile did not produce a kernel job.", "compileResult.jobs"));
  if (compileErrors.length) {
    issues.push(stableIssue("mailchimp.fixture.compile_errors", "error", "Fixture source must compile without blocking diagnostics.", "compileResult.diagnostics"));
  }
  if (job?.adapter !== "mailchimp") issues.push(stableIssue("mailchimp.fixture.adapter_mismatch", "error", "Fixture job must target the Mailchimp adapter.", "job.adapter"));
  if (!job?.capabilities?.some((capability) => capability.name === "mailchimp.campaigns")) {
    issues.push(stableIssue("mailchimp.fixture.missing_campaign_capability", "error", "Fixture must compile a Mailchimp campaign capability.", "job.capabilities"));
  }
  if (!packet?.claims?.some((claim) => claim.claim === "adapter.recovery.status_handoff")) {
    issues.push(stableIssue("mailchimp.fixture.missing_recovery_claim", "error", "Claim packet must include adapter recovery/status handoff evidence.", "claimPacket.claims"));
  }
  if (packet?.handoff?.nextAction !== fixture.statusHandoff.lifecycle.nextAction) {
    issues.push(stableIssue("mailchimp.fixture.handoff_next_action_drift", "error", "Claim handoff next action must match status handoff lifecycle.", "claimPacket.handoff.nextAction"));
  }
  if (fixture.recoveryHandoff.settings.requireVerifierBeforeResume !== true) {
    issues.push(stableIssue("mailchimp.fixture.verifier_resume_guard_missing", "error", "Recovery handoff must require verifier evidence before resume.", "recoveryHandoff.settings"));
  }
  if (providerContract?.provider !== "mailchimp" || providerContract?.service !== "campaigns") {
    issues.push(stableIssue("mailchimp.fixture.provider_contract_mismatch", "error", "Provider contract must describe the Mailchimp campaigns service.", "providerContract"));
  }
  if (!providerContract?.negotiation?.grantedCapabilities?.includes("status:timeline.write")) {
    issues.push(stableIssue("mailchimp.fixture.status_capability_not_granted", "error", "Provider contract must grant status timeline writes for handoff visibility.", "providerContract.negotiation"));
  }
  if (providerContract?.externalHandoff?.nextAction !== fixture.statusHandoff.lifecycle.nextAction) {
    issues.push(stableIssue("mailchimp.fixture.external_handoff_drift", "error", "Provider external handoff next action must match status handoff lifecycle.", "providerContract.externalHandoff.nextAction"));
  }
  if (previewAcceptance?.visibleToClient !== true) {
    issues.push(stableIssue("mailchimp.fixture.preview_not_visible", "error", "Preview acceptance contract must be visible to clients.", "previewAcceptance.visibleToClient"));
  }
  if (previewAcceptance?.acceptance?.idempotencyKey !== job?.requestContract?.idempotencyKey) {
    issues.push(stableIssue("mailchimp.fixture.preview_idempotency_drift", "error", "Preview acceptance command must reuse the compiled request idempotency key.", "previewAcceptance.acceptance.idempotencyKey"));
  }
  if (previewAcceptance?.readiness?.ready && !providerContract?.externalHandoff?.resumeAllowed) {
    issues.push(stableIssue("mailchimp.fixture.preview_resume_drift", "error", "Ready previews must agree with provider resume allowance.", "previewAcceptance.readiness.ready"));
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issueCodes: uniqueSorted(issues.map((issue) => issue.code)),
    compileDiagnostics: {
      errors: compileErrors.length,
      warnings: reviewWarnings.length,
      warningCodes: uniqueSorted(reviewWarnings.map((diagnostic) => diagnostic.code)),
    },
    issues,
  };
}

export function createMailchimpClaimFixture(options = {}) {
  const source = buildFixtureSource(options);
  const compileResult = compileAiosSource(source, { sourceName: SOURCE_NAME, target: "mailchimp-claim-fixture" });
  const job = findJob(compileResult);
  const runtimeResult = handoffToRuntimeAdapter(compileResult, {
    adapter: "mailchimp",
    status: options.blocked ? "held" : "accepted",
    receiptId: "receipt:mailchimp:claim-fixture",
    externalWrite: options.externalWrite === true,
    tenantId: options.tenantId || "tenant-alpha",
    workspaceId: options.workspaceId || "marketing",
    outputs: {
      campaignDraftId: "draft-claim-fixture",
      statusTimelineId: "timeline-claim-fixture",
    },
    operationalHealth: {
      status: options.degraded ? "degraded" : "healthy",
    },
  });
  const statusHandoff = buildStatusHandoff(job, runtimeResult, options);
  const recoveryHandoff = buildRecoveryHandoff(statusHandoff, options);
  const providerJob = buildProviderJob(job, statusHandoff, recoveryHandoff, options);
  const providerContract = buildProviderContract(job, statusHandoff, recoveryHandoff, options);
  const verifierReport = buildVerifierReport(options);
  const previewAcceptance = buildPreviewAcceptanceContract(job, statusHandoff, recoveryHandoff, providerContract, verifierReport, options);
  const claimPacket = buildMailchimpClaimPacket({
    providerJob,
    artifactPlan: buildArtifactPlan(),
    verifierReport,
    operatorControlState: {
      stateId: "operator:claim-fixture",
      nextAction: statusHandoff.lifecycle.nextAction,
      availableCommands: recoveryHandoff.steps.map((step) => step.action),
      blockedCommands: statusHandoff.lifecycle.controls.operatorHold ? ["resume_after_descriptor_repair"] : [],
    },
    continuationPacket: {
      packetId: "continuation:claim-fixture",
      status: statusHandoff.state,
      nextClientStep: statusHandoff.lifecycle.nextAction,
      retryBackoff: {
        mode: recoveryHandoff.settings.command,
        seconds: recoveryHandoff.settings.backoffSeconds,
      },
      resumable: {
        allowed: !statusHandoff.lifecycle.controls.operatorHold,
        reason: "operator_review_required",
      },
    },
    analyticsExport: {
      exportId: "analytics:claim-fixture",
      exportReady: !options.blocked,
    },
    workspaceBoundaryId: "workspace-boundary:marketing:claim-fixture",
  });
  const statusSummary = summarizeMailchimpClaimStatus(claimPacket);
  const validation = validateClaimFixture({ compileResult, runtimeResult, statusHandoff, recoveryHandoff, claimPacket, providerContract, previewAcceptance });

  return {
    protocol: FIXTURE_PROTOCOL,
    sourceName: SOURCE_NAME,
    source,
    compileResult,
    runtimeResult,
    statusHandoff,
    recoveryHandoff,
    providerJob,
    providerContract,
    verifierReport,
    previewAcceptance,
    claimPacket,
    statusSummary,
    validation,
  };
}

export function createMailchimpClaimFixtureMatrix() {
  return {
    asserted: createMailchimpClaimFixture(),
    degradedRecovery: createMailchimpClaimFixture({ degraded: true }),
    verifierBlocked: createMailchimpClaimFixture({ blocked: true }),
    externalLinked: createMailchimpClaimFixture({ externalWrite: true }),
  };
}

export function selfCheckMailchimpClaimFixtures() {
  const matrix = createMailchimpClaimFixtureMatrix();
  const entries = Object.entries(matrix).map(([name, fixture]) => ({
    name,
    status: fixture.claimPacket.status,
    ok: fixture.validation.ok,
    issueCodes: fixture.validation.issueCodes,
    nextAction: fixture.statusSummary.nextAction,
    previewState: fixture.previewAcceptance.state,
    previewReady: fixture.previewAcceptance.readiness.ready,
    blockedClaims: fixture.statusSummary.blockedClaims,
    negotiationStatus: fixture.providerContract.negotiation.status,
    syncState: fixture.providerContract.sync.state,
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

export function createMailchimpProviderContractFixture(options = {}) {
  const fixture = createMailchimpClaimFixture(options);

  return {
    protocol: `${FIXTURE_PROTOCOL}.provider-contract`,
    providerContract: fixture.providerContract,
    statusHandoff: fixture.statusHandoff,
    recoveryHandoff: fixture.recoveryHandoff,
    previewAcceptance: fixture.previewAcceptance,
    validation: {
      ok: fixture.validation.ok,
      issueCodes: fixture.validation.issueCodes,
      negotiationStatus: fixture.providerContract.negotiation.status,
      syncState: fixture.providerContract.sync.state,
    },
  };
}

export const MAILCHIMP_CLAIM_FIXTURE_SOURCE = buildFixtureSource();
export const MAILCHIMP_CLAIM_FIXTURE_PROTOCOL = FIXTURE_PROTOCOL;
