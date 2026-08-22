import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'qualification', 'multi_agent_orchestrator');
export const VALIDATION_DIR = path.join(ARTIFACT_ROOT, 'validation');
export const REPORTS_DIR = path.join(ARTIFACT_ROOT, 'reports');
export const LIVE_RUNS_DIR = path.join(ARTIFACT_ROOT, 'live_runs');
export const FIXTURE_ROOT = path.join(ARTIFACT_ROOT, 'live_fixture_workspace');
export const VERIFIER_SCRIPT = path.join(ROOT, 'apps', 'orchestrator-qualification', 'fixture-verifier.mjs');
export const WORKER_SCRIPT = path.join(ROOT, 'apps', 'orchestrator-qualification', 'live-worker.mjs');

export const paths = {
  contract: path.join(ARTIFACT_ROOT, 'contract.json'),
  graph: path.join(ARTIFACT_ROOT, 'issue_graph.json'),
  matrix: path.join(ARTIFACT_ROOT, 'surface_matrix.json'),
  ledger: path.join(ARTIFACT_ROOT, 'ledger.json'),
  campaign: path.join(ARTIFACT_ROOT, 'campaign_state.json'),
  simulatorWorkGraph: path.join(ARTIFACT_ROOT, 'simulation_project_graph.json'),
  simulatorSurfaceMatrix: path.join(ARTIFACT_ROOT, 'simulation_surface_matrix.json'),
  liveWorkGraph: path.join(ARTIFACT_ROOT, 'live_project_graph.json'),
  liveWorkSurfaceMatrix: path.join(ARTIFACT_ROOT, 'live_work_surface_matrix.json'),
  fixtureManifest: path.join(FIXTURE_ROOT, 'manifest.json'),
  verifierCatalog: path.join(ARTIFACT_ROOT, 'verifier_catalog.json'),
  shardPlan: path.join(ARTIFACT_ROOT, 'shard_plan.json'),
  leaseState: path.join(ARTIFACT_ROOT, 'lease_state.json'),
  contextPacks: path.join(ARTIFACT_ROOT, 'context_packs.json'),
  patchQueue: path.join(ARTIFACT_ROOT, 'patch_queue_report.json'),
  supervisorModel: path.join(ARTIFACT_ROOT, 'supervisor_model.json'),
  artifactBus: path.join(ARTIFACT_ROOT, 'artifact_bus.json'),
  liveExecution: path.join(ARTIFACT_ROOT, 'live_execution_summary.json'),
  workerEvents: path.join(ARTIFACT_ROOT, 'worker_process_events.json'),
  recovery: path.join(ARTIFACT_ROOT, 'recovery_report.json'),
  scaleQualification: path.join(ARTIFACT_ROOT, 'scale_qualification.json'),
  blockerReport: path.join(ARTIFACT_ROOT, 'blocker_report.json'),
  qualificationSummary: path.join(REPORTS_DIR, 'qualification_summary.json'),
  supervisorStatus: path.join(REPORTS_DIR, 'supervisor_status.json'),
  programState: path.join(ARTIFACT_ROOT, 'program_state.json'),
  completionSummary: path.join(ARTIFACT_ROOT, 'completion_summary.json'),
  notification: path.join(ARTIFACT_ROOT, 'notification_state.json'),
  finalReport: path.join(ROOT, 'docs', 'MULTI_AGENT_SCALE_ORCHESTRATOR_LIVE_QUALIFICATION_REPORT_2026-04-03.md')
};

