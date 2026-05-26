import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import {
  CLIENT_SHELL_RUNTIME_CONTRACT,
  activeRouteForPath,
  buildClientShellState,
  buildCommandPalette,
  commitShellNavigation,
  normalizeRouteManifest,
  previewShellRoute,
  serializeClientShellState,
  setShellQuery
} from '../apps/web/public/app-shell-client.mjs';
import { CookieJar, createTempDataDir, loginAsSeededOwner, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('frontend client shell runtime resolves routes, command palette, previews, commits, and serializes recent work', () => {
  const manifest = normalizeRouteManifest({
    routes: [
      { id: 'dashboard', label: 'Dashboard', href: '/app', group: 'workspace', keywords: ['home'] },
      { id: 'campaigns', label: 'Campaigns', href: '/campaigns', group: 'create', keywords: ['email', 'editor'] },
      { id: 'reports', label: 'Reports', href: '/reports', group: 'insights', keywords: ['analytics'] }
    ],
    actions: [{ id: 'new_campaign', label: 'Create campaign', href: '/campaigns/new', group: 'create', keywords: ['draft'] }]
  });
  assert.equal(manifest.surfaceId, CLIENT_SHELL_RUNTIME_CONTRACT.surfaceId);
  assert.equal(activeRouteForPath(manifest.routes, '/campaigns/camp_123/editor').id, 'campaigns');

  let state = buildClientShellState({ manifest, currentPath: '/campaigns/camp_123/editor', recentWork: [] });
  assert.equal(state.activeRoute.id, 'campaigns');
  assert.ok(state.commands.some((command) => command.id === 'new_campaign'));

  state = setShellQuery(state, 'analytics');
  assert.equal(state.paletteOpen, true);
  assert.equal(buildCommandPalette(state, 'analytics')[0].id, 'reports');

  state = previewShellRoute(state, '/reports');
  assert.equal(state.previewPath, '/reports');
  assert.equal(state.activeRoute.id, 'reports');

  state = commitShellNavigation(state, { href: '/campaigns/new', label: 'Create campaign' });
  assert.equal(state.currentPath, '/campaigns/new');
  assert.equal(state.paletteOpen, false);
  assert.equal(state.recentWork[0].href, '/campaigns/new');
  const serialized = JSON.parse(serializeClientShellState(state));
  assert.equal(serialized.surfaceId, 'frontend_full_client_application_runtime_layer');
  assert.equal(serialized.recentWork.length, 1);
});

test('authenticated app serves full client shell manifest, module, runtime API, and preserves editor/designer modules', async () => {
  const { server, baseUrl } = await boot();
  try {
    const { jar } = await loginAsSeededOwner(baseUrl);
    const app = await request(baseUrl, jar, '/app');
    const html = await app.text();
    assert.match(html, /data-client-shell="interactive"/);
    assert.match(html, /progressive-client-runtime/);
    assert.match(html, /\/static\/app-shell-client\.mjs/);
    assert.match(html, /mailclone-client-shell-config/);

    const moduleRes = await request(baseUrl, new CookieJar(), '/static/app-shell-client.mjs');
    const moduleSource = await moduleRes.text();
    assert.match(moduleSource, /CLIENT_SHELL_RUNTIME_CONTRACT/);
    assert.match(moduleSource, /attachMailcloneClientShell/);
    assert.match(moduleSource, /command_palette_navigation/);

    const legacyModule = await request(baseUrl, new CookieJar(), '/static/app-shell.jsx');
    assert.match(await legacyModule.text(), /app-shell-client\.mjs/);

    const manifestRes = await request(baseUrl, new CookieJar(), '/static/app-shell-manifest.json');
    const manifest = await manifestRes.json();
    assert.equal(manifest.surfaceId, 'frontend_full_client_application_runtime_layer');
    assert.equal(manifest.shell.module, '/static/app-shell-client.mjs');
    assert.ok(manifest.routes.some((route) => route.href === '/jobs/operations'));
    assert.ok(manifest.controls.includes('command_palette_navigation'));

    const runtimeRes = await request(baseUrl, jar, '/api/client-shell/runtime?path=/campaigns');
    const runtime = await runtimeRes.json();
    assert.equal(runtime.ok, true);
    assert.equal(runtime.authenticated, true);
    assert.equal(runtime.surfaceId, 'frontend_full_client_application_runtime_layer');
    assert.equal(runtime.runtime.currentPath, '/campaigns');
    assert.ok(runtime.evidence.includes('workspace_context_bound_to_shell'));

    const editorModule = await request(baseUrl, new CookieJar(), '/static/editor-client.mjs');
    assert.match(await editorModule.text(), /attachCampaignEditor/);
    const websiteModule = await request(baseUrl, new CookieJar(), '/static/website-designer-client.mjs');
    assert.match(await websiteModule.text(), /attachWebsiteDesigner/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
