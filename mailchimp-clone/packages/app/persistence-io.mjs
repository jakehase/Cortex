import fs from 'node:fs';

export function writeJsonAtomic(filePath, body) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(body, null, 2));
  fs.renameSync(tempPath, filePath);
}

export function writeTextFile(filePath, body) {
  fs.writeFileSync(filePath, body || '', 'utf8');
}

export function writeJsonFile(filePath, body) {
  fs.writeFileSync(filePath, JSON.stringify(body, null, 2));
}

export const persistenceJobsOperationalDbIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "persistence_jobs_operational_db",
  "focusGroup": "delivery_jobs",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.persistence_jobs_operational_db::semantic-frontier-001#09-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildPersistenceJobsOperationalDbIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...persistenceJobsOperationalDbIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["apps/web/server.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: persistenceJobsOperationalDbIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: persistenceJobsOperationalDbIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: persistenceJobsOperationalDbIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const persistenceJobsOperationalDbPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "persistence_jobs_operational_db",
  "focusGroup": "delivery_jobs",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.persistence_jobs_operational_db::semantic-frontier-001#09-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildPersistenceJobsOperationalDbPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...persistenceJobsOperationalDbPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["apps/web/server.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: persistenceJobsOperationalDbPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: persistenceJobsOperationalDbPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: persistenceJobsOperationalDbPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}

