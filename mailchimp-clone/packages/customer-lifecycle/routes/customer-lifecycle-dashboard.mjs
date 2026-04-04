import { buildCustomerLifecycleSnapshot } from '../service-customer-lifecycle.mjs';

export function createCustomerLifecycleDashboardRoutes(basePath = '/customer-lifecycle') {
  const snapshot = buildCustomerLifecycleSnapshot();
  return [
    { id: 'customer-lifecycle.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'customer-lifecycle.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-lifecycle.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
