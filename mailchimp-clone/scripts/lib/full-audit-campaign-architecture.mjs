import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ORCHESTRATION_PROGRAM_SPEC, resolveProgramScriptArg } from './orchestration-program-config.mjs';

const POLICY_FILE = 'execution-boundary-policy.json';

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function mergeObject(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = mergeObject(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export const DEFAULT_EXECUTION_BOUNDARY_POLICY = Object.freeze({
  schemaVersion: 1,
  architectureIntent: 'thin_control_plane_remote_execution',
  controlPlane: {
    label: 'control-plane',
    responsibilities: ['chat_gateway', 'supervisor', 'notifier', 'artifact_consumer'],
    forbiddenHeavyWorkloads: ['local_multiprocess_worker_farm', 'browser_heavy_validation', 'repo_scale_qualification', 'large_test_farm']
  },
  executionPlane: {
    label: 'execution-plane',
    responsibilities: ['heavy_orchestration', 'repo_scale_qualification', 'browser_validation', 'large_test_execution']
  },
  policy: {
    denyHeavyLocalExecutionOnControlPlane: true,
    maxLocalAgentCount: 8,
    requireRemoteExecutionForAgentCountAbove: 8,
    requireRemoteExecutionForBrowserValidation: true,
    requireRemoteExecutionForRepoScaleQualification: true,
    failFastOnMissingRemoteBoundary: true,
    localOverrideEnv: ORCHESTRATION_PROGRAM_SPEC.env.allowHeavyLocalExecution,
    hostRoleEnv: ORCHESTRATION_PROGRAM_SPEC.env.hostRole
  },
  remoteExecution: {
    enabled: false,
    mode: 'ssh',
    host: null,
    user: null,
    port: 22,
    keyPath: null,
    proxyJump: null,
    connectTimeoutSec: 10,
    timeoutMs: 3600000,
    batchMode: true,
    strictHostKeyChecking: true,
    userKnownHostsFile: null,
    workdir: null,
    runsRoot: null,
    launchScript: resolveProgramScriptArg('remoteRunner'),
    sharedArtifactRoot: null,
    notes: 'Configure on the execution plane before enabling remote submission.'
  }
});

export function policyPathFor(repoRoot) {
  return path.join(repoRoot, POLICY_FILE);
}

export function loadExecutionBoundaryPolicy({ repoRoot }) {
  const filePath = policyPathFor(repoRoot);
  const userPolicy = readJson(filePath, {});
  const policy = mergeObject(DEFAULT_EXECUTION_BOUNDARY_POLICY, userPolicy || {});
  return { filePath, policy };
}

export function resolveHostRole({ policy, env = process.env } = {}) {
  const hostRoleEnv = policy?.policy?.hostRoleEnv || DEFAULT_EXECUTION_BOUNDARY_POLICY.policy.hostRoleEnv;
  const explicit = `${env[hostRoleEnv] || ''}`.trim();
  if (explicit) return explicit;
  if (`${env[ORCHESTRATION_PROGRAM_SPEC.env.remoteExecutionContext] || ''}`.trim() === '1') return 'execution_plane';
  return 'control_plane';
}

export function evaluateExecutionPlacement({
  policy,
  agentCount,
  hostRole = resolveHostRole({ policy }),
  env = process.env,
  requiresBrowserValidation = false,
  requiresRepoScaleQualification = false
}) {
  const localOverrideEnv = policy?.policy?.localOverrideEnv || DEFAULT_EXECUTION_BOUNDARY_POLICY.policy.localOverrideEnv;
  const overrideEnabled = `${env[localOverrideEnv] || ''}`.trim() === '1';
  const reasons = [];
  const heavyByAgentCount = Number(agentCount || 0) > Number(policy?.policy?.requireRemoteExecutionForAgentCountAbove || 8);
  const heavyByBrowser = Boolean(requiresBrowserValidation && policy?.policy?.requireRemoteExecutionForBrowserValidation);
  const heavyByRepoScale = Boolean(requiresRepoScaleQualification && policy?.policy?.requireRemoteExecutionForRepoScaleQualification);
  const remoteRequired = Boolean(heavyByAgentCount || heavyByBrowser || heavyByRepoScale);

  if (heavyByAgentCount) reasons.push(`agent_count_${agentCount}_exceeds_local_cap_${policy?.policy?.maxLocalAgentCount || 8}`);
  if (heavyByBrowser) reasons.push('browser_validation_requires_execution_plane');
  if (heavyByRepoScale) reasons.push('repo_scale_qualification_requires_execution_plane');

  if (overrideEnabled) {
    reasons.push(`local_override_enabled_via_${localOverrideEnv}`);
    return {
      allowLocal: true,
      remoteRequired,
      overrideEnabled,
      hostRole,
      reasons,
      policyViolationBypass: remoteRequired && hostRole === 'control_plane'
    };
  }

  const denyHeavyLocal = Boolean(policy?.policy?.denyHeavyLocalExecutionOnControlPlane);
  const blocked = Boolean(denyHeavyLocal && remoteRequired && hostRole === 'control_plane');

  return {
    allowLocal: !blocked,
    remoteRequired,
    overrideEnabled,
    hostRole,
    reasons,
    policyViolationBypass: false
  };
}

export function buildExecutionBoundaryBlocker({ repoRoot, policyPath, policy, decision, artifactRoot, extra = {} }) {
  return {
    generatedAt: new Date().toISOString(),
    blocker: 'Architecture policy prevents heavy local execution on the control-plane host.',
    nextAction: [
      'Provision the execution plane (VM102) with the target repo and orchestration stack.',
      `Set ${policy?.policy?.hostRoleEnv || ORCHESTRATION_PROGRAM_SPEC.env.hostRole}=execution_plane on the heavy runner host.`,
      `Configure ${path.relative(repoRoot, policyPath)} remoteExecution.host/workdir/sharedArtifactRoot, then relaunch from the control plane.`,
      `Use ${policy?.policy?.localOverrideEnv || ORCHESTRATION_PROGRAM_SPEC.env.allowHeavyLocalExecution}=1 only as a temporary emergency bypass.`
    ].join(' '),
    artifactRoot: artifactRoot ? path.relative(repoRoot, artifactRoot) : null,
    architectureIntent: policy?.architectureIntent || null,
    currentHost: {
      hostname: os.hostname(),
      role: decision?.hostRole || 'unknown'
    },
    policy: {
      file: path.relative(repoRoot, policyPath),
      requireRemoteExecutionForAgentCountAbove: policy?.policy?.requireRemoteExecutionForAgentCountAbove ?? null,
      maxLocalAgentCount: policy?.policy?.maxLocalAgentCount ?? null,
      denyHeavyLocalExecutionOnControlPlane: Boolean(policy?.policy?.denyHeavyLocalExecutionOnControlPlane),
      remoteExecutionEnabled: Boolean(policy?.remoteExecution?.enabled),
      remoteExecutionMode: policy?.remoteExecution?.mode || null,
      remoteExecutionHost: policy?.remoteExecution?.host || null,
      remoteExecutionWorkdir: policy?.remoteExecution?.workdir || null,
      remoteExecutionSharedArtifactRoot: policy?.remoteExecution?.sharedArtifactRoot || null
    },
    decision: {
      allowLocal: Boolean(decision?.allowLocal),
      remoteRequired: Boolean(decision?.remoteRequired),
      hostRole: decision?.hostRole || null,
      reasons: decision?.reasons || []
    },
    ...extra
  };
}
