import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const PRODUCT_ONLY_MODE = process.env.MAILCHIMP_PRODUCT_ONLY !== '0';

function productOnlyVerifiers(verifiers = []) {
  return PRODUCT_ONLY_MODE ? verifiers.filter((value) => value !== 'tests' && value !== 'test') : verifiers;
}
export const STACK_ROOT = path.resolve(ROOT, '..', 'large-project-capability-stack');
export const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'qualification', 'orchestrator_real_repo');
export const VALIDATION_DIR = path.join(ARTIFACT_ROOT, 'validation');
export const RUNS_DIR = path.join(ARTIFACT_ROOT, 'live_runs');
export const MERGE_DIR = path.join(ARTIFACT_ROOT, 'merge');
export const RECOVERY_DIR = path.join(ARTIFACT_ROOT, 'recovery');
export const REPORTS_DIR = path.join(ARTIFACT_ROOT, 'reports');
export const WORKER_SCRIPT = path.join(ROOT, 'scripts', 'orchestrator-real-repo-worker.mjs');
export const VERIFIER_SCRIPT = path.join(ROOT, 'scripts', 'orchestrator-real-repo-verifier.mjs');
export const STACK_FIXTURE_SCALE_PATH = path.join(STACK_ROOT, 'artifacts', 'qualification', 'multi_agent_orchestrator', 'scale_qualification.json');

export const paths = {
  contract: path.join(ARTIFACT_ROOT, 'contract.json'),
  issueGraph: path.join(ARTIFACT_ROOT, 'issue_graph.json'),
  surfaceMatrix: path.join(ARTIFACT_ROOT, 'surface_matrix.json'),
  campaignState: path.join(ARTIFACT_ROOT, 'campaign_state.json'),
  workGraph: path.join(ARTIFACT_ROOT, 'work_graph.json'),
  workSurfaceMatrix: path.join(ARTIFACT_ROOT, 'work_surface_matrix.json'),
  shardPlan: path.join(ARTIFACT_ROOT, 'shard_plan.json'),
  verifierCatalog: path.join(ARTIFACT_ROOT, 'verifier_catalog.json'),
  contextPacks: path.join(ARTIFACT_ROOT, 'context_packs.json'),
  selectedTierSupervisor: path.join(ARTIFACT_ROOT, 'selected_tier_supervisor.json'),
  selectedTierSummary: path.join(ARTIFACT_ROOT, 'selected_tier_summary.json'),
  leaseState: path.join(ARTIFACT_ROOT, 'lease_state.json'),
  patchQueueReport: path.join(ARTIFACT_ROOT, 'patch_queue_report.json'),
  artifactBus: path.join(ARTIFACT_ROOT, 'artifact_bus.json'),
  workerEvents: path.join(ARTIFACT_ROOT, 'worker_events.json'),
  liveExecutionSummary: path.join(ARTIFACT_ROOT, 'live_execution_summary.json'),
  scaleQualification: path.join(ARTIFACT_ROOT, 'scale_qualification.json'),
  validationIndex: path.join(VALIDATION_DIR, 'validation_index.json'),
  mergeReport: path.join(MERGE_DIR, 'merge_report.json'),
  recoveryReport: path.join(RECOVERY_DIR, 'recovery_report.json'),
  blockerReport: path.join(ARTIFACT_ROOT, 'blocker_report.json'),
  supervisorStatus: path.join(ARTIFACT_ROOT, 'supervisor_status.json'),
  programState: path.join(ARTIFACT_ROOT, 'program_state.json'),
  completionSummary: path.join(ARTIFACT_ROOT, 'completion_summary.json'),
  notificationState: path.join(ARTIFACT_ROOT, 'notification_state.json')
};

export function ensureDirs() {
  for (const dirPath of [ARTIFACT_ROOT, VALIDATION_DIR, RUNS_DIR, MERGE_DIR, RECOVERY_DIR, REPORTS_DIR]) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function walkMjs(dirPath) {
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMjs(nextPath));
      continue;
    }
    if (/\.(mjs|js)$/.test(entry.name)) out.push(nextPath);
  }
  return out.sort();
}

