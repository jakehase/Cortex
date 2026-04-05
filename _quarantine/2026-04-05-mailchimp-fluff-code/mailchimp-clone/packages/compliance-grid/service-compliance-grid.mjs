import { createComplianceGridWorkspace, summarizeComplianceGridWorkspace, createComplianceGridNarratives, createComplianceGridCoverageGrid } from './domain-compliance-grid.mjs';
import { createComplianceGridPolicies, validateComplianceGridPolicies, summarizeComplianceGridPolicies, createComplianceGridEscalationDeck } from './policies-compliance-grid.mjs';
import { createComplianceGridAnalyticsTimeline, createComplianceGridForecastEnvelope, createComplianceGridExceptionLedger, summarizeComplianceGridAnalytics } from './analytics-compliance-grid.mjs';
import { createComplianceGridOperationsBoard, createComplianceGridShiftChecklist, createComplianceGridIncidentDeck } from './operations-compliance-grid.mjs';
import { createComplianceGridReportCards, createComplianceGridReviewPackets, summarizeComplianceGridReporting } from './reporting-compliance-grid.mjs';
import { createComplianceGridAuditTrail, createComplianceGridEvidenceManifest, createComplianceGridReadinessAttestation } from './audit-compliance-grid.mjs';
import { createComplianceGridPlaybooks, createComplianceGridDecisionDeck, createComplianceGridEscalationMoments } from './playbooks-compliance-grid.mjs';

export function buildComplianceGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceGridWorkspace(workspaceName);
  const policies = createComplianceGridPolicies();
  return {
    workspace,
    summary: summarizeComplianceGridWorkspace(workspace),
    narratives: createComplianceGridNarratives(workspace),
    coverage: createComplianceGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceGridPolicies(policies),
    validation: validateComplianceGridPolicies(policies),
    escalationDeck: createComplianceGridEscalationDeck(policies),
    analytics: {
      timeline: createComplianceGridAnalyticsTimeline(),
      forecast: createComplianceGridForecastEnvelope(),
      exceptions: createComplianceGridExceptionLedger(),
      summary: summarizeComplianceGridAnalytics()
    },
    operations: {
      board: createComplianceGridOperationsBoard(),
      checklist: createComplianceGridShiftChecklist(),
      incidents: createComplianceGridIncidentDeck()
    },
    reporting: {
      cards: createComplianceGridReportCards(),
      packets: createComplianceGridReviewPackets(),
      summary: summarizeComplianceGridReporting()
    },
    audit: {
      trail: createComplianceGridAuditTrail(),
      manifest: createComplianceGridEvidenceManifest(),
      attestation: createComplianceGridReadinessAttestation()
    },
    playbooks: createComplianceGridPlaybooks(),
    decisions: createComplianceGridDecisionDeck(),
    escalationMoments: createComplianceGridEscalationMoments()
  };
}

export function createComplianceGridReadinessBoard(snapshot = buildComplianceGridSnapshot()) {
  return [
    { id: 'compliance-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceGridApiDocument(snapshot = buildComplianceGridSnapshot()) {
  return {
    id: 'compliance-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-grid/overview' },
      { method: 'GET', path: '/api/compliance-grid/reporting' },
      { method: 'POST', path: '/api/compliance-grid/validate' },
      { method: 'GET', path: '/api/compliance-grid/audit' }
    ],
    readiness: createComplianceGridReadinessBoard(snapshot)
  };
}

export function createComplianceGridRouteSummary(snapshot = buildComplianceGridSnapshot()) {
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

