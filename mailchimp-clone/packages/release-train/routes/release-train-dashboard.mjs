import { buildReleaseTrainSnapshot } from '../service-release-train.mjs';

export function createReleaseTrainDashboardRoutes(basePath = '/release-train') { const snapshot = buildReleaseTrainSnapshot(); return [{ id: 'release-train.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'release-train.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'release-train.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }
