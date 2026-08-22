import { buildCompletionModel, completeAiosSource } from "./completion-model.mjs";
import { lintAiosSource } from "./lint-rules.mjs";

export const TEST_HARNESS_VERSION = "aios-language.test-harness.v1";

export const DEFAULT_AI_OS_CASES = Object.freeze([
  Object.freeze({
    name: "minimal-kernel-job",
    source: "job minimal {\n  status: queued\n  capability: shell\n}\ncapability shell {\n  requires: operator-approval\n}",
    expectOk: true,
    expectCompletionsAt: "job minimal {\n  status: ",
  }),
  Object.freeze({
    name: "adapter-recovery-transition",
    source: "job recoverable {\n  status: blocked\n  capability: adapter\n}\nrecovery retry {\n  from: blocked\n  to: recovering\n}",
    expectOk: true,
    expectCompletionsAt: "recovery retry {\n  from: ",
  }),
  Object.freeze({
    name: "mailchimp-provider-ready",
    source: "job campaignSync {\n  status: verified\n  capability: mailchimp\n}\ncapability mailchimp {\n  requires: operator-approval\n  scope: campaigns:read,campaigns:write,audiences:read\n}\nadapter mailchimp {\n  provider: mailchimp\n  service: campaign-sync\n  enabled: true\n  handoff: status\n  sync: ready\n  schedule: daily\n  timezone: UTC\n  audience: primary-audience\n  externalId: mc-campaign-001\n  cursor: campaign-page-1\n  lastSync: 2026-01-01T00:00:00Z\n}",
    expectOk: true,
    expectCompletionsAt: "adapter mailchimp {\n  ",
    expectNextAction: "sync",
    expectHandoffReady: true,
    expectProviderNegotiated: true,
    expectResumableHandoff: true,
  }),
  Object.freeze({
    name: "missing-status-handoff",
    source: "job incomplete {\n  capability: shell\n}",
    expectOk: false,
    expectRuleIds: ["aios/missing-status-handoff"],
  }),
]);

function normalizeCase(testCase) {
  return Object.freeze({
    name: String(testCase.name ?? "unnamed"),
    source: String(testCase.source ?? ""),
    expectOk: Boolean(testCase.expectOk),
    expectRuleIds: Array.isArray(testCase.expectRuleIds) ? [...testCase.expectRuleIds] : [],
    expectCompletionsAt: testCase.expectCompletionsAt,
    expectNextAction: testCase.expectNextAction,
    expectHandoffReady: testCase.expectHandoffReady,
    expectProviderNegotiated: testCase.expectProviderNegotiated,
    expectResumableHandoff: testCase.expectResumableHandoff,
  });
}

function stableScalar(value, fallback = "unset") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function stableList(values = []) {
  return Object.freeze([...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))].sort());
}

