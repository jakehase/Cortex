import { createId, nowIso } from '../app/index.mjs';

function ensureJourneys(db) {
  db.transactionalJourneys ||= [];
  db.transactionalDeliveries ||= [];
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
    status: 'draft',
    createdBy: actor.user.id,
    sends: 0,
    lastTriggeredAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.db.transactionalJourneys.unshift(journey);
  return journey;
}

export function dispatchTransactionalJourney(state, actor, journey, body = {}) {
  ensureJourneys(state.db);
  const delivery = {
    id: createId('txsend'),
    workspaceId: actor.workspace.id,
    journeyId: journey.id,
    recipient: body.recipient || '',
    eventKey: body.eventKey || journey.trigger,
    payload: body.payload || '',
    channel: journey.channel,
    status: 'delivered',
    createdAt: nowIso()
  };
  state.db.transactionalDeliveries.unshift(delivery);
  journey.sends += 1;
  journey.lastTriggeredAt = delivery.createdAt;
  journey.updatedAt = delivery.createdAt;
  return delivery;
}

export function setJourneyStatus(journey, nextStatus = 'draft') {
  journey.status = ['draft', 'live', 'paused'].includes(nextStatus) ? nextStatus : 'draft';
  journey.updatedAt = nowIso();
  return journey;
}

export function summarizeTransactionalJourneys(state, workspaceId) {
  ensureJourneys(state.db);
  const journeys = state.db.transactionalJourneys.filter((entry) => entry.workspaceId === workspaceId);
  return {
    total: journeys.length,
    live: journeys.filter((entry) => entry.status === 'live').length,
    paused: journeys.filter((entry) => entry.status === 'paused').length,
    sends: journeys.reduce((sum, entry) => sum + entry.sends, 0)
  };
}
