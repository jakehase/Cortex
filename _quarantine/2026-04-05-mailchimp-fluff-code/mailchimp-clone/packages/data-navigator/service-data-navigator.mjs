import { createDataNavigatorWorkspace, summarizeDataNavigatorWorkspace, createDataNavigatorNarratives, createDataNavigatorCoverageGrid } from './domain-data-navigator.mjs';
import { createDataNavigatorPolicies, validateDataNavigatorPolicies, summarizeDataNavigatorPolicies, createDataNavigatorEscalationDeck } from './policies-data-navigator.mjs';
import { createDataNavigatorAnalyticsTimeline, createDataNavigatorForecastEnvelope, createDataNavigatorExceptionLedger, summarizeDataNavigatorAnalytics } from './analytics-data-navigator.mjs';
import { createDataNavigatorOperationsBoard, createDataNavigatorShiftChecklist, createDataNavigatorIncidentDeck } from './operations-data-navigator.mjs';
import { createDataNavigatorReportCards, createDataNavigatorReviewPackets, summarizeDataNavigatorReporting } from './reporting-data-navigator.mjs';
import { createDataNavigatorAuditTrail, createDataNavigatorEvidenceManifest, createDataNavigatorReadinessAttestation } from './audit-data-navigator.mjs';
import { createDataNavigatorPlaybooks, createDataNavigatorDecisionDeck, createDataNavigatorEscalationMoments } from './playbooks-data-navigator.mjs';

export function buildDataNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataNavigatorWorkspace(workspaceName);
  const policies = createDataNavigatorPolicies();
  return {
    workspace,
    summary: summarizeDataNavigatorWorkspace(workspace),
    narratives: createDataNavigatorNarratives(workspace),
    coverage: createDataNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataNavigatorPolicies(policies),
    validation: validateDataNavigatorPolicies(policies),
    escalationDeck: createDataNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createDataNavigatorAnalyticsTimeline(),
      forecast: createDataNavigatorForecastEnvelope(),
      exceptions: createDataNavigatorExceptionLedger(),
      summary: summarizeDataNavigatorAnalytics()
    },
    operations: {
      board: createDataNavigatorOperationsBoard(),
      checklist: createDataNavigatorShiftChecklist(),
      incidents: createDataNavigatorIncidentDeck()
    },
    reporting: {
      cards: createDataNavigatorReportCards(),
      packets: createDataNavigatorReviewPackets(),
      summary: summarizeDataNavigatorReporting()
    },
    audit: {
      trail: createDataNavigatorAuditTrail(),
      manifest: createDataNavigatorEvidenceManifest(),
      attestation: createDataNavigatorReadinessAttestation()
    },
    playbooks: createDataNavigatorPlaybooks(),
    decisions: createDataNavigatorDecisionDeck(),
    escalationMoments: createDataNavigatorEscalationMoments()
  };
}

export function createDataNavigatorReadinessBoard(snapshot = buildDataNavigatorSnapshot()) {
  return [
    { id: 'data-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataNavigatorApiDocument(snapshot = buildDataNavigatorSnapshot()) {
  return {
    id: 'data-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-navigator/overview' },
      { method: 'GET', path: '/api/data-navigator/reporting' },
      { method: 'POST', path: '/api/data-navigator/validate' },
      { method: 'GET', path: '/api/data-navigator/audit' }
    ],
    readiness: createDataNavigatorReadinessBoard(snapshot)
  };
}

export function createDataNavigatorRouteSummary(snapshot = buildDataNavigatorSnapshot()) {
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

