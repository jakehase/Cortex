import { buildCompletionModel } from "./completion-model.mjs";
import {
  DEFAULT_AI_OS_CASES,
  TEST_HARNESS_VERSION,
  runAiosLanguageHarness,
  summarizeHarnessResult,
} from "./test-harness.mjs";

export const GOLDEN_RUNNER_VERSION = "aios-language.golden-runner.v1";

function stableDiagnosticShape(diagnostic) {
  return Object.freeze({
    ruleId: diagnostic.ruleId,
    severity: diagnostic.severity,
    line: diagnostic.line,
    message: diagnostic.message,
  });
}

function stableCaseSnapshot(result) {
  const providerContract = result.lint.providerHandoff.providerContracts.providers[0]
    ?? result.completion.providerContracts?.providers?.[0]
    ?? null;

  return Object.freeze({
    name: result.name,
    passed: result.passed,
    lintOk: result.lint.ok,
    diagnostics: result.lint.diagnostics.map(stableDiagnosticShape),
    completionContext: Object.freeze({
      kind: result.completion.context.kind,
      clause: result.completion.context.clause,
      trigger: result.completion.context.trigger,
    }),
    completionLabels: [...result.completion.labels].sort(),
    recoveryStatusStates: [...result.completion.recoveryStatusStates],
    lifecycle: Object.freeze({
      enabled: result.completion.lifecycle.enabled,
      nextAction: result.completion.lifecycle.nextAction,
      handoffReady: result.completion.lifecycle.handoffReady,
      missingSettings: [...result.completion.lifecycle.missingSettings],
    }),
    providerContract: stableProviderContractShape(providerContract),
    preview: stablePreviewShape(result.preview),
    acceptance: stableAcceptanceShape(result.acceptance),
    persistence: stablePersistenceShape(result.persistence),
  });
}

function stableProviderContractShape(providerContract) {
  if (!providerContract) {
    return null;
  }

  return Object.freeze({
    provider: providerContract.provider,
    service: providerContract.service,
    expectedService: providerContract.expectedService,
    missingAdapterFields: [...providerContract.missingAdapterFields],
    missingSyncMetadata: [...providerContract.missingSyncMetadata],
    requiredScopes: [...providerContract.requiredScopes],
    acceptedScopes: [...providerContract.acceptedScopes],
    missingScopes: [...providerContract.missingScopes],
    negotiation: Object.freeze({
      ready: providerContract.negotiation.ready,
      serviceMatched: providerContract.negotiation.serviceMatched,
      capabilityCoverage: providerContract.negotiation.capabilityCoverage,
    }),
    externalHandoff: Object.freeze({
      state: providerContract.externalHandoff.state,
      restartSafe: providerContract.externalHandoff.restartSafe,
      statusField: providerContract.externalHandoff.statusField,
      statusValue: providerContract.externalHandoff.statusValue,
      canResume: providerContract.externalHandoff.canResume,
    }),
  });
}

function stablePreviewShape(preview) {
  return Object.freeze({
    status: preview.status,
    nextStep: preview.nextStep,
    lifecycle: Object.freeze({
      enabled: preview.lifecycle.enabled,
      nextAction: preview.lifecycle.nextAction,
      handoffReady: preview.lifecycle.handoffReady,
      missingSettings: [...preview.lifecycle.missingSettings],
    }),
    provider: preview.provider
      ? Object.freeze({
        provider: preview.provider.provider,
        service: preview.provider.service,
        sync: preview.provider.sync,
        schedule: preview.provider.schedule,
        ready: preview.provider.ready,
        negotiated: preview.provider.negotiated,
        acceptedScopes: [...preview.provider.acceptedScopes],
        missingScopes: [...preview.provider.missingScopes],
        missingSyncMetadata: [...preview.provider.missingSyncMetadata],
        externalHandoff: preview.provider.externalHandoff
          ? Object.freeze({
            state: preview.provider.externalHandoff.state,
            restartSafe: preview.provider.externalHandoff.restartSafe,
            statusField: preview.provider.externalHandoff.statusField,
            canResume: preview.provider.externalHandoff.canResume,
          })
          : null,
      })
      : null,
    validation: Object.freeze({
      ok: preview.validation.ok,
      errorCount: preview.validation.errorCount,
      warningCount: preview.validation.warningCount,
    }),
  });
}

