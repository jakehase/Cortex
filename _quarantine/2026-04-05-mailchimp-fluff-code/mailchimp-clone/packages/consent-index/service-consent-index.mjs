import { createConsentIndexWorkspace, summarizeConsentIndexWorkspace, createConsentIndexNarratives, createConsentIndexCoverageGrid } from './domain-consent-index.mjs';
import { createConsentIndexPolicies, validateConsentIndexPolicies, summarizeConsentIndexPolicies, createConsentIndexEscalationDeck } from './policies-consent-index.mjs';
import { createConsentIndexAnalyticsTimeline, createConsentIndexForecastEnvelope, createConsentIndexExceptionLedger, summarizeConsentIndexAnalytics } from './analytics-consent-index.mjs';
import { createConsentIndexOperationsBoard, createConsentIndexShiftChecklist, createConsentIndexIncidentDeck } from './operations-consent-index.mjs';
import { createConsentIndexReportCards, createConsentIndexReviewPackets, summarizeConsentIndexReporting } from './reporting-consent-index.mjs';
import { createConsentIndexAuditTrail, createConsentIndexEvidenceManifest, createConsentIndexReadinessAttestation } from './audit-consent-index.mjs';
import { createConsentIndexPlaybooks, createConsentIndexDecisionDeck, createConsentIndexEscalationMoments } from './playbooks-consent-index.mjs';

export function buildConsentIndexSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentIndexWorkspace(workspaceName);
  const policies = createConsentIndexPolicies();
  return {
    workspace,
    summary: summarizeConsentIndexWorkspace(workspace),
    narratives: createConsentIndexNarratives(workspace),
    coverage: createConsentIndexCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentIndexPolicies(policies),
    validation: validateConsentIndexPolicies(policies),
    escalationDeck: createConsentIndexEscalationDeck(policies),
    analytics: {
      timeline: createConsentIndexAnalyticsTimeline(),
      forecast: createConsentIndexForecastEnvelope(),
      exceptions: createConsentIndexExceptionLedger(),
      summary: summarizeConsentIndexAnalytics()
    },
    operations: {
      board: createConsentIndexOperationsBoard(),
      checklist: createConsentIndexShiftChecklist(),
      incidents: createConsentIndexIncidentDeck()
    },
    reporting: {
      cards: createConsentIndexReportCards(),
      packets: createConsentIndexReviewPackets(),
      summary: summarizeConsentIndexReporting()
    },
    audit: {
      trail: createConsentIndexAuditTrail(),
      manifest: createConsentIndexEvidenceManifest(),
      attestation: createConsentIndexReadinessAttestation()
    },
    playbooks: createConsentIndexPlaybooks(),
    decisions: createConsentIndexDecisionDeck(),
    escalationMoments: createConsentIndexEscalationMoments()
  };
}

export function createConsentIndexReadinessBoard(snapshot = buildConsentIndexSnapshot()) {
  return [
    { id: 'consent-index-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-index-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-index-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-index-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentIndexApiDocument(snapshot = buildConsentIndexSnapshot()) {
  return {
    id: 'consent-index-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-index/overview' },
      { method: 'GET', path: '/api/consent-index/reporting' },
      { method: 'POST', path: '/api/consent-index/validate' },
      { method: 'GET', path: '/api/consent-index/audit' }
    ],
    readiness: createConsentIndexReadinessBoard(snapshot)
  };
}

export function createConsentIndexRouteSummary(snapshot = buildConsentIndexSnapshot()) {
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

