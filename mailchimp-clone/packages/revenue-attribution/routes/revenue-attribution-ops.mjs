import { buildRevenueAttributionSnapshot, createRevenueAttributionChecklist } from '../service-revenue-attribution.mjs';

export function createRevenueAttributionOpsRoutes(basePath = '/ops/revenue-attribution') { const snapshot = buildRevenueAttributionSnapshot(); return [{ id: 'revenue-attribution.ops.health', method: 'GET', path: basePath + '/health', checklist: createRevenueAttributionChecklist(snapshot) }, { id: 'revenue-attribution.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'revenue-attribution.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

