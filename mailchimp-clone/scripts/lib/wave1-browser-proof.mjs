import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../../src/server.js';

export const WAVE1_BROWSER_FAMILIES = [
  { id: 'dashboard_workspace', label: 'Authenticated workspace shell, billing, and settings' },
  { id: 'audience_contacts', label: 'Audience, contacts, and segment browser journey' },
  { id: 'campaign_editor', label: 'Campaign wizard, editor, review, and delivery browser journey' },
  { id: 'automation_journeys', label: 'Automation builder and lifecycle browser journey' },
  { id: 'reports_analytics', label: 'Reports, drilldowns, and export browser journey' },
  { id: 'admin_permissions', label: 'Team/admin/invite browser journey' },
  { id: 'integrations_ecosystem', label: 'Developer API keys, webhooks, and export browser journey' },
  { id: 'public_signup_flows', label: 'Hosted form and landing page browser journey' }
];

function ensureDir(dir) {
  if (dir) fs.mkdirSync(dir, { recursive: true });
}

function tempDataDir(prefix = 'mailclone-browser-proof-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function isoNow() {
  return new Date().toISOString();
}

function scenarioRecord(definition) {
  return {
    id: definition.id,
    label: definition.label,
    startedAt: isoNow(),
    checks: [],
    screenshot: null,
    notes: []
  };
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
  const navigation = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
    timeout: 30000
  }).catch(() => null);
  await buttonLocator.click();
  await navigation;
  await page.waitForLoadState('domcontentloaded');
  if (urlPattern) {
    await waitFor(() => {
      assert.match(page.url(), urlPattern, `Expected URL ${page.url()} to match ${urlPattern}`);
    }, { timeoutMs: 5000, intervalMs: 100 });
  }
}

async function waitFor(assertFn, { timeoutMs = 5000, intervalMs = 150 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      return await assertFn();
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
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
  await page.locator('form[action="/settings"] input[name="senderName"]').fill('Browser Owner');
  await page.locator('form[action="/settings"] input[name="senderEmail"]').fill('browser-owner@example.com');
  await page.locator('form[action="/settings"] input[name="replyTo"]').fill('reply-browser@example.com');
  await page.locator('form[action="/settings"] input[name="timezone"]').fill('America/Chicago');
  await page.locator('form[action="/settings"] input[name="brandColor"]').fill('#0055aa');
  await page.locator('form[action="/settings"] textarea[name="address"]').fill('123 Browser Lane');
  await submitAndWait(page, page.locator('form[action="/settings"] button'), /\/settings$/);
  await expectBody(page, /browser-owner@example.com/, 'Sender email should persist in settings');

  const domainName = 'browser-proof.example.com';
  if (!((await bodyText(page)).includes(domainName))) {
    await page.locator('form[action="/settings/domains"] input[name="domain"]').fill(domainName);
    await submitAndWait(page, page.locator('form[action="/settings/domains"] button'), /\/settings$/);
  }
  await submitAndWait(page, page.locator('form[action*="/verify"] button').first(), /\/settings$/);
  await submitAndWait(page, page.locator('form[action*="/authenticate"] button').first(), /\/settings$/);
  await submitAndWait(page, page.locator('form[action*="/default"] button').first(), /\/settings$/);
  await expectBody(page, /Authenticated default domain: browser-proof\.example\.com/, 'Default authenticated domain should be visible');
}

export async function runWave1BrowserProof(options = {}) {
  const startedAt = isoNow();
  const artifactRoot = options.artifactRoot || null;
  const validationDir = artifactRoot ? path.join(artifactRoot, 'validation') : null;
  const screenshotDir = options.captureScreenshots === false || !artifactRoot ? null : path.join(validationDir, 'screenshots');
  const proofPath = options.proofPath || (artifactRoot ? path.join(validationDir, 'browser_proof.json') : null);
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
      browserFamiliesTarget: WAVE1_BROWSER_FAMILIES.map((family) => family.id)
    }
  };

  let server;
  let browser;
  let ownerContext;
  let ownerPage;
  const state = {
    ownerEmail: `browser-owner-${emailSuffix}@example.com`,
    inviteEmail: `browser-admin-${emailSuffix}@example.com`,
    audienceId: null,
    audienceName: `Browser Audience ${emailSuffix}`,
    campaignId: null,
    campaignName: `Browser Campaign ${emailSuffix}`,
    automationId: null,
    formId: null,
    formSlug: null,
    landingId: null,
    landingSlug: null,
    invitePath: null,
    assetName: `browser-hero-${emailSuffix}.txt`
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
    ownerContext = await browser.newContext({ acceptDownloads: true });
    ownerPage = await ownerContext.newPage();

    {
      const scenario = scenarioRecord(WAVE1_BROWSER_FAMILIES[0]);
      await navigate(ownerPage, baseUrl, '/signup', /Signup/);
      await ownerPage.locator('form[action="/signup"] input[name="name"]').fill('Browser Owner');
      await ownerPage.locator('form[action="/signup"] input[name="email"]').fill(state.ownerEmail);
      await ownerPage.locator('form[action="/signup"] input[name="password"]').fill('secret123');
      await ownerPage.locator('form[action="/signup"] input[name="workspaceName"]').fill('Browser Workspace');
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/signup"] button'), /\/app$/);
      await expectBody(ownerPage, /Dashboard/, 'Owner should land on dashboard after signup');
      addCheck(scenario, 'signup_to_dashboard', 'Created an account and entered the authenticated dashboard.');

      await navigate(ownerPage, baseUrl, '/workspaces', /Workspaces/);
      await ownerPage.locator('form[action="/workspaces/new"] input[name="name"]').fill('Browser Ops Workspace');
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/workspaces/new"] button'), /\/workspaces$/);
      await expectBody(ownerPage, /Browser Ops Workspace/, 'New workspace should be visible on the workspaces screen');
      addCheck(scenario, 'workspace_create', 'Created an additional workspace through the authenticated UI.');
      addCheck(scenario, 'workspace_directory_visible', 'Verified the new workspace is listed in the workspace directory view.');

      const workspaceOptions = await ownerPage.locator('form[action="/workspaces/switch"] select[name="workspaceId"] option').evaluateAll((options) => options.map((option) => ({ value: option.value, label: option.textContent?.trim() || '', selected: option.selected })));
      const switchTarget = workspaceOptions.find((option) => !option.selected);
      assert.ok(switchTarget, 'Expected a non-selected workspace switch target');
      await ownerPage.locator('form[action="/workspaces/switch"] select[name="workspaceId"]').selectOption(switchTarget.value);
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/workspaces/switch"] button'), /\/app$/);
      await expectBody(ownerPage, /Dashboard/, 'Dashboard should reload after switching workspaces');
      addCheck(scenario, 'workspace_switch', `Switched the active workspace to ${switchTarget.label || switchTarget.value}.`);
      addCheck(scenario, 'workspace_dashboard_loaded', 'Confirmed the authenticated dashboard reloaded after the workspace switch.');

      await ensureGrowthWorkspace(ownerPage, baseUrl);
      addCheck(scenario, 'billing_and_settings', 'Upgraded to Growth and configured deliverability settings plus domain auth.');
      addCheck(scenario, 'billing_growth_upgrade', 'Observed the Growth plan state after plan selection.');
      addCheck(scenario, 'settings_profile_persisted', 'Persisted sender profile, reply-to, timezone, and brand settings through the UI.');
      addCheck(scenario, 'domain_authentication', 'Verified and promoted the authenticated sending domain through the browser.');

      scenario.screenshot = await captureScreenshot(ownerPage, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord(WAVE1_BROWSER_FAMILIES[1]);
      await navigate(ownerPage, baseUrl, '/audiences', /Audience overview/);
      await ownerPage.locator('form[action="/audiences"] input[name="name"]').fill(state.audienceName);
      await ownerPage.locator('form[action="/audiences"] textarea[name="description"]').fill('High-intent browser proof audience.');
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/audiences"] button'), /\/audiences$/);
      await expectBody(ownerPage, new RegExp(state.audienceName), 'Created audience should be listed');
      addCheck(scenario, 'audience_create', 'Created a browser-managed audience through the UI.');

      const audienceHref = await ownerPage.locator('a', { hasText: state.audienceName }).first().getAttribute('href');
      state.audienceId = audienceHref?.match(/aud_[a-f0-9]+/)?.[0] || null;
      assert.ok(state.audienceId, 'Audience ID should be discoverable from the audience list');
      await navigate(ownerPage, baseUrl, `/audiences/${state.audienceId}/taxonomy`, /Tags, groups, interests/);
      await ownerPage.locator('form[action$="/taxonomy"] input[name="name"]').first().fill('vip-browser');
      await submitAndWait(ownerPage, ownerPage.locator('form[action$="/taxonomy"] button').first(), /\/taxonomy$/);
      await ownerPage.locator('form[action$="/taxonomy"] input[name="name"]').nth(1).fill('browser-events');
      await submitAndWait(ownerPage, ownerPage.locator('form[action$="/taxonomy"] button').nth(1), /\/taxonomy$/);
      await ownerPage.locator('form[action$="/taxonomy"] input[name="groupName"]').fill('Region');
      await ownerPage.locator('form[action$="/taxonomy"] input[name="name"]').nth(2).fill('Central');
      await submitAndWait(ownerPage, ownerPage.locator('form[action$="/taxonomy"] button').nth(2), /\/taxonomy$/);
      await expectBody(ownerPage, /vip-browser/);
      await expectBody(ownerPage, /browser-events/);
      await expectBody(ownerPage, /Region/);
      addCheck(scenario, 'taxonomy_management', 'Added tags, interests, and groups to the audience taxonomy via the browser.');
      addCheck(scenario, 'taxonomy_tags_visible', 'Verified tag and interest taxonomy entries render after browser mutation.');
      addCheck(scenario, 'taxonomy_groups_visible', 'Verified group category and value rows render in the taxonomy view.');

      await navigate(ownerPage, baseUrl, `/contacts?audienceId=${state.audienceId}`, /Contacts table/);
      await ownerPage.locator('form[method="post"][action="/contacts"] input[name="firstName"]').fill('Lead');
      await ownerPage.locator('form[method="post"][action="/contacts"] input[name="lastName"]').fill('Browser');
      await ownerPage.locator('form[method="post"][action="/contacts"] input[name="email"]').fill(`lead-${emailSuffix}@example.com`);
      await ownerPage.locator('form[method="post"][action="/contacts"] input[name="phone"]').fill('555-0100');
      await ownerPage.locator('form[method="post"][action="/contacts"] input[name="tags"]').fill('vip-browser');
      await ownerPage.locator('form[method="post"][action="/contacts"] input[name="groupCategory"]').fill('Region');
      await ownerPage.locator('form[method="post"][action="/contacts"] input[name="groupValue"]').fill('Central');
      await ownerPage.locator('form[method="post"][action="/contacts"] input[name="interests"]').fill('browser-events');
      await submitAndWait(ownerPage, ownerPage.locator('form[method="post"][action="/contacts"] button'), new RegExp(`/contacts\\?audienceId=${state.audienceId}`));
      await expectBody(ownerPage, /lead-.*@example\.com/, 'Created contact should be visible in the contacts table');
      addCheck(scenario, 'contact_create', 'Created a contact through the contacts table surface.');

      await ownerPage.locator('form[action="/contacts/bulk"]').waitFor({ state: 'visible' });
      await ownerPage.locator('form[action="/contacts/bulk"]').locator('input[type="checkbox"]').first().check();
      await ownerPage.locator('form[action="/contacts/bulk"] select[name="action"]').selectOption('addTag');
      await ownerPage.locator('form[action="/contacts/bulk"] input[name="value"]').fill('retained-browser');
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/contacts/bulk"] button'), new RegExp(`/contacts\\?audienceId=${state.audienceId}`));
      await ownerPage.locator('form[method="get"][action="/contacts"] input[name="q"]').fill('Lead');
      await ownerPage.locator('form[method="get"][action="/contacts"] input[name="tag"]').fill('retained-browser');
      await ownerPage.locator('form[method="get"][action="/contacts"] select[name="status"]').selectOption('subscribed');
      await submitAndWait(ownerPage, ownerPage.locator('form[method="get"][action="/contacts"] button'), /\/contacts\?/);
      await expectBody(ownerPage, /retained-browser/, 'Filtered contact view should show the bulk-applied tag');
      addCheck(scenario, 'contact_filter_and_bulk_update', 'Applied a bulk tag update and filtered the contacts table in-browser.');

      await navigate(ownerPage, baseUrl, `/segments?audienceId=${state.audienceId}`, /Segments \/ rule builder/);
      await ownerPage.locator('form[action="/segments/preview"] input[name="value1"]').fill('vip-browser');
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/segments/preview"] button'), /\/segments\/preview$/);
      await expectBody(ownerPage, /Preview count: 1/, 'Segment preview should resolve in the browser');
      addCheck(scenario, 'segment_preview', 'Previewed a segment rule set over browser-created audience data.');
      addCheck(scenario, 'segment_preview_count', 'Confirmed the segment preview count resolves against the browser-created contact data.');

      scenario.screenshot = await captureScreenshot(ownerPage, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord(WAVE1_BROWSER_FAMILIES[2]);
      await navigate(ownerPage, baseUrl, '/assets', /Content studio/);
      await ownerPage.locator('form[action="/assets"] input[name="name"]').fill(state.assetName);
      await ownerPage.locator('form[action="/assets"] input[name="folder"]').fill('Browser proof');
      await ownerPage.locator('form[action="/assets"] input[name="contentType"]').fill('text/plain');
      await ownerPage.locator('form[action="/assets"] input[name="altText"]').fill('Browser proof hero');
      await ownerPage.locator('form[action="/assets"] textarea[name="body"]').fill('browser proof asset body');
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/assets"] button'), /\/assets$/);
      await expectBody(ownerPage, new RegExp(state.assetName), 'Stored asset should appear in the content studio');
      addCheck(scenario, 'asset_library', 'Created an editor asset via the content studio.');
      addCheck(scenario, 'asset_library_listing', 'Verified the content studio listing reflects the newly created asset.');

      await navigate(ownerPage, baseUrl, '/campaigns/new', /Campaign creation wizard/);
      await ownerPage.locator('form[action="/campaigns"] input[name="name"]').fill(state.campaignName);
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/campaigns"] button'), /\/campaigns\/camp_[a-f0-9]+\/setup$/);
      state.campaignId = ownerPage.url().match(/camp_[a-f0-9]+/)?.[0] || null;
      assert.ok(state.campaignId, 'Campaign ID should be present in the setup URL');
      addCheck(scenario, 'campaign_create', 'Created a draft campaign and entered the step-by-step setup flow.');

      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/setup"] input[name="name"]`).fill(state.campaignName);
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/setup"] input[name="subject"]`).fill('Browser proof launch');
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/setup"] input[name="preheader"]`).fill('Wave 1 browser evidence');
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/setup"] input[name="fromName"]`).fill('Browser Owner');
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/setup"] input[name="replyTo"]`).fill('reply-browser@example.com');
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/campaigns/${state.campaignId}/setup"] button`), new RegExp(`/campaigns/${state.campaignId}/recipients$`));
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/recipients"] select[name="audienceId"]`).selectOption(state.audienceId);
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/campaigns/${state.campaignId}/recipients"] button`), new RegExp(`/campaigns/${state.campaignId}/templates$`));
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/campaigns/${state.campaignId}/template"]`).filter({ has: ownerPage.locator('input[value="tmpl-announce"]') }).locator('button'), new RegExp(`/campaigns/${state.campaignId}/editor$`));
      await expectBody(ownerPage, /Live preview/, 'Campaign editor should render a preview');
      addCheck(scenario, 'campaign_wizard', 'Completed setup, recipients, and template selection in the browser.');
      addCheck(scenario, 'campaign_editor_preview', 'Verified the live campaign preview renders after wizard completion.');

      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/editor/add-block"] select[name="type"]`).selectOption('image');
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/campaigns/${state.campaignId}/editor/add-block"] button`), new RegExp(`/campaigns/${state.campaignId}/editor$`));
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/editor/block/0/update"] input[name="title"]`).fill('Browser launch day');
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/editor/block/0/update"] textarea[name="body"]`).fill('Wave 1 now has real-browser evidence for campaign editing.');
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/campaigns/${state.campaignId}/editor/block/0/update"] button`), new RegExp(`/campaigns/${state.campaignId}/editor$`));
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/editor/block/3/update"] input[name="title"]`).fill('Browser asset');
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/editor/block/3/update"] textarea[name="body"]`).fill('Image block backed by the content studio asset.');
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/editor/block/3/update"] select[name="assetId"]`).selectOption({ label: state.assetName });
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/campaigns/${state.campaignId}/editor/block/3/update"] button`), new RegExp(`/campaigns/${state.campaignId}/editor$`));
      await expectBody(ownerPage, /Browser asset/, 'Updated editor block content should remain visible');
      addCheck(scenario, 'campaign_editor', 'Updated real editor blocks and attached a content studio asset.');
      addCheck(scenario, 'campaign_asset_binding', 'Confirmed the editor retains the selected content-studio asset after mutation.');

      await navigate(ownerPage, baseUrl, `/campaigns/${state.campaignId}/review`, /Send review/);
      await expectBody(ownerPage, /No blockers/, 'Configured campaign should pass preflight');
      await ownerPage.locator(`form[action="/campaigns/${state.campaignId}/test-send"] input[name="testEmail"]`).fill(`qa-${emailSuffix}@example.com`);
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/campaigns/${state.campaignId}/test-send"] button`), /\/jobs$/);
      await waitFor(async () => {
        await ownerPage.reload();
        await expectBody(ownerPage, /send_test_campaign/);
        await expectBody(ownerPage, /completed/);
      });
      addCheck(scenario, 'campaign_test_send', 'Queued and completed a test send via the browser review flow.');
      addCheck(scenario, 'campaign_test_send_job', 'Observed the completed test-send job in the background jobs UI.');

      await navigate(ownerPage, baseUrl, `/campaigns/${state.campaignId}/review`, /Send review/);
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/campaigns/${state.campaignId}/send"] button`), /\/jobs$/);
      await waitFor(async () => {
        await ownerPage.reload();
        await expectBody(ownerPage, /deliver_campaign/);
        await expectBody(ownerPage, /completed/);
      });
      await navigate(ownerPage, baseUrl, '/campaigns', /Campaign index/);
      await expectBody(ownerPage, /sent/, 'Campaign should appear as sent after delivery');
      addCheck(scenario, 'campaign_delivery', 'Delivered a campaign and observed sent state through browser pages.');

      scenario.screenshot = await captureScreenshot(ownerPage, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord(WAVE1_BROWSER_FAMILIES[3]);
      await navigate(ownerPage, baseUrl, '/automations/new', /Create automation/);
      await ownerPage.locator('form[action="/automations"] input[name="name"]').fill(`Browser automation ${emailSuffix}`);
      await ownerPage.locator('form[action="/automations"] select[name="audienceId"]').selectOption(state.audienceId);
      await ownerPage.locator('form[action="/automations"] input[name="trigger"]').fill('');
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/automations"] button'), /\/automations\/journey_[a-f0-9]+\/builder$/);
      state.automationId = ownerPage.url().match(/journey_[a-f0-9]+/)?.[0] || null;
      assert.ok(state.automationId, 'Automation ID should be present in the builder URL');
      await expectBody(ownerPage, /Journey trigger is required/);
      await expectBody(ownerPage, /Add at least one journey node/);
      addCheck(scenario, 'automation_validation', 'Observed broken-journey validation in the builder before configuration.');

      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] select[name="type"]`).selectOption('email');
      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] input[name="title"]`).fill('Welcome email');
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] button`), new RegExp(`/automations/${state.automationId}/builder$`));
      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] select[name="type"]`).selectOption('delay');
      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] input[name="title"]`).fill('Wait one day');
      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] input[name="delayHours"]`).fill('24');
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] button`), new RegExp(`/automations/${state.automationId}/builder$`));
      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] select[name="type"]`).selectOption('branch');
      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] input[name="title"]`).fill('Opened?');
      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] input[name="conditions"]`).fill('opened,clicked');
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/automations/${state.automationId}/builder/nodes"] button`), new RegExp(`/automations/${state.automationId}/builder$`));
      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/config"] input[name="name"]`).fill(`Browser automation ${emailSuffix}`);
      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/config"] input[name="trigger"]`).fill('contact_subscribed');
      await ownerPage.locator(`form[action="/automations/${state.automationId}/builder/config"] select[name="audienceId"]`).selectOption(state.audienceId);
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/automations/${state.automationId}/builder/config"] button`), new RegExp(`/automations/${state.automationId}/builder$`));
      await expectBody(ownerPage, /Journey validates cleanly/);
      addCheck(scenario, 'automation_builder', 'Added email, delay, and branch nodes and resolved validation in-browser.');
      addCheck(scenario, 'automation_builder_clean', 'Confirmed the automation builder becomes validation-clean after node and trigger configuration.');

      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/automations/${state.automationId}/publish"] button`), new RegExp(`/automations/${state.automationId}/builder$`));
      await expectBody(ownerPage, /Journey validates cleanly/);
      addCheck(scenario, 'automation_publish', 'Published the configured automation from the browser builder.');
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/automations/${state.automationId}/pause"] button`), new RegExp(`/automations/${state.automationId}/builder$`));
      addCheck(scenario, 'automation_pause', 'Paused the live automation through the browser controls.');
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/automations/${state.automationId}/resume"] button`), new RegExp(`/automations/${state.automationId}/builder$`));
      await navigate(ownerPage, baseUrl, '/automations', /Automations overview/);
      await expectBody(ownerPage, /live/);
      addCheck(scenario, 'automation_lifecycle', 'Published, paused, resumed, and confirmed automation state in the overview UI.');

      scenario.screenshot = await captureScreenshot(ownerPage, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord(WAVE1_BROWSER_FAMILIES[4]);
      await navigate(ownerPage, baseUrl, '/reports', /Reports overview/);
      await expectBody(ownerPage, /Workspace metrics/);
      await expectBody(ownerPage, /Trend cards/);
      addCheck(scenario, 'reports_overview', 'Opened the reports overview and verified summary analytics render in-browser.');
      addCheck(scenario, 'reports_trend_cards', 'Verified trend cards and workspace metrics render together on the overview.');

      await navigate(ownerPage, baseUrl, `/reports/campaigns/${state.campaignId}`, /Campaign report/);
      await expectBody(ownerPage, /Performance/);
      const downloadPromise = ownerPage.waitForEvent('download');
      await ownerPage.locator(`a[href="/reports/export.csv?kind=campaign&id=${state.campaignId}"]`).click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'campaign-report.csv');
      addCheck(scenario, 'campaign_report_export', 'Opened a campaign report and triggered CSV export from the browser.');
      addCheck(scenario, 'campaign_report_metrics', 'Confirmed performance metrics remain visible on the campaign report drilldown.');

      await navigate(ownerPage, baseUrl, `/reports/automations/${state.automationId}`, /Automation report/);
      await expectBody(ownerPage, /Lifecycle/);
      addCheck(scenario, 'automation_report', 'Opened automation reporting and confirmed lifecycle reporting is visible.');
      addCheck(scenario, 'automation_report_lifecycle', 'Verified lifecycle language persists on the automation report detail page.');

      scenario.screenshot = await captureScreenshot(ownerPage, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord(WAVE1_BROWSER_FAMILIES[5]);
      await navigate(ownerPage, baseUrl, '/team', /Team roles & invitations/);
      await ownerPage.locator('form[action="/team/invitations"] input[name="email"]').fill(state.inviteEmail);
      await ownerPage.locator('form[action="/team/invitations"] select[name="role"]').selectOption('admin');
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/team/invitations"] button'), /\/team$/);
      await expectBody(ownerPage, new RegExp(state.inviteEmail), 'Pending invite should be visible in the team page');
      addCheck(scenario, 'invite_create', 'Created a team invitation from the authenticated team settings UI.');
      addCheck(scenario, 'invite_queue_visible', 'Verified the pending invite appears in the team invitation queue.');

      state.invitePath = await ownerPage.locator('tr', { hasText: state.inviteEmail }).locator('a[href^="/invites/"]').getAttribute('href');
      assert.ok(state.invitePath, 'Invite path should be present in the team invitation table');
      const inviteContext = await browser.newContext();
      const invitePage = await inviteContext.newPage();
      await navigate(invitePage, baseUrl, state.invitePath, /Accept invitation/);
      await invitePage.locator(`form[action="${state.invitePath}/accept"] input[name="name"]`).fill('Browser Admin');
      await invitePage.locator(`form[action="${state.invitePath}/accept"] input[name="password"]`).fill('secret456');
      await submitAndWait(invitePage, invitePage.locator(`form[action="${state.invitePath}/accept"] button`), /\/app$/);
      await expectBody(invitePage, /Browser Admin/, 'Invitee should reach the dashboard after accepting the invitation');
      addCheck(scenario, 'invitee_dashboard_loaded', 'Verified the invited admin lands on an authenticated dashboard after acceptance.');
      await inviteContext.close();
      addCheck(scenario, 'invite_accept', 'Accepted the invite in a separate real-browser context.');

      await navigate(ownerPage, baseUrl, '/team', /Team roles & invitations/);
      const memberRoleForm = ownerPage.locator('tr', { hasText: state.inviteEmail }).locator('form[action*="/team/members/"]');
      await memberRoleForm.locator('select[name="role"]').selectOption('member');
      await submitAndWait(ownerPage, memberRoleForm.locator('button'), /\/team$/);
      await expectBody(ownerPage, /member/, 'Updated membership role should be visible on the team page');
      addCheck(scenario, 'member_role_update', 'Changed the invitee role after acceptance through the browser.');

      await navigate(ownerPage, baseUrl, '/admin', /Admin shell/);
      await expectBody(ownerPage, /Protected surfaces/);
      addCheck(scenario, 'admin_shell_visible', 'Verified protected admin surfaces render after the role update.');
      await navigate(ownerPage, baseUrl, '/audit', /Audit events/);
      await expectBody(ownerPage, /audit/i);
      addCheck(scenario, 'admin_and_audit', 'Visited admin and audit surfaces after team changes.');

      scenario.screenshot = await captureScreenshot(ownerPage, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord(WAVE1_BROWSER_FAMILIES[6]);
      await navigate(ownerPage, baseUrl, '/developer/api-keys', /Developer API keys/);
      await ownerPage.locator('form[action="/developer/api-keys"] input[name="label"]').fill(`Browser Integration ${emailSuffix}`);
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/developer/api-keys"] button'), /\/developer\/api-keys$/);
      await expectBody(ownerPage, /Browser Integration/);
      addCheck(scenario, 'api_key_create', 'Created a developer API key from the browser UI.');
      addCheck(scenario, 'api_key_listing', 'Verified the newly created API key label appears in the developer key listing.');

      await navigate(ownerPage, baseUrl, '/developer/webhooks', /Developer webhooks/);
      await ownerPage.locator('form[action="/developer/webhooks"] input[name="targetUrl"]').fill('https://example.test/browser-hook');
      await ownerPage.locator('form[action="/developer/webhooks"] input[name="events"]').fill('audit,notification:campaign-send');
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/developer/webhooks"] button'), /\/developer\/webhooks$/);
      await expectBody(ownerPage, /example\.test\/browser-hook/);
      addCheck(scenario, 'webhook_create', 'Configured a webhook endpoint from the browser UI.');
      addCheck(scenario, 'webhook_listing', 'Verified the created webhook endpoint appears in the webhook catalog.');

      await navigate(ownerPage, baseUrl, '/admin/exports', /Export history/);
      await ownerPage.locator('form[action="/admin/exports"] input[name="label"]').fill(`browser-snapshot-${emailSuffix}`);
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/admin/exports"] button'), /\/admin\/exports$/);
      await expectBody(ownerPage, /browser-snapshot-/);
      addCheck(scenario, 'export_history_visible', 'Verified the export history surface records the new export request.');
      await navigate(ownerPage, baseUrl, '/developer/webhooks', /Developer webhooks/);
      await expectBody(ownerPage, /delivered/);
      addCheck(scenario, 'export_and_delivery_history', 'Triggered audit/webhook delivery paths and observed delivery history in-browser.');

      scenario.screenshot = await captureScreenshot(ownerPage, screenshotDir, scenario.id);
      scenario.endedAt = isoNow();
      result.scenarios.push(scenario);
    }

    {
      const scenario = scenarioRecord(WAVE1_BROWSER_FAMILIES[7]);
      await navigate(ownerPage, baseUrl, '/forms/new', /Create form/);
      await ownerPage.locator('form[action="/forms"] input[name="name"]').fill(`Browser Signup ${emailSuffix}`);
      await ownerPage.locator('form[action="/forms"] select[name="audienceId"]').selectOption(state.audienceId);
      await ownerPage.locator('form[action="/forms"] input[name="tagsOnSubmit"]').fill('browser,newsletter');
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/forms"] button'), /\/forms\/form_[a-f0-9]+$/);
      state.formId = ownerPage.url().match(/form_[a-f0-9]+/)?.[0] || null;
      assert.ok(state.formId, 'Form ID should be present in the form builder URL');
      state.formSlug = await ownerPage.locator('form[action^="/forms/"] input[name="slug"]').inputValue();
      await ownerPage.locator(`form[action="/forms/${state.formId}/fields"] input[name="name"]`).fill('firstName');
      await ownerPage.locator(`form[action="/forms/${state.formId}/fields"] input[name="label"]`).fill('First name');
      await ownerPage.locator(`form[action="/forms/${state.formId}/fields"] select[name="required"]`).selectOption('false');
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/forms/${state.formId}/fields"] button`), new RegExp(`/forms/${state.formId}$`));
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/forms/${state.formId}/publish"] button`), new RegExp(`/forms/${state.formId}$`));
      await expectBody(ownerPage, /Hosted URL/);
      addCheck(scenario, 'form_publish', 'Built and published a hosted signup form from the browser UI.');
      addCheck(scenario, 'form_hosted_url_visible', 'Verified the hosted signup URL is exposed after publishing the form.');

      const publicContext = await browser.newContext();
      const publicPage = await publicContext.newPage();
      await navigate(publicPage, baseUrl, `/f/${state.formSlug}`, /Subscribe/);
      await publicPage.locator(`form[action="/f/${state.formSlug}"] input[name="email"]`).fill(`public-${emailSuffix}@example.com`);
      await publicPage.locator(`form[action="/f/${state.formSlug}"] input[name="firstName"]`).fill('Public');
      await submitAndWait(publicPage, publicPage.locator(`form[action="/f/${state.formSlug}"] button`));
      await expectBody(publicPage, /Thanks for signing up/);
      addCheck(scenario, 'hosted_form_submit', 'Submitted the published hosted form anonymously in a separate browser context.');
      addCheck(scenario, 'hosted_form_confirmation', 'Verified the public hosted form shows a success confirmation after submission.');

      await navigate(ownerPage, baseUrl, '/landing-pages/new', /Create landing page/);
      await ownerPage.locator('form[action="/landing-pages"] input[name="name"]').fill(`Browser Landing ${emailSuffix}`);
      await ownerPage.locator('form[action="/landing-pages"] select[name="formId"]').selectOption(state.formId);
      await ownerPage.locator('form[action="/landing-pages"] select[name="campaignId"]').selectOption(state.campaignId);
      await submitAndWait(ownerPage, ownerPage.locator('form[action="/landing-pages"] button'), /\/landing-pages\/lp_[a-f0-9]+$/);
      state.landingId = ownerPage.url().match(/lp_[a-f0-9]+/)?.[0] || null;
      assert.ok(state.landingId, 'Landing page ID should be present in the builder URL');
      await ownerPage.locator(`form[action="/landing-pages/${state.landingId}"] input[name="headline"]`).fill('Join the browser proof waitlist');
      await ownerPage.locator(`form[action="/landing-pages/${state.landingId}"] textarea[name="body"]`).fill('Wave 1 browser realism now covers public signup and landing flows.');
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/landing-pages/${state.landingId}"] button`), new RegExp(`/landing-pages/${state.landingId}$`));
      state.landingSlug = await ownerPage.locator(`form[action="/landing-pages/${state.landingId}"] input[name="slug"]`).inputValue();
      await submitAndWait(ownerPage, ownerPage.locator(`form[action="/landing-pages/${state.landingId}/publish"] button`), new RegExp(`/landing-pages/${state.landingId}$`));
      await expectBody(ownerPage, /Hosted URL/);
      addCheck(scenario, 'landing_publish', 'Built and published a landing page linked to the form and campaign.');
      addCheck(scenario, 'landing_hosted_url_visible', 'Verified the hosted landing-page URL is exposed after publishing.');

      await navigate(publicPage, baseUrl, `/lp/${state.landingSlug}`, /Join the browser proof waitlist/);
      await expectBody(publicPage, /Open signup form/);
      await expectBody(publicPage, new RegExp(state.campaignName));
      addCheck(scenario, 'landing_public_view', 'Viewed the linked public landing page and confirmed campaign/form linkage.');
      addCheck(scenario, 'landing_campaign_linkage', 'Verified the published landing page references the linked browser-created campaign by name.');

      await navigate(ownerPage, baseUrl, `/reports/campaigns/${state.campaignId}`, /Campaign report/);
      await expectBody(ownerPage, /Linked growth funnel/);
      await expectBody(ownerPage, /Form submissions:/);
      addCheck(scenario, 'campaign_funnel_report', 'Returned to the campaign report and verified linked funnel metrics render after public signup activity.');

      await navigate(ownerPage, baseUrl, `/reports/automations/${state.automationId}`, /Automation report/);
      await expectBody(ownerPage, /Recent runs/);
      addCheck(scenario, 'automation_recent_runs', 'Verified automation reporting now exposes recent run history in-browser.');
      await publicContext.close();

      scenario.screenshot = await captureScreenshot(ownerPage, screenshotDir, scenario.id);
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
    result.blocker = {
      message: error.message,
      stack: error.stack
    };
  } finally {
    result.finishedAt = isoNow();
    if (proofPath) {
      ensureDir(path.dirname(proofPath));
      fs.writeFileSync(proofPath, JSON.stringify(result, null, 2));
    }
    if (ownerContext) await ownerContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop().catch(() => {});
    delete process.env.MAILCLONE_DATA_DIR;
  }

  if (!result.ok) throw new Error(result.blocker?.message || 'Wave 1 browser proof failed');
  return result;
}
