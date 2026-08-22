const FIXTURE_PROTOCOL = "aios.testing.mailchimp-operator-fixture.v1";

export const MAILCHIMP_OPERATOR_FIXTURE_SOURCE = Object.freeze({
  operatorId: "operator.mailchimp.preview",
  provider: "mailchimp",
  queue: "mailchimp.campaign.review",
  states: [
    { name: "queued", nextAction: "open_preview", terminal: false },
    { name: "preview_ready", nextAction: "approve_or_repair", terminal: false },
    { name: "operator_review_required", nextAction: "repair_descriptor", terminal: false },
    { name: "approved", nextAction: "resume_runtime", terminal: false },
    { name: "completed", nextAction: "archive_receipt", terminal: true }
  ],
  commands: [
    { name: "open_preview", from: "queued", to: "preview_ready", requiresEvidence: false },
    { name: "approve_campaign", from: "preview_ready", to: "approved", requiresEvidence: true },
    { name: "repair_descriptor", from: "operator_review_required", to: "preview_ready", requiresEvidence: true },
    { name: "resume_runtime", from: "approved", to: "completed", requiresEvidence: true }
  ],
  recovery: {
    adapterFailureStatus: "operator_review_required",
    retryCommand: "repair_descriptor",
    maxAttempts: 2
  }
});

function compact(value) {
  return String(value ?? "").trim();
}

function issue(code, severity, field, message) {
  return { code: compact(code), severity: compact(severity), field: compact(field), message: compact(message) };
}

function normalizeOperatorSource(source) {
  return {
    ...source,
    operatorId: compact(source.operatorId),
    provider: compact(source.provider || "mailchimp"),
    queue: compact(source.queue || "mailchimp.campaign.review"),
    states: Array.isArray(source.states) ? source.states : [],
    commands: Array.isArray(source.commands) ? source.commands : [],
    recovery: source.recovery || {}
  };
}

function compileStates(source) {
  return source.states.map((state) => ({
    name: compact(state.name),
    nextAction: compact(state.nextAction),
    terminal: state.terminal === true,
    statusHandoffVisible: state.terminal !== true
  }));
}

function compileCommands(source) {
  const states = new Set(source.states.map((state) => compact(state.name)));

  return source.commands.map((command) => ({
    name: compact(command.name),
    provider: source.provider,
    from: compact(command.from),
    to: compact(command.to),
    requiresEvidence: command.requiresEvidence === true,
    validTransition: states.has(compact(command.from)) && states.has(compact(command.to)),
    adapterResume: compact(command.name) === "resume_runtime",
    emitsStatusHandoff: true
  }));
}

function buildOperatorStatusMatrix(states, commands, recovery) {
  return states.map((state) => {
    const availableCommands = commands.filter((command) => command.from === state.name);
    const recoveryCommand = state.name === recovery.adapterFailureStatus ? compact(recovery.retryCommand) : "";

    return {
      state: state.name,
      terminal: state.terminal,
      nextAction: state.nextAction,
      visibleToOperator: state.statusHandoffVisible,
      availableCommands: availableCommands.map((command) => command.name).sort(),
      recoveryCommand,
      adapterResumeAllowed: availableCommands.some((command) => command.adapterResume)
    };
  });
}

function validateOperatorContract(contract) {
  const issues = [];
  const states = new Set(contract.states.map((state) => state.name));
  const invalidTransitions = contract.commands.filter((command) => !command.validTransition).map((command) => command.name);
  const resumeCommand = contract.commands.find((command) => command.adapterResume);
  const recoveryState = contract.statusMatrix.find((entry) => entry.state === contract.recovery.adapterFailureStatus);

  if (contract.provider !== "mailchimp") issues.push(issue("mailchimp.operator.provider_mismatch", "error", "provider", "Operator must target Mailchimp."));
  if (!states.has("operator_review_required")) issues.push(issue("mailchimp.operator.missing_review_state", "error", "states", "Adapter failure review state is required."));
  if (invalidTransitions.length) issues.push(issue("mailchimp.operator.invalid_transition", "error", "commands", `Invalid command transition: ${invalidTransitions.join(",")}.`));
  if (!resumeCommand?.requiresEvidence) issues.push(issue("mailchimp.operator.resume_evidence_missing", "error", "commands.resume_runtime", "Runtime resume must require verifier/operator evidence."));
  if (!recoveryState?.recoveryCommand) issues.push(issue("mailchimp.operator.recovery_command_missing", "error", "recovery", "Adapter failure state must expose a recovery command."));

  return {
    ok: issues.every((entry) => entry.severity !== "error"),
    issues,
    summary: {
      states: [...states].sort(),
      commands: contract.commands.map((command) => command.name).sort(),
      recoveryState: contract.recovery.adapterFailureStatus,
      resumeCommand: resumeCommand?.name || null
    }
  };
}

export function buildMailchimpOperatorFixture(source = MAILCHIMP_OPERATOR_FIXTURE_SOURCE) {
  const normalized = normalizeOperatorSource(source);
  const states = compileStates(normalized);
  const commands = compileCommands(normalized);
  const recovery = {
    adapterFailureStatus: compact(normalized.recovery.adapterFailureStatus || "operator_review_required"),
    retryCommand: compact(normalized.recovery.retryCommand || "repair_descriptor"),
    maxAttempts: Number.isFinite(normalized.recovery.maxAttempts) ? normalized.recovery.maxAttempts : 2,
    requiresStatusHandoff: true
  };
  const statusMatrix = buildOperatorStatusMatrix(states, commands, recovery);
  const contract = {
    kind: "aios.operatorContract",
    protocol: FIXTURE_PROTOCOL,
    operatorId: normalized.operatorId,
    provider: normalized.provider,
    queue: normalized.queue,
    states,
    commands,
    recovery,
    statusMatrix
  };
  const validation = validateOperatorContract(contract);

  return {
    kind: "aios.testing.mailchimpOperatorFixture",
    protocol: FIXTURE_PROTOCOL,
    source: normalized,
    contract,
    validation,
    expected: {
      reviewState: recovery.adapterFailureStatus,
      retryCommand: recovery.retryCommand,
      resumeCommands: commands.filter((command) => command.adapterResume).map((command) => command.name),
      operatorVisibleStates: statusMatrix.filter((entry) => entry.visibleToOperator).map((entry) => entry.state)
    }
  };
}

export function assertMailchimpOperatorFixture(fixture = buildMailchimpOperatorFixture()) {
  return {
    ok: fixture.validation.ok
      && fixture.contract.kind === "aios.operatorContract"
      && fixture.expected.reviewState === "operator_review_required"
      && fixture.expected.retryCommand === "repair_descriptor"
      && fixture.expected.resumeCommands.includes("resume_runtime"),
    issueCodes: fixture.validation.issues.map((entry) => entry.code),
    statusMatrix: fixture.contract.statusMatrix,
    summary: fixture.validation.summary
  };
}

export const MAILCHIMP_OPERATOR_FIXTURE_PROTOCOL = FIXTURE_PROTOCOL;
