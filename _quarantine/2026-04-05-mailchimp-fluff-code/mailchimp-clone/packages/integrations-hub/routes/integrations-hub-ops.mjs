import { buildIntegrationsHubSnapshot, createIntegrationsHubReadinessBoard } from '../service-integrations-hub.mjs';

export function createIntegrationsHubOpsRoutes(basePath = '/ops/integrations-hub') {
  const snapshot = buildIntegrationsHubSnapshot();
  return [
    { id: 'integrations-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsHubReadinessBoard(snapshot) },
    { id: 'integrations-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

