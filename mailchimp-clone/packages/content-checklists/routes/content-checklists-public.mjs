import { buildContentChecklistsSnapshot } from '../service-content-checklists.mjs';
import { createContentChecklistsFixtures } from '../fixtures-content-checklists.mjs';

export function createContentChecklistsPublicRoutes(basePath='/public/content-checklists'){const snapshot=buildContentChecklistsSnapshot(); const fixtures=createContentChecklistsFixtures(); return [{id:'content-checklists.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'content-checklists.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'content-checklists.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
