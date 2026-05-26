import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  ORCHESTRATION_PROGRAM_SPEC,
  applyProgramRuntimeDefaults,
  buildProgramRemoteLaunchEnvironment,
  buildProgramRemoteRuntimeCandidates,
  resolveProgramPaths,
  resolveProgramScriptArg,
  resolveProgramScriptPath,
  resolveProgramSession
} from '../scripts/lib/orchestration-program-config.mjs';

test('program config resolves the canonical program paths from the repo root', () => {
  const rootDir = '/root/clawd/mailchimp-clone';
  const paths = resolveProgramPaths(rootDir);
  assert.equal(paths.artifactDir, path.join(rootDir, 'artifacts', 'full_audit_campaign'));
  assert.equal(paths.programStatePath, path.join(rootDir, 'artifacts', 'full_audit_campaign', 'program_state.json'));
  assert.equal(paths.workerStatusPath, path.join(rootDir, 'artifacts', 'full_audit_campaign', 'reports', '100_agent_worker_status.json'));
});

test('program config resolves script arguments and session identity from one place', () => {
  assert.equal(resolveProgramScriptArg('notify'), 'scripts/full-audit-campaign-notify.mjs');
  assert.equal(resolveProgramScriptPath('/root/clawd/mailchimp-clone', 'worker'), '/root/clawd/mailchimp-clone/scripts/full-audit-campaign-worker-100-agent.mjs');
  assert.deepEqual(resolveProgramSession(), {
    id: 'mailchimp-full-clone-100-agent',
    project: 'mailchimp-clone'
  });
});

test('program config applies runtime defaults without scattering wrapper constants', () => {
  const env = {};
  applyProgramRuntimeDefaults({ rootDir: '/root/clawd/mailchimp-clone', env });
  assert.equal(env.ORCHESTRATOR_IMPLEMENTATION_PROFILE, ORCHESTRATION_PROGRAM_SPEC.defaults.implementationProfile);
  assert.equal(env.ORCHESTRATOR_IMPLEMENTATION_SCRIPT, '/root/clawd/mailchimp-clone/scripts/orchestrator-real-repo-clean-implement.mjs');
  assert.equal(env[ORCHESTRATION_PROGRAM_SPEC.env.productOnly], ORCHESTRATION_PROGRAM_SPEC.defaults.productOnly);
});

test('program config builds remote launch env and runtime candidates from the shared spec', () => {
  const launchEnv = buildProgramRemoteLaunchEnvironment({
    effectiveRunId: 'run-123',
    remoteRunsRoot: '/srv/remote/mailchimp-runs',
    remoteArtifactRoot: '/srv/remote/mailchimp-runs/run-123/artifacts/implementation_runs/run-123',
    env: {
      ORCHESTRATOR_REQUESTED_FIDELITY: 'parity_for_scope',
      MAILCHIMP_PRODUCT_ONLY: '1',
      MAILCHIMP_USE_STRICT_GAP_INVENTORY: '0',
      MAILCHIMP_STRICT_GAP_SEQUENCE: '0',
      MAILCHIMP_COMPLETED_FOCUS_IDS: 'focus.audience_crm_parity',
      MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS: 'focus.audience_crm_parity',
      MAILCHIMP_EXCLUDED_FOCUS_IDS: 'focus.campaign_editor_parity#2',
      MAILCHIMP_CONTRACT_SCOPE_PARALLEL_ALL: '1',
      MAILCHIMP_BENCHMARK_CARRY_COMPLETED_FOCUS_IDS: '1',
      MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION: '1',
      MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION: '1',
      MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION: '1',
      MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION: '1',
      MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR: '1',
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SATURATION_THRESHOLD: '0.72',
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS: '37',
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS: 'focus.signup_onboarding,focus.dashboard_home',
      MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES: '0',
      MAILCHIMP_REMOTE_MAX_ITERATIONS: '40'
    }
  });
  assert.equal(launchEnv[ORCHESTRATION_PROGRAM_SPEC.env.runId], 'run-123');
  assert.equal(launchEnv[ORCHESTRATION_PROGRAM_SPEC.env.hostRole], 'execution_plane');
  assert.equal(launchEnv.ORCHESTRATOR_REQUESTED_FIDELITY, 'parity_for_scope');
  assert.equal(launchEnv[ORCHESTRATION_PROGRAM_SPEC.env.productOnly], '1');
  assert.equal(launchEnv[ORCHESTRATION_PROGRAM_SPEC.env.useStrictGapInventory], '0');
  assert.equal(launchEnv[ORCHESTRATION_PROGRAM_SPEC.env.strictGapSequence], '0');
  assert.equal(launchEnv[ORCHESTRATION_PROGRAM_SPEC.env.requestedAgentCount], '100');
  assert.equal(launchEnv[ORCHESTRATION_PROGRAM_SPEC.env.completedFocusIds], 'focus.audience_crm_parity');
  assert.equal(launchEnv[ORCHESTRATION_PROGRAM_SPEC.env.verifiedCompletedFocusIds], 'focus.audience_crm_parity');
  assert.equal(launchEnv.MAILCHIMP_EXCLUDED_FOCUS_IDS, 'focus.campaign_editor_parity#2');
  assert.equal(launchEnv.MAILCHIMP_CONTRACT_SCOPE_PARALLEL_ALL, '1');
  assert.equal(launchEnv.MAILCHIMP_BENCHMARK_CARRY_COMPLETED_FOCUS_IDS, '1');
  assert.equal(launchEnv.MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION, '1');
  assert.equal(launchEnv.MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION, '1');
  assert.equal(launchEnv.MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION, '1');
  assert.equal(launchEnv.MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION, '1');
  assert.equal(launchEnv.MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR, '1');
  assert.equal(launchEnv.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SATURATION_THRESHOLD, '0.72');
  assert.equal(launchEnv.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS, '37');
  assert.equal(launchEnv.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS, 'focus.signup_onboarding,focus.dashboard_home');
  assert.equal(launchEnv.MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES, '0');
  assert.equal(launchEnv.MAILCHIMP_REMOTE_MAX_ITERATIONS, '40');
  assert.ok(!('ORCHESTRATOR_IMPLEMENTATION_PROFILE' in launchEnv), 'remote launch env should not force a stricter implementation profile when the caller did not request one');

  const candidates = buildProgramRemoteRuntimeCandidates({
    remoteExecution: {
      workdir: '/srv/remote',
      sharedArtifactRoot: '/srv/shared/mailchimp-artifacts'
    },
    runId: 'run-123'
  });
  assert.deepEqual(candidates, [
    {
      kind: 'configured_shared_artifact_root',
      remoteArtifactRoot: '/srv/shared/mailchimp-artifacts/run-123',
      statusPath: '/srv/shared/mailchimp-artifacts/run-123/remote_execution_status.json',
      remoteRepo: '/srv/remote/mailchimp-clone'
    },
    {
      kind: 'legacy_remote_runs_root',
      remoteArtifactRoot: '/srv/remote/mailchimp-runs/run-123/artifacts/implementation_runs/run-123',
      statusPath: '/srv/remote/mailchimp-runs/run-123/artifacts/implementation_runs/run-123/remote_execution_status.json',
      remoteRepo: '/srv/remote/mailchimp-clone'
    }
  ]);
});
