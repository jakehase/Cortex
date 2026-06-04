import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildDetachedRemoteLaunchCommand,
  buildRemoteLaunchCommand,
  buildRemoteLaunchEnvironment,
  buildRemoteRuntimeCandidates,
  selectRemoteRuntimeCandidate
} from '../scripts/lib/full-audit-campaign-remote-contract.mjs';

test('buildRemoteLaunchEnvironment returns the run-scoped execution-plane env', () => {
  assert.deepEqual(
    buildRemoteLaunchEnvironment({
      effectiveRunId: 'run-123',
      remoteRunsRoot: '/remote/runs',
      remoteArtifactRoot: '/remote/runs/run-123/artifacts'
    }),
    {
      MAILCHIMP_REMOTE_EXECUTION_CONTEXT: '1',
      MAILCHIMP_HOST_ROLE: 'execution_plane',
      MAILCHIMP_FULL_AUDIT_RUN_ID: 'run-123',
      MAILCHIMP_REMOTE_RUNS_ROOT: '/remote/runs',
      MAILCHIMP_ORCHESTRATOR_ARTIFACT_ROOT: '/remote/runs/run-123/artifacts',
      ORCHESTRATOR_IMPLEMENTATION_PROFILE: 'mailchimp_parity_focus',
      MAILCHIMP_REMOTE_NOFILE_LIMIT: '65535',
      MAILCHIMP_PRODUCT_ONLY: '1',
      MAILCHIMP_REQUESTED_AGENT_COUNT: '100',
      MAILCHIMP_USE_STRICT_GAP_INVENTORY: '1',
      MAILCHIMP_STRICT_GAP_SEQUENCE: '1'
    }
  );
});

test('buildRemoteLaunchCommand attaches env to the actual remote runner command', () => {
  const command = buildRemoteLaunchCommand({
    remoteExecution: {
      workdir: '/srv/remote',
      launchScript: 'mailchimp-clone/scripts/full-audit-campaign-remote-runner.mjs'
    },
    effectiveRunId: 'run-123',
    remoteRunsRoot: '/srv/remote/mailchimp-runs',
    remoteArtifactRoot: '/srv/remote/mailchimp-runs/run-123/artifacts/implementation_runs/run-123'
  });
  assert.match(command, /mkdir -p '.*mailchimp-runs'/);
  assert.match(command, /cd '\/srv\/remote'/);
  assert.match(command, /MAILCHIMP_FULL_AUDIT_RUN_ID='run-123'/);
  assert.match(command, /MAILCHIMP_ORCHESTRATOR_ARTIFACT_ROOT='\/srv\/remote\/mailchimp-runs\/run-123\/artifacts\/implementation_runs\/run-123'/);
  assert.match(command, /ORCHESTRATOR_IMPLEMENTATION_PROFILE='mailchimp_parity_focus'/);
  assert.match(command, /MAILCHIMP_REMOTE_NOFILE_LIMIT='65535'/);
  assert.match(command, /MAILCHIMP_USE_STRICT_GAP_INVENTORY='1'/);
  assert.match(command, /MAILCHIMP_STRICT_GAP_SEQUENCE='1'/);
  assert.match(command, /node 'mailchimp-clone\/scripts\/full-audit-campaign-remote-runner\.mjs'$/);
});

