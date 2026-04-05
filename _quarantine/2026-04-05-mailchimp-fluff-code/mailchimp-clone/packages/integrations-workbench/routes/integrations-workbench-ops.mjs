import { buildIntegrationsWorkbenchSnapshot, createIntegrationsWorkbenchReadinessBoard } from '../service-integrations-workbench.mjs';

export function createIntegrationsWorkbenchOpsRoutes(basePath = '/ops/integrations-workbench') {
  const snapshot = buildIntegrationsWorkbenchSnapshot();
  return [
    { id: 'integrations-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsWorkbenchReadinessBoard(snapshot) },
    { id: 'integrations-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

