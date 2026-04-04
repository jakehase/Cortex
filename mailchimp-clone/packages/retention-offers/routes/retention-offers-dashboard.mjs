import { buildRetentionOffersSnapshot } from '../service-retention-offers.mjs';

export function createRetentionOffersDashboardRoutes(basePath = '/retention-offers') { const snapshot = buildRetentionOffersSnapshot(); return [{ id: 'retention-offers.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'retention-offers.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'retention-offers.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

