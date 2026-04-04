import { buildCampaignOpsSnapshot } from '../service-campaign-ops.mjs';
import { createCampaignOpsFixtures } from '../fixtures-campaign-ops.mjs';

export function createCampaignOpsPublicRoutes(basePath='/public/campaign-ops'){const snapshot=buildCampaignOpsSnapshot(); const fixtures=createCampaignOpsFixtures(); return [{id:'campaign-ops.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'campaign-ops.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'campaign-ops.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
