import { buildPreferenceExportsSnapshot } from '../service-preference-exports.mjs';
import { createPreferenceExportsFixtures } from '../fixtures-preference-exports.mjs';

export function createPreferenceExportsPublicRoutes(basePath='/public/preference-exports'){const snapshot=buildPreferenceExportsSnapshot(); const fixtures=createPreferenceExportsFixtures(); return [{id:'preference-exports.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'preference-exports.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'preference-exports.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
