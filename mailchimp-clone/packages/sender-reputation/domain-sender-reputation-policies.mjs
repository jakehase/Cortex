const DEFAULT_POLICIES=[{id:'sender-reputation-policy-1',title:'Sender Reputation guardrail',severity:'medium'},{id:'sender-reputation-policy-2',title:'Sender Reputation approval ring',severity:'high'},{id:'sender-reputation-policy-3',title:'Sender Reputation rollback lane',severity:'medium'}];

export function createSenderReputationPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'final-ladder-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Sender Reputation policy pack for final laddering.'}));}

export function validateSenderReputationPolicies(policies=createSenderReputationPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummarySenderReputation(policies=createSenderReputationPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
