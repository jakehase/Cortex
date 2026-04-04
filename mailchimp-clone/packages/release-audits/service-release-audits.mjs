import { createReleaseAuditsWorkspace, summarizeReleaseAudits, createReleaseAuditsNarratives } from './domain-release-audits.mjs';
import { createReleaseAuditsPolicies, validateReleaseAuditsPolicies, policySummaryReleaseAudits } from './domain-release-audits-policies.mjs';

export function buildReleaseAuditsSnapshot(workspaceName='Closeout workspace'){const workspace=createReleaseAuditsWorkspace(workspaceName); const policies=createReleaseAuditsPolicies(); return {workspace,summary:summarizeReleaseAudits(workspace),narratives:createReleaseAuditsNarratives(workspace),policies,policySummary:policySummaryReleaseAudits(policies),validation:validateReleaseAuditsPolicies(policies)};}

export function createReleaseAuditsChecklist(snapshot=buildReleaseAuditsSnapshot()){return [{id:'release-audits-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'release-audits-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'release-audits-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createReleaseAuditsApiDocument(snapshot=buildReleaseAuditsSnapshot()){return {id:'release-audits-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/release-audits/overview'},{method:'POST',path:'/api/release-audits/validate'},{method:'GET',path:'/api/release-audits/policies'}],checklist:createReleaseAuditsChecklist(snapshot)};}
