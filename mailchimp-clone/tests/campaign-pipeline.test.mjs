import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, campaignNextStep } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request, waitFor } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('Program 3 campaign pipeline: step fidelity, resume semantics, block editor, blockers, test send, scheduled send, immediate send', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Campaign Admin',
      email: 'campaign@example.com',
      password: 'secret123',
      workspaceName: 'Campaign Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const audienceId = server.state.db.audiences[0].id;
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Dana',
      lastName: 'Miles',
      email: 'dana@example.com',
      tags: 'launch',
      groupCategory: 'Region',
      groupValue: 'Central',
      interests: 'release'
    });

    const createCampaign = await postForm(baseUrl, jar, '/campaigns', { name: 'Launch Blast' });
    const setupLocation = createCampaign.headers.get('location');
    assert.match(setupLocation, /\/campaigns\/camp_[a-f0-9]+\/setup/);
    const campaignId = setupLocation.match(/camp_[a-f0-9]+/)[0];

    let resume = await request(baseUrl, jar, `/campaigns/${campaignId}/resume`);
    assert.equal(resume.status, 302);
    assert.match(resume.headers.get('location'), /\/setup$/);

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, {
      name: 'Launch Blast',
      subject: 'We shipped it',
      preheader: 'Release notes inside',
      fromName: 'Campaign Admin',
      replyTo: 'reply@example.com'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });
    resume = await request(baseUrl, jar, `/campaigns/${campaignId}/resume`);
    assert.match(resume.headers.get('location'), /\/templates$/);

    const templatesPage = await request(baseUrl, jar, `/campaigns/${campaignId}/templates`);
    assert.match(await templatesPage.text(), /Template library/);
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/template`, { templateId: 'tmpl-announce' });

    const editorPage = await request(baseUrl, jar, `/campaigns/${campaignId}/editor`);
    const editorHtml = await editorPage.text();
    assert.match(editorHtml, /Add content block/);
    assert.match(editorHtml, /Live preview/);
    assert.match(editorHtml, /Duplicate block/);

    await postForm(baseUrl, jar, '/assets', {
      name: 'banner.txt',
      folder: 'Launch',
      contentType: 'text/plain',
      altText: 'Banner',
      body: 'banner asset'
    });
    const assetId = server.state.db.assets[0].id;

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/add-block`, { type: 'image' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/add-block`, { type: 'button' });

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/0/update`, {
      title: 'Launch day',
      body: 'We shipped the feature and want you to try it today.',
      buttonLabel: '',
      buttonUrl: '',
      assetId: '',
      backgroundColor: '#f0f4ff',
      textAlign: 'center',
      padding: '30px'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/1/update`, {
      title: 'What is new',
      body: 'This release includes workflow parity improvements.',
      buttonLabel: '',
      buttonUrl: '',
      assetId: '',
      backgroundColor: '#ffffff',
      textAlign: 'left',
      padding: '18px'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/3/update`, {
      title: 'Campaign image',
      body: 'Using content studio asset.',
      buttonLabel: '',
      buttonUrl: '',
      assetId,
      backgroundColor: '#ffffff',
      textAlign: 'left',
      padding: '18px'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/4/update`, {
      title: 'Read more',
      body: '',
      buttonLabel: 'Open changelog',
      buttonUrl: 'https://example.test/changelog',
      assetId: '',
      backgroundColor: '#eef6ff',
      textAlign: 'center',
      padding: '20px'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/4/move`, { direction: 'up' });
    let campaignState = server.state.db.campaigns.find((entry) => entry.id === campaignId);
    assert.equal(campaignState.blocks[3].title, 'Read more');
    assert.equal(campaignState.blocks[4].title, 'Campaign image');
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/0/duplicate`, {});
    campaignState = server.state.db.campaigns.find((entry) => entry.id === campaignId);
    assert.equal(campaignState.blocks[1].title, 'Launch day');

    let review = await request(baseUrl, jar, `/campaigns/${campaignId}/review`);
    let reviewHtml = await review.text();
    assert.match(reviewHtml, /Workspace sender email is not configured/);
    assert.match(reviewHtml, /Workspace physical mailing address is required/);

    await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
    await postForm(baseUrl, jar, '/settings', {
      senderName: 'Campaign Admin',
      senderEmail: 'hello@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#0044aa',
      address: '123 Main'
    });

    review = await request(baseUrl, jar, `/campaigns/${campaignId}/review`);
    reviewHtml = await review.text();
    assert.match(reviewHtml, /No blockers/);
    assert.match(reviewHtml, /Schedule delivery/);

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/test-send`, { testEmail: 'qa@example.com' });
    await waitFor(async () => {
      const notesPage = await request(baseUrl, jar, '/notifications');
      assert.match(await notesPage.text(), /qa@example.com/);
      return true;
    });

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/schedule`, { runAt: 'invalid' });
    await waitFor(async () => {
      const campaignsPage = await request(baseUrl, jar, '/campaigns');
      assert.match(await campaignsPage.text(), /scheduled|sent/);
      return true;
    });

    await waitFor(async () => {
      const campaignsPage = await request(baseUrl, jar, '/campaigns');
      assert.match(await campaignsPage.text(), /sent/);
      return true;
    }, { timeoutMs: 5000, intervalMs: 150 });

    const secondCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Second blast' });
    const secondId = secondCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];
    assert.equal(campaignNextStep(server.state.db.campaigns.find((entry) => entry.id === secondId)), 'setup');
    await postForm(baseUrl, jar, `/campaigns/${secondId}/setup`, {
      name: 'Second blast',
      subject: 'Another send',
      preheader: 'Quick reminder',
      fromName: 'Campaign Admin',
      replyTo: 'reply@example.com'
    });
    await postForm(baseUrl, jar, `/campaigns/${secondId}/recipients`, { audienceId, segmentId: '' });
    await postForm(baseUrl, jar, `/campaigns/${secondId}/template`, { templateId: 'tmpl-newsletter' });
    await postForm(baseUrl, jar, `/campaigns/${secondId}/send`, {});
    let secondReview = await request(baseUrl, jar, `/campaigns/${secondId}/review`);
    assert.match(await secondReview.text(), /Add at least one content block|No blockers/);

    await postForm(baseUrl, jar, `/campaigns/${secondId}/editor/block/0/update`, {
      title: 'Reminder',
      body: 'This second campaign uses template starter blocks.',
      buttonLabel: '',
      buttonUrl: '',
      assetId: '',
      backgroundColor: '#ffffff',
      textAlign: 'left',
      padding: '18px'
    });
    await postForm(baseUrl, jar, `/campaigns/${secondId}/send`, {});
    await waitFor(async () => {
      const jobsPage = await request(baseUrl, jar, '/jobs');
      const jobsHtml = await jobsPage.text();
      assert.match(jobsHtml, /deliver_campaign/);
      assert.match(jobsHtml, /completed/);
      return true;
    });
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
