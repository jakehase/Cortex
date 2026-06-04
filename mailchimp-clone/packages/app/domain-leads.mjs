import { persistState } from './storage.mjs';
import { createId, csvSplit, nowIso } from './utils.mjs';
import { createNotification, enqueueJob, recordAudit, recordEvent } from './domain-core.mjs';

export const LEAD_CAPTURE_CHANNELS = ['hosted', 'embedded', 'popup', 'modal', 'sms_opt_in', 'social_lead_ad'];

export const LEAD_CAPTURE_CONVERSION_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'lead_capture_landing_page_conversion_runtime_layer',
  label: 'Lead capture and landing-page conversion runtime',
  controls: [
    'landing_page_funnel_snapshot',
    'conversion_attribution_ledger',
    'consent_receipt_ledger',
    'landing_page_experiment_variants',
    'form_submission_handoff_evidence',
    'workspace_conversion_runtime_api'
  ],
  evidenceContract: [
    'views_to_submission_conversion_rates',
    'form_and_landing_page_attribution_events',
    'consent_receipts_for_submissions',
    'landing_page_experiment_payloads',
    'normal_lead_capture_route_adoption'
  ]
});

function csvValues(value, fallback = []) {
  const values = csvSplit(value || '');
  return values.length ? values : fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function ensureLeadCaptureRuntimeState(state) {
  state.db.leadConversionSnapshots ||= [];
  state.db.leadAttributionEvents ||= [];
  state.db.leadConsentReceipts ||= [];
  state.db.landingPageExperiments ||= [];
  return state;
}

function conversionRate(submissions, views) {
  return views > 0 ? Number(((Number(submissions || 0) / Number(views || 0)) * 100).toFixed(2)) : 0;
}

function parseScheduleDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function evaluateLeadCaptureDeliveryState(form, at = new Date()) {
  const config = form?.leadCapture || {};
  const schedule = config.schedule || {};
  const targeting = config.targeting || {};
  const readiness = validateLeadCaptureReadiness(form);
  const startsAt = parseScheduleDate(schedule.startsAt);
  const endsAt = parseScheduleDate(schedule.endsAt);
  const now = at instanceof Date ? at : new Date(at);
  const reasons = [];
  if (form?.status !== 'published') reasons.push('Form is not published.');
  if (!readiness.ok) reasons.push(...readiness.errors);
  if (schedule.startsAt && !startsAt) reasons.push('Schedule start is not a valid date.');
  if (schedule.endsAt && !endsAt) reasons.push('Schedule end is not a valid date.');
  if (startsAt && endsAt && startsAt > endsAt) reasons.push('Schedule end must be after schedule start.');
  if (startsAt && now < startsAt) reasons.push(`Scheduled to start at ${schedule.startsAt}.`);
  if (endsAt && now > endsAt) reasons.push(`Ended at ${schedule.endsAt}.`);
  if (targeting.frequencyCap === 'off') reasons.push('Frequency cap disables display.');
  const status = reasons.some((reason) => reason.startsWith('Scheduled to start')) ? 'scheduled'
    : reasons.some((reason) => reason.startsWith('Ended at')) ? 'expired'
      : reasons.length ? 'blocked'
        : 'active';
  return {
    status,
    reasons,
    eligibleChannels: config.channels || [],
    placementCount: (config.placements || []).length,
    audienceRuleCount: (targeting.audienceRules || []).length,
    suppressionTagCount: (targeting.suppressionTags || []).length,
    timezone: schedule.timezone || ''
  };
}

export function recordLeadAttributionEvent(state, payload = {}) {
  ensureLeadCaptureRuntimeState(state);
  const event = {
    id: createId('lattrib'),
    workspaceId: payload.workspaceId || '',
    formId: payload.formId || '',
    landingPageId: payload.landingPageId || '',
    campaignId: payload.campaignId || '',
    contactId: payload.contactId || '',
    eventType: payload.eventType || 'lead_capture_event',
    source: payload.source || 'hosted',
    referrer: payload.referrer || '',
    variantId: payload.variantId || '',
    occurredAt: nowIso(),
    meta: payload.meta || {}
  };
  state.db.leadAttributionEvents.unshift(event);
  state.db.leadAttributionEvents = state.db.leadAttributionEvents.slice(0, 500);
  return event;
}

export function recordLeadConsentReceipt(state, form, contact, body = {}) {
  ensureLeadCaptureRuntimeState(state);
  const receipt = {
    id: createId('lconsent'),
    workspaceId: form.workspaceId || contact?.workspaceId || '',
    formId: form.id,
    contactId: contact?.id || '',
    email: contact?.email || body.email || '',
    consentMode: form.leadCapture?.compliance?.consentMode || body.consentMode || 'express',
    doubleOptIn: Boolean(form.leadCapture?.compliance?.doubleOptIn),
    privacyNoticeUrl: form.leadCapture?.compliance?.privacyNoticeUrl || '',
    smsDisclosure: form.leadCapture?.compliance?.smsDisclosure || '',
    capturedAt: nowIso(),
    source: body.source || 'hosted_form'
  };
  state.db.leadConsentReceipts.unshift(receipt);
  state.db.leadConsentReceipts = state.db.leadConsentReceipts.slice(0, 500);
  return receipt;
}

export function createLandingPageExperimentVariant(state, actor, landingPage, body = {}) {
  ensureLeadCaptureRuntimeState(state);
  const experiment = {
    id: createId('lpexp'),
    workspaceId: actor.workspace.id,
    landingPageId: landingPage.id,
    formId: landingPage.formId || body.formId || '',
    campaignId: landingPage.campaignId || body.campaignId || '',
    status: 'draft',
    name: body.name || `${landingPage.name} conversion test`,
    hypothesis: body.hypothesis || 'Improve landing-page conversion with alternate headline and CTA',
    trafficSplit: Number(body.trafficSplit || 50),
    variant: {
      headline: body.headline || landingPage.headline,
      body: body.body || landingPage.body,
      ctaLabel: body.ctaLabel || 'Join now',
      successMessage: body.successMessage || 'Thanks for joining.'
    },
    metrics: { views: 0, submissions: 0, conversionRate: 0 },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.db.landingPageExperiments.unshift(experiment);
  landingPage.experimentIds = unique([...(landingPage.experimentIds || []), experiment.id]);
  landingPage.updatedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'landing-page-experiment-create', detail: `Created landing page experiment ${experiment.name}` });
  return experiment;
}

