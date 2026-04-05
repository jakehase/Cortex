import { createLoyaltyIndexWorkspace, summarizeLoyaltyIndexWorkspace, createLoyaltyIndexNarratives, createLoyaltyIndexCoverageGrid } from './domain-loyalty-index.mjs';
import { createLoyaltyIndexPolicies, validateLoyaltyIndexPolicies, summarizeLoyaltyIndexPolicies, createLoyaltyIndexEscalationDeck } from './policies-loyalty-index.mjs';
import { createLoyaltyIndexAnalyticsTimeline, createLoyaltyIndexForecastEnvelope, createLoyaltyIndexExceptionLedger, summarizeLoyaltyIndexAnalytics } from './analytics-loyalty-index.mjs';
import { createLoyaltyIndexOperationsBoard, createLoyaltyIndexShiftChecklist, createLoyaltyIndexIncidentDeck } from './operations-loyalty-index.mjs';
import { createLoyaltyIndexReportCards, createLoyaltyIndexReviewPackets, summarizeLoyaltyIndexReporting } from './reporting-loyalty-index.mjs';
import { createLoyaltyIndexAuditTrail, createLoyaltyIndexEvidenceManifest, createLoyaltyIndexReadinessAttestation } from './audit-loyalty-index.mjs';
import { createLoyaltyIndexPlaybooks, createLoyaltyIndexDecisionDeck, createLoyaltyIndexEscalationMoments } from './playbooks-loyalty-index.mjs';

export function buildLoyaltyIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyIndexWorkspace(workspaceName);
  const policies = createLoyaltyIndexPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyIndexWorkspace(workspace),
    narratives: createLoyaltyIndexNarratives(workspace),
    coverage: createLoyaltyIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyIndexPolicies(policies),
    validation: validateLoyaltyIndexPolicies(policies),
    escalationDeck: createLoyaltyIndexEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyIndexAnalyticsTimeline(),
      forecast: createLoyaltyIndexForecastEnvelope(),
      exceptions: createLoyaltyIndexExceptionLedger(),
      summary: summarizeLoyaltyIndexAnalytics()
    },
    operations: {
      board: createLoyaltyIndexOperationsBoard(),
      checklist: createLoyaltyIndexShiftChecklist(),
      incidents: createLoyaltyIndexIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyIndexReportCards(),
      packets: createLoyaltyIndexReviewPackets(),
      summary: summarizeLoyaltyIndexReporting()
    },
    audit: {
      trail: createLoyaltyIndexAuditTrail(),
      manifest: createLoyaltyIndexEvidenceManifest(),
      attestation: createLoyaltyIndexReadinessAttestation()
    },
    playbooks: createLoyaltyIndexPlaybooks(),
    decisions: createLoyaltyIndexDecisionDeck(),
    escalationMoments: createLoyaltyIndexEscalationMoments()
  };
}

export function createLoyaltyIndexReadinessBoard(snapshot = buildLoyaltyIndexSnapshot()) {
  return [
    { id: 'loyalty-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyIndexApiDocument(snapshot = buildLoyaltyIndexSnapshot()) {
  return {
    id: 'loyalty-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-index/overview' },
      { method: 'GET', path: '/api/loyalty-index/reporting' },
      { method: 'POST', path: '/api/loyalty-index/validate' },
      { method: 'GET', path: '/api/loyalty-index/audit' }
    ],
    readiness: createLoyaltyIndexReadinessBoard(snapshot)
  };
}

export function createLoyaltyIndexRouteSummary(snapshot = buildLoyaltyIndexSnapshot()) {
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

