const DEFAULT_POLICIES=[{id:'compliance-playbooks-policy-1',title:'Compliance Playbooks guardrail',severity:'medium'},{id:'compliance-playbooks-policy-2',title:'Compliance Playbooks approval ring',severity:'high'},{id:'compliance-playbooks-policy-3',title:'Compliance Playbooks rollback lane',severity:'medium'}];

export function createCompliancePlaybooksPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'final-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Compliance Playbooks policy pack for the continuation.'}));}

export function validateCompliancePlaybooksPolicies(policies=createCompliancePlaybooksPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryCompliancePlaybooks(policies=createCompliancePlaybooksPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
