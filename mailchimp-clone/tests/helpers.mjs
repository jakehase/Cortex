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
