import { saveDb } from './storage.mjs';
import { createId, nowIso } from './utils.mjs';
import { createNotification, recordAudit, recordEvent } from './domain-core.mjs';
import { contactActivity, contactsForAudience } from './domain-audience.mjs';

export const AUTOMATION_TRIGGERS = [
  { id: 'contact_subscribed', label: 'Contact subscribes' },
  { id: 'form_submitted', label: 'Hosted form submitted' },
  { id: 'campaign_sent', label: 'Campaign sent' }
];

function ensureAutomationReport(automation) {
  automation.report ||= {};
  automation.report.enrolled ||= 0;
  automation.report.completed ||= 0;
  automation.report.exits ||= 0;
  automation.report.byTrigger ||= {};
  automation.report.history ||= [];
  automation.report.recentRuns ||= [];
  return automation.report;
}

function automationSourceMatches(automation, context) {
  if (automation.trigger === 'form_submitted' && automation.sourceFormId && automation.sourceFormId !== context.formId) return false;
  if (automation.trigger === 'campaign_sent' && automation.sourceCampaignId && automation.sourceCampaignId !== context.campaignId) return false;
  return true;
}

function hasRunForContact(state, automation, contact, eventType, context) {
  const policy = automation.reentryPolicy || 'once_per_contact';
  if (policy === 'always') return false;
  return state.db.automationRuns.some((run) => run.automationId === automation.id
    && run.contactId === contact.id
    && run.trigger === eventType
    && (!context.formId || run.formId === context.formId)
    && (!context.campaignId || run.campaignId === context.campaignId));
}

function buildRunLifecycle(automation, context) {
  const steps = automation.nodes.map((node, index) => ({
    order: index + 1,
    nodeId: node.id,
    type: node.type,
    title: node.title,
    status: node.type === 'delay' ? 'wait_scheduled' : 'completed'
  }));
  const completedAt = nowIso();
  return {
    status: 'completed',
    steps,
    goalReached: Boolean(automation.goal && (context.eventType === 'form_submitted' || context.eventType === 'campaign_sent')),
    exitReason: automation.goal ? `Reached goal: ${automation.goal}` : 'Journey completed',
    completedAt
  };
}

export function workspaceSummary(state, workspaceId) {
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId);
  const automations = state.db.automations.filter((entry) => entry.workspaceId === workspaceId);
  const forms = state.db.forms.filter((entry) => entry.workspaceId === workspaceId);
  const landingPages = state.db.landingPages.filter((entry) => entry.workspaceId === workspaceId);
  const contacts = state.db.contacts.filter((entry) => entry.workspaceId === workspaceId);
  return { audiences: state.db.audiences.filter((entry) => entry.workspaceId === workspaceId).length, contacts: contacts.length, subscribed: contacts.filter((entry) => entry.status === 'subscribed').length, unsubscribed: contacts.filter((entry) => entry.status === 'unsubscribed').length, campaigns: campaigns.length, sentCampaigns: campaigns.filter((entry) => entry.status === 'sent').length, scheduledCampaigns: campaigns.filter((entry) => entry.status === 'scheduled').length, automations: automations.length, liveAutomations: automations.filter((entry) => entry.status === 'live').length, forms: forms.length, publishedForms: forms.filter((entry) => entry.status === 'published').length, landingPages: landingPages.length, publishedLandingPages: landingPages.filter((entry) => entry.status === 'published').length, jobs: state.db.jobs.filter((entry) => entry.workspaceId === workspaceId).length, notifications: state.db.notifications.filter((entry) => entry.workspaceId === workspaceId).length };
}

