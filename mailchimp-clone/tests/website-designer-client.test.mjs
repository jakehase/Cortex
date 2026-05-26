import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import { createWebsiteDesignerState, duplicatePage, movePage, redoDesignerChange, serializeDesignerState, setDesignerViewport, undoDesignerChange, updateDesignerPage, updateTheme } from '../apps/web/public/website-designer-client.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('website designer client state supports page reorder, duplicate, theme update, viewport, undo, and redo', () => {
  let state = createWebsiteDesignerState({
    website: { themePreset: 'modern', primaryColor: '#112233', secondaryColor: '#445566', headingFont: 'Inter', bodyFont: 'Arial' },
    pages: [
      { id: 'home', name: 'Home', slug: '', headline: 'Welcome' },
      { id: 'about', name: 'About', slug: 'about', headline: 'About us' }
    ]
  });

  state = movePage(state, 1, 0);
  assert.equal(state.pages[0].id, 'about');
  assert.equal(state.selectedPageId, 'about');

  state = duplicatePage(state, 'about');
  assert.equal(state.pages.length, 3);
  assert.match(state.pages[1].name, /copy/);

  const duplicateId = state.pages[1].id;
  state = updateDesignerPage(state, duplicateId, { headline: 'Updated visual page', body: 'Drafted in visual designer' });
  assert.equal(state.pages[1].headline, 'Updated visual page');

  state = updateTheme(state, { themePreset: 'editorial', primaryColor: '#abcdef' });
  assert.equal(state.theme.themePreset, 'editorial');
  state = setDesignerViewport(state, 'mobile');
  assert.equal(state.viewport, 'mobile');
  assert.match(serializeDesignerState(state), /Updated visual page/);

  const beforeUndo = state.theme.themePreset;
  state = undoDesignerChange(state);
  assert.notEqual(state.theme.themePreset, beforeUndo);
  state = redoDesignerChange(state);
  assert.equal(state.theme.themePreset, beforeUndo);
});

test('website builder route serves visual designer client and static module', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Website Designer Admin',
      email: 'designer@example.com',
      password: 'secret123',
      workspaceName: 'Designer Lab'
    }));

    await postForm(baseUrl, jar, '/websites', {
      name: 'Designer Site',
      slug: 'designer-site',
      seoDescription: 'Visual designer site'
    });
    const website = server.state.db.websites.find((entry) => entry.slug === 'designer-site');
    assert.ok(website);

    const builder = await request(baseUrl, jar, `/websites/${website.id}`);
    const html = await builder.text();
    assert.match(html, /Visual site designer/);
    assert.match(html, /data-website-designer-client/);
    assert.match(html, /website-designer-state-/);
    assert.match(html, /\/static\/website-designer-client\.mjs/);
    assert.match(html, /Client-side site map reordering/);

    const moduleRes = await request(baseUrl, new CookieJar(), '/static/website-designer-client.mjs');
    const moduleSource = await moduleRes.text();
    assert.match(moduleSource, /attachWebsiteDesigner/);
    assert.match(moduleSource, /movePage/);
    assert.match(moduleSource, /dragstart/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
