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

test('conversation inbox supports creating, replying to, and closing a thread', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Inbox Admin',
      email: 'inbox@example.com',
      password: 'secret123',
      workspaceName: 'Inbox Lab'
    }));

    await postForm(baseUrl, jar, '/conversations', {
      contactName: 'Riley Buyer',
      contactEmail: 'riley@example.com',
      channel: 'chat',
      subject: 'Renewal question',
      priority: 'urgent',
      tags: 'vip,renewal',
      message: 'Need help with renewal timing.'
    });

    const conversation = server.state.db.conversations[0];
    assert.equal(conversation.subject, 'Renewal question');
    assert.equal(conversation.priority, 'urgent');

    await postForm(baseUrl, jar, `/conversations/${conversation.id}/reply`, {
      body: 'We can extend your renewal by 7 days.',
      status: 'waiting_on_customer'
    });
    await postForm(baseUrl, jar, `/conversations/${conversation.id}/status`, { status: 'closed' });

    const page = await request(baseUrl, jar, `/conversations/${conversation.id}`);
    const html = await page.text();
    assert.match(html, /Renewal question/);
    assert.match(html, /We can extend your renewal/);
    assert.match(html, /resolved|closed/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
