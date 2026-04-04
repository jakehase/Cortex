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

test('Wave 2 collaboration approval: request review, comment, approve, and expose governance state', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Approval Admin',
      email: 'approval@example.com',
      password: 'secret123',
      workspaceName: 'Approval Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Board review campaign' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];

    await postForm(baseUrl, jar, '/approvals/request', {
      targetType: 'campaign',
      targetId: campaignId,
      title: 'Board review campaign approval',
      note: 'Needs legal and brand review',
      approversRequired: '2'
    });
    const requestId = server.state.db.approvalRequests[0].id;
    await postForm(baseUrl, jar, `/approvals/${requestId}/comment`, { comment: 'Please tighten the CTA copy.' });
    await postForm(baseUrl, jar, `/approvals/${requestId}/approve`, {});

    const approvalsPage = await request(baseUrl, jar, '/approvals');
    const approvalsHtml = await approvalsPage.text();
    assert.match(approvalsHtml, /Board review campaign approval/);
    assert.match(approvalsHtml, /approved/);
    assert.match(approvalsHtml, /tighten the CTA copy/);

    const apiKey = (await (await request(baseUrl, jar, '/workspaces')).text()).match(/key_[a-f0-9]+/)[0];
    const approvalsApi = await request(baseUrl, null, '/api/approvals', {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    const payload = await approvalsApi.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.approvals.approved, 1);
    assert.equal(server.state.db.campaigns[0].approvalStatus, 'approved');
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
