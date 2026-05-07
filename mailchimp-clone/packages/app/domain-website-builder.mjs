import { persistState } from './storage.mjs';
import { rebuildWebsiteAnalytics, recordAnalyticsEvent } from './analytics-events.mjs';
import { createId, nowIso } from './utils.mjs';
import { createNotification, recordAudit, recordEvent } from './domain-core.mjs';

function slugify(value = '') {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function ensureArray(state, key) {
  state.db[key] ||= [];
  return state.db[key];
}

function uniqueSlug(entries, preferred, fallbackPrefix = 'item') {
  const base = slugify(preferred || fallbackPrefix);
  let candidate = base;
  let counter = 2;
  while (entries.some((entry) => entry.slug === candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

export function ensureCurrentProductState(state) {
  ensureArray(state, 'websites');
  ensureArray(state, 'websitePages');
  ensureArray(state, 'websitePublishes');
  ensureArray(state, 'generatedSuggestions');
  ensureArray(state, 'campaignExperiments');
  ensureArray(state, 'channelPrograms');
  ensureArray(state, 'assetSnippets');
  ensureArray(state, 'contentVersions');
  return state;
}

function snapshotWebsitePage(page) {
  return {
    id: page.id,
    name: page.name,
    slug: page.slug,
    headline: page.headline,
    body: page.body,
    sectionStyle: page.sectionStyle,
    ctaLabel: page.ctaLabel,
    ctaUrl: page.ctaUrl,
    showInNav: page.showInNav,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription
  };
}

function recordWebsiteRevision(website, page, reason = 'update') {
  website.revisions ||= { undo: [], redo: [] };
  website.revisions.undo.unshift({ at: nowIso(), reason, pageId: page.id, snapshot: snapshotWebsitePage(page) });
  website.revisions.undo = website.revisions.undo.slice(0, 20);
  website.revisions.redo = [];
}

export function undoWebsiteRevision(state, website) {
  const revision = website.revisions?.undo?.shift();
  if (!revision) return null;
  const page = state.db.websitePages.find((entry) => entry.id === revision.pageId);
  if (!page) return null;
  website.revisions.redo.unshift({ at: nowIso(), reason: 'undo', pageId: page.id, snapshot: snapshotWebsitePage(page) });
  Object.assign(page, revision.snapshot, { updatedAt: nowIso() });
  website.updatedAt = nowIso();
  persistState(state);
  return page;
}

export function redoWebsiteRevision(state, website) {
  const revision = website.revisions?.redo?.shift();
  if (!revision) return null;
  const page = state.db.websitePages.find((entry) => entry.id === revision.pageId);
  if (!page) return null;
  website.revisions.undo.unshift({ at: nowIso(), reason: 'redo', pageId: page.id, snapshot: snapshotWebsitePage(page) });
  Object.assign(page, revision.snapshot, { updatedAt: nowIso() });
  website.updatedAt = nowIso();
  persistState(state);
  return page;
}

export function websitePages(state, websiteId) {
  ensureCurrentProductState(state);
  return state.db.websitePages.filter((entry) => entry.websiteId === websiteId).sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function websiteValidation(state, website) {
  const pages = websitePages(state, website.id);
  const errors = [];
  if (!website.name) errors.push('Website name is required.');
  if (!website.slug) errors.push('Website slug is required.');
  if (!website.seoTitle) errors.push('Site title is required for SEO parity.');
  if (!pages.length) errors.push('Add at least one website page.');
  const seen = new Set();
  for (const page of pages) {
    if (!page.name) errors.push(`Page ${page.id} needs a name.`);
    const key = page.slug || '__home__';
    if (seen.has(key)) errors.push(`Page slug collision detected for ${page.slug || 'home'}.`);
    seen.add(key);
  }
  return errors;
}

export function createWebsite(state, actor, body) {
  ensureCurrentProductState(state);
  const slug = uniqueSlug(state.db.websites.filter((entry) => entry.workspaceId === actor.workspace.id), body.slug || body.name || 'website', 'website');
  const website = {
    id: createId('site'),
    workspaceId: actor.workspace.id,
    name: body.name || 'Website',
    slug,
    defaultDomain: body.defaultDomain || `${slug}.mailclone.test`,
    faviconAssetName: body.faviconAssetName || '',
    themePreset: body.themePreset || 'modern',
    navigationStyle: body.navigationStyle || 'header',
    primaryColor: body.primaryColor || actor.workspace.settings.brandColor || '#0b5fff',
    secondaryColor: body.secondaryColor || '#18212f',
    headingFont: body.headingFont || 'Arial',
    bodyFont: body.bodyFont || 'Arial',
    seoTitle: body.seoTitle || body.name || actor.workspace.name,
    seoDescription: body.seoDescription || 'Website built inside the Mailchimp current-product shell.',
    canonicalBaseUrl: body.canonicalBaseUrl || `https://${slug}.mailclone.test`,
    robotsIndex: body.robotsIndex === 'off' ? false : true,
    announcementBar: body.announcementBar || '',
    analyticsEnabled: body.analyticsEnabled === 'off' ? false : true,
    status: 'draft',
    publishedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    analytics: { views: 0, signups: 0, ctaClicks: 0, lastReferrer: '', byPage: {} },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] },
    revisions: { undo: [], redo: [] }
  };
  state.db.websites.unshift(website);
  const page = createWebsitePage(state, actor, website, {
    name: 'Home',
    slug: '',
    headline: body.homeHeadline || `Welcome to ${website.name}`,
    body: body.homeBody || 'Introduce the brand, value proposition, and primary call to action.',
    pageType: 'home',
    showInNav: 'on',
    ctaLabel: 'Subscribe',
    ctaUrl: '/forms'
  }, true);
  website.homePageId = page.id;
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'website-create', detail: `Created website ${website.name}` });
  return website;
}

export function createWebsitePage(state, actor, website, body, skipSave = false) {
  ensureCurrentProductState(state);
  const existing = websitePages(state, website.id);
  const slug = body.slug === '' || body.pageType === 'home' ? '' : uniqueSlug(existing, body.slug || body.name || 'page', 'page');
  const page = {
    id: createId('wpage'),
    workspaceId: actor.workspace.id,
    websiteId: website.id,
    name: body.name || 'Page',
    slug,
    pageType: body.pageType || 'standard',
    headline: body.headline || '',
    body: body.body || '',
    sectionStyle: body.sectionStyle || 'hero-text',
    showInNav: body.showInNav === 'off' ? false : true,
    seoTitle: body.seoTitle || body.name || website.seoTitle,
    seoDescription: body.seoDescription || website.seoDescription,
    linkedFormId: body.linkedFormId || '',
    linkedCampaignId: body.linkedCampaignId || '',
    ctaLabel: body.ctaLabel || 'Learn more',
    ctaUrl: body.ctaUrl || '',
    order: existing.length + 1,
    status: 'draft',
    analytics: { views: 0, signups: 0, ctaClicks: 0 },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.db.websitePages.unshift(page);
  if (!skipSave) {
    website.updatedAt = nowIso();
    persistState(state);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'website-page-create', detail: `Created page ${page.name} on ${website.name}` });
  }
  return page;
}

