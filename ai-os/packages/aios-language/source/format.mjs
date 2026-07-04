import { compileAiosSource, parseAiosSource } from "./ast.mjs";
import { createMailchimpPreviewContract } from "./source-map.mjs";

export function formatAiosSource(source = "", options = {}) {
  const compiled = compileAiosSource(source, options);
  const formatted = formatAiosAst(compiled.ast, options);
  const preview = createAiosFormatPreview(compiled, formatted, options);

  return Object.freeze({
    source: formatted,
    diagnostics: compiled.diagnostics,
    summary: compiled.summary,
    preview,
    acceptance: preview.acceptance,
    nextSteps: preview.nextSteps,
  });
}

export function formatAiosAst(ast, options = {}) {
  const indentText = options.indent ?? "  ";
  const blocks = [];

  for (const job of ast.jobs ?? []) {
    blocks.push(formatJob(job, indentText));
  }

  return `${blocks.join("\n\n")}${blocks.length > 0 ? "\n" : ""}`;
}

export function canonicalAiosExample() {
  return [
    "job mailchimpAudienceSync {",
    "  capability mailchimp.contacts: read @external;",
    "  capability mailchimp.campaigns: write @external;",
    "  memory audienceSnapshot: session;",
    "  memory syncLedger: persistent;",
    "  step fetchAudience uses mailchimp.fetchAudience(list: \"primary\") writes [audienceSnapshot] -> audience;",
    "  step upsertCampaign uses mailchimp.upsertCampaign(template: \"weekly\") reads [audienceSnapshot] writes [syncLedger] -> campaign;",
    "  verify audience.count >= 0;",
    "  verify campaign.id exists;",
    "  truth mailchimpApi: source=\"adapter\", confidence=\"reported\";",
    "  rollback compensate to syncLedger;",
    "}",
    "",
  ].join("\n");
}

export function createAiosFormatPreview(compiled = {}, formattedSource = "", options = {}) {
  const diagnostics = compiled.diagnostics ?? [];
  const descriptors = compiled.descriptors ?? [];
  const exportSummary = compiled.exportSummary ?? { ready: false, totals: {} };
  const analytics = compiled.analytics ?? { counters: {} };
  const visibleDiagnostics = diagnostics.slice(0, Math.max(1, options.previewDiagnosticLimit ?? 5));
  const readiness = createReadinessSummary(compiled, formattedSource);
  const acceptance = createAcceptanceContract(compiled, readiness);
  const nextSteps = createNextStepContracts(compiled, readiness);
  const runtimeAdoption = createClientRuntimeAdoption(compiled, readiness);

  return Object.freeze({
    title: options.title ?? "AI OS language preview",
    formattedLineCount: formattedSource ? formattedSource.split("\n").filter(Boolean).length : 0,
    readiness,
    acceptance,
    nextSteps,
    runtimeAdoption,
    validation: Object.freeze({
      ok: compiled.summary?.ok ?? false,
      diagnostics: compiled.summary?.counts ?? Object.freeze({ error: 0, warning: 0, info: 0 }),
      visible: Object.freeze(visibleDiagnostics.map((diagnostic) => Object.freeze({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        range: diagnostic.range,
        hint: diagnostic.hint,
      }))),
    }),
    export: Object.freeze({
      ready: exportSummary.ready,
      totals: exportSummary.totals ?? Object.freeze({ descriptors: 0, ready: 0, needsReview: 0, external: 0 }),
      descriptors: Object.freeze(descriptors.map((descriptor) => Object.freeze({
        id: descriptor.id,
        sourceName: descriptor.sourceName,
        ready: descriptor.exportState?.ready ?? false,
        acceptanceRequired: descriptor.exportState?.acceptanceRequired ?? false,
        providers: descriptor.handoff?.providers ?? Object.freeze([]),
        lifecycle: descriptor.lifecycleControls ?? Object.freeze({}),
        mailchimp: createMailchimpPreviewContract(descriptor.handoff),
        syncStatus: createMailchimpSyncPreview(descriptor),
        nextAction: descriptor.exportState?.nextAction ?? "inspect",
      }))),
    }),
    analytics: Object.freeze({
      counters: analytics.counters ?? Object.freeze({}),
      adapterUsage: analytics.adapterUsage ?? Object.freeze({}),
      capabilityBoundaries: analytics.capabilityBoundaries ?? Object.freeze({}),
    }),
    timeline: compiled.timeline ?? Object.freeze([]),
  });
}

