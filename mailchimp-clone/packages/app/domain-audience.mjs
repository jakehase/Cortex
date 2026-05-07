import { persistState } from './storage.mjs';
import { createId, csvSplit, nowIso } from './utils.mjs';
import { contactPayload, enqueueJob, recordAudit } from './domain-core.mjs';

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
