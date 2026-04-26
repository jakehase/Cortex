import fs from 'node:fs';
import path from 'node:path';

export const FIDELITY_LATTICE = ['prototype', 'production_slice', 'parity_for_scope', 'full_clone'];

function listify(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return String(value).split(/\n|,/).map((entry) => entry.trim()).filter(Boolean);
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function parseTaskContract(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
    out[key] = match[2].trim();
  }
  return out;
}

export function validateTaskContract(contract) {
  const errors = [];
  if (!clean(contract.anchor)) errors.push('anchor is required');
  if (!clean(contract.targetPath)) errors.push('targetPath is required');
  if (!FIDELITY_LATTICE.includes(contract.requestedFidelity)) errors.push('requestedFidelity must be in lattice');
  if (!Array.isArray(contract.requestedScope) || contract.requestedScope.length === 0) errors.push('requestedScope is required');
  if (!clean(contract.stopCondition)) errors.push('stopCondition is required');
  if (!clean(contract.blockerPolicy)) errors.push('blockerPolicy is required');
  if (!Array.isArray(contract.evidenceRequirements) || contract.evidenceRequirements.length === 0) errors.push('evidenceRequirements are required');
  return { ok: errors.length === 0, errors };
}

export function compileTaskContract(input = {}) {
  const parsed = typeof input === 'string' ? parseTaskContract(input) : input;
  const contract = {
    anchor: clean(parsed.anchor),
    replyAnchor: clean(parsed.replyAnchor || parsed.reply_anchor),
    targetPath: clean(parsed.targetPath || parsed.target_path),
    requestedFidelity: clean(parsed.requestedFidelity || parsed.fidelity || 'production_slice'),
    requestedScope: listify(parsed.requestedScope || parsed.scope),
    stopCondition: clean(parsed.stopCondition || parsed.stop_condition || 'supervisor_green_or_blocker_report'),
    blockerPolicy: clean(parsed.blockerPolicy || parsed.blocker_policy || 'require_blocker_report_when_supervisor_red'),
    evidenceRequirements: listify(parsed.evidenceRequirements || parsed.evidence_requirements || 'tests,artifacts,supervisor'),
    implementationSurface: clean(parsed.implementationSurface || parsed.implementation_surface || 'mixed'),
    campaignMode: clean(parsed.campaignMode || parsed.campaign_mode || 'persistent'),
    createdAt: clean(parsed.createdAt) || new Date().toISOString()
  };
  if (contract.targetPath) contract.targetPath = path.resolve(contract.targetPath);
  const validation = validateTaskContract(contract);
  if (!validation.ok) throw new Error(`Invalid task contract: ${validation.errors.join('; ')}`);
  return contract;
}

export function saveContract(filePath, contract) {
  const compiled = compileTaskContract(contract);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(compiled, null, 2));
  return compiled;
}

export function loadContract(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
