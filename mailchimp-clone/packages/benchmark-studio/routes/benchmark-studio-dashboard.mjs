import { buildBenchmarkStudioSnapshot } from '../service-benchmark-studio.mjs';

export function createBenchmarkStudioDashboardRoutes(basePath = '/benchmark-studio') { const snapshot = buildBenchmarkStudioSnapshot(); return [{ id: 'benchmark-studio.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'benchmark-studio.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'benchmark-studio.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

