export const CAMPAIGN_EDITOR_VISUAL_BUILDER_CONTRACT = Object.freeze({
  surfaceId: 'campaign_editor_visual_builder_runtime_layer',
  label: 'Campaign editor visual builder runtime',
  controls: [
    'block_inspector_state',
    'asset_transform_state',
    'style_token_mutation',
    'personalization_preview',
    'serialized_visual_runtime_state',
    'server_durable_visual_patch_handoff'
  ],
  evidenceContract: [
    'client_visual_inspector_model',
    'asset_crop_fit_focal_point_transform',
    'style_and_layout_mutation_history',
    'merge_tag_preview_rendering',
    'campaign_editor_runtime_api_evidence'
  ]
});

export function normalizeEditorBlock(block = {}, index = 0) {
  return {
    id: block.id || `block-${index + 1}`,
    type: block.type || 'text',
    sectionName: block.sectionName || block.title || `Block ${index + 1}`,
    title: block.title || '',
    body: block.body || '',
    buttonLabel: block.buttonLabel || '',
    buttonUrl: block.buttonUrl || '',
    buttonStyle: block.buttonStyle || 'primary',
    assetId: block.assetId || '',
    imageAlt: block.imageAlt || block.altText || '',
    backgroundColor: block.backgroundColor || '',
    textColor: block.textColor || '',
    padding: block.padding || '',
    stylePreset: block.stylePreset || (block.type === 'hero' ? 'hero' : 'default'),
    alignment: block.alignment || block.textAlign || 'left',
    widthPercent: Number(block.widthPercent || 100),
    imageFit: block.imageFit || 'cover',
    imageCrop: block.imageCrop || 'center',
    focalPoint: block.focalPoint || { x: Number(block.focalX ?? 50), y: Number(block.focalY ?? 50) },
    personalization: block.personalization || { mergeTags: [], fallback: '' },
    assetTransform: block.assetTransform || null,
    hidden: Boolean(block.hidden),
    locked: Boolean(block.locked)
  };
}

export function createEditorState({ blocks = [], settings = {}, viewport = 'desktop' } = {}) {
  return {
    version: 1,
    viewport,
    dirty: false,
    selectedBlockId: blocks[0]?.id || 'block-1',
    settings: {
      brandTone: settings.brandTone || 'confident',
      layoutDensity: settings.layoutDensity || 'balanced',
      audienceAngle: settings.audienceAngle || 'product value',
      heroStyle: settings.heroStyle || 'feature-led'
    },
    blocks: blocks.map((block, index) => normalizeEditorBlock(block, index)),
    history: [],
    future: []
  };
}

function snapshot(state) {
  return {
    viewport: state.viewport,
    selectedBlockId: state.selectedBlockId,
    settings: { ...state.settings },
    blocks: state.blocks.map((block) => ({ ...block }))
  };
}

function restoreSnapshot(state, snap) {
  return { ...state, viewport: snap.viewport, selectedBlockId: snap.selectedBlockId, settings: { ...snap.settings }, blocks: snap.blocks.map((block) => ({ ...block })) };
}

function withHistory(state, updater) {
  const next = updater({ ...state, blocks: state.blocks.map((block) => ({ ...block })), settings: { ...state.settings } });
  return { ...next, dirty: true, history: [...(state.history || []), snapshot(state)].slice(-25), future: [] };
}

export function moveBlock(state, fromIndex, toIndex) {
  return withHistory(state, (draft) => {
    if (fromIndex < 0 || fromIndex >= draft.blocks.length || toIndex < 0 || toIndex >= draft.blocks.length) return draft;
    const [block] = draft.blocks.splice(fromIndex, 1);
    draft.blocks.splice(toIndex, 0, block);
    draft.selectedBlockId = block.id;
    return draft;
  });
}

export function duplicateBlock(state, blockId) {
  return withHistory(state, (draft) => {
    const index = draft.blocks.findIndex((block) => block.id === blockId);
    if (index === -1) return draft;
    const duplicate = { ...draft.blocks[index], id: `${draft.blocks[index].id}-copy-${Date.now()}`, sectionName: `${draft.blocks[index].sectionName} copy` };
    draft.blocks.splice(index + 1, 0, duplicate);
    draft.selectedBlockId = duplicate.id;
    return draft;
  });
}

export function updateBlock(state, blockId, patch = {}) {
  return withHistory(state, (draft) => {
    draft.blocks = draft.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block);
    draft.selectedBlockId = blockId;
    return draft;
  });
}

