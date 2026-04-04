import { buildCreativeBriefBuilderSnapshot } from '../service-creative-brief-builder.mjs';

export function createCreativeBriefBuilderDashboardRoutes(basePath = '/creative-brief-builder') { const snapshot = buildCreativeBriefBuilderSnapshot(); return [{ id: 'creative-brief-builder.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'creative-brief-builder.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'creative-brief-builder.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

