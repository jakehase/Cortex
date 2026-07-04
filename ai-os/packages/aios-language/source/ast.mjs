import { createDiagnostic, diagnosticSummary, validateAiosAst } from "./diagnostics.mjs";
import { createGeneratedSourceMap, createProviderContractState, createSourceMap, rangeFromOffsets } from "./source-map.mjs";

const STATEMENT_KEYWORDS = new Set(["capability", "memory", "step", "verify", "rollback", "truth"]);

export function parseAiosSource(source = "", options = {}) {
  const sourceMap = createSourceMap(source, options.fileName ?? "inline.aios");
  const parser = new Parser(sourceMap);
  const ast = parser.parseProgram();
  const diagnostics = parser.diagnostics.concat(validateAiosAst(ast, sourceMap));

  return Object.freeze({
    ast,
    diagnostics: Object.freeze(diagnostics),
    summary: diagnosticSummary(diagnostics),
    sourceMap,
  });
}

export function lowerAstToKernelJobDescriptors(ast, options = {}) {
  const descriptors = [];
  const mappings = [];
  let generatedLine = 1;

  for (const job of ast.jobs ?? []) {
    const descriptor = {
      id: `${options.namespace ?? "local"}.${job.name}`,
      sourceName: job.name,
      capabilities: job.capabilities.map((capability) => ({
        name: capability.name,
        scope: capability.scope,
        boundary: capability.boundary ?? "internal",
      })),
      memory: job.memory.map((memory) => ({
        name: memory.name,
        mode: memory.mode,
        retention: memory.mode === "persistent" ? "explicit" : "runtime",
      })),
      steps: job.steps.map((step) => ({
        id: step.name,
        adapter: step.adapter,
        input: step.args,
        reads: step.memoryReads,
        writes: step.memoryWrites,
        output: step.output,
        status: "pending",
        recovery: step.recovery ?? job.rollback?.strategy ?? "halt",
      })),
      verifier: {
        contracts: job.verifiers.map((verifier) => verifier.expression),
        truthBoundaries: job.truthBoundaries.map((boundary) => ({
          name: boundary.name,
          source: boundary.source,
          confidence: boundary.confidence,
        })),
      },
      rollback: job.rollback ?? { strategy: "halt", target: null },
    };
    const handoff = createProviderContractState(descriptor, {
      service: options.service ?? options.namespace ?? "local",
      syncMode: options.syncMode,
    });
    const exportState = createDescriptorExportState(descriptor, handoff);
    const lifecycleControls = createDescriptorLifecycleControls(descriptor, handoff, exportState, options);

    descriptors.push(Object.freeze({
      ...descriptor,
      handoff,
      exportState,
      lifecycleControls,
    }));
    mappings.push({
      generated: {
        startLine: generatedLine,
        startColumn: 1,
        endLine: generatedLine,
        endColumn: descriptor.id.length,
      },
      original: { start: job.start, end: job.end },
      symbol: descriptor.id,
      kind: "job",
      handoff,
    });
    generatedLine += 1;
  }

  return Object.freeze({
    descriptors: Object.freeze(descriptors),
    generatedMap: options.sourceMap ? createGeneratedSourceMap(options.sourceMap, mappings) : null,
    analytics: createAiosAnalytics(ast, descriptors),
    exportSummary: createAiosExportSummary(descriptors),
    historySnapshot: createAiosHistorySnapshot(ast, descriptors, options),
  });
}

export function compileAiosSource(source = "", options = {}) {
  const parsed = parseAiosSource(source, options);
  const lowered = parsed.summary.ok
    ? lowerAstToKernelJobDescriptors(parsed.ast, { ...options, sourceMap: parsed.sourceMap })
    : { descriptors: Object.freeze([]), generatedMap: null };

  return Object.freeze({
    ...parsed,
    ...lowered,
    timeline: createAiosTimeline(parsed, lowered),
  });
}

