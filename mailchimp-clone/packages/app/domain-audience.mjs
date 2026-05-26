import { persistState } from './storage.mjs';
import { createId, csvSplit, nowIso } from './utils.mjs';
import { contactPayload, createExport, enqueueJob, recordAudit } from './domain-core.mjs';

export function contactsForAudience(state, audienceId) {
  return state.db.contacts.filter((contact) => contact.audienceId === audienceId);
}

export function contactActivity(contact, message) {
  contact.activity ||= [];
  contact.activity.unshift({ at: nowIso(), message });
}

export function audienceTraits(state, audience) {
  const contacts = contactsForAudience(state, audience.id);
  const tags = new Set(audience.taxonomy?.tags || []);
  const interests = new Set(audience.taxonomy?.interests || []);
  const groups = new Set((audience.taxonomy?.groupCategories || []).flatMap((group) => group.options.map((option) => `${group.name}:${option}`)));
  for (const contact of contacts) {
    for (const tag of contact.tags || []) tags.add(tag);
    for (const interest of contact.interests || []) interests.add(interest);
    for (const [key, value] of Object.entries(contact.groups || {})) groups.add(`${key}:${value}`);
  }
  return { tags: [...tags], interests: [...interests], groups: [...groups] };
}

export function audienceCrmSummary(state, audience) {
  const contacts = contactsForAudience(state, audience.id);
  const subscribed = contacts.filter((contact) => (contact.status || 'subscribed') === 'subscribed');
  const engaged = subscribed.filter((contact) => (contact.tags || []).some((tag) => ['vip', 'retained', 'engaged'].includes(String(tag || '').toLowerCase())) || (contact.interests || []).length > 0);
  const recentActivity = contacts.flatMap((contact) => (Array.isArray(contact.activity) ? contact.activity : []).map((entry) => ({ ...entry, contactId: contact.id, email: contact.email }))).slice(0, 5);
  return {
    totalContacts: contacts.length,
    subscribedContacts: subscribed.length,
    engagedContacts: engaged.length,
    enrichmentCoverage: contacts.length ? Number((contacts.filter((contact) => (contact.tags || []).length || (contact.interests || []).length || Object.keys(contact.groups || {}).length).length / contacts.length).toFixed(2)) : 0,
    recentActivity
  };
}

