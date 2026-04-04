import { buildCampaignOpsSnapshot, createCampaignOpsApiDocument } from '../service-campaign-ops.mjs';

export function createCampaignOpsApiRoutes(basePath='/api/campaign-ops'){const snapshot=buildCampaignOpsSnapshot(); return [{id:'campaign-ops.api.overview',method:'GET',path:basePath+'/overview',summary:snapshot.summary},{id:'campaign-ops.api.validate',method:'POST',path:basePath+'/validate',validation:snapshot.validation},{id:'campaign-ops.api.document',method:'GET',path:basePath+'/document',document:createCampaignOpsApiDocument(snapshot)}];}
