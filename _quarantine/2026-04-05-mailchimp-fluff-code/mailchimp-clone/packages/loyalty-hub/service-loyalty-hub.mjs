import { createLoyaltyHubWorkspace, summarizeLoyaltyHubWorkspace, createLoyaltyHubNarratives, createLoyaltyHubCoverageGrid } from './domain-loyalty-hub.mjs';
import { createLoyaltyHubPolicies, validateLoyaltyHubPolicies, summarizeLoyaltyHubPolicies, createLoyaltyHubEscalationDeck } from './policies-loyalty-hub.mjs';
import { createLoyaltyHubAnalyticsTimeline, createLoyaltyHubForecastEnvelope, createLoyaltyHubExceptionLedger, summarizeLoyaltyHubAnalytics } from './analytics-loyalty-hub.mjs';
import { createLoyaltyHubOperationsBoard, createLoyaltyHubShiftChecklist, createLoyaltyHubIncidentDeck } from './operations-loyalty-hub.mjs';
import { createLoyaltyHubReportCards, createLoyaltyHubReviewPackets, summarizeLoyaltyHubReporting } from './reporting-loyalty-hub.mjs';
import { createLoyaltyHubAuditTrail, createLoyaltyHubEvidenceManifest, createLoyaltyHubReadinessAttestation } from './audit-loyalty-hub.mjs';
import { createLoyaltyHubPlaybooks, createLoyaltyHubDecisionDeck, createLoyaltyHubEscalationMoments } from './playbooks-loyalty-hub.mjs';

export function buildLoyaltyHubSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyHubWorkspace(workspaceName);
  const policies = createLoyaltyHubPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyHubWorkspace(workspace),
    narratives: createLoyaltyHubNarratives(workspace),
    coverage: createLoyaltyHubCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyHubPolicies(policies),
    validation: validateLoyaltyHubPolicies(policies),
    escalationDeck: createLoyaltyHubEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyHubAnalyticsTimeline(),
      forecast: createLoyaltyHubForecastEnvelope(),
      exceptions: createLoyaltyHubExceptionLedger(),
      summary: summarizeLoyaltyHubAnalytics()
    },
    operations: {
      board: createLoyaltyHubOperationsBoard(),
      checklist: createLoyaltyHubShiftChecklist(),
      incidents: createLoyaltyHubIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyHubReportCards(),
      packets: createLoyaltyHubReviewPackets(),
      summary: summarizeLoyaltyHubReporting()
    },
    audit: {
      trail: createLoyaltyHubAuditTrail(),
      manifest: createLoyaltyHubEvidenceManifest(),
      attestation: createLoyaltyHubReadinessAttestation()
    },
    playbooks: createLoyaltyHubPlaybooks(),
    decisions: createLoyaltyHubDecisionDeck(),
    escalationMoments: createLoyaltyHubEscalationMoments()
  };
}

export function createLoyaltyHubReadinessBoard(snapshot = buildLoyaltyHubSnapshot()) {
  return [
    { id: 'loyalty-hub-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-hub-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-hub-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-hub-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyHubApiDocument(snapshot = buildLoyaltyHubSnapshot()) {
  return {
    id: 'loyalty-hub-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-hub/overview' },
      { method: 'GET', path: '/api/loyalty-hub/reporting' },
      { method: 'POST', path: '/api/loyalty-hub/validate' },
      { method: 'GET', path: '/api/loyalty-hub/audit' }
    ],
    readiness: createLoyaltyHubReadinessBoard(snapshot)
  };
}

export function createLoyaltyHubRouteSummary(snapshot = buildLoyaltyHubSnapshot()) {
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

