import path from 'node:path';

export const ORCHESTRATION_PROGRAM_SPEC = Object.freeze({
  programId: 'full_audit_campaign',
  artifactRelativeDir: path.join('artifacts', 'full_audit_campaign'),
  reportsRelativeDir: path.join('artifacts', 'full_audit_campaign', 'reports'),
  files: {
    currentRun: 'current_run.json',
    programState: 'program_state.json',
    completionSummary: 'completion_summary.json',
    notificationState: 'notification_state.json',
    blockerReport: 'blocker_report.json',
    syncStatus: 'sync_status.json',
    persistentRunnerStatus: 'persistent_runner_status.json',
    workerState: 'worker_state.json',
    workerStatus: path.join('reports', '100_agent_worker_status.json'),
    supervisorStatus: path.join('reports', 'supervisor_status.json'),
    transportStatus: path.join('cortex_transport', 'transport_status.json')
  },
  scripts: {
    watch: 'scripts/full-audit-campaign-watch.mjs',
    notify: 'scripts/full-audit-campaign-notify.mjs',
    worker: 'scripts/full-audit-campaign-worker-100-agent.mjs',
    sync: 'scripts/full-audit-campaign-sync-remote-worktree.mjs',
    supervisor: 'scripts/full-audit-campaign-supervisor.mjs',
    remoteRunner: 'scripts/full-audit-campaign-remote-runner.mjs',
    delegate: 'scripts/orchestrator-real-repo-clean-run.mjs',
    implementation: 'scripts/orchestrator-real-repo-clean-implement.mjs',
    fullCloneAutopilot: 'scripts/full-clone-autopilot.mjs'
  },
  session: {
    id: 'mailchimp-full-clone-100-agent',
    project: 'mailchimp-clone'
  },
  remote: {
    workdirRepoName: 'mailchimp-clone',
    runsDirName: 'mailchimp-runs'
  },
  env: {
    runId: 'MAILCHIMP_FULL_AUDIT_RUN_ID',
    campaignRunId: 'MAILCHIMP_CAMPAIGN_RUN_ID',
    completedFocusIds: 'MAILCHIMP_COMPLETED_FOCUS_IDS',
    verifiedCompletedFocusIds: 'MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS',
    useBenchmarkScope: 'MAILCHIMP_USE_BENCHMARK_SCOPE',
    onePassContractPath: 'MAILCHIMP_ONE_PASS_CONTRACT_PATH',
    maxIterations: 'MAILCHIMP_PARITY_MAX_ITERATIONS',
    maxRuntimeHours: 'MAILCHIMP_PARITY_MAX_RUNTIME_HOURS',
    soakFullRuntime: 'MAILCHIMP_PARITY_SOAK_FULL_RUNTIME',
    noProgressIterationLimit: 'MAILCHIMP_PARITY_NO_PROGRESS_ITERATION_LIMIT',
    remoteExecutionContext: 'MAILCHIMP_REMOTE_EXECUTION_CONTEXT',
    hostRole: 'MAILCHIMP_HOST_ROLE',
    remoteRunsRoot: 'MAILCHIMP_REMOTE_RUNS_ROOT',
    orchestratorArtifactRoot: 'MAILCHIMP_ORCHESTRATOR_ARTIFACT_ROOT',
    productOnly: 'MAILCHIMP_PRODUCT_ONLY',
    useStrictGapInventory: 'MAILCHIMP_USE_STRICT_GAP_INVENTORY',
    strictGapSequence: 'MAILCHIMP_STRICT_GAP_SEQUENCE',
    allowHeavyLocalExecution: 'MAILCHIMP_ALLOW_HEAVY_LOCAL_EXECUTION',
    requestedAgentCount: 'MAILCHIMP_REQUESTED_AGENT_COUNT'
  },
  defaults: {
    implementationProfile: 'mailchimp_parity_focus',
    productOnly: '1',
    useStrictGapInventory: '1',
    strictGapSequence: '1',
    maxRuntimeHours: 6,
    noProgressIterationLimit: 5,
    requestedAgentCount: 100,
    remoteHostRole: 'execution_plane'
  }
});

