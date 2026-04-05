import { page } from '../view.mjs';
import { createAccount, actorFromUser, createNotification, findUserByEmail, getCurrentActor, recordAudit } from '../domain-core.mjs';
import { hashPassword, json, nowIso, readBody, redirect, text, verifyPassword, passwordHashNeedsUpgrade } from '../utils.mjs';
import { saveDb } from '../storage.mjs';
import {
  buildSessionCookie,
  consumeRateLimit,
  createPasswordReset,
  createSession,
  findPasswordReset,
  requestFingerprint,
  revokeSessionFromRequest,
  revokeUserSessions
} from '../security.mjs';

function passwordLengthOk(password) {
  return String(password || '').length >= 8;
}

function tooManyAttempts(res, title, retryAfterSeconds) {
  text(
    res,
    429,
    page(title, null, `<div class="warn">Too many attempts for this flow. Try again in about ${retryAfterSeconds} seconds.</div>`),
    { 'Retry-After': String(retryAfterSeconds) }
  );
}

function inviteExpired(invite) {
  return Boolean(invite?.expiresAt) && new Date(invite.expiresAt).getTime() <= Date.now();
}

export function registerPublicRoutes(router) {
  router.register('GET', '/', async ({ res }) => {
    text(res, 200, page('Anchor Mailer', null, `<div class="grid"><div class="card"><h3>Program 1–3</h3><p>Platform spine, audience core, and campaign pipeline are implemented.</p></div><div class="card"><h3>Program 4</h3><p>Automation overview and journey builder with publish/pause/resume semantics.</p></div><div class="card"><h3>Program 5</h3><p>Forms, hosted signup flow, embed state, and landing pages.</p></div><div class="card"><h3>Program 6–7</h3><p>Reports, API/admin, exports/history/state, architecture hardening, and regression coverage.</p></div></div>`));
  });

  router.register('GET', '/status', async ({ state, res }) => {
    json(res, 200, {
      ok: true,
      counts: {
        users: state.db.users.length,
        memberships: state.db.memberships.length,
        workspaces: state.db.workspaces.length,
        audiences: state.db.audiences.length,
        contacts: state.db.contacts.length,
        segments: state.db.segments.length,
        campaigns: state.db.campaigns.length,
        jobsPending: state.db.jobs.filter((entry) => entry.status === 'pending').length,
        notifications: state.db.notifications.length,
        auditEvents: state.db.auditEvents.length,
        events: state.db.events.length,
        assets: state.db.assets.length,
        automations: state.db.automations.length,
        forms: state.db.forms.length,
        landingPages: state.db.landingPages.length,
        rateLimitedEntries: (state.db.rateLimits || []).length,
        deadLetters: (state.db.jobDeadLetters || []).length
      }
    });
  });

  router.register('GET', '/signup', async ({ res }) => {
    text(res, 200, page('Signup', null, '<div class="card"><form method="post" action="/signup"><input name="name" placeholder="Full name" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><input name="workspaceName" placeholder="Workspace name" required><button>Create account</button></form><p class="muted">Sessions use HttpOnly, SameSite=Lax cookies with rolling expiry.</p></div>'));
  });

  router.register('POST', '/signup', async ({ state, req, res }) => {
    const body = await readBody(req);
    const rateLimit = consumeRateLimit(state, 'signup', { key: requestFingerprint(req, body.email), limit: 6, windowMs: 10 * 60 * 1000 });
    if (!rateLimit.ok) return tooManyAttempts(res, 'Signup', rateLimit.retryAfterSeconds);
    if (findUserByEmail(state, body.email)) return text(res, 422, page('Signup', null, '<div class="warn">That email already exists.</div>'));
    if (!passwordLengthOk(body.password)) return text(res, 422, page('Signup', null, '<div class="warn">Passwords must be at least 8 characters.</div>'));
    const { session } = createAccount(state, body, req);
    redirect(res, '/app', { 'Set-Cookie': buildSessionCookie(req, session.id) });
  });

  router.register('GET', '/login', async ({ res }) => {
    text(res, 200, page('Login', null, '<div class="card"><form method="post" action="/login"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><button>Login</button></form><p class="muted">Repeated login failures are temporarily throttled.</p></div>'));
  });

  router.register('POST', '/login', async ({ state, req, res }) => {
    const body = await readBody(req);
    const rateLimit = consumeRateLimit(state, 'login', { key: requestFingerprint(req, body.email), limit: 8, windowMs: 10 * 60 * 1000 });
    if (!rateLimit.ok) return tooManyAttempts(res, 'Login', rateLimit.retryAfterSeconds);
    const user = findUserByEmail(state, body.email);
    if (!user || !verifyPassword(body.password, user.passwordHash)) return text(res, 401, page('Login', null, '<div class="warn">Invalid email or password.</div>'));
    if (passwordHashNeedsUpgrade(user.passwordHash)) user.passwordHash = hashPassword(body.password);
    const session = createSession(state, user, req, { reason: 'login' });
    const actor = actorFromUser(state, user);
    if (actor) recordAudit(state, { workspaceId: actor.workspace.id, userId: user.id, action: 'login', detail: 'User logged in' });
    redirect(res, '/app', { 'Set-Cookie': buildSessionCookie(req, session.id) });
  });

  router.register('POST', '/logout', async ({ state, req, res }) => {
    const actor = getCurrentActor(state, req);
    revokeSessionFromRequest(state, req, 'logout');
    if (actor) recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'logout', detail: 'User logged out' });
    redirect(res, '/login', { 'Set-Cookie': buildSessionCookie(req, '', { clear: true }) });
  });

  router.register('GET', '/reset', async ({ res }) => {
    text(res, 200, page('Password reset request', null, '<div class="card"><form method="post" action="/reset"><input name="email" type="email" placeholder="Account email" required><button>Generate reset request</button></form><p class="muted">If the account exists, the reset link is queued to the notification outbox instead of being shown inline.</p></div>'));
  });

  router.register('POST', '/reset', async ({ state, req, res }) => {
    const body = await readBody(req);
    const rateLimit = consumeRateLimit(state, 'reset', { key: requestFingerprint(req, body.email), limit: 4, windowMs: 60 * 60 * 1000 });
    if (!rateLimit.ok) return tooManyAttempts(res, 'Password reset request', rateLimit.retryAfterSeconds);
    const user = findUserByEmail(state, body.email);
    if (user) {
      const actor = actorFromUser(state, user);
      const { reset, resetPath } = createPasswordReset(state, user, req);
      createNotification(state, {
        workspaceId: actor.workspace.id,
        type: 'password-reset-request',
        payload: { email: user.email, resetPath, expiresAt: reset.expiresAt, tokenPreview: reset.tokenPreview }
      });
      recordAudit(state, { workspaceId: actor.workspace.id, userId: user.id, action: 'password-reset-request', detail: 'Reset request created' });
    }
    text(res, 200, page('Password reset request', null, '<div class="card"><div class="ok">If that account exists, a reset link has been queued.</div><p>For this local clone, check the notification outbox or test fixtures instead of expecting the token inline.</p></div>'));
  });

  router.register('GET', '/reset/:token', async ({ state, params, res }) => {
    const reset = findPasswordReset(state, params.token);
    if (!reset) return text(res, 404, page('Password reset token', null, '<div class="warn">Reset token is missing, expired, or already used.</div>'));
    text(res, 200, page('Complete password reset', null, `<div class="card"><form method="post" action="/reset/${params.token}"><input name="password" type="password" placeholder="New password" required><input name="confirmPassword" type="password" placeholder="Confirm password" required><button>Update password</button></form></div>`));
  });

  router.register('POST', '/reset/:token', async ({ state, req, params, res }) => {
    const reset = findPasswordReset(state, params.token);
    if (!reset) return text(res, 404, page('Password reset token', null, '<div class="warn">Reset token is missing, expired, or already used.</div>'));
    const body = await readBody(req);
    if (!passwordLengthOk(body.password)) return text(res, 422, page('Complete password reset', null, '<div class="warn">Passwords must be at least 8 characters.</div>'));
    if (!body.password || body.password !== body.confirmPassword) return text(res, 422, page('Complete password reset', null, '<div class="warn">Passwords must be present and match.</div>'));
    const user = state.db.users.find((entry) => entry.id === reset.userId);
    user.passwordHash = hashPassword(body.password);
    reset.usedAt = nowIso();
    revokeUserSessions(state, user.id, { reason: 'password-reset' });
    const actor = actorFromUser(state, user);
    createNotification(state, { workspaceId: actor.workspace.id, type: 'password-reset-complete', payload: { email: user.email } });
    recordAudit(state, { workspaceId: actor.workspace.id, userId: user.id, action: 'password-reset-complete', detail: 'Password reset completed' });
    redirect(res, '/login');
  });

  router.register('GET', '/invites/:token', async ({ state, params, res }) => {
    const invite = state.db.invitations.find((entry) => entry.token === params.token);
    if (!invite) return text(res, 404, page('Invite not found', null, '<div class="warn">Invite token not found.</div>'));
    if (inviteExpired(invite)) {
      invite.status = 'expired';
      invite.expiredAt ||= nowIso();
      saveDb(state.db);
      return text(res, 410, page('Invite expired', null, '<div class="warn">Invite token expired. Ask the workspace owner to resend it.</div>'));
    }
    if (invite.status !== 'pending') return text(res, 200, page('Invite already handled', null, `<div class="card">Invite status: ${invite.status}</div>`));
    text(res, 200, page('Accept invitation', null, `<div class="card"><p>Invite for <strong>${invite.email}</strong> as <strong>${invite.role}</strong>.</p><form method="post" action="/invites/${invite.token}/accept"><input name="name" placeholder="Full name" required><input name="password" type="password" placeholder="Create password" required><button>Accept invitation</button></form></div>`));
  });

  router.register('POST', '/invites/:token/accept', async ({ state, req, params, res }) => {
    const rateLimit = consumeRateLimit(state, 'invite_accept', { key: requestFingerprint(req, params.token), limit: 8, windowMs: 60 * 60 * 1000 });
    if (!rateLimit.ok) return tooManyAttempts(res, 'Invite acceptance', rateLimit.retryAfterSeconds);
    const invite = state.db.invitations.find((entry) => entry.token === params.token && entry.status === 'pending');
    if (!invite) return text(res, 422, page('Invite acceptance', null, '<div class="warn">Invite is missing or no longer pending.</div>'));
    if (inviteExpired(invite)) {
      invite.status = 'expired';
      invite.expiredAt ||= nowIso();
      saveDb(state.db);
      return text(res, 410, page('Invite acceptance', null, '<div class="warn">Invite expired. Ask for a new invitation.</div>'));
    }
    const body = await readBody(req);
    if (!passwordLengthOk(body.password)) return text(res, 422, page('Invite acceptance', null, '<div class="warn">Passwords must be at least 8 characters.</div>'));
    let user = findUserByEmail(state, invite.email);
    if (!user) {
      user = { id: `user_${Math.random().toString(16).slice(2, 14)}`, name: body.name, email: invite.email, passwordHash: hashPassword(body.password), activeWorkspaceId: invite.workspaceId, createdAt: nowIso() };
      state.db.users.push(user);
    }
    user.activeWorkspaceId = invite.workspaceId;
    state.db.memberships.push({ id: `mship_${Math.random().toString(16).slice(2, 14)}`, userId: user.id, workspaceId: invite.workspaceId, role: invite.role, status: 'active', createdAt: nowIso() });
    invite.status = 'accepted';
    invite.acceptedAt = nowIso();
    const session = createSession(state, user, req, { reason: 'invite-accept' });
    recordAudit(state, { workspaceId: invite.workspaceId, userId: user.id, action: 'invite-accepted', detail: `Accepted invite for ${invite.email}` });
    redirect(res, '/app', { 'Set-Cookie': buildSessionCookie(req, session.id) });
  });
}
