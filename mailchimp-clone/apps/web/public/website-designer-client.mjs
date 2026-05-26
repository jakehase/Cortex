export const WEBSITE_BUILDER_PUBLISH_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'website_builder_publish_runtime_layer',
  label: 'Website builder publish/runtime layer',
  controls: [
    'seo_inspector_state',
    'publish_readiness_checklist',
    'domain_and_robot_preview',
    'page_experiment_variant_state',
    'analytics_event_targets',
    'serialized_publish_runtime_state'
  ],
  evidenceContract: [
    'client_seo_inspector_model',
    'publish_checklist_model',
    'experiment_variant_preview',
    'runtime_api_evidence'
  ]
});

export function normalizeDesignerPage(page = {}, index = 0) {
  return {
    id: page.id || `page-${index + 1}`,
    name: page.name || `Page ${index + 1}`,
    slug: page.slug || '',
    pageType: page.pageType || 'standard',
    headline: page.headline || '',
    body: page.body || '',
    showInNav: page.showInNav !== false,
    sectionStyle: page.sectionStyle || 'hero-text',
    ctaLabel: page.ctaLabel || '',
    ctaUrl: page.ctaUrl || '',
    seoTitle: page.seoTitle || page.name || '',
    seoDescription: page.seoDescription || '',
    canonicalPath: page.canonicalPath || (page.slug ? `/${page.slug}` : '/'),
    analyticsGoal: page.analyticsGoal || 'view',
    experimentVariant: page.experimentVariant || '',
    socialTitle: page.socialTitle || page.seoTitle || page.name || '',
    socialDescription: page.socialDescription || page.seoDescription || '',
    noindex: Boolean(page.noindex)
  };
}

export function createWebsiteDesignerState({ website = {}, pages = [], viewport = 'desktop' } = {}) {
  const normalizedPages = pages.map((page, index) => normalizeDesignerPage(page, index));
  return {
    version: 1,
    viewport,
    dirty: false,
    selectedPageId: normalizedPages[0]?.id || '',
    theme: {
      themePreset: website.themePreset || 'modern',
      primaryColor: website.primaryColor || '#0b5fff',
      secondaryColor: website.secondaryColor || '#18212f',
      headingFont: website.headingFont || 'Arial',
      bodyFont: website.bodyFont || 'Arial',
      announcementBar: website.announcementBar || '',
      robotsIndex: website.robotsIndex !== false,
      canonicalBaseUrl: website.canonicalBaseUrl || '',
      defaultDomain: website.defaultDomain || ''
    },
    pages: normalizedPages,
    experiments: Array.isArray(website.websiteExperiments) ? website.websiteExperiments : [],
    history: [],
    future: []
  };
}

function snapshot(state) {
  return {
    viewport: state.viewport,
    selectedPageId: state.selectedPageId,
    theme: { ...state.theme },
    pages: state.pages.map((page) => ({ ...page }))
  };
}

function restoreSnapshot(state, snap) {
  return { ...state, viewport: snap.viewport, selectedPageId: snap.selectedPageId, theme: { ...snap.theme }, pages: snap.pages.map((page) => ({ ...page })) };
}

function withHistory(state, updater) {
  const next = updater({ ...state, theme: { ...state.theme }, pages: state.pages.map((page) => ({ ...page })) });
  return { ...next, dirty: true, history: [...(state.history || []), snapshot(state)].slice(-25), future: [] };
}

export function movePage(state, fromIndex, toIndex) {
  return withHistory(state, (draft) => {
    if (fromIndex < 0 || fromIndex >= draft.pages.length || toIndex < 0 || toIndex >= draft.pages.length) return draft;
    const [page] = draft.pages.splice(fromIndex, 1);
    draft.pages.splice(toIndex, 0, page);
    draft.selectedPageId = page.id;
    return draft;
  });
}

export function duplicatePage(state, pageId) {
  return withHistory(state, (draft) => {
    const index = draft.pages.findIndex((page) => page.id === pageId);
    if (index === -1) return draft;
    const source = draft.pages[index];
    const duplicate = { ...source, id: `${source.id}-copy-${Date.now()}`, name: `${source.name} copy`, slug: source.slug ? `${source.slug}-copy` : 'copy' };
    draft.pages.splice(index + 1, 0, duplicate);
    draft.selectedPageId = duplicate.id;
    return draft;
  });
}

