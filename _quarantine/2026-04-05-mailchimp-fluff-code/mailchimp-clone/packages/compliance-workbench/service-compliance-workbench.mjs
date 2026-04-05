import { createComplianceWorkbenchWorkspace, summarizeComplianceWorkbenchWorkspace, createComplianceWorkbenchNarratives, createComplianceWorkbenchCoverageGrid } from './domain-compliance-workbench.mjs';
import { createComplianceWorkbenchPolicies, validateComplianceWorkbenchPolicies, summarizeComplianceWorkbenchPolicies, createComplianceWorkbenchEscalationDeck } from './policies-compliance-workbench.mjs';
import { createComplianceWorkbenchAnalyticsTimeline, createComplianceWorkbenchForecastEnvelope, createComplianceWorkbenchExceptionLedger, summarizeComplianceWorkbenchAnalytics } from './analytics-compliance-workbench.mjs';
import { createComplianceWorkbenchOperationsBoard, createComplianceWorkbenchShiftChecklist, createComplianceWorkbenchIncidentDeck } from './operations-compliance-workbench.mjs';
import { createComplianceWorkbenchReportCards, createComplianceWorkbenchReviewPackets, summarizeComplianceWorkbenchReporting } from './reporting-compliance-workbench.mjs';
import { createComplianceWorkbenchAuditTrail, createComplianceWorkbenchEvidenceManifest, createComplianceWorkbenchReadinessAttestation } from './audit-compliance-workbench.mjs';
import { createComplianceWorkbenchPlaybooks, createComplianceWorkbenchDecisionDeck, createComplianceWorkbenchEscalationMoments } from './playbooks-compliance-workbench.mjs';

export function buildComplianceWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceWorkbenchWorkspace(workspaceName);
  const policies = createComplianceWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeComplianceWorkbenchWorkspace(workspace),
    narratives: createComplianceWorkbenchNarratives(workspace),
    coverage: createComplianceWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceWorkbenchPolicies(policies),
    validation: validateComplianceWorkbenchPolicies(policies),
    escalationDeck: createComplianceWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createComplianceWorkbenchAnalyticsTimeline(),
      forecast: createComplianceWorkbenchForecastEnvelope(),
      exceptions: createComplianceWorkbenchExceptionLedger(),
      summary: summarizeComplianceWorkbenchAnalytics()
    },
    operations: {
      board: createComplianceWorkbenchOperationsBoard(),
      checklist: createComplianceWorkbenchShiftChecklist(),
      incidents: createComplianceWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createComplianceWorkbenchReportCards(),
      packets: createComplianceWorkbenchReviewPackets(),
      summary: summarizeComplianceWorkbenchReporting()
    },
    audit: {
      trail: createComplianceWorkbenchAuditTrail(),
      manifest: createComplianceWorkbenchEvidenceManifest(),
      attestation: createComplianceWorkbenchReadinessAttestation()
    },
    playbooks: createComplianceWorkbenchPlaybooks(),
    decisions: createComplianceWorkbenchDecisionDeck(),
    escalationMoments: createComplianceWorkbenchEscalationMoments()
  };
}

export function createComplianceWorkbenchReadinessBoard(snapshot = buildComplianceWorkbenchSnapshot()) {
  return [
    { id: 'compliance-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceWorkbenchApiDocument(snapshot = buildComplianceWorkbenchSnapshot()) {
  return {
    id: 'compliance-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-workbench/overview' },
      { method: 'GET', path: '/api/compliance-workbench/reporting' },
      { method: 'POST', path: '/api/compliance-workbench/validate' },
      { method: 'GET', path: '/api/compliance-workbench/audit' }
    ],
    readiness: createComplianceWorkbenchReadinessBoard(snapshot)
  };
}

export function createComplianceWorkbenchRouteSummary(snapshot = buildComplianceWorkbenchSnapshot()) {
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

