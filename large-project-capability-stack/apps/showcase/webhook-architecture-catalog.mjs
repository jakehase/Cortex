export const WEBHOOK_SHOWCASE_VARIANTS = Object.freeze([
  { id: 'variant_01_layered_service', title: 'Layered service + repository', pattern: 'layered_service', layers: ['api', 'application', 'domain', 'repository'], scoreBias: 78, reviewWeight: 8, note: 'Classic layered separation with explicit service boundary.' },
  { id: 'variant_02_hexagonal_ports', title: 'Hexagonal ports/adapters', pattern: 'hexagonal_ports', layers: ['application', 'domain', 'ports', 'adapters'], scoreBias: 94, reviewWeight: 10, note: 'Business rules depend on ports, not infrastructure.' },
  { id: 'variant_03_cqrs_commands', title: 'CQRS commands + queries', pattern: 'cqrs', layers: ['commands', 'queries', 'domain', 'store'], scoreBias: 88, reviewWeight: 8, note: 'Write intent and read projections are separated.' },
  { id: 'variant_04_event_sourced', title: 'Event-sourced aggregate', pattern: 'event_sourced', layers: ['event_log', 'aggregate', 'projector', 'api'], scoreBias: 90, reviewWeight: 7, note: 'Append-only events drive state reconstruction and replay.' },
  { id: 'variant_05_functional_core', title: 'Functional core / imperative shell', pattern: 'functional_core', layers: ['pure_core', 'shell', 'store'], scoreBias: 91, reviewWeight: 9, note: 'Pure transitions are isolated from mutation and IO.' },
  { id: 'variant_06_actor_mailbox', title: 'Actor mailbox', pattern: 'actor_mailbox', layers: ['mailbox', 'actor', 'store'], scoreBias: 82, reviewWeight: 6, note: 'Commands flow through a mailbox-style actor facade.' },
  { id: 'variant_07_pipeline_plugins', title: 'Composable middleware pipeline', pattern: 'pipeline_plugins', layers: ['pipeline', 'plugins', 'store'], scoreBias: 86, reviewWeight: 7, note: 'Validation, idempotency, and persistence are pipeline stages.' },
  { id: 'variant_08_state_machine', title: 'Explicit lifecycle state machine', pattern: 'state_machine', layers: ['state_machine', 'application', 'store'], scoreBias: 92, reviewWeight: 9, note: 'Status transitions are centralized and auditable.' },
  { id: 'variant_09_clean_architecture', title: 'Clean architecture rings', pattern: 'clean_architecture', layers: ['entities', 'use_cases', 'interface_adapters', 'frameworks'], scoreBias: 93, reviewWeight: 9, note: 'Entities/use-cases are independent of adapters.' },
  { id: 'variant_10_vertical_slice', title: 'Vertical slice module', pattern: 'vertical_slice', layers: ['feature_slice', 'store'], scoreBias: 80, reviewWeight: 8, note: 'Everything for the feature is colocated for reviewability.' },
  { id: 'variant_11_modular_monolith', title: 'Modular monolith package', pattern: 'modular_monolith', layers: ['module_public_api', 'internal_domain', 'internal_store'], scoreBias: 84, reviewWeight: 7, note: 'Public module API hides internal pieces.' },
  { id: 'variant_12_repository_uow', title: 'Repository + unit of work', pattern: 'repository_uow', layers: ['service', 'repository', 'unit_of_work'], scoreBias: 83, reviewWeight: 7, note: 'Mutation groups are committed through a small unit-of-work seam.' },
  { id: 'variant_13_domain_events', title: 'Domain events + handlers', pattern: 'domain_events', layers: ['domain_events', 'handlers', 'store'], scoreBias: 87, reviewWeight: 8, note: 'Inbound webhook decisions emit internal domain events.' },
  { id: 'variant_14_onion_architecture', title: 'Onion architecture', pattern: 'onion', layers: ['domain_center', 'application_ring', 'adapter_ring'], scoreBias: 89, reviewWeight: 8, note: 'Dependencies point inward toward the domain center.' },
  { id: 'variant_15_table_driven', title: 'Table-driven lifecycle rules', pattern: 'table_driven', layers: ['rules_table', 'service', 'store'], scoreBias: 81, reviewWeight: 8, note: 'Behavior is driven by declarative lifecycle tables.' },
  { id: 'variant_16_command_bus', title: 'Command bus', pattern: 'command_bus', layers: ['bus', 'handlers', 'store'], scoreBias: 85, reviewWeight: 7, note: 'Receive/process/replay operations are explicit commands.' },
  { id: 'variant_17_outbox_inbox', title: 'Inbox + outbox replay boundary', pattern: 'outbox_inbox', layers: ['inbox', 'outbox', 'dispatcher', 'store'], scoreBias: 96, reviewWeight: 10, note: 'Inbound idempotency and outbound replay dispatch are cleanly separated.' },
  { id: 'variant_18_adapter_facade', title: 'Adapter facade', pattern: 'adapter_facade', layers: ['facade', 'adapters', 'store'], scoreBias: 79, reviewWeight: 7, note: 'A simple facade coordinates adapters for a small slice.' },
  { id: 'variant_19_policy_objects', title: 'Policy objects', pattern: 'policy_objects', layers: ['policies', 'application', 'store'], scoreBias: 86, reviewWeight: 8, note: 'Validation/idempotency/retry behavior are named policy objects.' },
  { id: 'variant_20_minimal_kernel', title: 'Minimal domain kernel', pattern: 'minimal_kernel', layers: ['kernel', 'api'], scoreBias: 76, reviewWeight: 9, note: 'The smallest possible reviewable kernel with explicit tradeoffs.' }
]);