export function updateDesignerPage(state, pageId, patch = {}) {
  return withHistory(state, (draft) => {
    draft.pages = draft.pages.map((page) => page.id === pageId ? { ...page, ...patch } : page);
    draft.selectedPageId = pageId;
    return draft;
  });
}

export function updateTheme(state, patch = {}) {
  return withHistory(state, (draft) => ({ ...draft, theme: { ...draft.theme, ...patch } }));
}

export function buildWebsiteSeoInspectorState(state, pageId = state.selectedPageId) {
  const page = state.pages.find((entry) => entry.id === pageId) || state.pages[0] || normalizeDesignerPage({}, 0);
  const issues = [];
  if (!page.seoTitle || page.seoTitle.length < 10) issues.push('seo_title_too_short');
  if ((page.seoTitle || '').length > 65) issues.push('seo_title_too_long');
  if (!page.seoDescription || page.seoDescription.length < 35) issues.push('seo_description_too_short');
  if ((page.seoDescription || '').length > 160) issues.push('seo_description_too_long');
  if (!page.headline) issues.push('missing_h1_headline');
  if (page.noindex && state.theme.robotsIndex) issues.push('page_noindex_overrides_site_index');
  return {
    ...WEBSITE_BUILDER_PUBLISH_RUNTIME_CONTRACT,
    pageId: page.id,
    titleLength: (page.seoTitle || '').length,
    descriptionLength: (page.seoDescription || '').length,
    canonicalUrl: `${state.theme.canonicalBaseUrl || state.theme.defaultDomain || ''}${page.canonicalPath || '/'}`,
    issues,
    score: Math.max(0, 100 - (issues.length * 15)),
    socialPreview: { title: page.socialTitle || page.seoTitle, description: page.socialDescription || page.seoDescription }
  };
}

export function buildPublishReadinessChecklist(state) {
  const pages = state.pages || [];
  const seoInspectors = pages.map((page) => buildWebsiteSeoInspectorState(state, page.id));
  const navPages = pages.filter((page) => page.showInNav);
  return [
    { id: 'has_pages', label: 'At least one page exists', ok: pages.length > 0 },
    { id: 'home_page', label: 'Home page is configured', ok: pages.some((page) => !page.slug || page.pageType === 'home') },
    { id: 'navigation', label: 'Navigation has visible pages', ok: navPages.length > 0 },
    { id: 'seo_ready', label: 'All pages have usable SEO metadata', ok: seoInspectors.every((entry) => entry.score >= 70), details: seoInspectors.map((entry) => ({ pageId: entry.pageId, score: entry.score, issues: entry.issues })) },
    { id: 'domain_ready', label: 'Domain/canonical base is set', ok: Boolean(state.theme.defaultDomain || state.theme.canonicalBaseUrl) },
    { id: 'analytics_targets', label: 'Analytics goals are mapped', ok: pages.every((page) => Boolean(page.analyticsGoal || page.ctaUrl)) }
  ];
}

export function createPageExperimentVariant(state, pageId, patch = {}) {
  const source = state.pages.find((page) => page.id === pageId) || state.pages[0] || normalizeDesignerPage({}, 0);
  const variant = {
    id: patch.id || `variant-${pageId}-${(state.experiments || []).length + 1}`,
    pageId: source.id,
    name: patch.name || `${source.name} variant`,
    hypothesis: patch.hypothesis || 'Improve page conversion with alternate headline and CTA',
    trafficSplit: Number(patch.trafficSplit || 50),
    preview: {
      headline: patch.headline || source.headline,
      ctaLabel: patch.ctaLabel || source.ctaLabel,
      sectionStyle: patch.sectionStyle || source.sectionStyle
    }
  };
  return withHistory(state, (draft) => ({ ...draft, experiments: [variant, ...(draft.experiments || [])], selectedPageId: source.id }));
}

