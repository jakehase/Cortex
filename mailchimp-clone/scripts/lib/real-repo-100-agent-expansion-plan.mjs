import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const STACK_ROOT = path.resolve(new URL('../../../large-project-capability-stack', import.meta.url).pathname);
export const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'real_repo_100_agent_expansion_wave6');
export const VALIDATION_DIR = path.join(ARTIFACT_ROOT, 'validation');
export const REPORTS_DIR = path.join(ARTIFACT_ROOT, 'reports');

export const paths = {
  contract: path.join(ARTIFACT_ROOT, 'contract.json'),
  graph: path.join(ARTIFACT_ROOT, 'issue_graph.json'),
  matrix: path.join(ARTIFACT_ROOT, 'surface_matrix.json'),
  ledger: path.join(ARTIFACT_ROOT, 'ledger.json'),
  campaign: path.join(ARTIFACT_ROOT, 'campaign_state.json'),
  programState: path.join(ARTIFACT_ROOT, 'program_state.json'),
  completionSummary: path.join(ARTIFACT_ROOT, 'completion_summary.json'),
  notification: path.join(ARTIFACT_ROOT, 'notification_state.json'),
  supervisor: path.join(REPORTS_DIR, 'supervisor_status.json'),
  blocker: path.join(REPORTS_DIR, 'blocker_report.json'),
  delta: path.join(REPORTS_DIR, 'delta_summary.json'),
  orchestratorSummary: path.join(ROOT, 'artifacts', 'qualification', 'orchestrator_real_repo', 'completion_summary.json'),
  qualificationSummary: path.join(STACK_ROOT, 'artifacts', 'qualification', 'mailchimp_full_clone_truth', 'claim_certification.json'),
  pathGap: path.join(STACK_ROOT, 'artifacts', 'qualification', 'mailchimp_real_world_indistinguishable_path', 'current_gap_analysis.json'),
  pathSummary: path.join(STACK_ROOT, 'artifacts', 'qualification', 'mailchimp_real_world_indistinguishable_path', 'reports', 'qualification_summary.json')
};

export function contractInput() {
  return {
    replyAnchor: 'user approved using the newly proven 100-agent real-repo orchestrator path to push the Mailchimp clone itself toward the top-tier claim',
    anchor: [
      '/root/clawd/mailchimp-clone/artifacts/qualification/orchestrator_real_repo/',
      '/root/clawd/large-project-capability-stack/artifacts/qualification/mailchimp_real_world_indistinguishable_path/current_gap_analysis.json',
      'current conversation explicitly approving the next step'
    ],
    targetPath: ROOT,
    requestedFidelity: 'full_clone',
    requestedScope: [
      '100-agent real-repo expansion wave 6 package/domain growth',
      'main app integration route for wave 6 surfaces',
      'additional app shells for lifecycle, compliance, and integrations',
      'test-file expansion to 150-node-test census',
      'real browser proof deepening to 60+ checks',
      'smoke/live evidence refresh',
      'real repo orchestrator qualification rerun',
      'truth refresh and top-tier path refresh',
      'campaign contract/graph/matrix/state/supervisor/notifier artifacts'
    ],
    stopCondition: 'supervisor_green_or_blocker_report',
    blockerPolicy: 'if supervisor red without real blocker continue; stop only on structured blocker report',
    evidenceRequirements: [
      'npm test green',
      'smoke artifact green',
      'wave1 browser proof artifact refreshed',
      'orchestrator real repo completion summary',
      'stack qualification claim certification refreshed',
      'real-world path gap analysis refreshed',
      'campaign matrix/program/supervisor/blocker artifacts'
    ],
    implementationSurface: 'actual Mailchimp repo product code + tests + browser/live evidence + architecture/app/package growth + campaign artifacts',
    campaignMode: 'persistent'
  };
}

