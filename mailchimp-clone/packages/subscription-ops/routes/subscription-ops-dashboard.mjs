import { buildSubscriptionOpsSnapshot } from '../service-subscription-ops.mjs';

export function createSubscriptionOpsDashboardRoutes(basePath = '/subscription-ops') {
  const snapshot = buildSubscriptionOpsSnapshot();
  return [
    { id: 'subscription-ops.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'subscription-ops.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'subscription-ops.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
