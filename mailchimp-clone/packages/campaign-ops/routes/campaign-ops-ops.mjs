import { buildCampaignOpsSnapshot, createCampaignOpsChecklist } from '../service-campaign-ops.mjs';

export function createCampaignOpsOpsRoutes(basePath='/ops/campaign-ops'){const snapshot=buildCampaignOpsSnapshot(); return [{id:'campaign-ops.ops.health',method:'GET',path:basePath+'/health',checklist:createCampaignOpsChecklist(snapshot)},{id:'campaign-ops.ops.policies',method:'GET',path:basePath+'/policies',policies:snapshot.policies},{id:'campaign-ops.ops.metrics',method:'GET',path:basePath+'/metrics',scorecards:snapshot.workspace.scorecards}];}