export function resolveProgramPaths(rootDir, spec = ORCHESTRATION_PROGRAM_SPEC) {
  const artifactDir = path.join(rootDir, spec.artifactRelativeDir);
  const reportsDir = path.join(rootDir, spec.reportsRelativeDir);
  return {
    rootDir,
    artifactDir,
    reportsDir,
    currentRunPath: path.join(artifactDir, spec.files.currentRun),
    programStatePath: path.join(artifactDir, spec.files.programState),
    summaryPath: path.join(artifactDir, spec.files.completionSummary),
    notifyPath: path.join(artifactDir, spec.files.notificationState),
    blockerPath: path.join(artifactDir, spec.files.blockerReport),
    syncStatusPath: path.join(artifactDir, spec.files.syncStatus),
    persistentRunnerStatusPath: path.join(artifactDir, spec.files.persistentRunnerStatus),
    workerStatePath: path.join(artifactDir, spec.files.workerState),
    workerStatusPath: path.join(artifactDir, spec.files.workerStatus),
    supervisorStatusPath: path.join(artifactDir, spec.files.supervisorStatus),
    transportStatusPath: path.join(artifactDir, spec.files.transportStatus)
  };
}

export function resolveProgramScriptPath(rootDir, key, spec = ORCHESTRATION_PROGRAM_SPEC) {
  return path.join(rootDir, spec.scripts[key]);
}

export function resolveProgramScriptArg(key, spec = ORCHESTRATION_PROGRAM_SPEC) {
  return spec.scripts[key];
}

export function resolveProgramEnvKeys(spec = ORCHESTRATION_PROGRAM_SPEC) {
  return spec.env;
}

export function resolveProgramSession(spec = ORCHESTRATION_PROGRAM_SPEC) {
  return spec.session;
}

export function applyProgramRuntimeDefaults({ rootDir, env = process.env, spec = ORCHESTRATION_PROGRAM_SPEC } = {}) {
  env.ORCHESTRATOR_IMPLEMENTATION_PROFILE ||= spec.defaults.implementationProfile;
  env.ORCHESTRATOR_IMPLEMENTATION_SCRIPT ||= resolveProgramScriptPath(rootDir, 'implementation', spec);
  env[spec.env.productOnly] ||= spec.defaults.productOnly;
  return env;
}

