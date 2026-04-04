import { buildCompliancePlaybooksSnapshot } from '../service-compliance-playbooks.mjs';
import { createCompliancePlaybooksFixtures } from '../fixtures-compliance-playbooks.mjs';

export function createCompliancePlaybooksPublicRoutes(basePath='/public/compliance-playbooks'){const snapshot=buildCompliancePlaybooksSnapshot(); const fixtures=createCompliancePlaybooksFixtures(); return [{id:'compliance-playbooks.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'compliance-playbooks.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'compliance-playbooks.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