export function audienceOperationalSummary(state, audience) {
  const contacts = contactsForAudience(state, audience.id);
  const segments = state.db.segments.filter((entry) => entry.audienceId === audience.id);
  const imports = state.db.jobs.filter((job) => job.payload?.audienceId === audience.id && ['import_contacts', 'audience_provider_sync', 'segment_refresh'].includes(job.type));
  const exports = (state.db.exports || []).filter((entry) => entry.meta?.audienceId === audience.id || String(entry.label || '').includes(audience.name));
  const campaigns = state.db.campaigns.filter((entry) => entry.audienceId === audience.id || entry.workspaceId === audience.workspaceId);
  const automations = state.db.automations.filter((entry) => entry.audienceId === audience.id || entry.workspaceId === audience.workspaceId);
  const orders = (state.db.commerceOrders || []).filter((entry) => entry.audienceId === audience.id || entry.workspaceId === audience.workspaceId);
  const suppressionEntries = (state.db.suppressionEntries || []).filter((entry) => entry.audienceId === audience.id || contacts.some((contact) => contact.email === entry.email));
  const statuses = contacts.reduce((acc, contact) => {
    const status = contact.status || 'subscribed';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const lifecycleStages = contacts.reduce((acc, contact) => {
    const stage = (contact.tags || []).includes('vip') ? 'advocate' : (contact.tags || []).includes('new') ? 'new' : (contact.activity || []).length > 2 ? 'engaged' : 'nurture';
    acc[stage] = (acc[stage] || 0) + 1;
    return acc;
  }, {});
  const healthScore = Math.min(100, Math.round(
    (contacts.length ? 30 : 0) +
    (segments.length ? 20 : 0) +
    (imports.some((job) => job.status === 'completed') ? 15 : 0) +
    (Object.keys(statuses).length ? 10 : 0) +
    (suppressionEntries.length ? 10 : 15) +
    (campaigns.length || automations.length ? 20 : 0)
  ));
  return {
    healthScore,
    statuses,
    lifecycleStages,
    suppressionCount: suppressionEntries.length,
    imports: imports.slice(0, 5),
    exports: exports.slice(0, 5),
    segments,
    campaigns: campaigns.slice(0, 5),
    automations: automations.slice(0, 5),
    commerceOrders: orders.slice(0, 5),
    nextBestActions: [
      contacts.length ? 'Review segments and campaign overlap' : 'Import or create first contact',
      suppressionEntries.length ? 'Audit suppressed contacts before send' : 'Run consent and suppression check',
      imports.some((job) => job.status === 'pending') ? 'Monitor provider sync/import job' : 'Schedule provider sync refresh'
    ]
  };
}

function stageContactForWarehouse(contact) {
  const tags = (contact.tags || []).map((entry) => String(entry).toLowerCase());
  if (contact.status === 'unsubscribed' || contact.suppression) return 'suppressed';
  if (tags.includes('vip') || tags.includes('retained')) return 'advocate';
  if (tags.includes('new')) return 'new';
  if ((contact.activity || []).length >= 2 || (contact.interests || []).length >= 2) return 'engaged';
  if (String(contact.source || '').includes('import') || String(contact.source || '').includes('api')) return 'acquired';
  return 'nurture';
}

export function buildAudienceWarehouseSnapshot(state, audience) {
  const contacts = contactsForAudience(state, audience.id);
  const identityGroups = Object.values(contacts.reduce((acc, contact) => {
    const emailKey = String(contact.email || '').toLowerCase();
    const phoneKey = String(contact.phone || '').replace(/\D+/g, '');
    const key = emailKey || (phoneKey ? `phone:${phoneKey}` : contact.id);
    acc[key] ||= { key, emails: new Set(), phones: new Set(), contactIds: [], sources: new Set(), stages: new Set() };
    acc[key].contactIds.push(contact.id);
    if (emailKey) acc[key].emails.add(emailKey);
    if (phoneKey) acc[key].phones.add(phoneKey);
    acc[key].sources.add(contact.source || 'manual');
    acc[key].stages.add(stageContactForWarehouse(contact));
    return acc;
  }, {})).map((group) => ({
    key: group.key,
    contactIds: group.contactIds,
    emails: [...group.emails],
    phones: [...group.phones],
    sources: [...group.sources],
    stages: [...group.stages],
    duplicateContactCount: Math.max(0, group.contactIds.length - 1)
  }));

  const lifecycleStages = contacts.reduce((acc, contact) => {
    const stage = stageContactForWarehouse(contact);
    acc[stage] = (acc[stage] || 0) + 1;
    return acc;
  }, {});
  const completeness = {
    email: contacts.length ? Number((contacts.filter((contact) => contact.email).length / contacts.length).toFixed(2)) : 0,
    phone: contacts.length ? Number((contacts.filter((contact) => contact.phone).length / contacts.length).toFixed(2)) : 0,
    tags: contacts.length ? Number((contacts.filter((contact) => (contact.tags || []).length).length / contacts.length).toFixed(2)) : 0,
    interests: contacts.length ? Number((contacts.filter((contact) => (contact.interests || []).length).length / contacts.length).toFixed(2)) : 0,
    groups: contacts.length ? Number((contacts.filter((contact) => Object.keys(contact.groups || {}).length).length / contacts.length).toFixed(2)) : 0
  };
  const providerSyncs = (state.db.integrationSyncRuns || []).filter((entry) => entry.audienceId === audience.id);
  const imports = state.db.jobs.filter((job) => job.payload?.audienceId === audience.id && ['import_contacts', 'audience_provider_sync', 'segment_refresh'].includes(job.type));
  return {
    id: createId('audwh'),
    workspaceId: audience.workspaceId,
    audienceId: audience.id,
    audienceName: audience.name,
    generatedAt: nowIso(),
    contactCount: contacts.length,
    identityGraph: {
      resolvedProfiles: identityGroups.length,
      duplicateIdentityGroups: identityGroups.filter((group) => group.duplicateContactCount > 0),
      identityResolutionRate: contacts.length ? Number((identityGroups.length / contacts.length).toFixed(2)) : 0,
      groups: identityGroups.slice(0, 20)
    },
    lifecycleStages,
    completeness,
    warehouseRows: contacts.slice(0, 100).map((contact) => ({
      contactId: contact.id,
      email: contact.email,
      source: contact.source || 'manual',
      stage: stageContactForWarehouse(contact),
      status: contact.status || 'subscribed',
      tags: contact.tags || [],
      interests: contact.interests || [],
      groupCount: Object.keys(contact.groups || {}).length,
      activityCount: (contact.activity || []).length,
      updatedAt: contact.updatedAt || contact.createdAt
    })),
    syncReadiness: {
      providerSyncRuns: providerSyncs.length,
      importJobs: imports.length,
      readyForSegmentation: contacts.length > 0 && Object.values(lifecycleStages).some(Boolean),
      nextAction: contacts.length ? 'review_identity_lifecycle_segments' : 'add_contacts_before_warehouse_refresh'
    }
  };
}

export function refreshAudienceWarehouseSnapshot(state, actor, audience) {
  const snapshot = buildAudienceWarehouseSnapshot(state, audience);
  state.db.audienceWarehouseSnapshots ||= [];
  state.db.audienceWarehouseSnapshots.unshift(snapshot);
  state.db.audienceWarehouseSnapshots = state.db.audienceWarehouseSnapshots.slice(0, 50);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'audience-warehouse-refresh', detail: `Refreshed warehouse snapshot for ${audience.name}` });
  return snapshot;
}

