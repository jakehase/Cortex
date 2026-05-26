import { createId, nowIso } from '../app/index.mjs';

export const MOBILE_APP_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'mobile_app_push_offline_runtime_layer',
  label: 'Mobile app push registration, device trust, offline sync, conflict resolution, notification, and runtime evidence layer',
  controls: [
    'mobile_push_registration_ledger',
    'mobile_device_trust_events',
    'offline_sync_batch_ledger',
    'mobile_conflict_resolution_events',
    'mobile_notification_event_ledger',
    'mobile_runtime_snapshots',
    'workspace_mobile_runtime_api'
  ],
  evidenceContract: [
    'device_pairing_and_push_registration',
    'device_trust_and_risk_posture',
    'offline_action_sync_batches',
    'conflict_resolution_payloads',
    'notification_delivery_events',
    'normal_mobile_route_adoption'
  ]
});

function ensureMobile(db) {
  db.mobileAppSessions ||= [];
  db.mobileAppQueuedActions ||= [];
  db.mobileRuntimeSnapshots ||= [];
  db.mobilePushRegistrations ||= [];
  db.mobileDeviceTrustEvents ||= [];
  db.mobileSyncBatches ||= [];
  db.mobileConflictResolutions ||= [];
  db.mobileNotificationEvents ||= [];
}

function parsePayload(value = '') {
  if (typeof value === 'object' && value !== null) return value;
  const raw = String(value || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { note: raw };
  }
}

function hashToken(token = '') {
  const raw = String(token || '');
  if (!raw) return '';
  let hash = 0;
  for (const char of raw) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return `push_${Math.abs(hash).toString(16)}`;
}

function riskFor(session = {}, body = {}) {
  if (body.riskScore != null) return Number(body.riskScore || 0);
  let score = 10;
  if (!session.pushOptIn) score += 10;
  if (session.platform === 'android') score += 3;
  if (String(body.trustStatus || session.trustStatus || 'trusted') !== 'trusted') score += 25;
  return score;
}

export function mobileWorkspaceSummary(state, workspaceId) {
  ensureMobile(state.db);
  const campaigns = (state.db.campaigns || []).filter((entry) => entry.workspaceId === workspaceId);
  const contacts = (state.db.contacts || []).filter((entry) => entry.workspaceId === workspaceId);
  const conversations = (state.db.conversations || []).filter((entry) => entry.workspaceId === workspaceId);
  const transactionalJourneys = (state.db.transactionalJourneys || []).filter((entry) => entry.workspaceId === workspaceId);
  const surveys = (state.db.surveyPrograms || []).filter((entry) => entry.workspaceId === workspaceId);
  const sessions = state.db.mobileAppSessions.filter((entry) => entry.workspaceId === workspaceId);
  const queuedActions = state.db.mobileAppQueuedActions.filter((entry) => entry.workspaceId === workspaceId);
  const pushRegistrations = state.db.mobilePushRegistrations.filter((entry) => entry.workspaceId === workspaceId && entry.status === 'active');
  const conflicts = state.db.mobileConflictResolutions.filter((entry) => entry.workspaceId === workspaceId);
  return {
    campaigns: campaigns.length,
    contacts: contacts.length,
    openConversations: conversations.filter((entry) => entry.status !== 'closed').length,
    transactionalLive: transactionalJourneys.filter((entry) => entry.status === 'live').length,
    surveys: surveys.length,
    activeDevices: sessions.filter((entry) => entry.status === 'active').length,
    pushEnabledDevices: pushRegistrations.length,
    queuedActions: queuedActions.filter((entry) => entry.status === 'queued').length,
    syncedActions: queuedActions.filter((entry) => entry.status === 'synced').length,
    resolvedConflicts: conflicts.filter((entry) => entry.status === 'resolved').length,
    quickActions: [
      { id: 'create-campaign', label: 'Create campaign draft', href: '/campaigns/new' },
      { id: 'review-inbox', label: 'Review inbox', href: '/conversations' },
      { id: 'launch-transactional', label: 'Launch transactional journey', href: '/journeys/transactional' },
      { id: 'check-surveys', label: 'Check survey feedback', href: '/surveys' }
    ]
  };
}