export function createAiosAnalytics(ast = {}, descriptors = []) {
  const jobs = ast.jobs ?? [];
  const capabilityBoundaries = {};
  const memoryModes = {};
  const adapterUsage = {};
  const truthSources = {};
  const rollbackStrategies = {};
  let verifierContracts = 0;
  let externalHandoffs = 0;

  for (const job of jobs) {
    verifierContracts += job.verifiers?.length ?? 0;
    for (const capability of job.capabilities ?? []) {
      const boundary = capability.boundary ?? "internal";
      capabilityBoundaries[boundary] = (capabilityBoundaries[boundary] ?? 0) + 1;
      if (boundary === "external") externalHandoffs += 1;
    }
    for (const memory of job.memory ?? []) {
      memoryModes[memory.mode] = (memoryModes[memory.mode] ?? 0) + 1;
    }
    for (const step of job.steps ?? []) {
      const adapter = step.adapter || "runtime";
      adapterUsage[adapter] = (adapterUsage[adapter] ?? 0) + 1;
    }
    for (const boundary of job.truthBoundaries ?? []) {
      truthSources[boundary.source] = (truthSources[boundary.source] ?? 0) + 1;
    }
    const rollback = job.rollback?.strategy ?? "halt";
    rollbackStrategies[rollback] = (rollbackStrategies[rollback] ?? 0) + 1;
  }

  return Object.freeze({
    counters: Object.freeze({
      jobs: jobs.length,
      descriptors: descriptors.length,
      capabilities: jobs.reduce((count, job) => count + (job.capabilities?.length ?? 0), 0),
      memoryLanes: jobs.reduce((count, job) => count + (job.memory?.length ?? 0), 0),
      steps: jobs.reduce((count, job) => count + (job.steps?.length ?? 0), 0),
      verifierContracts,
      truthBoundaries: jobs.reduce((count, job) => count + (job.truthBoundaries?.length ?? 0), 0),
      externalHandoffs,
    }),
    capabilityBoundaries: freezeSortedRecord(capabilityBoundaries),
    memoryModes: freezeSortedRecord(memoryModes),
    adapterUsage: freezeSortedRecord(adapterUsage),
    truthSources: freezeSortedRecord(truthSources),
    rollbackStrategies: freezeSortedRecord(rollbackStrategies),
  });
}

export function createAiosExportSummary(descriptors = []) {
  const exportable = [];
  const blocked = [];

  for (const descriptor of descriptors) {
    const missingAdapterSteps = descriptor.steps
      .filter((step) => !step.adapter)
      .map((step) => step.id);
    const missingTruth = descriptor.verifier.truthBoundaries.length === 0;
    const missingContracts = descriptor.verifier.contracts.length === 0;
    const missingProviderContract = Boolean(descriptor.handoff?.mailchimp?.missing?.length);
    const mailchimpSync = createMailchimpSyncExportState(descriptor);
    const status = missingAdapterSteps.length || missingTruth || missingContracts || missingProviderContract
      ? "needsReview"
      : "ready";
    const target = {
      id: descriptor.id,
      status,
      external: Boolean(descriptor.handoff?.sync?.external),
      providerCount: descriptor.handoff?.providers?.length ?? 0,
      adapterCount: descriptor.handoff?.adapters?.length ?? 0,
      memoryWrites: descriptor.handoff?.sync?.memoryWrites ?? Object.freeze([]),
      lifecycle: descriptor.lifecycleControls ?? Object.freeze({}),
      providerSync: mailchimpSync,
      missing: Object.freeze({
        adapters: Object.freeze(missingAdapterSteps),
        truthBoundaries: missingTruth,
        verifierContracts: missingContracts,
        providerContract: missingProviderContract,
      }),
    };

    if (status === "ready") exportable.push(Object.freeze(target));
    else blocked.push(Object.freeze(target));
  }

  return Object.freeze({
    ready: blocked.length === 0,
    exportable: Object.freeze(exportable),
    blocked: Object.freeze(blocked),
    totals: Object.freeze({
      descriptors: descriptors.length,
      ready: exportable.length,
      needsReview: blocked.length,
      external: descriptors.filter((descriptor) => descriptor.handoff?.sync?.external).length,
    }),
  });
}

