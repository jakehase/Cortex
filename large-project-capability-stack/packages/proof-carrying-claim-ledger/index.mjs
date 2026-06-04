function stableList(list = []) {
  return [...new Set((Array.isArray(list) ? list : [list])
    .filter((entry) => entry !== undefined && entry !== null && `${entry}`.trim() !== '')
    .map((entry) => `${entry}`.trim()))].sort();
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map((entry) => stableCanonical(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableCanonical(value[key])]));
  }
  return value;
}

function stableFingerprint(value) {
  const input = JSON.stringify(stableCanonical(value));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `claim_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function boolFrom(...values) {
  return values.some((value) => value === true || value === 'true' || value === 'yes');
}

function nestedMetadata(patch = {}) {
  return patch.metadata?.implementation?.metadata || patch.metadata?.result?.metadata || {};
}

function planEvidenceFor(patch = {}) {
  const meta = nestedMetadata(patch);
  return patch.metadata?.hierarchicalPlanningEvidence
    || patch.metadata?.planEvidence
    || patch.metadata?.strictHierarchicalPlanningEvidence
    || patch.metadata?.architectureEvidence
    || meta.architectureEvidence
    || {};
}

function architectureEvidenceFor(patch = {}) {
  const meta = nestedMetadata(patch);
  return meta.architectureEvidence || patch.metadata?.architectureEvidence || planEvidenceFor(patch)?.architectureEvidence || {};
}

function implementationClaimIntegrity(patch = {}, admission = {}) {
  const meta = nestedMetadata(patch);
  const claimIntegrity = admission?.details?.semanticProductAdmission?.details?.claimIntegrity
    || admission?.details?.claimIntegrity
    || {};
  const semanticBloatAudit = meta.semanticBloatAudit || patch.metadata?.semanticBloatAudit || meta.architectureEvidence?.semanticBloatAudit || claimIntegrity.semanticBloatAudit || null;
  return {
    claimIntegrityKind: String(meta.claimIntegrityKind || claimIntegrity.claimIntegrityKind || ''),
    markerOnlyProductDelta: meta.markerOnlyProductDelta === true || claimIntegrity.markerOnlyProductDelta === true,
    semanticBloatProductDelta: semanticBloatAudit?.semanticBloatSuspect === true || claimIntegrity.semanticBloatProductDelta === true,
    semanticBloatAudit
  };
}

function verifierEvidence(verifierResults = [], admission = {}) {
  const normalized = (verifierResults || []).map((result) => ({
    verifier: result.verifier || 'unknown',
    ok: result.ok !== false,
    skipped: result.skipped === true,
    reason: result.reason || null
  }));
  const nonSkippedPass = normalized.some((result) => result.ok && !result.skipped);
  return {
    results: normalized,
    nonSkippedPass,
    admissible: nonSkippedPass || admission?.details?.admissibleVerifierEvidence === true
  };
}

function patchModifiedFiles(patch = {}, admission = {}) {
  return stableList([
    ...(patch.filePaths || []),
    ...(patch.metadata?.implementation?.modifiedFiles || []),
    ...(patch.metadata?.modifiedFiles || []),
    ...(patch.metadata?.result?.modifiedFiles || []),
    ...(admission?.details?.modifiedFiles || [])
  ]);
}

function targetFilesFor(patch = {}, admission = {}) {
  const contract = admission?.details?.assignmentContract || patch.metadata?.assignmentContract || {};
  return stableList([...(contract.targetFiles || []), ...(contract.targetModules || [])]);
}

function touchedTargetFilesFor(patch = {}, admission = {}) {
  return stableList(admission?.details?.touchedTargetFiles || admission?.details?.touchedProductTargetFiles || []);
}

function proofClaimInput(patch = {}) {
  const meta = nestedMetadata(patch);
  return patch.metadata?.proofCarryingClaim
    || patch.metadata?.claimLedgerClaim
    || meta.proofCarryingClaim
    || meta.claimLedgerClaim
    || patch.metadata?.claim
    || {};
}

function defaultCounterexamples({ claim, modifiedFiles, targetFiles }) {
  const generated = [];
  if (!modifiedFiles.length) generated.push('no surviving modified files after admission');
  if (targetFiles.length && !claim.touchedTargetFiles.length) generated.push('diff may not touch the assignment source of truth');
  if (!claim.evidence.nonSkippedVerifierPass) generated.push('verifier evidence may be skipped or absent');
  if (!claim.negativeSpace.reducedGaps.length && !claim.negativeSpace.remainingGaps) generated.push('negative space reduction is not named');
  if (!claim.sourceOfTruthIntegrated) generated.push('runtime/source-of-truth integration is not proven');
  return generated;
}

export const DEFAULT_PROOF_CARRYING_CLAIM_POLICY = Object.freeze({
  requireTargetDelta: true,
  requireNonSkippedVerifier: true,
  requireNegativeSpaceReduction: true,
  requireSourceOfTruthIntegration: true,
  requireCounterexamples: true,
  requireNoKnownFakeGreen: true
});

export function normalizeProofCarryingPatchClaim(patch = {}, { verifierResults = [], admission = {}, policy = {} } = {}) {
  const config = { ...DEFAULT_PROOF_CARRYING_CLAIM_POLICY, ...(policy || {}) };
  const meta = nestedMetadata(patch);
  const input = proofClaimInput(patch);
  const planEvidence = planEvidenceFor(patch);
  const architectureEvidence = architectureEvidenceFor(patch);
  const integrity = implementationClaimIntegrity(patch, admission);
  const modifiedFiles = patchModifiedFiles(patch, admission);
  const targetFiles = targetFilesFor(patch, admission);
  const touchedTargetFiles = touchedTargetFilesFor(patch, admission);
  const evidence = verifierEvidence(verifierResults, admission);
  const reducedGaps = stableList(input.reducedGaps || planEvidence.reducedGaps || architectureEvidence.reducedGaps || []);
  const remainingGaps = String(input.remainingGaps || planEvidence.remainingGaps || architectureEvidence.remainingGaps || '').trim();
  const sourceOfTruthIntegrated = boolFrom(
    input.sourceOfTruthIntegrated,
    input.runtimeIntegrated,
    planEvidence.sourceOfTruthIntegrated,
    planEvidence.runtimeIntegrated,
    planEvidence.integrationVerified,
    planEvidence.primaryRuntimeAdopted,
    architectureEvidence.runtimeIntegrated,
    architectureEvidence.runtimeIntegrationEvidence?.ok
  );
  const negativeSpaceReduced = boolFrom(input.negativeSpaceReduced, planEvidence.negativeSpaceReduced, architectureEvidence.negativeSpaceReduced) || reducedGaps.length > 0 || Boolean(remainingGaps);
  const surfaceIds = stableList([
    ...(Array.isArray(input.surfaceIds) ? input.surfaceIds : [input.surfaceIds]),
    ...(Array.isArray(patch.metadata?.surfaceIds) ? patch.metadata.surfaceIds : [patch.metadata?.surfaceIds]),
    ...(Array.isArray(patch.metadata?.contextPack?.shard?.surfaceIds) ? patch.metadata.contextPack.shard.surfaceIds : [patch.metadata?.contextPack?.shard?.surfaceIds]),
    meta.surfaceId,
    architectureEvidence.surfaceId
  ]);
  const claim = {
    id: input.id || stableFingerprint({ patchId: patch.id, shardId: patch.shardId, targetFiles, reducedGaps, remainingGaps }),
    kind: 'proof_carrying_patch_claim',
    patchId: patch.id || null,
    shardId: patch.shardId || null,
    taskId: patch.taskId || patch.shardId || null,
    agentId: patch.agentId || input.agentId || null,
    statement: input.statement || input.claim || `Patch ${patch.id || patch.shardId || 'unknown'} claims scoped progress on ${targetFiles.slice(0, 3).join(', ') || 'its assignment target'}`,
    requestedCredit: input.requestedCredit || 'surviving_product_credit',
    surfaceIds,
    targetFiles,
    modifiedFiles,
    touchedTargetFiles,
    negativeSpace: {
      reduced: negativeSpaceReduced,
      reducedGaps,
      remainingGaps
    },
    sourceOfTruthIntegrated,
    counterexamplesConsidered: stableList(input.counterexamplesConsidered || input.counterexamples || planEvidence.counterexamplesConsidered || []),
    evidence: {
      verifierResults: evidence.results,
      nonSkippedVerifierPass: evidence.nonSkippedPass,
      admissibleVerifierEvidence: evidence.admissible,
      admissionOk: admission?.ok === true,
      admissionReason: admission?.reason || null,
      architectureEvidenceOk: architectureEvidence.ok === true || architectureEvidence.runtimeIntegrationEvidence?.ok === true,
      proofArtifacts: stableList(input.proofArtifacts || patch.metadata?.proofArtifacts || planEvidence.proofArtifacts || [])
    },
    fakeGreenSignals: stableList([
      integrity.markerOnlyProductDelta ? 'marker_only_product_delta' : null,
      integrity.semanticBloatProductDelta ? 'semantic_bloat_product_delta' : null,
      admission?.ok === false ? `admission_failed:${admission.reason || 'unknown'}` : null
    ].filter(Boolean)),
    policy: config
  };
  if (!claim.counterexamplesConsidered.length) claim.generatedCounterexamples = defaultCounterexamples({ claim, modifiedFiles, targetFiles });
  return claim;
}

function makeChallenge({ id, passed, severity = 'fatal', question, evidence = {}, recoveryAction }) {
  return {
    id,
    challengerRole: 'adversarial_verifier',
    severity,
    status: passed ? 'survived' : 'sustained',
    passed: Boolean(passed),
    question,
    evidence,
    recoveryAction: recoveryAction || 'return_to_microplan_with_explicit_evidence'
  };
}

export function createPatchClaim(patch = {}, options = {}) {
  return normalizeProofCarryingPatchClaim(patch, options);
}

export function attachVerifierProof(claim = {}, proof = {}) {
  const proofList = Array.isArray(proof) ? proof : [proof];
  const normalized = verifierEvidence(proofList, { details: { admissibleVerifierEvidence: claim.evidence?.admissibleVerifierEvidence } });
  const verifierResults = [...(claim.evidence?.verifierResults || []), ...normalized.results];
  const nonSkippedVerifierPass = Boolean(claim.evidence?.nonSkippedVerifierPass || normalized.nonSkippedPass);
  const admissibleVerifierEvidence = Boolean(claim.evidence?.admissibleVerifierEvidence || normalized.admissible || nonSkippedVerifierPass);
  return {
    ...claim,
    evidence: {
      ...(claim.evidence || {}),
      verifierResults,
      nonSkippedVerifierPass,
      admissibleVerifierEvidence
    }
  };
}

export function createAdversarialChallenge({ id, passed = false, severity = 'fatal', question, evidence = {}, recoveryAction } = {}) {
  return makeChallenge({
    id: id || stableFingerprint({ question, evidence, recoveryAction }),
    passed,
    severity,
    question: question || 'Adversarial challenge did not provide a question.',
    evidence,
    recoveryAction
  });
}

export function recordChallengeOutcome(recordOrClaim = {}, challenge = {}) {
  const claim = recordOrClaim.claim || (recordOrClaim.kind === 'proof_carrying_patch_claim' ? recordOrClaim : null);
  const priorChallenges = Array.isArray(recordOrClaim.challenges) ? recordOrClaim.challenges : [];
  const challengeRecord = challenge.status ? challenge : createAdversarialChallenge(challenge);
  const challenges = [...priorChallenges, challengeRecord];
  const sustained = challenges.filter((entry) => entry.status === 'sustained');
  const fatalSustained = sustained.filter((entry) => entry.severity === 'fatal');
  const survived = fatalSustained.length === 0;
  return {
    id: recordOrClaim.id || claim?.id || stableFingerprint({ claim, challenges }),
    generatedAt: recordOrClaim.generatedAt || new Date().toISOString(),
    patchId: recordOrClaim.patchId || claim?.patchId || null,
    shardId: recordOrClaim.shardId || claim?.shardId || null,
    taskId: recordOrClaim.taskId || claim?.taskId || null,
    agentId: recordOrClaim.agentId || claim?.agentId || null,
    surfaceIds: recordOrClaim.surfaceIds || claim?.surfaceIds || [],
    status: survived ? 'survived' : 'counterclaimed',
    creditStatus: survived ? 'surviving_credit' : 'credit_blocked_by_adversary',
    ...(claim ? { claim } : {}),
    challenges,
    summary: {
      challengeCount: challenges.length,
      survivedChallengeCount: challenges.length - sustained.length,
      sustainedChallengeCount: sustained.length,
      fatalSustainedChallengeCount: fatalSustained.length,
      survivalRate: round(challenges.length ? (challenges.length - sustained.length) / challenges.length : 1),
      sustainedChallengeIds: sustained.map((entry) => entry.id),
      fatalSustainedChallengeIds: fatalSustained.map((entry) => entry.id)
    }
  };
}

export function buildAdversarialPatchClaimChallenges(claim = {}, { policy = {} } = {}) {
  const config = { ...DEFAULT_PROOF_CARRYING_CLAIM_POLICY, ...(claim.policy || {}), ...(policy || {}) };
  const counterexamples = stableList(claim.counterexamplesConsidered || []);
  const generatedCounterexamples = stableList(claim.generatedCounterexamples || []);
  return [
    makeChallenge({
      id: 'target_delta_survives',
      severity: config.requireTargetDelta ? 'fatal' : 'warning',
      passed: claim.modifiedFiles.length > 0 && (claim.targetFiles.length === 0 || claim.touchedTargetFiles.length > 0),
      question: 'Does the patch have surviving modified files inside the assignment source-of-truth target?',
      evidence: { modifiedFiles: claim.modifiedFiles, targetFiles: claim.targetFiles, touchedTargetFiles: claim.touchedTargetFiles },
      recoveryAction: 'split_to_target_owned_product_delta'
    }),
    makeChallenge({
      id: 'verifier_evidence_survives',
      severity: config.requireNonSkippedVerifier ? 'fatal' : 'warning',
      passed: claim.evidence.nonSkippedVerifierPass === true || claim.evidence.admissibleVerifierEvidence === true,
      question: 'Is there executable verifier evidence rather than skipped or absent proof?',
      evidence: { verifierResults: claim.evidence.verifierResults },
      recoveryAction: 'run_or_add_non_skipped_verifier'
    }),
    makeChallenge({
      id: 'negative_space_reduced',
      severity: config.requireNegativeSpaceReduction ? 'fatal' : 'warning',
      passed: claim.negativeSpace.reduced === true,
      question: 'Which missing behavior, risk, or unknown is smaller after this patch?',
      evidence: claim.negativeSpace,
      recoveryAction: 'name_reduced_gap_and_remaining_gap_before_credit'
    }),
    makeChallenge({
      id: 'source_of_truth_integrated',
      severity: config.requireSourceOfTruthIntegration ? 'fatal' : 'warning',
      passed: claim.sourceOfTruthIntegrated === true,
      question: 'Is the change consumed by the runtime/API/data/user path that owns the surface?',
      evidence: { sourceOfTruthIntegrated: claim.sourceOfTruthIntegrated, architectureEvidenceOk: claim.evidence.architectureEvidenceOk },
      recoveryAction: 'wire_patch_into_primary_runtime_boundary'
    }),
    makeChallenge({
      id: 'counterexamples_named',
      severity: config.requireCounterexamples ? 'fatal' : 'warning',
      passed: counterexamples.length > 0,
      question: 'Did the builder name counterexamples or fake-green modes before asking for credit?',
      evidence: { counterexamples, generatedCounterexamples },
      recoveryAction: 'attach_counterexamples_considered_to_claim'
    }),
    makeChallenge({
      id: 'no_known_fake_green',
      severity: config.requireNoKnownFakeGreen ? 'fatal' : 'warning',
      passed: claim.fakeGreenSignals.length === 0,
      question: 'Did admission or metadata detect marker-only, semantic-bloat, or other fake-green signals?',
      evidence: { fakeGreenSignals: claim.fakeGreenSignals },
      recoveryAction: 'reject_fake_green_and_replan'
    })
  ];
}

export async function evaluateProofCarryingPatchClaim(patch = {}, { verifierResults = [], admission = {}, policy = {}, adversarialVerifiers = {} } = {}) {
  const claim = normalizeProofCarryingPatchClaim(patch, { verifierResults, admission, policy });
  const builtInChallenges = buildAdversarialPatchClaimChallenges(claim, { policy });
  const externalChallenges = [];
  for (const [id, verifier] of Object.entries(adversarialVerifiers || {})) {
    const result = await verifier({ claim, patch, verifierResults, admission });
    externalChallenges.push(makeChallenge({
      id,
      severity: result?.severity || 'fatal',
      passed: result?.ok !== false,
      question: result?.question || `External adversary ${id}`,
      evidence: result?.evidence || result || {},
      recoveryAction: result?.recoveryAction || 'address_external_adversarial_finding'
    }));
  }
  const challenges = [...builtInChallenges, ...externalChallenges];
  const sustained = challenges.filter((challenge) => challenge.status === 'sustained');
  const fatalSustained = sustained.filter((challenge) => challenge.severity === 'fatal');
  const survived = fatalSustained.length === 0;
  const record = {
    id: claim.id,
    generatedAt: new Date().toISOString(),
    patchId: claim.patchId,
    shardId: claim.shardId,
    taskId: claim.taskId,
    agentId: claim.agentId,
    surfaceIds: claim.surfaceIds,
    status: survived ? 'survived' : 'counterclaimed',
    creditStatus: survived ? 'surviving_credit' : 'credit_blocked_by_adversary',
    claim,
    challenges,
    summary: {
      challengeCount: challenges.length,
      survivedChallengeCount: challenges.length - sustained.length,
      sustainedChallengeCount: sustained.length,
      fatalSustainedChallengeCount: fatalSustained.length,
      survivalRate: round(challenges.length ? (challenges.length - sustained.length) / challenges.length : 1),
      sustainedChallengeIds: sustained.map((challenge) => challenge.id),
      fatalSustainedChallengeIds: fatalSustained.map((challenge) => challenge.id)
    }
  };
  return {
    ok: survived,
    survived,
    record,
    rejectionCategory: survived ? null : 'claim_integrity',
    rejectionReason: survived ? null : `proof_carrying_claim_failed:${fatalSustained.map((challenge) => challenge.id).join(',')}`
  };
}

export function collectClaimLedgerRecords(patchQueue = {}, extraRecords = []) {
  const records = [...(Array.isArray(extraRecords) ? extraRecords : [])];
  for (const patch of [...(patchQueue.merged || []), ...(patchQueue.rejected || [])]) {
    const record = patch.proofCarryingClaimRecord || patch.claimLedgerRecord || null;
    if (record) records.push(record);
  }
  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.id || record.patchId || ''}:${record.patchId || ''}:${record.status || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildProofCarryingClaimLedger({ patchQueue = {}, records = [] } = {}) {
  const entries = collectClaimLedgerRecords(patchQueue, records);
  const byStatus = entries.reduce((acc, record) => {
    acc[record.status] = (acc[record.status] || 0) + 1;
    return acc;
  }, {});
  const surfaces = new Map();
  for (const record of entries) {
    const surfaceIds = record.surfaceIds?.length ? record.surfaceIds : ['unmapped_surface'];
    for (const surfaceId of surfaceIds) {
      if (!surfaces.has(surfaceId)) surfaces.set(surfaceId, { surfaceId, total: 0, survived: 0, counterclaimed: 0, patchIds: [] });
      const entry = surfaces.get(surfaceId);
      entry.total += 1;
      if (record.status === 'survived') entry.survived += 1;
      if (record.status === 'counterclaimed') entry.counterclaimed += 1;
      if (record.patchId) entry.patchIds.push(record.patchId);
    }
  }
  const survivedCount = byStatus.survived || 0;
  const counterclaimedCount = byStatus.counterclaimed || 0;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      claimCount: entries.length,
      survivedCount,
      counterclaimedCount,
      survivalRate: round(entries.length ? survivedCount / entries.length : 1),
      completionEligible: entries.length > 0 && counterclaimedCount === 0 && survivedCount === entries.length,
      status: entries.length === 0 ? 'empty' : counterclaimedCount > 0 ? 'red' : 'green'
    },
    byStatus,
    bySurface: [...surfaces.values()].map((entry) => ({ ...entry, patchIds: stableList(entry.patchIds) })).sort((a, b) => a.surfaceId.localeCompare(b.surfaceId)),
    records: entries
  };
}

export function aggregateClaimLedger(input = {}) {
  return buildProofCarryingClaimLedger(input);
}

export function deriveMergeEligibility(input = {}, policy = {}) {
  const record = input.record || input.claimLedgerRecord || input.evaluation?.record || (input.status || input.creditStatus ? input : null);
  const ledger = input.ledger || input.claimLedger || null;
  const mode = policy.mode || input.mode || 'block_on_failed_claim';
  if (mode === 'off') {
    return { eligible: true, status: 'not_required', reason: 'claim_ledger_off', mode };
  }
  if (mode === 'audit_only') {
    return { eligible: true, status: 'audit_only', reason: 'claim_ledger_audit_only', mode, record: record || null, ledger };
  }
  if (record) {
    const eligible = record.status === 'survived' && record.creditStatus !== 'credit_blocked_by_adversary';
    return {
      eligible,
      status: eligible ? 'eligible' : 'blocked',
      reason: eligible ? 'claim_survived' : `claim_not_survived:${record.status || 'unknown'}`,
      mode,
      record
    };
  }
  if (ledger) {
    const eligible = ledger.summary?.claimCount > 0 && ledger.summary?.counterclaimedCount === 0 && ledger.summary?.status === 'green';
    return {
      eligible,
      status: eligible ? 'eligible' : 'blocked',
      reason: eligible ? 'ledger_green' : `ledger_not_green:${ledger.summary?.status || 'unknown'}`,
      mode,
      ledger
    };
  }
  return { eligible: false, status: 'blocked', reason: 'missing_claim_record', mode };
}
