export const SLOS_V17_ROLES = Object.freeze([
  'strategist',
  'patch_author',
  'test_writer',
  'adversarial_reviewer',
  'scorer_refiner'
]);

export const SLOS_V17_EXPLORATION_SEEDS = Object.freeze([
  'operator runbook and handoff clarity',
  'fresh replay reproducibility',
  'approval boundary precision',
  'multi-job conflict handling',
  'release-candidate readiness',
  'artifact checksum portability',
  'remote execution-plane proof',
  'rollback dry-run safety',
  'tamper-case failure explainability',
  'operator config validation ergonomics',
  'winner provenance explainability',
  'bounded product-claim wording',
  'role-agent fanout evidence',
  'candidate scoring transparency',
  'validation log discoverability',
  'non-winner proposal quarantine',
  'review bundle navigability',
  'parallel worker health proof',
  'lease and target isolation',
  'human review discipline'
]);

export function candidateId(index) {
  return `candidate_${String(index + 1).padStart(2, '0')}`;
}

export function candidateIds(count = 20) {
  return Array.from({ length: Math.max(1, Math.min(20, Number(count || 20))) }, (_, index) => candidateId(index));
}

export function candidateOrdinal(id = 'candidate_01') {
  const match = String(id || '').match(/candidate_(\d+)/);
  return match ? Math.max(1, Number(match[1])) : 1;
}

export function candidateSeed(id) {
  const index = candidateOrdinal(id) - 1;
  return SLOS_V17_EXPLORATION_SEEDS[index] || SLOS_V17_EXPLORATION_SEEDS.at(-1);
}

export function candidateRoot(id) {
  return `apps/synthetic-labor-os-v17/${id}`;
}

export function candidateTarget(id, runStamp = 'RUN') {
  return `docs/SYNTHETIC_LABOR_OS_V17_${runStamp}_${id.toUpperCase()}.md`;
}

export function candidatePatchPath(id) {
  return `${candidateRoot(id)}/candidate_patch.diff`;
}

export function candidateTestPath(id) {
  return `tests/synthetic-labor-os-v17/${id}.test-plan.md`;
}

export function candidateDesignFiles(id) {
  const root = candidateRoot(id);
  return [
    `${root}/README.md`,
    `${root}/architecture.json`,
    `${root}/role-artifacts/strategy.md`
  ];
}

export function candidatePatchFiles(id) {
  const root = candidateRoot(id);
  return [
    candidatePatchPath(id),
    `${root}/proposal.md`,
    `${root}/role-artifacts/patch-author-notes.md`
  ];
}

export function candidateTestFiles(id) {
  const root = candidateRoot(id);
  return [
    candidateTestPath(id),
    `${root}/role-artifacts/test-plan.md`
  ];
}

export function candidateReviewFiles(id) {
  const root = candidateRoot(id);
  return [
    `${root}/role-artifacts/adversarial-review.md`,
    `${root}/role-artifacts/adversarial-review.json`
  ];
}

export function candidateScoreFiles(id) {
  const root = candidateRoot(id);
  return [
    `${root}/role-artifacts/scorecard.json`,
    `${root}/role-artifacts/refinement-notes.md`
  ];
}

export function allowedFilesForRole(id, role) {
  if (role === 'strategist') return candidateDesignFiles(id);
  if (role === 'patch_author') return candidatePatchFiles(id);
  if (role === 'test_writer') return candidateTestFiles(id);
  if (role === 'adversarial_reviewer') return [...candidatePatchFiles(id), ...candidateTestFiles(id), ...candidateReviewFiles(id)];
  if (role === 'scorer_refiner') return [...candidatePatchFiles(id), ...candidateTestFiles(id), ...candidateReviewFiles(id), ...candidateScoreFiles(id)];
  throw new Error(`Unknown SLOS v17 role: ${role}`);
}

export function allCandidateFiles(id) {
  return [
    ...candidateDesignFiles(id),
    ...candidatePatchFiles(id),
    ...candidateTestFiles(id),
    ...candidateReviewFiles(id),
    ...candidateScoreFiles(id)
  ];
}

export function roleDependencies(id, role) {
  if (role === 'strategist') return [];
  if (role === 'patch_author') return [`${id}__strategist`];
  if (role === 'test_writer') return [`${id}__strategist`, `${id}__patch_author`];
  if (role === 'adversarial_reviewer') return [`${id}__patch_author`, `${id}__test_writer`];
  if (role === 'scorer_refiner') return [`${id}__strategist`, `${id}__patch_author`, `${id}__test_writer`, `${id}__adversarial_reviewer`];
  return [];
}

export function roleVerifiers(role) {
  if (role === 'scorer_refiner') return ['role', 'patch', 'score'];
  return ['role'];
}