export function contractInput() {
  return {
    replyAnchor: 'user approved running the orchestrator against the real Mailchimp clone repo',
    anchor: [
      'current multi-agent orchestrator is live-qualified to 100 in fixture mode under /root/clawd/large-project-capability-stack',
      'current conversation concluding that the right next test is staged live qualification on the real /root/clawd/mailchimp-clone repo',
      'current Mailchimp clone campaign artifacts and repo state'
    ].join(' | '),
    targetPath: ROOT,
    requestedFidelity: 'full_clone',
    requestedScope: [
      'real Mailchimp-repo orchestrator qualification',
      'staged live coordination tiers 8 -> 16 -> 32 -> 64 -> 100 as honest qualification allows',
      'parallel regression depth across real package surfaces, runtime shells, and full-repo health checks'
    ],
    stopCondition: 'supervisor_green_or_blocker_report',
    blockerPolicy: 'stop only on supervisor green or a structured blocker report when repo integrity or honest qualification fails',
    evidenceRequirements: [
      'real repo work graph and shard plan',
      'context packs and verifier catalog',
      'live worker event trail per tier',
      'lease, merge, patch, and recovery artifacts',
      'repo test and smoke validation logs',
      'staged scale qualification report with honest highest proven tier',
      'program, completion, notification, and supervisor state'
    ],
    implementationSurface: 'actual Mailchimp repo work + orchestrator-driven shard execution + tests + merge/lease/recovery artifacts',
    campaignMode: 'persistent'
  };
}

export function issueDefinitions() {
  return [
    {
      id: 'q1.real_repo_parallel_slice',
      title: 'Real Mailchimp repo parallel qualification slice compiled',
      lane: 'planning',
      acceptanceCriteria: [
        'work graph is built from real Mailchimp package and runtime surfaces',
        'shard plan exceeds 120 shards',
        'context packs are generated for every shard'
      ]
    },
    {
      id: 'q2.live_worker_execution',
      title: 'Live worker farm executes real repo shard verifiers',
      lane: 'execution',
      deps: ['q1.real_repo_parallel_slice'],
      acceptanceCriteria: [
        'live worker farm runs against /root/clawd/mailchimp-clone',
        'lease and patch artifacts are recorded',
        'selected passing tier has zero state loss'
      ]
    },
    {
      id: 'q3.staged_scale_ladder',
      title: 'Staged scale ladder records the honest highest proven tier',
      lane: 'qualification',
      deps: ['q2.live_worker_execution'],
      acceptanceCriteria: [
        'tiers start at 8 and progress upward until honest stop',
        'scale_qualification.json distinguishes real repo live mode from fixture qualification',
        '100 is claimed only if the real repo truly passes at 100'
      ]
    },
    {
      id: 'q4.repo_integrity',
      title: 'Repo tests and smoke remain green or recoverable throughout qualification',
      lane: 'validation',
      deps: ['q3.staged_scale_ladder'],
      acceptanceCriteria: [
        'baseline repo tests pass',
        'post-tier repo tests remain green for every passing tier',
        'final smoke proof passes on the real repo'
      ]
    },
    {
      id: 'q5.supervisor_state',
      title: 'Supervisor-owned completion, notification, and program state artifacts exist',
      lane: 'supervision',
      deps: ['q4.repo_integrity'],
      acceptanceCriteria: [
        'program_state.json exists',
        'completion_summary.json exists',
        'notification_state.json exists',
        'supervisor_status.json reflects the final truth gate'
      ]
    }
  ];
}

export function surfaceDefinitions() {
  return [
    {
      id: 'real_repo_slice',
      label: 'Real repo parallel qualification slice',
      issueIds: ['q1.real_repo_parallel_slice'],
      requiredArtifacts: [paths.contract, paths.workGraph, paths.shardPlan, paths.contextPacks]
    },
    {
      id: 'live_worker_execution',
      label: 'Live worker execution, lease, merge, and recovery evidence',
      issueIds: ['q2.live_worker_execution'],
      requiredArtifacts: [paths.liveExecutionSummary, paths.leaseState, paths.patchQueueReport, paths.mergeReport, paths.recoveryReport]
    },
    {
      id: 'staged_scale_ladder',
      label: 'Staged real-repo scale ladder with honest highest tier',
      issueIds: ['q3.staged_scale_ladder'],
      requiredArtifacts: [paths.scaleQualification, paths.selectedTierSupervisor, paths.selectedTierSummary]
    },
    {
      id: 'repo_integrity',
      label: 'Repo integrity validation logs and smoke proof',
      issueIds: ['q4.repo_integrity'],
      requiredArtifacts: [paths.validationIndex, path.join(VALIDATION_DIR, 'baseline_repo_tests.log'), path.join(VALIDATION_DIR, 'final_smoke.log')]
    },
    {
      id: 'supervisor_state',
      label: 'Supervisor-owned completion state',
      issueIds: ['q5.supervisor_state'],
      requiredArtifacts: [paths.programState, paths.completionSummary, paths.notificationState, paths.supervisorStatus]
    }
  ];
}

