import { saveDb, PLAN_CATALOG } from '../storage.mjs';
import { dashboardBody, page, requireActor, requireAdmin, workspaceSwitcher } from '../view.mjs';
import { addDomain, applyBillingPlan, createWorkspaceForUser, getCurrentActor, hasFeature, recordAudit, storeAsset, updateSettings } from '../domain-core.mjs';
import { nowIso, readBody, redirect, text } from '../utils.mjs';
import { createInvitationExpiry } from '../security.mjs';

export function registerPlatformRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/dashboard', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    redirect(res, '/app');
  });

  router.register('GET', '/app', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Dashboard', actor, `${dashboardBody(state, actor)}<div class="grid" style="margin-top:16px">${workspaceSwitcher(actor)}</div>`));
  });

  router.register('GET', '/workspaces', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const memberships = actor.memberships.map((membership) => ({ membership, workspace: state.db.workspaces.find((entry) => entry.id === membership.workspaceId) }));
    text(res, 200, page('Workspaces', actor, `<div class="grid"><div class="card"><h3>Workspace switcher</h3><form method="post" action="/workspaces/switch"><select name="workspaceId">${memberships.map(({ workspace }) => `<option value="${workspace.id}" ${workspace.id === actor.workspace.id ? 'selected' : ''}>${workspace.name}</option>`).join('')}</select><button>Switch workspace</button></form></div><div class="card"><h3>Rename current workspace</h3><form method="post" action="/workspaces"><input name="name" value="${actor.workspace.name}"><button>Rename workspace</button></form></div><div class="card"><h3>Create additional workspace</h3><form method="post" action="/workspaces/new"><input name="name" placeholder="New workspace name" required><button>Create workspace</button></form></div><div class="card"><h3>API auth</h3><p>Use <code>Authorization: Bearer ...</code></p><code>${actor.workspace.apiKey}</code></div></div><div class="card"><table><tr><th>Workspace</th><th>Role</th><th>Status</th></tr>${memberships.map(({ membership, workspace }) => `<tr><td>${workspace.name}</td><td>${membership.role}</td><td>${membership.status}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/workspaces', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    actor.workspace.name = body.name || actor.workspace.name;
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'workspace-update', detail: `Workspace renamed to ${actor.workspace.name}` });
    redirect(res, '/workspaces');
  });

  router.register('POST', '/workspaces/new', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    createWorkspaceForUser(state, actor, body.name);
    redirect(res, '/workspaces');
  });

  router.register('POST', '/workspaces/switch', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    if (!actor.memberships.some((membership) => membership.workspaceId === body.workspaceId)) return text(res, 403, page('Workspace switch denied', actor, '<div class="warn">That workspace is not assigned to this account.</div>'));
    actor.user.activeWorkspaceId = body.workspaceId;
    saveDb(state.db);
    redirect(res, '/app');
  });

  router.register('GET', '/team', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const members = state.db.memberships.filter((entry) => entry.workspaceId === actor.workspace.id && entry.status === 'active').map((membership) => ({ membership, user: state.db.users.find((entry) => entry.id === membership.userId) }));
    const invites = state.db.invitations.filter((invite) => invite.workspaceId === actor.workspace.id);
    const multiUserGate = hasFeature(actor.workspace, 'multiUser') ? '' : '<div class="warn">Starter plan shows roles and invites, but multi-user collaboration is upgrade-gated.</div>';
    text(res, 200, page('Team roles & invitations', actor, `${multiUserGate}<div class="grid"><div class="card"><h3>Members</h3><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Update</th></tr>${members.map(({ membership, user }) => `<tr><td>${user.name}</td><td>${user.email}</td><td>${membership.role}</td><td>${membership.role === 'owner' ? 'owner locked' : `<form method="post" action="/team/members/${membership.id}/role"><select name="role"><option value="admin" ${membership.role === 'admin' ? 'selected' : ''}>admin</option><option value="member" ${membership.role === 'member' ? 'selected' : ''}>member</option></select><button>Save</button></form>`}</td></tr>`).join('')}</table></div><div class="card"><h3>Invite teammate</h3><form method="post" action="/team/invitations"><input name="email" type="email" placeholder="teammate@example.com" required><select name="role"><option value="admin">admin</option><option value="member">member</option></select><button>Send invite</button></form></div></div><div class="card"><table><tr><th>Email</th><th>Role</th><th>Status</th><th>Accept link</th><th>Actions</th></tr>${invites.map((invite) => `<tr><td>${invite.email}</td><td>${invite.role}</td><td>${invite.status}</td><td><a href="/invites/${invite.token}">/invites/${invite.token}</a></td><td>${invite.status === 'pending' ? `<form method="post" action="/team/invitations/${invite.id}/resend"><button>Resend</button></form>` : '—'}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/team/invitations', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const body = await readBody(req);
    state.db.invitations.unshift({ id: deps.createId('invite'), workspaceId: actor.workspace.id, email: body.email, role: body.role || 'member', token: deps.createId('invite_token'), status: 'pending', invitedBy: actor.user.id, createdAt: nowIso(), expiresAt: createInvitationExpiry() });
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'invite-create', detail: `Invited ${body.email} as ${body.role}` });
    redirect(res, '/team');
  });

  router.register('POST', '/team/invitations/:id/resend', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const invite = state.db.invitations.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id && entry.status === 'pending');
    if (!invite) return text(res, 404, page('Team roles & invitations', actor, '<div class="warn">Pending invitation not found.</div>'));
    invite.token = deps.createId('invite_token');
    invite.updatedAt = nowIso();
    invite.expiresAt = createInvitationExpiry();
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'invite-resend', detail: `Resent invite for ${invite.email}` });
    redirect(res, '/team');
  });

  router.register('POST', '/team/members/:id/role', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const membership = state.db.memberships.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id && entry.status === 'active');
    if (!membership) return text(res, 404, page('Team roles & invitations', actor, '<div class="warn">Membership not found.</div>'));
    const body = await readBody(req);
    membership.role = body.role === 'admin' ? 'admin' : 'member';
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'member-role-update', detail: `Updated membership ${membership.id} to ${membership.role}` });
    redirect(res, '/team');
  });

  router.register('GET', '/billing', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Billing & plans', actor, `<div class="grid">${PLAN_CATALOG.map((plan) => `<div class="card"><h3>${plan.name}</h3><p>${plan.price} / month</p><p>${plan.monthlyLimit} sends included</p><ul><li>Scheduled send: ${plan.features.scheduledSend ? 'yes' : 'upgrade required'}</li><li>Advanced segments: ${plan.features.advancedSegments ? 'yes' : 'upgrade required'}</li><li>Audit export: ${plan.features.auditExport ? 'yes' : 'upgrade required'}</li></ul><form method="post" action="/billing/plan"><input type="hidden" name="planId" value="${plan.id}"><button>${plan.id === actor.workspace.planId ? 'Current plan' : 'Switch plan'}</button></form></div>`).join('')}</div><div class="card"><h3>Current plan semantics</h3><p>Visible gates: scheduled send, advanced segments, audit export.</p><table><tr><th>Invoice</th><th>Amount</th><th>Status</th></tr>${actor.workspace.billing.invoices.map((invoice) => `<tr><td>${invoice.id}</td><td>${invoice.amount}</td><td>${invoice.status}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/billing/plan', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const body = await readBody(req);
    applyBillingPlan(state, actor, body.planId);
    redirect(res, '/billing');
  });

  router.register('GET', '/feature-flags', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Feature flags', actor, `<div class="card"><table><tr><th>Flag</th><th>Enabled</th><th>Toggle</th></tr>${Object.entries(actor.workspace.featureFlags).map(([key, value]) => `<tr><td>${key}</td><td>${value ? 'on' : 'off'}</td><td><form method="post" action="/feature-flags/toggle"><input type="hidden" name="key" value="${key}"><button>${value ? 'Disable' : 'Enable'}</button></form></td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/feature-flags/toggle', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const body = await readBody(req);
    actor.workspace.featureFlags[body.key] = !actor.workspace.featureFlags[body.key];
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'feature-flag-toggle', detail: `${body.key} => ${actor.workspace.featureFlags[body.key]}` });
    redirect(res, '/feature-flags');
  });

  router.register('GET', '/settings', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const domains = actor.workspace.settings.domains || [];
    text(res, 200, page('Settings shell', actor, `<div class="grid"><div class="card"><form method="post" action="/settings"><input name="senderName" value="${actor.workspace.settings.senderName || ''}"><input name="senderEmail" type="email" value="${actor.workspace.settings.senderEmail || ''}"><input name="replyTo" type="email" value="${actor.workspace.settings.replyTo || ''}"><input name="timezone" value="${actor.workspace.settings.timezone || ''}"><input name="brandColor" value="${actor.workspace.settings.brandColor || ''}"><textarea name="address">${actor.workspace.settings.address || ''}</textarea><button>Save settings</button></form></div><div class="card"><h3>Visible compliance state</h3><p>Sender email: ${actor.workspace.settings.senderEmail || 'missing'}</p><p>Physical address: ${actor.workspace.settings.address || 'missing'}</p><p>Authenticated default domain: ${(domains.find((entry) => entry.isDefault)?.name) || 'missing'}</p></div><div class="card"><h3>Domains & authentication</h3><form method="post" action="/settings/domains"><input name="domain" placeholder="example.com" required><button>Add domain</button></form><table><tr><th>Domain</th><th>Verification</th><th>Authentication</th><th>Default</th><th>Actions</th></tr>${domains.map((domain) => `<tr><td>${domain.name}</td><td>${domain.verificationStatus}</td><td>${domain.authenticationStatus}</td><td>${domain.isDefault ? 'yes' : 'no'}</td><td><form method="post" action="/settings/domains/${domain.id}/verify"><button>Verify</button></form><form method="post" action="/settings/domains/${domain.id}/authenticate"><button>Authenticate</button></form><form method="post" action="/settings/domains/${domain.id}/default"><button>Make default</button></form></td></tr>`).join('') || '<tr><td colspan="5">No sending domains connected yet.</td></tr>'}</table></div></div>`));
  });

  router.register('POST', '/settings', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    updateSettings(state, actor, await readBody(req));
    redirect(res, '/settings');
  });

  router.register('POST', '/settings/domains', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    addDomain(state, actor, (await readBody(req)).domain);
    redirect(res, '/settings');
  });

  for (const [action, mutate] of [['verify', (d) => { d.verificationStatus = 'verified'; }], ['authenticate', (d) => { if (d.verificationStatus === 'verified') d.authenticationStatus = 'authenticated'; }], ['default', (d, domains) => { domains.forEach((entry) => { entry.isDefault = false; }); d.isDefault = true; }]]) {
    router.register('POST', `/settings/domains/:id/${action}`, async ({ state, req, params, res }) => {
      const actor = requireAuth(state, req, res);
      if (!actor) return;
      const domains = actor.workspace.settings.domains || [];
      const domain = domains.find((entry) => entry.id === params.id);
      if (!domain) return text(res, 404, page('Settings shell', actor, '<div class="warn">Domain not found.</div>'));
      mutate(domain, domains);
      saveDb(state.db);
      recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: `domain-${action}`, detail: `${action} ${domain.name}` });
      redirect(res, '/settings');
    });
  }

  router.register('GET', '/assets', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const assets = state.db.assets.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Content studio / asset manager', actor, `<div class="grid"><div class="card"><h3>Add asset</h3><form method="post" action="/assets"><input name="name" placeholder="hero.txt" required><input name="folder" value="Campaign assets"><input name="contentType" value="text/plain"><input name="altText" placeholder="Alt text"><textarea name="body"></textarea><button>Save asset</button></form></div><div class="card"><h3>Stored assets</h3><table><tr><th>Name</th><th>Folder</th><th>Type</th><th>Usage</th><th>Storage path</th></tr>${assets.map((asset) => `<tr><td>${asset.name}</td><td>${asset.folder}</td><td>${asset.contentType}</td><td>${asset.usageCount || 0}</td><td><code>${asset.storagePath}</code></td></tr>`).join('')}</table></div></div>`));
  });

  router.register('POST', '/assets', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    storeAsset(state, actor, await readBody(req));
    redirect(res, '/assets');
  });
}
