import { buildIntegrationsConsoleSnapshot, createIntegrationsConsoleReadinessBoard } from '../service-integrations-console.mjs';

export function createIntegrationsConsoleOpsRoutes(basePath = '/ops/integrations-console') {
  const snapshot = buildIntegrationsConsoleSnapshot();
  return [
    { id: 'integrations-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsConsoleReadinessBoard(snapshot) },
    { id: 'integrations-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

