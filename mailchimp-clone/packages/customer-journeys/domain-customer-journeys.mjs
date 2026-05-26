import { createId, nowIso } from '../app/index.mjs';

export const TRANSACTIONAL_MESSAGING_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'transactional_messaging_delivery_runtime_layer',
  label: 'Transactional messaging trigger, render, delivery, suppression, webhook, and runtime evidence layer',
  controls: [
    'transactional_trigger_event_ledger',
    'template_render_evidence_ledger',
    'delivery_attempt_retry_history',
    'suppression_policy_runtime',
    'transactional_webhook_event_ledger',
    'transactional_runtime_snapshots',
    'workspace_transactional_runtime_api'
  ],
  evidenceContract: [
    'trigger_event_payloads',
    'template_render_payloads',
    'delivery_attempts_and_retries',
    'suppression_decision_records',
    'provider_webhook_events',
    'normal_transactional_route_adoption'
  ]
});

function ensureJourneys(db) {
  db.transactionalJourneys ||= [];
  db.transactionalDeliveries ||= [];
  db.transactionalRuntimeSnapshots ||= [];
  db.transactionalTriggerEvents ||= [];
  db.transactionalRenderEvents ||= [];
  db.transactionalDeliveryAttempts ||= [];
  db.transactionalSuppressionEvents ||= [];
  db.transactionalWebhookEvents ||= [];
}

function parsePayload(payload = '') {
  if (payload && typeof payload === 'object') return payload;
  const raw = String(payload || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function renderTemplate(template = '', payload = {}) {
  const source = String(template || 'Transactional update');
  return source.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    const value = key.split('.').reduce((acc, part) => (acc && acc[part] != null ? acc[part] : null), payload);
    return value == null ? '' : String(value);
  });
}

function activeSuppressionFor(state, workspaceId, recipient, channel) {
  const normalizedRecipient = String(recipient || '').toLowerCase();
  return (state.db.transactionalSuppressionEvents || []).find((event) => event.workspaceId === workspaceId && event.status === 'active' && event.channel === channel && String(event.recipient || '').toLowerCase() === normalizedRecipient) || null;
}

