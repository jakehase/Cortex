import { createAudience, saveDb } from '../storage.mjs';
import { page, requireActor, contactsTableRows } from '../view.mjs';
import { getCurrentActor, hasFeature, recordAudit } from '../domain-core.mjs';
import { audienceTraits, bulkUpdateContacts, contactsForAudience, createContact, generateImportPreview, matchSegment, parseSegmentRules, queueImport, updateContact } from '../domain-audience.mjs';
import { createId, readBody, redirect, text } from '../utils.mjs';

export function registerAudienceRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/audience', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    redirect(res, '/audiences');
  });

  router.register('GET', '/audiences', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audiences = state.db.audiences.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Audience overview', actor, `${audiences.length ? `<div class="grid">${audiences.map((audience) => `<div class="card"><h3><a href="/audiences/${audience.id}">${audience.name}</a></h3><p>${audience.description || 'No description yet.'}</p><p>${contactsForAudience(state, audience.id).length} contacts</p></div>`).join('')}</div>` : '<div class="warn">No audiences yet.</div>'}<div class="card"><h3>Create audience</h3><form method="post" action="/audiences"><input name="name" placeholder="Audience name" required><textarea name="description"></textarea><button>Create audience</button></form></div>`));
  });

  router.register('POST', '/audiences', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req);
    const audience = createAudience(actor.workspace.id, body.name); audience.description = body.description || '';
    state.db.audiences.unshift(audience); saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'audience-create', detail: `Created audience ${audience.name}` });
    redirect(res, '/audiences');
  });

  router.register('GET', '/audiences/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audience = state.db.audiences.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!audience) return text(res, 404, page('Audience not found', actor, '<div class="warn">Audience not found.</div>'));
    const traits = audienceTraits(state, audience);
    text(res, 200, page(`Audience: ${audience.name}`, actor, `<div class="grid"><div class="card"><h3>Metrics</h3><p>${contactsForAudience(state, audience.id).length} contacts</p></div><div class="card"><h3>Classification</h3><p>Tags: ${traits.tags.join(', ') || 'none'}</p><p>Groups: ${traits.groups.join(', ') || 'none'}</p><p>Interests: ${traits.interests.join(', ') || 'none'}</p></div><div class="card"><h3>Open surfaces</h3><p><a href="/contacts?audienceId=${audience.id}">Contacts table</a></p><p><a href="/segments?audienceId=${audience.id}">Segments</a></p><p><a href="/audiences/${audience.id}/taxonomy">Tags / groups / interests</a></p></div></div>`));
  });

  router.register('GET', '/audiences/:id/taxonomy', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audience = state.db.audiences.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!audience) return text(res, 404, page('Audience taxonomy missing', actor, '<div class="warn">Audience not found.</div>'));
    text(res, 200, page(`Tags, groups, interests: ${audience.name}`, actor, `<div class="grid"><div class="card"><h3>Tags</h3><form method="post" action="/audiences/${audience.id}/taxonomy"><input type="hidden" name="kind" value="tag"><input name="name" placeholder="vip"><button>Add tag</button></form><p>${(audience.taxonomy.tags || []).join(', ') || 'none'}</p></div><div class="card"><h3>Interests</h3><form method="post" action="/audiences/${audience.id}/taxonomy"><input type="hidden" name="kind" value="interest"><input name="name" placeholder="events"><button>Add interest</button></form><p>${(audience.taxonomy.interests || []).join(', ') || 'none'}</p></div><div class="card"><h3>Groups</h3><form method="post" action="/audiences/${audience.id}/taxonomy"><input type="hidden" name="kind" value="group"><input name="groupName" placeholder="Region"><input name="name" placeholder="Central"><button>Add group option</button></form><p>${(audience.taxonomy.groupCategories || []).map((group) => `${group.name}: ${group.options.join('/')}`).join(' · ') || 'none'}</p></div></div>`));
  });

  router.register('POST', '/audiences/:id/taxonomy', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audience = state.db.audiences.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!audience) return text(res, 404, page('Audience taxonomy missing', actor, '<div class="warn">Audience not found.</div>'));
    const body = await readBody(req);
    if (body.kind === 'tag') audience.taxonomy.tags = [...new Set([...(audience.taxonomy.tags || []), body.name])];
    if (body.kind === 'interest') audience.taxonomy.interests = [...new Set([...(audience.taxonomy.interests || []), body.name])];
    if (body.kind === 'group') { audience.taxonomy.groupCategories ||= []; let group = audience.taxonomy.groupCategories.find((entry) => entry.name === body.groupName); if (!group) { group = { name: body.groupName, options: [] }; audience.taxonomy.groupCategories.push(group); } group.options = [...new Set([...(group.options || []), body.name])]; }
    saveDb(state.db); recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'audience-taxonomy-update', detail: `Updated taxonomy for ${audience.name}` });
    redirect(res, `/audiences/${audience.id}/taxonomy`);
  });

  router.register('GET', '/contacts', async ({ state, req, res, url }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audiences = state.db.audiences.filter((entry) => entry.workspaceId === actor.workspace.id);
    const audienceId = url.searchParams.get('audienceId') || audiences[0]?.id || '';
    const q = String(url.searchParams.get('q') || '').toLowerCase(); const tag = String(url.searchParams.get('tag') || '').toLowerCase(); const status = String(url.searchParams.get('status') || '').toLowerCase();
    const filtered = state.db.contacts.filter((entry) => entry.workspaceId === actor.workspace.id).filter((entry) => !audienceId || entry.audienceId === audienceId).filter((entry) => !q || `${entry.firstName} ${entry.lastName} ${entry.email}`.toLowerCase().includes(q)).filter((entry) => !tag || (entry.tags || []).map((item) => item.toLowerCase()).includes(tag)).filter((entry) => !status || entry.status.toLowerCase() === status);
    text(res, 200, page('Contacts table', actor, `<div class="card"><form method="get" action="/contacts"><select name="audienceId">${audiences.map((audience) => `<option value="${audience.id}" ${audience.id === audienceId ? 'selected' : ''}>${audience.name}</option>`).join('')}</select><input name="q" value="${q}" placeholder="Search"><input name="tag" value="${tag}" placeholder="Tag filter"><select name="status"><option value="">All statuses</option><option value="subscribed" ${status === 'subscribed' ? 'selected' : ''}>subscribed</option><option value="cleaned" ${status === 'cleaned' ? 'selected' : ''}>cleaned</option><option value="unsubscribed" ${status === 'unsubscribed' ? 'selected' : ''}>unsubscribed</option></select><button>Filter contacts</button></form></div><div class="grid"><div class="card"><h3>Create contact</h3><form method="post" action="/contacts"><input type="hidden" name="audienceId" value="${audienceId}"><input name="firstName"><input name="lastName"><input name="email" type="email" required><input name="phone"><input name="tags"><input name="groupCategory"><input name="groupValue"><input name="interests"><button>Create contact</button></form></div><div class="card"><h3>Import contacts</h3><p><a href="/contacts/import?audienceId=${audienceId}">Open import preview flow</a></p></div></div><form method="post" action="/contacts/bulk"><input type="hidden" name="audienceId" value="${audienceId}"><table><tr><th></th><th>Name</th><th>Email</th><th>Status</th><th>Tags</th><th>Groups</th><th>Interests</th></tr>${contactsTableRows(filtered)}</table><div class="card"><h3>Bulk action</h3><select name="action"><option value="status">Set status</option><option value="addTag">Add tag</option></select><input name="value"><button>Apply to selected contacts</button></div></form>`));
  });

  router.register('POST', '/contacts', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req); createContact(state, actor, { ...body, source: 'manual', activity: 'Created manually' }); redirect(res, `/contacts?audienceId=${body.audienceId}`);
  });

  router.register('POST', '/contacts/bulk', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req); bulkUpdateContacts(state, actor, Array.isArray(body.contactId) ? body.contactId : [body.contactId].filter(Boolean), body.action, body.value); redirect(res, `/contacts?audienceId=${body.audienceId}`);
  });

  router.register('GET', '/contacts/import', async ({ state, req, res, url }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    text(res, 200, page('Import contacts', actor, `<div class="card"><form method="post" action="/contacts/import/preview"><input type="hidden" name="audienceId" value="${url.searchParams.get('audienceId') || ''}"><textarea name="csvText"></textarea><button>Preview import</button></form></div>`));
  });

  router.register('POST', '/contacts/import/preview', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req); const preview = generateImportPreview(state, body.audienceId, body.csvText); const previewId = createId('import');
    state.db.importPreviews.unshift({ id: previewId, workspaceId: actor.workspace.id, audienceId: body.audienceId, validRows: preview.validRows, errors: preview.errors }); saveDb(state.db);
    text(res, 200, page('Import preview', actor, `${preview.errors.length ? `<div class="warn"><ul>${preview.errors.map((error) => `<li>${error}</li>`).join('')}</ul></div>` : '<div class="ok">No validation errors found.</div>'}<div class="card"><p>${preview.validRows.length} valid rows ready to import.</p><form method="post" action="/contacts/import/commit"><input type="hidden" name="previewId" value="${previewId}"><button ${preview.validRows.length ? '' : 'disabled'}>Queue import job</button></form></div><div class="card"><table><tr><th>Email</th><th>First name</th><th>Last name</th><th>Update existing</th></tr>${preview.rows.map((entry) => `<tr><td>${entry.row.email || ''}</td><td>${entry.row.firstName || ''}</td><td>${entry.row.lastName || ''}</td><td>${entry.row.updateExisting ? 'yes' : 'no'}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/contacts/import/commit', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req);
    const preview = state.db.importPreviews.find((entry) => entry.id === body.previewId && entry.workspaceId === actor.workspace.id);
    if (!preview || !preview.validRows.length) return text(res, 422, page('Import commit', actor, '<div class="warn">Preview missing or contains no valid rows.</div>'));
    queueImport(state, actor, preview); redirect(res, '/jobs');
  });

  router.register('GET', '/contacts/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const contact = state.db.contacts.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    text(res, 200, page(`Contact: ${contact.email}`, actor, `<div class="grid"><div class="card"><form method="post" action="/contacts/${contact.id}"><input name="firstName" value="${contact.firstName}"><input name="lastName" value="${contact.lastName}"><input name="email" type="email" value="${contact.email}"><input name="phone" value="${contact.phone || ''}"><select name="status"><option value="subscribed">subscribed</option><option value="cleaned">cleaned</option><option value="unsubscribed">unsubscribed</option></select><input name="tags" value="${(contact.tags || []).join(', ')}"><input name="groupCategory" value="${Object.keys(contact.groups || {})[0] || ''}"><input name="groupValue" value="${Object.values(contact.groups || {})[0] || ''}"><input name="interests" value="${(contact.interests || []).join(', ')}"><textarea name="notes">${contact.notes || ''}</textarea><button>Update contact</button></form></div><div class="card"><h3>Activity timeline</h3><ul>${(contact.activity || []).map((item) => `<li>${item.at} — ${item.message}</li>`).join('')}</ul></div></div>`));
  });

  router.register('POST', '/contacts/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const contact = state.db.contacts.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    updateContact(state, actor, contact, await readBody(req)); redirect(res, `/contacts/${contact.id}`);
  });

  router.register('GET', '/segments', async ({ state, req, res, url }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audienceId = url.searchParams.get('audienceId') || state.db.audiences.find((entry) => entry.workspaceId === actor.workspace.id)?.id || '';
    const segments = state.db.segments.filter((entry) => entry.workspaceId === actor.workspace.id && (!audienceId || entry.audienceId === audienceId));
    const gate = hasFeature(actor.workspace, 'advancedSegments') ? '' : '<div class="warn">Starter plan exposes the segment builder, but advanced multi-rule segments are upgrade-gated to Growth.</div>';
    text(res, 200, page('Segments / rule builder', actor, `${gate}<div class="grid"><div class="card"><h3>Create segment</h3><form method="post" action="/segments"><input type="hidden" name="audienceId" value="${audienceId}"><input name="name" required><select name="logic"><option value="all">match all</option><option value="any">match any</option></select><select name="field1"><option value="tag">tag</option><option value="interest">interest</option><option value="status">status</option><option value="group">group</option><option value="email">email</option><option value="firstName">firstName</option></select><select name="operator1"><option value="contains">contains</option><option value="equals">equals</option><option value="not_equals">not equals</option></select><input name="value1" required><select name="field2"><option value="tag">tag</option><option value="interest">interest</option><option value="status">status</option><option value="group">group</option></select><select name="operator2"><option value="contains">contains</option><option value="equals">equals</option></select><input name="value2"><button>Create segment</button></form></div><div class="card"><h3>Preview a rule set</h3><form method="post" action="/segments/preview"><input type="hidden" name="audienceId" value="${audienceId}"><select name="logic"><option value="all">match all</option><option value="any">match any</option></select><select name="field1"><option value="tag">tag</option><option value="interest">interest</option><option value="status">status</option><option value="group">group</option></select><select name="operator1"><option value="contains">contains</option><option value="equals">equals</option></select><input name="value1" placeholder="vip"><button>Preview count</button></form></div></div><div class="card"><table><tr><th>Name</th><th>Logic</th><th>Rules</th><th>Preview count</th></tr>${segments.map((segment) => `<tr><td>${segment.name}</td><td>${segment.logic}</td><td>${segment.rules.map((rule) => `${rule.field} ${rule.operator} ${rule.value}`).join(' | ')}</td><td>${segment.lastMatchCount}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/segments/preview', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req); const rules = parseSegmentRules(body, actor.workspace, hasFeature); const previewSegment = { logic: body.logic || 'all', rules }; const matches = contactsForAudience(state, body.audienceId).filter((contact) => matchSegment(contact, previewSegment)).length;
    text(res, 200, page('Segment preview', actor, `<div class="card"><div class="ok">Preview count: ${matches}</div><p>Rules: ${rules.map((rule) => `${rule.field} ${rule.operator} ${rule.value}`).join(' | ') || 'none'}</p></div>`));
  });

  router.register('POST', '/segments', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req); const rules = parseSegmentRules(body, actor.workspace, hasFeature); const segment = { id: createId('seg'), workspaceId: actor.workspace.id, audienceId: body.audienceId, name: body.name, logic: body.logic || 'all', rules, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastMatchCount: contactsForAudience(state, body.audienceId).filter((contact) => matchSegment(contact, { logic: body.logic || 'all', rules })).length };
    state.db.segments.unshift(segment); saveDb(state.db); recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'segment-create', detail: `Created segment ${segment.name}` }); redirect(res, `/segments?audienceId=${body.audienceId}`);
  });
}
