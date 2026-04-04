import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'mailchimp_clone', 'full_clone');
export const VALIDATION_DIR = path.join(ARTIFACT_ROOT, 'validation');
export const REPORTS_DIR = path.join(ARTIFACT_ROOT, 'reports');
export const QUALIFICATION_DIR = path.join(ARTIFACT_ROOT, 'qualification');
export const CONTRACT_PATH = path.join(ROOT, 'contract.json');
export const GRAPH_PATH = path.join(ROOT, 'issue_graph.json');
export const MATRIX_PATH = path.join(ROOT, 'surface_matrix.json');
export const PROGRAM_STATE_PATH = path.join(ROOT, 'program_state.json');
export const SUMMARY_PATH = path.join(ROOT, 'completion_summary.json');
export const NOTIFY_PATH = path.join(ROOT, 'notification_state.json');
export const WORKER_STATE_PATH = path.join(ARTIFACT_ROOT, 'worker_state.json');
export const REPORT_PATH = path.join(ROOT, 'docs', 'MAILCHIMP_FULL_CLONE_FINAL_REPORT_2026-04-02.md');
export const SMOKE_PATH = path.join(VALIDATION_DIR, 'live_smoke_full_clone.json');
export const QUALIFICATION_PATH = path.join(QUALIFICATION_DIR, 'parity_evidence.json');

export function contractInput() {
  return {
    replyAnchor: 'user approved starting the true large-scale Mailchimp clone program under the new capability stack',
    anchor: 'true large-scale Mailchimp clone campaign using /root/clawd/large-project-capability-stack against /root/clawd/mailchimp-clone with Programs 4-7 plus architecture evolution',
    targetPath: ROOT,
    requestedFidelity: 'full_clone',
    requestedScope: [
      'Program 4 — Automation/journeys',
      'Program 5 — Forms/landing pages',
      'Program 6 — Reports/analytics/API/admin',
      'Program 7 — Deep parity sweep + hardening',
      'Architecture refactor from collapsed single-file server to scalable app/package split'
    ],
    stopCondition: 'supervisor_green_or_blocker_report',
    blockerPolicy: 'if supervisor red without real blocker continue; stop only on structured blocker report',
    evidenceRequirements: ['tests', 'smoke', 'architecture-enforcer', 'surface-matrix', 'supervisor-state', 'final-report'],
    implementationSurface: 'actual product code + tests + contract/graph/matrix/supervisor/notifier artifacts + architecture evolution',
    campaignMode: 'persistent'
  };
}