export function updateWebsite(state, actor, website, body) {
  const siblings = state.db.websites.filter((entry) => entry.workspaceId === actor.workspace.id && entry.id !== website.id);
  Object.assign(website, {
    name: body.name || website.name,
    slug: uniqueSlug(siblings, body.slug || website.slug, 'website'),
    defaultDomain: body.defaultDomain || website.defaultDomain,
    faviconAssetName: body.faviconAssetName || website.faviconAssetName,
    themePreset: body.themePreset || website.themePreset,
    navigationStyle: body.navigationStyle || website.navigationStyle,
    primaryColor: body.primaryColor || website.primaryColor,
    secondaryColor: body.secondaryColor || website.secondaryColor,
    headingFont: body.headingFont || website.headingFont,
    bodyFont: body.bodyFont || website.bodyFont,
    seoTitle: body.seoTitle || website.seoTitle,
    seoDescription: body.seoDescription || website.seoDescription,
    canonicalBaseUrl: body.canonicalBaseUrl || website.canonicalBaseUrl,
    robotsIndex: body.robotsIndex === 'off' ? false : true,
    announcementBar: body.announcementBar ?? website.announcementBar,
    analyticsEnabled: body.analyticsEnabled === 'off' ? false : body.analyticsEnabled === 'on' ? true : website.analyticsEnabled,
    updatedAt: nowIso()
  });
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'website-update', detail: `Updated website ${website.name}` });
  return website;
}

