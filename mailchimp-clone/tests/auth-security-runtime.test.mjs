import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { buildAuthSecurityRuntimeSnapshot } from '../packages/app/security.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('auth security runtime issues CSRF tokens, verifies MFA, starts SSO, rotates API keys, and exposes session risk evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Security Runtime Admin',
      email: 'security-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Security Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const session = server.state.db.sessions[0];
    assert.equal(session.assurance, 'password_authenticated');
    assert.equal(session.risk.level, 'normal');
    assert.ok(server.state.db.securityEvents.some((event) => event.eventType === 'session_created'));

    const securityPage = await request(baseUrl, jar, '/security');
    const securityHtml = await securityPage.text();
    assert.match(securityHtml, /Security runtime contract/);
    assert.match(securityHtml, /session_inventory_and_risk_ledger/);
    assert.match(securityHtml, /csrf_token_issue_and_validation/);

    const csrfIssue = await postForm(baseUrl, jar, '/security/csrf/issue', { action: 'security_center' });
    const csrfHtml = await csrfIssue.text();
    const csrfToken = csrfHtml.match(/data-csrf-token>(csrf_[a-f0-9]+)</)?.[1];
    assert.ok(csrfToken);
    assert.equal(server.state.db.csrfTokens[0].status, 'issued');

    const csrfValidation = await postForm(baseUrl, jar, '/security/csrf/validate', { token: csrfToken, action: 'security_center' });
    assert.equal(csrfValidation.status, 200);
    assert.equal(server.state.db.csrfTokens[0].status, 'consumed');
    assert.ok(server.state.db.securityEvents.some((event) => event.eventType === 'csrf_token_validated'));

    const enroll = await postForm(baseUrl, jar, '/security/mfa/enroll', { method: 'totp', label: 'Primary authenticator' });
    assert.equal(enroll.status, 200);
    assert.equal(server.state.db.mfaFactors[0].status, 'active');
    assert.equal(server.state.db.users[0].mfaEnabled, true);

    const challengeResponse = await postForm(baseUrl, jar, '/security/mfa/challenge', {});
    const challengeHtml = await challengeResponse.text();
    const challengeId = challengeHtml.match(/data-mfa-challenge>(mfa_[a-f0-9]+)</)?.[1];
    assert.ok(challengeId);
    const verify = await postForm(baseUrl, jar, `/security/mfa/challenges/${challengeId}/verify`, { code: '123456' });
    assert.equal(verify.status, 200);
    assert.equal(server.state.db.mfaChallenges.find((entry) => entry.id === challengeId).status, 'verified');

    const sso = await postForm(baseUrl, jar, '/security/sso/start', { provider: 'saml', identityProvider: 'Okta workforce identity' });
    assert.equal(sso.status, 200);
    assert.equal(server.state.db.ssoSessions[0].status, 'active');
    assert.equal(server.state.db.ssoSessions[0].assertionAudience, server.state.db.workspaces[0].id);

    const oldKey = server.state.db.workspaces[0].apiKey;
    const rotate = await postForm(baseUrl, jar, '/security/api-keys/rotate', { label: 'Security center rotated key' });
    assert.equal(rotate.status, 200);
    assert.notEqual(server.state.db.workspaces[0].apiKey, oldKey);
    assert.equal(server.state.db.apiKeyRotations.length, 1);
    assert.ok(server.state.db.securityEvents.some((event) => event.eventType === 'api_key_rotated'));

    const api = await request(baseUrl, jar, '/api/security/runtime');
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.security.surfaceId, 'auth_session_security_runtime_layer');
    assert.equal(payload.security.sessions.activeCount, 1);
    assert.equal(payload.security.mfa.activeFactorCount, 1);
    assert.equal(payload.security.sso.activeCount, 1);
    assert.ok(payload.security.evidenceContract.includes('security_event_timeline'));

    const actor = {
      user: server.state.db.users[0],
      workspace: server.state.db.workspaces[0],
      membership: server.state.db.memberships[0],
      memberships: server.state.db.memberships
    };
    const snapshot = buildAuthSecurityRuntimeSnapshot(server.state, actor);
    assert.equal(snapshot.controls.includes('api_key_rotation_security_event'), true);
    assert.equal(snapshot.csrf.consumedCount, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