export function createAiosHistorySnapshot(ast = {}, descriptors = [], options = {}) {
  const namespace = options.namespace ?? "local";
  const revision = options.revision ?? stableRevision(ast, descriptors, namespace);
  const descriptorIds = descriptors.map((descriptor) => descriptor.id).sort();

  return Object.freeze({
    revision,
    namespace,
    fileName: options.fileName ?? "inline.aios",
    jobNames: Object.freeze((ast.jobs ?? []).map((job) => job.name).sort()),
    descriptorIds: Object.freeze(descriptorIds),
    counters: createAiosAnalytics(ast, descriptors).counters,
    exportReady: createAiosExportSummary(descriptors).ready,
    providerSync: Object.freeze(descriptors.map((descriptor) => Object.freeze({
      descriptorId: descriptor.id,
      providers: descriptor.handoff?.providers ?? Object.freeze([]),
      mailchimp: createMailchimpSyncExportState(descriptor),
    }))),
  });
}

export function createAiosTimeline(parsed = {}, lowered = {}) {
  const summary = parsed.summary ?? { ok: false, counts: {} };
  const exportSummary = lowered.exportSummary ?? { ready: false, totals: {} };
  const phases = [
    {
      id: "parse",
      state: "complete",
      label: "Parse source",
      detail: `${parsed.ast?.jobs?.length ?? 0} job(s) discovered`,
    },
    {
      id: "diagnostics",
      state: summary.ok ? "complete" : "blocked",
      label: "Validate contracts",
      detail: `${summary.counts?.error ?? 0} error(s), ${summary.counts?.warning ?? 0} warning(s)`,
    },
    {
      id: "lower",
      state: summary.ok ? "complete" : "skipped",
      label: "Lower descriptors",
      detail: `${lowered.descriptors?.length ?? 0} descriptor(s) generated`,
    },
    {
      id: "export",
      state: summary.ok && exportSummary.ready ? "ready" : summary.ok ? "review" : "blocked",
      label: "Prepare export",
      detail: `${exportSummary.totals?.ready ?? 0} ready, ${exportSummary.totals?.needsReview ?? 0} needs review`,
    },
    {
      id: "handoff",
      state: summary.ok && exportSummary.ready ? "pendingAcceptance" : summary.ok ? "review" : "blocked",
      label: "External handoff",
      detail: `${exportSummary.totals?.external ?? 0} external descriptor(s) require lifecycle controls`,
    },
  ];

  return Object.freeze(phases.map((phase, index) => Object.freeze({
    ...phase,
    order: index + 1,
  })));
}

export function createJobNode(name, body = [], range = {}) {
  return Object.freeze({
    type: "Job",
    name,
    capabilities: Object.freeze(body.filter((node) => node.type === "Capability")),
    memory: Object.freeze(body.filter((node) => node.type === "Memory")),
    steps: Object.freeze(body.filter((node) => node.type === "Step")),
    verifiers: Object.freeze(body.filter((node) => node.type === "Verifier")),
    truthBoundaries: Object.freeze(body.filter((node) => node.type === "TruthBoundary")),
    rollback: body.find((node) => node.type === "Rollback") ?? null,
    start: range.start ?? 0,
    end: range.end ?? range.start ?? 0,
  });
}

class Parser {
  constructor(sourceMap) {
    this.sourceMap = sourceMap;
    this.source = sourceMap.source;
    this.offset = 0;
    this.diagnostics = [];
  }

  parseProgram() {
    const jobs = [];
    this.skipTrivia();

    while (!this.eof()) {
      if (this.matchKeyword("job")) {
        jobs.push(this.parseJob());
      } else {
        const start = this.offset;
        const token = this.readIdentifier();
        this.addDiagnostic("AIOS_EXPECTED_JOB", `Expected "job" declaration but found "${token || this.peek()}".`, start, this.offset);
        this.recoverToNext("job");
      }
      this.skipTrivia();
    }

    return Object.freeze({
      type: "Program",
      jobs: Object.freeze(jobs),
      start: 0,
      end: this.source.length,
    });
  }

  parseJob() {
    const start = this.offset;
    this.consumeKeyword("job");
    const name = this.expectIdentifier("AIOS_JOB_NAME", "Expected a job name after \"job\".") ?? "anonymous";
    const body = [];

    if (!this.consume("{")) {
      this.addDiagnostic("AIOS_JOB_BODY", `Job "${name}" must open with "{".`, this.offset, this.offset + 1);
      return createJobNode(name, body, { start, end: this.offset });
    }

    this.skipTrivia();
    while (!this.eof() && !this.startsWith("}")) {
      const statementStart = this.offset;
      const keyword = this.readIdentifier();

      if (!STATEMENT_KEYWORDS.has(keyword)) {
        this.addDiagnostic("AIOS_UNKNOWN_STATEMENT", `Unknown job statement "${keyword}".`, statementStart, this.offset);
        this.recoverStatement();
      } else {
        body.push(this.parseStatement(keyword, statementStart));
      }
      this.skipTrivia();
    }

    if (!this.consume("}")) {
      this.addDiagnostic("AIOS_JOB_CLOSE", `Job "${name}" must close with "}".`, start, this.offset);
    }

    return createJobNode(name, body, { start, end: this.offset });
  }

