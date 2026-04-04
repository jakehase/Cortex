import { buildProfileEnrichmentSnapshot, createProfileEnrichmentApiDocument } from '../service-profile-enrichment.mjs';

export function createProfileEnrichmentApiRoutes(basePath = '/api/profile-enrichment') { const snapshot = buildProfileEnrichmentSnapshot(); return [{ id: 'profile-enrichment.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'profile-enrichment.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'profile-enrichment.api.document', method: 'GET', path: basePath + '/document', document: createProfileEnrichmentApiDocument(snapshot) }]; }

