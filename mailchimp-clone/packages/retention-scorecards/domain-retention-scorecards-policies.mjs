const DEFAULT_POLICIES=[{id:'retention-scorecards-policy-1',title:'Retention Scorecards guardrail',severity:'medium'},{id:'retention-scorecards-policy-2',title:'Retention Scorecards approval ring',severity:'high'},{id:'retention-scorecards-policy-3',title:'Retention Scorecards rollback lane',severity:'medium'}];

export function createRetentionScorecardsPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'final-ladder-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Retention Scorecards policy pack for final laddering.'}));}

export function validateRetentionScorecardsPolicies(policies=createRetentionScorecardsPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryRetentionScorecards(policies=createRetentionScorecardsPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
