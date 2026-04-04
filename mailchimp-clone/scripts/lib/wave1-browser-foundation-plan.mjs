import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'wave_1_browser_foundation');
export const VALIDATION_DIR = path.join(ARTIFACT_ROOT, 'validation');
export const REPORTS_DIR = path.join(ARTIFACT_ROOT, 'reports');
export const RECOVERY_DIR = path.join(ARTIFACT_ROOT, 'recovery');
export const CONTRACT_PATH = path.join(ARTIFACT_ROOT, 'contract.json');
export const GRAPH_PATH = path.join(ARTIFACT_ROOT, 'issue_graph.json');
export const MATRIX_PATH = path.join(ARTIFACT_ROOT, 'surface_matrix.json');
export const PROGRAM_STATE_PATH = path.join(ARTIFACT_ROOT, 'program_state.json');
export const SUMMARY_PATH = path.join(ARTIFACT_ROOT, 'completion_summary.json');
export const NOTIFY_PATH = path.join(ARTIFACT_ROOT, 'notification_state.json');
export const LEDGER_PATH = path.join(RECOVERY_DIR, 'ledger.json');
export const WORKER_STATE_PATH = path.join(ARTIFACT_ROOT, 'worker_state.json');
export const REPORT_PATH = path.join(REPORTS_DIR, 'wave1_browser_foundation_report.json');
export const PROOF_PATH = path.join(VALIDATION_DIR, 'browser_proof.json');
export const REPO_TEST_LOG_PATH = path.join(VALIDATION_DIR, 'repo_tests.log');
export const SCREENSHOT_DIR = path.join(VALIDATION_DIR, 'screenshots');

export function contractInput() {
  return {
    replyAnchor: 'user approved starting Wave 1 from the real_world_indistinguishable roadmap',
    anchor: [
      '/root/clawd/large-project-capability-stack/artifacts/qualification/mailchimp_real_world_indistinguishable_path/current_gap_analysis.json',
      '/root/clawd/large-project-capability-stack/artifacts/qualification/mailchimp_real_world_indistinguishable_path/trajectory_estimate.json',
      '/root/clawd/large-project-capability-stack/artifacts/qualification/mailchimp_real_world_indistinguishable_path/roadmap_backlog.json',
      'current conversation establishing that the target claim is real_world_indistinguishable, not large_product_replica'
    ].join(' | '),
    targetPath: ROOT,
    requestedFidelity: 'full_clone',
    requestedScope: [
      'Wave 1 — browser realism foundation',
      'Real browser automation path via Playwright/Chromium',
      'Material browser journey coverage increase across major product families',
      'Browser-oriented supervisor/runtime/evidence artifacts'
    ],
    stopCondition: 'supervisor_green_or_blocker_report',
    blockerPolicy: 'if supervisor red without real blocker continue; stop only on structured blocker report',
    evidenceRequirements: [
      'repo-tests',
      'real-browser-proof',
      'screenshots',
      'surface-matrix',
      'campaign-runtime-state',
      'recovery-ledger',
      'wave1-report'
    ],
    implementationSurface: 'actual product code + tests + browser/proof harness integration + updated supervisor/runtime artifacts',
    campaignMode: 'persistent'
  };
}

