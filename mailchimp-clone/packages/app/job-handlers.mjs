import { createNotification, recordEvent } from './domain-core.mjs';
import { processCsvImport } from './domain-audience.mjs';
import { campaignHtml, markCampaignDelivered } from './domain-campaigns.mjs';
import { createId, nowIso } from './utils.mjs';

export const JOB_HANDLERS = {
  import_contacts(state, job) {
    job.result = processCsvImport(state, job);
    createNotification(state, { workspaceId: job.workspaceId, type: 'import-complete', payload: { audienceId: job.payload.audienceId, ...job.result } });
  },
  send_test_campaign(state, job) {
    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
    if (!campaign) throw new Error(`Campaign ${job.payload.campaignId} not found for test send`);
    job.result = createNotification(state, { workspaceId: job.workspaceId, type: 'test-send', payload: { campaignId: campaign.id, to: job.payload.testEmail, subject: campaign.subject, htmlPreview: campaignHtml(campaign, state) } });
  },
  deliver_campaign(state, job) {
    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
    if (!campaign) throw new Error(`Campaign ${job.payload.campaignId} not found for delivery`);
    job.result = markCampaignDelivered(state, campaign);
  },
  audience_provider_sync(state, job) {
    const audience = state.db.audiences.find((entry) => entry.id === job.payload.audienceId && entry.workspaceId === job.workspaceId);
    if (!audience) throw new Error(`Audience ${job.payload.audienceId} not found for provider sync`);
    const contacts = state.db.contacts.filter((entry) => entry.audienceId === audience.id && entry.workspaceId === job.workspaceId);
    audience.providerSync ||= {};
    audience.providerSync.lastProvider = job.payload.provider || 'mailchimp-import-api';
    audience.providerSync.lastSyncedAt = nowIso();
    audience.providerSync.mode = job.payload.mode || 'bidirectional_contact_sync';
    audience.providerSync.syncedContacts = contacts.length;
    job.result = { audienceId: audience.id, provider: audience.providerSync.lastProvider, syncedContacts: contacts.length, mode: audience.providerSync.mode };
    createNotification(state, { workspaceId: job.workspaceId, type: 'audience-provider-sync-complete', payload: job.result });
  },
  segment_refresh(state, job) {
    const segment = state.db.segments.find((entry) => entry.id === job.payload.segmentId && entry.workspaceId === job.workspaceId);
    if (!segment) throw new Error(`Segment ${job.payload.segmentId} not found for refresh`);
    segment.lastRefreshedAt = nowIso();
    segment.lastMatchCount = Number(job.payload.matchCount || segment.lastMatchCount || 0);
    job.result = { segmentId: segment.id, matchCount: segment.lastMatchCount, refreshedAt: segment.lastRefreshedAt };
    recordEvent(state, { workspaceId: job.workspaceId, type: 'segment-refresh-complete', message: `${segment.name || segment.id} refreshed`, meta: job.result });
  },
  lead_capture_publish_handoff(state, job) {
    const form = state.db.forms.find((entry) => entry.id === job.payload.formId && entry.workspaceId === job.workspaceId);
    if (!form) throw new Error(`Lead capture form ${job.payload.formId} not found for publish handoff`);
    form.leadCapture ||= {};
    form.leadCapture.operationalHandoff ||= [];
    const handoff = { id: createId('handoff'), channels: job.payload.channels || form.leadCapture.channels || ['hosted'], status: 'completed', completedAt: nowIso() };
    form.leadCapture.operationalHandoff.unshift(handoff);
    job.result = handoff;
    recordEvent(state, { workspaceId: job.workspaceId, type: 'lead-capture-handoff-complete', message: `${form.name || form.id} publish handoff completed`, meta: { formId: form.id, handoffId: handoff.id } });
  },
  onboarding_recovery(state, job) {
    const workspace = state.db.workspaces.find((entry) => entry.id === job.workspaceId);
    if (!workspace) throw new Error(`Workspace ${job.workspaceId} not found for onboarding recovery`);
    workspace.settings ||= {};
    workspace.settings.onboarding ||= {};
    workspace.settings.onboarding.recoveryDeliveredAt = nowIso();
    workspace.settings.onboarding.recoveryStep = job.payload.step || workspace.settings.onboarding.lastSkippedStep || 'contact_import';
    job.result = { step: workspace.settings.onboarding.recoveryStep, deliveredAt: workspace.settings.onboarding.recoveryDeliveredAt };
    createNotification(state, { workspaceId: job.workspaceId, type: 'onboarding-recovery', payload: job.result });
  }
};

export function executeJobByType(state, job) {
  const handler = JOB_HANDLERS[job.type];
  if (!handler) throw new Error(`Unsupported job type: ${job.type}`);
  return handler(state, job);
}

export const settingsDomainsOperationalPersistenceAndJobsSemanticRuntimeContract = {
  "surfaceId": "settings_domains",
  "focusGroup": "settings_domains",
  "phaseId": "operational_persistence_and_jobs",
  "shardId": "focus.settings_domains::semantic-frontier-001#23-operational_persistence_and_jobs#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildSettingsDomainsOperationalPersistenceAndJobsSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...settingsDomainsOperationalPersistenceAndJobsSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-deliverability-compliance.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: settingsDomainsOperationalPersistenceAndJobsSemanticRuntimeContract.surfaceId,
      phaseId: settingsDomainsOperationalPersistenceAndJobsSemanticRuntimeContract.phaseId,
      shardId: settingsDomainsOperationalPersistenceAndJobsSemanticRuntimeContract.shardId
    }
  };
}

export const signupOnboardingOperationalPersistenceAndJobsSemanticRuntimeContract = {
  "surfaceId": "signup_onboarding",
  "focusGroup": "signup_onboarding",
  "phaseId": "operational_persistence_and_jobs",
  "shardId": "focus.signup_onboarding::semantic-frontier-001#25-operational_persistence_and_jobs#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildSignupOnboardingOperationalPersistenceAndJobsSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...signupOnboardingOperationalPersistenceAndJobsSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: signupOnboardingOperationalPersistenceAndJobsSemanticRuntimeContract.surfaceId,
      phaseId: signupOnboardingOperationalPersistenceAndJobsSemanticRuntimeContract.phaseId,
      shardId: signupOnboardingOperationalPersistenceAndJobsSemanticRuntimeContract.shardId
    }
  };
}

export const contactsTableOperationalPersistenceAndJobsSemanticRuntimeContract = {
  "surfaceId": "contacts_table",
  "focusGroup": "audience_crm",
  "phaseId": "operational_persistence_and_jobs",
  "shardId": "focus.contacts_table::semantic-frontier-001#13-operational_persistence_and_jobs#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildContactsTableOperationalPersistenceAndJobsSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...contactsTableOperationalPersistenceAndJobsSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: contactsTableOperationalPersistenceAndJobsSemanticRuntimeContract.surfaceId,
      phaseId: contactsTableOperationalPersistenceAndJobsSemanticRuntimeContract.phaseId,
      shardId: contactsTableOperationalPersistenceAndJobsSemanticRuntimeContract.shardId
    }
  };
}
