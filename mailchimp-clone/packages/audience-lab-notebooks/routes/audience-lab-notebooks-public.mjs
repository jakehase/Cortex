import { buildAudienceLabNotebooksSnapshot } from '../service-audience-lab-notebooks.mjs';
import { createAudienceLabNotebooksFixtures } from '../fixtures-audience-lab-notebooks.mjs';

export function createAudienceLabNotebooksPublicRoutes(basePath='/public/audience-lab-notebooks'){const snapshot=buildAudienceLabNotebooksSnapshot(); const fixtures=createAudienceLabNotebooksFixtures(); return [{id:'audience-lab-notebooks.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'audience-lab-notebooks.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'audience-lab-notebooks.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
