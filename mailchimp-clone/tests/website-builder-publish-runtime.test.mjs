import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import {
  WEBSITE_BUILDER_PUBLISH_RUNTIME_CONTRACT,
  applyWebsiteRuntimePatch,
  buildPublishReadinessChecklist,
  buildWebsiteSeoInspectorState,
  createPageExperimentVariant,
  createWebsiteDesignerState,
  serializeDesignerState
} from '../apps/web/public/website-designer-client.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('website builder client models SEO inspector, publish checklist, runtime patch, and experiment variants', () => {
  let state = createWebsiteDesignerState({
    website: {
      defaultDomain: 'launch.example.test',
      canonicalBaseUrl: 'https://launch.example.test',
      themePreset: 'commerce',
      robotsIndex: true
    },
    pages: [
      {
        id: 'home',
        name: 'Home',
        slug: '',
        pageType: 'home',
        headline: 'Launch better campaigns',
        seoTitle: 'Launch better campaigns with Mailclone',
        seoDescription: 'Build a launch website with SEO, analytics, forms, and campaign handoffs.'
      }
    ]
  });

  assert.equal(WEBSITE_BUILDER_PUBLISH_RUNTIME_CONTRACT.surfaceId, 'website_builder_publish_runtime_layer');
  const inspector = buildWebsiteSeoInspectorState(state, 'home');
  assert.equal(inspector.score >= 70, true);
  assert.match(inspector.canonicalUrl, /launch\.example\.test/);

  const checklist = buildPublishReadinessChecklist(state);
  assert.equal(checklist.find((entry) => entry.id === 'seo_ready').ok, true);

  state = applyWebsiteRuntimePatch(state, 'home', {
    seoTitle: 'Homepage SEO title for runtime patch',
    seoDescription: 'A longer SEO description written through the publish runtime patch model.',
    analyticsGoal: 'signup',
    canonicalPath: '/',
    defaultDomain: 'runtime.example.test'
  });
  assert.equal(state.pages[0].analyticsGoal, 'signup');
  assert.equal(state.theme.defaultDomain, 'runtime.example.test');

  state = createPageExperimentVariant(state, 'home', {
    name: 'Hero CTA test',
    headline: 'Start selling today',
    ctaLabel: 'Start now',
    trafficSplit: 40
  });
  assert.equal(state.experiments[0].trafficSplit, 40);
  const serialized = JSON.parse(serializeDesignerState(state));
  assert.equal(serialized.publishRuntime.surfaceId, 'website_builder_publish_runtime_layer');
  assert.equal(serialized.experiments.length, 1);
});

test('website builder route persists publish runtime snapshots, SEO audits, experiments, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Website Runtime Admin',
      email: 'website-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Website Runtime Lab'
    }));

    await postForm(baseUrl, jar, '/websites', {
      name: 'Runtime Site',
      slug: 'runtime-site',
      seoTitle: 'Runtime Site SEO Title',
      seoDescription: 'A runtime-ready website builder site with publish evidence and SEO metadata.'
    });
    const website = server.state.db.websites.find((entry) => entry.slug === 'runtime-site');
    assert.ok(website);
    const home = server.state.db.websitePages.find((entry) => entry.websiteId === website.id && entry.slug === '');
    await postForm(baseUrl, jar, `/websites/${website.id}/pages/${home.id}`, {
      name: 'Home',
      slug: '',
      headline: 'Runtime launch site',
      body: 'This page is ready for SEO and analytics runtime checks.',
      seoTitle: 'Runtime launch site homepage',
      seoDescription: 'Runtime launch site homepage with a durable website builder publish-readiness flow.',
      ctaLabel: 'Join now',
      ctaUrl: '/forms',
      showInNav: 'on'
    });

    let builder = await request(baseUrl, jar, `/websites/${website.id}`);
    let html = await builder.text();
    assert.match(html, /Publish runtime/);
    assert.match(html, /Open website runtime API/);
    assert.match(html, /SEO score/);

    const audit = await postForm(baseUrl, jar, `/websites/${website.id}/seo-audit`, {});
    assert.equal(audit.status, 302);
    assert.equal(server.state.db.websiteSeoAudits.length, 1);

    const experiment = await postForm(baseUrl, jar, `/websites/${website.id}/experiments`, {
      pageId: home.id,
      name: 'Runtime hero experiment',
      hypothesis: 'Sharper CTA improves signups',
      headline: 'Build your launch hub',
      ctaLabel: 'Launch now',
      trafficSplit: '35'
    });
    assert.equal(experiment.status, 302);
    assert.equal(server.state.db.websiteExperiments[0].trafficSplit, 35);

    const snapshot = await postForm(baseUrl, jar, `/websites/${website.id}/runtime/snapshot`, {});
    assert.equal(snapshot.status, 302);
    assert.equal(server.state.db.websiteRuntimeSnapshots.length >= 3, true);

    const api = await request(baseUrl, jar, `/api/websites/${website.id}/runtime`);
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.websiteRuntime.surfaceId, 'website_builder_publish_runtime_layer');
    assert.equal(payload.websiteRuntime.experimentCount, 1);
    assert.equal(payload.websiteRuntime.recentSeoAudits.length, 1);
    assert.ok(payload.websiteRuntime.evidenceContract.includes('publish_readiness_checklist'));

    await postForm(baseUrl, jar, `/websites/${website.id}/publish`, {});
    assert.equal(server.state.db.websitePublishes.length, 1);
    assert.equal(server.state.db.websiteRuntimeSnapshots.some((entry) => entry.reason === 'publish'), true);

    builder = await request(baseUrl, jar, `/websites/${website.id}`);
    html = await builder.text();
    assert.match(html, /Runtime hero experiment/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
