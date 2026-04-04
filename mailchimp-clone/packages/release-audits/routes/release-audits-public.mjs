import { buildReleaseAuditsSnapshot } from '../service-release-audits.mjs';
import { createReleaseAuditsFixtures } from '../fixtures-release-audits.mjs';

export function createReleaseAuditsPublicRoutes(basePath='/public/release-audits'){const snapshot=buildReleaseAuditsSnapshot(); const fixtures=createReleaseAuditsFixtures(); return [{id:'release-audits.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'release-audits.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'release-audits.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