export function createAutomation(state, actor, body) {
  const automation = {
    id: createId('journey'),
    workspaceId: actor.workspace.id,
    audienceId: body.audienceId || '',
    segmentId: body.segmentId || '',
    name: body.name,
    trigger: body.trigger || '',
    sourceFormId: body.sourceFormId || '',
    sourceCampaignId: body.sourceCampaignId || '',
    goal: body.goal || '',
    reentryPolicy: body.reentryPolicy || 'once_per_contact',
    status: 'draft',
    validationErrors: [],
    nodes: [],
    report: { enrolled: 0, completed: 0, exits: 0, byTrigger: {}, history: [], recentRuns: [] },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.db.automations.unshift(automation);
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'automation-create', detail: `Created automation ${automation.name}` });
  return automation;
}

export function validateAutomation(state, automation) {
  const errors = [];
  if (!automation.trigger) errors.push('Journey trigger is required.');
  if (!automation.audienceId) errors.push('Audience selection is required.');
  if (!automation.nodes.length) errors.push('Add at least one journey node.');
  if (automation.trigger === 'form_submitted' && !automation.sourceFormId) errors.push('Select a source form for form-submitted journeys.');
  if (automation.trigger === 'campaign_sent' && !automation.sourceCampaignId) errors.push('Select a source campaign for campaign-triggered journeys.');
  for (const node of automation.nodes) {
    if (node.type === 'delay' && !node.delayHours) errors.push(`Delay node ${node.id} requires delayHours.`);
    if (node.type === 'branch' && (!node.conditions || !node.conditions.length)) errors.push(`Branch node ${node.id} requires at least one branch condition.`);
    if (node.type === 'email' && !node.title) errors.push(`Email node ${node.id} requires a title.`);
  }
  automation.validationErrors = errors;
  automation.status = errors.length ? 'broken' : automation.status === 'broken' ? 'draft' : automation.status;
  automation.updatedAt = nowIso();
  saveDb(state.db);
  return errors;
}

export function createForm(state, actor, body) {
  const form = { id: createId('form'), workspaceId: actor.workspace.id, audienceId: body.audienceId, campaignId: body.campaignId || '', name: body.name, slug: body.slug || createId('signup').replace('signup_', 'signup-'), status: 'draft', fields: [{ id: createId('field'), name: 'email', label: 'Email', required: true }], successMessage: 'Thanks for signing up.', tagsOnSubmit: body.tagsOnSubmit ? String(body.tagsOnSubmit).split(',').map((entry) => entry.trim()).filter(Boolean) : [], submissions: 0, createdAt: nowIso(), updatedAt: nowIso() };
  state.db.forms.unshift(form);
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'form-create', detail: `Created form ${form.name}` });
  return form;
}

export function createLandingPage(state, actor, body) {
  const page = { id: createId('lp'), workspaceId: actor.workspace.id, audienceId: body.audienceId || '', campaignId: body.campaignId || '', formId: body.formId || '', name: body.name, slug: body.slug || createId('landing').replace('landing_', 'landing-'), headline: body.headline || '', body: body.body || '', status: 'draft', views: 0, submissions: 0, createdAt: nowIso(), updatedAt: nowIso() };
  state.db.landingPages.unshift(page);
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'landing-page-create', detail: `Created landing page ${page.name}` });
  return page;
}

