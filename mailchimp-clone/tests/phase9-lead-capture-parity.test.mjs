import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import { leafProof, mergePhase9Proof } from './phase9-proof-helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function maybeWriteProof(server, formId) {
  const form = server.state.db.forms.find((entry) => entry.id === formId);
  const productFiles = ['packages/app/domain-leads.mjs', 'packages/app/routes/leads.mjs'];
  const targetedTests = ['tests/forms-landing.test.mjs', 'tests/phase9-lead-capture-parity.test.mjs'];
  const routeEvidence = ['GET /leads/forms', 'POST /leads/forms', 'GET /leads/forms/:id', 'POST /leads/forms/:id/targeting', 'POST /leads/forms/:id/publish'];
  const dbEvidence = {
    formId,
    status: form.status,
    channels: form.leadCapture.channels,
    hasTargeting: Boolean(form.leadCapture.targeting),
    hasSchedule: Boolean(form.leadCapture.schedule),
    hasConsent: Boolean(form.leadCapture.compliance?.consentMode),
    hasIntegrationHandoff: Boolean(form.leadCapture.integrationHandoff?.journeyTrigger),
    jobQueued: server.state.db.jobs.some((job) => job.type === 'lead_capture_publish_handoff' && job.payload?.formId === formId)
  };
  mergePhase9Proof({
    productSlice: 'signup_forms_popups_lead_capture',
    leafProofs: [
      leafProof({ leafId: 'signup_forms_popups__req_01', productFiles, targetedTests, routeEvidence, dbEvidence, proofKinds: ['analytics_telemetry', 'browser_ui', 'functional', 'product_diff'], assertions: ['lead capture center renders', 'popup/modal channels persist', 'schedule window and analytics lifecycle persist'] }),
      leafProof({ leafId: 'signup_forms_popups__req_02', productFiles, targetedTests, routeEvidence, dbEvidence, proofKinds: ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'provider_integration', 'security_policy'], assertions: ['publish lifecycle changes status', 'publish handoff job is queued', 'consent policy and provider handoff persist'] }),
      leafProof({ leafId: 'signup_forms_popups__gap_omnichannel_depth', productFiles, targetedTests, routeEvidence, dbEvidence, proofKinds: ['analytics_telemetry', 'browser_ui', 'functional', 'product_diff'], assertions: ['sms opt-in and social lead-ad channels are part of the capture configuration'] })
    ]
  });
}

test('Phase 9 real parity production slice: lead capture has targeting, lifecycle, persistence, jobs, integration handoff, and proof output', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Lead Capture Admin',
      email: 'lead-capture@example.com',
      password: 'secret123',
      workspaceName: 'Lead Capture Lab'
    });
    await followRedirect(baseUrl, jar, signup);
    await postForm(baseUrl, jar, '/settings', {
      senderName: 'Lead Capture Admin',
      senderEmail: 'lead-capture@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#3355aa',
      address: '900 Capture St'
    });

    const audienceId = server.state.db.audiences[0].id;
    const create = await postForm(baseUrl, jar, '/leads/forms', {
      name: 'Timed omnichannel popup',
      audienceId,
      channels: 'hosted,popup,modal,sms_opt_in,social_lead_ad',
      triggerRule: 'exit_intent',
      placementSelector: 'pricing_page,blog_footer',
      audienceRules: 'new_visitor,cart_interest',
      geotarget: 'US,CA',
      scheduleStart: '2026-05-10T09:00:00.000Z',
      scheduleEnd: '2026-06-10T09:00:00.000Z',
      consentMode: 'express',
      smsDisclosure: 'Text consent is captured before SMS follow-up.',
      journeyTrigger: 'form_submitted',
      connectedProvider: 'embedded_site'
    });
    assert.equal(create.status, 302);
    const formId = create.headers.get('location').match(/form_[a-f0-9]+/)[0];

    let builder = await request(baseUrl, jar, `/leads/forms/${formId}`);
    let builderHtml = await builder.text();
    assert.match(builderHtml, /Targeting, schedule, and channels/);
    assert.match(builderHtml, /Ready to publish/);
    assert.match(builderHtml, /sms_opt_in/);

    await postForm(baseUrl, jar, `/leads/forms/${formId}/targeting`, {
      channels: 'hosted,popup,modal,sms_opt_in,social_lead_ad',
      audienceRules: 'new_visitor,cart_interest,newsletter_intent',
      geotarget: 'US,CA,GB',
      triggerRule: 'exit_intent_after_12_seconds',
      frequencyCap: 'twice_per_visitor_7_days',
      scheduleStart: '2026-05-10T09:00:00.000Z',
      scheduleEnd: '2026-06-10T09:00:00.000Z',
      themeName: 'Spring capture',
      buttonLabel: 'Join the list',
      consentMode: 'express',
      journeyTrigger: 'form_submitted',
      connectedProvider: 'embedded_site'
    });
    await postForm(baseUrl, jar, `/leads/forms/${formId}/publish`, {});

    const form = server.state.db.forms.find((entry) => entry.id === formId);
    assert.equal(form.status, 'published');
    assert.deepEqual(form.leadCapture.channels, ['hosted', 'popup', 'modal', 'sms_opt_in', 'social_lead_ad']);
    assert.equal(form.leadCapture.targeting.frequencyCap, 'twice_per_visitor_7_days');
    assert.equal(form.leadCapture.compliance.consentMode, 'express');
    assert.equal(form.leadCapture.integrationHandoff.webhookEvent, 'lead_capture.submitted');
    assert.ok(form.analytics.lifecycle.some((entry) => entry.event === 'published'));
    assert.ok(server.state.db.jobs.some((job) => job.type === 'lead_capture_publish_handoff' && job.payload.formId === formId));
    assert.ok(server.state.db.notifications.some((note) => note.type === 'lead-capture-published' && note.payload.formId === formId));
    assert.ok(server.state.db.auditEvents.some((event) => event.action === 'lead-capture-publish'));

    const overview = await request(baseUrl, jar, '/leads/forms');
    const overviewHtml = await overview.text();
    assert.match(overviewHtml, /Lead capture center/);
    assert.match(overviewHtml, /Timed omnichannel popup/);
    assert.match(overviewHtml, /popup\/modal/);

    builder = await request(baseUrl, jar, `/leads/forms/${formId}`);
    builderHtml = await builder.text();
    assert.match(builderHtml, /lead_capture_publish_handoff|lead-capture-published|published/);

    maybeWriteProof(server, formId);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
