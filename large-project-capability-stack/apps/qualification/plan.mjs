import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const TARGET = '/root/clawd/mailchimp-clone';
export const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'qualification', 'mailchimp_full_clone_truth');
export const VALIDATION_DIR = path.join(ARTIFACT_ROOT, 'validation');
export const REPORTS_DIR = path.join(ARTIFACT_ROOT, 'reports');

export const paths = {
  contract: path.join(ARTIFACT_ROOT, 'contract.json'),
  graph: path.join(ARTIFACT_ROOT, 'issue_graph.json'),
  matrix: path.join(ARTIFACT_ROOT, 'surface_matrix.json'),
  ledger: path.join(ARTIFACT_ROOT, 'ledger.json'),
  campaign: path.join(ARTIFACT_ROOT, 'campaign_state.json'),
  stackArchitecture: path.join(ARTIFACT_ROOT, 'stack_architecture_report.json'),
  targetArchitecture: path.join(ARTIFACT_ROOT, 'mailchimp_architecture_report.json'),
  parity: path.join(ARTIFACT_ROOT, 'parity_evidence.json'),
  certification: path.join(ARTIFACT_ROOT, 'claim_certification.json'),
  recovery: path.join(ARTIFACT_ROOT, 'recovery_simulation.json'),
  programState: path.join(ARTIFACT_ROOT, 'program_state.json'),
  completionSummary: path.join(ARTIFACT_ROOT, 'completion_summary.json'),
  notification: path.join(ARTIFACT_ROOT, 'notification_state.json'),
  finalReport: path.join(ROOT, 'docs', 'MAILCHIMP_REAL_WORLD_INDISTINGUISHABLE_TRUTH_REPORT_2026-04-02.md')
};

export function surfaceDefinitions() {
  return [
    {
      id: 'Y1',
      label: 'Scale realism / overclaiming gate',
      issueIds: ['y1.scale_realism'],
      requiredArtifacts: [paths.certification, paths.targetArchitecture]
    },
    {
      id: 'Y2',
      label: 'Evidence-weighted certification / claim ladder',
      issueIds: ['y2.claim_ladder'],
      requiredArtifacts: [paths.certification, path.join(VALIDATION_DIR, 'repo_tests.log')]
    },
    {
      id: 'Y3',
      label: 'Browser-grade parity harness upgrade',
      issueIds: ['y3.browser_parity'],
      requiredArtifacts: [paths.parity]
    },
    {
      id: 'Y4',
      label: 'Architecture growth / scale budget enforcer',
      issueIds: ['y4.architecture_budget'],
      requiredArtifacts: [paths.stackArchitecture, paths.targetArchitecture]
    },
    {
      id: 'Y5',
      label: 'Persistent campaign requeue semantics',
      issueIds: ['y5.campaign_requeue'],
      requiredArtifacts: [paths.campaign]
    },
    {
      id: 'Y6',
      label: 'Qualification 2.0 against the current Mailchimp clone',
      issueIds: ['y6.qualification_truth'],
      requiredArtifacts: [
        paths.finalReport,
        paths.matrix,
        path.join(VALIDATION_DIR, 'mailchimp_supervisor.log')
      ]
    }
  ];
}
