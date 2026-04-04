import { buildAudienceFunnelsSnapshot } from '../service-audience-funnels.mjs';
import { createAudienceFunnelsFixtures } from '../fixtures-audience-funnels.mjs';

export function createAudienceFunnelsPublicRoutes(basePath='/public/audience-funnels'){const snapshot=buildAudienceFunnelsSnapshot(); const fixtures=createAudienceFunnelsFixtures(); return [{id:'audience-funnels.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'audience-funnels.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'audience-funnels.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
