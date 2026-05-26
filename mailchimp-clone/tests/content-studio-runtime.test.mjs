import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CONTENT_STUDIO_RUNTIME_CONTRACT, buildContentStudioRuntimeSnapshot } from '../packages/app/domain-template-assets.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('content studio runtime builds asset lifecycle, template review, governance, usage telemetry, and API evidence', async () => {
  assert.equal(CONTENT_STUDIO_RUNTIME_CONTRACT.surfaceId, 'content_studio_template_asset_runtime_layer');
  assert.ok(CONTENT_STUDIO_RUNTIME_CONTRACT.evidenceContract.includes('asset_lifecycle_approval_ledger'));

  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Content Runtime Admin',
      email: 'content-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Content Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/assets', {
      name: 'hero-runtime.txt',
      folder: 'Runtime',
      contentType: 'text/plain',
      altText: 'Runtime hero',
      body: 'hero runtime body'
    });
    await postForm(baseUrl, jar, '/content/brand-kit', {
      name: 'Runtime brand kit',
      logoAssetName: 'hero-runtime.txt',
      primaryColor: '#1144aa',
      secondaryColor: '#101828',
      headingFont: 'Inter',
      bodyFont: 'Georgia'
    });
    await postForm(baseUrl, jar, '/content/templates', {
      name: 'Runtime leadership brief',
      baseTemplateId: 'tmpl-newsletter',
      category: 'Lifecycle',
      description: 'Reusable runtime briefing template'
    });
    await postForm(baseUrl, jar, '/content/collections', {
      name: 'Runtime launch kit',
      purpose: 'Runtime evidence assets',
      assetNames: 'hero-runtime.txt'
    });

    const asset = server.state.db.assets.find((entry) => entry.name === 'hero-runtime.txt');
    const template = server.state.db.contentTemplates.find((entry) => entry.name === 'Runtime leadership brief');

    await postForm(baseUrl, jar, '/content/assets/runtime', {
      assetId: asset.id,
      action: 'approved_for_use',
      status: 'approved',
      metadata: '{"altTextReviewed":true}'
    });
    await postForm(baseUrl, jar, '/content/templates/review', {
      templateId: template.id,
      reviewStage: 'brand_review',
      decision: 'approved',
      comments: 'Ready for campaign handoff'
    });
    await postForm(baseUrl, jar, '/content/usage', {
      objectType: 'template',
      objectId: template.id,
      objectName: template.name,
      channel: 'email',
      campaignId: 'campaign_runtime_1',
      placement: 'campaign_builder',
      metricName: 'campaign_apply',
      metricValue: '2'
    });
    await postForm(baseUrl, jar, '/content/governance', {
      policy: 'brand_color_contrast',
      scope: 'brand_kit',
      result: 'passed',
      violations: ''
    });
    await postForm(baseUrl, jar, '/content/runtime/snapshot', {});

    const contentPage = await request(baseUrl, jar, '/content');
    const contentHtml = await contentPage.text();
    assert.match(contentHtml, /Content runtime/);
    assert.match(contentHtml, /Runtime leadership brief/);
    assert.match(contentHtml, /approved/);

    const workspacesPage = await request(baseUrl, jar, '/workspaces');
    const apiKey = (await workspacesPage.text()).match(/key_[a-f0-9]+/)[0];
    const apiRuntime = await request(baseUrl, null, '/api/content/runtime', {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    const payload = await apiRuntime.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.contentRuntime.assetLifecycleEventCount, 1);
    assert.equal(payload.contentRuntime.templateReviewEventCount, 1);
    assert.equal(payload.contentRuntime.usageTelemetryEventCount, 1);
    assert.equal(payload.contentRuntime.governanceEventCount, 1);
    assert.equal(payload.contentRuntime.approvedAssetCount, 1);
    assert.equal(payload.contentRuntime.approvedTemplateCount, 1);
    assert.ok(payload.contentRuntime.evidenceContract.includes('content_usage_telemetry'));

    const snapshot = buildContentStudioRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.templateReviewQueue[0].reviewStatus, 'approved');
    assert.equal(server.state.db.contentRuntimeSnapshots.length, 1);
    assert.equal(server.state.db.contentAssetLifecycleEvents[0].assetName, 'hero-runtime.txt');
    assert.equal(server.state.db.contentTemplateReviewEvents[0].lineage.blocks >= 1, true);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