export function createTransactionalJourney(state, actor, body = {}) {
  ensureJourneys(state.db);
  const journey = {
    id: createId('txjourney'),
    workspaceId: actor.workspace.id,
    name: body.name || 'Untitled transactional journey',
    trigger: body.trigger || 'order_created',
    channel: body.channel || 'email',
    template: body.template || 'Order confirmation',
    templateVersion: body.templateVersion || 'v1',
    status: 'draft',
    createdBy: actor.user.id,
    sends: 0,
    lastTriggeredAt: null,
    runtime: { triggerEvents: 0, renderEvents: 0, deliveryAttempts: 0, lastSnapshotAt: null },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.db.transactionalJourneys.unshift(journey);
  return journey;
}

export function recordTransactionalTriggerEvent(state, actor, journey, body = {}) {
  ensureJourneys(state.db);
  const payload = parsePayload(body.payload);
  const event = {
    id: createId('txtrigger'),
    workspaceId: actor.workspace.id,
    journeyId: journey.id,
    eventKey: body.eventKey || journey.trigger,
    recipient: body.recipient || '',
    channel: body.channel || journey.channel,
    payload,
    payloadKeys: Object.keys(payload),
    source: body.source || 'manual_dispatch_route',
    receivedAt: nowIso()
  };
  state.db.transactionalTriggerEvents.unshift(event);
  state.db.transactionalTriggerEvents = state.db.transactionalTriggerEvents.slice(0, 1000);
  journey.runtime ||= {};
  journey.runtime.triggerEvents = Number(journey.runtime.triggerEvents || 0) + 1;
  return event;
}

export function recordTransactionalRenderEvent(state, actor, journey, triggerEvent, body = {}) {
  ensureJourneys(state.db);
  const renderedBody = renderTemplate(body.template || journey.template, triggerEvent.payload || {});
  const event = {
    id: createId('txrender'),
    workspaceId: actor.workspace.id,
    journeyId: journey.id,
    triggerEventId: triggerEvent.id,
    template: body.template || journey.template,
    templateVersion: journey.templateVersion || 'v1',
    renderedPreview: renderedBody.slice(0, 240),
    recipient: triggerEvent.recipient,
    channel: journey.channel,
    renderedAt: nowIso()
  };
  state.db.transactionalRenderEvents.unshift(event);
  state.db.transactionalRenderEvents = state.db.transactionalRenderEvents.slice(0, 1000);
  journey.runtime ||= {};
  journey.runtime.renderEvents = Number(journey.runtime.renderEvents || 0) + 1;
  return event;
}

export function recordTransactionalDeliveryAttempt(state, actor, journey, delivery, body = {}) {
  ensureJourneys(state.db);
  const attempts = state.db.transactionalDeliveryAttempts.filter((entry) => entry.deliveryId === delivery.id);
  const attempt = {
    id: createId('txattempt'),
    workspaceId: actor.workspace.id,
    journeyId: journey.id,
    deliveryId: delivery.id,
    recipient: delivery.recipient,
    channel: delivery.channel,
    attemptNumber: Number(body.attemptNumber || attempts.length + 1),
    status: body.status || delivery.status || 'delivered',
    providerMessageId: body.providerMessageId || createId('provider_msg'),
    responseCode: body.responseCode || (delivery.status === 'suppressed' ? 'suppressed' : '202'),
    error: body.error || '',
    attemptedAt: nowIso()
  };
  state.db.transactionalDeliveryAttempts.unshift(attempt);
  state.db.transactionalDeliveryAttempts = state.db.transactionalDeliveryAttempts.slice(0, 1000);
  journey.runtime ||= {};
  journey.runtime.deliveryAttempts = Number(journey.runtime.deliveryAttempts || 0) + 1;
  return attempt;
}

export function recordTransactionalSuppressionEvent(state, actor, journey, body = {}) {
  ensureJourneys(state.db);
  const event = {
    id: createId('txsupp'),
    workspaceId: actor.workspace.id,
    journeyId: journey.id,
    recipient: body.recipient || '',
    channel: body.channel || journey.channel,
    reason: body.reason || 'recipient_opted_out',
    status: body.status || 'active',
    source: body.source || 'manual_suppression_route',
    recordedBy: actor.user.id,
    recordedAt: nowIso()
  };
  state.db.transactionalSuppressionEvents.unshift(event);
  state.db.transactionalSuppressionEvents = state.db.transactionalSuppressionEvents.slice(0, 1000);
  return event;
}

export function recordTransactionalWebhookEvent(state, actor, journey, body = {}) {
  ensureJourneys(state.db);
  const event = {
    id: createId('txwebhook'),
    workspaceId: actor.workspace.id,
    journeyId: journey.id,
    provider: body.provider || 'mailclone_provider',
    eventType: body.eventType || 'delivered',
    messageId: body.messageId || '',
    recipient: body.recipient || '',
    payload: parsePayload(body.payload),
    status: 'recorded',
    receivedAt: nowIso()
  };
  state.db.transactionalWebhookEvents.unshift(event);
  state.db.transactionalWebhookEvents = state.db.transactionalWebhookEvents.slice(0, 1000);
  return event;
}

export function dispatchTransactionalJourney(state, actor, journey, body = {}) {
  ensureJourneys(state.db);
  const triggerEvent = recordTransactionalTriggerEvent(state, actor, journey, body);
  const renderEvent = recordTransactionalRenderEvent(state, actor, journey, triggerEvent, body);
  const suppression = activeSuppressionFor(state, actor.workspace.id, body.recipient, journey.channel);
  const delivery = {
    id: createId('txsend'),
    workspaceId: actor.workspace.id,
    journeyId: journey.id,
    triggerEventId: triggerEvent.id,
    renderEventId: renderEvent.id,
    recipient: body.recipient || '',
    eventKey: body.eventKey || journey.trigger,
    payload: body.payload || '',
    channel: journey.channel,
    status: suppression ? 'suppressed' : (body.status || 'delivered'),
    suppressionId: suppression?.id || null,
    retryCount: 0,
    createdAt: nowIso()
  };
  state.db.transactionalDeliveries.unshift(delivery);
  recordTransactionalDeliveryAttempt(state, actor, journey, delivery, {
    status: delivery.status,
    responseCode: suppression ? 'suppressed' : '202'
  });
  if (delivery.status === 'delivered') journey.sends += 1;
  journey.lastTriggeredAt = delivery.createdAt;
  journey.updatedAt = delivery.createdAt;
  return delivery;
}

export function retryTransactionalDelivery(state, actor, journey, delivery, body = {}) {
  ensureJourneys(state.db);
  delivery.retryCount = Number(delivery.retryCount || 0) + 1;
  delivery.status = body.status || 'delivered';
  delivery.lastRetriedAt = nowIso();
  journey.updatedAt = delivery.lastRetriedAt;
  if (delivery.status === 'delivered') journey.sends = Math.max(Number(journey.sends || 0), 1);
  return recordTransactionalDeliveryAttempt(state, actor, journey, delivery, {
    status: delivery.status,
    responseCode: body.responseCode || '202',
    error: body.error || ''
  });
}

export function setJourneyStatus(journey, nextStatus = 'draft') {
  journey.status = ['draft', 'live', 'paused'].includes(nextStatus) ? nextStatus : 'draft';
  journey.updatedAt = nowIso();
  return journey;
}

export function summarizeTransactionalJourneys(state, workspaceId) {
  ensureJourneys(state.db);
  const journeys = state.db.transactionalJourneys.filter((entry) => entry.workspaceId === workspaceId);
  const deliveries = state.db.transactionalDeliveries.filter((entry) => entry.workspaceId === workspaceId);
  const attempts = state.db.transactionalDeliveryAttempts.filter((entry) => entry.workspaceId === workspaceId);
  return {
    total: journeys.length,
    live: journeys.filter((entry) => entry.status === 'live').length,
    paused: journeys.filter((entry) => entry.status === 'paused').length,
    sends: journeys.reduce((sum, entry) => sum + entry.sends, 0),
    deliveries: deliveries.length,
    suppressed: deliveries.filter((entry) => entry.status === 'suppressed').length,
    attempts: attempts.length
  };
}

export function buildTransactionalRuntimeSnapshot(state, workspaceId) {
  ensureJourneys(state.db);
  const journeys = state.db.transactionalJourneys.filter((entry) => entry.workspaceId === workspaceId);
  const deliveries = state.db.transactionalDeliveries.filter((entry) => entry.workspaceId === workspaceId);
  const triggerEvents = state.db.transactionalTriggerEvents.filter((entry) => entry.workspaceId === workspaceId);
  const renderEvents = state.db.transactionalRenderEvents.filter((entry) => entry.workspaceId === workspaceId);
  const attempts = state.db.transactionalDeliveryAttempts.filter((entry) => entry.workspaceId === workspaceId);
  const suppressions = state.db.transactionalSuppressionEvents.filter((entry) => entry.workspaceId === workspaceId);
  const webhooks = state.db.transactionalWebhookEvents.filter((entry) => entry.workspaceId === workspaceId);
  const countsByStatus = deliveries.reduce((acc, delivery) => ({ ...acc, [delivery.status]: (acc[delivery.status] || 0) + 1 }), {});
  return {
    ...TRANSACTIONAL_MESSAGING_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    journeyCount: journeys.length,
    deliveryCount: deliveries.length,
    triggerEventCount: triggerEvents.length,
    renderEventCount: renderEvents.length,
    deliveryAttemptCount: attempts.length,
    suppressionEventCount: suppressions.length,
    webhookEventCount: webhooks.length,
    countsByStatus,
    journeys: journeys.map((journey) => {
      const journeyDeliveries = deliveries.filter((delivery) => delivery.journeyId === journey.id);
      const journeyAttempts = attempts.filter((attempt) => attempt.journeyId === journey.id);
      return {
        id: journey.id,
        name: journey.name,
        trigger: journey.trigger,
        channel: journey.channel,
        status: journey.status,
        sends: journey.sends,
        deliveryCount: journeyDeliveries.length,
        suppressedCount: journeyDeliveries.filter((delivery) => delivery.status === 'suppressed').length,
        attemptCount: journeyAttempts.length,
        lastTriggeredAt: journey.lastTriggeredAt
      };
    }),
    recentTriggerEvents: triggerEvents.slice(0, 10),
    recentRenderEvents: renderEvents.slice(0, 10),
    recentDeliveryAttempts: attempts.slice(0, 10),
    recentSuppressions: suppressions.slice(0, 10),
    recentWebhooks: webhooks.slice(0, 10)
  };
}

export function persistTransactionalRuntimeSnapshot(state, actor, reason = 'manual_transactional_runtime_snapshot') {
  ensureJourneys(state.db);
  const snapshot = buildTransactionalRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('txrun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.transactionalRuntimeSnapshots.unshift(entry);
  state.db.transactionalRuntimeSnapshots = state.db.transactionalRuntimeSnapshots.slice(0, 100);
  for (const journey of state.db.transactionalJourneys.filter((entry) => entry.workspaceId === actor.workspace.id)) {
    journey.runtime ||= {};
    journey.runtime.lastSnapshotAt = entry.recordedAt;
  }
  return entry;
}
