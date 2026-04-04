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

test('preferences center supports hosted centers and public preference updates', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Preference Admin',
      email: 'prefs@example.com',
      password: 'secret123',
      workspaceName: 'Preference Lab'
    }));

    await postForm(baseUrl, jar, '/preferences/centers', {
      title: 'Manage launch updates',
      slug: 'manage-launch',
      topics: 'launches, webinars, offers'
    });
    await postForm(baseUrl, jar, '/preferences/profiles', {
      contactName: 'Taylor',
      email: 'taylor@example.com',
      topics: 'launches, webinars',
      sms: 'on'
    });

    const profile = server.state.db.preferenceProfiles[0];
    const publicPage = await request(baseUrl, null, `/preferences/${profile.token}`);
    assert.match(await publicPage.text(), /Manage preferences/);

    await request(baseUrl, null, `/preferences/${profile.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'on', topics: 'launches' })
    });

    assert.equal(server.state.db.preferenceProfiles[0].subscriptions.sms, false);
    assert.deepEqual(server.state.db.preferenceProfiles[0].subscriptions.topics, ['launches']);

    const hosted = await request(baseUrl, null, '/p/manage-launch');
    assert.match(await hosted.text(), /Available topics: launches, webinars, offers/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