test('buildDetachedRemoteLaunchCommand detaches execution and returns launcher paths', () => {
  const detached = buildDetachedRemoteLaunchCommand({
    remoteExecution: {
      workdir: '/srv/remote',
      launchScript: 'mailchimp-clone/scripts/full-audit-campaign-remote-runner.mjs'
    },
    effectiveRunId: 'run-123',
    remoteRunsRoot: '/srv/remote/mailchimp-runs',
    remoteArtifactRoot: '/srv/remote/mailchimp-runs/run-123/artifacts/implementation_runs/run-123'
  });
  assert.equal(detached.remoteRunRoot, '/srv/remote/mailchimp-runs/run-123');
  assert.equal(detached.launcherStateRoot, '/srv/remote/mailchimp-runs/_launcher/run-123');
  assert.equal(detached.launchLogPath, '/srv/remote/mailchimp-runs/_launcher/run-123/launcher.log');
  assert.equal(detached.launchPidPath, '/srv/remote/mailchimp-runs/_launcher/run-123/launcher.pid');
  assert.equal(detached.launchLimitsPath, '/srv/remote/mailchimp-runs/_launcher/run-123/launcher_limits.json');
  assert.deepEqual(detached.launchEnv, {
    MAILCHIMP_REMOTE_EXECUTION_CONTEXT: '1',
    MAILCHIMP_HOST_ROLE: 'execution_plane',
    MAILCHIMP_FULL_AUDIT_RUN_ID: 'run-123',
    MAILCHIMP_REMOTE_RUNS_ROOT: '/srv/remote/mailchimp-runs',
    MAILCHIMP_ORCHESTRATOR_ARTIFACT_ROOT: '/srv/remote/mailchimp-runs/run-123/artifacts/implementation_runs/run-123',
    ORCHESTRATOR_IMPLEMENTATION_PROFILE: 'mailchimp_parity_focus',
    MAILCHIMP_REMOTE_NOFILE_LIMIT: '65535',
    MAILCHIMP_PRODUCT_ONLY: '1',
    MAILCHIMP_REQUESTED_AGENT_COUNT: '100',
    MAILCHIMP_USE_STRICT_GAP_INVENTORY: '1',
    MAILCHIMP_STRICT_GAP_SEQUENCE: '1'
  });
  assert.match(detached.command, /python3 - <<'PY'/);
  assert.match(detached.command, /resource\.setrlimit\(resource\.RLIMIT_NOFILE/);
  assert.match(detached.command, /MAILCHIMP_REMOTE_NOFILE_LIMIT/);
  assert.match(detached.command, /launcher_limits\.json/);
  assert.match(detached.command, /subprocess\.Popen/);
  assert.match(detached.command, /launcher\.log/);
  assert.match(detached.command, /launcher\.pid/);
});

test('buildRemoteRuntimeCandidates includes configured shared root before the legacy fallback', () => {
  const candidates = buildRemoteRuntimeCandidates({
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

test('selectRemoteRuntimeCandidate prefers the disposable worktree path from the active status', () => {
  const candidates = buildRemoteRuntimeCandidates({
    remoteExecution: {
      workdir: '/srv/remote',
      sharedArtifactRoot: '/srv/shared/mailchimp-artifacts'
    },
    runId: 'run-123'
  });
  const statusByPath = {
    [candidates[0].statusPath]: {
      runId: 'run-123',
      worktreePath: '/srv/runtime/worktrees/run-123',
      baselineRepo: '/srv/remote/mailchimp-clone'
    },
    [candidates[1].statusPath]: {
      runId: 'run-123',
      worktreePath: '/srv/legacy/worktrees/run-123',
      baselineRepo: '/srv/legacy/mailchimp-clone'
    }
  };
  assert.deepEqual(
    selectRemoteRuntimeCandidate({ candidates, statusByPath, runId: 'run-123' }),
    {
      resolution: 'configured_shared_artifact_root',
      candidate: candidates[0],
      status: statusByPath[candidates[0].statusPath],
      remoteArtifactRoot: candidates[0].remoteArtifactRoot,
      remoteRepo: '/srv/runtime/worktrees/run-123'
    }
  );
});

test('selectRemoteRuntimeCandidate falls back to the baseline repo when the status has no worktree path', () => {
  const candidates = buildRemoteRuntimeCandidates({
    remoteExecution: {
      workdir: '/srv/remote',
      sharedArtifactRoot: '/srv/shared/mailchimp-artifacts'
    },
    runId: 'run-123'
  });
  const statusByPath = {
    [candidates[0].statusPath]: null,
    [candidates[1].statusPath]: {
      runId: 'run-123',
      baselineRepo: '/srv/remote/mailchimp-clone'
    }
  };
  assert.deepEqual(
    selectRemoteRuntimeCandidate({ candidates, statusByPath, runId: 'run-123' }),
    {
      resolution: 'legacy_remote_runs_root',
      candidate: candidates[1],
      status: statusByPath[candidates[1].statusPath],
      remoteArtifactRoot: candidates[1].remoteArtifactRoot,
      remoteRepo: '/srv/remote/mailchimp-clone'
    }
  );
});

test('selectRemoteRuntimeCandidate ignores mismatched run ids and reports a missing-status fallback', () => {
  const candidates = buildRemoteRuntimeCandidates({
    remoteExecution: {
      workdir: '/srv/remote',
      sharedArtifactRoot: '/srv/shared/mailchimp-artifacts'
    },
    runId: 'run-123'
  });
  const statusByPath = {
    [candidates[0].statusPath]: {
      runId: 'wrong-run',
      baselineRepo: '/srv/runtime/worktrees/wrong-run'
    },
    [candidates[1].statusPath]: null
  };
  assert.deepEqual(
    selectRemoteRuntimeCandidate({ candidates, statusByPath, runId: 'run-123' }),
    {
      resolution: 'configured_shared_artifact_root:missing_status',
      candidate: candidates[0],
      status: null,
      remoteArtifactRoot: candidates[0].remoteArtifactRoot,
      remoteRepo: candidates[0].remoteRepo
    }
  );
});
