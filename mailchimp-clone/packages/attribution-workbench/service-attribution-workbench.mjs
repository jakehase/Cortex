import { createAttributionWorkbenchWorkspace, summarizeAttributionWorkbenchWorkspace, createAttributionWorkbenchNarratives, createAttributionWorkbenchCoverageGrid } from './domain-attribution-workbench.mjs';
import { createAttributionWorkbenchPolicies, validateAttributionWorkbenchPolicies, summarizeAttributionWorkbenchPolicies, createAttributionWorkbenchEscalationDeck } from './policies-attribution-workbench.mjs';
import { createAttributionWorkbenchAnalyticsTimeline, createAttributionWorkbenchForecastEnvelope, createAttributionWorkbenchExceptionLedger, summarizeAttributionWorkbenchAnalytics } from './analytics-attribution-workbench.mjs';
import { createAttributionWorkbenchOperationsBoard, createAttributionWorkbenchShiftChecklist, createAttributionWorkbenchIncidentDeck } from './operations-attribution-workbench.mjs';
import { createAttributionWorkbenchReportCards, createAttributionWorkbenchReviewPackets, summarizeAttributionWorkbenchReporting } from './reporting-attribution-workbench.mjs';
import { createAttributionWorkbenchAuditTrail, createAttributionWorkbenchEvidenceManifest, createAttributionWorkbenchReadinessAttestation } from './audit-attribution-workbench.mjs';
import { createAttributionWorkbenchPlaybooks, createAttributionWorkbenchDecisionDeck, createAttributionWorkbenchEscalationMoments } from './playbooks-attribution-workbench.mjs';

export function buildAttributionWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionWorkbenchWorkspace(workspaceName);
  const policies = createAttributionWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeAttributionWorkbenchWorkspace(workspace),
    narratives: createAttributionWorkbenchNarratives(workspace),
    coverage: createAttributionWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionWorkbenchPolicies(policies),
    validation: validateAttributionWorkbenchPolicies(policies),
    escalationDeck: createAttributionWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createAttributionWorkbenchAnalyticsTimeline(),
      forecast: createAttributionWorkbenchForecastEnvelope(),
      exceptions: createAttributionWorkbenchExceptionLedger(),
      summary: summarizeAttributionWorkbenchAnalytics()
    },
    operations: {
      board: createAttributionWorkbenchOperationsBoard(),
      checklist: createAttributionWorkbenchShiftChecklist(),
      incidents: createAttributionWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createAttributionWorkbenchReportCards(),
      packets: createAttributionWorkbenchReviewPackets(),
      summary: summarizeAttributionWorkbenchReporting()
    },
    audit: {
      trail: createAttributionWorkbenchAuditTrail(),
      manifest: createAttributionWorkbenchEvidenceManifest(),
      attestation: createAttributionWorkbenchReadinessAttestation()
    },
    playbooks: createAttributionWorkbenchPlaybooks(),
    decisions: createAttributionWorkbenchDecisionDeck(),
    escalationMoments: createAttributionWorkbenchEscalationMoments()
  };
}

export function createAttributionWorkbenchReadinessBoard(snapshot = buildAttributionWorkbenchSnapshot()) {
  return [
    { id: 'attribution-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionWorkbenchApiDocument(snapshot = buildAttributionWorkbenchSnapshot()) {
  return {
    id: 'attribution-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-workbench/overview' },
      { method: 'GET', path: '/api/attribution-workbench/reporting' },
      { method: 'POST', path: '/api/attribution-workbench/validate' },
      { method: 'GET', path: '/api/attribution-workbench/audit' }
    ],
    readiness: createAttributionWorkbenchReadinessBoard(snapshot)
  };
}

export function createAttributionWorkbenchRouteSummary(snapshot = buildAttributionWorkbenchSnapshot()) {
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

