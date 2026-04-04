import { buildProfileEnrichmentSnapshot } from '../service-profile-enrichment.mjs';

export function createProfileEnrichmentDashboardRoutes(basePath = '/profile-enrichment') { const snapshot = buildProfileEnrichmentSnapshot(); return [{ id: 'profile-enrichment.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'profile-enrichment.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'profile-enrichment.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

