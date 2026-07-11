import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const FPE_OBJECTIVE_SCHEMA = 'clawd.full_parity.objective_contract.v0';
export const FPE_INVENTORY_SCHEMA = 'clawd.full_parity.inventory.v0';
export const FPE_NEGATIVE_SPACE_SCHEMA = 'clawd.full_parity.negative_space.v0';
export const FPE_PARITY_MATRIX_SCHEMA = 'clawd.full_parity.parity_matrix.v0';
export const FPE_VERIFIER_MATRIX_SCHEMA = 'clawd.full_parity.verifier_matrix.v0';
export const FPE_WORK_GRAPH_SCHEMA = 'clawd.full_parity.work_graph.v0';
export const FPE_SUPERVISOR_SCHEMA = 'clawd.full_parity.supervisor_truth.v0';
export const FPE_CLAIM_PACKET_SCHEMA = 'clawd.full_parity.claim_packet.v0';
export const FIDELITY_LEVELS = Object.freeze(['prototype', 'production_slice', 'parity_for_scope', 'full_clone']);

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').trim()).filter(Boolean))];
}

function slug(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'surface';
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

export function bindObjectiveContract(input = {}) {
  const contract = {
    schemaVersion: FPE_OBJECTIVE_SCHEMA,
    objectiveId: slug(input.objectiveId || input.objective || input.anchor),
    anchor: String(input.anchor || '').trim(),
    replyAnchor: input.replyAnchor ? String(input.replyAnchor).trim() : null,
    targetPath: String(input.targetPath || input.repoPath || '').trim(),
    referencePath: input.referencePath ? String(input.referencePath).trim() : null,
    fidelity: String(input.fidelity || '').trim(),
    scope: stableList(input.scope),
    implementationSurface: String(input.implementationSurface || '').trim(),
    stopCondition: String(input.stopCondition || '').trim(),
    doneWhen: stableList(input.doneWhen),
    externalWritesAllowed: input.externalWritesAllowed === true,
    metadata: input.metadata || {}
  };
  const errors = [];
  for (const key of ['anchor', 'targetPath', 'implementationSurface', 'stopCondition']) {
    if (!contract[key]) errors.push(`${key} is required`);
  }
  if (!FIDELITY_LEVELS.includes(contract.fidelity)) errors.push(`fidelity must be one of ${FIDELITY_LEVELS.join(', ')}`);
  if (!contract.scope.length) errors.push('scope must contain at least one surface or program');
  if (!contract.doneWhen.length) errors.push('doneWhen must contain at least one acceptance condition');
  return { ok: errors.length === 0, errors, contract };
}

function normalizeSurface(surface = {}, index = 0) {
  const id = slug(surface.id || surface.surfaceId || surface.name || `surface_${index + 1}`);
  return {
    id,
    label: String(surface.label || surface.name || id),
    kind: String(surface.kind || surface.type || 'product_surface'),
    required: surface.required !== false,
    files: stableList(surface.files || surface.productFiles),
    routes: stableList(surface.routes),
    states: stableList(surface.states),
    permissions: stableList(surface.permissions),
    integrations: stableList(surface.integrations),
    verifiers: stableList(surface.verifiers || surface.verify || surface.tests),
    evidence: stableList(surface.evidence),
    confidence: Number.isFinite(Number(surface.confidence)) ? Math.max(0, Math.min(1, Number(surface.confidence))) : null,
    metadata: surface.metadata || {}
  };
}

export function buildInventory({ source, targetPath, surfaces = [], metadata = {} } = {}) {
  const normalized = surfaces.map(normalizeSurface).sort((a, b) => a.id.localeCompare(b.id));
  const ids = normalized.map((row) => row.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  return {
    schemaVersion: FPE_INVENTORY_SCHEMA,
    source: String(source || 'unknown'),
    targetPath: String(targetPath || ''),
    surfaceCount: normalized.length,
    duplicateIds: [...new Set(duplicateIds)],
    surfaces: normalized,
    digest: sha256(normalized),
    metadata
  };
}

export function computeParity({ objective, referenceInventory, implementationInventory, verifierResults = {} } = {}) {
  const bound = objective?.schemaVersion === FPE_OBJECTIVE_SCHEMA ? { ok: true, errors: [], contract: objective } : bindObjectiveContract(objective);
  if (!bound.ok) throw new Error(`invalid objective contract: ${bound.errors.join('; ')}`);
  const reference = referenceInventory?.schemaVersion === FPE_INVENTORY_SCHEMA ? referenceInventory : buildInventory(referenceInventory);
  const implementation = implementationInventory?.schemaVersion === FPE_INVENTORY_SCHEMA ? implementationInventory : buildInventory(implementationInventory);
  if (reference.duplicateIds.length || implementation.duplicateIds.length) throw new Error('inventory surface ids must be unique');
  const implementedById = new Map(implementation.surfaces.map((surface) => [surface.id, surface]));
  const rows = reference.surfaces.map((expected) => {
    const actual = implementedById.get(expected.id) || null;
    const evidence = stableList(actual?.evidence);
    const observed = Boolean(actual && evidence.length);
    const status = observed ? 'observed' : actual ? 'estimated' : 'missing';
    const confidence = observed ? (actual.confidence ?? 1) : actual ? (actual.confidence ?? 0.5) : 0;
    const requiredVerifiers = expected.verifiers;
    const verifierRows = requiredVerifiers.map((id) => ({ id, status: verifierResults[id]?.status || 'not_run', evidence: stableList(verifierResults[id]?.evidence) }));
    return {
      surfaceId: expected.id,
      label: expected.label,
      kind: expected.kind,
      required: expected.required,
      status,
      confidence,
      missing: status !== 'observed',
      expected,
      implementation: actual,
      evidence,
      requiredVerifiers,
      verifierStatus: verifierRows,
      verifierGreen: requiredVerifiers.length > 0 && verifierRows.every((row) => row.status === 'passed' && row.evidence.length > 0)
    };
  });
  const negativeRows = rows.filter((row) => row.required && (row.status !== 'observed' || !row.requiredVerifiers.length));
  const missingRows = rows.filter((row) => row.required && row.status === 'missing');
  const uncertainRows = rows.filter((row) => row.required && row.status === 'estimated');
  const unverifiedRows = rows.filter((row) => row.required && !row.verifierGreen);
  const matrix = {
    schemaVersion: FPE_PARITY_MATRIX_SCHEMA,
    objectiveId: bound.contract.objectiveId,
    fidelity: bound.contract.fidelity,
    referenceDigest: reference.digest,
    implementationDigest: implementation.digest,
    surfaceCount: rows.length,
    observedCount: rows.filter((row) => row.status === 'observed').length,
    estimatedCount: uncertainRows.length,
    missingCount: missingRows.length,
    verifiedCount: rows.filter((row) => row.verifierGreen).length,
    rows
  };
  const negativeSpace = {
    schemaVersion: FPE_NEGATIVE_SPACE_SCHEMA,
    objectiveId: bound.contract.objectiveId,
    gapCount: negativeRows.length,
    gaps: negativeRows.map((row) => ({
      surfaceId: row.surfaceId,
      status: row.status,
      reason: row.status !== 'observed' ? 'surface_not_observed_with_evidence' : 'surface_has_no_declared_verifier',
      requiredVerifiers: row.requiredVerifiers
    }))
  };
  const verifierMatrix = {
    schemaVersion: FPE_VERIFIER_MATRIX_SCHEMA,
    objectiveId: bound.contract.objectiveId,
    surfaceCount: rows.length,
    uncoveredSurfaceIds: rows.filter((row) => row.required && !row.requiredVerifiers.length).map((row) => row.surfaceId),
    rows: rows.map((row) => ({ surfaceId: row.surfaceId, required: row.required, verifiers: row.verifierStatus, green: row.verifierGreen }))
  };
  const workGraph = {
    schemaVersion: FPE_WORK_GRAPH_SCHEMA,
    objectiveId: bound.contract.objectiveId,
    status: negativeRows.length ? 'work_remaining' : 'inventory_green',
    taskCount: negativeRows.length,
    tasks: negativeRows.map((row, index) => ({
      id: `fpe_${String(index + 1).padStart(3, '0')}_${row.surfaceId}`,
      surfaceId: row.surfaceId,
      goal: row.status === 'observed' ? `Add independent verifier coverage for ${row.label}` : `Implement and evidence ${row.label}`,
      allowedFiles: row.expected.files,
      verification: row.requiredVerifiers,
      deps: []
    }))
  };
  const parityGreen = missingRows.length === 0 && uncertainRows.length === 0 && unverifiedRows.length === 0 && rows.length > 0;
  const supervisorTruth = {
    schemaVersion: FPE_SUPERVISOR_SCHEMA,
    objectiveId: bound.contract.objectiveId,
    status: parityGreen ? 'green' : 'red',
    parityGreen,
    stopAllowed: parityGreen,
    stopReason: parityGreen ? 'parity_matrix_green' : 'gap_inventory_emitted',
    missingSurfaceIds: missingRows.map((row) => row.surfaceId),
    uncertainSurfaceIds: uncertainRows.map((row) => row.surfaceId),
    unverifiedSurfaceIds: unverifiedRows.map((row) => row.surfaceId)
  };
  const allowedClaims = ['objective_grounded', 'reference_inventory_generated', 'implementation_inventory_generated', 'gap_inventory_generated'];
  if (parityGreen) allowedClaims.push(bound.contract.fidelity === 'full_clone' ? 'full_clone' : 'parity_for_declared_scope');
  const claimPacket = {
    schemaVersion: FPE_CLAIM_PACKET_SCHEMA,
    objectiveId: bound.contract.objectiveId,
    claimStatus: parityGreen ? 'allowed_for_fidelity' : 'downgraded',
    allowedClaims,
    rejectedClaims: parityGreen ? [] : ['parity_complete', 'full_clone'],
    truthBoundary: parityGreen
      ? `Parity is green only for the bound ${bound.contract.fidelity} objective and supplied reference inventory.`
      : 'Inventories and gaps are proven; implementation parity and full-clone completion are not proven.'
  };
  return { objective: bound.contract, referenceInventory: reference, implementationInventory: implementation, negativeSpace, parityMatrix: matrix, verifierMatrix, workGraph, supervisorTruth, claimPacket };
}

export function writeParityArtifacts(result, artifactRoot) {
  const files = {
    objectiveContract: writeJson(path.join(artifactRoot, 'objective_contract.json'), result.objective),
    referenceInventory: writeJson(path.join(artifactRoot, 'reference_inventory.json'), result.referenceInventory),
    implementationInventory: writeJson(path.join(artifactRoot, 'implementation_inventory.json'), result.implementationInventory),
    negativeSpace: writeJson(path.join(artifactRoot, 'negative_space_inventory.json'), result.negativeSpace),
    parityMatrix: writeJson(path.join(artifactRoot, 'parity_matrix.json'), result.parityMatrix),
    verifierMatrix: writeJson(path.join(artifactRoot, 'verifier_matrix.json'), result.verifierMatrix),
    workGraph: writeJson(path.join(artifactRoot, 'work_graph.json'), result.workGraph),
    supervisorTruth: writeJson(path.join(artifactRoot, 'supervisor_truth.json'), result.supervisorTruth),
    claimPacket: writeJson(path.join(artifactRoot, 'claim_packet.json'), result.claimPacket)
  };
  writeJson(path.join(artifactRoot, 'artifact_manifest.json'), {
    schemaVersion: 'clawd.full_parity.artifact_manifest.v0',
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, { path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }]))
  });
  return files;
}