export function surfaceDefinitions() {
  return [
    {
      id: 'B1',
      label: 'Larger shard corpus',
      issueIds: ['b1.large_shard_corpus'],
      requiredArtifacts: [paths.liveWorkGraph, paths.liveWorkSurfaceMatrix, paths.shardPlan, paths.fixtureManifest]
    },
    {
      id: 'B2',
      label: 'Live worker execution mode',
      issueIds: ['b2.live_worker_mode'],
      requiredArtifacts: [paths.liveExecution, paths.workerEvents, paths.artifactBus]
    },
    {
      id: 'B3',
      label: 'Real verifier hooks',
      issueIds: ['b3.real_verifier_hooks'],
      requiredArtifacts: [paths.verifierCatalog, paths.liveExecution]
    },
    {
      id: 'B4',
      label: 'Failure injection and recovery at scale',
      issueIds: ['b4.failure_recovery'],
      requiredArtifacts: [paths.recovery, paths.leaseState, paths.patchQueue]
    },
    {
      id: 'B5',
      label: 'Scale qualification ladder update',
      issueIds: ['b5.scale_ladder'],
      requiredArtifacts: [paths.scaleQualification, paths.supervisorModel, paths.qualificationSummary]
    },
    {
      id: 'B6',
      label: 'Final report and supervisor-owned state',
      issueIds: ['b6.final_state'],
      requiredArtifacts: [paths.programState, paths.completionSummary, paths.notification, paths.finalReport]
    }
  ];
}

export function buildDemoWorkGraph() {
  const surfaces = [
    {
      id: 'auth',
      label: 'Workspace auth + access',
      workUnits: [
        { suffix: 'api', lane: 'backend', domain: 'identity', verifiers: ['tests', 'lint'] },
        { suffix: 'ui', lane: 'frontend', domain: 'workspace', verifiers: ['tests', 'lint'] },
        { suffix: 'qa', lane: 'quality', domain: 'workspace', verifiers: ['tests', 'smoke'] }
      ]
    },
    {
      id: 'audience',
      label: 'Audience ingestion + rules',
      workUnits: [
        { suffix: 'api', lane: 'backend', domain: 'contacts', verifiers: ['tests', 'lint'] },
        { suffix: 'ui', lane: 'frontend', domain: 'contacts', verifiers: ['tests', 'lint'] },
        { suffix: 'qa', lane: 'quality', domain: 'contacts', verifiers: ['tests', 'smoke'] }
      ]
    },
    {
      id: 'editor',
      label: 'Campaign editor + content',
      workUnits: [
        { suffix: 'api', lane: 'backend', domain: 'campaigns', verifiers: ['tests', 'lint'] },
        { suffix: 'ui', lane: 'frontend', domain: 'campaigns', verifiers: ['tests', 'lint'] },
        { suffix: 'qa', lane: 'quality', domain: 'campaigns', verifiers: ['tests', 'smoke'] }
      ]
    },
    {
      id: 'automation',
      label: 'Journey orchestration',
      workUnits: [
        { suffix: 'api', lane: 'backend', domain: 'journeys', verifiers: ['tests', 'lint'] },
        { suffix: 'ui', lane: 'frontend', domain: 'journeys', verifiers: ['tests', 'lint'] },
        { suffix: 'qa', lane: 'quality', domain: 'journeys', verifiers: ['tests', 'smoke'] }
      ]
    },
    {
      id: 'analytics',
      label: 'Analytics + reporting',
      workUnits: [
        { suffix: 'api', lane: 'backend', domain: 'analytics', verifiers: ['tests', 'lint'] },
        { suffix: 'ui', lane: 'frontend', domain: 'analytics', verifiers: ['tests', 'lint'] },
        { suffix: 'qa', lane: 'quality', domain: 'analytics', verifiers: ['tests', 'smoke'] }
      ]
    },
    {
      id: 'platform',
      label: 'Artifacts + release platform',
      workUnits: [
        { suffix: 'ops', lane: 'operations', domain: 'platform', verifiers: ['tests', 'lint'] },
        { suffix: 'worker', lane: 'operations', domain: 'platform', verifiers: ['tests', 'lint'] },
        { suffix: 'qa', lane: 'quality', domain: 'platform', verifiers: ['tests', 'smoke'] }
      ]
    }
  ];

  const workUnits = [];
  const surfaceMatrix = { generatedAt: new Date().toISOString(), status: 'planned', surfaces: [] };
  let previousSurfaceQa = null;

  for (const [surfaceIndex, surface] of surfaces.entries()) {
    const issueIds = [];
    for (const [unitIndex, unit] of surface.workUnits.entries()) {
      const id = `${surface.id}.${unit.suffix}`;
      const deps = [];
      if (unitIndex > 0) deps.push(`${surface.id}.${surface.workUnits[unitIndex - 1].suffix}`);
      if (unitIndex === 0 && previousSurfaceQa) deps.push(previousSurfaceQa);
      const sharedFilePrefix = surface.id === 'editor' && unit.suffix === 'ui' ? 'src/shared/editor-toolbar' : `src/${surface.id}/${unit.suffix}`;
      workUnits.push({
        id,
        title: `${surface.label} / ${unit.suffix}`,
        goal: `Advance ${surface.label.toLowerCase()} for ${unit.suffix}`,
        lane: unit.lane,
        domain: unit.domain,
        deps,
        fileAreas: [
          `${sharedFilePrefix}`,
          `src/${surface.id}/contracts`,
          `tests/${surface.id}`
        ],
        allowedFiles: [
          `${sharedFilePrefix}.mjs`,
          `${sharedFilePrefix}.test.mjs`,
          `src/${surface.id}/contracts/index.mjs`,
          `src/${surface.id}/integrations/${unit.suffix}.mjs`,
          `tests/${surface.id}/${unit.suffix}.test.mjs`
        ],
        inputRefs: ['campaignBrief', 'releasePolicy'],
        inputs: {
          acceptanceTarget: surface.label,
          surfacePriority: surfaceIndex + 1
        },
        acceptanceChecks: [
          `complete ${surface.id}.${unit.suffix}`,
          `preserve ownership for ${unit.lane}`,
          `update artifact trail for ${surface.id}`,
          `verify ${unit.verifiers.join('+')}`
        ],
        requiredVerifiers: unit.verifiers,
        effortSteps: unit.suffix === 'qa' ? 1 : 2,
        stallAttempts: (surface.id === 'automation' && unit.suffix === 'api') || (surface.id === 'analytics' && unit.suffix === 'ui') || (surface.id === 'platform' && unit.suffix === 'worker') ? [1] : [],
        metadata: {
          surfaceId: surface.id,
          unitType: unit.suffix
        }
      });
      issueIds.push(id);
    }
    previousSurfaceQa = `${surface.id}.qa`;
    surfaceMatrix.surfaces.push({ id: surface.id.toUpperCase(), label: surface.label, issueIds, requiredArtifacts: [] });
  }

  return {
    workGraph: {
      version: 1,
      targetPath: ROOT,
      workUnits
    },
    surfaceMatrix,
    globalInputs: {
      campaignBrief: 'Coordinate large coding campaigns using externalized project memory, leases, artifacts, and supervisor truth.',
      releasePolicy: 'No merge without verifier evidence and ownership checks.'
    }
  };
}