function formatJob(job, indentText) {
  const lines = [`job ${job.name} {`];

  for (const capability of job.capabilities) {
    const boundary = capability.boundary && capability.boundary !== "internal" ? ` @${capability.boundary}` : "";
    lines.push(`${indentText}capability ${capability.name}: ${capability.scope}${boundary};`);
  }

  for (const memory of job.memory) {
    lines.push(`${indentText}memory ${memory.name}: ${memory.mode};`);
  }

  for (const step of job.steps) {
    const args = Object.entries(step.args ?? {})
      .map(([key, value]) => `${key}: ${formatLiteral(value)}`)
      .join(", ");
    const reads = step.memoryReads?.length ? ` reads [${step.memoryReads.join(", ")}]` : "";
    const writes = step.memoryWrites?.length ? ` writes [${step.memoryWrites.join(", ")}]` : "";
    const output = step.output ? ` -> ${step.output}` : "";
    const recovery = step.recovery ? ` recover ${step.recovery}` : "";
    lines.push(`${indentText}step ${step.name} uses ${step.adapter}(${args})${reads}${writes}${output}${recovery};`);
  }

  for (const verifier of job.verifiers) {
    lines.push(`${indentText}verify ${verifier.expression};`);
  }

  for (const boundary of job.truthBoundaries) {
    lines.push(`${indentText}truth ${boundary.name}: source=${formatLiteral(boundary.source)}, confidence=${formatLiteral(boundary.confidence)};`);
  }

  if (job.rollback) {
    const target = job.rollback.target ? ` to ${job.rollback.target}` : "";
    lines.push(`${indentText}rollback ${job.rollback.strategy}${target};`);
  }

  lines.push("}");
  return lines.join("\n");
}

function createReadinessSummary(compiled, formattedSource) {
  const hasSource = formattedSource.trim().length > 0;
  const hasBlockingDiagnostics = (compiled.summary?.counts?.error ?? 0) > 0;
  const hasDescriptors = (compiled.descriptors?.length ?? 0) > 0;
  const exportReady = Boolean(compiled.exportSummary?.ready);
  const externalDescriptorCount = compiled.exportSummary?.totals?.external ?? 0;
  const state = !hasSource
    ? "empty"
    : hasBlockingDiagnostics
      ? "blocked"
      : exportReady
        ? "ready"
        : "review";

  return Object.freeze({
    state,
    exportReady,
    canAccept: state === "ready" && hasDescriptors,
    requiresExternalAcceptance: externalDescriptorCount > 0,
    reasons: Object.freeze(readinessReasons({
      hasSource,
      hasBlockingDiagnostics,
      hasDescriptors,
      exportReady,
      externalDescriptorCount,
    })),
  });
}

function createAcceptanceContract(compiled, readiness) {
  const descriptorIds = (compiled.descriptors ?? []).map((descriptor) => descriptor.id).sort();
  const externalProviders = new Set();
  const providerContracts = [];

  for (const descriptor of compiled.descriptors ?? []) {
    if (descriptor.exportState?.acceptanceRequired) {
      for (const provider of descriptor.handoff?.providers ?? []) {
        externalProviders.add(provider);
      }
    }
    for (const contract of descriptor.handoff?.providerContracts ?? []) {
      providerContracts.push(Object.freeze({
        descriptorId: descriptor.id,
        provider: contract.provider,
        external: contract.external,
        requiredScopes: contract.requiredScopes,
        handoffStages: contract.handoffStages,
        negotiation: contract.negotiation,
      }));
    }
  }

  return Object.freeze({
    required: readiness.requiresExternalAcceptance || descriptorIds.length > 0,
    enabled: readiness.canAccept,
    disabledReason: readiness.canAccept ? null : readiness.reasons[0] ?? "Preview is not ready for acceptance.",
    revision: compiled.historySnapshot?.revision ?? null,
    descriptorIds: Object.freeze(descriptorIds),
    externalProviders: Object.freeze([...externalProviders].sort()),
    providerContracts: Object.freeze(providerContracts.sort((left, right) => (
      `${left.provider}:${left.descriptorId}`.localeCompare(`${right.provider}:${right.descriptorId}`)
    ))),
    payload: Object.freeze({
      action: "accept-aios-export-preview",
      revision: compiled.historySnapshot?.revision ?? null,
      descriptorCount: descriptorIds.length,
      exportReady: readiness.exportReady,
      externalProviders: Object.freeze([...externalProviders].sort()),
    }),
  });
}

