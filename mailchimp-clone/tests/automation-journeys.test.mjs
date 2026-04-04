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

test('Program 4 automation journeys: overview, builder nodes, publish/pause/resume, validation and broken-journey handling', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Automation Admin',
      email: 'auto@example.com',
      password: 'secret123',
      workspaceName: 'Automation Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const audienceId = server.state.db.audiences[0].id;
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Morgan',
      lastName: 'Lane',
      email: 'morgan@example.com',
      tags: 'vip',
      interests: 'release'
    });

    const created = await postForm(baseUrl, jar, '/automations', {
      name: 'Welcome Journey',
      audienceId,
      trigger: ''
    });
    const builderLocation = created.headers.get('location');
    assert.match(builderLocation, /\/automations\/journey_[a-f0-9]+\/builder/);
    const automationId = builderLocation.match(/journey_[a-f0-9]+/)[0];

    let builder = await request(baseUrl, jar, builderLocation);
    const brokenHtml = await builder.text();
    assert.match(brokenHtml, /Journey trigger is required/);
    assert.match(brokenHtml, /Add at least one journey node/);

    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, {
      type: 'email',
      title: 'Welcome email'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, {
      type: 'delay',
      title: 'Wait a day',
      delayHours: '24'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, {
      type: 'branch',
      title: 'Opened email?',
      conditions: 'opened,clicked'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/config`, {
      name: 'Welcome Journey',
      audienceId,
      trigger: 'contact_subscribed'
    });

    builder = await request(baseUrl, jar, `/automations/${automationId}/builder`);
    const builderHtml = await builder.text();
    assert.match(builderHtml, /Journey validates cleanly/);
    assert.match(builderHtml, /Welcome email/);
    assert.match(builderHtml, /Opened email\?/);

    await postForm(baseUrl, jar, `/automations/${automationId}/publish`, {});
    let automation = server.state.db.automations.find((entry) => entry.id === automationId);
    assert.equal(automation.status, 'live');
    assert.equal(automation.validationErrors.length, 0);
    assert.ok(automation.report.enrolled >= 1);

    const overview = await request(baseUrl, jar, '/automations');
    const overviewHtml = await overview.text();
    assert.match(overviewHtml, /Welcome Journey/);
    assert.match(overviewHtml, /live/);

    await postForm(baseUrl, jar, `/automations/${automationId}/pause`, {});
    automation = server.state.db.automations.find((entry) => entry.id === automationId);
    assert.equal(automation.status, 'paused');

    await postForm(baseUrl, jar, `/automations/${automationId}/resume`, {});
    automation = server.state.db.automations.find((entry) => entry.id === automationId);
    assert.equal(automation.status, 'live');

    const report = await request(baseUrl, jar, `/reports/automations/${automationId}`);
    const reportHtml = await report.text();
    assert.match(reportHtml, /Automation report/);
    assert.match(reportHtml, /published/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
