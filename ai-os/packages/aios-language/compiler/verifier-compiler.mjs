const DEFAULT_VERIFIER_RULES = [
  {
    id: "mailchimp.subject.present",
    severity: "error",
    path: "campaign.subject",
    predicate: "nonEmptyString",
    message: "Mailchimp campaign subject is required."
  },
  {
    id: "mailchimp.audience.confirmed",
    severity: "error",
    path: "audience.id",
    predicate: "nonEmptyString",
    message: "Mailchimp audience id must be selected before compilation."
  },
  {
    id: "mailchimp.external-write.approved",
    severity: "error",
    path: "approval.externalWrite",
    predicate: "isTrueWhenWrite",
    message: "Mailchimp write actions require an explicit approval token."
  },
  {
    id: "mailchimp.unsubscribe.boundary",
    severity: "warning",
    path: "campaign.footer.unsubscribeLink",
    predicate: "truthy",
    message: "Campaign footer should include an unsubscribe boundary before scheduling."
  }
];

function readPath(value, path) {
  return path.split(".").reduce((node, part) => (node == null ? undefined : node[part]), value);
}

function evaluatePredicate(predicate, value, context) {
  if (predicate === "nonEmptyString") return typeof value === "string" && value.trim().length > 0;
  if (predicate === "truthy") return Boolean(value);
  if (predicate === "isTrueWhenWrite") return !context.hasExternalWrite || value === true;
  return false;
}

function summarizeRulesForPreview(rules) {
  return rules.reduce((summary, rule) => {
    summary.total += 1;
    summary.bySeverity[rule.severity] = (summary.bySeverity[rule.severity] || 0) + 1;
    if (rule.recovery === "block-runtime-handoff") summary.blockingRuleIds.push(rule.id);
    summary.requiredPaths.push(rule.path);
    return summary;
  }, {
    total: 0,
    bySeverity: {},
    blockingRuleIds: [],
    requiredPaths: []
  });
}