export function buildBlockInspectorState(state, blockId = state.selectedBlockId) {
  const block = state.blocks.find((entry) => entry.id === blockId) || state.blocks[0] || normalizeEditorBlock({}, 0);
  return {
    ...CAMPAIGN_EDITOR_VISUAL_BUILDER_CONTRACT,
    blockId: block.id,
    panel: 'design',
    editableFields: ['sectionName', 'title', 'body', 'stylePreset', 'alignment', 'widthPercent', 'backgroundColor', 'textColor', 'padding', 'assetId', 'imageFit', 'imageCrop', 'focalPoint'],
    style: {
      preset: block.stylePreset,
      alignment: block.alignment,
      widthPercent: block.widthPercent,
      backgroundColor: block.backgroundColor,
      textColor: block.textColor,
      padding: block.padding
    },
    asset: {
      assetId: block.assetId,
      imageAlt: block.imageAlt,
      imageFit: block.imageFit,
      imageCrop: block.imageCrop,
      focalPoint: block.focalPoint,
      transform: block.assetTransform
    },
    personalization: block.personalization || { mergeTags: [], fallback: '' }
  };
}

export function applyVisualStylePatch(state, blockId, patch = {}) {
  const normalized = {
    stylePreset: patch.stylePreset,
    alignment: patch.alignment,
    widthPercent: patch.widthPercent == null ? undefined : Number(patch.widthPercent),
    backgroundColor: patch.backgroundColor,
    textColor: patch.textColor,
    padding: patch.padding
  };
  Object.keys(normalized).forEach((key) => normalized[key] === undefined && delete normalized[key]);
  return updateBlock(state, blockId, normalized);
}

export function applyAssetTransform(state, blockId, transform = {}) {
  const assetTransform = {
    crop: transform.crop || transform.imageCrop || 'center',
    fit: transform.fit || transform.imageFit || 'cover',
    focalPoint: {
      x: Number(transform.focalX ?? transform.focalPoint?.x ?? 50),
      y: Number(transform.focalY ?? transform.focalPoint?.y ?? 50)
    },
    altText: transform.altText || transform.imageAlt || '',
    appliedAt: transform.appliedAt || new Date().toISOString()
  };
  return updateBlock(state, blockId, {
    assetId: transform.assetId,
    imageAlt: assetTransform.altText,
    imageFit: assetTransform.fit,
    imageCrop: assetTransform.crop,
    focalPoint: assetTransform.focalPoint,
    assetTransform
  });
}

export function renderPersonalizationPreview(block = {}, contact = {}) {
  const replacements = {
    FNAME: contact.firstName || contact.name || block.personalization?.fallback || 'Friend',
    LNAME: contact.lastName || '',
    EMAIL: contact.email || 'subscriber@example.com'
  };
  const render = (value = '') => String(value).replace(/\*\|([A-Z_]+)\|\*/g, (_, key) => replacements[key] ?? block.personalization?.fallback ?? '');
  return {
    title: render(block.title),
    body: render(block.body),
    buttonLabel: render(block.buttonLabel),
    contact: { email: replacements.EMAIL, firstName: replacements.FNAME, lastName: replacements.LNAME }
  };
}

export function setViewport(state, viewport = 'desktop') {
  return { ...state, viewport, dirty: true };
}

export function undoEditorChange(state) {
  const history = [...(state.history || [])];
  const previous = history.pop();
  if (!previous) return state;
  return { ...restoreSnapshot(state, previous), dirty: true, history, future: [snapshot(state), ...(state.future || [])].slice(0, 25) };
}

export function redoEditorChange(state) {
  const future = [...(state.future || [])];
  const nextSnap = future.shift();
  if (!nextSnap) return state;
  return { ...restoreSnapshot(state, nextSnap), dirty: true, history: [...(state.history || []), snapshot(state)].slice(-25), future };
}

export function serializeEditorState(state) {
  return JSON.stringify({ version: state.version, viewport: state.viewport, selectedBlockId: state.selectedBlockId, settings: state.settings, blocks: state.blocks, visualBuilder: CAMPAIGN_EDITOR_VISUAL_BUILDER_CONTRACT }, null, 2);
}

