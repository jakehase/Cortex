import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import {
  MOBILE_APP_RUNTIME_CONTRACT,
  buildMobileRuntimeSnapshot,
  createMobileSession,
  persistMobileRuntimeSnapshot,
  queueMobileAction,
  recordMobileDeviceTrustEvent,
  recordMobileNotificationEvent,
  registerMobilePushToken,
  resolveMobileActionConflict,
  syncMobileSession
} from '../packages/mobile-app/index.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('mobile app runtime builds push, trust, sync batch, conflict, notification, and snapshot evidence', () => {
  const state = {
    db: {
      mobileAppSessions: [],
      mobileAppQueuedActions: [],
      mobileRuntimeSnapshots: [],
      mobilePushRegistrations: [],
      mobileDeviceTrustEvents: [],
      mobileSyncBatches: [],
      mobileConflictResolutions: [],
      mobileNotificationEvents: []
    }
  };
  const actor = { workspace: { id: 'ws_1' }, user: { id: 'user_1' } };
  assert.equal(MOBILE_APP_RUNTIME_CONTRACT.surfaceId, 'mobile_app_push_offline_runtime_layer');
  const session = createMobileSession(state, actor, { deviceName: 'Jake iPhone', platform: 'ios', pushOptIn: 'on', pushToken: 'token_1' });
  registerMobilePushToken(state, actor, session, { token: 'token_2', provider: 'mailclone_push' });
  recordMobileDeviceTrustEvent(state, actor, session, { trustStatus: 'review_required', reason: 'new_location', riskScore: '42' });
  const action = queueMobileAction(state, actor, session, { kind: 'inbox_reply', target: 'riley@example.com', payload: '{"body":"Reply from phone"}', conflictStatus: 'detected' });
  const resolution = resolveMobileActionConflict(state, actor, session, { actionId: action.id, strategy: 'merge_fields', payload: '{"body":"Merged reply"}' });
  recordMobileNotificationEvent(state, actor, session, { notificationType: 'conflict_resolved', title: 'Conflict resolved', body: 'Mobile reply merged.' });
  const sync = syncMobileSession(state, actor, session);
  const snapshot = persistMobileRuntimeSnapshot(state, actor, 'test_snapshot');

  assert.equal(resolution.status, 'resolved');
  assert.equal(sync.syncedCount, 1);
  assert.equal(snapshot.sessionCount, 1);
  assert.equal(snapshot.pushRegistrationCount, 2);
  assert.equal(snapshot.trustEventCount, 2);
  assert.equal(snapshot.syncBatchCount, 1);
  assert.equal(snapshot.conflictResolutionCount, 1);
  assert.equal(snapshot.notificationEventCount, 1);
  assert.equal(snapshot.syncedActionCount, 1);
  assert.equal(snapshot.devicePosture[0].trustStatus, 'review_required');
  assert.ok(snapshot.evidenceContract.includes('offline_action_sync_batches'));
});

test('mobile app runtime routes persist push, trust, conflict, notification, sync, snapshot, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Mobile Runtime Admin',
      email: 'mobile-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Mobile Runtime Lab'
    }));

    await postForm(baseUrl, jar, '/mobile-app/sessions', {
      deviceName: 'Jake iPhone',
      platform: 'ios',
      pushOptIn: 'on',
      pushToken: 'token_1'
    });
    const session = server.state.db.mobileAppSessions[0];
    await postForm(baseUrl, jar, `/mobile-app/sessions/${session.id}/push`, { token: 'token_2', provider: 'mailclone_push' });
    await postForm(baseUrl, jar, `/mobile-app/sessions/${session.id}/trust`, { trustStatus: 'review_required', reason: 'new_location', riskScore: '42' });
    await postForm(baseUrl, jar, `/mobile-app/sessions/${session.id}/actions`, {
      kind: 'inbox_reply',
      target: 'riley@example.com',
      payload: '{"body":"Reply drafted from phone"}'
    });
    const action = server.state.db.mobileAppQueuedActions[0];
    await postForm(baseUrl, jar, `/mobile-app/sessions/${session.id}/conflicts`, { actionId: action.id, target: 'riley@example.com', strategy: 'merge_fields', payload: '{"body":"Merged reply"}' });
    await postForm(baseUrl, jar, `/mobile-app/sessions/${session.id}/notifications`, { notificationType: 'sync_ready', title: 'Sync ready', body: 'Mobile queue ready.' });
    await postForm(baseUrl, jar, `/mobile-app/sessions/${session.id}/sync`, {});
    await postForm(baseUrl, jar, '/mobile-app/runtime/snapshot', {});

    assert.equal(server.state.db.mobilePushRegistrations.length, 2);
    assert.equal(server.state.db.mobileDeviceTrustEvents.length, 2);
    assert.equal(server.state.db.mobileConflictResolutions.length, 1);
    assert.equal(server.state.db.mobileNotificationEvents.length, 1);
    assert.equal(server.state.db.mobileSyncBatches.length, 1);
    assert.equal(server.state.db.mobileRuntimeSnapshots.length, 1);
    assert.equal(server.state.db.mobileAppQueuedActions[0].status, 'synced');

    const api = await request(baseUrl, jar, '/api/mobile-app/runtime');
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mobileRuntime.surfaceId, 'mobile_app_push_offline_runtime_layer');
    assert.equal(payload.mobileRuntime.pushRegistrationCount, 2);
    assert.equal(payload.mobileRuntime.trustEventCount, 2);
    assert.equal(payload.mobileRuntime.syncBatchCount, 1);
    assert.equal(payload.mobileRuntime.conflictResolutionCount, 1);
    assert.equal(payload.mobileRuntime.notificationEventCount, 1);

    const overview = await (await request(baseUrl, jar, '/mobile-app')).text();
    assert.match(overview, /Open mobile runtime API/);
    assert.match(overview, /sync batches/i);
    assert.match(overview, /push registrations/i);

    const detail = await (await request(baseUrl, jar, `/mobile-app/sessions/${session.id}`)).text();
    assert.match(detail, /Runtime controls/);
    assert.match(detail, /Register push token/);
    assert.match(detail, /conflict resolved|conflict none|conflict/i);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});

test('existing mobile app companion pair, queue, and sync flow remains supported', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Mobile Admin',
      email: 'mobile-existing@example.com',
      password: 'secret123',
      workspaceName: 'Mobile Lab'
    }));

    const landing = await request(baseUrl, jar, '/mobile-app');
    assert.match(await landing.text(), /Mobile app command center/);

    await postForm(baseUrl, jar, '/mobile-app/sessions', {
      deviceName: "Jake's iPhone",
      platform: 'ios',
      pushOptIn: 'on'
    });

    const session = server.state.db.mobileAppSessions[0];
    assert.equal(session.deviceName, "Jake's iPhone");
    assert.equal(session.pushOptIn, true);

    await postForm(baseUrl, jar, `/mobile-app/sessions/${session.id}/actions`, {
      kind: 'inbox_reply',
      target: 'riley@example.com',
      payload: '{"body":"Reply drafted from phone"}'
    });
    assert.equal(server.state.db.mobileAppQueuedActions[0].status, 'queued');

    await postForm(baseUrl, jar, `/mobile-app/sessions/${session.id}/sync`, {});
    assert.equal(server.state.db.mobileAppQueuedActions[0].status, 'synced');
    assert.match(server.state.db.mobileAppSessions[0].lastSyncSummary, /Synced 1 queued actions/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