function createNextStepContracts(compiled, readiness) {
  if (readiness.state === "empty") {
    return Object.freeze([Object.freeze({
      id: "add-job",
      label: "Add a job block",
      enabled: true,
    })]);
  }

  if (readiness.state === "blocked") {
    const firstError = (compiled.diagnostics ?? []).find((diagnostic) => diagnostic.severity === "error");
    return Object.freeze([Object.freeze({
      id: "fix-diagnostic",
      label: "Fix blocking diagnostic",
      enabled: true,
      diagnosticCode: firstError?.code ?? null,
      range: firstError?.range ?? null,
    })]);
  }

  if (readiness.state === "review") {
    return Object.freeze((compiled.exportSummary?.blocked ?? []).map((descriptor) => {
      const lifecycle = descriptor.lifecycle ?? {};
      const mailchimpMissing = lifecycle.provider?.mailchimp?.missing ?? Object.freeze([]);
      const syncContract = lifecycle.provider?.mailchimp?.syncContract ?? null;

      return Object.freeze({
        id: mailchimpMissing.length > 0 ? `complete-mailchimp-${descriptor.id}` : `review-${descriptor.id}`,
        label: mailchimpMissing.length > 0 ? `Complete Mailchimp contract for ${descriptor.id}` : `Review ${descriptor.id}`,
        enabled: true,
        missing: descriptor.missing,
        lifecycleNextAction: lifecycle.nextAction ?? null,
        providerActions: Object.freeze(mailchimpMissing.map((missing) => mailchimpActionForMissing(missing))),
        syncRecovery: syncContract
          ? Object.freeze({
              restartSafe: syncContract.restartSafe,
              checkpointCount: syncContract.checkpoints?.length ?? 0,
              nextAction: syncContract.commandPlan?.nextAction ?? null,
            })
          : null,
      });
    }));
  }

  return Object.freeze([Object.freeze({
    id: "accept-export",
    label: "Accept export preview",
    enabled: true,
    revision: compiled.historySnapshot?.revision ?? null,
    runtime: createRuntimePayload(compiled),
  })]);
}

function createClientRuntimeAdoption(compiled, readiness) {
  const descriptors = compiled.descriptors ?? [];
  const mailchimpContracts = descriptors
    .map((descriptor) => Object.freeze({
      descriptorId: descriptor.id,
      lifecycleState: descriptor.lifecycleControls?.state ?? "review",
      commandControls: descriptor.lifecycleControls?.commandControls ?? Object.freeze({ enabled: Object.freeze([]), disabled: Object.freeze([]) }),
      schedule: descriptor.lifecycleControls?.schedule ?? Object.freeze({ mode: "manual" }),
      contract: createMailchimpPreviewContract(descriptor.handoff),
      syncStatus: createMailchimpSyncPreview(descriptor),
    }))
    .filter((entry) => entry.contract.detected);
  const enabledCommands = new Set();
  const disabledCommands = new Set();

  for (const descriptor of descriptors) {
    for (const command of descriptor.lifecycleControls?.commandControls?.enabled ?? []) {
      enabledCommands.add(command);
    }
    for (const command of descriptor.lifecycleControls?.commandControls?.disabled ?? []) {
      disabledCommands.add(command);
    }
  }

  return Object.freeze({
    state: readiness.state,
    adopted: readiness.canAccept,
    commands: Object.freeze({
      enabled: Object.freeze([...enabledCommands].sort()),
      disabled: Object.freeze([...disabledCommands].filter((command) => !enabledCommands.has(command)).sort()),
    }),
    handoffPanels: Object.freeze(mailchimpContracts.map((entry) => Object.freeze({
      id: `mailchimp-${entry.descriptorId}`,
      descriptorId: entry.descriptorId,
      provider: "mailchimp",
      ready: entry.contract.ready,
      actions: entry.contract.actions,
      schedule: entry.schedule,
      commandControls: entry.commandControls,
      dataBoundary: entry.contract.dataBoundary,
      syncStatus: entry.syncStatus,
    }))),
    payload: createRuntimePayload(compiled),
  });
}

