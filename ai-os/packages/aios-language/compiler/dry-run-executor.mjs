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
    commandLeaseReplayStatus: leaseSnapshot.status,
    commandLeaseReplayReady: leaseSnapshot.ready,
  };
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
  ];
  const blockerCodes = [
    ...(operationalHealthExport.exportSummary?.blockerCodes ?? []),
    ...(analytics.tenantBoundary?.blockedJobIds ?? []).map((jobId) => `tenant-boundary:${jobId}`),
    ...(reportCore.providerReleaseContract?.validationSummary?.blockers ?? []),
  ].sort();
  const warningCodes = [
    ...(operationalHealthExport.exportSummary?.warningCodes ?? []),
    ...(analytics.tenantBoundary?.approvalJobIds ?? []).map((jobId) => `tenant-approval:${jobId}`),
    ...(reportCore.providerReleaseContract?.validationSummary?.waitingJobIds ?? []).map((jobId) => `provider-waiting:${jobId}`),
  ].sort();
  const exportReady = reportCore.status === "admitted"
    && operationalHealthExport.exportReady === true
    && analytics.commandLeaseReplay.exportReady === true
    && (analytics.tenantBoundary?.exportReady !== false)
    && reportCore.providerReleaseContract?.ready === true;
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
      tenantBoundaryReady: analytics.tenantBoundary?.exportReady === true,
      commandLeaseReplayReady: analytics.commandLeaseReplay.exportReady === true,
      runtimeStartEnabled: reportCore.lifecycle?.operatorControls?.runtimeStart?.enabled === true,
    },
    providerService: analytics.providerService,
    tenantBoundary: analytics.tenantBoundary,
    commandLeaseReplay: analytics.commandLeaseReplay,
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
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-dry-run-analytics-report-id",
      resumeFromReportId: reportCore.id,
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
  const negotiation = providerService.capabilityNegotiation ?? {};
  const releaseGate = providerService.lifecycle?.releaseGate ?? plan.package?.lifecycleControls?.releaseGate ?? {};
  const operationalHealth = providerService.operationalHealth ?? {};
  return {
    state: externalHandoff.state ?? "unknown",
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
    capabilityDecision: negotiation.decision ?? "unknown",
    requestedCapabilities: negotiation.requestedCapabilities ?? [],
    missingWorkspaceCapabilities: negotiation.missingWorkspaceCapabilities ?? [],
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
    clientVisibleStatus: externalHandoff.state === "ready"
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

function buildProviderReleaseContract(plan, providerPreview, providerHealth, jobResults, lifecycle, tenantAuditHandoff) {
  const sync = plan.providerService?.sync ?? {};
  const negotiation = plan.providerService?.capabilityNegotiation ?? {};
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
  const capabilitiesReady = missingCapabilities.length === 0
    && (negotiation.decision === "ready" || capabilityRows.every((row) => row.negotiated));
  const blocked = providerBlockedJobs.size > 0
    || providerReady === false
    || lifecycleReady === false
    || tenantReady === false
    || capabilitiesReady === false;
  const waiting = !blocked && (
    providerWaitingJobs.size > 0
    || tenantAuditHandoff.status === "needs-approval"
    || providerPreview.state === "waiting-for-approval"
    || lifecycle.nextAction?.state === "waiting"
  );
  const state = blocked ? "blocked" : waiting ? "waiting" : "ready";
  const blockers = [
    ...(providerReady ? [] : ["provider-health"]),
    ...(capabilitiesReady ? [] : ["capability-negotiation"]),
    ...(syncReady ? [] : ["provider-sync"]),
    ...(tenantReady ? [] : ["tenant-audit-boundary"]),
    ...(lifecycleReady ? [] : ["lifecycle-release-gate"]),
    ...[...providerBlockedJobs].map((jobId) => `job:${jobId}`),
  ];
  const nextAction = blockers.includes("provider-health")
    ? providerHealth.nextAction || "repair-provider-handoff"
    : blockers.includes("capability-negotiation")
      ? "negotiate-provider-capabilities"
      : blockers.includes("provider-sync")
        ? "refresh-provider-sync-before-release"
        : blockers.includes("tenant-audit-boundary")
          ? tenantAuditHandoff.handoff?.nextAction || "resolve-tenant-permission-boundary"
          : blockers.includes("lifecycle-release-gate")
            ? lifecycle.nextAction?.action || "repair-lifecycle-settings"
            : waiting
              ? "collect-approval-before-provider-release"
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
    capabilityNegotiation: {
      decision: negotiation.decision ?? "unknown",
      ready: capabilitiesReady,
      requested: [...new Set(requestedCapabilities)].sort(),
      missing: [...new Set(missingCapabilities)].sort(),
      rows: capabilityRows,
    },
    releaseGates: {
      providerHealthy: providerReady,
      syncReady,
      capabilitiesReady,
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

function buildClientRuntimeHandoff(plan, lifecycle, providerPreview, acceptancePreview, jobResults) {
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
  const state = acceptancePreview.accepted
    ? "ready"
    : acceptancePreview.visibleStatus === "waiting-for-approval"
      ? "waiting-for-approval"
      : acceptancePreview.visibleStatus === "repair-lifecycle-settings"
        ? "blocked"
        : providerPreview.state === "ready"
          ? "review"
          : providerPreview.state ?? "unknown";
  return {
    id: stableId("clienthandoff", [
      plan.id,
      claimRuntime.clientStateKey,
      acceptancePreview.id,
      lifecycle.nextAction.commandId,
    ]),
    product: "mailchimp",
    state,
    visibleStatus: acceptancePreview.visibleStatus,
    primaryAction: acceptancePreview.primaryAction,
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
  providerReleaseContract,
  tenantAuditHandoff,
  acceptancePreview,
  clientCommandLeaseReplay,
  commandLeaseReplayExport,
) {
  const receipt = acceptancePreview.receipt ?? {};
  const commandRelease = acceptancePreview.commandRelease ?? {};
  const lifecycleRuntimeStartEnabled = lifecycle.operatorControls?.runtimeStart?.enabled === true;
  const lifecycleBlocked = lifecycle.valid !== true || lifecycleRuntimeStartEnabled !== true;
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
      state: lifecycleBlocked ? "blocked" : "ready",
      owner: "operator",
      nextAction: lifecycle.nextAction?.action || "review-lifecycle-controls",
      detail: lifecycleBlocked
        ? "Lifecycle controls do not currently allow runtime start."
        : "Lifecycle controls allow runtime start.",
      commandId: lifecycle.operatorControls?.runtimeStart?.commandId ?? null,
      blockingCodes: lifecycle.validationIssues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code),
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
      blockedJobs: [
        ...(tenantAuditHandoff.permissions?.blockedJobIds ?? []),
        ...(providerReleaseContract.validationSummary?.blockedJobIds ?? []),
        ...(commandLeaseReplayExport.jobIds?.blocking ?? []),
      ].length,
      waitingJobs: [
        ...(tenantAuditHandoff.permissions?.approvalJobIds ?? []),
        ...(providerReleaseContract.validationSummary?.waitingJobIds ?? []),
        ...(commandLeaseReplayExport.jobIds?.ackRequired ?? []),
      ].length,
    },
    rows: releaseRows,
    blockers: blockedRows.flatMap((row) => row.blockingCodes.length > 0 ? row.blockingCodes : [row.id]),
    waitingOn: waitingRows.map((row) => row.id),
    clientPatch: {
      runtimeReleaseDecisionArtifact: "runtime-release-decision.json",
      runtimeReleaseState: state,
      runtimeReleaseReady: state === "ready",
      runtimeReleaseToken: releaseToken,
      runtimeReleaseNextAction: state === "ready"
        ? "release-runtime-handoff"
        : primaryRow?.nextAction || "review-runtime-release-decision",
      runtimeReleaseCommandId: releaseCommandId,
      runtimeReleaseBlockedGateIds: blockedRows.map((row) => row.id),
      runtimeReleaseWaitingGateIds: waitingRows.map((row) => row.id),
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-runtime-release-token",
      resumeFromReleaseToken: releaseToken,
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
  const dryRunBlocked = ["blocked", "skipped"].includes(reportCore.status);
  const analyticsReady = reportCore.dryRunAnalyticsExport?.exportReady === true
    || analytics.commandLeaseReplay?.exportReady === true;
  const missingArtifacts = (exportPacket.artifactNames ?? [])
    .filter((name) => !(exportPacket.blockedArtifactNames ?? []).includes(name));
  const blockedArtifactNames = exportPacket.blockedArtifactNames ?? [];
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
    },
    restartSemantics: {
      replaySafe: status !== "blocked",
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

function buildLifecycleControls(plan, jobResults, status, options = {}) {
  const settings = normalizeLifecycleSettings(options);
  const validationIssues = validateLifecycleSettings(settings, plan, jobResults, status);
  const commands = buildLifecycleCommands(settings, plan, jobResults, status, validationIssues);
  const nextAction = deriveLifecycleNextAction(settings, status, validationIssues, commands);
  const errorFree = validationIssues.every((issue) => issue.severity !== "error");
  const operatorControls = buildLifecycleOperatorControls(
    plan,
    jobResults,
    settings,
    validationIssues,
    commands,
    nextAction,
    status,
  );
  return {
    settings,
    valid: errorFree,
    validationIssues,
    validationSummary: operatorControls.validationSummary,
    operatorControls,
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
        allowed: settings.enabled && errorFree,
        windowStart: settings.schedule.windowStart,
        windowEnd: settings.schedule.windowEnd,
        paused: settings.schedule.paused,
        maxScheduledJobs: settings.schedule.maxScheduledJobs,
      },
    },
    commands,
    nextAction,
  };
}

export function dryRunExecutor(input, options = {}) {
  const plan = input?.kind === "AiosExecutorPlan" ? input : createExecutorPlan(input ?? {}, options);
  const simulatedJobResults = plan.jobs.map((job) => simulateJob(job, plan.status, options.retry ?? {}));
  const status = deriveStatus(plan, simulatedJobResults);
  const lifecycle = buildLifecycleControls(plan, simulatedJobResults, status, options.lifecycle ?? {});
  const providerPreview = buildProviderPreview(plan, lifecycle);
  const clientCommandLeaseReplay = buildClientCommandLeaseReplay(plan, simulatedJobResults, lifecycle, providerPreview);
  const commandLeaseReplayExport = buildCommandLeaseReplayExportSnapshot(clientCommandLeaseReplay);
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
  const providerReleaseContract = buildProviderReleaseContract(
    plan,
    providerPreview,
    providerHealth,
    jobResults,
    lifecycle,
    tenantAuditHandoff,
  );
  const releaseAcceptanceDryRun = buildReleaseAcceptanceDryRun(
    plan,
    providerReleaseContract,
    acceptancePreview,
    jobResults,
  );
  const clientRuntimeHandoff = buildClientRuntimeHandoff(
    plan,
    lifecycle,
    providerPreview,
    acceptancePreview,
    jobResults,
  );
  const runtimeReleaseDecision = buildRuntimeReleaseDecision(
    plan,
    status,
    lifecycle,
    providerReleaseContract,
    tenantAuditHandoff,
    acceptancePreview,
    clientCommandLeaseReplay,
    commandLeaseReplayExport,
  );
  const executorPlanReport = buildExecutorPlanReportPreview(plan);
  const claimGateReporting = buildClaimGateReportingPreview(plan);
  const claimAcknowledgmentState = buildClaimAcknowledgmentState(plan, lifecycle, acceptancePreview);
  const packageLifecycle = buildPackageLifecyclePreview(plan);
  const packagePreviewState = buildPackagePreviewState(plan, jobResults, lifecycle, acceptancePreview);
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
    providerPreview,
    providerHealth,
    providerReleaseContract,
    releaseAcceptanceDryRun,
    runtimeReleaseDecision,
    acceptancePreview,
    clientRuntimeHandoff,
    clientCommandLeaseReplay,
    commandLeaseReplayExport,
    executorPlanReport,
    claimGateReporting,
    claimAcknowledgmentState,
    packageLifecycle,
    packagePreviewState,
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
  const analytics = buildAnalytics(plan, jobResults, tenantBoundaryMatrix);
  const history = buildHistorySnapshots(plan, jobResults, status, tenantBoundaryMatrix);
  const operationalHealthExport = buildOperationalHealthExport(reportWithRunbook, history);
  const dryRunAnalyticsExport = buildDryRunAnalyticsExportReport(
    reportWithRunbook,
    analytics,
    history,
    operationalHealthExport,
  );
  const claimExportAcceptance = buildClaimExportAcceptancePreview(
    plan,
    claimGateReporting,
    {
      ...reportWithRunbook,
      dryRunAnalyticsExport,
    },
    analytics,
    history,
  );
  const reportWithExports = {
    ...reportWithRunbook,
    dryRunAnalyticsExport,
    claimExportAcceptance,
  };
  return {
    ...reportWithExports,
    analytics,
    history,
    operationalHealthExport,
    dryRunAnalyticsExport,
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
    degradedMode: report.degradedMode.enabled,
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
      releaseMissingCapabilities: report.providerReleaseContract?.capabilityNegotiation?.missing ?? [],
      releaseBlockedJobIds: report.providerReleaseContract?.validationSummary?.blockedJobIds ?? [],
      releaseWaitingJobIds: report.providerReleaseContract?.validationSummary?.waitingJobIds ?? [],
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
      gates: report.runtimeReleaseDecision?.gates ?? {},
      counters: report.runtimeReleaseDecision?.counters ?? {},
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
    packagePreview: {
      previewId: report.packagePreviewState?.previewId,
      status: report.packagePreviewState?.status,
      visibleStatus: report.packagePreviewState?.visibleStatus,
      nextAction: report.packagePreviewState?.nextAction,
      stateKey: report.packagePreviewState?.stateKey,
      resumeCursor: report.packagePreviewState?.resumeCursor,
      restartSafe: report.packagePreviewState?.restartSafe,
    },
    claimGatePendingFacts: report.claimGateReporting?.pendingFacts ?? [],
    packageLifecycleCommand: report.packageLifecycle?.command,
    packageLifecycleReleaseGateState: report.packageLifecycle?.releaseGate?.state,
    truthBoundaryOpen: report.truthBoundaryReport.unverifiedFacts.length > 0,
    externalWritesPerformed: report.truthBoundaryReport.externalWritesPerformed,
  };
}