function buildHarnessPersistenceRecord(normalized, lint, lifecycleModel, preview, acceptance) {
  const provider = preview.provider;
  const contract = lint.providerHandoff.providerContracts.providers[0]
    ?? lifecycleModel.providerContracts.providers[0]
    ?? null;
  const external = contract?.externalHandoff ?? provider?.externalHandoff ?? null;
  const statusValue = stableScalar(external?.statusValue ?? external?.state ?? lifecycleModel.lifecycle.nextAction, "pending");
  const providerName = stableScalar(provider?.provider ?? contract?.provider, "local");
  const service = stableScalar(provider?.service ?? contract?.service, "runtime");
  const command = acceptance.ok
    ? external?.canResume
      ? "resume-external-sync"
      : lifecycleModel.lifecycle.nextAction
    : preview.nextStep;
  const blockers = stableList([
    ...preview.validation.blockingDiagnostics.map((item) => item.ruleId),
    ...(contract?.missingAdapterFields ?? []).map((field) => `missing-adapter:${field}`),
    ...(contract?.missingScopes ?? []).map((scope) => `missing-scope:${scope}`),
    ...(contract?.missingSyncMetadata ?? []).map((field) => `missing-sync:${field}`),
  ]);
  const restartSafe = Boolean(external?.restartSafe && external?.canResume && acceptance.ok);

  return Object.freeze({
    schema: "aios-language.harness.persistence.v1",
    caseName: normalized.name,
    provider: providerName,
    service,
    status: Object.freeze({
      value: statusValue,
      lifecycle: lifecycleModel.lifecycle.nextAction,
      preview: preview.nextStep,
      accepted: acceptance.ok,
      restartSafe,
    }),
    command: Object.freeze({
      name: command,
      idempotencyKey: `${normalized.name}:${providerName}:${service}:${statusValue}:${command}`,
      replayable: restartSafe && ["resume-external-sync", "sync"].includes(command),
      blocked: blockers.length > 0,
      blockers,
    }),
    externalState: Object.freeze({
      handoffState: stableScalar(external?.state, "local"),
      statusField: stableScalar(external?.statusField, "status"),
      cursor: stableScalar(contract?.syncMetadata?.cursor ?? provider?.syncMetadata?.cursor, "none"),
      lastSync: stableScalar(contract?.syncMetadata?.lastSync ?? provider?.syncMetadata?.lastSync, "none"),
      requiredScopes: stableList(contract?.requiredScopes ?? provider?.acceptedScopes ?? []),
      acceptedScopes: stableList(contract?.acceptedScopes ?? provider?.acceptedScopes ?? []),
    }),
    recovery: Object.freeze({
      path: acceptance.ok
        ? "ready"
        : blockers.some((item) => item.startsWith("missing-sync:"))
          ? "collect-sync-metadata"
          : blockers.some((item) => item.startsWith("missing-scope:"))
            ? "request-provider-scope"
            : blockers.some((item) => item.startsWith("missing-adapter:"))
              ? "collect-provider-settings"
              : "fix-validation",
      nextStatus: acceptance.ok ? statusValue : "blocked",
      resumeAfterRestart: restartSafe,
    }),
  });
}

function buildCasePreview(normalized, lint, completionModel, lifecycleModel) {
  const lifecycle = lifecycleModel.lifecycle;
  const providerHandoff = lint.providerHandoff;
  const primaryAdapter = providerHandoff.adapters[0] ?? null;
  const primaryContract = primaryAdapter?.contract
    ?? providerHandoff.providerContracts.providers[0]
    ?? completionModel.providerContracts.providers[0]
    ?? null;
  const blockingDiagnostics = lint.diagnostics
    .filter((item) => item.severity === "error")
    .map((item) => Object.freeze({
      ruleId: item.ruleId,
      line: item.line,
      message: item.message,
    }));
  const nextStep = blockingDiagnostics.length > 0
    ? "fix-validation"
    : lifecycle.nextAction;

  return Object.freeze({
    name: normalized.name,
    title: `${normalized.name} workflow preview`,
    status: lint.ok ? "ready" : "needs-attention",
    nextStep,
    lifecycle: Object.freeze({
      enabled: lifecycle.enabled,
      nextAction: lifecycle.nextAction,
      handoffReady: lifecycle.handoffReady,
      missingSettings: [...lifecycle.missingSettings],
      controls: lifecycle.controls,
    }),
    provider: primaryAdapter
      ? Object.freeze({
        name: primaryAdapter.name,
        provider: primaryAdapter.provider,
        service: primaryAdapter.service,
        sync: primaryAdapter.sync,
        schedule: primaryAdapter.schedule,
        ready: primaryAdapter.ready,
        negotiated: primaryContract?.negotiation.ready ?? false,
        acceptedScopes: primaryContract ? [...primaryContract.acceptedScopes] : [],
        missingScopes: primaryContract ? [...primaryContract.missingScopes] : [],
        syncMetadata: primaryContract?.syncMetadata ?? Object.freeze({}),
        missingSyncMetadata: primaryContract ? [...primaryContract.missingSyncMetadata] : [],
        externalHandoff: primaryContract?.externalHandoff ?? null,
      })
      : null,
    validation: Object.freeze({
      ok: lint.ok,
      errorCount: blockingDiagnostics.length,
      warningCount: lint.diagnostics.filter((item) => item.severity === "warning").length,
      blockingDiagnostics,
    }),
    completion: Object.freeze({
      context: completionModel.context.kind,
      suggestions: completionModel.suggestions.slice(0, 8).map((item) => item.label),
    }),
  });
}

