import { buildReleaseAuditsSnapshot, createReleaseAuditsApiDocument } from '../service-release-audits.mjs';

export function createReleaseAuditsApiRoutes(basePath='/api/release-audits'){const snapshot=buildReleaseAuditsSnapshot(); return [{id:'release-audits.api.overview',method:'GET',path:basePath+'/overview',summary:snapshot.summary},{id:'release-audits.api.validate',method:'POST',path:basePath+'/validate',validation:snapshot.validation},{id:'release-audits.api.document',method:'GET',path:basePath+'/document',document:createReleaseAuditsApiDocument(snapshot)}];}
