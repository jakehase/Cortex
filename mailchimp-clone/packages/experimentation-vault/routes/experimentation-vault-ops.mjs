import { buildExperimentationVaultSnapshot, createExperimentationVaultReadinessBoard } from '../service-experimentation-vault.mjs';

export function createExperimentationVaultOpsRoutes(basePath = '/ops/experimentation-vault') {
  const snapshot = buildExperimentationVaultSnapshot();
  return [
    { id: 'experimentation-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationVaultReadinessBoard(snapshot) },
    { id: 'experimentation-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

