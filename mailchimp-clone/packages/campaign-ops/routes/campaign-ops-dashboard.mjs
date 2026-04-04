import { buildCampaignOpsSnapshot } from '../service-campaign-ops.mjs';

export function createCampaignOpsDashboardRoutes(basePath='/campaign-ops'){const snapshot=buildCampaignOpsSnapshot(); return [{id:'campaign-ops.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'campaign-ops.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'campaign-ops.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