function stableAcceptanceShape(acceptance) {
  return Object.freeze({
    ok: acceptance.ok,
    okExpectationMet: acceptance.okExpectationMet,
    ruleExpectationMet: acceptance.ruleExpectationMet,
    statusCompletionMet: acceptance.statusCompletionMet,
    nextActionExpectationMet: acceptance.nextActionExpectationMet,
    handoffExpectationMet: acceptance.handoffExpectationMet,
    providerNegotiationExpectationMet: acceptance.providerNegotiationExpectationMet,
    resumableHandoffExpectationMet: acceptance.resumableHandoffExpectationMet,
    nextStep: acceptance.nextStep,
  });
}

function stablePersistenceShape(persistence) {
  if (!persistence) {
    return null;
  }

  return Object.freeze({
    schema: persistence.schema,
    provider: persistence.provider,
    service: persistence.service,
    status: Object.freeze({
      value: persistence.status.value,
      lifecycle: persistence.status.lifecycle,
      preview: persistence.status.preview,
      accepted: persistence.status.accepted,
      restartSafe: persistence.status.restartSafe,
    }),
    command: Object.freeze({
      name: persistence.command.name,
      idempotencyKey: persistence.command.idempotencyKey,
      replayable: persistence.command.replayable,
      blocked: persistence.command.blocked,
      blockers: [...persistence.command.blockers],
    }),
    externalState: Object.freeze({
      handoffState: persistence.externalState.handoffState,
      statusField: persistence.externalState.statusField,
      cursor: persistence.externalState.cursor,
      lastSync: persistence.externalState.lastSync,
      requiredScopes: [...persistence.externalState.requiredScopes],
      acceptedScopes: [...persistence.externalState.acceptedScopes],
    }),
    recovery: Object.freeze({
      path: persistence.recovery.path,
      nextStatus: persistence.recovery.nextStatus,
      resumeAfterRestart: persistence.recovery.resumeAfterRestart,
    }),
  });
}

function commandForPersistedCase(item) {
  if (item.persistence) {
    return Object.freeze({
      command: item.persistence.command.name,
      idempotencyKey: item.persistence.command.idempotencyKey,
      replay: item.persistence.command.replayable,
      reason: item.persistence.recovery.resumeAfterRestart
        ? "harness-persistence-restart-safe"
        : item.persistence.command.blocked
          ? "harness-persistence-blocked"
          : "harness-persistence-status",
    });
  }

  if (!item.providerContract) {
    return Object.freeze({
      command: item.lifecycle.nextAction,
      idempotencyKey: `${item.name}:local:${item.lifecycle.nextAction}`,
      replay: false,
      reason: item.passed ? "local-contract-ready" : "validation-required",
    });
  }

  const provider = item.providerContract.provider || "provider";
  const service = item.providerContract.service || "service";
  const external = item.providerContract.externalHandoff;
  const command = external.canResume
    ? "resume-external-sync"
    : item.providerContract.negotiation.ready
      ? item.lifecycle.nextAction
      : "negotiate-provider-capability";

  return Object.freeze({
    command,
    idempotencyKey: `${item.name}:${provider}:${service}:${external.state}:${external.statusValue || "pending"}`,
    replay: item.passed && (external.canResume || command === "sync"),
    reason: external.canResume
      ? "restart-safe-external-handoff"
      : item.providerContract.negotiation.ready
        ? "provider-negotiated"
        : "provider-contract-incomplete",
  });
}

function recoveryPathForPersistedCase(item) {
  if (item.persistence) {
    return Object.freeze({
      state: item.persistence.recovery.path === "ready" ? "ready" : item.persistence.recovery.path,
      nextStatus: item.persistence.recovery.nextStatus,
      action: item.persistence.command.blocked ? item.persistence.recovery.path : "none",
      missing: [...item.persistence.command.blockers],
    });
  }

  if (item.passed) {
    return Object.freeze({
      state: "ready",
      nextStatus: item.providerContract?.externalHandoff.state ?? item.lifecycle.nextAction,
      action: "none",
    });
  }

  if (item.providerContract?.missingAdapterFields.length > 0) {
    return Object.freeze({
      state: "needs-settings",
      nextStatus: "blocked",
      action: "collect-provider-settings",
      missing: [...item.providerContract.missingAdapterFields],
    });
  }

  if (item.providerContract?.missingScopes.length > 0) {
    return Object.freeze({
      state: "needs-capability",
      nextStatus: "blocked",
      action: "request-capability-scopes",
      missing: [...item.providerContract.missingScopes],
    });
  }

  return Object.freeze({
    state: "needs-validation",
    nextStatus: "blocked",
    action: item.preview.nextStep,
  });
}

