import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { runJobs } from '../packages/app/jobs.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('auth/security hardening: secure cookie attributes, security headers, outbox-based reset flow, and session revocation on password reset', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Secure Admin',
      email: 'secure@example.com',
      password: 'secret123',
      workspaceName: 'Security Lab'
    });
    assert.equal(signup.status, 302);
    const setCookie = signup.headers.get('set-cookie') || '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Max-Age=/i);

    const app = await followRedirect(baseUrl, jar, signup);
    assert.equal(app.headers.get('x-frame-options'), 'DENY');
    assert.equal(app.headers.get('x-content-type-options'), 'nosniff');
    assert.match(app.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);

    const resetRequest = await postForm(baseUrl, null, '/reset', { email: 'secure@example.com' });
    const resetHtml = await resetRequest.text();
    assert.doesNotMatch(resetHtml, /Generated token:/);
    assert.match(resetHtml, /reset link has been queued/i);

    const resetNotification = server.state.db.notifications[0];
    assert.equal(resetNotification.type, 'password-reset-request');
    assert.match(resetNotification.payload.resetPath, /^\/reset\/reset_[a-f0-9]+$/);
    assert.ok(resetNotification.payload.expiresAt);

    const resetForm = await request(baseUrl, null, resetNotification.payload.resetPath);
    assert.equal(resetForm.status, 200);
    await request(baseUrl, null, resetNotification.payload.resetPath, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'newsecret123', confirmPassword: 'newsecret123' })
    });

    const revokedSessionApp = await request(baseUrl, jar, '/app');
    assert.equal(revokedSessionApp.status, 302);
    assert.equal(revokedSessionApp.headers.get('location'), '/login');

    const oldPasswordLogin = await postForm(baseUrl, new CookieJar(), '/login', {
      email: 'secure@example.com',
      password: 'secret123'
    });
    assert.equal(oldPasswordLogin.status, 401);

    const freshJar = new CookieJar();
    const newPasswordLogin = await postForm(baseUrl, freshJar, '/login', {
      email: 'secure@example.com',
      password: 'newsecret123'
    });
    assert.equal(newPasswordLogin.status, 302);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});

test('login rate limiting throttles repeated invalid attempts with Retry-After', async () => {
  const { server, baseUrl } = await boot();
  try {
    await postForm(baseUrl, new CookieJar(), '/signup', {
      name: 'Throttle Admin',
      email: 'throttle@example.com',
      password: 'secret123',
      workspaceName: 'Throttle Lab'
    });

    let response = null;
    for (let index = 0; index < 9; index += 1) {
      response = await postForm(baseUrl, new CookieJar(), '/login', {
        email: 'throttle@example.com',
        password: 'wrong-password'
      });
    }
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) >= 1);
    assert.match(await response.text(), /Too many attempts/i);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});

test('job runtime hardening retries transient failures and dead-letters terminal failures', async () => {
  const { server, baseUrl } = await boot();
  try {
    const jar = new CookieJar();
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Jobs Admin',
      email: 'jobs@example.com',
      password: 'secret123',
      workspaceName: 'Jobs Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const workspaceId = server.state.db.workspaces[0].id;
    const userId = server.state.db.users[0].id;
    server.state.db.jobs.unshift({
      id: 'job_bad',
      type: 'unsupported_job',
      workspaceId,
      userId,
      payload: {},
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runAt: new Date().toISOString(),
      maxAttempts: 2,
      retryDelayMs: 1,
      attempts: 0,
      result: null
    });

    runJobs(server.state);
    const job = server.state.db.jobs.find((entry) => entry.id === 'job_bad');
    assert.equal(job.status, 'pending');
    assert.equal(job.attempts, 1);
    assert.match(job.error, /Unsupported job type/);
    assert.equal(server.state.db.jobDeadLetters.length, 0);

    job.runAt = new Date(Date.now() - 5).toISOString();
    runJobs(server.state);
    assert.equal(job.status, 'failed');
    assert.equal(job.attempts, 2);
    assert.equal(server.state.db.jobDeadLetters.length, 1);
    assert.equal(server.state.db.jobDeadLetters[0].jobId, 'job_bad');
    assert.match(server.state.db.jobDeadLetters[0].error, /Unsupported job type/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