function createRuntimePayload(compiled) {
  return Object.freeze({
    revision: compiled.historySnapshot?.revision ?? null,
    descriptors: Object.freeze((compiled.descriptors ?? []).map((descriptor) => Object.freeze({
      id: descriptor.id,
      providers: descriptor.handoff?.providers ?? Object.freeze([]),
      lifecycleState: descriptor.lifecycleControls?.state ?? "review",
      scheduleMode: descriptor.lifecycleControls?.schedule?.mode ?? "manual",
      nextAction: descriptor.lifecycleControls?.nextAction ?? descriptor.exportState?.nextAction ?? null,
      providerSync: Object.freeze({
        mailchimp: createMailchimpRuntimeSyncState(descriptor),
      }),
    }))),
  });
}

function mailchimpActionForMissing(missing) {
  if (missing === "audienceList") return "select-audience-list";
  if (missing === "campaignTemplate") return "select-campaign-template";
  if (missing === "persistentSyncLedger") return "choose-persistent-sync-ledger";
  if (missing === "restartSafeCheckpoint") return "add-restart-safe-checkpoint";
  if (missing === "adapterTruthBoundary") return "confirm-adapter-truth-boundary";
  return "inspect-mailchimp-contract";
}

function createMailchimpSyncPreview(descriptor) {
  const contract = createMailchimpPreviewContract(descriptor.handoff);
  const syncContract = contract.syncContract;

  if (!contract.detected || !syncContract) {
    return Object.freeze({
      detected: false,
      ready: true,
      mode: "none",
      visibleCheckpoints: Object.freeze([]),
      recovery: null,
      commands: Object.freeze({ enabled: Object.freeze([]), disabled: Object.freeze([]) }),
    });
  }

  return Object.freeze({
    detected: true,
    ready: Boolean(syncContract.restartSafe),
    mode: syncContract.mode,
    ledgerMemory: syncContract.ledgerMemory,
    visibleCheckpoints: Object.freeze((syncContract.checkpoints ?? []).map((checkpoint) => Object.freeze({
      step: checkpoint.step,
      operation: checkpoint.operation,
      memory: checkpoint.memory,
      persistent: checkpoint.persistent,
      statusPath: checkpoint.statusPath,
      resumeTokenPath: checkpoint.resumeTokenPath,
      hasIdempotencyKey: Boolean(checkpoint.idempotencyKey),
    }))),
    recovery: syncContract.recovery,
    commands: Object.freeze({
      enabled: syncContract.commandPlan?.enabled ?? Object.freeze([]),
      disabled: syncContract.commandPlan?.disabled ?? Object.freeze([]),
      nextAction: syncContract.commandPlan?.nextAction ?? null,
    }),
  });
}

function createMailchimpRuntimeSyncState(descriptor) {
  const syncPreview = createMailchimpSyncPreview(descriptor);

  if (!syncPreview.detected) {
    return Object.freeze({
      detected: false,
      ready: true,
      status: "not-required",
    });
  }

  return Object.freeze({
    detected: true,
    ready: syncPreview.ready,
    status: syncPreview.ready ? "checkpointed" : "needs-checkpoint",
    mode: syncPreview.mode,
    checkpoints: syncPreview.visibleCheckpoints,
    recovery: syncPreview.recovery,
    commands: syncPreview.commands,
  });
}

function readinessReasons(state) {
  const reasons = [];
  if (!state.hasSource) reasons.push("No source statements are available to preview.");
  if (state.hasBlockingDiagnostics) reasons.push("Blocking diagnostics must be resolved before export.");
  if (!state.hasDescriptors) reasons.push("No kernel descriptors were produced.");
  if (state.hasDescriptors && !state.exportReady) reasons.push("One or more descriptors need verifier or truth-boundary review.");
  if (state.externalDescriptorCount > 0) reasons.push("External provider handoff requires preview acceptance.");
  if (reasons.length === 0) reasons.push("Preview is ready for descriptor export.");
  return reasons;
}

function formatLiteral(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value ?? ""));
}