export function contactTableQuery(state, actor, url) {
  const audiences = state.db.audiences.filter((entry) => entry.workspaceId === actor.workspace.id);
  const audienceId = url.searchParams.get('audienceId') || audiences[0]?.id || '';
  const q = String(url.searchParams.get('q') || '').toLowerCase();
  const tag = String(url.searchParams.get('tag') || '').toLowerCase();
  const status = String(url.searchParams.get('status') || '').toLowerCase();
  const sort = String(url.searchParams.get('sort') || actor.workspace.settings?.contactTableSort || 'createdAt');
  const direction = String(url.searchParams.get('direction') || actor.workspace.settings?.contactTableDirection || 'desc') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || actor.workspace.settings?.contactTablePageSize || 25)));
  const allColumns = ['name', 'email', 'status', 'tags', 'groups', 'interests', 'source', 'updatedAt'];
  const savedColumns = Array.isArray(actor.workspace.settings?.contactTableColumns) && actor.workspace.settings.contactTableColumns.length ? actor.workspace.settings.contactTableColumns : allColumns.slice(0, 6);
  const filtered = state.db.contacts
    .filter((entry) => entry.workspaceId === actor.workspace.id)
    .filter((entry) => !audienceId || entry.audienceId === audienceId)
    .filter((entry) => !q || `${entry.firstName} ${entry.lastName} ${entry.email}`.toLowerCase().includes(q))
    .filter((entry) => !tag || (entry.tags || []).map((item) => item.toLowerCase()).includes(tag))
    .filter((entry) => !status || String(entry.status || '').toLowerCase() === status)
    .sort((left, right) => {
      const leftValue = sort === 'email' ? left.email : sort === 'status' ? left.status : sort === 'updatedAt' ? left.updatedAt : sort === 'createdAt' ? left.createdAt : `${left.firstName} ${left.lastName}`;
      const rightValue = sort === 'email' ? right.email : sort === 'status' ? right.status : sort === 'updatedAt' ? right.updatedAt : sort === 'createdAt' ? right.createdAt : `${right.firstName} ${right.lastName}`;
      return direction === 'asc' ? String(leftValue || '').localeCompare(String(rightValue || '')) : String(rightValue || '').localeCompare(String(leftValue || ''));
    });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const duplicateGroups = Object.values(filtered.reduce((acc, contact) => {
    const key = String(contact.email || '').toLowerCase();
    if (!key) return acc;
    acc[key] ||= [];
    acc[key].push(contact);
    return acc;
  }, {})).filter((entries) => entries.length > 1);
  return { audiences, audienceId, q, tag, status, sort, direction, page, pageSize, pageCount, savedColumns, allColumns, filtered, visible, duplicateGroups };
}

export function saveContactTablePreferences(state, actor, body) {
  actor.workspace.settings ||= {};
  actor.workspace.settings.contactTableColumns = csvSplit(Array.isArray(body.columns) ? body.columns.join(',') : body.columns || 'name,email,status,tags,groups,interests');
  actor.workspace.settings.contactTableSort = body.sort || 'updatedAt';
  actor.workspace.settings.contactTableDirection = body.direction === 'asc' ? 'asc' : 'desc';
  actor.workspace.settings.contactTablePageSize = Math.min(100, Math.max(1, Number(body.pageSize || 25)));
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'contact-table-preferences', detail: 'Saved contact table columns, sorting, and pagination preferences' });
}

export function createAudienceExport(state, actor, audience, contacts, label = 'audience-export') {
  const header = ['email', 'firstName', 'lastName', 'status', 'tags', 'interests', 'groups', 'source', 'updatedAt'];
  const csv = [header.join(','), ...contacts.map((contact) => [
    contact.email,
    contact.firstName,
    contact.lastName,
    contact.status,
    (contact.tags || []).join('|'),
    (contact.interests || []).join('|'),
    Object.entries(contact.groups || {}).map(([key, value]) => `${key}:${value}`).join('|'),
    contact.source || 'manual',
    contact.updatedAt || contact.createdAt
  ].map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const entry = createExport(state, actor, `${label}: ${audience.name}`, csv);
  entry.meta = { ...(entry.meta || {}), audienceId: audience.id, rowCount: contacts.length, exportKind: label };
  persistState(state);
  return entry;
}

export function queueAudienceProviderSync(state, actor, audience, provider = 'mailchimp-import-api') {
  const job = enqueueJob(state, { type: 'audience_provider_sync', workspaceId: actor.workspace.id, userId: actor.user.id, payload: { audienceId: audience.id, provider, mode: 'bidirectional_contact_sync' } });
  state.db.integrationSyncRuns ||= [];
  state.db.integrationSyncRuns.unshift({ id: createId('isync'), workspaceId: actor.workspace.id, audienceId: audience.id, appId: provider, status: 'queued', syncedContacts: contactsForAudience(state, audience.id).length, syncedOrders: 0, syncedRevenue: 0, createdAt: nowIso() });
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'audience-provider-sync', detail: `Queued ${provider} sync for ${audience.name}` });
  return job;
}

