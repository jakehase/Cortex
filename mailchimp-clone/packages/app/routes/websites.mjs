import { registerWebsiteBuilderRoutes } from './website-builder.mjs';
import { json } from '../utils.mjs';
import { buildWebsitePublishRuntimeSnapshot, ensureCurrentProductState, websitePages, websiteValidation } from '../domain-current-product.mjs';

function compactPageModel(sitePage) {
  return {
    id: sitePage.id,
    name: sitePage.name,
    slug: sitePage.slug || '',
    type: sitePage.pageType || 'standard',
    navigation: {
      shown: Boolean(sitePage.showInNav),
      order: Number(sitePage.navOrder || 0)
    },
    content: {
      headline: sitePage.headline || '',
      hasBody: Boolean(sitePage.body),
      ctaLabel: sitePage.ctaLabel || '',
      ctaUrl: sitePage.ctaUrl || ''
    },
    connections: {
      formId: sitePage.linkedFormId || '',
      campaignId: sitePage.linkedCampaignId || ''
    },
    analytics: {
      views: Number(sitePage.analytics?.views || 0),
      signups: Number(sitePage.analytics?.signups || 0),
      ctaClicks: Number(sitePage.analytics?.ctaClicks || 0)
    },
    seo: {
      title: sitePage.seoTitle || '',
      description: sitePage.seoDescription || ''
    }
  };
}

function buildWebsiteObjectModel(state, website, workspaceId) {
  const pages = websitePages(state, website.id).map(compactPageModel);
  const runtime = buildWebsitePublishRuntimeSnapshot(state, website, workspaceId);
  const validation = websiteValidation(state, website);
  const pageTypeCount = pages.reduce((counts, sitePage) => {
    counts[sitePage.type] = (counts[sitePage.type] || 0) + 1;
    return counts;
  }, {});

  return {
    id: website.id,
    name: website.name,
    slug: website.slug,
    status: website.status,
    defaultDomain: website.defaultDomain || '',
    theme: {
      preset: website.themePreset || 'modern',
      primaryColor: website.primaryColor || '',
      secondaryColor: website.secondaryColor || '',
      headingFont: website.headingFont || '',
      bodyFont: website.bodyFont || '',
      announcementBar: website.announcementBar || ''
    },
    navigation: pages.filter((sitePage) => sitePage.navigation.shown),
    depth: {
      totalPages: pages.length,
      standardPages: pageTypeCount.standard || 0,
      blogPages: pageTypeCount.blog || 0,
      storePages: pageTypeCount.store || 0,
      landingPages: pageTypeCount.landing || 0,
      contactPages: pageTypeCount.contact || 0,
      aboutPages: pageTypeCount.about || 0
    },
    pages,
    publish: {
      ready: validation.length === 0 && Boolean(runtime.publishReady),
      publishedAt: website.publishedAt || null,
      publicUrl: website.slug ? `/sites/${website.slug}` : '',
      checklist: runtime.checklist || [],
      validation
    },
    analytics: {
      views: pages.reduce((sum, sitePage) => sum + sitePage.analytics.views, 0),
      signups: pages.reduce((sum, sitePage) => sum + sitePage.analytics.signups, 0),
      ctaClicks: pages.reduce((sum, sitePage) => sum + sitePage.analytics.ctaClicks, 0)
    }
  };
}

export function registerWebsiteRoutes(router, deps) {
  registerWebsiteBuilderRoutes(router, deps);

  router.register('GET', '/api/websites/:id/object-model', async ({ state, req, params, res }) => {
    const actor = deps.requireAuth(state, req, res); if (!actor) return;
    ensureCurrentProductState(state);
    const website = state.db.websites.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!website) return json(res, 404, { ok: false, error: 'website_not_found' });
    json(res, 200, {
      ok: true,
      websiteObjectModel: buildWebsiteObjectModel(state, website, actor.workspace.id)
    });
  });
}
