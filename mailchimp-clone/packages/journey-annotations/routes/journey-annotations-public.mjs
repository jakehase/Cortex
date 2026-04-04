import { buildJourneyAnnotationsSnapshot } from '../service-journey-annotations.mjs';
import { createJourneyAnnotationsFixtures } from '../fixtures-journey-annotations.mjs';

export function createJourneyAnnotationsPublicRoutes(basePath='/public/journey-annotations'){const snapshot=buildJourneyAnnotationsSnapshot(); const fixtures=createJourneyAnnotationsFixtures(); return [{id:'journey-annotations.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'journey-annotations.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'journey-annotations.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
