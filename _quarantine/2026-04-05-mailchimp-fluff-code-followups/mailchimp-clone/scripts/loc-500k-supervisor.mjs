import { compileSurfaceMatrix } from '../../large-project-capability-stack/packages/surface-matrix/index.mjs';
import { loadGraph } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { paths, readJson, writeJson, TARGET_LOC, contractInput, surfaceDefinitions } from './lib/loc-500k-campaign-plan.mjs';

const graph = loadGraph(paths.graph);
const contract = readJson(paths.contract, contractInput());
const matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
const locProgress = readJson(paths.locProgress, { snapshots: [] });
const latest = locProgress.snapshots?.at(-1) || locProgress.current || null;
const validationState = readJson(paths.validationState, {});
const truthCertification = readJson(paths.truthCertification, null);
const pathSummary = readJson(paths.pathSummary, null);

const requiredValidation = ['generatorOk', 'repoTestsOk', 'smokeOk', 'browserOk', 'orchestratorOk', 'truthRefreshOk'];
const validationGreen = requiredValidation.every((key) => validationState[key] === true);
const locMet = Boolean(latest && latest.total >= TARGET_LOC);
const matrixComplete = matrix.status === 'all_complete';
const status = locMet && matrixComplete && validationGreen ? 'green' : 'red';

const blocker = status === 'green' ? null : {
  generatedAt: new Date().toISOString(),
  blocker: !validationState.generatorOk
    ? 'Generator run did not complete successfully.'
    : !locMet
      ? `Latest LOC snapshot is below ${TARGET_LOC}.`
      : !validationState.repoTestsOk
        ? 'Repo-wide tests are not green.'
        : !validationState.smokeOk
          ? 'Live smoke validation is not green.'
          : !validationState.browserOk
            ? 'Browser proof refresh is not green.'
            : !validationState.orchestratorOk
              ? 'Real repo orchestrator rerun is not green.'
              : !validationState.truthRefreshOk
                ? 'Truth refresh did not complete successfully.'
                : 'Surface matrix is not all_complete.',
  nextAction: !locMet
    ? 'Continue expansion iterations or raise the generator target package count.'
    : !validationGreen
      ? 'Inspect the validation logs under artifacts/mailchimp_clone/real_world_indistinguishable/loc_500k_campaign/validation/ and repair the failed stage.'
      : 'Inspect the surface matrix and graph for incomplete surfaces.',
  latestSnapshot: latest,
  matrixStatus: matrix.status,
  validationState
};

writeJson(paths.supervisor, {
  generatedAt: new Date().toISOString(),
  status,
  stopCondition: 'loc_gte_500k_or_blocker_report',
  locTarget: TARGET_LOC,
  locTargetMet: locMet,
  latestSnapshot: latest,
  surfaceMatrixPath: paths.matrix,
  surfaceMatrixStatus: matrix.status,
  validationGreen,
  validationState,
  truthGateCurrentClaim: truthCertification?.highestAllowedClaim || null,
  truthGateRequestedClaimAllowed: truthCertification?.requestedClaimAllowed ?? null,
  topTierEligibility: pathSummary?.targetClaimCurrentlyEligible ?? null,
  blocker
});

console.log(JSON.stringify({
  ok: status === 'green',
  status,
  locMet,
  total: latest?.total || 0,
  matrixStatus: matrix.status,
  validationGreen
}, null, 2));
process.exit(status === 'green' ? 0 : 1);