export function applyWebsiteRuntimePatch(state, pageId, patch = {}) {
  const pagePatch = {
    seoTitle: patch.seoTitle,
    seoDescription: patch.seoDescription,
    canonicalPath: patch.canonicalPath,
    analyticsGoal: patch.analyticsGoal,
    socialTitle: patch.socialTitle,
    socialDescription: patch.socialDescription
  };
  Object.keys(pagePatch).forEach((key) => pagePatch[key] === undefined && delete pagePatch[key]);
  if (patch.noindex !== undefined) pagePatch.noindex = patch.noindex === true || patch.noindex === 'on';
  let next = updateDesignerPage(state, pageId, pagePatch);
  if (patch.canonicalBaseUrl || patch.defaultDomain || patch.robotsIndex !== undefined) {
    next = updateTheme(next, {
      canonicalBaseUrl: patch.canonicalBaseUrl || next.theme.canonicalBaseUrl,
      defaultDomain: patch.defaultDomain || next.theme.defaultDomain,
      robotsIndex: patch.robotsIndex === false || patch.robotsIndex === 'off' ? false : next.theme.robotsIndex
    });
  }
  return next;
}

export function setDesignerViewport(state, viewport = 'desktop') {
  return { ...state, viewport, dirty: true };
}

export function undoDesignerChange(state) {
  const history = [...(state.history || [])];
  const previous = history.pop();
  if (!previous) return state;
  return { ...restoreSnapshot(state, previous), dirty: true, history, future: [snapshot(state), ...(state.future || [])].slice(0, 25) };
}

export function redoDesignerChange(state) {
  const future = [...(state.future || [])];
  const nextSnap = future.shift();
  if (!nextSnap) return state;
  return { ...restoreSnapshot(state, nextSnap), dirty: true, history: [...(state.history || []), snapshot(state)].slice(-25), future };
}

export function serializeDesignerState(state) {
  return JSON.stringify({ version: state.version, viewport: state.viewport, selectedPageId: state.selectedPageId, theme: state.theme, pages: state.pages, experiments: state.experiments || [], publishRuntime: WEBSITE_BUILDER_PUBLISH_RUNTIME_CONTRACT }, null, 2);
}

function renderDesigner(root, state) {
  const selected = state.pages.find((page) => page.id === state.selectedPageId) || state.pages[0] || {};
  const seoInspector = buildWebsiteSeoInspectorState(state, selected.id);
  const checklist = buildPublishReadinessChecklist(state);
  root.innerHTML = `
    <div class="website-designer-toolbar" role="toolbar" aria-label="Website designer client controls">
      <strong>Visual site designer</strong>
      <button type="button" data-designer-viewport="desktop" aria-pressed="${state.viewport === 'desktop'}">Desktop</button>
      <button type="button" data-designer-viewport="mobile" aria-pressed="${state.viewport === 'mobile'}">Mobile</button>
      <button type="button" data-designer-undo ${state.history.length ? '' : 'disabled'}>Undo</button>
      <button type="button" data-designer-redo ${state.future.length ? '' : 'disabled'}>Redo</button>
      <span class="pill">${state.dirty ? 'Unsaved visual draft' : 'Synced'}</span>
    </div>
    <div class="website-designer-workbench">
      <aside class="website-designer-pages" aria-label="Website pages">
        ${state.pages.map((page, index) => `<button type="button" draggable="true" data-designer-page-id="${page.id}" data-designer-page-index="${index}" class="${page.id === state.selectedPageId ? 'selected' : ''}"><span>${index + 1}. ${page.name}</span><code>${page.slug || 'home'}</code></button>`).join('') || '<p>No pages yet.</p>'}
      </aside>
      <section class="website-designer-preview ${state.viewport}" data-designer-preview="${state.viewport}" style="--site-primary:${state.theme.primaryColor};--site-secondary:${state.theme.secondaryColor};font-family:${state.theme.bodyFont}">
        <header><div>${state.theme.announcementBar || 'Website announcement bar'}</div><nav>${state.pages.filter((page) => page.showInNav).map((page) => `<span>${page.name}</span>`).join('')}</nav></header>
        <main><p class="eyebrow">${selected.pageType || 'standard'}</p><h2 style="font-family:${state.theme.headingFont}">${selected.headline || selected.name || 'Untitled page'}</h2><p>${selected.body || 'Add page copy in the durable page editor.'}</p>${selected.ctaLabel ? `<button type="button">${selected.ctaLabel}</button>` : ''}</main>
      </section>
      <aside class="website-designer-inspector"><h4>Inspector</h4><p>${selected.name || 'No page selected'}</p><p>Style: ${selected.sectionStyle || 'hero-text'}</p><p>Theme: ${state.theme.themePreset}</p><button type="button" data-designer-duplicate="${selected.id || ''}">Duplicate page</button></aside>
    </div>
    <aside class="website-publish-runtime" data-website-publish-runtime data-selected-page="${selected.id || ''}">
      <h4>Publish readiness + SEO runtime</h4>
      <div data-website-seo-inspector><strong>SEO score</strong><span>${seoInspector.score}</span><small>${seoInspector.issues.join(', ') || 'ready'}</small></div>
      <div data-website-publish-checklist>${checklist.map((item) => `<span class="pill ${item.ok ? 'ok' : 'warn'}">${item.ok ? '✓' : '!'} ${item.label}</span>`).join('')}</div>
      <div data-website-experiment-preview><strong>Experiments</strong><span>${(state.experiments || []).length} variant${(state.experiments || []).length === 1 ? '' : 's'}</span></div>
    </aside>
    <textarea data-designer-serialized-state aria-label="Serialized website designer state">${serializeDesignerState(state)}</textarea>`;
}

