import { buildAttributionModelingSnapshot } from '../service-attribution-modeling.mjs';

export function createAttributionModelingDashboardRoutes(basePath = '/attribution-modeling') { const snapshot = buildAttributionModelingSnapshot(); return [{ id: 'attribution-modeling.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'attribution-modeling.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'attribution-modeling.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

