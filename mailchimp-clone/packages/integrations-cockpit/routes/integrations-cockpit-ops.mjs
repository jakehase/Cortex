import { buildIntegrationsCockpitSnapshot, createIntegrationsCockpitReadinessBoard } from '../service-integrations-cockpit.mjs';

export function createIntegrationsCockpitOpsRoutes(basePath = '/ops/integrations-cockpit') {
  const snapshot = buildIntegrationsCockpitSnapshot();
  return [
    { id: 'integrations-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsCockpitReadinessBoard(snapshot) },
    { id: 'integrations-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

