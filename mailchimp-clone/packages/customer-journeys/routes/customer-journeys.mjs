import { page, readBody, redirect, text, json, escapeHtml, saveDb, recordAudit } from '../../app/index.mjs';
import {
  buildTransactionalRuntimeSnapshot,
  createTransactionalJourney,
  dispatchTransactionalJourney,
  persistTransactionalRuntimeSnapshot,
  recordTransactionalSuppressionEvent,
  recordTransactionalWebhookEvent,
  retryTransactionalDelivery,
  setJourneyStatus,
  summarizeTransactionalJourneys
} from '../domain-customer-journeys.mjs';

export function registerCustomerJourneyRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/journeys/transactional', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    state.db.transactionalJourneys ||= [];
    const journeys = state.db.transactionalJourneys.filter((entry) => entry.workspaceId === actor.workspace.id);
    const summary = summarizeTransactionalJourneys(state, actor.workspace.id);
    const runtime = buildTransactionalRuntimeSnapshot(state, actor.workspace.id);
    text(res, 200, page('Transactional messaging', actor, `<div class="grid"><div class="card"><h3>Summary</h3><p>${summary.total} journeys · ${summary.live} live · ${summary.paused} paused · ${summary.sends} sends</p><p>${summary.deliveries} deliveries · ${summary.attempts} attempts · ${summary.suppressed} suppressed</p></div><div class="card"><h3>Runtime evidence</h3><p>${runtime.triggerEventCount} triggers · ${runtime.renderEventCount} renders · ${runtime.deliveryAttemptCount} delivery attempts</p><p>${runtime.suppressionEventCount} suppressions · ${runtime.webhookEventCount} webhooks</p><form method="post" action="/journeys/transactional/runtime/snapshot"><button>Capture transactional runtime snapshot</button></form><p><a href="/api/journeys/transactional/runtime">Open transactional runtime API</a></p></div><div class="card"><h3>Create journey</h3><form method="post" action="/journeys/transactional"><input name="name" placeholder="Order confirmation" required><input name="trigger" placeholder="order_created"><select name="channel"><option value="email">email</option><option value="sms">sms</option></select><input name="template" placeholder="Order {{orderId}} confirmation"><button>Create journey</button></form></div></div><div class="card"><table><tr><th>Name</th><th>Trigger</th><th>Status</th><th>Sends</th></tr>${journeys.map((journey) => `<tr><td><a href="/journeys/transactional/${journey.id}">${escapeHtml(journey.name)}</a></td><td>${escapeHtml(journey.trigger)}</td><td>${escapeHtml(journey.status)}</td><td>${journey.sends}</td></tr>`).join('') || '<tr><td colspan="4">No transactional journeys yet.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/journeys/transactional', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const journey = createTransactionalJourney(state, actor, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'transactional-journey-create', detail: `Created ${journey.name}` });
    redirect(res, `/journeys/transactional/${journey.id}`);
  });

  router.register('POST', '/journeys/transactional/runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    persistTransactionalRuntimeSnapshot(state, actor, 'manual_route_snapshot');
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'transactional-runtime-snapshot', detail: 'Captured transactional runtime snapshot' });
    redirect(res, '/journeys/transactional');
  });

  router.register('GET', '/api/journeys/transactional/runtime', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    json(res, 200, { ok: true, transactionalRuntime: buildTransactionalRuntimeSnapshot(state, actor.workspace.id) });
  });

  router.register('GET', '/journeys/transactional/:id', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const journey = (state.db.transactionalJourneys || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!journey) return text(res, 404, page('Transactional messaging', actor, '<div class="warn">Journey not found.</div>'));
    const deliveries = (state.db.transactionalDeliveries || []).filter((entry) => entry.journeyId === journey.id);
    const attempts = (state.db.transactionalDeliveryAttempts || []).filter((entry) => entry.journeyId === journey.id);
    text(res, 200, page('Transactional journey detail', actor, `<div class="grid"><div class="card"><h3>${escapeHtml(journey.name)}</h3><p>Trigger: ${escapeHtml(journey.trigger)} · Channel: ${escapeHtml(journey.channel)} · Status: ${escapeHtml(journey.status)}</p><p>${attempts.length} delivery attempts · ${(state.db.transactionalTriggerEvents || []).filter((entry) => entry.journeyId === journey.id).length} trigger events</p><form method="post" action="/journeys/transactional/${journey.id}/status"><select name="status"><option value="draft">draft</option><option value="live">live</option><option value="paused">paused</option></select><button>Update status</button></form></div><div class="card"><h3>Dispatch sample</h3><form method="post" action="/journeys/transactional/${journey.id}/dispatch"><input type="email" name="recipient" placeholder="customer@example.com" required><input name="eventKey" placeholder="order_created"><textarea name="payload" placeholder='{"orderId":"123"}'></textarea><button>Dispatch sample</button></form></div><div class="card"><h3>Runtime operations</h3><form method="post" action="/journeys/transactional/${journey.id}/suppression"><input type="email" name="recipient" placeholder="customer@example.com" required><input name="reason" value="recipient_opted_out"><button>Record suppression</button></form><form method="post" action="/journeys/transactional/${journey.id}/webhook"><input name="provider" value="mailclone_provider"><input name="eventType" value="delivered"><input name="messageId" placeholder="provider message id"><input type="email" name="recipient" placeholder="customer@example.com"><textarea name="payload" placeholder='{"status":"delivered"}'></textarea><button>Record webhook</button></form></div></div><div class="card"><h3>Delivery log</h3>${deliveries.map((delivery) => `<div style="padding:10px 0;border-bottom:1px solid #dde5f1"><strong>${escapeHtml(delivery.recipient)}</strong> · ${escapeHtml(delivery.eventKey)} · ${escapeHtml(delivery.status)} · retries ${delivery.retryCount || 0}<div class="muted">${escapeHtml(delivery.createdAt)}</div><form method="post" action="/journeys/transactional/${journey.id}/deliveries/${delivery.id}/retry"><button>Retry delivery</button></form></div>`).join('') || '<p>No deliveries yet.</p>'}</div>`));
  });

  router.register('POST', '/journeys/transactional/:id/dispatch', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const journey = (state.db.transactionalJourneys || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!journey) return text(res, 404, page('Transactional messaging', actor, '<div class="warn">Journey not found.</div>'));
    const delivery = dispatchTransactionalJourney(state, actor, journey, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'transactional-journey-dispatch', detail: `Dispatched ${journey.name} to ${delivery.recipient}` });
    redirect(res, `/journeys/transactional/${journey.id}`);
  });

  router.register('POST', '/journeys/transactional/:id/status', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const journey = (state.db.transactionalJourneys || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!journey) return text(res, 404, page('Transactional messaging', actor, '<div class="warn">Journey not found.</div>'));
    setJourneyStatus(journey, (await readBody(req)).status);
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'transactional-journey-status', detail: `Updated ${journey.name} to ${journey.status}` });
    redirect(res, `/journeys/transactional/${journey.id}`);
  });

  router.register('POST', '/journeys/transactional/:id/suppression', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const journey = (state.db.transactionalJourneys || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!journey) return text(res, 404, page('Transactional messaging', actor, '<div class="warn">Journey not found.</div>'));
    const event = recordTransactionalSuppressionEvent(state, actor, journey, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'transactional-suppression-record', detail: `Recorded suppression ${event.id} for ${journey.name}` });
    redirect(res, `/journeys/transactional/${journey.id}`);
  });

  router.register('POST', '/journeys/transactional/:id/webhook', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const journey = (state.db.transactionalJourneys || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!journey) return text(res, 404, page('Transactional messaging', actor, '<div class="warn">Journey not found.</div>'));
    const event = recordTransactionalWebhookEvent(state, actor, journey, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'transactional-webhook-record', detail: `Recorded ${event.eventType} webhook for ${journey.name}` });
    redirect(res, `/journeys/transactional/${journey.id}`);
  });

  router.register('POST', '/journeys/transactional/:id/deliveries/:deliveryId/retry', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const journey = (state.db.transactionalJourneys || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!journey) return text(res, 404, page('Transactional messaging', actor, '<div class="warn">Journey not found.</div>'));
    const delivery = (state.db.transactionalDeliveries || []).find((entry) => entry.id === params.deliveryId && entry.workspaceId === actor.workspace.id && entry.journeyId === journey.id);
    if (!delivery) return text(res, 404, page('Transactional messaging', actor, '<div class="warn">Delivery not found.</div>'));
    const attempt = retryTransactionalDelivery(state, actor, journey, delivery, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'transactional-delivery-retry', detail: `Retried ${journey.name} delivery attempt ${attempt.attemptNumber}` });
    redirect(res, `/journeys/transactional/${journey.id}`);
  });
}
