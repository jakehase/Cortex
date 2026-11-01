import {
  CORTEX_TURN_LIFECYCLE_CONTRACT,
  cortexTurnLifecycle,
  type CortexLifecycleHookName,
} from './cortex-turn-lifecycle.ts';

export const CORTEX_OPENCLAW_COMPATIBILITY = Object.freeze({
  schemaVersion: 'cortex.openclaw.compat.v1',
  adapterVersion: '1.3.0',
  turnLifecycleContract: CORTEX_TURN_LIFECYCLE_CONTRACT,
  testedOpenClaw: Object.freeze({
    version: '2026.7.1-2',
    revision: '0790d9f',
  }),
  requiredHooks: Object.freeze([
    'subagent_spawning',
    'subagent_spawned',
    'before_prompt_build',
    'after_compaction',
    'before_tool_call',
    'after_tool_call',
    'tool_result_persist',
    'before_agent_finalize',
    'llm_output',
    'message_sending',
    'message_sent',
    'agent_end',
  ]),
});

type OpenClawHookApi = {
  on: (hook: string, handler: (event: any, context: any) => any) => void;
  logger?: { info?: (message: string) => void };
};

type CortexLifecycleHandlers = {
  subagentSpawning: (event: any, context: any) => any;
  subagentSpawned: (event: any, context: any) => any;
  beforePromptBuild: (event: any, context: any) => any;
  afterCompaction: (event: any, context: any) => any;
  beforeToolCall: (event: any, context: any) => any;
  afterToolCall: (event: any, context: any) => any;
  toolResultPersist: (event: any, context: any) => any;
  beforeAgentFinalize: (event: any, context: any) => any;
  llmOutput: (event: any, context: any) => any;
  messageSending: (event: any, context: any) => any;
  messageSent: (event: any, context: any) => any;
  agentEnd: (event: any, context: any) => any;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function normalizeContext(context: unknown, event: unknown = {}) {
  const source = record(context);
  const eventSource = record(event);
  const contextRunId = String(source.runId || '').trim();
  const eventRunId = String(eventSource.runId || '').trim();
  if (contextRunId && eventRunId && contextRunId !== eventRunId) {
    throw new Error('cortex-openclaw compatibility failure: event/context runId mismatch');
  }
  const sessionKey = String(
    source.sessionKey || source.sessionId || eventSource.sessionKey || eventSource.sessionId || '',
  );
  return {
    ...source,
    runId: contextRunId || eventRunId || undefined,
    sessionKey,
    sessionId: String(source.sessionId || eventSource.sessionId || sessionKey),
    channelId: String(source.channelId || source.messageChannel || eventSource.channelId || ''),
    accountId: String(source.accountId || eventSource.accountId || 'default'),
  };
}

function normalizePromptEvent(event: unknown) {
  const source = record(event);
  return {
    ...source,
    prompt: typeof source.prompt === 'string' ? source.prompt : '',
    messages: Array.isArray(source.messages) ? source.messages : [],
  };
}

function normalizeCompactionEvent(event: unknown) {
  const source = record(event);
  return {
    ...source,
    sessionFile: typeof source.sessionFile === 'string' ? source.sessionFile : '',
  };
}

function normalizeToolEvent(event: unknown) {
  const source = record(event);
  return {
    ...source,
    toolName: String(source.toolName || ''),
    toolCallId: typeof source.toolCallId === 'string' ? source.toolCallId : undefined,
    durationMs: typeof source.durationMs === 'number' ? source.durationMs : undefined,
  };
}

function normalizeFinalizeEvent(event: unknown) {
  const source = record(event);
  const lastAssistantMessage = typeof source.lastAssistantMessage === 'string'
    ? source.lastAssistantMessage
    : '';
  const messages = Array.isArray(source.messages)
    ? source.messages
    : lastAssistantMessage
      ? [{ role: 'assistant', content: lastAssistantMessage }]
      : [];
  return {
    ...source,
    stopHookActive: source.stopHookActive === true,
    lastAssistantMessage,
    messages,
  };
}

function normalizeModelOutputEvent(event: unknown) {
  const source = record(event);
  return {
    ...source,
    assistantTexts: Array.isArray(source.assistantTexts)
      ? source.assistantTexts.filter((value: unknown) => typeof value === 'string')
      : [],
  };
}

function normalizeDeliveryEvent(event: unknown) {
  const source = record(event);
  return {
    ...source,
    to: String(source.to || ''),
    content: typeof source.content === 'string' ? source.content : '',
  };
}

function normalizeAgentEndEvent(event: unknown) {
  const source = record(event);
  return {
    ...source,
    success: source.success === true,
  };
}

function projectHookResult(hookName: CortexLifecycleHookName, value: any) {
  if (hookName !== 'before_agent_finalize' || !value || typeof value !== 'object') return value;
  const source = record(value);
  if (source.action !== 'revise') return value;
  const legacyInstruction = typeof source.additionalSystemPrompt === 'string'
    ? source.additionalSystemPrompt
    : '';
  const existingRetry = record(source.retry);
  const instruction = typeof existingRetry.instruction === 'string'
    ? existingRetry.instruction
    : legacyInstruction || String(source.reason || 'Revise the answer before finalization.');
  return {
    action: 'revise',
    reason: typeof source.reason === 'string' ? source.reason : instruction,
    retry: {
      instruction,
      idempotencyKey: typeof existingRetry.idempotencyKey === 'string'
        ? existingRetry.idempotencyKey
        : typeof source.idempotencyKey === 'string' ? source.idempotencyKey : undefined,
      maxAttempts: typeof existingRetry.maxAttempts === 'number'
        ? existingRetry.maxAttempts
        : typeof source.maxAttempts === 'number' ? source.maxAttempts : undefined,
    },
  };
}

const HOOK_BINDINGS = Object.freeze([
  ['subagent_spawning', 'subagentSpawning', record],
  ['subagent_spawned', 'subagentSpawned', record],
  ['before_prompt_build', 'beforePromptBuild', normalizePromptEvent],
  ['after_compaction', 'afterCompaction', normalizeCompactionEvent],
  ['before_tool_call', 'beforeToolCall', normalizeToolEvent],
  ['after_tool_call', 'afterToolCall', normalizeToolEvent],
  ['tool_result_persist', 'toolResultPersist', record],
  ['before_agent_finalize', 'beforeAgentFinalize', normalizeFinalizeEvent],
  ['llm_output', 'llmOutput', normalizeModelOutputEvent],
  ['message_sending', 'messageSending', normalizeDeliveryEvent],
  ['message_sent', 'messageSent', record],
  ['agent_end', 'agentEnd', normalizeAgentEndEvent],
] as const);

export function registerCortexLifecycleHooks(api: OpenClawHookApi, handlers: CortexLifecycleHandlers) {
  if (!api || typeof api.on !== 'function') {
    throw new Error('cortex-openclaw compatibility failure: plugin API does not expose hook registration');
  }
  for (const [hookName, handlerName, normalizeEvent] of HOOK_BINDINGS) {
    const handler = handlers[handlerName];
    if (typeof handler !== 'function') {
      throw new Error(`cortex-openclaw compatibility failure: missing lifecycle handler ${handlerName}`);
    }
    api.on(hookName, (event: any, context: any) => {
      const normalizedEvent = normalizeEvent(event);
      const dispatch = cortexTurnLifecycle.begin(
        hookName as CortexLifecycleHookName,
        normalizedEvent,
        normalizeContext(context, normalizedEvent),
      );
      try {
        const result = handler(normalizedEvent, dispatch.context);
        if (result && typeof result.then === 'function') {
          return result.then(
            (value: any) => {
              cortexTurnLifecycle.finish(dispatch.token, hookName as CortexLifecycleHookName, value);
              return projectHookResult(hookName as CortexLifecycleHookName, value);
            },
            (error: unknown) => {
              cortexTurnLifecycle.fail(dispatch.token, hookName as CortexLifecycleHookName, error);
              throw error;
            },
          );
        }
        cortexTurnLifecycle.finish(dispatch.token, hookName as CortexLifecycleHookName, result);
        return projectHookResult(hookName as CortexLifecycleHookName, result);
      } catch (error) {
        cortexTurnLifecycle.fail(dispatch.token, hookName as CortexLifecycleHookName, error);
        throw error;
      }
    });
  }
  api.logger?.info?.(
    `cortex-route-gate: registered ${CORTEX_OPENCLAW_COMPATIBILITY.schemaVersion}` +
    ` adapter=${CORTEX_OPENCLAW_COMPATIBILITY.adapterVersion}` +
    ` tested_openclaw=${CORTEX_OPENCLAW_COMPATIBILITY.testedOpenClaw.version}`,
  );
  return CORTEX_OPENCLAW_COMPATIBILITY;
}

export function cortexOpenClawCompatibilityMetadata() {
  return CORTEX_OPENCLAW_COMPATIBILITY;
}
