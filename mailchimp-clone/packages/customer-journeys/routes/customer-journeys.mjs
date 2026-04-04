import { page, readBody, redirect, text, escapeHtml, saveDb, recordAudit } from '../../app/index.mjs';
import { createTransactionalJourney, dispatchTransactionalJourney, setJourneyStatus, summarizeTransactionalJourneys } from '../domain-customer-journeys.mjs';

export function registerCustomerJourneyRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/journeys/transactional', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    state.db.transactionalJourneys ||= [];
    const journeys = state.db.transactionalJourneys.filter((entry) => entry.workspaceId === actor.workspace.id);
    const summary = summarizeTransactionalJourneys(state, actor.workspace.id);
    text(res, 200, page('Transactional messaging', actor, `<div class="grid"><div class="card"><h3>Summary</h3><p>${summary.total} journeys · ${summary.live} live · ${summary.paused} paused · ${summary.sends} sends</p></div><div class="card"><h3>Create journey</h3><form method="post" action="/journeys/transactional"><input name="name" placeholder="Order confirmation" required><input name="trigger" placeholder="order_created"><select name="channel"><option value="email">email</option><option value="sms">sms</option></select><input name="template" placeholder="Order confirmation"><button>Create journey</button></form></div></div><div class="card"><table><tr><th>Name</th><th>Trigger</th><th>Status</th><th>Sends</th></tr>${journeys.map((journey) => `<tr><td><a href="/journeys/transactional/${journey.id}">${escapeHtml(journey.name)}</a></td><td>${escapeHtml(journey.trigger)}</td><td>${escapeHtml(journey.status)}</td><td>${journey.sends}</td></tr>`).join('') || '<tr><td colspan="4">No transactional journeys yet.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/journeys/transactional', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const journey = createTransactionalJourney(state, actor, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'transactional-journey-create', detail: `Created ${journey.name}` });
    redirect(res, `/journeys/transactional/${journey.id}`);
  });

  router.register('GET', '/journeys/transactional/:id', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const journey = (state.db.transactionalJourneys || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!journey) return text(res, 404, page('Transactional messaging', actor, '<div class="warn">Journey not found.</div>'));
    const deliveries = (state.db.transactionalDeliveries || []).filter((entry) => entry.journeyId === journey.id);
    text(res, 200, page('Transactional journey detail', actor, `<div class="grid"><div class="card"><h3>${escapeHtml(journey.name)}</h3><p>Trigger: ${escapeHtml(journey.trigger)} · Channel: ${escapeHtml(journey.channel)} · Status: ${escapeHtml(journey.status)}</p><form method="post" action="/journeys/transactional/${journey.id}/status"><select name="status"><option value="draft">draft</option><option value="live">live</option><option value="paused">paused</option></select><button>Update status</button></form></div><div class="card"><h3>Dispatch sample</h3><form method="post" action="/journeys/transactional/${journey.id}/dispatch"><input type="email" name="recipient" placeholder="customer@example.com" required><input name="eventKey" placeholder="order_created"><textarea name="payload" placeholder="{\"orderId\":\"123\"}"></textarea><button>Dispatch sample</button></form></div></div><div class="card"><h3>Delivery log</h3>${deliveries.map((delivery) => `<div style="padding:10px 0;border-bottom:1px solid #dde5f1"><strong>${escapeHtml(delivery.recipient)}</strong> · ${escapeHtml(delivery.eventKey)} · ${escapeHtml(delivery.status)}<div class="muted">${escapeHtml(delivery.createdAt)}</div></div>`).join('') || '<p>No deliveries yet.</p>'}</div>`));
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
}
