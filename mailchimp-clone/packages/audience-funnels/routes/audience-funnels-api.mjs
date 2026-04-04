import { buildAudienceFunnelsSnapshot, createAudienceFunnelsApiDocument } from '../service-audience-funnels.mjs';

export function createAudienceFunnelsApiRoutes(basePath='/api/audience-funnels'){const snapshot=buildAudienceFunnelsSnapshot(); return [{id:'audience-funnels.api.overview',method:'GET',path:basePath+'/overview',summary:snapshot.summary},{id:'audience-funnels.api.validate',method:'POST',path:basePath+'/validate',validation:snapshot.validation},{id:'audience-funnels.api.document',method:'GET',path:basePath+'/document',document:createAudienceFunnelsApiDocument(snapshot)}];}
