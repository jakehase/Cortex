import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createTempDataDir, loginAsSeededOwner, postForm, request } from './helpers.mjs';
import {
  CAMPAIGN_EDITOR_VISUAL_BUILDER_CONTRACT,
  applyAssetTransform,
  applyVisualStylePatch,
  buildBlockInspectorState,
  createEditorState,
  renderPersonalizationPreview,
  serializeEditorState
} from '../apps/web/public/editor-client.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('campaign editor visual builder client models inspector, style patches, asset transforms, and personalization preview', () => {
  let state = createEditorState({
    blocks: [
      { id: 'hero', type: 'hero', sectionName: 'Hero', title: 'Hi *|FNAME|*', body: 'Launch body', assetId: 'asset_hero', widthPercent: 80 }
    ]
  });
  assert.equal(CAMPAIGN_EDITOR_VISUAL_BUILDER_CONTRACT.surfaceId, 'campaign_editor_visual_builder_runtime_layer');
  let inspector = buildBlockInspectorState(state, 'hero');
  assert.equal(inspector.style.widthPercent, 80);
  assert.ok(inspector.editableFields.includes('focalPoint'));

  state = applyVisualStylePatch(state, 'hero', { stylePreset: 'promo', alignment: 'center', widthPercent: 66, backgroundColor: '#eef4ff' });
  assert.equal(state.blocks[0].stylePreset, 'promo');
  assert.equal(state.blocks[0].widthPercent, 66);

  state = applyAssetTransform(state, 'hero', { assetId: 'asset_hero', imageFit: 'contain', imageCrop: 'square', focalX: 35, focalY: 65, altText: 'Hero product shot' });
  assert.equal(state.blocks[0].imageFit, 'contain');
  assert.equal(state.blocks[0].assetTransform.focalPoint.y, 65);
  inspector = buildBlockInspectorState(state, 'hero');
  assert.equal(inspector.asset.imageCrop, 'square');

  const preview = renderPersonalizationPreview(state.blocks[0], { firstName: 'Mira', email: 'mira@example.com' });
  assert.equal(preview.title, 'Hi Mira');
  const serialized = JSON.parse(serializeEditorState(state));
  assert.equal(serialized.visualBuilder.surfaceId, 'campaign_editor_visual_builder_runtime_layer');
});

test('campaign editor route persists visual runtime patches and exposes API evidence', async () => {
  const { server, baseUrl } = await boot();
  try {
    const { jar, campaignId } = await loginAsSeededOwner(baseUrl);
    await postForm(baseUrl, jar, '/assets', {
      name: 'hero-product.png',
      folder: 'Campaign assets',
      contentType: 'image/png',
      altText: 'Hero product',
      body: 'png bytes placeholder'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/add-block`, { type: 'image', preset: 'hero' });

    let page = await request(baseUrl, jar, `/campaigns/${campaignId}/editor`);
    let html = await page.text();
    assert.match(html, /visual block inspector/i);
    assert.match(html, /asset transform studio/i);
    assert.match(html, /\/api\/campaigns\/camp_[a-f0-9]+\/editor\/runtime/);

    const assetId = server.state.db.assets.find((asset) => asset.name === 'hero-product.png').id;
    const visualPatch = await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/0/visual`, {
      panel: 'design',
      stylePreset: 'promo',
      alignment: 'center',
      widthPercent: '72',
      backgroundColor: '#fff4cc',
      textColor: '#18212f',
      padding: '32px',
      assetId,
      imageFit: 'contain',
      imageCrop: 'square',
      focalX: '30',
      focalY: '70',
      imageAlt: 'Hero product cropped square',
      mergeTags: 'FNAME,EMAIL',
      previewFirstName: 'Jordan',
      previewEmail: 'jordan@example.com'
    });
    assert.equal(visualPatch.status, 302);

    const campaign = server.state.db.campaigns.find((entry) => entry.id === campaignId);
    assert.equal(campaign.blocks[0].stylePreset, 'promo');
    assert.equal(campaign.blocks[0].widthPercent, 72);
    assert.equal(campaign.blocks[0].imageFit, 'contain');
    assert.equal(campaign.editorRuntime.assetTransforms[0].focalPoint.x, 30);
    assert.equal(campaign.editorRuntime.personalizationPreviews[0].preview.contact.FNAME, 'Jordan');

    const api = await request(baseUrl, jar, `/api/campaigns/${campaignId}/editor/runtime`);
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.editorRuntime.surfaceId, 'campaign_editor_visual_builder_runtime_layer');
    assert.equal(payload.editorRuntime.inspectorCount >= 1, true);
    assert.equal(payload.editorRuntime.assetTransformCount >= 1, true);
    assert.ok(payload.editorRuntime.evidenceContract.includes('crop_fit_focal_point_asset_transform'));

    page = await request(baseUrl, jar, `/campaigns/${campaignId}/editor`);
    html = await page.text();
    assert.match(html, /Hero product cropped square/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