export function buildProgramRemoteLaunchEnvironment({ effectiveRunId, remoteRunsRoot, remoteArtifactRoot, env = process.env, spec = ORCHESTRATION_PROGRAM_SPEC }) {
  const launchEnv = {
    [spec.env.remoteExecutionContext]: '1',
    [spec.env.hostRole]: spec.defaults.remoteHostRole,
    [spec.env.runId]: String(effectiveRunId),
    [spec.env.remoteRunsRoot]: String(remoteRunsRoot),
    [spec.env.orchestratorArtifactRoot]: String(remoteArtifactRoot),
    [spec.env.productOnly]: env[spec.env.productOnly] || spec.defaults.productOnly
  };

  if (env[spec.env.campaignRunId]) launchEnv[spec.env.campaignRunId] = String(env[spec.env.campaignRunId]);
  if (env[spec.env.completedFocusIds]) launchEnv[spec.env.completedFocusIds] = String(env[spec.env.completedFocusIds]);
  if (env[spec.env.verifiedCompletedFocusIds]) launchEnv[spec.env.verifiedCompletedFocusIds] = String(env[spec.env.verifiedCompletedFocusIds]);
  if (env[spec.env.useBenchmarkScope]) launchEnv[spec.env.useBenchmarkScope] = String(env[spec.env.useBenchmarkScope]);
  if (env[spec.env.onePassContractPath]) {
    launchEnv[spec.env.onePassContractPath] = path.isAbsolute(String(env[spec.env.onePassContractPath]))
      ? String(env[spec.env.onePassContractPath])
      : path.join(String(remoteArtifactRoot), 'full_audit_campaign', 'one_pass_run_contract.latest.json');
  }
  if (env[spec.env.maxIterations]) launchEnv[spec.env.maxIterations] = String(env[spec.env.maxIterations]);
  if (env[spec.env.maxRuntimeHours]) launchEnv[spec.env.maxRuntimeHours] = String(env[spec.env.maxRuntimeHours]);
  if (env[spec.env.soakFullRuntime]) launchEnv[spec.env.soakFullRuntime] = String(env[spec.env.soakFullRuntime]);
  if (env[spec.env.noProgressIterationLimit]) launchEnv[spec.env.noProgressIterationLimit] = String(env[spec.env.noProgressIterationLimit]);
  launchEnv[spec.env.requestedAgentCount] = String(env[spec.env.requestedAgentCount] || spec.defaults.requestedAgentCount);

  if (env.ORCHESTRATOR_IMPLEMENTATION_PROFILE) launchEnv.ORCHESTRATOR_IMPLEMENTATION_PROFILE = env.ORCHESTRATOR_IMPLEMENTATION_PROFILE;
  if (env.ORCHESTRATOR_TIERS) launchEnv.ORCHESTRATOR_TIERS = env.ORCHESTRATOR_TIERS;
  if (env.ORCHESTRATOR_REQUESTED_FIDELITY) launchEnv.ORCHESTRATOR_REQUESTED_FIDELITY = env.ORCHESTRATOR_REQUESTED_FIDELITY;

  for (const key of [
    'MAILCHIMP_EXCLUDED_FOCUS_IDS',
    'MAILCHIMP_CONTRACT_SCOPE_PARALLEL_ALL',
    'MAILCHIMP_BENCHMARK_CARRY_COMPLETED_FOCUS_IDS',
    'MAILCHIMP_CONTINUE_UNTIL_GLOBAL_PARITY',
    'MAILCHIMP_IGNORE_STRICT_GAP_SATISFACTION',
    'MAILCHIMP_ENABLE_STRUCTURAL_FULL_CLONE_EXPANSION',
    'MAILCHIMP_ENABLE_FULL_CLONE_FRONTIER_EXPANSION',
    'MAILCHIMP_ENABLE_FULL_CLONE_REMEDIATION_EXPANSION',
    'MAILCHIMP_ENABLE_FULL_CLONE_STRICT_REMEDIATION_EXPANSION',
    'MAILCHIMP_ENABLE_FULL_CLONE_CONTINUATION_EXPANSION',
    'MAILCHIMP_ENABLE_SEMANTIC_WORK_DIRECTOR',
    'MAILCHIMP_DISABLE_SEMANTIC_WORK_DIRECTOR',
    'MAILCHIMP_SEMANTIC_WORK_DIRECTOR_FORCE',
    'MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SATURATION_THRESHOLD',
    'MAILCHIMP_SEMANTIC_WORK_DIRECTOR_MAX_GAPS',
    'MAILCHIMP_SEMANTIC_WORK_DIRECTOR_TARGET_FOCUS_IDS',
    'MAILCHIMP_SEMANTIC_WORK_DIRECTOR_SKIP_ADOPTED_PHASES',
    'MAILCHIMP_REMOTE_MAX_ITERATIONS',
    'MAILCHIMP_FULL_CLONE_CONTINUATION_MIN_WAVE',
    'MAILCHIMP_ALLOW_SYNTHETIC_PARITY_DELTAS',
    'MAILCHIMP_ALLOW_CANONICAL_RUNTIME_FALLBACK',
    'MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT',
    'MAILCHIMP_ARCHITECTURE_ONLY_CREDIT'
  ]) {
    if (env[key]) launchEnv[key] = String(env[key]);
  }

  const strictGapInventory = String(env[spec.env.useStrictGapInventory] || '').trim();
  if (strictGapInventory) launchEnv[spec.env.useStrictGapInventory] = strictGapInventory;

  const strictGapSequence = String(env[spec.env.strictGapSequence] || '').trim();
  if (strictGapSequence) launchEnv[spec.env.strictGapSequence] = strictGapSequence;

  return launchEnv;
}

export function buildProgramRemoteRuntimeCandidates({ remoteExecution, runId, spec = ORCHESTRATION_PROGRAM_SPEC }) {
  const baseWorkdir = remoteExecution?.workdir || '';
  const configuredRoot = remoteExecution?.sharedArtifactRoot || null;
  const legacyRoot = path.join(baseWorkdir, spec.remote.runsDirName, runId, 'artifacts', 'implementation_runs', runId);
  const remoteRepo = path.join(baseWorkdir, spec.remote.workdirRepoName);
  const candidates = [];
  if (configuredRoot) {
    candidates.push({
      kind: 'configured_shared_artifact_root',
      remoteArtifactRoot: path.join(configuredRoot, runId),
      statusPath: path.join(configuredRoot, runId, 'remote_execution_status.json'),
      remoteRepo
    });
  }
  candidates.push({
    kind: 'legacy_remote_runs_root',
    remoteArtifactRoot: legacyRoot,
    statusPath: path.join(legacyRoot, 'remote_execution_status.json'),
    remoteRepo
  });
  return candidates;
}