export function triggerAutomationEvent(state, automation, contact, context = {}) {
  if (!automation || automation.status !== 'live' || !contact) return null;
  if (automation.audienceId && automation.audienceId !== contact.audienceId) return null;
  const eventType = context.eventType || automation.trigger;
  if (automation.trigger !== eventType) return null;
  if (!automationSourceMatches(automation, context)) return null;
  if (hasRunForContact(state, automation, contact, eventType, context)) return null;

  const enteredAt = nowIso();
  const lifecycle = buildRunLifecycle(automation, { ...context, eventType });
  const run = {
    id: createId('arun'),
    workspaceId: automation.workspaceId,
    automationId: automation.id,
    contactId: contact.id,
    audienceId: automation.audienceId,
    trigger: eventType,
    formId: context.formId || '',
    campaignId: context.campaignId || '',
    enteredAt,
    completedAt: lifecycle.completedAt,
    status: lifecycle.status,
    goalReached: lifecycle.goalReached,
    exitReason: lifecycle.exitReason,
    steps: lifecycle.steps,
    meta: context.meta || {}
  };
  state.db.automationRuns.unshift(run);

  const report = ensureAutomationReport(automation);
  report.enrolled += 1;
  report.completed += 1;
  report.byTrigger[eventType] = (report.byTrigger[eventType] || 0) + 1;
  report.lastTriggeredAt = enteredAt;
  report.lastTriggeredContactId = contact.id;
  report.lastTriggeredFormId = context.formId || '';
  report.lastTriggeredCampaignId = context.campaignId || '';
  report.recentRuns.unshift({ id: run.id, trigger: eventType, contactId: contact.id, formId: run.formId, campaignId: run.campaignId, completedAt: run.completedAt, goalReached: run.goalReached });
  report.recentRuns = report.recentRuns.slice(0, 10);
  report.history.unshift({ at: enteredAt, event: 'enrolled', trigger: eventType, contactId: contact.id, formId: run.formId, campaignId: run.campaignId, goalReached: run.goalReached });
  automation.updatedAt = nowIso();
  contactActivity(contact, `Entered automation ${automation.name} from ${eventType}`);
  createNotification(state, { workspaceId: automation.workspaceId, type: 'automation-enrollment', payload: { automationId: automation.id, contactId: contact.id, trigger: eventType } });
  recordEvent(state, { workspaceId: automation.workspaceId, type: 'automation-run', message: `${automation.name} enrolled ${contact.email}`, meta: { automationId: automation.id, contactId: contact.id, trigger: eventType } });
  saveDb(state.db);
  return run;
}

export function triggerAutomationsForEvent(state, { workspaceId, audienceId, contact, eventType, formId = '', campaignId = '', meta = {} }) {
  const runs = [];
  for (const automation of state.db.automations.filter((entry) => entry.workspaceId === workspaceId && entry.audienceId === audienceId && entry.status === 'live')) {
    const run = triggerAutomationEvent(state, automation, contact, { eventType, formId, campaignId, meta });
    if (run) runs.push(run);
  }
  return runs;
}

export function submitHostedForm(state, form, body) {
  const audience = state.db.audiences.find((entry) => entry.id === form.audienceId);
  const workspaceId = audience?.workspaceId;
  const existing = state.db.contacts.find((entry) => entry.audienceId === form.audienceId && entry.email.toLowerCase() === String(body.email || '').toLowerCase());
  let contact = existing;
  let created = false;
  if (!contact) {
    contact = { id: createId('contact'), workspaceId, audienceId: form.audienceId, firstName: body.firstName || '', lastName: body.lastName || '', email: body.email || '', status: 'subscribed', tags: [...new Set(form.tagsOnSubmit || [])], interests: [], groups: {}, notes: 'Created from hosted form', phone: '', source: 'form', createdAt: nowIso(), updatedAt: nowIso(), activity: [{ at: nowIso(), message: `Created from form ${form.name}` }] };
    state.db.contacts.unshift(contact);
    created = true;
  } else {
    contact.firstName ||= body.firstName || '';
    contact.lastName ||= body.lastName || '';
    contact.status = 'subscribed';
    contact.tags = [...new Set([...(contact.tags || []), ...(form.tagsOnSubmit || [])])];
    contact.updatedAt = nowIso();
    contactActivity(contact, `Submitted hosted form ${form.name}`);
  }
  form.submissions += 1;
  form.updatedAt = nowIso();
  const landingPages = state.db.landingPages.filter((entry) => entry.formId === form.id);
  for (const landing of landingPages) {
    landing.submissions += 1;
    landing.updatedAt = nowIso();
  }
  createNotification(state, { workspaceId, type: 'form-submission', payload: { formId: form.id, email: body.email || '' } });
  saveDb(state.db);
  if (created) triggerAutomationsForEvent(state, { workspaceId, audienceId: form.audienceId, contact, eventType: 'contact_subscribed', formId: form.id, campaignId: form.campaignId || '' });
  triggerAutomationsForEvent(state, { workspaceId, audienceId: form.audienceId, contact, eventType: 'form_submitted', formId: form.id, campaignId: form.campaignId || '', meta: { formName: form.name } });
  return contact;
}

