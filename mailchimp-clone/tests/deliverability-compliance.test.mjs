import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('Wave 2 deliverability compliance: surface alerts, suppression hygiene, and API health state', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Compliance Admin',
      email: 'compliance@example.com',
      password: 'secret123',
      workspaceName: 'Compliance Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/settings', {
      senderName: 'Compliance Admin',
      senderEmail: 'sender@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#2255aa',
      address: '100 Main Street'
    });
    await postForm(baseUrl, jar, '/settings/domains', { domain: 'example.com' });
    const domainId = server.state.db.workspaces[0].settings.domains[0].id;
    await postForm(baseUrl, jar, `/settings/domains/${domainId}/verify`, {});
    await postForm(baseUrl, jar, `/settings/domains/${domainId}/authenticate`, {});
    await postForm(baseUrl, jar, `/settings/domains/${domainId}/default`, {});

    const pageOne = await request(baseUrl, jar, '/deliverability');
    const pageOneHtml = await pageOne.text();
    assert.match(pageOneHtml, /Inbox readiness/);
    const alertId = server.state.db.complianceAlerts[0].id;

    await postForm(baseUrl, jar, '/deliverability/suppressions', {
      email: 'bounce@example.com',
      reason: 'hard_bounce'
    });
    await postForm(baseUrl, jar, `/deliverability/alerts/${alertId}/resolve`, {});

    const deliverabilityPage = await request(baseUrl, jar, '/deliverability');
    const deliverabilityHtml = await deliverabilityPage.text();
    assert.match(deliverabilityHtml, /bounce@example.com/);
    assert.match(deliverabilityHtml, /resolved/);
    assert.match(deliverabilityHtml, /authenticated/);

    const apiKey = (await (await request(baseUrl, jar, '/workspaces')).text()).match(/key_[a-f0-9]+/)[0];
    const healthApi = await request(baseUrl, null, '/api/deliverability/health', {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    const payload = await healthApi.json();
    assert.equal(payload.ok, true);
    assert.ok(payload.deliverability.score >= 70);
    assert.equal(payload.deliverability.suppressionCount, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