  parseStatement(keyword, start) {
    if (keyword === "capability") return this.parseCapability(start);
    if (keyword === "memory") return this.parseMemory(start);
    if (keyword === "step") return this.parseStep(start);
    if (keyword === "verify") return this.parseVerifier(start);
    if (keyword === "rollback") return this.parseRollback(start);
    return this.parseTruthBoundary(start);
  }

  parseCapability(start) {
    const name = this.expectIdentifier("AIOS_CAPABILITY_NAME", "Expected capability name.") ?? "unknown";
    let scope = "";
    let boundary = "internal";

    if (this.consume(":")) {
      scope = this.readUntil(/[;,\n]/).trim();
    }

    if (scope.includes("@")) {
      const [rawScope, rawBoundary] = scope.split("@");
      scope = rawScope.trim();
      boundary = rawBoundary.trim() || boundary;
    }

    this.consumeTerminator();
    return freezeNode({ type: "Capability", name, scope, boundary, start, end: this.offset });
  }

  parseMemory(start) {
    const name = this.expectIdentifier("AIOS_MEMORY_NAME", "Expected memory lane name.") ?? "memory";
    let mode = "ephemeral";

    if (this.consume(":")) {
      mode = this.readUntil(/[;,\n]/).trim() || mode;
    }

    this.consumeTerminator();
    return freezeNode({ type: "Memory", name, mode, start, end: this.offset });
  }

  parseStep(start) {
    const name = this.expectIdentifier("AIOS_STEP_NAME", "Expected step name.") ?? "step";
    let adapter = "";
    let args = {};
    let output = null;
    let memoryReads = [];
    let memoryWrites = [];
    let recovery = null;

    if (!this.consumeKeyword("uses")) {
      this.addDiagnostic("AIOS_STEP_USES", `Step "${name}" must include "uses".`, start, this.offset);
    } else {
      const invocation = this.readUntil(/[;\n]/).trim();
      const parsed = parseInvocation(invocation);
      adapter = parsed.adapter;
      args = parsed.args;
      output = parsed.output;
      memoryReads = parsed.memoryReads;
      memoryWrites = parsed.memoryWrites;
      recovery = parsed.recovery;
    }

    this.consumeTerminator();
    return freezeNode({ type: "Step", name, adapter, args, output, memoryReads, memoryWrites, recovery, start, end: this.offset });
  }

  parseVerifier(start) {
    const expression = this.readUntil(/[;\n]/).trim();
    this.consumeTerminator();
    return freezeNode({ type: "Verifier", expression, start, end: this.offset });
  }

  parseRollback(start) {
    const expression = this.readUntil(/[;\n]/).trim();
    const [strategy, target = null] = expression.split(/\s+to\s+/);
    this.consumeTerminator();
    return freezeNode({ type: "Rollback", strategy: strategy.trim() || "halt", target: target?.trim() || null, start, end: this.offset });
  }

  parseTruthBoundary(start) {
    const name = this.expectIdentifier("AIOS_TRUTH_NAME", "Expected truth boundary name.") ?? "truth";
    let source = "runtime";
    let confidence = "reported";

    if (this.consume(":")) {
      const parts = this.readUntil(/[;\n]/).split(",").map((part) => part.trim()).filter(Boolean);
      for (const part of parts) {
        const [key, value] = part.split("=").map((piece) => piece?.trim());
        if (key === "source") source = stripQuotes(value ?? source);
        if (key === "confidence") confidence = stripQuotes(value ?? confidence);
      }
    }

    this.consumeTerminator();
    return freezeNode({ type: "TruthBoundary", name, source, confidence, start, end: this.offset });
  }

  consumeKeyword(keyword) {
    this.skipTrivia();
    if (!this.matchKeyword(keyword)) return false;
    this.offset += keyword.length;
    this.skipTrivia();
    return true;
  }