export function analyticsSeries(state, workspaceId) {
  const contacts = state.db.contacts.filter((entry) => entry.workspaceId === workspaceId).length;
  const forms = state.db.forms.filter((entry) => entry.workspaceId === workspaceId).reduce((sum, entry) => sum + entry.submissions, 0);
  const sends = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId && entry.status === 'sent').length;
  return [
    { label: 'Audience growth', value: contacts },
    { label: 'Form submissions', value: forms },
    { label: 'Campaign sends', value: sends },
    { label: 'Automation enrollments', value: state.db.automations.filter((entry) => entry.workspaceId === workspaceId).reduce((sum, entry) => sum + (entry.report?.enrolled || 0), 0) }
  ];
}

export function campaignGrowthFunnel(state, campaignId) {
  const landingPages = state.db.landingPages.filter((entry) => entry.campaignId === campaignId);
  const linkedFormIds = new Set([
    ...state.db.forms.filter((entry) => entry.campaignId === campaignId).map((entry) => entry.id),
    ...landingPages.map((entry) => entry.formId).filter(Boolean)
  ]);
  const forms = state.db.forms.filter((entry) => linkedFormIds.has(entry.id));
  const automationRuns = state.db.automationRuns.filter((entry) => entry.campaignId === campaignId);
  return {
    landingPages: landingPages.length,
    landingViews: landingPages.reduce((sum, entry) => sum + entry.views, 0),
    landingSubmissions: landingPages.reduce((sum, entry) => sum + entry.submissions, 0),
    linkedForms: forms.length,
    formSubmissions: forms.reduce((sum, entry) => sum + entry.submissions, 0),
    attributedAutomationRuns: automationRuns.length,
    attributedAutomationGoals: automationRuns.filter((entry) => entry.goalReached).length
  };
}

export function automationRunSummary(state, automation) {
  const runs = state.db.automationRuns.filter((entry) => entry.automationId === automation.id);
  return {
    totalRuns: runs.length,
    completedRuns: runs.filter((entry) => entry.status === 'completed').length,
    formTriggeredRuns: runs.filter((entry) => entry.trigger === 'form_submitted').length,
    campaignTriggeredRuns: runs.filter((entry) => entry.trigger === 'campaign_sent').length,
    latestRuns: runs.slice(0, 8)
  };
}

export function publicPageView(state, page) {
  page.views += 1;
  page.updatedAt = nowIso();
  recordEvent(state, { workspaceId: page.workspaceId, type: 'landing-view', message: `${page.name} viewed`, meta: { pageId: page.id, campaignId: page.campaignId || '' } });
  saveDb(state.db);
}

export function updateAutomationLifecycle(state, actor, automation, nextStatus) {
  const previousStatus = automation.status;
  automation.status = nextStatus;
  automation.updatedAt = nowIso();
  const report = ensureAutomationReport(automation);
  report.history.unshift({ at: nowIso(), event: nextStatus === 'live' && previousStatus !== 'paused' ? 'published' : nextStatus, status: nextStatus });
  saveDb(state.db);
  if (nextStatus === 'live' && automation.trigger === 'contact_subscribed') {
    const contacts = contactsForAudience(state, automation.audienceId).filter((entry) => entry.status === 'subscribed');
    for (const contact of contacts) triggerAutomationEvent(state, automation, contact, { eventType: 'contact_subscribed', meta: { lifecycle: previousStatus === 'paused' ? 'resume' : 'publish' } });
  }
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: `automation-${nextStatus}`, detail: `${nextStatus} ${automation.name}` });
}