function renderClientEditor(root, state) {
  const inspector = buildBlockInspectorState(state, state.selectedBlockId);
  const selectedBlock = state.blocks.find((block) => block.id === state.selectedBlockId) || state.blocks[0] || {};
  const personalizationPreview = renderPersonalizationPreview(selectedBlock, { firstName: 'Avery', email: 'avery@example.com' });
  root.innerHTML = `
    <div class="client-editor-toolbar" role="toolbar" aria-label="Campaign editor client controls">
      <strong>Interactive editor canvas</strong>
      <button type="button" data-editor-viewport="desktop" aria-pressed="${state.viewport === 'desktop'}">Desktop</button>
      <button type="button" data-editor-viewport="mobile" aria-pressed="${state.viewport === 'mobile'}">Mobile</button>
      <button type="button" data-editor-undo ${state.history.length ? '' : 'disabled'}>Undo</button>
      <button type="button" data-editor-redo ${state.future.length ? '' : 'disabled'}>Redo</button>
      <span class="pill">${state.dirty ? 'Unsaved client changes' : 'Synced'}</span>
    </div>
    <div class="client-editor-canvas ${state.viewport === 'mobile' ? 'mobile' : 'desktop'}" data-editor-canvas="${state.viewport}">
      ${state.blocks.map((block, index) => `
        <article class="client-editor-block ${state.selectedBlockId === block.id ? 'selected' : ''}" draggable="true" data-client-block-id="${block.id}" data-client-block-index="${index}">
          <header><span>${index + 1}. ${block.sectionName}</span><code>${block.type}</code></header>
          <h4>${block.title || block.sectionName}</h4>
          <p>${block.body || 'No body copy yet.'}</p>
          ${block.buttonLabel ? `<button type="button">${block.buttonLabel}</button>` : ''}
          <footer><button type="button" data-editor-select="${block.id}">Select</button><button type="button" data-editor-duplicate="${block.id}">Duplicate</button></footer>
        </article>`).join('')}
    </div>
    <aside class="client-editor-inspector" data-editor-visual-inspector data-selected-block="${inspector.blockId}">
      <h4>Visual block inspector</h4>
      <div><strong>Style</strong><span>${inspector.style.preset} · ${inspector.style.alignment} · ${inspector.style.widthPercent}%</span></div>
      <div><strong>Colors</strong><span>${inspector.style.backgroundColor || 'default'} / ${inspector.style.textColor || 'default'}</span></div>
      <div data-asset-transform-studio><strong>Asset transform studio</strong><span>${inspector.asset.assetId || 'No asset'} · ${inspector.asset.imageFit} · ${inspector.asset.imageCrop} · ${inspector.asset.focalPoint.x}/${inspector.asset.focalPoint.y}</span></div>
      <div data-personalization-preview><strong>Personalization preview</strong><span>${personalizationPreview.title || personalizationPreview.body || 'No merge tags yet'}</span></div>
    </aside>
    <textarea data-editor-serialized-state aria-label="Serialized editor state">${serializeEditorState(state)}</textarea>`;
}

export function attachCampaignEditor(root = document.querySelector('[data-campaign-editor-client]')) {
  if (!root) return null;
  const scriptId = root.getAttribute('data-state-script');
  const script = scriptId ? document.getElementById(scriptId) : null;
  const seed = script ? JSON.parse(script.textContent || '{}') : {};
  let state = createEditorState(seed);
  renderClientEditor(root, state);

  root.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.editorViewport) state = setViewport(state, target.dataset.editorViewport);
    if (target.dataset.editorUndo !== undefined) state = undoEditorChange(state);
    if (target.dataset.editorRedo !== undefined) state = redoEditorChange(state);
    if (target.dataset.editorSelect) state = { ...state, selectedBlockId: target.dataset.editorSelect };
    if (target.dataset.editorDuplicate) state = duplicateBlock(state, target.dataset.editorDuplicate);
    renderClientEditor(root, state);
    root.dispatchEvent(new CustomEvent('mailclone:editor-state', { detail: state, bubbles: true }));
  });

  root.addEventListener('dragstart', (event) => {
    const block = event.target.closest('[data-client-block-index]');
    if (block && event.dataTransfer) event.dataTransfer.setData('text/plain', block.dataset.clientBlockIndex);
  });

  root.addEventListener('dragover', (event) => {
    if (event.target.closest('[data-client-block-index]')) event.preventDefault();
  });

  root.addEventListener('drop', (event) => {
    const block = event.target.closest('[data-client-block-index]');
    if (!block || !event.dataTransfer) return;
    event.preventDefault();
    state = moveBlock(state, Number(event.dataTransfer.getData('text/plain')), Number(block.dataset.clientBlockIndex));
    renderClientEditor(root, state);
    root.dispatchEvent(new CustomEvent('mailclone:editor-state', { detail: state, bubbles: true }));
  });

  root.__mailcloneEditor = { getState: () => state, setState: (next) => { state = next; renderClientEditor(root, state); } };
  return root.__mailcloneEditor;
}

if (typeof document !== 'undefined') {
  window.MailcloneEditorClient = { CAMPAIGN_EDITOR_VISUAL_BUILDER_CONTRACT, createEditorState, moveBlock, duplicateBlock, updateBlock, buildBlockInspectorState, applyVisualStylePatch, applyAssetTransform, renderPersonalizationPreview, setViewport, undoEditorChange, redoEditorChange, serializeEditorState, attachCampaignEditor };
  document.addEventListener('DOMContentLoaded', () => attachCampaignEditor());
}
