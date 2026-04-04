import { buildAudienceWarehouseSnapshot } from '../service-audience-warehouse.mjs';

export function createAudienceWarehouseDashboardRoutes(basePath = '/audience-warehouse') { const snapshot = buildAudienceWarehouseSnapshot(); return [{ id: 'audience-warehouse.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'audience-warehouse.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'audience-warehouse.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }
