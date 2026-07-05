export function parseBoundaryBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'required'].includes(String(value).trim().toLowerCase());
}

function asString(value, fallback = null) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function inferWorkerRuntimeKind(command = '') {
  const text = String(command || '').trim();
  if (!text) return 'unconfigured_worker';
  if (/codex-creative-worker\.mjs(?:\s|$)/.test(text)) return 'codex_cli_via_creative_wrapper';
  if (/(?:^|\s)codex(?:\s|$)/.test(text) || /\/codex(?:\s|$)/.test(text)) return 'raw_codex_cli';
  if (/live-transfer-worker\.mjs(?:\s|$)/.test(text)) return 'transfer_worker_wrapper';
  return 'custom_worker_command';
}

function inferClaimLabel({ workerRuntimeKind, cortexRequired, cortexPacketPresent, budgetRequired, budgetLedgerPath }) {
  if (workerRuntimeKind === 'codex_cli_via_creative_wrapper' && cortexRequired && cortexPacketPresent && budgetRequired && budgetLedgerPath) {
    return 'cortex_context_governed_codex_product_worker';
  }
  if (workerRuntimeKind === 'codex_cli_via_creative_wrapper' && cortexRequired && !cortexPacketPresent) {
    return 'cortex_required_codex_worker_blocked_without_packet';
  }
  if (workerRuntimeKind === 'codex_cli_via_creative_wrapper' && cortexPacketPresent) {
    return 'cortex_context_supplied_codex_product_worker';
  }
  if (workerRuntimeKind === 'codex_cli_via_creative_wrapper') return 'codex_product_worker_wrapper';
  if (workerRuntimeKind === 'raw_codex_cli') return 'raw_codex_cli_execution';
  return workerRuntimeKind;
}

export function buildCortexCodexBoundary({
  env = process.env,
  contract = null,
  task = null,
  cortexPacket = null,
  workerCommand = null,
  cortexPacketPath = null,
  budgetLedgerPath = null,
  codexBin = null,
  codexModel = null,
  codexSandbox = null,
  promptMode = null,
  meteringPlan = null
} = {}) {
  const scope = contract?.scope || {};
  const creativePolicy = scope.creativeProductWork || task?.contextPack?.inputs?.creativeProductWork || task?.creativeProductWork || {};
  const resolvedWorkerCommand = asString(workerCommand, asString(env.CREATIVE_WORKER_COMMAND, asString(creativePolicy.workerCommand, null)));
  const resolvedCortexPacketPath = asString(cortexPacketPath, asString(env.CREATIVE_WORKER_CORTEX_PACKET_PATH, asString(env.CORTEX_CONTEXT_PACKET_PATH, asString(task?.cortexContextPacketPath, null))));
  const resolvedBudgetLedgerPath = asString(budgetLedgerPath, asString(env.CREATIVE_WORKER_BUDGET_LEDGER_PATH, asString(creativePolicy.budgetLedgerPath, asString(task?.budgetLedgerPath, null))));
  const cortexRequired = parseBoundaryBool(env.CREATIVE_WORKER_CORTEX_REQUIRED ?? env.CORTEX_REQUIRED, false);
  const budgetRequired = parseBoundaryBool(env.CREATIVE_WORKER_BUDGET_REQUIRED, false);
  const cortexPacketPresent = Boolean(cortexPacket && typeof cortexPacket === 'object');
  const workerRuntimeKind = inferWorkerRuntimeKind(resolvedWorkerCommand || '');
  const contextGovernor = task?.contextPack?.contextGovernor || cortexPacket?.contextGovernor || scope.contextGovernor || null;
  const modelTierPlan = task?.contextPack?.modelTierPlan || cortexPacket?.modelTierPlan || scope.modelTierPlan || null;
  const retrievalManifest = task?.contextPack?.retrievalManifest || cortexPacket?.retrievalManifest || null;
  const route = asString(cortexPacket?.cortexRoute, asString(cortexPacket?.route, asString(env.CREATIVE_WORKER_CORTEX_ROUTE, null)));
  const effectivePromptMode = asString(promptMode, asString(env.CREATIVE_WORKER_PROMPT_MODE, asString(env.CODEX_CREATIVE_PROMPT_MODE, task?.promptMode || null)));
  const claimLabel = inferClaimLabel({ workerRuntimeKind, cortexRequired, cortexPacketPresent, budgetRequired, budgetLedgerPath: resolvedBudgetLedgerPath });
  const warnings = [];
  if (workerRuntimeKind === 'raw_codex_cli') warnings.push('raw_codex_cli_has_no_creative_wrapper_boundary');
  if (cortexRequired && !cortexPacketPresent) warnings.push('cortex_required_but_packet_missing');
  if (budgetRequired && !resolvedBudgetLedgerPath) warnings.push('budget_required_but_ledger_missing');
  if (!budgetRequired) warnings.push('budget_not_fail_closed');

  return {
    schemaVersion: 'claw.cortex_codex_boundary.v1',
    generatedAt: new Date().toISOString(),
    behaviorChanging: false,
    claimLabel,
    boundaryStatement: 'Cortex is the control-plane/context/truth layer; Codex is the execution-plane CLI/model worker for bounded product edits. Credit Codex model work only when provider/ledger evidence exists; credit Cortex assistance only when a Cortex packet/context governor is present.',
    cortex: {
      role: 'control_plane_context_routing_memory_truth_supervision',
      required: cortexRequired,
      packetPresent: cortexPacketPresent,
      packetPath: resolvedCortexPacketPath,
      route,
      source: asString(cortexPacket?.source, asString(env.CREATIVE_WORKER_CORTEX_SOURCE, null)),
      contextGovernorPresent: Boolean(contextGovernor),
      contextGovernorMode: contextGovernor?.mode || null,
      modelTierPlanPresent: Boolean(modelTierPlan),
      retrievalManifestPresent: Boolean(retrievalManifest)
    },
    codex: {
      role: 'execution_plane_cli_model_worker',
      workerRuntimeKind,
      workerCommand: resolvedWorkerCommand,
      bin: asString(codexBin, asString(env.CODEX_BIN, null)),
      model: asString(codexModel, asString(env.CODEX_CREATIVE_MODEL, asString(env.CODEX_MODEL, null))),
      sandbox: asString(codexSandbox, asString(env.CODEX_CREATIVE_SANDBOX, null)),
      promptMode: effectivePromptMode
    },
    governors: {
      budgetRequired,
      budgetLedgerPath: resolvedBudgetLedgerPath,
      globalCallLimit: asString(env.CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT, null),
      globalTokenLimit: asString(env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT, null),
      tokenBudgetMode: asString(env.CREATIVE_WORKER_TOKEN_BUDGET_MODE, meteringPlan?.tokenBudgetMode || null),
      tokenReservationEstimate: asString(env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE, null),
      perWorkerCallLimit: asString(env.CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT, null),
      maxActiveCodexCalls: asString(env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS, null),
      activeCodexCallSchedule: asString(env.CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE, null),
      meteringMode: meteringPlan?.mode || asString(env.CREATIVE_WORKER_METERING_MODE, null)
    },
    honestyRules: [
      'Do not call a run Cortex-agent work solely because the chat/control plane used Cortex.',
      'Do not call a worker Cortex-governed unless a Cortex packet/context governor was supplied to the worker.',
      'Do not call a run real Codex/model work unless provider calls, runtime, and token/message evidence support it.',
      'Do not let deterministic verifier sleep count as model coding time.',
      'Token/call governors are safety and cost controls; cleanup must not remove or weaken them.'
    ],
    warnings
  };
}