const DEFAULT_ROLE_SET = [
  { suffix: 'api', lane: 'backend', domain: 'identity' },
  { suffix: 'ui', lane: 'frontend', domain: 'workspace' },
  { suffix: 'worker', lane: 'operations', domain: 'automation' },
  { suffix: 'qa', lane: 'quality', domain: 'quality' }
];

export function buildLargeQualificationWorkGraph({ familyCount = 30, roleSet = DEFAULT_ROLE_SET, workspaceRoot = FIXTURE_ROOT } = {}) {
  const workUnits = [];
  const surfaceMatrix = { generatedAt: new Date().toISOString(), status: 'planned', surfaces: [] };
  const fixtures = [];
  const domainFamilies = ['identity', 'contacts', 'campaigns', 'journeys', 'analytics', 'deliverability', 'billing', 'assets', 'admin', 'segments'];

  for (let familyIndex = 0; familyIndex < familyCount; familyIndex += 1) {
    const familyId = `family_${String(familyIndex + 1).padStart(3, '0')}`;
    const surfaceLabel = `Qualification family ${familyIndex + 1}`;
    const issueIds = [];
    for (const [roleIndex, role] of roleSet.entries()) {
      const moduleId = `${familyId}.${role.suffix}`;
      const domain = domainFamilies[(familyIndex + roleIndex) % domainFamilies.length];
      const moduleDir = path.join('modules', moduleId);
      fixtures.push({
        id: moduleId,
        familyId,
        lane: role.lane,
        domain,
        suffix: role.suffix,
        moduleDir,
        sourceFile: path.join(moduleDir, 'source.mjs'),
        testFile: path.join(moduleDir, 'test.mjs'),
        smokeFile: path.join(moduleDir, 'smoke.mjs'),
        manifestFile: path.join(moduleDir, 'manifest.json')
      });
      workUnits.push({
        id: moduleId,
        title: `${surfaceLabel} / ${role.suffix}`,
        goal: `Live-qualify ${moduleId}`,
        lane: role.lane,
        domain,
        deps: [],
        fileAreas: [moduleDir],
        allowedFiles: [
          path.join(moduleDir, 'source.mjs'),
          path.join(moduleDir, 'test.mjs'),
          path.join(moduleDir, 'smoke.mjs'),
          path.join(moduleDir, 'manifest.json')
        ],
        inputRefs: ['qualificationPolicy', 'verifierMode'],
        inputs: {
          fixtureModuleId: moduleId,
          familyId,
          lane: role.lane,
          domain
        },
        acceptanceChecks: [
          `verify lint for ${moduleId}`,
          `verify tests for ${moduleId}`,
          `verify smoke for ${moduleId}`,
          `persist artifact trail for ${moduleId}`
        ],
        requiredVerifiers: ['lint', 'tests', 'smoke'],
        effortSteps: 1,
        stallAttempts: [],
        metadata: {
          fixtureModuleId: moduleId,
          familyId,
          surfaceId: familyId.toUpperCase(),
          role: role.suffix
        }
      });
      issueIds.push(moduleId);
    }
    surfaceMatrix.surfaces.push({ id: familyId.toUpperCase(), label: surfaceLabel, issueIds, requiredArtifacts: [] });
  }

  return {
    workGraph: {
      version: 2,
      targetPath: workspaceRoot,
      workUnits
    },
    surfaceMatrix,
    fixtures,
    globalInputs: {
      qualificationPolicy: 'Every shard must pass recorded lint, tests, and smoke verifiers before merge.',
      verifierMode: 'live_fixture_executable_checks'
    }
  };
}

