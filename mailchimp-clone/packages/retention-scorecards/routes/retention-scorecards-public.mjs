import { buildRetentionScorecardsSnapshot } from '../service-retention-scorecards.mjs';
import { createRetentionScorecardsFixtures } from '../fixtures-retention-scorecards.mjs';

export function createRetentionScorecardsPublicRoutes(basePath='/public/retention-scorecards'){const snapshot=buildRetentionScorecardsSnapshot(); const fixtures=createRetentionScorecardsFixtures(); return [{id:'retention-scorecards.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'retention-scorecards.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'retention-scorecards.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
