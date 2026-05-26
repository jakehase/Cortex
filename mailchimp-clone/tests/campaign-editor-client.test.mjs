import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, loginAsSeededOwner, request } from './helpers.mjs';
import { createEditorState, duplicateBlock, moveBlock, redoEditorChange, serializeEditorState, setViewport, undoEditorChange, updateBlock } from '../apps/web/public/editor-client.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('campaign editor client state supports reorder, duplicate, update, viewport, undo, and redo', () => {
  let state = createEditorState({
    settings: { brandTone: 'editorial', layoutDensity: 'airy' },
    blocks: [
      { id: 'hero', type: 'hero', sectionName: 'Hero', title: 'Launch' },
      { id: 'cta', type: 'button', sectionName: 'CTA', title: 'Act', buttonLabel: 'Buy now' }
    ]
  });

  state = moveBlock(state, 1, 0);
  assert.equal(state.blocks[0].id, 'cta');
  assert.equal(state.selectedBlockId, 'cta');

  state = duplicateBlock(state, 'cta');
  assert.equal(state.blocks.length, 3);
  assert.match(state.blocks[1].sectionName, /copy/);

  const duplicateId = state.blocks[1].id;
  state = updateBlock(state, duplicateId, { title: 'Updated CTA', body: 'Client-side draft copy' });
  assert.equal(state.blocks[1].title, 'Updated CTA');
  assert.equal(state.blocks[1].body, 'Client-side draft copy');

  state = setViewport(state, 'mobile');
  assert.equal(state.viewport, 'mobile');
  assert.equal(state.dirty, true);
  assert.match(serializeEditorState(state), /Updated CTA/);

  const beforeUndo = state.blocks[1].title;
  state = undoEditorChange(state);
  assert.notEqual(state.blocks[1]?.title, beforeUndo);
  state = redoEditorChange(state);
  assert.equal(state.blocks[1].title, beforeUndo);
});

test('campaign editor route serves rich client canvas and static editor module', async () => {
  const { server, baseUrl } = await boot();
  try {
    const { jar, campaignId } = await loginAsSeededOwner(baseUrl);
    const editor = await request(baseUrl, jar, `/campaigns/${campaignId}/editor`);
    const html = await editor.text();
    assert.match(html, /Rich client canvas/);
    assert.match(html, /data-campaign-editor-client/);
    assert.match(html, /campaign-editor-state-/);
    assert.match(html, /\/static\/editor-client\.mjs/);
    assert.match(html, /Client-side drag\/reorder/);

    const moduleRes = await request(baseUrl, new CookieJar(), '/static/editor-client.mjs');
    const moduleSource = await moduleRes.text();
    assert.match(moduleSource, /attachCampaignEditor/);
    assert.match(moduleSource, /moveBlock/);
    assert.match(moduleSource, /dragstart/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