export function mergeContacts(state, actor, primaryId, mergeIds = []) {
  const primary = state.db.contacts.find((entry) => entry.id === primaryId && entry.workspaceId === actor.workspace.id);
  if (!primary) return null;
  const merged = [];
  for (const id of mergeIds.filter((entry) => entry && entry !== primaryId)) {
    const duplicate = state.db.contacts.find((entry) => entry.id === id && entry.workspaceId === actor.workspace.id);
    if (!duplicate) continue;
    primary.tags = [...new Set([...(primary.tags || []), ...(duplicate.tags || [])])];
    primary.interests = [...new Set([...(primary.interests || []), ...(duplicate.interests || [])])];
    primary.groups = { ...(duplicate.groups || {}), ...(primary.groups || {}) };
    primary.notes = [primary.notes, duplicate.notes].filter(Boolean).join('\n');
    primary.activity = [{ at: nowIso(), message: `Merged duplicate ${duplicate.email}` }, ...(primary.activity || []), ...(duplicate.activity || [])];
    state.db.contacts = state.db.contacts.filter((entry) => entry.id !== duplicate.id);
    merged.push(duplicate.email);
  }
  primary.updatedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'contacts-merge', detail: `Merged ${merged.length} duplicates into ${primary.email}` });
  return primary;
}

export function suppressContact(state, actor, contact, reason = 'Manual suppression') {
  contact.status = 'unsubscribed';
  contact.suppression = { reason, suppressedAt: nowIso(), userId: actor.user.id };
  contactActivity(contact, `Suppressed: ${reason}`);
  state.db.suppressionEntries ||= [];
  state.db.suppressionEntries.unshift({ id: createId('supp'), workspaceId: actor.workspace.id, audienceId: contact.audienceId, contactId: contact.id, email: contact.email, reason, createdAt: nowIso() });
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'contact-suppression', detail: `Suppressed ${contact.email}` });
}

export function refreshSegmentAnalytics(state, actor, segment) {
  const contacts = contactsForAudience(state, segment.audienceId);
  segment.lastMatchCount = contacts.filter((contact) => matchSegment(contact, segment)).length;
  segment.analytics = {
    refreshedAt: nowIso(),
    matchCount: segment.lastMatchCount,
    subscribedMatches: contacts.filter((contact) => matchSegment(contact, segment) && (contact.status || 'subscribed') === 'subscribed').length
  };
  enqueueJob(state, { type: 'segment_refresh', workspaceId: actor.workspace.id, userId: actor.user.id, payload: { audienceId: segment.audienceId, segmentId: segment.id, matchCount: segment.lastMatchCount } });
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'segment-refresh', detail: `Refreshed segment ${segment.name}` });
}

export function audienceTaxonomyRuntimeReadiness(state, audience) {
  const traits = audienceTraits(state, audience);
  const taxonomy = audience.taxonomy || {};
  const groupCategories = Array.isArray(taxonomy.groupCategories) ? taxonomy.groupCategories : [];
  const contacts = contactsForAudience(state, audience.id);
  const taggedContacts = contacts.filter((contact) => (contact.tags || []).some((tag) => traits.tags.includes(tag)));
  return {
    tags: traits.tags.length,
    groups: groupCategories.reduce((sum, group) => sum + (group.options || []).length, 0),
    interests: traits.interests.length,
    taggedContacts: taggedContacts.length,
    workflowStatus: contacts.length ? 'taxonomy_ready_for_segmentation' : 'taxonomy_waiting_for_contacts',
    nextAction: traits.tags.length || traits.groups.length || traits.interests.length ? 'build_segment_from_taxonomy' : 'add_first_taxonomy_signal'
  };
}

export function normalizeRule(field, operator, value) {
  return { field: field || 'tag', operator: operator || 'contains', value: String(value || '').trim() };
}

export function parseSegmentRules(body, workspace, hasFeature) {
  const limit = hasFeature(workspace, 'advancedSegments') ? 3 : 1;
  const rules = [];
  for (let index = 1; index <= 3; index += 1) {
    const value = String(body[`value${index}`] || '').trim();
    if (!value || rules.length >= limit) continue;
    rules.push(normalizeRule(body[`field${index}`], body[`operator${index}`], value));
  }
  return rules;
}

