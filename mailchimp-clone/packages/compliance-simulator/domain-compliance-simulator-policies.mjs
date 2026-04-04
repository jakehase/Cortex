const DEFAULT_POLICIES=[{id:'compliance-simulator-policy-1',title:'Compliance Simulator guardrail',severity:'medium'},{id:'compliance-simulator-policy-2',title:'Compliance Simulator approval ring',severity:'high'},{id:'compliance-simulator-policy-3',title:'Compliance Simulator rollback lane',severity:'medium'}];

export function createComplianceSimulatorPolicies(overrides={}){return DEFAULT_POLICIES.map((policy,index)=>({...policy,owner:overrides.owner||'closeout-owner',status:overrides.status||(index===1?'watch':'active'),controls:['change-log','approval-ring','rollback-check'].slice(0,index+1),notes:overrides.notes||'Compliance Simulator policy pack for closeout.'}));}

export function validateComplianceSimulatorPolicies(policies=createComplianceSimulatorPolicies()){const issues=[]; if(policies.length<3) issues.push('insufficient_policy_depth'); if(!policies.some((policy)=>policy.severity==='high')) issues.push('missing_high_severity_policy'); if(!policies.every((policy)=>policy.controls.length>=1)) issues.push('missing_controls'); return {ok:issues.length===0,issues,policyCount:policies.length};}

export function policySummaryComplianceSimulator(policies=createComplianceSimulatorPolicies()){return {total:policies.length,watch:policies.filter((policy)=>policy.status==='watch').length,active:policies.filter((policy)=>policy.status==='active').length};}
