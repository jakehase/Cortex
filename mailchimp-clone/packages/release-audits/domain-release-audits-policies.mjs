const DEFAULT_POLICIES=[{id:'release-audits-policy-1',title:'Release Audits guardrail',severity:'medium'},{id:'release-audits-policy-2',title:'Release Audits approval ring',severity:'high'},{id:'release-audits-policy-3',title:'Release Audits rollback lane',severity:'medium'}];

export function createReleaseAuditsPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'closeout-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Release Audits policy pack for closeout.'}));}

export function validateReleaseAuditsPolicies(policies=createReleaseAuditsPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryReleaseAudits(policies=createReleaseAuditsPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
