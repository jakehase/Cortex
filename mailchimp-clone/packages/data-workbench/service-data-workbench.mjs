import { createDataWorkbenchWorkspace, summarizeDataWorkbenchWorkspace, createDataWorkbenchNarratives, createDataWorkbenchCoverageGrid } from './domain-data-workbench.mjs';
import { createDataWorkbenchPolicies, validateDataWorkbenchPolicies, summarizeDataWorkbenchPolicies, createDataWorkbenchEscalationDeck } from './policies-data-workbench.mjs';
import { createDataWorkbenchAnalyticsTimeline, createDataWorkbenchForecastEnvelope, createDataWorkbenchExceptionLedger, summarizeDataWorkbenchAnalytics } from './analytics-data-workbench.mjs';
import { createDataWorkbenchOperationsBoard, createDataWorkbenchShiftChecklist, createDataWorkbenchIncidentDeck } from './operations-data-workbench.mjs';
import { createDataWorkbenchReportCards, createDataWorkbenchReviewPackets, summarizeDataWorkbenchReporting } from './reporting-data-workbench.mjs';
import { createDataWorkbenchAuditTrail, createDataWorkbenchEvidenceManifest, createDataWorkbenchReadinessAttestation } from './audit-data-workbench.mjs';
import { createDataWorkbenchPlaybooks, createDataWorkbenchDecisionDeck, createDataWorkbenchEscalationMoments } from './playbooks-data-workbench.mjs';

export function buildDataWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataWorkbenchWorkspace(workspaceName);
  const policies = createDataWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeDataWorkbenchWorkspace(workspace),
    narratives: createDataWorkbenchNarratives(workspace),
    coverage: createDataWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataWorkbenchPolicies(policies),
    validation: validateDataWorkbenchPolicies(policies),
    escalationDeck: createDataWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createDataWorkbenchAnalyticsTimeline(),
      forecast: createDataWorkbenchForecastEnvelope(),
      exceptions: createDataWorkbenchExceptionLedger(),
      summary: summarizeDataWorkbenchAnalytics()
    },
    operations: {
      board: createDataWorkbenchOperationsBoard(),
      checklist: createDataWorkbenchShiftChecklist(),
      incidents: createDataWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createDataWorkbenchReportCards(),
      packets: createDataWorkbenchReviewPackets(),
      summary: summarizeDataWorkbenchReporting()
    },
    audit: {
      trail: createDataWorkbenchAuditTrail(),
      manifest: createDataWorkbenchEvidenceManifest(),
      attestation: createDataWorkbenchReadinessAttestation()
    },
    playbooks: createDataWorkbenchPlaybooks(),
    decisions: createDataWorkbenchDecisionDeck(),
    escalationMoments: createDataWorkbenchEscalationMoments()
  };
}

export function createDataWorkbenchReadinessBoard(snapshot = buildDataWorkbenchSnapshot()) {
  return [
    { id: 'data-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataWorkbenchApiDocument(snapshot = buildDataWorkbenchSnapshot()) {
  return {
    id: 'data-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-workbench/overview' },
      { method: 'GET', path: '/api/data-workbench/reporting' },
      { method: 'POST', path: '/api/data-workbench/validate' },
      { method: 'GET', path: '/api/data-workbench/audit' }
    ],
    readiness: createDataWorkbenchReadinessBoard(snapshot)
  };
}

export function createDataWorkbenchRouteSummary(snapshot = buildDataWorkbenchSnapshot()) {
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