export function createMobileSession(state, actor, body = {}) {
  ensureMobile(state.db);
  const session = {
    id: createId('mobile'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    deviceName: body.deviceName || 'Marketing phone',
    platform: body.platform || 'ios',
    pushOptIn: ['on', 'true', 'yes', true].includes(body.pushOptIn),
    status: 'active',
    trustStatus: 'trusted',
    riskScore: 10,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastSyncAt: null,
    lastSyncSummary: 'No mobile sync yet',
    offlineReadiness: {
      campaignDrafts: true,
      inboxReplies: true,
      surveySnapshots: true,
      transactionalDispatch: true
    }
  };
  state.db.mobileAppSessions.unshift(session);
  recordMobileDeviceTrustEvent(state, actor, session, { trustStatus: 'trusted', reason: 'device_paired' });
  if (session.pushOptIn) registerMobilePushToken(state, actor, session, { token: body.pushToken || session.id, provider: body.pushProvider || 'mailclone_push' });
  return session;
}

export function registerMobilePushToken(state, actor, session, body = {}) {
  ensureMobile(state.db);
  const registration = {
    id: createId('mpush'),
    workspaceId: actor.workspace.id,
    sessionId: session.id,
    userId: actor.user.id,
    provider: body.provider || 'mailclone_push',
    platform: session.platform,
    tokenHash: hashToken(body.token || session.id),
    status: body.status || 'active',
    registeredAt: nowIso()
  };
  state.db.mobilePushRegistrations.unshift(registration);
  state.db.mobilePushRegistrations = state.db.mobilePushRegistrations.slice(0, 1000);
  session.pushOptIn = true;
  session.pushRegistrationId = registration.id;
  session.updatedAt = registration.registeredAt;
  return registration;
}

export function recordMobileDeviceTrustEvent(state, actor, session, body = {}) {
  ensureMobile(state.db);
  const riskScore = riskFor(session, body);
  const event = {
    id: createId('mtrust'),
    workspaceId: actor.workspace.id,
    sessionId: session.id,
    userId: actor.user.id,
    deviceName: session.deviceName,
    platform: session.platform,
    trustStatus: body.trustStatus || session.trustStatus || 'trusted',
    riskScore,
    reason: body.reason || 'operator_review',
    recordedAt: nowIso()
  };
  state.db.mobileDeviceTrustEvents.unshift(event);
  state.db.mobileDeviceTrustEvents = state.db.mobileDeviceTrustEvents.slice(0, 1000);
  session.trustStatus = event.trustStatus;
  session.riskScore = riskScore;
  session.updatedAt = event.recordedAt;
  return event;
}

export function mobileSessionActions(state, sessionId) {
  ensureMobile(state.db);
  return state.db.mobileAppQueuedActions
    .filter((entry) => entry.sessionId === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function queueMobileAction(state, actor, session, body = {}) {
  ensureMobile(state.db);
  const action = {
    id: createId('mobact'),
    workspaceId: actor.workspace.id,
    sessionId: session.id,
    userId: actor.user.id,
    kind: body.kind || 'campaign_note',
    target: body.target || 'workspace',
    payload: parsePayload(body.payload),
    clientVersion: body.clientVersion || createId('mver'),
    status: 'queued',
    conflictStatus: body.conflictStatus || 'none',
    createdAt: nowIso(),
    syncedAt: null
  };
  state.db.mobileAppQueuedActions.unshift(action);
  session.updatedAt = action.createdAt;
  session.lastSyncSummary = `${state.db.mobileAppQueuedActions.filter((entry) => entry.sessionId === session.id && entry.status === 'queued').length} queued mobile actions`;
  return action;
}

export function resolveMobileActionConflict(state, actor, session, body = {}) {
  ensureMobile(state.db);
  const action = (state.db.mobileAppQueuedActions || []).find((entry) => entry.id === body.actionId && entry.sessionId === session.id) || null;
  const resolution = {
    id: createId('mconflict'),
    workspaceId: actor.workspace.id,
    sessionId: session.id,
    actionId: action?.id || body.actionId || '',
    target: body.target || action?.target || 'workspace',
    strategy: body.strategy || 'server_wins',
    clientVersion: body.clientVersion || action?.clientVersion || '',
    serverVersion: body.serverVersion || createId('server_ver'),
    payload: parsePayload(body.payload || action?.payload || {}),
    status: 'resolved',
    resolvedBy: actor.user.id,
    resolvedAt: nowIso()
  };
  state.db.mobileConflictResolutions.unshift(resolution);
  state.db.mobileConflictResolutions = state.db.mobileConflictResolutions.slice(0, 1000);
  if (action) {
    action.conflictStatus = 'resolved';
    action.conflictResolutionId = resolution.id;
  }
  session.updatedAt = resolution.resolvedAt;
  return resolution;
}

export function recordMobileNotificationEvent(state, actor, session, body = {}) {
  ensureMobile(state.db);
  const event = {
    id: createId('mnotify'),
    workspaceId: actor.workspace.id,
    sessionId: session.id,
    userId: actor.user.id,
    notificationType: body.notificationType || 'sync_complete',
    title: body.title || 'Mobile update',
    body: body.body || 'Your mobile workspace is up to date.',
    status: body.status || (session.pushOptIn ? 'queued' : 'push_not_enabled'),
    target: body.target || 'mobile_app',
    createdAt: nowIso()
  };
  state.db.mobileNotificationEvents.unshift(event);
  state.db.mobileNotificationEvents = state.db.mobileNotificationEvents.slice(0, 1000);
  return event;
}

export function syncMobileSession(state, actor, session) {
  ensureMobile(state.db);
  const syncedAt = nowIso();
  const queued = state.db.mobileAppQueuedActions.filter((entry) => entry.workspaceId === actor.workspace.id && entry.sessionId === session.id && entry.status === 'queued');
  const batch = {
    id: createId('msync'),
    workspaceId: actor.workspace.id,
    sessionId: session.id,
    userId: actor.user.id,
    actionIds: queued.map((entry) => entry.id),
    queuedCount: queued.length,
    conflictCount: queued.filter((entry) => entry.conflictStatus === 'detected').length,
    status: 'completed',
    syncedAt
  };
  for (const action of queued) {
    action.status = 'synced';
    action.syncedAt = syncedAt;
    action.syncBatchId = batch.id;
  }
  state.db.mobileSyncBatches.unshift(batch);
  state.db.mobileSyncBatches = state.db.mobileSyncBatches.slice(0, 1000);
  session.lastSyncAt = syncedAt;
  session.updatedAt = syncedAt;
  session.lastSyncSummary = `Synced ${queued.length} queued actions`;
  return { syncedAt, syncedCount: queued.length, remainingQueued: 0, syncBatchId: batch.id };
}

export function buildMobileRuntimeSnapshot(state, workspaceId) {
  ensureMobile(state.db);
  const sessions = state.db.mobileAppSessions.filter((entry) => entry.workspaceId === workspaceId);
  const actions = state.db.mobileAppQueuedActions.filter((entry) => entry.workspaceId === workspaceId);
  const pushRegistrations = state.db.mobilePushRegistrations.filter((entry) => entry.workspaceId === workspaceId);
  const trustEvents = state.db.mobileDeviceTrustEvents.filter((entry) => entry.workspaceId === workspaceId);
  const syncBatches = state.db.mobileSyncBatches.filter((entry) => entry.workspaceId === workspaceId);
  const conflicts = state.db.mobileConflictResolutions.filter((entry) => entry.workspaceId === workspaceId);
  const notifications = state.db.mobileNotificationEvents.filter((entry) => entry.workspaceId === workspaceId);
  return {
    ...MOBILE_APP_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    sessionCount: sessions.length,
    activeDeviceCount: sessions.filter((entry) => entry.status === 'active').length,
    pushRegistrationCount: pushRegistrations.length,
    trustEventCount: trustEvents.length,
    queuedActionCount: actions.filter((entry) => entry.status === 'queued').length,
    syncedActionCount: actions.filter((entry) => entry.status === 'synced').length,
    syncBatchCount: syncBatches.length,
    conflictResolutionCount: conflicts.length,
    notificationEventCount: notifications.length,
    devicePosture: sessions.map((session) => ({ id: session.id, deviceName: session.deviceName, platform: session.platform, trustStatus: session.trustStatus || 'trusted', riskScore: Number(session.riskScore || 0), pushOptIn: Boolean(session.pushOptIn), lastSyncAt: session.lastSyncAt })),
    recentSyncBatches: syncBatches.slice(0, 10),
    recentTrustEvents: trustEvents.slice(0, 10),
    recentConflicts: conflicts.slice(0, 10),
    recentNotifications: notifications.slice(0, 10)
  };
}

export function persistMobileRuntimeSnapshot(state, actor, reason = 'manual_mobile_runtime_snapshot') {
  ensureMobile(state.db);
  const snapshot = buildMobileRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('mrun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.mobileRuntimeSnapshots.unshift(entry);
  state.db.mobileRuntimeSnapshots = state.db.mobileRuntimeSnapshots.slice(0, 100);
  return entry;
}
