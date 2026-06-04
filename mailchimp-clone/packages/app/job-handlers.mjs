import { createNotification, recordEvent } from './domain-core.mjs';
import { processCsvImport } from './domain-audience.mjs';
import { campaignHtml, markCampaignDelivered } from './domain-campaigns.mjs';

export const JOB_HANDLERS = {
  import_contacts(state, job) {
    job.result = processCsvImport(state, job);
    createNotification(state, { workspaceId: job.workspaceId, type: 'import-complete', payload: { audienceId: job.payload.audienceId, ...job.result } });
  },
  send_test_campaign(state, job) {
    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
    if (!campaign) throw new Error(`Campaign ${job.payload.campaignId} not found for test send`);
    job.result = createNotification(state, { workspaceId: job.workspaceId, type: 'test-send', payload: { campaignId: campaign.id, to: job.payload.testEmail, subject: campaign.subject, htmlPreview: campaignHtml(campaign, state) } });
    state.db.deliveryPipelineRuns ||= [];
    state.db.deliveryPipelineRuns.unshift({
      id: `delivery_${job.id}`,
      workspaceId: job.workspaceId,
      campaignId: campaign.id,
      jobId: job.id,
      mode: 'test_send',
      status: 'succeeded',
      recipient: job.payload.testEmail,
      createdAt: new Date().toISOString()
    });
  },
  deliver_campaign(state, job) {
    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
    if (!campaign) throw new Error(`Campaign ${job.payload.campaignId} not found for delivery`);
    job.result = markCampaignDelivered(state, campaign);
  },
  audience_provider_sync(state, job) {
    const audience = state.db.audiences.find((entry) => entry.id === job.payload.audienceId && entry.workspaceId === job.workspaceId);
    if (!audience) throw new Error(`Audience ${job.payload.audienceId} not found for provider sync`);
    const syncedAt = new Date().toISOString();
    audience.providerSync = {
      lastProvider: job.payload.provider || 'mailchimp-import-api',
      mode: job.payload.mode || 'bidirectional_contact_sync',
      status: 'synced',
      syncedAt,
      contactCount: state.db.contacts.filter((entry) => entry.audienceId === audience.id).length
    };
    job.result = { ...audience.providerSync, audienceId: audience.id };
    createNotification(state, { workspaceId: job.workspaceId, type: 'audience-provider-sync-complete', payload: job.result });
    recordEvent(state, { workspaceId: job.workspaceId, type: 'audience-provider-sync', message: `${audience.providerSync.lastProvider} synced ${audience.name}`, meta: { jobId: job.id, audienceId: audience.id } });
  }
};

export function executeJobByType(state, job) {
  const handler = JOB_HANDLERS[job.type];
  if (!handler) throw new Error(`Unsupported job type: ${job.type}`);
  return handler(state, job);
}



export function buildPersistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey = "persistence_jobs_operational_db:operational_persistence_and_jobs:packages/app/job-handlers.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, surfaceId: "persistence_jobs_operational_db", focusGroup: "delivery_jobs", phaseId: "operational_persistence_and_jobs", shardId: "focus.persistence_jobs_operational_db::semantic-frontier-001#11-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/job-handlers.mjs", semanticRuntimeContractRef: "persistenceJobsOperationalDbOperationalPersistenceAndJobsSemanticRuntimeContract", workspaceId, durableStateReady: Boolean(db), ...persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts, phaseRuntimeSignal: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal, workflowEvidence: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/server.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:persistence_jobs_operational_db:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:persistence_jobs_operational_db:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, targetFile: "packages/app/job-handlers.mjs", semanticRuntimeContractRef: "persistenceJobsOperationalDbOperationalPersistenceAndJobsSemanticRuntimeContract" } };
}



export function buildContactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey = "contacts_table:operational_persistence_and_jobs:packages/app/job-handlers.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, surfaceId: "contacts_table", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.contacts_table::semantic-frontier-001#03-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/job-handlers.mjs", semanticRuntimeContractRef: "contactsTableOperationalPersistenceAndJobsSemanticRuntimeContract", workspaceId, durableStateReady: Boolean(db), ...contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:contacts_table:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:contacts_table:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, targetFile: "packages/app/job-handlers.mjs", semanticRuntimeContractRef: "contactsTableOperationalPersistenceAndJobsSemanticRuntimeContract" } };
}



export function buildSignupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const signupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey = "signup_forms_popups:operational_persistence_and_jobs:packages/app/job-handlers.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", signupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, surfaceId: "signup_forms_popups", focusGroup: "frontend_architecture", phaseId: "operational_persistence_and_jobs", shardId: "focus.signup_forms_popups::semantic-frontier-001#07-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/job-handlers.mjs", semanticRuntimeContractRef: "signupFormsPopupsOperationalPersistenceAndJobsSemanticRuntimeContract", workspaceId, durableStateReady: Boolean(db), ...signupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts, phaseRuntimeSignal: signupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal, workflowEvidence: signupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-growth.mjs","packages/app/domain-leads.mjs","packages/app/job-handlers.mjs"], nextAction: signupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:signup_forms_popups:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:signup_forms_popups:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupFormsPopupsOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, targetFile: "packages/app/job-handlers.mjs", semanticRuntimeContractRef: "signupFormsPopupsOperationalPersistenceAndJobsSemanticRuntimeContract" } };
}



export function buildContactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionState(state = {}, actor = {}, input = {}) {
  const contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeKey = "contacts_table:operational_persistence_and_jobs:packages/app/job-handlers.mjs:semanticFrontier00103OperationalPersistenceAndJobs2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeKey, surfaceId: "contacts_table", focusGroup: "audience_crm", phaseId: "operational_persistence_and_jobs", shardId: "focus.contacts_table::semantic-frontier-001#03-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/job-handlers.mjs", semanticRuntimeContractRef: "contactsTableOperationalPersistenceAndJobsSemanticRuntimeContract", workspaceId, durableStateReady: Boolean(db), ...contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeCounts, phaseRuntimeSignal: contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionPhaseRuntimeSignal, workflowEvidence: contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-audience.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:contacts_table:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:contacts_table:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contactsTableOperationalPersistenceAndJobsPackagesAppJobHandlersMjsSemanticFrontier00103OperationalPersistenceAndJobs2AdoptionRuntimeKey, targetFile: "packages/app/job-handlers.mjs", semanticRuntimeContractRef: "contactsTableOperationalPersistenceAndJobsSemanticRuntimeContract" } };
}



export function buildWebsiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey = "website_builder_editor_realism:operational_persistence_and_jobs:packages/app/job-handlers.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", websiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "operational_persistence_and_jobs", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#02-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/job-handlers.mjs", semanticRuntimeContractRef: "websiteBuilderEditorRealismOperationalPersistenceAndJobsSemanticRuntimeContract", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:website_builder_editor_realism:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, targetFile: "packages/app/job-handlers.mjs", semanticRuntimeContractRef: "websiteBuilderEditorRealismOperationalPersistenceAndJobsSemanticRuntimeContract" } };
}
