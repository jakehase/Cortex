import { page, readBody, redirect, text, json, escapeHtml, saveDb, recordAudit } from '../../app/index.mjs';
import {
  buildMobileRuntimeSnapshot,
  createMobileSession,
  mobileSessionActions,
  mobileWorkspaceSummary,
  persistMobileRuntimeSnapshot,
  queueMobileAction,
  recordMobileDeviceTrustEvent,
  recordMobileNotificationEvent,
  registerMobilePushToken,
  resolveMobileActionConflict,
  syncMobileSession
} from '../domain-mobile-app.mjs';

function sessionTable(sessions = []) {
  return `<table><tr><th>Device</th><th>Platform</th><th>Status</th><th>Trust</th><th>Last sync</th></tr>${sessions.map((session) => `<tr><td><a href="/mobile-app/sessions/${session.id}">${escapeHtml(session.deviceName)}</a></td><td>${escapeHtml(session.platform)}</td><td>${escapeHtml(session.status)}</td><td>${escapeHtml(session.trustStatus || 'trusted')} · risk ${Number(session.riskScore || 0)}</td><td>${escapeHtml(session.lastSyncSummary || 'No mobile sync yet')}</td></tr>`).join('') || '<tr><td colspan="5">No mobile devices paired yet.</td></tr>'}</table>`;
}

function actionTimeline(actions = []) {
  return actions.map((action) => `<div style="padding:10px 0;border-bottom:1px solid #dde5f1"><strong>${escapeHtml(action.kind)}</strong> · ${escapeHtml(action.status)} · ${escapeHtml(action.target)} · conflict ${escapeHtml(action.conflictStatus || 'none')}<pre>${escapeHtml(JSON.stringify(action.payload || {}, null, 2))}</pre><div class="muted">queued ${escapeHtml(action.createdAt)}${action.syncedAt ? ` · synced ${escapeHtml(action.syncedAt)}` : ''}</div></div>`).join('') || '<p>No mobile actions yet.</p>';
}