export function variantById(id) {
  const found = WEBHOOK_SHOWCASE_VARIANTS.find((variant) => variant.id === id);
  if (!found) throw new Error(`Unknown webhook showcase variant: ${id}`);
  return found;
}

export function productRootForVariant(variant) {
  return `apps/webhook-showcase/${variant.id}`;
}

export function testPathForVariant(variant) {
  return `tests/webhook-showcase/${variant.id}.test.mjs`;
}

export function sourceFilesForVariant(variant) {
  const root = productRootForVariant(variant);
  const common = [`${root}/README.md`, `${root}/architecture.json`, `${root}/src/index.mjs`];
  const byPattern = {
    layered_service: ['src/domain.mjs', 'src/event-store.mjs', 'src/inbox-service.mjs'],
    hexagonal_ports: ['src/domain/webhook-event.mjs', 'src/application/webhook-inbox.mjs', 'src/ports/event-store-port.mjs', 'src/adapters/memory-event-store.mjs'],
    cqrs: ['src/domain.mjs', 'src/commands.mjs', 'src/queries.mjs', 'src/event-store.mjs'],
    event_sourced: ['src/event-log.mjs', 'src/aggregate.mjs', 'src/projector.mjs'],
    functional_core: ['src/core/reducer.mjs', 'src/core/decisions.mjs', 'src/shell/create-app.mjs'],
    actor_mailbox: ['src/mailbox.mjs', 'src/webhook-actor.mjs', 'src/store.mjs'],
    pipeline_plugins: ['src/pipeline.mjs', 'src/plugins.mjs', 'src/store.mjs'],
    state_machine: ['src/state-machine.mjs', 'src/repository.mjs', 'src/service.mjs'],
    clean_architecture: ['src/entities/webhook-event.mjs', 'src/use-cases/webhook-inbox.mjs', 'src/interface-adapters/memory-repository.mjs'],
    vertical_slice: ['src/webhook-inbox.slice.mjs', 'src/memory-state.mjs'],
    modular_monolith: ['src/public-api.mjs', 'src/internal/domain.mjs', 'src/internal/store.mjs'],
    repository_uow: ['src/repository.mjs', 'src/unit-of-work.mjs', 'src/service.mjs'],
    domain_events: ['src/domain-events.mjs', 'src/handlers.mjs', 'src/store.mjs'],
    onion: ['src/domain/event.mjs', 'src/application/service.mjs', 'src/adapters/repository.mjs'],
    table_driven: ['src/lifecycle-rules.mjs', 'src/service.mjs', 'src/store.mjs'],
    command_bus: ['src/command-bus.mjs', 'src/handlers.mjs', 'src/store.mjs'],
    outbox_inbox: ['src/inbox/inbox-service.mjs', 'src/outbox/replay-dispatcher.mjs', 'src/domain/event-lifecycle.mjs', 'src/adapters/memory-store.mjs'],
    adapter_facade: ['src/facade.mjs', 'src/adapters.mjs', 'src/store.mjs'],
    policy_objects: ['src/policies.mjs', 'src/service.mjs', 'src/store.mjs'],
    minimal_kernel: ['src/kernel.mjs']
  };
  return [...common, ...(byPattern[variant.pattern] || ['src/service.mjs']).map((rel) => `${root}/${rel}`)];
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

function appCode(variant) {
  return `const ARCHITECTURE = ${json({ id: variant.id, title: variant.title, pattern: variant.pattern, layers: variant.layers })};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now(clock) {
  return typeof clock === 'function' ? clock() : new Date().toISOString();
}

function assertEvent(input) {
  if (!input || typeof input !== 'object') throw new Error('webhook_event_required');
  if (!input.id || typeof input.id !== 'string') throw new Error('webhook_event_id_required');
  if (!input.type || typeof input.type !== 'string') throw new Error('webhook_event_type_required');
  return { id: input.id, type: input.type, payload: clone(input.payload || {}) };
}

function createMemoryStore() {
  const byId = new Map();
  const idempotency = new Map();
  const outbox = [];
  return {
    get: (id) => byId.get(id) || null,
    getByIdempotencyKey: (key) => idempotency.get(key) ? byId.get(idempotency.get(key)) || null : null,
    save(record) {
      byId.set(record.id, clone(record));
      idempotency.set(record.idempotencyKey, record.id);
      return clone(record);
    },
    list(filter = {}) {
      return [...byId.values()]
        .filter((record) => !filter.status || record.status === filter.status)
        .filter((record) => !filter.type || record.type === filter.type)
        .map(clone);
    },
    enqueueReplay(entry) { outbox.push(clone(entry)); },
    outbox: () => outbox.map(clone)
  };
}

function transition(record, status, at, detail = {}) {
  const next = { ...clone(record), status, updatedAt: at, history: [...(record.history || []), { status, at, ...detail }] };
  if (status === 'processed') next.processedAt = at;
  if (status === 'failed') next.failedAt = at;
  if (status === 'replayed') next.replayedAt = at;
  return next;
}

function makeRecord(event, { idempotencyKey, receivedAt }) {
  return {
    id: event.id,
    type: event.type,
    payload: event.payload,
    idempotencyKey,
    status: 'received',
    attempts: 0,
    receivedAt,
    updatedAt: receivedAt,
    history: [{ status: 'received', at: receivedAt }]
  };
}

export function createWebhookApp(options = {}) {
  const store = options.store || createMemoryStore();
  const clock = options.clock || (() => new Date().toISOString());
  return {
    architecture: ARCHITECTURE,
    receive(input, headers = {}) {
      const event = assertEvent(input);
      const idempotencyKey = String(headers['idempotency-key'] || headers.idempotencyKey || event.id);
      const existing = store.getByIdempotencyKey(idempotencyKey);
      if (existing) return { ...existing, duplicate: true };
      return store.save(makeRecord(event, { idempotencyKey, receivedAt: now(clock) }));
    },
    async processNext(handler = async () => ({ ok: true })) {
      const candidate = store.list({ status: 'received' })[0] || store.list({ status: 'failed' })[0] || null;
      if (!candidate) return null;
      const started = { ...candidate, attempts: Number(candidate.attempts || 0) + 1 };
      try {
        const outcome = await handler(clone(started));
        const processed = transition(started, 'processed', now(clock), { outcome: clone(outcome || { ok: true }) });
        return store.save(processed);
      } catch (error) {
        const failed = transition(started, 'failed', now(clock), { error: error.message || String(error) });
        failed.lastError = error.message || String(error);
        return store.save(failed);
      }
    },
    async replay(id, handler = async () => ({ ok: true })) {
      const current = store.get(id);
      if (!current) throw new Error('webhook_event_not_found');
      const replayStarted = transition({ ...current, attempts: Number(current.attempts || 0) + 1 }, 'replayed', now(clock), { replayOf: id });
      store.enqueueReplay({ id, at: replayStarted.updatedAt, type: current.type });
      try {
        const outcome = await handler(clone(replayStarted));
        const processed = transition(replayStarted, 'processed', now(clock), { replay: true, outcome: clone(outcome || { ok: true }) });
        return store.save(processed);
      } catch (error) {
        const failed = transition(replayStarted, 'failed', now(clock), { replay: true, error: error.message || String(error) });
        failed.lastError = error.message || String(error);
        return store.save(failed);
      }
    },
    get(id) { const record = store.get(id); return record ? clone(record) : null; },
    list(filter = {}) { return store.list(filter); },
    outbox() { return store.outbox(); },
    stats() {
      const all = store.list();
      return all.reduce((acc, record) => {
        acc.total += 1;
        acc.byStatus[record.status] = (acc.byStatus[record.status] || 0) + 1;
        acc.byType[record.type] = (acc.byType[record.type] || 0) + 1;
        return acc;
      }, { total: 0, byStatus: {}, byType: {} });
    }
  };
}
`;
}

function moduleCode(variant, rel) {
  const basename = rel.split('/').pop();
  if (basename === 'index.mjs') return appCode(variant);
  if (basename === 'architecture.json') return `${json({ id: variant.id, title: variant.title, pattern: variant.pattern, layers: variant.layers, decision: variant.note, reviewWeight: variant.reviewWeight })}\n`;
  if (basename === 'README.md') return `# ${variant.title}\n\nArchitecture candidate \`${variant.id}\` for the webhook event inbox + replay showcase.\n\nPattern: ${variant.pattern}\n\nLayers:\n${variant.layers.map((layer) => `- ${layer}`).join('\n')}\n\nDecision note: ${variant.note}\n`;
  return `// ${variant.title}\n// Layer module for ${variant.pattern}: ${rel}\nexport const moduleRole = ${JSON.stringify(rel)};\nexport const architectureVariant = ${JSON.stringify(variant.id)};\n`;
}

export function materializeVariantFiles(variant) {
  return Object.fromEntries(sourceFilesForVariant(variant).map((rel) => [rel, moduleCode(variant, rel)]));
}

export function materializeVariantTest(variant) {
  const root = productRootForVariant(variant);
  return `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createWebhookApp } from '../../${root}/src/index.mjs';\n\ntest('${variant.id} receives, dedupes, processes, fails, and replays webhook events', async () => {\n  let tick = 0;\n  const app = createWebhookApp({ clock: () => \`2026-06-14T00:00:0\${tick++}.000Z\` });\n  const first = app.receive({ id: 'evt_1', type: 'contact.created', payload: { email: 'a@example.com' } }, { 'idempotency-key': 'idem-1' });\n  const duplicate = app.receive({ id: 'evt_1b', type: 'contact.created', payload: { email: 'ignored@example.com' } }, { 'idempotency-key': 'idem-1' });\n  assert.equal(first.status, 'received');\n  assert.equal(duplicate.id, 'evt_1');\n  assert.equal(duplicate.duplicate, true);\n\n  const processed = await app.processNext(async (record) => ({ delivered: record.id }));\n  assert.equal(processed.status, 'processed');\n  assert.equal(processed.attempts, 1);\n  assert.equal(app.stats().byStatus.processed, 1);\n\n  app.receive({ id: 'evt_2', type: 'invoice.paid', payload: { amount: 42 } });\n  const failed = await app.processNext(async () => { throw new Error('downstream unavailable'); });\n  assert.equal(failed.status, 'failed');\n  assert.match(failed.lastError, /downstream/);\n\n  const replayed = await app.replay('evt_2', async (record) => ({ replayed: record.id }));\n  assert.equal(replayed.status, 'processed');\n  assert.equal(replayed.attempts, 2);\n  assert.equal(app.outbox().length, 1);\n  assert.equal(app.list({ type: 'invoice.paid' }).length, 1);\n  assert.equal(app.architecture.id, '${variant.id}');\n});\n`;
}

export function allowedFilesForVariant(variant) {
  return [...sourceFilesForVariant(variant), testPathForVariant(variant)];
}

export function scoreArchitecture({ variant, testOk = false, lintOk = false, metrics = {} }) {
  const fileCount = Number(metrics.fileCount || sourceFilesForVariant(variant).length);
  const layerCount = Number(metrics.layerCount || variant.layers.length);
  const lineCount = Number(metrics.lineCount || 0);
  const behavior = testOk ? 40 : 0;
  const verifier = lintOk ? 10 : 0;
  const layering = Math.min(18, layerCount * 3);
  const separation = Math.min(12, Math.max(0, fileCount - 2) * 1.5);
  const reviewability = lineCount > 0 ? Math.max(0, 12 - Math.max(0, Math.ceil((lineCount - 360) / 80))) : 8;
  const declared = Math.min(8, Math.max(0, variant.reviewWeight || 0));
  const bias = Math.min(10, Math.max(0, Math.round((variant.scoreBias - 70) / 3)));
  const rawTotal = Number((behavior + verifier + layering + separation + reviewability + declared + bias).toFixed(2));
  const total = Number(Math.min(100, rawTotal).toFixed(2));
  return {
    total,
    rawTotal,
    breakdown: { behavior, verifier, layering, separation, reviewability, declared, bias },
    rubric: '40 behavior + 10 verifier + 18 layering + 12 separation + 12 reviewability + 8 declared architectural intent + 10 bias for explicit fit to inbox/replay problem'
  };
}
