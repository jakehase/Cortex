import { createComplianceSimulatorWorkspace, summarizeComplianceSimulator, createComplianceSimulatorNarratives } from './domain-compliance-simulator.mjs';
import { createComplianceSimulatorPolicies, validateComplianceSimulatorPolicies, policySummaryComplianceSimulator } from './domain-compliance-simulator-policies.mjs';

export function buildComplianceSimulatorSnapshot(workspaceName='Closeout workspace'){const workspace=createComplianceSimulatorWorkspace(workspaceName); const policies=createComplianceSimulatorPolicies(); return {workspace,summary:summarizeComplianceSimulator(workspace),narratives:createComplianceSimulatorNarratives(workspace),policies,policySummary:policySummaryComplianceSimulator(policies),validation:validateComplianceSimulatorPolicies(policies)};}

export function createComplianceSimulatorChecklist(snapshot=buildComplianceSimulatorSnapshot()){return [{id:'compliance-simulator-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'compliance-simulator-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'compliance-simulator-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createComplianceSimulatorApiDocument(snapshot=buildComplianceSimulatorSnapshot()){return {id:'compliance-simulator-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/compliance-simulator/overview'},{method:'POST',path:'/api/compliance-simulator/validate'},{method:'GET',path:'/api/compliance-simulator/policies'}],checklist:createComplianceSimulatorChecklist(snapshot)};}
