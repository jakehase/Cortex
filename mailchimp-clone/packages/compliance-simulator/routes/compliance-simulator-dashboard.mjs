import { buildComplianceSimulatorSnapshot } from '../service-compliance-simulator.mjs';

export function createComplianceSimulatorDashboardRoutes(basePath='/compliance-simulator'){const snapshot=buildComplianceSimulatorSnapshot(); return [{id:'compliance-simulator.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'compliance-simulator.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'compliance-simulator.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
