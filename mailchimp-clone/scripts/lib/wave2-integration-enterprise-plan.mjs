import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'wave_2_integration_enterprise');
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
export const REPORT_PATH = path.join(REPORTS_DIR, 'wave2_integration_enterprise_report.json');
export const REPO_TEST_LOG_PATH = path.join(VALIDATION_DIR, 'repo_tests.log');
export const SMOKE_PATH = path.join(VALIDATION_DIR, 'live_smoke.json');
export const EVIDENCE_PATH = path.join(VALIDATION_DIR, 'wave2_surface_evidence.json');

export function contractInput() {
  return {
    replyAnchor: 'user approved starting Wave 2 from the real_world_indistinguishable roadmap',
    anchor: [
      '/root/clawd/large-project-capability-stack/artifacts/qualification/mailchimp_real_world_indistinguishable_path/current_gap_analysis.json',
      '/root/clawd/large-project-capability-stack/artifacts/qualification/mailchimp_real_world_indistinguishable_path/trajectory_estimate.json',
      '/root/clawd/large-project-capability-stack/artifacts/qualification/mailchimp_real_world_indistinguishable_path/roadmap_backlog.json',
      '/root/clawd/mailchimp-clone/artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/completion_summary.json'
    ].join(' | '),
    targetPath: ROOT,
    requestedFidelity: 'full_clone',
    requestedScope: [
      'Wave 2 — integration realism',
      'Wave 2 — enterprise/admin/compliance breadth',
      'integrations_marketplace',
      'commerce_revenue',
      'deliverability_compliance',
      'collaboration_approval',
      'content_asset_templates',
      'updated Wave 2 contract/graph/matrix/state/supervisor artifacts'
    ],
    stopCondition: 'supervisor_green_or_blocker_report',
    blockerPolicy: 'if supervisor red without real blocker continue; stop only on structured blocker report',
    evidenceRequirements: [
      'repo-tests',
      'live-http-smoke',
      'surface-evidence-json',
      'wave2-surface-matrix',
      'wave2-report',
      'recovery-ledger'
    ],
    implementationSurface: 'actual product code + tests + integration/admin/compliance surfaces + updated supervisor/runtime artifacts',
    campaignMode: 'persistent'
  };
}

export function issueDefinitions() {
  return [
    {
      id: 'integrations_marketplace_surface',
      title: 'Integrations marketplace surface with connector installs and sync realism',
      lane: 'integration_realism',
      acceptanceCriteria: [
        'Marketplace route exists with install actions and sync history',
        'Connector domain logic persists installs and sync runs',
        'Integration tests and smoke checks validate installs plus syncs'
      ],
      artifacts: ['packages/app/routes/integrations-marketplace.mjs', 'packages/app/domain-integration-marketplace.mjs', 'tests/integrations-marketplace.test.mjs']
    },
    {
      id: 'commerce_revenue_surface',
      title: 'Commerce and revenue attribution surface with store sync realism',
      lane: 'integration_realism',
      deps: ['integrations_marketplace_surface'],
      acceptanceCriteria: [
        'Commerce route exists with stores, catalog, orders, and revenue rows',
        'Revenue domain persists stores, products, orders, and attribution rows',
        'Commerce tests and smoke checks validate attributed revenue visibility'
      ],
      artifacts: ['packages/app/routes/commerce-revenue.mjs', 'packages/app/domain-commerce-revenue.mjs', 'tests/commerce-revenue.test.mjs']
    },
    {
      id: 'deliverability_compliance_surface',
      title: 'Deliverability and compliance center surface with suppression and alert handling',
      lane: 'enterprise_governance',
      acceptanceCriteria: [
        'Deliverability route exists with inbox readiness, alerts, and suppressions',
        'Compliance domain computes health and resolves alerts',
        'Deliverability tests and smoke checks validate enterprise compliance state'
      ],
      artifacts: ['packages/app/routes/deliverability-compliance.mjs', 'packages/app/domain-deliverability-compliance.mjs', 'tests/deliverability-compliance.test.mjs']
    },
    {
      id: 'collaboration_approval_surface',
      title: 'Collaboration approval surface with approval queue, comments, and decisions',
      lane: 'enterprise_governance',
      acceptanceCriteria: [
        'Approval route exists with request, comment, approve, and changes-requested flows',
        'Approval domain persists approval requests and comments against product targets',
        'Approval tests and smoke checks validate governance workflow state'
      ],
      artifacts: ['packages/app/routes/collaboration-approval.mjs', 'packages/app/domain-collaboration-approval.mjs', 'tests/collaboration-approval.test.mjs']
    },
    {
      id: 'content_asset_templates_surface',
      title: 'Content asset templates surface with brand kit and reusable template library',
      lane: 'content_authoring',
      acceptanceCriteria: [
        'Content route exists with brand kit, reusable templates, and collections',
        'Template domain persists content templates and brand kit state',
        'Content tests and smoke checks validate saved templates and API visibility'
      ],
      artifacts: ['packages/app/routes/content-asset-templates.mjs', 'packages/app/domain-template-assets.mjs', 'tests/content-asset-templates.test.mjs']
    },
    {
      id: 'wave2_supervision_and_runtime',
      title: 'Wave 2 supervisor/runtime artifacts are machine-readable and green',
      lane: 'control_plane',
      deps: [
        'integrations_marketplace_surface',
        'commerce_revenue_surface',
        'deliverability_compliance_surface',
        'collaboration_approval_surface',
        'content_asset_templates_surface'
      ],
      acceptanceCriteria: [
        'Wave 2 contract, graph, matrix, state, summary, notifier, worker state, and ledger exist',
        'Wave 2 live smoke and evidence artifacts exist',
        'Wave 2 supervisor status becomes green without claiming full-project completion'
      ],
      artifacts: [CONTRACT_PATH, GRAPH_PATH, MATRIX_PATH, PROGRAM_STATE_PATH, SUMMARY_PATH, NOTIFY_PATH, WORKER_STATE_PATH, LEDGER_PATH, REPORT_PATH, SMOKE_PATH, EVIDENCE_PATH]
    }
  ];
}

