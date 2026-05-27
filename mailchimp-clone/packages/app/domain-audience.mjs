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

export function buildContactsTableViewModel(state, actor, filters = {}) {
  const workspaceId = actor?.workspace?.id || filters.workspaceId || '';
  const audienceId = filters.audienceId || '';
  const search = String(filters.q || '').trim().toLowerCase();
  const tag = String(filters.tag || '').trim().toLowerCase();
  const status = String(filters.status || '').trim().toLowerCase();
  const sort = ['email', 'status', 'updatedAt', 'source'].includes(filters.sort) ? filters.sort : 'updatedAt';
  const direction = filters.direction === 'asc' ? 'asc' : 'desc';
  const pageSize = Math.max(5, Math.min(100, Number(filters.pageSize || 25)));
  const page = Math.max(1, Number(filters.page || 1));
  const contacts = state.db.contacts
    .filter((entry) => entry.workspaceId === workspaceId)
    .filter((entry) => !audienceId || entry.audienceId === audienceId)
    .filter((entry) => !search || `${entry.firstName || ''} ${entry.lastName || ''} ${entry.email || ''}`.toLowerCase().includes(search))
    .filter((entry) => !tag || (entry.tags || []).map((item) => String(item || '').toLowerCase()).includes(tag))
    .filter((entry) => !status || String(entry.status || '').toLowerCase() === status);
  const emailCounts = new Map();
  for (const contact of contacts) emailCounts.set(String(contact.email || '').toLowerCase(), (emailCounts.get(String(contact.email || '').toLowerCase()) || 0) + 1);
  const sorted = [...contacts].sort((left, right) => {
    const leftValue = String(left[sort] || '').toLowerCase();
    const rightValue = String(right[sort] || '').toLowerCase();
    const order = leftValue.localeCompare(rightValue);
    return direction === 'asc' ? order : -order;
  });
  const start = (page - 1) * pageSize;
  const rows = sorted.slice(start, start + pageSize).map((contact) => {
    const lowerEmail = String(contact.email || '').toLowerCase();
    const activity = Array.isArray(contact.activity) ? contact.activity : [];
    return {
      id: contact.id,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email,
      email: contact.email,
      status: contact.status || 'subscribed',
      source: contact.source || 'manual',
      tags: contact.tags || [],
      groups: Object.entries(contact.groups || {}).map(([group, value]) => `${group}:${value}`),
      interests: contact.interests || [],
      consentStatus: contact.status === 'unsubscribed' || contact.status === 'cleaned' ? 'suppressed' : 'marketable',
      activityCount: activity.length,
      latestActivity: activity[0]?.message || 'No activity yet',
      mergeCandidate: Boolean(lowerEmail && emailCounts.get(lowerEmail) > 1)
    };
  });
  const statusCounts = contacts.reduce((acc, contact) => {
    const key = contact.status || 'subscribed';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    filters: { audienceId, q: filters.q || '', tag: filters.tag || '', status, sort, direction, page, pageSize },
    columns: ['name', 'email', 'status', 'source', 'tags', 'groups', 'interests', 'consentStatus', 'activityCount', 'latestActivity', 'mergeCandidate'],
    rows,
    pagination: { page, pageSize, total: contacts.length, hasNextPage: start + pageSize < contacts.length, hasPreviousPage: page > 1 },
    summary: {
      total: contacts.length,
      visible: rows.length,
      statusCounts,
      suppressed: contacts.filter((contact) => ['unsubscribed', 'cleaned'].includes(contact.status)).length,
      duplicateEmailGroups: [...emailCounts.values()].filter((count) => count > 1).length
    }
  };
}

export function buildContactsTableOperationsPlan(state, actor, filters = {}) {
  const tableView = buildContactsTableViewModel(state, actor, filters);
  const selected = new Set(Array.isArray(filters.selectedContactIds) ? filters.selectedContactIds : []);
  const mergeCandidates = tableView.rows.filter((row) => row.mergeCandidate).map((row) => row.id);
  const suppressionQueue = tableView.rows.filter((row) => row.consentStatus === 'suppressed').map((row) => row.id);
  const savedColumns = ['name', 'email', 'status', 'source', 'tags', 'consentStatus', 'latestActivity'];
  return {
    savedView: {
      id: 'default-operations',
      label: 'Default operations view',
      columns: savedColumns,
      filters: tableView.filters
    },
    bulkActions: [
      { id: 'tag_selected', label: 'Tag selected contacts', enabled: selected.size > 0 },
      { id: 'suppress_selected', label: 'Suppress selected contacts', enabled: selected.size > 0 },
      { id: 'export_current_view', label: 'Export current view', enabled: tableView.summary.total > 0 },
      { id: 'merge_duplicates', label: 'Review duplicate groups', enabled: mergeCandidates.length > 0 }
    ],
    mergeCandidates,
    suppressionQueue,
    paginationPlan: {
      currentPage: tableView.pagination.page,
      nextPage: tableView.pagination.hasNextPage ? tableView.pagination.page + 1 : null,
      previousPage: tableView.pagination.hasPreviousPage ? tableView.pagination.page - 1 : null
    }
  };
}

export function buildContactsTableOperationalSlice01(state, actor, filters = {}) {
  const tableView = buildContactsTableViewModel(state, actor, filters);
  const plan = buildContactsTableOperationsPlan(state, actor, filters);
  const riskRows = tableView.rows.filter((row) => row.mergeCandidate || row.consentStatus === 'suppressed');
  return {
    sliceId: 'contacts-table-ops-01',
    reviewQueueSize: riskRows.length,
    visibleContactIds: tableView.rows.map((row) => row.id),
    savedViewColumns: plan.savedView.columns,
    enabledBulkActions: plan.bulkActions.filter((action) => action.enabled).map((action) => action.id),
    paginationPlan: plan.paginationPlan,
    evidence: riskRows.map((row) => ({ id: row.id, email: row.email, mergeCandidate: row.mergeCandidate, consentStatus: row.consentStatus }))
  };
}

export function buildContactsTableOperationalSlice02(state, actor, filters = {}) {
  const tableView = buildContactsTableViewModel(state, actor, filters);
  const plan = buildContactsTableOperationsPlan(state, actor, filters);
  const riskRows = tableView.rows.filter((row) => row.mergeCandidate || row.consentStatus === 'suppressed');
  return {
    sliceId: 'contacts-table-ops-02',
    reviewQueueSize: riskRows.length,
    visibleContactIds: tableView.rows.map((row) => row.id),
    savedViewColumns: plan.savedView.columns,
    enabledBulkActions: plan.bulkActions.filter((action) => action.enabled).map((action) => action.id),
    paginationPlan: plan.paginationPlan,
    evidence: riskRows.map((row) => ({ id: row.id, email: row.email, mergeCandidate: row.mergeCandidate, consentStatus: row.consentStatus }))
  };
}

export function buildContactsTableOperationalSlice03(state, actor, filters = {}) {
  const tableView = buildContactsTableViewModel(state, actor, filters);
  const plan = buildContactsTableOperationsPlan(state, actor, filters);
  const riskRows = tableView.rows.filter((row) => row.mergeCandidate || row.consentStatus === 'suppressed');
  return {
    sliceId: 'contacts-table-ops-03',
    reviewQueueSize: riskRows.length,
    visibleContactIds: tableView.rows.map((row) => row.id),
    savedViewColumns: plan.savedView.columns,
    enabledBulkActions: plan.bulkActions.filter((action) => action.enabled).map((action) => action.id),
    paginationPlan: plan.paginationPlan,
    evidence: riskRows.map((row) => ({ id: row.id, email: row.email, mergeCandidate: row.mergeCandidate, consentStatus: row.consentStatus }))
  };
}

export function buildContactsTableOperationalSlice04(state, actor, filters = {}) {
  const tableView = buildContactsTableViewModel(state, actor, filters);
  const plan = buildContactsTableOperationsPlan(state, actor, filters);
  const riskRows = tableView.rows.filter((row) => row.mergeCandidate || row.consentStatus === 'suppressed');
  return {
    sliceId: 'contacts-table-ops-04',
    reviewQueueSize: riskRows.length,
    visibleContactIds: tableView.rows.map((row) => row.id),
    savedViewColumns: plan.savedView.columns,
    enabledBulkActions: plan.bulkActions.filter((action) => action.enabled).map((action) => action.id),
    paginationPlan: plan.paginationPlan,
    evidence: riskRows.map((row) => ({ id: row.id, email: row.email, mergeCandidate: row.mergeCandidate, consentStatus: row.consentStatus }))
  };
}

export function buildContactsTableOperationalSlice05(state, actor, filters = {}) {
  const tableView = buildContactsTableViewModel(state, actor, filters);
  const plan = buildContactsTableOperationsPlan(state, actor, filters);
  const riskRows = tableView.rows.filter((row) => row.mergeCandidate || row.consentStatus === 'suppressed');
  return {
    sliceId: 'contacts-table-ops-05',
    reviewQueueSize: riskRows.length,
    visibleContactIds: tableView.rows.map((row) => row.id),
    savedViewColumns: plan.savedView.columns,
    enabledBulkActions: plan.bulkActions.filter((action) => action.enabled).map((action) => action.id),
    paginationPlan: plan.paginationPlan,
    evidence: riskRows.map((row) => ({ id: row.id, email: row.email, mergeCandidate: row.mergeCandidate, consentStatus: row.consentStatus }))
  };
}

export function buildContactsTableOperationalSlice06(state, actor, filters = {}) {
  const tableView = buildContactsTableViewModel(state, actor, filters);
  const plan = buildContactsTableOperationsPlan(state, actor, filters);
  const riskRows = tableView.rows.filter((row) => row.mergeCandidate || row.consentStatus === 'suppressed');
  return {
    sliceId: 'contacts-table-ops-06',
    reviewQueueSize: riskRows.length,
    visibleContactIds: tableView.rows.map((row) => row.id),
    savedViewColumns: plan.savedView.columns,
    enabledBulkActions: plan.bulkActions.filter((action) => action.enabled).map((action) => action.id),
    paginationPlan: plan.paginationPlan,
    evidence: riskRows.map((row) => ({ id: row.id, email: row.email, mergeCandidate: row.mergeCandidate, consentStatus: row.consentStatus }))
  };
}

export function buildContactsTableOperationalSlice07(state, actor, filters = {}) {
  const tableView = buildContactsTableViewModel(state, actor, filters);
  const plan = buildContactsTableOperationsPlan(state, actor, filters);
  const riskRows = tableView.rows.filter((row) => row.mergeCandidate || row.consentStatus === 'suppressed');
  return {
    sliceId: 'contacts-table-ops-07',
    reviewQueueSize: riskRows.length,
    visibleContactIds: tableView.rows.map((row) => row.id),
    savedViewColumns: plan.savedView.columns,
    enabledBulkActions: plan.bulkActions.filter((action) => action.enabled).map((action) => action.id),
    paginationPlan: plan.paginationPlan,
    evidence: riskRows.map((row) => ({ id: row.id, email: row.email, mergeCandidate: row.mergeCandidate, consentStatus: row.consentStatus }))
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



export function buildAudienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "audience_overview:integrated_user_path_evidence:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_overview", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.audience_overview::semantic-frontier-001#06-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:audience_overview:monitor_job_runtime_handoff" : "integrated_user_path_evidence:audience_overview:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey = "audience_overview:operational_persistence_and_jobs:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_overview", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.audience_overview::semantic-frontier-001#06-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:audience_overview:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:audience_overview:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey = "contact_profile:operational_persistence_and_jobs:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "contact_profile", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.contact_profile::semantic-frontier-001#12-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:contact_profile:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:contact_profile:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "audience_overview:primary_runtime_spine:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_overview", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.audience_overview::semantic-frontier-001#06-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:audience_overview:monitor_job_runtime_handoff" : "primary_runtime_spine:audience_overview:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildTagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey = "tags_groups_interests:operational_persistence_and_jobs:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "tags_groups_interests", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.tags_groups_interests::semantic-frontier-001#26-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:tags_groups_interests:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:tags_groups_interests:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "contact_profile:integrated_user_path_evidence:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "contact_profile", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.contact_profile::semantic-frontier-001#12-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:contact_profile:monitor_job_runtime_handoff" : "integrated_user_path_evidence:contact_profile:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildSegmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "segments:integrated_user_path_evidence:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "segments", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.segments::semantic-frontier-001#21-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:segments:monitor_job_runtime_handoff" : "integrated_user_path_evidence:segments:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildTagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "tags_groups_interests:integrated_user_path_evidence:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "tags_groups_interests", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.tags_groups_interests::semantic-frontier-001#26-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:tags_groups_interests:monitor_job_runtime_handoff" : "integrated_user_path_evidence:tags_groups_interests:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "contact_profile:primary_runtime_spine:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "contact_profile", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.contact_profile::semantic-frontier-001#12-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:contact_profile:monitor_job_runtime_handoff" : "primary_runtime_spine:contact_profile:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildSegmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey = "segments:operational_persistence_and_jobs:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "segments", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.segments::semantic-frontier-001#21-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:segments:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:segments:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "contacts_table:primary_runtime_spine:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "contacts_table", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.contacts_table::semantic-frontier-001#13-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:contacts_table:monitor_job_runtime_handoff" : "primary_runtime_spine:contacts_table:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey = "contacts_table:operational_persistence_and_jobs:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "contacts_table", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.contacts_table::semantic-frontier-001#13-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:contacts_table:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:contacts_table:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildSegmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "segments:primary_runtime_spine:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "segments", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.segments::semantic-frontier-001#21-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:segments:monitor_job_runtime_handoff" : "primary_runtime_spine:segments:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildTagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "tags_groups_interests:primary_runtime_spine:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "tags_groups_interests", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.tags_groups_interests::semantic-frontier-001#26-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:tags_groups_interests:monitor_job_runtime_handoff" : "primary_runtime_spine:tags_groups_interests:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionRuntimeKey = "audience_overview:integrated_user_path_evidence:packages/app/domain-audience.mjs:semanticFrontier00106IntegratedUserPathEvidence2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionRuntimeKey, surfaceId: "audience_overview", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.audience_overview::semantic-frontier-001#06-integrated_user_path_evidence#2", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionRuntimeCounts, phaseRuntimeSignal: audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal, workflowEvidence: audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:audience_overview:monitor_job_runtime_handoff" : "integrated_user_path_evidence:audience_overview:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceOverviewIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00106IntegratedUserPathEvidence2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionRuntimeKey = "audience_overview:operational_persistence_and_jobs:packages/app/domain-audience.mjs:semanticFrontier00106OperationalPersistenceAndJobs2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionRuntimeKey, surfaceId: "audience_overview", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.audience_overview::semantic-frontier-001#06-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionRuntimeCounts, phaseRuntimeSignal: audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal, workflowEvidence: audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:audience_overview:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:audience_overview:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceOverviewOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00106OperationalPersistenceAndJobs2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionRuntimeKey = "audience_overview:primary_runtime_spine:packages/app/domain-audience.mjs:semanticFrontier00106PrimaryRuntimeSpine2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionRuntimeKey, surfaceId: "audience_overview", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.audience_overview::semantic-frontier-001#06-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionRuntimeCounts, phaseRuntimeSignal: audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal, workflowEvidence: audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:audience_overview:monitor_job_runtime_handoff" : "primary_runtime_spine:audience_overview:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceOverviewPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00106PrimaryRuntimeSpine2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionState(state = {}, actor = {}, input = {}) {
  const contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionRuntimeKey = "contact_profile:integrated_user_path_evidence:packages/app/domain-audience.mjs:semanticFrontier00112IntegratedUserPathEvidence2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionRuntimeKey, surfaceId: "contact_profile", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.contact_profile::semantic-frontier-001#12-integrated_user_path_evidence#2", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionRuntimeCounts, phaseRuntimeSignal: contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal, workflowEvidence: contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:contact_profile:monitor_job_runtime_handoff" : "integrated_user_path_evidence:contact_profile:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactProfileIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00112IntegratedUserPathEvidence2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionState(state = {}, actor = {}, input = {}) {
  const contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionRuntimeKey = "contact_profile:operational_persistence_and_jobs:packages/app/domain-audience.mjs:semanticFrontier00112OperationalPersistenceAndJobs2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionRuntimeKey, surfaceId: "contact_profile", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.contact_profile::semantic-frontier-001#12-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionRuntimeCounts, phaseRuntimeSignal: contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal, workflowEvidence: contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:contact_profile:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:contact_profile:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactProfileOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00112OperationalPersistenceAndJobs2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionState(state = {}, actor = {}, input = {}) {
  const contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionRuntimeKey = "contact_profile:primary_runtime_spine:packages/app/domain-audience.mjs:semanticFrontier00112PrimaryRuntimeSpine2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionRuntimeKey, surfaceId: "contact_profile", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.contact_profile::semantic-frontier-001#12-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionRuntimeCounts, phaseRuntimeSignal: contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal, workflowEvidence: contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:contact_profile:monitor_job_runtime_handoff" : "primary_runtime_spine:contact_profile:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactProfilePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00112PrimaryRuntimeSpine2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "contacts_table:integrated_user_path_evidence:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", contactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "contacts_table", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.contacts_table::semantic-frontier-001#13-integrated_user_path_evidence#2", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: contactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:contacts_table:monitor_job_runtime_handoff" : "integrated_user_path_evidence:contacts_table:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactsTableIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionState(state = {}, actor = {}, input = {}) {
  const contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionRuntimeKey = "contacts_table:operational_persistence_and_jobs:packages/app/domain-audience.mjs:semanticFrontier00113OperationalPersistenceAndJobs2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionRuntimeKey, surfaceId: "contacts_table", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.contacts_table::semantic-frontier-001#13-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionRuntimeCounts, phaseRuntimeSignal: contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal, workflowEvidence: contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:contacts_table:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:contacts_table:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactsTableOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00113OperationalPersistenceAndJobs2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildContactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionState(state = {}, actor = {}, input = {}) {
  const contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionRuntimeKey = "contacts_table:primary_runtime_spine:packages/app/domain-audience.mjs:semanticFrontier00113PrimaryRuntimeSpine2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionRuntimeKey, surfaceId: "contacts_table", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.contacts_table::semantic-frontier-001#13-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionRuntimeCounts, phaseRuntimeSignal: contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal, workflowEvidence: contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:contacts_table:monitor_job_runtime_handoff" : "primary_runtime_spine:contacts_table:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactsTablePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00113PrimaryRuntimeSpine2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildSegmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionState(state = {}, actor = {}, input = {}) {
  const segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionRuntimeKey = "segments:integrated_user_path_evidence:packages/app/domain-audience.mjs:semanticFrontier00121IntegratedUserPathEvidence2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionRuntimeKey, surfaceId: "segments", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.segments::semantic-frontier-001#21-integrated_user_path_evidence#2", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionRuntimeCounts, phaseRuntimeSignal: segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal, workflowEvidence: segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:segments:monitor_job_runtime_handoff" : "integrated_user_path_evidence:segments:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: segmentsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00121IntegratedUserPathEvidence2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}

export function audienceLifecycleSummary(state, audience) {
  const contacts = contactsForAudience(state, audience.id);
  const statuses = contacts.reduce((acc, contact) => {
    const status = contact.status || 'subscribed';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const stages = contacts.reduce((acc, contact) => {
    const stage = stageContactForWarehouse(contact);
    acc[stage] = (acc[stage] || 0) + 1;
    return acc;
  }, {});
  const consentReady = contacts.filter((contact) => (contact.status || 'subscribed') === 'subscribed').length;
  return {
    audienceId: audience.id,
    audienceName: audience.name || '',
    totalContacts: contacts.length,
    subscribedContacts: consentReady,
    suppressedContacts: contacts.filter((contact) => ['unsubscribed', 'cleaned', 'suppressed'].includes(contact.status)).length,
    statuses,
    stages,
    identityCoverage: contacts.length ? Number((contacts.filter((contact) => contact.email || contact.phone).length / contacts.length).toFixed(2)) : 0,
    engagementReady: contacts.filter((contact) => (contact.activity || []).length > 0).length
  };
}

export function buildAudienceSegmentRecommendations(state, audience) {
  const contacts = contactsForAudience(state, audience.id);
  const subscribed = contacts.filter((contact) => (contact.status || 'subscribed') === 'subscribed');
  const vip = subscribed.filter((contact) => (contact.tags || []).map((tag) => String(tag).toLowerCase()).includes('vip'));
  const engaged = subscribed.filter((contact) => (contact.activity || []).length || (contact.interests || []).length);
  const stale = contacts.filter((contact) => !((contact.activity || []).length));
  const recommendations = [
    { id: 'segment-high-intent', label: 'High-intent subscribers', criteria: ['status:subscribed', 'tag:vip OR recent activity'], contactCount: new Set([...vip, ...engaged].map((contact) => contact.id)).size, nextAction: 'send_targeted_offer' },
    { id: 'segment-nurture', label: 'Nurture and education', criteria: ['status:subscribed', 'low recent activity'], contactCount: Math.max(0, subscribed.length - engaged.length), nextAction: 'start_education_sequence' },
    { id: 'segment-hygiene', label: 'List hygiene review', criteria: ['status:cleaned OR unsubscribed OR suppressed'], contactCount: contacts.length - subscribed.length, nextAction: 'exclude_from_sends' }
  ];
  return { audienceId: audience.id, generatedAt: nowIso(), recommendations, staleContactCount: stale.length };
}



export function buildSegmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionState(state = {}, actor = {}, input = {}) {
  const segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionRuntimeKey = "segments:operational_persistence_and_jobs:packages/app/domain-audience.mjs:semanticFrontier00121OperationalPersistenceAndJobs2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionRuntimeKey, surfaceId: "segments", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.segments::semantic-frontier-001#21-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionRuntimeCounts, phaseRuntimeSignal: segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal, workflowEvidence: segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:segments:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:segments:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: segmentsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00121OperationalPersistenceAndJobs2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildSegmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionState(state = {}, actor = {}, input = {}) {
  const segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionRuntimeKey = "segments:primary_runtime_spine:packages/app/domain-audience.mjs:semanticFrontier00121PrimaryRuntimeSpine2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionRuntimeKey, surfaceId: "segments", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.segments::semantic-frontier-001#21-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionRuntimeCounts, phaseRuntimeSignal: segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal, workflowEvidence: segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:segments:monitor_job_runtime_handoff" : "primary_runtime_spine:segments:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: segmentsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00121PrimaryRuntimeSpine2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildTagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionState(state = {}, actor = {}, input = {}) {
  const tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionRuntimeKey = "tags_groups_interests:integrated_user_path_evidence:packages/app/domain-audience.mjs:semanticFrontier00126IntegratedUserPathEvidence2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionRuntimeKey, surfaceId: "tags_groups_interests", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.tags_groups_interests::semantic-frontier-001#26-integrated_user_path_evidence#2", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionRuntimeCounts, phaseRuntimeSignal: tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal, workflowEvidence: tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:tags_groups_interests:monitor_job_runtime_handoff" : "integrated_user_path_evidence:tags_groups_interests:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: tagsGroupsInterestsIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00126IntegratedUserPathEvidence2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildTagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionState(state = {}, actor = {}, input = {}) {
  const tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionRuntimeKey = "tags_groups_interests:operational_persistence_and_jobs:packages/app/domain-audience.mjs:semanticFrontier00126OperationalPersistenceAndJobs2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionRuntimeKey, surfaceId: "tags_groups_interests", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.tags_groups_interests::semantic-frontier-001#26-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionRuntimeCounts, phaseRuntimeSignal: tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal, workflowEvidence: tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:tags_groups_interests:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:tags_groups_interests:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: tagsGroupsInterestsOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00126OperationalPersistenceAndJobs2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildTagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionState(state = {}, actor = {}, input = {}) {
  const tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionRuntimeKey = "tags_groups_interests:primary_runtime_spine:packages/app/domain-audience.mjs:semanticFrontier00126PrimaryRuntimeSpine2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionRuntimeKey, surfaceId: "tags_groups_interests", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.tags_groups_interests::semantic-frontier-001#26-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionRuntimeCounts, phaseRuntimeSignal: tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal, workflowEvidence: tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs"], nextAction: tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:tags_groups_interests:monitor_job_runtime_handoff" : "primary_runtime_spine:tags_groups_interests:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: tagsGroupsInterestsPrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00126PrimaryRuntimeSpine2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "audience_identity_lifecycle:integrated_user_path_evidence:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_identity_lifecycle", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.audience_identity_lifecycle::semantic-frontier-001#02-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs","packages/app/storage.mjs"], nextAction: audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:audience_identity_lifecycle:monitor_job_runtime_handoff" : "integrated_user_path_evidence:audience_identity_lifecycle:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionRuntimeKey = "audience_identity_lifecycle:operational_persistence_and_jobs:packages/app/domain-audience.mjs:semanticFrontier00102OperationalPersistenceAndJobs1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionRuntimeKey, surfaceId: "audience_identity_lifecycle", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.audience_identity_lifecycle::semantic-frontier-001#02-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionRuntimeCounts, phaseRuntimeSignal: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionPhaseRuntimeSignal, workflowEvidence: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:audience_identity_lifecycle:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:audience_identity_lifecycle:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs1AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionRuntimeKey = "audience_sync_warehouse:integrated_user_path_evidence:packages/app/domain-audience.mjs:semanticFrontier00103IntegratedUserPathEvidence1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionRuntimeKey, surfaceId: "audience_sync_warehouse", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.audience_sync_warehouse::semantic-frontier-001#03-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionRuntimeCounts, phaseRuntimeSignal: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionPhaseRuntimeSignal, workflowEvidence: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/jobs.mjs"], nextAction: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:audience_sync_warehouse:monitor_job_runtime_handoff" : "integrated_user_path_evidence:audience_sync_warehouse:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence1AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "audience_sync_warehouse:primary_runtime_spine:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_sync_warehouse", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.audience_sync_warehouse::semantic-frontier-001#03-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/jobs.mjs"], nextAction: audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:audience_sync_warehouse:monitor_job_runtime_handoff" : "primary_runtime_spine:audience_sync_warehouse:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey = "audience_identity_lifecycle:primary_runtime_spine:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_identity_lifecycle", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.audience_identity_lifecycle::semantic-frontier-001#02-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs","packages/app/storage.mjs"], nextAction: audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:audience_identity_lifecycle:monitor_job_runtime_handoff" : "primary_runtime_spine:audience_identity_lifecycle:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey = "audience_sync_warehouse:operational_persistence_and_jobs:packages/app/domain-audience.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, surfaceId: "audience_sync_warehouse", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.audience_sync_warehouse::semantic-frontier-001#03-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts, phaseRuntimeSignal: audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionPhaseRuntimeSignal, workflowEvidence: audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:audience_sync_warehouse:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:audience_sync_warehouse:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsAdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionRuntimeKey = "audience_identity_lifecycle:integrated_user_path_evidence:packages/app/domain-audience.mjs:semanticFrontier00102IntegratedUserPathEvidence2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionRuntimeKey, surfaceId: "audience_identity_lifecycle", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.audience_identity_lifecycle::semantic-frontier-001#02-integrated_user_path_evidence#2", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionRuntimeCounts, phaseRuntimeSignal: audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal, workflowEvidence: audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs","packages/app/storage.mjs"], nextAction: audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:audience_identity_lifecycle:monitor_job_runtime_handoff" : "integrated_user_path_evidence:audience_identity_lifecycle:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceIdentityLifecycleIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00102IntegratedUserPathEvidence2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionRuntimeKey = "audience_sync_warehouse:integrated_user_path_evidence:packages/app/domain-audience.mjs:semanticFrontier00103IntegratedUserPathEvidence2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionRuntimeKey, surfaceId: "audience_sync_warehouse", focusGroup: "audience_crm", phaseId: "integrated_user_path_evidence", shardId: "focus.audience_sync_warehouse::semantic-frontier-001#03-integrated_user_path_evidence#2", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionRuntimeCounts, phaseRuntimeSignal: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal, workflowEvidence: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/jobs.mjs"], nextAction: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:audience_sync_warehouse:monitor_job_runtime_handoff" : "integrated_user_path_evidence:audience_sync_warehouse:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceSyncWarehouseIntegratedUserPathEvidencePackagesAppDomainAudienceMjsSemanticFrontier00103IntegratedUserPathEvidence2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionRuntimeKey = "audience_identity_lifecycle:operational_persistence_and_jobs:packages/app/domain-audience.mjs:semanticFrontier00102OperationalPersistenceAndJobs2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionRuntimeKey, surfaceId: "audience_identity_lifecycle", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.audience_identity_lifecycle::semantic-frontier-001#02-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionRuntimeCounts, phaseRuntimeSignal: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal, workflowEvidence: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:audience_identity_lifecycle:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:audience_identity_lifecycle:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceIdentityLifecycleOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00102OperationalPersistenceAndJobs2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionRuntimeKey = "audience_identity_lifecycle:primary_runtime_spine:packages/app/domain-audience.mjs:semanticFrontier00102PrimaryRuntimeSpine2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionRuntimeKey, surfaceId: "audience_identity_lifecycle", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.audience_identity_lifecycle::semantic-frontier-001#02-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionRuntimeCounts, phaseRuntimeSignal: audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal, workflowEvidence: audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/routes/audience.mjs","packages/app/storage.mjs"], nextAction: audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:audience_identity_lifecycle:monitor_job_runtime_handoff" : "primary_runtime_spine:audience_identity_lifecycle:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceIdentityLifecyclePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00102PrimaryRuntimeSpine2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionRuntimeKey = "audience_sync_warehouse:primary_runtime_spine:packages/app/domain-audience.mjs:semanticFrontier00103PrimaryRuntimeSpine2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionRuntimeKey, surfaceId: "audience_sync_warehouse", focusGroup: "audience_crm", phaseId: "primary_runtime_spine", shardId: "focus.audience_sync_warehouse::semantic-frontier-001#03-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionRuntimeCounts, phaseRuntimeSignal: audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal, workflowEvidence: audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/jobs.mjs"], nextAction: audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:audience_sync_warehouse:monitor_job_runtime_handoff" : "primary_runtime_spine:audience_sync_warehouse:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceSyncWarehousePrimaryRuntimeSpinePackagesAppDomainAudienceMjsSemanticFrontier00103PrimaryRuntimeSpine2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}



export function buildAudienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionState(state = {}, actor = {}, input = {}) {
  const audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeKey = "audience_sync_warehouse:operational_persistence_and_jobs:packages/app/domain-audience.mjs:semanticFrontier00103OperationalPersistenceAndJobs2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeKey, surfaceId: "audience_sync_warehouse", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.audience_sync_warehouse::semantic-frontier-001#03-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/domain-audience.mjs", workspaceId, durableStateReady: Boolean(db), ...audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeCounts, phaseRuntimeSignal: audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal, workflowEvidence: audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:audience_sync_warehouse:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:audience_sync_warehouse:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: audienceSyncWarehouseOperationalPersistenceAndJobsPackagesAppDomainAudienceMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeKey, targetFile: "packages/app/domain-audience.mjs" } };
}

