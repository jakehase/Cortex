import { buildAdvocacyHubSnapshot, createAdvocacyHubReadinessBoard } from '../service-advocacy-hub.mjs';

export function createAdvocacyHubOpsRoutes(basePath = '/ops/advocacy-hub') {
  const snapshot = buildAdvocacyHubSnapshot();
  return [
    { id: 'advocacy-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyHubReadinessBoard(snapshot) },
    { id: 'advocacy-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

