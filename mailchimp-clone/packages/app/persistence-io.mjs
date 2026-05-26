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



export function buildAuthSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const authSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeKey = "auth_session_security_hardening:operational_persistence_and_jobs:packages/app/persistence-io.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const authSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const authSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", authSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: authSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeKey, surfaceId: "auth_session_security_hardening", focusGroup: "security_ops", phaseId: "operational_persistence_and_jobs", shardId: "focus.auth_session_security_hardening::semantic-frontier-001#08-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/persistence-io.mjs", workspaceId, durableStateReady: Boolean(db), ...authSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeCounts, phaseRuntimeSignal: authSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionPhaseRuntimeSignal, workflowEvidence: authSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/server.mjs","packages/app/http-runtime.mjs","packages/app/job-handlers.mjs"], nextAction: authSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:auth_session_security_hardening:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:auth_session_security_hardening:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: authSessionSecurityHardeningOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeKey, targetFile: "packages/app/persistence-io.mjs" } };
}



export function buildPersistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeKey = "persistence_jobs_operational_db:operational_persistence_and_jobs:packages/app/persistence-io.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeKey, surfaceId: "persistence_jobs_operational_db", focusGroup: "delivery_jobs", phaseId: "operational_persistence_and_jobs", shardId: "focus.persistence_jobs_operational_db::semantic-frontier-001#09-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/persistence-io.mjs", workspaceId, durableStateReady: Boolean(db), ...persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeCounts, phaseRuntimeSignal: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionPhaseRuntimeSignal, workflowEvidence: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/server.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:persistence_jobs_operational_db:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:persistence_jobs_operational_db:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: persistenceJobsOperationalDbOperationalPersistenceAndJobsPackagesAppPersistenceIoMjsAdoptionRuntimeKey, targetFile: "packages/app/persistence-io.mjs" } };
}

