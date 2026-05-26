import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceWarehouseSnapshot } from '../packages/app/domain-audience.mjs';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('audience warehouse snapshot resolves identity graph, lifecycle stages, source completeness, and duplicate groups', () => {
  const audience = { id: 'aud_1', workspaceId: 'ws_1', name: 'Retail CRM' };
  const state = {
    db: {
      contacts: [
        { id: 'contact_1', workspaceId: 'ws_1', audienceId: 'aud_1', email: 'casey@example.com', phone: '555-0001', status: 'subscribed', source: 'manual', tags: ['vip'], interests: ['events', 'product'], groups: { Region: 'Central' }, activity: [{ message: 'Created' }, { message: 'Clicked' }] },
        { id: 'contact_2', workspaceId: 'ws_1', audienceId: 'aud_1', email: 'casey@example.com', phone: '555-0001', status: 'subscribed', source: 'csv-import', tags: ['retained'], interests: ['events'], groups: { Region: 'Central' }, activity: [{ message: 'Imported' }] },
        { id: 'contact_3', workspaceId: 'ws_1', audienceId: 'aud_1', email: 'new@example.com', phone: '', status: 'subscribed', source: 'api', tags: ['new'], interests: [], groups: {}, activity: [] }
      ],
      jobs: [{ type: 'import_contacts', payload: { audienceId: 'aud_1' }, status: 'completed' }],
      integrationSyncRuns: [{ audienceId: 'aud_1', status: 'queued' }]
    }
  };

  const snapshot = buildAudienceWarehouseSnapshot(state, audience);
  assert.equal(snapshot.contactCount, 3);
  assert.equal(snapshot.identityGraph.resolvedProfiles, 2);
  assert.equal(snapshot.identityGraph.duplicateIdentityGroups.length, 1);
  assert.equal(snapshot.lifecycleStages.advocate, 2);
  assert.equal(snapshot.lifecycleStages.new, 1);
  assert.equal(snapshot.completeness.email, 1);
  assert.equal(snapshot.completeness.phone, 0.67);
  assert.equal(snapshot.syncReadiness.providerSyncRuns, 1);
  assert.equal(snapshot.syncReadiness.readyForSegmentation, true);
});

test('audience warehouse route refreshes durable identity lifecycle snapshot without breaking core audience flows', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Audience Warehouse Admin',
      email: 'audience-warehouse@example.com',
      password: 'secret123',
      workspaceName: 'Warehouse Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/audiences', { name: 'Lifecycle Audience', description: 'Lifecycle and identity lab' });
    const audiencesPage = await request(baseUrl, jar, '/audiences');
    const audienceId = (await audiencesPage.text()).match(/\/audiences\/(aud_[a-f0-9]+)/)[1];

    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Casey',
      lastName: 'Jones',
      email: 'casey@example.com',
      phone: '555-0001',
      tags: 'vip, retained',
      groupCategory: 'Region',
      groupValue: 'Central',
      interests: 'events, product'
    });
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Casey',
      lastName: 'Duplicate',
      email: 'casey@example.com',
      phone: '555-0001',
      tags: 'retained',
      groupCategory: 'Region',
      groupValue: 'Central',
      interests: 'events'
    });
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'New',
      lastName: 'Lead',
      email: 'newlead@example.com',
      tags: 'new',
      interests: 'docs'
    });

    const audienceOverview = await request(baseUrl, jar, `/audiences/${audienceId}`);
    const overviewHtml = await audienceOverview.text();
    assert.match(overviewHtml, /Identity lifecycle warehouse/);

    await postForm(baseUrl, jar, `/audiences/${audienceId}/warehouse/refresh`, {});
    assert.equal(server.state.db.audienceWarehouseSnapshots.length, 1);
    assert.equal(server.state.db.audienceWarehouseSnapshots[0].identityGraph.duplicateIdentityGroups.length, 1);

    const warehousePage = await request(baseUrl, jar, `/audiences/${audienceId}/warehouse`);
    const warehouseHtml = await warehousePage.text();
    assert.match(warehouseHtml, /Identity graph/);
    assert.match(warehouseHtml, /Lifecycle warehouse/);
    assert.match(warehouseHtml, /Duplicate identity groups: 1/);
    assert.match(warehouseHtml, /advocate: 2/);
    assert.match(warehouseHtml, /new: 1/);
    assert.match(warehouseHtml, /Refresh identity lifecycle warehouse/);

    const contactsPage = await request(baseUrl, jar, `/contacts?audienceId=${audienceId}&tag=vip`);
    assert.match(await contactsPage.text(), /casey@example.com/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
