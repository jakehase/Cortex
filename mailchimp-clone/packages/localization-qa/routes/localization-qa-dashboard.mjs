import { buildLocalizationQaSnapshot } from '../service-localization-qa.mjs';

export function createLocalizationQaDashboardRoutes(basePath = '/localization-qa') { const snapshot = buildLocalizationQaSnapshot(); return [{ id: 'localization-qa.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'localization-qa.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'localization-qa.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

