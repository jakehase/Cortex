import { buildCreativeQaSnapshot } from '../service-creative-qa.mjs';

export function createCreativeQaDashboardRoutes(basePath = '/creative-qa') { const snapshot = buildCreativeQaSnapshot(); return [{ id: 'creative-qa.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'creative-qa.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'creative-qa.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