export function issueDefinitions() {
  return [
    {
      id: 'browser_observability_shell',
      title: 'Strengthen the product shell for browser-driven evidence',
      lane: 'product',
      acceptanceCriteria: [
        'Page shell exposes stable browser-observable metadata/attributes',
        'Product pages remain behaviorally compatible with existing tests',
        'Browser harness can identify page shell consistently'
      ],
      artifacts: ['packages/app/view.mjs', 'package.json']
    },
    {
      id: 'real_browser_runtime',
      title: 'Establish a real browser automation runtime for the clone repo',
      lane: 'browser-runtime',
      deps: ['browser_observability_shell'],
      acceptanceCriteria: [
        'Playwright/Chromium is integrated into the repo',
        'A shared browser proof runner exists in-repo',
        'Targeted browser tests run against the real app server'
      ],
      artifacts: ['package.json', 'package-lock.json', 'tests/browser-realism.test.mjs', 'scripts/lib/wave1-browser-proof.mjs']
    },
    {
      id: 'browser_journey_coverage',
      title: 'Materially expand browser journey coverage for Wave 1',
      lane: 'coverage',
      deps: ['real_browser_runtime'],
      acceptanceCriteria: [
        'Browser proof reports realBrowser=true',
        'Covered browser journey families >= 6 for Wave 1',
        'Campaign, audience, automation, public flows, reports, and admin families are represented'
      ],
      artifacts: ['tests/browser-realism.test.mjs', 'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/validation/browser_proof.json']
    },
    {
      id: 'browser_evidence_artifacts',
      title: 'Persist browser-oriented proof artifacts and screenshots',
      lane: 'evidence',
      deps: ['browser_journey_coverage'],
      acceptanceCriteria: [
        'Browser proof artifact is machine-readable JSON',
        'Journey screenshots exist for proof review',
        'Wave 1 report summarizes browser realism counts and families'
      ],
      artifacts: [
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/validation/browser_proof.json',
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/validation/screenshots/dashboard_workspace.png',
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/validation/screenshots/public_signup_flows.png',
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/reports/wave1_browser_foundation_report.json'
      ]
    },
    {
      id: 'wave1_supervision_and_runtime',
      title: 'Wave 1 supervisor/runtime state is machine-readable and green',
      lane: 'control-plane',
      deps: ['browser_evidence_artifacts'],
      acceptanceCriteria: [
        'Wave 1 contract, graph, matrix, worker state, program state, summary, notifier, and ledger exist',
        'Surface matrix resolves to all_complete for Wave 1 scope',
        'Supervisor status becomes green without overstating full-project completion'
      ],
      artifacts: [
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/contract.json',
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/issue_graph.json',
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/surface_matrix.json',
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/program_state.json',
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/completion_summary.json',
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/notification_state.json',
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/worker_state.json',
        'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/recovery/ledger.json'
      ]
    }
  ];
}

export function surfaceDefinitions() {
  return [
    {
      id: 'wave1_browser_shell',
      label: 'Wave 1 browser shell foundation in product code',
      issueIds: ['browser_observability_shell'],
      requiredArtifacts: [path.join(ROOT, 'packages', 'app', 'view.mjs'), path.join(ROOT, 'package.json')]
    },
    {
      id: 'wave1_real_browser_runtime',
      label: 'Wave 1 real browser runtime and targeted browser test integration',
      issueIds: ['real_browser_runtime'],
      requiredArtifacts: [path.join(ROOT, 'package-lock.json'), path.join(ROOT, 'tests', 'browser-realism.test.mjs'), path.join(ROOT, 'scripts', 'lib', 'wave1-browser-proof.mjs')]
    },
    {
      id: 'wave1_browser_coverage',
      label: 'Wave 1 browser journey coverage and evidence artifacts',
      issueIds: ['browser_journey_coverage', 'browser_evidence_artifacts'],
      requiredArtifacts: [
        PROOF_PATH,
        path.join(SCREENSHOT_DIR, 'campaign_editor.png'),
        path.join(SCREENSHOT_DIR, 'public_signup_flows.png'),
        REPORT_PATH
      ]
    },
    {
      id: 'wave1_control_plane',
      label: 'Wave 1 supervisor/runtime/control-plane artifacts',
      issueIds: ['wave1_supervision_and_runtime'],
      requiredArtifacts: [CONTRACT_PATH, GRAPH_PATH, MATRIX_PATH, PROGRAM_STATE_PATH, SUMMARY_PATH, NOTIFY_PATH, WORKER_STATE_PATH, LEDGER_PATH]
    }
  ];
}
