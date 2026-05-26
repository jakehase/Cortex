import { createId, nowIso } from '../app/index.mjs';

export const PREFERENCE_CENTER_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'preference_center_consent_suppression_runtime_layer',
  label: 'Preference center consent, suppression, export, and runtime evidence layer',
  controls: [
    'preference_consent_event_ledger',
    'double_opt_in_verification',
    'suppression_reconciliation_runs',
    'preference_export_run_ledger',
    'preference_runtime_snapshots',
    'workspace_preferences_runtime_api'
  ],
  evidenceContract: [
    'hosted_preference_update_consent_events',
    'double_opt_in_confirmation_state',
    'channel_suppression_reconciliation_payloads',
    'auditable_preference_export_runs',
    'runtime_snapshot_persistence',
    'normal_preference_center_route_adoption'
  ]
});

function ensurePreferences(db) {
  db.preferenceCenters ||= [];
  db.preferenceProfiles ||= [];
  db.preferenceRuntimeSnapshots ||= [];
  db.preferenceConsentEvents ||= [];
  db.preferenceSuppressionSyncs ||= [];
  db.preferenceExportRuns ||= [];
}

function normalizeSelections(body = {}) {
  const topics = String(body.topics || '').split(',').map((part) => part.trim()).filter(Boolean);
  return {
    email: body.email === 'on' || /@/.test(String(body.email || '')),
    sms: body.sms === 'on',
    ads: body.ads === 'on',
    topics
  };
}

function cloneSubscriptions(subscriptions = {}) {
  return {
    email: Boolean(subscriptions.email),
    sms: Boolean(subscriptions.sms),
    ads: Boolean(subscriptions.ads),
    topics: Array.isArray(subscriptions.topics) ? [...subscriptions.topics] : []
  };
}

function changedChannels(before = {}, after = {}) {
  const changes = [];
  for (const channel of ['email', 'sms', 'ads']) {
    if (Boolean(before[channel]) !== Boolean(after[channel])) changes.push(channel);
  }
  if (JSON.stringify(before.topics || []) !== JSON.stringify(after.topics || [])) changes.push('topics');
  return changes;
}