export function surfaceDefinitions() {
  return [
    {
      id: 'integrations_marketplace',
      label: 'Wave 2 integrations marketplace',
      issueIds: ['integrations_marketplace_surface'],
      requiredArtifacts: [path.join(ROOT, 'packages', 'app', 'routes', 'integrations-marketplace.mjs'), path.join(ROOT, 'packages', 'app', 'domain-integration-marketplace.mjs'), path.join(ROOT, 'tests', 'integrations-marketplace.test.mjs')]
    },
    {
      id: 'commerce_revenue',
      label: 'Wave 2 commerce revenue attribution',
      issueIds: ['commerce_revenue_surface'],
      requiredArtifacts: [path.join(ROOT, 'packages', 'app', 'routes', 'commerce-revenue.mjs'), path.join(ROOT, 'packages', 'app', 'domain-commerce-revenue.mjs'), path.join(ROOT, 'tests', 'commerce-revenue.test.mjs')]
    },
    {
      id: 'deliverability_compliance',
      label: 'Wave 2 deliverability compliance center',
      issueIds: ['deliverability_compliance_surface'],
      requiredArtifacts: [path.join(ROOT, 'packages', 'app', 'routes', 'deliverability-compliance.mjs'), path.join(ROOT, 'packages', 'app', 'domain-deliverability-compliance.mjs'), path.join(ROOT, 'tests', 'deliverability-compliance.test.mjs')]
    },
    {
      id: 'collaboration_approval',
      label: 'Wave 2 collaboration approval workflows',
      issueIds: ['collaboration_approval_surface'],
      requiredArtifacts: [path.join(ROOT, 'packages', 'app', 'routes', 'collaboration-approval.mjs'), path.join(ROOT, 'packages', 'app', 'domain-collaboration-approval.mjs'), path.join(ROOT, 'tests', 'collaboration-approval.test.mjs')]
    },
    {
      id: 'content_asset_templates',
      label: 'Wave 2 content asset templates and brand kit',
      issueIds: ['content_asset_templates_surface'],
      requiredArtifacts: [path.join(ROOT, 'packages', 'app', 'routes', 'content-asset-templates.mjs'), path.join(ROOT, 'packages', 'app', 'domain-template-assets.mjs'), path.join(ROOT, 'tests', 'content-asset-templates.test.mjs')]
    },
    {
      id: 'wave2_control_plane',
      label: 'Wave 2 supervisor/runtime/control-plane artifacts',
      issueIds: ['wave2_supervision_and_runtime'],
      requiredArtifacts: [CONTRACT_PATH, GRAPH_PATH, MATRIX_PATH, PROGRAM_STATE_PATH, SUMMARY_PATH, NOTIFY_PATH, WORKER_STATE_PATH, LEDGER_PATH, REPORT_PATH, SMOKE_PATH, EVIDENCE_PATH]
    }
  ];
}
