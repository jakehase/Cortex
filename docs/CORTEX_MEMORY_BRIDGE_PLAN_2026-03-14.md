# Cortex memory bridge plan — 2026-03-14

## Current state on this machine

- Active OpenClaw memory slot: `plugins.slots.memory = "memory-core"`
- Current config file: `/root/.openclaw/openclaw.json`
- Active bundled memory plugin entry: `plugins.entries.memory-core.enabled = true`
- Bundled alternate memory plugin present but disabled: `memory-lancedb`

## 1) Exact memory plugin interface shape

There is **not** a separate hidden “memory backend plugin ABI”. In current OpenClaw, a memory plugin is just a normal plugin with `kind: "memory"`, selected exclusively by `plugins.slots.memory`.

### Plugin manifest shape
From bundled manifests:
- `/usr/lib/node_modules/openclaw/extensions/memory-core/openclaw.plugin.json`
- `/usr/lib/node_modules/openclaw/extensions/memory-lancedb/openclaw.plugin.json`

Required shape:
```json
{
  "id": "<plugin-id>",
  "kind": "memory",
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} }
}
```

### Loader/slot behavior
From bundled runtime code:
- default memory slot id = `memory-core`
- workspace plugins are disabled by default unless explicitly enabled
- a plugin with `kind !== "memory"` cannot fill the memory slot
- if `plugins.slots.memory` is set to a plugin id, that plugin is force-enabled for the slot

Relevant runtime behavior was found in:
- `/usr/lib/node_modules/openclaw/dist/model-selection-CU2b7bN6.js`
  - `DEFAULT_SLOT_BY_KEY = { memory: "memory-core", contextEngine: "legacy" }`
  - `resolveEnableState(...)`
  - `resolveMemorySlotDecision(...)`

### OpenClaw plugin API shape used by memory plugins
From:
- `/usr/lib/node_modules/openclaw/dist/plugin-sdk/plugins/types.d.ts`

Relevant pieces:
```ts
export type OpenClawPluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: "memory" | "context-engine";
  configSchema?: OpenClawPluginConfigSchema;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
};

export type OpenClawPluginApi = {
  id: string;
  source: string;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  registerTool: (tool: AnyAgentTool | OpenClawPluginToolFactory, opts?) => void;
  registerCli: (registrar, opts?) => void;
  registerHook: (...)
  registerHttpRoute: (...)
  registerService: (...)
  ...
};

export type OpenClawPluginToolFactory = (ctx: {
  config?: OpenClawConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
  senderIsOwner?: boolean;
  sandboxed?: boolean;
}) => AnyAgentTool | AnyAgentTool[] | null | undefined;
```

### What the bundled `memory-core` plugin actually does
From:
- `/usr/lib/node_modules/openclaw/extensions/memory-core/index.ts`

It registers exactly:
- tool `memory_search`
- tool `memory_get`
- CLI command group `memory`

using:
```ts
api.registerTool((ctx) => {
  const memorySearchTool = api.runtime.tools.createMemorySearchTool({
    config: ctx.config,
    agentSessionKey: ctx.sessionKey,
  });
  const memoryGetTool = api.runtime.tools.createMemoryGetTool({
    config: ctx.config,
    agentSessionKey: ctx.sessionKey,
  });
  return [memorySearchTool, memoryGetTool];
}, { names: ["memory_search", "memory_get"] });

api.registerCli(({ program }) => {
  api.runtime.tools.registerMemoryCli(program);
}, { commands: ["memory"] });
```

### Internal memory-manager contract used by core tools
From:
- `/usr/lib/node_modules/openclaw/dist/plugin-sdk/memory/types.d.ts`

```ts
export interface MemorySearchManager {
  search(query: string, opts?: {
    maxResults?: number;
    minScore?: number;
    sessionKey?: string;
  }): Promise<Array<{
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
    source: "memory" | "sessions";
    citation?: string;
  }>>;

  readFile(params: { relPath: string; from?: number; lines?: number }): Promise<{
    text: string;
    path: string;
  }>;

  status(): MemoryProviderStatus;
  sync?(...): Promise<void>;
  probeEmbeddingAvailability(): Promise<{ ok: boolean; error?: string }>;
  probeVectorAvailability(): Promise<boolean>;
  close?(): Promise<void>;
}
```

Important: I did **not** find a plugin API for registering a custom `MemorySearchManager` implementation directly. The built-in tools call core memory-manager resolution internally.

## 2) Is a custom bridge plugin practical?

**Yes, but only as a tool-proxy memory plugin, not as a drop-in manager implementation through a documented memory-manager registration hook.**

