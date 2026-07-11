export const AGENT_WORK_V1_REQUIRED_AUTHORITIES = Object.freeze([
  'objective_grounding',
  'contract_validation',
  'run_admission',
  'inventory_truth',
  'work_graph_compilation',
  'scheduling',
  'lease_fencing',
  'worker_execution',
  'patch_admission',
  'independent_verification',
  'continuation_decision',
  'terminal_truth',
  'claim_packet',
  'notification_delivery'
]);

export function validateAuthorityMatrix(matrix = {}) {
  const errors = [];
  if (matrix.schemaVersion !== 'clawd.agent_work.authority_matrix.v1') errors.push('unsupported authority matrix schemaVersion');
  const decisions = Array.isArray(matrix.decisions) ? matrix.decisions : [];
  const ids = decisions.map((entry) => String(entry.id || '').trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) errors.push('authority decision ids must be unique');
  for (const required of AGENT_WORK_V1_REQUIRED_AUTHORITIES) if (!ids.includes(required)) errors.push(`missing authority decision: ${required}`);
  for (const entry of decisions) {
    if (!String(entry.id || '').trim()) errors.push('authority decision id is required');
    if (!String(entry.authority || '').trim()) errors.push(`authority is required for ${entry.id || '<unknown>'}`);
    if (Array.isArray(entry.authority)) errors.push(`authority must be singular for ${entry.id || '<unknown>'}`);
    if (!String(entry.authorityRule || '').trim()) errors.push(`authorityRule is required for ${entry.id || '<unknown>'}`);
  }
  const terminal = decisions.find((entry) => entry.id === 'terminal_truth');
  const continuation = decisions.find((entry) => entry.id === 'continuation_decision');
  if (terminal && continuation && terminal.authority !== continuation.authority) errors.push('terminal_truth and continuation_decision must share one truth authority in v1');
  return { ok: errors.length === 0, errors, decisionCount: decisions.length };
}

export function validateCanonicalEntrypoints({ packageJson = {}, policy = {} } = {}) {
  const errors = [];
  const scripts = packageJson.scripts || {};
  const prefixes = policy.canonicalProductScriptPrefixes || ['agent-work:'];
  const required = policy.requiredProductScripts || [];
  const canonicalTarget = String(policy.canonicalTargetContains || 'apps/agent-work/cli.mjs');
  for (const script of required) if (!scripts[script]) errors.push(`missing required canonical product script: ${script}`);
  for (const [name, command] of Object.entries(scripts)) {
    if (!prefixes.some((prefix) => name.startsWith(prefix))) continue;
    if (!String(command).includes(canonicalTarget)) errors.push(`canonical product script bypasses facade: ${name}`);
  }
  return { ok: errors.length === 0, errors, inspectedScriptCount: Object.keys(scripts).length };
}

