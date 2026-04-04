import { buildEcommerceInsightsSnapshot } from '../service-ecommerce-insights.mjs';

export function createEcommerceInsightsDashboardRoutes(basePath = '/ecommerce-insights') { const snapshot = buildEcommerceInsightsSnapshot(); return [{ id: 'ecommerce-insights.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'ecommerce-insights.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'ecommerce-insights.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

