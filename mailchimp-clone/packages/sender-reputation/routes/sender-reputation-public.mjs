import { buildSenderReputationSnapshot } from '../service-sender-reputation.mjs';
import { createSenderReputationFixtures } from '../fixtures-sender-reputation.mjs';

export function createSenderReputationPublicRoutes(basePath='/public/sender-reputation'){const snapshot=buildSenderReputationSnapshot(); const fixtures=createSenderReputationFixtures(); return [{id:'sender-reputation.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'sender-reputation.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'sender-reputation.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
