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



export function buildAuthSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const authSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionRuntimeKey = "auth_session_security_hardening:primary_runtime_spine:packages/app/persistence-io.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const authSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const authSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", authSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: authSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionRuntimeKey, surfaceId: "auth_session_security_hardening", focusGroup: "security_ops", phaseId: "primary_runtime_spine", shardId: "focus.auth_session_security_hardening::semantic-frontier-001#08-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/persistence-io.mjs", workspaceId, durableStateReady: Boolean(db), ...authSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionRuntimeCounts, phaseRuntimeSignal: authSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionPhaseRuntimeSignal, workflowEvidence: authSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/server.mjs","packages/app/http-runtime.mjs","packages/app/persistence-io.mjs"], nextAction: authSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:auth_session_security_hardening:monitor_job_runtime_handoff" : "primary_runtime_spine:auth_session_security_hardening:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: authSessionSecurityHardeningPrimaryRuntimeSpinePackagesAppPersistenceIoMjsAdoptionRuntimeKey, targetFile: "packages/app/persistence-io.mjs" } };
}

