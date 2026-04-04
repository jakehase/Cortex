import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  capture(response) {
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return;
    const [pair] = setCookie.split(';');
    const [key, value] = pair.split('=');
    this.cookies.set(key, value);
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }
}

async function request(baseUrl, jar, pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (jar?.header()) headers.set('cookie', jar.header());
  const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual', ...options, headers });
  jar?.capture(response);
  return response;
}

async function postForm(baseUrl, jar, pathname, form) {
  const body = new URLSearchParams(form);
  return request(baseUrl, jar, pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
}

async function waitFor(assertFn, { timeoutMs = 4000, intervalMs = 120 } = {}) {
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

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'mailchimp_clone', 'programs_1_3');
const VALIDATION_DIR = path.join(ARTIFACT_ROOT, 'validation');
fs.mkdirSync(VALIDATION_DIR, { recursive: true });

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailclone-smoke-'));
process.env.MAILCLONE_DATA_DIR = tempDir;

const server = createServer();
const address = await server.start({ port: 0 });
const baseUrl = `http://127.0.0.1:${address.port}`;
const jar = new CookieJar();

const checklist = [];
function check(id, ok, detail) {
  checklist.push({ id, ok, detail });
  if (!ok) throw new Error(`${id}: ${detail}`);
}

try {
  const signup = await postForm(baseUrl, jar, '/signup', {
    name: 'Smoke Owner',
    email: 'smoke@example.com',
    password: 'secret123',
    workspaceName: 'Smoke Workspace'
  });
  check('platform.signup', signup.status === 302, `expected signup redirect, got ${signup.status}`);
  const app = await request(baseUrl, jar, '/app');
  check('platform.dashboard', (await app.text()).includes('Dashboard'), 'dashboard route missing expected content');

  const resetResponse = await postForm(baseUrl, new CookieJar(), '/reset', { email: 'smoke@example.com' });
  const resetHtml = await resetResponse.text();
  const resetToken = resetHtml.match(/reset_[a-f0-9]+/)?.[0];
  check('platform.reset-request', Boolean(resetToken), 'reset request did not return a token');
  const resetComplete = await postForm(baseUrl, new CookieJar(), `/reset/${resetToken}`, { password: 'secret789', confirmPassword: 'secret789' });
  check('platform.reset-complete', resetComplete.status === 302, `expected reset completion redirect, got ${resetComplete.status}`);
  await postForm(baseUrl, jar, '/logout', {});
  const loginAfterReset = await postForm(baseUrl, jar, '/login', { email: 'smoke@example.com', password: 'secret789' });
  check('platform.reset-login', loginAfterReset.status === 302, `expected post-reset login redirect, got ${loginAfterReset.status}`);
  await request(baseUrl, jar, '/app');

  await postForm(baseUrl, jar, '/workspaces/new', { name: 'Second Workspace' });
  const workspacesPage = await request(baseUrl, jar, '/workspaces');
  const workspacesHtml = await workspacesPage.text();
  check('platform.workspace-management', /Second Workspace/.test(workspacesHtml), 'second workspace missing from memberships');
  await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
  await postForm(baseUrl, jar, '/settings', {
    senderName: 'Smoke Owner',
    senderEmail: 'sender@example.com',
    replyTo: 'reply@example.com',
    timezone: 'America/Chicago',
    brandColor: '#3366ff',
    address: '123 Main'
  });
  await postForm(baseUrl, jar, '/settings/domains', { domain: 'example.com' });
  const activeWorkspace = server.state.db.workspaces.find((entry) => entry.id === server.state.db.users[0].activeWorkspaceId);
  const domainId = activeWorkspace.settings.domains[0].id;
  await postForm(baseUrl, jar, `/settings/domains/${domainId}/verify`, {});
  await postForm(baseUrl, jar, `/settings/domains/${domainId}/authenticate`, {});
  await postForm(baseUrl, jar, `/settings/domains/${domainId}/default`, {});
  const settingsPage = await request(baseUrl, jar, '/settings');
  check('platform.settings-domains', /authenticated/i.test(await settingsPage.text()), 'domain verification/authentication state missing');
  await postForm(baseUrl, jar, '/assets', { name: 'hero.txt', folder: 'Launch', contentType: 'text/plain', altText: 'Hero', body: 'hero' });
  const assetsPage = await request(baseUrl, jar, '/assets');
  check('platform.assets', /hero.txt/.test(await assetsPage.text()), 'asset manager missing stored asset');

  await postForm(baseUrl, jar, '/team/invitations', { email: 'teammate@example.com', role: 'admin' });
  const teamPage = await request(baseUrl, jar, '/team');
  const teamHtml = await teamPage.text();
  check('platform.invitations', /teammate@example.com/.test(teamHtml), 'invite not visible');
  const invitePath = teamHtml.match(/\/invites\/(invite_token_[a-f0-9]+)/)?.[0];
  check('platform.invite-path', Boolean(invitePath), 'invite acceptance path missing');
  const notificationsPage = await request(baseUrl, jar, '/notifications');
  check('platform.notifications', /invite/.test(await notificationsPage.text()), 'notification outbox missing invite evidence');
  const eventsPage = await request(baseUrl, jar, '/events');
  check('platform.events', /audit|invite/i.test(await eventsPage.text()), 'event stream missing audit/invite evidence');

  const defaultAudienceId = server.state.db.audiences.find((entry) => entry.workspaceId === server.state.db.users[0].activeWorkspaceId)?.id;
  await postForm(baseUrl, jar, `/audiences/${defaultAudienceId}/taxonomy`, { kind: 'tag', name: 'vip' });
  await postForm(baseUrl, jar, '/contacts', {
    audienceId: defaultAudienceId,
    firstName: 'Casey',
    lastName: 'Jones',
    email: 'casey@example.com',
    tags: 'vip',
    groupCategory: 'Region',
    groupValue: 'Central',
    interests: 'events'
  });
  const contactsPage = await request(baseUrl, jar, `/contacts?audienceId=${defaultAudienceId}&tag=vip`);
  check('audience.contacts-filter', /casey@example.com/.test(await contactsPage.text()), 'contacts filter did not show created contact');
  const preview = await postForm(baseUrl, jar, '/segments/preview', {
    audienceId: defaultAudienceId,
    logic: 'all',
    field1: 'tag',
    operator1: 'contains',
    value1: 'vip'
  });
  check('audience.segment-preview', /Preview count: 1/.test(await preview.text()), 'segment preview count incorrect');
  const importPreview = await postForm(baseUrl, jar, '/contacts/import/preview', {
    audienceId: defaultAudienceId,
    csvText: 'email,firstName,lastName,tags,groupCategory,groupValue,interests,status\npat@example.com,Pat,Lee,imported,Region,West,events,subscribed'
  });
  const importHtml = await importPreview.text();
  check('audience.import-preview', /valid rows ready to import/.test(importHtml), 'import preview missing valid row summary');
  const previewId = importHtml.match(/name="previewId" value="(import_[a-f0-9]+)"/)?.[1];
  check('audience.import-preview-id', Boolean(previewId), 'import preview id missing');
  await postForm(baseUrl, jar, '/contacts/import/commit', { previewId });
  await waitFor(async () => {
    const jobsPage = await request(baseUrl, jar, '/jobs');
    const jobsHtml = await jobsPage.text();
    if (!jobsHtml.includes('completed')) throw new Error('import job not completed yet');
    check('platform.jobs', /completed/.test(jobsHtml), 'jobs view missing completed state');
    return true;
  });

  const createCampaign = await postForm(baseUrl, jar, '/campaigns', { name: 'Smoke Campaign' });
  const campaignId = createCampaign.headers.get('location')?.match(/camp_[a-f0-9]+/)?.[0];
  check('campaign.create', Boolean(campaignId), 'campaign id missing after draft creation');
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, {
    name: 'Smoke Campaign',
    subject: 'Smoke subject',
    preheader: 'Smoke preheader',
    fromName: 'Smoke Owner',
    replyTo: 'reply@example.com'
  });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId: defaultAudienceId, segmentId: '' });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/template`, { templateId: 'tmpl-announce' });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/add-block`, { type: 'button' });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/0/update`, {
    title: 'Hero',
    body: 'Launch copy',
    buttonLabel: '',
    buttonUrl: '',
    assetId: ''
  });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/3/update`, {
    title: 'CTA',
    body: '',
    buttonLabel: 'Open',
    buttonUrl: 'https://example.test',
    assetId: ''
  });
  const review = await request(baseUrl, jar, `/campaigns/${campaignId}/review`);
  check('campaign.review', /No blockers/.test(await review.text()), 'campaign review still blocked after valid setup');
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/test-send`, { testEmail: 'qa@example.com' });
  await waitFor(async () => {
    const notesPage = await request(baseUrl, jar, '/notifications');
    if (!(await notesPage.text()).includes('qa@example.com')) throw new Error('test send notification missing');
    return true;
  });

  const runAt = new Date(Date.now() + 1500).toISOString().slice(0, 16);
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/schedule`, { runAt });
  await waitFor(async () => {
    const campaignsPage = await request(baseUrl, jar, '/campaigns');
    if (!(await campaignsPage.text()).match(/scheduled|sent/)) throw new Error('campaign never scheduled/sent');
    return true;
  }, { timeoutMs: 5000 });

  const status = await (await request(baseUrl, null, '/status')).json();
  check('platform.status', status.ok === true && status.counts.campaigns >= 1, 'status endpoint missing campaign count');

  const output = {
    ok: true,
    generatedAt: new Date().toISOString(),
    baseUrl,
    checklist,
    counts: status.counts
  };
  fs.writeFileSync(path.join(VALIDATION_DIR, 'live_smoke.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  const output = {
    ok: false,
    generatedAt: new Date().toISOString(),
    checklist,
    error: error.message
  };
  fs.writeFileSync(path.join(VALIDATION_DIR, 'live_smoke.json'), JSON.stringify(output, null, 2));
  console.error(JSON.stringify(output, null, 2));
  process.exitCode = 1;
} finally {
  await server.stop();
  delete process.env.MAILCLONE_DATA_DIR;
}
