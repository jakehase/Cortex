import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('Program 5 forms and landing pages: builder, hosted signup/embed flow, publish states, validation, audience and campaign linkage', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Growth Admin',
      email: 'growth@example.com',
      password: 'secret123',
      workspaceName: 'Growth Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const audienceId = server.state.db.audiences[0].id;
    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Signup Followup' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];

    const formCreate = await postForm(baseUrl, jar, '/forms', {
      name: 'Newsletter Signup',
      audienceId,
      tagsOnSubmit: 'newsletter,new'
    });
    const formId = formCreate.headers.get('location').match(/form_[a-f0-9]+/)[0];

    let formPage = await request(baseUrl, jar, `/forms/${formId}`);
    const draftHtml = await formPage.text();
    assert.match(draftHtml, /Hosted URL/);
    assert.match(draftHtml, /Embed code/);

    await postForm(baseUrl, jar, `/forms/${formId}/fields`, {
      name: 'firstName',
      label: 'First name',
      required: 'false'
    });
    await postForm(baseUrl, jar, `/forms/${formId}/publish`, {});
    const form = server.state.db.forms.find((entry) => entry.id === formId);
    assert.equal(form.status, 'published');

    const hosted = await request(baseUrl, null, `/f/${form.slug}`);
    const hostedHtml = await hosted.text();
    assert.match(hostedHtml, /First name/);
    assert.match(hostedHtml, /Subscribe/);

    const hostedSubmit = await request(baseUrl, null, `/f/${form.slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'lead@example.com', firstName: 'Lead' })
    });
    assert.match(await hostedSubmit.text(), /Thanks for signing up/);
    const createdLead = server.state.db.contacts.find((entry) => entry.email === 'lead@example.com');
    assert.ok(createdLead);
    assert.match(createdLead.tags.join(','), /newsletter/);

    const pageCreate = await postForm(baseUrl, jar, '/landing-pages', {
      name: 'Waitlist Landing',
      formId,
      campaignId
    });
    const pageId = pageCreate.headers.get('location').match(/lp_[a-f0-9]+/)[0];

    let landingBuilder = await request(baseUrl, jar, `/landing-pages/${pageId}`);
    assert.match(await landingBuilder.text(), /Landing page headline is required/);

    await postForm(baseUrl, jar, `/landing-pages/${pageId}`, {
      name: 'Waitlist Landing',
      slug: 'waitlist-landing',
      headline: 'Join the waitlist',
      body: 'Early access for the upcoming release.'
    });
    await postForm(baseUrl, jar, `/landing-pages/${pageId}/publish`, {});
    const landingPage = server.state.db.landingPages.find((entry) => entry.id === pageId);
    assert.equal(landingPage.status, 'published');

    const publicPage = await request(baseUrl, null, '/lp/waitlist-landing');
    const publicHtml = await publicPage.text();
    assert.match(publicHtml, /Join the waitlist/);
    assert.match(publicHtml, /Open signup form/);
    assert.match(publicHtml, /Signup Followup/);
    assert.ok(server.state.db.landingPages.find((entry) => entry.id === pageId).views >= 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
