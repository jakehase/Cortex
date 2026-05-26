import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import {
  LEAD_CAPTURE_CONVERSION_RUNTIME_CONTRACT,
  buildLeadCaptureConversionRuntimeSnapshot,
  createLandingPageExperimentVariant,
  recordLeadAttributionEvent,
  recordLeadConsentReceipt
} from '../packages/app/domain-leads.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('lead capture conversion runtime builds attribution, consent, experiment, and funnel snapshot state', () => {
  const state = {
    db: {
      forms: [{ id: 'form_1', workspaceId: 'ws_1', name: 'Signup', status: 'published', submissions: 2, popupMode: 'popup', leadCapture: { channels: ['hosted', 'popup'], integrationHandoff: { journeyTrigger: 'form_submitted' } } }],
      landingPages: [{ id: 'lp_1', workspaceId: 'ws_1', name: 'Waitlist', status: 'published', formId: 'form_1', campaignId: 'camp_1', views: 10, submissions: 2 }],
      events: [],
      leadAttributionEvents: [],
      leadConsentReceipts: [],
      leadConversionSnapshots: [],
      landingPageExperiments: [],
      auditEvents: []
    }
  };
  assert.equal(LEAD_CAPTURE_CONVERSION_RUNTIME_CONTRACT.surfaceId, 'lead_capture_landing_page_conversion_runtime_layer');
  recordLeadAttributionEvent(state, { workspaceId: 'ws_1', formId: 'form_1', landingPageId: 'lp_1', campaignId: 'camp_1', eventType: 'landing_page_view' });
  recordLeadConsentReceipt(state, state.db.forms[0], { id: 'contact_1', workspaceId: 'ws_1', email: 'ada@example.com' }, { consentMode: 'express' });
  state.db.landingPageExperiments.unshift({ id: 'lpexp_1', workspaceId: 'ws_1', landingPageId: 'lp_1', formId: 'form_1', name: 'Hero test', trafficSplit: 45 });
  const snapshot = buildLeadCaptureConversionRuntimeSnapshot(state, 'ws_1');
  assert.equal(snapshot.forms[0].conversionRate, 20);
  assert.equal(snapshot.consentReceiptCount, 1);
  assert.equal(snapshot.experimentCount, 1);
  assert.equal(snapshot.landingPages[0].experimentCount, 1);
});

test('lead capture conversion runtime routes persist snapshots, landing experiments, consent receipts, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Lead Runtime Admin',
      email: 'lead-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Lead Runtime Lab'
    }));
    const audienceId = server.state.db.audiences[0].id;

    const create = await postForm(baseUrl, jar, '/leads/forms', {
      name: 'Conversion popup',
      audienceId,
      channels: 'hosted,popup,modal,sms_opt_in',
      triggerRule: 'exit_intent',
      placementSelector: 'pricing_page',
      consentMode: 'express',
      journeyTrigger: 'form_submitted',
      connectedProvider: 'embedded_site'
    });
    const formId = create.headers.get('location').match(/form_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/leads/forms/${formId}/targeting`, {
      channels: 'hosted,popup,modal,sms_opt_in',
      audienceRules: 'new_visitor,pricing_interest',
      geotarget: 'US,CA',
      triggerRule: 'exit_intent_after_8_seconds',
      frequencyCap: 'once_per_visitor_7_days',
      scheduleStart: '2026-05-10T09:00:00.000Z',
      scheduleEnd: '2026-06-10T09:00:00.000Z',
      consentMode: 'express',
      smsDisclosure: 'SMS consent is captured before follow-up.',
      journeyTrigger: 'form_submitted',
      connectedProvider: 'embedded_site'
    });
    await postForm(baseUrl, jar, `/leads/forms/${formId}/publish`, {});
    const form = server.state.db.forms.find((entry) => entry.id === formId);

    const landingCreate = await postForm(baseUrl, jar, '/landing-pages', {
      name: 'Conversion Landing',
      formId,
      audienceId,
      headline: 'Join the launch list',
      body: 'Get updates and launch offers.'
    });
    const landingId = landingCreate.headers.get('location').match(/lp_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/landing-pages/${landingId}`, {
      name: 'Conversion Landing',
      slug: 'conversion-landing',
      headline: 'Join the launch list',
      body: 'Get updates and launch offers.'
    });
    await postForm(baseUrl, jar, `/landing-pages/${landingId}/publish`, {});

    const linked = await request(baseUrl, jar, '/leads/landing-pages');
    let linkedHtml = await linked.text();
    assert.match(linkedHtml, /Runtime attribution events/);
    assert.match(linkedHtml, /Hero test/);

    const experiment = await postForm(baseUrl, jar, `/leads/landing-pages/${landingId}/experiments`, {
      name: 'Hero test',
      headline: 'Launch with confidence',
      ctaLabel: 'Join now',
      trafficSplit: '40'
    });
    assert.equal(experiment.status, 302);
    assert.equal(server.state.db.landingPageExperiments[0].trafficSplit, 40);

    await request(baseUrl, null, '/lp/conversion-landing');
    await request(baseUrl, null, `/f/${form.slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'runtime-subscriber@example.com', firstName: 'Riley', consentMode: 'express' })
    });
    assert.equal(server.state.db.leadAttributionEvents.some((event) => event.eventType === 'landing_page_view'), true);
    assert.equal(server.state.db.leadAttributionEvents.some((event) => event.eventType === 'form_submission'), true);
    assert.equal(server.state.db.leadConsentReceipts.length, 1);

    const snapshotPost = await postForm(baseUrl, jar, '/leads/conversion-runtime/snapshot', {});
    assert.equal(snapshotPost.status, 302);
    assert.equal(server.state.db.leadConversionSnapshots.length, 1);

    const api = await request(baseUrl, jar, '/api/leads/conversion-runtime');
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.conversionRuntime.surfaceId, 'lead_capture_landing_page_conversion_runtime_layer');
    assert.equal(payload.conversionRuntime.experimentCount, 1);
    assert.equal(payload.conversionRuntime.consentReceiptCount, 1);
    assert.equal(payload.conversionRuntime.landingPages[0].conversionRate > 0, true);
    assert.ok(payload.conversionRuntime.evidenceContract.includes('consent_receipts_for_submissions'));

    const overview = await request(baseUrl, jar, '/leads/forms');
    const overviewHtml = await overview.text();
    assert.match(overviewHtml, /Open conversion runtime API/);
    assert.match(overviewHtml, /consent receipts/i);

    linkedHtml = await (await request(baseUrl, jar, '/leads/landing-pages')).text();
    assert.match(linkedHtml, /experiments: 1/i);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
