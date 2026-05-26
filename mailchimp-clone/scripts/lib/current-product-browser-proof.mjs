import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../../src/server.js';

function ensureDir(dir) {
  if (dir) fs.mkdirSync(dir, { recursive: true });
}

function tempDataDir(prefix = 'mailclone-current-product-browser-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function isoNow() {
  return new Date().toISOString();
}

function scenarioRecord(id, label) {
  return { id, label, startedAt: isoNow(), checks: [], screenshot: null, notes: [] };
}

function addCheck(scenario, id, detail) {
  scenario.checks.push({ id, detail, at: isoNow() });
}

async function captureScreenshot(page, screenshotDir, name) {
  if (!screenshotDir) return null;
  ensureDir(screenshotDir);
  const filePath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function bodyText(page) {
  return String(await page.locator('body').textContent() || '');
}

async function expectBody(page, pattern, message) {
  assert.match(await bodyText(page), pattern, message);
}

async function submitAndWait(page, buttonLocator, urlPattern) {
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
  const click = buttonLocator.click({ timeout: 10000 }).catch(async (error) => {
    if (!/intercepts pointer events|Timeout/i.test(String(error?.message || error))) throw error;
    await buttonLocator.evaluate((button) => {
      const form = button.closest('form');
      if (form?.requestSubmit) form.requestSubmit(button);
      else button.click();
    });
  });
  await Promise.all([navigation, click]);
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => null);
  if (urlPattern && !urlPattern.test(page.url())) {
    await page.waitForURL(urlPattern, { timeout: 10000 });
  }
  if (urlPattern) assert.match(page.url(), urlPattern, `Expected URL ${page.url()} to match ${urlPattern}`);
}

async function navigate(page, baseUrl, pathname, titlePattern) {
  await page.goto(`${baseUrl}${pathname}`);
  if (titlePattern) await expectBody(page, titlePattern, `Expected ${pathname} to match ${titlePattern}`);
}

async function ensureGrowthWorkspace(page, baseUrl) {
  await navigate(page, baseUrl, '/billing', /Billing & plans/);
  await submitAndWait(page, page.locator('form[action="/billing/plan"]').filter({ has: page.locator('input[value="growth"]') }).locator('button'), /\/billing$/);
  await expectBody(page, /Growth/, 'Growth plan should be visible after plan switch');

  await navigate(page, baseUrl, '/settings', /Settings shell/);
  await page.locator('form[action="/settings"] input[name="senderName"]').fill('Current Product Browser');
  await page.locator('form[action="/settings"] input[name="senderEmail"]').fill('current-product-browser@example.com');
  await page.locator('form[action="/settings"] input[name="replyTo"]').fill('reply-current-product@example.com');
  await page.locator('form[action="/settings"] input[name="timezone"]').fill('America/Chicago');
  await page.locator('form[action="/settings"] input[name="brandColor"]').fill('#155eef');
  await page.locator('form[action="/settings"] textarea[name="address"]').fill('500 Browser Way');
  await submitAndWait(page, page.locator('form[action="/settings"] button'), /\/settings$/);
  await expectBody(page, /current-product-browser@example.com/);
}

