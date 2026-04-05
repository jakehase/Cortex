import { createExperimentationIndexWorkspace, summarizeExperimentationIndexWorkspace, createExperimentationIndexNarratives, createExperimentationIndexCoverageGrid } from './domain-experimentation-index.mjs';
import { createExperimentationIndexPolicies, validateExperimentationIndexPolicies, summarizeExperimentationIndexPolicies, createExperimentationIndexEscalationDeck } from './policies-experimentation-index.mjs';
import { createExperimentationIndexAnalyticsTimeline, createExperimentationIndexForecastEnvelope, createExperimentationIndexExceptionLedger, summarizeExperimentationIndexAnalytics } from './analytics-experimentation-index.mjs';
import { createExperimentationIndexOperationsBoard, createExperimentationIndexShiftChecklist, createExperimentationIndexIncidentDeck } from './operations-experimentation-index.mjs';
import { createExperimentationIndexReportCards, createExperimentationIndexReviewPackets, summarizeExperimentationIndexReporting } from './reporting-experimentation-index.mjs';
import { createExperimentationIndexAuditTrail, createExperimentationIndexEvidenceManifest, createExperimentationIndexReadinessAttestation } from './audit-experimentation-index.mjs';
import { createExperimentationIndexPlaybooks, createExperimentationIndexDecisionDeck, createExperimentationIndexEscalationMoments } from './playbooks-experimentation-index.mjs';

export function buildExperimentationIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationIndexWorkspace(workspaceName);
  const policies = createExperimentationIndexPolicies();
  return {
    workspace,
    summary: summarizeExperimentationIndexWorkspace(workspace),
    narratives: createExperimentationIndexNarratives(workspace),
    coverage: createExperimentationIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationIndexPolicies(policies),
    validation: validateExperimentationIndexPolicies(policies),
    escalationDeck: createExperimentationIndexEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationIndexAnalyticsTimeline(),
      forecast: createExperimentationIndexForecastEnvelope(),
      exceptions: createExperimentationIndexExceptionLedger(),
      summary: summarizeExperimentationIndexAnalytics()
    },
    operations: {
      board: createExperimentationIndexOperationsBoard(),
      checklist: createExperimentationIndexShiftChecklist(),
      incidents: createExperimentationIndexIncidentDeck()
    },
    reporting: {
      cards: createExperimentationIndexReportCards(),
      packets: createExperimentationIndexReviewPackets(),
      summary: summarizeExperimentationIndexReporting()
    },
    audit: {
      trail: createExperimentationIndexAuditTrail(),
      manifest: createExperimentationIndexEvidenceManifest(),
      attestation: createExperimentationIndexReadinessAttestation()
    },
    playbooks: createExperimentationIndexPlaybooks(),
    decisions: createExperimentationIndexDecisionDeck(),
    escalationMoments: createExperimentationIndexEscalationMoments()
  };
}

export function createExperimentationIndexReadinessBoard(snapshot = buildExperimentationIndexSnapshot()) {
  return [
    { id: 'experimentation-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationIndexApiDocument(snapshot = buildExperimentationIndexSnapshot()) {
  return {
    id: 'experimentation-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-index/overview' },
      { method: 'GET', path: '/api/experimentation-index/reporting' },
      { method: 'POST', path: '/api/experimentation-index/validate' },
      { method: 'GET', path: '/api/experimentation-index/audit' }
    ],
    readiness: createExperimentationIndexReadinessBoard(snapshot)
  };
}

export function createExperimentationIndexRouteSummary(snapshot = buildExperimentationIndexSnapshot()) {
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

