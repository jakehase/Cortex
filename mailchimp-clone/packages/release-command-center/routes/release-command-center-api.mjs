import { buildReleaseCommandCenterSnapshot, createReleaseCommandCenterApiDocument } from '../service-release-command-center.mjs';

export function createReleaseCommandCenterApiRoutes(basePath = '/api/release-command-center') { const snapshot = buildReleaseCommandCenterSnapshot(); return [{ id: 'release-command-center.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'release-command-center.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'release-command-center.api.document', method: 'GET', path: basePath + '/document', document: createReleaseCommandCenterApiDocument(snapshot) }]; }

