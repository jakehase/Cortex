import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createTempDataDir, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('public marketing surface exposes richer home, pricing, features, and help pages without Anchor Mailer branding', async () => {
  const { server, baseUrl } = await boot();
  try {
    const home = await request(baseUrl, null, '/');
    const homeHtml = await home.text();
    assert.match(homeHtml, /Turn audience insight into campaigns, journeys, forms, and websites/);
    assert.match(homeHtml, /Pricing/);
    assert.match(homeHtml, /Email marketing/);
    assert.match(homeHtml, /Marketing automation/);
    assert.doesNotMatch(homeHtml, /Anchor Mailer/);

    const pricing = await request(baseUrl, null, '/pricing');
    const pricingHtml = await pricing.text();
    assert.match(pricingHtml, /Choose a plan that matches your audience/);
    assert.match(pricingHtml, /Premium/);
    assert.match(pricingHtml, /Standard/);

    const email = await request(baseUrl, null, '/features/email-marketing');
    const emailHtml = await email.text();
    assert.match(emailHtml, /Build, schedule, approve, and report on email campaigns/);
    assert.match(emailHtml, /Campaign workflow/);

    const automation = await request(baseUrl, null, '/features/marketing-automation');
    const automationHtml = await automation.text();
    assert.match(automationHtml, /Design customer journeys that react to signup/);
    assert.match(automationHtml, /Journey builder/);

    const website = await request(baseUrl, null, '/features/website-builder');
    const websiteHtml = await website.text();
    assert.match(websiteHtml, /Publish branded pages and websites/);
    assert.match(websiteHtml, /Website management/);

    const help = await request(baseUrl, null, '/help');
    const helpHtml = await help.text();
    assert.match(helpHtml, /Get oriented on signup, campaigns, automations, forms, websites, and reporting/);
    assert.match(helpHtml, /How do forms and landing pages connect to automations/);

    const templates = await request(baseUrl, null, '/templates');
    const templatesHtml = await templates.text();
    assert.match(templatesHtml, /Start from campaign, automation, website, and landing page templates/);
    assert.match(templatesHtml, /Product launch/);
    assert.match(templatesHtml, /Growth journey templates/);

    const resources = await request(baseUrl, null, '/resources');
    const resourcesHtml = await resources.text();
    assert.match(resourcesHtml, /Learn the workflows behind campaigns, automations, websites, forms, and reporting/);
    assert.match(resourcesHtml, /Automation blueprint/);
    assert.match(resourcesHtml, /Reporting checklist/);

    const customers = await request(baseUrl, null, '/customers');
    const customersHtml = await customers.text();
    assert.match(customersHtml, /See how marketing teams combine email, journeys, websites, and forms to grow faster/);
    assert.match(customersHtml, /Northwind Studio/);
    assert.match(customersHtml, /Cedar Lane Market/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