function topicCounts(profiles) {
  const counts = new Map();
  for (const profile of profiles) {
    for (const topic of profile.subscriptions?.topics || []) counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  return [...counts.entries()].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

export function recordPreferenceConsentEvent(state, profile, body = {}) {
  ensurePreferences(state.db);
  const beforeSubscriptions = cloneSubscriptions(body.beforeSubscriptions || profile.subscriptions || {});
  const afterSubscriptions = cloneSubscriptions(body.afterSubscriptions || profile.subscriptions || {});
  const event = {
    id: createId('pconsent'),
    workspaceId: profile.workspaceId,
    profileId: profile.id,
    email: profile.email,
    action: body.action || 'preference_update',
    source: body.source || 'hosted_preference_center',
    actorUserId: body.actorUserId || null,
    reason: body.reason || '',
    beforeSubscriptions,
    afterSubscriptions,
    changedChannels: body.changedChannels || changedChannels(beforeSubscriptions, afterSubscriptions),
    userAgent: body.userAgent || '',
    ipHint: body.ipHint || '',
    recordedAt: nowIso()
  };
  state.db.preferenceConsentEvents.unshift(event);
  state.db.preferenceConsentEvents = state.db.preferenceConsentEvents.slice(0, 1000);
  profile.consentLedger ||= [];
  profile.consentLedger.unshift(event.id);
  profile.consentLedger = profile.consentLedger.slice(0, 25);
  return event;
}

export function createPreferenceCenter(state, actor, body = {}) {
  ensurePreferences(state.db);
  const center = {
    id: createId('prefcenter'),
    workspaceId: actor.workspace.id,
    title: body.title || 'Manage preferences',
    slug: body.slug || `manage-${actor.workspace.id.slice(-4)}`,
    topics: String(body.topics || 'product updates, webinars, offers').split(',').map((part) => part.trim()).filter(Boolean),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.db.preferenceCenters.unshift(center);
  return center;
}

export function createPreferenceProfile(state, actor, body = {}) {
  ensurePreferences(state.db);
  const profile = {
    id: createId('prefprofile'),
    workspaceId: actor.workspace.id,
    email: body.email || '',
    token: createId('pref_token'),
    contactName: body.contactName || '',
    subscriptions: normalizeSelections(body),
    doubleOptIn: {
      status: body.doubleOptIn === 'confirmed' ? 'confirmed' : 'pending',
      token: createId('doi'),
      requestedAt: nowIso(),
      confirmedAt: body.doubleOptIn === 'confirmed' ? nowIso() : null,
      source: 'profile_created'
    },
    consentLedger: [],
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  state.db.preferenceProfiles.unshift(profile);
  recordPreferenceConsentEvent(state, profile, {
    action: 'profile_created',
    source: 'admin_profile_create',
    actorUserId: actor.user.id,
    reason: 'initial_profile_link_created',
    beforeSubscriptions: {},
    afterSubscriptions: profile.subscriptions
  });
  return profile;
}

export function updatePreferenceProfile(profile, body = {}, state = null, metadata = {}) {
  const beforeSubscriptions = cloneSubscriptions(profile.subscriptions || {});
  profile.subscriptions = normalizeSelections(body);
  profile.updatedAt = nowIso();
  if (state?.db) {
    recordPreferenceConsentEvent(state, profile, {
      action: metadata.action || 'preference_update',
      source: metadata.source || 'hosted_preference_center',
      actorUserId: metadata.actorUserId || null,
      userAgent: metadata.userAgent || '',
      ipHint: metadata.ipHint || '',
      reason: metadata.reason || 'subscriber_saved_preferences',
      beforeSubscriptions,
      afterSubscriptions: profile.subscriptions
    });
  }
  return profile;
}

export function verifyPreferenceDoubleOptIn(state, profile, body = {}) {
  ensurePreferences(state.db);
  profile.doubleOptIn ||= { status: 'pending', token: createId('doi'), requestedAt: nowIso(), confirmedAt: null };
  profile.doubleOptIn.status = 'confirmed';
  profile.doubleOptIn.confirmedAt = nowIso();
  profile.doubleOptIn.source = body.source || 'hosted_confirmation';
  profile.updatedAt = nowIso();
  return recordPreferenceConsentEvent(state, profile, {
    action: 'double_opt_in_confirmed',
    source: body.source || 'hosted_confirmation',
    reason: body.reason || 'subscriber_confirmed_subscription',
    beforeSubscriptions: profile.subscriptions,
    afterSubscriptions: profile.subscriptions,
    changedChannels: []
  });
}

export function reconcilePreferenceSuppressions(state, actor, body = {}) {
  ensurePreferences(state.db);
  const workspaceId = actor.workspace.id;
  const profiles = state.db.preferenceProfiles.filter((entry) => entry.workspaceId === workspaceId);
  const suppressedContacts = [];
  for (const profile of profiles) {
    for (const channel of ['email', 'sms', 'ads']) {
      if (!profile.subscriptions?.[channel]) {
        suppressedContacts.push({ profileId: profile.id, email: profile.email, channel, reason: 'preference_opt_out' });
      }
    }
  }
  const channelCounts = suppressedContacts.reduce((acc, entry) => ({ ...acc, [entry.channel]: (acc[entry.channel] || 0) + 1 }), { email: 0, sms: 0, ads: 0 });
  const sync = {
    id: createId('psync'),
    workspaceId,
    source: body.source || 'manual_reconciliation',
    status: 'completed',
    profileCount: profiles.length,
    suppressedCount: suppressedContacts.length,
    channelCounts,
    suppressedContacts: suppressedContacts.slice(0, 100),
    reconciledBy: actor.user.id,
    reconciledAt: nowIso()
  };
  state.db.preferenceSuppressionSyncs.unshift(sync);
  state.db.preferenceSuppressionSyncs = state.db.preferenceSuppressionSyncs.slice(0, 200);
  return sync;
}

export function createPreferenceExportRun(state, actor, body = {}) {
  ensurePreferences(state.db);
  const workspaceId = actor.workspace.id;
  const profiles = state.db.preferenceProfiles.filter((entry) => entry.workspaceId === workspaceId);
  const consentEvents = state.db.preferenceConsentEvents.filter((entry) => entry.workspaceId === workspaceId);
  const suppressionSyncs = state.db.preferenceSuppressionSyncs.filter((entry) => entry.workspaceId === workspaceId);
  const run = {
    id: createId('pexport'),
    workspaceId,
    format: body.format || 'json',
    status: 'ready',
    profileCount: profiles.length,
    consentEventCount: consentEvents.length,
    suppressionSyncCount: suppressionSyncs.length,
    includedFields: ['email', 'contactName', 'subscriptions', 'doubleOptIn', 'consentLedger'],
    sampleProfiles: profiles.slice(0, 10).map((profile) => ({ id: profile.id, email: profile.email, subscriptions: cloneSubscriptions(profile.subscriptions), doubleOptIn: profile.doubleOptIn?.status || 'unknown' })),
    requestedBy: actor.user.id,
    createdAt: nowIso()
  };
  state.db.preferenceExportRuns.unshift(run);
  state.db.preferenceExportRuns = state.db.preferenceExportRuns.slice(0, 200);
  return run;
}

export function preferenceSummary(state, workspaceId) {
  ensurePreferences(state.db);
  const profiles = state.db.preferenceProfiles.filter((entry) => entry.workspaceId === workspaceId);
  const consentEvents = state.db.preferenceConsentEvents.filter((entry) => entry.workspaceId === workspaceId);
  const suppressionSyncs = state.db.preferenceSuppressionSyncs.filter((entry) => entry.workspaceId === workspaceId);
  return {
    profiles: profiles.length,
    emailEnabled: profiles.filter((entry) => entry.subscriptions.email).length,
    smsEnabled: profiles.filter((entry) => entry.subscriptions.sms).length,
    adEnabled: profiles.filter((entry) => entry.subscriptions.ads).length,
    consentEvents: consentEvents.length,
    suppressionSyncs: suppressionSyncs.length,
    exports: state.db.preferenceExportRuns.filter((entry) => entry.workspaceId === workspaceId).length
  };
}

export function buildPreferenceRuntimeSnapshot(state, workspaceId) {
  ensurePreferences(state.db);
  const centers = state.db.preferenceCenters.filter((entry) => entry.workspaceId === workspaceId);
  const profiles = state.db.preferenceProfiles.filter((entry) => entry.workspaceId === workspaceId);
  const consentEvents = state.db.preferenceConsentEvents.filter((entry) => entry.workspaceId === workspaceId);
  const suppressionSyncs = state.db.preferenceSuppressionSyncs.filter((entry) => entry.workspaceId === workspaceId);
  const exportRuns = state.db.preferenceExportRuns.filter((entry) => entry.workspaceId === workspaceId);
  const channelCounts = {
    emailEnabled: profiles.filter((entry) => entry.subscriptions?.email).length,
    smsEnabled: profiles.filter((entry) => entry.subscriptions?.sms).length,
    adsEnabled: profiles.filter((entry) => entry.subscriptions?.ads).length,
    emailSuppressed: profiles.filter((entry) => !entry.subscriptions?.email).length,
    smsSuppressed: profiles.filter((entry) => !entry.subscriptions?.sms).length,
    adsSuppressed: profiles.filter((entry) => !entry.subscriptions?.ads).length
  };
  return {
    ...PREFERENCE_CENTER_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    centerCount: centers.length,
    profileCount: profiles.length,
    consentEventCount: consentEvents.length,
    suppressionSyncCount: suppressionSyncs.length,
    exportRunCount: exportRuns.length,
    channelCounts,
    doubleOptInCounts: {
      confirmed: profiles.filter((entry) => entry.doubleOptIn?.status === 'confirmed').length,
      pending: profiles.filter((entry) => (entry.doubleOptIn?.status || 'pending') === 'pending').length
    },
    topicCounts: topicCounts(profiles),
    profileStates: profiles.slice(0, 25).map((profile) => ({ id: profile.id, email: profile.email, subscriptions: cloneSubscriptions(profile.subscriptions), doubleOptIn: profile.doubleOptIn?.status || 'pending', consentEvents: profile.consentLedger?.length || 0 })),
    recentConsentEvents: consentEvents.slice(0, 10),
    recentSuppressionSyncs: suppressionSyncs.slice(0, 10),
    recentExportRuns: exportRuns.slice(0, 10)
  };
}

export function persistPreferenceRuntimeSnapshot(state, actor, reason = 'manual_preference_runtime_snapshot') {
  ensurePreferences(state.db);
  const snapshot = buildPreferenceRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('prun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.preferenceRuntimeSnapshots.unshift(entry);
  state.db.preferenceRuntimeSnapshots = state.db.preferenceRuntimeSnapshots.slice(0, 100);
  return entry;
}
