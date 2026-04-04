import { buildAudienceFunnelsSnapshot, createAudienceFunnelsChecklist } from '../service-audience-funnels.mjs';

export function createAudienceFunnelsOpsRoutes(basePath='/ops/audience-funnels'){const snapshot=buildAudienceFunnelsSnapshot(); return [{id:'audience-funnels.ops.health',method:'GET',path:basePath+'/health',checklist:createAudienceFunnelsChecklist(snapshot)},{id:'audience-funnels.ops.policies',method:'GET',path:basePath+'/policies',policies:snapshot.policies},{id:'audience-funnels.ops.metrics',method:'GET',path:basePath+'/metrics',scorecards:snapshot.workspace.scorecards}];}
