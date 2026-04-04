import { buildDataActivationSnapshot } from '../service-data-activation.mjs';

export function createDataActivationDashboardRoutes(basePath = '/data-activation') { const snapshot = buildDataActivationSnapshot(); return [{ id: 'data-activation.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'data-activation.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'data-activation.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