  matchKeyword(keyword) {
    return this.source.slice(this.offset, this.offset + keyword.length) === keyword
      && !/[A-Za-z0-9_.-]/.test(this.source[this.offset + keyword.length] ?? "");
  }

  expectIdentifier(code, message) {
    this.skipTrivia();
    const start = this.offset;
    const identifier = this.readIdentifier();
    if (!identifier) {
      this.addDiagnostic(code, message, start, start + 1);
      return null;
    }
    this.skipTrivia();
    return identifier;
  }

  readIdentifier() {
    const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(this.source.slice(this.offset));
    if (!match) return "";
    this.offset += match[0].length;
    return match[0];
  }

  readUntil(pattern) {
    const start = this.offset;
    while (!this.eof() && !pattern.test(this.peek())) {
      this.offset += 1;
    }
    return this.source.slice(start, this.offset);
  }

  consume(value) {
    this.skipTrivia();
    if (!this.startsWith(value)) return false;
    this.offset += value.length;
    this.skipTrivia();
    return true;
  }

  consumeTerminator() {
    this.skipInlineWhitespace();
    if (this.startsWith(";")) this.offset += 1;
    this.skipTrivia();
  }

  recoverStatement() {
    while (!this.eof() && !this.startsWith(";") && !this.startsWith("\n") && !this.startsWith("}")) {
      this.offset += 1;
    }
    this.consumeTerminator();
  }

  recoverToNext(keyword) {
    const next = this.source.indexOf(keyword, Math.max(this.offset, 1));
    this.offset = next === -1 ? this.source.length : next;
  }

  addDiagnostic(code, message, start, end) {
    this.diagnostics.push(createDiagnostic(this.sourceMap, {
      code,
      message,
      range: rangeFromOffsets(this.sourceMap, start, end),
    }));
  }

  skipTrivia() {
    let advanced = true;
    while (advanced) {
      const before = this.offset;
      this.skipInlineWhitespace();
      if (this.startsWith("\n") || this.startsWith("\r")) this.offset += this.startsWith("\r\n") ? 2 : 1;
      if (this.startsWith("#")) this.readUntil(/\n/);
      advanced = this.offset !== before;
    }
  }

  skipInlineWhitespace() {
    while (/[ \t]/.test(this.peek())) this.offset += 1;
  }

  startsWith(value) {
    return this.source.startsWith(value, this.offset);
  }

  peek() {
    return this.source[this.offset] ?? "";
  }

  eof() {
    return this.offset >= this.source.length;
  }
}

function parseInvocation(invocation) {
  const [beforeRecovery, recovery] = splitOnce(invocation, " recover ");
  const [beforeOutput, output] = splitOnce(beforeRecovery, " -> ");
  const reads = [];
  const writes = [];
  let call = beforeOutput.trim();

  call = call.replace(/\s+reads\s+\[([^\]]*)\]/, (_, value) => {
    reads.push(...splitList(value));
    return "";
  });
  call = call.replace(/\s+writes\s+\[([^\]]*)\]/, (_, value) => {
    writes.push(...splitList(value));
    return "";
  });

  const match = /^([A-Za-z_][A-Za-z0-9_.-]*)(?:\((.*)\))?$/.exec(call.trim());
  return {
    adapter: match?.[1] ?? call.trim(),
    args: parseArgs(match?.[2] ?? ""),
    output: output?.trim() || null,
    memoryReads: Object.freeze(reads),
    memoryWrites: Object.freeze(writes),
    recovery: recovery?.trim() || null,
  };
}

function parseArgs(rawArgs) {
  const args = {};
  for (const part of splitList(rawArgs)) {
    const [key, value] = splitOnce(part, ":");
    if (key) args[key.trim()] = parseLiteral(value?.trim() ?? "");
  }
  return Object.freeze(args);
}

