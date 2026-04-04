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

test('survey feedback tracks scores, averages, and qualitative comments', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Survey Admin',
      email: 'surveys@example.com',
      password: 'secret123',
      workspaceName: 'Survey Lab'
    }));

    await postForm(baseUrl, jar, '/surveys', {
      name: 'Post-purchase NPS',
      kind: 'nps',
      deliveryChannel: 'email',
      question: 'How likely are you to recommend us?'
    });

    const survey = server.state.db.surveyPrograms[0];
    await postForm(baseUrl, jar, `/surveys/${survey.id}/responses`, {
      email: 'fan@example.com',
      score: '10',
      comment: 'Great onboarding.'
    });
    await postForm(baseUrl, jar, `/surveys/${survey.id}/responses`, {
      email: 'critic@example.com',
      score: '4',
      comment: 'Setup took too long.'
    });

    const page = await request(baseUrl, jar, `/surveys/${survey.id}`);
    const html = await page.text();
    assert.match(html, /2 responses/);
    assert.match(html, /Great onboarding/);
    assert.match(html, /Setup took too long/);
    assert.equal(server.state.db.surveyResponses.length, 2);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
