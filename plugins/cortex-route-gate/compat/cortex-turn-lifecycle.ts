export const CORTEX_TURN_LIFECYCLE_CONTRACT = 'cortex.openclaw.turn.v1' as const;

export type CortexLifecycleHookName =
  | 'subagent_spawning'
  | 'subagent_spawned'
  | 'before_prompt_build'
  | 'after_compaction'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'tool_result_persist'
  | 'before_agent_finalize'
  | 'llm_output'
  | 'message_sending'
  | 'message_sent'
  | 'agent_end';

export type CortexTurnPhase =
  | 'preparing'
  | 'prompted'
  | 'tooling'
  | 'output_observed'
  | 'finalizing'
  | 'delivering'
  | 'agent_ended'
  | 'completed'
  | 'failed'
  | 'stale';

export interface CortexTurnLifecycleSnapshot {
  contract: typeof CORTEX_TURN_LIFECYCLE_CONTRACT;
  turnKey: string;
  phase: CortexTurnPhase;
  sequence: number;
  events: CortexLifecycleHookName[];
  toolDepth: number;
  observed: {
    prompt: boolean;
    subagentSpawn: boolean;
    subagentSpawned: boolean;
    compaction: boolean;
    toolCall: boolean;
    toolResult: boolean;
    persistedToolResult: boolean;
    output: boolean;
    finalization: boolean;
    deliveryStart: boolean;
    deliveryComplete: boolean;
    agentEnd: boolean;
  };
  handlerCompletions: number;
  success: boolean | null;
  anomalies: string[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface MutableTurnState extends CortexTurnLifecycleSnapshot {
  updatedAtMs: number;
}

export interface CortexTurnLifecycleToken {
  turnKey: string;
  sequence: number;
}

export interface CortexTurnDispatch {
  context: Record<string, unknown>;
  token: CortexTurnLifecycleToken;
}

const START_EVENTS = new Set<CortexLifecycleHookName>([
  'before_prompt_build',
]);

function iso(now: number): string {
  return new Date(now).toISOString();
}

function cloneSnapshot(state: MutableTurnState): CortexTurnLifecycleSnapshot {
  return {
    contract: state.contract,
    turnKey: state.turnKey,
    phase: state.phase,
    sequence: state.sequence,
    events: [...state.events],
    toolDepth: state.toolDepth,
    observed: { ...state.observed },
    handlerCompletions: state.handlerCompletions,
    success: state.success,
    anomalies: [...state.anomalies],
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt,
  };
}

function turnIdentity(context: Record<string, unknown>, event: unknown): string {
  const eventRecord = event && typeof event === 'object'
    ? event as Record<string, unknown>
    : {};
  const runId = String(context.runId || eventRecord.runId || '').trim();
  const sessionKey = String(
    context.sessionKey || context.sessionId || eventRecord.sessionKey || eventRecord.sessionId || '',
  ).trim();
  const agentId = String(context.agentId || eventRecord.agentId || 'unknown-agent').trim();
  if (sessionKey) return `session:${sessionKey}`;
  if (runId) return `run:${runId}`;
  return `agent:${agentId}`;
}

function uniquePush(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

export class CortexTurnLifecycleController {
  readonly contract = CORTEX_TURN_LIFECYCLE_CONTRACT;
  private readonly active = new Map<string, MutableTurnState>();
  private readonly completed: CortexTurnLifecycleSnapshot[] = [];
  private readonly maxCompleted: number;
  private readonly staleAfterMs: number;

  constructor(maxCompleted = 128, staleAfterMs = 30 * 60 * 1000) {
    this.maxCompleted = maxCompleted;
    this.staleAfterMs = staleAfterMs;
  }

  begin(
    hook: CortexLifecycleHookName,
    event: unknown,
    rawContext: unknown,
  ): CortexTurnDispatch {
    const now = Date.now();
    this.prune(now);
    const context = rawContext && typeof rawContext === 'object'
      ? rawContext as Record<string, unknown>
      : {};
    const turnKey = turnIdentity(context, event);
    let state = this.active.get(turnKey);

    if (!state || (START_EVENTS.has(hook) && state.observed.agentEnd)) {
      if (state) this.completeState(state, state.observed.deliveryComplete ? 'completed' : 'stale', now);
      state = this.createState(turnKey, now);
      this.active.set(turnKey, state);
    }

    this.observe(state, hook, event, now);
    return {
      context: {
        ...context,
        cortexTurn: cloneSnapshot(state),
      },
      token: {
        turnKey,
        sequence: state.sequence,
      },
    };
  }

  finish(token: CortexTurnLifecycleToken, hook: CortexLifecycleHookName): void {
    const state = this.active.get(token.turnKey);
    if (!state || state.sequence < token.sequence) return;
    const now = Date.now();
    state.handlerCompletions += 1;
    state.updatedAtMs = now;
    state.updatedAt = iso(now);

    if (hook === 'message_sent') {
      this.completeState(state, 'completed', now);
      return;
    }
    if (hook === 'agent_end' && !state.observed.deliveryStart) {
      this.completeState(state, 'completed', now);
    }
  }

  fail(token: CortexTurnLifecycleToken, hook: CortexLifecycleHookName, error: unknown): void {
    const state = this.active.get(token.turnKey);
    if (!state) return;
    const now = Date.now();
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    uniquePush(state.anomalies, `handler_error:${hook}:${message.slice(0, 160)}`);
    this.completeState(state, 'failed', now);
  }

  getActiveCount(): number {
    return this.active.size;
  }

  getCompletedCount(): number {
    return this.completed.length;
  }

  getLatestCompleted(): CortexTurnLifecycleSnapshot | null {
    const latest = this.completed.at(-1);
    return latest ? { ...latest, events: [...latest.events], observed: { ...latest.observed }, anomalies: [...latest.anomalies] } : null;
  }

  reset(): void {
    this.active.clear();
    this.completed.length = 0;
  }

  private createState(turnKey: string, now: number): MutableTurnState {
    const timestamp = iso(now);
    return {
      contract: CORTEX_TURN_LIFECYCLE_CONTRACT,
      turnKey,
      phase: 'preparing',
      sequence: 0,
      events: [],
      toolDepth: 0,
      observed: {
        prompt: false,
        subagentSpawn: false,
        subagentSpawned: false,
        compaction: false,
        toolCall: false,
        toolResult: false,
        persistedToolResult: false,
        output: false,
        finalization: false,
        deliveryStart: false,
        deliveryComplete: false,
        agentEnd: false,
      },
      handlerCompletions: 0,
      success: null,
      anomalies: [],
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      updatedAtMs: now,
    };
  }

  private observe(
    state: MutableTurnState,
    hook: CortexLifecycleHookName,
    event: unknown,
    now: number,
  ): void {
    if (state.observed.agentEnd && hook !== 'message_sent') {
      uniquePush(state.anomalies, `event_after_agent_end:${hook}`);
    }

    state.sequence += 1;
    state.events.push(hook);
    state.updatedAtMs = now;
    state.updatedAt = iso(now);

    switch (hook) {
      case 'subagent_spawning':
        state.observed.subagentSpawn = true;
        state.phase = 'tooling';
        break;
      case 'subagent_spawned':
        state.observed.subagentSpawned = true;
        state.phase = 'tooling';
        break;
      case 'before_prompt_build':
        state.observed.prompt = true;
        state.phase = 'prompted';
        break;
      case 'after_compaction':
        state.observed.compaction = true;
        break;
      case 'before_tool_call':
        state.observed.toolCall = true;
        state.toolDepth += 1;
        state.phase = 'tooling';
        break;
      case 'after_tool_call':
        state.observed.toolResult = true;
        if (state.toolDepth === 0) uniquePush(state.anomalies, 'unmatched_after_tool_call');
        state.toolDepth = Math.max(0, state.toolDepth - 1);
        state.phase = 'tooling';
        break;
      case 'tool_result_persist':
        state.observed.persistedToolResult = true;
        break;
      case 'llm_output':
        state.observed.output = true;
        state.phase = 'output_observed';
        break;
      case 'before_agent_finalize':
        state.observed.finalization = true;
        state.phase = 'finalizing';
        break;
      case 'message_sending':
        state.observed.deliveryStart = true;
        state.phase = 'delivering';
        break;
      case 'message_sent':
        state.observed.deliveryComplete = true;
        state.phase = 'completed';
        break;
      case 'agent_end': {
        state.observed.agentEnd = true;
        state.phase = 'agent_ended';
        const success = event && typeof event === 'object'
          ? (event as Record<string, unknown>).success
          : undefined;
        state.success = typeof success === 'boolean' ? success : null;
        if (state.toolDepth !== 0) uniquePush(state.anomalies, `agent_end_with_tool_depth:${state.toolDepth}`);
        break;
      }
    }
  }

  private completeState(state: MutableTurnState, phase: 'completed' | 'failed' | 'stale', now: number): void {
    state.phase = phase;
    state.updatedAtMs = now;
    state.updatedAt = iso(now);
    state.completedAt = iso(now);
    this.active.delete(state.turnKey);
    this.completed.push(cloneSnapshot(state));
    while (this.completed.length > this.maxCompleted) this.completed.shift();
  }

  private prune(now: number): void {
    for (const state of this.active.values()) {
      if (now - state.updatedAtMs > this.staleAfterMs) {
        uniquePush(state.anomalies, 'stale_turn_pruned');
        this.completeState(state, 'stale', now);
      }
    }
  }
}

export const cortexTurnLifecycle = new CortexTurnLifecycleController();