function parseLiteral(value) {
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return stripQuotes(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function stripQuotes(value) {
  return String(value ?? "").replace(/^["']|["']$/g, "");
}

function splitList(value) {
  return String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

function splitOnce(value, delimiter) {
  const index = String(value).indexOf(delimiter);
  if (index === -1) return [String(value), null];
  return [String(value).slice(0, index), String(value).slice(index + delimiter.length)];
}

function freezeNode(node) {
  return Object.freeze(node);
}

function createDescriptorExportState(descriptor, handoff) {
  const hasExternalCapability = descriptor.capabilities.some((capability) => capability.boundary === "external");
  const hasAdapter = descriptor.steps.every((step) => Boolean(step.adapter));
  const hasVerifier = descriptor.verifier.contracts.length > 0;
  const hasTruth = descriptor.verifier.truthBoundaries.length > 0;
  const providerReady = !handoff.mailchimp?.detected || handoff.mailchimp.ready !== false;
  const restartReady = !handoff.mailchimp?.detected || handoff.mailchimp.syncContract?.restartSafe !== false;

  return Object.freeze({
    ready: hasAdapter && hasVerifier && hasTruth && providerReady && restartReady,
    acceptanceRequired: hasExternalCapability || handoff.sync.external,
    handoffMode: handoff.sync.mode,
    nextAction: !hasAdapter
      ? "select-runtime-adapter"
      : !hasVerifier
        ? "add-verifier-contract"
        : !hasTruth
          ? "add-truth-boundary"
          : !providerReady || !restartReady
            ? "complete-provider-contract"
          : "accept-export",
    providerSyncReady: restartReady,
  });
}

function createDescriptorLifecycleControls(descriptor, handoff, exportState, options = {}) {
  const requestedLifecycle = normalizeLifecycle(options.lifecycle ?? options.lifecycleSettings?.state);
  const requestedScheduling = normalizeScheduleMode(options.schedule ?? options.lifecycleSettings?.schedule);
  const mailchimp = handoff.mailchimp ?? { detected: false, missing: Object.freeze([]) };
  const acceptanceRequired = Boolean(exportState.acceptanceRequired);
  const providerContractReady = !mailchimp.detected || mailchimp.ready !== false;
  const providerSyncReady = !mailchimp.detected || mailchimp.syncContract?.restartSafe !== false;
  const compileReady = Boolean(exportState.ready);
  const canPreview = descriptor.steps.length > 0 && descriptor.capabilities.length > 0;
  const canAccept = compileReady && providerContractReady && providerSyncReady;
  const canEnable = canAccept && requestedLifecycle !== "disabled";
  const scheduleMode = requestedScheduling === "auto" && acceptanceRequired ? "onAcceptance" : requestedScheduling;
  const blockedReasons = lifecycleBlockedReasons({
    descriptor,
    exportState,
    mailchimp,
    requestedLifecycle,
    providerContractReady,
    providerSyncReady,
    canPreview,
  });
  const syncCommands = mailchimp.syncContract?.commandPlan ?? { enabled: Object.freeze([]), disabled: Object.freeze([]) };

  return Object.freeze({
    state: blockedReasons.length > 0
      ? "blocked"
      : canEnable
        ? requestedLifecycle
        : "review",
    settings: Object.freeze({
      requestedLifecycle,
      requestedScheduling,
      effectiveSchedule: scheduleMode,
      enabled: canEnable,
      acceptanceRequired,
    }),
    commandControls: Object.freeze({
      enabled: Object.freeze([
        canPreview ? "preview" : null,
        canAccept ? "acceptPreview" : null,
        canEnable ? "enableWorkflow" : null,
        canEnable && scheduleMode !== "manual" ? "scheduleWorkflow" : null,
        ...(syncCommands.enabled ?? []),
        "inspectProviderContract",
      ].filter(Boolean)),
      disabled: Object.freeze([
        canPreview ? null : "preview",
        canAccept ? null : "acceptPreview",
        canEnable ? null : "enableWorkflow",
        canEnable && scheduleMode !== "manual" ? null : "scheduleWorkflow",
        ...(syncCommands.disabled ?? []),
      ].filter(Boolean)),
    }),
    schedule: Object.freeze({
      mode: scheduleMode,
      queue: scheduleMode === "manual" ? "operator" : "aios-provider-handoff",
      reason: scheduleMode === "onAcceptance"
        ? "External provider workflows are queued only after preview acceptance."
        : scheduleMode === "disabled"
          ? "Scheduling is disabled by lifecycle settings."
          : "Workflow can be scheduled using current lifecycle settings.",
    }),
    nextAction: Object.freeze(createLifecycleNextAction(exportState, mailchimp, blockedReasons)),
    blockedReasons: Object.freeze(blockedReasons),
    provider: Object.freeze({
      mailchimp: mailchimp.detected
        ? Object.freeze({
            ready: mailchimp.ready !== false,
            operations: mailchimp.operations ?? Object.freeze([]),
            missing: mailchimp.missing ?? Object.freeze([]),
            syncContract: mailchimp.syncContract ?? null,
          })
        : null,
      contracts: handoff.providerContracts ?? Object.freeze([]),
    }),
  });
}

function lifecycleBlockedReasons(state) {
  const reasons = [];
  if (!state.canPreview) {
    reasons.push("Descriptor needs at least one capability and one executable step before preview.");
  }
  if (!state.exportState.ready && state.exportState.nextAction !== "complete-provider-contract") {
    reasons.push(`Descriptor export requires ${state.exportState.nextAction}.`);
  }
  if (!state.providerContractReady) {
    reasons.push(`Provider contract is missing: ${(state.mailchimp.missing ?? []).join(", ")}.`);
  }
  if (!state.providerSyncReady) {
    reasons.push("Mailchimp sync needs a persistent checkpoint and deterministic idempotency key before acceptance.");
  }
  if (state.requestedLifecycle === "disabled") {
    reasons.push("Workflow is disabled by lifecycle settings.");
  }
  return reasons;
}

function createMailchimpSyncExportState(descriptor) {
  const mailchimp = descriptor.handoff?.mailchimp ?? { detected: false };
  const syncContract = mailchimp.syncContract ?? null;

  if (!mailchimp.detected || !syncContract) {
    return Object.freeze({
      detected: false,
      ready: true,
      mode: "none",
      checkpoints: Object.freeze([]),
      commandPlan: null,
      recovery: null,
    });
  }

  return Object.freeze({
    detected: true,
    ready: Boolean(syncContract.restartSafe),
    mode: syncContract.mode,
    statefulOperations: syncContract.statefulOperations ?? Object.freeze([]),
    ledgerMemory: syncContract.ledgerMemory ?? Object.freeze([]),
    checkpoints: syncContract.checkpoints ?? Object.freeze([]),
    commandPlan: syncContract.commandPlan ?? null,
    recovery: syncContract.recovery ?? null,
  });
}

function createLifecycleNextAction(exportState, mailchimp, blockedReasons) {
  if (mailchimp.detected && mailchimp.ready === false) {
    return {
      id: "complete-mailchimp-contract",
      label: "Complete Mailchimp handoff contract",
      missing: mailchimp.missing ?? Object.freeze([]),
    };
  }
  if (blockedReasons.length > 0) {
    return {
      id: exportState.nextAction,
      label: labelForLifecycleAction(exportState.nextAction),
      missing: Object.freeze([]),
    };
  }
  if (exportState.acceptanceRequired) {
    return {
      id: "accept-provider-preview",
      label: "Accept external provider preview",
      missing: Object.freeze([]),
    };
  }
  return {
    id: "schedule-workflow",
    label: "Schedule workflow",
    missing: Object.freeze([]),
  };
}

function labelForLifecycleAction(action) {
  if (action === "select-runtime-adapter") return "Select runtime adapter";
  if (action === "add-verifier-contract") return "Add verifier contract";
  if (action === "add-truth-boundary") return "Add truth boundary";
  if (action === "complete-provider-contract") return "Complete provider contract";
  return "Inspect workflow lifecycle";
}

function normalizeLifecycle(value) {
  if (["draft", "review", "accepted", "enabled", "disabled"].includes(value)) return value;
  return "draft";
}

function normalizeScheduleMode(value) {
  if (["manual", "auto", "onAcceptance", "disabled"].includes(value)) return value;
  return "manual";
}

function freezeSortedRecord(record) {
  return Object.freeze(Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function stableRevision(ast, descriptors, namespace) {
  const payload = [
    namespace,
    ...(ast.jobs ?? []).map((job) => `${job.name}:${job.steps?.length ?? 0}:${job.verifiers?.length ?? 0}`),
    ...descriptors.map((descriptor) => descriptor.id),
  ].join("|");
  let hash = 0;
  for (let index = 0; index < payload.length; index += 1) {
    hash = (hash * 31 + payload.charCodeAt(index)) >>> 0;
  }
  return `aios-${hash.toString(16).padStart(8, "0")}`;
}
