import { buildChannelHealthSnapshot } from '../service-channel-health.mjs';
import { createChannelHealthFixtures } from '../fixtures-channel-health.mjs';

export function createChannelHealthPublicRoutes(basePath='/public/channel-health'){const snapshot=buildChannelHealthSnapshot(); const fixtures=createChannelHealthFixtures(); return [{id:'channel-health.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'channel-health.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'channel-health.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
