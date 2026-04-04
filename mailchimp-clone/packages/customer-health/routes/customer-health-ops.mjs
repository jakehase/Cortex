import { buildCustomerHealthSnapshot, createCustomerHealthChecklist } from '../service-customer-health.mjs';

export function createCustomerHealthOpsRoutes(basePath = '/ops/customer-health') { const snapshot = buildCustomerHealthSnapshot(); return [{ id: 'customer-health.ops.health', method: 'GET', path: basePath + '/health', checklist: createCustomerHealthChecklist(snapshot) }, { id: 'customer-health.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'customer-health.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

