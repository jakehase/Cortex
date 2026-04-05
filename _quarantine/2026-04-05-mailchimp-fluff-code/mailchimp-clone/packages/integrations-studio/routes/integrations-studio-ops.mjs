import { buildIntegrationsStudioSnapshot, createIntegrationsStudioReadinessBoard } from '../service-integrations-studio.mjs';

export function createIntegrationsStudioOpsRoutes(basePath = '/ops/integrations-studio') {
  const snapshot = buildIntegrationsStudioSnapshot();
  return [
    { id: 'integrations-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsStudioReadinessBoard(snapshot) },
    { id: 'integrations-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

