import { escapeHtml } from './utils.mjs';
import { planFor } from './domain-core.mjs';
import { workspaceSummary } from './domain-growth.mjs';

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function nav(actor) {
  if (!actor) return '<nav aria-label="Primary"><a href="/">Home</a><a href="/pricing">Pricing</a><a href="/templates">Templates</a><a href="/features/email-marketing">Email</a><a href="/features/marketing-automation">Automations</a><a href="/features/website-builder">Websites</a><a href="/features/forms-and-landing-pages">Forms</a><a href="/resources">Resources</a><a href="/customers">Customers</a><a href="/help">Help</a><a href="/signup">Signup</a><a href="/login">Login</a><a href="/status">Status</a></nav>';
  return `<nav aria-label="Primary">
    <a href="/app">Dashboard</a><a href="/onboarding">Onboarding</a><a href="/workspaces">Workspaces</a><a href="/team">Team</a><a href="/billing">Billing</a><a href="/settings">Settings</a><a href="/security">Security</a><a href="/feature-flags">Flags</a><a href="/admin">Admin</a>
    <a href="/assets">Assets</a><a href="/content">Content studio</a><a href="/jobs">Jobs</a><a href="/events">Events</a><a href="/notifications">Notifications</a><a href="/audit">Audit</a>
    <a href="/audiences">Audiences</a><a href="/contacts">Contacts</a><a href="/segments">Segments</a><a href="/campaigns">Campaigns</a><a href="/websites">Websites</a><a href="/optimization">Optimization</a><a href="/omnichannel">Omnichannel</a>
    <a href="/automations">Automations</a><a href="/forms">Forms</a><a href="/leads/forms">Lead capture</a><a href="/landing-pages">Landing pages</a><a href="/reports">Reports</a><a href="/content/depth">Content depth</a><a href="/conversations">Inbox</a><a href="/preferences">Preferences</a><a href="/journeys/transactional">Transactional</a><a href="/surveys">Surveys</a><a href="/mobile-app">Mobile app</a><a href="/developer/api-keys">API keys</a><a href="/developer/webhooks">Webhooks</a>
    <a href="/integrations">Integrations</a><a href="/commerce">Commerce</a><a href="/approvals">Approvals</a><a href="/deliverability">Deliverability</a>
    <form method="post" action="/logout" style="display:inline"><button>Logout</button></form>
  </nav>`;
}

