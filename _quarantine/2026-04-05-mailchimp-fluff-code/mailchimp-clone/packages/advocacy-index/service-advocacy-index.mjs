import { createAdvocacyIndexWorkspace, summarizeAdvocacyIndexWorkspace, createAdvocacyIndexNarratives, createAdvocacyIndexCoverageGrid } from './domain-advocacy-index.mjs';
import { createAdvocacyIndexPolicies, validateAdvocacyIndexPolicies, summarizeAdvocacyIndexPolicies, createAdvocacyIndexEscalationDeck } from './policies-advocacy-index.mjs';
import { createAdvocacyIndexAnalyticsTimeline, createAdvocacyIndexForecastEnvelope, createAdvocacyIndexExceptionLedger, summarizeAdvocacyIndexAnalytics } from './analytics-advocacy-index.mjs';
import { createAdvocacyIndexOperationsBoard, createAdvocacyIndexShiftChecklist, createAdvocacyIndexIncidentDeck } from './operations-advocacy-index.mjs';
import { createAdvocacyIndexReportCards, createAdvocacyIndexReviewPackets, summarizeAdvocacyIndexReporting } from './reporting-advocacy-index.mjs';
import { createAdvocacyIndexAuditTrail, createAdvocacyIndexEvidenceManifest, createAdvocacyIndexReadinessAttestation } from './audit-advocacy-index.mjs';
import { createAdvocacyIndexPlaybooks, createAdvocacyIndexDecisionDeck, createAdvocacyIndexEscalationMoments } from './playbooks-advocacy-index.mjs';

export function buildAdvocacyIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyIndexWorkspace(workspaceName);
  const policies = createAdvocacyIndexPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyIndexWorkspace(workspace),
    narratives: createAdvocacyIndexNarratives(workspace),
    coverage: createAdvocacyIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyIndexPolicies(policies),
    validation: validateAdvocacyIndexPolicies(policies),
    escalationDeck: createAdvocacyIndexEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyIndexAnalyticsTimeline(),
      forecast: createAdvocacyIndexForecastEnvelope(),
      exceptions: createAdvocacyIndexExceptionLedger(),
      summary: summarizeAdvocacyIndexAnalytics()
    },
    operations: {
      board: createAdvocacyIndexOperationsBoard(),
      checklist: createAdvocacyIndexShiftChecklist(),
      incidents: createAdvocacyIndexIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyIndexReportCards(),
      packets: createAdvocacyIndexReviewPackets(),
      summary: summarizeAdvocacyIndexReporting()
    },
    audit: {
      trail: createAdvocacyIndexAuditTrail(),
      manifest: createAdvocacyIndexEvidenceManifest(),
      attestation: createAdvocacyIndexReadinessAttestation()
    },
    playbooks: createAdvocacyIndexPlaybooks(),
    decisions: createAdvocacyIndexDecisionDeck(),
    escalationMoments: createAdvocacyIndexEscalationMoments()
  };
}

export function createAdvocacyIndexReadinessBoard(snapshot = buildAdvocacyIndexSnapshot()) {
  return [
    { id: 'advocacy-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyIndexApiDocument(snapshot = buildAdvocacyIndexSnapshot()) {
  return {
    id: 'advocacy-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-index/overview' },
      { method: 'GET', path: '/api/advocacy-index/reporting' },
      { method: 'POST', path: '/api/advocacy-index/validate' },
      { method: 'GET', path: '/api/advocacy-index/audit' }
    ],
    readiness: createAdvocacyIndexReadinessBoard(snapshot)
  };
}

export function createAdvocacyIndexRouteSummary(snapshot = buildAdvocacyIndexSnapshot()) {
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

