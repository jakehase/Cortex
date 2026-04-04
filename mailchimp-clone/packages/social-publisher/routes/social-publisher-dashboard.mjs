import { buildSocialPublisherSnapshot } from '../service-social-publisher.mjs';

export function createSocialPublisherDashboardRoutes(basePath = '/social-publisher') { const snapshot = buildSocialPublisherSnapshot(); return [{ id: 'social-publisher.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'social-publisher.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'social-publisher.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }
