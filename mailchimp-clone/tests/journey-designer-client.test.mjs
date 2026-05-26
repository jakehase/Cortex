import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJourneyDesignerState,
  duplicateJourneyNode,
  reorderJourneyNode,
  redoJourneyDesigner,
  serializeJourneyDesigner,
  setJourneyCanvasMode,
  setJourneyPreviewContact,
  undoJourneyDesigner,
  updateBranchConditions
} from '../apps/web/public/journey-designer-client.mjs';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('journey designer client state supports reorder, duplicate, branch mutation, preview, undo/redo, and serialization', () => {
  let state = buildJourneyDesignerState({
    automationId: 'journey_1',
    name: 'Welcome Journey',
    trigger: 'contact_subscribed',
    nodes: [
      { id: 'n1', type: 'email', title: 'Welcome email' },
      { id: 'n2', type: 'branch', title: 'Opened?', conditions: ['opened'] },
      { id: 'n3', type: 'delay', title: 'Wait one day', delayHours: 24 }
    ]
  });
  state = reorderJourneyNode(state, 'n3', 'up');
  assert.deepEqual(state.nodes.map((node) => node.id), ['n1', 'n3', 'n2']);
  state = duplicateJourneyNode(state, 'n1');
  assert.equal(state.nodes[1].title, 'Welcome email copy');
  state = updateBranchConditions(state, 'n2', ['clicked', 'purchased']);
  assert.deepEqual(state.nodes.find((node) => node.id === 'n2').conditions, ['clicked', 'purchased']);
  state = setJourneyPreviewContact(state, { segment: 'vip', activity: 'clicked_campaign' });
  assert.equal(state.previewContact.segment, 'vip');
  state = setJourneyCanvasMode(state, 'runtime');
  assert.equal(state.canvasMode, 'runtime');
  const serialized = JSON.parse(serializeJourneyDesigner(state));
  assert.equal(serialized.automationId, 'journey_1');
  assert.equal(serialized.nodes.length, 4);
  const undone = undoJourneyDesigner(state);
  assert.equal(undone.canvasMode, 'design');
  const redone = redoJourneyDesigner(undone);
  assert.equal(redone.canvasMode, 'runtime');
});

test('automation builder serves the journey designer module while preserving durable server forms', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Journey Designer Admin',
      email: 'journey-designer@example.com',
      password: 'secret123',
      workspaceName: 'Journey Lab'
    });
    await followRedirect(baseUrl, jar, signup);
    const audienceId = server.state.db.audiences[0].id;
    const created = await postForm(baseUrl, jar, '/automations', {
      name: 'Visual Welcome Journey',
      audienceId,
      trigger: 'contact_subscribed'
    });
    const builderLocation = created.headers.get('location');
    const automationId = builderLocation.match(/journey_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, '/automations/' + automationId + '/builder/nodes', { type: 'email', title: 'Welcome email' });
    await postForm(baseUrl, jar, '/automations/' + automationId + '/builder/nodes', { type: 'branch', title: 'Clicked?', conditions: 'clicked' });

    const moduleResponse = await request(baseUrl, jar, '/static/journey-designer-client.mjs');
    assert.equal(moduleResponse.status, 200);
    assert.match(await moduleResponse.text(), /attachJourneyDesigner/);

    const builder = await request(baseUrl, jar, '/automations/' + automationId + '/builder');
    const html = await builder.text();
    assert.match(html, /data-journey-designer-client/);
    assert.match(html, /Journey visual orchestration/);
    assert.match(html, /data-serialized-journey-state/);
    assert.match(html, /Add node/);
    assert.match(html, /Publish/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