function buildAcceptanceState(normalized, lint, completionModel, lifecycleModel, preview) {
  const diagnosticRuleIds = lint.diagnostics.map((item) => item.ruleId);
  const okExpectationMet = lint.ok === normalized.expectOk;
  const ruleExpectationMet = normalized.expectRuleIds.every((ruleId) => diagnosticRuleIds.includes(ruleId));
  const completionLabels = completionModel.suggestions.map((item) => item.label);
  const statusCompletionMet = completionModel.context.kind !== "status"
    || completionLabels.includes("queued") && completionLabels.includes("recovering");
  const nextActionExpectationMet = normalized.expectNextAction === undefined
    || lifecycleModel.lifecycle.nextAction === normalized.expectNextAction;
  const handoffExpectationMet = normalized.expectHandoffReady === undefined
    || lifecycleModel.lifecycle.handoffReady === normalized.expectHandoffReady;
  const providerContract = lint.providerHandoff.providerContracts.providers[0]
    ?? completionModel.providerContracts.providers[0]
    ?? null;
  const providerNegotiationExpectationMet = normalized.expectProviderNegotiated === undefined
    || Boolean(providerContract?.negotiation.ready) === normalized.expectProviderNegotiated;
  const resumableHandoffExpectationMet = normalized.expectResumableHandoff === undefined
    || Boolean(providerContract?.externalHandoff.canResume) === normalized.expectResumableHandoff;

  return Object.freeze({
    ok: okExpectationMet
      && ruleExpectationMet
      && statusCompletionMet
      && nextActionExpectationMet
      && handoffExpectationMet
      && providerNegotiationExpectationMet
      && resumableHandoffExpectationMet,
    okExpectationMet,
    ruleExpectationMet,
    statusCompletionMet,
    nextActionExpectationMet,
    handoffExpectationMet,
    providerNegotiationExpectationMet,
    resumableHandoffExpectationMet,
    expectedOk: normalized.expectOk,
    expectedRuleIds: normalized.expectRuleIds,
    expectedNextAction: normalized.expectNextAction,
    expectedHandoffReady: normalized.expectHandoffReady,
    expectedProviderNegotiated: normalized.expectProviderNegotiated,
    expectedResumableHandoff: normalized.expectResumableHandoff,
    nextStep: preview.nextStep,
  });
}

function runCase(testCase, options = {}) {
  const normalized = normalizeCase(testCase);
  const lint = lintAiosSource(normalized.source, { profile: options.profile });
  const completionSource = normalized.expectCompletionsAt ?? normalized.source;
  const completionModel = buildCompletionModel(completionSource);
  const lifecycleModel = completionSource === normalized.source
    ? completionModel
    : buildCompletionModel(normalized.source);
  const completionLabels = completionModel.suggestions.map((item) => item.label);
  const preview = buildCasePreview(normalized, lint, completionModel, lifecycleModel);
  const acceptance = buildAcceptanceState(normalized, lint, completionModel, lifecycleModel, preview);
  const persistence = buildHarnessPersistenceRecord(normalized, lint, lifecycleModel, preview, acceptance);

  return Object.freeze({
    name: normalized.name,
    passed: acceptance.ok,
    lint,
    completion: Object.freeze({
      context: completionModel.context,
      labels: completionLabels,
      recoveryStatusStates: completionModel.recoveryStatusStates,
      lifecycle: lifecycleModel.lifecycle,
      providerContracts: lifecycleModel.providerContracts,
    }),
    preview,
    acceptance,
    expectations: acceptance,
    persistence,
  });
}

