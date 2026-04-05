import { buildIntegrationsFoundrySnapshot, createIntegrationsFoundryReadinessBoard } from '../service-integrations-foundry.mjs';

export function createIntegrationsFoundryOpsRoutes(basePath = '/ops/integrations-foundry') {
  const snapshot = buildIntegrationsFoundrySnapshot();
  return [
    { id: 'integrations-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsFoundryReadinessBoard(snapshot) },
    { id: 'integrations-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