function stableVerifierSnapshotId(seed) {
  const text = JSON.stringify(seed, Object.keys(seed).sort());
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `verifier_snapshot_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeVerifierBoolean(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizeVerifierInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return numeric;
}

export function compileVerifierLifecycleControls(rules = [], options = {}) {
  const diagnostics = [];
  const controlSource = options.verifierControls || options.lifecycleControls || {};
  const enabled = normalizeVerifierBoolean(controlSource.enabled, true);
  const mode = controlSource.mode || "enforce";
  const schedule = controlSource.schedule || "preflight";
  const maxPendingEvaluations = normalizeVerifierInteger(controlSource.maxPendingEvaluations, 1);
  const evaluationTimeoutSeconds = normalizeVerifierInteger(controlSource.evaluationTimeoutSeconds, 30);
  const allowedModes = new Set(["enforce", "observe", "disabled"]);
  const allowedSchedules = new Set(["compile", "preflight", "before-provider-write", "manual"]);
  const blockingRules = rules.filter((rule) => rule.severity === "error");
  const approvalRules = rules.filter((rule) => rule.predicate === "isTrueWhenWrite");
  const warningRules = rules.filter((rule) => rule.severity === "warning");

  if (!allowedModes.has(mode)) {
    diagnostics.push({
      level: "error",
      code: "verifier.lifecycle.mode.unsupported",
      message: `Unsupported verifier lifecycle mode: ${mode}`,
      nextAction: "select-supported-verifier-mode"
    });
  }

  if (!allowedSchedules.has(schedule)) {
    diagnostics.push({
      level: "error",
      code: "verifier.lifecycle.schedule.unsupported",
      message: `Unsupported verifier lifecycle schedule: ${schedule}`,
      nextAction: "select-supported-verifier-schedule"
    });
  }

  if (!enabled && mode === "enforce" && blockingRules.length) {
    diagnostics.push({
      level: "warning",
      code: "verifier.lifecycle.disabled_blocking_rules",
      message: "Verifier is disabled while blocking Mailchimp rules are present.",
      nextAction: "enable-verifier-or-switch-to-observe-mode"
    });
  }

  if (schedule === "manual" && approvalRules.length && options.requireApprovalToken !== false) {
    diagnostics.push({
      level: "warning",
      code: "verifier.lifecycle.manual_approval_deferred",
      message: "External write approval verification is deferred to a manual lifecycle schedule.",
      nextAction: "collect-manual-approval-before-provider-write"
    });
  }

  const status = diagnostics.some((diagnostic) => diagnostic.level === "error")
    ? "invalid"
    : !enabled || mode === "disabled"
      ? "disabled"
      : mode === "observe"
        ? "observe-only"
        : schedule === "manual"
          ? "manual-action-required"
          : "ready";
  const canEvaluateAutomatically = status === "ready" && schedule !== "manual";
  const blocksRuntimeHandoff = status === "invalid"
    || (status === "disabled" && blockingRules.length > 0)
    || (status === "manual-action-required" && blockingRules.length > 0);
  const requiredCommands = [
    {
      command: "verifier.evaluate",
      enabled: enabled && mode !== "disabled",
      schedule,
      required: blockingRules.length > 0,
      nextAction: canEvaluateAutomatically ? "evaluate-candidate-before-runtime-handoff" : "await-manual-verifier-evaluation"
    },
    {
      command: "verifier.enable",
      enabled: !enabled || mode === "disabled",
      schedule: "runtime-control",
      required: status === "disabled" && blockingRules.length > 0,
      nextAction: "enable-verifier-controls"
    },
    {
      command: "verifier.accept-warning",
      enabled: warningRules.length > 0,
      schedule: "operator-review",
      required: false,
      nextAction: warningRules.length ? "surface-warning-review-control" : "no-action"
    },
    {
      command: "verifier.collect-approval",
      enabled: approvalRules.length > 0,
      schedule: "before-provider-write",
      required: approvalRules.length > 0 && options.requireApprovalToken !== false,
      nextAction: approvalRules.length ? "collect-external-write-approval" : "no-action"
    }
  ];

  return {
    kind: "aios.verifierLifecycleControls",
    provider: "mailchimp",
    status,
    enabled,
    mode,
    schedule,
    canEvaluateAutomatically,
    blocksRuntimeHandoff,
    settings: {
      maxPendingEvaluations,
      evaluationTimeoutSeconds,
      requireApprovalToken: options.requireApprovalToken !== false,
      allowedModes: Array.from(allowedModes),
      allowedSchedules: Array.from(allowedSchedules)
    },
    commands: requiredCommands,
    nextActions: requiredCommands
      .filter((command) => command.required || command.enabled)
      .map((command) => ({
        command: command.command,
        nextAction: command.nextAction,
        required: command.required,
        schedule: command.schedule
      })),
    diagnostics,
    counters: {
      rules: rules.length,
      blockingRules: blockingRules.length,
      warningRules: warningRules.length,
      approvalRules: approvalRules.length,
      commands: requiredCommands.length,
      diagnostics: diagnostics.length
    },
    truthBoundary: {
      source: "verifier-lifecycle-controls",
      externalFactsChecked: false,
      deterministic: true
    }
  };
}

export function compileVerifierRuntimeReleaseGate(rules = [], lifecycleControls = null, options = {}) {
  const controls = lifecycleControls || compileVerifierLifecycleControls(rules, options);
  const blockingRules = rules.filter((rule) => rule.severity === "error");
  const warningRules = rules.filter((rule) => rule.severity === "warning");
  const approvalRules = rules.filter((rule) => rule.predicate === "isTrueWhenWrite");
  const manualCommands = (controls.commands || [])
    .filter((command) => command.required && command.enabled === false || command.schedule === "manual");
  const gateRows = [
    {
      id: "verifier-lifecycle-enabled",
      label: "Mailchimp verifier lifecycle controls",
      status: controls.enabled && controls.mode !== "disabled" ? "ready" : "blocked",
      ready: controls.enabled && controls.mode !== "disabled",
      required: blockingRules.length > 0,
      nextAction: controls.enabled && controls.mode !== "disabled"
        ? "evaluate-candidate-before-runtime-handoff"
        : "enable-verifier-controls",
      evidence: {
        mode: controls.mode,
        schedule: controls.schedule,
        blockingRuleIds: blockingRules.map((rule) => rule.id)
      }
    },
    {
      id: "verifier-runtime-schedule",
      label: "Mailchimp verifier runtime schedule",
      status: controls.schedule === "manual" ? "waiting" : controls.status === "invalid" ? "blocked" : "ready",
      ready: controls.status !== "invalid" && controls.schedule !== "manual",
      required: blockingRules.length > 0,
      nextAction: controls.schedule === "manual"
        ? "complete-manual-verifier-evaluation"
        : controls.status === "invalid"
          ? "repair-verifier-lifecycle-controls"
          : "handoff-to-runtime-adapter",
      evidence: {
        canEvaluateAutomatically: controls.canEvaluateAutomatically === true,
        maxPendingEvaluations: controls.settings?.maxPendingEvaluations || 1,
        evaluationTimeoutSeconds: controls.settings?.evaluationTimeoutSeconds || 30
      }
    },
    {
      id: "verifier-approval-boundary",
      label: "Mailchimp external write approval verifier",
      status: approvalRules.length && options.requireApprovalToken !== false ? "waiting" : "ready",
      ready: approvalRules.length === 0 || options.requireApprovalToken === false,
      required: approvalRules.length > 0 && options.requireApprovalToken !== false,
      nextAction: approvalRules.length && options.requireApprovalToken !== false
        ? "collect-external-write-approval"
        : "handoff-to-runtime-adapter",
      evidence: {
        approvalRuleIds: approvalRules.map((rule) => rule.id),
        requireApprovalToken: options.requireApprovalToken !== false
      }
    }
  ];
  const blockedRows = gateRows.filter((row) => row.required && row.status === "blocked");
  const waitingRows = gateRows.filter((row) => row.required && row.status === "waiting");
  const ready = blockedRows.length === 0
    && waitingRows.length === 0
    && controls.blocksRuntimeHandoff !== true;
  const gateId = stableVerifierSnapshotId({
    kind: "verifier-runtime-release-gate",
    status: controls.status,
    mode: controls.mode,
    schedule: controls.schedule,
    blockingRuleIds: blockingRules.map((rule) => rule.id),
    warningRuleIds: warningRules.map((rule) => rule.id),
    approvalRuleIds: approvalRules.map((rule) => rule.id)
  });

  return {
    kind: "aios.verifierRuntimeReleaseGate",
    provider: "mailchimp",
    gateId,
    status: blockedRows.length
      ? "blocked"
      : waitingRows.length
        ? "needs-operator-action"
        : ready
          ? "ready"
          : controls.status || "unknown",
    readyForRuntimeRelease: ready,
    nextAction: blockedRows[0]?.nextAction
      || waitingRows[0]?.nextAction
      || controls.nextActions?.[0]?.nextAction
      || "handoff-to-runtime-adapter",
    gateRows,
    validationSummary: {
      total: gateRows.length,
      ready: gateRows.filter((row) => row.ready).length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      blockingRuleIds: blockingRules.map((rule) => rule.id),
      warningRuleIds: warningRules.map((rule) => rule.id),
      approvalRuleIds: approvalRules.map((rule) => rule.id),
      manualCommandCount: manualCommands.length
    },
    clientPatch: {
      verifierRuntimeReleaseGateId: gateId,
      verifierRuntimeReleaseGateReady: ready,
      verifierRuntimeReleaseGateStatus: blockedRows.length
        ? "blocked"
        : waitingRows.length
          ? "needs-operator-action"
          : "ready",
      verifierRuntimeReleaseGateNextAction: blockedRows[0]?.nextAction
        || waitingRows[0]?.nextAction
        || "handoff-to-runtime-adapter",
      verifierRuntimeReleaseBlockedRows: blockedRows.map((row) => row.id),
      verifierRuntimeReleaseWaitingRows: waitingRows.map((row) => row.id)
    },
    truthBoundary: {
      source: "verifier-runtime-release-gate",
      externalFactsChecked: false,
      deterministic: true
    }
  };
}

export function compileVerifierProviderCallbackContract(verifierContract = {}, options = {}) {
  const rules = verifierContract.rules || [];
  const lifecycleControls = verifierContract.lifecycleControls
    || compileVerifierLifecycleControls(rules, options);
  const callbackSource = options.providerCallbackHandoff
    || verifierContract.providerCallbackHandoff
    || verifierContract.runtimeHandoff?.providerCallbackHandoff
    || {};
  const requiredEvents = Array.from(new Set(
    (callbackSource.requiredEvents || [
      "campaign.sent",
      "campaign.send_failed",
      "audience.sync_completed"
    ]).filter(Boolean).map(String)
  )).sort();
  const acknowledgedEvents = Array.from(new Set(
    (callbackSource.acknowledgedEvents || []).filter(Boolean).map(String)
  )).sort();
  const hasEndpoint = typeof callbackSource.endpointId === "string"
    && callbackSource.endpointId.trim().length > 0;
  const hasSigningSecret = typeof callbackSource.signingSecretRef === "string"
    && callbackSource.signingSecretRef.trim().length > 0;
  const missingEvents = requiredEvents.filter((event) => !acknowledgedEvents.includes(event));
  const blocksRuntimeHandoff = lifecycleControls.blocksRuntimeHandoff === true
    || hasEndpoint === false
    || hasSigningSecret === false;
  const callbackKey = stableVerifierSnapshotId({
    kind: "provider-callback-contract",
    endpointId: callbackSource.endpointId || "missing",
    requiredEvents,
    acknowledgedEvents,
    signingSecretRef: hasSigningSecret ? "declared" : "missing"
  });

  return {
    kind: "aios.verifierProviderCallbackContract",
    schemaVersion: "aios.mailchimp.verifier-provider-callback-contract.v1",
    provider: "mailchimp",
    callbackKey,
    status: blocksRuntimeHandoff
      ? "blocked"
      : missingEvents.length
        ? "needs-operator-action"
        : "ready",
    readyForRuntimeHandoff: blocksRuntimeHandoff === false && missingEvents.length === 0,
    endpoint: {
      endpointId: callbackSource.endpointId || null,
      signingSecretRef: callbackSource.signingSecretRef || null,
      required: true,
      declared: hasEndpoint && hasSigningSecret
    },
    events: {
      required: requiredEvents,
      acknowledged: acknowledgedEvents,
      missing: missingEvents
    },
    verifierBoundary: {
      lifecycleStatus: lifecycleControls.status,
      blocksRuntimeHandoff: lifecycleControls.blocksRuntimeHandoff === true,
      requiredRuleIds: rules
        .filter((rule) => rule.severity === "error")
        .map((rule) => rule.id)
        .sort()
    },
    nextAction: hasEndpoint === false
      ? "declare-mailchimp-callback-endpoint"
      : hasSigningSecret === false
        ? "declare-mailchimp-callback-signing-secret"
        : lifecycleControls.blocksRuntimeHandoff
          ? lifecycleControls.nextActions?.[0]?.nextAction || "complete-verifier-lifecycle-action"
          : missingEvents.length
            ? "acknowledge-mailchimp-callback-events"
            : "handoff-to-runtime-adapter",
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-callback-key",
      resumeToken: `${callbackKey}:resume`,
      externalWritesPerformed: false
    },
    truthBoundary: {
      source: "verifier-provider-callback-contract",
      externalFactsChecked: false,
      deterministic: true
    }
  };
}

export function compileVerifierHealthContract(rules, diagnostics = [], options = {}) {
  const blockingRules = rules.filter((rule) => rule.severity === "error");
  const warningRules = rules.filter((rule) => rule.severity === "warning");
  const diagnosticErrors = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const requiresApproval = rules.some((rule) => rule.predicate === "isTrueWhenWrite");
  const missingRecovery = rules.filter((rule) => !rule.recovery);
  const degraded = diagnosticErrors.length > 0 || missingRecovery.length > 0;
  const healthStatus = diagnosticErrors.length
    ? "unhealthy"
    : degraded
      ? "degraded"
      : blockingRules.length
        ? "healthy-blocking-until-evaluated"
        : warningRules.length
          ? "healthy-with-warnings"
          : "healthy";
  const retryable = diagnosticErrors.length === 0;
  const backoffBaseSeconds = Number.isInteger(Number(options.backoffBaseSeconds))
    ? Number(options.backoffBaseSeconds)
    : 2;
  const maxAttempts = Number.isInteger(Number(options.maxVerifierAttempts))
    ? Number(options.maxVerifierAttempts)
    : 3;
  const lifecycleControls = options.verifierLifecycleControls || options.lifecycleControls || null;
  const lifecycleBlocks = lifecycleControls?.blocksRuntimeHandoff === true;

  return {
    provider: "mailchimp",
    healthStatus,
    degradedMode: lifecycleBlocks
      ? "verifier-lifecycle-controls-block-runtime-handoff"
      : degraded
      ? "render-preview-but-block-runtime-handoff"
      : blockingRules.length
        ? "require-local-evaluation-before-runtime"
        : "runtime-handoff-eligible",
    retryable,
    failureState: diagnosticErrors.length
      ? "compiled-rule-errors"
      : lifecycleBlocks
        ? "lifecycle-controls-blocking"
      : missingRecovery.length
        ? "recovery-metadata-incomplete"
        : "none",
    actionableErrors: [
      ...diagnosticErrors.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
        nextAction: "fix-verifier-rule"
      })),
      ...missingRecovery.map((rule) => ({
        code: "verifier.rule.recovery.missing",
        ruleId: rule.id,
        message: `${rule.id} is missing recovery metadata.`,
        nextAction: "compile-default-recovery"
      })),
      ...(lifecycleBlocks
        ? [{
          code: "verifier.lifecycle.controls.blocking",
          message: "Verifier lifecycle controls block runtime handoff.",
          nextAction: lifecycleControls.status === "disabled"
            ? "enable-verifier-controls"
            : "complete-manual-verifier-evaluation"
        }]
        : [])
    ],
    retryPolicy: {
      retryable,
      maxAttempts,
      backoffBaseSeconds,
      backoffScheduleSeconds: Array.from({ length: maxAttempts }, (_, index) => (
        backoffBaseSeconds * (2 ** index)
      )),
      stopWhen: diagnosticErrors.length ? "rule-contract-fixed" : "local-evaluation-complete"
    },
    runtimeReadiness: {
      canEvaluateLocally: diagnosticErrors.length === 0,
      canRenderClientPreview: true,
      canHandoffToRuntime: diagnosticErrors.length === 0 && blockingRules.length === 0 && !lifecycleBlocks,
      requiresApproval,
      blockingRuleIds: blockingRules.map((rule) => rule.id),
      warningRuleIds: warningRules.map((rule) => rule.id)
    },
    statusMapping: {
      healthy: "ready-for-runtime-adapter",
      "healthy-with-warnings": "ready-with-operator-visible-warning",
      "healthy-blocking-until-evaluated": "requires-local-evaluation",
      degraded: "degraded-preview-only",
      unhealthy: "blocked-before-mailchimp-handoff"
    },
    lifecycleControls: lifecycleControls
      ? {
        status: lifecycleControls.status,
        mode: lifecycleControls.mode,
        schedule: lifecycleControls.schedule,
        canEvaluateAutomatically: lifecycleControls.canEvaluateAutomatically,
        blocksRuntimeHandoff: lifecycleControls.blocksRuntimeHandoff,
        nextActions: lifecycleControls.nextActions
      }
      : null,
    truthBoundary: {
      source: "compiled-verifier-rules",
      externalFactsChecked: false,
      deterministic: true
    }
  };
}

export function compileVerifierAnalyticsReport(verifierContract = {}, evaluation = null, options = {}) {
  const rules = verifierContract.rules || [];
  const diagnostics = verifierContract.diagnostics || [];
  const health = verifierContract.health || compileVerifierHealthContract(rules, diagnostics, options);
  const findings = evaluation?.findings || [];
  const failedRuleIds = new Set(findings.map((finding) => finding.ruleId));
  const severityCounts = rules.reduce((counts, rule) => {
    counts[rule.severity] = (counts[rule.severity] || 0) + 1;
    return counts;
  }, { error: 0, warning: 0 });
  const findingCounts = findings.reduce((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] || 0) + 1;
    return counts;
  }, { error: 0, warning: 0 });
  const snapshotSeed = {
    rules: rules.map((rule) => rule.id),
    healthStatus: health.healthStatus,
    evaluationStatus: evaluation?.status || "not-evaluated",
    failedRuleIds: Array.from(failedRuleIds).sort()
  };
  const snapshotId = stableVerifierSnapshotId(snapshotSeed);
  const ruleSnapshots = rules.map((rule, index) => {
    const failed = failedRuleIds.has(rule.id);
    return {
      order: index + 1,
      ruleId: rule.id,
      path: rule.path,
      severity: rule.severity,
      predicate: rule.predicate,
      status: evaluation ? failed ? "failed" : "passed" : "compiled",
      recovery: rule.recovery,
      exportReady: !failed || rule.severity !== "error"
    };
  });
  const timelineExport = compileVerifierTimelineExport({
    rules,
    diagnostics,
    health
  }, evaluation, {
    ...options,
    snapshotId,
    ruleSnapshots
  });

  return {
    kind: "aios.verifierAnalyticsReport",
    provider: "mailchimp",
    snapshotId,
    status: evaluation?.status || "not-evaluated",
    healthStatus: health.healthStatus,
    exportFormat: "aios.mailchimp.verifier.report.v1",
    counters: {
      rules: rules.length,
      errorRules: severityCounts.error || 0,
      warningRules: severityCounts.warning || 0,
      findings: findings.length,
      errorFindings: findingCounts.error || 0,
      warningFindings: findingCounts.warning || 0,
      diagnostics: diagnostics.length,
      actionableErrors: health.actionableErrors?.length || 0
    },
    history: {
      snapshots: timelineExport.snapshots,
      timeline: timelineExport.timeline
    },
    rules: ruleSnapshots,
    exportSummary: {
      acceptedForRuntime: evaluation?.readiness?.acceptedForRuntime ?? health.runtimeReadiness.canHandoffToRuntime,
      acceptedForExternalWrite: evaluation?.readiness?.acceptedForExternalWrite ?? false,
      blockingRuleIds: ruleSnapshots
        .filter((rule) => rule.severity === "error" && rule.status !== "passed")
        .map((rule) => rule.ruleId),
      warningRuleIds: ruleSnapshots
        .filter((rule) => rule.severity === "warning")
        .map((rule) => rule.ruleId),
      requiredPaths: Array.from(new Set(rules.map((rule) => rule.path))).sort()
    },
    persistedStateContract: {
      namespace: "verifier.snapshots",
      snapshotKey: `verifier.snapshots.${snapshotId}`,
      statusKey: "verifier.currentStatus",
      missingStatePolicy: "rebuild-report-from-compiled-rules",
      adoptionEvent: "mailchimp.verifier.report.adopted"
    },
    timelineExport,
    truthBoundary: {
      source: evaluation ? "candidate-evaluation" : "compiled-verifier-rules",
      externalFactsChecked: false,
      deterministic: true
    }
  };
}

export function compileVerifierTimelineExport(verifierContract = {}, evaluation = null, options = {}) {
  const rules = verifierContract.rules || [];
  const diagnostics = verifierContract.diagnostics || [];
  const health = verifierContract.health || compileVerifierHealthContract(rules, diagnostics, options);
  const findings = evaluation?.findings || [];
  const failedRuleIds = new Set(findings.map((finding) => finding.ruleId));
  const snapshotId = options.snapshotId || stableVerifierSnapshotId({
    rules: rules.map((rule) => rule.id),
    healthStatus: health.healthStatus,
    evaluationStatus: evaluation?.status || "not-evaluated",
    failedRuleIds: Array.from(failedRuleIds).sort()
  });
  const ruleSnapshots = options.ruleSnapshots || rules.map((rule, index) => ({
    order: index + 1,
    ruleId: rule.id,
    path: rule.path,
    severity: rule.severity,
    predicate: rule.predicate,
    status: failedRuleIds.has(rule.id) ? "failed" : evaluation ? "passed" : "compiled",
    recovery: rule.recovery,
    exportReady: !failedRuleIds.has(rule.id) || rule.severity !== "error"
  }));
  const diagnosticsByLevel = diagnostics.reduce((counts, diagnostic) => {
    counts[diagnostic.level] = (counts[diagnostic.level] || 0) + 1;
    return counts;
  }, { error: 0, warning: 0, info: 0 });
  const evaluated = Boolean(evaluation);
  const blockers = evaluated
    ? ruleSnapshots.filter((rule) => rule.severity === "error" && rule.status === "failed")
    : [];
  const pendingBlockingRules = evaluated
    ? []
    : ruleSnapshots.filter((rule) => rule.severity === "error");
  const warnings = ruleSnapshots.filter((rule) => rule.severity === "warning" && rule.status !== "passed");
  const exportReady = blockers.length === 0 && health.healthStatus !== "unhealthy";
  const compileStatus = health.statusMapping?.[health.healthStatus] || health.healthStatus;
  const evaluationStatus = evaluation?.status || "not-evaluated";
  const timeline = [
    {
      order: 1,
      snapshotId,
      event: "mailchimp.verifier.compiled",
      status: compileStatus,
      nextAction: health.retryPolicy?.stopWhen || "local-evaluation-complete",
      counters: {
        rules: rules.length,
        diagnostics: diagnostics.length,
        actionableErrors: health.actionableErrors?.length || 0
      }
    },
    ...(evaluation
      ? [{
        order: 2,
        snapshotId,
        event: "mailchimp.verifier.evaluated",
        status: evaluationStatus,
        nextAction: evaluation.readiness?.nextStep || "handoff-to-runtime-adapter",
        counters: {
          findings: findings.length,
          failedErrors: findings.filter((finding) => finding.severity === "error").length,
          failedWarnings: findings.filter((finding) => finding.severity === "warning").length
        }
      }]
      : [{
        order: 2,
        snapshotId,
        event: "mailchimp.verifier.awaiting-local-evaluation",
        status: "pending",
        nextAction: "evaluate-candidate-before-runtime-handoff",
        counters: {
          requiredClientState: Array.from(new Set(rules.map((rule) => rule.path.split(".")[0]))).length
        }
      }]),
    {
      order: evaluation ? 3 : 3,
      snapshotId,
      event: "mailchimp.verifier.export.summary",
      status: !evaluated && pendingBlockingRules.length ? "pending-evaluation" : exportReady ? "export-ready" : "export-blocked",
      nextAction: !evaluated && pendingBlockingRules.length
        ? "evaluate-candidate-before-runtime-handoff"
        : exportReady
          ? "adopt-verifier-report"
          : "resolve-blocking-verifier-rules",
      counters: {
        blockingRules: blockers.length,
        pendingBlockingRules: pendingBlockingRules.length,
        warningRules: warnings.length
      }
    }
  ];

  return {
    kind: "aios.verifierTimelineExport",
    provider: "mailchimp",
    snapshotId,
    exportReady,
    exportFormat: "aios.mailchimp.verifier.timeline.v1",
    status: !evaluated && pendingBlockingRules.length ? "pending-evaluation" : exportReady ? "ready" : "blocked",
    snapshots: [
      {
        id: snapshotId,
        label: evaluation ? "evaluation" : "compile",
        status: evaluation ? evaluationStatus : compileStatus,
        counters: {
          rules: rules.length,
          findings: findings.length,
          actionableErrors: health.actionableErrors?.length || 0,
          diagnostics: diagnostics.length
        }
      }
    ],
    timeline,
    ruleOutcomes: ruleSnapshots.map((rule) => ({
      ruleId: rule.ruleId,
      path: rule.path,
      severity: rule.severity,
      status: rule.status,
      exportReady: rule.exportReady,
      recovery: rule.recovery
    })),
    reportSummary: {
      requiredPaths: Array.from(new Set(rules.map((rule) => rule.path))).sort(),
      blockingRuleIds: blockers.map((rule) => rule.ruleId),
      pendingBlockingRuleIds: pendingBlockingRules.map((rule) => rule.ruleId),
      warningRuleIds: warnings.map((rule) => rule.ruleId),
      diagnosticsByLevel,
      acceptedForRuntime: exportReady && (evaluation?.readiness?.acceptedForRuntime ?? true),
      acceptedForExternalWrite: evaluation?.readiness?.acceptedForExternalWrite ?? false
    },
    persistedStateContract: {
      namespace: "verifier.timeline",
      snapshotKey: `verifier.timeline.${snapshotId}`,
      statusKey: "verifier.timeline.currentStatus",
      adoptionEvent: "mailchimp.verifier.timeline.adopted",
      missingStatePolicy: "rebuild-timeline-from-verifier-report"
    },
    truthBoundary: {
      source: evaluation ? "candidate-evaluation" : "compiled-verifier-rules",
      externalFactsChecked: false,
      deterministic: true
    }
  };
}

export function compileVerifierReportHistoryManifest(verifierContract = {}, evaluation = null, options = {}) {
  const rules = verifierContract.rules || [];
  const diagnostics = verifierContract.diagnostics || [];
  const health = verifierContract.health || compileVerifierHealthContract(rules, diagnostics, options);
  const timelineExport = verifierContract.analyticsReport?.timelineExport
    || compileVerifierTimelineExport(verifierContract, evaluation, options);
  const findings = evaluation?.findings || [];
  const blockingRuleIds = timelineExport.reportSummary?.blockingRuleIds || [];
  const pendingBlockingRuleIds = timelineExport.reportSummary?.pendingBlockingRuleIds || [];
  const warningRuleIds = timelineExport.reportSummary?.warningRuleIds || [];
  const diagnosticsByLevel = timelineExport.reportSummary?.diagnosticsByLevel || { error: 0, warning: 0, info: 0 };
  const requiredClientRoots = Array.from(new Set(
    rules.map((rule) => rule.path.split(".")[0]).filter(Boolean)
  )).sort();
  const status = diagnosticsByLevel.error
    ? "blocked"
    : blockingRuleIds.length
      ? "blocked"
      : pendingBlockingRuleIds.length
        ? "awaiting-evaluation"
        : health.healthStatus === "degraded"
          ? "degraded-history-ready"
          : timelineExport.exportReady
            ? "history-ready"
            : "operator-review-required";
  const snapshotId = stableVerifierSnapshotId({
    sourceSnapshot: timelineExport.snapshotId,
    status,
    blockingRuleIds,
    pendingBlockingRuleIds,
    warningRuleIds,
    diagnosticsByLevel
  });
  const historySnapshots = [
    ...(timelineExport.snapshots || []),
    {
      id: snapshotId,
      label: "report-history",
      status,
      counters: {
        rules: rules.length,
        findings: findings.length,
        blockingRules: blockingRuleIds.length,
        pendingBlockingRules: pendingBlockingRuleIds.length,
        warningRules: warningRuleIds.length,
        diagnostics: diagnostics.length
      }
    }
  ];
  const timeline = [
    ...(timelineExport.timeline || []).map((event) => ({
      ...event,
      source: "verifier-timeline"
    })),
    {
      order: (timelineExport.timeline?.length || 0) + 1,
      snapshotId,
      source: "verifier-report-history",
      event: "mailchimp.verifier.report_history.shaped",
      status,
      nextAction: status === "blocked"
        ? "resolve-blocking-verifier-rules"
        : status === "awaiting-evaluation"
          ? "evaluate-candidate-before-runtime-handoff"
          : status === "operator-review-required"
            ? "review-verifier-warnings-before-runtime"
            : "adopt-verifier-report-history",
      counters: {
        snapshots: historySnapshots.length,
        requiredClientRoots: requiredClientRoots.length,
        diagnostics: diagnostics.length
      }
    }
  ];
  const requiredStateKeys = Array.from(new Set([
    timelineExport.persistedStateContract?.snapshotKey,
    timelineExport.persistedStateContract?.statusKey,
    `verifier.report_history.${snapshotId}`,
    "verifier.report_history.currentStatus",
    ...requiredClientRoots.map((root) => `verifier.client_state.${root}`)
  ].filter(Boolean))).sort();
  const exportReady = status === "history-ready" || status === "degraded-history-ready";

  return {
    kind: "aios.verifierReportHistoryManifest",
    provider: "mailchimp",
    snapshotId,
    sourceTimelineSnapshotId: timelineExport.snapshotId,
    status,
    exportFormat: "aios.mailchimp.verifier.report-history.v1",
    exportReady,
    acceptedForRuntime: exportReady && timelineExport.reportSummary?.acceptedForRuntime !== false,
    restartSemantics: {
      statusAfterRestart: status === "history-ready"
        ? "ready-for-runtime-adapter"
        : status === "degraded-history-ready"
          ? "degraded-preview-only"
          : status,
      canRebuildFromRules: true,
      canReuseLastEvaluation: Boolean(evaluation) && blockingRuleIds.length === 0,
      missingStatePolicy: status === "blocked"
        ? "block-until-verifier-history-state-restored"
        : "rebuild-history-from-compiled-rules-and-last-evaluation"
    },
    persistedStateContract: {
      namespace: "verifier.report_history",
      snapshotKey: `verifier.report_history.${snapshotId}`,
      statusKey: "verifier.report_history.currentStatus",
      requiredStateKeys,
      adoptionEvent: "mailchimp.verifier.report_history.adopted",
      statusEvent: "mailchimp.verifier.report_history.status",
      missingStatePolicy: status === "blocked"
        ? "block-until-verifier-history-state-restored"
        : "rebuild-history-from-compiled-rules"
    },
    analytics: {
      counters: {
        rules: rules.length,
        findings: findings.length,
        snapshots: historySnapshots.length,
        timelineEvents: timeline.length,
        blockingRules: blockingRuleIds.length,
        pendingBlockingRules: pendingBlockingRuleIds.length,
        warningRules: warningRuleIds.length,
        requiredClientRoots: requiredClientRoots.length,
        diagnostics: diagnostics.length,
        diagnostics_error: diagnosticsByLevel.error || 0,
        diagnostics_warning: diagnosticsByLevel.warning || 0,
        diagnostics_info: diagnosticsByLevel.info || 0
      },
      dimensions: {
        healthStatus: health.healthStatus,
        degradedMode: health.degradedMode,
        evaluationStatus: evaluation?.status || "not-evaluated",
        exportReady,
        acceptedForExternalWrite: timelineExport.reportSummary?.acceptedForExternalWrite === true
      }
    },
    reportSummary: {
      requiredPaths: timelineExport.reportSummary?.requiredPaths || [],
      requiredClientRoots,
      blockingRuleIds,
      pendingBlockingRuleIds,
      warningRuleIds,
      diagnosticsByLevel,
      acceptedForRuntime: timelineExport.reportSummary?.acceptedForRuntime === true,
      acceptedForExternalWrite: timelineExport.reportSummary?.acceptedForExternalWrite === true,
      nextActions: [
        ...blockingRuleIds.map((ruleId) => ({
          ruleId,
          nextAction: "resolve-blocking-verifier-rule",
          required: true
        })),
        ...pendingBlockingRuleIds.map((ruleId) => ({
          ruleId,
          nextAction: "evaluate-candidate-before-runtime-handoff",
          required: true
        })),
        ...warningRuleIds.map((ruleId) => ({
          ruleId,
          nextAction: "surface-verifier-warning",
          required: false
        }))
      ]
    },
    snapshots: historySnapshots,
    timeline,
    truthBoundary: {
      source: evaluation ? "candidate-evaluation" : "compiled-verifier-rules",
      externalFactsChecked: false,
      deterministic: true,
      persistedExternally: false
    }
  };
}

export function compileVerifierProviderServiceContract(verifierContract = {}, evaluation = null, options = {}) {
  const rules = verifierContract.rules || [];
  const lifecycleControls = verifierContract.lifecycleControls
    || compileVerifierLifecycleControls(rules, options);
  const health = verifierContract.health || compileVerifierHealthContract(rules, verifierContract.diagnostics || [], {
    ...options,
    verifierLifecycleControls: lifecycleControls
  });
  const reportHistory = verifierContract.reportHistoryManifest
    || compileVerifierReportHistoryManifest(verifierContract, evaluation, options);
  const runtimeHandoff = verifierContract.runtimeHandoff
    || buildRuntimeHandoffContract(rules, options, lifecycleControls);
  const blockingRuleIds = reportHistory.reportSummary?.blockingRuleIds || [];
  const pendingBlockingRuleIds = reportHistory.reportSummary?.pendingBlockingRuleIds || [];
  const warningRuleIds = reportHistory.reportSummary?.warningRuleIds || [];
  const requiredApprovalRuleIds = rules
    .filter((rule) => rule.predicate === "isTrueWhenWrite")
    .map((rule) => rule.id)
    .sort();
  const diagnostics = verifierContract.diagnostics || [];
  const diagnosticErrors = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const status = diagnosticErrors.length || health.healthStatus === "unhealthy"
    ? "blocked"
    : lifecycleControls.blocksRuntimeHandoff
      ? "lifecycle-action-required"
      : blockingRuleIds.length
        ? "blocked-by-evaluation"
        : pendingBlockingRuleIds.length
          ? "evaluation-required"
          : warningRuleIds.length || health.healthStatus === "degraded"
            ? "ready-with-review"
            : "ready";
  const requiredClientState = Array.from(new Set([
    ...(runtimeHandoff.requiredClientState || []),
    ...(reportHistory.reportSummary?.requiredClientRoots || [])
  ].filter(Boolean))).sort();
  const declaredProvider = options.providerServiceContract
    || verifierContract.providerIntegrationContract
    || verifierContract.providerService
    || {};
  const providerFeatureRows = Array.isArray(declaredProvider.featureRows)
    ? declaredProvider.featureRows
    : [];
  const providerMissingFeatures = Array.from(new Set([
    ...(declaredProvider.validationSummary?.missingFeatures || []),
    ...(declaredProvider.capabilityNegotiation?.missingFeatures || []),
    ...providerFeatureRows
      .filter((row) => row.state === "missing" || row.available === false)
      .map((row) => row.feature)
  ].filter(Boolean))).sort();
  const providerWaitingFeatures = Array.from(new Set([
    ...(declaredProvider.validationSummary?.waitingFeatures || []),
    ...providerFeatureRows
      .filter((row) => row.state === "waiting-for-schedule")
      .map((row) => row.feature)
  ].filter(Boolean))).sort();
  const requestedProviderCapabilities = Array.from(new Set([
    ...(declaredProvider.capabilityNegotiation?.requiredProviderCapabilities || []),
    ...(declaredProvider.requiredProviderCapabilities || []),
    ...(options.requiredProviderCapabilities || [])
  ].filter(Boolean))).sort();
  const providerState = declaredProvider.state
    || (providerMissingFeatures.length ? "blocked" : providerWaitingFeatures.length ? "waiting" : "ready");
  const providerReadinessRows = [
    {
      key: "verifier-report-history",
      state: reportHistory.exportReady ? "ready" : reportHistory.status === "awaiting-evaluation" ? "waiting" : "blocked",
      sourceId: reportHistory.snapshotId,
      nextAction: reportHistory.reportSummary?.nextActions?.[0]?.nextAction
        ?? (reportHistory.exportReady ? "adopt-verifier-report-history" : "evaluate-candidate-before-runtime-handoff"),
      blockedKeys: blockingRuleIds,
      waitingKeys: pendingBlockingRuleIds,
      restartSafe: reportHistory.restartSemantics?.missingStatePolicy !== "block-until-verifier-history-state-restored"
    },
    {
      key: "verifier-lifecycle",
      state: lifecycleControls.blocksRuntimeHandoff
        ? "blocked"
        : lifecycleControls.status === "manual-action-required"
          ? "waiting"
          : "ready",
      sourceId: lifecycleControls.status,
      nextAction: lifecycleControls.nextActions?.[0]?.nextAction ?? "continue-verifier-provider-readiness",
      blockedKeys: lifecycleControls.blocksRuntimeHandoff
        ? lifecycleControls.nextActions?.filter((item) => item.required).map((item) => item.command) ?? []
        : [],
      waitingKeys: lifecycleControls.status === "manual-action-required"
        ? lifecycleControls.nextActions?.map((item) => item.command) ?? []
        : [],
      restartSafe: lifecycleControls.status !== "invalid"
    },
    {
      key: "provider-capability-negotiation",
      state: providerMissingFeatures.length
        ? "blocked"
        : providerWaitingFeatures.length
          ? "waiting"
          : "ready",
      sourceId: declaredProvider.id ?? null,
      nextAction: providerMissingFeatures.length
        ? "repair-provider-service-contract"
        : providerWaitingFeatures.length
          ? "wait-for-provider-schedule"
          : "persist-verifier-provider-readiness",
      blockedKeys: providerMissingFeatures,
      waitingKeys: providerWaitingFeatures,
      restartSafe: providerMissingFeatures.length === 0
    },
    {
      key: "external-write-approval",
      state: requiredApprovalRuleIds.length === 0
        ? "ready"
        : runtimeHandoff.requiredApprovalState?.tokenRequired === false || status === "ready"
          ? "ready"
          : "waiting",
      sourceId: runtimeHandoff.requiredApprovalState?.path ?? null,
      nextAction: requiredApprovalRuleIds.length
        ? "collect-external-write-approval"
        : "continue-verifier-provider-readiness",
      blockedKeys: [],
      waitingKeys: status === "ready" ? [] : requiredApprovalRuleIds,
      restartSafe: true
    }
  ];
  const providerBlockedRows = providerReadinessRows.filter((row) => row.state === "blocked");
  const providerWaitingRows = providerReadinessRows.filter((row) => row.state === "waiting");
  const providerReadinessState = providerBlockedRows.length
    ? "blocked"
    : providerWaitingRows.length
      ? "waiting"
      : "ready";
  const providerReadinessId = stableVerifierSnapshotId({
    reportHistorySnapshotId: reportHistory.snapshotId,
    providerState,
    providerReadinessState,
    rows: providerReadinessRows.map((row) => `${row.key}:${row.state}:${row.sourceId}`).join(",")
  });

  return {
    kind: "aios.verifierProviderServiceContract",
    provider: "mailchimp",
    snapshotId: stableVerifierSnapshotId({
      reportHistorySnapshotId: reportHistory.snapshotId,
      lifecycleStatus: lifecycleControls.status,
      healthStatus: health.healthStatus,
      status,
      pendingBlockingRuleIds,
      blockingRuleIds
    }),
    status,
    acceptedForRuntimeAdapter: ["ready", "ready-with-review"].includes(status),
    acceptedForExternalWrite: status === "ready"
      && requiredApprovalRuleIds.length > 0
      && runtimeHandoff.requiredApprovalState?.tokenRequired !== false,
    providerService: "mailchimp-marketing-api",
    runtimeAdapter: runtimeHandoff.runtimeAdapter || options.runtimeAdapter || "mailchimp.campaignRuntimeAdapter",
    negotiation: {
      evaluationMode: lifecycleControls.mode,
      schedule: lifecycleControls.schedule,
      canEvaluateAutomatically: lifecycleControls.canEvaluateAutomatically === true,
      blocksRuntimeHandoff: lifecycleControls.blocksRuntimeHandoff === true,
      requiredClientState,
      requiredApprovalRuleIds,
      requiredApprovalPath: runtimeHandoff.requiredApprovalState?.path || null,
      reportHistorySnapshotId: reportHistory.snapshotId
    },
    adapterHandoff: {
      healthStatus: health.healthStatus,
      degradedMode: health.degradedMode,
      retryPolicy: health.retryPolicy,
      statusAfterRestart: reportHistory.restartSemantics?.statusAfterRestart || status,
      missingStatePolicy: reportHistory.persistedStateContract?.missingStatePolicy
        || "rebuild-history-from-compiled-rules",
      requiredStateKeys: reportHistory.persistedStateContract?.requiredStateKeys || [],
      adoptionEvent: reportHistory.persistedStateContract?.adoptionEvent
        || "mailchimp.verifier.report_history.adopted",
      statusEvent: reportHistory.persistedStateContract?.statusEvent
        || "mailchimp.verifier.report_history.status"
    },
    providerReadiness: {
      id: providerReadinessId,
      protocol: "aios.mailchimp.verifier-provider-readiness.v1",
      state: providerReadinessState,
      ready: providerReadinessState === "ready",
      providerState,
      requestedProviderCapabilities,
      missingProviderFeatures: providerMissingFeatures,
      waitingProviderFeatures: providerWaitingFeatures,
      rows: providerReadinessRows,
      nextAction: providerBlockedRows[0]?.nextAction
        ?? providerWaitingRows[0]?.nextAction
        ?? "persist-verifier-provider-readiness",
      clientPatch: {
        verifierProviderReadinessId: providerReadinessId,
        verifierProviderReadinessState: providerReadinessState,
        verifierProviderReadinessReady: providerReadinessState === "ready",
        verifierProviderReadinessNextAction: providerBlockedRows[0]?.nextAction
          ?? providerWaitingRows[0]?.nextAction
          ?? "persist-verifier-provider-readiness",
        verifierProviderBlockedKeys: providerBlockedRows.flatMap((row) => row.blockedKeys),
        verifierProviderWaitingKeys: providerWaitingRows.flatMap((row) => row.waitingKeys)
      },
      restartSemantics: {
        restartSafe: providerReadinessState !== "blocked" && providerReadinessRows.every((row) => row.restartSafe !== false),
        onRestart: providerReadinessState === "ready"
          ? "load-verifier-provider-readiness"
          : "rebuild-verifier-provider-readiness",
        onDuplicateCommand: "return-existing-verifier-provider-readiness",
        externalWritesPerformed: false
      }
    },
    blockers: [
      ...diagnosticErrors.map((diagnostic) => ({
        source: "verifier-diagnostic",
        ruleId: diagnostic.rule || diagnostic.code,
        nextAction: "fix-verifier-rule",
        required: true
      })),
      ...blockingRuleIds.map((ruleId) => ({
        source: "verifier-evaluation",
        ruleId,
        nextAction: "resolve-blocking-verifier-rule",
        required: true
      })),
      ...(lifecycleControls.blocksRuntimeHandoff
        ? (lifecycleControls.nextActions || []).filter((item) => item.required).map((item) => ({
          source: "verifier-lifecycle",
          ruleId: item.command,
          nextAction: item.nextAction,
          required: true
        }))
        : []),
      ...providerBlockedRows.map((row) => ({
        source: "provider-readiness",
        ruleId: row.key,
        nextAction: row.nextAction,
        required: true
      }))
    ],
    operatorActions: [
      ...pendingBlockingRuleIds.map((ruleId) => ({
        source: "verifier-evaluation",
        ruleId,
        nextAction: "evaluate-candidate-before-runtime-handoff",
        required: true
      })),
      ...warningRuleIds.map((ruleId) => ({
        source: "verifier-warning",
        ruleId,
        nextAction: "surface-verifier-warning",
        required: false
      })),
      ...(lifecycleControls.nextActions || []).filter((item) => !item.required).map((item) => ({
        source: "verifier-lifecycle",
        ruleId: item.command,
        nextAction: item.nextAction,
        required: false
      })),
      ...providerWaitingRows.map((row) => ({
        source: "provider-readiness",
        ruleId: row.key,
        nextAction: row.nextAction,
        required: false
      }))
    ],
    counters: {
      rules: rules.length,
      requiredClientState: requiredClientState.length,
      blockingRules: blockingRuleIds.length,
      pendingBlockingRules: pendingBlockingRuleIds.length,
      warningRules: warningRuleIds.length,
      approvalRules: requiredApprovalRuleIds.length,
      diagnostics: diagnostics.length,
      lifecycleActions: lifecycleControls.nextActions?.length || 0,
      providerReadinessRows: providerReadinessRows.length,
      providerBlockedRows: providerBlockedRows.length,
      providerWaitingRows: providerWaitingRows.length
    },
    truthBoundary: {
      source: "verifier-compiler",
      externalFactsChecked: false,
      deterministic: true
    }
  };
}

export function compileVerifierAcceptanceReviewPacket(verifierContract = {}, evaluation = null, options = {}) {
  const rules = verifierContract.rules || [];
  const diagnostics = verifierContract.diagnostics || [];
  const lifecycleControls = verifierContract.lifecycleControls
    || compileVerifierLifecycleControls(rules, options);
  const health = verifierContract.health || compileVerifierHealthContract(rules, diagnostics, {
    ...options,
    verifierLifecycleControls: lifecycleControls
  });
  const analyticsReport = verifierContract.analyticsReport
    || compileVerifierAnalyticsReport({ rules, diagnostics, health }, evaluation, options);
  const reportHistory = verifierContract.reportHistoryManifest
    || compileVerifierReportHistoryManifest({ rules, diagnostics, health, analyticsReport }, evaluation, options);
  const providerService = verifierContract.providerServiceContract
    || compileVerifierProviderServiceContract({
      rules,
      diagnostics,
      health,
      analyticsReport,
      reportHistoryManifest: reportHistory,
      lifecycleControls,
      runtimeHandoff: verifierContract.runtimeHandoff
    }, evaluation, options);
  const findings = evaluation?.findings || [];
  const failedByRule = new Map(findings.map((finding) => [finding.ruleId, finding]));
  const visibleChecks = rules.map((rule, index) => {
    const finding = failedByRule.get(rule.id);
    const passed = evaluation ? !finding : false;
    const pending = !evaluation && rule.severity === "error";

    return {
      order: index + 1,
      ruleId: rule.id,
      label: rule.message,
      path: rule.path,
      severity: rule.severity,
      predicate: rule.predicate,
      status: evaluation
        ? passed ? "passed" : "failed"
        : pending ? "pending-evaluation" : "compiled",
      passed,
      userVisible: true,
      blocksRuntime: rule.severity === "error" && (!evaluation || !passed),
      requiresApprovalToken: rule.predicate === "isTrueWhenWrite",
      nextAction: evaluation
        ? passed
          ? "no-action"
          : rule.severity === "error"
            ? "resolve-blocking-verifier-rule"
            : "surface-verifier-warning"
        : rule.severity === "error"
          ? "evaluate-candidate-before-runtime-handoff"
          : "surface-verifier-warning",
      recovery: rule.recovery
    };
  });
  const blockedChecks = visibleChecks.filter((check) => check.blocksRuntime);
  const warningChecks = visibleChecks.filter((check) => check.severity === "warning");
  const pendingChecks = visibleChecks.filter((check) => check.status === "pending-evaluation");
  const acceptedForRuntime = providerService.acceptedForRuntimeAdapter === true
    && blockedChecks.length === 0
    && lifecycleControls.blocksRuntimeHandoff !== true;
  const acceptedForExternalWrite = acceptedForRuntime
    && visibleChecks
      .filter((check) => check.requiresApprovalToken)
      .every((check) => evaluation ? check.passed : false);
  const status = diagnostics.some((diagnostic) => diagnostic.level === "error")
    ? "blocked"
    : lifecycleControls.blocksRuntimeHandoff
      ? "lifecycle-action-required"
      : pendingChecks.length
        ? "evaluation-required"
        : blockedChecks.length
          ? "blocked"
          : warningChecks.length
            ? "ready-with-review"
            : "ready";
  const snapshotId = stableVerifierSnapshotId({
    reportHistorySnapshotId: reportHistory.snapshotId,
    providerStatus: providerService.status,
    evaluationStatus: evaluation?.status || "not-evaluated",
    checkStatuses: visibleChecks.map((check) => `${check.ruleId}:${check.status}`)
  });
  const requiredClientState = providerService.negotiation?.requiredClientState || [];
  const nextStep = lifecycleControls.blocksRuntimeHandoff
    ? lifecycleControls.nextActions?.[0]?.nextAction || "complete-verifier-lifecycle-action"
    : pendingChecks.length
      ? "evaluate-candidate-before-runtime-handoff"
      : blockedChecks.length
        ? "resolve-blocking-verifier-rule"
        : warningChecks.length
          ? "review-verifier-warnings"
          : "adopt-verifier-acceptance";
  const reviewRows = [
    {
      key: "verifier-checks",
      state: blockedChecks.length
        ? "blocked"
        : pendingChecks.length
          ? "waiting"
          : warningChecks.length
            ? "review"
            : "ready",
      sourceId: snapshotId,
      visibleStatus: blockedChecks.length
        ? "verifier-checks-block-runtime"
        : pendingChecks.length
          ? "verifier-checks-await-evaluation"
          : warningChecks.length
            ? "verifier-checks-review"
            : "verifier-checks-ready",
      nextAction: pendingChecks.length
        ? "evaluate-candidate-before-runtime-handoff"
        : blockedChecks.length
          ? "resolve-blocking-verifier-rule"
          : warningChecks.length
            ? "review-verifier-warnings"
            : "persist-verifier-acceptance",
      blockers: blockedChecks.map((check) => check.ruleId),
      waiting: pendingChecks.map((check) => check.ruleId),
      restartSafe: blockedChecks.length === 0
    },
    {
      key: "provider-readiness",
      state: providerService.providerReadiness?.state === "blocked"
        ? "blocked"
        : providerService.providerReadiness?.state === "waiting"
          ? "waiting"
          : "ready",
      sourceId: providerService.providerReadiness?.id ?? providerService.snapshotId,
      visibleStatus: providerService.providerReadiness?.state
        ? `verifier-provider-${providerService.providerReadiness.state}`
        : providerService.status,
      nextAction: providerService.providerReadiness?.nextAction ?? "persist-verifier-provider-readiness",
      blockers: providerService.providerReadiness?.missingProviderFeatures ?? [],
      waiting: providerService.providerReadiness?.waitingProviderFeatures ?? [],
      restartSafe: providerService.providerReadiness?.restartSemantics?.restartSafe !== false
    },
    {
      key: "required-client-state",
      state: requiredClientState.length > 0 ? "waiting" : "ready",
      sourceId: reportHistory.persistedStateContract?.snapshotKey ?? reportHistory.snapshotId,
      visibleStatus: requiredClientState.length > 0
        ? "verifier-client-state-required"
        : "verifier-client-state-ready",
      nextAction: requiredClientState.length > 0
        ? "persist-verifier-client-state"
        : "continue-verifier-acceptance",
      blockers: [],
      waiting: requiredClientState,
      restartSafe: true
    },
    {
      key: "external-write-approval",
      state: acceptedForExternalWrite || !visibleChecks.some((check) => check.requiresApprovalToken)
        ? "ready"
        : "waiting",
      sourceId: providerService.negotiation?.requiredApprovalPath ?? null,
      visibleStatus: acceptedForExternalWrite
        ? "external-write-approval-ready"
        : "external-write-approval-pending",
      nextAction: visibleChecks.some((check) => check.requiresApprovalToken)
        ? "collect-external-write-approval"
        : "continue-verifier-acceptance",
      blockers: [],
      waiting: acceptedForExternalWrite ? [] : visibleChecks
        .filter((check) => check.requiresApprovalToken)
        .map((check) => check.ruleId),
      restartSafe: true
    }
  ];
  const reviewBlockedRows = reviewRows.filter((row) => row.state === "blocked");
  const reviewWaitingRows = reviewRows.filter((row) => row.state === "waiting");
  const reviewState = reviewBlockedRows.length
    ? "blocked"
    : reviewWaitingRows.length
      ? "waiting"
      : warningChecks.length
        ? "review"
        : "ready";
  const command = {
    id: stableVerifierSnapshotId({
      snapshotId,
      action: "persist-verifier-acceptance-review",
      reviewState
    }),
    type: "persist-verifier-acceptance-review",
    idempotencyKey: stableVerifierSnapshotId({
      namespace: "verifier-acceptance-review",
      snapshotId,
      reviewState
    }),
    statusAfterReplay: reviewState === "ready"
      ? "verifier-acceptance-adopted"
      : `verifier-acceptance-${reviewState}`,
    writes: ["verifierAcceptanceSnapshotId", "visibleChecks", "reviewRows", "nextAction"],
    conflict: "return-existing"
  };
  const recoveryHandoff = {
    id: stableVerifierSnapshotId({
      snapshotId,
      reviewState,
      blockers: reviewBlockedRows.flatMap((row) => row.blockers).join(","),
      waiting: reviewWaitingRows.flatMap((row) => row.waiting).join(",")
    }),
    state: reviewState,
    ready: reviewState === "ready" || reviewState === "review",
    visibleStatus: reviewState === "ready"
      ? "verifier-recovery-ready"
      : reviewState === "review"
        ? "review-verifier-recovery"
        : reviewState === "waiting"
          ? "verifier-recovery-waiting"
          : "verifier-recovery-blocked",
    nextAction: reviewBlockedRows[0]?.nextAction
      ?? reviewWaitingRows[0]?.nextAction
      ?? (warningChecks.length ? "review-verifier-warnings" : "load-verifier-acceptance"),
    resumeCursor: stableVerifierSnapshotId({
      snapshotId,
      commandId: command.id,
      source: "verifier-acceptance-resume"
    }),
    commandIds: [command.id],
    blockedRuleIds: [...new Set([
      ...blockedChecks.map((check) => check.ruleId),
      ...reviewBlockedRows.flatMap((row) => row.blockers)
    ])].sort(),
    missingStateKeys: [...new Set([
      ...requiredClientState,
      ...reviewWaitingRows.flatMap((row) => row.waiting)
    ])].sort(),
    restartSemantics: {
      restartSafe: reviewState !== "blocked",
      onRestart: reviewState === "ready"
        ? "load-verifier-acceptance-review"
        : "rebuild-verifier-acceptance-review",
      onMissingState: reviewState === "blocked"
        ? "block-claim-acceptance"
        : "rebuild-verifier-acceptance-review"
    }
  };

  return {
    kind: "aios.verifierAcceptanceReviewPacket",
    provider: "mailchimp",
    snapshotId,
    status,
    title: verifierContract.preview?.title || "Mailchimp campaign readiness",
    visibleChecks,
    acceptance: {
      acceptedForClientPreview: true,
      acceptedForRuntime,
      acceptedForExternalWrite,
      requiredApprovalPath: providerService.negotiation?.requiredApprovalPath || null,
      requiredClientState,
      nextStep
    },
    readyForClaimGate: reviewState !== "blocked",
    command,
    commandIds: [command.id],
    recoveryHandoff,
    clientPatch: {
      verifierAcceptanceSnapshotId: snapshotId,
      verifierAcceptanceState: status,
      verifierAcceptanceReviewState: reviewState,
      verifierAcceptanceReady: reviewState === "ready" || reviewState === "review",
      verifierAcceptanceVisibleStatus: reviewState === "ready"
        ? "ready-to-adopt-verifier-acceptance"
        : `verifier-acceptance-${reviewState}`,
      verifierAcceptanceNextAction: reviewBlockedRows[0]?.nextAction
        ?? reviewWaitingRows[0]?.nextAction
        ?? nextStep,
      verifierAcceptanceCommandId: command.id,
      verifierRecoveryHandoffId: recoveryHandoff.id,
      verifierRecoveryResumeCursor: recoveryHandoff.resumeCursor,
      verifierBlockedRuleIds: recoveryHandoff.blockedRuleIds,
      verifierMissingStateKeys: recoveryHandoff.missingStateKeys
    },
    validationSummary: {
      totalChecks: visibleChecks.length,
      passedChecks: visibleChecks.filter((check) => check.passed).length,
      pendingChecks: pendingChecks.length,
      blockedChecks: blockedChecks.length,
      warningChecks: warningChecks.length,
      reviewState,
      blockedReviewKeys: reviewBlockedRows.map((row) => row.key),
      waitingReviewKeys: reviewWaitingRows.map((row) => row.key),
      diagnostics: diagnostics.length,
      providerServiceStatus: providerService.status,
      lifecycleStatus: lifecycleControls.status,
      healthStatus: health.healthStatus,
      reportHistoryStatus: reportHistory.status
    },
    exportSummary: {
      reportHistorySnapshotId: reportHistory.snapshotId,
      analyticsSnapshotId: analyticsReport.snapshotId,
      acceptedForRuntime,
      acceptedForExternalWrite,
      blockingRuleIds: blockedChecks.map((check) => check.ruleId),
      warningRuleIds: warningChecks.map((check) => check.ruleId),
      pendingRuleIds: pendingChecks.map((check) => check.ruleId),
      nextActions: visibleChecks
        .filter((check) => check.nextAction !== "no-action")
        .map((check) => ({
          ruleId: check.ruleId,
          path: check.path,
          nextAction: check.nextAction,
          required: check.blocksRuntime
        }))
    },
    reviewRows,
    persistedStateContract: {
      namespace: "verifier.acceptance_review",
      snapshotKey: "verifier.acceptance_review.currentSnapshot",
      statusKey: "verifier.acceptance_review.currentStatus",
      requiredStateKeys: reportHistory.persistedStateContract?.requiredStateKeys || [],
      adoptionEvent: "mailchimp.verifier.acceptance_review.adopted",
      statusEvent: "mailchimp.verifier.acceptance_review.status",
      missingStatePolicy: blockedChecks.length
        ? "block-runtime-until-verifier-acceptance-restored"
        : "rebuild-acceptance-review-from-verifier-report"
    },
    truthBoundary: {
      source: evaluation ? "candidate-evaluation" : "compiled-verifier-rules",
      externalFactsChecked: false,
      deterministic: true
    }
  };
}

export function compileVerifierOperationalIncidentLedger(verifierContract = {}, evaluation = null, options = {}) {
  const rules = verifierContract.rules || [];
  const diagnostics = verifierContract.diagnostics || [];
  const lifecycleControls = verifierContract.lifecycleControls
    || compileVerifierLifecycleControls(rules, options);
  const health = verifierContract.health || compileVerifierHealthContract(rules, diagnostics, {
    ...options,
    verifierLifecycleControls: lifecycleControls
  });
  const providerService = verifierContract.providerServiceContract
    || compileVerifierProviderServiceContract({
      rules,
      diagnostics,
      health,
      lifecycleControls,
      runtimeHandoff: verifierContract.runtimeHandoff,
      analyticsReport: verifierContract.analyticsReport,
      reportHistoryManifest: verifierContract.reportHistoryManifest
    }, evaluation, options);
  const findings = evaluation?.findings || [];
  const failedRuleIds = new Set(findings.map((finding) => finding.ruleId));
  const ruleRows = rules.map((rule, index) => {
    const finding = findings.find((item) => item.ruleId === rule.id);
    const failed = Boolean(finding);
    const pending = !evaluation && rule.severity === "error";
    const state = failed && rule.severity === "error"
      ? "blocked"
      : failed || pending
        ? "review"
        : "ready";
    return {
      sequence: index + 1,
      key: rule.id,
      source: "verifier-rule",
      state,
      severity: rule.severity,
      path: rule.path,
      predicate: rule.predicate,
      message: finding?.message ?? rule.message,
      recovery: rule.recovery,
      nextAction: state === "blocked"
        ? "resolve-blocking-verifier-rule"
        : state === "review"
          ? pending ? "evaluate-candidate-before-runtime-handoff" : "review-verifier-warning"
          : "no-action",
      restartSafe: state !== "blocked" || rule.recovery === "block-runtime-handoff",
      relatedRuleIds: [rule.id]
    };
  });
  const diagnosticRows = diagnostics.map((diagnostic, index) => ({
    sequence: ruleRows.length + index + 1,
    key: diagnostic.code ?? `diagnostic-${index + 1}`,
    source: "verifier-diagnostic",
    state: diagnostic.level === "error" ? "blocked" : "review",
    severity: diagnostic.level === "error" ? "error" : "warning",
    path: diagnostic.path ?? null,
    predicate: null,
    message: diagnostic.message,
    recovery: diagnostic.nextAction ?? "fix-verifier-rule",
    nextAction: diagnostic.nextAction ?? "fix-verifier-rule",
    restartSafe: diagnostic.level !== "error",
    relatedRuleIds: [diagnostic.rule, diagnostic.ruleId].filter(Boolean)
  }));
  const lifecycleRows = (lifecycleControls.nextActions || [])
    .filter((action) => action.required || lifecycleControls.blocksRuntimeHandoff)
    .map((action, index) => ({
      sequence: ruleRows.length + diagnosticRows.length + index + 1,
      key: action.command,
      source: "verifier-lifecycle",
      state: action.required || lifecycleControls.blocksRuntimeHandoff ? "blocked" : "review",
      severity: action.required || lifecycleControls.blocksRuntimeHandoff ? "error" : "warning",
      path: null,
      predicate: null,
      message: `Verifier lifecycle requires ${action.nextAction}.`,
      recovery: action.nextAction,
      nextAction: action.nextAction,
      restartSafe: lifecycleControls.status !== "invalid",
      relatedRuleIds: []
    }));
  const rows = [...ruleRows, ...diagnosticRows, ...lifecycleRows];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const reviewRows = rows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0
    ? "blocked"
    : reviewRows.length > 0 || health.healthStatus === "degraded"
      ? "review"
      : "ready";
  const ledgerId = stableVerifierSnapshotId({
    type: "verifier-operational-incident-ledger",
    healthStatus: health.healthStatus,
    providerStatus: providerService.status,
    evaluationStatus: evaluation?.status || "not-evaluated",
    rows: rows.map((row) => `${row.source}:${row.key}:${row.state}:${row.nextAction}`)
  });
  const retryableRows = rows.filter((row) => row.state !== "ready" && row.restartSafe);

  return {
    kind: "aios.verifierOperationalIncidentLedger",
    provider: "mailchimp",
    id: ledgerId,
    status: state,
    healthStatus: health.healthStatus,
    providerServiceStatus: providerService.status,
    exportReady: state !== "blocked",
    rows,
    actionableErrors: rows
      .filter((row) => row.state !== "ready")
      .map((row) => ({
        code: `${row.source}.${row.key}.${row.state}`,
        severity: row.severity,
        message: row.message,
        nextAction: row.nextAction,
        path: row.path,
        ruleIds: row.relatedRuleIds
      })),
    counters: {
      rows: rows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      diagnostics: diagnostics.length,
      findings: findings.length,
      failedRules: failedRuleIds.size,
      lifecycleActions: lifecycleRows.length,
      retryableIncidents: retryableRows.length
    },
    retryPolicy: {
      retryable: blockedRows.length === 0 || retryableRows.length === rows.filter((row) => row.state !== "ready").length,
      maxAttempts: health.retryPolicy?.maxAttempts ?? 3,
      backoffScheduleSeconds: health.retryPolicy?.backoffScheduleSeconds ?? [2, 4, 8],
      stopWhen: state === "blocked" ? "blocking-verifier-incidents-resolved" : "incident-ledger-exported"
    },
    statusHandoff: {
      runtimeStatus: state === "ready"
        ? "ready-for-runtime-adapter"
        : state === "review"
          ? "ready-with-operational-review"
          : "blocked-before-mailchimp-handoff",
      nextAction: blockedRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? providerService.operatorActions?.[0]?.nextAction
        ?? "persist-verifier-incident-ledger",
      blockedRuleIds: blockedRows.flatMap((row) => row.relatedRuleIds),
      reviewRuleIds: reviewRows.flatMap((row) => row.relatedRuleIds)
    },
    persistedStateContract: {
      namespace: "verifier.operational_incidents",
      ledgerKey: `verifier.operational_incidents.${ledgerId}`,
      statusKey: "verifier.operational_incidents.currentStatus",
      adoptionEvent: "mailchimp.verifier.operational_incidents.adopted",
      missingStatePolicy: state === "blocked"
        ? "block-runtime-until-incident-ledger-restored"
        : "rebuild-incident-ledger-from-verifier-contract"
    },
    truthBoundary: {
      source: evaluation ? "candidate-evaluation" : "compiled-verifier-contract",
      externalFactsChecked: false,
      deterministic: true
    }
  };
}

function buildAcceptanceContract(rules, options) {
  const errorRules = rules.filter((rule) => rule.severity === "error");
  const warningRules = rules.filter((rule) => rule.severity === "warning");
  const requiresExternalWriteApproval = rules.some((rule) => rule.predicate === "isTrueWhenWrite");

  return {
    provider: "mailchimp",
    requiredStatus: warningRules.length ? "warning-or-pass" : "pass",
    requiresApprovalToken: options.requireApprovalToken !== false,
    requiresExternalWriteApproval,
    acceptanceCriteria: [
      ...errorRules.map((rule) => ({
        ruleId: rule.id,
        path: rule.path,
        required: true,
        userVisible: true,
        message: rule.message
      })),
      ...warningRules.map((rule) => ({
        ruleId: rule.id,
        path: rule.path,
        required: false,
        userVisible: true,
        message: rule.message
      }))
    ]
  };
}

function buildRuntimeHandoffContract(rules, options, lifecycleControls = null) {
  const requiredClientState = Array.from(new Set(rules.map((rule) => rule.path.split(".")[0]))).sort();
  const externalWriteRule = rules.find((rule) => rule.predicate === "isTrueWhenWrite");
  const blockingRules = rules.filter((rule) => rule.severity === "error");
  const warningRules = rules.filter((rule) => rule.severity === "warning");
  const lifecycleBlocks = lifecycleControls?.blocksRuntimeHandoff === true;

  return {
    provider: "mailchimp",
    runtimeAdapter: options.runtimeAdapter || "mailchimp.campaignRuntimeAdapter",
    handoffStatus: lifecycleControls?.status === "invalid"
      ? "invalid-lifecycle-controls"
      : lifecycleBlocks
        ? "lifecycle-action-required"
        : blockingRules.length
          ? "requires-local-evaluation"
          : "ready",
    requiredClientState,
    requiredApprovalState: externalWriteRule
      ? {
        path: externalWriteRule.path,
        tokenRequired: options.requireApprovalToken !== false,
        acceptedValue: true,
        missingStateNextAction: "collect-external-write-approval"
      }
      : null,
    clientEvents: [
      {
        event: "mailchimp.verifier.preview.rendered",
        when: "before-runtime-handoff",
        payloadShape: {
          visibleChecks: "array",
          validationSummary: "object",
          acceptanceCriteria: "array"
        }
      },
      {
        event: "mailchimp.verifier.accepted",
        when: "after-local-evaluation",
        payloadShape: {
          status: "pass|warning",
          approvalTokenAccepted: "boolean",
          warningRuleIds: "array"
        }
      }
    ],
    lifecycleControls: lifecycleControls
      ? {
        status: lifecycleControls.status,
        enabled: lifecycleControls.enabled,
        mode: lifecycleControls.mode,
        schedule: lifecycleControls.schedule,
        canEvaluateAutomatically: lifecycleControls.canEvaluateAutomatically,
        blocksRuntimeHandoff: lifecycleControls.blocksRuntimeHandoff,
        settings: lifecycleControls.settings,
        commands: lifecycleControls.commands
      }
      : null,
    nextActions: [
      ...(lifecycleControls?.nextActions || []).map((item) => ({
        ruleId: item.command,
        path: "verifier.lifecycle",
        nextAction: item.nextAction,
        failureState: lifecycleControls.blocksRuntimeHandoff ? "verifier-lifecycle-incomplete" : "verifier-lifecycle-action",
        required: item.required
      })),
      ...blockingRules.map((rule) => ({
        ruleId: rule.id,
        path: rule.path,
        nextAction: "collect-required-client-state",
        failureState: "client-state-incomplete",
        required: true
      })),
      ...warningRules.map((rule) => ({
        ruleId: rule.id,
        path: rule.path,
        nextAction: "show-operator-warning",
        failureState: "operator-warning-review",
        required: false
      }))
    ]
  };
}

function compileRuleRecoveryStep(rule) {
  const isBlocking = rule.severity === "error";
  const isApprovalRule = rule.predicate === "isTrueWhenWrite";

  return {
    ruleId: rule.id,
    path: rule.path,
    severity: rule.severity,
    predicate: rule.predicate,
    failureStatus: isBlocking ? "verifier-blocked-runtime-handoff" : "verifier-warning-needs-review",
    clientRecovery: {
      requiredClientState: rule.path.split(".")[0],
      nextAction: isApprovalRule
        ? "collect-external-write-approval"
        : isBlocking
          ? "hydrate-required-client-state"
          : "show-operator-warning",
      userVisible: true,
      canDismiss: !isBlocking
    },
    adapterRecovery: {
      canRetryWithoutStateChange: false,
      blocksExternalWrite: isBlocking || isApprovalRule,
      statusAfterFailure: isApprovalRule
        ? "approval-missing"
        : isBlocking
          ? "client-state-incomplete"
          : "ready-with-warning",
      recoveryEvent: isApprovalRule
        ? "mailchimp.verifier.approval.required"
        : isBlocking
          ? "mailchimp.verifier.client_state.required"
          : "mailchimp.verifier.warning.visible"
    }
  };
}

export function compileVerifierRecoveryPlan(verifierContract = {}) {
  const rules = verifierContract.rules || [];
  const health = verifierContract.health || compileVerifierHealthContract(rules, verifierContract.diagnostics || {});
  const recoverySteps = rules.map(compileRuleRecoveryStep);
  const blockingSteps = recoverySteps.filter((step) => step.severity === "error");
  const approvalSteps = recoverySteps.filter((step) => step.predicate === "isTrueWhenWrite");
  const warningSteps = recoverySteps.filter((step) => step.severity === "warning");

  return {
    kind: "aios.verifierRecoveryPlan",
    provider: "mailchimp",
    statusAfterFailure: blockingSteps.length
      ? "blocked-before-runtime-handoff"
      : warningSteps.length
        ? "ready-with-warning-review"
        : "ready",
    adapterRecoveryStatus: {
      onMissingClientState: blockingSteps.length ? "hydrate-client-state-before-handoff" : "not-required",
      onApprovalMissing: approvalSteps.length ? "collect-approval-before-external-write" : "not-required",
      onWarningOnly: warningSteps.length ? "continue-after-operator-review" : "not-required",
      onVerifierDegraded: health.healthStatus === "degraded" || health.healthStatus === "unhealthy"
        ? health.degradedMode
        : "not-required"
    },
    health,
    retryPolicy: health.retryPolicy,
    clientStateRecovery: Array.from(new Set(recoverySteps.map((step) => step.clientRecovery.requiredClientState))).sort()
      .map((stateKey) => ({
        stateKey,
        sourceRules: recoverySteps
          .filter((step) => step.clientRecovery.requiredClientState === stateKey)
          .map((step) => step.ruleId),
        nextAction: "hydrate-client-state"
      })),
    blockingRuleIds: blockingSteps.map((step) => step.ruleId),
    approvalRuleIds: approvalSteps.map((step) => step.ruleId),
    warningRuleIds: warningSteps.map((step) => step.ruleId),
    rules: recoverySteps,
    truthBoundary: {
      source: "compiled-verifier-rules",
      evaluatedAgainstCandidate: false,
      deterministic: true
    }
  };
}

export function compileVerifierRecoveryHandoff(verifierContract = {}, evaluation = null, options = {}) {
  const rules = verifierContract.rules || [];
  const diagnostics = verifierContract.diagnostics || [];
  const lifecycleControls = verifierContract.lifecycleControls
    || compileVerifierLifecycleControls(rules, options);
  const health = verifierContract.health || compileVerifierHealthContract(rules, diagnostics, {
    ...options,
    verifierLifecycleControls: lifecycleControls
  });
  const recoveryPlan = verifierContract.recoveryPlan
    || compileVerifierRecoveryPlan({ rules, diagnostics, health });
  const runtimeHandoff = verifierContract.runtimeHandoff
    || buildRuntimeHandoffContract(rules, options, lifecycleControls);
  const acceptanceReview = verifierContract.acceptanceReviewPacket
    || compileVerifierAcceptanceReviewPacket({
      rules,
      diagnostics,
      health,
      recoveryPlan,
      lifecycleControls,
      runtimeHandoff,
      preview: verifierContract.preview
    }, evaluation, options);
  const findings = evaluation?.findings || [];
  const failedRuleIds = new Set(findings.map((finding) => finding.ruleId));
  const requiredStateKeys = [...new Set([
    ...(runtimeHandoff.requiredClientState || []),
    ...(acceptanceReview.acceptance?.requiredClientState || []),
    ...(recoveryPlan.clientStateRecovery || []).map((entry) => entry.stateKey)
  ])].sort();
  const missingStateKeys = evaluation
    ? requiredStateKeys.filter((stateKey) => readPath(options.candidate ?? {}, stateKey) == null)
    : requiredStateKeys;
  const recoveryRows = rules.map((rule, index) => {
    const failed = failedRuleIds.has(rule.id);
    const pending = !evaluation && rule.severity === "error";
    const state = failed && rule.severity === "error"
      ? "blocked"
      : pending
        ? "waiting"
        : failed || rule.severity === "warning"
          ? "review"
          : "ready";
    const stateKey = rule.path.split(".")[0];
    return {
      sequence: index + 1,
      ruleId: rule.id,
      path: rule.path,
      stateKey,
      state,
      visibleStatus: state === "ready"
        ? "verifier-rule-ready"
        : state === "waiting"
          ? "verifier-rule-awaiting-evaluation"
          : state === "review"
            ? "review-verifier-rule"
            : "verifier-rule-blocked",
      nextAction: state === "ready"
        ? "return-existing-verifier-state"
        : rule.predicate === "isTrueWhenWrite"
          ? "collect-external-write-approval"
          : state === "waiting"
            ? "evaluate-candidate-before-runtime-handoff"
            : rule.severity === "warning"
              ? "review-verifier-warning"
              : "hydrate-required-client-state",
      restartSafe: state !== "blocked" || pending,
      idempotencyKey: stableVerifierSnapshotId({
        ruleId: rule.id,
        path: rule.path,
        state,
        evaluationStatus: evaluation?.status || "not-evaluated"
      }),
      recovery: rule.recovery
    };
  });
  const blockedRows = recoveryRows.filter((row) => row.state === "blocked");
  const waitingRows = recoveryRows.filter((row) => row.state === "waiting");
  const reviewRows = recoveryRows.filter((row) => row.state === "review");
  const state = lifecycleControls.blocksRuntimeHandoff || blockedRows.length > 0 || missingStateKeys.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : reviewRows.length > 0
        ? "review"
        : "ready";
  const handoffId = stableVerifierSnapshotId({
    kind: "recovery-handoff",
    acceptanceSnapshotId: acceptanceReview.snapshotId,
    runtimeStatus: runtimeHandoff.handoffStatus,
    state,
    rows: recoveryRows.map((row) => `${row.ruleId}:${row.state}:${row.idempotencyKey}`)
  });
  const commands = [
    {
      id: stableVerifierSnapshotId({ handoffId, command: "persist-verifier-recovery-handoff" }),
      type: "persist-verifier-recovery-handoff",
      idempotencyKey: stableVerifierSnapshotId({ handoffId, idem: "persist-verifier-recovery-handoff" }),
      statusAfterReplay: state,
      writes: ["verifierRecoveryHandoffId", "recoveryRows", "resumeCursor", "visibleStatus"],
      conflict: "return-existing"
    },
    ...(state === "blocked" ? [{
      id: stableVerifierSnapshotId({ handoffId, command: "hold-runtime-handoff", blocked: blockedRows.map((row) => row.ruleId) }),
      type: "hold-runtime-handoff",
      idempotencyKey: stableVerifierSnapshotId({ handoffId, idem: "hold-runtime-handoff" }),
      statusAfterReplay: "blocked",
      writes: ["blockedRuleIds", "missingStateKeys", "nextAction"],
      conflict: "return-existing"
    }] : []),
    ...(state === "ready" ? [{
      id: stableVerifierSnapshotId({ handoffId, command: "adopt-verifier-runtime-state" }),
      type: "adopt-verifier-runtime-state",
      idempotencyKey: stableVerifierSnapshotId({ handoffId, idem: "adopt-verifier-runtime-state" }),
      statusAfterReplay: "ready-for-runtime-adapter",
      writes: ["acceptedForRuntime", "acceptedForExternalWrite", "runtimeHandoffStatus"],
      conflict: "return-existing"
    }] : [])
  ];

  return {
    kind: "aios.verifierRecoveryHandoff",
    provider: "mailchimp",
    id: handoffId,
    state,
    ready: state === "ready" || state === "review",
    visibleStatus: state === "ready"
      ? "verifier-recovery-ready"
      : state === "waiting"
        ? "verifier-recovery-waiting"
        : state === "review"
          ? "review-verifier-recovery"
          : "verifier-recovery-blocked",
    nextAction: lifecycleControls.blocksRuntimeHandoff
      ? lifecycleControls.nextActions?.[0]?.nextAction || "complete-verifier-lifecycle-action"
      : blockedRows[0]?.nextAction
        ?? (missingStateKeys.length ? "hydrate-client-state" : null)
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "adopt-verifier-runtime-state",
    acceptanceReviewId: acceptanceReview.snapshotId,
    runtimeHandoffStatus: runtimeHandoff.handoffStatus,
    resumeCursor: stableVerifierSnapshotId({
      handoffId,
      status: state,
      requiredStateKeys,
      acceptanceSnapshotId: acceptanceReview.snapshotId
    }),
    requiredStateKeys,
    missingStateKeys,
    blockedRuleIds: blockedRows.map((row) => row.ruleId),
    waitingRuleIds: waitingRows.map((row) => row.ruleId),
    reviewRuleIds: reviewRows.map((row) => row.ruleId),
    rows: recoveryRows,
    commands,
    restartSemantics: {
      restartSafe: state !== "blocked" && recoveryRows.every((row) => row.restartSafe),
      onRestart: state === "ready" ? "load-verifier-recovery-handoff" : "rebuild-verifier-recovery-handoff",
      onDuplicateCommand: "return-existing-verifier-recovery-command",
      onMissingState: "block-runtime-until-verifier-state-restored",
      duplicateAdapterCommandPolicy: "return-existing"
    },
    clientPatch: {
      verifierRecoveryHandoffId: handoffId,
      verifierRecoveryState: state,
      verifierRecoveryReady: state === "ready" || state === "review",
      verifierRecoveryVisibleStatus: state === "ready"
        ? "verifier-recovery-ready"
        : state === "waiting"
          ? "verifier-recovery-waiting"
          : state === "review"
            ? "review-verifier-recovery"
            : "verifier-recovery-blocked",
      verifierRecoveryNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "adopt-verifier-runtime-state",
      verifierRecoveryResumeCursor: stableVerifierSnapshotId({ handoffId, cursor: "client" }),
      verifierRecoveryBlockedRuleIds: blockedRows.map((row) => row.ruleId),
      verifierRecoveryMissingStateKeys: missingStateKeys
    },
    truthBoundary: {
      source: evaluation ? "candidate-evaluation" : "compiled-verifier-contract",
      externalFactsChecked: false,
      deterministic: true
    }
  };
}

export function compileVerifierRecoveryExportLedger(verifierContract = {}, evaluation = null, options = {}) {
  const recoveryHandoff = verifierContract.recoveryHandoff
    || compileVerifierRecoveryHandoff(verifierContract, evaluation, options);
  const acceptanceReview = verifierContract.acceptanceReviewPacket
    || compileVerifierAcceptanceReviewPacket(verifierContract, evaluation, options);
  const reportHistory = verifierContract.reportHistoryManifest
    || compileVerifierReportHistoryManifest(verifierContract, evaluation, options);
  const operationalIncidentLedger = verifierContract.operationalIncidentLedger
    || compileVerifierOperationalIncidentLedger(verifierContract, evaluation, options);
  const requiredStateKeys = [...new Set([
    ...(recoveryHandoff.requiredStateKeys || []),
    ...(reportHistory.persistedStateContract?.requiredStateKeys || []),
    acceptanceReview.persistedStateContract?.snapshotKey,
    acceptanceReview.persistedStateContract?.statusKey,
    operationalIncidentLedger.persistedStateContract?.ledgerKey,
  ].filter(Boolean))].sort();
  const missingStateKeys = [...new Set([
    ...(recoveryHandoff.missingStateKeys || []),
    ...(acceptanceReview.recoveryHandoff?.missingStateKeys || []),
  ].filter(Boolean))].sort();
  const rowInputs = [
    {
      key: "recovery-handoff",
      state: recoveryHandoff.state === "blocked"
        ? "blocked"
        : recoveryHandoff.state === "waiting"
          ? "waiting"
          : recoveryHandoff.state === "review"
            ? "review"
            : "ready",
      sourceId: recoveryHandoff.id,
      visibleStatus: recoveryHandoff.visibleStatus,
      nextAction: recoveryHandoff.nextAction,
      commandIds: recoveryHandoff.commands?.map((command) => command.id) ?? [],
      blockers: recoveryHandoff.blockedRuleIds ?? [],
      waiting: [
        ...(recoveryHandoff.waitingRuleIds ?? []),
        ...missingStateKeys,
      ],
      restartSafe: recoveryHandoff.restartSemantics?.restartSafe !== false,
    },
    {
      key: "acceptance-review",
      state: acceptanceReview.readyForClaimGate === false || acceptanceReview.status === "blocked"
        ? "blocked"
        : acceptanceReview.status === "evaluation-required" || acceptanceReview.status === "lifecycle-action-required"
          ? "waiting"
          : acceptanceReview.status === "ready-with-review"
            ? "review"
            : "ready",
      sourceId: acceptanceReview.snapshotId,
      visibleStatus: acceptanceReview.clientPatch?.verifierAcceptanceVisibleStatus ?? acceptanceReview.status,
      nextAction: acceptanceReview.acceptance?.nextStep ?? acceptanceReview.clientPatch?.verifierAcceptanceNextAction,
      commandIds: acceptanceReview.commandIds ?? [acceptanceReview.command?.id].filter(Boolean),
      blockers: [
        ...(acceptanceReview.exportSummary?.blockingRuleIds ?? []),
        ...(acceptanceReview.validationSummary?.blockedReviewKeys ?? []),
      ],
      waiting: [
        ...(acceptanceReview.exportSummary?.pendingRuleIds ?? []),
        ...(acceptanceReview.validationSummary?.waitingReviewKeys ?? []),
      ],
      restartSafe: acceptanceReview.restartSemantics?.restartSafe !== false,
    },
    {
      key: "report-history",
      state: reportHistory.exportReady
        ? "ready"
        : reportHistory.status === "awaiting-evaluation"
          ? "waiting"
          : reportHistory.status === "operator-review-required"
            ? "review"
            : "blocked",
      sourceId: reportHistory.snapshotId,
      visibleStatus: reportHistory.status,
      nextAction: reportHistory.reportSummary?.nextActions?.[0]?.nextAction
        ?? (reportHistory.exportReady ? "adopt-verifier-report-history" : "evaluate-candidate-before-runtime-handoff"),
      commandIds: [],
      blockers: reportHistory.reportSummary?.blockingRuleIds ?? [],
      waiting: reportHistory.reportSummary?.pendingBlockingRuleIds ?? [],
      restartSafe: reportHistory.restartSemantics?.missingStatePolicy !== "block-until-verifier-history-state-restored",
    },
    {
      key: "operational-incident-ledger",
      state: operationalIncidentLedger.status === "blocked"
        ? "blocked"
        : operationalIncidentLedger.status === "review"
          ? "review"
          : "ready",
      sourceId: operationalIncidentLedger.id,
      visibleStatus: operationalIncidentLedger.statusHandoff?.runtimeStatus ?? operationalIncidentLedger.status,
      nextAction: operationalIncidentLedger.statusHandoff?.nextAction ?? "persist-verifier-incident-ledger",
      commandIds: [],
      blockers: operationalIncidentLedger.statusHandoff?.blockedRuleIds ?? [],
      waiting: operationalIncidentLedger.statusHandoff?.reviewRuleIds ?? [],
      restartSafe: operationalIncidentLedger.persistedStateContract?.missingStatePolicy !== "block-runtime-until-incident-ledger-restored",
    },
  ];
  const rows = rowInputs.map((row, index) => ({
    sequence: index + 1,
    rowId: stableVerifierSnapshotId({
      source: "verifier-recovery-export-row",
      key: row.key,
      state: row.state,
      sourceId: row.sourceId,
    }),
    ...row,
  }));
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const reviewRows = rows.filter((row) => row.state === "review");
  const state = blockedRows.length
    ? "blocked"
    : waitingRows.length
      ? "waiting"
      : reviewRows.length
        ? "review"
        : "ready";
  const ledgerId = stableVerifierSnapshotId({
    type: "verifier-recovery-export-ledger",
    recoveryHandoffId: recoveryHandoff.id,
    acceptanceSnapshotId: acceptanceReview.snapshotId,
    reportHistorySnapshotId: reportHistory.snapshotId,
    incidentLedgerId: operationalIncidentLedger.id,
    state,
    rows: rows.map((row) => `${row.key}:${row.state}:${row.sourceId}`),
  });
  const commandScope = {
    ledgerId,
    state,
    resumeCursor: recoveryHandoff.resumeCursor,
    requiredStateKeys,
  };
  const commands = [
    {
      id: stableVerifierSnapshotId({ ...commandScope, command: "persist-verifier-recovery-export-ledger" }),
      type: "persist-verifier-recovery-export-ledger",
      idempotencyKey: stableVerifierSnapshotId({ ...commandScope, idem: "persist-verifier-recovery-export-ledger" }),
      statusAfterReplay: state,
      writes: ["verifierRecoveryExportLedgerId", "rows", "resumeCursor", "requiredStateKeys"],
      conflict: "return-existing",
    },
    ...(blockedRows.length ? [{
      id: stableVerifierSnapshotId({ ...commandScope, command: "hold-verifier-recovery-export" }),
      type: "hold-verifier-recovery-export",
      idempotencyKey: stableVerifierSnapshotId({
        ...commandScope,
        idem: "hold-verifier-recovery-export",
        blockers: blockedRows.map((row) => row.rowId),
      }),
      statusAfterReplay: "blocked",
      writes: ["blockedRows", "missingStateKeys", "nextAction"],
      conflict: "return-existing",
    }] : []),
    ...(!blockedRows.length ? [{
      id: stableVerifierSnapshotId({ ...commandScope, command: "publish-verifier-recovery-export" }),
      type: "publish-verifier-recovery-export",
      idempotencyKey: stableVerifierSnapshotId({ ...commandScope, idem: "publish-verifier-recovery-export" }),
      statusAfterReplay: state === "ready" ? "verifier-recovery-export-ready" : `verifier-recovery-export-${state}`,
      writes: ["claimGateRecoveryPacket", "clientPatch", "resumeCursors", "commandIds"],
      conflict: "return-existing",
    }] : []),
  ];
  const replayCursor = stableVerifierSnapshotId({
    ledgerId,
    recoveryCursor: recoveryHandoff.resumeCursor,
    commandIds: commands.map((command) => command.id),
  });

  return {
    kind: "aios.verifierRecoveryExportLedger",
    provider: "mailchimp",
    id: ledgerId,
    protocol: "aios.mailchimp.verifier-recovery-export-ledger.v1",
    state,
    ready: state === "ready" || state === "review",
    visibleStatus: state === "ready" ? "verifier-recovery-export-ready" : `verifier-recovery-export-${state}`,
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? "publish-verifier-recovery-export",
    sourceIds: {
      recoveryHandoffId: recoveryHandoff.id,
      acceptanceReviewId: acceptanceReview.snapshotId,
      reportHistorySnapshotId: reportHistory.snapshotId,
      operationalIncidentLedgerId: operationalIncidentLedger.id,
    },
    resumeCursor: recoveryHandoff.resumeCursor,
    replayCursor,
    requiredStateKeys,
    missingStateKeys,
    rows,
    commands,
    commandIds: commands.map((command) => command.id),
    blockedKeys: blockedRows.map((row) => row.key),
    waitingKeys: waitingRows.map((row) => row.key),
    reviewKeys: reviewRows.map((row) => row.key),
    claimGatePacket: {
      verifierRecoveryExportLedgerId: ledgerId,
      verifierRecoveryExportState: state,
      verifierRecoveryExportReady: state === "ready" || state === "review",
      verifierRecoveryExportResumeCursor: recoveryHandoff.resumeCursor,
      verifierRecoveryExportReplayCursor: replayCursor,
      verifierRecoveryExportCommandIds: commands.map((command) => command.id),
      verifierRecoveryExportBlockedKeys: blockedRows.map((row) => row.key),
      verifierRecoveryExportWaitingKeys: waitingRows.map((row) => row.key),
      verifierRecoveryExportNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "publish-verifier-recovery-export",
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe !== false),
      onRestart: state === "ready" ? "load-verifier-recovery-export-ledger" : "rebuild-verifier-recovery-export-ledger",
      onDuplicateCommand: "return-existing-verifier-recovery-export-ledger",
      onMissingState: missingStateKeys.length ? "hydrate-verifier-client-state-before-claim-gate" : "rebuild-verifier-recovery-export-ledger",
      duplicateAdapterCommandPolicy: "return-existing",
      externalWritesPerformed: false,
    },
    persistedStateContract: {
      namespace: "verifier.recovery_export",
      ledgerKey: `verifier.recovery_export.${ledgerId}`,
      statusKey: "verifier.recovery_export.currentStatus",
      requiredStateKeys,
      adoptionEvent: "mailchimp.verifier.recovery_export.adopted",
      statusEvent: "mailchimp.verifier.recovery_export.status",
      missingStatePolicy: state === "blocked"
        ? "block-claim-gate-until-verifier-recovery-export-restored"
        : "rebuild-verifier-recovery-export-from-compiled-contract",
    },
    truthBoundary: {
      source: evaluation ? "candidate-evaluation" : "compiled-verifier-contract",
      externalFactsChecked: false,
      deterministic: true,
    },
  };
}

export function parseVerifierSource(source = {}) {
  if (Array.isArray(source)) return source;
  if (typeof source === "string") {
    return source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, path, predicate = "truthy"] = line.split(/\s*:\s*/);
        return { id, path, predicate, severity: "error", message: `${id} failed.` };
      });
  }
  return source.rules || DEFAULT_VERIFIER_RULES;
}

export function compileMailchimpVerifier(source = {}, options = {}) {
  const rules = parseVerifierSource(source);
  const diagnostics = [];
  const compiledRules = [];

  for (const rule of rules) {
    if (!rule.id || !rule.path || !rule.predicate) {
      diagnostics.push({
        level: "error",
        code: "verifier.rule.invalid",
        message: "Verifier rules require id, path, and predicate."
      });
      continue;
    }

    if (!["nonEmptyString", "truthy", "isTrueWhenWrite"].includes(rule.predicate)) {
      diagnostics.push({
        level: "error",
        code: "verifier.predicate.unsupported",
        message: `Unsupported verifier predicate: ${rule.predicate}`,
        rule: rule.id
      });
      continue;
    }

    compiledRules.push({
      id: rule.id,
      provider: "mailchimp",
      severity: rule.severity || "error",
      path: rule.path,
      predicate: rule.predicate,
      message: rule.message || `${rule.id} failed.`,
      recovery: rule.recovery || "block-runtime-handoff"
    });
  }

  const lifecycleControls = compileVerifierLifecycleControls(compiledRules, options);
  const runtimeReleaseGate = compileVerifierRuntimeReleaseGate(compiledRules, lifecycleControls, options);
  diagnostics.push(...lifecycleControls.diagnostics);
  const previewSummary = summarizeRulesForPreview(compiledRules);
  const health = compileVerifierHealthContract(compiledRules, diagnostics, {
    ...options,
    verifierLifecycleControls: lifecycleControls
  });
  const recoveryPlan = compileVerifierRecoveryPlan({ rules: compiledRules, diagnostics, health });
  const analyticsReport = compileVerifierAnalyticsReport({ rules: compiledRules, diagnostics, health }, null, options);
  const reportHistoryManifest = compileVerifierReportHistoryManifest({
    rules: compiledRules,
    diagnostics,
    health,
    analyticsReport
  }, null, options);
  const providerServiceContract = compileVerifierProviderServiceContract({
    rules: compiledRules,
    diagnostics,
    health,
    analyticsReport,
    reportHistoryManifest,
    lifecycleControls
  }, null, options);
  const providerCallbackContract = compileVerifierProviderCallbackContract({
    rules: compiledRules,
    diagnostics,
    health,
    lifecycleControls,
    providerServiceContract
  }, options);
  const acceptanceReviewPacket = compileVerifierAcceptanceReviewPacket({
    rules: compiledRules,
    diagnostics,
    health,
    analyticsReport,
    reportHistoryManifest,
    lifecycleControls,
    providerServiceContract,
    providerCallbackContract,
    runtimeHandoff: buildRuntimeHandoffContract(compiledRules, options, lifecycleControls),
    preview: {
      title: "Mailchimp campaign readiness"
    }
  }, null, options);
  const recoveryHandoff = compileVerifierRecoveryHandoff({
    rules: compiledRules,
    diagnostics,
    health,
    recoveryPlan,
    analyticsReport,
    reportHistoryManifest,
    lifecycleControls,
    providerServiceContract,
    providerCallbackContract,
    acceptanceReviewPacket,
    runtimeHandoff: buildRuntimeHandoffContract(compiledRules, options, lifecycleControls),
    preview: {
      title: "Mailchimp campaign readiness"
    }
  }, null, options);
  const operationalIncidentLedger = compileVerifierOperationalIncidentLedger({
    rules: compiledRules,
    diagnostics,
    health,
    analyticsReport,
    reportHistoryManifest,
    lifecycleControls,
    providerServiceContract,
    providerCallbackContract,
    acceptanceReviewPacket,
    recoveryHandoff,
    runtimeHandoff: buildRuntimeHandoffContract(compiledRules, options, lifecycleControls)
  }, null, options);
  const recoveryExportLedger = compileVerifierRecoveryExportLedger({
    rules: compiledRules,
    diagnostics,
    health,
    analyticsReport,
    reportHistoryManifest,
    lifecycleControls,
    providerServiceContract,
    providerCallbackContract,
    acceptanceReviewPacket,
    recoveryHandoff,
    operationalIncidentLedger,
    runtimeHandoff: buildRuntimeHandoffContract(compiledRules, options, lifecycleControls)
  }, null, options);

  return {
    kind: "aios.verifierContract",
    provider: "mailchimp",
    rules: compiledRules,
    preview: {
      title: "Mailchimp campaign readiness",
      summary: previewSummary,
      health,
      lifecycleControls,
      runtimeReleaseGate,
      visibleChecks: compiledRules.map((rule) => ({
        id: rule.id,
        severity: rule.severity,
        label: rule.message,
        path: rule.path,
        recovery: rule.recovery
      }))
    },
    acceptance: buildAcceptanceContract(compiledRules, options),
    runtimeHandoff: buildRuntimeHandoffContract(compiledRules, options, lifecycleControls),
    lifecycleControls,
    runtimeReleaseGate,
    recoveryPlan,
    health,
    analyticsReport,
    reportHistoryManifest,
    providerServiceContract,
    providerCallbackContract,
    acceptanceReviewPacket,
    recoveryHandoff,
    recoveryExportLedger,
    operationalIncidentLedger,
    diagnostics,
    statusSemantics: {
      pass: "ready-for-runtime-adapter",
      warning: "ready-with-operator-visible-warning",
      error: "blocked-before-mailchimp-handoff"
    },
    truthBoundary: {
      source: "compiled-rules",
      verifiedBy: "verifier-compiler",
      evaluation: "deterministic-local"
    },
    requireApprovalToken: options.requireApprovalToken !== false
  };
}

export function evaluateMailchimpVerifier(verifierContract, candidate = {}, context = {}) {
  const findings = [];
  const health = verifierContract?.health || compileVerifierHealthContract(verifierContract?.rules || []);
  for (const rule of verifierContract?.rules || []) {
    const value = readPath(candidate, rule.path);
    const passed = evaluatePredicate(rule.predicate, value, context);
    if (!passed) {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        path: rule.path,
        message: rule.message,
        recovery: rule.recovery
      });
    }
  }

  const hasError = findings.some((finding) => finding.severity === "error");
  const hasWarning = findings.some((finding) => finding.severity === "warning");
  const status = hasError ? "error" : hasWarning ? "warning" : "pass";
  const lifecycleControls = verifierContract?.lifecycleControls
    || compileVerifierLifecycleControls(verifierContract?.rules || [], context);
  const allChecks = (verifierContract?.rules || []).map((rule) => {
    const finding = findings.find((item) => item.ruleId === rule.id);
    return {
      ruleId: rule.id,
      path: rule.path,
      severity: rule.severity,
      passed: !finding,
      message: finding?.message || rule.message,
      nextStep: finding
        ? rule.severity === "error"
          ? "fix-before-runtime-handoff"
          : "review-warning-before-send"
        : "no-action"
    };
  });
  const readiness = {
    status,
    acceptedForRuntime: (status === "pass" || status === "warning") && !lifecycleControls.blocksRuntimeHandoff,
    acceptedForExternalWrite: status === "pass"
      && !lifecycleControls.blocksRuntimeHandoff
      && (!context.hasExternalWrite || context.approvalTokenAccepted === true),
    nextStep: lifecycleControls.blocksRuntimeHandoff
      ? lifecycleControls.nextActions?.[0]?.nextAction || "complete-verifier-lifecycle-action"
      : hasError
      ? "resolve-blocking-findings"
      : hasWarning
        ? "review-warning-findings"
        : "handoff-to-runtime-adapter",
    validationSummary: {
      totalChecks: allChecks.length,
      passedChecks: allChecks.filter((check) => check.passed).length,
      failedChecks: findings.length,
      errorCount: findings.filter((finding) => finding.severity === "error").length,
      warningCount: findings.filter((finding) => finding.severity === "warning").length
    }
  };
  const runtimeHandoff = verifierContract?.runtimeHandoff
    || buildRuntimeHandoffContract(verifierContract?.rules || [], {}, lifecycleControls);
  const recoveryPlan = verifierContract?.recoveryPlan || compileVerifierRecoveryPlan(verifierContract || {});
  const missingClientState = (runtimeHandoff.requiredClientState || [])
    .filter((stateKey) => readPath(candidate, stateKey) == null);
  const warningRuleIds = findings
    .filter((finding) => finding.severity === "warning")
    .map((finding) => finding.ruleId);

  const result = {
    status,
    findings,
    preview: {
      title: verifierContract?.preview?.title || "Mailchimp campaign readiness",
      checks: allChecks
    },
    readiness,
    runtimeHandoff: {
      ...runtimeHandoff,
      healthStatus: health.healthStatus,
      degradedMode: health.degradedMode,
      handoffStatus: health.healthStatus === "unhealthy"
        ? "verifier-unhealthy"
        : readiness.acceptedForRuntime && missingClientState.length === 0
        ? "ready-for-client-adoption"
        : "client-state-incomplete",
      missingClientState,
      payload: {
        status,
        approvalTokenAccepted: context.approvalTokenAccepted === true,
        warningRuleIds,
        acceptedForRuntime: readiness.acceptedForRuntime,
        acceptedForExternalWrite: readiness.acceptedForExternalWrite,
        verifierHealth: health.healthStatus,
        lifecycleStatus: lifecycleControls.status
      },
      nextAction: missingClientState.length
        ? "hydrate-client-state"
        : lifecycleControls.blocksRuntimeHandoff
          ? lifecycleControls.nextActions?.[0]?.nextAction || "complete-verifier-lifecycle-action"
        : health.healthStatus === "unhealthy"
          ? "fix-verifier-rule"
        : readiness.nextStep
    },
    recovery: {
      ...recoveryPlan,
      health,
      evaluatedStatusAfterFailure: findings.length
        ? findings.some((finding) => finding.severity === "error")
          ? "blocked-before-runtime-handoff"
          : "ready-with-warning-review"
        : "not-required",
      failedRecoveryRules: findings.map((finding) => ({
        ruleId: finding.ruleId,
        recovery: finding.recovery,
        nextAction: finding.severity === "error" ? "hydrate-required-client-state" : "show-operator-warning"
      }))
    },
    lifecycleControls,
    truthBoundary: {
      source: "candidate-object",
      verifiedBy: "verifier-compiler",
      externalFactsChecked: false
    }
  };
  return {
    ...result,
    analyticsReport: compileVerifierAnalyticsReport(verifierContract || {}, result, context),
    reportHistoryManifest: compileVerifierReportHistoryManifest(verifierContract || {}, result, context),
    acceptanceReviewPacket: compileVerifierAcceptanceReviewPacket(verifierContract || {}, result, context),
    recoveryHandoff: compileVerifierRecoveryHandoff({
      ...(verifierContract || {}),
      recoveryPlan,
      runtimeHandoff,
      lifecycleControls
    }, result, {
      ...context,
      candidate
    }),
    operationalIncidentLedger: compileVerifierOperationalIncidentLedger(verifierContract || {}, result, context),
    recoveryExportLedger: compileVerifierRecoveryExportLedger(verifierContract || {}, result, {
      ...context,
      candidate
    })
  };
}
