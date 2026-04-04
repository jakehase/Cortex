import { createId, nowIso } from '../app/index.mjs';

function ensurePreferences(db) {
  db.preferenceCenters ||= [];
  db.preferenceProfiles ||= [];
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
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  state.db.preferenceProfiles.unshift(profile);
  return profile;
}

export function updatePreferenceProfile(profile, body = {}) {
  profile.subscriptions = normalizeSelections(body);
  profile.updatedAt = nowIso();
  return profile;
}

export function preferenceSummary(state, workspaceId) {
  ensurePreferences(state.db);
  const profiles = state.db.preferenceProfiles.filter((entry) => entry.workspaceId === workspaceId);
  return {
    profiles: profiles.length,
    emailEnabled: profiles.filter((entry) => entry.subscriptions.email).length,
    smsEnabled: profiles.filter((entry) => entry.subscriptions.sms).length,
    adEnabled: profiles.filter((entry) => entry.subscriptions.ads).length
  };
}