export function buildDeterministicFailurePlan({ shardPlan, leaseTtlMs }) {
  const crashTargets = shardPlan.shards.filter((_, index) => index % 29 === 0).slice(0, 4);
  const stallTargets = shardPlan.shards.filter((_, index) => index % 17 === 0).slice(0, 6);
  const injections = [];
  for (const shard of crashTargets) {
    injections.push({
      shardId: shard.id,
      attempt: 1,
      mode: 'crash',
      note: 'deterministic crash injection before verifier completion'
    });
  }
  for (const shard of stallTargets) {
    if (injections.some((entry) => entry.shardId === shard.id && entry.attempt === 1)) continue;
    injections.push({
      shardId: shard.id,
      attempt: 1,
      mode: 'stall',
      delayMs: leaseTtlMs * 2,
      note: 'deterministic stall injection to force stale lease recovery'
    });
  }
  return injections.sort((left, right) => left.shardId.localeCompare(right.shardId));
}

export function buildVerifierCatalog({ workspacePath = FIXTURE_ROOT } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    workspacePath,
    executionMode: 'live_fixture_executable_checks',
    verifiers: [
      {
        id: 'lint',
        command: `${process.execPath} ${VERIFIER_SCRIPT} lint ${workspacePath} <moduleId>`,
        proof: 'runs node --check against the module source file'
      },
      {
        id: 'tests',
        command: `${process.execPath} ${VERIFIER_SCRIPT} tests ${workspacePath} <moduleId>`,
        proof: 'executes the module test script with node'
      },
      {
        id: 'smoke',
        command: `${process.execPath} ${VERIFIER_SCRIPT} smoke ${workspacePath} <moduleId>`,
        proof: 'executes the module smoke script with node'
      }
    ]
  };
}
