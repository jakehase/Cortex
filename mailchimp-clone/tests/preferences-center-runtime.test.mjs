import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import {
  PREFERENCE_CENTER_RUNTIME_CONTRACT,
  buildPreferenceRuntimeSnapshot,
  createPreferenceExportRun,
  createPreferenceProfile,
  persistPreferenceRuntimeSnapshot,
  reconcilePreferenceSuppressions,
  updatePreferenceProfile,
  verifyPreferenceDoubleOptIn
} from '../packages/preferences-center/index.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('preference center runtime builds consent, double opt-in, suppression, export, and snapshot evidence', () => {
  const state = {
    db: {
      preferenceCenters: [],
      preferenceProfiles: [],
      preferenceRuntimeSnapshots: [],
      preferenceConsentEvents: [],
      preferenceSuppressionSyncs: [],
      preferenceExportRuns: []
    }
  };
  const actor = { workspace: { id: 'ws_1' }, user: { id: 'user_1' } };
  assert.equal(PREFERENCE_CENTER_RUNTIME_CONTRACT.surfaceId, 'preference_center_consent_suppression_runtime_layer');
  const profile = createPreferenceProfile(state, actor, { contactName: 'Taylor', email: 'taylor@example.com', topics: 'launches, webinars', sms: 'on' });
  assert.equal(state.db.preferenceConsentEvents.length, 1);
  updatePreferenceProfile(profile, { topics: 'launches' }, state, { source: 'hosted_preference_center' });
  verifyPreferenceDoubleOptIn(state, profile, { source: 'hosted_double_opt_in' });
  const sync = reconcilePreferenceSuppressions(state, actor, { source: 'test_reconciliation' });
  const exportRun = createPreferenceExportRun(state, actor, { format: 'json' });
  const snapshot = persistPreferenceRuntimeSnapshot(state, actor, 'test_snapshot');

  assert.equal(profile.subscriptions.email, false);
  assert.equal(profile.doubleOptIn.status, 'confirmed');
  assert.equal(sync.suppressedCount, 3);
  assert.equal(exportRun.profileCount, 1);
  assert.equal(snapshot.profileCount, 1);
  assert.equal(snapshot.consentEventCount, 3);
  assert.equal(snapshot.suppressionSyncCount, 1);
  assert.equal(snapshot.exportRunCount, 1);
  assert.equal(snapshot.channelCounts.emailSuppressed, 1);
  assert.equal(snapshot.doubleOptInCounts.confirmed, 1);
  assert.ok(snapshot.evidenceContract.includes('auditable_preference_export_runs'));
});

test('preference center runtime routes persist consent, suppression, export, snapshot, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Preference Runtime Admin',
      email: 'preference-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Preference Runtime Lab'
    }));

    await postForm(baseUrl, jar, '/preferences/centers', {
      title: 'Manage launch updates',
      slug: 'manage-runtime-launch',
      topics: 'launches, webinars, offers'
    });
    await postForm(baseUrl, jar, '/preferences/profiles', {
      contactName: 'Taylor',
      email: 'taylor@example.com',
      topics: 'launches, webinars',
      sms: 'on'
    });
    const profile = server.state.db.preferenceProfiles[0];
    assert.equal(server.state.db.preferenceConsentEvents.length, 1);

    await request(baseUrl, null, `/preferences/${profile.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ topics: 'launches' })
    });
    await request(baseUrl, null, `/preferences/${profile.token}/double-opt-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({})
    });
    await postForm(baseUrl, jar, '/preferences/suppression-sync', {});
    await postForm(baseUrl, jar, '/preferences/exports', { format: 'json' });
    await postForm(baseUrl, jar, '/preferences/runtime/snapshot', {});

    assert.equal(server.state.db.preferenceProfiles[0].subscriptions.email, false);
    assert.equal(server.state.db.preferenceProfiles[0].doubleOptIn.status, 'confirmed');
    assert.equal(server.state.db.preferenceConsentEvents.length, 3);
    assert.equal(server.state.db.preferenceSuppressionSyncs.length, 1);
    assert.equal(server.state.db.preferenceExportRuns.length, 1);
    assert.equal(server.state.db.preferenceRuntimeSnapshots.length, 1);

    const api = await request(baseUrl, jar, '/api/preferences/runtime');
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.preferencesRuntime.surfaceId, 'preference_center_consent_suppression_runtime_layer');
    assert.equal(payload.preferencesRuntime.profileCount, 1);
    assert.equal(payload.preferencesRuntime.consentEventCount, 3);
    assert.equal(payload.preferencesRuntime.suppressionSyncCount, 1);
    assert.equal(payload.preferencesRuntime.exportRunCount, 1);
    assert.equal(payload.preferencesRuntime.channelCounts.emailSuppressed, 1);

    const overview = await (await request(baseUrl, jar, '/preferences')).text();
    assert.match(overview, /Open preferences runtime API/);
    assert.match(overview, /consent events/i);
    assert.match(overview, /suppression syncs/i);

    const publicPage = await (await request(baseUrl, null, `/preferences/${profile.token}`)).text();
    assert.match(publicPage, /Consent status/);
    assert.match(publicPage, /Double opt-in: confirmed/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});

test('existing preferences center hosted update flow remains supported', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Preference Admin',
      email: 'prefs-existing@example.com',
      password: 'secret123',
      workspaceName: 'Preference Lab'
    }));

    await postForm(baseUrl, jar, '/preferences/centers', {
      title: 'Manage launch updates',
      slug: 'manage-launch-existing',
      topics: 'launches, webinars, offers'
    });
    await postForm(baseUrl, jar, '/preferences/profiles', {
      contactName: 'Taylor',
      email: 'taylor-existing@example.com',
      topics: 'launches, webinars',
      sms: 'on'
    });

    const profile = server.state.db.preferenceProfiles[0];
    const publicPage = await request(baseUrl, null, `/preferences/${profile.token}`);
    assert.match(await publicPage.text(), /Manage preferences/);

    await request(baseUrl, null, `/preferences/${profile.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'on', topics: 'launches' })
    });

    assert.equal(server.state.db.preferenceProfiles[0].subscriptions.sms, false);
    assert.deepEqual(server.state.db.preferenceProfiles[0].subscriptions.topics, ['launches']);

    const hosted = await request(baseUrl, null, '/p/manage-launch-existing');
    assert.match(await hosted.text(), /Available topics: launches, webinars, offers/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
