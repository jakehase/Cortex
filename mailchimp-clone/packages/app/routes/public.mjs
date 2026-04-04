import { page } from '../view.mjs';
import { createAccount, actorFromUser, createNotification, findUserByEmail, getCurrentActor, recordAudit } from '../domain-core.mjs';
import { nowIso, readBody, redirect, json, text, hashPassword } from '../utils.mjs';
import { saveDb } from '../storage.mjs';

export function registerPublicRoutes(router) {
  router.register('GET', '/', async ({ res }) => {
    text(res, 200, page('Anchor Mailer', null, `<div class="grid"><div class="card"><h3>Program 1–3</h3><p>Platform spine, audience core, and campaign pipeline are implemented.</p></div><div class="card"><h3>Program 4</h3><p>Automation overview and journey builder with publish/pause/resume semantics.</p></div><div class="card"><h3>Program 5</h3><p>Forms, hosted signup flow, embed state, and landing pages.</p></div><div class="card"><h3>Program 6–7</h3><p>Reports, API/admin, exports/history/state, architecture hardening, and regression coverage.</p></div></div>`));
  });

  router.register('GET', '/status', async ({ state, res }) => {
    json(res, 200, { ok: true, counts: { users: state.db.users.length, memberships: state.db.memberships.length, workspaces: state.db.workspaces.length, audiences: state.db.audiences.length, contacts: state.db.contacts.length, segments: state.db.segments.length, campaigns: state.db.campaigns.length, jobsPending: state.db.jobs.filter((entry) => entry.status === 'pending').length, notifications: state.db.notifications.length, auditEvents: state.db.auditEvents.length, events: state.db.events.length, assets: state.db.assets.length, automations: state.db.automations.length, forms: state.db.forms.length, landingPages: state.db.landingPages.length } });
  });

  router.register('GET', '/signup', async ({ res }) => {
    text(res, 200, page('Signup', null, '<div class="card"><form method="post" action="/signup"><input name="name" placeholder="Full name" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><input name="workspaceName" placeholder="Workspace name" required><button>Create account</button></form></div>'));
  });

  router.register('POST', '/signup', async ({ state, req, res }) => {
    const body = await readBody(req);
    if (findUserByEmail(state, body.email)) return text(res, 422, page('Signup', null, '<div class="warn">That email already exists.</div>'));
    const { session } = createAccount(state, body);
    redirect(res, '/app', { 'Set-Cookie': `mailclone_session=${session.id}; Path=/; HttpOnly` });
  });

  router.register('GET', '/login', async ({ res }) => {
    text(res, 200, page('Login', null, '<div class="card"><form method="post" action="/login"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><button>Login</button></form></div>'));
  });

  router.register('POST', '/login', async ({ state, req, res }) => {
    const body = await readBody(req);
    const user = findUserByEmail(state, body.email);
    if (!user || user.passwordHash !== hashPassword(body.password)) return text(res, 401, page('Login', null, '<div class="warn">Invalid email or password.</div>'));
    const session = { id: `sess_${Math.random().toString(16).slice(2, 14)}`, userId: user.id, createdAt: nowIso() };
    state.db.sessions.push(session);
    saveDb(state.db);
    const actor = actorFromUser(state, user);
    if (actor) recordAudit(state, { workspaceId: actor.workspace.id, userId: user.id, action: 'login', detail: 'User logged in' });
    redirect(res, '/app', { 'Set-Cookie': `mailclone_session=${session.id}; Path=/; HttpOnly` });
  });

  router.register('POST', '/logout', async ({ state, req, res }) => {
    const actor = getCurrentActor(state, req);
    const sessionId = (req.headers.cookie || '').match(/mailclone_session=([^;]+)/)?.[1];
    state.db.sessions = state.db.sessions.filter((entry) => entry.id !== sessionId);
    saveDb(state.db);
    if (actor) recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'logout', detail: 'User logged out' });
    redirect(res, '/login', { 'Set-Cookie': 'mailclone_session=; Path=/; Max-Age=0' });
  });

  router.register('GET', '/reset', async ({ res }) => {
    text(res, 200, page('Password reset request', null, '<div class="card"><form method="post" action="/reset"><input name="email" type="email" placeholder="Account email" required><button>Generate reset request</button></form></div>'));
  });

  router.register('POST', '/reset', async ({ state, req, res }) => {
    const body = await readBody(req);
    const user = findUserByEmail(state, body.email);
    let token = 'not-found';
    if (user) {
      const actor = actorFromUser(state, user);
      token = `reset_${Math.random().toString(16).slice(2, 14)}`;
      state.db.passwordResets.unshift({ id: `pwreset_${Math.random().toString(16).slice(2, 14)}`, userId: user.id, token, createdAt: nowIso() });
      createNotification(state, { workspaceId: actor.workspace.id, type: 'password-reset-request', payload: { email: user.email, token } });
      saveDb(state.db);
      recordAudit(state, { workspaceId: actor.workspace.id, userId: user.id, action: 'password-reset-request', detail: 'Reset request created' });
    }
    text(res, 200, page('Password reset request', null, `<div class="card"><div class="ok">Reset request captured.</div><p>Generated token: <code>${token}</code></p><p>Reset path: <a href="/reset/${token}">/reset/${token}</a></p></div>`));
  });

  router.register('GET', '/reset/:token', async ({ state, params, res }) => {
    const reset = state.db.passwordResets.find((entry) => entry.token === params.token && !entry.usedAt);
    if (!reset) return text(res, 404, page('Password reset token', null, '<div class="warn">Reset token is missing or already used.</div>'));
    text(res, 200, page('Complete password reset', null, `<div class="card"><form method="post" action="/reset/${reset.token}"><input name="password" type="password" placeholder="New password" required><input name="confirmPassword" type="password" placeholder="Confirm password" required><button>Update password</button></form></div>`));
  });

  router.register('POST', '/reset/:token', async ({ state, req, params, res }) => {
    const reset = state.db.passwordResets.find((entry) => entry.token === params.token && !entry.usedAt);
    if (!reset) return text(res, 404, page('Password reset token', null, '<div class="warn">Reset token is missing or already used.</div>'));
    const body = await readBody(req);
    if (!body.password || body.password !== body.confirmPassword) return text(res, 422, page('Complete password reset', null, '<div class="warn">Passwords must be present and match.</div>'));
    const user = state.db.users.find((entry) => entry.id === reset.userId);
    user.passwordHash = hashPassword(body.password);
    reset.usedAt = nowIso();
    const actor = actorFromUser(state, user);
    createNotification(state, { workspaceId: actor.workspace.id, type: 'password-reset-complete', payload: { email: user.email } });
    recordAudit(state, { workspaceId: actor.workspace.id, userId: user.id, action: 'password-reset-complete', detail: 'Password reset completed' });
    redirect(res, '/login');
  });

  router.register('GET', '/invites/:token', async ({ state, params, res }) => {
    const invite = state.db.invitations.find((entry) => entry.token === params.token);
    if (!invite) return text(res, 404, page('Invite not found', null, '<div class="warn">Invite token not found.</div>'));
    if (invite.status !== 'pending') return text(res, 200, page('Invite already handled', null, `<div class="card">Invite status: ${invite.status}</div>`));
    text(res, 200, page('Accept invitation', null, `<div class="card"><p>Invite for <strong>${invite.email}</strong> as <strong>${invite.role}</strong>.</p><form method="post" action="/invites/${invite.token}/accept"><input name="name" placeholder="Full name" required><input name="password" type="password" placeholder="Create password" required><button>Accept invitation</button></form></div>`));
  });

  router.register('POST', '/invites/:token/accept', async ({ state, req, params, res }) => {
    const invite = state.db.invitations.find((entry) => entry.token === params.token && entry.status === 'pending');
    if (!invite) return text(res, 422, page('Invite acceptance', null, '<div class="warn">Invite is missing or no longer pending.</div>'));
    const body = await readBody(req);
    let user = findUserByEmail(state, invite.email);
    if (!user) {
      user = { id: `user_${Math.random().toString(16).slice(2, 14)}`, name: body.name, email: invite.email, passwordHash: hashPassword(body.password), activeWorkspaceId: invite.workspaceId, createdAt: nowIso() };
      state.db.users.push(user);
    }
    state.db.memberships.push({ id: `mship_${Math.random().toString(16).slice(2, 14)}`, userId: user.id, workspaceId: invite.workspaceId, role: invite.role, status: 'active', createdAt: nowIso() });
    invite.status = 'accepted';
    invite.acceptedAt = nowIso();
    const session = { id: `sess_${Math.random().toString(16).slice(2, 14)}`, userId: user.id, createdAt: nowIso() };
    state.db.sessions.push(session);
    saveDb(state.db);
    recordAudit(state, { workspaceId: invite.workspaceId, userId: user.id, action: 'invite-accepted', detail: `Accepted invite for ${invite.email}` });
    redirect(res, '/app', { 'Set-Cookie': `mailclone_session=${session.id}; Path=/; HttpOnly` });
  });
}
