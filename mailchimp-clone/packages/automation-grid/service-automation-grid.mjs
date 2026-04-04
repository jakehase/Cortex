import { createAutomationGridWorkspace, summarizeAutomationGridWorkspace, createAutomationGridNarratives, createAutomationGridCoverageGrid } from './domain-automation-grid.mjs';
import { createAutomationGridPolicies, validateAutomationGridPolicies, summarizeAutomationGridPolicies, createAutomationGridEscalationDeck } from './policies-automation-grid.mjs';
import { createAutomationGridAnalyticsTimeline, createAutomationGridForecastEnvelope, createAutomationGridExceptionLedger, summarizeAutomationGridAnalytics } from './analytics-automation-grid.mjs';
import { createAutomationGridOperationsBoard, createAutomationGridShiftChecklist, createAutomationGridIncidentDeck } from './operations-automation-grid.mjs';
import { createAutomationGridReportCards, createAutomationGridReviewPackets, summarizeAutomationGridReporting } from './reporting-automation-grid.mjs';
import { createAutomationGridAuditTrail, createAutomationGridEvidenceManifest, createAutomationGridReadinessAttestation } from './audit-automation-grid.mjs';
import { createAutomationGridPlaybooks, createAutomationGridDecisionDeck, createAutomationGridEscalationMoments } from './playbooks-automation-grid.mjs';

export function buildAutomationGridSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationGridWorkspace(workspaceName);
  const policies = createAutomationGridPolicies();
  return {
    workspace,
    summary: summarizeAutomationGridWorkspace(workspace),
    narratives: createAutomationGridNarratives(workspace),
    coverage: createAutomationGridCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationGridPolicies(policies),
    validation: validateAutomationGridPolicies(policies),
    escalationDeck: createAutomationGridEscalationDeck(policies),
    analytics: {
      timeline: createAutomationGridAnalyticsTimeline(),
      forecast: createAutomationGridForecastEnvelope(),
      exceptions: createAutomationGridExceptionLedger(),
      summary: summarizeAutomationGridAnalytics()
    },
    operations: {
      board: createAutomationGridOperationsBoard(),
      checklist: createAutomationGridShiftChecklist(),
      incidents: createAutomationGridIncidentDeck()
    },
    reporting: {
      cards: createAutomationGridReportCards(),
      packets: createAutomationGridReviewPackets(),
      summary: summarizeAutomationGridReporting()
    },
    audit: {
      trail: createAutomationGridAuditTrail(),
      manifest: createAutomationGridEvidenceManifest(),
      attestation: createAutomationGridReadinessAttestation()
    },
    playbooks: createAutomationGridPlaybooks(),
    decisions: createAutomationGridDecisionDeck(),
    escalationMoments: createAutomationGridEscalationMoments()
  };
}

export function createAutomationGridReadinessBoard(snapshot = buildAutomationGridSnapshot()) {
  return [
    { id: 'automation-grid-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-grid-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-grid-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-grid-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationGridApiDocument(snapshot = buildAutomationGridSnapshot()) {
  return {
    id: 'automation-grid-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-grid/overview' },
      { method: 'GET', path: '/api/automation-grid/reporting' },
      { method: 'POST', path: '/api/automation-grid/validate' },
      { method: 'GET', path: '/api/automation-grid/audit' }
    ],
    readiness: createAutomationGridReadinessBoard(snapshot)
  };
}

export function createAutomationGridRouteSummary(snapshot = buildAutomationGridSnapshot()) {
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

