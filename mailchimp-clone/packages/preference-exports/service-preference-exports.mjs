import { createPreferenceExportsWorkspace, summarizePreferenceExports, createPreferenceExportsNarratives } from './domain-preference-exports.mjs';
import { createPreferenceExportsPolicies, validatePreferenceExportsPolicies, policySummaryPreferenceExports } from './domain-preference-exports-policies.mjs';

export function buildPreferenceExportsSnapshot(workspaceName='Late closeout workspace'){const workspace=createPreferenceExportsWorkspace(workspaceName); const policies=createPreferenceExportsPolicies(); return {workspace,summary:summarizePreferenceExports(workspace),narratives:createPreferenceExportsNarratives(workspace),policies,policySummary:policySummaryPreferenceExports(policies),validation:validatePreferenceExportsPolicies(policies)};}

export function createPreferenceExportsChecklist(snapshot=buildPreferenceExportsSnapshot()){return [{id:'preference-exports-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'preference-exports-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'preference-exports-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createPreferenceExportsApiDocument(snapshot=buildPreferenceExportsSnapshot()){return {id:'preference-exports-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/preference-exports/overview'},{method:'POST',path:'/api/preference-exports/validate'},{method:'GET',path:'/api/preference-exports/policies'}],checklist:createPreferenceExportsChecklist(snapshot)};}
