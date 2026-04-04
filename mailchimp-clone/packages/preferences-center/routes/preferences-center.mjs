import {
  page,
  readBody,
  redirect,
  text,
  escapeHtml,
  saveDb,
  recordAudit
} from '../../app/index.mjs';
import {
  createPreferenceCenter,
  createPreferenceProfile,
  updatePreferenceProfile,
  preferenceSummary
} from '../domain-preferences-center.mjs';

export function registerPreferencesCenterRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/preferences', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    state.db.preferenceCenters ||= [];
    state.db.preferenceProfiles ||= [];
    const centers = state.db.preferenceCenters.filter((entry) => entry.workspaceId === actor.workspace.id);
    const profiles = state.db.preferenceProfiles.filter((entry) => entry.workspaceId === actor.workspace.id);
    const summary = preferenceSummary(state, actor.workspace.id);
    text(res, 200, page('Preferences center', actor, `<div class="grid"><div class="card"><h3>Summary</h3><p>${summary.profiles} profiles · ${summary.emailEnabled} email on · ${summary.smsEnabled} sms on · ${summary.adEnabled} ads on</p></div><div class="card"><h3>Create hosted center</h3><form method="post" action="/preferences/centers"><input name="title" placeholder="Manage your preferences" required><input name="slug" placeholder="manage-news"><input name="topics" placeholder="product updates, webinars, offers"><button>Create center</button></form></div><div class="card"><h3>Create profile link</h3><form method="post" action="/preferences/profiles"><input name="contactName" placeholder="Contact name"><input type="email" name="email" placeholder="person@example.com" required><input name="topics" placeholder="product updates, webinars"><label><input type="checkbox" name="sms" value="on"> SMS enabled</label><label><input type="checkbox" name="ads" value="on"> Ads enabled</label><button>Create profile</button></form></div></div><div class="card"><h3>Hosted centers</h3><table><tr><th>Title</th><th>Slug</th><th>Topics</th></tr>${centers.map((center) => `<tr><td>${escapeHtml(center.title)}</td><td><a href="/p/${center.slug}">/p/${escapeHtml(center.slug)}</a></td><td>${escapeHtml(center.topics.join(', '))}</td></tr>`).join('') || '<tr><td colspan="3">No centers yet.</td></tr>'}</table></div><div class="card"><h3>Profiles</h3><table><tr><th>Email</th><th>Token</th><th>Subscriptions</th></tr>${profiles.map((profile) => `<tr><td>${escapeHtml(profile.email)}</td><td><a href="/preferences/${profile.token}">${escapeHtml(profile.token)}</a></td><td>${profile.subscriptions.email ? 'email ' : ''}${profile.subscriptions.sms ? 'sms ' : ''}${profile.subscriptions.ads ? 'ads ' : ''}<div class="muted">${escapeHtml(profile.subscriptions.topics.join(', '))}</div></td></tr>`).join('') || '<tr><td colspan="3">No profiles yet.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/preferences/centers', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const center = createPreferenceCenter(state, actor, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'preferences-center-create', detail: `Created preferences center ${center.slug}` });
    redirect(res, '/preferences');
  });

  router.register('POST', '/preferences/profiles', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const profile = createPreferenceProfile(state, actor, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'preferences-profile-create', detail: `Created preferences profile for ${profile.email}` });
    redirect(res, '/preferences');
  });

  router.register('GET', '/p/:slug', async ({ state, res, params }) => {
    const center = (state.db.preferenceCenters || []).find((entry) => entry.slug === params.slug);
    if (!center) return text(res, 404, page('Preferences center', null, '<div class="warn">Hosted center not found.</div>'));
    text(res, 200, page(center.title, null, `<div class="card"><h3>${escapeHtml(center.title)}</h3><p>Available topics: ${escapeHtml(center.topics.join(', '))}</p><p>Use your unique profile link to manage channel subscriptions.</p></div>`));
  });

  router.register('GET', '/preferences/:token', async ({ state, res, params }) => {
    const profile = (state.db.preferenceProfiles || []).find((entry) => entry.token === params.token);
    if (!profile) return text(res, 404, page('Preferences center', null, '<div class="warn">Preference link not found.</div>'));
    text(res, 200, page('Manage preferences', null, `<div class="card"><h3>${escapeHtml(profile.email)}</h3><form method="post" action="/preferences/${profile.token}"><label><input type="checkbox" name="email" value="on" ${profile.subscriptions.email ? 'checked' : ''}> Email updates</label><label><input type="checkbox" name="sms" value="on" ${profile.subscriptions.sms ? 'checked' : ''}> SMS alerts</label><label><input type="checkbox" name="ads" value="on" ${profile.subscriptions.ads ? 'checked' : ''}> Ads retargeting</label><input name="topics" value="${escapeHtml(profile.subscriptions.topics.join(', '))}"><button>Save preferences</button></form></div>`));
  });

  router.register('POST', '/preferences/:token', async ({ state, req, res, params }) => {
    const profile = (state.db.preferenceProfiles || []).find((entry) => entry.token === params.token);
    if (!profile) return text(res, 404, page('Preferences center', null, '<div class="warn">Preference link not found.</div>'));
    updatePreferenceProfile(profile, await readBody(req));
    saveDb(state.db);
    redirect(res, `/preferences/${profile.token}`);
  });
}
