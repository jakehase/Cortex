import { buildCompliancePlaybooksSnapshot } from '../service-compliance-playbooks.mjs';

export function createCompliancePlaybooksDashboardRoutes(basePath='/compliance-playbooks'){const snapshot=buildCompliancePlaybooksSnapshot(); return [{id:'compliance-playbooks.overview',method:'GET',path:basePath,summary:snapshot.summary},{id:'compliance-playbooks.programs',method:'GET',path:basePath+'/programs',programs:snapshot.workspace.programs},{id:'compliance-playbooks.narratives',method:'GET',path:basePath+'/narratives',narratives:snapshot.narratives}];}
