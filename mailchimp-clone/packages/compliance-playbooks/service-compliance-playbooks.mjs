import { createCompliancePlaybooksWorkspace, summarizeCompliancePlaybooks, createCompliancePlaybooksNarratives } from './domain-compliance-playbooks.mjs';
import { createCompliancePlaybooksPolicies, validateCompliancePlaybooksPolicies, policySummaryCompliancePlaybooks } from './domain-compliance-playbooks-policies.mjs';

export function buildCompliancePlaybooksSnapshot(workspaceName='Final continuation workspace'){const workspace=createCompliancePlaybooksWorkspace(workspaceName); const policies=createCompliancePlaybooksPolicies(); return {workspace,summary:summarizeCompliancePlaybooks(workspace),narratives:createCompliancePlaybooksNarratives(workspace),policies,policySummary:policySummaryCompliancePlaybooks(policies),validation:validateCompliancePlaybooksPolicies(policies)};}

export function createCompliancePlaybooksChecklist(snapshot=buildCompliancePlaybooksSnapshot()){return [{id:'compliance-playbooks-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'compliance-playbooks-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'compliance-playbooks-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createCompliancePlaybooksApiDocument(snapshot=buildCompliancePlaybooksSnapshot()){return {id:'compliance-playbooks-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/compliance-playbooks/overview'},{method:'POST',path:'/api/compliance-playbooks/validate'},{method:'GET',path:'/api/compliance-playbooks/policies'}],checklist:createCompliancePlaybooksChecklist(snapshot)};}