export function page(title, actor, body) {
  const identity = actor
    ? `${escapeHtml(actor.user.name)} · ${escapeHtml(actor.membership.role)} · ${escapeHtml(actor.workspace.name)} · ${escapeHtml(actor.workspace.planId)}`
    : 'Marketing platform for email, automations, forms, websites, and CRM journeys.';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <meta name="mailclone-page" content="${escapeHtml(title)}"><meta name="mailclone-authenticated" content="${actor ? 'true' : 'false'}">
  <style>body{font-family:Arial,sans-serif;margin:0;background:#f6f8fc;color:#18212f}header{background:#0b1020;color:white;padding:16px 24px}nav{display:flex;gap:8px;flex-wrap:wrap;padding:12px 24px;background:#e8eef9}nav a{text-decoration:none;color:#0b3b8c;font-weight:700}main{padding:24px;max-width:1200px;margin:0 auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}.card{background:white;border-radius:14px;padding:16px;box-shadow:0 1px 4px rgba(19,37,63,.12)}.hero{background:linear-gradient(135deg,#ffe07a 0%,#fff3c6 34%,#f1f6ff 100%);border-radius:24px;padding:28px;box-shadow:0 6px 24px rgba(19,37,63,.1);margin-bottom:24px}.hero h2{font-size:42px;line-height:1.05;margin:0 0 12px}.hero p{font-size:18px;max-width:760px;margin:0 0 16px}.hero-grid,.marketing-grid,.plan-grid,.faq-grid,.stat-strip{display:grid;gap:16px}.hero-grid,.marketing-grid,.plan-grid,.faq-grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.stat-strip{grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin:18px 0}.stat{background:rgba(255,255,255,.76);border-radius:16px;padding:14px}.eyebrow{display:inline-block;margin-bottom:10px;padding:6px 10px;border-radius:999px;background:#10254d;color:#fff;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.hero-actions,.cta-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}.button-link{display:inline-flex;align-items:center;justify-content:center;padding:12px 16px;border-radius:12px;background:#0b3b8c;color:#fff!important;text-decoration:none;font-weight:800}.button-link.secondary{background:#fff;color:#0b3b8c!important;border:1px solid #b8c7df}.section-title{font-size:28px;margin:30px 0 10px}.feature-list{margin:0;padding-left:18px;display:grid;gap:8px}.cta-band{margin-top:26px;background:#10254d;color:#fff;border-radius:20px;padding:24px}.cta-band a{color:#fff}.warn{background:#fff4e5;color:#8d5f00;padding:12px;border-radius:12px}.ok{background:#e9fff3;color:#106b39;padding:12px;border-radius:12px}input,textarea,select,button{padding:10px;border:1px solid #b8c7df;border-radius:10px;font:inherit}form{display:grid;gap:10px}table{width:100%;border-collapse:collapse;background:white}td,th{padding:10px;border-bottom:1px solid #dde5f1;text-align:left;vertical-align:top}code{background:#eef3fb;padding:2px 4px;border-radius:6px}.steps{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 16px}.step{padding:8px 12px;border-radius:999px;background:#eef3fb}.active{background:#dfeaff;color:#0b3b8c;font-weight:800}.pill{display:inline-block;padding:4px 10px;border-radius:999px;background:#eef4ff;color:#0b3b8c;font-size:12px;font-weight:700}.muted{color:#5d6b82}</style>
  <script id="mailclone-client-shell-config" type="application/json">{"mode":"interactive","builder":"progressive-client-runtime","manifest":"/static/app-shell-manifest.json","workspace":${scriptJson(actor ? { id: actor.workspace.id, name: actor.workspace.name, role: actor.membership.role } : null)}}</script><link rel="stylesheet" href="/static/app-shell.css"><script type="module" src="/static/app-shell-client.mjs"></script></head><body data-page-title="${escapeHtml(title)}" data-authenticated="${actor ? 'true' : 'false'}" data-client-shell="interactive"><header data-surface="page-header"><h1>${escapeHtml(title)}</h1><div>${identity}</div></header>${nav(actor)}<main id="app-shell" data-surface="page-main" data-client-surface="interactive-shell">${body}</main></body></html>`;
}

export function signupOnboardingChecklistItems(actor) {
  const workspace = actor?.workspace || { settings: {}, featureFlags: {}, billing: {} };
  const domains = workspace.settings?.domains || [];
  return [
    { label: 'Create workspace', done: Boolean(workspace.id) },
    { label: 'Set sender profile', done: Boolean(workspace.settings?.senderEmail && workspace.settings?.senderName) },
    { label: 'Connect authenticated domain', done: domains.some((entry) => entry.authenticationStatus === 'authenticated') },
    { label: 'Invite teammates', done: Boolean(workspace.featureFlags?.multiUser) },
    { label: 'Choose a send-ready plan', done: Boolean(workspace.planId && workspace.planId !== 'starter') }
  ];
}

export function signupOnboardingCard(actor, { compact = false } = {}) {
  const steps = signupOnboardingChecklistItems(actor);
  const completed = steps.filter((step) => step.done).length;
  const href = compact ? '/onboarding' : '/signup';
  const label = compact ? 'Open onboarding checklist' : 'Start guided signup';
  return `<div class="card"><h3>Signup onboarding</h3><p>${completed}/${steps.length} setup steps ready</p><div class="steps">${steps.map((step) => `<span class="step ${step.done ? 'active' : ''}">${escapeHtml(step.label)}</span>`).join('')}</div><p><a href="${href}">${label}</a></p></div>`;
}

export function signupOnboardingJourneyReadiness(actor) {
  const steps = signupOnboardingChecklistItems(actor);
  const missing = steps.filter((step) => !step.done).map((step) => step.label);
  return { completed: steps.length - missing.length, total: steps.length, ready: missing.length === 0, missing };
}

export function signupOnboardingRecoveryPanel(actor) {
  const readiness = signupOnboardingJourneyReadiness(actor);
  if (readiness.ready) return '<div class="ok">Workspace onboarding is send-ready.</div>';
  return `<div class="warn"><strong>Resume setup</strong><ul>${readiness.missing.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
}

export function requireActor(state, req, res, redirect, getCurrentActor) {
  const actor = getCurrentActor(state, req);
  if (!actor) {
    redirect(res, '/login');
    return null;
  }
  return actor;
}

export function requireAdmin(actor, res, text) {
  if (!['owner', 'admin'].includes(actor.membership.role)) {
    text(res, 403, page('Forbidden', actor, '<div class="warn">This route is limited to owner/admin roles.</div>'));
    return false;
  }
  return true;
}

export function dashboardBody(state, actor) {
  const summary = workspaceSummary(state, actor.workspace.id);
  const plan = planFor(actor.workspace);
  const readiness = signupOnboardingJourneyReadiness(actor);
  const role = actor.membership.role;
  const jobs = state.db.jobs.filter((entry) => entry.workspaceId === actor.workspace.id && !['completed', 'failed', 'cancelled'].includes(entry.status));
  const recentEvents = state.db.events.filter((entry) => entry.workspaceId === actor.workspace.id).slice(0, 4);
  const savedViews = [
    { label: 'Owner launch readiness', href: '/onboarding', roles: ['owner', 'admin'] },
    { label: 'Campaign operator queue', href: '/campaigns', roles: ['owner', 'admin', 'member'] },
    { label: 'Analyst performance view', href: '/reports', roles: ['owner', 'admin', 'member'] },
    { label: 'Developer integration health', href: '/developer/webhooks', roles: ['owner', 'admin'] }
  ].filter((view) => view.roles.includes(role));
  return `<div class="grid">
    <div class="card"><h3>Audience contacts</h3><div>${summary.contacts}</div><div>${summary.subscribed} subscribed · ${summary.unsubscribed} unsubscribed</div></div>
    <div class="card"><h3>Campaigns</h3><div>${summary.campaigns}</div><div>${summary.sentCampaigns} sent · ${summary.scheduledCampaigns} scheduled</div></div>
    <div class="card"><h3>Growth surfaces</h3><div>${summary.automations} automations · ${summary.forms} forms · ${summary.landingPages} pages</div></div>
    <div class="card"><h3>Plan</h3><div>${escapeHtml(plan.name)}</div><div>Visible gates and usage remain in-play.</div></div>
  </div>
  <div class="grid" style="margin-top:16px">${signupOnboardingCard(actor, { compact: true })}<div class="card"><h3>Dashboard widget system</h3><p>Setup readiness: ${readiness.completed}/${readiness.total}</p><p>Active task queue: ${jobs.length}</p><p>Data freshness: ${recentEvents[0]?.createdAt || 'fresh workspace'}</p><p>Insight prioritization: ${readiness.ready ? 'Launch campaign or automation' : `Resolve ${readiness.missing[0] || 'setup'} first`}</p></div><div class="card"><h3>Role-aware task queue</h3><p>${role === 'owner' ? 'Owner focus: billing, team, compliance, and launch readiness.' : role === 'admin' ? 'Admin focus: setup, imports, approvals, and sends.' : 'Member focus: content, campaigns, and reporting.'}</p><ul>${savedViews.map((view) => `<li><a href="${view.href}">${escapeHtml(view.label)}</a></li>`).join('')}</ul></div><div class="card"><h3>Saved dashboard views</h3><p>Personalized shortcuts keep onboarding, campaigns, reports, and integrations connected.</p><p>Recent events: ${recentEvents.length}</p></div></div>
  <div class="grid" style="margin-top:16px"><div class="card"><h3>Quick launch</h3><p><a href="/campaigns/new">Create campaign</a> · <a href="/automations/new">Build automation</a> · <a href="/forms/new">Create form</a> · <a href="/websites">Create website</a></p></div>
  <div class="card"><h3>Current-product depth</h3><p><a href="/optimization">Predictive optimization</a> · <a href="/omnichannel">SMS/social/ads</a> · <a href="/content/depth">Content lineage</a> · <a href="/integrations">Ecosystem realism</a> · <a href="/mobile-app">Mobile companion</a></p></div>
  <div class="card"><h3>Parity surfaces</h3><p>Programs 1–7 now include platform, audience, campaigns, automations, forms, landing pages, reports, API/admin, and hardening coverage.</p><p>The current-product expansion now adds websites, AI/generative assistance, experimentation, predictive targeting, omnichannel programs, deeper content workflows, and connector detail pages.</p></div></div>`;
}

export function workspaceSwitcher(actor) {
  return `<div class="card"><h3>Workspace switching</h3><form method="post" action="/workspaces/switch"><select name="workspaceId">${actor.memberships.map((membership) => `<option value="${membership.workspaceId}" ${membership.workspaceId === actor.workspace.id ? 'selected' : ''}>${escapeHtml(membership.workspaceId === actor.workspace.id ? actor.workspace.name : membership.workspaceId)}</option>`).join('')}</select><button>Switch workspace</button></form></div>`;
}

export function contactsTableRows(contacts) {
  return contacts.map((contact) => `<tr><td><input type="checkbox" name="contactId" value="${contact.id}"></td><td><a href="/contacts/${contact.id}">${escapeHtml(`${contact.firstName} ${contact.lastName}`.trim() || contact.email)}</a></td><td>${escapeHtml(contact.email)}</td><td>${escapeHtml(contact.status)}</td><td>${escapeHtml((contact.tags || []).join(', '))}</td><td>${escapeHtml(Object.entries(contact.groups || {}).map(([key, value]) => `${key}:${value}`).join(', '))}</td><td>${escapeHtml((contact.interests || []).join(', '))}</td></tr>`).join('');
}

export function blockEditorCard(block, index, campaign, assets) {
  return `<div class="card"><h3>Block ${index + 1}: ${escapeHtml(block.type)}</h3><form method="post" action="/campaigns/${campaign.id}/editor/block/${index}/update"><input name="title" value="${escapeHtml(block.title || '')}" placeholder="Block title"><textarea name="body">${escapeHtml(block.body || '')}</textarea><input name="buttonLabel" value="${escapeHtml(block.buttonLabel || '')}" placeholder="Button label"><input name="buttonUrl" value="${escapeHtml(block.buttonUrl || '')}" placeholder="Button URL"><select name="assetId"><option value="">No asset</option>${assets.map((asset) => `<option value="${asset.id}" ${asset.id === block.assetId ? 'selected' : ''}>${escapeHtml(asset.name)}</option>`).join('')}</select><input name="backgroundColor" value="${escapeHtml(block.backgroundColor || '')}" placeholder="#ffffff"><select name="textAlign"><option value="left">left</option><option value="center">center</option><option value="right">right</option></select><input name="padding" value="${escapeHtml(block.padding || '')}" placeholder="18px"><button>Save block</button></form><div style="display:flex;gap:8px;flex-wrap:wrap"><form method="post" action="/campaigns/${campaign.id}/editor/block/${index}/move"><input type="hidden" name="direction" value="up"><button ${index === 0 ? 'disabled' : ''}>Move up</button></form><form method="post" action="/campaigns/${campaign.id}/editor/block/${index}/move"><input type="hidden" name="direction" value="down"><button>Move down</button></form><form method="post" action="/campaigns/${campaign.id}/editor/block/${index}/duplicate"><button>Duplicate block</button></form><form method="post" action="/campaigns/${campaign.id}/editor/block/${index}/delete"><button>Delete block</button></form></div></div>`;
}
