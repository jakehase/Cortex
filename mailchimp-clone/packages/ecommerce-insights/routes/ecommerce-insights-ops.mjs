import { buildEcommerceInsightsSnapshot, createEcommerceInsightsChecklist } from '../service-ecommerce-insights.mjs';

export function createEcommerceInsightsOpsRoutes(basePath = '/ops/ecommerce-insights') { const snapshot = buildEcommerceInsightsSnapshot(); return [{ id: 'ecommerce-insights.ops.health', method: 'GET', path: basePath + '/health', checklist: createEcommerceInsightsChecklist(snapshot) }, { id: 'ecommerce-insights.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'ecommerce-insights.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

