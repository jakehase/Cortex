import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createTempDataDir(prefix = 'mailclone-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export class CookieJar {
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

export async function request(baseUrl, jar, pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (jar?.header()) headers.set('cookie', jar.header());
  const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual', ...options, headers });
  jar?.capture(response);
  return response;
}

export async function postForm(baseUrl, jar, pathname, form) {
  const body = new URLSearchParams(form);
  return request(baseUrl, jar, pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
}

export async function followRedirect(baseUrl, jar, response) {
  const location = response.headers.get('location');
  if (!location) throw new Error('Missing redirect location');
  return request(baseUrl, jar, location);
}

export async function loginAsSeededOwner(baseUrl) {
  const jar = new CookieJar();
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const signup = await postForm(baseUrl, jar, '/signup', {
    name: 'Campaign Admin',
    email: `campaign-owner-${unique}@example.com`,
    password: 'secret123',
    workspaceName: 'Campaign Lab'
  });
  await followRedirect(baseUrl, jar, signup);

  const createCampaign = await postForm(baseUrl, jar, '/campaigns', { name: 'Editor Sandbox' });
  const campaignId = createCampaign.headers.get('location')?.match(/camp_[a-f0-9]+/)?.[0];
  if (!campaignId) throw new Error('Missing campaign id after campaign creation');

  await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, {
    name: 'Editor Sandbox',
    subject: 'Sandbox subject',
    preheader: 'Sandbox preheader',
    fromName: 'Campaign Admin',
    replyTo: 'reply@example.com'
  });

  const recipientsPage = await request(baseUrl, jar, `/campaigns/${campaignId}/recipients`);
  const recipientsHtml = await recipientsPage.text();
  const audienceId = recipientsHtml.match(/name="audienceId">(?:.|\n)*?<option value="([^"]+)"/)?.[1];
  if (!audienceId) throw new Error('Missing audience id on recipients page');

  await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/template`, { templateId: 'tmpl-announce' });

  return { jar, campaignId };
}

export async function waitFor(assertFn, { timeoutMs = 2500, intervalMs = 100 } = {}) {
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
