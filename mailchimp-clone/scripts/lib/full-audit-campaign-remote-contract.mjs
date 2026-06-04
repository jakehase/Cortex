import path from 'node:path';
import { ORCHESTRATION_PROGRAM_SPEC, buildProgramRemoteLaunchEnvironment, buildProgramRemoteRuntimeCandidates, resolveProgramScriptArg } from './orchestration-program-config.mjs';

export function buildRemoteLaunchEnvironment({ effectiveRunId, remoteRunsRoot, remoteArtifactRoot, env = process.env }) {
  return buildProgramRemoteLaunchEnvironment({
    effectiveRunId,
    remoteRunsRoot,
    remoteArtifactRoot,
    env: {
      ...env,
      ORCHESTRATOR_IMPLEMENTATION_PROFILE: env.ORCHESTRATOR_IMPLEMENTATION_PROFILE || ORCHESTRATION_PROGRAM_SPEC.defaults.implementationProfile,
      MAILCHIMP_REMOTE_NOFILE_LIMIT: env.MAILCHIMP_REMOTE_NOFILE_LIMIT || '65535',
      [ORCHESTRATION_PROGRAM_SPEC.env.useStrictGapInventory]: env[ORCHESTRATION_PROGRAM_SPEC.env.useStrictGapInventory] || ORCHESTRATION_PROGRAM_SPEC.defaults.useStrictGapInventory,
      [ORCHESTRATION_PROGRAM_SPEC.env.strictGapSequence]: env[ORCHESTRATION_PROGRAM_SPEC.env.strictGapSequence] || ORCHESTRATION_PROGRAM_SPEC.defaults.strictGapSequence
    }
  });
}

function defaultShellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function buildRemoteLaunchCommand({ remoteExecution, effectiveRunId, remoteRunsRoot, remoteArtifactRoot, shellQuote }) {
  const quote = shellQuote || defaultShellQuote;
  const envAssignments = Object.entries(buildRemoteLaunchEnvironment({ effectiveRunId, remoteRunsRoot, remoteArtifactRoot }))
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join(' ');
  const remoteLaunchScript = remoteExecution.launchScript || path.join(ORCHESTRATION_PROGRAM_SPEC.remote.workdirRepoName, resolveProgramScriptArg('remoteRunner'));
  return [
    `mkdir -p ${quote(remoteRunsRoot)}`,
    `cd ${quote(remoteExecution.workdir)}`,
    `${envAssignments} node ${quote(remoteLaunchScript)}`
  ].join(' && ');
}

export function buildDetachedRemoteLaunchCommand({ remoteExecution, effectiveRunId, remoteRunsRoot, remoteArtifactRoot }) {
  const remoteRunRoot = path.join(remoteRunsRoot, effectiveRunId);
  const launcherStateRoot = path.join(remoteRunsRoot, '_launcher', effectiveRunId);
  const launchLogPath = path.join(launcherStateRoot, 'launcher.log');
  const launchPidPath = path.join(launcherStateRoot, 'launcher.pid');
  const launchLimitsPath = path.join(launcherStateRoot, 'launcher_limits.json');
  const remoteLaunchScript = remoteExecution.launchScript || path.join(ORCHESTRATION_PROGRAM_SPEC.remote.workdirRepoName, resolveProgramScriptArg('remoteRunner'));
  const launchEnv = buildRemoteLaunchEnvironment({ effectiveRunId, remoteRunsRoot, remoteArtifactRoot });
  const command = `python3 - <<'PY'\nfrom pathlib import Path\nimport json\nimport os\nimport subprocess\ntry:\n    import resource\nexcept Exception:\n    resource = None\nremote_run_root = Path(${JSON.stringify(remoteRunRoot)})\nremote_run_root.mkdir(parents=True, exist_ok=True)\nlaunch_log_path = Path(${JSON.stringify(launchLogPath)})\nlaunch_log_path.parent.mkdir(parents=True, exist_ok=True)\nlaunch_pid_path = Path(${JSON.stringify(launchPidPath)})\nlaunch_limits_path = Path(${JSON.stringify(launchLimitsPath)})\nenv = os.environ.copy()\nenv.update(${JSON.stringify(launchEnv)})\nrequested_nofile = int(str(env.get('MAILCHIMP_REMOTE_NOFILE_LIMIT') or '65535'))\nlimits_report = {'requestedSoftNoFile': requested_nofile, 'applied': False, 'error': None}\nif resource is not None:\n    try:\n        before_soft, before_hard = resource.getrlimit(resource.RLIMIT_NOFILE)\n        target_soft = min(max(before_soft, requested_nofile), before_hard if before_hard > 0 else requested_nofile)\n        resource.setrlimit(resource.RLIMIT_NOFILE, (target_soft, before_hard))\n        after_soft, after_hard = resource.getrlimit(resource.RLIMIT_NOFILE)\n        limits_report.update({'beforeSoftNoFile': before_soft, 'beforeHardNoFile': before_hard, 'afterSoftNoFile': after_soft, 'afterHardNoFile': after_hard, 'applied': after_soft >= min(requested_nofile, before_hard if before_hard > 0 else requested_nofile)})\n    except Exception as exc:\n        limits_report['error'] = str(exc)\nelse:\n    limits_report['error'] = 'python_resource_module_unavailable'\nlaunch_limits_path.write_text(json.dumps(limits_report, indent=2) + '\\n')\nwith launch_log_path.open('ab') as launch_log:\n    launch_log.write((json.dumps({'launcherLimits': limits_report}) + '\\n').encode())\n    proc = subprocess.Popen(['node', ${JSON.stringify(remoteLaunchScript)}], cwd=${JSON.stringify(remoteExecution.workdir)}, env=env, stdin=subprocess.DEVNULL, stdout=launch_log, stderr=subprocess.STDOUT, start_new_session=True)\nlaunch_pid_path.write_text(str(proc.pid))\nprint(proc.pid)\nPY`;
  return {
    remoteRunRoot,
    launcherStateRoot,
    launchLogPath,
    launchPidPath,
    launchLimitsPath,
    launchEnv,
    command
  };
}

export function buildRemoteRuntimeCandidates({ remoteExecution, runId }) {
  return buildProgramRemoteRuntimeCandidates({ remoteExecution, runId });
}

export function selectRemoteRuntimeCandidate({ candidates, statusByPath, runId }) {
  for (const candidate of candidates) {
    const status = statusByPath[candidate.statusPath];
    if (!status) continue;
    if (status.runId && status.runId !== runId) continue;
    return {
      resolution: candidate.kind,
      candidate,
      status,
      remoteArtifactRoot: candidate.remoteArtifactRoot,
      remoteRepo: status.worktreePath || status.baselineRepo || candidate.remoteRepo
    };
  }
  const fallback = candidates[0] || null;
  return {
    resolution: fallback ? `${fallback.kind}:missing_status` : 'missing_candidates',
    candidate: fallback,
    status: null,
    remoteArtifactRoot: fallback?.remoteArtifactRoot || null,
    remoteRepo: fallback?.remoteRepo || null
  };
}
