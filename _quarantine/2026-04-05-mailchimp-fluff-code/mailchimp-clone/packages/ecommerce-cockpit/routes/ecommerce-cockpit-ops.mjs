import { buildEcommerceCockpitSnapshot, createEcommerceCockpitReadinessBoard } from '../service-ecommerce-cockpit.mjs';

export function createEcommerceCockpitOpsRoutes(basePath = '/ops/ecommerce-cockpit') {
  const snapshot = buildEcommerceCockpitSnapshot();
  return [
    { id: 'ecommerce-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceCockpitReadinessBoard(snapshot) },
    { id: 'ecommerce-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