export function attachWebsiteDesigner(root = document.querySelector('[data-website-designer-client]')) {
  if (!root) return null;
  const scriptId = root.getAttribute('data-state-script');
  const script = scriptId ? document.getElementById(scriptId) : null;
  const seed = script ? JSON.parse(script.textContent || '{}') : {};
  let state = createWebsiteDesignerState(seed);
  renderDesigner(root, state);

  root.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.designerViewport) state = setDesignerViewport(state, target.dataset.designerViewport);
    if (target.dataset.designerUndo !== undefined) state = undoDesignerChange(state);
    if (target.dataset.designerRedo !== undefined) state = redoDesignerChange(state);
    if (target.dataset.designerPageId) state = { ...state, selectedPageId: target.dataset.designerPageId };
    if (target.dataset.designerDuplicate) state = duplicatePage(state, target.dataset.designerDuplicate);
    renderDesigner(root, state);
    root.dispatchEvent(new CustomEvent('mailclone:website-designer-state', { detail: state, bubbles: true }));
  });

  root.addEventListener('dragstart', (event) => {
    const page = event.target.closest('[data-designer-page-index]');
    if (page && event.dataTransfer) event.dataTransfer.setData('text/plain', page.dataset.designerPageIndex);
  });

  root.addEventListener('dragover', (event) => {
    if (event.target.closest('[data-designer-page-index]')) event.preventDefault();
  });

  root.addEventListener('drop', (event) => {
    const page = event.target.closest('[data-designer-page-index]');
    if (!page || !event.dataTransfer) return;
    event.preventDefault();
    state = movePage(state, Number(event.dataTransfer.getData('text/plain')), Number(page.dataset.designerPageIndex));
    renderDesigner(root, state);
    root.dispatchEvent(new CustomEvent('mailclone:website-designer-state', { detail: state, bubbles: true }));
  });

  root.__mailcloneWebsiteDesigner = { getState: () => state, setState: (next) => { state = next; renderDesigner(root, state); } };
  return root.__mailcloneWebsiteDesigner;
}

if (typeof document !== 'undefined') {
  window.MailcloneWebsiteDesigner = { WEBSITE_BUILDER_PUBLISH_RUNTIME_CONTRACT, createWebsiteDesignerState, movePage, duplicatePage, updateDesignerPage, updateTheme, buildWebsiteSeoInspectorState, buildPublishReadinessChecklist, createPageExperimentVariant, applyWebsiteRuntimePatch, setDesignerViewport, undoDesignerChange, redoDesignerChange, serializeDesignerState, attachWebsiteDesigner };
  document.addEventListener('DOMContentLoaded', () => attachWebsiteDesigner());
}
