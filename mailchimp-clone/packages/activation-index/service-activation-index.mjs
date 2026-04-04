import { createActivationIndexWorkspace, summarizeActivationIndexWorkspace, createActivationIndexNarratives, createActivationIndexCoverageGrid } from './domain-activation-index.mjs';
import { createActivationIndexPolicies, validateActivationIndexPolicies, summarizeActivationIndexPolicies, createActivationIndexEscalationDeck } from './policies-activation-index.mjs';
import { createActivationIndexAnalyticsTimeline, createActivationIndexForecastEnvelope, createActivationIndexExceptionLedger, summarizeActivationIndexAnalytics } from './analytics-activation-index.mjs';
import { createActivationIndexOperationsBoard, createActivationIndexShiftChecklist, createActivationIndexIncidentDeck } from './operations-activation-index.mjs';
import { createActivationIndexReportCards, createActivationIndexReviewPackets, summarizeActivationIndexReporting } from './reporting-activation-index.mjs';
import { createActivationIndexAuditTrail, createActivationIndexEvidenceManifest, createActivationIndexReadinessAttestation } from './audit-activation-index.mjs';
import { createActivationIndexPlaybooks, createActivationIndexDecisionDeck, createActivationIndexEscalationMoments } from './playbooks-activation-index.mjs';

export function buildActivationIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationIndexWorkspace(workspaceName);
  const policies = createActivationIndexPolicies();
  return {
    workspace,
    summary: summarizeActivationIndexWorkspace(workspace),
    narratives: createActivationIndexNarratives(workspace),
    coverage: createActivationIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationIndexPolicies(policies),
    validation: validateActivationIndexPolicies(policies),
    escalationDeck: createActivationIndexEscalationDeck(policies),
    analytics: {
      timeline: createActivationIndexAnalyticsTimeline(),
      forecast: createActivationIndexForecastEnvelope(),
      exceptions: createActivationIndexExceptionLedger(),
      summary: summarizeActivationIndexAnalytics()
    },
    operations: {
      board: createActivationIndexOperationsBoard(),
      checklist: createActivationIndexShiftChecklist(),
      incidents: createActivationIndexIncidentDeck()
    },
    reporting: {
      cards: createActivationIndexReportCards(),
      packets: createActivationIndexReviewPackets(),
      summary: summarizeActivationIndexReporting()
    },
    audit: {
      trail: createActivationIndexAuditTrail(),
      manifest: createActivationIndexEvidenceManifest(),
      attestation: createActivationIndexReadinessAttestation()
    },
    playbooks: createActivationIndexPlaybooks(),
    decisions: createActivationIndexDecisionDeck(),
    escalationMoments: createActivationIndexEscalationMoments()
  };
}

export function createActivationIndexReadinessBoard(snapshot = buildActivationIndexSnapshot()) {
  return [
    { id: 'activation-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationIndexApiDocument(snapshot = buildActivationIndexSnapshot()) {
  return {
    id: 'activation-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-index/overview' },
      { method: 'GET', path: '/api/activation-index/reporting' },
      { method: 'POST', path: '/api/activation-index/validate' },
      { method: 'GET', path: '/api/activation-index/audit' }
    ],
    readiness: createActivationIndexReadinessBoard(snapshot)
  };
}

export function createActivationIndexRouteSummary(snapshot = buildActivationIndexSnapshot()) {
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