export function discoverPackageQualificationTargets() {
  const packageRoot = path.join(ROOT, 'packages');
  const testRoot = path.join(ROOT, 'tests');
  const targets = [];
  for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageName = entry.name;
    const testFile = path.join(testRoot, `${packageName}.test.mjs`);
    if (!fs.existsSync(testFile)) continue;
    const packageDir = path.join(packageRoot, packageName);
    const sourceFiles = walkMjs(packageDir).map(relative);
    targets.push({
      id: packageName,
      packageDir: relative(packageDir),
      testFile: relative(testFile),
      sourceFiles,
      importFile: sourceFiles.includes(`packages/${packageName}/index.mjs`) ? `packages/${packageName}/index.mjs` : sourceFiles[0],
      domain: packageName.split('-')[0] || packageName
    });
  }
  return targets.sort((left, right) => left.id.localeCompare(right.id));
}

export function runtimeQualificationTargets() {
  if (PRODUCT_ONLY_MODE) return [];
  return [
    {
      id: 'runtime.app-shells',
      lane: 'runtime_regression',
      domain: 'app',
      fileAreas: ['apps', 'src/server.js'],
      allowedFiles: [
        'apps/admin-console/server.mjs',
        'apps/customer-success/server.mjs',
        'apps/developer-portal/server.mjs',
        'apps/ops-observer/server.mjs',
        'apps/web/server.mjs',
        'src/server.js'
      ],
      requiredVerifiers: productOnlyVerifiers(['lint', 'imports', 'tests']),
      metadata: {
        importFile: 'apps/web/server.mjs',
        testFile: 'tests/app-shells.test.mjs',
        extraTestFiles: []
      }
    },
    {
      id: 'runtime.campaign-pipeline',
      lane: 'runtime_regression',
      domain: 'campaign',
      fileAreas: ['tests/campaign-pipeline.test.mjs'],
      allowedFiles: ['tests/campaign-pipeline.test.mjs'],
      requiredVerifiers: productOnlyVerifiers(['tests']),
      metadata: {
        testFile: 'tests/campaign-pipeline.test.mjs'
      }
    },
    {
      id: 'runtime.customer-journeys',
      lane: 'runtime_regression',
      domain: 'journeys',
      fileAreas: ['packages/customer-journeys', 'tests/automation-journeys.test.mjs', 'tests/transactional-journeys.test.mjs'],
      allowedFiles: walkMjs(path.join(ROOT, 'packages', 'customer-journeys')).map(relative),
      requiredVerifiers: productOnlyVerifiers(['lint', 'imports', 'tests']),
      metadata: {
        importFile: 'packages/customer-journeys/index.mjs',
        testFile: 'tests/automation-journeys.test.mjs',
        extraTestFiles: ['tests/transactional-journeys.test.mjs']
      }
    },
    {
      id: 'runtime.platform-spine',
      lane: 'runtime_regression',
      domain: 'platform',
      fileAreas: ['packages/app', 'tests/platform-spine.test.mjs', 'tests/forms-landing.test.mjs', 'tests/reports-admin.test.mjs'],
      allowedFiles: walkMjs(path.join(ROOT, 'packages', 'app')).map(relative),
      requiredVerifiers: productOnlyVerifiers(['lint', 'imports', 'tests']),
      metadata: {
        importFile: 'packages/app/index.mjs',
        testFile: 'tests/platform-spine.test.mjs',
        extraTestFiles: ['tests/forms-landing.test.mjs', 'tests/reports-admin.test.mjs']
      }
    }
  ];
}