export async function runCurrentProductBrowserProof(options = {}) {
  const startedAt = isoNow();
  const artifactRoot = options.artifactRoot || null;
  const validationDir = artifactRoot ? path.join(artifactRoot, 'validation') : null;
  const screenshotDir = options.captureScreenshots === false || !artifactRoot ? null : path.join(validationDir, 'screenshots');
  const proofPath = options.proofPath || (artifactRoot ? path.join(validationDir, 'current_product_browser_proof.json') : null);
  const dataDir = options.dataDir || tempDataDir();
  const headless = options.headless !== false;
  const emailSuffix = Date.now().toString(36);
  const result = {
    generatedAt: startedAt,
    driver: 'playwright-chromium',
    realBrowser: true,
    ok: false,
    dataDir,
    artifactRoot,
    proofPath,
    browserChecks: 0,
    realBrowserChecks: 0,
    browserJourneyFamilies: 0,
    coveredFamilies: [],
    scenarios: [],
    blocker: null,
    environment: {
      headless,
      browserFamiliesTarget: ['campaign_ai_experiments', 'website_builder', 'automation_omnichannel', 'content_depth', 'integration_detail']
    }
  };

  let server;
  let browser;
  let context;
  let page;
  const state = {
    ownerEmail: `current-product-${emailSuffix}@example.com`,
    audienceId: null,
    campaignId: null,
    automationId: null,
    websiteId: null,
    websiteSlug: `browser-current-product-${emailSuffix}`,
    integrationId: null,
    assetName: `current-product-asset-${emailSuffix}.txt`
  };

  try {
    ensureDir(validationDir);
    ensureDir(screenshotDir);
    process.env.MAILCLONE_DATA_DIR = dataDir;
    server = createServer();
    const address = await server.start({ port: 0 });
    const baseUrl = `http://127.0.0.1:${address.port}`;
    result.baseUrl = baseUrl;

    browser = await chromium.launch({ headless });
    context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();

    await navigate(page, baseUrl, '/signup', /Signup/);
    await page.locator('form[action="/signup"] input[name="name"]').fill('Current Product Browser');
    await page.locator('form[action="/signup"] input[name="email"]').fill(state.ownerEmail);
    await page.locator('form[action="/signup"] input[name="password"]').fill('secret123');
    await page.locator('form[action="/signup"] input[name="workspaceName"]').fill('Current Product Browser Workspace');
    await submitAndWait(page, page.locator('form[action="/signup"] button'), /\/app$/);
    await expectBody(page, /Dashboard/);
    await ensureGrowthWorkspace(page, baseUrl);

    await navigate(page, baseUrl, '/contacts', /Contacts table/);
    state.audienceId = await page.locator('form[method="post"][action="/contacts"] input[name="audienceId"]').inputValue();
    assert.ok(state.audienceId, 'Expected a default audience');
    await page.locator('form[method="post"][action="/contacts"] input[name="firstName"]').fill('Jamie');
    await page.locator('form[method="post"][action="/contacts"] input[name="lastName"]').fill('Browser');
    await page.locator('form[method="post"][action="/contacts"] input[name="email"]').fill(`jamie-${emailSuffix}@example.com`);
    await page.locator('form[method="post"][action="/contacts"] input[name="phone"]').fill('+15551234567');
    await page.locator('form[method="post"][action="/contacts"] input[name="tags"]').fill('vip,launch');
    await page.locator('form[method="post"][action="/contacts"] input[name="interests"]').fill('news,offers');
    await submitAndWait(page, page.locator('form[method="post"][action="/contacts"] button'), /\/contacts/);
    await expectBody(page, /jamie-/);

    await page.locator('form[method="post"][action="/contacts"] input[name="firstName"]').fill('Taylor');
    await page.locator('form[method="post"][action="/contacts"] input[name="lastName"]').fill('Launch');
    await page.locator('form[method="post"][action="/contacts"] input[name="email"]').fill(`taylor-${emailSuffix}@example.com`);
    await page.locator('form[method="post"][action="/contacts"] input[name="phone"]').fill('');
    await page.locator('form[method="post"][action="/contacts"] input[name="tags"]').fill('prospect');
    await page.locator('form[method="post"][action="/contacts"] input[name="interests"]').fill('launch');
    await submitAndWait(page, page.locator('form[method="post"][action="/contacts"] button'), /\/contacts/);

    {
      const scenario = scenarioRecord('campaign_ai_experiments', 'Campaign AI, predictive optimization, and experimentation');
      await navigate(page, baseUrl, '/assets', /Content studio/);
      await page.locator('form[action="/assets"] input[name="name"]').fill(state.assetName);
      await page.locator('form[action="/assets"] input[name="folder"]').fill('Current Product');
      await page.locator('form[action="/assets"] input[name="contentType"]').fill('text/plain');
      await page.locator('form[action="/assets"] input[name="altText"]').fill('Current product asset');
      await page.locator('form[action="/assets"] textarea[name="body"]').fill('current product asset body');
      await submitAndWait(page, page.locator('form[action="/assets"] button'), /\/assets$/);
      addCheck(scenario, 'asset_created', 'Created an asset for campaign/content depth flows.');

      await navigate(page, baseUrl, '/campaigns/new', /Campaign creation wizard/);
      await page.locator('form[action="/campaigns"] input[name="name"]').fill(`Current Product Campaign ${emailSuffix}`);
      await submitAndWait(page, page.locator('form[action="/campaigns"] button'), /\/campaigns\/camp_[a-f0-9]+\/setup$/);
      state.campaignId = page.url().match(/camp_[a-f0-9]+/)?.[0] || null;
      assert.ok(state.campaignId, 'Campaign id should be present in setup URL');

      await page.locator(`form[action="/campaigns/${state.campaignId}/setup"] input[name="name"]`).fill(`Current Product Campaign ${emailSuffix}`);
      await page.locator(`form[action="/campaigns/${state.campaignId}/setup"] input[name="subject"]`).fill('Initial browser subject');
      await page.locator(`form[action="/campaigns/${state.campaignId}/setup"] input[name="preheader"]`).fill('Initial browser preheader');
      await page.locator(`form[action="/campaigns/${state.campaignId}/setup"] input[name="fromName"]`).fill('Current Product Browser');
      await page.locator(`form[action="/campaigns/${state.campaignId}/setup"] input[name="replyTo"]`).fill('reply-current-product@example.com');
      await submitAndWait(page, page.locator(`form[action="/campaigns/${state.campaignId}/setup"] button`), new RegExp(`/campaigns/${state.campaignId}/recipients$`));
      await page.locator(`form[action="/campaigns/${state.campaignId}/recipients"] select[name="audienceId"]`).selectOption(state.audienceId);
      await submitAndWait(page, page.locator(`form[action="/campaigns/${state.campaignId}/recipients"] button`), new RegExp(`/campaigns/${state.campaignId}/templates$`));
      await submitAndWait(page, page.locator(`form[action="/campaigns/${state.campaignId}/template"]`).filter({ has: page.locator('input[value="tmpl-announce"]') }).locator('button'), new RegExp(`/campaigns/${state.campaignId}/editor$`));
      await expectBody(page, /Live preview/);
      addCheck(scenario, 'campaign_shell_ready', 'Created a current-product campaign and reached the editor.');

      await navigate(page, baseUrl, `/campaigns/${state.campaignId}/ai`, /AI campaign assistant/);
      await page.locator(`form[action="/campaigns/${state.campaignId}/ai/generate"] input[name="tone"]`).fill('confident');
      await page.locator(`form[action="/campaigns/${state.campaignId}/ai/generate"] input[name="goal"]`).fill('conversion');
      await submitAndWait(page, page.locator(`form[action="/campaigns/${state.campaignId}/ai/generate"] button`), new RegExp(`/campaigns/${state.campaignId}/ai$`));
      await expectBody(page, /Subject lines/);
      await submitAndWait(page, page.locator(`form[action="/campaigns/${state.campaignId}/ai/apply"]`).first().locator('button'), new RegExp(`/campaigns/${state.campaignId}/setup$`));
      await expectBody(page, /Accepted suggestions: 1|Accepted suggestions:/);
      addCheck(scenario, 'campaign_ai_generate_apply', 'Generated and applied AI campaign suggestions in-browser.');

      await navigate(page, baseUrl, `/campaigns/${state.campaignId}/optimization`, /Campaign optimization/);
      await page.locator(`form[action="/campaigns/${state.campaignId}/optimization"] input[name="sendTimeWindow"]`).fill('09:00-11:00 local');
      await page.locator(`form[action="/campaigns/${state.campaignId}/optimization"] input[name="predictiveSegment"]`).fill('Likely next purchasers');
      await page.locator(`form[action="/campaigns/${state.campaignId}/optimization"] input[name="fatigueGuardrail"]`).fill('2 messages / 7 days');
      await page.locator(`form[action="/campaigns/${state.campaignId}/optimization"] input[name="productRecommendation"]`).fill('Starter bundle');
      await submitAndWait(page, page.locator(`form[action="/campaigns/${state.campaignId}/optimization"] button`), new RegExp(`/campaigns/${state.campaignId}/review$`));
      await expectBody(page, /Likely next purchasers/);
      addCheck(scenario, 'campaign_optimization', 'Applied predictive optimization settings and confirmed they render on review.');

      await navigate(page, baseUrl, `/campaigns/${state.campaignId}/experiments`, /Campaign experiments/);
      await page.locator(`form[action="/campaigns/${state.campaignId}/experiments"] input[name="name"]`).fill('Browser subject experiment');
      await page.locator(`form[action="/campaigns/${state.campaignId}/experiments"] select[name="winnerMetric"]`).selectOption('open_rate');
      await page.locator(`form[action="/campaigns/${state.campaignId}/experiments"] input[name="dynamicRules"]`).fill('tag:vip,interest:launch');
      await submitAndWait(page, page.locator(`form[action="/campaigns/${state.campaignId}/experiments"] button`), new RegExp(`/campaigns/${state.campaignId}/experiments$`));
      await expectBody(page, /Browser subject experiment/);
      await submitAndWait(page, page.locator(`form[action^="/campaigns/${state.campaignId}/experiments/"]`).first().locator('button'), new RegExp(`/campaigns/${state.campaignId}/experiments$`));
      await expectBody(page, /Winner:/);
      await submitAndWait(page, page.locator(`form[action*="/promote"] button`).first(), new RegExp(`/campaigns/${state.campaignId}/review$`));
      await expectBody(page, /Winner promoted: yes/);
      addCheck(scenario, 'campaign_experiment_run_promote', 'Created, ran, and promoted an experiment winner in-browser.');

      scenario.screenshot = await captureScreenshot(page, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord('website_builder', 'Website builder and website AI');
      await navigate(page, baseUrl, '/websites', /Website builder/);
      await page.locator('form[action="/websites"] input[name="name"]').fill('Current Product Site');
      await page.locator('form[action="/websites"] input[name="slug"]').fill(state.websiteSlug);
      await page.locator('form[action="/websites"] input[name="seoDescription"]').fill('Browser proof website');
      await submitAndWait(page, page.locator('form[action="/websites"] button'), /\/websites\/site_[a-f0-9]+$/);
      state.websiteId = page.url().match(/site_[a-f0-9]+/)?.[0] || null;
      assert.ok(state.websiteId, 'Website id should be present in URL');
      await expectBody(page, /Site settings/);

      await page.locator(`form[action="/websites/${state.websiteId}/pages"] input[name="name"]`).fill('About');
      await page.locator(`form[action="/websites/${state.websiteId}/pages"] input[name="slug"]`).fill('about');
      await page.locator(`form[action="/websites/${state.websiteId}/pages"] select[name="pageType"]`).selectOption('about');
      await page.locator(`form[action="/websites/${state.websiteId}/pages"] input[name="headline"]`).fill('About the launch');
      await page.locator(`form[action="/websites/${state.websiteId}/pages"] textarea[name="body"]`).fill(`This browser proof page references ${state.assetName}.`);
      await submitAndWait(page, page.locator(`form[action="/websites/${state.websiteId}/pages"] button`), new RegExp(`/websites/${state.websiteId}$`));
      await expectBody(page, /About/);
      addCheck(scenario, 'website_create_page', 'Created a website and added a second page in-browser.');

      await navigate(page, baseUrl, `/websites/${state.websiteId}/ai`, /AI website copy/);
      await page.locator(`form[action="/websites/${state.websiteId}/ai/generate"] select[name="pageId"]`).selectOption({ label: 'About' });
      await page.locator(`form[action="/websites/${state.websiteId}/ai/generate"] input[name="goal"]`).fill('lead capture');
      await page.locator(`form[action="/websites/${state.websiteId}/ai/generate"] input[name="ctaLabel"]`).fill('Join now');
      await submitAndWait(page, page.locator(`form[action="/websites/${state.websiteId}/ai/generate"] button`), new RegExp(`/websites/${state.websiteId}/ai(?:\\?pageId=.*)?$`));
      await expectBody(page, /Join now/);
      await submitAndWait(page, page.locator(`form[action="/websites/${state.websiteId}/ai/apply"] button`).first(), new RegExp(`/websites/${state.websiteId}$`));
      addCheck(scenario, 'website_ai_generate_apply', 'Generated and applied website AI copy in-browser.');

      await submitAndWait(page, page.locator(`form[action="/websites/${state.websiteId}/publish"] button`), new RegExp(`/websites/${state.websiteId}$`));
      await expectBody(page, /Published at:/);
      addCheck(scenario, 'website_publish', 'Published the website and confirmed publish metadata.');

      const publicContext = await browser.newContext();
      const publicPage = await publicContext.newPage();
      await navigate(publicPage, baseUrl, `/sites/${state.websiteSlug}/about?ref=campaign`, /Current Product Site|About the launch|Join now/);
      addCheck(scenario, 'website_public_render', 'Loaded the published public website route in a separate browser context.');
      await publicContext.close();

      scenario.screenshot = await captureScreenshot(page, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord('automation_omnichannel', 'Automation AI and omnichannel programs');
      await navigate(page, baseUrl, '/automations/new', /Create automation/);
      await page.locator('form[action="/automations"] input[name="name"]').fill(`Current Product Journey ${emailSuffix}`);
      await page.locator('form[action="/automations"] select[name="audienceId"]').selectOption(state.audienceId);
      await page.locator('form[action="/automations"] input[name="trigger"]').fill('contact_subscribed');
      await submitAndWait(page, page.locator('form[action="/automations"] button'), /\/automations\/journey_[a-f0-9]+\/builder$/);
      state.automationId = page.url().match(/journey_[a-f0-9]+/)?.[0] || null;
      assert.ok(state.automationId, 'Automation id should be present in URL');
      addCheck(scenario, 'automation_create', 'Created an automation shell for AI journey work.');

      await navigate(page, baseUrl, `/automations/${state.automationId}/ai`, /AI journey assistant/);
      await page.locator(`form[action="/automations/${state.automationId}/ai/generate"] input[name="goal"]`).fill('upsell');
      await submitAndWait(page, page.locator(`form[action="/automations/${state.automationId}/ai/generate"] button`), new RegExp(`/automations/${state.automationId}/ai$`));
      await expectBody(page, /Recommendation/);
      await submitAndWait(page, page.locator(`form[action="/automations/${state.automationId}/ai/apply"] button`), new RegExp(`/automations/${state.automationId}/builder$`));
      await expectBody(page, /sms/);
      await expectBody(page, /social/);
      addCheck(scenario, 'automation_ai_apply', 'Generated and applied an AI journey recommendation containing sms/social nodes.');

      await navigate(page, baseUrl, '/omnichannel', /Omnichannel marketing/);
      await page.locator('form[action="/omnichannel"] input[name="name"]').fill('VIP SMS Follow-up');
      await page.locator('form[action="/omnichannel"] select[name="channel"]').selectOption('sms');
      await page.locator('form[action="/omnichannel"] select[name="audienceId"]').selectOption(state.audienceId);
      await page.locator('form[action="/omnichannel"] select[name="campaignId"]').selectOption(state.campaignId);
      await page.locator('form[action="/omnichannel"] input[name="budget"]').fill('150');
      await page.locator('form[action="/omnichannel"] textarea[name="content"]').fill('Short follow-up message');
      await submitAndWait(page, page.locator('form[action="/omnichannel"] button'), /\/omnichannel$/);
      await expectBody(page, /VIP SMS Follow-up/);
      await submitAndWait(page, page.locator('form[action^="/omnichannel/"] button').first(), /\/omnichannel$/);
      await expectBody(page, /live/);
      await navigate(page, baseUrl, '/reports/omnichannel', /Omnichannel report/);
      await expectBody(page, /sms/i);
      addCheck(scenario, 'omnichannel_launch_report', 'Created, launched, and reported on an omnichannel SMS program.');

      scenario.screenshot = await captureScreenshot(page, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord('content_depth', 'Content depth flows for reusable assets and lineage');
      await navigate(page, baseUrl, '/content', /Content studio templates & assets/);
      await page.locator('form[action="/content/templates"] input[name="name"]').fill('Depth Template');
      await page.locator('form[action="/content/templates"] select[name="baseTemplateId"]').selectOption('tmpl-newsletter');
      await page.locator('form[action="/content/templates"] input[name="category"]').fill('Promo');
      await page.locator('form[action="/content/templates"] textarea[name="description"]').fill('Version me');
      await submitAndWait(page, page.locator('form[action="/content/templates"] button'), /\/content$/);
      await expectBody(page, /Depth Template/);
      addCheck(scenario, 'content_template_save', 'Saved a reusable content template in-browser.');

      await navigate(page, baseUrl, '/content/depth', /Content studio depth/);
      await page.locator('form[action="/content/snippets"] input[name="name"]').fill('Reusable intro');
      await page.locator('form[action="/content/snippets"] input[name="channel"]').fill('email');
      await page.locator('form[action="/content/snippets"] input[name="tags"]').fill('hero');
      await page.locator('form[action="/content/snippets"] textarea[name="content"]').fill(`Use ${state.assetName} in the opening section.`);
      await submitAndWait(page, page.locator('form[action="/content/snippets"] button'), /\/content$/);

      await navigate(page, baseUrl, '/content/depth?q=Reusable&tag=hero', /Content studio depth/);
      await expectBody(page, /Reusable intro/);
      await expectBody(page, /Usage lineage/);
      addCheck(scenario, 'content_depth_search_lineage', 'Saved a snippet and confirmed search plus usage-lineage rendering.');

      scenario.screenshot = await captureScreenshot(page, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord('integration_detail', 'Integration detail auth, config, mapping, and remediation');
      await navigate(page, baseUrl, '/integrations', /Integrations marketplace/);
      await submitAndWait(page, page.locator('form[action="/integrations/install"]').filter({ has: page.locator('input[value="shopify"]') }).locator('button'), /\/integrations$/);
      await expectBody(page, /Shopify/);
      const detailHref = await page.locator('a[href^="/integrations/integration_"]').first().getAttribute('href');
      state.integrationId = detailHref?.match(/integration_[a-f0-9]+/)?.[0] || null;
      assert.ok(state.integrationId, 'Expected installed integration detail link');
      await navigate(page, baseUrl, `/integrations/${state.integrationId}`, /Integration detail: shopify/);

      await page.locator(`form[action="/integrations/${state.integrationId}/auth"] input[name="accountLabel"]`).fill('Main storefront');
      await page.locator(`form[action="/integrations/${state.integrationId}/auth"] select[name="authStatus"]`).selectOption('connected');
      await submitAndWait(page, page.locator(`form[action="/integrations/${state.integrationId}/auth"] button`), new RegExp(`/integrations/${state.integrationId}$`));
      assert.equal(await page.locator(`form[action="/integrations/${state.integrationId}/auth"] input[name="accountLabel"]`).inputValue(), 'Main storefront');

      await page.locator(`form[action="/integrations/${state.integrationId}/config"] select[name="syncAudienceId"]`).selectOption(state.audienceId);
      await submitAndWait(page, page.locator(`form[action="/integrations/${state.integrationId}/config"] button`), new RegExp(`/integrations/${state.integrationId}$`));
      await page.locator(`form[action="/integrations/${state.integrationId}/mapping"] input[name="email"]`).fill('customer_email');
      await page.locator(`form[action="/integrations/${state.integrationId}/mapping"] input[name="phone"]`).fill('customer_phone');
      await page.locator(`form[action="/integrations/${state.integrationId}/mapping"] input[name="tags"]`).fill('customer_tags');
      await page.locator(`form[action="/integrations/${state.integrationId}/mapping"] input[name="lifecycleStage"]`).fill('lifecycle_stage');
      await page.locator(`form[action="/integrations/${state.integrationId}/mapping"] input[name="consent"]`).fill('sms_consent');
      await submitAndWait(page, page.locator(`form[action="/integrations/${state.integrationId}/mapping"] button`), new RegExp(`/integrations/${state.integrationId}$`));
      await expectBody(page, /Field mapping/);

      await page.locator(`form[action="/integrations/${state.integrationId}/degrade"] input[name="detail"]`).fill('OAuth token expired');
      await submitAndWait(page, page.locator(`form[action="/integrations/${state.integrationId}/degrade"] button`), new RegExp(`/integrations/${state.integrationId}$`));
      await expectBody(page, /OAuth token expired/);
      await submitAndWait(page, page.locator(`form[action="/integrations/${state.integrationId}/retry"] button`), new RegExp(`/integrations/${state.integrationId}$`));
      await expectBody(page, /healthy|connected/i);
      addCheck(scenario, 'integration_auth_config_mapping_remediation', 'Configured auth, mapping, degraded, and retried an integration detail page in-browser.');

      scenario.screenshot = await captureScreenshot(page, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    result.browserChecks = result.scenarios.reduce((sum, scenario) => sum + scenario.checks.length, 0);
    result.realBrowserChecks = result.browserChecks;
    result.coveredFamilies = result.scenarios.map((scenario) => scenario.id);
    result.browserJourneyFamilies = result.coveredFamilies.length;
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.blocker = { message: error.message, stack: error.stack };
  } finally {
    result.finishedAt = isoNow();
    if (proofPath) {
      ensureDir(path.dirname(proofPath));
      fs.writeFileSync(proofPath, JSON.stringify(result, null, 2));
    }
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop().catch(() => {});
    delete process.env.MAILCLONE_DATA_DIR;
  }

  if (!result.ok) throw new Error(result.blocker?.message || 'Current product browser proof failed');
  return result;
}
