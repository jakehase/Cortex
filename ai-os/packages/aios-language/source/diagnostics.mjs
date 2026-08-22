import { compactRange, linePreview, mapNodeRange } from "./source-map.mjs";

const KNOWN_SEVERITIES = new Set(["error", "warning", "info"]);
const MAILCHIMP_AUDIENCE_OPERATIONS = new Set(["fetchAudience", "syncAudience"]);
const MAILCHIMP_CAMPAIGN_OPERATIONS = new Set(["upsertCampaign", "createCampaign", "scheduleCampaign"]);

export function createDiagnostic(sourceMap, diagnostic = {}) {
  const range = diagnostic.range ?? (
    diagnostic.node ? mapNodeRange(sourceMap, diagnostic.node) : null
  );
  const severity = KNOWN_SEVERITIES.has(diagnostic.severity) ? diagnostic.severity : "error";

  return Object.freeze({
    code: diagnostic.code ?? "AIOS_UNKNOWN",
    severity,
    message: diagnostic.message ?? "Unspecified AI OS diagnostic",
    range,
    preview: range ? linePreview(sourceMap, range) : "",
    hint: diagnostic.hint ?? null,
  });
}

export function diagnosticSummary(diagnostics = []) {
  const counts = { error: 0, warning: 0, info: 0 };
  const codes = {};
  let firstBlockingDiagnostic = null;

  for (const diagnostic of diagnostics) {
    if (counts[diagnostic.severity] !== undefined) {
      counts[diagnostic.severity] += 1;
    }
    codes[diagnostic.code] = (codes[diagnostic.code] ?? 0) + 1;
    if (!firstBlockingDiagnostic && diagnostic.severity === "error") {
      firstBlockingDiagnostic = diagnostic;
    }
  }

  return Object.freeze({
    ok: counts.error === 0,
    counts: Object.freeze(counts),
    codes: Object.freeze(codes),
    workflow: createDiagnosticWorkflowState(counts, firstBlockingDiagnostic),
  });
}

