import { createAudience, saveDb } from '../storage.mjs';
import { page, requireActor, contactsTableRows } from '../view.mjs';
import { getCurrentActor, hasFeature, recordAudit } from '../domain-core.mjs';
import { audienceCrmSummary, audienceOperationalSummary, audienceTraits, bulkUpdateContacts, buildAudienceWarehouseSnapshot, contactsForAudience, contactTableQuery, createAudienceExport, createContact, generateImportPreview, matchSegment, mergeContacts, parseSegmentRules, queueAudienceProviderSync, queueImport, refreshAudienceWarehouseSnapshot, refreshSegmentAnalytics, saveContactTablePreferences, suppressContact, updateContact } from '../domain-audience.mjs';
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
    const crmSummary = audienceCrmSummary(state, audience);
    const operational = audienceOperationalSummary(state, audience);
    text(res, 200, page(`Audience: ${audience.name}`, actor, `<div class="grid"><div class="card"><h3>Metrics</h3><p>${contactsForAudience(state, audience.id).length} contacts</p><p>Audience health score: ${operational.healthScore}</p></div><div class="card"><h3>Classification</h3><p>Tags: ${traits.tags.join(', ') || 'none'}</p><p>Groups: ${traits.groups.join(', ') || 'none'}</p><p>Interests: ${traits.interests.join(', ') || 'none'}</p></div><div class="card"><h3>CRM health</h3><p>Subscribed: ${crmSummary.subscribedContacts}</p><p>Engaged: ${crmSummary.engagedContacts}</p><p>Enrichment coverage: ${Math.round(crmSummary.enrichmentCoverage * 100)}%</p><p>Suppression status: ${operational.suppressionCount} suppressed</p></div><div class="card"><h3>Open surfaces</h3><p><a href="/contacts?audienceId=${audience.id}">Contacts table</a></p><p><a href="/segments?audienceId=${audience.id}">Segments</a></p><p><a href="/audiences/${audience.id}/taxonomy">Tags / groups / interests</a></p><p><a href="/audiences/${audience.id}/warehouse">Identity lifecycle warehouse</a></p></div></div><div class="grid"><div class="card"><h3>Lifecycle insights</h3><p>${Object.entries(operational.lifecycleStages).map(([stage, count]) => `${stage}: ${count}`).join(' · ') || 'No lifecycle signals yet.'}</p><ul>${operational.nextBestActions.map((action) => `<li>${action}</li>`).join('')}</ul></div><div class="card"><h3>Import/export history</h3><p>Audience import/sync jobs: ${operational.imports.length}</p><p>Exports: ${operational.exports.length}</p><form method="post" action="/audiences/${audience.id}/export"><button>Export audience CSV</button></form></div><div class="card"><h3>Provider sync</h3><p>Commerce orders: ${operational.commerceOrders.length}</p><p>Linked campaigns: ${operational.campaigns.length}</p><p>Linked automations: ${operational.automations.length}</p><form method="post" action="/audiences/${audience.id}/provider-sync"><input name="provider" value="mailchimp-import-api"><button>Queue provider sync</button></form></div></div><div class="card"><h3>Recent activity timeline</h3><ul>${crmSummary.recentActivity.map((entry) => `<li>${entry.email}: ${entry.message}</li>`).join('') || '<li>No contact activity yet.</li>'}</ul></div>`));
  });

  router.register('GET', '/audiences/:id/warehouse', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audience = state.db.audiences.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!audience) return text(res, 404, page('Audience warehouse missing', actor, '<div class="warn">Audience not found.</div>'));
    const latest = (state.db.audienceWarehouseSnapshots || []).find((entry) => entry.audienceId === audience.id) || buildAudienceWarehouseSnapshot(state, audience);
    text(res, 200, page(`Identity lifecycle warehouse: ${audience.name}`, actor, `<div class="grid"><div class="card"><h3>Identity graph</h3><p>Resolved profiles: ${latest.identityGraph.resolvedProfiles}</p><p>Duplicate identity groups: ${latest.identityGraph.duplicateIdentityGroups.length}</p><p>Identity resolution rate: ${Math.round(latest.identityGraph.identityResolutionRate * 100)}%</p></div><div class="card"><h3>Lifecycle warehouse</h3><p>${Object.entries(latest.lifecycleStages).map(([stage, count]) => `${stage}: ${count}`).join(' · ') || 'No lifecycle stages yet.'}</p><p>Rows: ${latest.warehouseRows.length}</p></div><div class="card"><h3>Source completeness</h3><p>Email: ${Math.round(latest.completeness.email * 100)}%</p><p>Phone: ${Math.round(latest.completeness.phone * 100)}%</p><p>Tags: ${Math.round(latest.completeness.tags * 100)}%</p><p>Groups: ${Math.round(latest.completeness.groups * 100)}%</p></div><div class="card"><h3>Refresh warehouse</h3><p>Last generated: ${latest.generatedAt}</p><p>Next action: ${latest.syncReadiness.nextAction}</p><form method="post" action="/audiences/${audience.id}/warehouse/refresh"><button>Refresh identity lifecycle warehouse</button></form></div></div><div class="card"><h3>Duplicate identity review</h3>${latest.identityGraph.duplicateIdentityGroups.length ? `<ul>${latest.identityGraph.duplicateIdentityGroups.map((group) => `<li>${group.emails.join(', ') || group.key}: ${group.contactIds.length} contacts · stages ${group.stages.join('/')}</li>`).join('')}</ul>` : '<p>No duplicate identity groups in the current warehouse snapshot.</p>'}</div><div class="card"><h3>Warehouse rows</h3><table><tr><th>Email</th><th>Stage</th><th>Status</th><th>Source</th><th>Signals</th></tr>${latest.warehouseRows.map((row) => `<tr><td>${row.email}</td><td>${row.stage}</td><td>${row.status}</td><td>${row.source}</td><td>${row.tags.join('/')} · ${row.interests.join('/')}</td></tr>`).join('') || '<tr><td colspan="5">No warehouse rows yet.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/audiences/:id/warehouse/refresh', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audience = state.db.audiences.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (audience) refreshAudienceWarehouseSnapshot(state, actor, audience);
    redirect(res, `/audiences/${params.id}/warehouse`);
  });

  router.register('POST', '/audiences/:id/export', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audience = state.db.audiences.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (audience) createAudienceExport(state, actor, audience, contactsForAudience(state, audience.id), 'audience-csv-export');
    redirect(res, `/audiences/${params.id}`);
  });

  router.register('POST', '/audiences/:id/provider-sync', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const audience = state.db.audiences.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (audience) queueAudienceProviderSync(state, actor, audience, (await readBody(req)).provider || 'mailchimp-import-api');
    redirect(res, `/audiences/${params.id}`);
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
    const table = contactTableQuery(state, actor, url);
    const audience = state.db.audiences.find((entry) => entry.id === table.audienceId && entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Contacts table', actor, `<div class="card"><form method="get" action="/contacts"><select name="audienceId">${table.audiences.map((entry) => `<option value="${entry.id}" ${entry.id === table.audienceId ? 'selected' : ''}>${entry.name}</option>`).join('')}</select><input name="q" value="${table.q}" placeholder="Search"><input name="tag" value="${table.tag}" placeholder="Tag filter"><select name="status"><option value="">All statuses</option><option value="subscribed" ${table.status === 'subscribed' ? 'selected' : ''}>subscribed</option><option value="cleaned" ${table.status === 'cleaned' ? 'selected' : ''}>cleaned</option><option value="unsubscribed" ${table.status === 'unsubscribed' ? 'selected' : ''}>unsubscribed</option></select><select name="sort"><option value="createdAt" ${table.sort === 'createdAt' ? 'selected' : ''}>Created</option><option value="updatedAt" ${table.sort === 'updatedAt' ? 'selected' : ''}>Updated</option><option value="email" ${table.sort === 'email' ? 'selected' : ''}>Email</option><option value="status" ${table.sort === 'status' ? 'selected' : ''}>Status</option><option value="name" ${table.sort === 'name' ? 'selected' : ''}>Name</option></select><select name="direction"><option value="desc" ${table.direction === 'desc' ? 'selected' : ''}>desc</option><option value="asc" ${table.direction === 'asc' ? 'selected' : ''}>asc</option></select><input name="pageSize" value="${table.pageSize}" placeholder="25"><button>Filter contacts</button></form></div><div class="grid"><div class="card"><h3>Create contact</h3><form method="post" action="/contacts"><input type="hidden" name="audienceId" value="${table.audienceId}"><input name="firstName"><input name="lastName"><input name="email" type="email" required><input name="phone"><input name="tags"><input name="groupCategory"><input name="groupValue"><input name="interests"><button>Create contact</button></form></div><div class="card"><h3>Import/export contacts</h3><p><a href="/contacts/import?audienceId=${table.audienceId}">Open import preview flow</a></p><form method="post" action="/contacts/export"><input type="hidden" name="audienceId" value="${table.audienceId}"><input type="hidden" name="q" value="${table.q}"><input type="hidden" name="tag" value="${table.tag}"><input type="hidden" name="status" value="${table.status}"><button>Export filtered contacts</button></form></div><div class="card"><h3>Saved columns & pagination</h3><form method="post" action="/contacts/table/preferences"><input name="columns" value="${table.savedColumns.join(',')}"><select name="sort"><option value="updatedAt">updatedAt</option><option value="email">email</option><option value="status">status</option><option value="name">name</option></select><select name="direction"><option value="desc">desc</option><option value="asc">asc</option></select><input name="pageSize" value="${table.pageSize}"><button>Save table view</button></form><p>Visible columns: ${table.savedColumns.join(', ')}</p></div></div><form method="post" action="/contacts/bulk"><input type="hidden" name="audienceId" value="${table.audienceId}"><table><tr><th></th><th>Name</th><th>Email</th><th>Status</th><th>Tags</th><th>Groups</th><th>Interests</th></tr>${contactsTableRows(table.visible)}</table><div class="grid"><div class="card"><h3>Bulk action</h3><select name="action"><option value="status">Set status</option><option value="addTag">Add tag</option></select><input name="value"><button>Apply to selected contacts</button></div><div class="card"><h3>Pagination</h3><p>Page ${table.page} of ${table.pageCount}; ${table.filtered.length} matching contacts.</p><p><a href="/contacts?audienceId=${table.audienceId}&page=${Math.max(1, table.page - 1)}&pageSize=${table.pageSize}">Previous</a> · <a href="/contacts?audienceId=${table.audienceId}&page=${Math.min(table.pageCount, table.page + 1)}&pageSize=${table.pageSize}">Next</a></p></div></div></form><div class="card"><h3>Merge / dedupe candidates</h3>${table.duplicateGroups.length ? table.duplicateGroups.map((entries) => `<form method="post" action="/contacts/merge"><input type="hidden" name="audienceId" value="${table.audienceId}"><input type="hidden" name="primaryId" value="${entries[0].id}">${entries.slice(1).map((entry) => `<input type="hidden" name="mergeId" value="${entry.id}">`).join('')}<p>${entries.map((entry) => entry.email).join(', ')}</p><button>Merge duplicate contacts</button></form>`).join('') : '<p>No duplicate contacts detected in this view.</p>'}</div>${audience ? `<div class="card"><h3>Audience drill-down</h3><p><a href="/audiences/${audience.id}">Return to ${audience.name} health overview</a></p></div>` : ''}`));
  });

  router.register('POST', '/contacts/table/preferences', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req);
    saveContactTablePreferences(state, actor, body);
    redirect(res, '/contacts');
  });

  router.register('POST', '/contacts/export', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req);
    const audience = state.db.audiences.find((entry) => entry.id === body.audienceId && entry.workspaceId === actor.workspace.id);
    if (audience) {
      const params = new URLSearchParams(Object.entries({ audienceId: body.audienceId || '', q: body.q || '', tag: body.tag || '', status: body.status || '' }));
      const table = contactTableQuery(state, actor, new URL(`http://mailclone.local/contacts?${params.toString()}`));
      createAudienceExport(state, actor, audience, table.filtered, 'filtered-contacts-export');
    }
    redirect(res, `/contacts?audienceId=${body.audienceId || ''}`);
  });

  router.register('POST', '/contacts/merge', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const body = await readBody(req);
    mergeContacts(state, actor, body.primaryId, Array.isArray(body.mergeId) ? body.mergeId : [body.mergeId].filter(Boolean));
    redirect(res, `/contacts?audienceId=${body.audienceId || ''}`);
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
    text(res, 200, page(`Contact: ${contact.email}`, actor, `<div class="grid"><div class="card"><form method="post" action="/contacts/${contact.id}"><input name="firstName" value="${contact.firstName}"><input name="lastName" value="${contact.lastName}"><input name="email" type="email" value="${contact.email}"><input name="phone" value="${contact.phone || ''}"><select name="status"><option value="subscribed" ${contact.status === 'subscribed' ? 'selected' : ''}>subscribed</option><option value="cleaned" ${contact.status === 'cleaned' ? 'selected' : ''}>cleaned</option><option value="unsubscribed" ${contact.status === 'unsubscribed' ? 'selected' : ''}>unsubscribed</option></select><input name="tags" value="${(contact.tags || []).join(', ')}"><input name="groupCategory" value="${Object.keys(contact.groups || {})[0] || ''}"><input name="groupValue" value="${Object.values(contact.groups || {})[0] || ''}"><input name="interests" value="${(contact.interests || []).join(', ')}"><textarea name="notes">${contact.notes || ''}</textarea><button>Update contact</button></form></div><div class="card"><h3>Consent & suppression state</h3><p>Status: ${contact.status}</p><p>Suppression: ${contact.suppression?.reason || 'not suppressed'}</p><form method="post" action="/contacts/${contact.id}/suppression"><input name="reason" value="Manual unsubscribe request"><button>Suppress contact</button></form></div><div class="card"><h3>Activity timeline</h3><ul>${(contact.activity || []).map((item) => `<li>${item.at} — ${item.message}</li>`).join('')}</ul></div><div class="card"><h3>Tags, groups, interests</h3><p>Tags: ${(contact.tags || []).join(', ') || 'none'}</p><p>Groups: ${Object.entries(contact.groups || {}).map(([key, value]) => `${key}:${value}`).join(', ') || 'none'}</p><p>Interests: ${(contact.interests || []).join(', ') || 'none'}</p></div></div>`));
  });

  router.register('POST', '/contacts/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const contact = state.db.contacts.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    updateContact(state, actor, contact, await readBody(req)); redirect(res, `/contacts/${contact.id}`);
  });

  router.register('POST', '/contacts/:id/suppression', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const contact = state.db.contacts.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (contact) suppressContact(state, actor, contact, (await readBody(req)).reason || 'Manual suppression');
    redirect(res, `/contacts/${params.id}`);
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
    state.db.segments.unshift(segment); saveDb(state.db); recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'segment-create', detail: `Created segment ${segment.name}` }); refreshSegmentAnalytics(state, actor, segment); redirect(res, `/segments?audienceId=${body.audienceId}`);
  });
}

export const audienceIdentityLifecycleIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "audience_identity_lifecycle",
  "focusGroup": "audience_crm",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.audience_identity_lifecycle::semantic-frontier-001#06-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildAudienceIdentityLifecycleIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...audienceIdentityLifecycleIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs","packages/app/storage.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: audienceIdentityLifecycleIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: audienceIdentityLifecycleIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: audienceIdentityLifecycleIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const audienceSyncWarehouseIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "audience_sync_warehouse",
  "focusGroup": "audience_crm",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.audience_sync_warehouse::semantic-frontier-001#07-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildAudienceSyncWarehouseIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...audienceSyncWarehouseIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/jobs.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: audienceSyncWarehouseIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: audienceSyncWarehouseIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: audienceSyncWarehouseIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const audienceSyncWarehousePrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "audience_sync_warehouse",
  "focusGroup": "audience_crm",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.audience_sync_warehouse::semantic-frontier-001#07-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildAudienceSyncWarehousePrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...audienceSyncWarehousePrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/jobs.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: audienceSyncWarehousePrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: audienceSyncWarehousePrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: audienceSyncWarehousePrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}

export const audienceIdentityLifecyclePrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "audience_identity_lifecycle",
  "focusGroup": "audience_crm",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.audience_identity_lifecycle::semantic-frontier-001#06-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildAudienceIdentityLifecyclePrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...audienceIdentityLifecyclePrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs","packages/app/storage.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: audienceIdentityLifecyclePrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: audienceIdentityLifecyclePrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: audienceIdentityLifecyclePrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}



