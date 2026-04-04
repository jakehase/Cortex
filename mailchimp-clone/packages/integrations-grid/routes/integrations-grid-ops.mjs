import { buildIntegrationsGridSnapshot, createIntegrationsGridReadinessBoard } from '../service-integrations-grid.mjs';

export function createIntegrationsGridOpsRoutes(basePath = '/ops/integrations-grid') {
  const snapshot = buildIntegrationsGridSnapshot();
  return [
    { id: 'integrations-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsGridReadinessBoard(snapshot) },
    { id: 'integrations-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

