import { createRetentionScorecardsWorkspace, summarizeRetentionScorecards, createRetentionScorecardsNarratives } from './domain-retention-scorecards.mjs';
import { createRetentionScorecardsPolicies, validateRetentionScorecardsPolicies, policySummaryRetentionScorecards } from './domain-retention-scorecards-policies.mjs';

export function buildRetentionScorecardsSnapshot(workspaceName='Final ladder workspace'){const workspace=createRetentionScorecardsWorkspace(workspaceName); const policies=createRetentionScorecardsPolicies(); return {workspace,summary:summarizeRetentionScorecards(workspace),narratives:createRetentionScorecardsNarratives(workspace),policies,policySummary:policySummaryRetentionScorecards(policies),validation:validateRetentionScorecardsPolicies(policies)};}

export function createRetentionScorecardsChecklist(snapshot=buildRetentionScorecardsSnapshot()){return [{id:'retention-scorecards-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'retention-scorecards-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'retention-scorecards-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createRetentionScorecardsApiDocument(snapshot=buildRetentionScorecardsSnapshot()){return {id:'retention-scorecards-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/retention-scorecards/overview'},{method:'POST',path:'/api/retention-scorecards/validate'},{method:'GET',path:'/api/retention-scorecards/policies'}],checklist:createRetentionScorecardsChecklist(snapshot)};}
