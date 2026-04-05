import { createCommerceWorkbenchWorkspace, summarizeCommerceWorkbenchWorkspace, createCommerceWorkbenchNarratives, createCommerceWorkbenchCoverageGrid } from './domain-commerce-workbench.mjs';
import { createCommerceWorkbenchPolicies, validateCommerceWorkbenchPolicies, summarizeCommerceWorkbenchPolicies, createCommerceWorkbenchEscalationDeck } from './policies-commerce-workbench.mjs';
import { createCommerceWorkbenchAnalyticsTimeline, createCommerceWorkbenchForecastEnvelope, createCommerceWorkbenchExceptionLedger, summarizeCommerceWorkbenchAnalytics } from './analytics-commerce-workbench.mjs';
import { createCommerceWorkbenchOperationsBoard, createCommerceWorkbenchShiftChecklist, createCommerceWorkbenchIncidentDeck } from './operations-commerce-workbench.mjs';
import { createCommerceWorkbenchReportCards, createCommerceWorkbenchReviewPackets, summarizeCommerceWorkbenchReporting } from './reporting-commerce-workbench.mjs';
import { createCommerceWorkbenchAuditTrail, createCommerceWorkbenchEvidenceManifest, createCommerceWorkbenchReadinessAttestation } from './audit-commerce-workbench.mjs';
import { createCommerceWorkbenchPlaybooks, createCommerceWorkbenchDecisionDeck, createCommerceWorkbenchEscalationMoments } from './playbooks-commerce-workbench.mjs';

export function buildCommerceWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceWorkbenchWorkspace(workspaceName);
  const policies = createCommerceWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeCommerceWorkbenchWorkspace(workspace),
    narratives: createCommerceWorkbenchNarratives(workspace),
    coverage: createCommerceWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceWorkbenchPolicies(policies),
    validation: validateCommerceWorkbenchPolicies(policies),
    escalationDeck: createCommerceWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createCommerceWorkbenchAnalyticsTimeline(),
      forecast: createCommerceWorkbenchForecastEnvelope(),
      exceptions: createCommerceWorkbenchExceptionLedger(),
      summary: summarizeCommerceWorkbenchAnalytics()
    },
    operations: {
      board: createCommerceWorkbenchOperationsBoard(),
      checklist: createCommerceWorkbenchShiftChecklist(),
      incidents: createCommerceWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createCommerceWorkbenchReportCards(),
      packets: createCommerceWorkbenchReviewPackets(),
      summary: summarizeCommerceWorkbenchReporting()
    },
    audit: {
      trail: createCommerceWorkbenchAuditTrail(),
      manifest: createCommerceWorkbenchEvidenceManifest(),
      attestation: createCommerceWorkbenchReadinessAttestation()
    },
    playbooks: createCommerceWorkbenchPlaybooks(),
    decisions: createCommerceWorkbenchDecisionDeck(),
    escalationMoments: createCommerceWorkbenchEscalationMoments()
  };
}

export function createCommerceWorkbenchReadinessBoard(snapshot = buildCommerceWorkbenchSnapshot()) {
  return [
    { id: 'commerce-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceWorkbenchApiDocument(snapshot = buildCommerceWorkbenchSnapshot()) {
  return {
    id: 'commerce-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-workbench/overview' },
      { method: 'GET', path: '/api/commerce-workbench/reporting' },
      { method: 'POST', path: '/api/commerce-workbench/validate' },
      { method: 'GET', path: '/api/commerce-workbench/audit' }
    ],
    readiness: createCommerceWorkbenchReadinessBoard(snapshot)
  };
}

export function createCommerceWorkbenchRouteSummary(snapshot = buildCommerceWorkbenchSnapshot()) {
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

