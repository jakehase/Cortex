import { buildIntegrationsIndexSnapshot, createIntegrationsIndexReadinessBoard } from '../service-integrations-index.mjs';

export function createIntegrationsIndexOpsRoutes(basePath = '/ops/integrations-index') {
  const snapshot = buildIntegrationsIndexSnapshot();
  return [
    { id: 'integrations-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsIndexReadinessBoard(snapshot) },
    { id: 'integrations-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

