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

test('Wave 2 content asset templates: brand kit, reusable templates, collections, and API visibility', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Content Admin',
      email: 'content@example.com',
      password: 'secret123',
      workspaceName: 'Content Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/assets', {
      name: 'hero.txt',
      folder: 'Wave 2',
      contentType: 'text/plain',
      altText: 'Hero asset',
      body: 'hero body'
    });
    await postForm(baseUrl, jar, '/content/brand-kit', {
      name: 'Launch brand kit',
      logoAssetName: 'hero.txt',
      primaryColor: '#1144aa',
      secondaryColor: '#101828',
      headingFont: 'Inter',
      bodyFont: 'Georgia'
    });
    await postForm(baseUrl, jar, '/content/templates', {
      name: 'Leadership brief',
      baseTemplateId: 'tmpl-newsletter',
      category: 'Internal',
      description: 'Reusable briefing template'
    });
    await postForm(baseUrl, jar, '/content/collections', {
      name: 'Q2 launch kit',
      purpose: 'Executive launch assets',
      assetNames: 'hero.txt, banner.txt'
    });

    const contentPage = await request(baseUrl, jar, '/content');
    const contentHtml = await contentPage.text();
    assert.match(contentHtml, /Launch brand kit/);
    assert.match(contentHtml, /Leadership brief/);
    assert.match(contentHtml, /Q2 launch kit/);
    assert.match(contentHtml, /hero.txt/);

    const workspacesPage = await request(baseUrl, jar, '/workspaces');
    const apiKey = (await workspacesPage.text()).match(/key_[a-f0-9]+/)[0];
    const apiTemplates = await request(baseUrl, null, '/api/content/templates', {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    const payload = await apiTemplates.json();
    assert.equal(payload.ok, true);
    assert.ok(payload.content.savedTemplates >= 1);
    assert.match(payload.templates.map((entry) => entry.name).join(','), /Leadership brief/);
    assert.equal(server.state.db.brandKits[0].logoAssetName, 'hero.txt');
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