export function registerMobileAppRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/mobile-app', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    state.db.mobileAppSessions ||= [];
    const summary = mobileWorkspaceSummary(state, actor.workspace.id);
    const runtime = buildMobileRuntimeSnapshot(state, actor.workspace.id);
    const sessions = state.db.mobileAppSessions.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Mobile app command center', actor, `<div class="hero"><span class="eyebrow">MOBILE APP</span><h2>Run campaigns, inbox, surveys, and transactional updates from the phone workflow.</h2><p>The mobile companion keeps quick actions, offline queues, push readiness, and cross-channel work tied to the same workspace data as the desktop app.</p></div><div class="grid"><div class="card"><h3>Mobile workspace snapshot</h3><p>${summary.campaigns} campaigns · ${summary.contacts} contacts · ${summary.openConversations} open inbox threads</p><p>${summary.transactionalLive} live transactional journeys · ${summary.surveys} survey programs</p><p>${summary.activeDevices} active devices · ${summary.pushEnabledDevices} push-enabled · ${summary.queuedActions} queued mobile actions · ${summary.syncedActions} synced actions</p></div><div class="card"><h3>Mobile runtime</h3><p>${runtime.trustEventCount} trust events · ${runtime.syncBatchCount} sync batches · ${runtime.conflictResolutionCount} conflicts resolved</p><p>${runtime.notificationEventCount} notification events · ${runtime.pushRegistrationCount} push registrations</p><form method="post" action="/mobile-app/runtime/snapshot"><button>Capture mobile runtime snapshot</button></form><p><a href="/api/mobile-app/runtime">Open mobile runtime API</a></p></div><div class="card"><h3>Pair mobile device</h3><form method="post" action="/mobile-app/sessions"><input name="deviceName" placeholder="Jake's iPhone" required><select name="platform"><option value="ios">ios</option><option value="android">android</option><option value="tablet">tablet</option></select><label><input type="checkbox" name="pushOptIn"> Enable push notifications</label><input name="pushToken" placeholder="push token"><button>Pair device</button></form></div><div class="card"><h3>Quick actions</h3><ul>${summary.quickActions.map((action) => `<li><a href="${action.href}">${escapeHtml(action.label)}</a></li>`).join('')}</ul></div></div><div class="card"><h3>Connected devices</h3>${sessionTable(sessions)}</div>`));
  });

  router.register('POST', '/mobile-app/sessions', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const session = createMobileSession(state, actor, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mobile-session-create', detail: `Paired mobile device ${session.deviceName}` });
    redirect(res, `/mobile-app/sessions/${session.id}`);
  });

  router.register('POST', '/mobile-app/runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    persistMobileRuntimeSnapshot(state, actor, 'manual_route_snapshot');
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mobile-runtime-snapshot', detail: 'Captured mobile app runtime snapshot' });
    redirect(res, '/mobile-app');
  });

  router.register('GET', '/api/mobile-app/runtime', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    json(res, 200, { ok: true, mobileRuntime: buildMobileRuntimeSnapshot(state, actor.workspace.id) });
  });

  router.register('GET', '/mobile-app/sessions/:id', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const session = (state.db.mobileAppSessions || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!session) return text(res, 404, page('Mobile app command center', actor, '<div class="warn">Mobile session not found.</div>'));
    const actions = mobileSessionActions(state, session.id);
    text(res, 200, page('Mobile app session', actor, `<div class="grid"><div class="card"><h3>${escapeHtml(session.deviceName)}</h3><p>Platform: ${escapeHtml(session.platform)} · Status: ${escapeHtml(session.status)} · Push: ${session.pushOptIn ? 'enabled' : 'disabled'}</p><p>Trust: ${escapeHtml(session.trustStatus || 'trusted')} · risk ${Number(session.riskScore || 0)}</p><p>${escapeHtml(session.lastSyncSummary || 'No mobile sync yet')}</p><form method="post" action="/mobile-app/sessions/${session.id}/sync"><button>Sync mobile queue</button></form></div><div class="card"><h3>Queue offline action</h3><form method="post" action="/mobile-app/sessions/${session.id}/actions"><select name="kind"><option value="campaign_draft">campaign_draft</option><option value="inbox_reply">inbox_reply</option><option value="survey_snapshot">survey_snapshot</option><option value="transactional_dispatch">transactional_dispatch</option></select><input name="target" placeholder="campaign or customer target"><textarea name="payload" placeholder='{"note":"Draft from phone"}'></textarea><button>Queue action</button></form></div><div class="card"><h3>Runtime controls</h3><form method="post" action="/mobile-app/sessions/${session.id}/push"><input name="token" placeholder="push token" required><input name="provider" value="mailclone_push"><button>Register push token</button></form><form method="post" action="/mobile-app/sessions/${session.id}/trust"><select name="trustStatus"><option value="trusted">trusted</option><option value="review_required">review_required</option><option value="blocked">blocked</option></select><input name="reason" value="operator_review"><button>Record trust event</button></form><form method="post" action="/mobile-app/sessions/${session.id}/conflicts"><input name="target" placeholder="contact or campaign"><select name="strategy"><option value="server_wins">server_wins</option><option value="client_wins">client_wins</option><option value="merge_fields">merge_fields</option></select><textarea name="payload" placeholder='{"field":"value"}'></textarea><button>Resolve conflict</button></form><form method="post" action="/mobile-app/sessions/${session.id}/notifications"><input name="notificationType" value="sync_complete"><input name="title" value="Mobile sync ready"><textarea name="body">Your mobile queue is up to date.</textarea><button>Queue notification event</button></form></div></div><div class="card"><h3>Offline action timeline</h3>${actionTimeline(actions)}</div>`));
  });

  router.register('POST', '/mobile-app/sessions/:id/actions', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const session = (state.db.mobileAppSessions || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!session) return text(res, 404, page('Mobile app command center', actor, '<div class="warn">Mobile session not found.</div>'));
    const action = queueMobileAction(state, actor, session, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mobile-action-queue', detail: `Queued ${action.kind} for ${session.deviceName}` });
    redirect(res, `/mobile-app/sessions/${session.id}`);
  });

  router.register('POST', '/mobile-app/sessions/:id/push', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const session = (state.db.mobileAppSessions || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!session) return text(res, 404, page('Mobile app command center', actor, '<div class="warn">Mobile session not found.</div>'));
    const registration = registerMobilePushToken(state, actor, session, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mobile-push-register', detail: `Registered push token ${registration.id} for ${session.deviceName}` });
    redirect(res, `/mobile-app/sessions/${session.id}`);
  });

  router.register('POST', '/mobile-app/sessions/:id/trust', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const session = (state.db.mobileAppSessions || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!session) return text(res, 404, page('Mobile app command center', actor, '<div class="warn">Mobile session not found.</div>'));
    const event = recordMobileDeviceTrustEvent(state, actor, session, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mobile-device-trust', detail: `Recorded ${event.trustStatus} trust event for ${session.deviceName}` });
    redirect(res, `/mobile-app/sessions/${session.id}`);
  });

  router.register('POST', '/mobile-app/sessions/:id/conflicts', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const session = (state.db.mobileAppSessions || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!session) return text(res, 404, page('Mobile app command center', actor, '<div class="warn">Mobile session not found.</div>'));
    const resolution = resolveMobileActionConflict(state, actor, session, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mobile-conflict-resolve', detail: `Resolved mobile conflict ${resolution.id} for ${session.deviceName}` });
    redirect(res, `/mobile-app/sessions/${session.id}`);
  });

  router.register('POST', '/mobile-app/sessions/:id/notifications', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const session = (state.db.mobileAppSessions || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!session) return text(res, 404, page('Mobile app command center', actor, '<div class="warn">Mobile session not found.</div>'));
    const event = recordMobileNotificationEvent(state, actor, session, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mobile-notification-event', detail: `Queued mobile notification ${event.id} for ${session.deviceName}` });
    redirect(res, `/mobile-app/sessions/${session.id}`);
  });

  router.register('POST', '/mobile-app/sessions/:id/sync', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const session = (state.db.mobileAppSessions || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!session) return text(res, 404, page('Mobile app command center', actor, '<div class="warn">Mobile session not found.</div>'));
    const result = syncMobileSession(state, actor, session);
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'mobile-session-sync', detail: `Synced ${result.syncedCount} mobile actions for ${session.deviceName}` });
    redirect(res, `/mobile-app/sessions/${session.id}`);
  });
}
