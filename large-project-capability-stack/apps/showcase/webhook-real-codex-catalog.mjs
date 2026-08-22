export const REAL_CODEX_ROLES = Object.freeze(['architect', 'implementer', 'test_writer', 'adversarial_reviewer', 'scorer_refiner']);

export const REAL_CODEX_EXPLORATION_SEEDS = Object.freeze([
  'inbox/outbox replay boundary',
  'hexagonal ports and adapters',
  'clean architecture use cases',
  'CQRS commands and queries',
  'event-sourced aggregate',
  'functional core with imperative shell',
  'explicit lifecycle state machine',
  'domain events and handlers',
  'policy objects for validation/retry',
  'composable middleware pipeline',
  'modular monolith package boundary',
  'repository plus unit of work',
  'actor mailbox facade',
  'vertical slice module',
  'onion architecture',
  'table-driven lifecycle rules',
  'command bus',
  'adapter facade',
  'minimal domain kernel',
  'hybrid production-slice architecture chosen by the agent'
]);

export function candidateId(index) {
  return `candidate_${String(index + 1).padStart(2, '0')}`;
}

export function candidateRoot(id) {
  return `apps/webhook-real-codex/${id}`;
}

export function candidateTestPath(id) {
  return `tests/webhook-real-codex/${id}.test.mjs`;
}

export function candidateSeed(id) {
  const match = String(id || '').match(/candidate_(\d+)/);
  const index = match ? Number(match[1]) - 1 : 0;
  return REAL_CODEX_EXPLORATION_SEEDS[index] || REAL_CODEX_EXPLORATION_SEEDS.at(-1);
}

export function candidateSourceFiles(id) {
  const root = candidateRoot(id);
  return [
    `${root}/src/index.mjs`,
    `${root}/src/domain.mjs`,
    `${root}/src/store.mjs`,
    `${root}/src/service.mjs`,
    `${root}/src/replay.mjs`,
    `${root}/src/adapters.mjs`,
    `${root}/src/policies.mjs`,
    `${root}/src/pipeline.mjs`,
    `${root}/src/ports.mjs`,
    `${root}/src/lifecycle.mjs`
  ];
}

export function candidateDesignFiles(id) {
  const root = candidateRoot(id);
  return [
    `${root}/README.md`,
    `${root}/architecture.json`,
    `${root}/role-artifacts/architect-brief.md`
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
  if (role === 'architect') return candidateDesignFiles(id);
  if (role === 'implementer') return candidateSourceFiles(id);
  if (role === 'test_writer') return [candidateTestPath(id)];
  if (role === 'adversarial_reviewer') return [...candidateSourceFiles(id), candidateTestPath(id), ...candidateReviewFiles(id)];
  if (role === 'scorer_refiner') return [...candidateSourceFiles(id), candidateTestPath(id), ...candidateReviewFiles(id), ...candidateScoreFiles(id)];
  throw new Error(`Unknown real Codex role: ${role}`);
}

export function allCandidateFiles(id) {
  return [
    ...candidateDesignFiles(id),
    ...candidateSourceFiles(id),
    candidateTestPath(id),
    ...candidateReviewFiles(id),
    ...candidateScoreFiles(id)
  ];
}

export function roleDependencies(id, role) {
  if (role === 'architect') return [];
  if (role === 'implementer') return [`${id}__architect`];
  if (role === 'test_writer') return [`${id}__architect`, `${id}__implementer`];
  if (role === 'adversarial_reviewer') return [`${id}__implementer`, `${id}__test_writer`];
  if (role === 'scorer_refiner') return [`${id}__architect`, `${id}__implementer`, `${id}__test_writer`, `${id}__adversarial_reviewer`];
  return [];
}

export function roleVerifiers(role) {
  if (role === 'scorer_refiner') return ['role', 'behavior', 'architecture'];
  return ['role'];
}

export function candidateIds(count = 20) {
  return Array.from({ length: Math.max(1, Math.min(20, Number(count || 20))) }, (_, index) => candidateId(index));
}
