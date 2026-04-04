import { createLoyaltyWorkbenchWorkspace, summarizeLoyaltyWorkbenchWorkspace, createLoyaltyWorkbenchNarratives, createLoyaltyWorkbenchCoverageGrid } from './domain-loyalty-workbench.mjs';
import { createLoyaltyWorkbenchPolicies, validateLoyaltyWorkbenchPolicies, summarizeLoyaltyWorkbenchPolicies, createLoyaltyWorkbenchEscalationDeck } from './policies-loyalty-workbench.mjs';
import { createLoyaltyWorkbenchAnalyticsTimeline, createLoyaltyWorkbenchForecastEnvelope, createLoyaltyWorkbenchExceptionLedger, summarizeLoyaltyWorkbenchAnalytics } from './analytics-loyalty-workbench.mjs';
import { createLoyaltyWorkbenchOperationsBoard, createLoyaltyWorkbenchShiftChecklist, createLoyaltyWorkbenchIncidentDeck } from './operations-loyalty-workbench.mjs';
import { createLoyaltyWorkbenchReportCards, createLoyaltyWorkbenchReviewPackets, summarizeLoyaltyWorkbenchReporting } from './reporting-loyalty-workbench.mjs';
import { createLoyaltyWorkbenchAuditTrail, createLoyaltyWorkbenchEvidenceManifest, createLoyaltyWorkbenchReadinessAttestation } from './audit-loyalty-workbench.mjs';
import { createLoyaltyWorkbenchPlaybooks, createLoyaltyWorkbenchDecisionDeck, createLoyaltyWorkbenchEscalationMoments } from './playbooks-loyalty-workbench.mjs';

export function buildLoyaltyWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyWorkbenchWorkspace(workspaceName);
  const policies = createLoyaltyWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyWorkbenchWorkspace(workspace),
    narratives: createLoyaltyWorkbenchNarratives(workspace),
    coverage: createLoyaltyWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyWorkbenchPolicies(policies),
    validation: validateLoyaltyWorkbenchPolicies(policies),
    escalationDeck: createLoyaltyWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyWorkbenchAnalyticsTimeline(),
      forecast: createLoyaltyWorkbenchForecastEnvelope(),
      exceptions: createLoyaltyWorkbenchExceptionLedger(),
      summary: summarizeLoyaltyWorkbenchAnalytics()
    },
    operations: {
      board: createLoyaltyWorkbenchOperationsBoard(),
      checklist: createLoyaltyWorkbenchShiftChecklist(),
      incidents: createLoyaltyWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyWorkbenchReportCards(),
      packets: createLoyaltyWorkbenchReviewPackets(),
      summary: summarizeLoyaltyWorkbenchReporting()
    },
    audit: {
      trail: createLoyaltyWorkbenchAuditTrail(),
      manifest: createLoyaltyWorkbenchEvidenceManifest(),
      attestation: createLoyaltyWorkbenchReadinessAttestation()
    },
    playbooks: createLoyaltyWorkbenchPlaybooks(),
    decisions: createLoyaltyWorkbenchDecisionDeck(),
    escalationMoments: createLoyaltyWorkbenchEscalationMoments()
  };
}

export function createLoyaltyWorkbenchReadinessBoard(snapshot = buildLoyaltyWorkbenchSnapshot()) {
  return [
    { id: 'loyalty-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyWorkbenchApiDocument(snapshot = buildLoyaltyWorkbenchSnapshot()) {
  return {
    id: 'loyalty-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-workbench/overview' },
      { method: 'GET', path: '/api/loyalty-workbench/reporting' },
      { method: 'POST', path: '/api/loyalty-workbench/validate' },
      { method: 'GET', path: '/api/loyalty-workbench/audit' }
    ],
    readiness: createLoyaltyWorkbenchReadinessBoard(snapshot)
  };
}

export function createLoyaltyWorkbenchRouteSummary(snapshot = buildLoyaltyWorkbenchSnapshot()) {
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

