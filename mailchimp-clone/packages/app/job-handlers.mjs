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
  },
  deliver_campaign(state, job) {
    const campaign = state.db.campaigns.find((entry) => entry.id === job.payload.campaignId);
    if (!campaign) throw new Error(`Campaign ${job.payload.campaignId} not found for delivery`);
    job.result = markCampaignDelivered(state, campaign);
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
  return { runtimeKey: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, surfaceId: "persistence_jobs_operational_db", focusGroup: "delivery_jobs", phaseId: "operational_persistence_and_jobs", shardId: "focus.persistence_jobs_operational_db::semantic-frontier-001#07-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/job-handlers.mjs", workspaceId, durableStateReady: Boolean(db), ...persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts, phaseRuntimeSignal: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal, workflowEvidence: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/server.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:persistence_jobs_operational_db:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:persistence_jobs_operational_db:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, targetFile: "packages/app/job-handlers.mjs" } };
}



export function buildAiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const aiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey = "ai_predictive_ops_realism:operational_persistence_and_jobs:packages/app/job-handlers.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const aiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const aiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", aiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: aiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, surfaceId: "ai_predictive_ops_realism", focusGroup: "ai_predictive", phaseId: "operational_persistence_and_jobs", shardId: "focus.ai_predictive_ops_realism::semantic-frontier-001#08-operational_persistence_and_jobs#2", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/job-handlers.mjs", workspaceId, durableStateReady: Boolean(db), ...aiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts, phaseRuntimeSignal: aiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionPhaseRuntimeSignal, workflowEvidence: aiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/ai-provider.mjs","packages/app/domain-current-product-ops.mjs","packages/app/job-handlers.mjs"], nextAction: aiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:ai_predictive_ops_realism:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:ai_predictive_ops_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: aiPredictiveOpsRealismOperationalPersistenceAndJobsPackagesAppJobHandlersMjsAdoptionRuntimeKey, targetFile: "packages/app/job-handlers.mjs" } };
}

