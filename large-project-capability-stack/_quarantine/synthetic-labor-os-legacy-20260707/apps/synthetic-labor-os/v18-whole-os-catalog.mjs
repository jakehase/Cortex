export const SLOS_V18_ROLES = Object.freeze([
  'systems_architect',
  'runtime_implementer',
  'test_engineer',
  'adversarial_reviewer',
  'release_scorer'
]);

export const SLOS_V18_VARIANT_THEMES = Object.freeze([
  'operator command center for live jobs',
  'execution-plane registry and remote proof clarity',
  'provenance drilldown and patch lineage',
  'approval boundary and apply-gate ergonomics',
  'job lifecycle recovery and stuck-work visibility',
  'release-candidate gate honesty',
  'multi-job conflict handling UX',
  'artifact bundle portability and checksums',
  'fresh replay reproducibility workflow',
  'doctor diagnostics for operator config',
  'rollback dry-run and revert safety',
  'tamper-case explainability',
  'agent fanout and concurrency evidence',
  'candidate scoring transparency',
  'validation log discoverability',
  'non-winner quarantine discipline',
  'review bundle navigation',
  'worker health and lease audit',
  'bounded product-claim wording enforcement',
  'human review discipline and handoff clarity'
]);

export const SLOS_V18_ALLOWED_PATCH_PATHS = Object.freeze([
  'package.json',
  'packages/synthetic-labor-os/index.mjs',
  'apps/synthetic-labor-os/apply-patch-gate.mjs',
  'apps/synthetic-labor-os/job-lifecycle.mjs',
  'apps/synthetic-labor-os/local-runner.mjs',
  'apps/synthetic-labor-os/operator-console.mjs',
  'apps/synthetic-labor-os/operator-dashboard.mjs',
  'apps/synthetic-labor-os/proof-harness.mjs',
  'apps/synthetic-labor-os/remote-dispatcher.mjs',
  'docs/SYNTHETIC_LABOR_OS_V0.md',
  'tests/synthetic-labor-os.test.mjs',
  'tests/synthetic-labor-os-remote-smoke.test.mjs'
]);

export const SLOS_V18_RUNTIME_PATCH_PATHS = Object.freeze([
  'packages/synthetic-labor-os/index.mjs',
  'apps/synthetic-labor-os/apply-patch-gate.mjs',
  'apps/synthetic-labor-os/job-lifecycle.mjs',
  'apps/synthetic-labor-os/local-runner.mjs',
  'apps/synthetic-labor-os/operator-console.mjs',
  'apps/synthetic-labor-os/operator-dashboard.mjs',
  'apps/synthetic-labor-os/proof-harness.mjs',
  'apps/synthetic-labor-os/remote-dispatcher.mjs'
]);

export const SLOS_V18_TEST_PATCH_PATHS = Object.freeze([
  'tests/synthetic-labor-os.test.mjs',
  'tests/synthetic-labor-os-remote-smoke.test.mjs'
]);

export const SLOS_V18_SOURCE_SNAPSHOT_FILES = Object.freeze([
  ...SLOS_V18_ALLOWED_PATCH_PATHS,
  'apps/system-benchmark/audit-synthetic-labor-os-v0.mjs',
  'apps/synthetic-labor-os/v15-release-candidate.mjs',
  'apps/synthetic-labor-os/v16-iteration-tournament.mjs',
  'apps/synthetic-labor-os/v17-role-tournament.mjs',
  'apps/synthetic-labor-os/v17-role-tournament-remote.mjs',
  'apps/synthetic-labor-os/v17-role-verifier.mjs'
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

export function candidateTheme(id) {
  const index = candidateOrdinal(id) - 1;
  return SLOS_V18_VARIANT_THEMES[index] || SLOS_V18_VARIANT_THEMES.at(-1);
}

export function candidateRoot(id) {
  return `apps/synthetic-labor-os-v18/${id}`;
}

export function candidatePatchPath(id) {
  return `${candidateRoot(id)}/whole_os_candidate.patch`;
}

export function candidateTestPlanPath(id) {
  return `tests/synthetic-labor-os-v18/${id}.test-plan.md`;
}

export function candidateDesignFiles(id) {
  const root = candidateRoot(id);
  return [
    `${root}/README.md`,
    `${root}/architecture.json`,
    `${root}/role-artifacts/systems-architect-brief.md`
  ];
}

export function candidateImplementationFiles(id) {
  const root = candidateRoot(id);
  return [
    candidatePatchPath(id),
    `${root}/proposal.md`,
    `${root}/role-artifacts/runtime-implementer-notes.md`
  ];
}

export function candidateTestFiles(id) {
  const root = candidateRoot(id);
  return [
    candidatePatchPath(id),
    candidateTestPlanPath(id),
    `${root}/role-artifacts/test-engineer-notes.md`
  ];
}

export function candidateReviewFiles(id) {
  const root = candidateRoot(id);
  return [
    candidatePatchPath(id),
    `${root}/role-artifacts/adversarial-review.md`,
    `${root}/role-artifacts/adversarial-review.json`
  ];
}

export function candidateScoreFiles(id) {
  const root = candidateRoot(id);
  return [
    candidatePatchPath(id),
    `${root}/role-artifacts/scorecard.json`,
    `${root}/role-artifacts/refinement-notes.md`
  ];
}

export function allowedFilesForRole(id, role) {
  if (role === 'systems_architect') return candidateDesignFiles(id);
  if (role === 'runtime_implementer') return candidateImplementationFiles(id);
  if (role === 'test_engineer') return candidateTestFiles(id);
  if (role === 'adversarial_reviewer') return candidateReviewFiles(id);
  if (role === 'release_scorer') return candidateScoreFiles(id);
  throw new Error(`Unknown SLOS v18 role: ${role}`);
}

export function allCandidateFiles(id) {
  return [
    ...candidateDesignFiles(id),
    ...candidateImplementationFiles(id),
    candidateTestPlanPath(id),
    `${candidateRoot(id)}/role-artifacts/test-engineer-notes.md`,
    `${candidateRoot(id)}/role-artifacts/adversarial-review.md`,
    `${candidateRoot(id)}/role-artifacts/adversarial-review.json`,
    `${candidateRoot(id)}/role-artifacts/scorecard.json`,
    `${candidateRoot(id)}/role-artifacts/refinement-notes.md`
  ];
}

export function roleDependencies(id, role) {
  if (role === 'systems_architect') return [];
  if (role === 'runtime_implementer') return [`${id}__systems_architect`];
  if (role === 'test_engineer') return [`${id}__systems_architect`, `${id}__runtime_implementer`];
  if (role === 'adversarial_reviewer') return [`${id}__runtime_implementer`, `${id}__test_engineer`];
  if (role === 'release_scorer') return [`${id}__systems_architect`, `${id}__runtime_implementer`, `${id}__test_engineer`, `${id}__adversarial_reviewer`];
  return [];
}

export function roleVerifiers(role) {
  // Earlier roles should not hard-block the candidate: the next role may repair
  // an invalid patch. The release scorer is the single hard whole-OS gate.
  if (role === 'release_scorer') return ['role', 'patch', 'validation', 'score'];
  return ['role'];
}