export function runAiosLanguageHarness(cases = DEFAULT_AI_OS_CASES, options = {}) {
  const results = cases.map((testCase) => runCase(testCase, options));
  const failed = results.filter((result) => !result.passed);

  return Object.freeze({
    version: TEST_HARNESS_VERSION,
    ok: failed.length === 0,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    readiness: summarizeHarnessReadiness(results),
    persistence: summarizeHarnessPersistence(results.map((result) => result.persistence)),
    results,
  });
}

export function createAiosHarnessCase(name, source, expectations = {}) {
  return normalizeCase({
    name,
    source,
    expectOk: expectations.expectOk ?? true,
    expectRuleIds: expectations.expectRuleIds ?? [],
    expectCompletionsAt: expectations.expectCompletionsAt,
    expectNextAction: expectations.expectNextAction,
    expectHandoffReady: expectations.expectHandoffReady,
    expectProviderNegotiated: expectations.expectProviderNegotiated,
    expectResumableHandoff: expectations.expectResumableHandoff,
  });
}

export function summarizeHarnessReadiness(results = []) {
  const previewStates = results.map((result) => result.preview).filter(Boolean);
  const ready = previewStates.filter((preview) => preview.status === "ready");
  const needsAttention = previewStates.filter((preview) => preview.status !== "ready");
  const nextSteps = [...new Set(previewStates.map((preview) => preview.nextStep).filter(Boolean))];

  return Object.freeze({
    ready: ready.length,
    needsAttention: needsAttention.length,
    nextSteps,
    handoffReady: previewStates.filter((preview) => preview.lifecycle.handoffReady).length,
    providerNegotiated: previewStates.filter((preview) => preview.provider?.negotiated).length,
    resumableHandoffs: previewStates.filter((preview) => preview.provider?.externalHandoff?.canResume).length,
  });
}

export function summarizeHarnessPersistence(records = []) {
  const replayable = records.filter((record) => record.command?.replayable);
  const blocked = records.filter((record) => record.command?.blocked);
  const restartSafe = records.filter((record) => record.status?.restartSafe);
  const providers = stableList(records.map((record) => record.provider).filter((provider) => provider !== "local"));
  const recoveryPaths = stableList(records.map((record) => record.recovery?.path));

  return Object.freeze({
    schema: "aios-language.harness.persistence.summary.v1",
    total: records.length,
    replayable: replayable.length,
    blocked: blocked.length,
    restartSafe: restartSafe.length,
    providers,
    recoveryPaths,
    commands: stableList(records.map((record) => record.command?.name)),
  });
}

export function summarizeHarnessResult(result) {
  return Object.freeze({
    version: result.version ?? TEST_HARNESS_VERSION,
    ok: Boolean(result.ok),
    total: Number(result.total ?? 0),
    passed: Number(result.passed ?? 0),
    failed: Number(result.failed ?? 0),
    readiness: result.readiness ?? summarizeHarnessReadiness(result.results ?? []),
    failedCases: (result.results ?? [])
      .filter((item) => !item.passed)
      .map((item) => item.name),
    persistence: result.persistence ?? summarizeHarnessPersistence((result.results ?? []).map((item) => item.persistence).filter(Boolean)),
  });
}

export function selfCheckTestHarness() {
  const result = runAiosLanguageHarness();
  const statusLabels = completeAiosSource("job demo {\n  status: ").map((item) => item.label);

  return Object.freeze({
    ok: result.ok
      && statusLabels.includes("blocked")
      && statusLabels.includes("verified")
      && result.readiness.nextSteps.includes("sync")
      && result.readiness.providerNegotiated === 1
      && result.readiness.resumableHandoffs === 1
      && result.persistence.replayable === 1
      && result.persistence.recoveryPaths.includes("ready"),
    summary: summarizeHarnessResult(result),
    version: TEST_HARNESS_VERSION,
  });
}
