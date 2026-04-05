import { createExperimentationWatchtowerWorkspace, summarizeExperimentationWatchtowerWorkspace, createExperimentationWatchtowerNarratives, createExperimentationWatchtowerCoverageGrid } from './domain-experimentation-watchtower.mjs';
import { createExperimentationWatchtowerPolicies, validateExperimentationWatchtowerPolicies, summarizeExperimentationWatchtowerPolicies, createExperimentationWatchtowerEscalationDeck } from './policies-experimentation-watchtower.mjs';
import { createExperimentationWatchtowerAnalyticsTimeline, createExperimentationWatchtowerForecastEnvelope, createExperimentationWatchtowerExceptionLedger, summarizeExperimentationWatchtowerAnalytics } from './analytics-experimentation-watchtower.mjs';
import { createExperimentationWatchtowerOperationsBoard, createExperimentationWatchtowerShiftChecklist, createExperimentationWatchtowerIncidentDeck } from './operations-experimentation-watchtower.mjs';
import { createExperimentationWatchtowerReportCards, createExperimentationWatchtowerReviewPackets, summarizeExperimentationWatchtowerReporting } from './reporting-experimentation-watchtower.mjs';
import { createExperimentationWatchtowerAuditTrail, createExperimentationWatchtowerEvidenceManifest, createExperimentationWatchtowerReadinessAttestation } from './audit-experimentation-watchtower.mjs';
import { createExperimentationWatchtowerPlaybooks, createExperimentationWatchtowerDecisionDeck, createExperimentationWatchtowerEscalationMoments } from './playbooks-experimentation-watchtower.mjs';

export function buildExperimentationWatchtowerSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationWatchtowerWorkspace(workspaceName);
  const policies = createExperimentationWatchtowerPolicies();
  return {
    workspace,
    summary: summarizeExperimentationWatchtowerWorkspace(workspace),
    narratives: createExperimentationWatchtowerNarratives(workspace),
    coverage: createExperimentationWatchtowerCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationWatchtowerPolicies(policies),
    validation: validateExperimentationWatchtowerPolicies(policies),
    escalationDeck: createExperimentationWatchtowerEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationWatchtowerAnalyticsTimeline(),
      forecast: createExperimentationWatchtowerForecastEnvelope(),
      exceptions: createExperimentationWatchtowerExceptionLedger(),
      summary: summarizeExperimentationWatchtowerAnalytics()
    },
    operations: {
      board: createExperimentationWatchtowerOperationsBoard(),
      checklist: createExperimentationWatchtowerShiftChecklist(),
      incidents: createExperimentationWatchtowerIncidentDeck()
    },
    reporting: {
      cards: createExperimentationWatchtowerReportCards(),
      packets: createExperimentationWatchtowerReviewPackets(),
      summary: summarizeExperimentationWatchtowerReporting()
    },
    audit: {
      trail: createExperimentationWatchtowerAuditTrail(),
      manifest: createExperimentationWatchtowerEvidenceManifest(),
      attestation: createExperimentationWatchtowerReadinessAttestation()
    },
    playbooks: createExperimentationWatchtowerPlaybooks(),
    decisions: createExperimentationWatchtowerDecisionDeck(),
    escalationMoments: createExperimentationWatchtowerEscalationMoments()
  };
}

export function createExperimentationWatchtowerReadinessBoard(snapshot = buildExperimentationWatchtowerSnapshot()) {
  return [
    { id: 'experimentation-watchtower-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-watchtower-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-watchtower-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-watchtower-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationWatchtowerApiDocument(snapshot = buildExperimentationWatchtowerSnapshot()) {
  return {
    id: 'experimentation-watchtower-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-watchtower/overview' },
      { method: 'GET', path: '/api/experimentation-watchtower/reporting' },
      { method: 'POST', path: '/api/experimentation-watchtower/validate' },
      { method: 'GET', path: '/api/experimentation-watchtower/audit' }
    ],
    readiness: createExperimentationWatchtowerReadinessBoard(snapshot)
  };
}

export function createExperimentationWatchtowerRouteSummary(snapshot = buildExperimentationWatchtowerSnapshot()) {
  return {
    id: snapshot.workspace.id,
    title: snapshot.summary.title,
    focus: snapshot.workspace.focus,
    groupTitle: snapshot.summary.groupTitle,
    metricCount: snapshot.summary.metricCount,
    policyCount: snapshot.policySummary.total,
    executiveCards: snapshot.reporting.summary.executiveCards
  };
}

