import { buildChannelHealthSnapshot, createChannelHealthApiDocument } from '../service-channel-health.mjs';

export function createChannelHealthApiRoutes(basePath='/api/channel-health'){const snapshot=buildChannelHealthSnapshot(); return [{id:'channel-health.api.overview',method:'GET',path:basePath+'/overview',summary:snapshot.summary},{id:'channel-health.api.validate',method:'POST',path:basePath+'/validate',validation:snapshot.validation},{id:'channel-health.api.document',method:'GET',path:basePath+'/document',document:createChannelHealthApiDocument(snapshot)}];}