export function issueDefinitions() {
  return [
    {
      id: 'arch_refactor_foundation',
      title: 'Refactor repo into scalable app/package structure',
      lane: 'architecture',
      acceptanceCriteria: ['src/server.js becomes a thin wrapper', 'product routes split across modular files', 'architecture enforcer passes'],
      artifacts: ['apps/web/server.mjs', 'packages/app/routes/platform.mjs', 'packages/app/routes/audience.mjs', 'packages/app/routes/campaigns.mjs', 'tests/architecture-hardening.test.mjs']
    },
    {
      id: 'program4_automation_journeys',
      title: 'Program 4 automation overview and journey builder',
      lane: 'program4',
      deps: ['arch_refactor_foundation'],
      acceptanceCriteria: ['automation overview route exists', 'journey builder supports trigger, delay, branch, publish/pause/resume', 'broken-journey validation is visible'],
      artifacts: ['packages/app/routes/automations.mjs', 'tests/automation-journeys.test.mjs']
    },
    {
      id: 'program5_forms_landing_pages',
      title: 'Program 5 forms and landing page surfaces',
      lane: 'program5',
      deps: ['arch_refactor_foundation'],
      acceptanceCriteria: ['form builder exists', 'hosted signup/embed flow creates contacts', 'landing pages have publish validation and linkage'],
      artifacts: ['packages/app/routes/forms.mjs', 'tests/forms-landing.test.mjs']
    },
    {
      id: 'program6_reports_api_admin',
      title: 'Program 6 reports, analytics, API and admin surfaces',
      lane: 'program6',
      deps: ['arch_refactor_foundation'],
      acceptanceCriteria: ['reports overview and drilldown exist', 'API keys and webhooks exist', 'export history and admin state routes exist'],
      artifacts: ['packages/app/routes/reports.mjs', 'packages/app/routes/api-admin.mjs', 'tests/reports-admin.test.mjs']
    },
    {
      id: 'program7_hardening_regression',
      title: 'Program 7 parity sweep and hardening',
      lane: 'program7',
      deps: ['program4_automation_journeys', 'program5_forms_landing_pages', 'program6_reports_api_admin'],
      acceptanceCriteria: ['full regression suite passes', 'live smoke passes', 'final report and parity evidence exist'],
      artifacts: ['tests/platform-spine.test.mjs', 'tests/audience-core.test.mjs', 'tests/campaign-pipeline.test.mjs', 'artifacts/mailchimp_clone/full_clone/validation/live_smoke_full_clone.json', 'docs/MAILCHIMP_FULL_CLONE_FINAL_REPORT_2026-04-02.md']
    },
    {
      id: 'supervision_and_completion_artifacts',
      title: 'Contract, issue graph, surface matrix, supervisor state, notifier state, and summary are present',
      lane: 'control-plane',
      deps: ['program7_hardening_regression'],
      acceptanceCriteria: ['contract exists', 'issue graph exists', 'surface matrix all complete', 'program state green', 'completion summary exists'],
      artifacts: ['contract.json', 'issue_graph.json', 'surface_matrix.json', 'program_state.json', 'completion_summary.json', 'notification_state.json']
    }
  ];
}

export function surfaceDefinitions() {
  return [
    { id: 'architecture_evolution', label: 'Architecture evolution and enforcement', issueIds: ['arch_refactor_foundation'], requiredArtifacts: [path.join(ROOT, 'apps', 'web', 'server.mjs'), path.join(ROOT, 'packages', 'app', 'routes', 'platform.mjs')] },
    { id: 'program4_automations', label: 'Program 4 — Automation/journeys', issueIds: ['program4_automation_journeys'], requiredArtifacts: [path.join(ROOT, 'packages', 'app', 'routes', 'automations.mjs'), path.join(ROOT, 'tests', 'automation-journeys.test.mjs')] },
    { id: 'program5_forms_landing', label: 'Program 5 — Forms/landing pages', issueIds: ['program5_forms_landing_pages'], requiredArtifacts: [path.join(ROOT, 'packages', 'app', 'routes', 'forms.mjs'), path.join(ROOT, 'tests', 'forms-landing.test.mjs')] },
    { id: 'program6_reports_admin', label: 'Program 6 — Reports/analytics/API/admin', issueIds: ['program6_reports_api_admin'], requiredArtifacts: [path.join(ROOT, 'packages', 'app', 'routes', 'reports.mjs'), path.join(ROOT, 'packages', 'app', 'routes', 'api-admin.mjs'), path.join(ROOT, 'tests', 'reports-admin.test.mjs')] },
    { id: 'program7_hardening', label: 'Program 7 — Deep parity sweep + hardening', issueIds: ['program7_hardening_regression'], requiredArtifacts: [path.join(ROOT, 'tests', 'architecture-hardening.test.mjs'), path.join(ROOT, 'artifacts', 'mailchimp_clone', 'full_clone', 'validation', 'live_smoke_full_clone.json'), path.join(ROOT, 'docs', 'MAILCHIMP_FULL_CLONE_FINAL_REPORT_2026-04-02.md')] },
    { id: 'control_plane_artifacts', label: 'Supervisor-owned contract/graph/matrix/state/notifier artifacts', issueIds: ['supervision_and_completion_artifacts'], requiredArtifacts: [CONTRACT_PATH, GRAPH_PATH, PROGRAM_STATE_PATH, SUMMARY_PATH, NOTIFY_PATH] }
  ];
}
