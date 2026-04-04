const DEFAULT_POLICIES=[{id:'journey-annotations-policy-1',title:'Journey Annotations guardrail',severity:'medium'},{id:'journey-annotations-policy-2',title:'Journey Annotations approval ring',severity:'high'},{id:'journey-annotations-policy-3',title:'Journey Annotations rollback lane',severity:'medium'}];

export function createJourneyAnnotationsPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'late-closeout-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Journey Annotations policy pack for late closeout.'}));}

export function validateJourneyAnnotationsPolicies(policies=createJourneyAnnotationsPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryJourneyAnnotations(policies=createJourneyAnnotationsPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
