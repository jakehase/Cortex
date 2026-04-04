import { buildComplianceSimulatorSnapshot } from '../service-compliance-simulator.mjs';
import { createComplianceSimulatorFixtures } from '../fixtures-compliance-simulator.mjs';

export function createComplianceSimulatorPublicRoutes(basePath='/public/compliance-simulator'){const snapshot=buildComplianceSimulatorSnapshot(); const fixtures=createComplianceSimulatorFixtures(); return [{id:'compliance-simulator.public.summary',method:'GET',path:basePath,focus:snapshot.summary.focus},{id:'compliance-simulator.public.catalog',method:'GET',path:basePath+'/catalog',contacts:fixtures.contacts},{id:'compliance-simulator.public.notes',method:'GET',path:basePath+'/notes',notes:fixtures.notes}];}