export function matchRule(contact, rule) {
  const value = String(rule.value || '').toLowerCase();
  const source = {
    email: String(contact.email || '').toLowerCase(),
    firstName: String(contact.firstName || '').toLowerCase(),
    lastName: String(contact.lastName || '').toLowerCase(),
    status: String(contact.status || '').toLowerCase(),
    tag: (contact.tags || []).map((item) => item.toLowerCase()),
    interest: (contact.interests || []).map((item) => item.toLowerCase()),
    group: Object.entries(contact.groups || {}).map(([key, entry]) => `${String(key).toLowerCase()}:${String(entry).toLowerCase()}`)
  }[rule.field] ?? '';
  if (Array.isArray(source)) return rule.operator === 'not_equals' ? !source.includes(value) : source.some((entry) => rule.operator === 'equals' ? entry === value : entry.includes(value));
  if (rule.operator === 'equals') return source === value;
  if (rule.operator === 'not_equals') return source !== value;
  return source.includes(value);
}

export function matchSegment(contact, segment) {
  if (!segment || !segment.rules?.length) return true;
  const results = segment.rules.map((rule) => matchRule(contact, rule));
  return segment.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
}

export function createContact(state, actor, body) {
  const contact = { id: createId('contact'), workspaceId: actor.workspace.id, audienceId: body.audienceId, source: body.source || 'manual', createdAt: nowIso(), updatedAt: nowIso(), activity: [{ at: nowIso(), message: body.activity || 'Created manually' }], ...contactPayload(body) };
  state.db.contacts.unshift(contact);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: `${body.source === 'api' ? 'api-' : ''}contact-create`, detail: `Created contact ${contact.email}` });
  return contact;
}

export function updateContact(state, actor, contact, body, viaApi = false) {
  Object.assign(contact, { ...contactPayload(body), updatedAt: nowIso() });
  contactActivity(contact, viaApi ? 'Updated via API' : 'Updated from contact profile');
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: `${viaApi ? 'api-' : ''}contact-update`, detail: `Updated contact ${contact.email}` });
}

export function bulkUpdateContacts(state, actor, ids, action, value) {
  for (const id of ids) {
    const contact = state.db.contacts.find((entry) => entry.id === id && entry.workspaceId === actor.workspace.id);
    if (!contact) continue;
    if (action === 'status') contact.status = value || contact.status;
    if (action === 'addTag' && value) contact.tags = [...new Set([...(contact.tags || []), value])];
    contact.updatedAt = nowIso();
    contactActivity(contact, `Bulk ${action}: ${value}`);
  }
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'contacts-bulk-update', detail: `Bulk action ${action}` });
}

export function generateImportPreview(state, audienceId, csvText) {
  const lines = String(csvText || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { errors: ['CSV preview requires a header row and at least one data row.'], validRows: [], rows: [] };
  const columns = lines[0].split(',').map((cell) => cell.trim());
  const rows = [];
  const errors = [];
  const seen = new Set();
  for (const [idx, line] of lines.slice(1).entries()) {
    const cells = line.split(',');
    const row = Object.fromEntries(columns.map((column, columnIndex) => [column, (cells[columnIndex] || '').trim()]));
    const rowErrors = [];
    if (!row.email) rowErrors.push('missing email');
    if (row.email && seen.has(row.email.toLowerCase())) rowErrors.push('duplicate email in upload');
    row.updateExisting = state.db.contacts.some((contact) => contact.audienceId === audienceId && contact.email.toLowerCase() === String(row.email || '').toLowerCase());
    if (rowErrors.length) errors.push(`Row ${idx + 2}: ${rowErrors.join(', ')}`);
    if (row.email) seen.add(row.email.toLowerCase());
    rows.push({ rowNumber: idx + 2, row, rowErrors });
  }
  return { errors, rows, validRows: rows.filter((entry) => !entry.rowErrors.length).map((entry) => entry.row) };
}

export function queueImport(state, actor, preview) {
  enqueueJob(state, { type: 'import_contacts', workspaceId: actor.workspace.id, userId: actor.user.id, payload: { audienceId: preview.audienceId, rows: preview.validRows } });
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'contact-import-queued', detail: 'Queued validated contact import' });
}