function statusLedgerEntry(item) {
  const command = commandForPersistedCase(item);
  const recovery = recoveryPathForPersistedCase(item);
  const provider = item.persistence?.provider ?? item.providerContract?.provider ?? item.preview.provider?.provider ?? null;
  const service = item.persistence?.service ?? item.providerContract?.service ?? item.preview.provider?.service ?? null;
  const status = item.persistence?.status?.value ?? item.providerContract?.externalHandoff.state ?? item.lifecycle.nextAction;
  const boundary = item.persistence?.command.blocked
    ? "blocked"
    : item.persistence?.status.restartSafe || item.providerContract?.externalHandoff.restartSafe
      ? "restart-safe"
      : "local-only";

  return Object.freeze({
    caseName: item.name,
    provider,
    service,
    status,
    boundary,
    idempotencyKey: command.idempotencyKey,
    replay: command.replay,
    recoveryState: recovery.state,
    recoveryAction: recovery.action,
  });
}

export function buildGoldenRunnerPersistedState(snapshot) {
  const cases = snapshot.cases ?? [];
  const entries = cases.map((item) => {
    const command = commandForPersistedCase(item);
    const recovery = recoveryPathForPersistedCase(item);

    return Object.freeze({
      name: item.name,
      passed: item.passed,
      provider: item.providerContract?.provider ?? item.preview.provider?.provider ?? null,
      service: item.providerContract?.service ?? item.preview.provider?.service ?? null,
      status: item.persistence?.status?.value ?? item.providerContract?.externalHandoff.state ?? item.lifecycle.nextAction,
      restartSafe: Boolean(item.persistence?.status?.restartSafe ?? item.providerContract?.externalHandoff.restartSafe),
      canResume: Boolean(item.persistence?.recovery?.resumeAfterRestart ?? item.providerContract?.externalHandoff.canResume),
      command,
      recovery,
    });
  });
  const replayable = entries.filter((item) => item.command.replay);
  const blocked = entries.filter((item) => item.recovery.state !== "ready");
  const ledger = cases.map(statusLedgerEntry);

  return Object.freeze({
    version: GOLDEN_RUNNER_VERSION,
    schema: "aios-language.persisted-handoff.v1",
    ok: blocked.length === 0,
    replayable: replayable.length,
    blocked: blocked.length,
    entries: Object.freeze(entries),
    statusLedger: Object.freeze(ledger),
    restartSafeStatuses: Object.freeze(ledger.filter((entry) => entry.boundary === "restart-safe").map((entry) => entry.status)),
  });
}

export function buildGoldenRecoveryLedger(snapshot) {
  const persisted = snapshot.persistedState ?? buildGoldenRunnerPersistedState(snapshot);
  const entries = persisted.statusLedger ?? [];
  const blocked = entries.filter((entry) => entry.recoveryState !== "ready");
  const replayable = entries.filter((entry) => entry.replay);

  return Object.freeze({
    version: GOLDEN_RUNNER_VERSION,
    schema: "aios-language.golden-recovery-ledger.v1",
    ok: blocked.length === 0,
    replayable: replayable.length,
    blocked: blocked.length,
    nextCommands: Object.freeze([...new Set(entries.map((entry) => entry.recoveryAction).filter((action) => action && action !== "none"))].sort()),
    idempotencyKeys: Object.freeze(entries.map((entry) => entry.idempotencyKey).sort()),
    entries: Object.freeze(entries),
  });
}

