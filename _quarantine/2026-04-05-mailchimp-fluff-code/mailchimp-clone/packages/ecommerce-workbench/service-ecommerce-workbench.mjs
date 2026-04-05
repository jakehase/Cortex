import { createEcommerceWorkbenchWorkspace, summarizeEcommerceWorkbenchWorkspace, createEcommerceWorkbenchNarratives, createEcommerceWorkbenchCoverageGrid } from './domain-ecommerce-workbench.mjs';
import { createEcommerceWorkbenchPolicies, validateEcommerceWorkbenchPolicies, summarizeEcommerceWorkbenchPolicies, createEcommerceWorkbenchEscalationDeck } from './policies-ecommerce-workbench.mjs';
import { createEcommerceWorkbenchAnalyticsTimeline, createEcommerceWorkbenchForecastEnvelope, createEcommerceWorkbenchExceptionLedger, summarizeEcommerceWorkbenchAnalytics } from './analytics-ecommerce-workbench.mjs';
import { createEcommerceWorkbenchOperationsBoard, createEcommerceWorkbenchShiftChecklist, createEcommerceWorkbenchIncidentDeck } from './operations-ecommerce-workbench.mjs';
import { createEcommerceWorkbenchReportCards, createEcommerceWorkbenchReviewPackets, summarizeEcommerceWorkbenchReporting } from './reporting-ecommerce-workbench.mjs';
import { createEcommerceWorkbenchAuditTrail, createEcommerceWorkbenchEvidenceManifest, createEcommerceWorkbenchReadinessAttestation } from './audit-ecommerce-workbench.mjs';
import { createEcommerceWorkbenchPlaybooks, createEcommerceWorkbenchDecisionDeck, createEcommerceWorkbenchEscalationMoments } from './playbooks-ecommerce-workbench.mjs';

export function buildEcommerceWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceWorkbenchWorkspace(workspaceName);
  const policies = createEcommerceWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeEcommerceWorkbenchWorkspace(workspace),
    narratives: createEcommerceWorkbenchNarratives(workspace),
    coverage: createEcommerceWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceWorkbenchPolicies(policies),
    validation: validateEcommerceWorkbenchPolicies(policies),
    escalationDeck: createEcommerceWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceWorkbenchAnalyticsTimeline(),
      forecast: createEcommerceWorkbenchForecastEnvelope(),
      exceptions: createEcommerceWorkbenchExceptionLedger(),
      summary: summarizeEcommerceWorkbenchAnalytics()
    },
    operations: {
      board: createEcommerceWorkbenchOperationsBoard(),
      checklist: createEcommerceWorkbenchShiftChecklist(),
      incidents: createEcommerceWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createEcommerceWorkbenchReportCards(),
      packets: createEcommerceWorkbenchReviewPackets(),
      summary: summarizeEcommerceWorkbenchReporting()
    },
    audit: {
      trail: createEcommerceWorkbenchAuditTrail(),
      manifest: createEcommerceWorkbenchEvidenceManifest(),
      attestation: createEcommerceWorkbenchReadinessAttestation()
    },
    playbooks: createEcommerceWorkbenchPlaybooks(),
    decisions: createEcommerceWorkbenchDecisionDeck(),
    escalationMoments: createEcommerceWorkbenchEscalationMoments()
  };
}

export function createEcommerceWorkbenchReadinessBoard(snapshot = buildEcommerceWorkbenchSnapshot()) {
  return [
    { id: 'ecommerce-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceWorkbenchApiDocument(snapshot = buildEcommerceWorkbenchSnapshot()) {
  return {
    id: 'ecommerce-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-workbench/overview' },
      { method: 'GET', path: '/api/ecommerce-workbench/reporting' },
      { method: 'POST', path: '/api/ecommerce-workbench/validate' },
      { method: 'GET', path: '/api/ecommerce-workbench/audit' }
    ],
    readiness: createEcommerceWorkbenchReadinessBoard(snapshot)
  };
}

export function createEcommerceWorkbenchRouteSummary(snapshot = buildEcommerceWorkbenchSnapshot()) {
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