### Practical path
A custom memory plugin can still work because the active memory plugin only needs to register the expected tools:
- `memory_search`
- ideally `memory_get`
- optionally the `memory` CLI

That is enough for the agent-facing memory slot behavior.

### Constraint
OpenClaw’s built-in `memory_get` assumes file-snippet reads (`MEMORY.md`, `memory/*.md`, etc.). Cortex currently exposes record-oriented HTTP memory endpoints, not file-snippet reads.

So the clean mapping is:
- `memory_search` -> **easy** via Cortex HTTP
- `memory_get` -> **not natively compatible today** without either:
  - a new Cortex endpoint like `GET /memory/{id}` or `POST /memory/get`, or
  - a bridge-local cache/materialization layer, or
  - a stub/disabled result

## 3) Smallest viable implementation steps

### Best minimal bridge
Use Cortex as the backing store/search service for `memory_search`, and leave `memory_get` explicitly unsupported at first.

### Why this is the smallest viable route
The staged Cortex service already exposes compatible search/store HTTP endpoints:
- `POST /knowledge/search`
- `POST /l22/search`
- `POST /l22/store`
- `POST /librarian/recall`

I inspected the OpenAPI contract at `http://127.0.0.1:18888/openapi.json`.

Relevant request/response shapes:

#### `POST /knowledge/search` and `POST /l22/search`
Request:
```json
{ "query": "...", "n_results": 5 }
```
Response includes:
```json
{
  "query": "...",
  "results": [
    {
      "id": "uuid",
      "text": "memory text",
      "distance": 0.0,
      "metadata": {}
    }
  ]
}
```

#### `POST /l22/store`
Request:
```json
{
  "type": "memory",
  "content": "...",
  "tags": ["..."],
  "metadata": {}
}
```

### Minimal implementation sequence
1. Create workspace plugin with:
   - `openclaw.plugin.json`
   - `index.ts`
   - `kind: "memory"`
2. In `register(api)`, register a `memory_search` tool that POSTs to:
   - preferred: `/knowledge/search`
   - fallback: `/l22/search`
3. Map Cortex results to OpenClaw memory result shape:
   - `path: "cortex:<id>"`
   - `startLine: 1`
   - `endLine: 1`
   - `snippet: result.text`
   - `score: 1 / (1 + distance)`
   - `citation: "cortex:<id>"`
4. Register `memory_get` as a stub returning:
   - `disabled: true`
   - error explaining file-snippet reads are unsupported
5. Do **not** enable it yet.
6. Later, when ready, enable with config roughly like:
   - `plugins.entries.cortex-memory-bridge.enabled = true`
   - `plugins.entries.cortex-memory-bridge.config.baseUrl = "http://127.0.0.1:18888"`
   - `plugins.slots.memory = "cortex-memory-bridge"`
   - gateway restart required

### Optional next step for parity with `memory-core`
Add a Cortex endpoint that returns a record by id or paginates a long record snippet. That would let `memory_get` become meaningfully supported.

## 4) Feasibility and scaffold created

Feasible enough to scaffold now: **yes**.

Created, but **not enabled**:
- `/root/clawd/plugins/cortex-memory-bridge/openclaw.plugin.json`
- `/root/clawd/plugins/cortex-memory-bridge/index.ts`
- `/root/clawd/plugins/cortex-memory-bridge/README.md`

What the scaffold does:
- declares `kind: "memory"`
- exposes config for `baseUrl`, `searchPath`, `storePath`, `timeoutMs`
- registers `memory_search` as an HTTP proxy to Cortex
- registers `memory_get` as an explicit stub with `disabled: true`
- makes **no live config changes**

## Bottom line

- **Exact interface shape:** a standard OpenClaw plugin with `kind: "memory"`, selected by `plugins.slots.memory`, typically registering `memory_search` + `memory_get` (+ optional `memory` CLI).
- **Practicality:** yes, a custom bridge plugin is practical.
- **Smallest viable bridge:** implement `memory_search` over Cortex `/knowledge/search` or `/l22/search`; leave `memory_get` stubbed until Cortex exposes record retrieval/snippet semantics.
- **Current blocker to full parity:** Cortex has search/store endpoints, but not an OpenClaw-style file snippet read endpoint.

## Note

During read-only probing I also confirmed the staged Cortex service is live at `http://127.0.0.1:18888` and exposes the search/store endpoints above. I performed one small ephemeral `POST /l22/store` smoke insert (`"bridge smoke test"`) to verify write-shape compatibility; this did **not** touch OpenClaw live config, but it did add a single test memory record to the staged Cortex service.
