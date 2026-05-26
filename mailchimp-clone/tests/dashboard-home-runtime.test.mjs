import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { buildDashboardHomeRuntimeSnapshot } from '../packages/app/domain-core.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('dashboard home runtime records widget preferences, saved views, insights, drillthrough telemetry, snapshots, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Dashboard Runtime Owner',
      email: 'dashboard-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Dashboard Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const app = await request(baseUrl, jar, '/app');
    const appHtml = await app.text();
    assert.match(appHtml, /Dashboard home runtime/);
    assert.match(appHtml, /Runtime API JSON/);

    const runtimePage = await request(baseUrl, jar, '/dashboard/runtime');
    assert.match(await runtimePage.text(), /Dashboard home insights runtime/);

    await postForm(baseUrl, jar, '/dashboard/widgets', {
      widgetId: 'launch_readiness',
      visibility: 'visible',
      layout: 'top_grid'
    });
    assert.equal(server.state.db.dashboardWidgetPreferenceEvents[0].widgetId, 'launch_readiness');
    assert.equal(server.state.db.workspaces[0].settings.dashboardWidgetPreferences.launch_readiness.layout, 'top_grid');

    await postForm(baseUrl, jar, '/dashboard/saved-views', {
      viewId: 'owner_launch_readiness',
      label: 'Owner launch readiness',
      href: '/onboarding'
    });
    assert.equal(server.state.db.dashboardSavedViewEvents[0].viewId, 'owner_launch_readiness');

    await postForm(baseUrl, jar, '/dashboard/insights', {
      surface: 'campaign_launch',
      priority: 'high',
      targetRoute: '/campaigns',
      reason: 'Launch readiness needs campaign draft'
    });
    assert.equal(server.state.db.dashboardInsightEvents[0].priority, 'high');
    assert.equal(server.state.db.dashboardTaskQueueEvents[0].targetRoute, '/campaigns');

    await postForm(baseUrl, jar, '/dashboard/drillthrough', {
      widgetId: 'launch_readiness',
      targetRoute: '/onboarding'
    });
    assert.equal(server.state.db.dashboardDrillthroughEvents[0].targetRoute, '/onboarding');

    const apiKey = server.state.db.workspaces[0].apiKey;
    const runtimeApi = await request(baseUrl, null, '/api/dashboard/runtime', { headers: { authorization: `Bearer ${apiKey}` } });
    assert.equal(runtimeApi.status, 200);
    const payload = await runtimeApi.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.dashboardRuntime.surfaceId, 'dashboard_home_insights_runtime_layer');
    assert.equal(payload.dashboardRuntime.runtimeHealth.widgetPreferencesReady, true);
    assert.equal(payload.dashboardRuntime.runtimeHealth.savedViewsReady, true);
    assert.equal(payload.dashboardRuntime.runtimeHealth.insightsReady, true);
    assert.equal(payload.dashboardRuntime.runtimeHealth.taskQueueReady, true);
    assert.equal(payload.dashboardRuntime.runtimeHealth.drillthroughReady, true);
    assert.equal(payload.dashboardRuntime.runtimeHealth.dataFreshnessReady, true);

    const snapshotPage = await request(baseUrl, jar, '/dashboard/runtime/snapshot');
    assert.equal(snapshotPage.status, 200);
    assert.match(await snapshotPage.text(), /Dashboard home runtime snapshot/);
    assert.equal(server.state.db.dashboardRuntimeSnapshots.length, 1);

    const snapshot = buildDashboardHomeRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.runtimeHealth.snapshotReady, true);
    assert.equal(snapshot.widgets.preferenceEventCount, 1);
    assert.equal(snapshot.savedViews.savedViewEventCount, 1);
    assert.equal(snapshot.insightQueue.taskCount, 1);
    assert.equal(snapshot.drillthrough.count, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
