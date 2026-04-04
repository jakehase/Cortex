import { buildRevenueAttributionSnapshot } from '../service-revenue-attribution.mjs';

export function createRevenueAttributionDashboardRoutes(basePath = '/revenue-attribution') { const snapshot = buildRevenueAttributionSnapshot(); return [{ id: 'revenue-attribution.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'revenue-attribution.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'revenue-attribution.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