export function buildLeadCaptureConversionRuntimeSnapshot(state, workspaceId) {
  ensureLeadCaptureRuntimeState(state);
  const forms = state.db.forms.filter((entry) => entry.workspaceId === workspaceId);
  const landingPages = state.db.landingPages.filter((entry) => entry.workspaceId === workspaceId);
  const attributionEvents = state.db.leadAttributionEvents.filter((entry) => entry.workspaceId === workspaceId);
  const consentReceipts = state.db.leadConsentReceipts.filter((entry) => entry.workspaceId === workspaceId);
  const experiments = state.db.landingPageExperiments.filter((entry) => entry.workspaceId === workspaceId);
  const formRows = forms.map((form) => {
    const linkedPages = landingPages.filter((page) => page.formId === form.id);
    const views = linkedPages.reduce((sum, page) => sum + Number(page.views || 0), 0);
    const submissions = Number(form.submissions || 0);
    const delivery = evaluateLeadCaptureDeliveryState(form);
    return {
      id: form.id,
      name: form.name,
      status: form.status,
      channels: form.leadCapture?.channels || [form.popupMode || 'hosted'],
      delivery,
      linkedLandingPages: linkedPages.length,
      views,
      submissions,
      conversionRate: conversionRate(submissions, views),
      consentReceipts: consentReceipts.filter((receipt) => receipt.formId === form.id).length,
      attributionEvents: attributionEvents.filter((event) => event.formId === form.id).length,
      handoffConfigured: Boolean(form.leadCapture?.integrationHandoff?.journeyTrigger)
    };
  });
  const landingRows = landingPages.map((landingPage) => ({
    id: landingPage.id,
    name: landingPage.name,
    status: landingPage.status,
    formId: landingPage.formId || '',
    campaignId: landingPage.campaignId || '',
    views: Number(landingPage.views || 0),
    submissions: Number(landingPage.submissions || 0),
    conversionRate: conversionRate(landingPage.submissions, landingPage.views),
    experimentCount: experiments.filter((experiment) => experiment.landingPageId === landingPage.id).length,
    attributionEvents: attributionEvents.filter((event) => event.landingPageId === landingPage.id).length
  }));
  return {
    ...LEAD_CAPTURE_CONVERSION_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    summary: workspaceLeadCaptureSummary(state, workspaceId),
    forms: formRows,
    landingPages: landingRows,
    attributionEventCount: attributionEvents.length,
    consentReceiptCount: consentReceipts.length,
    experimentCount: experiments.length,
    recentAttributionEvents: attributionEvents.slice(0, 10),
    recentConsentReceipts: consentReceipts.slice(0, 10),
    experiments: experiments.slice(0, 10)
  };
}