export function buildClientRuntimeHandoff(snapshot) {
  const cases = snapshot.cases ?? [];
  const actionableCases = cases.map((item) => Object.freeze({
    name: item.name,
    ready: item.preview.status === "ready" && item.acceptance.ok,
    nextAction: item.lifecycle.nextAction,
    nextStep: item.preview.nextStep,
    provider: item.preview.provider?.provider ?? null,
    service: item.preview.provider?.service ?? null,
    sync: item.preview.provider?.sync ?? null,
    negotiated: Boolean(item.providerContract?.negotiation.ready ?? item.preview.provider?.negotiated),
    canResume: Boolean(item.persistence?.recovery?.resumeAfterRestart ?? item.providerContract?.externalHandoff.canResume ?? item.preview.provider?.externalHandoff?.canResume),
    idempotencyKey: commandForPersistedCase(item).idempotencyKey,
    persistedStatus: item.persistence?.status.value ?? null,
    recoveryPath: item.persistence?.recovery.path ?? recoveryPathForPersistedCase(item).state,
    validationErrors: item.preview.validation.errorCount,
  }));
  const readyCases = actionableCases.filter((item) => item.ready);
  const blockedCases = actionableCases.filter((item) => !item.ready);

  return Object.freeze({
    version: GOLDEN_RUNNER_VERSION,
    ok: snapshot.ok && blockedCases.length === 0,
    readiness: Object.freeze({
      ready: readyCases.length,
      blocked: blockedCases.length,
      nextActions: [...new Set(actionableCases.map((item) => item.nextAction).filter(Boolean))],
      resumable: actionableCases.filter((item) => item.canResume).length,
      negotiated: actionableCases.filter((item) => item.negotiated).length,
    }),
    cases: Object.freeze(actionableCases),
  });
}

export function runAiosGoldenSnapshot(cases = DEFAULT_AI_OS_CASES, options = {}) {
  const harness = runAiosLanguageHarness(cases, options);
  const snapshots = harness.results.map(stableCaseSnapshot);
  const rootCompletion = buildCompletionModel("");
  const persistedState = buildGoldenRunnerPersistedState({ ok: harness.ok, cases: snapshots });

  return Object.freeze({
    version: GOLDEN_RUNNER_VERSION,
    harnessVersion: TEST_HARNESS_VERSION,
    ok: harness.ok,
    summary: summarizeHarnessResult(harness),
    rootCompletionLabels: rootCompletion.suggestions.map((item) => item.label),
    persistedState,
    recoveryLedger: buildGoldenRecoveryLedger({ ok: harness.ok, cases: snapshots, persistedState }),
    clientRuntime: buildClientRuntimeHandoff({ ok: harness.ok, cases: snapshots }),
    cases: snapshots,
  });
}

export function compareAiosGoldenSnapshot(actual, expected) {
  const actualText = JSON.stringify(actual, null, 2);
  const expectedText = JSON.stringify(expected, null, 2);

  if (actualText === expectedText) {
    return Object.freeze({
      ok: true,
      diff: [],
    });
  }

  const actualLines = actualText.split("\n");
  const expectedLines = expectedText.split("\n");
  const max = Math.max(actualLines.length, expectedLines.length);
  const diff = [];

  for (let index = 0; index < max; index += 1) {
    if (actualLines[index] !== expectedLines[index]) {
      diff.push(Object.freeze({
        line: index + 1,
        actual: actualLines[index] ?? "",
        expected: expectedLines[index] ?? "",
      }));
    }

    if (diff.length >= 20) {
      break;
    }
  }

  return Object.freeze({
    ok: false,
    diff,
  });
}

export function assertAiosGoldenSnapshot(cases, expectedSnapshot, options = {}) {
  const actual = runAiosGoldenSnapshot(cases, options);
  const comparison = compareAiosGoldenSnapshot(actual, expectedSnapshot);

  if (comparison.ok) {
    return actual;
  }

  const first = comparison.diff[0];
  const error = new Error(`AI OS golden snapshot mismatch at line ${first?.line ?? "unknown"}`);
  error.actualSnapshot = actual;
  error.expectedSnapshot = expectedSnapshot;
  error.diff = comparison.diff;
  throw error;
}

export function selfCheckGoldenRunner() {
  const snapshot = runAiosGoldenSnapshot();
  const comparison = compareAiosGoldenSnapshot(snapshot, snapshot);

  return Object.freeze({
    ok: snapshot.ok
      && comparison.ok
      && snapshot.cases.length === DEFAULT_AI_OS_CASES.length
      && snapshot.clientRuntime.readiness.nextActions.includes("sync")
      && snapshot.persistedState.replayable === 1,
    caseCount: snapshot.cases.length,
    runtimeReadyCases: snapshot.clientRuntime.readiness.ready,
    replayableHandoffs: snapshot.persistedState.replayable,
    recoveryLedgerOk: snapshot.recoveryLedger.ok,
    version: GOLDEN_RUNNER_VERSION,
  });
}
