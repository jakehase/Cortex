import { createExecutorPlan } from "./executor-plan.mjs";

function stableId(prefix, parts) {
  const input = parts.filter((part) => part !== undefined && part !== null).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildRetryPolicy(job, options) {
  const attempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0 ? options.maxAttempts : 3;
  const baseDelayMs = Number.isInteger(options.baseDelayMs) && options.baseDelayMs >= 0 ? options.baseDelayMs : 250;
  const retryable = job.stateContract?.restartSafe !== false && job.recovery.replayPolicy !== "manual-review";
  return {
    retryable,
    maxAttempts: retryable ? attempts : 0,
    backoff: retryable
      ? Array.from({ length: attempts }, (_, index) => ({
        attempt: index + 1,
        delayMs: baseDelayMs * (2 ** index),
        replayPolicy: job.recovery.replayPolicy,
      }))
      : [],
  };
}

function evaluateJobHealth(job, planStatus) {
  const checks = [];
  const adapterStatus = job.adapterStatusHandoff;
  const clientOperationState = job.clientOperationState;
  checks.push({
    name: "plan-open",
    status: planStatus === "blocked" ? "fail" : "pass",
    detail: planStatus === "blocked" ? "Plan is blocked before adapter handoff." : "Plan can evaluate job handoff.",
  });
  checks.push({
    name: "truth-boundary",
    status: job.truthBoundary.unverifiedFacts.length > 0 ? "fail" : "pass",
    detail: job.truthBoundary.unverifiedFacts.length > 0
      ? `Missing facts: ${job.truthBoundary.unverifiedFacts.join(", ")}.`
      : "All required claim facts are verified.",
  });
  checks.push({
    name: "tenant-permission",
    status: job.permissions.decision === "deny"
      ? "fail"
      : job.permissions.decision === "needs-approval"
        ? "degraded"
        : "pass",
    detail: job.permissions.deniedReason ?? (
      job.permissions.requiresApproval ? "Approval is required before runtime handoff." : "Tenant permission envelope allows handoff."
    ),
  });
  checks.push({
    name: "state-contract",
    status: job.stateContract?.checkpointKey ? "pass" : "degraded",
    detail: job.stateContract?.checkpointKey
      ? `Checkpoint ${job.stateContract.checkpointKey} is available for restart.`
      : "No checkpoint key was produced for restart-safe dry-run state.",
  });
  if (job.stateContract?.idempotency?.mode === "required" && !job.stateContract.idempotency.key) {
    checks.push({
      name: "idempotency",
      status: "fail",
      detail: "Required idempotency key is missing.",
    });
  } else {
    checks.push({
      name: "idempotency",
      status: job.stateContract?.idempotency?.mode === "none" ? "degraded" : "pass",
      detail: job.stateContract?.idempotency?.key
        ? `Idempotency key ${job.stateContract.idempotency.key} will guard replay.`
        : "Replay is not guarded by an idempotency key.",
    });
  }
  checks.push({
    name: "adapter-status",
    status: adapterStatus?.commands?.statusCommandId
      ? adapterStatus.state === "blocked"
        ? "fail"
        : adapterStatus.state === "waiting-for-approval"
          ? "degraded"
          : "pass"
      : "fail",
    detail: adapterStatus?.commands?.statusCommandId
      ? adapterStatus.state === "ready-to-probe"
        ? `Adapter status probe ${adapterStatus.probe} can resume with cursor ${adapterStatus.recovery.resumeCursor}.`
        : `Adapter status probe ${adapterStatus.probe} is ${adapterStatus.state}.`
      : "Adapter status probe command is missing from the runtime handoff.",
  });
  checks.push({
    name: "client-resume-state",
    status: !clientOperationState
      ? "fail"
      : clientOperationState.workflowState === "blocked"
        ? "degraded"
        : "pass",
    detail: !clientOperationState
      ? "Client operation resume state is missing."
      : clientOperationState.workflowState === "blocked"
        ? `Client operation ${clientOperationState.id} is blocked with action ${clientOperationState.nextAction}.`
        : `Client operation ${clientOperationState.id} can resume with action ${clientOperationState.nextAction}.`,
  });
  return {
    status: checks.some((check) => check.status === "fail")
      ? "unhealthy"
      : checks.some((check) => check.status === "degraded")
        ? "degraded"
        : "healthy",
    checks,
  };
}

function buildActionableErrors(job, health) {
  return health.checks
    .filter((check) => check.status !== "pass")
    .map((check) => {
      if (check.name === "truth-boundary") {
        return {
          code: "dry-run.truth-boundary-open",
          severity: "error",
          jobId: job.id,
          action: "Provide missing Mailchimp evidence facts before adapter handoff.",
          detail: check.detail,
        };
      }
      if (check.name === "tenant-permission") {
        return {
          code: job.permissions.decision === "deny"
            ? "dry-run.permission-denied"
            : "dry-run.approval-required",
          severity: job.permissions.decision === "deny" ? "error" : "warning",
          jobId: job.id,
          action: job.permissions.decision === "deny"
            ? "Run with an actor role allowed by the tenant permission envelope."
            : "Collect approval before executing write-like Mailchimp capabilities.",
          detail: check.detail,
        };
      }
      if (check.name === "state-contract") {
        return {
          code: "dry-run.state-contract-degraded",
          severity: "warning",
          jobId: job.id,
          action: "Declare operation persistence to make restart status resumable.",
          detail: check.detail,
        };
      }
      if (check.name === "idempotency") {
        return {
          code: "dry-run.idempotency-degraded",
          severity: check.status === "fail" ? "error" : "warning",
          jobId: job.id,
          action: "Declare an idempotency key for replay-safe Mailchimp adapter calls.",
          detail: check.detail,
        };
      }
      if (check.name === "adapter-status") {
        return {
          code: check.status === "fail"
            ? "dry-run.adapter-status-blocked"
            : "dry-run.adapter-status-paused",
          severity: check.status === "fail" ? "error" : "warning",
          jobId: job.id,
          action: check.status === "fail"
            ? "Repair adapter status handoff before releasing Mailchimp runtime commands."
            : "Resume the adapter status probe after tenant approval is collected.",
          detail: check.detail,
        };
      }
      if (check.name === "client-resume-state") {
        return {
          code: check.status === "fail"
            ? "dry-run.client-resume-state-missing"
            : "dry-run.client-resume-state-blocked",
          severity: check.status === "fail" ? "error" : "warning",
          jobId: job.id,
          action: check.status === "fail"
            ? "Compile executor plan with client operation state before presenting runtime handoff."
            : "Resume the user-visible client action before releasing this Mailchimp operation.",
          detail: check.detail,
        };
      }
      return {
        code: "dry-run.plan-blocked",
        severity: "error",
        jobId: job.id,
        action: "Resolve blocking plan issues before execution.",
        detail: check.detail,
      };
    });
}

function simulateJob(job, planStatus, options) {
  const health = evaluateJobHealth(job, planStatus);
  const retryPolicy = buildRetryPolicy(job, options);
  const actionableErrors = buildActionableErrors(job, health);
  const baseTimeline = buildJobTimeline(job, planStatus, health);
  const adapterStatusProbe = buildAdapterStatusProbePreview(job, planStatus, health, options);
  const restartReplay = buildRestartReplayPreview(job, planStatus, adapterStatusProbe, health);
  if (planStatus === "blocked") {
    return {
      jobId: job.id,
      operation: job.operation,
      status: "skipped",
      reason: "plan-blocked",
      adapterCall: null,
      evidence: [],
      adapterStatusProbe,
      health,
      retryPolicy,
      actionableErrors,
      timeline: baseTimeline,
      state: {
        checkpointKey: job.stateContract?.checkpointKey,
        ledgerKey: job.stateContract?.commandState?.ledgerKey,
        commandIds: job.stateContract?.commandState?.commands?.map((command) => command.id) ?? [],
        statusProjection: job.statusProjection,
        replayPolicy: job.recovery.replayPolicy,
        idempotencyKey: job.recovery.idempotencyKey,
        restartReplay,
        clientOperationState: job.clientOperationState ?? null,
      },
      recoveryHandoff: buildRecoveryHandoffPreview(job, adapterStatusProbe, "plan-blocked"),
      rollbackPrepared: job.recovery.rollback,
    };
  }
  const missingVerifier = job.truthBoundary.unverifiedFacts.length > 0;
  if (missingVerifier || job.permissions.decision === "deny") {
    return {
      jobId: job.id,
      operation: job.operation,
      status: "blocked",
      reason: missingVerifier ? "truth-boundary-open" : "permission-denied",
      adapterCall: null,
      evidence: job.truthBoundary.verifiedFacts.map((fact) => ({ fact, source: "claim-gate" })),
      adapterStatusProbe,
      health,
      retryPolicy,
      actionableErrors,
      timeline: baseTimeline,
      state: {
        checkpointKey: job.stateContract?.checkpointKey,
        ledgerKey: job.stateContract?.commandState?.ledgerKey,
        commandIds: job.stateContract?.commandState?.commands?.map((command) => command.id) ?? [],
        statusProjection: job.statusProjection,
        replayPolicy: job.recovery.replayPolicy,
        idempotencyKey: job.recovery.idempotencyKey,
        restartReplay,
        clientOperationState: job.clientOperationState ?? null,
      },
      recoveryHandoff: buildRecoveryHandoffPreview(
        job,
        adapterStatusProbe,
        missingVerifier ? "truth-boundary-open" : "permission-denied",
      ),
      rollbackPrepared: job.recovery.rollback,
    };
  }
  const requiresApproval = job.permissions.decision === "needs-approval";
  const simulatedOutcome = adapterStatusProbe.dryRunOutcome ?? {};
  const simulatedFailure = simulatedOutcome.classification === "failure";
  const simulatedPending = simulatedOutcome.classification === "pending" || simulatedOutcome.terminal === false;
  const simulatedStatus = simulatedFailure
    ? "blocked"
    : simulatedPending || requiresApproval
      ? "degraded"
      : "would-run";
  const simulatedReason = simulatedFailure
    ? "adapter-status-fixture-failure"
    : simulatedPending
      ? "adapter-status-fixture-pending"
      : requiresApproval
        ? "approval-required"
        : "dry-run";
  return {
    jobId: job.id,
    operation: job.operation,
    status: simulatedStatus,
    reason: simulatedReason,
    adapterCall: requiresApproval ? null : {
      adapter: job.runtimeHandoff.adapter,
      method: job.runtimeHandoff.method,
      inputSchema: job.inputSchema,
      requestId: job.runtimeHandoff.requestId,
      workflowId: job.runtimeHandoff.workflowId,
      checkpointKey: job.runtimeHandoff.checkpointKey,
      simulatedAdapterStatus: simulatedOutcome.status ?? null,
      simulatedAdapterStatusFixtureId: simulatedOutcome.fixtureId ?? null,
    },
    evidence: job.truthBoundary.verifiedFacts.map((fact) => ({ fact, source: "claim-gate" })),
    adapterStatusProbe,
    health,
    retryPolicy,
    actionableErrors,
    timeline: [
      ...baseTimeline,
      {
        sequence: baseTimeline.length + 1,
        status: requiresApproval ? "needs-approval" : "would-run",
        event: requiresApproval ? "approval-pauses-adapter-call" : "adapter-call-simulated",
        commandId: job.stateContract?.commandState?.commands?.find((command) => command.type === "adapter-handoff")?.id,
        restartSafe: job.statusProjection?.restartSafe ?? false,
      },
      {
        sequence: baseTimeline.length + 2,
        status: requiresApproval ? "waiting-for-approval" : "verified",
        event: requiresApproval
          ? "adapter-status-paused-for-approval"
          : simulatedFailure
            ? "adapter-status-fixture-failed"
            : simulatedPending
              ? "adapter-status-fixture-pending"
              : "adapter-status-probe-simulated",
        commandId: job.adapterStatusHandoff?.commands?.statusCommandId ?? null,
        idempotencyKey: job.stateContract?.commandState?.commands?.find((command) => (
          command.type === "adapter-status-probe"
        ))?.idempotencyKey ?? null,
        adapterStatus: simulatedOutcome.status ?? null,
        fixtureId: simulatedOutcome.fixtureId ?? null,
        restartSafe: job.statusProjection?.restartSafe ?? false,
      },
    ],
    state: {
      checkpointKey: job.stateContract?.checkpointKey,
      ledgerKey: job.stateContract?.commandState?.ledgerKey,
      commandIds: job.stateContract?.commandState?.commands?.map((command) => command.id) ?? [],
      statusProjection: job.statusProjection,
      replayPolicy: job.recovery.replayPolicy,
      idempotencyKey: job.recovery.idempotencyKey,
      persistedFields: job.stateContract?.persistedFields ?? [],
      restartReplay,
      clientOperationState: job.clientOperationState ?? null,
    },
    recoveryHandoff: buildRecoveryHandoffPreview(
      job,
      adapterStatusProbe,
      requiresApproval ? "approval-required" : "dry-run",
    ),
    rollbackPrepared: job.recovery.rollback,
  };
}

function buildRestartReplayPreview(job, planStatus, adapterStatusProbe, health) {
  const replayManifest = job.stateContract?.replayManifest ?? {};
  const currentStatus = job.statusProjection?.current ?? "planned";
  const statusRows = replayManifest.statusRows ?? [];
  const commandRows = replayManifest.commandRows ?? [];
  const statusRow = statusRows.find((row) => row.status === currentStatus)
    ?? statusRows.find((row) => row.status === "checkpointed")
    ?? null;
  const nextCommand = commandRows.find((command) => command.commandId === statusRow?.nextCommandId)
    ?? commandRows.find((command) => command.statusBefore === currentStatus)
    ?? null;
  const failingCheck = health.checks.find((check) => check.status === "fail");
  const degradedCheck = health.checks.find((check) => check.status === "degraded");
  const blocked = planStatus === "blocked" || Boolean(failingCheck) || adapterStatusProbe.state === "blocked";
  const paused = !blocked && (Boolean(degradedCheck) || adapterStatusProbe.state === "paused");
  const replayDecision = blocked
    ? "hold-until-healthy"
    : paused
      ? "persist-and-wait"
      : nextCommand?.replayAction ?? "return-existing-status";
  const replayCursor = stableId("dryreplay", [
    job.id,
    replayManifest.id,
    currentStatus,
    replayDecision,
    adapterStatusProbe.resumeCursor,
  ]);
  return {
    id: stableId("dryreplaymanifest", [
      job.id,
      replayManifest.id,
      currentStatus,
      replayDecision,
    ]),
    sourceManifestId: replayManifest.id ?? null,
    checkpointKey: job.stateContract?.checkpointKey ?? null,
    ledgerKey: replayManifest.ledgerKey ?? job.stateContract?.commandState?.ledgerKey ?? null,
    replayCursor,
    currentStatus,
    currentVisibleStatus: statusRow?.visibleStatus ?? job.statusProjection?.clientVisibleStatus,
    replayDecision,
    restartSafe: Boolean(replayManifest.restartSafe && job.statusProjection?.restartSafe && !blocked),
    blockedBy: failingCheck?.name ?? (planStatus === "blocked" ? "plan-open" : null),
    pausedBy: paused ? degradedCheck?.name ?? "adapter-status" : null,
    nextCommand: nextCommand ? {
      commandId: nextCommand.commandId,
      commandType: nextCommand.commandType,
      replayAction: nextCommand.replayAction,
      idempotencyKey: nextCommand.idempotencyKey,
      conflict: nextCommand.conflict,
      writes: nextCommand.writes,
    } : null,
    duplicateHandling: replayManifest.duplicateHandling ?? null,
    restartSemantics: replayManifest.restartSemantics ?? {
      onColdRestart: "reload-status-ledger",
      onDuplicateCommand: "return-existing-command-result",
      onTerminalStatus: "return-existing-terminal-state",
    },
  };
}

function normalizeFixtureSelector(value) {
  if (value === undefined || value === null) return null;
  return String(value).trim() || null;
}

function selectAdapterStatusFixture(job, options = {}) {
  const fixtures = job.adapterStatusHandoff?.dryRunFixtures?.fixtures
    ?? job.recovery?.adapterStatusFixtures?.fixtures
    ?? [];
  const selector = normalizeFixtureSelector(
    options.adapterStatusFixtureId
      ?? options.statusFixtureId
      ?? options.adapterStatusFixture
      ?? options.statusFixture
      ?? options.adapterStatusFixtures?.[job.id]
      ?? options.adapterStatusFixtures?.[job.operation],
  );
  if (fixtures.length === 0) {
    return null;
  }
  if (selector) {
    return fixtures.find((fixture) => fixture.id === selector || fixture.name === selector) ?? fixtures[0];
  }
  const defaultFixtureId = job.adapterStatusHandoff?.dryRunFixtures?.defaultFixtureId
    ?? job.recovery?.adapterStatusFixtures?.defaultFixtureId;
  return fixtures.find((fixture) => fixture.id === defaultFixtureId)
    ?? fixtures.find((fixture) => fixture.selectedByDefault)
    ?? fixtures[0];
}

function buildDryRunOutcomeFromFixture(job, fixture, expected, handoff) {
  const rows = fixture?.rows ?? [];
  const fallbackStatus = expected.success[0] ?? expected.terminal[0] ?? "completed";
  const terminalRow = rows.find((row) => row.terminal)
    ?? rows.find((row) => expected.terminal.includes(row.status))
    ?? rows.at(-1)
    ?? {
      sequence: 1,
      status: fallbackStatus,
      classification: expected.failure.includes(fallbackStatus)
        ? "failure"
        : expected.pending.includes(fallbackStatus)
          ? "pending"
          : "success",
      terminal: true,
      poll: 1,
      elapsedMs: 0,
      visibleStatus: "mailchimp-operation-completed",
      recoveryAction: "return-existing-terminal-state",
    };
  const classification = terminalRow.classification
    ?? (expected.failure.includes(terminalRow.status)
      ? "failure"
      : expected.pending.includes(terminalRow.status)
        ? "pending"
        : expected.success.includes(terminalRow.status)
          ? "success"
          : "unknown");
  const terminal = terminalRow.terminal === true || expected.terminal.includes(terminalRow.status);
  return {
    fixtureId: fixture?.id ?? stableId("statusfixture", [job.id, handoff?.id, fallbackStatus]),
    fixtureName: fixture?.name ?? "implicit-success",
    deterministic: fixture?.deterministic !== false,
    status: terminalRow.status,
    classification: terminal ? classification : "pending",
    terminal,
    poll: terminalRow.poll ?? terminalRow.sequence ?? 1,
    elapsedMs: terminalRow.elapsedMs ?? 0,
    visibleStatus: terminalRow.visibleStatus ?? (
      classification === "failure"
        ? "mailchimp-operation-failed"
        : terminal
          ? "mailchimp-operation-completed"
          : "waiting-for-mailchimp-status"
    ),
    recoveryAction: terminalRow.recoveryAction
      ?? (classification === "failure"
        ? handoff?.recovery?.onFailure ?? "rollback"
        : terminal
          ? "return-existing-terminal-state"
          : handoff?.recovery?.onTimeout ?? "manual-review"),
    rows: rows.map((row) => ({
      sequence: row.sequence,
      status: row.status,
      classification: row.classification,
      terminal: row.terminal === true,
      poll: row.poll,
      elapsedMs: row.elapsedMs,
      visibleStatus: row.visibleStatus,
      recoveryAction: row.recoveryAction,
    })),
  };
}

function buildAdapterStatusProbePreview(job, planStatus, health, options = {}) {
  const handoff = job.adapterStatusHandoff;
  const statusCheck = health.checks.find((check) => check.name === "adapter-status");
  const blocked = planStatus === "blocked" || statusCheck?.status === "fail";
  const paused = statusCheck?.status === "degraded";
  const expected = handoff?.expectedStatuses ?? {
    success: [],
    pending: [],
    failure: [],
    terminal: [],
  };
  const selectedFixture = selectAdapterStatusFixture(job, options);
  const dryRunOutcome = buildDryRunOutcomeFromFixture(job, selectedFixture, expected, handoff);
  return {
    handoffId: handoff?.id ?? null,
    state: blocked ? "blocked" : paused ? "paused" : "would-probe",
    probe: handoff?.probe ?? null,
    adapter: handoff?.adapter ?? job.adapter,
    operation: handoff?.operation ?? job.operation,
    statusCommandId: handoff?.commands?.statusCommandId ?? null,
    resumeCursor: handoff?.recovery?.resumeCursor ?? null,
    correlation: handoff?.correlation ?? null,
    expectedStatuses: expected,
    dryRunOutcome,
    polling: handoff?.polling ?? null,
    visibleStatus: blocked
      ? "adapter-status-blocked"
      : paused
        ? "adapter-status-waiting"
        : dryRunOutcome.classification === "failure"
          ? "adapter-status-fixture-failed"
          : dryRunOutcome.classification === "pending"
            ? "adapter-status-fixture-pending"
            : "adapter-status-ready",
    dryRunGuarantee: {
      externalProbePerformed: false,
      adapterMutationPerformed: false,
      terminalStatesKnown: expected.terminal.length > 0,
      deterministicFixture: dryRunOutcome.deterministic === true,
      fixtureId: dryRunOutcome.fixtureId,
      simulatedTerminal: dryRunOutcome.terminal,
    },
  };
}

function buildRecoveryHandoffPreview(job, adapterStatusProbe, reason) {
  const handoff = job.adapterStatusHandoff;
  const replayManifest = job.stateContract?.replayManifest ?? {};
  const blocked = adapterStatusProbe.state === "blocked";
  const paused = adapterStatusProbe.state === "paused";
  return {
    id: stableId("recovery", [
      job.id,
      adapterStatusProbe.handoffId,
      reason,
      adapterStatusProbe.state,
    ]),
    reason,
    status: blocked ? "blocked" : paused ? "waiting" : "ready",
    replayCursor: job.recovery.replayCursor,
    adapterStatusResumeCursor: adapterStatusProbe.resumeCursor,
    recoverySignal: handoff?.recovery?.signal ?? null,
    nextAction: blocked
      ? "repair-before-runtime-release"
      : paused
        ? "resume-after-approval"
        : "persist-probe-cursor",
    commands: {
      replayCommandIds: job.stateContract?.commandState?.commands?.map((command) => command.id) ?? [],
      statusCommandId: adapterStatusProbe.statusCommandId,
      rollbackCommandId: handoff?.commands?.rollbackCommandId ?? null,
      resumeCommandId: handoff?.commands?.resumeCommandId ?? null,
    },
    restartReplay: {
      replayManifestId: replayManifest.id ?? null,
      ledgerKey: replayManifest.ledgerKey ?? null,
      replayPolicy: replayManifest.replayPolicy ?? job.recovery.replayPolicy,
      duplicateHandling: replayManifest.duplicateHandling ?? null,
      commandCount: replayManifest.commandRows?.length ?? 0,
    },
    failurePolicy: {
      onFailure: job.recovery.onAdapterFailure,
      onTimeout: job.recovery.onAdapterTimeout,
      rollbackPrepared: job.recovery.rollback,
    },
    clientResume: job.clientOperationState ? {
      stateId: job.clientOperationState.id,
      workflowState: job.clientOperationState.workflowState,
      visibleStatus: job.clientOperationState.visibleStatus,
      nextAction: job.clientOperationState.nextAction,
      claimResumeCursor: job.clientOperationState.resume.claimResumeCursor,
      adapterStatusResumeCursor: job.clientOperationState.resume.adapterStatusResumeCursor,
      replayCursor: job.clientOperationState.resume.replayCursor,
    } : null,
  };
}

function incidentSeverity(status) {
  if (status === "blocked" || status === "skipped") return "error";
  if (status === "degraded") return "warning";
  return "info";
}

function incidentOwner(result, error) {
  if (error?.code?.includes("permission")) return "workspace-admin";
  if (error?.code?.includes("adapter") || error?.code?.includes("idempotency")) return "runtime-adapter";
  if (error?.code?.includes("truth-boundary")) return "claim-verifier";
  if (result.reason === "approval-required") return "operator";
  return "runtime";
}

function buildDryRunIncidentRows(plan, jobResults) {
  return jobResults.flatMap((result, jobIndex) => {
    const errors = result.actionableErrors?.length
      ? result.actionableErrors
      : result.health?.checks
        ?.filter((check) => check.status !== "pass")
        .map((check) => ({
          code: `dry-run.${check.name}`,
          severity: check.status === "fail" ? "error" : "warning",
          action: "review-dry-run-health",
          detail: check.detail,
        })) ?? [];
    return errors.map((error, errorIndex) => {
      const status = error.severity === "error" || result.status === "blocked" || result.status === "skipped"
        ? "blocked"
        : "degraded";
      const retryable = result.retryPolicy?.retryable === true
        && status !== "blocked"
        && !String(error.code).includes("permission-denied")
        && !String(error.code).includes("truth-boundary");
      const nextRetry = retryable
        ? result.retryPolicy.backoff?.[0] ?? null
        : null;
      return {
        id: stableId("dryincident", [plan.id, result.jobId, error.code, errorIndex + 1]),
        order: jobIndex * 100 + errorIndex + 1,
        jobId: result.jobId,
        operation: result.operation,
        code: error.code,
        severity: error.severity || incidentSeverity(result.status),
        status,
        reason: result.reason,
        owner: incidentOwner(result, error),
        clientVisible: status === "blocked" || result.status === "degraded",
        providerVisible: String(error.code).includes("adapter") || String(error.code).includes("status"),
        blocksRuntimeStart: status === "blocked",
        retryable,
        nextAction: error.action || result.recoveryHandoff?.nextAction || "review-dry-run-health",
        detail: error.detail || result.health?.checks?.find((check) => check.status !== "pass")?.detail || null,
        nextRetry,
        handoff: {
          recoveryId: result.recoveryHandoff?.id || null,
          adapterStatusHandoffId: result.adapterStatusProbe?.handoffId || null,
          resumeCursor: result.adapterStatusProbe?.resumeCursor || result.state?.restartReplay?.replayCursor || null,
          replayCursor: result.state?.restartReplay?.replayCursor || null,
          rollbackPrepared: result.rollbackPrepared !== "no-op",
        },
        evidence: {
          healthStatus: result.health?.status || "unknown",
          failingChecks: result.health?.checks
            ?.filter((check) => check.status === "fail")
            .map((check) => check.name) ?? [],
          degradedChecks: result.health?.checks
            ?.filter((check) => check.status === "degraded")
            .map((check) => check.name) ?? [],
          adapterFixtureId: result.adapterStatusProbe?.dryRunOutcome?.fixtureId || null,
          simulatedAdapterStatus: result.adapterStatusProbe?.dryRunOutcome?.status || null,
        },
      };
    });
  }).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function buildDryRunIncidentQueue(plan, jobResults, status) {
  const incidents = buildDryRunIncidentRows(plan, jobResults);
  const blocking = incidents.filter((incident) => incident.blocksRuntimeStart);
  const retryable = incidents.filter((incident) => incident.retryable);
  const clientVisible = incidents.filter((incident) => incident.clientVisible);
  const providerVisible = incidents.filter((incident) => incident.providerVisible);
  const nextIncident = blocking[0] || retryable[0] || incidents[0] || null;
  const queueStatus = blocking.length > 0 || status === "blocked"
    ? "blocked"
    : incidents.length > 0 || status === "degraded"
      ? "degraded"
      : "ready";
  const resumeToken = stableId("dryincidentresume", [
    plan.id,
    queueStatus,
    incidents.map((incident) => incident.id).join(","),
  ]);

  return {
    schemaVersion: "aios.mailchimp.dry-run-incident-queue.v1",
    provider: "mailchimp",
    planId: plan.id,
    status: queueStatus,
    incidentCount: incidents.length,
    nextIncidentId: nextIncident?.id || null,
    nextAction: nextIncident?.nextAction || "handoff-to-runtime-adapter",
    resumeToken,
    summary: {
      total: incidents.length,
      blocking: blocking.length,
      retryable: retryable.length,
      clientVisible: clientVisible.length,
      providerVisible: providerVisible.length,
    },
    byOwner: incidents.reduce((counts, incident) => {
      counts[incident.owner] = (counts[incident.owner] || 0) + 1;
      return counts;
    }, {}),
    bySeverity: incidents.reduce((counts, incident) => {
      counts[incident.severity] = (counts[incident.severity] || 0) + 1;
      return counts;
    }, {}),
    incidents,
    runtimeHandoff: {
      state: queueStatus === "blocked" ? "hold-runtime-start" : queueStatus === "degraded" ? "degraded-mode" : "ready",
      nextAction: nextIncident?.nextAction || "handoff-to-runtime-adapter",
      resumeFromIncidentId: nextIncident?.id || null,
      externalWritesPerformed: false,
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-dry-run-incident-id",
      resumeToken,
      externalWritesPerformed: false,
    },
  };
}

function buildOperationalReleaseGate(plan, jobResults, dryRunIncidentQueue, runtimeBoundaryExecutionTickets, runtimeStatusReplayCursor) {
  const incidents = Array.isArray(dryRunIncidentQueue?.incidents) ? dryRunIncidentQueue.incidents : [];
  const blockingIncidents = incidents.filter((incident) => incident.blocksRuntimeStart);
  const retryableIncidents = incidents.filter((incident) => incident.retryable);
  const runtimeBlockedJobIds = new Set(runtimeBoundaryExecutionTickets?.clientPatch?.runtimeBoundaryExecutionTicketBlockedJobIds || []);
  const runtimeWaitingJobIds = new Set(runtimeBoundaryExecutionTickets?.clientPatch?.runtimeBoundaryExecutionTicketWaitingJobIds || []);
  const replayBlockedJobIds = new Set(runtimeStatusReplayCursor?.blocking?.blockedJobIds || []);
  const replayWaitingJobIds = new Set(runtimeStatusReplayCursor?.blocking?.waitingJobIds || []);
  const replayUnsafeJobIds = new Set(runtimeStatusReplayCursor?.blocking?.unsafeJobIds || []);
  const rows = jobResults.map((result, index) => {
    const jobIncidents = incidents.filter((incident) => incident.jobId === result.jobId);
    const blocking = jobIncidents.filter((incident) => incident.blocksRuntimeStart);
    const retryable = jobIncidents.filter((incident) => incident.retryable);
    const boundaryBlocked = runtimeBlockedJobIds.has(result.jobId);
    const boundaryWaiting = runtimeWaitingJobIds.has(result.jobId);
    const replayBlocked = replayBlockedJobIds.has(result.jobId);
    const replayWaiting = replayWaitingJobIds.has(result.jobId);
    const replayUnsafe = replayUnsafeJobIds.has(result.jobId);
    const ready = result.status === "would-run"
      && blocking.length === 0
      && boundaryBlocked === false
      && replayBlocked === false
      && replayUnsafe === false
      && result.boundaryExecutionGate?.readyForAdapterRelease !== false;
    const state = ready
      ? "ready"
      : blocking.length > 0 || boundaryBlocked || replayBlocked || replayUnsafe || result.status === "blocked"
        ? "blocked"
        : "waiting";
    return {
      sequence: index + 1,
      jobId: result.jobId,
      operation: result.operation,
      state,
      readyForRuntimeRelease: ready,
      dryRunStatus: result.status,
      dryRunReason: result.reason,
      runtimeBoundaryState: result.boundaryExecutionGate?.state || (
        boundaryBlocked ? "blocked" : boundaryWaiting ? "waiting" : "unknown"
      ),
      replayState: replayBlocked || replayUnsafe
        ? "blocked"
        : replayWaiting
          ? "waiting"
          : runtimeStatusReplayCursor?.status || "unknown",
      incidentIds: jobIncidents.map((incident) => incident.id),
      blockingIncidentIds: blocking.map((incident) => incident.id),
      retryableIncidentIds: retryable.map((incident) => incident.id),
      blockers: [
        ...(blocking.map((incident) => incident.code || incident.reason || incident.id)),
        ...(boundaryBlocked ? ["runtime-boundary"] : []),
        ...(replayBlocked ? ["status-replay-blocked"] : []),
        ...(replayUnsafe ? ["status-replay-unsafe"] : []),
        ...(result.status === "blocked" ? [result.reason || "dry-run-blocked"] : []),
      ],
      waiters: [
        ...(retryable.map((incident) => incident.code || incident.reason || incident.id)),
        ...(boundaryWaiting ? ["runtime-boundary"] : []),
        ...(replayWaiting ? ["status-replay-waiting"] : []),
        ...(result.status === "degraded" ? [result.reason || "dry-run-degraded"] : []),
      ],
      nextAction: blocking[0]?.nextAction
        || retryable[0]?.nextAction
        || result.boundaryExecutionGate?.nextAction
        || result.recoveryHandoff?.nextAction
        || runtimeStatusReplayCursor?.nextAction
        || "handoff-to-runtime-adapter",
      resumeCursor: result.adapterStatusProbe?.resumeCursor
        || result.state?.restartReplay?.replayCursor
        || runtimeStatusReplayCursor?.replayCursor
        || null,
    };
  });
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const readyRows = rows.filter((row) => row.state === "ready");
  const status = blockedRows.length > 0 || dryRunIncidentQueue?.status === "blocked"
    ? "blocked"
    : waitingRows.length > 0 || dryRunIncidentQueue?.status === "degraded"
      ? "waiting"
      : "ready";
  const nextRow = blockedRows[0] || waitingRows[0] || readyRows[0] || null;
  const resumeToken = stableId("dryreleasegate", [
    plan.id,
    status,
    dryRunIncidentQueue?.resumeToken,
    runtimeStatusReplayCursor?.replayCursor,
    rows.map((row) => `${row.jobId}:${row.state}`).join(","),
  ]);
  return {
    schemaVersion: "aios.mailchimp.operational-release-gate.v1",
    provider: "mailchimp",
    planId: plan.id,
    status,
    readyForRuntimeRelease: status === "ready"
      && dryRunIncidentQueue?.status !== "blocked"
      && runtimeBoundaryExecutionTickets?.readyForRuntimeRelease !== false
      && runtimeStatusReplayCursor?.readyForRuntimeRelease !== false,
    resumeToken,
    nextAction: status === "ready"
      ? "release-mailchimp-runtime"
      : nextRow?.nextAction || dryRunIncidentQueue?.nextAction || "repair-operational-release-gate",
    counters: {
      total: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      incidents: incidents.length,
      blockingIncidents: blockingIncidents.length,
      retryableIncidents: retryableIncidents.length,
    },
    blocking: {
      jobIds: blockedRows.map((row) => row.jobId),
      incidentIds: blockingIncidents.map((incident) => incident.id),
      runtimeBoundaryJobIds: Array.from(runtimeBlockedJobIds),
      replayBlockedJobIds: Array.from(replayBlockedJobIds),
      replayUnsafeJobIds: Array.from(replayUnsafeJobIds),
    },
    waiting: {
      jobIds: waitingRows.map((row) => row.jobId),
      incidentIds: retryableIncidents.map((incident) => incident.id),
      runtimeBoundaryJobIds: Array.from(runtimeWaitingJobIds),
      replayWaitingJobIds: Array.from(replayWaitingJobIds),
    },
    rows,
    runtimeHandoff: {
      state: status === "ready" ? "ready" : status === "waiting" ? "degraded-mode" : "hold-runtime-start",
      nextAction: status === "ready"
        ? "release-mailchimp-runtime"
        : nextRow?.nextAction || dryRunIncidentQueue?.nextAction || "repair-operational-release-gate",
      resumeToken,
      releaseCommandId: stableId("dryreleasecmd", [plan.id, status, resumeToken]),
      externalWritesPerformed: false,
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-operational-release-gate-token",
      resumeToken,
      externalWritesPerformed: false,
    },
  };
}

function buildJobTimeline(job, planStatus, health) {
  const commandState = job.stateContract?.commandState;
  const commandByStatus = new Map(
    (commandState?.commands ?? []).map((command) => [command.statusAfter, command]),
  );
  const projectionTransitions = job.statusProjection?.transitions ?? [];
  const timeline = projectionTransitions.map((transition, index) => {
    const command = commandByStatus.get(transition.to);
    return {
      sequence: index + 1,
      status: transition.to,
      event: transition.reason,
      commandId: command?.id ?? null,
      idempotencyKey: command?.idempotencyKey ?? null,
      restartSafe: job.statusProjection?.restartSafe ?? false,
    };
  });
  if (planStatus === "blocked") {
    timeline.push({
      sequence: timeline.length + 1,
      status: "skipped",
      event: "plan-blocked-before-command-replay",
      commandId: null,
      idempotencyKey: null,
      restartSafe: false,
    });
  }
  for (const check of health.checks.filter((entry) => entry.status !== "pass")) {
    timeline.push({
      sequence: timeline.length + 1,
      status: check.status === "fail" ? "blocked" : "degraded",
      event: `health-${check.name}`,
      commandId: null,
      idempotencyKey: null,
      restartSafe: job.statusProjection?.restartSafe ?? false,
    });
  }
  return timeline;
}

function deriveStatus(plan, jobResults) {
  if (plan.status === "blocked") {
    return "blocked";
  }
  if (jobResults.some((result) => result.status === "blocked")) {
    return "blocked";
  }
  if (jobResults.some((result) => result.status === "degraded")) {
    return "degraded";
  }
  if (jobResults.every((result) => result.status === "would-run")) {
    return "admitted";
  }
  return "reviewable";
}

function buildRollbackPreview(plan, jobResults) {
  const preparedJobIds = new Set(
    jobResults
      .filter((result) => result.rollbackPrepared && result.rollbackPrepared !== "no-op")
      .map((result) => result.jobId),
  );
  return plan.recovery.rollbackOrder
    .filter((entry) => preparedJobIds.has(entry.jobId))
    .map((entry, index) => ({
      sequence: index + 1,
      jobId: entry.jobId,
      action: entry.action,
      mode: "prepared-only",
    }));
}

function summarizeHealth(jobResults) {
  const checks = jobResults.flatMap((result) => result.health.checks);
  const errors = jobResults.flatMap((result) => result.actionableErrors);
  return {
    status: checks.some((check) => check.status === "fail")
      ? "unhealthy"
      : checks.some((check) => check.status === "degraded")
        ? "degraded"
        : "healthy",
    checkCount: checks.length,
    failingChecks: checks.filter((check) => check.status === "fail").length,
    degradedChecks: checks.filter((check) => check.status === "degraded").length,
    actionableErrors: errors,
  };
}

function normalizeAuditList(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [...new Set(source.map((item) => String(item ?? "").trim()).filter(Boolean))].sort();
}

function permissionScopeAllows(granted, required) {
  if (!required) return true;
  if (granted.includes("*") || granted.includes(required)) return true;
  return granted.some((scope) => scope.endsWith("*") && required.startsWith(scope.slice(0, -1)));
}

function buildTenantAuditHandoff(plan, jobResults, options = {}) {
  const runtime = options.runtime && typeof options.runtime === "object" ? options.runtime : options;
  const claimRuntime = plan.claimGate?.clientRuntime ?? {};
  const boundarySource = runtime.tenantBoundary && typeof runtime.tenantBoundary === "object"
    ? runtime.tenantBoundary
    : runtime.permissionBoundary && typeof runtime.permissionBoundary === "object"
      ? runtime.permissionBoundary
      : runtime.accessContext && typeof runtime.accessContext === "object"
        ? runtime.accessContext
        : {};
  const actor = boundarySource.actor && typeof boundarySource.actor === "object" ? boundarySource.actor : {};
  const grant = boundarySource.grant && typeof boundarySource.grant === "object" ? boundarySource.grant : {};
  const scope = boundarySource.scope && typeof boundarySource.scope === "object" ? boundarySource.scope : {};
  const tenantId = String(
    boundarySource.tenantId ?? boundarySource.tenant ?? scope.tenantId ?? scope.tenant ?? claimRuntime.tenantId ?? "tenant.local",
  ).trim();
  const workspaceId = String(
    boundarySource.workspaceId
      ?? boundarySource.workspace
      ?? scope.workspaceId
      ?? scope.workspace
      ?? claimRuntime.workspaceId
      ?? "workspace.local",
  ).trim();
  const actorId = String(
    boundarySource.actorId ?? actor.id ?? actor.actorId ?? runtime.actorId ?? runtime.operatorId ?? "",
  ).trim();
  const roles = normalizeAuditList(boundarySource.roles ?? actor.roles ?? grant.roles ?? runtime.roles);
  const grantedScopes = normalizeAuditList(
    boundarySource.permissions
      ?? boundarySource.scopes
      ?? grant.permissions
      ?? grant.scopes
      ?? runtime.permissions
      ?? runtime.scopes,
  );
  const privileged = roles.some((role) => ["admin", "owner", "mailchimp_admin", "runtime_operator"].includes(role));
  const jobById = new Map((plan.jobs ?? []).map((job) => [job.id, job]));
  const rows = jobResults.map((result, index) => {
    const job = jobById.get(result.jobId) ?? {};
    const permissions = job.permissions ?? {};
    const requiredScopes = normalizeAuditList([
      ...normalizeAuditList(permissions.requiredScopes),
      ...normalizeAuditList(permissions.scopes),
      permissions.requiredScope,
      permissions.scope,
      result.operation ? `mailchimp.${result.operation}` : "",
    ]);
    const missingScopes = requiredScopes.filter((required) => !permissionScopeAllows(grantedScopes, required));
    const tenantMatches = !permissions.tenantId || !tenantId || permissions.tenantId === tenantId;
    const workspaceMatches = !permissions.workspaceId || !workspaceId || permissions.workspaceId === workspaceId;
    const decision = permissions.decision ?? (result.status === "blocked" ? "deny" : "allow");
    const safe = decision !== "deny"
      && tenantMatches
      && workspaceMatches
      && (missingScopes.length === 0 || privileged)
      && result.health.checks.every((check) => check.name !== "tenant-permission" || check.status !== "fail");
    return {
      sequence: index + 1,
      jobId: result.jobId,
      operation: result.operation,
      permissionDecision: decision,
      status: safe
        ? result.status === "degraded" || decision === "needs-approval"
          ? "approval-hold"
          : "audit-ready"
        : "blocked",
      tenantId,
      workspaceId,
      actorId,
      requiredScopes,
      missingScopes,
      tenantMatches,
      workspaceMatches,
      auditRef: stableId("auditref", [
        plan.id,
        tenantId,
        workspaceId,
        result.jobId,
        result.state.idempotencyKey,
      ]),
      commandIds: result.state.commandIds ?? [],
      checkpointKey: result.state.checkpointKey ?? null,
      replayCursor: result.state.restartReplay?.replayCursor ?? null,
      adapterStatusResumeCursor: result.adapterStatusProbe?.resumeCursor ?? null,
      nextAction: safe
        ? decision === "needs-approval" || result.status === "degraded"
          ? "collect-tenant-approval"
          : "append-audit-before-runtime-release"
        : "resolve-tenant-permission-boundary",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const approvalRows = rows.filter((row) => row.status === "approval-hold");
  const missingScopeSet = [...new Set(rows.flatMap((row) => row.missingScopes))].sort();
  const isolationKey = stableId("tenantiso", [
    plan.id,
    tenantId,
    workspaceId,
    actorId || "anonymous",
    rows.map((row) => `${row.jobId}:${row.permissionDecision}:${row.status}`).join(","),
  ]);
  const status = blockedRows.length > 0
    ? "blocked"
    : approvalRows.length > 0
      ? "needs-approval"
      : "ready";

  return {
    protocol: "aios.mailchimp.dry-run-tenant-audit-handoff.v1",
    id: stableId("audithandoff", [plan.id, isolationKey, status]),
    product: "mailchimp",
    planId: plan.id,
    status,
    safeBoundary: blockedRows.length === 0,
    isolationKey,
    actor: {
      id: actorId,
      roles,
      privileged,
    },
    scope: {
      tenantId,
      workspaceId,
      source: boundarySource.source ?? grant.source ?? runtime.permissionSource ?? "dry-run",
      policyVersion: String(boundarySource.policyVersion ?? grant.policyVersion ?? runtime.permissionPolicyVersion ?? "1"),
    },
    permissions: {
      granted: grantedScopes,
      missing: missingScopeSet,
      blockedJobIds: blockedRows.map((row) => row.jobId),
      approvalJobIds: approvalRows.map((row) => row.jobId),
    },
    rows,
    handoff: {
      required: true,
      externalWritesPerformed: false,
      auditAppendMode: "local-before-adapter-release",
      nextAction: blockedRows.length > 0
        ? "resolve-tenant-permission-boundary"
        : approvalRows.length > 0
          ? "collect-tenant-approval"
          : "append-audit-before-runtime-release",
      auditRefs: rows.map((row) => row.auditRef),
      resumeCursors: rows.map((row) => row.adapterStatusResumeCursor).filter(Boolean),
    },
    validation: [
      {
        code: "dry-run.audit.actor-bound",
        status: actorId ? "pass" : "degraded",
        detail: actorId
          ? "Tenant audit handoff is bound to an actor."
          : "Tenant audit handoff has no actor id; runtime must bind one before release.",
      },
      {
        code: "dry-run.audit.permission-scope",
        status: missingScopeSet.length === 0 || privileged ? "pass" : "fail",
        detail: missingScopeSet.length === 0 || privileged
          ? "All required permission scopes are covered for audit handoff."
          : `Missing audit permission scopes: ${missingScopeSet.join(", ")}.`,
      },
      {
        code: "dry-run.audit.workspace-boundary",
        status: rows.every((row) => row.tenantMatches && row.workspaceMatches) ? "pass" : "fail",
        detail: rows.every((row) => row.tenantMatches && row.workspaceMatches)
          ? "Every job remains inside the dry-run tenant workspace boundary."
          : "At least one job crosses the declared tenant or workspace boundary.",
      },
    ],
  };
}

function buildTenantBoundaryMatrix(plan, tenantAuditHandoff, jobResults) {
  const rows = Array.isArray(tenantAuditHandoff.rows) ? tenantAuditHandoff.rows : [];
  const rowByJobId = new Map(rows.map((row) => [row.jobId, row]));
  const matrixRows = jobResults.map((result, index) => {
    const auditRow = rowByJobId.get(result.jobId) ?? {};
    const tenantCheck = result.health.checks.find((check) => check.name === "tenant-permission");
    const missingScopes = normalizeAuditList(auditRow.missingScopes);
    const commandIds = normalizeAuditList(auditRow.commandIds ?? result.state.commandIds);
    const decision = auditRow.permissionDecision
      ?? (tenantCheck?.status === "fail" ? "deny" : tenantCheck?.status === "degraded" ? "needs-approval" : "allow");
    const status = auditRow.status
      ?? (decision === "deny" ? "blocked" : decision === "needs-approval" ? "approval-hold" : "audit-ready");
    const boundaryState = status === "blocked"
      ? "blocked"
      : status === "approval-hold" || decision === "needs-approval"
        ? "approval-required"
        : "ready";
    const tenantMatches = auditRow.tenantMatches !== false;
    const workspaceMatches = auditRow.workspaceMatches !== false;
    const safeForAdapterRelease = boundaryState === "ready"
      && tenantMatches
      && workspaceMatches
      && missingScopes.length === 0
      && result.adapterCall !== null;
    return {
      sequence: auditRow.sequence ?? index + 1,
      jobId: result.jobId,
      operation: result.operation,
      boundaryState,
      permissionDecision: decision,
      safeForAdapterRelease,
      tenantId: auditRow.tenantId ?? tenantAuditHandoff.scope?.tenantId ?? "",
      workspaceId: auditRow.workspaceId ?? tenantAuditHandoff.scope?.workspaceId ?? "",
      actorId: auditRow.actorId ?? tenantAuditHandoff.actor?.id ?? "",
      tenantMatches,
      workspaceMatches,
      missingScopes,
      commandIds,
      auditRef: auditRow.auditRef ?? null,
      checkpointKey: auditRow.checkpointKey ?? result.state.checkpointKey ?? null,
      replayCursor: auditRow.replayCursor ?? result.state.restartReplay?.replayCursor ?? null,
      adapterStatusResumeCursor: auditRow.adapterStatusResumeCursor ?? result.adapterStatusProbe?.resumeCursor ?? null,
      nextAction: boundaryState === "blocked"
        ? "resolve-tenant-permission-boundary"
        : boundaryState === "approval-required"
          ? "collect-tenant-approval"
          : "append-audit-before-runtime-release",
      reasons: [
        ...(tenantMatches ? [] : ["tenant-mismatch"]),
        ...(workspaceMatches ? [] : ["workspace-mismatch"]),
        ...missingScopes.map((scope) => `missing-scope:${scope}`),
        ...(tenantCheck?.status === "fail" ? ["tenant-permission-health-failed"] : []),
        ...(tenantCheck?.status === "degraded" ? ["tenant-permission-health-degraded"] : []),
      ],
    };
  });
  const blockedRows = matrixRows.filter((row) => row.boundaryState === "blocked");
  const approvalRows = matrixRows.filter((row) => row.boundaryState === "approval-required");
  const readyRows = matrixRows.filter((row) => row.boundaryState === "ready");
  const missingScopes = [...new Set(matrixRows.flatMap((row) => row.missingScopes))].sort();
  const auditRefs = normalizeAuditList(matrixRows.map((row) => row.auditRef).filter(Boolean));
  const resumeCursors = normalizeAuditList(matrixRows.map((row) => row.adapterStatusResumeCursor).filter(Boolean));
  const status = blockedRows.length > 0
    ? "blocked"
    : approvalRows.length > 0
      ? "needs-approval"
      : "ready";
  return {
    protocol: "aios.mailchimp.tenant-boundary-matrix.v1",
    id: stableId("tenantmatrix", [
      plan.id,
      tenantAuditHandoff.isolationKey,
      status,
      matrixRows.map((row) => `${row.jobId}:${row.boundaryState}`).join(","),
    ]),
    planId: plan.id,
    status,
    safeBoundary: status !== "blocked" && tenantAuditHandoff.safeBoundary === true,
    isolationKey: tenantAuditHandoff.isolationKey,
    policyVersion: tenantAuditHandoff.scope?.policyVersion ?? "1",
    actor: tenantAuditHandoff.actor,
    scope: tenantAuditHandoff.scope,
    counters: {
      rows: matrixRows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      approvalRequired: approvalRows.length,
      missingScopes: missingScopes.length,
      tenantMismatches: matrixRows.filter((row) => row.tenantMatches === false).length,
      workspaceMismatches: matrixRows.filter((row) => row.workspaceMatches === false).length,
      auditRefs: auditRefs.length,
      resumeCursors: resumeCursors.length,
    },
    audit: {
      appendMode: tenantAuditHandoff.handoff?.auditAppendMode ?? "local-before-adapter-release",
      auditRefs,
      resumeCursors,
      externalWritesPerformed: false,
      nextAction: blockedRows[0]?.nextAction ?? approvalRows[0]?.nextAction ?? "append-audit-before-runtime-release",
    },
    rows: matrixRows,
    exportReady: status === "ready" && matrixRows.every((row) => row.auditRef && row.safeForAdapterRelease),
    clientPatch: {
      tenantBoundaryMatrixId: stableId("tenantmatrixpatch", [plan.id, status, tenantAuditHandoff.isolationKey]),
      tenantBoundaryStatus: status,
      tenantBoundaryReady: status === "ready",
      tenantBoundaryBlockedJobs: blockedRows.map((row) => row.jobId),
      tenantBoundaryApprovalJobs: approvalRows.map((row) => row.jobId),
      tenantBoundaryMissingScopes: missingScopes,
      tenantBoundaryNextAction: blockedRows[0]?.nextAction ?? approvalRows[0]?.nextAction ?? "append-audit-before-runtime-release",
    },
  };
}

function buildPersistedStatusEnvelope(
  plan,
  jobResults,
  status,
  tenantBoundaryMatrix,
  runtimeReleaseDecision,
  runtimeBoundaryExecutionTickets = null,
) {
  const boundaryByJobId = new Map((tenantBoundaryMatrix.rows ?? []).map((row) => [row.jobId, row]));
  const ticketByJobId = new Map((runtimeBoundaryExecutionTickets?.rows ?? []).map((row) => [row.jobId, row]));
  const rows = jobResults.map((result, index) => {
    const boundary = boundaryByJobId.get(result.jobId) ?? {};
    const executionTicket = ticketByJobId.get(result.jobId) ?? {};
    const boundaryGate = result.boundaryExecutionGate ?? {};
    const lease = result.state?.commandLeaseReplay ?? {};
    const restartReplay = result.state?.restartReplay ?? {};
    const adapterOutcome = result.adapterStatusProbe?.dryRunOutcome ?? {};
    const blocked = ["blocked", "skipped"].includes(result.status)
      || boundary.boundaryState === "blocked"
      || executionTicket.state === "blocked"
      || boundaryGate.state === "blocked"
      || result.health.checks.some((check) => check.status === "fail");
    const waiting = blocked === false && (
      result.status === "degraded"
      || boundary.boundaryState === "approval-required"
      || executionTicket.state === "waiting"
      || boundaryGate.state === "waiting"
      || adapterOutcome.classification === "pending"
      || lease.ackRequired === true
    );
    const rowStatus = blocked ? "blocked" : waiting ? "waiting" : "ready";
    const resumeCursor = restartReplay.replayCursor
      ?? boundary.replayCursor
      ?? result.adapterStatusProbe?.resumeCursor
      ?? null;
    const idempotencyKey = result.state?.idempotencyKey
      ?? lease.idempotencyKey
      ?? boundary.auditRef
      ?? null;
    return {
      sequence: index + 1,
      jobId: result.jobId,
      operation: result.operation,
      status: rowStatus,
      dryRunStatus: result.status,
      reason: result.reason,
      visibleStatus: result.adapterStatusProbe?.visibleStatus
        ?? result.state?.statusProjection?.clientVisibleStatus
        ?? rowStatus,
      checkpointKey: result.state?.checkpointKey ?? null,
      ledgerKey: result.state?.ledgerKey ?? null,
      commandIds: result.state?.commandIds ?? [],
      resumeCursor,
      replayDecision: restartReplay.replayDecision ?? null,
      adapterStatusResumeCursor: result.adapterStatusProbe?.resumeCursor ?? null,
      simulatedAdapterStatus: adapterOutcome.status ?? null,
      fixtureId: adapterOutcome.fixtureId ?? null,
      leaseId: lease.id ?? null,
      ackRequired: lease.ackRequired === true,
      idempotencyKey,
      tenantBoundaryState: boundary.boundaryState ?? "unknown",
      runtimeBoundaryTicketState: executionTicket.state ?? "unknown",
      runtimeBoundaryTicketId: executionTicket.ticketId ?? null,
      runtimeBoundaryGateState: boundaryGate.state ?? "unknown",
      runtimeBoundaryGateReady: boundaryGate.readyForAdapterRelease === true,
      runtimeBoundaryGateNextAction: boundaryGate.nextAction ?? null,
      auditRef: boundary.auditRef ?? null,
      restartSafe: rowStatus !== "blocked"
        && Boolean(result.state?.statusProjection?.restartSafe)
        && Boolean(resumeCursor)
        && Boolean(idempotencyKey),
      nextAction: rowStatus === "blocked"
        ? boundaryGate.nextAction
          || executionTicket.nextAction
          || boundary.nextAction
          || result.actionableErrors[0]?.action
          || "repair-dry-run-status-envelope"
        : waiting
          ? boundaryGate.nextAction
            || executionTicket.nextAction
            || boundary.nextAction
            || lease.nextAction
            || result.recoveryHandoff?.nextAction
            || "persist-and-wait"
          : "return-existing-status-envelope",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const waitingRows = rows.filter((row) => row.status === "waiting");
  const unsafeRows = rows.filter((row) => row.restartSafe === false);
  const envelopeStatus = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "ready";
  const statusRevision = stableId("drystatusrev", [
    plan.id,
    status,
    envelopeStatus,
    rows.map((row) => `${row.jobId}:${row.status}:${row.resumeCursor ?? ""}`).join(","),
  ]);
  const resumeToken = stableId("drystatusresume", [
    plan.id,
    statusRevision,
    rows.map((row) => row.idempotencyKey ?? row.jobId).join(","),
  ]);

  return {
    protocol: "aios.mailchimp.dry-run-persisted-status-envelope.v1",
    id: stableId("drystatusenv", [plan.id, statusRevision, envelopeStatus]),
    product: "mailchimp",
    planId: plan.id,
    status: envelopeStatus,
    dryRunStatus: status,
    readyForRestart: envelopeStatus === "ready" && unsafeRows.length === 0,
    readyForRuntimeRelease: envelopeStatus === "ready"
      && runtimeReleaseDecision?.ready === true
      && tenantBoundaryMatrix.safeBoundary === true
      && runtimeBoundaryExecutionTickets?.readyForRuntimeRelease !== false,
    resumeToken,
    statusRevision,
    visibleStatus: envelopeStatus === "blocked"
      ? "dry-run-status-blocked"
      : envelopeStatus === "waiting"
        ? "dry-run-status-waiting"
        : "dry-run-status-ready",
    rows,
    counters: {
      rows: rows.length,
      ready: rows.filter((row) => row.status === "ready").length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      restartUnsafe: unsafeRows.length,
      ackRequired: rows.filter((row) => row.ackRequired).length,
    },
    blocking: {
      blockedJobIds: blockedRows.map((row) => row.jobId),
      waitingJobIds: waitingRows.map((row) => row.jobId),
      unsafeJobIds: unsafeRows.map((row) => row.jobId),
      tenantBoundaryStatus: tenantBoundaryMatrix.status,
      runtimeBoundaryTicketStatus: runtimeBoundaryExecutionTickets?.status ?? "unknown",
    },
    clientPatch: {
      dryRunPersistedStatusEnvelopeId: stableId("drystatuspatch", [plan.id, statusRevision]),
      dryRunPersistedStatusReady: envelopeStatus === "ready" && unsafeRows.length === 0,
      dryRunPersistedStatus: envelopeStatus,
      dryRunPersistedStatusRevision: statusRevision,
      dryRunPersistedStatusResumeToken: resumeToken,
      dryRunPersistedStatusNextAction: blockedRows[0]?.nextAction
        || waitingRows[0]?.nextAction
        || "return-existing-status-envelope",
    },
    restartSemantics: {
      replaySafe: envelopeStatus === "ready" && unsafeRows.length === 0,
      duplicateCommandPolicy: "dedupe-by-dry-run-status-revision",
      staleStatusPolicy: {
        onRevisionMismatch: "reload-dry-run-status-envelope",
        onMissingReplayCursor: "rebuild-dry-run-replay-ledger",
        onTenantBoundaryChange: "recompute-tenant-boundary-matrix",
        onRuntimeBoundaryTicketChange: "recompute-runtime-boundary-execution-tickets",
      },
      externalWritesPerformed: false,
    },
    nextAction: blockedRows[0]?.nextAction
      || waitingRows[0]?.nextAction
      || "return-existing-status-envelope",
  };
}

function buildRuntimeBoundaryExecutionTickets(plan, jobResults, tenantBoundaryMatrix, runtimeBoundaryDryRun, runtimeReleaseDecision) {
  const boundaryByJobId = new Map((tenantBoundaryMatrix?.rows ?? []).map((row) => [row.jobId, row]));
  const boundaryDryRunByJobId = new Map((runtimeBoundaryDryRun?.rows ?? []).map((row) => [row.jobId, row]));
  const releaseBlocked = runtimeReleaseDecision?.state === "blocked" || runtimeReleaseDecision?.ready === false;
  const releaseWaiting = releaseBlocked === false && (
    runtimeReleaseDecision?.state === "needs-operator-action"
      || runtimeReleaseDecision?.state === "waiting"
      || runtimeReleaseDecision?.ready !== true
  );
  const rows = jobResults.map((result, index) => {
    const boundary = boundaryByJobId.get(result.jobId) ?? {};
    const boundaryDryRun = boundaryDryRunByJobId.get(result.jobId) ?? {};
    const adapterOutcome = result.adapterStatusProbe?.dryRunOutcome ?? {};
    const healthFailures = result.health?.checks?.filter((check) => check.status === "fail") ?? [];
    const healthWarnings = result.health?.checks?.filter((check) => check.status === "degraded") ?? [];
    const tenantBlocked = boundary.boundaryState === "blocked"
      || boundaryDryRun.state === "blocked"
      || result.health?.checks?.some((check) => check.name === "tenant-permission" && check.status === "fail");
    const tenantWaiting = tenantBlocked === false && (
      boundary.boundaryState === "approval-required"
        || boundaryDryRun.state === "waiting"
        || result.health?.checks?.some((check) => check.name === "tenant-permission" && check.status === "degraded")
    );
    const adapterBlocked = result.status === "blocked"
      || result.status === "skipped"
      || adapterOutcome.classification === "failure"
      || healthFailures.length > 0;
    const adapterWaiting = adapterBlocked === false && (
      result.status === "degraded"
        || adapterOutcome.classification === "pending"
        || adapterOutcome.terminal === false
        || healthWarnings.length > 0
    );
    const state = tenantBlocked || adapterBlocked || releaseBlocked
      ? "blocked"
      : tenantWaiting || adapterWaiting || releaseWaiting
        ? "waiting"
        : "ready";
    const auditRef = boundary.auditRef ?? null;
    const ticketId = stableId("dryticket", [
      plan.id,
      result.jobId,
      boundary.boundaryState,
      boundaryDryRun.state,
      runtimeReleaseDecision?.state,
      auditRef,
    ]);
    return {
      sequence: index + 1,
      ticketId,
      jobId: result.jobId,
      operation: result.operation,
      state,
      visibleStatus: state === "ready"
        ? "runtime-boundary-ticket-ready"
        : state === "waiting"
          ? "runtime-boundary-ticket-waiting"
          : "runtime-boundary-ticket-blocked",
      tenantBoundaryState: boundary.boundaryState ?? "unknown",
      runtimeBoundaryState: boundaryDryRun.state ?? "unknown",
      releaseState: runtimeReleaseDecision?.state ?? "unknown",
      permissionDecision: boundary.permissionDecision ?? "unknown",
      safeForAdapterRelease: state === "ready"
        && boundary.safeForAdapterRelease === true
        && boundaryDryRun.safeForAdapterRelease !== false,
      ticketCommand: {
        commandId: state === "ready" ? stableId("dryticketcmd", [ticketId, "release"]) : null,
        idempotencyKey: stableId("idem", [ticketId, result.state?.idempotencyKey ?? result.jobId]),
        externalWritesPerformed: false,
        wouldReleaseAdapterCall: state === "ready" && result.adapterCall !== null,
      },
      scope: {
        tenantId: boundary.tenantId ?? tenantBoundaryMatrix?.scope?.tenantId ?? null,
        workspaceId: boundary.workspaceId ?? tenantBoundaryMatrix?.scope?.workspaceId ?? null,
        actorId: boundary.actorId ?? tenantBoundaryMatrix?.actor?.id ?? null,
        isolationKey: tenantBoundaryMatrix?.isolationKey ?? null,
      },
      audit: {
        auditRef,
        appendMode: tenantBoundaryMatrix?.audit?.appendMode ?? "local-before-adapter-release",
        externalWritesPerformed: false,
      },
      restart: {
        checkpointKey: result.state?.checkpointKey ?? boundary.checkpointKey ?? null,
        replayCursor: result.state?.restartReplay?.replayCursor ?? boundary.replayCursor ?? null,
        adapterStatusResumeCursor: result.adapterStatusProbe?.resumeCursor ?? boundary.adapterStatusResumeCursor ?? null,
        restartSafe: state !== "blocked"
          && result.state?.restartReplay?.restartSafe !== false
          && Boolean(result.state?.restartReplay?.replayCursor ?? boundary.replayCursor),
      },
      blockers: [
        ...(tenantBlocked ? ["tenant-boundary"] : []),
        ...(adapterBlocked ? ["adapter-or-health"] : []),
        ...(releaseBlocked ? ["runtime-release"] : []),
        ...healthFailures.map((check) => `health:${check.name}`),
      ],
      waiters: [
        ...(tenantWaiting ? ["tenant-approval"] : []),
        ...(adapterWaiting ? ["adapter-status"] : []),
        ...(releaseWaiting ? ["runtime-release"] : []),
        ...healthWarnings.map((check) => `health:${check.name}`),
      ],
      nextAction: state === "blocked"
        ? boundaryDryRun.nextAction
          ?? boundary.nextAction
          ?? runtimeReleaseDecision?.nextAction
          ?? "repair-runtime-boundary-ticket"
        : state === "waiting"
          ? boundaryDryRun.nextAction
            ?? boundary.nextAction
            ?? runtimeReleaseDecision?.nextAction
            ?? "wait-for-runtime-boundary-ticket"
          : "release-runtime-boundary-ticket",
    };
  });
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const readyRows = rows.filter((row) => row.state === "ready");
  const state = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "ready";
  const ticketKey = stableId("drytickets", [
    plan.id,
    tenantBoundaryMatrix?.id,
    runtimeBoundaryDryRun?.id,
    runtimeReleaseDecision?.releaseToken,
    state,
    rows.map((row) => `${row.jobId}:${row.state}`).join(","),
  ]);

  return {
    protocol: "aios.mailchimp.dry-run-runtime-boundary-execution-tickets.v1",
    id: ticketKey,
    planId: plan.id,
    state,
    visibleStatus: state === "ready"
      ? "runtime-boundary-tickets-ready"
      : state === "waiting"
        ? "runtime-boundary-tickets-waiting"
        : "runtime-boundary-tickets-blocked",
    ready: state === "ready",
    exportReady: state !== "blocked",
    readyForRuntimeRelease: state === "ready"
      && tenantBoundaryMatrix?.safeBoundary === true
      && runtimeReleaseDecision?.ready === true,
    sourceMatrixId: tenantBoundaryMatrix?.id ?? null,
    sourceRuntimeBoundaryId: runtimeBoundaryDryRun?.id ?? null,
    releaseToken: runtimeReleaseDecision?.releaseToken ?? null,
    rows,
    counters: {
      rows: rows.length,
      ready: readyRows.length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      restartUnsafe: rows.filter((row) => row.restart.restartSafe === false).length,
    },
    clientPatch: {
      runtimeBoundaryExecutionTicketId: ticketKey,
      runtimeBoundaryExecutionTicketStatus: state,
      runtimeBoundaryExecutionTicketReady: state === "ready",
      runtimeBoundaryExecutionTicketNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? "release-runtime-boundary-ticket",
      runtimeBoundaryExecutionTicketBlockedJobIds: blockedRows.map((row) => row.jobId),
      runtimeBoundaryExecutionTicketWaitingJobIds: waitingRows.map((row) => row.jobId),
      runtimeBoundaryExecutionTicketCommandIds: rows
        .map((row) => row.ticketCommand.commandId)
        .filter(Boolean),
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restart.restartSafe !== false),
      onRestart: "reload-runtime-boundary-execution-tickets",
      onDuplicateCommand: "return-existing-runtime-boundary-ticket",
      ticketKey,
      externalWritesPerformed: false,
    },
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? "release-runtime-boundary-ticket",
  };
}

function attachRuntimeBoundaryExecutionGate(jobResults, runtimeBoundaryExecutionTickets, tenantBoundaryMatrix) {
  const ticketByJobId = new Map((runtimeBoundaryExecutionTickets?.rows ?? []).map((row) => [row.jobId, row]));
  const boundaryByJobId = new Map((tenantBoundaryMatrix?.rows ?? []).map((row) => [row.jobId, row]));
  return jobResults.map((result) => {
    const ticket = ticketByJobId.get(result.jobId) ?? {};
    const boundary = boundaryByJobId.get(result.jobId) ?? {};
    const state = ticket.state ?? (boundary.boundaryState === "blocked" ? "blocked" : "waiting");
    const safeForAdapterRelease = state === "ready"
      && ticket.safeForAdapterRelease === true
      && boundary.safeForAdapterRelease === true
      && result.adapterCall !== null;
    const auditReady = Boolean(ticket.audit?.auditRef || boundary.auditRef)
      && ticket.audit?.externalWritesPerformed === false;
    const command = ticket.ticketCommand ?? {};
    const restart = ticket.restart ?? {};
    const blockers = normalizeAuditList([
      ...(ticket.blockers ?? []),
      ...(safeForAdapterRelease ? [] : ["adapter-release-not-safe"]),
      ...(auditReady ? [] : ["audit-ref-missing"]),
    ]);
    const waiters = normalizeAuditList(ticket.waiters ?? []);
    const releaseState = blockers.length > 0
      ? "blocked"
      : waiters.length > 0 || state === "waiting"
        ? "waiting"
        : "ready";
    return {
      ...result,
      boundaryExecutionGate: {
        schemaVersion: "aios.mailchimp.dry-run-boundary-execution-gate.v1",
        ticketId: ticket.ticketId ?? null,
        ticketSetId: runtimeBoundaryExecutionTickets?.id ?? null,
        state: releaseState,
        visibleStatus: ticket.visibleStatus ?? (
          releaseState === "ready"
            ? "runtime-boundary-ticket-ready"
            : releaseState === "waiting"
              ? "runtime-boundary-ticket-waiting"
              : "runtime-boundary-ticket-blocked"
        ),
        readyForAdapterRelease: safeForAdapterRelease,
        readyForRuntimeRelease: releaseState === "ready"
          && runtimeBoundaryExecutionTickets?.readyForRuntimeRelease === true,
        permissionDecision: ticket.permissionDecision ?? boundary.permissionDecision ?? "unknown",
        tenantBoundaryState: ticket.tenantBoundaryState ?? boundary.boundaryState ?? "unknown",
        runtimeBoundaryState: ticket.runtimeBoundaryState ?? "unknown",
        releaseState: ticket.releaseState ?? "unknown",
        scope: {
          tenantId: ticket.scope?.tenantId ?? boundary.tenantId ?? tenantBoundaryMatrix?.scope?.tenantId ?? null,
          workspaceId: ticket.scope?.workspaceId ?? boundary.workspaceId ?? tenantBoundaryMatrix?.scope?.workspaceId ?? null,
          actorId: ticket.scope?.actorId ?? boundary.actorId ?? tenantBoundaryMatrix?.actor?.id ?? null,
          isolationKey: ticket.scope?.isolationKey ?? tenantBoundaryMatrix?.isolationKey ?? null,
        },
        audit: {
          auditRef: ticket.audit?.auditRef ?? boundary.auditRef ?? null,
          appendMode: ticket.audit?.appendMode ?? tenantBoundaryMatrix?.audit?.appendMode ?? "local-before-adapter-release",
          ready: auditReady,
          externalWritesPerformed: false,
        },
        command: {
          commandId: command.commandId ?? null,
          idempotencyKey: command.idempotencyKey ?? result.state?.idempotencyKey ?? null,
          wouldReleaseAdapterCall: safeForAdapterRelease && command.wouldReleaseAdapterCall === true,
          externalWritesPerformed: false,
        },
        restart: {
          checkpointKey: restart.checkpointKey ?? boundary.checkpointKey ?? result.state?.checkpointKey ?? null,
          replayCursor: restart.replayCursor ?? boundary.replayCursor ?? result.state?.restartReplay?.replayCursor ?? null,
          adapterStatusResumeCursor: restart.adapterStatusResumeCursor
            ?? boundary.adapterStatusResumeCursor
            ?? result.adapterStatusProbe?.resumeCursor
            ?? null,
          restartSafe: releaseState !== "blocked"
            && restart.restartSafe !== false
            && Boolean(restart.replayCursor ?? boundary.replayCursor ?? result.state?.restartReplay?.replayCursor),
        },
        blockers,
        waiters,
        nextAction: releaseState === "blocked"
          ? ticket.nextAction ?? boundary.nextAction ?? "repair-runtime-boundary-ticket"
          : releaseState === "waiting"
            ? ticket.nextAction ?? boundary.nextAction ?? "wait-for-runtime-boundary-ticket"
            : "release-runtime-boundary-ticket",
      },
    };
  });
}

function buildProviderHealthPreview(plan, jobResults) {
  const source = plan.providerService?.operationalHealth ?? {};
  const providerPreview = plan.providerService?.externalHandoff ?? {};
  const jobBlockedIds = jobResults
    .filter((result) => ["blocked", "skipped"].includes(result.status))
    .map((result) => result.jobId);
  const jobDegradedIds = jobResults
    .filter((result) => result.status === "degraded")
    .map((result) => result.jobId);
  const checks = source.checks ?? [];
  const blockingChecks = checks.filter((check) => check.status === "blocked");
  const degradedChecks = checks.filter((check) => ["degraded", "review"].includes(check.status));
  const status = source.status ?? (
    blockingChecks.length > 0 || jobBlockedIds.length > 0
      ? "unhealthy"
      : degradedChecks.length > 0 || jobDegradedIds.length > 0
        ? "degraded"
        : "healthy"
  );
  const retryable = source.retryPolicy?.retryable === true && jobBlockedIds.length === 0;
  return {
    id: source.id ?? stableId("providerhealth", [
      plan.id,
      providerPreview.handoffId,
      status,
      jobResults.map((result) => `${result.jobId}:${result.status}`).join(","),
    ]),
    product: "mailchimp",
    status,
    externalHandoffState: source.externalHandoffState ?? providerPreview.state ?? "unknown",
    blockedReason: source.blockedReason ?? providerPreview.blockedReason ?? null,
    nextAction: jobBlockedIds.length > 0
      ? "repair-blocked-jobs-before-provider-handoff"
      : source.nextAction ?? providerPreview.nextAction ?? "review-provider-handoff",
    checks,
    actionableErrors: source.actionableErrors ?? [],
    retryPolicy: {
      retryable,
      maxAttempts: retryable ? source.retryPolicy?.maxAttempts ?? 3 : 0,
      backoff: retryable ? source.retryPolicy?.backoff ?? [] : [],
    },
    degradedMode: {
      enabled: status === "degraded" || jobDegradedIds.length > 0,
      reason: source.degradedMode?.reason ?? degradedChecks[0]?.name ?? (jobDegradedIds.length > 0 ? "job-degraded" : null),
      allowedActions: source.degradedMode?.allowedActions ?? (
        jobDegradedIds.length > 0 ? ["collect-approval", "persist-provider-cursors"] : []
      ),
      blockedAdapterCalls: [...new Set([
        ...(source.degradedMode?.blockedAdapterCalls ?? []),
        ...jobBlockedIds,
      ])],
    },
    syncContractId: source.syncContractId ?? plan.providerService?.sync?.contractId ?? null,
    adapterStatusResumeCursors: source.adapterStatusResumeCursors
      ?? providerPreview.adapterStatusResumeCursors
      ?? [],
    jobState: {
      blockedJobIds: jobBlockedIds,
      degradedJobIds: jobDegradedIds,
      wouldRunJobIds: jobResults
        .filter((result) => result.status === "would-run")
        .map((result) => result.jobId),
    },
  };
}

function buildProviderCapabilityDryRunState(plan, jobResults) {
  const source = plan.providerService?.providerCapabilityReplay
    ?? plan.providerService?.capabilityNegotiation
    ?? {};
  const rows = source.capabilityRows ?? source.rows ?? [];
  const rowByCapability = new Map(rows.map((row) => [row.capability, row]));
  const jobById = new Map((plan.jobs ?? []).map((job) => [job.id, job]));
  const resultByJobId = new Map(jobResults.map((result) => [result.jobId, result]));
  const jobRows = jobResults.map((result, index) => {
    const job = jobById.get(result.jobId) ?? {};
    const grant = job.recovery?.providerCapabilityGrant ?? {};
    const capabilities = grant.requiredCapabilities ?? job.capabilities?.map((capability) => capability.name) ?? [];
    const capabilityStates = capabilities.map((capability) => {
      const row = rowByCapability.get(capability) ?? {};
      const blockedByResult = ["blocked", "skipped"].includes(result.status);
      const grantState = row.grantState
        ?? (blockedByResult
          ? "held"
          : result.status === "degraded"
            ? "waiting-for-approval"
            : "granted");
      return {
        capability,
        provider: row.provider ?? (capability.startsWith("mailchimp.") ? "mailchimp-marketing" : "aios-runtime"),
        use: row.use ?? "runtime",
        grantState,
        persistKey: row.persistKey ?? stableId("capgrantkey", [
          plan.id,
          result.jobId,
          capability,
        ]),
        replayAction: row.replayAction ?? (
          grantState === "granted" ? "return-existing-grant" : "persist-held-provider-grant"
        ),
        restartSafe: row.restartSafe !== false && !blockedByResult,
      };
    });
    const missingCapabilities = capabilityStates
      .filter((row) => row.grantState === "missing-workspace-grant")
      .map((row) => row.capability);
    const heldCapabilities = capabilityStates
      .filter((row) => row.grantState !== "granted" && row.grantState !== "missing-workspace-grant")
      .map((row) => row.capability);
    const status = missingCapabilities.length > 0 || ["blocked", "skipped"].includes(result.status)
      ? "blocked"
      : heldCapabilities.length > 0 || result.status === "degraded"
        ? "waiting"
        : "ready";
    return {
      sequence: index + 1,
      jobId: result.jobId,
      operation: result.operation,
      status,
      capabilityStates,
      persistKeys: [...new Set([
        ...(grant.persistKeys ?? []),
        ...capabilityStates.map((row) => row.persistKey),
      ])].sort(),
      missingCapabilities,
      heldCapabilities,
      replayCursor: result.state?.restartReplay?.replayCursor
        ?? result.adapterStatusProbe?.resumeCursor
        ?? null,
      idempotencyKey: result.state?.idempotencyKey ?? null,
      nextAction: status === "blocked"
        ? "repair-provider-capability-grants"
        : status === "waiting"
          ? "resume-provider-capability-negotiation"
          : "return-existing-provider-grants",
    };
  });
  const blockedRows = jobRows.filter((row) => row.status === "blocked");
  const waitingRows = jobRows.filter((row) => row.status === "waiting");
  const allPersistKeys = [...new Set(jobRows.flatMap((row) => row.persistKeys))].sort();
  const missingCapabilities = [...new Set(jobRows.flatMap((row) => row.missingCapabilities))].sort();
  const heldCapabilities = [...new Set(jobRows.flatMap((row) => row.heldCapabilities))].sort();
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : source.state ?? "ready";
  const commandScope = [
    plan.id,
    source.id ?? source.replayContractId,
    status,
    allPersistKeys.join(","),
  ];
  const commands = [
    ...(source.commands ?? []),
    {
      id: stableId("dryprovidercmd", [...commandScope, "persist-dry-run-ledger"]),
      type: "persist-dry-run-provider-capability-ledger",
      idempotencyKey: stableId("idem", [...commandScope, "persist-dry-run-ledger"]),
      statusAfterReplay: status,
      writes: ["providerCapabilityRows", "jobGrantStates", "dryRunGuarantee"],
      conflict: "return-existing",
    },
  ];
  return {
    protocol: "aios.mailchimp.dry-run-provider-capability-state.v1",
    id: stableId("dryprovidercaps", commandScope),
    sourceContractId: source.id ?? source.replayContractId ?? null,
    product: "mailchimp",
    status,
    ready: status === "ready",
    resumeCursor: source.resumeCursor ?? stableId("dryprovidercursor", commandScope),
    syncContractId: source.syncContractId ?? plan.providerService?.sync?.contractId ?? null,
    syncCursorKey: source.syncCursorKey ?? plan.providerService?.sync?.cursor?.checkpointKey ?? null,
    rows: jobRows,
    commands,
    missingCapabilities,
    heldCapabilities,
    persistKeys: allPersistKeys,
    dryRunGuarantee: {
      externalWritesPerformed: false,
      providerGrantsMutated: false,
      replayLedgerPersistedLocally: true,
      restartSafe: status !== "blocked" && jobRows.every((row) => (
        row.capabilityStates.every((capability) => capability.restartSafe)
      )),
    },
    restartSemantics: {
      onRestart: status === "ready"
        ? "return-existing-dry-run-provider-ledger"
        : "reload-provider-capability-state",
      onDuplicateCommand: "return-existing-dry-run-provider-command",
      onMissingGrant: "hold-before-runtime-release",
    },
    clientPatch: {
      providerCapabilityReplayId: stableId("dryprovidercappatch", [plan.id, status]),
      providerCapabilityReplayStatus: status,
      providerCapabilityReplayReady: status === "ready",
      providerCapabilityReplayNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? "return-existing-provider-grants",
      providerCapabilityMissing: missingCapabilities,
      providerCapabilityHeld: heldCapabilities,
      providerCapabilityCommandIds: commands.map((command) => command.id),
      providerCapabilityResumeCursor: source.resumeCursor ?? stableId("dryprovidercursor", commandScope),
    },
  };
}

function buildProviderCredentialLeaseDryRunState(plan, jobResults, providerCapabilityDryRunState) {
  const source = plan.providerService?.providerCredentialLease
    ?? plan.providerService?.capabilityNegotiation
    ?? {};
  const sourceRows = source.scopeRows ?? [];
  const sourceRowByScope = new Map(sourceRows.map((row) => [row.providerScope, row]));
  const resultByJobId = new Map(jobResults.map((result) => [result.jobId, result]));
  const capabilityRows = providerCapabilityDryRunState?.rows ?? [];
  const fallbackRows = capabilityRows.flatMap((jobRow) => (
    (jobRow.capabilityStates ?? [])
      .filter((capability) => capability.provider === (source.provider ?? "mailchimp-marketing"))
      .map((capability) => {
        const access = capability.capability.endsWith(".send")
          ? "send"
          : capability.capability.endsWith(".write") || capability.capability.includes("segment.write")
            ? "write"
            : capability.capability.endsWith(".read") || capability.capability.includes("status")
              ? "read"
              : "runtime";
        const object = capability.capability.includes("campaign")
          ? "campaign"
          : capability.capability.includes("segment")
            ? "segment"
            : capability.capability.includes("template")
              ? "template"
              : capability.capability.includes("audience")
                ? "audience"
                : "mailchimp";
        return {
          providerScope: `mailchimp:${object}:${access}`,
          capability: capability.capability,
          provider: capability.provider,
          usedByJobIds: [jobRow.jobId],
          leaseState: capability.grantState === "granted" ? "leased" : capability.grantState,
          needsConsent: ["send", "write"].includes(access),
          credentialKey: stableId("credkey", [plan.id, jobRow.jobId, capability.capability]),
          persistKey: stableId("credlease", [plan.id, jobRow.jobId, capability.capability]),
        };
      })
  ));
  const scopeRows = (sourceRows.length > 0 ? sourceRows : fallbackRows).map((row, index) => {
    const resultRows = (row.usedByJobIds ?? [])
      .map((jobId) => resultByJobId.get(jobId))
      .filter(Boolean);
    const blockedByResult = resultRows.some((result) => ["blocked", "skipped"].includes(result.status));
    const waitingByResult = resultRows.some((result) => result.status === "degraded");
    const sourceRow = sourceRowByScope.get(row.providerScope) ?? row;
    const leaseState = blockedByResult
      ? "blocked"
      : waitingByResult && row.needsConsent
        ? "waiting-for-consent"
        : sourceRow.leaseState ?? "leased";
    const restartSafe = leaseState !== "blocked"
      && sourceRow.restartSafe !== false
      && resultRows.every((result) => result.state?.restartReplay?.restartSafe !== false);
    return {
      sequence: index + 1,
      providerScope: row.providerScope,
      capability: row.capability,
      provider: row.provider ?? source.provider ?? "mailchimp-marketing",
      leaseState,
      needsConsent: row.needsConsent === true,
      credentialKey: row.credentialKey ?? stableId("credkey", [plan.id, row.providerScope]),
      persistKey: row.persistKey ?? stableId("credlease", [plan.id, row.providerScope]),
      usedByJobIds: row.usedByJobIds ?? [],
      commandIds: [
        ...(source.commands ?? []).map((command) => command.id),
        ...(resultRows.flatMap((result) => result.state?.commandIds ?? [])),
      ].filter(Boolean),
      restartSafe,
      replayCursor: resultRows
        .map((result) => result.state?.restartReplay?.replayCursor ?? result.adapterStatusProbe?.resumeCursor)
        .find(Boolean) ?? source.resumeCursor ?? null,
      nextAction: leaseState === "blocked"
        ? "repair-provider-credential-lease"
        : leaseState === "waiting-for-consent"
          ? "collect-provider-credential-consent"
          : leaseState === "held"
            ? "persist-held-provider-credential-lease"
            : "return-existing-provider-credential-lease",
    };
  });
  const blockedRows = scopeRows.filter((row) => row.leaseState === "blocked");
  const waitingRows = scopeRows.filter((row) => row.leaseState === "waiting-for-consent");
  const heldRows = scopeRows.filter((row) => row.leaseState === "held");
  const state = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting-for-consent"
      : heldRows.length > 0
        ? "held"
        : source.state ?? "ready";
  const commandScope = [
    plan.id,
    source.id ?? source.credentialLeaseId,
    providerCapabilityDryRunState?.id,
    state,
    scopeRows.map((row) => `${row.providerScope}:${row.leaseState}`).join(","),
  ];
  const commands = [
    ...(source.commands ?? []),
    {
      id: stableId("drycredleasecmd", [...commandScope, "persist-dry-run-credential-leases"]),
      type: "persist-dry-run-provider-credential-leases",
      idempotencyKey: stableId("idem", [...commandScope, "persist-dry-run-credential-leases"]),
      statusAfterReplay: state,
      writes: ["providerCredentialLeaseRows", "credentialKeys", "dryRunGuarantee"],
      conflict: "return-existing",
    },
  ];
  const resumeCursor = source.resumeCursor ?? stableId("drycredleasecursor", commandScope);
  return {
    protocol: "aios.mailchimp.dry-run-provider-credential-lease.v1",
    id: stableId("drycredlease", commandScope),
    sourceContractId: source.id ?? source.credentialLeaseId ?? null,
    product: "mailchimp",
    provider: source.provider ?? "mailchimp-marketing",
    status: state,
    ready: state === "ready",
    resumeCursor,
    rows: scopeRows,
    commands,
    blockedScopes: blockedRows.map((row) => row.providerScope),
    waitingScopes: waitingRows.map((row) => row.providerScope),
    heldScopes: heldRows.map((row) => row.providerScope),
    credentialKeys: [...new Set(scopeRows.map((row) => row.credentialKey))].sort(),
    persistKeys: [...new Set(scopeRows.map((row) => row.persistKey))].sort(),
    dryRunGuarantee: {
      externalWritesPerformed: false,
      providerTokensPersisted: false,
      credentialLeasesMutated: false,
      restartSafe: state !== "blocked" && scopeRows.every((row) => row.restartSafe),
    },
    restartSemantics: {
      onRestart: state === "ready"
        ? "return-existing-dry-run-provider-credential-leases"
        : "reload-provider-credential-lease-ledger",
      onDuplicateCommand: "return-existing-dry-run-provider-credential-command",
      onConsentRequired: "resume-provider-credential-consent",
      externalTokensPersisted: false,
    },
    clientPatch: {
      providerCredentialLeaseId: stableId("drycredleasepatch", [plan.id, state]),
      providerCredentialLeaseStatus: state,
      providerCredentialLeaseReady: state === "ready",
      providerCredentialLeaseNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? heldRows[0]?.nextAction
        ?? "return-existing-provider-credential-lease",
      providerCredentialBlockedScopes: blockedRows.map((row) => row.providerScope),
      providerCredentialWaitingScopes: waitingRows.map((row) => row.providerScope),
      providerCredentialHeldScopes: heldRows.map((row) => row.providerScope),
      providerCredentialCommandIds: commands.map((command) => command.id),
      providerCredentialResumeCursor: resumeCursor,
    },
  };
}

function buildClientCommandLeaseReplay(plan, jobResults, lifecycle, providerPreview) {
  const claimRuntime = plan.claimGate?.clientRuntime ?? {};
  const packageLifecycle = plan.package?.lifecycleControls ?? {};
  const lifecycleCommandIds = new Set([
    ...(lifecycle.commands ?? []).map((command) => command.id),
    ...(packageLifecycle.commands ?? []).map((command) => command.id),
    ...(packageLifecycle.commandIds ?? []),
  ].filter(Boolean));
  const releaseGate = providerPreview.lifecycleGate ?? {};
  const leaseScope = [
    claimRuntime.tenantId ?? "tenant.local",
    claimRuntime.workspaceId ?? "workspace.local",
    claimRuntime.workflowId ?? plan.id,
    plan.restartProjection?.replayCursor ?? "no-restart-cursor",
  ];
  const leases = jobResults.map((result, index) => {
    const statusProjection = result.state.statusProjection ?? {};
    const clientState = result.state.clientOperationState ?? {};
    const adapterProbe = result.adapterStatusProbe ?? {};
    const healthBlocker = result.health.checks.find((check) => check.status === "fail");
    const healthPause = result.health.checks.find((check) => check.status === "degraded");
    const commandId = result.state.commandIds?.find((id) => lifecycleCommandIds.has(id))
      ?? result.state.commandIds?.at(-1)
      ?? adapterProbe.statusCommandId
      ?? null;
    const status = result.status === "would-run"
      ? "leased"
      : result.status === "degraded"
        ? "waiting"
        : "blocked";
    const blocksRuntimeStart = status === "blocked" || releaseGate.releaseAllowed === false;
    const ackRequired = status !== "leased"
      || result.reason === "approval-required"
      || clientState.workflowState === "blocked"
      || adapterProbe.state === "paused";
    const leaseKey = stableId("leasekey", [
      ...leaseScope,
      result.jobId,
      commandId,
      status,
      index,
    ]);
    return {
      id: stableId("lease", [leaseKey, "client-command"]),
      jobId: result.jobId,
      operation: result.operation,
      commandId,
      status,
      reason: healthBlocker?.name ?? healthPause?.name ?? result.reason,
      clientVisible: true,
      blocksRuntimeStart,
      ackRequired,
      ackKey: ackRequired ? stableId("ack", [leaseKey, "ack"]) : null,
      nextAction: blocksRuntimeStart
        ? "repair-command-lease-before-runtime-start"
        : ackRequired
          ? "acknowledge-command-lease"
          : "release-runtime-command",
      replay: {
        replayCursor: result.state.restartReplay?.replayCursor ?? adapterProbe.resumeCursor ?? null,
        replayDecision: result.state.restartReplay?.replayDecision ?? "return-existing-status",
        idempotencyKey: result.state.idempotencyKey ?? result.state.restartReplay?.nextCommand?.idempotencyKey ?? null,
        duplicateHandling: result.state.restartReplay?.duplicateHandling ?? "return-existing-command-result",
        checkpointKey: result.state.checkpointKey ?? null,
        ledgerKey: result.state.ledgerKey ?? null,
      },
      statusProjection: {
        current: statusProjection.current ?? result.status,
        visible: clientState.visibleStatus ?? statusProjection.clientVisibleStatus ?? result.status,
        terminal: ["blocked", "skipped"].includes(result.status),
        restartSafe: statusProjection.restartSafe === true && result.state.restartReplay?.restartSafe !== false,
      },
      scope: {
        tenantId: claimRuntime.tenantId ?? null,
        workspaceId: claimRuntime.workspaceId ?? null,
        workflowId: claimRuntime.workflowId ?? null,
        requestId: claimRuntime.requestId ?? null,
      },
      retryPolicy: {
        retryable: result.retryPolicy.retryable === true && !blocksRuntimeStart,
        maxAttempts: result.retryPolicy.maxAttempts ?? 0,
        nextBackoffMs: result.retryPolicy.backoff?.[0]?.delayMs ?? 0,
      },
    };
  });
  const blockingLeases = leases.filter((lease) => lease.blocksRuntimeStart);
  const ackLeases = leases.filter((lease) => lease.ackRequired);
  const replayReadyLeases = leases.filter((lease) => (
    lease.replay.replayCursor
    && lease.replay.idempotencyKey
    && lease.statusProjection.restartSafe
  ));
  const leaseStatus = blockingLeases.length > 0
    ? "blocked"
    : ackLeases.length > 0
      ? "waiting-for-client-ack"
      : leases.length === replayReadyLeases.length
        ? "ready"
        : "review";
  const resumeToken = stableId("leaseresume", [
    ...leaseScope,
    leaseStatus,
    leases.map((lease) => `${lease.id}:${lease.status}:${lease.replay.replayDecision}`).join(","),
  ]);
  return {
    schemaVersion: "aios.mailchimp.client-command-lease-replay.v1",
    product: "mailchimp",
    planId: plan.id,
    status: leaseStatus,
    ready: leaseStatus === "ready" || leaseStatus === "review",
    resumeToken,
    primaryLeaseId: blockingLeases[0]?.id ?? ackLeases[0]?.id ?? leases[0]?.id ?? null,
    primaryAction: blockingLeases[0]?.nextAction
      ?? ackLeases[0]?.nextAction
      ?? providerPreview.lifecycleNextAction
      ?? "release-runtime-command",
    ack: {
      required: ackLeases.length > 0,
      requiredCount: ackLeases.length,
      keys: ackLeases.map((lease) => lease.ackKey).filter(Boolean),
      nextAckKey: ackLeases.find((lease) => lease.ackKey)?.ackKey ?? null,
    },
    counts: {
      total: leases.length,
      blocking: blockingLeases.length,
      ackRequired: ackLeases.length,
      replayReady: replayReadyLeases.length,
      restartUnsafe: leases.filter((lease) => lease.statusProjection.restartSafe !== true).length,
    },
    leases,
    clientPatch: {
      commandLeaseStatus: leaseStatus,
      commandLeaseResumeToken: resumeToken,
      commandLeaseId: blockingLeases[0]?.id ?? ackLeases[0]?.id ?? leases[0]?.id ?? null,
      commandAckRequired: ackLeases.length > 0,
      commandAckKey: ackLeases.find((lease) => lease.ackKey)?.ackKey ?? null,
      runtimeStartBlockedByCommandLease: blockingLeases.length > 0,
    },
    restartSemantics: {
      replaySafe: blockingLeases.length === 0,
      duplicateCommandPolicy: "dedupe-by-client-command-lease-key",
      onColdRestart: ackLeases.length > 0 ? "resume-client-command-ack" : "reload-command-lease-ledger",
      onDuplicateCommand: "return-existing-command-lease",
      externalWritesPerformed: false,
    },
  };
}

function buildCommandLeaseReplayExportSnapshot(clientCommandLeaseReplay) {
  const leases = Array.isArray(clientCommandLeaseReplay?.leases)
    ? clientCommandLeaseReplay.leases
    : [];
  const blockingLeases = leases.filter((lease) => lease.blocksRuntimeStart === true);
  const ackLeases = leases.filter((lease) => lease.ackRequired === true);
  const replayReadyLeases = leases.filter((lease) => (
    lease.replay?.replayCursor
    && lease.replay?.idempotencyKey
    && lease.statusProjection?.restartSafe === true
  ));
  const restartUnsafeLeases = leases.filter((lease) => lease.statusProjection?.restartSafe !== true);
  const retryableLeases = leases.filter((lease) => lease.retryPolicy?.retryable === true);
  const nextBackoffMs = retryableLeases
    .map((lease) => lease.retryPolicy?.nextBackoffMs)
    .filter((delayMs) => Number.isFinite(delayMs) && delayMs >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const blockingJobIds = [...new Set(blockingLeases.map((lease) => lease.jobId).filter(Boolean))].sort();
  const ackJobIds = [...new Set(ackLeases.map((lease) => lease.jobId).filter(Boolean))].sort();
  const readyJobIds = [...new Set(replayReadyLeases.map((lease) => lease.jobId).filter(Boolean))].sort();
  const actionRows = leases.map((lease) => ({
    leaseId: lease.id,
    jobId: lease.jobId,
    commandId: lease.commandId,
    status: lease.status,
    action: lease.nextAction,
    ackRequired: lease.ackRequired === true,
    blocksRuntimeStart: lease.blocksRuntimeStart === true,
    replayDecision: lease.replay?.replayDecision ?? "return-existing-status",
    restartSafe: lease.statusProjection?.restartSafe === true,
  }));
  const exportReady = clientCommandLeaseReplay?.ready === true
    && blockingLeases.length === 0
    && restartUnsafeLeases.length === 0;

  return {
    protocol: "aios.mailchimp.command-lease-replay-export.v1",
    status: clientCommandLeaseReplay?.status ?? "unknown",
    ready: clientCommandLeaseReplay?.ready === true,
    exportReady,
    resumeToken: clientCommandLeaseReplay?.resumeToken ?? null,
    primaryLeaseId: clientCommandLeaseReplay?.primaryLeaseId ?? null,
    primaryAction: clientCommandLeaseReplay?.primaryAction ?? "refresh-client-command-lease-replay",
    ack: {
      required: clientCommandLeaseReplay?.ack?.required === true,
      requiredCount: clientCommandLeaseReplay?.ack?.requiredCount ?? ackLeases.length,
      nextAckKey: clientCommandLeaseReplay?.ack?.nextAckKey ?? ackLeases.find((lease) => lease.ackKey)?.ackKey ?? null,
      keys: clientCommandLeaseReplay?.ack?.keys ?? ackLeases.map((lease) => lease.ackKey).filter(Boolean),
      jobIds: ackJobIds,
    },
    counters: {
      total: leases.length,
      blocking: blockingLeases.length,
      ackRequired: ackLeases.length,
      replayReady: replayReadyLeases.length,
      restartUnsafe: restartUnsafeLeases.length,
      retryable: retryableLeases.length,
    },
    jobIds: {
      blocking: blockingJobIds,
      ackRequired: ackJobIds,
      replayReady: readyJobIds,
    },
    replay: {
      safe: exportReady,
      resumeCursors: leases.map((lease) => lease.replay?.replayCursor).filter(Boolean),
      idempotencyKeys: leases.map((lease) => lease.replay?.idempotencyKey).filter(Boolean),
      decisions: leases.reduce((counts, lease) => {
        const decision = lease.replay?.replayDecision ?? "return-existing-status";
        counts[decision] = (counts[decision] ?? 0) + 1;
        return counts;
      }, {}),
      nextBackoffMs,
    },
    actionRows,
    nextAction: exportReady
      ? "publish-command-lease-replay-summary"
      : blockingLeases[0]?.nextAction
        ?? ackLeases[0]?.nextAction
        ?? restartUnsafeLeases[0]?.nextAction
        ?? clientCommandLeaseReplay?.primaryAction
        ?? "refresh-client-command-lease-replay",
  };
}

function buildClientCommandLeaseReplayHandoff(clientCommandLeaseReplay, commandLeaseReplayExport, plan) {
  const leases = Array.isArray(clientCommandLeaseReplay?.leases)
    ? clientCommandLeaseReplay.leases
    : [];
  const exportRows = Array.isArray(commandLeaseReplayExport?.actionRows)
    ? commandLeaseReplayExport.actionRows
    : [];
  const blockingRows = exportRows.filter((row) => row.blocksRuntimeStart === true || row.status === "blocked");
  const ackRows = exportRows.filter((row) => row.ackRequired === true);
  const replayRows = leases.map((lease) => ({
    leaseId: lease.id,
    jobId: lease.jobId,
    commandId: lease.commandId,
    status: lease.status,
    visibleStatus: lease.statusProjection?.visible ?? lease.status,
    nextAction: lease.nextAction,
    ackRequired: lease.ackRequired === true,
    ackKey: lease.ackKey ?? null,
    blocksRuntimeStart: lease.blocksRuntimeStart === true,
    replayCursor: lease.replay?.replayCursor ?? null,
    replayDecision: lease.replay?.replayDecision ?? "return-existing-status",
    idempotencyKey: lease.replay?.idempotencyKey ?? null,
    checkpointKey: lease.replay?.checkpointKey ?? null,
    ledgerKey: lease.replay?.ledgerKey ?? null,
    restartSafe: lease.statusProjection?.restartSafe === true
      && Boolean(lease.replay?.replayCursor)
      && (Boolean(lease.replay?.idempotencyKey) || lease.ackRequired === true),
  }));
  const unsafeRows = replayRows.filter((row) => row.restartSafe !== true);
  const blocked = blockingRows.length > 0;
  const waitingForAck = blocked === false && ackRows.length > 0;
  const replayReady = blocked === false
    && unsafeRows.length === 0
    && commandLeaseReplayExport?.exportReady === true;
  const status = blocked
    ? "blocked"
    : waitingForAck
      ? "waiting-for-client-ack"
      : replayReady
        ? "ready"
        : "review";
  const nextAction = blocked
    ? blockingRows[0]?.action || "repair-command-lease-before-runtime-start"
    : waitingForAck
      ? ackRows[0]?.action || "acknowledge-command-lease"
      : replayReady
        ? "resume-command-lease-replay"
        : commandLeaseReplayExport?.nextAction || "refresh-client-command-lease-replay";
  const resumeToken = commandLeaseReplayExport?.resumeToken
    || clientCommandLeaseReplay?.resumeToken
    || stableId("leasehandoffresume", [plan.id, status, replayRows.map((row) => row.leaseId).join(",")]);
  const routeId = stableId("leasehandoff", [
    plan.id,
    status,
    resumeToken,
    commandLeaseReplayExport?.primaryLeaseId,
  ]);

  return {
    schemaVersion: "aios.mailchimp.client-command-lease-replay-handoff.v1",
    product: "mailchimp",
    planId: plan.id,
    routeId,
    status,
    readyForClient: status !== "blocked",
    readyForRuntime: replayReady,
    resumeToken,
    primaryLeaseId: commandLeaseReplayExport?.primaryLeaseId
      ?? clientCommandLeaseReplay?.primaryLeaseId
      ?? replayRows[0]?.leaseId
      ?? null,
    nextAction,
    ack: {
      required: waitingForAck || commandLeaseReplayExport?.ack?.required === true,
      keys: commandLeaseReplayExport?.ack?.keys ?? ackRows.map((row) => row.ackKey).filter(Boolean),
      nextAckKey: commandLeaseReplayExport?.ack?.nextAckKey ?? ackRows.find((row) => row.ackKey)?.ackKey ?? null,
      requiredCount: commandLeaseReplayExport?.ack?.requiredCount ?? ackRows.length,
    },
    routePayload: {
      routeId,
      resumeToken,
      primaryLeaseId: commandLeaseReplayExport?.primaryLeaseId
        ?? clientCommandLeaseReplay?.primaryLeaseId
        ?? null,
      idempotencyKey: stableId("idem", [routeId, resumeToken, nextAction]),
      externalWritesPerformed: false,
    },
    validationSummary: {
      total: replayRows.length,
      blocked: blockingRows.length,
      waitingForAck: ackRows.length,
      restartUnsafe: unsafeRows.length,
      ready: replayRows.filter((row) => row.restartSafe).length,
      blockedLeaseIds: blockingRows.map((row) => row.leaseId).filter(Boolean),
      ackLeaseIds: ackRows.map((row) => row.leaseId).filter(Boolean),
      unsafeLeaseIds: unsafeRows.map((row) => row.leaseId).filter(Boolean),
    },
    rows: replayRows,
    clientPatch: {
      commandLeaseReplayHandoffStatus: status,
      commandLeaseReplayHandoffRouteId: routeId,
      commandLeaseReplayHandoffReady: replayReady,
      commandLeaseReplayHandoffNextAction: nextAction,
      commandLeaseReplayResumeToken: resumeToken,
      commandLeaseReplayAckRequired: waitingForAck || commandLeaseReplayExport?.ack?.required === true,
      commandLeaseReplayBlockedLeaseIds: blockingRows.map((row) => row.leaseId).filter(Boolean),
    },
    restartSemantics: {
      replaySafe: replayReady,
      duplicateCommandPolicy: "dedupe-by-command-lease-replay-handoff-route",
      resumeToken,
      resumeFromLeaseId: commandLeaseReplayExport?.primaryLeaseId
        ?? clientCommandLeaseReplay?.primaryLeaseId
        ?? null,
      externalWritesPerformed: false,
    },
  };
}

function buildRestartRecoveryExportSnapshot(plan, jobResults) {
  const matrix = plan.restartRecoveryMatrix ?? plan.recovery?.restartRecoveryMatrix ?? {};
  const ledger = matrix.exportLedger ?? {};
  const ledgerRows = Array.isArray(ledger.rows) && ledger.rows.length > 0
    ? ledger.rows
    : (matrix.rows ?? []).map((row) => ({
      ledgerRowId: stableId("recoveryledgerrow", [
        row.restartKey,
        row.jobId,
        row.recoveryState,
        row.nextAction,
      ]),
      jobId: row.jobId,
      operation: row.operation,
      recoveryState: row.recoveryState,
      currentStatus: row.currentStatus,
      visibleStatus: row.visibleStatus,
      restartSafe: row.restartSafe === true,
      checkpointKey: row.checkpointKey,
      commandLedgerKey: row.commandLedgerKey,
      operationStatusLedgerId: row.operationStatusLedgerId,
      replayManifestId: row.replayManifestId,
      replayCursor: row.replayCursor,
      adapterStatusResumeCursor: row.adapterStatusResumeCursor,
      idempotencyKey: row.idempotencyKey,
      nextCommandId: row.nextCommand?.commandId ?? null,
      nextAction: row.nextAction,
      exportState: row.recoveryState === "blocked"
        ? "blocked"
        : row.recoveryState === "waiting"
          ? "waiting"
          : row.restartSafe === true
            ? "exportable"
            : "review",
      blockedReasons: row.blockedReasons ?? [],
      waitingReasons: row.waitingReasons ?? [],
    }));
  const rowByJobId = new Map(ledgerRows.map((row) => [row.jobId, row]));
  const jobRows = jobResults.map((result, index) => {
    const ledgerRow = rowByJobId.get(result.jobId);
    const fallbackReplay = result.state?.restartReplay ?? {};
    const fallbackProbe = result.adapterStatusProbe ?? {};
    const exportState = ledgerRow?.exportState
      ?? (result.status === "blocked" || result.status === "skipped"
        ? "blocked"
        : result.status === "degraded"
          ? "waiting"
          : "exportable");
    const blockedReasons = ledgerRow?.blockedReasons
      ?? (result.status === "blocked" ? [result.reason ?? "dry-run-blocked"] : []);
    const waitingReasons = ledgerRow?.waitingReasons
      ?? (result.status === "degraded" ? [result.reason ?? "dry-run-degraded"] : []);
    return {
      sequence: index + 1,
      ledgerRowId: ledgerRow?.ledgerRowId ?? stableId("recoveryledgerrow", [
        plan.id,
        result.jobId,
        exportState,
        fallbackReplay.replayCursor,
      ]),
      jobId: result.jobId,
      operation: result.operation,
      dryRunStatus: result.status,
      recoveryState: ledgerRow?.recoveryState ?? result.state?.statusProjection?.current ?? "unknown",
      exportState,
      restartSafe: ledgerRow?.restartSafe === true || result.state?.restartReplay?.restartSafe === true,
      visibleStatus: ledgerRow?.visibleStatus
        ?? result.state?.statusProjection?.clientVisibleStatus
        ?? result.status,
      checkpointKey: ledgerRow?.checkpointKey ?? result.state?.checkpointKey ?? null,
      commandLedgerKey: ledgerRow?.commandLedgerKey ?? result.state?.ledgerKey ?? null,
      operationStatusLedgerId: ledgerRow?.operationStatusLedgerId
        ?? result.state?.statusProjection?.operationStatusLedgerId
        ?? null,
      replayManifestId: ledgerRow?.replayManifestId ?? fallbackReplay.sourceManifestId ?? null,
      replayCursor: ledgerRow?.replayCursor ?? fallbackReplay.replayCursor ?? null,
      adapterStatusResumeCursor: ledgerRow?.adapterStatusResumeCursor ?? fallbackProbe.resumeCursor ?? null,
      idempotencyKey: ledgerRow?.idempotencyKey ?? result.state?.idempotencyKey ?? null,
      nextCommandId: ledgerRow?.nextCommandId ?? fallbackReplay.nextCommand?.commandId ?? null,
      nextAction: ledgerRow?.nextAction
        ?? result.recoveryHandoff?.nextAction
        ?? fallbackReplay.replayDecision
        ?? "review-restart-recovery",
      blockedReasons,
      waitingReasons,
      exportable: exportState === "exportable" && blockedReasons.length === 0,
    };
  });
  const blockedRows = jobRows.filter((row) => row.exportState === "blocked" || row.blockedReasons.length > 0);
  const waitingRows = jobRows.filter((row) => row.exportState === "waiting" || row.waitingReasons.length > 0);
  const reviewRows = jobRows.filter((row) => row.exportState === "review");
  const exportableRows = jobRows.filter((row) => row.exportable);
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : reviewRows.length > 0
        ? "review"
        : "ready";
  const commandIds = [
    ...(ledger.commands ?? []).map((command) => command.id),
    ...(matrix.commands ?? []).map((command) => command.id),
  ].filter(Boolean);
  const resumeCursors = [...new Set(jobRows
    .map((row) => row.adapterStatusResumeCursor)
    .filter(Boolean))].sort();
  return {
    protocol: "aios.mailchimp.dry-run-restart-recovery-export.v1",
    id: ledger.id ?? stableId("dryrecoveryexport", [
      plan.id,
      matrix.id,
      status,
      jobRows.map((row) => `${row.jobId}:${row.exportState}:${row.nextAction}`).join(","),
    ]),
    planId: plan.id,
    product: "mailchimp",
    sourceMatrixId: matrix.id ?? null,
    sourceLedgerId: ledger.id ?? null,
    status,
    exportReady: status === "ready" && jobRows.every((row) => row.exportable && row.restartSafe),
    restartSafe: jobRows.every((row) => row.restartSafe) && matrix.restartSafe !== false,
    replayCursor: ledger.replayCursor ?? matrix.replayCursor ?? plan.restartProjection?.replayCursor ?? null,
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? ledger.nextAction
      ?? "publish-restart-recovery-export",
    rows: jobRows,
    counters: {
      rows: jobRows.length,
      exportable: exportableRows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      review: reviewRows.length,
      restartSafe: jobRows.filter((row) => row.restartSafe).length,
      resumeCursors: resumeCursors.length,
      commandIds: commandIds.length,
      blockedReasons: jobRows.reduce((count, row) => count + row.blockedReasons.length, 0),
      waitingReasons: jobRows.reduce((count, row) => count + row.waitingReasons.length, 0),
    },
    blockedJobIds: blockedRows.map((row) => row.jobId),
    waitingJobIds: waitingRows.map((row) => row.jobId),
    reviewJobIds: reviewRows.map((row) => row.jobId),
    resumeCursors,
    commandIds,
    exportSummary: {
      format: "aios.mailchimp.dry-run-restart-recovery-summary.v1",
      status,
      exportReady: status === "ready" && jobRows.every((row) => row.exportable && row.restartSafe),
      nextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "publish-restart-recovery-export",
      blockedJobIds: blockedRows.map((row) => row.jobId),
      waitingJobIds: waitingRows.map((row) => row.jobId),
      resumeCursors,
      commandIds,
      externalWritesPerformed: false,
    },
    clientPatch: {
      restartRecoveryExportStatus: status,
      restartRecoveryExportReady: status === "ready" && jobRows.every((row) => row.exportable && row.restartSafe),
      restartRecoveryExportNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "publish-restart-recovery-export",
      restartRecoveryExportBlockedJobs: blockedRows.map((row) => row.jobId),
      restartRecoveryExportWaitingJobs: waitingRows.map((row) => row.jobId),
      restartRecoveryExportResumeCursors: resumeCursors,
    },
    restartSemantics: {
      replaySafe: status !== "blocked" && jobRows.every((row) => row.restartSafe),
      onColdRestart: status === "ready" ? "load-dry-run-restart-recovery-export" : "reload-restart-recovery-matrix",
      onDuplicateCommand: "return-existing-dry-run-restart-recovery-export",
      externalWritesPerformed: false,
    },
  };
}

function buildAnalytics(plan, jobResults, tenantBoundaryMatrix = null) {
  const allErrors = jobResults.flatMap((result) => result.actionableErrors);
  const commandIds = jobResults.flatMap((result) => result.state.commandIds ?? []);
  const timelineEvents = jobResults.flatMap((result) => result.timeline ?? []);
  const adapterStatusProbes = jobResults.map((result) => result.adapterStatusProbe).filter(Boolean);
  const adapterStatusOutcomes = adapterStatusProbes
    .map((probe) => probe.dryRunOutcome)
    .filter(Boolean);
  const restartReplays = jobResults
    .map((result) => result.state.restartReplay)
    .filter(Boolean);
  const commandLeaseReplays = jobResults
    .map((result) => result.state.commandLeaseReplay)
    .filter(Boolean);
  const acceptanceCommands = jobResults
    .map((result) => result.state.acceptanceCommand)
    .filter(Boolean);
  const clientOperationStates = jobResults
    .map((result) => result.state.clientOperationState)
    .filter(Boolean);
  const statuses = jobResults.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {});
  const healthChecks = jobResults.flatMap((result) => result.health.checks);
  const providerHealth = plan.providerService?.operationalHealth ?? {};
  const restartRecoveryMatrix = plan.restartRecoveryMatrix ?? plan.recovery?.restartRecoveryMatrix ?? {};
  const restartRecoveryExport = buildRestartRecoveryExportSnapshot(plan, jobResults);
  const tenantPermissionChecks = healthChecks.filter((check) => check.name === "tenant-permission");
  const leaseReplaySnapshot = buildCommandLeaseReplayExportSnapshot({
    leases: commandLeaseReplays,
    status: commandLeaseReplays.some((lease) => lease.blocksRuntimeStart)
      ? "blocked"
      : commandLeaseReplays.some((lease) => lease.ackRequired)
        ? "waiting-for-client-ack"
        : "ready",
    ready: commandLeaseReplays.every((lease) => lease.blocksRuntimeStart !== true),
    resumeToken: plan.restartProjection?.replayCursor,
    ack: {
      required: commandLeaseReplays.some((lease) => lease.ackRequired),
      requiredCount: commandLeaseReplays.filter((lease) => lease.ackRequired).length,
      keys: commandLeaseReplays.map((lease) => lease.ackKey).filter(Boolean),
    },
  });
  return {
    counters: {
      jobsTotal: jobResults.length,
      jobsWouldRun: statuses["would-run"] ?? 0,
      jobsBlocked: statuses.blocked ?? 0,
      jobsSkipped: statuses.skipped ?? 0,
      jobsDegraded: statuses.degraded ?? 0,
      commandsPlanned: commandIds.length,
      uniqueCommands: new Set(commandIds).size,
      retryableJobs: jobResults.filter((result) => result.retryPolicy.retryable).length,
      rollbackPrepared: jobResults.filter((result) => result.rollbackPrepared !== "no-op").length,
      actionableErrors: allErrors.length,
      timelineEvents: timelineEvents.length,
      adapterStatusProbes: adapterStatusProbes.length,
      adapterStatusReady: adapterStatusProbes.filter((probe) => probe.state === "would-probe").length,
      adapterStatusPaused: adapterStatusProbes.filter((probe) => probe.state === "paused").length,
      adapterStatusBlocked: adapterStatusProbes.filter((probe) => probe.state === "blocked").length,
      adapterStatusFixtureSuccess: adapterStatusOutcomes.filter((outcome) => outcome.classification === "success").length,
      adapterStatusFixturePending: adapterStatusOutcomes.filter((outcome) => outcome.classification === "pending").length,
      adapterStatusFixtureFailure: adapterStatusOutcomes.filter((outcome) => outcome.classification === "failure").length,
      adapterStatusFixtureNonDeterministic: adapterStatusOutcomes.filter((outcome) => outcome.deterministic === false).length,
      restartReplayManifests: restartReplays.length,
      restartReplayReady: restartReplays.filter((replay) => replay.replayDecision === "replay-idempotent-command").length,
      restartReplayHeld: restartReplays.filter((replay) => replay.replayDecision.startsWith("hold")).length,
      restartReplayPaused: restartReplays.filter((replay) => replay.replayDecision === "persist-and-wait").length,
      clientOperationStates: clientOperationStates.length,
      clientOperationBlocked: clientOperationStates.filter((state) => state.workflowState === "blocked").length,
      clientOperationApproval: clientOperationStates.filter((state) => state.workflowState === "waiting-for-approval").length,
      clientCommandLeaseReplays: commandLeaseReplays.length,
      clientCommandLeaseReplayBlocked: commandLeaseReplays.filter((lease) => lease.blocksRuntimeStart).length,
      clientCommandLeaseAckRequired: commandLeaseReplays.filter((lease) => lease.ackRequired).length,
      clientCommandLeaseReplayReady: commandLeaseReplays.filter((lease) => lease.statusProjection?.restartSafe).length,
      clientCommandLeaseRestartUnsafe: leaseReplaySnapshot.counters.restartUnsafe,
      clientCommandLeaseReplayExportReady: leaseReplaySnapshot.exportReady ? 1 : 0,
      clientCommandLeaseRetryable: leaseReplaySnapshot.counters.retryable,
      acceptanceCommands: acceptanceCommands.length,
      acceptanceCommandsBlocked: acceptanceCommands.filter((command) => command.state === "blocked").length,
      acceptanceCommandsWaiting: acceptanceCommands.filter((command) => command.state === "waiting").length,
      acceptanceCommandsReleasable: acceptanceCommands.filter((command) => command.state === "releasable").length,
      acceptanceCommandsAckRequired: acceptanceCommands.filter((command) => command.ackRequired).length,
      tenantPermissionChecks: tenantPermissionChecks.length,
      tenantPermissionFailures: tenantPermissionChecks.filter((check) => check.status === "fail").length,
      tenantPermissionApprovals: tenantPermissionChecks.filter((check) => check.status === "degraded").length,
      tenantBoundaryRows: tenantBoundaryMatrix?.counters?.rows ?? 0,
      tenantBoundaryReady: tenantBoundaryMatrix?.counters?.ready ?? 0,
      tenantBoundaryBlocked: tenantBoundaryMatrix?.counters?.blocked ?? 0,
      tenantBoundaryApprovalRequired: tenantBoundaryMatrix?.counters?.approvalRequired ?? 0,
      tenantBoundaryMissingScopes: tenantBoundaryMatrix?.counters?.missingScopes ?? 0,
      tenantBoundaryAuditRefs: tenantBoundaryMatrix?.counters?.auditRefs ?? 0,
      tenantBoundaryResumeCursors: tenantBoundaryMatrix?.counters?.resumeCursors ?? 0,
      providerReadyJobs: plan.providerService?.capabilityNegotiation?.readyJobIds?.length ?? 0,
      providerApprovalJobs: plan.providerService?.capabilityNegotiation?.approvalJobIds?.length ?? 0,
      providerDeniedJobs: plan.providerService?.capabilityNegotiation?.deniedJobIds?.length ?? 0,
      providerHealthChecks: providerHealth.checks?.length ?? 0,
      providerHealthErrors: providerHealth.actionableErrors?.filter((error) => error.severity === "error").length ?? 0,
      providerHealthWarnings: providerHealth.actionableErrors?.filter((error) => error.severity === "warning").length ?? 0,
      providerRetryable: providerHealth.retryPolicy?.retryable ? 1 : 0,
      providerDegradedMode: providerHealth.degradedMode?.enabled ? 1 : 0,
      restartRecoveryRows: restartRecoveryMatrix.counters?.rows ?? 0,
      restartRecoveryBlocked: restartRecoveryMatrix.counters?.blocked ?? 0,
      restartRecoveryWaiting: restartRecoveryMatrix.counters?.waiting ?? 0,
      restartRecoveryReplayable: restartRecoveryMatrix.counters?.replayable ?? 0,
      restartRecoveryTerminal: restartRecoveryMatrix.counters?.terminal ?? 0,
      restartRecoveryMissingStatusCursors: restartRecoveryMatrix.counters?.missingStatusCursors ?? 0,
      restartRecoveryMissingCommandLedgers: restartRecoveryMatrix.counters?.missingCommandLedgers ?? 0,
      restartRecoveryExportSafe: restartRecoveryMatrix.restartSafe === true ? 1 : 0,
      restartRecoveryExportRows: restartRecoveryExport.counters.rows,
      restartRecoveryExportBlocked: restartRecoveryExport.counters.blocked,
      restartRecoveryExportWaiting: restartRecoveryExport.counters.waiting,
      restartRecoveryExportReady: restartRecoveryExport.exportReady ? 1 : 0,
      claimPendingFacts: plan.providerService?.claimReporting?.pendingFacts?.length ?? 0,
      lifecycleCommandIds: plan.providerService?.lifecycle?.commandIds?.length ?? 0,
      packagePreviewStatusKnown: plan.package?.previewContract?.status ? 1 : 0,
      packagePreviewRequiredInputs: plan.package?.previewContract?.acceptance?.requiredInputs
        ?.filter((input) => input.required).length ?? 0,
    },
    bySeverity: allErrors.reduce((counts, error) => {
      counts[error.severity] = (counts[error.severity] ?? 0) + 1;
      return counts;
    }, {}),
    byHealthCheck: healthChecks.reduce((counts, check) => {
      const key = `${check.name}:${check.status}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    restart: {
      restartSafeJobs: jobResults.filter((result) => result.state.statusProjection?.restartSafe).length,
      replayCursor: plan.restartProjection?.replayCursor,
      restartStatus: plan.restartProjection?.restartStatus,
      recoveryAction: plan.restartProjection?.recoveryAction,
      adapterStatusResumeCursors: adapterStatusProbes
        .map((probe) => probe.resumeCursor)
        .filter(Boolean),
      adapterStatusFixtureIds: adapterStatusOutcomes
        .map((outcome) => outcome.fixtureId)
        .filter(Boolean),
      adapterStatusSimulatedStatuses: adapterStatusOutcomes.map((outcome) => ({
        fixtureId: outcome.fixtureId,
        status: outcome.status,
        classification: outcome.classification,
        terminal: outcome.terminal,
        recoveryAction: outcome.recoveryAction,
      })),
      replayManifestIds: restartReplays
        .map((replay) => replay.sourceManifestId)
        .filter(Boolean),
      replayCursors: restartReplays
        .map((replay) => replay.replayCursor)
        .filter(Boolean),
      replayDecisions: restartReplays.reduce((counts, replay) => {
        counts[replay.replayDecision] = (counts[replay.replayDecision] ?? 0) + 1;
        return counts;
      }, {}),
      clientOperationStateIds: clientOperationStates.map((state) => state.id),
      clientCommandLeaseIds: commandLeaseReplays.map((lease) => lease.id),
      acceptanceCommandIds: acceptanceCommands.map((command) => command.commandId),
      acceptanceCommandResumeCursors: acceptanceCommands.map((command) => command.resumeCursor).filter(Boolean),
      recoveryMatrix: restartRecoveryMatrix.id ? {
        id: restartRecoveryMatrix.id,
        state: restartRecoveryMatrix.state,
        restartSafe: restartRecoveryMatrix.restartSafe === true,
        nextAction: restartRecoveryMatrix.nextAction,
        replayCursor: restartRecoveryMatrix.replayCursor,
        blockedJobIds: restartRecoveryMatrix.clientPatch?.blockedJobIds ?? [],
        waitingJobIds: restartRecoveryMatrix.clientPatch?.waitingJobIds ?? [],
        replayableJobIds: restartRecoveryMatrix.clientPatch?.replayableJobIds ?? [],
        resumeCursors: restartRecoveryMatrix.clientPatch?.resumeCursors ?? [],
        counters: restartRecoveryMatrix.counters ?? {},
        exportLedgerId: restartRecoveryMatrix.exportLedger?.id ?? null,
        exportReady: restartRecoveryExport.exportReady,
        exportNextAction: restartRecoveryExport.nextAction,
      } : null,
      export: restartRecoveryExport,
    },
    commandLeaseReplay: leaseReplaySnapshot,
    tenantBoundary: tenantBoundaryMatrix ? {
      id: tenantBoundaryMatrix.id,
      status: tenantBoundaryMatrix.status,
      safeBoundary: tenantBoundaryMatrix.safeBoundary,
      isolationKey: tenantBoundaryMatrix.isolationKey,
      policyVersion: tenantBoundaryMatrix.policyVersion,
      exportReady: tenantBoundaryMatrix.exportReady,
      nextAction: tenantBoundaryMatrix.audit.nextAction,
      blockedJobIds: tenantBoundaryMatrix.clientPatch.tenantBoundaryBlockedJobs,
      approvalJobIds: tenantBoundaryMatrix.clientPatch.tenantBoundaryApprovalJobs,
      missingScopes: tenantBoundaryMatrix.clientPatch.tenantBoundaryMissingScopes,
      auditRefs: tenantBoundaryMatrix.audit.auditRefs,
      resumeCursors: tenantBoundaryMatrix.audit.resumeCursors,
    } : null,
    providerService: {
      state: plan.providerService?.externalHandoff?.state ?? "unknown",
      handoffId: plan.providerService?.externalHandoff?.handoffId ?? null,
      blockedReason: plan.providerService?.externalHandoff?.blockedReason ?? null,
      healthId: providerHealth.id ?? null,
      healthStatus: providerHealth.status ?? "unknown",
      healthNextAction: providerHealth.nextAction ?? null,
      retryable: providerHealth.retryPolicy?.retryable === true,
      degradedModeEnabled: providerHealth.degradedMode?.enabled === true,
      actionableErrorCodes: providerHealth.actionableErrors?.map((error) => error.code) ?? [],
      lifecycleGateId: plan.providerService?.externalHandoff?.lifecycleGateId ?? null,
      lifecycleGateState: plan.providerService?.externalHandoff?.lifecycleGateState ?? "unknown",
      lifecycleGateNextAction: plan.providerService?.externalHandoff?.lifecycleGateNextAction ?? null,
      capabilityDecision: plan.providerService?.capabilityNegotiation?.decision ?? "unknown",
      requestedCapabilities: plan.providerService?.capabilityNegotiation?.requestedCapabilities ?? [],
      missingWorkspaceCapabilities: plan.providerService?.capabilityNegotiation?.missingWorkspaceCapabilities ?? [],
      adapterStatusResumeCursors: plan.providerService?.externalHandoff?.adapterStatusResumeCursors ?? [],
    },
  };
}

function buildHistorySnapshots(plan, jobResults, status, tenantBoundaryMatrix = null) {
  const restartRecoveryMatrix = plan.restartRecoveryMatrix ?? plan.recovery?.restartRecoveryMatrix ?? {};
  const leaseSnapshot = buildCommandLeaseReplayExportSnapshot({
    leases: jobResults
      .map((result) => result.state.commandLeaseReplay)
      .filter(Boolean),
    status,
    ready: status !== "blocked",
    resumeToken: plan.restartProjection?.replayCursor,
  });
  const started = {
    id: stableId("hist", [plan.id, "dry-run-started"]),
    sequence: 1,
    type: "dry-run-started",
    status: "planned",
    planStatus: plan.status,
    replayCursor: plan.restartProjection?.replayCursor,
    providerServiceState: plan.providerService?.externalHandoff?.state ?? "unknown",
    providerHealthStatus: plan.providerService?.operationalHealth?.status ?? "unknown",
    providerHealthNextAction: plan.providerService?.operationalHealth?.nextAction ?? null,
    tenantBoundaryStatus: plan.permissionBoundary?.status ?? plan.providerService?.permissionBoundary?.status ?? "unknown",
    tenantBoundaryMatrixStatus: tenantBoundaryMatrix?.status ?? "unknown",
    tenantBoundaryMatrixId: tenantBoundaryMatrix?.id ?? null,
    tenantBoundaryBlockedJobs: tenantBoundaryMatrix?.clientPatch?.tenantBoundaryBlockedJobs ?? [],
    tenantBoundaryApprovalJobs: tenantBoundaryMatrix?.clientPatch?.tenantBoundaryApprovalJobs ?? [],
    restartRecoveryMatrixId: restartRecoveryMatrix.id ?? null,
    restartRecoveryState: restartRecoveryMatrix.state ?? "unknown",
    restartRecoverySafe: restartRecoveryMatrix.restartSafe === true,
    restartRecoveryNextAction: restartRecoveryMatrix.nextAction ?? null,
    restartRecoveryBlockedJobs: restartRecoveryMatrix.clientPatch?.blockedJobIds ?? [],
    commandLeaseReplayStatus: leaseSnapshot.status,
    commandLeaseReplayReady: leaseSnapshot.ready,
  };
  const recoveryRowByJobId = new Map((restartRecoveryMatrix.rows ?? []).map((row) => [row.jobId, row]));
  const perJob = jobResults.map((result, index) => ({
    id: stableId("hist", [plan.id, result.jobId, result.status, index]),
    sequence: index + 2,
    type: "job-simulated",
    jobId: result.jobId,
    status: result.status,
    reason: result.reason,
    checkpointKey: result.state.checkpointKey,
    ledgerKey: result.state.ledgerKey,
    adapterStatusHandoffId: result.adapterStatusProbe?.handoffId ?? null,
    adapterStatusState: result.adapterStatusProbe?.state ?? null,
    adapterStatusResumeCursor: result.adapterStatusProbe?.resumeCursor ?? null,
    adapterStatusFixtureId: result.adapterStatusProbe?.dryRunOutcome?.fixtureId ?? null,
    adapterStatusSimulatedStatus: result.adapterStatusProbe?.dryRunOutcome?.status ?? null,
    adapterStatusClassification: result.adapterStatusProbe?.dryRunOutcome?.classification ?? null,
    commandCount: result.state.commandIds?.length ?? 0,
    replayManifestId: result.state.restartReplay?.sourceManifestId ?? null,
    replayDecision: result.state.restartReplay?.replayDecision ?? null,
    replayCursor: result.state.restartReplay?.replayCursor ?? null,
    restartRecoveryState: recoveryRowByJobId.get(result.jobId)?.recoveryState ?? "unknown",
    restartRecoveryNextAction: recoveryRowByJobId.get(result.jobId)?.nextAction ?? null,
    restartRecoverySafe: recoveryRowByJobId.get(result.jobId)?.restartSafe === true,
    restartRecoveryBlockedReasons: recoveryRowByJobId.get(result.jobId)?.blockedReasons ?? [],
    commandLeaseId: result.state.commandLeaseReplay?.id ?? null,
    commandLeaseStatus: result.state.commandLeaseReplay?.status ?? null,
    commandLeaseAckRequired: result.state.commandLeaseReplay?.ackRequired === true,
    commandLeaseBlocksRuntimeStart: result.state.commandLeaseReplay?.blocksRuntimeStart === true,
    acceptanceCommandId: result.state.acceptanceCommand?.commandId ?? null,
    acceptanceCommandState: result.state.acceptanceCommand?.state ?? null,
    acceptanceCommandNextAction: result.state.acceptanceCommand?.nextAction ?? null,
    acceptanceCommandResumeCursor: result.state.acceptanceCommand?.resumeCursor ?? null,
    timelineEvents: result.timeline?.length ?? 0,
    tenantPermissionStatus: result.health.checks.find((check) => check.name === "tenant-permission")?.status ?? "unknown",
    tenantBoundaryState: tenantBoundaryMatrix?.rows?.find((row) => row.jobId === result.jobId)?.boundaryState ?? "unknown",
    tenantBoundaryAuditRef: tenantBoundaryMatrix?.rows?.find((row) => row.jobId === result.jobId)?.auditRef ?? null,
  }));
  return [
    started,
    ...perJob,
    {
      id: stableId("hist", [plan.id, "dry-run-finished", status]),
      sequence: perJob.length + 2,
      type: "dry-run-finished",
      status,
      accepted: status === "admitted",
      restartStatus: plan.restartProjection?.restartStatus,
      providerServiceState: plan.providerService?.externalHandoff?.state ?? "unknown",
      providerHealthStatus: plan.providerService?.operationalHealth?.status ?? "unknown",
      providerHealthNextAction: plan.providerService?.operationalHealth?.nextAction ?? null,
      restartRecoveryMatrixId: restartRecoveryMatrix.id ?? null,
      restartRecoveryState: restartRecoveryMatrix.state ?? "unknown",
      restartRecoverySafe: restartRecoveryMatrix.restartSafe === true,
      restartRecoveryNextAction: restartRecoveryMatrix.nextAction ?? null,
      restartRecoveryBlockedJobs: restartRecoveryMatrix.clientPatch?.blockedJobIds ?? [],
      tenantBoundaryMatrixStatus: tenantBoundaryMatrix?.status ?? "unknown",
      tenantBoundaryMatrixExportReady: tenantBoundaryMatrix?.exportReady === true,
      tenantBoundaryNextAction: tenantBoundaryMatrix?.audit?.nextAction ?? null,
      commandLeaseReplayStatus: leaseSnapshot.status,
      commandLeaseReplayExportReady: leaseSnapshot.exportReady,
      commandLeaseReplayNextAction: leaseSnapshot.nextAction,
      acceptanceCommandsBlocked: jobResults
        .map((result) => result.state.acceptanceCommand)
        .filter((command) => command?.state === "blocked")
        .length,
      acceptanceCommandsWaiting: jobResults
        .map((result) => result.state.acceptanceCommand)
        .filter((command) => command?.state === "waiting")
        .length,
      acceptanceCommandsReleasable: jobResults
        .map((result) => result.state.acceptanceCommand)
        .filter((command) => command?.state === "releasable")
        .length,
      tenantPermissionFailures: jobResults
        .flatMap((result) => result.health.checks)
        .filter((check) => check.name === "tenant-permission" && check.status === "fail")
        .length,
    },
  ];
}

function countRowsBy(rows, keySelector) {
  return rows.reduce((counts, row) => {
    const key = keySelector(row) || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function buildReportingState(reportCore, analytics, history, operationalHealthExport, dryRunAnalyticsExport) {
  const jobTimelineRows = (reportCore.jobs ?? []).flatMap((result) => (
    (result.timeline ?? []).map((entry) => ({
      ...entry,
      jobId: result.jobId,
      status: entry.status ?? result.status,
      event: entry.event ?? "job-timeline-event",
      nextAction: entry.nextAction ?? result.recoveryHandoff?.nextAction ?? result.reason,
    }))
  ));
  const exportTimelineRows = [
    ...(operationalHealthExport.timeline ?? []).map((entry) => ({
      ...entry,
      source: "operational-health-export",
    })),
    ...(dryRunAnalyticsExport.timeline ?? []).map((entry) => ({
      ...entry,
      source: "dry-run-analytics-export",
    })),
  ];
  const blockedHistory = history.filter((snapshot) => snapshot.status === "blocked");
  const waitingHistory = history.filter((snapshot) => (
    snapshot.status === "waiting"
    || snapshot.status === "degraded"
    || snapshot.status === "review"
  ));
  const failedTimeline = jobTimelineRows.filter((entry) => (
    entry.status === "blocked"
    || entry.status === "fail"
    || entry.status === "skipped"
  ));
  const waitingTimeline = jobTimelineRows.filter((entry) => (
    entry.status === "degraded"
    || entry.status === "waiting"
    || entry.status === "waiting-for-approval"
    || entry.status === "needs-approval"
  ));
  const exportBlocked = [
    ...(operationalHealthExport.exportSummary?.blockerCodes ?? []),
    ...(dryRunAnalyticsExport.exportSummary?.blockerCodes ?? []),
  ];
  const exportWarnings = [
    ...(operationalHealthExport.exportSummary?.warningCodes ?? []),
    ...(dryRunAnalyticsExport.exportSummary?.warningCodes ?? []),
  ];
  const status = exportBlocked.length > 0 || blockedHistory.length > 0 || failedTimeline.length > 0
    ? "blocked"
    : exportWarnings.length > 0 || waitingHistory.length > 0 || waitingTimeline.length > 0
      ? "waiting"
      : dryRunAnalyticsExport.exportReady === true && operationalHealthExport.exportReady === true
        ? "ready"
        : "review";
  const nextAction = status === "ready"
    ? "publish-dry-run-reporting-state"
    : exportBlocked.length > 0
      ? dryRunAnalyticsExport.nextAction
        ?? operationalHealthExport.nextAction
        ?? "repair-dry-run-reporting-state"
      : exportWarnings.length > 0
        ? dryRunAnalyticsExport.nextAction
          ?? operationalHealthExport.nextAction
          ?? "review-dry-run-reporting-state"
        : "review-dry-run-reporting-state";
  const latestHistory = history.at(-1) ?? null;
  const digest = {
    status,
    nextAction,
    reportId: reportCore.id,
    planId: reportCore.planId,
    latestSnapshotId: latestHistory?.id ?? null,
    operationalHealthStatus: operationalHealthExport.status,
    dryRunAnalyticsStatus: dryRunAnalyticsExport.status,
    tenantBoundaryStatus: analytics.tenantBoundary?.status ?? "unknown",
    restartRecoveryStatus: analytics.restart?.export?.status
      ?? analytics.restart?.recoveryMatrix?.state
      ?? "unknown",
    commandLeaseReplayStatus: analytics.commandLeaseReplay?.status ?? "unknown",
  };
  const reportingCursor = stableId("dryreportcursor", [
    reportCore.id,
    status,
    latestHistory?.id,
    dryRunAnalyticsExport.exportSummary?.timelineEventIds?.join(","),
  ]);
  const exportableTimeline = [
    {
      sequence: 1,
      source: "history",
      phase: "history-snapshots",
      status: blockedHistory.length > 0 ? "blocked" : waitingHistory.length > 0 ? "waiting" : "ready",
      event: "history-snapshots-indexed",
      count: history.length,
      nextAction: blockedHistory[0]?.nextAction ?? waitingHistory[0]?.nextAction ?? "retain-history-snapshots",
    },
    {
      sequence: 2,
      source: "job-timeline",
      phase: "job-events",
      status: failedTimeline.length > 0 ? "blocked" : waitingTimeline.length > 0 ? "waiting" : "ready",
      event: "job-timeline-indexed",
      count: jobTimelineRows.length,
      nextAction: failedTimeline[0]?.nextAction ?? waitingTimeline[0]?.nextAction ?? "retain-job-timeline",
    },
    {
      sequence: 3,
      source: "exports",
      phase: "export-readiness",
      status: dryRunAnalyticsExport.exportReady === true && operationalHealthExport.exportReady === true
        ? "ready"
        : exportBlocked.length > 0
          ? "blocked"
          : "waiting",
      event: "export-readiness-indexed",
      count: exportTimelineRows.length,
      nextAction,
    },
  ];
  return {
    protocol: "aios.mailchimp.dry-run-reporting-state.v1",
    id: stableId("dryreport", [
      reportCore.id,
      status,
      history.length,
      jobTimelineRows.length,
      exportTimelineRows.length,
    ]),
    product: "mailchimp",
    reportId: reportCore.id,
    planId: reportCore.planId,
    status,
    exportReady: status === "ready",
    nextAction,
    reportingCursor,
    digest,
    counters: {
      historySnapshots: history.length,
      jobTimelineEvents: jobTimelineRows.length,
      exportTimelineEvents: exportTimelineRows.length,
      blockedHistorySnapshots: blockedHistory.length,
      waitingHistorySnapshots: waitingHistory.length,
      failedTimelineEvents: failedTimeline.length,
      waitingTimelineEvents: waitingTimeline.length,
      blockerCodes: exportBlocked.length,
      warningCodes: exportWarnings.length,
      jobsTotal: analytics.counters?.jobsTotal ?? reportCore.jobs?.length ?? 0,
      jobsBlocked: analytics.counters?.jobsBlocked ?? 0,
      jobsDegraded: analytics.counters?.jobsDegraded ?? 0,
      jobsWouldRun: analytics.counters?.jobsWouldRun ?? 0,
    },
    historyIndex: {
      latestSnapshotId: latestHistory?.id ?? null,
      snapshotIds: history.map((snapshot) => snapshot.id),
      byType: countRowsBy(history, (snapshot) => snapshot.type),
      byStatus: countRowsBy(history, (snapshot) => snapshot.status),
      blockedSnapshotIds: blockedHistory.map((snapshot) => snapshot.id),
      waitingSnapshotIds: waitingHistory.map((snapshot) => snapshot.id),
    },
    timelineIndex: {
      latestEvent: jobTimelineRows.at(-1) ?? null,
      byEvent: countRowsBy(jobTimelineRows, (entry) => entry.event),
      byStatus: countRowsBy(jobTimelineRows, (entry) => entry.status),
      failedEventRefs: failedTimeline.map((entry) => `${entry.jobId}:${entry.sequence}:${entry.event}`),
      waitingEventRefs: waitingTimeline.map((entry) => `${entry.jobId}:${entry.sequence}:${entry.event}`),
      exportTimelineEventIds: dryRunAnalyticsExport.exportSummary?.timelineEventIds ?? [],
      exportRows: exportableTimeline,
    },
    exportSummary: {
      format: "aios.mailchimp.dry-run-reporting-state-summary.v1",
      status,
      exportReady: status === "ready",
      nextAction,
      reportingCursor,
      historySnapshotIds: history.map((snapshot) => snapshot.id),
      timelineEventIds: dryRunAnalyticsExport.exportSummary?.timelineEventIds ?? [],
      blockerCodes: Array.from(new Set(exportBlocked)).sort(),
      warningCodes: Array.from(new Set(exportWarnings)).sort(),
      externalWritesPerformed: false,
    },
    clientPatch: {
      dryRunReportingStateId: stableId("dryreport", [
        reportCore.id,
        status,
        history.length,
        jobTimelineRows.length,
        exportTimelineRows.length,
      ]),
      dryRunReportingStateStatus: status,
      dryRunReportingStateReady: status === "ready",
      dryRunReportingStateNextAction: nextAction,
      dryRunReportingCursor: reportingCursor,
      dryRunReportingHistorySnapshots: history.length,
      dryRunReportingTimelineEvents: jobTimelineRows.length + exportTimelineRows.length,
      dryRunReportingBlockedSnapshots: blockedHistory.map((snapshot) => snapshot.id),
      dryRunReportingWaitingSnapshots: waitingHistory.map((snapshot) => snapshot.id),
    },
    restartSemantics: {
      replaySafe: status !== "blocked",
      onRestart: "rebuild-dry-run-reporting-state-from-history-and-timeline",
      onDuplicateCommand: "return-existing-dry-run-reporting-state",
      reportingCursor,
      externalWritesPerformed: false,
    },
  };
}

function buildRuntimeExportWatermark(reportCore, analytics, history, operationalHealthExport, dryRunAnalyticsExport, reportingState) {
  const timelineEventIds = dryRunAnalyticsExport.exportSummary?.timelineEventIds ?? [];
  const historySnapshotIds = history.map((snapshot) => snapshot.id).filter(Boolean);
  const blockedHistoryIds = reportingState.historyIndex?.blockedSnapshotIds ?? [];
  const waitingHistoryIds = reportingState.historyIndex?.waitingSnapshotIds ?? [];
  const failedTimelineRefs = reportingState.timelineIndex?.failedEventRefs ?? [];
  const waitingTimelineRefs = reportingState.timelineIndex?.waitingEventRefs ?? [];
  const blockerCodes = dryRunAnalyticsExport.exportSummary?.blockerCodes ?? [];
  const warningCodes = dryRunAnalyticsExport.exportSummary?.warningCodes ?? [];
  const blockedJobIds = Array.from(new Set([
    ...(analytics.tenantBoundary?.blockedJobIds ?? []),
    ...(analytics.restart?.export?.blockedJobIds ?? []),
    ...(reportCore.jobs ?? [])
      .filter((job) => ["blocked", "skipped"].includes(job.status))
      .map((job) => job.jobId),
  ].filter(Boolean))).sort();
  const waitingJobIds = Array.from(new Set([
    ...(analytics.tenantBoundary?.approvalJobIds ?? []),
    ...(analytics.restart?.export?.waitingJobIds ?? []),
    ...(reportCore.jobs ?? [])
      .filter((job) => job.status === "degraded")
      .map((job) => job.jobId),
  ].filter(Boolean))).sort();
  const exportReady = dryRunAnalyticsExport.exportReady === true
    && operationalHealthExport.exportReady === true
    && reportingState.exportReady === true
    && blockedHistoryIds.length === 0
    && failedTimelineRefs.length === 0
    && blockerCodes.length === 0;
  const status = exportReady
    ? "ready"
    : blockedHistoryIds.length > 0 || failedTimelineRefs.length > 0 || blockerCodes.length > 0
      ? "blocked"
      : waitingHistoryIds.length > 0 || waitingTimelineRefs.length > 0 || warningCodes.length > 0
        ? "waiting"
        : "review";
  const nextAction = exportReady
    ? "publish-runtime-export-watermark"
    : blockerCodes.length > 0
      ? dryRunAnalyticsExport.nextAction || "repair-dry-run-analytics-export"
      : failedTimelineRefs.length > 0
        ? "review-failed-dry-run-timeline"
        : waitingTimelineRefs.length > 0 || waitingHistoryIds.length > 0
          ? "review-waiting-dry-run-export-watermark"
          : reportingState.nextAction || "review-runtime-export-watermark";
  const highWatermarks = {
    latestHistorySnapshotId: historySnapshotIds.at(-1) ?? null,
    latestTimelineEventId: timelineEventIds.at(-1) ?? null,
    latestJobTimelineRef: reportingState.timelineIndex?.latestEvent
      ? `${reportingState.timelineIndex.latestEvent.jobId}:${reportingState.timelineIndex.latestEvent.sequence}:${reportingState.timelineIndex.latestEvent.event}`
      : null,
    reportingCursor: reportingState.reportingCursor,
    operationalHealthStatus: operationalHealthExport.status,
    dryRunAnalyticsStatus: dryRunAnalyticsExport.status,
  };
  const cursor = stableId("dryexportwatermark", [
    reportCore.id,
    status,
    highWatermarks.reportingCursor,
    highWatermarks.latestHistorySnapshotId,
    highWatermarks.latestTimelineEventId,
    blockerCodes.join(","),
    warningCodes.join(","),
  ]);
  const dedupeKey = stableId("dryexportdedupe", [
    reportCore.planId,
    highWatermarks.latestHistorySnapshotId,
    highWatermarks.latestTimelineEventId,
    highWatermarks.reportingCursor,
  ]);
  const partitions = [
    {
      name: "history",
      status: blockedHistoryIds.length > 0 ? "blocked" : waitingHistoryIds.length > 0 ? "waiting" : "ready",
      cursor: highWatermarks.latestHistorySnapshotId,
      rows: historySnapshotIds.length,
      blockedRefs: blockedHistoryIds,
      waitingRefs: waitingHistoryIds,
      nextAction: blockedHistoryIds.length > 0 || waitingHistoryIds.length > 0
        ? "review-dry-run-history-snapshots"
        : "retain-history-snapshots",
    },
    {
      name: "timeline",
      status: failedTimelineRefs.length > 0 ? "blocked" : waitingTimelineRefs.length > 0 ? "waiting" : "ready",
      cursor: highWatermarks.latestTimelineEventId,
      rows: timelineEventIds.length,
      blockedRefs: failedTimelineRefs,
      waitingRefs: waitingTimelineRefs,
      nextAction: failedTimelineRefs.length > 0
        ? "review-failed-dry-run-timeline"
        : waitingTimelineRefs.length > 0
          ? "review-waiting-dry-run-timeline"
          : "retain-dry-run-timeline",
    },
    {
      name: "analytics",
      status: dryRunAnalyticsExport.status,
      cursor: dryRunAnalyticsExport.exportSummary?.reportingCursor ?? reportingState.reportingCursor,
      rows: dryRunAnalyticsExport.counters?.exportTimelineEvents ?? timelineEventIds.length,
      blockedRefs: blockerCodes,
      waitingRefs: warningCodes,
      nextAction: dryRunAnalyticsExport.nextAction,
    },
  ];

  return {
    schemaVersion: "aios.mailchimp.runtime-export-watermark.v1",
    id: cursor,
    provider: "mailchimp",
    reportId: reportCore.id,
    planId: reportCore.planId,
    status,
    exportReady,
    nextAction,
    cursor,
    dedupeKey,
    highWatermarks,
    partitions,
    counters: {
      historySnapshots: historySnapshotIds.length,
      timelineEvents: timelineEventIds.length,
      partitions: partitions.length,
      blockedPartitions: partitions.filter((partition) => partition.status === "blocked").length,
      waitingPartitions: partitions.filter((partition) => partition.status === "waiting").length,
      blockerCodes: blockerCodes.length,
      warningCodes: warningCodes.length,
      blockedJobs: blockedJobIds.length,
      waitingJobs: waitingJobIds.length,
    },
    exportSummary: {
      format: "aios.mailchimp.runtime-export-watermark-summary.v1",
      status,
      exportReady,
      nextAction,
      cursor,
      dedupeKey,
      partitionStatuses: partitions.reduce((summary, partition) => {
        summary[partition.name] = partition.status;
        return summary;
      }, {}),
      blockedJobIds,
      waitingJobIds,
      externalWritesPerformed: false,
    },
    clientPatch: {
      dryRunRuntimeExportWatermarkId: cursor,
      dryRunRuntimeExportWatermarkStatus: status,
      dryRunRuntimeExportWatermarkReady: exportReady,
      dryRunRuntimeExportWatermarkNextAction: nextAction,
      dryRunRuntimeExportWatermarkCursor: cursor,
      dryRunRuntimeExportBlockedJobs: blockedJobIds,
      dryRunRuntimeExportWaitingJobs: waitingJobIds,
    },
    restartSemantics: {
      replaySafe: status !== "blocked",
      duplicateCommandPolicy: "dedupe-by-runtime-export-watermark",
      cursor,
      externalWritesPerformed: false,
    },
  };
}

function buildOperationalHealthExport(reportCore, history) {
  const jobs = reportCore.jobs ?? [];
  const actionableErrors = reportCore.health?.actionableErrors ?? [];
  const runbook = reportCore.operationalRunbook ?? {};
  const provider = reportCore.providerHealth ?? {};
  const lifecycle = reportCore.lifecycle ?? {};
  const tenantAudit = reportCore.tenantAuditHandoff ?? {};
  const release = reportCore.providerReleaseContract ?? {};
  const commandLeaseReplay = reportCore.clientCommandLeaseReplay ?? {};
  const acceptance = reportCore.acceptancePreview ?? {};
  const failingChecks = jobs.flatMap((job) => (
    (job.health?.checks ?? [])
      .filter((check) => check.status === "fail")
      .map((check) => ({
        jobId: job.jobId,
        operation: job.operation,
        check: check.name,
        status: check.status,
        detail: check.detail,
        nextAction: actionableErrors.find((error) => error.jobId === job.jobId)?.action
          ?? runbook.nextAction
          ?? "repair-dry-run-health",
      }))
  ));
  const degradedChecks = jobs.flatMap((job) => (
    (job.health?.checks ?? [])
      .filter((check) => check.status === "degraded")
      .map((check) => ({
        jobId: job.jobId,
        operation: job.operation,
        check: check.name,
        status: check.status,
        detail: check.detail,
        nextAction: check.name === "tenant-permission"
          ? "collect-tenant-approval"
          : check.name === "adapter-status"
            ? "resume-after-approval"
            : runbook.nextAction ?? "review-degraded-dry-run-health",
      }))
  ));
  const retryableJobs = jobs.filter((job) => job.retryPolicy?.retryable === true);
  const retryBackoffs = retryableJobs
    .flatMap((job) => job.retryPolicy?.backoff ?? [])
    .map((entry) => entry.delayMs)
    .filter((delayMs) => Number.isFinite(delayMs) && delayMs >= 0)
    .sort((left, right) => left - right);
  const blockedJobIds = jobs
    .filter((job) => ["blocked", "skipped"].includes(job.status))
    .map((job) => job.jobId)
    .sort();
  const degradedJobIds = jobs
    .filter((job) => job.status === "degraded")
    .map((job) => job.jobId)
    .sort();
  const releaseBlocked = release.ready !== true || release.state === "blocked";
  const runtimeBlocked = blockedJobIds.length > 0
    || failingChecks.length > 0
    || releaseBlocked
    || tenantAudit.safeBoundary === false
    || lifecycle.operatorControls?.runtimeStart?.enabled === false;
  const runtimeWaiting = runtimeBlocked === false && (
    degradedJobIds.length > 0
    || degradedChecks.length > 0
    || acceptance.receipt?.status === "waiting"
    || commandLeaseReplay.ack?.required === true
    || tenantAudit.status === "needs-approval"
  );
  const exportStatus = runtimeBlocked
    ? "blocked"
    : runtimeWaiting
      ? "waiting"
      : "ready";
  const primaryOwner = runtimeBlocked
    ? runbook.owner ?? "runtime"
    : runtimeWaiting
      ? "operator"
      : "runtime";
  const timeline = [
    {
      sequence: 1,
      type: "dry-run-health-start",
      status: reportCore.status,
      health: reportCore.health?.status ?? "unknown",
      runbookState: runbook.state ?? "unknown",
      providerHealth: provider.status ?? "unknown",
      releaseState: release.state ?? "unknown",
    },
    ...history.map((entry, index) => ({
      sequence: index + 2,
      type: "history-snapshot",
      snapshotId: entry.id,
      snapshotType: entry.type,
      status: entry.status,
      nextAction: entry.tenantBoundaryNextAction
        ?? entry.commandLeaseReplayNextAction
        ?? entry.providerHealthNextAction
        ?? null,
    })),
    {
      sequence: history.length + 2,
      type: "dry-run-health-finish",
      status: exportStatus,
      nextAction: runtimeBlocked
        ? runbook.nextAction ?? release.nextAction ?? "repair-dry-run-health"
        : runtimeWaiting
          ? acceptance.nextAction ?? commandLeaseReplay.primaryAction ?? "collect-operator-acknowledgement"
          : "release-runtime-handoff",
      blockedJobIds,
      degradedJobIds,
    },
  ];

  return {
    protocol: "aios.mailchimp.dry-run-operational-health-export.v1",
    reportId: reportCore.id,
    planId: reportCore.planId,
    product: "mailchimp",
    status: exportStatus,
    exportReady: exportStatus === "ready",
    owner: primaryOwner,
    nextAction: runtimeBlocked
      ? runbook.nextAction ?? release.nextAction ?? "repair-dry-run-health"
      : runtimeWaiting
        ? acceptance.nextAction ?? commandLeaseReplay.primaryAction ?? "collect-operator-acknowledgement"
        : "release-runtime-handoff",
    counters: {
      jobs: jobs.length,
      blockedJobs: blockedJobIds.length,
      degradedJobs: degradedJobIds.length,
      failingChecks: failingChecks.length,
      degradedChecks: degradedChecks.length,
      actionableErrors: actionableErrors.length,
      retryableJobs: retryableJobs.length,
      timelineEvents: timeline.length,
      historySnapshots: history.length,
      providerErrors: provider.actionableErrors?.filter((error) => error.severity === "error").length ?? 0,
      commandLeaseBlocks: commandLeaseReplay.counts?.blocking ?? 0,
      acceptanceBlocks: acceptance.commandRelease?.counts?.blocked ?? 0,
    },
    failureRows: [...failingChecks, ...degradedChecks],
    retry: {
      retryable: exportStatus !== "ready" && retryableJobs.length > 0 && runtimeBlocked === false,
      nextBackoffMs: retryBackoffs[0] ?? runbook.retry?.nextBackoffMs ?? 0,
      policy: retryableJobs.length > 0 ? "bounded-deterministic-backoff" : "manual-or-not-needed",
      jobIds: retryableJobs.map((job) => job.jobId).sort(),
    },
    releaseDecision: {
      providerReleaseReady: release.ready === true,
      tenantBoundarySafe: tenantAudit.safeBoundary === true,
      runtimeStartEnabled: lifecycle.operatorControls?.runtimeStart?.enabled === true,
      commandLeasesReady: commandLeaseReplay.ready === true,
      acceptanceReady: acceptance.receipt?.readyForRuntimeStart === true,
      blockedJobIds,
      degradedJobIds,
    },
    timeline,
    exportSummary: {
      format: "aios.mailchimp.dry-run-operational-health-summary.v1",
      status: exportStatus,
      exportReady: exportStatus === "ready",
      nextAction: runtimeBlocked
        ? runbook.nextAction ?? release.nextAction ?? "repair-dry-run-health"
        : runtimeWaiting
          ? acceptance.nextAction ?? commandLeaseReplay.primaryAction ?? "collect-operator-acknowledgement"
          : "release-runtime-handoff",
      blockerCodes: failingChecks.map((row) => `job:${row.jobId}:${row.check}`).sort(),
      warningCodes: degradedChecks.map((row) => `job:${row.jobId}:${row.check}`).sort(),
      historySnapshotIds: history.map((entry) => entry.id),
      externalWritesPerformed: false,
    },
  };
}

function buildDryRunAnalyticsExportReport(reportCore, analytics, history, operationalHealthExport) {
  const historyByType = history.reduce((counts, snapshot) => {
    counts[snapshot.type] = (counts[snapshot.type] ?? 0) + 1;
    return counts;
  }, {});
  const packageAnalyticsReady = reportCore.executorPlanReport?.exportSummary?.packageAnalyticsExportReady !== false;
  const restartRecoveryExport = analytics.restart?.export ?? {};
  const timeline = [
    {
      sequence: 1,
      phase: "compile",
      status: reportCore.executorPlanReport?.status ?? reportCore.status,
      event: "executor-plan-report-ready",
      nextAction: reportCore.executorPlanReport?.nextAction ?? "review-executor-plan",
      exportRef: reportCore.executorPlanReport?.id ?? null,
    },
    {
      sequence: 2,
      phase: "simulate",
      status: reportCore.status,
      event: "dry-run-jobs-simulated",
      nextAction: reportCore.admission.accepted ? "publish-dry-run-export" : reportCore.operationalRunbook?.nextAction,
      counters: {
        jobsTotal: analytics.counters.jobsTotal,
        jobsWouldRun: analytics.counters.jobsWouldRun,
        jobsBlocked: analytics.counters.jobsBlocked,
        jobsDegraded: analytics.counters.jobsDegraded,
      },
    },
    {
      sequence: 3,
      phase: "tenant-boundary",
      status: analytics.tenantBoundary?.status ?? "unknown",
      event: "tenant-boundary-matrix-evaluated",
      nextAction: analytics.tenantBoundary?.nextAction ?? "append-audit-before-runtime-release",
      exportReady: analytics.tenantBoundary?.exportReady === true,
    },
    {
      sequence: 4,
      phase: "provider-release",
      status: reportCore.providerReleaseContract?.state ?? analytics.providerService.healthStatus,
      event: "provider-release-contract-evaluated",
      nextAction: reportCore.providerReleaseContract?.nextAction ?? analytics.providerService.healthNextAction,
      exportReady: reportCore.providerReleaseContract?.ready === true,
    },
    {
      sequence: 5,
      phase: "replay",
      status: analytics.commandLeaseReplay.status,
      event: "command-lease-replay-export-evaluated",
      nextAction: analytics.commandLeaseReplay.nextAction,
      exportReady: analytics.commandLeaseReplay.exportReady === true,
    },
    {
      sequence: 6,
      phase: "health-export",
      status: operationalHealthExport.status,
      event: "operational-health-export-evaluated",
      nextAction: operationalHealthExport.nextAction,
      exportReady: operationalHealthExport.exportReady === true,
    },
    {
      sequence: 7,
      phase: "restart-recovery-export",
      status: restartRecoveryExport.status ?? analytics.restart?.recoveryMatrix?.state ?? "unknown",
      event: "restart-recovery-export-evaluated",
      nextAction: restartRecoveryExport.nextAction
        ?? analytics.restart?.recoveryMatrix?.nextAction
        ?? "review-restart-recovery-export",
      exportReady: restartRecoveryExport.exportReady === true,
      counters: restartRecoveryExport.counters ?? {},
    },
    {
      sequence: 8,
      phase: "package-analytics",
      status: reportCore.executorPlanReport?.exportSummary?.packageAnalyticsStatus ?? "unknown",
      event: "package-analytics-export-carried",
      nextAction: reportCore.executorPlanReport?.exportSummary?.packageAnalyticsNextAction
        ?? "review-package-analytics-export",
      exportReady: packageAnalyticsReady,
    },
  ];
  const blockerCodes = [
    ...(operationalHealthExport.exportSummary?.blockerCodes ?? []),
    ...(analytics.tenantBoundary?.blockedJobIds ?? []).map((jobId) => `tenant-boundary:${jobId}`),
    ...(restartRecoveryExport.blockedJobIds ?? []).map((jobId) => `restart-recovery-export:${jobId}`),
    ...(reportCore.providerReleaseContract?.validationSummary?.blockers ?? []),
  ].sort();
  const warningCodes = [
    ...(operationalHealthExport.exportSummary?.warningCodes ?? []),
    ...(analytics.tenantBoundary?.approvalJobIds ?? []).map((jobId) => `tenant-approval:${jobId}`),
    ...(reportCore.providerReleaseContract?.validationSummary?.waitingJobIds ?? []).map((jobId) => `provider-waiting:${jobId}`),
    ...(analytics.restart?.recoveryMatrix?.waitingJobIds ?? []).map((jobId) => `restart-recovery-waiting:${jobId}`),
    ...(restartRecoveryExport.waitingJobIds ?? []).map((jobId) => `restart-recovery-export-waiting:${jobId}`),
    ...(restartRecoveryExport.reviewJobIds ?? []).map((jobId) => `restart-recovery-export-review:${jobId}`),
  ].sort();
  const exportReady = reportCore.status === "admitted"
    && operationalHealthExport.exportReady === true
    && analytics.commandLeaseReplay.exportReady === true
    && (analytics.restart?.recoveryMatrix?.restartSafe !== false)
    && restartRecoveryExport.exportReady === true
    && (analytics.tenantBoundary?.exportReady !== false)
    && reportCore.providerReleaseContract?.ready === true
    && packageAnalyticsReady;
  const status = exportReady
    ? "ready"
    : blockerCodes.length > 0 || reportCore.status === "blocked"
      ? "blocked"
      : warningCodes.length > 0 || reportCore.status === "degraded"
        ? "waiting"
        : "review";
  const nextAction = exportReady
    ? "publish-dry-run-analytics-export"
    : blockerCodes.some((code) => code.startsWith("tenant-boundary"))
      ? analytics.tenantBoundary?.nextAction ?? "resolve-tenant-permission-boundary"
      : reportCore.providerReleaseContract?.ready !== true
        ? reportCore.providerReleaseContract?.nextAction ?? "repair-provider-release-readiness"
        : restartRecoveryExport.exportReady !== true
          ? restartRecoveryExport.nextAction ?? "repair-restart-recovery-export"
          : analytics.commandLeaseReplay.exportReady !== true
            ? analytics.commandLeaseReplay.nextAction
            : operationalHealthExport.nextAction ?? reportCore.operationalRunbook?.nextAction ?? "review-dry-run-analytics";

  return {
    protocol: "aios.mailchimp.dry-run-analytics-export.v1",
    reportId: reportCore.id,
    planId: reportCore.planId,
    product: "mailchimp",
    status,
    exportReady,
    nextAction,
    counters: {
      ...analytics.counters,
      historySnapshots: history.length,
      historyTypes: Object.keys(historyByType).length,
      exportTimelineEvents: timeline.length,
      blockerCodes: blockerCodes.length,
      warningCodes: warningCodes.length,
      operationalHealthTimelineEvents: operationalHealthExport.counters?.timelineEvents ?? 0,
      restartRecoveryExportRows: restartRecoveryExport.counters?.rows ?? 0,
      restartRecoveryExportBlocked: restartRecoveryExport.counters?.blocked ?? 0,
      restartRecoveryExportWaiting: restartRecoveryExport.counters?.waiting ?? 0,
    },
    history: {
      snapshotIds: history.map((snapshot) => snapshot.id),
      byType: historyByType,
      latestSnapshotId: history.at(-1)?.id ?? null,
      latestStatus: history.at(-1)?.status ?? reportCore.status,
    },
    readiness: {
      admitted: reportCore.admission.accepted,
      operationalHealthReady: operationalHealthExport.exportReady === true,
      providerReleaseReady: reportCore.providerReleaseContract?.ready === true,
      packageAnalyticsReady,
      tenantBoundaryReady: analytics.tenantBoundary?.exportReady === true,
      commandLeaseReplayReady: analytics.commandLeaseReplay.exportReady === true,
      restartRecoveryReady: restartRecoveryExport.exportReady === true,
      runtimeStartEnabled: reportCore.lifecycle?.operatorControls?.runtimeStart?.enabled === true,
    },
    providerService: analytics.providerService,
    tenantBoundary: analytics.tenantBoundary,
    commandLeaseReplay: analytics.commandLeaseReplay,
    restartRecoveryExport,
    timeline,
    exportSummary: {
      format: "aios.mailchimp.dry-run-analytics-summary.v1",
      status,
      exportReady,
      nextAction,
      blockerCodes,
      warningCodes,
      historySnapshotIds: history.map((snapshot) => snapshot.id),
      timelineEventIds: timeline.map((event) => `${reportCore.id}:${event.sequence}:${event.phase}`),
      externalWritesPerformed: false,
    },
    clientPatch: {
      dryRunAnalyticsExportStatus: status,
      dryRunAnalyticsExportReady: exportReady,
      dryRunAnalyticsExportNextAction: nextAction,
      dryRunAnalyticsHistorySnapshots: history.length,
      dryRunAnalyticsTimelineEvents: timeline.length,
      dryRunAnalyticsBlockedJobs: analytics.tenantBoundary?.blockedJobIds ?? [],
      dryRunAnalyticsApprovalJobs: analytics.tenantBoundary?.approvalJobIds ?? [],
      dryRunAnalyticsRestartRecoveryState: analytics.restart?.recoveryMatrix?.state ?? "unknown",
      dryRunAnalyticsRestartRecoveryBlockedJobs: analytics.restart?.recoveryMatrix?.blockedJobIds ?? [],
      dryRunAnalyticsRestartRecoveryExportStatus: restartRecoveryExport.status ?? "unknown",
      dryRunAnalyticsRestartRecoveryExportReady: restartRecoveryExport.exportReady === true,
      dryRunAnalyticsRestartRecoveryExportBlockedJobs: restartRecoveryExport.blockedJobIds ?? [],
      dryRunAnalyticsRestartRecoveryExportWaitingJobs: restartRecoveryExport.waitingJobIds ?? [],
    },
    restartSemantics: {
      replaySafe: analytics.restart?.recoveryMatrix?.restartSafe !== false
        && restartRecoveryExport.restartSafe !== false,
      duplicateCommandPolicy: "dedupe-by-dry-run-analytics-report-id",
      resumeFromReportId: reportCore.id,
      resumeFromRestartRecoveryExportId: restartRecoveryExport.id ?? null,
      externalWritesPerformed: false,
    },
  };
}

function buildOperationalExportJournal(reportCore, analytics, history, operationalHealthExport, dryRunAnalyticsExport) {
  const planGate = reportCore.planOperationalExportGate
    ?? reportCore.plan?.operationalExportGate
    ?? reportCore.executorPlanReport?.operationalExportGate
    ?? {};
  const gateRows = Array.isArray(planGate.rows) ? planGate.rows : [];
  const historyRows = history.map((snapshot, index) => ({
    sequence: index + 1,
    kind: "history-snapshot",
    sourceId: snapshot.id,
    status: snapshot.status,
    type: snapshot.type,
    restartSafe: snapshot.restartSafe !== false,
    exportState: snapshot.status === "blocked" ? "blocked" : "exportable",
    nextAction: snapshot.nextAction ?? "return-existing-history-snapshot",
  }));
  const gateJournalRows = gateRows.map((row, index) => ({
    sequence: historyRows.length + index + 1,
    kind: "plan-gate-row",
    sourceId: row.sourceId ?? row.key,
    key: row.key,
    status: row.state,
    restartSafe: row.restartSafe !== false,
    exportState: row.state === "blocked" ? "blocked" : row.state === "waiting" ? "waiting" : "exportable",
    commandIds: row.commandIds ?? [],
    resumeCursor: row.resumeCursor ?? null,
    blockers: row.blockers ?? [],
    nextAction: row.nextAction ?? "review-operational-export-gate",
  }));
  const exportRows = [
    {
      key: "operational-health-export",
      status: operationalHealthExport.status,
      ready: operationalHealthExport.exportReady === true,
      sourceId: operationalHealthExport.reportId ?? reportCore.id,
      nextAction: operationalHealthExport.nextAction,
      blockerCodes: operationalHealthExport.exportSummary?.blockerCodes ?? [],
      warningCodes: operationalHealthExport.exportSummary?.warningCodes ?? [],
    },
    {
      key: "dry-run-analytics-export",
      status: dryRunAnalyticsExport.status,
      ready: dryRunAnalyticsExport.exportReady === true,
      sourceId: dryRunAnalyticsExport.reportId ?? reportCore.id,
      nextAction: dryRunAnalyticsExport.nextAction,
      blockerCodes: dryRunAnalyticsExport.exportSummary?.blockerCodes ?? [],
      warningCodes: dryRunAnalyticsExport.exportSummary?.warningCodes ?? [],
    },
    {
      key: "tenant-boundary-export",
      status: analytics.tenantBoundary?.status ?? "unknown",
      ready: analytics.tenantBoundary?.exportReady === true,
      sourceId: analytics.tenantBoundary?.id ?? null,
      nextAction: analytics.tenantBoundary?.nextAction ?? "review-tenant-boundary-export",
      blockerCodes: (analytics.tenantBoundary?.blockedJobIds ?? []).map((jobId) => `tenant-boundary:${jobId}`),
      warningCodes: (analytics.tenantBoundary?.approvalJobIds ?? []).map((jobId) => `tenant-approval:${jobId}`),
    },
    {
      key: "restart-recovery-export",
      status: analytics.restart?.export?.status ?? analytics.restart?.recoveryMatrix?.state ?? "unknown",
      ready: analytics.restart?.export?.exportReady === true,
      sourceId: analytics.restart?.export?.id ?? analytics.restart?.recoveryMatrix?.id ?? null,
      nextAction: analytics.restart?.export?.nextAction
        ?? analytics.restart?.recoveryMatrix?.nextAction
        ?? "review-restart-recovery-export",
      blockerCodes: (analytics.restart?.export?.blockedJobIds ?? []).map((jobId) => `restart-recovery:${jobId}`),
      warningCodes: [
        ...(analytics.restart?.export?.waitingJobIds ?? []).map((jobId) => `restart-recovery-waiting:${jobId}`),
        ...(analytics.restart?.export?.reviewJobIds ?? []).map((jobId) => `restart-recovery-review:${jobId}`),
      ],
    },
  ].map((row, index) => ({
    sequence: historyRows.length + gateJournalRows.length + index + 1,
    kind: "export-outcome",
    sourceId: row.sourceId,
    key: row.key,
    status: row.status,
    restartSafe: row.status !== "blocked",
    exportState: row.ready ? "exportable" : row.status === "blocked" ? "blocked" : "waiting",
    blockerCodes: row.blockerCodes,
    warningCodes: row.warningCodes,
    nextAction: row.nextAction,
  }));
  const journalRows = [...historyRows, ...gateJournalRows, ...exportRows];
  const blockedRows = journalRows.filter((row) => row.exportState === "blocked");
  const waitingRows = journalRows.filter((row) => row.exportState === "waiting");
  const exportableRows = journalRows.filter((row) => row.exportState === "exportable");
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "ready";
  const journalId = stableId("dryopjournal", [
    reportCore.id,
    planGate.id,
    status,
    journalRows.map((row) => `${row.kind}:${row.sourceId}:${row.exportState}`).join(","),
  ]);
  const command = {
    id: stableId("dryopjournalcmd", [journalId, "persist-operational-export-journal"]),
    type: "persist-dry-run-operational-export-journal",
    idempotencyKey: stableId("idem", [journalId, "persist-operational-export-journal"]),
    statusAfterReplay: status === "ready" ? "dry-run-operational-export-ready" : `dry-run-operational-export-${status}`,
    writes: ["journalRows", "historySnapshotIds", "timelineEventIds", "resumeCursor"],
    conflict: "return-existing",
  };
  return {
    protocol: "aios.mailchimp.dry-run-operational-export-journal.v1",
    id: journalId,
    reportId: reportCore.id,
    planId: reportCore.planId,
    product: "mailchimp",
    status,
    exportReady: status === "ready",
    nextAction: blockedRows[0]?.nextAction ?? waitingRows[0]?.nextAction ?? "publish-dry-run-operational-export-journal",
    rows: journalRows,
    command,
    counters: {
      rows: journalRows.length,
      historySnapshots: historyRows.length,
      planGateRows: gateJournalRows.length,
      exportOutcomes: exportRows.length,
      exportable: exportableRows.length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      blockerCodes: journalRows.flatMap((row) => row.blockerCodes ?? row.blockers ?? []).length,
      warningCodes: journalRows.flatMap((row) => row.warningCodes ?? []).length,
    },
    historySnapshotIds: history.map((snapshot) => snapshot.id),
    timelineEventIds: dryRunAnalyticsExport.exportSummary?.timelineEventIds ?? [],
    blockedKeys: blockedRows.map((row) => row.key ?? row.sourceId).filter(Boolean),
    waitingKeys: waitingRows.map((row) => row.key ?? row.sourceId).filter(Boolean),
    resumeCursor: stableId("dryopcursor", [
      reportCore.id,
      planGate.id,
      history.at(-1)?.id,
      dryRunAnalyticsExport.exportSummary?.timelineEventIds?.join(","),
    ]),
    restartSemantics: {
      restartSafe: status !== "blocked" && journalRows.every((row) => row.restartSafe !== false),
      onRestart: status === "ready" ? "load-dry-run-operational-export-journal" : "rebuild-dry-run-operational-export-journal",
      onDuplicateCommand: "return-existing-dry-run-operational-export-journal",
      externalWritesPerformed: false,
    },
    exportSummary: {
      format: "aios.mailchimp.dry-run-operational-export-journal.v1",
      status,
      exportReady: status === "ready",
      nextAction: blockedRows[0]?.nextAction ?? waitingRows[0]?.nextAction ?? "publish-dry-run-operational-export-journal",
      historySnapshotIds: history.map((snapshot) => snapshot.id),
      timelineEventIds: dryRunAnalyticsExport.exportSummary?.timelineEventIds ?? [],
      blockerCodes: [...new Set(journalRows.flatMap((row) => row.blockerCodes ?? row.blockers ?? []))].sort(),
      warningCodes: [...new Set(journalRows.flatMap((row) => row.warningCodes ?? []))].sort(),
      commandId: command.id,
      resumeCursor: stableId("dryopcursor", [
        reportCore.id,
        planGate.id,
        history.at(-1)?.id,
        dryRunAnalyticsExport.exportSummary?.timelineEventIds?.join(","),
      ]),
      externalWritesPerformed: false,
    },
  };
}

function buildExportSummary(reportCore, analytics, history) {
  return {
    format: "aios.mailchimp.dry-run.v1",
    reportId: reportCore.id,
    planId: reportCore.planId,
    product: reportCore.product,
    status: reportCore.status,
    accepted: reportCore.admission.accepted,
    counters: analytics.counters,
    restart: analytics.restart,
    operationalExportJournal: reportCore.operationalExportJournal ? {
      id: reportCore.operationalExportJournal.id,
      status: reportCore.operationalExportJournal.status,
      exportReady: reportCore.operationalExportJournal.exportReady,
      nextAction: reportCore.operationalExportJournal.nextAction,
      commandId: reportCore.operationalExportJournal.command.id,
      resumeCursor: reportCore.operationalExportJournal.resumeCursor,
      counters: reportCore.operationalExportJournal.counters,
      blockedKeys: reportCore.operationalExportJournal.blockedKeys,
      waitingKeys: reportCore.operationalExportJournal.waitingKeys,
    } : null,
    providerService: {
      state: analytics.providerService.state,
      handoffId: analytics.providerService.handoffId,
      blockedReason: analytics.providerService.blockedReason,
      healthId: analytics.providerService.healthId,
      healthStatus: analytics.providerService.healthStatus,
      healthNextAction: analytics.providerService.healthNextAction,
      retryable: analytics.providerService.retryable,
      degradedModeEnabled: analytics.providerService.degradedModeEnabled,
      actionableErrorCodes: analytics.providerService.actionableErrorCodes,
      lifecycleGateState: analytics.providerService.lifecycleGateState,
      lifecycleGateNextAction: analytics.providerService.lifecycleGateNextAction,
      capabilityDecision: analytics.providerService.capabilityDecision,
      requestedCapabilities: analytics.providerService.requestedCapabilities,
      missingWorkspaceCapabilities: analytics.providerService.missingWorkspaceCapabilities,
    },
    claimGateExport: {
      format: reportCore.claimGateReporting.exportFormat,
      pendingFacts: reportCore.claimGateReporting.pendingFacts,
      counters: reportCore.claimGateReporting.counters,
      historySnapshotIds: reportCore.claimGateReporting.historySnapshotIds,
      exportPacket: reportCore.claimGateReporting.exportPacket,
      exportAcceptance: reportCore.claimExportAcceptance ? {
        id: reportCore.claimExportAcceptance.id,
        status: reportCore.claimExportAcceptance.status,
        ready: reportCore.claimExportAcceptance.ready === true,
        nextAction: reportCore.claimExportAcceptance.nextAction,
        digest: reportCore.claimExportAcceptance.digest,
        retentionManifestId: reportCore.claimExportAcceptance.validationSummary.retentionManifestId,
        retentionState: reportCore.claimExportAcceptance.validationSummary.retentionState,
        retentionReady: reportCore.claimExportAcceptance.validationSummary.retentionReady === true,
        retentionBlockedArtifactNames: reportCore.claimExportAcceptance.validationSummary.retentionBlockedArtifactNames,
        retentionReviewArtifactNames: reportCore.claimExportAcceptance.validationSummary.retentionReviewArtifactNames,
        blockedArtifactNames: reportCore.claimExportAcceptance.validationSummary.blockedArtifactNames,
        requiredInputNames: reportCore.claimExportAcceptance.requiredInputs
          .filter((input) => input.required)
          .map((input) => input.name),
      } : null,
      acceptance: {
        id: reportCore.claimGateReporting.acceptance.id,
        status: reportCore.claimGateReporting.acceptance.status,
        visibleStatus: reportCore.claimGateReporting.acceptance.visibleStatus,
        nextAction: reportCore.claimGateReporting.acceptance.nextAction,
        acceptanceToken: reportCore.claimGateReporting.acceptance.acceptanceToken,
        commandId: reportCore.claimGateReporting.acceptance.commandId,
      },
    },
    lifecycle: {
      valid: reportCore.lifecycle.valid,
      command: reportCore.lifecycle.settings.command,
      enabled: reportCore.lifecycle.settings.enabled,
      scheduleMode: reportCore.lifecycle.settings.schedule.mode,
      schedulePaused: reportCore.lifecycle.settings.schedule.paused,
      operatorControlsStatus: reportCore.lifecycle.operatorControls.status,
      operatorControlsNextAction: reportCore.lifecycle.operatorControls.nextAction,
      operatorControlsStateKey: reportCore.lifecycle.operatorControls.stateKey,
      runtimeStartEnabled: reportCore.lifecycle.operatorControls.runtimeStart.enabled,
      disabledRequiredActions: reportCore.lifecycle.operatorControls.capabilityControls.disabledRequiredActions,
      nextAction: reportCore.lifecycle.nextAction.action,
      validationIssueCodes: reportCore.lifecycle.validationIssues.map((issue) => issue.code),
      validationSummary: reportCore.lifecycle.validationSummary,
      packageLifecycleCommand: reportCore.packageLifecycle.command,
      packageLifecycleReleasePolicy: reportCore.packageLifecycle.releasePolicy,
      packageLifecycleCommandIds: reportCore.packageLifecycle.commandIds,
      packageReleaseGate: reportCore.packageLifecycle.releaseGate,
    },
    acceptance: {
      accepted: reportCore.acceptancePreview.accepted,
      status: reportCore.acceptancePreview.status,
      visibleStatus: reportCore.acceptancePreview.visibleStatus,
      nextAction: reportCore.acceptancePreview.nextAction,
      requiredInputNames: reportCore.acceptancePreview.validationSummary.requiredInputNames,
      commandReleaseStatus: reportCore.acceptancePreview.commandRelease?.status,
      commandReleaseReady: reportCore.acceptancePreview.commandRelease?.ready === true,
      commandReleaseNextAction: reportCore.acceptancePreview.commandRelease?.nextAction,
      commandReleaseBlockedJobs: reportCore.acceptancePreview.commandRelease?.clientPatch?.acceptanceCommandReleaseBlockedJobs ?? [],
      commandReleaseWaitingJobs: reportCore.acceptancePreview.commandRelease?.clientPatch?.acceptanceCommandReleaseWaitingJobs ?? [],
      commandIds: reportCore.acceptancePreview.commandRelease?.commandIds ?? [],
      resumeCursors: reportCore.acceptancePreview.commandRelease?.resumeCursors ?? [],
    },
    packagePreview: {
      previewId: reportCore.packagePreviewState.previewId,
      status: reportCore.packagePreviewState.status,
      visibleStatus: reportCore.packagePreviewState.visibleStatus,
      nextAction: reportCore.packagePreviewState.nextAction,
      stateKey: reportCore.packagePreviewState.stateKey,
      version: reportCore.packagePreviewState.version,
      restartSafe: reportCore.packagePreviewState.restartSafe,
      resumeCursor: reportCore.packagePreviewState.resumeCursor,
      commandIds: reportCore.packagePreviewState.commands.map((command) => command.id),
      requiredInputNames: reportCore.packagePreviewState.acceptance.requiredInputs
        .filter((input) => input.required)
        .map((input) => input.name),
    },
    clientRuntimeHandoff: {
      state: reportCore.clientRuntimeHandoff.state,
      visibleStatus: reportCore.clientRuntimeHandoff.visibleStatus,
      handoffId: reportCore.clientRuntimeHandoff.provider.handoffId,
      syncContractId: reportCore.clientRuntimeHandoff.sync.contractId,
      replayCursor: reportCore.clientRuntimeHandoff.resumability.replayCursor,
      replayManifestIds: reportCore.clientRuntimeHandoff.resumability.replayManifestIds,
      replayDecisions: reportCore.clientRuntimeHandoff.resumability.replayDecisions,
      claimAcceptanceToken: reportCore.clientRuntimeHandoff.claimAcceptance.acceptanceToken,
      clientOperationStateIds: reportCore.clientRuntimeHandoff.resumability.clientOperationStateIds,
      blockedClientOperationStateIds: reportCore.clientRuntimeHandoff.resumability.blockedClientOperationStateIds,
      clientCommandLeaseReplayStatus: reportCore.clientCommandLeaseReplay.status,
      clientCommandLeaseResumeToken: reportCore.clientCommandLeaseReplay.resumeToken,
      clientCommandLeaseAckRequired: reportCore.clientCommandLeaseReplay.ack.required,
      clientCommandLeaseIds: reportCore.clientCommandLeaseReplay.leases.map((lease) => lease.id),
      acceptanceCommandReleaseStatus: reportCore.clientRuntimeHandoff.resumability.acceptanceCommandReleaseStatus,
      acceptanceCommandReleaseReady: reportCore.clientRuntimeHandoff.resumability.acceptanceCommandReleaseReady,
      acceptanceCommandIds: reportCore.clientRuntimeHandoff.resumability.acceptanceCommandIds,
      blockedAcceptanceCommandIds: reportCore.clientRuntimeHandoff.resumability.blockedAcceptanceCommandIds,
      waitingAcceptanceCommandIds: reportCore.clientRuntimeHandoff.resumability.waitingAcceptanceCommandIds,
    },
    commandLeaseReplayExport: analytics.commandLeaseReplay,
    restartRecoveryMatrix: analytics.restart.recoveryMatrix,
    dryRunAnalyticsExport: reportCore.dryRunAnalyticsExport ? {
      status: reportCore.dryRunAnalyticsExport.status,
      exportReady: reportCore.dryRunAnalyticsExport.exportReady,
      nextAction: reportCore.dryRunAnalyticsExport.nextAction,
      counters: reportCore.dryRunAnalyticsExport.counters,
      historySnapshotIds: reportCore.dryRunAnalyticsExport.exportSummary.historySnapshotIds,
      blockerCodes: reportCore.dryRunAnalyticsExport.exportSummary.blockerCodes,
      warningCodes: reportCore.dryRunAnalyticsExport.exportSummary.warningCodes,
    } : null,
    executorPlanReport: {
      id: reportCore.executorPlanReport.id,
      format: reportCore.executorPlanReport.exportSummary.format,
      readinessStatus: reportCore.executorPlanReport.exportSummary.readinessStatus,
      acceptanceStatus: reportCore.executorPlanReport.exportSummary.acceptanceStatus,
      providerState: reportCore.executorPlanReport.exportSummary.providerState,
      providerHealthStatus: reportCore.executorPlanReport.exportSummary.providerHealthStatus,
      lifecycleReleaseGateState: reportCore.executorPlanReport.exportSummary.lifecycleReleaseGateState,
      packageAnalyticsStatus: reportCore.executorPlanReport.exportSummary.packageAnalyticsStatus,
      packageAnalyticsExportReady: reportCore.executorPlanReport.exportSummary.packageAnalyticsExportReady,
      packageAnalyticsNextAction: reportCore.executorPlanReport.exportSummary.packageAnalyticsNextAction,
      nextAction: reportCore.executorPlanReport.exportSummary.nextAction,
      counters: reportCore.executorPlanReport.counters,
      historySnapshotIds: reportCore.executorPlanReport.exportSummary.historySnapshotIds,
    },
    providerHealth: {
      id: reportCore.providerHealth.id,
      status: reportCore.providerHealth.status,
      nextAction: reportCore.providerHealth.nextAction,
      retryable: reportCore.providerHealth.retryPolicy.retryable,
      degradedModeEnabled: reportCore.providerHealth.degradedMode.enabled,
      blockedAdapterCalls: reportCore.providerHealth.degradedMode.blockedAdapterCalls,
      actionableErrorCodes: reportCore.providerHealth.actionableErrors.map((error) => error.code),
    },
    providerCapabilityReplay: {
      id: reportCore.providerCapabilityDryRunState.id,
      status: reportCore.providerCapabilityDryRunState.status,
      ready: reportCore.providerCapabilityDryRunState.ready,
      nextAction: reportCore.providerCapabilityDryRunState.clientPatch.providerCapabilityReplayNextAction,
      resumeCursor: reportCore.providerCapabilityDryRunState.resumeCursor,
      missingCapabilities: reportCore.providerCapabilityDryRunState.missingCapabilities,
      heldCapabilities: reportCore.providerCapabilityDryRunState.heldCapabilities,
      commandIds: reportCore.providerCapabilityDryRunState.commands.map((command) => command.id),
    },
    providerCredentialLease: {
      id: reportCore.providerCredentialLeaseDryRunState.id,
      status: reportCore.providerCredentialLeaseDryRunState.status,
      ready: reportCore.providerCredentialLeaseDryRunState.ready,
      nextAction: reportCore.providerCredentialLeaseDryRunState.clientPatch.providerCredentialLeaseNextAction,
      resumeCursor: reportCore.providerCredentialLeaseDryRunState.resumeCursor,
      blockedScopes: reportCore.providerCredentialLeaseDryRunState.blockedScopes,
      waitingScopes: reportCore.providerCredentialLeaseDryRunState.waitingScopes,
      heldScopes: reportCore.providerCredentialLeaseDryRunState.heldScopes,
      credentialKeys: reportCore.providerCredentialLeaseDryRunState.credentialKeys,
      commandIds: reportCore.providerCredentialLeaseDryRunState.commands.map((command) => command.id),
    },
    providerReleaseContract: {
      id: reportCore.providerReleaseContract.id,
      state: reportCore.providerReleaseContract.state,
      ready: reportCore.providerReleaseContract.ready,
      nextAction: reportCore.providerReleaseContract.nextAction,
      syncReady: reportCore.providerReleaseContract.sync.ready,
      lifecycleReady: reportCore.providerReleaseContract.releaseGates.lifecycleReady,
      tenantReady: reportCore.providerReleaseContract.releaseGates.tenantReady,
      capabilitiesReady: reportCore.providerReleaseContract.releaseGates.capabilitiesReady,
      missingCapabilities: reportCore.providerReleaseContract.capabilityNegotiation.missing,
      blockedJobIds: reportCore.providerReleaseContract.validationSummary.blockedJobIds,
      waitingJobIds: reportCore.providerReleaseContract.validationSummary.waitingJobIds,
      adapterStatusResumeCursors: reportCore.providerReleaseContract.externalHandoff.adapterStatusResumeCursors,
    },
    runtimeReleaseDecision: {
      protocol: reportCore.runtimeReleaseDecision.protocol,
      state: reportCore.runtimeReleaseDecision.state,
      ready: reportCore.runtimeReleaseDecision.ready,
      accepted: reportCore.runtimeReleaseDecision.accepted,
      visibleStatus: reportCore.runtimeReleaseDecision.visibleStatus,
      nextAction: reportCore.runtimeReleaseDecision.nextAction,
      owner: reportCore.runtimeReleaseDecision.owner,
      releaseToken: reportCore.runtimeReleaseDecision.releaseToken,
      releaseCommandId: reportCore.runtimeReleaseDecision.releaseCommand.commandId,
      blockedGateIds: reportCore.runtimeReleaseDecision.clientPatch.runtimeReleaseBlockedGateIds,
      waitingGateIds: reportCore.runtimeReleaseDecision.clientPatch.runtimeReleaseWaitingGateIds,
      operatorInstructionId: reportCore.runtimeReleaseDecision.clientPatch.runtimeReleaseOperatorInstructionId,
      operatorInstructionState: reportCore.runtimeReleaseDecision.clientPatch.runtimeReleaseOperatorInstructionState,
      operatorInstructionReady: reportCore.runtimeReleaseDecision.clientPatch.runtimeReleaseOperatorInstructionReady,
      operatorBlockedGateIds: reportCore.runtimeReleaseDecision.clientPatch.runtimeReleaseOperatorBlockedGateIds,
      operatorWaitingGateIds: reportCore.runtimeReleaseDecision.clientPatch.runtimeReleaseOperatorWaitingGateIds,
      operatorRequiredAcknowledgements: reportCore.runtimeReleaseDecision.clientPatch.runtimeReleaseOperatorRequiredAcknowledgements,
      gates: reportCore.runtimeReleaseDecision.gates,
      counters: reportCore.runtimeReleaseDecision.counters,
    },
    tenantAuditHandoff: {
      protocol: reportCore.tenantAuditHandoff.protocol,
      id: reportCore.tenantAuditHandoff.id,
      status: reportCore.tenantAuditHandoff.status,
      safeBoundary: reportCore.tenantAuditHandoff.safeBoundary,
      isolationKey: reportCore.tenantAuditHandoff.isolationKey,
      tenantId: reportCore.tenantAuditHandoff.scope.tenantId,
      workspaceId: reportCore.tenantAuditHandoff.scope.workspaceId,
      actorId: reportCore.tenantAuditHandoff.actor.id,
      missingScopes: reportCore.tenantAuditHandoff.permissions.missing,
      blockedJobIds: reportCore.tenantAuditHandoff.permissions.blockedJobIds,
      approvalJobIds: reportCore.tenantAuditHandoff.permissions.approvalJobIds,
      nextAction: reportCore.tenantAuditHandoff.handoff.nextAction,
      auditRefs: reportCore.tenantAuditHandoff.handoff.auditRefs,
    },
    tenantBoundaryMatrix: reportCore.tenantBoundaryMatrix ? {
      id: reportCore.tenantBoundaryMatrix.id,
      protocol: reportCore.tenantBoundaryMatrix.protocol,
      status: reportCore.tenantBoundaryMatrix.status,
      safeBoundary: reportCore.tenantBoundaryMatrix.safeBoundary,
      exportReady: reportCore.tenantBoundaryMatrix.exportReady,
      isolationKey: reportCore.tenantBoundaryMatrix.isolationKey,
      policyVersion: reportCore.tenantBoundaryMatrix.policyVersion,
      nextAction: reportCore.tenantBoundaryMatrix.audit.nextAction,
      counters: reportCore.tenantBoundaryMatrix.counters,
      blockedJobIds: reportCore.tenantBoundaryMatrix.clientPatch.tenantBoundaryBlockedJobs,
      approvalJobIds: reportCore.tenantBoundaryMatrix.clientPatch.tenantBoundaryApprovalJobs,
      missingScopes: reportCore.tenantBoundaryMatrix.clientPatch.tenantBoundaryMissingScopes,
      auditRefs: reportCore.tenantBoundaryMatrix.audit.auditRefs,
      resumeCursors: reportCore.tenantBoundaryMatrix.audit.resumeCursors,
    } : null,
    claimAcknowledgment: {
      id: reportCore.claimAcknowledgmentState.id,
      status: reportCore.claimAcknowledgmentState.status,
      visibleStatus: reportCore.claimAcknowledgmentState.visibleStatus,
      stateKey: reportCore.claimAcknowledgmentState.stateKey,
      version: reportCore.claimAcknowledgmentState.version,
      resumeCursor: reportCore.claimAcknowledgmentState.resumeCursor,
      commandIds: reportCore.claimAcknowledgmentState.commands.map((command) => command.id),
      requiredInputNames: reportCore.claimAcknowledgmentState.requiredInputs
        .filter((input) => input.required)
        .map((input) => input.name),
    },
    issueCodes: reportCore.admission.issueCodes,
    actionableErrorCodes: reportCore.health.actionableErrors.map((error) => error.code),
    operationalRunbook: {
      protocol: reportCore.operationalRunbook.protocol,
      state: reportCore.operationalRunbook.state,
      nextAction: reportCore.operationalRunbook.nextAction,
      owner: reportCore.operationalRunbook.owner,
      degradedMode: reportCore.operationalRunbook.degradedMode,
      retryable: reportCore.operationalRunbook.retry.retryable,
      nextBackoffMs: reportCore.operationalRunbook.retry.nextBackoffMs,
      blockerCount: reportCore.operationalRunbook.counters.blockers,
      warningCount: reportCore.operationalRunbook.counters.warnings,
      escalationCount: reportCore.operationalRunbook.counters.escalations,
      steps: reportCore.operationalRunbook.steps.map((step) => ({
        id: step.id,
        state: step.state,
        owner: step.owner,
        action: step.action,
        retryable: step.retryable,
        jobIds: step.jobIds,
      })),
    },
    jobStatuses: reportCore.jobs.map((job) => ({
      jobId: job.jobId,
      operation: job.operation,
      status: job.status,
      reason: job.reason,
      checkpointKey: job.state.checkpointKey,
      ledgerKey: job.state.ledgerKey,
      adapterStatusState: job.adapterStatusProbe?.state ?? null,
      adapterStatusResumeCursor: job.adapterStatusProbe?.resumeCursor ?? null,
      adapterStatusFixtureId: job.adapterStatusProbe?.dryRunOutcome?.fixtureId ?? null,
      adapterStatusSimulatedStatus: job.adapterStatusProbe?.dryRunOutcome?.status ?? null,
      adapterStatusClassification: job.adapterStatusProbe?.dryRunOutcome?.classification ?? null,
      adapterStatusRecoveryAction: job.adapterStatusProbe?.dryRunOutcome?.recoveryAction ?? null,
      replayManifestId: job.state.restartReplay?.sourceManifestId ?? null,
      replayDecision: job.state.restartReplay?.replayDecision ?? null,
      replayCursor: job.state.restartReplay?.replayCursor ?? null,
      clientOperationStateId: job.state.clientOperationState?.id ?? null,
      clientVisibleStatus: job.state.clientOperationState?.visibleStatus ?? null,
      clientNextAction: job.state.clientOperationState?.nextAction ?? null,
      commandLeaseId: job.state.commandLeaseReplay?.id ?? null,
      commandLeaseStatus: job.state.commandLeaseReplay?.status ?? null,
      commandLeaseAckRequired: job.state.commandLeaseReplay?.ackRequired ?? false,
    })),
    historySnapshotIds: history.map((entry) => entry.id),
  };
}

function buildOperationalRunbook(plan, jobResults, health, providerHealth, lifecycle, tenantAuditHandoff, clientCommandLeaseReplay) {
  const healthErrors = health.actionableErrors ?? [];
  const blockingJobs = jobResults.filter((result) => ["blocked", "skipped"].includes(result.status));
  const degradedJobs = jobResults.filter((result) => result.status === "degraded");
  const retryableJobs = jobResults.filter((result) => result.retryPolicy?.retryable === true);
  const adapterBlockedJobs = jobResults.filter((result) => result.adapterStatusProbe?.state === "blocked");
  const adapterPausedJobs = jobResults.filter((result) => result.adapterStatusProbe?.state === "paused");
  const leaseBlockingJobs = (clientCommandLeaseReplay.leases ?? [])
    .filter((lease) => lease.blocksRuntimeStart)
    .map((lease) => lease.jobId)
    .filter(Boolean);
  const lifecycleError = lifecycle.validationIssues.find((issue) => issue.severity === "error");
  const providerError = providerHealth.actionableErrors?.find((error) => error.severity === "error");
  const tenantBlocked = tenantAuditHandoff.safeBoundary !== true || tenantAuditHandoff.status === "blocked";
  const providerBlocked = providerHealth.status === "unhealthy" || providerPreviewStateBlocked(providerHealth);
  const state = health.status === "unhealthy" || tenantBlocked || providerBlocked || lifecycleError
    ? "blocked"
    : health.status === "degraded" || degradedJobs.length > 0 || adapterPausedJobs.length > 0
      ? "degraded"
      : "ready";
  const owner = tenantBlocked
    ? "operator"
    : lifecycleError
      ? "operator"
      : providerBlocked
        ? "adapter"
        : healthErrors.some((error) => error.code.includes("truth-boundary"))
          ? "caller"
          : "runtime";
  const firstRetryable = retryableJobs.find((result) => result.retryPolicy?.backoff?.length > 0);
  const retryBackoffs = retryableJobs
    .flatMap((result) => result.retryPolicy?.backoff ?? [])
    .map((entry) => entry.delayMs)
    .filter((delayMs) => Number.isFinite(delayMs));
  const retryable = state !== "ready"
    && retryableJobs.length > 0
    && tenantBlocked === false
    && lifecycleError?.severity !== "error";
  const nextBackoffMs = retryable
    ? retryBackoffs.length > 0
      ? Math.min(...retryBackoffs)
      : firstRetryable?.retryPolicy?.backoff?.[0]?.delayMs ?? 0
    : 0;
  const steps = [
    {
      id: "truth-boundary",
      state: healthErrors.some((error) => error.code === "dry-run.truth-boundary-open") ? "blocked" : "ready",
      owner: "caller",
      action: "provide-mailchimp-evidence-facts",
      reason: "claim facts must be verified before Mailchimp adapter handoff",
      retryable: false,
      jobIds: jobResults
        .filter((result) => result.health.checks.some((check) => check.name === "truth-boundary" && check.status === "fail"))
        .map((result) => result.jobId),
    },
    {
      id: "tenant-permission-boundary",
      state: tenantBlocked
        ? "blocked"
        : tenantAuditHandoff.status === "needs-approval"
          ? "waiting"
          : "ready",
      owner: "operator",
      action: tenantAuditHandoff.handoff?.nextAction || "append-audit-before-runtime-release",
      reason: tenantBlocked ? "tenant audit boundary blocks runtime release" : "tenant audit boundary is prepared",
      retryable: false,
      jobIds: [
        ...(tenantAuditHandoff.permissions?.blockedJobIds ?? []),
        ...(tenantAuditHandoff.permissions?.approvalJobIds ?? []),
      ],
    },
    {
      id: "provider-status-handoff",
      state: providerBlocked
        ? "blocked"
        : providerHealth.degradedMode?.enabled
          ? "degraded"
          : "ready",
      owner: "adapter",
      action: providerHealth.nextAction || "review-provider-handoff",
      reason: providerError?.detail || providerError?.action || providerHealth.blockedReason || "provider health is exportable",
      retryable: providerHealth.retryPolicy?.retryable === true,
      jobIds: [
        ...(providerHealth.jobState?.blockedJobIds ?? []),
        ...(providerHealth.jobState?.degradedJobIds ?? []),
      ],
    },
    {
      id: "adapter-status-probes",
      state: adapterBlockedJobs.length > 0
        ? "blocked"
        : adapterPausedJobs.length > 0
          ? "waiting"
          : "ready",
      owner: adapterBlockedJobs.length > 0 ? "adapter" : "operator",
      action: adapterBlockedJobs.length > 0
        ? "repair-adapter-status-handoff"
        : adapterPausedJobs.length > 0
          ? "resume-after-approval"
          : "persist-probe-cursors",
      reason: adapterBlockedJobs.length > 0
        ? "one or more adapter status probes are blocked"
        : adapterPausedJobs.length > 0
          ? "adapter status probe is paused for approval"
          : "adapter status probe cursors are ready",
      retryable: adapterBlockedJobs.length === 0 && adapterPausedJobs.length > 0,
      jobIds: [...adapterBlockedJobs, ...adapterPausedJobs].map((result) => result.jobId),
    },
    {
      id: "lifecycle-controls",
      state: lifecycleError
        ? "blocked"
        : lifecycle.valid
          ? "ready"
          : "degraded",
      owner: "operator",
      action: lifecycle.nextAction?.action || "review-lifecycle-controls",
      reason: lifecycleError?.code || lifecycle.nextAction?.reason || "lifecycle controls are valid",
      retryable: lifecycle.validationIssues.some((issue) => issue.severity === "warning"),
      jobIds: [],
    },
    {
      id: "client-command-leases",
      state: leaseBlockingJobs.length > 0
        ? "blocked"
        : clientCommandLeaseReplay.ack?.required === true
          ? "waiting"
          : "ready",
      owner: clientCommandLeaseReplay.ack?.required === true ? "operator" : "runtime",
      action: clientCommandLeaseReplay.primaryAction || "refresh-client-command-lease-replay",
      reason: leaseBlockingJobs.length > 0
        ? "client command leases block runtime start"
        : clientCommandLeaseReplay.ack?.required === true
          ? "client command lease acknowledgement is required"
          : "client command leases are replayable",
      retryable: leaseBlockingJobs.length === 0 && clientCommandLeaseReplay.replaySafe !== false,
      jobIds: leaseBlockingJobs,
    },
  ];
  const blockers = steps.filter((step) => step.state === "blocked");
  const warnings = steps.filter((step) => step.state === "degraded" || step.state === "waiting");
  const nextStep = blockers[0] ?? warnings[0] ?? steps.find((step) => step.id === "client-command-leases");

  return {
    protocol: "aios.mailchimp.dry-run-operational-runbook.v1",
    planId: plan.id,
    state,
    owner,
    degradedMode: state === "degraded",
    nextAction: nextStep?.action || "release-runtime-handoff",
    retry: {
      retryable,
      nextBackoffMs,
      retryableJobIds: retryableJobs.map((result) => result.jobId),
      policy: retryable ? "bounded-deterministic-backoff" : "manual-or-not-needed",
    },
    counters: {
      jobs: jobResults.length,
      blockers: blockers.length,
      warnings: warnings.length,
      escalations: steps.filter((step) => step.owner === "operator" && step.state === "blocked").length,
      retryableJobs: retryableJobs.length,
      actionableErrors: healthErrors.length,
      blockedJobs: blockingJobs.length,
      degradedJobs: degradedJobs.length,
      leaseBlockedJobs: leaseBlockingJobs.length,
    },
    steps,
    clientPatch: {
      operationalRunbookState: state,
      operationalRunbookNextAction: nextStep?.action || "release-runtime-handoff",
      operationalRunbookOwner: owner,
      operationalRunbookRetryable: retryable,
      operationalRunbookNextBackoffMs: nextBackoffMs,
    },
  };
}

function providerPreviewStateBlocked(providerHealth) {
  return providerHealth.externalHandoffState === "blocked"
    || providerHealth.jobState?.blockedJobIds?.length > 0
    || providerHealth.actionableErrors?.some((error) => error.severity === "error");
}

function buildExecutorPlanReportPreview(plan) {
  const source = plan.reporting ?? {};
  const exportSummary = source.exportSummary ?? {};
  const packageAnalytics = plan.package?.packageAnalyticsExport
    ?? plan.providerService?.packageAnalytics
    ?? {};
  const history = source.history ?? [];
  const timeline = source.timeline ?? [];
  const jobRows = source.jobRows ?? [];
  const counters = source.counters ?? {};
  const blockedRows = jobRows.filter((row) => (
    row.permissionDecision === "deny" || row.adapterStatusState === "blocked"
  ));
  const approvalRows = jobRows.filter((row) => row.permissionDecision === "needs-approval");
  const readyRows = jobRows.filter((row) => row.permissionDecision === "allow");
  const visibleStatus = exportSummary.canAccept
    ? "executor-plan-ready"
    : blockedRows.length > 0
      ? "executor-plan-blocked"
      : approvalRows.length > 0
        ? "executor-plan-waiting-for-approval"
        : "executor-plan-review";
  return {
    id: source.id ?? stableId("planreport", [
      plan.id,
      plan.readinessSummary?.status,
      plan.acceptanceContract?.status,
      plan.providerService?.externalHandoff?.state,
    ]),
    product: "mailchimp",
    generatedBy: "dry-run-executor",
    exportSummary: {
      format: exportSummary.format ?? "aios.mailchimp.executor-plan.v1",
      planId: exportSummary.planId ?? plan.id,
      readinessStatus: exportSummary.readinessStatus ?? plan.readinessSummary?.status ?? "unknown",
      acceptanceStatus: exportSummary.acceptanceStatus ?? plan.acceptanceContract?.status ?? "unknown",
      canAccept: exportSummary.canAccept === true,
      providerState: exportSummary.providerState ?? plan.providerService?.externalHandoff?.state ?? "unknown",
      providerHealthStatus: exportSummary.providerHealthStatus ?? plan.providerService?.operationalHealth?.status ?? "unknown",
      lifecycleReleaseGateState: exportSummary.lifecycleReleaseGateState
        ?? plan.providerService?.externalHandoff?.lifecycleGateState
        ?? "unknown",
      packageAnalyticsStatus: exportSummary.packageAnalyticsStatus
        ?? packageAnalytics.status
        ?? "unknown",
      packageAnalyticsExportReady: exportSummary.packageAnalyticsExportReady === true
        || packageAnalytics.exportReady === true,
      packageAnalyticsNextAction: exportSummary.packageAnalyticsNextAction
        ?? packageAnalytics.nextAction
        ?? "review-package-analytics-export",
      nextAction: exportSummary.nextAction
        ?? plan.acceptanceContract?.acceptAction
        ?? plan.readinessSummary?.nextAction
        ?? "review-executor-plan",
      historySnapshotIds: exportSummary.historySnapshotIds ?? history.map((entry) => entry.id),
    },
    counters: {
      jobsTotal: counters.jobsTotal ?? plan.jobs.length,
      jobsReady: counters.jobsReady ?? readyRows.length,
      jobsNeedingApproval: counters.jobsNeedingApproval ?? approvalRows.length,
      jobsDenied: counters.jobsDenied ?? blockedRows.length,
      writeLikeJobs: counters.writeLikeJobs ?? 0,
      issuesTotal: counters.issuesTotal ?? plan.issues.length,
      issueErrors: counters.issueErrors ?? plan.issues.filter((issue) => issue.severity === "error").length,
      issueWarnings: counters.issueWarnings ?? plan.issues.filter((issue) => issue.severity === "warning").length,
      readinessChecks: counters.readinessChecks ?? plan.readinessSummary?.checks?.length ?? 0,
      providerHealthChecks: counters.providerHealthChecks ?? plan.providerService?.operationalHealth?.checks?.length ?? 0,
      claimPendingFacts: counters.claimPendingFacts ?? plan.truthBoundaryReport?.unverifiedFacts?.length ?? 0,
      lifecycleCommands: counters.lifecycleCommands ?? plan.package?.lifecycleControls?.commands?.length ?? 0,
      restartReplayManifests: counters.restartReplayManifests ?? plan.restartProjection?.replayManifestIds?.length ?? 0,
      packageAnalyticsHistorySnapshots: counters.packageAnalyticsHistorySnapshots
        ?? packageAnalytics.exportSummary?.historySnapshotIds?.length
        ?? packageAnalytics.historySnapshotIds?.length
        ?? 0,
      packageAnalyticsTimelineEvents: counters.packageAnalyticsTimelineEvents
        ?? packageAnalytics.exportSummary?.timelineEventIds?.length
        ?? packageAnalytics.timelineEventIds?.length
        ?? 0,
      packageAnalyticsBlockedOperations: counters.packageAnalyticsBlockedOperations
        ?? packageAnalytics.blockedOperationIds?.length
        ?? 0,
      packageAnalyticsExportReady: counters.packageAnalyticsExportReady
        ?? (packageAnalytics.exportReady === true ? 1 : 0),
    },
    status: exportSummary.canAccept
      ? "ready"
      : blockedRows.length > 0 || plan.status === "blocked"
        ? "blocked"
        : approvalRows.length > 0
          ? "needs-approval"
          : "review",
    visibleStatus,
    nextAction: exportSummary.nextAction
      ?? plan.readinessSummary?.nextAction
      ?? "review-executor-plan",
    history,
    timeline,
    jobRows,
    preview: {
      title: "Mailchimp executor plan report",
      packageName: plan.package?.name,
      providerState: exportSummary.providerState ?? plan.providerService?.externalHandoff?.state ?? "unknown",
      readinessStatus: exportSummary.readinessStatus ?? plan.readinessSummary?.status ?? "unknown",
      acceptanceStatus: exportSummary.acceptanceStatus ?? plan.acceptanceContract?.status ?? "unknown",
      packageAnalyticsStatus: packageAnalytics.status ?? "unknown",
      packageAnalyticsExportReady: packageAnalytics.exportReady === true,
      readyJobIds: readyRows.map((row) => row.jobId),
      approvalJobIds: approvalRows.map((row) => row.jobId),
      blockedJobIds: blockedRows.map((row) => row.jobId),
      nextTimelineEvent: timeline.find((entry) => entry.status !== "ready") ?? timeline.at(-1) ?? null,
    },
  };
}

function buildProviderPreview(plan, lifecycle) {
  const providerService = plan.providerService ?? {};
  const externalHandoff = providerService.externalHandoff ?? {};
  const runtimeProviderHandoff = providerService.runtimeProviderHandoff
    ?? providerService.providerExternalHandoff
    ?? {};
  const negotiation = providerService.capabilityNegotiation ?? {};
  const integration = providerService.providerIntegrationContract
    ?? plan.package?.providerIntegrationContract
    ?? {};
  const releaseGate = providerService.lifecycle?.releaseGate ?? plan.package?.lifecycleControls?.releaseGate ?? {};
  const operationalHealth = providerService.operationalHealth ?? {};
  const providerCapabilityReplay = providerService.providerCapabilityReplay ?? {};
  return {
    state: integration.state === "blocked"
      ? "blocked"
      : integration.state === "waiting" && externalHandoff.state === "ready"
        ? "scheduled"
        : externalHandoff.state ?? "unknown",
    handoffId: externalHandoff.handoffId ?? null,
    releaseCommandId: externalHandoff.releaseCommandId ?? null,
    blockedReason: externalHandoff.blockedReason ?? null,
    lifecycleGate: releaseGate.id ? {
      id: releaseGate.id,
      state: releaseGate.state,
      releaseAllowed: releaseGate.releaseAllowed === true,
      nextAction: releaseGate.nextAction,
      gateReason: releaseGate.gateReason,
      releaseCommandId: releaseGate.releaseCommandId,
      blockedCheckNames: releaseGate.blockedCheckNames ?? [],
      reviewCheckNames: releaseGate.reviewCheckNames ?? [],
    } : null,
    adapterStatusResumeCursors: externalHandoff.adapterStatusResumeCursors ?? [],
    runtimeProviderHandoff: runtimeProviderHandoff.id ? {
      id: runtimeProviderHandoff.id,
      state: runtimeProviderHandoff.state,
      ready: runtimeProviderHandoff.ready === true,
      resumeCursor: runtimeProviderHandoff.resumeCursor,
      commandId: runtimeProviderHandoff.command?.id ?? externalHandoff.runtimeProviderHandoffCommandId ?? null,
      blockedJobIds: runtimeProviderHandoff.validationSummary?.blockedJobIds ?? [],
      waitingJobIds: runtimeProviderHandoff.validationSummary?.waitingJobIds ?? [],
      nextAction: runtimeProviderHandoff.clientPatch?.runtimeProviderHandoffNextAction
        ?? runtimeProviderHandoff.health?.nextAction
        ?? externalHandoff.nextAction
        ?? "review-runtime-provider-handoff",
      restartSafe: runtimeProviderHandoff.restartSemantics?.restartSafe === true,
    } : null,
    capabilityDecision: negotiation.decision ?? "unknown",
    requestedCapabilities: negotiation.requestedCapabilities ?? [],
    missingWorkspaceCapabilities: negotiation.missingWorkspaceCapabilities ?? [],
    integration: integration.id ? {
      id: integration.id,
      state: integration.state ?? "unknown",
      ready: integration.ready === true,
      nextAction: integration.nextAction ?? null,
      service: integration.service ?? providerService.provider?.service ?? "mailchimp-marketing",
      serviceLevel: integration.serviceLevel ?? null,
      missingFeatures: integration.validationSummary?.missingFeatures ?? [],
      waitingFeatures: integration.validationSummary?.waitingFeatures ?? [],
      batchLimited: integration.validationSummary?.batchLimited === true,
      staleStatusRisk: integration.validationSummary?.staleStatusRisk === true,
      commandId: integration.commandId ?? integration.command?.id ?? null,
    } : null,
    capabilityReplay: {
      id: providerCapabilityReplay.id ?? negotiation.replayContractId ?? null,
      state: providerCapabilityReplay.state ?? negotiation.replayState ?? "unknown",
      ready: providerCapabilityReplay.ready === true || negotiation.replayReady === true,
      resumeCursor: providerCapabilityReplay.resumeCursor ?? negotiation.resumeCursor ?? null,
      commandIds: providerCapabilityReplay.commands?.map((command) => command.id)
        ?? negotiation.commandIds
        ?? [],
      heldCapabilities: providerCapabilityReplay.heldRows ?? [],
      missingCapabilities: providerCapabilityReplay.missingRows ?? negotiation.missingWorkspaceCapabilities ?? [],
      nextAction: providerCapabilityReplay.nextAction ?? "review-provider-capability-replay",
    },
    readyJobIds: negotiation.readyJobIds ?? [],
    approvalJobIds: negotiation.approvalJobIds ?? [],
    deniedJobIds: negotiation.deniedJobIds ?? [],
    lifecycleNextAction: providerService.lifecycle?.nextAction?.action ?? lifecycle.nextAction.action,
    health: {
      id: operationalHealth.id ?? externalHandoff.healthId ?? null,
      status: operationalHealth.status ?? externalHandoff.healthStatus ?? "unknown",
      nextAction: operationalHealth.nextAction ?? externalHandoff.nextAction ?? null,
      retryable: operationalHealth.retryPolicy?.retryable === true,
      degradedModeEnabled: operationalHealth.degradedMode?.enabled === true,
      actionableErrorCodes: operationalHealth.actionableErrors?.map((error) => error.code) ?? [],
    },
    clientVisibleStatus: integration.state === "blocked"
      ? "provider-integration-blocked"
      : integration.state === "waiting"
        ? "provider-integration-waiting"
        : externalHandoff.state === "ready"
      ? "provider-ready"
      : externalHandoff.state === "waiting-for-approval"
        ? "provider-waiting-for-approval"
        : externalHandoff.state === "scheduled"
          ? "provider-scheduled"
          : externalHandoff.state === "review"
            ? "provider-release-review"
        : "provider-blocked",
  };
}

function buildRuntimeProviderHandoffDryRunState(plan, providerPreview, providerReleaseContract, jobResults) {
  const source = plan.providerService?.runtimeProviderHandoff
    ?? plan.providerService?.providerExternalHandoff
    ?? {};
  const sourceRows = source.rows ?? [];
  const resultByJobId = new Map(jobResults.map((result) => [result.jobId, result]));
  const rows = sourceRows.map((row, index) => {
    const result = resultByJobId.get(row.jobId) ?? {};
    const resultBlocked = ["blocked", "skipped"].includes(result.status);
    const resultWaiting = result.status === "degraded";
    const replayState = resultBlocked || row.state === "blocked"
      ? "blocked"
      : resultWaiting || row.state === "waiting"
        ? "waiting"
        : providerReleaseContract.ready === true && row.state === "ready"
          ? "replayable"
          : "review";
    return {
      sequence: index + 1,
      jobId: row.jobId,
      operation: row.operation,
      operationId: row.operationId,
      replayState,
      sourceState: row.state,
      dryRunJobStatus: result.status ?? "unknown",
      permissionDecision: row.permissionDecision,
      checkpointKey: row.checkpointKey,
      commandLedgerKey: row.commandLedgerKey,
      adapterStatusResumeCursor: row.adapterStatusResumeCursor,
      idempotencyKey: row.idempotencyKey,
      nextAction: replayState === "blocked"
        ? row.nextAction ?? "repair-provider-runtime-cursor"
        : replayState === "waiting"
          ? "wait-for-provider-release"
          : replayState === "replayable"
            ? "return-existing-runtime-provider-handoff"
            : "review-runtime-provider-handoff",
    };
  });
  const blockedRows = rows.filter((row) => row.replayState === "blocked");
  const waitingRows = rows.filter((row) => row.replayState === "waiting");
  const reviewRows = rows.filter((row) => row.replayState === "review");
  const state = blockedRows.length > 0 || providerReleaseContract.state === "blocked"
    ? "blocked"
    : waitingRows.length > 0 || providerReleaseContract.state === "waiting"
      ? "waiting"
      : reviewRows.length > 0
        ? "review"
        : "ready";
  const scope = [
    plan.id,
    source.id,
    providerReleaseContract.id,
    state,
    rows.map((row) => `${row.jobId}:${row.replayState}:${row.adapterStatusResumeCursor}`).join(","),
  ];
  const resumeCursor = source.resumeCursor ?? stableId("dryruntimeproviderhandoffcursor", scope);
  const command = {
    id: stableId("dryruntimeproviderhandoffcmd", [...scope, "persist-dry-runtime-provider-handoff"]),
    type: "persist-dry-run-runtime-provider-handoff",
    idempotencyKey: stableId("idem", [...scope, "persist-dry-runtime-provider-handoff"]),
    statusAfterReplay: state,
    writes: ["runtimeProviderHandoffRows", "dryRunReplayState", "resumeCursor"],
    conflict: "return-existing",
    wouldPersist: true,
  };
  return {
    protocol: "aios.mailchimp.dry-run-runtime-provider-handoff.v1",
    id: stableId("dryruntimeproviderhandoff", scope),
    sourceHandoffId: source.id ?? providerPreview.runtimeProviderHandoff?.id ?? null,
    providerReleaseContractId: providerReleaseContract.id,
    state,
    ready: state === "ready",
    resumeCursor,
    rows,
    command,
    blockedJobIds: blockedRows.map((row) => row.jobId),
    waitingJobIds: waitingRows.map((row) => row.jobId),
    reviewJobIds: reviewRows.map((row) => row.jobId),
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? "return-existing-runtime-provider-handoff",
    dryRunGuarantee: {
      externalWritesPerformed: false,
      providerMutationPerformed: false,
      commandWouldBeIdempotent: true,
      sourceRestartSafe: source.restartSemantics?.restartSafe === true,
      replayableRows: rows.filter((row) => row.replayState === "replayable").length,
    },
    restartSemantics: {
      restartSafe: state !== "blocked"
        && rows.every((row) => row.adapterStatusResumeCursor && row.idempotencyKey),
      onColdRestart: state === "ready" ? "load-dry-runtime-provider-handoff" : "reload-runtime-provider-handoff",
      onDuplicateCommand: "return-existing-dry-runtime-provider-handoff",
      onMissingResumeCursor: "repair-provider-runtime-cursor",
      externalWritesPerformed: false,
    },
    clientPatch: {
      dryRuntimeProviderHandoffId: stableId("dryruntimeproviderhandoffpatch", [plan.id, state]),
      dryRuntimeProviderHandoffState: state,
      dryRuntimeProviderHandoffReady: state === "ready",
      dryRuntimeProviderHandoffNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "return-existing-runtime-provider-handoff",
      dryRuntimeProviderHandoffResumeCursor: resumeCursor,
      dryRuntimeProviderHandoffBlockedJobIds: blockedRows.map((row) => row.jobId),
      dryRuntimeProviderHandoffWaitingJobIds: waitingRows.map((row) => row.jobId),
    },
  };
}

function buildProviderIntegrationExecutionTicket(plan, providerReleaseContract, runtimeProviderHandoffDryRunState, jobResults) {
  const integration = providerReleaseContract.providerIntegration ?? {};
  const releaseGates = providerReleaseContract.releaseGates ?? {};
  const runtimeRows = runtimeProviderHandoffDryRunState.rows ?? [];
  const jobById = new Map(jobResults.map((result) => [result.jobId, result]));
  const gateRows = [
    {
      gateId: "provider-integration-contract",
      label: "Provider integration contract",
      owner: "runtime-adapter",
      state: integration.ready === true ? "ready" : integration.state === "waiting" ? "waiting" : "blocked",
      required: true,
      nextAction: integration.ready === true
        ? "continue-provider-execution-ticket"
        : integration.nextAction || "repair-provider-integration-contract",
      evidence: {
        contractId: integration.contractId ?? null,
        missingFeatures: integration.missingFeatures ?? [],
        waitingFeatures: integration.waitingFeatures ?? [],
        serviceLevel: integration.serviceLevel ?? null,
      },
    },
    {
      gateId: "provider-release-contract",
      label: "Provider release contract",
      owner: "operator",
      state: providerReleaseContract.ready === true
        ? "ready"
        : providerReleaseContract.state === "waiting"
          ? "waiting"
          : "blocked",
      required: true,
      nextAction: providerReleaseContract.ready === true
        ? "continue-provider-execution-ticket"
        : providerReleaseContract.nextAction || "repair-provider-release-contract",
      evidence: {
        releaseContractId: providerReleaseContract.id,
        blockers: providerReleaseContract.validationSummary?.blockers ?? [],
        blockedJobIds: providerReleaseContract.validationSummary?.blockedJobIds ?? [],
        waitingJobIds: providerReleaseContract.validationSummary?.waitingJobIds ?? [],
      },
    },
    {
      gateId: "runtime-provider-handoff",
      label: "Runtime provider handoff",
      owner: "runtime-adapter",
      state: runtimeProviderHandoffDryRunState.ready === true
        ? "ready"
        : runtimeProviderHandoffDryRunState.state === "waiting"
          ? "waiting"
          : "blocked",
      required: true,
      nextAction: runtimeProviderHandoffDryRunState.ready === true
        ? "continue-provider-execution-ticket"
        : runtimeProviderHandoffDryRunState.nextAction || "repair-runtime-provider-handoff",
      evidence: {
        handoffId: runtimeProviderHandoffDryRunState.id,
        resumeCursor: runtimeProviderHandoffDryRunState.resumeCursor,
        blockedJobIds: runtimeProviderHandoffDryRunState.blockedJobIds,
        waitingJobIds: runtimeProviderHandoffDryRunState.waitingJobIds,
      },
    },
    {
      gateId: "provider-sync",
      label: "Provider sync",
      owner: "runtime-adapter",
      state: releaseGates.syncReady === true ? "ready" : "blocked",
      required: true,
      nextAction: releaseGates.syncReady === true
        ? "continue-provider-execution-ticket"
        : "refresh-provider-sync-before-release",
      evidence: providerReleaseContract.sync ?? {},
    },
  ];
  const operationRows = runtimeRows.map((row, index) => {
    const result = jobById.get(row.jobId) ?? {};
    const blocked = ["blocked", "skipped"].includes(result.status) || row.replayState === "blocked";
    const waiting = !blocked && (result.status === "degraded" || row.replayState === "waiting");
    const ticketState = blocked ? "blocked" : waiting ? "waiting" : "ready";
    return {
      sequence: index + 1,
      jobId: row.jobId,
      operation: row.operation,
      ticketState,
      dryRunJobStatus: result.status ?? "unknown",
      adapterStatusResumeCursor: row.adapterStatusResumeCursor ?? null,
      idempotencyKey: row.idempotencyKey ?? null,
      checkpointKey: row.checkpointKey ?? null,
      nextAction: ticketState === "blocked"
        ? row.nextAction || "repair-provider-execution-ticket"
        : ticketState === "waiting"
          ? "wait-for-provider-execution-ticket"
          : "release-provider-execution-ticket",
    };
  });
  const blockedGates = gateRows.filter((gate) => gate.required && gate.state === "blocked");
  const waitingGates = gateRows.filter((gate) => gate.required && gate.state === "waiting");
  const blockedOperations = operationRows.filter((row) => row.ticketState === "blocked");
  const waitingOperations = operationRows.filter((row) => row.ticketState === "waiting");
  const state = blockedGates.length > 0 || blockedOperations.length > 0
    ? "blocked"
    : waitingGates.length > 0 || waitingOperations.length > 0
      ? "waiting"
      : "ready";
  const ticketKey = stableId("providerexecutionticket", [
    plan.id,
    providerReleaseContract.id,
    runtimeProviderHandoffDryRunState.id,
    state,
    gateRows.map((gate) => `${gate.gateId}:${gate.state}`).join(","),
    operationRows.map((row) => `${row.jobId}:${row.ticketState}`).join(","),
  ]);
  const resumeCursor = stableId("providerexecutioncursor", [
    ticketKey,
    runtimeProviderHandoffDryRunState.resumeCursor,
    operationRows.map((row) => row.adapterStatusResumeCursor).filter(Boolean).join(","),
  ]);
  const nextAction = blockedGates[0]?.nextAction
    ?? blockedOperations[0]?.nextAction
    ?? waitingGates[0]?.nextAction
    ?? waitingOperations[0]?.nextAction
    ?? "release-provider-execution-ticket";

  return {
    protocol: "aios.mailchimp.provider-integration-execution-ticket.v1",
    id: ticketKey,
    planId: plan.id,
    provider: "mailchimp",
    service: providerReleaseContract.service ?? "mailchimp-marketing-api",
    state,
    ready: state === "ready",
    readyForRuntimeRelease: state === "ready" && providerReleaseContract.ready === true,
    nextAction,
    resumeCursor,
    releaseContractId: providerReleaseContract.id,
    runtimeProviderHandoffId: runtimeProviderHandoffDryRunState.id,
    providerIntegrationContractId: integration.contractId ?? null,
    gates: gateRows,
    operations: operationRows,
    validationSummary: {
      blockedGateIds: blockedGates.map((gate) => gate.gateId),
      waitingGateIds: waitingGates.map((gate) => gate.gateId),
      blockedJobIds: blockedOperations.map((row) => row.jobId),
      waitingJobIds: waitingOperations.map((row) => row.jobId),
      commandIds: [runtimeProviderHandoffDryRunState.command?.id].filter(Boolean),
      resumeCursors: [
        runtimeProviderHandoffDryRunState.resumeCursor,
        ...operationRows.map((row) => row.adapterStatusResumeCursor),
      ].filter(Boolean).sort(),
    },
    command: {
      id: stableId("providerexecutioncmd", [ticketKey, nextAction]),
      type: "persist-provider-integration-execution-ticket",
      statusAfterReplay: state,
      idempotencyKey: stableId("idem", [ticketKey, "persist-provider-integration-execution-ticket"]),
      wouldPersist: true,
      writes: ["providerIntegrationExecutionTicket", "providerGateStates", "resumeCursor"],
      conflict: "return-existing",
    },
    clientPatch: {
      dryRunProviderIntegrationExecutionTicketId: ticketKey,
      dryRunProviderIntegrationExecutionTicketState: state,
      dryRunProviderIntegrationExecutionTicketReady: state === "ready",
      dryRunProviderIntegrationExecutionTicketNextAction: nextAction,
      dryRunProviderIntegrationExecutionTicketResumeCursor: resumeCursor,
      dryRunProviderIntegrationExecutionTicketBlockedGates: blockedGates.map((gate) => gate.gateId),
      dryRunProviderIntegrationExecutionTicketWaitingGates: waitingGates.map((gate) => gate.gateId),
      dryRunProviderIntegrationExecutionTicketBlockedJobs: blockedOperations.map((row) => row.jobId),
      dryRunProviderIntegrationExecutionTicketWaitingJobs: waitingOperations.map((row) => row.jobId),
    },
    dryRunGuarantee: {
      externalWritesPerformed: false,
      providerMutationPerformed: false,
      commandWouldBeIdempotent: true,
      runtimeProviderHandoffRestartSafe: runtimeProviderHandoffDryRunState.restartSemantics?.restartSafe === true,
    },
    restartSemantics: {
      restartSafe: state !== "blocked"
        && operationRows.every((row) => row.idempotencyKey && row.adapterStatusResumeCursor),
      onColdRestart: "reload-provider-integration-execution-ticket",
      onDuplicateCommand: "return-existing-provider-integration-execution-ticket",
      resumeCursor,
      externalWritesPerformed: false,
    },
  };
}

function buildProviderReleaseContract(
  plan,
  providerPreview,
  providerHealth,
  jobResults,
  lifecycle,
  tenantAuditHandoff,
  providerCapabilityDryRunState = null,
) {
  const sync = plan.providerService?.sync ?? {};
  const negotiation = plan.providerService?.capabilityNegotiation ?? {};
  const integration = plan.providerService?.providerIntegrationContract
    ?? plan.package?.providerIntegrationContract
    ?? providerPreview.integration
    ?? {};
  const lifecycleGate = providerPreview.lifecycleGate ?? {};
  const releaseAcceptance = plan.releaseAcceptanceContract
    ?? plan.package?.releaseAcceptanceContract
    ?? plan.package?.lifecycleControls?.releaseAcceptance
    ?? {};
  const healthErrors = providerHealth.actionableErrors?.filter((error) => error.severity === "error") ?? [];
  const healthWarnings = providerHealth.actionableErrors?.filter((error) => error.severity === "warning") ?? [];
  const providerBlockedJobs = new Set([
    ...(providerHealth.jobState?.blockedJobIds ?? []),
    ...jobResults.filter((result) => ["blocked", "skipped"].includes(result.status)).map((result) => result.jobId),
  ]);
  const providerWaitingJobs = new Set([
    ...(providerHealth.jobState?.degradedJobIds ?? []),
    ...jobResults.filter((result) => result.status === "degraded").map((result) => result.jobId),
  ]);
  const adapterStatusCursors = [...new Set(jobResults
    .map((result) => result.adapterStatusProbe?.resumeCursor)
    .filter(Boolean))].sort();
  const idempotencyKeys = [...new Set(jobResults
    .map((result) => result.state?.idempotencyKey)
    .filter(Boolean))].sort();
  const checkpointKeys = [...new Set(jobResults
    .map((result) => result.state?.checkpointKey)
    .filter(Boolean))].sort();
  const requestedCapabilities = negotiation.requestedCapabilities ?? providerPreview.requestedCapabilities ?? [];
  const missingCapabilities = [
    ...(negotiation.missingWorkspaceCapabilities ?? []),
    ...(negotiation.unnegotiated ?? []),
    ...(providerPreview.missingWorkspaceCapabilities ?? []),
  ].filter(Boolean);
  const capabilityRows = [...new Set(requestedCapabilities)].sort().map((capability) => ({
    capability,
    negotiated: !missingCapabilities.includes(capability),
    source: capability.startsWith("mailchimp.") ? "mailchimp-adapter" : "runtime",
  }));
  const syncReady = sync.externalHandoff?.ready === true
    || sync.handoffReady === true
    || sync.syncHandoffReady === true
    || Boolean(sync.contractId && sync.cursor);
  const releaseAcceptanceReady = !releaseAcceptance.id || releaseAcceptance.ready === true;
  const lifecycleReady = lifecycle.valid === true
    && lifecycle.operatorControls?.runtimeStart?.enabled === true
    && lifecycleGate.releaseAllowed !== false
    && releaseAcceptanceReady;
  const tenantReady = tenantAuditHandoff.safeBoundary === true
    && tenantAuditHandoff.status !== "blocked";
  const providerReady = providerPreview.state === "ready"
    && providerHealth.status !== "unhealthy"
    && healthErrors.length === 0;
  const missingIntegrationFeatures = integration.validationSummary?.missingFeatures
    ?? providerPreview.integration?.missingFeatures
    ?? [];
  const waitingIntegrationFeatures = integration.validationSummary?.waitingFeatures
    ?? providerPreview.integration?.waitingFeatures
    ?? [];
  const integrationDeclared = Boolean(integration.id ?? providerPreview.integration?.id);
  const integrationReady = !integrationDeclared || integration.ready === true
    && integration.state !== "blocked"
    && missingIntegrationFeatures.length === 0;
  const capabilitiesReady = missingCapabilities.length === 0
    && providerCapabilityDryRunState?.status !== "blocked"
    && (["ready", "allow"].includes(negotiation.decision) || capabilityRows.every((row) => row.negotiated));
  const blocked = providerBlockedJobs.size > 0
    || providerReady === false
    || integrationReady === false
    || lifecycleReady === false
    || tenantReady === false
    || capabilitiesReady === false;
  const waiting = !blocked && (
    providerWaitingJobs.size > 0
    || waitingIntegrationFeatures.length > 0
    || tenantAuditHandoff.status === "needs-approval"
    || providerPreview.state === "waiting-for-approval"
    || lifecycle.nextAction?.state === "waiting"
  );
  const state = blocked ? "blocked" : waiting ? "waiting" : "ready";
  const blockers = [
    ...(providerReady ? [] : ["provider-health"]),
    ...(integrationReady ? [] : ["provider-integration"]),
    ...(capabilitiesReady ? [] : ["capability-negotiation"]),
    ...(syncReady ? [] : ["provider-sync"]),
    ...(tenantReady ? [] : ["tenant-audit-boundary"]),
    ...(lifecycleReady ? [] : ["lifecycle-release-gate"]),
    ...[...providerBlockedJobs].map((jobId) => `job:${jobId}`),
  ];
  const nextAction = blockers.includes("provider-health")
    ? providerHealth.nextAction || "repair-provider-handoff"
    : blockers.includes("provider-integration")
      ? integration.nextAction ?? providerPreview.integration?.nextAction ?? "repair-provider-integration-contract"
      : blockers.includes("capability-negotiation")
        ? "negotiate-provider-capabilities"
        : blockers.includes("provider-sync")
          ? "refresh-provider-sync-before-release"
          : blockers.includes("tenant-audit-boundary")
            ? tenantAuditHandoff.handoff?.nextAction || "resolve-tenant-permission-boundary"
            : blockers.includes("lifecycle-release-gate")
              ? lifecycle.nextAction?.action || "repair-lifecycle-settings"
              : waiting
                ? waitingIntegrationFeatures.length > 0
                  ? "wait-for-provider-integration"
                  : "collect-approval-before-provider-release"
                : "release-provider-handoff";

  return {
    protocol: "aios.mailchimp.provider-release-contract.v1",
    id: stableId("providerrelease", [
      plan.id,
      providerPreview.handoffId,
      providerHealth.id,
      state,
      blockers.join(","),
    ]),
    planId: plan.id,
    provider: "mailchimp",
    service: plan.providerService?.service ?? "mailchimp-marketing-api",
    state,
    ready: state === "ready",
    nextAction,
    externalHandoff: {
      state: providerPreview.state,
      handoffId: providerPreview.handoffId,
      releaseCommandId: providerPreview.releaseCommandId,
      blockedReason: providerPreview.blockedReason,
      adapterStatusResumeCursors: adapterStatusCursors,
      idempotencyKeys,
      checkpointKeys,
      dryRunOnly: true,
      externalWritesPerformed: false,
    },
    sync: {
      ready: syncReady,
      contractId: sync.contractId ?? null,
      cursor: sync.cursor ?? null,
      mode: sync.mode ?? "push",
      handoffMode: sync.handoffMode ?? "adapter",
      requiredFacts: sync.requiredFacts ?? [],
      requiredProviderCapabilities: sync.requiredProviderCapabilities ?? [],
      externalHandoff: sync.externalHandoff ?? null,
    },
    providerIntegration: {
      ready: integrationReady,
      contractId: integration.id ?? providerPreview.integration?.id ?? null,
      state: integration.state ?? providerPreview.integration?.state ?? "unknown",
      nextAction: integration.nextAction ?? providerPreview.integration?.nextAction ?? null,
      serviceLevel: integration.serviceLevel ?? providerPreview.integration?.serviceLevel ?? null,
      missingFeatures: [...new Set(missingIntegrationFeatures)].sort(),
      waitingFeatures: [...new Set(waitingIntegrationFeatures)].sort(),
      batchLimited: integration.validationSummary?.batchLimited === true
        || providerPreview.integration?.batchLimited === true,
      staleStatusRisk: integration.validationSummary?.staleStatusRisk === true
        || providerPreview.integration?.staleStatusRisk === true,
    },
    capabilityNegotiation: {
      decision: negotiation.decision ?? "unknown",
      ready: capabilitiesReady,
      requested: [...new Set(requestedCapabilities)].sort(),
      missing: [...new Set(missingCapabilities)].sort(),
      rows: capabilityRows,
      dryRunStateId: providerCapabilityDryRunState?.id ?? null,
      dryRunState: providerCapabilityDryRunState?.status ?? providerPreview.capabilityReplay?.state ?? "unknown",
      dryRunReady: providerCapabilityDryRunState?.ready === true,
      dryRunResumeCursor: providerCapabilityDryRunState?.resumeCursor ?? providerPreview.capabilityReplay?.resumeCursor ?? null,
      dryRunCommandIds: providerCapabilityDryRunState?.commands?.map((command) => command.id)
        ?? providerPreview.capabilityReplay?.commandIds
        ?? [],
    },
    releaseGates: {
      providerHealthy: providerReady,
      syncReady,
      capabilitiesReady,
      providerIntegrationReady: integrationReady,
      lifecycleReady,
      releaseAcceptanceReady,
      tenantReady,
      lifecycleGateId: lifecycleGate.id ?? null,
      lifecycleGateState: lifecycleGate.state ?? "unknown",
      releaseAcceptanceId: releaseAcceptance.id ?? null,
      releaseAcceptanceState: releaseAcceptance.state ?? "unknown",
      tenantIsolationKey: tenantAuditHandoff.isolationKey,
    },
    validationSummary: {
      blocked: blockers.length,
      warnings: healthWarnings.length + providerWaitingJobs.size,
      blockedJobIds: [...providerBlockedJobs].sort(),
      waitingJobIds: [...providerWaitingJobs].sort(),
      healthErrorCodes: healthErrors.map((error) => error.code),
      healthWarningCodes: healthWarnings.map((error) => error.code),
      missingCapabilities: [...new Set(missingCapabilities)].sort(),
      missingProviderFeatures: [...new Set(missingIntegrationFeatures)].sort(),
      waitingProviderFeatures: [...new Set(waitingIntegrationFeatures)].sort(),
      providerCapabilityReplayStatus: providerCapabilityDryRunState?.status ?? providerPreview.capabilityReplay?.state ?? "unknown",
      providerCapabilityReplayReady: providerCapabilityDryRunState?.ready === true,
      providerCapabilityHeld: providerCapabilityDryRunState?.heldCapabilities ?? providerPreview.capabilityReplay?.heldCapabilities ?? [],
      releaseAcceptanceBlockedOperationIds: releaseAcceptance.clientPatch?.releaseAcceptanceBlockedOperationIds ?? [],
      releaseAcceptanceReviewOperationIds: releaseAcceptance.clientPatch?.releaseAcceptanceReviewOperationIds ?? [],
    },
    clientPatch: {
      providerReleaseContractId: stableId("providerreleasepatch", [plan.id, providerPreview.handoffId, state]),
      providerReleaseState: state,
      providerReleaseReady: state === "ready",
      providerReleaseNextAction: nextAction,
      providerReleaseBlockedJobIds: [...providerBlockedJobs].sort(),
      providerReleaseWaitingJobIds: [...providerWaitingJobs].sort(),
      providerReleaseMissingCapabilities: [...new Set(missingCapabilities)].sort(),
      providerReleaseMissingFeatures: [...new Set(missingIntegrationFeatures)].sort(),
      providerReleaseWaitingFeatures: [...new Set(waitingIntegrationFeatures)].sort(),
      providerCapabilityReplayId: providerCapabilityDryRunState?.id ?? providerPreview.capabilityReplay?.id ?? null,
      providerCapabilityReplayStatus: providerCapabilityDryRunState?.status ?? providerPreview.capabilityReplay?.state ?? "unknown",
      providerCapabilityReplayReady: providerCapabilityDryRunState?.ready === true,
      providerCapabilityReplayNextAction: providerCapabilityDryRunState?.clientPatch?.providerCapabilityReplayNextAction
        ?? providerPreview.capabilityReplay?.nextAction
        ?? "review-provider-capability-replay",
      providerReleaseAcceptanceId: releaseAcceptance.id ?? null,
      providerReleaseAcceptanceState: releaseAcceptance.state ?? "unknown",
      providerReleaseResumeCursors: adapterStatusCursors,
    },
  };
}

function buildReleaseAcceptanceDryRun(plan, providerReleaseContract, acceptancePreview, jobResults) {
  const source = plan.releaseAcceptanceContract
    ?? plan.package?.releaseAcceptanceContract
    ?? plan.package?.lifecycleControls?.releaseAcceptance
    ?? {};
  const rowsByOperationId = new Map((source.operationRows ?? []).map((row) => [row.operationId, row]));
  const jobRows = jobResults.map((result, index) => {
    const operationRow = rowsByOperationId.get(result.state?.statusProjection?.operationId)
      ?? [...rowsByOperationId.values()].find((row) => row.operation === result.operation)
      ?? {};
    const blocked = ["blocked", "skipped"].includes(result.status)
      || operationRow.state === "blocked"
      || providerReleaseContract.ready !== true;
    const waiting = !blocked && (result.status === "degraded" || operationRow.state === "review");
    return {
      sequence: index + 1,
      jobId: result.jobId,
      operation: result.operation,
      state: blocked ? "blocked" : waiting ? "waiting" : "ready",
      releaseOperationState: operationRow.state ?? "unknown",
      statusCommandId: operationRow.statusCommandId ?? result.adapterStatusProbe?.statusCommandId ?? null,
      checkpointKey: operationRow.checkpointKey ?? result.state?.checkpointKey ?? null,
      idempotencyKey: operationRow.idempotencyKey ?? result.state?.idempotencyKey ?? null,
      adapterStatusResumeCursor: result.adapterStatusProbe?.resumeCursor ?? null,
      nextAction: blocked
        ? operationRow.nextAction ?? providerReleaseContract.nextAction ?? "repair-release-acceptance"
        : waiting
          ? "review-release-acceptance"
          : "accept-release-operation",
    };
  });
  const blockedRows = jobRows.filter((row) => row.state === "blocked");
  const waitingRows = jobRows.filter((row) => row.state === "waiting");
  const accepted = source.ready === true
    && providerReleaseContract.ready === true
    && acceptancePreview.accepted === true
    && blockedRows.length === 0
    && waitingRows.length === 0;
  const state = accepted
    ? "accepted"
    : blockedRows.length > 0 || source.state === "blocked" || source.state === "disabled"
      ? "blocked"
      : waitingRows.length > 0 || source.state === "review" || source.state === "scheduled"
        ? "waiting"
        : "ready";
  return {
    protocol: "aios.mailchimp.dry-run-release-acceptance.v1",
    id: stableId("dryreleaseaccept", [
      plan.id,
      source.id,
      providerReleaseContract.id,
      state,
      jobRows.map((row) => `${row.jobId}:${row.state}`).join(","),
    ]),
    sourceContractId: source.id ?? null,
    state,
    ready: state === "ready" || state === "accepted",
    accepted,
    visibleStatus: accepted
      ? "release-accepted-for-runtime"
      : state === "blocked"
        ? "release-acceptance-blocked"
        : state === "waiting"
          ? "release-acceptance-waiting"
          : "ready-to-accept-release",
    nextAction: accepted
      ? "release-runtime-handoff"
      : blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? source.nextAction
        ?? "persist-release-acceptance",
    command: {
      commandId: source.command?.id ?? null,
      idempotencyKey: source.command?.idempotencyKey ?? null,
      statusAfterReplay: accepted ? "dry-run-release-accepted" : source.command?.statusAfterReplay ?? state,
      externalWritesPerformed: false,
    },
    validationSummary: {
      providerReleaseReady: providerReleaseContract.ready === true,
      operatorAccepted: acceptancePreview.accepted === true,
      sourceState: source.state ?? "unknown",
      blockedJobIds: blockedRows.map((row) => row.jobId),
      waitingJobIds: waitingRows.map((row) => row.jobId),
      requiredInputNames: source.requiredInputs?.filter((input) => input.required).map((input) => input.name) ?? [],
    },
    rows: jobRows,
    clientPatch: {
      dryRunReleaseAcceptanceId: source.id ?? null,
      dryRunReleaseAcceptanceState: state,
      dryRunReleaseAcceptanceReady: state === "ready" || state === "accepted",
      dryRunReleaseAcceptanceAccepted: accepted,
      dryRunReleaseAcceptanceNextAction: accepted ? "release-runtime-handoff" : source.nextAction ?? "persist-release-acceptance",
      dryRunReleaseAcceptanceBlockedJobs: blockedRows.map((row) => row.jobId),
      dryRunReleaseAcceptanceWaitingJobs: waitingRows.map((row) => row.jobId),
    },
  };
}

function buildAcceptancePreview(plan, lifecycle, jobResults) {
  const acceptance = plan.acceptanceContract ?? {};
  const readiness = plan.readinessSummary ?? {};
  const failedLifecycle = lifecycle.validationIssues.find((issue) => issue.severity === "error");
  const blockedJobs = jobResults.filter((result) => ["blocked", "skipped"].includes(result.status));
  const degradedJobs = jobResults.filter((result) => result.status === "degraded");
  const accepted = acceptance.canAccept === true
    && lifecycle.valid
    && blockedJobs.length === 0
    && degradedJobs.length === 0;
  return {
    id: stableId("acceptpreview", [
      plan.id,
      acceptance.id,
      lifecycle.nextAction.state,
      jobResults.map((result) => `${result.jobId}:${result.status}`).join(","),
    ]),
    accepted,
    status: accepted
      ? "dry-run-acceptance-ready"
      : failedLifecycle
        ? "dry-run-acceptance-lifecycle-blocked"
        : degradedJobs.length > 0
          ? "dry-run-acceptance-waiting"
          : "dry-run-acceptance-blocked",
    visibleStatus: accepted
      ? "ready-to-accept"
      : failedLifecycle
        ? "repair-lifecycle-settings"
        : degradedJobs.length > 0
          ? "waiting-for-approval"
          : acceptance.clientPreview?.visibleStatus ?? "blocked-before-acceptance",
    primaryAction: accepted
      ? acceptance.clientPreview?.primaryAction ?? "Accept Mailchimp handoff"
      : failedLifecycle
        ? "Repair lifecycle settings"
        : degradedJobs.length > 0
          ? "Collect approval"
          : "Review required actions",
    nextAction: failedLifecycle?.action
      ?? lifecycle.nextAction.action
      ?? acceptance.clientPreview?.nextAction
      ?? readiness.nextAction
      ?? "review-dry-run",
    readiness: {
      id: readiness.id ?? null,
      status: readiness.status ?? "unknown",
      checks: readiness.checks ?? [],
      missingSyncFacts: readiness.missingSyncFacts ?? [],
      requiredSyncFacts: readiness.requiredSyncFacts ?? [],
    },
    validationSummary: {
      acceptanceStatus: acceptance.status ?? "unknown",
      lifecycleValid: lifecycle.valid,
      lifecycleIssueCodes: lifecycle.validationIssues.map((issue) => issue.code),
      blockedJobIds: blockedJobs.map((result) => result.jobId),
      degradedJobIds: degradedJobs.map((result) => result.jobId),
      requiredInputNames: (acceptance.requiredInputs ?? []).filter((input) => input.required).map((input) => input.name),
    },
    requiredInputs: acceptance.requiredInputs ?? [],
    handoffId: acceptance.clientPreview?.handoffId ?? plan.providerService?.externalHandoff?.handoffId ?? null,
  };
}

function buildAcceptanceReceiptContract(plan, lifecycle, acceptancePreview, jobResults) {
  const requiredInputs = acceptancePreview.requiredInputs ?? [];
  const missingInputs = requiredInputs
    .filter((input) => input.required === true && !input.value && input.accepted !== true && input.status !== "accepted")
    .map((input) => input.name)
    .filter(Boolean)
    .sort();
  const blockedJobs = acceptancePreview.validationSummary.blockedJobIds ?? [];
  const degradedJobs = acceptancePreview.validationSummary.degradedJobIds ?? [];
  const lifecycleIssues = lifecycle.validationIssues ?? [];
  const blockingLifecycleIssues = lifecycleIssues.filter((issue) => issue.severity === "error");
  const validationRows = [
    {
      code: "dry-run.acceptance.lifecycle",
      status: blockingLifecycleIssues.length === 0 ? "pass" : "fail",
      owner: "operator",
      nextAction: blockingLifecycleIssues[0]?.action ?? lifecycle.nextAction?.action ?? "review-lifecycle-controls",
      detail: blockingLifecycleIssues.length === 0
        ? "Lifecycle controls allow preview acceptance."
        : "Lifecycle controls must be repaired before preview acceptance.",
    },
    {
      code: "dry-run.acceptance.jobs",
      status: blockedJobs.length === 0 ? "pass" : "fail",
      owner: "runtime",
      nextAction: blockedJobs.length === 0 ? "continue-preview-acceptance" : "repair-blocked-jobs",
      detail: blockedJobs.length === 0
        ? "No dry-run jobs block preview acceptance."
        : `Blocked jobs: ${blockedJobs.join(", ")}.`,
    },
    {
      code: "dry-run.acceptance.approvals",
      status: degradedJobs.length === 0 ? "pass" : "pending",
      owner: "operator",
      nextAction: degradedJobs.length === 0 ? "continue-preview-acceptance" : "collect-approval",
      detail: degradedJobs.length === 0
        ? "No degraded jobs require approval."
        : `Approval is pending for jobs: ${degradedJobs.join(", ")}.`,
    },
    {
      code: "dry-run.acceptance.required-inputs",
      status: missingInputs.length === 0 ? "pass" : "pending",
      owner: "operator",
      nextAction: missingInputs.length === 0 ? "continue-preview-acceptance" : "collect-preview-inputs",
      detail: missingInputs.length === 0
        ? "Required preview inputs are present."
        : `Required preview inputs are missing: ${missingInputs.join(", ")}.`,
    },
  ];
  const blockingRows = validationRows.filter((row) => row.status === "fail");
  const pendingRows = validationRows.filter((row) => row.status === "pending");
  const accepted = acceptancePreview.accepted === true && blockingRows.length === 0 && pendingRows.length === 0;
  const status = accepted
    ? "accepted"
    : blockingRows.length > 0
      ? "blocked"
      : pendingRows.length > 0
        ? "waiting"
        : "ready";
  const receiptId = stableId("acceptreceipt", [
    plan.id,
    acceptancePreview.id,
    status,
    validationRows.map((row) => `${row.code}:${row.status}`).join(","),
  ]);
  const acceptanceToken = stableId("accepttoken", [
    plan.id,
    acceptancePreview.handoffId,
    receiptId,
    jobResults.map((result) => `${result.jobId}:${result.status}`).join(","),
  ]);

  return {
    schemaVersion: "aios.mailchimp.dry-run-acceptance-receipt.v1",
    id: receiptId,
    planId: plan.id,
    previewId: acceptancePreview.id,
    acceptanceToken,
    status,
    accepted,
    readyForRuntimeStart: accepted && lifecycle.operatorControls?.runtimeStart?.enabled === true,
    visibleStatus: accepted
      ? "accepted-for-runtime"
      : status === "blocked"
        ? "acceptance-blocked"
        : status === "waiting"
          ? "acceptance-waiting"
          : "ready-for-operator-acceptance",
    nextAction: blockingRows[0]?.nextAction
      ?? pendingRows[0]?.nextAction
      ?? (accepted ? "release-runtime-handoff" : "request-operator-acceptance"),
    validationSummary: {
      total: validationRows.length,
      passed: validationRows.filter((row) => row.status === "pass").length,
      blocked: blockingRows.length,
      pending: pendingRows.length,
      blockedJobIds: blockedJobs,
      degradedJobIds: degradedJobs,
      missingInputNames: missingInputs,
      lifecycleIssueCodes: lifecycleIssues.map((issue) => issue.code),
    },
    validationRows,
    clientPatch: {
      dryRunAcceptanceReceiptId: receiptId,
      dryRunAcceptanceToken: acceptanceToken,
      dryRunAcceptanceStatus: status,
      dryRunAcceptanceVisibleStatus: accepted ? "accepted-for-runtime" : acceptancePreview.visibleStatus,
      dryRunAcceptanceNextAction: blockingRows[0]?.nextAction
        ?? pendingRows[0]?.nextAction
        ?? (accepted ? "release-runtime-handoff" : acceptancePreview.nextAction),
      runtimeStartEnabledAfterAcceptance: accepted && lifecycle.operatorControls?.runtimeStart?.enabled === true,
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-dry-run-acceptance-token",
      resumeFromAcceptanceToken: acceptanceToken,
      externalWritesPerformed: false,
    },
  };
}

function buildAcceptanceCommandReleaseGate(plan, lifecycle, acceptancePreview, jobResults) {
  const receipt = acceptancePreview.receipt ?? {};
  const runtime = plan.claimGate?.clientRuntime ?? {};
  const tenantId = runtime.tenantId ?? "tenant.local";
  const workspaceId = runtime.workspaceId ?? "workspace.local";
  const lifecycleOpen = lifecycle.operatorControls?.runtimeStart?.enabled === true;
  const accepted = receipt.accepted === true;
  const rows = jobResults.map((result, index) => {
    const failedCheck = result.health.checks.find((check) => check.status === "fail");
    const degradedCheck = result.health.checks.find((check) => check.status === "degraded");
    const commandLease = result.state.commandLeaseReplay ?? {};
    const commandId = stableId("acceptcmd", [
      plan.id,
      result.jobId,
      receipt.acceptanceToken,
      commandLease.id,
      index,
    ]);
    const blocked = result.status === "blocked"
      || result.status === "skipped"
      || Boolean(failedCheck)
      || receipt.status === "blocked";
    const waiting = !blocked && (
      result.status === "degraded"
      || Boolean(degradedCheck)
      || accepted !== true
      || lifecycleOpen !== true
      || commandLease.ackRequired === true
    );
    const state = blocked ? "blocked" : waiting ? "waiting" : "releasable";
    const nextAction = blocked
      ? failedCheck?.name === "tenant-permission"
        ? "resolve-tenant-permission-boundary"
        : failedCheck?.name === "truth-boundary"
          ? "provide-missing-mailchimp-evidence"
          : "repair-acceptance-command-before-release"
      : waiting
        ? accepted !== true
          ? receipt.nextAction ?? "request-operator-acceptance"
          : lifecycleOpen !== true
            ? lifecycle.nextAction?.action ?? "enable-runtime-start"
            : commandLease.ackRequired === true
              ? "acknowledge-command-lease"
              : degradedCheck?.name === "tenant-permission"
                ? "collect-tenant-approval"
                : "wait-for-acceptance-release"
        : "release-accepted-runtime-command";

    return {
      jobId: result.jobId,
      operation: result.operation,
      commandId,
      state,
      accepted,
      nextAction,
      visibleStatus: state === "releasable"
        ? "accepted-command-ready"
        : state === "waiting"
          ? "accepted-command-waiting"
          : "accepted-command-blocked",
      idempotencyKey: stableId("acceptkey", [
        plan.id,
        result.jobId,
        receipt.acceptanceToken,
        result.state.idempotencyKey,
      ]),
      resumeCursor: stableId("acceptcursor", [
        plan.id,
        result.jobId,
        receipt.acceptanceToken,
        result.state.restartReplay?.replayCursor,
      ]),
      checkpointKey: result.state.checkpointKey ?? null,
      commandLeaseId: commandLease.id ?? null,
      ackRequired: commandLease.ackRequired === true,
      blocker: failedCheck?.name ?? null,
      pauseReason: waiting ? degradedCheck?.name ?? (accepted ? "runtime-release-gate" : "acceptance-required") : null,
    };
  });
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const releasableRows = rows.filter((row) => row.state === "releasable");
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "releasable";
  const primaryRow = blockedRows[0] ?? waitingRows[0] ?? releasableRows[0] ?? null;

  return {
    protocol: "aios.mailchimp.dry-run-acceptance-command-release.v1",
    id: stableId("acceptrelease", [
      plan.id,
      receipt.acceptanceToken,
      status,
      rows.map((row) => `${row.jobId}:${row.state}`).join(","),
    ]),
    planId: plan.id,
    status,
    accepted,
    ready: status === "releasable",
    nextAction: primaryRow?.nextAction
      ?? (accepted ? "release-accepted-runtime-command" : receipt.nextAction ?? "request-operator-acceptance"),
    acceptanceToken: receipt.acceptanceToken ?? null,
    receiptId: receipt.id ?? null,
    tenantId,
    workspaceId,
    lifecycleRuntimeStartEnabled: lifecycleOpen,
    counts: {
      total: rows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      releasable: releasableRows.length,
      ackRequired: rows.filter((row) => row.ackRequired).length,
    },
    commandIds: rows.map((row) => row.commandId),
    resumeCursors: rows.map((row) => row.resumeCursor),
    rows,
    clientPatch: {
      acceptanceCommandReleaseStatus: status,
      acceptanceCommandReleaseReady: status === "releasable",
      acceptanceCommandReleaseNextAction: primaryRow?.nextAction ?? null,
      acceptanceCommandReleaseId: primaryRow?.commandId ?? null,
      acceptanceCommandReleaseBlockedJobs: blockedRows.map((row) => row.jobId),
      acceptanceCommandReleaseWaitingJobs: waitingRows.map((row) => row.jobId),
    },
    restartSemantics: {
      replaySafe: blockedRows.length === 0,
      duplicateCommandPolicy: "dedupe-by-dry-run-acceptance-command",
      resumeFromAcceptanceToken: receipt.acceptanceToken ?? null,
      externalWritesPerformed: false,
    },
  };
}

function buildLifecycleSettingsAdoptionDryRun(plan, lifecycle, jobResults, providerPreview) {
  const source = plan.lifecycleSettingsAdoption
    ?? plan.package?.lifecycleSettingsAdoption
    ?? plan.package?.lifecycleControls?.settingsAdoption
    ?? {};
  const sourceRows = Array.isArray(source.rows) ? source.rows : [];
  const runtimeStartEnabled = lifecycle.operatorControls?.runtimeStart?.enabled === true;
  const blockedJobIds = jobResults
    .filter((result) => ["blocked", "skipped"].includes(result.status))
    .map((result) => result.jobId);
  const waitingJobIds = jobResults
    .filter((result) => result.status === "degraded")
    .map((result) => result.jobId);
  const rows = sourceRows.map((row, index) => {
    const blockedByDryRun = row.key === "enabled" && runtimeStartEnabled === false;
    const waitingByProvider = row.key === "sync-handoff" && ["scheduled", "waiting"].includes(providerPreview.state);
    const state = blockedByDryRun
      ? "blocked"
      : waitingByProvider
        ? "waiting"
        : row.state === "blocked"
          ? "blocked"
          : ["waiting", "review"].includes(row.state)
            ? row.state
            : "ready";
    return {
      sequence: index + 1,
      key: row.key,
      setting: row.setting,
      value: row.value,
      state,
      sourceState: row.state,
      nextAction: state === "ready" ? "return-existing-lifecycle-setting" : row.nextAction,
      commandId: row.commandId ?? source.command?.id ?? null,
      dryRun: {
        persisted: false,
        externalWritesPerformed: false,
        overriddenByRuntimeStart: blockedByDryRun,
        providerWaiting: waitingByProvider,
      },
    };
  });
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const reviewRows = rows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0 || blockedJobIds.length > 0
    ? "blocked"
    : waitingRows.length > 0 || waitingJobIds.length > 0
      ? "waiting"
      : reviewRows.length > 0
        ? "review"
        : source.ready === true
          ? "ready"
          : "review";
  const commandId = source.command?.id
    ?? lifecycle.commands?.find((command) => command.type === "persist-lifecycle-controls")?.id
    ?? null;
  return {
    protocol: "aios.mailchimp.dry-run-lifecycle-settings-adoption.v1",
    id: stableId("drysettings", [
      plan.id,
      source.id,
      state,
      rows.map((row) => `${row.key}:${row.state}`).join(","),
    ]),
    sourceContractId: source.id ?? null,
    product: "mailchimp",
    state,
    ready: state === "ready" || state === "review",
    visibleStatus: state === "ready"
      ? "lifecycle-settings-ready"
      : state === "waiting"
        ? "lifecycle-settings-waiting"
        : state === "review"
          ? "review-lifecycle-settings"
          : "repair-lifecycle-settings",
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? source.nextAction
      ?? "review-lifecycle-settings",
    command: {
      commandId,
      sourceCommandId: source.command?.id ?? null,
      wouldPersist: false,
      idempotencyKey: source.command?.idempotencyKey ?? null,
      statusAfterReplay: state === "ready" ? "lifecycle-settings-adopted" : `lifecycle-settings-${state}`,
    },
    settings: source.settings ?? lifecycle.settings ?? {},
    rows,
    validationSummary: {
      blockedKeys: blockedRows.map((row) => row.key),
      waitingKeys: waitingRows.map((row) => row.key),
      reviewKeys: reviewRows.map((row) => row.key),
      blockedJobIds,
      waitingJobIds,
      runtimeStartEnabled,
      providerState: providerPreview.state,
    },
    clientPatch: {
      lifecycleSettingsDryRunId: stableId("drysettingspatch", [plan.id, source.id, state]),
      lifecycleSettingsDryRunState: state,
      lifecycleSettingsDryRunReady: state === "ready" || state === "review",
      lifecycleSettingsDryRunNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "review-lifecycle-settings",
      lifecycleSettingsBlockedKeys: blockedRows.map((row) => row.key),
      lifecycleSettingsWaitingKeys: waitingRows.map((row) => row.key),
      lifecycleSettingsReviewKeys: reviewRows.map((row) => row.key),
    },
    dryRunGuarantee: {
      externalWritesPerformed: false,
      settingsPersisted: false,
      restartSafe: state !== "blocked",
    },
  };
}

function buildClientRuntimeHandoff(
  plan,
  lifecycle,
  lifecycleRuntimeControlDryRun,
  providerPreview,
  acceptancePreview,
  jobResults,
  settingsAdoptionDryRun,
) {
  const sync = plan.providerService?.sync ?? {};
  const claimRuntime = plan.claimGate?.clientRuntime ?? {};
  const claimAcceptance = plan.claimGate?.claimAcceptance ?? plan.providerService?.claimReporting?.acceptance ?? {};
  const packageLifecycle = plan.package?.lifecycleControls ?? {};
  const resumableJobs = jobResults.filter((result) => Boolean(result.adapterStatusProbe?.resumeCursor));
  const clientOperationStates = jobResults
    .map((result) => result.state.clientOperationState)
    .filter(Boolean);
  const restartReplays = jobResults
    .map((result) => result.state.restartReplay)
    .filter(Boolean);
  const commandLeaseReplays = jobResults
    .map((result) => result.state.commandLeaseReplay)
    .filter(Boolean);
  const acceptanceCommands = jobResults
    .map((result) => result.state.acceptanceCommand)
    .filter(Boolean);
  const acceptanceCommandRelease = acceptancePreview.commandRelease ?? {};
  const commandLeaseReplaySnapshot = buildCommandLeaseReplayExportSnapshot({
    leases: commandLeaseReplays,
    status: commandLeaseReplays.some((lease) => lease.blocksRuntimeStart)
      ? "blocked"
      : commandLeaseReplays.some((lease) => lease.ackRequired)
        ? "waiting-for-client-ack"
        : "ready",
    ready: commandLeaseReplays.every((lease) => lease.blocksRuntimeStart !== true),
    resumeToken: plan.restartProjection?.replayCursor,
  });
  const runtimeControlBlocked = lifecycleRuntimeControlDryRun?.state === "blocked";
  const runtimeControlWaiting = lifecycleRuntimeControlDryRun?.state === "waiting";
  const state = runtimeControlBlocked
    ? "blocked"
    : runtimeControlWaiting
      ? "waiting-for-runtime-control"
      : acceptancePreview.accepted
        ? "ready"
        : acceptancePreview.visibleStatus === "waiting-for-approval"
          ? "waiting-for-approval"
          : acceptancePreview.visibleStatus === "repair-lifecycle-settings"
            ? "blocked"
            : providerPreview.state === "ready"
              ? "review"
              : providerPreview.state ?? "unknown";
  const visibleStatus = runtimeControlBlocked || runtimeControlWaiting
    ? lifecycleRuntimeControlDryRun.visibleStatus
    : acceptancePreview.visibleStatus;
  const primaryAction = runtimeControlBlocked || runtimeControlWaiting
    ? lifecycleRuntimeControlDryRun.nextAction
    : acceptancePreview.primaryAction;
  return {
    id: stableId("clienthandoff", [
      plan.id,
      claimRuntime.clientStateKey,
      acceptancePreview.id,
      lifecycle.nextAction.commandId,
    ]),
    product: "mailchimp",
    state,
    visibleStatus,
    primaryAction,
    acceptanceReceipt: acceptancePreview.receipt ?? null,
    acceptanceCommandRelease,
    requestId: claimRuntime.requestId,
    workflowId: claimRuntime.workflowId,
    tenantId: claimRuntime.tenantId,
    workspaceId: claimRuntime.workspaceId,
    clientStateKey: claimRuntime.clientStateKey,
    continuationToken: claimRuntime.continuationToken,
    provider: {
      state: providerPreview.state,
      handoffId: providerPreview.handoffId,
      releaseCommandId: providerPreview.releaseCommandId,
      lifecycleGate: providerPreview.lifecycleGate,
      capabilityDecision: providerPreview.capabilityDecision,
      requestedCapabilities: providerPreview.requestedCapabilities,
      missingWorkspaceCapabilities: providerPreview.missingWorkspaceCapabilities,
      health: providerPreview.health,
    },
    sync: {
      contractId: sync.contractId ?? null,
      provider: sync.provider ?? "mailchimp-marketing",
      mode: sync.mode ?? "push",
      handoffMode: sync.handoffMode ?? "adapter",
      conflictPolicy: sync.conflictPolicy ?? "manual-review",
      cursor: sync.cursor ?? null,
      objectBindings: sync.objectBindings ?? {},
      requiredFacts: sync.requiredFacts ?? [],
      requiredProviderCapabilities: sync.requiredProviderCapabilities ?? [],
      externalHandoff: sync.externalHandoff ?? null,
    },
    claimAcceptance: {
      id: claimAcceptance.id ?? null,
      status: claimAcceptance.status ?? "unknown",
      visibleStatus: claimAcceptance.visibleStatus ?? "claim-preview-unavailable",
      nextAction: claimAcceptance.nextAction ?? "review-claim-preview",
      acceptanceToken: claimAcceptance.acceptanceToken ?? null,
      canAcknowledge: claimAcceptance.canAcknowledge === true,
      requiredInputNames: claimAcceptance.acknowledgement?.requiredInputs
        ?.filter((input) => input.required)
        .map((input) => input.name)
        ?? claimAcceptance.requiredInputNames
        ?? [],
    },
    lifecycle: {
      dryRunCommandIds: lifecycle.commands.map((command) => command.id),
      nextAction: lifecycle.nextAction,
      packageStateId: packageLifecycle.stateId ?? null,
      packageCommandIds: packageLifecycle.commands?.map((command) => command.id) ?? [],
      runtimeControl: {
        id: lifecycleRuntimeControlDryRun?.id ?? null,
        sourceControlId: lifecycleRuntimeControlDryRun?.sourceControlId ?? null,
        state: lifecycleRuntimeControlDryRun?.state ?? "unknown",
        ready: lifecycleRuntimeControlDryRun?.ready === true,
        releaseAllowed: lifecycleRuntimeControlDryRun?.releaseAllowed === true,
        visibleStatus: lifecycleRuntimeControlDryRun?.visibleStatus ?? "runtime-control-unavailable",
        nextAction: lifecycleRuntimeControlDryRun?.nextAction ?? "review-lifecycle-runtime-control",
        commandId: lifecycleRuntimeControlDryRun?.command?.commandId ?? null,
        blockedControlKeys: lifecycleRuntimeControlDryRun?.validationSummary?.blockedControlKeys ?? [],
        waitingControlKeys: lifecycleRuntimeControlDryRun?.validationSummary?.waitingControlKeys ?? [],
        blockedJobIds: lifecycleRuntimeControlDryRun?.validationSummary?.blockedJobIds ?? [],
        waitingJobIds: lifecycleRuntimeControlDryRun?.validationSummary?.waitingJobIds ?? [],
      },
      settingsAdoption: {
        id: settingsAdoptionDryRun?.id ?? null,
        sourceContractId: settingsAdoptionDryRun?.sourceContractId ?? null,
        state: settingsAdoptionDryRun?.state ?? "unknown",
        ready: settingsAdoptionDryRun?.ready === true,
        visibleStatus: settingsAdoptionDryRun?.visibleStatus ?? "lifecycle-settings-unavailable",
        nextAction: settingsAdoptionDryRun?.nextAction ?? "review-lifecycle-settings",
        commandId: settingsAdoptionDryRun?.command?.commandId ?? null,
        blockedKeys: settingsAdoptionDryRun?.validationSummary?.blockedKeys ?? [],
        waitingKeys: settingsAdoptionDryRun?.validationSummary?.waitingKeys ?? [],
        reviewKeys: settingsAdoptionDryRun?.validationSummary?.reviewKeys ?? [],
      },
    },
    resumability: {
      restartStatus: plan.restartProjection?.restartStatus,
      replayCursor: plan.restartProjection?.replayCursor,
      restartSafe: plan.restartProjection?.restartSafe,
      replayManifestIds: restartReplays
        .map((replay) => replay.sourceManifestId)
        .filter(Boolean),
      replayCursors: restartReplays
        .map((replay) => replay.replayCursor)
        .filter(Boolean),
      replayDecisions: restartReplays.reduce((counts, replay) => {
        counts[replay.replayDecision] = (counts[replay.replayDecision] ?? 0) + 1;
        return counts;
      }, {}),
      adapterStatusResumeCursors: resumableJobs.map((result) => result.adapterStatusProbe.resumeCursor),
      checkpointKeys: jobResults.map((result) => result.state.checkpointKey).filter(Boolean),
      clientOperationStateIds: clientOperationStates.map((state) => state.id),
      blockedClientOperationStateIds: clientOperationStates
        .filter((state) => state.workflowState === "blocked")
        .map((state) => state.id),
      clientCommandLeaseIds: commandLeaseReplays.map((lease) => lease.id),
      blockedClientCommandLeaseIds: commandLeaseReplays
        .filter((lease) => lease.blocksRuntimeStart)
        .map((lease) => lease.id),
      commandLeaseAckKeys: commandLeaseReplays
        .map((lease) => lease.ackKey)
        .filter(Boolean),
      commandLeaseReplayExportReady: commandLeaseReplaySnapshot.exportReady,
      commandLeaseReplayNextAction: commandLeaseReplaySnapshot.nextAction,
      acceptanceCommandReleaseStatus: acceptanceCommandRelease.status ?? "unknown",
      acceptanceCommandReleaseReady: acceptanceCommandRelease.ready === true,
      acceptanceCommandIds: acceptanceCommands.map((command) => command.commandId),
      blockedAcceptanceCommandIds: acceptanceCommands
        .filter((command) => command.state === "blocked")
        .map((command) => command.commandId),
      waitingAcceptanceCommandIds: acceptanceCommands
        .filter((command) => command.state === "waiting")
        .map((command) => command.commandId),
    },
    clientOperations: clientOperationStates.map((state) => ({
      id: state.id,
      jobId: state.jobId,
      operation: state.operation,
      workflowState: state.workflowState,
      visibleStatus: state.visibleStatus,
      nextAction: state.nextAction,
      operationStatusLedgerId: state.stateKeys.operationStatusLedgerId,
      adapterStatusResumeCursor: state.resume.adapterStatusResumeCursor,
      replayCursor: state.resume.replayCursor,
    })),
    commandLeases: commandLeaseReplays.map((lease) => ({
      id: lease.id,
      jobId: lease.jobId,
      commandId: lease.commandId,
      status: lease.status,
      visibleStatus: lease.statusProjection.visible,
      ackRequired: lease.ackRequired,
      ackKey: lease.ackKey,
      blocksRuntimeStart: lease.blocksRuntimeStart,
      replayCursor: lease.replay.replayCursor,
      nextAction: lease.nextAction,
    })),
    acceptanceCommands: acceptanceCommands.map((command) => ({
      jobId: command.jobId,
      commandId: command.commandId,
      state: command.state,
      visibleStatus: command.visibleStatus,
      nextAction: command.nextAction,
      idempotencyKey: command.idempotencyKey,
      resumeCursor: command.resumeCursor,
      ackRequired: command.ackRequired === true,
    })),
    commandLeaseReplayExport: commandLeaseReplaySnapshot,
    dryRunGuarantee: {
      externalWritesPerformed: false,
      adapterCallsPerformed: false,
      statusProbesPerformed: false,
      acceptanceReceiptExternalWritesPerformed: acceptancePreview.receipt?.restartSemantics?.externalWritesPerformed === true,
    },
  };
}

function buildRuntimeReleaseDecision(
  plan,
  status,
  lifecycle,
  lifecycleRuntimeControlDryRun,
  providerReleaseContract,
  tenantAuditHandoff,
  acceptancePreview,
  clientCommandLeaseReplay,
  commandLeaseReplayExport,
  operatorReleaseInstruction = plan.operatorRuntimeReleaseInstruction ?? plan.package?.operatorRuntimeReleaseInstruction,
) {
  const receipt = acceptancePreview.receipt ?? {};
  const commandRelease = acceptancePreview.commandRelease ?? {};
  const operatorInstruction = operatorReleaseInstruction ?? {};
  const lifecycleRuntimeStartEnabled = lifecycle.operatorControls?.runtimeStart?.enabled === true;
  const lifecycleControlBlocked = lifecycleRuntimeControlDryRun?.state === "blocked";
  const lifecycleControlWaiting = lifecycleRuntimeControlDryRun?.state === "waiting";
  const lifecycleBlocked = lifecycle.valid !== true || lifecycleRuntimeStartEnabled !== true || lifecycleControlBlocked;
  const operatorInstructionBlocked = operatorInstruction.state === "blocked";
  const operatorInstructionWaiting = operatorInstructionBlocked === false
    && ["waiting", "review"].includes(operatorInstruction.state);
  const providerBlocked = providerReleaseContract.ready !== true;
  const tenantBlocked = tenantAuditHandoff.safeBoundary !== true || tenantAuditHandoff.status === "blocked";
  const tenantWaiting = tenantBlocked === false && tenantAuditHandoff.status === "needs-approval";
  const acceptanceBlocked = receipt.status === "blocked" || commandRelease.status === "blocked";
  const acceptanceWaiting = acceptanceBlocked === false && (
    receipt.accepted !== true
    || receipt.readyForRuntimeStart !== true
    || commandRelease.status === "waiting"
  );
  const leaseBlocked = clientCommandLeaseReplay.counts?.blocking > 0
    || commandLeaseReplayExport.counters?.blocking > 0;
  const leaseWaiting = leaseBlocked === false && (
    clientCommandLeaseReplay.ack?.required === true
    || commandLeaseReplayExport.ack?.required === true
  );
  const analyticsReady = commandLeaseReplayExport.exportReady === true;
  const releaseRows = [
    {
      id: "lifecycle-runtime-start",
      state: lifecycleBlocked ? "blocked" : lifecycleControlWaiting ? "waiting" : "ready",
      owner: "operator",
      nextAction: lifecycleRuntimeControlDryRun?.nextAction || lifecycle.nextAction?.action || "review-lifecycle-controls",
      detail: lifecycleBlocked
        ? "Lifecycle controls do not currently allow runtime start."
        : lifecycleControlWaiting
          ? "Lifecycle runtime control is waiting before runtime start."
        : "Lifecycle controls allow runtime start.",
      commandId: lifecycleRuntimeControlDryRun?.command?.commandId ?? lifecycle.operatorControls?.runtimeStart?.commandId ?? null,
      blockingCodes: [
        ...(lifecycle.validationIssues
        .filter((issue) => issue.severity === "error")
          .map((issue) => issue.code)),
        ...(lifecycleRuntimeControlDryRun?.validationSummary?.blockedControlKeys ?? [])
          .map((key) => `runtime-control:${key}`),
      ],
    },
    {
      id: "provider-release-readiness",
      state: providerBlocked ? "blocked" : "ready",
      owner: "adapter",
      nextAction: providerReleaseContract.nextAction || "repair-provider-release-readiness",
      detail: providerBlocked
        ? "Provider release contract is not ready for runtime handoff."
        : "Provider release contract is ready for runtime handoff.",
      commandId: providerReleaseContract.externalHandoff?.releaseCommandId ?? null,
      blockingCodes: providerReleaseContract.validationSummary?.blockers ?? [],
    },
    {
      id: "tenant-audit-boundary",
      state: tenantBlocked ? "blocked" : tenantWaiting ? "waiting" : "ready",
      owner: "operator",
      nextAction: tenantAuditHandoff.handoff?.nextAction || "append-audit-before-runtime-release",
      detail: tenantBlocked
        ? "Tenant audit boundary blocks runtime release."
        : tenantWaiting
          ? "Tenant audit boundary is waiting for approval."
          : "Tenant audit boundary is ready.",
      commandId: null,
      blockingCodes: tenantBlocked ? tenantAuditHandoff.validation?.filter((row) => row.status === "fail").map((row) => row.code) ?? [] : [],
    },
    {
      id: "preview-acceptance",
      state: acceptanceBlocked ? "blocked" : acceptanceWaiting ? "waiting" : "ready",
      owner: "operator",
      nextAction: receipt.nextAction || acceptancePreview.nextAction || "request-operator-acceptance",
      detail: acceptanceBlocked
        ? "Preview acceptance blocks runtime release."
        : acceptanceWaiting
          ? "Preview acceptance is waiting for operator action or command release."
          : "Preview acceptance is ready for runtime release.",
      commandId: commandRelease.clientPatch?.acceptanceCommandReleaseId ?? null,
      blockingCodes: receipt.validationRows
        ?.filter((row) => row.status === "fail")
        .map((row) => row.code) ?? [],
    },
    {
      id: "client-command-lease-replay",
      state: leaseBlocked ? "blocked" : leaseWaiting ? "waiting" : "ready",
      owner: leaseWaiting ? "operator" : "runtime",
      nextAction: commandLeaseReplayExport.nextAction
        || clientCommandLeaseReplay.primaryAction
        || "refresh-client-command-lease-replay",
      detail: leaseBlocked
        ? "Client command leases block runtime start."
        : leaseWaiting
          ? "Client command lease acknowledgement is required."
          : "Client command leases are replay-safe for runtime release.",
      commandId: clientCommandLeaseReplay.primaryLeaseId ?? null,
      blockingCodes: commandLeaseReplayExport.jobIds?.blocking?.map((jobId) => `lease:${jobId}`) ?? [],
    },
    {
      id: "release-export",
      state: analyticsReady ? "ready" : "waiting",
      owner: "runtime",
      nextAction: commandLeaseReplayExport.nextAction || "publish-command-lease-replay-summary",
      detail: analyticsReady
        ? "Command lease replay export is ready."
        : "Command lease replay export must be refreshed before release.",
      commandId: null,
      blockingCodes: [],
    },
    {
      id: "operator-release-instruction",
      state: operatorInstructionBlocked
        ? "blocked"
        : operatorInstructionWaiting
          ? "waiting"
          : operatorInstruction.ready === true
            ? "ready"
            : "waiting",
      owner: operatorInstruction.owner ?? "operator",
      nextAction: operatorInstruction.nextAction || "review-operator-runtime-release",
      detail: operatorInstructionBlocked
        ? "Compiled operator release instruction blocks runtime release."
        : operatorInstructionWaiting
          ? "Compiled operator release instruction is waiting for a required acknowledgement."
          : operatorInstruction.ready === true
            ? "Compiled operator release instruction is ready."
            : "Compiled operator release instruction must be refreshed.",
      commandId: operatorInstruction.command?.id ?? null,
      blockingCodes: operatorInstruction.validationSummary?.blockedGateIds
        ?.map((gate) => `operator-release:${gate}`) ?? [],
      waitingCodes: operatorInstruction.validationSummary?.waitingGateIds
        ?.map((gate) => `operator-release:${gate}`) ?? [],
      requiredAcknowledgements: operatorInstruction.requiredAcknowledgements ?? [],
    },
  ];
  const blockedRows = releaseRows.filter((row) => row.state === "blocked");
  const waitingRows = releaseRows.filter((row) => row.state === "waiting");
  const state = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : status === "admitted"
        ? "ready"
        : "review";
  const primaryRow = blockedRows[0] ?? waitingRows[0] ?? releaseRows.find((row) => row.id === "preview-acceptance");
  const releaseToken = stableId("runtime-release", [
    plan.id,
    state,
    receipt.acceptanceToken,
    providerReleaseContract.id,
    clientCommandLeaseReplay.resumeToken,
    operatorInstruction.releaseToken,
  ]);
  const releaseCommandId = state === "ready"
    ? stableId("releasecmd", [releaseToken, "release-runtime-handoff"])
    : null;

  return {
    protocol: "aios.mailchimp.runtime-release-decision.v1",
    planId: plan.id,
    releaseToken,
    state,
    ready: state === "ready",
    accepted: receipt.accepted === true,
    nextAction: state === "ready"
      ? "release-runtime-handoff"
      : primaryRow?.nextAction || "review-runtime-release-decision",
    owner: primaryRow?.owner || "runtime",
    visibleStatus: state === "ready"
      ? "runtime-release-ready"
      : state === "waiting"
        ? "runtime-release-waiting"
        : state === "blocked"
          ? "runtime-release-blocked"
          : "runtime-release-review",
    releaseCommand: {
      commandId: releaseCommandId,
      enabled: state === "ready",
      idempotencyKey: releaseCommandId ? stableId("idem", [releaseCommandId, releaseToken]) : null,
      externalWritesPerformed: false,
      dryRunOnly: true,
    },
    gates: {
      lifecycleRuntimeStartEnabled,
      lifecycleRuntimeControlReady: lifecycleRuntimeControlDryRun?.ready === true,
      lifecycleRuntimeControlState: lifecycleRuntimeControlDryRun?.state ?? "unknown",
      operatorInstructionReady: operatorInstruction.ready === true,
      operatorInstructionState: operatorInstruction.state ?? "missing",
      providerReady: providerReleaseContract.ready === true,
      tenantReady: tenantAuditHandoff.safeBoundary === true && tenantAuditHandoff.status === "ready",
      acceptanceReady: receipt.readyForRuntimeStart === true,
      commandLeasesReady: clientCommandLeaseReplay.ready === true && leaseBlocked === false,
      replayExportReady: commandLeaseReplayExport.exportReady === true,
    },
    counters: {
      rows: releaseRows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      ready: releaseRows.filter((row) => row.state === "ready").length,
      lifecycleRuntimeControlBlockedKeys: lifecycleRuntimeControlDryRun?.validationSummary?.blockedControlKeys?.length ?? 0,
      lifecycleRuntimeControlWaitingKeys: lifecycleRuntimeControlDryRun?.validationSummary?.waitingControlKeys?.length ?? 0,
      operatorReleaseRequiredAcknowledgements: operatorInstruction.requiredAcknowledgements?.length ?? 0,
      operatorReleaseBlockedGates: operatorInstruction.validationSummary?.blockedGateIds?.length ?? 0,
      operatorReleaseWaitingGates: operatorInstruction.validationSummary?.waitingGateIds?.length ?? 0,
      blockedJobs: [
        ...(lifecycleRuntimeControlDryRun?.validationSummary?.blockedJobIds ?? []),
        ...(tenantAuditHandoff.permissions?.blockedJobIds ?? []),
        ...(providerReleaseContract.validationSummary?.blockedJobIds ?? []),
        ...(commandLeaseReplayExport.jobIds?.blocking ?? []),
        ...(operatorInstruction.clientPatch?.operatorReleaseBlockedJobIds ?? []),
      ].length,
      waitingJobs: [
        ...(lifecycleRuntimeControlDryRun?.validationSummary?.waitingJobIds ?? []),
        ...(tenantAuditHandoff.permissions?.approvalJobIds ?? []),
        ...(providerReleaseContract.validationSummary?.waitingJobIds ?? []),
        ...(commandLeaseReplayExport.jobIds?.ackRequired ?? []),
        ...(operatorInstruction.clientPatch?.operatorReleaseWaitingJobIds ?? []),
      ].length,
    },
    rows: releaseRows,
    blockers: blockedRows.flatMap((row) => row.blockingCodes.length > 0 ? row.blockingCodes : [row.id]),
    waitingOn: waitingRows.map((row) => row.id),
    operatorInstruction: operatorInstruction.id ? {
      id: operatorInstruction.id,
      state: operatorInstruction.state,
      ready: operatorInstruction.ready === true,
      visibleStatus: operatorInstruction.visibleStatus,
      nextAction: operatorInstruction.nextAction,
      releaseToken: operatorInstruction.releaseToken,
      releaseMode: operatorInstruction.releaseMode,
      schedule: operatorInstruction.schedule,
      requiredAcknowledgements: operatorInstruction.requiredAcknowledgements ?? [],
      validationSummary: operatorInstruction.validationSummary ?? {},
      clientPatch: operatorInstruction.clientPatch ?? {},
    } : null,
    clientPatch: {
      runtimeReleaseDecisionArtifact: "runtime-release-decision.json",
      runtimeReleaseState: state,
      runtimeReleaseReady: state === "ready",
      runtimeReleaseToken: releaseToken,
      runtimeReleaseOperatorInstructionId: operatorInstruction.id ?? null,
      runtimeReleaseOperatorInstructionState: operatorInstruction.state ?? "missing",
      runtimeReleaseOperatorInstructionReady: operatorInstruction.ready === true,
      runtimeReleaseNextAction: state === "ready"
        ? "release-runtime-handoff"
        : primaryRow?.nextAction || "review-runtime-release-decision",
      runtimeReleaseCommandId: releaseCommandId,
      runtimeReleaseBlockedGateIds: blockedRows.map((row) => row.id),
      runtimeReleaseWaitingGateIds: waitingRows.map((row) => row.id),
      runtimeReleaseOperatorBlockedGateIds: operatorInstruction.clientPatch?.operatorReleaseBlockedGateIds ?? [],
      runtimeReleaseOperatorWaitingGateIds: operatorInstruction.clientPatch?.operatorReleaseWaitingGateIds ?? [],
      runtimeReleaseOperatorRequiredAcknowledgements: operatorInstruction.requiredAcknowledgements
        ?.map((acknowledgement) => acknowledgement.gate) ?? [],
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-runtime-release-token",
      resumeFromReleaseToken: releaseToken,
      externalWritesPerformed: false,
    },
  };
}

function buildRuntimeBoundaryDryRun(plan, jobResults, tenantBoundaryMatrix, providerReleaseContract, runtimeReleaseDecision) {
  const source = plan.runtimeBoundaryPlan
    ?? plan.package?.runtimeBoundaryRelease
    ?? plan.package?.lifecycleControls?.runtimeBoundaryRelease
    ?? {};
  const sourceRows = Array.isArray(source.rows) ? source.rows : [];
  const jobRows = jobResults.map((result, index) => {
    const tenantBlocked = tenantBoundaryMatrix?.clientPatch?.tenantBoundaryBlockedJobs?.includes(result.jobId);
    const tenantWaiting = tenantBoundaryMatrix?.clientPatch?.tenantBoundaryApprovalJobs?.includes(result.jobId);
    const providerBlocked = providerReleaseContract?.validationSummary?.blockedJobIds?.includes(result.jobId);
    const providerWaiting = providerReleaseContract?.validationSummary?.waitingJobIds?.includes(result.jobId);
    const leaseBlocked = result.state?.commandLeaseReplay?.blocksRuntimeStart === true;
    const state = tenantBlocked || providerBlocked || leaseBlocked || result.status === "blocked" || result.status === "skipped"
      ? "blocked"
      : tenantWaiting || providerWaiting || result.status === "degraded"
        ? "waiting"
        : "ready";
    return {
      sequence: index + 1,
      jobId: result.jobId,
      operation: result.operation,
      state,
      dryRunStatus: result.status,
      permissionDecision: result.state?.clientOperationState?.workflowState === "waiting-for-approval"
        ? "needs-approval"
        : result.health?.checks?.find((check) => check.name === "tenant-permission")?.status === "fail"
          ? "deny"
          : "allow",
      checkpointKey: result.state?.checkpointKey ?? null,
      commandIds: result.state?.commandIds ?? [],
      adapterStatusResumeCursor: result.adapterStatusProbe?.resumeCursor ?? null,
      replayCursor: result.state?.restartReplay?.replayCursor ?? null,
      nextAction: state === "blocked"
        ? result.recoveryHandoff?.nextAction ?? "repair-runtime-boundary-job"
        : state === "waiting"
          ? result.recoveryHandoff?.nextAction ?? "wait-for-runtime-boundary-job"
          : "release-runtime-boundary-job",
      reasons: [
        ...(tenantBlocked ? ["tenant-boundary-blocked"] : []),
        ...(tenantWaiting ? ["tenant-approval-waiting"] : []),
        ...(providerBlocked ? ["provider-release-blocked"] : []),
        ...(providerWaiting ? ["provider-release-waiting"] : []),
        ...(leaseBlocked ? ["client-command-lease-blocked"] : []),
        ...result.actionableErrors.map((error) => error.code),
      ],
    };
  });
  const rows = [
    ...sourceRows.map((row, index) => ({
      sequence: index + 1,
      key: row.key,
      state: row.state,
      sourceId: row.sourceId ?? source.id ?? null,
      nextAction: row.nextAction ?? "review-runtime-boundary",
      commandId: row.commandId ?? null,
    })),
    {
      sequence: sourceRows.length + 1,
      key: "tenant-boundary-matrix",
      state: tenantBoundaryMatrix?.status === "blocked"
        ? "blocked"
        : tenantBoundaryMatrix?.status === "needs-approval"
          ? "waiting"
          : "ready",
      sourceId: tenantBoundaryMatrix?.id ?? null,
      nextAction: tenantBoundaryMatrix?.audit?.nextAction ?? "append-audit-before-runtime-release",
      commandId: null,
    },
    {
      sequence: sourceRows.length + 2,
      key: "provider-release-contract",
      state: providerReleaseContract?.ready === true
        ? "ready"
        : providerReleaseContract?.state === "waiting"
          ? "waiting"
          : "blocked",
      sourceId: providerReleaseContract?.id ?? null,
      nextAction: providerReleaseContract?.nextAction ?? "repair-provider-release-readiness",
      commandId: providerReleaseContract?.externalHandoff?.releaseCommandId ?? null,
    },
    {
      sequence: sourceRows.length + 3,
      key: "runtime-release-decision",
      state: runtimeReleaseDecision?.ready === true
        ? "ready"
        : runtimeReleaseDecision?.state === "waiting"
          ? "waiting"
          : runtimeReleaseDecision?.state === "review"
            ? "review"
            : "blocked",
      sourceId: runtimeReleaseDecision?.releaseToken ?? null,
      nextAction: runtimeReleaseDecision?.nextAction ?? "review-runtime-release-decision",
      commandId: runtimeReleaseDecision?.releaseCommand?.commandId ?? null,
    },
  ];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const reviewRows = rows.filter((row) => row.state === "review");
  const blockedJobs = jobRows.filter((row) => row.state === "blocked");
  const waitingJobs = jobRows.filter((row) => row.state === "waiting");
  const state = blockedRows.length > 0 || blockedJobs.length > 0
    ? "blocked"
    : waitingRows.length > 0 || waitingJobs.length > 0
      ? "waiting"
      : reviewRows.length > 0
        ? "review"
        : "ready";
  const boundaryToken = stableId("dryboundary", [
    plan.id,
    source.id,
    tenantBoundaryMatrix?.id,
    providerReleaseContract?.id,
    runtimeReleaseDecision?.releaseToken,
    state,
  ]);
  return {
    protocol: "aios.mailchimp.dry-run-runtime-boundary.v1",
    id: boundaryToken,
    sourcePacketId: source.id ?? null,
    planId: plan.id,
    state,
    ready: state === "ready",
    exportReady: state === "ready" && jobRows.every((row) => row.adapterStatusResumeCursor),
    visibleStatus: state === "ready"
      ? "dry-run-runtime-boundary-ready"
      : state === "waiting"
        ? "dry-run-runtime-boundary-waiting"
        : state === "review"
          ? "dry-run-runtime-boundary-review"
          : "dry-run-runtime-boundary-blocked",
    nextAction: blockedRows[0]?.nextAction
      ?? blockedJobs[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? waitingJobs[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? "publish-runtime-boundary-dry-run",
    rows,
    jobRows,
    command: {
      commandId: state === "ready" ? stableId("dryboundarycmd", [boundaryToken, "publish"]) : null,
      enabled: state === "ready",
      idempotencyKey: state === "ready" ? stableId("idem", [boundaryToken, "publish"]) : null,
      externalWritesPerformed: false,
      dryRunOnly: true,
    },
    counters: {
      rows: rows.length,
      jobs: jobRows.length,
      readyRows: rows.filter((row) => row.state === "ready").length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      reviewRows: reviewRows.length,
      blockedJobs: blockedJobs.length,
      waitingJobs: waitingJobs.length,
      readyJobs: jobRows.filter((row) => row.state === "ready").length,
      adapterStatusResumeCursors: jobRows.filter((row) => row.adapterStatusResumeCursor).length,
      replayCursors: jobRows.filter((row) => row.replayCursor).length,
    },
    clientPatch: {
      runtimeBoundaryDryRunId: stableId("dryboundarypatch", [plan.id, state]),
      runtimeBoundaryDryRunState: state,
      runtimeBoundaryDryRunReady: state === "ready",
      runtimeBoundaryDryRunNextAction: state === "ready" ? "publish-runtime-boundary-dry-run" : null,
      runtimeBoundaryBlockedKeys: blockedRows.map((row) => row.key),
      runtimeBoundaryWaitingKeys: waitingRows.map((row) => row.key),
      runtimeBoundaryBlockedJobIds: blockedJobs.map((row) => row.jobId),
      runtimeBoundaryWaitingJobIds: waitingJobs.map((row) => row.jobId),
    },
    restartSemantics: {
      restartSafe: state !== "blocked",
      onRestart: state === "ready" ? "return-existing-runtime-boundary-dry-run" : "reload-runtime-boundary-dry-run",
      onDuplicateCommand: "return-existing-runtime-boundary-dry-run-command",
      externalWritesPerformed: false,
    },
  };
}

function buildClaimGateReportingPreview(plan) {
  const reporting = plan.providerService?.claimReporting ?? {};
  const claimAcceptance = plan.claimGate?.claimAcceptance ?? reporting.acceptance ?? {};
  const exportPacket = reporting.exportPacket
    ?? plan.claimGate?.exportPacket
    ?? plan.claimGate?.exportContract
    ?? {};
  const retentionManifest = exportPacket.retentionManifest
    ?? reporting.exportPacket?.retentionManifest
    ?? plan.claimGate?.exportPacket?.retentionManifest
    ?? {};
  return {
    exportFormat: reporting.exportFormat ?? "aios.mailchimp.claim-gate.v1",
    pendingFacts: reporting.pendingFacts ?? plan.truthBoundaryReport?.unverifiedFacts ?? [],
    counters: reporting.counters ?? {},
    historySnapshotIds: reporting.historySnapshotIds ?? [],
    truthBoundaryOpen: (reporting.pendingFacts ?? plan.truthBoundaryReport?.unverifiedFacts ?? []).length > 0,
    exportPacket: {
      protocol: exportPacket.protocol ?? "aios.mailchimp.claim-gate.export-packet.v1",
      state: exportPacket.state ?? exportPacket.summary?.status ?? "unknown",
      ready: exportPacket.ready === true || exportPacket.exportReady === true,
      digest: exportPacket.digest ?? exportPacket.summary?.digest ?? null,
      nextAction: exportPacket.nextAction
        ?? exportPacket.exportSummary?.nextAction
        ?? exportPacket.summary?.nextAction
        ?? "review-claim-export-packet",
      counters: exportPacket.counters ?? {},
      artifactNames: exportPacket.artifactNames ?? (exportPacket.artifacts ?? []).map((artifact) => artifact.name),
      blockedArtifactNames: exportPacket.blockedArtifactNames
        ?? exportPacket.exportSummary?.blockerArtifactNames
        ?? [],
      publishCommandIds: exportPacket.publishCommandIds
        ?? (exportPacket.publishCommands ?? []).map((command) => command.id).filter(Boolean),
      latestSnapshotId: exportPacket.latestSnapshotId
        ?? exportPacket.manifest?.latestSnapshotId
        ?? null,
      retentionManifest: {
        protocol: retentionManifest.protocol ?? "aios.mailchimp.claim-export-retention-manifest.v1",
        id: retentionManifest.id
          ?? exportPacket.manifest?.retentionManifestId
          ?? exportPacket.exportSummary?.retentionManifestId
          ?? null,
        state: retentionManifest.state
          ?? exportPacket.manifest?.retentionState
          ?? exportPacket.exportSummary?.retentionState
          ?? "unknown",
        ready: retentionManifest.ready === true
          || exportPacket.manifest?.retentionReady === true
          || exportPacket.exportSummary?.retentionReady === true,
        nextAction: retentionManifest.nextAction
          ?? exportPacket.exportSummary?.nextAction
          ?? "review-claim-export-retention",
        counters: retentionManifest.counters ?? {},
        blockedArtifactNames: retentionManifest.blockedArtifactNames
          ?? exportPacket.exportSummary?.retentionBlockedArtifactNames
          ?? [],
        reviewArtifactNames: retentionManifest.reviewArtifactNames ?? [],
        latestSnapshotId: retentionManifest.latestSnapshotId
          ?? exportPacket.manifest?.latestSnapshotId
          ?? null,
        commandIds: (retentionManifest.commands ?? []).map((command) => command.id).filter(Boolean),
      },
    },
    acceptance: {
      id: claimAcceptance.id ?? null,
      status: claimAcceptance.status ?? "unknown",
      visibleStatus: claimAcceptance.visibleStatus ?? "claim-preview-unavailable",
      nextAction: claimAcceptance.nextAction ?? "review-claim-preview",
      acceptanceToken: claimAcceptance.acceptanceToken ?? null,
      canAcknowledge: claimAcceptance.canAcknowledge === true,
      requiredInputNames: claimAcceptance.acknowledgement?.requiredInputs
        ?.filter((input) => input.required)
        .map((input) => input.name)
        ?? reporting.acceptance?.requiredInputNames
        ?? [],
      validationSummary: claimAcceptance.validationSummary ?? reporting.acceptance?.validationSummary ?? {},
      commandId: claimAcceptance.acknowledgement?.command?.id ?? reporting.acceptance?.commandId ?? null,
    },
  };
}

function buildClaimExportAcceptancePreview(plan, claimGateReporting, reportCore, analytics, history) {
  const exportPacket = claimGateReporting.exportPacket ?? {};
  const retentionManifest = exportPacket.retentionManifest ?? {};
  const dryRunBlocked = ["blocked", "skipped"].includes(reportCore.status);
  const analyticsReady = reportCore.dryRunAnalyticsExport?.exportReady === true
    || analytics.commandLeaseReplay?.exportReady === true;
  const missingArtifacts = (exportPacket.artifactNames ?? [])
    .filter((name) => !(exportPacket.blockedArtifactNames ?? []).includes(name));
  const blockedArtifactNames = exportPacket.blockedArtifactNames ?? [];
  const retentionBlockedArtifactNames = retentionManifest.blockedArtifactNames ?? [];
  const retentionReviewArtifactNames = retentionManifest.reviewArtifactNames ?? [];
  const requiredInputs = [
    {
      name: "claimExportDigest",
      value: exportPacket.digest ?? null,
      required: true,
    },
    {
      name: "claimStateVersion",
      value: plan.claimGate?.clientRuntime?.persistedState?.version
        ?? plan.providerService?.claimReporting?.exportPacket?.manifest?.claimStateVersion
        ?? null,
      required: true,
    },
    {
      name: "historySnapshotIds",
      value: claimGateReporting.historySnapshotIds ?? [],
      required: true,
    },
    {
      name: "dryRunReportId",
      value: reportCore.id,
      required: true,
    },
    {
      name: "claimExportRetentionManifestId",
      value: retentionManifest.id ?? null,
      required: exportPacket.ready === true,
    },
    {
      name: "claimExportRetentionSnapshotId",
      value: retentionManifest.latestSnapshotId ?? exportPacket.latestSnapshotId ?? null,
      required: exportPacket.ready === true,
    },
  ];
  const missingInputNames = requiredInputs
    .filter((input) => input.required && (
      input.value === null
      || input.value === undefined
      || (Array.isArray(input.value) && input.value.length === 0)
    ))
    .map((input) => input.name);
  const checks = [
    {
      name: "claim-export-packet",
      status: exportPacket.ready === true ? "pass" : "fail",
      detail: exportPacket.ready === true
        ? "Claim export packet is ready for dry-run presentation."
        : "Claim export packet has unready artifacts.",
      nextAction: exportPacket.nextAction ?? "review-claim-export-packet",
      blockedArtifacts: blockedArtifactNames,
    },
    {
      name: "dry-run-admission",
      status: dryRunBlocked ? "fail" : reportCore.status === "degraded" ? "pending" : "pass",
      detail: dryRunBlocked
        ? "Dry-run report blocks claim export publication."
        : `Dry-run report status is ${reportCore.status}.`,
      nextAction: dryRunBlocked ? "repair-dry-run-before-export" : "continue-claim-export-preview",
    },
    {
      name: "analytics-readiness",
      status: analyticsReady ? "pass" : "pending",
      detail: analyticsReady
        ? "Dry-run analytics exports are ready or replay-safe."
        : "Dry-run analytics export should be refreshed before claim export publication.",
      nextAction: analyticsReady ? "continue-claim-export-preview" : "refresh-dry-run-analytics-export",
    },
    {
      name: "retention-manifest",
      status: retentionManifest.ready === true
        ? "pass"
        : retentionBlockedArtifactNames.length > 0 || retentionManifest.state === "blocked"
          ? "fail"
          : "pending",
      detail: retentionManifest.ready === true
        ? "Claim export retention manifest is ready and restart-safe."
        : retentionBlockedArtifactNames.length > 0
          ? `Claim export retention blocks artifacts: ${retentionBlockedArtifactNames.join(", ")}.`
          : "Claim export retention manifest should be reviewed before publication.",
      nextAction: retentionManifest.nextAction ?? "review-claim-export-retention",
      blockedArtifacts: retentionBlockedArtifactNames,
      reviewArtifacts: retentionReviewArtifactNames,
    },
    {
      name: "required-inputs",
      status: missingInputNames.length === 0 ? "pass" : "pending",
      detail: missingInputNames.length === 0
        ? "Required claim export inputs are available."
        : `Missing claim export inputs: ${missingInputNames.join(", ")}.`,
      nextAction: missingInputNames.length === 0 ? "continue-claim-export-preview" : "collect-claim-export-inputs",
    },
  ];
  const failingChecks = checks.filter((check) => check.status === "fail");
  const pendingChecks = checks.filter((check) => check.status === "pending");
  const status = failingChecks.length > 0
    ? "blocked"
    : pendingChecks.length > 0
      ? "waiting"
      : "ready";
  const previewId = stableId("claimexportpreview", [
    plan.id,
    exportPacket.digest,
    reportCore.id,
    status,
    checks.map((check) => `${check.name}:${check.status}`).join(","),
  ]);
  return {
    protocol: "aios.mailchimp.dry-run-claim-export-acceptance.v1",
    id: previewId,
    planId: plan.id,
    reportId: reportCore.id,
    product: "mailchimp",
    status,
    ready: status === "ready",
    visibleStatus: status === "ready"
      ? "claim-export-ready"
      : status === "waiting"
        ? "claim-export-waiting"
        : "claim-export-blocked",
    nextAction: failingChecks[0]?.nextAction
      ?? pendingChecks[0]?.nextAction
      ?? "publish-claim-export-packet",
    digest: stableId("claimexportaccept", [
      previewId,
      exportPacket.digest,
      history.at(-1)?.id,
      analytics.commandLeaseReplay?.status,
    ]),
    requiredInputs,
    checks,
    validationSummary: {
      passed: checks.filter((check) => check.status === "pass").length,
      pending: pendingChecks.length,
      failed: failingChecks.length,
      missingInputNames,
      blockedArtifactNames,
      readyArtifactNames: missingArtifacts,
      retentionManifestId: retentionManifest.id ?? null,
      retentionState: retentionManifest.state ?? "unknown",
      retentionReady: retentionManifest.ready === true,
      retentionBlockedArtifactNames,
      retentionReviewArtifactNames,
      publishCommandIds: exportPacket.publishCommandIds ?? [],
    },
    clientPatch: {
      claimExportAcceptanceId: previewId,
      claimExportAcceptanceStatus: status,
      claimExportAcceptanceReady: status === "ready",
      claimExportAcceptanceNextAction: failingChecks[0]?.nextAction
        ?? pendingChecks[0]?.nextAction
        ?? "publish-claim-export-packet",
      claimExportDigest: exportPacket.digest ?? null,
      claimExportBlockedArtifacts: blockedArtifactNames,
      claimExportRetentionManifestId: retentionManifest.id ?? null,
      claimExportRetentionState: retentionManifest.state ?? "unknown",
      claimExportRetentionBlockedArtifacts: retentionBlockedArtifactNames,
    },
    restartSemantics: {
      replaySafe: status !== "blocked" && retentionManifest.state !== "blocked",
      duplicateCommandPolicy: "dedupe-by-claim-export-acceptance-id",
      resumeFromReportId: reportCore.id,
      externalWritesPerformed: false,
    },
  };
}

function buildClaimAcknowledgmentState(plan, lifecycle, acceptancePreview) {
  const claimRuntime = plan.claimGate?.clientRuntime ?? {};
  const claimAcceptance = plan.claimGate?.claimAcceptance ?? {};
  const acknowledgement = claimAcceptance.acknowledgement ?? {};
  const validationSummary = claimAcceptance.validationSummary ?? {};
  const stateKey = [
    claimRuntime.clientStateKey ?? "mailchimp:claim-state",
    claimAcceptance.id ?? plan.id,
    "acknowledgment",
  ].join(":");
  const accepted = acceptancePreview.accepted && claimAcceptance.canAcknowledge === true;
  const blocked = ["blocked", "unknown"].includes(claimAcceptance.status ?? "unknown");
  const version = stableId("claimackstate", [
    plan.id,
    claimAcceptance.id,
    claimAcceptance.acceptanceToken,
    acceptancePreview.status,
    lifecycle.nextAction.commandId,
  ]);
  const persistCommand = acknowledgement.command ?? {
    id: stableId("claimackcmd", [stateKey, version, "persist"]),
    type: "persist-claim-acknowledgment",
    idempotencyKey: stableId("idem", [stateKey, version, "persist"]),
    statusAfterReplay: accepted ? "claim-preview-accepted" : "claim-preview-recorded",
    writes: ["claimAcceptanceToken", "claimStateVersion", "tenantBoundaryId", "acceptedAt"],
    conflict: "return-existing",
  };
  const commands = [
    persistCommand,
    {
      id: stableId("claimackcmd", [stateKey, version, "link-runtime-handoff"]),
      type: "link-claim-acknowledgment-to-runtime-handoff",
      statusAfterReplay: accepted ? "runtime-handoff-claim-accepted" : "runtime-handoff-claim-waiting",
      idempotencyKey: stableId("idem", [stateKey, version, "link-runtime-handoff"]),
      writes: ["handoffId", "claimAcceptanceToken", "visibleStatus", "nextAction"],
      conflict: "return-existing",
    },
  ];
  if (blocked) {
    commands.push({
      id: stableId("claimackcmd", [stateKey, version, "hold"]),
      type: "hold-claim-acknowledgment",
      statusAfterReplay: "claim-acknowledgment-blocked",
      idempotencyKey: stableId("idem", [stateKey, version, "hold"]),
      writes: ["blockedRuleIds", "pendingFacts", "nextAction"],
      conflict: "return-existing",
    });
  }
  return {
    id: stableId("claimack", [stateKey, version]),
    stateKey,
    version,
    status: accepted
      ? "accepted"
      : blocked
        ? "blocked"
        : claimAcceptance.status === "review"
          ? "review"
          : "waiting",
    visibleStatus: accepted
      ? "claim-accepted"
      : claimAcceptance.visibleStatus ?? "review-claim-preview",
    nextAction: accepted
      ? "prepare-runtime-handoff"
      : claimAcceptance.nextAction ?? acceptancePreview.nextAction ?? "review-claim-preview",
    acceptanceToken: claimAcceptance.acceptanceToken ?? null,
    canAcknowledge: claimAcceptance.canAcknowledge === true,
    requiredInputs: acknowledgement.requiredInputs ?? [],
    validationSummary: {
      ...validationSummary,
      dryRunAcceptanceStatus: acceptancePreview.status,
      lifecycleValid: lifecycle.valid,
      commandId: persistCommand.id,
    },
    commands,
    resumeCursor: stableId("claimackcursor", [
      stateKey,
      version,
      claimRuntime.continuationToken,
    ]),
    recoveryPaths: {
      onRestart: accepted ? "resume-runtime-handoff" : "resume-claim-acknowledgment",
      onDuplicateCommand: "return-existing-claim-acknowledgment",
      onStaleVersion: "reload-claim-state-before-acceptance",
      onEvidenceChanged: "invalidate-claim-acceptance-token",
    },
  };
}

function buildPackageLifecyclePreview(plan) {
  const lifecycle = plan.providerService?.lifecycle ?? plan.package?.lifecycleControls ?? {};
  return {
    stateId: lifecycle.stateId ?? null,
    enabled: lifecycle.enabled !== false,
    command: lifecycle.command ?? "prepare",
    releasePolicy: lifecycle.releasePolicy ?? "manual-approval",
    schedule: lifecycle.schedule ?? { mode: "manual" },
    commandIds: lifecycle.commandIds ?? [],
    releaseGate: lifecycle.releaseGate ?? plan.package?.lifecycleControls?.releaseGate ?? null,
    nextAction: lifecycle.nextAction ?? {
      action: "prepare-manual-release",
      commandId: null,
    },
  };
}

function buildPackagePreviewState(plan, jobResults, lifecycle, acceptancePreview) {
  const preview = plan.package?.previewContract ?? plan.providerService?.packagePreview ?? {};
  const validationSummary = preview.validationSummary ?? {};
  const acceptance = preview.acceptance ?? plan.package?.acceptance ?? {};
  const readyJobs = jobResults.filter((result) => result.status === "would-run");
  const blockedJobs = jobResults.filter((result) => ["blocked", "skipped"].includes(result.status));
  const degradedJobs = jobResults.filter((result) => result.status === "degraded");
  const persistedStateKey = [
    "mailchimp",
    plan.package?.name ?? "package",
    preview.id ?? plan.id,
    "preview",
  ].join(":");
  const persistedVersion = stableId("pkgstate", [
    plan.id,
    preview.id,
    acceptancePreview.status,
    jobResults.map((result) => `${result.jobId}:${result.status}`).join(","),
  ]);
  const commandScope = [
    persistedStateKey,
    persistedVersion,
    lifecycle.nextAction.commandId,
  ];
  const commands = [
    {
      id: stableId("pkgcmd", [...commandScope, "persist-preview"]),
      type: "persist-package-preview-state",
      statusAfterReplay: acceptancePreview.accepted ? "preview-accepted" : "preview-recorded",
      idempotencyKey: stableId("idem", [...commandScope, "persist-preview"]),
      writes: ["previewStatus", "visibleStatus", "validationSummary", "operationRows"],
      conflict: "return-existing",
    },
    {
      id: stableId("pkgcmd", [...commandScope, "persist-acceptance"]),
      type: "persist-package-acceptance-state",
      statusAfterReplay: acceptancePreview.accepted ? "accepted" : "waiting",
      idempotencyKey: stableId("idem", [...commandScope, "persist-acceptance"]),
      writes: ["accepted", "requiredInputs", "nextAction", "handoffId"],
      conflict: "return-existing",
    },
  ];
  if (blockedJobs.length > 0 || degradedJobs.length > 0) {
    commands.push({
      id: stableId("pkgcmd", [...commandScope, "hold-preview"]),
      type: "hold-package-preview-acceptance",
      statusAfterReplay: blockedJobs.length > 0 ? "blocked" : "waiting-for-approval",
      idempotencyKey: stableId("idem", [...commandScope, "hold-preview"]),
      writes: ["blockedJobIds", "degradedJobIds", "nextAction"],
      conflict: "return-existing",
    });
  }
  return {
    id: stableId("pkgpreviewstate", [persistedStateKey, persistedVersion]),
    previewId: preview.id ?? null,
    stateKey: persistedStateKey,
    version: persistedVersion,
    status: acceptancePreview.accepted
      ? "accepted"
      : blockedJobs.length > 0
        ? "blocked"
        : degradedJobs.length > 0
          ? "waiting-for-approval"
          : preview.status ?? "review",
    visibleStatus: acceptancePreview.visibleStatus ?? preview.visibleStatus ?? "review-before-acceptance",
    nextAction: acceptancePreview.nextAction ?? preview.nextAction ?? "review-package-preview",
    restartSafe: Boolean(plan.restartProjection?.restartSafe && lifecycle.valid),
    resumeCursor: stableId("pkgcursor", [
      persistedStateKey,
      persistedVersion,
      plan.restartProjection?.replayCursor,
    ]),
    validationSummary: {
      ...validationSummary,
      blockedJobIds: blockedJobs.map((result) => result.jobId),
      degradedJobIds: degradedJobs.map((result) => result.jobId),
      readyJobIds: readyJobs.map((result) => result.jobId),
      dryRunAcceptanceStatus: acceptancePreview.status,
      lifecycleValid: lifecycle.valid,
    },
    acceptance: {
      canAccept: acceptancePreview.accepted,
      manifestCanAccept: acceptance.canAccept === true,
      requiredInputs: acceptancePreview.requiredInputs ?? acceptance.requiredInputs ?? [],
      primaryAction: acceptancePreview.primaryAction,
      handoffId: acceptancePreview.handoffId,
    },
    commands,
    recoveryPaths: {
      onRestart: acceptancePreview.accepted ? "resume-runtime-handoff" : "resume-package-preview",
      onDuplicateCommand: "return-existing-preview-state",
      onStaleVersion: "reload-package-preview-state",
      onApprovalCollected: "replay-package-acceptance-state",
    },
  };
}

function buildPreviewReadinessManifestDryRun(
  plan,
  jobResults,
  lifecycle,
  acceptancePreview,
  clientReadinessDryRun,
  providerReleaseContract,
  runtimeReleaseDecision,
  packagePreviewState,
) {
  const routeId = stableId("previewroute", [
    plan.id,
    acceptancePreview.acceptanceToken,
    runtimeReleaseDecision.releaseToken,
    packagePreviewState.version,
  ]);
  const readyJobs = jobResults.filter((result) => result.status === "would-run");
  const blockedJobs = jobResults.filter((result) => ["blocked", "skipped"].includes(result.status));
  const waitingJobs = jobResults.filter((result) => result.status === "degraded");
  const clientBlocked = clientReadinessDryRun.validationSummary?.blockedKeys?.length > 0
    || clientReadinessDryRun.state === "blocked";
  const providerBlocked = providerReleaseContract.state === "blocked"
    || providerReleaseContract.readyForRuntimeRelease === false;
  const releaseBlocked = runtimeReleaseDecision.state === "blocked"
    || runtimeReleaseDecision.readyForRuntimeStart === false;
  const sections = [
    {
      id: "acceptance",
      order: 1,
      label: "Preview acceptance",
      status: acceptancePreview.accepted ? "ready" : "needs-operator-action",
      readyForClientPreview: acceptancePreview.status !== "blocked",
      readyForRuntimeStart: acceptancePreview.accepted === true,
      nextAction: acceptancePreview.nextAction || "accept-preview-before-runtime-start",
      artifactNames: ["preview-acceptance.json", "preview-acceptance-packet.json"],
      evidence: {
        acceptanceToken: acceptancePreview.acceptanceToken || null,
        accepted: acceptancePreview.accepted === true,
        blockedJobIds: acceptancePreview.validationSummary?.blockedJobIds || blockedJobs.map((result) => result.jobId),
        waitingJobIds: acceptancePreview.validationSummary?.waitingJobIds || waitingJobs.map((result) => result.jobId),
      },
    },
    {
      id: "client-readiness",
      order: 2,
      label: "Client readiness",
      status: clientBlocked
        ? "blocked"
        : clientReadinessDryRun.ready === true
          ? "ready"
          : "needs-operator-action",
      readyForClientPreview: clientBlocked === false,
      readyForRuntimeStart: clientReadinessDryRun.ready === true,
      nextAction: clientReadinessDryRun.nextAction || "refresh-client-readiness",
      artifactNames: ["client-readiness-brief.json"],
      evidence: {
        blockedKeys: clientReadinessDryRun.validationSummary?.blockedKeys || [],
        waitingKeys: clientReadinessDryRun.validationSummary?.waitingKeys || [],
        readyJobIds: readyJobs.map((result) => result.jobId),
      },
    },
    {
      id: "provider-release",
      order: 3,
      label: "Provider release",
      status: providerBlocked
        ? "blocked"
        : providerReleaseContract.readyForRuntimeRelease
          ? "ready"
          : "needs-operator-action",
      readyForClientPreview: providerReleaseContract.state !== "blocked",
      readyForRuntimeStart: providerReleaseContract.readyForRuntimeRelease === true,
      nextAction: providerReleaseContract.nextAction || "refresh-provider-release",
      artifactNames: ["provider-release-readiness.json", "provider-integration-execution-ticket.json"],
      evidence: {
        releaseContractId: providerReleaseContract.id,
        blockedGateIds: providerReleaseContract.validationSummary?.blockedGateIds || [],
        waitingGateIds: providerReleaseContract.validationSummary?.waitingGateIds || [],
      },
    },
    {
      id: "runtime-release",
      order: 4,
      label: "Runtime release",
      status: releaseBlocked
        ? "blocked"
        : runtimeReleaseDecision.readyForRuntimeStart
          ? "ready"
          : "needs-operator-action",
      readyForClientPreview: runtimeReleaseDecision.state !== "blocked",
      readyForRuntimeStart: runtimeReleaseDecision.readyForRuntimeStart === true,
      nextAction: runtimeReleaseDecision.nextAction || "review-runtime-release",
      artifactNames: ["runtime-release-controls.json"],
      evidence: {
        releaseToken: runtimeReleaseDecision.releaseToken || null,
        blockedGateIds: runtimeReleaseDecision.clientPatch?.runtimeReleaseBlockedGateIds || [],
        waitingGateIds: runtimeReleaseDecision.clientPatch?.runtimeReleaseWaitingGateIds || [],
      },
    },
    {
      id: "package-preview",
      order: 5,
      label: "Package preview state",
      status: packagePreviewState.status === "blocked"
        ? "blocked"
        : packagePreviewState.restartSafe
          ? "ready"
          : "needs-operator-action",
      readyForClientPreview: packagePreviewState.status !== "blocked",
      readyForRuntimeStart: packagePreviewState.restartSafe === true && lifecycle.valid === true,
      nextAction: packagePreviewState.nextAction || "review-package-preview",
      artifactNames: ["preview-readiness-manifest.json"],
      evidence: {
        previewId: packagePreviewState.previewId,
        stateKey: packagePreviewState.stateKey,
        resumeCursor: packagePreviewState.resumeCursor,
      },
    },
  ];
  const blockedSections = sections.filter((section) => section.status === "blocked");
  const pendingSections = sections.filter((section) => section.status === "needs-operator-action");
  const nextSection = blockedSections[0]
    || pendingSections[0]
    || sections.find((section) => section.readyForRuntimeStart === false)
    || null;
  const status = blockedSections.length > 0
    ? "blocked"
    : pendingSections.length > 0
      ? "needs-operator-action"
      : "ready";
  const resumeToken = stableId("previewresume", [
    plan.id,
    routeId,
    packagePreviewState.resumeCursor,
    runtimeReleaseDecision.releaseToken,
  ]);
  const statusRevision = stableId("previewrev", [
    plan.id,
    status,
    sections.map((section) => `${section.id}:${section.status}`).join(","),
  ]);

  return {
    id: stableId("previewmanifest", [routeId, statusRevision]),
    schemaVersion: "aios.mailchimp.preview-readiness-manifest-dry-run.v1",
    status,
    visibleStatus: status === "ready"
      ? "mailchimp-preview-ready"
      : status === "blocked"
        ? "mailchimp-preview-blocked"
        : "mailchimp-preview-waiting",
    readyForClientPreview: blockedSections.length === 0
      && sections.every((section) => section.readyForClientPreview),
    readyForRuntimeStart: blockedSections.length === 0
      && pendingSections.length === 0
      && sections.every((section) => section.readyForRuntimeStart),
    nextAction: nextSection?.nextAction || "handoff-to-runtime-adapter",
    nextSectionId: nextSection?.id || null,
    route: {
      routeId,
      target: "client-preview",
      resumeToken,
      statusRevision,
      idempotencyKey: stableId("idem", [routeId, resumeToken, statusRevision]),
    },
    validationSummary: {
      total: sections.length,
      ready: sections.filter((section) => section.status === "ready").length,
      blocked: blockedSections.length,
      pending: pendingSections.length,
      blockedSectionIds: blockedSections.map((section) => section.id),
      pendingSectionIds: pendingSections.map((section) => section.id),
      blockedJobIds: blockedJobs.map((result) => result.jobId),
      waitingJobIds: waitingJobs.map((result) => result.jobId),
    },
    sections,
    clientPatch: {
      previewReadinessManifestStatus: status,
      previewReadinessManifestRouteId: routeId,
      previewReadinessManifestNextAction: nextSection?.nextAction || "handoff-to-runtime-adapter",
      previewReadinessManifestReadyForPreview: blockedSections.length === 0
        && sections.every((section) => section.readyForClientPreview),
      previewReadinessManifestReadyForRuntimeStart: blockedSections.length === 0
        && pendingSections.length === 0
        && sections.every((section) => section.readyForRuntimeStart),
      previewReadinessManifestBlockedSectionIds: blockedSections.map((section) => section.id),
      previewReadinessManifestPendingSectionIds: pendingSections.map((section) => section.id),
    },
    dryRunGuarantee: {
      externalWritesPerformed: false,
      adapterCallsPerformed: false,
      routePayloadPersisted: false,
      deterministic: true,
    },
    restartSemantics: {
      replaySafe: blockedSections.length === 0,
      duplicateCommandPolicy: "dedupe-by-preview-readiness-route",
      resumeToken,
      statusRevision,
      resumeFromSectionId: nextSection?.id || null,
      externalWritesPerformed: false,
    },
  };
}

function buildDegradedMode(plan, jobResults) {
  const degradedJobs = jobResults.filter((result) => result.status === "degraded");
  return {
    enabled: degradedJobs.length > 0,
    reason: degradedJobs.length > 0 ? "approval-or-state-degraded" : null,
    allowedActions: degradedJobs.length > 0
      ? ["collect-approval", "persist-checkpoint", "resume-after-approval"]
      : [],
    blockedAdapterCalls: degradedJobs.map((result) => result.jobId),
    tenantIsolationKey: plan.audit?.tenantIsolationKey,
  };
}

function normalizeLifecycleSettings(value = {}) {
  const source = typeof value === "string" ? { command: value } : { ...value };
  const command = ["prepare", "enable", "disable", "schedule", "resume", "cancel"].includes(source.command)
    ? source.command
    : "prepare";
  const enabled = source.enabled === undefined ? command !== "disable" : source.enabled === true;
  const schedule = typeof source.schedule === "string" ? { mode: source.schedule } : { ...(source.schedule ?? {}) };
  const controls = source.controls && typeof source.controls === "object" ? source.controls : {};
  const scheduleMode = ["manual", "immediate", "windowed", "disabled"].includes(schedule.mode)
    ? schedule.mode
    : command === "schedule"
      ? "windowed"
      : "manual";
  const operatorHold = source.operatorHold && typeof source.operatorHold === "object" ? source.operatorHold : {};
  const runControl = source.runControl && typeof source.runControl === "object" ? source.runControl : {};
  return {
    command,
    enabled,
    requireHealthy: source.requireHealthy !== false,
    allowDegraded: source.allowDegraded === true,
    allowApprovalPause: source.allowApprovalPause !== false,
    requireOperatorAcceptance: source.requireOperatorAcceptance !== false,
    enabledActions: normalizeAuditList(source.enabledActions ?? controls.enabledActions),
    disabledActions: normalizeAuditList(source.disabledActions ?? controls.disabledActions),
    operatorHold: {
      active: source.hold === true || operatorHold.active === true,
      reason: String(operatorHold.reason ?? source.holdReason ?? "").trim(),
      releasedBy: String(operatorHold.releasedBy ?? source.releasedBy ?? "").trim(),
      releasedAt: String(operatorHold.releasedAt ?? source.releasedAt ?? "").trim(),
    },
    schedule: {
      mode: enabled ? scheduleMode : "disabled",
      windowStart: schedule.windowStart ? String(schedule.windowStart) : null,
      windowEnd: schedule.windowEnd ? String(schedule.windowEnd) : null,
      paused: schedule.paused === true || command === "cancel",
      pauseReason: schedule.pauseReason ? String(schedule.pauseReason) : null,
      maxScheduledJobs: Number.isInteger(schedule.maxScheduledJobs) && schedule.maxScheduledJobs > 0
        ? schedule.maxScheduledJobs
        : 25,
      timezone: schedule.timezone ? String(schedule.timezone) : "UTC",
    },
    runControl: {
      mode: ["manual", "immediate", "windowed"].includes(runControl.mode) ? runControl.mode : scheduleMode,
      supportedModes: normalizeAuditList(runControl.supportedModes || ["manual", "immediate", "windowed"]),
      now: runControl.now ? String(runControl.now) : null,
      freezeWindows: Array.isArray(runControl.freezeWindows) ? runControl.freezeWindows : [],
      requestedConcurrency: Number.isInteger(runControl.requestedConcurrency) && runControl.requestedConcurrency > 0
        ? runControl.requestedConcurrency
        : null,
      maxConcurrentJobs: Number.isInteger(runControl.maxConcurrentJobs) && runControl.maxConcurrentJobs > 0
        ? runControl.maxConcurrentJobs
        : null,
    },
  };
}

function lifecycleActionDisabled(settings, action) {
  if (!action) return false;
  if (settings.disabledActions.includes(action)) return true;
  const mailchimpAction = action.startsWith("mailchimp.") ? action : `mailchimp.${action}`;
  return settings.disabledActions.includes(mailchimpAction);
}

function validateLifecycleSettings(settings, plan, jobResults, status) {
  const issues = [];
  const wouldRunJobs = jobResults.filter((result) => result.status === "would-run");
  const approvalJobs = jobResults.filter((result) => result.status === "degraded" && result.reason === "approval-required");
  const requiredActions = normalizeAuditList(plan.jobs.map((job) => job.operation || job.action));
  const disabledRequiredActions = requiredActions.filter((action) => lifecycleActionDisabled(settings, action));
  if (!settings.enabled && ["enable", "schedule", "resume"].includes(settings.command)) {
    issues.push({
      code: "dry-run.lifecycle.disabled-command",
      severity: "error",
      action: "Enable lifecycle controls before scheduling or resuming Mailchimp handoff.",
    });
  }
  if (settings.requireHealthy && status !== "admitted") {
    issues.push({
      code: "dry-run.lifecycle.health-required",
      severity: settings.allowDegraded && status === "degraded" ? "warning" : "error",
      action: "Resolve dry-run health findings or explicitly allow degraded lifecycle preparation.",
    });
  }
  if (!settings.allowApprovalPause && approvalJobs.length > 0) {
    issues.push({
      code: "dry-run.lifecycle.approval-pause-disabled",
      severity: "error",
      action: "Allow approval pause or collect approval before enabling runtime handoff.",
      jobIds: approvalJobs.map((result) => result.jobId),
    });
  }
  if (settings.requireOperatorAcceptance && settings.operatorHold.active && !settings.operatorHold.releasedAt) {
    issues.push({
      code: "dry-run.lifecycle.operator-hold-active",
      severity: "error",
      action: "Release the operator lifecycle hold before enabling Mailchimp runtime handoff.",
      reason: settings.operatorHold.reason || "operator-hold",
    });
  }
  if (disabledRequiredActions.length > 0) {
    issues.push({
      code: "dry-run.lifecycle.required-action-disabled",
      severity: "error",
      action: "Enable required Mailchimp actions or remove them from this dry-run plan.",
      disabledActions: disabledRequiredActions,
    });
  }
  if (settings.schedule.mode === "windowed" && (!settings.schedule.windowStart || !settings.schedule.windowEnd)) {
    issues.push({
      code: "dry-run.lifecycle.schedule-window-missing",
      severity: "error",
      action: "Provide windowStart and windowEnd for a windowed Mailchimp schedule.",
    });
  }
  if (settings.schedule.mode === "disabled" && settings.command === "schedule") {
    issues.push({
      code: "dry-run.lifecycle.schedule-disabled",
      severity: "error",
      action: "Choose manual, immediate, or windowed scheduling for schedule command.",
    });
  }
  if (settings.schedule.paused && ["enable", "resume"].includes(settings.command)) {
    issues.push({
      code: "dry-run.lifecycle.schedule-paused",
      severity: "warning",
      action: "Resume the Mailchimp lifecycle schedule before releasing queued runtime commands.",
      reason: settings.schedule.pauseReason || "schedule-paused",
    });
  }
  if (wouldRunJobs.length > settings.schedule.maxScheduledJobs) {
    issues.push({
      code: "dry-run.lifecycle.schedule-cap-exceeded",
      severity: "error",
      action: "Raise maxScheduledJobs or reduce the Mailchimp operation set.",
      jobCount: wouldRunJobs.length,
      maxScheduledJobs: settings.schedule.maxScheduledJobs,
    });
  }
  if (plan.restartProjection?.restartSafe === false && ["resume", "schedule"].includes(settings.command)) {
    issues.push({
      code: "dry-run.lifecycle.restart-unsafe",
      severity: "error",
      action: "Repair state contracts before scheduling resumable Mailchimp handoff.",
    });
  }
  return issues;
}

function summarizeLifecycleValidation(validationIssues, jobResults, settings) {
  const blockedIssues = validationIssues.filter((issue) => issue.severity === "error");
  const warningIssues = validationIssues.filter((issue) => issue.severity === "warning");
  const approvalJobs = jobResults.filter((result) => result.status === "degraded" && result.reason === "approval-required");
  const blockedJobs = jobResults.filter((result) => ["blocked", "skipped"].includes(result.status));
  return {
    total: validationIssues.length,
    blocked: blockedIssues.length,
    warnings: warningIssues.length,
    schedulePaused: settings.schedule.paused === true,
    operatorHoldActive: settings.operatorHold.active === true && !settings.operatorHold.releasedAt,
    blockedJobIds: blockedJobs.map((result) => result.jobId),
    approvalJobIds: approvalJobs.map((result) => result.jobId),
    issueCodes: validationIssues.map((issue) => issue.code),
    disabledActions: settings.disabledActions,
  };
}

function parseLifecycleRunControlInstant(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLifecycleFreezeWindows(windows) {
  if (!Array.isArray(windows)) return [];
  return windows
    .map((window, index) => {
      const startMs = parseLifecycleRunControlInstant(window.start || window.windowStart);
      const endMs = parseLifecycleRunControlInstant(window.end || window.windowEnd);
      return {
        id: window.id || `dry-freeze-${String(index + 1).padStart(2, "0")}`,
        reason: String(window.reason || "operator-freeze"),
        start: window.start || window.windowStart || null,
        end: window.end || window.windowEnd || null,
        startMs,
        endMs,
        valid: Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs,
      };
    })
    .filter((window) => window.valid)
    .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
}

function buildLifecycleRunControlDryRun(plan, settings, jobResults, validationIssues, status) {
  const nowMs = parseLifecycleRunControlInstant(settings.runControl.now) ?? 0;
  const freezeWindows = normalizeLifecycleFreezeWindows(settings.runControl.freezeWindows);
  const activeFreezeWindow = freezeWindows.find((window) => (
    nowMs > 0 && window.startMs <= nowMs && nowMs < window.endMs
  )) ?? null;
  const supportedModes = settings.runControl.supportedModes.length
    ? settings.runControl.supportedModes
    : ["manual", "immediate", "windowed"];
  const requestedMode = settings.runControl.mode || settings.schedule.mode;
  const modeSupported = supportedModes.includes(requestedMode);
  const runnableJobs = jobResults.filter((result) => result.status === "would-run");
  const requestedConcurrency = settings.runControl.requestedConcurrency ?? Math.max(1, runnableJobs.length);
  const maxConcurrentJobs = settings.runControl.maxConcurrentJobs ?? settings.schedule.maxScheduledJobs;
  const concurrencyExceeded = requestedConcurrency > maxConcurrentJobs;
  const validationBlocked = validationIssues.some((issue) => issue.severity === "error") || status === "blocked";
  const rows = [
    {
      key: "mode",
      state: modeSupported ? "ready" : "blocked",
      nextAction: modeSupported
        ? "return-existing-run-control-mode"
        : "select-supported-mailchimp-run-control-mode",
      evidence: { requestedMode, supportedModes },
    },
    {
      key: "freeze-window",
      state: activeFreezeWindow ? "waiting" : "ready",
      nextAction: activeFreezeWindow
        ? "wait-for-mailchimp-run-control-window"
        : "return-existing-freeze-window-state",
      evidence: {
        activeFreezeWindowId: activeFreezeWindow?.id ?? null,
        freezeWindowCount: freezeWindows.length,
        now: settings.runControl.now,
      },
    },
    {
      key: "concurrency",
      state: concurrencyExceeded ? "blocked" : "ready",
      nextAction: concurrencyExceeded
        ? "reduce-mailchimp-runtime-concurrency"
        : "return-existing-run-control-concurrency",
      evidence: { requestedConcurrency, maxConcurrentJobs },
    },
  ];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const state = validationBlocked || blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "ready";
  const nextAction = blockedRows[0]?.nextAction
    ?? waitingRows[0]?.nextAction
    ?? "handoff-to-runtime-adapter";
  const controlKey = stableId("dryrunctrl", [
    plan.id,
    requestedMode,
    state,
    requestedConcurrency,
    maxConcurrentJobs,
    activeFreezeWindow?.id,
  ]);

  return {
    schemaVersion: "aios.mailchimp.dry-run-lifecycle-run-control.v1",
    controlKey,
    state,
    ready: state === "ready",
    nextAction,
    requestedMode,
    supportedModes,
    freezeWindow: {
      active: Boolean(activeFreezeWindow),
      activeWindow: activeFreezeWindow ? {
        id: activeFreezeWindow.id,
        reason: activeFreezeWindow.reason,
        start: activeFreezeWindow.start,
        end: activeFreezeWindow.end,
      } : null,
      windows: freezeWindows.map((window) => ({
        id: window.id,
        reason: window.reason,
        start: window.start,
        end: window.end,
      })),
    },
    concurrency: {
      requested: requestedConcurrency,
      max: maxConcurrentJobs,
      exceeded: concurrencyExceeded,
      runnableJobIds: runnableJobs.map((result) => result.jobId),
    },
    rows,
    validationSummary: {
      blockedRowKeys: blockedRows.map((row) => row.key),
      waitingRowKeys: waitingRows.map((row) => row.key),
      validationIssueCodes: validationIssues.map((issue) => issue.code),
      planStatus: status,
    },
    clientPatch: {
      lifecycleRunControlKey: controlKey,
      lifecycleRunControlState: state,
      lifecycleRunControlReady: state === "ready",
      lifecycleRunControlNextAction: nextAction,
      lifecycleRunControlFreezeWindowId: activeFreezeWindow?.id ?? null,
      lifecycleRunControlConcurrencyExceeded: concurrencyExceeded,
    },
    dryRunGuarantee: {
      externalWritesPerformed: false,
      adapterCallsPerformed: false,
      runtimeStarted: false,
      restartSafe: state !== "blocked",
    },
  };
}

function buildLifecycleCommands(settings, plan, jobResults, status, validationIssues) {
  const blocked = validationIssues.some((issue) => issue.severity === "error") || status === "blocked";
  const runnableJobs = jobResults.filter((result) => result.status === "would-run");
  const approvalJobs = jobResults.filter((result) => result.status === "degraded");
  const commandScope = [
    plan.id,
    settings.command,
    settings.enabled,
    settings.schedule.mode,
    runnableJobs.map((result) => result.jobId).join(","),
  ];
  const commands = [
    {
      id: stableId("life", [...commandScope, "persist-controls"]),
      type: "persist-lifecycle-controls",
      enabled: settings.enabled,
      scheduleMode: settings.schedule.mode,
      statusAfterReplay: blocked ? "blocked" : "controls-persisted",
      idempotencyKey: stableId("idem", [...commandScope, "persist-controls"]),
    },
  ];
  if (!blocked && settings.enabled && runnableJobs.length > 0) {
    commands.push({
      id: stableId("life", [...commandScope, "prepare-handoff"]),
      type: "prepare-runtime-handoff",
      jobIds: runnableJobs.map((result) => result.jobId),
      statusAfterReplay: settings.schedule.mode === "manual" ? "ready-for-manual-release" : "scheduled",
      idempotencyKey: stableId("idem", [...commandScope, "prepare-handoff"]),
    });
  }
  if (!blocked && approvalJobs.length > 0 && settings.allowApprovalPause) {
    commands.push({
      id: stableId("life", [...commandScope, "pause-for-approval"]),
      type: "pause-for-approval",
      jobIds: approvalJobs.map((result) => result.jobId),
      statusAfterReplay: "waiting-for-approval",
      idempotencyKey: stableId("idem", [...commandScope, "pause-for-approval"]),
    });
  }
  if (settings.command === "disable" || settings.command === "cancel") {
    commands.push({
      id: stableId("life", [...commandScope, "release-hold"]),
      type: "release-runtime-hold",
      jobIds: jobResults.map((result) => result.jobId),
      statusAfterReplay: "disabled",
      idempotencyKey: stableId("idem", [...commandScope, "release-hold"]),
    });
  }
  if (settings.schedule.paused) {
    commands.push({
      id: stableId("life", [...commandScope, "pause-schedule"]),
      type: "pause-lifecycle-schedule",
      reason: settings.schedule.pauseReason || "operator-requested",
      statusAfterReplay: "schedule-paused",
      idempotencyKey: stableId("idem", [...commandScope, "pause-schedule"]),
    });
  }
  if (settings.operatorHold.active) {
    commands.push({
      id: stableId("life", [...commandScope, "operator-hold"]),
      type: settings.operatorHold.releasedAt ? "release-operator-lifecycle-hold" : "hold-for-operator-release",
      reason: settings.operatorHold.reason || "operator-hold",
      releasedBy: settings.operatorHold.releasedBy || null,
      releasedAt: settings.operatorHold.releasedAt || null,
      statusAfterReplay: settings.operatorHold.releasedAt ? "operator-hold-released" : "operator-hold-active",
      idempotencyKey: stableId("idem", [...commandScope, "operator-hold"]),
    });
  }
  return commands;
}

function deriveLifecycleNextAction(settings, status, validationIssues, commands) {
  const firstError = validationIssues.find((issue) => issue.severity === "error");
  if (firstError) {
    return {
      state: "blocked",
      action: "repair-lifecycle-settings",
      reason: firstError.code,
      commandId: commands[0]?.id ?? null,
    };
  }
  if (!settings.enabled || settings.command === "disable") {
    return {
      state: "disabled",
      action: "hold-runtime-handoff",
      reason: "lifecycle-disabled",
      commandId: commands.at(-1)?.id ?? null,
    };
  }
  if (settings.schedule.paused) {
    return {
      state: "paused",
      action: "resume-lifecycle-schedule",
      reason: "schedule-paused",
      commandId: commands.find((command) => command.type === "pause-lifecycle-schedule")?.id ?? commands[0]?.id ?? null,
    };
  }
  if (status === "degraded") {
    return {
      state: "waiting",
      action: "collect-approval-or-repair-state",
      reason: "dry-run-degraded",
      commandId: commands.find((command) => command.type === "pause-for-approval")?.id ?? null,
    };
  }
  if (settings.schedule.mode === "immediate") {
    return {
      state: "ready",
      action: "release-runtime-handoff",
      reason: "immediate-schedule",
      commandId: commands.find((command) => command.type === "prepare-runtime-handoff")?.id ?? null,
    };
  }
  if (settings.schedule.mode === "windowed") {
    return {
      state: "scheduled",
      action: "wait-for-schedule-window",
      reason: "windowed-schedule",
      commandId: commands.find((command) => command.type === "prepare-runtime-handoff")?.id ?? null,
    };
  }
  return {
    state: status === "admitted" ? "ready" : "review",
    action: status === "admitted" ? "manual-release" : "review-dry-run",
    reason: status,
    commandId: commands.find((command) => command.type === "prepare-runtime-handoff")?.id ?? commands[0]?.id ?? null,
  };
}

function buildLifecycleOperatorControls(plan, jobResults, settings, validationIssues, commands, nextAction, status) {
  const validationSummary = summarizeLifecycleValidation(validationIssues, jobResults, settings);
  const requiredActions = normalizeAuditList(plan.jobs.map((job) => job.operation || job.action));
  const disabledRequiredActions = requiredActions.filter((action) => lifecycleActionDisabled(settings, action));
  const disabledWriteActions = jobResults
    .filter((result) => lifecycleActionDisabled(settings, result.operation))
    .map((result) => result.operation);
  const runtimeStartEnabled = settings.enabled && validationSummary.blocked === 0 && status === "admitted";
  const controls = [
    {
      id: "runtime-start",
      label: "Runtime start",
      status: nextAction.state,
      enabled: runtimeStartEnabled,
      required: true,
      nextAction: nextAction.action,
      disableReason: !settings.enabled
        ? "lifecycle-disabled"
        : validationSummary.blocked > 0
          ? validationIssues.find((issue) => issue.severity === "error")?.code
          : null,
    },
    {
      id: "operator-acceptance",
      label: "Operator acceptance",
      status: settings.operatorHold.active && !settings.operatorHold.releasedAt ? "blocked" : "ready",
      enabled: !(settings.operatorHold.active && !settings.operatorHold.releasedAt),
      required: settings.requireOperatorAcceptance,
      nextAction: settings.operatorHold.active && !settings.operatorHold.releasedAt
        ? "release-operator-lifecycle-hold"
        : "continue-lifecycle-review",
      disableReason: settings.operatorHold.active && !settings.operatorHold.releasedAt
        ? settings.operatorHold.reason || "operator-hold-active"
        : null,
    },
    {
      id: "schedule",
      label: "Schedule",
      status: settings.schedule.paused ? "paused" : settings.schedule.mode,
      enabled: settings.enabled && settings.schedule.paused !== true,
      required: settings.command === "schedule",
      nextAction: settings.schedule.paused ? "resume-lifecycle-schedule" : nextAction.action,
      disableReason: settings.schedule.paused ? settings.schedule.pauseReason || "schedule-paused" : null,
    },
    {
      id: "capability-enablement",
      label: "Capability enablement",
      status: disabledRequiredActions.length > 0 ? "blocked" : "ready",
      enabled: disabledRequiredActions.length === 0,
      required: requiredActions.length > 0,
      nextAction: disabledRequiredActions.length > 0
        ? "enable-required-mailchimp-actions"
        : "continue-lifecycle-review",
      disableReason: disabledRequiredActions.length > 0
        ? `disabled required actions: ${disabledRequiredActions.join(", ")}`
        : null,
    },
  ];
  const stateKey = stableId("lifectrl", [
    plan.id,
    settings.command,
    nextAction.state,
    validationSummary.issueCodes.join(","),
    settings.disabledActions.join(","),
  ]);
  const controlsStatus = validationSummary.blocked > 0 || status === "blocked"
    ? "blocked"
    : validationSummary.warnings > 0 || nextAction.state === "paused"
      ? "waiting"
      : "ready";
  return {
    schemaVersion: "aios.mailchimp.dry-run-operator-controls.v1",
    stateKey,
    status: controlsStatus,
    nextAction: nextAction.action,
    validationSummary,
    runtimeStart: {
      enabled: runtimeStartEnabled,
      acceptedStatus: status,
      commandId: commands.find((command) => command.type === "prepare-runtime-handoff")?.id ?? null,
    },
    capabilityControls: {
      enabledActions: settings.enabledActions,
      disabledActions: settings.disabledActions,
      disabledRequiredActions,
      disabledWriteActions: normalizeAuditList(disabledWriteActions),
    },
    schedule: {
      ...settings.schedule,
      commandId: commands.find((command) => command.type === "pause-lifecycle-schedule")?.id
        ?? commands.find((command) => command.type === "prepare-runtime-handoff")?.id
        ?? null,
    },
    operatorHold: settings.operatorHold,
    controls,
    clientPatch: {
      lifecycleControlsStateKey: stateKey,
      lifecycleControlsStatus: controlsStatus,
      lifecycleControlsNextAction: nextAction.action,
      runtimeStartEnabled,
      schedulePaused: settings.schedule.paused === true,
      disabledRequiredActions,
    },
  };
}

function normalizeOperatorChecklistDecision(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const acceptedIds = normalizeAuditList(source.acceptedChecklistIds ?? source.acceptedIds ?? source.accepted);
  const acknowledgedCheckKeys = normalizeAuditList(source.acknowledgedCheckKeys ?? source.acknowledgedKeys ?? source.acknowledged);
  const forceRelease = source.forceRelease === true || source.override === true;
  return {
    acceptedIds,
    acknowledgedCheckKeys,
    forceRelease,
    actorId: source.actorId ? String(source.actorId) : null,
    decidedAt: source.decidedAt ? String(source.decidedAt) : "dry-run",
  };
}

function buildOperatorReleaseChecklistDryRun(plan, lifecycle, jobResults, options = {}) {
  const source = plan.operatorReleaseChecklist
    ?? plan.package?.operatorReleaseChecklist
    ?? plan.package?.lifecycleControls?.operatorReleaseChecklist
    ?? {};
  const decision = normalizeOperatorChecklistDecision(options.operatorRelease ?? options.operatorChecklist ?? {});
  const checks = Array.isArray(source.checks) ? source.checks : [];
  const blockedChecks = checks.filter((check) => check.state === "blocked");
  const waitingChecks = checks.filter((check) => check.state === "waiting");
  const reviewChecks = checks.filter((check) => check.state === "review");
  const unacknowledgedReviewChecks = reviewChecks.filter((check) => !decision.acknowledgedCheckKeys.includes(check.key));
  const checklistAccepted = source.id ? decision.acceptedIds.includes(source.id) : false;
  const forceReleaseAllowed = decision.forceRelease
    && blockedChecks.length === 0
    && lifecycle.operatorControls?.runtimeStart?.enabled === true;
  const readyFromSource = source.ready === true && source.state === "ready";
  const ready = (readyFromSource && (checklistAccepted || source.requiredInputNames?.length === 0))
    || forceReleaseAllowed;
  const state = blockedChecks.length > 0
    ? "blocked"
    : waitingChecks.length > 0
      ? "waiting"
      : unacknowledgedReviewChecks.length > 0
        ? "needs-operator-ack"
        : ready
          ? "ready"
          : "needs-operator-acceptance";
  const requiredInputNames = source.requiredInputNames ?? [];
  const command = {
    commandId: stableId("dryopcmd", [
      plan.id,
      source.id,
      state,
      decision.acceptedIds.join(","),
      decision.acknowledgedCheckKeys.join(","),
    ]),
    sourceCommandId: source.command?.id ?? null,
    type: "dry-run-operator-release-checklist",
    idempotencyKey: stableId("idem", [
      plan.id,
      source.id,
      "dry-run-operator-release-checklist",
      state,
    ]),
    stateAfterReplay: state,
    externalWritesPerformed: false,
    writes: ["operatorReleaseChecklistState", "acknowledgedCheckKeys", "acceptedChecklistIds"],
  };
  const jobRows = jobResults.map((result) => ({
    jobId: result.jobId,
    operation: result.operation,
    status: result.status,
    releaseBlocked: state === "blocked" || result.status === "blocked" || result.status === "skipped",
    releaseWaiting: ["waiting", "needs-operator-ack", "needs-operator-acceptance"].includes(state)
      || result.status === "degraded",
    nextAction: state === "blocked"
      ? "repair-operator-release-checklist"
      : state === "waiting"
        ? "wait-for-release-window"
        : state === "needs-operator-ack"
          ? "acknowledge-operator-release-checks"
          : state === "needs-operator-acceptance"
            ? "accept-operator-release-checklist"
            : result.reason === "approval-required"
              ? "collect-approval"
              : "release-runtime-command",
  }));
  return {
    schemaVersion: "aios.mailchimp.dry-run-operator-release-checklist.v1",
    id: stableId("dryopcheck", [
      plan.id,
      source.id,
      state,
      jobRows.map((row) => `${row.jobId}:${row.releaseBlocked}:${row.releaseWaiting}`).join(","),
    ]),
    sourceChecklistId: source.id ?? null,
    state,
    ready,
    visibleStatus: state === "ready"
      ? "operator-release-ready"
      : state === "waiting"
        ? "operator-release-waiting"
        : state === "needs-operator-ack"
          ? "operator-release-needs-ack"
          : state === "needs-operator-acceptance"
            ? "operator-release-needs-acceptance"
            : "operator-release-blocked",
    nextAction: state === "blocked"
      ? blockedChecks[0]?.nextAction ?? "repair-operator-release-checklist"
      : state === "waiting"
        ? waitingChecks[0]?.nextAction ?? "wait-for-release-window"
        : state === "needs-operator-ack"
          ? unacknowledgedReviewChecks[0]?.nextAction ?? "acknowledge-operator-release-checks"
          : state === "needs-operator-acceptance"
            ? "accept-operator-release-checklist"
            : "release-runtime-command",
    decision,
    requiredInputNames,
    checks,
    jobRows,
    command,
    validationSummary: {
      sourceState: source.state ?? "unknown",
      sourceReady: source.ready === true,
      accepted: checklistAccepted,
      forceRelease: decision.forceRelease,
      forceReleaseAllowed,
      blockedCheckKeys: blockedChecks.map((check) => check.key),
      waitingCheckKeys: waitingChecks.map((check) => check.key),
      reviewCheckKeys: reviewChecks.map((check) => check.key),
      unacknowledgedReviewCheckKeys: unacknowledgedReviewChecks.map((check) => check.key),
      blockedJobIds: jobRows.filter((row) => row.releaseBlocked).map((row) => row.jobId),
      waitingJobIds: jobRows.filter((row) => row.releaseWaiting).map((row) => row.jobId),
    },
    clientPatch: {
      operatorReleaseChecklistDryRunId: stableId("dryopcheckpatch", [plan.id, source.id, state]),
      operatorReleaseChecklistState: state,
      operatorReleaseChecklistReady: ready,
      operatorReleaseChecklistNextAction: state === "ready" ? "release-runtime-command" : null,
      operatorReleaseChecklistCommandId: command.commandId,
      operatorReleaseBlockedJobIds: jobRows.filter((row) => row.releaseBlocked).map((row) => row.jobId),
      operatorReleaseWaitingJobIds: jobRows.filter((row) => row.releaseWaiting).map((row) => row.jobId),
    },
  };
}

function buildLifecycleControls(plan, jobResults, status, options = {}) {
  const settings = normalizeLifecycleSettings(options);
  const validationIssues = validateLifecycleSettings(settings, plan, jobResults, status);
  const commands = buildLifecycleCommands(settings, plan, jobResults, status, validationIssues);
  const nextAction = deriveLifecycleNextAction(settings, status, validationIssues, commands);
  const errorFree = validationIssues.every((issue) => issue.severity !== "error");
  const runControl = buildLifecycleRunControlDryRun(plan, settings, jobResults, validationIssues, status);
  const operatorControls = buildLifecycleOperatorControls(
    plan,
    jobResults,
    settings,
    validationIssues,
    commands,
    runControl.ready ? nextAction : {
      state: runControl.state,
      action: runControl.nextAction,
      reason: "lifecycle-run-control",
      commandId: commands[0]?.id ?? null,
    },
    status,
  );
  const operatorReleaseChecklist = buildOperatorReleaseChecklistDryRun(
    plan,
    { operatorControls },
    jobResults,
    options,
  );
  return {
    settings,
    valid: errorFree,
    validationIssues,
    validationSummary: operatorControls.validationSummary,
    runControl,
    operatorControls,
    operatorReleaseChecklist,
    controls: {
      enable: {
        allowed: settings.enabled && errorFree,
        commandId: commands.find((command) => command.type === "persist-lifecycle-controls")?.id ?? null,
      },
      disable: {
        allowed: true,
        commandId: commands.find((command) => command.type === "release-runtime-hold")?.id
          ?? stableId("life", [plan.id, "disable-preview"]),
      },
      schedule: {
        mode: settings.schedule.mode,
        allowed: settings.enabled && errorFree && runControl.ready,
        windowStart: settings.schedule.windowStart,
        windowEnd: settings.schedule.windowEnd,
        paused: settings.schedule.paused,
        maxScheduledJobs: settings.schedule.maxScheduledJobs,
      },
      runControl: {
        allowed: runControl.ready,
        state: runControl.state,
        nextAction: runControl.nextAction,
        controlKey: runControl.controlKey,
        freezeWindowActive: runControl.freezeWindow.active,
        concurrencyExceeded: runControl.concurrency.exceeded,
      },
    },
    commands,
    nextAction: runControl.ready ? nextAction : {
      state: runControl.state,
      action: runControl.nextAction,
      reason: "lifecycle-run-control",
      commandId: commands[0]?.id ?? null,
    },
  };
}

function buildLifecycleRuntimeControlDryRun(plan, lifecycle, jobResults, status) {
  const source = plan.lifecycleRuntimeControl ?? plan.package?.lifecycleRuntimeControl ?? {};
  const sourceRows = Array.isArray(source.rows) ? source.rows : [];
  const resultByJobId = new Map(jobResults.map((result) => [result.jobId, result]));
  const runtimeStartEnabled = lifecycle?.operatorControls?.runtimeStart?.enabled === true;
  const lifecycleValid = lifecycle?.valid === true;
  const lifecycleBlocked = lifecycle?.validationIssues?.some((issue) => issue.severity === "error") === true;
  const runControlBlocked = lifecycle?.runControl?.state === "blocked";
  const runControlWaiting = lifecycle?.runControl?.state === "waiting";
  const disabledBySettings = lifecycle?.settings?.enabled === false || lifecycle?.settings?.command === "disable";
  const schedulePaused = lifecycle?.settings?.schedule?.paused === true;
  const jobRows = jobResults.map((result, index) => {
    const resultBlocked = ["blocked", "skipped"].includes(result.status);
    const resultWaiting = result.status === "degraded"
      || result.adapterStatusProbe?.state === "paused";
    const state = resultBlocked
      ? "blocked"
      : resultWaiting
        ? "waiting"
        : "ready";
    const healthBlocker = result.health?.checks?.find((check) => check.status === "fail") ?? null;
    const healthPause = result.health?.checks?.find((check) => check.status === "degraded") ?? null;
    return {
      sequence: index + 1,
      jobId: result.jobId,
      operation: result.operation,
      state,
      dryRunStatus: result.status,
      reason: result.reason,
      adapterStatusState: result.adapterStatusProbe?.state ?? "unknown",
      visibleStatus: result.adapterStatusProbe?.visibleStatus ?? result.state?.statusProjection?.clientVisibleStatus,
      checkpointKey: result.state?.checkpointKey ?? null,
      commandLedgerKey: result.state?.ledgerKey ?? null,
      replayCursor: result.state?.restartReplay?.replayCursor ?? null,
      adapterStatusResumeCursor: result.adapterStatusProbe?.resumeCursor ?? null,
      restartSafe: result.state?.restartReplay?.restartSafe === true,
      nextAction: state === "blocked"
        ? result.recoveryHandoff?.nextAction ?? "repair-runtime-control-job"
        : state === "waiting"
          ? result.recoveryHandoff?.nextAction ?? "resume-runtime-control-job"
          : "return-existing-runtime-control-job",
      blockingReason: healthBlocker?.name ?? (resultBlocked ? result.reason : null),
      waitingReason: healthPause?.name ?? (resultWaiting ? result.reason : null),
    };
  });
  const rows = sourceRows.map((row, index) => {
    const sourceState = row.state ?? "blocked";
    const blockedByRuntime = row.key === "lifecycle-enabled" && disabledBySettings
      || row.key === "settings-command" && disabledBySettings
      || row.key === "schedule" && schedulePaused
      || row.key === "readiness" && status === "blocked";
    const state = blockedByRuntime || sourceState === "blocked"
      ? "blocked"
      : sourceState === "waiting" || sourceState === "review" || (row.key === "acceptance" && status !== "admitted")
        ? "waiting"
        : "ready";
    return {
      sequence: index + 1,
      key: row.key,
      state,
      sourceState,
      sourceId: row.sourceId ?? null,
      required: row.required === true,
      detail: row.detail ?? null,
      nextAction: state === "ready"
        ? "return-existing-runtime-control-row"
        : row.nextAction ?? "review-runtime-control-row",
      commandId: row.commandId ?? null,
      blockedByDryRun: blockedByRuntime,
    };
  });
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const blockedJobs = jobRows.filter((row) => row.state === "blocked");
  const waitingJobs = jobRows.filter((row) => row.state === "waiting");
  const state = lifecycleBlocked || blockedRows.length > 0 || blockedJobs.length > 0
    || runControlBlocked
    ? "blocked"
    : waitingRows.length > 0 || waitingJobs.length > 0 || runControlWaiting || !runtimeStartEnabled || !lifecycleValid
      ? "waiting"
      : "ready";
  const nextAction = blockedRows[0]?.nextAction
    ?? blockedJobs[0]?.nextAction
    ?? (runControlBlocked ? lifecycle.runControl.nextAction : null)
    ?? waitingRows[0]?.nextAction
    ?? waitingJobs[0]?.nextAction
    ?? (runControlWaiting ? lifecycle.runControl.nextAction : null)
    ?? (runtimeStartEnabled ? "release-runtime-handoff" : "enable-runtime-start");
  const commandId = source.command?.id ?? stableId("drylifertcmd", [plan.id, source.id, state]);
  return {
    protocol: "aios.mailchimp.dry-run-lifecycle-runtime-control.v1",
    id: stableId("drylifert", [
      plan.id,
      source.id,
      state,
      rows.map((row) => `${row.key}:${row.state}`).join(","),
      jobRows.map((row) => `${row.jobId}:${row.state}`).join(","),
    ]),
    sourceControlId: source.id ?? null,
    product: "mailchimp",
    planId: plan.id,
    state,
    ready: state === "ready",
    releaseAllowed: state === "ready" && runtimeStartEnabled,
    visibleStatus: state === "ready"
      ? "dry-run-runtime-control-ready"
      : state === "waiting"
        ? "dry-run-runtime-control-waiting"
        : "dry-run-runtime-control-blocked",
    nextAction,
    rows,
    jobRows,
    command: {
      commandId,
      type: source.command?.type ?? "persist-lifecycle-runtime-control",
      idempotencyKey: source.command?.idempotencyKey ?? stableId("idem", [plan.id, source.id, state, "dry-lifecycle-runtime-control"]),
      dryRun: true,
      wouldPersist: state !== "blocked",
      statusAfterReplay: state === "ready" ? "runtime-control-ready" : `runtime-control-${state}`,
      conflict: source.command?.conflict ?? "return-existing",
    },
    counters: {
      rows: rows.length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      readyRows: rows.filter((row) => row.state === "ready").length,
      blockedJobs: blockedJobs.length,
      waitingJobs: waitingJobs.length,
      readyJobs: jobRows.filter((row) => row.state === "ready").length,
      lifecycleValidationErrors: lifecycle?.validationIssues?.filter((issue) => issue.severity === "error").length ?? 0,
      runtimeStartEnabled: runtimeStartEnabled ? 1 : 0,
      schedulePaused: schedulePaused ? 1 : 0,
      runControlBlocked: runControlBlocked ? 1 : 0,
      runControlWaiting: runControlWaiting ? 1 : 0,
    },
    validationSummary: {
      sourceState: source.state ?? "unknown",
      sourceReady: source.ready === true,
      lifecycleValid,
      runtimeStartEnabled,
      disabledBySettings,
      schedulePaused,
      runControlState: lifecycle?.runControl?.state ?? "unknown",
      runControlNextAction: lifecycle?.runControl?.nextAction ?? null,
      runControlFreezeWindowActive: lifecycle?.runControl?.freezeWindow?.active === true,
      runControlConcurrencyExceeded: lifecycle?.runControl?.concurrency?.exceeded === true,
      blockedControlKeys: blockedRows.map((row) => row.key),
      waitingControlKeys: waitingRows.map((row) => row.key),
      blockedJobIds: blockedJobs.map((row) => row.jobId),
      waitingJobIds: waitingJobs.map((row) => row.jobId),
      blockingReasons: [...new Set([
        ...blockedRows.map((row) => row.key),
        ...blockedJobs.map((row) => row.blockingReason).filter(Boolean),
      ])].sort(),
      waitingReasons: [...new Set([
        ...waitingRows.map((row) => row.key),
        ...waitingJobs.map((row) => row.waitingReason).filter(Boolean),
      ])].sort(),
    },
    clientPatch: {
      dryRunLifecycleRuntimeControlId: stableId("drylifertpatch", [plan.id, source.id, state]),
      dryRunLifecycleRuntimeControlState: state,
      dryRunLifecycleRuntimeControlReady: state === "ready",
      dryRunLifecycleRuntimeControlNextAction: nextAction,
      blockedControlKeys: blockedRows.map((row) => row.key),
      waitingControlKeys: waitingRows.map((row) => row.key),
      blockedJobIds: blockedJobs.map((row) => row.jobId),
      waitingJobIds: waitingJobs.map((row) => row.jobId),
      lifecycleRunControlState: lifecycle?.runControl?.state ?? "unknown",
      lifecycleRunControlNextAction: lifecycle?.runControl?.nextAction ?? null,
    },
    dryRunGuarantee: {
      externalWritesPerformed: false,
      adapterCallsPerformed: false,
      runtimeStarted: false,
      restartSafe: state !== "blocked" && jobRows.every((row) => row.restartSafe),
    },
    restartSemantics: {
      onRestart: state === "ready" ? "return-existing-dry-run-runtime-control" : "rebuild-dry-run-runtime-control",
      onDuplicateCommand: "return-existing-lifecycle-runtime-control-command",
      externalWritesPerformed: false,
    },
  };
}

function buildClientReadinessDryRun(plan, jobResults, lifecycle, acceptancePreview, providerReleaseContract, tenantBoundaryMatrix) {
  const source = plan.clientReadinessPacket ?? {};
  const sourceRows = Array.isArray(source.rows) ? source.rows : [];
  const sourceOperationRows = Array.isArray(source.operationRows) ? source.operationRows : [];
  const resultByJobId = new Map(jobResults.map((result) => [result.jobId, result]));
  const runtimeReleaseBlocked = providerReleaseContract?.ready === false || providerReleaseContract?.state === "blocked";
  const tenantBlockedJobIds = new Set(tenantBoundaryMatrix?.clientPatch?.tenantBoundaryBlockedJobs ?? []);
  const tenantWaitingJobIds = new Set(tenantBoundaryMatrix?.clientPatch?.tenantBoundaryApprovalJobs ?? []);
  const rows = sourceRows.map((row, index) => {
    const missingInputs = Array.isArray(row.missingInputs) ? row.missingInputs : [];
    const blockedBySource = row.state === "blocked";
    const waitingBySource = ["review", "waiting"].includes(row.state);
    const state = blockedBySource
      ? "blocked"
      : waitingBySource
        ? "waiting"
        : row.state === "ready"
          ? "ready"
          : "review";
    return {
      sequence: index + 1,
      key: row.key,
      label: row.label,
      sourceId: row.sourceId ?? null,
      state,
      visibleStatus: row.visibleStatus,
      required: row.required === true,
      nextAction: state === "ready" ? "return-existing-readiness-row" : row.nextAction,
      commandId: row.commandId ?? null,
      missingInputs,
      dryRun: {
        persisted: false,
        wouldPersist: state !== "blocked" && missingInputs.length === 0,
        externalWritesPerformed: false,
      },
    };
  });
  const operationRows = sourceOperationRows.map((row, index) => {
    const result = resultByJobId.get(row.jobId);
    const healthBlocker = result?.health?.checks?.find((check) => check.status === "fail") ?? null;
    const healthPause = result?.health?.checks?.find((check) => check.status === "degraded") ?? null;
    const blocked = tenantBlockedJobIds.has(row.jobId)
      || ["blocked", "skipped"].includes(result?.status)
      || healthBlocker
      || row.adapterStatusState === "blocked";
    const waiting = !blocked && (
      tenantWaitingJobIds.has(row.jobId)
      || result?.status === "degraded"
      || row.permissionDecision === "needs-approval"
      || row.adapterStatusState === "waiting-for-approval"
      || healthPause
    );
    const state = blocked ? "blocked" : waiting ? "waiting" : "ready";
    return {
      sequence: index + 1,
      jobId: row.jobId,
      operation: row.operation,
      state,
      permissionDecision: row.permissionDecision,
      sourceVisibleStatus: row.visibleStatus,
      dryRunStatus: result?.status ?? "unknown",
      adapterStatusState: row.adapterStatusState,
      statusCommandId: row.statusCommandId ?? null,
      resumeCursor: row.resumeCursor ?? result?.adapterStatusProbe?.resumeCursor ?? null,
      restartSafe: row.restartSafe === true && result?.state?.restartReplay?.restartSafe !== false,
      nextAction: blocked
        ? healthBlocker?.name === "tenant-permission" || tenantBlockedJobIds.has(row.jobId)
          ? "resolve-tenant-permission-boundary"
          : result?.recoveryHandoff?.nextAction ?? "repair-client-readiness-operation"
        : waiting
          ? healthPause?.name === "tenant-permission" || tenantWaitingJobIds.has(row.jobId)
            ? "collect-tenant-approval"
            : result?.recoveryHandoff?.nextAction ?? "resume-client-readiness-operation"
          : "return-existing-operation-readiness",
      blocker: healthBlocker?.name ?? (tenantBlockedJobIds.has(row.jobId) ? "tenant-boundary" : null),
      waiter: healthPause?.name ?? (tenantWaitingJobIds.has(row.jobId) ? "tenant-approval" : null),
    };
  });
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting" || row.state === "review");
  const blockedOperations = operationRows.filter((row) => row.state === "blocked");
  const waitingOperations = operationRows.filter((row) => row.state === "waiting");
  const accepted = acceptancePreview?.accepted === true;
  const lifecycleValid = lifecycle?.valid === true;
  const state = blockedRows.length > 0 || blockedOperations.length > 0 || runtimeReleaseBlocked
    ? "blocked"
    : waitingRows.length > 0 || waitingOperations.length > 0 || !accepted || !lifecycleValid
      ? "waiting"
      : "ready";
  const command = {
    commandId: source.command?.id ?? stableId("dryclientreadycmd", [plan.id, source.id, state]),
    type: "persist-client-readiness-packet",
    idempotencyKey: source.command?.idempotencyKey ?? stableId("idem", [plan.id, source.id, state, "client-readiness"]),
    dryRun: true,
    wouldPersist: state !== "blocked",
    statusAfterReplay: state === "ready" ? "client-readiness-ready" : `client-readiness-${state}`,
    conflict: source.command?.conflict ?? "return-existing",
  };
  return {
    schemaVersion: "aios.mailchimp.dry-run-client-readiness.v1",
    id: stableId("dryclientready", [
      plan.id,
      source.id,
      state,
      operationRows.map((row) => `${row.jobId}:${row.state}`).join(","),
    ]),
    sourcePacketId: source.id ?? null,
    product: "mailchimp",
    planId: plan.id,
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "dry-run-client-readiness-ready"
      : state === "waiting"
        ? "dry-run-client-readiness-waiting"
        : "dry-run-client-readiness-blocked",
    nextAction: blockedRows[0]?.nextAction
      ?? blockedOperations[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? waitingOperations[0]?.nextAction
      ?? (accepted ? "persist-client-readiness-packet" : "accept-dry-run-before-runtime-start"),
    rows,
    operationRows,
    command,
    validationSummary: {
      sourceState: source.state ?? "unknown",
      sourceReady: source.ready === true,
      dryRunAccepted: accepted,
      lifecycleValid,
      providerReleaseReady: providerReleaseContract?.ready === true,
      blockedReadinessKeys: blockedRows.map((row) => row.key),
      waitingReadinessKeys: waitingRows.map((row) => row.key),
      blockedJobIds: blockedOperations.map((row) => row.jobId),
      waitingJobIds: waitingOperations.map((row) => row.jobId),
      missingInputNames: [...new Set(rows.flatMap((row) => row.missingInputs))].sort(),
    },
    clientPatch: {
      dryRunClientReadinessId: stableId("dryclientreadypatch", [plan.id, source.id, state]),
      dryRunClientReadinessState: state,
      dryRunClientReadinessReady: state === "ready",
      dryRunClientReadinessNextAction: state === "ready" ? "persist-client-readiness-packet" : null,
      dryRunClientReadinessBlockedKeys: blockedRows.map((row) => row.key),
      dryRunClientReadinessWaitingKeys: waitingRows.map((row) => row.key),
      dryRunClientReadinessBlockedJobs: blockedOperations.map((row) => row.jobId),
      dryRunClientReadinessWaitingJobs: waitingOperations.map((row) => row.jobId),
    },
    dryRunGuarantee: {
      externalWritesPerformed: false,
      adapterCallsPerformed: false,
      clientReadinessPersisted: false,
      restartSafe: state !== "blocked" && operationRows.every((row) => row.restartSafe),
    },
  };
}

function buildClientWorkflowHandoffDryRun(plan, jobResults, clientReadinessDryRun, providerReleaseContract) {
  const source = plan.clientWorkflowHandoffGate ?? {};
  const sourceRows = Array.isArray(source.workflowRows) ? source.workflowRows : [];
  const sourceJobRows = Array.isArray(source.jobRows) ? source.jobRows : [];
  const resultByJobId = new Map(jobResults.map((result) => [result.jobId, result]));
  const providerBlocked = providerReleaseContract?.state === "blocked" || providerReleaseContract?.ready === false;
  const readinessBlocked = clientReadinessDryRun?.state === "blocked";
  const workflowRows = sourceRows.map((row, index) => {
    const sourceState = row.state ?? "blocked";
    const blocked = sourceState === "blocked"
      || (row.key === "provider-health" && providerBlocked)
      || (row.key === "client-readiness" && readinessBlocked);
    const waiting = !blocked && ["waiting", "review"].includes(sourceState);
    const state = blocked ? "blocked" : waiting ? "waiting" : "ready";
    return {
      sequence: index + 1,
      key: row.key,
      state,
      sourceState,
      sourceId: row.sourceId ?? null,
      visibleStatus: row.visibleStatus ?? state,
      nextAction: state === "ready" ? "return-existing-workflow-row" : row.nextAction ?? "review-client-workflow-handoff",
      commandId: row.commandId ?? null,
      resumeCursor: row.resumeCursor ?? null,
      blockingReason: blocked
        ? row.blockingReason
          ?? (row.key === "provider-health" && providerBlocked ? "provider-release-blocked" : null)
          ?? (row.key === "client-readiness" && readinessBlocked ? "client-readiness-blocked" : null)
          ?? "workflow-row-blocked"
        : null,
      dryRun: {
        persisted: false,
        wouldPersist: state !== "blocked",
        externalWritesPerformed: false,
      },
    };
  });
  const jobRows = sourceJobRows.map((row, index) => {
    const result = resultByJobId.get(row.jobId);
    const failingCheck = result?.health?.checks?.find((check) => check.status === "fail") ?? null;
    const degradedCheck = result?.health?.checks?.find((check) => check.status === "degraded") ?? null;
    const adapterProbeBlocked = result?.adapterStatusProbe?.state === "blocked";
    const adapterProbePaused = result?.adapterStatusProbe?.state === "paused";
    const blocked = row.state === "blocked"
      || ["blocked", "skipped"].includes(result?.status)
      || Boolean(failingCheck)
      || adapterProbeBlocked;
    const waiting = !blocked && (
      row.state === "waiting"
      || result?.status === "degraded"
      || Boolean(degradedCheck)
      || adapterProbePaused
    );
    const state = blocked ? "blocked" : waiting ? "waiting" : "ready";
    return {
      sequence: index + 1,
      jobId: row.jobId,
      operation: row.operation,
      state,
      sourceState: row.state,
      workflowState: row.workflowState,
      visibleStatus: row.visibleStatus ?? result?.state?.clientOperationState?.visibleStatus ?? state,
      nextAction: state === "blocked"
        ? result?.recoveryHandoff?.nextAction ?? row.nextAction ?? "repair-client-workflow-job"
        : state === "waiting"
          ? result?.recoveryHandoff?.nextAction ?? row.nextAction ?? "resume-client-workflow-job"
          : "return-existing-client-workflow-job",
      permissionDecision: row.permissionDecision,
      adapterStatusState: row.adapterStatusState,
      dryRunStatus: result?.status ?? "unknown",
      checkpointKey: row.checkpointKey ?? result?.state?.checkpointKey ?? null,
      commandLedgerKey: row.commandLedgerKey ?? result?.state?.ledgerKey ?? null,
      adapterStatusResumeCursor: row.adapterStatusResumeCursor ?? result?.adapterStatusProbe?.resumeCursor ?? null,
      replayCursor: row.replayCursor ?? result?.state?.restartReplay?.replayCursor ?? null,
      restartSafe: row.restartSafe === true && result?.state?.restartReplay?.restartSafe !== false,
      commandIds: row.commandIds ?? result?.state?.commandIds ?? [],
      blockingReason: blocked
        ? row.blockingReason ?? failingCheck?.name ?? (adapterProbeBlocked ? "adapter-status-blocked" : "job-blocked")
        : null,
      waitingReason: waiting
        ? degradedCheck?.name ?? (adapterProbePaused ? "adapter-status-paused" : "job-waiting")
        : null,
    };
  });
  const blockedRows = workflowRows.filter((row) => row.state === "blocked");
  const waitingRows = workflowRows.filter((row) => row.state === "waiting");
  const blockedJobs = jobRows.filter((row) => row.state === "blocked");
  const waitingJobs = jobRows.filter((row) => row.state === "waiting");
  const state = blockedRows.length > 0 || blockedJobs.length > 0
    ? "blocked"
    : waitingRows.length > 0 || waitingJobs.length > 0
      ? "waiting"
      : source.ready === true && clientReadinessDryRun?.ready === true
        ? "ready"
        : "review";
  const command = {
    commandId: source.commands?.find((entry) => entry.type === "persist-client-workflow-handoff-gate")?.id
      ?? stableId("dryworkflowcmd", [plan.id, source.id, state]),
    type: "persist-client-workflow-handoff-gate",
    idempotencyKey: source.commands?.find((entry) => entry.type === "persist-client-workflow-handoff-gate")?.idempotencyKey
      ?? stableId("idem", [plan.id, source.id, state, "client-workflow"]),
    dryRun: true,
    wouldPersist: state !== "blocked",
    statusAfterReplay: state === "ready" ? "client-workflow-ready" : `client-workflow-${state}`,
    conflict: "return-existing",
  };
  const actionableErrors = [
    ...blockedRows.map((row) => ({
      code: `dry-run.client-workflow.${row.key}.blocked`,
      severity: "error",
      action: row.nextAction,
      detail: row.blockingReason ?? `${row.key} blocks client workflow handoff.`,
    })),
    ...blockedJobs.map((row) => ({
      code: "dry-run.client-workflow.job-blocked",
      severity: "error",
      jobId: row.jobId,
      action: row.nextAction,
      detail: row.blockingReason ?? `${row.operation} blocks client workflow handoff.`,
    })),
    ...waitingRows.map((row) => ({
      code: `dry-run.client-workflow.${row.key}.waiting`,
      severity: "warning",
      action: row.nextAction,
      detail: `${row.key} is waiting before client workflow adoption.`,
    })),
    ...waitingJobs.map((row) => ({
      code: "dry-run.client-workflow.job-waiting",
      severity: "warning",
      jobId: row.jobId,
      action: row.nextAction,
      detail: row.waitingReason ?? `${row.operation} is waiting before client workflow adoption.`,
    })),
  ];
  return {
    schemaVersion: "aios.mailchimp.dry-run-client-workflow-handoff.v1",
    id: stableId("dryworkflowgate", [
      plan.id,
      source.id,
      state,
      workflowRows.map((row) => `${row.key}:${row.state}`).join(","),
      jobRows.map((row) => `${row.jobId}:${row.state}`).join(","),
    ]),
    sourceGateId: source.id ?? null,
    product: "mailchimp",
    planId: plan.id,
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "dry-run-client-workflow-ready"
      : state === "waiting"
        ? "dry-run-client-workflow-waiting"
        : state === "review"
          ? "dry-run-client-workflow-review"
          : "dry-run-client-workflow-blocked",
    nextAction: blockedRows[0]?.nextAction
      ?? blockedJobs[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? waitingJobs[0]?.nextAction
      ?? (state === "ready" ? "adopt-runtime-workflow-handoff" : "review-client-workflow-handoff"),
    workflowRows,
    jobRows,
    command,
    actionableErrors,
    health: {
      status: state === "blocked" ? "unhealthy" : state === "waiting" || state === "review" ? "degraded" : "healthy",
      blockedWorkflowKeys: blockedRows.map((row) => row.key),
      waitingWorkflowKeys: waitingRows.map((row) => row.key),
      blockedJobIds: blockedJobs.map((row) => row.jobId),
      waitingJobIds: waitingJobs.map((row) => row.jobId),
    },
    clientPatch: {
      dryRunWorkflowHandoffGateId: stableId("dryworkflowpatch", [plan.id, source.id, state]),
      dryRunWorkflowHandoffState: state,
      dryRunWorkflowHandoffReady: state === "ready",
      dryRunWorkflowHandoffNextAction: state === "ready" ? "adopt-runtime-workflow-handoff" : null,
      blockedWorkflowKeys: blockedRows.map((row) => row.key),
      waitingWorkflowKeys: waitingRows.map((row) => row.key),
      blockedJobIds: blockedJobs.map((row) => row.jobId),
      waitingJobIds: waitingJobs.map((row) => row.jobId),
      resumeCursors: [...new Set([
        ...(source.resumeCursors ?? []),
        ...jobRows.map((row) => row.adapterStatusResumeCursor),
      ].filter(Boolean))].sort(),
    },
    dryRunGuarantee: {
      externalWritesPerformed: false,
      adapterCallsPerformed: false,
      workflowHandoffPersisted: false,
      restartSafe: state !== "blocked" && jobRows.every((row) => row.restartSafe),
    },
  };
}

function buildClaimOperatorReadinessDryRun(plan, jobResults, clientWorkflowHandoffDryRun) {
  const gate = plan.claimOperatorReadinessGate ?? {};
  const sourcePacket = plan.claimGate?.operatorReadinessPacket ?? plan.claimGate?.operatorReadiness ?? {};
  const workflowGuard = gate.workflowGuard ?? sourcePacket.workflowHandoffGuard ?? {};
  const blockedJobs = jobResults.filter((result) => result.status === "blocked" || result.reason === "permission-denied");
  const waitingJobs = jobResults.filter((result) => (
    result.status === "degraded"
    || result.reason === "approval-required"
    || result.adapterStatusProbe?.state === "paused"
  ));
  const sourceBlockedKeys = gate.clientPatch?.blockedReadinessKeys
    ?? sourcePacket.clientPatch?.blockedReadinessKeys
    ?? sourcePacket.validationSummary?.blockedKeys
    ?? [];
  const sourceWaitingKeys = gate.clientPatch?.waitingReadinessKeys
    ?? sourcePacket.clientPatch?.reviewReadinessKeys
    ?? sourcePacket.validationSummary?.reviewKeys
    ?? [];
  const workflowBlockedKeys = clientWorkflowHandoffDryRun?.clientPatch?.blockedWorkflowKeys ?? [];
  const workflowWaitingKeys = clientWorkflowHandoffDryRun?.clientPatch?.waitingWorkflowKeys ?? [];
  const guardBlockedKeys = workflowGuard.blockedKeys
    ?? gate.clientPatch?.workflowGuardBlockedKeys
    ?? sourcePacket.clientPatch?.workflowGuardBlockedKeys
    ?? [];
  const guardWaitingKeys = workflowGuard.reviewKeys
    ?? gate.clientPatch?.workflowGuardReviewKeys
    ?? sourcePacket.clientPatch?.workflowGuardReviewKeys
    ?? [];
  const guardRows = Array.isArray(workflowGuard.rows) ? workflowGuard.rows : [];
  const guardUnmatchedRows = guardRows.filter((row) => row.matched === false);
  const blockedKeys = [...new Set([
    ...sourceBlockedKeys,
    ...workflowBlockedKeys,
    ...guardBlockedKeys,
    ...guardUnmatchedRows.map((row) => `workflow-guard-mismatch:${row.key}`),
  ])].sort();
  const waitingKeys = [...new Set([...sourceWaitingKeys, ...workflowWaitingKeys, ...guardWaitingKeys])].sort();
  const state = blockedJobs.length > 0
    || blockedKeys.length > 0
    || gate.state === "blocked"
    || workflowGuard.state === "blocked"
    ? "blocked"
    : waitingJobs.length > 0
      || waitingKeys.length > 0
      || gate.state === "waiting"
      || gate.state === "review"
      || workflowGuard.state === "review"
      ? "waiting"
      : gate.ready === true
        ? "ready"
        : "review";
  const visibleStatus = state === "ready"
    ? "claim-operator-dry-run-ready"
    : state === "waiting"
      ? "claim-operator-dry-run-waiting"
      : state === "review"
        ? "review-claim-operator-dry-run"
        : "repair-claim-operator-dry-run";
  const nextAction = state === "blocked"
    ? workflowGuard.nextAction ?? gate.nextAction ?? sourcePacket.nextAction ?? "repair-claim-operator-readiness"
    : state === "waiting"
      ? workflowGuard.nextAction ?? clientWorkflowHandoffDryRun?.nextAction ?? gate.nextAction ?? "resume-claim-operator-readiness"
      : state === "review"
        ? workflowGuard.nextAction ?? gate.nextAction ?? sourcePacket.nextAction ?? "review-claim-operator-readiness"
        : "persist-claim-operator-readiness-gate";
  const dryRunId = stableId("dryclaimop", [
    plan.id,
    gate.id,
    sourcePacket.id,
    state,
    blockedJobs.map((job) => job.jobId).join(","),
    waitingJobs.map((job) => job.jobId).join(","),
  ]);
  return {
    protocol: "aios.mailchimp.claim-operator-readiness-dry-run.v1",
    id: dryRunId,
    product: "mailchimp",
    planId: plan.id,
    sourceGateId: gate.id ?? null,
    sourcePacketId: sourcePacket.id ?? null,
    workflowGuard: workflowGuard.id ? {
      id: workflowGuard.id,
      state: workflowGuard.state,
      ready: workflowGuard.ready === true,
      digest: workflowGuard.digest ?? null,
      blockedKeys: guardBlockedKeys,
      reviewKeys: guardWaitingKeys,
      unmatchedKeys: guardUnmatchedRows.map((row) => row.key),
      nextAction: workflowGuard.nextAction ?? null,
      resumeCursor: workflowGuard.resumeCursor ?? null,
    } : null,
    state,
    ready: state === "ready",
    visibleStatus,
    nextAction,
    command: {
      commandId: gate.command?.id ?? sourcePacket.acknowledgementCommand?.id ?? null,
      commandType: gate.command?.type ?? sourcePacket.acknowledgementCommand?.type ?? "persist-claim-operator-readiness-gate",
      wouldPersist: state !== "blocked",
      idempotencyKey: gate.command?.idempotencyKey ?? sourcePacket.acknowledgementCommand?.idempotencyKey ?? null,
      conflict: gate.command?.conflict ?? sourcePacket.acknowledgementCommand?.conflict ?? "return-existing",
    },
    validationSummary: {
      sourceState: gate.validationSummary?.sourceState ?? sourcePacket.state ?? "unknown",
      blockedReadinessKeys: blockedKeys,
      waitingReadinessKeys: waitingKeys,
      blockedJobIds: blockedJobs.map((job) => job.jobId),
      waitingJobIds: waitingJobs.map((job) => job.jobId),
      pendingFacts: gate.validationSummary?.pendingFacts ?? sourcePacket.validationSummary?.pendingFacts ?? [],
      issueCodes: gate.validationSummary?.issueCodes ?? sourcePacket.issueRows?.map((issue) => issue.code) ?? [],
      clientWorkflowHandoffState: clientWorkflowHandoffDryRun?.state ?? gate.validationSummary?.clientWorkflowHandoffState ?? null,
      workflowGuardState: workflowGuard.state ?? null,
      workflowGuardBlockedKeys: guardBlockedKeys,
      workflowGuardReviewKeys: guardWaitingKeys,
      workflowGuardUnmatchedKeys: guardUnmatchedRows.map((row) => row.key),
    },
    actionableErrors: [
      ...blockedKeys.map((key) => ({
        code: "dry-run.claim-operator-readiness.blocked",
        severity: "error",
        action: key.startsWith("workflow-guard-mismatch:")
          ? "rebuild-client-workflow-guard"
          : nextAction,
        detail: key,
      })),
      ...waitingKeys.map((key) => ({
        code: "dry-run.claim-operator-readiness.waiting",
        severity: "warning",
        action: nextAction,
        detail: key,
      })),
    ],
    clientPatch: {
      claimOperatorReadinessDryRunId: dryRunId,
      claimOperatorReadinessState: state,
      claimOperatorReadinessVisibleStatus: visibleStatus,
      claimOperatorReadinessNextAction: nextAction,
      blockedReadinessKeys: blockedKeys,
      waitingReadinessKeys: waitingKeys,
      workflowGuardState: workflowGuard.state ?? null,
      workflowGuardBlockedKeys: guardBlockedKeys,
      workflowGuardReviewKeys: guardWaitingKeys,
      blockedJobIds: blockedJobs.map((job) => job.jobId),
      waitingJobIds: waitingJobs.map((job) => job.jobId),
      resumeCursor: workflowGuard.resumeCursor ?? gate.clientPatch?.resumeCursor ?? sourcePacket.clientPatch?.resumeCursor ?? null,
    },
    dryRunGuarantee: {
      externalWritesPerformed: false,
      adapterCallsPerformed: false,
      restartSafe: state !== "blocked" && gate.restartSemantics?.restartSafe !== false,
      deterministic: true,
    },
  };
}

function buildClientRecoveryDryRun(plan, jobResults, clientRuntimeHandoff) {
  const source = plan.clientRecoveryHandoff ?? {};
  const sourceRows = source.rows ?? [];
  const resultByJobId = new Map(jobResults.map((result) => [result.jobId, result]));
  const rows = sourceRows.map((row, index) => {
    const result = resultByJobId.get(row.jobId) ?? {};
    const healthFailures = result.health?.checks?.filter((check) => check.status === "fail") ?? [];
    const healthWarnings = result.health?.checks?.filter((check) => check.status === "degraded") ?? [];
    const blockedByDryRun = ["blocked", "skipped"].includes(result.status) || healthFailures.length > 0;
    const waitingByDryRun = result.status === "degraded" || healthWarnings.length > 0;
    const dryRunState = blockedByDryRun
      ? "blocked"
      : waitingByDryRun || row.state === "waiting"
        ? "waiting"
        : row.state === "ready"
          ? "ready"
          : row.state ?? "unknown";
    return {
      sequence: index + 1,
      jobId: row.jobId,
      operation: row.operation,
      sourceState: row.state,
      dryRunState,
      visibleStatus: row.visibleStatus ?? result.state?.clientOperationState?.visibleStatus ?? result.status,
      nextAction: blockedByDryRun
        ? result.recoveryHandoff?.nextAction ?? row.nextAction ?? "repair-client-recovery"
        : waitingByDryRun
          ? row.nextAction ?? "resume-client-recovery"
          : row.nextAction ?? "continue-client-runtime-handoff",
      resumeCursor: row.resumeCursor ?? result.recoveryHandoff?.adapterStatusResumeCursor ?? null,
      adapterStatusResumeCursor: row.adapterStatusResumeCursor ?? result.adapterStatusProbe?.resumeCursor ?? null,
      commandIds: row.commandIds ?? result.state?.commandIds ?? [],
      blockedKeys: [
        ...(row.blockedKeys ?? []),
        ...healthFailures.map((check) => check.name),
      ],
      waitingKeys: [
        ...(row.waitingKeys ?? []),
        ...healthWarnings.map((check) => check.name),
      ],
      restartSafe: row.restartSafe === true
        && result.state?.restartReplay?.restartSafe !== false
        && !blockedByDryRun,
      dryRunGuarantee: {
        externalWritePerformed: false,
        adapterCallPerformed: result.adapterCall !== null && result.adapterCall !== undefined ? false : false,
        sourceBindingId: row.sourceBindingId ?? null,
        clientOperationStateId: row.clientOperationStateId ?? result.state?.clientOperationState?.id ?? null,
      },
    };
  });
  const blockedRows = rows.filter((row) => row.dryRunState === "blocked");
  const waitingRows = rows.filter((row) => ["waiting", "review"].includes(row.dryRunState));
  const state = blockedRows.length > 0 || source.state === "blocked"
    ? "blocked"
    : waitingRows.length > 0 || source.state === "waiting"
      ? "waiting"
      : "ready";
  const retryable = state !== "blocked" && rows.every((row) => row.restartSafe);
  const resumeCursors = [...new Set([
    source.resumeCursor,
    clientRuntimeHandoff?.resumability?.replayCursor,
    ...rows.map((row) => row.resumeCursor),
    ...rows.map((row) => row.adapterStatusResumeCursor),
  ].filter(Boolean))].sort();
  return {
    protocol: "aios.mailchimp.dry-run-client-recovery.v1",
    id: stableId("dryclientrecover", [
      plan.id,
      source.id,
      state,
      rows.map((row) => `${row.jobId}:${row.dryRunState}`).join(","),
    ]),
    product: "mailchimp",
    planId: plan.id,
    state,
    ready: state === "ready",
    sourceHandoffId: source.id ?? null,
    sourceClaimRecoverySnapshotId: source.sourceClaimRecoverySnapshotId ?? null,
    continuationToken: source.continuationToken ?? null,
    resumeCursor: stableId("dryclientrecovercursor", [
      plan.id,
      source.resumeCursor,
      resumeCursors.join(","),
      state,
    ]),
    resumeCursors,
    rows,
    blockedJobIds: blockedRows.map((row) => row.jobId),
    waitingJobIds: waitingRows.map((row) => row.jobId),
    blockedKeys: [...new Set([
      ...(source.blockedKeys ?? []),
      ...rows.flatMap((row) => row.blockedKeys),
    ])].sort(),
    waitingKeys: [...new Set([
      ...(source.waitingKeys ?? []),
      ...rows.flatMap((row) => row.waitingKeys),
    ])].sort(),
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? source.nextAction
      ?? "continue-client-runtime-handoff",
    retry: {
      retryable,
      maxAttempts: retryable ? 3 : 0,
      backoff: retryable
        ? [0, 1, 2].map((index) => ({
          attempt: index + 1,
          delayMs: 500 * (2 ** index),
          condition: state === "waiting" ? "client-recovery-waiting" : "client-recovery-ready",
        }))
        : [],
    },
    actionableErrors: [
      ...blockedRows.map((row) => ({
        code: "dry-run.client-recovery.blocked",
        severity: "error",
        jobId: row.jobId,
        action: row.nextAction,
        detail: `Client recovery is blocked for ${row.operation}.`,
      })),
      ...waitingRows.map((row) => ({
        code: "dry-run.client-recovery.waiting",
        severity: "warning",
        jobId: row.jobId,
        action: row.nextAction,
        detail: `Client recovery is waiting for ${row.operation}.`,
      })),
    ],
    clientPatch: {
      dryRunClientRecoveryId: stableId("dryclientrecoverpatch", [plan.id, state]),
      dryRunClientRecoveryState: state,
      dryRunClientRecoveryReady: state === "ready",
      dryRunClientRecoveryNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? "continue-client-runtime-handoff",
      dryRunClientRecoveryBlockedJobs: blockedRows.map((row) => row.jobId),
      dryRunClientRecoveryWaitingJobs: waitingRows.map((row) => row.jobId),
      dryRunClientRecoveryBlockedKeys: [...new Set(rows.flatMap((row) => row.blockedKeys))].sort(),
      dryRunClientRecoveryWaitingKeys: [...new Set(rows.flatMap((row) => row.waitingKeys))].sort(),
      dryRunClientRecoveryResumeCursor: resumeCursors[0] ?? null,
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe),
      onRestart: state === "ready" ? "return-existing-dry-run-client-recovery" : "reload-dry-run-client-recovery",
      onDuplicateCommand: "return-existing-dry-run-client-recovery-command",
    },
  };
}

function buildAcceptanceReadinessDryRun(plan, jobResults, tenantBoundaryMatrix, acceptanceCommandRelease) {
  const source = plan.acceptanceReadinessLedger
    ?? plan.package?.acceptanceReadinessLedger
    ?? {};
  const sourceRows = Array.isArray(source.rows) ? source.rows : [];
  const resultByJobId = new Map(jobResults.map((result) => [result.jobId, result]));
  const tenantBlocked = tenantBoundaryMatrix?.clientPatch?.tenantBoundaryBlockedJobs ?? [];
  const tenantWaiting = tenantBoundaryMatrix?.clientPatch?.tenantBoundaryApprovalJobs ?? [];
  const commandRows = acceptanceCommandRelease?.rows ?? [];
  const commandBlockedJobs = commandRows
    .filter((row) => row.state === "blocked")
    .map((row) => row.jobId);
  const commandWaitingJobs = commandRows
    .filter((row) => row.state === "waiting")
    .map((row) => row.jobId);
  const dryRunRows = sourceRows.map((row, index) => {
    const rowJobIds = [
      ...(row.blockers ?? []),
      ...(row.key === "tenant-boundary" ? tenantBlocked : []),
      ...(row.key === "adapter-status-resume"
        ? jobResults
          .filter((result) => result.adapterStatusProbe?.state === "blocked")
          .map((result) => result.jobId)
        : []),
      ...(row.key === "runtime-acceptance" ? commandBlockedJobs : []),
    ].filter((value) => resultByJobId.has(value));
    const waitingJobIds = [
      ...(row.key === "tenant-boundary" ? tenantWaiting : []),
      ...(row.key === "adapter-status-resume"
        ? jobResults
          .filter((result) => result.adapterStatusProbe?.state === "paused")
          .map((result) => result.jobId)
        : []),
      ...(row.key === "runtime-acceptance" ? commandWaitingJobs : []),
    ].filter((value) => resultByJobId.has(value));
    const simulatedBlocked = rowJobIds.length > 0
      || (row.required === true && row.state === "blocked")
      || (row.key === "provider-health" && jobResults.some((result) => ["blocked", "skipped"].includes(result.status)));
    const simulatedWaiting = !simulatedBlocked && (
      waitingJobIds.length > 0
      || row.state === "review"
      || (row.key === "runtime-acceptance" && acceptanceCommandRelease?.ready !== true)
    );
    const dryRunState = simulatedBlocked ? "blocked" : simulatedWaiting ? "waiting" : "ready";
    return {
      sequence: index + 1,
      key: row.key,
      source: row.source ?? "executor-plan",
      sourceId: row.sourceId ?? null,
      required: row.required === true,
      plannedState: row.state ?? "unknown",
      dryRunState,
      visibleStatus: row.visibleStatus ?? dryRunState,
      nextAction: simulatedBlocked
        ? row.nextAction ?? "repair-acceptance-readiness"
        : simulatedWaiting
          ? row.nextAction ?? "resume-acceptance-readiness"
          : "return-existing-acceptance-readiness-row",
      commandIds: row.commandIds ?? [],
      resumeCursor: row.resumeCursor ?? null,
      blockedJobIds: [...new Set(rowJobIds)].sort(),
      waitingJobIds: [...new Set(waitingJobIds)].sort(),
      restartSafe: row.restartSafe !== false && !simulatedBlocked,
      dryRunGuarantee: {
        externalWritePerformed: false,
        adapterCallPerformed: false,
        persistedCommandReplayOnly: true,
      },
    };
  });
  const blockedRows = dryRunRows.filter((row) => row.dryRunState === "blocked" && row.required);
  const waitingRows = dryRunRows.filter((row) => row.dryRunState === "waiting" && row.required);
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "ready";
  const commandScope = [
    plan.id,
    source.id,
    status,
    dryRunRows.map((row) => `${row.key}:${row.dryRunState}`).join(","),
  ];
  const command = {
    id: stableId("dryacceptcmd", [...commandScope, "persist-dry-run-acceptance-readiness"]),
    type: "persist-dry-run-acceptance-readiness",
    idempotencyKey: stableId("idem", [...commandScope, "persist-dry-run-acceptance-readiness"]),
    statusAfterReplay: status === "ready" ? "dry-run-acceptance-readiness-ready" : `dry-run-acceptance-readiness-${status}`,
    writes: ["dryRunAcceptanceReadinessId", "rows", "safeBoundary", "nextAction"],
    conflict: "return-existing",
  };
  return {
    protocol: "aios.mailchimp.dry-run-acceptance-readiness.v1",
    id: stableId("dryacceptledger", commandScope),
    sourceLedgerId: source.id ?? null,
    sourceDigest: source.digest ?? null,
    product: "mailchimp",
    planId: plan.id,
    status,
    ready: status === "ready",
    visibleStatus: status === "ready"
      ? "dry-run-acceptance-readiness-ready"
      : status === "waiting"
        ? "dry-run-acceptance-readiness-waiting"
        : "dry-run-acceptance-readiness-blocked",
    nextAction: blockedRows[0]?.nextAction ?? waitingRows[0]?.nextAction ?? "persist-dry-run-acceptance-readiness",
    rows: dryRunRows,
    command,
    safeBoundary: tenantBoundaryMatrix?.safeBoundary === true && blockedRows.length === 0,
    externalWritesPerformed: false,
    adapterCallsPerformed: false,
    validationSummary: {
      blockedKeys: blockedRows.map((row) => row.key),
      waitingKeys: waitingRows.map((row) => row.key),
      blockedJobIds: [...new Set(dryRunRows.flatMap((row) => row.blockedJobIds))].sort(),
      waitingJobIds: [...new Set(dryRunRows.flatMap((row) => row.waitingJobIds))].sort(),
      commandIds: [...new Set(dryRunRows.flatMap((row) => row.commandIds))].sort(),
      resumeCursors: [...new Set(dryRunRows.map((row) => row.resumeCursor).filter(Boolean))].sort(),
      acceptanceCommandReleaseStatus: acceptanceCommandRelease?.status ?? null,
      tenantBoundaryStatus: tenantBoundaryMatrix?.status ?? null,
    },
    clientPatch: {
      dryRunAcceptanceReadinessId: stableId("dryacceptpatch", [plan.id, status, source.id]),
      dryRunAcceptanceReadinessState: status,
      dryRunAcceptanceReadinessReady: status === "ready",
      dryRunAcceptanceReadinessVisibleStatus: status === "ready"
        ? "ready-to-preview-mailchimp-acceptance"
        : `mailchimp-acceptance-${status}`,
      dryRunAcceptanceReadinessNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? "persist-dry-run-acceptance-readiness",
      dryRunAcceptanceReadinessBlockedKeys: blockedRows.map((row) => row.key),
      dryRunAcceptanceReadinessWaitingKeys: waitingRows.map((row) => row.key),
      dryRunAcceptanceReadinessCommandId: command.id,
    },
    restartSemantics: {
      restartSafe: status !== "blocked" && dryRunRows.every((row) => row.restartSafe),
      replayCursor: stableId("dryacceptcursor", [
        plan.id,
        source.restartSemantics?.replayCursor,
        dryRunRows.map((row) => row.resumeCursor).filter(Boolean).join(","),
      ]),
      onRestart: status === "ready" ? "load-dry-run-acceptance-readiness" : "rebuild-dry-run-acceptance-readiness",
      onDuplicateCommand: "return-existing-dry-run-acceptance-readiness",
    },
  };
}

function buildRuntimeStatusReplayCursorEnvelope(plan, jobResults, status, persistedStatusEnvelope) {
  const rows = jobResults.map((result, index) => {
    const restartReplay = result.state?.restartReplay || {};
    const statusProbe = result.adapterStatusProbe || {};
    const leaseReplay = result.state?.commandLeaseReplay || {};
    const acceptanceCommand = result.state?.acceptanceCommand || {};
    const commandIds = result.state?.commandIds ?? [];
    const blocked = result.status === "blocked"
      || result.status === "skipped"
      || result.health?.status === "unhealthy";
    const waiting = !blocked && (
      result.status === "degraded"
      || result.reason === "approval-required"
      || statusProbe.state === "paused"
      || leaseReplay.status === "waiting"
    );
    const replaySafe = blocked === false
      && restartReplay.restartSafe !== false
      && result.state?.statusProjection?.restartSafe !== false
      && Boolean(result.state?.checkpointKey)
      && Boolean(result.state?.ledgerKey);
    const replayCursor = restartReplay.replayCursor
      || result.recoveryHandoff?.replayCursor
      || result.state?.clientOperationState?.resume?.replayCursor
      || stableId("drycursor", [
        plan.id,
        result.jobId,
        result.status,
        statusProbe.resumeCursor,
        result.state?.idempotencyKey,
      ]);

    return {
      order: index + 1,
      jobId: result.jobId,
      operation: result.operation,
      status: result.status,
      reason: result.reason,
      visibleStatus: statusProbe.dryRunOutcome?.visibleStatus
        || result.state?.clientOperationState?.visibleStatus
        || result.status,
      replayCursor,
      checkpointKey: result.state?.checkpointKey ?? null,
      ledgerKey: result.state?.ledgerKey ?? null,
      adapterStatusResumeCursor: statusProbe.resumeCursor ?? null,
      clientResumeToken: result.state?.clientOperationState?.resume?.claimResumeCursor ?? null,
      idempotencyKey: result.state?.idempotencyKey ?? null,
      nextCommandId: restartReplay.nextCommand?.commandId
        || acceptanceCommand.commandId
        || leaseReplay.primaryLeaseId
        || commandIds[0]
        || null,
      replayDecision: blocked
        ? "hold-until-healthy"
        : waiting
          ? "persist-and-wait"
          : restartReplay.replayDecision || "return-existing-status",
      replaySafe,
      blocked,
      waiting,
      nextAction: result.actionableErrors?.[0]?.action
        || result.recoveryHandoff?.nextAction
        || restartReplay.nextCommand?.replayAction
        || "return-existing-dry-run-status",
      commandIds,
    };
  });
  const blockedRows = rows.filter((row) => row.blocked);
  const waitingRows = rows.filter((row) => row.waiting);
  const unsafeRows = rows.filter((row) => row.replaySafe === false);
  const envelopeStatus = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "ready";
  const replayCursor = stableId("dryruntimecursor", [
    plan.id,
    status,
    persistedStatusEnvelope?.statusRevision,
    rows.map((row) => row.replayCursor).join(","),
  ]);

  return {
    schemaVersion: "aios.mailchimp.runtime-status-replay-cursor.v1",
    provider: "mailchimp",
    planId: plan.id,
    status: envelopeStatus,
    dryRunStatus: status,
    replayCursor,
    resumeToken: persistedStatusEnvelope?.resumeToken
      || plan.recovery?.resumeToken
      || replayCursor,
    statusRevision: persistedStatusEnvelope?.statusRevision
      || stableId("drystatusrev", [plan.id, status, replayCursor]),
    readyForRestart: envelopeStatus !== "blocked" && unsafeRows.length === 0,
    readyForRuntimeRelease: envelopeStatus === "ready"
      && persistedStatusEnvelope?.readyForRuntimeRelease !== false,
    nextAction: blockedRows[0]?.nextAction
      || waitingRows[0]?.nextAction
      || persistedStatusEnvelope?.nextAction
      || "handoff-to-runtime-adapter",
    rows,
    counters: {
      rows: rows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      unsafe: unsafeRows.length,
      replayable: rows.filter((row) => row.replaySafe).length,
    },
    blocking: {
      blockedJobIds: blockedRows.map((row) => row.jobId),
      waitingJobIds: waitingRows.map((row) => row.jobId),
      unsafeJobIds: unsafeRows.map((row) => row.jobId),
    },
    restartSemantics: {
      replaySafe: envelopeStatus !== "blocked" && unsafeRows.length === 0,
      duplicateCommandPolicy: "dedupe-by-dry-run-runtime-status-cursor",
      onColdRestart: "load-runtime-status-replay-cursor",
      onDuplicateCommand: "return-existing-dry-run-status",
      externalWritesPerformed: false,
    },
    clientPatch: {
      runtimeStatusReplayCursor: replayCursor,
      runtimeStatusReplayCursorStatus: envelopeStatus,
      runtimeStatusReplayCursorReady: envelopeStatus !== "blocked" && unsafeRows.length === 0,
      runtimeStatusReplayCursorNextAction: blockedRows[0]?.nextAction
        || waitingRows[0]?.nextAction
        || "handoff-to-runtime-adapter",
      runtimeStatusReplayBlockedJobs: blockedRows.map((row) => row.jobId),
      runtimeStatusReplayWaitingJobs: waitingRows.map((row) => row.jobId),
    },
  };
}

export function dryRunExecutor(input, options = {}) {
  const plan = input?.kind === "AiosExecutorPlan" ? input : createExecutorPlan(input ?? {}, options);
  const simulatedJobResults = plan.jobs.map((job) => simulateJob(job, plan.status, options.retry ?? {}));
  const status = deriveStatus(plan, simulatedJobResults);
  const lifecycle = buildLifecycleControls(plan, simulatedJobResults, status, options.lifecycle ?? {});
  const lifecycleRuntimeControlDryRun = buildLifecycleRuntimeControlDryRun(
    plan,
    lifecycle,
    simulatedJobResults,
    status,
  );
  const providerPreview = buildProviderPreview(plan, lifecycle);
  const clientCommandLeaseReplay = buildClientCommandLeaseReplay(plan, simulatedJobResults, lifecycle, providerPreview);
  const commandLeaseReplayExport = buildCommandLeaseReplayExportSnapshot(clientCommandLeaseReplay);
  const clientCommandLeaseReplayHandoff = buildClientCommandLeaseReplayHandoff(
    clientCommandLeaseReplay,
    commandLeaseReplayExport,
    plan,
  );
  const leaseByJobId = new Map(clientCommandLeaseReplay.leases.map((lease) => [lease.jobId, lease]));
  let jobResults = simulatedJobResults.map((result) => ({
    ...result,
    state: {
      ...result.state,
      commandLeaseReplay: leaseByJobId.get(result.jobId) ?? null,
    },
  }));
  const health = summarizeHealth(jobResults);
  const providerHealth = buildProviderHealthPreview(plan, jobResults);
  const providerCapabilityDryRunState = buildProviderCapabilityDryRunState(plan, jobResults);
  const providerCredentialLeaseDryRunState = buildProviderCredentialLeaseDryRunState(
    plan,
    jobResults,
    providerCapabilityDryRunState,
  );
  const acceptancePreviewBase = buildAcceptancePreview(plan, lifecycle, jobResults);
  const acceptanceReceipt = buildAcceptanceReceiptContract(plan, lifecycle, acceptancePreviewBase, jobResults);
  const acceptancePreview = {
    ...acceptancePreviewBase,
    receipt: acceptanceReceipt,
    accepted: acceptanceReceipt.accepted,
    status: acceptanceReceipt.accepted ? "dry-run-accepted" : acceptancePreviewBase.status,
    visibleStatus: acceptanceReceipt.clientPatch.dryRunAcceptanceVisibleStatus,
    nextAction: acceptanceReceipt.clientPatch.dryRunAcceptanceNextAction,
    acceptanceToken: acceptanceReceipt.acceptanceToken,
  };
  const acceptanceCommandRelease = buildAcceptanceCommandReleaseGate(plan, lifecycle, acceptancePreview, jobResults);
  const acceptanceCommandByJobId = new Map(
    acceptanceCommandRelease.rows.map((row) => [row.jobId, row]),
  );
  jobResults = jobResults.map((result) => ({
    ...result,
    state: {
      ...result.state,
      acceptanceCommand: acceptanceCommandByJobId.get(result.jobId) ?? null,
    },
    acceptanceCommand: acceptanceCommandByJobId.get(result.jobId) ?? null,
  }));
  acceptancePreview.commandRelease = acceptanceCommandRelease;
  const tenantAuditHandoff = buildTenantAuditHandoff(plan, jobResults, options.audit ?? options);
  const tenantBoundaryMatrix = buildTenantBoundaryMatrix(plan, tenantAuditHandoff, jobResults);
  const acceptanceReadinessDryRun = buildAcceptanceReadinessDryRun(
    plan,
    jobResults,
    tenantBoundaryMatrix,
    acceptanceCommandRelease,
  );
  const providerReleaseContract = buildProviderReleaseContract(
    plan,
    providerPreview,
    providerHealth,
    jobResults,
    lifecycle,
    tenantAuditHandoff,
    providerCapabilityDryRunState,
  );
  const runtimeProviderHandoffDryRunState = buildRuntimeProviderHandoffDryRunState(
    plan,
    providerPreview,
    providerReleaseContract,
    jobResults,
  );
  const providerIntegrationExecutionTicket = buildProviderIntegrationExecutionTicket(
    plan,
    providerReleaseContract,
    runtimeProviderHandoffDryRunState,
    jobResults,
  );
  const clientReadinessDryRun = buildClientReadinessDryRun(
    plan,
    jobResults,
    lifecycle,
    acceptancePreview,
    providerReleaseContract,
    tenantBoundaryMatrix,
  );
  const clientWorkflowHandoffDryRun = buildClientWorkflowHandoffDryRun(
    plan,
    jobResults,
    clientReadinessDryRun,
    providerReleaseContract,
  );
  const claimOperatorReadinessDryRun = buildClaimOperatorReadinessDryRun(
    plan,
    jobResults,
    clientWorkflowHandoffDryRun,
  );
  const releaseAcceptanceDryRun = buildReleaseAcceptanceDryRun(
    plan,
    providerReleaseContract,
    acceptancePreview,
    jobResults,
  );
  const lifecycleSettingsAdoptionDryRun = buildLifecycleSettingsAdoptionDryRun(
    plan,
    lifecycle,
    jobResults,
    providerPreview,
  );
  const clientRuntimeHandoff = buildClientRuntimeHandoff(
    plan,
    lifecycle,
    lifecycleRuntimeControlDryRun,
    providerPreview,
    acceptancePreview,
    jobResults,
    lifecycleSettingsAdoptionDryRun,
  );
  const clientRecoveryDryRun = buildClientRecoveryDryRun(
    plan,
    jobResults,
    clientRuntimeHandoff,
  );
  const runtimeReleaseDecision = buildRuntimeReleaseDecision(
    plan,
    status,
    lifecycle,
    lifecycleRuntimeControlDryRun,
    providerReleaseContract,
    tenantAuditHandoff,
    acceptancePreview,
    clientCommandLeaseReplay,
    commandLeaseReplayExport,
    plan.operatorRuntimeReleaseInstruction ?? plan.package?.operatorRuntimeReleaseInstruction,
  );
  const runtimeBoundaryDryRun = buildRuntimeBoundaryDryRun(
    plan,
    jobResults,
    tenantBoundaryMatrix,
    providerReleaseContract,
    runtimeReleaseDecision,
  );
  const runtimeBoundaryExecutionTickets = buildRuntimeBoundaryExecutionTickets(
    plan,
    jobResults,
    tenantBoundaryMatrix,
    runtimeBoundaryDryRun,
    runtimeReleaseDecision,
  );
  jobResults = attachRuntimeBoundaryExecutionGate(
    jobResults,
    runtimeBoundaryExecutionTickets,
    tenantBoundaryMatrix,
  );
  const executorPlanReport = buildExecutorPlanReportPreview(plan);
  const claimGateReporting = buildClaimGateReportingPreview(plan);
  const claimAcknowledgmentState = buildClaimAcknowledgmentState(plan, lifecycle, acceptancePreview);
  const packageLifecycle = buildPackageLifecyclePreview(plan);
  const packagePreviewState = buildPackagePreviewState(plan, jobResults, lifecycle, acceptancePreview);
  const previewReadinessManifestDryRun = buildPreviewReadinessManifestDryRun(
    plan,
    jobResults,
    lifecycle,
    acceptancePreview,
    clientReadinessDryRun,
    providerReleaseContract,
    runtimeReleaseDecision,
    packagePreviewState,
  );
  const persistedStatusEnvelope = buildPersistedStatusEnvelope(
    plan,
    jobResults,
    status,
    tenantBoundaryMatrix,
    runtimeReleaseDecision,
    runtimeBoundaryExecutionTickets,
  );
  const runtimeStatusReplayCursor = buildRuntimeStatusReplayCursorEnvelope(
    plan,
    jobResults,
    status,
    persistedStatusEnvelope,
  );
  const reportCore = {
    kind: "AiosDryRunExecutionReport",
    id: stableId("dryrun", [plan.id, status, jobResults.map((result) => result.status).join(",")]),
    planId: plan.id,
    product: "mailchimp",
    status,
    admission: {
      accepted: status === "admitted",
      reason: status === "admitted"
        ? "all-jobs-admissible"
        : status === "degraded"
          ? "requires-approval-or-state-repair"
          : "requires-review-or-evidence",
      issueCodes: plan.issues.map((issue) => issue.code),
    },
    jobs: jobResults,
    health,
    lifecycle,
    lifecycleRuntimeControlDryRun,
    providerPreview,
    providerHealth,
    providerCapabilityDryRunState,
    providerCredentialLeaseDryRunState,
    runtimeProviderHandoffDryRunState,
    providerIntegrationExecutionTicket,
    providerReleaseContract,
    clientReadinessDryRun,
    clientWorkflowHandoffDryRun,
    claimOperatorReadinessDryRun,
    releaseAcceptanceDryRun,
    lifecycleSettingsAdoptionDryRun,
    runtimeReleaseDecision,
    runtimeBoundaryDryRun,
    runtimeBoundaryExecutionTickets,
    persistedStatusEnvelope,
    runtimeStatusReplayCursor,
    planOperationalExportGate: plan.operationalExportGate ?? null,
    acceptancePreview,
    acceptanceReadinessDryRun,
    clientRuntimeHandoff,
    clientRecoveryDryRun,
    clientCommandLeaseReplay,
    commandLeaseReplayExport,
    clientCommandLeaseReplayHandoff,
    executorPlanReport,
    claimGateReporting,
    claimAcknowledgmentState,
    packageLifecycle,
    packagePreviewState,
    previewReadinessManifestDryRun,
    tenantAuditHandoff,
    tenantBoundaryMatrix,
    degradedMode: buildDegradedMode(plan, jobResults),
    rollbackPreview: buildRollbackPreview(plan, jobResults),
    truthBoundaryReport: {
      ...plan.truthBoundaryReport,
      dryRunOnly: true,
      externalWritesPerformed: false,
      adapterCallsPerformed: false,
    },
    recovery: {
      checkpointOrder: plan.recovery.checkpointOrder,
      replayOrder: plan.recovery.replayOrder ?? [],
      restartProjection: plan.restartProjection,
      restartRecoveryMatrix: plan.restartRecoveryMatrix ?? plan.recovery?.restartRecoveryMatrix ?? null,
      providerCapabilityReplay: {
        id: providerCapabilityDryRunState.id,
        status: providerCapabilityDryRunState.status,
        ready: providerCapabilityDryRunState.ready,
        resumeCursor: providerCapabilityDryRunState.resumeCursor,
        commandIds: providerCapabilityDryRunState.commands.map((command) => command.id),
        persistKeys: providerCapabilityDryRunState.persistKeys,
        restartSemantics: providerCapabilityDryRunState.restartSemantics,
      },
      providerCredentialLease: {
        id: providerCredentialLeaseDryRunState.id,
        status: providerCredentialLeaseDryRunState.status,
        ready: providerCredentialLeaseDryRunState.ready,
        resumeCursor: providerCredentialLeaseDryRunState.resumeCursor,
        commandIds: providerCredentialLeaseDryRunState.commands.map((command) => command.id),
        credentialKeys: providerCredentialLeaseDryRunState.credentialKeys,
        persistKeys: providerCredentialLeaseDryRunState.persistKeys,
        restartSemantics: providerCredentialLeaseDryRunState.restartSemantics,
      },
      runtimeProviderHandoff: {
        id: runtimeProviderHandoffDryRunState.id,
        status: runtimeProviderHandoffDryRunState.state,
        ready: runtimeProviderHandoffDryRunState.ready,
        resumeCursor: runtimeProviderHandoffDryRunState.resumeCursor,
        commandId: runtimeProviderHandoffDryRunState.command.id,
        blockedJobIds: runtimeProviderHandoffDryRunState.blockedJobIds,
        waitingJobIds: runtimeProviderHandoffDryRunState.waitingJobIds,
        restartSemantics: runtimeProviderHandoffDryRunState.restartSemantics,
      },
      providerIntegrationExecutionTicket: {
        id: providerIntegrationExecutionTicket.id,
        state: providerIntegrationExecutionTicket.state,
        ready: providerIntegrationExecutionTicket.ready,
        readyForRuntimeRelease: providerIntegrationExecutionTicket.readyForRuntimeRelease,
        resumeCursor: providerIntegrationExecutionTicket.resumeCursor,
        nextAction: providerIntegrationExecutionTicket.nextAction,
        blockedGateIds: providerIntegrationExecutionTicket.validationSummary.blockedGateIds,
        waitingGateIds: providerIntegrationExecutionTicket.validationSummary.waitingGateIds,
        blockedJobIds: providerIntegrationExecutionTicket.validationSummary.blockedJobIds,
        waitingJobIds: providerIntegrationExecutionTicket.validationSummary.waitingJobIds,
        commandId: providerIntegrationExecutionTicket.command.id,
        restartSemantics: providerIntegrationExecutionTicket.restartSemantics,
      },
      clientRecovery: {
        id: clientRecoveryDryRun.id,
        state: clientRecoveryDryRun.state,
        ready: clientRecoveryDryRun.ready,
        resumeCursor: clientRecoveryDryRun.resumeCursor,
        blockedJobIds: clientRecoveryDryRun.blockedJobIds,
        waitingJobIds: clientRecoveryDryRun.waitingJobIds,
        nextAction: clientRecoveryDryRun.nextAction,
        retryable: clientRecoveryDryRun.retry.retryable,
        restartSemantics: clientRecoveryDryRun.restartSemantics,
      },
      persistedStatusEnvelope: {
        id: persistedStatusEnvelope.id,
        status: persistedStatusEnvelope.status,
        readyForRestart: persistedStatusEnvelope.readyForRestart,
        readyForRuntimeRelease: persistedStatusEnvelope.readyForRuntimeRelease,
        resumeToken: persistedStatusEnvelope.resumeToken,
        statusRevision: persistedStatusEnvelope.statusRevision,
        nextAction: persistedStatusEnvelope.nextAction,
        restartSemantics: persistedStatusEnvelope.restartSemantics,
      },
      runtimeStatusReplayCursor: {
        status: runtimeStatusReplayCursor.status,
        readyForRestart: runtimeStatusReplayCursor.readyForRestart,
        replayCursor: runtimeStatusReplayCursor.replayCursor,
        resumeToken: runtimeStatusReplayCursor.resumeToken,
        nextAction: runtimeStatusReplayCursor.nextAction,
        blockedJobIds: runtimeStatusReplayCursor.blocking.blockedJobIds,
        waitingJobIds: runtimeStatusReplayCursor.blocking.waitingJobIds,
        unsafeJobIds: runtimeStatusReplayCursor.blocking.unsafeJobIds,
      },
      runtimeBoundaryExecutionTickets: {
        id: runtimeBoundaryExecutionTickets.id,
        state: runtimeBoundaryExecutionTickets.state,
        ready: runtimeBoundaryExecutionTickets.ready,
        readyForRuntimeRelease: runtimeBoundaryExecutionTickets.readyForRuntimeRelease,
        nextAction: runtimeBoundaryExecutionTickets.nextAction,
        blockedJobIds: runtimeBoundaryExecutionTickets.clientPatch.runtimeBoundaryExecutionTicketBlockedJobIds,
        waitingJobIds: runtimeBoundaryExecutionTickets.clientPatch.runtimeBoundaryExecutionTicketWaitingJobIds,
        commandIds: runtimeBoundaryExecutionTickets.clientPatch.runtimeBoundaryExecutionTicketCommandIds,
        gateStates: jobResults.map((result) => ({
          jobId: result.jobId,
          state: result.boundaryExecutionGate?.state ?? "unknown",
          readyForAdapterRelease: result.boundaryExecutionGate?.readyForAdapterRelease === true,
          auditReady: result.boundaryExecutionGate?.audit?.ready === true,
          nextAction: result.boundaryExecutionGate?.nextAction ?? null,
        })),
        restartSemantics: runtimeBoundaryExecutionTickets.restartSemantics,
      },
      previewReadinessManifest: {
        id: previewReadinessManifestDryRun.id,
        status: previewReadinessManifestDryRun.status,
        readyForClientPreview: previewReadinessManifestDryRun.readyForClientPreview,
        readyForRuntimeStart: previewReadinessManifestDryRun.readyForRuntimeStart,
        routeId: previewReadinessManifestDryRun.route.routeId,
        nextAction: previewReadinessManifestDryRun.nextAction,
        blockedSectionIds: previewReadinessManifestDryRun.validationSummary.blockedSectionIds,
        pendingSectionIds: previewReadinessManifestDryRun.validationSummary.pendingSectionIds,
        restartSemantics: previewReadinessManifestDryRun.restartSemantics,
      },
      rollbackPrepared: jobResults.some((result) => result.rollbackPrepared !== "no-op"),
      terminalStates: ["admitted", "blocked", "degraded", "reviewable"],
    },
  };
  const operationalRunbook = buildOperationalRunbook(
    plan,
    jobResults,
    health,
    providerHealth,
    lifecycle,
    tenantAuditHandoff,
    clientCommandLeaseReplay,
  );
  const reportWithRunbook = {
    ...reportCore,
    operationalRunbook,
  };
  const dryRunIncidentQueue = buildDryRunIncidentQueue(plan, jobResults, status);
  const operationalReleaseGate = buildOperationalReleaseGate(
    plan,
    jobResults,
    dryRunIncidentQueue,
    runtimeBoundaryExecutionTickets,
    runtimeStatusReplayCursor,
  );
  const analytics = buildAnalytics(plan, jobResults, tenantBoundaryMatrix);
  const history = buildHistorySnapshots(plan, jobResults, status, tenantBoundaryMatrix);
  const operationalHealthExport = buildOperationalHealthExport(reportWithRunbook, history);
  const dryRunAnalyticsExport = buildDryRunAnalyticsExportReport(
    reportWithRunbook,
    analytics,
    history,
    operationalHealthExport,
  );
  const reportingState = buildReportingState(
    reportWithRunbook,
    analytics,
    history,
    operationalHealthExport,
    dryRunAnalyticsExport,
  );
  const runtimeExportWatermark = buildRuntimeExportWatermark(
    reportWithRunbook,
    analytics,
    history,
    operationalHealthExport,
    dryRunAnalyticsExport,
    reportingState,
  );
  const operationalExportJournal = buildOperationalExportJournal(
    reportWithRunbook,
    analytics,
    history,
    operationalHealthExport,
    dryRunAnalyticsExport,
  );
  const claimExportAcceptance = buildClaimExportAcceptancePreview(
    plan,
    claimGateReporting,
    {
      ...reportWithRunbook,
      dryRunIncidentQueue,
      operationalReleaseGate,
      dryRunAnalyticsExport,
      reportingState,
      runtimeExportWatermark,
      operationalExportJournal,
    },
    analytics,
    history,
  );
  const reportWithExports = {
    ...reportWithRunbook,
    dryRunIncidentQueue,
    operationalReleaseGate,
    dryRunAnalyticsExport,
    reportingState,
    runtimeExportWatermark,
    operationalExportJournal,
    claimExportAcceptance,
  };
  return {
    ...reportWithExports,
    analytics,
    history,
    operationalHealthExport,
    reportingState,
    dryRunIncidentQueue,
    operationalReleaseGate,
    dryRunAnalyticsExport,
    operationalExportJournal,
    runtimeExportWatermark,
    claimExportAcceptance,
    timeline: jobResults.flatMap((result) => (
      (result.timeline ?? []).map((entry) => ({ ...entry, jobId: result.jobId }))
    )),
    exportSummary: buildExportSummary(reportWithExports, analytics, history),
  };
}

export function formatDryRunStatus(report) {
  return {
    id: report.id,
    planId: report.planId,
    status: report.status,
    accepted: report.admission.accepted,
    jobStatuses: report.jobs.map((job) => ({ jobId: job.jobId, status: job.status, reason: job.reason })),
    health: report.health.status,
    actionableErrorCodes: report.health.actionableErrors.map((error) => error.code),
    incidentQueue: {
      status: report.dryRunIncidentQueue?.status || "unknown",
      incidentCount: report.dryRunIncidentQueue?.incidentCount || 0,
      blocking: report.dryRunIncidentQueue?.summary?.blocking || 0,
      retryable: report.dryRunIncidentQueue?.summary?.retryable || 0,
      nextIncidentId: report.dryRunIncidentQueue?.nextIncidentId || null,
      nextAction: report.dryRunIncidentQueue?.nextAction || null,
      resumeToken: report.dryRunIncidentQueue?.resumeToken || null,
    },
    operationalReleaseGate: {
      status: report.operationalReleaseGate?.status || "unknown",
      readyForRuntimeRelease: report.operationalReleaseGate?.readyForRuntimeRelease === true,
      nextAction: report.operationalReleaseGate?.nextAction || null,
      resumeToken: report.operationalReleaseGate?.resumeToken || null,
      counters: report.operationalReleaseGate?.counters || {},
      blockedJobIds: report.operationalReleaseGate?.blocking?.jobIds || [],
      waitingJobIds: report.operationalReleaseGate?.waiting?.jobIds || [],
      blockingIncidentIds: report.operationalReleaseGate?.blocking?.incidentIds || [],
      retryableIncidentIds: report.operationalReleaseGate?.waiting?.incidentIds || [],
    },
    degradedMode: report.degradedMode.enabled,
    persistedStatusEnvelope: {
      status: report.persistedStatusEnvelope?.status,
      readyForRestart: report.persistedStatusEnvelope?.readyForRestart === true,
      readyForRuntimeRelease: report.persistedStatusEnvelope?.readyForRuntimeRelease === true,
      nextAction: report.persistedStatusEnvelope?.nextAction,
      blockedJobIds: report.persistedStatusEnvelope?.blocking?.blockedJobIds ?? [],
      unsafeJobIds: report.persistedStatusEnvelope?.blocking?.unsafeJobIds ?? [],
    },
    runtimeStatusReplayCursor: {
      status: report.runtimeStatusReplayCursor?.status,
      readyForRestart: report.runtimeStatusReplayCursor?.readyForRestart === true,
      replayCursor: report.runtimeStatusReplayCursor?.replayCursor,
      resumeToken: report.runtimeStatusReplayCursor?.resumeToken,
      nextAction: report.runtimeStatusReplayCursor?.nextAction,
      blockedJobIds: report.runtimeStatusReplayCursor?.blocking?.blockedJobIds ?? [],
      waitingJobIds: report.runtimeStatusReplayCursor?.blocking?.waitingJobIds ?? [],
      unsafeJobIds: report.runtimeStatusReplayCursor?.blocking?.unsafeJobIds ?? [],
    },
    lifecycle: {
      valid: report.lifecycle.valid,
      nextAction: report.lifecycle.nextAction.action,
      scheduleMode: report.lifecycle.settings.schedule.mode,
      schedulePaused: report.lifecycle.settings.schedule.paused,
      enabled: report.lifecycle.settings.enabled,
      operatorControlsStatus: report.lifecycle.operatorControls?.status,
      operatorControlsNextAction: report.lifecycle.operatorControls?.nextAction,
      runtimeStartEnabled: report.lifecycle.operatorControls?.runtimeStart?.enabled === true,
      disabledRequiredActions: report.lifecycle.operatorControls?.capabilityControls?.disabledRequiredActions ?? [],
      validationSummary: report.lifecycle.validationSummary,
      operatorReleaseChecklist: {
        id: report.lifecycle.operatorReleaseChecklist?.id,
        sourceChecklistId: report.lifecycle.operatorReleaseChecklist?.sourceChecklistId,
        state: report.lifecycle.operatorReleaseChecklist?.state,
        ready: report.lifecycle.operatorReleaseChecklist?.ready === true,
        visibleStatus: report.lifecycle.operatorReleaseChecklist?.visibleStatus,
        nextAction: report.lifecycle.operatorReleaseChecklist?.nextAction,
        commandId: report.lifecycle.operatorReleaseChecklist?.command?.commandId,
        blockedCheckKeys: report.lifecycle.operatorReleaseChecklist?.validationSummary?.blockedCheckKeys ?? [],
        waitingCheckKeys: report.lifecycle.operatorReleaseChecklist?.validationSummary?.waitingCheckKeys ?? [],
        reviewCheckKeys: report.lifecycle.operatorReleaseChecklist?.validationSummary?.reviewCheckKeys ?? [],
        unacknowledgedReviewCheckKeys: report.lifecycle.operatorReleaseChecklist?.validationSummary?.unacknowledgedReviewCheckKeys ?? [],
        blockedJobIds: report.lifecycle.operatorReleaseChecklist?.clientPatch?.operatorReleaseBlockedJobIds ?? [],
        waitingJobIds: report.lifecycle.operatorReleaseChecklist?.clientPatch?.operatorReleaseWaitingJobIds ?? [],
      },
    },
    lifecycleRuntimeControl: {
      id: report.lifecycleRuntimeControlDryRun?.id,
      sourceControlId: report.lifecycleRuntimeControlDryRun?.sourceControlId,
      state: report.lifecycleRuntimeControlDryRun?.state,
      ready: report.lifecycleRuntimeControlDryRun?.ready === true,
      releaseAllowed: report.lifecycleRuntimeControlDryRun?.releaseAllowed === true,
      visibleStatus: report.lifecycleRuntimeControlDryRun?.visibleStatus,
      nextAction: report.lifecycleRuntimeControlDryRun?.nextAction,
      commandId: report.lifecycleRuntimeControlDryRun?.command?.commandId,
      wouldPersist: report.lifecycleRuntimeControlDryRun?.command?.wouldPersist === true,
      counters: report.lifecycleRuntimeControlDryRun?.counters ?? {},
      blockedControlKeys: report.lifecycleRuntimeControlDryRun?.validationSummary?.blockedControlKeys ?? [],
      waitingControlKeys: report.lifecycleRuntimeControlDryRun?.validationSummary?.waitingControlKeys ?? [],
      blockedJobIds: report.lifecycleRuntimeControlDryRun?.validationSummary?.blockedJobIds ?? [],
      waitingJobIds: report.lifecycleRuntimeControlDryRun?.validationSummary?.waitingJobIds ?? [],
      runtimeStartEnabled: report.lifecycleRuntimeControlDryRun?.validationSummary?.runtimeStartEnabled === true,
      schedulePaused: report.lifecycleRuntimeControlDryRun?.validationSummary?.schedulePaused === true,
      restartSafe: report.lifecycleRuntimeControlDryRun?.dryRunGuarantee?.restartSafe === true,
    },
    provider: {
      state: report.providerPreview?.state,
      capabilityDecision: report.providerPreview?.capabilityDecision,
      blockedReason: report.providerPreview?.blockedReason,
      visibleStatus: report.providerPreview?.clientVisibleStatus,
      lifecycleGateState: report.providerPreview?.lifecycleGate?.state,
      lifecycleGateNextAction: report.providerPreview?.lifecycleGate?.nextAction,
      healthStatus: report.providerHealth?.status ?? report.providerPreview?.health?.status,
      healthNextAction: report.providerHealth?.nextAction ?? report.providerPreview?.health?.nextAction,
      retryable: report.providerHealth?.retryPolicy?.retryable ?? report.providerPreview?.health?.retryable,
      degradedModeEnabled: report.providerHealth?.degradedMode?.enabled ?? report.providerPreview?.health?.degradedModeEnabled,
      healthActionableErrorCodes: report.providerHealth?.actionableErrors?.map((error) => error.code)
        ?? report.providerPreview?.health?.actionableErrorCodes
        ?? [],
      releaseContractId: report.providerReleaseContract?.id,
      releaseState: report.providerReleaseContract?.state,
      releaseReady: report.providerReleaseContract?.ready === true,
      releaseNextAction: report.providerReleaseContract?.nextAction,
      releaseSyncReady: report.providerReleaseContract?.sync?.ready === true,
      releaseLifecycleReady: report.providerReleaseContract?.releaseGates?.lifecycleReady === true,
      releaseTenantReady: report.providerReleaseContract?.releaseGates?.tenantReady === true,
      releaseProviderIntegrationReady: report.providerReleaseContract?.releaseGates?.providerIntegrationReady === true,
      integrationState: report.providerReleaseContract?.providerIntegration?.state
        ?? report.providerPreview?.integration?.state,
      integrationReady: report.providerReleaseContract?.providerIntegration?.ready === true
        || report.providerPreview?.integration?.ready === true,
      integrationNextAction: report.providerReleaseContract?.providerIntegration?.nextAction
        ?? report.providerPreview?.integration?.nextAction,
      integrationMissingFeatures: report.providerReleaseContract?.providerIntegration?.missingFeatures
        ?? report.providerPreview?.integration?.missingFeatures
        ?? [],
      integrationWaitingFeatures: report.providerReleaseContract?.providerIntegration?.waitingFeatures
        ?? report.providerPreview?.integration?.waitingFeatures
        ?? [],
      executionTicketId: report.providerIntegrationExecutionTicket?.id,
      executionTicketState: report.providerIntegrationExecutionTicket?.state,
      executionTicketReady: report.providerIntegrationExecutionTicket?.ready === true,
      executionTicketNextAction: report.providerIntegrationExecutionTicket?.nextAction,
      executionTicketResumeCursor: report.providerIntegrationExecutionTicket?.resumeCursor,
      executionTicketBlockedGates: report.providerIntegrationExecutionTicket?.validationSummary?.blockedGateIds ?? [],
      executionTicketWaitingGates: report.providerIntegrationExecutionTicket?.validationSummary?.waitingGateIds ?? [],
      executionTicketBlockedJobs: report.providerIntegrationExecutionTicket?.validationSummary?.blockedJobIds ?? [],
      executionTicketWaitingJobs: report.providerIntegrationExecutionTicket?.validationSummary?.waitingJobIds ?? [],
      releaseMissingCapabilities: report.providerReleaseContract?.capabilityNegotiation?.missing ?? [],
      capabilityReplayStatus: report.providerCapabilityDryRunState?.status
        ?? report.providerPreview?.capabilityReplay?.state,
      capabilityReplayReady: report.providerCapabilityDryRunState?.ready === true
        || report.providerPreview?.capabilityReplay?.ready === true,
      capabilityReplayNextAction: report.providerCapabilityDryRunState?.clientPatch?.providerCapabilityReplayNextAction
        ?? report.providerPreview?.capabilityReplay?.nextAction,
      capabilityReplayResumeCursor: report.providerCapabilityDryRunState?.resumeCursor
        ?? report.providerPreview?.capabilityReplay?.resumeCursor,
      capabilityReplayMissing: report.providerCapabilityDryRunState?.missingCapabilities
        ?? report.providerPreview?.capabilityReplay?.missingCapabilities
        ?? [],
      capabilityReplayHeld: report.providerCapabilityDryRunState?.heldCapabilities
        ?? report.providerPreview?.capabilityReplay?.heldCapabilities
        ?? [],
      credentialLeaseStatus: report.providerCredentialLeaseDryRunState?.status
        ?? report.providerPreview?.capabilityReplay?.credentialLeaseState
        ?? report.providerService?.providerCredentialLease?.state,
      credentialLeaseReady: report.providerCredentialLeaseDryRunState?.ready === true
        || report.providerService?.providerCredentialLease?.ready === true,
      credentialLeaseNextAction: report.providerCredentialLeaseDryRunState?.clientPatch?.providerCredentialLeaseNextAction
        ?? report.providerService?.providerCredentialLease?.nextAction,
      credentialLeaseResumeCursor: report.providerCredentialLeaseDryRunState?.resumeCursor
        ?? report.providerService?.providerCredentialLease?.resumeCursor,
      credentialLeaseBlockedScopes: report.providerCredentialLeaseDryRunState?.blockedScopes
        ?? report.providerService?.providerCredentialLease?.blockedScopes
        ?? [],
      credentialLeaseWaitingScopes: report.providerCredentialLeaseDryRunState?.waitingScopes
        ?? report.providerService?.providerCredentialLease?.waitingScopes
        ?? [],
      credentialLeaseHeldScopes: report.providerCredentialLeaseDryRunState?.heldScopes
        ?? report.providerService?.providerCredentialLease?.heldScopes
        ?? [],
      runtimeProviderHandoffState: report.runtimeProviderHandoffDryRunState?.state
        ?? report.providerPreview?.runtimeProviderHandoff?.state,
      runtimeProviderHandoffReady: report.runtimeProviderHandoffDryRunState?.ready === true
        || report.providerPreview?.runtimeProviderHandoff?.ready === true,
      runtimeProviderHandoffNextAction: report.runtimeProviderHandoffDryRunState?.nextAction
        ?? report.providerPreview?.runtimeProviderHandoff?.nextAction,
      runtimeProviderHandoffResumeCursor: report.runtimeProviderHandoffDryRunState?.resumeCursor
        ?? report.providerPreview?.runtimeProviderHandoff?.resumeCursor,
      runtimeProviderHandoffBlockedJobs: report.runtimeProviderHandoffDryRunState?.blockedJobIds
        ?? report.providerPreview?.runtimeProviderHandoff?.blockedJobIds
        ?? [],
      runtimeProviderHandoffWaitingJobs: report.runtimeProviderHandoffDryRunState?.waitingJobIds
        ?? report.providerPreview?.runtimeProviderHandoff?.waitingJobIds
        ?? [],
      releaseBlockedJobIds: report.providerReleaseContract?.validationSummary?.blockedJobIds ?? [],
      releaseWaitingJobIds: report.providerReleaseContract?.validationSummary?.waitingJobIds ?? [],
    },
    clientReadiness: {
      id: report.clientReadinessDryRun?.id,
      sourcePacketId: report.clientReadinessDryRun?.sourcePacketId,
      state: report.clientReadinessDryRun?.state,
      ready: report.clientReadinessDryRun?.ready === true,
      visibleStatus: report.clientReadinessDryRun?.visibleStatus,
      nextAction: report.clientReadinessDryRun?.nextAction,
      commandId: report.clientReadinessDryRun?.command?.commandId,
      wouldPersist: report.clientReadinessDryRun?.command?.wouldPersist === true,
      blockedReadinessKeys: report.clientReadinessDryRun?.validationSummary?.blockedReadinessKeys ?? [],
      waitingReadinessKeys: report.clientReadinessDryRun?.validationSummary?.waitingReadinessKeys ?? [],
      blockedJobIds: report.clientReadinessDryRun?.validationSummary?.blockedJobIds ?? [],
      waitingJobIds: report.clientReadinessDryRun?.validationSummary?.waitingJobIds ?? [],
      missingInputNames: report.clientReadinessDryRun?.validationSummary?.missingInputNames ?? [],
    },
    clientWorkflowHandoff: {
      id: report.clientWorkflowHandoffDryRun?.id,
      sourceGateId: report.clientWorkflowHandoffDryRun?.sourceGateId,
      state: report.clientWorkflowHandoffDryRun?.state,
      ready: report.clientWorkflowHandoffDryRun?.ready === true,
      visibleStatus: report.clientWorkflowHandoffDryRun?.visibleStatus,
      nextAction: report.clientWorkflowHandoffDryRun?.nextAction,
      commandId: report.clientWorkflowHandoffDryRun?.command?.commandId,
      wouldPersist: report.clientWorkflowHandoffDryRun?.command?.wouldPersist === true,
      health: report.clientWorkflowHandoffDryRun?.health?.status,
      actionableErrorCodes: report.clientWorkflowHandoffDryRun?.actionableErrors?.map((error) => error.code) ?? [],
      blockedWorkflowKeys: report.clientWorkflowHandoffDryRun?.health?.blockedWorkflowKeys ?? [],
      waitingWorkflowKeys: report.clientWorkflowHandoffDryRun?.health?.waitingWorkflowKeys ?? [],
      blockedJobIds: report.clientWorkflowHandoffDryRun?.health?.blockedJobIds ?? [],
      waitingJobIds: report.clientWorkflowHandoffDryRun?.health?.waitingJobIds ?? [],
      resumeCursors: report.clientWorkflowHandoffDryRun?.clientPatch?.resumeCursors ?? [],
      restartSafe: report.clientWorkflowHandoffDryRun?.dryRunGuarantee?.restartSafe === true,
    },
    runtimeReleaseDecision: {
      state: report.runtimeReleaseDecision?.state,
      ready: report.runtimeReleaseDecision?.ready === true,
      visibleStatus: report.runtimeReleaseDecision?.visibleStatus,
      nextAction: report.runtimeReleaseDecision?.nextAction,
      owner: report.runtimeReleaseDecision?.owner,
      releaseToken: report.runtimeReleaseDecision?.releaseToken,
      releaseCommandId: report.runtimeReleaseDecision?.releaseCommand?.commandId,
      blockedGateIds: report.runtimeReleaseDecision?.clientPatch?.runtimeReleaseBlockedGateIds ?? [],
      waitingGateIds: report.runtimeReleaseDecision?.clientPatch?.runtimeReleaseWaitingGateIds ?? [],
      operatorInstructionId: report.runtimeReleaseDecision?.clientPatch?.runtimeReleaseOperatorInstructionId ?? null,
      operatorInstructionState: report.runtimeReleaseDecision?.clientPatch?.runtimeReleaseOperatorInstructionState ?? "missing",
      operatorInstructionReady: report.runtimeReleaseDecision?.clientPatch?.runtimeReleaseOperatorInstructionReady === true,
      operatorBlockedGateIds: report.runtimeReleaseDecision?.clientPatch?.runtimeReleaseOperatorBlockedGateIds ?? [],
      operatorWaitingGateIds: report.runtimeReleaseDecision?.clientPatch?.runtimeReleaseOperatorWaitingGateIds ?? [],
      operatorRequiredAcknowledgements: report.runtimeReleaseDecision?.clientPatch?.runtimeReleaseOperatorRequiredAcknowledgements ?? [],
      gates: report.runtimeReleaseDecision?.gates ?? {},
      counters: report.runtimeReleaseDecision?.counters ?? {},
    },
    runtimeBoundary: {
      id: report.runtimeBoundaryDryRun?.id,
      sourcePacketId: report.runtimeBoundaryDryRun?.sourcePacketId,
      state: report.runtimeBoundaryDryRun?.state,
      ready: report.runtimeBoundaryDryRun?.ready === true,
      exportReady: report.runtimeBoundaryDryRun?.exportReady === true,
      visibleStatus: report.runtimeBoundaryDryRun?.visibleStatus,
      nextAction: report.runtimeBoundaryDryRun?.nextAction,
      commandId: report.runtimeBoundaryDryRun?.command?.commandId,
      counters: report.runtimeBoundaryDryRun?.counters ?? {},
      blockedKeys: report.runtimeBoundaryDryRun?.clientPatch?.runtimeBoundaryBlockedKeys ?? [],
      waitingKeys: report.runtimeBoundaryDryRun?.clientPatch?.runtimeBoundaryWaitingKeys ?? [],
      blockedJobIds: report.runtimeBoundaryDryRun?.clientPatch?.runtimeBoundaryBlockedJobIds ?? [],
      waitingJobIds: report.runtimeBoundaryDryRun?.clientPatch?.runtimeBoundaryWaitingJobIds ?? [],
      executionTicketId: report.runtimeBoundaryExecutionTickets?.id,
      executionTicketState: report.runtimeBoundaryExecutionTickets?.state,
      executionTicketReady: report.runtimeBoundaryExecutionTickets?.ready === true,
      executionTicketReadyForRelease: report.runtimeBoundaryExecutionTickets?.readyForRuntimeRelease === true,
      executionTicketNextAction: report.runtimeBoundaryExecutionTickets?.nextAction,
      executionTicketCommandIds: report.runtimeBoundaryExecutionTickets?.clientPatch?.runtimeBoundaryExecutionTicketCommandIds ?? [],
      executionTicketBlockedJobIds: report.runtimeBoundaryExecutionTickets?.clientPatch?.runtimeBoundaryExecutionTicketBlockedJobIds ?? [],
      executionTicketWaitingJobIds: report.runtimeBoundaryExecutionTickets?.clientPatch?.runtimeBoundaryExecutionTicketWaitingJobIds ?? [],
    },
    releaseAcceptance: {
      id: report.releaseAcceptanceDryRun?.id,
      sourceContractId: report.releaseAcceptanceDryRun?.sourceContractId,
      state: report.releaseAcceptanceDryRun?.state,
      ready: report.releaseAcceptanceDryRun?.ready === true,
      accepted: report.releaseAcceptanceDryRun?.accepted === true,
      visibleStatus: report.releaseAcceptanceDryRun?.visibleStatus,
      nextAction: report.releaseAcceptanceDryRun?.nextAction,
      commandId: report.releaseAcceptanceDryRun?.command?.commandId,
      providerReleaseReady: report.releaseAcceptanceDryRun?.validationSummary?.providerReleaseReady === true,
      operatorAccepted: report.releaseAcceptanceDryRun?.validationSummary?.operatorAccepted === true,
      blockedJobIds: report.releaseAcceptanceDryRun?.validationSummary?.blockedJobIds ?? [],
      waitingJobIds: report.releaseAcceptanceDryRun?.validationSummary?.waitingJobIds ?? [],
      requiredInputNames: report.releaseAcceptanceDryRun?.validationSummary?.requiredInputNames ?? [],
    },
    lifecycleSettingsAdoption: {
      id: report.lifecycleSettingsAdoptionDryRun?.id,
      sourceContractId: report.lifecycleSettingsAdoptionDryRun?.sourceContractId,
      state: report.lifecycleSettingsAdoptionDryRun?.state,
      ready: report.lifecycleSettingsAdoptionDryRun?.ready === true,
      visibleStatus: report.lifecycleSettingsAdoptionDryRun?.visibleStatus,
      nextAction: report.lifecycleSettingsAdoptionDryRun?.nextAction,
      commandId: report.lifecycleSettingsAdoptionDryRun?.command?.commandId,
      wouldPersist: report.lifecycleSettingsAdoptionDryRun?.command?.wouldPersist === true,
      blockedKeys: report.lifecycleSettingsAdoptionDryRun?.validationSummary?.blockedKeys ?? [],
      waitingKeys: report.lifecycleSettingsAdoptionDryRun?.validationSummary?.waitingKeys ?? [],
      reviewKeys: report.lifecycleSettingsAdoptionDryRun?.validationSummary?.reviewKeys ?? [],
      runtimeStartEnabled: report.lifecycleSettingsAdoptionDryRun?.validationSummary?.runtimeStartEnabled === true,
      providerState: report.lifecycleSettingsAdoptionDryRun?.validationSummary?.providerState,
    },
    operationalRunbook: {
      state: report.operationalRunbook?.state,
      owner: report.operationalRunbook?.owner,
      nextAction: report.operationalRunbook?.nextAction,
      degradedMode: report.operationalRunbook?.degradedMode === true,
      retryable: report.operationalRunbook?.retry?.retryable === true,
      nextBackoffMs: report.operationalRunbook?.retry?.nextBackoffMs ?? 0,
      blockers: report.operationalRunbook?.counters?.blockers ?? 0,
      warnings: report.operationalRunbook?.counters?.warnings ?? 0,
      steps: report.operationalRunbook?.steps?.map((step) => ({
        id: step.id,
        state: step.state,
        action: step.action,
        owner: step.owner,
      })) ?? [],
    },
    operationalHealthExport: {
      status: report.operationalHealthExport?.status,
      exportReady: report.operationalHealthExport?.exportReady === true,
      owner: report.operationalHealthExport?.owner,
      nextAction: report.operationalHealthExport?.nextAction,
      counters: report.operationalHealthExport?.counters ?? {},
      retryable: report.operationalHealthExport?.retry?.retryable === true,
      nextBackoffMs: report.operationalHealthExport?.retry?.nextBackoffMs ?? 0,
      blockerCodes: report.operationalHealthExport?.exportSummary?.blockerCodes ?? [],
      warningCodes: report.operationalHealthExport?.exportSummary?.warningCodes ?? [],
      historySnapshotIds: report.operationalHealthExport?.exportSummary?.historySnapshotIds ?? [],
    },
    dryRunAnalyticsExport: {
      status: report.dryRunAnalyticsExport?.status,
      exportReady: report.dryRunAnalyticsExport?.exportReady === true,
      nextAction: report.dryRunAnalyticsExport?.nextAction,
      counters: report.dryRunAnalyticsExport?.counters ?? {},
      blockerCodes: report.dryRunAnalyticsExport?.exportSummary?.blockerCodes ?? [],
      warningCodes: report.dryRunAnalyticsExport?.exportSummary?.warningCodes ?? [],
      historySnapshotIds: report.dryRunAnalyticsExport?.exportSummary?.historySnapshotIds ?? [],
      timelineEventIds: report.dryRunAnalyticsExport?.exportSummary?.timelineEventIds ?? [],
    },
    reportingState: {
      id: report.reportingState?.id,
      status: report.reportingState?.status,
      exportReady: report.reportingState?.exportReady === true,
      nextAction: report.reportingState?.nextAction,
      reportingCursor: report.reportingState?.reportingCursor,
      counters: report.reportingState?.counters ?? {},
      latestSnapshotId: report.reportingState?.historyIndex?.latestSnapshotId ?? null,
      blockerCodes: report.reportingState?.exportSummary?.blockerCodes ?? [],
      warningCodes: report.reportingState?.exportSummary?.warningCodes ?? [],
      failedTimelineEvents: report.reportingState?.timelineIndex?.failedEventRefs ?? [],
      waitingTimelineEvents: report.reportingState?.timelineIndex?.waitingEventRefs ?? [],
    },
    runtimeExportWatermark: {
      id: report.runtimeExportWatermark?.id,
      status: report.runtimeExportWatermark?.status,
      exportReady: report.runtimeExportWatermark?.exportReady === true,
      nextAction: report.runtimeExportWatermark?.nextAction,
      cursor: report.runtimeExportWatermark?.cursor,
      dedupeKey: report.runtimeExportWatermark?.dedupeKey,
      latestHistorySnapshotId: report.runtimeExportWatermark?.highWatermarks?.latestHistorySnapshotId ?? null,
      latestTimelineEventId: report.runtimeExportWatermark?.highWatermarks?.latestTimelineEventId ?? null,
      partitionStatuses: report.runtimeExportWatermark?.exportSummary?.partitionStatuses ?? {},
      blockedJobIds: report.runtimeExportWatermark?.exportSummary?.blockedJobIds ?? [],
      waitingJobIds: report.runtimeExportWatermark?.exportSummary?.waitingJobIds ?? [],
    },
    claimExportAcceptance: {
      id: report.claimExportAcceptance?.id,
      status: report.claimExportAcceptance?.status,
      ready: report.claimExportAcceptance?.ready === true,
      visibleStatus: report.claimExportAcceptance?.visibleStatus,
      nextAction: report.claimExportAcceptance?.nextAction,
      digest: report.claimExportAcceptance?.digest,
      blockedArtifactNames: report.claimExportAcceptance?.validationSummary?.blockedArtifactNames ?? [],
      missingInputNames: report.claimExportAcceptance?.validationSummary?.missingInputNames ?? [],
      publishCommandIds: report.claimExportAcceptance?.validationSummary?.publishCommandIds ?? [],
      requiredInputNames: report.claimExportAcceptance?.requiredInputs
        ?.filter((input) => input.required)
        .map((input) => input.name) ?? [],
    },
    claimOperatorReadiness: {
      id: report.claimOperatorReadinessDryRun?.id,
      sourceGateId: report.claimOperatorReadinessDryRun?.sourceGateId,
      sourcePacketId: report.claimOperatorReadinessDryRun?.sourcePacketId,
      state: report.claimOperatorReadinessDryRun?.state,
      ready: report.claimOperatorReadinessDryRun?.ready === true,
      visibleStatus: report.claimOperatorReadinessDryRun?.visibleStatus,
      nextAction: report.claimOperatorReadinessDryRun?.nextAction,
      commandId: report.claimOperatorReadinessDryRun?.command?.commandId,
      wouldPersist: report.claimOperatorReadinessDryRun?.command?.wouldPersist === true,
      blockedReadinessKeys: report.claimOperatorReadinessDryRun?.validationSummary?.blockedReadinessKeys ?? [],
      waitingReadinessKeys: report.claimOperatorReadinessDryRun?.validationSummary?.waitingReadinessKeys ?? [],
      blockedJobIds: report.claimOperatorReadinessDryRun?.validationSummary?.blockedJobIds ?? [],
      waitingJobIds: report.claimOperatorReadinessDryRun?.validationSummary?.waitingJobIds ?? [],
      pendingFacts: report.claimOperatorReadinessDryRun?.validationSummary?.pendingFacts ?? [],
      issueCodes: report.claimOperatorReadinessDryRun?.validationSummary?.issueCodes ?? [],
      restartSafe: report.claimOperatorReadinessDryRun?.dryRunGuarantee?.restartSafe === true,
    },
    tenantAudit: {
      status: report.tenantAuditHandoff?.status,
      safeBoundary: report.tenantAuditHandoff?.safeBoundary,
      isolationKey: report.tenantAuditHandoff?.isolationKey,
      tenantId: report.tenantAuditHandoff?.scope?.tenantId,
      workspaceId: report.tenantAuditHandoff?.scope?.workspaceId,
      nextAction: report.tenantAuditHandoff?.handoff?.nextAction,
      blockedJobIds: report.tenantAuditHandoff?.permissions?.blockedJobIds ?? [],
      approvalJobIds: report.tenantAuditHandoff?.permissions?.approvalJobIds ?? [],
      missingScopes: report.tenantAuditHandoff?.permissions?.missing ?? [],
    },
    tenantBoundaryMatrix: {
      id: report.tenantBoundaryMatrix?.id,
      status: report.tenantBoundaryMatrix?.status,
      safeBoundary: report.tenantBoundaryMatrix?.safeBoundary === true,
      exportReady: report.tenantBoundaryMatrix?.exportReady === true,
      isolationKey: report.tenantBoundaryMatrix?.isolationKey,
      nextAction: report.tenantBoundaryMatrix?.audit?.nextAction,
      blockedJobIds: report.tenantBoundaryMatrix?.clientPatch?.tenantBoundaryBlockedJobs ?? [],
      approvalJobIds: report.tenantBoundaryMatrix?.clientPatch?.tenantBoundaryApprovalJobs ?? [],
      missingScopes: report.tenantBoundaryMatrix?.clientPatch?.tenantBoundaryMissingScopes ?? [],
      counters: report.tenantBoundaryMatrix?.counters ?? {},
    },
    executorPlanReport: {
      id: report.executorPlanReport?.id,
      status: report.executorPlanReport?.status,
      visibleStatus: report.executorPlanReport?.visibleStatus,
      nextAction: report.executorPlanReport?.nextAction,
      readinessStatus: report.executorPlanReport?.exportSummary?.readinessStatus,
      acceptanceStatus: report.executorPlanReport?.exportSummary?.acceptanceStatus,
      providerState: report.executorPlanReport?.exportSummary?.providerState,
      providerHealthStatus: report.executorPlanReport?.exportSummary?.providerHealthStatus,
      lifecycleReleaseGateState: report.executorPlanReport?.exportSummary?.lifecycleReleaseGateState,
      counters: report.executorPlanReport?.counters ?? {},
      historySnapshotIds: report.executorPlanReport?.exportSummary?.historySnapshotIds ?? [],
    },
    acceptance: {
      accepted: report.acceptancePreview?.accepted,
      status: report.acceptancePreview?.status,
      visibleStatus: report.acceptancePreview?.visibleStatus,
      nextAction: report.acceptancePreview?.nextAction,
      receiptId: report.acceptancePreview?.receipt?.id,
      acceptanceToken: report.acceptancePreview?.receipt?.acceptanceToken,
      receiptStatus: report.acceptancePreview?.receipt?.status,
      readyForRuntimeStart: report.acceptancePreview?.receipt?.readyForRuntimeStart === true,
      validationSummary: report.acceptancePreview?.receipt?.validationSummary,
      commandReleaseStatus: report.acceptancePreview?.commandRelease?.status,
      commandReleaseReady: report.acceptancePreview?.commandRelease?.ready === true,
      commandReleaseNextAction: report.acceptancePreview?.commandRelease?.nextAction,
      commandReleaseCounts: report.acceptancePreview?.commandRelease?.counts,
      commandReleaseBlockedJobs: report.acceptancePreview?.commandRelease?.clientPatch?.acceptanceCommandReleaseBlockedJobs ?? [],
      commandReleaseWaitingJobs: report.acceptancePreview?.commandRelease?.clientPatch?.acceptanceCommandReleaseWaitingJobs ?? [],
    },
    acceptanceReadiness: {
      id: report.acceptanceReadinessDryRun?.id,
      sourceLedgerId: report.acceptanceReadinessDryRun?.sourceLedgerId,
      status: report.acceptanceReadinessDryRun?.status,
      ready: report.acceptanceReadinessDryRun?.ready === true,
      visibleStatus: report.acceptanceReadinessDryRun?.visibleStatus,
      nextAction: report.acceptanceReadinessDryRun?.nextAction,
      safeBoundary: report.acceptanceReadinessDryRun?.safeBoundary === true,
      commandId: report.acceptanceReadinessDryRun?.command?.id,
      restartSafe: report.acceptanceReadinessDryRun?.restartSemantics?.restartSafe === true,
      replayCursor: report.acceptanceReadinessDryRun?.restartSemantics?.replayCursor,
      blockedKeys: report.acceptanceReadinessDryRun?.validationSummary?.blockedKeys ?? [],
      waitingKeys: report.acceptanceReadinessDryRun?.validationSummary?.waitingKeys ?? [],
      blockedJobIds: report.acceptanceReadinessDryRun?.validationSummary?.blockedJobIds ?? [],
      waitingJobIds: report.acceptanceReadinessDryRun?.validationSummary?.waitingJobIds ?? [],
      commandIds: report.acceptanceReadinessDryRun?.validationSummary?.commandIds ?? [],
      resumeCursors: report.acceptanceReadinessDryRun?.validationSummary?.resumeCursors ?? [],
    },
    clientRuntimeHandoff: {
      state: report.clientRuntimeHandoff?.state,
      syncContractId: report.clientRuntimeHandoff?.sync?.contractId,
      replayCursor: report.clientRuntimeHandoff?.resumability?.replayCursor,
      clientOperationStateIds: report.clientRuntimeHandoff?.resumability?.clientOperationStateIds ?? [],
      blockedClientOperationStateIds: report.clientRuntimeHandoff?.resumability?.blockedClientOperationStateIds ?? [],
      clientCommandLeaseIds: report.clientRuntimeHandoff?.resumability?.clientCommandLeaseIds ?? [],
      blockedClientCommandLeaseIds: report.clientRuntimeHandoff?.resumability?.blockedClientCommandLeaseIds ?? [],
      acceptanceCommandReleaseStatus: report.clientRuntimeHandoff?.resumability?.acceptanceCommandReleaseStatus,
      acceptanceCommandReleaseReady: report.clientRuntimeHandoff?.resumability?.acceptanceCommandReleaseReady === true,
      acceptanceCommandIds: report.clientRuntimeHandoff?.resumability?.acceptanceCommandIds ?? [],
      blockedAcceptanceCommandIds: report.clientRuntimeHandoff?.resumability?.blockedAcceptanceCommandIds ?? [],
      waitingAcceptanceCommandIds: report.clientRuntimeHandoff?.resumability?.waitingAcceptanceCommandIds ?? [],
    },
    clientRecovery: {
      id: report.clientRecoveryDryRun?.id,
      state: report.clientRecoveryDryRun?.state,
      ready: report.clientRecoveryDryRun?.ready === true,
      nextAction: report.clientRecoveryDryRun?.nextAction,
      retryable: report.clientRecoveryDryRun?.retry?.retryable === true,
      nextBackoffMs: report.clientRecoveryDryRun?.retry?.backoff?.[0]?.delayMs ?? 0,
      blockedJobIds: report.clientRecoveryDryRun?.blockedJobIds ?? [],
      waitingJobIds: report.clientRecoveryDryRun?.waitingJobIds ?? [],
      blockedKeys: report.clientRecoveryDryRun?.blockedKeys ?? [],
      waitingKeys: report.clientRecoveryDryRun?.waitingKeys ?? [],
      resumeCursor: report.clientRecoveryDryRun?.resumeCursor,
      actionableErrorCodes: report.clientRecoveryDryRun?.actionableErrors?.map((error) => error.code) ?? [],
    },
    clientCommandLeaseReplay: {
      status: report.clientCommandLeaseReplay?.status,
      ready: report.clientCommandLeaseReplay?.ready,
      exportReady: report.commandLeaseReplayExport?.exportReady === true,
      resumeToken: report.clientCommandLeaseReplay?.resumeToken,
      primaryLeaseId: report.clientCommandLeaseReplay?.primaryLeaseId,
      primaryAction: report.clientCommandLeaseReplay?.primaryAction,
      ackRequired: report.clientCommandLeaseReplay?.ack?.required === true,
      ackRequiredCount: report.clientCommandLeaseReplay?.ack?.requiredCount ?? 0,
      blockingCount: report.clientCommandLeaseReplay?.counts?.blocking ?? 0,
      nextAction: report.commandLeaseReplayExport?.nextAction,
    },
    restartRecovery: {
      id: report.recovery?.restartRecoveryMatrix?.id,
      state: report.recovery?.restartRecoveryMatrix?.state,
      restartSafe: report.recovery?.restartRecoveryMatrix?.restartSafe === true,
      nextAction: report.recovery?.restartRecoveryMatrix?.nextAction,
      replayCursor: report.recovery?.restartRecoveryMatrix?.replayCursor,
      counters: report.recovery?.restartRecoveryMatrix?.counters ?? {},
      blockedJobIds: report.recovery?.restartRecoveryMatrix?.clientPatch?.blockedJobIds ?? [],
      waitingJobIds: report.recovery?.restartRecoveryMatrix?.clientPatch?.waitingJobIds ?? [],
      replayableJobIds: report.recovery?.restartRecoveryMatrix?.clientPatch?.replayableJobIds ?? [],
      resumeCursors: report.recovery?.restartRecoveryMatrix?.clientPatch?.resumeCursors ?? [],
    },
    packagePreview: {
      previewId: report.packagePreviewState?.previewId,
      status: report.packagePreviewState?.status,
      visibleStatus: report.packagePreviewState?.visibleStatus,
      nextAction: report.packagePreviewState?.nextAction,
      stateKey: report.packagePreviewState?.stateKey,
      resumeCursor: report.packagePreviewState?.resumeCursor,
      restartSafe: report.packagePreviewState?.restartSafe,
    },
    previewReadinessManifest: {
      id: report.previewReadinessManifestDryRun?.id,
      status: report.previewReadinessManifestDryRun?.status,
      visibleStatus: report.previewReadinessManifestDryRun?.visibleStatus,
      readyForClientPreview: report.previewReadinessManifestDryRun?.readyForClientPreview === true,
      readyForRuntimeStart: report.previewReadinessManifestDryRun?.readyForRuntimeStart === true,
      routeId: report.previewReadinessManifestDryRun?.route?.routeId,
      nextAction: report.previewReadinessManifestDryRun?.nextAction,
      nextSectionId: report.previewReadinessManifestDryRun?.nextSectionId,
      blockedSectionIds: report.previewReadinessManifestDryRun?.validationSummary?.blockedSectionIds ?? [],
      pendingSectionIds: report.previewReadinessManifestDryRun?.validationSummary?.pendingSectionIds ?? [],
      sectionStatuses: report.previewReadinessManifestDryRun?.sections?.map((section) => ({
        id: section.id,
        status: section.status,
        readyForClientPreview: section.readyForClientPreview,
        readyForRuntimeStart: section.readyForRuntimeStart,
        nextAction: section.nextAction,
      })) ?? [],
    },
    claimGatePendingFacts: report.claimGateReporting?.pendingFacts ?? [],
    packageLifecycleCommand: report.packageLifecycle?.command,
    packageLifecycleReleaseGateState: report.packageLifecycle?.releaseGate?.state,
    lifecycleRunControl: {
      state: report.lifecycle?.runControl?.state,
      ready: report.lifecycle?.runControl?.ready === true,
      nextAction: report.lifecycle?.runControl?.nextAction,
      controlKey: report.lifecycle?.runControl?.controlKey,
      requestedMode: report.lifecycle?.runControl?.requestedMode,
      freezeWindowActive: report.lifecycle?.runControl?.freezeWindow?.active === true,
      activeFreezeWindowId: report.lifecycle?.runControl?.freezeWindow?.activeWindow?.id,
      concurrencyExceeded: report.lifecycle?.runControl?.concurrency?.exceeded === true,
      requestedConcurrency: report.lifecycle?.runControl?.concurrency?.requested,
      maxConcurrentJobs: report.lifecycle?.runControl?.concurrency?.max,
    },
    truthBoundaryOpen: report.truthBoundaryReport.unverifiedFacts.length > 0,
    externalWritesPerformed: report.truthBoundaryReport.externalWritesPerformed,
  };
}
