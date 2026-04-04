import { buildIntegrationsWatchtowerSnapshot, createIntegrationsWatchtowerReadinessBoard } from '../service-integrations-watchtower.mjs';

export function createIntegrationsWatchtowerOpsRoutes(basePath = '/ops/integrations-watchtower') {
  const snapshot = buildIntegrationsWatchtowerSnapshot();
  return [
    { id: 'integrations-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsWatchtowerReadinessBoard(snapshot) },
    { id: 'integrations-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