export function updateWebsitePage(state, actor, website, page, body) {
  const others = websitePages(state, website.id).filter((entry) => entry.id !== page.id);
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  recordWebsiteRevision(website, page, 'page_update');
  Object.assign(page, {
    name: body.name || page.name,
    slug: body.slug === '' || body.pageType === 'home' ? '' : uniqueSlug(others, body.slug || page.slug || body.name || 'page', 'page'),
    pageType: body.pageType || page.pageType,
    headline: body.headline ?? page.headline,
    body: body.body ?? page.body,
    sectionStyle: body.sectionStyle || page.sectionStyle,
    showInNav: body.showInNav === 'off' ? false : body.showInNav === 'on' ? true : page.showInNav,
    seoTitle: body.seoTitle || page.seoTitle,
    seoDescription: body.seoDescription || page.seoDescription,
    linkedFormId: body.linkedFormId ?? page.linkedFormId,
    linkedCampaignId: body.linkedCampaignId ?? page.linkedCampaignId,
    ctaLabel: body.ctaLabel ?? page.ctaLabel,
    ctaUrl: body.ctaUrl ?? page.ctaUrl,
    updatedAt: nowIso()
  });
  website.updatedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'website-page-update', detail: `Updated page ${page.name} on ${website.name}` });
  return page;
}

export function reorderWebsiteNavigation(state, actor, website, orderedPageIds = []) {
  const pages = websitePages(state, website.id);
  const ordered = orderedPageIds.filter(Boolean);
  for (const page of pages) {
    const index = ordered.indexOf(page.id);
    if (index >= 0) page.order = index + 1;
  }
  pages.filter((page) => !ordered.includes(page.id)).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((page, index) => {
    page.order = ordered.length + index + 1;
  });
  website.updatedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'website-navigation-update', detail: `Updated navigation for ${website.name}` });
}

export function publishWebsite(state, actor, website) {
  const errors = websiteValidation(state, website);
  if (errors.length) return { ok: false, errors };
  website.status = 'published';
  website.publishedAt = nowIso();
  website.updatedAt = website.publishedAt;
  for (const page of websitePages(state, website.id)) page.status = 'published';
  state.db.websitePublishes.unshift({ id: createId('wpub'), websiteId: website.id, workspaceId: website.workspaceId, domain: website.defaultDomain, pageCount: websitePages(state, website.id).length, publishedAt: website.publishedAt, summary: `${website.name} published to ${website.defaultDomain}` });
  persistState(state);
  createNotification(state, { workspaceId: website.workspaceId, type: 'website-published', payload: { websiteId: website.id, domain: website.defaultDomain } });
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'website-publish', detail: `Published website ${website.name}` });
  return { ok: true, website };
}

export function recordWebsiteView(state, website, page, { referrer = '', cta = false, signup = false } = {}) {
  recordAnalyticsEvent(state, { type: 'website_view', workspaceId: website.workspaceId, websiteId: website.id, pageId: page.id, referrer });
  if (cta) recordAnalyticsEvent(state, { type: 'website_cta', workspaceId: website.workspaceId, websiteId: website.id, pageId: page.id, referrer });
  if (signup) recordAnalyticsEvent(state, { type: 'website_signup', workspaceId: website.workspaceId, websiteId: website.id, pageId: page.id, referrer });
  const analytics = rebuildWebsiteAnalytics(state, website.id, page.id);
  website.analytics = analytics.website;
  page.analytics = analytics.page;
  page.updatedAt = nowIso();
  website.updatedAt = nowIso();
  recordEvent(state, { workspaceId: website.workspaceId, type: 'website-view', message: `${website.name} page viewed`, meta: { websiteId: website.id, pageId: page.id, referrer } });
  persistState(state);
}