export function persistLeadCaptureConversionSnapshot(state, actor, reason = 'manual_conversion_snapshot') {
  ensureLeadCaptureRuntimeState(state);
  const snapshot = buildLeadCaptureConversionRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('lconv'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.leadConversionSnapshots.unshift(entry);
  state.db.leadConversionSnapshots = state.db.leadConversionSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'lead-conversion-snapshot', detail: `Captured lead conversion snapshot (${reason})` });
  return entry;
}

export function workspaceLeadCaptureSummary(state, workspaceId) {
  ensureLeadCaptureRuntimeState(state);
  const forms = state.db.forms.filter((entry) => entry.workspaceId === workspaceId);
  const pages = state.db.landingPages.filter((entry) => entry.workspaceId === workspaceId);
  const events = state.db.events.filter((entry) => entry.workspaceId === workspaceId && String(entry.type || '').startsWith('lead-capture'));
  const submissions = forms.reduce((sum, form) => sum + (Number(form.submissions) || 0), 0);
  const views = pages.reduce((sum, page) => sum + (Number(page.views) || 0), 0);
  const popupForms = forms.filter((form) => ['popup', 'modal', 'slideout'].includes(form.popupMode) || (form.leadCapture?.channels || []).some((channel) => ['popup', 'modal'].includes(channel)));
  const deliveryStates = forms.map((form) => evaluateLeadCaptureDeliveryState(form).status);
  return {
    forms: forms.length,
    publishedForms: forms.filter((form) => form.status === 'published').length,
    popupForms: popupForms.length,
    activeForms: deliveryStates.filter((status) => status === 'active').length,
    scheduledForms: deliveryStates.filter((status) => status === 'scheduled').length,
    blockedForms: deliveryStates.filter((status) => status === 'blocked').length,
    expiredForms: deliveryStates.filter((status) => status === 'expired').length,
    landingPages: pages.length,
    publishedLandingPages: pages.filter((page) => page.status === 'published').length,
    submissions,
    views,
    conversionRate: views > 0 ? Number(((submissions / views) * 100).toFixed(2)) : 0,
    recentEvents: events.slice(0, 8)
  };
}

export function normalizeLeadCaptureConfig(body = {}, workspace = {}) {
  const channels = unique(csvValues(body.channels || body.channel, [body.popupMode || 'hosted']).map((entry) => LEAD_CAPTURE_CHANNELS.includes(entry) ? entry : 'hosted'));
  return {
    channels,
    targeting: {
      audienceRules: csvValues(body.audienceRules, []),
      geotarget: body.geotarget || 'all',
      deviceTargeting: body.deviceTargeting || 'all',
      triggerRule: body.triggerRule || body.trigger || 'page_view',
      frequencyCap: body.frequencyCap || 'once_per_session',
      suppressionTags: csvValues(body.suppressionTags, [])
    },
    schedule: {
      startsAt: body.scheduleStart || body.startsAt || '',
      endsAt: body.scheduleEnd || body.endsAt || '',
      timezone: body.timezone || workspace.settings?.timezone || 'America/Chicago'
    },
    branding: {
      themeName: body.themeName || 'Workspace brand',
      primaryColor: body.primaryColor || workspace.settings?.brandColor || '#0b5fff',
      logoAssetName: body.logoAssetName || '',
      buttonLabel: body.buttonLabel || 'Subscribe'
    },
    compliance: {
      consentMode: body.consentMode || 'express',
      privacyNoticeUrl: body.privacyNoticeUrl || '',
      doubleOptIn: body.doubleOptIn === 'on' || body.doubleOptIn === 'true',
      smsDisclosure: body.smsDisclosure || ''
    },
    placements: unique(csvValues(body.placements || body.placementSelector, ['site-wide'])),
    integrationHandoff: {
      journeyTrigger: body.journeyTrigger || 'form_submitted',
      connectedProvider: body.connectedProvider || 'hosted_site',
      webhookEvent: body.webhookEvent || 'lead_capture.submitted',
      audienceSync: body.audienceSync !== 'off'
    }
  };
}