export function buildRealRepoWorkGraph() {
  const packageTargets = discoverPackageQualificationTargets();
  const workUnits = [];
  const sourceIssueIds = [];
  const regressionIssueIds = [];
  const runtimeIssueIds = [];

  for (const target of packageTargets) {
    const sourceId = `pkg.${target.id}.source`;
    const testId = `pkg.${target.id}.tests`;
    workUnits.push({
      id: sourceId,
      title: `${target.id} source integrity`,
      goal: `Verify ${target.id} source surface is importable and syntax-clean`,
      lane: 'package_integrity',
      domain: target.domain,
      fileAreas: [target.packageDir],
      allowedFiles: target.sourceFiles,
      inputRefs: ['qualificationPolicy'],
      inputs: { packageName: target.id, kind: 'source', importFile: target.importFile },
      acceptanceChecks: [
        `syntax-check ${target.id}`,
        `import ${target.importFile}`,
        `persist artifact trail for ${target.id} source`
      ],
      requiredVerifiers: ['lint', 'imports'],
      effortSteps: 1,
      metadata: {
        packageName: target.id,
        kind: 'source',
        importFile: target.importFile,
        sourceFiles: target.sourceFiles
      }
    });
    if (!PRODUCT_ONLY_MODE) {
      workUnits.push({
        id: testId,
        title: `${target.id} targeted regression`,
        lane: 'package_regression',
        domain: target.domain,
        fileAreas: [target.testFile],
        allowedFiles: [target.testFile],
        evidence: ['targeted regression green'],
        requiredVerifiers: ['test'],
        effortSteps: 1,
        metadata: {
          packageName: target.id,
          kind: 'tests',
          testFile: target.testFile
        }
      });
      regressionIssueIds.push(testId);
    }

    sourceIssueIds.push(sourceId);
  }

  for (const runtimeTarget of runtimeQualificationTargets()) {
    workUnits.push({
      id: runtimeTarget.id,
      title: runtimeTarget.id.replace(/^runtime\./, '').replace(/-/g, ' '),
      goal: `Verify ${runtimeTarget.id} runtime slice on the real repo`,
      lane: runtimeTarget.lane,
      domain: runtimeTarget.domain,
      fileAreas: runtimeTarget.fileAreas,
      allowedFiles: runtimeTarget.allowedFiles,
      inputRefs: ['qualificationPolicy'],
      inputs: { runtimeTarget: runtimeTarget.id },
      acceptanceChecks: [`verify ${runtimeTarget.id}`],
      requiredVerifiers: runtimeTarget.requiredVerifiers,
      effortSteps: 1,
      metadata: runtimeTarget.metadata
    });
    runtimeIssueIds.push(runtimeTarget.id);
  }

  return {
    workGraph: {
      version: 1,
      targetPath: ROOT,
      workUnits
    },
    surfaceMatrix: {
      generatedAt: new Date().toISOString(),
      status: 'planned',
      surfaces: [
        { id: 'PACKAGE_SOURCE', label: 'Package source integrity', issueIds: sourceIssueIds },
        { id: 'PACKAGE_REGRESSION', label: 'Package targeted regression depth', issueIds: regressionIssueIds },
        { id: 'RUNTIME_REALISM', label: 'Runtime shell and smoke realism', issueIds: runtimeIssueIds }
      ]
    },
    globalInputs: {
      qualificationPolicy: 'Use real Mailchimp repo files and executable verifiers only; preserve repo integrity and stop at the highest honestly proven scale tier.'
    },
    packageTargets
  };
}

export function buildFailurePlan({ shardPlan, leaseTtlMs }) {
  const crashTargets = shardPlan.shards.filter((_, index) => index % 41 === 0).slice(0, 3);
  const stallTargets = shardPlan.shards.filter((_, index) => index % 29 === 0).slice(0, 5);
  const plan = [];
  for (const shard of crashTargets) {
    plan.push({
      shardId: shard.id,
      attempt: 1,
      mode: 'crash',
      note: 'real-repo deterministic crash injection'
    });
  }
  for (const shard of stallTargets) {
    if (plan.some((entry) => entry.shardId === shard.id && entry.attempt === 1)) continue;
    plan.push({
      shardId: shard.id,
      attempt: 1,
      mode: 'stall',
      delayMs: leaseTtlMs * 2,
      note: 'real-repo deterministic stall injection'
    });
  }
  return plan.sort((left, right) => left.shardId.localeCompare(right.shardId));
}

export function buildVerifierCatalog() {
  return {
    generatedAt: new Date().toISOString(),
    workspacePath: ROOT,
    qualificationMode: 'real_mailchimp_repo_live_worker_farm',
    verifiers: [
      {
        id: 'lint',
        command: `${process.execPath} ${VERIFIER_SCRIPT} --assignment <assignment.json> --verifier lint`,
        proof: 'runs node --check across shard-owned source files'
      },
      {
        id: 'imports',
        command: `${process.execPath} ${VERIFIER_SCRIPT} --assignment <assignment.json> --verifier imports`,
        proof: 'dynamically imports the shard entry surface from the real repo'
      },
      {
        id: 'tests',
        command: `${process.execPath} ${VERIFIER_SCRIPT} --assignment <assignment.json> --verifier tests`,
        proof: 'executes targeted node --test files against the real repo'
      },
      {
        id: 'smoke',
        command: `${process.execPath} ${VERIFIER_SCRIPT} --assignment <assignment.json> --verifier smoke`,
        proof: 'executes the real smoke-full-clone flow against a live ephemeral server'
      }
    ]
  };
}

export function tierRunDir(tier) {
  return path.join(RUNS_DIR, `tier-${String(tier).padStart(3, '0')}`);
}

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return payload;
}
