import { createLoyaltyNavigatorWorkspace, summarizeLoyaltyNavigatorWorkspace, createLoyaltyNavigatorNarratives, createLoyaltyNavigatorCoverageGrid } from './domain-loyalty-navigator.mjs';
import { createLoyaltyNavigatorPolicies, validateLoyaltyNavigatorPolicies, summarizeLoyaltyNavigatorPolicies, createLoyaltyNavigatorEscalationDeck } from './policies-loyalty-navigator.mjs';
import { createLoyaltyNavigatorAnalyticsTimeline, createLoyaltyNavigatorForecastEnvelope, createLoyaltyNavigatorExceptionLedger, summarizeLoyaltyNavigatorAnalytics } from './analytics-loyalty-navigator.mjs';
import { createLoyaltyNavigatorOperationsBoard, createLoyaltyNavigatorShiftChecklist, createLoyaltyNavigatorIncidentDeck } from './operations-loyalty-navigator.mjs';
import { createLoyaltyNavigatorReportCards, createLoyaltyNavigatorReviewPackets, summarizeLoyaltyNavigatorReporting } from './reporting-loyalty-navigator.mjs';
import { createLoyaltyNavigatorAuditTrail, createLoyaltyNavigatorEvidenceManifest, createLoyaltyNavigatorReadinessAttestation } from './audit-loyalty-navigator.mjs';
import { createLoyaltyNavigatorPlaybooks, createLoyaltyNavigatorDecisionDeck, createLoyaltyNavigatorEscalationMoments } from './playbooks-loyalty-navigator.mjs';

export function buildLoyaltyNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyNavigatorWorkspace(workspaceName);
  const policies = createLoyaltyNavigatorPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyNavigatorWorkspace(workspace),
    narratives: createLoyaltyNavigatorNarratives(workspace),
    coverage: createLoyaltyNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyNavigatorPolicies(policies),
    validation: validateLoyaltyNavigatorPolicies(policies),
    escalationDeck: createLoyaltyNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyNavigatorAnalyticsTimeline(),
      forecast: createLoyaltyNavigatorForecastEnvelope(),
      exceptions: createLoyaltyNavigatorExceptionLedger(),
      summary: summarizeLoyaltyNavigatorAnalytics()
    },
    operations: {
      board: createLoyaltyNavigatorOperationsBoard(),
      checklist: createLoyaltyNavigatorShiftChecklist(),
      incidents: createLoyaltyNavigatorIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyNavigatorReportCards(),
      packets: createLoyaltyNavigatorReviewPackets(),
      summary: summarizeLoyaltyNavigatorReporting()
    },
    audit: {
      trail: createLoyaltyNavigatorAuditTrail(),
      manifest: createLoyaltyNavigatorEvidenceManifest(),
      attestation: createLoyaltyNavigatorReadinessAttestation()
    },
    playbooks: createLoyaltyNavigatorPlaybooks(),
    decisions: createLoyaltyNavigatorDecisionDeck(),
    escalationMoments: createLoyaltyNavigatorEscalationMoments()
  };
}

export function createLoyaltyNavigatorReadinessBoard(snapshot = buildLoyaltyNavigatorSnapshot()) {
  return [
    { id: 'loyalty-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyNavigatorApiDocument(snapshot = buildLoyaltyNavigatorSnapshot()) {
  return {
    id: 'loyalty-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-navigator/overview' },
      { method: 'GET', path: '/api/loyalty-navigator/reporting' },
      { method: 'POST', path: '/api/loyalty-navigator/validate' },
      { method: 'GET', path: '/api/loyalty-navigator/audit' }
    ],
    readiness: createLoyaltyNavigatorReadinessBoard(snapshot)
  };
}

export function createLoyaltyNavigatorRouteSummary(snapshot = buildLoyaltyNavigatorSnapshot()) {
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

