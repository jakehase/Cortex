import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const STACK_ROOT = path.resolve(ROOT, '..', 'large-project-capability-stack');
export const CAMPAIGN_ROOT = path.join(ROOT, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'loc_500k_campaign');
export const VALIDATION_DIR = path.join(CAMPAIGN_ROOT, 'validation');
export const REPORTS_DIR = path.join(CAMPAIGN_ROOT, 'reports');
export const TARGET_LOC = 500000;

export const paths = {
  contract: path.join(CAMPAIGN_ROOT, 'contract.json'),
  graph: path.join(CAMPAIGN_ROOT, 'issue_graph.json'),
  matrix: path.join(CAMPAIGN_ROOT, 'surface_matrix.json'),
  campaign: path.join(CAMPAIGN_ROOT, 'campaign_state.json'),
  programState: path.join(CAMPAIGN_ROOT, 'program_state.json'),
  completionSummary: path.join(CAMPAIGN_ROOT, 'completion_summary.json'),
  notificationState: path.join(CAMPAIGN_ROOT, 'notification_state.json'),
  locProgress: path.join(CAMPAIGN_ROOT, 'loc_progress.json'),
  supervisor: path.join(CAMPAIGN_ROOT, 'supervisor_status.json'),
  blocker: path.join(REPORTS_DIR, 'blocker_report.json'),
  validationState: path.join(VALIDATION_DIR, 'validation_state.json'),
  npmTestLog: path.join(VALIDATION_DIR, 'npm_test.log'),
  smokeLog: path.join(VALIDATION_DIR, 'smoke.log'),
  browserLog: path.join(VALIDATION_DIR, 'browser-proof.log'),
  orchestratorLog: path.join(VALIDATION_DIR, 'orchestrator-real-repo.log'),
  truthRefreshLog: path.join(VALIDATION_DIR, 'truth-refresh.log'),
  generatorLog540: path.join(VALIDATION_DIR, 'generator-540.log'),
  generatorLog620: path.join(VALIDATION_DIR, 'generator-620.log'),
  generatorLog700: path.join(VALIDATION_DIR, 'generator-700.log'),
  orchestratorSummary: path.join(ROOT, 'artifacts', 'qualification', 'orchestrator_real_repo', 'completion_summary.json'),
  orchestratorSupervisor: path.join(ROOT, 'artifacts', 'qualification', 'orchestrator_real_repo', 'supervisor_status.json'),
  truthCertification: path.join(STACK_ROOT, 'artifacts', 'qualification', 'mailchimp_full_clone_truth', 'claim_certification.json'),
  pathGap: path.join(STACK_ROOT, 'artifacts', 'qualification', 'mailchimp_real_world_indistinguishable_path', 'current_gap_analysis.json'),
  pathSummary: path.join(STACK_ROOT, 'artifacts', 'qualification', 'mailchimp_real_world_indistinguishable_path', 'reports', 'qualification_summary.json')
};