export function applyLeadCaptureConfig(state, actor, form, body = {}) {
  const config = normalizeLeadCaptureConfig(body, actor.workspace);
  form.popupMode = config.channels.includes('popup') ? 'popup' : config.channels.includes('modal') ? 'modal' : (form.popupMode || 'inline');
  form.geotarget = config.targeting.geotarget;
  form.triggerRule = config.targeting.triggerRule;
  form.leadCapture = {
    ...(form.leadCapture || {}),
    ...config,
    updatedBy: actor.user.id,
    updatedAt: nowIso()
  };
  form.analytics ||= { impressions: 0, submissions: form.submissions || 0, lifecycle: [] };
  form.analytics.lifecycle ||= [];
  form.analytics.lifecycle.unshift({ at: nowIso(), event: 'configuration_saved', channels: config.channels });
  form.updatedAt = nowIso();
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'lead-capture-configure', detail: `Configured lead capture ${form.name}` });
  return form;
}

export function validateLeadCaptureReadiness(form) {
  const errors = [];
  const warnings = [];
  if (!form?.name) errors.push('Name is required.');
  if (!form?.audienceId) errors.push('Audience linkage is required.');
  if (!(form?.fields || []).some((field) => field.name === 'email')) errors.push('Email field is required.');
  if (!form?.leadCapture?.channels?.length) errors.push('At least one capture channel is required.');
  if (!form?.leadCapture?.compliance?.consentMode) errors.push('Consent mode is required.');
  if (!form?.leadCapture?.integrationHandoff?.journeyTrigger) warnings.push('Journey handoff is not configured.');
  if (!form?.leadCapture?.schedule?.startsAt || !form?.leadCapture?.schedule?.endsAt) warnings.push('Schedule window is open-ended.');
  const startsAt = parseScheduleDate(form?.leadCapture?.schedule?.startsAt);
  const endsAt = parseScheduleDate(form?.leadCapture?.schedule?.endsAt);
  if (form?.leadCapture?.schedule?.startsAt && !startsAt) errors.push('Schedule start must be a valid date.');
  if (form?.leadCapture?.schedule?.endsAt && !endsAt) errors.push('Schedule end must be a valid date.');
  if (startsAt && endsAt && startsAt > endsAt) errors.push('Schedule end must be after schedule start.');
  return { ok: errors.length === 0, errors, warnings };
}

export function publishLeadCapture(state, actor, form) {
  const readiness = validateLeadCaptureReadiness(form);
  if (!readiness.ok) return { ok: false, readiness };
  const previousStatus = form.status;
  form.status = 'published';
  form.publishedAt ||= nowIso();
  form.updatedAt = nowIso();
  form.analytics ||= { impressions: 0, submissions: form.submissions || 0, lifecycle: [] };
  form.analytics.lifecycle ||= [];
  form.analytics.lifecycle.unshift({ at: nowIso(), event: previousStatus === 'published' ? 'republished' : 'published', channels: form.leadCapture.channels });
  const job = enqueueJob(state, {
    type: 'lead_capture_publish_handoff',
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    payload: {
      formId: form.id,
      channels: form.leadCapture.channels,
      journeyTrigger: form.leadCapture.integrationHandoff.journeyTrigger,
      webhookEvent: form.leadCapture.integrationHandoff.webhookEvent
    }
  });
  createNotification(state, { workspaceId: actor.workspace.id, type: 'lead-capture-published', payload: { formId: form.id, channels: form.leadCapture.channels } });
  recordEvent(state, { workspaceId: actor.workspace.id, type: 'lead-capture-published', message: `${form.name} published`, meta: { formId: form.id, jobId: job.id, channels: form.leadCapture.channels } });
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'lead-capture-publish', detail: `Published lead capture ${form.name}` });
  return { ok: true, readiness, job };
}

export function buildLeadCaptureProofSnapshot(state, workspaceId) {
  const summary = workspaceLeadCaptureSummary(state, workspaceId);
  const forms = state.db.forms.filter((entry) => entry.workspaceId === workspaceId).map((form) => ({
    id: form.id,
    name: form.name,
    status: form.status,
    channels: form.leadCapture?.channels || [],
    delivery: evaluateLeadCaptureDeliveryState(form),
    targeting: form.leadCapture?.targeting || {},
    schedule: form.leadCapture?.schedule || {},
    compliance: form.leadCapture?.compliance || {},
    integrationHandoff: form.leadCapture?.integrationHandoff || {},
    analyticsLifecycleEvents: form.analytics?.lifecycle?.length || 0
  }));
  return { generatedAt: nowIso(), workspaceId, summary, forms };
}
