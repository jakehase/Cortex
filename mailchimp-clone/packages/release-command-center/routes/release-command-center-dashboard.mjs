import { buildReleaseCommandCenterSnapshot } from '../service-release-command-center.mjs';

export function createReleaseCommandCenterDashboardRoutes(basePath = '/release-command-center') { const snapshot = buildReleaseCommandCenterSnapshot(); return [{ id: 'release-command-center.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'release-command-center.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'release-command-center.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

