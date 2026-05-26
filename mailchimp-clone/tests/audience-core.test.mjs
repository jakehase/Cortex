import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request, waitFor } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('Program 2 audience core: audience metrics, taxonomy management, contacts filtering/bulk update, segment preview, import preview/commit, API update', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Audience Admin',
      email: 'aud@example.com',
      password: 'secret123',
      workspaceName: 'Audience Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
    await postForm(baseUrl, jar, '/audiences', { name: 'VIP Audience', description: 'High-intent customers' });
    const audiencesPage = await request(baseUrl, jar, '/audiences');
    const audiencesHtml = await audiencesPage.text();
    assert.match(audiencesHtml, /VIP Audience/);
    assert.match(audiencesHtml, /High-intent customers/);
    const audienceId = audiencesHtml.match(/\/audiences\/(aud_[a-f0-9]+)/)[1];

    await postForm(baseUrl, jar, `/audiences/${audienceId}/taxonomy`, { kind: 'tag', name: 'vip' });
    await postForm(baseUrl, jar, `/audiences/${audienceId}/taxonomy`, { kind: 'interest', name: 'events' });
    await postForm(baseUrl, jar, `/audiences/${audienceId}/taxonomy`, { kind: 'group', groupName: 'Region', name: 'Central' });
    const taxonomyPage = await request(baseUrl, jar, `/audiences/${audienceId}/taxonomy`);
    const taxonomyHtml = await taxonomyPage.text();
    assert.match(taxonomyHtml, /vip/);
    assert.match(taxonomyHtml, /events/);
    assert.match(taxonomyHtml, /Region:/);
    assert.match(taxonomyHtml, /Central/);

    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Casey',
      lastName: 'Jones',
      email: 'casey@example.com',
      phone: '555-0001',
      tags: 'vip, beta',
      groupCategory: 'Region',
      groupValue: 'Central',
      interests: 'events, product'
    });
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Jordan',
      lastName: 'Lee',
      email: 'jordan@example.com',
      tags: 'new',
      groupCategory: 'Region',
      groupValue: 'East',
      interests: 'docs'
    });

    let contactsPage = await request(baseUrl, jar, `/contacts?audienceId=${audienceId}&q=casey&tag=vip&status=subscribed`);
    let contactsHtml = await contactsPage.text();
    assert.match(contactsHtml, /casey@example.com/);
    const contactIds = [...contactsHtml.matchAll(/value="(contact_[a-f0-9]+)"/g)].map((match) => match[1]);
    assert.ok(contactIds.length >= 1);

    await postForm(baseUrl, jar, '/contacts/bulk', {
      audienceId,
      action: 'addTag',
      value: 'retained',
      contactId: contactIds[0]
    });
    contactsPage = await request(baseUrl, jar, `/contacts?audienceId=${audienceId}&tag=retained`);
    assert.match(await contactsPage.text(), /casey@example.com/);

    const contactId = server.state.db.contacts.find((entry) => entry.email === 'casey@example.com').id;
    await postForm(baseUrl, jar, `/contacts/${contactId}`, {
      firstName: 'Casey',
      lastName: 'Jones',
      email: 'casey@example.com',
      phone: '555-1111',
      status: 'subscribed',
      tags: 'vip, retained',
      groupCategory: 'Region',
      groupValue: 'Central',
      interests: 'events, product',
      notes: 'Top customer'
    });
    const contactPage = await request(baseUrl, jar, `/contacts/${contactId}`);
    const contactHtml = await contactPage.text();
    assert.match(contactHtml, /Top customer/);
    assert.match(contactHtml, /Activity timeline/);

    const preview = await postForm(baseUrl, jar, '/segments/preview', {
      audienceId,
      logic: 'all',
      field1: 'tag',
      operator1: 'contains',
      value1: 'vip'
    });
    assert.match(await preview.text(), /Preview count: 1/);

    await postForm(baseUrl, jar, '/segments', {
      audienceId,
      name: 'VIP events',
      logic: 'all',
      field1: 'tag',
      operator1: 'contains',
      value1: 'vip',
      field2: 'interest',
      operator2: 'contains',
      value2: 'events'
    });
    const segmentsPage = await request(baseUrl, jar, `/segments?audienceId=${audienceId}`);
    const segmentsHtml = await segmentsPage.text();
    assert.match(segmentsHtml, /VIP events/);
    assert.match(segmentsHtml, /Preview count/);

    const previewImport = await postForm(baseUrl, jar, '/contacts/import/preview', {
      audienceId,
      csvText: 'email,firstName,lastName,tags,groupCategory,groupValue,interests,status\npat@example.com,Pat,Lee,imported,Region,West,events,subscribed\njamie@example.com,Jamie,Rae,imported,Region,South,events,subscribed'
    });
    const importHtml = await previewImport.text();
    assert.match(importHtml, /2 valid rows ready to import/);
    const previewId = importHtml.match(/name="previewId" value="(import_[a-f0-9]+)"/)[1];

    await postForm(baseUrl, jar, '/contacts/import/commit', { previewId });
    let audienceHtml = '';
    await waitFor(async () => {
      const jobsPage = await request(baseUrl, jar, '/jobs');
      assert.match(await jobsPage.text(), /completed/);
      const audienceOverview = await request(baseUrl, jar, `/audiences/${audienceId}`);
      audienceHtml = await audienceOverview.text();
      assert.match(audienceHtml, /4 contacts/);
      assert.match(audienceHtml, /Groups: .*Region:Central/);
      return true;
    });

    const workspacesPage = await request(baseUrl, jar, '/workspaces');
    const apiKey = (await workspacesPage.text()).match(/key_[a-f0-9]+/)[0];
    const apiCreate = await request(baseUrl, null, '/api/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ audienceId, email: 'api@example.com', firstName: 'Api', lastName: 'Contact', tags: 'api', interests: 'docs' })
    });
    const created = await apiCreate.json();
    assert.equal(created.ok, true);

    const apiPatch = await request(baseUrl, null, `/api/contacts/${created.contact.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ notes: 'Patched from API', tags: 'api,updated' })
    });
    const patched = await apiPatch.json();
    assert.equal(patched.ok, true);
    assert.match(patched.contact.notes, /Patched from API/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
