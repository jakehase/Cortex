import { createJourneyAnnotationsWorkspace, summarizeJourneyAnnotations, createJourneyAnnotationsNarratives } from './domain-journey-annotations.mjs';
import { createJourneyAnnotationsPolicies, validateJourneyAnnotationsPolicies, policySummaryJourneyAnnotations } from './domain-journey-annotations-policies.mjs';

export function buildJourneyAnnotationsSnapshot(workspaceName='Late closeout workspace'){const workspace=createJourneyAnnotationsWorkspace(workspaceName); const policies=createJourneyAnnotationsPolicies(); return {workspace,summary:summarizeJourneyAnnotations(workspace),narratives:createJourneyAnnotationsNarratives(workspace),policies,policySummary:policySummaryJourneyAnnotations(policies),validation:validateJourneyAnnotationsPolicies(policies)};}

export function createJourneyAnnotationsChecklist(snapshot=buildJourneyAnnotationsSnapshot()){return [{id:'journey-annotations-check-1',label:'Scope visible',ok:snapshot.summary.metricCount>=3},{id:'journey-annotations-check-2',label:'Policy depth',ok:snapshot.validation.ok},{id:'journey-annotations-check-3',label:'Narratives available',ok:snapshot.narratives.length>=4}];}

export function createJourneyAnnotationsApiDocument(snapshot=buildJourneyAnnotationsSnapshot()){return {id:'journey-annotations-api',headline:snapshot.summary.name+' API contract',endpoints:[{method:'GET',path:'/api/journey-annotations/overview'},{method:'POST',path:'/api/journey-annotations/validate'},{method:'GET',path:'/api/journey-annotations/policies'}],checklist:createJourneyAnnotationsChecklist(snapshot)};}
