import { buildChannelHealthSnapshot, createChannelHealthChecklist } from '../service-channel-health.mjs';

export function createChannelHealthOpsRoutes(basePath='/ops/channel-health'){const snapshot=buildChannelHealthSnapshot(); return [{id:'channel-health.ops.health',method:'GET',path:basePath+'/health',checklist:createChannelHealthChecklist(snapshot)},{id:'channel-health.ops.policies',method:'GET',path:basePath+'/policies',policies:snapshot.policies},{id:'channel-health.ops.metrics',method:'GET',path:basePath+'/metrics',scorecards:snapshot.workspace.scorecards}];}
