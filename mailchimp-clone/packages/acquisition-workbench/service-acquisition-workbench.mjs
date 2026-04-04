import { createAcquisitionWorkbenchWorkspace, summarizeAcquisitionWorkbenchWorkspace, createAcquisitionWorkbenchNarratives, createAcquisitionWorkbenchCoverageGrid } from './domain-acquisition-workbench.mjs';
import { createAcquisitionWorkbenchPolicies, validateAcquisitionWorkbenchPolicies, summarizeAcquisitionWorkbenchPolicies, createAcquisitionWorkbenchEscalationDeck } from './policies-acquisition-workbench.mjs';
import { createAcquisitionWorkbenchAnalyticsTimeline, createAcquisitionWorkbenchForecastEnvelope, createAcquisitionWorkbenchExceptionLedger, summarizeAcquisitionWorkbenchAnalytics } from './analytics-acquisition-workbench.mjs';
import { createAcquisitionWorkbenchOperationsBoard, createAcquisitionWorkbenchShiftChecklist, createAcquisitionWorkbenchIncidentDeck } from './operations-acquisition-workbench.mjs';
import { createAcquisitionWorkbenchReportCards, createAcquisitionWorkbenchReviewPackets, summarizeAcquisitionWorkbenchReporting } from './reporting-acquisition-workbench.mjs';
import { createAcquisitionWorkbenchAuditTrail, createAcquisitionWorkbenchEvidenceManifest, createAcquisitionWorkbenchReadinessAttestation } from './audit-acquisition-workbench.mjs';
import { createAcquisitionWorkbenchPlaybooks, createAcquisitionWorkbenchDecisionDeck, createAcquisitionWorkbenchEscalationMoments } from './playbooks-acquisition-workbench.mjs';

export function buildAcquisitionWorkbenchSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionWorkbenchWorkspace(workspaceName);
  const policies = createAcquisitionWorkbenchPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionWorkbenchWorkspace(workspace),
    narratives: createAcquisitionWorkbenchNarratives(workspace),
    coverage: createAcquisitionWorkbenchCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionWorkbenchPolicies(policies),
    validation: validateAcquisitionWorkbenchPolicies(policies),
    escalationDeck: createAcquisitionWorkbenchEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionWorkbenchAnalyticsTimeline(),
      forecast: createAcquisitionWorkbenchForecastEnvelope(),
      exceptions: createAcquisitionWorkbenchExceptionLedger(),
      summary: summarizeAcquisitionWorkbenchAnalytics()
    },
    operations: {
      board: createAcquisitionWorkbenchOperationsBoard(),
      checklist: createAcquisitionWorkbenchShiftChecklist(),
      incidents: createAcquisitionWorkbenchIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionWorkbenchReportCards(),
      packets: createAcquisitionWorkbenchReviewPackets(),
      summary: summarizeAcquisitionWorkbenchReporting()
    },
    audit: {
      trail: createAcquisitionWorkbenchAuditTrail(),
      manifest: createAcquisitionWorkbenchEvidenceManifest(),
      attestation: createAcquisitionWorkbenchReadinessAttestation()
    },
    playbooks: createAcquisitionWorkbenchPlaybooks(),
    decisions: createAcquisitionWorkbenchDecisionDeck(),
    escalationMoments: createAcquisitionWorkbenchEscalationMoments()
  };
}

export function createAcquisitionWorkbenchReadinessBoard(snapshot = buildAcquisitionWorkbenchSnapshot()) {
  return [
    { id: 'acquisition-workbench-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-workbench-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-workbench-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-workbench-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionWorkbenchApiDocument(snapshot = buildAcquisitionWorkbenchSnapshot()) {
  return {
    id: 'acquisition-workbench-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-workbench/overview' },
      { method: 'GET', path: '/api/acquisition-workbench/reporting' },
      { method: 'POST', path: '/api/acquisition-workbench/validate' },
      { method: 'GET', path: '/api/acquisition-workbench/audit' }
    ],
    readiness: createAcquisitionWorkbenchReadinessBoard(snapshot)
  };
}

export function createAcquisitionWorkbenchRouteSummary(snapshot = buildAcquisitionWorkbenchSnapshot()) {
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

