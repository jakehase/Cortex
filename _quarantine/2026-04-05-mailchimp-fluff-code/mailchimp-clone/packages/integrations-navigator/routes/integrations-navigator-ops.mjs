import { buildIntegrationsNavigatorSnapshot, createIntegrationsNavigatorReadinessBoard } from '../service-integrations-navigator.mjs';

export function createIntegrationsNavigatorOpsRoutes(basePath = '/ops/integrations-navigator') {
  const snapshot = buildIntegrationsNavigatorSnapshot();
  return [
    { id: 'integrations-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsNavigatorReadinessBoard(snapshot) },
    { id: 'integrations-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

