import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const TARGET = '/root/clawd/mailchimp-clone';
export const TRUTH_ROOT = path.join(ROOT, 'artifacts', 'qualification', 'mailchimp_full_clone_truth');
export const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'qualification', 'mailchimp_real_world_indistinguishable_path');
export const VALIDATION_DIR = path.join(ARTIFACT_ROOT, 'validation');
export const REPORTS_DIR = path.join(ARTIFACT_ROOT, 'reports');

export const paths = {
  contract: path.join(ARTIFACT_ROOT, 'contract.json'),
  graph: path.join(ARTIFACT_ROOT, 'issue_graph.json'),
  matrix: path.join(ARTIFACT_ROOT, 'surface_matrix.json'),
  ledger: path.join(ARTIFACT_ROOT, 'ledger.json'),
  campaign: path.join(ARTIFACT_ROOT, 'campaign_state.json'),
  thresholdModel: path.join(ARTIFACT_ROOT, 'thresholds_model.json'),
  repoEvidence: path.join(ARTIFACT_ROOT, 'repo_evidence_snapshot.json'),
  gapAnalysis: path.join(ARTIFACT_ROOT, 'current_gap_analysis.json'),
  roadmap: path.join(ARTIFACT_ROOT, 'roadmap_backlog.json'),
  trajectory: path.join(ARTIFACT_ROOT, 'trajectory_estimate.json'),
  programState: path.join(ARTIFACT_ROOT, 'program_state.json'),
  completionSummary: path.join(ARTIFACT_ROOT, 'completion_summary.json'),
  notification: path.join(ARTIFACT_ROOT, 'notification_state.json'),
  qualificationSummary: path.join(REPORTS_DIR, 'qualification_summary.json'),
  supervisorStatus: path.join(REPORTS_DIR, 'supervisor_status.json'),
  finalReport: path.join(ARTIFACT_ROOT, 'mailchimp_real_world_indistinguishable_path_report.md'),
  finalReportDoc: path.join(ROOT, 'docs', 'MAILCHIMP_REAL_WORLD_INDISTINGUISHABLE_PATH_REPORT_2026-04-02.md')
};

export const truthPaths = {
  certification: path.join(TRUTH_ROOT, 'claim_certification.json'),
  parity: path.join(TRUTH_ROOT, 'parity_evidence.json'),
  architecture: path.join(TRUTH_ROOT, 'mailchimp_architecture_report.json'),
  qualificationSummary: path.join(TRUTH_ROOT, 'reports', 'qualification_summary.json'),
  completionSummary: path.join(TRUTH_ROOT, 'completion_summary.json'),
  surfaceMatrix: path.join(TRUTH_ROOT, 'surface_matrix.json')
};

export function surfaceDefinitions() {
  return [
    {
      id: 'R1',
      label: 'Top-tier threshold model refinement',
      issueIds: ['r1.threshold_model'],
      requiredArtifacts: [paths.thresholdModel]
    },
    {
      id: 'R2',
      label: 'Gap analysis to real_world_indistinguishable',
      issueIds: ['r2.gap_analysis'],
      requiredArtifacts: [paths.repoEvidence, paths.gapAnalysis]
    },
    {
      id: 'R3',
      label: 'Roadmap/backlog compiler for the top tier',
      issueIds: ['r3.roadmap_compiler'],
      requiredArtifacts: [paths.roadmap]
    },
    {
      id: 'R4',
      label: 'Trajectory estimator for the top tier',
      issueIds: ['r4.trajectory_estimator'],
      requiredArtifacts: [paths.trajectory]
    },
    {
      id: 'R5',
      label: 'Qualification/report artifacts',
      issueIds: ['r5.reporting'],
      requiredArtifacts: [paths.finalReport, paths.qualificationSummary]
    },
    {
      id: 'R6',
      label: 'Tests/executable requalification',
      issueIds: ['r6.tests_and_requalification'],
      requiredArtifacts: [
        path.join(VALIDATION_DIR, 'repo_tests.log'),
        path.join(VALIDATION_DIR, 'truth_refresh.log'),
        path.join(VALIDATION_DIR, 'path_supervisor.log')
      ]
    }
  ];
}