export function issueDefinitions() {
  return [
    {
      id: 'wave6.package_expansion',
      title: 'Wave 6 package/domain expansion',
      lane: 'product',
      acceptanceCriteria: ['new package roots exist', 'new package tests exist', 'product lines materially increase'],
      artifacts: [path.join(ROOT, 'packages', 'attribution-modeling', 'index.mjs'), path.join(ROOT, 'packages', 'webhook-inspector', 'index.mjs')]
    },
    {
      id: 'wave6.app_shells',
      title: 'Wave 6 app shells for lifecycle, compliance, and integrations',
      lane: 'architecture',
      deps: ['wave6.package_expansion'],
      acceptanceCriteria: ['new app roots exist', 'catalog endpoints work'],
      artifacts: [path.join(ROOT, 'apps', 'lifecycle-studio', 'server.mjs'), path.join(ROOT, 'apps', 'compliance-hub', 'server.mjs'), path.join(ROOT, 'apps', 'integrations-studio', 'server.mjs')]
    },
    {
      id: 'wave6.main_app_surface',
      title: 'Main app scale-wave route exposes generated surfaces',
      lane: 'product',
      deps: ['wave6.package_expansion'],
      acceptanceCriteria: ['/scale-wave-six route exists', 'main app registers the route', 'route test passes'],
      artifacts: [path.join(ROOT, 'packages', 'app', 'routes', 'scale-wave-six.mjs'), path.join(ROOT, 'apps', 'web', 'server.mjs'), path.join(ROOT, 'tests', 'scale-wave-six.test.mjs')]
    },
    {
      id: 'wave6.test_expansion',
      title: 'Test-file expansion and repo-wide regression green',
      lane: 'tests',
      deps: ['wave6.package_expansion', 'wave6.app_shells', 'wave6.main_app_surface'],
      acceptanceCriteria: ['npm test passes', 'repo test census reaches 150 files'],
      artifacts: [path.join(ROOT, 'tests', 'attribution-modeling.test.mjs'), path.join(ROOT, 'tests', 'wave6-cluster-growth.test.mjs')]
    },
    {
      id: 'wave6.live_browser_evidence',
      title: 'Live smoke and real browser evidence deepen on the enlarged repo',
      lane: 'evidence',
      deps: ['wave6.main_app_surface'],
      acceptanceCriteria: ['smoke script passes', 'browser proof refreshes with 60+ checks'],
      artifacts: [path.join(ROOT, 'artifacts', 'mailchimp_clone', 'full_clone', 'validation', 'live_smoke_full_clone.json'), path.join(ROOT, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'wave_1_browser_foundation', 'validation', 'browser_proof.json')]
    },
    {
      id: 'wave6.orchestrator_real_repo',
      title: 'Proven 100-agent real-repo orchestrator reruns against the enlarged repo',
      lane: 'orchestrator',
      deps: ['wave6.test_expansion'],
      acceptanceCriteria: ['orchestrator completion summary refreshed', 'tier 100 remains green'],
      artifacts: [paths.orchestratorSummary]
    },
    {
      id: 'wave6.truth_refresh',
      title: 'Truth gate and real-world path refresh after the expansion',
      lane: 'qualification',
      deps: ['wave6.live_browser_evidence', 'wave6.orchestrator_real_repo'],
      acceptanceCriteria: ['claim certification refreshed', 'path gap analysis refreshed'],
      artifacts: [paths.qualificationSummary, paths.pathGap, paths.pathSummary]
    },
    {
      id: 'wave6.top_tier_claim',
      title: 'Requested real_world_indistinguishable claim is either certified or honestly blocked',
      lane: 'supervision',
      deps: ['wave6.truth_refresh'],
      acceptanceCriteria: ['supervisor report exists', 'completion summary exists', 'blocker report exists when red'],
      artifacts: [paths.supervisor, paths.completionSummary, paths.blocker]
    }
  ];
}

export function surfaceDefinitions() {
  return [
    { id: 'wave6_packages', label: 'Wave 6 package/domain expansion', issueIds: ['wave6.package_expansion'], requiredArtifacts: [path.join(ROOT, 'packages', 'attribution-modeling', 'index.mjs'), path.join(ROOT, 'packages', 'webhook-inspector', 'index.mjs')] },
    { id: 'wave6_apps', label: 'Wave 6 auxiliary app shells', issueIds: ['wave6.app_shells'], requiredArtifacts: [path.join(ROOT, 'apps', 'lifecycle-studio', 'server.mjs'), path.join(ROOT, 'apps', 'compliance-hub', 'server.mjs'), path.join(ROOT, 'apps', 'integrations-studio', 'server.mjs')] },
    { id: 'wave6_main_app', label: 'Main-app scale wave route', issueIds: ['wave6.main_app_surface'], requiredArtifacts: [path.join(ROOT, 'packages', 'app', 'routes', 'scale-wave-six.mjs'), path.join(ROOT, 'tests', 'scale-wave-six.test.mjs')] },
    { id: 'wave6_tests', label: 'Repo-wide test expansion', issueIds: ['wave6.test_expansion'], requiredArtifacts: [path.join(ROOT, 'tests', 'attribution-modeling.test.mjs'), path.join(ROOT, 'tests', 'wave6-cluster-growth.test.mjs')] },
    { id: 'wave6_browser_live', label: 'Live smoke + real browser evidence', issueIds: ['wave6.live_browser_evidence'], requiredArtifacts: [path.join(ROOT, 'artifacts', 'mailchimp_clone', 'full_clone', 'validation', 'live_smoke_full_clone.json'), path.join(ROOT, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'wave_1_browser_foundation', 'validation', 'browser_proof.json')] },
    { id: 'wave6_orchestrator', label: '100-agent real-repo orchestrator rerun', issueIds: ['wave6.orchestrator_real_repo'], requiredArtifacts: [paths.orchestratorSummary] },
    { id: 'wave6_qualification', label: 'Truth gate and real-world path refresh', issueIds: ['wave6.truth_refresh'], requiredArtifacts: [paths.qualificationSummary, paths.pathGap, paths.pathSummary] },
    { id: 'wave6_supervision', label: 'Campaign supervisor + notifier artifacts', issueIds: ['wave6.top_tier_claim'], requiredArtifacts: [paths.programState, paths.completionSummary, paths.notification, paths.supervisor, paths.blocker] }
  ];
}