export function ensureDirs() {
  for (const dirPath of [CAMPAIGN_ROOT, VALIDATION_DIR, REPORTS_DIR]) fs.mkdirSync(dirPath, { recursive: true });
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

export function contractInput() {
  return {
    replyAnchor: 'user wants another massive expansion wave for the Mailchimp clone and explicitly wants the campaign to keep going until there is at least 500k LOC',
    anchor: [
      '/root/clawd/mailchimp-clone/artifacts/mailchimp_clone/real_world_indistinguishable/real_repo_100_agent_expansion_wave6/',
      'current conversation where the repo advanced to full_clone_credible but is still far below real_world_indistinguishable because of code/test/evidence mass',
      '/root/clawd/mailchimp-clone/artifacts/qualification/orchestrator_real_repo/'
    ],
    targetPath: ROOT,
    requestedFidelity: 'full_clone',
    requestedScope: [
      'LOC >= 500k Mailchimp expansion campaign',
      'massive continued package/domain growth',
      'main app route growth and auxiliary app shells',
      'test/regression expansion',
      'browser/live/evidence refresh',
      'orchestrator-driven shard qualification rerun',
      'top-tier truth refresh kept honest while pursuing the user-directed LOC threshold',
      'campaign contract/graph/matrix/program/supervisor/notifier artifacts'
    ],
    stopCondition: 'loc_gte_500k_or_blocker_report',
    blockerPolicy: 'stop only when code/test/script LOC >= 500000 with supervisor proof, or when a real blocker report exists',
    evidenceRequirements: [
      'loc_progress.json with machine-readable snapshots',
      'npm test green',
      'smoke proof green',
      'browser proof refreshed',
      'real repo orchestrator rerun refreshed',
      'truth refresh rerun refreshed',
      'supervisor-owned campaign artifacts'
    ],
    implementationSurface: 'actual Mailchimp clone code + tests + browser/live/evidence depth + orchestrator-driven shard execution + updated contract/graph/matrix/supervisor/notifier artifacts',
    campaignMode: 'persistent'
  };
}

export function issueDefinitions() {
  return [
    {
      id: 'loc500k.bootstrap',
      title: '500k campaign contract, graph, matrix, and loc tracking bootstrapped',
      lane: 'planning',
      acceptanceCriteria: ['contract exists', 'surface matrix exists', 'initial loc snapshot exists']
    },
    {
      id: 'loc500k.massive_package_growth',
      title: 'Massive package and product-surface growth lands in the repo',
      lane: 'product',
      deps: ['loc500k.bootstrap'],
      acceptanceCriteria: ['hundreds of new package roots exist', 'scale wave seven catalog exists', 'repo loc materially expands']
    },
    {
      id: 'loc500k.main_app_surface',
      title: 'Main authenticated app exposes the large new expansion route',
      lane: 'product',
      deps: ['loc500k.massive_package_growth'],
      acceptanceCriteria: ['/scale-wave-seven route exists', 'web server registers the route', 'route regression passes']
    },
    {
      id: 'loc500k.auxiliary_apps',
      title: 'Auxiliary app shells expose the large new catalog families',
      lane: 'architecture',
      deps: ['loc500k.massive_package_growth'],
      acceptanceCriteria: ['new app shells exist', 'app shell tests pass']
    },
    {
      id: 'loc500k.loc_threshold',
      title: 'Machine-readable LOC snapshots prove code/test/script total >= 500k',
      lane: 'validation',
      deps: ['loc500k.massive_package_growth'],
      acceptanceCriteria: ['loc_progress.json exists', 'latest snapshot total >= 500000']
    },
    {
      id: 'loc500k.repo_validation',
      title: 'Repo-wide tests plus live smoke and browser proof stay green',
      lane: 'validation',
      deps: ['loc500k.main_app_surface', 'loc500k.auxiliary_apps'],
      acceptanceCriteria: ['npm test passes', 'smoke passes', 'browser proof refreshes']
    },
    {
      id: 'loc500k.orchestrator',
      title: 'Real 100-agent orchestrator reruns against the enlarged repo',
      lane: 'orchestrator',
      deps: ['loc500k.repo_validation'],
      acceptanceCriteria: ['orchestrator completion summary refreshed', 'orchestrator supervisor remains green']
    },
    {
      id: 'loc500k.truth_refresh',
      title: 'Truth gate refreshes honestly after the loc campaign',
      lane: 'qualification',
      deps: ['loc500k.orchestrator'],
      acceptanceCriteria: ['claim certification refreshed', 'path gap analysis refreshed even if top-tier claim remains blocked']
    },
    {
      id: 'loc500k.supervision',
      title: 'Supervisor-owned completion, notification, and blocker artifacts exist',
      lane: 'supervision',
      deps: ['loc500k.loc_threshold', 'loc500k.truth_refresh'],
      acceptanceCriteria: ['program_state.json exists', 'completion_summary.json exists', 'notification_state.json exists', 'supervisor_status.json reflects the stop condition truth']
    }
  ];
}

export function surfaceDefinitions() {
  return [
    {
      id: 'campaign_bootstrap',
      label: 'Campaign bootstrap and loc tracking',
      issueIds: ['loc500k.bootstrap'],
      requiredArtifacts: [paths.contract, paths.graph, paths.matrix, paths.locProgress]
    },
    {
      id: 'massive_product_growth',
      label: 'Massive package growth and generated catalog',
      issueIds: ['loc500k.massive_package_growth'],
      requiredArtifacts: [
        path.join(ROOT, 'scripts', 'generate-loc-500k-expansion.mjs'),
        path.join(ROOT, 'packages', 'scale-wave-seven', 'index.mjs'),
        path.join(ROOT, 'packages', 'acquisition-advisor', 'index.mjs'),
        path.join(ROOT, 'packages', 'partner-cockpit', 'index.mjs')
      ]
    },
    {
      id: 'main_app_route',
      label: 'Main app scale-wave-seven route',
      issueIds: ['loc500k.main_app_surface'],
      requiredArtifacts: [
        path.join(ROOT, 'packages', 'app', 'routes', 'scale-wave-seven.mjs'),
        path.join(ROOT, 'tests', 'scale-wave-seven.test.mjs'),
        path.join(ROOT, 'apps', 'web', 'server.mjs')
      ]
    },
    {
      id: 'auxiliary_apps',
      label: 'Auxiliary app shells',
      issueIds: ['loc500k.auxiliary_apps'],
      requiredArtifacts: [
        path.join(ROOT, 'apps', 'growth-grid', 'server.mjs'),
        path.join(ROOT, 'apps', 'revenue-command', 'server.mjs'),
        path.join(ROOT, 'apps', 'trust-vault', 'server.mjs'),
        path.join(ROOT, 'apps', 'intelligence-works', 'server.mjs'),
        path.join(ROOT, 'apps', 'lifecycle-network', 'server.mjs')
      ]
    },
    {
      id: 'loc_threshold',
      label: 'LOC threshold proof',
      issueIds: ['loc500k.loc_threshold'],
      requiredArtifacts: [paths.locProgress]
    },
    {
      id: 'repo_validation',
      label: 'Repo validation logs',
      issueIds: ['loc500k.repo_validation'],
      requiredArtifacts: [paths.npmTestLog, paths.smokeLog, paths.browserLog, paths.validationState]
    },
    {
      id: 'orchestrator_refresh',
      label: 'Real repo orchestrator refresh',
      issueIds: ['loc500k.orchestrator'],
      requiredArtifacts: [paths.orchestratorSummary, paths.orchestratorSupervisor, paths.orchestratorLog]
    },
    {
      id: 'truth_refresh',
      label: 'Truth refresh artifacts',
      issueIds: ['loc500k.truth_refresh'],
      requiredArtifacts: [paths.truthCertification, paths.pathGap, paths.pathSummary, paths.truthRefreshLog]
    },
    {
      id: 'supervision',
      label: 'Supervisor-owned completion state',
      issueIds: ['loc500k.supervision'],
      requiredArtifacts: [paths.programState, paths.completionSummary, paths.notificationState, paths.supervisor]
    }
  ];
}

export function measureLoc() {
  const include = ['apps', 'packages', 'src', 'scripts', 'tests'];
  const excluded = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', 'tmp', '.turbo', '.git']);
  const snapshot = {
    generatedAt: new Date().toISOString(),
    targetTotal: TARGET_LOC,
    total: 0,
    productSource: 0,
    testsOnly: 0,
    scriptsOnly: 0,
    fileCount: 0,
    byTopLevel: {}
  };
  for (const top of include) {
    const base = path.join(ROOT, top);
    const bucket = { lines: 0, files: 0 };
    snapshot.byTopLevel[top] = bucket;
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const next = stack.pop();
      for (const entry of fs.readdirSync(next, { withFileTypes: true })) {
        const fullPath = path.join(next, entry.name);
        if (entry.isDirectory()) {
          if (!excluded.has(entry.name)) stack.push(fullPath);
          continue;
        }
        let text;
        try {
          text = fs.readFileSync(fullPath, 'utf8');
        } catch {
          continue;
        }
        const lines = text === '' ? 0 : text.split('\n').length;
        const rel = path.relative(ROOT, fullPath).replace(/\\/g, '/');
        snapshot.total += lines;
        snapshot.fileCount += 1;
        bucket.lines += lines;
        bucket.files += 1;
        if (rel.startsWith('tests/') || /\.(test|spec)\.(mjs|js|ts|tsx|jsx)$/.test(rel) || rel.includes('/__tests__/')) snapshot.testsOnly += lines;
        else if (rel.startsWith('scripts/') || rel.endsWith('.sh')) snapshot.scriptsOnly += lines;
        else snapshot.productSource += lines;
      }
    }
  }
  snapshot.locTargetMet = snapshot.total >= TARGET_LOC;
  return snapshot;
}