export function formatDiagnostic(diagnostic) {
  const location = diagnostic.range ? compactRange(diagnostic.range) : "unknown";
  const hint = diagnostic.hint ? ` Hint: ${diagnostic.hint}` : "";

  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${location} ${diagnostic.message}${hint}`;
}

export function createDiagnosticWorkflowState(counts = {}, firstBlockingDiagnostic = null) {
  const errorCount = Math.max(0, counts.error ?? 0);
  const warningCount = Math.max(0, counts.warning ?? 0);
  const infoCount = Math.max(0, counts.info ?? 0);
  const enabledCommands = errorCount > 0
    ? ["inspectDiagnostics", "formatPreview"]
    : ["formatPreview", "compile", "exportKernelDescriptors"];
  const disabledCommands = errorCount > 0
    ? ["compile", "exportKernelDescriptors"]
    : [];
  const nextAction = errorCount > 0
    ? {
        id: "fix-blocking-diagnostic",
        label: "Resolve blocking diagnostic",
        diagnosticCode: firstBlockingDiagnostic?.code ?? null,
        range: firstBlockingDiagnostic?.range ?? null,
      }
    : warningCount > 0
      ? {
          id: "review-warnings",
          label: "Review non-blocking warnings",
          diagnosticCode: null,
          range: null,
        }
      : {
          id: "ready-to-export",
          label: "Export kernel descriptors",
          diagnosticCode: null,
          range: null,
        };

  return Object.freeze({
    state: errorCount > 0 ? "blocked" : warningCount > 0 ? "review" : "ready",
    enabled: errorCount === 0,
    commandControls: Object.freeze({
      enabled: Object.freeze(enabledCommands),
      disabled: Object.freeze(disabledCommands),
    }),
    schedule: Object.freeze({
      mode: errorCount > 0 ? "manual" : "onAcceptance",
      reason: errorCount > 0
        ? "Compilation is held until blocking diagnostics are resolved."
        : "Descriptors may be scheduled after preview acceptance.",
    }),
    nextAction: Object.freeze(nextAction),
    totals: Object.freeze({
      diagnostics: errorCount + warningCount + infoCount,
      blocking: errorCount,
      review: warningCount,
    }),
  });
}

export function validateDiagnosticSettings(settings = {}) {
  const severity = settings.minimumSeverity ?? "info";
  const lifecycle = settings.lifecycle ?? "draft";
  const allowedSeverities = ["info", "warning", "error"];
  const allowedLifecycles = ["draft", "review", "accepted", "disabled"];
  const diagnostics = [];

  if (!allowedSeverities.includes(severity)) {
    diagnostics.push(Object.freeze({
      code: "AIOS_DIAGNOSTIC_SEVERITY_SETTING",
      severity: "warning",
      message: `Unsupported minimum severity "${severity}".`,
      range: null,
      preview: "",
      hint: `Use one of ${allowedSeverities.join(", ")}.`,
    }));
  }

  if (!allowedLifecycles.includes(lifecycle)) {
    diagnostics.push(Object.freeze({
      code: "AIOS_DIAGNOSTIC_LIFECYCLE_SETTING",
      severity: "warning",
      message: `Unsupported lifecycle "${lifecycle}".`,
      range: null,
      preview: "",
      hint: `Use one of ${allowedLifecycles.join(", ")}.`,
    }));
  }

  return Object.freeze({
    ok: diagnostics.length === 0,
    normalized: Object.freeze({
      minimumSeverity: allowedSeverities.includes(severity) ? severity : "info",
      lifecycle: allowedLifecycles.includes(lifecycle) ? lifecycle : "draft",
      enabled: settings.enabled !== false,
    }),
    diagnostics: Object.freeze(diagnostics),
  });
}

export function validateAiosAst(ast, sourceMap) {
  const diagnostics = [];
  const jobNames = new Set();

  if (!ast || ast.type !== "Program") {
    return [
      createDiagnostic(sourceMap, {
        code: "AIOS_AST_PROGRAM",
        message: "Expected a Program AST root.",
      }),
    ];
  }

  for (const job of ast.jobs) {
    if (jobNames.has(job.name)) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_DUPLICATE_JOB",
        message: `Job "${job.name}" is declared more than once.`,
        node: job,
        hint: "Use a unique job name so kernel descriptors remain addressable.",
      }));
    }
    jobNames.add(job.name);
    diagnostics.push(...validateJob(job, sourceMap));
  }

  if (ast.jobs.length === 0) {
    diagnostics.push(createDiagnostic(sourceMap, {
      code: "AIOS_NO_JOBS",
      severity: "warning",
      message: "No jobs were declared in this source file.",
      hint: "Declare at least one job block to produce a kernel descriptor.",
    }));
  }

  return diagnostics;
}

function validateJob(job, sourceMap) {
  const diagnostics = [];
  const capabilityNames = new Set();
  const memoryNames = new Set();
  const stepNames = new Set();

  for (const capability of job.capabilities) {
    if (capabilityNames.has(capability.name)) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_DUPLICATE_CAPABILITY",
        message: `Capability "${capability.name}" is declared more than once in job "${job.name}".`,
        node: capability,
      }));
    }
    capabilityNames.add(capability.name);

    if (!capability.scope) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_CAPABILITY_SCOPE",
        message: `Capability "${capability.name}" must declare a scope.`,
        node: capability,
        hint: "Use syntax like capability crm.read: read.",
      }));
    }
  }

  for (const memory of job.memory) {
    if (memoryNames.has(memory.name)) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_DUPLICATE_MEMORY",
        message: `Memory lane "${memory.name}" is declared more than once in job "${job.name}".`,
        node: memory,
      }));
    }
    memoryNames.add(memory.name);

    if (!["ephemeral", "session", "persistent"].includes(memory.mode)) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_MEMORY_MODE",
        message: `Memory lane "${memory.name}" uses unsupported mode "${memory.mode}".`,
        node: memory,
        hint: "Supported modes are ephemeral, session, and persistent.",
      }));
    }
  }

  for (const step of job.steps) {
    if (stepNames.has(step.name)) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_DUPLICATE_STEP",
        message: `Step "${step.name}" is declared more than once in job "${job.name}".`,
        node: step,
      }));
    }
    stepNames.add(step.name);

    if (!step.adapter) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_STEP_ADAPTER",
        message: `Step "${step.name}" must hand off to a runtime adapter.`,
        node: step,
        hint: "Use syntax like step sync uses mailchimp.sync(list: \"audience\").",
      }));
    }

    for (const memoryRef of step.memoryReads.concat(step.memoryWrites)) {
      if (!memoryNames.has(memoryRef)) {
        diagnostics.push(createDiagnostic(sourceMap, {
          code: "AIOS_UNKNOWN_MEMORY",
          message: `Step "${step.name}" references undeclared memory lane "${memoryRef}".`,
          node: step,
        }));
      }
    }
  }

  if (job.steps.length === 0) {
    diagnostics.push(createDiagnostic(sourceMap, {
      code: "AIOS_NO_STEPS",
      message: `Job "${job.name}" has no executable steps.`,
      node: job,
    }));
  }

  if (job.verifiers.length === 0) {
    diagnostics.push(createDiagnostic(sourceMap, {
      code: "AIOS_NO_VERIFIER",
      severity: "warning",
      message: `Job "${job.name}" has no verifier contract.`,
      node: job,
      hint: "Add verify clauses to make truth boundaries explicit.",
    }));
  }

  diagnostics.push(...validateMailchimpProviderContract(job, sourceMap));

  return diagnostics;
}

function validateMailchimpProviderContract(job, sourceMap) {
  const diagnostics = [];
  const mailchimpSteps = job.steps.filter((step) => providerFromAdapter(step.adapter) === "mailchimp");
  const mailchimpCapabilities = job.capabilities.filter((capability) => providerFromName(capability.name) === "mailchimp");

  if (mailchimpSteps.length === 0 && mailchimpCapabilities.length === 0) {
    return diagnostics;
  }

  const scopes = new Set(mailchimpCapabilities.map((capability) => capability.scope));
  const externalCapabilities = mailchimpCapabilities.filter((capability) => capability.boundary === "external");
  const hasAdapterTruth = job.truthBoundaries.some((boundary) => (
    boundary.source === "adapter"
    || boundary.name.toLowerCase().includes("mailchimp")
  ));
  const persistentMemoryNames = new Set(job.memory
    .filter((memory) => memory.mode === "persistent")
    .map((memory) => memory.name));
  const mailchimpWrites = new Set(mailchimpSteps.flatMap((step) => step.memoryWrites));

  if (mailchimpSteps.length > 0 && mailchimpCapabilities.length === 0) {
    diagnostics.push(createDiagnostic(sourceMap, {
      code: "AIOS_MAILCHIMP_CAPABILITY",
      severity: "warning",
      message: `Job "${job.name}" uses Mailchimp adapters without an explicit Mailchimp capability.`,
      node: mailchimpSteps[0],
      hint: "Declare capability mailchimp.contacts or mailchimp.campaigns with the required scope and @external boundary.",
    }));
  }

  if (mailchimpCapabilities.length > 0 && externalCapabilities.length === 0) {
    diagnostics.push(createDiagnostic(sourceMap, {
      code: "AIOS_MAILCHIMP_EXTERNAL_BOUNDARY",
      severity: "warning",
      message: `Job "${job.name}" declares Mailchimp capabilities without an external boundary.`,
      node: mailchimpCapabilities[0],
      hint: "Use @external so preview acceptance can capture provider handoff consent.",
    }));
  }

  if (!hasAdapterTruth) {
    diagnostics.push(createDiagnostic(sourceMap, {
      code: "AIOS_MAILCHIMP_TRUTH_BOUNDARY",
      severity: "warning",
      message: `Job "${job.name}" should declare a Mailchimp adapter truth boundary.`,
      node: job,
      hint: "Add truth mailchimpApi: source=\"adapter\", confidence=\"reported\".",
    }));
  }

  for (const step of mailchimpSteps) {
    const operation = operationFromAdapter(step.adapter);
    const operationNeedsRead = MAILCHIMP_AUDIENCE_OPERATIONS.has(operation);
    const operationNeedsWrite = MAILCHIMP_CAMPAIGN_OPERATIONS.has(operation);
    const operationMutatesProvider = operationNeedsWrite || /^sync/i.test(operation);

    if (operationNeedsRead && !scopes.has("read")) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_MAILCHIMP_READ_SCOPE",
        message: `Step "${step.name}" reads Mailchimp audience data without a read capability.`,
        node: step,
        hint: "Add capability mailchimp.contacts: read @external.",
      }));
    }

    if (operationNeedsWrite && !scopes.has("write")) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_MAILCHIMP_WRITE_SCOPE",
        message: `Step "${step.name}" writes Mailchimp campaign data without a write capability.`,
        node: step,
        hint: "Add capability mailchimp.campaigns: write @external.",
      }));
    }

    if (operationNeedsRead && !step.args?.list) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_MAILCHIMP_AUDIENCE_LIST",
        severity: "warning",
        message: `Step "${step.name}" should name the Mailchimp audience list it reads.`,
        node: step,
        hint: "Pass list: \"primary\" or another deterministic audience identifier.",
      }));
    }

    if (operationNeedsWrite && !step.args?.template) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_MAILCHIMP_CAMPAIGN_TEMPLATE",
        severity: "warning",
        message: `Step "${step.name}" should name the Mailchimp campaign template it writes.`,
        node: step,
        hint: "Pass template: \"weekly\" or another deterministic campaign template identifier.",
      }));
    }

    if (operationMutatesProvider && !hasMailchimpIdempotencyKey(step)) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_MAILCHIMP_IDEMPOTENCY",
        severity: "warning",
        message: `Step "${step.name}" mutates Mailchimp state without a deterministic idempotency key.`,
        node: step,
        hint: "Pass idempotencyKey, requestId, template, campaignId, or list so recovery can resume safely.",
      }));
    }

    if (operationMutatesProvider && !step.memoryWrites.some((name) => persistentMemoryNames.has(name))) {
      diagnostics.push(createDiagnostic(sourceMap, {
        code: "AIOS_MAILCHIMP_RESTART_CHECKPOINT",
        severity: "warning",
        message: `Step "${step.name}" mutates Mailchimp state without writing a persistent restart checkpoint.`,
        node: step,
        hint: "Write the step to a persistent memory lane used as the Mailchimp sync ledger.",
      }));
    }
  }

  if (mailchimpWrites.size > 0 && ![...mailchimpWrites].some((name) => persistentMemoryNames.has(name))) {
    diagnostics.push(createDiagnostic(sourceMap, {
      code: "AIOS_MAILCHIMP_SYNC_LEDGER",
      severity: "warning",
      message: `Job "${job.name}" writes Mailchimp sync state without a persistent ledger memory lane.`,
      node: job,
      hint: "Write at least one Mailchimp step to a persistent memory lane for rollback and audit status.",
    }));
  }

  return diagnostics;
}

function providerFromAdapter(adapter) {
  return providerFromName(adapter);
}

function providerFromName(value) {
  const [provider] = String(value || "").split(".");
  return provider || "runtime";
}

function operationFromAdapter(adapter) {
  const parts = String(adapter || "").split(".");
  return parts.length > 1 ? parts.slice(1).join(".") : parts[0] || "run";
}

function hasMailchimpIdempotencyKey(step) {
  const args = step.args ?? {};
  return Boolean(
    args.idempotencyKey
    || args.idempotency
    || args.requestId
    || args.template
    || args.campaignId
    || args.list,
  );
}