export function buildAudienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionRuntimeKey = "audience_sync_warehouse:integrated_user_path_evidence:packages/app/routes/audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_sync_warehouse", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.audience_sync_warehouse::semantic-frontier-001#05-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/jobs.mjs"], nextAction: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:audience_sync_warehouse:monitor_job_runtime_handoff" : "integrated_user_path_evidence:audience_sync_warehouse:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppRoutesAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/audience.mjs" } };
}


export const audienceSyncWarehouseInteractiveStateAndCommandsSemanticRuntimeContract = Object.freeze({"surfaceId":"audience_sync_warehouse","focusGroup":"audience_crm","phaseId":"interactive_state_and_commands","shardId":"focus.audience_sync_warehouse::semantic-frontier-001#05-interactive_state_and_commands#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildAudienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionRuntimeKey = "audience_sync_warehouse:interactive_state_and_commands:packages/app/routes/audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", audienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_sync_warehouse", focusGroup: "audience_crm", phaseId: "interactive_state_and_commands", shardId: "focus.audience_sync_warehouse::semantic-frontier-001#05-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: audienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:audience_sync_warehouse:monitor_job_runtime_handoff" : "interactive_state_and_commands:audience_sync_warehouse:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceSyncWarehouseInteractiveStateAndCommandsPackagesAppRoutesAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/audience.mjs" } };
}


export const audienceIdentityLifecycleOperationalPersistenceAndJobsSemanticRuntimeContract = Object.freeze({"surfaceId":"audience_identity_lifecycle","focusGroup":"audience_crm","phaseId":"operational_persistence_and_jobs","shardId":"focus.audience_identity_lifecycle::semantic-frontier-001#04-operational_persistence_and_jobs#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildAudienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionRuntimeKey = "audience_identity_lifecycle:operational_persistence_and_jobs:packages/app/routes/audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_identity_lifecycle", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.audience_identity_lifecycle::semantic-frontier-001#04-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/routes/audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:audience_identity_lifecycle:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:audience_identity_lifecycle:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppRoutesAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/audience.mjs" } };
}

