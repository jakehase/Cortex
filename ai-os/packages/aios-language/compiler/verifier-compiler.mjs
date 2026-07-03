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

  return {
    provider: "mailchimp",
    healthStatus,
    degradedMode: degraded
      ? "render-preview-but-block-runtime-handoff"
      : blockingRules.length
        ? "require-local-evaluation-before-runtime"
        : "runtime-handoff-eligible",
    retryable,
    failureState: diagnosticErrors.length
      ? "compiled-rule-errors"
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
      }))
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
      canHandoffToRuntime: diagnosticErrors.length === 0 && blockingRules.length === 0,
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
      snapshots: [
        {
          id: snapshotId,
          label: evaluation ? "evaluation" : "compile",
          status: evaluation?.status || health.statusMapping?.[health.healthStatus] || health.healthStatus,
          counters: {
            rules: rules.length,
            findings: findings.length,
            actionableErrors: health.actionableErrors?.length || 0
          }
        }
      ],
      timeline: [
        {
          order: 1,
          snapshotId,
          event: evaluation ? "mailchimp.verifier.evaluated" : "mailchimp.verifier.compiled",
          status: evaluation?.status || health.healthStatus,
          nextAction: evaluation?.readiness?.nextStep || health.retryPolicy?.stopWhen || "local-evaluation-complete"
        }
      ]
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
    truthBoundary: {
      source: evaluation ? "candidate-evaluation" : "compiled-verifier-rules",
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

function buildRuntimeHandoffContract(rules, options) {
  const requiredClientState = Array.from(new Set(rules.map((rule) => rule.path.split(".")[0]))).sort();
  const externalWriteRule = rules.find((rule) => rule.predicate === "isTrueWhenWrite");
  const blockingRules = rules.filter((rule) => rule.severity === "error");
  const warningRules = rules.filter((rule) => rule.severity === "warning");

  return {
    provider: "mailchimp",
    runtimeAdapter: options.runtimeAdapter || "mailchimp.campaignRuntimeAdapter",
    handoffStatus: blockingRules.length ? "requires-local-evaluation" : "ready",
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
    nextActions: [
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

  const previewSummary = summarizeRulesForPreview(compiledRules);
  const health = compileVerifierHealthContract(compiledRules, diagnostics, options);
  const recoveryPlan = compileVerifierRecoveryPlan({ rules: compiledRules, diagnostics, health });
  const analyticsReport = compileVerifierAnalyticsReport({ rules: compiledRules, diagnostics, health }, null, options);

  return {
    kind: "aios.verifierContract",
    provider: "mailchimp",
    rules: compiledRules,
    preview: {
      title: "Mailchimp campaign readiness",
      summary: previewSummary,
      health,
      visibleChecks: compiledRules.map((rule) => ({
        id: rule.id,
        severity: rule.severity,
        label: rule.message,
        path: rule.path,
        recovery: rule.recovery
      }))
    },
    acceptance: buildAcceptanceContract(compiledRules, options),
    runtimeHandoff: buildRuntimeHandoffContract(compiledRules, options),
    recoveryPlan,
    health,
    analyticsReport,
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
    acceptedForRuntime: status === "pass" || status === "warning",
    acceptedForExternalWrite: status === "pass" && (!context.hasExternalWrite || context.approvalTokenAccepted === true),
    nextStep: hasError
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
  const runtimeHandoff = verifierContract?.runtimeHandoff || buildRuntimeHandoffContract(verifierContract?.rules || [], {});
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
        verifierHealth: health.healthStatus
      },
      nextAction: missingClientState.length
        ? "hydrate-client-state"
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
    truthBoundary: {
      source: "candidate-object",
      verifiedBy: "verifier-compiler",
      externalFactsChecked: false
    }
  };
  return {
    ...result,
    analyticsReport: compileVerifierAnalyticsReport(verifierContract || {}, result, context)
  };
}