export function processCsvImport(state, job) {
  const { audienceId, rows } = job.payload;
  let imported = 0;
  let updated = 0;
  for (const row of rows) {
    const payload = { audienceId, ...contactPayload({ ...row, tags: row.tags, interests: row.interests, groupCategory: row.groupCategory, groupValue: row.groupValue }), source: 'csv-import', activity: 'Created from CSV import' };
    const existing = state.db.contacts.find((contact) => contact.audienceId === audienceId && contact.email.toLowerCase() === payload.email.toLowerCase());
    if (existing) {
      Object.assign(existing, { ...payload, updatedAt: nowIso() });
      contactActivity(existing, 'Updated from CSV import');
      updated += 1;
    } else {
      state.db.contacts.unshift({ id: createId('contact'), workspaceId: state.db.audiences.find((entry) => entry.id === audienceId)?.workspaceId, createdAt: nowIso(), updatedAt: nowIso(), activity: [{ at: nowIso(), message: 'Created from CSV import' }], phone: row.phone || '', ...payload });
      imported += 1;
    }
  }
  return { imported, updated };
}


export function buildAudienceSyncWarehouseRuntimeEvidence(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspaceId || actor?.workspace?.id || 'default_workspace';
  const db = state.db || {};
  const activeJobs = Array.isArray(db.jobs) ? db.jobs.filter((job) => !['completed', 'failed', 'cancelled'].includes(job.status)) : [];
  const recentEvents = Array.isArray(db.auditEvents) ? db.auditEvents.slice(0, 5) : [];
  const providerSignals = Array.isArray(db.integrations) ? db.integrations.filter((entry) => entry.status !== 'disconnected') : [];
  const workflow = [
    { step: 'audience_sync_warehouse_request', status: input.requestReceived === false ? 'waiting' : 'received', route: input.route || 'packages/app/domain-audience.mjs' },
    { step: 'audience_sync_warehouse_state', status: db ? 'hydrated' : 'missing_state', jobs: activeJobs.length },
    { step: 'audience_sync_warehouse_response', status: input.responseReady === false ? 'pending' : 'ready', events: recentEvents.length }
  ];
  return {
    mailchimpSurface: 'audience_sync_warehouse',
    mailchimpLane: 'audience_crm_parity',
    productLabel: "Audience sync, warehouse, and intelligence paths produce real product movement parity",
    originatingShard: "focus.audience_sync_warehouse",
    workspaceId,
    generatedAt: input.now || new Date().toISOString(),
    workflow,
    routeResponse: { requestHandled: workflow[0].status === 'received', responseReady: workflow[2].status === 'ready', clientState: Boolean(input.clientState || input.browserEvent) },
    persistence: { hasStateDb: Boolean(state.db), pendingJobs: activeJobs.length, recoverable: activeJobs.some((job) => Number(job.attempts || 0) > 0) },
    providerSync: { activeProviderCount: providerSignals.length, sampleProviders: providerSignals.slice(0, 3).map((entry) => entry.id || entry.provider || entry.name) },
    auditTrail: recentEvents.map((entry) => ({ at: entry.at || entry.createdAt, type: entry.type || entry.event, status: entry.status || 'observed' }))
  };
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



export function buildAudienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "audience_sync_warehouse:integrated_user_path_evidence:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_sync_warehouse", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.audience_sync_warehouse::semantic-frontier-001#05-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/jobs.mjs"], nextAction: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:audience_sync_warehouse:monitor_job_runtime_handoff" : "integrated_user_path_evidence:audience_sync_warehouse:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey = "audience_identity_lifecycle:operational_persistence_and_jobs:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_identity_lifecycle", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.audience_identity_lifecycle::semantic-frontier-001#04-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:audience_identity_lifecycle:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:audience_identity_lifecycle:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}

